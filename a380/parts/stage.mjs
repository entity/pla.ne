// a380/parts/stage.mjs (M1): Stage: plinth, platter, phase-keyed marking sets, shadow, runway lights.
// Contract: a380/notes/CONTRACT.md. Design: a380/DESIGN.md §2, §4, §5.2, §6.1, §6.2 (runway row), §7.5, §9 M1.
//
// Files: a380/parts/stage.mjs, a380/gl/runway.mjs (GLSL generator, Node), a380/gl/runway.js (page: drawRunway and
// the deck writer). Groups: none (the platter rides `air`, layer `deck`; the plinth is static on `back`).
//
// World (kit units, 1 unit = 1 dm; kit x forward, y starboard, z up; origin the turntable axis on the runway):
//   - stand.plinth, static on `back`: a round base r 425, z -16 .. -6 (a recessed toe r 419 under a drum r 425),
//     wholly below the live layers, so it is proved by the horizontal plane. On its top (z -6): the heading ruler
//     (rings r 389 and 393, ticks every 2 degrees to r 401, majors every 10 to r 406, the zero mark hi), a bolt ring
//     at r 415, an edge bead at r 422. On its drum: a coping seam, cladding panel joints, the label plate at az 40
//     (three rule lines, two screws), an access panel and a vent grille for the turntable drive. Halo under it.
//   - stage.platter, live on `deck`, group `air`: a vertical round r 386, top z 0, bottom -6 (a fixed picture), kit
//     tones (lo drum, mid rim). One plane on its top face holds, in order: the plain pavement disc, the three
//     marking sets (clipped to r 386), the steel rim band (r 380-386) with 120 bolt heads at r 383 and the lubber
//     index at the nose bearing, then the shadow and the five contact darkenings. A second plane on the drum at the
//     nose bearing carries the lubber rule.
//   - marking sets: each a 600 m strip, periodic, in platter coordinates; the page translates it by scroll[set]
//     along platter -x (gl/runway.js). The runway set has a periodic part and a once part (the threshold zone),
//     which the page places by the distance past the brake-release anchor, so the piano keys lie at the line-up.
import * as RUNWAY from "../gl/runway.mjs";
import { GL_INKS, inkU } from "../gl/shaders.mjs";
import { haloDefs } from "./lights.mjs"; // f4-lights: the lens halos' gradients (dark), kept in the deck's <defs>

const D2R = Math.PI / 180;

export const id = "stage";
export const owner = "M1";
export const title = "Stage: plinth, platter, phase-keyed marking sets, shadow, runway lights";
/** Every part name this module creates starts with one of these (the harness enforces it). */
export const prefixes = ["stage.", "stand."];
/** true: the harness builds stubs.mjs's stand-in instead of build(). */
export const stub = false;

// ---------------------------------------------------------------------------------------------
// numbers (kit units) [E] where marked; markings after ICAO Annex 14 Vol I ch. 5 (code F, CAT III)
// ---------------------------------------------------------------------------------------------
export const DECK = {
  repeat: 6000, // every set is a 600 m strip
  span: [-440, 6440], // content drawn over the strip plus the platter radius and halos each way
  platterR: 386,
  rim: [380, 386], // steel rim band [E]
  rimBolts: { r: 383, count: 120 },
  clipR: 386,
  glWindow: [372, 380], // every GL term reaches 0 at r 38.0 m, the rim band's inner edge (review fu-1: past it, a light's glow lay on the steel rim)
  lightWindow: [368, 378], // a light fades as a whole before it reaches the rim
  thrX: -330, // the runway end (threshold) at brake release: 1.6 m behind the tail cone [E]
  onceReach: 12000,
  // finest transverse pattern per set (units): stand slab joints 7.5 m, taxiway shoulder stripes 30 m, runway
  // centreline stripes 50 m. speedFade = 1 - smooth(pitch/6, pitch/2, d) on the SVG stripes.
  pitch: [75, 300, 500],
  runway: { half: 225, shoulder: 300, edge: 9, cl: { len: 300, gap: 200, half: 4.5, start: 600 } }, // 45 m + 7.5 m shoulders [E]
  taxiway: { half: 125, shoulder: 300 }, // code F: 25 m, shoulders to 60 m
};

// ---------------------------------------------------------------------------------------------
// pure page helpers: shipped to the page as source (no outer references), tested in Node by checks()
// ---------------------------------------------------------------------------------------------
/** x mod repeat in [0, repeat). */
export function wrapScroll(x, repeat) {
  return ((x % repeat) + repeat) % repeat;
}
/** Index of a phase in the departure: GATE 0 … FL100 6. */
export function phaseRank(phase) {
  return ["GATE", "PUSHBACK", "TAXI", "LINEUP", "TAKEOFF", "CLIMB", "FL100"].indexOf(phase);
}
/** The marking-set mix a phase settles to: [stand, taxiway, runway]. */
export function setTargetOf(phase) {
  if (phase === "GATE" || phase === "PUSHBACK") return [1, 0, 0];
  if (phase === "TAXI") return [0, 1, 0];
  return [0, 0, 1];
}
/** SVG stripes fade as the per-frame displacement d (units) approaches half their pitch: 1 - smooth(p/6, p/2, d). */
export function speedFadeOf(d, pitch) {
  const t = Math.min(1, Math.max(0, (d - pitch / 6) / (pitch / 2 - pitch / 6)));
  return 1 - t * t * (3 - 2 * t);
}
/** Metres the aircraft rolls before it stops under the model's LINEUP law (accel = clamp(-0.8 v, -0.8 m/s2)). */
export function stopDistanceOf(speedKt) {
  const v = Math.max(0, speedKt) * 0.514444;
  return v > 1 ? (v * v - 1) / 1.6 + 1.25 : v / 0.8;
}
/**
 * The shadow at a drawn lift (m, 0..6) and pitch (deg): { blur (local units), opacity, sx, tx } where the footprint
 * group's transform is matrix(sx 0 0 1 tx 0): scaled along platter x by cos(pitch) about the pitch pivot, shifted
 * aft by the footprint's mean height above the pivot times sin(pitch).
 */
export function shadowOf(liftM, pitchDeg, light, cfg) {
  const u = Math.min(1, Math.max(0, liftM / 6));
  const op = light ? cfg.opacity.light : cfg.opacity.dark;
  const t = (pitchDeg * Math.PI) / 180;
  const c = Math.cos(t);
  return {
    blur: (cfg.blur[0] + (cfg.blur[1] - cfg.blur[0]) * u) / cfg.k,
    opacity: op[0] + (op[1] - op[0]) * u,
    sx: c,
    tx: cfg.pivotX * (1 - c) - cfg.lever * Math.sin(t),
  };
}
/** A gear's contact darkening: down-locked x (1 - smooth(0, 0.3 m, its height)); arm = metres ahead of the pivot. */
export function contactOf(gear, heightM, pitchDeg, arm, max = 1) {
  const sm = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const h = Math.max(0, heightM) + arm * Math.sin((pitchDeg * Math.PI) / 180);
  return max * sm(0.95, 1, gear) * (1 - sm(0, 0.3, h));
}
/** The runway canvas's programs, one per marking set (stand, taxiway, runway); gl/runway.js registers the same ids. */
export const RUNWAY_IDS = ["runway", "runway.taxi", "runway.rwy"];
const HELPERS = { wrapScroll, phaseRank, setTargetOf, speedFadeOf, stopDistanceOf, shadowOf, contactOf };

// ---------------------------------------------------------------------------------------------
// small SVG helpers (plane-local coordinates = platter kit x, y)
// ---------------------------------------------------------------------------------------------
const n2 = (v) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};
const rect = (x0, x1, y0, y1) => `M${n2(x0)} ${n2(y0)}H${n2(x1)}V${n2(y1)}H${n2(x0)}Z`;
const circ = (x, y, r) => `M${n2(x - r)} ${n2(y)}a${n2(r)} ${n2(r)} 0 1 0 ${n2(2 * r)} 0a${n2(r)} ${n2(r)} 0 1 0 ${n2(-2 * r)} 0Z`;
const poly = (pts) => `M${pts.map(([x, y]) => `${n2(x)} ${n2(y)}`).join("L")}Z`;
const ellipse = (x, y, rx, ry, rot = 0, n = 18) => {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return poly(
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * 2 * Math.PI;
      const ex = rx * Math.cos(a);
      const ey = ry * Math.sin(a);
      return [x + c * ex - s * ey, y + s * ex + c * ey];
    }),
  );
};
const path = (cls, d, extra = "") => (d ? `<path class="${cls}"${extra} d="${d}"/>` : "");
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Draw a feature placed at strip x (and its periodic copies) wherever it reaches the drawn span. */
function rep(x0, x1, draw) {
  const [lo, hi] = DECK.span;
  let out = "";
  for (const k of [-2, -1, 0, 1, 2]) {
    const s = k * DECK.repeat;
    if (x1 + s < lo || x0 + s > hi) continue;
    out += draw(s);
  }
  return out;
}
/** Every x0 + k·pitch inside the drawn span. */
function lattice(x0, pitch) {
  const [lo, hi] = DECK.span;
  const out = [];
  for (let x = x0 - Math.floor((x0 - lo) / pitch) * pitch; x <= hi; x += pitch) out.push(x);
  return out;
}
/** A rubber streak: a thin lens along x, slightly bowed. */
const streak = (x, y, len, w, bow) => `M${n2(x - len / 2)} ${n2(y)}Q${n2(x)} ${n2(y + w + bow)} ${n2(x + len / 2)} ${n2(y + bow * 0.3)}Q${n2(x)} ${n2(y - w + bow)} ${n2(x - len / 2)} ${n2(y)}Z`;

// light rows (strip/platter units): shared by the SVG fixtures, the fallback dots and the GL program
// each colour's GL ink is its CSS token's uniform (follow-up item 35: gl/shaders.mjs GL_INKS --a3-gl-<colour>, read on
// the page), so the runway program carries no colour of its own: glow (dark) and paper body (light) are the token
const INK = Object.fromEntries(["white", "green", "blue", "red"].map((c) => [c, { dark: inkU(c), paper: inkU(c) }]));
export const LIGHT_ROWS = [
  // stand: blue apron edge lights along the push taxilane behind the stand, 30 m apart, from 60 m to 300 m [E]
  ...[-1, 1].map((s) => ({ set: 0, name: `apron edge ${s < 0 ? "port" : "stbd"}`, color: "blue", y: s * 340, z: 3, x0: -600, pitch: 300, lens: 0.16, halo: 3.0, gain: 0.85, pool: 10, inset: false, range: [-3000, -600] })),
  // taxiway: green centreline lights every 15 m (inset, bidirectional), blue edge lights every 30 m (elevated)
  { set: 1, name: "taxiway centreline", color: "green", y: 0, z: 0.2, x0: 0, pitch: 150, lens: 0.13, halo: 2.8, gain: 0.95, pool: 7, inset: true, range: null },
  ...[-1, 1].map((s) => ({ set: 1, name: `taxiway edge ${s < 0 ? "port" : "stbd"}`, color: "blue", y: s * 135, z: 3, x0: 75, pitch: 300, lens: 0.16, halo: 3.0, gain: 0.85, pool: 10, inset: false, range: null })),
  // runway: white bidirectional centreline lights every 15 m from the threshold (0.6 m off the line), white edge
  // lights every 60 m (elevated, 1 m outside the edge)
  { set: 2, name: "runway centreline", color: "white", y: 6, z: 0.2, x0: -330, pitch: 150, lens: 0.15, halo: 3.0, gain: 1.0, pool: 8, inset: true, range: null, gate: "thr" },
  ...[-1, 1].map((s) => ({ set: 2, name: `runway edge ${s < 0 ? "port" : "stbd"}`, color: "white", y: s * 235, z: 3.5, x0: -330, pitch: 600, lens: 0.18, halo: 3.2, gain: 1.1, pool: 11, inset: false, range: null, gate: "thr" })),
];
export const THRESHOLD_BAR = { set: 2, count: 16, y0: -225, step: 30, z: 0.2, lens: 0.15, halo: 3.0, gain: 1.0, pool: 8, streakPitch: 150, reach: 56 };

