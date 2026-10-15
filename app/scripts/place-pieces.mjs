// Find where each hand-cut piece sits in the original illustration (coarse search at 1/8 scale,
// then refine at full scale), write the pieces as webp plus pieces.json, and a check composite.
import sharp from "sharp";
import { readdirSync, writeFileSync, mkdirSync } from "node:fs";
const [,, original, piecesDir, outDir, checkPng] = process.argv;
mkdirSync(outDir, { recursive: true });

async function raw(input, width) {
  const img = width ? sharp(input).resize({ width, kernel: "lanczos3" }) : sharp(input);
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}
const full = await raw(original);
const F = 8;
const coarse = await raw(original, Math.round(full.w / F));

function score(base, piece, ox, oy, step) {
  // mean squared colour error over opaque piece pixels, sampled every `step`
  let err = 0, n = 0;
  for (let y = 0; y < piece.h; y += step) for (let x = 0; x < piece.w; x += step) {
    const pi = (y * piece.w + x) * 4; if (piece.data[pi + 3] < 200) continue;
    const bx = ox + x, by = oy + y; if (bx < 0 || by < 0 || bx >= base.w || by >= base.h) { err += 3 * 255 * 255; n++; continue; }
    const bi = (by * base.w + bx) * 4;
    const dr = piece.data[pi] - base.data[bi], dg = piece.data[pi + 1] - base.data[bi + 1], db = piece.data[pi + 2] - base.data[bi + 2];
    err += dr * dr + dg * dg + db * db; n++;
  }
  return n ? err / n : Infinity;
}

const files = readdirSync(piecesDir).filter((f) => /\.png$/i.test(f)).sort();
const meta = [];
const canvas = Buffer.alloc(full.w * full.h * 4, 0);
for (let k = 0; k < files.length; k++) {
  const f = files[k];
  const p = await raw(`${piecesDir}/${f}`);
  const pc = await raw(`${piecesDir}/${f}`, Math.max(1, Math.round(p.w / F)));
  let best = { e: Infinity, x: 0, y: 0 };
  for (let y = -pc.h; y <= coarse.h; y++) for (let x = -pc.w; x <= coarse.w; x++) {
    const e = score(coarse, pc, x, y, 1); if (e < best.e) best = { e, x, y };
  }
  let fine = { e: Infinity, x: best.x * F, y: best.y * F };
  for (let y = best.y * F - F; y <= best.y * F + F; y++) for (let x = best.x * F - F; x <= best.x * F + F; x++) {
    const e = score(full, p, x, y, 2); if (e < fine.e) fine = { e, x, y };
  }
  // centroid of opaque pixels
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.data[(y * p.w + x) * 4 + 3] > 8) { sx += x; sy += y; n++;
    const bx = fine.x + x, by = fine.y + y; if (bx >= 0 && by >= 0 && bx < full.w && by < full.h) { const bi = (by * full.w + bx) * 4, pi = (y * p.w + x) * 4; canvas[bi] = p.data[pi]; canvas[bi + 1] = p.data[pi + 1]; canvas[bi + 2] = p.data[pi + 2]; canvas[bi + 3] = 255; } }
  await sharp(`${piecesDir}/${f}`).webp({ quality: 88, alphaQuality: 90 }).toFile(`${outDir}/piece-${k}.webp`);
  meta.push({ id: k, file: f, x: +(fine.x / full.w).toFixed(4), y: +(fine.y / full.h).toFixed(4), w: +(p.w / full.w).toFixed(4), h: +(p.h / full.h).toFixed(4), cx: +((fine.x + sx / n) / full.w).toFixed(4), cy: +((fine.y + sy / n) / full.h).toFixed(4) });
  console.log(f, "at", fine.x, fine.y, "rms", Math.sqrt(fine.e).toFixed(1));
}
writeFileSync(`${outDir}/pieces.json`, JSON.stringify({ width: full.w, height: full.h, pieces: meta }));
if (checkPng) await sharp(canvas, { raw: { width: full.w, height: full.h, channels: 4 } }).flatten({ background: "#bbbbbb" }).png().toFile(checkPng);
