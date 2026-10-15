// Passkey enrollment: stores the credential and the person's Safe address. Server only.
import { eq } from "drizzle-orm";
import { getAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import type { Db } from "@/db";
import { passkeys, persons } from "@/db/schema";
import { normalizePublicKey, type PasskeyCredential } from "./account";
import { linkErrorMessage, resolveSignLink, type LinkError } from "./links";

export const enrollRequestSchema = z.object({
  token: z.string().min(1).max(128),
  credentialId: z.string().min(1).max(1024).regex(/^[A-Za-z0-9_-]+$/),
  publicKey: z.string().regex(/^0x([0-9a-fA-F]{128}|04[0-9a-fA-F]{128})$/),
});
export type EnrollRequest = z.infer<typeof enrollRequestSchema>;

export type EnrollResult =
  | { ok: true; safeAddress: Address; personName: string }
  | { ok: false; status: number; error: LinkError | "invalid" | "already_enrolled" | "credential_taken"; message: string };

export type EnrollDeps = {
  db: Db;
  /** Counterfactual Safe address for a credential (passkeySafeAddress with the chain client). */
  computeSafeAddress: (credential: PasskeyCredential) => Promise<Address>;
  now?: Date;
};

/**
 * Validates an `enroll` (or `vendor`) link, recomputes the Safe address from the public key (the
 * browser's own computation is never trusted) and saves it. Idempotent for the same credential.
 */
export async function registerPasskey(input: unknown, deps: EnrollDeps): Promise<EnrollResult> {
  const parsed = enrollRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, status: 400, error: "invalid", message: "Datos incompletos." };
  const { token, credentialId } = parsed.data;
  const publicKey = normalizePublicKey(parsed.data.publicKey as Hex);

  const resolved = await resolveSignLink(deps.db, token, { purposes: ["enroll", "vendor"], now: deps.now });
  if (!resolved.ok) {
    return { ok: false, status: 403, error: resolved.error, message: linkErrorMessage(resolved.error) };
  }
  const person = resolved.link.person;

  const existing = await deps.db.select().from(passkeys).where(eq(passkeys.credentialId, credentialId)).limit(1);
  if (existing[0]) {
    if (existing[0].personId !== person.id) {
      return { ok: false, status: 409, error: "credential_taken", message: "Esa firma ya está registrada a nombre de otra persona." };
    }
    return { ok: true, safeAddress: getAddress(existing[0].safeAddress), personName: person.name };
  }

  const safeAddress = getAddress(await deps.computeSafeAddress({ id: credentialId, publicKey }));

  // One Safe per person: it is what the treasury lists as signer or pays as vendor. Replacing it
  // is an operator task (new signer proposal), not something a link can do.
  if (person.safeAddress && person.safeAddress.toLowerCase() !== safeAddress.toLowerCase()) {
    return {
      ok: false,
      status: 409,
      error: "already_enrolled",
      message: "Ya tenés una firma creada en otro dispositivo. Si lo perdiste, avisale a la comisión.",
    };
  }

  // No transaction: the Neon HTTP driver has none. Insert first; a retry is idempotent above.
  await deps.db.insert(passkeys).values({ personId: person.id, credentialId, publicKey, safeAddress });
  await deps.db.update(persons).set({ safeAddress }).where(eq(persons.id, person.id));
  return { ok: true, safeAddress, personName: person.name };
}
