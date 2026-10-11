// a380/parts/gear.mjs (M5): the landing gear. Nose gear (2 wheels, steers ±70°, retracts forward), two wing gears
// (4 wheels, retract inboard into the belly) and two body gears (6 wheels, rear axle steers, retract aft), each with
// its fitting, knuckle, leg, oleo, bogie, two-link stay solved as a 4-bar, doors and lights.
// Design: a380/DESIGN.md §5.6, §3.1–3.4; contract: notes/CONTRACT.md; notes: notes/modules/M5.md.
//
// Frames. Geometry is written in model metres (x aft, y starboard, z up) and converted once with W.kit; every
// kinematic solve below works in kit units (x forward, y starboard, z up; rotations right-handed about kit axes).
import * as W from "../world.mjs";
import * as M from "../model.mjs";
import * as Fm from "../follow.mjs";

export const id = "gear";
export const owner = "M5";
export const title = "Gear: nose, wing and body gear with stays, oleos, bogies, steering, doors, rotation following the runway, stowed in bays";
/** Every part name this module creates starts with one of these (the harness enforces it). */
export const prefixes = ["nlg.", "wlg.", "blg.", "light.bay", "light.camNose", "light.toNose", "light.taxiNose", "light.rwy"];
export const stub = false;

// ---------------------------------------------------------------------------------------------
// vector helpers (kit space)
// ---------------------------------------------------------------------------------------------
const D2R = Math.PI / 180;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => mul(a, 1 / (len(a) || 1));
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/** Rotate p about the unit axis a through c by deg (right-handed). */
export function rot(p, c, a, deg) {
  const t = deg * D2R;
  const q = sub(p, c);
  const cs = Math.cos(t);
  const sn = Math.sin(t);
  return add(c, add(add(mul(q, cs), mul(cross(a, q), sn)), mul(a, dot(a, q) * (1 - cs))));
}
const rotDir = (d, a, deg) => rot(d, [0, 0, 0], a, deg);
/** Signed angle (deg) about axis a from v0 to v1 (both projected on the plane ⟂ a). */
function angleAbout(a, v0, v1) {
  const p0 = sub(v0, mul(a, dot(a, v0)));
  const p1 = sub(v1, mul(a, dot(a, v1)));
  return Math.atan2(dot(a, cross(p0, p1)), dot(p0, p1)) / D2R;
}
const K = (p) => W.kit(p);
const KD = (d) => W.kitDir(d);
const m = (v) => W.m(v);
const GAP = W.GAP;
const smooth01 = (g) => {
  const t = Math.min(1, Math.max(0, g));
  return t * t * (3 - 2 * t);
};
/** Any unit vector perpendicular to a, as close to hint as possible. */
function perp(a, hint) {
  let u = sub(hint, mul(a, dot(hint, a)));
  if (len(u) < 1e-6) u = sub([0, 0, 1], mul(a, a[2]));
  if (len(u) < 1e-6) u = sub([1, 0, 0], mul(a, a[0]));
  return unit(u);
}
/** 2D convex hull (monotone chain), counter-clockwise. */
function hull2(points) {
  const p = points.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const c = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) {
    while (lo.length >= 2 && c(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-12) lo.pop();
    lo.push(q);
  }
  const up = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && c(up[up.length - 2], up[up.length - 1], q) <= 1e-12) up.pop();
    up.push(q);
  }
  up.pop();
  lo.pop();
  return lo.concat(up);
}
const circle2 = (cx, cy, r, n = 24, a0 = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos(a0 + (i / n) * 2 * Math.PI), cy + r * Math.sin(a0 + (i / n) * 2 * Math.PI)]);
/** Ring of n points of radius r about centre c in the plane spanned by unit e1, e2 (kit). */
const ring3 = (c, e1, e2, r, n = 24) => Array.from({ length: n }, (_, i) => add(c, add(mul(e1, r * Math.cos((i / n) * 2 * Math.PI)), mul(e2, r * Math.sin((i / n) * 2 * Math.PI)))));

// ---------------------------------------------------------------------------------------------
// dimensions (model metres unless marked)
// ---------------------------------------------------------------------------------------------
const G = M.GEAR;
const TYRE = { main: { r: G.tyres.main.diameter / 2, w: G.tyres.main.width }, nose: { r: G.tyres.nose.diameter / 2, w: G.tyres.nose.width } };
const RM = TYRE.main.r; // 0.70: main axles at the free radius
const RN = TYRE.nose.r; // 0.635
export const SIDES = W.SIDES;

// ---------------------------------------------------------------------------------------------
// the 4-bar stays: closed form at build time, tabulated as follow rules on `gear`
// ---------------------------------------------------------------------------------------------
/**
 * A two-link stay: stay.up hinged on the airframe at A, stay.lo hinged on stay.up at the knee K0, its far end a
 * knuckle on the pin B0 of a lug on the leg. All three axes are parallel to the leg's hinge axis `axis` (kit, unit,
 * through H). `legAt(g)` is the leg angle at gear g. `fold` picks the knee branch. Returns the knot tables and the
 * closure error of the interpolated rules.
 */
function solveStay({ name, H, axis, A, B0, f, legAt, kneeAt: kneeRef, alongK: alongIn = null, knots = 33 }) {
  // plane basis ⟂ axis; link lengths are in-plane (each link keeps its offset along the axis)
  const e1 = perp(axis, sub(B0, A));
  const e2 = cross(axis, e1);
  const to2 = (p) => [dot(sub(p, A), e1), dot(sub(p, A), e2)];
  const from2 = (q, along) => add(A, add(add(mul(e1, q[0]), mul(e2, q[1])), mul(axis, along)));
  const b0 = to2(B0);
  const D0 = Math.hypot(b0[0], b0[1]);
  const L1 = f * D0;
  const L2 = D0 - L1;
  const alongK = alongIn ?? dot(sub(B0, A), axis) / 2;
  const K0 = from2([b0[0] * f, b0[1] * f], alongK);
  const kneeIn = (B, fold) => {
    const b = to2(B);
    const d = Math.hypot(b[0], b[1]);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const ex = [b[0] / d, b[1] / d];
    return [a * ex[0] - fold * h * ex[1], a * ex[1] + fold * h * ex[0]];
  };
  // the fold branch: the one whose stowed knee is nearer the reference
  const Bs = rot(B0, H, axis, legAt(0));
  const ref = to2(kneeRef);
  const dist2 = (q) => Math.hypot(q[0] - ref[0], q[1] - ref[1]);
  const fold = dist2(kneeIn(Bs, 1)) <= dist2(kneeIn(Bs, -1)) ? 1 : -1;
  const kneeAt = (B) => kneeIn(B, fold);
  const state = (g) => {
    const th = legAt(g);
    const B = rot(B0, H, axis, th);
    const k2 = kneeAt(B);
    const K = from2(k2, alongK);
    const up = angleAbout(axis, sub(K0, A), sub(K, A));
    const lo = angleAbout(axis, sub(B0, K0), sub(B, K)) - up;
    return { th, B, K, up, lo };
  };
  const gs = Array.from({ length: knots }, (_, i) => i / (knots - 1));
  const table = gs.map((g) => ({ g, ...state(g) }));
  const tUp = table.map((r) => [r.g, r.up]);
  const tLo = table.map((r) => [r.g, r.lo]);
  // closure: interpolate the rules exactly as follow does and rebuild the lower link's end
  let worst = 0;
  for (let i = 0; i <= 2000; i++) {
    const g = i / 2000;
    const up = Fm.tableAt(tUp, g);
    const lo = Fm.tableAt(tLo, g);
    const Kp = rot(K0, A, axis, up);
    const Bp = rot(rot(B0, K0, axis, lo), A, axis, up);
    void Kp;
    const B = rot(B0, H, axis, legAt(g));
    worst = Math.max(worst, len(sub(Bp, B)));
  }
  const ups = tUp.map((r) => r[1]);
  const los = tLo.map((r) => r[1]);
  const pad = 0.5;
  return { name, A, B0, K0, L1, L2, axis, tUp, tLo, closure: worst / 10, rangeUp: [Math.min(...ups) - pad, Math.max(...ups) + pad], rangeLo: [Math.min(...los) - pad, Math.max(...los) + pad], state };
}

// ---------------------------------------------------------------------------------------------
// NLG (DESIGN §5.6): hinge (5.45, 0, 3.45) [E] (DESIGN 3.55, see below), forward retraction, stow θN [E] solved against W.BAYS.nlg
// ---------------------------------------------------------------------------------------------
const NLG = (() => {
  // [E] z 3.45 (DESIGN 3.55): the tyres pass x 1.959 when the leg is level, GAP behind the radome (x 1.90); at 3.55
  // they reached 1.861 (tmp/m5-pairs.mjs)
  const H = [5.45, 0, 3.45];
  const axis = [0, -1, 0]; // kit: + swings the wheels forward and up
  const theta = 93.5; // [E] solved: 0.035 m clear of W.BAYS.nlg (tmp/m5-solve.mjs)
  const axle = [G.nose.axle[0], 0, RN];
  const collarTop = 1.52;
  const C = [axle[0], 0, collarTop];
  const legDir = unit(sub(C, H)); // model, down the upper leg
  const fwd = unit([legDir[2], 0, -legDir[0]]); // model, ⟂ the leg in the x-z plane, pointing forward (−x)
  const fixFwd = fwd[0] > 0 ? mul(fwd, -1) : fwd;
  const legAt = (g) => theta * (1 - smooth01(g));
  const lugS = 0.4;
  const lugOff = 0.24;
  const B0m = add(add(H, mul(sub(C, H), lugS)), mul(fixFwd, lugOff));
  const stay = solveStay({ name: "nlg.stay", H: K(H), axis, A: K([3.9, 0, 4.75]), B0: K(B0m), f: 0.6, legAt, kneeAt: K([5.26, 0, 4.74]) });
  return { H, axis, theta, axle, C, legDir, fwd: fixFwd, legAt, B0m, stay, wheelY: 0.525 };
})();

/** The WLG stow angle that keeps the four tyres deepest inside the bay (axles near vertical), 0.25° steps. */
function solveStow(H, axis, centre, u, ext, bay) {
  const half = bay.halfSpaces.map((h) => ({ n: [-h.n[0], h.n[1], h.n[2]], d: 10 * (h.d - 41.3 * h.n[0]) }));
  let best = null;
  for (let th = 60; th <= 90; th += 0.25) {
    let worst = -Infinity;
    for (const x of G.wing.axleX)
      for (const sd of [-1, 1]) {
        const c = rot(K(add([x, centre[1] + sd * 0.675, RM], mul(u, ext))), K(H), axis, th);
        const a = rotDir([0, 1, 0], axis, th);
        for (const hs of half) worst = Math.max(worst, dot(hs.n, c) + m(0.265) * Math.abs(dot(hs.n, a)) + m(RM) * Math.sqrt(Math.max(0, 1 - dot(hs.n, a) ** 2)) - hs.d);
      }
    if (!best || worst < best.worst) best = { th, worst };
  }
  return best.th;
}

// ---------------------------------------------------------------------------------------------
// WLG (per side): pintle in the wing well, axis along x, inboard swing θW [E]; the side stay to the well
// ---------------------------------------------------------------------------------------------
/** The WLG side stay's x slabs (model m): the bracket on box.1f's aft face, the two links and the lug's pin. */
const STAY_X = { fit: [32.55, 32.58], up: [32.58, 32.635], lo: [32.635, 32.69], pin: [32.695, 32.75] };
/** The side stay's airframe pin (|y|, z), in the well. */
const STAY_PIN = [5.55, 3.85];
const WLG = Object.fromEntries(
  SIDES.map(([s, side]) => {
    const H = [32.99, side * 6.46, 3.55]; // [E] solved (tmp/m5-wlg2.mjs): 0.032 m clear of W.BAYS.wlg stowed
    const axis = [-side, 0, 0]; // kit: + swings the leg inboard
    const centre = [G.wing.centre[0], side * G.wing.centre[1], RM];
    const P = [centre[0], centre[1], RM + 0.45]; // bogie pivot, 0.45 above the axle line
    const u = unit(sub(P, H)); // model, down the leg
    const flight = 0.6; // oleo extension in flight; the stroke (travel, below) is 0.8 for the ground rotation
    const theta = solveStow(H, axis, centre, u, flight, W.BAYS.wlg(side));
    const legAt = (g) => theta * (1 - smooth01(g));
    const inb = unit([0, -side * Math.abs(u[2]), side * Math.abs(u[1]) * Math.sign(u[1] * side) * -1]);
    // lug on the leg's inboard face at s 0.6 of the leg, 0.27 m off its axis (⟂ the leg in the y-z plane)
    const uyz = unit([0, u[1], u[2]]);
    let inward = [0, -uyz[2], uyz[1]];
    if (inward[1] * side > 0) inward = mul(inward, -1);
    const B0p = add(add(H, mul(sub(P, H), 0.42)), mul(inward, 0.27));
    // the side stay's airframe pin is in the wing well (x 32.55 → the TE face), on a bracket flush on box.1f's aft face
    // (x 32.55). The links run in slabs ahead of the leg (the tube's forward face is at x 32.776 + 0.236 s): bracket,
    // stay.up, stay.lo and the lug's pin (STAY_X), the lug reaching aft to the tube's forward face. Gear down, every
    // part of the stay above the wing bottom is ahead of the TE face, clear of the inner flap; stowed, the knee folds up
    // into the well (|y| 6.17, under the ceiling) and only the lower link's end and the lug lie in the root recess (R1)
    // (tmp/m5-stay5.mjs scans the pin, the lug station and the link split)
    const B0m = [(STAY_X.pin[0] + STAY_X.pin[1]) / 2, B0p[1], B0p[2]];
    const Am = [(STAY_X.up[0] + STAY_X.up[1]) / 2, side * STAY_PIN[0], STAY_PIN[1]];
    const stay = solveStay({ name: `wlg.${s}.stay`, H: K(H), axis, A: K(Am), B0: K(B0m), f: 0.45, legAt, kneeAt: K([32.66, side * 6.17, 3.76]) });
    void inb;
    // ground rotation: the bogie tilts to a 6° stop (more lifts the front tyres into the fairing door strips that hang
    // over them), then the oleo extends: 0.8 m of stroke keeps the aft axle on the runway to 11.3° [E]
    return [s, { s, side, H, axis, theta, centre, P, u, legAt, B0m, Am, stay, travel: 0.8, tiltStop: 6, flight, axles: G.wing.axleX, wheelY: 0.675 }];
  }),
);

// ---------------------------------------------------------------------------------------------
// BLG (per side): trunnion high on a pillar under fus.B5, aft retraction θB [E], retraction shortening [E]
// ---------------------------------------------------------------------------------------------
const BLG = Object.fromEntries(
  SIDES.map(([s, side]) => {
    const yc = side * G.body.centre[1];
    const H = [36.16, yc, 4.18]; // [E] solved (tmp/m5-blg2.mjs)
    const axis = [0, 1, 0]; // kit: + swings the leg aft
    const theta = 59.1;
    const P = [G.body.centre[0], yc, RM + 0.45];
    const u = unit(sub(P, H));
    const legAt = (g) => theta * (1 - smooth01(g));
    const aft = unit([-u[2], 0, u[0]]).map((v, i) => (i === 0 ? Math.abs(v) : v)); // ⟂ the leg, aft (+x model)
    const aftDir = unit([Math.abs(u[2]), 0, u[0] * Math.sign(u[2]) * -1]);
    void aft;
    const B0m = add(add(H, mul(sub(P, H), 0.4)), mul(aftDir, 0.3));
    const Am = [38.2, yc, 4.25];
    const stay = solveStay({ name: `blg.${s}.stay`, H: K(H), axis, A: K(Am), B0: K(B0m), f: 0.3, legAt, kneeAt: K([38.77, yc, 4.17]) });
    // retraction shortening [E]: none while the leg swings the bogie aft under the link cheek, then the piston slides
    // up so the pivot rises on the vertical x 38.43 (the bay is 0.18 m longer than the bogie): tmp/m5-blgpath.mjs
    const travel = 0.35;
    const L = len(sub(P, H));
    const rake = Math.atan2(P[0] - H[0], H[2] - P[2]);
    const shortTable = Array.from({ length: 41 }, (_, i) => {
      const g = i / 40;
      const a = rake + legAt(g) * D2R;
      return [g, Math.max(0, L + travel - (38.43 - H[0]) / Math.sin(a))];
    });
    const short = Math.max(...shortTable.map((r) => r[1]));
    return [s, { s, side, yc, H, axis, theta, P, u, legAt, B0m, Am, stay, short, shortTable, travel, axles: G.body.axleX, wheelY: [0.765, 0.775, 0.765] }];
  }),
);

// ---------------------------------------------------------------------------------------------
// ground rotation: keep the tyres on the runway (DESIGN §3.3)
// ---------------------------------------------------------------------------------------------
/** Pose a kit rest point under pitch θ (about the rear BLG axle line, no lift). */
const pitched = (p, th) => rot(p, W.PITCH.point, W.PITCH.axis, th);
const ROT_KNOTS = Array.from({ length: 26 }, (_, i) => i * 0.5); // 0 … 12.5 at 0.5°
/** BLG: the bogie counter-rotates (level) and the oleo extends by Δ(θ) along the leg so all six tyres stay tangent. */
function blgOleoTable(b) {
  const P = K(b.P);
  const uk = KD(b.u);
  return ROT_KNOTS.map((th) => {
    const z0 = pitched(P, th)[2];
    const z1 = pitched(add(P, mul(uk, 1)), th)[2];
    const e = (P[2] - z0) / (z1 - z0); // kit units of extension that put the pivot back at its rest height
    return [th, Math.max(0, e)];
  });
}
/** WLG: the bogie tilts (aft axle down) to its stop, then the oleo extends; the aft axle stays on the runway. */
function wlgTables(w) {
  const P = K(w.P);
  const uk = KD(w.u);
  const aftAxle = K([w.axles[1], w.centre[1], RM]);
  const bAxis = [0, -1, 0]; // kit: + aft axle down
  const STOP = w.tiltStop;
  const zAft = (th, beta, e) => pitched(rot(add(aftAxle, mul(uk, e)), add(P, mul(uk, e)), bAxis, beta), th)[2];
  const tilt = [];
  const ext = [];
  for (const th of ROT_KNOTS) {
    // phase 1: tilt only
    let lo = 0;
    let hi = STOP;
    let beta = 0;
    let e = 0;
    if (zAft(th, STOP, 0) <= aftAxle[2]) {
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (zAft(th, mid, 0) > aftAxle[2]) lo = mid;
        else hi = mid;
      }
      beta = (lo + hi) / 2;
    } else {
      beta = STOP;
      // phase 2: extend
      let a = 0;
      let c = m(1.5);
      for (let i = 0; i < 60; i++) {
        const mid = (a + c) / 2;
        if (zAft(th, STOP, mid) > aftAxle[2]) a = mid;
        else c = mid;
      }
      e = (a + c) / 2;
    }
    tilt.push([th, beta]);
    ext.push([th, Math.min(m(w.travel), e)]);
  }
  return { tilt, ext };
}
for (const b of Object.values(BLG)) b.oleoTable = blgOleoTable(b);
for (const w of Object.values(WLG)) Object.assign(w, wlgTables(w));

