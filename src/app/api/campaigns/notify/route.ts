import { NextResponse } from "next/server";
import { appOrigin } from "@/lib/app-origin";
import { hasAnyRole } from "@/lib/constants";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { formatDate } from "@/lib/format";
import { buildCampaignStatusEmail, isNotifiableCampaignStatus } from "@/lib/notification-emails";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/types";

const CAMPAIGN_EDIT_ROLES: AppRole[] = ["admin", "marketing"];

function datesLabel(start: string | null, end: string | null): string {
  if (start && end) return `${formatDate(start)} – ${formatDate(end)}`;
  if (start) return `Desde ${formatDate(start)}`;
  if (end) return `Hasta ${formatDate(end)}`;
  return "Sin fechas";
}

// Called by the campaigns page after a campaign becomes active, finished or
// archived: tells every active commercial and dirección user by email.
export async function POST(request: Request) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("roles, is_active").eq("id", user.id).maybeSingle();
  if (!profile?.is_active || !hasAnyRole(profile.roles as AppRole[], CAMPAIGN_EDIT_ROLES)) {
    return NextResponse.json({ error: "No tienes permiso." }, { status: 403 });
  }

  let campaignId: string | undefined;
  try {
    campaignId = ((await request.json()) as { campaignId?: string }).campaignId;
  } catch {
    return NextResponse.json({ error: "No se pudo leer la solicitud." }, { status: 400 });
  }
  if (!campaignId) return NextResponse.json({ error: "Falta la campaña." }, { status: 400 });
  if (!isEmailConfigured()) return NextResponse.json({ skipped: "El envío de correos no está configurado." });

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "El sistema no está disponible." }, { status: 503 });

  const { data: campaign } = await admin.from("campaigns").select("id, name, status, channel, start_date, end_date, business_units(name)").eq("id", campaignId).maybeSingle();
  if (!campaign) return NextResponse.json({ error: "Campaña no encontrada." }, { status: 404 });
  if (!isNotifiableCampaignStatus(campaign.status)) return NextResponse.json({ skipped: "Estado sin aviso." });

  const { data: recipients } = await admin.from("profiles").select("email").eq("is_active", true).overlaps("roles", ["commercial", "direction"]).not("email", "is", null);
  const emails = Array.from(new Set((recipients ?? []).map((row) => row.email as string)));
  if (emails.length === 0) return NextResponse.json({ skipped: "Sin destinatarios." });

  const unit = Array.isArray(campaign.business_units) ? campaign.business_units[0] : campaign.business_units;
  const sent = await sendEmail({
    to: emails,
    ...buildCampaignStatusEmail({
      campaignName: campaign.name,
      unitName: (unit as { name?: string } | null)?.name ?? "—",
      status: campaign.status,
      dates: datesLabel(campaign.start_date, campaign.end_date),
      channel: campaign.channel,
      url: `${appOrigin(request)}/campanas`,
    }),
  });
  return sent ? NextResponse.json({ sent: emails.length }) : NextResponse.json({ error: "No se pudo enviar el aviso." }, { status: 502 });
}
