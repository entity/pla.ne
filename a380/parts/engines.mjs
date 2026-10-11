// a380/parts/engines.mjs (M4): Engines: four Trent 970 nacelles, three-piece pylons into the wing LE, inlet fallback fans.
//
// Contract: a380/notes/CONTRACT.md. Design: a380/DESIGN.md §5.1 (W.NACELLE, W.WING), §5.5, §6.2, §6.3, §9 M4.
// Notes: a380/notes/modules/M4.md.
//
// Per engine (model ENGINES.list; W.NACELLE[i] carries the rows and the three tangent planes):
//   eng.n.lip       T.round  s 0 → 0.50 m, r 1.70 → 1.94, chrome. Its front cap is the inlet face: a plane holds
//                   the dark inlet disc and ring; without WebGL the page draws the fan at its true depth on a 2D
//                   canvas (the parallax crescent, follow-up item 18).
//   eng.n.fancowl   T.round  s 0.50 → 3.81, r 1.94 → 1.90, steel: nose-cowl seam, hinge lines, latches, panels.
//   eng.n.aftcowl   T.round  s 3.81 → 6.20, r 1.90 → 1.205, steel: engines 2 and 3 carry the translating-cowl
//                   seam and the cascade-zone panel lines; 1 and 4 the fixed fan duct's panel joint.
//   eng.n.core      T.round  s 6.20 → 6.93, r 1.00 → 0.835, gunmetal (fan-nozzle annulus step, primary nozzle).
//   eng.n.plug      T.round  s 6.93 → 8.39, r 0.495 → 0.08, gunmetal.
//   eng.n.pylon.fwd ring-loft T.hull, thirteen rings y = yc + 0.45 sin θ (θ every 15°): the fan cowl's tangent strip
//                   (noses at s = 2 − cos θ, a half-ellipse from s 1.0 to 2.0), the wing's LE profile (W.wingSection,
//                   ξ 0 → the LE face) and the LE face: a rounded fairing rising from the cowl into the wing LE.
//   eng.n.pylon.fillet.{i,o} T.hull: line contact on the fan cowl's tangent plane 10° off the crest, flush under
//                   pylon.fwd, flush with its side wall at s 2.0 and out to 0.50 m off the axis plane from s 2.6 to 3.81
//                   (the base wraps the cowl, item 20).
//   eng.n.pylon.mid T.hull wedge: top flush under pylon.fwd (fan-cowl tangent plane), bottom in the aft cowl's
//                   tangent plane (line contact along the aft cowl's top generator), x_lip + 3.81 → the LE face.
//   eng.n.pylon.core T.hull wedge under pylon.mid, flush on the aft cowl's aft cap, bottom in the core's tangent
//                   plane (line contact along the core's top generator) → the LE face: the pylon's lower fairing
//                   over the core, so the pylon reaches the core as the real one does.
//   eng.n.pylon.aft T.hull from the LE face aft: top flush on W.WING.bottomPlane to pylon.wingAftX, then the
//                   fairing down to (pylon.aftTipX, pylon.aftTipZ); front face flush on the pieces above, bottom
//                   from the core tangent plane up to the tip. Outboard: split at y 25.75 (.a inboard, .b outboard)
//                   and ended GAP ahead of the TE face (canoe 6 sits behind it, DESIGN §5.4).
//   eng.n.chine     thin T.prism strake on the inboard side of the fan cowl, its inner edge on a cowl generator.
// Groups: none (all on pitch). Reverser deployment is not modelled (DESIGN §11.3).
// Contacts: every pylon–nacelle contact is a line on a W.NACELLE tangent plane; every pylon–wing contact is flush
// on W.WING's LE profile, LE face plane or bottom plane; the side planes y = yc ± 0.45 are flush with M3's gap
// strips (inboard 14.35 / 15.25, outboard 25.25 / 26.15).

import * as SH from "../gl/shaders.mjs";
import { glslPose } from "../../kit/gl.mjs";

export const id = "engines";
export const owner = "M4";
export const title = "Engines: four Trent 970 nacelles, three-piece pylons into the wing LE, inlet fallback fans";
/** Every part name this module creates starts with one of these (the harness enforces it). */
export const prefixes = ["eng.", "light.engScan"];
/** true: the harness builds stubs.mjs's stand-in instead of build(). */
export const stub = false;

const D2R = Math.PI / 180;
const HALF = 0.45; // pylon half-width (m): side planes y = yc ± 0.45
const SPLIT_Y = 25.75; // the outboard pylon.aft splits here, where the wing's box parts split
const FAN = { ri: 1.475, depth: 1.88, rs: 0.42, ls: 1.04, blades: 24, twist: 1.3, slit: 0.14, spiral: 0.85, rpm100: 2900 };
// follow-up review 1: the accent ring's radius over the inlet's (kit units, 0.035 m), shared with the lip ramp's inset
const LIP_ACC = 0.35;
const MARK_BLUR = 4; // the marked blade blurs like a 4-per-rev pattern (a narrow mark); the spinner spiral like 1 per rev
const NOSE_COWL = 1.63; // AC 2-12-0: nose cowl 1.63 (top), then the fan cowl 2.18
const CASCADE = 0.7; // ENGINES.nacelle.reverserTranslation [E]: the cascade zone under the translating sleeve
// follow-up item 20: the forward fairing's plan and section. Seven y-rings (offsets from the engine's y, m) whose
// noses on the fan cowl's tangent plane follow a blunt half-ellipse (no knife point), and whose top lines rise from
// those noses to the wing's LE profile, so the fairing's top is rounded over the cowl and squares up into the slot.
// (follow-up review 1: thirteen rings on a true half-ellipse, dy = 0.45 sin θ, s = 2 − cos θ every 15°: with seven the
// nose's plan outline read as a six-segment polygon at 8x)
const FWD_RINGS = (() => {
  const half = Array.from({ length: 7 }, (_, k) => [0.45 * Math.sin((k * Math.PI) / 12), 2.0 - Math.cos((k * Math.PI) / 12)]);
  return [...half.slice(1).reverse().map(([dy, s]) => [-dy, s]), ...half];
})();
// the fillets under the fairing's sides: line contact on the fan cowl along the generator 10° off the crest, flush
// under the fairing (its bottom, the fan cowl's tangent plane), out to 0.50 m off the axis plane (the base wraps the
// cowl over 2 × 15°), from s 2.0 to the fan cowl's end
// (follow-up review 1: the fillet starts flush with the fairing's side wall at s 2.0 and flares out to 0.50 m by s 2.6,
// so no wedge pokes out beside the fairing's nose at the pylon's foot)
const FILLET = { phi: 10, out: 0.5, s0: 2.0, s1: 3.81, flare: 2.6 };

// --------------------------------------------------------------------------------------------- geometry helpers
const zOn = (pl, x, y = 0) => (pl.d - pl.n[0] * x - pl.n[1] * y) / pl.n[2];
const lerp = (a, b, t) => a + (b - a) * t;
/** 2D convex hull (monotone chain) of [x, z] points, counter-clockwise, collinear points dropped. */
function hull2(points) {
  const p = points.map((q) => q.slice()).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 1e-12) lower.pop();
    lower.push(q);
  }
  const upper = [];
  for (const q of p.slice().reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 1e-12) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}
/** z range of a convex [x, z] polygon at x: [bottom, top]. */
function spanAt(poly, x) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((x - a[0]) * (x - b[0]) > 1e-12) continue;
    if (Math.abs(b[0] - a[0]) < 1e-12) {
      lo = Math.min(lo, a[1], b[1]);
      hi = Math.max(hi, a[1], b[1]);
      continue;
    }
    const z = lerp(a[1], b[1], (x - a[0]) / (b[0] - a[0]));
    lo = Math.min(lo, z);
    hi = Math.max(hi, z);
  }
  return [lo, hi];
}

/** Everything about one engine, in model metres (x aft, y starboard, z up). */
function engineOf(W, M, N) {
  const e = M.ENGINES.list.find((x) => x.id === N.id);
  const side = Math.sign(N.y);
  const ay = Math.abs(N.y);
  const outboard = ay > 20;
  const faceLine = (lines, y) => {
    const a = Math.abs(y);
    const f = lines.find((l) => a >= l.y[0] - 1e-9 && a <= l.y[1] + 1e-9) ?? lines[lines.length - 1];
    return lerp(f.x[0], f.x[1], (a - f.y[0]) / (f.y[1] - f.y[0]));
  };
  const leFaceX = (y) => faceLine(W.WING.faces.le, y);
  const teFaceX = (y) => faceLine(W.WING.faces.te, y);
  const bottomZ = (x, y) => zOn(W.WING.bottomPlane(y), x, y);
  const fan = (x) => zOn(N.fanTop, x);
  const aft = (x) => zOn(N.aftTop, x);
  const coreZ = (x) => zOn(N.coreTop, x);
  const y0 = N.y - HALF;
  const y1 = N.y + HALF;
  const ys = [y0, y1];
  const at = (s) => N.lip + s;
  const pylon = e.pylon;
  // the outboard aft fairing ends GAP ahead of the TE face (M3's canoe 6 sits behind it at y 25.77–25.97)
  const tipX = (y) => (outboard ? Math.min(pylon.aftTipX, teFaceX(y) - W.GAP) : pylon.aftTipX);
  // ring sections [x, z] at a span y
  const sec = {
    fwd(y, noseS = FWD_RINGS[0][1]) {
      const w = W.WING.section(y);
      const xf = leFaceX(y);
      // noseS: the ring's nose station on the fan cowl (0: the centre ring's s 1.0; default: a side wall's)
      const nose = at(noseS === 0 ? 1.0 : noseS);
      const pts = [[nose, fan(nose)], [xf, fan(xf)], [xf, w.bottom], [xf, w.topAt(xf)]];
      for (const [x, z] of w.points) if (x <= xf + 1e-9 && x < w.le + 0.5 * w.chord) pts.push([x, z]);
      return hull2(pts);
    },
    mid(y) {
      const xf = leFaceX(y);
      return hull2([[at(3.81), N.cz + 1.9], [xf, fan(xf)], [xf, aft(xf)]]);
    },
    core(y) {
      const xf = leFaceX(y);
      return hull2([[at(6.2), N.cz + 1.0], [at(6.2), aft(at(6.2))], [xf, aft(xf)], [xf, coreZ(xf)]]);
    },
    aft(y) {
      const xf = leFaceX(y);
      const xt = tipX(y);
      const zb = bottomZ(xf, y);
      const zTip = bottomZ(xt, y) + (pylon.aftTipZ - pylon.wingZ);
      return hull2([[xf, coreZ(xf)], [xf, zb], [pylon.wingAftX, bottomZ(pylon.wingAftX, y)], [xt, zTip]]);
    },
  };
  return { N, e, side, ay, outboard, leFaceX, teFaceX, bottomZ, fan, aft, coreZ, y0, y1, ys, at, pylon, tipX, sec };
}

/** The ring loft rings of a pylon piece between two span stations, as model points. */
const ringsOf = (E, piece, ya, yb) => {
  // the forward fairing (follow-up item 20): seven rings across the pylon, their noses on a blunt half-ellipse in plan
  // (FWD_RINGS), so the fairing's top is rounded over the cowl and it ends in a round nose, not a knife point
  if (piece === "fwd" && Math.abs(ya - E.y0) < 1e-9 && Math.abs(yb - E.y1) < 1e-9) return FWD_RINGS.map(([dy, s]) => E.sec.fwd(E.N.y + dy, s).map(([x, z]) => [x, E.N.y + dy, z]));
  return [ya, yb].map((y) => E.sec[piece](y).map(([x, z]) => [x, y, z]));
};

// --------------------------------------------------------------------------------------------- module
export function groups(ctx) {
  void ctx; // every part rides pitch: no groups, no rules
}