// ---------------------------------------------------------------------------------------------
// the plinth (static, back)
// ---------------------------------------------------------------------------------------------
function plinth(ctx) {
  const { k, A, P } = ctx;
  const R = 425;
  const RT = 419;
  const Z0 = -16;
  const ZT = -14.6;
  const Z1 = -6;
  const at = (r, deg, z) => [r * Math.cos(deg * D2R), r * Math.sin(deg * D2R), z];
  const pt = (p) => k.iso(p, P);
  const pathOf = (pts, closed = false) => `M${pts.map((p) => `${(Math.round(p[0] * 100) / 100).toFixed(2)} ${(Math.round(p[1] * 100) / 100).toFixed(2)}`).join("L")}${closed ? "Z" : ""}`;
  const arc = (r, a0, a1, z, steps = 24) => Array.from({ length: steps + 1 }, (_, i) => pt(at(r, a0 + ((a1 - a0) * i) / steps, z)));
  const view = 40; // the viewer's floor azimuth (DESIGN §2): the drum faces it at az 40
  const facing = (deg) => Math.cos((deg - view) * D2R);

  // drum and toe
  const toe = k.cylinder(0, 0, RT, Z0, ZT - Z0, P, 180);
  const drum = k.cylinder(0, 0, R, ZT, Z1 - ZT, P, 220, 0.8);
  // drum detail: coping seam at z -7.2, cladding joints every 10 degrees from the toe to the coping
  const coping = k.sideArc(0, 0, R, -7.2, P, 120);
  const joints = [];
  for (let deg = 0; deg < 360; deg += 10) {
    const f = facing(deg);
    if (f < 0.08) continue;
    if (Math.abs(((deg - view + 540) % 360) - 180) < 8) continue; // keep the label plate's bay clear
    joints.push({ d: pathOf([pt(at(R, deg, ZT)), pt(at(R, deg, -7.2))]), alpha: Math.min(1, Math.max(0, (f - 0.08) / 0.4)) });
  }
  // label plate (flush curved inlay at az 40): outline, inset outline, three rule lines, two screws
  const pa = [view - 2.7, view + 2.7];
  const pz = [-12.9, -8.3];
  const plateRing = [...arc(R, pa[0], pa[1], pz[1], 24), ...arc(R, pa[1], pa[0], pz[0], 24)];
  const inset = [...arc(R, pa[0] + 0.22, pa[1] - 0.22, pz[1] - 0.45, 24), ...arc(R, pa[1] - 0.22, pa[0] + 0.22, pz[0] + 0.45, 24)];
  const rules = [
    [-9.55, 1.75],
    [-10.6, 1.95],
    [-11.65, 1.2],
  ]
    .map(([z, half]) => pathOf(arc(R, view - half, view + half, z, 16)))
    .join("");
  const plateScrews = [view - 2.32, view + 2.32].map((deg) => pt(at(R, deg, -10.6)));
  // access panel for the turntable drive (az 70) and a vent grille (az 10): closed outlines and screws
  const panelA = [view + 27.6, view + 31.8];
  const panel = [...arc(R, panelA[0], panelA[1], -8.2, 16), ...arc(R, panelA[1], panelA[0], -13.4, 16)];
  const panelScrews = [
    [panelA[0] + 0.35, -8.85],
    [panelA[1] - 0.35, -8.85],
    [panelA[0] + 0.35, -12.75],
    [panelA[1] - 0.35, -12.75],
  ].map(([deg, z]) => pt(at(R, deg, z)));
  const slots = [];
  for (let i = 0; i < 8; i++) {
    const a0 = view - 31 + i * 0.62;
    slots.push(pathOf([...arc(R, a0, a0 + 0.3, -9.1, 2), ...arc(R, a0 + 0.3, a0, -12.6, 2)], true));
  }
  // top annulus (z -6): ruler rings and ticks, bolt ring, edge bead
  const ring = (r, steps = 360) => k.ring(0, 0, r, Z1, P, steps);
  const ticks = { minor: [], major: [], zero: [] };
  for (let deg = 0; deg < 360; deg += 2) {
    const major = deg % 10 === 0;
    const to = major ? 406 : 401;
    const d = k.lineOnTop([393 * Math.cos(deg * D2R), 393 * Math.sin(deg * D2R)], [to * Math.cos(deg * D2R), to * Math.sin(deg * D2R)], Z1, P);
    (deg === 0 ? ticks.zero : major ? ticks.major : ticks.minor).push(d);
  }
  // the zero mark: a hi tick and a closed index triangle beyond the ruler
  const zeroTri = pathOf([pt(at(407.5, -0.75, Z1)), pt(at(411.5, 0, Z1)), pt(at(407.5, 0.75, Z1))], true);
  const bolts = [];
  for (let i = 0; i < 72; i++) bolts.push(pt(at(415, (i + 0.5) * 5, Z1)));
  const svg =
    `<path class="iso-halo" d="${k.haloOf({ x: -R - 8, y: -R - 8, w: 2 * R + 16, d: 2 * R + 16, r: R + 8 }, Z0, Z1 - Z0, P)}"/>` +
    k.solidSvg(toe, { tone: "lo", crease: "none" }) +
    k.solidSvg(drum, {
      tone: "lo",
      crease: "faint",
      inner:
        k.lineSvg(coping, { tone: "faint" }) +
        k.fadedSvg(joints, { tone: "faint" }) +
        `<path class="a3-dk-plate" d="${pathOf(plateRing, true)}"/>` +
        k.lineSvg(pathOf(plateRing, true), { tone: "mid" }) +
        k.lineSvg(pathOf(inset, true), { tone: "faint" }) +
        k.lineSvg(rules, { tone: "lo", free: true }) +
        k.dotsSvg(plateScrews, { size: 0.42, tone: "mid" }) +
        k.lineSvg(pathOf(panel, true), { tone: "faint" }) +
        k.dotsSvg(panelScrews, { size: 0.36, tone: "lo" }) +
        k.lineSvg(slots.join(""), { tone: "lo" }),
    }) +
    k.lineSvg(ring(389) + ring(393) + ring(406), { tone: "lo" }) +
    k.lineSvg(ring(401), { tone: "faint" }) +
    k.lineSvg(ticks.minor.join(""), { tone: "lo" }) +
    k.lineSvg(ticks.major.join(""), { tone: "mid" }) +
    k.lineSvg(ticks.zero.join(""), { tone: "hi" }) +
    `<path class="a3-dk-index" d="${zeroTri}"/>` +
    k.lineSvg(ring(422, 420), { tone: "faint" }) +
    k.dotsSvg(bolts, { size: 0.5, tone: "mid" });
  ctx.static({
    name: "stand.plinth",
    at: [0, 0, Z0],
    bias: -100,
    svg,
    shapes: [A.cylinder(0, 0, RT, Z0, ZT - Z0, { name: "stand.plinth.toe", ground: true }), A.cylinder(0, 0, R, ZT, Z1 - ZT, { name: "stand.plinth" })],
  });
}

// ---------------------------------------------------------------------------------------------
// the marking sets (strip coordinates, kit units)
// ---------------------------------------------------------------------------------------------
const [LO, HI] = DECK.span;
const FULL = 400; // half-width every base fill covers (past the platter edge)

function inRange(x, [a, b]) {
  const R = DECK.repeat;
  const t = (((x - a) % R) + R) % R;
  return t <= b - a + 1e-6;
}
// review fu-1 (webgl.md 8.3, 8.5): the fallback light draws as the shader does: the lens at its true radius and height
// (an elevated light's lens stands z above the deck; the page shifts each height's group by z along the floor, gl/runway.js
// liftOf), a pale core, by day a thin darker rim and no halo, at night the glow's two Gaussians (fu/r2-lights: sampled
// into a gradient, below)
const LIGHT_PAGE = process.argv.includes("--light");
// fu/r2-lights: the fallback light is GL's own point profile (gl/runway.mjs rowAlong / rowAcross), sampled in Node into a
// radial gradient (as lights.mjs lensSvg samples the lamp lenses): the glow is screen-round (a billboard: each light is a
// <use> of one symbol per kind, whose inner group carries k·L⁻¹ for the deck plane's linear part L, written by
// gl/runway.js while the fallback shows), and at night the coloured pool lies on the floor as a second gradient. Review
// fu-r2 measured the stacked rings at a third of GL's glow area, 40-60 levels dimmer, in flat plateaus 24-57 levels apart,
// flattened to the deck's ellipse; and by day a pale core as wide as the lens (hollow pink rings for red).
const BB = new Map(); // key → { id, color, lens, halo, gain, pool }
const hex2 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
const smoothN = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Radii (in lens radii) the gradients are sampled at: dense through the lens edge, then over the glow. */
function profileRadii(reach) {
  const r = [0, 0.15, 0.3, 0.45, 0.6, 0.72, 0.84, 0.94, 1.0, 1.06, 1.16, 1.3, 1.5];
  for (let x = 1.75; x < reach; x *= 1.22) r.push(x);
  r.push(reach);
  return r;
}
const CORE_DARK = 2.8;
/** f3-lights: the GL pixel sizes (viewBox units per runway-canvas pixel) the billboards are sampled for, as lights.mjs
 *  LENS_PX: a desktop card at DPR 1.5+, at DPR 1, and a phone; gl/passes.js glPxWeights (pv.glPxW) crossfades them. */
const BB_PX = [0.672, 1.0, 1.75];
const BB_K = { k: 1 }; // viewBox units per platter unit at zoom 1 (W.fit().k, set by build before bbDefs)
/**
 * The GL point ink at radius r (lens radii) as an SVG fill: [colour, opacity] (premultiplied ink un-premultiplied).
 * f3-lights: with the shader's pixel terms (gl/runway.mjs rowAlong / rowAcross) for a GL pixel of `pxR` lens radii: the
 * lens radius floored at .55 px and its edge ±.5 px, the core and halo on the floored radius. The profile was sampled for
 * a fixed ±.25 rl edge (a pixel of half a lens radius, a desktop at DPR 1.5+); at DPR 1 a GL pixel is a whole lens
 * radius, so the GL's lens and core spread wider and its cores read whiter than the fallback's (by day the head-on
 * red bar R−G 153-167 against GL's 208, at DPR 2 the two within 15).
 */
