import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/** Internal calls (the tick) send TICK_SECRET as a bearer token or in x-tick-secret. */
export function isTickAuthorized(request: Request): boolean {
  const secret = env().TICK_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  const given = request.headers.get("x-tick-secret") ?? (header?.startsWith("Bearer ") ? header.slice(7) : "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