export function build(ctx) {
  const { W, M, P, G } = ctx;
  const k = W.kit;
  const m = W.m;
  const fit = W.fit();
  // the fan's screen sense: in the lip plane (u = kit +y, v = kit +z), is u → v clockwise on screen nose-on?
  const sense = (() => {
    const o = W.kit([22.23, 14.8, 3.005]);
    const S = (p) => W.project(W.poseOf(p, { turn: 40 }), P);
    const s0 = S(o);
    const su = S([o[0], o[1] + 10, o[2]]);
    const sv = S([o[0], o[1], o[2] + 10]);
    const c = (su[0] - s0[0]) * (sv[1] - s0[1]) - (su[1] - s0[1]) * (sv[0] - s0[0]);
    return c > 0 ? 1 : -1; // screen y points down: c > 0 means u → v turns clockwise
  })();
  const report = [];
  const css = [];
  const engines = W.NACELLE.map((N) => engineOf(W, M, N));
  const DATA = { sign: sense, blades: FAN.blades, rpm100: FAN.rpm100, markBlur: MARK_BLUR, lipAcc: LIP_ACC, engines: [] };

  for (const [i, E] of engines.entries()) {
    const { N, side } = E;
    const n = N.id;
    const tag = `eng.${n}`;
    const inboard = -side; // the side of the nacelle that faces the fuselage, as a y sign
    // nacelle frame: o at the lip on the axis, a aft (kit −x), u up, v = a × u = kit +y
    const F = { o: k([N.lip, N.y, N.cz]), a: W.kitDir([1, 0, 0]), u: [0, 0, 1], v: [0, 1, 0] };
    const S = (s) => m(s);
    const mat = { lip: "chrome", fancowl: "steel", aftcowl: "steel", core: "gunmetal", plug: "gunmetal" };
    const seams = {
      lip: [],
      fancowl: [S(NOSE_COWL)],
      aftcowl: N.reverser ? [S(3.81 + 0.06), S(3.81 + CASCADE)] : [S(5.0)],
      core: [S(6.62)],
      plug: [S(7.42)],
    };
    const parts = {};
    // fu/f4-wings: which end rings of a row are shared with its neighbour (equal station and radius)
    const jointOf = (part) => {
      const j = N.rows.findIndex((r) => r.part === part);
      const row = N.rows[j];
      const shares = (a, b) => a && b && Math.abs(a.s[1] - b.s[0]) < 1e-9 && Math.abs(a.r[1] - b.r[0]) < 1e-9;
      const first = shares(N.rows[j - 1], row);
      const last = shares(row, N.rows[j + 1]);
      if (!first && !last) return {};
      return { jointCaps: { ...(first ? { first: "faint" } : {}), ...(last ? { last: "faint" } : {}) }, ends: [first ? "open" : "flat", last ? "open" : "flat"] };
    };
    for (const row of N.rows) {
      parts[row.part] = ctx.round({
        name: `${tag}.${row.part}`,
        F,
        s0: S(row.s[0]),
        s1: S(row.s[1]),
        r: [m(row.r[0]), m(row.r[1])],
        tone: "hi",
        // follow-up review 1: the lip's cap/cone rim is a faint seam, not a ring (the lip read as a stack of washers)
        crease: row.part === "lip" ? "faint" : "lo",
        material: mat[row.part],
        details: { seams: seams[row.part] },
        // kit patch 17: the lip, cowls and core shade in the hulls' 13 sub-bands (five bands read as a staircase down
        // each cowl); the small, steep exhaust plug keeps the kit's five
        ...(row.part === "plug" ? {} : { bands: 13 }),
        // fu/f4-wings: the rings two rows share (lip/fan cowl at 0.50 m, fan cowl/aft cowl at 3.81 m, the same radius on
        // both sides) are round joints (the engine track's E2): a faint seam, not a hi outline ring; the rows meet open
        ...jointOf(row.part),
      });
    }
    // a point on the nacelle surface at station s (m from the lip) and angle φ (0 = +y kit/model starboard, 90 = up)
    const rAt = (s) => {
      const row = N.rows.find((r) => s >= r.s[0] - 1e-9 && s <= r.s[1] + 1e-9);
      return lerp(row.r[0], row.r[1], (s - row.s[0]) / (row.s[1] - row.s[0]));
    };
    const surf = (s, phi, out = 0) => {
      const r = rAt(s) + out;
      return [N.lip + s, N.y + r * Math.cos(phi * D2R), N.cz + r * Math.sin(phi * D2R)];
    };
    // the tangent plane of a cone row along the generator at φ: { o (kit, at s0), u (kit, along the generator), v (kit, around), n (kit, outward) }
    const tangentFrame = (row, phi, s0) => {
      const a = surf(row.s[0], phi);
      const b = surf(row.s[1], phi);
      const gen = W.vec.unit(W.vec.sub(b, a));
      const around = [0, -Math.sin(phi * D2R), Math.cos(phi * D2R)];
      let nrm = W.vec.unit(W.vec.cross(gen, around));
      const radial = [0, Math.cos(phi * D2R), Math.sin(phi * D2R)];
      if (W.vec.dot(nrm, radial) < 0) nrm = W.vec.mul(nrm, -1);
      return { o: k(surf(s0, phi)), u: W.kitDir(gen), v: W.kitDir(around), n: W.kitDir(nrm), gen, around, nrm };
    };
    const rowOf = (name) => N.rows.find((r) => r.part === name);

    // ---- inlet face: the lip's front cap (normal forward), the dark inlet disc and ring, the accent ring. The fan
    // behind it (follow-up item 18) is not drawn on this plane: without WebGL, the page script below draws it at its
    // true depth (1.88 m behind the lip) on a 2D canvas, clipped to the inlet opening and masked like the GL fan, so
    // only the parallax crescent the shader shows is seen, at every bearing and after a context loss
    const ri = m(FAN.ri);
    const fx = (v) => v.toFixed(2);
    const ringPath = (r) => `M${fx(r)} 0A${fx(r)} ${fx(r)} 0 1 1 ${fx(-r)} 0A${fx(r)} ${fx(r)} 0 1 1 ${fx(r)} 0Z`;
    const fanSvg = [];
    fanSvg.push(`<circle class="a3-inlet" r="${fx(ri)}"/>`);
    fanSvg.push(`<circle class="a3-inlet-ring" r="${fx(ri - 2.4)}"/>`);
    const capO = k([N.lip, N.y, N.cz]);
    ctx.plane(parts.lip, { o: capO, u: [0, 1, 0], v: [0, 0, 1], normal: [1, 0, 0], fade: [0.02, 0.25], svg: fanSvg.join("") });
    // phase accent: one lit ring at the throat, the lip's inner arc (follow-up review 1: two accent rings on the cap
    // annulus, with the rim crease, read as a flat washer wired with rings); the page's lip ramp stops short of it
    ctx.accent(`eng${n}`, { part: parts.lip, o: capO, u: [0, 1, 0], v: [0, 0, 1], normal: [1, 0, 0], fade: [0.02, 0.25], svg: `<path d="${ringPath(ri + LIP_ACC)}"/>` });

    // ---- fan cowl: hinge lines beside the pylon, the lower split line with latches, access panel, anti-ice exhaust
    const fc = rowOf("fancowl");
    const hingePhi = 90 - (Math.asin((FILLET.out + 0.05) / 1.92) / D2R); // just outside the pylon's fillets
    for (const sgn of [1, -1]) {
      const phi = 90 + sgn * (90 - hingePhi);
      const T = tangentFrame(fc, phi, NOSE_COWL);
      const L = m(3.81 - NOSE_COWL) / Math.cos(Math.atan2(0.04, 3.31));
      // follow-up round 2 (wings): faint, the nose-cowl seam's tone it starts on (a lo hinge line read as a crease ending
      // in mid-cowl, the faint seam unseen beside it)
      ctx.plane(parts.fancowl, { o: T.o, u: T.u, v: T.v, normal: T.n, fade: [0.04, 0.3], svg: `<path class="iso-line" data-tone="faint" d="M0 0L${fx(L)} 0"/>` });
    }
    {
      // the lower split line and four latch handles at 6 o'clock (outside every reachable view: body elevation ≥ 17.5°)
      const T = tangentFrame(fc, -90, NOSE_COWL);
      const L = m(3.81 - NOSE_COWL);
      const latches = [0.35, 0.95, 1.55, 2.0].map((s) => `<rect class="iso-line" data-tone="lo" x="${fx(m(s) - 1.6)}" y="-0.7" width="3.2" height="1.4" rx="0.5"/>`).join("");
      ctx.plane(parts.fancowl, { o: T.o, u: T.u, v: T.v, normal: T.n, fade: [0.04, 0.3], svg: `<path class="iso-line" data-tone="lo" d="M0 0L${fx(L)} 0"/>${latches}` });
    }
    {
      // an access door on the outboard upper side of the fan cowl (oil servicing), a closed outline with two fasteners
      const phi = 90 + side * 62; // outboard side: +y for starboard engines
      const T = tangentFrame(fc, phi, 2.35);
      const w = m(0.62);
      const h = m(0.42);
      ctx.plane(parts.fancowl, { o: T.o, u: T.u, v: T.v, normal: T.n, fade: [0.12, 0.42], svg: `<rect class="iso-line" data-tone="faint" x="0" y="${fx(-h / 2)}" width="${fx(w)}" height="${fx(h)}" rx="0.8"/><circle class="a3-eng-screw" cx="1.1" cy="0" r="0.26"/><circle class="a3-eng-screw" cx="${fx(w - 1.1)}" cy="0" r="0.26"/>` });
    }
    {
      // the nose cowl's anti-ice exhaust grille, low on the inboard side: a closed outline with four louvre slots
      const phi = 90 - inboard * 0 + (inboard > 0 ? -125 : 125) - 90; // 35° below horizontal on the inboard side
      const ph = inboard > 0 ? -35 : 215;
      void phi;
      const T = tangentFrame(fc, ph, 0.92);
      const w = m(0.42);
      const h = m(0.26);
      const slots = [0.25, 0.42, 0.59, 0.76].map((t) => `<rect class="iso-line" data-tone="faint" x="${fx(w * t - 0.35)}" y="${fx(-h / 2 + 0.6)}" width="0.7" height="${fx(h - 1.2)}" rx="0.35"/>`).join("");
      ctx.plane(parts.fancowl, { o: T.o, u: T.u, v: T.v, normal: T.n, fade: [0.12, 0.42], svg: `<rect class="iso-line" data-tone="lo" x="0" y="${fx(-h / 2)}" width="${fx(w)}" height="${fx(h)}" rx="0.6"/>${slots}` });
    }

    // ---- aft cowl: the reverser's cascade zone (engines 2, 3) or the fixed fan duct's access panel (1, 4)
    const ac = rowOf("aftcowl");
    if (N.reverser) {
      // cascade-zone panel lines: generators between the translating-cowl seam and the cascade zone's aft ring
      for (let phi = -60; phi <= 240; phi += 30) {
        if (Math.abs(phi - 90) < 25) continue; // under the pylon
        const T = tangentFrame(ac, phi, 3.81 + 0.06);
        const a0 = rowOf("aftcowl");
        const gen = Math.hypot(a0.s[1] - a0.s[0], a0.r[1] - a0.r[0]) / (a0.s[1] - a0.s[0]);
        const L = m(CASCADE - 0.06) * gen;
        ctx.plane(parts.aftcowl, { o: T.o, u: T.u, v: T.v, normal: T.n, fade: [0.04, 0.3], svg: `<path class="iso-line" data-tone="faint" d="M0 0L${fx(L)} 0"/>` });
      }
    } else {
      const T = tangentFrame(ac, 90 + side * 55, 4.45);
      const gen = Math.hypot(ac.s[1] - ac.s[0], ac.r[1] - ac.r[0]) / (ac.s[1] - ac.s[0]);
      const w = m(0.55) * gen;
      const h = m(0.38);
      ctx.plane(parts.aftcowl, { o: T.o, u: T.u, v: T.v, normal: T.n, fade: [0.12, 0.42], svg: `<rect class="iso-line" data-tone="lo" x="0" y="${fx(-h / 2)}" width="${fx(w)}" height="${fx(h)}" rx="0.8"/>` });
    }

    // ---- the chine (nacelle strake) on the inboard side: a 25 mm plate standing on a fan-cowl generator
    {
      const phi = inboard > 0 ? 38 : 142; // 38° above horizontal on the inboard side
      const s0 = 1.15;
      const T = tangentFrame(fc, phi, s0);
      const L = m(1.45);
      const h = m(0.3);
      const Fc = { o: T.o, a: T.v, u: T.u, v: T.n };
      ctx.prism({ name: `${tag}.chine`, F: Fc, polygon: [[0, 0], [L, 0], [L - m(0.05), h * 0.62], [L - m(0.55), h]], s0: -m(0.0125), s1: m(0.0125), tone: "mid", crease: "lo", material: "steel" });
    }

    // ---- pylon: fwd (into the LE), mid (on the aft cowl), core (on the core), aft (under the box)
    const hullPart = (name, piece, ya, yb, extra = {}) => ctx.hull({ name, rings: ringsOf(E, piece, ya, yb).map((r) => r.map(k)), smooth: true, sharp: 35, tone: "hi", crease: "lo", material: "steel", ...extra });
    const pyl = {};
    // Against the scaffold's full-chord wing stub (its boxes include the LE), pylon.fwd is clipped at the wing's
    // leading-edge line so --only=engines still builds; with M3's wing (box from the LE face, strips beside the
    // pylon slots, DESIGN §5.4) it rises into the LE profile in full (notes/requests/M4.md, request 1).
    const fullChordStub = ctx.stubbed("wings") && !ctx.part(`wings.r.le.1`) && !ctx.part(`wings.r.le.gin.a`);
    const leFlat = () => {
      const A = k([M.wingAt(E.y0).le, E.y0, 0]);
      const B = k([M.wingAt(E.y1).le, E.y1, 0]);
      let nrm = W.vec.unit([B[1] - A[1], -(B[0] - A[0]), 0]);
      const aftPt = k([M.wingAt(N.y).le + 1, N.y, 0]);
      if (W.vec.dot(nrm, aftPt) < W.vec.dot(nrm, A)) nrm = W.vec.mul(nrm, -1);
      return { n: nrm, d: W.vec.dot(nrm, A) };
    };
    // follow-up item 16: the pylon pieces meet each other, the nacelle's tangent planes and the wing in planes: those
    // outline segments are gap joints (the module's CSS draws them in the gap tone), so the pylon's hi lines are its
    // true silhouette (the faces between the pieces read as one fairing, not a stack of outlined planks)
    const jointM = (pl, tone = "mid") => ({ n: [-pl.n[0], pl.n[1], pl.n[2]], d: W.UNIT * (pl.d - W.PIVOT_X * pl.n[0]), tone });
    const leFace = (() => {
      const p0 = [E.leFaceX(E.y0), E.y0, 0];
      const p1 = [E.leFaceX(E.y1), E.y1, 0];
      const n = W.vec.unit([p1[1] - p0[1], -(p1[0] - p0[0]), 0]);
      return { n, d: W.vec.dot(n, p0) };
    })();
    const aftCap = { n: [1, 0, 0], d: N.lip + 6.2 };
    pyl.fwd = hullPart(`${tag}.pylon.fwd`, "fwd", E.y0, E.y1, { ...(fullChordStub ? { flats: [leFlat()] } : {}), joints: [jointM(N.fanTop), jointM(leFace)] });
    if (fullChordStub && i === 0) ctx.report("wings are the scaffold's full-chord stub: pylon.fwd clipped at the LE line (stub build only)");
    pyl.mid = hullPart(`${tag}.pylon.mid`, "mid", E.y0, E.y1, { joints: [jointM(N.fanTop), jointM(N.aftTop), jointM(leFace)] });
    pyl.core = hullPart(`${tag}.pylon.core`, "core", E.y0, E.y1, { joints: [jointM(N.aftTop), jointM(N.coreTop), jointM(aftCap), jointM(leFace)] });
    const aftJoints = (y) => [jointM(leFace), jointM(W.WING.bottomPlane(y))];
    if (E.outboard) {
      const ys = side * SPLIT_Y;
      const [ya, yb] = side > 0 ? [E.y0, E.y1] : [E.y1, E.y0]; // inboard → outboard in |y|
      const split = jointM({ n: [0, 1, 0], d: ys }, "faint");
      pyl.aftA = hullPart(`${tag}.pylon.aft.a`, "aft", ya, ys, { joints: [...aftJoints(ya), split] });
      pyl.aftB = hullPart(`${tag}.pylon.aft.b`, "aft", ys, yb, { joints: [...aftJoints(yb), split] });
    } else pyl.aft = hullPart(`${tag}.pylon.aft`, "aft", E.y0, E.y1, { joints: aftJoints(N.y) });
    // follow-up item 20: the fillets. Each lies on the fan cowl's tangent plane along the generator FILLET.phi off the
    // crest (a line contact, like every pylon–nacelle contact), its top flush under the fairing (the crest's tangent
    // plane), its outer face from the fairing's lower side edge down to 0.50 m off the axis plane, 8 mm over the cowl
    pyl.fillets = [];
    for (const sgn of [1, -1]) {
      const T = tangentFrame(fc, 90 - sgn * FILLET.phi, FILLET.s0);
      const pf = { n: T.nrm, d: W.vec.dot(T.nrm, surf(FILLET.s0, 90 - sgn * FILLET.phi)) };
      const pt = N.fanTop;
      const zOnPl = (pl, x, y) => (pl.d - pl.n[0] * x - pl.n[1] * y) / pl.n[2];
      const ringAt = (s, out = FILLET.out) => {
        const x = N.lip + s;
        // T1: where the two planes meet at x (solve for y, z)
        const a1 = pf.n[1], b1 = pf.n[2], c1 = pf.d - pf.n[0] * x;
        const a2 = pt.n[1], b2 = pt.n[2], c2 = pt.d - pt.n[0] * x;
        const det = a1 * b2 - a2 * b1;
        const y1 = (c1 * b2 - c2 * b1) / det;
        const z1 = (a1 * c2 - a2 * c1) / det;
        const y3 = N.y + sgn * HALF;
        const y2 = N.y + sgn * out;
        return [[x, y1, z1], [x, y3, zOnPl(pt, x, y3)], [x, y2, zOnPl(pf, x, y2)]];
      };
      const rings = [ringAt(FILLET.s0, HALF), ringAt(FILLET.flare), ringAt(FILLET.s1)];
      pyl.fillets.push(ctx.hull({ name: `${tag}.pylon.fillet.${sgn * side > 0 ? "o" : "i"}`, rings: rings.map((r) => r.map(k)), smooth: true, sharp: 35, tone: "hi", crease: "lo", material: "steel", jointCaps: { first: "faint", last: "faint" }, joints: [jointM(pt), jointM(pf)] }));
      E.fillets = (E.fillets ?? []).concat([{ sgn, rings, plane: pf }]);
    }

    // pylon side-wall detail: panel joints edge to edge, access panels, the heat shield line on the aft fairing
    const wall = (part, piece, y, outward, fn) => {
      const poly = E.sec[piece](y);
      // plane on the flat side cap y = const: svg x = model x (aft, metres × 10), svg y = model z (up, × 10)
      const o = k([0, y, 0]);
      ctx.plane(part, { o, u: [-1, 0, 0], v: [0, 0, 1], normal: [0, outward, 0], fade: [0.06, 0.32], svg: fn(poly, (x) => fx(m(x)), (z) => fx(m(z))) });
    };
    const vline = (poly, X, Z, x, tone = "faint", top = Infinity) => {
      const [lo, hi] = spanAt(poly, x);
      return `<path class="iso-line" data-tone="${tone}" d="M${X(x)} ${Z(lo)}L${X(x)} ${Z(Math.min(hi, top))}"/>`;
    };
    // follow-up round 2 (wings): the forward wall is a flat cap whose upper edge, the straight line from the nose up to
    // the wing's LE profile, meets the fairing's rounded top within the hull's crease angle, so no stroke marks it and
    // the panel joints ended on nothing there (Engine 2 view, the 1x orbit). The side panel's upper seam is drawn
    // (faint, parallel to that edge, SEAM_IN inside it, from the bottom joint on the fan cowl's tangent plane until it
    // passes under the wing), and the joints and the access panel end on it.
    const SEAM_IN = 0.03;
    const seamOf = (poly, noseX) => {
      const k0 = poly.findIndex((p) => Math.abs(p[0] - noseX) < 1e-6);
      if (k0 < 0) return null;
      const a = poly[k0];
      const t = poly[(k0 - 1 + poly.length) % poly.length]; // CCW (x aft, z up): the previous vertex is the upper chain's
      const d = [t[0] - a[0], t[1] - a[1]];
      const L = Math.hypot(d[0], d[1]);
      const u = [d[0] / L, d[1] / L];
      const nIn = [u[1], -u[0]]; // the inside of the polygon, below the edge
      const o = [a[0] + SEAM_IN * nIn[0], a[1] + SEAM_IN * nIn[1]];
      // the chord of the line o + s·u through the convex polygon
      const hits = [];
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        const e = [q[0] - p[0], q[1] - p[1]];
        const den = u[0] * e[1] - u[1] * e[0];
        if (Math.abs(den) < 1e-12) continue;
        const w = [p[0] - o[0], p[1] - o[1]];
        const s = (w[0] * e[1] - w[1] * e[0]) / den;
        const r = (w[0] * u[1] - w[1] * u[0]) / den;
        if (r >= -1e-9 && r <= 1 + 1e-9) hits.push(s);
      }
      if (hits.length < 2) return null;
      const s0 = Math.min(...hits);
      const s1 = Math.max(...hits);
      const p0 = [o[0] + s0 * u[0], o[1] + s0 * u[1]];
      const p1 = [o[0] + s1 * u[0], o[1] + s1 * u[1]];
      const zAt = (x) => (x < p0[0] - 1e-9 || x > p1[0] + 1e-9 ? Infinity : lerp(p0[1], p1[1], (x - p0[0]) / (p1[0] - p0[0])));
      return { p0, p1, zAt };
    };
    // follow-up round 2 end
    for (const y of E.ys) {
      const out = Math.sign(y - N.y);
      wall(pyl.fwd, "fwd", y, out, (poly, X, Z) => {
        const xf = E.leFaceX(y);
        const seam = seamOf(poly, N.lip + FWD_RINGS[0][1]);
        const top = (x) => (seam ? seam.zAt(x) : Infinity);
        const xs = [N.lip + 2.7, N.lip + 3.81, lerp(N.lip + 3.81, xf, 0.5)];
        const lines = xs.map((x) => vline(poly, X, Z, x, "faint", top(x))).join("");
        const seamLine = seam ? `<path class="iso-line" data-tone="faint" d="M${X(seam.p0[0])} ${Z(seam.p0[1])}L${X(seam.p1[0])} ${Z(seam.p1[1])}"/>` : "";
        // an access panel between the first two joints, low on the wall
        const x0 = N.lip + 2.45;
        const x1 = N.lip + 3.55;
        const zb = Math.max(spanAt(poly, x0)[0], spanAt(poly, x1)[0]) + 0.1;
        const zt = Math.min(spanAt(poly, x0)[1], spanAt(poly, x1)[1], top(x0), top(x1)) - 0.08;
        const panel = zt - zb > 0.12 ? `<rect class="iso-line" data-tone="lo" x="${X(x0)}" y="${Z(zb)}" width="${fx(m(x1 - x0))}" height="${fx(m(zt - zb))}" rx="0.6"/>` : "";
        return lines + seamLine + panel;
      });
      wall(pyl.mid, "mid", y, out, (poly, X, Z) => [lerp(N.lip + 3.81, E.leFaceX(y), 0.5)].map((x) => vline(poly, X, Z, x)).join(""));
      const aftParts = E.outboard ? (Math.abs(y) < SPLIT_Y ? [["aftA", pyl.aftA]] : [["aftB", pyl.aftB]]) : [["aft", pyl.aft]];
      for (const [, part] of aftParts)
        wall(part, "aft", y, out, (poly, X, Z) => {
          const xf = E.leFaceX(y);
          const xt = E.tipX(y);
          const lines = [lerp(xf, xt, 0.3), lerp(xf, xt, 0.62)].map((x) => vline(poly, X, Z, x)).join("");
          // the heat shield: its upper edge 0.16 m over the fairing's bottom, front face to the tip
          const p0 = poly.find((p) => Math.abs(p[0] - xf) < 1e-9 && p[1] < E.bottomZ(xf, y) - 1e-6);
          const tip = poly.reduce((a, b) => (b[0] > a[0] ? b : a));
          const shield = `<path class="iso-line" data-tone="lo" d="M${X(xf)} ${Z(p0[1] + 0.16)}L${X(tip[0] - 0.16 * ((tip[0] - xf) / Math.max(0.1, tip[1] - p0[1])) * 0)} ${Z(tip[1])}"/>`;
          return lines + shield;
        });
    }

    // ---- labels, GL target, inspect, engine-scan wash constants
    const n1 = `Math.round((s && s.n1 ? s.n1[${i}] : 0) || 0)`;
    const run = `(${n1} < 1 ? "shut down" : "N1 " + ${n1} + "%")`;
    const rev = N.reverser ? "thrust reverser fitted (inboard engines only)" : "no reverser (fixed fan duct, outboard engine)";
    ctx.label(`${tag}.pylon`, new Function("s", `return "Engine ${n} pylon · Toulouse-built strut into the wing front spar · " + ${run};`));
    ctx.label(`${tag}.chine`, new Function("s", `return "Engine ${n} nacelle chine · inboard strake that sheds a vortex over the wing at high incidence";`));
    ctx.label(`${tag}.`, new Function("s", `return "Engine ${n} · Rolls-Royce Trent 970 · " + ${run} + " · ${rev}";`), `engine:${n}`);
    const xl = k([N.lip, 0, 0])[0];
    const constants = {
      y: m(N.y),
      z: m(N.cz),
      xl,
      len: m(8.39),
      rn: m(1.94),
      ri: m(FAN.ri),
      depth: m(FAN.depth),
      rs: m(FAN.rs),
      ls: m(FAN.ls),
      blades: FAN.blades,
      twist: FAN.twist,
      slit: FAN.slit,
      spiral: FAN.spiral,
      spin: sense, // pass run.x = spin · pv.fanPhase[i] so the fan turns clockwise as the reader sees the inlet
      lipPlane: { n: [1, 0, 0], d: xl },
      axis: [-1, 0, 0],
      stations: N.rows.map((r) => ({ part: r.part, s: r.s.map(m), r: r.r.map(m) })),
      wash: { cylinder: { y: m(N.y), z: m(N.cz), r: m(1.94), x0: xl - m(6.2), x1: xl }, lamp: M.LIGHTS.engineScan.find((L) => Math.sign(L.at[1]) === side) },
      phaseSlot: i,
    };
    ctx.glTarget({ name: tag, part: `${tag}.lip`, kind: "nacelle", constants });
    DATA.engines.push({ id: n, reverser: N.reverser, constants });
    report.push(`${tag}: lip ${N.lip} y ${N.y} cz ${N.cz} · LE face ${E.leFaceX(N.y).toFixed(2)} (s ${(E.leFaceX(N.y) - N.lip).toFixed(2)}) · tip ${E.tipX(N.y).toFixed(2)}`);
  }
  // follow-up review 1: 9x (6x framed the engine in 13.5% of the view), the centre 0.5 m up, so the inlet, the fan's
  // crescent and the pylon fill the frame
  // (follow-up round 2: 10x, the nacelle's box 467 x 521 px of the 952 x 674 frame, 38%; 9x framed 31%, under the
  // 35-45% the review asked for)
  ctx.inspect({ id: "engine2", label: "Engine 2", centre: [22.23, -14.8, 3.505], group: "pitch", bearing: -20, zoom: 10, cutaway: 0 });
  // ---- interim WebGL fan (inlet wall, 24 blades as band-limited harmonics, spinner) from the seeded glslEngine
  // generator and the same constants the SVG uses. It steps aside as soon as an effect with id "engines" (M8's
  // engines program, DESIGN §6.1) is registered on the air canvas. Occlusion: the lip's cover set (TURN.cover).
  // (not shipped when M8's lights module builds: its engines program draws the fans, and m4.fans only set the
  // uniform floor and cost a compile at init)
  if (ctx.stubbed("lights") && typeof SH.glslEngine === "function" && typeof SH.glslCover === "function") {
    const inks = { scanDark: [1, 0.95, 0.85], scanTint: [1, 0.86, 0.42], scanCap: 0.42 };
    const f = SH.glsl.f;
    // a marked blade (blade 0 of the harmonic fan), occluded like the fan itself: the lip opening, the inlet
    // wall and the spinner; it fades with the one-per-rev blur gain (run.y), so it reads at low N1 only
    const markOf = (i, e) => {
      const C = `vec2(${f(e.y)},${f(e.z)})`;
      const xf = e.xl - e.depth;
      const k2 = (e.rs / e.ls) ** 2;
      const B = e.blades;
      return `
vec4 mark${i}(vec3 o,vec3 d){
  if(d.x<.015)return vec4(0.);
  vec4 run=uRun${i};
  float face=smoothstep(.015,.12,d.x);
  vec3 pl=o+((${f(e.xl)}-o.x)/d.x)*d;float rl=length(pl.yz-${C});
  float open=(1.-smoothstep(-.5,.5,(rl-${f(e.ri)})/FW(rl)+strokePx()))*face;
  if(open<=0.)return vec4(0.);
  vec3 pf=o+((${f(xf)}-o.x)/d.x)*d;vec2 w=pf.yz-${C};float rf=length(w);
  float onFan=1.-smoothstep(-.5,.5,(rf-${f(e.ri)})/FW(rf));
  float r=rf/${f(e.ri)};
  float q=(atan(w.y,w.x)-run.x+${f(e.twist / B)}*r)*${f(B / (2 * Math.PI))};
  q=mod(q+${f(B / 2)},${f(B)})-${f(B / 2)};
  float mk=smoothstep(.03,.12,q)*(1.-smoothstep(.36,.52,q))*smoothstep(.4,.5,r)*(1.-smoothstep(.9,.97,r));
  vec3 w0=o-vec3(${f(xf + e.ls)},${f(e.y)},${f(e.z)});
  float qa=dot(d.yz,d.yz)-${f(k2)}*d.x*d.x;float qb=dot(w0.yz,d.yz)-${f(k2)}*w0.x*d.x;float qc=dot(w0.yz,w0.yz)-${f(k2)}*w0.x*w0.x;
  float qh=qb*qb-qa*qc;float spin=0.;
  if(qh>0.){
    float sq=sqrt(qh);float t1=(-qb+sq)/qa;float t2=(-qb-sq)/qa;
    float h1=-(w0.x+t1*d.x);float h2=-(w0.x+t2*d.x);
    float t=(h1>=0.&&h1<=${f(e.ls)}&&(t1>t2||h2<0.||h2>${f(e.ls)}))?t1:t2;
    vec3 ps=w0+t*d;float hs=-ps.x;
    spin=smoothstep(-.5,.5,qh/FW(qh))*smoothstep(-.5,.5,(${f(e.ls)}-hs)/FW(hs))*step(0.,hs);
  }
  mk*=onFan*(1.-spin)*open*uMark[${i}];
  vec3 c=vec3(.62,.64,.67)*mk;
  return mix(vec4(c,max(c.r,max(c.g,c.b))),inkFor(vec3(.93,.935,.94),.94)*mk,uLight);
}`;
    };
    const fragment = `${SH.GLSL_COMMON}${glslPose("Plane")}${SH.glslCover(8, 12)}
uniform vec4 uMark;${DATA.engines.map((e, i) => SH.glslEngine(i, e.constants, [], inks) + markOf(i, e.constants)).join("")}
uniform float uSel;
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  float px=uView.x/uCanvas.x;
  vec3 o=toPlane(rayOf(vb));vec3 d=dirToPlane(towardViewer());
  vec4 ink;
  if(uSel<.5)ink=over(mark0(o,d),engine0(o,d));else if(uSel<1.5)ink=over(mark1(o,d),engine1(o,d));else if(uSel<2.5)ink=over(mark2(o,d),engine2(o,d));else ink=over(mark3(o,d),engine3(o,d));
  ink*=1.-coverAt(vb,.7*px);
  gl_FragColor=finish(ink*uFirst*edgeFade(vb));
}`;
    const uniforms = ["uPlaneX", "uPlaneY", "uPlaneZ", "uPlaneT", "uCov", ...DATA.engines.flatMap((_, i) => [`uRun${i}`, `uGain${i}`]), "uSel", "uMark", "uFirst"];
    ctx.glEffect({ id: "m4.fans", canvas: "air", fragment, uniforms });
    DATA.gl = true;
  }
  ctx.data("engines", DATA);

  // ---- CSS: the inlet cavity, the fallback fan, small fasteners (light values first, dark after)
  // (review round 3: every colour a token with its dark override, craft.md §7; the spinner's rotation mark in mid)
  // (the fan tokens are read by the no-WebGL fan canvas; item 16: the pylon pieces' joint seams are gap lines)
  // (follow-up review 1: by daylight the fallback's wall, fan and spinner inks are measured against the GL program at the
  // Engine 2 view, so both painters agree within a few levels; the inlet disc, seen only as a thin band between the
  // drawn fan's opening and the throat, is the wall's tone, not a dark ring)
  // (follow-up round 2: by daylight the inlet ring sits 25 levels over the disc, as it does by night and did on the old
  // dark disc; left at #585d64 on the wall-toned disc it was a near-black ring 0.7 px inside the disc's edge where the
  // lips turn edge-on, and the two edges together read as a band stepping at turns 105-117°, light first difference)
  css.push(`.iso{--a3-inlet:#a4a7aa;--a3-inlet-ring:#bdc0c3;--a3-fan-wall:#a6a8ab;--a3-fan-deep:#56585b;--a3-fan-disc:#36383b;--a3-fan-blade:#56585b;--a3-fan-mark:#8a8f96;--a3-spinner:#66686c;--a3-spinner-rim:#85888c;--a3-spinner-nose:#929498;--a3-spinner-mark:#eef0f2;--a3-gap:#969ca2}
.iso[data-theme="dark"]{--a3-inlet:#08090a;--a3-inlet-ring:#202327;--a3-fan-wall:#24272b;--a3-fan-deep:#060708;--a3-fan-disc:#111316;--a3-fan-blade:#40454b;--a3-fan-mark:#6a7078;--a3-spinner:#4c5156;--a3-spinner-rim:#6a7076;--a3-spinner-nose:#8c9298;--a3-spinner-mark:#c4c9ce;--a3-gap:#5c636a}
.a3-inlet{fill:var(--a3-inlet);stroke:none}
.a3-inlet-ring{fill:none;stroke:var(--a3-inlet-ring);stroke-width:.6}
.a3-fanfb{pointer-events:none}
.a3-stage [data-name^="eng."] [data-r="jm"]{stroke:var(--a3-gap)}
/* follow-up review 1 (tone hierarchy): by night the nacelles' and pylons' outlines and ring lines sit near 165 lum, under
   the one lit phase accent (about 250); the lip's chrome glint (its overlay ramp's top, Inspect zoom) */
.iso[data-theme="dark"] .a3-stage [data-name^="eng."][data-mat]{--anatomy-hi:#a1a7ad}
.iso{--a3-lip-glint:#ffffff;--a3-lip-deep:#a9aeb3}
.iso[data-theme="dark"]{--a3-lip-glint:#8d949b;--a3-lip-deep:#1c1f22}
.a3-eng-screw{fill:var(--anatomy-mid);stroke:none}
/* review round 3: the inlet lips' chrome ramp is monotonic and close (the kit's chrome steps 73 -> 206 between shade-2
   and shade-3, which the 13 sub-bands split into 44-level stairs round the lip); follow-up item 17: the five tones are
   12 levels apart in both themes (they were 12-16), so each of the 13 sub-bands steps by 4 levels at most */
.iso[data-theme="light"] .a3-stage [data-name$=".lip"][data-mat="chrome"]{--anatomy-shade-0:#bcc1c6;--anatomy-shade-1:#c8cdd1;--anatomy-shade-2:#d4d8dc;--anatomy-shade-3:#e1e4e7;--anatomy-top:#edeff1;--anatomy-face:#e1e4e7;--anatomy-paper:#c8cdd1;--anatomy-lit-top:#f7f8f9;--anatomy-lit-shade:#d4d8dc}
.iso[data-theme="dark"] .a3-stage [data-name$=".lip"][data-mat="chrome"]{--anatomy-shade-0:#2c3034;--anatomy-shade-1:#363b3f;--anatomy-shade-2:#40454a;--anatomy-shade-3:#4a4f54;--anatomy-top:#545a5f;--anatomy-face:#4a4f54;--anatomy-paper:#363b3f;--anatomy-lit-top:#646b72;--anatomy-lit-shade:#40454a}`);
  ctx.css(css.join("\n"));

  // ---- page: N1 → shaft speed → fan phase (pv.fanPhase, one per engine), frozen when paused or under reduced motion
  ctx.script(`(() => {
  const D = A3.data.mod.engines;
  A3.on("frame", (fx) => {
    const pv = fx.pv;
    const s = fx.state;
    const phase = (pv.fanPhase ??= D.engines.map(() => 0));
    D.engines.forEach((e, i) => {
      const n1 = (s && s.n1 ? s.n1[i] : 0) || 0;
      const omega = (2 * Math.PI * D.rpm100 * n1) / 100 / 60;
      if (!fx.calm && !pv.paused) phase[i] = (phase[i] + omega * fx.dt) % (2 * Math.PI);
    });
  });
})();`);
  // ---- page: the fan without WebGL (follow-up item 18). A 2D canvas between the airframe and the air canvas draws
  // each fan at its true depth: the fan disc, its 24 blades and the once-per-rev mark in the fan plane (1.88 m behind
  // the lip), and the spinner as the cone in front of it, all clipped to the inlet opening (the lip plane's circle) and
  // masked by the parts in front of the lip (TURN.cover, as the GL fan is). So only the parallax crescent the shader
  // shows is seen, the blades turn about the fan's own centre, and the fallback fades in with (1 − glShare): a lost
  // context crossfades into the same crescent, never a full fan. Both painters (canvas and SVG) get it.
  ctx.script(`(() => {
  const D = A3.data.mod.engines;
  const stage = document.querySelector(".a3-stage");
  const air = stage && stage.querySelector('[data-canvas="air"]');
  if (!stage || !air) return;
  const cv = document.createElement("canvas");
  cv.className = "iso-layer a3-fanfb";
  cv.setAttribute("aria-hidden", "true");
  air.before(cv);
  const g = cv.getContext("2d");
  const css = getComputedStyle(stage);
  const tok = (name, fb) => (css.getPropertyValue(name).trim() || fb);
  const ink = { wall: tok("--a3-fan-wall", "#1c1f22"), deep: tok("--a3-fan-deep", "#050607"), disc: tok("--a3-fan-disc", "#16181b"), blade: tok("--a3-fan-blade", "#5d636b"), mark: tok("--a3-fan-mark", "#6a7078"), spinner: tok("--a3-spinner", "#2a2e33"), rim: tok("--a3-spinner-rim", "#4a5057"), nose: tok("--a3-spinner-nose", "#5d636b"), spiral: tok("--a3-spinner-mark", "#aeb4ba") };
  // fu/f4-wings: the spinner shaded with the GL spinner's two tones (--a3-gl-spinner, --a3-gl-spinner-lit: by day mixed by the
  // lit tone, at night the lit tone added to the base), dark-rimmed as the GL rim (x .78); the light from the GL's lightDir
  const rgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim()); const n = m ? parseInt(m[1], 16) : 0x808080; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const night = !!(stage.closest('[data-theme="dark"]') || document.querySelector('.iso[data-theme="dark"]'));
  const spinTone = (() => {
    const b = rgb(tok("--a3-gl-spinner", night ? "#1a1a1a" : "#666666"));
    const l = rgb(tok("--a3-gl-spinner-lit", night ? "#474747" : "#999999"));
    return (t, k = 1) => "rgb(" + b.map((v, j) => Math.round(Math.min(255, (night ? v + l[j] * t : v + (l[j] - v) * t) * k))).join(",") + ")";
  })();
  // fu/f4-wings end
  const gain = (x) => (typeof blurGain === "function" ? blurGain(x) : Math.max(0, 1 - x / Math.PI));
  const still = (x, fl) => (typeof stillGain === "function" ? stillGain(x, fl) : Math.max(fl, 1 - x / Math.PI));
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const P = 8;
  const E = 12;
  const cache = D.engines.map(() => null);
  const lightOf = D.engines.map(() => null); // fu/f4-wings: the GL light in each nacelle's frame
  let markInk = null; // fu/f4-wings: the once-per-rev mark's conic gradient (fan-plane coordinates, about angle 0)
  let drawn = false;
  let size = "";
  // the stage's size from a ResizeObserver, so the frame loop never reads layout
  let boxW = 0;
  let boxH = 0;
  { const b = stage.getBoundingClientRect(); boxW = b.width; boxH = b.height; }
  let lipSig = "";
  let lipCoarse = false; // f3 (wings): the lips on screen were drawn at the moving detail
  let lipRest = 0; // f3 (wings): frames since the pose or the view last moved
  if (typeof ResizeObserver === "function")
    new ResizeObserver((list) => {
      const e = list[list.length - 1];
      const bb = e.borderBoxSize && e.borderBoxSize[0];
      boxW = bb ? bb.inlineSize : e.contentRect.width;
      boxH = bb ? bb.blockSize : e.contentRect.height;
      lipSig = "";
    }).observe(stage);
  // ---- follow-up item 17: the inlet lip's chrome as one continuous ramp. The kit fills a round's 13 sub-bands flat
  // (kit patch 17), so at Inspect zoom the lip, the brightest and most curved surface in the Engine view, still reads
  // as a staircase of 4-level steps on 45-106 px treads. Where a lip's projected radius passes 60 device px (Inspect
  // zoom; 32 at 1x and DPR 2), this canvas paints its conical surface again with the kit's own facing ramp made
  // continuous (the light score through the T3_HS tone centres, the lip's five --tn tones interpolated as the painter
  // does), inset from its rims and silhouettes so the kit's lines stay, and masked by the parts in front of the lip as
  // the fan is. At 1x it costs nothing.
  const HS = typeof T3_HS !== "undefined" ? T3_HS : [-0.15, 0.1, 0.31, 0.52, 0.85];
  const rgbOf = (value) => {
    g.fillStyle = "#000";
    g.fillStyle = value;
    const v = String(g.fillStyle);
    if (v[0] === "#") return [1, 3, 5].map((k) => parseInt(v.slice(k, k + 2), 16));
    const n = v.match(/[\\d.]+/g);
    return n && n.length >= 3 ? n.slice(0, 3).map(Number) : null;
  };
  // the lip's five tones, read from a probe with the lip's own attributes (the canvas painter removed the live SVG),
  // and (follow-up review 1) a deep stop under them and the chrome's narrow glint over them, tokens of this module
  const tones = (() => {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "iso-live");
    svg.style.display = "none";
    const node = document.createElementNS(NS, "g");
    node.setAttribute("data-name", "eng.0.lip");
    node.setAttribute("data-mat", "chrome");
    svg.appendChild(node);
    stage.appendChild(svg);
    const cs = getComputedStyle(node);
    const out = [0, 1, 2, 3, 4].map((k) => { const v = cs.getPropertyValue("--tn-" + k).trim(); return v ? rgbOf(v) : null; });
    const glint = cs.getPropertyValue("--a3-lip-glint").trim();
    const deep = cs.getPropertyValue("--a3-lip-deep").trim();
    out.push(glint ? rgbOf(glint) : out[4]);
    out.unshift(deep ? rgbOf(deep) : out[0]);
    svg.remove();
    return out.every(Boolean) ? out : null;
  })();
  const lipRuns = D.engines.map(() => null);
  // tone position 0..6 on the ramp for a light score: a deep stop under the kit's bottom tone (score -0.6 -> -0.15),
  // the kit's sub-band centres joined linearly (1..5), then the glint over the top tone's centre (score 0.85 -> 1)
  const toneAt = (score) => {
    if (score <= HS[0]) return Math.max(0, 1 - (HS[0] - score) / (HS[0] + 0.6));
    for (let k = 0; k < 4; k++) if (score <= HS[k + 1]) return 1 + k + (score - HS[k]) / (HS[k + 1] - HS[k]);
    return 5 + Math.min(1, (score - HS[4]) / (1 - HS[4]));
  };
  const inkAt = (u) => {
    const k = Math.min(5, Math.floor(u));
    const t = u - k;
    const a = tones[k];
    const b = tones[k + 1];
    return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * t) + "," + Math.round(a[1] + (b[1] - a[1]) * t) + "," + Math.round(a[2] + (b[2] - a[2]) * t) + ")";
  };
  // a lip's projection now (t3Geo's terms): screen origin and axes, view and light against the lip's frame
  const lipOf = (c, i, K) => {
    let run = lipRuns[i];
    if (!run) run = lipRuns[i] = c.scene().runs.find((r) => r.name === "eng." + D.engines[i].id + ".lip") || false;
    if (!run || !run.F) return null;
    const cams = c.cams();
    const cam = run.group >= 0 ? cams[run.group] : cams.world;
    const m = cam.m;
    const F = run.F;
    const lin = (w) => [m[0] * w[0] + m[1] * w[1] + m[2] * w[2], m[3] * w[0] + m[4] * w[1] + m[5] * w[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const SU = lin(F.u);
    const SV = lin(F.v);
    const radPx = run.r1 * Math.max(Math.hypot(SU[0], SU[1]), Math.hypot(SV[0], SV[1])) * K;
    if (radPx < 60) return null;
    const uV = dot(F.u, cam.V);
    const vV = dot(F.v, cam.V);
    const uL = dot(F.u, cam.L);
    const vL = dot(F.v, cam.L);
    return {
      run, radPx, SU, SV, SA: lin(F.a),
      O: [cam.ox + m[0] * F.o[0] + m[1] * F.o[1] + m[2] * F.o[2], cam.oy + m[3] * F.o[0] + m[4] * F.o[1] + m[5] * F.o[2]],
      view: { a: dot(F.a, cam.V), flat: Math.hypot(uV, vV), phi: Math.atan2(vV, uV) },
      light: { a: dot(F.a, cam.L), flat: Math.hypot(uL, vL), phi: Math.atan2(vL, uL) },
    };
  };
  // follow-up review 1: the lip shades across its section too, as a rounded lip does. The front cap's annulus (from the
  // throat's accent ring to the rim) and the cone (from the rim to the outer silhouette) are painted as one section
  // whose normal turns from inward at the throat (LIP_A0 from the inlet's axis) through forward to outward (LIP_A1),
  // lit with the kit's own score (nr·L.flat·cos(φ − L.φ) + na·L.a), so the lip runs from dark at the throat to a narrow
  // glint on its outer-forward quadrant, with the circumferential ramp kept. The cap/cone rim (a faint seam) is painted
  // over; the outer rim and silhouettes keep their kit lines (inset), and the accent ring at the throat stays.
  const LIP_A0 = (20 * Math.PI) / 180;
  const LIP_A1 = (172 * Math.PI) / 180;
  // f3 (wings): the lip's detail. At rest each quad's gradient along the section has 4 linear pieces (5 stops); while
  // the pose or the view moves it has 2 (3 stops), the same quads (drawLip's addColorStop cost about 1 ms a frame at
  // Inspect zoom, r2-perf). A coarser circumferential step was tried first: at 10 px its flat sectors read as stripes
  // in motion; fewer pieces along the section keep the ramp smooth both ways. The lip is redrawn at full detail
  // LIP_REST frames after the motion stops (the loop runs 20 quiet frames before it sleeps), so the still picture is
  // the full one (DESIGN §0, decision 0).
  const LIP_STEP = 5;
  const LIP_PIECES = 4;
  const LIP_PIECES_MOVING = 2;
  const LIP_REST = 3;
  const drawLip = (L, X, ins, alpha, covers, rAcc, pieces = LIP_PIECES) => {
    const { run, SU, SV, SA, O, view, light } = L;
    const at = (s, r, t) => X([O[0] + s * SA[0] + r * (Math.cos(t) * SU[0] + Math.sin(t) * SV[0]), O[1] + s * SA[1] + r * (Math.cos(t) * SU[1] + Math.sin(t) * SV[1])]);
    // the cone's facing generators: all of them, none, or the arc between the two silhouettes
    let lo = 0;
    let hi = 2 * Math.PI;
    let sil = null;
    let cone = true;
    if (view.flat > 1e-9) {
      const cut = -(run.na * view.a) / (run.nr * view.flat);
      if (cut >= 1) cone = false;
      else if (cut > -1) {
        const d = Math.acos(cut);
        lo = view.phi - d;
        hi = view.phi + d;
        sil = [lo, hi].map((t) => [at(run.s0, run.r0, t), at(run.s1, run.r1, t)]);
      }
    } else if (!(run.na * view.a > 0)) cone = false;
    const cap = view.a < -1e-9; // the front cap faces the reader
    if (!cap && !cone) return;
    // the section: u 0 at the inset throat, uc at the rim, 1 at the outer rim
    const ppu = L.radPx / run.r1;
    const rA = Math.min(run.r0 - 0.5, rAcc + ins / ppu);
    const capLen = Math.max(0, run.r0 - rA);
    const coneLen = Math.hypot(run.s1 - run.s0, run.r1 - run.r0);
    const uc = capLen / (capLen + coneLen);
    const inkOf = (u, t) => {
      const a = LIP_A0 + (LIP_A1 - LIP_A0) * u;
      return inkAt(toneAt(-Math.cos(a) * light.flat * Math.cos(t - light.phi) - Math.sin(a) * light.a));
    };
    const n = Math.max(96, Math.min(360, Math.ceil((2 * Math.PI * L.radPx) / LIP_STEP)));
    g.save();
    for (const poly of covers) {
      g.beginPath();
      g.rect(0, 0, cv.width, cv.height);
      const p0 = X(poly[0]);
      g.moveTo(p0[0], p0[1]);
      for (let q = poly.length - 1; q >= 1; q--) { const p = X(poly[q]); g.lineTo(p[0], p[1]); }
      g.closePath();
      g.clip("evenodd");
    }
    g.globalAlpha = alpha;
    g.lineWidth = 0.75;
    g.lineJoin = "round";
    // one quad per generator step and per part of the section, filled (and stroked, to close the seams) with a linear
    // gradient along the section at the step's middle
    const quad = (p0, p1, p2, p3, a, b, u0, u1, tm) => {
      const gr = g.createLinearGradient(a[0], a[1], b[0], b[1]);
      for (let k = 0; k <= pieces; k++) gr.addColorStop(k / pieces, inkOf(u0 + ((u1 - u0) * k) / pieces, tm));
      g.beginPath();
      g.moveTo(p0[0], p0[1]);
      g.lineTo(p1[0], p1[1]);
      g.lineTo(p2[0], p2[1]);
      g.lineTo(p3[0], p3[1]);
      g.closePath();
      g.fillStyle = g.strokeStyle = gr;
      g.fill();
      g.stroke();
    };
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    // the cone first (the cap is in front of it), over its facing arc, its outer end inset across the outer rim and the
    // generators near a silhouette left to the kit
    if (cone) {
      const span = hi - lo;
      const m = Math.max(24, Math.ceil((n * span) / (2 * Math.PI)));
      const gen = [];
      for (let j = 0; j <= m; j++) {
        const t = lo + (span * j) / m;
        const a = at(run.s0, run.r0, t);
        const b = at(run.s1, run.r1, t);
        const gx = b[0] - a[0];
        const gy = b[1] - a[1];
        const len = Math.hypot(gx, gy);
        const tx = -Math.sin(t) * SU[0] + Math.cos(t) * SV[0];
        const ty = -Math.sin(t) * SU[1] + Math.cos(t) * SV[1];
        const across = len > 1e-9 ? Math.abs(tx * gy - ty * gx) / (Math.hypot(tx, ty) * len || 1) : 0;
        const step = ins / Math.max(across, 0.25);
        let ok = len > step + 1;
        const f1 = ok ? (len - step) / len : 1;
        const q1 = [a[0] + gx * f1, a[1] + gy * f1];
        if (ok && sil)
          for (const [s0p, s1p] of sil) {
            const ex = s1p[0] - s0p[0];
            const ey = s1p[1] - s0p[1];
            const el = Math.hypot(ex, ey) || 1;
            for (const q of [a, q1]) if (Math.abs((q[0] - s0p[0]) * ey - (q[1] - s0p[1]) * ex) / el < ins) ok = false;
          }
        gen.push({ t, ok, a, q1, u1: uc + (1 - uc) * f1 });
      }
      for (let j = 0; j < m; j++) {
        const A = gen[j];
        const B = gen[j + 1];
        if (!A.ok || !B.ok) continue;
        quad(A.a, B.a, B.q1, A.q1, mid(A.a, B.a), mid(A.q1, B.q1), uc, Math.min(A.u1, B.u1), (A.t + B.t) / 2);
      }
    }
    if (cap && capLen > 0) {
      let prevIn = null;
      let prevOut = null;
      for (let j = 0; j <= n; j++) {
        const t = (2 * Math.PI * j) / n;
        const pin = at(run.s0, rA, t);
        const pout = at(run.s0, run.r0, t);
        if (prevIn) quad(prevIn, pin, pout, prevOut, mid(prevIn, pin), mid(prevOut, pout), 0, uc, t - Math.PI / n);
        prevIn = pin;
        prevOut = pout;
      }
    }
    g.restore();
  };
  const hull = (pts) => {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [];
    for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    const up = [];
    for (let k = p.length - 1; k >= 0; k--) { const q = p[k]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  };
  // one engine's projected frames: kit points on pitch → viewBox; affine (the camera is orthographic)
  const framesOf = (c, C) => {
    const at = (p) => c.anchor("pitch", p).screen;
    const L = [C.xl, C.y, C.z];
    const Fp = [C.xl - C.depth, C.y, C.z];
    const o = at(L);
    const f = at(Fp);
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
    return {
      lip: { o, u: sub(at([L[0], L[1] + 1, L[2]]), o), v: sub(at([L[0], L[1], L[2] + 1]), o) },
      fan: { o: f, u: sub(at([Fp[0], Fp[1] + 1, Fp[2]]), f), v: sub(at([Fp[0], Fp[1], Fp[2] + 1]), f), a: sub(at([Fp[0] + 1, Fp[1], Fp[2]]), f) },
    };
  };
  // the parts in front of an engine's lip (TURN.cover, as the GL fan): their outlines' hulls, recomputed when moved
  let tick = 0;
  const coversOf = (c, C, e, i, moved) => {
    if ((moved && cache[i] && cache[i].tick !== tick) || !cache[i]) {
      const f = framesOf(c, C);
      const cov = TURN.cover(c, ["eng." + e.id + ".lip"], { polygons: P, edges: E });
      const frames = c.frames();
      const runs = c.scene().runs;
      f.covers = cov.parts.map((name) => {
        const run = runs.find((r) => r.name === name);
        const fr = run && frames[run.index];
        if (!fr) return null;
        const pts = [];
        if (fr.quadN) for (const [buf, count] of fr.quadList) for (let q = 0; q < count; q++) pts.push([buf[2 * q], buf[2 * q + 1]]);
        else for (let q = 0; q < fr.hullN; q++) pts.push([fr.hull[2 * q], fr.hull[2 * q + 1]]);
        return pts.length >= 3 ? hull(pts) : null;
      }).filter(Boolean);
      f.tick = tick;
      cache[i] = f;
    }
    return cache[i];
  };
  A3.on("frame", (fx) => {
    tick++;
    lipRest = fx.moved ? 0 : lipRest + 1;
    const share = 1 - (fx.share || 0);
    const c = fx.controller;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    // viewBox → canvas pixels: the stage's SVG layers fit the view window (A3GL.view: w, h, x, y) with "meet"
    const view = (typeof A3GL !== "undefined" && A3GL.view) || [960, 680, 0, 0];
    const fit = Math.min(boxW / view[0], boxH / view[1]);
    const K = fit * dpr;
    // the lips big enough to show the kit's sub-band treads (item 17); none at 1x
    const lips = tones ? D.engines.map((e, i) => lipOf(c, i, K)) : [];
    const anyLip = lips.some(Boolean);
    const fans = share >= 0.002;
    // with WebGL drawing the fans and no lip at Inspect zoom this costs nothing per frame: clear once and return
    if (!fans && !anyLip) {
      if (drawn) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); drawn = false; }
      lipSig = "";
      lipCoarse = false;
      return;
    }
    const key = Math.round(boxW * dpr) + "x" + Math.round(boxH * dpr);
    // the lips alone change only with the pose, the view or the size
    const sig = key + "|" + view.join(",") + "|" + fans;
    if (!fans && drawn && !fx.moved && sig === lipSig && !(lipCoarse && lipRest >= LIP_REST)) return;
    lipSig = sig;
    if (key !== size) {
      size = key;
      cv.width = Math.max(1, Math.round(boxW * dpr));
      cv.height = Math.max(1, Math.round(boxH * dpr));
    }
    drawn = true;
    const pv = fx.pv;
    const s = fx.state;
    const V = c.cams().world.V;
    const ox = (boxW - view[0] * fit) / 2;
    const oy = (boxH - view[1] * fit) / 2;
    const X = (p) => [((p[0] - view[2]) * fit + ox) * dpr, ((p[1] - view[3]) * fit + oy) * dpr];
    // a stroke width in viewBox units, as the SVG fan's were, capped at Inspect zoom (2 CSS px for a 0.6 line)
    const lw = (w) => Math.min(w * K, (w / 0.6) * 1.2 * dpr);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    // the lips: inset 1.6 CSS px from the kit's rim and outline strokes, faded in over 60-100 device px of radius
    // (f3, wings: at the moving detail until LIP_REST frames after the pose or the view last moved, so a settling view's
    // sparse steps do not each cost a full redraw; never under reduced motion, whose one frame is a still)
    const lipPieces = lipRest < LIP_REST && !fx.calm ? LIP_PIECES_MOVING : LIP_PIECES;
    lipCoarse = anyLip && lipPieces !== LIP_PIECES;
    lips.forEach((L, i) => {
      if (!L) return;
      const e = D.engines[i];
      drawLip(L, X, 1.6 * dpr, sm(60, 100, L.radPx), coversOf(c, e.constants, e, i, fx.moved).covers, e.constants.ri + D.lipAcc, lipPieces);
    });
    if (!fans) return;
    // fu/f4-wings: the GL fan's exposure (gl/passes.js: dt, 0 while paused), so a paused fan's 24 blades stay sharp
    const exposure = fx.calm ? 1 / 500 : pv.paused ? 0 : Math.min(Math.max(0, fx.dt || 0), 1 / 30);
    D.engines.forEach((e, i) => {
      const C = e.constants;
      const a = c.anchor("pitch", [C.xl, C.y, C.z], [1, 0, 0]);
      const facing = a.direction ? a.direction[0] * V[0] + a.direction[1] * V[1] + a.direction[2] * V[2] : 0;
      if (facing < 0.015) return;
      const f = coversOf(c, C, e, i, fx.moved);
      const n1 = ((s && s.n1 ? s.n1[i] : 0) || 0) / 100;
      const omega = (2 * Math.PI * D.rpm100 * n1) / 60;
      const phase = (pv.fanPhase ? pv.fanPhase[i] : 0) * C.spin;
      const gb = (fx.calm ? still(C.blades * omega * exposure, 0.35) : gain(C.blades * omega * exposure)) * share;
      const gs = (fx.calm ? still(omega * exposure, 0.3) : gain(omega * exposure)) * share;
      const gm = sm(0.003, 0.03, n1) * (1 - sm(0.8, 2.2, omega * exposure)) * share;
      const fade = sm(0.015, 0.12, facing);
      const onLip = (u, v) => X([f.lip.o[0] + u * f.lip.u[0] + v * f.lip.v[0], f.lip.o[1] + u * f.lip.u[1] + v * f.lip.v[1]]);
      const onFan = (u, v, w = 0) => X([f.fan.o[0] + u * f.fan.u[0] + v * f.fan.v[0] + w * f.fan.a[0], f.fan.o[1] + u * f.fan.u[1] + v * f.fan.v[1] + w * f.fan.a[1]]);
      const ring = (map, r, n = 72) => { g.beginPath(); for (let q = 0; q <= n; q++) { const t = (2 * Math.PI * q) / n; const p = map(r * Math.cos(t), r * Math.sin(t)); q ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); } g.closePath(); };
      g.save();
      // the masks: the parts in front of the lip, then the inlet opening (the dark disc's circle in the lip plane)
      for (const poly of f.covers) {
        g.beginPath();
        g.rect(0, 0, cv.width, cv.height);
        const q0 = X(poly[0]);
        g.moveTo(q0[0], q0[1]);
        for (let q = poly.length - 1; q >= 1; q--) { const p = X(poly[q]); g.lineTo(p[0], p[1]); }
        g.closePath();
        g.clip("evenodd");
      }
      ring(onLip, C.ri - 0.3);
      g.clip();
      g.globalAlpha = share * fade;
      // the inlet wall seen through the opening, as the shader shades it: light near the lip, deep toward the fan
      {
        const fc = onFan(0, 0);
        const lc = onLip(0, 0);
        const reach = Math.hypot(lc[0] - fc[0], lc[1] - fc[1]) + Math.hypot(f.lip.u[0], f.lip.u[1]) * C.ri * K;
        const wg = g.createRadialGradient(fc[0], fc[1], 0, fc[0], fc[1], Math.max(1, reach));
        wg.addColorStop(0, ink.deep);
        wg.addColorStop(1, ink.wall);
        ring(onLip, C.ri);
        g.fillStyle = wg;
        g.fill();
      }
      // the fan disc (darker than the wall), then the blades as the leading edges seen from the front
      ring(onFan, C.ri);
      g.fillStyle = ink.disc;
      g.fill();
      // the blades twist as the shader's do (twist/blades radians from the axis to the tip, GL.md: u = B(θ − φ) + twist·r)
      const sweep = -C.twist / C.blades;
      const pol = (r, th) => [r * Math.cos(th), r * Math.sin(th)];
      const blade = (th, r0 = C.rs - 0.6) => {
        for (let q = 0; q <= 4; q++) {
          const r = r0 + ((C.ri - 0.05 - r0) * q) / 4;
          const A = pol(r, th + (sweep * r) / C.ri);
          const p = onFan(A[0], A[1]);
          q ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]);
        }
      };
      g.lineCap = "round";
      if (gb > 0.004) {
        // follow-up review 1: each blade shaded as the shader's sawtooth does (light just after its leading edge, falling
        // to the disc's tone at the next blade), a two-stop gradient across the blade, not a pale line on a dark sector
        const pitch = (2 * Math.PI) / C.blades;
        const r0 = C.rs - 0.6;
        const r1 = C.ri - 0.05;
        const rm = (r0 + r1) / 2;
        g.globalAlpha = gb * fade;
        for (let b = 0; b < C.blades; b++) {
          const th = phase + b * pitch;
          const edge = (r, k) => pol(r, th + k * pitch + (sweep * r) / C.ri);
          g.beginPath();
          for (let q = 0; q <= 4; q++) { const r = r0 + ((r1 - r0) * q) / 4; const p = onFan(...edge(r, 0.06)); q ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]); }
          for (let q = 4; q >= 0; q--) { const r = r0 + ((r1 - r0) * q) / 4; const p = onFan(...edge(r, 1)); g.lineTo(p[0], p[1]); }
          g.closePath();
          const pa = onFan(...edge(rm, 0.06));
          const pb = onFan(...edge(rm, 0.98));
          const gr = g.createLinearGradient(pa[0], pa[1], pb[0], pb[1]);
          gr.addColorStop(0, ink.blade);
          gr.addColorStop(1, ink.disc);
          g.fillStyle = gr;
          g.fill();
        }
      }
      // the blur: the turning blades merge into a disc of the blade tone as their 24-per-rev pattern band-limits
      // (fu/f4-wings: at 0.5, the blades' mean cover, as the GL fan's harmonics average to; at 0.22 the blurred disc
      // read 10-15 levels darker than GL's in both themes)
      g.globalAlpha = (share - gb) * 0.5 * fade;
      ring(onFan, C.ri - 0.05);
      g.fillStyle = ink.blade;
      g.fill();
      if (gm > 0.004) {
        // the once-per-rev mark (fu/f4-wings): the GL program's wedge, not a line and a dot. In the fan plane's own
        // coordinates (an affine map: the camera is orthographic) a conic gradient carries the GL's angular profile
        // smoothstep(.975, .998, cos Δ) about the marked blade (its twist taken at mid radius), filled as rings that step
        // the GL's radial ramps (in over r .42-.55, out over .86-.95 of the inlet radius)
        const b0 = onFan(0, 0);
        const bu = onFan(1, 0);
        const bv = onFan(0, 1);
        const det = (bu[0] - b0[0]) * (bv[1] - b0[1]) - (bu[1] - b0[1]) * (bv[0] - b0[0]);
        if (typeof g.createConicGradient === "function" && Math.abs(det) > 1e-6) {
          g.setTransform(bu[0] - b0[0], bu[1] - b0[1], bv[0] - b0[0], bv[1] - b0[1], b0[0], b0[1]);
          g.rotate(phase + sweep * 0.7);
          // the gradient about angle 0 (the transform turns it to the blade), made once: its stops never change
          const cg = (markInk ??= (() => {
            const grad = g.createConicGradient(-Math.PI, 0, 0);
            const lo = Math.acos(0.975);
            const N = 4;
            const mc = rgb(ink.mark);
            grad.addColorStop(0, "rgba(0,0,0,0)");
            grad.addColorStop((Math.PI - lo - 0.01) / (2 * Math.PI), "rgba(0,0,0,0)");
            for (let q = -N; q <= N; q++) {
              const dl = (lo * q) / N;
              grad.addColorStop((Math.PI + dl) / (2 * Math.PI), "rgba(" + mc.join(",") + "," + sm(0.975, 0.998, Math.cos(dl)).toFixed(3) + ")");
            }
            grad.addColorStop((Math.PI + lo + 0.01) / (2 * Math.PI), "rgba(0,0,0,0)");
            grad.addColorStop(1, "rgba(0,0,0,0)");
            return grad;
          })());
          g.fillStyle = cg;
          // three rings: the two ramps at their mean weight (0.5) and the full ring between them
          const bands = [[0.42, 0.55], [0.55, 0.86], [0.86, 0.95]];
          for (const [r0, r1] of bands) {
            const rm = (r0 + r1) / 2;
            const w = sm(0.42, 0.55, rm) * (1 - sm(0.86, 0.95, rm));
            g.beginPath();
            g.arc(0, 0, r1 * C.ri, 0, 2 * Math.PI);
            g.arc(0, 0, r0 * C.ri, 0, 2 * Math.PI, true);
            g.globalAlpha = gm * fade * w;
            g.fill();
          }
          g.setTransform(1, 0, 0, 1, 0, 0);
        }
      }
      // the spinner: half an ellipsoid on the fan plane (radius rs, length ls forward), as the GL program draws it; its
      // silhouette is the hull of the projected surface
      const pts = [];
      for (let q = 0; q < 36; q++) {
        const t = (2 * Math.PI * q) / 36;
        for (const ph of [0, 0.35, 0.7, 1.05, 1.4, Math.PI / 2]) pts.push(onFan(C.rs * Math.cos(ph) * Math.cos(t), C.rs * Math.cos(ph) * Math.sin(t), C.ls * Math.sin(ph)));
      }
      const sil = hull(pts);
      g.beginPath();
      sil.forEach((p, q) => (q ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
      g.closePath();
      g.globalAlpha = share * fade;
      // fu/f4-wings: shaded as the GL spinner (tone .35 + .55 n·L, gl/shaders.mjs glslNacelle): a radial ramp from the point
      // whose normal is the light (the lit dome) to the far silhouette, in the GL's two tones; dark-rimmed (x .78)
      // (the light in the nacelle's frame changes only with the view or the pose: kept per engine until either moves)
      if (fx.moved || !lightOf[i]) {
        const Lw = (() => { const cw = Math.hypot(V[0], V[1]) || 1; const L = [-V[1] / cw, V[0] / cw, 1.2]; const n = Math.hypot(...L); return L.map((x) => x / n); })();
        const ax = (dir) => { const q = c.anchor("pitch", [C.xl, C.y, C.z], dir).direction || dir; return Lw[0] * q[0] + Lw[1] * q[1] + Lw[2] * q[2]; };
        lightOf[i] = [ax([1, 0, 0]), ax([0, 1, 0]), ax([0, 0, 1])];
      }
      const Lp = lightOf[i];
      const poleN = Math.sqrt(C.ls * C.ls * Lp[0] * Lp[0] + C.rs * C.rs * (Lp[1] * Lp[1] + Lp[2] * Lp[2])) || 1;
      const pole = Lp[0] > 0 ? onFan((C.rs * C.rs * Lp[1]) / poleN, (C.rs * C.rs * Lp[2]) / poleN, (C.ls * C.ls * Lp[0]) / poleN) : onFan(0, 0, C.ls);
      const far = sil.reduce((best, p) => Math.max(best, Math.hypot(p[0] - pole[0], p[1] - pole[1])), 1);
      const grad = g.createRadialGradient(pole[0], pole[1], 0, pole[0], pole[1], far);
      grad.addColorStop(0, spinTone(0.9));
      grad.addColorStop(0.55, spinTone(0.62));
      grad.addColorStop(1, spinTone(0.35));
      g.fillStyle = grad;
      g.fill();
      g.strokeStyle = spinTone(0.35, 0.78);
      g.lineWidth = lw(0.6);
      g.stroke();
      // fu/f4-wings end
      // the spinner's one-arm spiral (the near half only)
      if (gs > 0.004) {
        // the spiral on the ellipsoid, drawn where the surface faces the reader (the sign of the projected surface
        // element against a point near the nose, which always faces the reader when the inlet does)
        const proj = (u, v, w) => [u * f.fan.u[0] + v * f.fan.v[0] + w * f.fan.a[0], u * f.fan.u[1] + v * f.fan.v[1] + w * f.fan.a[1]];
        const facingAt = (th, ph) => {
          const a1 = proj(-Math.cos(ph) * Math.sin(th) * C.rs, Math.cos(ph) * Math.cos(th) * C.rs, 0);
          const a2 = proj(-Math.sin(ph) * Math.cos(th) * C.rs, -Math.sin(ph) * Math.sin(th) * C.rs, Math.cos(ph) * C.ls);
          return a1[0] * a2[1] - a1[1] * a2[0];
        };
        const front = Math.sign(facingAt(0, 1.35)) || 1;
        g.beginPath();
        let open = false;
        for (let q = 0; q <= 32; q++) {
          const t = 0.18 + (0.74 * q) / 32;
          // fu/f4-wings: the GL stripe's law (su = θ − φ + 2π·spiral·hz = 0, hz the depth from the nose over ls)
          const ph = Math.acos(Math.min(1, t));
          const th = phase - 2 * Math.PI * C.spiral * (1 - Math.sin(ph));
          if (facingAt(th, ph) * front <= 0) {
            open = false;
            continue;
          }
          const p = onFan(C.rs * t * Math.cos(th), C.rs * t * Math.sin(th), C.ls * Math.sin(ph));
          open ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]);
          open = true;
        }
        g.strokeStyle = ink.spiral;
        g.lineWidth = lw(1.1);
        g.globalAlpha = gs * fade;
        g.stroke();
      }
      g.restore();
    });
    g.globalAlpha = 1;
  });
})();`);
  ctx.script(`(() => {
  const D = A3.data.mod.engines;
  if (!D.gl) return;
  const P = 8;
  const E = 12;
  const cache = { covers: D.engines.map(() => new Float32Array(P * E * 3)), at: [] };
  const mark = new Float32Array(D.engines.length);
  A3GL.effect({
    id: "m4.fans",
    canvas: "air",
    active: () => !(A3GL.layers.air || []).some((spec) => spec.id === "engines"),
    draw(fx, pass) {
      const c = fx.controller;
      const pv = fx.pv;
      const s = fx.state;
      const V = c.cams().world.V;
      const k = fx.data.camera.k;
      const pose = TURN.poseUniforms(c, "pitch", "uPlane");
      const exposure = fx.calm ? 1 / 500 : Math.min(fx.dt, 1 / 30);
      D.engines.forEach((e, i) => {
        const C = e.constants;
        if (fx.moved || !cache.at[i]) {
          cache.at[i] = c.anchor("pitch", [C.xl, C.y, C.z], [1, 0, 0]);
          packCovers(TURN.cover(c, ["eng." + e.id + ".lip"], { polygons: P, edges: E }), P, E, cache.covers[i]);
        }
        const a = cache.at[i];
        const facing = a.direction ? a.direction[0] * V[0] + a.direction[1] * V[1] + a.direction[2] * V[2] : 0;
        if (facing < 0.015) return;
        const n1 = (s && s.n1 ? s.n1[i] : 0) || 0;
        const omega = (2 * Math.PI * D.rpm100 * n1) / 100 / 60;
        const phase = (pv.fanPhase ? pv.fanPhase[i] : 0) * C.spin;
        const R = C.rn * k + 3;
        const values = { ...pose, uCov: cache.covers[i], uSel: i, uFirst: fx.first };
        values["uRun" + i] = [phase, blurGain(omega * exposure), n1 / 100, 0];
        values["uGain" + i] = fanGains(omega, exposure, C.blades);
        mark[i] = blurGain(D.markBlur * omega * exposure);
        values.uMark = mark;
        pass(values, [a.screen[0] - R, a.screen[1] - R, a.screen[0] + R, a.screen[1] + R]);
      });
    },
  });
})();`);
  ctx.report(`${engines.length} engines · fan sense ${sense > 0 ? "u→v clockwise" : "u→v anticlockwise"} on screen nose-on · k ${fit.k.toFixed(3)}`);
  for (const line of report) ctx.report(line);
  void G;
}

