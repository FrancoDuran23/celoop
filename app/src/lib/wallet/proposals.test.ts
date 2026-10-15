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
      summary: "Mover $ 100.000,00 de Eventos a Mantenimiento. Motivo: rotura de caño",
      reasonMatches: true,
    });
    expect(describeProposal(decoded, { lineName, reasonText: "otra cosa" }).reasonMatches).toBe(false);
    expect(describeProposal(decoded, { lineName }).reasonMatches).toBeNull();
  });

  it("describes every other kind", () => {
    const cases: [string, Hex, RegExp][] = [
      ["SetBudget", encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "uint64" }], [EVENTOS, BigInt(50000) * E18, BigInt(1798761600)]), /^Asignar \$ 50\.000,00 a Eventos, hasta el 31 de diciembre de 2026\.$/],
      ["SetVendor", encodeAbiParameters([{ type: "address" }, { type: "uint64" }, { type: "bool" }], ["0x4444444444444444444444444444444444444444", BigInt(20123456789), true]), /^Habilitar al proveedor Ferretería \(CUIT 20-12345678-9\)\.$/],
      ["SetCaps", encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [BigInt(50000) * E18, BigInt(200000) * E18]), /hasta \$ 50\.000,00 por pago y \$ 200\.000,00 por proveedor/],
      ["SetSigners", encodeAbiParameters([{ type: "address[]" }, { type: "uint256" }], [["0x4444444444444444444444444444444444444444", "0x3333333333333333333333333333333333333333"], BigInt(2)]), /2 personas, .* 2 firmas/],
      ["SetAgent", encodeAbiParameters([{ type: "address" }], ["0x4444444444444444444444444444444444444444"]), /agente/],
      ["SetConfigHash", encodeAbiParameters([{ type: "bytes32" }], [EVENTOS]), /configuración/],
      ["Unpause", "0x", /^Reanudar los pagos/],
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
