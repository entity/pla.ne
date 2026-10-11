// a380/parts/wings.mjs (M3): the wings. Fillet, box panels around the WLG well, droop noses, slats, Fowler
// flaps on tracks, split track fairings, ailerons, spoilers, fences, tip and root lights (DESIGN §5.4, §9 M3).
//
// Geometry is built once for the right wing in model metres (x aft, |y|, z up) and mirrored per side through
// W.kit. Every ring is a planar section: y-planes for panels and devices, planes normal to a hinge axis where a
// device's end must stay invariant while it turns (the droop and slat ends beside fixed strips).
//
// Hinge axes (notes in a380/notes/modules/M3.md):
//   droop noses 1–2 share one axis along the inner LE face, under their lower aft edge (they droop, opening a
//   wedge at the top); slats 2–7 share one axis along the outer LE face, aft of and below them (a circular track
//   forward and down). Sharing an axis makes each run move as one body, so the gaps between its devices stay
//   W.GAP. Where a run meets a fixed strip outboard, the device's end and the strip's face are planes normal to
//   that axis, so they keep W.GAP in every CONF.
//   Flaps: a track slide aft and 8° down (streamwise), then a hinge on the flap's nose-circle line.
//   Ailerons: one hinge line for all three (box.6's TE face edge is straight, so the nose centres are collinear).
//   Spoilers: one plate per spoiler (two for spoilers 1 and 4, split at a station), W.GAP + 3 mm over the box top,
//   each hinged on its own LE line.
import { convexHull3 } from "../../kit/hull3.mjs";
import { separate } from "../../kit/turn-build.mjs";

export const id = "wings";
export const owner = "M3";
export const title = "Wings: fillet, box panels around the gear well, droop noses, slats, Fowler flaps on tracks, split track fairings, ailerons, spoilers, fences, tip and root lights";
/** Every part name this module creates starts with one of these (the harness enforces it). */
export const prefixes = ["wings.", "wing.", "light.navL", "light.navR", "light.strobeL", "light.strobeR", "light.obstr", "light.land", "light.taxiL", "light.taxiR", "light.camWing"];
export const stub = false;

const D2R = Math.PI / 180;
const FLAP_TABLE = [[0, 0], [8, 0.55], [17, 0.8], [26, 0.92], [33, 1.0]];
const TIP_OUT = 39.875; // the fence's outer face: span over the fences 79.75 m
const FENCE_T = 0.12;
const TIP = TIP_OUT - FENCE_T; // the wing's tip face, where the fence stands
const WELL_X = 32.55;
// the stowed wing gear's recess under the inner flap root (M5 request R1, model metres): x up to 34.00, |y| up to 6.40,
// z up to 3.82 stays clear of the wing while the gear is up, at every flap setting
const RECESS = { x: 34.06, y: 6.8, z: 3.82 };

// ---------------------------------------------------------------------------------------------
// small vector helpers (model or kit space alike)
// ---------------------------------------------------------------------------------------------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => mul(a, 1 / (len(a) || 1));
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const r3 = (v) => Math.round(v * 1000) / 1000;
const f2 = (v) => v.toFixed(2);

/** Clip a planar polygon (3D points) by a half-space, keeping n·p <= d. */
function clipPoly(poly, n, d) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const sp = d - dot(n, p);
    const sq = d - dot(n, q);
    if (sp >= 0) out.push(p);
    if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) out.push(lerp3(p, q, sp / (sp - sq)));
  }
  return out;
}
/** Three points on the plane n·p = k (n unit): a joint or flat given as points. */
function planeFrom(n, k) {
  const p0 = mul(n, k);
  const e1 = unit(Math.abs(n[2]) < 0.9 ? cross(n, [0, 0, 1]) : cross(n, [1, 0, 0]));
  return [p0, add(p0, e1), add(p0, cross(n, e1))];
}
/** z = c0 + cx·x + cy·y least squares over [[x, y, z]…]. */
function planeFit(pts) {
  let sx = 0, sy = 0, sz = 0, sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0;
  for (const [x, y, z] of pts) {
    sx += x; sy += y; sz += z; sxx += x * x; sxy += x * y; syy += y * y; sxz += x * z; syz += y * z;
  }
  const n = pts.length;
  const A = [[n, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]];
  const B = [sz, sxz, syz];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d0 = det(A);
  const col = (k) => A.map((row, i) => row.map((v, j) => (j === k ? B[i] : v)));
  return { c0: det(col(0)) / d0, cx: det(col(1)) / d0, cy: det(col(2)) / d0 };
}
/** The top surface of a convex body: z(x, y) = min over upward faces of its hull. */
function topOf(points) {
  const hull = convexHull3(points, { name: "m3.top" });
  const up = hull.faces.filter((f) => f.n[2] > 1e-6);
  return (x, y) => {
    let z = Infinity;
    for (const f of up) z = Math.min(z, (f.d - f.n[0] * x - f.n[1] * y) / f.n[2]);
    return z;
  };
}
/** Whether a vertical line at (x, y) meets the convex body of these points. */
function footprint(points) {
  const hull = convexHull3(points, { name: "m3.foot" });
  return (x, y) => {
    let lo = -Infinity;
    let hi = Infinity;
    for (const f of hull.faces) {
      const r = f.d - f.n[0] * x - f.n[1] * y; // n_z·z <= r
      if (Math.abs(f.n[2]) < 1e-9) {
        if (r < -1e-9) return false;
      } else if (f.n[2] > 0) hi = Math.min(hi, r / f.n[2]);
      else lo = Math.max(lo, r / f.n[2]);
    }
    return lo <= hi;
  };
}
/** Rotate p about the line through c along unit axis a by deg (Rodrigues; same convention as TURN.rotation). */
function rotateAbout(TURN, p, c, a, deg) {
  const R = TURN.rotation(a, deg);
  const v = sub(p, c);
  return add(c, [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]]);
}

