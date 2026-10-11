#!/usr/bin/env node
// a380/tools/path-sites.mjs (follow-up package verify, item 46): the surviving steps of a path pops run, as sites for
// `turn-check --zoom-sites <sites.json> --diagnose --out <dir>` (which re-checks each step in isolation, names the parts
// under it and dumps it at 8x).
//
//   node a380/tools/path-sites.mjs <turn-check log> <label> <states file,states file,…> > sites.json
//
// The log is a `turn-check … --pops --states <files>` run (a path-checks job log); its "first difference state a → b:
// n px … in x0,y0,x1,y1" lines index the files joined with a null between them, as turn-check reads them. (turn-check
// writes the same JSON itself when it is given --out.)
import { readFileSync } from "node:fs";

const [log, label, files] = process.argv.slice(2);
if (!files) {
  console.error("usage: node a380/tools/path-sites.mjs <turn-check log> <label> <states file,states file,…> > sites.json");
  process.exit(1);
}
const states = [];
files.split(",").forEach((file, i) => {
  if (i) states.push(null);
  states.push(...JSON.parse(readFileSync(file, "utf8")));
});
const sites = [];
for (const m of readFileSync(log, "utf8").matchAll(/first difference state (\d+) → (\d+): (\d+) px survive two erosions in ([-\d.,]+)/g)) {
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (!states[a] || !states[b]) throw new Error(`state ${a} or ${b} is not in the files`);
  sites.push({ kind: "first", label: `${label}-${a}`, n: Number(m[3]), box: m[4].split(",").map(Number), frames: [states[a], states[b]] });
}
console.log(JSON.stringify(sites));
console.error(`${sites.length} sites from ${log}`);
