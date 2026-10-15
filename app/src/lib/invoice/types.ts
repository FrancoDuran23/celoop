export type InvoiceFields = {
  /** Issuer CUIT, 11 digits. */
  cuit: bigint;
  /** ARCA voucher code: 6 = Factura B, 11 = Factura C (others are read but not accepted). */
  tipo: number;
  ptoVta: number;
  nro: bigint;
  /** Decimal in pesos, e.g. "12500.00". */
  importe: string;
  /** YYYY-MM-DD. */
  fecha: string;
  /** "PES" for pesos. */
  moneda: string;
  /** 80 = CUIT. */
  receptorDocTipo: number | null;
  receptorDocNro: bigint | null;
  cae: string | null;
};

export type ReadResult =
  | { ok: true; fields: InvoiceFields; source: "qr" | "llm" | "qr+llm"; raw: unknown }
  | { ok: false; reason: string };

export type InvoiceFile = { bytes: Uint8Array; mimeType: string };

/** What the LLM extractor receives: the file plus any text extracted from a PDF. */
export type LlmExtractorInput = { file: InvoiceFile; pdfText: string | null };

/** Returns the raw tool output (unvalidated); readInvoice validates it with zod. */
export type LlmExtractor = (input: LlmExtractorInput) => Promise<unknown>;

export type ValidationCode =
  | "TIPO_NO_ACEPTADO"
  | "RECEPTOR_INCORRECTO"
  | "PROVEEDOR_NO_HABILITADO"
  | "IMPORTE_INVALIDO"
  | "FECHA_INVALIDA"
  | "YA_PAGADA";

export type Validation = { ok: true } | { ok: false; code: ValidationCode; reason: string };
