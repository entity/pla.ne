// a380/parts/skin.mjs (M6): Skin: belly fairing, keel liner, passenger and cargo doors, 218 windows, beacons,
// antennas, lamps, surface detail.
//
// Contract: a380/notes/CONTRACT.md. Design: a380/DESIGN.md §3.1, §5.1, §5.7, §5.10, §6.2, §8.7, §9 (M6).
// Groups: door.{ID}.arm (hinge on W.partAt's group, axis the arm facet's in-plane up vector at the door's
//   forward edge, 0.03 m off the skin) > door.{ID} (the parallel axis at the arm's end), 16 doors; door.FWD
//   and door.AFT (top-hinged on pitch). Rules from channels door.{ID}.
// Boundaries: W.FAIRING.section(x) (|y| <= 4.35); no fairing parts in the WLG gap 31.85-35.30 (M5's doors close
//   it); BLG cheek plates 0.15 m around W.BAYS.blg; door plates W.GAP off the facet (CONTRACT: 0.012 m, not
//   0.02); windows and door planes through ctx.planeOn on M2's and M6's pieces; every small part on its host's
//   group (W.partAt). Geometry library: parts/fuselage.mjs geom(W).
import { geom, dot, sub, add, mul, cross, unit, len, lerp, f2, pathOf, roundRect, roundRectPath, polytope, SURROUND, clipPolygonBand, UPPER_PLATE } from "./fuselage.mjs";
import { beaconMount } from "../stubs.mjs";

export const id = "skin";
export const owner = "M6";
export const title = "Skin: belly fairing, keel liner, passenger and cargo doors, 218 windows, beacons, antennas, lamps, surface detail";
/** Every part name this module creates starts with one of these (the harness enforces it). */
export const prefixes = ["skin.", "door.", "light.beacon", "light.scan", "light.flood", "light.cam", "fus.blade", "fus.ant"];
/** true: the harness builds stubs.mjs's stand-in instead of build(). */
export const stub = false;

const D2R = Math.PI / 180;
const PLATE_T = 0.06; // door plate thickness (m)
const LEAF_W = 1.26; // passenger door leaf width (AC 2-7-0)
const LEAF_R = 0.16; // f4-fuselage: the passenger leaf's corner radius (the shut picture's the same)
const ARM_T = 0.06; // arm bar section (m)
const ARM_R = 0.03; // arm knuckle radius = its axis' offset off the skin
const UPPER = UPPER_PLATE; // upper-door plate z range [E] (DESIGN §11.5); f4-fuselage: one source, fuselage.mjs (its lap rules end on the surround)
const FWD_PARK = 1.26; // every passenger door parks this far forward (the leaf width); with the AC's outboard offset it fixes the arm
const CARGO_OPEN = 110; // [E]
// fu/fuselage (item 10): the M1 arms root this far aft of the leaf's forward edge. M1's forward edge (x 5.69) is 0.05 m
// aft of the flight-deck roof (nose.canopy ends at 5.638), and the roof is widest at its belt (z 6.66), so as the
// cutaway lifts it 0.1-1.1 m its belt sweeps 0.095 m outboard of the fixed skin at the arm's height (z 7.13); an arm
// rooted on the forward edge reached forward over the roof's end and the lifting roof cut through it (1.45 cm at
// cut.fd 4.5, a painter's cycle canopy → leaf → arm). Rooted 0.10 m aft, the open arm crosses x 5.638 0.23 m off the
// skin. The park is unchanged (it depends only on the arm's length and swing).
const ARM_ROOT_AFT = { M1L: 0.1, M1R: 0.1 };
/**
 * The vertex angles (degrees, 0 = the hinge's swing-from direction, 90 = outboard) of a hinge knuckle inscribed in
 * radius r: one face centred on the skin at rest (−90), and one centred where the skin is once the hinge has turned
 * `open` degrees (−90 − open), each spanning ±11.25° (0.0006 m inside the circle at r 0.03 m), the rest at most 22.5° apart.
 * fu/fuselage (item 10): with only the rest face, a fully open arm or cargo hinge offered the runtime's GJK no axis
 * along the skin normal (the host's 24 axes did not always hold that facet), so a touching pair read as unseparated.
 */
function knuckleAngles(open) {
  const h = 11.25;
  const norm = (a) => ((a % 360) + 360) % 360;
  const c1 = norm(-90);
  const c2 = norm(-90 - open);
  const out = [];
  const arc = (from, to) => {
    const len = norm(to - from);
    const n = Math.max(1, Math.ceil(len / 22.5 - 1e-9));
    for (let k = 0; k < n; k++) out.push(from + (len * k) / n);
  };
  arc(c1 - h, c1 + h);
  arc(c1 + h, c2 - h);
  arc(c2 - h, c2 + h);
  arc(c2 + h, c1 - h + 360);
  return out;
}
const BLADES = [
  { x: 12.0, name: "fus.blade.vhf1", label: "VHF 1 antenna · top", L: 0.5, H: 0.3, T: 0.045 },
  { x: 22.0, name: "fus.blade.tcas", label: "TCAS / ATC antenna · top", L: 0.34, H: 0.16, T: 0.05 },
  { x: 33.0, name: "fus.blade.vhf3", label: "VHF 3 antenna · top", L: 0.46, H: 0.27, T: 0.045 },
  { x: 41.0, name: "fus.blade.elt", label: "Emergency locator transmitter antenna", L: 0.26, H: 0.17, T: 0.04 },
];
// The lowest fairing facet over the BLG bay has no cheek plate: M5's body-gear outer door (blg.{s}.door.out) is that
// facet and the bay bottom, hinged just under c3's lower edge; a plate there blocked the outer tyres in retraction
// (M5 request R2, integrated).
const CHEEKS = ["up", "c1", "c2", "c3"];

/**
 * fu/fuselage (cargo holds): what each open cargo door shows inside, by station x of the door's centre. LD3 (IATA AKE)
 * containers are 1.53 m wide and 1.63 m tall (base 1.56 × 1.53 m, 2.01 m over the contoured side); through a side door
 * the far row shows its flat inboard faces. Hold sizes from AC 2-6-0 (truth.md: FWD 17.4 m, AFT 9.7 m, bulk 2.8 m).
 */
const HOLD_LOAD = {
  FWD: (cx) => [{ kind: "ld3", xa: cx - 1.56, xb: cx - 0.03 }, { kind: "ld3", xa: cx + 0.03, xb: cx + 1.56 }],
  AFT: (cx) => [{ kind: "ld3", xa: cx - 1.56, xb: cx - 0.03 }, { kind: "pallet", xa: cx + 0.03, xb: cx + 1.65 }],
  BULK: (cx) => [{ kind: "bags", xa: cx - 0.6, xb: cx + 0.6 }],
};
const HOLD_WORDS = { FWD: "forward hold: 20–22 LD3 containers or 7 pallets", AFT: "aft hold: 16 LD3 containers" };
const LD3_H = 1.63;
/** Runs of a polyline (x, σ) inside a convex polygon (the doorway): tested every 0.02 m, each run kept as its two ends and the polyline's own vertices between them. */
function clipToPoly(pts, poly, closed = false) {
  const inside = ([x, y]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  const dense = [];
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.02));
    for (let j = 0; j < k; j++) dense.push({ p: [lerp(a[0], b[0], j / k), lerp(a[1], b[1], j / k)], v: j === 0 });
  }
  dense.push({ p: closed ? pts[0] : pts[pts.length - 1], v: true });
  // runs inside, keeping only their ends and the polyline's own vertices (the pieces between are straight)
  const runs = [];
  let cur = null;
  for (let i = 0; i < dense.length; i++) {
    const d = dense[i];
    if (inside(d.p)) {
      if (!cur) runs.push((cur = [d.p]));
      else if (d.v || i + 1 === dense.length || !inside(dense[i + 1].p)) cur.push(d.p);
    } else cur = null;
  }
  return runs.filter((r) => r.length >= 2);
}

/** fu/fuselage (item 12): the share of a door's swing over which its plate (and arm or hinge) fades in, and its shut,
 * flush picture out. */
const LEAF_FADE = 0.05;
/**
 * The details on a passenger leaf's outer face: the porthole (glass, its lit copies and the pale core), the handle
 * recess and bar, the slide-bustle panel and its arming window. Each is drawn where fitZ lies on one strip (facet) with
 * margin m: { fitZ, m, x, z, svg(X, Y) } in the plane's kit units.
 */
function passengerDetails(D, winZ) {
  const id = D.id;
  const hz = D.upper ? 8.5 : D.d.sillZ + 1.15;
  const bz = D.upper ? D.zb + 0.34 : D.d.sillZ + 0.32;
  return [
    { fitZ: winZ, m: 0.16, x: D.d.x, z: winZ, svg: (X, Y) => `<path class="iso-line" data-tone="faint" d="${roundRectPath(X, Y, 2.7, 3.3, 0.9)}"/><path class="a3-win" d="${roundRectPath(X, Y, 2.0, 2.6, 0.6)}"/><path class="a3-win-lit-door a3-port-${id}" style="opacity:0" d="${roundRectPath(X, Y, 2.0, 2.6, 0.6)}"/><path class="a3-port-gl a3-portgl-${id}" style="opacity:0" d="${roundRectPath(X, Y, 2.0, 2.6, 0.6)}"/><path class="a3-port-cbase a3-portb-${id}" style="opacity:0" d="${roundRectPath(X, Y, 1.2, 1.7, 0.45)}"/><path class="a3-port-core a3-portc-${id}" style="opacity:0" d="${roundRectPath(X, Y, 1.2, 1.7, 0.45)}"/>` },
    // fu/fuselage (item 12): the handle recess and bar in the faint tone, as the porthole ring and bustle are: on a shut
    // door no line inside the outline is darker than the skin's faint joints (the bar read 141 at 8x in light). The bar
    // is one closed stroke along its centre line: as a 2.8 cm rounded box its two long sides merged into one double-weight
    // line (183 at 8x)
    { fitZ: hz, m: 0.12, x: D.d.x + 0.3, z: hz, svg: (X, Y) => `<path class="iso-line" data-tone="faint" d="${roundRectPath(X, Y, 3.4, 0.9, 0.35)}"/><path class="iso-line" data-tone="faint" d="M${(X - 1.1).toFixed(2)} ${Y.toFixed(2)}H${(X + 1.1).toFixed(2)}Z"/>` },
    { fitZ: bz, m: 0.2, x: D.d.x, z: bz, svg: (X, Y) => `<path class="iso-line" data-tone="faint" d="${roundRectPath(X, Y, 9.6, 3.4, 0.8)}"/>` },
    { fitZ: bz, m: 0.2, x: D.d.x - 0.36, z: bz + 0.36, svg: (X, Y) => `<path class="iso-line" data-tone="faint" d="${roundRectPath(X, Y, 0.9, 0.6, 0.2)}"/>` },
  ];
}

// ---------------------------------------------------------------------------------------------
// door geometry (computed once, used by groups(), build() and checks())
// ---------------------------------------------------------------------------------------------
let SPEC = null;
function specs(ctx) {
  if (SPEC && SPEC.W === ctx.W) return SPEC;
  const { W, M } = ctx;
  const G = geom(W);
  const GAP = W.GAP;
  const passenger = M.DOORS.passenger.map((d) => passengerDoor(W, G, d, GAP));
  const cargo = M.DOORS.cargo.filter((c) => c.id !== "BULK").map((c) => cargoDoor(W, G, c, GAP));
  SPEC = { W, G, passenger, cargo };
  return SPEC;
}

/** The half-spaces of strip k of a plate over facet planes fps (mitred to its neighbours). */
function stripHalfSpaces(fps, k, bounds, GAP, T) {
  const fp = fps[k];
  const hs = [{ n: fp.n, d: fp.d + GAP + T }, { n: mul(fp.n, -1), d: -(fp.d + GAP) }, ...bounds];
  if (k + 1 < fps.length) hs.push({ n: sub(fps[k + 1].n, fp.n), d: fps[k + 1].d - fp.d });
  if (k > 0) hs.push({ n: sub(fps[k - 1].n, fp.n), d: fps[k - 1].d - fp.d });
  return hs;
}

/**
 * The faint joints of strip k of a plate (kit patch 15): the mitre planes it shares with its neighbouring strips, in
 * kit units (model plane n·p = d → kit: n' = (−n0, n1, n2), d' = 10 (d − PIVOT_X n0)).
 */
function stripJoints(W, fps, k) {
  const joints = [];
  const mitre = (a, b) => {
    const n = sub(b.n, a.n);
    const d = b.d - a.d;
    return { n: [-n[0], n[1], n[2]], d: 10 * (d - W.PIVOT_X * n[0]), tone: "faint" };
  };
  if (k + 1 < fps.length) joints.push(mitre(fps[k], fps[k + 1]));
  if (k > 0) joints.push(mitre(fps[k], fps[k - 1]));
  return joints.length ? { joints } : {};
}

/**
 * f4-fuselage: rounded corners of a leaf: per corner, `k` planes tangent to an arc of radius r inside the two edges
 * (the engine's `rerank` (f3-engine.md E3) keeps the rounded leaf's framed planes on their proving margins).
 */
function roundCorners(uF, vTop, vBot, Pf, Pa, Ptop, Pbot, r, k = 5) {
  const out = [];
  const corner = (a, ca, b, cb) => {
    for (let i = 1; i <= k; i++) {
      const t = (i / (k + 1)) * (Math.PI / 2);
      const s = add(mul(a, Math.cos(t)), mul(b, Math.sin(t)));
      const l = len(s);
      out.push({ n: mul(s, 1 / l), d: (Math.cos(t) * (ca - r) + Math.sin(t) * (cb - r)) / l + r });
    }
  };
  corner(uF, dot(uF, Pf), vTop, dot(vTop, Ptop));
  corner(mul(uF, -1), -dot(uF, Pa), vTop, dot(vTop, Ptop));
  corner(uF, dot(uF, Pf), mul(vBot, -1), -dot(vBot, Pbot));
  corner(mul(uF, -1), -dot(uF, Pa), mul(vBot, -1), -dot(vBot, Pbot));
  return out;
}
/** Corner chamfers of a leaf: planes through points c back from each corner along both edges. */
function chamfers(uF, vTop, vBot, Pf, Pa, Ptop, Pbot, c) {
  const out = [];
  const corner = (a, ca, b, cb) => {
    const s = add(a, b);
    const k = 1 / len(s);
    out.push({ n: mul(s, k), d: (ca + cb) * k - c * k });
  };
  corner(uF, dot(uF, Pf), vTop, dot(vTop, Ptop));
  corner(mul(uF, -1), -dot(uF, Pa), vTop, dot(vTop, Ptop));
  corner(uF, dot(uF, Pf), mul(vBot, -1), -dot(vBot, Pbot));
  corner(mul(uF, -1), -dot(uF, Pa), mul(vBot, -1), -dot(vBot, Pbot));
  return out;
}

