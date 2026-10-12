// a380/parts/cabin.mjs (M7): Cabin and flight deck: free groups cabin and cockpit, interiors of five cutaway bays, Inspect views.
//
// Design: a380/DESIGN.md §3.1, §3.3, §5.1 (W.CUT), §5.8, §5.10, §7.4, §8, §9 M7.
//
// Groups. `cabin` and `cockpit` are free ROOT groups with origin kit [0, 0, 0]. Each carries a sync rule:
// while synced its pose is exactly pitch's world pose (follow.mjs syncPose), otherwise F.PARKED (far above).
//   cabin:   synced while the channel cabin > 0 (the crowns are still closed at small values: the interior
//            is enclosed by single-facet walls, floors and cut pieces, DESIGN §5.1);
//   cockpit: synced while the group value cut.fd > W.COCKPIT_SYNC (14.5 units: the canopy, bottom 6.012 m,
//            has lifted 1.45 m, clear of the tallest flight-deck part, 7.442 m). Every cockpit part carries
//            the root class `a3-fd` (added by page script before the painters mount, see build()), whose vary
//            alpha is smooth(14.5, 20, cut.fd): the flight deck fades in as the canopy rises.
// Bays (W.CUT): every interior part lies at or under its bay's interior limit (≥ 0.02 m under the cut
// plane), ≥ 0.02 m inside its walls' inner faces, and inside [x0 + 0.02, x1 − 0.02] of the bay. Carpets
// stand W.GAP (0.012 m) over their floor pieces: the cross-group gap of the contract (a flush cross-group
// contact would be a GJK pair; 0.012 m still counts as support). Seats stand flush on the carpets.
// Seat stations come from model.mjs CABIN. Each seat block's station is its seat reference point (the
// junction of cushion and backrest); a block that cannot fit its bay at its station is left out and
// reported (checks), never moved.

import { buildDeckPlan } from "./cabin-plan.mjs";
import { convexHull3 } from "../../kit/hull3.mjs"; // f3-interiors: the coamings' visible facet
import { furnish, galleyTops, AISLE_CLEAR, binGroups } from "./cabin-furniture.mjs";
// r2: the windscreen seen from the flight deck is placed as nose.mjs places the panes on the canopy (its exported helpers)
import { surfaceX as noseSurfaceX, surfaceY as noseSurfaceY, surfaceZtop as noseSurfaceZtop, newell as noseNewell, frameOf as noseFrameOf } from "./nose.mjs";

export const id = "cabin";
export const owner = "M7";
export const title = "Cabin and flight deck: free groups cabin and cockpit, interiors of five cutaway bays, Inspect views";
/** Every part name this module creates starts with one of these (the harness enforces it). */
export const prefixes = ["cabin.", "cockpit."];
/** true: the harness builds stubs.mjs's stand-in instead of build(). M7_STUB=1 is the bench baseline only. */
export const stub = typeof process !== "undefined" && process.env.M7_STUB === "1";
/** Bench switch: M7_PARTS=cabin | cockpit builds one group's parts only (to cost each group on its own). */
const ONLY = (typeof process !== "undefined" && process.env.M7_PARTS) || "all";
// fu/f4-interiors (f3-engine E1): the Cockpit view looks down at 42° (both PFDs clear the headrests from 38°; r2 §4, f3 §5)
const COCKPIT_ELEVATION = 42;

// ---------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------
// Plane coordinates are kit units (dm). Seats, carpets and monuments print at 1 decimal (1 cm); the
// display symbology sets PREC to 2 while it draws (1 mm).
let PREC = 1;
const f2 = (v) => {
  const k = PREC === 2 ? 100 : 10;
  const r = Math.round(v * k) / k;
  return Object.is(r, -0) ? "0" : String(r);
};
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** Rounded rectangle path (closed), relative commands, in plane units. */
const rr = (x, y, w, h, r = 0) => {
  const q = Math.max(0, Math.min(r, w / 2, h / 2));
  if (q < (PREC === 2 ? 0.05 : 0.28)) return `M${f2(x)} ${f2(y)}h${f2(w)}v${f2(h)}h${f2(-w)}Z`;
  const a = f2(w - 2 * q);
  const b = f2(h - 2 * q);
  const Q = f2(q);
  return `M${f2(x + q)} ${f2(y)}h${a}q${Q} 0 ${Q} ${Q}v${b}q0 ${Q} -${Q} ${Q}h-${a}q-${Q} 0 -${Q} -${Q}v-${b}q0 -${Q} ${Q} -${Q}Z`;
};
/** Circle as a closed path. */
// r2 (craft-dark): the chord is twice the ROUNDED radius. Rounded apart (r 0.16 → 0.2, 2r 0.32 → 0.3), each half was a
// large arc of a circle on another centre, so every small knob drew as two crossing ellipses (the engine masters at 4x)
const circ = (cx, cy, r) => {
  const R = f2(r);
  const D = f2(2 * Number(R));
  return `M${f2(cx - Number(R))} ${f2(cy)}a${R} ${R} 0 1 0 ${D} 0a${R} ${R} 0 1 0 ${f2(-Number(D))} 0Z`;
};
const poly = (pts) => `M${pts.map(([x, y]) => `${f2(x)} ${f2(y)}`).join("L")}Z`;
const seg = (x0, y0, x1, y1) => `M${f2(x0)} ${f2(y0)}L${f2(x1)} ${f2(y1)}`;
const line = (d, tone = "lo", free = false) => (d ? `<path class="iso-line" data-tone="${tone}"${free ? ' data-free=""' : ""} d="${d}"/>` : "");
const fill = (d, cls = "a3-uph") => (d ? `<path class="${cls}" d="${d}"/>` : "");
/** Upholstery: one closed path, filled with the cushion tint and stroked in a line tone. */
const cush = (d, tone = "lo") => (d ? `<path class="iso-line a3-cush" data-tone="${tone}" d="${d}"/>` : "");

// ---------------------------------------------------------------------------------------------
// module state shared by build() and checks()
// ---------------------------------------------------------------------------------------------
const REC = { parts: [], blocks: [], seats: {}, dropped: [], displays: [], eye: [], fd: {} };
const TARGETS = { FD: 4, F: 22, U: 66, M: 80, UY: 28 };

/** Groups and follow rules (DESIGN §3.1, §3.3). */
export function groups(ctx) {
  const { W } = ctx;
  ctx.group("cabin", { free: { origin: [0, 0, 0] } });
  ctx.group("cockpit", { free: { origin: [0, 0, 0] } });
  ctx.rule({ group: "cabin", sync: { channel: "cabin", above: 0 } });
  ctx.rule({ group: "cockpit", sync: { channel: "cut.fd", above: W.COCKPIT_SYNC } });
  // WORKAROUND (requests/M7.md S6): one more synced free group per bay and per seat column, so pairs across
  // an aisle are paired at runtime (screen box, then a GJK plane cached for good: their relative pose never
  // changes). Every one carries the cabin's sync rule; remove with SPLIT = false once the kit relates
  // same-group pairs of a free group by their screen boxes.
  if (SPLIT) for (const g of splitGroups(ctx)) {
    ctx.group(g, { free: { origin: [0, 0, 0] } });
    ctx.rule({ group: g, sync: { channel: "cabin", above: 0 } });
  }
  if (SPLIT) for (const g of SPLIT_COCKPIT) {
    ctx.group(g, { free: { origin: [0, 0, 0] } });
    ctx.rule({ group: g, sync: { channel: "cut.fd", above: W.COCKPIT_SYNC } });
  }
  // the flight deck's aft wall (review round 3): the rear bulkhead with its door and the stowage beside it stand taller
  // than the rest of the deck (to 8.39 m), so they ride their own free group, synced once the canopy is 2.4 m up
  // (the two stowage blocks ride their own groups: the kit does not relate two parts of one free group a metre and
  // more apart, so they were drawn in either order, the depth oracle's stow.l × stow.r)
  for (const g of AFT_GROUPS) {
    ctx.group(g, { free: { origin: [0, 0, 0] } });
    ctx.rule({ group: g, sync: { channel: "cut.fd", above: AFT_SYNC } });
  }
  // r1 (fidelity): the overhead bins at their true height, one free group per bay, synced once the bay's crown is clear of
  // them (cabin-furniture.mjs binGroups)
  for (const b of binGroups(W)) {
    ctx.group(b.group, { free: { origin: [0, 0, 0] } });
    ctx.rule({ group: b.group, sync: { channel: b.channel, above: b.above } });
  }
}
/** The flight deck's aft group: the rear bulkhead and stowage, synced at cut.fd > AFT_SYNC (canopy bottom 8.41 m). */
const AFT_GROUP = "cockpit.aft";
const AFT_GROUPS = [AFT_GROUP, `${AFT_GROUP}.l`, `${AFT_GROUP}.r`];
const AFT_SYNC = 24;
/** Group-split workaround for the kit's free-group pairing (requests/M7.md S6). */
/** Bench switch: M7_SPLIT=0 builds without the split (to cost it). */
const SPLIT = !(typeof process !== "undefined" && process.env.M7_SPLIT === "0");
let SPLIT_GROUPS = [];
/**
 * The split cabin groups: each bay's monuments (U, M, UY; F's stay in `cabin`), each seat column of U, M and
 * UY, and each F suite (its two walls, divider, seat and shell; F rows are 1.81 m apart, beyond the kit's
 * proximity test even within a column).
 */
function splitGroups(ctx) {
  const F = ctx.M.CABIN.decks.main.zones.find((z) => z.cls === "F");
  const cut = ctx.W.CUT.F;
  const inBay = (x) => x >= cut.x[0] && x <= cut.x[1];
  const suites = [...F.sideRows.filter(inBay).flatMap((_, i) => [`cabin.f.s${i + 1}.l`, `cabin.f.s${i + 1}.r`]), ...F.centreRows.filter(inBay).map((_, i) => `cabin.f.c${i + 1}`)];
  SPLIT_GROUPS = [...["U", "M", "UY"].map((b) => `cabin.${b.toLowerCase()}`), ...["U", "M", "UY"].flatMap((b) => ["l", "c", "r"].map((c) => `cabin.${b.toLowerCase()}.${c}`)), ...suites];
  return SPLIT_GROUPS;
}
/** The flight deck's seats: each pilot and observer seat its own group (they stand a metre apart). */
const SPLIT_COCKPIT = ["cockpit.seat.l", "cockpit.seat.r", "cockpit.obs.l", "cockpit.obs.r"];
/** The group of a cabin part: the bay's monuments group, or its seat column's. */
const cabinGroup = (bay, column = null) => {
  if (!SPLIT || bay === "FD") return bay === "FD" ? "cockpit" : "cabin";
  if (column) return `cabin.${bay.toLowerCase()}.${column}`;
  return bay === "F" ? "cabin" : `cabin.${bay.toLowerCase()}`;
};

// ---------------------------------------------------------------------------------------------
// world queries (model metres)
// ---------------------------------------------------------------------------------------------
function worldOf(W) {
  /** Starboard half-width of the outer loft at station x and height z (the ring's side at that z). */
  const ringY = (x, z) => {
    const r = W.ring2(x);
    for (let i = 0; i < 15; i++) {
      const [ya, za] = r[i];
      const [yb, zb] = r[i + 1];
      if ((z - za) * (z - zb) <= 0 && Math.abs(zb - za) > 1e-9) return ya + ((yb - ya) * (z - za)) / (zb - za);
    }
    return 0;
  };
  const crownAt = (x) => W.ring2(x)[15][1];
  /** The true inner face of a single-facet wall strip (0.10 m deep) at (x, z): its |y|. */
  const facetIn = (x, z, belt) => {
    const edge = belt === "main" ? W.S0_INDEX.mainBelt : W.S0_INDEX.upperBelt;
    const f = W.facetLine(x, edge, 1);
    const ia = [f.a[0] - f.n[0] * 0.1, f.a[1] - f.n[1] * 0.1];
    return ia[0] + (f.t[0] * (z - ia[1])) / f.t[1];
  };
  /**
   * The inner face of the wall PIECE at (x, z): the strip is one convex hull of its rings, so where the
   * facet curves along x (the nose rings of nose.f.wall) the hull bridges the concave inner side with a
   * chord. Lower convex envelope of the inner face over the piece's ring stations.
   */
  const wallIn = (x, z, belt) => {
    const piece = W.SHELL.find((p) => p.clip.strip === belt && p.clip.side > 0 && x >= p.x[0] - 1e-6 && x <= p.x[1] + 1e-6);
    if (!piece) return facetIn(x, z, belt);
    const pts = W.stationsIn(piece.x[0], piece.x[1]).map((s) => [s, facetIn(s, z, belt)]);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2) {
        const [a, b] = lower.slice(-2);
        if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) <= 0) lower.pop();
        else break;
      }
      lower.push(p);
    }
    for (let i = 1; i < lower.length; i++) {
      const [a, b] = [lower[i - 1], lower[i]];
      if (x <= b[0] + 1e-9) return Math.min(facetIn(x, z, belt), a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1));
    }
    return facetIn(x, z, belt);
  };
  return { ringY, crownAt, wallIn };
}

