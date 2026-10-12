// hull3.mjs: convex polyhedra for the 3D mode's T.hull (kit patch 6).
// convexHull3(points) builds the convex hull of a point set as merged planar faces with outward normals.
// clipHull(points, n, d) keeps the part of the hull of `points` with n·p <= d. Pure, Node and browser.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Size of a point set: the diagonal of its bounding box. */
export function sizeOf(points) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const p of points)
    for (let i = 0; i < 3; i++) {
      if (p[i] < lo[i]) lo[i] = p[i];
      if (p[i] > hi[i]) hi[i] = p[i];
    }
  return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) || 1;
}

/** Newell normal of a polygon loop (unit, outward for a counter-clockwise loop seen from outside). */
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

/**
 * Convex hull of a 3D point set. Returns { points, faces: [{ ring: [indices], n, d }] }: `points` are the
 * hull's vertices, every face is a planar convex loop, counter-clockwise seen from outside, coplanar triangles
 * merged at `merge` × size. Throws below 4 non-coplanar points.
 */
export function convexHull3(input, { merge = 1e-6, name = "hull" } = {}) {
  const size = sizeOf(input);
  const tol = Math.max(1e-12, 1e-9 * size);
  const pts = [];
  const seen = new Map();
  for (const p of input) {
    const key = `${Math.round(p[0] / tol / 64)}|${Math.round(p[1] / tol / 64)}|${Math.round(p[2] / tol / 64)}`;
    if (seen.has(key)) continue;
    seen.set(key, pts.length);
    pts.push([p[0], p[1], p[2]]);
  }
  if (pts.length < 4) throw new Error(`turning: hull ${name} needs at least 4 non-coplanar points`);
  const eps = 1e-8 * size;
  // initial tetrahedron
  let i0 = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i][0] < pts[i0][0]) i0 = i;
  let i1 = -1;
  let best = -1;
  for (let i = 0; i < pts.length; i++) {
    const d = len(sub(pts[i], pts[i0]));
    if (d > best) (best = d), (i1 = i);
  }
  let i2 = -1;
  best = -1;
  const e01 = unit(sub(pts[i1], pts[i0]));
  for (let i = 0; i < pts.length; i++) {
    const w = sub(pts[i], pts[i0]);
    const d = len(cross(w, e01));
    if (d > best) (best = d), (i2 = i);
  }
  if (best < eps) throw new Error(`turning: hull ${name} needs at least 4 non-coplanar points (all collinear)`);
  const n012 = unit(cross(sub(pts[i1], pts[i0]), sub(pts[i2], pts[i0])));
  let i3 = -1;
  best = -1;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.abs(dot(sub(pts[i], pts[i0]), n012));
    if (d > best) (best = d), (i3 = i);
  }
  if (best < eps) throw new Error(`turning: hull ${name} needs at least 4 non-coplanar points (all coplanar)`);
  const faces = [];
  const edges = new Map();
  const centre = [0, 1, 2].map((c) => (pts[i0][c] + pts[i1][c] + pts[i2][c] + pts[i3][c]) / 4);
  const addFace = (a, b, c) => {
    let n = cross(sub(pts[b], pts[a]), sub(pts[c], pts[a]));
    const l = len(n);
    n = l > 0 ? [n[0] / l, n[1] / l, n[2] / l] : [0, 0, 0];
    const face = { v: [a, b, c], n, d: dot(n, pts[a]), alive: true };
    const id = faces.length;
    faces.push(face);
    edges.set(`${a}|${b}`, id);
    edges.set(`${b}|${c}`, id);
    edges.set(`${c}|${a}`, id);
    return id;
  };
  const tetra = [
    [i0, i1, i2],
    [i0, i3, i1],
    [i1, i3, i2],
    [i2, i3, i0],
  ];
  for (let [a, b, c] of tetra) {
    const n = cross(sub(pts[b], pts[a]), sub(pts[c], pts[a]));
    if (dot(n, sub(centre, pts[a])) > 0) [b, c] = [c, b];
    addFace(a, b, c);
  }
  const used = new Set([i0, i1, i2, i3]);
  const order = pts.map((_, i) => i).filter((i) => !used.has(i));
  for (const p of order) {
    const P = pts[p];
    const visible = [];
    for (let f = 0; f < faces.length; f++) {
      const face = faces[f];
      if (face.alive && dot(face.n, P) - face.d > eps) visible.push(f);
    }
    if (!visible.length) continue;
    const isVisible = new Set(visible);
    const horizon = [];
    for (const f of visible) {
      const [a, b, c] = faces[f].v;
      for (const [u, w] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const twin = edges.get(`${w}|${u}`);
        if (twin === undefined || !isVisible.has(twin)) horizon.push([u, w]);
      }
    }
    for (const f of visible) {
      const face = faces[f];
      face.alive = false;
      const [a, b, c] = face.v;
      for (const [u, w] of [
        [a, b],
        [b, c],
        [c, a],
      ])
        if (edges.get(`${u}|${w}`) === f) edges.delete(`${u}|${w}`);
    }
    for (const [u, w] of horizon) addFace(u, w, p);
  }
  const alive = faces.map((face, id) => ({ ...face, id })).filter((face) => face.alive);
  // merge coplanar neighbours
  const parent = new Map(alive.map((face) => [face.id, face.id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const tolMerge = merge * size;
  const byId = new Map(alive.map((face) => [face.id, face]));
  for (const face of alive) {
    const [a, b, c] = face.v;
    for (const [u, w] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const twin = edges.get(`${w}|${u}`);
      if (twin === undefined || twin === face.id) continue;
      const other = byId.get(twin);
      if (!other) continue;
      const far = other.v.every((q) => Math.abs(dot(face.n, pts[q]) - face.d) <= tolMerge) && face.v.every((q) => Math.abs(dot(other.n, pts[q]) - other.d) <= tolMerge);
      if (far && dot(face.n, other.n) > 0.99) {
        const ra = find(face.id);
        const rb = find(twin);
        if (ra !== rb) parent.set(ra, rb);
      }
    }
  }
  const groups = new Map();
  for (const face of alive) {
    const root = find(face.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(face);
  }
  const outFaces = [];
  for (const list of groups.values()) {
    const members = new Set(list.map((face) => face.id));
    const next = new Map();
    for (const face of list) {
      const [a, b, c] = face.v;
      for (const [u, w] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        const twin = edges.get(`${w}|${u}`);
        if (twin !== undefined && members.has(twin)) continue;
        next.set(u, w);
      }
    }
    const start = next.keys().next().value;
    const ring = [start];
    let at = next.get(start);
    let guard = 0;
    while (at !== start && guard++ < 100000) {
      ring.push(at);
      at = next.get(at);
      if (at === undefined) throw new Error(`turning: hull ${name}: a face boundary did not close`);
    }
    // area-weighted normal
    let n = [0, 0, 0];
    for (const face of list) {
      const [a, b, c] = face.v;
      const w = cross(sub(pts[b], pts[a]), sub(pts[c], pts[a]));
      n = [n[0] + w[0], n[1] + w[1], n[2] + w[2]];
    }
    n = unit(n);
    // drop vertices collinear with their neighbours only when no other face uses them as a corner
    const d = ring.reduce((s, q) => s + dot(n, pts[q]), 0) / ring.length;
    outFaces.push({ ring, n, d });
  }
  // compact the vertex list
  const keep = new Map();
  const points = [];
  for (const face of outFaces)
    for (const q of face.ring)
      if (!keep.has(q)) {
        keep.set(q, points.length);
        points.push(pts[q]);
      }
  for (const face of outFaces) face.ring = face.ring.map((q) => keep.get(q));
  return { points, faces: outFaces, size };
}

/** The vertices of hull(points) ∩ { p : n·p <= d }. */
export function clipPoints(points, n, d, name = "hull") {
  const hull = convexHull3(points, { name });
  const eps = 1e-9 * hull.size;
  const side = hull.points.map((p) => dot(n, p) - d);
  const out = hull.points.filter((_, i) => side[i] <= eps);
  const done = new Set();
  for (const face of hull.faces) {
    for (let i = 0; i < face.ring.length; i++) {
      const a = face.ring[i];
      const b = face.ring[(i + 1) % face.ring.length];
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (done.has(key)) continue;
      done.add(key);
      const sa = side[a];
      const sb = side[b];
      if ((sa < -eps && sb > eps) || (sa > eps && sb < -eps)) {
        const t = sa / (sa - sb);
        const P = hull.points[a];
        const Q = hull.points[b];
        out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t, P[2] + (Q[2] - P[2]) * t]);
      }
    }
  }
  return out;
}

/** Planes [nx, ny, nz, d] of a hull given as points and index loops (n·p <= d inside). */
export function planesOf(points, faces) {
  return faces.map((ring) => {
    const loop = ring.map((i) => points[i]);
    const n = newell(loop);
    let d = -Infinity;
    for (const p of loop) d = Math.max(d, dot(n, p));
    return [n[0], n[1], n[2], d];
  });
}
