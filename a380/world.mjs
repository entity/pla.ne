// @ts-check
// a380/world.mjs (S): the A380 figure's analytic world (DESIGN §2, §3.4, §5.1, §8.7).
//
// Every shape two modules share is a function here; modules build against these, never against each
// other's parts. Owned by the scaffold: modules never edit it. Ask S (or I) for a change with the function
// and the numbers.
//
// Frames. Model metres: x aft from the nose tip, y to starboard, z up from the runway (a380/model.mjs).
// Kit units: 1 unit = 1 dm; kit x points FORWARD, y to starboard, z up; the origin is the turntable axis on
// the runway. `kit()` is the one place the frame flips (the kit's projection is a reflection, GL.md 1.1).
import * as M from "./model.mjs";
import * as F from "./follow.mjs";

// ---------------------------------------------------------------------------------------------
// frame
// ---------------------------------------------------------------------------------------------
export const UNIT = 10; // kit units per metre
export const PIVOT_X = 41.3; // model station of the turntable axis (DESIGN §0.2)
/**
 * The cabin windows with their blinds down (7%): one set for both painters (review round 3: the GL windows and the
 * SVG fallback drew different blinds). deck "main" | "upper", i the window's index in M.WINDOWS[deck], side ±1.
 */
export function windowBlind(deck, i, side) {
  const k = side + (deck === "main" ? 3 : 7);
  const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return s - Math.floor(s) < 0.07;
}
export const kit = ([x, y, z]) => [UNIT * (PIVOT_X - x), UNIT * y, UNIT * z];
export const kitDir = ([dx, dy, dz]) => [-dx, dy, dz];
export const fromKit = ([X, Y, Z]) => [PIVOT_X - X / UNIT, Y / UNIT, Z / UNIT];
export const m = (metres) => metres * UNIT; // a length in kit units
/** Cross-group gap in metres (the module contract: 0.012 m, not DESIGN's 0.02, so the kit's 0.15-unit support touch still links the pieces). */
export const GAP = 0.012;
export const SIDES = [
  ["l", -1],
  ["r", 1],
];
export const sideOf = (s) => (s === "l" || s === "L" || s === -1 ? -1 : 1);

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const lerp = (a, b, t) => a + (b - a) * t;
export const vec = { dot, sub, add, mul, cross, unit, lerp };

// ---------------------------------------------------------------------------------------------
// camera and stage (DESIGN §0.4, §2)
// ---------------------------------------------------------------------------------------------
export const VIEW = { width: 960, height: 680, azimuth: 40, elevation: 30, pad: 35, plinthShare: 0.85 };
export const STAGE = {
  plinth: { r: 42.5, z0: -1.6, z1: -0.6 }, // static (back)
  ruler: { r0: 38.9, r1: 39.3, minor: 2, major: 10, minorTo: 40.1, majorTo: 40.6 },
  bolts: { r: 41.5, count: 72 },
  bead: { r: 42.2 },
  platter: { r: 38.6, z0: -0.6, z1: 0 }, // live, deck layer, group air
  platterBolts: { r: 38.3, count: 120 },
  markingsR: 38.6, // marking sets are clipped to the platter edge
  glWindow: [37.6, 38.4], // ground and runway light terms reach 0 inside r 38.4 m
};
export const SWEPT = { nose: 41.3, fenceTE: 41.3, tailplaneTip: 34.76, finTE: 31.43, nlgAxle: 36.33, outboardInlet: 29.88 };

const isoOf = (P) => {
  const a = (P.azimuth * Math.PI) / 180;
  const e = (P.elevation * Math.PI) / 180;
  const k = P.scale * Math.sqrt(1.6);
  const sa = Math.sin(a);
  const ca = Math.cos(a);
  const se = Math.sin(e);
  const ce = Math.cos(e);
  return ([x, y, z]) => [P.origin[0] + k * (x * sa - y * ca), P.origin[1] + k * ((x * ca + y * sa) * se - z * ce)];
};
export const project = (p, P) => isoOf(P)(p);

// ---------------------------------------------------------------------------------------------
// the motion chain (DESIGN §3.1)
// ---------------------------------------------------------------------------------------------
export const PITCH = { point: kit([38.551, 0, 0.7]), axis: [0, -1, 0], range: [0, 12.5] };
export const LIFT = { travel: m(F.LIFT_CAP) };
export const CUTS = {
  "cut.fd": { travel: 40, table: [[0, 0], [0.5, 40]] },
  "cut.f": { travel: 60, table: [[0.15, 0], [0.7, 60]] },
  "cut.up": { travel: 60, table: [[0.15, 0], [0.7, 60]] },
  "cut.md": { travel: 60, table: [[0.4, 0], [1, 60]] },
};
export const COCKPIT_SYNC = 14.5; // cut.fd units at which the cockpit group syncs (DESIGN §3.3, §5.9)

/**
 * Rotation of a kit point about the pitch hinge, then lift and turn: the airframe's world pose.
 * @param {number[]} p a kit point [x, y, z]
 * @param {{ turn?: number, lift?: number, pitch?: number }} [pose] degrees, kit units, degrees
 * @returns {[number, number, number]}
 */
export function poseOf(p, { turn = 0, lift = 0, pitch = 0 } = {}) {
  const P0 = PITCH.point;
  const t = (pitch * Math.PI) / 180;
  const q = sub(p, P0);
  // rotation about kit −y by `pitch` takes +x (the nose) toward +z
  const r = [q[0] * Math.cos(t) - q[2] * Math.sin(t), q[1], q[0] * Math.sin(t) + q[2] * Math.cos(t)];
  const w = add(add(r, P0), [0, 0, lift]);
  const c = Math.cos((turn * Math.PI) / 180);
  const s = Math.sin((turn * Math.PI) / 180);
  return [c * w[0] - s * w[1], s * w[0] + c * w[1], w[2]];
}

// ---------------------------------------------------------------------------------------------
// fuselage section S0 and rings (DESIGN §5.1)
// ---------------------------------------------------------------------------------------------
/** Starboard half of S0 from keel to crown, [y, z] model metres. */
export const S0_HALF = [
  [0.4, 2.36], [0.972, 2.46], [1.445, 2.61], [1.933, 2.86], [2.536, 3.36], [2.921, 3.86], [3.202, 4.4], [3.416, 5.05],
  [3.526, 7.25], [3.402, 7.9], [2.871, 9.15], [2.253, 9.9], [1.879, 10.2], [1.342, 10.5], [0.715, 10.7], [0.35, 10.77],
];
/** The full 32-gon: starboard keel → crown, then port crown → keel. */
export const S0 = [...S0_HALF.map(([y, z]) => [y, z]), ...S0_HALF.slice().reverse().map(([y, z]) => [-y, z])];
export const S0_INDEX = { keel: 0, bellyLine: 6, mainBelt: [7, 8], upperBelt: [9, 10], upperTop: [10, 11], crown: 15 };
export const S0_KEEL = 2.36;
export const S0_CROWN = 10.77;
export const S0_HALF_WIDTH = 3.526;

