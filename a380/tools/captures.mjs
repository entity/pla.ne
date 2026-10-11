#!/usr/bin/env node
// a380/tools/captures.mjs (follow-up package verify, item 52; P17): regenerate the release capture set, the final
// pass's a380/shots/final list, from the pages into a380/shots/<run>/ (PNGs are never committed: a380/shots is ignored).
//
//   node a380/tools/captures.mjs --run <name> [--dark a380/a380.html] [--light a380/a380-light.html]
//                                [--only gate,lineup,…] [--jobs 2] [--list]
//
// Per theme (bearings are b = 40° − turn): gate, line-up and the climb at b45, b−130, b100; take-off at b45, b20,
// b−20 and its landing lights at 4× (b20, b−20); every door open at b100, b170, b−80; the cutaway at b100, b−80; the
// Upper deck, Main deck, First and Cockpit Inspect views; the Door M2L view; the phone (390 px, DPR 3) at the gate and
// line-up; and lines.mjs with its marks (lines-<theme>.png). 28 PNGs per theme, as the final pass. Each drive is
// written to <run>/drives/ and its log to <run>/logs/; every PNG must then be read.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const argv = process.argv.slice(2);
const value = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : fallback;
};
const run = value("--run", argv.includes("--list") ? "release" : null); // --list alone prints the set as a run named "release"
if (!run) {
  console.log("usage: node a380/tools/captures.mjs --run <name> [--dark page] [--light page] [--only a,b] [--jobs 2] [--list]");
  process.exit(1);
}
const pages = { dark: resolve(value("--dark", join(ROOT, "a380/a380.html"))), light: resolve(value("--light", join(ROOT, "a380/a380-light.html"))) };
const out = join(ROOT, "a380/shots", run);
const only = value("--only", null)?.split(",");
const READY = ["until", "window.__a380 && window.__a380.state && window.__a380.controller", 240000];
const READOUT = "document.querySelector('[data-readout]').textContent";
// the page's own state still between two polls (the final pass's settle condition)
const settled = (phase) => ["until", `(()=>{const s=__a380.state; const r=${READOUT}+JSON.stringify(s.doors)+s.flap+s.slat+s.height.toFixed(1)+s.speed.toFixed(1); const ok=r===window.__ro; window.__ro=r; return ok && s.phase==='${phase}' && !__a380.pv.seek; })()`, 150000];
const doorsStill = ["until", "(()=>{const r=JSON.stringify(__a380.state.doors); const ok=r===window.__ro; window.__ro=r; return ok})()", 60000];
const renderer = ["eval", "'renderer ' + ((__a380.glInfo && __a380.glInfo.renderer) || 'none (fallback)')"];
const shot = (theme, name, scale = 2, sel = null, region = undefined) => ["shot", join(out, `${theme}-${name}.png`), sel, scale, ...(region ? [region] : [])];
const three = (theme, key, phase, name, wait = [settled(phase)]) => [READY, ["wait", 1500], renderer, ["key", key], ["until", `__a380.state.phase==='${phase}' && !__a380.pv.seek`, 90000], ["wait", 2000], ...wait, ["wait", 1500], ["eval", `'mode '+__a380.pv.mode+' · '+${READOUT}`], ["turn", -5], ["wait", 1200], shot(theme, `${name}-b45`), ["turn", 170], ["wait", 1200], shot(theme, `${name}-b-130`), ["turn", -60], ["wait", 1200], shot(theme, `${name}-b100`)];
const fast = `__a380.state.phase==='TAKEOFF' && !__a380.pv.seek && +(/(\\d+) kt/.exec(${READOUT})||[0,0])[1] > 100`;
const SETS = {
  gate: (t) => three(t, "1", "GATE", "gate"),
  lineup: (t) => three(t, "4", "LINEUP", "lineup"),
  climb: (t) => three(t, "6", "CLIMB", "climb", [["until", "__a380.state.phase==='CLIMB' && !__a380.pv.seek && __a380.state.slat===0 && __a380.state.flap===0 && __a380.state.gear.stage==='up'", 150000], ["wait", 4000]]),
  takeoff: (t) => [READY, ["wait", 1500], renderer, ["key", "5"], ["until", fast, 90000], ["key", " "], ["wait", 800], ["eval", `${READOUT}+' lights '+JSON.stringify(__a380.state.lights)`], ["turn", -5], ["wait", 1500], shot(t, "takeoff-b45"), ["turn", 20], ["wait", 1500], shot(t, "takeoff-b20"), ["turn", 60], ["wait", 1500], shot(t, "takeoff-b-20")],
  lights: (t) => [READY, ["wait", 1500], renderer, ["key", "5"], ["until", fast, 90000], ["key", " "], ["wait", 800], ["turn", 20], ["wait", 1500], shot(t, "takeoff-lights-b20-4x", 4, null, [430, 370, 300, 290]), ["turn", 60], ["wait", 1500], shot(t, "takeoff-lights-b-20-4x", 4, null, [320, 390, 320, 270])],
  doors: (t) => [READY, ["wait", 1500], renderer, ["key", "1"], ["until", "__a380.state.phase==='GATE' && !__a380.pv.seek", 60000], ["wait", 2000], doorsStill, ["wait", 1000], ["key", "d"], ["until", "Object.values(__a380.state.doors).every(v=>v===0)", 60000], ["wait", 1000], ["key", "d"], ["until", "Object.values(__a380.state.doors).every(v=>v===1)", 90000], ["wait", 1500], ["eval", `JSON.stringify(__a380.state.doors)`], ["turn", -60], ["wait", 1500], shot(t, "doors-all-open-b100"), ["turn", -130], ["wait", 1500], shot(t, "doors-all-open-b170"), ["turn", 120], ["wait", 1500], shot(t, "doors-all-open-b-80")],
  cutaway: (t) => [READY, ["wait", 1500], renderer, ["key", "1"], ["until", "__a380.state.phase==='GATE' && !__a380.pv.seek", 60000], ["wait", 2000], doorsStill, ["wait", 3000], ["key", "c"], ["wait", 5500], ["eval", "'cabin '+__a380.pv.cabin+' target '+__a380.pv.cabinTarget"], ["turn", -60], ["wait", 1500], shot(t, "cutaway-b100"), ["turn", 120], ["wait", 1500], shot(t, "cutaway-b-80"), ...["upper", "main", "first", "cockpit"].flatMap((v) => [["eval", `__a380.inspect.step(0,'${v}'); 1`], ["wait", 4500], shot(t, `inspect-${v}`)]), ["key", "Escape"], ["wait", 1500], ["key", "c"], ["wait", 5000], ["eval", "__a380.inspect.step(0,'door-M2L'); 1"], ["wait", 4500], shot(t, "doors-M2L"), ["key", "Escape"], ["wait", 1500]],
  phone: (t) => [READY, ["wait", 1500], renderer, ["key", "1"], ["until", "__a380.state.phase==='GATE' && !__a380.pv.seek", 60000], ["wait", 2000], doorsStill, ["wait", 3000], ["turn", -5], ["wait", 1500], shot(t, "phone-gate", 3, "figure"), ["key", "4"], ["until", "__a380.state.phase==='LINEUP' && !__a380.pv.seek", 60000], ["wait", 6000], ["key", " "], ["wait", 800], ["turn", -5], ["wait", 1500], shot(t, "phone-lineup", 3, ".iso-plate")],
};
const jobs = [];
for (const theme of ["dark", "light"])
  for (const [name, make] of Object.entries(SETS)) {
    if (only && !only.includes(name)) continue;
    jobs.push({ theme, name, actions: make(theme), flags: name === "phone" ? ["--width", "390", "--height", "844"] : [] });
  }
