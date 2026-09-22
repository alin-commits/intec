/**
 * Never surface raw Supabase/Postgres error text to the user (can leak table
 * or constraint names). Logs the real error to the console outside
 * production for local debugging, and always returns the safe fallback.
 */
/** Shown when secondary data failed to load but the page can still work with the rest. */
export const PARTIAL_LOAD_MESSAGE = "Algunos datos no se han podido cargar y ciertas cifras pueden salir incompletas. Recarga la página para reintentarlo.";

export function reportSafeError(error: unknown, fallback: string): string {
  if (process.env.NODE_ENV !== "production") {
    console.error(error);
  }
  return fallback;
}
