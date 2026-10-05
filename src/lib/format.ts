export const currencyFormatter = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  // Spanish style skips the separator for 4 digits ("1234,56 €"); always grouping keeps columns consistent.
  useGrouping: "always",
} as Intl.NumberFormatOptions);

export const numberFormatter = new Intl.NumberFormat("es-ES");

/**
 * El nombre que se enseña de una persona. Hay perfiles cuyo nombre es su correo
 * ("alin@suministrointec.com"): de esos se enseña la parte de delante, "Alin".
 */
export function displayName(name: string): string {
  if (!name.includes("@")) return name;
  const local = name.split("@")[0] ?? name;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1).replace(".", ",")} %`;
}

/** Día y hora de Madrid: "30/09/2026, 16:24". */
export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(new Date(value));
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Madrid",
  }).format(new Date(value));
}
