// a380 follow-up f3 (track "painter"): a WebGL2 painter for the turn runtime's canvas layers.
//
// The canvas painter (kit/canvas-painter.mjs) keeps every decision it makes (what to draw, in which order, with which
// colour, alpha, width, join, cap, dash and transform); this file only replaces the 2D context it draws into. GpContext
// is a CanvasRenderingContext2D look-alike that flattens and tessellates each fill and stroke on the main thread into
// one vertex batch and draws it with one or a few WebGL draw calls a frame, multisampled. Each fill or stroke call is
// one compositing step: it gets its own depth, so its own triangles never blend twice where they overlap (a canvas
// fill or stroke covers a pixel once) while every later call still draws over it (painter's order).
//
// The mount (GLPAINT.mount / mountAsync) is the canvas painter's own mount with this context (its `context` option),
// behind a proxy that falls back to the canvas painter when WebGL2 is missing or the context is lost. No imports: the
// page inlines kit/turn-fixed.mjs, kit/canvas-painter.mjs and this file into one script (scripts/inline-kit.mjs), and
// this file calls the canvas painter's cpMountWith, cpMountAsync and cpPathCommands by name.

const GP_TOL = 0.2; // flattening tolerance in device px
const GP_TOL_PEN = 0.3; // a round join's or cap's arc (inside the stroke's own anti-aliasing)
const GP_THIN = 1; // device px: a stroke thinner than this is drawn this wide at less alpha (as Skia draws a thin one)
// unit circles of n segments (a dot is a full circle: thousands a frame)
const gpCircles = [];
function gpCircle(n) {
  let t = gpCircles[n];
  if (!t) {
    t = new Float64Array(2 * (n + 1));
    for (let i = 0; i <= n; i++) {
      t[2 * i] = Math.cos((2 * Math.PI * i) / n);
      t[2 * i + 1] = Math.sin((2 * Math.PI * i) / n);
    }
    t[2 * n] = 1;
    t[2 * n + 1] = 0;
    gpCircles[n] = t;
  }
  return t;
}
const GP_DEPTH = 1 / 524288; // one depth step a call (2^-19 of NDC: 16 steps of a 24-bit depth buffer)

