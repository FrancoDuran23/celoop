// Small formatting helpers for the agent's messages. Money display reuses module 05.
import { formatComprobante, formatPesos, tipoLabel } from "@/lib/report/format";

export { formatPesos };

const WEI = BigInt("1000000000000000000");
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;

/** YYYY-MM-DD in Argentine time. */
export function arDate(now: Date): string {
  return new Date(now.getTime() - AR_OFFSET_MS).toISOString().slice(0, 10);
}

/** Base units to a plain decimal for URLs: 5000, 5000.5 → "5000", "5000.50". */
export function pesosDecimal(baseUnits: bigint): string {
  const cents = (baseUnits * BigInt(100) + WEI / BigInt(2)) / WEI;
  const whole = (cents / BigInt(100)).toString();
  const frac = cents % BigInt(100);
  return frac === BigInt(0) ? whole : `${whole}.${frac.toString().padStart(2, "0")}`;
}

/** Whole pesos to base units. */
export const pesos = (n: number | bigint) => BigInt(n) * WEI;

/**
 * Parses an amount typed by a person, Argentine style: "5000", "5.000", "$ 5.000,50", "4500.5".
 * Returns base units, or null if it isn't a positive amount with at most two decimals.
 */
export function parseAmount(input: string): bigint | null {
  let s = input.trim().replace(/^\$\s*/, "").replace(/\s+/g, "").replace(/pesos?$/i, "");
  if (!s) return null;
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, "");
  }
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const value = BigInt(m[1]) * WEI + (BigInt((m[2] ?? "").padEnd(2, "0")) * WEI) / BigInt(100);
  return value > BigInt(0) ? value : null;
}

/** "Factura C 0003-00001234" */
export function invoiceLabel(inv: { tipo: number | null; ptoVta: number | null; nro: bigint | null }): string {
  return `${tipoLabel(inv.tipo)} ${formatComprobante(inv.ptoVta, inv.nro)}`;
}

/** JSON-safe copy for jsonb columns: bigint → decimal string, Uint8Array dropped. */
export function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return undefined;
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .map(([k, v]) => [k, jsonSafe(v)] as const)
        .filter(([, v]) => v !== undefined),
    );
  }
  return value;
}

/** Every string inside a value, for scanning an invoice's text for injected instructions. */
export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

export function errorText(e: unknown): string {
  return e instanceof Error ? ((e as { shortMessage?: string }).shortMessage ?? e.message) : String(e);
}
