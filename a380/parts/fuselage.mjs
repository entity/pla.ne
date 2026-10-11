// a380/parts/fuselage.mjs (M6): Fuselage: barrel and cut pieces.
//
// Builds the M6 pieces of W.SHELL as S0 ring lofts (fus.B1 … fus.UY.crown, the cut pieces on cut.up and
// cut.md, the B4 belly slabs and the belt wall strips), their surface detail (lap-joint rules on the belt
// vertex lines, circumferential production joints, the cutaway rims as `cabin` accents) and their labels.
// It also exports the skin geometry library (`geom(W)`) that parts/skin.mjs builds on: loft segments, S0 facet
// planes in the kit frame, points on the skin, the unrolled section coordinate σ, draping of outlines and fills
// onto facet planes, and convex slabs from half-spaces.
// Contract: a380/notes/CONTRACT.md. Design: a380/DESIGN.md §5.1, §5.7, §8.7, §9 (M6).
// Boundaries (W.SHELL): fus.B1 15.80-18.5 full S0; B2 (z >= 4.40); B3 (4.40-7.90); B4 (5.05-7.90) with
//   B4belly.{l,r} slabs; U.wall.{l,r} upper-belt strips 7.90-9.15; U.crown (cut.up, z >= 9.162);
//   B5 (4.40-5.15); M.wall.{l,r} main-belt strips; M.chunk (cut.md, z >= 6.462); B6; UY.wall.{l,r};
//   UY.crown (cut.up). x 15.80 and 46.5 with M2. The fillet line (±3.416, 5.05) for M3. Cut pieces keep
//   W.GAP (0.012 m) from every piece on another group (W.SHELL builds that in).
import { clipPoints, convexHull3 } from "../../kit/hull3.mjs";

export const id = "fuselage";
export const owner = "M6";
export const title = "Fuselage: barrel and cut pieces";
/** Every part name this module creates starts with one of these (the harness enforces it). */
export const prefixes = ["fus."];
/** true: the harness builds stubs.mjs's stand-in instead of build(). */
export const stub = false;

// ---------------------------------------------------------------------------------------------
// vectors (model metres unless named kit)
// ---------------------------------------------------------------------------------------------
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp = (a, b, t) => a + (b - a) * t;
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
/** A number for SVG markup: 2 decimals, no trailing zeros. */
export const f2 = (v) => {
  const s = (Math.round(v * 100) / 100).toFixed(2);
  return s.replace(/\.?0+$/, "") === "-0" ? "0" : s.replace(/\.?0+$/, "");
};
/** "M x y L x y …" (closed with Z when asked) from [[X, Y]…]. */
export const pathOf = (pts, closed = false) => (pts.length ? `M${pts.map(([x, y]) => `${f2(x)} ${f2(y)}`).join("L")}${closed ? "Z" : ""}` : "");

/** A rounded rectangle as a polygon (counter-clockwise), centre (cx, cy), size w × h, corner radius r. */
export function roundRect(cx, cy, w, h, r, steps = 4) {
  const hw = w / 2;
  const hh = h / 2;
  const rr = Math.min(r, hw, hh);
  const out = [];
  const corner = (ox, oy, a0) => {
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (k / steps) * (Math.PI / 2);
      out.push([ox + rr * Math.cos(a), oy + rr * Math.sin(a)]);
    }
  };
  corner(cx + hw - rr, cy - hh + rr, -Math.PI / 2);
  corner(cx + hw - rr, cy + hh - rr, 0);
  corner(cx - hw + rr, cy + hh - rr, Math.PI / 2);
  corner(cx - hw + rr, cy - hh + rr, Math.PI);
  return out;
}

/** The compact SVG path of a rounded rectangle centred on (cx, cy) (kit units, plane coordinates). */
export function roundRectPath(cx, cy, w, h, r) {
  const hw = w / 2;
  const hh = h / 2;
  const rr = Math.min(r, hw, hh);
  return `M${f2(cx - hw + rr)} ${f2(cy - hh)}h${f2(w - 2 * rr)}a${f2(rr)} ${f2(rr)} 0 0 1 ${f2(rr)} ${f2(rr)}v${f2(h - 2 * rr)}a${f2(rr)} ${f2(rr)} 0 0 1 ${f2(-rr)} ${f2(rr)}h${f2(-(w - 2 * rr))}a${f2(rr)} ${f2(rr)} 0 0 1 ${f2(-rr)} ${f2(-rr)}v${f2(-(h - 2 * rr))}a${f2(rr)} ${f2(rr)} 0 0 1 ${f2(rr)} ${f2(-rr)}Z`;
}

