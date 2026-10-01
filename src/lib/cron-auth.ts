import "server-only";
import { timingSafeEqual } from "node:crypto";

/** Si la petición trae `Authorization: Bearer <secreto>`. Sin secreto configurado, nunca. */
export function hasBearer(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Vercel Cron calls scheduled routes with `Authorization: Bearer <CRON_SECRET>`.
 * Without the secret configured, scheduled routes refuse every request.
 */
export function isAuthorizedCron(request: Request): boolean {
  return hasBearer(request, process.env.CRON_SECRET);
}
