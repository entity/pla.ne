// Screen overlap (px², viewBox units) of the convex hulls of named parts, pairwise, in given states.
//   node a380/tools/overlap.mjs a380/build.mjs '<states json: [{label, ch}]>' 'name1,name2,…' [build flags…]
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TURN } from "../../kit/turn.mjs";
const [file, statesJson, namesArg, ...rest] = process.argv.slice(2);
process.argv.splice(2, process.argv.length, ...rest);
const mod = await import(pathToFileURL(resolve(file)).href);
const scene = TURN.prepare(mod.T.data, { unit: 1 });
const runs = scene.runs;
const names = namesArg.split(",");
const idx = names.map((n) => runs.findIndex((r) => r.name === n));
const area = (p) => {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
};
const clip = (subject, clipper) => {
  let out = subject;
  const sgn = Math.sign(area2(clipper));
  for (let i = 0; i < clipper.length && out.length; i++) {
    const A = clipper[i];
    const B = clipper[(i + 1) % clipper.length];
    const inside = (p) => sgn * ((B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0])) >= 0;
    const inter = (p, q) => {
      const d1 = (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]);
      const d2 = (B[0] - A[0]) * (q[1] - A[1]) - (B[1] - A[1]) * (q[0] - A[0]);
      const t = d1 / (d1 - d2);
      return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    };
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const P = input[j];
      const Q = input[(j + 1) % input.length];
      if (inside(Q)) {
        if (!inside(P)) out.push(inter(P, Q));
        out.push(Q);
      } else if (inside(P)) out.push(inter(P, Q));
    }
  }
  return out;
};
function area2(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) a += p[i][0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * p[i][1];
  return a;
}
for (const { label, ch } of JSON.parse(statesJson)) {
  const cams = TURN.cams(scene, mod.follow(ch));
  const hulls = idx.map((i) => {
    const f = TURN.emit(runs[i], runs[i].group >= 0 ? cams[runs[i].group] : cams.world, TURN.frame(runs[i]));
    return Array.from({ length: f.hullN }, (_, k) => [f.hull[2 * k], f.hull[2 * k + 1]]);
  });
  console.log(`${label}: areas ${names.map((n, k) => `${n} ${area(hulls[k]).toFixed(0)}`).join(", ")}`);
  for (let a = 0; a < names.length; a++)
    for (let b = a + 1; b < names.length; b++) {
      const o = clip(hulls[a], hulls[b]);
      const v = o.length > 2 ? area(o) : 0;
      if (v > 0.01) console.log(`  ${names[a]} × ${names[b]}: ${v.toFixed(2)} px²`);
    }
}