// Homothetic stations [x, K, c]: ring(x) = (K·y, c + K·z) of S0. From 5.65 aft; the canopy stations ahead of it take the
// model's section (CANOPY_X below), so their K and c here are not used.
export const NOSE_RINGS = [
  [1.9, 0.4782, 1.9118], [2.4, 0.5156, 1.9392], [2.98, 0.5919, 1.6371], [4.0, 0.6992, 1.2], [5.65, 0.8163, 0.7379], [7.2, 0.883, 0.4741],
  [8.9, 0.9343, 0.26], [10.1, 0.9611, 0.1394], [13.4, 0.9968, 0.0076], [14.0, 1, 0],
];
export const TAIL_RINGS = [[46.5, 1, 0], [50, 0.9641, 0.3765], [52.25, 0.9194, 0.8203], [66, 0.3727, 5.4655]]; // stations (K, c: the old homothetic fit, unused since f3)
const RADOME_X = [0.06, 0.15, 0.25, 0.37, 0.5, 0.75, 1.0, 1.25, 1.5, 1.7]; // dense: the radome shades smoothly along x
const TIP_X = [68, 69, 69.4, 69.8, 70.1, 70.4]; // the tip tapers to the APU exhaust end (FUSELAGE.tailConeEnd, 70.4)
/**
 * fu/fuselage (item 14, DESIGN §11.5): the canopy stations take the model's half-width, top and bottom
 * (M.fuselageAt), where the homothetic rings were 5-9% narrow round the windshield and up to 0.25 m low behind the
 * radome. Above the belt vertex (S0 z ≥ BELT_Z: the panes, wipers and mask surround) a ring is S0 scaled by one factor
 * Ky in y and z, as the homothetic rings are, so the facets that carry the glazing stay planar between stations (one
 * Ky/Kz ratio, 1, from 1.9 aft). Below it the keel-to-belt facets take the rest of the height (Kl), so the bottom is
 * the model's too; those facets twist slightly between stations, as the radome's do.
 */
const CANOPY_X = [1.9, 2.4, 2.98, 4.0];
const BELT_Z = S0_HALF[8][1]; // 7.25, the widest S0 vertex
const canopySection = (x) => {
  const s = M.fuselageAt(x);
  const Ky = s.halfWidth / S0_HALF_WIDTH;
  const z8 = s.topZ - Ky * (S0_CROWN - BELT_Z);
  return { kind: "split", Ky, Ku: Ky, Kl: (z8 - s.bottomZ) / (BELT_Z - S0_KEEL), z8 };
};
/** A section in the split form { Ky, Ku (above BELT_Z), Kl (below), z8 (the belt vertex's height) }. */
const splitOf = (s) => (s.kind === "split" ? s : { kind: "split", Ky: s.Ky, Ku: s.Kz, Kl: s.Kz, z8: s.c + s.Kz * BELT_Z });
const lerpSplit = (a, b, t) => {
  const A = splitOf(a);
  const B = splitOf(b);
  return { kind: "split", Ky: lerp(A.Ky, B.Ky, t), Ku: lerp(A.Ku, B.Ku, t), Kl: lerp(A.Kl, B.Kl, t), z8: lerp(A.z8, B.z8, t) };
};

const homothetic = (list, x) => {
  for (let i = 1; i < list.length; i++) {
    const [x0, K0, c0] = list[i - 1];
    const [x1, K1, c1] = list[i];
    if (x >= x0 - 1e-9 && x <= x1 + 1e-9) {
      const t = (x - x0) / (x1 - x0);
      const K = lerp(K0, K1, t);
      return { kind: "homothetic", Ky: K, Kz: K, c: lerp(c0, c1, t) };
    }
  }
  return null;
};
/**
 * f3-fuselage: the tail's rings (46.5-66) as parallel-edge sections of S0. The homothetic rings left the aft fuselage
 * 4.5-8.5% narrow and up to 0.33 m low (truth.md §4); an anisotropic ring would twist every side facet. A ring whose
 * every edge i is parallel to S0's edge i (lengths λ_i free, the keel flat's half-width and height free) keeps every
 * facet between two such rings a trapezoid, so planar, and so does any linear blend of two of them. At each tail
 * station the λ_i are the least-squares fit to the model's section there (top, bottom, the widest vertex's width and the
 * belt vertices' heights, the crown flat's half-width and its shoulder vertex held; the
 * width scaled by the barrel's own S0/model ratio, 3.526/3.567, so the tail meets the barrel without a step), with a
 * light smoothness term between neighbouring λ.
 */
const S0_EDGES = S0_HALF.slice(1).map((p, i) => [p[0] - S0_HALF[i][0], p[1] - S0_HALF[i][1]]);
function solveLinear(A0, b) {
  const n = A0.length;
  const A = A0.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((r, i) => r[n] / r[i]);
}
/** The starboard half [[y, z]…] (16 points) of the parallel-edge section fitted to the model at station x. */
function parallelFit(x) {
  const s = M.fuselageAt(x);
  const Ky = (s.halfWidth * (S0_HALF_WIDTH / M.fuselageAt(46.5).halfWidth)) / S0_HALF_WIDTH;
  const Kz = (s.topZ - s.bottomZ) / (S0_CROWN - S0_KEEL);
  const c = s.topZ - Kz * S0_CROWN;
  const T = S0_HALF.map(([y, z]) => [Ky * y, c + Kz * z]);
  // the belt vertices (6-11: the belly line, the main and upper belts, the deck floors' lines, the U doors' arm facet) keep the old homothetic
  // heights, so the doors, the lap rules and the decks sit on the same facets; the lobes above and below take the rest
  const H0 = TAIL_RINGS.find((r) => Math.abs(r[0] - x) < 1e-9);
  const held = new Map([6, 7, 8, 9, 10, 11].map((k) => [k, H0[2] + H0[1] * S0_HALF[k][1]]));
  const N = 17; // y0, z0, λ0..λ14
  const rows = [];
  const rhs = [];
  for (let k = 0; k < 16; k++)
    for (const ax of [0, 1]) {
      const r = new Array(N).fill(0);
      r[ax] = 1;
      for (let i = 0; i < k; i++) r[2 + i] = S0_EDGES[i][ax];
      const hold = ax === 1 && held.has(k);
      // the crown flat keeps its homothetic half-width too: the fin's root lies on it (its lines end on its creases)
      // and the crown's shoulder (vertex 14, both axes): the fin root's joint and its LE panel line end on it, which a
      // moved shoulder covered at the leading edge
      // The crown vertex's height is the homothetic one too (it is the model's top to 0.3 mm): the fin is built on the
      // crown facet's plane, and a 0.3 mm lift flipped which fin face its far-side LE joint line fades with.
      const crownY = k === 15 || k === 14;
      const w = (ax === 1 && (k === 0 || k === 15)) || (ax === 0 && k === 8) || hold || crownY ? 1e4 : 1;
      rows.push(r.map((v) => v * w));
      rhs.push((hold ? held.get(k) : crownY ? (ax === 0 ? H0[1] * S0_HALF[k][0] : H0[2] + H0[1] * S0_HALF[k][1]) : T[k][ax]) * w);
    }
  for (let i = 0; i + 1 < 15; i++) {
    const r = new Array(N).fill(0);
    r[2 + i] = 1;
    r[3 + i] = -1;
    rows.push(r);
    rhs.push(0);
  }
  const A = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => rows.reduce((a, r) => a + r[i] * r[j], 0)));
  const b = Array.from({ length: N }, (_, i) => rows.reduce((a, r, k) => a + r[i] * rhs[k], 0));
  const u = solveLinear(A, b);
  if (u.slice(2).some((l) => !(l > 0))) throw new Error(`world: tail fit at ${x} has a non-positive edge`);
  const half = [[u[0], u[1]]];
  for (let i = 0; i < 15; i++) half.push([half[i][0] + u[2 + i] * S0_EDGES[i][0], half[i][1] + u[2 + i] * S0_EDGES[i][1]]);
  // the crown and its shoulder exactly as the homothetic ring computed them (the fit holds them to 1e-8 m; the fin's root
  // ring is built on them, and its line planes take their fade normals from near-tied faces a 1e-8 shift can flip)
  const hom = homothetic(TAIL_RINGS, x);
  for (const k of [14, 15]) half[k] = [hom.Ky * S0_HALF[k][0], hom.c + hom.Kz * S0_HALF[k][1]];
  return half;
}
const TAIL_HALF = new Map(TAIL_RINGS.map(([x]) => [x, x === 46.5 ? S0_HALF.map((p) => p.slice()) : parallelFit(x)]));
const polyOf = (half) => ({ kind: "poly", half });
const lerpHalf = (a, b, t) => a.map((p, i) => [lerp(p[0], b[i][0], t), lerp(p[1], b[i][1], t)]);
const tailSection = (x) => {
  for (const [xs] of TAIL_RINGS) if (Math.abs(x - xs) < 1e-9) return polyOf(TAIL_HALF.get(xs));
  for (let i = 1; i < TAIL_RINGS.length; i++) {
    const x0 = TAIL_RINGS[i - 1][0];
    const x1 = TAIL_RINGS[i][0];
    if (x >= x0 - 1e-9 && x <= x1 + 1e-9) return polyOf(lerpHalf(TAIL_HALF.get(x0), TAIL_HALF.get(x1), Math.min(1, Math.max(0, (x - x0) / (x1 - x0)))));
  }
  return null;
};
const halfOf = (s) => {
  if (s.kind === "poly") return s.half;
  if (s.kind === "split") return S0_HALF.map(([y, z]) => [s.Ky * y, s.z8 + (z >= BELT_Z - 1e-9 ? s.Ku : s.Kl) * (z - BELT_Z)]);
  return S0_HALF.map(([y, z]) => [s.Ky * y, s.c + s.Kz * z]);
};

