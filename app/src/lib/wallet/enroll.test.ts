import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { createTestDb } from "@/db/testing";
import { passkeys, persons } from "@/db/schema";
import { registerPasskey, type EnrollDeps } from "./enroll";
import { SIGNER_SAFE, VENDOR_SAFE, seedLink, seedPerson } from "./testing/fixtures";

const KEY = `0x${"12".repeat(32)}${"34".repeat(32)}`;
let db: Db;
let deps: EnrollDeps;
let computed: string[];

beforeEach(async () => {
  db = await createTestDb();
  computed = [];
  deps = {
    db,
    computeSafeAddress: async (c) => {
      computed.push(c.publicKey);
      return SIGNER_SAFE.toLowerCase() as `0x${string}`;
    },
  };
}, 60_000);

describe("registerPasskey", () => {
  it("saves the passkey and the Safe the server computed, never the browser's", async () => {
    const person = await seedPerson(db, { name: "Ana" });
    const token = await seedLink(db, person.id, "enroll");
    const r = await registerPasskey({ token, credentialId: "abc_DEF-1", publicKey: KEY, safeAddress: VENDOR_SAFE }, deps);
    expect(r).toEqual({ ok: true, safeAddress: SIGNER_SAFE, personName: "Ana" });
    expect(computed).toEqual([`0x04${KEY.slice(2)}`]);
    const [pk] = await db.select().from(passkeys);
    expect(pk).toMatchObject({ personId: person.id, credentialId: "abc_DEF-1", publicKey: `0x04${KEY.slice(2)}`, safeAddress: SIGNER_SAFE });
    const [p] = await db.select().from(persons).where(eq(persons.id, person.id));
    expect(p.safeAddress).toBe(SIGNER_SAFE);
  });

  it("is idempotent for the same credential, and the enroll link can be reused", async () => {
    const person = await seedPerson(db);
    const token = await seedLink(db, person.id, "enroll");
    await registerPasskey({ token, credentialId: "abc", publicKey: KEY }, deps);
    const again = await registerPasskey({ token, credentialId: "abc", publicKey: KEY }, deps);
    expect(again.ok).toBe(true);
    expect(await db.select().from(passkeys)).toHaveLength(1);
  });

  it("won't replace a Safe the person already has", async () => {
    const person = await seedPerson(db, { safe: VENDOR_SAFE });
    const token = await seedLink(db, person.id, "enroll");
    const r = await registerPasskey({ token, credentialId: "new", publicKey: KEY }, deps);
    expect(r).toMatchObject({ ok: false, status: 409, error: "already_enrolled" });
  });

  it("won't register another person's credential", async () => {
    const ana = await seedPerson(db, { name: "Ana" });
    const beto = await seedPerson(db, { name: "Beto" });
    await registerPasskey({ token: await seedLink(db, ana.id, "enroll"), credentialId: "abc", publicKey: KEY }, deps);
    const r = await registerPasskey({ token: await seedLink(db, beto.id, "enroll"), credentialId: "abc", publicKey: KEY }, deps);
    expect(r).toMatchObject({ ok: false, status: 409, error: "credential_taken" });
  });

  it("rejects sign links, expired links and bad keys", async () => {
    const person = await seedPerson(db);
    const sign = await seedLink(db, person.id, "sign");
    expect(await registerPasskey({ token: sign, credentialId: "a", publicKey: KEY }, deps)).toMatchObject({ ok: false, error: "wrong_purpose" });
    const old = await seedLink(db, person.id, "enroll", null, { now: new Date(Date.now() - 48 * 3600_000) });
    expect(await registerPasskey({ token: old, credentialId: "a", publicKey: KEY }, deps)).toMatchObject({ ok: false, error: "expired" });
    const ok = await seedLink(db, person.id, "enroll");
    expect(await registerPasskey({ token: ok, credentialId: "a", publicKey: "0x1234" }, deps)).toMatchObject({ ok: false, status: 400 });
    expect(computed).toHaveLength(0);
  });
});
