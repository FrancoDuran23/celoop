// Synthetic fixtures generated in memory (no binaries committed).
import { deflateSync } from "node:zlib";
import QRCode from "qrcode";
import sharp from "sharp";

export const COOP_CUIT = BigInt(30712345678);

export const samplePayload = {
  ver: 1,
  fecha: "2026-09-20",
  cuit: 20123456786,
  ptoVta: 3,
  tipoCmp: 11,
  nroCmp: 1457,
  importe: 12500,
  moneda: "PES",
  ctz: 1,
  tipoDocRec: 80,
  nroDocRec: 30712345678,
  tipoCodAut: "E",
  codAut: 74123456789012,
};

export function arcaUrl(payload: object = samplePayload, opts: { urlSafe?: boolean; noPad?: boolean; host?: string } = {}) {
  let b64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  if (opts.urlSafe) b64 = b64.replace(/\+/g, "-").replace(/\//g, "_");
  if (opts.noPad) b64 = b64.replace(/=+$/, "");
  return `https://${opts.host ?? "www.afip.gob.ar"}/fe/qr/?p=${b64}`;
}

export async function qrPng(text: string, size = 360): Promise<Buffer> {
  return QRCode.toBuffer(text, { width: size, margin: 4, errorCorrectionLevel: "M" });
}

/** A "Factura C" page: header text, a line of body text, and the QR at the bottom. */
export async function invoicePng(text: string, extraSvg = ""): Promise<Buffer> {
  const qr = await qrPng(text, 300);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000">
    <rect width="800" height="1000" fill="#fff"/>
    <text x="40" y="80" font-size="40" font-family="sans-serif" fill="#000">FACTURA C</text>
    <text x="40" y="140" font-size="22" font-family="sans-serif" fill="#000">Libreria Don Pepe - Cod. 11</text>
    <text x="40" y="180" font-size="22" font-family="sans-serif" fill="#000">Total: $ 12.500,00</text>${extraSvg}
  </svg>`;
  return sharp(Buffer.from(svg)).composite([{ input: qr, left: 40, top: 640 }]).png().toBuffer();
}

/** A tilted, low-contrast, slightly blurred "photo" of an invoice. */
export async function hardPhoto(text: string): Promise<Buffer> {
  const page = await invoicePng(text);
  return sharp(page)
    .rotate(12, { background: "#cfcfcf" })
    .linear(0.35, 110) // wash out the contrast
    .blur(0.8)
    .jpeg({ quality: 70 })
    .toBuffer();
}

/** A one-page PDF with the image embedded plus a text layer. */
export async function pdfWith(image: Buffer, text: string): Promise<Uint8Array> {
  const { data, info } = await sharp(image).flatten({ background: "#fff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pix = deflateSync(data);
  const W = info.width;
  const H = info.height;
  const content = `q ${W * 0.6} 0 0 ${H * 0.6} 20 20 cm /Im0 Do Q BT /F1 12 Tf 20 ${H * 0.6 + 40} Td (${text.replace(/[()\\]/g, "")}) Tj ET`;
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let len = 0;
  const push = (b: Buffer | string) => {
    const buf = typeof b === "string" ? Buffer.from(b, "latin1") : b;
    parts.push(buf);
    len += buf.length;
  };
  const obj = (n: number, body: Buffer | string) => {
    offsets[n] = len;
    push(`${n} 0 obj\n`);
    push(body);
    push("\nendobj\n");
  };
  push("%PDF-1.4\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${Math.ceil(W * 0.6 + 40)} ${Math.ceil(H * 0.6 + 80)}] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> /Font << /F1 6 0 R >> >> >>`,
  );
  obj(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  obj(
    5,
    Buffer.concat([
      Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${pix.length} >>\nstream\n`, "latin1"),
      pix,
      Buffer.from("\nendstream", "latin1"),
    ]),
  );
  obj(6, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const xref = len;
  push(`xref\n0 7\n0000000000 65535 f \n`);
  for (let i = 1; i <= 6; i++) push(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Uint8Array(Buffer.concat(parts));
}