/** The nose's section from 1.9 to 14: the canopy stations' model sections, then the homothetic rings. */
const noseSection = (x) => {
  const at = (v) => (CANOPY_X.includes(v) ? canopySection(v) : homothetic(NOSE_RINGS, v));
  for (let i = 1; i < NOSE_RINGS.length; i++) {
    const x0 = NOSE_RINGS[i - 1][0];
    const x1 = NOSE_RINGS[i][0];
    if (x >= x0 - 1e-9 && x <= x1 + 1e-9) {
      if (!CANOPY_X.includes(x0) && !CANOPY_X.includes(x1)) return homothetic(NOSE_RINGS, x);
      const t = (x - x0) / (x1 - x0);
      return t < 1e-12 ? at(x0) : t > 1 - 1e-12 ? at(x1) : lerpSplit(at(x0), at(x1), t);
    }
  }
  return null;
};
const aniso = (xs) => {
  const s = M.fuselageAt(xs);
  const Kz = (s.topZ - s.bottomZ) / (S0_CROWN - S0_KEEL);
  return { kind: "anisotropic", Ky: s.halfWidth / S0_HALF_WIDTH, Kz, c: s.topZ - Kz * S0_CROWN };
};
const mix = (a, b, t) => (a.kind === "poly" || b.kind === "poly" ? polyOf(lerpHalf(halfOf(a), halfOf(b), t)) : a.kind === "split" || b.kind === "split" ? lerpSplit(a, b, t) : { kind: "anisotropic", Ky: lerp(a.Ky, b.Ky, t), Kz: lerp(a.Kz, b.Kz, t), c: lerp(a.c, b.c, t) });

/**
 * The section transform at station x: { kind, Ky, Kz, c } with ring point (Ky·y, c + Kz·z), or, at the canopy stations
 * and between them, { kind: "split", Ky, Ku, Kl, z8 } with ring point (Ky·y, z8 + (z ≥ BELT_Z ? Ku : Kl)·(z − BELT_Z)).
 */
export function sectionAt(x) {
  if (x < 1.9 - 1e-9) {
    // radome tip: anisotropic rings exact at its stations (width, height and top of the model), linear between
    const xs = [...RADOME_X, 1.9];
    const at = (v) => (v === 1.9 ? noseSection(1.9) : aniso(v));
    if (x <= xs[0]) return at(xs[0]);
    for (let i = 1; i < xs.length; i++) if (x <= xs[i] + 1e-9) return mix(at(xs[i - 1]), at(xs[i]), (x - xs[i - 1]) / (xs[i] - xs[i - 1]));
  }
  if (x <= 14 + 1e-9) return noseSection(x);
  if (x <= 46.5 + 1e-9) return { kind: "barrel", Ky: 1, Kz: 1, c: 0 };
  if (x <= 66 + 1e-9) return tailSection(x);
  const xs = [66, ...TIP_X];
  const at = (v) => (v === 66 ? tailSection(66) : aniso(v));
  for (let i = 1; i < xs.length; i++) if (x <= xs[i] + 1e-9) return mix(at(xs[i - 1]), at(xs[i]), (x - xs[i - 1]) / (xs[i] - xs[i - 1]));
  return at(70.4);
}

/** The model-metre ring [[y, z]…] (32 points, S0 order) at station x. */
export function ring2(x) {
  const s = sectionAt(x);
  if (s.kind === "poly") return [...s.half.map(([y, z]) => [y, z]), ...s.half.slice().reverse().map(([y, z]) => [-y, z])];
  if (s.kind === "split") return S0.map(([y, z]) => [s.Ky * y, s.z8 + (z >= BELT_Z - 1e-9 ? s.Ku : s.Kl) * (z - BELT_Z)]);
  return S0.map(([y, z]) => [s.Ky * y, s.c + s.Kz * z]);
}
/** The ring at station x as model points [x, y, z]. */
export const ring = (x) => ring2(x).map(([y, z]) => [x, y, z]);
/** Every ring station of the loft (where the profile kinks), sorted. */
export const RING_STATIONS = [...new Set([...RADOME_X, ...NOSE_RINGS.map((r) => r[0]), ...TAIL_RINGS.map((r) => r[0]), ...TIP_X])].sort((a, b) => a - b);
/** Stations of the loft between x0 and x1, both ends included. */
export const stationsIn = (x0, x1) => [x0, ...RING_STATIONS.filter((x) => x > x0 + 1e-6 && x < x1 - 1e-6), x1];

/** Outer top, bottom and half-width of the loft at x (for checks against M.fuselageAt). */
export function loftAt(x) {
  const r = ring2(x);
  return { topZ: Math.max(...r.map((p) => p[1])), bottomZ: Math.min(...r.map((p) => p[1])), halfWidth: Math.max(...r.map((p) => Math.abs(p[0]))) };
}