function passengerDoor(W, G, d, GAP) {
  const side = d.side === "L" ? -1 : 1;
  const upper = d.deck === "upper";
  const host = W.partAt(d.x, upper ? 8.9 : d.sillZ + 1, side);
  const x0 = d.x - LEAF_W / 2;
  const x1 = d.x + LEAF_W / 2;
  const seg = G.segAt(x0, x1);
  const r = W.ring2(d.x);
  let zb = upper ? UPPER[0] : d.sillZ - 0.02;
  const zt = upper ? UPPER[1] : d.sillZ + 1.98;
  // an upper plate starts on the upper belt (U3's homothetic tail ring lifts the belt above 7.91)
  if (upper && zb < r[9][1] + 0.01) zb = r[9][1] + 0.01;
  const fLow = G.facetIndexAt(d.x, zb);
  const fHigh = G.facetIndexAt(d.x, zt);
  const facets = [];
  for (let j = fLow; j <= fHigh; j++) facets.push(j);
  const fps = facets.map((j) => G.facetPlane(seg, j, side));
  const fa = fps[fps.length - 1]; // the arm lies on the top strip's facet
  const fl = fps[0];
  const uF = mul(fa.u, -1); // forward, in the arm facet
  const vA = fa.v;
  const nA = fa.n;
  const Ptop = G.skinPoint(d.x, fHigh, side, zt);
  const Pbot = G.skinPoint(d.x, fLow, side, zb);
  // the leaf's fore and aft edges: exactly LEAF_W apart along the arm facet's forward axis, centred on the station
  const Pf = add(Ptop, mul(uF, LEAF_W / 2));
  const Pa = sub(Ptop, mul(uF, LEAF_W / 2));
  const bounds = [
    { n: uF, d: dot(uF, Pf) },
    { n: mul(uF, -1), d: -dot(uF, Pa) },
    { n: vA, d: dot(vA, Ptop) },
    { n: mul(fl.v, -1), d: -dot(fl.v, Pbot) },
    ...roundCorners(uF, vA, fl.v, Pf, Pa, Ptop, Pbot, LEAF_R), // f4-fuselage: rounded (was 0.10 m chamfers)
  ];
  const box = [[x0 - 0.5, side > 0 ? 0.3 : -4.8, zb - 0.8], [x1 + 0.5, side > 0 ? 4.8 : -0.3, zt + 0.8]];
  const strips = facets.map((j, k) => ({ facet: j, fp: fps[k], points: polytope(stripHalfSpaces(fps, k, bounds, GAP, PLATE_T), box) }));
  // the arm: a knuckle 16-gon on the forward-edge axis A1, the bar aft to the door hinge A2.
  // L sinθ = parkedOffset (AC 2-7-0), L(1 − cosθ) = FWD_PARK: the door parks exactly there.
  const off = d.parkedOffset;
  const theta = 2 * Math.atan(FWD_PARK / off);
  const L = off / Math.sin(theta);
  const alphaF = dot(uF, sub(Pf, Ptop)) - (ARM_ROOT_AFT[d.id] ?? 0);
  const vMid = GAP + ARM_T / 2; // the arm's centre line above the plate top, along vA
  // fu/fuselage (item 10): the knuckle's axis stands ARM_R + W.GAP off the skin, so the arm rests W.GAP off its facet (a
  // support contact, as the cargo hinges are) rather than 0.0006 m (a tangent contact): a fully open M5L arm on
  // tail.cone (whose facet is not among the hull's 24 runtime axes) read as unseparated in every doors-open state
  const A1 = add(add(add(Ptop, mul(uF, alphaF)), mul(vA, vMid)), mul(nA, ARM_R + GAP));
  const A2 = sub(A1, mul(uF, L));
  const armPts = [];
  // a face (not a vertex) faces the skin at rest, and another once open (knuckleAngles): its normal is the contact's
  // separating direction, W.GAP off
  const knuckle = knuckleAngles(theta / D2R);
  for (const c of [-ARM_T / 2, ARM_T / 2]) {
    for (const deg of knuckle) {
      const phi = deg * D2R;
      armPts.push(add(add(add(A1, mul(vA, c)), mul(uF, -ARM_R * Math.cos(phi))), mul(nA, ARM_R * Math.sin(phi))));
    }
    // the bar's underside is flush with the knuckle's skin-side face (one face, exactly parallel to the facet), so
    // the contact's separating direction is a face normal of the arm (the audit's and runtime's GJK hint)
    const under = ARM_R - ARM_R * Math.cos(Math.PI / 16);
    for (const a of [ARM_R, L + ARM_R]) for (const b of [under, ARM_T]) armPts.push(add(add(add(A1, mul(vA, c)), mul(uF, -a)), mul(nA, b - ARM_R)));
  }
  // the arm's band must stay on its facet
  const armTopV = dot(vA, sub(Ptop, fa.A)) + GAP + ARM_T;
  const facetLenV = dot(vA, sub(G.skinPoint(d.x, fHigh, side, r[fHigh + 1][1]), fa.A));
  // hinge axis sign: +θ swings the arm's aft end outboard
  const VK = W.kitDir(vA);
  const NK = W.kitDir(nA);
  const rK = sub(W.kit(A2), W.kit(A1));
  const axis = dot(cross(VK, rK), NK) > 0 ? VK : mul(VK, -1);
  return { d, id: d.id, side, upper, host, seg, x0, x1, zb, zt, facets, fps, fa, uF, vA, nA, Ptop, Pbot, Pf, Pa, strips, A1, A2, L, theta: theta / D2R, armPts, knuckleN: knuckle.length, axis, armTopV, facetLenV };
}

function cargoDoor(W, G, c, GAP) {
  const side = c.side === "L" ? -1 : 1;
  const x0 = c.x - c.width / 2;
  const x1 = c.x + c.width / 2;
  const zb = c.sillZ;
  const zt = c.sillZ + c.height;
  const host = W.partAt(c.x, zb + 0.9, side);
  const seg = G.segAt(x0, x1);
  const fLow = G.facetIndexAt(c.x, zb);
  const fHigh = G.facetIndexAt(c.x, zt);
  const facets = [];
  for (let j = fLow; j <= fHigh; j++) facets.push(j);
  const fps = facets.map((j) => G.facetPlane(seg, j, side));
  const ft = fps[fps.length - 1];
  const fl = fps[0];
  const uF = mul(ft.u, -1);
  const Ptop = G.skinPoint(c.x, fHigh, side, zt);
  const Pbot = G.skinPoint(c.x, fLow, side, zb);
  const Pf = add(Ptop, mul(uF, c.width / 2));
  const Pa = sub(Ptop, mul(uF, c.width / 2));
  const bounds = [
    { n: uF, d: dot(uF, Pf) },
    { n: mul(uF, -1), d: -dot(uF, Pa) },
    { n: ft.v, d: dot(ft.v, Ptop) },
    { n: mul(fl.v, -1), d: -dot(fl.v, Pbot) },
    ...chamfers(uF, ft.v, fl.v, Pf, Pa, Ptop, Pbot, 0.12),
  ];
  // fu/fuselage (item 10): a 6 mm bevel on the top strip's outer top edge, whose face turns to face the skin once the
  // door is open 110° (the door turns −v toward +n): the runtime's GJK then holds the skin normal among the panel's own
  // axes (without it a fully open panel 0.06 m off nose.f.block read as unseparated, GJK −0.16 against 0.60 true)
  {
    const t = CARGO_OPEN * D2R;
    const m = unit(sub(mul(ft.v, Math.sin(t)), mul(ft.n, Math.cos(t))));
    bounds.push({ n: m, d: dot(m, add(Ptop, mul(ft.n, GAP + PLATE_T))) - 0.006 });
  }
  const box = [[x0 - 0.5, side > 0 ? 0.3 : -4.8, zb - 0.8], [x1 + 0.5, side > 0 ? 4.8 : -0.3, zt + 0.8]];
  const strips = facets.map((j, k) => ({ facet: j, fp: fps[k], points: polytope(stripHalfSpaces(fps, k, bounds, GAP, PLATE_T), box) }));
  // the hinge knuckle on the top hinge line, on the top strip's top face and W.GAP off the skin (a support contact,
  // never a tangent one: the knuckle's skin-side plane is not among the loft's GJK hint axes)
  const K0 = add(add(Ptop, mul(ft.v, ARM_R)), mul(ft.n, ARM_R + GAP));
  const sF = dot(ft.u, sub(Pf, K0));
  const sA = dot(ft.u, sub(Pa, K0));
  const UK = W.kitDir(ft.u);
  const NK = W.kitDir(ft.n);
  const rK = sub(W.kit(Pbot), W.kit(K0));
  const axis = dot(cross(UK, rK), NK) > 0 ? UK : mul(UK, -1);
  return { c, id: c.id, side, host, seg, x0, x1, zb, zt, facets, fps, ft, uF, Ptop, Pbot, Pf, Pa, strips, K0, sF, sA, axis };
}

// ---------------------------------------------------------------------------------------------
// groups and rules (DESIGN §3.1, §3.3)
// ---------------------------------------------------------------------------------------------
export function groups(ctx) {
  const { W } = ctx;
  const S = specs(ctx);
  for (const D of S.passenger) {
    ctx.group(`door.${D.id}.arm`, { parent: D.host.group, hinge: { point: W.kit(D.A1), axis: D.axis, range: [0, D.theta] } });
    ctx.group(`door.${D.id}`, { parent: `door.${D.id}.arm`, hinge: { point: W.kit(D.A2), axis: D.axis, range: [-D.theta, 0] } });
    ctx.rule({ group: `door.${D.id}.arm`, channel: `door.${D.id}`, table: [[0, 0], [1, D.theta]] });
    ctx.rule({ group: `door.${D.id}`, channel: `door.${D.id}`, table: [[0, 0], [1, -D.theta]] });
  }
  for (const C of S.cargo) {
    ctx.group(`door.${C.id}`, { parent: C.host.group, hinge: { point: W.kit(C.K0), axis: C.axis, range: [0, CARGO_OPEN] } });
    ctx.rule({ group: `door.${C.id}`, channel: `door.${C.id}`, table: [[0, 0], [1, CARGO_OPEN]] });
  }
}

// ---------------------------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------------------------

/** The outer-face frame of a plate strip (kit), a mapper for model points on it, and its inset outline. */
function outerFace(W, st, off) {
  const fp = st.fp;
  const O = add(fp.O, mul(fp.N, W.m(off)));
  const xy = (p) => {
    const q = sub(W.kit(p), O);
    return [dot(q, fp.U), dot(q, fp.V)];
  };
  const face = st.points.filter((p) => Math.abs(dot(fp.n, p) - (fp.d + off)) < 1e-6).map(xy);
  const c = face.reduce((a, q) => [a[0] + q[0] / face.length, a[1] + q[1] / face.length], [0, 0]);
  face.sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
  const inset = face.map(([X, Y]) => {
    const dx = c[0] - X;
    const dy = c[1] - Y;
    const l = Math.hypot(dx, dy);
    return [X + (dx / l) * 0.15, Y + (dy / l) * 0.15];
  });
  return { opts: { o: O, u: fp.U, v: fp.V, normal: fp.N }, xy, inset };
}

/**
 * The phase accent's outline of a door, strip by strip (review round 3): each strip draws the door's outline inset
 * 0.15 units, but not the edge it shares with its neighbouring strip (on a mitre plane), so the strips together draw one
 * closed outline per door and the joint between them stays the faint kit-patch-15 seam (an outline per strip drew a
 * black line across every upper-deck door in light). Open runs, in the strip's outer-face frame.
 */
function accentRuns(W, st, off, fps, k) {
  const fp = st.fp;
  const mitres = [];
  if (k + 1 < fps.length) mitres.push({ n: sub(fps[k + 1].n, fp.n), d: fps[k + 1].d - fp.d });
  if (k > 0) mitres.push({ n: sub(fps[k - 1].n, fp.n), d: fps[k - 1].d - fp.d });
  const O = add(fp.O, mul(fp.N, W.m(off)));
  const pts = st.points.filter((p) => Math.abs(dot(fp.n, p) - (fp.d + off)) < 1e-6);
  const xy = (p) => {
    const q = sub(W.kit(p), O);
    return [dot(q, fp.U), dot(q, fp.V)];
  };
  const onMitre = (p) => mitres.some((m) => Math.abs(dot(m.n, p) - m.d) < 1e-6 * Math.max(1, len(m.n)));
  const list = pts.map((p) => ({ q: xy(p), m: onMitre(p) }));
  const c = list.reduce((a, v) => [a[0] + v.q[0] / list.length, a[1] + v.q[1] / list.length], [0, 0]);
  list.sort((a, b) => Math.atan2(a.q[1] - c[1], a.q[0] - c[0]) - Math.atan2(b.q[1] - c[1], b.q[0] - c[0]));
  const n = list.length;
  const edges = list.map((v, i) => {
    const w = list[(i + 1) % n];
    const t = [w.q[0] - v.q[0], w.q[1] - v.q[1]];
    const l = Math.hypot(t[0], t[1]) || 1;
    let nn = [-t[1] / l, t[0] / l];
    if (nn[0] * (c[0] - v.q[0]) + nn[1] * (c[1] - v.q[1]) < 0) nn = [-nn[0], -nn[1]];
    const mitre = v.m && w.m;
    const o = mitre ? 0 : 0.15;
    return { p: [v.q[0] + nn[0] * o, v.q[1] + nn[1] * o], t: [t[0] / l, t[1] / l], mitre };
  });
  // vertex i: the offset lines of edges i - 1 and i
  const corner = (i) => {
    const A = edges[(i - 1 + n) % n];
    const B = edges[i];
    const den = A.t[0] * B.t[1] - A.t[1] * B.t[0];
    if (Math.abs(den) < 1e-9) return B.p;
    const s2 = ((B.p[0] - A.p[0]) * B.t[1] - (B.p[1] - A.p[1]) * B.t[0]) / den;
    return [A.p[0] + A.t[0] * s2, A.p[1] + A.t[1] * s2];
  };
  const V = list.map((_, i) => corner(i));
  if (!edges.some((e) => e.mitre)) return [V];
  // runs of consecutive non-mitre edges, each from its first edge's start to its last edge's end
  const runs = [];
  const start = edges.findIndex((e) => e.mitre);
  let run = null;
  for (let j = 1; j <= n; j++) {
    const i = (start + j) % n;
    if (edges[i].mitre) {
      if (run) runs.push(run);
      run = null;
      continue;
    }
    if (!run) run = [V[i]];
    run.push(V[(i + 1) % n]);
  }
  if (run) runs.push(run);
  return runs;
}

