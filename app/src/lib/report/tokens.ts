// The reviewer opens the draft with a one-time link (sign_links, purpose "review").
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { persons, signLinks } from "@/db/schema";

export const REVIEW_PURPOSE = "review";

export type TokenCheck =
  | { ok: true; personId: number; used: boolean }
  | { ok: false; reason: "missing" | "expired" | "wrong_period" | "not_reviewer" };

export async function checkReviewToken(db: Db, token: string | null | undefined, period: string, now = new Date()): Promise<TokenCheck> {
  if (!token) return { ok: false, reason: "missing" };
  const [link] = await db.select().from(signLinks).where(eq(signLinks.token, token));
  if (!link || link.purpose !== REVIEW_PURPOSE) return { ok: false, reason: "missing" };
  if (link.expiresAt <= now) return { ok: false, reason: "expired" };
  const target = (link.target ?? {}) as { period?: string };
  if (target.period && target.period !== period) return { ok: false, reason: "wrong_period" };
  const [person] = await db.select().from(persons).where(eq(persons.id, link.personId));
  if (!person || !person.roles.includes("revisor")) return { ok: false, reason: "not_reviewer" };
  return { ok: true, personId: person.id, used: link.usedAt !== null };
}