// --------------------------------------------------------------------------------------------- checks
export function checks(ctx, out) {
  void out;
  const { W, M } = ctx;
  const fromKit = W.fromKit;
  const fails = [];
  const lines = [];
  const say = (line) => {
    lines.push(line);
    console.log(`M4: ${line}`);
  };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;
  const truthClear = { inboard: 1.065, outboard: 1.9 };
  for (const N of W.NACELLE) {
    const e = M.ENGINES.list.find((x) => x.id === N.id);
    const E = engineOf(W, M, N);
    const tag = `eng.${N.id}`;
    const lip = ctx.part(`${tag}.lip`);
    const plug = ctx.part(`${tag}.plug`);
    if (!lip || !plug) {
      fails.push(`${tag}: parts missing`);
      continue;
    }
    // stations and centreline from the built rounds (part.world.F in kit units)
    const Fw = lip.world.F;
    const o = fromKit(Fw.o);
    const lipX = o[0];
    const len = (plug.world.s1 - lip.world.s0) / W.UNIT;
    const rMax = Math.max(...N.rows.map((r) => Math.max(...r.r)));
    const clear = o[2] - rMax;
    const want = Math.abs(N.y) > 20 ? truthClear.outboard : truthClear.inboard;
    const ok1 = near(lipX, e.inletLipX, 0.005) && near(o[1], e.y, 0.005) && near(o[2], e.centreZ, 0.005);
    const ok2 = near(2 * rMax, M.ENGINES.nacelle.maxDiameter, 0.005) && near(len, M.ENGINES.nacelle.length, 0.005);
    const ok3 = near(clear, want, 0.03) && clear >= 0.05;
    say(`${tag}: lip x ${lipX.toFixed(3)} (model ${e.inletLipX}) y ${o[1].toFixed(3)} cz ${o[2].toFixed(3)} · max dia ${(2 * rMax).toFixed(2)} · length ${len.toFixed(2)} · ground clearance ${clear.toFixed(3)} (truth ${want})`);
    if (!ok1) fails.push(`${tag}: inlet station or centreline off the model`);
    if (!ok2) fails.push(`${tag}: diameter or length off the model`);
    if (!ok3) fails.push(`${tag}: ground clearance ${clear.toFixed(3)} not within 0.03 of ${want}`);
    // fan stations: the plane on the lip's front cap
    // pylon: visible depth above the cowl at the wing LE, tangent-plane gaps, side planes, LE face, bottom plane
    const pf = ctx.part(`${tag}.pylon.fwd`);
    const pm = ctx.part(`${tag}.pylon.mid`);
    const pc = ctx.part(`${tag}.pylon.core`);
    const aftNames = E.outboard ? [`${tag}.pylon.aft.a`, `${tag}.pylon.aft.b`] : [`${tag}.pylon.aft`];
    const pas = aftNames.map((nm) => ctx.part(nm));
    const model = (part) => part.world.points.map(fromKit);
    const leX = M.wingAt(Math.abs(N.y)).le;
    const secFwd = E.sec.fwd(N.y, 0);
    const top = spanAt(secFwd, leX)[1];
    const depth = top - E.fan(leX);
    say(`${tag}: pylon depth above the cowl at the wing LE (x ${leX.toFixed(2)}) ${depth.toFixed(3)} m; at the LE face ${(spanAt(secFwd, E.leFaceX(N.y))[1] - E.fan(E.leFaceX(N.y))).toFixed(3)} m`);
    if (!(depth >= 0.5)) fails.push(`${tag}: pylon depth ${depth.toFixed(3)} < 0.5 m at the wing LE`);
    // the fan cowl's top generator (s 1.0 → 3.81) against pylon.fwd's bottom face (in the tilted tangent plane)
    const genGap = (part, plane, s0, s1, row) => {
      const pts = model(part);
      // bottom face points: those on the plane
      const onPlane = pts.filter((p) => Math.abs(W.vec.dot(plane.n, p) - plane.d) < 1e-4);
      let worst = 0;
      for (let s = s0; s <= s1 + 1e-9; s += (s1 - s0) / 16) {
        const r = lerp(row.r[0], row.r[1], (s - row.s[0]) / (row.s[1] - row.s[0]));
        const g = [N.lip + s, N.y, N.cz + r];
        worst = Math.max(worst, Math.abs(W.vec.dot(plane.n, g) - plane.d));
      }
      // the face must reach the generator: its y span covers yc and its x span covers [s0, s1]
      const xs = onPlane.map((p) => p[0]);
      const covers = onPlane.length >= 3 && Math.min(...xs) <= N.lip + s0 + 1e-6 && Math.max(...xs) >= N.lip + s1 - 1e-6;
      return { worst, covers, count: onPlane.length };
    };
    const rowOf = (name) => N.rows.find((r) => r.part === name);
    const gFan = genGap(pf, N.fanTop, 1.0, 3.81, rowOf("fancowl"));
    const gAft = genGap(pm, N.aftTop, 3.81, 6.2, rowOf("aftcowl"));
    const gCore = genGap(pc, N.coreTop, 6.2, 6.93, rowOf("core"));
    say(`${tag}: gap along the cowl tangent planes: fan cowl ${gFan.worst.toExponential(1)} m (face ${gFan.covers ? "covers s 1.0–3.81" : "SHORT"}) · aft cowl ${gAft.worst.toExponential(1)} m · core ${gCore.worst.toExponential(1)} m`);
    for (const [nm, g] of [["fan cowl", gFan], ["aft cowl", gAft], ["core", gCore]]) if (!(g.worst <= 0.01 && g.covers)) fails.push(`${tag}: ${nm} tangent contact gap ${g.worst.toFixed(4)} m or face short`);
    // the fillets (follow-up item 20): line contact on the fan cowl's tangent plane FILLET.phi off the crest, the
    // base's wrap angle, the outer edge's height over the cowl
    const fillets = [`${tag}.pylon.fillet.i`, `${tag}.pylon.fillet.o`].map((nm) => ctx.part(nm)).filter(Boolean);
    {
      const fcRow = N.rows.find((r) => r.part === "fancowl");
      let lift = Infinity;
      let wrap = 0;
      let touch = Infinity;
      for (const part of fillets)
        for (const p of model(part)) {
          const s = p[0] - N.lip;
          const r = lerp(fcRow.r[0], fcRow.r[1], (s - fcRow.s[0]) / (fcRow.s[1] - fcRow.s[0]));
          const d = Math.hypot(p[1] - N.y, p[2] - N.cz) - r;
          lift = Math.min(lift, d);
          if (Math.abs(p[1] - N.y) > HALF + 1e-6) {
            wrap = Math.max(wrap, Math.asin(Math.min(1, Math.abs(p[1] - N.y) / r)) / D2R);
            touch = Math.min(touch, d);
          }
        }
      say(`${tag}: pylon fillets ${fillets.length} · line contact on the fan cowl at ${90 - FILLET.phi}°/${90 + FILLET.phi}° (nearest vertex ${lift.toExponential(1)} m off the cowl) · base wraps the cowl over 2 × ${wrap.toFixed(1)}° · outer edge ${touch.toFixed(3)} m over the cowl`);
      if (fillets.length !== 2) fails.push(`${tag}: pylon fillets missing`);
      if (!(lift >= -1e-4) || !(wrap >= 10 && wrap <= 15.5 + 1e-6)) fails.push(`${tag}: fillet inside the cowl or wrap ${wrap.toFixed(1)}° outside 10–15.5°`);
    }
    // nothing of the pylon inside the nacelle: no pylon vertex lies inside any row's solid frustum (depth > 0.1 mm)
    let sunk = 0;
    for (const part of [pf, pm, pc, ...pas, ...fillets])
      for (const p of model(part)) {
        const s = p[0] - N.lip;
        for (const row of N.rows) {
          if (s < row.s[0] || s > row.s[1]) continue;
          const r = lerp(row.r[0], row.r[1], (s - row.s[0]) / (row.s[1] - row.s[0]));
          sunk = Math.max(sunk, Math.min(r - Math.hypot(p[1] - N.y, p[2] - N.cz), s - row.s[0], row.s[1] - s));
        }
      }
    if (sunk > 1e-4) fails.push(`${tag}: a pylon vertex lies ${sunk.toFixed(4)} m inside the nacelle`);
    // side planes and the LE face
    let ySpan = [Infinity, -Infinity];
    let leWorst = -Infinity;
    for (const part of [pf, pm, pc, ...pas])
      for (const p of model(part)) {
        ySpan = [Math.min(ySpan[0], p[1]), Math.max(ySpan[1], p[1])];
        if (part === pf || part === pm || part === pc) leWorst = Math.max(leWorst, p[0] - E.leFaceX(p[1]));
      }
    let aftFront = Infinity;
    let aftTop = 0;
    for (const part of pas)
      for (const p of model(part)) {
        aftFront = Math.min(aftFront, p[0] - E.leFaceX(p[1]));
        if (p[2] >= E.bottomZ(p[0], p[1]) - 1e-4) aftTop = Math.max(aftTop, Math.abs(p[2] - E.bottomZ(p[0], p[1])));
      }
    say(`${tag}: side planes y ${ySpan[0].toFixed(3)} / ${ySpan[1].toFixed(3)} · fwd/mid/core aft of the LE face by ${leWorst.toExponential(1)} m · aft fairing ahead of it by ${(-aftFront).toExponential(1)} m, top off the bottom plane ${aftTop.toExponential(1)} m`);
    if (!(near(ySpan[0], N.y - HALF, 1e-4) && near(ySpan[1], N.y + HALF, 1e-4))) fails.push(`${tag}: pylon side planes off yc ± 0.45`);
    if (leWorst > 1e-4 || aftFront < -1e-4 || aftTop > 1e-4) fails.push(`${tag}: pylon off the LE face or the bottom plane`);
    // flap and TE clearance at rest: the aft fairing ends GAP ahead of the TE face outboard; inboard it hangs
    // under the flap at least 0.2 m below the bottom plane wherever it is aft of the TE face
    let flapClear = Infinity;
    for (const part of pas)
      for (const p of model(part))
        if (p[0] > E.teFaceX(p[1]) - 1e-6) flapClear = Math.min(flapClear, E.bottomZ(p[0], p[1]) - p[2]);
    say(`${tag}: aft fairing tip x ${E.tipX(N.y).toFixed(3)} (model ${E.pylon.aftTipX}) · TE face ${E.teFaceX(N.y).toFixed(3)} · below the bottom plane aft of the TE face ≥ ${Number.isFinite(flapClear) ? flapClear.toFixed(3) : "n/a (ends ahead)"} m`);
    if (Number.isFinite(flapClear) && flapClear < 0.2) fails.push(`${tag}: aft fairing within ${flapClear.toFixed(3)} m of the flap line`);
  }
  // fan direction on screen, nose-on (turn 40): the marked blade's screen angle increases with the phase
  {
    const P = ctx.P;
    const N = W.NACELLE[2];
    const o = W.kit([N.lip, N.y, N.cz]);
    const S = (p) => W.project(W.poseOf(p, { turn: 40 }), P);
    const sign = ctx.part(`eng.${N.id}.lip`) ? (() => {
      const s0 = S(o);
      const su = S([o[0], o[1] + 10, o[2]]);
      const sv = S([o[0], o[1], o[2] + 10]);
      return (su[0] - s0[0]) * (sv[1] - s0[1]) - (su[1] - s0[1]) * (sv[0] - s0[0]) > 0 ? 1 : -1;
    })() : 0;
    const at = (deg) => {
      const th = sign * deg * D2R;
      const p = S([o[0], o[1] + 14 * Math.cos(th), o[2] + 14 * Math.sin(th)]);
      const c = S(o);
      return Math.atan2(p[1] - c[1], p[0] - c[0]);
    };
    const d = ((at(10) - at(0) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    say(`fan sense nose-on: the marked blade's screen angle ${d > 0 ? "increases (clockwise, y down)" : "DECREASES (anticlockwise)"} as the phase grows`);
    if (!(d > 0)) fails.push("fan turns anticlockwise on screen nose-on");
  }
  if (fails.length) throw new Error(fails.join("; "));
}