export function build(ctx) {
  const { W, M } = ctx;
  const S = specs(ctx);
  const G = S.G;
  const GAP = W.GAP;
  const kit = W.kit;
  const book = G.planeBook();
  const counts = { parts: 0, planes: 0 };
  const hull = (opts) => {
    counts.parts++;
    return ctx.hull({ tone: "hi", material: "steel", ...opts });
  };
  const line = (fp, pts, tone = "faint", closed = false) => `<path class="iso-line" data-tone="${tone}" d="${G.pathIn(fp, pts, closed)}"/>`;
  const runsSvg = (fp, runs, tone) => runs.map((run) => line(fp, run, tone, Boolean(run.closedLoop))).join("");
  // fu/fuselage: every door fade (the shut picture, the leaf, the doorway, its frame and jambs, the hold, the porthole)
  // keys on the share the controller's door groups hold (A3.doorShare, a page script below), not on the door channel: a
  // tool that sets the door groups (turn-check --states, the hinge paths) sees the plates, doorways and holds it posed.
  // The page's own pose follows the channel, so the live figure draws as before.
  const shareOf = (id) => `A3.doorShare(${JSON.stringify(id)}, ch)`;
  // fu/r1-fuselage: the darkening share of the cabin dimmer, as live.js writes it to --a3-cab-p (the cabin light^.66 in
  // twelfths; up to 50% in dark, 35% by daylight). The open doorways' cavity mixes toward --a3-cab-dim by it, as the
  // cabin and flight-deck tones do (a380.css), so a doorway dims with the cabin beyond it (craft.md §7)
  const cabP = `((1 - Math.round(Math.pow(Math.max(0, Math.min(1, pv.cabinLight !== undefined ? pv.cabinLight : 1)), 0.66) * 12) / 12) * ${ctx.theme === "light" ? 0.35 : 0.5})`;

  // ============================ belly fairing (DESIGN §5.1, §5.7) ============================
  const F = W.FAIRING;
  const lobe = (x) => W.ring(x).filter((p) => p[2] <= 4.4 + 1e-9);
  const section = (x) => F.section(x).map(([y, z]) => [x, y, z]);
  const halfSec = (x, side) => {
    const h = F.half(x);
    return [[x, 0, 4.4], ...h.map(([y, z]) => [x, side * y, z]), [x, 0, h[h.length - 1][1]]];
  };
  const kitRings = (rings) => rings.map((r) => r.map(kit));
  const stationsIn = (x0, x1) => [x0, ...F.stations.filter((x) => x > x0 + 1e-6 && x < x1 - 1e-6), x1];
  // joints (kit patch 15): the fairing is one skin with the barrel above it (z 4.4) and with its own halves (y 0)
  // and pieces: those edges are faint seams; the WLG gap's edges (the gear doors') keep the outline
  const TOP = { n: [0, 0, 1], d: W.m(4.4) };
  const MID = { n: [0, 1, 0], d: 0 };
  hull({ name: "skin.fair.nose", rings: kitRings([lobe(18.5), ...stationsIn(18.5, 22.5).slice(1).map(section)]), smooth: true, sharp: 45, jointCaps: { first: "faint", last: "faint" }, joints: [TOP] });
  for (const [s, side] of W.SIDES) {
    hull({ name: `skin.fair.${s}.mid`, rings: kitRings(stationsIn(22.5, 31.85).map((x) => halfSec(x, side))), smooth: true, sharp: 45, jointCaps: { first: "faint" }, joints: [TOP, MID] });
    hull({ name: `skin.fair.${s}.link`, rings: kitRings([35.3, 35.92].map((x) => halfSec(x, side))), smooth: true, sharp: 45, jointCaps: { last: "faint" }, joints: [TOP, MID] });
  }
  // the tail piece is split at 44: the table's bottom profile turns concave there (42 → 44 → 46.5), which one
  // convex hull would bridge 0.10 m low; each half is convex and they are flush on the 44 section
  // fu/r2-gear: and split at y 0 into port and starboard halves, as mid and link are (flush on MID, faint seams), so
  // the gear views' cut (a3-fade-blg, /^skin\.fair\.l\./) takes the near half only: left whole and solid, its exposed
  // front read as a pod beside the body gear and hid the aft axle; faded whole, the far side lost its tail fairing.
  // The two halves tile the whole piece exactly (each ring's y 0 points are its top and bottom on the centreline)
  const halfLobe = (x, side) => {
    const l = lobe(x).filter((p) => side * p[1] > 1e-9);
    return [[x, 0, 4.4], ...l, [x, 0, Math.min(...l.map((p) => p[2]))]];
  };
  for (const [s, side] of W.SIDES) {
    hull({ name: `skin.fair.${s}.tail`, rings: kitRings(stationsIn(40.9, 44).map((x) => halfSec(x, side))), smooth: true, sharp: 45, jointCaps: { first: "faint", last: "faint" }, joints: [TOP, MID] });
    hull({ name: `skin.fair.${s}.tail.end`, rings: kitRings([halfSec(44, side), halfLobe(46.5, side)]), smooth: true, sharp: 45, jointCaps: { first: "faint", last: "faint" }, joints: [TOP, MID] });
  }
  // fu/r2-gear end
  // BLG bay cheek plates: one 0.15 m plate per fairing facet (a plate over several facets is not convex). Each
  // plate is a ring loft over the fairing stations, run 0.1 m past its facet's ends and clipped by one shared mitre
  // plane per fairing vertex, so neighbours are flush on a true plane (twisted per-station mitres interlock).
  const CHEEK = 0.15;
  const blgX = stationsIn(F.blg[0], F.blg[1]);
  const facetLine = (h, f) => {
    const t = [h[f + 1][0] - h[f][0], h[f + 1][1] - h[f][1]];
    const l = Math.hypot(t[0], t[1]);
    let n = [-t[1] / l, t[0] / l];
    if (n[0] < 0) n = [-n[0], -n[1]]; // outward (+y on the starboard half)
    return { t: [t[0] / l, t[1] / l], n, d: n[0] * h[f][0] + n[1] * h[f][1] };
  };
  const innerAt = (h, k) => {
    // the inner mitre point at vertex k: where the inner offset lines of facets k-1 and k meet
    const a = facetLine(h, k - 1);
    const b = facetLine(h, k);
    const ad = a.d - CHEEK;
    const bd = b.d - CHEEK;
    const det = a.n[0] * b.n[1] - a.n[1] * b.n[0];
    return [(ad * b.n[1] - a.n[1] * bd) / det, (a.n[0] * bd - ad * b.n[0]) / det];
  };
  const cheekRing = (x, side, j) => {
    const h = F.half(x);
    const L = facetLine(h, j);
    const e = 0.1;
    const top = j === 0;
    const bottom = j === h.length - 2;
    const A = top ? h[0] : [h[j][0] - L.t[0] * e, h[j][1] - L.t[1] * e];
    const B = bottom ? h[j + 1] : [h[j + 1][0] + L.t[0] * e, h[j + 1][1] + L.t[1] * e];
    const onInner = (z) => [(L.d - CHEEK - L.n[1] * z) / L.n[0], z];
    const Ai = top ? onInner(4.4) : [A[0] - L.n[0] * CHEEK, A[1] - L.n[1] * CHEEK];
    const Bi = bottom ? onInner(h[j + 1][1]) : [B[0] - L.n[0] * CHEEK, B[1] - L.n[1] * CHEEK];
    return [A, B, Bi, Ai].map(([y, z]) => [x, side * y, z]);
  };
  const mitre = (side, k) => {
    // the plane through fairing vertex k at both ends of the bay and the inner mitre point mid-bay (kit flats)
    const xa = F.blg[0];
    const xb = F.blg[1];
    const xm = (xa + xb) / 2;
    const ha = F.half(xa);
    const hb = F.half(xb);
    const hm = F.half(xm);
    const Pa = [xa, side * ha[k][0], ha[k][1]];
    const Pb = [xb, side * hb[k][0], hb[k][1]];
    const im = innerAt(hm, k);
    const Im = [xm, side * im[0], im[1]];
    let n = unit(cross(sub(Pb, Pa), sub(Im, Pa)));
    // facet k-1's midpoint (mid-bay) is on the − side
    const q = [xm, side * (hm[k - 1][0] + hm[k][0]) / 2, (hm[k - 1][1] + hm[k][1]) / 2];
    if (dot(n, sub(q, Pa)) > 0) n = mul(n, -1);
    const N = W.kitDir(n);
    return { N, d: dot(N, kit(Pa)) };
  };
  for (const [s, side] of W.SIDES)
    for (let j = 0; j < CHEEKS.length; j++) {
      const flats = [];
      if (j > 0) {
        const m = mitre(side, j);
        flats.push({ n: mul(m.N, -1), d: -m.d }); // keep the + side (facet j)
      }
      // keep the − side (facet j); c3's lower end is the vertex-4 mitre, inside the fairing line, so the outer door
      // (outboard of the lowest facet) never meets it
      flats.push({ n: mitre(side, j + 1).N, d: mitre(side, j + 1).d });
      // the plates are one skin: the mitres, the top (z 4.4) and the bay ends are faint seams
      // fu/r1-fuselage: flatAngle 4: the cheeks' smooth faces carried corner normals only 1.7-3.3° apart, so a sub-band
      // swept a whole face in a tenth of a degree of turn (light pops: 20 second-difference cores of up to 156 px on
      // skin.fair.r.up and .c1); shaded flat, each face takes the kit's smoothed staircase instead
      hull({ name: `skin.fair.${s}.${CHEEKS[j]}`, rings: kitRings(blgX.map((x) => cheekRing(x, side, j))), flats, smooth: true, sharp: 15, flatAngle: 4, jointCaps: { first: "faint", last: "faint" }, joints: [...flats.map((f) => ({ n: f.n, d: f.d })), TOP] });
    }
  // keel liner between the WLG bays (its bottom follows the fairing bottom)
  {
    const zb0 = Math.min(...F.half(31.85).map((p) => p[1]));
    const zb1 = Math.min(...F.half(35.3).map((p) => p[1]));
    const pts = [];
    for (const [x, zb] of [[31.85, zb0], [35.3, zb1]]) for (const y of [-1.69, 1.69]) pts.push([x, y, zb], [x, y, 5.05]);
    const keel = hull({ name: "skin.keel", points: pts.map(kit), tone: "mid" });
    // frame ribs on its bay faces (frame pitch 0.635 m) and the bay's stringer line
    for (const side of [-1, 1]) {
      const fp = G.facetPlane(null, [[31.85, side * 1.69, zb0], [35.3, side * 1.69, zb1], [31.85, side * 1.69, 5.05]], side, [0, side, 0]);
      const parts = [];
      for (let x = 32.11; x < 35.3; x += 0.635) parts.push(line(fp, [[x, side * 1.69, lerp(zb0, zb1, (x - 31.85) / 3.45)], [x, side * 1.69, 5.05]], "lo"));
      parts.push(line(fp, [[31.85, side * 1.69, 3.4], [35.3, side * 1.69, 3.4]], "faint"));
      ctx.plane(keel, G.planeOpts(fp, parts.join("")));
      counts.planes++;
    }
  }
  // fairing panel lines: an inset access-panel outline on each cheek quad between stations (best-fit plane)
  const fairPanels = (partName, xs, side, faces) => {
    for (let k = 0; k + 1 < xs.length; k++) {
      if (xs[k + 1] - xs[k] < 0.4) continue;
      const ha = F.half(xs[k]);
      const hb = F.half(xs[k + 1]);
      for (const j of faces) {
        const P = [[xs[k], side * ha[j][0], ha[j][1]], [xs[k], side * ha[j + 1][0], ha[j + 1][1]], [xs[k + 1], side * hb[j + 1][0], hb[j + 1][1]], [xs[k + 1], side * hb[j][0], hb[j][1]]];
        const c = P.reduce((a, p) => add(a, mul(p, 0.25)), [0, 0, 0]);
        let n = unit(cross(sub(P[2], P[0]), sub(P[3], P[1])));
        if (dot(n, [0, side, 0]) < 0) n = mul(n, -1);
        const proj = (p) => sub(p, mul(n, dot(n, sub(p, c))));
        const fp = G.facetPlane(null, [proj(P[0]), proj(P[1]), proj(P[3])], side, n);
        const bil = (s, t) => proj(add(mul(add(mul(P[0], 1 - s), mul(P[3], s)), 1 - t), mul(add(mul(P[1], 1 - s), mul(P[2], s)), t)));
        const ix = 0.09 / (xs[k + 1] - xs[k]);
        const outline = [bil(ix, 0.16), bil(1 - ix, 0.16), bil(1 - ix, 0.84), bil(ix, 0.84)];
        ctx.planeOn(partName, G.planeOpts(fp, line(fp, outline, "faint", true)));
        counts.planes++;
      }
    }
  };
  // the M3 ramp/slide compartment doors: the over-wing slides stow in the belly fairing (AC 2-8-0), on the upper
  // cheek just ahead of the wing-gear bay; a door outline with its latch flap (planes on skin.fair.{s}.mid)
  for (const [s, side] of W.SIDES) {
    const xa = 29.7;
    const xb = 31.85;
    const ha = F.half(xa);
    const hb = F.half(xb);
    const P = [[xa, side * ha[0][0], ha[0][1]], [xa, side * ha[1][0], ha[1][1]], [xb, side * hb[1][0], hb[1][1]], [xb, side * hb[0][0], hb[0][1]]];
    const fp = G.facetPlane(null, [P[0], P[1], P[3]], side, [0, side, 0.6]);
    const bil = (u, t) => add(mul(add(mul(P[0], 1 - u), mul(P[3], u)), 1 - t), mul(add(mul(P[1], 1 - u), mul(P[2], u)), t));
    const door = [bil(0.32, 0.3), bil(0.9, 0.3), bil(0.9, 0.72), bil(0.32, 0.72)];
    const flap = [bil(0.42, 0.42), bil(0.52, 0.42), bil(0.52, 0.58), bil(0.42, 0.58)];
    ctx.planeOn(`skin.fair.${s}.mid`, G.planeOpts(fp, line(fp, door, "lo", true) + line(fp, flap, "mid", true)));
    counts.planes++;
  }
  for (const [s, side] of W.SIDES) {
    fairPanels(`skin.fair.${s}.mid`, stationsIn(22.5, 31.85), side, [0, 1, 2]);
    fairPanels(`skin.fair.${s}.tail`, stationsIn(40.9, 44), side, [0, 1, 2]); // fu/r2-gear: on its own half
    fairPanels("skin.fair.nose", [20, 22], side, [0, 1]);
  }

  // ============================ windows (DESIGN §5.7, §6.2): positions into the book ============================
  const WIN = M.WINDOWS;
  const ww = WIN.size.width;
  const wh = WIN.size.height;
  const targets = new Map(); // host → glTarget rows
  const windows = [];
  for (const [deck, z0, list] of [["main", WIN.mainZ, WIN.main], ["upper", WIN.upperZ, WIN.upper]]) {
    for (const side of [-1, 1]) {
      list.forEach((x, i) => {
        const host = W.partAt(x, z0, side);
        const seg = G.segAt(x - ww / 2, x + ww / 2);
        const fi = G.facetIndexAt(x, z0);
        const r = W.ring2(x);
        // keep the pane inside its facet with 0.01 m to spare (the homothetic nose lowers the upper belt's top)
        const hz = ((wh / 2) * (r[fi + 1][1] - r[fi][1])) / Math.hypot(r[fi + 1][1] - r[fi][1], r[fi + 1][0] - r[fi][0]);
        const z = Math.min(Math.max(z0, r[fi][1] + hz + 0.01), r[fi + 1][1] - hz - 0.01);
        const p = G.skinPoint(x, fi, side, z);
        windows.push({ deck, side, x, z, host: host.name, group: host.group, seg, fi, p, i });
        const e = book.at(host.name, seg, fi, side);
        (e.win ??= []).push({ p, blind: W.windowBlind(deck, i, side) });
        if (!targets.has(host.name)) targets.set(host.name, { group: host.group, rows: [] });
        const t = targets.get(host.name);
        let row = t.rows.find((q) => q.deck === deck && q.side === side && q.seg[0] === seg[0]);
        if (!row) t.rows.push((row = { deck, side, seg, facet: fi, z, xs: [] }));
        row.xs.push(x);
      });
    }
  }

  // ============================ open doorways: what is seen through them (review round 1) ============================
  // Inside the doorway (the cavity fill on the host skin): the cabin beyond as a picture in the opening (ceiling
  // band, the galley or bulkhead face with its counter, the carpet), each piece clipped by the opening; then the
  // jambs and the sill as true planes 0.2 m deep into the skin, so the opening has depth and parallax as the stage
  // turns (a jamb that faces away fades with its normal). All of it fades in with the door through its vary class.
  const JAMB = 0.2;
  function doorwayInterior(D, way, ds0, ds1) {
    const x0 = D.d.x - D.d.width / 2;
    const x1 = D.d.x + D.d.width / 2;
    const box = (xa, xb, sa, sb) => clipPolygonBand(clipPolygonBand(way, 0, xa, xb), 1, sa, sb);
    const pieces = [
      ["a3-dwi-ceil", box(x0, x1, ds1 - 0.3, ds1)],
      ["a3-dwi-wall", box(x0 + 0.12, x1 - 0.12, ds0 + 0.3, ds1 - 0.3)],
      ["a3-dwi-floor", box(x0, x1, ds0, ds0 + 0.3)],
    ];
    for (const [cls, poly] of pieces) {
      if (poly.length < 3) continue;
      for (const [fi, part] of G.drapeFill(poly, D.side)) book.add(D.host.name, D.seg, fi, D.side, (fp) => `<path class="${cls} a3-dw-${D.id}" style="opacity:0" d="${G.pathIn(fp, part, true)}"/>`);
    }
    // the galley face: the counter line and the cart bays' verticals, and a carpet seam
    const lines = [
      [[x0 + 0.12, ds0 + 1.0], [x1 - 0.12, ds0 + 1.0]],
      ...[0.3, 0.55, 0.8].map((t) => [[lerp(x0, x1, t), ds0 + 0.3], [lerp(x0, x1, t), ds0 + 1.0]]),
      [[x0 + 0.08, ds0 + 0.3], [x1 - 0.08, ds0 + 0.3]],
    ];
    for (const ln of lines)
      for (const [fi, runs] of G.drapeLine(ln, D.side))
        book.add(D.host.name, D.seg, fi, D.side, (fp) => runs.map((run) => `<path class="a3-dwi-line a3-dw-${D.id}" style="opacity:0" d="${G.pathIn(fp, run)}"/>`).join(""));
    // fu/r1-fuselage: the cabin dimmer on the cavity. The canvas painter bakes a plane's colours when it compiles, so a
    // token mix would not follow the dimmer there: the mix is an overlay of the pieces in --a3-cab-dim at alpha p (over
    // an opaque piece, exactly CSS color-mix(in srgb, piece, dim p)), drawn over the galley lines too
    for (const [, poly] of pieces) {
      if (poly.length < 3) continue;
      for (const [fi, part] of G.drapeFill(poly, D.side)) book.add(D.host.name, D.seg, fi, D.side, (fp) => `<path class="a3-dwi-dim a3-dwd-${D.id}" style="opacity:0" d="${G.pathIn(fp, part, true)}"/>`);
    }
    ctx.vary(`a3-dwd-${D.id}`, `Math.min(1, ${shareOf(D.id)} * 4) * ${cabP}`);
    // fu/r1-fuselage end
    // jambs (fore and aft) and the sill: quads from the skin 0.2 m inward along each facet's normal
    const jambPlane = (a, b, n, face, cls) => {
      // a, b: model points on the skin; n: the facet's outward normal; face: the jamb's own face normal (model)
      const A = W.kit(a);
      const B = W.kit(b);
      const In = W.kitDir(mul(n, -1));
      const U = unit(sub(B, A));
      const V = unit(sub(In, mul(U, dot(In, U))));
      const L = len(sub(B, A));
      const dpt = W.m(JAMB) * dot(In, V);
      // fu/r1-fuselage: and its cabin-dimmer overlay (a3-dwjd: the jamb's own fade × the dimmer's share)
      const svg = `<path class="${cls} a3-dwj-${D.id}" style="opacity:0" d="M0 0H${f2(L)}V${f2(dpt)}H0Z"/><path class="a3-dwi-dim a3-dwjd-${D.id}" style="opacity:0" d="M0 0H${f2(L)}V${f2(dpt)}H0Z"/>`;
      ctx.planeOn(D.host.name, { o: A, u: U, v: V, normal: W.kitDir(face), svg, fade: [0.02, 0.2] });
      counts.planes++;
    };
    for (const [xj, face] of [[x0 + 0.08, [1, 0, 0]], [x1 - 0.08, [-1, 0, 0]]])
      for (const [fi, runs] of G.drapeLine([[xj, ds0 + 0.08], [xj, ds1 - 0.08]], D.side, { step: 0.5 })) {
        const fp = G.facetPlane(D.seg, fi, D.side);
        for (const run of runs) jambPlane(run[0], run[run.length - 1], fp.n, face, "a3-dwi-jamb");
      }
    const sillFi = G.facetOfSigma(ds0 + 0.02);
    const sfp = G.facetPlane(D.seg, sillFi, D.side);
    const a = G.pointAtSigma(x0 + 0.08, ds0, D.side);
    const b = G.pointAtSigma(x1 - 0.08, ds0, D.side);
    jambPlane(a, b, sfp.n, sfp.v, "a3-dwi-sill");
    // review round 3: the jambs and the sill face along ±x, so on the barrel piece that carries both sides a far-side
    // doorway's jambs faced the reader through the near skin. They take the door's share AND the facing of the
    // doorway's own skin facet (the view direction from the turn and the pitch, the camera's 30° elevation)
    const n = G.facetPlane(D.seg, G.facetOfSigma((ds0 + ds1) / 2), D.side).n.map((v) => +v.toFixed(5));
    const jambFade = `(() => { const b = (40 - (ch.turn || 0)) * Math.PI / 180; const p = (ch.pitch || 0) * Math.PI / 180; const nx = (${n[0]}) * Math.cos(p) + (${n[2]}) * Math.sin(p); const nz = -(${n[0]}) * Math.sin(p) + (${n[2]}) * Math.cos(p); const f = -nx * Math.cos(b) * 0.866 + (${n[1]}) * Math.sin(b) * 0.866 + nz * 0.5; return Math.min(1, ${shareOf(D.id)} * 4) * F.smooth(0.02, 0.15, f); })()`;
    ctx.vary(`a3-dwj-${D.id}`, jambFade);
    ctx.vary(`a3-dwjd-${D.id}`, `${jambFade} * ${cabP}`); // fu/r1-fuselage
  }

  // fu/fuselage (item 12): a shut door is flush with the skin. Its plate stands 0.012-0.072 m off its facet (a convex
  // plate cannot sink into the convex host), so the plate's top side face read as a band over every shut door, and its
  // crease and outline as a second outline. Shut, the door is a picture on its host: one outline (mid) across its
  // facets with the doors accent on it, and the leaf's own details; the plate (and its arm or hinge) fades in over the
  // first LEAF_FADE of the swing, as it leaves the skin. The plate stays a part (picked, labelled, ordered) throughout.
  function shutPicture({ id, host, seg, side, x, zb, zt, width, r, placed }) {
    const shut = `a3-shut-${id}`;
    const sb = G.sigmaOf(x, zb);
    const st = G.sigmaOf(x, zt);
    const outline = roundRect(x, (sb + st) / 2, width, st - sb, r, 4);
    for (const [fi, runs] of G.drapeLine(outline, side, { closed: true, step: 0.25 })) book.add(host, seg, fi, side, (fp) => `<g class="${shut}">${runsSvg(fp, runs, "mid")}<g class="a3-acc a3-acc-doors">${runsSvg(fp, runs, "lit")}</g></g>`);
    for (const dt of placed) {
      const p = G.skinPoint(dt.x, dt.facet, side, dt.z);
      book.add(host, seg, dt.facet, side, (fp) => {
        const [X, Y] = fp.xy(p);
        return `<g class="${shut}">${dt.svg(X, Y)}</g>`;
      });
    }
    const share = id === "BULK" ? `(ch["door.BULK"] || 0)` : shareOf(id);
    ctx.vary(shut, `1 - F.smooth(0, ${LEAF_FADE}, ${share})`);
    ctx.vary(`a3-leaf-${id}`, `F.smooth(0, ${LEAF_FADE}, ${share})`);
  }

  // ============================ cargo holds: what the open cargo doors show (fu/fuselage) ============================
  // The holds are solid hull volume, so they are pictures on the host's facets inside the doorway, as the passenger
  // doorways' cabin pictures are: the far side's lining, the ceiling lining and its light strip, the roller floor, the
  // load (LD3 containers, a pallet under its net aft, loose bags in the bulk hold) and the frame's edges, lit to the
  // cargo flood's warm white. Each fades in with its door and is gated by the doorway facet's facing (the doorway
  // jambs' gate), so a far-side hold never draws through the near skin.
  function holdInterior({ id, host, seg, side, way, x0, x1, s0, s1, load }) {
    const vc = `a3-hold-${id}`;
    const box = (xa, xb, sa, sb) => clipPolygonBand(clipPolygonBand(way, 0, xa, xb), 1, sa, sb);
    const fills = [];
    const lines = [];
    const floor = s0 + 0.12;
    const ceil = s1 - 0.14;
    const rect = (xa, xb, sa, sb) => [[xa, sa], [xb, sa], [xb, sb], [xa, sb]];
    fills.push(["a3-hold-wall", box(x0, x1, s0, s1)], ["a3-hold-ceil", box(x0, x1, ceil, s1)], ["a3-hold-floor", box(x0, x1, s0, floor)]);
    lines.push(["a3-hold-lamp", [[x0 + 0.2, s1 - 0.07], [x1 - 0.2, s1 - 0.07]], false]);
    // the roller floor: two tracks along the hold with their rollers, and the ceiling's edge
    for (const t of [0.035, 0.085]) lines.push(["a3-hold-ln", [[x0, s0 + t], [x1, s0 + t]], false]);
    for (let x = x0 + 0.1; x < x1 - 0.05; x += 0.16) lines.push(["a3-hold-ln", [[x, s0 + 0.035], [x, s0 + 0.085]], false]);
    lines.push(["a3-hold-ln", [[x0, ceil], [x1, ceil]], false]);
    for (const L of load) {
      if (L.kind === "ld3") {
        const top = Math.min(ceil - 0.03, floor + LD3_H);
        const a = L.xa + 0.015;
        const b = L.xb - 0.015;
        fills.push(["a3-hold-rail", box(L.xa, L.xb, floor, floor + 0.05)], ["a3-hold-uld", box(a, b, floor + 0.05, top)]);
        lines.push(["a3-hold-edge", rect(a, b, floor + 0.05, top), true]);
        for (const x of [a + 0.07, b - 0.07]) lines.push(["a3-hold-ln", [[x, floor + 0.05], [x, top]], false]);
        lines.push(["a3-hold-ln", [[a + 0.07, (floor + top) / 2], [b - 0.07, (floor + top) / 2]], false]);
        lines.push(["a3-hold-edge", rect(a + 0.14, a + 0.46, top - 0.26, top - 0.12), true]);
      } else if (L.kind === "pallet") {
        const top = Math.min(ceil - 0.08, floor + 1.45);
        const a = L.xa + 0.06;
        const b = L.xb - 0.06;
        fills.push(["a3-hold-rail", box(L.xa, L.xb, floor, floor + 0.04)], ["a3-hold-load", box(a, b, floor + 0.04, top)]);
        lines.push(["a3-hold-edge", rect(a, b, floor + 0.04, top), true]);
        // the net: diamonds of webbing over the load, clipped to it
        const net = rect(a, b, floor + 0.04, top);
        const H = top - floor;
        for (let u = a - H; u < b; u += 0.24) {
          for (const run of clipToPoly([[u, floor + 0.04], [u + H, floor + 0.04 + H]], net)) lines.push(["a3-hold-ln", run, false]);
          for (const run of clipToPoly([[u + H, floor + 0.04], [u, floor + 0.04 + H]], net)) lines.push(["a3-hold-ln", run, false]);
        }
      } else if (L.kind === "bags") {
        const rows = [[floor, floor + 0.28, [[L.xa, L.xa + 0.56], [L.xa + 0.6, L.xb]]], [floor + 0.3, floor + 0.56, [[L.xa + 0.12, L.xa + 0.66], [L.xa + 0.7, L.xb - 0.06]]]];
        for (const [sa, sb, spans] of rows)
          for (const [xa, xb] of spans) {
            const bag = roundRect((xa + xb) / 2, (sa + sb) / 2, xb - xa, sb - sa, 0.07, 3);
            fills.push(["a3-hold-bag", clipPolygonBand(clipPolygonBand(bag, 0, x0, x1), 1, s0, s1)]);
            lines.push(["a3-hold-edge", bag, true]);
            lines.push(["a3-hold-ln", [[(xa + xb) / 2 - 0.08, sb - 0.04], [(xa + xb) / 2 + 0.08, sb - 0.04]], false]);
          }
        // the cargo net across the bulk hold's doorway
        for (let x = x0 + 0.12; x < x1; x += 0.22) lines.push(["a3-hold-ln", [[x, floor], [x, ceil]], false]);
        for (const sg of [floor + 0.25, floor + 0.5, floor + 0.75]) if (sg < ceil) lines.push(["a3-hold-ln", [[x0, sg], [x1, sg]], false]);
      }
    }
    // the frame's fore and aft edges and its sill, nearest the eye
    fills.push(["a3-hold-side", box(x0, x0 + 0.07, s0, s1)], ["a3-hold-side", box(x1 - 0.07, x1, s0, s1)]);
    for (const [cls, poly] of fills) {
      if (poly.length < 3) continue;
      // straight in (x, σ), so a coarse drape step keeps them true on these near-affine facets and the page small
      for (const [fi, part] of G.drapeFill(poly, side, { step: 0.3 })) book.add(host, seg, fi, side, (fp) => `<path class="${cls} ${vc}" style="opacity:0" d="${G.pathIn(fp, part, true)}"/>`);
    }
    for (const [cls, pts, closed] of lines)
      for (const run of clipToPoly(pts, way, closed))
        for (const [fi, runs] of G.drapeLine(run, side, { step: 0.3 }))
          book.add(host, seg, fi, side, (fp) => runs.map((r) => `<path class="${cls} ${vc}" style="opacity:0" d="${G.pathIn(fp, r)}"/>`).join(""));
    // gated as the doorway jambs are: the door's share and the facing of the doorway's own facet
    // f3-fuselage: the facet the doorway covers that best faces the camera over a turn (0.866·|n_xy| + 0.5·n_z), not
    // the one at mid-height: on the tail at the model's section the bulk doorway's middle lies on a facet that faces
    // 2.9° below the edge-on line at every bearing, so the hold never showed through the part of it that can be seen
    const best = (fi) => {
      const q = G.facetPlane(seg, fi, side).n;
      return 0.866 * Math.hypot(q[0], q[1]) + 0.5 * q[2];
    };
    const covered = [...G.drapeFill(way, side, { step: 0.3 }).keys()];
    const fBest = covered.length ? covered.reduce((a, b) => (best(b) > best(a) ? b : a)) : G.facetOfSigma((s0 + s1) / 2);
    const n = G.facetPlane(seg, fBest, side).n.map((v) => +v.toFixed(5));
    ctx.vary(vc, `(() => { const b = (40 - (ch.turn || 0)) * Math.PI / 180; const p = (ch.pitch || 0) * Math.PI / 180; const nx = (${n[0]}) * Math.cos(p) + (${n[2]}) * Math.sin(p); const nz = -(${n[0]}) * Math.sin(p) + (${n[2]}) * Math.cos(p); const f = -nx * Math.cos(b) * 0.866 + (${n[1]}) * Math.sin(b) * 0.866 + nz * 0.5; return Math.min(1, ${id === "BULK" ? `(ch["door.BULK"] || 0)` : shareOf(id)} * 3) * F.smooth(0.02, 0.15, f); })()`);
  }

  // ============================ passenger doors ============================
  for (const D of S.passenger) {
    const gArm = `door.${D.id}.arm`;
    const gDoor = `door.${D.id}`;
    // the arm (knuckle and bar in one convex hull) with the door-hinge pin and the arm-hinge pin on its top face
    const pinA2 = add(add(D.A2, mul(D.vA, ARM_T / 2)), mul(D.nA, 0.04));
    const pinA1 = add(add(D.A1, mul(D.vA, ARM_T / 2)), mul(D.nA, 0));
    // fu/fuselage (item 12): the arm and the leaf carry the class a3-leaf-{ID}: they fade in over the first 5% of the swing,
    // and a shut door is drawn flush on its host (below)
    const leafCls = `a3-leaf-${D.id}`;
    hull({ name: `door.${D.id}.arm`, group: gArm, cls: leafCls, points: D.armPts.map(kit), details: { dots: [pinA1, pinA2].map((p) => ({ at: kit(p), normal: W.kitDir(D.vA), size: 0.42, tone: "mid" })) } });
    // a leaf's strips are one plate: the seam between them is a faint joint (kit patch 15), not a second outline, so
    // a closed door reads as one outline with its porthole and handle (a hi line across its middle read as a black box)
    const leaves = D.strips.map((st, k) => hull({ name: D.strips.length === 1 ? `door.${D.id}.leaf` : `door.${D.id}.leaf.${k === 0 ? "lo" : "hi"}`, group: gDoor, cls: leafCls, points: st.points.map(kit), rerank: true, ...stripJoints(W, D.fps, k) })); // f4-fuselage: rerank (rounded corners)
    // details on each leaf's outer face: the lit outline (doors accent), porthole, handle, slide bustle
    const winZ = D.upper ? WIN.upperZ : WIN.mainZ + (D.d.sillZ - 5.15);
    const placed = []; // the details drawn on the leaf, by facet: the shut picture draws the same
    D.strips.forEach((st, k) => {
      const part = leaves[k];
      const off = GAP + PLATE_T;
      const of = outerFace(W, st, off);
      ctx.accent("doors", { part, ...of.opts, svg: accentRuns(W, st, off, D.fps, k).map((run) => `<path class="iso-line" data-tone="lit" d="${pathOf(run, run.length > 2 && D.strips.length === 1)}"/>`).join("") });
      counts.planes++;
      const parts = [];
      const zs = st.points.map((p) => p[2]);
      const zr = [Math.min(...zs), Math.max(...zs)];
      const onStrip = (z, m = 0.12) => z > zr[0] + m && z < zr[1] - m;
      const at = (x, z) => of.xy(add(G.skinPoint(x, st.facet, D.side, z), mul(st.fp.n, off)));
      for (const dt of passengerDetails(D, winZ)) {
        if (!onStrip(dt.fitZ, dt.m)) continue;
        const [X, Y] = at(dt.x, dt.z);
        parts.push(dt.svg(X, Y));
        placed.push({ ...dt, facet: st.facet });
      }
      if (parts.length) {
        ctx.plane(part, { ...of.opts, svg: parts.join("") });
        counts.planes++;
      }
    });
    // on the host: the painted surround, the doorway (vary with the door) and its frame
    const s0 = G.sigmaOf(D.d.x, D.zb) - SURROUND.margin;
    const s1 = G.sigmaOf(D.d.x, D.zt) + SURROUND.margin;
    const sur = roundRect(D.d.x, (s0 + s1) / 2, 2 * SURROUND.halfWidth, s1 - s0, 0.16, 5);
    const ds0 = G.sigmaOf(D.d.x, D.d.sillZ);
    const ds1 = ds0 + D.d.height;
    const way = roundRect(D.d.x, (ds0 + ds1) / 2, D.d.width, ds1 - ds0, 0.2, 5);
    for (const [fi, poly] of G.drapeFill(way, D.side)) book.add(D.host.name, D.seg, fi, D.side, (fp) => `<path class="a3-dw a3-dw-${D.id}" style="opacity:0" d="${G.pathIn(fp, poly, true)}"/>`);
    doorwayInterior(D, way, ds0, ds1);
    // the doorway's frame shows once the leaf is off it (fu/fuselage: the shut door is a flush picture, so the frame
    // under it would read as a line inside the door)
    for (const [fi, runs] of G.drapeLine(way, D.side, { closed: true })) book.add(D.host.name, D.seg, fi, D.side, (fp) => `<g class="a3-dwf-${D.id}">${runsSvg(fp, runs, "faint")}</g>`);
    for (const [fi, runs] of G.drapeLine(sur, D.side, { closed: true })) book.add(D.host.name, D.seg, fi, D.side, (fp) => runsSvg(fp, runs, "lo"));
    ctx.vary(`a3-dw-${D.id}`, `Math.min(1, ${shareOf(D.id)} * 4)`);
    shutPicture({ id: D.id, host: D.host.name, seg: D.seg, side: D.side, x: D.d.x, zb: D.zb, zt: D.zt, width: LEAF_W, r: LEAF_R, placed });
    ctx.vary(`a3-dwf-${D.id}`, `F.smooth(0, ${LEAF_FADE}, ${shareOf(D.id)})`);
    // the leaf's porthole: lit by the cabin while the door is shut (the windows program draws no portholes)
    // a door's porthole is lit as the windows beside it are: the same displayed-luminance curve (cabin^.66) and, with
    // WebGL, the windows program's warm-white core colour (a3-port-gl); without it, the fallback window colour
    const cab = `Math.pow(Math.max(0, pv.cabinLight !== undefined ? pv.cabinLight : (s && s.cabin) || 0), 0.66) * (1 - Math.min(1, ${shareOf(D.id)} * 3))`;
    // fu/r1-lights: the porthole is SVG in both painters, so it keeps the GL page's picture without WebGL too (review
    // fu-1: it went from a pale core to flat amber at the handover, 94 levels in B by daylight)
    // fu/r2-lights: by daylight the porthole is a window pane: its three layers (amber, rim, core; lights.mjs gives them
    // the windows' daylight inks) at the windows' fitted alphas (pv.winA), while the door is shut (review fu-r2: amber
    // (222,208,174) beside GL panes at the glass, in both painters)
    const shutP = `(1 - Math.min(1, ${shareOf(D.id)} * 3))`;
    ctx.vary(`a3-port-${D.id}`, `LIGHT && pv.winA ? pv.winA[0] * ${shutP} : 0 * ${cab}`);
    ctx.vary(`a3-portgl-${D.id}`, `LIGHT && pv.winA ? pv.winA[1] * ${shutP} : ${cab}`);
    // the windows program's paper ink: a pale core inside the saturated rim (review round 3: the portholes were solid
    // amber beside pale-cored windows at Inspect zoom)
    ctx.vary(`a3-portc-${D.id}`, `LIGHT && pv.winA ? pv.winA[2] * ${shutP} : ${cab}`);
    ctx.vary(`a3-portb-${D.id}`, `LIGHT && pv.winA ? pv.winA[3] * ${shutP} : 0`);
    // fu/r1-lights end
    const deckWord = D.upper ? "upper-deck" : "main-deck";
    const kind = D.id.startsWith("M3") ? "Type A over-wing emergency exit" : "Type A door";
    const body = `var v = (s && s.doors && s.doors[${JSON.stringify(D.id)}]) || 0; return ${JSON.stringify(`${D.id} · ${deckWord} ${kind} · sill ${+D.d.sillZ.toFixed(3)} m · `)} + (v > 0.98 ? "open" : v > 0.02 ? "moving" : "closed");`;
    ctx.label(`door.${D.id}.`, new Function("s", body), `door:${D.id}`);
  }

  // ============================ cargo doors and the bulk door ============================
  for (const C of S.cargo) {
    const g = `door.${C.id}`;
    // the hinge knuckle: a prism coaxial with the hinge, one face on the skin at rest and one once open (like the arm
    // knuckles; knuckleAngles' −90 is this frame's 180, u the facet normal: a face centred on −u, the skin side)
    const F0 = { o: kit(add(C.K0, mul(C.ft.u, C.sF))), a: W.kitDir(C.ft.u), u: W.kitDir(C.ft.n), v: W.kitDir(C.ft.v) };
    // fu/r1-fuselage: the ring at the page's packed precision (1e-3 kit units, kit turn-build r3), so the build's prism
    // (the fidelity check's k.extrude/G.prismOf reference) and the page's are one polygon. Unrounded, the AFT hinge's
    // face 16 stood edge-on at turn 7 (facing −0.0006 in the build, +0.0004 in the page): the page drew a zero-width
    // tone-1 sliver the reference did not, 0.57 px from any reference face of that tone (fidelity failed)
    const r3 = (v) => Math.round(v * 1e3) / 1e3;
    const gon = knuckleAngles(CARGO_OPEN).map((deg) => {
      const phi = (deg + 270) * D2R;
      return [r3(W.m(ARM_R) * Math.cos(phi)), r3(W.m(ARM_R) * Math.sin(phi))];
    });
    ctx.prism({ name: `door.${C.id}.hinge`, group: g, cls: `a3-leaf-${C.id}`, F: F0, polygon: gon, s0: 0, s1: W.m(C.sA - C.sF), tone: "hi", material: "steel" });
    counts.parts++;
    const leaves = C.strips.map((st, k) => hull({ name: `door.${C.id}.panel.${k + 1}`, group: g, cls: `a3-leaf-${C.id}`, points: st.points.map(kit), ...stripJoints(W, C.fps, k) }));
    const placed = []; // the details drawn on the panels, by facet: the shut picture draws the same
    C.strips.forEach((st, k) => {
      const part = leaves[k];
      const off = GAP + PLATE_T;
      const of = outerFace(W, st, off);
      ctx.accent("doors", { part, ...of.opts, svg: accentRuns(W, st, off, C.fps, k).map((run) => `<path class="iso-line" data-tone="lit" d="${pathOf(run, C.strips.length === 1)}"/>`).join("") });
      counts.planes++;
      const parts = [];
      const zs = st.points.map((p) => p[2]);
      const zc = (Math.min(...zs) + Math.max(...zs)) / 2;
      const at = (x, z) => of.xy(add(G.skinPoint(x, st.facet, C.side, z), mul(st.fp.n, off)));
      const put = (x, z, svg) => {
        const [X, Y] = at(x, z);
        parts.push(svg(X, Y));
        placed.push({ x, z, facet: st.facet, svg });
      };
      if (k === 0)
        for (const f of [-0.36, -0.12, 0.12, 0.36]) {
          // the lower strip: four latch-handle flaps along the sill
          put(C.c.x + f * C.c.width, zc, (X, Y) => `<path class="iso-line" data-tone="lo" d="${roundRectPath(X, Y, 2.4, 0.7, 0.3)}"/>`);
        }
      if (k === C.strips.length - 2) {
        // the master handle and the pressure-vent door
        put(C.c.x, zc, (X, Y) => `<path class="iso-line" data-tone="lo" d="${roundRectPath(X, Y, 4.6, 1.2, 0.4)}"/><path class="iso-line" data-tone="mid" d="${roundRectPath(X, Y, 3.0, 0.32, 0.16)}"/>`);
        put(C.x1 - 0.32, zc, (X, Y) => `<path class="iso-line" data-tone="faint" d="${roundRectPath(X, Y, 1.9, 1.3, 0.3)}"/>`);
      }
      if (parts.length) {
        ctx.plane(part, { ...of.opts, svg: parts.join("") });
        counts.planes++;
      }
    });
    const s0 = G.sigmaOf(C.c.x, C.zb) - SURROUND.margin;
    const s1 = G.sigmaOf(C.c.x, C.zt) + SURROUND.margin + 0.07;
    const sur = roundRect(C.c.x, (s0 + s1) / 2, C.c.width + 2 * SURROUND.margin, s1 - s0, 0.18, 5);
    const ds0 = G.sigmaOf(C.c.x, C.zb) + 0.03;
    const ds1 = G.sigmaOf(C.c.x, C.zt) - 0.03;
    const way = roundRect(C.c.x, (ds0 + ds1) / 2, C.c.width - 0.06, ds1 - ds0, 0.2, 5);
    for (const [fi, poly] of G.drapeFill(way, C.side)) book.add(C.host.name, C.seg, fi, C.side, (fp) => `<path class="a3-dw a3-dw-${C.id}" style="opacity:0" d="${G.pathIn(fp, poly, true)}"/>`);
    holdInterior({ id: C.id, host: C.host.name, seg: C.seg, side: C.side, way, x0: C.c.x - (C.c.width - 0.06) / 2, x1: C.c.x + (C.c.width - 0.06) / 2, s0: ds0, s1: ds1, load: HOLD_LOAD[C.id](C.c.x) });
    for (const [fi, runs] of G.drapeLine(sur, C.side, { closed: true })) book.add(C.host.name, C.seg, fi, C.side, (fp) => runsSvg(fp, runs, "lo"));
    ctx.vary(`a3-dw-${C.id}`, `Math.min(1, ${shareOf(C.id)} * 3)`);
    shutPicture({ id: C.id, host: C.host.name, seg: C.seg, side: C.side, x: C.c.x, zb: C.zb, zt: C.zt, width: C.c.width, r: 0.12, placed });
    const word = C.id === "FWD" ? "Forward" : "Aft";
    const holdWord = HOLD_WORDS[C.id];
    const body = `var v = (s && s.doors && s.doors[${JSON.stringify(C.id)}]) || 0; return ${JSON.stringify(`${word} cargo door · ${C.c.width.toFixed(2)} × ${C.c.height.toFixed(2)} m · top-hinged, hydraulic · `)} + (v > 0.98 ? ${JSON.stringify(`open · ${holdWord}`)} : v > 0.02 ? "moving" : "closed");`;
    ctx.label(`door.${C.id}.`, new Function("s", body), `door:${C.id}`);
  }
  {
    // bulk cargo door: an outline and a doorway that darkens (it swings inward, not modelled: DESIGN §11.3)
    const b = M.DOORS.cargo.find((c) => c.id === "BULK");
    const side = b.side === "L" ? -1 : 1;
    const host = W.partAt(b.x, b.sillZ + 0.5, side);
    const seg = G.segAt(b.x - b.width / 2, b.x + b.width / 2);
    const s0 = G.sigmaOf(b.x, b.sillZ);
    const s1 = s0 + b.height;
    const out = roundRect(b.x, (s0 + s1) / 2, b.width, s1 - s0, 0.14, 5);
    for (const [fi, poly] of G.drapeFill(out, side)) book.add(host.name, seg, fi, side, (fp) => `<path class="a3-dw a3-dw-BULK" style="opacity:0" d="${G.pathIn(fp, poly, true)}"/>`);
    holdInterior({ id: "BULK", host: host.name, seg, side, way: out, x0: b.x - b.width / 2, x1: b.x + b.width / 2, s0, s1, load: HOLD_LOAD.BULK(b.x) });
    for (const [fi, runs] of G.drapeLine(out, side, { closed: true })) book.add(host.name, seg, fi, side, (fp) => runsSvg(fp, runs, "lo"));
    const hdl = roundRect(b.x + 0.32, (s0 + s1) / 2, 0.22, 0.08, 0.03, 3);
    // fu/r2-fuselage: the handle is the shut door's: it fades as the door opens (it stood on the open doorway's dark)
    for (const [fi, runs] of G.drapeLine(hdl, side, { closed: true })) book.add(host.name, seg, fi, side, (fp) => `<g class="a3-bulk-hdl">${runsSvg(fp, runs, "mid")}</g>`);
    ctx.vary("a3-bulk-hdl", `1 - Math.min(1, ${shareOf("BULK")} * 4)`);
    ctx.vary("a3-dw-BULK", '(ch["door.BULK"] || 0)');
    // fu/r1-fuselage: the bulk door's pick region, so the bulk hold opens and closes alone like FWD and AFT (a click
    // there named the rear fuselage and did nothing). A plate over the opening W.GAP off its facets, as a shut cargo
    // panel stands, that is never drawn: shut, the outline and handle above are the door; open, it has swung inward
    // and up into the hold (not modelled, DESIGN §11.3) and the doorway shows the hold. Picked, labelled and ordered
    // like the other doors' plates (pickAt skips only the Inspect fades, not a vary at 0)
    const BD = cargoDoor(W, G, { ...b, width: b.width - 0.02, height: b.height - 0.02, sillZ: b.sillZ + 0.01 }, GAP);
    BD.strips.forEach((st, k) => hull({ name: `door.BULK.panel.${k + 1}`, group: host.group, cls: "a3-leaf-BULK", points: st.points.map(kit), ...stripJoints(W, BD.fps, k) }));
    ctx.vary("a3-leaf-BULK", "0");
    const bulkBody = `var v = (s && s.doors && s.doors.BULK) || 0; return ${JSON.stringify(`Bulk cargo door · ${b.width.toFixed(2)} × ${b.height.toFixed(2)} m · manual, opens inward and up · `)} + (v > 0.98 ? "open · bulk hold: loose baggage (2.8 m long)" : v > 0.02 ? "moving" : "closed");`;
    ctx.label("door.BULK.", new Function("s", bulkBody), "door:BULK");
    // fu/r1-fuselage end
  }

  // ============================ the window markup (glass, lit copy, frame), drawn over doorways and surrounds ============================
  for (const [, e] of book.entries()) {
    if (!e.win) continue;
    const fp = e.fp;
    const glass = [];
    const lit = [];
    const frame = [];
    const core = []; // fu/r1-lights: the daylight pale core, 0.02 m in from the pane's edge (lights.mjs colours and fades it)
    const shut = []; // fu/r2-lights: a closed blind, lit from behind by the cabin (lights.mjs colours and fades it)
    for (const { p, blind } of e.win) {
      const [X, Y] = fp.xy(p);
      glass.push(roundRectPath(X, Y, W.m(ww), W.m(wh), 0.7));
      if (!blind) lit.push(roundRectPath(X, Y, W.m(ww), W.m(wh), 0.7));
      if (blind && ctx.theme !== "light") shut.push(roundRectPath(X, Y, W.m(ww), W.m(wh), 0.7)); // fu/r2-lights
      if (!blind && ctx.theme === "light") core.push(roundRectPath(X, Y, W.m(ww - 0.04), W.m(wh - 0.04), 0.5)); // fu/r1-lights fu/r1-lights end
      frame.push(roundRectPath(X, Y, W.m(ww) + 0.7, W.m(wh) + 0.7, 1.05));
    }
    e.parts.push(`<path class="iso-line" data-tone="faint" d="${frame.join("")}"/><path class="a3-win" d="${glass.join("")}"/>${lit.length ? `<path class="a3-win-lit" style="opacity:0" d="${lit.join("")}"/><path class="a3-win-hot" style="opacity:0" d="${lit.join("")}"/>` : ""}${core.length ? `<path class="a3-win-cbase" style="opacity:0" d="${core.join("")}"/><path class="a3-win-core" style="opacity:0" d="${core.join("")}"/>` : ""}${shut.length ? `<path class="a3-win-shut" style="opacity:0" d="${shut.join("")}"/>` : ""}`); // fu/r1-lights: + a3-win-core; fu/r2-lights: + a3-win-shut
  }
  // the GL windows' displayed-luminance curve (cabin^.66, shaders.mjs glslWindowPart), so the handover keeps the level
  // review round 3: the GL windows dim in energy, so their hue holds as they fall; the fallback stacks the window's
  // colour at 40% light (a3-win-lit, in by lvD .4) under its gate colour (a3-win-hot, over .4 → 1), both from the
  // shader's 1x ink, so the handover keeps level and hue. By daylight the saturated body holds half its cover
  const lvD = "Math.pow(Math.max(0, pv.cabinLight !== undefined ? pv.cabinLight : (s && s.cabin) || 0), 0.66)";
  const hand = "(1 - (pv.glShare || 0)) / (1 - 0.9 * (pv.glShare || 0) + 1e-6)";
  // fu/r2-lights: by daylight the three layers take gl/passes.js's fitted alphas (pv.winA: amber, rim, core), so the pane
  // composites what the windows program lays at this zoom and cabin level (review fu-r2: amber against GL's glass at the
  // Tail and Wing gear zooms with the cabin dimmed); the r1 laws stay as the fallback before the first frame
  ctx.vary("a3-win-lit", `(() => { const l = ${lvD}; return (LIGHT ? (pv.winA ? pv.winA[0] : 0.5 * F.smooth(0, 0.4, l) + 0.5 * F.smooth(0.4, 1, l)) : Math.min(1, l / 0.4)) * ${hand}; })()`);
  // fu/lights: the gate colour comes in as the GL's tonemapped curve rises (follow-up item 26: with smooth(.4, 1) the FL100
  // cabin, lvD .71, read 10 levels under the GL; 1 - (1 - t)^1.5 meets it at lvD .4, .54, .71, .85 and 1)
  // fu/r1-lights: by daylight a3-win-hot is the GL's warm rim and a3-win-core its pale core, in as the GL's own core comes
  // in with the pane's size on screen (pv.winCore, gl/passes.js; review fu-1: at Inspect zoom the GL pane is a pale core in
  // a one-pixel warm rim, the fallback was flat amber); the dark theme is unchanged
  ctx.vary("a3-win-hot", `LIGHT ? (pv.winA ? pv.winA[1] : (pv.winCore || 0) * (0.5 * F.smooth(0, 0.4, ${lvD}) + 0.5 * F.smooth(0.4, 1, ${lvD}))) * ${hand} : (1 - (1 - Math.min(1, Math.max(0, (${lvD} - 0.4) / 0.6))) ** 1.5) * ${hand}`);
  ctx.vary("a3-win-cbase", `LIGHT && pv.winA ? pv.winA[3] * ${hand} : 0`);
  ctx.vary("a3-win-core", `LIGHT ? (pv.winA ? pv.winA[2] : (pv.winCore || 0) * (0.5 * F.smooth(0, 0.4, ${lvD}) + 0.5 * F.smooth(0.4, 1, ${lvD}))) * ${hand} : 0`);
  // fu/r2-lights: a closed blind at night is a dim pane lit from behind (the GL's blind energy, tonemapped near linear,
  // so its cover follows lvD); by day it stays glass (review fu-r2: a black hole darker than the card)
  ctx.vary("a3-win-shut", `LIGHT ? 0 : ${lvD} * ${hand}`);
  // fu/r1-lights end
  // fu/lights end

  // ============================ small parts (each on its host's group) ============================
  for (const B of BLADES) {
    const host = W.partAt(B.x, 10.7, 1);
    const seg = G.segAt(B.x - B.L, B.x + B.L);
    const fp = G.facetPlane(seg, "crown", 1);
    const r = W.ring2(B.x);
    const o = [B.x - B.L / 2, 0, W.ring2(B.x - B.L / 2)[15][1]]; // on the crown facet (it slopes in the nose)
    const Fb = { o: kit(o), a: [0, 1, 0], u: fp.U, v: fp.N };
    const poly = [[0, 0], [W.m(B.L), 0], [W.m(B.L * 0.9), W.m(B.H)], [W.m(B.L * 0.56), W.m(B.H)]];
    ctx.prism({ name: B.name, group: host.group, F: Fb, polygon: poly, s0: -W.m(B.T / 2), s1: W.m(B.T / 2), tone: "hi", material: "steel" });
    counts.parts++;
    // the doubler plate under the blade
    const pad = [B.x - B.L * 0.62, B.x + B.L * 0.62];
    const zc = (x) => W.ring2(x)[15][1];
    book.add(host.name, seg, "crown", 1, (q) => `<path class="iso-line" data-tone="faint" d="${pathOf([[pad[0], -0.11, zc(pad[0])], [pad[1], -0.11, zc(pad[1])], [pad[1], 0.11, zc(pad[1])], [pad[0], 0.11, zc(pad[0])]].map(q.xy), true)}"/>`);
    ctx.label(B.name, B.label);
  }
  // beacons on the stub's mounts (the lights stub registers its lights on these housings when M8 is stubbed)
  const beacons = [["beaconUpperL", "light.beacon.upperL"], ["beaconUpperR", "light.beacon.upperR"], ["beaconLower", "light.beacon.lower"]];
  for (const [idb, name] of beacons) {
    const b = beaconMount(W, idb);
    const host = idb === "beaconLower" ? { group: "pitch", name: "skin.fair.r.mid" } : W.partAt(b.base[0], b.base[2], Math.sign(b.base[1]) || 1);
    const helper = Math.abs(b.n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
    ctx.round({ name, group: host.group, F: { o: kit(b.base), a: W.kitDir(b.n), u: W.kitDir(helper), v: [0, 0, 1] }, s0: 0, s1: W.m(b.s1), r: W.m(b.r), ends: ["flat", "dome"], tone: "hi", material: "chrome", details: { seams: [W.m(b.s1 * 0.5)] } });
    counts.parts++;
    if (!ctx.stubbed("lights")) ctx.light({ id: idb, part: name, group: host.group, at: kit(b.tip), normal: W.kitDir(b.n), kind: "beacon", color: "red", lens: 0.11, halo: 3.0, switch: "beacon", flash: { period: M.LIGHTS.flash.beacon.periodS, offsets: [0], rise: 0.04, hold: M.LIGHTS.flash.beacon.on - 0.04, fall: 0.03, phase: M.LIGHTS.flash.beacon.offsetS } });
    ctx.label(name, `Anti-collision beacon, ${idb === "beaconLower" ? "under the belly" : `upper ${idb.endsWith("L") ? "left" : "right"}`} · red, 60 flashes a minute · on before the engines start`, "light:beacon");
  }
  for (const [idb] of beacons.slice(0, 2)) {
    // the gasket ring round each upper beacon on the crown
    const b = beaconMount(W, idb);
    const side = Math.sign(b.base[1]);
    const seg = G.segAt(b.base[0] - 0.3, b.base[0] + 0.3);
    book.add(W.partAt(b.base[0], b.base[2], side).name, seg, 13, side, (fp) => {
      const [X, Y] = fp.xy(b.base);
      return `<circle class="iso-line" data-tone="lo" cx="${f2(X)}" cy="${f2(Y)}" r="${f2(W.m(b.r) + 0.35)}"/>`;
    });
  }
  // scan lamps: wing scan (11.24) and engine scan (8.42) on the fuselage sides, below the main window line [E z]
  const lamps = [];
  for (const L of [...M.LIGHTS.wingScan.map((l) => ({ ...l, kind: "wing" })), ...M.LIGHTS.engineScan.map((l) => ({ ...l, kind: "engine" }))]) {
    const side = Math.sign(L.at[1]);
    const zc = 5.86;
    const host = W.partAt(L.at[0], zc, side);
    const fi = G.facetIndexAt(L.at[0], zc);
    const seg = G.segAt(L.at[0] - 0.2, L.at[0] + 0.2);
    const fp = G.facetPlane(seg, fi, side);
    const base = G.skinPoint(L.at[0], fi, side, zc);
    const name = `light.scan.${L.kind}.${side < 0 ? "l" : "r"}`;
    const rr = 0.085;
    const s1 = 0.045;
    ctx.round({ name, group: host.group, F: { o: kit(base), a: fp.N, u: fp.U, v: fp.V }, s0: 0, s1: W.m(s1), r: W.m(rr), ends: ["flat", "dome"], tone: "hi", material: "chrome" });
    counts.parts++;
    const tip = add(base, mul(fp.n, s1 + rr));
    const aim = unit(sub(L.aimAt, tip));
    ctx.light({ id: L.id, part: name, group: host.group, at: kit(tip), normal: W.kitDir(fp.n), kind: "lens", color: "white", lens: 0.05, halo: 2.4, switch: L.kind, settle: 0.35 });
    ctx.lamp({ id: L.id, part: name, group: host.group, at: kit(tip), dir: W.kitDir(aim), cone: L.kind === "wing" ? 10 : 14, switch: L.kind });
    lamps.push({ id: L.id, at: tip });
    book.add(host.name, seg, fi, side, (q) => {
      const [X, Y] = q.xy(base);
      return `<circle class="iso-line" data-tone="lo" cx="${f2(X)}" cy="${f2(Y)}" r="${f2(W.m(rr) + 0.3)}"/>`;
    });
    ctx.label(name, L.kind === "wing" ? "Wing scan light · lights the wing leading edge and slats to check for ice" : "Engine scan light · lights the engine intakes to check for ice", "light:scan");
  }
  // cargo flood lenses above the cargo doors (planes on their hosts) and their lamps
  for (const L of M.LIGHTS.cargoFlood) {
    const side = Math.sign(L.at[1]);
    const zc = 5.07;
    const host = W.partAt(L.at[0], zc, side);
    const fi = G.facetIndexAt(L.at[0], zc);
    const seg = G.segAt(L.at[0] - 0.2, L.at[0] + 0.2);
    const base = G.skinPoint(L.at[0], fi, side, zc);
    book.add(host.name, seg, fi, side, (fp) => {
      const [X, Y] = fp.xy(base);
      return `<path class="iso-line" data-tone="lo" d="${roundRectPath(X, Y, 2.6, 1.0, 0.4)}"/><path class="a3-lens" d="${roundRectPath(X, Y, 1.9, 0.55, 0.25)}"/><path class="a3-flood-lit" style="opacity:0" d="${roundRectPath(X, Y, 1.9, 0.55, 0.25)}"/>`;
    });
    const dir = unit([0, side * 0.55, -1]);
    ctx.lamp({ id: L.id, part: host.name, group: host.group, at: kit(add(base, [0, side * 0.01, 0])), dir: W.kitDir(dir), cone: 40, switch: "cargoFlood" });
  }
  ctx.vary("a3-flood-lit", "(s && s.lights && s.lights.cargoFlood ? 1 : 0) * (1 - (pv.glShare || 0))");
  {
    // ETACS belly camera window on the fairing nose's bottom face [E]
    const x = 21.2;
    const zb = Math.min(...F.half(x).map((p) => p[1])) - 0.004;
    const P = [[x, -0.25, zb], [x + 0.6, -0.25, zb - 0.04], [x, 0.25, zb]];
    const fp = G.facetPlane(null, P, 1, [0, 0, -1]);
    const [X, Y] = fp.xy([x + 0.2, 0, zb]);
    ctx.planeOn("skin.fair.nose", G.planeOpts(fp, `<path class="a3-lens" d="${roundRectPath(X, Y, 1.6, 1.0, 0.45)}"/>`));
    counts.planes++;
  }
  // SATCOM fairing outline on the upper-deck crown [E], draped over the crown facet and its neighbours
  {
    const x0 = 29.0;
    const x1 = 31.4;
    const host = W.partAt(30.2, 10.7, 1);
    const seg = G.segAt(x0, x1);
    const plan = roundRect((x0 + x1) / 2, 0, x1 - x0, 1.04, 0.42, 6);
    const r = W.ring2(30);
    const zOf = (y) => {
      const a = Math.abs(y);
      if (a <= r[15][0]) return r[15][1];
      for (let i = 14; i >= 0; i--) if (a >= r[i + 1][0] && a <= r[i][0]) return lerp(r[i][1], r[i + 1][1], (a - r[i][0]) / (r[i + 1][0] - r[i][0]));
      return r[14][1];
    };
    for (const [fi, lo, hi, side] of [["crown", -r[15][0], r[15][0], 1], [14, r[15][0], r[14][0], 1], [14, -r[14][0], -r[15][0], -1]]) {
      const runs = clipRunsPlan(plan, lo, hi);
      if (runs.length) book.add(host.name, seg, fi, side, (fp) => runs.map((run) => line(fp, run.map(([x, y]) => [x, y, zOf(y)]), "lo", Boolean(run.closedLoop))).join(""));
    }
  }

  counts.planes += book.flush(ctx);

  // ============================ GL targets: the cabin windows per window-bearing part ============================
  for (const [host, t] of targets) {
    const rows = t.rows.map((row) => {
      const fp = G.facetPlane(row.seg, row.facet, row.side);
      return { deck: row.deck, side: row.side, z: row.z, facet: row.facet, seg: row.seg, xs: row.xs.slice().sort((a, b) => a - b), kitX: row.xs.map((x) => kit([x, 0, 0])[0]).sort((a, b) => a - b), plane: { n: fp.N, d: dot(fp.N, fp.O) } };
    });
    const segs = [...new Set(t.rows.map((r) => `${r.seg[0]}|${r.seg[1]}`))].map((k) => k.split("|").map(Number));
    const sections = segs.map((sg) => ({ seg: sg, kitX: sg.map((x) => kit([x, 0, 0])[0]), half: sg.map((x) => W.ring2(x).slice(0, 16)) }));
    const doors = S.passenger.filter((D) => D.host.name === host).map((D) => ({ id: D.id, side: D.side, channel: `door.${D.id}`, x: [D.x0, D.x1], kitX: [kit([D.x1, 0, 0])[0], kit([D.x0, 0, 0])[0]], sill: D.d.sillZ, opening: [D.d.width, D.d.height], weight: `door.${D.id}` }));
    ctx.glTarget({ name: `windows.${host}`, part: host, kind: "windows", constants: { group: t.group, size: [ww, wh], radius: 0.07, pitch: WIN.pitch, rows, sections, doors, units: "model m (x, z, sill, opening) with kit copies (kitX); plane n·p = d in kit units; sections: the starboard S0 ring halves [y, z] (m) at the segment ends" } });
  }

  // ============================ inspect, clips, data, labels, CSS ============================
  ctx.inspect({ id: "door-M2L", label: "Door M2L", centre: [16.5, -3.55, 6.1], group: "pitch", bearing: -80, zoom: 6, cutaway: 0 });
  const allDoors = M.DOOR_IDS;
  const doorsAt = (t) => {
    // all 19 doors open and close at ×2: passenger 8 s, cargo 20 s, bulk 6 s of model time (DESIGN §3.5)
    const ramp = (T) => Math.max(0, Math.min(1, t / T) - Math.min(1, Math.max(0, t - 10) / T));
    return Object.fromEntries(allDoors.map((idd) => [`door.${idd}`, idd === "FWD" || idd === "AFT" ? ramp(10) : idd === "BULK" ? ramp(3) : ramp(4)]));
  };
  for (const turn of [0, 180]) ctx.clip({ name: turn ? `doors${turn}` : "doors", at: (t) => W.groundChannels({ turn, ...doorsAt(t) }), from: 0, to: 20, frame: 1 / 60 });
  // fu/fuselage (item 10): the stand with every door and hold open while the cutaway lifts its first metre (cabin
  // 0.02-0.5, what C does at the gate): poses() samples them for the kit's nearness tests, and kit patch 9 builds
  // framed planes from them
  ctx.poseHints([0.02, 0.04, 0.06, 0.08, 0.1, 0.13, 0.16, 0.2, 0.25, 0.3, 0.4, 0.5].map((cabin) => W.groundChannels({ ...Object.fromEntries(allDoors.map((idd) => [`door.${idd}`, 1])), cabin })));
  // fu/fuselage: A3.doorShare(id, ch), the door's share as the controller holds it (passenger: the arm group's angle over
  // its swing; cargo: the hinge over CARGO_OPEN), read once a frame in the frame hook, which runs before the vary
  // alphas; until the first frame (and for the bulk door, which has no group) the door channel
  {
    const groupsOf = Object.fromEntries([...S.passenger.map((D) => [D.id, [`door.${D.id}.arm`, +D.theta.toFixed(6)]]), ...S.cargo.map((C) => [C.id, [`door.${C.id}`, CARGO_OPEN]])]);
    ctx.script(`(() => {
  const DOOR_GROUPS = ${JSON.stringify(groupsOf)};
  let held = null;
  A3.on("frame", (fx) => {
    const v = fx.controller.values;
    held = {};
    for (const id in DOOR_GROUPS) {
      const [g, full] = DOOR_GROUPS[id];
      if (typeof v[g] === "number") held[id] = Math.min(1, Math.max(0, v[g] / full));
    }
  });
  A3.doorShare = (id, ch) => (held && held[id] !== undefined ? held[id] : (ch["door." + id] || 0));
})();`);
  }
  ctx.data("m6", { windows: windows.length, doors: S.passenger.map((D) => ({ id: D.id, host: D.host.name, group: D.host.group, theta: +D.theta.toFixed(3), arm: +D.L.toFixed(4), strips: D.facets })) });
  ctx.label("skin.fair.", "Belly fairing · the wing-to-body fairing over the gear bays and air-conditioning packs · 1.66 m above the runway at its lowest");
  ctx.label("skin.keel", "Keel beam between the wing-gear bays");
  ctx.css(`.iso{--a3-glass:#b9c3cc;--a3-win-lit:#f9c565;--a3-port-lit:#f9c565;--a3-cavity:#6e6a63;--a3-lens:#7d8c99;--a3-flood:#f3c76d;--a3-port-core:#f4e6c3;--a3-win-hot:#f9c565}
.iso[data-theme="dark"]{--a3-port-core:#fff6e4;--a3-win-hot:#f4eacf;--a3-glass:#06080a;--a3-win-lit:#cbb993;--a3-port-lit:#efe2c4;--a3-cavity:#020304;--a3-lens:#1b2630;--a3-flood:#ffe2a6}
.a3-win{fill:var(--a3-glass);stroke:none}
.a3-win-lit{fill:var(--a3-win-lit);stroke:none}
.a3-win-lit-door{fill:var(--a3-win-hot);stroke:none}
.a3-win-hot{fill:var(--a3-win-hot);stroke:none}
.a3-port-gl{fill:var(--a3-port-lit);stroke:none}
.a3-port-core{fill:var(--a3-port-core);stroke:none}
.a3-dw,[class*="a3-dw-"]{fill:var(--a3-cavity);stroke:var(--a3-cavity);stroke-width:.6px;stroke-linejoin:round}
.iso{--a3-dwi-ceil:#cfc8bb;--a3-dwi-wall:#b9b0a1;--a3-dwi-floor:#8f8578;--a3-dwi-jamb:#d8d3cb;--a3-dwi-sill:#e6e2dc;--a3-dwi-line:#8a8275}
.iso[data-theme="dark"]{--a3-dwi-ceil:#2a2621;--a3-dwi-wall:#1d1a17;--a3-dwi-floor:#141210;--a3-dwi-jamb:#34383c;--a3-dwi-sill:#44494e;--a3-dwi-line:#3a352e}
[class*="a3-dw-"].a3-dwi-ceil{fill:var(--a3-dwi-ceil);stroke:var(--a3-dwi-ceil)}
[class*="a3-dw-"].a3-dwi-wall{fill:var(--a3-dwi-wall);stroke:var(--a3-dwi-wall)}
[class*="a3-dw-"].a3-dwi-floor{fill:var(--a3-dwi-floor);stroke:var(--a3-dwi-floor)}
[class*="a3-dwj-"].a3-dwi-jamb{fill:var(--a3-dwi-jamb);stroke:var(--a3-dwi-jamb);stroke-width:.3px}
[class*="a3-dwj-"].a3-dwi-sill{fill:var(--a3-dwi-sill);stroke:var(--a3-dwi-sill);stroke-width:.3px}
[class*="a3-dw-"].a3-dwi-line{fill:none;stroke:var(--a3-dwi-line);stroke-width:var(--anatomy-weight)}
.a3-dwi-dim{fill:var(--a3-cab-dim);stroke:var(--a3-cab-dim);stroke-width:.6px;stroke-linejoin:round}
[class*="a3-dwjd-"].a3-dwi-dim{stroke-width:.3px}
.a3-lens{fill:var(--a3-lens);stroke:none}
.a3-flood-lit{fill:var(--a3-flood);stroke:none}
.iso{--a3-hold-wall:#d3cfc6;--a3-hold-ceil:#e3e0d9;--a3-hold-floor:#a39c90;--a3-hold-side:#bdb8ae;--a3-hold-rail:#8d9399;--a3-hold-uld:#c9ced2;--a3-hold-load:#bcb19f;--a3-hold-bag:#ad9e86;--a3-hold-edge:#7d8186;--a3-hold-ln:#8f8a80;--a3-hold-lamp:#fbf6ea}
.iso[data-theme="dark"]{--a3-hold-wall:#6a6153;--a3-hold-ceil:#857a65;--a3-hold-floor:#3a342c;--a3-hold-side:#4a443b;--a3-hold-rail:#4f5357;--a3-hold-uld:#9a9891;--a3-hold-load:#857b69;--a3-hold-bag:#7c6f5b;--a3-hold-edge:#3c3e40;--a3-hold-ln:#4c463d;--a3-hold-lamp:#ffeccb}
[class*="a3-hold-"].a3-hold-wall,[class*="a3-hold-"].a3-hold-ceil,[class*="a3-hold-"].a3-hold-floor,[class*="a3-hold-"].a3-hold-side,[class*="a3-hold-"].a3-hold-rail,[class*="a3-hold-"].a3-hold-uld,[class*="a3-hold-"].a3-hold-load,[class*="a3-hold-"].a3-hold-bag{stroke-width:.3px;stroke-linejoin:round}
.a3-hold-wall{fill:var(--a3-hold-wall);stroke:var(--a3-hold-wall)}
.a3-hold-ceil{fill:var(--a3-hold-ceil);stroke:var(--a3-hold-ceil)}
.a3-hold-floor{fill:var(--a3-hold-floor);stroke:var(--a3-hold-floor)}
.a3-hold-side{fill:var(--a3-hold-side);stroke:var(--a3-hold-side)}
.a3-hold-rail{fill:var(--a3-hold-rail);stroke:var(--a3-hold-rail)}
.a3-hold-uld{fill:var(--a3-hold-uld);stroke:var(--a3-hold-uld)}
.a3-hold-load{fill:var(--a3-hold-load);stroke:var(--a3-hold-load)}
.a3-hold-bag{fill:var(--a3-hold-bag);stroke:var(--a3-hold-bag)}
.a3-hold-edge{fill:none;stroke:var(--a3-hold-edge);stroke-width:var(--anatomy-weight);stroke-linejoin:round}
.a3-hold-ln{fill:none;stroke:var(--a3-hold-ln);stroke-width:calc(var(--anatomy-weight) * .7)}
.a3-hold-lamp{fill:none;stroke:var(--a3-hold-lamp);stroke-width:calc(var(--anatomy-weight) * 2.2);stroke-linecap:round}`);
  ctx.report(`skin: ${counts.parts} parts, ${counts.planes} planes, ${windows.length} windows, ${S.passenger.length} passenger doors (${S.passenger.reduce((a, D) => a + D.strips.length, 0)} leaf strips), ${S.cargo.length} cargo doors, ${lamps.length} scan lamps`);
}

/** Runs of a closed plan polyline (x, y) inside lo ≤ y ≤ hi. */
function clipRunsPlan(plan, lo, hi) {
  const dense = [];
  for (let i = 0; i < plan.length; i++) {
    const a = plan[i];
    const b = plan[(i + 1) % plan.length];
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
    for (let j = 0; j < k; j++) dense.push([lerp(a[0], b[0], j / k), lerp(a[1], b[1], j / k)]);
  }
  const runs = [];
  let cur = null;
  for (let i = 0; i < dense.length; i++) {
    const a = dense[i];
    const b = dense[(i + 1) % dense.length];
    const ts = [0];
    for (const c of [lo, hi]) {
      const da = a[1] - c;
      const db = b[1] - c;
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) ts.push(da / (da - db));
    }
    ts.push(1);
    ts.sort((x, y) => x - y);
    for (let k = 0; k + 1 < ts.length; k++) {
      const p = [lerp(a[0], b[0], ts[k]), lerp(a[1], b[1], ts[k])];
      const q = [lerp(a[0], b[0], ts[k + 1]), lerp(a[1], b[1], ts[k + 1])];
      const my = (p[1] + q[1]) / 2;
      if (my >= lo - 1e-9 && my <= hi + 1e-9) {
        if (!cur) runs.push((cur = [p]));
        cur.push(q);
      } else cur = null;
    }
  }
  if (runs.length > 1) {
    const first = runs[0];
    const last = runs[runs.length - 1];
    const a = last[last.length - 1];
    if (Math.hypot(a[0] - first[0][0], a[1] - first[0][1]) < 1e-9) {
      runs.pop();
      runs[0] = [...last, ...first.slice(1)];
    }
  }
  if (runs.length === 1 && Math.hypot(runs[0][0][0] - runs[0][runs[0].length - 1][0], runs[0][0][1] - runs[0][runs[0].length - 1][1]) < 1e-9) runs[0].closedLoop = true;
  return runs;
}

