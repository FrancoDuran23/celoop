import { encodeAbiParameters, keccak256 } from "viem";
import type { InvoiceFields } from "./types";

/** keccak256(abi.encode(uint64 cuit, uint16 tipo, uint32 ptoVta, uint64 nro)), same as the contract. */
export function invoiceIdOf(f: Pick<InvoiceFields, "cuit" | "tipo" | "ptoVta" | "nro">): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint64" }, { type: "uint16" }, { type: "uint32" }, { type: "uint64" }],
      [f.cuit, f.tipo, f.ptoVta, f.nro],
    ),
  );
}

export function fileHashOf(bytes: Uint8Array): `0x${string}` {
  return keccak256(bytes);
}

/** 1 peso = 1 wARS, 18 decimals. Accepts "12500", "12500.5", "12500.50" (up to 18 decimals). */
export function toWarsUnits(importe: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(importe.trim());
  if (!m) throw new Error(`Importe inválido: ${importe}`);
  return BigInt(m[1]) * BigInt(10) ** BigInt(18) + BigInt((m[2] ?? "").padEnd(18, "0"));
}
