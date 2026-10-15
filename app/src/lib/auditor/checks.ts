// The auditor's checks on one payment. Pure: everything they look at comes in `AuditInput`, read
// by the runner from the chain, the stored file and the payment history. No LLM, no network.
//
// An "observacion" sends the payment to the signers (the auditor flags it on chain). A "nota" is
// only information for whoever reads the report.
import { invoiceIdOf, toWarsUnits, type InvoiceFields } from "@/lib/invoice";
import { formatCuit, formatPesos } from "@/lib/report/format";

export type FindingLevel = "observacion" | "nota";

export type FindingCode =
  | "SIN_FACTURA"
  | "ARCHIVO_DISTINTO"
  | "SIN_QR"
  | "QR_DISTINTO"
  | "MONTO_DISTINTO"
  | "RECEPTOR_INCORRECTO"
  | "POSIBLE_COMPRA_PARTIDA"
  | "POSIBLE_FACTURA_REPETIDA"
  | "PROVEEDOR_NUEVO"
  | "SIN_RECEPTOR_EN_QR"
  | "FACTURA_VIEJA";

export type Finding = { code: FindingCode; level: FindingLevel; text: string };

/** Another payment to the same vendor (pending or executed; rejected ones are left out). */
export type PastPayment = { paymentId: bigint; amount: bigint; at: Date; invoiceLabel: string | null };

export type AuditInput = {
  payment: { paymentId: bigint; vendor: string; amount: bigint; invoiceId: `0x${string}`; fileHash: `0x${string}` };
  /** keccak256 of the stored file, or null when there is no invoice row for this payment. */
  storedFileHash: `0x${string}` | null;
  hasInvoice: boolean;
  /** What the auditor itself read from the file's ARCA QR; null if it has none. */
  qr: InvoiceFields | null;
  cooperadoraCuit: bigint;
  perTxCap: bigint;
  /** Same vendor, other payments, most recent first. */
  history: PastPayment[];
  now: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Window to look for one purchase split into several invoices under the per-payment cap. */
export const SPLIT_WINDOW_DAYS = 7;
/** Window to look for the same amount paid twice to the same vendor. */
export const REPEAT_WINDOW_DAYS = 30;
export const OLD_INVOICE_DAYS = 60;

const days = (ms: number) => Math.floor(ms / DAY_MS);

function invoiceAgeDays(fecha: string, now: Date): number | null {
  const t = Date.parse(`${fecha}T12:00:00-03:00`);
  return Number.isNaN(t) ? null : days(now.getTime() - t);
}

export function runChecks(input: AuditInput): Finding[] {
  const { payment, qr } = input;
  const out: Finding[] = [];
  const obs = (code: FindingCode, text: string) => out.push({ code, level: "observacion", text });
  const note = (code: FindingCode, text: string) => out.push({ code, level: "nota", text });

  // 1. The invoice behind the payment: it exists, and the file is the one the treasurer proposed.
  if (!input.hasInvoice) {
    obs("SIN_FACTURA", "No encontré en el sistema la factura de este pago. Nadie la cargó por el bot.");
  } else if (input.storedFileHash?.toLowerCase() !== payment.fileHash.toLowerCase()) {
    obs("ARCHIVO_DISTINTO", "El archivo guardado de la factura no es el mismo que se usó para proponer el pago.");
  }

  // 2. I read the QR myself and compare it with what is on chain.
  if (input.hasInvoice) {
    if (!qr) {
      obs(
        "SIN_QR",
        "La factura no tiene un código QR de ARCA que yo pueda leer, así que sus datos los leyó la IA. Que la mire una persona antes de pagar.",
      );
    } else {
      if (invoiceIdOf(qr).toLowerCase() !== payment.invoiceId.toLowerCase()) {
        obs("QR_DISTINTO", "Los datos del QR (CUIT, tipo o número de factura) no coinciden con los del pago.");
      }
      let qrAmount: bigint | null = null;
      try {
        qrAmount = toWarsUnits(qr.importe);
      } catch {
        qrAmount = null;
      }
      if (qrAmount !== payment.amount) {
        obs(
          "MONTO_DISTINTO",
          `El importe del QR (${qrAmount === null ? qr.importe : formatPesos(qrAmount)}) no coincide con el del pago (${formatPesos(payment.amount)}).`,
        );
      }
      if (qr.receptorDocNro === null) {
        note("SIN_RECEPTOR_EN_QR", "El QR no trae a quién está hecha la factura; eso lo verificó el tesorero leyendo el documento.");
      } else if (qr.receptorDocTipo !== 80 || qr.receptorDocNro !== input.cooperadoraCuit) {
        obs(
          "RECEPTOR_INCORRECTO",
          `Según el QR, la factura no está a nombre de la cooperadora (CUIT ${formatCuit(input.cooperadoraCuit)}).`,
        );
      }
      const age = invoiceAgeDays(qr.fecha, input.now);
      if (age !== null && age > OLD_INVOICE_DAYS) note("FACTURA_VIEJA", `La factura tiene ${age} días.`);
    }
  }

  // 3. Patterns across payments to the same vendor.
  const ago = (p: PastPayment) => days(input.now.getTime() - p.at.getTime());
  // Only payments small enough to go out without signatures count: big ones already had people look.
  const recent = input.history.filter((p) => ago(p) <= SPLIT_WINDOW_DAYS && p.amount <= input.perTxCap);
  const recentTotal = recent.reduce((sum, p) => sum + p.amount, BigInt(0));
  if (payment.amount <= input.perTxCap && recent.length > 0 && recentTotal + payment.amount > input.perTxCap) {
    obs(
      "POSIBLE_COMPRA_PARTIDA",
      `Este proveedor ya cobró ${formatPesos(recentTotal)} en los últimos ${SPLIT_WINDOW_DAYS} días. Sumado a este pago pasa el tope de ${formatPesos(input.perTxCap)} por pago: puede ser una compra partida en varias facturas para no pedir firmas.`,
    );
  }
  const twin = input.history.find((p) => p.amount === payment.amount && ago(p) <= REPEAT_WINDOW_DAYS);
  if (twin) {
    const when = ago(twin) === 0 ? "hoy" : `hace ${ago(twin)} días`;
    obs(
      "POSIBLE_FACTURA_REPETIDA",
      `Hay otro pago a este proveedor por el mismo monto ${when}${twin.invoiceLabel ? ` (${twin.invoiceLabel})` : ""}. Puede ser la misma compra facturada dos veces.`,
    );
  }
  if (input.history.length === 0) note("PROVEEDOR_NUEVO", "Es el primer pago a este proveedor.");

  return out;
}

export const isFlagged = (findings: Finding[]) => findings.some((f) => f.level === "observacion");
