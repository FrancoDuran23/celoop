// The reviewer opens the draft with a one-time link (sign_links, purpose "review").
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { signLinks } from "@/db/schema";
import { personInCooperadora } from "@/lib/orchestrator/people";
import { scopeId } from "@/lib/tenant";

export const REVIEW_PURPOSE = "review";

export type TokenCheck =
  | { ok: true; personId: number; used: boolean; cooperadoraId: number }
  | { ok: false; reason: "missing" | "expired" | "wrong_period" | "wrong_cooperadora" | "not_reviewer" };

/**
 * A reviewer's link for `period`. The link names its cooperative; with `cooperadoraId` it must be
 * that one, and the person has to be a revisor there (not in some other cooperative).
 */
export async function checkReviewToken(
  db: Db,
  token: string | null | undefined,
  period: string,
  now = new Date(),
  cooperadoraId?: number,
): Promise<TokenCheck> {
  if (!token) return { ok: false, reason: "missing" };
  const [link] = await db.select().from(signLinks).where(eq(signLinks.token, token));
  if (!link || link.purpose !== REVIEW_PURPOSE) return { ok: false, reason: "missing" };
  if (link.expiresAt <= now) return { ok: false, reason: "expired" };
  const target = (link.target ?? {}) as { period?: string };
  if (target.period && target.period !== period) return { ok: false, reason: "wrong_period" };
  const coop = scopeId(link.cooperadoraId);
  if (cooperadoraId != null && coop !== cooperadoraId) return { ok: false, reason: "wrong_cooperadora" };
  const person = await personInCooperadora(db, link.personId, coop);
  if (!person || !person.roles.includes("revisor")) return { ok: false, reason: "not_reviewer" };
  return { ok: true, personId: person.id, used: link.usedAt !== null, cooperadoraId: coop };
}
