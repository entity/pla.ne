#!/usr/bin/env node
// a380/tools/png-diff.mjs (theme switch): compare two PNG captures pixel for pixel, with no dependencies.
//
//   node a380/tools/png-diff.mjs a.png b.png [--out diff.png] [--tol 8]
//   node a380/tools/png-diff.mjs --dirs dirA dirB [--out diffdir] [--tol 8]     every PNG name the two folders share
//
// Prints, per pair: the size, the pixels whose largest channel difference is over --tol (count and share), the largest
// difference, the mean difference, and the bounding box of the pixels over --tol. --out writes a diff image: the first
// image dimmed to a quarter, pixels over the tolerance in red (brighter the larger the difference).
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import { inflateSync, deflateSync } from "node:zlib";

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let p = 8;
  let w = 0, h = 0, depth = 0, type = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const kind = buf.toString("latin1", p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      if (data[12]) throw new Error("interlaced PNGs are not read");
    } else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8 || ![2, 6, 0, 4].includes(type)) throw new Error(`PNG depth ${depth} type ${type} not read`);
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = new Uint8Array(w * h * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (ch >= 3) {
        out[o] = cur[x * ch];
        out[o + 1] = cur[x * ch + 1];
        out[o + 2] = cur[x * ch + 2];
        out[o + 3] = ch === 4 ? cur[x * ch + 3] : 255;
      } else {
        out[o] = out[o + 1] = out[o + 2] = cur[x * ch];
        out[o + 3] = ch === 2 ? cur[x * ch + 1] : 255;
      }
    }
    prev = cur;
  }
  return { w, h, data: out };
}

export function encodePng({ w, h, data }) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (kind, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const kb = Buffer.concat([Buffer.from(kind, "latin1"), body]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(kb));
    return Buffer.concat([len, kb, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) Buffer.from(data.buffer, data.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export function diff(a, b, tol = 8) {
  if (a.w !== b.w || a.h !== b.h) return { size: `${a.w}x${a.h} vs ${b.w}x${b.h}`, mismatch: true };
  let over = 0, max = 0, sum = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  const img = new Uint8Array(a.data.length);
  for (let i = 0, n = a.w * a.h; i < n; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(a.data[o] - b.data[o]), Math.abs(a.data[o + 1] - b.data[o + 1]), Math.abs(a.data[o + 2] - b.data[o + 2]));
    sum += d;
    if (d > max) max = d;
    if (d > tol) {
      over++;
      const x = i % a.w, y = (i / a.w) | 0;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      img[o] = 128 + Math.min(127, d);
      img[o + 1] = 0;
      img[o + 2] = 0;
    } else {
      img[o] = a.data[o] >> 2;
      img[o + 1] = a.data[o + 1] >> 2;
      img[o + 2] = a.data[o + 2] >> 2;
    }
    img[o + 3] = 255;
  }
  const n = a.w * a.h;
  return { size: `${a.w}x${a.h}`, over, share: over / n, max, mean: sum / n, box: over ? [x0, y0, x1 - x0 + 1, y1 - y0 + 1] : null, image: { w: a.w, h: a.h, data: img } };
}

const MAIN = process.argv[1] && basename(process.argv[1]) === "png-diff.mjs";
if (MAIN) {
  const argv = process.argv.slice(2);
  const opt = (name, d) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : d;
  };
  const tol = Number(opt("--tol", 8));
  const out = opt("--out", null);
  const pairs = [];
  if (argv[0] === "--dirs") {
    const [da, db] = [argv[1], argv[2]];
    const names = readdirSync(da).filter((f) => f.endsWith(".png") && readdirSync(db).includes(f)).sort();
    for (const f of names) pairs.push([join(da, f), join(db, f), out ? join(out, f.replace(/\.png$/, "-diff.png")) : null]);
    if (out) mkdirSync(out, { recursive: true });
  } else pairs.push([argv[0], argv[1], out]);
  for (const [fa, fb, fo] of pairs) {
    const r = diff(decodePng(readFileSync(fa)), decodePng(readFileSync(fb)), tol);
    if (r.mismatch) {
      console.log(`${basename(fa)}: size differs, ${r.size}`);
      continue;
    }
    console.log(`${basename(fa).padEnd(36)} ${r.size}  over ${tol}: ${String(r.over).padStart(7)} px (${(r.share * 100).toFixed(3)}%)  max ${String(r.max).padStart(3)}  mean ${r.mean.toFixed(3)}${r.box ? `  box ${r.box.join(",")}` : ""}`);
    if (fo) writeFileSync(fo, encodePng(r.image));
  }
}
