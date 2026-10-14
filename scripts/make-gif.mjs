#!/usr/bin/env node
/**
 * Stitch captured PNG frames into an animation for the README.
 *
 *   node scripts/make-gif.mjs [framesDir] [out] [--delay=ms] [--every=n]
 *
 * Defaults: docs/media/frames -> docs/media/flight-deck.png, 400 ms per
 * frame, every frame. The output is an animated PNG (APNG), which GitHub and
 * every current browser play like a GIF, built with no dependencies by
 * re-chunking the frames' existing image data. If ffmpeg is on PATH a real
 * .gif is written alongside it as well.
 *
 * All frames must have the same dimensions (scripts/capture.sh guarantees it).
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
const option = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const framesDir = positional[0] || "docs/media/frames";
const outPath = positional[1] || "docs/media/flight-deck.png";
const delayMs = Number(option("delay", 400));
const every = Math.max(1, Number(option("every", 1)));

// ---- PNG chunk helpers -------------------------------------------------------

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function readChunks(file) {
  const buf = fs.readFileSync(file);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error(`${file} is not a PNG`);
  const chunks = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    chunks.push({ type, data });
    off += 12 + len;
  }
  return chunks;
}

// ---- Build the APNG -----------------------------------------------------------

const files = fs
  .readdirSync(framesDir)
  .filter((f) => f.toLowerCase().endsWith(".png"))
  .sort()
  .filter((_, i) => i % every === 0)
  .map((f) => path.join(framesDir, f));

if (files.length < 2) {
  console.error(`need at least two frames in ${framesDir}, found ${files.length}`);
  process.exit(1);
}

const frames = files.map(readChunks);
const ihdr = frames[0].find((c) => c.type === "IHDR");
const width = ihdr.data.readUInt32BE(0);
const height = ihdr.data.readUInt32BE(4);
for (const [i, f] of frames.entries()) {
  const h = f.find((c) => c.type === "IHDR");
  if (!h.data.equals(ihdr.data)) throw new Error(`${files[i]} differs in size or format from the first frame`);
}

const parts = [SIGNATURE, chunk("IHDR", ihdr.data)];
// Carry colour metadata from the first frame, if any.
for (const c of frames[0]) if (["sRGB", "gAMA", "iCCP", "pHYs"].includes(c.type)) parts.push(chunk(c.type, c.data));

const actl = Buffer.alloc(8);
actl.writeUInt32BE(frames.length, 0);
actl.writeUInt32BE(0, 4); // loop forever
parts.push(chunk("acTL", actl));

let seq = 0;
const delayDen = 1000;
for (const [i, f] of frames.entries()) {
  const fctl = Buffer.alloc(26);
  fctl.writeUInt32BE(seq++, 0);
  fctl.writeUInt32BE(width, 4);
  fctl.writeUInt32BE(height, 8);
  fctl.writeUInt32BE(0, 12); // x offset
  fctl.writeUInt32BE(0, 16); // y offset
  fctl.writeUInt16BE(delayMs, 20);
  fctl.writeUInt16BE(delayDen, 22);
  fctl[24] = 0; // dispose: none
  fctl[25] = 0; // blend: source
  parts.push(chunk("fcTL", fctl));
  for (const c of f.filter((c) => c.type === "IDAT")) {
    if (i === 0) parts.push(chunk("IDAT", c.data));
    else {
      const s = Buffer.alloc(4);
      s.writeUInt32BE(seq++);
      parts.push(chunk("fdAT", Buffer.concat([s, c.data])));
    }
  }
}
parts.push(chunk("IEND", Buffer.alloc(0)));

fs.mkdirSync(path.dirname(outPath), { recursive: true });
const out = Buffer.concat(parts);
fs.writeFileSync(outPath, out);
console.log(`${outPath}: ${frames.length} frames, ${width}x${height}, ${delayMs} ms/frame, ${(out.length / 1024 / 1024).toFixed(1)} MB`);

// ---- Optional real GIF via ffmpeg ---------------------------------------------

try {
  execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
  const gifPath = outPath.replace(/\.png$/i, "") + ".gif";
  const fps = Math.max(1, Math.round(1000 / delayMs));
  const list = path.join(framesDir, ".frames.txt");
  fs.writeFileSync(list, files.map((f) => `file '${path.resolve(f)}'\nduration ${delayMs / 1000}`).join("\n") + "\n");
  execFileSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", `fps=${fps},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer`, "-loop", "0", gifPath],
    { stdio: "inherit" },
  );
  fs.unlinkSync(list);
  console.log(`${gifPath}: ${(fs.statSync(gifPath).size / 1024 / 1024).toFixed(1)} MB`);
} catch {
  console.log("ffmpeg not found; skipped the .gif (the .png above animates in GitHub and browsers)");
}
