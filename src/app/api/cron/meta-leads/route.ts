import { after, NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-origin";
import { hasBearer, isAuthorizedCron } from "@/lib/cron-auth";
import { syncPagesAndLeads } from "@/lib/meta/leads-import";
import { createAdminClient } from "@/lib/supabase/admin";

/*
  La revisión de los formularios de Meta, cada hora.

  Los leads entran al momento por el aviso de Meta (/api/meta/leads); esto es
  la red de seguridad por si algún aviso se pierde. El plan gratuito de Vercel
  solo deja programar tareas una vez al día, así que a esta la llama cada hora
  la base de datos (pg_cron en Supabase) con su propia clave,
  META_LEADS_CRON_SECRET: si esa clave se filtrara, lo único que permite es
  lanzar esta revisión. También vale la clave general de las tareas.

  Contesta enseguida y revisa después: quien llama no se queda esperando.
*/

export const maxDuration = 300;

export async function GET(request: Request) {
  if (!hasBearer(request, process.env.META_LEADS_CRON_SECRET) && !isAuthorizedCron(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });
  const origin = appOrigin(request);
  after(async () => {
    try {
      await syncPagesAndLeads(admin, origin);
    } catch (cause) {
      console.error("Revisión de formularios de Meta:", cause);
    }
  });
  return NextResponse.json({ ok: true, started: true }, { status: 202 });
}