// ---------------------------------------------------------------------------------------------
// fuselage pieces (DESIGN §5.1 W.SHELL)
// ---------------------------------------------------------------------------------------------
// Cut planes sit GAP (0.012 m) over the walls and floors below them, so the kit's support check still
// links the cut pieces (CONTRACT.md): FD 6.012, F and M 6.462, U and UY 9.162. Walls are single-facet
// strips 0.10 m thick.
export const CUT = {
  FD: { x: [1.92, 5.6], floor: 6.0, cut: 6.0 + GAP, walls: null, limit: null, group: "cut.fd" },
  F: { x: [8.92, 15.78], floor: 5.15, cut: 6.45 + GAP, walls: [5.15, 6.45], limit: 6.43, group: "cut.f" },
  U: { x: [23.52, 35.88], floor: 7.9, cut: 9.15 + GAP, walls: [7.9, 9.15], limit: 9.13, group: "cut.up" },
  M: { x: [35.92, 43.48], floor: 5.15, cut: 6.45 + GAP, walls: [5.15, 6.45], limit: 6.43, group: "cut.md" },
  UY: { x: [43.52, 46.48], floor: 7.9, cut: 9.15 + GAP, walls: [7.9, 9.15], limit: 9.13, group: "cut.up" },
};
const ZF = CUT.F.cut;
const ZU = CUT.U.cut;
const ZFD = CUT.FD.cut;
/**
 * Every fuselage piece. clip: { zMin, zMax, side (−1 port keeps y ≤ −yAbs, +1 starboard y ≥ yAbs), yAbs,
 * strip: "main" | "upper" | "belly" (a 0.10 m, belly 0.06 m, strip on that S0 facet of one side) }.
 */
export const SHELL = [
  { name: "nose.radome", x: [0.06, 1.9], clip: {}, group: "pitch", owner: "M2" },
  { name: "nose.canopy", x: [1.9 + GAP, 5.65 - GAP], clip: { zMin: ZFD }, group: "cut.fd", owner: "M2" },
  { name: "nose.fdfloor", x: [1.9, 5.65], clip: { zMin: 4.9, zMax: 6.0 }, group: "pitch", owner: "M2" },
  { name: "nose.baywall.l", x: [1.9, 5.65], clip: { zMax: 4.9, side: -1, yAbs: 1.0 }, group: "pitch", owner: "M2" },
  { name: "nose.baywall.r", x: [1.9, 5.65], clip: { zMax: 4.9, side: 1, yAbs: 1.0 }, group: "pitch", owner: "M2" },
  { name: "nose.fwd", x: [5.65, 8.9], clip: {}, group: "pitch", owner: "M2" },
  { name: "nose.f.block", x: [8.9, 15.8], clip: { zMax: 5.15 }, group: "pitch", owner: "M2" },
  { name: "nose.f.wall.l", x: [8.9, 15.8], clip: { strip: "main", side: -1, zMin: 5.15, zMax: 6.45 }, group: "pitch", owner: "M2" },
  { name: "nose.f.wall.r", x: [8.9, 15.8], clip: { strip: "main", side: 1, zMin: 5.15, zMax: 6.45 }, group: "pitch", owner: "M2" },
  { name: "nose.f.top", x: [8.9 + GAP, 15.8 - GAP], clip: { zMin: ZF }, group: "cut.f", owner: "M2" },
  { name: "fus.B1", x: [15.8, 18.5], clip: {}, group: "pitch", owner: "M6" },
  { name: "fus.B2", x: [18.5, 23.5], clip: { zMin: 4.4 }, group: "pitch", owner: "M6" },
  { name: "fus.B3", x: [23.5, 31.6], clip: { zMin: 4.4, zMax: 7.9 }, group: "pitch", owner: "M6" },
  { name: "fus.B4", x: [31.6, 35.9], clip: { zMin: 5.05, zMax: 7.9 }, group: "pitch", owner: "M6" },
  // the belly slab is split at 33.8 (I): in one piece it lay under the fillet's aft end (x ≤ 32.24) and over the
  // link cheek (x ≥ 35.30), closing a painter's cycle round the stowed wing gear (slab → fillet → box.1f → stay →
  // leg → fairing door → link → slab) seen from the aft quarters
  { name: "fus.B4belly.l", x: [31.6, 33.8], clip: { strip: "belly", side: -1, zMin: 4.4, zMax: 5.05 }, group: "pitch", owner: "M6" },
  { name: "fus.B4belly.l.aft", x: [33.8, 35.9], clip: { strip: "belly", side: -1, zMin: 4.4, zMax: 5.05 }, group: "pitch", owner: "M6" },
  { name: "fus.B4belly.r", x: [31.6, 33.8], clip: { strip: "belly", side: 1, zMin: 4.4, zMax: 5.05 }, group: "pitch", owner: "M6" },
  { name: "fus.B4belly.r.aft", x: [33.8, 35.9], clip: { strip: "belly", side: 1, zMin: 4.4, zMax: 5.05 }, group: "pitch", owner: "M6" },
  { name: "fus.U.wall.l", x: [23.5, 35.9], clip: { strip: "upper", side: -1, zMin: 7.9, zMax: 9.15 }, group: "pitch", owner: "M6" },
  { name: "fus.U.wall.r", x: [23.5, 35.9], clip: { strip: "upper", side: 1, zMin: 7.9, zMax: 9.15 }, group: "pitch", owner: "M6" },
  { name: "fus.U.crown", x: [23.5 + GAP, 35.9], clip: { zMin: ZU }, group: "cut.up", owner: "M6" },
  { name: "fus.B5", x: [35.9, 43.5], clip: { zMin: 4.4, zMax: 5.15 }, group: "pitch", owner: "M6" },
  { name: "fus.M.wall.l", x: [35.9, 43.5], clip: { strip: "main", side: -1, zMin: 5.15, zMax: 6.45 }, group: "pitch", owner: "M6" },
  { name: "fus.M.wall.r", x: [35.9, 43.5], clip: { strip: "main", side: 1, zMin: 5.15, zMax: 6.45 }, group: "pitch", owner: "M6" },
  { name: "fus.M.chunk", x: [35.9 + GAP, 43.5 - GAP], clip: { zMin: ZF }, group: "cut.md", owner: "M6" },
  { name: "fus.B6", x: [43.5, 46.5], clip: { zMin: 4.4, zMax: 7.9 }, group: "pitch", owner: "M6" },
  { name: "fus.UY.wall.l", x: [43.5, 46.5], clip: { strip: "upper", side: -1, zMin: 7.9, zMax: 9.15 }, group: "pitch", owner: "M6" },
  { name: "fus.UY.wall.r", x: [43.5, 46.5], clip: { strip: "upper", side: 1, zMin: 7.9, zMax: 9.15 }, group: "pitch", owner: "M6" },
  { name: "fus.UY.crown", x: [43.5, 46.5 - GAP], clip: { zMin: ZU }, group: "cut.up", owner: "M6" },
  { name: "tail.aft", x: [46.5, 52.25], clip: {}, group: "pitch", owner: "M2" },
  { name: "tail.cone", x: [52.25, 66], clip: {}, group: "pitch", owner: "M2" },
  { name: "tail.tip", x: [66, 70.4], clip: {}, group: "pitch", owner: "M2" },
];
export const shell = (name) => {
  const piece = SHELL.find((p) => p.name === name);
  if (!piece) throw new Error(`world: no shell piece ${name}`);
  return piece;
};

