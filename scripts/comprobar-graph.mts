/*
  Comprueba el acceso al buzón de compras sin mandar ni tocar nada.

  Esto existe porque el código que habla con Microsoft no se puede probar hasta
  que el registro de Azure está hecho, y cuando algo falla por ahí el error
  llega tarde y disfrazado: un correo que no sale, sin más. Aquí cada paso se
  mira por separado y dice qué hay que arreglar.

  Uso:  npm run compras:graph  [número de pedido]  [código de empresa]

  Solo lee. No crea borradores, no manda correos y no marca nada.
*/
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/)
    .filter((linea) => linea.includes("=") && !linea.trim().startsWith("#"))
    .map((linea) => [linea.slice(0, linea.indexOf("=")).trim(), linea.slice(linea.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]),
) as Record<string, string>;

const GRAPH = "https://graph.microsoft.com/v1.0";
const numeroPedido = process.argv[2];
const empresa = process.argv[3] ?? "1";

let mal = 0;
const ok = (titulo: string, bien: boolean, detalle: string) => {
  if (!bien) mal++;
  console.log(`  ${bien ? "OK  " : "MAL "} ${titulo}: ${detalle}`);
};

// ---------- 1. Las variables ----------
const faltan = ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MS_COMPRAS_MAILBOX"].filter((nombre) => !env[nombre]);
ok("están las cuatro variables", faltan.length === 0, faltan.length ? `faltan ${faltan.join(", ")}` : "tenant, cliente, secreto y buzón");
if (faltan.length) {
  console.log("\nSin eso no se puede seguir. Van en .env.local y en Vercel, nunca en el repositorio.");
  process.exit(1);
}
const buzon = env.MS_COMPRAS_MAILBOX;
console.log(`  ·    buzón: ${buzon}`);