// ---------------------------------------------------------------------------------------------
// checks (DESIGN §9 M6 acceptance)
// ---------------------------------------------------------------------------------------------
export function checks(ctx, out) {
  const { W, M, TURN } = ctx;
  const S = specs(ctx);
  const log = (s) => console.log(`M6 skin: ${s}`);
  const fail = [];
  // ---- windows ----
  const WIN = M.WINDOWS;
  let count = 0;
  for (const [deck, z, list] of [["main", WIN.mainZ, WIN.main], ["upper", WIN.upperZ, WIN.upper]])
    for (const side of [-1, 1])
      for (const x of list) {
        count++;
        const a = W.partAt(x - WIN.size.width / 2, z, side);
        const b = W.partAt(x + WIN.size.width / 2, z, side);
        if (!a || !b || a.name !== b.name) fail.push(`window ${deck} ${x} ${side} crosses ${a?.name} | ${b?.name}`);
        for (const D of S.passenger) if (D.side === side && D.upper === (deck === "upper") && Math.abs(x - D.d.x) < LEAF_W / 2 + WIN.size.width / 2) fail.push(`window ${deck} ${x} inside door ${D.id}`);
      }
  if (count !== WIN.counts.total) fail.push(`windows: ${count}, want ${WIN.counts.total}`);
  log(`windows: ${count} at the model stations (${WIN.main.length} main + ${WIN.upper.length} upper per side), none in a door, none across a piece boundary`);
  // ---- doors: stations, sills, leaves, park, tangency, swing ----
  const scene = out.scene;
  const byName = new Map(scene.groups.map((g) => [g.name, g]));
  const poseOf = (values, name) => TURN.poses(scene.groups, values).get(name);
  const apply = (pose, gName, p) => {
    const g = byName.get(gName);
    const q = sub(p, g.origin);
    const R = pose.R;
    return [R[0] * q[0] + R[1] * q[1] + R[2] * q[2] + pose.t[0], R[3] * q[0] + R[4] * q[1] + R[5] * q[2] + pose.t[1], R[6] * q[0] + R[7] * q[1] + R[8] * q[2] + pose.t[2]];
  };
  const cache = new Map();
  const hullFaces = (name) => {
    if (!cache.has(name)) {
      const part = ctx.part(name);
      const pts = part.world.points;
      cache.set(name, part.world.faces.map((f) => ({ n: f.n, d: dot(f.n, pts[f.ring[0]]) })));
    }
    return cache.get(name);
  };
  const outside = (faces, p) => Math.max(...faces.map((f) => dot(f.n, p) - f.d)); // kit units: > 0 outside
  const base = Object.fromEntries(scene.groups.map((g) => [g.name, 0]));
  let worstTangent = 0;
  let worstClear = Infinity;
  for (const D of S.passenger) {
    const d = D.d;
    const ga = `door.${D.id}.arm`;
    const gd = `door.${D.id}`;
    const leafPts = D.strips.flatMap((s) => s.points.map(W.kit));
    const us = D.strips.flatMap((s) => s.points.map((p) => dot(D.uF, p)));
    const width = Math.max(...us) - Math.min(...us); // along the leaf's own forward axis (the homothetic facets lean)
    if (Math.abs(width - LEAF_W) > 0.005) fail.push(`door ${D.id}: leaf ${width.toFixed(3)} m wide`);
    if (Math.abs(D.d.x - (D.x0 + D.x1) / 2) > 1e-9) fail.push(`door ${D.id}: off station`);
    // park: at full open the leaf moved FWD_PARK forward and parkedOffset outboard (along the arm facet normal)
    const open = { ...base, [ga]: D.theta, [gd]: -D.theta };
    const pd = poseOf(open, gd);
    const c0 = W.kit(D.Ptop);
    const disp = sub(W.fromKit(apply(pd, gd, c0)), D.Ptop);
    const outb = dot(disp, D.nA);
    const fwd = dot(disp, D.uF);
    if (Math.abs(outb - d.parkedOffset) > 0.005 || Math.abs(outb - 0.72) > 0.03) fail.push(`door ${D.id}: parks ${outb.toFixed(3)} m out`);
    if (fwd < LEAF_W - 0.01) fail.push(`door ${D.id}: parks only ${fwd.toFixed(3)} m forward`);
    // the leaf keeps its attitude (a translation): the two hinges cancel
    const R = pd.R;
    const tilt = Math.abs(R[0] - 1) + Math.abs(R[4] - 1) + Math.abs(R[8] - 1);
    if (tilt > 1e-6) fail.push(`door ${D.id}: leaf rotates when open (${tilt.toExponential(1)})`);
    // the arm knuckle's support contact on its facet (W.GAP off, fu/fuselage) at 0, 60, 90, 120° and fully open
    const knuckle = D.armPts.slice(0, D.knuckleN).map(W.kit);
    const NK = W.kitDir(D.nA);
    const dK = dot(NK, W.kit(D.fa.A));
    for (const a of [0, 60, 90, 120, D.theta]) {
      const pose = poseOf({ ...base, [ga]: a }, ga);
      const gap = Math.min(...knuckle.map((p) => dot(NK, apply(pose, ga, p)) - dK)) - W.m(W.GAP);
      worstTangent = Math.max(worstTangent, Math.abs(gap));
      if (Math.abs(gap) > 0.01) fail.push(`door ${D.id}: arm knuckle ${gap.toFixed(4)} units off its facet at ${a}°`);
      const armMin = Math.min(...D.armPts.map(W.kit).map((p) => dot(NK, apply(pose, ga, p)) - dK));
      if (armMin < W.m(W.GAP) - 0.005) fail.push(`door ${D.id}: arm into its facet ${armMin.toFixed(3)} at ${a}°`);
    }
    if (D.armTopV > D.facetLenV - 0.005) fail.push(`door ${D.id}: arm leaves its facet (${D.armTopV.toFixed(3)} of ${D.facetLenV.toFixed(3)} m)`);
    // the swing clears the host's hull: every leaf vertex stays outside it
    const faces = hullFaces(D.host.name);
    for (let k = 0; k <= 40; k++) {
      const a = (k / 40) * D.theta;
      const p2 = poseOf({ ...base, [ga]: a, [gd]: -a }, gd);
      for (const p of leafPts) {
        const o = outside(faces, apply(p2, gd, p));
        worstClear = Math.min(worstClear, o);
        if (o < W.m(W.GAP) - 0.02) fail.push(`door ${D.id}: leaf ${o.toFixed(3)} units from ${D.host.name} at ${a.toFixed(0)}°`);
      }
    }
    const sill = D.upper ? D.zb : D.zb + 0.02;
    log(`door ${D.id}: x ${d.x}, sill ${sill.toFixed(3)} (model ${d.sillZ}), leaf ${LEAF_W} × ${(D.zt - D.zb).toFixed(2)} m on ${D.facets.length} strip(s) [facets ${D.facets.join(",")}], host ${D.host.name} (${D.host.group}), arm ${D.L.toFixed(3)} m to ${D.theta.toFixed(2)}°, parks ${fwd.toFixed(3)} fwd ${outb.toFixed(3)} out`);
  }
  log(`arm knuckle contact: worst ${worstTangent.toFixed(4)} units from W.GAP off its facet at 0/60/90/120/open; leaf swing clearance ≥ ${worstClear.toFixed(3)} units`);
  for (const C of S.cargo) {
    const g = `door.${C.id}`;
    const faces = hullFaces(C.host.name);
    const pts = C.strips.flatMap((s) => s.points.map(W.kit));
    let worst = Infinity;
    for (let k = 0; k <= 55; k++) {
      const pose = poseOf({ ...base, [g]: (k / 55) * CARGO_OPEN }, g);
      for (const p of pts) worst = Math.min(worst, outside(faces, apply(pose, g, p)));
    }
    if (worst < W.m(W.GAP) - 0.02) fail.push(`cargo ${C.id}: ${worst.toFixed(3)} units into ${C.host.name}`);
    log(`cargo ${C.id}: x ${C.x0.toFixed(3)}-${C.x1.toFixed(3)}, z ${C.zb}-${C.zt.toFixed(3)} on ${C.strips.length} strips [facets ${C.facets.join(",")}] of ${C.host.name}, swing clear ≥ ${worst.toFixed(3)} units`);
  }
  // ---- fairing: bottom and width against bellyFairing; |y| ≤ 4.35; bays; fillet ----
  const fairParts = ["skin.fair.nose", "skin.fair.l.mid", "skin.fair.r.mid", "skin.fair.l.link", "skin.fair.r.link", ...["l", "r"].flatMap((s) => [`skin.fair.${s}.tail`, `skin.fair.${s}.tail.end`]) /* fu/r2-gear */, ...["l", "r"].flatMap((s) => CHEEKS.map((c) => `skin.fair.${s}.${c}`))];
  const allPts = fairParts.flatMap((n) => ctx.part(n).world.points.map(W.fromKit));
  const ymax = Math.max(...allPts.map((p) => Math.abs(p[1])));
  if (ymax > 4.35 + 1e-6) fail.push(`fairing |y| ${ymax.toFixed(3)} > 4.35`);
  const rows = [];
  for (const [x, bot, hw] of M.FUSELAGE.bellyFairing) {
    if (x <= 18.5 || x >= 46.5) continue; // the fairing starts and ends on the S0 lobe (DESIGN §5.7)
    let zmin = Infinity;
    let ymx = 0;
    for (const n of fairParts) {
      const p = ctx.part(n);
      const pts = p.world.points.map(W.fromKit);
      for (const f of p.world.faces)
        for (let i = 0; i < f.ring.length; i++) {
          const a = pts[f.ring[i]];
          const b = pts[f.ring[(i + 1) % f.ring.length]];
          if ((a[0] - x) * (b[0] - x) > 1e-12) continue;
          const t = Math.abs(b[0] - a[0]) < 1e-9 ? 0 : (x - a[0]) / (b[0] - a[0]);
          zmin = Math.min(zmin, lerp(a[2], b[2], t));
          ymx = Math.max(ymx, Math.abs(lerp(a[1], b[1], t)));
        }
    }
    if (zmin === Infinity) {
      rows.push(`${x}: WLG gap`);
      continue;
    }
    // over the BLG bay the lowest facet and the bottom are M5's outer doors (open while the gear is down): the skin's
    // lowest point there is c3's lower edge, the fairing's vertex 4
    const FA = W.FAIRING;
    const inBay = x > FA.blg[0] + 1e-6 && x < FA.blg[1] - 1e-6;
    const want = inBay ? FA.half(x)[4][1] : bot;
    rows.push(`${x}: bottom ${zmin.toFixed(3)} (${inBay ? `vertex 4 ${want.toFixed(3)}; the bottom is the BLG outer door` : bot}) half-width ${ymx.toFixed(3)} (${hw})`);
    if (Math.abs(zmin - want) > 0.05 || Math.abs(ymx - hw) > 0.05) fail.push(`fairing at ${x}: bottom ${zmin.toFixed(3)} vs ${want.toFixed(3)}, half-width ${ymx.toFixed(3)} vs ${hw}`);
  }
  log(`fairing vs bellyFairing: ${rows.join("; ")}; max |y| ${ymax.toFixed(3)}`);
  let blg = Infinity;
  for (const s of ["l", "r"]) for (const c of CHEEKS) for (const p of ctx.part(`skin.fair.${s}.${c}`).world.points.map(W.fromKit)) blg = Math.min(blg, W.BAYS.depth(W.BAYS.blg, p));
  if (blg < 0.025 - 1e-6) fail.push(`BLG cheek plates ${blg.toFixed(3)} m from W.BAYS.blg`);
  let wlg = Infinity;
  for (const p of ctx.part("skin.keel").world.points.map(W.fromKit)) for (const side of [-1, 1]) wlg = Math.min(wlg, W.BAYS.depth(W.BAYS.wlg(side), p));
  if (wlg < 0.025) fail.push(`keel liner ${wlg.toFixed(3)} m from a WLG bay`);
  // fillet: the fairing stays ≥ 0.10 m under the fillet's lower face (the stub fillet's construction, DESIGN §5.4)
  let fil = Infinity;
  for (const side of [-1, 1]) {
    const root = W.WING.section(side * W.WING.rootY);
    const contour = root.points.filter(([, z], i) => i >= 1 && i <= 13 && z >= root.bottom + 0.5 * root.thickness);
    const lowZ = Math.min(...contour.map((p) => p[1]));
    const n2 = unit([-(lowZ - 5.05), 4.45 - 3.416, 0]);
    for (const p of allPts) {
      if (Math.sign(p[1]) !== side || Math.abs(p[1]) < 3.42) continue;
      fil = Math.min(fil, -(n2[0] * (Math.abs(p[1]) - 3.416) + n2[1] * (p[2] - 5.05)));
    }
  }
  if (fil < 0.1) fail.push(`fairing ${fil.toFixed(3)} m under the fillet's lower face`);
  log(`BLG bay clearance ${blg.toFixed(3)} m, WLG bay clearance ${wlg.toFixed(3)} m, fillet clearance ${fil.toFixed(3)} m`);
  for (const B of BLADES) {
    const want = W.partAt(B.x, 10.7, 1).group;
    if (ctx.part(B.name).group.name !== want) fail.push(`${B.name} on ${ctx.part(B.name).group.name}, host group ${want}`);
  }
  for (const n of ["light.beacon.upperL", "light.beacon.upperR"]) if (ctx.part(n).group.name !== "cut.up") fail.push(`${n} not on cut.up`);
  log(`small parts: blades on ${BLADES.map((B) => ctx.part(B.name).group.name).join(", ")}; upper beacons on cut.up`);
  if (fail.length) throw new Error(fail.slice(0, 12).join(" | ") + (fail.length > 12 ? ` (+${fail.length - 12} more)` : ""));
}