/** Densify a polyline (2D) so no segment is longer than `step`. */
export function densify(pts, step, closed = false) {
  const out = [];
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < k; j++) out.push([lerp(a[0], b[0], j / k), lerp(a[1], b[1], j / k)]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}

/** Runs of a polyline inside lo ≤ p[axis] ≤ hi, split at the crossings (closed loops wrap round). */
export function clipRuns(pts, axis, lo, hi, closed = false) {
  const n = pts.length;
  const inside = (p) => p[axis] >= lo - 1e-9 && p[axis] <= hi + 1e-9;
  const runs = [];
  let cur = null;
  const last = closed ? n : n - 1;
  const cutsOf = (a, b) => {
    const ts = [];
    for (const c of [lo, hi]) {
      const da = a[axis] - c;
      const db = b[axis] - c;
      if ((da < 0 && db > 0) || (da > 0 && db < 0)) ts.push(da / (da - db));
    }
    return ts.sort((x, y) => x - y);
  };
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const ts = [0, ...cutsOf(a, b), 1];
    for (let k = 0; k + 1 < ts.length; k++) {
      const p = [lerp(a[0], b[0], ts[k]), lerp(a[1], b[1], ts[k])];
      const q = [lerp(a[0], b[0], ts[k + 1]), lerp(a[1], b[1], ts[k + 1])];
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if (inside(mid)) {
        if (!cur) {
          cur = [p];
          runs.push(cur);
        }
        cur.push(q);
      } else cur = null;
    }
  }
  if (closed && runs.length > 1) {
    const first = runs[0];
    const tail = runs[runs.length - 1];
    const a = tail[tail.length - 1];
    const b = first[0];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) {
      runs.pop();
      runs[0] = [...tail, ...first.slice(1)];
    }
  }
  if (closed && runs.length === 1) {
    const r = runs[0];
    const a = r[0];
    const b = r[r.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9) r.closedLoop = true;
  }
  return runs;
}

/** Sutherland–Hodgman: a convex 2D polygon clipped to lo ≤ p[axis] ≤ hi. */
export function clipPolygonBand(poly, axis, lo, hi) {
  const clip = (pts, keep, at) => {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ka = keep(a);
      const kb = keep(b);
      if (ka) out.push(a);
      if (ka !== kb) {
        const t = (at - a[axis]) / (b[axis] - a[axis]);
        out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
      }
    }
    return out;
  };
  let out = clip(poly, (p) => p[axis] >= lo, lo);
  if (out.length) out = clip(out, (p) => p[axis] <= hi, hi);
  return out;
}

/** The vertices of the convex polytope { p : n·p ≤ d for every half-space } inside a box (model points). */
export function polytope(halfSpaces, box) {
  const [[x0, y0, z0], [x1, y1, z1]] = box;
  let pts = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) pts.push([x, y, z]);
  for (const { n, d } of halfSpaces) {
    const l = len(n);
    pts = clipPoints(pts, mul(n, 1 / l), d / l, "m6.polytope");
    if (pts.length < 4) throw new Error("m6: empty polytope");
  }
  return convexHull3(pts, { name: "m6.polytope" }).points;
}

