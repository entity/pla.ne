// Kit patch 9 control (a380/notes/kit-patches.md 9): a hinge pair that bulges between its sampled extremes.
//
//   node kit/turn-patch9-control.mjs
//
// A thin bar on a hinge about the vertical axis swings 0–90° beside a block. At the swing's two ends (the 24 sampled
// entries of poses(), which T.build's framed search reads) one plane separates the bar from the block; at 45° (in the
// other entries of poses()) the bar's tip crosses that plane, although it still clears the block. Without patch 9
// the build keeps the extremes' plane as a framed plane, wrong mid-swing ("fails as it should"); with patch 9 the
// plane is checked on every distinct relative pose and the pair is framed again or left dynamic.
import * as k from "./iso-kit.mjs";
import * as A from "./audit.mjs";
import { turning } from "./turn-build.mjs";
import { TURN } from "./turn.mjs";

function scene() {
  const P = k.fitProjection([[-10, -10, 0], [10, 10, 2]], 480, 360, { pad: 20 });
  const T = turning(P, { recorder: A.recorder(P) });
  T.group("base", { turn: { pivot: [0, 0] } });
  T.group("lid", { parent: "base", hinge: { point: [0, 0, 0], axis: [0, 0, 1], range: [0, 90] } });
  T.layer("main");
  T.stack(["main"]);
  // the block, clear of the bar's whole swing (its corner at (3, 4.5) lies outside the swept diagonal)
  T.hull({ name: "block", group: "base", layer: "main", points: [[3, 4.5, 0], [4, 4.5, 0], [4, 5.5, 0], [3, 5.5, 0], [3, 4.5, 1], [4, 4.5, 1], [4, 5.5, 1], [3, 5.5, 1]] });
  // the bar along +x from the hinge, 6 long and 0.1 thick
  T.hull({ name: "bar", group: "lid", layer: "main", points: [[0, -0.05, 0], [6, -0.05, 0], [6, 0.05, 0], [0, 0.05, 0], [0, -0.05, 1], [6, -0.05, 1], [6, 0.05, 1], [0, 0.05, 1]] });
  return { P, T };
}

// 24 sampled entries (every 120th) alternate the swing's ends; every other entry sweeps it
const poses = () => Array.from({ length: 2880 }, (_, i) => ({ base: (i * 360) / 2880, lid: i % 120 === 0 ? ((i / 120) % 2 ? 90 : 0) : i % 91 }));

function run(patch9) {
  const { T } = scene();
  const out = T.build({ poses, patch9 });
  const prepared = TURN.prepare(out.data, { unit: 1 });
  const layer = prepared.layers[0];
  const bar = prepared.runs.findIndex((r) => r.name === "bar");
  const block = prepared.runs.findIndex((r) => r.name === "block");
  const F = layer.framed;
  let plane = null;
  for (let p = 0; p < F.length; p += 6) if ((F[p] === bar && F[p + 1] === block) || (F[p] === block && F[p + 1] === bar)) plane = { a: F[p], n: [F[p + 3], F[p + 4], F[p + 5]] };
  for (const gp of layer.groupPairs) if ((gp.a.includes(bar) && gp.b.includes(block)) || (gp.a.includes(block) && gp.b.includes(bar))) plane = { a: gp.a.includes(bar) ? bar : block, n: gp.n };
  const dynamic = Array.from(layer.dynamic).some((v, i, list) => i % 2 === 0 && ((v === bar && list[i + 1] === block) || (v === block && list[i + 1] === bar)));
  // the plane's margin at 45° (in the base frame: the bar's points rotated by 45° about z)
  let margin = null;
  if (plane) {
    const c = Math.cos(Math.PI / 4);
    const s = Math.sin(Math.PI / 4);
    const barPts = [[0, -0.05], [6, -0.05], [6, 0.05], [0, 0.05]].flatMap(([x, y]) => [0, 1].map((z) => [c * x - s * y, s * x + c * y, z]));
    const blockPts = [[3, 4.5], [4, 4.5], [4, 5.5], [3, 5.5]].flatMap(([x, y]) => [0, 1].map((z) => [x, y, z]));
    const dot = (p) => plane.n[0] * p[0] + plane.n[1] * p[1] + plane.n[2] * p[2];
    const [back, front] = plane.a === bar ? [barPts, blockPts] : [blockPts, barPts];
    margin = Math.min(...front.map(dot)) - Math.max(...back.map(dot));
  }
  return { framed: Boolean(plane), dynamic, margin, report: out.report.patch9 };
}

const off = run(false);
const on = run(true);
const fmt = (r) => (r.framed ? `framed (margin at 45° ${r.margin.toFixed(3)})` : r.dynamic ? "dynamic" : "unrelated");
console.log(`patch 9 off: bar × block ${fmt(off)}`);
console.log(`patch 9 on: bar × block ${fmt(on)} · ${on.report.failed} plane failed between the sampled poses, ${on.report.reframed} framed again, ${on.report.dynamic} left dynamic`);
const offWrong = off.framed && off.margin < 0;
const onRight = (on.framed && on.margin >= 0.1) || (!on.framed && on.dynamic);
console.log(offWrong ? "control: without patch 9 the extremes' plane is kept and fails mid-swing (fails as it should)" : "control: without patch 9 the pair is NOT wrongly framed (the control did not plant its fault)");
console.log(onRight ? "patch 9: the pair is framed correctly (a plane valid mid-swing, or dynamic)" : "patch 9: FAILED (a framed plane fails mid-swing)");
process.exitCode = offWrong && onRight ? 0 : 1;