// ---------------------------------------------------------------------------------------------
// doors (DESIGN §5.6): plates GAP outside the skin they reproduce, hinged on fixed edges W.GAP away
// ---------------------------------------------------------------------------------------------
/** z of the nose's lower surface at station x and |y| (starboard half of the ring). */
function noseBottomZ(x, a) {
  const r = W.ring2(x).slice(0, 8); // keel → belly line, starboard
  if (a <= r[0][0]) return r[0][1];
  for (let i = 1; i < r.length; i++) if (a <= r[i][0]) return r[i - 1][1] + ((r[i][1] - r[i - 1][1]) * (a - r[i - 1][0])) / (r[i][0] - r[i - 1][0]);
  return r[r.length - 1][1];
}
/** The fairing bottom z at x (model). */
const fairBottom = (x) => Math.min(...W.FAIRING.half(x).map((p) => p[1]));
/** A straight hinge line along x through two stations, lowered so it stays `gap` below f(x) everywhere between. */
function lowLine(f, x0, x1, gap) {
  const z0 = f(x0);
  const z1 = f(x1);
  let worst = -Infinity;
  for (let i = 0; i <= 60; i++) {
    const x = x0 + ((x1 - x0) * i) / 60;
    worst = Math.max(worst, z0 + ((z1 - z0) * (x - x0)) / (x1 - x0) - f(x));
  }
  const drop = Math.max(0, worst) + gap;
  return (x) => z0 + ((z1 - z0) * (x - x0)) / (x1 - x0) - drop;
}
/** The straight line y = a + b x over [x0, x1] on one side of f (above: ≥ f everywhere), touching it: the tangent of
 *  the curve's hull on that side (50 samples). */
function outerLine(f, x0, x1, above) {
  const xs = Array.from({ length: 50 }, (_, i) => x0 + ((x1 - x0) * i) / 49);
  let best = null;
  for (let i = 0; i < xs.length; i++)
    for (let j = i + 1; j < xs.length; j++) {
      const b = (f(xs[j]) - f(xs[i])) / (xs[j] - xs[i]);
      const a = f(xs[i]) - b * xs[i];
      if (!xs.every((x) => (above ? a + b * x >= f(x) - 1e-9 : a + b * x <= f(x) + 1e-9))) continue;
      const gap = xs.reduce((s, x) => s + Math.abs(a + b * x - f(x)), 0);
      if (!best || gap < best.gap) best = { a, b, gap };
    }
  return (x) => best.a + best.b * x;
}
/** Hinge axis (kit) through two model points with + opening: the free point moves away from `away` (kit). */
function hingeOf(p0, p1, free, away) {
  const P0 = K(p0);
  let a = unit(sub(K(p1), P0));
  const q = rot(K(free), P0, a, 10);
  if (dot(sub(q, K(free)), away) < 0) a = mul(a, -1);
  return { point: P0, axis: a };
}
/**
 * The WLG bay's fairing chain (starboard |y|, z) from the main door's hinge on the bottom round to the belly line,
 * with plate offsets: `meet(i, d)` is vertex i of the chain offset d outward (mitred; the end vertices offset along
 * their own facet), and `cut(i, j, d, shift)` is the point on facet j's offset line (distance d) where it meets the
 * mitre line at vertex i shifted by `shift` along the mitre's normal (toward vertex i + 1): two plates on different
 * groups that meet at vertex i use shifts −GAP/2 and +GAP/2. The section is constant over the cheek gap (29.7–35.0;
 * 35.3 differs by ≤ 0.008 m).
 */
export const WCHAIN = (() => {
  const h = W.FAIRING.half(33);
  const HINGE_Y = 1.69 + 0.0085; // 0.0085 m outboard of skin.keel (|y| ≤ 1.69)
  const chain = [[HINGE_Y, h[5][1]], h[5], h[4], h[3], h[2], h[1], [h[0][0], h[0][1]]]; // bottom → belly line
  const tan = (j) => {
    const t = [chain[j + 1][0] - chain[j][0], chain[j + 1][1] - chain[j][1]];
    const l = Math.hypot(t[0], t[1]);
    return [t[0] / l, t[1] / l];
  };
  const nOf = (j) => {
    const a = chain[j];
    const b = chain[j + 1];
    const t = tan(j);
    let n = [t[1], -t[0]];
    // outward: away from the section's centre (0, 3.0)
    if (n[0] * ((a[0] + b[0]) / 2) + n[1] * ((a[1] + b[1]) / 2 - 3.0) < 0) n = [-n[0], -n[1]];
    return n;
  };
  const meet = (i, d) => {
    if (i === 0 || i === chain.length - 1) {
      const n = nOf(i === 0 ? 0 : i - 1);
      return [chain[i][0] + n[0] * d, chain[i][1] + n[1] * d];
    }
    const nA = nOf(i - 1);
    const nB = nOf(i);
    const tA = tan(i - 1);
    const tB = tan(i);
    const pA = [chain[i][0] + nA[0] * d, chain[i][1] + nA[1] * d];
    const pB = [chain[i][0] + nB[0] * d, chain[i][1] + nB[1] * d];
    const det = tA[0] * -tB[1] - tA[1] * -tB[0];
    const r = [pB[0] - pA[0], pB[1] - pA[1]];
    const u = (r[0] * -tB[1] - r[1] * -tB[0]) / det;
    return [pA[0] + tA[0] * u, pA[1] + tA[1] * u];
  };
  const cut = (i, j, d, shift) => {
    const M0 = meet(i, 0.02);
    const M1 = meet(i, -0.035);
    const md = [M1[0] - M0[0], M1[1] - M0[1]];
    const ml = Math.hypot(md[0], md[1]);
    let m = [md[1] / ml, -md[0] / ml];
    const toNext = [chain[Math.min(i + 1, chain.length - 1)][0] - chain[i][0], chain[Math.min(i + 1, chain.length - 1)][1] - chain[i][1]];
    if (m[0] * toNext[0] + m[1] * toNext[1] < 0) m = [-m[0], -m[1]];
    const n = nOf(j);
    const T = tan(j);
    const p = [chain[j][0] + n[0] * d, chain[j][1] + n[1] * d];
    const t = (shift - (m[0] * (p[0] - M0[0]) + m[1] * (p[1] - M0[1]))) / (m[0] * T[0] + m[1] * T[1]);
    return [p[0] + T[0] * t, p[1] + T[1] * t];
  };
  return { chain, meet, cut, HINGE_Y, OUT: 0.02, IN: 0.035 };
})();
const T_DOOR = 0.05; // door plate thickness (m)
// fu/f3-gear: the BLG inner door's fold line (|y|, m), the fold leaf's angle at the door's full 94° and its thickness [E]:
// with the leaf 0.46 m wide on a 0.5 m main leaf, the pair's swing passes the extended in-flight tyres 0.13 m clear (the
// unfolded 0.96 m door cut 0.25 m into tyre 2.i, so the leg used to hold it open); open, the leaf lies 2° off the main
// leaf's inner face (then facing outboard), 0.05 m inboard of the inner tyres' faces as the gear moves past
// (a380/tmp/g-fold2.mjs; --check prints both). The leaf is 0.03 m thick, flush with the main leaf's inner face (a 0.05 m
// leaf stood 0.02 m nearer the passing tyres; the step is on the door's outer face, under the belly)
const BLG_IN_FOLD = 1.9385;
const BLG_IN_FOLD_OPEN = 178;
const T_FOLD = 0.03;
const FOLD_HAIR = 0.004; // the fold line this far over the main leaf's inner face: folded, the leaves' ends stay apart
// fu/f3-gear end
// [E] the outer door's bottom leaf ends at |y| 3.20 (the AC's runs in to the leg): its free edge then passes the extended
// in-flight tyres (oleo at the flight stroke) 0.08 m clear as the door closes after extension; at 2.95 it cut 0.11 m
// into the centre axle's outer tyre (a380/tmp/g-swing2.mjs; --check measures it every build)
const BLG_OUT_FREE = 3.2;
const WLG_TUBE_BOTTOM = 2.36; // the WLG oleo barrel ends 0.03 m over the bogie knuckle (s along the leg, m); stowed in flight it fills the fairing door strips' hole (the strips cross its square at s 2.17–2.36)
const DOORS = (() => {
  const list = [];
  // ---- NLG: forward doors (hydraulic, 75° [E]: held open at the AC's 62° the door cuts 0.13 m into the nose tyre
  //      mid-transit; it clears from about 71°, --check prints nlgDoorSwing) and aft doors (leg-linked, 69.2°, open
  //      with the gear down)
  for (const [k, sd] of [["l", -1], ["r", 1]]) {
    for (const [kind, x0, x1, open, linked] of [["f", 2.45, 4.4, 75, false], ["a", 4.42, 5.45, 69.2, true]]) {
      const edge = (x) => noseBottomZ(x, 1.0);
      // hydraulic doors: the hinge line runs under the plate's outer strip (|y| 0.95–1.0), so no point near it is below
      // the axis: opening, the plate turns inboard, clear of the bay wall's hull (tmp/m5-nlgdoor.mjs, tmp/m5-pt.mjs)
      // leg-linked doors: 0.02 m from the bay wall and the skin at the hinge edge (closed, the audit's 32-iteration GJK
      // orders them against the wall and nose.fwd; at 0.0085 m it made a false cycle)
      const zh = linked ? (x) => edge(x) - 0.02 : lowLine((x) => Math.min(edge(x) - 0.0085, noseBottomZ(x, 0.95) - 0.022), x0, x1, 0);
      const yh = sd * (1 - (linked ? 0.02 : 0.0085));
      const xs = [x0, ...[2.98, 4.0].filter((x) => x > x0 + 0.05 && x < x1 - 0.05), x1];
      const pts = [];
      for (const x of xs) {
        for (const a of [0.006, 0.2, 0.4, 0.6, 0.8, 0.95]) {
          const z = Math.min(noseBottomZ(x, a) - 0.02, zh(x) + 0.0);
          pts.push([x, sd * a, z], [x, sd * a, z + T_DOOR]);
        }
        pts.push([x, yh, zh(x)], [x, yh, zh(x) + T_DOOR]);
      }
      const hinge = hingeOf([x0, yh, zh(x0)], [x1, yh, zh(x1)], [(x0 + x1) / 2, sd * 0.01, noseBottomZ((x0 + x1) / 2, 0.01)], [0, 0, -1]);
      list.push({ group: `nlg.door.${kind}${k}`, parent: "pitch", hinge, open, linked, plates: [{ name: `nlg.door.${kind}${k}`, pts }], label: kind === "f" ? "Nose gear forward door" : "Nose gear aft door (leg-linked)" });
    }
  }
  // ---- WLG main doors (hydraulic, 79°, DESIGN §5.6): 2 strips 0.02 m outboard of the fairing, the bottom from the
  //      hinge at |y| 1.6985 (0.0085 m off skin.keel) out to vertex 5, and the lowest facet (vertex 5 → 4), mitred;
  //      the fairing door's strips (on the oleo) take over GAP above vertex 4. Hinged on the bottom along x at the
  //      plate's outer inboard corner: opening, the plate turns down and outboard, away from the keel liner.
  for (const [k, sd] of [["l", -1], ["r", 1]]) {
    const x0 = 31.85 + GAP;
    const x1 = 34.4; // ends ahead of the BLG front tyres (x 34.45): open, it hangs beside them
    const { meet, cut, OUT, IN } = WCHAIN;
    const quadB = [meet(0, OUT), meet(1, OUT), meet(1, -IN), meet(0, -IN)];
    const quadS = [meet(1, OUT), cut(2, 1, OUT, -GAP / 2), cut(2, 1, -IN, -GAP / 2), meet(1, -IN)];
    const ext = (quad) => [x0, x1].flatMap((x) => quad.map(([y, z]) => [x, sd * y, z]));
    const [hy, hz] = meet(0, OUT);
    const hinge = hingeOf([x0, sd * hy, hz], [x1, sd * hy, hz], [33.5, sd * 3.2, hz], [0, 0, -1]);
    list.push({ group: `wlg.${k}.door`, parent: "pitch", hinge, open: 79, plates: [{ name: `wlg.${k}.door`, pts: ext(quadB) }, { name: `wlg.${k}.door.side`, pts: ext(quadS) }], label: "Wing gear main door" });
  }
  // ---- BLG doors (DESIGN §5.6, follow-up): centre (on the keel beam, 90°) and outer (on the cheek, 99°) hydraulic on
  //      gearDoors: open, the legs move, closed after transit with the gear down or up (truth §9). The inner door (on
  //      the door beam, 94°) is hydraulic on gearDoors as well; its fold leaf folds as it swings (fu/f3-gear: until
  //      then the leg held the one-piece door open, its swing crossing the level bogie's inner tyres). blgSwing and
  //      --check measure both doors' swing. The outer door's bottom leaf ends at |y| BLG_OUT_FREE, so its swing clears
  //      the extended tyres in flight; the slot between it and the inner door's edge is the leg's slot.
  const xa = 35.92 + GAP; // the doors bear on skin.fair.link here (their support); the corners move aft as they open
  const xb = 40.9 - GAP - 0.015; // the hinge lines slope: the corners move aft as the doors turn
  const fb = lowLine(fairBottom, xa, xb, 0.0085);
  for (const [k, sd] of [["l", -1], ["r", 1]]) {
    const flat = (a0, a1, xs = [xa, xb]) => {
      const pts = [];
      for (const x of xs) for (const a of [a0, a1]) pts.push([x, sd * a, fb(x)], [x, sd * a, fb(x) + T_DOOR]);
      return pts;
    };
    list.push({ group: `blg.${k}.door.ctr`, parent: "pitch", hinge: hingeOf([xa, sd * 0.0585, fb(xa)], [xb, sd * 0.0585, fb(xb)], [38, sd * 1.3, fb(38)], [0, 0, -1]), open: 90, plates: [{ name: `blg.${k}.door.ctr`, pts: flat(0.0585, 1.328) }], label: "Body gear centre door" });
    // fu/f3-gear: the inner door closes with the gear down, as on the aircraft. Its outboard part is a fold leaf
    // (the AC's inner doors carry fold-away parts that clear the extended bogie's wheels): hinged on the main leaf's
    // inner face at |y| BLG_IN_FOLD, it folds up toward the bay as the door swings (BLG_IN_FOLD_OPEN at the door's 94°,
    // in proportion), so the pair's swing passes the level bogie's inner tyres (blgSwing, --check). Folded, the leaf
    // lies 2° off the main leaf's inner face, inside its width. The leaves meet GAP apart at the fold line.
    const inHinge = hingeOf([xa, sd * 1.4385, fb(xa)], [xb, sd * 1.4385, fb(xb)], [38, sd * 2.3, fb(38)], [0, 0, -1]);
    list.push({ group: `blg.${k}.door.in`, parent: "pitch", hinge: inHinge, open: 94, plates: [{ name: `blg.${k}.door.in`, pts: flat(1.4385, BLG_IN_FOLD - GAP / 2) }], label: "Body gear inner door" });
    const foldHinge = hingeOf([xa, sd * BLG_IN_FOLD, fb(xa) + T_DOOR + FOLD_HAIR], [xb, sd * BLG_IN_FOLD, fb(xb) + T_DOOR + FOLD_HAIR], [38, sd * 2.3, fb(38)], [0, 0, 1]);
    const leaf = [];
    for (const x of [xa, xb]) for (const a of [BLG_IN_FOLD + GAP / 2, 2.4]) leaf.push([x, sd * a, fb(x) + T_DOOR - T_FOLD], [x, sd * a, fb(x) + T_DOOR]);
    list.push({ group: `blg.${k}.door.in.fold`, parent: `blg.${k}.door.in`, hinge: foldHinge, open: BLG_IN_FOLD_OPEN, fold: true, plates: [{ name: `blg.${k}.door.in.fold`, pts: leaf }], label: "Body gear inner door fold leaf" });
    // fu/f3-gear end
    // outer: the lowest fairing facet (vertex 4 → 5) and the bottom from vertex 5 in to BLG_OUT_FREE, 0.02 m outboard
    const h = (x) => W.FAIRING.half(x);
    const v4 = (x) => h(x)[4];
    const hingeLine = lowLine((x) => v4(x)[1], xa, xb, 0.012);
    // review round 3: the bent door is two leaves of the plate's thickness in the one hinge group, the facet leaf
    // (vertex 4 → the bend) and the bottom leaf (the bend → |y| 2.95), mitred at the bend as the WLG door's two strips
    // are (one hull of the three edges filled the bend into a 0.43 m deep wedge that hung like a box over the bogie)
    const pts = [];
    const bot = [];
    for (const x of [xa, 38, 40, xb]) {
      const H4 = h(x)[4];
      const H5 = h(x)[5];
      const t = unit([0, H5[0] - H4[0], H5[1] - H4[1]]);
      const n = [0, t[2], -t[1]]; // the facet's normal (toward the fairing's inside on the starboard half)
      const yh = H4[0] + 0.012 * n[1];
      const zt = hingeLine(x);
      pts.push([x, sd * yh, zt], [x, sd * (yh - T_DOOR * n[1]), zt - T_DOOR * n[2]]);
      // the mitre: the facet leaf's outer face (offset 0.02 − T) meets the bottom leaf's under face (z fb), its inner
      // face (offset 0.02) the bottom leaf's top face (z fb + T)
      const onFacet = (d, z) => {
        const s = (z - (H4[1] + n[2] * d)) / t[2];
        return [x, sd * (H4[0] + n[1] * d + t[1] * s), z];
      };
      // the bend is a straight line between the end stations (vertex 5 bows 0.06 m outboard mid-bay: a bend through
      // every station made the two leaves' hulls overlap there)
      if (x !== xa && x !== xb) continue;
      const Mo = onFacet(0.02 - T_DOOR, fb(x));
      const Mi = onFacet(0.02, fb(x) + T_DOOR);
      pts.push(Mo, Mi);
      bot.push(Mo, Mi, [x, sd * BLG_OUT_FREE, fb(x)], [x, sd * BLG_OUT_FREE, fb(x) + T_DOOR]);
    }
    // the axis: vertex 4's line bows outboard by up to 0.05 m mid-bay, so a chord through its ends runs under cheek 3
    // and the opening door's hinge edge sweeps into it. The axis is the outer tangent of the vertex line (outboard of
    // it everywhere) and 0.02 m under it; the plate's top edge stays on the vertex line (tmp/m5-outdoor.mjs).
    const axY = outerLine((x) => v4(x)[0], xa, xb, true);
    const axZ = outerLine((x) => v4(x)[1], xa, xb, false);
    list.push({ group: `blg.${k}.door.out`, parent: "pitch", hinge: hingeOf([xa, sd * axY(xa), axZ(xa) - 0.02], [xb, sd * axY(xb), axZ(xb) - 0.02], [38, sd * 3.3, fb(38)], [0, 0, -1]), open: 99, plates: [{ name: `blg.${k}.door.out`, pts }, { name: `blg.${k}.door.out.bot`, pts: bot }], label: "Body gear outer door" });
  }
  return list;
})();