// ---------------------------------------------------------------------------------------------
// the skin geometry library (DESIGN §5.1): every function reads W, never another module's parts
// ---------------------------------------------------------------------------------------------
export function geom(W) {
  const S0H = W.S0_HALF;
  // cumulative S0 arc length from the keel vertex up the starboard half (σ), plus the half crown facet
  const SIG = [0];
  for (let i = 1; i < S0H.length; i++) SIG.push(SIG[i - 1] + Math.hypot(S0H[i][0] - S0H[i - 1][0], S0H[i][1] - S0H[i - 1][1]));
  SIG.push(SIG[SIG.length - 1] + S0H[S0H.length - 1][0]); // σ at the crown centreline (y = 0)
  const SIGMA_CROWN = SIG[SIG.length - 1];

  /** The loft segment [xa, xb] (consecutive ring stations) holding [x0, x1]; throws if a ring station falls inside. */
  function segAt(x0, x1 = x0) {
    const st = W.RING_STATIONS;
    for (let i = 0; i + 1 < st.length; i++) if (st[i] <= x0 + 1e-9 && x1 <= st[i + 1] + 1e-9) return [st[i], st[i + 1]];
    throw new Error(`m6: [${x0}, ${x1}] crosses a ring station`);
  }
  /** Homothetic parameters at x: { K, c } of the section (Ky for width, Kz and c for height). */
  const sectionAt = (x) => W.sectionAt(x);
  /** The S0 side facet index i (vertex i → i+1, 0..14) holding height z at station x. */
  function facetIndexAt(x, z) {
    const r = W.ring2(x);
    for (let i = 0; i < 15; i++) if (z >= r[i][1] - 1e-9 && z <= r[i + 1][1] + 1e-9) return i;
    throw new Error(`m6: no side facet at x ${x} z ${z}`);
  }
  /** The model point on side facet i at station x and height z, side ±1. */
  function skinPoint(x, i, side, z) {
    const r = W.ring2(x);
    const a = r[i];
    const b = r[i + 1];
    const t = (z - a[1]) / (b[1] - a[1]);
    return [x, side * lerp(a[0], b[0], t), z];
  }
  /** The skin point at station x and height z on a side (its own facet). */
  const skinAt = (x, z, side) => skinPoint(x, facetIndexAt(x, z), side, z);
  /** σ (S0 arc length from the keel vertex, unscaled) of height z at station x. */
  function sigmaOf(x, z) {
    const r = W.ring2(x);
    const i = facetIndexAt(x, z);
    const t = (z - r[i][1]) / (r[i + 1][1] - r[i][1]);
    return lerp(SIG[i], SIG[i + 1], t);
  }
  /** The facet index (0..14, or 15 for the half crown facet) holding σ. */
  function facetOfSigma(s) {
    for (let i = 0; i < 16; i++) if (s >= SIG[i] - 1e-9 && s <= SIG[i + 1] + 1e-9) return i;
    throw new Error(`m6: σ ${s} out of range`);
  }
  /** The model point at station x, arc σ, side ±1 (σ beyond the crown vertex runs in on the crown facet). */
  function pointAtSigma(x, s, side) {
    const r = W.ring2(x);
    const i = facetOfSigma(s);
    const t = (s - SIG[i]) / (SIG[i + 1] - SIG[i]);
    if (i === 15) return [x, side * lerp(r[15][0], 0, t), r[15][1]];
    return [x, side * lerp(r[i][0], r[i + 1][0], t), lerp(r[i][1], r[i + 1][1], t)];
  }

  /**
   * The plane of a facet over a loft segment: { n, d, A, u (aft, in plane), v (up the facet), kit frame
   * O, U, V, N, xy(p model) → [X, Y] kit units }. Facet i: side facet 0..14, "crown", or a list of three model
   * points [A, B, C] (any planar patch).
   */
  function facetPlane(seg, i, side = 1, outward = null) {
    let A;
    let B;
    let C;
    if (Array.isArray(i)) [A, B, C] = i;
    else {
      const ra = W.ring2(seg[0]);
      const rb = W.ring2(seg[1]);
      if (i === "crown") {
        A = [seg[0], -ra[15][0], ra[15][1]];
        B = [seg[0], ra[15][0], ra[15][1]];
        C = [seg[1], rb[15][0], rb[15][1]];
      } else {
        A = [seg[0], side * ra[i][0], ra[i][1]];
        B = [seg[0], side * ra[i + 1][0], ra[i + 1][1]];
        C = [seg[1], side * rb[i][0], rb[i][1]];
      }
    }
    let n = unit(cross(sub(B, A), sub(C, A)));
    // outward: away from the section's centre line (or along an explicit hint for a free patch)
    const zMid = Array.isArray(i) ? 6.5 : (W.ring2(seg[0])[0][1] + W.ring2(seg[0])[15][1]) / 2;
    const hint = outward ?? sub(A, [A[0], 0, zMid]);
    if (dot(n, hint) < 0) n = mul(n, -1);
    const d = dot(n, A);
    const u = unit(sub([1, 0, 0], mul(n, n[0])));
    let v = unit(cross(n, u));
    if (dot(v, sub(B, A)) < 0) v = mul(v, -1);
    const O = W.kit(A);
    const U = W.kitDir(u);
    const V = W.kitDir(v);
    const N = W.kitDir(n);
    const xy = (p) => {
      const q = sub(W.kit(p), O);
      return [dot(q, U), dot(q, V)];
    };
    const fromXY = (X, Y) => W.fromKit(add(O, add(mul(U, X), mul(V, Y))));
    return { n, d, A, B, C, u, v, O, U, V, N, xy, fromXY, seg, facet: i, side };
  }
  /** T.plane options for a facet plane and markup (kit frame). */
  const planeOpts = (fp, svg, fade) => ({ o: fp.O, u: fp.U, v: fp.V, normal: fp.N, svg, ...(fade ? { fade } : {}) });

  /**
   * Drape an outline (polyline in (x, σ), closed or open) onto the side facets of a loft segment: returns
   * Map(facet → [runs of model points]). σ is unscaled S0 arc (the homothetic K scales it on the skin).
   */
  function drapeLine(pts, side, { closed = false, step = 0.05 } = {}) {
    const dense = densify(pts, step, closed);
    const out = new Map();
    for (let i = 0; i < 16; i++) {
      const runs = clipRuns(dense, 1, SIG[i], SIG[i + 1], closed);
      if (!runs.length) continue;
      out.set(
        i,
        runs.map((run) => {
          const r = run.map(([x, s]) => pointAtSigma(x, s, side));
          if (run.closedLoop) r.closedLoop = true;
          return r;
        }),
      );
    }
    return out;
  }
  /** Drape a convex fill polygon in (x, σ) onto side facets: Map(facet → model polygon). */
  function drapeFill(poly, side, { step = 0.05 } = {}) {
    const out = new Map();
    for (let i = 0; i < 16; i++) {
      const piece = clipPolygonBand(poly, 1, SIG[i], SIG[i + 1]);
      if (piece.length < 3) continue;
      out.set(
        i,
        densify(piece, step, true).map(([x, s]) => pointAtSigma(x, s, side)),
      );
    }
    return out;
  }

  /**
   * A book of planes keyed by host part, segment, facet and side: add markup per facet, then flush one
   * ctx.planeOn per key. Keeps one plane per facet per part (DESIGN §5.7: one plane per row per host part).
   */
  function planeBook() {
    const book = new Map();
    const key = (host, seg, facet, side) => `${host}|${seg[0]}|${seg[1]}|${facet}|${side}`;
    return {
      /** The plane entry for (host, seg, facet, side): { fp, parts: [svg…] }. */
      at(host, seg, facet, side) {
        const k = key(host, seg, facet, side);
        if (!book.has(k)) book.set(k, { host, fp: facetPlane(seg, facet, side), parts: [] });
        return book.get(k);
      },
      add(host, seg, facet, side, svgFn) {
        const e = this.at(host, seg, facet, side);
        e.parts.push(typeof svgFn === "function" ? svgFn(e.fp) : svgFn);
        return e;
      },
      flush(ctx, fade) {
        let count = 0;
        for (const e of book.values()) {
          const svg = e.parts.filter(Boolean).join("");
          if (!svg) continue;
          ctx.planeOn(e.host, planeOpts(e.fp, svg, fade));
          count++;
        }
        book.clear();
        return count;
      },
      size: () => book.size,
      entries: () => [...book.entries()],
    };
  }

  /** Model polyline → plane path. */
  const pathIn = (fp, pts, closed = false) => pathOf(pts.map((p) => fp.xy(p)), closed);

  return { SIG, SIGMA_CROWN, segAt, sectionAt, facetIndexAt, skinPoint, skinAt, sigmaOf, facetOfSigma, pointAtSigma, facetPlane, planeOpts, drapeLine, drapeFill, planeBook, pathIn };
}

