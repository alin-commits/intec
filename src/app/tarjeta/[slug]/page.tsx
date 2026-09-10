import { notFound } from "next/navigation";
import { businessUnits as demoBusinessUnits, demoBusinessCards } from "@/lib/demo-data";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { createClient as createServerClient } from "@/lib/supabase/server";
import type { BusinessCard, BusinessUnit } from "@/lib/types";
import { CardActions } from "@/components/card-actions";

type TarjetaPageProps = { params: Promise<{ slug: string }> };

function PhoneIcon() {
  return <svg viewBox="0 0 20 20" fill="none"><path d="M4 3.5h3l1.2 3.3-1.7 1.4a9 9 0 0 0 4.3 4.3l1.4-1.7 3.3 1.2v3a1.5 1.5 0 0 1-1.6 1.5A13 13 0 0 1 3 5.1 1.5 1.5 0 0 1 4 3.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
}
function EmailIcon() {
  return <svg viewBox="0 0 20 20" fill="none"><rect x="2.8" y="4.5" width="14.4" height="11" rx="1.8" stroke="currentColor" strokeWidth="1.4" /><path d="m3.4 5.3 6.6 5.2 6.6-5.2" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
}
function WebIcon() {
  return <svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.2" stroke="currentColor" strokeWidth="1.4" /><path d="M2.8 10h14.4M10 2.8c1.9 2 2.9 4.6 2.9 7.2s-1 5.2-2.9 7.2c-1.9-2-2.9-4.6-2.9-7.2s1-5.2 2.9-7.2Z" stroke="currentColor" strokeWidth="1.4" /></svg>;
}
function PinIcon() {
  return <svg viewBox="0 0 20 20" fill="none"><path d="M10 17.5s5.6-4.9 5.6-9.3a5.6 5.6 0 1 0-11.2 0c0 4.4 5.6 9.3 5.6 9.3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><circle cx="10" cy="8.2" r="2" stroke="currentColor" strokeWidth="1.4" /></svg>;
}
function InstagramIcon() {
  return <svg viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="14" rx="4" stroke="currentColor" strokeWidth="1.4" /><circle cx="10" cy="10" r="3.3" stroke="currentColor" strokeWidth="1.4" /><circle cx="14.3" cy="5.7" r="0.9" fill="currentColor" /></svg>;
}
function FacebookIcon() {
  return <svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7.2" stroke="currentColor" strokeWidth="1.4" /><path d="M11.6 8.4V7.1c0-.6.4-1 1-1h1V4.2h-1.5c-1.6 0-2.7 1.1-2.7 2.8v1.4H8v2h1.4v5.4h2.2V10.4h1.5l.3-2h-1.8Z" fill="currentColor" /></svg>;
}
function LinkedinIcon() {
  return <svg viewBox="0 0 20 20" fill="none"><rect x="3" y="3" width="14" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.4" /><circle cx="6.6" cy="6.8" r="0.9" fill="currentColor" /><path d="M6.6 9.2v4.4M9.9 13.6V10.8c0-1 .6-1.6 1.5-1.6s1.4.6 1.4 1.6v2.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

function mapCardRow(row: Record<string, unknown>): BusinessCard {
  return {
    id: String(row.id),
    businessUnitId: String(row.business_unit_id),
    slug: String(row.slug),
    fullName: String(row.full_name),
    position: String(row.position),
    phone: row.phone ? String(row.phone) : null,
    email: row.email ? String(row.email) : null,
    website: row.website ? String(row.website) : null,
    companyAddress: row.company_address ? String(row.company_address) : null,
    instagramUrl: row.instagram_url ? String(row.instagram_url) : null,
    facebookUrl: row.facebook_url ? String(row.facebook_url) : null,
    linkedinUrl: row.linkedin_url ? String(row.linkedin_url) : null,
    primaryColor: row.primary_color ? String(row.primary_color) : "#2563eb",
    active: Boolean(row.is_active),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
  };
}

async function loadCard(slug: string): Promise<{ card: BusinessCard; unit: BusinessUnit } | null> {
  if (!isSupabaseConfigured()) {
    const card = demoBusinessCards.find((item) => item.slug === slug && item.active);
    const unit = card ? demoBusinessUnits.find((item) => item.id === card.businessUnitId) : undefined;
    return card && unit ? { card, unit } : null;
  }
  const supabase = await createServerClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("business_cards")
    .select("*, business_units(id, name, slug, brand_color, logo_url)")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (!data) return null;
  const unitRow = data.business_units as Record<string, unknown> | null;
  if (!unitRow) return null;
  return {
    card: mapCardRow(data as Record<string, unknown>),
    unit: {
      id: String(unitRow.id), name: String(unitRow.name), slug: String(unitRow.slug),
      accent: unitRow.brand_color ? String(unitRow.brand_color) : "#2563eb",
      active: true, logo: unitRow.logo_url ? String(unitRow.logo_url) : null,
      sortOrder: 0, visibleInConsultas: true, visibleInLeads: true,
    },
  };
}

export default async function TarjetaPage({ params }: TarjetaPageProps) {
  const { slug } = await params;
  const result = await loadCard(slug);
  if (!result) notFound();
  const { card, unit } = result;

  const rows: { icon: React.ReactNode; label: string; value: string }[] = [];
  if (card.phone) rows.push({ icon: <PhoneIcon />, label: "Teléfono / WhatsApp", value: card.phone });
  if (card.email) rows.push({ icon: <EmailIcon />, label: "Email", value: card.email });
  if (card.website) rows.push({ icon: <WebIcon />, label: "Web", value: card.website.replace(/^https?:\/\//, "") });
  if (card.companyAddress) rows.push({ icon: <PinIcon />, label: "Dirección", value: card.companyAddress });

  const socials: { href: string; icon: React.ReactNode; label: string }[] = [];
  if (card.instagramUrl) socials.push({ href: card.instagramUrl, icon: <InstagramIcon />, label: "Instagram" });
  if (card.facebookUrl) socials.push({ href: card.facebookUrl, icon: <FacebookIcon />, label: "Facebook" });
  if (card.linkedinUrl) socials.push({ href: card.linkedinUrl, icon: <LinkedinIcon />, label: "LinkedIn" });

  return (
    <main className="business-card-page">
      <div className="business-card" style={{ "--card-color": card.primaryColor } as React.CSSProperties}>
        <div className="business-card-header">
          {unit.logo ? <img className="business-card-logo" src={unit.logo} alt={unit.name} /> : null}
          <h1>{card.fullName}</h1>
          <p>{card.position}</p>
        </div>
        <div className="business-card-divider" />
        {rows.length > 0 ? (
          <div className="business-card-rows">
            {rows.map((row) => (
              <div className="business-card-row" key={row.label}>
                <span className="business-card-row-icon">{row.icon}</span>
                <span>
                  <span className="business-card-row-label">{row.label}</span>
                  <span className="business-card-row-value">{row.value}</span>
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <CardActions card={card} unitName={unit.name} />
        {socials.length > 0 ? (
          <div className="business-card-social-row">
            {socials.map((social) => (
              <a key={social.label} href={social.href} target="_blank" rel="noreferrer" className="business-card-social-icon" aria-label={social.label}>
                {social.icon}
              </a>
            ))}
          </div>
        ) : null}
      </div>
    </main>
  );
}
