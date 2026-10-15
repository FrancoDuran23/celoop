// Amounts and addresses for people. Browser-safe.
import { WARS_DECIMALS } from "./constants";

const UNIT = BigInt(10) ** BigInt(WARS_DECIMALS);
const CENT = UNIT / BigInt(100);

/** wARS base units → "$ 12.500,00" (es-AR). Rounds half up to cents. */
export function formatPesos(baseUnits: bigint | string): string {
  const value = typeof baseUnits === "bigint" ? baseUnits : BigInt(baseUnits);
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const cents = (abs + CENT / BigInt(2)) / CENT;
  const whole = (cents / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = (cents % BigInt(100)).toString().padStart(2, "0");
  return `${negative ? "-" : ""}$ ${whole},${frac}`;
}

/**
 * What a person types → wARS base units. Accepts "100000", "100.000", "100.000,50", "1500,5",
 * and "$ 1.500". Returns null if it isn't a positive amount with at most two decimals.
 */
export function parsePesos(input: string): bigint | null {
  const cleaned = input.replace(/\$/g, "").replace(/\s/g, "");
  if (!cleaned) return null;
  // es-AR: "." groups thousands, "," is the decimal separator.
  const match = cleaned.match(/^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/);
  if (!match) return null;
  const whole = BigInt(match[1].replace(/\./g, ""));
  const frac = BigInt((match[2] ?? "").padEnd(2, "0") || "0");
  const value = whole * UNIT + frac * CENT;
  return value > BigInt(0) ? value : null;
}

/** Base units → plain decimal string with "." and no grouping, e.g. "12500.5". For URLs. */
export function toDecimalString(baseUnits: bigint): string {
  const whole = baseUnits / UNIT;
  const frac = (baseUnits % UNIT).toString().padStart(WARS_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** 0x1234…abcd */
export function shortAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** 20123456789 → "20-12345678-9" */
export function formatCuit(cuit: bigint | number | string): string {
  const s = cuit.toString().padStart(11, "0");
  return `${s.slice(0, 2)}-${s.slice(2, 10)}-${s.slice(10)}`;
}
