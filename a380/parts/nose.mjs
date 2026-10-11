// a380/parts/nose.mjs (M2): Nose: nose shell lofts, cockpit glazing, NLG bay walls, flight-deck cut piece.
//
// Contract: a380/notes/CONTRACT.md. Design: a380/DESIGN.md §5.1, §5.3, §9 (M2). Notes: a380/notes/modules/M2.md.
//
// Shell (W.SHELL, built with W.loft as smooth ring-loft hulls): nose.radome 0.06–1.9 (+ nose.radome.tip, a
// smooth cap closing the 0.06 m flat), nose.canopy (cut.fd, z ≥ W.CUT.FD.cut), nose.fdfloor (4.90–6.00),
// nose.baywall.{l,r} (z ≤ 4.90, |y| ≥ 1.00), nose.fwd 5.65–8.90, nose.f.block (z ≤ 5.15), nose.f.wall.{l,r}
// (main-belt strips 5.15–6.45), nose.f.top (cut.f, z ≥ W.CUT.F.cut).
// Detail: six cockpit panes as planes on the canopy (each one plane through its own points, a chord inside the
// surface), two wipers on the windshield's outer facet, the air-data probes on nose.fwd's lower facets (3 MFPs, a standby
// pitot, 3 side-slip vanes, 6 flush static probes), static-port
// plates, lightning diverter strips on the radome, the flight-deck door on the aft bulkhead, the `cabin` accent
// on the canopy and First-class crown rims, labels, and the `cockpit` GL target.
// Boundaries: x 15.80 with M6 fus.B1 (flush; nose.f.top keeps W.GAP); W.BAYS.nlg stays empty (the bay ceiling is
// nose.fdfloor's bottom at 4.90; M5 hinges its doors on the walls' bottom inner edges at y ±1.00).

import { geom, clipPolygonBand, clipRuns, liningPlanes } from "./fuselage.mjs";

export const id = "nose";
export const owner = "M2";
export const title = "Nose: nose shell lofts, cockpit glazing, NLG bay walls, flight-deck cut piece";
/** Every part name this module creates starts with one of these (the harness enforces it). */
export const prefixes = ["nose."];
/** true: the harness builds stubs.mjs's stand-in instead of build(). */
export const stub = false;

// ---------------------------------------------------------------------------------------------
// small vector kit (model metres unless a name says kit), shared with tail.mjs
// ---------------------------------------------------------------------------------------------
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const f2 = (v) => (Math.abs(v) < 5e-3 ? "0" : v.toFixed(2));

/** Newell normal of a 3D loop (unit; orientation follows the loop). */
export function newell(loop) {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return unit([x, y, z]);
}

/** A plane frame { o, u, v, n } (model) with normal n; u along `along` projected into the plane. */
export function frameOf(o, n, along) {
  const N = unit(n);
  let u = sub(along, mul(N, dot(along, N)));
  if (len(u) < 1e-9) u = Math.abs(N[2]) < 0.9 ? cross([0, 0, 1], N) : cross([1, 0, 0], N);
  u = unit(u);
  return { o: o.slice(), u, v: cross(N, u), n: N };
}
/** Model point → plane coordinates in kit units (the plane's SVG space). */
export const at2 = (fr, p) => {
  const d = sub(p, fr.o);
  return [10 * dot(d, fr.u), 10 * dot(d, fr.v)];
};
/** SVG path through model points in a plane frame. */
export function pathOf(fr, pts, closed = false) {
  return (
    pts
      .map((p, i) => {
        const [x, y] = at2(fr, p);
        return `${i ? "L" : "M"}${f2(x)} ${f2(y)}`;
      })
      .join("") + (closed ? "Z" : "")
  );
}
/** A rounded rectangle in plane coordinates (kit units), centre (cx, cy), size w × h, corner r. */
export function rrect(cx, cy, w, h, r) {
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  const R = Math.min(r, w / 2, h / 2);
  return `M${f2(x0 + R)} ${f2(y0)}H${f2(x0 + w - R)}A${f2(R)} ${f2(R)} 0 0 1 ${f2(x0 + w)} ${f2(y0 + R)}V${f2(y0 + h - R)}A${f2(R)} ${f2(R)} 0 0 1 ${f2(x0 + w - R)} ${f2(y0 + h)}H${f2(x0 + R)}A${f2(R)} ${f2(R)} 0 0 1 ${f2(x0)} ${f2(y0 + h - R)}V${f2(y0 + R)}A${f2(R)} ${f2(R)} 0 0 1 ${f2(x0 + R)} ${f2(y0)}Z`;
}
/** A circle path (closed) in plane coordinates. */
export const circ = (cx, cy, r) => `M${f2(cx - r)} ${f2(cy)}A${f2(r)} ${f2(r)} 0 1 0 ${f2(cx + r)} ${f2(cy)}A${f2(r)} ${f2(r)} 0 1 0 ${f2(cx - r)} ${f2(cy)}Z`;

/** ctx.plane with a model frame. */
export function planeM(ctx, part, fr, svg, fade) {
  const { W } = ctx;
  return ctx.plane(part, { o: W.kit(fr.o), u: W.kitDir(fr.u), v: W.kitDir(fr.v), normal: W.kitDir(fr.n), svg, ...(fade ? { fade } : {}) });
}

/**
 * The edges of one face of a hull part (kit space), each with the normal of the OTHER face that shares it, so a
 * plane per edge faded by that normal shows only the near rim. `pick(face)` selects the face.
 */
