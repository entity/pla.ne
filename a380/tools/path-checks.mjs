#!/usr/bin/env node
// a380/tools/path-checks.mjs (follow-up package verify, items 48 and 49): the browser's pops and order checks over every
// path `--verify` writes (a380/tmp/states-paths.json), the live phase states and every clip state, sharded over a
// few workers (each a turn-check with its own headless Chrome: a heavy process).
//
//   node a380/tools/path-checks.mjs <verify page> [--workers 3] [--only pops|order] [--jobs name,name] [--list]
//                                   [--out a380/tmp/paths] [--phase-states a380/tmp/paths/phase-states.json]
//                                   [--states-dir <dir>]  (default: the page's <page>-states/ when it exists, else a380/tmp)
//                                   [--skip-done] [--sample | --whole-stride 3] [--max-job n]
//                                   [--order-stride-hinge 100] [--order-stride-phase 50]
//
// Jobs, one per clip or phase path (its files in one run, a null between them):
//   pops  <clip>   --pops --no-webgl --states <files> --stride 25, every flagged pair re-run at the path's step
//                  (a path that turns the turntable, the push clip: every pair, --stride 1 or --turning-stride n;
//                  --sample: windows of 50 every 500; a path of one state, GATE and LINEUP: no pops job)
//                  (take-off clips and airborne phase paths, where pitch and lift move the whole airframe 0.10-0.14 px
//                  a step: --stride 3, every pair screened at most 0.42 px of outline travel apart like the hinge
//                  paths at 25; --sample keeps the quicker --windows 50:500, 10% of their steps)
//   order <clip>   --order --states <files> --order-stride 100 (phase paths: 50)
//   order clips:k  every clip frame (tmp/s-states-clips.json) in slices of 1,500
//   order phase-states  the 408 live phase states (a380/tools/phase-states.mjs)
// The strides keep a compared pair's outline travel under the 2.5 px a smooth motion may travel before the first
// difference sees it (turn-check prints the largest travel per run, and fails a run over it). Each job writes
// <out>/<kind>-<name>.txt; a summary of every job's verdict lines goes to <out>/summary.txt.
// --max-job n splits a path of more than n states into jobs of whole files (<name>.g0, .g1, …) so several workers
// share it; every file starts with the state the previous one ended on, so no pair is lost at a split.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const argv = process.argv.slice(2);
const value = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : fallback;
};
const page = argv.find((a, i) => !a.startsWith("--") && !(i && argv[i - 1].startsWith("--") && !["--list"].includes(argv[i - 1])));
if (!page && !argv.includes("--list")) {
  console.log("usage: node a380/tools/path-checks.mjs <verify page> [--workers 3] [--only pops|order] [--jobs a,b] [--list]");
  process.exit(1);
}
const tmp = join(ROOT, "a380/tmp");
const out = resolve(value("--out", join(tmp, "paths")));
// (fu/r2-verify) the states folder: --states-dir, else the page's own <page>-states/ (a --verify build with --out writes
// its states and paths there), else a380/tmp (a default verify page's). A light page reads the -light index and clip
// states when its folder has them
const light = page ? /light/.test(basename(page)) : argv.includes("--light");
const statesDir = resolve(value("--states-dir", (page && existsSync(join(dirname(resolve(page)), `${basename(page).replace(/\.html$/, "")}-states`)) ? join(dirname(resolve(page)), `${basename(page).replace(/\.html$/, "")}-states`) : tmp)));
const pick2 = (name) => (light && existsSync(join(statesDir, `${name}-light.json`)) ? join(statesDir, `${name}-light.json`) : join(statesDir, `${name}.json`));
const index = JSON.parse(readFileSync(pick2("states-paths"), "utf8"));
console.log(`states: ${pick2("states-paths")} (the paths' files in ${statesDir})`);
const only = value("--only", null);
const pick = value("--jobs", null)?.split(",");
const files = (list) => list.map((f) => join(statesDir, f.file)).join(",");
const maxJob = Number(value("--max-job", 0));
// a path's files in groups of at most maxJob states (whole files; one group when maxJob is 0)
const groups = (entry) => {
  if (!maxJob || entry.states <= maxJob) return [{ suffix: "", list: entry.files, states: entry.states }];
  const out = [];
  for (const f of entry.files) {
    const last = out[out.length - 1];
    if (last && last.states + f.states <= maxJob) (last.list.push(f), (last.states += f.states));
    else out.push({ list: [f], states: f.states });
  }
  return out.map((g, k) => ({ ...g, suffix: `.g${k}` }));
};
const wholeStride = String(value("--whole-stride", 3));
const jobs = [];
const single = []; // (fu/r1-verify) paths of one state: no pops job (nothing to compare)
for (const kind of ["hinge", "phase"])
  for (const e of index[kind])
    for (const g of groups(e)) {
      // the whole airframe moves (pitch, lift) on the take-off clips and the airborne phase paths: every step is a
      // full render (0.5-1.0 s) moving every outline 0.10-0.14 px, so these are screened at 3 steps a pair (at most
      // 0.42 px apart, as the hinge paths at 25); --sample takes windows of 50 steps every 500 (10%) instead. Every
      // flagged pair is re-run at the path's own step.
      const whole = /^takeoff/.test(e.name) || (kind === "phase" && ["TAKEOFF", "CLIMB", "FL100"].includes(e.name));
      // (fu/r1-verify) a path that turns the turntable (the push clip: 570° at 0.02° a state, 29,790 states): every step
      // is a full render (0.6-0.9 s), and every pair is compared (--stride 1): a coarse screen does not help there,
      // since a sub-band boundary sweeping a face with the turn crosses 5 levels in 3 states (0.06°): 29-39 of 30-50
      // coarse pairs flagged at strides 3, 5 and 10, so nearly every step was re-run at the path's step anyway. About
      // 5-7 h a theme on one worker; --sample takes windows of 50 steps every 500 (10%, about 40 min of worker time)
      const turning = kind === "hinge" && (e.turned ?? 0) > 0;
      const popsArgs = turning ? (argv.includes("--sample") ? ["--windows", "50:500"] : ["--stride", String(value("--turning-stride", 1))]) : whole ? (argv.includes("--sample") ? ["--windows", "50:500"] : ["--stride", wholeStride]) : ["--stride", "25"];
      // --out: turn-check writes each surviving step as a site (its two states) for --zoom-sites … --diagnose. A path of
      // one state has no pair to compare (turn-check fails a pops run that compares nothing): no pops job, listed below
      if (g.states < 2) single.push(`${kind}-${e.name}${g.suffix}`);
      else jobs.push({ kind: "pops", name: `${kind}-${e.name}${g.suffix}`, states: g.states, args: ["--pops", "--no-webgl", "--states", files(g.list), ...popsArgs, "--out", join(out, "sites", `${kind}-${e.name}${g.suffix}`)] });
      jobs.push({ kind: "order", name: `${kind}-${e.name}${g.suffix}`, states: g.states, args: ["--order", "--states", files(g.list), "--order-stride", value(`--order-stride-${kind}`, kind === "phase" ? "50" : "100")] });
    }