// ---------------------------------------------------------------------------------------------
// what the barrel carries (DESIGN §5.7 detail table)
// ---------------------------------------------------------------------------------------------
/** Belt vertex lines that carry lap-joint rules (S0 vertex index → z): main belt 5.05/7.25, upper belt 7.90/9.15. */
export const LAP_VERTICES = [7, 8, 9, 10];
/**
 * Circumferential production joints [E]: the skin-panel splices of the forward-centre, centre and rear
 * fuselage (FUSELAGE.sectionsBuilt: Hamburg / Saint-Nazaire / Hamburg), placed in window gaps on both decks
 * and clear of every door surround. The section joints themselves (18.5, 35.9) are piece boundaries.
 */
export const JOINTS = [22.24, 27.5, 39.09];
/** Door surround half-sizes the barrel rules break around (kept in step with skin.mjs). */
export const SURROUND = { margin: 0.04, halfWidth: 0.63 + 0.04 };

/** The upper doors whose surrounds break the 7.90 and 9.15 lap rules, from M.DOORS. */
function upperDoorBreaks(M) {
  return M.DOORS.passenger.filter((d) => d.deck === "upper").map((d) => ({ x: d.x, x0: d.x - SURROUND.halfWidth, x1: d.x + SURROUND.halfWidth, side: d.side === "L" ? -1 : 1 }));
}
/** The upper-door plate's z range [E] (DESIGN §11.5); skin.mjs builds the leaves and surrounds from it. */
export const UPPER_PLATE = [7.91, 9.83];
/**
 * f4-fuselage: where a lap rule at arc σ meets an upper door's painted surround (skin.mjs: the rounded rectangle from the
 * plate's z range, SURROUND.margin out, corner 0.16 m, 5 steps): [x fore, x aft], or null when σ misses it. The rules
 * stopped at the surround's straight sides, so beside its rounded corners they ended 2-4 px short of its outline.
 */