export function rimEdges(part, pick) {
  const { points, faces } = part.world;
  const face = faces.find(pick);
  if (!face) throw new Error(`M2: rimEdges: no matching face on ${part.name}`);
  const out = [];
  const ring = face.ring;
  for (let k = 0; k < ring.length; k++) {
    const i = ring[k];
    const j = ring[(k + 1) % ring.length];
    const other = faces.find((f) => f !== face && f.ring.includes(i) && f.ring.includes(j));
    out.push({ a: points[i], b: points[j], n: other ? other.n : face.n });
  }
  return out;
}
/**
 * The hull face of a built part nearest a kit point (the face plane with the largest n·p − d): a hull of rings
 * bridges any concave run of the loft, so flush parts sit on the hull's faces, never on the analytic facets.
 * Returns { n, d, s, face } in kit space.
 */
export function faceNear(part, pk) {
  let best = null;
  for (const f of part.world.faces) {
    const d = dot(f.n, part.world.points[f.ring[0]]);
    const s = dot(f.n, pk) - d;
    if (!best || s > best.s) best = { n: f.n, d, s, face: f };
  }
  return best;
}
/** A kit point projected onto a face plane { n, d }. */
export const ontoFace = (F, pk) => sub(pk, mul(F.n, dot(F.n, pk) - F.d));

/** One line plane (kit) from a to b, faded by n. */
export function linePlaneKit(ctx, part, a, b, n, svgOf, { accent = null, fade } = {}) {
  const u = unit(sub(b, a));
  let v = cross(n, u);
  if (len(v) < 1e-9) v = Math.abs(u[2]) < 0.9 ? cross([0, 0, 1], u) : cross([1, 0, 0], u);
  v = unit(v);
  const L = len(sub(b, a));
  const spec = { part, o: a, u, v, normal: n, svg: svgOf(L), ...(fade ? { fade } : {}) };
  return accent ? ctx.accent(accent, spec) : ctx.plane(part, spec);
}

// ---------------------------------------------------------------------------------------------
// loft geometry helpers on W
// ---------------------------------------------------------------------------------------------
export const pointInPoly = (pt, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
/** The station x where the loft surface passes through (y, z) (the ring grows over x0..x1). */
export function surfaceX(W, y, z, x0, x1) {
  if (!pointInPoly([y, z], W.ring2(x1))) return null;
  let a = x0;
  let b = x1;
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    if (pointInPoly([y, z], W.ring2(m))) b = m;
    else a = m;
  }
  return (a + b) / 2;
}
/** The outer |y| of the loft at station x and height z (starboard side facets). */
export function surfaceY(W, x, z) {
  const r = W.ring2(x);
  for (let i = 0; i < 15; i++) {
    const a = r[i];
    const b = r[i + 1];
    if ((z - a[1]) * (z - b[1]) <= 0 && Math.abs(b[1] - a[1]) > 1e-9) return a[0] + ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]);
  }
  return r[15][0];
}
/** The top z of the loft at station x for lateral |y| (upper half). */
export function surfaceZtop(W, x, y) {
  const r = W.ring2(x);
  const a = Math.abs(y);
  if (a <= r[15][0]) return r[15][1];
  for (let i = 15; i > 8; i--) {
    const p = r[i];
    const q = r[i - 1];
    if ((a - p[0]) * (a - q[0]) <= 0) return p[1] + ((q[1] - p[1]) * (a - p[0])) / (q[0] - p[0]);
  }
  return r[8][1];
}
/** The S0 facet (i → i+1, starboard numbering) of the homothetic loft between two ring stations: corners and normal. */
export function facetQuad(W, x0, x1, i, side) {
  const s = side < 0 ? -1 : 1;
  const r0 = W.ring2(x0);
  const r1 = W.ring2(x1);
  const P = (x, q) => [x, s * q[0], q[1]];
  const corners = [P(x0, r0[i]), P(x0, r0[i + 1]), P(x1, r1[i + 1]), P(x1, r1[i])];
  let n = unit(cross(sub(corners[1], corners[0]), sub(corners[3], corners[0])));
  const mid = mul(add(add(corners[0], corners[1]), add(corners[2], corners[3])), 0.25);
  if (dot(n, [0, mid[1], mid[2] - 6.5]) < 0) n = mul(n, -1);
  return { corners, n, mid };
}

// ---------------------------------------------------------------------------------------------
// groups: none (the canopy rides cut.fd and nose.f.top rides cut.f, both declared by S)
// ---------------------------------------------------------------------------------------------
export function groups(ctx) {
  void ctx;
}

// the six cockpit panes (built in build(), reused by checks())
let PANES = [];
// fu/fuselage (item 14): the canopy facets the panes and the mask are draped on (build(), checked in checks())
let GLAZING = [];

