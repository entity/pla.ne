// a380/parts/tail.mjs (M2): Tail: tail shell lofts, fin, rudders, tailplanes, elevators, APU, tail lights.
//
// Contract: a380/notes/CONTRACT.md. Design: a380/DESIGN.md §3.1, §5.1, §5.3, §9 (M2). Notes: a380/notes/modules/M2.md.
//
// Shell (W.SHELL via W.loft, smooth ring-loft hulls): tail.aft 46.5–52.25, tail.cone 52.25–66 (one segment: its
// crown facet and main-belt facets are planes), tail.tip 66–70.4 (tapered to the APU exhaust end).
// Empennage, all derived from M.EMPENNAGE (model metres) and the cone's planes:
//   - fin (tail.fin.lo / .up, split at z 14.45, symmetric NACA t/c 0.08): root ring in the cone's crown-facet
//     plane from (53.94, 10.569); LE to (68.02, 24.06); full chord 12.06 at the root, 4.70 at the tip. Its TE face
//     is the plane tangent to the rudder's nose cone (below), so the rudder turns against it without touching.
//   - rudders (tail.rudder.lo / .up on groups rudder.lo / rudder.up, ±30°): the nose is a half-cone about the
//     hinge line (62.55, 0, 9.94) → (71.42, 0, 24.08), its radius the fin's half-thickness at the TE face; the
//     lower rudder's foot is parallel to the crown facet, the split between the rudders is perpendicular to the
//     hinge (W.GAP apart), the upper rudder's top is level with the fin tip.
//   - tailplanes (tail.htp.{l,r}.{in,out,tip}, flat bottom, t/c 0.09): root ring in the cone's main-belt facet
//     plane; split at y 5.46; the fixed part ends on the plane tangent to the elevators' nose cone about the hinge
//     (64.78, ±1.63) → (70.57, ±13.64), which sits on the flat bottom's plane at the nose radius (the mid-plane).
//   - elevators (tail.elev.{l,r}.{in,out} on groups elev.{l,r}.{in,out}, −30…20, + TE down), streamwise ends.
//   - dorsal fillet, fin tip cap, APU exhaust blade and nozzle, tail nav light, tail strobe, logo lights.
// Boundaries: x 46.5 with M6 (flush; fus.UY.crown on cut.up keeps W.GAP). Every cross-group contact keeps W.GAP
// except the hinge noses (tangent to the fixed TE faces).

import { add, sub, mul, dot, cross, unit, len, lerp3, f2, frameOf, pathOf, planeM, rrect, faceNear, ontoFace, linePlaneKit, newell } from "./nose.mjs";
import { convexHull3 } from "../../kit/hull3.mjs";

/**
 * The normals (kit) of the hull faces of these rings that point within `deg` of any of `dirs` (kit): passed as
 * T.hull's `flatNormals`, they shade the flat body of a control surface flat and leave its nose cone smooth (a
 * smooth face whose corner normals vary one way only lets a band sweep it in one step: the halving test).
 */
const flatFaces = (rings, dirs, deg = 25) => {
  const c = Math.cos((deg * Math.PI) / 180);
  return convexHull3(rings.flat(), { name: "flat" }).faces.map((f) => f.n).filter((n) => dirs.some((d) => dot(unit(d), n) > c));
};

export const id = "tail";
export const owner = "M2";
export const title = "Tail: tail shell lofts, fin, rudders, tailplanes, elevators, APU, tail lights";
/** Every part name this module creates starts with one of these (the harness enforces it). */
export const prefixes = ["tail.", "light.navTail", "light.strobeTail", "light.logo", "rudder.", "elev."];
/** true: the harness builds stubs.mjs's stand-in instead of build(). */
export const stub = false;

