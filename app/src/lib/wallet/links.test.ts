import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { createTestDb } from "@/db/testing";
import { consumeSignLink, linkAllows, linkOwnsSafe, resolveSignLink } from "./links";
import { SIGNER_SAFE, VENDOR_SAFE, seedLink, seedPerson } from "./testing/fixtures";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
}, 60_000);

const HOUR = 60 * 60 * 1000;

describe("sign links", () => {
  it("resolves a fresh link to its person", async () => {
    const person = await seedPerson(db, { name: "Ana", safe: SIGNER_SAFE });
    const token = await seedLink(db, person.id, "sign", { paymentId: "3" });
    const r = await resolveSignLink(db, token, { purposes: ["sign"] });
    expect(r.ok && r.link.person).toMatchObject({ id: person.id, name: "Ana", safeAddress: SIGNER_SAFE });
    expect(r.ok && r.link.target).toEqual({ paymentId: "3" });
  });

  it("rejects an expired link", async () => {
    const person = await seedPerson(db);
    const token = await seedLink(db, person.id, "sign", null, { now: new Date(Date.now() - 25 * HOUR) });
    expect(await resolveSignLink(db, token, { purposes: ["sign"] })).toEqual({ ok: false, error: "expired" });
  });

  it("a sign link is single use; reads can still see it", async () => {
    const person = await seedPerson(db, { safe: SIGNER_SAFE });
    const token = await seedLink(db, person.id, "sign", { paymentId: "1" });
    const r = await resolveSignLink(db, token, { purposes: ["sign"] });
    if (!r.ok) throw new Error("expected a valid link");
    expect(await consumeSignLink(db, r.link)).toBe(true);
    expect(await consumeSignLink(db, r.link)).toBe(false);
    expect(await resolveSignLink(db, token, { purposes: ["sign"] })).toEqual({ ok: false, error: "used" });
    expect((await resolveSignLink(db, token, { purposes: ["sign"], allowUsed: true })).ok).toBe(true);
  });

  it("enroll and vendor links can be reused until they expire", async () => {
    const person = await seedPerson(db);
    for (const purpose of ["enroll", "vendor"] as const) {
      const token = await seedLink(db, person.id, purpose);
      const r = await resolveSignLink(db, token, { purposes: [purpose] });
      if (!r.ok) throw new Error("expected a valid link");
      expect(await consumeSignLink(db, r.link)).toBe(true);
      expect((await resolveSignLink(db, token, { purposes: [purpose] })).ok).toBe(true);
      const later = new Date(Date.now() + 25 * HOUR);
      expect(await resolveSignLink(db, token, { purposes: [purpose], now: later })).toEqual({ ok: false, error: "expired" });
    }
  });

  it("rejects unknown tokens and the wrong purpose", async () => {
    const person = await seedPerson(db);
    const token = await seedLink(db, person.id, "enroll");
    expect(await resolveSignLink(db, "nope", { purposes: ["sign"] })).toEqual({ ok: false, error: "not_found" });
    expect(await resolveSignLink(db, null, { purposes: ["sign"] })).toEqual({ ok: false, error: "not_found" });
    expect(await resolveSignLink(db, token, { purposes: ["sign"] })).toEqual({ ok: false, error: "wrong_purpose" });
  });

  it("another person's link doesn't own my Safe", async () => {
    const ana = await seedPerson(db, { name: "Ana", safe: SIGNER_SAFE });
    await seedPerson(db, { name: "Beto", safe: VENDOR_SAFE });
    const r = await resolveSignLink(db, await seedLink(db, ana.id, "sign"), { purposes: ["sign"] });
    if (!r.ok) throw new Error("expected a valid link");
    expect(linkOwnsSafe(r.link, SIGNER_SAFE.toLowerCase())).toBe(true);
    expect(linkOwnsSafe(r.link, VENDOR_SAFE)).toBe(false);
  });

  it("scopes a sign link to its payment, proposal or proposing", async () => {
    const person = await seedPerson(db);
    const resolve = async (target: Parameters<typeof seedLink>[3]) => {
      const r = await resolveSignLink(db, await seedLink(db, person.id, "sign", target), { purposes: ["sign"] });
      if (!r.ok) throw new Error("expected a valid link");
      return r.link;
    };
    const pay = await resolve({ paymentId: "3" });
    expect(linkAllows(pay, "payment", BigInt(3))).toBe(true);
    expect(linkAllows(pay, "payment", BigInt(4))).toBe(false);
    expect(linkAllows(pay, "proposal", BigInt(3))).toBe(false);
    expect(linkAllows(pay, "propose")).toBe(false);
    const prop = await resolve({ proposalId: "2" });
    expect(linkAllows(prop, "proposal", BigInt(2))).toBe(true);
    expect(linkAllows(await resolve({ action: "propose" }), "propose")).toBe(true);
    expect(linkAllows(await resolve(null), "propose")).toBe(true);
  });
});
