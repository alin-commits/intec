// Lo que se hace con un formulario de Meta antes de guardarlo como lead, sin
// hablar con Meta ni con la base: se puede probar tal cual. Solo usa node:crypto.
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Meta firma cada aviso con el secreto de la aplicación (cabecera
 * X-Hub-Signature-256: "sha256=<hex>"). Sin esto, cualquiera que conociera la
 * dirección podría meter leads falsos. Se aceptan varios secretos por si los
 * avisos llegan de más de una aplicación (una por portfolio).
 */
export function verifyMetaSignature(rawBody: string, header: string | null, secrets: string[]): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const received = Buffer.from(header.slice("sha256=".length), "hex");
  return secrets.some((secret) => {
    const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

export type LeadgenChange = { leadgenId: string; pageId: string | null; formId: string | null; adId: string | null };

/** Los formularios nuevos que trae un aviso de Meta (puede traer varios, o ninguno). */
export function leadgenChanges(payload: unknown): LeadgenChange[] {
  const changes: LeadgenChange[] = [];
  const entries = (payload as { entry?: unknown[] } | null)?.entry;
  if (!Array.isArray(entries)) return changes;
  for (const entry of entries) {
    const list = (entry as { changes?: unknown[] }).changes;
    if (!Array.isArray(list)) continue;
    for (const change of list) {
      const { field, value } = change as { field?: string; value?: Record<string, unknown> };
      if (field !== "leadgen" || !value?.leadgen_id) continue;
      changes.push({
        leadgenId: String(value.leadgen_id),
        pageId: value.page_id ? String(value.page_id) : null,
        formId: value.form_id ? String(value.form_id) : null,
        adId: value.ad_id ? String(value.ad_id) : null,
      });
    }
  }
  return changes;
}

export type MetaLeadField = { name: string; values?: string[] };

export type LeadDraft = {
  contactName: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  interest: string | null;
  /** Las preguntas propias del formulario, que van a las observaciones. */
  extras: { label: string; value: string }[];
};

/** Los campos que Meta rellena solo (nombre, correo…), con el nombre que les da. */
const STANDARD = new Set([
  "full_name", "first_name", "last_name", "email", "work_email", "phone_number", "work_phone_number",
  "city", "state", "province", "zip_code", "post_code", "country", "street_address",
  "company_name", "job_title", "date_of_birth", "gender",
]);
/** Una pregunta propia que habla de lo que le interesa. */
const INTEREST = /(product|interes|necesit|servicio|consulta|modelo|busca|equipo)/;

const valueOf = (field: MetaLeadField) => (field.values ?? []).map((value) => value.trim()).filter(Boolean).join(", ");
/** "¿qué_producto_le_interesa?" → "¿Qué producto le interesa?" */
const labelOf = (name: string) => {
  const text = name.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return text.replace(/^([¿¡]?)(.)/, (_, mark: string, letter: string) => `${mark}${letter.toUpperCase()}`);
};

export function leadFromFields(fields: MetaLeadField[]): LeadDraft {
  const byName = new Map<string, string>();
  for (const field of fields) {
    const value = valueOf(field);
    if (value) byName.set(field.name.toLowerCase(), value);
  }
  const get = (...names: string[]) => names.map((name) => byName.get(name)).find(Boolean) ?? null;
  const first = get("first_name");
  const last = get("last_name");
  const extras = fields
    .filter((field) => !STANDARD.has(field.name.toLowerCase()) && valueOf(field))
    .map((field) => ({ label: labelOf(field.name), value: valueOf(field) }));
  const interestField = fields.find((field) => !STANDARD.has(field.name.toLowerCase()) && INTEREST.test(field.name.toLowerCase()) && valueOf(field));
  const place = [get("city"), get("province", "state"), get("zip_code", "post_code")].filter(Boolean);
  return {
    contactName: get("full_name") ?? ([first, last].filter(Boolean).join(" ") || null),
    company: get("company_name"),
    email: get("email", "work_email")?.toLowerCase() ?? null,
    phone: get("phone_number", "work_phone_number"),
    location: place.length > 0 ? place.join(", ") : null,
    interest: interestField ? valueOf(interestField) : null,
    extras,
  };
}

/**
 * Las observaciones de un lead de Meta: de qué formulario y anuncio viene,
 * cuándo entró en Meta y lo que contestó a las preguntas propias.
 */
export function leadNotes(draft: LeadDraft, meta: { formName?: string | null; adName?: string | null; platform?: string | null; createdTime?: string | null }): string {
  const origin = [
    meta.formName ? `formulario «${meta.formName}»` : "formulario",
    meta.adName ? `anuncio «${meta.adName}»` : null,
    meta.platform ? (meta.platform === "ig" ? "Instagram" : meta.platform === "fb" ? "Facebook" : meta.platform) : null,
  ].filter(Boolean).join(", ");
  const when = meta.createdTime ? formatMadrid(meta.createdTime) : null;
  const lines = [`Entró por Meta Ads: ${origin}${when ? `, el ${when}` : ""}.`];
  for (const extra of draft.extras) lines.push(`${extra.label}: ${extra.value}`);
  return lines.join("\n");
}

function formatMadrid(value: string): string {
  const date = new Date(value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * Un teléfono comparable: solo los 9 últimos dígitos, que es el número en
 * España con o sin +34 delante. Para no meter dos veces a quien ya se apuntó a
 * mano con el teléfono escrito de otra forma.
 */
export function comparablePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}
