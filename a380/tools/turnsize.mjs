// a380/tools/turnsize.mjs (follow-up package verify, item 52: a tracked copy of round 3's shots/review-3-audits/turnsize.mjs):
// the size of a built page's data.turn by key, kind and prefix.   node a380/tools/turnsize.mjs <page.html>
// (review round 1, fu/r1-verify) A shipping page carries data.turn (and the GL data and the live layers' markup)
// deflated in one payload (build.mjs: atob("…") inflated with DecompressionStream("deflate-raw") before the figure
// mounts), so `"turn":` in DATA is the placeholder A3P.turn there: the payload is inflated here (zlib.inflateRawSync,
// the same raw deflate) and data.turn read from it. A verify page keeps data.turn inline in DATA.
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
const page = readFileSync(process.argv[2], "utf8");
let turn;
let raw;
const loader = page.indexOf("const A3P = await");
if (loader >= 0) {
  const open = page.indexOf("atob(", loader) + "atob(".length;
  const close = page.indexOf(");", open);
  const b64 = JSON.parse(page.slice(open, close));
  const json = inflateRawSync(Buffer.from(b64, "base64")).toString("utf8");
  const payload = JSON.parse(json);
  turn = payload.turn;
  raw = JSON.stringify(turn);
  const kb = (x) => (x / 1024).toFixed(0);
  console.log(`payload: ${kb(json.length)} KB inflated (${kb(b64.length)} KB of base64 in the page, ${kb(Buffer.from(b64, "base64").length)} KB deflated) · ${Object.entries(payload).map(([k, v]) => `${k} ${kb(JSON.stringify(v).length)} KB`).join(" · ")}`);
} else {
  const at = page.indexOf('"turn":', page.indexOf("const DATA = "));
  let i = page.indexOf("{", at), depth = 0, inStr = false;
  const start = i;
  for (; i < page.length; i++) {
    const c = page[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === "{" || c === "[") depth++; else if (c === "}" || c === "]") { depth--; if (!depth) break; }
  }
  raw = page.slice(start, i + 1);
  turn = JSON.parse(raw);
}
if (!turn || typeof turn !== "object" || !Array.isArray(turn.parts)) {
  console.log("turnsize: no data.turn found in this page (neither a payload nor DATA.turn)");
  process.exit(1);
}
const size = (x) => JSON.stringify(x).length;
console.log("data.turn", (size(turn) / 1024).toFixed(0), "KB");
// fu/r2-perf: the parts' common fields as columns (kit patch 35): names and kinds put back for the tables below
if (turn.cols) {
  let prev = "";
  const names = turn.cols.name.split("|").map((code) => (prev = prev.slice(0, parseInt(code[0], 36)) + code.slice(1)));
  const kindOf = (i) => (turn.cols.kind ? turn.cols.kind.v[parseInt(turn.cols.kind.c.substr(i * turn.cols.kind.w, turn.cols.kind.w), 36)] : undefined);
  console.log(`columns: ${turn.cols.fields.join(", ")} and the names, ${(size(turn.cols) / 1024).toFixed(0)} KB`);
  turn = { ...turn, parts: turn.parts.map((p, i) => ({ name: names[i], kind: kindOf(i), ...p })) };
} // fu/r2-perf end
const walk = (obj, path, depthLeft) => {
  const rows = Object.entries(obj).map(([k, v]) => [k, size(v), v]).sort((a, b) => b[1] - a[1]);
  for (const [k, s, v] of rows.slice(0, 10)) {
    if (s < 10240) continue;
    console.log(`${"  ".repeat(3 - depthLeft)}${path}${k}: ${(s / 1024).toFixed(0)} KB${Array.isArray(v) ? ` (${v.length} items)` : ""}`);
    if (depthLeft > 1 && v && typeof v === "object" && !Array.isArray(v)) walk(v, `${path}${k}.`, depthLeft - 1);
    if (depthLeft > 1 && Array.isArray(v) && v.length && typeof v[0] === "object" && v[0] && !Array.isArray(v[0])) {
      const keys = {};
      for (const it of v) for (const [kk, vv] of Object.entries(it)) keys[kk] = (keys[kk] ?? 0) + size(vv);
      console.log(`${"  ".repeat(4 - depthLeft)}per-item keys: ${Object.entries(keys).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([kk, s2]) => `${kk} ${(s2 / 1024).toFixed(0)} KB`).join(" · ")}`);
    }
  }
};
walk(turn, "", 3);
// numeric precision: count digits after the decimal point in the raw text
const nums = raw.match(/-?\d+\.\d+/g) ?? [];
const dec = nums.reduce((s, n) => s + n.split(".")[1].length, 0);
console.log(`numbers with decimals: ${nums.length} · mean decimals ${(dec / nums.length).toFixed(2)} · bytes in numbers ${(nums.reduce((s, n) => s + n.length, 0) / 1024).toFixed(0)} KB`);
const byPrefix = {};
for (const p of turn.parts) { const k = p.name.split(".").slice(0, 2).join("."); byPrefix[k] = (byPrefix[k] ?? 0) + size(p); }
console.log("parts by prefix:", Object.entries(byPrefix).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, s]) => `${k} ${(s / 1024).toFixed(0)}`).join(" · "));
const kinds = {};
for (const p of turn.parts) { kinds[p.kind] = (kinds[p.kind] ?? [0, 0]); kinds[p.kind][0]++; kinds[p.kind][1] += size(p); }
console.log("by kind:", Object.entries(kinds).map(([k, [n, s]]) => `${k} ${n} parts ${(s / 1024).toFixed(0)} KB`).join(" · "));
const fr = turn.framed.airframe;
console.log("framed keys:", Array.isArray(fr) ? `array ${fr.length}` : Object.keys(fr).slice(0, 10).join(","), Array.isArray(fr) ? JSON.stringify(fr[0]).slice(0, 200) : Object.entries(fr).slice(0,3).map(([k,v])=>k+":"+JSON.stringify(v).slice(0,150)).join(" | "));
const kinds2 = {};
for (const p of turn.parts) { const free = /^(cabin|cockpit)/.test(p.name) ? "free" : "fixed"; const k = `${p.kind}/${free}`; kinds2[k] = (kinds2[k] ?? 0) + 1; }
console.log("kind by free group:", JSON.stringify(kinds2));