const linesJobs = !only || only.includes("lines") ? ["dark", "light"] : [];
if (argv.includes("--list")) {
  for (const j of jobs) console.log(`${j.theme} ${j.name}: ${j.actions.filter((a) => a[0] === "shot").map((a) => a[1].replace(ROOT + "/", "")).join(", ")}`);
  for (const t of linesJobs) console.log(`${t} lines: a380/shots/${run}/lines-${t}.png`);
  console.log(`${jobs.reduce((n, j) => n + j.actions.filter((a) => a[0] === "shot").length, 0) + linesJobs.length} PNGs`);
  process.exit(0);
}
mkdirSync(join(out, "drives"), { recursive: true });
mkdirSync(join(out, "logs"), { recursive: true });
const exec = (args, log) =>
  new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (c) => (text += c));
    child.stderr.on("data", (c) => (text += c));
    child.on("exit", (code) => {
      writeFileSync(log, text);
      done({ code, text });
    });
  });
const tasks = [
  ...jobs.map((j) => async () => {
    const file = join(out, "drives", `${j.theme}-${j.name}.json`);
    writeFileSync(file, JSON.stringify(j.actions));
    const r = await exec([join(ROOT, "scripts/drive.mjs"), pages[j.theme], "--actions", file, ...j.flags], join(out, "logs", `${j.theme}-${j.name}.txt`));
    const rend = (/renderer ([^"]+)/.exec(r.text) || [])[1] ?? "?";
    console.log(`${j.theme} ${j.name}: exit ${r.code} · ${(r.text.match(/^shot /gm) || []).length} shots · ${/swiftshader/i.test(rend) ? "SwiftShader (the GPU fell back)" : rend} · ${(r.text.match(/console: clean/) ? "console clean" : "CONSOLE PROBLEMS, see the log")}`);
  }),
  ...linesJobs.map((t) => async () => {
    const r = await exec([join(ROOT, "scripts/lines.mjs"), pages[t], "--wait", "4000", "--out", join(out, `lines-${t}.png`)], join(out, "logs", `${t}-lines.txt`));
    console.log(`${t} lines: ${(/line ends: [^\n]*/.exec(r.text) || ["no result"])[0]} · ${r.text.includes("console: clean") ? "console clean" : "CONSOLE PROBLEMS"}`);
  }),
];
let next = 0;
const width = Math.max(1, Number(value("--jobs", 2)));
await Promise.all(Array.from({ length: width }, async () => {
  while (next < tasks.length) await tasks[next++]();
}));
console.log(`captures in a380/shots/${run}/ (read every PNG before judging it)`);