const STRIP = { main: { edge: S0_INDEX.mainBelt, depth: 0.1 }, upper: { edge: S0_INDEX.upperBelt, depth: 0.1 }, belly: { edge: [6, 7], depth: 0.06 } };

/** The line of an S0 edge at station x for a side: { a, b ([y, z]), n (outward), t (unit a→b) }. */
export function facetLine(x, edge, side) {
  const r = ring2(x);
  let a = r[edge[0]];
  let b = r[edge[1]];
  if (side < 0) {
    a = [-a[0], a[1]];
    b = [-b[0], b[1]];
  }
  const t = [b[0] - a[0], b[1] - a[1]];
  const l = Math.hypot(t[0], t[1]);
  const tu = [t[0] / l, t[1] / l];
  let n = [tu[1], -tu[0]];
  if (n[0] * side < 0) n = [-n[0], -n[1]];
  return { a, b, n, t: tu };
}

/**
 * The joints of a fuselage piece (kit patch 15): where it meets another piece of the same skin, its outline is drawn
 * as a seam, faint between fixed pieces and mid round the cutaway's lifting pieces (DESIGN §5.7: faint production
 * joints). Every end ring is a joint except the tail tip's free end; clip planes in z are joints, side clips are the
 * nose-gear bay's edges and stay outlines.
 */
function jointsOf(piece) {
  const tone = piece.group === "pitch" ? "faint" : "mid";
  const c = piece.clip;
  const joints = [];
  if (c.zMin !== undefined) joints.push({ n: [0, 0, -1], d: -m(c.zMin), tone });
  if (c.zMax !== undefined) joints.push({ n: [0, 0, 1], d: m(c.zMax), tone });
  return { jointCaps: { first: tone, last: tone }, joints };
}
/** The T.hull spec { rings, flats, smooth, sharp, jointCaps, joints } of a fuselage piece, in kit coordinates. */
export function loft(name) {
  const piece = shell(name);
  const [x0, x1] = piece.x;
  const xs = stationsIn(x0, x1);
  const c = piece.clip;
  if (c.strip) {
    const { edge, depth } = STRIP[c.strip];
    const rings = xs.map((x) => {
      const f = facetLine(x, edge, c.side);
      const at = (z) => {
        const s = (z - f.a[1]) / f.t[1];
        return [f.a[0] + f.t[0] * s, z];
      };
      const lo = at(c.zMin);
      const hi = at(c.zMax);
      // the inner face: the facet line moved inward by `depth`, cut by the same two z planes as the outer face
      const ia = [f.a[0] - f.n[0] * depth, f.a[1] - f.n[1] * depth];
      const atIn = (z) => [ia[0] + (f.t[0] * (z - ia[1])) / f.t[1], z];
      const pts = [lo, hi, atIn(c.zMax), atIn(c.zMin)];
      return pts.map(([y, z]) => kit([x, y, z]));
    });
    return { rings, flats: [], smooth: true, sharp: 30, ...jointsOf(piece) };
  }
  const rings = xs.map((x) => ring(x).map(kit));
  const flats = [];
  if (c.zMin !== undefined) flats.push({ n: [0, 0, -1], d: -m(c.zMin) });
  if (c.zMax !== undefined) flats.push({ n: [0, 0, 1], d: m(c.zMax) });
  if (c.side) flats.push({ n: [0, -c.side, 0], d: -m(c.yAbs) });
  return { rings, flats, smooth: true, sharp: 30, ...jointsOf(piece) };
}

/** The piece { name, group, owner } whose outer surface carries the skin point at (x, z) on a side (±1). */
export function partAt(x, z, side = 1) {
  for (const piece of SHELL) {
    if (x < piece.x[0] - 1e-6 || x > piece.x[1] + 1e-6) continue;
    const c = piece.clip;
    if (c.side && Math.sign(c.side) !== Math.sign(side)) continue;
    if (c.zMin !== undefined && z < c.zMin - 1e-6) continue;
    if (c.zMax !== undefined && z > c.zMax + 1e-6) continue;
    return { name: piece.name, group: piece.group, owner: piece.owner };
  }
  return null;
}

/**
 * The facet frame at a skin point (x, z) on a side (±1), model metres: { o (on the facet), u (forward along
 * the facet), v (in-plane up), n (outward), facet (S0 edge index, starboard numbering), x, z }.
 */
export function facetFrame(x, z, side = 1) {
  const r = ring2(x);
  const s = Math.sign(side) || 1;
  let best = null;
  for (let i = 0; i < 15; i++) {
    const a = r[i];
    const b = r[i + 1];
    if (Math.abs(b[1] - a[1]) < 1e-9) continue;
    if (z < Math.min(a[1], b[1]) - 1e-6 || z > Math.max(a[1], b[1]) + 1e-6) continue;
    best = i;
    break;
  }
  if (best === null) throw new Error(`world: facetFrame: no side facet at x ${x}, z ${z}`);
  const dx = x < 46 ? 0.05 : -0.05;
  const r2 = ring2(x + dx);
  const a = [x, s * r[best][0], r[best][1]];
  const b = [x, s * r[best + 1][0], r[best + 1][1]];
  const c = [x + dx, s * r2[best][0], r2[best][1]];
  let n = unit(cross(sub(b, a), sub(c, a)));
  if (n[1] * s < 0) n = mul(n, -1);
  const t = (z - a[2]) / (b[2] - a[2]);
  const o = [x, lerp(a[1], b[1], t), z];
  let v0 = unit(sub(b, a));
  if (v0[2] < 0) v0 = mul(v0, -1);
  let u = unit(cross(v0, n));
  if (u[0] > 0) u = mul(u, -1);
  let v = unit(cross(n, u));
  if (v[2] < 0) v = mul(v, -1);
  return { o, u, v, n, facet: best, x, z };
}

// ---------------------------------------------------------------------------------------------
// belly fairing (DESIGN §5.1)
// ---------------------------------------------------------------------------------------------
const FAIR_TEMPLATE = [[3.202, 4.4], [3.95, 3.85], [4.3, 3.3], [4.35, 2.7], [4.2, 2.1], [3.7, 1.66]];
export const FAIRING = {
  x: [18.5, 46.5],
  template: FAIR_TEMPLATE,
  /** The starboard half [y, z] of the fairing section at x, top (the barrel's belly-line vertex) to bottom. */
  half(x) {
    const t = M.FUSELAGE.bellyFairing;
    const hw = M.interp(t, x, 2);
    const bottom = M.interp(t, x, 1);
    const sy = (hw - 3.202) / (4.35 - 3.202);
    const sz = (4.4 - bottom) / (4.4 - 1.66);
    return FAIR_TEMPLATE.map(([y, z]) => [3.202 + (y - 3.202) * sy, 4.4 + (z - 4.4) * sz]);
  },
  /** The full convex section [[y, z]…]: starboard top → bottom, then port bottom → top. */
  section(x) {
    const h = FAIRING.half(x);
    return [...h, ...h.slice().reverse().map(([y, z]) => [-y, z])];
  },
  gapWLG: [31.85, 35.3],
  blg: [35.92, 40.9],
  stations: [18.5, 20, 22, 22.5, 25, 28, 29.7, 31.85, 35, 35.3, 35.92, 38, 40, 40.9, 42, 44, 46.5],
};

