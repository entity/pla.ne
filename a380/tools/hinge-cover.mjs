#!/usr/bin/env node
// a380/tools/hinge-cover.mjs (follow-up package verify, item 48; a tracked, extended copy of round 3's
// shots/review-3-audits/hinge-cover.mjs): how much of every hinge's travel the --verify paths cover.
//
//   node a380/tools/hinge-cover.mjs [a380/tmp] [--light] [--all]
//
// Reads <dir>/states-paths.json (written by a380/tools/verify-paths.mjs) and every path file it lists, and the clip
// frames in <dir>/s-states-clips.json. Per clip and per hinge or slide (numeric group values, the turntable aside):
//   range   the share of the clip's own range [min, max] over its frames that the path's steps cover;
//   travel  the path's total |Δ| over the frames' total |Δ| (≥ 100%: the path passes every frame pair);
// and per file: its states (≤ 3,000), its largest step (≤ 0.02), and that it starts on the state the previous file
// ended on. The phase paths are listed with their states, files and largest step. Prints "hinge coverage passed" or
// the failures. --all lists every hinge, not only those that move more than 1 in the clip.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
// (review round 1, fu/r1-verify) a step is the largest of the hinge and slide, turntable and free-group moves, as
// verify-paths.mjs cuts them (the push clip turns the table and moves the tug with no hinge moving)
import { stepOf, turnMoveOf } from "./verify-paths.mjs";

