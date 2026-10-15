import { z } from "zod";
import type { InvoiceFields } from "./types";

const num = z.union([z.number(), z.string()]);

const payloadSchema = z.object({
  ver: num.optional(),
  fecha: z.string(),
  cuit: num,
  ptoVta: num,
  tipoCmp: num,
  nroCmp: num,
  importe: num,
  moneda: z.string().default("PES"),
  ctz: num.optional(),
  tipoDocRec: num.nullish(),
  nroDocRec: num.nullish(),
  tipoCodAut: z.union([z.string(), z.number()]).nullish(),
  codAut: num.nullish(),
});

const HOSTS = /(^|\.)(afip|arca)\.gob\.ar$/i;

function intStr(v: string | number): string | null {
  const s = String(v).trim();
  return /^\d+$/.test(s) ? s : null;
}

function normalizeDate(s: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  return d ? `${d[3]}-${d[2]}-${d[1]}` : null;
}

function formatImporte(v: string | number): string | null {
  const s = String(v).trim().replace(",", ".");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const dec = (m[2] ?? "").padEnd(2, "0");
  // Round half up beyond 2 decimals is never expected from ARCA; truncate extra zeros only.
  if (/[^0]/.test(dec.slice(2))) return `${m[1]}.${dec}`;
  return `${m[1]}.${dec.slice(0, 2)}`;
}

/** Decodes the ARCA QR text (URL with ?p=<base64 json>) into invoice fields, or null. */
export function parseArcaQr(text: string): { fields: InvoiceFields; json: unknown } | null {
  let p: string | null;
  try {
    const url = new URL(text.trim());
    if (!HOSTS.test(url.hostname)) return null;
    p = url.searchParams.get("p");
    // URLSearchParams turns "+" into spaces; restore them for standard base64.
    if (p) p = p.replace(/ /g, "+");
  } catch {
    return null;
  }
  if (!p) return null;
  let json: unknown;
  try {
    const b64 = p.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    json = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) return null;
  const d = parsed.data;
  const cuit = intStr(d.cuit);
  const tipo = intStr(d.tipoCmp);
  const ptoVta = intStr(d.ptoVta);
  const nro = intStr(d.nroCmp);
  const importe = formatImporte(d.importe);
  const fecha = normalizeDate(d.fecha);
  if (!cuit || cuit.length !== 11 || !tipo || !ptoVta || !nro || !importe || !fecha) return null;
  const docTipo = d.tipoDocRec == null ? null : intStr(d.tipoDocRec);
  const docNro = d.nroDocRec == null ? null : intStr(d.nroDocRec);
  const receptor = docTipo !== null && docNro !== null && BigInt(docNro) !== BigInt(0);
  return {
    json,
    fields: {
      cuit: BigInt(cuit),
      tipo: Number(tipo),
      ptoVta: Number(ptoVta),
      nro: BigInt(nro),
      importe,
      fecha,
      moneda: d.moneda,
      receptorDocTipo: receptor ? Number(docTipo) : null,
      receptorDocNro: receptor ? BigInt(docNro!) : null,
      cae: d.codAut == null ? null : String(d.codAut),
    },
  };
}