function pointInk(r, B, pxR = 0.5) {
  const s = Math.max(1, 0.55 * pxR);
  const lens = 1 - smoothN(s - 0.5 * pxR, s + 0.5 * pxR, r);
  const core = Math.exp((-r * r) / (0.2 * s * s));
  if (LIGHT_PAGE) {
    const P = GL_INKS[B.color].light;
    const e = (lens * 1.2 + core * 2.4 + Math.exp((-r * r) / (2.56 * s * s)) * 0.5) * B.gain;
    const m = 1 - Math.exp(-e);
    const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
    let seen = mix([1, 1, 1], P.map((v) => v * 0.86), smoothN(0, 0.3, m));
    seen = mix(seen, P, smoothN(0.2, 0.55, m));
    seen = mix(seen, P.map((v) => 1 - 0.12 * (1 - v)), smoothN(0.64, 0.97, m));
    const ab = seen.map((v) => 1 - v);
    const a = Math.max(...ab, 0.95 * smoothN(0.5, 0.9, m));
    if (a <= 1e-4) return ["#ffffff", 0];
    const c = ab.map((v) => 1 - v / a);
    return [`#${c.map(hex2).join("")}`, a];
  }
  const C = GL_INKS[B.color].dark;
  const h = B.halo * s;
  // (the core term at twice the shader's 1.4: measured at line-up, GL's light centres read about 1.75× this law's energy
  // in their whiteness, R 146 against 98 for the green bar, 255 against 242 for a white edge light; the GL core gains
  // the pool under it and the canvas's screen blend, which the over-composited gradient does not)
  const e = (lens * 1.2 + core * CORE_DARK + Math.exp((-r * r) / (h * h)) * 0.55 + Math.exp((-r * r) / (h * h * 4)) * 0.18) * B.gain;
  const t = C.map((v) => 1 - Math.exp(-v * e));
  const a = Math.max(...t);
  if (a <= 1e-4) return ["#000000", 0];
  return [`#${t.map((v) => hex2(v / a)).join("")}`, a];
}
/** One billboard kind: its gradient and symbol ids (registered once, emitted by bbDefs). */
function bbOf(color, lens, halo, gain) {
  const key = `${color}-${lens}-${halo}-${gain}`;
  if (!BB.has(key)) BB.set(key, { id: `a3-rl-b${BB.size}`, color, lens, halo, gain });
  return BB.get(key);
}
/** The billboards' gradients and symbols (one <defs>), and the floor pools' gradients (dark). */
function bbDefs() {
  const out = [];
  for (const B of BB.values()) {
    const rl = B.lens * 10;
    // f3-lights: one gradient per GL pixel size (BB_PX), each its own circle in the kind's symbol, faded by pv.glPxW
    const circles = BB_PX.map((px, i) => {
      const pxR = px / (rl * BB_K.k);
      const s = Math.max(1, 0.55 * pxR);
      const reach = (LIGHT_PAGE ? 2.6 : B.halo * 3.4) * s + 0.5 * pxR;
      const stops = profileRadii(reach).map((r) => {
        const [c, a] = pointInk(r, B, pxR);
        return `<stop offset="${(r / reach).toFixed(4)}" stop-color="${c}" stop-opacity="${a.toFixed(4)}"/>`;
      });
      out.push(`<radialGradient id="${B.id}-g${i}">${stops.join("")}</radialGradient>`);
      return `<circle class="a3-rl-px${i}" r="${(rl * reach).toFixed(2)}" fill="url(#${B.id}-g${i})"/>`;
    });
    out.push(`<g id="${B.id}"><g class="a3-rl-bb">${circles.join("")}</g></g>`);
  }
  if (!LIGHT_PAGE)
    for (const [color, gain] of [...new Set([...BB.values()].map((B) => `${B.color}|${B.gain}`))].map((k) => k.split("|")).map(([c, g]) => [c, +g])) {
      // the coloured pool on the pavement (rows: .32 × gain × exp(−d²/pool²) of the glow; the bar .3), in pool radii
      const C = GL_INKS[color].dark;
      const stops = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.2, 2.6].map((d) => {
        const e = 0.32 * gain * Math.exp(-d * d);
        const t = C.map((v) => 1 - Math.exp(-v * e));
        const a = Math.max(...t);
        return `<stop offset="${(d / 2.6).toFixed(4)}" stop-color="#${t.map((v) => hex2(v / Math.max(a, 1e-6))).join("")}" stop-opacity="${(d >= 2.6 ? 0 : a).toFixed(4)}"/>`;
      });
      out.push(`<radialGradient id="a3-rl-pool-${color}-${gain}">${stops.join("")}</radialGradient>`);
    }
  return `<defs>${out.join("")}</defs>`;
}
function litSvg(color, list) {
  // list: [[x, y, rl, rh, row]] (row: { lens, halo, gain, pool }): a <use> of the kind's billboard per light
  return list.map(([x, y, , , R]) => `<use href="#${bbOf(color, R.lens, R.halo, R.gain ?? 1).id}" x="${n2(x)}" y="${n2(y)}"/>`).join("");
}
/** At night, one floor pool per light, on the deck (not lifted with an elevated lens). */
function poolSvg(color, list) {
  if (LIGHT_PAGE) return "";
  return list.map(([x, y, , , R]) => `<circle class="a3-rl-pool" cx="${n2(x)}" cy="${n2(y)}" r="${n2((R.pool ?? 8) * 2.6)}" fill="url(#a3-rl-pool-${color}-${R.gain ?? 1})"/>`).join("");
}
function lightsSvg(rows) {
  // fixtures (always drawn) and the lit fallback (faded by vary a3-rl-lit as GL takes over)
  const fix = [];
  const lens = [];
  const lit = new Map();
  for (const R of rows) {
    const xs = R.xs ?? lattice(R.x0, R.pitch).filter((x) => !R.range || inRange(x, R.range));
    const key = `${R.color}|${R.z ?? 0}`;
    if (!lit.has(key)) lit.set(key, []);
    for (const x of xs) {
      const elevated = !R.inset;
      fix.push(circ(x, R.y, elevated ? 2.1 : 1.6));
      lens.push(circ(x, R.y, elevated ? 1.0 : 0.75));
      const rl = R.lens * 10;
      lit.get(key).push([x, R.y, rl, rl * R.halo, R]);
    }
  }
  const litOut = [...lit.entries()]
    .filter(([, list]) => list.length)
    .map(([key, list]) => {
      const [color, z] = key.split("|");
      return `<g class="a3-rl-lit" data-c="${color}">${poolSvg(color, list)}<g class="a3-rl-up" data-z="${z}">${litSvg(color, list)}</g></g>`;
    })
    .join("");
  // the lit lights go to their own copy of the set (LIT_SINK), drawn over the aircraft's shadow as the GL lights are
  // (review fu-1: the shadow halved the fallback's edge lights at b −90); the fixtures stay in the set
  LIT_SINK.out += litOut;
  return path("a3-dk-fix", fix.join("")) + path("a3-dk-lens", lens.join(""));
}
const LIT_SINK = { out: "" };
/** The lit markup lightsSvg collected while `make` ran. */
function litOf(make) {
  LIT_SINK.out = "";
  const fixtures = make();
  const lit = LIT_SINK.out;
  LIT_SINK.out = "";
  return [fixtures, lit];
}

/** Tyre-wear lanes along the gear tracks: one band per lane with a soft gradient across its width. */
function wearLanes(lanes) {
  return lanes.map(([y, h]) => path("a3-dk-wear", rect(LO, HI, y - h, y + h), ' fill="url(#a3-dk-wear-l)"')).join("");
}
/** Wear where the aircraft stops on the stand: a soft blot per gear track, fading at both ends and both sides. */
function stopWear(tracks) {
  const out = [];
  for (const g of tracks)
    for (const y0 of [Math.min(...g.ys), Math.max(...g.ys)].filter((y, i, a) => a.indexOf(y) === i)) {
      const yc = g.ys.length > 1 ? (Math.min(...g.ys) + Math.max(...g.ys)) / 2 : y0;
      const x = Math.max(...g.xs);
      const hw = g.ys.length > 1 ? (Math.max(...g.ys) - Math.min(...g.ys)) / 2 + 7 : 9;
      out.push(rep(x - 160, x + 60, (sh) => path("a3-dk-wear", ellipse(x - 50 + sh, yc, 110, hw, 0, 36), ' fill="url(#a3-dk-wear-r)"')));
    }
  return [...new Set(out)].join("");
}

