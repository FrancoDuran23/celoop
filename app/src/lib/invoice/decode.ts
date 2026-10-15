import sharp, { type Sharp } from "sharp";
import { parseArcaQr } from "./qr";
import type { InvoiceFields } from "./types";

export type QrHit = { fields: InvoiceFields; json: unknown; text: string };

type Raw = { data: Uint8ClampedArray; width: number; height: number };

async function zxingTexts(img: Raw): Promise<string[]> {
  try {
    const { readBarcodes } = await import("zxing-wasm/reader");
    const results = await readBarcodes(
      { data: img.data, width: img.width, height: img.height, colorSpace: "srgb" } as unknown as ImageData,
      { formats: ["QRCode"], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, maxNumberOfSymbols: 4 },
    );
    return results.filter((r) => r.isValid && r.text).map((r) => r.text);
  } catch {
    return [];
  }
}

async function jsqrTexts(img: Raw): Promise<string[]> {
  try {
    const { default: jsQR } = await import("jsqr");
    const r = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
    return r?.data ? [r.data] : [];
  } catch {
    return [];
  }
}

async function toRaw(pipeline: Sharp): Promise<Raw> {
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), width: info.width, height: info.height };
}

function firstArca(texts: string[]): QrHit | null {
  for (const text of texts) {
    const parsed = parseArcaQr(text);
    if (parsed) return { ...parsed, text };
  }
  return null;
}

/**
 * Looks for an ARCA QR in an image: original first, then preprocessed variants
 * (grayscale + contrast, rescaling, rotations). zxing-wasm first, jsqr as fallback.
 */
export async function findArcaQrInImage(bytes: Uint8Array): Promise<QrHit | null> {
  const base = sharp(Buffer.from(bytes), { failOn: "none" }).rotate(); // honor EXIF orientation
  const meta = await base.metadata().catch(() => null);
  if (!meta?.width || !meta.height) return null;
  const longSide = Math.max(meta.width, meta.height);

  const variants: Array<() => Promise<Raw>> = [
    () => toRaw(base.clone().flatten({ background: "#fff" })),
    () => toRaw(base.clone().flatten({ background: "#fff" }).grayscale().normalise().sharpen()),
  ];
  // Rescales: shrink big photos, enlarge small ones.
  for (const target of [1200, 2000, 700]) {
    if (Math.abs(target - longSide) < 100) continue;
    variants.push(() =>
      toRaw(base.clone().flatten({ background: "#fff" }).resize({ width: target, height: target, fit: "inside" }).grayscale().normalise()),
    );
  }
  variants.push(() => toRaw(base.clone().flatten({ background: "#fff" }).grayscale().normalise().threshold(128)));
  variants.push(() => toRaw(base.clone().flatten({ background: "#fff" }).grayscale().linear(1.8, -90).median(3)));
  for (const angle of [90, 180, 270, 15, -15, 30, -30, 45, -45]) {
    variants.push(() =>
      toRaw(base.clone().flatten({ background: "#fff" }).rotate(angle, { background: "#fff" }).grayscale().normalise()),
    );
  }

  const rawCache: Raw[] = [];
  for (const make of variants) {
    let raw: Raw;
    try {
      raw = await make();
    } catch {
      continue;
    }
    rawCache.push(raw);
    const hit = firstArca(await zxingTexts(raw));
    if (hit) return hit;
  }
  // jsqr fallback, over the first (cheaper) variants.
  for (const raw of rawCache.slice(0, 4)) {
    const hit = firstArca(await jsqrTexts(raw));
    if (hit) return hit;
  }
  return null;
}
