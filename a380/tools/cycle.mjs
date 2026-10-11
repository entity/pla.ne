// Find the actual shortest painter's-order cycle in one state of a 3D build.
// The orbit audit's `cycles` line lists the first 8 parts left with in-degree > 0 (mostly parts downstream of
// the cycle) and suggests a split plane taken from among those; this prints the cycle itself, edge by edge.
//
//   node a380/tools/cycle.mjs a380/build.mjs '{"air":160}' [build flags…]
//
// The build module must export T (from turning()) and may export follow(values). Edges are built exactly as
// the runtime does: planar and framed planes from T.data, group pairs, and GJK for dynamic pairs, only between
// parts whose screen hulls overlap (TURN.disjoint with 0.1 px).
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TURN } from "../../kit/turn.mjs";

const [file, json = "{}", ...rest] = process.argv.slice(2);
if (!file) {
  console.log("usage: node a380/tools/cycle.mjs <build.mjs> '<values json>' [build flags…]");
  process.exit(1);
}
process.argv.splice(2, process.argv.length, ...rest);
const mod = await import(pathToFileURL(resolve(file)).href);
const T = mod.T;
const follow = mod.follow ?? ((v) => v);
const scene = TURN.prepare(T.data, { unit: 1 });
const cams = TURN.cams(scene, follow(JSON.parse(json)));
const frames = scene.runs.map((run) => TURN.emit(run, run.group >= 0 ? cams[run.group] : cams.world, TURN.frame(run)));
const runs = scene.runs;
const turnRot = (g, n) => {
  const R = g >= 0 ? cams[g].R : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return [R[0] * n[0] + R[1] * n[1] + R[2] * n[2], R[3] * n[0] + R[4] * n[1] + R[5] * n[2], R[6] * n[0] + R[7] * n[1] + R[8] * n[2]];
};
for (const layer of scene.layers) {
  const edges = new Map();
  const add = (a, b, why) => (edges.get(a) ?? edges.set(a, []).get(a)).push([b, why]);
  const rel = (i, j, nWorld, why) => {
    if (TURN.disjoint(frames[i], frames[j], 0.1)) return;
    const V = cams.world.V;
    const s = nWorld[0] * V[0] + nWorld[1] * V[1] + nWorld[2] * V[2];
    if (Math.abs(s) < 1e-7) return;
    if (s > 0) add(i, j, why);
    else add(j, i, why);
  };
  const P = layer.planar;
  for (let p = 0; p < P.length; p += 5) rel(P[p], P[p + 1], turnRot(runs[P[p]].group, [P[p + 2], P[p + 3], P[p + 4]]), "planar");
  const F = layer.framed;
  for (let p = 0; p < F.length; p += 6) rel(F[p], F[p + 1], turnRot(F[p + 2], [F[p + 3], F[p + 4], F[p + 5]]), "framed");
  for (const gp of layer.groupPairs ?? []) for (const i of gp.a) for (const j of gp.b) rel(i, j, turnRot(gp.frame, gp.n), "group pair");
  const dyn = [];
  for (let p = 0; p < layer.dynamic.length; p += 2) dyn.push([layer.dynamic[p], layer.dynamic[p + 1]]);
  for (const i of layer.free) for (const j of layer.parts) if (i !== j && runs[i].group !== runs[j].group) dyn.push([i, j]);
  for (const [i, j] of dyn) {
    const a = runs[i];
    const b = runs[j];
    const ca = a.group >= 0 ? cams[a.group] : cams.world;
    const cb = b.group >= 0 ? cams[b.group] : cams.world;
    const hit = TURN.gjk(a.cloud, ca, b.cloud, cb, null, 32, TURN.hintsOf(a, ca, b, cb, cams.world));
    rel(i, j, hit.n, `dynamic, GJK margin ${hit.margin.toFixed(2)}`);
  }
  let best = null;
  for (const start of edges.keys()) {
    const prev = new Map([[start, null]]);
    const queue = [start];
    let found = null;
    while (queue.length && !found) {
      const v = queue.shift();
      for (const [w] of edges.get(v) ?? []) {
        if (w === start) {
          const path = [v];
          for (let x = v; prev.get(x) !== null; ) path.push((x = prev.get(x)));
          found = path.reverse();
          break;
        }
        if (!prev.has(w)) {
          prev.set(w, v);
          queue.push(w);
        }
      }
    }
    if (found && (!best || found.length < best.length)) best = found;
  }
  if (!best) console.log(`${layer.name}: no cycle in ${json}`);
  else console.log(`${layer.name}: cycle in ${json}:\n  ${best.map((i, k) => `${runs[i].name}  —[${(edges.get(i).find(([w]) => w === best[(k + 1) % best.length]) ?? [0, "?"])[1]}]→`).join("\n  ")}  ${runs[best[0]].name}`);
}