/** Every solve, for checks and notes. */
export const GEO = { NLG, WLG, BLG, DOORS };

// ---------------------------------------------------------------------------------------------
// groups and rules (DESIGN §3.1, §3.3)
// ---------------------------------------------------------------------------------------------
/** Every rule M5 declares (kept for checks: the module's own follow). */
const MY_RULES = [];
export function groups(ctx) {
  const rule0 = ctx.rule;
  ctx = { ...ctx, rule: (r) => (MY_RULES.push(r), rule0(r)) };
  // the body gear's legs read gearBody (they trail the wing gear by 2 s on extension, model GEAR.timing.extend.bodyLag);
  // a state that omits it (the key states, other modules' clips) reads gear
  const BODY = { channel: "gearBody", fallback: "gear" };
  const GEAR = { channel: "gear" };
  const leg = (name, H, axis, theta, on = GEAR) => {
    ctx.group(name, { parent: "pitch", hinge: { point: K(H), axis, range: [0, theta] } });
    ctx.rule({ group: name, ...on, table: [[0, theta], [1, 0]], ease: "smooth" });
  };
  const stays = (base, st, on = GEAR) => {
    ctx.group(`${base}.stay.up`, { parent: "pitch", hinge: { point: st.A, axis: st.axis, range: st.rangeUp } });
    ctx.group(`${base}.stay.lo`, { parent: `${base}.stay.up`, hinge: { point: st.K0, axis: st.axis, range: st.rangeLo } });
    ctx.rule({ group: `${base}.stay.up`, ...on, table: st.tUp });
    ctx.rule({ group: `${base}.stay.lo`, ...on, table: st.tLo });
  };
  // doors: hydraulic on gearDoors (the BLG inner doors' fold leaves too, on their door); the leg-linked doors (NLG
  // aft) and any held door are built open (their value 0 is the gear-down state)
  for (const d of DOORS) {
    if (d.held) {
      // closed (−open) with the doors shut and the leg in the bay; gearDoors opens it, and the leg out of the bay
      // (gearBody ≥ linkAt) holds it open: the two rules add and the range clamps the sum at 0
      ctx.group(d.group, { parent: d.parent, hinge: { point: d.hinge.point, axis: d.hinge.axis, range: [-d.open, 0] } });
      ctx.rule({ group: d.group, channel: "gearDoors", table: [[0, -d.open], [1, 0]], ease: "smooth" });
      ctx.rule({ group: d.group, ...BODY, table: [[0, 0], [d.linkAt, d.open]], ease: "smooth" });
    } else if (d.linked) {
      ctx.group(d.group, { parent: d.parent, hinge: { point: d.hinge.point, axis: d.hinge.axis, range: [-d.open, 0] } });
      ctx.rule({ group: d.group, channel: "gear", table: [[0, -d.open], [d.linkAt ?? 0.35, 0]], ease: "smooth" });
    } else {
      ctx.group(d.group, { parent: d.parent, hinge: { point: d.hinge.point, axis: d.hinge.axis, range: [0, d.open] } });
      ctx.rule({ group: d.group, channel: "gearDoors", table: [[0, 0], [1, d.open]], ease: "smooth" });
    }
  }
  // nose gear
  leg("nlg.leg", NLG.H, NLG.axis, NLG.theta);
  stays("nlg", NLG.stay);
  ctx.group("nlg.steer", { parent: "nlg.leg", hinge: { point: K(NLG.axle), axis: [0, 0, 1], range: [-70, 70] } });
  ctx.rule({ group: "nlg.steer", channel: "steer" });
  // wing gear
  for (const w of Object.values(WLG)) {
    const base = `wlg.${w.s}`;
    leg(`${base}.leg`, w.H, w.axis, w.theta);
    stays(base, w.stay);
    ctx.group(`${base}.oleo`, { parent: `${base}.leg`, slide: { direction: KD(w.u), travel: m(w.travel) } });
    ctx.rule({ group: `${base}.oleo`, channel: "rot", table: w.ext });
    ctx.rule({ group: `${base}.oleo`, channel: "trim", table: [[0, 0], [1, m(w.flight)]] });
    ctx.group(`${base}.bogie`, { parent: `${base}.oleo`, hinge: { point: K(w.P), axis: [0, -1, 0], range: [-20, 20] } });
    ctx.rule({ group: `${base}.bogie`, channel: "rot", table: w.tilt });
  }
  // body gear
  for (const b of Object.values(BLG)) {
    const base = `blg.${b.s}`;
    leg(`${base}.leg`, b.H, b.axis, b.theta, BODY);
    stays(base, b.stay, BODY);
    ctx.group(`${base}.short`, { parent: `${base}.leg`, slide: { direction: KD(mul(b.u, -1)), travel: m(b.short) } });
    ctx.rule({ group: `${base}.short`, ...BODY, table: b.shortTable.map(([g, v]) => [g, m(v)]) });
    ctx.group(`${base}.oleo`, { parent: `${base}.short`, slide: { direction: KD(b.u), travel: m(b.travel) } });
    ctx.rule({ group: `${base}.oleo`, channel: "rot", table: b.oleoTable });
    ctx.rule({ group: `${base}.oleo`, channel: "trim", table: [[0, 0], [1, m(b.travel)]] });
    ctx.group(`${base}.bogie`, { parent: `${base}.oleo`, hinge: { point: K(b.P), axis: [0, 1, 0], range: [-100, 15] } });
    ctx.rule({ group: `${base}.bogie`, ...BODY, table: [[0, -b.theta], [1, 0]], ease: "smooth" });
    ctx.rule({ group: `${base}.bogie`, channel: "rot", table: [[0, 0], [12.5, 12.5]] });
    ctx.group(`${base}.steer`, { parent: `${base}.bogie`, hinge: { point: K([b.axles[2], b.yc, RM]), axis: [0, 0, 1], range: [-15, 15] } });
    ctx.rule({ group: `${base}.steer`, channel: "steer", table: [[-70, 15], [-20, 0], [20, 0], [70, -15]] });
  }
}

// ---------------------------------------------------------------------------------------------
// part builders (kit space)
// ---------------------------------------------------------------------------------------------
function makeBuilders(ctx) {
  const round = (name, group, o, a, s0, s1, r, opts = {}) => ctx.round({ name, group, F: { o, a: unit(a), u: perp(unit(a), opts.hint ?? [0, 0, 1]) }, s0, s1, r, tone: "mid", ...opts, hint: undefined });
  /** A prism along kit axis a through o, its section the 2D hull of the given kit points projected on (u, a × u). */
  const prism = (name, group, o, a, uHint, pts, s0, s1, opts = {}) => {
    const A = unit(a);
    const u = perp(A, uHint);
    const v = cross(A, u);
    const poly = hull2(pts.map((p) => [dot(sub(p, o), u), dot(sub(p, o), v)]));
    return ctx.prism({ name, group, F: { o, a: A, u, v }, polygon: poly, s0, s1, tone: "mid", ...opts });
  };
  const hull = (name, group, points, opts = {}) => ctx.hull({ name, group, points, tone: "mid", ...opts });
  const loft = (name, group, rings, opts = {}) => ctx.hull({ name, group, rings, smooth: true, sharp: 40, tone: "mid", ...opts });
  /** A link bar (stadium) in the plane ⟂ axis, from P to Q with end radii r0/r1, slab s ∈ [t0, t1] along the axis. */
  const link = (name, group, axis, P, Q, r0, r1, t0, t1, opts = {}) => {
    const n = unit(axis);
    const pts = [...circleIn(P, n, r0), ...circleIn(Q, n, r1)];
    return prism(name, group, P, n, sub(Q, P), pts, t0, t1, opts);
  };
  const circleIn = (c, n, r, k = 20) => {
    const e1 = perp(n, [0, 0, 1]);
    const e2 = cross(n, e1);
    return ring3(c, e1, e2, r, k);
  };
  return { round, prism, hull, loft, link, circleIn };
}

/** Square tube of 4 plates around an axis (the oleo barrel the piston slides in). e1, e2 unit ⟂ the axis. */
function tube(B, base, group, top, axis, e1, e2, half, wall, s0, s1, optsIn = {}) {
  const { bEnd, ...opts } = optsIn;
  const at = (a, b) => add(top, add(mul(e1, a), mul(e2, b)));
  const out = half + wall;
  const g = m(0.004); // a hairline between the plates: flush corner joints swap order while their plane is edge-on
  const box = (a0, a1, b0, b1) => [at(a0, b0), at(a1, b0), at(a1, b1), at(a0, b1)];
  // e2 plates span the full width; e1 plates fit between them
  return [
    B.prism(`${base}.f`, group, top, axis, e1, box(-out, out, half, out), s0, s1, opts),
    B.prism(`${base}.b`, group, top, axis, e1, box(-out, out, -out, -half), s0, bEnd ?? s1, opts),
    B.prism(`${base}.i`, group, top, axis, e1, box(-out, -half, -half + g, half - g), s0, s1, opts),
    B.prism(`${base}.o`, group, top, axis, e1, box(half, out, -half + g, half - g), s0, s1, opts),
  ];
}

