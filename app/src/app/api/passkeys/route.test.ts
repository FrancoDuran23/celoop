import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@/db";
import { createTestDb } from "@/db/testing";
import { SIGNER_SAFE, seedLink, seedPerson } from "@/lib/wallet/testing/fixtures";

let db: Db;
vi.mock("@/db", () => ({ getDb: () => db }));
vi.mock("@/lib/wallet/server", () => ({ computeSafeAddress: async () => SIGNER_SAFE }));
const { POST } = await import("./route");

const KEY = `0x04${"12".repeat(64)}`;
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/passkeys", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(async () => {
  db = await createTestDb();
}, 60_000);

describe("POST /api/passkeys", () => {
  it("registers the passkey with an enroll link and returns the Safe", async () => {
    const person = await seedPerson(db, { name: "Ana" });
    const res = await post({ token: await seedLink(db, person.id, "enroll"), credentialId: "abc", publicKey: KEY });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ safeAddress: SIGNER_SAFE, name: "Ana" });
  });

  it("answers 403 with a message for a bad link and 400 for bad JSON", async () => {
    const res = await post({ token: "nope", credentialId: "abc", publicKey: KEY });
    expect(res.status).toBe(403);
    expect((await res.json()).message).toMatch(/link/i);
    expect((await post("{")).status).toBe(400);
  });
});
