// Tile PNGs into one contact sheet through headless Chrome (no imaging library on this machine).
//   node a380/tools/sheet.mjs <out.png> <columns> <cell width px> <img…>
import { writeFileSync } from "node:fs";
import { dirname, basename, resolve, relative } from "node:path";
import { spawnSync } from "node:child_process";
const [out, cols, cellW, ...imgs] = process.argv.slice(2);
const dir = dirname(resolve(out));
const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#888;font:12px monospace}
.g{display:grid;grid-template-columns:repeat(${cols},${cellW}px);gap:4px;padding:4px}
figure{margin:0;background:#fff}figcaption{padding:2px 4px}img{display:block;width:${cellW}px;height:auto}</style>
<div class="g">${imgs.map((p) => `<figure><img src="${relative(dir, resolve(p))}"><figcaption>${basename(p)}</figcaption></figure>`).join("")}</div>`;
const page = resolve(dir, `.${basename(out, ".png")}.html`);
writeFileSync(page, html);
const width = Number(cols) * (Number(cellW) + 4) + 4;
const r = spawnSync(process.execPath, [resolve(dirname(new URL(import.meta.url).pathname), "../../scripts/drive.mjs"), page, JSON.stringify([["wait", 800], ["shot", resolve(out), ".g"]]), "--width", String(width), "--height", "1200"], { encoding: "utf8" });
process.stdout.write(r.stdout.split("\n").filter((l) => l.startsWith("shot") || l.includes("error")).join("\n") + "\n");
