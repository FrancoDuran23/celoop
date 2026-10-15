import { findArcaQrInImage, type QrHit } from "./decode";
import { claudeExtractor, parseLlmOutput } from "./llm";
import { readPdf } from "./pdf";
import type { InvoiceFields, InvoiceFile, LlmExtractor, ReadResult } from "./types";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const REVIEW = "Los datos del QR y los que leyó la IA no coinciden; la tiene que revisar una persona";

export async function readInvoice(
  file: InvoiceFile,
  deps: { extractWithLlm?: LlmExtractor } = {},
): Promise<ReadResult> {
  const extract = deps.extractWithLlm ?? claudeExtractor;
  const isPdf = file.mimeType === "application/pdf";
  if (!isPdf && !IMAGE_TYPES.has(file.mimeType)) {
    return { ok: false, reason: "El archivo tiene que ser una foto (JPG, PNG) o un PDF" };
  }

  let qr: QrHit | null = null;
  let pdfText: string | null = null;
  try {
    if (isPdf) {
      const pdf = await readPdf(file.bytes);
      pdfText = pdf.text || null;
      for (const png of pdf.pagePngs) {
        qr = await findArcaQrInImage(png);
        if (qr) break;
      }
    } else {
      qr = await findArcaQrInImage(file.bytes);
    }
  } catch {
    return { ok: false, reason: "No pude abrir el archivo. Probá con otra foto o con el PDF original" };
  }

  // QR complete (has the receptor): no need for the LLM.
  if (qr && qr.fields.receptorDocTipo !== null && qr.fields.receptorDocNro !== null) {
    return { ok: true, fields: qr.fields, source: "qr", raw: { qr: qr.json, pdfText } };
  }

  let llmRaw: unknown = null;
  let llm: InvoiceFields | null = null;
  try {
    llmRaw = await extract({ file, pdfText });
    llm = parseLlmOutput(llmRaw);
  } catch {
    llm = null;
  }

  if (qr) {
    if (!llm) {
      // QR is authoritative for the fiscal data; the receptor is just missing.
      return { ok: true, fields: qr.fields, source: "qr", raw: { qr: qr.json, llm: llmRaw, pdfText } };
    }
    const a = qr.fields;
    if (a.cuit !== llm.cuit || a.tipo !== llm.tipo || a.nro !== llm.nro || Number(a.importe) !== Number(llm.importe)) {
      return { ok: false, reason: REVIEW };
    }
    return {
      ok: true,
      fields: { ...a, receptorDocTipo: llm.receptorDocTipo, receptorDocNro: llm.receptorDocNro },
      source: "qr+llm",
      raw: { qr: qr.json, llm: llmRaw, pdfText },
    };
  }

  if (!llm) {
    return { ok: false, reason: "No pude leer la factura. Sacale una foto más nítida, con el código QR a la vista, o mandá el PDF original" };
  }
  return { ok: true, fields: llm, source: "llm", raw: { llm: llmRaw, pdfText } };
}