// ---------------------------------------------------------------------------------------------
// the wing's geometry, right wing, model metres
// ---------------------------------------------------------------------------------------------
let CACHE = null;
function geometry(W, M) {
  if (CACHE && CACHE.W === W) return CACHE;
  const GAP = W.GAP;
  const AIRFOIL = W.WING.airfoil;
  const sec = (a) => W.WING.section(a);
  const at = (a) => W.WING.at(a);
  const bot = (a) => W.WING.bottomAt(a);
  const topAt = (a, x) => sec(a).topAt(x);
  const faceOf = (kind, a) => {
    const list = W.WING.faces[kind];
    const L = list.find((l) => a >= l.y[0] - 1e-9 && a <= l.y[1] + 1e-9) ?? (a < list[0].y[0] ? list[0] : list[list.length - 1]);
    const k = (L.x[1] - L.x[0]) / (L.y[1] - L.y[0]);
    return { x: L.x[0] + k * (a - L.y[0]), k, cos: 1 / Math.hypot(1, k) };
  };
  const fx = (kind, a) => faceOf(kind, a).x;
  const gx = (kind, a, g = GAP) => g / faceOf(kind, a).cos;
  /** The plane of a LE or TE face between spans a0 and a1 (offset dx(a) along x), as three model points: a joint. */
  const facePlane = (kind, a0, a1, dx = () => 0) => [[fx(kind, a0) + dx(a0), a0, 0], [fx(kind, a0) + dx(a0), a0, 1], [fx(kind, a1) + dx(a1), a1, 0]];
  const clipX = (poly, x0, x1) => {
    let out = poly;
    const cut = (keep) => {
      const res = [];
      for (let i = 0; i < out.length; i++) {
        const p = out[i];
        const q = out[(i + 1) % out.length];
        const sp = keep(p[0]);
        const sq = keep(q[0]);
        if (sp >= 0) res.push(p);
        if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) res.push([lerp(p[0], q[0], sp / (sp - sq)), lerp(p[1], q[1], sp / (sp - sq))]);
      }
      out = res;
    };
    if (x0 !== null) cut((x) => x - x0);
    if (x1 !== null) cut((x) => x1 - x);
    return out.filter((p, i) => Math.hypot(p[0] - out[(i + 1) % out.length][0], p[1] - out[(i + 1) % out.length][1]) > 1e-6);
  };
  const ring = (a, poly) => poly.map(([x, z]) => [x, a, z]);
  const boxRing = (a) => ring(a, clipX(sec(a).points, fx("le", a), fx("te", a)));
  const noseRing = (a, back = 0) => ring(a, clipX(sec(a).points, null, fx("le", a) - back));
  const tailRing = (a, front = 0) => ring(a, clipX(sec(a).points, fx("te", a) + front, null));

  // the nose profile on an arbitrary plane n·p = k (n has a dominant y component): each profile vertex family
  // (fixed ξ, ζ; the face top and bottom) is followed along y to where it meets the plane.
  const noseFamilies = (back) => [
    (a) => [fx("le", a) - back(a), a, bot(a)],
    ...AIRFOIL.slice(0, 6).map(([xi, zeta]) => (a) => {
      const w = at(a);
      return [w.le + xi * w.chord, a, w.bottom + zeta * w.thickness];
    }),
    (a) => {
      const x = fx("le", a) - back(a);
      return [x, a, topAt(a, x)];
    },
  ];
  const onPlane = (fam, n, k, y0) => {
    let lo = y0 - 6;
    let hi = y0 + 6;
    const f = (a) => dot(n, fam(a)) - k;
    if (f(lo) * f(hi) > 0) return fam(Math.abs(f(lo)) < Math.abs(f(hi)) ? lo : hi);
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (f(lo) * f(mid) <= 0) hi = mid;
      else lo = mid;
    }
    return fam((lo + hi) / 2);
  };
  const obliqueNose = (n, k, back, y0) => noseFamilies(back).map((fam) => onPlane(fam, n, k, y0));
  /** k such that the oblique nose ring's largest y is yMax. */
  const kForMaxY = (n, back, yMax) => {
    let lo = dot(n, [fx("le", yMax) - 6, yMax - 3, 0]);
    let hi = dot(n, [fx("le", yMax) + 6, yMax + 3, 0]);
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      const ymax = Math.max(...obliqueNose(n, mid, back, yMax).map((p) => p[1]));
      if (ymax > yMax) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  };

  const backLE = (a) => gx("le", a);
  const devices = W.WING.devices;
  const parts = [];
  const groups = [];
  const part = (spec) => (parts.push(spec), spec);
  const group = (spec) => (groups.push(spec), spec);

  // ------------------------------------------------------------------ box panels and the well
  const stations = [4.45, 6.8, 12.45, 13.88, 18.99, 25.75, TIP];
  const boxes = [];
  for (let i = 0; i < stations.length - 1; i++) {
    const rings = [boxRing(stations[i]), boxRing(stations[i + 1])];
    boxes.push({ y: [stations[i], stations[i + 1]], rings, top: topOf(rings.flat()) });
  }
  // the well ceiling: 0.15 m under the skin over x 32.55 → TE face, y 5.15 → 6.80, as a plane lowered so the
  // skin above it is at least 0.15 m everywhere
  // (the same construction as M5's wellCeiling() in gear.mjs: the airfoil section top, sampled identically, so the
  // gear fitting lands flush on box.1u; the box's drawn skin over it is ≥ 0.148 m)
  const ceilSamples = [];
  for (let a = 5.1; a <= 6.8 + 1e-9; a += 0.05) for (let x = WELL_X; x <= fx("te", a) + 1e-9; x += 0.025) ceilSamples.push([x, a, topAt(a, x) - 0.15]);
  const fit = planeFit(ceilSamples);
  const lower = Math.min(0, ...ceilSamples.map(([x, a, z]) => z - (fit.c0 + fit.cx * x + fit.cy * a)));
  const ceiling = { c0: fit.c0 + lower, cx: fit.cx, cy: fit.cy, at: (x, a) => fit.c0 + lower + fit.cx * x + fit.cy * a, lowered: -lower };
  const boxNames = ["box.1", "box.2", "box.3", "box.4", "box.5", "box.6"];
  // review round 3: a box panel's LE and TE faces, where the stowed slats and flaps meet it, are mid gap lines (kit
  // patch 15 joints), not hi outlines: the wing read as a drawing of near-white lines at 1x
  const boxJoints = (b) => [{ plane: facePlane("le", b.y[0], b.y[1]), tone: "mid" }, { plane: facePlane("te", b.y[0], b.y[1]), tone: "mid" }];
  // follow-up review 1 (pops): each box panel's top is flat faces but one or two near-flat smooth faces (corner normals
  // 6.0-7.3° off: box.1f, box.2, box.3), whose sub-bands swept them in a single step (dark second difference, 5 cores at
  // 30.5-30.9° on wings.l.box.2; a one-state 41 px band flicker in the take-off.0 rotation): the panels shade flat to 8°
  const BOX_FLAT = 8;
  boxes.forEach((b, i) => {
    const label = `Wing box · ${["root panel", "inner panel", "kink panel", "inboard engine panel", "outboard engine panel", "outer panel"][i]} · y ${f2(b.y[0])}–${f2(b.y[1])} m`;
    if (i === 0) {
      const well = [[WELL_X, 0, 0], [WELL_X, 1, 0], [WELL_X, 0, 1]];
      part({ key: "box.1f", rings: b.rings, flats: [{ plane: well, inside: [WELL_X - 1, 5, 4] }], label: `${label} · ahead of the gear well`, box: 0, flatAngle: BOX_FLAT, jointCaps: { first: "faint", last: "faint" }, joints: [well, ...boxJoints(b)] });
      const c = (x, a) => [x, a, ceiling.at(x, a)];
      part({ key: "box.1u", rings: b.rings, flats: [{ plane: well, inside: [WELL_X + 1, 5, 4] }, { plane: [c(32, 5), c(34, 5), c(32, 7)], inside: [33, 6, 9] }], label: `${label} · the skin over the gear well`, box: 0, flatAngle: BOX_FLAT, jointCaps: { first: "faint", last: "faint" }, joints: [well, ...boxJoints(b)] });
    } else part({ key: boxNames[i], rings: b.rings, label, box: i, flatAngle: BOX_FLAT, jointCaps: { first: "faint", last: "faint" }, joints: boxJoints(b) });
  });

  // ------------------------------------------------------------------ fillet
  {
    const root = sec(4.45);
    const xFace = fx("te", 4.45);
    const contour = root.points.filter(([x], i) => i >= 2 && i <= 12 && x <= xFace - 1e-6);
    contour.push([xFace, topAt(4.45, xFace)]);
    const line = [[contour[0][0], 3.416, 5.05], [xFace, 3.416, 5.05]];
    // follow-up round 2 (pops, light 40°): the fillet meets the wing's root rings on the plane y 4.45, a joint of one skin.
    // Its outline there was a hi line while the root rings' caps are faint joints, so as the plane turned edge-on (40°
    // right, 320° left) and the painter put the fillet over the wing, that line jumped from faint to hi (15 px). Faint.
    part({ key: "fillet", points: [...line, ...contour.map(([x, z]) => [x, 4.45, z])], flatNormal: [0, 1, 0], sharp: 40, label: "Wing root fillet · fairs the wing top into the fuselage side", joints: [[[0, 4.45, 0], [1, 4.45, 0], [0, 4.45, 1]]] });
  }

  // ------------------------------------------------------------------ LE: axes, droop noses, slats, fixed strips
  // droop axis: under the droop noses' lower aft edge, along the inner LE face
  const droopC = (a) => [fx("le", a) - backLE(a) - 0.03, a, bot(a) - 0.03];
  const droopAxis = { c0: droopC(7.2), c1: droopC(13.88) };
  // slat axis: aft of and below each slat, offsets scaled to the local slat chord (forward travel ~0.33 c_s at 20°)
  const slatC = (a) => {
    const x = fx("le", a) - backLE(a);
    const cs = fx("le", a) - at(a).le;
    return [x + 0.25 * cs, a, topAt(a, x) - 1.0 * cs];
  };
  const slatAxis = { c0: slatC(15.6), c1: slatC(38.05) };
  const nDroop = unit(sub(droopAxis.c1, droopAxis.c0));
  const nSlat = unit(sub(slatAxis.c1, slatAxis.c0));
  const ends = {};
  const half = GAP / 2;
  // oblique ends (normal to the axis): the device's nose reaches yMax; the strip begins W.GAP beyond
  const oblique = (nAx, yMax) => {
    const k = kForMaxY(nAx, backLE, yMax);
    return { n: nAx, k, kStrip: k + GAP };
  };
  ends.dn2 = oblique(nDroop, 13.88 - GAP / nDroop[1] - 0.002);
  ends.s4 = oblique(nSlat, 24.61 - half);
  ends.s7 = oblique(nSlat, 38.05 - half);
  const deviceRing = (a) => noseRing(a, backLE(a));
  // droop noses 1–2 and slats 2–7 each move as one rigid run (one axis, one rule): one group per run
  const dg = devices.droop[0];
  const droopG = group({ key: "droop", kind: "hinge", parent: "pitch", axis: droopAxis, range: [0, 23], probe: [fx("le", dg.y[0]) - 1.2, dg.y[0] + 0.5, bot(dg.y[0]) + 0.5], want: [0, 0, -1], rules: () => [{ channel: "slat" }] });
  const sg = devices.slats[0];
  const slatG = group({ key: "slat", kind: "hinge", parent: "pitch", axis: slatAxis, range: [0, 23], probe: [at(sg.y[0]).le, sg.y[0] + 0.5, bot(sg.y[0]) + 0.3], want: [0, 0, -1], rules: () => [{ channel: "slat" }] });
  for (const d of devices.droop) {
    const g = droopG;
    const r0 = deviceRing(d.y[0] + half);
    const r1 = d.id === "2" ? obliqueNose(ends.dn2.n, ends.dn2.k, backLE, 13.88) : deviceRing(d.y[1] - half);
    part({ key: `droop.${d.id}`, group: g.key, rings: [r0, r1], label: { kind: "droop", id: d.id, y: d.y }, accent: "slats", nose: true, jointCaps: { first: "faint", last: "faint" }, joints: [{ plane: facePlane("le", d.y[0], d.y[1], (a) => -backLE(a)), tone: "mid" }] });
  }
  for (const s of devices.slats) {
    const g = slatG;
    const firstOfRun = s.id === "2" || s.id === "5";
    const r0 = deviceRing(s.y[0] + half * (firstOfRun ? 1 : 1));
    const end = s.id === "4" ? ends.s4 : s.id === "7" ? ends.s7 : null;
    const r1 = end ? obliqueNose(end.n, end.k, backLE, s.y[1]) : deviceRing(s.y[1] - half);
    part({ key: `slat.${s.id}`, group: g.key, rings: [r0, r1], label: { kind: "slat", id: s.id, y: s.y }, accent: "slats", nose: true, gl: true, jointCaps: { first: "faint", last: "faint" }, joints: [{ plane: facePlane("le", s.y[0], s.y[1], (a) => -backLE(a)), tone: "mid" }] });
  }
  // fixed strips
  const fl = devices.fixedLE;
  // follow-up item 16: a fixed strip's aft face (on the LE face, against the box) and its ends (against a device or a
  // pylon) are gap joints, so at rest only the true silhouette (the nose) is a hi line
  const leJoint = (a0, a1) => ({ jointCaps: { first: "faint", last: "faint" }, joints: [{ plane: facePlane("le", a0, a1), tone: "mid" }] });
  part({ key: "le.root", rings: [noseRing(fl.root[0]), noseRing(fl.root[1] - half)], label: "Fixed leading edge · wing root · landing and taxi lights", lamps: true, ...leJoint(fl.root[0], fl.root[1] - half) });
  {
    // the kink piece: from the droop end's plane (+ W.GAP) to y 13.88, on the inner LE face
    const A = clipPoly(obliqueNose(ends.dn2.n, ends.dn2.kStrip, () => 0, 13.88), [0, 1, 0], 13.88);
    const B = clipPoly(noseRing(13.88), mul(ends.dn2.n, -1), -ends.dn2.kStrip);
    part({ key: "le.gin.k", points: [...A, ...B], label: "Fixed leading edge · beside droop nose DN2", joints: [{ plane: facePlane("le", 12.5, 13.88), tone: "mid" }, [[0, 13.88, 0], [1, 13.88, 0], [0, 13.88, 1]], planeFrom(ends.dn2.n, ends.dn2.kStrip)] });
  }
  part({ key: "le.gin.a", rings: [noseRing(fl["gin.a"][0]), noseRing(fl["gin.a"][1])], label: "Fixed leading edge · inboard pylon, inner side", ...leJoint(fl["gin.a"][0], fl["gin.a"][1]) });
  part({ key: "le.gin.b", rings: [noseRing(fl["gin.b"][0]), noseRing(fl["gin.b"][1] - half)], label: "Fixed leading edge · inboard pylon, outer side", ...leJoint(fl["gin.b"][0], fl["gin.b"][1] - half) });
  part({ key: "le.gout.a", rings: [obliqueNose(ends.s4.n, ends.s4.kStrip, () => 0, 24.61), noseRing(fl["gout.a"][1])], label: "Fixed leading edge · outboard pylon, inner side", ...leJoint(24.4, fl["gout.a"][1]) });
  part({ key: "le.gout.b", rings: [noseRing(fl["gout.b"][0]), noseRing(fl["gout.b"][1] - half)], label: "Fixed leading edge · outboard pylon, outer side", ...leJoint(fl["gout.b"][0], fl["gout.b"][1] - half) });
  part({ key: "le.tip", rings: [obliqueNose(ends.s7.n, ends.s7.kStrip, () => 0, 38.05), noseRing(TIP)], label: "Fixed leading edge · wingtip", ...leJoint(37.8, TIP) });

  // ------------------------------------------------------------------ flaps on tracks, fixed TE, canoes
  const flapGap = { 12.45: 0.025, 18.99: 0.065, 25.53: 0.055 }; // each side; sized from the measured closures (--check kinematics)
  const flapSpan = (f) => {
    let [a0, a1] = f.y;
    // the inner flap reaches the root plane: the fillet ends at the TE face plane, so the flap root (which drifts
    // 0.14 m inboard at FULL, over the belly fairing) closes the wing top beside the fuselage
    if (f.id === "in") a0 = W.WING.rootY + GAP + 0.002;
    if (flapGap[a0]) a0 += flapGap[a0];
    if (flapGap[a1]) a1 -= flapGap[a1];
    return [a0, a1];
  };
  // the flap TE: a straight line between its end rings, placed to halve the worst departure from the model's TE
  // (the model's TE kinks at 11.5 m inside the inner flap; DESIGN §5.1 moves the kink to 12.45)
  const teFit = (a0, a1) => {
    const T0 = at(a0).te;
    const T1 = at(a1).te;
    let lo = Infinity;
    let hi = -Infinity;
    for (let a = a0; a <= a1 + 1e-9; a += 0.05) {
      const dev = at(a).te - lerp(T0, T1, (a - a0) / (a1 - a0));
      lo = Math.min(lo, dev);
      hi = Math.max(hi, dev);
    }
    const shift = (lo + hi) / 2;
    return (a) => lerp(T0, T1, (a - a0) / (a1 - a0)) + shift;
  };
  const flapRing = (a, teX = null) => {
    const x0 = fx("te", a);
    const b = bot(a);
    const h = topAt(a, x0) - b;
    const r = h / 2;
    const xc = x0 + gx("te", a) + r;
    const zc = b + r;
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const t = (90 + 30 * i) * D2R;
      pts.push([xc + r * Math.cos(t), zc + r * Math.sin(t)]);
    }
    const s = sec(a);
    const te = teX ?? s.te;
    pts.push(...s.points.filter(([x, z]) => x > xc + 0.05 && x < s.te - 1e-6 && z > b + 1e-6));
    pts.push([te, b + 0.06 * s.thickness], [te, b]);
    return { pts: ring(a, pts), c: [xc, a, zc], r, b, x0, te };
  };
  const flaps = {};
  const trackDir = [Math.cos(8 * D2R), 0, -Math.sin(8 * D2R)];
  for (const f of devices.flaps) {
    const [a0, a1] = flapSpan(f);
    const teLine = teFit(a0, a1);
    const A = flapRing(a0, teLine(a0));
    const B = flapRing(a1, teLine(a1));
    const chord = M.wingAt((a0 + a1) / 2).chord;
    const travel = 0.18 * chord;
    const tg = group({ key: `flap.${f.id}.track`, kind: "slide", parent: "pitch", dir: trackDir, travel, rules: () => [{ channel: "flap", table: FLAP_TABLE.map(([x, k]) => [x, k * travel]) }] });
    const hg = group({ key: `flap.${f.id}`, kind: "hinge", parent: tg.key, axis: { c0: A.c, c1: B.c }, range: [0, 33], probe: [A.te, a0, A.b], want: [0, 0, -1], rules: () => [{ channel: "flap" }] });
    flaps[f.id] = { y: [a0, a1], A, B, travel, chord, group: hg.key, track: tg.key, bottom: (a) => lerp(A.b, B.b, (a - a0) / (a1 - a0)), top: topOf([...A.pts, ...B.pts]) };
    // follow-up item 16: the flap's TE face (a vertical plane through its TE line) is a joint, so its outline there is
    // drawn under the detail planes, where a mid line at rest and a hi line once deflected (vary) carry the TE
    const teJ = { plane: [[A.te, a0, 0], [A.te, a0, 1], [B.te, a1, 0]], tone: "mid" };
    if (f.id !== "in") {
      part({ key: `flap.${f.id}`, group: hg.key, rings: [A.pts, B.pts], label: { kind: "flap", id: f.id }, accent: "flaps", flap: f.id, tone: "mid", jointCaps: { first: "faint", last: "faint" }, joints: [teJ] });
      continue;
    }
    // The stowed wing gear's recess under the inner flap's root (M5 request R1): x from the TE face to RECESS.x,
    // |y| to RECESS.y, z up to RECESS.z stays free of the wing at every flap setting while the gear is up. The leg
    // stows aft of the swept TE face, so (as on the aircraft, where fixed structure aft of the rear spar covers the
    // gear well) the root of the trailing edge over the recess is FIXED structure, from the well-ceiling plane up
    // to the top skin, and the flap's root is its aft part only (from RECESS.x). A moving roof over the leg left
    // the stowed gear visible through the cove at flaps 0 and through the Fowler slot at 1+F, and closed painter's
    // cycles with the box's swept TE face. The fixed pieces are split so that no piece flush on the swept TE face
    // lies over the leg: a filler to XIN (forward of the leg), an inner piece aft of XIN (0.27 m clear of the
    // box's TE face along its normal, so the box never covers it from the bearings where the stowed stay is in
    // front of the box), and an outer piece on box.1u's TE face (box.1u lies over the stay). A fixed aft wall
    // closes the recess behind the gear.
    flaps.in.recess = { ...RECESS, a0 };
    const yPlane = [[0, RECESS.y, 0], [1, RECESS.y, 0], [0, RECESS.y, 1]];
    const xPlane = [[RECESS.x, 0, 0], [RECESS.x, 1, 0], [RECESS.x, 0, 1]];
    part({ key: "flap.in", group: hg.key, rings: [A.pts, B.pts], flats: [{ plane: yPlane, inside: [34, RECESS.y + 1, 4] }], label: { kind: "flap", id: f.id }, accent: "flaps", flap: f.id, tone: "mid", joints: [teJ] });
    part({ key: "flap.in.wall", group: hg.key, rings: [A.pts, B.pts], flats: [{ plane: yPlane, inside: [34, RECESS.y - 1, 4] }, { plane: xPlane, inside: [RECESS.x + 1, 5, 4] }], label: { kind: "flap", id: f.id }, flap: f.id, tone: "mid", joints: [teJ] });
  }
  {
    // the fixed root trailing edge over the recess (both sides mirror it): sections between x0(y) and x1 at each
    // end, top on the airfoil, bottom on the well-ceiling plane carried aft
    const F = flaps.in;
    const a0 = F.y[0];
    const XIN = fx("te", 5.15) + 0.3;
    const XEND = RECESS.x - GAP; // the flap root's front is RECESS.x
    const WALL = RECESS.x - 0.078; // the aft wall, aft of the stowed root box's end plates (x ≤ 33.97)
    const sect = (c, x0, x1, zLo = (x) => ceiling.at(x, c)) => {
      const pts = [];
      for (let k = 0; k <= 10; k++) {
        const x = lerp(x0, x1, k / 10);
        pts.push([x, c, topAt(c, x)], [x, c, zLo(x)]);
      }
      return pts;
    };
    const yIn = 5.15;
    // the outer flap's skewed hinge carries its inboard end inboard as it deflects (while it still overlaps the
    // fixed root in x): the fixed pieces stop YOUT short of its rest face
    const yOut = RECESS.y - 0.04;
    // follow-up review 1: once the inner flap runs aft, these pieces read as a stack of white-outlined crates. The three
    // skin pieces are one shroud: their splits (x = XIN, y = yIn), their bottoms on the well-ceiling plane and their
    // inboard ends at the root are faint joints, their front on box.1u's TE face a mid gap line, so the hi lines left
    // are the shroud's silhouette and its trailing edge over the flap's root. The well's aft and outboard walls are
    // cavity faces: dark (gunmetal), outlined in lo, their seams with the shroud and the wing's lower skin faint, so
    // they recede.
    const cz = (x, a) => [x, a, ceiling.at(x, a)];
    const ceilJ = { plane: [cz(32, 5), cz(34, 5), cz(32, 7)], tone: "faint" };
    const xJ = (x) => ({ plane: [[x, 0, 0], [x, 1, 0], [x, 0, 1]], tone: "faint" });
    const yJ = (y) => ({ plane: [[0, y, 0], [1, y, 0], [0, y, 1]], tone: "faint" });
    const botJ = (ya, yb) => ({ plane: [[WELL_X, ya, bot(ya)], [XEND, ya, bot(ya)], [WELL_X, yb, bot(yb)]], tone: "faint" });
    const teJ = (ya, yb) => ({ plane: facePlane("te", ya, yb), tone: "mid" });
    const cavity = { material: "gunmetal", tone: "lo" };
    part({ key: "te.root.fill", points: [...sect(a0, fx("te", a0), XIN), ...sect(yIn, fx("te", yIn), XIN)], label: "Fixed trailing edge · wing root, over the wing-gear well", joints: [teJ(a0, yIn), ceilJ, xJ(XIN), yJ(yIn), yJ(a0)] });
    part({ key: "te.root.in", points: [...sect(a0, XIN, XEND), ...sect(yIn, XIN, XEND)], label: "Fixed trailing edge · wing root, over the wing-gear well", joints: [ceilJ, xJ(XIN), yJ(yIn), yJ(a0)] });
    part({ key: "te.root.out", points: [...sect(yIn, fx("te", yIn), XEND), ...sect(yOut, fx("te", yOut), XEND)], label: "Fixed trailing edge · wing root, over the wing-gear well", joints: [teJ(yIn, yOut), ceilJ, yJ(yIn)] });
    part({ key: "te.root.wall", points: [a0, yOut].flatMap((c) => [WALL, XEND].flatMap((x) => [[x, c, bot(c)], [x, c, ceiling.at(x, c)]])), label: "Fixed trailing edge · the wing-gear well's aft wall", ...cavity, joints: [ceilJ, botJ(a0, yOut), yJ(a0)] });
    // the recess's outboard side: a fixed wall under te.root.out, from the wing bottom up to the ceiling plane,
    // outboard of the down-locked leg near its pintle (|y| ≤ 6.66), so the deflected outer flap's Fowler slot never
    // opens onto the stowed leg
    // (it runs forward through the well to the well's front face, so the slit beside the outer flap's root never
    // opens onto the gear fitting either)
    const side = (c) => [WELL_X, fx("te", c), WALL].flatMap((x) => [[x, c, bot(c)], [x, c, ceiling.at(x, c)]]);
    part({ key: "te.root.side", points: [...side(yOut - 0.04), ...side(yOut)], label: "Fixed trailing edge · the wing-gear well's outboard wall", ...cavity, joints: [ceilJ, botJ(yOut - 0.04, yOut), xJ(WELL_X), xJ(WALL)] });
    F.root = { XIN, XEND, WALL, yIn, yOut };
  }
  const ft = devices.fixedTE;
  const teJoint = (a0, a1) => ({ jointCaps: { first: "faint", last: "faint" }, joints: [{ plane: facePlane("te", a0, a1), tone: "mid" }] });
  part({ key: "te.gap.a", rings: [tailRing(ft["gap.a"][0]), tailRing(ft["gap.a"][1])], label: "Fixed trailing edge · beside the outer flap", tone: "mid", ...teJoint(ft["gap.a"][0], ft["gap.a"][1]) });
  part({ key: "te.gap.b", rings: [tailRing(ft["gap.b"][0]), tailRing(ft["gap.b"][1])], label: "Fixed trailing edge · over flap-track fairing 6", tone: "mid", ...teJoint(ft["gap.b"][0], ft["gap.b"][1]) });
  // track fairings ("canoes"): a fixed fore part under the box, an aft part under the flap on its hinge group
  /** a canoe section: flat top on zTop(y), a half-ellipse under it; x is a number or x(y) (a swept plane) */
  const canoeRing = (x, yt, halfW, depth, zTop) => {
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const t = (i / 6) * Math.PI;
      const yy = yt - halfW * Math.cos(t);
      pts.push([typeof x === "function" ? x(yy) : x, yy, zTop(yy) - depth * Math.sin(t)]);
    }
    return pts;
  };
  const canoes = [];
  for (const t of M.CONTROLS.flapTracks) {
    if (t.id < 2) continue;
    const yt = t.y;
    const c = M.wingAt(yt).chord;
    // canoes, not needles (review round 1): about 0.08 × chord wide and 0.085 × chord deep, blunt at both ends
    const w = 0.08 * c;
    const D = 0.085 * c;
    const xTE = fx("te", yt);
    if (t.id === 6) {
      // one fixed teardrop under te.gap.b (y 25.77–25.97): it starts W.GAP behind the TE face, where the outboard
      // pylon's aft fairing (M4, y 25.25–26.15 under the box) ends, and runs past the TE to its tip
      // follow-up item 21: 0.38 m wide (it was 0.20, a needle beside the 0.6–1.2 m pods inboard): its outboard side on the
      // track station (25.97, truth §8), its inboard side 0.12 m from the outer flap's end (25.475), the inner aileron
      // 0.09 m outboard (26.06); both move past it in their own planes (the kinematics below prove the clearances)
      const yc = 25.78;
      const halfW = 0.19;
      const x0 = (a) => fx("te", a) + gx("te", a);
      // review round 3: a blunt pod, not a needle. Its width stays the fixed TE gap's 0.20 m (the outer flap and the
      // aileron, which it must clear through their travel, lie either side: DESIGN §11.5), so it is deeper and shorter
      // than before and keeps most of its section to a flat aft cap: it runs to 28% of the local chord past the TE, as
      // the split canoes' aft parts do, and its last ring keeps 0.8 of the width and 0.7 of the depth
      const te = at(yc).te;
      const L = Math.min(t.tipX, te + 0.28 * (te - fx("te", yc))) - x0(yc);
      const rings = [[0, 0.8, 0.72], [0.3, 1, 1], [0.7, 0.95, 0.88], [1, 0.62, 0.5]].map(([u, hw, dd]) => canoeRing(u === 0 ? x0 : x0(yc) + u * L, yc, halfW * hw, 0.6 * dd, bot));
      part({ key: "canoe.6", rings, label: "Flap-track fairing 6 · fixed, behind the outboard pylon, between the outer flap and the inner aileron", canoe: 6, tone: "mid", jointCaps: { first: "faint" } });
      canoes.push({ id: 6, y: yc });
      continue;
    }
    const flapId = yt < 12.45 ? "in" : yt < 18.99 ? "mid" : "out";
    const F = flaps[flapId];
    const xFront = at(yt).le + 0.48 * c;
    const fwdEnd = xTE - gx("te", yt);
    const L = fwdEnd - xFront;
    // the seam: the fore part ends W.GAP ahead of the TE face plane, the aft part starts W.GAP behind it
    const seamFwd = (a) => fx("te", a) - gx("te", a);
    const seamAft = (a) => fx("te", a) + gx("te", a);
    const fwd = [[0, 0.3, 0.22], [0.3, 0.82, 0.72], [0.65, 0.98, 0.97], [1, 1, 1]].map(([u, hw, dd]) => canoeRing(u === 1 ? seamFwd : xFront + u * L, yt, (w / 2) * hw, D * dd, bot));
    part({ key: `canoe.${t.id}.fwd`, rings: fwd, label: `Flap-track fairing ${t.id} · fixed fore part`, canoe: t.id, tone: "mid", jointCaps: { last: "faint" } });
    const aftStart = xTE + gx("te", yt);
    // the aft part runs about 28% of the local flap chord past the flap's TE (a pod, not a long spike)
    const flapTE = at(yt).te;
    const La = Math.min(t.tipX, flapTE + 0.28 * (flapTE - xTE)) - aftStart;
    const aft = [[0, 1, 1], [0.5, 0.95, 0.88], [0.82, 0.72, 0.62], [1, 0.42, 0.36]].map(([u, hw, dd]) => canoeRing(u === 0 ? seamAft : aftStart + u * La, yt, (w / 2) * hw, D * dd, F.bottom));
    part({ key: `canoe.${t.id}.aft`, group: F.group, rings: aft, label: `Flap-track fairing ${t.id} · aft part, runs out with the ${flapId === "in" ? "inner" : flapId === "mid" ? "mid" : "outer"} flap`, canoe: t.id, tone: "mid", jointCaps: { first: "faint" } });
    canoes.push({ id: t.id, y: yt, flap: flapId, xTE });
  }

  // ------------------------------------------------------------------ ailerons on one hinge line, the tip TE
  const ailGap = 0.06;
  const box6 = boxes[5];
  const faceTop = (a) => {
    const t = (a - box6.y[0]) / (box6.y[1] - box6.y[0]);
    const x0 = lerp(fx("te", box6.y[0]), fx("te", box6.y[1]), t);
    const top = lerp(topAt(box6.y[0], fx("te", box6.y[0])), topAt(box6.y[1], fx("te", box6.y[1])), t);
    return { x0, top, b: bot(a) };
  };
  const knuckle = 0.004; // the nose stays a knuckle: tangent within 4 mm of the TE face over −30…20°
  const ailC = (a) => {
    const F = faceTop(a);
    const r = (F.top - F.b) / 2;
    return { c: [F.x0 + r + gx("te", a, knuckle), a, F.b + r], r, b: F.b };
  };
  const ailAxis = { c0: ailC(26.0).c, c1: ailC(35.24).c };
  const ailRing = (a) => {
    const { c, r, b } = ailC(a);
    const pts = [];
    for (let i = 0; i <= 6; i++) {
      const t = (90 + 30 * i) * D2R;
      pts.push([c[0] + r * Math.cos(t), c[2] + r * Math.sin(t)]);
    }
    const s = sec(a);
    pts.push(...s.points.filter(([x, z]) => x > c[0] + 0.03 && z > b + 1e-6));
    pts.push([s.te, b]);
    return ring(a, pts);
  };
  const ailerons = {};
  const ag = devices.ailerons[0];
  const ailG = group({ key: "ail", kind: "hinge", parent: "pitch", axis: ailAxis, range: [-30, 20], probe: [sec(ag.y[0] + 0.5).te, ag.y[0] + 0.5, bot(ag.y[0] + 0.5)], want: [0, 0, -1], rules: (side) => [{ channel: "droop" }, { channel: "roll", table: side < 0 ? [[-1, -30], [0, 0], [1, 20]] : [[-1, 20], [0, 0], [1, -30]] }] });
  for (const [i, ail] of devices.ailerons.entries()) {
    const a0 = i === 0 ? ail.y[0] + ailGap : ail.y[0] + half;
    const a1 = i === devices.ailerons.length - 1 ? ail.y[1] - ailGap : ail.y[1] - half;
    const g = ailG;
    const rings = [ailRing(a0), ailRing(a1)];
    ailerons[ail.id] = { y: [a0, a1], group: g.key, top: topOf(rings.flat()) };
    const teJ = { plane: [[sec(a0).te, a0, 0], [sec(a0).te, a0, 1], [sec(a1).te, a1, 0]], tone: "mid" };
    part({ key: `ail.${ail.id}`, group: g.key, rings, label: { kind: "aileron", id: ail.id }, accent: "surfaces", aileron: ail.id, tone: "mid", jointCaps: { first: "faint", last: "faint" }, joints: [teJ] });
  }
  part({ key: "te.tip", rings: [tailRing(ft.tip[0]), tailRing(TIP)], label: "Fixed trailing edge · wingtip · static dischargers", wicks: true, ...teJoint(ft.tip[0], TIP) });

  // ------------------------------------------------------------------ spoilers: plates on the ξ .55–.70 facet
  const boxAt = (a) => boxes.find((b) => a >= b.y[0] - 1e-9 && a <= b.y[1] + 1e-9) ?? boxes[boxes.length - 1];
  const topZ = (x, a) => boxAt(a).top(x, a);
  const xiX = (a, xi) => at(a).le + xi * at(a).chord;
  const SPL_T = 0.05;
  const splGap = 0.025;
  const spoilers = [];
  const spl = devices.spoilers;
  // the plate over [a0, a1]: a plane z = c0 + cx·x + cy·y, W.GAP over the box top everywhere under it, as low as
  // that allows; `float` is how far it stands above that clearance at worst
  const plateOver = (a0, a1) => {
    const samples = [];
    for (let u = 0; u <= 1 + 1e-9; u += 1 / 12) {
      const a = lerp(a0, a1, u);
      for (let v = 0; v <= 1 + 1e-9; v += 1 / 8) {
        const x = lerp(xiX(a, 0.55), xiX(a, 0.7), v);
        samples.push([x, a, topZ(x, a)]);
      }
    }
    const p = planeFit(samples);
    const clear = GAP + 0.003; // the hull top rises a little between samples
    const rise = Math.max(...samples.map(([x, a, z]) => z + clear - (p.c0 + p.cx * x + p.cy * a)));
    const plane = { c0: p.c0 + rise, cx: p.cx, cy: p.cy };
    const float = Math.max(...samples.map(([x, a, z]) => plane.c0 + plane.cx * x + plane.cy * a - z - clear));
    return { plane, float };
  };
  for (const [i, s] of spl.entries()) {
    const prev = spl[i - 1];
    const next = spl[i + 1];
    const a0 = s.id === "1" ? s.y[0] : prev && Math.abs(prev.y[1] - s.y[0]) < 1e-6 ? s.y[0] + splGap : s.y[0] + half;
    const a1 = next && Math.abs(next.y[0] - s.y[1]) < 1e-6 ? s.y[1] - splGap : s.y[1] - half;
    // split at a station where one plate would stand more than 0.015 m off the facet (DESIGN §5.4)
    let pieces = [[a0, a1]];
    const whole = plateOver(a0, a1);
    const cut = stations.find((st) => st > a0 + 0.5 && st < a1 - 0.5);
    if (whole.float > 0.015 && cut !== undefined) pieces = [[a0, cut - splGap / 2], [cut + splGap / 2, a1]];
    pieces.forEach(([p0, p1], k) => {
      const { plane, float } = pieces.length === 1 ? whole : plateOver(p0, p1);
      const zPl = (x, a) => plane.c0 + plane.cx * x + plane.cy * a;
      const nPl = unit([-plane.cx, -plane.cy, 1]);
      const hingeAt = (a) => add([xiX(a, 0.55), a, zPl(xiX(a, 0.55), a)], mul(nPl, SPL_T / 2));
      const plateRing = (a) => {
        const c = hingeAt(a);
        const chordDir = unit([1, 0, plane.cx]);
        const up = unit(cross(chordDir, [0, -1, 0]));
        const upn = up[2] < 0 ? mul(up, -1) : up;
        const L = (xiX(a, 0.7) - xiX(a, 0.55)) / chordDir[0];
        const pts = [];
        for (let q = 0; q <= 4; q++) {
          const t = (90 + 45 * q) * D2R;
          pts.push(add(c, add(mul(chordDir, (SPL_T / 2) * Math.cos(t)), mul(upn, (SPL_T / 2) * Math.sin(t)))));
        }
        const te = add(c, mul(chordDir, L));
        pts.push(add(te, mul(upn, -SPL_T / 2)), add(te, mul(upn, -SPL_T / 2 + 0.018)));
        return pts.map((q) => [q[0], a, q[2]]);
      };
      const key = pieces.length === 1 ? `spl.${s.id}` : `spl.${s.id}${"ab"[k]}`;
      // the A380's split (captaindave.aero, "The A380 wing"; truth.md §8, S-secondary): spoilers 1 and 2 on the
      // `spoiler1` channel (35° as ground spoilers, 30° as speed brakes), 3-8 on `spoiler` (50° / 30°) and in roll on
      // the up-aileron wing (the source's limit is 45°; the control check deflects them 35° [E]: at 45° the clip's
      // frames moved a spoiler faster than the continuity check's halving test allows)
      const g = group({ key, kind: "hinge", parent: "pitch", axis: { c0: hingeAt(p0), c1: hingeAt(p1) }, range: [0, 50], probe: [xiX(p0, 0.7), p0, zPl(xiX(p0, 0.7), p0)], want: [0, 0, 1], rules: (side) => (s.id === "1" || s.id === "2" ? [{ channel: "spoiler1" }] : [{ channel: "spoiler" }, { channel: "roll", table: side < 0 ? [[-1, 35], [0, 0]] : [[0, 0], [1, 35]] }]) });
      const R0 = plateRing(p0);
      const R1 = plateRing(p1);
      // the TE face's top edge, and the face as a joint (item 16)
      const teTop = [R0[R0.length - 1], R1[R1.length - 1]];
      spoilers.push({ id: s.id, key, y: [p0, p1], float, group: g.key, plane, teTop });
      // a spoiler lies flush in the upper skin: its outline is a mid gap line, not a hi silhouette (at 1x the wing
      // read as a white wireframe); raised, its edge still reads against the skin
      part({ key, group: g.key, rings: [R0, R1], label: { kind: "spoiler", id: s.id }, accent: "surfaces", spoiler: s.id, sharp: 60, tone: "mid", jointCaps: { first: "faint", last: "faint" }, joints: [{ plane: [R0[R0.length - 1], R0[R0.length - 2], R1[R1.length - 1]], tone: "mid" }] });
    });
  }

  // ------------------------------------------------------------------ fence and tip light
  const fe = M.WING.fence;
  const zm = M.wingAt(TIP_OUT).zMid;
  const fencePoly = [[fe.xLE, zm], [fe.topChord[0], zm + fe.above], [fe.topChord[1], zm + fe.above], [fe.xTE, zm], [fe.bottomChord[1], zm - fe.below], [fe.bottomChord[0], zm - fe.below]];
  // the fence's 0.12 m by facing: its two leading edges chamfered (a ridge 0.05 m proud at mid-thickness), so the LE
  // catches its own tones; the faces keep their planes (a flat polygon in one tone read as a sheet)
  const fenceLE = (() => {
    const [le, tf, , , , bf] = fencePoly;
    const mid = (TIP + TIP_OUT) / 2;
    const off = (p, q, d) => {
      const ex = q[0] - p[0];
      const ez = q[1] - p[1];
      const l = Math.hypot(ex, ez) || 1;
      return [(ez / l) * d, (-ex / l) * d];
    };
    // outward normals of the LE edges (forward of them, in x-z)
    const nTop = off(tf, le, 0.05);
    const nBot = off(le, bf, 0.05);
    const pts = [[le[0] + (nTop[0] + nBot[0]) * 0.55, le[1] + (nTop[1] + nBot[1]) * 0.55], [tf[0] + nTop[0] * 0.6, tf[1] + nTop[1] * 0.6], [bf[0] + nBot[0] * 0.6, bf[1] + nBot[1] * 0.6]];
    return pts.map(([x, z]) => [x, mid, z]);
  })();
  part({ key: "fence", points: [...[TIP, TIP_OUT].flatMap((a) => fencePoly.map(([x, z]) => [x, a, z])), ...fenceLE], smooth: false, label: "Wingtip fence · 2.28 m tall, 1.18 m above and 1.10 m below the chord · obstruction lights", fence: true });
  // fu/f4-wings: the housing's dome ends flush with the fence's outer face (TIP + len + r = TIP_OUT): the span over the
  // fences stays 79.75 m with nothing outboard of them (it stood 0.13 m out at r .15, len .1: 80.02 m drawn)
  const tipLight = { x: 47.47, z: 6.33, r: 0.11, len: FENCE_T - 0.11 };

  CACHE = { W, GAP, sec, at, bot, topAt, fx, gx, boxes, ceiling, parts, groups, flaps, ailerons, spoilers, canoes, ends, droopAxis, slatAxis, ailAxis, fencePoly, fenceRidge: fenceLE[1], zm, tipLight, topZ, xiX };
  return CACHE;
}