const args = process.argv.slice(2);
const dir = resolve(args.find((a) => !a.startsWith("--")) ?? "a380/tmp");
const suffix = args.includes("--light") ? "-light" : "";
const index = JSON.parse(readFileSync(join(dir, `states-paths${suffix}.json`), "utf8"));
const clipStates = JSON.parse(readFileSync(join(dir, `s-states-clips${suffix}.json`), "utf8"));
const numeric = (s) => Object.keys(s).filter((k) => k !== "air" && typeof s[k] === "number");
// (the files round every value to 1e-9; a free group's rotation angle from them carries up to about 1e-7°, so a step is
// over 0.02 only past 0.02 + 1e-6)
const moveOf = (a, b) => stepOf(a, b);
const STEP = index.step ?? 0.02;
const MAX = index.max ?? 3000;
const failures = [];
let offset = 0;
let worstStep = 0;
let biggest = 0;
const rows = [];
for (const e of index.hinge) {
  // the clip's frames, in the order the build wrote s-states-clips.json
  let n = 0;
  for (let t = e.from; t <= e.to + 1e-9; t += e.frame) n++;
  const frames = clipStates.slice(offset, offset + n);
  offset += n;
  const path = [];
  let previousLast = null;
  for (const f of e.files) {
    const list = JSON.parse(readFileSync(join(dir, f.file), "utf8"));
    biggest = Math.max(biggest, list.length);
    if (list.length > MAX) failures.push(`${f.file}: ${list.length} states (over ${MAX})`);
    if (previousLast && JSON.stringify(list[0]) !== JSON.stringify(previousLast)) failures.push(`${f.file}: does not start on the state ${e.name}'s previous file ended on`);
    previousLast = list[list.length - 1];
    if (path.length) path.push(null);
    path.push(...list);
  }
  const keys = numeric(frames[0]);
  const lo = {}, hi = {}, travel = {}, cov = {}, intervals = {};
  for (const k of keys) {
    lo[k] = Math.min(...frames.map((s) => s[k]));
    hi[k] = Math.max(...frames.map((s) => s[k]));
    travel[k] = frames.slice(1).reduce((sum, s, i) => sum + Math.abs(s[k] - frames[i][k]), 0);
    cov[k] = 0;
    intervals[k] = [];
  }
  let largest = 0;
  let turned = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (!a || !b) continue;
    const m = moveOf(a, b);
    largest = Math.max(largest, m);
    turned += turnMoveOf(a, b);
    for (const k of keys) {
      const d = Math.abs(b[k] - a[k]);
      if (!d) continue;
      cov[k] += d;
      intervals[k].push([Math.min(a[k], b[k]), Math.max(a[k], b[k])]);
    }
  }
  worstStep = Math.max(worstStep, largest);
  if (largest > STEP + 1e-6) failures.push(`${e.name}: a step of ${largest.toFixed(4)} (over ${STEP})`);
  const moving = keys.filter((k) => hi[k] - lo[k] > (args.includes("--all") ? 1e-9 : 1));
  const shares = moving.map((k) => {
    // the union of the steps' intervals over the clip's range
    const list = intervals[k].sort((x, y) => x[0] - y[0]);
    let covered = 0;
    let at = -Infinity;
    for (const [x0, x1] of list) {
      const from = Math.max(x0, at, lo[k]);
      const to = Math.min(x1, hi[k]);
      if (to > from) covered += to - from;
      at = Math.max(at, x1);
    }
    const range = covered / (hi[k] - lo[k]);
    const tv = travel[k] ? cov[k] / travel[k] : 1;
    if (range < 1 - 1e-6) failures.push(`${e.name} ${k}: ${(100 * range).toFixed(2)}% of its range`);
    if (tv < 1 - 1e-6) failures.push(`${e.name} ${k}: ${(100 * tv).toFixed(2)}% of its travel`);
    return { k, range, tv, span: hi[k] - lo[k] };
  });
  // the turntable's own travel over the clip's frames, against the path's
  const turnFrames = frames.slice(1).reduce((sum, f, i) => sum + turnMoveOf(frames[i], f), 0);
  if (turnFrames > 1e-9 && turned < turnFrames * (1 - 1e-6)) failures.push(`${e.name}: the path turns ${turned.toFixed(2)}° of the clip's ${turnFrames.toFixed(2)}°`);
  rows.push(`${e.name}: ${e.states} states in ${e.files.length} files (largest ${Math.max(...e.files.map((f) => f.states))}), largest step ${largest.toFixed(4)}${turnFrames > 1e-9 ? `, turning ${turned.toFixed(1)}° of the clip's ${turnFrames.toFixed(1)}°` : ""}${e.vary && e.vary.length ? `, vary ${e.vary.join(", ")}` : ""}, ${moving.length} hinges or slides moving: ${shares.length ? `range ${(100 * Math.min(...shares.map((x) => x.range))).toFixed(1)}–${(100 * Math.max(...shares.map((x) => x.range))).toFixed(1)}%, travel ≥ ${(100 * Math.min(...shares.map((x) => x.tv))).toFixed(1)}%` : "none"}`);
  if (args.includes("--all") || args.includes("--verbose")) for (const x of shares) rows.push(`  ${x.k.padEnd(24)} range ${x.span.toFixed(2).padStart(8)} · covered ${(100 * x.range).toFixed(1)}% · travel ${(100 * x.tv).toFixed(1)}%`);
}
for (const e of index.phase) {
  let previousLast = null;
  for (const f of e.files) {
    const list = JSON.parse(readFileSync(join(dir, f.file), "utf8"));
    biggest = Math.max(biggest, list.length);
    if (list.length > MAX) failures.push(`${f.file}: ${list.length} states (over ${MAX})`);
    if (previousLast && JSON.stringify(list[0]) !== JSON.stringify(previousLast)) failures.push(`${f.file}: does not start where the previous file ended`);
    previousLast = list[list.length - 1];
    let largest = 0;
    for (let i = 0; i + 1 < list.length; i++) if (list[i] && list[i + 1]) largest = Math.max(largest, moveOf(list[i], list[i + 1]));
    worstStep = Math.max(worstStep, largest);
    if (largest > STEP + 1e-6) failures.push(`${f.file}: a step of ${largest.toFixed(4)}`);
  }
  rows.push(`phase ${e.name}: ${e.states} states in ${e.files.length} files, turn ${e.turn}, figure s ${e.t0}–${e.t1}, largest step ${e.largest}`);
}
console.log(rows.join("\n"));
console.log(`hinge paths: ${index.hinge.length} clips, ${index.hinge.reduce((s, e) => s + e.states, 0)} states; phase paths: ${index.phase.length}, ${index.phase.reduce((s, e) => s + e.states, 0)} states · largest step ${worstStep.toFixed(4)} · largest file ${biggest} states`);
console.log(failures.length ? `hinge coverage FAILED: ${failures.length}\n  ${failures.slice(0, 30).join("\n  ")}` : "hinge coverage passed: every hinge's range and travel in every clip and the turntable's travel where a clip turns it, every step ≤ 0.02 (hinges, slides, turntable, free groups), every file ≤ 3,000 states and continuous with the next");
process.exit(failures.length ? 1 : 0);
