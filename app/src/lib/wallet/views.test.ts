import { keccak256, stringToBytes, type Address, type Hex } from "viem";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db";
import { createTestDb } from "@/db/testing";
import { budgetLines, invoices, proposals } from "@/db/schema";
import { encodeSetVendor } from "./proposals";
import { loadPaymentView, loadProposalView, type ChainReader } from "./views";
import { SIGNER_SAFE, VENDOR_SAFE, seedPerson, seedVendor } from "./testing/fixtures";

const E18 = BigInt(10) ** BigInt(18);
const MANT = keccak256(stringToBytes("mantenimiento"));

function reader(over: Partial<ChainReader> = {}): ChainReader {
  return {
    payment: async () => ({ vendor: VENDOR_SAFE, amount: BigInt(80000) * E18, lineId: MANT, status: "pending", approvals: BigInt(1) }),
    budget: async () => ({ allocated: BigInt(100000) * E18, spent: BigInt(50000) * E18, exists: true }),
    threshold: async () => BigInt(2),
    paused: async () => false,
    hasApproved: async (_id: bigint, s: Address) => s === SIGNER_SAFE,
    warsBalanceOf: async () => BigInt(0),
    proposal: async () => null,
    hasApprovedProposal: async () => false,
    caps: async () => ({ perTxCap: BigInt(1000) * E18, vendorMonthlyCap: BigInt(3000) * E18 }),
    receipt: async () => {
      throw new Error("unused");
    },
    ...over,
  };
}

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
}, 60_000);

describe("loadPaymentView", () => {
  it("joins the chain with the vendor, the invoice and the line, and flags going over budget", async () => {
    const uploader = await seedPerson(db);
    const vendor = await seedVendor(db, { address: VENDOR_SAFE, legalName: "Ferretería El Tornillo", cuit: BigInt(20123456789) });
    await db.insert(budgetLines).values({ lineId: MANT, slug: "mantenimiento", name: "Mantenimiento" });
    await db.insert(invoices).values({
      uploaderPersonId: uploader.id,
      vendorId: vendor.id,
      fileUrl: "https://blob/factura.pdf",
      fileHash: "0x00",
      tipo: 11,
      ptoVta: 2,
      nro: BigInt(345),
      paymentId: BigInt(3),
    });
    const view = await loadPaymentView(db, reader(), BigInt(3), SIGNER_SAFE);
    expect(view).toMatchObject({
      vendorName: "Ferretería El Tornillo",
      cuit: "20123456789",
      lineName: "Mantenimiento",
      invoiceUrl: "https://blob/factura.pdf",
      invoiceLabel: "Invoice C 00002-00000345",
      approvals: 1,
      threshold: 2,
      overBudget: true,
      lineAvailable: (BigInt(50000) * E18).toString(),
      alreadyApproved: true,
    });
  });

  it("returns null for a payment that doesn't exist", async () => {
    const view = await loadPaymentView(db, reader({ payment: async () => ({ vendor: VENDOR_SAFE, amount: BigInt(0), lineId: "0x" as Hex, status: "none", approvals: BigInt(0) }) }), BigInt(9), null);
    expect(view).toBeNull();
  });
});

describe("loadProposalView", () => {
  it("decodes the proposal from the chain and names a vendor that isn't in vendors yet", async () => {
    const data = encodeSetVendor({ vendor: VENDOR_SAFE, cuit: BigInt(30500010912), enabled: true });
    await db.insert(proposals).values({ proposalId: BigInt(5), kind: "SetVendor", data, decoded: { meta: { vendorLegalName: "Ferretería SRL" } }, proposer: SIGNER_SAFE });
    const chain = reader({
      proposal: async () => ({ kind: 2, data, proposer: SIGNER_SAFE, executed: false, approvals: BigInt(1) }),
      hasApprovedProposal: async () => true,
    });
    const view = await loadProposalView(db, chain, BigInt(5), SIGNER_SAFE);
    expect(view).toMatchObject({
      kind: "SetVendor",
      summary: "Enable the vendor Ferretería SRL (tax ID 30-50001091-2).",
      status: "open",
      approvals: 1,
      threshold: 2,
      alreadyApproved: true,
    });
    expect(await loadProposalView(db, reader(), BigInt(6), null)).toBeNull();
  });
});
