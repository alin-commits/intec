/**
 * A qué buzones se pueden mandar las facturas. Es una lista cerrada a
 * propósito: la pantalla manda una clave de esta lista, nunca una dirección
 * escrita a mano, para que el envío no pueda acabar en cualquier correo.
 */
const INTEC = {
  key: "intec",
  label: "Suministros Intec",
  email: "facturasproveedor@suministrointec.com",
  /** Unidades cuyas facturas salen por aquí si no se elige otra cosa. */
  unitSlugs: ["suministros-intec", "blizzcool", "blizztherm", "sumifluid"],
} as const;

export const INVOICE_MAILBOXES = [
  INTEC,
  { key: "toolsplace", label: "Toolsplace", email: "administracion@toolsplace.es", unitSlugs: [] },
  { key: "cst", label: "CST Ibérica", email: "administracion@cstiberica.es", unitSlugs: ["cst-iberica"] },
  { key: "jender", label: "Jender", email: "admin@jender.es", unitSlugs: ["jender"] },
] as const;

export type InvoiceMailbox = (typeof INVOICE_MAILBOXES)[number];
export type InvoiceMailboxKey = InvoiceMailbox["key"];

/** El buzón al que se va cuando no se elige ninguno. */
export const DEFAULT_MAILBOX = INTEC;
export const DEFAULT_MAILBOX_KEY: InvoiceMailboxKey = INTEC.key;

/** Las claves admitidas, para validar lo que llega a la API. */
export const INVOICE_MAILBOX_KEYS = INVOICE_MAILBOXES.map((mailbox) => mailbox.key) as [InvoiceMailboxKey, ...InvoiceMailboxKey[]];

export function isMailboxKey(value: unknown): value is InvoiceMailboxKey {
  return INVOICE_MAILBOXES.some((mailbox) => mailbox.key === value);
}

/**
 * Deja marcada la empresa de la factura para no tener que elegirla cada vez.
 * Toolsplace no es una unidad de negocio, así que nunca sale sola: esa hay que
 * elegirla a mano.
 */
export function mailboxForUnit(unitSlug: string | null | undefined): InvoiceMailboxKey {
  if (!unitSlug) return DEFAULT_MAILBOX_KEY;
  const match = INVOICE_MAILBOXES.find((mailbox) => (mailbox.unitSlugs as readonly string[]).includes(unitSlug));
  return match?.key ?? DEFAULT_MAILBOX_KEY;
}