const GP_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec4 aCol;
uniform vec2 uSize;
out vec4 vCol;
void main() {
  vCol = aCol;
  gl_Position = vec4(aPos.x * 2.0 / uSize.x - 1.0, 1.0 - aPos.y * 2.0 / uSize.y, aPos.z, 1.0);
}`;
const GP_FS = `#version 300 es
precision mediump float;
in vec4 vCol;
out vec4 o;
void main() { o = vec4(vCol.rgb * vCol.a, vCol.a); }`;
// text and images: a textured quad (premultiplied texels), alpha from the vertex colour
const GP_TVS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUv;
uniform vec2 uSize;
out vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos.x * 2.0 / uSize.x - 1.0, 1.0 - aPos.y * 2.0 / uSize.y, aPos.z, 1.0);
}`;
const GP_TFS = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uAlpha;
out vec4 o;
void main() { o = texture(uTex, vUv) * uAlpha; }`;

const gpColours = new Map();
let gpProbe = null;
// a CSS colour as a packed RGBA8 (r in the low byte); alpha multiplied later
function gpColour(css) {
  let v = gpColours.get(css);
  if (v !== undefined) return v;
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 1;
  if (typeof css === "string" && css.length === 7 && css.charCodeAt(0) === 35) {
    const n = parseInt(css.slice(1), 16);
    r = n >> 16;
    g = (n >> 8) & 255;
    b = n & 255;
  } else if (typeof css === "string") {
    gpProbe ??= document.createElement("canvas").getContext("2d");
    gpProbe.fillStyle = "#000";
    gpProbe.fillStyle = css;
    const out = String(gpProbe.fillStyle);
    if (out[0] === "#") {
      const n = parseInt(out.slice(1, 7), 16);
      r = n >> 16;
      g = (n >> 8) & 255;
      b = n & 255;
    } else {
      const nums = out.match(/-?[\d.]+(e-?\d+)?/g) ?? [];
      const k = out.startsWith("color(") ? 255 : 1;
      r = Math.round(Number(nums[0] ?? 0) * k);
      g = Math.round(Number(nums[1] ?? 0) * k);
      b = Math.round(Number(nums[2] ?? 0) * k);
      a = nums.length > 3 ? Number(nums[3]) : 1;
    }
  } else a = 0; // a gradient or pattern object: not drawn by this painter (none in the op stream; see notes)
  v = { rgb: (r & 255) | ((g & 255) << 8) | ((b & 255) << 16), a };
  gpColours.set(css, v);
  return v;
}

// merge f4: a centred radial gradient (r0 0): its stops, drawn by GpContext.fillRadial as rings of the stops' mean
class GpRadial {
  constructor(x, y, r) {
    this.x = x;
    this.y = y;
    this.r = r;
    this.stops = [];
  }
  addColorStop(o, c) {
    this.stops.push([o, c]);
  }
}

// a Path2D that also keeps its commands (the canvas painter builds Path2D objects for static elements and string
// paths; a native one cannot be read back). It is a true Path2D, so any 2D context draws it as before.
let GpPath2D = null;
function gpPathClass() {
  if (GpPath2D || typeof Path2D !== "function") return GpPath2D;
  const Native = Path2D;
  GpPath2D = class extends Native {
    constructor(arg) {
      super(arg);
      this.gp = typeof arg === "string" ? [["S", arg]] : arg && arg.gp ? arg.gp.slice() : [];
    }
    moveTo(x, y) {
      super.moveTo(x, y);
      this.gp.push(["M", x, y]);
    }
    lineTo(x, y) {
      super.lineTo(x, y);
      this.gp.push(["L", x, y]);
    }
    closePath() {
      super.closePath();
      this.gp.push(["Z"]);
    }
    bezierCurveTo(a, b, c, d, e, f) {
      super.bezierCurveTo(a, b, c, d, e, f);
      this.gp.push(["C", a, b, c, d, e, f]);
    }
    quadraticCurveTo(a, b, c, d) {
      super.quadraticCurveTo(a, b, c, d);
      this.gp.push(["Q", a, b, c, d]);
    }
    arc(x, y, r, a0, a1, ccw = false) {
      super.arc(x, y, r, a0, a1, ccw);
      this.gp.push(["E", x, y, r, r, 0, a0, a1, ccw ? 1 : 0]);
    }
    ellipse(x, y, rx, ry, rot, a0, a1, ccw = false) {
      super.ellipse(x, y, rx, ry, rot, a0, a1, ccw);
      this.gp.push(["E", x, y, rx, ry, rot, a0, a1, ccw ? 1 : 0]);
    }
    rect(x, y, w, h) {
      super.rect(x, y, w, h);
      this.gp.push(["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"], ["M", x, y]);
    }
    roundRect(x, y, w, h, r) {
      super.roundRect(x, y, w, h, r);
      this.gp.push(["R", x, y, w, h, typeof r === "number" ? r : Array.isArray(r) ? Number(r[0]) || 0 : 0]);
    }
    addPath(p, m) {
      super.addPath(p, m);
      this.gp.push(["A", p, m ? [m.a, m.b, m.c, m.d, m.e, m.f] : null]);
    }
  };
  return GpPath2D;
}

// a growable float/int list
function gpF(n) {
  return new Float64Array(n);
}

class GpContext {
  constructor(canvas, { samples = 4, onLost = null } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: "high-performance" });
    this.gl = gl;
    if (!gl) return;
    this.lost = false;
    this.onLost = onLost;
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
      if (onLost) onLost();
    });
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const program = (vs, fs) => {
      const p = gl.createProgram();
      gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("gl painter: " + gl.getProgramInfoLog(p));
      return p;
    };
    this.prog = program(GP_VS, GP_FS);
    this.uSize = gl.getUniformLocation(this.prog, "uSize");
    this.tprog = null;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, 16, 12);
    gl.bindVertexArray(null);
    this.samples = Math.max(0, Math.min(samples, gl.getParameter(gl.MAX_SAMPLES) | 0));
    this.fbo = null;
    this.fbW = 0;
    this.fbH = 0;
    // the batch: 16 bytes a vertex (x, y, z float; RGBA8)
    this.vbuf = new ArrayBuffer(16 * 65536);
    this.vf = new Float32Array(this.vbuf);
    this.vu = new Uint32Array(this.vbuf);
    this.nv = 0;
    this.ib = new Uint32Array(3 * 65536);
    this.ni = 0;
    // the current path, in device px: points and subpaths (start, end, closed)
    this.px = gpF(4096);
    this.py = gpF(4096);
    this.np = 0;
    this.ss = new Int32Array(1024);
    this.se = new Int32Array(1024);
    this.sc = new Uint8Array(1024);
    this.ns = 0;
    this.open = false; // a subpath is open
    this.reset();
    this.stats = { fills: 0, convex: 0, ears: 0, union: 0, stencil: 0, strokes: 0, thin: 0, text: 0, draws: 0, verts: 0, unsupported: new Set() };
  }
  reset() {
    this.a = 1;
    this.b = 0;
    this.c = 0;
    this.d = 1;
    this.e = 0;
    this.f = 0;
    this.fillStyle = "#000000";
    this.strokeStyle = "#000000";
    this.globalAlpha = 1;
    this.lineWidth = 1;
    this.lineCap = "butt";
    this.lineJoin = "miter";
    this.miterLimit = 10;
    this.dash = null;
    this.lineDashOffset = 0;
    this.font = "10px sans-serif";
    this.textAlign = "start";
    this.textBaseline = "alphabetic";
    this.letterSpacing = "0px";
    this.globalCompositeOperation = "source-over";
    this.blendMode = "source-over"; // the batch's composite mode (a change flushes)
    this.imageSmoothingEnabled = true;
    this.stack = [];
    this.scissor = null;
    this.depth = 1 - GP_DEPTH;
    this.cleared = false;
    this.pending = false;
  }
  // ---- state
  setTransform(a, b, c, d, e, f) {
    if (typeof a === "object" && a) ({ a, b, c, d, e, f } = a);
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
  }
  resetTransform() {
    this.setTransform(1, 0, 0, 1, 0, 0);
  }
  transform(a, b, c, d, e, f) {
    const A = this;
    this.setTransform(A.a * a + A.c * b, A.b * a + A.d * b, A.a * c + A.c * d, A.b * c + A.d * d, A.a * e + A.c * f + A.e, A.b * e + A.d * f + A.f);
  }
  translate(x, y) {
    this.transform(1, 0, 0, 1, x, y);
  }
  scale(x, y) {
    this.transform(x, 0, 0, y, 0, 0);
  }
  rotate(t) {
    const c = Math.cos(t);
    const s = Math.sin(t);
    this.transform(c, s, -s, c, 0, 0);
  }
  getTransform() {
    return new DOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]);
  }
  setLineDash(list) {
    this.dash = list && list.length ? (list.length % 2 ? list.concat(list) : list.slice()) : null;
  }
  getLineDash() {
    return this.dash ? this.dash.slice() : [];
  }
  save() {
    this.stack.push([this.a, this.b, this.c, this.d, this.e, this.f, this.fillStyle, this.strokeStyle, this.globalAlpha, this.lineWidth, this.lineCap, this.lineJoin, this.miterLimit, this.dash, this.lineDashOffset, this.font, this.textAlign, this.textBaseline, this.letterSpacing, this.scissor, this.globalCompositeOperation]);
  }
  restore() {
    const s = this.stack.pop();
    if (!s) return;
    [this.a, this.b, this.c, this.d, this.e, this.f, this.fillStyle, this.strokeStyle, this.globalAlpha, this.lineWidth, this.lineCap, this.lineJoin, this.miterLimit, this.dash, this.lineDashOffset, this.font, this.textAlign, this.textBaseline, this.letterSpacing] = s;
    this.globalCompositeOperation = s[20];
    if (s[19] !== this.scissor) {
      this.flush();
      this.scissor = s[19];
    }
  }
  // ---- path building (points in device px under the current transform)
  beginPath() {
    this.np = 0;
    this.ns = 0;
    this.open = false;
    this.reopen = false;
  }
  growPts(n) {
    if (this.np + n <= this.px.length) return;
    const size = Math.max(2 * this.px.length, this.np + n);
    const x = gpF(size);
    const y = gpF(size);
    x.set(this.px.subarray(0, this.np));
    y.set(this.py.subarray(0, this.np));
    this.px = x;
    this.py = y;
  }
  newSub(x, y) {
    if (this.ns === this.ss.length) {
      const n = 2 * this.ss.length;
      const ss = new Int32Array(n);
      const se = new Int32Array(n);
      const sc = new Uint8Array(n);
      ss.set(this.ss);
      se.set(this.se);
      sc.set(this.sc);
      this.ss = ss;
      this.se = se;
      this.sc = sc;
    }
    this.growPts(1);
    this.px[this.np] = x;
    this.py[this.np] = y;
    this.ss[this.ns] = this.np;
    this.np++;
    this.se[this.ns] = this.np;
    this.sc[this.ns] = 0;
    this.ns++;
    this.open = true;
  }
  addPt(x, y) {
    if (!this.open) {
      if (this.reopen && this.ns) {
        // after closePath the next segment starts from the closed subpath's first point
        this.reopen = false;
        this.newSub(this.lastX, this.lastY);
      } else {
        this.newSub(x, y);
        return;
      }
    }
    if (this.np === this.px.length) this.growPts(1);
    this.px[this.np] = x;
    this.py[this.np] = y;
    this.np++;
    this.se[this.ns - 1] = this.np;
  }
  moveTo(x, y) {
    this.reopen = false;
    this.newSub(this.a * x + this.c * y + this.e, this.b * x + this.d * y + this.f);
  }
  lineTo(x, y) {
    this.addPt(this.a * x + this.c * y + this.e, this.b * x + this.d * y + this.f);
  }
  closePath() {
    if (!this.open || this.ns === 0) return;
    const k = this.ns - 1;
    this.sc[k] = 1;
    // the next segment starts from the subpath's first point
    const s = this.ss[k];
    this.open = false;
    this.lastX = this.px[s];
    this.lastY = this.py[s];
    this.reopen = true;
  }
  // the current point in device px (for curves)
  cur() {
    if (this.open) return [this.px[this.np - 1], this.py[this.np - 1]];
    if (this.reopen && this.ns) {
      this.newSub(this.lastX, this.lastY);
      this.reopen = false;
      return [this.lastX, this.lastY];
    }
    return null;
  }
  scaleOf() {
    return Math.sqrt(Math.abs(this.a * this.d - this.b * this.c)) || 1e-9;
  }
  quadraticCurveTo(x1, y1, x, y) {
    let p = this.cur();
    if (!p) {
      this.moveTo(x1, y1);
      p = this.cur();
    }
    const ax = this.a * x1 + this.c * y1 + this.e;
    const ay = this.b * x1 + this.d * y1 + this.f;
    const bx = this.a * x + this.c * y + this.e;
    const by = this.b * x + this.d * y + this.f;
    const ddx = p[0] - 2 * ax + bx;
    const ddy = p[1] - 2 * ay + by;
    const n = Math.max(1, Math.min(100, Math.ceil(Math.sqrt(Math.sqrt(ddx * ddx + ddy * ddy) / (4 * GP_TOL)))));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      this.addPt(u * u * p[0] + 2 * u * t * ax + t * t * bx, u * u * p[1] + 2 * u * t * ay + t * t * by);
    }
  }
  bezierCurveTo(x1, y1, x2, y2, x, y) {
    let p = this.cur();
    if (!p) {
      this.moveTo(x1, y1);
      p = this.cur();
    }
    const T = (u, v) => [this.a * u + this.c * v + this.e, this.b * u + this.d * v + this.f];
    const [ax, ay] = T(x1, y1);
    const [bx, by] = T(x2, y2);
    const [cx, cy] = T(x, y);
    const d1 = Math.hypot(p[0] - 2 * ax + bx, p[1] - 2 * ay + by);
    const d2 = Math.hypot(ax - 2 * bx + cx, ay - 2 * by + cy);
    const n = Math.max(1, Math.min(200, Math.ceil(Math.sqrt((0.75 * Math.max(d1, d2)) / GP_TOL))));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      const w0 = u * u * u;
      const w1 = 3 * u * u * t;
      const w2 = 3 * u * t * t;
      const w3 = t * t * t;
      this.addPt(w0 * p[0] + w1 * ax + w2 * bx + w3 * cx, w0 * p[1] + w1 * ay + w2 * by + w3 * cy);
    }
  }
  arc(x, y, r, a0, a1, ccw = false) {
    this.ellipse(x, y, r, r, 0, a0, a1, ccw);
  }
  ellipse(x, y, rx, ry, rot, a0, a1, ccw = false) {
    // the sweep as the canvas normalises it
    const TAU = Math.PI * 2;
    let sweep = a1 - a0;
    if (!ccw) {
      if (sweep >= TAU) sweep = TAU;
      else if (sweep < 0) sweep = (sweep % TAU) + TAU;
      if (sweep === TAU && a1 - a0 < TAU && a1 - a0 >= 0) sweep = a1 - a0;
    } else {
      if (-sweep >= TAU) sweep = -TAU;
      else if (sweep > 0) sweep = (sweep % TAU) - TAU;
    }
    if (a1 - a0 === 0) sweep = 0;
    const rd = Math.max(rx, ry) * this.scaleOf();
    const step = rd > GP_TOL ? 2 * Math.acos(Math.max(-1, 1 - GP_TOL / rd)) : Math.PI / 2;
    const n = Math.max(1, Math.min(512, Math.ceil(Math.abs(sweep) / step)));
    if (rot === 0 && a0 === 0 && (sweep === 2 * Math.PI || sweep === -2 * Math.PI) && n >= 3 && !this.open && !(this.reopen && this.ns)) {
      // a full circle (a dot) from a cached unit circle
      const t = gpCircle(n);
      const sg = sweep > 0 ? 1 : -1;
      const { a, b, c, d, e, f } = this;
      for (let i = 0; i <= n; i++) {
        const ux = x + rx * t[2 * i];
        const uy = y + sg * ry * t[2 * i + 1];
        const dx = a * ux + c * uy + e;
        const dy = b * ux + d * uy + f;
        if (i === 0) this.newSub(dx, dy);
        else this.addPt(dx, dy);
      }
      return;
    }
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    for (let i = 0; i <= n; i++) {
      const t = a0 + (sweep * i) / n;
      const ex = rx * Math.cos(t);
      const ey = ry * Math.sin(t);
      const ux = x + ex * cr - ey * sr;
      const uy = y + ex * sr + ey * cr;
      const dx = this.a * ux + this.c * uy + this.e;
      const dy = this.b * ux + this.d * uy + this.f;
      if (i === 0) {
        if (this.open || (this.reopen && this.ns)) {
          this.cur();
          this.addPt(dx, dy);
        } else this.newSub(dx, dy);
      } else this.addPt(dx, dy);
    }
  }
  rect(x, y, w, h) {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
    this.moveTo(x, y);
  }
  roundRect(x, y, w, h, r = 0) {
    r = Math.min(Math.abs(typeof r === "number" ? r : Array.isArray(r) ? Number(r[0]) || 0 : 0), Math.abs(w) / 2, Math.abs(h) / 2);
    if (!r) return this.rect(x, y, w, h);
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.arcCorner(x + w - r, y + r, r, -Math.PI / 2, 0);
    this.lineTo(x + w, y + h - r);
    this.arcCorner(x + w - r, y + h - r, r, 0, Math.PI / 2);
    this.lineTo(x + r, y + h);
    this.arcCorner(x + r, y + h - r, r, Math.PI / 2, Math.PI);
    this.lineTo(x, y + r);
    this.arcCorner(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    this.closePath();
  }
  arcCorner(cx, cy, r, a0, a1) {
    this.ellipse(cx, cy, r, r, 0, a0, a1, false);
  }
  // a recorded Path2D replayed into the current path under the current transform (then the current path is the
  // path's, as fill(path) and stroke(path) need)
  replay(path, M = null) {
    const list = path.gp;
    if (!list) {
      this.stats.unsupported.add("native Path2D");
      return;
    }
    let saved = null;
    if (M) {
      saved = [this.a, this.b, this.c, this.d, this.e, this.f];
      this.transform(M[0], M[1], M[2], M[3], M[4], M[5]);
    }
    for (const c of list) {
      const k = c[0];
      if (k === "M") this.moveTo(c[1], c[2]);
      else if (k === "L") this.lineTo(c[1], c[2]);
      else if (k === "Z") this.closePath();
      else if (k === "C") this.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
      else if (k === "Q") this.quadraticCurveTo(c[1], c[2], c[3], c[4]);
      else if (k === "E") this.ellipse(c[1], c[2], c[3], c[4], c[5], c[6], c[7], c[8] === 1);
      else if (k === "R") this.roundRect(c[1], c[2], c[3], c[4], c[5]);
      else if (k === "A") this.replay(c[1], c[2]);
      else if (k === "S") {
        const cmds = c.cmds ?? (c.cmds = cpPathCommands(c[1]) ?? []);
        if (!cmds.length && c[1].trim()) this.stats.unsupported.add("path " + c[1].slice(0, 24));
        for (const q of cmds) {
          const t = q[0];
          if (t === "M") this.moveTo(q[1], q[2]);
          else if (t === "L") this.lineTo(q[1], q[2]);
          else if (t === "C") this.bezierCurveTo(q[1], q[2], q[3], q[4], q[5], q[6]);
          else if (t === "Q") this.quadraticCurveTo(q[1], q[2], q[3], q[4]);
          else if (t === "E") this.ellipse(q[1], q[2], q[3], q[4], q[5], q[6], q[7], q[8] === 1);
          else this.closePath();
        }
      }
    }
    if (saved) [this.a, this.b, this.c, this.d, this.e, this.f] = saved;
  }
  // the call's drawing (kind 0 a fill, 1 a stroke) on `path` or, without one, the current path
  withPath(path, kind, col, evenodd) {
    if (!path) return kind === 0 ? this.fillPath(col, evenodd) : this.strokePath(col);
    // the current path is kept (a canvas fill(path) leaves it alone): the path is replayed into a second set of
    // buffers, swapped in for the draw (no allocation: the two sets trade places and back)
    const kpx = this.px;
    const kpy = this.py;
    const knp = this.np;
    const kss = this.ss;
    const kse = this.se;
    const ksc = this.sc;
    const kns = this.ns;
    const kopen = this.open;
    const kre = this.reopen;
    const klx = this.lastX;
    const kly = this.lastY;
    if (!this.apx) {
      this.apx = gpF(1024);
      this.apy = gpF(1024);
      this.ass = new Int32Array(64);
      this.ase = new Int32Array(64);
      this.asc = new Uint8Array(64);
    }
    this.px = this.apx;
    this.py = this.apy;
    this.ss = this.ass;
    this.se = this.ase;
    this.sc = this.asc;
    this.beginPath();
    this.replay(path);
    if (kind === 0) this.fillPath(col, evenodd);
    else this.strokePath(col);
    // (the buffers may have grown)
    this.apx = this.px;
    this.apy = this.py;
    this.ass = this.ss;
    this.ase = this.se;
    this.asc = this.sc;
    this.px = kpx;
    this.py = kpy;
    this.np = knp;
    this.ss = kss;
    this.se = kse;
    this.sc = ksc;
    this.ns = kns;
    this.open = kopen;
    this.reopen = kre;
    this.lastX = klx;
    this.lastY = kly;
  }
  // ---- the batch
  vert(x, y, z, col) {
    if (this.nv * 4 + 4 > this.vf.length) {
      const buf = new ArrayBuffer(this.vbuf.byteLength * 2);
      new Uint8Array(buf).set(new Uint8Array(this.vbuf));
      this.vbuf = buf;
      this.vf = new Float32Array(buf);
      this.vu = new Uint32Array(buf);
    }
    const i = this.nv * 4;
    this.vf[i] = x;
    this.vf[i + 1] = y;
    this.vf[i + 2] = z;
    this.vu[i + 3] = col;
    return this.nv++;
  }
  tri(i, j, k) {
    if (this.ni + 3 > this.ib.length) {
      const ib = new Uint32Array(this.ib.length * 2);
      ib.set(this.ib);
      this.ib = ib;
    }
    this.ib[this.ni++] = i;
    this.ib[this.ni++] = j;
    this.ib[this.ni++] = k;
  }
  colourOf(style, extra = 1) {
    const c = gpColour(style);
    const a = Math.max(0, Math.min(1, c.a * this.globalAlpha * extra));
    return (c.rgb | (Math.round(a * 255) << 24)) >>> 0;
  }
  nextDepth() {
    const z = this.depth;
    this.depth -= GP_DEPTH;
    if (this.depth < -0.999) {
      // (half a million calls since the last clear: never in a frame of this figure) start again over a fresh depth
      this.flush();
      this.clearDepth();
    }
    return z;
  }
  // the composite mode of the call about to be added: a change draws the batch so far first. source-over, screen
  // (fu/f3-lights' glows) and lighter; any other is listed unsupported and drawn source-over
  mode() {
    const want = this.globalCompositeOperation;
    if (want === this.blendMode) return;
    this.flush();
    this.stats.modes = (this.stats.modes ?? 0) + 1;
    if (want === "source-over" || want === "screen" || want === "lighter") this.blendMode = want;
    else {
      this.stats.unsupported.add("composite " + want);
      this.blendMode = "source-over";
    }
  }
  blendNow() {
    const gl = this.gl;
    if (this.blendMode === "screen") gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    else if (this.blendMode === "lighter") gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  // ---- fills
  fill(a, b) {
    let path = null;
    let rule = "nonzero";
    if (typeof a === "string") rule = a;
    else if (a) {
      path = a;
      if (typeof b === "string") rule = b;
    }
    this.begin();
    if (this.fillStyle instanceof GpRadial) {
      if (this.globalCompositeOperation !== this.blendMode) this.mode();
      return this.fillRadial(this.fillStyle);
    }
    const col = this.colourOf(this.fillStyle);
    if (col >>> 24 === 0) return;
    if (this.globalCompositeOperation !== this.blendMode) this.mode();
    this.stats.fills++;
    this.withPath(path, 0, col, rule === "evenodd");
  }
  fillPath(col, evenodd) {
    const z = this.nextDepth();
    const { px, py, ss, se, ns } = this;
    // the subpaths' orientation: all one sense (nonzero) is their union (the depth test draws each pixel once)
    let sense = 0;
    let mixed = false;
    let live = 0;
    for (let s = 0; s < ns; s++) {
      const n = se[s] - ss[s];
      if (n < 3) continue;
      let area = 0;
      const o = ss[s];
      for (let k = 0; k < n; k++) {
        const j = k + 1 === n ? 0 : k + 1;
        area += px[o + k] * py[o + j] - px[o + j] * py[o + k];
      }
      if (Math.abs(area) < 1e-9) continue;
      live++;
      const sg = area > 0 ? 1 : -1;
      if (sense === 0) sense = sg;
      else if (sg !== sense) mixed = true;
    }
    if (live === 0) return;
    if (mixed || (evenodd && live > 1)) {
      this.stencilFill(col, z, evenodd);
      return;
    }
    if (live > 1) this.stats.union++;
    for (let s = 0; s < ns; s++) {
      const n = se[s] - ss[s];
      if (n < 3) continue;
      if (!this.fillSub(ss[s], n, col, z)) {
        // not simple: the whole call through the stencil (its triangles so far are harmless under it)
        this.stencilFill(col, z, evenodd);
        return;
      }
    }
  }
  // one subpath: convex as a fan, else ear-clipped; false when neither works (self-intersecting)
  fillSub(o, n, col, z) {
    const { px, py } = this;
    // drop repeated points and a closing duplicate
    let m = 0;
    const idx = this.idx && this.idx.length >= n ? this.idx : (this.idx = new Int32Array(Math.max(n, 256)));
    for (let k = 0; k < n; k++) {
      const x = px[o + k];
      const y = py[o + k];
      if (m > 0 && Math.abs(x - px[idx[m - 1]]) < 1e-7 && Math.abs(y - py[idx[m - 1]]) < 1e-7) continue;
      idx[m++] = o + k;
    }
    while (m > 1 && Math.abs(px[idx[m - 1]] - px[idx[0]]) < 1e-7 && Math.abs(py[idx[m - 1]] - py[idx[0]]) < 1e-7) m--;
    if (m < 3) return true;
    // convex: every turn one way, and the direction's x and y each change sign at most twice
    let sign = 0;
    let convex = true;
    let fx = 0;
    let fy = 0;
    let lx = 0;
    let ly = 0;
    let cx = 0;
    let cy = 0;
    for (let k = 0; k < m && convex; k++) {
      const i0 = idx[k];
      const i1 = idx[k + 1 === m ? 0 : k + 1];
      const i2 = idx[k + 2 >= m ? k + 2 - m : k + 2];
      const dx = px[i1] - px[i0];
      const dy = py[i1] - py[i0];
      const ex = px[i2] - px[i1];
      const ey = py[i2] - py[i1];
      const cr = dx * ey - dy * ex;
      if (cr > 1e-9) {
        if (sign < 0) convex = false;
        sign = 1;
      } else if (cr < -1e-9) {
        if (sign > 0) convex = false;
        sign = -1;
      }
      const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
      const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
      if (sx) {
        if (!fx) fx = sx;
        else if (lx && sx !== lx) cx++;
        lx = sx;
      }
      if (sy) {
        if (!fy) fy = sy;
        else if (ly && sy !== ly) cy++;
        ly = sy;
      }
    }
    if (convex) {
      if (lx && fx && lx !== fx) cx++;
      if (ly && fy && ly !== fy) cy++;
      if (cx > 2 || cy > 2) convex = false;
    }
    this.room(m, 3 * m);
    const base = this.nv;
    {
      const vf = this.vf;
      const vu = this.vu;
      let i = base * 4;
      for (let k = 0; k < m; k++, i += 4) {
        vf[i] = px[idx[k]];
        vf[i + 1] = py[idx[k]];
        vf[i + 2] = z;
        vu[i + 3] = col;
      }
      this.nv = base + m;
    }
    if (convex) {
      this.stats.convex++;
      const ib = this.ib;
      let n = this.ni;
      for (let k = 1; k + 1 < m; k++) {
        ib[n] = base;
        ib[n + 1] = base + k;
        ib[n + 2] = base + k + 1;
        n += 3;
      }
      this.ni = n;
      return true;
    }
    this.stats.ears++;
    return this.earClip(idx, m, base);
  }
  earClip(idx, m, base) {
    const { px, py } = this;
    let area = 0;
    for (let k = 0; k < m; k++) {
      const j = k + 1 === m ? 0 : k + 1;
      area += px[idx[k]] * py[idx[j]] - px[idx[j]] * py[idx[k]];
    }
    const s = area > 0 ? 1 : -1;
    if (!this.enext || this.enext.length < m) {
      this.enext = new Int32Array(Math.max(256, 2 * m));
      this.eprev = new Int32Array(Math.max(256, 2 * m));
    }
    const next = this.enext;
    const prev = this.eprev;
    for (let k = 0; k < m; k++) {
      next[k] = k + 1 === m ? 0 : k + 1;
      prev[k] = k === 0 ? m - 1 : k - 1;
    }
    // the polygon's points in order (no closures in the clipping loop)
    if (!this.ex || this.ex.length < m) {
      this.ex = new Float64Array(Math.max(256, 2 * m));
      this.ey = new Float64Array(Math.max(256, 2 * m));
    }
    const EX = this.ex;
    const EY = this.ey;
    for (let k = 0; k < m; k++) {
      EX[k] = px[idx[k]];
      EY[k] = py[idx[k]];
    }
    let left = m;
    let k = 0;
    let guard = 0;
    const ni0 = this.ni;
    while (left > 3) {
      const p = prev[k];
      const q = next[k];
      let ear = ((EX[k] - EX[p]) * (EY[q] - EY[k]) - (EY[k] - EY[p]) * (EX[q] - EX[k])) * s > 1e-12;
      if (ear) {
        // no other vertex inside (or on) the triangle
        const ax = EX[p];
        const ay = EY[p];
        const bx = EX[k];
        const by = EY[k];
        const cx = EX[q];
        const cy = EY[q];
        for (let r = next[q]; r !== p; r = next[r]) {
          const x = EX[r];
          const y = EY[r];
          if ((x === ax && y === ay) || (x === bx && y === by) || (x === cx && y === cy)) continue;
          const d1 = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) * s;
          const d2 = ((cx - bx) * (y - by) - (cy - by) * (x - bx)) * s;
          const d3 = ((ax - cx) * (y - cy) - (ay - cy) * (x - cx)) * s;
          if (d1 >= 0 && d2 >= 0 && d3 >= 0) {
            ear = false;
            break;
          }
        }
      }
      if (ear) {
        this.tri(base + p, base + k, base + q);
        next[p] = q;
        prev[q] = p;
        left--;
        guard = 0;
        k = q;
      } else {
        k = next[k];
        if (++guard > left) {
          // no ear left: drop collinear points if any, else give up (self-intersecting)
          let dropped = false;
          for (let r = 0, t = k; r < left; r++, t = next[t])
            if (Math.abs((EX[t] - EX[prev[t]]) * (EY[next[t]] - EY[t]) - (EY[t] - EY[prev[t]]) * (EX[next[t]] - EX[t])) <= 1e-12) {
              next[prev[t]] = next[t];
              prev[next[t]] = prev[t];
              left--;
              k = next[t];
              dropped = true;
              break;
            }
          if (!dropped) {
            this.nv = base;
            this.ni = ni0;
            return false;
          }
          guard = 0;
        }
      }
    }
    this.tri(base + prev[k], base + k, base + next[k]);
    return true;
  }
  // a fill the triangles cannot express (holes, self-intersection, an even-odd overlap): stencil then cover
  stencilFill(col, z, evenodd) {
    const gl = this.gl;
    if (this.lost) return;
    this.stats.stencil++;
    this.flush();
    const { px, py, ss, se, ns } = this;
    const start = this.ni;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let s = 0; s < ns; s++) {
      const o = ss[s];
      const n = se[s] - o;
      if (n < 3) continue;
      const base = this.nv;
      for (let k = 0; k < n; k++) {
        const x = px[o + k];
        const y = py[o + k];
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        this.vert(x, y, z, col);
      }
      for (let k = 1; k + 1 < n; k++) this.tri(base, base + k, base + k + 1);
    }
    const mid = this.ni;
    const q = this.nv;
    this.vert(x0, y0, z, col);
    this.vert(x1, y0, z, col);
    this.vert(x1, y1, z, col);
    this.vert(x0, y1, z, col);
    this.tri(q, q + 1, q + 2);
    this.tri(q, q + 2, q + 3);
    this.upload();
    gl.enable(gl.STENCIL_TEST);
    gl.colorMask(false, false, false, false);
    gl.depthMask(false);
    gl.depthFunc(gl.ALWAYS);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    if (evenodd) gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    else {
      gl.stencilOpSeparate(gl.FRONT, gl.KEEP, gl.KEEP, gl.INCR_WRAP);
      gl.stencilOpSeparate(gl.BACK, gl.KEEP, gl.KEEP, gl.DECR_WRAP);
    }
    gl.drawElements(gl.TRIANGLES, mid - start, gl.UNSIGNED_INT, start * 4);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);
    gl.depthFunc(gl.LESS);
    gl.stencilFunc(gl.NOTEQUAL, 0, evenodd ? 1 : 0xff);
    gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_INT, mid * 4);
    gl.disable(gl.STENCIL_TEST);
    this.stats.draws += 2;
    this.nv = 0;
    this.ni = 0;
  }
  // ---- strokes
  stroke(path) {
    this.begin();
    const width = this.lineWidth;
    if (!(width > 0)) return;
    let col = this.colourOf(this.strokeStyle);
    if (col >>> 24 === 0) return;
    if (this.globalCompositeOperation !== this.blendMode) this.mode();
    this.stats.strokes++;
    this.withPath(path || null, 1, col, false);
  }
  strokePath(col) {
    const width = this.lineWidth;
    // the pen: a similarity transform strokes in device px; any other in user space, mapped back
    const { a, b, c, d } = this;
    const similar = Math.abs(a - d) < 1e-9 * (Math.abs(a) + 1) && Math.abs(b + c) < 1e-9 * (Math.abs(b) + 1);
    const s = this.scaleOf();
    let hw = similar ? (width * s) / 2 : width / 2;
    // the true half width in pen units (a thin stroke is drawn wider at less alpha; its caps keep the true area)
    this.penTrueHw = hw;
    const devW = width * s;
    if (devW < GP_THIN) {
      // thinner than a device pixel: drawn GP_THIN px wide at the width's share of the alpha (4× MSAA alone would let
      // a thin line fall between the samples). Tried: true width down to 0.5 px (MSAA's rotated grid meets any band that
      // wide) lowered parity at a pixel ratio of 1 (rest 94.0 → 91.2% within 8) and hardly moved the 1-2% brightness
      // there (1.0137 → 1.0110), so not taken
      const c0 = gpColour(this.strokeStyle);
      const alpha = Math.max(0, Math.min(1, (c0.a * this.globalAlpha * devW) / GP_THIN));
      if (alpha * 255 < 0.5) return;
      col = (c0.rgb | (Math.round(alpha * 255) << 24)) >>> 0;
      hw = similar ? GP_THIN / 2 : GP_THIN / 2 / s;
      this.stats.thin++;
    }
    const z = this.nextDepth();
    const dashK = similar ? s : 1;
    const inv = similar ? null : this.inverse();
    for (let k = 0; k < this.ns; k++) {
      const o = this.ss[k];
      const n = this.se[k] - o;
      if (n < 1) continue;
      let xs = this.px;
      let ys = this.py;
      let at = o;
      if (inv) {
        xs = new Float64Array(n);
        ys = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          const x = this.px[o + i];
          const y = this.py[o + i];
          xs[i] = inv[0] * x + inv[2] * y + inv[4];
          ys[i] = inv[1] * x + inv[3] * y + inv[5];
        }
        at = 0;
      }
      const closed = this.sc[k] === 1;
      if (this.dash) this.dashed(at === 0 && xs !== this.px ? xs : xs.subarray(at, at + n), at === 0 && ys !== this.py ? ys : ys.subarray(at, at + n), closed, hw, col, z, dashK, inv);
      else this.strokeLine(xs, ys, at, n, closed, hw, col, z, inv);
    }
  }
  inverse() {
    const { a, b, c, d, e, f } = this;
    const det = a * d - b * c;
    return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
  }
  dashed(xs, ys, closed, hw, col, z, k, inv) {
    const dash = this.dash.map((v) => Math.max(0, v * k));
    const total = dash.reduce((u, v) => u + v, 0);
    if (!(total > 0)) return this.strokeLine(xs, ys, 0, xs.length, closed, hw, col, z, inv);
    const n = xs.length;
    const m = closed ? n + 1 : n;
    let off = ((this.lineDashOffset * k) % total + total) % total;
    let di = 0;
    while (off >= dash[di]) {
      off -= dash[di];
      di = (di + 1) % dash.length;
    }
    let left = dash[di] - off;
    let on = di % 2 === 0;
    let bx = [];
    let by = [];
    if (on) {
      bx.push(xs[0]);
      by.push(ys[0]);
    }
    for (let i = 1; i < m; i++) {
      const ax = xs[i - 1];
      const ay = ys[i - 1];
      const cx = xs[i % n];
      const cy = ys[i % n];
      let len = Math.hypot(cx - ax, cy - ay);
      let t = 0;
      while (len - t > left) {
        t += left;
        const x = ax + ((cx - ax) * t) / len;
        const y = ay + ((cy - ay) * t) / len;
        if (on) {
          bx.push(x);
          by.push(y);
          this.strokeLine(bx, by, 0, bx.length, false, hw, col, z, inv);
          bx = [];
          by = [];
        } else {
          bx = [x];
          by = [y];
        }
        on = !on;
        di = (di + 1) % dash.length;
        left = dash[di];
      }
      left -= len - t;
      if (on) {
        bx.push(cx);
        by.push(cy);
      }
    }
    if (on && bx.length > 1) this.strokeLine(bx, by, 0, bx.length, false, hw, col, z, inv);
  }
  // one polyline (pen space) as triangles: segments as quads, the joins and caps as the canvas draws them. No
  // allocation: scratch arrays on the context, vertices written in place (strokes are about half the calls a frame)
  scratch(n) {
    if (!this.sx || this.sx.length < n) {
      const k = Math.max(256, 2 * n);
      this.sx = new Float64Array(k);
      this.sy = new Float64Array(k);
      this.snx = new Float64Array(k);
      this.sny = new Float64Array(k);
      this.sqi = new Int32Array(4 * k);
      this.spi = new Int32Array(2 * k);
      this.sln = new Float64Array(k);
    }
  }
  room(nv, ni) {
    while ((this.nv + nv) * 4 > this.vf.length) {
      const buf = new ArrayBuffer(this.vbuf.byteLength * 2);
      new Uint8Array(buf).set(new Uint8Array(this.vbuf));
      this.vbuf = buf;
      this.vf = new Float32Array(buf);
      this.vu = new Uint32Array(buf);
    }
    while (this.ni + ni > this.ib.length) {
      const ib = new Uint32Array(this.ib.length * 2);
      ib.set(this.ib);
      this.ib = ib;
    }
  }
  // a vertex in pen space (mapped to device px when the pen is not a similarity)
  pv(x, y) {
    const i = this.nv * 4;
    const vf = this.vf;
    if (this.penInv) {
      vf[i] = this.a * x + this.c * y + this.e;
      vf[i + 1] = this.b * x + this.d * y + this.f;
    } else {
      vf[i] = x;
      vf[i + 1] = y;
    }
    vf[i + 2] = this.penZ;
    this.vu[i + 3] = this.penCol;
    return this.nv++;
  }
  t3(i, j, k) {
    const ib = this.ib;
    const n = this.ni;
    ib[n] = i;
    ib[n + 1] = j;
    ib[n + 2] = k;
    this.ni = n + 3;
  }
  // segments a round join or cap of half width hw needs for `sweep` radians (device tolerance; pen scale ps)
  arcSteps(hw, sweep, ps) {
    const r = hw * ps;
    if (r <= GP_TOL_PEN) return 1;
    let step;
    if (r === this.stepR) step = this.stepV;
    else {
      step = 2 * Math.acos(1 - GP_TOL_PEN / r);
      this.stepR = r;
      this.stepV = step;
    }
    const k = Math.ceil((sweep < 0 ? -sweep : sweep) / step);
    return k < 1 ? 1 : k > 64 ? 64 : k;
  }
  strokeLine(xs, ys, o, n, closed, hw, col, z, inv) {
    this.scratch(n + 1);
    const X = this.sx;
    const Y = this.sy;
    let m = 0;
    for (let i = o; i < o + n; i++) {
      const x = xs[i];
      const y = ys[i];
      if (m && Math.abs(x - X[m - 1]) < 1e-9 && Math.abs(y - Y[m - 1]) < 1e-9) continue;
      X[m] = x;
      Y[m] = y;
      m++;
    }
    if (closed && m > 1 && Math.abs(X[0] - X[m - 1]) < 1e-9 && Math.abs(Y[0] - Y[m - 1]) < 1e-9) m--;
    this.penInv = inv !== null && inv !== undefined;
    this.penZ = z;
    this.penCol = col;
    const ps = this.penInv ? this.scaleOf() : 1;
    // a round cap of half width up to one device px is drawn square: they differ by under 0.43 px² at the tip, inside
    // the stroke's own anti-aliasing (a fan a cap was a tenth of the painter's own time)
    const cap = this.lineCap === "round" && hw * ps <= 1 ? "square" : this.lineCap;
    // a square end's extension: a true square cap's (the half width), or for a round cap drawn square the extension of
    // equal area (π/4 of the true half width: a 0.6-px stroke's round caps had 1.19× the canvas's coverage at hw)
    const ext = this.lineCap === "round" ? (Math.PI / 4) * this.penTrueHw : hw;
    const join = this.lineJoin;
    if (m < 2) {
      if (m === 1 && cap !== "butt") {
        // a zero-length subpath with a round or square cap draws its cap (as Chrome's canvas does)
        if (cap === "round") {
          const k = this.arcSteps(hw, 2 * Math.PI, ps);
          this.room(k + 2, 3 * k);
          this.fan(X[0], Y[0], hw, 1, 0, 2 * Math.PI, k);
        } else {
          this.room(4, 6);
          const a = this.pv(X[0] - hw, Y[0] - hw);
          const b = this.pv(X[0] + hw, Y[0] - hw);
          const c = this.pv(X[0] + hw, Y[0] + hw);
          const d = this.pv(X[0] - hw, Y[0] + hw);
          this.t3(a, b, c);
          this.t3(a, c, d);
        }
      }
      return;
    }
    const segs = closed ? m : m - 1;
    const NX = this.snx;
    const NY = this.sny;
    const LN = this.sln;
    for (let i = 0; i < segs; i++) {
      const j = i + 1 === m ? 0 : i + 1;
      const dx = X[j] - X[i];
      const dy = Y[j] - Y[i];
      const l = Math.sqrt(dx * dx + dy * dy);
      NX[i] = -dy / l;
      NY[i] = dx / l;
      LN[i] = l;
    }
    const roundK = join === "round" || cap === "round" ? this.arcSteps(hw, Math.PI, ps) : 0;
    this.room(segs * 4 + m * (6 + roundK) + 2 * (roundK + 2), segs * 6 + m * 3 * (2 + roundK) + 6 * (roundK + 1));
    const square = !closed && cap === "square";
    const QI = this.sqi;
    const PI = this.spi;
    const limit = this.miterLimit;
    // a strip joint: the two segments share the joint's miter pair (two vertices, no join triangles) where the miter
    // is the canvas's own (miter join within the limit) or lies within the arc tolerance of the round or bevel join,
    // and the inner corner stays inside both segments. Else a break: each segment ends square there and the join is
    // drawn on its own (below)
    const tol = GP_TOL_PEN / ps;
    const j0 = closed ? 0 : 1;
    const j1 = closed ? m : m - 1;
    // the joint tests without square roots, h = cos²(θ/2): a miter within the limit is h·limit² ≥ 1; a miter within
    // the tolerance of the round join, hw·(1/cos − 1) ≤ tol, is h ≥ 1/(1 + tol/hw)²; of the bevel, hw·(1/cos − cos) ≤
    // tol, is (1 − h)² ≤ h·(tol/hw)²; the inner corner hw·tan(θ/2) within both segments is hw²·(1 − h) ≤ h·min(L)²
    const hRound = 1 / ((1 + tol / hw) * (1 + tol / hw));
    const tq = (tol / hw) * (tol / hw);
    const limit2 = limit * limit;
    const hw2 = hw * hw;
    for (let v = j0; v < j1; v++) {
      const i0 = v === 0 ? segs - 1 : v - 1;
      const ax = NX[i0];
      const ay = NY[i0];
      const bx = NX[v];
      const by = NY[v];
      const dot = ax * bx + ay * by;
      PI[2 * v] = -1;
      if (dot < -0.98) continue;
      const h = (1 + dot) / 2;
      if (join === "miter" ? h * limit2 < 1 : join === "bevel" ? (1 - h) * (1 - h) > h * tq : h < hRound) continue;
      const lmin = LN[i0] < LN[v] ? LN[i0] : LN[v];
      if (hw2 * (1 - h) > h * lmin * lmin) continue;
      const f = hw / (1 + dot);
      const mx = (ax + bx) * f;
      const my = (ay + by) * f;
      PI[2 * v] = this.pv(X[v] + mx, Y[v] + my);
      PI[2 * v + 1] = this.pv(X[v] - mx, Y[v] - my);
    }
    const strip = (v) => (closed || (v > 0 && v < m - 1)) && PI[2 * v] >= 0;
    for (let i = 0; i < segs; i++) {
      const j = i + 1 === m ? 0 : i + 1;
      const nx = NX[i] * hw;
      const ny = NY[i] * hw;
      let p;
      let q;
      let r;
      let t;
      if (strip(i)) {
        p = PI[2 * i];
        q = PI[2 * i + 1];
      } else {
        let ax = X[i];
        let ay = Y[i];
        if (square && i === 0) {
          ax -= NY[i] * ext;
          ay += NX[i] * ext;
        }
        p = this.pv(ax + nx, ay + ny);
        q = this.pv(ax - nx, ay - ny);
      }
      if (strip(j)) {
        t = PI[2 * j];
        r = PI[2 * j + 1];
      } else {
        let bx = X[j];
        let by = Y[j];
        if (square && i === segs - 1) {
          bx += NY[i] * ext;
          by -= NX[i] * ext;
        }
        r = this.pv(bx - nx, by - ny);
        t = this.pv(bx + nx, by + ny);
      }
      this.t3(p, q, r);
      this.t3(p, r, t);
      // the quad's corners: start +, start -, end +, end -
      QI[4 * i] = p;
      QI[4 * i + 1] = q;
      QI[4 * i + 2] = t;
      QI[4 * i + 3] = r;
    }
    for (let v = j0; v < j1; v++) {
      if (PI[2 * v] >= 0) continue;
      const i0 = v === 0 ? segs - 1 : v - 1;
      const ax = NX[i0];
      const ay = NY[i0];
      const bx = NX[v];
      const by = NY[v];
      const cr = ax * by - ay * bx;
      const dot = ax * bx + ay * by;
      // straight on: nothing to fill (a full turn back gets a join below)
      if (cr > -1e-9 && cr < 1e-9 && dot > 0) continue;
      // the outer side: the + normals when the path turns right (cr < 0)
      const plus = cr <= 0;
      const sg = plus ? hw : -hw;
      const x = X[v];
      const y = Y[v];
      const c1 = plus ? QI[4 * i0 + 2] : QI[4 * i0 + 3];
      const c2 = plus ? QI[4 * v] : QI[4 * v + 1];
      const c0 = this.pv(x, y);
      if (join === "round") {
        // the arc from the incoming normal to the outgoing one, the short way
        const sw = Math.atan2(cr, dot);
        const k = this.arcSteps(hw, sw, ps);
        if (k === 1) this.t3(c0, c1, c2);
        else {
          const cs = Math.cos(sw / k);
          const sn = Math.sin(sw / k);
          let ux = sg * ax;
          let uy = sg * ay;
          let prev = c1;
          for (let i = 1; i < k; i++) {
            const nx = ux * cs - uy * sn;
            uy = ux * sn + uy * cs;
            ux = nx;
            const pt = this.pv(x + ux, y + uy);
            this.t3(c0, prev, pt);
            prev = pt;
          }
          this.t3(c0, prev, c2);
        }
        continue;
      }
      this.t3(c0, c1, c2);
      if (join === "miter") {
        const h = (1 + dot) / 2;
        // the miter's length over the half width: 1 / cos(θ/2)
        if (h > 1e-12 && 1 / Math.sqrt(h) <= limit) {
          const mx = ax + bx;
          const my = ay + by;
          const ml = Math.sqrt(mx * mx + my * my);
          if (ml > 1e-9) {
            const f = sg / (ml * Math.sqrt(h));
            this.t3(c1, this.pv(x + mx * f, y + my * f), c2);
          }
        }
      }
    }
    if (!closed && cap === "round") {
      this.fan(X[0], Y[0], hw, NX[0], NY[0], Math.PI, roundK);
      this.fan(X[m - 1], Y[m - 1], hw, -NX[segs - 1], -NY[segs - 1], Math.PI, roundK);
    }
  }
  // a fan of k triangles round (x, y) from the unit direction (ux, uy) through sweep (pen space; room reserved)
  fan(x, y, r, ux, uy, sweep, k) {
    const c = this.pv(x, y);
    const cs = Math.cos(sweep / k);
    const sn = Math.sin(sweep / k);
    ux *= r;
    uy *= r;
    let prev = this.pv(x + ux, y + uy);
    for (let i = 1; i <= k; i++) {
      const nx = ux * cs - uy * sn;
      uy = ux * sn + uy * cs;
      ux = nx;
      const p = this.pv(x + ux, y + uy);
      this.t3(c, prev, p);
      prev = p;
    }
  }
  // ---- text: each string rasterised once into a texture at its device size, drawn as a quad
  fillText(text, x, y) {
    this.begin();
    if (this.lost) return;
    if (this.globalCompositeOperation !== this.blendMode) this.mode();
    const c0 = gpColour(this.fillStyle);
    const alpha = c0.a * this.globalAlpha;
    if (alpha <= 0 || !text) return;
    this.stats.text++;
    this.flush();
    const gl = this.gl;
    const s = this.scaleOf();
    const key = [text, this.font, this.textAlign, this.textBaseline, this.letterSpacing, this.fillStyle, Math.round(s * 64)].join("|");
    this.texts ??= new Map();
    let t = this.texts.get(key);
    if (!t) {
      const cv = document.createElement("canvas");
      const g = cv.getContext("2d");
      g.font = this.font;
      if ("letterSpacing" in g) g.letterSpacing = this.letterSpacing;
      const mt = g.measureText(text);
      const pad = 2;
      const left = Math.ceil(mt.actualBoundingBoxLeft ?? 0) + pad;
      const right = Math.ceil(mt.actualBoundingBoxRight ?? mt.width) + pad;
      const up = Math.ceil(mt.fontBoundingBoxAscent ?? mt.actualBoundingBoxAscent ?? 10) + pad;
      const down = Math.ceil(mt.fontBoundingBoxDescent ?? mt.actualBoundingBoxDescent ?? 4) + pad;
      // the box in user units round the anchor (align and baseline applied by the 2D context itself)
      const ax = this.textAlign === "center" ? (right - left) / 2 : 0;
      const W = Math.max(1, Math.ceil((left + right + 2 * up) * s));
      const H = Math.max(1, Math.ceil((up + down + 2 * up) * s));
      cv.width = W;
      cv.height = H;
      g.setTransform(s, 0, 0, s, 0, 0);
      g.font = this.font;
      if ("letterSpacing" in g) g.letterSpacing = this.letterSpacing;
      g.textAlign = this.textAlign;
      g.textBaseline = this.textBaseline;
      g.fillStyle = this.fillStyle;
      const ox = left + up + ax;
      const oy = 2 * up;
      g.fillText(text, ox, oy);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      t = { tex, w: W / s, h: H / s, ox, oy, colourAlpha: c0.a };
      this.texts.set(key, t);
    }
    this.textQuad(t, x, y, this.globalAlpha);
  }
  textQuad(t, x, y, alpha) {
    const gl = this.gl;
    if (this.lost) return;
    if (!this.tprog) {
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, GP_TVS));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, GP_TFS));
      gl.linkProgram(p);
      this.tprog = p;
      this.tSize = gl.getUniformLocation(p, "uSize");
      this.tAlpha = gl.getUniformLocation(p, "uAlpha");
      this.tvao = gl.createVertexArray();
      this.tvbo = gl.createBuffer();
      gl.bindVertexArray(this.tvao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.tvbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
      gl.bindVertexArray(null);
    }
    const z = this.nextDepth();
    const x0 = x - t.ox;
    const y0 = y - t.oy;
    const P = (u, v) => [this.a * (x0 + u * t.w) + this.c * (y0 + v * t.h) + this.e, this.b * (x0 + u * t.w) + this.d * (y0 + v * t.h) + this.f, z, u, v];
    const data = new Float32Array([...P(0, 0), ...P(1, 0), ...P(1, 1), ...P(0, 0), ...P(1, 1), ...P(0, 1)]);
    if (this.target() === false) return;
    gl.useProgram(this.tprog);
    gl.uniform2f(this.tSize, this.fbW, this.fbH);
    gl.uniform1f(this.tAlpha, alpha);
    gl.bindVertexArray(this.tvao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tvbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    this.stats.draws++;
  }
  measureText(text) {
    gpProbe ??= document.createElement("canvas").getContext("2d");
    gpProbe.font = this.font;
    return gpProbe.measureText(text);
  }
  // ---- clips: an axis-aligned rectangle in device px is a scissor (the painter's incremental rects); anything else
  // is listed as unsupported (none in the op stream)
  clip(a) {
    this.begin();
    if (a && typeof a === "object") {
      this.stats.unsupported.add("clip(path)");
      return;
    }
    const { px, py, ns } = this;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < this.np; i++) {
      x0 = Math.min(x0, px[i]);
      x1 = Math.max(x1, px[i]);
      y0 = Math.min(y0, py[i]);
      y1 = Math.max(y1, py[i]);
    }
    let rect = ns >= 1 && this.np >= 4;
    for (let i = 0; i < this.np && rect; i++) if ((px[i] !== x0 && px[i] !== x1) || (py[i] !== y0 && py[i] !== y1)) rect = false;
    if (!rect) {
      this.stats.unsupported.add("clip(non-rectangle)");
      return;
    }
    let r = [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)];
    if (this.scissor) r = [Math.max(r[0], this.scissor[0]), Math.max(r[1], this.scissor[1]), Math.min(r[2], this.scissor[2]), Math.min(r[3], this.scissor[3])];
    this.flush();
    this.scissor = r;
  }
  clearRect(x, y, w, h) {
    this.begin();
    this.flush();
    if (this.lost) return;
    const gl = this.gl;
    // device px under the current transform (the painter clears under the identity)
    const x0 = this.a * x + this.e;
    const y0 = this.d * y + this.f;
    const x1 = this.a * (x + w) + this.e;
    const y1 = this.d * (y + h) + this.f;
    const all = x0 <= 0 && y0 <= 0 && x1 >= this.fbW && y1 >= this.fbH && !this.scissor;
    if (this.target() === false) return;
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clearStencil(0);
    if (!all) {
      gl.enable(gl.SCISSOR_TEST);
      const r = [Math.max(Math.round(x0), this.scissor ? this.scissor[0] : -Infinity), Math.max(Math.round(y0), this.scissor ? this.scissor[1] : -Infinity), Math.min(Math.round(x1), this.scissor ? this.scissor[2] : Infinity), Math.min(Math.round(y1), this.scissor ? this.scissor[3] : Infinity)];
      gl.scissor(r[0], this.fbH - r[3], Math.max(0, r[2] - r[0]), Math.max(0, r[3] - r[1]));
    }
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
    this.depth = 1 - GP_DEPTH;
  }
  clearDepth() {
    const gl = this.gl;
    if (this.target() === false) return;
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    this.depth = 1 - GP_DEPTH;
  }
  fillRect(x, y, w, h) {
    this.beginPath();
    this.rect(x, y, w, h);
    this.fill();
  }
  strokeRect(x, y, w, h) {
    this.beginPath();
    this.rect(x, y, w, h);
    this.stroke();
  }
  drawImage() {
    this.stats.unsupported.add("drawImage");
  }
  createLinearGradient() {
    this.stats.unsupported.add("gradient");
    return { addColorStop() {} };
  }
  // merge f4: a radial gradient with a circle at r0 0 and the same centre (fu/f4-lights' lens halos, painted by the
  // canvas painter until the GL lights fade in) is drawn as one annulus per stop pair; any other is listed unsupported
  createRadialGradient(x0, y0, r0, x1, y1, r1) {
    if (r0 !== 0 || x0 !== x1 || y0 !== y1) return this.createLinearGradient();
    return new GpRadial(x1, y1, r1);
  }
  fillRadial(G) {
    const st = G.stops;
    if (st.length === 0) return;
    st.sort((p, q) => p[0] - q[0]);
    const col = (c, d) => {
      const A = gpColour(c);
      const B = gpColour(d);
      const ch = (v, k) => (v >> k) & 255;
      const a = 0.5 * (A.a + B.a);
      const mix = (k) => (a > 0 ? Math.round((ch(A.rgb, k) * A.a + ch(B.rgb, k) * B.a) / (2 * a)) : 0);
      const al = Math.max(0, Math.min(1, a * this.globalAlpha));
      return (mix(0) | (mix(8) << 8) | (mix(16) << 16) | (Math.round(al * 255) << 24)) >>> 0;
    };
    const ring = (ri, ro, c) => {
      if (c >>> 24 === 0 || ro <= ri) return;
      this.beginPath();
      this.arc(G.x, G.y, ro, 0, 2 * Math.PI);
      this.closePath();
      if (ri > 0) {
        this.moveTo(G.x + ri, G.y);
        this.arc(G.x, G.y, ri, 0, 2 * Math.PI, true);
        this.closePath();
      }
      this.stats.fills++;
      this.fillPath(c, false);
    };
    if (st[0][0] > 0) ring(0, st[0][0] * G.r, col(st[0][1], st[0][1]));
    for (let i = 0; i + 1 < st.length; i++) ring(st[i][0] * G.r, st[i + 1][0] * G.r, col(st[i][1], st[i + 1][1]));
    this.beginPath();
  }
  // (canvas-painter flush(): a read forces the frame through)
  getImageData(x, y, w, h) {
    this.commit();
    const out = new Uint8Array(4);
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return { width: w, height: h, data: new Uint8ClampedArray(Math.max(4, 4 * w * h)) };
  }
  // ---- GL
  target() {
    if (this.lost) return false;
    const gl = this.gl;
    const W = this.canvas.width;
    const H = this.canvas.height;
    if (!this.fbo || W !== this.fbW || H !== this.fbH) {
      if (this.fbo) {
        gl.deleteFramebuffer(this.fbo);
        gl.deleteRenderbuffer(this.rbC);
        gl.deleteRenderbuffer(this.rbD);
      }
      this.fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      this.rbC = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.rbC);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA8, W, H);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.rbC);
      this.rbD = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.rbD);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.DEPTH24_STENCIL8, W, H);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this.rbD);
      this.fbW = W;
      this.fbH = H;
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) {
        // (a target this size could not be made: out of memory) the canvas painter takes over, as on a lost context
        this.lost = true;
        if (this.onLost) queueMicrotask(this.onLost);
        return false;
      }
      gl.clearColor(0, 0, 0, 0);
      gl.clearDepth(1);
      gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, W, H);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.depthMask(true);
    gl.enable(gl.BLEND);
    this.blendNow();
    gl.disable(gl.CULL_FACE);
    if (this.scissor) {
      const r = this.scissor;
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(r[0], H - r[3], Math.max(0, r[2] - r[0]), Math.max(0, r[3] - r[1]));
    } else gl.disable(gl.SCISSOR_TEST);
  }
  upload() {
    const gl = this.gl;
    if (this.target() === false) return false;
    gl.useProgram(this.prog);
    gl.uniform2f(this.uSize, this.fbW, this.fbH);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.vf.subarray(0, this.nv * 4), gl.STREAM_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.ib.subarray(0, this.ni), gl.STREAM_DRAW);
    this.stats.verts += this.nv;
  }
  // draw the batch so far
  flush() {
    if (this.ni === 0 || this.lost) {
      this.nv = 0;
      this.ni = 0;
      return;
    }
    const gl = this.gl;
    if (this.upload() === false) {
      this.nv = 0;
      this.ni = 0;
      return;
    }
    gl.drawElements(gl.TRIANGLES, this.ni, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
    this.stats.draws++;
    this.nv = 0;
    this.ni = 0;
  }
  // the first drawing call since the last commit schedules one (after the painter's synchronous paint)
  begin() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => this.commit());
  }
  commit() {
    if (!this.pending || this.lost) return;
    this.pending = false;
    this.flush();
    const gl = this.gl;
    if (this.target() === false) return;
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, this.fbW, this.fbH, 0, 0, this.fbW, this.fbH, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.scissor = null;
  }
}

// parity (debug, ?painter=gl&tee=1): every call to the GL context and to a 2D context on an unseen canvas of the
// same size, so one frame's two pictures can be compared exactly (the same ops, the same moment)
function gpTee(gp) {
  const off = document.createElement("canvas");
  const c2 = off.getContext("2d", { alpha: true, willReadFrequently: true });
  const sync = () => {
    if (off.width !== gp.canvas.width) off.width = gp.canvas.width;
    if (off.height !== gp.canvas.height) off.height = gp.canvas.height;
  };
  // (the probe: both pictures stop after `limit` fill and stroke calls; `log` keeps each call's state)
  const debug = { limit: Infinity, calls: 0, log: null };
  const tee = new Proxy(gp, {
    get(target, key) {
      if (key === "teeCanvas") return off;
      if (key === "gp") return gp;
      if (key === "debug") return debug;
      if (key === "fill" || key === "stroke") {
        return (...args) => {
          if (++debug.calls > debug.limit) return;
          if (debug.log) debug.log.push({ call: debug.calls, kind: key, style: key === "fill" ? target.fillStyle : target.strokeStyle, alpha: target.globalAlpha, width: target.lineWidth, join: target.lineJoin, cap: target.lineCap, dash: target.dash, rule: typeof args[args.length - 1] === "string" ? args[args.length - 1] : "nonzero", path: Boolean(args[0] && typeof args[0] === "object"), subs: target.ns, pts: target.np, T: [target.a, target.b, target.c, target.d, target.e, target.f].map((v) => +v.toFixed(3)), st: { ...target.stats, unsupported: undefined } });
          if (typeof c2[key] === "function") c2[key](...args);
          return target[key](...args);
        };
      }
      const v = target[key];
      if (typeof v !== "function" || key === "getImageData") return typeof v === "function" ? v.bind(target) : v;
      return (...args) => {
        if (key === "clearRect") sync();
        // merge f4: a gradient is made in both contexts; the 2D one rides on the GL one (its stops added to both)
        if (key === "createRadialGradient" || key === "createLinearGradient") {
          const g2 = c2[key](...args);
          const g = v.apply(target, args);
          const add = g.addColorStop.bind(g);
          return Object.assign(g, { teeTwin: g2, addColorStop: (o, c) => (g2.addColorStop(o, c), add(o, c)) });
        }
        if (typeof c2[key] === "function") c2[key](...args);
        return v.apply(target, args);
      };
    },
    set(target, key, value) {
      target[key] = value;
      if (key in c2) c2[key] = value && value.teeTwin ? value.teeTwin : value;
      return true;
    },
    has(target, key) {
      return key in target || key in c2;
    },
  });
  return tee;
}

// the GL picture as premultiplied RGBA rows top-down (the multisampled target resolved)
function gpRead(gp) {
  gp.pending = true;
  gp.commit();
  const gl = gp.gl;
  const W = gp.fbW;
  const H = gp.fbH;
  const fb = gl.createFramebuffer();
  const rb = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, W, H);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fb);
  gl.framebufferRenderbuffer(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, gp.fbo);
  gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
  const raw = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, raw);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.deleteRenderbuffer(rb);
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) out.set(raw.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  return { W, H, data: out };
}

// the two pictures compared as a reader sees them: each composited over the plate's background (RGB). `painted` =
// pixels either picture covers; `structural` = pixels whose 5×5 box-blurred colour still differs by over 16 levels
// (an edge's or a line's anti-aliasing moves coverage by under a pixel and averages out; a missing, extra or misplaced
// shape, or a line of contrast over 80, does not)
function gpParity(tee, { images = false, cell = 32 } = {}) {
  const gp = tee.gp;
  const g = gpRead(gp);
  const off = tee.teeCanvas;
  const W = g.W;
  const H = g.H;
  const c = off.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const a = g.data;
  const plate = gp.canvas.closest(".iso-plate") ?? document.body;
  const bgCss = getComputedStyle(plate).backgroundColor;
  const bgv = gpColour(bgCss);
  const bg = [bgv.rgb & 255, (bgv.rgb >> 8) & 255, (bgv.rgb >> 16) & 255];
  const N = W * H;
  const A = new Uint8ClampedArray(3 * N);
  const C = new Uint8ClampedArray(3 * N);
  const cover = new Uint8Array(N);
  for (let p = 0, i = 0; p < N; p++, i += 4) {
    const ga = a[i + 3];
    const ca = c[i + 3];
    if (ga || ca) cover[p] = 1;
    for (let k = 0; k < 3; k++) {
      A[3 * p + k] = a[i + k] + (bg[k] * (255 - ga)) / 255;
      C[3 * p + k] = (c[i + k] * ca) / 255 + (bg[k] * (255 - ca)) / 255;
    }
  }
  let painted = 0;
  let in8 = 0;
  let in2 = 0;
  let max = 0;
  let sumG = 0;
  let sumC = 0;
  let brighter = 0;
  let darker = 0;
  const brightCells = new Map();
  const cw = Math.ceil(W / cell);
  const cells = new Uint32Array(cw * Math.ceil(H / cell));
  const diff = images ? new Uint8ClampedArray(N * 4) : null;
  for (let p = 0; p < N; p++) {
    if (!cover[p]) continue;
    painted++;
    const j = 3 * p;
    const d = Math.max(Math.abs(A[j] - C[j]), Math.abs(A[j + 1] - C[j + 1]), Math.abs(A[j + 2] - C[j + 2]));
    sumG += A[j] + A[j + 1] + A[j + 2];
    sumC += C[j] + C[j + 1] + C[j + 2];
    if (d <= 8) in8++;
    else {
      cells[Math.floor(p / W / cell) * cw + ((p % W) / cell | 0)]++;
      if (A[j] + A[j + 1] + A[j + 2] > C[j] + C[j + 1] + C[j + 2]) {
        brighter++;
        // the brightest-over pixels, spread over the picture (one a 64-px cell), for the probe
        const gain = A[j] + A[j + 1] + A[j + 2] - C[j] - C[j + 1] - C[j + 2];
        const key = ((p / W / 64) | 0) * 1000 + (((p % W) / 64) | 0);
        const had = brightCells.get(key);
        if (!had || had[0] < gain) brightCells.set(key, [gain, p % W, (p / W) | 0]);
      } else darker++;
    }
    if (d <= 2) in2++;
    if (d > max) max = d;
    if (diff) {
      const v = Math.min(255, d * 4);
      diff[4 * p] = v;
      diff[4 * p + 1] = d > 8 ? 0 : v;
      diff[4 * p + 2] = d > 8 ? 0 : v;
      diff[4 * p + 3] = 255;
    }
  }
  const scells = new Uint32Array(cells.length);
  const spx = [];
  let structural = 0;
  const blur = (P, x, y, k) => {
    let sum = 0;
    let n = 0;
    for (let yy = Math.max(0, y - 2); yy <= Math.min(H - 1, y + 2); yy++)
      for (let xx = Math.max(0, x - 2); xx <= Math.min(W - 1, x + 2); xx++) {
        sum += P[3 * (yy * W + xx) + k];
        n++;
      }
    return sum / n;
  };
  for (let q = 0; q < cells.length; q++) {
    if (!cells[q]) continue;
    const x0 = (q % cw) * cell;
    const y0 = Math.floor(q / cw) * cell;
    for (let y = y0; y < Math.min(H, y0 + cell); y++)
      for (let x = x0; x < Math.min(W, x0 + cell); x++) {
        let worstCh = 0;
        for (let k = 0; k < 3; k++) worstCh = Math.max(worstCh, Math.abs(blur(A, x, y, k) - blur(C, x, y, k)));
        if (worstCh <= 16) continue;
        structural++;
        scells[q]++;
        if (worstCh > (spx[q] ?? [0])[0]) spx[q] = [worstCh, x, y];
        if (diff) {
          const p = 4 * (y * W + x);
          diff[p] = 255;
          diff[p + 1] = 255;
          diff[p + 2] = 0;
        }
      }
  }
  const sworst = [...scells.keys()].sort((x, y) => scells[y] - scells[x]).slice(0, 6).filter((k) => scells[k] > 0).map((k) => ({ x: (k % cw) * cell, y: Math.floor(k / cw) * cell, structural: scells[k], px: spx[k] }));
  const worst = [...cells.keys()].sort((x, y) => cells[y] - cells[x]).slice(0, 6).filter((k) => cells[k] > 0).map((k) => ({ x: (k % cw) * cell, y: Math.floor(k / cw) * cell, over8: cells[k] }));
  const res = { W, H, bg: bgCss, painted, within8: painted ? in8 / painted : 1, within2: painted ? in2 / painted : 1, over8: painted - in8, max, worst, structural, sworst, light: sumC ? sumG / sumC : 1, brighter, darker, bright: [...brightCells.values()].sort((x, y) => y[0] - x[0]).slice(0, 8) };
  if (images) {
    const png = (P) => {
      const cv = document.createElement("canvas");
      cv.width = W;
      cv.height = H;
      const img = cv.getContext("2d").createImageData(W, H);
      for (let p = 0; p < N; p++) {
        img.data[4 * p] = P[3 * p];
        img.data[4 * p + 1] = P[3 * p + 1];
        img.data[4 * p + 2] = P[3 * p + 2];
        img.data[4 * p + 3] = 255;
      }
      cv.getContext("2d").putImageData(img, 0, 0);
      return cv;
    };
    const glC = png(A);
    const cvC = png(C);
    const dC = document.createElement("canvas");
    dC.width = W;
    dC.height = H;
    dC.getContext("2d").putImageData(new ImageData(diff, W, H), 0, 0);
    // the worst cells, 4×: GL | canvas | diff, one row a cell
    const cw2 = 96;
    const ch2 = 64;
    const Z = 4;
    const rows = (sworst.length ? sworst : worst).slice(0, 4);
    const crop = document.createElement("canvas");
    crop.width = 3 * cw2 * Z + 8;
    crop.height = Math.max(1, rows.length) * (ch2 * Z + 4);
    const cx2 = crop.getContext("2d");
    cx2.imageSmoothingEnabled = false;
    cx2.fillStyle = "#777";
    cx2.fillRect(0, 0, crop.width, crop.height);
    rows.forEach((cl, r) => {
      const sx = Math.max(0, Math.min(W - cw2, cl.x + cell / 2 - cw2 / 2));
      const sy = Math.max(0, Math.min(H - ch2, cl.y + cell / 2 - ch2 / 2));
      [glC, cvC, dC].forEach((src, k) => cx2.drawImage(src, sx, sy, cw2, ch2, k * (cw2 * Z + 4), r * (ch2 * Z + 4), cw2 * Z, ch2 * Z));
    });
    res.crop = crop.toDataURL("image/png");
    res.gl = glC.toDataURL("image/png");
    res.canvas = cvC.toDataURL("image/png");
    res.diff = dC.toDataURL("image/png");
  }
  return res;
}

// which fill or stroke call first makes the two pictures differ by over 8 at (x, y), device px: bisect the call count
function gpProbeAt(tee, paint, x, y) {
  const d = tee.debug;
  const at = (limit) => {
    d.limit = limit;
    d.calls = 0;
    paint();
    const g = gpRead(tee.gp);
    const c = tee.teeCanvas.getContext("2d", { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
    const i = 4 * (y * g.W + x);
    const pc = [0, 1, 2].map((k) => (c[k] * c[3] + 127) / 255).concat([c[3]]);
    const gv = [...g.data.slice(i, i + 4)];
    return { diff: Math.max(...gv.map((v, k) => Math.abs(v - pc[k]))), gl: gv, canvas: pc.map(Math.round) };
  };
  d.limit = Infinity;
  d.calls = 0;
  paint();
  const total = d.calls;
  const end = at(total);
  const done = () => {
    d.limit = Infinity;
    d.calls = 0;
    paint();
  };
  if (end.diff <= 8) {
    done();
    return { total, end, note: "no difference" };
  }
  // the first call after which the difference passes 60% of the final one (and 8): the call that makes it
  const thr = Math.max(8, 0.6 * end.diff);
  let lo = 0;
  let hi = total;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at(mid).diff > thr) hi = mid;
    else lo = mid;
  }
  const before = at(hi - 1);
  const after = at(hi);
  d.log = [];
  d.limit = Infinity;
  d.calls = 0;
  paint();
  const call = d.log[hi - 1];
  d.log = null;
  done();
  return { total, first: hi, before, after, end, call };
}

// can this browser run the GL painter as it should: WebGL2 with at least 4× MSAA and a complete multisampled RGBA8 +
// depth-stencil target (else the canvas painter: an airframe without anti-aliasing would be a worse picture). The
// probe's context is released at once (WEBGL_lose_context), so it does not count against the page's context limit
function gpCapable(samples) {
  try {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 4;
    const gl = cv.getContext("webgl2", { antialias: false, depth: false, stencil: false });
    if (!gl) return { ok: false, why: "no WebGL2" };
    const max = gl.getParameter(gl.MAX_SAMPLES) | 0;
    let ok = max >= Math.min(4, samples);
    let why = ok ? "" : `MSAA ${max}`;
    if (ok) {
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      const n = Math.min(samples, max);
      for (const [fmt, at] of [[gl.RGBA8, gl.COLOR_ATTACHMENT0], [gl.DEPTH24_STENCIL8, gl.DEPTH_STENCIL_ATTACHMENT]]) {
        const rb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        gl.renderbufferStorageMultisample(gl.RENDERBUFFER, n, fmt, 4, 4);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, at, gl.RENDERBUFFER, rb);
      }
      ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      if (!ok) why = "multisampled target incomplete";
    }
    // the painter's own programs compile and link here
    for (const [vs, fs] of ok ? [[GP_VS, GP_FS], [GP_TVS, GP_TFS]] : []) {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        gl.attachShader(p, sh);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        ok = false;
        why = "program: " + gl.getProgramInfoLog(p);
      }
    }
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return { ok, why };
  } catch (e) {
    return { ok: false, why: String(e && e.message) };
  }
}

// the mount: the canvas painter with GpContext on its layers, behind a proxy that swaps in the canvas painter when the
// WebGL2 context is lost. Options as cpMount's, and { samples } (MSAA samples, at most the GPU's).
function gpMountWith(stage, controller, options, async) {
  const svgs = [...stage.querySelectorAll("svg[data-live]")].filter((svg) => {
    const wanted = options.only ?? controller.canvasLayers ?? null;
    return !wanted || wanted.includes(svg.dataset.live);
  });
  const contexts = [];
  // the hub keys (<g data-spin>) the parts carry, for the tools
  const spinKeys = [...new Set(svgs.flatMap((svg) => [...svg.querySelectorAll("[data-spin]")].map((el) => el.getAttribute("data-spin"))))];
  let failed = false;
  let lost = false;
  let current = null;
  let proxy = null;
  const replay = { tint: null, spins: new Map(), view: null, ratio: null, incremental: null, grownFaces: null };
  const fallback = async () => {
    if (lost) return;
    lost = true;
    const gl = current;
    // the live SVG back in place (unseen) for the canvas painter's compile, the GL canvases out
    for (const svg of svgs) {
      const cv = stage.querySelector(`canvas[data-canvas-live="${svg.dataset.live}"]`);
      svg.style.opacity = "0";
      if (cv) {
        cv.after(svg);
        cv.remove();
      } else stage.appendChild(svg);
    }
    const next = await cpMountAsync(stage, controller, { ...options, context: null });
    for (const svg of svgs) svg.style.opacity = "";
    if (replay.ratio !== null) next.setMaxRatio(replay.ratio);
    if (replay.incremental !== null) next.incremental = replay.incremental;
    if (replay.grownFaces !== null) next.grownFaces = replay.grownFaces;
    if (replay.view) next.setView(...replay.view);
    for (const [key, angle] of replay.spins) next.spin(key, angle);
    if (replay.tint) next.tint(...replay.tint);
    current = next;
    stage.setAttribute("data-painter", "canvas");
    if (gl && gl.destroy) gl.destroy();
    next.paint();
    if (typeof console !== "undefined") console.info("gl painter: context lost, the canvas painter took over");
  };
  const able = gpCapable(options.samples ?? 4);
  if (!able.ok) {
    // the canvas painter, as the page would mount it without this option
    if (typeof console !== "undefined") console.info(`gl painter: ${able.why}; the canvas painter draws the airframe`);
    const plain = { ...options, context: null };
    return async ? cpMountAsync(stage, controller, plain) : cpMountWith(stage, controller, plain, null);
  }
  gpPathClass();
  if (GpPath2D) globalThis.Path2D = GpPath2D;
  const context = (canvas) => {
    const ctx = new GpContext(canvas, { samples: options.samples ?? 4, onLost: () => fallback() });
    if (!ctx.gl) {
      failed = true;
      return canvas.getContext("2d", { alpha: true, desynchronized: false });
    }
    contexts.push(ctx);
    if (options.tee) {
      const t = gpTee(ctx);
      tees.push(t);
      return t;
    }
    return ctx;
  };
  const tees = [];
  const wrap = (inner) => {
    current = inner;
    if (!failed) stage.setAttribute("data-painter", "gl");
    proxy = new Proxy(inner, {
      get(_, key) {
        const target = current;
        if (key === "parity") return (opts) => tees.map((t) => gpParity(t, opts));
        if (key === "spinKeys") return spinKeys;
        if (key === "probe") return (x, y) => gpProbeAt(tees[0], () => current.paint(), x, y);
        if (key === "glContexts") return lost || failed ? [] : contexts;
        if (key === "painter") return lost || failed ? "canvas" : "gl";
        if (key === "glStats") return contexts.map((c) => ({ ...c.stats, unsupported: [...c.stats.unsupported] }));
        if (key === "loseContext") return () => contexts.forEach((c) => c.gl.getExtension("WEBGL_lose_context")?.loseContext());
        const v = target[key];
        if (typeof v !== "function") return v;
        if (key === "tint") return (...args) => ((replay.tint = args), target.tint(...args));
        if (key === "spin") return (k, a) => (replay.spins.set(k, a), target.spin(k, a));
        if (key === "setView") return (...args) => ((replay.view = args), target.setView(...args));
        if (key === "setMaxRatio") return (cap) => ((replay.ratio = cap), target.setMaxRatio(cap));
        if (key === "flush") return () => (contexts.forEach((c) => c.commit()), target.flush());
        return v.bind(target);
      },
      set(_, key, value) {
        if (key === "incremental") replay.incremental = value;
        if (key === "grownFaces") replay.grownFaces = value;
        current[key] = value;
        return true;
      },
    });
    return proxy;
  };
  // a mount that fails part-way (a context the probe passed but the real one does not) leaves its canvases out and
  // mounts the canvas painter instead
  const recover = (error) => {
    lost = true; // (its own contexts released below must not start the lost-context fallback)
    if (typeof console !== "undefined") console.info(`gl painter: ${error && error.message}; the canvas painter draws the airframe`);
    for (const c of contexts) c.gl.getExtension("WEBGL_lose_context")?.loseContext();
    for (const cv of stage.querySelectorAll("canvas[data-canvas-live]")) cv.remove();
    for (const svg of svgs) if (!svg.isConnected) stage.appendChild(svg);
    const plain = { ...options, context: null };
    return async ? cpMountAsync(stage, controller, plain) : cpMountWith(stage, controller, plain, null);
  };
  if (async) return cpMountAsync(stage, controller, { ...options, context }).then(wrap, recover);
  try {
    return wrap(cpMountWith(stage, controller, { ...options, context }, null));
  } catch (error) {
    return recover(error);
  }
}

export const GLPAINT = {
  mount: (stage, controller, options = {}) => gpMountWith(stage, controller, options, false),
  mountAsync: (stage, controller, options = {}) => gpMountWith(stage, controller, options, true),
  Context: GpContext,
};