export function build(ctx) {
  const { W, M } = ctx;
  const kit = W.kit;
  const shell = (name, extra = {}) => ctx.hull({ name, group: W.shell(name).group, ...W.loft(name), tone: "hi", ...extra });

  // ---- shell pieces --------------------------------------------------------------------------
  // the radome is one smooth surface across the section's belt corners: no crease edges between its ring-loft faces
  // (sharp 80°: the corner normals average across them), so it shades without the ribbed-lampshade steps
  // f4-fuselage: 6 sub-bands per tone step (the engine's E5, `subBands`): the radome's 3-4 level facet steps fall to 1-2
  const radome = shell("nose.radome", { sharp: 80, crease: "none", subBands: 6 });
  // f4-fuselage: recorded as a 0.15 m shell open through its flat faces (the engine's E4), so a rider under the roof
  // (an overhead panel hung from cut.fd) is checked against the skin's inner face, not the hull's convex solid
  const canopy = shell("nose.canopy", { shell: { t: 1.5, open: "flat" } });
  const fdfloor = shell("nose.fdfloor");
  shell("nose.baywall.l");
  shell("nose.baywall.r");
  const fwd = shell("nose.fwd");
  shell("nose.f.block");
  shell("nose.f.wall.l");
  shell("nose.f.wall.r");
  const ftop = shell("nose.f.top");

  // the radome tip: a smooth cap on the loft's 0.06 m end ring (the true nose tip is at x 0, z 4.81)
  {
    const cap = W.ring(0.06);
    const c = mul(cap.reduce((s, p) => add(s, p), [0, 0, 0]), 1 / cap.length);
    // the first ring is the loft's own end ring (flush). Every ring keeps all 32 points and the dome has five
    // rings: thinned rings fanned the faces into the tip (pale crease hairlines and a zig-zag tone boundary)
    const rings = [0, 0.4, 0.65, 0.82, 0.93, 0.985, 0.998].map((t) => {
      const x = 0.06 - 0.056 * t;
      const k = Math.sqrt(1 - t * t);
      return cap.map((p) => kit([x, c[1] + (p[1] - c[1]) * k, c[2] + (p[2] - c[2]) * k]));
    });
    // no crease lines on the tip (its tiny end face read as a hi-outlined button on the nose)
    ctx.hull({ name: "nose.radome.tip", group: "pitch", rings, smooth: true, sharp: 80, crease: "none", tone: "mid", jointCaps: { first: "faint" }, subBands: 6 });
  }

  // ---- cockpit panes (planes on the canopy) ---------------------------------------------------
  // The windshield faces forward, so its front-view outline [y, z] is authoritative and x comes from the loft.
  // The model's front view puts the windshield's inner bottom corner 0.2 m below the loft at the canopy's
  // front station (x 1.69 against 1.912): the outline is raised 0.10 m and any point still forward of x 2.03 is
  // clamped onto the canopy there, so the frame clears the radome joint (M2.md).
  // The side panes face sideways: each front-view point is first put on this loft (surfaceX), then those x
  // are stretched over the side view's range x0..x1, and y comes from the loft at (x, z).
  const CLAMP_X = 2.03;
  const WS_LIFT = 0.1;
  const densify = (poly, n) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    return out;
  };
  PANES = [];
  for (const pane of M.WINDOWS.cockpit.panes) {
    for (const [s, side] of W.SIDES) {
      let pts;
      if (pane.id === "windshield") {
        pts = densify(pane.front.map(([y, z]) => [y, z + WS_LIFT]), 4).map(([y, z]) => {
          let x = surfaceX(W, y, z, 0.07, 5.6);
          if (x === null || x < CLAMP_X) {
            x = CLAMP_X;
            z = surfaceZtop(W, x, y);
          }
          return [x, side * y, z];
        });
      } else {
        // where the front view puts each point on this loft, then stretched over the side view's x range
        const dense = densify(pane.front, 3);
        const xs = dense.map(([y, z]) => surfaceX(W, y, z, 0.07, 5.6));
        const xa = Math.min(...xs);
        const xb = Math.max(...xs);
        // the forward side pane reaches further forward than the side view's 2.45, so its mullion with the windshield is
        // not a 0.25-0.3 m black bar. fu/fuselage (item 14): 0.16 m (was 0.09): on the true-width loft the pane's
        // forward corner lands 0.09 m further outboard (y 1.28 against 1.19 at x 2.41, z 7.01), which widened the post
        // from 0.35 to 0.45 m; 0.16 keeps it at 0.36 (checks() prints it)
        const px0 = pane.id === "forwardSide" ? pane.x[0] - 0.16 : pane.x[0];
        pts = dense.map(([, z], i) => {
          const x = px0 + ((xs[i] - xa) / (xb - xa)) * (pane.x[1] - px0);
          return [x, side * surfaceY(W, x, z), z];
        });
      }
      // one plane through the points: Newell normal (outward), moved inward until every point is on or
      // above it (a chord inside the convex canopy), points projected onto it
      const c = mul(pts.reduce((acc, p) => add(acc, p), [0, 0, 0]), 1 / pts.length);
      let n = newell(pts);
      const outward = unit([-0.5, side * 0.6, 1]);
      if (dot(n, outward) < 0) n = mul(n, -1);
      const below = Math.min(...pts.map((p) => dot(sub(p, c), n)));
      const o = add(c, mul(n, below));
      const proj = pts.map((p) => sub(p, mul(n, dot(sub(p, o), n))));
      const fr = frameOf(o, n, [0, 0, 1]);
      PANES.push({ id: pane.id, side, s, pts, proj, fr, lift: -below });
    }
  }
  // The windscreen as one wrapped band (review round 1): every pane is draped onto the canopy's planar facets
  // (above the belt the loft's rings are S0 scaled by one factor, so those facets are planar between ring stations:
  // checks() proves it), so it is coplanar with the skin and edge to
  // edge with its neighbours; one black mask surround lies under the three panes of a side and between the two
  // windshields; the panes share one glass token; mullions are the panes' mid outlines; a pale streak runs along
  // each pane's upper edge.
  {
    const G = geom(W);
    const crownTop = (x) => W.ring2(x)[15];
    const sigmaAt = ([x, y, z]) => {
      const r15 = crownTop(x);
      if (z >= r15[1] - 1e-6) return G.SIG[15] + (1 - Math.min(1, Math.abs(y) / r15[0])) * (G.SIG[16] - G.SIG[15]);
      return G.sigmaOf(x, Math.max(z, W.ring2(x)[0][1]));
    };
    const [cx0, cx1] = W.shell("nose.canopy").x;
    const segs = [];
    const st = [cx0, ...W.RING_STATIONS.filter((x) => x > cx0 + 1e-6 && x < cx1 - 1e-6), cx1];
    for (let i = 0; i + 1 < st.length; i++) segs.push([st[i], st[i + 1]]);
    const book = G.planeBook();
    const facetKey = (fi) => (fi === 15 ? "crown" : fi);
    const finite = (poly) => {
      if (!poly.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]))) throw new Error(`nose: a pane outline is not finite: ${JSON.stringify(poly).slice(0, 300)}`);
    };
    const fill = (poly, side, svgOf) => {
      finite(poly);
      for (const seg of segs) {
        const piece = clipPolygonBand(poly, 0, seg[0], seg[1]);
        if (piece.length < 3) continue;
        for (const [fi, pts] of G.drapeFill(piece, side)) book.add("nose.canopy", G.segAt(seg[0], seg[1]), facetKey(fi), side, (fp) => svgOf(G.pathIn(fp, pts, true)));
      }
    };
    const lineOf = (pts, side, closed, svgOf) => {
      finite(pts);
      // f4-fuselage: the outline is clipped to each ring span exactly (the crossing interpolated), then draped: it was
      // draped whole and its points filtered by span, so each piece stopped short of the station (the strict line
      // gate's canopy pane-edge ends, 2.0-2.8 px)
      for (const seg of segs) {
        for (const xrun of clipRuns(pts, 0, seg[0], seg[1], closed)) {
          if (xrun.length < 2) continue;
          for (const [fi, runs] of G.drapeLine(xrun, side, { closed: Boolean(xrun.closedLoop) }))
            for (const run of runs) {
              if (run.length < 2) continue;
              book.add("nose.canopy", G.segAt(seg[0], seg[1]), facetKey(fi), side, (fp) => svgOf(G.pathIn(fp, run, Boolean(run.closedLoop))));
            }
        }
      }
    };
    const xsOfRaw = (poly) => poly.map((p) => [p[0], sigmaAt([p[0], Math.abs(p[1]), p[2]])]);
    // the windshields reach to 0.05 m of the crown line, so the centre post between them is about 0.1 m (the true
    // post); their inner edge ended 0.1 m short of it on each side, a 0.2-0.4 m black bar that read as goggles
    const POST = 0.05;
    const xsOf = (poly, id) => {
      const q = xsOfRaw(poly);
      if (id !== "windshield") return q;
      const sg = q.map((p) => p[1]);
      const lo = Math.min(...sg);
      const hi = Math.max(...sg);
      const want = G.SIGMA_CROWN - POST;
      return q.map(([x, s]) => [x, s + ((s - lo) / Math.max(1e-6, hi - lo)) * (want - hi)]);
    };
    const grow = (poly, k) => {
      const c = poly.reduce((a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length], [0, 0]);
      return poly.map(([x, sg]) => [c[0] + (x - c[0]) * k, c[1] + (sg - c[1]) * k]);
    };
    const hull2 = (pts) => {
      const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo = [];
      for (const p of P) {
        while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop();
        lo.push(p);
      }
      const up = [];
      for (let i = P.length - 1; i >= 0; i--) {
        while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], P[i]) <= 0) up.pop();
        up.push(P[i]);
      }
      return lo.slice(0, -1).concat(up.slice(0, -1));
    };
    const clampS = (poly) => poly.map(([x, sg]) => [Math.max(cx0 + 0.005, Math.min(cx1 - 0.005, x)), Math.min(G.SIGMA_CROWN, sg)]);
    for (const [, side] of W.SIDES) {
      const mine = ["windshield", "forwardSide", "aftSide"].map((id) => PANES.find((P) => P.id === id && P.side === side)).filter(Boolean);
      const polys = mine.map((P) => hull2(xsOf(P.pts, P.id)));
      // the mask: each pane grown, the hull of each neighbouring pair, and the centre post to the crown line
      // f4-fuselage: each pane grown by one margin all round (a rounded offset, not a scale about its centre), so the
      // surround is an even band and the posts end square on the panes (review f3: ragged at 4x)
      const MARGIN = 0.035;
      const ring = Array.from({ length: 16 }, (_, k) => [MARGIN * Math.cos((k * Math.PI) / 8), MARGIN * Math.sin((k * Math.PI) / 8)]);
      const grown = polys.map((p) => hull2(p.flatMap(([x, sg]) => ring.map(([dx, ds]) => [x + dx, sg + ds]))));
      const masks = grown.slice();
      for (let i = 0; i + 1 < grown.length; i++) masks.push(hull2([...grown[i], ...grown[i + 1]]));
      const ws = grown[0];
      masks.push(hull2([...ws, ...ws.map(([x, sg]) => [x, G.SIGMA_CROWN])]));
      for (const m of masks) fill(clampS(m), side, (d) => `<path class="a3-mask" d="${d}"/>`);
    }
    for (const [, side] of W.SIDES) {
      const mine = PANES.filter((P) => P.side === side);
      for (const P of mine) {
        const poly = hull2(xsOf(P.pts, P.id));
        // f4-fuselage: the GL glass takes the outline drawn here, on a plane fitted through it (review f3: at 4x the
        // GL panes, built on the front-view chord polygons, overran the drawn panes and the mask, ragged blue blobs)
        const drawn = poly.map(([x, sg]) => G.pointAtSigma(x, sg, side));
        const dc = mul(drawn.reduce((a, q) => add(a, q), [0, 0, 0]), 1 / drawn.length);
        let dn = newell(drawn);
        if (dot(dn, P.fr.n) < 0) dn = mul(dn, -1);
        const dfr = frameOf(dc, dn, [0, 0, 1]);
        P.glPoly = drawn.map((q) => sub(q, mul(dfr.n, dot(sub(q, dfr.o), dfr.n))));
        P.glFr = dfr;
        P.glDepth = Math.max(...drawn.map((q) => Math.abs(dot(sub(q, dfr.o), dfr.n))));
        fill(poly, side, (d) => `<path class="a3-pane" d="${d}"/>`);
        // the sky reflected in the upper part of the glass
        const sgs = poly.map((p) => p[1]);
        const hi = Math.max(...sgs);
        const lo = Math.min(...sgs);
        const band = clipPolygonBand(poly, 1, lo + 0.62 * (hi - lo), hi);
        if (band.length >= 3) fill(band, side, (d) => `<path class="a3-pane-sky" d="${d}"/>`);
      }
      for (const P of mine) {
        const poly = hull2(xsOf(P.pts, P.id));
        // the pane's edge in the mask's own token (the panes meet edge to edge in the black surround; a mid ring on each
        // pane read as goggles); only the top specular streak stays pale
        lineOf(poly, side, true, (d) => `<path class="iso-line a3-pane-edge" data-tone="faint" d="${d}"/>`);
        // the specular streak: the upper edge of the pane, inset
        const c = poly.reduce((a, p) => [a[0] + p[0] / poly.length, a[1] + p[1] / poly.length], [0, 0]);
        const inset = grow(poly, 0.82);
        const top = inset.filter(([, sg]) => sg > c[1]).sort((a, b) => a[0] - b[0]);
        if (top.length >= 2) lineOf(top, side, false, (d) => `<path class="a3-pane-spec" d="${d}"/>`);
      }
    }
    // fu/fuselage (item 14): the facets the glazing lies on, for checks() (planar: one Ky/Kz ratio above the belt)
    GLAZING = book.entries().map(([, e]) => ({ seg: e.fp.seg, facet: e.fp.facet, side: e.fp.side }));
    book.flush(ctx);
  }
  ctx.glTarget({
    name: "cockpit",
    part: "nose.canopy",
    group: "cut.fd",
    kind: "cockpit",
    constants: {
      panes: PANES.map((P) => ({ id: P.id, side: P.side, polygon: P.glPoly.map(kit), o: kit(P.glFr.o), u: W.kitDir(P.glFr.u), v: W.kitDir(P.glFr.v), n: W.kitDir(P.glFr.n) })), // f4-fuselage: the drawn outline
      eye: [kit([W.PILOT_EYE[0], -W.PILOT_EYE[1], W.PILOT_EYE[2]]), kit(W.PILOT_EYE)],
      floor: W.m(W.CUT.FD.floor),
    },
  });

  // ---- wipers: blades parked along each windshield's outer frame, flush on the canopy facet 12 ----
  // facet 12 (S0 vertices 12 → 13) between the canopy's front ring and 2.4 is planar (above the belt the canopy rings
  // are S0 scaled by one factor: world.mjs CANOPY_X)
  for (const [s, side] of W.SIDES) {
    const q = facetQuad(W, W.shell("nose.canopy").x[0], 2.4, 12, side);
    const [A0, A1, B1, B0] = q.corners; // A0 (x0, v12), A1 (x0, v13), B1 (x1, v13), B0 (x1, v12)
    const P = (sv, wv) => kit(lerp3(lerp3(A0, A1, wv), lerp3(B0, B1, wv), sv));
    const W0 = 0.42;
    const halfW = 0.025 / len(sub(A1, A0));
    const F = faceNear(canopy, P(0.64, W0));
    const h = W.m(0.035);
    const blade = [];
    for (const [sv, top] of [[0.33, false], [0.95, false], [0.36, true], [0.92, true]])
      for (const dw of [-halfW, halfW]) {
        const p = ontoFace(F, P(sv, W0 + dw * (top ? 0.6 : 1)));
        blade.push(top ? add(p, mul(F.n, h)) : p);
      }
    ctx.hull({ name: `nose.wiper.${s}`, group: "cut.fd", points: blade, tone: "mid", material: "gunmetal" });
  }

  // ---- air-data probes on nose.fwd's lower facets [E positions] --------------------------------------
  // fu/r2-fuselage (fidelity): the A380's ADIRS, not the A320/A330 layout the figure had (3 pitots, 2 AoA vanes, a TAT
  // probe). Three multi-function probes (MFP 1 captain, left; MFP 2 first officer, right; MFP 3, left), each one probe
  // carrying a pitot, a TAT sensor and the AoA vane it turns with (drawn as the raked strut with its pitot tube and a
  // small vane at its root); three side-slip angle vanes (SSA 1 left, 2 and 3 right); a separate standby pitot for the
  // ISIS (left); six integrated static probes, flush discs, three a side (truth.md §11a). Which probe sits on which
  // side and where is an estimate from photographs (E); the counts are sourced (S).
  // facet coordinates from W.facetFrame: u forward, v in-plane up, n outward. Profiles (u, n) in metres.
  const PITOT = [[-0.125, 0], [0.125, 0], [0.22, 0.09], [0.2, 0.11], [0.02, 0.11]];
  const VANE = [[-0.125, 0], [0.125, 0], [-0.02, 0.14], [-0.12, 0.14]];
  const MFP = "mfp";
  const PROBES = [
    { id: "mfp1", side: -1, x: 6.15, z: 4.02, profile: MFP, label: "Multi-function probe 1 (captain) · pitot, total air temperature and angle-of-attack vane in one probe" },
    { id: "mfp2", side: 1, x: 6.15, z: 4.02, profile: MFP, label: "Multi-function probe 2 (first officer) · pitot, total air temperature and angle-of-attack vane in one probe" },
    { id: "mfp3", side: -1, x: 6.6, z: 3.72, profile: MFP, label: "Multi-function probe 3 (ADR 3) · pitot, total air temperature and angle-of-attack vane in one probe" },
    { id: "pitot.sby", side: -1, x: 7.05, z: 4.05, profile: PITOT, label: "Standby pitot · airspeed for the integrated standby instruments (ISIS)" },
    { id: "ssa1", side: -1, x: 7.45, z: 3.75, profile: VANE, label: "Side-slip angle probe 1 · a vane that reads the airflow's sideslip" },
    { id: "ssa2", side: 1, x: 6.6, z: 3.72, profile: VANE, label: "Side-slip angle probe 2 · a vane that reads the airflow's sideslip" },
    { id: "ssa3", side: 1, x: 7.3, z: 3.75, profile: VANE, label: "Side-slip angle probe 3 · a vane that reads the airflow's sideslip" },
  ];
  // fu/r1-fuselage: the pitots and vanes are small solids standing off the skin (review follow-up round 1: as one
  // flat blade each they read as outlined triangles and diamonds lying on the skin at 4x). A pitot is a strut raked
  // forward carrying a tube that points forward (an L, two parts touching face to face); a vane is a thin swept blade.
  // Mid tone with dark sides; the base disc each stands on is drawn on the skin (a 1 cm disc as a part paired with
  // ~140 pitch parts each)
  const TUBE_R = 0.012;
  const TUBE_N = 0.1; // the pitot tube's axis off the skin (m)
  const solidProbe = (pr, H, F) => {
    const N = H.n;
    const U0 = W.kitDir(F.u);
    const U = unit(sub(U0, mul(N, dot(U0, N))));
    const V = cross(N, U);
    const O = ontoFace(H, kit(F.o));
    const at = (u, v, n) => add(O, add(mul(U, W.m(u)), add(mul(V, W.m(v)), mul(N, W.m(n)))));
    const box = (rows) => rows.flatMap(([u, n, half]) => [at(u, -half, n), at(u, half, n)]);
    const name = `nose.probe.${pr.id}`;
    if (pr.profile === PITOT || pr.profile === MFP) {
      const top = TUBE_N - TUBE_R * Math.cos(Math.PI / 8); // the tube's flat bottom face
      ctx.hull({ name: `${name}.strut`, group: "pitch", points: box([[-0.04, 0, 0.009], [0.03, 0, 0.009], [0.0, top, 0.004], [0.035, top, 0.004]]), tone: "mid", material: "gunmetal" });
      // the tube: an octagon with a flat bottom on the strut's top, from just aft of the strut to its forward tip
      const oct = Array.from({ length: 8 }, (_, i) => {
        const a = ((i + 0.5) * Math.PI) / 4;
        return [W.m(TUBE_R) * Math.cos(a), W.m(TUBE_R) * Math.sin(a)];
      });
      ctx.prism({ name: `${name}.tube`, group: "pitch", F: { o: at(0, 0, TUBE_N), a: U, u: V, v: N }, polygon: oct, s0: W.m(-0.01), s1: W.m(0.17), tone: "mid", material: "chrome" });
      // an MFP's AoA vane: a small swept blade at the strut's root, aft of it on the same base (the probe turns with it)
      if (pr.profile === MFP) ctx.hull({ name: `${name}.vane`, group: "pitch", points: box([[-0.165, 0, 0.003], [-0.07, 0, 0.003], [-0.17, 0.06, 0.002], [-0.13, 0.06, 0.002]]), tone: "mid", material: "gunmetal" });
    } else ctx.hull({ name: `${name}.vane`, group: "pitch", points: box([[-0.05, 0, 0.005], [0.05, 0, 0.005], [-0.1, 0.13, 0.003], [-0.045, 0.13, 0.003]]), tone: "mid", material: "gunmetal" });
    // the base disc, drawn on the skin under the doubler plate's outline (an MFP's carries the strut and the vane)
    planeM(ctx, fwd, frameOf(F.o, F.n, F.u), pr.profile === MFP ? `<path class="iso-line" data-tone="lo" d="${rrect(-0.6, 0, 2.6, 0.9, 0.45)}"/>` : `<circle class="iso-line" data-tone="lo" r="${pr.profile === PITOT ? 0.4 : 0.46}" cx="0" cy="0"/>`);
  };
  for (const pr of PROBES) {
    const F = W.facetFrame(pr.x, pr.z, pr.side);
    const H = faceNear(fwd, kit(F.o));
    solidProbe(pr, H, F);
    // the probe's doubler plate on the skin
    const fr = frameOf(F.o, F.n, F.u);
    planeM(ctx, fwd, fr, `<path class="iso-line" data-tone="lo" d="${rrect(pr.profile === MFP ? -0.6 : 0, 0, pr.profile === MFP ? 4.4 : 3.6, 1.0, 0.3)}"/>`);
    ctx.label(`nose.probe.${pr.id}.`, pr.label);
  }
  // the six integrated static probes (ISP): flush discs on their doubler rings, three a side, between the probes
  for (const [, side] of W.SIDES)
    for (const [x, z] of [[6.4, 4.25], [6.85, 3.92], [7.65, 4.0]]) {
      const F = W.facetFrame(x, z, side);
      planeM(ctx, fwd, frameOf(F.o, F.n, F.u), `<circle class="iso-line" data-tone="lo" r="0.5" cx="0" cy="0"/><circle class="iso-line" data-tone="mid" r="0.22" cx="0" cy="0"/>`);
    }

  // ---- static-port plates on nose.fwd's main belt, below the first windows -----------------------
  for (const [, side] of W.SIDES) {
    const F = W.facetFrame(8.35, 5.47, side);
    const fr = frameOf(F.o, F.n, F.u);
    const ports = [-0.75, 0, 0.75].map((x) => `<circle class="iso-line" data-tone="mid" r="0.26" cx="${x}" cy="0"/>`).join("");
    planeM(ctx, fwd, fr, `<path class="iso-line" data-tone="lo" d="${rrect(0, 0, 3.0, 1.5, 0.5)}"/>${ports}`);
  }

  // fu/r2-fuselage: the cavity lining on the flight deck's ends and First's forward end (fuselage.mjs liningPlanes),
  // pushed before the door so the door draws over it
  liningPlanes(ctx, W, "nose");
  // ---- the flight-deck door on the aft bulkhead (nose.fwd's front face, above the floor) ---------------
  {
    const fr = { o: [5.65, 0, 6.0], u: [0, 1, 0], v: [0, 0, -1], n: [-1, 0, 0] };
    const door = rrect(0, -10.1, 8.4, 19.8, 0.8);
    const port = rrect(0, -16.4, 2.0, 2.6, 0.5);
    const kick = rrect(0, -1.6, 6.8, 2.0, 0.4);
    const handle = rrect(3.0, -10.0, 0.5, 1.6, 0.25);
    planeM(ctx, fwd, fr, `<path class="iso-line" data-tone="mid" d="${door}"/><path class="iso-line" data-tone="lo" d="${port}${kick}"/><path class="iso-line" data-tone="mid" d="${handle}"/>`);
    // floor panel joints on the flight-deck floor
    planeM(ctx, fdfloor, { o: [3.775, 0, 6.0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }, `<path class="iso-line" data-tone="faint" d="${rrect(0, 0, 33.0, 12.0, 0.6)}${rrect(0, 0, 4.0, 4.4, 0.4)}"/>`);
  }

  // ---- lightning diverter strips on the radome: vertex lines and the crown midline, one plane per span ----
  {
    // the strips fade out before the tip (they stop 0.45 m short of it; at the tip they fanned into a starburst)
    const xs = W.stationsIn(0.06, 1.9).filter((x) => x >= 0.45);
    const strip = (pointAt, normalAt) => {
      for (let k = 0; k < xs.length - 1; k++) {
        const a = pointAt(xs[k]);
        const b = pointAt(xs[k + 1]);
        const nrm = normalAt((xs[k] + xs[k + 1]) / 2);
        const fr = frameOf(a, nrm, sub(b, a));
        // review round 3: at half strength, fading out over the last third before the tip (the strips read as ribs)
        const xm = (xs[k] + xs[k + 1]) / 2;
        const t = Math.min(1, Math.max(0, (xm - 0.45) / (0.93 - 0.45)));
        // fu/fuselage (item 11): their strength is a token, half in dark and a fifth in light (at a half the light strips
        // dipped 16-30 levels at 8x; the acceptance is 15), drawn with butt ends so neighbouring spans do not overlap
        // (round ends doubled the ink at every ring station)
        const op = (t * t * (3 - 2 * t)).toFixed(3);
        planeM(ctx, radome, fr, `<path class="iso-line a3-divert" data-tone="faint" style="stroke-opacity:calc(var(--a3-divert) * ${op})" d="${pathOf(fr, [a, b])}"/>`);
      }
    };
    const vertexAt = (i, side) => (x) => {
      const q = W.ring2(x)[i];
      return [x, side * q[0], q[1]];
    };
    const normalAtVertex = (i, side) => (x) => {
      const r = W.ring2(x);
      const t1 = sub([x, side * r[i + 1][0], r[i + 1][1]], [x, side * r[i - 1][0], r[i - 1][1]]);
      const dx = 0.02;
      const along = sub(vertexAt(i, side)(x + dx), vertexAt(i, side)(x - dx));
      let n = unit(cross(along, t1));
      if (dot(n, [0, side, 0.5]) < 0) n = mul(n, -1);
      return n;
    };
    for (const i of [11, 13]) for (const [, side] of W.SIDES) strip(vertexAt(i, side), normalAtVertex(i, side));
    strip(
      (x) => [x, 0, W.ring2(x)[15][1]],
      (x) => {
        const dx = 0.02;
        const g = (W.ring2(x + dx)[15][1] - W.ring2(x - dx)[15][1]) / (2 * dx);
        return unit([-g, 0, 1]);
      },
    );
  }

  // ---- the `cabin` accent: the cut rims of the canopy and the First-class crown --------------------
  for (const part of [canopy, ftop])
    for (const e of rimEdges(part, (f) => f.flat && f.n[2] < -0.999)) linePlaneKit(ctx, part, e.a, e.b, e.n, (L) => `<path d="M0 0L${f2(L)} 0"/>`, { accent: "cabin" });

  // ---- labels ------------------------------------------------------------------------------------
  ctx.label("nose.radome", "Radome · weather radar inside · nose tip 4.81 m up");
  ctx.label("nose.canopy", "Flight-deck roof · 2 windshields, 4 side windows · click to lift", "cutaway");
  ctx.label("nose.fdfloor", "Flight-deck floor · 6.00 m · nose-gear bay ceiling below");
  ctx.label("nose.baywall", "Nose-gear bay wall · the gear retracts forward into it");
  ctx.label("nose.fwd", "Forward fuselage · M1 doors · first main-deck windows");
  ctx.label("nose.f.block", "Forward lower fuselage · forward cargo hold, 20–22 LD3 containers or 7 pallets (door on the right)");
  ctx.label("nose.f.wall", "Forward main-deck wall · First class");
  ctx.label("nose.f.top", "Forward upper deck · First-class ceiling · click to lift", "cutaway");
  ctx.label("nose.wiper", "Windshield wiper");

  // ---- CSS -----------------------------------------------------------------------------------------
  ctx.css(`.iso{--a3-divert:.2}
.iso[data-theme="dark"]{--a3-divert:.5}
.a3-stage .iso-line.a3-divert{stroke-linecap:butt}
.iso{--a3-pane-glass:#3b4452;--a3-mask:#22262b;--a3-mullion:#22262b;--a3-pane-rim:#6f7a86;--a3-pane-spec:#e8eef4;--a3-pane-sky:#5c6b7a}
.iso[data-theme="dark"]{--a3-pane-glass:#0b0f15;--a3-mask:#050607;--a3-mullion:#2a3038;--a3-pane-rim:#5b6670;--a3-pane-spec:#5b6670;--a3-pane-sky:#121a22}
.a3-pane-sky{fill:var(--a3-pane-sky);stroke:none}
.a3-pane{fill:var(--a3-pane-glass);stroke:var(--a3-pane-glass);stroke-width:.3px;stroke-linejoin:round}
.a3-mask{fill:var(--a3-mask);stroke:var(--a3-mask);stroke-width:.3px;stroke-linejoin:round}
.a3-pane-spec{fill:none;stroke:var(--a3-pane-spec);stroke-width:var(--anatomy-weight);stroke-linecap:round;opacity:.7}
.a3-stage .iso-line.a3-pane-edge{stroke:var(--a3-pane-rim)}`);
}

