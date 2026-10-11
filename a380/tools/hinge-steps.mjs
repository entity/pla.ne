#!/usr/bin/env node
// a380/tools/hinge-steps.mjs (follow-up package verify, item 52: a tracked copy of round 3's
// shots/review-3-audits/hinge-steps.mjs, reading the worktree's own tmp): the step sizes of every --verify path file.
//
//   node a380/tools/hinge-steps.mjs [a380/tmp] [--light]
//
// Per states-hinge-*.json and states-phase-*.json: states, nulls (path separators), steps over 0.02 (the turntable
// aside) and the largest step with the group that makes it.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const dir = resolve(args.find((a) => !a.startsWith("--")) ?? "a380/tmp");
const light = args.includes("--light");
let bad = 0;
for (const f of readdirSync(dir).filter((f) => /^states-(hinge|phase)-.*\.json$/.test(f) && f.endsWith("-light.json") === light).sort()) {
  const s = JSON.parse(readFileSync(join(dir, f), "utf8"));
  let worst = 0;
  let wk = "";
  let over = 0;
  let nulls = 0;
  for (let i = 0; i + 1 < s.length; i++) {
    if (!s[i] || !s[i + 1]) {
      nulls++;
      continue;
    }
    let m = 0;
    let mk = "";
    for (const k of Object.keys(s[i])) {
      if (k === "air" || typeof s[i][k] !== "number") continue;
      const d = Math.abs(s[i + 1][k] - s[i][k]);
      if (d > m) {
        m = d;
        mk = k;
      }
    }
    if (m > 0.0201) over++;
    if (m > worst) {
      worst = m;
      wk = mk;
    }
  }
  bad += over;
  console.log(`${f}: ${s.length} states · ${nulls} nulls · steps > 0.02: ${over} · largest ${worst.toFixed(4)}${wk ? ` on ${wk}` : ""}`);
}
console.log(bad ? `hinge steps: ${bad} steps over 0.02` : "hinge steps: every step ≤ 0.02");
process.exit(bad ? 1 : 0);