// ---------------------------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------------------------
export function build(ctx) {
  const B = makeBuilders(ctx);
  /** A tyre (model metres): round along ±y from its inner face, tread grooves as seams, the hub plane outside. */
  const wheel = (name, group, centreM, side, inner, width, r, braked = false) => {
    const o = K([centreM[0], centreM[1] + side * inner, centreM[2]]);
    const a = [0, side, 0];
    const part = ctx.round({ name, group, F: { o, a, u: [1, 0, 0] }, s0: 0, s1: m(width), r: m(r), tone: "mid", material: "rubber", details: { seams: [0.2, 0.4, 0.6, 0.8].map((f) => m(width * f)) } });
    hubPlane(ctx, part, add(o, [0, side * m(width), 0]), side, r, braked);
    // a braked wheel's carbon brake stack, seen on its inboard face (toward the bogie beam): the housing, the stack of
    // discs, the torque bar and the brake rod's lug (AC 2-9-0: brakes on all WLG wheels and the BLG front and centre axles)
    if (braked) brakePlane(ctx, part, o, side, r);
    return part;
  };
  /** Slab range [s0, s1] along a kit axis through o for a model-x interval (the WLG stay links). */
  const slabX = (o, axis, x0, x1) => {
    const s0 = dot(sub(K([x0, 0, 0]), [o[0], 0, 0]), axis);
    const s1 = dot(sub(K([x1, 0, 0]), [o[0], 0, 0]), axis);
    return [Math.min(s0, s1), Math.max(s0, s1)];
  };
  /** A lateral (kit y) slab range through o for model y ∈ [y0, y1]. */
  const slabY = (o, y0, y1) => [m(y0) - o[1], m(y1) - o[1]].sort((a, b) => a - b);
  /** Square section points (kit) about c, axes e1, e2, half-widths h1, h2. */
  const sq = (c, e1, e2, h1, h2) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => add(c, add(mul(e1, a * h1), mul(e2, b * h2))));
  /** The same square projected along d onto the plane n·(p − p0) = off. */
  const onPlane = (pts, d, n, p0, off) => pts.map((p) => add(p, mul(d, (off - dot(n, sub(p, p0))) / dot(n, d))));

  // =================================================================== NLG
  {
    const N = NLG;
    const Hk = K(N.H);
    const legG = "nlg.leg";
    // fork plates on the bay ceiling (nose.fdfloor bottom, z 4.90), x 5.15–5.64, round lugs about the hinge
    for (const [sfx, y0, y1] of [["l", -0.31, -0.21], ["r", 0.21, 0.31]]) {
      const pts = [K([5.15, 0, 4.9]), K([5.64, 0, 4.9]), ...circle2(N.H[0], N.H[2], 0.19, 28).map(([x, z]) => K([x, 0, z]))];
      B.prism(`nlg.fork.${sfx}`, "pitch", Hk, [0, 1, 0], [1, 0, 0], pts, m(y0), m(y1), { material: "gunmetal", details: { dots: [{ at: [m(y0 < 0 ? y0 : y1), 0, 0], normal: [0, Math.sign(y0), 0], size: 0.7 }] } });
    }
    B.round("nlg.knuckle", legG, add(Hk, [0, -m(0.21), 0]), [0, 1, 0], 0, m(0.42), m(0.17), { material: "chrome", tone: "hi" });
    // upper leg: hull of the ring tangent to the knuckle and the horizontal ring on the collar
    const dK = KD(N.legDir);
    const cA = add(Hk, mul(dK, m(0.17)));
    const frontA = perp(dK, [1, 0, 0]);
    const ringA = ring3(cA, [0, 1, 0], frontA, m(0.15), 28);
    const ringB = ring3(K(N.C), [1, 0, 0], [0, 1, 0], m(0.165), 28);
    const upper = B.loft("nlg.leg.upper", legG, [ringA, ringB], { material: "steel", tone: "hi" });
    B.round("nlg.collar", legG, K([N.C[0], 0, 1.38]), [0, 0, 1], 0, m(0.14), m(0.2), { material: "gunmetal", details: { bolts: [{ s: m(0.14), r: m(0.18), count: 10, size: 0.45 }], seams: [m(0.07)] } });
    // the leg's front generator and its tangent plane (lamp bar, stay lug)
    const Af = add(cA, mul(frontA, m(0.15)));
    const Bf = add(K(N.C), [m(0.165), 0, 0]);
    const gdir = unit(sub(Bf, Af));
    let nt = unit(cross(gdir, [0, 1, 0]));
    if (nt[0] < 0) nt = mul(nt, -1);
    const atZ = (zm) => add(Af, mul(sub(Bf, Af), (m(zm) - Af[2]) / (Bf[2] - Af[2])));
    // lamp bar (does not steer): taxi, three take-off and two turn-off lenses
    const g0 = atZ(1.6);
    const g1 = atZ(2.3);
    const bar = [];
    for (const p of [g0, g1]) for (const y of [-0.3, 0.3]) for (const d of [0, 0.1]) bar.push(add(add(p, [0, m(y), 0]), mul(nt, m(d))));
    const lamps = B.hull("nlg.lamps", legG, bar, { material: "gunmetal", tone: "mid" });
    nlgLamps(ctx, lamps, g0, g1, nt);
    accentLine(ctx, upper, Af, Bf, nt);
    // stay: fitting on the ceiling at A, two links side by side, the lug on the leg's front
    const st = N.stay;
    B.prism("nlg.stay.fit", "pitch", st.A, [0, 1, 0], [1, 0, 0], [K([3.76, 0, 4.9]), K([4.04, 0, 4.9]), ...B.circleIn(st.A, [0, 1, 0], m(0.085))], -m(0.07), 0, { material: "gunmetal" });
    const up = B.link("nlg.stay.up", "nlg.stay.up", [0, 1, 0], st.A, st.K0, m(0.075), m(0.065), 0, m(0.07), { material: "steel", tone: "hi" });
    const lo = B.link("nlg.stay.lo", "nlg.stay.lo", [0, 1, 0], st.K0, st.B0, m(0.065), m(0.07), -m(0.07), 0, { material: "steel", tone: "hi" });
    accentLine(ctx, up, ...linkEnds(st.A, st.K0, m(0.075), m(0.065)), [0, 1, 0], m(0.07));
    accentLine(ctx, lo, ...linkEnds(st.K0, st.B0, m(0.065), m(0.07)), [0, -1, 0], -m(0.07));
    const tB = (st.B0[2] - Af[2]) / (Bf[2] - Af[2]);
    const lugBase = [-0.14, 0.14].map((d) => add(Af, mul(sub(Bf, Af), tB + m(d) / len(sub(Bf, Af)))));
    B.prism("nlg.stay.lug", legG, st.B0, [0, 1, 0], [1, 0, 0], [...lugBase, ...B.circleIn(st.B0, [0, 1, 0], m(0.075))], 0, m(0.07), { material: "gunmetal" });
    // steering: collar knuckle, the vertical lower leg, torque link, axle and wheels
    const sg = "nlg.steer";
    B.round("nlg.steer.collar", sg, K([N.axle[0], 0, 1.3]), [0, 0, 1], 0, m(0.08), m(0.18), { material: "chrome", tone: "hi" });
    B.round("nlg.piston", sg, K([N.axle[0], 0, RN + 0.1]), [0, 0, 1], 0, m(1.3 - RN - 0.1), m(0.105), { material: "chrome", tone: "hi" });
    B.round("nlg.axle", sg, K([N.axle[0], -0.2975, RN]), [0, 1, 0], 0, m(0.595), m(0.1), { material: "steel" });
    B.link("nlg.torque.up", sg, [0, 1, 0], K([4.81, 0, 1.27]), K([4.7, 0, 1.03]), m(0.03), m(0.035), 0, m(0.035), { material: "steel" });
    B.link("nlg.torque.lo", sg, [0, 1, 0], K([4.7, 0, 1.03]), K([4.835, 0, 0.84]), m(0.035), m(0.03), -m(0.035), 0, { material: "steel" });
    wheel("nlg.tyre.l", sg, N.axle, -1, 0.2975, TYRE.nose.w, RN);
    wheel("nlg.tyre.r", sg, N.axle, 1, 0.2975, TYRE.nose.w, RN);
  }

  // =================================================================== WLG
  const ceiling = wellCeiling();
  for (const w of Object.values(WLG)) {
    const s = w.s;
    const sd = w.side;
    const base = `wlg.${s}`;
    const legG = `${base}.leg`;
    const Hk = K(w.H);
    const yH = w.H[1];
    const uk = KD(w.u);
    const ex = [1, 0, 0];
    // fitting on the well ceiling, ahead of the knuckle (x 32.55 + gap … 32.72), lug round the pintle
    const fitPts = [];
    for (const x of [32.565, 32.845]) {
      for (const y of [yH - 0.16, yH + 0.16]) fitPts.push(K([x, y, ceiling(x, Math.abs(y))]));
      for (const [y, z] of circle2(yH, w.H[2], 0.2, 24)) fitPts.push(K([x, y, z]));
    }
    B.hull(`${base}.fit`, "pitch", fitPts, { material: "gunmetal" });
    // knuckle along x (x 32.72–33.04), the main fitting tangent to it, the tube and the piston
    // knuckle x 32.845–33.035, r 0.17: its top stands above the wing bottom, so it stays ahead of the TE face (33.05 at y 6.29)
    B.round(`${base}.knuckle`, legG, K([33.035, yH, w.H[2]]), ex, 0, m(0.19), m(0.17), { material: "chrome", tone: "hi" });
    const ea = perp(uk, ex);
    const eb = cross(uk, ea);
    const nt = unit(sub(uk, mul(ex, dot(uk, ex))));
    const top = onPlane(sq(Hk, ea, eb, m(0.12), m(0.16)), uk, nt, Hk, m(0.17));
    // the tube reaches down to just above the bogie knuckle: on the ground the oleo is closed and only the tube
    // shows; in flight 0.6 m of chrome slides out (0.8 m at the end of the ground rotation). The fairing strips (on the oleo) are cut round the tube.
    const sTube = 0.75;
    const sBot = WLG_TUBE_BOTTOM;
    const c1 = add(Hk, mul(uk, m(sTube)));
    const main = B.hull(`${base}.leg.upper`, legG, [...top, ...sq(c1, ea, eb, m(0.22), m(0.22))], { material: "steel", tone: "hi" });
    const tw = tube(B, `${base}.tube`, legG, c1, uk, eb, ea, m(0.18), m(0.04), 0, m(sBot - sTube), { material: "steel", tone: "hi" });
    void main;
    // the accent runs the forward plate's outer face, end to end
    accentLine(ctx, tw[0], add(c1, mul(ea, m(0.22))), add(add(c1, mul(ea, m(0.22))), mul(uk, m(sBot - sTube))), ea, 0);
    // piston (oleo): top circle inside the tube, bottom tangent to the bogie knuckle (plane containing y)
    const Pk = K(w.P);
    const nb = unit(sub(uk, mul([0, 1, 0], uk[1])));
    const pTop = ring3(add(Hk, mul(uk, m(sTube + 0.03))), ea, eb, m(0.14), 28);
    const pBot = onPlane(ring3(Pk, ea, eb, m(0.14), 28), uk, nb, Pk, -m(0.12));
    const pistonW = B.loft(`${base}.piston`, `${base}.oleo`, [pTop, pBot], { material: "chrome", tone: "hi" });
    torqueLinks(ctx, pistonW, add(Hk, mul(uk, m(sTube + 0.03))), Pk, uk, ea, m(0.14));
    // bogie: knuckle on the beam, beam on the two axles, four wheels
    const bg = `${base}.bogie`;
    const yc = w.centre[1];
    B.round(`${base}.bogie.knuckle`, bg, K([w.P[0], yc - 0.16, w.P[2]]), [0, 1, 0], 0, m(0.32), m(0.12), { material: "chrome", tone: "hi" });
    const beam = [];
    for (const x of [32.6, 34.55]) for (const y of [yc - 0.16, yc + 0.16]) for (const z of [RM + 0.09, w.P[2] - 0.12]) beam.push(K([x, y, z]));
    B.hull(`${base}.beam`, bg, beam, { material: "gunmetal" });
    w.axles.forEach((x, i) => {
      B.round(`${base}.axle.${i + 1}`, bg, K([x, yc - 0.41, RM]), [0, 1, 0], 0, m(0.82), m(0.09), { material: "steel" });
      for (const [k, ss] of [["i", -sd], ["o", sd]]) wheel(`${base}.tyre.${i + 1}.${k}`, bg, [x, yc, RM], ss, 0.41, TYRE.main.w, RM, true);
    });
    // side stay: a bracket flush on box.1f's aft face (x 32.55) round the airframe pin, two links, the lug on the
    // tube's forward face (slabs STAY_X)
    const st = w.stay;
    const Am = w.Am;
    const gb = [];
    const ring = [...circle2(Am[1], Am[2], 0.085, 20), [Am[1] - sd * 0.1, Am[2] + 0.3], [Am[1] + sd * 0.1, Am[2] + 0.3]];
    for (const [y, z] of ring) gb.push(K([STAY_X.fit[0], y, z]), K([STAY_X.fit[1], y, z]));
    B.hull(`${base}.stay.fit`, "pitch", gb, { material: "gunmetal", details: { dots: [-0.04, 0.04].map((dy) => ({ at: K([STAY_X.fit[1], Am[1] + sd * dy, Am[2] + 0.2]), normal: [-1, 0, 0], size: 0.5 })) } });
    const [u0, u1] = slabX(st.A, st.axis, ...STAY_X.up);
    const [l0, l1] = slabX(st.K0, st.axis, ...STAY_X.lo);
    const up = B.link(`${base}.stay.up`, `${base}.stay.up`, st.axis, st.A, st.K0, m(0.075), m(0.065), u0, u1, { material: "steel", tone: "hi" });
    const lo = B.link(`${base}.stay.lo`, `${base}.stay.lo`, st.axis, st.K0, st.B0, m(0.065), m(0.05), l0, l1, { material: "steel", tone: "hi" });
    accentLine(ctx, up, ...linkEnds(st.A, st.K0, m(0.075), m(0.065)), mul(st.axis, -1), -u0);
    accentLine(ctx, lo, ...linkEnds(st.K0, st.B0, m(0.065), m(0.05)), mul(st.axis, -1), -l0);
    // lug: a hull from the pin's end discs (slab STAY_X.pin, ahead of the leg) to a quad on the tube's forward face,
    // on its inboard half, s ±0.1 about the pin
    {
      const sAlong = dot(sub(st.B0, Hk), uk);
      const fwd = [ea, mul(ea, -1)].reduce((best, n) => (n[0] > best[0] ? n : best)); // kit +x: model forward
      const inboard = [0, -sd, 0];
      const inb = [eb, mul(eb, -1)].reduce((best, n) => (dot(n, inboard) > dot(best, inboard) ? n : best));
      const lugPts = [];
      for (const x of STAY_X.pin) lugPts.push(...B.circleIn([K([x, 0, 0])[0], st.B0[1], st.B0[2]], ex, m(0.045)));
      for (const da of [-0.1, 0.1]) for (const db of [0.1, 0.21]) lugPts.push(add(add(add(Hk, mul(uk, sAlong + m(da))), mul(fwd, m(0.22))), mul(inb, m(db))));
      B.hull(`${base}.stay.lug`, legG, lugPts, { material: "gunmetal" });
    }
  }

  // =================================================================== BLG
  for (const b of Object.values(BLG)) {
    const s = b.s;
    const base = `blg.${s}`;
    const legG = `${base}.leg`;
    const yc = b.yc;
    const Hk = K(b.H);
    const uk = KD(b.u);
    const ey = [0, 1, 0];
    // fork pillars from fus.B5's bottom face (z 4.40), round lugs about the trunnion
    for (const [k, y0, y1] of [["i", -0.3, -0.2], ["o", 0.2, 0.3]]) {
      const pts = [K([36.0, yc, 4.4]), K([36.36, yc, 4.4]), ...circle2(b.H[0], b.H[2], 0.21, 28).map(([x, z]) => K([x, yc, z]))];
      const [a0, a1] = slabY(Hk, yc + (b.side > 0 ? y0 : -y1), yc + (b.side > 0 ? y1 : -y0));
      B.prism(`${base}.pillar.${k}`, "pitch", Hk, ey, [1, 0, 0], pts, a0, a1, { material: "gunmetal" });
    }
    B.round(`${base}.knuckle`, legG, K([b.H[0], yc - 0.2, b.H[2]]), ey, 0, m(0.4), m(0.2), { material: "chrome", tone: "hi" });
    const aftK = perp(uk, [-1, 0, 0]); // ⟂ the leg, aft (kit −x)
    const top = onPlane(sq(Hk, aftK, ey, m(0.16), m(0.17)), uk, uk, Hk, m(0.2));
    const sTube = 0.75;
    const sBot = 2.25;
    const c1 = add(Hk, mul(uk, m(sTube)));
    const main = B.hull(`${base}.leg.upper`, legG, [...top, ...sq(c1, aftK, ey, m(0.22), m(0.22))], { material: "steel", tone: "hi" });
    // the forward plate ends at s 2.05: stowed, the bogie beam's top edge passes 0.025 m under its end
    const tb = tube(B, `${base}.tube`, legG, c1, uk, ey, aftK, m(0.18), m(0.04), 0, m(sBot - sTube), { material: "steel", tone: "hi", bEnd: m(2.05 - sTube) });
    void main;
    // the accent runs the aft plate's outer face (the drag stay's side), end to end
    accentLine(ctx, tb[0], add(c1, mul(aftK, m(0.22))), add(add(c1, mul(aftK, m(0.22))), mul(uk, m(sBot - sTube))), aftK, 0);
    // piston on the oleo (child of the retraction shortening slide)
    const Pk = K(b.P);
    const L = len(sub(Pk, Hk));
    const sP0 = sTube + 0.03 + b.short;
    const pistonB = B.round(`${base}.piston`, `${base}.oleo`, add(Hk, mul(uk, m(sP0))), uk, 0, L - m(0.13) - m(sP0), m(0.14), { material: "chrome", tone: "hi", hint: [1, 0, 0] });
    torqueLinks(ctx, pistonB, add(Hk, mul(uk, m(sP0))), add(Hk, mul(uk, L - m(0.13))), uk, mul(aftK, -1), m(0.14));
    // bogie: knuckle, beam on the front and centre axles, the rear-axle steering collar and axle
    const bg = `${base}.bogie`;
    B.round(`${base}.bogie.knuckle`, bg, K([b.P[0], yc - 0.16, b.P[2]]), ey, 0, m(0.32), m(0.13), { material: "chrome", tone: "hi" });
    const xr = b.axles[2];
    const beam = [];
    for (const x of [34.95, xr - 0.22]) for (const y of [yc - 0.16, yc + 0.16]) for (const z of [RM + 0.09, b.P[2] - 0.13]) beam.push(K([x, y, z]));
    B.hull(`${base}.beam`, bg, beam, { material: "gunmetal" });
    b.axles.slice(0, 2).forEach((x, i) => {
      const wy = b.wheelY[i];
      const half = wy - TYRE.main.w / 2;
      B.round(`${base}.axle.${i + 1}`, bg, K([x, yc - half, RM]), ey, 0, m(2 * half), m(0.09), { material: "steel" });
      for (const [k, ss] of [["i", -b.side], ["o", b.side]]) wheel(`${base}.tyre.${i + 1}.${k}`, bg, [x, yc, RM], ss, half, TYRE.main.w, RM, true);
    });
    const sg = `${base}.steer`;
    B.round(`${base}.steer.collar`, sg, K([xr, yc, RM + 0.09]), [0, 0, 1], 0, m(b.P[2] - 0.13 - RM - 0.09), m(0.22), { material: "chrome", tone: "hi", details: { bolts: [{ s: m(b.P[2] - 0.13 - RM - 0.09), r: m(0.17), count: 8, size: 0.45 }] } });
    {
      const half = b.wheelY[2] - TYRE.main.w / 2;
      B.round(`${base}.axle.3`, sg, K([xr, yc - half, RM]), ey, 0, m(2 * half), m(0.09), { material: "steel" });
      for (const [k, ss] of [["i", -b.side], ["o", b.side]]) wheel(`${base}.tyre.3.${k}`, sg, [xr, yc, RM], ss, half, TYRE.main.w, RM);
    }
    // dragstay: fitting under fus.B5 aft, two links, the lug on the tube's aft face
    const st = b.stay;
    // slabs in y: stay.lo, stay.up and the lug, the fitting beside stay.up (stowed, stay.lo folds back past it)
    B.prism(`${base}.stay.fit`, "pitch", st.A, ey, [1, 0, 0], [K([b.Am[0] - 0.14, yc, 4.4]), K([b.Am[0] + 0.14, yc, 4.4]), ...B.circleIn(st.A, ey, m(0.085))], ...slabY(st.A, yc + 0.07, yc + 0.14));
    const sUp = slabY(st.A, yc, yc + 0.07);
    const sLo = slabY(st.K0, yc - 0.07, yc);
    const bUp = B.link(`${base}.stay.up`, `${base}.stay.up`, ey, st.A, st.K0, m(0.075), m(0.065), ...sUp, { material: "steel", tone: "hi" });
    const bLo = B.link(`${base}.stay.lo`, `${base}.stay.lo`, ey, st.K0, st.B0, m(0.065), m(0.075), ...sLo, { material: "steel", tone: "hi" });
    accentLine(ctx, bUp, ...linkEnds(st.A, st.K0, m(0.075), m(0.065)), ey, sUp[1]);
    accentLine(ctx, bLo, ...linkEnds(st.K0, st.B0, m(0.065), m(0.075)), mul(ey, -1), -sLo[0]);
    const sB = dot(sub(st.B0, Hk), uk);
    const lugBase = [-0.14, 0.14].map((d) => add(add(Hk, mul(uk, sB + m(d))), mul(aftK, m(0.22))));
    B.prism(`${base}.stay.lug`, legG, st.B0, ey, [1, 0, 0], [...lugBase, ...B.circleIn(st.B0, ey, m(0.075))], ...slabY(st.B0, yc, yc + 0.07), { material: "gunmetal" });
  }

  // =================================================================== doors and the BLG keel and door beams
  for (const d of DOORS)
    for (const pl of d.plates) {
      const pts = pl.pts.map((p) => (d.linked || d.held ? rot(K(p), d.hinge.point, d.hinge.axis, d.open) : K(p)));
      B.hull(pl.name, d.group, pts, { material: "steel", tone: "hi" });
    }
  {
    const xa = 35.92 + GAP;
    const xb = 40.9 - GAP;
    const beam = (name, y0, y1, zLow = (x) => fairBottom(x) + 0.03) => {
      const pts = [];
      for (const x of [xa, xb]) for (const y of [y0, y1]) pts.push(K([x, y, zLow(x)]), K([x, y, 4.4]));
      B.hull(name, "pitch", pts, { material: "gunmetal" });
    };
    beam("blg.keel", -0.05, 0.05);
    // the door beams come down to the inner doors' hinge line: open, the door's hinge edge bears on the beam (support);
    // the plate swings outboard, away from it
    const hingeZ = lowLine(fairBottom, 35.92 + GAP, 40.9 - GAP - 0.015, 0.0085);
    beam("blg.l.doorbeam", -1.43, -1.37, (x) => hingeZ(x) + 0.002);
    beam("blg.r.doorbeam", 1.37, 1.43, (x) => hingeZ(x) + 0.002);
    // wheel-well detail (follow-up feature) on the door beams' outboard faces, the BLG bay's inner walls
    for (const [k, sd] of [["l", -1], ["r", 1]]) {
      const L = xb - xa;
      const H = (s) => 4.4 - (hingeZ(xa + s) + 0.002);
      const frames = [];
      for (let x = 36.2; x < xb - 0.1; x += 0.635) frames.push(x - xa);
      ctx.plane(ctx.part(`blg.${k}.doorbeam`), wellPlane([xa, sd * 1.43, 4.4], [0, sd, 0], {
        L,
        H,
        frames,
        // the walls show only below z ≈ 3.1 (the fuselage's lower lobe hides the rest from the figure's 30° view):
        // the yellow system's lines, the uplock box at the aft end and the inner door's actuator, down to its hinge
        pipes: [1.9, 2.0, 2.1].map((t) => ({ t, d: 0.035, s0: 0.1, s1: L - 0.1 })),
        boxes: [{ s: 3.62, t: 1.4, w: 0.42, h: 0.28, lug: [3.83, 1.8, 0.055] }],
        actuators: [{ a: [1.9, 1.3], b: [2.45, H(2.45) - 0.12], r: 0.055 }],
        depth: [1.0, 2.5], // the wall shows below t 1.3; its foot (the hinge line) is at t 2.5–2.7
      }));
    }
  }
  // the WLG bays' inner wall: skin.keel's outboard faces (|y| 1.69, x 31.85–35.30; M6 draws their frames and the
  // stringer at z 3.40): the green system's lines, the main door's actuator and the bogie's uplock box
  for (const sd of [-1, 1]) {
    const zb0 = fairBottom(31.85);
    const zb1 = fairBottom(35.3);
    const L = 35.3 - 31.85;
    const frames = [];
    for (let x = 32.11; x < 35.3; x += 0.635) frames.push(x - 31.85);
    ctx.planeOn("skin.keel", wellPlane([31.85, sd * 1.69, 5.05], [0, sd, 0], {
      L,
      H: (s) => 5.05 - (zb0 + ((zb1 - zb0) * s) / L),
      frames,
      frameLines: false, // M6 draws them
      // in view only below z ≈ 2.9, through the fairing opening the fairing door leaves with the gear down
      pipes: [2.25, 2.35].map((t) => ({ t, d: 0.035, s0: 0.1, s1: L - 0.1 })),
      boxes: [{ s: 1.45, t: 2.5, w: 0.38, h: 0.28, lug: [1.64, 2.95, 0.05] }],
      actuators: [{ a: [2.3, 1.95], b: [2.75, 3.25], r: 0.05 }],
      depth: [2.0, 3.3], // the wall shows below t 2.15; its foot is at t 3.39
    }));
  }
  // WLG fairing door: strips on the oleo that reproduce the fairing section 0.02 m outboard when stowed
  for (const w of Object.values(WLG)) fairingDoor(ctx, B, w);

  cameraAndBayLights(ctx);
  finish(ctx);
  // =================================================================== clips and reachable states (DESIGN §3.5)
  registerClips(ctx);
}