function surroundCrossing(W, G, x, sigma) {
  const r = W.ring2(x);
  let zb = UPPER_PLATE[0];
  if (zb < r[9][1] + 0.01) zb = r[9][1] + 0.01;
  const s0 = G.sigmaOf(x, zb) - SURROUND.margin;
  const s1 = G.sigmaOf(x, UPPER_PLATE[1]) + SURROUND.margin;
  const poly = roundRect(x, (s0 + s1) / 2, 2 * SURROUND.halfWidth, s1 - s0, 0.16, 5);
  const xs = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((a[1] - sigma) * (b[1] - sigma) > 0 || a[1] === b[1]) continue;
    xs.push(a[0] + ((sigma - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
  }
  return xs.length >= 2 ? [Math.min(...xs), Math.max(...xs)] : null;
}

// ---------------------------------------------------------------------------------------------
// module interface
// ---------------------------------------------------------------------------------------------
/** Declare groups and follow rules: none (the pieces ride pitch, cut.up and cut.md, all S's). */
export function groups(ctx) {
  void ctx;
}

const PIECE_LABELS = {
  "fus.B1": "Forward-centre fuselage · constant double-deck section 7.14 × 8.41 m (drawn 7.05 m wide) · built in Hamburg", // fu/r1-fuselage: S0's widest vertex is 3.526 m (z 7.25)
  "fus.B2": "Centre fuselage · over the wing leading edge · built in Saint-Nazaire", // f4-fuselage: named as truth.md §15 / FUSELAGE.sectionsBuilt
  "fus.B3": "Centre fuselage · main deck over the wing box",
  "fus.B4": "Centre fuselage · main deck over the wing-gear bays",
  "fus.B4belly.": "Wing-gear bay side wall · the lower lobe over the bays",
  "fus.U.wall.": "Upper-deck wall · business-class windows · upper belt",
  "fus.U.crown": "Upper-deck crown · lifts for the cutaway",
  "fus.B5": "Rear fuselage · main-deck floor over the body-gear bay · built in Hamburg",
  "fus.M.wall.": "Main-deck wall · economy windows",
  "fus.M.chunk": "Rear fuselage upper lobe · upper deck and the U2 doors · lifts for the cutaway",
  "fus.B6": "Rear fuselage · around the M4 doors",
  "fus.UY.wall.": "Upper-deck wall · rear economy windows",
  "fus.UY.crown": "Upper-deck crown, rear · lifts for the cutaway",
};

/** Parts, planes, labels, accents. */
export function build(ctx) {
  const { W, M } = ctx;
  const G = geom(W);
  const pieces = W.SHELL.filter((p) => p.owner === "M6");
  for (const piece of pieces) ctx.hull({ name: piece.name, group: piece.group, ...W.loft(piece.name), tone: "hi", material: "steel" });

  // ---- lap-joint rules and production joints, one plane per facet per piece (barrel: one segment) ----
  const book = G.planeBook();
  const seg = [14, 46.5];
  const breaks = upperDoorBreaks(M);
  const line = (fp, pts) => `<path class="iso-line" data-tone="faint" d="${G.pathIn(fp, pts)}"/>`;
  let laps = 0;
  let joints = 0;
  for (const piece of pieces) {
    const c = piece.clip;
    const [x0, x1] = piece.x;
    const zMin = c.zMin ?? -1;
    const zMax = c.zMax ?? 99;
    const sides = c.side ? [c.side] : [-1, 1];
    for (const side of sides) {
      // lap rules: a belt vertex strictly inside the piece's z range, drawn at the bottom edge of the facet above it
      if (!c.strip)
        for (const vi of LAP_VERTICES) {
          const z = W.S0_HALF[vi][1];
          if (z <= zMin + 1e-6 || z >= zMax - 1e-6) continue;
          let spans = [[x0, x1]];
          if (vi === 9 || vi === 10)
            for (const b of breaks.filter((q) => q.side === side)) {
              const cut = surroundCrossing(W, G, b.x, G.SIG[vi]) ?? [b.x0, b.x1]; // f4-fuselage: end on the surround's outline
              spans = spans.flatMap(([a, e]) => (b.x1 <= a || b.x0 >= e ? [[a, e]] : [[a, cut[0]], [cut[1], e]].filter(([p, q]) => q - p > 0.05)));
            }
          for (const [a, e] of spans) {
            book.add(piece.name, seg, vi, side, (fp) => line(fp, [G.skinPoint(a, vi, side, z), G.skinPoint(e, vi, side, z)]));
            laps++;
          }
        }
      // production joints: the ring at x on every facet of the piece, from its bottom to its top
      for (const xj of JOINTS) {
        if (xj <= x0 + 1e-6 || xj >= x1 - 1e-6) continue;
        const r = W.ring2(xj);
        for (let i = 0; i < 15; i++) {
          const za = Math.max(r[i][1], zMin);
          const zb = Math.min(r[i + 1][1], zMax);
          if (zb - za < 0.02) continue;
          if (c.strip) {
            // a strip is one facet: the joint crosses its outer face
            const fi = c.strip === "main" ? 7 : c.strip === "upper" ? 9 : 6;
            if (i !== fi) continue;
          }
          book.add(piece.name, seg, i, side, (fp) => line(fp, [G.skinPoint(xj, i, side, za), G.skinPoint(xj, i, side, zb)]));
          joints++;
        }
        if (!c.strip && side > 0 && zMax > 10.7) {
          book.add(piece.name, seg, "crown", 1, (fp) => line(fp, [[xj, -0.35, 10.77], [xj, 0.35, 10.77]]));
          joints++;
        }
      }
    }
  }
  const planes = book.flush(ctx);

  // ---- cutaway rims: lit rules on the cut pieces' lower edges, the `cabin` accent family (DESIGN §5.10) ----
  let rims = 0;
  for (const piece of pieces.filter((p) => p.group !== "pitch" && p.clip.zMin !== undefined)) {
    const part = ctx.part(piece.name);
    const z = piece.clip.zMin;
    const [x0, x1] = piece.x;
    const fi = G.facetIndexAt(x0 + 0.5, z + 1e-4);
    for (const side of [-1, 1]) {
      const fp = G.facetPlane(seg, fi, side);
      const a = G.skinPoint(x0, fi, side, z + 0.004);
      const b = G.skinPoint(x1, fi, side, z + 0.004);
      ctx.accent("cabin", { part, ...G.planeOpts(fp, `<path class="iso-line" data-tone="lit" d="${G.pathIn(fp, [a, b])}"/>`) });
      rims++;
    }
    // end caps: the rim across each end face at the cut
    const y = G.skinPoint(x0, fi, 1, z)[1];
    for (const [x, s] of [[x0, -1], [x1, 1]]) {
      const A = [x, -y + 0.004, z + 0.004];
      const B = [x, y - 0.004, z + 0.004];
      const frame = capFrame(W, x, s);
      ctx.accent("cabin", { part, o: frame.O, u: frame.U, v: frame.V, normal: frame.N, svg: `<path class="iso-line" data-tone="lit" d="${pathOf([A, B].map(frame.xy))}"/>` });
      rims++;
    }
  }

  for (const [prefix, text] of Object.entries(PIECE_LABELS)) ctx.label(prefix, text, prefix.includes("crown") || prefix.includes("chunk") ? "cutaway" : null);
  const lining = liningPlanes(ctx, W, "cabin");
  ctx.report(`fuselage: ${pieces.length} pieces, ${planes} detail planes (${laps} lap rules, ${joints} joint segments), ${rims} cutaway rims, ${lining} lining planes`);
}

/**
 * fu/r2-fuselage (craft-light): the cavities' own faces. The cut bays' walls, their bay-end faces and the flight deck's
 * ends are faces of the skin pieces (fus.*.wall.*, the pieces' end caps, nose.fwd, nose.radome), so they kept the
 * exterior skin's light steel ramp (#c2c7cb-#eceef0) and ignored the cabin dimmer: the cut cabin read as a white box on
 * paper, its bay-end face lighter than the shaded skin outside (webgl.md §8.3: a cavity takes its own darker set and
 * follows its light). Each such face carries one lining plane, pushed before every other plane on that face (nose.mjs
 * calls this before the flight-deck door; the cabin module's window reveals and bay-end fronts come later through
 * ctx.planeOn), so those draw over it. Two paths:
 * - `a3-lin`: by daylight a warm grey at 36% over the face, so the face's four shades stay four, mixed to a lining ramp
 *   of about #b2afa9-#cdc8c1 (light steel #c2c7cb-#eceef0 under it), darker than the exterior's shaded skin (#c9cdd1);
 *   in dark it is off (the cavities inherit the figure's tokens there);
 * - `a3-lnd`: --a3-cab-dim at the dimmer's darkening share (the vary `a3-lnd`, the share live.js writes to --a3-cab-p),
 *   the same mix the furniture's tones take (a380.css), in both themes and both painters (a vary alpha is applied at
 *   paint time, as the doorways' overlay, skin.mjs `a3-dwi-dim`).
 * The planes fade in over n·v 0-0.03 (the face's own facing), so they cover the face wherever it is drawn.
 * `which`: "nose" (the flight deck's two ends and First's forward end, on nose.radome and nose.fwd) or "cabin" (the
 * rest). Returns the number of planes.
 */
export function liningPlanes(ctx, W, which) {
  const kit = W.kit;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  };
  // merge r2: the flight deck's two ends take the lining tone but not the dimmer (fu/r2-interiors: the Cabin switch
  // dims cabin.* only; the flight deck's lights are not on the cabin crew's panel)
  const svg = (d, dim = true) => `<path class="a3-lin" d="${d}"/>${dim ? `<path class="a3-lnd" style="opacity:0" d="${d}"/>` : ""}`;
  let count = 0;
  // a planar kit-space polygon (≥ 3 points) as one plane whose normal is `n` (kit, the face's outward normal)
  const add = (host, poly, n, dim = true) => {
    const part = ctx.part(host);
    if (!part) throw new Error(`fuselage: lining on an unknown part ${host}`);
    const o = poly[0];
    const N = unit(n);
    const u = unit(sub(poly[1], o));
    const v = unit(cross(N, u));
    const d = poly.map((p, i) => `${i ? "L" : "M"}${dot(sub(p, o), u).toFixed(2)} ${dot(sub(p, o), v).toFixed(2)}`).join("") + "Z";
    ctx.plane(part, { o, u, v, normal: N, svg: svg(d, dim), fade: [0, 0.03] });
    count++;
  };
  // the bay ends: a piece's end cap at x, the part of its ring between z0 and the piece's top; s −1: the cap faces
  // forward (the piece lies aft of x), +1 aft
  const clipZ = (ring, z0, z1) => {
    let poly = ring;
    for (const [lim, above] of [[z0, true], [z1, false]]) {
      if (lim === null) continue;
      const keep = (z) => (above ? z >= lim - 1e-9 : z <= lim + 1e-9);
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        if (keep(a[1])) out.push(a);
        if (keep(a[1]) !== keep(b[1])) {
          const t = (lim - a[1]) / (b[1] - a[1]);
          out.push([a[0] + (b[0] - a[0]) * t, lim]);
        }
      }
      poly = out;
    }
    return poly;
  };
  const cap = (host, x, s, z0, dim = true) => {
    const piece = W.shell(host);
    const poly = clipZ(W.ring2(x), Math.max(z0, piece.clip.zMin ?? -99), piece.clip.zMax ?? null);
    if (poly.length < 3) return;
    add(host, poly.map(([y, z]) => kit([x, y, z])), W.kitDir([s, 0, 0]), dim);
  };
  const C = W.CUT;
  if (which === "nose") {
    cap("nose.radome", 1.9, 1, C.FD.floor, false); // the flight deck's forward end (the radome's aft face, under the glareshield)
    cap("nose.fwd", 5.65, -1, C.FD.floor, false); // the flight deck's aft bulkhead (the door, the observer seats)
    cap("nose.fwd", 8.9, 1, C.F.floor); // First's forward end
    return count;
  }
  // the walls: each strip segment's inner face (ring points 2 and 3: the facet line moved inward), facing the aisle
  for (const name of ["nose.f.wall.l", "nose.f.wall.r", "fus.U.wall.l", "fus.U.wall.r", "fus.M.wall.l", "fus.M.wall.r", "fus.UY.wall.l", "fus.UY.wall.r"]) {
    const { rings } = W.loft(name);
    const side = W.shell(name).clip.side;
    for (let k = 0; k + 1 < rings.length; k++) {
      const poly = [rings[k][2], rings[k][3], rings[k + 1][3], rings[k + 1][2]];
      let n = cross(sub(poly[1], poly[0]), sub(poly[3], poly[0]));
      if (n[1] * side > 0) n = [-n[0], -n[1], -n[2]];
      add(name, poly, n);
    }
  }
  cap("fus.B1", 15.8, -1, C.F.floor); // First's aft end (the M2 galley front, cabin-furniture.mjs)
  cap("fus.B2", 23.5, 1, C.U.floor); // upper Business, forward end
  cap("fus.M.chunk", 35.9 + W.GAP, -1, C.U.floor); // upper Business, aft end (rides cut.md)
  cap("fus.B4", 35.9, 1, C.M.floor); // main Economy, forward end
  cap("fus.B6", 43.5, -1, C.M.floor); // main Economy, aft end (the M4 galley stands before it)
  cap("fus.M.chunk", 43.5 - W.GAP, 1, C.UY.floor); // upper Economy, forward end (rides cut.md)
  cap("tail.aft", 46.5, -1, C.UY.floor); // upper Economy, aft end
  const cabP = `((1 - Math.round(Math.pow(Math.max(0, Math.min(1, pv.cabinLight !== undefined ? pv.cabinLight : 1)), 0.66) * 12) / 12) * ${ctx.theme === "light" ? 0.35 : 0.5})`;
  ctx.vary("a3-lnd", cabP);
  ctx.css(`.iso{--a3-lin:#96836c;--a3-lin-a:.36}
.iso[data-theme="dark"]{--a3-lin-a:0}
.a3-lin{fill:var(--a3-lin);stroke:var(--a3-lin);stroke-width:.4px;stroke-linejoin:round;opacity:var(--a3-lin-a)}
.a3-lnd{fill:var(--a3-cab-dim);stroke:var(--a3-cab-dim);stroke-width:.4px;stroke-linejoin:round}`);
  return count;
}

