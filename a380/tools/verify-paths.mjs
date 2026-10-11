// a380/tools/verify-paths.mjs (follow-up package verify, item 48; R63): the reachable paths that `--verify` writes for
// the browser's pops and order checks (DESIGN §8.3, §10).
//
//   - states-hinge-<clip>.p<k>.json: per audit clip, ONE continuous path through every frame pair. A frame pair that
//     moves any hinge or slide, the turntable or a free group by m is cut into n = ceil(m / 0.02) states by the clip's
//     own time (so free groups keep their synced pose), and a sub-step that still moves more than 0.02 (an eased table)
//     is cut again. Identical neighbouring states are written once. A path longer than 3,000 states is split into
//     files at frame boundaries; each file starts with the state the previous file ended on, so no pair is lost at the
//     split.
//   - states-phase-<PHASE>.p<k>.json: the tour's trajectory (pitch, lift and every channel the model drives) through
//     each of the 7 phases, at the same 0.02 step, the turntable held at the tour's bearing at the start of the phase,
//     cutaway closed.
//   - states-paths.json: the index (files, states, frames, largest step, jumps, the turn's travel and the vary classes
//     a path carries) that a380/tools/hinge-cover.mjs reads.
//
// A null in a states file separates two paths: turn-check's first difference and order check skip the pair across
// it. The paths here are continuous, so a null appears only where a clip's own function jumps (reported as a jump).
//
// (follow-up review round 1, fu/r1-verify) What counts as a move, each at most 0.02 a state:
//   - a hinge or slide: its value (degrees, kit units);
//   - the turntable (the group "air"): degrees. The push clip turns the table 30° a second (0.5° a frame, about 3 px
//     at the platter's rim) and moves no hinge, so its path had been one state a frame; at 0.02° a state the rim moves
//     about 0.13 px;
//   - a free group that is drawn (not parked 10 km up by its sync rule): its translation in kit units and its rotation
//     in degrees. The tug (a free group) drove up to 2.9 kit units a state along the PUSHBACK phase path. A free group
//     that appears or is parked between two states is a switch, not a move, and is not cut.
// A path state of a module clip (ctx.clip, whose at(t) gives channels) also carries `__vary`: the alpha of every vary
// class that changes along the clip and depends on the channels alone (evaluated here with F and M; a class that
// reads the page's own values pv, s or A3 is left to the page). The page computes its vary alphas from its own model,
// not from a tool's state, so without it the push path showed the tug faded out at every state (its alpha follows the
// page's model at the stand, tug 0). scripts/turn-check.mjs writes them over the page's.
import { writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const STEP = 0.02;
export const MAX_STATES = 3000;

/** The largest move of any hinge or slide (numeric group value but the turntable) between two value sets. */
export function moveOf(a, b) {
  let m = 0;
  for (const k in a) {
    if (k === "air") continue;
    const x = a[k];
    const y = b[k];
    if (typeof x !== "number" || typeof y !== "number") continue;
    const d = Math.abs(y - x);
    if (d > m) m = d;
  }
  return m;
}
/** The turntable's move in degrees (r1-verify). */
export function turnMoveOf(a, b) {
  return typeof a.air === "number" && typeof b.air === "number" ? Math.abs(b.air - a.air) : 0;
}
// a free group's value { R (row-major 3x3) | q | axis, t, world }; parked by its sync rule at t[2] ≥ 1e4 (F.PARKED, as
// build.mjs isParked)
const isFree = (v) => Boolean(v && typeof v === "object" && !Array.isArray(v) && (v.R || v.t || v.q || v.axis));
const isParked = (v) => Boolean(v.t && v.t[2] >= 1e4);
const rotOf = (v) => {
  if (v.R) return v.R;
  if (v.q) {
    const [x, y, z, w] = v.q;
    return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  }
  return null;
};
/** The largest move of a drawn free group (r1-verify): its translation in kit units or its rotation in degrees. */
export function freeMoveOf(a, b) {
  let m = 0;
  for (const k in a) {
    const x = a[k];
    const y = b[k];
    if (!isFree(x) || !isFree(y) || isParked(x) || isParked(y)) continue;
    const tx = x.t ?? [0, 0, 0];
    const ty = y.t ?? [0, 0, 0];
    m = Math.max(m, Math.hypot(ty[0] - tx[0], ty[1] - tx[1], ty[2] - tx[2]));
    const Ra = rotOf(x);
    const Rb = rotOf(y);
    if (Ra && Rb) {
      // the angle between the two rotations from |Ra − Rb| (Frobenius) = 2√2 sin(θ/2): well conditioned at small
      // angles, where acos((tr − 1) / 2) turns the files' 1e-9 rounding into 0.0002°
      let d2 = 0;
      for (let i = 0; i < 9; i++) d2 += (Ra[i] - Rb[i]) ** 2;
      m = Math.max(m, (2 * Math.asin(Math.min(1, Math.sqrt(d2) / (2 * Math.SQRT2))) * 180) / Math.PI);
    } else if (x.axis && y.axis) m = Math.max(m, Math.abs((y.angle ?? 0) - (x.angle ?? 0)));
  }
  return m;
}
/** A step's size: the largest of the hinge and slide, turntable and free-group moves (each bounded by STEP). */
export const stepOf = (a, b) => Math.max(moveOf(a, b), turnMoveOf(a, b), freeMoveOf(a, b));
const sameState = (a, b) => moveOf(a, b) === 0 && a.air === b.air && JSON.stringify(a) === JSON.stringify(b);
// 1e-9 is far below anything drawn; it keeps a state about 40% smaller on disk
const round = (v) => (typeof v === "number" ? Math.round(v * 1e9) / 1e9 : Array.isArray(v) ? v.map(round) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v);

/**
 * A continuous path through at(t) over the frame times `times`: every step ≤ STEP. Returns { states, bounds, jumps,
 * largest }: bounds are the indices of the states at frame times, jumps the places where the function itself jumps
 * (a step that does not shrink when cut 24 times).
 */
export function pathOf(at, times) {
  const states = [];
  const bounds = [];
  const jumps = [];
  let largest = 0;
  const push = (s, m) => {
    if (states.length && sameState(states[states.length - 1], s)) return;
    states.push(s);
    if (m > largest) largest = m;
  };
  const cut = (ta, a, tb, b, depth) => {
    const m = stepOf(a, b);
    if (m <= STEP + 1e-12) return push(b, m);
    if (depth >= 24 || tb - ta < 1e-12) {
      jumps.push({ t: tb, move: m });
      states.push(null, b);
      return;
    }
    const n = Math.min(4096, Math.ceil(m / STEP));
    let pt = ta;
    let pa = a;
    for (let j = 1; j <= n; j++) {
      const tj = j === n ? tb : ta + ((tb - ta) * j) / n;
      const sj = j === n ? b : at(tj);
      cut(pt, pa, tj, sj, depth + 1);
      pt = tj;
      pa = sj;
    }
  };
  let prevT = times[0];
  let prev = at(prevT);
  push(prev, 0);
  bounds.push(0);
  for (let i = 1; i < times.length; i++) {
    const t = times[i];
    const s = at(t);
    cut(prevT, prev, t, s, 0);
    bounds.push(states.length - 1);
    prevT = t;
    prev = s;
  }
  return { states, bounds: [...new Set(bounds)], jumps, largest };
}

/** Split a path into files of at most `max` states, at frame boundaries where it can; each file starts where the last ended. */
export function split(states, bounds, max = MAX_STATES) {
  const parts = [];
  const isBound = new Set(bounds);
  let start = 0;
  while (start < states.length - 1 || !parts.length) {
    let end = Math.min(states.length - 1, start + max - 1);
    if (end < states.length - 1) {
      let at = end;
      while (at > start && !isBound.has(at)) at--;
      end = at > start ? at : end; // one frame pair longer than a file (a door turning 99° in a frame): cut inside it
      if (states[end] === null) end--; // never end a file on a separator
    }
    parts.push(states.slice(start, end + 1));
    if (end >= states.length - 1) break;
    start = end;
  }
  return parts;
}

/** The largest step inside each file (nulls skipped), to prove the 0.02 bound on what was written. */
const largestStep = (list) => {
  let worst = 0;
  for (let i = 0; i + 1 < list.length; i++) if (list[i] && list[i + 1]) worst = Math.max(worst, stepOf(list[i], list[i + 1]));
  return worst;
};

/**
 * (r1-verify) The vary classes that change along a clip and depend on its channels alone: [[cls, fn(ch) → alpha]].
 * vary: the build's reg.vary (cls → { expr: "(ch, pv, s) => …" }). A class that reads pv, s or the page's A3 throws here
 * and is left out (the page computes it); one that keeps one alpha over the clip's frames is left out too.
 */
export function varyingClasses({ vary, F, M, channelsAt, times }) {
  if (!vary || !channelsAt) return [];
  const pageOnly = new Proxy({}, { get() { throw new Error("a page value"); }, has() { throw new Error("a page value"); } });
  const alphaOf = (fn, ch) => {
    try {
      const a = fn(ch, pageOnly, pageOnly);
      return typeof a === "number" && Number.isFinite(a) ? Math.round(Math.max(0, Math.min(1, a)) * 1000) / 1000 : null;
    } catch {
      return null;
    }
  };
  const chs = times.map((t) => channelsAt(t));
  const out = [];
  for (const [cls, v] of vary) {
    let fn;
    try {
      fn = new Function("F", "M", `return (${v.expr});`)(F, M);
    } catch {
      continue;
    }
    const alphas = chs.map((ch) => alphaOf(fn, ch));
    if (alphas.some((a) => a === null) || Math.max(...alphas) - Math.min(...alphas) < 1e-6) continue;
    out.push([cls, (ch) => alphaOf(fn, ch)]);
  }
  return out;
}

/**
 * Write every clip's hinge path and the 7 phase paths into `dir`. clips: the build's CLIPS (at(t) → group values).
 * phase: { F, M, follow } to drive the tour's model. channels (r1-verify): a Map from a module clip's name to its
 * at(t) → channels, and vary the build's reg.vary, for the paths' `__vary`. Returns report lines.
 */
export function writeVerifyPaths({ dir, clips, F, M, follow, light = false, channels = null, vary = null }) {
  const suffix = light ? "-light" : "";
  // old files (the six-snippet hinge paths, and any previous run's parts) would otherwise be read as current
  for (const f of readdirSync(dir)) if ((/^states-(hinge|phase)-.*\.json$/.test(f) || f === `states-paths${suffix}.json`) && f.endsWith(`${suffix}.json`) && (light || !f.endsWith("-light.json"))) unlinkSync(join(dir, f));
  const index = { step: STEP, max: MAX_STATES, hinge: [], phase: [] };
  const lines = [];
  const write = (kind, name, path, extra = {}) => {
    const files = split(path.states, path.bounds).map((list, k) => {
      const file = `states-${kind}-${name}.p${k}${suffix}.json`;
      writeFileSync(join(dir, file), JSON.stringify(list.map(round)));
      return { file, states: list.length, largest: +largestStep(list).toFixed(6) };
    });
    const entry = { name, states: path.states.length, frames: path.bounds.length, largest: +path.largest.toFixed(6), jumps: path.jumps.length, files, ...extra };
    index[kind].push(entry);
    return entry;
  };
  // the clips (the orbit is a pure turn: the turn checks own it at their own step)
  const hinge = [];
  const withVary = [];
  for (const c of clips.filter((x) => x.name !== "orbit")) {
    const times = [];
    for (let t = c.from; t <= c.to + 1e-9; t += c.frame) times.push(t);
    // (r1-verify) a module clip's vary classes that move along it ride in each state as __vary
    const channelsAt = channels ? channels.get(c.name) : null;
    const classes = varyingClasses({ vary, F, M, channelsAt, times });
    const at = classes.length ? (t) => { const ch = channelsAt(t); return { ...c.at(t), __vary: Object.fromEntries(classes.map(([cls, fn]) => [cls, fn(ch)])) }; } : c.at;
    const path = pathOf(at, times);
    // the turntable's travel along the path (degrees; only the push clip turns it)
    let turn = 0;
    for (let i = 0; i + 1 < path.states.length; i++) if (path.states[i] && path.states[i + 1]) turn += turnMoveOf(path.states[i], path.states[i + 1]);
    const e = write("hinge", c.name, path, { from: c.from, to: c.to, frame: c.frame, turned: +turn.toFixed(3), vary: classes.map(([cls]) => cls) });
    if (classes.length) withVary.push(`${c.name} ${classes.length} (${classes.slice(0, 4).map(([cls]) => cls).join(", ")}${classes.length > 4 ? ", …" : ""})`);
    hinge.push(e);
  }
  const hingeStates = hinge.reduce((s, e) => s + e.states, 0);
  lines.push(`hinge paths (one continuous path per clip, ≤ ${STEP} per state, ≤ ${MAX_STATES} states per file): ${hinge.length} clips, ${hingeStates} states in ${hinge.reduce((s, e) => s + e.files.length, 0)} files, largest step ${Math.max(...hinge.map((e) => e.largest)).toFixed(4)}, jumps ${hinge.reduce((s, e) => s + e.jumps, 0)}`);
  lines.push(`  ${hinge.map((e) => `${e.name} ${e.states}/${e.files.length}${e.turned ? ` (turning ${e.turned}°)` : ""}`).join(", ")}`);
  lines.push(`  vary classes carried in the states (the clip's own alphas, written over the page's by turn-check): ${withVary.join("; ") || "none"}`);
  // the phase paths: the tour's model at 1/60 figure s, each frame pair cut to ≤ STEP in channel space
  {
    const sim = F.createSim(M);
    const frames = [];
    let t = 0;
    const capture = () => frames.push({ t, phase: sim.phase, ch: F.channelsOf(sim.state, { cabin: 0 }) });
    capture();
    while (t < 140) {
      F.advance(M, sim, 1 / 60);
      t += 1 / 60;
      capture();
      if (sim.phase === "FL100" && sim.done && sim.held >= F.FL100_HOLD) break;
    }
    for (const phase of F.PHASE_ORDER) {
      const list = frames.filter((f) => f.phase === phase);
      if (!list.length) continue;
      // the pair into the next phase belongs to this phase's path
      const last = frames.indexOf(list[list.length - 1]);
      if (frames[last + 1]) list.push(frames[last + 1]);
      const turn = F.turnOfBearing(F.tourBearing(list[0].t));
      const channelsAt = (u) => {
        const i = Math.min(list.length - 2, Math.max(0, Math.floor(u)));
        const f = u - i;
        const a = list[i].ch;
        const b = list[i + 1].ch;
        const ch = {};
        for (const k of Object.keys(a)) ch[k] = typeof a[k] === "number" && typeof b[k] === "number" ? a[k] + (b[k] - a[k]) * f : f < 0.5 ? a[k] : b[k];
        ch.turn = turn;
        return ch;
      };
      const times = list.map((_, i) => i);
      // (r1-verify) the phase's vary classes that move with its channels (the tug's fade in PUSHBACK) ride as __vary
      const classes = list.length > 1 ? varyingClasses({ vary, F, M, channelsAt, times }) : [];
      const chAt = (u) => {
        const ch = channelsAt(u);
        const values = follow(ch);
        return classes.length ? { ...values, __vary: Object.fromEntries(classes.map(([cls, fn]) => [cls, fn(ch)])) } : values;
      };
      const e = write("phase", phase, pathOf(chAt, times), { turn: +turn.toFixed(3), t0: +list[0].t.toFixed(3), t1: +list[list.length - 1].t.toFixed(3), vary: classes.map(([cls]) => cls) });
      void e;
    }
    const ph = index.phase;
    lines.push(`phase paths (the tour's model through ${ph.length} phases, ≤ ${STEP} per state): ${ph.reduce((s, e) => s + e.states, 0)} states in ${ph.reduce((s, e) => s + e.files.length, 0)} files, largest step ${Math.max(...ph.map((e) => e.largest)).toFixed(4)}, jumps ${ph.reduce((s, e) => s + e.jumps, 0)}`);
    lines.push(`  ${ph.map((e) => `${e.name} ${e.states}/${e.files.length} at turn ${e.turn}${e.vary && e.vary.length ? ` (vary ${e.vary.join(", ")})` : ""}`).join(", ")}`);
  }
  writeFileSync(join(dir, `states-paths${suffix}.json`), JSON.stringify(index, null, 1));
  return lines;
}