/** The gear sequence of the model (GEAR.timing): channels at model seconds τ for a retraction or an extension. */
export function gearSequence(tau, up) {
  const T = up ? G.timing.retract : G.timing.extend;
  const lag = up ? 0 : T.bodyLag ?? 0; // the body gear's legs trail on extension (the doors close once they lock)
  const t1 = T.doorsOpen;
  const t2 = t1 + lag + T.legs;
  const t3 = t2 + T.doorsClose;
  const doors = tau < t1 ? tau / t1 : tau < t2 ? 1 : tau < t3 ? 1 - (tau - t2) / (t3 - t2) : 0;
  const legFrom = (t0) => Math.max(0, Math.min(1, (tau - t0) / T.legs));
  const leg = legFrom(t1);
  const body = legFrom(t1 + lag);
  return { gear: up ? 1 - leg : leg, gearBody: up ? 1 - body : body, gearDoors: Math.max(0, Math.min(1, doors)), total: t3 };
}
/** Audit clips: gear up and down at turns 0, 125 and 230 (×10), steer −70 → 70 at turn 40, take-off at 0 and 230. */
function registerClips(ctx) {
  const climb = (extra) => W.groundChannels({ lift: 60, pitch: 9, rot: 0, trim: 1, slat: 20, flap: 8, droop: 5, ...extra });
  for (const turn of [0, 125, 230]) {
    for (const up of [true, false]) {
      const total = gearSequence(0, up).total;
      ctx.clip({ name: `${up ? "gearUp" : "gearDown"}${turn ? `.${turn}` : ""}`, at: (t) => climb({ turn, ...gearSequence(t * 10, up) }), from: 0, to: total / 10, frame: 1 / 60 });
    }
  }
  ctx.clip({ name: "steer", at: (t) => W.groundChannels({ turn: 40, steer: Math.max(-70, Math.min(70, -70 + t * 60)) }), from: 0, to: 140 / 60, frame: 1 / 60 });
  for (const turn of [0, 230]) {
    ctx.clip({ name: `takeoff.${turn}`, at: (t) => W.groundChannels({ turn, slat: 20, flap: 8, droop: 5, lift: Fm.liftOf(Math.max(0, t - 2) * 3), pitch: Math.min(12.5, t * 3), rot: Math.min(12.5, t * 3) * (1 - Fm.smooth(0, 0.3, Math.max(0, t - 2) * 3)), trim: Fm.smooth(0.3, 2, Math.max(0, t - 2) * 3) }), from: 0, to: 6, frame: 1 / 60 });
  }
  // extension states are not in the tour's trajectory: add them (doors open, legs at quarters; doors closing)
  const hints = [];
  for (const g of [0, 0.25, 0.5, 0.75, 1]) hints.push(climb({ gear: g, gearDoors: 1 }));
  // the extension's lag: the body gear 2 s (2/11 of the leg travel) behind the wing gear
  const lagG = G.timing.extend.bodyLag / G.timing.extend.legs;
  for (const g of [0.25, 0.5, 0.75, 1]) hints.push(climb({ gear: g, gearBody: Math.max(0, g - lagG), gearDoors: 1 }));
  for (const d of [0.25, 0.5, 0.75]) hints.push(climb({ gear: 1, gearDoors: d }), climb({ gear: 0, gearDoors: d }));
  for (const r of [2, 4, 6, 8]) hints.push(W.groundChannels({ slat: 20, flap: 8, droop: 5, pitch: r, rot: r }));
  ctx.poseHints(hints);
}

/**
 * The WLG fairing door: mitred strips on the oleo group that reproduce the fairing section from the main door's
 * edge (|y| 3.21 on the bottom) round to the belly line, 0.02 m outboard, over the cheek gap x 31.85–35.30. Built
 * at the stowed pose (leg θW, oleo at the flight stroke) and carried back to the rest frame.
 */
function fairingDoor(ctx, B, w) {
  for (const st of fairingStrips(w)) ctx.hull({ name: st.name, group: `wlg.${w.s}.oleo`, points: st.points, tone: "hi", material: "steel" });
  void B;
}
/** The WLG fairing door strips (pure geometry, rest frame, kit units): one or two hulls per facet of the fairing
 *  chain, cut round the stowed leg. Each entry: { name, points, quad (|y|, z), hole (model x range or null) }. */
export function fairingStrips(w) {
  const sd = w.side;
  const out = [];
  // the upper facets (vertex 4 → the belly line): the main door covers the bottom and the lowest facet up to vertex 4
  const { chain, meet, cut, OUT, IN } = WCHAIN;
  const FIRST = 2;
  const x0 = 31.85 + GAP;
  const x1 = 35.3 - GAP;
  // stowed pose → rest frame: undo the oleo stroke, then the leg rotation
  const Hk = K(w.H);
  const ext = mul(KD(w.u), m(w.flight));
  const toRest = (pm) => sub(rot(K(pm), Hk, w.axis, -w.theta), ext);
  // the leg's sections the strips can meet, as prisms along the stowed leg (kit origin Hk, axis uS, cross-section in
  // (eaS, ebS) metres): the tube's square (±0.22) swept over the whole stroke relative to the strips (the oleo
  // slides), and the extended piston (r 0.14, circumscribed 28-gon) below it. Each strip's hole is the exact x-range
  // of the prisms inside the strip's slab (its quad in (|y|, z), extruded along x), HOLE (= GAP) clear on both ends.
  const Lp = len(sub(w.P, w.H));
  const uS = rotDir(KD(w.u), w.axis, w.theta);
  const ea0 = perp(KD(w.u), [1, 0, 0]);
  const eaS = rotDir(ea0, w.axis, w.theta);
  const ebS = cross(uS, eaS);
  const M0 = W.fromKit(Hk);
  const dirM = (d) => sub(W.fromKit(add(Hk, mul(d, m(1)))), M0); // a kit direction as a model vector per metre
  const Us = dirM(uS);
  const Ea = dirM(eaS);
  const Eb = dirM(ebS);
  const NP = 28;
  const rc = 0.14 / Math.cos(Math.PI / NP);
  const prisms = [
    { poly: [[-0.22, -0.22], [0.22, -0.22], [0.22, 0.22], [-0.22, 0.22]], s0: 0.75 + Math.min(0, w.flight - w.travel), s1: WLG_TUBE_BOTTOM + w.flight },
    { poly: Array.from({ length: NP }, (_, k) => [rc * Math.cos((2 * Math.PI * k) / NP), rc * Math.sin((2 * Math.PI * k) / NP)]), s0: 0.78 + w.flight, s1: Lp + w.flight },
  ];
  const at = (s, [a, b]) => add(M0, add(mul(Us, s), add(mul(Ea, a), mul(Eb, b))));
  const c2 = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const orient = (pts) => Math.sign(pts.reduce((acc, p, j) => acc + c2([0, 0], p, pts[(j + 1) % pts.length]), 0));
  const yz = (p) => [sd * p[1], p[2]];
  const inQuad = (q, quad) => {
    const o = orient(quad);
    return quad.every((a, j) => o * c2(a, quad[(j + 1) % quad.length], q) >= -1e-9);
  };
  // the quad grown by GAP (mitred): leg points outside it are GAP clear of the strip in (|y|, z) already
  const grow = (quad, d) => {
    const o = orient(quad);
    const lines = quad.map((a, j) => {
      const b = quad[(j + 1) % quad.length];
      const t = [b[0] - a[0], b[1] - a[1]];
      const l = Math.hypot(t[0], t[1]);
      const n = [(o * t[1]) / l, (-o * t[0]) / l]; // outward for a quad of orientation o
      return { p: [a[0] + n[0] * d, a[1] + n[1] * d], t };
    });
    return lines.map((B1, j) => {
      const A1 = lines[(j + lines.length - 1) % lines.length];
      const det = A1.t[0] * -B1.t[1] - A1.t[1] * -B1.t[0];
      const r = [B1.p[0] - A1.p[0], B1.p[1] - A1.p[1]];
      const u = (r[0] * -B1.t[1] - r[1] * -B1.t[0]) / det;
      return [A1.p[0] + A1.t[0] * u, A1.p[1] + A1.t[1] * u];
    });
  };
  // GAP, not less: the audit's separation test is GJK with 32 iterations, which under-reads these long thin strips by
  // about 0.019 m (tmp/m5-pair1.mjs); at 0.008 m it flags the pair, and narrower holes did not hide more of the gear
  const HOLE = GAP;
  // the leg's footprint on a strip: (x, w) points, w along the strip's outer face from its lower end (o0 → o1)
  const holeOf = (quad0) => {
    const quad = grow(quad0, HOLE);
    const [o0, o1] = quad0;
    const tl = Math.hypot(o1[0] - o0[0], o1[1] - o0[1]);
    const td = [(o1[0] - o0[0]) / tl, (o1[1] - o0[1]) / tl];
    const wOf = (q) => (q[0] - o0[0]) * td[0] + (q[1] - o0[1]) * td[1];
    const xs = [];
    const foot = [];
    const push = (x, q) => {
      xs.push(x);
      foot.push([x, wOf(q)]);
    };
    for (const P of prisms) {
      const ring0 = P.poly.map((v) => at(P.s0, v));
      const ring1 = P.poly.map((v) => at(P.s1, v));
      // 1. prism vertices inside the slab
      for (const p of [...ring0, ...ring1]) if (inQuad(yz(p), quad)) push(p[0], yz(p));
      // 2. prism edges crossing the slab's faces
      const edges = [];
      P.poly.forEach((_, k) => {
        const k1 = (k + 1) % P.poly.length;
        edges.push([ring0[k], ring0[k1]], [ring1[k], ring1[k1]], [ring0[k], ring1[k]]);
      });
      for (const [p, q] of edges)
        quad.forEach((c, j) => {
          const d = quad[(j + 1) % quad.length];
          const fp = c2(c, d, yz(p));
          const fq = c2(c, d, yz(q));
          if ((fp > 0 && fq > 0) || (fp < 0 && fq < 0) || fp === fq) return;
          const r = add(p, mul(sub(q, p), fp / (fp - fq)));
          if (inQuad(yz(r), quad)) push(r[0], yz(r));
        });
      // 3. the slab's corner lines (x free) clipped by the prism: s, a, b are affine in x
      const po = orient(P.poly);
      for (const [Y, z] of quad) {
        const X0 = [0, sd * Y, z];
        const coords = (X) => [dot(sub(X, M0), Us), dot(sub(X, M0), Ea), dot(sub(X, M0), Eb)];
        const k0 = coords(X0);
        const k1 = coords([1, sd * Y, z]).map((v, j) => v - k0[j]); // per unit x
        let lo = -Infinity;
        let hi = Infinity;
        const keep = (c0, c1) => {
          // c0 + c1 x >= 0
          if (Math.abs(c1) < 1e-12) {
            if (c0 < 0) lo = Infinity;
          } else if (c1 > 0) lo = Math.max(lo, -c0 / c1);
          else hi = Math.min(hi, -c0 / c1);
        };
        keep(k0[0] - P.s0, k1[0]);
        keep(P.s1 - k0[0], -k1[0]);
        P.poly.forEach((v, j) => {
          const v1 = P.poly[(j + 1) % P.poly.length];
          // po * cross(v1 - v, (a, b) - v) >= 0, (a, b) = (k0[1] + k1[1] x, k0[2] + k1[2] x)
          const ex = v1[0] - v[0];
          const ey = v1[1] - v[1];
          keep(po * (ex * (k0[2] - v[1]) - ey * (k0[1] - v[0])), po * (ex * k1[2] - ey * k1[1]));
        });
        if (lo <= hi) {
          push(lo, [Y, z]);
          push(hi, [Y, z]);
        }
      }
    }
    return xs.length ? { range: [Math.min(...xs) - HOLE, Math.max(...xs) + HOLE], foot, wOf, td, tl } : null;
  };
  // fu/f3-gear: the aft end web. Each strip ends GAP ahead of skin.fair.link (x 35.3), and the stiffener above is
  // flush with that end, so a ray nearly in the slit's plane ran down the GAP channel between the stiffener and the link
  // and, past the stiffener's 0.06 m, drifted forward onto the stowed aft tyres (tools/stowvis: 6 px at pitch 12.5,
  // also on SwiftShader, so not the renderer). A web WEB_T thick at the strip's end, WEB_D deep inward from its inner
  // face (under the top strip's stiffener), carries the channel's forward wall on: a ray must stay within GAP of x 35.3
  // over WEB_D, and so cannot reach the tyres (the web is aft of them by 0.012 m: they end at x 35.27).
  const WEB_T = 0.006;
  const WEB_D = 0.3;
  // facet i's outward unit normal in (|y|, z) (from its inner line toward its outer)
  const outN = (i) => {
    const a = meet(i, -IN);
    const b = meet(i + 1, -IN);
    let n = [b[1] - a[1], -(b[0] - a[0])];
    const l = Math.hypot(n[0], n[1]);
    n = [n[0] / l, n[1] / l];
    const o = meet(i, OUT);
    return (o[0] - a[0]) * n[0] + (o[1] - a[1]) * n[1] < 0 ? [-n[0], -n[1]] : n;
  };
  // each web starts on its own facet's normal and ends on the next facet's (the next web, or the top strip's stiffener,
  // starts there): neighbouring webs meet on that line instead of overlapping in the corner (the fairing is convex)
  const web = (i, quad, hole, d0 = 0) => {
    const [, , i1, i0] = quad;
    const n = outN(i);
    const nx = i + 1 < chain.length - 1 ? outN(i + 1) : n;
    const k = 1 / (n[0] * nx[0] + n[1] * nx[1]); // depth along n of a step along nx
    const q = [[i0[0] - n[0] * d0, i0[1] - n[1] * d0], [i1[0] - nx[0] * d0 * k, i1[1] - nx[1] * d0 * k], [i1[0] - nx[0] * WEB_D * k, i1[1] - nx[1] * WEB_D * k], [i0[0] - n[0] * WEB_D, i0[1] - n[1] * WEB_D]];
    out.push({ name: `wlg.${w.s}.fairing.${i - FIRST}w`, points: [x1 - WEB_T, x1].flatMap((x) => q.map(([y, z]) => toRest([x, sd * y, z]))), quad, hole, span: [x1 - WEB_T, x1] });
  };
  // fu/f3-gear end
  for (let i = FIRST; i < chain.length - 1; i++) {
    let o0 = i === FIRST ? cut(i, i, OUT, GAP / 2) : meet(i, OUT);
    let o1 = meet(i + 1, OUT);
    let i0 = i === FIRST ? cut(i, i, -IN, GAP / 2) : meet(i, -IN);
    let i1 = meet(i + 1, -IN);
    if (i === chain.length - 2) {
      // stop the top strip GAP under the belly line (fus.B4belly starts at z 4.40)
      const zMax = 4.4 - GAP - 0.004;
      const clip = (a, b) => (b[1] > zMax ? [a[0] + ((b[0] - a[0]) * (zMax - a[1])) / (b[1] - a[1]), zMax] : b);
      o1 = clip(o0, o1);
      i1 = clip(i0, i1);
    }
    const quad = [o0, o1, i1, i0];
    const hole = holeOf(quad);
    const name = (sfx) => `wlg.${w.s}.fairing.${i - FIRST}${sfx}`;
    const slab = (xa, xb, q) => [xa, xb].flatMap((x) => q.map(([y, z]) => toRest([x, sd * y, z])));
    if (!hole) {
      if (i === chain.length - 2) {
        // fu/f4-gear: the top strip in two pieces, flush at TOP_SPLIT. Whole, at a steep camera (50°, turn 145–151 and
        // mirrored) its forward end lay behind wings.{s}.box.1f on screen while its middle lay in front of the window piece
        // 2d, which closed a painter's cycle through the side stay (box.1f → stay.up → stay.lo → stay.lug → tube.f →
        // fairing.2d → fairing.3 → box.1f, f3-engine.md E1). Split, the piece behind the wing box no longer meets 2d.
        const xs = TOP_SPLIT;
        out.push({ name: name("a"), points: slab(x0, xs, quad), quad, hole: null, span: [x0, xs] });
        out.push({ name: name("b"), points: slab(xs, x1, quad), quad, hole: null, span: [xs, x1] });
      } else out.push({ name: name(""), points: slab(x0, x1, quad), quad, hole: null, span: [x0, x1] });
      if (i === chain.length - 2) {
        // a stiffener flush inside the top strip's aft end, 0.06 m deep: through the GAP slit against skin.fair.link the
        // stowed aft wheels (x ≤ 35.27) showed from the aft quarter. The strips sweep through the cheek gap, so the slit
        // cannot be lapped; the stiffener catches every ray that drifts forward toward the wheels (0.024 m off them)
        let n5 = [i1[1] - i0[1], -(i1[0] - i0[0])];
        const l5 = Math.hypot(n5[0], n5[1]);
        n5 = [n5[0] / l5, n5[1] / l5];
        if ((o0[0] - i0[0]) * n5[0] + (o0[1] - i0[1]) * n5[1] < 0) n5 = [-n5[0], -n5[1]];
        const dn = (p, d) => [p[0] - n5[0] * d, p[1] - n5[1] * d];
        // its top runs on inboard as a shelf at the strip's top (GAP under fus.B4belly), over the belly-line corner
        out.push({ name: name("s"), points: slab(x1 - 0.06, x1, [i0, i1, [i1[0] - 0.085, i1[1]], dn(i0, 0.06)]), quad, hole: null, span: [x1 - 0.06, x1] });
      }
      web(i, quad, null, i === chain.length - 2 ? 0.06 : 0); // the top strip's web starts under its stiffener
      continue;
    }
    const [h0, h1] = hole.range;
    if (h0 - x0 > 0.15) out.push({ name: name("a"), points: slab(x0, h0, quad), quad, hole: hole.range, span: [x0, h0] });
    if (x1 - h1 > 0.15) out.push({ name: name("b"), points: slab(h1, x1, quad), quad, hole: hole.range, span: [h1, x1] });
    if (x1 - h1 > 0.15) web(i, quad, hole.range);
    // the window between a and b, above and below the leg: one piece each, cut on the footprint's supporting line
    // (the edge that leaves the widest band) GAP clear of it; the residue is two thin wedges at the leg's corners
    const { td, tl, wOf } = hole;
    let n2 = [td[1], -td[0]];
    if ((o0[0] - i0[0]) * n2[0] + (o0[1] - i0[1]) * n2[1] < 0) n2 = [-n2[0], -n2[1]];
    const thick = (o0[0] - i0[0]) * n2[0] + (o0[1] - i0[1]) * n2[1];
    const outAt = (wv) => [o0[0] + td[0] * wv, o0[1] + td[1] * wv];
    const inAt = (wv) => [o0[0] + td[0] * wv - n2[0] * thick, o0[1] + td[1] * wv - n2[1] * thick];
    const lower = supportLine(hole.foot, true, h0, h1);
    const upper = supportLine(hole.foot, false, h0, h1);
    const lo = (x) => lower(x) - GAP;
    const hi = (x) => upper(x) + GAP;
    // a 0.004 m hairline at both ends (as between the tube plates): flush on a and b, the shared end face put the pair's
    // order on a plane through both, and the depth oracle found a in front but drawn first (0.31 px², gearDown.125)
    const HAIR = 0.004;
    const piece = (sfx, ends) => out.push({ name: name(sfx), points: [h0 + HAIR, h1 - HAIR].flatMap((x) => ends(x).map(([y, z]) => toRest([x, sd * y, z]))), quad, hole: hole.range, span: [h0 + HAIR, h1 - HAIR], window: true });
    out.windows ??= [];
    out.windows.push({ strip: i - FIRST, h0, h1, tl, w0: Math.max(0, wOf(i0)), w1: Math.min(tl, wOf(i1)), foot: hole.foot, lo, hi });
    if (Math.min(lo(h0), lo(h1)) > Math.max(0, wOf(i0)) + 0.03) piece("c", (x) => [o0, i0, inAt(lo(x)), outAt(lo(x))]);
    if (Math.max(hi(h0), hi(h1)) < Math.min(tl, wOf(i1)) - 0.03) piece("d", (x) => [outAt(hi(x)), inAt(hi(x)), i1, o1]);
  }
  // the belly-line lap: the top strip's seal, GAP outboard of fus.B4belly's facet from the strip's top (z 4.384) up to
  // z 4.55, so no view ray finds the slit between the strip's top face and the belly slab (it rises nearly along the
  // facet as the leg closes, so it never comes nearer than GAP)
  {
    const b0 = W.S0.find(([y, z]) => y > 0 && Math.abs(z - 4.4) < 1e-6);
    const b1 = W.S0.find(([y, z]) => y > 0 && Math.abs(z - 5.05) < 1e-6);
    const tl = Math.hypot(b1[0] - b0[0], b1[1] - b0[1]);
    const tb = [(b1[0] - b0[0]) / tl, (b1[1] - b0[1]) / tl];
    const nb = [tb[1], -tb[0]]; // outward (down-outboard)
    const zBot = 4.4 - GAP - 0.004;
    const line = (off, z) => {
      const p = [b0[0] + nb[0] * off, b0[1] + nb[1] * off];
      const s = (z - p[1]) / tb[1];
      return [p[0] + tb[0] * s, z];
    };
    const q = [line(GAP, zBot), line(GAP + 0.04, zBot), line(GAP + 0.04, 4.55), line(GAP, 4.55)];
    // from x 32.6 (the top-slit leaks were all aft of 33.0) and 0.03 m short of skin.fair.link: running on to the front
    // cheek, it overlapped skin.fair.mid on screen and closed a real painter's cycle with fus.B4belly, which laps over
    // that cheek's top (tools/cycle.mjs, gearUp at gear 0.1, turn 0)
    const [la, lb] = [32.6, x1 - 0.03];
    out.push({ name: `wlg.${w.s}.fairing.lap`, points: [la, lb].flatMap((x) => q.map(([y, z]) => toRest([x, sd * y, z]))), quad: q, hole: null, span: [la, lb] });
  }
  // the root box (DESIGN §5.6's door on the leg for the wing's root-face opening): stowed, the leg crosses the slot
  // between the fairing's upper facets and the wing root (|y| 4.30–4.45), which is open from above and along x. Round
  // the crossing the fairing door carries a box open only underneath and outboard into the root recess (R1): a lid GAP
  // under the recess roof (z 3.82) from strip 2's outer face out to |y| 4.52, and front and aft end plates (one per
  // facet, flush on strips 1 and 2) from below the leg up to the lid. The plates stand clear of the leg over the
  // whole oleo stroke (they ride the oleo, the tube the leg: x shifts −0.14…+0.05 m). Everything outboard of the root
  // plane lies inside R1's recess in transit too (the lid's outer edge sweeps |y| ≤ 4.55 above the wing bottom).
  if (out.windows?.length) {
    const h0 = Math.min(...out.windows.map((q) => q.h0));
    const h1 = Math.max(...out.windows.map((q) => q.h1));
    const T = 0.04;
    const xF = [h0 - 0.13 - T, h0 - 0.13]; // the tube's front face runs 0.07 forward over |y| 4.25 → 4.52, the stroke 0.05 more
    const xA = [h1 + 0.15, h1 + 0.15 + T];
    const zT = LID.top;
    const zB = zT - T;
    const zBot = 2.88;
    const lineOf = (i) => {
      // facet i's outer face (0.02 off the section) as y(z)
      const a = WCHAIN.meet(i, OUT);
      const b = WCHAIN.meet(i + 1, OUT);
      return (z) => a[0] + ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]);
    };
    const f3 = lineOf(3); // vertex 3 → 2 (strip 1)
    const f4 = lineOf(4); // vertex 2 → 1 (strip 2)
    const zm = WCHAIN.meet(4, OUT)[1];
    const yo = LID.reach;
    const lid = [[f4(zB), zB], [yo, zB], [yo, zT], [f4(zT), zT]];
    const lo = [[f3(zBot), zBot], [yo, zBot], [yo, zm], [f3(zm), zm]];
    const hi = [[f4(zm), zm], [yo, zm], [yo, zB], [f4(zB), zB]];
    const put = (sfx, [xa, xb], q) => out.push({ name: `wlg.${w.s}.fairing.${sfx}`, points: [xa, xb].flatMap((x) => q.map(([y, z]) => toRest([x, sd * y, z]))), quad: q, hole: null, span: [xa, xb] });
    // the lid in three pieces over strip 2's pieces (a, the window piece, b): one plate over the tube made a painter's
    // cycle with the tube and strip 2a
    const holes = out.windows.filter((q) => q.strip === 1);
    const [w0, w1] = holes.length ? [holes[0].h0, holes[0].h1] : [h0, h1];
    put("lid.f", [xF[0], w0], lid);
    put("lid.m", [w0, w1], lid);
    put("lid.a", [w1, xA[1]], lid);
    put("end.f.lo", xF, lo);
    put("end.f.hi", xF, hi);
    put("end.a.lo", xA, lo);
    put("end.a.hi", xA, hi);
    out.box = { xF, xA, zBot, zT, reach: yo };
  }
  return out;
}
/** fu/f4-gear: where the WLG fairing door's top strip is split (model x, m), flush: on strip 2's window joint (2a ends there). */
const TOP_SPLIT = 33.269;
/** The WLG root box: its lid's top face GAP under the R1 recess roof (z 3.82), reaching |y| 4.52 inside the recess. */
const LID = { top: 3.82 - GAP, reach: 4.52 };
/** The supporting line of a 2D point set from below (or above) that leaves the most room over [h0, h1]: among the
 *  hull's edge lines (and the horizontal through the extreme), the one whose mean over the interval is highest
 *  (lowest) with every point on its far side. Returns (x) => w. */
