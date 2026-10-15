// Display formatting shared by the web views and the PDF. Everything is deterministic and
// timezone-fixed (Argentina, UTC-3, no DST) so reports render the same on any server.

const WEI = BigInt("1000000000000000000"); // wARS has 18 decimals; 1 wARS = 1 peso
const CENT = WEI / BigInt(100);
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;

export const MONTHS_ES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function toBig(v: string | bigint | number | null | undefined): bigint {
  if (v === null || v === undefined || v === "") return BigInt(0);
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  return BigInt(v);
}

/** Base units (18 decimals) to "$ 12.500,00". Rounds half away from zero to the cent. */
export function formatPesos(baseUnits: string | bigint | number | null | undefined): string {
  const value = toBig(baseUnits);
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const cents = (abs + CENT / BigInt(2)) / CENT;
  const whole = (cents / BigInt(100)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const frac = (cents % BigInt(100)).toString().padStart(2, "0");
  return `${negative && cents > BigInt(0) ? "-" : ""}$ ${whole},${frac}`;
}

/** Pesos as printed on an invoice ("12500.00") to base units. */
export function pesosToBase(pesos: string): string {
  const [w, f = ""] = pesos.trim().split(".");
  const cents = (f + "00").slice(0, 2);
  return (BigInt(w || "0") * BigInt(100) + BigInt(cents)) * CENT + "";
}

export function sumBase(values: Array<string | bigint | null | undefined>): bigint {
  return values.reduce<bigint>((acc, v) => acc + toBig(v), BigInt(0));
}

function arParts(input: Date | string | number) {
  const d = new Date(new Date(input).getTime() - AR_OFFSET_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

/** "dd/mm/aaaa" in Argentine time. */
export function formatDate(input: Date | string | number): string {
  const { y, m, d } = arParts(input);
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

/** "YYYY-MM" (Argentine time) of an instant. */
export function monthKey(input: Date | string | number): string {
  const { y, m } = arParts(input);
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function isPeriod(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** [start, end) of a period as instants, with midnight in Argentina. */
export function periodRange(period: string): { start: Date; end: Date } {
  const [y, m] = period.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 3));
  const end = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 3));
  return { start, end };
}

/** "October 2026", for the web and the PDF. */
export function periodLabel(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS_EN[m - 1]} ${y}`;
}

/** "octubre de 2026", for the Telegram bot, which speaks Spanish. */
export function periodLabelEs(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS_ES[m - 1]} de ${y}`;
}

/** Period before the one containing `now` (what the tick closes). */
export function previousPeriod(now: Date): string {
  const { y, m } = arParts(now);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export function formatCuit(cuit: string | bigint | number | null | undefined): string {
  if (cuit === null || cuit === undefined) return "-";
  const s = String(cuit).padStart(11, "0");
  return `${s.slice(0, 2)}-${s.slice(2, 10)}-${s.slice(10)}`;
}

const TIPOS: Record<number, string> = {
  1: "Factura A", 2: "Nota de débito A", 3: "Nota de crédito A", 6: "Factura B",
  7: "Nota de débito B", 8: "Nota de crédito B", 11: "Factura C", 12: "Nota de débito C",
  13: "Nota de crédito C", 51: "Factura M",
};

/** Spanish name of an ARCA voucher type, for the Telegram bot. */
export function tipoLabel(tipo: number | null | undefined): string {
  if (tipo === null || tipo === undefined) return "Comprobante";
  return TIPOS[tipo] ?? `Comprobante ${tipo}`;
}

const INVOICE_TYPES: Record<number, string> = {
  1: "Invoice A", 2: "Debit note A", 3: "Credit note A", 6: "Invoice B",
  7: "Debit note B", 8: "Credit note B", 11: "Invoice C", 12: "Debit note C",
  13: "Credit note C", 51: "Invoice M",
};

/** English name of an ARCA voucher type, for the web and the PDF. The letter is the official class. */
export function invoiceTypeLabel(tipo: number | null | undefined): string {
  if (tipo === null || tipo === undefined) return "Voucher";
  return INVOICE_TYPES[tipo] ?? `Voucher ${tipo}`;
}

/** "0001-00001234" */
export function formatComprobante(ptoVta: number | null | undefined, nro: string | bigint | null | undefined): string {
  if (ptoVta === null || ptoVta === undefined || nro === null || nro === undefined) return "-";
  return `${String(ptoVta).padStart(4, "0")}-${String(nro).padStart(8, "0")}`;
}

export function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

/** Block explorer link for a transaction, when the chain has a public explorer. */
export function explorerTxUrl(chainId: number | null | undefined, txHash: string | null | undefined): string | null {
  if (!txHash) return null;
  if (chainId === 42220) return `https://celoscan.io/tx/${txHash}`;
  if (chainId === 11142220) return `https://sepolia.celoscan.io/tx/${txHash}`;
  return null;
}
