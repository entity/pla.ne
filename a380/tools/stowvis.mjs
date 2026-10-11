// The stowed-gear visibility test (M5's z-buffer test, AUDIT.md "Stowed gear"): renders every recorded shape of a
// --verify page into a WebGL depth buffer with the gear stowed (gear 0, doors shut) at 72 turns × pitch {3, 9, 12.5}
// × flaps {0, 1+F} (432 renders, 960×680 at 1x) and counts the pixels where a gear part (not a door, fairing or beam)
// is the nearest surface. Each leaking pixel is traced back to its airframe point and the parts around it.
//   node a380/build.mjs --verify --out=a380/tmp/v.html
//   node a380/tools/stowvis.mjs a380/tmp/v.html [--max 3] [--control]
// --control renders the gear down instead (a positive control: it must report thousands of pixels and fail).
// (fu/f3-verify) It names the renderer of its own WebGL context (the page's glInfo is absent on a verify page), and each
// leaking point says why the gear shows: "hole" (no surface of the airframe covers the pixel's centre nearer than the
// gear: a gap between the shells, with each neighbour's distance in px and model mm and the open share of the pixel)
// or "crack" (a surface does cover it: the rasteriser missed a covered pixel). DRIVE_ANGLE=swiftshader runs it on
// another renderer for comparison.
// Prints the total, the count per part and per state, and up to 40 leaking points (model metres). Exit 1 over --max.
// A tracked copy of the main checkout's tmp/i-stowloc.js (review rounds 1-3, fu/gear); the page-side follow now reads
// a rule's fallback channel (gearBody falls back to gear).
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const page = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--max");
const maxAt = args.indexOf("--max");
const MAX = maxAt >= 0 ? Number(args[maxAt + 1]) : 3;
if (!page) {
  console.log("usage: node a380/tools/stowvis.mjs <verify page> [--max 3]");
  process.exit(2);
}
// the page-side test (evaluated in the verify page; it returns a JSON string)
const TEST0 = [
  "(() => { try {",
  "  const V = window.__isoVerify;",
  "  const A3 = window.__a380;",
  "  const C = A3.controller;",
  "  const W = 960, H = 680, SCALE = 1, w = W * SCALE, h = H * SCALE, STATIC = 30000;",
  "  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];",
  "  const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];",
  "  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];",
  "  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];",
  "  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];",
  "  const unit3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };",
  "  const frameOf = (F) => {",
  "    if (F.u && F.v) return F;",
  "    const a = unit3(F.a);",
  "    const helper = Math.abs(a[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];",
  "    const u = unit3(cross3(helper, a));",
  "    return { o: F.o, a, u, v: cross3(a, u) };",
  "  };",
  "  function meshOf(shape) {",
  "    const tris = [];",
  "    const quad = (a, b, c, d) => tris.push(a, b, c, a, c, d);",
  "    if (shape.kind === \"prism\") {",
  "      const F = frameOf(shape.F);",
  "      const at = (s, [x, y]) => add3(add3(F.o, mul3(F.a, s)), add3(mul3(F.u, x), mul3(F.v, y)));",
  "      const n = shape.poly.length;",
  "      const centre = shape.poly.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]);",
  "      for (const s of [shape.s0, shape.s1]) for (let i = 0; i < n; i++) tris.push(at(s, centre), at(s, shape.poly[i]), at(s, shape.poly[(i + 1) % n]));",
  "      for (let i = 0; i < n; i++) quad(at(shape.s0, shape.poly[i]), at(shape.s0, shape.poly[(i + 1) % n]), at(shape.s1, shape.poly[(i + 1) % n]), at(shape.s1, shape.poly[i]));",
  "    } else if (shape.kind === \"body\") {",
  "      const F = frameOf(shape.F);",
  "      const count = 72;",
  "      const ring = (s, r) => Array.from({ length: count }, (_, j) => { const t = (j / count) * Math.PI * 2; return add3(add3(F.o, mul3(F.a, s)), add3(mul3(F.u, r * Math.cos(t)), mul3(F.v, r * Math.sin(t)))); });",
  "      const poly = shape.poly;",
  "      for (let i = 0; i < poly.length; i++) {",
  "        const [s0, r0] = poly[i];",
  "        const [s1, r1] = poly[(i + 1) % poly.length];",
  "        if (r0 < 1e-9 && r1 < 1e-9) continue;",
  "        const a = ring(s0, r0);",
  "        const b = ring(s1, r1);",
  "        for (let j = 0; j < count; j++) quad(a[j], a[(j + 1) % count], b[(j + 1) % count], b[j]);",
  "      }",
  "    } else if (shape.kind === \"ball\") {",
  "      const rows = 32;",
  "      const cols = 64;",
  "      const flats = shape.flats || [];",
  "      const at = (i, j) => {",
  "        const phi = (i / rows) * Math.PI;",
  "        const t = (j / cols) * Math.PI * 2;",
  "        let n = [Math.sin(phi) * Math.cos(t), Math.sin(phi) * Math.sin(t), Math.cos(phi)];",
  "        let p = mul3(n, shape.r);",
  "        for (const [nx, ny, nz, d] of flats) {",
  "          const k = nx * p[0] + ny * p[1] + nz * p[2];",
  "          if (k > d) p = sub3(p, mul3([nx, ny, nz], k - d));",
  "        }",
  "        return add3(shape.o, p);",
  "      };",
  "      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) quad(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j));",
  "    } else if (shape.kind === \"hull\") {",
  "      for (const ring of shape.faces) for (let i = 1; i + 1 < ring.length; i++) tris.push(shape.points[ring[0]], shape.points[ring[i]], shape.points[ring[i + 1]]);",
  "    } else if (shape.kind === \"box\") {",
  "      const c = (sx, sy, sz) => add3(shape.o, add3(add3(mul3(shape.axes[0], sx * shape.half[0]), mul3(shape.axes[1], sy * shape.half[1])), mul3(shape.axes[2], sz * shape.half[2])));",
  "      const v = [c(-1, -1, -1), c(1, -1, -1), c(1, 1, -1), c(-1, 1, -1), c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)];",
  "      for (const [a, b, cc, d] of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) quad(v[a], v[b], v[cc], v[d]);",
  "    } else if (shape.kind === \"tube\") {",
  "      const pts = [];",
  "      const radii = [];",
  "      shape.points.forEach((p, i) => {",
  "        if (pts.length && Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1], p[2] - pts[pts.length - 1][2]) < 1e-6) return;",
  "        pts.push(p);",
  "        radii.push(shape.radii[i]);",
  "      });",
  "      if (pts.length < 2) return tris;",
  "      const count = 20;",
  "      let u = null;",
  "      const rings = pts.map((p, i) => {",
  "        const t = unit3(sub3(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));",
  "        if (!u) { const helper = Math.abs(t[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]; u = unit3(cross3(helper, t)); } else u = unit3(sub3(u, mul3(t, dot3(u, t))));",
  "        const v = cross3(t, u);",
  "        const r = radii[i];",
  "        return Array.from({ length: count }, (_, j) => { const a = (j / count) * Math.PI * 2; return add3(p, add3(mul3(u, r * Math.cos(a)), mul3(v, r * Math.sin(a)))); });",
  "      });",
  "      for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < count; j++) quad(rings[i][j], rings[i][(j + 1) % count], rings[i + 1][(j + 1) % count], rings[i + 1][j]);",
  "      for (const [index, p] of [[0, pts[0]], [rings.length - 1, pts[pts.length - 1]]]) for (let j = 0; j < count; j++) tris.push(p, rings[index][j], rings[index][(j + 1) % count]);",
  "    }",
  "    return tris;",
  "  }",
  "  const canvas = Object.assign(document.createElement(\"canvas\"), { width: w, height: h });",
  "  const gl = canvas.getContext(\"webgl\", { antialias: false, preserveDrawingBuffer: true, alpha: false, depth: true });",
  // (fu/f3-verify) the test's own context, named: the renderer and the depth buffer it rasterises into
  "  const dbg = gl.getExtension(\"WEBGL_debug_renderer_info\");",
  "  const glAbout = { renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), version: gl.getParameter(gl.VERSION), depthBits: gl.getParameter(gl.DEPTH_BITS), antialias: gl.getContextAttributes().antialias, ua: navigator.userAgent.replace(/^.*(Chrome\\/[0-9.]+).*$/, \"$1\") };",
  "  const vs = \"attribute vec3 p;uniform vec3 uR0;uniform vec3 uR1;uniform vec3 uR2;uniform vec3 uT;uniform vec3 uM0;uniform vec3 uM1;uniform vec2 uO;uniform vec3 uV;uniform vec2 uView;uniform float uSpan;void main(){vec3 q=vec3(dot(uR0,p),dot(uR1,p),dot(uR2,p))+uT;vec2 s=uO+vec2(dot(uM0,q),dot(uM1,q));gl_Position=vec4(s.x/uView.x*2.-1.,1.-s.y/uView.y*2.,-dot(uV,q)/uSpan,1.);}\";",
  "  const fs = \"precision highp float;uniform vec3 uId;void main(){gl_FragColor=vec4(uId,1.);}\";",
  "  const compile = (type, source) => { const sh = gl.createShader(type); gl.shaderSource(sh, source); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };",
  "  const program = gl.createProgram();",
  "  gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));",
  "  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));",
  "  gl.linkProgram(program);",
  "  gl.useProgram(program);",
  "  const loc = (name) => gl.getUniformLocation(program, name);",
  "  const where = { p: gl.getAttribLocation(program, \"p\"), R0: loc(\"uR0\"), R1: loc(\"uR1\"), R2: loc(\"uR2\"), T: loc(\"uT\"), M0: loc(\"uM0\"), M1: loc(\"uM1\"), O: loc(\"uO\"), V: loc(\"uV\"), view: loc(\"uView\"), span: loc(\"uSpan\"), id: loc(\"uId\") };",
  "  const bufferOf = (shapes) => {",
  "    const pos = [];",
  "    for (const shape of shapes) for (const p of meshOf(shape)) pos.push(p[0], p[1], p[2]);",
  "    const b = gl.createBuffer();",
  "    gl.bindBuffer(gl.ARRAY_BUFFER, b);",
  "    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);",
  "    return { b, count: pos.length / 3 };",
  "  };",
  "",
  "  const fsD = \"precision highp float;void main(){float d=gl_FragCoord.z;vec3 e=fract(d*vec3(1.,255.,65025.));e-=e.yzz*vec3(1./255.,1./255.,0.);gl_FragColor=vec4(e,1.);}\";",
  "  const programD = gl.createProgram();",
  "  gl.attachShader(programD, compile(gl.VERTEX_SHADER, vs));",
  "  gl.attachShader(programD, compile(gl.FRAGMENT_SHADER, fsD));",
  "  gl.linkProgram(programD);",
  "  const locD = (name) => gl.getUniformLocation(programD, name);",
  "  const whereD = { p: gl.getAttribLocation(programD, \"p\"), R0: locD(\"uR0\"), R1: locD(\"uR1\"), R2: locD(\"uR2\"), T: locD(\"uT\"), M0: locD(\"uM0\"), M1: locD(\"uM1\"), O: locD(\"uO\"), V: locD(\"uV\"), view: locD(\"uView\"), span: locD(\"uSpan\"), id: locD(\"uId\") };",
  "  const parts = V.parts.map((part, index) => ({ index, group: part.group, name: part.name, mesh: bufferOf(part.shapes) }));",
  "  const statics = V.statics.map((item) => ({ rank: item.rank, mesh: bufferOf(item.shapes) }));",
  "  const colour = (id) => [((id + 1) & 255) / 255, (((id + 1) >> 8) & 255) / 255, 0];",
  "  const zIds = (useDepth = false) => {",
  "    const wh = useDepth ? whereD : where;",
  "    gl.useProgram(useDepth ? programD : program);",
  "    const cams = C.cams();",
  "    const world = cams.world;",
  "    gl.viewport(0, 0, w, h);",
  "    gl.enable(gl.DEPTH_TEST);",
  "    gl.depthFunc(gl.LESS);",
  "    gl.clearColor(0, 0, 0, 1);",
  "    gl.clearDepth(1);",
  "    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);",
  "    gl.uniform3f(wh.M0, world.m[0], world.m[1], world.m[2]);",
  "    gl.uniform3f(wh.M1, world.m[3], world.m[4], world.m[5]);",
  "    gl.uniform2f(wh.O, world.ox, world.oy);",
  "    gl.uniform3f(wh.V, world.V[0], world.V[1], world.V[2]);",
  "    gl.uniform2f(wh.view, W, H);",
  "    gl.uniform1f(wh.span, 4000);",
  "    const draw = (mesh, R, t, id) => {",
  "      gl.uniform3f(wh.R0, R[0], R[1], R[2]);",
  "      gl.uniform3f(wh.R1, R[3], R[4], R[5]);",
  "      gl.uniform3f(wh.R2, R[6], R[7], R[8]);",
  "      gl.uniform3f(wh.T, t[0], t[1], t[2]);",
  "      gl.uniform3fv(wh.id, colour(id));",
  "      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.b);",
  "      gl.enableVertexAttribArray(wh.p);",
  "      gl.vertexAttribPointer(wh.p, 3, gl.FLOAT, false, 0, 0);",
  "      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);",
  "    };",
  "    const eye = [1, 0, 0, 0, 1, 0, 0, 0, 1];",
  "    for (const item of statics) draw(item.mesh, eye, [0, 0, 0], STATIC + item.rank);",
  "    for (const part of parts) {",
  "      const cam = part.group >= 0 ? cams[part.group] : null;",
  "      draw(part.mesh, cam ? cam.R : eye, cam ? cam.t : [0, 0, 0], part.index);",
  "    }",
  "    const pixels = new Uint8Array(w * h * 4);",
  "    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);",
  "    if (useDepth) return pixels;",
  "    const ids = new Int32Array(w * h);",
  "    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((h - 1 - y) * w + x) * 4; ids[y * w + x] = pixels[i] + pixels[i + 1] * 256 - 1; }",
  "    return ids;",
  "  };",
  "  // follow (rules from the page data)",
  "  const D = A3.data;",
  "  const tableAt = (t, x, e) => { if (x <= t[0][0]) return t[0][1]; const L = t[t.length - 1]; if (x >= L[0]) return L[1]; for (let i = 1; i < t.length; i++) { const [x0, y0] = t[i - 1], [x1, y1] = t[i]; if (x <= x1) { let u = (x - x0) / (x1 - x0 || 1); if (e === \"smooth\") u = u * u * (3 - 2 * u); return y0 + (y1 - y0) * u; } } return L[1]; };",
  "  const info = new Map(D.groups.map((g) => [g.name, g]));",
  "  const follow = (ch) => { const v = {}; const by = new Map(); for (const r of D.rules) { if (!by.has(r.group)) by.set(r.group, []); by.get(r.group).push(r); }",
  "    for (const [name, list] of by) { if (list[0].sync) continue; let x = 0; for (const r of list) { const c = ch[r.channel] ?? (r.fallback ? ch[r.fallback] : undefined) ?? 0; x += r.table ? tableAt(r.table, c, r.ease ?? null) : c; } const g = info.get(name); if (g && g.range && g.kind !== \"turn\") x = Math.min(Math.max(x, Math.min(g.range[0], g.range[1])), Math.max(g.range[0], g.range[1])); v[name] = x; } return v; };",
  "  const isGear = (name) => /^(nlg|wlg|blg)\\./.test(name) && !/door|fairing|keel|doorbeam/.test(name);",
  "  const out = [];",
  "  let tot = 0;",
  "  const tally = {};",
  "  const turns = {};",
  "  for (const [slat, flap, droop] of [[0, 0, 0], [20, 8, 5]]) for (const pitch of [3, 9, 12.5]) for (let i = 0; i < 72; i++) {",
  "    const turn = i * 5;",
  "    const ch = { turn, lift: 60, pitch, rot: 0, trim: 1, gear: 0, gearBody: 0, gearDoors: 0, steer: 0, slat, flap, droop, roll: 0, pitchCmd: 0, yaw: 0, spoiler: 0, spoiler1: 0, cabin: 0 };",
  "    C.set(follow(ch));",
  "    const ids = zIds();",
  "    const leaks = [];",
  "    for (let k = 0; k < ids.length; k++) { const id = ids[k]; if (id >= 0 && id < STATIC && isGear(V.parts[id].name)) leaks.push(k); }",
  "    if (!leaks.length) continue;",
  "    const px = zIds(true);",
  "    const cams = C.cams();",
  "    const world = cams.world;",
  "    for (const k of leaks) {",
  "      tot++;",
  "      const x = k % w, y = Math.floor(k / w);",
  "      const i4 = ((h - 1 - y) * w + x) * 4;",
  "      const d = px[i4] / 255 + px[i4 + 1] / 255 / 255 + px[i4 + 2] / 255 / 65025;",
  "      const rhs = [x + 0.5 - world.ox, y + 0.5 - world.oy, -(2 * d - 1) * 4000];",
  "      const Mx = [[world.m[0], world.m[1], world.m[2]], [world.m[3], world.m[4], world.m[5]], [world.V[0], world.V[1], world.V[2]]];",
  "      const det3 = (A) => A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);",
  "      const D0 = det3(Mx);",
  "      const q = [0, 1, 2].map((j) => det3(Mx.map((row, r) => row.map((v, c) => (c === j ? rhs[r] : v)))) / D0);",
  "      const part = parts[ids[k]];",
  "      const cam = part.group >= 0 ? cams[part.group] : null;",
  "      let p = q;",
  "      if (cam) { const R = cam.R, t = cam.t; const u = [q[0] - t[0], q[1] - t[1], q[2] - t[2]]; p = [R[0] * u[0] + R[3] * u[1] + R[6] * u[2], R[1] * u[0] + R[4] * u[1] + R[7] * u[2], R[2] * u[0] + R[5] * u[1] + R[8] * u[2]]; }",
  "      // the same point in the airframe (pitch) frame",
  "      const camP = cams[V.parts.find((pp) => pp.name === \"wlg.r.fit\").group];",
  "      let a = q;",
  "      if (camP) { const R = camP.R, t = camP.t; const u = [q[0] - t[0], q[1] - t[1], q[2] - t[2]]; a = [R[0] * u[0] + R[3] * u[1] + R[6] * u[2] + 27.49, R[1] * u[0] + R[4] * u[1] + R[7] * u[2], R[2] * u[0] + R[5] * u[1] + R[8] * u[2] + 7.0]; }",
  "      const nb = new Set();",
  "      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const qq = ids[(y + dy) * w + (x + dx)]; if (qq >= 0 && qq < STATIC && !isGear(V.parts[qq].name)) nb.add(V.parts[qq].name); }",
  // (fu/f3-verify) what lets the gear through at this pixel: every surface of the airframe around it (the 5x5 neighbours),
  // projected and tested at the pixel's centre. "covered" means a surface lies over the centre nearer than the gear (a
  // rasteriser crack: the renderer missed a covered pixel); "hole" means nothing covers it nearer (a gap in the shells
  // themselves), with each neighbour's screen distance from the centre in px and in model mm (1 px = 1/k kit units)
  "      const gap = [];",
  "      if (out.length < 40) { const cx = x + 0.5, cy = y + 0.5, dq = dot3(world.V, q);",
  "        for (const name of nb) { const pp = parts.find((r) => r.name === name); const src = V.parts[pp.index]; const cm = pp.group >= 0 ? cams[pp.group] : null; let best = Infinity, front = false;",
  "          const tri = []; for (const sh of src.shapes) for (const v of meshOf(sh)) { const R = cm ? cm.R : [1, 0, 0, 0, 1, 0, 0, 0, 1], t = cm ? cm.t : [0, 0, 0]; const wv = [R[0] * v[0] + R[1] * v[1] + R[2] * v[2] + t[0], R[3] * v[0] + R[4] * v[1] + R[5] * v[2] + t[1], R[6] * v[0] + R[7] * v[1] + R[8] * v[2] + t[2]]; tri.push([world.ox + dot3([world.m[0], world.m[1], world.m[2]], wv), world.oy + dot3([world.m[3], world.m[4], world.m[5]], wv), dot3(world.V, wv)]); }",
  "          for (let i = 0; i + 2 < tri.length; i += 3) { const [A, B, Cc] = [tri[i], tri[i + 1], tri[i + 2]]; const den = (B[1] - Cc[1]) * (A[0] - Cc[0]) + (Cc[0] - B[0]) * (A[1] - Cc[1]); if (Math.abs(den) < 1e-12) continue; const l1 = ((B[1] - Cc[1]) * (cx - Cc[0]) + (Cc[0] - B[0]) * (cy - Cc[1])) / den, l2 = ((Cc[1] - A[1]) * (cx - Cc[0]) + (A[0] - Cc[0]) * (cy - Cc[1])) / den, l3 = 1 - l1 - l2;",
  "            if (l1 >= 0 && l2 >= 0 && l3 >= 0) { best = 0; if (l1 * A[2] + l2 * B[2] + l3 * Cc[2] > dq) front = true; continue; }",
  "            const seg = (P, Q) => { const dx = Q[0] - P[0], dy = Q[1] - P[1]; const u = Math.max(0, Math.min(1, ((cx - P[0]) * dx + (cy - P[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(P[0] + u * dx - cx, P[1] + u * dy - cy); };",
  "            best = Math.min(best, seg(A, B), seg(B, Cc), seg(Cc, A)); }",
  "          gap.push(front ? `${name} covered` : `${name} ${best.toFixed(3)} px = ${(best / world.k * 100).toFixed(1)} mm`); } }",
  // how wide the hole is: the share of the pixel (21 x 21 samples) that no neighbour covers nearer than the gear
  "      let open = 0, all = 0; if (out.length < 40) { const dq = dot3(world.V, q); const tris = []; for (const name of nb) { const pp = parts.find((r) => r.name === name); const cm = pp.group >= 0 ? cams[pp.group] : null; const R = cm ? cm.R : [1, 0, 0, 0, 1, 0, 0, 0, 1], t = cm ? cm.t : [0, 0, 0]; for (const sh of V.parts[pp.index].shapes) for (const v of meshOf(sh)) { const wv = [R[0] * v[0] + R[1] * v[1] + R[2] * v[2] + t[0], R[3] * v[0] + R[4] * v[1] + R[5] * v[2] + t[1], R[6] * v[0] + R[7] * v[1] + R[8] * v[2] + t[2]]; tris.push([world.ox + dot3([world.m[0], world.m[1], world.m[2]], wv), world.oy + dot3([world.m[3], world.m[4], world.m[5]], wv), dot3(world.V, wv)]); } }",
  "        for (let sy = 0; sy <= 20; sy++) for (let sx = 0; sx <= 20; sx++) { const px2 = x + sx / 20, py2 = y + sy / 20; all++; let hit = false; for (let i = 0; i + 2 < tris.length && !hit; i += 3) { const [A, B, Cc] = [tris[i], tris[i + 1], tris[i + 2]]; const den = (B[1] - Cc[1]) * (A[0] - Cc[0]) + (Cc[0] - B[0]) * (A[1] - Cc[1]); if (Math.abs(den) < 1e-12) continue; const l1 = ((B[1] - Cc[1]) * (px2 - Cc[0]) + (Cc[0] - B[0]) * (py2 - Cc[1])) / den, l2 = ((Cc[1] - A[1]) * (px2 - Cc[0]) + (A[0] - Cc[0]) * (py2 - Cc[1])) / den, l3 = 1 - l1 - l2; if (l1 >= 0 && l2 >= 0 && l3 >= 0 && l1 * A[2] + l2 * B[2] + l3 * Cc[2] > dq - 0.05) hit = true; } if (!hit) open++; } }",
  "      if (all) gap.push(`open ${open} of ${all} samples of the pixel`);",
  "      const gapText = gap.length ? (gap.some((g) => g.endsWith(\"covered\")) ? \"crack: \" : \"hole: \") + gap.join(\", \") : \"\";",
  "      const key = `${flap}|${part.name}`;",
  "      tally[key] = (tally[key] ?? 0) + 1;",
  "      const tk = `${flap}|${turn}|${pitch}`;",
  "      turns[tk] = (turns[tk] ?? 0) + 1;",
  "      if (out.length < 40 && (out.length === 0 || out[out.length - 1][2] !== part.name)) out.push([flap, pitch, turn, part.name, +(41.3 - a[0] / 10).toFixed(3), +(a[1] / 10).toFixed(3), +(a[2] / 10).toFixed(3), [...nb].join(\" \"), gapText]);",
  "    }",
  "  }",
  "  return JSON.stringify({ tot, tally, turns, out, glAbout });",
  "} catch (e) { return \"ERR \" + e.message + \" \" + (e.stack || \"\").slice(0, 300); } })()"
].join("\n");
// --control: the same renders with the gear down (gear 1): the test must see the gear and fail
const CONTROL = args.includes("--control");
const TEST = CONTROL ? TEST0.replace("gear: 0, gearBody: 0,", "gear: 1, gearBody: 1,") : TEST0;
if (CONTROL && TEST === TEST0) throw new Error("stowvis: the control could not set the gear down");
const dir = mkdtempSync(join(tmpdir(), "stowvis-"));
const actions = join(dir, "actions.json");
writeFileSync(actions, JSON.stringify([["until", "window.__a380 && window.__a380.controller && window.__isoVerify", 240000], ["wait", 1500], ["key", " "], ["wait", 500], ["eval", "(__a380.glInfo && __a380.glInfo.renderer) || 'no glInfo'"], ["eval", TEST]]));
const run = spawnSync(process.execPath, [join(HERE, "../../scripts/drive.mjs"), resolve(page), "--actions", actions, "--width", "1440"], { encoding: "utf8", maxBuffer: 1 << 26, timeout: 1800000 });
const lines = (run.stdout || "").split("\n").filter((l) => l.startsWith("eval:"));
if (lines.length < 2) {
  console.log(run.stdout, run.stderr);
  console.log("stowvis: the page did not answer");
  process.exit(1);
}
console.log(`page renderer: ${JSON.parse(lines[0].slice(5))}`);
const raw = JSON.parse(lines[1].slice(5));
if (typeof raw !== "string" || raw.startsWith("ERR")) {
  console.log("stowvis:", raw);
  process.exit(1);
}
const r = JSON.parse(raw);
// (fu/f3-verify) the renderer that drew the test's z-buffers (its own WebGL context, not the page's glInfo, which a verify
// page lacks): a count is only comparable between runs on the same renderer and depth buffer
const g = r.glAbout ?? {};
console.log(`test renderer: ${g.renderer} (${g.vendor}; ${g.version}; depth ${g.depthBits} bits, antialias ${g.antialias}; ${g.ua})${/swiftshader/i.test(g.renderer ?? "") ? " · SwiftShader (software)" : ""}`);
console.log(`stowed gear: ${r.tot} px visible over 432 renders (72 turns × pitch 3, 9, 12.5 × flaps 0, 1+F)`);
for (const [k, v] of Object.entries(r.tally)) console.log(`  part ${k.replace("|", " flaps ")}: ${v} px`);
for (const [k, v] of Object.entries(r.turns)) console.log(`  state flaps|turn|pitch ${k}: ${v} px`);
for (const o of r.out) console.log(`  ${JSON.stringify(o)}`);
console.log(CONTROL ? (r.tot > MAX ? `stowvis control fails as it should (${r.tot} px with the gear down)` : `stowvis control did NOT fail: the test sees no gear`) : r.tot <= MAX ? `stowvis passed (at most ${MAX} px)` : `stowvis failed: ${r.tot} px, more than ${MAX}`);
process.exit(r.tot <= MAX ? 0 : 1);