const clipStates = pick2("s-states-clips");
if (existsSync(clipStates)) {
  const n = JSON.parse(readFileSync(clipStates, "utf8")).length;
  for (let a = 0, k = 0; a < n; a += 1500, k++) jobs.push({ kind: "order", name: `clips-${k}`, states: Math.min(1500, n - a), args: ["--order", "--states", clipStates, "--slice", `${a}:${a + 1500}`] });
}
const phaseStates = resolve(value("--phase-states", join(out, "phase-states.json")));
if (existsSync(phaseStates)) jobs.push({ kind: "order", name: "phase-states", states: 408, args: ["--order", "--states", phaseStates] });
// --skip-done: leave out a job whose log already ends with a verdict (a second runner, or a restart)
const finished = (j) => {
  try {
    return /turn check (passed|failed)/.test(readFileSync(join(out, `${j.kind}-${j.name}.txt`), "utf8"));
  } catch {
    return false;
  }
};
const todo = jobs.filter((j) => (!only || j.kind === only) && (!pick || pick.some((x) => [j.name, `${j.kind}-${j.name}`].some((n) => n === x || n.startsWith(`${x}.g`)))) && !(argv.includes("--skip-done") && finished(j)));
if (argv.includes("--list")) {
  for (const j of todo) console.log(`${j.kind.padEnd(5)} ${j.name.padEnd(26)} ${String(j.states).padStart(6)} states  node scripts/turn-check.mjs <page> ${j.args.map((a) => (a.includes(",") ? `${a.split(",")[0].replace(ROOT + "/", "")},…` : a.replace(ROOT + "/", ""))).join(" ")}`);
  console.log(`${todo.length} jobs, ${todo.reduce((s, j) => s + j.states, 0)} states${single.length ? ` · no pops job for the one-state paths ${single.join(", ")}` : ""}`);
  process.exit(0);
}
mkdirSync(out, { recursive: true });
const workers = Math.max(1, Number(value("--workers", 3)));
const results = [];
let next = 0;
const t0 = Date.now();
const run = (job) =>
  new Promise((done) => {
    const file = join(out, `${job.kind}-${job.name}.txt`);
    // another runner has it, or has finished it since this one started
    if (argv.includes("--skip-done") && existsSync(file) && (/running/.test(readFileSync(file, "utf8").slice(0, 40)) || finished(job))) return done();
    writeFileSync(file, `running since ${new Date().toISOString()}\n`);
    const started = Date.now();
    const child = spawn(process.execPath, [join(ROOT, "scripts/turn-check.mjs"), resolve(page), ...job.args], { stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (c) => (text += c));
    child.stderr.on("data", (c) => (text += c));
    child.on("exit", (code) => {
      writeFileSync(file, text);
      const keep = text.split("\n").filter((l) => /^(pops|order|path images|  largest outline|  incremental image|turn check|console|page held)|first difference|^  state /.test(l));
      results.push({ job, code, secs: (Date.now() - started) / 1000, keep });
      console.log(`[${((Date.now() - t0) / 60000).toFixed(1)} min] ${job.kind} ${job.name}: exit ${code} in ${((Date.now() - started) / 1000).toFixed(0)} s · ${keep.filter((l) => /^(pops, first difference along|order:)/.test(l)).join(" | ")}`);
      done();
    });
  });
await Promise.all(
  Array.from({ length: workers }, async () => {
    while (next < todo.length) await run(todo[next++]);
  }),
);
const lines = [`path checks on ${page}: ${todo.length} jobs, ${workers} workers, ${((Date.now() - t0) / 60000).toFixed(1)} min`];
for (const kind of ["pops", "order"]) {
  const list = results.filter((r) => r.job.kind === kind).sort((a, b) => a.job.name.localeCompare(b.job.name));
  if (!list.length) continue;
  lines.push(`\n## ${kind}: ${list.length} jobs, ${list.filter((r) => r.code === 0).length} passed`);
  for (const r of list) lines.push(`${r.job.name} (exit ${r.code}, ${r.secs.toFixed(0)} s)\n  ${r.keep.join("\n  ")}`);
}
writeFileSync(join(out, `summary${only ? `-${only}` : ""}.txt`), lines.join("\n") + "\n");
console.log(`summary: ${join(out, `summary${only ? `-${only}` : ""}.txt`)}`);