function standSet(W, tracks) {
  const r = rng(7);
  const out = [];
  out.push(path("a3-dk-conc", rect(LO, HI, -FULL, FULL)));
  // slabs 7.5 m, the lead-in centred in a slab row; a few replaced slabs read a shade apart
  const slabsY = [];
  for (let y = -412.5; y <= 412.5; y += 75) slabsY.push(y);
  const patches = [];
  for (const i of [-5, -4, -2, -1, 0, 1, 3, 4, 13, 18, 24, 31, 40, 52, 66, 71]) {
    const j = Math.floor(r() * 10) - 5;
    const x0 = i * 75;
    patches.push(rep(x0, x0 + 75, (s) => rect(x0 + s, x0 + 75 + s, 37.5 + j * 75, 112.5 + j * 75)));
  }
  out.push(path("a3-dk-patch", patches.join("")));
  // tyre wear where the gear stops on the lead-in (soft blots, nothing striped along the stand)
  out.push(stopWear(tracks));
  // joints
  const tj = lattice(0, 75)
    .map((x) => `M${n2(x)} ${-FULL}V${FULL}`)
    .join("");
  const lj = slabsY
    .filter((y) => Math.abs(y) < FULL)
    .map((y) => `M${LO} ${n2(y)}H${HI}`)
    .join("");
  out.push(path("a3-dk-joint", tj + lj));
  // slot drain across the stand behind the body gear (a grate in a frame)
  out.push(rep(-214, -206, (s) => path("a3-dk-grate", rect(-212.5 + s, -207.5 + s, -FULL, FULL)) + path("a3-dk-gratebar", rect(-212.5 + s, -207.5 + s, -FULL, FULL), ' fill="url(#a3-dk-grate)"') + path("a3-dk-frame", `M${n2(-213 + s)} ${-FULL}V${FULL}M${n2(-207 + s)} ${-FULL}V${FULL}`)));
  // oil stains under the engines and the APU, and brake rubber where the main gear stops
  const oil = [];
  const eng = W.NACELLE.map((N) => W.kit([N.lip + 9.5, N.y, 0]));
  for (const [x, y] of [...eng, W.kit([70.9, 0, 0])]) {
    const rx = 11 + r() * 5;
    const ry = 6 + r() * 3;
    const rot = (r() - 0.5) * 0.6;
    oil.push(rep(x - 30, x + 30, (s) => path("a3-dk-oil", ellipse(x + s, y, rx, ry, rot, 28), ' fill="url(#a3-dk-oil-r)"')));
  }
  out.push(oil.join(""));
  const rubber = [];
  for (const g of tracks)
    for (const x of g.xs)
      for (const y of g.ys) {
        const len = 14 + r() * 8;
        const w = 2.2 + r() * 1.2;
        const bow = (r() - 0.5) * 1.5;
        // review round 3: each mark its own soft stain (a radial gradient over the streak's extent, faded at both ends
        // and across), not a hard-edged dark blade at Inspect zoom
        rubber.push(rep(x - 20, x + 20, (s) => path("a3-dk-rubs", streak(x + s - 2, y, len, w, bow), ' fill="url(#a3-dk-rubber-r)"')));
      }
  // nose-wheel scrub marks where aircraft turn onto the lead-in before the stop bar: each a filled band 0.25 m wide
  // with faded (tapered) ends along an arc of 20-30 m radius, tangent to the lead-in line at its own station, so the
  // marks run roughly parallel and blend onto the line one after another (they converged on one point before)
  const scrub = [];
  for (let i = 0; i < 7; i++) {
    const side = i % 2 ? 1 : -1;
    const R = 200 + r() * 100; // units (20-30 m)
    const xt = 240 + i * 22 + r() * 8; // the tangent station on the lead-in line (spread over 15 m)
    const reach = 10 + r() * 9; // lateral offset where the mark starts (1.0-1.9 m)
    const tMax = Math.acos(1 - reach / R);
    const n = 14;
    const centre = [];
    for (let k = 0; k <= n; k++) {
      const t = tMax * (1 - k / n);
      centre.push([xt - R * Math.sin(t), side * R * (1 - Math.cos(t))]);
    }
    const half = (k) => 1.25 * Math.sin((Math.PI * k) / n) ** 0.6; // tapered ends
    const left = [];
    const right = [];
    for (let k = 0; k <= n; k++) {
      const a = centre[Math.max(0, k - 1)];
      const b = centre[Math.min(n, k + 1)];
      const tx = b[0] - a[0];
      const ty = b[1] - a[1];
      const l = Math.hypot(tx, ty) || 1;
      const h = half(k);
      left.push([centre[k][0] - (ty / l) * h, centre[k][1] + (tx / l) * h]);
      right.push([centre[k][0] + (ty / l) * h, centre[k][1] - (tx / l) * h]);
    }
    const band = [...left, ...right.reverse()];
    const x0 = Math.min(...band.map((p) => p[0]));
    const x1 = Math.max(...band.map((p) => p[0]));
    scrub.push(rep(x0, x1, (s) => `M${band.map(([x, y]) => `${n2(x + s)} ${n2(y)}`).join("L")}Z`));
  }
  out.push(rubber.join(""));
  out.push(path("a3-dk-scrub", scrub.join("")));
  // hydrant pits under the wings (refuel), earthing points near the main gear [E]
  const pits = [
    [25.6, 11.4],
    [27.6, 18.6],
  ].flatMap(([x, y]) => [-1, 1].map((sd) => W.kit([x, sd * y, 0])));
  out.push(
    pits
      .map(([x, y]) =>
        rep(
          x - 6,
          x + 6,
          (s) =>
            path("a3-dk-pit", circ(x + s, y, 4.6)) +
            path("a3-dk-pitring", circ(x + s, y, 3.2)) +
            path("a3-dk-pitbolt", Array.from({ length: 6 }, (_, i) => circ(x + s + 3.95 * Math.cos((i * Math.PI) / 3), y + 3.95 * Math.sin((i * Math.PI) / 3), 0.32)).join("")) +
            path("a3-dk-pithinge", rect(x + s - 1.6, x + s + 1.6, y - 0.45, y + 0.45)),
        ),
      )
      .join(""),
  );
  const earth = [
    [31.2, 8.6],
    [39.9, 4.2],
  ].flatMap(([x, y]) => [-1, 1].map((sd) => W.kit([x, sd * y, 0])));
  out.push(earth.map(([x, y]) => rep(x - 3, x + 3, (s) => path("a3-dk-pit", circ(x + s, y, 1.7)) + path("a3-dk-pitbolt", circ(x + s, y, 0.5)))).join(""));
  // stand box: the red stand safety line around the aircraft (beyond the platter except its sides and aft line)
  out.push(path("a3-dk-red", rep(-330, 420, (s) => rect(-321 + s, 420 + s, -301, -299) + rect(-321 + s, 420 + s, 299, 301) + rect(-321 + s, -319 + s, -301, 301))));
  // passenger-bridge wheel boxes at M2L and U1L (port), hatched [E]
  const pbb = [
    [16.5, -15.5],
    [20.94, -22.5],
  ].map(([x, y]) => W.kit([x, y, 0]));
  pbb.forEach(([x, y], i) => {
    out.push(
      rep(x - 20, x + 20, (s) => {
        const b = [x + s - 16, x + s + 16, y - 14, y + 14];
        const hatch = [];
        for (let t = -40; t <= 40; t += 6) hatch.push(poly([[b[0] + t, b[2]], [b[0] + t + 2.2, b[2]], [b[0] + t + 2.2 + 28, b[3]], [b[0] + t + 28, b[3]]]));
        const cid = `a3-dk-pbb${i}${s ? (s > 0 ? "p" : "m") + Math.abs(s / DECK.repeat) : ""}`;
        return `<clipPath id="${cid}"><path d="${rect(...b)}"/></clipPath><g clip-path="url(#${cid})">${path("a3-dk-yellow", hatch.join(""), ' fill-opacity=".55"')}</g>` + path("a3-dk-yellow", rect(b[0], b[1], b[2], b[2] + 1.5) + rect(b[0], b[1], b[3] - 1.5, b[3]) + rect(b[0], b[0] + 1.5, b[2], b[3]) + rect(b[1] - 1.5, b[1], b[2], b[3]));
      }),
    );
  });
  // lead-in line (0.15 m yellow with dark borders) through the stand and the push line, and the stop bars
  const lead = [];
  const band = [];
  lead.push(rep(-3600, 384, (s) => rect(-3600 + s, 384 + s, -0.75, 0.75)));
  band.push(rep(-3600, 385, (s) => rect(-3600 + s, 385.2 + s, -2.1, 2.1)));
  for (const [x, half, w] of [[W.kit([4.97, 0, 0])[0], 30, 3], [345, 20, 2], [327, 20, 2]]) {
    lead.push(rep(x - 2, x + 2, (s) => rect(x - w / 2 + s, x + w / 2 + s, -half, half)));
    band.push(rep(x - 3, x + 3, (s) => rect(x - w / 2 - 1.2 + s, x + w / 2 + 1.2 + s, -half - 1.2, half + 1.2)));
  }
  out.push(path("a3-dk-band", band.join("")));
  out.push(path("a3-dk-yellow", lead.join("")));
  // apron edge lights along the push taxilane
  out.push(lightsSvg(LIGHT_ROWS.filter((R) => R.set === 0)));
  return out.join("");
}

/**
 * The country seen from the air (review round 1: the platter was a blank disc after lift-off): fields, hedges, two
 * roads and a river at map scale (about 1:100), periodic over the strip; the page scrolls it with the ground
 * distance / 100 and fades it in with height and out again above about 8,000 ft.
 */
function landSet() {
  const r = rng(31);
  const out = [path("a3-dk-land", rect(LO, HI, -FULL, FULL))];
  const fields = { a: [], b: [], c: [] };
  const hedges = [];
  for (let x = LO - 60; x < HI + 60; ) {
    const w = 60 + r() * 90;
    for (let y = -FULL; y < FULL; ) {
      const h = 45 + r() * 80;
      const k = r();
      fields[k < 0.4 ? "a" : k < 0.75 ? "b" : "c"].push(rect(x + 1.5, x + w - 1.5, y + 1.5, Math.min(FULL, y + h) - 1.5));
      hedges.push(`M${n2(x)} ${n2(y)}H${n2(x + w)}`);
      y += h;
    }
    hedges.push(`M${n2(x)} ${-FULL}V${FULL}`);
    x += w;
  }
  out.push(path("a3-dk-field-a", fields.a.join("")), path("a3-dk-field-b", fields.b.join("")), path("a3-dk-field-c", fields.c.join("")));
  out.push(path("a3-dk-hedge", hedges.join("")));
  // two roads and a meandering river
  let road = "";
  for (const y0 of [-150, 210]) road += `M${LO} ${n2(y0)}C${n2(LO + 1500)} ${n2(y0 + 60)} ${n2(LO + 3500)} ${n2(y0 - 70)} ${n2(HI)} ${n2(y0)}`;
  out.push(path("a3-dk-road", road));
  let river = `M${LO} 40`;
  for (let x = LO; x < HI; x += 400) river += `Q${n2(x + 200)} ${n2(40 + (r() - 0.5) * 220)} ${n2(x + 400)} ${n2(40 + (r() - 0.5) * 60)}`;
  out.push(path("a3-dk-river", river));
  return out.join("");
}
/**
 * A broken cumulus deck seen from above (review round 2: a few faint smudges left the platter a blank disc at
 * 10,000 ft): clusters of three to five puffs on a jittered lattice, periodic over the strip, each puff in four
 * layers drawn deck-wide in order (a soft cast shadow, the darker underside, the body, the lit crown toward the
 * light), so overlapping puffs merge into one cloud with lit tops and darker bases; about a fifth of the lattice is
 * left open, and the country shows faintly through the gaps. Clouds 15-30 m across (150-300 px at 1x).
 */
function cloudSet() {
  const r = rng(53);
  const R = DECK.repeat;
  const [lo, hi] = DECK.span;
  const layers = { shadow: [], base: [], body: [], crown: [] };
  const el = (x, y, rx, ry) => `<ellipse cx="${n2(x)}" cy="${n2(y)}" rx="${n2(rx)}" ry="${n2(ry)}"/>`;
  const put = (list, x, y, rx, ry) => {
    for (const k of [-1, 0, 1, 2]) {
      const X = x + k * R;
      if (X + rx < lo || X - rx > hi) continue;
      list.push(el(X, y, rx, ry));
    }
  };
  const cols = 22;
  const pitch = R / cols;
  for (let i = 0; i < cols; i++)
    for (const j of [-1, 0, 1]) {
      if (r() < 0.2) continue;
      const cx = i * pitch + (r() - 0.5) * pitch * 0.45;
      const cy = j * 255 + (r() - 0.5) * 80;
      const n = 3 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const a = r() * 2 * Math.PI;
        const d = r() * 75;
        const x = cx + Math.cos(a) * d * 1.3;
        const y = cy + Math.sin(a) * d * 0.8;
        const q = 42 + r() * 40;
        // fu/r2-lights (webgl.md 8.4): the cast shadow is a separate, softer footprint well down-screen of the puff, and the
        // darker base tone is the underside only: it sits inside the body's width and shows below it, so no edge of the
        // puff is darker than the fields under it (review fu-r2: the base ringed every puff, 15-28 levels under the fields)
        put(layers.shadow, x + 0.62 * q, y + 0.52 * q, q * 0.98, q * 0.86);
        put(layers.base, x - 0.1 * q, y + 0.12 * q, q * 0.78, q * 0.8);
        put(layers.body, x - 0.1 * q, y - 0.12 * q, q * 0.84, q * 0.78);
        put(layers.crown, x - 0.26 * q, y - 0.3 * q, q * 0.5, q * 0.44);
      }
    }
  // soft edges from radial gradients (no filters: a blur over the whole scrolling strip would re-run every frame)
  const grad = (id, cls, stops) => `<radialGradient id="${id}">${stops.map(([o, k]) => `<stop offset="${o}" class="${cls}-${k}"/>`).join("")}</radialGradient>`;
  const defs = `<defs>${grad("a3-dk-csh-r", "a3-dk-csh", [[0, "1"], [0.55, "h"], [1, "0"]])}${grad("a3-dk-cbs-r", "a3-dk-cbs", [[0, "1"], [0.8, "1"], [1, "0"]])}${grad("a3-dk-cbd-r", "a3-dk-cbd", [[0, "1"], [0.7, "1"], [1, "0"]])}${grad("a3-dk-ccr-r", "a3-dk-ccr", [[0, "1"], [0.45, "h"], [1, "0"]])}</defs>`;
  return `${defs}<g class="a3-dk-cshadow" fill="url(#a3-dk-csh-r)">${layers.shadow.join("")}</g><g class="a3-dk-cbase" fill="url(#a3-dk-cbs-r)">${layers.base.join("")}</g><g class="a3-dk-cbody" fill="url(#a3-dk-cbd-r)">${layers.body.join("")}</g><g class="a3-dk-ccrown" fill="url(#a3-dk-ccr-r)">${layers.crown.join("")}</g>`;
}