/** Bay frames: limits, carpet heights, walls (DESIGN §5.1 W.CUT; CONTRACT §4). */
function baysOf(W) {
  const CARPET = 0.015;
  const out = {};
  for (const key of ["FD", "F", "U", "M", "UY"]) {
    const c = W.CUT[key];
    const z0 = c.floor + W.GAP;
    out[key] = {
      key,
      x0: c.x[0],
      x1: c.x[1],
      xa: c.x[0] + 0.02,
      xb: c.x[1] - 0.02,
      floor: c.floor,
      z0,
      zc: z0 + CARPET,
      top: key === "FD" ? c.cut + W.COCKPIT_SYNC / W.UNIT - 0.02 : c.limit,
      belt: key === "F" || key === "M" ? "main" : key === "FD" ? null : "upper",
      group: key === "FD" ? "cockpit" : "cabin",
    };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// seat classes: convex side profiles (u aft from the block's front, h up from the carpet), DESIGN §5.8
// ---------------------------------------------------------------------------------------------
// F and J blocks are two convex parts flush at the seat reference point: the upholstered seat with its
// ottoman (rubber) and the shell back (hi steel). Y blocks are one wedge (mid steel) whose ramp carries the
// cushions and backrests as planes. `ref` is the station's u: the seat reference point.
const CLASSES = {
  // First: 2-2-2 suites, ottoman and seat, a tall privacy shell, a privacy divider between the pair
  F: {
    ref: 0.97,
    lane: 0.55,
    parts: [
      { key: "seat", profile: [[0, 0], [0, 0.41], [0.97, 0.48], [0.97, 0]], tone: "mid", material: "rubber" },
      { key: "shell", profile: [[0.97, 0], [0.97, 0.48], [1.08, 1.08], [1.16, 1.13], [1.25, 1.13], [1.25, 0]], tone: "hi", material: "steel" },
    ],
  },
  // Business: folded legrest and cradle seat, shell back. The seat reference point is 0.54 m behind the
  // block's front and the shell ends 0.43 m behind it (a 17° backrest): with these the U bay (23.52-35.88)
  // holds every J row but the first centre row (23.71, 0.17 m from the bay's front) and the last side row
  // (35.78, 0.08 m from its aft end), which no seat-length block can fit at its station.
  J: {
    ref: 0.54,
    split: 0.3,
    parts: [
      { key: "seat", profile: [[0, 0], [0, 0.37], [0.54, 0.45], [0.54, 0]], tone: "mid", material: "rubber" },
      // the shell: an upright back (8°) with a deep rounded top, not a raked fin (review round 1)
      // review round 2: the backrest reclines 26° into a low curved shell (1.04 m), its headrest at the top; the
      // ottoman and seat pan stay on the seat block (split 0.3), the console between the pair on its top
      // review round 3: from the side the raked shell read as a pointed fin; its front now rises steeply into a rounded
      // hood (the reclined backrest is drawn on that face), so the silhouette is the shell
      { key: "shell", profile: [[0.54, 0], [0.54, 0.45], [0.6, 0.88], [0.68, 1.0], [0.8, 1.04], [0.92, 1.02], [0.97, 0.95], [0.97, 0]], tone: "hi", material: "steel" },
    ],
  },
  // Economy: a level seat pan, then an upright backrest (7°) with the headrest at its top, in one convex block
  // (a raked wedge read as leaning cards: review round 1)
  // review round 3: one hull of the pan and the upright back dropped the pan's corner (it is concave) and filled the
  // seat into a wedge, a shark fin from the side. Two parts flush at the junction: the pan block, rounded at the
  // front, and the back, thick, with a rounded headrest top
  Y: {
    ref: 0.4,
    parts: [
      { key: "pan", profile: [[0, 0], [0, 0.4], [0.04, 0.46], [0.44, 0.48], [0.44, 0]], tone: "mid", material: "steel" },
      { key: "back", profile: [[0.44, 0], [0.44, 0.48], [0.49, 1.0], [0.53, 1.08], [0.6, 1.11], [0.66, 1.07], [0.66, 0]], tone: "mid", material: "steel" },
    ],
  },
};
const lengthOf = (C) => Math.max(...C.parts.flatMap((p) => p.profile.map((q) => q[0])));
/** A convex polygon [[x, y]…] shrunk by d (edges moved inward and re-intersected). */
function insetPoly(pts, d) {
  const n = pts.length;
  const c = pts.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]);
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % n];
    const t = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(t[0], t[1]) || 1;
    let m = [-t[1] / l, t[0] / l];
    if (m[0] * (c[0] - a[0]) + m[1] * (c[1] - a[1]) < 0) m = [-m[0], -m[1]];
    return { p: [a[0] + m[0] * d, a[1] + m[1] * d], t: [t[0] / l, t[1] / l], l };
  });
  const out = [];
  for (let i = 0; i < n; i++) {
    const A = lines[(i - 1 + n) % n];
    const B = lines[i];
    const den = A.t[0] * B.t[1] - A.t[1] * B.t[0];
    if (Math.abs(den) < 1e-9) continue;
    const s = ((B.p[0] - A.p[0]) * B.t[1] - (B.p[1] - A.p[1]) * B.t[0]) / den;
    out.push([A.p[0] + A.t[0] * s, A.p[1] + A.t[1] * s]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------------------------
/** Parts, planes, labels, accents, inspect views, GL registrations, CSS, clips. */
export function build(ctx) {
  const { W, M, F } = ctx;
  const K = (p) => W.kit(p);
  const KD = (d) => W.kitDir(d);
  const WQ = worldOf(W);
  const BAY = baysOf(W);
  REC.parts.length = 0;
  REC.blocks.length = 0;
  REC.dropped.length = 0;
  REC.displays.length = 0;
  REC.eye.length = 0;

  /** A convex part from model points; recorded for the bay checks. */
  const solid = (name, bay, pts, opts = {}) => {
    // (the bins ride their own groups whatever the split: cabin-furniture.mjs binGroups)
    const group = opts.kind === "bin" ? opts.group : opts.group && SPLIT ? opts.group : cabinGroup(bay, opts.column ?? null);
    const part = ctx.hull({ name, group, points: pts.map(K), tone: opts.tone ?? "mid", material: opts.material ?? "steel", crease: opts.crease ?? "faint", ...(opts.cls ? { cls: opts.cls } : {}) });
    REC.parts.push({ name, bay, pts, kind: opts.kind ?? "part", group, top: opts.top });
    return part;
  };
  /** A plane on a face given in model terms: o (top-left), u (along svg x), v (along svg y), n (outward). */
  const face = (part, { o, u, v, n }, svg, fade) => {
    if (!svg) return;
    ctx.plane(part, { o: K(o), u: KD(u), v: KD(v), normal: KD(n), svg, ...(fade ? { fade } : {}) });
  };
  /** Points of a profile [[x, z]…] extruded across y0..y1. */
  const across = (prof, y0, y1) => prof.flatMap(([x, z]) => [[x, y0, z], [x, y1, z]]);
  /** Points of a profile [[y, z]…] extruded along x0..x1. */
  const along = (prof, x0, x1) => prof.flatMap(([y, z]) => [[x0, y, z], [x1, y, z]]);
  /** Faces of an (x, z) profile: [{ a, b, n (outward, model (x, z)), len, dir }]. */
  const facesOf = (prof) => {
    // outward normals from the polygon's orientation (signed area): a vertex centroid can fall outside a convex
    // profile as deep as the Y seat's (pan, then an upright back) and flip a face
    let area = 0;
    for (let i = 0; i < prof.length; i++) {
      const a = prof[i];
      const b = prof[(i + 1) % prof.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    const sgn = area > 0 ? 1 : -1;
    return prof.map((a, i) => {
      const b = prof[(i + 1) % prof.length];
      const d = [b[0] - a[0], b[1] - a[1]];
      const len = Math.hypot(d[0], d[1]);
      const n = [(sgn * d[1]) / len, (-sgn * d[0]) / len];
      return { a, b, n, len, dir: [d[0] / len, d[1] / len] };
    });
  };

  // ---------------------------------------------------------------------------------------------
  // CSS and page classes (light first, dark after; CONTRACT §5)
  // ---------------------------------------------------------------------------------------------
  // r1 (craft-light): the fallback screens' colours are the GL cockpit program's (gl/shaders.mjs screenOf through its
  // light inkFor and dark glowOf), as each theme renders them, read from the two painters at the same framing (the Cockpit
  // view, 4x, a380/shots/r1/ck-{gl,nogl}-{dark,light}-x4.png): glass, sky, ground and tape per theme, and in light the
  // symbol cores. They were the screenOf palette's raw values, 17-45 levels off the GL screens
  ctx.css(`.iso{--a3-uph:#2b3038;--a3-run:#3a3f48;--a3-scr:#0f141f;--a3-scr-fb:#0f141f;--a3-sym:#86a9e4;--a3-sym-hi:#a1a4a9;--a3-sky:#1a60c5;--a3-gnd:#663d1d;--a3-amber:#c99a3e}
.iso[data-theme="dark"]{--a3-uph:#a0968a;--a3-run:#0e0c0a;--a3-scr:#070a10;--a3-scr-fb:#111726;--a3-sym:#9cc0ff;--a3-sym-hi:#eef4ff;--a3-sky:#3b93d2;--a3-gnd:#986f42;--a3-amber:#e0b25a}
.a3-uph{fill:var(--a3-uph);fill-opacity:.15;stroke:none}
.iso[data-theme="dark"] .a3-uph{fill-opacity:.3}
.iso-line.a3-cush{fill:var(--a3-uph);fill-opacity:.15}
.iso[data-theme="dark"] .iso-line.a3-cush{fill-opacity:.3}
.iso-line.a3-cush.a3-fab{fill-opacity:.4}
.iso[data-theme="dark"] .iso-line.a3-cush.a3-fab{fill-opacity:.45}
.a3-run{fill:var(--a3-run);fill-opacity:.12;stroke:none}
.iso[data-theme="dark"] .a3-run{fill-opacity:.28}
.a3-scr{fill:var(--a3-scr);stroke:none}
.a3-disp path{fill:none;stroke:var(--a3-sym)}
.a3-disp .a3-hi{stroke:var(--a3-sym-hi)}
.a3-disp .a3-sky{fill:var(--a3-sky);stroke:none}
.a3-disp .a3-scrfb{fill:var(--a3-scr-fb);stroke:none}
.a3-disp .a3-gnd{fill:var(--a3-gnd);stroke:none}
.a3-disp .a3-amb{stroke:var(--a3-amber)}
.a3-disp .a3-ambf{fill:var(--a3-amber);stroke:none}
.iso{--a3-sym-g:#219c49;--a3-sym-c:#3599ac;--a3-tape:#141926}
.iso[data-theme="dark"]{--a3-sym-g:#2fd36a;--a3-sym-c:#46c6e0;--a3-tape:#323b4f}
.a3-disp .a3-g{stroke:var(--a3-sym-g)}
.a3-disp .a3-gf{fill:var(--a3-sym-g);fill-opacity:.6;stroke:none}
.a3-disp .a3-cf{fill:var(--a3-sym-c);fill-opacity:.8;stroke:none}
.a3-disp .a3-tape{fill:var(--a3-tape);stroke:none}
.a3-ext-lt{fill:var(--a3-amber);stroke:none}
.a3-isis path{fill:none;stroke:var(--a3-sym)}
.a3-isis .a3-sky{fill:var(--a3-sky);stroke:none}
.a3-isis .a3-gnd{fill:var(--a3-gnd);stroke:none}
.a3-isis .a3-tape{fill:var(--a3-tape);stroke:none}
.a3-isis .a3-hi{stroke:var(--a3-sym-hi)}
.a3-isis .a3-amb{stroke:var(--a3-amber)}
.a3-isis .a3-g{stroke:var(--a3-sym-g)}
.a3-isis .a3-gl{fill:var(--a3-sym-g);stroke:none}
.a3-isis .a3-oitr{fill:var(--a3-sym-c);fill-opacity:.7;stroke:none}
.iso{--a3-tko:#b0392f}
.iso[data-theme="dark"]{--a3-tko:#8a3029}
.a3-tko{fill:var(--a3-tko);stroke:none}
.iso{--a3-ws-g:#b8c8d6}
.iso[data-theme="dark"]{--a3-ws-g:#0d131d}
.a3-ws-g{fill:var(--a3-ws-g);stroke:none}
.iso-line.a3-ws-r{fill:none}
.iso[data-theme="light"] .a3-stage :is([data-name^="cockpit.seat"],[data-name^="cockpit.back"],[data-name^="cockpit.head"],[data-name^="cockpit.arm"],[data-name^="cockpit.obs"])[data-mat="rubber"]{--anatomy-paper:#575048;--anatomy-face:#5e564d;--anatomy-top:#675e55;--anatomy-shade-3:#5c544b;--anatomy-shade-2:#534c44;--anatomy-shade-1:#4a433c;--anatomy-shade-0:#413b34;--anatomy-lit-top:#726960;--anatomy-lit-shade:#60574e}
.a3-fd{}
.a3-acc .a3-acc-fd{stroke:var(--anatomy-faint)}
.iso[data-theme="dark"] .a3-stage [data-name="cockpit.mat"][data-mat="rubber"]{--anatomy-paper:#282522;--anatomy-face:#2a2724;--anatomy-top:#2c2926;--anatomy-shade-3:#2b2825;--anatomy-shade-2:#272421;--anatomy-shade-1:#23201e;--anatomy-shade-0:#1f1d1b;--anatomy-lit-top:#322e2a;--anatomy-lit-shade:#2c2926}
.iso[data-theme="light"] .a3-stage [data-name="cockpit.mat"][data-mat="rubber"]{--anatomy-paper:#b4ada3;--anatomy-face:#bdb6ac;--anatomy-top:#cbc5bb;--anatomy-shade-3:#bfb8ae;--anatomy-shade-2:#b2aba1;--anatomy-shade-1:#a59e94;--anatomy-shade-0:#989187;--anatomy-lit-top:#d6d0c6;--anatomy-lit-shade:#c2bbb1}
.a3-stage .a3-oh{right:auto;left:10px}
.a3-stage .a3-oh .a3-oh-clip{overflow:hidden}
@media (max-width:600px){.a3-stage .a3-oh{left:auto;right:calc(6.5% + 4px);top:14px;width:54%;padding:4px 6px 3px}.a3-stage .a3-oh .a3-oh-t{font-size:9px;margin-bottom:2px}.a3-stage .a3-oh .a3-oh-tx{display:none}.a3-stage .a3-oh .a3-oh-clip svg{margin-top:-50.5%;margin-bottom:-2%}.a3-stage .a3-oh .a3-oh-f{display:none}}`);
  // r1 (craft-light): on a phone the inset was 117 px wide with a four-line title over the captain's console and seat, and its
  // section labels were 2 px tall. Under 600 px it shows only its EXT LT row (the svg cropped by its margins: the row is
  // y 50.5-62 of the 100 x 64 viewBox, in a clipping box), 54% wide so the lamps are about 4 px, top right over the dark nose, titled
  // "Overhead panel" (the rest of live.js's title goes in a span this module's page script wraps round it)
  ctx.script(`A3.on("frame", function ohTitle() {
  const t = document.querySelector(".a3-stage .a3-oh .a3-oh-t");
  if (!t || t.dataset.r1) return;
  t.dataset.r1 = "1";
  const m = /^(Overhead panel)(.*)$/.exec(t.textContent);
  if (m) t.innerHTML = m[1] + '<span class="a3-oh-tx">' + m[2] + "</span>";
  // the panel's svg in a clipping box, so its cropped rows never draw over the title (live.js keeps its lamp elements)
  const svg = t.parentElement.querySelector(":scope > svg");
  if (svg) {
    const clip = document.createElement("div");
    clip.className = "a3-oh-clip";
    svg.replaceWith(clip);
    clip.appendChild(svg);
  }
});`);
  // follow-up (item 3's stand-in): the overhead panel inset (live.js, styled in a380.css) moves to the frame's top left,
  // over the dark ground and the faded canopy: top right it cut the glareshield's end and the first officer's PFD at 1440,
  // and the F/O's displays and seat at 390. This module's CSS follows a380.css, so these rules win. On phones a380.css
  // widens the stage to 115% (margins −7.5% at the sides, −3% at the top) inside the cropping card, so the inset's offsets
  // add the cropped strip (7.5 / 115 = 6.5% of the stage's width; about 11 px at 390) to sit inside the visible frame, and the
  // inset narrows to 25% so it ends left of the captain's side console (at 390 any wider box covers a console or a seat).

  // ---------------------------------------------------------------------------------------------
  // the flight deck (group cockpit), truth amendment T3: floor 6.00, eye (2.92, ±0.53, 7.17)
  // ---------------------------------------------------------------------------------------------
  if (ONLY !== "cabin") buildCockpit();
  if (ONLY !== "cockpit") buildCabin();
  // follow-up item 1: every seat and monument of M.CABIN as a plan on the platter, in its own Inspect view (cabin-plan.mjs)
  REC.plan = buildDeckPlan(ctx, { wall: WQ.wallIn, ringY: WQ.ringY });

  /**
   * r2 (craft-dark, major): the Cockpit view fades the canopy, which carries the windscreen, so above the glareshield the
   * reader saw only the radome's aft cap. The windscreen as seen from the deck: the six panes (M.WINDOWS.cockpit, placed
   * as nose.mjs places them on the canopy, each a chord plane) as thin glass slabs 0.035 m inside the loft, the centre
   * post and the four side posts between them (each the hull of the two facing pane edges, so it touches both slabs and
   * cuts into neither), and a sill under each windshield standing on the glareshield. They ride the cockpit group and
   * show only while the Cockpit view has faded the canopy (vary a3-ws, the a3-fade-fd fade's complement); in the plain
   * cutaway the lifted canopy carries the panes. Faded, they are neither picked nor in the GL mask (DATA.mod.fades).
   */
  function buildWindscreen(gs) {
    const B = BAY.FD;
    const { add, sub, mul, dot, unit } = W.vec;
    const D0 = 0.035; // the slab's outer face under the loft's chord plane (m)
    const D1 = 0.047; // its inner face
    const INSET = 0.02; // the slab inside the pane's outline (the frame's lip)
    const ZMAX = B.top - 0.01; // under the canopy at sync
    const densify = (pl, n) => pl.flatMap((a, i) => {
      const b = pl[(i + 1) % pl.length];
      return Array.from({ length: n }, (_, k) => [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    });
    const hull2 = (pts) => {
      const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo = [];
      for (const q of p) {
        while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-9) lo.pop();
        lo.push(q);
      }
      const hi = [];
      for (const q of p.slice().reverse()) {
        while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 1e-9) hi.pop();
        hi.push(q);
      }
      return lo.slice(0, -1).concat(hi.slice(0, -1));
    };
    /** Keep the side of a convex 2D polygon where f(p) ≥ 0 (f affine). */
    const clip2 = (pl, f) => {
      const out = [];
      for (let i = 0; i < pl.length; i++) {
        const a = pl[i];
        const b = pl[(i + 1) % pl.length];
        const fa = f(a);
        const fb = f(b);
        if (fa >= 0) out.push(a);
        if (fa * fb < 0) {
          const t = fa / (fa - fb);
          out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
      }
      return out;
    };
    const panes = {};
    for (const pane of M.WINDOWS.cockpit.panes) {
      for (const [s, side] of W.SIDES) {
        // the pane on the loft, as nose.mjs builds it (the windshield from its front view, raised 0.10 m and clamped at x
        // 2.03; the side panes from the front view put on the loft, stretched over the side view's x range)
        let pts;
        if (pane.id === "windshield") {
          pts = densify(pane.front.map(([y, z]) => [y, z + 0.1]), 4).map(([y, z]) => {
            let x = noseSurfaceX(W, y, z, 0.07, 5.6);
            if (x === null || x < 2.03) {
              x = 2.03;
              z = noseSurfaceZtop(W, x, y);
            }
            return [x, side * y, z];
          });
        } else {
          const dense = densify(pane.front, 3);
          const xs = dense.map(([y, z]) => noseSurfaceX(W, y, z, 0.07, 5.6));
          const xa = Math.min(...xs);
          const xb = Math.max(...xs);
          const px0 = pane.id === "forwardSide" ? pane.x[0] - 0.16 : pane.x[0];
          pts = dense.map(([, z], i) => {
            const x = px0 + ((xs[i] - xa) / (xb - xa)) * (pane.x[1] - px0);
            return [x, side * noseSurfaceY(W, x, z), z];
          });
        }
        const c = mul(pts.reduce((acc, p) => add(acc, p), [0, 0, 0]), 1 / pts.length);
        let n = noseNewell(pts);
        if (dot(n, unit([-0.5, side * 0.6, 1])) < 0) n = mul(n, -1);
        const below = Math.min(...pts.map((p) => dot(sub(p, c), n)));
        const o = add(c, mul(n, below));
        const fr = noseFrameOf(o, n, [0, 0, 1]);
        const to2 = (p) => [dot(sub(p, o), fr.u), dot(sub(p, o), fr.v)];
        const to3 = ([a, b], d) => add(add(o, mul(n, -d)), add(mul(fr.u, a), mul(fr.v, b)));
        let poly2 = insetPoly(hull2(pts.map(to2)), INSET);
        // under the canopy at sync (the windshield's top corner reaches 7.46 m on the loft)
        poly2 = clip2(poly2, ([a, b]) => ZMAX - to3([a, b], D0)[2]);
        const key = `${pane.id}.${s}`;
        panes[key] = { id: pane.id, s, side, o, n, fr, poly2, to3, c: to3(poly2.reduce((acc, q) => [acc[0] + q[0] / poly2.length, acc[1] + q[1] / poly2.length], [0, 0]), D0) };
      }
    }
    const NAME = { windshield: "ws", forwardSide: "fs", aftSide: "as" };
    const slabPts = (P) => [...P.poly2.map((q) => P.to3(q, D0)), ...P.poly2.map((q) => P.to3(q, D1))];
    // the glass on each slab's inner face: the pane inside a 0.03 m lining band, a reflection streak, the frame's bolts
    for (const P of Object.values(panes)) {
      const part = solid(`cockpit.ws.${NAME[P.id]}.${P.s}`, "FD", slabPts(P), { tone: "mid", material: "gunmetal", cls: "a3-ws", top: ZMAX });
      const as = P.poly2.map((q) => q[0]);
      const bs = P.poly2.map((q) => q[1]);
      const aMax = Math.max(...as);
      const bMin = Math.min(...bs);
      // svg x along fr.v, y down the pane (−fr.u), in dm from the inner face's (aMax, bMin) corner
      const sv = ([a, b]) => [(b - bMin) * 10, (aMax - a) * 10];
      const glass = insetPoly(P.poly2, 0.03).map(sv);
      const [g0, g1] = [Math.min(...glass.map((q) => q[0])), Math.max(...glass.map((q) => q[0]))];
      const [h0, h1] = [Math.min(...glass.map((q) => q[1])), Math.max(...glass.map((q) => q[1]))];
      const streak = seg(g0 + (g1 - g0) * 0.18, h0 + (h1 - h0) * 0.75, g0 + (g1 - g0) * 0.5, h0 + (h1 - h0) * 0.2) + seg(g0 + (g1 - g0) * 0.34, h0 + (h1 - h0) * 0.8, g0 + (g1 - g0) * 0.6, h0 + (h1 - h0) * 0.38);
      const o = P.to3([aMax, bMin], D1);
      face(part, { o, u: P.fr.v, v: mul(P.fr.u, -1), n: mul(P.n, -1) }, fill(poly(glass), "a3-ws-g") + line(poly(glass), "lo") + `<path class="iso-line a3-ws-r" data-tone="faint" data-free="" d="${streak}"/>`);
    }
    /** The edge of A's polygon facing B: its two 3D end points (both faces). */
    const edgeToward = (A, Bp) => {
      const dir = sub(Bp.c, A.c);
      let best = null;
      for (let i = 0; i < A.poly2.length; i++) {
        const q0 = A.poly2[i];
        const q1 = A.poly2[(i + 1) % A.poly2.length];
        const mid = A.to3([(q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2], D0);
        const score = dot(sub(mid, A.c), dir) / Math.hypot(...dir);
        if (!best || score > best.score) best = { score, q: [q0, q1] };
      }
      return best.q.flatMap((q) => [A.to3(q, D0), A.to3(q, D1)]);
    };
    const posts = [["post.c", "windshield.l", "windshield.r"], ...W.SIDES.flatMap(([s]) => [[`post.${s}`, `windshield.${s}`, `forwardSide.${s}`], [`post.a${s}`, `forwardSide.${s}`, `aftSide.${s}`]])];
    for (const [name, a, b] of posts) solid(`cockpit.ws.${name}`, "FD", [...edgeToward(panes[a], panes[b]), ...edgeToward(panes[b], panes[a])], { tone: "mid", material: "gunmetal", cls: "a3-ws", top: ZMAX });
    sideSills();
    // the sill under each windshield (the coaming between the glareshield and the glass): from the pane's bottom edge (the
    // longest edge facing down the pane) sloping down to the glareshield's aft top edge, and forward to the bay's end,
    // inside the loft. Seen
    // from the aft quarter, 30° down, the sightlines over the glareshield pass under the windshields (their bottom is
    // 0.13-0.33 m over the glareshield top, the frame clearing the radome joint): the sill is what the reader sees there
    REC.fd.coamingFaces = [];
    for (const [s, side] of W.SIDES) {
      const P = panes[`windshield.${s}`];
      let best = null;
      for (let i = 0; i < P.poly2.length; i++) {
        const q0 = P.poly2[i];
        const q1 = P.poly2[(i + 1) % P.poly2.length];
        const L = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
        // the in-plane outward normal's share down the pane (−a), times the edge's length
        const nb = (q1[0] - q0[0]) / L;
        const na = -(q1[1] - q0[1]) / L;
        const mid = [(q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2];
        const cen = P.poly2.reduce((acc, q) => [acc[0] + q[0] / P.poly2.length, acc[1] + q[1] / P.poly2.length], [0, 0]);
        const sgn = na * (mid[0] - cen[0]) + nb * (mid[1] - cen[1]) > 0 ? 1 : -1;
        const score = L * Math.max(0, -sgn * na);
        if (!best || score > best.score) best = { score, q: [q0, q1] };
      }
      const e = best.q.flatMap((q) => [P.to3(q, D0), P.to3(q, D1)]);
      const xf = B.xa + 0.01;
      const front = [];
      for (const p of e) {
        const ay = Math.abs(p[1]);
        for (const z of [gs.z1, Math.min(p[2], WQ.crownAt(xf) - 0.03)]) {
          const yy = Math.max(0.006, Math.min(ay, WQ.ringY(xf, z) - 0.03, WQ.ringY(xf, Math.min(z + 0.02, WQ.crownAt(xf))) - 0.03));
          front.push([xf, side * yy, z]);
        }
      }
      // the two sills meet at the centre plane (each 0.006 m off it), under the centre post
      const pts = [...e, ...e.map((p) => [gs.x1 - 0.06, p[1], gs.z1]), ...front].map((p) => [p[0], side * Math.max(0.006, Math.abs(p[1])), p[2]]);
      const sill = solid(`cockpit.ws.sill.${s}`, "FD", pts, { tone: "mid", material: "gunmetal", cls: "a3-ws", top: ZMAX });
      coamingCovers(sill, pts, side);
    }
    /**
     * f4-interiors (review f3, craft-dark: in the Cockpit view the side panes and posts floated, with no wall under them):
     * the cut side wall's section under the side windows, a sill band in the structural tone from the windshield's outer
     * corner aft to the aft side window's end. Per side: one solid under each side pane (the hull of its bottom chain: the
     * vertices of the edges facing down the pane, from just inside the slab's inner face to SILL_D in, and the same
     * points SILL_H lower) and one bridging each gap (windshield to forward side window, forward to aft side window) under the
     * post's foot. Its top runs along each pane's bottom edge just inside the glass (a sill over the frame's foot), the
     * posts' feet land on it, the
     * forward bridge meets the windshield's coaming, and every point sits inside the loft as the slabs do.
     */
    function sideSills() {
      const SILL_H = 0.07;
      const SILL_D = 0.09;
      REC.fd.sideSills = [];
      /** The pane's bottom chain, ordered by x: the end points of its edges whose in-plane outward normal points down the pane. */
      const bottomChain = (P) => {
        const cen = P.poly2.reduce((acc, q) => [acc[0] + q[0] / P.poly2.length, acc[1] + q[1] / P.poly2.length], [0, 0]);
        const keep = new Set();
        for (let i = 0; i < P.poly2.length; i++) {
          const q0 = P.poly2[i];
          const q1 = P.poly2[(i + 1) % P.poly2.length];
          const L = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]);
          if (L < 1e-6) continue;
          const nb = (q1[0] - q0[0]) / L;
          const na = -(q1[1] - q0[1]) / L;
          const mid = [(q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2];
          const sgn = na * (mid[0] - cen[0]) + nb * (mid[1] - cen[1]) > 0 ? 1 : -1;
          if (-sgn * na >= 0.6) keep.add(i).add((i + 1) % P.poly2.length);
        }
        return [...keep].map((i) => P.poly2[i]).sort((p, q) => P.to3(p, D0)[0] - P.to3(q, D0)[0]);
      };
      const band = (name, top) => {
        const pts = [...top, ...top.map((p) => [p[0], p[1], p[2] - SILL_H])];
        solid(`cockpit.ws.wall.${name}`, "FD", pts, { tone: "mid", material: "gunmetal", cls: "a3-ws", top: ZMAX });
        const xs = pts.map((p) => p[0]);
        REC.fd.sideSills.push(`${name} x ${Math.min(...xs).toFixed(2)}-${Math.max(...xs).toFixed(2)}`);
      };
      // the band stands just inside the glass (3 mm off the slab's inner face, so the slab and the band keep a separating
      // plane: a band through the slab's depth would cut the chord under its convex bottom chain), SILL_D deep
      const depths = (P, q) => [P.to3(q, D1 + 0.003), P.to3(q, D1 + SILL_D)];
      for (const [s] of W.SIDES) {
        const ws = panes[`windshield.${s}`];
        const fs = panes[`forwardSide.${s}`];
        const as = panes[`aftSide.${s}`];
        const cf = bottomChain(fs);
        const ca = bottomChain(as);
        // the windshield's outer bottom corner: its vertex farthest from the centre plane
        const wq = ws.poly2.reduce((b, q) => (Math.abs(ws.to3(q, D0)[1]) > Math.abs(ws.to3(b, D0)[1]) ? q : b));
        band(`fwd.${s}`, [...depths(ws, wq), ...depths(fs, cf[0])]);
        band(`fs.${s}`, cf.flatMap((q) => depths(fs, q)));
        band(`mid.${s}`, [...depths(fs, cf[cf.length - 1]), ...depths(as, ca[0])]);
        band(`as.${s}`, ca.flatMap((q) => depths(as, q)));
      }
    }
    /**
     * f3-interiors (r2 open item: the coamings read as two plain slabs at 1x): the coaming's visible facet (the largest
     * hull face toward the Cockpit view's aft, 30°-down camera) carries what the A380's does: the windshield's heat and
     * wiper-motor access cover (a screwed panel, the largest rectangle inside the facet 0.035 m in), the wiper motor's
     * housing near the glass, the demister outlets along its foot by the glareshield. Lines on the face; no new part. Everything drawn is closed (no
     * texture line ends to root).
     */
    function coamingCovers(sill, pts, side) {
      const H = convexHull3(pts, { name: "cockpit.ws.sill" });
      // aft and 30° down (fu/f4-interiors: kept at 30° with the view at 42°; at 42° the score picks a facet under the
      // 0.02 m² floor and the covers would go; the 30° facet still faces the 42° camera, read in ck-f4f.png)
      const V = unit([0.87, 0, 0.5]);
      let best = null;
      for (const f of H.faces) {
        const ring = f.ring.map((i) => H.points[i]);
        const nw = noseNewell(ring);
        const area = Math.hypot(...nw) / 2;
        const score = area * Math.max(0, dot(f.n, V));
        if (!best || score > best.score) best = { score, ring, n: f.n, area };
      }
      if (!best || best.area < 0.02) return;
      const n = best.n;
      // u across the coaming (toward the centre plane along y, projected into the face), v down the slope
      let u = [0, -side, 0];
      u = unit(sub(u, mul(n, dot(u, n))));
      let v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
      if (v[2] > 0) v = mul(v, -1); // down the slope
      const c0 = best.ring[0];
      const to2 = (p) => [dot(sub(p, c0), u), dot(sub(p, c0), v)];
      const ring2 = best.ring.map(to2);
      const x0 = Math.min(...ring2.map((q) => q[0]));
      const y0 = Math.min(...ring2.map((q) => q[1]));
      const o = add(c0, add(mul(u, x0), mul(v, y0)));
      const sv = ([a, b]) => [(a - x0) * 10, (b - y0) * 10];
      const outline = ring2.map(sv);
      const panel = insetPoly(outline, 0.35);
      if (panel.length < 3) return;
      // the cover: the largest rectangle (square to the coaming's span) inside the facet's inset outline
      const across = (y) => {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = 0; i < panel.length; i++) {
          const [ax, ay] = panel[i];
          const [bx, by] = panel[(i + 1) % panel.length];
          if ((ay - y) * (by - y) > 0 || ay === by) continue;
          const x = ax + ((bx - ax) * (y - ay)) / (by - ay);
          lo = Math.min(lo, x);
          hi = Math.max(hi, x);
        }
        return [lo, hi];
      };
      const pys = panel.map((q) => q[1]);
      const [pTop, pBot] = [Math.min(...pys), Math.max(...pys)];
      let R = null;
      for (let i = 0; i <= 24; i++)
        for (let j = i + 1; j <= 24; j++) {
          const ya = pTop + ((pBot - pTop) * i) / 24 + 1e-6;
          const yb = pTop + ((pBot - pTop) * j) / 24 - 1e-6;
          const [a0, a1] = across(ya);
          const [b0, b1] = across(yb);
          const x0r = Math.max(a0, b0);
          const x1r = Math.min(a1, b1);
          const w = x1r - x0r;
          const h = yb - ya;
          if (!(w > 0) || h < 1.2) continue;
          const area = w * h;
          if (!R || area > R.area) R = { x: x0r, y: ya, w, h, area };
        }
      if (!R) return;
      const cover = rr(R.x, R.y, R.w, R.h, 0.25);
      let screws = "";
      for (const x of [R.x + 0.3, R.x + R.w - 0.3]) for (const y of [R.y + 0.3, R.y + R.h - 0.3]) screws += circ(x, y, 0.1);
      // the wiper motor's housing on the cover's upper (glass) side, centred; the demister outlets, three
      // slots along the cover's foot (sizes follow the cover: the facet is 0.2-0.3 m deep at the deck's two sides)
      const mw = R.w * 0.34;
      const mh = R.h * 0.3;
      const mx = R.x + R.w * 0.33; // centred: the two coamings draw mirror images
      const my = R.y + R.h * 0.2;
      const motor = rr(mx, my, mw, mh, Math.min(mw, mh) * 0.3) + rr(mx + mw * 0.15, my + mh * 0.25, mw * 0.7, mh * 0.5, Math.min(mw, mh) * 0.12);
      let vents = "";
      const sw = R.w * 0.13; // three slots over 0.285-0.755 of the width, between the corner screws
      const sh = Math.max(0.12, R.h * 0.08);
      const vy = R.y + R.h * 0.6;
      for (let k = 0; k < 3; k++) vents += rr(R.x + R.w * (0.285 + 0.17 * k), vy, sw, sh, sh * 0.4);
      const motorOk = Boolean(motor);
      face(sill, { o, u, v, n }, line(cover, "lo") + line(motor, "faint") + fill(vents, "a3-scr") + line(vents, "faint") + line(screws, "faint"));
      REC.fd.coamingFaces.push({ side, area: +best.area.toFixed(3), facing: +dot(n, V).toFixed(2), cover: [+(R.w / 10).toFixed(2), +(R.h / 10).toFixed(2)], motor: motorOk, vents: (vents.match(/M/g) || []).length });
    }
    REC.fd.windscreen = Object.keys(panes).length;
    const table = JSON.stringify(W.CUTS["cut.fd"].table);
    ctx.vary("a3-ws", `F.smooth(${W.COCKPIT_SYNC}, 20, F.tableAt(${table}, ch.cabin || 0, "smooth")) * (pv.inspect === "cockpit" ? Math.min(1, Math.max(0, ((pv.zoom || 1) - 1) / 3)) : 0)`);
    ctx.data("fades", { "a3-ws": ["^cockpit\\.ws\\."] });
    ctx.label("cockpit.ws", "Windscreen · two windshields and four side windows, the sliding side window forward (crew escape)", "inspect:cockpit");
  }

  function buildCockpit() {
    const B = BAY.FD;
    const EYE = W.PILOT_EYE;
    const zm = B.zc; // mat top: everything stands here
    const fd = REC.fd;
    // ---- the mat: the floor's top face at z 6.00, 0.05 m inside the loft, x 1.94..5.58
    // r1 (audits): the floor seams at x 3.6, 4.2 and 4.8 end on the mat's outline only if the outline has a vertex there
    // (between 2.98 and 4.0 the hull's chord lay 1.5-1.8 px inside the loft line the seams ran to): every seam station is
    // a hull station. r1 (craft-dark): the mat is the flight deck's carpet (rubber, a lo tone), not a light steel slab
    const SEAM_XS = [2.98, 3.6, 4.2, 4.8];
    const matXs = [B.xa, 2.4, ...SEAM_XS, B.xb];
    const mat = [];
    for (const x of matXs) for (const s of [-1, 1]) for (const z of [B.z0, zm]) mat.push([x, s * (WQ.ringY(x, B.floor) - 0.05), z]);
    const matPart = solid("cockpit.mat", "FD", mat, { tone: "lo", material: "rubber" });
    {
      // rudder pedals (two per pilot) and seat rails: closed shapes on the mat top
      const o = [B.xb, -2, zm];
      const at = (x, y) => [(B.xb - x) * 10, (y + 2) * 10];
      let d = "";
      let r = "";
      for (const s of [-1, 1]) {
        const yc = s * EYE[1];
        for (const dy of [-0.1, 0.1]) {
          const [px, py] = at(2.42, yc + dy - 0.045);
          d += rr(px - 1.0, py, 1.0, 0.9, 0.2);
        }
        for (const dy of [-0.17, 0.17]) {
          const [px, py] = at(3.12, yc + dy - 0.012);
          r += rr(px, py, 6.0, 0.24, 0.1);
        }
      }
      // floor panel seams run to the bulkhead and the side walls (no bare face at Inspect zoom), and the aisle
      // between the pilot seats to the door
      let seams = "";
      for (const x of SEAM_XS) {
        const w = WQ.ringY(x, B.floor) - 0.05; // on the mat's outline
        const [ax, ay] = at(x, -w);
        const [bx, by] = at(x, w);
        seams += `M${ax.toFixed(2)} ${ay.toFixed(2)}L${bx.toFixed(2)} ${by.toFixed(2)}`;
      }
      for (const y of [-0.28, 0.28]) {
        const [ax, ay] = at(2.98, y);
        const [bx, by] = at(B.xb, y);
        seams += `M${ax.toFixed(2)} ${ay.toFixed(2)}L${bx.toFixed(2)} ${by.toFixed(2)}`;
      }
      face(matPart, { o, u: [-1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }, line(d, "lo") + fill(d) + line(r, "faint") + line(seams, "faint"));
    }

    // ---- glareshield: just under the windshield sill (6.84), top 6.82; the FCU and EFIS panels on its aft face
    // follow-up (item 4): the aft face at 2.30 (was 2.40, [E]): from the 30° camera a 0.20 m overhang hid the top 35% of the
    // upper displays (the EWD's N1 dials); 0.10 m behind the panel's top hides 9%
    const gs = { x0: 1.97, x1: 2.3, z0: 6.71, z1: 6.82 };
    const gsPts = [];
    for (const s of [-1, 1]) {
      gsPts.push([gs.x0, s * 0.8, gs.z0], [gs.x0, s * 0.8, gs.z1], [gs.x1 - 0.03, s * 1.0, gs.z1], [gs.x1, s * 1.0, gs.z1 - 0.03], [gs.x1, s * 1.0, gs.z0]);
    }
    const glare = solid("cockpit.glareshield", "FD", gsPts, { tone: "mid", material: "gunmetal" });
    fd.glareTop = gs.z1;
    buildWindscreen(gs);
    {
      // aft face x = 2.40, z 6.71..6.79 (svg y down from z 6.79, x across from y −1.0)
      const H = (gs.z1 - 0.03 - gs.z0) * 10; // 0.8 dm
      let p = "";
      let k = "";
      // FCU in the centre
      p += rr((1.0 - 0.42) * 10, 0.12 * H, 8.4, 0.76 * H, 0.15);
      for (const yy of [-0.33, -0.12, 0.1, 0.3]) k += rr((1.0 + yy) * 10 - 0.6, 0.22 * H, 1.2, 0.22 * H, 0.05);
      let dots = "";
      for (const yy of [-0.3, -0.09, 0.13, 0.33]) dots += circ((1.0 + yy) * 10, 0.68 * H, 0.22);
      // EFIS control panels either side
      for (const s of [-1, 1]) {
        const c = (1.0 + s * 0.68) * 10;
        p += rr(c - 2.0, 0.14 * H, 4.0, 0.72 * H, 0.15);
        dots += circ(c - 0.9, 0.5 * H, 0.28) + circ(c + 0.9, 0.5 * H, 0.28);
      }
      face(glare, { o: [gs.x1, -1.0, gs.z1 - 0.03], u: [0, 1, 0], v: [0, 0, -1], n: [1, 0, 0] }, line(p, "lo") + line(k, "faint") + fill(k, "a3-scr") + line(dots, "lo"));
    }

    // ---- the overhead panel is not furniture (review round 3: a slab on two posts read as a table over the pilots, and the
    // A380's panel is in the ceiling, its face down, where the 17.5-42.5° view never looks). The Cockpit Inspect view
    // shows it as a framed inset of its layout instead, with the EXT LT switches as the light panel sets them (live.js)

    // ---- main instrument panel: aft face tilted 11° back, display row centre z 6.575 (0.69 m ahead of the eye)
    const pn = { xf: 2.1, xb0: 2.26, xb1: 2.2, z0: 6.4, z1: gs.z0, hw: 0.98 };
    const panel = solid("cockpit.panel", "FD", across([[pn.xf, pn.z0], [pn.xf, pn.z1], [pn.xb1, pn.z1], [pn.xb0, pn.z0]], -pn.hw, pn.hw), { tone: "mid", material: "gunmetal" });
    const DW = 0.152; // 6 in
    const DH = 0.203; // 8 in
    const pf = { top: [pn.xb1, 0, pn.z1], down: W.vec.unit([pn.xb0 - pn.xb1, 0, pn.z0 - pn.z1]) };
    const pfN = W.vec.unit([pn.z1 - pn.z0, 0, pn.xb0 - pn.xb1]); // aft and up
    const faceLen = Math.hypot(pn.xb0 - pn.xb1, pn.z0 - pn.z1);
    const upper = [["PFD", -0.62, "capt"], ["ND", -0.4, "capt"], ["EWD", 0, "centre"], ["ND", 0.4, "fo"], ["PFD", 0.62, "fo"]];
    const rowC = (pn.z1 - 6.575) / -pf.down[2]; // distance down the face to the row centre
    {
      const svgParts = [];
      let bez = "";
      let fast = "";
      let misc = "";
      for (const [kind, y, side] of upper) {
        const x0 = (y + pn.hw - DW / 2) * 10;
        const y0 = (rowC - DH / 2) * 10;
        bez += rr(x0 - 0.18, y0 - 0.18, DW * 10 + 0.36, DH * 10 + 0.36, 0.2);
        svgParts.push(display(kind, x0, y0, DW * 10, DH * 10));
        for (const [dx, dy] of [[-0.42, -0.42], [DW * 10 + 0.42, -0.42], [-0.42, DH * 10 + 0.42], [DW * 10 + 0.42, DH * 10 + 0.42]]) fast += circ(x0 + dx, y0 + dy, 0.09);
        const c = W.vec.add(W.vec.add([pf.top[0], y, pf.top[2]], W.vec.mul(pf.down, rowC)), [0, 0, 0]);
        REC.displays.push({ kind, side, row: "upper", centre: c, w: DW, h: DH, n: pfN });
      }
      // r2 (fidelity): the centre panel, captain's side of the EWD: the two ISIS (standby flight display, SFD, and standby
      // nav display, SND) side by side; the centre-right panel, between the EWD and the F/O's ND: the landing-gear lever
      // with its three green gear-down lamps, the autobrake selector and the clock (FlyByWire A380X, Center Right Panel; as
      // on every Airbus FBW flight deck). Review round 3 had the gear lever on the captain's side. The ISIS faces and the
      // gear lamps light with the deck's power in both painters (class a3-isis; no GL program draws them)
      let isis = "";
      let isisGlass = "";
      const sq = 0.82;
      for (const [kind, y] of [["SFD", -0.245], ["SND", -0.155]]) {
        const cx = (y + pn.hw) * 10;
        const cy = (rowC - 0.02) * 10;
        misc += rr(cx - sq / 2 - 0.08, cy - sq / 2 - 0.08, sq + 0.16, sq + 0.16, 0.1);
        isisGlass += `<path class="a3-scr" d="${rr(cx - sq / 2, cy - sq / 2, sq, sq, 0)}"/>`;
        PREC = 2;
        const r0 = 0.3;
        if (kind === "SFD") {
          // the attitude ball: sky over ground in a round window, the horizon, the aircraft symbol, a speed and an altitude tape
          isis += `<path class="a3-sky" d="M${f2(cx - r0)} ${f2(cy)}a${f2(r0)} ${f2(r0)} 0 0 1 ${f2(2 * r0)} 0Z"/><path class="a3-gnd" d="M${f2(cx - r0)} ${f2(cy)}a${f2(r0)} ${f2(r0)} 0 0 0 ${f2(2 * r0)} 0Z"/>`;
          isis += `<path class="a3-tape" d="${rr(cx - sq / 2 + 0.03, cy - sq / 2 + 0.05, 0.08, sq - 0.1, 0) + rr(cx + sq / 2 - 0.11, cy - sq / 2 + 0.05, 0.08, sq - 0.1, 0)}"/>`;
          isis += `<path class="a3-hi" d="${seg(cx - r0, cy, cx + r0, cy) + seg(cx - 0.12, cy + 0.12, cx + 0.12, cy + 0.12) + seg(cx - 0.08, cy - 0.12, cx + 0.08, cy - 0.12)}"/>`;
          isis += `<path class="a3-amb" d="${seg(cx - 0.2, cy, cx - 0.06, cy) + seg(cx + 0.06, cy, cx + 0.2, cy)}"/>`;
        } else {
          // the standby nav: a compass rose arc, the heading lubber and the course needle
          isis += `<path class="a3-hi" d="M${f2(cx - r0)} ${f2(cy + 0.08)}a${f2(r0)} ${f2(r0)} 0 0 1 ${f2(2 * r0)} 0${seg(cx, cy - 0.3, cx, cy - 0.2)}"/>`;
          isis += `<path class="a3-g" d="${seg(cx - 0.05, cy + 0.25, cx + 0.07, cy - 0.15)}"/>`;
        }
        PREC = 1;
      }
      // the gear lever (a wheel-shaped knob in its slot), its three gear-down lamps over it, the autobrake and the clock
      const gx = (0.27 + pn.hw) * 10;
      misc += rr(gx - 0.3, (rowC - 0.04) * 10, 0.6, 1.3, 0.25) + circ(gx, (rowC + 0.06) * 10 + 0.85, 0.24) + circ(gx, (rowC + 0.06) * 10 + 0.85, 0.12);
      let lamps = "";
      for (const dx of [-0.35, 0, 0.35]) lamps += rr(gx + dx - 0.12, (rowC - 0.09) * 10, 0.24, 0.2, 0);
      misc += lamps;
      isis += `<path class="a3-gl" d="${lamps}"/>`;
      const ax = (0.15 + pn.hw) * 10;
      misc += rr(ax - 0.45, (rowC - 0.06) * 10, 0.9, 0.6, 0.1) + circ(ax, (rowC - 0.06) * 10 + 0.3, 0.16);
      misc += circ(ax, (rowC + 0.06) * 10 + 0.4, 0.35) + circ(ax, (rowC + 0.06) * 10 + 0.4, 0.05);
      for (const s of [-1, 1]) misc += circ((s * 0.86 + pn.hw) * 10, rowC * 10, 0.3);
      face(panel, { o: [pf.top[0], -pn.hw, pf.top[2]], u: [0, 1, 0], v: pf.down, n: pfN }, line(bez, "lo") + svgParts.map((s) => s.glass).join("") + line(misc, "lo") + line(fast, "faint") + isisGlass + `<g class="a3-disp">${svgParts.map((s) => s.sym).join("")}</g><g class="a3-isis">${isis}</g>`);
      fd.panelX = pf.top[0] + pf.down[0] * rowC;
      fd.faceLen = faceLen;
    }

    // ---- lower centre panel: MFD, SD, MFD on a face sloping 19° below the horizontal, between panel and pedestal
    const lw = { xf: 2.14, x0: 2.26, x1: 2.52, z0: pn.z0, z1: 6.31, hw: 0.36 };
    const lower = solid("cockpit.lower", "FD", across([[lw.xf, zm], [lw.xf, lw.z0], [lw.x0, lw.z0], [lw.x1, lw.z1], [lw.x1, zm]], -lw.hw, lw.hw), { tone: "mid", material: "gunmetal" });
    {
      const down = W.vec.unit([lw.x1 - lw.x0, 0, lw.z1 - lw.z0]);
      const n = W.vec.unit([lw.z0 - lw.z1, 0, lw.x1 - lw.x0]);
      const len = Math.hypot(lw.x1 - lw.x0, lw.z1 - lw.z0);
      const c = len / 2;
      const parts = [];
      let bez = "";
      for (const [kind, y, side] of [["MFD", -0.235, "capt"], ["SD", 0, "centre"], ["MFD", 0.235, "fo"]]) {
        const x0 = (y + lw.hw - DW / 2) * 10;
        const y0 = (c - DH / 2) * 10;
        bez += rr(x0 - 0.15, y0 - 0.15, DW * 10 + 0.3, DH * 10 + 0.3, 0.2);
        parts.push(display(kind, x0, y0, DW * 10, DH * 10));
        REC.displays.push({ kind, side, row: "lower", centre: W.vec.add([lw.x0, y, lw.z0], W.vec.mul(down, c)), w: DW, h: DH, n });
      }
      face(lower, { o: [lw.x0, -lw.hw, lw.z0], u: [0, 1, 0], v: down, n }, line(bez, "lo") + parts.map((s) => s.glass).join("") + `<g class="a3-disp">${parts.map((s) => s.sym).join("")}</g>`);
    }

    // ---- pedestal between the pilots: KCCUs either side of the thrust levers, engine masters, ECP and RMPs aft
    const pd = { x0: lw.x1, x1: 3.42, hw: 0.25, z1: lw.z1 };
    const ped = solid("cockpit.pedestal", "FD", across([[pd.x0, zm], [pd.x0, pd.z1], [pd.x1, pd.z1], [pd.x1, zm]], -pd.hw, pd.hw), { tone: "mid", material: "gunmetal" });
    {
      // top face: svg x along +x (aft) from x0, y along +y from −hw
      const at = (x, y) => [(x - pd.x0) * 10, (y + pd.hw) * 10];
      let p = "";
      let d = "";
      let k = "";
      // engine master switches: four knobs aft of the thrust levers
      for (let i = 0; i < 4; i++) {
        const [cx, cy] = at(3.0, -0.09 + i * 0.06);
        d += circ(cx, cy, 0.16);
      }
      p += rr(...at(2.94, -0.13), 1.2, 2.6, 0.1);
      // ECAM control panel and two radio management panels
      const [ex, ey] = at(3.1, -0.2);
      p += rr(ex, ey, 1.4, 4.0, 0.1);
      for (let i = 0; i < 6; i++) k += rr(ex + 0.25, ey + 0.35 + i * 0.6, 0.9, 0.35, 0.08);
      for (const y of [-0.2, 0.03]) {
        const [rx, ry] = at(3.26, y);
        p += rr(rx, ry, 1.4, 1.7, 0.1);
        k += rr(rx + 0.2, ry + 0.25, 1.0, 0.45, 0.06) + circ(rx + 0.7, ry + 1.2, 0.22);
      }
      // speed brake (left) and flaps (right) lever slots beside the thrust levers
      for (const s of [-1, 1]) {
        const [lx, ly] = at(2.62, s * 0.2 - 0.012);
        p += rr(lx, ly, 2.8, 0.24, 0.1);
      }
      face(ped, { o: [pd.x0, -pd.hw, pd.z1], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }, line(p, "lo") + line(d, "lo") + fill(k, "a3-scr") + line(k, "faint"));
    }
    // KCCUs: keyboard and trackball either side of the thrust levers
    const kc = { x0: 2.6, x1: 2.92, z1: pd.z1 + 0.035 };
    for (const [s, sign] of W.SIDES) {
      const y0 = sign * 0.075;
      const y1 = sign * 0.235;
      const part = solid(`cockpit.kccu.${s}`, "FD", [[kc.x0, y0, pd.z1], [kc.x0, y1, pd.z1], [kc.x1, y0, pd.z1], [kc.x1, y1, pd.z1], [kc.x0 + 0.02, y0, kc.z1], [kc.x0 + 0.02, y1, kc.z1], [kc.x1, y0, kc.z1], [kc.x1, y1, kc.z1]], { tone: "hi", material: "gunmetal" });
      const ya = Math.min(y0, y1);
      const at = (x, y) => [(x - kc.x0) * 10, (y - ya) * 10];
      let keys = "";
      for (let r = 0; r < 4; r++) for (let c = 0; c < 7; c++) {
        const [kx, ky] = at(2.64 + r * 0.045, ya + 0.012 + c * 0.02);
        keys += rr(kx, ky, 0.36, 0.15, 0.04);
      }
      const [bx, by] = at(2.85, ya + 0.08);
      const ball = circ(bx, by, 0.28) + rr(bx - 0.62, by - 0.62, 1.24, 1.24, 0.2);
      face(part, { o: [kc.x0, ya, kc.z1], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }, line(keys, "faint") + line(ball, "lo"));
    }
    // thrust lever quadrant: a low housing with four slots and the detent scale, and four separate levers standing in their
    // slots (r2, craft-dark and fidelity: one convex bank with four rectangles on its top read as a box). The levers sit at
    // idle (aft) at the gate, each a slim arm leaning aft to its grip; levers 2 and 3 carry the reverse latches (the A380
    // reverses on its inboard engines only, truth §6)
    {
      const q = { x0: 2.6, x1: 2.9, hw: 0.07, h: 0.05 };
      const zq = pd.z1 + q.h;
      const lev = solid("cockpit.levers", "FD", across([[q.x0, pd.z1], [q.x0, zq - 0.015], [q.x0 + 0.02, zq], [q.x1, zq], [q.x1, pd.z1]], -q.hw, q.hw), { tone: "mid", material: "gunmetal" });
      const LY = [-0.054, -0.018, 0.018, 0.054];
      const LW = 0.02;
      // the housing's top: the four slots (fore-aft), the detent ticks across them (TOGA, FLX/MCT, CL, IDLE, REV)
      {
        const at = (x, y) => [(x - q.x0 - 0.02) * 10, (y + q.hw) * 10];
        let slots = "";
        for (const y of LY) {
          const [sx, sy] = at(q.x0 + 0.04, y - 0.006);
          slots += rr(sx, sy, 2.3, 0.12, 0);
        }
        let ticks = "";
        for (const x of [2.66, 2.71, 2.76, 2.82]) {
          // each tick from the housing's side edge inward (one rooted end)
          const [tx, ty] = at(x, -q.hw);
          ticks += seg(tx, ty, tx, ty + 0.06 * 10);
          const [ux, uy] = at(x, q.hw);
          ticks += seg(ux, uy - 0.06 * 10, ux, uy);
        }
        face(lev, { o: [q.x0 + 0.02, -q.hw, zq], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }, fill(slots, "a3-scr") + line(slots, "lo") + line(ticks, "faint"));
      }
      LY.forEach((y, i) => {
        const y0 = y - LW / 2;
        const y1 = y + LW / 2;
        // the arm from its slot (x 2.80-2.83) up and aft to the grip (x 2.83-2.89, 0.10-0.13 m over the housing)
        const pts = across([[2.8, zq], [2.83, zq], [2.89, zq + 0.1], [2.89, zq + 0.13], [2.84, zq + 0.13], [2.81, zq + 0.1]], y0, y1);
        const arm = solid(`cockpit.thr.${i + 1}`, "FD", pts, { tone: "hi", material: "gunmetal" });
        // the grip's top face: its pad, and on levers 2 and 3 the reverse latch (a small lever under the grip's front)
        const top = rr(0.06, 0.04, 0.38, LW * 10 - 0.08, 0);
        face(arm, { o: [2.84, y0, zq + 0.13], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }, line(top, "lo"));
        if (i === 1 || i === 2) {
          // the reverse latch on the arm's front face under the grip (from (2.81, +0.10) down to (2.80, 0))
          const v = W.vec.unit([-0.01, 0, -0.1]);
          const latch = rr(0.03, 0.12, LW * 10 - 0.06, 0.45, 0);
          face(arm, { o: [2.81, y1, zq + 0.1], u: [0, -1, 0], v, n: W.vec.unit([-0.1, 0, 0.01]) }, fill(latch, "a3-uph") + line(latch, "lo"));
        }
      });
    }

    // ---- side consoles with the sidesticks, the tillers and the OIT keyboard tables
    const cs = { x0: 2.62, x1: 3.42, yi: 0.82, yo: 1.08, z1: 6.6 };
    for (const [s, sign] of W.SIDES) {
      const ya = sign * cs.yi;
      const yb = sign * cs.yo;
      const part = solid(`cockpit.console.${s}`, "FD", [[cs.x0, ya, zm], [cs.x0, yb, zm], [cs.x1, ya, zm], [cs.x1, yb, zm], [cs.x0, ya, cs.z1 - 0.06], [cs.x0, yb, cs.z1 - 0.06], [cs.x0 + 0.06, ya, cs.z1], [cs.x0 + 0.06, yb, cs.z1], [cs.x1, ya, cs.z1], [cs.x1, yb, cs.z1]], { tone: "mid", material: "gunmetal" });
      const y0 = Math.min(ya, yb);
      const at = (x, y) => [(x - cs.x0) * 10, (y - y0) * 10];
      let p = "";
      const [tx, ty] = at(2.76, sign * 0.95);
      p += circ(tx, ty, 0.6) + circ(tx, ty, 0.16);
      const [bx, by] = at(2.98, sign * 0.95);
      p += rr(bx - 0.75, by - 0.75, 1.5, 1.5, 0.35);
      // r2 (fidelity): the OIT (onboard information terminal) display stands upright on the console's outboard edge, facing
      // inboard, with its ACD keypad on the console top in front of it; the keyboard table is not here but slides out from
      // under the main panel in front of each pilot (below; FlyByWire A380X, main panel: table and keyboard; EASA OEB:
      // "OIT comprising table keyboard and side console display"). Review round 3 had put both flat on this top face
      const ox = { x0: 3.12, x1: 3.36, t: 0.035, h: 0.19 };
      const [kx, ky] = at(ox.x0 + 0.02, sign * (cs.yo - ox.t - 0.012) - (sign > 0 ? 0.1 : 0));
      let keys = "";
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) keys += rr(kx + 0.2 + r * 0.5, ky + 0.12 + c * 0.3, 0.36, 0.2, 0);
      const kp = rr(kx, ky, 2.2, 1.0, 0.1);
      face(part, { o: [cs.x0, y0, cs.z1], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }, line(p, "lo") + line(kp, "lo") + line(keys, "faint"));
      // the OIT display: a slim upright box standing on the console's outboard edge
      {
        const yi = sign * (cs.yo - ox.t);
        const pts = [];
        for (const x of [ox.x0, ox.x1]) for (const y of [yi, yb]) for (const z of [cs.z1, cs.z1 + ox.h]) pts.push([x, y, z]);
        const box = solid(`cockpit.oit.${s}`, "FD", pts, { tone: "mid", material: "gunmetal" });
        // its inboard face: svg x along aft (u), y down; the screen in a bezel, the menu rows lit with power (a3-isis)
        const L = (ox.x1 - ox.x0) * 10;
        const Hh = ox.h * 10;
        const scr = rr(0.15, 0.15, L - 0.3, Hh - 0.45, 0.1);
        let rows = "";
        for (let r = 0; r < 5; r++) rows += rr(0.45, 0.45 + r * 0.25, (L - 0.9) * (r % 2 ? 0.6 : 0.85), 0.1, 0);
        face(box, { o: [ox.x0, yi, cs.z1 + ox.h], u: [1, 0, 0], v: [0, 0, -1], n: [0, -sign, 0] }, fill(scr, "a3-scr") + line(scr, "lo") + `<g class="a3-isis"><path class="a3-oitr" d="${rows}"/></g>`);
      }
      // sidestick: a tapered post on its boot, leaning forward, and its grip (r2, fidelity: a plain post read as a stick
      // without a hand-hold): a swelling grip with the takeover pushbutton on its top
      const ys = sign * 0.95;
      const stick = [];
      for (const dx of [-0.04, 0.04]) for (const dy of [-0.04, 0.04]) stick.push([2.98 + dx, ys + dy, cs.z1]);
      for (const dx of [-0.026, 0.026]) for (const dy of [-0.024, 0.024]) stick.push([2.965 + dx, ys + dy, cs.z1 + 0.12]);
      solid(`cockpit.stick.${s}`, "FD", stick, { tone: "hi", material: "rubber" });
      {
        const ring = (xc, z, rx, ry) => Array.from({ length: 8 }, (_, i) => {
          const t = (i * Math.PI) / 4 + Math.PI / 8;
          return [xc + rx * Math.cos(t), ys + ry * Math.sin(t), z];
        });
        const g0 = cs.z1 + 0.12;
        const grip = [...[[-0.026, -0.024], [0.026, -0.024], [-0.026, 0.024], [0.026, 0.024]].map(([dx, dy]) => [2.965 + dx, ys + dy, g0]), ...ring(2.958, g0 + 0.06, 0.036, 0.03), ...ring(2.952, g0 + 0.11, 0.03, 0.026)];
        const gp = solid(`cockpit.stick.${s}.grip`, "FD", grip, { tone: "hi", material: "rubber" });
        // the top face (the octagon at g0 + 0.11): the takeover pushbutton (red) outboard and the trigger's guard line
        const zt = g0 + 0.11;
        const tb = circ(0.3 + (sign > 0 ? 0.15 : -0.15), 0.3, 0.1);
        face(gp, { o: [2.922, ys - 0.03, zt], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }, `<path class="a3-tko" d="${tb}"/>` + line(tb, "lo"));
      }
    }
    // the keyboard tables: a thin tray in front of each pilot, under the main panel's lower edge below the PFD and ND, slid
    // out 0.24 m at the gate (its stowed part under the panel's foot, 5 mm below it)
    for (const [s, sign] of W.SIDES) {
      const ya = sign * 0.37;
      const yb = sign * 0.69;
      const tz = { z0: pn.z0 - 0.03, z1: pn.z0 - 0.005 };
      const pts = [];
      for (const x of [pn.xf + 0.02, 2.5]) for (const y of [ya, yb]) for (const z of [tz.z0, tz.z1]) pts.push([x, y, z]);
      const tbl = solid(`cockpit.table.${s}`, "FD", pts, { tone: "mid", material: "gunmetal" });
      // its top, the part slid out from under the panel (x 2.26-2.50): the keyboard and the handle lip
      const y0 = Math.min(ya, yb);
      const at = (x, y) => [(x - pn.xb0) * 10, (y - y0) * 10];
      const [kx, ky] = at(pn.xb0 + 0.03, y0 + 0.05);
      let keys = "";
      for (let r = 0; r < 4; r++) for (let c = 0; c < 10; c++) keys += rr(kx + r * 0.36, ky + c * 0.21, 0.28, 0.16, 0);
      const kb = rr(kx - 0.1, ky - 0.1, 1.55, 2.2, 0.1);
      const lip = rr(at(2.47, 0)[0], 0.2, 0.2, (yb - ya) * sign * 10 - 0.4, 0);
      face(tbl, { o: [pn.xb0, y0, tz.z1], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }, line(kb, "lo") + line(keys, "faint") + line(lip, "faint"));
    }

    // r1 (craft-dark): the seats' aft faces. The Cockpit view looks forward from aft (b 168), so the four seat backs are
    // its biggest objects; they were plain slabs (the upholstery was on the front faces only). Each back now carries its
    // shell's back panel with a seam round it, the harness inertia-reel housing and strap slot under the headrest and a map
    // pocket; the headrest its rear cushion and guide posts; the seat pedestal its access panel and the recline and track
    // levers. All closed shapes in the cavity line tones, so the cabin dimmer reaches them.
    /** The aft face of a back: a trapezoid from half-width hwTop (m) at its top edge to hwBot at its foot, len (m) long. */
    const backAft = (part, o, v, hwTop, hwBot, len) => {
      const L = len * 10;
      const c = hwTop * 10;
      const half = (t) => (hwTop + (hwBot - hwTop) * (t / L)) * 10;
      const tz = (t, d) => [[c - half(t) + d, t], [c + half(t) - d, t]];
      const [a0, b0] = tz(0.35, 0.35);
      const [a1, b1] = tz(L - 0.35, 0.35);
      const seam = poly([a0, b0, b1, a1]);
      const reel = rr(c - 0.75, 0.75, 1.5, 0.95, 0.25) + rr(c - 0.95, 1.95, 1.9, 0.24, 0.1);
      const p0 = L * 0.56;
      const p1 = L - 0.75;
      const [q0, r0] = tz(p0, 0.75);
      const [q1, r1] = tz(p1, 0.75);
      const pocket = poly([q0, r0, r1, q1]) + rr(q0[0] + 0.1, p0 + 0.25, r0[0] - q0[0] - 0.2, 0.3, 0.1);
      const n = W.vec.unit(W.vec.cross([0, -1, 0], v));
      face(part, { o, u: [0, -1, 0], v, n }, line(seam, "faint") + line(reel, "lo") + line(pocket, "lo"));
    };
    /** The headrest's vertical aft face (half-width hw, h m tall) and a pedestal's aft face (levers, access panel). */
    const headAft = (part, o, hw, h) => {
      const w = hw * 20;
      face(part, { o, u: [0, -1, 0], v: [0, 0, -1], n: [1, 0, 0] }, line(rr(0.3, 0.2, w - 0.6, h * 10 - 0.75, 0.4), "faint") + line(rr(w / 2 - 0.85, h * 10 - 0.4, 0.3, 0.3, 0.06) + rr(w / 2 + 0.55, h * 10 - 0.4, 0.3, 0.3, 0.06), "lo"));
    };
    const pedAft = (part, top, foot, yc, hw) => {
      const v = W.vec.unit([foot[0] - top[0], 0, foot[1] - top[1]]);
      const L = Math.hypot(foot[0] - top[0], foot[1] - top[1]) * 10;
      const w = hw * 20;
      const panel = rr(0.4, 1.2, w - 0.8, L - 1.6, 0.2);
      const levers = rr(0.5, 0.25, 0.9, 0.55, 0.2) + rr(w - 1.6, 0.3, 1.1, 0.35, 0.15);
      face(part, { o: [top[0], yc + hw, top[1]], u: [0, -1, 0], v, n: W.vec.unit(W.vec.cross([0, -1, 0], v)) }, line(panel, "faint") + line(levers, "lo"));
    };

    // ---- pilot seats: the backrest's front surface passes 0.20 m behind the design eye point (T3)
    const seat = { xf: 2.56, xb: 3.06, z1: 6.4, recline: 12, backTop: 7.02, backT: 0.09, hw: 0.24 };
    const backFront = (z) => EYE[0] + 0.2 + (z - EYE[2]) * Math.tan((seat.recline * Math.PI) / 180);
    for (const [s, sign] of W.SIDES) {
      const yc = sign * EYE[1];
      const ya = yc - seat.hw;
      const yb = yc + seat.hw;
      // the seat pan (full width, its front rounded) on a narrower pedestal: two parts (review round 3: one hull of the
      // cushion and the pedestal read as a plain slab)
      const cushion = across([[seat.xf, seat.z1 - 0.05], [seat.xf + 0.03, seat.z1 - 0.01], [seat.xf + 0.1, seat.z1], [seat.xb, seat.z1], [seat.xb, seat.z1 - 0.12], [seat.xf + 0.03, seat.z1 - 0.12]], ya, yb);
      const zg = zm + (SPLIT ? W.GAP : 0); // a seat in its own group stands W.GAP over the mat
      const sg = `cockpit.seat.${s}`;
      const pedProf = [[seat.xf + 0.12, zg], [seat.xf + 0.16, seat.z1 - 0.12], [seat.xb - 0.06, seat.z1 - 0.12], [seat.xb - 0.02, zg]];
      const pedPart = solid(`cockpit.seat.${s}.ped`, "FD", across(pedProf, yc - 0.13, yc + 0.13), { tone: "lo", material: "gunmetal", group: sg });
      pedAft(pedPart, pedProf[2], pedProf[3], yc, 0.13);
      const base = solid(`cockpit.seat.${s}`, "FD", cushion, { tone: "mid", material: "rubber", group: sg });
      const bf0 = backFront(seat.z1);
      const bf1 = backFront(seat.backTop);
      const backProf = [[bf0, seat.z1], [bf1, seat.backTop - 0.03], [bf1 + 0.04, seat.backTop], [bf1 + seat.backT, seat.backTop], [bf0 + seat.backT, seat.z1]];
      // the backrest tapers from the shoulders (±0.23 m) to the headrest (±0.16 m)
      const backPts = backProf.flatMap(([x, z]) => {
        const hw = z > seat.z1 + 0.4 ? 0.16 + (0.07 * (seat.backTop - z)) / (seat.backTop - seat.z1 - 0.4) : 0.23;
        return [[x, yc - Math.min(0.23, hw), z], [x, yc + Math.min(0.23, hw), z]];
      });
      const back = solid(`cockpit.back.${s}`, "FD", backPts, { tone: "mid", material: "rubber", group: sg });
      // the headrest: a separate cushion on the back's top, narrower, its top rounded
      {
        const x0 = bf1 + 0.015;
        const x1 = bf1 + seat.backT;
        const z0 = seat.backTop;
        const pts = [];
        for (const [x, z, hw] of [[x0, z0, 0.13], [x1, z0, 0.13], [x0 + 0.01, z0 + 0.15, 0.13], [x1, z0 + 0.15, 0.13], [x0 + 0.025, z0 + 0.19, 0.1], [x1 - 0.01, z0 + 0.19, 0.1]]) pts.push([x, yc - hw, z], [x, yc + hw, z]);
        const head = solid(`cockpit.head.${s}`, "FD", pts, { tone: "mid", material: "rubber", group: sg });
        face(head, { o: [x0 + 0.01, yc - 0.13, z0 + 0.15], u: [0, 1, 0], v: W.vec.unit([-0.01, 0, -0.15]), n: [-1, 0, 0.07] }, cush(rr(0.3, 0.2, 2.0, 1.2, 0.45), "faint"));
        headAft(head, [x1, yc + 0.13, z0 + 0.15], 0.13, 0.15);
      }
      REC.eye.push({ side: s, eye: [backFront(EYE[2]) - 0.2, yc, EYE[2]], seatY: yc });
      // cushion outline on the base top; backrest, headrest and harness on the back's front face
      {
        const at = (x, y) => [(x - seat.xf - 0.12) * 10, (y - ya) * 10];
        const [cx, cy] = at(seat.xf + 0.16, ya + 0.04);
        face(base, { o: [seat.xf + 0.12, ya, seat.z1], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }, fill(rr(cx, cy, (bf0 - seat.xf - 0.2) * 10, (seat.hw * 2 - 0.08) * 10, 0.6)) + line(rr(cx, cy, (bf0 - seat.xf - 0.2) * 10, (seat.hw * 2 - 0.08) * 10, 0.6), "faint"));
        const down = W.vec.unit([bf0 - bf1, 0, seat.z1 - (seat.backTop - 0.03)]);
        const len = Math.hypot(bf0 - bf1, seat.z1 - seat.backTop + 0.03) * 10;
        const n = W.vec.unit([seat.backTop - 0.03 - seat.z1, 0, bf0 - bf1]);
        // the front face is a trapezoid: half-width 0.17 m at its top edge, 0.23 m at the cushion
        const hwTop = backPts[2][1] - yc;
        const halfAt = (v) => (Math.abs(hwTop) + (0.23 - Math.abs(hwTop)) * (v / len)) * 10;
        const c0 = 2.3;
        let d = rr(c0 - 1.3, 0.3, 2.6, 1.6, 0.5); // headrest
        const cushPts = [[c0 - halfAt(2.3) + 0.35, 2.3], [c0 + halfAt(2.3) - 0.35, 2.3], [c0 + halfAt(len - 0.3) - 0.35, len - 0.3], [c0 - halfAt(len - 0.3) + 0.35, len - 0.3]];
        d += poly(cushPts); // backrest cushion
        const harness = line(seg(c0 - 0.6, 0, c0 - 1.0, len) + seg(c0 + 0.6, 0, c0 + 1.0, len), "faint");
        face(back, { o: [bf1, yc - 0.23, seat.backTop - 0.03], u: [0, 1, 0], v: down, n: [-Math.abs(n[0]), 0, Math.abs(n[2])] }, cush(d) + harness);
        // the aft face: from (bf1 + T, backTop) at ±0.16 down to (bf0 + T, z1) at ±0.23
        const aftV = W.vec.unit([bf0 - bf1, 0, seat.z1 - seat.backTop]);
        backAft(back, [bf1 + seat.backT, yc + 0.16, seat.backTop], aftV, 0.16, 0.23, Math.hypot(bf0 - bf1, seat.z1 - seat.backTop));
      }
      // armrests: bars whose aft faces lie in the backrest's front plane (flush)
      for (const [t, yy] of [["in", yc - sign * (seat.hw - 0.04)], ["out", yc + sign * (seat.hw - 0.04)]]) {
        const z0 = 6.62;
        const z1 = 6.67;
        const pts = [];
        for (const dy of [-0.025, 0.025]) pts.push([2.78, yy + dy, z0], [2.78, yy + dy, z1], [backFront(z0), yy + dy, z0], [backFront(z1), yy + dy, z1]);
        solid(`cockpit.arm.${s}.${t}`, "FD", pts, { tone: "hi", material: "rubber", group: sg });
      }
    }
    fd.seat = seat;

    // ---- observer seats behind the pilots: a cushion on a pedestal and a tapered, upholstered backrest
    for (const [s, sign] of W.SIDES) {
      const yc = sign * 0.66;
      const ob = { xf: 3.98, xb: 4.42, z1: 6.42, top: 6.98, hw: 0.22, t: 0.08, lean: 0.1 };
      const cushion = across([[ob.xf, ob.z1 - 0.05], [ob.xf + 0.03, ob.z1 - 0.01], [ob.xf + 0.08, ob.z1], [ob.xb, ob.z1], [ob.xb, ob.z1 - 0.12], [ob.xf + 0.02, ob.z1 - 0.12]], yc - ob.hw, yc + ob.hw);
      const og = `cockpit.obs.${s}`;
      const zg = zm + (SPLIT ? W.GAP : 0);
      const obPed = [[ob.xf + 0.12, zg], [ob.xf + 0.15, ob.z1 - 0.12], [ob.xb - 0.09, ob.z1 - 0.12], [ob.xb - 0.06, zg]];
      const obPedPart = solid(`cockpit.obs.${s}.ped`, "FD", across(obPed, yc - 0.12, yc + 0.12), { tone: "lo", material: "gunmetal", group: og });
      pedAft(obPedPart, obPed[2], obPed[3], yc, 0.12);
      const base = solid(`cockpit.obs.${s}`, "FD", cushion, { tone: "mid", material: "rubber", group: og });
      const bf0 = ob.xb - ob.t;
      const bf1 = bf0 + ob.lean;
      const backPts = [];
      for (const [x, z, hw] of [[bf0, ob.z1, ob.hw], [bf0 + ob.t, ob.z1, ob.hw], [bf1, ob.top - 0.03, 0.15], [bf1 + 0.03, ob.top, 0.15], [bf1 + ob.t, ob.top, 0.15]]) backPts.push([x, yc - hw, z], [x, yc + hw, z]);
      const back = solid(`cockpit.obsback.${s}`, "FD", backPts, { tone: "mid", material: "rubber", group: og });
      // cushion on the base top, backrest and headrest on the back's front face
      face(base, { o: [ob.xf + 0.08, yc - ob.hw, ob.z1], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }, cush(rr(0.3, 0.4, (bf0 - ob.xf - 0.14) * 10, (ob.hw * 2 - 0.08) * 10, 0.5), "faint"));
      const down = W.vec.unit([bf0 - bf1, 0, ob.z1 - (ob.top - 0.03)]);
      const len = Math.hypot(bf0 - bf1, ob.z1 - ob.top + 0.03) * 10;
      const n = W.vec.unit([ob.top - 0.03 - ob.z1, 0, bf0 - bf1]);
      const halfAt = (v) => (0.15 + (ob.hw - 0.15) * (v / len)) * 10;
      const c0 = ob.hw * 10;
      const d = rr(c0 - 1.1, 0.3, 2.2, 1.3, 0.4) + poly([[c0 - halfAt(2.0) + 0.35, 2.0], [c0 + halfAt(2.0) - 0.35, 2.0], [c0 + halfAt(len - 0.3) - 0.35, len - 0.3], [c0 - halfAt(len - 0.3) + 0.35, len - 0.3]]);
      face(back, { o: [bf1, yc - ob.hw, ob.top - 0.03], u: [0, 1, 0], v: down, n: [-Math.abs(n[0]), 0, Math.abs(n[2])] }, cush(d) + line(seg(c0 - 0.5, 0, c0 - 0.8, len) + seg(c0 + 0.5, 0, c0 + 0.8, len), "faint"));
      // the aft face: from (bf1 + t, top) at ±0.15 down to (bf0 + t, z1) at ±hw
      backAft(back, [bf1 + ob.t, yc + 0.15, ob.top], W.vec.unit([bf0 - bf1, 0, ob.z1 - ob.top]), 0.15, ob.hw, Math.hypot(bf0 - bf1, ob.z1 - ob.top));
    }

    // ---- the rear bulkhead (review round 3): the deck's aft wall at x 5.40-5.56 with the reinforced flight-deck door,
    // and a coat and stowage block either side of it, on their own free group (to 8.39 m: the canopy is 2.4 m up)
    {
      const top = W.CUT.FD.cut + AFT_SYNC / W.UNIT - 0.02;
      const za = zm + (SPLIT ? W.GAP : 0);
      const zs = [za, 6.6, 7.0, 7.4, 7.8, 8.1, top];
      const inner = (x, z) => Math.min(WQ.ringY(x, z), WQ.ringY(x, Math.min(z + 0.02, top))) - 0.06;
      const ring = (x) => zs.flatMap((z) => [[x, -inner(x, z), z], [x, inner(x, z), z]]);
      const bx0 = 5.4;
      const bx1 = 5.56;
      const bh = solid(`${AFT_GROUP}.bulkhead`, "FD", [...ring(bx0), ...ring(bx1)], { tone: "mid", material: "steel", group: AFT_GROUP, top });
      // the door on its forward face: the leaf, viewer, kick plate, decompression panels, handle and keypad
      const H = (top - za) * 10;
      const dh = (8.0 - za) * 10;
      let d = rr(-4.5, H - dh, 9.0, dh, 0.6);
      d += rr(-0.7, H - dh + 4.0, 1.4, 1.0, 0.2) + rr(-3.6, H - 3.2, 7.2, 2.4, 0.3) + rr(-3.5, H - dh + 7.0, 7.0, 4.0, 0.3) + rr(-3.5, H - dh + 11.5, 7.0, 4.0, 0.3);
      const hdl = rr(2.9, H - dh + 9.6, 0.5, 1.6, 0.2) + rr(3.1, H - dh + 6.8, 0.9, 1.4, 0.15);
      // the frame of the wall panels either side of the door
      let pan = "";
      for (const sgn of [-1, 1]) pan += rr(sgn < 0 ? -15.5 : 5.6, H - 15.5, 9.9, 13.5, 0.4);
      face(bh, { o: [bx0, 0, top], u: [0, 1, 0], v: [0, 0, -1], n: [-1, 0, 0] }, line(d, "lo") + line(hdl, "lo") + line(pan, "faint"));
      // stowage and the coat cupboard: blocks against the bulkhead's forward face, outboard of the door
      for (const [sname, sign] of W.SIDES) {
        const sx0 = 5.02;
        const sx1 = bx0 - 0.012;
        const st = 7.45;
        const yi = 0.85;
        const pts = [];
        for (const x of [sx0, sx1]) for (const z of [za, 6.6, 7.0, st]) pts.push([x, sign * yi, z], [x, sign * Math.min(inner(x, z), inner(x, Math.min(st, z + 0.3))), z]);
        const blk = solid(`${AFT_GROUP}.stow.${sname}`, "FD", pts, { tone: "mid", material: "steel", group: `${AFT_GROUP}.${sname}`, top });
        const w = (Math.min(inner(sx0, 6.6), inner(sx0, 7.0)) - yi) * 10;
        const hh = (st - za) * 10;
        const y0 = sign < 0 ? -yi - w / 10 : yi;
        face(blk, { o: [sx0, y0, st], u: [0, 1, 0], v: [0, 0, -1], n: [-1, 0, 0] }, line(rr(0.4, 0.4, w - 0.8, hh * 0.45, 0.3) + rr(0.4, hh * 0.5, w - 0.8, hh * 0.46, 0.3), "lo") + line(circ(sign < 0 ? w - 1.0 : 1.0, hh * 0.47, 0.18), "lo"));
      }
      ctx.label(`${AFT_GROUP}.bulkhead`, "Flight-deck rear bulkhead · reinforced, lockable door to the crew area", "inspect:cockpit");
      ctx.label(`${AFT_GROUP}.stow`, "Coat and stowage cupboards · against the rear bulkhead", "inspect:cockpit");
    }

    // ---- the aft bulkhead's door (nose.fwd's front face at x 5.65: M2's part, a plane resolved last)
    {
      const o = [5.65, -0.45, 7.97];
      const h = (7.97 - 6.02) * 10;
      let d = rr(0, 0, 9.0, h, 0.6); // door leaf outline
      d += rr(3.8, 4.0, 1.4, 1.0, 0.2); // viewer
      d += rr(0.9, h - 3.2, 7.2, 2.4, 0.3); // kick plate
      d += rr(1.0, 7.0, 7.0, 4.0, 0.3) + rr(1.0, 11.5, 7.0, 4.0, 0.3); // decompression panels
      const handle = rr(7.4, 9.6, 0.5, 1.6, 0.2) + rr(7.6, 6.8, 0.9, 1.4, 0.15); // handle and keypad
      ctx.planeOn("nose.fwd", { o: K(o), u: KD([0, 1, 0]), v: KD([0, 0, -1]), normal: KD([-1, 0, 0]), svg: line(d, "lo") + line(handle, "lo") });
    }

    // ---- GL targets: the 8 display planes (cockpit program, DESIGN §6.2)
    REC.displays.forEach((dsp, i) => {
      ctx.glTarget({ name: `cockpit.disp.${i + 1}`, part: dsp.row === "upper" ? "cockpit.panel" : "cockpit.lower", group: "cockpit", kind: "panel", constants: { screen: dsp.kind, side: dsp.side, row: dsp.row, centre: K(dsp.centre), u: KD([0, 1, 0]), v: KD(W.vec.unit(W.vec.cross(dsp.n, [0, 1, 0]))), n: KD(dsp.n), w: W.m(dsp.w), h: W.m(dsp.h) } });
    });

    // ---- labels, accent, inspect view
    ctx.label("cockpit.panel", "Main instrument panel · PFD, ND, EWD, ND, PFD (five of the eight 6 × 8 in LCDs) · the two ISIS · gear lever, autobrake and clock right of the EWD · keyboard tables under it", "inspect:cockpit");
    ctx.label("cockpit.lower", "Lower centre panel · MFD, SD, MFD", "inspect:cockpit");
    ctx.label("cockpit.glareshield", "Glareshield · FCU and both EFIS control panels", "inspect:cockpit");
    ctx.label("cockpit.pedestal", "Pedestal · engine masters, ECAM control and radio panels", "inspect:cockpit");
    ctx.label("cockpit.levers", "Thrust lever quadrant · four levers, one per Trent 970, at idle · detents TOGA, FLX/MCT, CL", "inspect:cockpit");
    ctx.label("cockpit.thr", "Thrust lever · one per Trent 970; levers 2 and 3 carry the reverse latches (reversers on the inboard engines only)", "inspect:cockpit");
    ctx.label("cockpit.kccu", "KCCU · keyboard and trackball for the MFD and ND", "inspect:cockpit");
    ctx.label("cockpit.console", "Side console · sidestick, tiller, OIT display and its keypad", "inspect:cockpit");
    ctx.label("cockpit.stick", "Sidestick · on the outboard console, not linked · takeover pushbutton on the grip", "inspect:cockpit");
    ctx.label("cockpit.oit", "OIT display · onboard information terminal, upright on the side console, its keypad in front", "inspect:cockpit");
    ctx.label("cockpit.table", "Keyboard table · slides out from under the PFD and ND, in front of each pilot (the sidesticks leave the space free)", "inspect:cockpit");
    ctx.label("cockpit.seat", "Pilot seat · design eye 2.92 m from the nose, 7.17 m up", "inspect:cockpit");
    ctx.label("cockpit.back", "Pilot seat · design eye 2.92 m from the nose, 7.17 m up", "inspect:cockpit");
    ctx.label("cockpit.arm", "Pilot seat armrest", "inspect:cockpit");
    ctx.label("cockpit.head", "Pilot seat headrest", "inspect:cockpit");
    ctx.label("cockpit.obs", "Observer seat · two behind the pilots", "inspect:cockpit");
    ctx.label("cockpit.mat", "Flight deck · 8 displays · sidesticks · 2 pilots and 2 observers", "inspect:cockpit");
    // the cabin accent: a lit rule round the flight-deck mat (its root fades with the cockpit)
    {
      const x0 = B.xa + 0.12;
      const x1 = B.xb - 0.08;
      const pts = [[x0, -(WQ.ringY(x0, B.floor) - 0.14)], [x1, -(WQ.ringY(x1, B.floor) - 0.14)], [x1, WQ.ringY(x1, B.floor) - 0.14], [x0, WQ.ringY(x0, B.floor) - 0.14]];
      // r1 (craft-dark): a faint rule (class a3-acc-fd): lit, it was the brightest line of the Cockpit view (p99.5 172 against
      // the EWD's 185), outlining the floor instead of the displays, which are the view's one lit accent
      ctx.accent("cabin", { part: matPart, o: K([0, 0, zm]), u: KD([1, 0, 0]), v: KD([0, 1, 0]), normal: KD([0, 0, 1]), svg: `<path class="a3-acc-fd" d="${poly(pts.map(([x, y]) => [x * 10, y * 10]))}"/>` });
    }
    // b 125, not DESIGN's 180: from directly aft every sightline into the flight deck hits nose.fwd's front
    // face (x 5.65 m, up to 9.53 m) at the fixed 30° elevation; the open sides of the lifted canopy show the
    // panel, the displays (10-15 px at 1440), the pedestal and the seats from the aft quarter (requests/M7.md I1)
    // from ahead and to starboard (from aft the fuselage hides the nose), closer than before and centred on the
    // deck; the lifted canopy fades (a3-fade-fd) so the displays, sidesticks, KCCUs and seats read (review round 1)
    // review round 2: from the aft quarter (b 168), centred on the deck (2.6, 0, 6.6) at 12x, with the forward fuselage
    // aft of the flight deck (nose.fwd, the M1 doors) faded with the canopy (build.mjs INSPECT_FADE a3-fade-fd): the
    // panel faces the reader and the deck fills about half the plate (at b 125 the near nose shell covered 41-46%)
    // review round 3: centred forward and up (2.75, 0, 6.85) at 13x, so the panel, seats and consoles fill the frame and
    // less of the bare aft floor and the floor structure's aft face shows
    // follow-up (item 4, capture 2026-10-10): bare floor filled the lower half at 13x; at 24x, centred over the observer
    // seats (3.55, 0, 6.6), the frame runs from the glareshield to the aft floor and the deck covers 68% of it (verify page)
    // r1 (craft-dark, fidelity): at 24x over the observer seats the bare floor was the frame's largest and lightest mass;
    // centred 0.5 m forward and 0.2 m up (3.05, 0, 6.82) at 30x, the glareshield, the eight displays, the pedestal, the
    // four seats and both consoles fill the frame (the consoles reach its sides) and the aft floor drops out
    const VIEW = { centre: [3.05, 0, 6.82], zoom: 30, elevation: COCKPIT_ELEVATION };
    ctx.inspect({ id: "cockpit", label: "Cockpit", centre: VIEW.centre, kit: K(VIEW.centre), panel: [fd.panelX, 0, 6.575], group: "cockpit", bearing: 168, zoom: VIEW.zoom, cutaway: 1, elevation: VIEW.elevation });
    ctx.vary("a3-fd", `F.smooth(${W.COCKPIT_SYNC}, 20, F.tableAt(${JSON.stringify(W.CUTS["cut.fd"].table)}, ch.cabin || 0, "smooth"))`);
    // r2: the standby instruments, the gear lamps and the OIT menu light with the deck's power alone (no GL program draws them)
    ctx.vary("a3-isis", "Math.max(s.apu || 0, Math.min(1, Math.max(...(s.n1 || [0])) / 15))");
    ctx.vary("a3-disp", "(() => { const p = Math.max(s.apu || 0, Math.min(1, Math.max(...(s.n1 || [0])) / 15)); const gl = A3GL.layers.air && A3GL.layers.air.some((e) => e.id === \"cockpit\") ? pv.glShare : 0; return p * (1 - gl); })()");
    // every cockpit part fades as a whole: its root <g> takes the vary class a3-fd before the painters mount
    ctx.script(`for (const el of document.querySelectorAll('.a3-stage [data-name^="cockpit."]:not([data-name^="${AFT_GROUP}."]):not([data-name^="cockpit.ws."])')) el.classList.add("a3-fd");`);
    // Parked cost (requests/M7.md S4): while every M7 group is parked, the order solver's free list and its
    // planar pairs leave M7's parts out (parked parts are 10 km up and need no relations). The lists are
    // switched inside the same controller.set() call that parks or syncs them, so no frame is ordered with a
    // stale list; they are looked up per call (the runtime re-prepares its scene on resize).
    const m7Groups = ["cabin", "cockpit", ...AFT_GROUPS, ...binGroups(W).map((b) => b.group), ...(SPLIT ? [...SPLIT_GROUPS, ...SPLIT_COCKPIT] : [])];
    ctx.script(`(() => {
  const groups = new Set(${JSON.stringify(m7Groups)});
  const names = [...groups];
  const lists = new WeakMap(); // airframe layer object -> its full and lean lists (the runtime re-prepares its scene on resize)
  const listsOf = (c) => {
    const scene = c.scene();
    const layer = scene.layers.find((l) => l.name === "airframe");
    if (!layer || !layer.free) return null;
    let e = lists.get(layer);
    if (!e) {
      const mine = new Set(scene.groups.map((g, i) => (groups.has(g.name) ? i : -1)).filter((i) => i >= 0));
      const isMine = (global) => mine.has(scene.runs[global].group);
      // same-group planar pairs of parked parts would still add order edges (they overlap one another up there)
      const keep = [];
      const P = layer.planar;
      // planar entries are [global i, global j, nx, ny, nz] (the runtime reads frames[i] and local.get(i))
      for (let p = 0; p + 4 < P.length; p += 5) if (!isMine(P[p]) && !isMine(P[p + 1])) for (let k = 0; k < 5; k++) keep.push(P[p + k]);
      e = { layer, full: layer.free, lean: Int32Array.from([...layer.free].filter((i) => !isMine(i))), planarFull: P, planarLean: Float64Array.from(keep) };
      lists.set(layer, e);
    }
    return e;
  };
  let held = null;
  Object.defineProperty(A3, "controller", { configurable: true, enumerable: true, get: () => held, set(c) {
    held = c;
    if (!c || typeof c.scene !== "function") return;
    const pick = (values) => {
      if (!values || typeof values !== "object" || !names.every((g) => g in values)) return;
      const e = listsOf(c);
      if (!e) return;
      const parked = names.every((g) => values[g] && values[g].t && values[g].t[2] >= 1e4);
      e.layer.free = parked ? e.lean : e.full;
      e.layer.planar = parked ? e.planarLean : e.planarFull;
    };
    const base = c.set.bind(c);
    c.set = (values, options) => (pick(values), base(values, options));
    // tools (drive, turn-check) set values through window.__isoTurn, which calls the runtime's set directly
    const iso = typeof window !== "undefined" ? window.__isoTurn : null;
    if (iso && iso.controller === c && typeof iso.set === "function") {
      const toolSet = iso.set.bind(iso);
      iso.set = (next, ...rest) => (pick(next), toolSet(next, ...rest));
    }
  } });
})();`);
    // ITERATION ONLY, off by default (requests/M7.md S2): at rest (free group null) the cockpit sits inside the
    // closed canopy, a pose no state reaches, so the kit audit reports `sunk nose.canopy × cockpit.*` and stops
    // before the orbit audit. M7_KITREST=owner files the cockpit's recorded shapes under nose.canopy so the
    // orbit audit can run while S decides how the rest pose of a sync-ruled free group is audited.
    if (typeof process !== "undefined" && process.env.M7_KITREST === "owner") for (const p of REC.parts) if (p.bay === "FD") for (const sh of ctx.part(p.name).shapes) sh.owner = "nose.canopy";
    REC.seats.FD = 4;
  }

  /**
   * A display's glass and its fallback symbology (class a3-disp), in plane units (dm), portrait. Follow-up item 4: the
   * fallback draws what the GL cockpit program draws (gl/shaders.mjs screenOf), in the same display units: q in
   * [−.5, .5]², q.y up the screen, so the two painters show the same picture (they differed screen by screen).
   */
  function display(kind, x, y, w, h) {
    PREC = 2;
    const glass = fill(rr(x, y, w, h, 0.08), "a3-scr");
    // the fallback's own glass, inside the symbology group (faded out under GL): in dark the GL program adds its glow over
    // the base glass, so the fallback needs the sum (r1: glass within a few levels between the painters in both themes)
    const glassFb = `<path class="a3-scrfb" d="${rr(x, y, w, h, 0.08)}"/>`;
    const X = (qx) => x + (qx + 0.5) * w;
    const Y = (qy) => y + (0.5 - qy) * h;
    const P = (pts) => `M${pts.map(([qx, qy]) => `${f2(X(qx))} ${f2(Y(qy))}`).join("L")}Z`;
    const S = (a, b) => `M${f2(X(a[0]))} ${f2(Y(a[1]))}L${f2(X(b[0]))} ${f2(Y(b[1]))}`;
    const band = (x0, x1, y0, y1) => P([[x0, y1], [x1, y1], [x1, y0], [x0, y0]]);
    let sym = glassFb;
    const L = (d, cls = "") => `<path${cls ? ` class="${cls}"` : ""} data-free="" d="${d}"/>`;
    if (kind === "PFD") {
      // sky over ground split by the banked horizon (q.y = .08 q.x), dark tapes outside |q.x| .32, the horizon, the wings
      sym += `<path class="a3-sky" d="${P([[-0.32, 0.5], [0.32, 0.5], [0.32, 0.0256], [-0.32, -0.0256]])}"/>`;
      sym += `<path class="a3-gnd" d="${P([[-0.32, -0.0256], [0.32, 0.0256], [0.32, -0.5], [-0.32, -0.5]])}"/>`;
      // r2 (craft-dark): the pitch ladder's 5 and 10 degree rungs (parallel to the horizon), before the tapes as in GL
      let lad = "";
      for (const [k, hw] of [[0.1, 0.06], [-0.1, 0.06], [0.2, 0.1], [-0.2, 0.1]]) lad += S([-hw, k - 0.08 * hw], [hw, k + 0.08 * hw]);
      sym += L(lad, "a3-hi");
      sym += `<path class="a3-tape" d="${band(-0.5, -0.32, -0.5, 0.5) + band(0.32, 0.5, -0.5, 0.5)}"/>`;
      sym += L(S([-0.32, -0.0256], [0.32, 0.0256]), "a3-hi");
      // the tapes' ticks every 0.1 on their inner edges and the yellow index across both, the bold aircraft symbol
      let tk = "";
      for (let n = -4; n <= 4; n++) tk += S([-0.37, n / 10], [-0.32, n / 10]) + S([0.32, n / 10], [0.37, n / 10]);
      sym += L(tk, "a3-hi");
      sym += L(S([-0.5, 0], [-0.32, 0]) + S([0.32, 0], [0.5, 0]), "a3-amb");
      sym += `<path class="a3-ambf" d="${band(-0.16, -0.05, -0.016, 0.016) + band(0.05, 0.16, -0.016, 0.016) + band(-0.015, 0.015, -0.015, 0.015)}"/>`;
    } else if (kind === "ND") {
      // the compass arc (radius .62 about (0, −.32), cut by the screen's sides) and the green route
      const a = Math.sqrt(0.62 * 0.62 - 0.25) - 0.32;
      sym += L(`M${f2(X(-0.5))} ${f2(Y(a))}A${f2(0.62 * w)} ${f2(0.62 * h)} 0 0 1 ${f2(X(0.5))} ${f2(Y(a))}`, "a3-hi");
      sym += L(S([0.003, -0.3], [0.108, 0.4]), "a3-g");
      // f4-interiors (review f3, craft-dark: the ND was a bare arc and one line): the rose's ticks every 10° (every 30°
      // longer) inside the arc, the heading box inside it with its three digits, the yellow lubber line from the arc to the
      // box and the yellow aircraft symbol at the rose's centre (the base); gl/shaders.mjs screenOf draws the same
      let rose = "";
      for (let k = -5; k <= 5; k++) {
        const t = (k * 10 * Math.PI) / 180;
        const len = k % 3 === 0 ? 0.06 : 0.035;
        rose += S([0.62 * Math.sin(t), 0.62 * Math.cos(t) - 0.32], [(0.62 - len) * Math.sin(t), (0.62 - len) * Math.cos(t) - 0.32]);
      }
      // the heading box inside the rose under the lubber (above the arc the glareshield hides the screen's top from the view)
      rose += P([[-0.06, 0.235], [0.06, 0.235], [0.06, 0.145], [-0.06, 0.145]]);
      for (const dx of [-0.03, 0, 0.03]) rose += S([dx - 0.009, 0.19], [dx + 0.009, 0.19]);
      sym += L(rose, "a3-hi");
      sym += L(S([0, 0.3], [0, 0.235]) + S([0, -0.4], [0, -0.24]) + S([-0.075, -0.3], [0.075, -0.3]) + S([-0.03, -0.385], [0.03, -0.385]), "a3-amb");
    } else if (kind === "EWD") {
      // four N1 dials in a row (q.y .24), each with its needle, and the green memo rows under them
      for (let i = 0; i < 4; i++) {
        const cx = -0.375 + i * 0.25;
        const rx = 0.085 * w;
        const ry = (0.085 / 0.76) * h;
        sym += L(`M${f2(X(cx) - rx)} ${f2(Y(0.24))}a${f2(rx)} ${f2(ry)} 0 1 0 ${f2(2 * rx)} 0a${f2(rx)} ${f2(ry)} 0 1 0 ${f2(-2 * rx)} 0Z`, "a3-hi");
        sym += L(S([cx, 0.24], [cx - 0.0686, 0.24 + 0.0542]), "a3-hi");
      }
      let m = "";
      for (let n = -7; n <= -3; n++) m += band(-0.4, 0.2, (n + 0.5) / 14, Math.min((n + 1) / 14, -0.12));
      sym += `<path class="a3-gf" d="${m}"/>`;
    } else if (kind === "SD") {
      // the synoptic: four green rules (q.y ±.1, ±.3) and the centre line
      let d = "";
      for (const qy of [-0.3, -0.1, 0.1, 0.3]) d += S([-0.35, qy], [0.35, qy]);
      d += S([0, -0.3], [0, 0.3]);
      sym += L(d, "a3-g");
    } else {
      // MFD: cyan text rows (q.x −.43 to .33, |q.y| < .42)
      let d = "";
      for (let n = -5; n <= 4; n++) d += band(-0.43, 0.33, (n + 0.55) / 11, Math.min((n + 1) / 11, 0.42));
      sym += `<path class="a3-cf" d="${d}"/>`;
    }
    PREC = 1;
    return { glass, sym };
  }

  // ---------------------------------------------------------------------------------------------
  // the cabin bays (group cabin)
  // ---------------------------------------------------------------------------------------------
  function buildCabin() {
    const zones = {
      F: M.CABIN.decks.main.zones.find((z) => z.cls === "F"),
      M: M.CABIN.decks.main.zones.find((z) => z.cls === "Y"),
      U: M.CABIN.decks.upper.zones.find((z) => z.cls === "J" && z.x[0] <= W.CUT.U.x[1] && z.x[1] >= W.CUT.U.x[0]),
      UY: M.CABIN.decks.upper.zones.find((z) => z.cls === "Y"),
    };
    const layouts = { F: M.CABIN.decks.main.layoutY.F, M: M.CABIN.decks.main.layoutY.Y, U: M.CABIN.decks.upper.layoutY.J, UY: M.CABIN.decks.upper.layoutY.Y };
    const classOf = { F: "F", U: "J", M: "Y", UY: "Y" };
    const deckView = { F: "first", U: "upper", M: "main", UY: "upper" };
    const totals = { F: 22, J: 96, Y: 437 };
    const names = { F: "First", J: "Business", Y: "Economy" };
    const galleyX = M.CABIN.decks.main.monuments.find((m) => m.kind === "galley" && m.x[0] > 40).x[0];
    // the furniture's helpers (cabin-furniture.mjs) and each bay's window-seat edge (F: the suites' outer walls)
    const api = { ctx, W, M, WQ, BAY, solid, face, K, KD, h: { rr, circ, seg, line, fill, cush } };
    const spans = {};

    for (const bay of ["F", "U", "M", "UY"]) {
      const B = BAY[bay];
      const cls = classOf[bay];
      const C = CLASSES[cls];
      const zone = zones[bay];
      const ys = layouts[bay];
      const prefix = `cabin.${bay.toLowerCase()}.`;
      // seat groups across the cabin: side groups (outboard of the aisles) and the centre group
      const sideCount = bay === "M" ? 3 : 2;
      const groupsY = {
        l: ys.slice(0, sideCount),
        c: ys.slice(sideCount, ys.length - sideCount),
        r: ys.slice(ys.length - sideCount),
      };
      const span = (list) => {
        const pitch = list.length > 1 ? (list[list.length - 1] - list[0]) / (list.length - 1) : 0.6;
        const w = bay === "F" ? C.lane : zone.seatWidth ?? pitch;
        return { y0: list[0] - w / 2 - (bay === "F" ? 0.055 : 0), y1: list[list.length - 1] + w / 2 + (bay === "F" ? 0.055 : 0), lanes: list.map((y, i) => [i ? (list[i - 1] + y) / 2 : list[0] - w / 2, i < list.length - 1 ? (y + list[i + 1]) / 2 : y + w / 2]) };
      };
      // ---- carpet: between the walls' inner faces, flush-over the floor piece by W.GAP
      const xs = [B.xa, ...W.RING_STATIONS.filter((x) => x > B.xa && x < B.xb), B.xb];
      const carpetPts = [];
      const inner = (x) => Math.min(WQ.wallIn(x, B.z0, B.belt), WQ.wallIn(x, B.zc, B.belt)) - 0.02;
      for (const x of xs) for (const s of [-1, 1]) for (const z of [B.z0, B.zc]) carpetPts.push([x, s * inner(x), z]);
      const carpet = solid(`${prefix}carpet`, bay, carpetPts, { tone: "lo", material: "rubber", kind: "carpet" });
      // aisle runners and floor-path marker strips (closed shapes on the carpet top)
      {
        const aisles = [[groupsY.l, groupsY.c], [groupsY.c, groupsY.r]].map(([a, b]) => [span(a).y1, span(b).y0]);
        const len = (B.xb - B.xa) * 10;
        let run = "";
        let marks = "";
        for (const [a0, a1] of aisles) {
          const ya = (a0 + 0.05 + 3.5) * 10;
          const wa = (a1 - a0 - 0.1) * 10;
          run += rr(0.6, ya, len - 1.2, wa, 0.3);
          for (let x = 1.6; x < len - 2; x += 5) marks += rr(x, ya + wa * 0.5 - 0.12, 2.0, 0.24, 0.1);
        }
        // the seat tracks: two rails under each seat group, end to end along the bay
        let tracks = "";
        if (bay !== "F")
          for (const list of [groupsY.l, groupsY.c, groupsY.r]) {
            if (!list.length) continue;
            const g = span(list);
            for (const y of [g.y0 + 0.12, g.y1 - 0.12]) tracks += seg(0.6, (y + 3.5) * 10, len - 0.6, (y + 3.5) * 10);
          }
        face(carpet, { o: [B.xb, -3.5, B.zc], u: [-1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }, fill(run, "a3-run") + line(run, "faint") + line(marks, "faint") + line(tracks, "faint"));
        // the cabin accent: a lit rule round the carpet
        const x0 = B.xa + 0.08;
        const x1 = B.xb - 0.08;
        const pts = [[x0, -inner(x0) + 0.08], [x1, -inner(x1) + 0.08], [x1, inner(x1) - 0.08], [x0, inner(x0) - 0.08]];
        ctx.accent("cabin", { part: carpet, o: K([0, 0, B.zc]), u: KD([1, 0, 0]), v: KD([0, 1, 0]), normal: KD([0, 0, 1]), svg: `<path d="${poly(pts.map(([x, y]) => [x * 10, y * 10]))}"/>` });
      }

      // ---- seat blocks
      let shown = 0;
      const blockAt = (name, station, list, columnIn) => {
        const column = cls === "F" ? null : columnIn;
        const suiteGroup = cls === "F" && SPLIT ? name.replace(/\.$/, "") : undefined;
        // with the group split the blocks ride their column's group: they stand W.GAP over the carpet
        const zs = B.zc + (SPLIT ? W.GAP : 0);
        const sp = span(list);
        const xf = station - C.ref;
        const xbk = xf + lengthOf(C);
        let limitB = B.xb;
        if (bay === "M") limitB = Math.min(limitB, galleyX - 0.03);
        const fits = xf >= B.xa - 1e-9 && xbk <= limitB + 1e-9;
        if (!fits) {
          REC.dropped.push({ bay, name, station, seats: list.length, x: [xf, xbk], limit: [B.xa, limitB] });
          return;
        }
        for (const piece of C.parts) {
          const prof = piece.profile.map(([u, h]) => [xf + u, zs + h]);
          const pname = piece.key ? `${name}.${piece.key}` : name;
          const part = solid(pname, bay, across(prof, sp.y0, sp.y1), { tone: piece.tone, material: piece.material, kind: "block", column, group: suiteGroup });
          seatPlanes(part, cls, piece.key, prof, sp);
        }
        REC.blocks.push({ name, bay, cls, station, ref: xf + C.ref, seats: list.length, y: [sp.y0, sp.y1] });
        shown += list.length;
        if (cls === "F") {
          // the privacy divider between the pair: on the seat's top, its aft edge flush on the shell's front
          const seatTop = C.parts[0].profile.slice(1, 3).map(([u, h]) => [xf + u, zs + h]);
          const shellFront = C.parts[1].profile.slice(1, 3).map(([u, h]) => [xf + u, zs + h]);
          const zTop = zs + 1.1;
          const onLine = ([a, b], x) => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
          const atZ = ([a, b], z) => [a[0] + ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]), z];
          const A = onLine(seatTop, xf + 0.42);
          const Bc = seatTop[1];
          const Cc = atZ(shellFront, zTop);
          const yd = (sp.lanes[0][1] + sp.lanes[1][0]) / 2;
          const div = solid(`${name}.div`, bay, across([A, Bc, Cc, [A[0], zTop]], yd - 0.02, yd + 0.02), { tone: "hi", material: "steel", kind: "divider", column, group: suiteGroup });
          // a closed panel seam on both faces of the divider
          for (const [y, sgn] of [[yd - 0.02, -1], [yd + 0.02, 1]]) {
            const loc = insetPoly([A, Bc, Cc, [A[0], zTop]].map(([x, z]) => [(x - A[0]) * 10, (zTop - z) * 10]), 0.35);
            face(div, { o: [A[0], y, zTop], u: [1, 0, 0], v: [0, 0, -1], n: [0, sgn, 0] }, line(poly(loc), "faint"));
          }
          // the suite's side walls (window and aisle), flush on the seat's and the shell's side faces
          // the suite's walls are constant height (1.13 m) with a rounded front corner; on the aisle side the wall
          // stops 0.55 m short of the front, the suite's opening (sloped wedge walls read as a field of tents)
          const wallOf = (open) => (open ? [[0.55, 0], [0.55, 1.08], [0.62, 1.13], [1.25, 1.13], [1.25, 0]] : [[0, 0], [0, 1.0], [0.06, 1.1], [0.15, 1.13], [1.25, 1.13], [1.25, 0]]).map(([u, h]) => [xf + u, zs + h]);
          const hmaxW = zs + 1.13;
          const aisleSide = (t) => columnIn === "c" || (columnIn === "l" && t === "r") || (columnIn === "r" && t === "l");
          for (const [t, ya, yb, sgn] of [["l", sp.y0 - 0.04, sp.y0, -1], ["r", sp.y1, sp.y1 + 0.04, 1]]) {
            const wing = wallOf(aisleSide(t));
            const wpart = solid(`${name}.side.${t}`, bay, across(wing, ya, yb), { tone: "hi", material: "steel", kind: "wing", column, group: suiteGroup });
            const toW = ([x, z]) => [(x - wing[0][0]) * 10, (hmaxW - z) * 10];
            const seam = poly(insetPoly(wing.map(toW), 0.4));
            const lamp = circ(...toW([xf + 0.62, zs + 0.7]), 0.22);
            face(wpart, { o: [wing[0][0], sgn < 0 ? ya : yb, hmaxW], u: [1, 0, 0], v: [0, 0, -1], n: [0, sgn, 0] }, line(seam, "faint") + line(lamp, "lo"));
          }
        }
      };
      const sideRows = zone.sideRows.filter((x) => x >= B.x0 && x <= B.x1);
      const centreRows = zone.centreRows.filter((x) => x >= B.x0 && x <= B.x1);
      sideRows.forEach((x, i) => {
        blockAt(`${prefix}s${i + 1}.l`, x, groupsY.l, "l");
        blockAt(`${prefix}s${i + 1}.r`, x, groupsY.r, "r");
      });
      centreRows.forEach((x, i) => blockAt(`${prefix}c${i + 1}`, x, groupsY.c, "c"));
      REC.seats[bay] = shown;
      // (the M bay's bins end at the M4 galley's front: its side units stand full height against the walls)
      spans[bay] = { edge: Math.max(span(groupsY.r).y1, -span(groupsY.l).y0) + (bay === "F" ? 0.04 : 0), x1: bay === "M" ? galleyX - W.GAP : B.xb };
      const inBay = sideRows.length * (groupsY.l.length + groupsY.r.length) + centreRows.length * groupsY.c.length;

      // ---- bay monuments: the forward stair (F), the upper-deck side stowage (U, UY), the M4 galley front (M)
      if (bay === "F") {
        const st = M.CABIN.stairs.find((s) => s.id === "forward");
        const slope = (7.9 - 5.15) / (st.x[1] - st.x[0]);
        const zAt = (x) => 5.15 + (x - st.x[0]) * slope;
        const x0 = B.xa;
        const xTop = st.x[0] + (B.top - 5.15) / slope;
        const x1 = Math.min(10.06, B.xb);
        const prof = [[x0, B.zc], [x0, zAt(x0)], [xTop, B.top], [x1, B.top], [x1, B.zc]];
        const stair = solid(`cabin.stair`, bay, across(prof, st.y[0], st.y[1]), { tone: "mid", material: "steel", kind: "stair" });
        // tread nosings on the slope, one every 0.27 m going up (edge to edge across the stair)
        const fs = facesOf(prof);
        const ramp = fs[1];
        const w = (st.y[1] - st.y[0]) * 10;
        let d = "";
        const steps = [];
        for (let x = st.x[0] + 0.27; x < xTop; x += 0.27) if (x > x0 + 0.01) steps.push(x);
        for (const x of steps) {
          const s = ((x - x0) / ramp.dir[0]) * 10;
          d += seg(0, s, w, s);
        }
        face(stair, { o: [ramp.a[0], st.y[0], ramp.a[1]], u: [0, 1, 0], v: [ramp.dir[0], 0, ramp.dir[1]], n: [ramp.n[0], 0, ramp.n[1]] }, line(d, "lo"));
        // the stringer's step profile on both side faces
        for (const [y, sgn] of [[st.y[0], -1], [st.y[1], 1]]) {
          const pts = [];
          for (const x of [x0, ...steps, xTop]) {
            const z = Math.min(B.top, zAt(x));
            pts.push([(x - x0) * 10, (B.top - z) * 10]);
            pts.push([(Math.min(xTop, x + 0.27) - x0) * 10, (B.top - z) * 10]);
          }
          const rail = poly([...pts.map(([u, v]) => [u, v + 1.6]).filter(([u]) => u <= (xTop - x0) * 10), [(xTop - x0) * 10, 1.6]]);
          face(stair, { o: [x0, y, B.top], u: [1, 0, 0], v: [0, 0, -1], n: [0, sgn, 0] }, line(rail, "faint"));
        }
      }
      if (bay === "U" || bay === "UY") {
        // floor-level side stowage under the windows, beside the window seats
        // follow-up: the lockers' aisle face in one plane with the bins standing on them (cabin-furniture.mjs; was 0.05 m)
        const yIn = Math.max(span(groupsY.r).y1, -span(groupsY.l).y0) + AISLE_CLEAR;
        const zT = B.zc + 0.46;
        const wy = (z) => WQ.wallIn(W.CUT[bay].x[0] + 1, z, "upper") - 0.02;
        for (const [s, sign] of W.SIDES) {
          const prof = [[yIn, B.zc], [wy(B.zc), B.zc], [wy(zT), zT], [yIn, zT]].map(([y, z]) => [sign * y, z]);
          const part = solid(`${prefix}locker.${s}`, bay, along(prof, B.xa, B.xb), { tone: "mid", material: "steel", kind: "locker" });
          // lid outlines on the aisle face, one per seat row, and a latch dot
          const rows = (sign < 0 ? sideRows : sideRows).filter((x) => x - 0.4 > B.xa && x + 0.4 < B.xb);
          let d = "";
          const h = (zT - B.zc) * 10;
          for (const x of rows) {
            const u = (x - B.xa) * 10;
            d += rr(u - 4.6, 0.6, 9.2, h - 1.2, 0.3) + circ(u, 1.4, 0.18);
          }
          face(part, { o: [B.xa, sign * yIn, zT], u: [1, 0, 0], v: [0, 0, -1], n: [0, -sign, 0] }, line(d, "lo"));
        }
      }
      if (bay === "M") {
        const gx0 = galleyX;
        const gx1 = B.xb;
        const zT = B.top;
        const units = [["c", -1.05, 1.05], ["l", -(inner(gx0) - 0.0), -1.49], ["r", 1.49, inner(gx0)]];
        for (const [t, y0, y1] of units) {
          const part = solid(`cabin.m4galley.${t}`, bay, across([[gx0, B.zc], [gx0, zT], [gx1, zT], [gx1, B.zc]], y0, y1), { tone: "mid", material: "steel", kind: "galley" });
          // trolley bays, oven doors and the work deck on the front face (x = gx0, facing forward)
          const w = (y1 - y0) * 10;
          const h = (zT - B.zc) * 10;
          let d = "";
          let k = "";
          if (t === "c") {
            const n = 4;
            const tw = (w - 1.2) / n;
            for (let i = 0; i < n; i++) {
              d += rr(0.6 + i * tw + 0.15, h - 9.6, tw - 0.3, 9.0, 0.3);
              k += circ(0.6 + i * tw + tw / 2, h - 8.6, 0.2);
            }
            d += rr(0.6, 0.5, w - 1.2, h - 10.6, 0.25);
          } else {
            d += rr(0.5, 0.5, w - 1.0, h * 0.45, 0.25) + rr(0.5, h * 0.52, w - 1.0, h * 0.44, 0.25);
            k += circ(w / 2, h * 0.3, 0.2) + circ(w / 2, h * 0.75, 0.2);
          }
          face(part, { o: [gx0, y0, zT], u: [0, 1, 0], v: [0, 0, -1], n: [-1, 0, 0] }, line(d, "lo") + line(k, "lo"));
          galleyTops(api, part, t, gx0, gx1, y0, y1, zT);
        }
        ctx.label("cabin.m4galley.", "M4 galley · trolley bays and ovens, ahead of the M4 doors", "inspect:main");
      }

      // ---- labels for the bay (counts shown vs the bay's true rows)
      const deckWord = bay === "UY" ? "upper deck " : "";
      const layout = zone.abreast;
      // r1 (fidelity): economy is on both decks, so its bays quote their own deck's total (main 334, upper 103) beside the
      // aircraft's (437); "437 on the aircraft" on the upper deck's bay read as 437 economy seats up there
      const total = cls === "Y" ? `${zone.seats} on the ${bay === "UY" ? "upper" : "main"} deck, ${totals.Y} economy in all` : `${totals[cls]} on the aircraft`;
      ctx.label(prefix, `${names[cls]} ${deckWord}· ${layout} · ${shown} seats in this bay (${total})`, `inspect:${deckView[bay]}`);
      REC.seats[`${bay}.inBay`] = inBay;
    }
    ctx.label("cabin.stair", "Forward staircase to the upper deck · its lower flight, cut at the bay's top", "inspect:first");
    // follow-up item 2: bins along every cut wall top, the bay-end fronts (cabin-furniture.mjs)
    REC.furniture = furnish(api, spans);
    ctx.inspect({ id: "first", label: "First", centre: [(W.CUT.F.x[0] + W.CUT.F.x[1]) / 2, 0, 5.8], kit: K([(W.CUT.F.x[0] + W.CUT.F.x[1]) / 2, 0, 5.8]), group: "cabin", bearing: 60, zoom: 5, cutaway: 1 });
    ctx.inspect({ id: "upper", label: "Upper deck", centre: [(W.CUT.U.x[0] + W.CUT.U.x[1]) / 2, 0, 8.5], kit: K([(W.CUT.U.x[0] + W.CUT.U.x[1]) / 2, 0, 8.5]), group: "cabin", bearing: 55, zoom: 4, cutaway: 1 });
    ctx.inspect({ id: "main", label: "Main deck", centre: [(W.CUT.M.x[0] + W.CUT.M.x[1]) / 2, 0, 5.8], kit: K([(W.CUT.M.x[0] + W.CUT.M.x[1]) / 2, 0, 5.8]), group: "cabin", bearing: -55, zoom: 4, cutaway: 1 });
  }

  /** Planes on a seat piece: cushions and backrests, the shell back, the side panels (closed shapes). */
  function seatPlanes(part, cls, key, prof, sp) {
    const all = facesOf(prof);
    // faces by orientation: front (−x), back (+x), top (+z), and the sloped one (forward and up)
    const vertical = all.filter((f) => Math.abs(f.n[1]) < 0.02);
    const upmost = all.reduce((a, f) => (f.n[1] > a.n[1] ? f : a));
    const fs = {
      front: vertical.reduce((a, f) => (f.n[0] < a.n[0] ? f : a)),
      back: vertical.reduce((a, f) => (f.n[0] > a.n[0] ? f : a)),
      top: upmost,
      slope: all.filter((f) => f !== upmost && f.n[0] < -0.05 && f.n[1] > 0.05).sort((a, b) => b.len - a.len)[0],
    };
    const y0 = sp.y0;
    const lanes = sp.lanes.map(([a, b]) => [(a - y0) * 10, (b - y0) * 10]);
    const Wd = (sp.y1 - y0) * 10;
    const on = (f, svg) => face(part, { o: [f.a[0], y0, f.a[1]], u: [0, 1, 0], v: [f.dir[0], 0, f.dir[1]], n: [f.n[0], 0, f.n[1]] }, svg);
    const hmax = Math.max(...prof.map((p) => p[1]));
    const xf = Math.min(...prof.map((p) => p[0]));
    const zc = Math.min(...prof.map((p) => p[1]));
    const toSvg = ([x, z]) => [(x - xf) * 10, (hmax - z) * 10];
    const sides = (svg) => {
      for (const [y, sgn] of [[sp.y0, -1], [sp.y1, 1]]) face(part, { o: [xf, y, hmax], u: [1, 0, 0], v: [0, 0, -1], n: [0, sgn, 0] }, svg);
    };
    if (cls === "Y" && key === "pan") {
      // the seat pan's top (cushion per seat, armrests between) and the open space and legs under it on the aisle sides
      const pan = fs.top;
      const P = pan.len * 10;
      let c = "";
      let arms = "";
      for (const [a, b] of lanes) c += rr(a + 0.45, P * 0.1, b - a - 0.9, P * 0.82, 0.35);
      for (let i = 1; i < lanes.length; i++) arms += rr(lanes[i][0] - 0.22, P * 0.35, 0.44, P * 0.6, 0.18);
      on(pan, cush(c).replace('a3-cush"', 'a3-cush a3-fab"') + line(arms, "lo"));
      // follow-up item 2 (R13): the side a 90° view sees: the cushion's fabric band, the seat rail, the open space under
      // it with the front leg on its track foot and the baggage bar (the rear leg is on the back's side)
      const at = (u, hh) => toSvg([xf + u, zc + hh]);
      const band = poly([at(0.015, 0.4), at(0.05, 0.452), at(0.43, 0.468), at(0.43, 0.37), at(0.015, 0.355)]);
      const rail = poly([at(0.02, 0.35), at(0.43, 0.35), at(0.43, 0.325), at(0.02, 0.325)]);
      const under = poly([at(0.05, 0.32), at(0.44, 0.32), at(0.44, 0.03), at(0.05, 0.03)]);
      const leg = poly([at(0.06, 0.325), at(0.1, 0.325), at(0.075, 0.02), at(0.035, 0.02)]) + poly([at(0.01, 0.02), at(0.15, 0.02), at(0.15, 0.003), at(0.01, 0.003)]);
      const bar = poly([at(0.1, 0.23), at(0.44, 0.23), at(0.44, 0.205), at(0.1, 0.205)]);
      sides(fill(under, "a3-uph") + cush(band, "faint").replace('a3-cush"', 'a3-cush a3-fab"') + line(rail + leg, "lo") + line(bar, "faint"));
      return;
    }
    if (cls === "Y") {
      // the back: backrest and headrest per seat on its front, the IFE screen, tray table and pocket on its back
      const ramp = fs.slope;
      const L = ramp.len * 10;
      let r = "";
      let h = "";
      for (const [a, b] of lanes) {
        r += rr(a + 0.45, L * 0.04, b - a - 0.9, L * 0.64, 0.4);
        h += rr(a + 0.85, L * 0.73, b - a - 1.7, L * 0.22, 0.35);
      }
      let gap = "";
      for (let i = 1; i < lanes.length; i++) gap += seg(lanes[i][0], 0, lanes[i][0], L);
      on(ramp, cush(r + h).replace('a3-cush"', 'a3-cush a3-fab"') + line(gap, "lo"));
      const back = fs.back;
      const H = back.len * 10;
      let d = "";
      for (const [a, b] of lanes) {
        const m = (a + b) / 2;
        const w = b - a;
        d += rr(m - w * 0.22, H * 0.12, w * 0.44, H * 0.13, 0.15) + rr(m - w * 0.36, H * 0.3, w * 0.72, H * 0.24, 0.2) + rr(m - w * 0.36, H * 0.6, w * 0.72, H * 0.1, 0.15);
      }
      let sb = "";
      for (let i = 1; i < lanes.length; i++) sb += seg(lanes[i][0], 0, lanes[i][0], H);
      on(back, line(d, "lo") + line(sb, "faint"));
      // follow-up item 2 (R13): the back's side: the headrest and the backrest cushion as fabric, the shell panel, the
      // armrest's rear end with its pivot, and under the pan level the open space, the rear leg and its foot
      const at = (u, hh) => toSvg([xf - 0.44 + u, zc + hh]);
      const head = poly([at(0.495, 0.93), at(0.522, 1.05), at(0.6, 1.083), at(0.645, 1.055), at(0.645, 0.93)]);
      const rest = poly([at(0.449, 0.5), at(0.489, 0.9), at(0.522, 0.9), at(0.482, 0.5)]);
      const shell = poly([at(0.5, 0.52), at(0.535, 0.88), at(0.635, 0.88), at(0.635, 0.52)]);
      const arm = poly([at(0.446, 0.655), at(0.6, 0.655), at(0.6, 0.6), at(0.443, 0.6)]) + circ(...at(0.575, 0.6275), 0.12);
      const under = poly([at(0.44, 0.32), at(0.63, 0.32), at(0.63, 0.03), at(0.44, 0.03)]);
      const leg = poly([at(0.56, 0.325), at(0.6, 0.325), at(0.625, 0.02), at(0.585, 0.02)]) + poly([at(0.52, 0.02), at(0.655, 0.02), at(0.655, 0.003), at(0.52, 0.003)]);
      sides(fill(under, "a3-uph") + cush(head + rest, "faint").replace('a3-cush"', 'a3-cush a3-fab"') + line(shell, "faint") + line(arm + leg, "lo"));
      return;
    }
    if (key === "seat") {
      // top: ottoman pad and seat cushion per lane; J: the console between the pair with a cup holder
      const top = fs.top;
      const L = top.len * 10;
      const split = CLASSES[cls].split ?? 0.42;
      let c = "";
      for (const [a, b] of lanes) c += rr(a + 0.5, L * 0.03, b - a - 1.0, L * (split - 0.05), 0.4) + rr(a + 0.5, L * (split + 0.03), b - a - 1.0, L * (0.95 - split), 0.5);
      let k = "";
      if (cls === "J") for (let i = 1; i < lanes.length; i++) k += rr(lanes[i][0] - 0.4, L * 0.35, 0.8, L * 0.6, 0.25) + circ(lanes[i][0], L * 0.45, 0.2);
      on(top, cush(c) + line(k, "lo"));
      // front: the ottoman's upholstered front per lane
      const front = fs.front;
      const H = front.len * 10;
      let f = "";
      for (const [a, b] of lanes) f += rr(a + 0.5, H * 0.15, b - a - 1.0, H * 0.7, 0.3);
      on(front, cush(f, "faint"));
      if (cls === "J") {
        // follow-up item 2: the seat's side: the legrest and cushion bands, the pedestal shroud under them
        const at = (u, hh) => toSvg([xf + u, zc + hh]);
        const bands = poly([at(0.31, 0.39), at(0.53, 0.43), at(0.53, 0.36), at(0.31, 0.33)]) + poly([at(0.02, 0.355), at(0.28, 0.385), at(0.28, 0.32), at(0.02, 0.295)]);
        const shroud = poly([at(0.08, 0.26), at(0.52, 0.26), at(0.52, 0.03), at(0.08, 0.03)]);
        sides(cush(bands, "faint") + fill(shroud, "a3-uph") + line(shroud, "faint"));
      } else sides(line(poly(insetPoly(prof.map(toSvg), 0.4)), "faint"));
      return;
    }
    // the shell: backrest and headrest per lane on its front face, trim on the top, the IFE on its back
    const rest = fs.slope;
    const L = rest.len * 10;
    let c = "";
    let dots = "";
    for (const [a, b] of lanes) {
      c += rr(a + 0.55, L * 0.05, b - a - 1.1, L * 0.7, 0.5) + rr(a + 1.0, L * 0.8, b - a - 2.0, L * 0.16, 0.4);
      dots += circ(cls === "F" ? b - 0.5 : (a + b) / 2, L * 0.99 - 0.35, 0.18);
    }
    on(rest, cush(c) + line(dots, "faint"));
    const top = fs.top;
    on(top, line(rr(0.35, 0.3, Wd - 0.7, top.len * 10 - 0.6, 0.3), "faint"));
    const back = fs.back;
    const H = back.len * 10;
    let d = "";
    for (const [a, b] of lanes) {
      const m = (a + b) / 2;
      const w = b - a;
      d += rr(m - w * 0.28, H * 0.1, w * 0.56, H * 0.2, 0.2) + rr(m - w * 0.36, H * 0.55, w * 0.72, H * 0.12, 0.15);
    }
    let s = "";
    for (let i = 1; i < lanes.length; i++) s += seg(lanes[i][0], 0, lanes[i][0], H);
    on(back, line(d, "lo") + line(s, "faint"));
    if (cls === "J") {
      // follow-up item 2: the shell's side, a low curved wall: its panel, the side console's top rail at armrest height
      // and the kick trim along the floor
      const at = (u, hh) => toSvg([xf - 0.54 + u, zc + hh]);
      const rail = poly([at(0.567, 0.62), at(0.96, 0.62), at(0.96, 0.58), at(0.562, 0.58)]);
      const kick = poly([at(0.55, 0.12), at(0.96, 0.12), at(0.96, 0.04), at(0.55, 0.04)]);
      sides(line(poly(insetPoly(prof.map(toSvg), 0.45)), "faint") + line(rail, "lo") + fill(kick, "a3-uph") + line(kick, "faint"));
    } else sides(line(poly(insetPoly(prof.map(toSvg), 0.45)), "faint"));
  }

  // ---------------------------------------------------------------------------------------------
  // clips and pose hints: the cutaway at three turns and in the climb (DESIGN §3.5, §9 M7)
  // ---------------------------------------------------------------------------------------------
  const cutAt = (t) => (t < 1 ? F.smooth(0, 1, t) : 1 - F.smooth(1, 2, t));
  for (const turn of [0, 125, 230]) ctx.clip({ name: `cabin${turn}`, at: (t) => W.groundChannels({ turn, cabin: cutAt(t) }), from: 0, to: 2, frame: 1 / 60 });
  // fu/f4-interiors: the Cockpit view's own camera (f3-engine E1): the cutaway open, the deck synced, every bearing the
  // reader can drag to, at the view's elevation (the order, depth and layer proofs at 42°, not only the parked sweep@42°)
  ctx.clip({ name: "cockpitView", at: (x) => ({ ...W.groundChannels({ turn: x, cabin: 1 }), $elevation: COCKPIT_ELEVATION }), from: 0, to: 360, frame: 0.5 });
  ctx.clip({ name: "cabinClimb", at: (t) => W.groundChannels({ turn: 300, lift: 60, pitch: 8, trim: 1, gear: 0, cabin: cutAt(t) }), from: 0, to: 2, frame: 1 / 60 });
  const hints = [];
  // (r1: 0.29, 0.32, 0.55 and 0.58 sample the crowns just over the bins as they sync: F, U and UY from 0.284-0.288, M 0.546)
  for (const cabin of [0.03, 0.08, 0.14, 0.19, 0.2, 0.21, 0.23, 0.27, 0.29, 0.32, 0.36, 0.45, 0.55, 0.58, 0.6, 0.85]) {
    hints.push(W.groundChannels({ cabin }));
    hints.push(W.groundChannels({ cabin, lift: 60, pitch: 8, trim: 1, gear: 0 }));
  }
  ctx.poseHints(hints);
  ctx.data("cabin", { targets: TARGETS, sync: { cockpit: W.COCKPIT_SYNC }, fade: [W.COCKPIT_SYNC, 20] });
}

// ---------------------------------------------------------------------------------------------
// checks (--check): sync poses, bay clearances, the eye, stations and counts
// ---------------------------------------------------------------------------------------------
/** Assertions after T.build (--check); throw with a readable message. */
export function checks(ctx, out) {
  // review round 2 (fidelity): every aisle within 0.02 m of its zone's aisle (AC 2-5-0), from the seat centres
  {
    const M = ctx.M;
    // (First is left out: its seatWidth is the suite's, wider than the spacing of the seat centres)
    for (const [deck, cls] of [["main", "Y"], ["upper", "J"], ["upper", "Y"]]) {
      const zone = M.CABIN.decks[deck].zones.find((z) => z.cls === cls);
      const ys = M.CABIN.decks[deck].layoutY[cls];
      if (!zone || !ys || !zone.aisle || !zone.seatWidth) continue;
      const sw = zone.seatWidth;
      const gaps = [];
      for (let i = 1; i < ys.length; i++) {
        const g = ys[i] - ys[i - 1] - sw;
        if (g > 0.3) gaps.push(g);
      }
      const worst = Math.max(...gaps.map((g) => Math.abs(g - zone.aisle)));
      console.log(`M7: ${deck} ${cls} aisles ${gaps.map((g) => g.toFixed(2)).join(", ")} m (zone ${zone.aisle} m)`);
      if (cls === "Y" && deck === "main" && worst > 0.02) throw new Error(`M7: main-deck Y aisle ${gaps.map((g) => g.toFixed(2)).join(", ")} m differs from the zone's ${zone.aisle} m by more than 0.02 m`);
    }
  }
  const { W, TURN, T, F } = ctx;
  const WQ = worldOf(W);
  const BAY = baysOf(W);
  const fails = [];
  const say = (line) => ctx.report(line);
  // ---- 1. sync poses: cabin and cockpit equal pitch's world pose whenever synced (50 random states)
  {
    const scene = out.scene;
    // the follow the page runs, rebuilt from the scaffold's chain rules (build.mjs) and this module's rules
    const info = T.groups.map((g) => ({ name: g.name, kind: g.kind, range: g.range, point: g.point, axis: g.axis }));
    const rules = [{ group: "air", channel: "turn" }, { group: "lift", channel: "lift" }, { group: "pitch", channel: "pitch" }, ...Object.entries(W.CUTS).map(([group, c]) => ({ group, channel: "cabin", table: c.table, ease: "smooth" })), { group: "cabin", sync: { channel: "cabin", above: 0 } }, { group: "cockpit", sync: { channel: "cut.fd", above: W.COCKPIT_SYNC } }, ...(SPLIT ? SPLIT_GROUPS.map((g) => ({ group: g, sync: { channel: "cabin", above: 0 } })) : []), ...(SPLIT ? SPLIT_COCKPIT.map((g) => ({ group: g, sync: { channel: "cut.fd", above: W.COCKPIT_SYNC } })) : []), ...AFT_GROUPS.map((g) => ({ group: g, sync: { channel: "cut.fd", above: AFT_SYNC } })), ...binGroups(W).map((b) => ({ group: b.group, sync: { channel: b.channel, above: b.above } }))];
    REC.follow = F.makeFollow(rules, info, TURN);
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const groupIndex = (name) => T.groups.find((g) => g.name === name).index;
    const binNames = binGroups(W).map((b) => b.group);
    const names = ["cabin", "cockpit", ...AFT_GROUPS, ...binNames, ...(SPLIT ? [...SPLIT_GROUPS, ...SPLIT_COCKPIT] : [])];
    const gi = Object.fromEntries(["pitch", ...names].map((n) => [n, groupIndex(n)]));
    const Pp = W.PITCH.point;
    const worst = Object.fromEntries(names.map((n) => [n, 0]));
    const synced = Object.fromEntries(names.map((n) => [n, 0]));
    const fol = REC.follow;
    for (let i = 0; i < 50; i++) {
      const ch = W.groundChannels({ turn: rand() * 720 - 360, lift: rand() * 60, pitch: rand() * 12.5, cabin: 0.2 + rand() * 0.8 });
      const vals = fol(ch);
      const cams = TURN.cams(scene, vals);
      for (const g of names) {
        if (vals[g] === F.PARKED) continue;
        synced[g]++;
        const a = cams[gi.pitch];
        const b = cams[gi[g]];
        for (const p of [[0, 0, 0], [300, -120, 75], [-200, 400, 90], [50, 20, -10]]) {
          const wa = [0, 1, 2].map((r) => a.R[3 * r] * (p[0] - Pp[0]) + a.R[3 * r + 1] * (p[1] - Pp[1]) + a.R[3 * r + 2] * (p[2] - Pp[2]) + a.t[r]);
          const wb = [0, 1, 2].map((r) => b.R[3 * r] * p[0] + b.R[3 * r + 1] * p[1] + b.R[3 * r + 2] * p[2] + b.t[r]);
          worst[g] = Math.max(worst[g], Math.hypot(wa[0] - wb[0], wa[1] - wb[1], wa[2] - wb[2]));
        }
      }
    }
    for (const g of names) {
      if (g === "cabin" || g === "cockpit") say(`sync pose ${g}: ${synced[g]} synced states, largest error ${worst[g].toExponential(2)} units`);
      // (the bins sync later in the cutaway than the cabin, from cabin 0.29 or 0.55: fewer of the 50 states)
      if (!(synced[g] > (binNames.includes(g) ? 5 : 20)) || !(worst[g] < 1e-9)) fails.push(`sync pose ${g}: error ${worst[g]} over ${synced[g]} states`);
    }
    say(`sync pose: the ${binNames.length} bin groups synced in ${binNames.map((g) => synced[g]).join(", ")} of 50 states, largest error ${Math.max(...binNames.map((g) => worst[g])).toExponential(2)} units`);
    if (SPLIT) say(`sync pose: the ${SPLIT_GROUPS.length + SPLIT_COCKPIT.length} split groups (requests S6) match too, largest error ${Math.max(...[...SPLIT_GROUPS, ...SPLIT_COCKPIT].map((g) => worst[g])).toExponential(2)} units`);
    // parked below the thresholds, synced above
    const v0 = fol(W.groundChannels({ cabin: 0 }));
    if (names.some((g) => v0[g] !== F.PARKED)) fails.push("cabin 0: a group is not parked");
    const fdAt = (cabin) => fol(W.groundChannels({ cabin }))["cut.fd"];
    let lo = 0;
    let hi = 0.5;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (fdAt(mid) > W.COCKPIT_SYNC) hi = mid;
      else lo = mid;
    }
    const at = fol(W.groundChannels({ cabin: hi + 1e-6 }));
    const before = fol(W.groundChannels({ cabin: lo - 1e-6 }));
    say(`cockpit syncs at cabin ${hi.toFixed(4)} (cut.fd ${fdAt(hi).toFixed(3)} units); canopy bottom then ${(BAY.FD.top + 0.02).toFixed(3)} m, fade alpha ${smooth(W.COCKPIT_SYNC, 20, fdAt(hi)).toFixed(3)}`);
    if (at.cockpit === F.PARKED || before.cockpit !== F.PARKED) fails.push("cockpit sync threshold is not at cut.fd 14.5");
  }
  // ---- 2. bays: cut planes, walls, ends
  {
    let worst = { cut: Infinity, wall: Infinity, end: Infinity, floor: Infinity, loft: Infinity };
    for (const p of REC.parts) {
      const B = BAY[p.bay];
      if (p.kind === "bin") continue; // the bins stand over the cut, in the crown's room (2b)
      for (const [x, y, z] of p.pts) {
        worst.end = Math.min(worst.end, x - B.x0, B.x1 - x);
        if (x < B.xa - 1e-6 || x > B.xb + 1e-6) fails.push(`${p.name}: x ${x.toFixed(3)} outside ${B.xa.toFixed(2)}..${B.xb.toFixed(2)}`);
        worst.floor = Math.min(worst.floor, z - B.floor);
        if (z < B.z0 - 1e-6) fails.push(`${p.name}: z ${z.toFixed(3)} under the carpet base ${B.z0}`);
        const cutGap = (p.bay === "FD" ? (p.top ?? B.top) + 0.02 : W.CUT[p.bay].cut) - z;
        worst.cut = Math.min(worst.cut, cutGap);
        if (z > (p.top ?? B.top) + 1e-6) fails.push(`${p.name}: z ${z.toFixed(3)} over the bay limit ${(p.top ?? B.top).toFixed(3)}`);
        if (B.belt) {
          const g = WQ.wallIn(x, z, B.belt) - Math.abs(y);
          if (p.kind !== "bin") worst.wall = Math.min(worst.wall, g);
          else worst.bin = Math.min(worst.bin ?? Infinity, g);
          // a bin hangs on its wall at the contract's cross-group gap (W.GAP), as a carpet stands on its floor
          if (g < (p.kind === "bin" ? W.GAP : 0.02) - 1e-6) fails.push(`${p.name}: ${g.toFixed(3)} m inside the wall at (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
        } else {
          const g = Math.min(WQ.ringY(x, z) - Math.abs(y), WQ.crownAt(x) - z);
          worst.loft = Math.min(worst.loft, g);
          if (g < 0.02 - 1e-6) fails.push(`${p.name}: ${g.toFixed(3)} m inside the nose loft at (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`);
        }
      }
    }
    say(`bays: ${REC.parts.length} parts; least clearance to the cut plane ${worst.cut.toFixed(3)} m (FD: to the canopy at sync), to a wall ${worst.wall.toFixed(3)} m, to the nose loft ${worst.loft.toFixed(3)} m, to a bay end face ${worst.end.toFixed(3)} m; least height over a floor ${worst.floor.toFixed(3)} m (carpets W.GAP)`);
  }
  // ---- 2b. furniture: the bins at their true height (r1), the window reveals, the bay-end fronts
  if (REC.furniture) {
    const F2 = REC.furniture;
    const specs = binGroups(W);
    const r2 = (v) => v.toFixed(2);
    const r3 = (v) => v.toFixed(3);
    for (const spec of specs) {
      const bay = spec.bay;
      const B = BAY[bay];
      const c = W.CUT[bay];
      const bins = F2.bins.filter((b) => b.bay === bay);
      const parts = REC.parts.filter((p) => p.bay === bay && p.kind !== "bin");
      const seatTop = Math.max(...parts.flatMap((p) => p.pts.map((q) => q[2])));
      const low = Math.min(...bins.map((b) => b.z[0]));
      // every cabin part of the bay lies under a level plane that every bin lies over (they separate across it)
      if (!(low - seatTop >= 0.02 - 1e-9)) fails.push(`bins ${bay}: foot ${r3(low)} m only ${r3(low - seatTop)} m over the bay's tallest part`);
      for (const b of bins) {
        // on the wall strip's top at W.GAP, the foot inside the strip's top face (from its inner face to the skin)
        if (Math.abs(b.z[0] - (c.walls[1] + W.GAP)) > 1e-9) fails.push(`${b.name}: foot ${r3(b.z[0])} not W.GAP over the wall's top`);
        for (const [yi, yo] of b.foot) if (!(yo - yi > 0.02)) fails.push(`${b.name}: foot only ${r3(yo - yi)} m wide on the wall strip`);
        if (!(b.loft >= 0.04 - 1e-9)) fails.push(`${b.name}: ${r3(b.loft)} m inside the loft`);
        if (!(b.depth >= 0.45)) fails.push(`${b.name}: only ${r3(b.depth)} m deep at its top`);
        if (b.x[0] < B.xa - 1e-6 || b.x[1] > B.xb + 1e-6) fails.push(`${b.name}: x ${r2(b.x[0])}-${r2(b.x[1])} outside the bay`);
      }
      // synced only once the crown's underside (c.cut + lift) is BIN.clear over the bins' top
      const clear = c.cut + spec.above / W.UNIT - spec.top;
      if (!(clear >= 0.02)) fails.push(`bins ${bay}: the crown clears them by ${r3(clear)} m at sync`);
      say(`bins ${bay}: ${bins.length} on group ${spec.group} (sync ${spec.channel} > ${spec.above}: the crown ${r3(clear)} m over their top), z ${r2(low)}-${r2(spec.top)} (aisle face from ${r2(bins[0].under)}: ${r2(bins[0].under - c.floor)}-${r2(spec.top - c.floor)} m over the floor), depth at the top ${r2(Math.min(...bins.map((b) => b.depth)))} m, ${r3(low - seatTop)} m over the bay's tallest part, ${r3(Math.min(...bins.map((b) => b.loft)))} m inside the loft`);
      for (const side of ["l", "r"]) {
        const list = bins.filter((b) => b.side === side).sort((a, b) => a.x[0] - b.x[0]);
        if (!list.length) fails.push(`bins: none in ${bay} ${side}`);
        for (let i = 1; i < list.length; i++) if (Math.abs(list[i].x[0] - list[i - 1].x[1] - W.GAP) > 1e-6) fails.push(`bins: ${list[i - 1].name} and ${list[i].name} are not W.GAP apart`);
      }
    }
    say(`window reveals on the cut walls' inner faces: ${F2.reveals.map((r) => `${r.host} ${r.count}`).join(", ")}`);
    if (F2.reveals.some((r) => !r.count)) fails.push("window reveals: a cut wall has none");
    say(`bay-end fronts: ${F2.fronts.map((f) => `${f.bay} ${f.end} on ${f.host} (x ${f.x.toFixed(2)}): ${f.what}`).join("; ")}`);
  }
  // ---- 3. the flight deck (T3)
  if (REC.eye.length) {
    const E = W.PILOT_EYE;
    const B = BAY.FD;
    const eyeFloor = E[2] - B.floor;
    const aft = E[0] - Math.max(...ctx.M.WINDOWS.cockpit.panes.find((p) => p.id === "windshield").x);
    say(`flight deck: eye ${E.join(", ")} m, ${eyeFloor.toFixed(2)} m over the floor, ${aft.toFixed(2)} m aft of the windshield; glareshield top ${REC.fd.glareTop} m; display row ${(E[0] - REC.fd.panelX).toFixed(2)} m ahead of the eye`);
    if (!(eyeFloor >= 1.1 && eyeFloor <= 1.25)) fails.push(`eye to floor ${eyeFloor}`);
    if (!(aft >= 0.6)) fails.push(`eye only ${aft} m aft of the windshield`);
    if (!(REC.fd.glareTop <= 6.82 + 1e-9)) fails.push(`glareshield top ${REC.fd.glareTop}`);
    const ahead = E[0] - REC.fd.panelX;
    if (!(ahead > 0.6 && ahead < 0.8)) fails.push(`main panel ${ahead} m ahead of the eye`);
    for (const e of REC.eye) {
      const d = Math.hypot(e.eye[0] - E[0], Math.abs(e.eye[1]) - E[1], e.eye[2] - E[2]);
      if (d > 0.01) fails.push(`pilot seat ${e.side} places the eye ${d.toFixed(3)} m from T3`);
    }
    const kinds = REC.displays.map((d) => d.kind).sort().join(",");
    const want = ctx.M.CABIN.flightDeck.displays.layout.slice().sort().join(",");
    say(`flight deck: ${REC.displays.length} displays ${REC.displays.map((d) => d.kind).join(" ")} (${REC.displays[0].w.toFixed(3)} × ${REC.displays[0].h.toFixed(3)} m), ${REC.parts.filter((p) => p.bay === "FD").length} parts, x ≥ ${Math.min(...REC.parts.filter((p) => p.bay === "FD").flatMap((p) => p.pts.map((q) => q[0]))).toFixed(3)}`);
    // f3-interiors: the coamings' covers (each must find a facet facing the Cockpit view and fit its cover)
    if (REC.fd.sideSills) say(`flight deck: side window sills ${REC.fd.sideSills.join(" · ")}`);
    if (REC.fd.coamingFaces) say(`flight deck: coamings ${REC.fd.coamingFaces.map((c) => `${c.side < 0 ? "l" : "r"} facet ${c.area} m² facing ${c.facing}, cover ${c.cover.join(" × ")} m${c.motor ? ", wiper motor" : ""}, ${c.vents} vents`).join(" · ")}`);
    if (kinds !== want) fails.push(`displays ${kinds} != ${want}`);
  }
  // ---- 4. stations and counts
  {
    let worst = 0;
    for (const b of REC.blocks) worst = Math.max(worst, Math.abs(b.ref - b.station));
    if (worst > 0.02) fails.push(`a block is ${worst} m off its station`);
    const line = ["FD", "F", "U", "M", "UY"].map((k) => `${k} ${REC.seats[k] ?? 0}/${TARGETS[k]}`).join(" · ");
    const total = ["FD", "F", "U", "M", "UY"].reduce((s, k) => s + (REC.seats[k] ?? 0), 0);
    say(`seats shown per bay (targets 4 / 22 / 66 / 80 / 28): ${line} · ${total} in all; ${REC.blocks.length} blocks, largest station error ${worst.toExponential(1)} m`);
    for (const d of REC.dropped) say(`left out: ${d.name} (${d.seats} seats) at station ${d.station}: block x ${d.x[0].toFixed(2)}..${d.x[1].toFixed(2)} does not fit ${d.limit[0].toFixed(2)}..${d.limit[1].toFixed(2)}`);
  }
  // ---- 5. the deck plan (follow-up item 1): every seat of M.CABIN, by class and deck, and every monument
  if (REC.plan) {
    const P = REC.plan;
    const C = ctx.M.CABIN;
    const want = { F: 0, J: 0, Y: 0 };
    for (const deck of ["main", "upper"]) for (const z of C.decks[deck].zones) want[z.cls] += z.seats;
    const total = P.seats.F + P.seats.J + P.seats.Y;
    say(`deck plan: ${total} seats of ${C.decks.main.seats + C.decks.upper.seats} (F ${P.seats.F} · J ${P.seats.J} · Y ${P.seats.Y}; main ${P.deck.main}, upper ${P.deck.upper}) + ${P.fd} flight-deck seats; ${P.zones.map((z) => `${z.deck} ${z.cls} ${z.seats}/${z.want}`).join(", ")}`);
    for (const d of P.dropped.filter((q) => q.taper)) say(`deck plan: no seat at ${d.deck} ${d.cls} row ${d.x}, y ${d.y}: the AC's 2-4-2 taper row (its outer edge ${d.edge.toFixed(2)} m, the wall's inner face ${d.wall.toFixed(2)} m)`); // f3-fuselage
    for (const d of P.dropped.filter((q) => !q.taper)) say(`deck plan: no seat at ${d.deck} ${d.cls} row ${d.x}, y ${d.y}: its outer edge at ${d.edge.toFixed(2)} m crosses the wall's inner face (${d.wall.toFixed(2)} m) at cushion height`);
    for (const k of ["F", "J", "Y"]) if (P.seats[k] !== want[k]) fails.push(`deck plan: ${k} ${P.seats[k]} != ${want[k]}`);
    if (P.deck.main !== C.decks.main.seats || P.deck.upper !== C.decks.upper.seats) fails.push(`deck plan: main ${P.deck.main} / upper ${P.deck.upper} != ${C.decks.main.seats} / ${C.decks.upper.seats}`);
    for (const z of P.zones) if (z.seats !== z.want) fails.push(`deck plan: ${z.deck} ${z.cls} zone ${z.seats} != ${z.want}`);
    // monuments: one drawn group per M.CABIN entry, of its kind and count, its x range on the data's (or a recorded move)
    const byKind = {};
    let worstX = 0;
    for (const m of P.monuments) {
      const key = `${m.deck} ${m.kind}`;
      byKind[key] = (byKind[key] ?? 0) + m.count;
      if (m.count !== m.want) fails.push(`deck plan: ${key} at ${m.data.join("-")} draws ${m.count} of ${m.want}`);
      const dx = Math.max(Math.abs(m.x[0] - m.data[0]), Math.abs(m.x[1] - m.data[1]));
      if (!m.moved) worstX = Math.max(worstX, dx);
      if (!m.moved && dx > 0.35) fails.push(`deck plan: ${key} drawn ${m.x.map((v) => v.toFixed(2)).join("-")} against ${m.data.join("-")} with no recorded move`);
      if (m.moved && dx > 1.0) fails.push(`deck plan: ${key} moved ${dx.toFixed(2)} m (${m.moved})`);
    }
    const nData = C.decks.main.monuments.length + C.decks.upper.monuments.length;
    say(`deck plan: ${P.monuments.length} monuments of ${nData} in M.CABIN: ${Object.entries(byKind).map(([k, n]) => `${k} ${n}`).join(", ")}; x ranges on the data's within ${worstX.toFixed(2)} m, ${P.monuments.filter((m) => m.moved).length} moved (recorded)`);
    for (const m of P.monuments.filter((x) => x.moved)) say(`deck plan: ${m.deck} ${m.kind} ${m.data.join("-")} drawn ${m.x.map((v) => v.toFixed(2)).join("-")}: ${m.moved}`);
    if (P.monuments.length !== nData) fails.push(`deck plan: ${P.monuments.length} monuments drawn of ${nData}`);
    say(`deck plan: bays outlined ${P.bays.map((b) => `${b.key} ${b.x.join("-")}`).join(", ")}; picture ${P.svgKB.toFixed(0)} KB; glyphs at least ${P.glyphW.toFixed(2)} × ${P.glyphH.toFixed(2)} m`);
    if (P.bays.length !== 5) fails.push(`deck plan: ${P.bays.length} bays outlined`);
    // r1: the plan's words are its two deck names; the counts are in the key (the card's corner); every block names itself
    say(`deck plan: ${P.regions.count} pick regions under ${P.regions.names} names (${P.regions.byRank.join(" / ")} doors, monuments and the flight deck / seat blocks / decks); key: ${P.keyText}`);
    if (P.regions.byRank[0] < 16 + 20 + 1 || P.regions.byRank[2] !== 2) fails.push(`deck plan: pick regions ${P.regions.byRank.join("/")}`);
    for (const o of P.overlaps) fails.push(`deck plan overlap: ${o}`);
    for (const o of P.outside) fails.push(`deck plan: ${o}`);
  }
  if (fails.length) throw new Error(fails.slice(0, 12).join("; ") + (fails.length > 12 ? ` (+${fails.length - 12} more)` : ""));
}
