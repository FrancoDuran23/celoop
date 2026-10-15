import { timingSafeEqual } from "node:crypto";

/** `Authorization: Bearer <secret>`, compared in constant time. False when no secret is configured. */
export function bearerMatches(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