// ---------------------------------------------------------------------------------------------
// wing (DESIGN §5.1; device spans after truth amendment T1)
// ---------------------------------------------------------------------------------------------
const AIRFOIL = [[0.025, 0], [0.006, 0.12], [0, 0.42], [0.01, 0.62], [0.03, 0.78], [0.07, 0.9], [0.12, 0.97], [0.25, 1.0], [0.4, 0.97], [0.55, 0.86], [0.7, 0.62], [0.8, 0.45], [0.9, 0.26], [1.0, 0.06], [1.0, 0]];
const ROOT_Y = 4.45;
const ROOT_T = 2.08;
const STATIONS = [4.45, 6.8, 12.45, 13.88, 18.99, 25.75, 39.875];
const PANELS = [[4.45, 6.8], [6.8, 12.45], [12.45, 13.88], [13.88, 18.99], [18.99, 25.75], [25.75, 39.875]];
const thicknessAt = (a) => {
  if (a <= ROOT_Y + 1e-9) return ROOT_T;
  if (a < 6.8) return lerp(ROOT_T, M.wingAt(6.8).thickness, (a - ROOT_Y) / (6.8 - ROOT_Y));
  return M.wingAt(a).thickness;
};
const trueBottom = (a) => M.wingAt(a).zMid - thicknessAt(a) / 2;
const panelOf = (a) => (a >= 18.99 - 1e-9 ? [18.99, 39.875] : PANELS.find(([p0, p1]) => a >= p0 - 1e-9 && a <= p1 + 1e-9) ?? PANELS[0]);
/** The bottom z of the panel plane holding |y| (flat in x; the panels from 18.99 out share one plane). */
function bottomAt(y) {
  const a = Math.abs(y);
  const [y0, y1] = panelOf(a);
  return lerp(trueBottom(y0), trueBottom(y1), (a - y0) / (y1 - y0));
}
const faceLine = (y0, y1, xi) => {
  const a = M.wingAt(y0);
  const b = M.wingAt(y1);
  return { y: [y0, y1], x: [a.le + xi * a.chord, b.le + xi * b.chord], xi };
};
export const WING = {
  rootY: ROOT_Y,
  rootThickness: ROOT_T,
  stations: STATIONS,
  panels: PANELS,
  airfoil: AIRFOIL,
  /** LE x, chord, thickness, panel bottom and top at span |y| (model metres). */
  at(y) {
    const a = Math.abs(y);
    const w = M.wingAt(a);
    const t = thicknessAt(a);
    const bottom = bottomAt(a);
    return { le: w.le, te: w.te, chord: w.chord, thickness: t, bottom, top: bottom + t, zMid: w.zMid };
  },
  bottomAt,
  /** The bottom plane of the panel holding |y|, signed side: { n (down), d } with n·p = d, model metres. */
  bottomPlane(y) {
    const a = Math.abs(y);
    const [y0, y1] = panelOf(a);
    const s = Math.sign(y) || 1;
    const p0 = [0, s * y0, trueBottom(y0)];
    const p1 = [0, s * y1, trueBottom(y1)];
    let n = unit(cross([1, 0, 0], sub(p1, p0)));
    if (n[2] > 0) n = mul(n, -1);
    return { n, d: dot(n, p0) };
  },
  /** LE and TE face lines: vertical planes along straight plan lines (DESIGN §5.1). */
  faces: {
    le: [faceLine(4.45, 13.88, 0.11), faceLine(13.88, 39.1, 0.11)],
    te: [faceLine(4.45, 12.45, 0.72), faceLine(12.45, 25.75, 0.72), faceLine(25.75, 39.875, 0.72)],
  },
  /** Device spans per wing (|y|, metres), after T1. */
  devices: {
    droop: [{ id: "1", y: [7.2, 10.32] }, { id: "2", y: [10.32, 13.88] }],
    slats: [{ id: "2", y: [15.6, 18.41] }, { id: "3", y: [18.41, 21.51] }, { id: "4", y: [21.51, 24.61] }, { id: "5", y: [26.45, 30.12] }, { id: "6", y: [30.12, 33.8] }, { id: "7", y: [33.8, 38.05] }],
    leGaps: [[13.88, 15.6], [24.61, 26.45]],
    fixedLE: { root: [4.45, 7.2], "gin.a": [13.88, 14.35], "gin.b": [15.25, 15.6], "gout.a": [24.61, 25.25], "gout.b": [26.15, 26.45], tip: [38.05, 39.875] },
    flaps: [{ id: "in", y: [4.6, 12.45] }, { id: "mid", y: [12.45, 18.99] }, { id: "out", y: [18.99, 25.53] }],
    fixedTE: { "gap.a": [25.53, 25.75], "gap.b": [25.75, 26.0], tip: [35.24, 39.875] },
    ailerons: [{ id: "in", y: [26.0, 27.76] }, { id: "mid", y: [27.76, 31.14] }, { id: "out", y: [31.14, 35.24] }],
    spoilers: M.CONTROLS.spoilers.map((s) => ({ id: String(s.id), y: s.id === 1 ? [4.5, s.y[1]] : s.y.slice() })),
  },
  pylonSlots: [[14.35, 15.25], [25.25, 26.15]],
  fence: M.WING.fence,
  /** The airfoil at signed span y: { points [[x, z]…] (flat bottom on the panel plane), topAt(x), …at(y) }. */
  section(y) {
    const w = WING.at(y);
    const points = AIRFOIL.map(([xi, zeta]) => [w.le + xi * w.chord, w.bottom + zeta * w.thickness]);
    const top = AIRFOIL.slice(1, 14);
    const topAt = (x) => {
      const xi = (x - w.le) / w.chord;
      for (let i = 1; i < top.length; i++) {
        const [a0, b0] = top[i - 1];
        const [a1, b1] = top[i];
        if ((xi - a0) * (xi - a1) <= 0 && a1 !== a0) return w.bottom + w.thickness * lerp(b0, b1, (xi - a0) / (a1 - a0));
      }
      return w.bottom + w.thickness * (xi < 0.5 ? top[0][1] : top[top.length - 1][1]);
    };
    return { points, topAt, ...w };
  },
};
/** The well for the wing gear (DESIGN §5.1): x 32.55 → TE face, root plane → y 6.80, ceiling 0.15 m under the upper skin. */
WING.well = { x0: 32.55, y: [4.45, 6.8], ceilingAt: (x, y) => WING.section(y).topAt(x) - 0.15 };
// the well ceiling as the one plane M3 (box.1u, the fixed root trailing edge) and M5 (wlg.{s}.fit) both fit:
// samples of the section top − 0.15 over y 5.1 → 6.8 and x 32.55 → the TE face, least squares, lowered to hold
// everywhere (M3 R4, M5 R1); z = c0 + cx·x + cy·|y|
WING.well.ceiling = { c0: 9.0708, cx: -0.1865, cy: 0.24462, at: (x, y) => 9.0708 - 0.1865 * x + 0.24462 * Math.abs(y) };
/** Wing section points as model [x, y, z] at signed span y. */
export const wingSection = (y) => WING.section(y).points.map(([x, z]) => [x, y, z]);

