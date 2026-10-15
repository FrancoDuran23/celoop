import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const MAX_PAGES = 5;

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let lib: Promise<PdfJs> | undefined;

function load(): Promise<PdfJs> {
  lib ??= (async () => {
    const m = await import("pdfjs-dist/legacy/build/pdf.mjs");
    try {
      const worker = createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
      m.GlobalWorkerOptions.workerSrc = pathToFileURL(worker).href;
    } catch {
      // pdfjs falls back to its own resolution
    }
    return m;
  })();
  return lib;
}

export type PdfContent = { pagePngs: Uint8Array[]; text: string };

/** Renders up to MAX_PAGES pages to PNG and extracts the text layer. */
export async function readPdf(bytes: Uint8Array): Promise<PdfContent> {
  const pdfjs = await load();
  const { createCanvas } = await import("@napi-rs/canvas");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes), // pdfjs transfers/detaches the buffer
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  const pagePngs: Uint8Array[] = [];
  const texts: string[] = [];
  try {
    const pages = Math.min(doc.numPages, MAX_PAGES);
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      try {
        const content = await page.getTextContent();
        texts.push(content.items.map((it) => ("str" in it ? it.str : "")).join(" "));
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(3, Math.max(1.5, 1600 / Math.max(base.width, base.height)));
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          canvas: canvas as unknown as HTMLCanvasElement,
          viewport,
        }).promise;
        pagePngs.push(new Uint8Array(canvas.toBuffer("image/png")));
      } finally {
        page.cleanup();
      }
    }
  } finally {
    await task.destroy();
  }
  return { pagePngs, text: texts.join("\n").trim() };
}
