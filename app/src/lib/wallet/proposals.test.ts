import { encodeAbiParameters, keccak256, stringToBytes, type Hex } from "viem";
import { describe, expect, it } from "vitest";
import { decodeProposal, describeProposal, encodeMoveBudget, proposalKindIndex, reasonHash } from "./proposals";

const E18 = BigInt(10) ** BigInt(18);
const line = (slug: string) => keccak256(stringToBytes(slug));
const EVENTOS = line("eventos");
const MANT = line("mantenimiento");
const names: Record<string, string> = { [EVENTOS]: "Eventos", [MANT]: "Mantenimiento" };
const lineName = (id: Hex) => names[id];

describe("proposals", () => {
  it("encodes a move with the motive's hash and decodes it back", () => {
    const data = encodeMoveBudget({ fromLine: EVENTOS, toLine: MANT, amount: BigInt(100000) * E18, reasonText: "rotura de caño" });
    const decoded = decodeProposal("MoveBudget", data);
    expect(decoded).toEqual({ kind: "MoveBudget", fromLine: EVENTOS, toLine: MANT, amount: BigInt(100000) * E18, reasonHash: reasonHash("rotura de caño") });
  });

  it("describes a move in plain Spanish and checks the motive against the hash", () => {
    const data = encodeMoveBudget({ fromLine: EVENTOS, toLine: MANT, amount: BigInt(100000) * E18, reasonText: "rotura de caño" });
    const decoded = decodeProposal(1, data);
    expect(describeProposal(decoded, { lineName, reasonText: "rotura de caño" })).toEqual({
      summary: "Move $ 100.000,00 from Eventos to Mantenimiento. Reason: rotura de caño",
      reasonMatches: true,
    });
    expect(describeProposal(decoded, { lineName, reasonText: "otra cosa" }).reasonMatches).toBe(false);
    expect(describeProposal(decoded, { lineName }).reasonMatches).toBeNull();
  });

  it("describes every other kind", () => {
    const cases: [string, Hex, RegExp][] = [
      ["SetBudget", encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }], [EVENTOS, BigInt(50000) * E18, BigInt(1798761600)]), /^Allocate \$ 50\.000,00 to Eventos, until December 31, 2026\.$/],
      ["SetVendor", encodeAbiParameters([{ type: "address" }, { type: "uint64" }, { type: "bool" }], ["0x4444444444444444444444444444444444444444", BigInt(20123456789), true]), /^Enable the vendor Ferretería \(tax ID 20-12345678-9\)\.$/],
      ["SetCaps", encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(50000) * E18, BigInt(200000) * E18]), /up to \$ 50\.000,00 per payment and \$ 200\.000,00 per vendor/],
      ["SetSigners", encodeAbiParameters([{ type: "address[]" }, { type: "uint256" }], [["0x4444444444444444444444444444444444444444", "0x3333333333333333333333333333333333333333"], BigInt(2)]), /2 people, .* 2 signatures/],
      ["SetAgent", encodeAbiParameters([{ type: "address" }], ["0x4444444444444444444444444444444444444444"]), /agent/],
      ["SetConfigHash", encodeAbiParameters([{ type: "bytes32" }], [EVENTOS]), /configuration/],
      ["Unpause", "0x", /^Resume payments/],
    ];
    for (const [kind, data, expected] of cases) {
      const text = describeProposal(decodeProposal(kind, data), { lineName, vendorName: () => "Ferretería" }).summary;
      expect(text).toMatch(expected);
    }
  });

  it("accepts the kind as a name, a number or a numeric string", () => {
    expect(proposalKindIndex("MoveBudget")).toBe(1);
    expect(proposalKindIndex("unpause")).toBe(7);
    expect(proposalKindIndex("7")).toBe(7);
    expect(() => proposalKindIndex("Drain")).toThrow();
  });
});
