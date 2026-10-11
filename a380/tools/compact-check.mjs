// The phone readout over the whole departure (fu/r2-interaction): walks the tour's model path (F.advance, auto) and every
// reader-visible rate tag, and fails if any compact readout runs past F.COMPACT_MAX characters or had to drop whole
// fields (F.compactText's last resort). Also prints the forms it saw at each phase's gear transit and per-engine start.
// node a380/tools/compact-check.mjs
import * as M from "../model.mjs";
import * as F from "../follow.mjs";

const sim = F.createSim(M);
// the page's compact tags (live.js rateTag(true): whole numbers), and "paused"
const TAGS = ["", " · ×2", " · ×3", " · ×8", " · ×10", " · ×12", " · ×30", " · paused"];
let n = 0;
let bad = 0;
let sliced = 0;
let longest = { len: 0, text: "" };
const seen = new Map();
const check = (s) => {
  for (const tag of TAGS) {
    const r = F.compactText(M, s, tag);
    n++;
    if (r.text.length > F.COMPACT_MAX) {
      bad++;
      if (bad <= 10) console.error(`FAIL over ${F.COMPACT_MAX}: ${r.text.length} "${r.text}"`);
    }
    if (r.sliced) {
      sliced++;
      if (sliced <= 10) console.error(`FAIL fields dropped: "${r.text}" (${s.phase}, tag "${tag}")`);
    }
    if (r.text.length > longest.len) longest = { len: r.text.length, text: r.text };
    const key = `${s.phase}|${s.gear.stage}|${tag}`;
    if (!seen.has(key)) seen.set(key, r.text);
  }
};
let t = 0;
while (t < F.LOOP - 8 && n < 2e6) {
  F.advance(M, sim, 1 / 30, { auto: true });
  t += 1 / 30;
  check(sim.state);
}
for (const [k, v] of seen) console.log(`${k.padEnd(30)} ${v}`);
console.log(`compact readout: ${n} states × tags checked, longest ${longest.len} "${longest.text}"`);
console.log(bad || sliced ? `compact check FAILED: ${bad} over ${F.COMPACT_MAX}, ${sliced} with fields dropped` : "compact check passed");
if (bad || sliced) process.exitCode = 1;
