#!/usr/bin/env node
// a380/tools/lines-sites.mjs (fu/f3-verify): the strict line gate's floating ends, as a work list for the parts' owners.
// Runs the gate drive (a380/tools/drives/verify-lines.json: the default view, the ten Inspect views and after Esc, the
// page paused) on a --verify page with each view's result written as JSON and a 4x crop around every floating end,
// then groups the ends by owner (package), part and line, with what each end could meet:
//   - "extend N px to meet X": the first visible stroke straight ahead along the line (lengthen the line, or move its
//     end, by that much);
//   - "nearest visible stroke X at N px" (and a nearer stroke that is hidden there: the line meets a stroke that a third
//     part's fill covers at that point, so on the page it ends in mid-face);
//   - "drawn on under X": the line runs on under a fill painted later and stops where it shows (the end judged is where
//     it comes out);
//   - its end in the line's own d coordinates (the units the part's source writes), and the source lines that name its
//     classes.
//   node a380/tools/lines-sites.mjs <verify page> [--out a380/tmp/lines-sites/<page name>] [--views first,upper]
//   node a380/tools/lines-sites.mjs --from <dir>      the report again over a run's JSON files (no browser)
// Writes <out>/sites.md (the report), <out>/<view>.json, <out>/<view>.png (the gate's shot, ends ringed),
// <out>/crops/<view>-NN-<part>.png and <out>/drive.txt; prints the per-owner summary. Exit 1 when any end floats.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const A380 = join(ROOT, "a380");
const argv = process.argv.slice(2);
const value = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : fallback;
};
const from = value("--from", null);
const page = argv.find((a, i) => !a.startsWith("--") && !(i && argv[i - 1].startsWith("--")));
if (!from && !page) {
  console.log("usage: node a380/tools/lines-sites.mjs <verify page> [--out dir] [--views a,b] | --from <dir>");
  process.exit(2);
}
const out = resolve(from ?? value("--out", join(A380, "tmp/lines-sites", basename(page).replace(/\.html$/, ""))));
const views = value("--views", null)?.split(",");

// owners by part-name prefix (a380/notes/followup/PLAN.md §4 and the follow-up packages' file lists)
const OWNERS = [
  [/^wings\./, "wings", ["parts/wings.mjs"]],
  [/^eng\./, "wings", ["parts/engines.mjs"]],
  [/^tail\./, "wings", ["parts/tail.mjs"]],
  [/^nose\./, "fuselage", ["parts/nose.mjs", "parts/fuselage.mjs"]],
  [/^fus\./, "fuselage", ["parts/fuselage.mjs", "world.mjs"]],
  [/^skin\./, "fuselage", ["parts/skin.mjs"]],
  [/^door\./, "fuselage", ["parts/skin.mjs"]],
  [/^(nlg|wlg|blg)\./, "gear", ["parts/gear.mjs"]],
  [/^(cockpit|cabin)\./, "interiors", ["parts/cabin.mjs", "parts/cabin-furniture.mjs", "parts/cabin-plan.mjs"]],
  [/^(stage|light)\./, "lights", ["parts/stage.mjs", "parts/lights.mjs"]],
  [/^tug\./, "interaction", ["parts/tug.mjs"]],
];
const ownerOf = (part) => OWNERS.find(([re]) => re.test(part ?? "")) ?? [null, "unknown", []];
// the lines of the owner's files that name one of the line's own classes (not the kit's iso-* or the tone words)
const KIT_WORDS = new Set(["iso-line", "iso-crease", "iso-edge", "iso-bevel", "iso-tn", "faint", "dark", "light", "lo", "mid", "hi", "deep", "pale"]);
const sourceCache = new Map();
const sourcesFor = (files, classes) => {
  const hits = [];
  for (const file of files) {
    const path = join(A380, file);
    if (!existsSync(path)) continue;
    if (!sourceCache.has(path)) sourceCache.set(path, readFileSync(path, "utf8").split("\n"));
    const lines = sourceCache.get(path);
    for (const cls of classes) {
      const at = lines.findIndex((l) => l.includes(cls));
      if (at >= 0) hits.push(`a380/${file}:${at + 1} (${cls})`);
    }
  }
  return hits;
};