// ---------------------------------------------------------------------------------------------
// nacelles (DESIGN §5.1, §5.5)
// ---------------------------------------------------------------------------------------------
export const NACELLE_ROWS = [
  { part: "lip", s: [0, 0.5], r: [1.7, 1.94] },
  { part: "fancowl", s: [0.5, 3.81], r: [1.94, 1.9] },
  { part: "aftcowl", s: [3.81, 6.2], r: [1.9, 1.205] },
  { part: "core", s: [6.2, 6.93], r: [1.0, 0.835] },
  { part: "plug", s: [6.93, 8.39], r: [0.495, 0.08] },
];
export const NACELLE = M.ENGINES.list.map((e) => {
  const top = (s0, s1, r0, r1) => {
    const a = [e.inletLipX + s0, e.y, e.centreZ + r0];
    const b = [e.inletLipX + s1, e.y, e.centreZ + r1];
    let n = unit(cross(sub(b, a), [0, 1, 0]));
    if (n[2] < 0) n = mul(n, -1);
    return { n, d: dot(n, a), from: a, to: b };
  };
  return {
    id: e.id,
    side: e.side === "L" ? -1 : 1,
    y: e.y,
    lip: e.inletLipX,
    cz: e.centreZ,
    rows: NACELLE_ROWS,
    reverser: e.thrustReverser,
    pylon: e.pylon,
    fanTop: top(0.5, 3.81, 1.94, 1.9),
    aftTop: top(3.81, 6.2, 1.9, 1.205),
    coreTop: top(6.2, 6.93, 1.0, 0.835),
  };
});

// ---------------------------------------------------------------------------------------------
// gear bays (DESIGN §5.1): convex polyhedra as half-spaces { n, d } (n·p <= d inside), model metres
// ---------------------------------------------------------------------------------------------
const offsetLines = (poly, by) => {
  let area = 0;
  for (let i = 0; i < poly.length; i++) area += poly[i][0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * poly[i][1];
  const s = area > 0 ? 1 : -1;
  return poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const n = [(s * (b[1] - a[1])) / l, (-s * (b[0] - a[0])) / l];
    return { n, d: n[0] * a[0] + n[1] * a[1] - by };
  });
};
export const BAYS = {
  nlg: { x: [1.9, 5.65], halfSpaces: [{ n: [-1, 0, 0], d: -1.9 }, { n: [1, 0, 0], d: 5.65 }, { n: [0, 1, 0], d: 1.0 }, { n: [0, -1, 0], d: 1.0 }, { n: [0, 0, 1], d: 4.88 }] },
  blg: {
    x: [35.92, 40.9],
    halfSpaces: [
      { n: [-1, 0, 0], d: -35.92 },
      { n: [1, 0, 0], d: 40.9 },
      { n: [0, 0, 1], d: 4.38 },
      ...[35.92, 40.9].flatMap((x) => offsetLines(FAIRING.section(x), 0.175).map(({ n, d }) => ({ n: [0, n[0], n[1]], d, at: x }))),
    ],
  },
  wlg: (side) => ({
    x: [31.85, 35.3],
    side,
    halfSpaces: [
      { n: [-1, 0, 0], d: -31.85 },
      { n: [1, 0, 0], d: 35.3 },
      { n: [0, -side, 0], d: -1.8 },
      { n: [0, 0, 1], d: 4.98 },
      ...[31.85, 35.3].flatMap((x) => offsetLines(FAIRING.section(x), 0.085).map(({ n, d }) => ({ n: [0, n[0], n[1]], d, at: x }))),
    ],
  }),
  /** max over the half-spaces of n·p − d: ≤ −c means inside with clearance c (model metres). */
  depth(bay, p) {
    let most = -Infinity;
    for (const h of bay.halfSpaces) most = Math.max(most, dot(h.n, p) - h.d);
    return most;
  },
};

// ---------------------------------------------------------------------------------------------
// wing-gear solve (DESIGN §5.1): M5's solve against its parts (gear.mjs GEO/WCHAIN, printed by --check), starboard;
// mirror y for the left gear. The side stay's airframe pin is in the well, on a bracket on box.1f's aft face.
// ---------------------------------------------------------------------------------------------
export const WLG_SOLVE = {
  provisional: false,
  pintle: [32.99, 6.46, 3.55],
  axis: [1, 0, 0], // model; + swings the leg inboard
  legLength: 2.481, // to the bogie pivot, 0.45 m above the axle line
  thetaW: 74.25,
  oleo: { travel: 0.8, flight: 0.6 },
  betaW: 0,
  betaStow: 0,
  tiltStop: 6,
  stayPivots: { airframe: [32.6075, 5.55, 3.85], legAt: 0.42, links: [0.627, 0.766] },
};

// ---------------------------------------------------------------------------------------------
// light positions decided by the design (truth amendment T6 for the tail lights; T3 for the eye)
// ---------------------------------------------------------------------------------------------
export const LIGHT_AT = {
  beaconUpperL: [26.9, -0.8, 10.84],
  beaconUpperR: [26.9, 0.8, 10.84],
  beaconLower: [24.7, 0, 1.78],
  // T6, on the tapered tail tip (the APU exhaust fairing): nav on the crown facet, strobe under the keel facet
  navTail: [70.25, 0, +Math.max(...ring2(70.25).map((p) => p[1])).toFixed(3)],
  strobeTail: [70.1, 0, +Math.min(...ring2(70.1).map((p) => p[1])).toFixed(3)],
};
export const PILOT_EYE = [2.92, 0.53, 7.17];

// ---------------------------------------------------------------------------------------------
// key states (DESIGN §3.4): 24 channel sets at the sampled indices of poses(), turn i·15°
// ---------------------------------------------------------------------------------------------
const CONF = { 0: [0, 0, 0], 1: [20, 0, 0], "1+F": [20, 8, 5], 2: [20, 17, 5], 3: [23, 26, 5], FULL: [23, 33, 5] };
export const CONF_ANGLES = CONF;
const doorsAll = (v) => Object.fromEntries(M.DOOR_IDS.map((id) => [`door.${id}`, v]));
/** A full channel set on the ground at rest, with overrides. */
export const groundChannels = (extra = {}) => ({ turn: 0, lift: 0, pitch: 0, rot: 0, trim: 0, gear: 1, gearDoors: 0, steer: 0, slat: 0, flap: 0, droop: 0, roll: 0, pitchCmd: 0, yaw: 0, spoiler: 0, spoiler1: 0, cabin: 0, ...doorsAll(0), ...extra });
const conf = (name) => ({ slat: CONF[name][0], flap: CONF[name][1], droop: CONF[name][2] });
const climb = (extra = {}) => groundChannels({ lift: 60, pitch: 8, rot: 0, trim: 1, gear: 0, gearDoors: 0, ...extra });
const cabinFor = (cutFd) => {
  let lo = 0;
  let hi = 0.5;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (40 * F.tableAt([[0, 0], [0.5, 1]], mid, "smooth") < cutFd) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};
