import { after, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { appOrigin } from "@/lib/app-origin";
import { importMetaLead, type PageTokens } from "@/lib/meta/leads-import";
import { leadgenChanges, verifyMetaSignature } from "@/lib/meta/leadgen";
import { createAdminClient } from "@/lib/supabase/admin";

/*
  Donde avisa Meta cada vez que alguien rellena un formulario de clientes
  potenciales. Se configura en la aplicación de Meta (Webhooks → Page →
  leadgen) con esta dirección y la clave META_WEBHOOK_VERIFY_TOKEN.

  No tiene sesión (quien llama es Meta): cada aviso trae una firma hecha con
  el secreto de la aplicación (META_APP_SECRET) y sin ella no se hace nada.
  Se contesta enseguida y el lead se mete después: si Meta no recibe respuesta
  en unos segundos, repite el aviso.
*/

export const maxDuration = 60;

const sameText = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/** La comprobación que hace Meta al dar de alta el aviso: devuelve el reto si la clave coincide. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
  const received = params.get("hub.verify_token") ?? "";
  if (params.get("hub.mode") === "subscribe" && expected && sameText(received, expected)) {
    return new Response(params.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ error: "No autorizado." }, { status: 403 });
}

export async function POST(request: Request) {
  const secrets = (process.env.META_APP_SECRET ?? "").split(",").map((secret) => secret.trim()).filter(Boolean);
  if (secrets.length === 0) return NextResponse.json({ error: "Falta META_APP_SECRET." }, { status: 503 });
  const raw = await request.text();
  if (!verifyMetaSignature(raw, request.headers.get("x-hub-signature-256"), secrets)) {
    return NextResponse.json({ error: "Firma no válida." }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "No se pudo leer el aviso." }, { status: 400 });
  }
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });

  const changes = leadgenChanges(payload);
  const origin = appOrigin(request);
  after(async () => {
    const cache: PageTokens = new Map();
    for (const change of changes) {
      await importMetaLead(admin, { leadgenId: change.leadgenId, pageId: change.pageId, via: "aviso", origin }, cache);
    }
  });
  return NextResponse.json({ ok: true, received: changes.length });
}