if (!from) {
  const gate = JSON.parse(readFileSync(join(HERE, "drives/verify-lines.json"), "utf8"));
  const drive = [];
  for (const action of gate) {
    if (action[0] === "lines") {
      const label = basename(action[1] ?? "view.png").replace(/\.png$/, "");
      if (views && !views.includes(label)) continue;
      drive.push(["lines", join(out, `${label}.png`), action[2] ?? null, { ...(action[3] ?? {}), edges: true, strict: true, json: join(out, `${label}.json`), crops: join(out, "crops"), label }]);
    } else drive.push(action);
  }
  mkdirSync(out, { recursive: true });
  const file = join(out, "drive.json");
  writeFileSync(file, JSON.stringify(drive));
  console.log(`lines-sites: the gate drive on ${page}${views ? ` (views ${views.join(", ")})` : ""}, results in ${relative(ROOT, out)}`);
  const run = spawnSync(process.execPath, [join(ROOT, "scripts/drive.mjs"), resolve(page), "--actions", file], { encoding: "utf8", maxBuffer: 1 << 28, timeout: 3600000 });
  writeFileSync(join(out, "drive.txt"), (run.stdout ?? "") + (run.stderr ?? ""));
  for (const l of (run.stdout ?? "").split("\n")) if (/^(source|eval: "renderer|line ends|edge ends|console)/.test(l)) console.log(`  ${l.slice(0, 220)}`);
}

const results = readdirSync(out)
  .filter((f) => f.endsWith(".json") && f !== "drive.json")
  .map((f) => JSON.parse(readFileSync(join(out, f), "utf8")))
  .filter((r) => r && Array.isArray(r.problems));
const order = JSON.parse(readFileSync(join(HERE, "drives/verify-lines.json"), "utf8")).filter((a) => a[0] === "lines").map((a) => basename(a[1] ?? "").replace(/\.png$/, ""));
results.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
const rows = [];
for (const r of results)
  for (const p of r.problems) {
    const part = (p.what.match(/ in (\S+)/) || [])[1] ?? null;
    const [, owner, files] = ownerOf(part);
    const classes = p.what.replace(/ in \S+$/, "").split(/\s+/).filter((c) => c && !KIT_WORDS.has(c));
    const w = p.why ?? {};
    const fix = [
      w.ahead ? `extend ${w.ahead.dist} px to meet ${w.ahead.what}` : "nothing visible straight ahead within 48 px",
      w.nearest ? `nearest visible ${w.nearest.what} at ${w.nearest.dist} px` : "no visible stroke within 48 px",
      w.nearestAny ? `nearer but ${w.nearestAny.hidden ? "hidden there" : "not visible"}: ${w.nearestAny.what} at ${w.nearestAny.dist} px` : null,
      w.under ? `drawn on to card ${w.drawnAt?.join(",")} under ${w.under}` : null,
    ].filter(Boolean);
    rows.push({ view: r.label, zoom: r.zoom, owner, part, kind: p.edge ? "edge" : "texture", line: p.what.replace(/ in \S+$/, ""), end: p.end, gap: p.gap, length: p.length, at: p.at, local: w.local ?? null, d: p.d, fix, sources: sourcesFor(files, classes), files, crop: p.crop ? relative(out, p.crop) : null });
  }
const owners = [...new Set(rows.map((x) => x.owner))].sort();
const md = [`# Strict line gate: floating ends by owner`, "", `Page: \`${results[0]?.page ?? page}\` · views: ${results.map((r) => `${r.label} ${r.problems.filter((p) => !p.edge).length}/${r.problems.filter((p) => p.edge).length}`).join(", ")} (texture/edge ends floating) · written by \`a380/tools/lines-sites.mjs\` at ${new Date().toISOString()}.`, "", "Gaps are screen px at the view's zoom (the strict gate's tolerance is 2 px at most a viewBox px). \"end at\" is the end in the line's own d coordinates. Crops (4x, the end ringed) are beside this file.", ""];
const summary = [];
for (const owner of owners) {
  const mine = rows.filter((x) => x.owner === owner);
  const parts = [...new Set(mine.map((x) => x.part))];
  summary.push(`${owner}: ${mine.length} end${mine.length === 1 ? "" : "s"} (${parts.map((pt) => `${pt} ${mine.filter((x) => x.part === pt).length} in ${[...new Set(mine.filter((x) => x.part === pt).map((x) => x.view))].join("/")}`).join("; ")})`);
  md.push(`## ${owner} (${mine.length})`, "");
  for (const part of parts) {
    const list = mine.filter((x) => x.part === part);
    md.push(`### ${part} (${list.length}; ${list[0].files.map((f) => `a380/${f}`).join(", ")})`, "");
    const src = [...new Set(list.flatMap((x) => x.sources))];
    if (src.length) md.push(`Source lines naming the classes: ${src.map((s) => `\`${s}\``).join(", ")}.`, "");
    md.push("| View | Line | End | Gap px | Length px | End at (d units) | At card | Could meet | Crop |", "|---|---|---|---|---|---|---|---|---|");
    for (const x of list.sort((a, b) => b.gap - a.gap)) md.push(`| ${x.view} (${x.zoom}x) | ${x.kind === "edge" ? "edge " : ""}\`${x.line}\` | ${x.end} | ${x.gap.toFixed(2)} | ${x.length} | ${x.local ? x.local.join(", ") : "–"} | ${x.at.join(", ")} | ${x.fix.join("; ")} | ${x.crop ? `\`${x.crop}\`` : "–"} |`);
    md.push("");
  }
}
if (!rows.length) md.push("No floating end in any view.");
writeFileSync(join(out, "sites.md"), md.join("\n") + "\n");
console.log(`lines-sites: ${rows.length} floating end${rows.length === 1 ? "" : "s"} in ${results.length} views${rows.length ? ":" : ""}`);
for (const s of summary) console.log(`  ${s}`);
console.log(`report: ${relative(ROOT, join(out, "sites.md"))}`);
process.exit(rows.length ? 1 : 0);
