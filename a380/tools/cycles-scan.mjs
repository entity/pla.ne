// Scan many states of a 3D build for painter's-order cycles and print each state's shortest cycle.
//   node a380/tools/cycles-scan.mjs a380/build.mjs <states.json> [build flags…]
// states.json: [{ "label": "...", "ch": { channels } }, …] (channels go through the build's follow()).
// Edges are built as the runtime builds them (see tools/cycle.mjs).
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { TURN } from "../../kit/turn.mjs";

const [file, statesFile, ...rest] = process.argv.slice(2);
process.argv.splice(2, process.argv.length, ...rest);
const mod = await import(pathToFileURL(resolve(file)).href);
const T = mod.T;
const follow = mod.follow ?? ((v) => v);
const scene = TURN.prepare(T.data, { unit: 1 });
const runs = scene.runs;
const states = JSON.parse(readFileSync(statesFile, "utf8"));
const tally = new Map();
for (const { label, ch } of states) {
  const cams = TURN.cams(scene, follow(ch));
  const frames = runs.map((run) => TURN.emit(run, run.group >= 0 ? cams[run.group] : cams.world, TURN.frame(run)));
  const turnRot = (g, n) => {
    const R = g >= 0 ? cams[g].R : [1, 0, 0, 0, 1, 0, 0, 0, 1];
    return [R[0] * n[0] + R[1] * n[1] + R[2] * n[2], R[3] * n[0] + R[4] * n[1] + R[5] * n[2], R[6] * n[0] + R[7] * n[1] + R[8] * n[2]];
  };
  for (const layer of scene.layers) {
    if (layer.name !== "airframe") continue;
    const edges = new Map();
    const add = (a, b, why) => (edges.get(a) ?? edges.set(a, []).get(a)).push([b, why]);
    const parked = (i) => runs[i].group >= 0 && cams[runs[i].group].t && Math.abs(cams.poses[runs[i].group].t[2]) > 1e4;
    const rel = (i, j, nWorld, why) => {
      if (parked(i) || parked(j)) return;
      if (TURN.disjoint(frames[i], frames[j], 0.1)) return;
      const V = cams.world.V;
      const s = nWorld[0] * V[0] + nWorld[1] * V[1] + nWorld[2] * V[2];
      if (Math.abs(s) < 1e-7) return;
      if (s > 0) add(i, j, why);
      else add(j, i, why);
    };
    const P = layer.planar;
    for (let p = 0; p < P.length; p += 5) rel(P[p], P[p + 1], turnRot(runs[P[p]].group, [P[p + 2], P[p + 3], P[p + 4]]), "planar");
    const Fm = layer.framed;
    for (let p = 0; p < Fm.length; p += 6) rel(Fm[p], Fm[p + 1], turnRot(Fm[p + 2], [Fm[p + 3], Fm[p + 4], Fm[p + 5]]), "framed");
    for (const gp of layer.groupPairs ?? []) for (const i of gp.a) for (const j of gp.b) rel(i, j, turnRot(gp.frame, gp.n), "group");
    const dyn = [];
    for (let p = 0; p < layer.dynamic.length; p += 2) dyn.push([layer.dynamic[p], layer.dynamic[p + 1]]);
    for (const i of layer.free) for (const j of layer.parts) if (i !== j && runs[i].group !== runs[j].group) dyn.push([i, j]);
    for (const [i, j] of dyn) {
      if (parked(i) || parked(j)) continue;
      const a = runs[i];
      const b = runs[j];
      const ca = a.group >= 0 ? cams[a.group] : cams.world;
      const cb = b.group >= 0 ? cams[b.group] : cams.world;
      if (TURN.disjoint(frames[i], frames[j], 0.1)) continue;
      const hit = TURN.gjk(a.cloud, ca, b.cloud, cb, null, 32, TURN.hintsOf(a, ca, b, cb, cams.world));
      rel(i, j, hit.n, `dyn ${hit.margin.toFixed(2)}`);
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
    if (!best) console.log(`${label}: no cycle`);
    else {
      const names = best.map((i, k) => `${runs[i].name} [${(edges.get(i).find(([w]) => w === best[(k + 1) % best.length]) ?? [0, "?"])[1]}]`);
      const key = best.map((i) => runs[i].name).sort().join(" ");
      tally.set(key, (tally.get(key) ?? 0) + 1);
      console.log(`${label}: ${names.join(" → ")}`);
    }
  }
}
console.log(`\n${tally.size} distinct cycles`);
for (const [k, n] of tally) console.log(`  ${n}× ${k}`);
