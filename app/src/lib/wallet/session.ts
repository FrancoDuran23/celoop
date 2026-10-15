// Who is on a signing page: the link's person, their passkey and their Safe. Server only.
import { desc, eq } from "drizzle-orm";
import type { Address, Hex } from "viem";
import type { Db } from "@/db";
import { passkeys } from "@/db/schema";
import type { PasskeyCredential } from "./account";
import { linkErrorMessage, resolveSignLink, type LinkPurpose, type ResolvedLink } from "./links";

export type PageSession =
  | { ok: true; link: ResolvedLink; credential: PasskeyCredential | null; safe: Address | null }
  | { ok: false; message: string };

export function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function pageSession(db: Db, token: string | null, purposes: LinkPurpose[]): Promise<PageSession> {
  const resolved = await resolveSignLink(db, token, { purposes });
  if (!resolved.ok) return { ok: false, message: linkErrorMessage(resolved.error) };
  const link = resolved.link;
  const rows = await db
    .select()
    .from(passkeys)
    .where(eq(passkeys.personId, link.person.id))
    .orderBy(desc(passkeys.id))
    .limit(1);
  const pk = rows[0];
  return {
    ok: true,
    link,
    credential: pk ? { id: pk.credentialId, publicKey: pk.publicKey as Hex } : null,
    safe: (link.person.safeAddress as Address | null) ?? (pk?.safeAddress as Address | undefined) ?? null,
  };
}

export const NO_PASSKEY_MESSAGE =
  "Todavía no creaste tu firma en este teléfono. Pedí el link de alta en el chat de la cooperadora.";
