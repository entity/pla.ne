#!/usr/bin/env node
// a380/tools/phase-states.mjs (follow-up package verify, item 49; R64): dump the live page's controller values at the
// 17 phase moments the round-3 order check used, each at 24 turns (15° apart): 408 states.
//
//   node a380/tools/phase-states.mjs <page.html> <out.json> [--dry]
//
// The moments: the start and the held end of each of the 7 phases (a phase key, then the page plays the phase to its
// end and holds it: the end is the first moment its readout, doors, flaps, height and speed stay still for 2 s), the
// gate with every door open and the cutaway open, the gate with the gear shown while the canopy settles (C closed 3 s
// before G: the round-3 state 365, doors open and cut.fd part-lifted), and taxi in CONF FULL. Writes <out.json> (the
// value objects, for `turn-check --order --states`) and <out>-labels.json. --dry writes the drive actions only.
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const [page, out] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!page || !out) {
  console.log("usage: node a380/tools/phase-states.mjs <page.html> <out.json> [--dry]");
  process.exit(1);
}
const TURNS = Array.from({ length: 24 }, (_, i) => i * 15);
const READOUT = "document.querySelector('[data-readout]').textContent";
// the page's own state, still for `ms`: resolves with the wait, or -1 after `limit`
const STILL = (ms, limit) => `(async () => { const sig = () => { const s = __a380.state; return ${READOUT} + JSON.stringify(s.doors) + s.flap.toFixed(2) + s.slat.toFixed(2) + s.height.toFixed(1) + s.speed.toFixed(1) + s.phase + (__a380.pv.seek ? 'seek' : ''); }; let last = sig(), since = performance.now(); const t0 = since; while (performance.now() - t0 < ${limit}) { await new Promise((r) => setTimeout(r, 200)); const now = sig(); if (now !== last) { last = now; since = performance.now(); } else if (performance.now() - since >= ${ms}) return Math.round(performance.now() - t0); } return -1; })()`;
const actions = [
  ["until", "window.__a380 && window.__a380.controller && window.__a380.state", 240000],
  ["wait", 1500],
  ["eval", "(window.__S = [], window.__L = [], 'renderer ' + ((__a380.glInfo && __a380.glInfo.renderer) || 'none'))"],
];
const grab = (label) => {
  for (const t of TURNS) {
    actions.push(["turn", t]);
    actions.push(["eval", `(window.__S.push(JSON.parse(JSON.stringify(window.__a380.controller.values))), window.__L.push('${label} t${t} · ' + ${READOUT}), window.__S.length)`]);
  }
  actions.push(["eval", `'${label}: ' + ${READOUT} + ' · phase ' + __a380.state.phase + ' · cabin ' + (+__a380.pv.cabin).toFixed(3) + ' · doors ' + Object.values(__a380.state.doors).map((d) => d.toFixed(2)).join(',')`]);
};
const PHASES = ["GATE", "PUSHBACK", "TAXI", "LINEUP", "TAKEOFF", "CLIMB", "FL100"];
PHASES.forEach((phase, i) => {
  actions.push(["key", String(i + 1)]);
  actions.push(["until", `__a380.state.phase === '${phase}' && !__a380.pv.seek`, 120000]);
  actions.push(["key", " "]); // pause: the start, held still while the turntable is set
  actions.push(["wait", 300]);
  grab(`${phase}-start`);
  actions.push(["key", " "]); // run the phase to its held end
  actions.push(["eval", `(async () => '${phase} end reached after ' + (await ${STILL(2000, 300000)}) + ' ms')()`]);
  actions.push(["key", " "]);
  actions.push(["wait", 300]);
  grab(`${phase}-end`);
  actions.push(["key", " "]);
  actions.push(["wait", 300]);
});
// the gate with every door and the cutaway open, then the gear shown while the canopy settles, then taxi CONF FULL
actions.push(["key", "1"], ["until", "__a380.state.phase === 'GATE' && !__a380.pv.seek", 120000], ["eval", `(async () => 'gate still after ' + (await ${STILL(1500, 120000)}) + ' ms')()`]);
actions.push(["key", "d"], ["until", "Object.values(__a380.state.doors).every((v) => v === 0)", 90000], ["wait", 800]);
actions.push(["key", "d"], ["until", "Object.values(__a380.state.doors).every((v) => v === 1)", 90000], ["wait", 800]);
actions.push(["key", "c"], ["wait", 4000]);
grab("GATE-doors-cut");
actions.push(["key", "c"], ["wait", 3000], ["key", "g"], ["wait", 4000]);
grab("GATE-gearshow");
actions.push(["key", "g"], ["wait", 1500]);
actions.push(["key", "3"], ["until", "__a380.state.phase === 'TAXI' && !__a380.pv.seek", 120000], ["wait", 800]);
actions.push(["key", "f"], ["wait", 300], ["key", "f"], ["wait", 300], ["key", "f"], ["wait", 5000]);
grab("TAXI-full");
const dumpFile = resolve(out.replace(/\.json$/, "") + "-dump.json");
actions.push(["save", dumpFile, "JSON.stringify({ S: window.__S, L: window.__L })"]);

const actionsFile = resolve(out.replace(/\.json$/, "") + "-actions.json");
writeFileSync(actionsFile, JSON.stringify(actions));
console.log(`${actions.length} actions in ${actionsFile}`);
if (process.argv.includes("--dry")) process.exit(0);
const drive = spawn(process.execPath, [join(HERE, "../../scripts/drive.mjs"), resolve(page), "--actions", actionsFile], { stdio: ["ignore", "pipe", "inherit"] });
let text = "";
drive.stdout.on("data", (chunk) => {
  text += chunk;
  for (const line of String(chunk).split("\n")) if (line && !/^eval: \d+$/.test(line)) process.stdout.write(line.length > 300 ? line.slice(0, 300) + "…\n" : line + "\n");
});
drive.on("exit", (code) => {
  let dump = null;
  try {
    dump = JSON.parse(readFileSync(dumpFile, "utf8"));
  } catch {}
  if (!dump) {
    console.log(`phase states: no dump (drive exit ${code})`);
    process.exit(1);
  }
  const { S, L } = dump;
  writeFileSync(resolve(out), JSON.stringify(S));
  writeFileSync(resolve(out).replace(/\.json$/, "-labels.json"), JSON.stringify(L, null, 0));
  console.log(`phase states: ${S.length} states written to ${out} (labels ${out.replace(/\.json$/, "-labels.json")})`);
  process.exit(S.length === 408 ? 0 : 1);
});
