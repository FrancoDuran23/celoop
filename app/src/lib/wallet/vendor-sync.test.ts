import { getAddress } from "viem";
import { expect, test } from "vitest";
import { proposals, vendors } from "@/db/schema";
import { createTestDb, ensureCooperadora } from "@/db/testing";
import { encodeSetVendor } from "./proposals";
import { syncExecutedVendors } from "./vendor-sync";

const VENDOR = getAddress("0x00000000000000000000000000000000000000a1");
const SET_VENDOR = 2; // ProposalKind.SetVendor

test("an executed SetVendor proposal creates the vendor row once", async () => {
  const db = await createTestDb();
  await ensureCooperadora(db);
  const data = encodeSetVendor({ vendor: VENDOR, cuit: BigInt("20123456786"), enabled: true });
  await db.insert(proposals).values({
    proposalId: BigInt(1),
    kind: "SetVendor",
    data,
    decoded: { meta: { vendorLegalName: "Pinturería Norte" } },
    proposer: VENDOR,
    status: "executed",
  });
  const chain = {
    proposal: async () => ({ kind: SET_VENDOR, data, proposer: VENDOR, executed: true, approvals: BigInt(2) }),
  };

  expect(await syncExecutedVendors(db, chain)).toEqual({ applied: 1 });
  await syncExecutedVendors(db, chain);

  const rows = await db.select().from(vendors);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ legalName: "Pinturería Norte", cuit: BigInt("20123456786"), enabled: true });
});
