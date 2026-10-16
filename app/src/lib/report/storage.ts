// Where published PDFs live: Vercel Blob when BLOB_READ_WRITE_TOKEN is set, otherwise local disk.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";

export type PdfStorage = (period: string, bytes: Uint8Array, cooperadoraId?: number) => Promise<string>;

/**
 * Returns the URL (blob) or a `file:` path (local disk) of the stored PDF. Each cooperative gets its
 * own folder; the demo keeps the original path.
 */
export const storePdf: PdfStorage = async (period, bytes, cooperadoraId) => {
  const folder = cooperadoraId == null || cooperadoraId === 1 ? "rendiciones" : `rendiciones/${cooperadoraId}`;
  const name = `${folder}/rendicion-${period}.pdf`;
  if (env().BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const blob = await put(name, Buffer.from(bytes), {
      access: "public", contentType: "application/pdf", addRandomSuffix: false, allowOverwrite: true,
    });
    return blob.url;
  }
  const file = path.join(process.cwd(), ".data", name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return `file:${file}`;
};
