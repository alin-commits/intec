/**
 * Never surface raw Supabase/Postgres error text to the user (can leak table
 * or constraint names). Logs the real error to the console outside
 * production for local debugging, and always returns the safe fallback.
 */
export function reportSafeError(error: unknown, fallback: string): string {
  if (process.env.NODE_ENV !== "production") {
    console.error(error);
  }
  return fallback;
}
