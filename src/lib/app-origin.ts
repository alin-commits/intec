import "server-only";

/**
 * Base URL for links sent by email (invitations, password resets, tickets).
 * Never trust the request's Host header in production: a forged one would put
 * a valid reset/invite token inside a link to someone else's site.
 */
export function appOrigin(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (configured) return configured;
  // Set automatically by Vercel on every deployment.
  const vercelProduction = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProduction) return `https://${vercelProduction}`;
  if (process.env.NODE_ENV !== "production") return new URL(request.url).origin;
  throw new Error("Falta NEXT_PUBLIC_APP_URL: no se pueden generar enlaces seguros en los correos.");
}