// the kit builds framed planes from these 24 states only (kit patch 9 is not done, DESIGN §3.4): spoilers 1 and 2
// ride one channel on their own hinge lines, so their relative pose is sampled at 0, 17.5, 30, 35 and 50° (review
// round 2: with only 0 and 50 the speed brake clip found the pair unseparated mid-way)
export const KEY_STATES = [
  groundChannels({ ...doorsAll(1), cabin: 1 }),
  groundChannels({ ...doorsAll(0.5), cabin: 0.5, steer: -70 }),
  groundChannels({ ...doorsAll(0.75), cabin: 0.25, steer: 70 }),
  groundChannels({ steer: -35 }),
  groundChannels({ ...conf("1+F"), steer: 35 }),
  groundChannels({ ...conf("2") }),
  groundChannels({ ...conf("3") }),
  groundChannels({ ...conf("FULL"), roll: -1, pitchCmd: -1, yaw: -1 }),
  groundChannels({ ...conf("FULL"), roll: 1, pitchCmd: 1, yaw: 1, spoiler: 50, spoiler1: 50 }),
  groundChannels({ ...conf("0"), roll: -0.5, pitchCmd: 0.5, yaw: -0.5, spoiler: 25, spoiler1: 17.5 }),
  groundChannels({ ...conf("1+F"), roll: 0.5, pitchCmd: -0.5, yaw: 0.5 }),
  groundChannels({ ...conf("1+F"), pitch: 5, rot: 5 }),
  groundChannels({ ...conf("1+F"), pitch: 10, rot: 10 }),
  groundChannels({ ...conf("1+F"), lift: F.liftOf(0.5), pitch: 12.5, rot: 0, trim: 0.5 }),
  climb({ ...conf("1+F"), lift: 52, pitch: 12, gear: 0.75, gearDoors: 1 }),
  climb({ ...conf("1+F"), lift: 55, pitch: 12, gear: 0.5, gearDoors: 1 }),
  climb({ ...conf("1+F"), lift: 57, pitch: 11, gear: 0.25, gearDoors: 1 }),
  climb({ ...conf("1+F"), lift: 58, pitch: 10, gear: 0, gearDoors: 1 }),
  climb({ ...conf("1+F"), lift: 59, pitch: 9 }),
  climb({ ...conf("0"), pitch: 2.6, cabin: 1 }),
  climb({ ...conf("0"), pitch: 9, cabin: 0.5, spoiler: 30, spoiler1: 30 }),
  climb({ ...conf("1"), cabin: 0 }),
  groundChannels({ cabin: cabinFor(16), "door.FWD": 1, "door.AFT": 1 }),
  groundChannels({ steer: 0, spoiler: 50, spoiler1: 35 }),
].map((state, i) => ({ ...state, turn: i * 15 }));

// ---------------------------------------------------------------------------------------------
// the fit (DESIGN §2)
// ---------------------------------------------------------------------------------------------
/** Airframe extremes as kit points at rest, plus the cut pieces' lifted tops. */
export function extremes() {
  const pts = [];
  const K = (p) => pts.push(kit(p));
  K([0, 0, 4.81]);
  for (const x of [14, 30, 46]) for (const s of [-1, 1]) K([x, s * 0.35, 10.77]);
  K([68.02, 0, 24.15]);
  K([72.72, 0, 24.15]);
  for (const s of [-1, 1]) {
    for (const x of [49.16, 52.07]) K([x, s * 39.875, 7.52]), K([x, s * 39.875, 5.24]);
    for (const x of [68.85, 72.57]) K([x, s * 15.185, 9.18]);
    for (const [x, y] of [[4.97, 0.75], [32.725, 6.9], [34.425, 6.9], [35.151, 3.4], [38.551, 3.4]]) K([x, s * y, 0]);
    for (const x of [23.5, 35, 46.5]) K([x, s * 0.35, 10.77 + 6]);
    K([3.5, s * 0.5, 8.7 + 4]);
  }
  return pts;
}

let fitCache = null;
/**
 * The projection: the plinth spans 85% of the width; every reachable airframe extreme (every trajectory
 * state, 2.5° turns) lies inside the pad. Returns { P, k, top, bottom, left, right, states }.
 */
export function fit() {
  if (fitCache) return fitCache;
  const proj = isoOf({ origin: [0, 0], scale: 1, azimuth: VIEW.azimuth, elevation: VIEW.elevation });
  const rim = [];
  for (let i = 0; i < 360; i++) {
    const t = (i / 360) * 2 * Math.PI;
    for (const z of [STAGE.plinth.z0, STAGE.plinth.z1]) rim.push([m(STAGE.plinth.r) * Math.cos(t), m(STAGE.plinth.r) * Math.sin(t), m(z)]);
  }
  const rx = rim.map((p) => proj(p)[0]);
  const scale = (VIEW.plinthShare * VIEW.width) / (Math.max(...rx) - Math.min(...rx));
  const p0 = isoOf({ origin: [0, 0], scale, azimuth: VIEW.azimuth, elevation: VIEW.elevation });
  const traj = F.trajectory(M, { every: 0.5 });
  const states = traj.map((s) => ({ lift: F.liftOf(s.state.height), pitch: Math.min(12.5, s.state.pitch) }));
  // the tail-strike pitch on the ground and at the key state's half metre of lift; review round 3: no longer the
  // unreachable 12.5° at the full 6 m of lift, which reserved 50 px of empty card over the fin (the climb's highest
  // reachable pose is the trajectory's own), so the figure now sits centred between its true extremes
  states.push({ lift: 0, pitch: 12.5 }, { lift: 5, pitch: 12.5 });
  let top = Infinity;
  let bottom = -Infinity;
  let left = Infinity;
  let right = -Infinity;
  const ex = extremes();
  for (const st of states)
    for (let turn = 0; turn < 360; turn += 2.5)
      for (const p of ex) {
        const q = p0(poseOf(p, { turn, lift: st.lift, pitch: st.pitch }));
        top = Math.min(top, q[1]);
        bottom = Math.max(bottom, q[1]);
        left = Math.min(left, q[0]);
        right = Math.max(right, q[0]);
      }
  for (const p of rim) {
    const q = p0(p);
    top = Math.min(top, q[1]);
    bottom = Math.max(bottom, q[1]);
  }
  const oy = VIEW.pad + (VIEW.height - 2 * VIEW.pad - (bottom - top)) / 2 - top;
  const P = { origin: [VIEW.width / 2, Math.round(oy * 100) / 100], scale: Math.round(scale * 1e5) / 1e5, azimuth: VIEW.azimuth, elevation: VIEW.elevation };
  fitCache = { P, k: P.scale * Math.sqrt(1.6), top: top + P.origin[1], bottom: bottom + P.origin[1], left: left + P.origin[0], right: right + P.origin[0], states: states.length };
  return fitCache;
}

/** The viewer's bearing in the aircraft frame at a turn: 0 nose-on, + starboard (DESIGN §2). */
export const bearingOf = (turn) => 40 - turn;