// ---------------------------------------------------------------------------------------------
// checks (--check): the loft against FUSELAGE.stations, panes on the canopy
// ---------------------------------------------------------------------------------------------
export function checks(ctx) {
  const { W, M } = ctx;
  const say = (line) => console.log(`M2 nose: ${line}`);
  const rows = [];
  for (const [x, hw, top, bottom] of M.FUSELAGE.stations) {
    if (x > 15.8 + 1e-9) continue;
    const l = W.loftAt(Math.max(0.06, x));
    rows.push(`${x}: top ${l.topZ.toFixed(3)} (${top}) bottom ${l.bottomZ.toFixed(3)} (${bottom}) half-width ${l.halfWidth.toFixed(3)} (${hw})`);
  }
  say(`loft against FUSELAGE.stations (model in brackets):\n    ${rows.join("\n    ")}`);
  // fu/fuselage (item 14): the canopy stations take the model's section (world.mjs CANOPY_X); the windshield's half-width
  // and the underside behind the radome against the model (DESIGN §11.5 had 1.69 against 1.81 and 3.04 against 3.29)
  {
    const at = (x) => ({ l: W.loftAt(x), m: M.fuselageAt(x) });
    const a = at(1.9);
    const b = at(2.5);
    const errs = [Math.abs(a.l.halfWidth - a.m.halfWidth), Math.abs(b.l.halfWidth - b.m.halfWidth), Math.abs(a.l.bottomZ - a.m.bottomZ)];
    say(`nose section: half-width at x 1.9 ${a.l.halfWidth.toFixed(3)} (model ${a.m.halfWidth.toFixed(3)}), at x 2.5 ${b.l.halfWidth.toFixed(3)} (${b.m.halfWidth.toFixed(3)}); bottom at x 1.9 ${a.l.bottomZ.toFixed(3)} (${a.m.bottomZ.toFixed(3)}); top at x 1.9 ${a.l.topZ.toFixed(3)} (${a.m.topZ.toFixed(3)})`);
    if (errs[0] > 0.02 || errs[1] > 0.02 || errs[2] > 0.03) throw new Error(`M2: the nose section is off the model (half-width ${errs[0].toFixed(3)}, ${errs[1].toFixed(3)} m; bottom ${errs[2].toFixed(3)} m)`);
    // every facet that carries a pane, the mask or a wiper is planar: its fourth corner on the plane of the other three
    let worst = 0;
    const off = (seg, i, side) => {
      if (i === "crown") return 0;
      const r0 = W.ring2(seg[0]);
      const r1 = W.ring2(seg[1]);
      const P = (x, q) => [x, side * q[0], q[1]];
      const [A, B, C, D] = [P(seg[0], r0[i]), P(seg[0], r0[i + 1]), P(seg[1], r1[i]), P(seg[1], r1[i + 1])];
      const n = unit(cross(sub(B, A), sub(C, A)));
      return Math.abs(dot(sub(D, A), n));
    };
    for (const g of GLAZING) worst = Math.max(worst, off(g.seg, g.facet, g.side));
    for (const [, side] of W.SIDES) worst = Math.max(worst, off([W.shell("nose.canopy").x[0], 2.4], 12, side));
    const facets = [...new Set(GLAZING.map((g) => g.facet))].sort((p, q) => String(p).localeCompare(String(q), undefined, { numeric: true }));
    say(`glazing: ${GLAZING.length} facet planes (facets ${facets.join(", ")}) and the wiper facet; corner off its plane ${(worst * 1000).toFixed(3)} mm at most`);
    if (worst > 1e-6) throw new Error(`M2: a facet under the cockpit glazing is not planar (${(worst * 1000).toFixed(2)} mm)`);
  }
  const [x0, x1] = W.shell("nose.canopy").x;
  for (const P of PANES)
    for (const p of P.proj) {
      if (p[0] < x0 - 1e-6 || p[0] > x1 + 1e-6 || p[2] < W.CUT.FD.cut) throw new Error(`pane ${P.id} ${P.s} point ${p.map((v) => v.toFixed(3))} is off the canopy`);
      if (!pointInPoly([p[1], p[2] - 1e-4], W.ring2(p[0]))) throw new Error(`pane ${P.id} ${P.s} point ${p.map((v) => v.toFixed(3))} lies outside the canopy loft`);
    }
  // posts between neighbouring panes (closest points of their outlines)
  const gapOf = (A, B) => {
    let best = Infinity;
    for (const p of A.proj) for (const q of B.proj) best = Math.min(best, len(sub(p, q)));
    return best;
  };
  const byId = (id, side) => PANES.find((P) => P.id === id && P.side === side);
  const posts = [["windshield", 1, "windshield", -1], ["windshield", 1, "forwardSide", 1], ["forwardSide", 1, "aftSide", 1]].map(([a, sa, b, sb]) => `${a}–${b} ${gapOf(byId(a, sa), byId(b, sb)).toFixed(3)}`);
  say(`posts between panes (m): ${posts.join(", ")}`);
  // f4-fuselage: the GL glass outline (the drawn pane, ≤ 32 vertices for the pane pass's uniform)
  for (const P of PANES) if (!P.glPoly || P.glPoly.length > 32 || P.glPoly.length < 3) throw new Error(`pane ${P.id} ${P.s}: GL outline has ${P.glPoly ? P.glPoly.length : 0} vertices (3-32)`);
  say(`pane GL outlines: the drawn panes, ${Math.max(...PANES.map((P) => P.glPoly.length))} vertices at most, off their plane ${Math.max(...PANES.map((P) => P.glDepth)).toFixed(3)} m at most`);
  say(`panes: ${PANES.length} on nose.canopy, chord depth ${Math.max(...PANES.map((P) => P.lift)).toFixed(3)} m at most; x ${PANES.map((P) => `${P.id}.${P.s} ${Math.min(...P.proj.map((p) => p[0])).toFixed(2)}–${Math.max(...P.proj.map((p) => p[0])).toFixed(2)}`).join(", ")}`);
}