function supportLine(pts, below, h0, h1) {
  const H2 = hull2(pts);
  const ws = pts.map((p) => p[1]);
  const lines = [{ a: below ? Math.min(...ws) : Math.max(...ws), b: 0 }];
  for (let j = 0; j < H2.length; j++) {
    const p = H2[j];
    const q = H2[(j + 1) % H2.length];
    if (Math.abs(q[0] - p[0]) < 1e-6) continue;
    const b = (q[1] - p[1]) / (q[0] - p[0]);
    lines.push({ a: p[1] - b * p[0], b });
  }
  let best = null;
  for (const L of lines) {
    if (!pts.every(([x, wv]) => (below ? wv >= L.a + L.b * x - 1e-9 : wv <= L.a + L.b * x + 1e-9))) continue;
    const score = 2 * L.a + L.b * (h0 + h1);
    if (!best || (below ? score > best.score : score < best.score)) best = { ...L, score };
  }
  return (x) => best.a + best.b * x;
}

/** The WLG well ceiling plane z(x, |y|) (model): M3's construction (DESIGN §5.1), a plane fitted 0.15 m under the box top and lowered. */
function wellCeiling() {
  const samples = [];
  for (let a = 5.1; a <= 6.8 + 1e-9; a += 0.05) for (let x = 32.55; x <= teFaceX(a) + 1e-9; x += 0.025) samples.push([x, a, W.WING.section(a).topAt(x) - 0.15]);
  // least squares z = c0 + cx x + cy a
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0, n = 0, sxz = 0, syz = 0, sz = 0;
  for (const [x, a, z] of samples) {
    sxx += x * x; sxy += x * a; sx += x; syy += a * a; sy += a; n++; sxz += x * z; syz += a * z; sz += z;
  }
  const Mx = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const rhs = [sxz, syz, sz];
  const det3 = (A) => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  const D = det3(Mx);
  const col = (j) => det3(Mx.map((row, i) => row.map((v, k) => (k === j ? rhs[i] : v)))) / D;
  const cx = col(0);
  const cy = col(1);
  let c0 = col(2);
  const lower = Math.min(0, ...samples.map(([x, a, z]) => z - (c0 + cx * x + cy * a)));
  c0 += lower;
  const at = (x, a) => c0 + cx * x + cy * a;
  at.coef = { c0, cx, cy };
  return at;
}
/** The inner TE face x at span |y| (W.WING.faces.te[0]). */
function teFaceX(a) {
  const f = W.WING.faces.te[0];
  return f.x[0] + ((f.x[1] - f.x[0]) * (a - f.y[0])) / (f.y[1] - f.y[0]);
}

/**
 * Wheel-well detail (follow-up feature): a plane on a bay wall, drawn in metres along the wall (s aft from o, t down
 * from o) as closed shapes only (no free line ends): frame flanges (unless frameLines is false), hydraulic lines with a
 * clamp at each frame, uplock boxes with their hook roller, and actuators (a cylinder and its rod, a lug at each end).
 * o: the wall's top-front corner (model), n: the wall's outward normal (model); H(s) the wall's height at s.
 * Follow-up review 1 (craft, dark): the detail is the bay's own structure seen in a recess, not a grid over the opening:
 * its lines and fills are the well tokens (--a3-m5-well-line, --a3-m5-clamp, --a3-m5-well: at most about 90 lum in dark;
 * the clamps were the hub-bolt grey, 159, and read as a white ladder through the root gap), and each piece fades with
 * its depth into the bay: opacity WELL_DEEP where t = depth[0] (up in the bay) to WELL_RIM at t = depth[1] (the opening).
 */
const WELL_DEEP = 0.3;
const WELL_RIM = 0.8;
function wellPlane(o, n, { L, H, frames = [], frameLines = true, pipes = [], boxes = [], actuators = [], depth }) {
  const f = (v) => m(v).toFixed(2);
  const rect = (s, t, w, h) => `M${f(s)} ${f(t)}h${f(w)}v${f(h)}h${f(-w)}Z`;
  const line = (d) => `<path class="iso-line a3-well-line" data-tone="lo" fill="none" d="${d}"/>`;
  const dot = (s, t, r, cls = "a3-well-clamp") => `<circle class="${cls}" cx="${f(s)}" cy="${f(t)}" r="${f(r)}"/>`;
  // a piece at depth t (its mean t on the wall) in a group at its opacity
  const at = (t, body) => `<g opacity="${(WELL_DEEP + (WELL_RIM - WELL_DEEP) * smooth01((t - depth[0]) / (depth[1] - depth[0]))).toFixed(2)}">${body}</g>`;
  let svg = "";
  // a frame flange runs the wall's height: it takes the opacity of the band the view reaches (below depth[0])
  if (frameLines) svg += at((depth[0] + depth[1]) / 2, line(frames.map((s) => rect(s - 0.025, 0.04, 0.05, H(s) - 0.1)).join("")));
  for (const p of pipes) svg += at(p.t, line(rect(p.s0, p.t - p.d / 2, p.s1 - p.s0, p.d)) + frames.filter((s) => s > p.s0 && s < p.s1).map((s) => dot(s, p.t, p.d * 0.9)).join(""));
  for (const b of boxes) {
    // the box, and the hook's arm below it and its roller
    const box = `<path class="a3-well-face" d="${rect(b.s, b.t, b.w, b.h)}"/>` + line(rect(b.s, b.t, b.w, b.h) + rect(b.s + 0.05, b.t + 0.05, b.w - 0.1, b.h * 0.45));
    svg += at(b.t + b.h / 2, box + line(rect(b.lug[0] - 0.03, b.t + b.h, 0.06, b.lug[1] - b.t - b.h - b.lug[2])) + dot(b.lug[0], b.lug[1], b.lug[2]));
  }
  for (const q of actuators) {
    const d = [q.b[0] - q.a[0], q.b[1] - q.a[1]];
    const l = Math.hypot(d[0], d[1]);
    const e = [d[0] / l, d[1] / l];
    const nn = [-e[1], e[0]];
    const quad = (p0, p1, r) => `M${f(p0[0] + nn[0] * r)} ${f(p0[1] + nn[1] * r)}L${f(p1[0] + nn[0] * r)} ${f(p1[1] + nn[1] * r)}L${f(p1[0] - nn[0] * r)} ${f(p1[1] - nn[1] * r)}L${f(p0[0] - nn[0] * r)} ${f(p0[1] - nn[1] * r)}Z`;
    const mid = [q.a[0] + e[0] * l * 0.6, q.a[1] + e[1] * l * 0.6];
    const act = `<path class="a3-well-face" d="${quad(q.a, mid, q.r)}"/>` + line(quad(q.a, mid, q.r) + quad(mid, q.b, q.r * 0.45)) + dot(q.a[0], q.a[1], q.r * 0.8) + dot(q.b[0], q.b[1], q.r * 0.8);
    svg += at((q.a[1] + q.b[1]) / 2, act);
  }
  void L;
  return { o: K(o), u: KD([1, 0, 0]), v: KD([0, 0, -1]), normal: KD(n), fade: [0.04, 0.3], svg };
}

/** Nose-gear lamps: lens planes on the lamp bar's front and sides, registered with ctx.lamp (M8 draws the lens, beam, pool). */
function nlgLamps(ctx, bar, g0, g1, nt) {
  const v = unit(sub(g1, g0));
  const half = len(sub(g1, g0)) / 2;
  const face = add(mul(add(g0, g1), 0.5), mul(nt, m(0.1)));
  const lens = (x, y, r) => `<circle class="iso-line" data-tone="mid" fill="none" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${(r + 0.18).toFixed(2)}"/><circle class="a3-m5-lens" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r.toFixed(2)}"/>`;
  // front face: taxi lens high, three take-off lenses below it; a seam round the bar's face (plane coords: u = +y, v = up)
  const taxi = [0, m(0.2)];
  const tos = [[-m(0.19), -m(0.12)], [0, -m(0.12)], [m(0.19), -m(0.12)]];
  const W2 = m(0.3) - 0.35;
  const H2 = half - 0.35;
  const frame = `<path class="iso-line" data-tone="faint" fill="none" d="M${-W2} ${-H2}H${W2}V${H2}H${-W2}Z"/>`;
  const pt = ([x, y]) => add(add(face, mul([0, 1, 0], x)), mul(v, y));
  ctx.plane(bar, { o: face, u: [0, 1, 0], v, normal: nt, fade: [0.04, 0.3], svg: frame + lens(taxi[0], -taxi[1], 0.75) + tos.map(([x, y]) => lens(x, -y, 0.6)).join("") });
  // the aims are world aims in the down-locked pose (the leg group is at rest there): 4° below the horizon, the
  // outer take-off lamps toed out 4° (the raked strut's face normal points 14° up: aimed from it, the beams lit the sky)
  const down = Math.tan(4 * D2R);
  const aim = (toe) => unit([Math.cos(toe * D2R), Math.sin(toe * D2R), -down]);
  ctx.lamp({ id: "taxiNose", part: "nlg.lamps", group: "nlg.leg", at: pt(taxi), dir: aim(0), cone: 15, beam: true, switch: "taxiNose", gate: "gear" }); // f4-lights: the model's nose-strut switch (off at gear-up)
  tos.forEach((q, i) => ctx.lamp({ id: `toNose${i + 1}`, part: "nlg.lamps", group: "nlg.leg", at: pt(q), dir: aim([-4, 0, 4][i]), cone: 15, beam: true, switch: "takeoff", gate: "gear" }));
  // runway turn-off lenses on the bar's side faces, beams 15–73° off the nose
  for (const [id, sd] of [["rwyL", -1], ["rwyR", 1]]) {
    const o = add(add(mul(add(g0, g1), 0.5), mul(nt, m(0.05))), [0, sd * m(0.3), 0]);
    const at = add(o, mul(v, -m(0.1)));
    ctx.plane(bar, { o, u: nt, v, normal: [0, sd, 0], fade: [0.04, 0.3], svg: lens(0, m(0.1), 0.45) });
    const a = 44 * D2R;
    ctx.lamp({ id, part: "nlg.lamps", group: "nlg.leg", at, dir: unit([Math.cos(a), sd * Math.sin(a), -0.08]), cone: 29, beam: true, switch: "runwayTurnoff", gate: "gear" });
  }
}

/** A link's centreline carried out to the stadium's ends (the accent ends on the outline). */
function linkEnds(P, Q, r0, r1) {
  const u = unit(sub(Q, P));
  return [sub(P, mul(u, r0)), add(Q, mul(u, r1))];
}
/** The phase accent: a lit rule from P to Q in the plane with normal n (class a3-acc-gear, alpha written by the page). */
function accentLine(ctx, part, P, Q, n, off = 0) {
  const N = unit(n);
  const o = add(P, mul(N, off));
  const u = unit(sub(Q, P));
  const vv = unit(cross(N, u));
  ctx.accent("gear", { part, o, u, v: vv, normal: N, fade: [0.02, 0.25], svg: `<path d="M0 0H${len(sub(Q, P)).toFixed(2)}"/>` });
}

/** NLG camera-light housings on the nose bay walls, and the gear-bay pool lamps (DESIGN §6.2). */
function cameraAndBayLights(ctx) {
  // NLG taxi-camera lights (ETACS): pool lamps at the model's positions on the bay walls' outer sides (no housings:
  // the lenses are 0.1 m); M8 draws the pools
  for (const [id, sd] of [["camNoseL", -1], ["camNoseR", 1]]) {
    const at = M.LIGHTS.camera.find((c) => c.id === id).at;
    ctx.lamp({ id, part: "nlg.stay.fit", group: "pitch", at: K(at), dir: unit([0.4, -sd * 0.5, -0.8]), cone: 35, switch: "camera", gate: "gear" });
  }
  const host = { bayNose: "nlg.stay.fit", bayWingL: "blg.keel", bayWingR: "blg.keel", bayBody: "blg.keel" };
  for (const b of M.LIGHTS.gearBay) ctx.lamp({ id: b.id, part: host[b.id], group: "pitch", at: K(b.at), dir: [0, 0, -1], cone: 50, switch: "gearBay" });
}

