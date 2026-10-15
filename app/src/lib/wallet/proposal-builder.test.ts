import { encodeFunctionData, keccak256, stringToBytes, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { treasuryPolicyAbi } from "@/lib/chain/abi";
import { checkUserOperation } from "./policy";
import { buildProposal, isValidCuit, lineIdOf, parseCuit, periodEndOf, slugify, type ProposalInput } from "./proposal-builder";
import { decodeProposal } from "./proposals";
import { SIGNER_SAFE, TREASURY, policyContext, safeCallData, userOp } from "./testing/fixtures";

const E18 = BigInt(10) ** BigInt(18);
const EVENTOS = lineIdOf("eventos");
const MANT = lineIdOf("mantenimiento");
const lines = [
  { lineId: EVENTOS, name: "Eventos" },
  { lineId: MANT, name: "Mantenimiento" },
];
const NOW = 1791000000; // 2026-10-03
const VENDOR = "0x4444444444444444444444444444444444444444";

function built(input: ProposalInput) {
  const r = buildProposal(input, { lines, now: NOW });
  if (!r.ok) throw new Error(r.error);
  return r.proposal;
}
const error = (input: ProposalInput) => {
  const r = buildProposal(input, { lines, now: NOW });
  return r.ok ? null : r.error;
};

describe("CUIT", () => {
  it("checks the verification digit", () => {
    expect(isValidCuit("20123456786")).toBe(true);
    expect(isValidCuit("30500010912")).toBe(true);
    expect(isValidCuit("20123456789")).toBe(false);
    expect(isValidCuit("2012345678")).toBe(false);
    expect(parseCuit("30-50001091-2")).toBe(BigInt(30500010912));
    expect(parseCuit("30-50001091-3")).toBeNull();
  });
});

describe("helpers", () => {
  it("slugs, line ids and period ends", () => {
    expect(slugify("Gastos Operativos")).toBe("gastos-operativos");
    expect(slugify("  Útiles y librería ")).toBe("utiles-y-libreria");
    expect(lineIdOf("eventos")).toBe(keccak256(stringToBytes("eventos")));
    // 2026-12-31 23:59:59 at UTC-3 = 2027-01-01 02:59:59 UTC
    expect(periodEndOf("2026-12-31")).toBe(BigInt(Date.UTC(2027, 0, 1, 2, 59, 59) / 1000));
    expect(periodEndOf("2026-02-30")).toBeNull();
    expect(periodEndOf("31/12/2026")).toBeNull();
  });
});

describe("SetBudget", () => {
  it("updates an existing line", () => {
    const p = built({ kind: "SetBudget", line: MANT, amount: "500.000", periodEnd: "2026-12-31" });
    expect(p.kindIndex).toBe(0);
    expect(decodeProposal(p.kindIndex, p.data)).toEqual({ kind: "SetBudget", lineId: MANT, allocated: BigInt(500000) * E18, periodEnd: periodEndOf("2026-12-31") });
    expect(p.summary).toBe("Asignar $ 500.000,00 a Mantenimiento, hasta el 31 de diciembre de 2026.");
    expect(p.meta).toEqual({});
  });

  it("creates a new line with lineId = keccak256(slug)", () => {
    const p = built({ kind: "SetBudget", line: "new", newName: "Biblioteca Escolar", amount: "80.000", periodEnd: "2026-12-31" });
    expect(p.meta.newLine).toEqual({ slug: "biblioteca-escolar", name: "Biblioteca Escolar" });
    const decoded = decodeProposal("SetBudget", p.data);
    expect(decoded.kind === "SetBudget" && decoded.lineId).toBe(lineIdOf("biblioteca-escolar"));
    expect(p.summary).toContain("a Biblioteca Escolar");
  });

  it("rejects a new line that already exists, bad amounts and past dates", () => {
    expect(error({ kind: "SetBudget", line: "new", newName: "Eventos", amount: "1", periodEnd: "2026-12-31" })).toMatch(/Ya existe/);
    expect(error({ kind: "SetBudget", line: MANT, amount: "0", periodEnd: "2026-12-31" })).toMatch(/monto/);
    expect(error({ kind: "SetBudget", line: MANT, amount: "10", periodEnd: "2026-01-01" })).toMatch(/futura/);
    expect(error({ kind: "SetBudget", line: `0x${"99".repeat(32)}`, amount: "10", periodEnd: "2026-12-31" })).toMatch(/partida/);
  });
});

describe("SetVendor", () => {
  it("encodes vendor, CUIT and enabled, and keeps the legal name for later", () => {
    const p = built({ kind: "SetVendor", legalName: "Ferretería El Tornillo SRL", cuit: "30-50001091-2", address: VENDOR.toLowerCase(), enabled: true });
    expect(p.kindIndex).toBe(2);
    expect(decodeProposal("SetVendor", p.data)).toEqual({ kind: "SetVendor", vendor: VENDOR, cuit: BigInt(30500010912), enabled: true });
    expect(p.summary).toBe("Habilitar al proveedor Ferretería El Tornillo SRL (CUIT 30-50001091-2).");
    expect(p.meta).toEqual({ vendorLegalName: "Ferretería El Tornillo SRL" });
    const off = built({ kind: "SetVendor", legalName: "Ferretería El Tornillo SRL", cuit: "30500010912", address: VENDOR, enabled: false });
    expect(off.summary).toMatch(/^Dar de baja al proveedor/);
  });

  it("rejects a bad CUIT, a missing name or a bad account", () => {
    const base = { kind: "SetVendor" as const, legalName: "Ferretería", cuit: "30500010912", address: VENDOR, enabled: true };
    expect(error({ ...base, cuit: "30500010913" })).toMatch(/CUIT/);
    expect(error({ ...base, legalName: " " })).toMatch(/razón social/);
    expect(error({ ...base, address: "0x1234" })).toMatch(/cuenta/);
    expect(error({ ...base, address: "0x0000000000000000000000000000000000000000" })).toMatch(/cuenta/);
  });
});

describe("SetCaps", () => {
  it("encodes both caps in base units", () => {
    const p = built({ kind: "SetCaps", perTxCap: "50.000", vendorMonthlyCap: "200.000" });
    expect(p.kindIndex).toBe(3);
    expect(decodeProposal("SetCaps", p.data)).toEqual({ kind: "SetCaps", perTxCap: BigInt(50000) * E18, vendorMonthlyCap: BigInt(200000) * E18 });
    expect(p.summary).toContain("hasta $ 50.000,00 por pago y $ 200.000,00 por proveedor");
  });

  it("rejects empty caps and a monthly cap below the per-payment cap", () => {
    expect(error({ kind: "SetCaps", perTxCap: "", vendorMonthlyCap: "1" })).toMatch(/por pago/);
    expect(error({ kind: "SetCaps", perTxCap: "100", vendorMonthlyCap: "50" })).toMatch(/no puede ser menor/);
  });
});

describe("MoveBudget and Unpause", () => {
  it("still build", () => {
    const move = built({ kind: "MoveBudget", fromLine: EVENTOS, toLine: MANT, amount: "100.000", reason: "rotura de caño" });
    expect(move.summary).toBe("Mover $ 100.000,00 de Eventos a Mantenimiento. Motivo: rotura de caño");
    expect(move.meta).toEqual({ reasonText: "rotura de caño" });
    expect(error({ kind: "MoveBudget", fromLine: EVENTOS, toLine: EVENTOS, amount: "1", reason: "x" })).toMatch(/distintas/);
    expect(built({ kind: "Unpause" })).toMatchObject({ kindIndex: 7, data: "0x" });
  });
});

it("the bundler sponsors each new kind for a signer", async () => {
  const inputs: ProposalInput[] = [
    { kind: "SetBudget", line: MANT, amount: "500.000", periodEnd: "2026-12-31" },
    { kind: "SetVendor", legalName: "Ferretería", cuit: "30500010912", address: VENDOR, enabled: true },
    { kind: "SetCaps", perTxCap: "50.000", vendorMonthlyCap: "200.000" },
  ];
  for (const input of inputs) {
    const p = built(input);
    const call = encodeFunctionData({ abi: treasuryPolicyAbi, functionName: "propose", args: [p.kindIndex, p.data as Hex] });
    const r = await checkUserOperation(userOp(SIGNER_SAFE, safeCallData(TREASURY, call)), policyContext());
    expect(r.ok).toBe(true);
  }
});
