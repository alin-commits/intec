import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Vercel Cron calls scheduled routes with `Authorization: Bearer <CRON_SECRET>`.
 * Without the secret configured, scheduled routes refuse every request.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const received = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
