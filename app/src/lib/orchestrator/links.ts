// One-time links sent over Telegram (sign_links) and the URLs they open.
// Pages: /firmar/alta, /firmar/pago/<id>, /firmar/proponer and /proveedor are module 04;
// /rendicion/<period>?token= is module 05.
import { randomBytes } from "node:crypto";
import type { Db } from "@/db";
import { signLinks } from "@/db/schema";
import { coopQuery, scopeId } from "@/lib/tenant";

export type LinkPurpose = "enroll" | "sign" | "vendor" | "review";

export type LinkTarget =
  | { paymentId: string }
  | { proposalId: string }
  | { action: "propose" }
  | { period: string }
  | null;

export const LINK_TTL_MS = 24 * 60 * 60 * 1000;
/** The reviewer may take a few days to go over the draft. */
export const REVIEW_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createLink(
  db: Db,
  args: { personId: number; purpose: LinkPurpose; target?: LinkTarget; ttlMs?: number; now?: Date; cooperadoraId?: number },
): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  const now = args.now ?? new Date();
  await db.insert(signLinks).values({
    token,
    personId: args.personId,
    purpose: args.purpose,
    target: args.target ?? null,
    // The page the link opens works on this cooperative's treasury.
    cooperadoraId: scopeId(args.cooperadoraId),
    expiresAt: new Date(now.getTime() + (args.ttlMs ?? LINK_TTL_MS)),
  });
  return token;
}

const base = (appUrl: string) => appUrl.replace(/\/+$/, "");
const q = (token: string) => encodeURIComponent(token);

export const urls = {
  panel: (appUrl: string, cooperadoraId?: number) => `${base(appUrl)}/ledger${coopQuery(cooperadoraId)}`,
  enroll: (appUrl: string, token: string) => `${base(appUrl)}/firmar/alta?t=${q(token)}`,
  payment: (appUrl: string, paymentId: bigint | string, token: string) =>
    `${base(appUrl)}/firmar/pago/${paymentId}?t=${q(token)}`,
  propose: (appUrl: string, token: string) => `${base(appUrl)}/firmar/proponer?t=${q(token)}`,
  vendor: (appUrl: string, token: string) => `${base(appUrl)}/proveedor?t=${q(token)}`,
  report: (appUrl: string, period: string, token?: string, cooperadoraId?: number) =>
    `${base(appUrl)}/rendicion/${period}${token ? `?token=${q(token)}` : ""}${coopQuery(cooperadoraId, token ? "&" : "?")}`,
  /** The auditor's public report on a payment. `c` picks the cooperative, since payment ids overlap. */
  audit: (appUrl: string, paymentId: bigint | string, cooperadoraId?: number) =>
    `${base(appUrl)}/auditoria/${paymentId}${coopQuery(cooperadoraId)}`,
};

/** Link for a signer to approve or reject a pending payment. Single use, 24 hours. */
export async function paymentSignUrl(db: Db, appUrl: string, personId: number, paymentId: bigint, now?: Date, cooperadoraId?: number) {
  const token = await createLink(db, { personId, purpose: "sign", target: { paymentId: paymentId.toString() }, now, cooperadoraId });
  return urls.payment(appUrl, paymentId, token);
}

export async function enrollUrl(db: Db, appUrl: string, personId: number, now?: Date, cooperadoraId?: number) {
  return urls.enroll(appUrl, await createLink(db, { personId, purpose: "enroll", now, cooperadoraId }));
}

export async function proposeUrl(db: Db, appUrl: string, personId: number, now?: Date, cooperadoraId?: number) {
  const token = await createLink(db, { personId, purpose: "sign", target: { action: "propose" }, now, cooperadoraId });
  return urls.propose(appUrl, token);
}

export async function vendorUrl(db: Db, appUrl: string, personId: number, now?: Date, cooperadoraId?: number) {
  return urls.vendor(appUrl, await createLink(db, { personId, purpose: "vendor", now, cooperadoraId }));
}

export async function reviewUrl(db: Db, appUrl: string, personId: number, period: string, now?: Date, cooperadoraId?: number) {
  const token = await createLink(db, {
    personId,
    purpose: "review",
    target: { period },
    ttlMs: REVIEW_LINK_TTL_MS,
    now,
    cooperadoraId,
  });
  return urls.report(appUrl, period, token, cooperadoraId);
}