/** Labels, the Wing gear inspect view, the hub page script and the CSS. */
function finish(ctx) {
  const word = `(s) => { const g = s && s.gear; if (!g) return "down"; return g.stage === "locked" ? "down and locked" : g.stage === "up" ? "up and locked" : g.cmd ? "extending" : "retracting"; }`;
  const L = (prefix, text, action = "gear") => ctx.label(prefix, new Function("s", `const w = (${word})(s); return ${JSON.stringify(text)}.replace("{gear}", w);`), action);
  L("nlg.tyre", "Nose gear tyre · 1270×455 R22 · 14.1 bar", "steer");
  L("nlg.lamps", "Nose gear lamp bar · taxi, three take-off and two runway turn-off lights · dark when the gear is not down and locked");
  L("nlg.stay", "Nose gear drag stay · two links, locked straight when down, folding as the leg swings forward");
  L("nlg.door.f", "Nose gear forward door · hydraulic, opens 75° here (62° on the aircraft: at 62° its edge meets the tyres) and closes after the gear has moved");
  L("nlg.door.a", "Nose gear aft door · linked to the leg, open 69.2° while the gear is down");
  L("nlg.steer", "Nose gear steering · ±70° about the vertical through the axle (hand wheels)", "steer");
  L("nlg.", "Nose gear · 2 wheels · steers ±70° · retracts forward under the cockpit · {gear}");
  L("light.camNose", "Nose gear taxi-camera light (ETACS) · on with the cameras while the gear is down");
  for (const [s, side] of SIDES) {
    const S = side < 0 ? "L" : "R";
    L(`wlg.${s}.tyre`, "Wing gear tyre · 1400×530 R23 · 15 bar · carbon brakes on all four wheels");
    L(`wlg.${s}.door`, `Wing gear ${S} main door · hydraulic, opens 79° and closes after the gear has moved`);
    L(`wlg.${s}.fairing`, `Wing gear ${S} fairing door · rides the leg and closes the belly fairing when stowed`);
    L(`wlg.${s}.stay`, `Wing gear ${S} side stay · two links, locked straight when down`);
    L(`wlg.${s}.bogie`, `Wing gear ${S} bogie · tilts to keep the aft axle on the runway as the nose rotates`);
    L(`wlg.${s}.`, `Wing gear ${S} · 4 wheels · retracts inboard into the belly · {gear}`);
    L(`blg.${s}.tyre.3`, `Body gear ${S} rear wheel · on the steered axle (±15°, opposite the nose wheel)`, "steer");
    L(`blg.${s}.steer`, `Body gear ${S} rear-axle steering · ±15°, opposite the nose wheel`, "steer");
    L(`blg.${s}.tyre`, "Body gear tyre · 1400×530 R23 · 15 bar · braked on the front and centre axles");
    L(`blg.${s}.door.out`, `Body gear ${S} outer door · hydraulic, hinged on its outboard edge · opens 99° and closes after the gear has moved, leaving the slot for the leg`);
    L(`blg.${s}.door.in.fold`, `Body gear ${S} inner door fold leaf · folds up into the bay as the door opens, so the door swings clear of the extended wheels`);
    L(`blg.${s}.door.in`, `Body gear ${S} inner door · hydraulic, opens 94° with its fold leaf folded and closes after the gear has moved`);
    L(`blg.${s}.door.ctr`, `Body gear ${S} centre door · hydraulic, closes after the gear has moved`);
    L(`blg.${s}.doorbeam`, `Body gear ${S} door beam · carries the inner door's hinge`);
    L(`blg.${s}.stay`, `Body gear ${S} drag stay · two links, locked straight when down`);
    L(`blg.${s}.`, `Body gear ${S} · 6 wheels · rear axle steers · retracts aft · {gear}`);
  }
  L("blg.keel", "Body gear bay keel beam · carries the centre doors' hinges");
  // b +165 (integration): from +120 the right wing covers the bogie at the camera's 30°; from astern-starboard the
  // sight line passes under the flaps
  ctx.inspect({ id: "wing-gear", label: "Wing gear", centre: [G.wing.centre[0], G.wing.centre[1], 1.0], group: "wlg.r.bogie", bearing: 165, zoom: 6, cutaway: 0 });
  ctx.css(`.iso{--a3-m5-lens:#c9d3dc;--a3-m5-bolt:#6d7177;--a3-m5-brake:#4a4d52;--a3-m5-hub:#b9bec4}
.iso[data-theme="dark"]{--a3-m5-lens:#7f8a96;--a3-m5-bolt:#9aa0a6;--a3-m5-brake:#0c0d0f;--a3-m5-hub:#3a3e44}
.iso{--a3-m5-well-line:#8f9399;--a3-m5-clamp:#83878d;--a3-m5-well:#b7bcc2}
.iso[data-theme="dark"]{--a3-m5-well-line:#62666c;--a3-m5-clamp:#62666c;--a3-m5-well:#34383e}
.a3-m5-lens{fill:var(--a3-m5-lens);stroke:none}
.a3-hub-bolt{fill:var(--a3-m5-bolt);stroke:none}
.a3-brake{fill:var(--a3-m5-brake);stroke:none}
.a3-hub-face{fill:var(--a3-m5-hub);stroke:none}
.a3-brake-lug{fill:var(--a3-m5-bolt);stroke:none}
.iso-line.a3-well-line{stroke:var(--a3-m5-well-line)}
.a3-well-clamp{fill:var(--a3-m5-clamp);stroke:none}
.a3-well-face{fill:var(--a3-m5-well);stroke:none}`);
  ctx.vary("a3-hub-mark", "pv.hubMark ?? 1"); // fu/perf: the hub's turn mark fades past 20-30° a frame (review r1) fu/perf end
  // wheel hub marks: wheelPhase = ground distance / r; braked wheels stop within 3 s of gear-up selection, the BLG
  // aft axle spins down freely. The canvas painter bakes inner transforms (kit patch 11 not done), so the hubs only
  // turn on the SVG page (DESIGN §11.9).
  ctx.script(`(() => {
  // fu/perf: on the canvas page the painter turns each hub's <g data-spin> (kit patch 11; PLAN item 44) fu/perf end
  const onCanvas = A3.data.painter === "canvas";
  const hubs = [...document.querySelectorAll(".a3-hub[data-hub]")].map((el) => {
    const name = el.getAttribute("data-hub");
    return { el, name, r: name.startsWith("nlg.") ? ${RN} : ${RM}, free: /^blg\\.[lr]\\.tyre\\.3\\./.test(name), phase: 0, w: 0, last: "" };
  });
  if (!hubs.length) return;
  let lastD = null;
  let upAt = null;
  A3.on("frame", (fx) => {
    const t0 = performance.now(); // fu/perf: the hubs' cost per frame, A3.hubMs fu/perf end
    const s = fx.state;
    if (!s) return;
    const d = s.groundDistance || 0;
    const dd = lastD === null ? 0 : d - lastD;
    lastD = d;
    const ground = (s.height || 0) < 0.05;
    const up = s.gear && s.gear.cmd === 0;
    if (up && upAt === null) upAt = fx.clock;
    if (!up) upAt = null;
    // fu/perf: past 20-30° a frame the mark aliases (the roll turns the wheels 15-30 rev/s): it fades out, as a fan
    // blurs into its disc, and a faded or stowed hub requests no repaint (review r1: the hubs repainted the whole
    // airframe every frame of the roll)
    const stowed = Boolean(s.gear && s.gear.stage === "up");
    let step = 0;
    for (const h of hubs) step = Math.max(step, Math.abs(h.w * fx.dt));
    const want = stowed ? 1 : 1 - Math.min(1, Math.max(0, (step - 0.35) / 0.17));
    const was = A3.pv.hubMarkRaw ?? 1;
    A3.pv.hubMarkRaw = fx.calm ? want : was + Math.max(-fx.dt / 0.4, Math.min(fx.dt / 0.4, want - was)); // (0.4 s ramp)
    A3.pv.hubMark = Math.round(20 * A3.pv.hubMarkRaw) / 20; // (20 steps: the alpha moves, and the canvas repaints, 20 times a fade)
    // fu/perf end
    for (const h of hubs) {
      if (ground) h.w = fx.dt > 0 ? dd / h.r / fx.dt : 0;
      else h.w *= Math.exp(-fx.dt / (upAt !== null && !h.free ? 0.6 : 8));
      if (fx.calm) h.w = 0;
      h.phase = (h.phase + h.w * fx.dt) % (2 * Math.PI);
      if (onCanvas && (stowed || A3.pv.hubMark === 0)) continue; // fu/perf fu/perf end
      // fu/perf: the canvas page's hubs (the same angle, to 0.1°), and a repaint when one turned fu/perf end
      if (onCanvas) {
        if (A3.canvas && A3.canvas.spin && A3.canvas.spin(h.name, -Math.round(h.phase * 572.9578) / 572.9578)) A3.repaint = true;
        continue;
      }
      const t = "rotate(" + (-h.phase * 57.29578).toFixed(1) + ")";
      if (t !== h.last) {
        h.el.setAttribute("transform", t);
        h.last = t;
      }
    }
    A3.hubMs = performance.now() - t0; // fu/perf fu/perf end
  });
})();`);
}

/**
 * The brake stack on a braked wheel's inboard face (a plane on the tyre's inner end, facing the beam): the dark stack
 * at 0.8 of the rim, its disc rings, the torque-bar lugs and the brake rod's lug. It does not turn with the wheel.
 */
function brakePlane(ctx, part, o, side, r) {
  const R = m(r);
  const rim = 0.62 * R;
  const stack = 0.8 * rim;
  const rings = [0.92, 0.8, 0.68].map((f) => `<circle class="iso-line" data-tone="lo" r="${(stack * f).toFixed(2)}" fill="none"/>`).join("");
  const lugs = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * 2 * Math.PI + 0.26;
    return `<circle class="a3-brake-lug" cx="${(stack * 0.86 * Math.cos(a)).toFixed(2)}" cy="${(stack * 0.86 * Math.sin(a)).toFixed(2)}" r="${(0.03 * R).toFixed(2)}"/>`;
  }).join("");
  // the brake rod's lug at the top of the housing, toward the beam
  const rod = `<path class="iso-line" data-tone="mid" d="M0 ${(stack * 0.55).toFixed(2)}L0 ${(stack * 1.05).toFixed(2)}"/>`;
  const svg = `<circle class="a3-brake" r="${stack.toFixed(2)}"/>${rings}<circle class="iso-line" data-tone="faint" r="${(0.3 * R).toFixed(2)}" fill="none"/>${lugs}${rod}`;
  ctx.plane(part, { o, u: [1, 0, 0], v: [0, 0, 1], normal: [0, -side, 0], svg, fade: [0.04, 0.3] });
}

/**
 * The torque links (scissor) on an oleo's piston: an upper and a lower link meeting at an apex pin ahead of the
 * strut, pinned to the cylinder's foot and to the axle end (a plane through the strut axis, facing `ahead`).
 */
function torqueLinks(ctx, part, top, bottom, axis, ahead, radius) {
  const Lp = len(sub(bottom, top));
  if (!(Lp > 2)) return;
  const n = unit(cross(axis, ahead));
  const o = add(top, mul(ahead, radius * 1.02));
  const u = axis; // along the strut, down
  const v = unit(cross(n, u));
  const sgn = dot(v, ahead) >= 0 ? 1 : -1;
  const a = [0.05 * Lp, 0];
  const c = [0.95 * Lp, 0];
  const apex = [0.5 * Lp, sgn * Math.min(0.45 * Lp, 4.2)];
  const pin = (p) => `<circle class="a3-brake-lug" cx="${p[0].toFixed(2)}" cy="${p[1].toFixed(2)}" r="0.55"/>`;
  const svg = `<path class="iso-line" data-tone="hi" d="M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${apex[0].toFixed(2)} ${apex[1].toFixed(2)}L${c[0].toFixed(2)} ${c[1].toFixed(2)}"/>${pin(a)}${pin(apex)}${pin(c)}`;
  // the plane faces sideways (both sides of the strut show the scissor): one per side
  for (const sd of [1, -1]) ctx.plane(part, { o, u, v, normal: mul(n, sd), svg, fade: [0.02, 0.25] });
}

/** The hub plane on a wheel's outer face: rim, hub, 8 bolts and a mark; its inner <g> turns with wheelPhase. */
function hubPlane(ctx, part, o, side, r, braked = false) {
  const R = m(r);
  const rim = 0.62 * R;
  const hub = 0.33 * R;
  const bolts = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * 2 * Math.PI;
    return `<circle class="a3-hub-bolt" cx="${(0.24 * R * Math.cos(a)).toFixed(2)}" cy="${(0.24 * R * Math.sin(a)).toFixed(2)}" r="${(0.022 * R).toFixed(2)}"/>`;
  }).join("");
  // a braked wheel shows its dark brake stack between the hub and the rim (it does not turn)
  const brake = braked ? `<circle class="a3-brake" r="${(0.56 * R).toFixed(2)}"/><circle class="a3-hub-face" r="${(0.38 * R).toFixed(2)}"/>` : "";
  const svg = `${brake}<circle class="iso-line" data-tone="lo" r="${rim.toFixed(2)}" fill="none"/><g class="a3-hub" data-hub="${part.name}" data-spin="${part.name}"><circle class="iso-line" data-tone="faint" r="${hub.toFixed(2)}" fill="none"/>${bolts}<path class="iso-line a3-hub-mark" data-tone="mid" d="M${(0.36 * R).toFixed(2)} 0L${(0.55 * R).toFixed(2)} 0"/></g>`; // fu/perf: a3-hub-mark (review r1) fu/perf end
  ctx.plane(part, { o, u: [1, 0, 0], v: [0, 0, 1], normal: [0, side, 0], svg, fade: [0.04, 0.3] });
}

/**
 * The BLG doors' swing (model metres): each door plate turned 0 → open about its hinge in 1° steps, a grid of points on
 * its faces against the six tyres of its bogie extended in flight (gear down, oleo at the flight stroke, the bogie
 * level). Returns the least clearance (negative: inside a tyre) of the outer door's two leaves and of the inner door
 * with its fold leaf (fu/f3-gear).
 */
export function blgSwing(k) {
  const b = BLG[k];
  const shift = mul(b.u, b.travel);
  const tyres = [];
  b.axles.forEach((x, i) => [-1, 1].forEach((sd) => tyres.push({ c: [x + shift[0], b.yc + sd * b.wheelY[i], RM + shift[2]], name: `${i + 1}.${sd * b.side < 0 ? "i" : "o"}` })));
  const outside = (p, t) => {
    const dr = Math.hypot(p[0] - t.c[0], p[2] - t.c[2]) - RM;
    const dy = Math.abs(p[1] - t.c[1]) - TYRE.main.w / 2;
    return dr > 0 && dy > 0 ? Math.hypot(dr, dy) : Math.max(dr, dy);
  };
  // fu/f3-gear: a door's fold leaf (a child door on the same gearDoors rule) turns in proportion and rides the door
  const axisOf = (d) => {
    const H = W.fromKit(d.hinge.point);
    const A = unit(sub(W.fromKit(add(d.hinge.point, d.hinge.axis)), H));
    // the plates are written closed; + opens (hingeOf), and the axis is the same in model and kit up to the frame
    const p = d.plates[0].pts.reduce((a, c) => (Math.hypot(...sub(c, H)) > Math.hypot(...sub(a, H)) ? c : a)); // off the axis
    const q = W.fromKit(rot(K(p), d.hinge.point, d.hinge.axis, 10));
    const r = rot(p, H, A, 10);
    return { H, A, sgn: Math.hypot(...sub(q, r)) < 1e-6 ? 1 : -1 };
  };
  const sweep = (d) => {
    const { H, A, sgn } = axisOf(d);
    const fold = DOORS.find((c) => c.fold && c.parent === d.group);
    const F = fold && axisOf(fold);
    let worst = Infinity;
    let at = "";
    for (const pl of [...d.plates, ...(fold ? fold.plates.map((q) => ({ ...q, fold: true })) : [])]) {
      const P = pl.pts;
      // the first and last stations (the plates are written station by station along x): bilinear between them
      const xs = P.map((q) => q[0]);
      const st0 = P.filter((q) => q[0] === Math.min(...xs));
      const st1 = P.filter((q) => q[0] === Math.max(...xs));
      const S = [];
      for (let i = 0; i <= 60; i++)
        for (let j = 0; j < st0.length; j++)
          for (let jj = j + 1; jj < st0.length; jj++)
            for (const f of [0, 0.5, 1]) {
              const a = lerp3(st0[j], st0[jj], f);
              const c = lerp3(st1[Math.min(j, st1.length - 1)], st1[Math.min(jj, st1.length - 1)], f);
              S.push(lerp3(a, c, i / 60));
            }
      for (let ang = 0; ang <= d.open + 1e-9; ang += 1)
        for (const p0 of S) {
          const p = pl.fold ? rot(p0, F.H, F.A, F.sgn * fold.open * (ang / d.open)) : p0;
          const q = rot(p, H, A, sgn * ang);
          for (const t of tyres) {
            const v = outside(q, t);
            if (v < worst) (worst = v), (at = t.name);
          }
        }
    }
    return { worst, at };
  };
  const out = sweep(DOORS.find((d) => d.group === `blg.${k}.door.out`));
  const dIn = DOORS.find((d) => d.group === `blg.${k}.door.in`);
  const inn = sweep(dIn);
  // fu/f3-gear: open, the inner door and its folded leaf stand beside the bogie's path as the leg moves (the bogie
  // stays level in transit, so the inner tyres keep their |y|): the margin from the pair's outboard reach to the
  // nearest inner tyre's face
  const { H, A, sgn } = axisOf(dIn);
  const fold = DOORS.find((c) => c.fold && c.parent === dIn.group);
  const F = fold && axisOf(fold);
  let reach = -Infinity;
  for (const p0 of dIn.plates.flatMap((q) => q.pts)) reach = Math.max(reach, Math.abs(rot(p0, H, A, sgn * dIn.open)[1]));
  if (fold) for (const p0 of fold.plates.flatMap((q) => q.pts)) reach = Math.max(reach, Math.abs(rot(rot(p0, F.H, F.A, F.sgn * fold.open), H, A, sgn * dIn.open)[1]));
  const face = Math.min(...b.wheelY.map((wy) => Math.abs(b.yc) - wy - TYRE.main.w / 2));
  return { out: out.worst, outAt: out.at, in: inn.worst, inAt: inn.at, openGap: face - reach };
}