/** A cap frame at station x facing aft (s = +1) or forward (s = −1): kit O, U (kit y), V (up), N. */
export function capFrame(W, x, s) {
  const O = W.kit([x, 0, 0]);
  const U = [0, 1, 0];
  const V = [0, 0, 1];
  const N = W.kitDir([s, 0, 0]);
  const xy = (p) => {
    const q = sub(W.kit(p), O);
    return [dot(q, U), dot(q, V)];
  };
  return { O, U, V, N, xy };
}

/** Assertions after T.build (--check). */
export function checks(ctx, out) {
  const { W } = ctx;
  void out;
  const lines = [];
  for (const piece of W.SHELL.filter((p) => p.owner === "M6")) {
    const part = ctx.part(piece.name);
    if (!part) throw new Error(`fuselage: piece ${piece.name} missing`);
    if (part.group.name !== piece.group) throw new Error(`fuselage: ${piece.name} on ${part.group.name}, W.SHELL says ${piece.group}`);
    // the loft is the exact W.loft: every hull vertex lies on a ring of the spec or a clip flat
    const spec = W.loft(piece.name);
    const pts = part.world.points;
    const zs = pts.map((p) => p[2] / 10);
    const xs = pts.map((p) => W.fromKit(p)[0]);
    lines.push(`${piece.name} x ${Math.min(...xs).toFixed(3)}-${Math.max(...xs).toFixed(3)} z ${Math.min(...zs).toFixed(3)}-${Math.max(...zs).toFixed(3)} (${spec.rings.length} rings)`);
    if (Math.abs(Math.min(...xs) - piece.x[0]) > 1e-6 || Math.abs(Math.max(...xs) - piece.x[1]) > 1e-6) throw new Error(`fuselage: ${piece.name} x range off W.SHELL`);
  }
  // cut pieces: W.GAP to every neighbour on another group
  const gap = (a, b) => {
    const A = ctx.part(a).world.points;
    const B = ctx.part(b).world.points;
    const zA = Math.min(...A.map((p) => p[2]));
    const zB = Math.max(...B.map((p) => p[2]));
    return (zA - zB) / 10;
  };
  for (const [a, b] of [["fus.U.crown", "fus.U.wall.r"], ["fus.M.chunk", "fus.M.wall.r"], ["fus.UY.crown", "fus.UY.wall.r"]]) {
    const g = gap(a, b);
    if (Math.abs(g - W.GAP) > 1e-6) throw new Error(`fuselage: ${a} sits ${g.toFixed(4)} m over ${b}, want W.GAP ${W.GAP}`);
    lines.push(`lap joint ${a} over ${b}: ${g.toFixed(3)} m`);
  }
  for (const l of lines) console.log(`M6 fuselage: ${l}`);
}