function taxiSet() {
  const out = [];
  const T = DECK.taxiway;
  const r = rng(11);
  out.push(path("a3-dk-strip", rect(LO, HI, -FULL, FULL)));
  out.push(path("a3-dk-shld", rect(LO, HI, -T.shoulder, T.shoulder)));
  out.push(path("a3-dk-asph", rect(LO, HI, -T.half, T.half)));
  // paving lanes and tyre wear (longitudinal)
  out.push(path("a3-dk-seam", [-62.5, 62.5].map((y) => `M${LO} ${y}H${HI}`).join("") + [-T.shoulder, T.shoulder].map((y) => `M${LO} ${y}H${HI}`).join("")));
  out.push(wearLanes([[0, 8], [-26.3, 11], [26.3, 11], [-62.3, 10], [62.3, 10], [-45, 8], [45, 8]]));
  const rubber = [];
  for (let i = 0; i < 46; i++) {
    const x = LO + r() * (HI - LO);
    const y = (r() < 0.5 ? -1 : 1) * (20 + r() * 50);
    rubber.push(streak(x, y, 30 + r() * 90, 0.9 + r() * 1.1, (r() - 0.5) * 2));
  }
  out.push(path("a3-dk-rubber", rubber.join(""), ' fill-opacity=".45"'));
  // shoulder stripes every 30 m (perpendicular to the edge), centreline, double edge lines
  const stripes = lattice(150, 300)
    .map((x) => rect(x - 4.5, x + 4.5, T.half + 4, T.shoulder - 9) + rect(x - 4.5, x + 4.5, -T.shoulder + 9, -T.half - 4))
    .join("");
  out.push(path("a3-dk-yellow", stripes, ' fill-opacity=".8"'));
  const lines = rect(LO, HI, -0.75, 0.75) + [-1, 1].map((s) => rect(LO, HI, s * (T.half - 1.5), s * T.half) + rect(LO, HI, s * (T.half - 4.5), s * (T.half - 3))).join("");
  out.push(path("a3-dk-yellow", lines));
  out.push(lightsSvg(LIGHT_ROWS.filter((R) => R.set === 1)));
  return out.join("");
}

function runwayRep() {
  const out = [];
  const Rw = DECK.runway;
  const r = rng(23);
  out.push(path("a3-dk-strip", rect(LO, HI, -FULL, FULL)));
  out.push(path("a3-dk-shld", rect(LO, HI, -Rw.shoulder, Rw.shoulder)));
  out.push(path("a3-dk-asph", rect(LO, HI, -Rw.half, Rw.half)));
  out.push(path("a3-dk-seam", [-150, -75, 75, 150].map((y) => `M${LO} ${y}H${HI}`).join("") + [-Rw.shoulder, Rw.shoulder].map((y) => `M${LO} ${y}H${HI}`).join("")));
  // rubber streaks along the main-gear tracks
  const rubber = [];
  for (let i = 0; i < 70; i++) {
    const x = LO + r() * (HI - LO);
    const y = (r() < 0.5 ? -1 : 1) * (18 + r() * 60);
    rubber.push(streak(x, y, 40 + r() * 160, 0.8 + r() * 1.4, (r() - 0.5) * 2));
  }
  out.push(path("a3-dk-rubber", rubber.join(""), ' fill-opacity=".38"'));
  // side stripes (0.9 m, outer edge on the runway edge) and the 30 m x 0.9 m centreline stripes every 50 m
  out.push(path("a3-dk-white", rect(LO, HI, -Rw.half, -Rw.half + Rw.edge) + rect(LO, HI, Rw.half - Rw.edge, Rw.half)));
  const thr = DECK.thrX;
  const pitch = Rw.cl.len + Rw.cl.gap;
  const cl = lattice(thr + Rw.cl.start, pitch).filter((x) => x - pitch < HI);
  const first = cl[0] - pitch;
  if (first + Rw.cl.len > LO) cl.unshift(first);
  out.push(path("a3-dk-white", cl.map((x) => rect(x, x + Rw.cl.len, -Rw.cl.half, Rw.cl.half)).join("")));
  out.push(lightsSvg(LIGHT_ROWS.filter((R) => R.set === 2)));
  return out.join("");
}

function runwayOnce() {
  // platter coordinates at brake release: the threshold (runway end) at thrX, the runway toward +x
  const out = [];
  const t = DECK.thrX;
  const Rw = DECK.runway;
  const r = rng(31);
  // before the threshold: the blast pad (60 m) on the runway strip, which also hides the periodic markings
  out.push(path("a3-dk-strip", rect(t - 3200, t, -FULL, FULL)));
  out.push(path("a3-dk-shld", rect(t - 600, t, -Rw.shoulder, Rw.shoulder)));
  out.push(path("a3-dk-blast", rect(t - 600, t, -Rw.half, Rw.half)));
  const chev = [];
  for (const xa of [t - 40, t - 340]) {
    for (const s of [-1, 1]) {
      const reach = Math.min(Rw.half - 6, 214);
      chev.push(poly([[xa, 0], [xa - reach, s * reach], [xa - reach - 12.7, s * reach], [xa - 12.7, 0]]));
    }
  }
  out.push(path("a3-dk-yellow", chev.join(""), ' fill-opacity=".85"'));
  // the threshold zone: no centreline stripes until the end of the (unnumbered) designation zone
  out.push(path("a3-dk-asph", rect(t - 1, t + Rw.cl.start, -Rw.cl.half - 0.3, Rw.cl.half + 0.3)));
  // touchdown-zone rubber: dense streaks from 120 m to 900 m along the main-gear tracks
  const rubber = [];
  for (let i = 0; i < 150; i++) {
    const x = t + 1200 + Math.pow(r(), 1.4) * 7800;
    const y = (r() < 0.5 ? -1 : 1) * (12 + r() * 66);
    rubber.push(streak(x, y, 30 + r() * 140, 0.9 + r() * 1.6, (r() - 0.5) * 2.4));
  }
  out.push(path("a3-dk-rubber", rubber.join(""), ' fill-opacity=".55"'));
  // threshold piano keys: 12 stripes 30 m x 1.8 m from 6 m, to within 3 m of the edges, double centre gap
  const keys = [];
  for (let k = 0; k < 6; k++) for (const s of [-1, 1]) keys.push(rect(t + 60, t + 360, s * (14.5 + 32.5 * k), s * (32.5 + 32.5 * k)));
  // touchdown zone (pattern A, LDA >= 2400 m): pairs at 150, 300, 600, 750, 900 m (3, 3, 2, 1, 1 stripes of
  // 22.5 m x 3 m, 1.5 m apart, inner edges 9 m off the centreline); the 450 m pair gives way to the aiming point
  const tdz = [];
  for (const [D, n] of [[1500, 3], [3000, 3], [6000, 2], [7500, 1], [9000, 1]]) for (let k = 0; k < n; k++) for (const s of [-1, 1]) tdz.push(rect(t + D, t + D + 225, s * (90 + 45 * k), s * (120 + 45 * k)));
  // aiming point: 60 m x 10 m from 400 m, inner edges 9 m off the centreline
  const aim = [-1, 1].map((s) => rect(t + 4000, t + 4600, s * 90, s * 190)).join("");
  out.push(path("a3-dk-white", keys.join("") + tdz.join("") + aim));
  // threshold and runway-end lights across the threshold: the fixtures, and the fallback's two faces (review round 3: it
  // showed green from every bearing): green toward the approach, red toward the runway, crossfaded by the bearing with
  // the shader's own lobe (a3-rl-thr-g / -r)
  const bar = THRESHOLD_BAR;
  const rows = Array.from({ length: bar.count }, (_, k) => ({ set: 2, color: "green", y: bar.y0 + k * bar.step, z: bar.z, lens: bar.lens, halo: bar.halo, gain: bar.gain, pool: bar.pool, inset: true, xs: [t] }));
  const before = LIT_SINK.out;
  const fixtures = lightsSvg(rows);
  LIT_SINK.out = before;
  const list = rows.map((R) => [t, R.y, bar.lens * 10, bar.lens * 10 * bar.halo, R]);
  out.push(fixtures);
  // fu/r2-lights: by day the shader's lobe scales the glint's energy, which turns its pale core into the saturated body as
  // it falls (a dot at half energy is solid red, at full a pale-cored dot): the fallback draws the bar twice, at half and
  // at full energy, the full copy over the half one by the lobe (a3-rl-hi-<c>), and the cover by the lobe (a3-rl-thr-<c>)
  const barSvg = (color) => {
    if (!LIGHT_PAGE) return poolSvg(color, list) + litSvg(color, list);
    const half = list.map(([x, y, rl, rh, R]) => [x, y, rl, rh, { ...R, gain: (R.gain ?? 1) * 0.5 }]);
    return `<g class="a3-rl-lo">${litSvg(color, half)}</g><g class="a3-rl-hi-${color[0]}">${litSvg(color, list)}</g>`;
  };
  LIT_SINK.out += ["g", "r"].map((c) => `<g class="a3-rl-thr-${c}" data-c="${c === "g" ? "green" : "red"}"><g class="a3-rl-up" data-z="${bar.z}">${barSvg(c === "g" ? "green" : "red")}</g></g>`).join("");
  return out.join("");
}

// ---------------------------------------------------------------------------------------------
// the shadow footprint (platter coordinates at rest): fuselage with the belly fairing, wings with the fences,
// tailplanes, nacelles; every polygon counter-clockwise so the nonzero union has no holes
// ---------------------------------------------------------------------------------------------
function footprint(W, M) {
  const polys = [];
  const ccw = (pts) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) a += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
    return a < 0 ? pts.slice().reverse() : pts;
  };
  const K = ([x, y]) => {
    const p = W.kit([x, y, 0]);
    return [p[0], p[1]];
  };
  const xs = [];
  for (let x = 0.06; x < 2; x += 0.12) xs.push(x);
  for (let x = 2; x < 70.4; x += 0.5) xs.push(x);
  xs.push(70.4);
  const half = (x) => {
    let h = W.loftAt(x).halfWidth;
    if (x >= W.FAIRING.x[0] && x <= W.FAIRING.x[1]) h = Math.max(h, Math.max(...W.FAIRING.half(x).map((p) => p[0])));
    return h;
  };
  const right = xs.map((x) => [x, half(x)]);
  const left = xs
    .slice()
    .reverse()
    .map((x) => [x, -half(x)]);
  polys.push(ccw([[0.0, 0], ...right, [70.4, 0.2], [70.4, -0.2], ...left].map(K)));
  for (const s of [-1, 1]) {
    const le = M.WING.le.map(([x, y]) => [x, s * y]);
    const te = M.WING.te.map(([x, y]) => [x, s * y]);
    const fe = M.WING.fence;
    const tipFence = [
      [fe.xLE, s * fe.y],
      [fe.xLE, s * (fe.y + 0.12)],
      [fe.xTE, s * (fe.y + 0.12)],
      [fe.xTE, s * fe.y],
    ];
    polys.push(ccw([[le[0][0], 0], ...le, ...tipFence, ...te.slice().reverse(), [te[0][0], 0]].map(K)));
    const tle = M.EMPENNAGE.tailplane.le.map(([x, y]) => [x, s * y]);
    const tte = M.EMPENNAGE.tailplane.te.map(([x, y]) => [x, s * y]);
    polys.push(ccw([...tle, ...tte.slice().reverse()].map(K)));
  }
  for (const N of W.NACELLE) {
    const pts = [];
    const st = [[0, 1.7], [0.5, 1.94], [3.81, 1.9], [6.2, 1.205], [6.2, 1.0], [6.93, 0.835], [6.93, 0.495], [8.39, 0.08]];
    for (const [s, rr] of st) pts.push([N.lip + s, N.y + rr]);
    for (const [s, rr] of st.slice().reverse()) pts.push([N.lip + s, N.y - rr]);
    polys.push(ccw(pts.map(K)));
  }
  return polys.map(poly).join("");
}