/**
 * The NLG forward door held open at `ang` through the leg's transit (model metres): the least clearance of the right
 * door's plate to the right nose tyre over gear 0…1 in 0.01 steps (negative: inside the tyre). Item 9 of the follow-up:
 * the sourced 62° against the figure's 75°.
 */
export function nlgDoorSwing(ang) {
  const N = NLG;
  const Ay = [0, 1, 0];
  const s1 = rot([N.axle[0], 0, RN], N.H, Ay, 10)[0] < N.axle[0] ? 1 : -1; // the leg's sense that swings the axle forward
  const tyre = (g) => rot([N.axle[0], N.wheelY, RN], N.H, Ay, s1 * N.legAt(g));
  const outside = (p, c) => {
    const dr = Math.hypot(p[0] - c[0], p[2] - c[2]) - RN;
    const dy = Math.abs(p[1] - c[1]) - TYRE.nose.w / 2;
    return dr > 0 && dy > 0 ? Math.hypot(dr, dy) : Math.max(dr, dy);
  };
  const d = DOORS.find((q) => q.group === "nlg.door.fr");
  const H = W.fromKit(d.hinge.point);
  const A = unit(sub(W.fromKit(add(d.hinge.point, d.hinge.axis)), H));
  const P = d.plates[0].pts;
  const far = P.reduce((a, c) => (len(sub(c, H)) > len(sub(a, H)) ? c : a));
  const sgn = rot(far, H, A, 10)[2] < far[2] ? 1 : -1;
  const xs = [...new Set(P.map((q) => q[0]))];
  const S = [];
  for (let k = 0; k < xs.length - 1; k++) {
    const a = P.filter((q) => q[0] === xs[k]);
    const b = P.filter((q) => q[0] === xs[k + 1]);
    for (let i = 0; i <= 20; i++) for (let j = 0; j < a.length; j++) S.push(lerp3(a[j], b[j], i / 20));
  }
  const open = S.map((p) => rot(p, H, A, sgn * ang));
  let worst = Infinity;
  let at = 0;
  for (let g = 0; g <= 1.0001; g += 0.01) {
    const c = tyre(g);
    for (const q of open) {
      const v = outside(q, c);
      if (v < worst) (worst = v), (at = g);
    }
  }
  return { worst, at };
}

/** Assertions after T.build (--check); throw with a readable message. */
export function checks(ctx, out) {
  const { T, TURN, F: Fx } = ctx;
  const fail = [];
  const say = (line) => ctx.report(line);
  const groupInfo = T.groups.map((g) => ({ name: g.name, kind: g.kind, range: g.range, point: g.point, axis: g.axis }));
  const follow = Fx.makeFollow([{ group: "air", channel: "turn" }, { group: "lift", channel: "lift" }, { group: "pitch", channel: "pitch" }, ...MY_RULES], groupInfo, TURN);
  const base = (extra) => W.groundChannels(extra);
  const posed = (ch) => {
    const cams = TURN.cams(out.scene, follow(base(ch)));
    return (part) => {
      const g = part.group;
      const cam = g ? cams[g.index] : null;
      const toW = (p) => (cam ? add(TURN.rotateVec ? TURN.rotateVec(cam.R, sub(p, g.origin)) : [0, 1, 2].map((r) => cam.R[3 * r] * (p[0] - g.origin[0]) + cam.R[3 * r + 1] * (p[1] - g.origin[1]) + cam.R[3 * r + 2] * (p[2] - g.origin[2])), cam.t) : p);
      const dirW = (d) => (cam ? [0, 1, 2].map((r) => cam.R[3 * r] * d[0] + cam.R[3 * r + 1] * d[1] + cam.R[3 * r + 2] * d[2]) : d);
      return { toW, dirW };
    };
  };
  const tyres = T.parts.filter((p) => /^(nlg|wlg|blg)\..*tyre/.test(p.name));
  // 1. 22 tyres at the GEAR positions (centre of the tread, model metres)
  const want = [];
  want.push(...[-1, 1].map((sd) => ({ name: `nlg.tyre.${sd < 0 ? "l" : "r"}`, c: [G.nose.axle[0], sd * NLG.wheelY, RN] })));
  for (const w of Object.values(WLG)) w.axles.forEach((x, i) => [["i", -w.side], ["o", w.side]].forEach(([k, sd]) => want.push({ name: `wlg.${w.s}.tyre.${i + 1}.${k}`, c: [x, w.centre[1] + sd * w.wheelY, RM] })));
  for (const b of Object.values(BLG)) b.axles.forEach((x, i) => [["i", -b.side], ["o", b.side]].forEach(([k, sd]) => want.push({ name: `blg.${b.s}.tyre.${i + 1}.${k}`, c: [x, b.yc + sd * b.wheelY[i], RM] })));
  let posWorst = 0;
  for (const wt of want) {
    const part = T.parts.find((p) => p.name === wt.name);
    if (!part) {
      fail.push(`missing tyre ${wt.name}`);
      continue;
    }
    const F = part.world.F;
    const c = W.fromKit(add(F.o, mul(F.a, (part.world.s0 + part.world.s1) / 2)));
    posWorst = Math.max(posWorst, Math.hypot(c[0] - wt.c[0], c[1] - wt.c[1], c[2] - wt.c[2]));
  }
  (want.length === 22 && tyres.length === 22 && posWorst <= 0.01 ? say : fail.push.bind(fail))(`tyres: ${tyres.length} built, ${want.length} expected, largest offset from GEAR ${posWorst.toFixed(4)} m`);
  // 2. contact: the lowest point of every tyre (analytic: support of the cylinder in −z) at 0 ± 0.05 units
  const lowest = (ch, list) => {
    const P = posed(ch);
    let lo = Infinity;
    let hi = -Infinity;
    let who = null;
    for (const part of list) {
      const { toW, dirW } = P(part);
      const F = part.world.F;
      const a = unit(dirW(F.a));
      const c = toW(add(F.o, mul(F.a, (part.world.s0 + part.world.s1) / 2)));
      const h = (part.world.s1 - part.world.s0) / 2;
      const r = part.world.r0 ?? part.world.r ?? m(RM);
      const z = c[2] - h * Math.abs(a[2]) - r * Math.sqrt(Math.max(0, 1 - a[2] * a[2]));
      if (z < lo) lo = z;
      if (z > hi) (hi = z), (who = part.name);
    }
    return { lo, hi, who };
  };
  const rOf = (p) => p.world.r ?? p.world.r0;
  void rOf;
  let worstRest = 0;
  {
    const q = lowest({}, tyres);
    worstRest = Math.max(Math.abs(q.lo), Math.abs(q.hi));
  }
  let worstSteer = 0;
  for (let st = -70; st <= 70; st += 5) {
    const q = lowest({ steer: st }, tyres);
    worstSteer = Math.max(worstSteer, Math.abs(q.lo), Math.abs(q.hi));
  }
  let worstRot = 0;
  let worstRotAt = 0;
  const onGround = tyres.filter((p) => /^blg\./.test(p.name) || /^wlg\..*tyre\.2\./.test(p.name));
  for (let r = 0; r <= 10.5 + 1e-9; r += 0.5) {
    const q = lowest({ pitch: r, rot: r }, onGround);
    const e = Math.max(Math.abs(q.lo), Math.abs(q.hi));
    if (e > worstRot) (worstRot = e), (worstRotAt = r);
  }
  // the WLG front axle lifts off as the bogie tilts; it must not go below the runway
  let frontLow = Infinity;
  for (let r = 0; r <= 12.5; r += 0.5) frontLow = Math.min(frontLow, lowest({ pitch: r, rot: r }, tyres.filter((p) => /^wlg\..*tyre\.1\./.test(p.name))).lo);
  const okC = worstRest <= 0.05 && worstSteer <= 0.05 && worstRot <= 0.05 && frontLow >= -0.05;
  (okC ? say : fail.push.bind(fail))(`tyre contact (kit units): rest ±${worstRest.toFixed(4)}, steer −70…70 ±${worstSteer.toFixed(4)}, on-ground pitch 0…10.5 (all six BLG, WLG aft axle) ±${worstRot.toFixed(4)} (worst at ${worstRotAt}°), WLG front axle lowest ${frontLow.toFixed(3)}`);
  // 3. stays: closure of the tabulated 4-bars
  for (const st of [NLG.stay, ...Object.values(WLG).map((w) => w.stay), ...Object.values(BLG).map((b) => b.stay)]) (st.closure <= 0.005 ? say : fail.push.bind(fail))(`${st.name}: links ${(st.L1 / 10).toFixed(3)} + ${(st.L2 / 10).toFixed(3)} m, 33 knots on gear, closure ${st.closure.toFixed(4)} m`);
  // 4. stowed: every tyre inside its bay (W.BAYS), clearance ≥ 0.025 m; the gear up in flight
  {
    const P = posed({ lift: 60, pitch: 9, trim: 1, gear: 0, gearDoors: 0 });
    const bays = { nlg: W.BAYS.nlg, "wlg.l": W.BAYS.wlg(-1), "wlg.r": W.BAYS.wlg(1), blg: W.BAYS.blg };
    const res = {};
    for (const part of tyres) {
      const key = part.name.startsWith("nlg") ? "nlg" : part.name.startsWith("blg") ? "blg" : part.name.slice(0, 5);
      const { toW, dirW } = P(part);
      // undo the pitch and lift (bays are in the airframe frame): pose with pitch 0 for the bay test
      void toW;
      void dirW;
      res[key] ??= Infinity;
    }
    const P0 = posed({ lift: 0, pitch: 0, trim: 1, gear: 0, gearDoors: 0, rot: 0 });
    for (const part of tyres) {
      const key = part.name.startsWith("nlg") ? "nlg" : part.name.startsWith("blg") ? "blg" : part.name.slice(0, 5);
      const { toW, dirW } = P0(part);
      const F = part.world.F;
      const a = unit(dirW(F.a));
      const c = toW(add(F.o, mul(F.a, (part.world.s0 + part.world.s1) / 2)));
      const h = (part.world.s1 - part.world.s0) / 2;
      const r = part.world.r0 ?? part.world.r;
      let depth = -Infinity;
      for (const hs of bays[key].halfSpaces) {
        const n = [-hs.n[0], hs.n[1], hs.n[2]];
        const d = 10 * (hs.d - 41.3 * hs.n[0]);
        const sup = dot(n, c) + h * Math.abs(dot(n, a)) + r * Math.sqrt(Math.max(0, 1 - dot(n, a) ** 2));
        depth = Math.max(depth, sup - d);
      }
      res[key] = Math.min(res[key], -depth / 10);
    }
    const okS = Object.values(res).every((v) => v >= 0.025);
    (okS ? say : fail.push.bind(fail))(`stowed tyres inside W.BAYS (clearance m): ${Object.entries(res).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(", ")}`);
  }
  // 5. signs: + is the natural sense
  {
    const at = (ch, name, p) => posed(ch)(T.parts.find((q) => q.name === name)).toW(p);
    const ax = (name) => {
      const part = T.parts.find((q) => q.name === name);
      return add(part.world.F.o, mul(part.world.F.a, (part.world.s0 + part.world.s1) / 2));
    };
    const fly = { lift: 60, pitch: 0, trim: 1, gearDoors: 1 };
    const n0 = W.fromKit(at({ ...fly, gear: 1 }, "nlg.axle", ax("nlg.axle")));
    const n1 = W.fromKit(at({ ...fly, gear: 0.7 }, "nlg.axle", ax("nlg.axle")));
    const w0 = W.fromKit(at({ ...fly, gear: 1 }, "wlg.r.axle.1", ax("wlg.r.axle.1")));
    const w1 = W.fromKit(at({ ...fly, gear: 0.7 }, "wlg.r.axle.1", ax("wlg.r.axle.1")));
    const b0 = W.fromKit(at({ ...fly, gear: 1 }, "blg.r.axle.1", ax("blg.r.axle.1")));
    const b1 = W.fromKit(at({ ...fly, gear: 0.7 }, "blg.r.axle.1", ax("blg.r.axle.1")));
    const s0 = W.fromKit(at({ steer: 30 }, "nlg.tyre.r", ax("nlg.tyre.r")));
    const okSign = n1[0] < n0[0] && n1[2] > n0[2] && w1[1] < w0[1] && b1[0] > b0[0] && s0[0] > G.nose.axle[0];
    (okSign ? say : fail.push.bind(fail))(`signs: NLG retracts forward (Δx ${(n1[0] - n0[0]).toFixed(2)} m), WLG R inboard (Δy ${(w1[1] - w0[1]).toFixed(2)}), BLG aft (Δx ${(b1[0] - b0[0]).toFixed(2)}); steer +30 swings the right nose tyre aft (Δx ${(s0[0] - G.nose.axle[0]).toFixed(2)} m): kit +z axis, a + steer turns the wheels to starboard`);
  }
  // 6. the wing-gear solve as built (S's W.WLG_SOLVE is provisional)
  for (const w of Object.values(WLG)) say(`WLG ${w.s}: pintle (${w.H.map((v) => v.toFixed(3)).join(", ")}), axis model ${w.side > 0 ? "+x" : "−x"} (kit [${w.axis}]), θW ${w.theta}°, leg ${len(sub(w.P, w.H)).toFixed(3)} m to the bogie pivot, oleo 0…${w.travel} m (flight ${w.flight}), bogie trim 0, stay airframe pin (${w.Am.map((v) => v.toFixed(2)).join(", ")}), lug at 0.42 of the leg`);
  for (const b of Object.values(BLG)) say(`BLG ${b.s}: trunnion (${b.H.map((v) => v.toFixed(3)).join(", ")}), θB ${b.theta}°, leg ${len(sub(b.P, b.H)).toFixed(3)} m, retraction shortening up to ${b.short.toFixed(3)} m (two-phase), oleo flight stroke ${b.travel} m`);
  say(`NLG: hinge (${NLG.H.join(", ")}), θN ${NLG.theta}°, collar top z ${NLG.C[2]}, drag stay pin on the ceiling (3.90, 0, 4.75)`);
  // 7. door timing (GEAR.timing): retraction 16 s, extension 18 s
  const tl = (up) => (up ? [0, 1.5, 3, 8, 13, 14.5, 16] : [0, 1.5, 3, 5, 8, 14, 16, 18, 20]).map((t) => { const q = gearSequence(t, up); return `${t}s leg ${q.gear.toFixed(2)}${q.gearBody !== q.gear ? ` BLG ${q.gearBody.toFixed(2)}` : ""} doors ${q.gearDoors.toFixed(2)}`; }).join(" · ");
  say(`door timing up: ${tl(true)}`);
  say(`door timing down: ${tl(false)}`);
  const kinds = (pred) => [...new Set(DOORS.filter(pred).map((d) => d.group.replace(/\.(l|r)(\.|$)/, "$2").replace(/(f|a)(l|r)$/, "$1")))].join(", ");
  say(`doors on gearDoors (hydraulic): ${kinds((d) => !d.linked && !d.held && !d.fold)}; fold leaves riding their door on gearDoors: ${kinds((d) => d.fold) || "none"}${DOORS.some((d) => d.held) ? `; on gearDoors and held open by the body gear's leg out of the bay: ${DOORS.filter((d) => d.held).map((d) => `${kinds((e) => e === d)} (gearBody ≥ ${d.linkAt})`).filter((v, i, a) => a.indexOf(v) === i).join(", ")}` : ""}; on gear (leg-linked, closed at gear 0): ${DOORS.filter((d) => d.linked).map((d) => `${kinds((e) => e === d)} open by gear ${d.linkAt ?? 0.35}`).filter((v, i, a) => a.indexOf(v) === i).join(", ")}`);
  // 8. the body gear's extension lag (model GEAR.timing.extend.bodyLag, truth §9): the first moment each leg moves
  {
    const start = (key, up) => {
      for (let t = 0; t <= 30; t += 0.01) {
        const q = gearSequence(t, up);
        if (up ? q[key] < 1 - 1e-9 : q[key] > 1e-9) return t;
      }
      return NaN;
    };
    const dExt = start("gearBody", false) - start("gear", false);
    const dRet = start("gearBody", true) - start("gear", true);
    const okLag = Math.abs(dExt - G.timing.extend.bodyLag) <= 0.02 && Math.abs(dRet) <= 0.02;
    (okLag ? say : fail.push.bind(fail))(`BLG legs start ${dExt.toFixed(1)} s after the WLG on extension (the doors close once they lock: extension ${gearSequence(0, false).total} s), ${dRet.toFixed(1)} s on retraction`);
  }
  // 9. the BLG doors' swing against the extended tyres in flight (oleo at the flight stroke): both close after
  //    extension and must clear them (fu/f3-gear: the inner door with its fold leaf)
  for (const k of ["l", "r"]) {
    const sw = blgSwing(k);
    const okSw = sw.out >= 0.05 && sw.in >= 0.05 && sw.openGap >= 0.03;
    (okSw ? say : fail.push.bind(fail))(`BLG ${k} door swing over 0…open against the extended tyres in flight: outer door ${sw.out.toFixed(3)} m clear (bottom leaf to |y| ${BLG_OUT_FREE}); inner door ${sw.in.toFixed(3)} m clear with its fold leaf (|y| ${BLG_IN_FOLD} → 2.4, ${BLG_IN_FOLD_OPEN}° at the door's 94°; nearest tyre ${sw.inAt}); open, the pair stands ${sw.openGap.toFixed(3)} m inboard of the inner tyres' faces as the gear moves`);
  }
  // 10. the NLG forward doors' angle (follow-up item 9): the sourced 62° against the figure's 75°
  {
    const d = DOORS.find((q) => q.group === "nlg.door.fr");
    const at = (a) => nlgDoorSwing(a);
    const [a62, a70, a72, aOpen] = [62, 70, 72, d.open].map(at);
    (aOpen.worst >= 0.03 ? say : fail.push.bind(fail))(`NLG forward door held open through the transit, least clearance to the nose tyre: 62° ${a62.worst.toFixed(3)} m (at gear ${a62.at.toFixed(2)}), 70° ${a70.worst.toFixed(3)}, 72° ${a72.worst.toFixed(3)}, ${d.open}° (built) ${aOpen.worst.toFixed(3)} m`);
  }
  if (fail.length) throw new Error(fail.join("; "));

}