const D2R = Math.PI / 180;
const Y = [0, 1, 0];
/** Rodrigues: p rotated by deg about the line through a along unit w. */
export const rotAbout = (p, a, w, deg) => {
  const t = deg * D2R;
  const v = sub(p, a);
  const c = Math.cos(t);
  const s = Math.sin(t);
  return add(a, add(add(mul(v, c), mul(cross(w, v), s)), mul(w, dot(w, v) * (1 - c))));
};
const interp = (table, x) => {
  if (x <= table[0][0]) return table[0][1] + ((table[1][1] - table[0][1]) * (x - table[0][0])) / (table[1][0] - table[0][0]);
  for (let i = 1; i < table.length; i++) if (x <= table[i][0]) return table[i - 1][1] + ((table[i][1] - table[i - 1][1]) * (x - table[i - 1][0])) / (table[i][0] - table[i - 1][0]);
  const n = table.length;
  return table[n - 2][1] + ((table[n - 1][1] - table[n - 2][1]) * (x - table[n - 2][0])) / (table[n - 1][0] - table[n - 2][0]);
};
/** NACA 4-digit half thickness over chord at ξ for t/c t. */
const naca = (xi, t) => 5 * t * (0.2969 * Math.sqrt(Math.max(0, xi)) - 0.126 * xi - 0.3516 * xi * xi + 0.2843 * xi ** 3 - 0.1015 * xi ** 4);
/** Clip a planar 3D polygon by n·p ≥ d (Sutherland–Hodgman). */
const clipKeep = (poly, n, d) => {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const sa = dot(n, a) - d;
    const sb = dot(n, b) - d;
    if (sa >= 0) out.push(a);
    if ((sa >= 0) !== (sb >= 0)) out.push(lerp3(a, b, sa / (sa - sb)));
  }
  return out;
};
/** Convex hull (2D, CCW) of planar 3D points in the frame { o, u, v }: keeps only hull vertices, in order. */
const hullIn = (pts, fr) => {
  const q = pts.map((p, i) => ({ p, x: dot(sub(p, fr.o), fr.u), y: dot(sub(p, fr.o), fr.v), i }));
  q.sort((a, b) => a.x - b.x || a.y - b.y);
  const crossz = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of q) {
    while (lower.length >= 2 && crossz(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of q.slice().reverse()) {
    while (upper.length >= 2 && crossz(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map((e) => e.p);
};

// ---------------------------------------------------------------------------------------------
// the analytic empennage (model metres), computed once from W and M
// ---------------------------------------------------------------------------------------------
let GEO = null;
export function geometry(W, M) {
  if (GEO) return GEO;
  const E = M.EMPENNAGE;
  const G = { E };
  // ---- the cone's crown facet plane (normal up and aft) and its main-belt facet planes ----
  const crownZ = (x) => W.ring2(x)[15][1];
  const C0 = [52.25, 0, crownZ(52.25)];
  const C1 = [66, 0, crownZ(66)];
  const nC = unit(cross(Y, sub(C1, C0)));
  G.crown = { n: nC[2] > 0 ? nC : mul(nC, -1), d: 0, z: crownZ };
  G.crown.d = dot(G.crown.n, C0);
  /** The point of the crown plane above (x, ·). */
  G.crownAt = (x) => [x, 0, C0[2] + ((C1[2] - C0[2]) * (x - C0[0])) / (C1[0] - C0[0])];
  G.belt = (side) => {
    const r0 = W.ring2(52.25);
    const r1 = W.ring2(66);
    const P = (x, q) => [x, side * q[0], q[1]];
    const a = P(52.25, r0[7]);
    const b = P(52.25, r0[8]);
    const c = P(66, r1[7]);
    let n = unit(cross(sub(b, a), sub(c, a)));
    if (n[1] * side < 0) n = mul(n, -1);
    return { n, d: dot(n, a) };
  };

  // ---- fin: LE and TE lines, thickness, rudder cone, TE face plane ----
  const L0 = G.crownAt(E.fin.rootLE[0]);
  const L1 = E.fin.tipLE.slice();
  const T0 = G.crownAt(E.fin.rootLE[0] + E.fin.rootChord);
  const T1 = [E.fin.tipLE[0] + E.fin.tipChord, 0, E.fin.tipLE[2]];
  const TC = 0.08;
  const xLE = (z) => L0[0] + ((L1[0] - L0[0]) * (z - L0[2])) / (L1[2] - L0[2]);
  const xTE = (z) => T0[0] + ((T1[0] - T0[0]) * (z - T0[2])) / (T1[2] - T0[2]);
  const [H0x, H0z] = E.fin.rudderHinge[0];
  const [H1x, H1z] = E.fin.rudderHinge[1];
  const H0 = [H0x, 0, H0z];
  const H1 = [H1x, 0, H1z];
  const w = unit(sub(H1, H0));
  const f = unit([-w[2], 0, w[0]]); // perpendicular to the hinge in the fin plane, forward and up
  const radiusAt = (P) => {
    // the fin's half-thickness at the TE face (just ahead of the hinge), from the horizontal section through P
    const c = xTE(P[2]) - xLE(P[2]);
    let r = 0.3;
    for (let i = 0; i < 12; i++) r = naca((P[0] - r / Math.abs(f[0]) - xLE(P[2])) / c, TC) * c;
    return r;
  };
  const rr0 = radiusAt(H0);
  const rr1 = radiusAt(H1);
  const Lr = len(sub(H1, H0));
  const rp = (rr1 - rr0) / Lr;
  const alpha = Math.atan(-rp);
  const nT = unit(add(mul(f, Math.cos(alpha)), mul(w, Math.sin(alpha)))); // forward: the fin is on n·p ≥ d
  const dT = dot(nT, H0) + rr0 * Math.cos(alpha);
  const cone = { a: H0, w, r0: rr0, r1: rr1, L: Lr, rp, c: (s) => add(H0, mul(w, s)), r: (s) => rr0 + rp * s };
  /** The touch line of the TE face: generator point at axial s. */
  const gen = (s) => add(cone.c(s), mul(f, cone.r(s)));
  /** Axial s where the generator meets the plane n·p = d. */
  const genOnPlane = (n, d) => (d - dot(n, H0) - rr0 * dot(n, f)) / (dot(n, w) + rp * dot(n, f));
  G.fin = { L0, L1, T0, T1, TC, xLE, xTE, cone, f, nT, dT, gen, genOnPlane, split: 14.45, tipZ: E.fin.tipLE[2] };
  // fin rings: the root in the crown plane, then horizontal sections; points from ξ 0 to the TE face corners
  const XI = [0, 0.01, 0.03, 0.07, 0.15, 0.3, 0.45, 0.62];
  const finRing = (kind, z) => {
    let s;
    let pt;
    let chordFrom;
    if (kind === "root") {
      s = genOnPlane(G.crown.n, G.crown.d);
      chordFrom = (xi) => G.crownAt(L0[0] + xi * E.fin.rootChord);
      pt = { c: E.fin.rootChord };
    } else {
      s = (z - H0[2] - rr0 * f[2]) / (w[2] + rp * f[2]);
      const c = xTE(z) - xLE(z);
      chordFrom = (xi) => [xLE(z) + xi * c, 0, z];
      pt = { c };
    }
    const g = gen(s);
    const r = cone.r(s);
    const right = [];
    for (const xi of XI) {
      const p = chordFrom(xi);
      if (p[0] > g[0] - 0.08) break;
      right.push({ xi, p: add(p, mul(Y, naca(xi, TC) * pt.c)) });
    }
    const corner = add(g, mul(Y, r));
    // the ring: LE, the right side aft, the TE face (two corners), the left side forward
    const pts = [right[0].p, ...right.slice(1).map((e) => e.p), corner, add(g, mul(Y, -r)), ...right.slice(1).reverse().map((e) => [e.p[0], -e.p[1], e.p[2]])];
    return { pts, xis: right.map((e) => e.xi), g, r, s };
  };
  G.fin.ring = finRing;

  // ---- tailplane: plan tables, flat bottom plane, airfoil ----
  const TP = E.tailplane;
  // the plan tables are [x, y] pairs: key them on y
  const leByY = TP.le.map(([x, y]) => [y, x]);
  const teByY = TP.te.map(([x, y]) => [y, x]);
  const LE = (y) => interp(leByY, Math.abs(y));
  const TE = (y) => interp(teByY, Math.abs(y));
  const chord = (y) => TE(y) - LE(y);
  const TT = 0.09;
  const tipY = TP.tipLE[1];
  const ZRB = 7.25; // root bottom at |y| 2.37 [E]: fits the main-belt facet (M2.md)
  const YRB = 2.37;
  const ZTB = TP.tipZ - (TT * TP.tipChord) / 2; // the tip's mid-surface at the sourced 9.175
  const sb = (ZTB - ZRB) / (tipY - YRB);
  const zb = (y) => ZRB + sb * (Math.abs(y) - YRB);
  // flat-bottom airfoil (W.WING's, with the rear-spar point added at ξ 0.62)
  const TOP = [[0, 0.42], [0.01, 0.62], [0.03, 0.78], [0.07, 0.9], [0.12, 0.97], [0.25, 1.0], [0.4, 0.97], [0.55, 0.86], [0.7, 0.62], [0.8, 0.45], [0.9, 0.26], [1.0, 0.06]];
  const topOf = (xi) => {
    const top = TOP;
    for (let i = 1; i < top.length; i++) if (xi <= top[i][0]) return top[i - 1][1] + ((top[i][1] - top[i - 1][1]) * (xi - top[i - 1][0])) / (top[i][0] - top[i - 1][0]);
    return top[top.length - 1][1];
  };
  // the ring points: a thinned set of the same profile (front and rear spar at ξ 0.12 and 0.62)
  const FOIL = [[0.025, 0], [0.006, 0.12], [0, 0.42], [0.02, 0.7], [0.06, 0.88], [0.12, 0.97], [0.25, 1.0], [0.4, 0.97], [0.62, 0.0], [0.8, 0.45], [1.0, 0.06], [1.0, 0]].map(([xi, z]) => (xi === 0.62 ? [xi, topOf(xi)] : [xi, z]));
  const foilPt = (xi, zeta, y) => [LE(y) + xi * chord(y), y, zb(y) + zeta * TT * chord(y)];
  G.htp = { LE, TE, chord, TT, tipY, zb, sb, FOIL, topOf, foilPt, split: 5.46 };
  // ---- elevator cone per side: hinge plan line, radii from the TE face thickness, axis on the mid-plane ----
  G.elev = (side, { aft = 0 } = {}) => {
    const [[e0x, e0y], [e1x, e1y]] = TP.elevatorHinge;
    const nBd = unit([0, side * sb, -1]); // the flat bottom's outward (down) normal
    const dBd = dot(nBd, [0, side * YRB, ZRB]);
    const rAt = (x, y) => {
      const c = chord(y);
      let r = 0.2;
      for (let i = 0; i < 12; i++) r = 0.5 * topOf((x - r * 1.05 - LE(y)) / c) * TT * c;
      return r;
    };
    const r0 = rAt(e0x, e0y);
    const r1 = rAt(e1x, e1y);
    let A = [e0x, side * e0y, zb(e0y) + r0];
    let B = [e1x, side * e1y, zb(e1y) + r1];
    for (let i = 0; i < 20; i++) {
      const wv = unit(sub(B, A));
      const k = Math.sqrt(Math.max(0, 1 - dot(nBd, wv) ** 2));
      A = [A[0], A[1], A[2] + (dot(nBd, A) + r0 * k - dBd) / -nBd[2]];
      B = [B[0], B[1], B[2] + (dot(nBd, B) + r1 * k - dBd) / -nBd[2]];
    }
    const we = unit(sub(B, A));
    const L = len(sub(B, A));
    const rpe = (r1 - r0) / L;
    const beta = Math.atan(-rpe);
    const mB = unit(sub(nBd, mul(we, dot(nBd, we)))); // down, perpendicular to the hinge
    let mT = unit(cross(we, mB));
    if (mT[0] > 0) mT = mul(mT, -1); // forward
    const nT = unit(add(mul(we, Math.sin(beta)), mul(mT, Math.cos(beta)))); // the fixed part is on n·p ≥ d
    const dT = dot(nT, A) + r0 * Math.cos(beta);
    // follow-up item 23: { aft } moves the hinge line and the nose cone aft (−mT) off the fixed TE face, which stays
    // tangent to the unmoved cone; at W.GAP the elevator at 0 no longer touches the tailplane in a plane (the painter's
    // tie between tail.htp.r.in and tail.elev.r.in at turn 220)
    if (aft) {
      A = add(A, mul(mT, -aft));
      B = add(B, mul(mT, -aft));
    }
    const c = (s) => add(A, mul(we, s));
    const r = (s) => r0 + rpe * s;
    /** The nose point at axial s and angle φ (−90 bottom, 0 front, 90 top). */
    const nose = (s, phi) => add(c(s), mul(add(mul(mT, Math.cos(phi * D2R)), mul(mB, -Math.sin(phi * D2R))), r(s)));
    /** Axial s where the nose generator at φ meets the plane y = y0. */
    const sAtY = (phi, y0) => {
      const m = add(mul(mT, Math.cos(phi * D2R)), mul(mB, -Math.sin(phi * D2R)));
      return (y0 - A[1] - r0 * m[1]) / (we[1] + rpe * m[1]);
    };
    return { side, A, B, w: we, L, r0, r1, rp: rpe, mB, mT, nT, dT, nBd, dBd, c, r, nose, sAtY };
  };
  GEO = G;
  return G;
}

// ---------------------------------------------------------------------------------------------
// groups: rudders and elevators (DESIGN §3.1, §3.3)
// ---------------------------------------------------------------------------------------------
/** The kit hinge axis for a model axis, signed so +deg moves `probe` (model) along `want` (model). */
function signedAxis(ctx, a, w, probe, want) {
  const { W, TURN } = ctx;
  const k = W.kitDir(w);
  const R = TURN.rotation(k, 10);
  const v = W.kitDir(sub(probe, a));
  const q = [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
  const moved = W.kitDir(sub(q, v));
  return dot(moved, want) > 0 ? k : mul(k, -1);
}

export function groups(ctx) {
  const { W, M } = ctx;
  const G = geometry(W, M);
  const cone = G.fin.cone;
  const teTop = [G.fin.T1[0], 0, G.fin.T1[2]];
  const rudderAxis = signedAxis(ctx, cone.a, cone.w, teTop, [0, 1, 0]); // + yaw: TE to starboard
  for (const name of ["rudder.lo", "rudder.up"]) {
    ctx.group(name, { parent: "pitch", hinge: { point: W.kit(cone.a), axis: rudderAxis, range: [-30, 30] } });
    ctx.rule({ group: name, channel: "yaw", table: [[-1, -30], [1, 30]] });
  }
  for (const [s, side] of W.SIDES) {
    const e = G.elev(side, { aft: ELEV_AFT(W) });
    const te = [G.htp.TE(8), side * 8, G.htp.zb(8)];
    const axis = signedAxis(ctx, e.A, e.w, te, [0, 0, -1]); // + TE down
    for (const part of ["in", "out"]) {
      const name = `elev.${s}.${part}`;
      ctx.group(name, { parent: "pitch", hinge: { point: W.kit(e.A), axis, range: [-30, 20] } });
      ctx.rule({ group: name, channel: "pitchCmd", table: [[-1, -30], [0, 0], [1, 20]] });
    }
  }
}

// parts kept for checks()
const BUILT = {};
// follow-up item 23 (not fixed, a380/notes/followup/wings.md): moving the elevators' hinge and nose aft of the fixed TE
// face by W.GAP (12 mm) or W.GAP/2 made the browser order check at turn 220 (elevators at 0) worse (three pairs, one with
// the platter, instead of one), so the elevators stay tangent to the TE face (offset 0)
const ELEV_AFT = (W) => 0 * W.GAP;

export function build(ctx) {
  const { W, M } = ctx;
  const kit = W.kit;
  const G = geometry(W, M);
  const GAP = W.GAP;
  const E = G.E;

  // ---- shell -----------------------------------------------------------------------------------
  const aft = ctx.hull({ name: "tail.aft", group: "pitch", ...W.loft("tail.aft"), tone: "hi" });
  const cone = ctx.hull({ name: "tail.cone", group: "pitch", ...W.loft("tail.cone"), tone: "hi" });
  const tip = ctx.hull({ name: "tail.tip", group: "pitch", ...W.loft("tail.tip"), tone: "hi" });
  void aft;
  BUILT.cone = cone;
  BUILT.tip = tip;

  // near-flat faces (corner normals within 5° of their own) shade flat with the kit's crossfaded staircase: on a
  // smooth face that flat, a tone band can sweep the whole face in one step (the quick audit's halving test)
  const FLAT = 5;
  // a model plane n·p = d as a kit joint (W.kit mirrors x about the pivot): review round 3, the fixed surfaces' faces
  // where the rudders and elevators meet them are mid gap lines, not hi outlines
  const jointOf = (n, d, tone = "mid") => ({ n: [-n[0], n[1], n[2]], d: 10 * (d - W.PIVOT_X * n[0]), tone });

  // ---- fin ---------------------------------------------------------------------------------------
  const F = G.fin;
  const rRoot = F.ring("root");
  const rSplit = F.ring("z", F.split);
  const rTop = F.ring("z", F.tipZ);
  // joints (kit patch 15): the fin's root, its lo/up split and the tip cap are one skin, drawn as faint seams
  const finLo = ctx.hull({ name: "tail.fin.lo", group: "pitch", rings: [rRoot.pts, rSplit.pts].map((r) => r.map(kit)), smooth: true, sharp: 40, flatAngle: FLAT, tone: "hi", jointCaps: { first: "faint", last: "faint" }, joints: [jointOf(F.nT, F.dT)] });
  const finUp = ctx.hull({ name: "tail.fin.up", group: "pitch", rings: [rSplit.pts, rTop.pts].map((r) => r.map(kit)), smooth: true, sharp: 40, flatAngle: FLAT, tone: "hi", jointCaps: { first: "faint", last: "faint" }, joints: [jointOf(F.nT, F.dT)] });
  BUILT.fin = [finLo, finUp];
  // fin tip cap: up to the aircraft's 24.145 m, inside the fin's top face (ahead of the TE face)
  {
    // the cap sits on the fixed fin only: its base keeps 0.05 m and more ahead of the TE face (clear of the rudder)
    const top = rTop.pts.filter((p) => dot(F.nT, p) - F.dT > 0.05);
    const c = mul(top.reduce((acc, p) => add(acc, p), [0, 0, 0]), 1 / top.length);
    const ring = (k, kx, dz) => top.filter((_, i) => i % 2 === 0).map((p) => [c[0] + (p[0] - c[0]) * kx, p[1] * k, p[2] + dz]);
    ctx.hull({ name: "tail.fin.cap", group: "pitch", rings: [top, ring(0.8, 0.97, 0.05), ring(0.45, 0.9, E.fin.tipZ - F.tipZ)].map((r) => r.map(kit)), smooth: true, sharp: 40, tone: "hi", jointCaps: { first: "faint" } });
  }
  // dorsal fillet: a thin wedge on the crown facet ahead of the fin's LE, flush on the LE's tangent plane
  {
    const L0 = F.L0;
    const zj = 11.75;
    const J = [F.xLE(zj), 0, zj];
    const front = G.crownAt(52.55);
    const w0 = 0.075;
    const mid = lerp3(front, J, 0.55);
    const midBase = G.crownAt(lerp3(front, L0, 0.55)[0]);
    const pts = [front, add(L0, mul(Y, w0)), add(L0, mul(Y, -w0)), J, add(mid, mul(Y, 0.6 * w0 * 0.5)), add(mid, mul(Y, -0.6 * w0 * 0.5)), add(midBase, mul(Y, 0.6 * w0)), add(midBase, mul(Y, -0.6 * w0))];
    ctx.hull({ name: "tail.dorsal", group: "pitch", points: pts.map(kit), tone: "hi" });
  }

  // ---- rudders -----------------------------------------------------------------------------------
  const RC = F.cone;
  const PHI = [-90, -60, -30, 0, 30, 60, 90];
  const mOf = (phi) => add(mul(F.f, Math.cos(phi * D2R)), mul(Y, Math.sin(phi * D2R)));
  const TEe = 0.012; // TE half-thickness
  const teAt = (n, d) => {
    // the TE line (y 0) meets the plane n·p = d
    const a = F.T0;
    const b = F.T1;
    const t = (d - dot(n, a)) / dot(n, sub(b, a));
    return lerp3(a, b, t);
  };
  const rudderRing = (n, d) => {
    // the nose cone cut by the plane n·p = d, then the TE (half-thickness TEe)
    const nose = PHI.map((phi) => {
      const m = mOf(phi);
      const s = (d - dot(n, RC.a) - RC.r0 * dot(n, m)) / (dot(n, RC.w) + RC.rp * dot(n, m));
      return add(RC.c(s), mul(m, RC.r(s)));
    });
    const te = teAt(n, d);
    return [...nose, add(te, mul(Y, TEe)), add(te, mul(Y, -TEe))];
  };
  const hRud = dot(G.crown.n, RC.a) - G.crown.d; // the lower rudder's foot runs through the hinge's lower end
  const sSplit = (F.split - RC.a[2]) / RC.w[2];
  const footRing = rudderRing(G.crown.n, G.crown.d + hRud);
  const splitLo = rudderRing(RC.w, dot(RC.w, RC.c(sSplit - GAP / 2)));
  const splitUp = rudderRing(RC.w, dot(RC.w, RC.c(sSplit + GAP / 2)));
  const topRing = rudderRing([0, 0, 1], F.tipZ);
  // follow-up item 16: a model plane through three points as a kit joint; the rudders' and elevators' TE faces are
  // joints, so their TE outline is drawn under the detail planes, where a mid line at rest and a hi line once deflected
  // (vary on the channel) carry it
  const joint3 = (a, b, c) => {
    const n = unit(cross(sub(b, a), sub(c, a)));
    return jointOf(n, dot(n, a));
  };
  const rudderHull = (name, group, rings) => {
    const kr = rings.map((r) => r.map(kit));
    const [r0, r1] = rings;
    return ctx.hull({ name, group, rings: kr, smooth: true, sharp: 40, flatNormals: flatFaces(kr, [[0, 1, 0], [0, -1, 0]]), tone: "mid", jointCaps: { first: "faint", last: "faint" }, joints: [joint3(r0[r0.length - 2], r0[r0.length - 1], r1[r1.length - 2])] });
  };
  const rudLo = rudderHull("tail.rudder.lo", "rudder.lo", [footRing, splitLo]);
  const rudUp = rudderHull("tail.rudder.up", "rudder.up", [splitUp, topRing]);
  BUILT.rudders = [rudLo, rudUp];
  BUILT.rudderRings = [[footRing, splitLo], [splitUp, topRing]];

  // ---- tailplanes and elevators --------------------------------------------------------------------
  const H = G.htp;
  const sectionAt = (y, side) => H.FOIL.map(([xi, zeta]) => {
    const p = H.foilPt(xi, zeta, y);
    return [p[0], side * p[1], p[2]];
  });
  const htpParts = {};
  const elevParts = {};
  const TIP_GAP = 0.12;
  const EL_IN = E.tailplane.elevatorHinge[0][1];
  const EL_OUT = E.tailplane.elevatorHinge[1][1];
  const YT0 = EL_OUT + TIP_GAP;
  for (const [s, side] of W.SIDES) {
    const EL = G.elev(side);
    const ELm = G.elev(side, { aft: ELEV_AFT(W) }); // the elevators' own hinge and nose (item 23)
    const belt = G.belt(side);
    // the root section: each airfoil point slid along its own spanwise line onto the main-belt facet plane
    const rootSection = H.FOIL.map(([xi, zeta]) => {
      let a = 0.5;
      let b = 4;
      const fOf = (y) => dot(belt.n, [H.LE(y) + xi * H.chord(y), side * y, H.zb(y) + zeta * H.TT * H.chord(y)]) - belt.d;
      for (let i = 0; i < 60; i++) {
        const m = (a + b) / 2;
        if (fOf(m) < 0) a = m;
        else b = m;
      }
      const y = (a + b) / 2;
      return [H.LE(y) + xi * H.chord(y), side * y, H.zb(y) + zeta * H.TT * H.chord(y)];
    });
    const fixed = (poly) => clipKeep(poly, EL.nT, EL.dT);
    const ringRoot = fixed(rootSection);
    const ringSplit = fixed(sectionAt(H.split, side));
    const ringT0 = fixed(sectionAt(YT0, side));
    const tipIn = sectionAt(YT0, side);
    const tipOut = sectionAt(H.tipY, side);
    htpParts[s] = {
      in: ctx.hull({ name: `tail.htp.${s}.in`, group: "pitch", flatAngle: FLAT, rings: [ringRoot, ringSplit].map((r) => r.map(kit)), smooth: true, sharp: 40, tone: "hi", jointCaps: { first: "faint", last: "faint" }, joints: [jointOf(EL.nT, EL.dT)] }),
      out: ctx.hull({ name: `tail.htp.${s}.out`, group: "pitch", flatAngle: FLAT, rings: [ringSplit, ringT0].map((r) => r.map(kit)), smooth: true, sharp: 40, tone: "hi", jointCaps: { first: "faint", last: "faint" }, joints: [jointOf(EL.nT, EL.dT)] }),
      tip: ctx.hull({ name: `tail.htp.${s}.tip`, group: "pitch", flatAngle: FLAT, rings: [tipIn, tipOut].map((r) => r.map(kit)), smooth: true, sharp: 40, tone: "hi", jointCaps: { first: "faint" } }),
      rings: { root: ringRoot, split: ringSplit, t0: ringT0, tipIn, tipOut },
    };
    // elevators: streamwise ends; the nose cone cut by y = y0, then the airfoil's aft top and the TE
    const elevRing = (y0) => {
      const ya = Math.abs(y0);
      const nose = [-90, -60, -30, 0, 30, 60, 90].map((phi) => ELm.nose(ELm.sAtY(phi, y0), phi));
      const aftTop = [0.8, 0.9].map((xi) => H.foilPt(xi, H.topOf(xi), ya)).map((p) => [p[0], y0, p[2]]);
      const te = [H.foilPt(1, 0.06, ya), H.foilPt(1, 0, ya)].map((p) => [p[0], y0, p[2]]);
      const all = [...nose, ...aftTop, ...te];
      return hullIn(all, { o: all[0], u: [1, 0, 0], v: [0, 0, 1] });
    };
    const ends = { in: [EL_IN, H.split - GAP / 2], out: [H.split + GAP / 2, EL_OUT] };
    elevParts[s] = {};
    for (const part of ["in", "out"]) {
      const [ya, yb] = ends[part];
      const rings = [elevRing(side * ya), elevRing(side * yb)];
      const kr = rings.map((r) => r.map(kit));
      const up = W.kitDir(ELm.mB);
      const teX = (y) => H.TE(Math.abs(y));
      const teJ = joint3([teX(side * ya), side * ya, 0], [teX(side * ya), side * ya, 1], [teX(side * yb), side * yb, 0]);
      elevParts[s][part] = ctx.hull({ name: `tail.elev.${s}.${part}`, group: `elev.${s}.${part}`, rings: kr, smooth: true, sharp: 40, flatNormals: flatFaces(kr, [up, mul(up, -1)]), tone: "mid", jointCaps: { first: "faint", last: "faint" }, joints: [teJ] });
      elevParts[s][`${part}Rings`] = rings;
    }
  }
  BUILT.htp = htpParts;
  BUILT.elev = elevParts;

  // ---- APU exhaust fairing and exhaust ------------------------------------------------------------
  // The tail tip loft now tapers to the model's tail-cone end (70.4 m: 0.4 m wide, 1.4 m tall). Its end gets a short
  // bevel (tail.apu.blade, 6 cm) whose face carries the exhaust: a box on a 0.88 m end face read as glued on.
  const TCE = M.FUSELAGE.tailConeEnd;
  const X0 = TCE.x;
  const XB = X0 + 0.06;
  const endRing = W.ring(X0);
  const ec = mul(endRing.reduce((acc, p) => add(acc, p), [0, 0, 0]), 1 / endRing.length);
  const bevel = endRing.map((p) => [XB, ec[1] + (p[1] - ec[1]) * 0.92, ec[2] + (p[2] - ec[2]) * 0.86]);
  const apu = ctx.hull({ name: "tail.apu.blade", group: "pitch", rings: [endRing, bevel].map((r) => r.map(kit)), smooth: true, sharp: 40, tone: "hi", jointCaps: { first: "faint" } });
  BUILT.blade = apu;
  const EXH = E.apu.exhaust;
  const RX = 0.165;
  const exhF = { o: kit([XB, 0, EXH[2]]), a: W.kitDir([1, 0, 0]), u: [0, 0, 1], v: [0, 1, 0] };
  const exhaust = ctx.round({ name: "tail.apu.exhaust", group: "pitch", F: exhF, s0: 0, s1: W.m(0.09), r: [W.m(RX), W.m(RX * 0.94)], tone: "mid", material: "gunmetal" });
  {
    // the nozzle's mouth on its aft cap: a dark disc with a lip ring
    const fr = { o: [XB + 0.09, 0, EXH[2]], u: [0, 1, 0], v: [0, 0, -1], n: [1, 0, 0] };
    planeM(ctx, exhaust, fr, `<circle class="a3-exhaust" r="${f2(W.m(RX * 0.94 * 0.8))}"/><circle class="iso-line" data-tone="lo" r="${f2(W.m(RX * 0.94 * 0.8))}"/>`);
  }

  // ---- lights: housings and registrations ----------------------------------------------------------
  const L = W.LIGHT_AT;
  const dome = (name, base, axis, r, s1, material = "chrome") => {
    // the base disc is tangent to the skin: the axis is the skin normal (the tapered tip slopes along x)
    const u = Math.abs(axis[0]) > 0.9 ? [0, 0, 1] : unit([axis[2], 0, -axis[0]]);
    const F2 = { o: kit(base), a: W.kitDir(axis), u: W.kitDir(u), v: [0, 1, 0] };
    return ctx.round({ name, group: "pitch", F: F2, s0: 0, s1: W.m(s1), r: W.m(r), ends: ["flat", "dome"], tone: "hi", material });
  };
  const zTopAt = (x) => Math.max(...W.ring2(x).map((p) => p[1]));
  const zBotAt = (x) => Math.min(...W.ring2(x).map((p) => p[1]));
  const slope = (f, x) => (f(x + 0.05) - f(x - 0.05)) / 0.1;
  dome("light.navTail", L.navTail, unit([-slope(zTopAt, L.navTail[0]), 0, 1]), 0.06, 0.012);
  dome("light.strobeTail", L.strobeTail, unit([slope(zBotAt, L.strobeTail[0]), 0, -1]), 0.07, 0.012);
  ctx.light({ id: "navTail", part: "light.navTail", group: "pitch", at: kit([L.navTail[0] + 0.03, 0, L.navTail[2] + 0.06]), normal: W.kitDir([1, 0, 0]), kind: "nav", color: "white", lens: 0.05, halo: 3, switch: "nav", sector: [110, 250], settle: 0.22 });
  ctx.light({ id: "strobeTail", part: "light.strobeTail", group: "pitch", at: kit([L.strobeTail[0] + 0.03, 0, L.strobeTail[2] - 0.07]), normal: W.kitDir(unit([1, 0, -0.4])), kind: "strobe", color: "white", lens: 0.06, halo: 3.4, switch: "strobe", flash: { period: 1.0, offsets: [0], rise: 0.05, fall: 0.04, phase: 0 }, settle: 0.1 });
  // logo lights on the tailplane tops, aimed at the fin (63.5, ±5.0, the top surface)
  const finAim = [60.6, 0, 13.0];
  for (const [s, side] of W.SIDES) {
    const logo = M.LIGHTS.logo.find((l) => Math.sign(l.at[1]) === side);
    const host = htpParts[s].in;
    const top = H.foilPt((logo.at[0] - H.LE(5)) / H.chord(5), H.topOf((logo.at[0] - H.LE(5)) / H.chord(5)), 5);
    const pk = kit([logo.at[0], side * Math.abs(logo.at[1]), top[2]]);
    const face = faceNear(host, pk);
    const base = ontoFace(face, pk);
    const nm = W.kitDir(face.n);
    const Fd = { o: base, a: face.n, u: [1, 0, 0], v: unit(cross(face.n, [1, 0, 0])) };
    ctx.round({ name: `light.logo.${s}`, group: "pitch", F: Fd, s0: 0, s1: W.m(0.01), r: W.m(0.085), ends: ["flat", "dome"], tone: "hi", material: "chrome" });
    const lensM = add(W.fromKit(base), mul(nm, 0.07));
    const dir = unit(sub(finAim, [lensM[0], lensM[1], lensM[2]]));
    ctx.light({ id: logo.id, part: `light.logo.${s}`, group: "pitch", at: kit(lensM), normal: W.kitDir(dir), kind: "logo", color: "white", lens: 0.05, halo: 2.4, switch: "logo", settle: 0.35 });
    ctx.lamp({ id: logo.id, part: `light.logo.${s}`, group: "pitch", at: kit(lensM), dir: W.kitDir(dir), cone: 34, switch: "logo" });
  }

  // ---- detail planes ---------------------------------------------------------------------------------
  // spar fastener rows: dotted, one plane per row per side, along the ring vertices at the spar stations
  const dottedRow = (part, a, b, tone = "lo") => {
    const mid = lerp3(a, b, 0.5);
    const fc = faceNear(part, kit(mid));
    const n = W.kitDir(fc.n);
    const fr = frameOf(a, n, sub(b, a));
    planeM(ctx, part, fr, `<path class="iso-line a3-rv-spar" data-tone="${tone}" data-dotted="" d="${pathOf(fr, [a, b])}"/>`);
  };
  const finRow = (part, r0, r1, xi, side) => {
    const i0 = r0.xis.indexOf(xi);
    const i1 = r1.xis.indexOf(xi);
    if (i0 < 0 || i1 < 0) return;
    const P = (ring, i) => {
      const p = ring.pts[i];
      return [p[0], side * Math.abs(p[1]), p[2]];
    };
    dottedRow(part, P(r0, i0), P(r1, i1));
  };
  for (const side of [-1, 1])
    for (const xi of [0.15, 0.62]) {
      finRow(finLo, rRoot, rSplit, xi, side);
      finRow(finUp, rSplit, rTop, xi, side);
    }
  // tailplane top rows at the front and rear spar (ξ 0.12 and 0.62) on each fixed piece
  for (const [s, side] of W.SIDES) {
    const hp = htpParts[s];
    const sp = (y, xi) => {
      const p = H.foilPt(xi, H.topOf(xi), y);
      return [p[0], side * p[1], p[2]];
    };
    const rootSp = (xi) => hp.rings.root[H.FOIL.findIndex(([x, z]) => x === xi && z > 0.5)];
    for (const xi of [0.12, 0.62]) {
      dottedRow(hp.in, rootSp(xi), sp(H.split, xi));
      dottedRow(hp.out, sp(H.split, xi), sp(YT0, xi));
      dottedRow(hp.tip, sp(YT0, xi), sp(H.tipY, xi));
    }
  }
  // rib fastener rows between the spars and the LE panel joints: curves through interpolated ring vertices,
  // so each ends exactly on a spar row (one plane each, faded by the local skin normal)
  const curveRow = (part, pts, { tone = "lo", dotted = true } = {}) => {
    const a = pts[0];
    const b = pts[pts.length - 1];
    const mid = pts[Math.floor(pts.length / 2)];
    const u = unit(sub(b, a));
    let nc = cross(u, sub(mid, a));
    const fc = faceNear(part, kit(mid));
    const nFade = W.kitDir(fc.n);
    nc = len(nc) < 1e-6 ? nFade : unit(nc);
    const v = unit(cross(nc, u));
    const fr = { o: a, u, v, n: nFade };
    planeM(ctx, part, fr, `<path class="iso-line${dotted ? " a3-rv-rib" : ""}" data-tone="${tone}"${dotted ? ' data-dotted=""' : ""} d="${pathOf(fr, pts)}"/>`);
  };
  const between = (r0, r1, idx, t, side) => idx.map((i) => {
    const p = lerp3(r0[i], r1[i], t);
    return [p[0], side * Math.abs(p[1]), p[2]];
  });
  {
    const sparIdx = [4, 5, 6, 7]; // ξ 0.15 … 0.62 on the right side of each fin ring
    for (const side of [-1, 1]) {
      for (const t of [0.33, 0.67]) curveRow(finLo, between(rRoot.pts, rSplit.pts, sparIdx, t, side));
      for (const t of [0.2, 0.4, 0.6, 0.8]) curveRow(finUp, between(rSplit.pts, rTop.pts, sparIdx, t, side));
      // the LE panel joint at ξ 0.07, root to tip
      for (const [part, r0, r1] of [[finLo, rRoot, rSplit], [finUp, rSplit, rTop]]) curveRow(part, between(r0.pts, r1.pts, [3], 0, side).concat(between(r0.pts, r1.pts, [3], 1, side)), { tone: "faint", dotted: false });
    }
    const ribIdx = [5, 6, 7, 8]; // ξ 0.12 … 0.62 on the top of each tailplane ring
    for (const [s, side] of W.SIDES) {
      const hp = htpParts[s];
      const R = hp.rings;
      for (const t of [0.35, 0.7]) curveRow(hp.in, between(R.root, R.split, ribIdx, t, side));
      for (const t of [0.2, 0.4, 0.6, 0.8]) curveRow(hp.out, between(R.split, R.t0, ribIdx, t, side));
      curveRow(hp.tip, between(R.tipIn, R.tipOut, ribIdx, 0.5, side));
      for (const [part, r0, r1] of [[hp.in, R.root, R.split], [hp.out, R.split, R.t0], [hp.tip, R.tipIn, R.tipOut]]) curveRow(part, between(r0, r1, [4], 0, side).concat(between(r0, r1, [4], 1, side)), { tone: "faint", dotted: false });
    }
  }
  // hinge brackets on the fixed TE faces (seen when a surface is deflected): small closed plates on the touch line
  {
    const finTE = (part, s0, s1, count) => {
      const fr0 = F.gen(s0);
      const fr1 = F.gen(s1);
      const fr = frameOf(fr0, mul(F.nT, -1), sub(fr1, fr0));
      const Ls = len(sub(fr1, fr0));
      let d = "";
      for (let i = 0; i < count; i++) d += rrect(W.m(((i + 0.5) / count) * Ls), 0, W.m(0.22), W.m(0.08), W.m(0.02));
      planeM(ctx, part, fr, `<path class="iso-line" data-tone="lo" d="${d}"/>`);
    };
    const sRoot = F.genOnPlane(G.crown.n, G.crown.d);
    const sMid = (F.split - RC.a[2]) / RC.w[2];
    const sTop = (F.tipZ - RC.a[2]) / RC.w[2];
    finTE(finLo, Math.max(sRoot, 0.25), sMid - 0.25, 3);
    finTE(finUp, sMid + 0.25, sTop - 0.35, 6);
    for (const [s, side] of W.SIDES) {
      const EL = G.elev(side);
      const hp = htpParts[s];
      for (const [part, ya, yb, count] of [[hp.in, 1.75, H.split - 0.2, 3], [hp.out, H.split + 0.2, 13.4, 6]]) {
        const a = EL.c(EL.sAtY(0, side * ya));
        const b = EL.c(EL.sAtY(0, side * yb));
        const ga = EL.nose(EL.sAtY(0, side * ya), 0);
        const gb = EL.nose(EL.sAtY(0, side * yb), 0);
        void a;
        void b;
        const fr = frameOf(ga, mul(EL.nT, -1), sub(gb, ga));
        const Ls = len(sub(gb, ga));
        let d = "";
        for (let i = 0; i < count; i++) d += rrect(W.m(((i + 0.5) / count) * Ls), 0, W.m(0.2), W.m(0.07), W.m(0.02));
        planeM(ctx, part, fr, `<path class="iso-line" data-tone="lo" d="${d}"/>`);
      }
    }
  }
  // static dischargers (wicks) on the rudder and elevator TEs: small closed blades past the TE, both sides
  const wicks = (part, teA, teB, ts, sideNormal) => {
    const along = sub(teB, teA);
    const au = unit(along);
    const aftDir = unit(sub([1, 0, 0], mul(au, au[0])));
    for (const sgn of [-1, 1]) {
      const n = mul(sideNormal, sgn);
      for (const t of ts) {
        const o = lerp3(teA, teB, t);
        const fr = frameOf(o, n, along);
        const tipP = add(o, mul(aftDir, 0.1));
        const [ax, ay] = [0, 0];
        const [bx, by] = (() => {
          const d = sub(tipP, o);
          return [10 * dot(d, fr.u), 10 * dot(d, fr.v)];
        })();
        const wdt = 0.09;
        const nx = -by;
        const ny = bx;
        const nl = Math.hypot(nx, ny) || 1;
        const ox = (nx / nl) * wdt;
        const oy = (ny / nl) * wdt;
        const back = 0.25;
        const sx = ax - (bx / Math.hypot(bx, by)) * back;
        const sy = ay - (by / Math.hypot(bx, by)) * back;
        const d = `M${f2(sx + ox)} ${f2(sy + oy)}L${f2(bx + ox)} ${f2(by + oy)}L${f2(bx - ox)} ${f2(by - oy)}L${f2(sx - ox)} ${f2(sy - oy)}Z`;
        planeM(ctx, part, fr, `<path class="a3-wick" d="${d}"/><path class="iso-line" data-tone="mid" d="${d}"/>`);
      }
    }
  };
  {
    const rTE = (ring) => lerp3(ring[ring.length - 2], ring[ring.length - 1], 0.5);
    wicks(rudLo, rTE(footRing), rTE(splitLo), [0.6], Y);
    wicks(rudUp, rTE(splitUp), rTE(topRing), [0.2, 0.5, 0.8], Y);
    for (const [s] of W.SIDES) {
      for (const part of ["in", "out"]) {
        const rings = elevParts[s][`${part}Rings`];
        const teOf = (ring) => ring.reduce((best, p) => (p[0] > best[0] ? p : best), ring[0]);
        const a = teOf(rings[0]);
        const b = teOf(rings[1]);
        wicks(elevParts[s][part], a, b, part === "in" ? [0.55] : [0.3, 0.7], [0, 0, 1]);
      }
      const R = htpParts[s].rings;
      const teMid = (ring) => lerp3(ring[10], ring[11], 0.5);
      wicks(htpParts[s].tip, teMid(R.tipIn), teMid(R.tipOut), [0.35, 0.8], [0, 0, 1]);
    }
  }
  // APU air intake on tail.tip's right main belt, and access panel outlines on the cone's main belts
  {
    const Ft = W.facetFrame(67.2, 7.98, 1);
    const fc = faceNear(tip, kit(Ft.o));
    const n = W.kitDir(fc.n);
    const o = W.fromKit(ontoFace(fc, kit(Ft.o)));
    const fr = frameOf(o, n, Ft.u);
    planeM(ctx, tip, fr, `<path class="a3-exhaust" d="${rrect(0, 0, 4.6, 2.6, 0.5)}"/><path class="iso-line" data-tone="mid" d="${rrect(0, 0, 4.6, 2.6, 0.5)}"/><path class="iso-line" data-tone="lo" d="${rrect(0, 0, 3.6, 0.4, 0.2)}${rrect(0, 0.75, 3.6, 0.4, 0.2)}${rrect(0, -0.75, 3.6, 0.4, 0.2)}"/>`);
    for (const [, side] of W.SIDES) {
      const Fa = W.facetFrame(64.0, 7.45, side);
      const fa = faceNear(cone, kit(Fa.o));
      const oa = W.fromKit(ontoFace(fa, kit(Fa.o)));
      const fra = frameOf(oa, W.kitDir(fa.n), Fa.u);
      planeM(ctx, cone, fra, `<path class="iso-line" data-tone="faint" d="${rrect(0, 0, 9.0, 4.0, 0.6)}"/>`);
    }
  }

  // ---- accents: the `surfaces` family (TE edges of the rudders and elevators) ---------------------------
  {
    const rTE = (ring) => lerp3(ring[ring.length - 2], ring[ring.length - 1], 0.5);
    const teLine = (part, a, b) => linePlaneKit(ctx, part, kit(a), kit(b), [0, 1, 0], (Lk) => `<path d="M0 0L${f2(Lk)} 0"/>`, { accent: "surfaces", fade: [-1.2, -1.1] });
    teLine(rudLo, rTE(footRing), rTE(splitLo));
    teLine(rudUp, rTE(splitUp), rTE(topRing));
    // follow-up item 16: a deflected rudder's or elevator's TE lifts from its mid outline to a hi line with its channel
    const hiLine = (cls) => (Lk) => `<g class="${cls}-rest"><path class="iso-line" data-tone="mid" d="M0 0L${f2(Lk)} 0"/></g><g class="${cls}" style="opacity:0"><path class="iso-line" data-tone="hi" d="M0 0L${f2(Lk)} 0"/></g>`;
    linePlaneKit(ctx, rudLo, kit(rTE(footRing)), kit(rTE(splitLo)), [0, 1, 0], hiLine("a3-m2-dfl-rud"), { fade: [-1.2, -1.1] });
    linePlaneKit(ctx, rudUp, kit(rTE(splitUp)), kit(rTE(topRing)), [0, 1, 0], hiLine("a3-m2-dfl-rud"), { fade: [-1.2, -1.1] });
    for (const [s] of W.SIDES)
      for (const part of ["in", "out"]) {
        const rings = elevParts[s][`${part}Rings`];
        const teOf = (ring) => ring.reduce((best, p) => (p[0] > best[0] ? p : best), ring[0]);
        linePlaneKit(ctx, elevParts[s][part], kit(teOf(rings[0])), kit(teOf(rings[1])), [0, 0, 1], (Lk) => `<path d="M0 0L${f2(Lk)} 0"/>`, { accent: "surfaces", fade: [-1.2, -1.1] });
        linePlaneKit(ctx, elevParts[s][part], kit(teOf(rings[0])), kit(teOf(rings[1])), [0, 0, 1], (Lk) => `<g class="a3-m2-dfl-elev-rest"><path class="iso-line" data-tone="mid" d="M0 0L${f2(Lk)} 0"/></g><g class="a3-m2-dfl-elev" style="opacity:0"><path class="iso-line" data-tone="hi" d="M0 0L${f2(Lk)} 0"/></g>`, { fade: [-1.2, -1.1] });
      }
  }

  // ---- GL targets: the fin for the logo wash ---------------------------------------------------------
  for (const [part, rings] of [["tail.fin.lo", [rRoot, rSplit]], ["tail.fin.up", [rSplit, rTop]]])
    ctx.glTarget({ name: part.replace("tail.", ""), part, kind: "fin", constants: { rings: rings.map((r) => r.pts.map(kit)), te: { n: W.kitDir(F.nT), d: null, point: kit(F.gen(0)) }, lamps: ["logoL", "logoR"], sides: [-1, 1] } });

  // ---- labels, inspect -----------------------------------------------------------------------------
  ctx.label("tail.aft", "Rear fuselage · AFT cargo door, U3 doors, bulk hold");
  ctx.label("tail.cone", "Tail cone · M5 doors · fin and tailplane roots");
  ctx.label("tail.tip", "Tail-cone tip · APU bay · APU air intake on the right");
  ctx.label("tail.apu.blade", "APU exhaust fairing · 1.4 m tall blade");
  ctx.label("tail.apu.exhaust", "APU exhaust · Pratt & Whitney Canada PW980A");
  ctx.label("tail.fin.cap", "Fin tip · 24.1 m above the runway", "inspect:tail");
  ctx.label("tail.fin", "Fin · CFRP · 14.6 m tall · built in Stade", "inspect:tail");
  ctx.label("tail.dorsal", "Dorsal fillet · fin root fairing", "inspect:tail");
  ctx.label("tail.rudder.lo", "Rudder (lower) · ±30°");
  ctx.label("tail.rudder.up", "Rudder (upper) · ±30°");
  for (const [s, word] of [["l", "left"], ["r", "right"]]) {
    ctx.label(`tail.htp.${s}`, `Horizontal stabiliser (${word}) · trimmable · span 30.4 m · built in Getafe`, "inspect:tail");
    ctx.label(`tail.elev.${s}.in`, `Elevator (inner, ${word}) · 30° up, 20° down`);
    ctx.label(`tail.elev.${s}.out`, `Elevator (outer, ${word}) · 30° up, 20° down`);
    ctx.label(`light.logo.${s}`, `Logo light (${word}) · lights the fin`, "light:logo");
  }
  ctx.label("light.navTail", "Tail navigation light · white, 140° aft", "light:nav");
  ctx.label("light.strobeTail", "Tail strobe · white, single flash", "light:strobe");
  ctx.inspect({ id: "tail", label: "Tail", centre: [59.0, 0, 10.4], group: "pitch", bearing: 150, zoom: 3, cutaway: 0 });

  // ---- clips: the rudders and the elevators through their full ranges -----------------------------------
  const ease = (t) => t * t * (3 - 2 * t);
  const sweep = (t) => (t < 1 ? -ease(t) : t < 3 ? -1 + 2 * ease((t - 1) / 2) : 1 - ease(t - 3));
  for (const [name, turn, channel] of [["rudder", 220, "yaw"], ["rudder.side", 130, "yaw"], ["elevator", 220, "pitchCmd"], ["elevator.side", 310, "pitchCmd"]])
    ctx.clip({ name, at: (t) => W.groundChannels({ turn, [channel]: sweep(t) }), from: 0, to: 4, frame: 1 / 60 });

  // ---- CSS -----------------------------------------------------------------------------------------------
  ctx.vary("a3-m2-dfl-rud", "F.smooth(0.01, 0.13, Math.abs(ch.yaw || 0))");
  ctx.vary("a3-m2-dfl-elev", "F.smooth(0.01, 0.13, Math.abs(ch.pitchCmd || 0))");
  ctx.vary("a3-m2-dfl-rud-rest", "1 - F.smooth(0.01, 0.13, Math.abs(ch.yaw || 0))");
  ctx.vary("a3-m2-dfl-elev-rest", "1 - F.smooth(0.01, 0.13, Math.abs(ch.pitchCmd || 0))");
  // follow-up items 16 and 22: the fixed surfaces' joint seams at the rudders and elevators are gap lines (lo by
  // daylight, between lo and mid at night); at phone width the rib fastener rows fade and the spar rows space out
  ctx.css(`.iso{--a3-exhaust:#4a4d55;--a3-wick:#9aa0aa;--a3-gap:#969ca2}
.iso[data-theme="dark"]{--a3-exhaust:#07090c;--a3-wick:#3a3f47;--a3-gap:#5c636a}
.a3-stage [data-name^="tail."] [data-r="jm"]{stroke:var(--a3-gap)}
/* follow-up review 1 (tone hierarchy): by night the structure's outlines (silhouettes, fences, deflected edges) sit
   near 165 lum, under the one lit phase accent (about 250), as the reference figures keep structure dim */
.iso[data-theme="dark"] .a3-stage [data-name^="tail."][data-mat]{--anatomy-hi:#a1a7ad}
@media (max-width:599px){.a3-stage .a3-rv-rib{opacity:0}.a3-stage .a3-rv-spar{stroke-dasharray:.01 7}}
.a3-exhaust{fill:var(--a3-exhaust);stroke:none}
.a3-wick{fill:var(--a3-wick);stroke:none}`);
  void newell;
}

// ---------------------------------------------------------------------------------------------
// checks (--check)
// ---------------------------------------------------------------------------------------------
export function checks(ctx) {
  const { W, M } = ctx;
  const G = geometry(W, M);
  const say = (line) => console.log(`M2 tail: ${line}`);
  const E = G.E;
  // the loft against FUSELAGE.stations
  const rows = [];
  for (const [x, hw, top, bottom] of M.FUSELAGE.stations) {
    if (x < 46.5 - 1e-9) continue;
    const l = W.loftAt(Math.min(70.4, x));
    rows.push(`${x}: top ${l.topZ.toFixed(3)} (${top}) bottom ${l.bottomZ.toFixed(3)} (${bottom}) half-width ${l.halfWidth.toFixed(3)} (${hw})`);
  }
  say(`loft against FUSELAGE.stations (model in brackets):\n    ${rows.join("\n    ")}`);
  // fin numbers
  const F = G.fin;
  say(`fin: root LE ${F.L0[0].toFixed(2)} at z ${F.L0[2].toFixed(3)}, root chord ${(F.T0[0] - F.L0[0]).toFixed(2)}, tip LE ${F.L1[0].toFixed(2)} at z ${F.L1[2].toFixed(2)}, tip chord ${(F.T1[0] - F.L1[0]).toFixed(2)}; rudder nose r ${F.cone.r0.toFixed(3)} → ${F.cone.r1.toFixed(3)} m`);
  if (Math.abs(F.L0[0] - 53.94) > 1e-6 || Math.abs(F.T0[0] - F.L0[0] - 12.06) > 1e-6 || Math.abs(F.L1[0] - 68.02) > 1e-6 || Math.abs(F.L1[2] - 24.06) > 1e-6 || Math.abs(F.T1[0] - F.L1[0] - 4.7) > 1e-6) throw new Error("fin planform off the truth");
  const H = G.htp;
  say(`tailplane: span ${(2 * H.tipY).toFixed(2)}, tip LE ${H.LE(H.tipY).toFixed(2)}, tip chord ${H.chord(H.tipY).toFixed(2)}, bottom plane rises ${(Math.atan(H.sb) / D2R).toFixed(1)}° outboard`);
  // root gaps: every root-ring point against the cone's faces (largest of the face distances, a lower bound)
  const cone = BUILT.cone;
  const outside = (part, pk) => Math.max(...part.world.faces.map((f) => dot(f.n, pk) - dot(f.n, part.world.points[f.ring[0]])));
  const gapOf = (pts) => Math.max(...pts.map((p) => outside(cone, W.kit(p)))) / 10;
  const finRoot = G.fin.ring("root").pts;
  const htpRoot = BUILT.htp.r.rings.root;
  say(`root gaps to tail.cone: fin ${gapOf(finRoot).toFixed(3)} m, tailplane ${gapOf(htpRoot).toFixed(3)} m (largest over the root outline)`);
  if (gapOf(finRoot) > 0.08 || gapOf(htpRoot) > 0.08) throw new Error("a root gap exceeds 0.08 m");
  // rudders over ±30: behind the fin's TE face, above the crown, clear of the tip
  const RC = F.cone;
  let finMargin = Infinity;
  let crownMargin = Infinity;
  for (const rings of BUILT.rudderRings)
    for (let deg = -30; deg <= 30; deg += 1)
      for (const p of rings.flat()) {
        const q = rotAbout(p, RC.a, RC.w, deg);
        finMargin = Math.min(finMargin, F.dT - dot(F.nT, q));
        crownMargin = Math.min(crownMargin, dot(G.crown.n, q) - G.crown.d);
      }
  say(`rudders over ±30°: behind the fin's TE face by ${finMargin.toFixed(4)} m at least, above the crown facet by ${crownMargin.toFixed(3)} m at least`);
  if (finMargin < -1e-6) throw new Error("a rudder crosses the fin's TE face");
  if (crownMargin < W.GAP) throw new Error("a rudder comes within W.GAP of the crown");
  // elevators over −30…20: behind the tailplane's TE face; inner ones ≥ 0.05 m from the cone and the tip; outer clear of the tip piece
  for (const [s, side] of W.SIDES) {
    const EL = G.elev(side);
    const ELm = G.elev(side, { aft: ELEV_AFT(W) });
    let teMargin = Infinity;
    let coneMargin = Infinity;
    let tipMargin = Infinity;
    for (const part of ["in", "out"]) {
      const rings = BUILT.elev[s][`${part}Rings`];
      for (let deg = -30; deg <= 20; deg += 1)
        for (const p of rings.flat()) {
          const q = rotAbout(p, ELm.A, ELm.w, deg);
          teMargin = Math.min(teMargin, EL.dT - dot(EL.nT, q));
          const qk = W.kit(q);
          if (part === "in") coneMargin = Math.min(coneMargin, outside(cone, qk) / 10, outside(BUILT.tip, qk) / 10);
          else tipMargin = Math.min(tipMargin, outside(BUILT.htp[s].tip, qk) / 10);
        }
    }
    say(`elevators ${s}: behind the TE face by ${teMargin.toFixed(4)} m at least; inner ${coneMargin.toFixed(3)} m from the cone and tip at least; outer ${tipMargin.toFixed(3)} m from the tip piece at least; hinge z ${EL.A[2].toFixed(3)} → ${EL.B[2].toFixed(3)}, nose r ${EL.r0.toFixed(3)} → ${EL.r1.toFixed(3)}`);
    if (teMargin < ELEV_AFT(W) * 0.9 - 1e-6) throw new Error(`elevator ${s} within ${teMargin.toFixed(4)} m of the tailplane's TE face`);
    if (coneMargin < 0.05) throw new Error(`inner elevator ${s} comes within 0.05 m of the cone`);
    if (tipMargin < W.GAP) throw new Error(`outer elevator ${s} comes within W.GAP of the tip piece`);
  }
  // the exhaust on the bevel's face
  const tce = M.FUSELAGE.tailConeEnd;
  const faceHalf = 0.92 * Math.max(...W.ring2(tce.x).map((p) => p[0]));
  say(`APU exhaust r 0.165 m on the bevel face (half-width ${faceHalf.toFixed(3)} m): ${(faceHalf - 0.165).toFixed(3)} m to spare`);
  if (faceHalf < 0.165) throw new Error("the APU exhaust overhangs the bevel face");
  void E;
}