/** The five contact patches (platter coordinates) and each gear's arm ahead of the pitch pivot (m). */
function contactGears(W, M) {
  const G = M.GEAR;
  const piv = 38.551;
  const kx = (x) => W.kit([x, 0, 0])[0];
  const r = G.tyres.main.diameter / 2;
  // each gear's tyre contacts: a short ellipse under every tyre (r along x, the tread across), not one blade
  const tyres = (xs, ys, yc) => xs.flatMap((x) => ys.map((y) => [kx(x), W.m(yc + y)]));
  const rn = G.tyres.nose ? G.tyres.nose.diameter / 2 : 0.635;
  const out = [{ id: "nlg", x: kx(G.nose.axle[0]), y: 0, rx: 9.5, ry: 8.5, arm: piv - G.nose.axle[0], steer: true, tyres: tyres([G.nose.axle[0]], G.nose.wheelY, 0), trx: W.m(rn * 0.55), try: W.m(0.2) }];
  for (const [s, side] of W.SIDES) {
    const xc = (G.wing.axleX[0] + G.wing.axleX[1]) / 2;
    out.push({ id: `wlg.${s}`, x: kx(xc), y: W.m(side * G.wing.centre[1]), rx: W.m((G.wing.axleX[1] - G.wing.axleX[0]) / 2 + r * 0.8), ry: W.m(0.675 + 0.42), arm: 0, tyres: tyres(G.wing.axleX, G.wing.wheelY, side * G.wing.centre[1]), trx: W.m(r * 0.55), try: W.m(0.26) });
  }
  for (const [s, side] of W.SIDES) {
    const xc = G.body.axleX[1];
    out.push({ id: `blg.${s}`, x: kx(xc), y: W.m(side * G.body.centre[1]), rx: W.m((G.body.axleX[2] - G.body.axleX[0]) / 2 + r * 0.8), ry: W.m(0.775 + 0.42), arm: 0, tyres: tyres(G.body.axleX, G.body.wheelY.centre, side * G.body.centre[1]), trx: W.m(r * 0.55), try: W.m(0.26) });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// CSS (light values first, dark overrides after)
// ---------------------------------------------------------------------------------------------
const CSS = `.iso{--a3-dk-pave:#e7e7e3;--a3-dk-conc:#eae9e4;--a3-dk-patch:#e2e1db;--a3-dk-asph:#d4d4d0;--a3-dk-blast:#cdcdc8;--a3-dk-shld:#dfdfda;--a3-dk-strip:#e4e4de;--a3-dk-joint:#c4c3bc;--a3-dk-seam:#c9c9c3;--a3-dk-white:#fbfbf9;--a3-dk-yellow:#d3a42c;--a3-dk-red:#c25a4c;--a3-dk-band:#5b5b57;--a3-dk-rubber:#3e3e3a;--a3-dk-wear:#cfcfc9;--a3-dk-oil:#77756c;--a3-dk-fix:#a2a2a7;--a3-dk-lens:#55585f;--a3-dk-pit:#dcdbd5;--a3-dk-pitline:#9a9993;--a3-dk-grate:#b9b8b2;--a3-dk-rim:#f3f3f0;--a3-dk-rimline:#a9a9ad;--a3-dk-bolt:#74747a;--a3-dk-contact:#1c1c18;--a3-dk-plate:#f0efe9;--a3-dk-land:#e3e5dc;--a3-dk-field-a:#d9ded0;--a3-dk-field-b:#e1dfd2;--a3-dk-field-c:#d2d9cb;--a3-dk-hedge:#c3c9bb;--a3-dk-road:#cfcfca;--a3-dk-river:#c4ced6;--a3-dk-cloud:#ffffff;--a3-dk-cshadow:#8f9aa8;--a3-dk-cbase:#b8c2ce;--a3-dk-cbody:#d6dde6;--a3-dk-ccrown:#ffffff}
.iso[data-theme="dark"]{--a3-dk-pave:#1d1d1d;--a3-dk-conc:#212121;--a3-dk-patch:#1b1b1b;--a3-dk-asph:#171717;--a3-dk-blast:#151515;--a3-dk-shld:#1b1b1b;--a3-dk-strip:#1a1a19;--a3-dk-joint:#121212;--a3-dk-seam:#121212;--a3-dk-white:#4b4b49;--a3-dk-yellow:#6b5822;--a3-dk-red:#64302a;--a3-dk-band:#0f0f0f;--a3-dk-rubber:#070707;--a3-dk-wear:#191919;--a3-dk-oil:#0b0b0b;--a3-dk-fix:#3c3c3e;--a3-dk-lens:#5a5d64;--a3-dk-pit:#262625;--a3-dk-pitline:#3e3e3c;--a3-dk-grate:#151515;--a3-dk-rim:#232323;--a3-dk-rimline:#444446;--a3-dk-bolt:#6a6a6e;--a3-dk-contact:#000000;--a3-dk-plate:#1e1e1e;--a3-dk-land:#191b18;--a3-dk-field-a:#1c201b;--a3-dk-field-b:#201f1b;--a3-dk-field-c:#181c18;--a3-dk-hedge:#141713;--a3-dk-road:#262624;--a3-dk-river:#151b21;--a3-dk-cloud:#3a3d42;--a3-dk-cshadow:#050607;--a3-dk-cbase:#2b2e33;--a3-dk-cbody:#3d4148;--a3-dk-ccrown:#5d636c}
.a3-set-stand,.a3-set-taxi,.a3-set-rwy,.a3-set-land,.a3-set-cloud,.a3-rwy-rep,.a3-rwy-once,.a3-dk-shadow,.a3-dk-footprint,.a3-dk-contacts{pointer-events:none}
.a3-dk-base{fill:var(--a3-dk-pave);stroke:none}
.a3-dk-conc{fill:var(--a3-dk-conc);stroke:none}
.a3-dk-patch{fill:var(--a3-dk-patch);stroke:none}
.a3-dk-asph{fill:var(--a3-dk-asph);stroke:none}
.a3-dk-blast{fill:var(--a3-dk-blast);stroke:none}
.a3-dk-shld{fill:var(--a3-dk-shld);stroke:none}
.a3-dk-strip{fill:var(--a3-dk-strip);stroke:none}
.a3-dk-wear{stroke:none}
.a3-dk-wear-0{stop-color:var(--a3-dk-wear);stop-opacity:0}
.a3-dk-wear-h{stop-color:var(--a3-dk-wear);stop-opacity:.1}
.a3-dk-wear-1{stop-color:var(--a3-dk-wear);stop-opacity:.22}
.a3-dk-oil-0{stop-color:var(--a3-dk-oil);stop-opacity:0}
.a3-dk-oil-h{stop-color:var(--a3-dk-oil);stop-opacity:.07}
.a3-dk-oil-1{stop-color:var(--a3-dk-oil);stop-opacity:.14}
.a3-dk-land{fill:var(--a3-dk-land);stroke:none}
.a3-dk-field-a{fill:var(--a3-dk-field-a);stroke:none}
.a3-dk-field-b{fill:var(--a3-dk-field-b);stroke:none}
.a3-dk-field-c{fill:var(--a3-dk-field-c);stroke:none}
.a3-dk-hedge{fill:none;stroke:var(--a3-dk-hedge);stroke-width:.8}
.a3-dk-road{fill:none;stroke:var(--a3-dk-road);stroke-width:2.2}
.a3-dk-river{fill:none;stroke:var(--a3-dk-river);stroke-width:5;stroke-linecap:round}
.a3-dk-cloud{stroke:none}
.a3-dk-cloud-0{stop-color:var(--a3-dk-cloud);stop-opacity:0}
.a3-dk-cloud-h{stop-color:var(--a3-dk-cloud);stop-opacity:.45}
.a3-dk-cloud-1{stop-color:var(--a3-dk-cloud);stop-opacity:.7}
.a3-dk-cshadow ellipse,.a3-dk-cbase ellipse,.a3-dk-cbody ellipse,.a3-dk-ccrown ellipse{stroke:none}
.a3-dk-csh-1{stop-color:var(--a3-dk-cshadow);stop-opacity:.42}.a3-dk-csh-h{stop-color:var(--a3-dk-cshadow);stop-opacity:.2}.a3-dk-csh-0{stop-color:var(--a3-dk-cshadow);stop-opacity:0}
.iso[data-theme="light"] .a3-dk-csh-1{stop-opacity:.14}.iso[data-theme="light"] .a3-dk-csh-h{stop-opacity:.06}
.a3-dk-cbs-1{stop-color:var(--a3-dk-cbase);stop-opacity:1}.a3-dk-cbs-0{stop-color:var(--a3-dk-cbase);stop-opacity:0}
.a3-dk-cbd-1{stop-color:var(--a3-dk-cbody);stop-opacity:1}.a3-dk-cbd-0{stop-color:var(--a3-dk-cbody);stop-opacity:0}
.a3-dk-ccr-1{stop-color:var(--a3-dk-ccrown);stop-opacity:1}.a3-dk-ccr-h{stop-color:var(--a3-dk-ccrown);stop-opacity:.6}.a3-dk-ccr-0{stop-color:var(--a3-dk-ccrown);stop-opacity:0}
.a3-dk-joint{fill:none;stroke:var(--a3-dk-joint);stroke-width:.55}
.a3-dk-seam{fill:none;stroke:var(--a3-dk-seam);stroke-width:.45}
.a3-dk-white{fill:var(--a3-dk-white);stroke:none}
.a3-dk-yellow{fill:var(--a3-dk-yellow);stroke:none}
.a3-dk-red{fill:var(--a3-dk-red);stroke:none}
.a3-dk-band{fill:var(--a3-dk-band);stroke:none;opacity:.55}
.a3-dk-rubber{fill:var(--a3-dk-rubber);stroke:none;opacity:.32}
.a3-dk-rubs{stroke:none;opacity:.12}
.iso[data-theme="dark"] .a3-dk-rubs{opacity:.3}
.a3-dk-rubs-1{stop-color:var(--a3-dk-rubber);stop-opacity:1}.a3-dk-rubs-h{stop-color:var(--a3-dk-rubber);stop-opacity:.5}.a3-dk-rubs-0{stop-color:var(--a3-dk-rubber);stop-opacity:0}
.a3-dk-scrub{fill:var(--a3-dk-rubber);stroke:none;opacity:.09}
.a3-dk-oil{stroke:none}
.a3-dk-grate{fill:var(--a3-dk-grate);stroke:none}
.a3-dk-gratebar{stroke:none}
.a3-dk-grate-bar{fill:var(--a3-dk-joint)}
.a3-dk-frame{fill:none;stroke:var(--a3-dk-pitline);stroke-width:.5}
.a3-dk-pit{fill:var(--a3-dk-pit);stroke:var(--a3-dk-pitline);stroke-width:.5}
.a3-dk-pitring{fill:none;stroke:var(--a3-dk-pitline);stroke-width:.4}
.a3-dk-pitbolt{fill:var(--a3-dk-pitline);stroke:none}
.a3-dk-pithinge{fill:var(--a3-dk-pitline);stroke:none}
.a3-dk-fix{fill:var(--a3-dk-fix);stroke:none}
.a3-dk-lens{fill:var(--a3-dk-lens);stroke:none}
.iso{--a3-rl-pale:#ffffff;--a3-rl-shade:#000000}
.a3-rl-pool{stroke:none}
:is(.a3-rl-lit,.a3-rl-thr-g,.a3-rl-thr-r)[data-c="white"]{--a3-rl-c:var(--a3-gl-white)}
:is(.a3-rl-lit,.a3-rl-thr-g,.a3-rl-thr-r)[data-c="green"]{--a3-rl-c:var(--a3-gl-green)}
:is(.a3-rl-lit,.a3-rl-thr-g,.a3-rl-thr-r)[data-c="blue"]{--a3-rl-c:var(--a3-gl-blue)}
:is(.a3-rl-lit,.a3-rl-thr-g,.a3-rl-thr-r)[data-c="red"]{--a3-rl-c:var(--a3-gl-red)}
.iso[data-theme="dark"] :is(.a3-rl-lit,.a3-rl-thr-g,.a3-rl-thr-r),.iso[data-theme="dark"] :is(.a3-rl-lit,.a3-rl-thr-g,.a3-rl-thr-r) :is(use,.a3-rl-pool){mix-blend-mode:screen}
.a3-dk-rim{fill:var(--a3-dk-rim);stroke:none}
.a3-dk-rimline{fill:none;stroke:var(--a3-dk-rimline);stroke-width:.5}
.a3-dk-bolt{fill:var(--a3-dk-bolt);stroke:none}
.a3-dk-lubber{fill:var(--anatomy-hi);stroke:none}
.a3-dk-index{fill:var(--anatomy-hi);stroke:none}
.a3-dk-plate{fill:var(--a3-dk-plate);stroke:none}
.a3-dk-shadow{opacity:.18}
.a3-dk-shadow path{fill:var(--a3-shadow);stroke:none}
.a3-dk-contact ellipse{stroke:none}
.a3-dk-ct-1{stop-color:var(--a3-dk-contact);stop-opacity:1}.a3-dk-ct-h{stop-color:var(--a3-dk-contact);stop-opacity:.55}.a3-dk-ct-0{stop-color:var(--a3-dk-contact);stop-opacity:0}
.iso[data-theme="dark"] .a3-dk-shadow{opacity:.35}
.iso[data-theme="dark"] .a3-dk-rubber{opacity:.55}
.iso[data-theme="dark"] .a3-dk-scrub{opacity:.26}
.iso[data-theme="dark"] .a3-dk-wear-h{stop-opacity:.22}
.iso[data-theme="dark"] .a3-dk-wear-1{stop-opacity:.45}
.iso[data-theme="dark"] .a3-dk-oil-h{stop-opacity:.14}
.iso[data-theme="dark"] .a3-dk-oil-1{stop-opacity:.3}
.iso[data-theme="dark"] .a3-dk-band{opacity:.8}`;

// ---------------------------------------------------------------------------------------------
// module interface
// ---------------------------------------------------------------------------------------------
export function groups(ctx) {
  void ctx;
}

export function build(ctx) {
  const { W, M, P } = ctx;
  const FIT = W.fit();
  const S = DECK;
  // gear tracks for the stand's brake rubber (the tyres' rest spots), from the model
  const G = M.GEAR;
  const tracks = [
    { xs: [G.nose.axle[0]], ys: G.nose.wheelY },
    ...[-1, 1].map((s) => ({ xs: G.wing.axleX, ys: G.wing.wheelY.map((y) => s * G.wing.centre[1] + y) })),
    ...[-1, 1].map((s) => ({ xs: G.body.axleX, ys: G.body.wheelY.front.map((y) => s * G.body.centre[1] + y) })),
  ].map((t) => ({ xs: t.xs.map((x) => W.kit([x, 0, 0])[0]), ys: t.ys.map((y) => W.m(y)) }));

  plinth(ctx);

  // the platter: a vertical round on `air`, a fixed picture in kit tones
  const ringAt = (z, n = 120, r = S.platterR) => Array.from({ length: n }, (_, i) => {
    const a = ((i + 0.5) / n) * 2 * Math.PI;
    return [r * Math.cos(a), r * Math.sin(a), z];
  });
  // the drum stands 0.15 units (1.5 cm, a tenth of a pixel at 1x) inside the platter's rim, so the two no longer share
  // an edge (review fu-1, item 37: the flush pair tied at their common ring, 4 px out of order in two clip frames)
  ctx.hull({ name: "stage.platter.drum", group: "air", layer: "deck", rings: [ringAt(-6, 120, S.platterR - 0.15), ringAt(-1.4, 120, S.platterR - 0.15)], smooth: true, sharp: 30, tone: "lo", crease: "mid", jointCaps: { last: "faint" } });
  const platter = ctx.hull({ name: "stage.platter", group: "air", layer: "deck", rings: [ringAt(-1.4), ringAt(0)], smooth: true, sharp: 30, tone: "lo", crease: "mid", jointCaps: { first: "faint" } });

  // the deck plane: pavement, sets, rim band and bolts, lubber index, shadow and contacts
  const clip = `<clipPath id="a3-dk-clip"><path d="${circ(0, 0, S.clipR)}"/></clipPath>`;
  // the lit fallback lights fade over the GL's own pixel window (glWindow), so neither painter lights the steel rim band
  const litMask = `<radialGradient id="a3-dk-litfade" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="${S.glWindow[1]}"><stop offset="${(S.glWindow[0] / S.glWindow[1]).toFixed(4)}" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient><mask id="a3-dk-litmask" maskUnits="userSpaceOnUse" x="-400" y="-400" width="800" height="800"><circle r="${S.glWindow[1]}" fill="url(#a3-dk-litfade)"/></mask>`;
  const soft = `<linearGradient id="a3-dk-wear-l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="a3-dk-wear-0"/><stop offset=".5" class="a3-dk-wear-1"/><stop offset="1" class="a3-dk-wear-0"/></linearGradient><radialGradient id="a3-dk-wear-r"><stop offset="0" class="a3-dk-wear-1"/><stop offset=".6" class="a3-dk-wear-h"/><stop offset="1" class="a3-dk-wear-0"/></radialGradient><radialGradient id="a3-dk-rubber-r"><stop offset="0" class="a3-dk-rubs-1"/><stop offset=".55" class="a3-dk-rubs-h"/><stop offset="1" class="a3-dk-rubs-0"/></radialGradient><radialGradient id="a3-dk-oil-r"><stop offset="0" class="a3-dk-oil-1"/><stop offset=".55" class="a3-dk-oil-h"/><stop offset="1" class="a3-dk-oil-0"/></radialGradient><radialGradient id="a3-dk-cloud-r"><stop offset="0" class="a3-dk-cloud-1"/><stop offset=".6" class="a3-dk-cloud-h"/><stop offset="1" class="a3-dk-cloud-0"/></radialGradient>`;
  const defs = `<defs>${clip}${litMask}${soft}<pattern id="a3-dk-grate" width="10" height="2.2" patternUnits="userSpaceOnUse"><rect class="a3-dk-grate-bar" x="0" y="0" width="10" height="0.9"/></pattern><filter id="a3-dk-shadow-blur" filterUnits="userSpaceOnUse" x="-460" y="-460" width="920" height="920"><feGaussianBlur stdDeviation="${(6 / FIT.k).toFixed(1)}"/></filter><radialGradient id="a3-dk-contact-r"><stop offset="0" class="a3-dk-ct-1"/><stop offset=".5" class="a3-dk-ct-h"/><stop offset="1" class="a3-dk-ct-0"/></radialGradient>${haloDefs()}</defs>`; // f4-lights: haloDefs
  const [standFix, standLit] = litOf(() => standSet(W, tracks));
  const [taxiFix, taxiLit] = litOf(() => taxiSet());
  const [repFix, repLit] = litOf(() => runwayRep());
  const [onceFix, onceLit] = litOf(() => runwayOnce());
  // the sets' lit fallback lights, in copies of the sets' groups (gl/runway.js moves and fades both copies alike)
  BB_K.k = FIT.k;
  const litSets =
    bbDefs() +
    `<g class="a3-set-stand">${standLit}</g>` +
    `<g class="a3-set-taxi" style="opacity:0;visibility:hidden">${taxiLit}</g>` +
    `<g class="a3-set-rwy" style="opacity:0;visibility:hidden"><g class="a3-rwy-rep">${repLit}</g><g class="a3-rwy-once">${onceLit}</g></g>`;
  const sets =
    `<g class="a3-set-stand">${standFix}</g>` +
    `<g class="a3-set-taxi" style="opacity:0;visibility:hidden">${taxiFix}</g>` +
    `<g class="a3-set-rwy" style="opacity:0;visibility:hidden"><g class="a3-rwy-rep">${repFix}</g><g class="a3-rwy-once">${onceFix}</g></g>` +
    `<g class="a3-set-land" style="opacity:0;visibility:hidden"><g class="a3-land-move">${landSet()}</g></g>` +
    `<g class="a3-set-cloud" style="opacity:0;visibility:hidden"><g class="a3-cloud-move">${cloudSet()}</g></g>`;
  const [r0, r1] = S.rim;
  const rim = `M${r1} 0A${r1} ${r1} 0 1 0 ${-r1} 0A${r1} ${r1} 0 1 0 ${r1} 0ZM${r0} 0A${r0} ${r0} 0 1 1 ${-r0} 0A${r0} ${r0} 0 1 1 ${r0} 0Z`;
  const bolts = Array.from({ length: S.rimBolts.count }, (_, i) => {
    const a = ((i + 0.5) / S.rimBolts.count) * 2 * Math.PI;
    return circ(S.rimBolts.r * Math.cos(a), S.rimBolts.r * Math.sin(a), 0.95);
  }).join("");
  const lubber = poly([
    [380.4, -3.4],
    [385.6, 0],
    [380.4, 3.4],
  ]);
  const fp = footprint(W, M);
  const gears = contactGears(W, M);
  // each tyre's contact: an ellipse inside its footprint (0.3 m along x, half the tread across) with a soft radial
  // falloff 0.3 m all round, a gradient not a blur (the blur scaled with the Inspect zoom and the hard ellipse's
  // part outside the tyre read as a blade with two cusps)
  const contacts = gears.map((g) => `<g class="a3-dk-contact" data-gear="${g.id}" style="opacity:0">${g.tyres.map(([x, y]) => `<ellipse cx="${n2(x)}" cy="${n2(y)}" rx="${n2(3 + 3)}" ry="${n2(g.try + 3)}"/>`).join("")}</g>`).join("");
  const svg =
    defs +
    `<g clip-path="url(#a3-dk-clip)"><path class="a3-dk-base" d="${circ(0, 0, S.clipR)}"/>${sets}</g>` +
    `<path class="a3-dk-rim" fill-rule="evenodd" d="${rim}"/><path class="a3-dk-rimline" d="${circ(0, 0, r0)}"/><path class="a3-dk-bolt" d="${bolts}"/><path class="a3-dk-lubber" d="${lubber}"/>` +
    `<g clip-path="url(#a3-dk-clip)"><g class="a3-dk-shadow" filter="url(#a3-dk-shadow-blur)"><g class="a3-dk-footprint"><path d="${fp}"/></g></g><g class="a3-dk-contacts" fill="url(#a3-dk-contact-r)">${contacts}</g></g>` +
    `<g mask="url(#a3-dk-litmask)">${litSets}</g>`;
  ctx.plane(platter, { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1], fade: [-1, -0.9], svg });
  // the lubber rule on the drum at the nose bearing (ends on the top crease and the bottom outline)
  ctx.plane(platter, { o: [S.platterR, 0, -6], u: [0, 1, 0], v: [0, 0, 1], normal: [1, 0, 0], fade: [0.04, 0.3], svg: `<path class="iso-line" data-tone="hi" d="M0 0V6"/>` });

  ctx.css(CSS);
  ctx.vary("a3-rl-lit", "1 - (pv.glShare || 0)");
  // f3-lights: the billboards' pixel-size copies (BB_PX), as the airframe lenses' (lights.mjs sized)
  BB_PX.forEach((_, i) => ctx.vary(`a3-rl-px${i}`, `((pv.glPxW || [1, 0, 0])[${i}])`));
  // the threshold bar's faces: red seen from the runway side, green from the approach, each with its own directional
  // lobe as the shader draws them (gl/runway.mjs: smoothstep(0, .35) of the view direction along the runway, here cos of
  // the bearing), so side-on the bar fades through dark, not through a mix of the two (review fu-1: salmon side-on)
  // fu/r2-lights: the lobe takes the shader's own viewer direction (gl/runway.js st.vaX), the turn's cosine before it runs
  const vaX = "(typeof __a380 !== 'undefined' && __a380.stage && typeof __a380.stage.vaX === 'number' ? __a380.stage.vaX : Math.cos((40 - (ch.turn || 0)) * Math.PI / 180))";
  // (review fu-r2: by day the lobe as an opacity faded the red dot to pink, R−G 73 against GL's 193 at b −80)
  if (LIGHT_PAGE) {
    // by day: the cover follows the core's (lampInk's alpha reaches .95 at energy 2.3, half the lobe), and the full-energy
    // copy comes in over the half-energy one as the lobe rises from .5 to 1
    const lobeOf = (sg) => `F.smooth(0, 0.35, ${sg}${vaX})`;
    ctx.vary("a3-rl-thr-r", `(1 - (pv.glShare || 0)) * F.smooth(0, 0.5, ${lobeOf("")})`);
    ctx.vary("a3-rl-thr-g", `(1 - (pv.glShare || 0)) * F.smooth(0, 0.5, ${lobeOf("-")})`);
    ctx.vary("a3-rl-hi-r", `F.smooth(0.5, 1, ${lobeOf("")})`);
    ctx.vary("a3-rl-hi-g", `F.smooth(0.5, 1, ${lobeOf("-")})`);
  } else {
    ctx.vary("a3-rl-thr-r", `(1 - (pv.glShare || 0)) * F.smooth(0, 0.35, ${vaX})`);
    ctx.vary("a3-rl-thr-g", `(1 - (pv.glShare || 0)) * F.smooth(0, 0.35, -${vaX})`);
  }

  // the runway program (gl/runway.mjs) on the runway canvas; the page draws it (gl/runway.js)
  const rows = LIGHT_ROWS.map((R) => ({ ...R, dark: INK[R.color].dark, paper: INK[R.color].paper, lens: R.lens * 10 }));
  const bar = { ...THRESHOLD_BAR, lens: THRESHOLD_BAR.lens * 10, green: INK.green, red: INK.red, lightWindow: S.lightWindow };
  // one program per marking set (only the sets in the mix are drawn) and per theme (only that theme's ink is
  // compiled); the theme is the build's own --light flag (the ctx does not carry it: requests/M1.md R7)
  const theme = ctx.theme ?? (process.argv.includes("--light") ? "light" : "dark");
  RUNWAY_IDS.forEach((id, set) => ctx.glEffect({ id, canvas: "runway", fragment: RUNWAY.runwayFragment({ rows: rows.filter((R) => R.set === set), bar: set === 2 ? bar : null, repeat: S.repeat, window: S.glWindow, lightWindow: S.lightWindow, theme }), uniforms: RUNWAY.RUNWAY_UNIFORMS }));

  // page data and the page hook
  const o = P.origin;
  const Rb = 392 * FIT.k;
  const pivotX = W.kit([38.551, 0, 0])[0];
  ctx.data("stage", {
    repeat: S.repeat,
    thrX: S.thrX,
    onceReach: S.onceReach,
    pitch: S.pitch,
    box: [o[0] - Rb - 4, o[1] - 0.5 * Rb - 8, o[0] + Rb + 4, o[1] + 0.5 * Rb + 4],
    shadow: { blur: [6, 18], opacity: { dark: [0.35, 0.12], light: [0.18, 0.06] }, k: FIT.k, pivotX, lever: W.m(6.0 - 0.7) },
    contact: [0.62, 0.34],
    gears: gears.map(({ id, x, y, arm, steer }) => ({ id, x, y, arm, steer: Boolean(steer), max: 1 })),
    rows: LIGHT_ROWS.map(({ set, y, z, lens, halo, pool }) => ({ set, y, z, lens, halo, pool })),
    bar: THRESHOLD_BAR,
    window: S.glWindow[1],
  });
  const helpers = Object.entries(HELPERS)
    .map(([name, fn]) => `${name}: ${fn.toString()}`)
    .join(",\n");
  ctx.script(`A3RUNWAY.install(A3, {\n${helpers}\n}, A3.data.mod.stage);`);

  // labels (hover/tap; picking is the integrator's)
  ctx.label("stage.platter", (s) => `Turntable · 77 m platter · ${s.phase === "GATE" || s.phase === "PUSHBACK" ? "the stand: concrete slabs, lead-in line, stop bar" : s.phase === "TAXI" ? "a code F taxiway: green centreline, blue edge lights" : "the runway: piano keys, touchdown zone, centreline lights every 15 m"}`);
  ctx.label("stand.plinth", "Display plinth · heading ring in 2° steps, 10° majors");
  ctx.report(`platter r ${S.platterR}, plinth r 425, ${LIGHT_ROWS.length} light rows + threshold bar, deck plane ${(svg.length / 1024).toFixed(0)} KB`);
}

export function checks(ctx, out) {
  const { W } = ctx;
  const lines = [];
  // the plinth is proved against every live layer by the horizontal plane
  const proofs = (out.report.proofs ?? []).filter((p) => p.static === "stand.plinth");
  if (!proofs.length) throw new Error("no layer proof for stand.plinth");
  for (const p of proofs) if (p.rule !== "horizontal plane" || p.side !== "behind") throw new Error(`stand.plinth × ${p.layer}/${p.group} proved by ${p.rule} (${p.side}), not the horizontal plane`);
  lines.push(`plinth: ${proofs.length} proofs, all horizontal plane, behind (${[...new Set(proofs.map((p) => `${p.layer}/${p.group}`))].join(", ")})`);
  // world numbers
  const S = W.STAGE;
  if (Math.abs(W.m(S.platter.r) - DECK.platterR) > 1e-9 || W.m(S.platter.z0) !== -6 || W.m(S.platter.z1) !== 0) throw new Error("platter differs from W.STAGE");
  if (W.m(S.plinth.r) !== 425 || W.m(S.plinth.z1) !== -6 || W.m(S.plinth.z0) !== -16) throw new Error("plinth differs from W.STAGE");
  if (DECK.glWindow[1] > W.m(S.glWindow[1]) + 1e-9) throw new Error("GL window reaches past r 38.4 m");
  // helpers
  const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
  if (!near(wrapScroll(-2300, 6000), 3700) || !near(wrapScroll(6000, 6000), 0)) throw new Error("wrapScroll");
  if (speedFadeOf(0, 500) !== 1 || speedFadeOf(250, 500) !== 0) throw new Error("speedFadeOf");
  // the analytic stop distance against the model's own LINEUP deceleration (substeps of 1/30 s, inner 0.05 s)
  const KT = 0.514444;
  let v = 18;
  let dist = 0;
  for (let i = 0; i < 30 * 120; i++) {
    const a = Math.min(0.8, Math.max(-0.8, -v * KT * 0.8));
    v = Math.max(0, v + (a / KT) / 30);
    dist += (v * KT) / 30;
  }
  const stop = stopDistanceOf(18);
  if (Math.abs(stop - dist) > 0.4) throw new Error(`stop distance ${stop.toFixed(2)} m against the model's ${dist.toFixed(2)} m`);
  lines.push(`line-up stop from 18 kt: ${stop.toFixed(2)} m analytic, ${dist.toFixed(2)} m stepped`);
  // shadow at rest, lift-off and 6 m
  const cfg = { blur: [6, 18], opacity: { dark: [0.35, 0.12], light: [0.18, 0.06] }, k: W.fit().k, pivotX: W.kit([38.551, 0, 0])[0], lever: W.m(5.3) };
  for (const [lift, pitch] of [[0, 0], [0.5, 10], [6, 8]]) {
    const s = shadowOf(lift, pitch, 0, cfg);
    lines.push(`shadow at lift ${lift} m, pitch ${pitch}°: blur ${(s.blur * cfg.k).toFixed(1)} px, opacity ${s.opacity.toFixed(3)}, sx ${s.sx.toFixed(4)}, tx ${s.tx.toFixed(1)}`);
  }
  // the streak integral (the shader's closed form) against numeric integration over a comb
  const erf = (x) => {
    const s = x < 0 ? -1 : 1;
    const a = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * a);
    return s * (1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a));
  };
  const combA = (x, L, sg) => {
    const J = Math.floor(x + 0.5);
    return ((1.7724539 * sg) / L) * (J + 0.5 * (1 + erf(((x - J) * L) / sg)));
  };
  let worst = 0;
  for (const lam of [0.17, 0.3, 0.9, 2.4, -0.5])
    for (let u = -1.4; u <= 1.4; u += 0.037) {
      const L = 140;
      const sg = 6;
      const closed = (combA(u, L, sg) - combA(u - lam, L, sg)) / lam;
      let num = 0;
      const n = 4000;
      for (let i = 0; i < n; i++) {
        const t = ((i + 0.5) / n) * lam;
        for (let j = -6; j <= 6; j++) num += Math.exp(-(((u - t - j) * L) ** 2) / (sg * sg));
      }
      num /= n;
      worst = Math.max(worst, Math.abs(closed - num));
    }
  if (worst > 2e-3) throw new Error(`streak closed form off by ${worst}`);
  lines.push(`streak closed form vs numeric comb: largest error ${worst.toExponential(2)}`);
  for (const line of lines) console.log(`M1 stage: ${line}`);
}
