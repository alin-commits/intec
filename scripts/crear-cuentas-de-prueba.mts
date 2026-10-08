/*
  Las cuentas de prueba: una por rol, para mirar la aplicación con los ojos de
  cada uno desde el chip de la esquina, sin pedirle a nadie su contraseña.

  Se ejecuta a mano, después de la migración 202610080008, y se puede repetir:
  si la cuenta ya existe solo se repasan su nombre, su rol y su marca.

  No imprime ninguna contraseña: no hace falta saberlas. La aplicación entra en
  estas cuentas con un enlace de un solo uso que pide el servidor, y la clave
  con la que nacen es aleatoria y no se guarda en ninguna parte.

  Necesita .env.local con la clave de servicio.
*/
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.trim().startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])) as Record<string, string>;
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const CUENTAS = [
  { rol: "commercial", nombre: "Comercial (prueba)", correo: "pruebas.comercial@suministrointec.com", conMarcas: true },
  { rol: "marketing", nombre: "Marketing (prueba)", correo: "pruebas.marketing@suministrointec.com", conMarcas: false },
  { rol: "direction", nombre: "Dirección (prueba)", correo: "pruebas.direccion@suministrointec.com", conMarcas: false },
  { rol: "it", nombre: "Informática (prueba)", correo: "pruebas.informatica@suministrointec.com", conMarcas: false },
  { rol: "accounting", nombre: "Administración (prueba)", correo: "pruebas.administracion@suministrointec.com", conMarcas: false },
  { rol: "employee", nombre: "Empleado (prueba)", correo: "pruebas.empleado@suministrointec.com", conMarcas: false },
] as const;

const columna = await admin.from("profiles").select("is_preview").limit(1);
if (columna.error) {
  console.log(`Falta la migración 202610080008: la columna is_preview no existe (${columna.error.code}). No se crea nada.`);
  process.exit(1);
}

const { data: unidades } = await admin.from("business_units").select("id").eq("is_active", true);
const todasLasMarcas = (unidades ?? []).map((u) => String(u.id));

for (const cuenta of CUENTAS) {
  // ¿Existe ya? La lista de usuarios de auth se busca por correo.
  const { data: lista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existente = (lista?.users ?? []).find((u) => u.email?.toLowerCase() === cuenta.correo);

  let id: string;
  if (existente) {
    id = existente.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: cuenta.correo,
      password: `${crypto.randomUUID()}${crypto.randomUUID()}`,
      email_confirm: true,
    });
    if (error) { console.log(`  ${cuenta.nombre}: ERROR al crear (${error.message})`); continue; }
    id = data.user.id;
  }

  const { error: errorPerfil } = await admin.from("profiles").upsert({
    id,
    email: cuenta.correo,
    full_name: cuenta.nombre,
    roles: [cuenta.rol],
    is_active: true,
    is_preview: true,
  });
  if (errorPerfil) { console.log(`  ${cuenta.nombre}: ERROR en el perfil (${errorPerfil.message})`); continue; }

  // El comercial ve solo sus marcas: sin ninguna asignada la prueba no
  // enseñaría el caso normal, sino el de una cuenta a medio configurar.
  if (cuenta.conMarcas && todasLasMarcas.length) {
    await admin.from("profile_business_units").upsert(
      todasLasMarcas.map((unidad) => ({ profile_id: id, business_unit_id: unidad })),
      { onConflict: "profile_id,business_unit_id" },
    );
  }

  console.log(`  ${existente ? "al día" : "creada"}: ${cuenta.nombre} · rol ${cuenta.rol}${cuenta.conMarcas ? ` · ${todasLasMarcas.length} marcas` : ""}`);
}

const { data: finales } = await admin.from("profiles").select("full_name, roles").eq("is_preview", true).order("full_name");
console.log(`\n${(finales ?? []).length} cuentas de prueba en la base:`);
for (const fila of finales ?? []) console.log(`  · ${fila.full_name} (${(fila.roles as string[]).join(", ")})`);
