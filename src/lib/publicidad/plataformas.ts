/**
 * Las plataformas de publicidad, en un solo sitio.
 *
 * Hasta ahora solo había Meta y por eso su nombre estaba escrito por todas
 * partes: tablas, paneles, etiquetas de exportación. Cuando entre LinkedIn Ads
 * lo único que debería ser suyo es lo que se sincroniza de su API; todo lo que
 * se mira —dashboards, campañas, informes— habla de "plataforma" y ya.
 */

export type AdsPlatform = "meta" | "linkedin";

export const adsPlatformOrder: AdsPlatform[] = ["meta", "linkedin"];

export const adsPlatformLabels: Record<AdsPlatform, string> = {
  meta: "Meta Ads",
  linkedin: "LinkedIn Ads",
};

/**
 * Las que se traen solas de su API. El resto se apunta a mano en ads_entries
 * hasta que tengan su espejo, y de ahí salen sus números.
 */
export const adsPlatformsSincronizadas: AdsPlatform[] = ["meta"];

export function esAdsPlatform(valor: unknown): valor is AdsPlatform {
  return valor === "meta" || valor === "linkedin";
}

/**
 * De qué plataforma de anuncios vino un lead, o null si no vino de ninguna
 * (lo apuntó un comercial, llegó por el formulario de la web, por teléfono...).
 *
 * Hoy solo Meta deja su marca en el lead. Cuando LinkedIn entre, traerá la suya
 * y bastará con mirarla aquí: todo lo que cuenta el coste por lead pasa por
 * esta función.
 */
export function plataformaDeLead(lead: { metaLeadId?: string | null }): AdsPlatform | null {
  return lead.metaLeadId ? "meta" : null;
}

/** Lo guardado puede ser cualquier cosa si alguien tocó la base a mano. */
export function adsPlatformDe(valor: unknown): AdsPlatform {
  return esAdsPlatform(valor) ? valor : "meta";
}