// ---------- 2. El token ----------
const respuestaToken = await fetch(`https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: env.MS_CLIENT_ID,
    client_secret: env.MS_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  }),
});
const datosToken = await respuestaToken.json() as { access_token?: string; error_description?: string };
ok("Microsoft da el token", Boolean(datosToken.access_token), datosToken.access_token
  ? "credenciales correctas"
  : (datosToken.error_description ?? "").split("\n")[0].slice(0, 160));
if (!datosToken.access_token) {
  console.log("\nSi pone AADSTS7000215, el secreto está mal o ha caducado.");
  console.log("Si pone AADSTS700016, el id de cliente no es de este inquilino.");
  process.exit(1);
}

const cabeceras = { Authorization: `Bearer ${datosToken.access_token}` };

// ---------- 3. Entrar en el buzón ----------
const respuestaBuzon = await fetch(`${GRAPH}/users/${encodeURIComponent(buzon)}/mailFolders/inbox?$select=displayName,totalItemCount`, { headers: cabeceras });
const cuerpoBuzon = await respuestaBuzon.json() as { displayName?: string; totalItemCount?: number; error?: { code?: string; message?: string } };
ok("se puede leer el buzón", respuestaBuzon.ok, respuestaBuzon.ok
  ? `${cuerpoBuzon.displayName} · ${cuerpoBuzon.totalItemCount} correos`
  : `${cuerpoBuzon.error?.code}: ${(cuerpoBuzon.error?.message ?? "").slice(0, 130)}`);
if (!respuestaBuzon.ok) {
  if (cuerpoBuzon.error?.code === "ErrorAccessDenied") {
    console.log("\nAcceso denegado. O falta el consentimiento de administrador para Mail.ReadWrite,");
    console.log("o la ApplicationAccessPolicy no incluye este buzón. Compruébalo con:");
    console.log(`  Test-ApplicationAccessPolicy -Identity ${buzon} -AppId ${env.MS_CLIENT_ID}`);
  }
  process.exit(1);
}

// ---------- 4. Que la política esté puesta ----------
// Si se puede leer OTRO buzón, la aplicación tiene acceso a toda la empresa.
const otro = process.env.MS_BUZON_DE_CONTROL ?? `direccion@${buzon.split("@")[1]}`;
const respuestaOtro = await fetch(`${GRAPH}/users/${encodeURIComponent(otro)}/mailFolders/inbox?$select=displayName`, { headers: cabeceras });
const cuerpoOtro = await respuestaOtro.json() as { error?: { code?: string } };
const denegado = !respuestaOtro.ok;
ok("y NO se puede leer ningún otro", denegado,
  denegado
    ? `${otro} responde ${cuerpoOtro.error?.code ?? respuestaOtro.status}, que es lo que debe pasar`
    : `¡SE PUEDE LEER ${otro}! La aplicación entra en todos los buzones de la empresa`);
if (!denegado) {
  console.log("\n  Falta la ApplicationAccessPolicy, o no se ha aplicado todavía (tarda hasta 1 h).");
  console.log("  Hasta que ese comprobante dé error, NO pongáis esto en producción.");
}

// ---------- 5. Encontrar el hilo de un pedido ----------
const patron = (() => {
  try {
    const mapa = JSON.parse(env.MS_COMPRAS_ASUNTOS ?? "{}") as Record<string, string>;
    return mapa[empresa] ?? env.MS_COMPRAS_ASUNTO_PEDIDO ?? null;
  } catch {
    return env.MS_COMPRAS_ASUNTO_PEDIDO ?? null;
  }
})();
ok("hay patrón de asunto para esa empresa", Boolean(patron), patron ?? "ni MS_COMPRAS_ASUNTOS ni MS_COMPRAS_ASUNTO_PEDIDO");

if (patron && numeroPedido) {
  const asunto = patron.replace("{numero}", numeroPedido);
  const busqueda = encodeURIComponent(`"subject:${asunto}"`);
  const respuestaBusqueda = await fetch(`${GRAPH}/users/${encodeURIComponent(buzon)}/messages?$search=${busqueda}&$select=id,subject,toRecipients,sentDateTime&$top=25`, { headers: cabeceras });
  const datos = await respuestaBusqueda.json() as { value?: { subject?: string; sentDateTime?: string; toRecipients?: { emailAddress?: { address?: string } }[] }[]; error?: { message?: string } };
  if (!respuestaBusqueda.ok) {
    ok(`se encuentra el pedido ${numeroPedido}`, false, (datos.error?.message ?? "").slice(0, 150));
  } else {
    const encontrados = datos.value ?? [];
    const exacto = new RegExp(`${asunto.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\d)`, "i");
    const candidatos = encontrados.filter((m) => exacto.test(m.subject ?? ""))
      .sort((a, b) => (a.sentDateTime ?? "").localeCompare(b.sentDateTime ?? ""));
    ok(`se encuentra el correo del pedido ${numeroPedido}`, candidatos.length > 0,
      candidatos.length > 0
        ? `"${candidatos[0].subject}" del ${(candidatos[0].sentDateTime ?? "").slice(0, 10)}`
        : `la búsqueda devolvió ${encontrados.length} correos y ninguno encaja con "${asunto}"`);
    if (candidatos.length > 0) {
      const para = (candidatos[0].toRecipients ?? []).map((d) => d.emailAddress?.address).filter(Boolean);
      ok("y se sabe a quién responderle", para.length > 0, para.join(", ") || "el correo original no tiene destinatario");
      if (candidatos.length > 1) console.log(`  ·    hay ${candidatos.length} con ese asunto (el resto serán reclamaciones nuestras); se usa el más antiguo`);
    } else if (encontrados.length > 0) {
      console.log("  ·    asuntos que sí devolvió, por si el patrón es otro:");
      for (const m of encontrados.slice(0, 5)) console.log(`         ${m.subject}`);
    }
  }
} else if (patron) {
  console.log("  ·    pásale un número de pedido para probar la búsqueda del hilo");
}

console.log(mal === 0 ? "\nTODO CORRECTO: se puede mandar desde el buzón." : `\n${mal} cosas por arreglar.`);
process.exit(mal === 0 ? 0 : 1);