// ---------------------------------------------------------------------------------------------
// per side: kit points, axes, group names
// ---------------------------------------------------------------------------------------------
const sideKit = (W, side) => ({
  P: (p) => W.kit([p[0], side * p[1], p[2]]),
  D: (d) => W.kitDir([d[0], side * d[1], d[2]]),
});
const gname = (s, key) => `wing.${s}.${key}`;
const pname = (s, key) => `wings.${s}.${key}`;
/** A kit hinge axis through two model points, signed so a positive value moves `probe` along `want`. */
function axisFor(TURN, K, c0, c1, probe, want) {
  const k0 = K.P(c0);
  let a = unit(sub(K.P(c1), k0));
  const q = rotateAbout(TURN, K.P(probe), k0, a, 5);
  if (dot(sub(q, K.P(probe)), K.D(want)) < 0) a = mul(a, -1);
  return { point: k0, axis: a };
}

// ---------------------------------------------------------------------------------------------
// groups and rules (DESIGN §3.1, §3.3)
// ---------------------------------------------------------------------------------------------
export function groups(ctx) {
  const { W, M, TURN } = ctx;
  const G = geometry(W, M);
  for (const [s, side] of W.SIDES) {
    const K = sideKit(W, side);
    for (const g of G.groups) {
      const name = gname(s, g.key);
      const parent = g.parent === "pitch" ? "pitch" : gname(s, g.parent);
      if (g.kind === "slide") ctx.group(name, { parent, slide: { direction: K.D(g.dir), travel: W.m(g.travel) } });
      else {
        const { point, axis } = axisFor(TURN, K, g.axis.c0, g.axis.c1, g.probe, g.want);
        ctx.group(name, { parent, hinge: { point, axis, range: g.range } });
      }
      for (const rule of g.rules(side)) ctx.rule({ group: name, ...rule, ...(g.kind === "slide" && rule.table ? { table: rule.table.map(([x, v]) => [x, W.m(v)]) } : {}) });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// parts, planes, lights, labels, accents, clips
// ---------------------------------------------------------------------------------------------
const LABEL = {
  droop: (id) => `const n=Math.round(s.slat||0);return "Droop nose DN${id} · "+(n>0?n+"° · CONF "+M.confName(s.slat,s.flap):"stowed")+" · seals the leading edge inboard of the inner engine";`,
  slat: (id) => `const n=Math.round(s.slat||0);return "Slat S${id} · "+(n>0?n+"° in CONF "+M.confName(s.slat,s.flap):"stowed");`,
  flap: (id) => `const n=Math.round(s.flap||0);return "${{ in: "Inner", mid: "Mid", out: "Outer" }[id]} flap · Fowler, "+(n>0?n+"° in "+M.confName(s.slat,s.flap):"stowed");`,
  // the drawn angle (the page's channels, not the model's speed-brake state, which B does not set): droop plus the
  // ground spoilers' 25° up plus roll (left [[-1,-30],[0,0],[1,20]], right mirrored), clamped as the follow rule is
  aileron: (id, side) => `const r=(pv&&pv.roll)||0;const rl=${side < 0 ? "r<0?30*r:20*r" : "r>0?-30*r:-20*r"};const n=Math.round(Math.max(-30,Math.min(20,(s.aileronDroop||0)+((pv&&pv.aileron)||0)+rl)));return "${{ in: "Inner", mid: "Mid", out: "Outer" }[id]} aileron · "+(n>0?"down "+n+"°"+((s.aileronDroop||0)>0.5?" (drooped with the flaps)":""):n<0?"up "+(-n)+"°":"neutral")+" · roll −30°/+20°";`,
  spoiler: (id, side) =>
    id === "1" || id === "2"
      ? `return "Spoiler ${id} · ground spoiler and speed brake · "+Math.round(Math.max(0,Math.min(50,(pv&&pv.spoiler1)||0)))+"°";`
      : `const r=(pv&&pv.roll)||0;const roll=${side < 0 ? "r<0?-35*r:0" : "r>0?35*r:0"};return "Spoiler ${id} · roll, speed brake and ground spoiler · "+Math.round(Math.max(0,Math.min(50,((pv&&pv.spoiler)||0)+roll)))+"°";`,
};

export function build(ctx) {
  const { W, M, TURN, P: proj } = ctx;
  const G = geometry(W, M);
  const m = W.m;
  const accentsAdded = new Set();
  for (const [s, side] of W.SIDES) {
    const K = sideKit(W, side);
    const PS = (list) => list.map(K.P);
    const made = {};
    for (const spec of G.parts) {
      const name = pname(s, spec.key);
      const group = spec.group ? gname(s, spec.group) : "pitch";
      const flats = (spec.flats ?? []).map(({ plane, inside }) => {
        const [a, b, c] = plane.map(K.P);
        let n = unit(cross(sub(b, a), sub(c, a)));
        if (dot(n, K.P(inside)) > dot(n, a)) n = mul(n, -1);
        return { n, d: dot(n, a) };
      });
      const common = { name, group, tone: spec.tone ?? "hi", material: spec.material ?? "steel", crease: "faint" };
      let partObj;
      // joints (kit patch 15): planes given as three model points, mirrored per side like the flats
      const joints = (spec.joints ?? []).map((j) => {
        const plane = Array.isArray(j) ? j : j.plane;
        const [a, b, c] = plane.map(K.P);
        const n = unit(cross(sub(b, a), sub(c, a)));
        return { n, d: dot(n, a), ...(j.tone ? { tone: j.tone } : {}) };
      });
      if (spec.points) partObj = ctx.hull({ ...common, points: PS(spec.points), smooth: spec.smooth ?? true, sharp: spec.sharp ?? 35, ...(spec.flatNormal ? { flatNormals: [K.D(spec.flatNormal)] } : {}), ...(joints.length ? { joints } : {}) });
      else {
        // near-flat faces (corner normals within 6° of their own: the box panels' skins) shade flat with the kit's
        // crossfade: with the hull's 13 sub-bands a band boundary could sweep a whole panel in one step (the quick
        // audit's continuity birth on box.6 at pitch 4.5°)
        partObj = ctx.hull({ ...common, rings: spec.rings.map(PS), flats, smooth: true, sharp: spec.sharp ?? 35, flatAngle: spec.flatAngle ?? 6, ...(spec.jointCaps ? { jointCaps: spec.jointCaps } : {}), ...(joints.length ? { joints } : {}) });
      }
      made[spec.key] = partObj;
      // labels
      if (typeof spec.label === "string") ctx.label(name, spec.label, spec.lamps ? "light:landing" : null);
      else if (spec.label) ctx.label(name, new Function("s", "pv", LABEL[spec.label.kind](spec.label.id, side)), spec.label.kind === "flap" || spec.label.kind === "slat" || spec.label.kind === "droop" ? "flaps" : null);
    }
    // the tip light housing: a round on the tip face, ahead of the fence
    const tl = G.tipLight;
    const tip = ctx.round({ name: pname(s, "tiplight"), group: "pitch", F: { o: K.P([tl.x, TIP, tl.z]), a: K.D([0, 1, 0]), u: K.D([1, 0, 0]), v: [0, 0, 1] }, s0: 0, s1: m(tl.len), r: m(tl.r), ends: ["flat", "dome"], tone: "hi", material: "chrome" });
    ctx.label(pname(s, "tiplight"), side < 0 ? "Left wingtip lights · red navigation light, white strobe (double flash)" : "Right wingtip lights · green navigation light, white strobe (double flash)", "light:nav");
    made.tiplight = tip;

    details(ctx, G, s, side, K, made);
    lights(ctx, G, s, side, K, made);
  }
  void accentsAdded;
  void proj;

  // follow-up item 16: deflected edges lift to hi with their channels (0 at rest, 1 from about 4° of travel)
  const sm = (x) => `F.smooth(0.3, 4, ${x})`;
  const ailAngle = (side) => `Math.abs((ch.droop || 0) + ((ch.roll || 0) ${side < 0 ? "< 0 ? 30" : "> 0 ? -30"} * (ch.roll || 0) : ${side < 0 ? "20" : "-20"} * (ch.roll || 0)))`;
  const splAngle = (side) => `(ch.spoiler || 0) + ((ch.roll || 0) ${side < 0 ? "< 0 ? -35" : "> 0 ? 35"} * (ch.roll || 0) : 0)`;
  ctx.vary("a3-m3-dfl-slat", sm("ch.slat || 0"));
  ctx.vary("a3-m3-dfl-flap", sm("ch.flap || 0"));
  ctx.vary("a3-m3-dfl-flap-rest", `1 - ${sm("ch.flap || 0")}`);
  ctx.vary("a3-m3-dfl-spl1", sm("ch.spoiler1 || 0"));
  for (const [s, side] of W.SIDES) {
    ctx.vary(`a3-m3-dfl-ail-${s}`, sm(ailAngle(side)));
    ctx.vary(`a3-m3-dfl-ail-${s}-rest`, `1 - ${sm(ailAngle(side))}`);
    ctx.vary(`a3-m3-dfl-spl-${s}`, sm(splAngle(side)));
  }
  // CSS for the module's own classes (light first, dark overrides after)
  // follow-up item 16: the joint seams (a stowed device against the box, a fixed strip against its neighbour) are gap
  // lines: lo by daylight, between lo and mid at night (the kit draws a joint mid); item 22: at phone width the rib and
  // joint fastener rows fade and the spar rows space out (the dots keep their screen size while the panels shrink)
  ctx.css(`.iso{--a3-gap:#969ca2}
.iso[data-theme="dark"]{--a3-gap:#5c636a}
.a3-stage [data-name^="wings."] [data-r="jm"]{stroke:var(--a3-gap)}
/* follow-up review 1 (tone hierarchy): by night the structure's outlines (silhouettes, fences, deflected edges) sit
   near 165 lum, under the one lit phase accent (about 250), as the reference figures keep structure dim */
.iso[data-theme="dark"] .a3-stage [data-name^="wings."][data-mat]{--anatomy-hi:#a1a7ad}
@media (max-width:599px){.a3-stage .a3-rv-rib{opacity:0}.a3-stage .a3-rv-spar{stroke-dasharray:.01 7}}
.a3-m3-lens{fill:color-mix(in srgb,var(--anatomy-paper) 70%,var(--anatomy-mid));stroke:var(--anatomy-mid);stroke-width:var(--anatomy-weight);vector-effect:non-scaling-stroke}
.a3-m3-glint{fill:var(--anatomy-hi);opacity:.55;stroke:none}
.a3-m3-wick{fill:var(--anatomy-mid);stroke:none}
.iso[data-theme="dark"] .a3-m3-lens{fill:color-mix(in srgb,var(--anatomy-paper) 55%,var(--anatomy-lo))}`);

  // verification hook: group values for channel overrides through the page's own rules (drive.mjs shots)
  ctx.script("A3.m3 = { values: (extra) => F.makeFollow(DATA.rules, DATA.groups, TURN)({ ...A3.ch, ...extra }) };");
  // item 22: the canvas painter bakes the phone rivet rule (a media query) at mount; a window crossing 600 px after
  // mount re-bakes the wing and tail parts (kit patch 18's restyle) and repaints, so both widths keep their rows
  ctx.script(`(() => {
  if (typeof matchMedia !== "function") return;
  const mq = matchMedia("(max-width:599px)");
  const again = () => {
    const cv = A3.canvas;
    if (!cv || !cv.restyle) return;
    cv.restyle((name) => name.startsWith("wings.") || name.startsWith("tail."));
    cv.paint();
  };
  if (mq.addEventListener) mq.addEventListener("change", again);
  else if (mq.addListener) mq.addListener(again);
})();`);

  clips(ctx);
  void TURN;
}

// ---------------------------------------------------------------------------------------------
// detail planes: fastener rows, joints, fairing ends, wicks, the fence rule, lenses
// ---------------------------------------------------------------------------------------------
function details(ctx, G, s, side, K, made) {
  const { W } = ctx;
  const m = W.m;
  // a plane carrying one straight segment from A to B (model), on the surface with outward normal n (model)
  const segPlane = (partObj, A, B, n, markup, fade = [0.02, 0.25]) => {
    const a = K.P(A);
    const b = K.P(B);
    const u = sub(b, a);
    const L = len(u);
    const N = unit(K.D(n));
    const v = unit(cross(N, u));
    ctx.plane(partObj, { o: a, u, v, normal: N, fade, svg: markup(L) });
  };
  // follow-up item 22: fastener rows carry their kind; at phone width only the spar rows stay, sparser (CSS below)
  const dotted = (tone = "lo", kind = "rib") => (L) => `<path class="iso-line a3-rv-${kind}" data-tone="${tone}" data-dotted="" d="M0 0H${L.toFixed(2)}"/>`;
  // follow-up item 16: an edge that is a gap line at rest lifts to a hi line as its device deflects (a vary class
  // driven by the device's channel; the kit's own outline there is a lo joint or a mid outline)
  const hiEdge = (cls) => (L) => `<g class="${cls}" style="opacity:0"><path class="iso-line" data-tone="hi" d="M0 0H${L.toFixed(2)}"/></g>`;
  // a TE that is a true silhouette: mid at rest, hi deflected (its outline segment is a joint, drawn under the planes)
  const teEdge = (cls) => (L) => `<g class="${cls}-rest"><path class="iso-line" data-tone="mid" d="M0 0H${L.toFixed(2)}"/></g>${hiEdge(cls)(L)}`;
  const rule = (tone = "faint") => (L) => `<path class="iso-line" data-tone="${tone}" d="M0 0H${L.toFixed(2)}"/>`;
  const topN = (box, x, a) => {
    const e = 0.05;
    const z0 = box.top(x, a);
    return unit([-(box.top(x + e, a) - z0) / e, -(box.top(x, a + e) - z0) / e, 1]);
  };
  // box tops: front and rear spar fastener rows (ξ just aft of the LE face, ξ 0.62), and a row beside each joint
  G.boxes.forEach((box, i) => {
    const partObj = i === 0 ? made["box.1f"] : made[`box.${i + 1}`];
    const [a0, a1] = box.y;
    const rows = [
      (a) => G.fx("le", a) + 0.06,
      (a) => G.at(a).le + 0.62 * G.at(a).chord,
    ];
    for (const xAt of rows) {
      const A = [xAt(a0), a0, box.top(xAt(a0), a0)];
      const B = [xAt(a1), a1, box.top(xAt(a1), a1)];
      if (i === 0 && A[0] > WELL_X - 0.05) continue;
      segPlane(partObj, A, B, topN(box, (A[0] + B[0]) / 2, (a0 + a1) / 2), dotted("lo", "spar"));
    }
    // rows beside the outboard joint (chordwise, LE face edge to TE face edge, 0.08 m inboard of the joint)
    if (i < G.boxes.length - 1) {
      const a = a1 - 0.08;
      const xs = [G.fx("le", a), G.fx("te", a)];
      const A = [xs[0], a, box.top(xs[0], a)];
      const B = [xs[1], a, box.top(xs[1], a)];
      const host = i === 0 ? made["box.1u"] : partObj;
      segPlane(i === 0 ? made["box.1f"] : host, A, [i === 0 ? Math.min(B[0], WELL_X) : B[0], a, box.top(i === 0 ? Math.min(B[0], WELL_X) : B[0], a)], topN(box, (A[0] + B[0]) / 2, a), dotted("faint"));
    }
  });
  // rib rows: one plane per rib in its y-plane section, the dotted row following the box top from the LE face
  // edge to the TE face edge (about 1.6 m apart; the real rib pitch is about half that)
  G.boxes.forEach((box, i) => {
    if (i === 0) return;
    const partObj = made[`box.${i + 1}`];
    const [y0, y1] = box.y;
    const n = Math.max(1, Math.round((y1 - y0) / 1.6));
    for (let k = 0; k < n; k++) {
      const a = lerp(y0, y1, (k + 0.5) / n);
      const xs = [];
      const xa = G.fx("le", a);
      const xb = G.fx("te", a);
      for (let j = 0; j <= 8; j++) xs.push(lerp(xa, xb, j / 8));
      const pts = xs.map((x) => [x, a, box.top(x, a)]);
      const o = K.P(pts[0]);
      const u = unit(K.D([1, 0, 0]));
      const v = [0, 0, 1];
      const d = pts.map((p, j) => `${j ? "L" : "M"}${m(p[0] - pts[0][0]).toFixed(2)} ${m(p[2] - pts[0][2]).toFixed(2)}`).join("");
      ctx.plane(partObj, { o, u, v, normal: topN(box, (xa + xb) / 2, a), fade: [0.02, 0.25], svg: `<path class="iso-line a3-rv-rib" data-tone="faint" data-dotted="" d="${d}"/>` });
    }
  });
  // slats and droops: a skin joint along the top, a third of the way back from the nose (ends on the end edges)
  for (const spec of G.parts.filter((p) => p.nose)) {
    const [r0, r1] = spec.rings;
    const pick = (r) => {
      // the ring point nearest ξ 0.04 on top
      const top = r.filter((p) => p[2] > Math.min(...r.map((q) => q[2])) + 0.6 * (Math.max(...r.map((q) => q[2])) - Math.min(...r.map((q) => q[2]))));
      return top.reduce((best, p) => (Math.abs(p[0] - (Math.min(...r.map((q) => q[0])) + 0.45 * (Math.max(...r.map((q) => q[0])) - Math.min(...r.map((q) => q[0]))))) < Math.abs(best[0] - (Math.min(...r.map((q) => q[0])) + 0.45 * (Math.max(...r.map((q) => q[0])) - Math.min(...r.map((q) => q[0]))))) ? p : best), top[0]);
    };
    const A = pick(r0);
    const B = pick(r1);
    segPlane(made[spec.key], A, B, [0, 0, 1], rule("faint"));
    {
      // the aft top corner of each end ring (the edge on the slat's aft face, against the box at rest)
      const corner = (r) => {
        const xm = Math.max(...r.map((p) => p[0]));
        return r.filter((p) => p[0] > xm - 0.03).reduce((best, p) => (p[2] > best[2] ? p : best));
      };
      segPlane(made[spec.key], corner(r0), corner(r1), [0, 0, 1], hiEdge("a3-m3-dfl-slat"));
    }
    // the lit accent on the leading edge (the nose line, ζ 0.42)
    const nose = (r) => r.reduce((best, p) => (p[0] < best[0] ? p : best), r[0]);
    const NA = nose(r0);
    const NB = nose(r1);
    const a = K.P(NA);
    const b = K.P(NB);
    const u = sub(b, a);
    const N = unit(K.D([-1, 0, 0.35]));
    ctx.accent("slats", { part: made[spec.key], o: a, u, v: unit(cross(N, u)), normal: N, fade: [0.02, 0.25], svg: `<path d="M0 0H${len(u).toFixed(2)}"/>` });
  }
  // flaps: a fastener row at 30% of the flap chord, the accent on the TE, and the track fairing caps on the top
  for (const [id, F] of Object.entries(G.flaps)) {
    const partObj = made[`flap.${id}`];
    const at30 = (R) => {
      const x = R.c[0] + 0.3 * (R.te - R.c[0]);
      return [x, R.c[1], F.top(x, R.c[1])];
    };
    const te = (R) => [R.te, R.c[1], R.b + 0.06 * G.at(R.c[1]).thickness];
    // the inner flap is split at the recess's y (M5 R1): the root runs of the row and the accent lie on its aft wall
    const runs = F.recess ? [[made["flap.in.wall"], 0, (F.recess.y - F.y[0]) / (F.y[1] - F.y[0])], [partObj, (F.recess.y - F.y[0]) / (F.y[1] - F.y[0]), 1]] : [[partObj, 0, 1]];
    for (const [host, t0, t1] of runs) {
      const P0 = lerp3(at30(F.A), at30(F.B), t0);
      const P1 = lerp3(at30(F.A), at30(F.B), t1);
      segPlane(host, [P0[0], P0[1], F.top(P0[0], P0[1])], [P1[0], P1[1], F.top(P1[0], P1[1])], [0, 0, 1], dotted("lo"));
      segPlane(host, lerp3(te(F.A), te(F.B), t0), lerp3(te(F.A), te(F.B), t1), [0.2, 0, 1], teEdge("a3-m3-dfl-flap"));
      const a = K.P(lerp3(te(F.A), te(F.B), t0));
      const b = K.P(lerp3(te(F.A), te(F.B), t1));
      const u = sub(b, a);
      const N = unit(K.D([0.2, 0, 1]));
      ctx.accent("flaps", { part: host, o: a, u, v: unit(cross(N, u)), normal: N, fade: [0.02, 0.25], svg: `<path d="M0 0H${len(u).toFixed(2)}"/>` });
    }
  }
  // ailerons: hinge-fairing caps on top, wicks on the TE, the accent on the TE
  for (const [id, Ai] of Object.entries(G.ailerons)) {
    const partObj = made[`ail.${id}`];
    const [a0, a1] = Ai.y;
    const n = Math.max(2, Math.round((a1 - a0) / 1.2));
    for (let k = 0; k < n; k++) {
      const a = lerp(a0, a1, (k + 0.5) / n);
      const x = G.fx("te", a) + 0.3;
      const A = [x, a, Ai.top(x, a)];
      const B = [x + 0.45, a, Ai.top(x + 0.45, a)];
      const w = m(0.07);
      segPlane(partObj, A, B, [0.3, 0, 1], (L) => `<rect class="iso-line" data-tone="faint" x="0" y="${(-w).toFixed(2)}" width="${L.toFixed(2)}" height="${(2 * w).toFixed(2)}" rx="${(w * 0.9).toFixed(2)}"/>`);
    }
    const te = (a) => [G.at(a).te, a, G.bot(a) + 0.03 * G.at(a).thickness];
    wicks(ctx, K, partObj, te, [a0, a1], 2);
    {
      // on the ring's TE vertex (the accent's line sits 3% of the thickness above it)
      const tv = (a) => [G.sec(a).te, a, G.bot(a)];
      segPlane(partObj, tv(a0), tv(a1), [0.2, 0, 1], teEdge(`a3-m3-dfl-ail-${s}`));
    }
    const a = K.P(te(a0));
    const b = K.P(te(a1));
    const u = sub(b, a);
    const N = unit(K.D([0.2, 0, 1]));
    ctx.accent("surfaces", { part: partObj, o: a, u, v: unit(cross(N, u)), normal: N, fade: [0.02, 0.25], svg: `<path d="M0 0H${len(u).toFixed(2)}"/>` });
  }
  wicks(ctx, K, made["te.tip"], (a) => [G.at(a).te, a, G.bot(a) + 0.03 * G.at(a).thickness], [35.6, TIP - 0.3], 3);
  // spoilers: the lit accent on the TE, a fastener row along the hinge
  for (const S of G.spoilers) {
    const partObj = made[S.key];
    const zPl = (x, a) => S.plane.c0 + S.plane.cx * x + S.plane.cy * a;
    const te = (a) => [G.xiX(a, 0.7), a, zPl(G.xiX(a, 0.7), a) + 0.018];
    const hi = (a) => [G.xiX(a, 0.565), a, zPl(G.xiX(a, 0.565), a) + 0.047];
    const N = [-S.plane.cx, -S.plane.cy, 1];
    segPlane(partObj, hi(S.y[0]), hi(S.y[1]), N, dotted("faint"));
    segPlane(partObj, S.teTop[0], S.teTop[1], N, hiEdge(S.id === "1" || S.id === "2" ? "a3-m3-dfl-spl1" : `a3-m3-dfl-spl-${s}`));
    const a = K.P(te(S.y[0]));
    const b = K.P(te(S.y[1]));
    const u = sub(b, a);
    const NN = unit(K.D(N));
    ctx.accent("surfaces", { part: partObj, o: a, u, v: unit(cross(NN, u)), normal: NN, fade: [0.02, 0.25], svg: `<path d="M0 0H${len(u).toFixed(2)}"/>` });
  }
  // the fence: a rule inside its leading edges on the outer face
  {
    const fp = G.fencePoly;
    const inset = 0.09;
    const [le, t0] = [fp[0], fp[1]];
    const b0 = fp[5];
    const along = (p, q, d) => [p[0] + (q[0] - p[0]) * d, p[1] + (q[1] - p[1]) * d];
    // offset the two LE edges inward and meet at the LE; ends on the top and bottom edges
    const top = [t0[0] + inset * 1.8, t0[1]];
    const bot = [b0[0] + inset * 1.8, b0[1]];
    const nose = [le[0] + inset * 2.4, le[1]];
    void along;
    const o = K.P([le[0], TIP_OUT, le[1]]);
    const u = K.D([1, 0, 0]);
    const v = [0, 0, 1];
    const N = K.D([0, 1, 0]);
    const pt = ([x, z]) => `${m(x - le[0]).toFixed(2)} ${m(z - le[1]).toFixed(2)}`;
    ctx.plane(made.fence, { o, u, v, normal: N, fade: [0.02, 0.25], svg: `<path class="iso-line" data-tone="faint" d="M${pt(top)}L${pt(nose)}L${pt(bot)}"/>` });
    // the same rule on the inner face (seen from inboard)
    ctx.plane(made.fence, { o: K.P([le[0], TIP, le[1]]), u, v, normal: mul(N, -1), fade: [0.02, 0.25], svg: `<path class="iso-line" data-tone="faint" d="M${pt(top)}L${pt(nose)}L${pt(bot)}"/>` });
  }
}

/** n static dischargers along a TE line te(a) over [a0, a1]: a short line aft ending on a dot. */
function wicks(ctx, K, partObj, te, [a0, a1], n) {
  const { W } = ctx;
  const m = W.m;
  for (let k = 0; k < n; k++) {
    const a = lerp(a0, a1, (k + 0.5) / n);
    const A = te(a);
    const o = K.P(A);
    const u = K.D([1, 0, 0]);
    const v = K.D([0, 1, 0]);
    const N = [0, 0, 1];
    const L = m(0.16);
    ctx.plane(partObj, { o, u, v, normal: N, fade: [-0.2, 0.2], svg: `<path class="iso-line" data-tone="mid" d="M0 0H${L.toFixed(2)}"/><circle class="a3-m3-wick" cx="${L.toFixed(2)}" cy="0" r="${m(0.022).toFixed(2)}"/>` });
  }
}

// ---------------------------------------------------------------------------------------------
// lights and lamps (DESIGN §6.2): nav, strobes, obstruction on the tips; landing, taxi and camera lamps
// ---------------------------------------------------------------------------------------------
function lights(ctx, G, s, side, K, made) {
  const { W, M } = ctx;
  const m = W.m;
  const L = side < 0 ? "L" : "R";
  const LT = side < 0 ? "Left" : "Right";
  const tl = G.tipLight;
  const out = TIP + tl.len;
  // nav (red left, green right) at the front of the housing's dome (on it, along its normal), strobe at the dome's apex
  // (fu/f4-wings: both on the dome, inside the fence plane |y| ≤ TIP_OUT)
  ctx.light({ id: `nav${LT}`, part: pname(s, "tiplight"), group: "pitch", at: K.P([tl.x - tl.r * 0.8, out + tl.r * 0.6, tl.z + 0.02]), normal: unit(K.D([-0.8, 0.6, 0])), kind: "nav", color: side < 0 ? "red" : "green", lens: 0.07, halo: 3.2, switch: "nav", sector: side < 0 ? [-110, 5] : [-5, 110], settle: 0.22 }); // the soft edge (±5°) lies past dead ahead: both burn full nose-on
  ctx.light({ id: `strobe${LT}`, part: pname(s, "tiplight"), group: "pitch", at: K.P([tl.x + 0.02, out + tl.r * 0.95, tl.z]), normal: K.D([0, 1, 0]), kind: "strobe", color: "white", lens: 0.06, halo: 3.6, switch: "strobe", flash: { period: 1.0, offsets: [0, 0.11], rise: 0.05, fall: 0.04, phase: 0 }, settle: 0.2 });
  // obstruction: fence top and bottom
  const fp = G.fencePoly;
  const mid = (TIP + TIP_OUT) / 2;
  const topX = M.LIGHTS.obstruction.find((o) => o.id === `obstr${LT}Top`).at[0];
  const botX = M.LIGHTS.obstruction.find((o) => o.id === `obstr${LT}Bottom`).at[0];
  // follow-up review 1 (pops at 220°): the top light's housing, a small dome on the fence's top edge. Hosted on the
  // fence, the light's halo was drawn in the fence's slot, which sorts behind box.6 and te.tip until the tip face turns
  // edge-on, so half the halo appeared in one 0.02° step. The dome stands above the wing, so it draws after the wing
  // from every bearing the camera reaches (and after the fence, whose top face it sits on).
  // It sits flush on the fence's top face there: the plane through the chamfered LE's top ridge point and the top's aft
  // edge, which slopes 3.6° down aft (a level base interlocked it by 16 mm). It is 0.12 m across, centred 0.02 m
  // outboard of the tip face, so it overhangs the fence's inboard face by 0.04 m and its footprint always meets the wing
  // tip's: the kit orders two parts only where their footprints meet, and centred on the fence it cleared box.6's by
  // 0.15 px with the tip edge-on, where the painter left it behind the wing.
  const HR = 0.06;
  const HL = 0.025;
  const HY = TIP + 0.02;
  const R = G.fenceRidge;
  const A0 = [fp[2][0], TIP, fp[2][1]];
  const A1 = [fp[2][0], TIP_OUT, fp[2][1]];
  let hn = unit(cross(sub(A0, R), sub(A1, R)));
  if (hn[2] < 0) hn = mul(hn, -1);
  const ho = [topX, HY, R[2] - (hn[0] * (topX - R[0]) + hn[1] * (HY - R[1])) / hn[2]];
  const hu = unit(cross([0, 1, 0], hn));
  const hv = cross(hn, hu);
  const housing = ctx.round({ name: pname(s, "obstr.top"), group: "pitch", fixed: false, F: { o: K.P(ho), a: K.D(hn), u: K.D(hu), v: K.D(hv) }, s0: 0, s1: m(HL), r: m(HR), ends: ["flat", "dome"], tone: "hi", material: "chrome" });
  ctx.label(pname(s, "obstr.top"), `${side < 0 ? "Left" : "Right"} fence obstruction light (top) · steady white, lit with the nav lights on the ground`, "light:nav");
  made["obstr.top"] = housing;
  ctx.light({ id: `obstr${LT}Top`, part: pname(s, "obstr.top"), group: "pitch", at: K.P(add(ho, mul(hn, HL + 0.5 * HR))), normal: [0, 0, 1], kind: "obstruction", color: "white", lens: 0.05, halo: 2.4, switch: "obstruction", settle: 0.22 });
  ctx.light({ id: `obstr${LT}Bottom`, part: pname(s, "fence"), group: "pitch", at: K.P([botX, mid, fp[5][1]]), normal: K.D([0, 0.5, -1]), kind: "obstruction", color: "white", lens: 0.05, halo: 2.4, switch: "obstruction", settle: 0.22 });
  // root lamps on le.root: project the model positions onto the strip's nearest face, lens planes there
  const root = made["le.root"];
  const lensOn = (partObj, at, r = 0.11) => {
    const k = K.P(at);
    const faces = partObj.world.faces;
    const pts = partObj.world.points;
    let best = null;
    for (const f of faces) {
      const d = dot(f.n, k) - dot(f.n, pts[f.ring[0]]);
      const q = sub(k, mul(f.n, d));
      const inside = f.ring.every((vi, j) => dot(cross(sub(pts[f.ring[(j + 1) % f.ring.length]], pts[vi]), sub(q, pts[vi])), f.n) >= -1e-6);
      const score = Math.abs(d) + (inside ? 0 : 1e3);
      if (!best || score < best.score) best = { f, d, score };
    }
    const n = best.f.n;
    const o = sub(k, mul(n, best.d));
    const u = unit(cross(n, [0, 0, 1]));
    const v = cross(n, u);
    const R = m(r);
    ctx.plane(partObj, { o, u, v, normal: n, fade: [0.02, 0.3], svg: `<ellipse class="a3-m3-lens" rx="${R.toFixed(2)}" ry="${(R * 0.72).toFixed(2)}"/><ellipse class="a3-m3-glint" cx="${(-R * 0.3).toFixed(2)}" cy="${(-R * 0.25).toFixed(2)}" rx="${(R * 0.28).toFixed(2)}" ry="${(R * 0.18).toFixed(2)}"/>` });
    return { o, n };
  };
  // aims as bearings from the nose (+ outboard) and depressions, model frame (M8's lamp defaults give the spreads)
  const aim = (bearing, depression) => [-Math.cos(depression * D2R) * Math.cos(bearing * D2R), side * Math.cos(depression * D2R) * Math.sin(bearing * D2R), -Math.sin(depression * D2R)];
  const beam = M.LIGHTS.landingBeam;
  for (const lamp of M.LIGHTS.landing.filter((l) => l.id.startsWith(`land${L}`))) {
    const mod = [lamp.at[0], Math.abs(lamp.at[1]), lamp.at[2]];
    const { o, n } = lensOn(root, mod, 0.13);
    // forward and toed out 1.6° (AC 2-10-0), 3.5° down [E]
    ctx.lamp({ id: lamp.id, part: pname(s, "le.root"), group: "pitch", at: o, lensNormal: n, dir: unit(W.kitDir(aim(beam.toeOutDeg, 3.5))), switch: "landing" });
  }
  const taxi = M.LIGHTS.taxi.find((l) => l.id === `taxi${L}`);
  {
    const mod = [taxi.at[0], Math.abs(taxi.at[1]), taxi.at[2]];
    const { o, n } = lensOn(root, mod, 0.1);
    // the beam covers 0–26° outboard: aimed at 13°, 5° down [E]
    ctx.lamp({ id: taxi.id, part: pname(s, "le.root"), group: "pitch", at: o, lensNormal: n, dir: unit(W.kitDir(aim(Math.abs(taxi.beam.to) / 2, 5))), switch: "taxi" });
  }
  // the wing camera light under box.2, aimed at the wing gear
  const cam = M.LIGHTS.camera.find((c) => c.id === `camWing${L}`);
  {
    const a = Math.abs(cam.at[1]);
    const at = [cam.at[0], a, G.bot(a)];
    const o = K.P(at); // under the wing: no lens plane (the camera never sees the underside, DESIGN §2)
    const target = [M.GEAR.wing.centre[0], M.GEAR.wing.centre[1], 0.7];
    ctx.lamp({ id: cam.id, part: pname(s, "box.2"), group: "pitch", at: o, dir: unit(K.D(sub(target, at))), switch: "camera" });
  }
  // GL targets for the wing scan wash: the outer box tops and the slats
  for (const key of ["box.4", "box.5", "box.6", ...G.parts.filter((p) => p.gl).map((p) => p.key)]) {
    const spec = G.parts.find((p) => p.key === key);
    const ys = spec.rings.map((r) => Math.abs(r[0][1]));
    ctx.glTarget({ name: `${pname(s, key)}#scan`, part: pname(s, key), kind: "wing", constants: { side, y: ys.map((v) => r3(m(v * side))), group: spec.group ? gname(s, spec.group) : "pitch" } });
  }
}

// ---------------------------------------------------------------------------------------------
// audit clips (DESIGN §3.5): flaps lever 0 → FULL → 0, the control check, the speed brake
// ---------------------------------------------------------------------------------------------
function clips(ctx) {
  const { W, M, F } = ctx;
  const S = M.CONTROLS.transit.slatFullS;
  const Fl = M.CONTROLS.transit.flapFullS;
  const k = (v) => Math.max(0, Math.min(1, v));
  const conf = (t) => {
    const slat = 23 * (t < S ? k(t / S) : t < S + 2 * Fl ? 1 : 1 - k((t - S - 2 * Fl) / S));
    const flap = 33 * (t < S ? 0 : t < S + Fl ? k((t - S) / Fl) : t < S + 2 * Fl ? 1 - k((t - S - Fl) / Fl) : 0);
    return { slat, flap, droop: 5 * k(flap / 8) };
  };
  const total = 2 * S + 2 * Fl;
  ctx.clip({ name: "flaps", at: (t) => W.groundChannels({ turn: 40, ...conf(t) }), from: 0, to: total, frame: 7.5 / 60 });
  ctx.clip({ name: "flaps220", at: (t) => W.groundChannels({ turn: 220, ...conf(t) }), from: 0, to: total, frame: 7.5 / 60 });
  ctx.clip({ name: "controlCheck", at: (t) => W.groundChannels({ turn: 220, slat: 20, flap: 8, droop: 5, ...F.controlCheckAt(F.CHECK_AT + t) }), from: 0, to: 6, frame: 1 / 60 });
  const sb = (t) => 50 * (t < 1 ? F.smooth(0, 1, t) : 1 - F.smooth(1, 2, t));
  ctx.clip({ name: "speedbrake", at: (t) => W.groundChannels({ turn: 220, spoiler: sb(t), spoiler1: sb(t) }), from: 0, to: 2, frame: 1 / 60 });
}

// ---------------------------------------------------------------------------------------------
// checks (--check): planform, spans, devices clear of the pylons, the well top, signs and clearances
// ---------------------------------------------------------------------------------------------
export function checks(ctx, out) {
  const { W, M } = ctx;
  const G = geometry(W, M);
  const lines = [];
  const fail = [];
  const say = (ok, text) => (ok ? lines : fail).push(text);
  void out;
  // planform: LE and TE at every station within 0.10 m of the model (sections of the drawn hulls at rest)
  const sectionX = (pts, a) => {
    const hull = convexHull3(pts, { name: "m3.section" });
    const xs = [];
    for (const f of hull.faces)
      for (let j = 0; j < f.ring.length; j++) {
        const p = hull.points[f.ring[j]];
        const q = hull.points[f.ring[(j + 1) % f.ring.length]];
        if ((p[1] - a) * (q[1] - a) <= 0 && Math.abs(q[1] - p[1]) > 1e-9) xs.push(lerp(p[0], q[0], (a - p[1]) / (q[1] - p[1])));
        else if (Math.abs(p[1] - a) < 1e-9) xs.push(p[0]);
      }
    return xs;
  };
  const ptsOf = (spec) => (spec.points ?? spec.rings.flat());
  let worstLE = 0;
  let worstTE = 0;
  const report = [];
  const probes = [];
  for (const st of [4.45, 6.8, 12.45, 13.88, 18.99, 25.75, 7.2, 10.32, 15.6, 18.41, 21.51, 24.61, 26.45, 30.12, 33.8, 38.05, 26.0, 27.76, 31.14, 35.24]) probes.push(st - 0.05, st + 0.05);
  for (let a = 5; a < TIP; a += 1) probes.push(a);
  const gapsLE = [[13.88, 15.6], [24.61, 26.45]].map(([p0, p1]) => [p0 - 0.1, p1 + 0.1]);
  const gapsTE = [[4.45, 4.6], [12.38, 12.52], [18.91, 19.07], [25.43, 25.53], [25.75, 26.07], [35.17, 35.24]];
  for (const a of probes.filter((v) => v > 4.45 && v < TIP).sort((p, q) => p - q)) {
    // the flap-track fairings hang under the wing and run past its TE by design: they are not the planform
    const xs = G.parts.filter((spec) => !spec.canoe).flatMap((spec) => {
      const ys = ptsOf(spec).map((p) => p[1]);
      if (Math.min(...ys) > a + 1e-6 || Math.max(...ys) < a - 1e-6) return [];
      return sectionX(ptsOf(spec), a);
    });
    if (!xs.length) continue;
    const w = M.wingAt(a);
    const le = Math.min(...xs);
    const te = Math.max(...xs);
    const inLE = !gapsLE.some(([p0, p1]) => a > p0 && a < p1);
    const inTE = !gapsTE.some(([p0, p1]) => a > p0 - 0.02 && a < p1 + 0.02);
    if (inLE) worstLE = Math.max(worstLE, Math.abs(le - w.le));
    if (inTE) worstTE = Math.max(worstTE, Math.abs(te - w.te));
    report.push(`${a.toFixed(2)}: ${inLE ? (le - w.le).toFixed(3) : "pylon"}/${inTE ? (te - w.te).toFixed(3) : "gap"}`);
  }
  lines.push(`planform (drawn − model, LE/TE in m; pylon = LE pylon slot, gap = a TE gap between surfaces): ${report.join(" · ")}`);
  say(worstLE <= 0.1 && worstTE <= 0.1, `planform: LE within ${worstLE.toFixed(3)} m, TE within ${worstTE.toFixed(3)} m of the model at every station`);
  // span over the fences
  say(Math.abs(2 * TIP_OUT - 79.75) <= 0.05, `span over the fences ${(2 * TIP_OUT).toFixed(2)} m (79.75 ± 0.05)`);
  // spans against CONTROLS / W.WING.devices (T1)
  const d = W.WING.devices;
  lines.push(`spans (nominal, T1): droop ${d.droop.map((x) => x.y.join("–")).join(", ")} · slats ${d.slats.map((x) => x.y.join("–")).join(", ")} · flaps ${d.flaps.map((x) => x.y.join("–")).join(", ")} · ailerons ${d.ailerons.map((x) => x.y.join("–")).join(", ")} · spoilers ${d.spoilers.map((x) => x.y.join("–")).join(", ")}`);
  lines.push(`built gaps: flaps ${Object.entries(G.flaps).map(([id, f]) => `${id} ${f.y.map(f2).join("–")}`).join(", ")} · ailerons ${Object.entries(G.ailerons).map(([id, a]) => `${id} ${a.y.map(f2).join("–")}`).join(", ")}`);
  lines.push(`spoiler plates: ${G.spoilers.map((sp) => `${sp.key.slice(4)} ${sp.y.map(f2).join("–")} float ${sp.float.toFixed(3)}`).join(", ")}`);
  lines.push(`well ceiling: z = ${G.ceiling.c0.toFixed(3)} + ${G.ceiling.cx.toFixed(4)}·x + ${G.ceiling.cy.toFixed(4)}·y (lowered ${G.ceiling.lowered.toFixed(3)} m); ${G.ceiling.at(32.55, 4.45).toFixed(3)} at (32.55, 4.45), ${G.ceiling.at(32.55, 6.8).toFixed(3)} at (32.55, 6.80)`);
  // kinematics: every moving part against every part near it, over sampled reachable states
  const kin = kinematics(ctx, G, out);
  lines.push(...kin.lines);
  for (const f of kin.fail) fail.push(f);
  for (const l of lines) console.log(`M3: ${l}`);
  if (fail.length) throw new Error(fail.join("; "));
}

// ---------------------------------------------------------------------------------------------
// kinematic checks: group values from the rules, rigid poses, separations (kit units)
// ---------------------------------------------------------------------------------------------
function groupValue(g, side, ch) {
  let v = 0;
  for (const r of g.rules(side)) {
    const x = ch[r.channel] ?? 0;
    if (!r.table) v += x;
    else {
      const t = r.table;
      if (x <= t[0][0]) v += t[0][1];
      else if (x >= t[t.length - 1][0]) v += t[t.length - 1][1];
      else for (let i = 1; i < t.length; i++) if (x <= t[i][0]) { v += lerp(t[i - 1][1], t[i][1], (x - t[i - 1][0]) / (t[i][0] - t[i - 1][0])); break; }
    }
  }
  if (g.kind === "hinge") return Math.max(g.range[0], Math.min(g.range[1], v));
  return Math.max(0, Math.min(g.travel, v));
}
function poser(ctx, G, s, side) {
  const { W, TURN } = ctx;
  const K = sideKit(W, side);
  const byKey = new Map(G.groups.map((g) => [g.key, g]));
  const axes = new Map(G.groups.filter((g) => g.kind === "hinge").map((g) => [g.key, axisFor(TURN, K, g.axis.c0, g.axis.c1, g.probe, g.want)]));
  /** kit point p of a part on group key, posed at channels ch */
  return (key, ch) => {
    const chain = [];
    for (let g = key ? byKey.get(key) : null; g; g = g.parent === "pitch" ? null : byKey.get(g.parent)) chain.push(g);
    const steps = chain.map((g) => {
      const v = groupValue(g, side, ch);
      if (g.kind === "slide") {
        const d = unit(K.D(g.dir));
        return (p) => add(p, mul(d, W.m(v)));
      }
      const { point, axis } = axes.get(g.key);
      return (p) => rotateAbout(TURN, p, point, axis, v);
    });
    return (p) => steps.reduce((q, f) => f(q), p);
  };
}
function kinematics(ctx, G, out) {
  const { W } = ctx;
  const lines = [];
  const fail = [];
  const s = "r";
  const side = 1;
  const pose = poser(ctx, G, s, side);
  const conf = W.CONF_ANGLES;
  const states = [];
  for (const f of [0, 1, 2, 4, 6, 8, 12, 17, 22, 26, 30, 33]) states.push({ slat: f === 0 ? 0 : 20 + (3 * f) / 33, flap: f, droop: Math.min(5, (5 * f) / 8) });
  for (const sl of [0, 3, 8, 14, 20, 23]) states.push({ slat: sl, flap: 0, droop: 0 });
  for (const roll of [-1, -0.5, 0.5, 1]) for (const droop of [0, 5]) states.push({ slat: 20, flap: droop ? 8 : 0, droop, roll });
  for (const sp of [0, 15, 30, 50]) for (const sp1 of [0, 50]) for (const roll of [-1, 0, 1]) states.push({ spoiler: sp, spoiler1: sp1, roll });
  void conf;
  const mine = G.parts.map((spec) => ({ name: pname(s, spec.key), key: spec.group ?? null, part: ctx.part(pname(s, spec.key)) })).filter((x) => x.part);
  const tip = ctx.part(pname(s, "tiplight"));
  if (tip) mine.push({ name: pname(s, "tiplight"), key: null, part: tip });
  // every other module's part near the right wing (real modules or stubs, whatever this build has)
  const others = [];
  for (const run of out?.scene?.runs ?? []) {
    if (run.name.startsWith("wings.") || run.name.startsWith("stage.") || run.name.startsWith("stand.")) continue;
    const part = ctx.part(run.name);
    if (!part || run.group !== undefined && false) continue;
    const pts = part.world?.points ?? part.samples;
    if (!pts || !pts.length || Math.max(...pts.map((q) => q[1])) < 30) continue; // right side, |y| > 3 m
    others.push({ name: run.name, key: null, part, foreign: true, fixedGroup: part.group?.name ?? "pitch" });
  }
  const cloud = (part) => part.world?.points ?? part.samples;
  const restOnly = (x) => !x.foreign || x.fixedGroup === "pitch";
  const box = (pts) => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const p of pts) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    return { lo, hi };
  };
  const near = (A, B, pad) => [0, 1, 2].every((k) => A.lo[k] - pad <= B.hi[k] && B.lo[k] - pad <= A.hi[k]);
  const all = [...mine, ...others.filter(restOnly)].map((x) => ({ ...x, pts: cloud(x.part) }));
  all.forEach((x) => (x.box = box(x.pts)));
  const moving = all.filter((x) => x.key);
  const worst = new Map();
  for (const ch of states) {
    const posed = new Map();
    const at = (x) => {
      if (!x.key) return x.pts;
      if (!posed.has(x.name)) posed.set(x.name, x.pts.map(pose(x.key, ch)));
      return posed.get(x.name);
    };
    for (const a of moving)
      for (const b of all) {
        if (a === b || (b.key && b.key === a.key) || (b.key && moving.indexOf(b) < moving.indexOf(a))) continue;
        if (!near(a.box, b.box, 25)) continue;
        const A = at(a);
        const B = at(b);
        if (!near(box(A), box(B), 1)) continue;
        const hints = [[0, 0, 1], ...convexHull3(A, { name: "m3.k" }).faces.map((f) => f.n), ...convexHull3(B, { name: "m3.k" }).faces.map((f) => f.n)];
        const hit = separate(A, B, hints);
        const key = `${a.name} × ${b.name}`;
        const prev = worst.get(key);
        if (!prev || hit.margin < prev.margin) worst.set(key, { margin: hit.margin, ch });
      }
  }
  // no slat or droop nose inside a pylon slot in any CONF; the inner flap's inboard extent over its travel
  const slots = W.WING.pylonSlots;
  let slotWorst = Infinity;
  let flapInMinY = Infinity;
  for (let sl = 0; sl <= 23 + 1e-9; sl += 1) {
    for (const x of moving.filter((q) => q.key === "slat" || q.key === "droop")) {
      const ys = x.pts.map(pose(x.key, { slat: sl })).map((p) => p[1] / 10);
      for (const [p0, p1] of slots) slotWorst = Math.min(slotWorst, ...ys.map((y) => Math.max(p0 - y, y - p1)));
    }
  }
  for (let f = 0; f <= 33 + 1e-9; f += 1) {
    for (const x of moving.filter((q) => q.name.startsWith(pname(s, "flap.in")))) flapInMinY = Math.min(flapInMinY, ...x.pts.map(pose(x.key, { flap: f, slat: 20, droop: 5 })).map((p) => p[1] / 10));
  }
  (slotWorst >= W.GAP ? lines : fail).push(`pylon slots: no slat or droop nose within ${slotWorst.toFixed(3)} m of y ±(14.35–15.25, 25.25–26.15) over slat 0–23°`);
  lines.push(`inner flap: inboard-most point over flap 0–33° at |y| ${flapInMinY.toFixed(3)} m (root plane 4.45)`);
  {
    const r = G.flaps.in.recess;
    const R = G.flaps.in.root;
    // the fixed root's bottom (the well-ceiling plane carried aft) over the recess, and the wall's front
    let low = Infinity;
    for (let a = r.a0; a <= r.y + 1e-9; a += 0.05) for (let x = G.fx("te", a); x <= R.WALL + 1e-9; x += 0.05) low = Math.min(low, G.ceiling.at(x, a));
    (low >= r.z - 1e-9 ? lines : fail).push(`wing-gear recess (M5 R1): x TE → ${R.WALL.toFixed(3)} (fixed aft wall to ${R.XEND.toFixed(3)}), |y| ${r.a0.toFixed(3)}–${r.y.toFixed(2)}: the fixed root trailing edge's bottom is at least ${low.toFixed(4)} m (gear ≤ ${(r.z - G.GAP).toFixed(3)} m); the inner flap's root starts at x ${r.x.toFixed(2)}; filler to x ${R.XIN.toFixed(3)} inboard of y ${R.yIn}`);
  }
  // the wing top over x 32–35, y 4.45–6.80 is closed: some part's top covers every sample at rest
  const covers = mine.filter((q) => (!q.key || q.key.startsWith("flap.in")) && q.part.world?.points).map((q) => footprint(q.part.world.points.map((p) => W.fromKit(p))));
  const holes = [];
  for (let x = 32; x <= 35 + 1e-9; x += 0.1)
    for (let a = 4.46; a <= 6.8 + 1e-9; a += 0.05) {
      // a seam narrower than 0.03 m between neighbours is a joint, not a hole: test the point and its neighbours
      const hit = (px, py) => covers.some((c) => c(px, py));
      if (![[0, 0], [0.015, 0], [-0.015, 0], [0, 0.015], [0, -0.015]].some(([dx, dy]) => hit(x + dx, a + dy))) holes.push([x, a]);
    }
  (holes.length === 0 ? lines : fail).push(`wing top over x 32–35, y 4.45–6.80: ${holes.length ? `${holes.length} open samples, e.g. ${holes.slice(0, 4).map((h) => h.map((v) => v.toFixed(2)).join("/")).join(", ")}` : "closed"}`);
  const list = [...worst.entries()].sort((p, q) => p[1].margin - q[1].margin);
  const knuckles = (key) => key.includes(".ail.") && (key.includes(".box.6") || key.includes(".te."));
  const bad = list.filter(([key, w]) => w.margin < (knuckles(key) ? -0.08 : 0.1));
  const watch = list.filter(([k]) => /flap\.(in|mid|out) × .*flap|flap\.out × .*te\.gap|slat\.[47] × .*le\.|droop\.2 × .*le\.|ail\.(in|out) × .*te\.|spl\.\w+ × .*spl|flap\.in × .*(fillet|fus|fair)|× .*canoe\.6/.test(k));
  lines.push(`kinematics, junctions: ${watch.map(([k, w]) => `${k.replace(/wings\.r\./g, "")} ${(w.margin / 10).toFixed(3)}`).join(", ")}`);
  lines.push(`kinematics: ${states.length} states, ${list.length} moving pairs; tightest ${list.slice(0, 8).map(([k, w]) => `${k.replace(/wings\.r\./g, "")} ${(w.margin / 10).toFixed(3)} m`).join(", ")}`);
  for (const [key, w] of bad) fail.push(`kinematics: ${key} ${(w.margin / 10).toFixed(3)} m at ${JSON.stringify(w.ch)}`);
  return { lines, fail };
}
