import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LINE_ENDS } from "./line-ends.mjs";
import { staleness } from "./source-hash.mjs";

function usage() {
  console.log(`Checks for 3D figures (turning groups).

  node turn-check.mjs build.mjs --fidelity [--angles 7,37,…] [--out=a380/tmp/fid.html]
      Node: every live prism against k.extrude / G.prismOf, every round and lathe against G.lathe(smooth) and every tube
      against tubePieces, at P'(θ). Control: one prism drawn 2° off must fail.
  node turn-check.mjs page.html [--order] [--pops] [--lines] [--perf] [--step 1] [--states states.json]
                                [--width 1440] [--height 1100] [--scale 2] [--throttle 1] [--no-webgl] [--out dir]
      --order   needs a --verify build: the recorded shapes in a WebGL z-buffer (part-ID colours, 2x) against the live
                layers' fills in DOM order. Fails on any live pair with 4 or more interior pixels. Static × live mismatches
                are listed (the layer proofs and the orbit audit own them). Control: each live layer's order reversed at
                0, 90, 180 and 270 must give at least 1000 mismatched pixels.
      --pops    first difference θ → θ+0.02° at every step, and second difference at 0.1° over a full turn; control: one
                part's fill hidden for one frame must fail. Run with --no-webgl and the tour held.
      --lines   LINE_ENDS at 24 angles (run it on the light and the dark page); control: a planted floating line must fail.
      --perf    240 frames at 1.1° per frame (3 runs) turned through the page (window.__a380.tick: pv.turn and one page
                tick a frame, as a drag) or else the controller, inside requestAnimationFrame: set() time and calls a
                frame, script, task, style and layout per frame, frame interval median and p95, live elements, writes and
                moves. Waits for WebGL (every program linked, glShare ≥ 0.999); fails on SwiftShader or no WebGL unless
                --no-webgl. --state rest,cutaway,cutawayDoors,inspect:<view id>,takeoff (or all): one line a state.
      --states-dir d  read relative --states names from d (a --verify --out build's <page>-states/).
      --states  a JSON list of value objects to visit instead of angles (gestures, a break-apart); several files
                comma-separated (a null between them); --slice a:b keeps states a..b-1. A null separates two paths;
                a turn that moves inside a path is a step (every part it carries joins the changed region), and a run
                that compares no step fails. A state's __vary { class: alpha } is written over the page's vary alphas.
                On a path, --pops is incremental (only the changed region is re-rendered; --incremental-check n
                compares with a full render every n steps) and compares state i with i+k for --stride k; --order
                checks every k-th state for --order-stride k (default --stride).
      --settle-check [n]  the tool-timing self-check on the first n states (default 6): the live layers right after
                the tool's set against after the page's next tick, and the first state again after the others.
  The angle is the figure's first turn group (window.__isoTurn.set(θ)).`);
}

function chromePath() {
  const candidates = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].filter(Boolean);
  const linux = join(homedir(), ".cache/ms-playwright");
  if (existsSync(linux)) for (const dir of readdirSync(linux).sort().reverse()) for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) candidates.push(join(linux, dir, sub));
  const playwright = join(homedir(), "Library/Caches/ms-playwright");
  if (existsSync(playwright)) for (const dir of readdirSync(playwright).sort().reverse()) for (const sub of ["chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "chrome-mac/Chromium.app/Contents/MacOS/Chromium", "chrome-linux/chrome"]) candidates.push(join(playwright, dir, sub));
  return candidates.find((path) => existsSync(path));
}

async function browser(target, { width, height, scale, throttle, noWebgl }) {
  const profile = mkdtempSync(join(tmpdir(), "turn-check-"));
  const chrome = spawn(chromePath(), ["--headless=new", ...(process.platform === "linux" ? ["--no-sandbox"] : []), "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--allow-file-access-from-files", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", ...(process.platform === "linux" ? ["--use-angle=gl-egl"] : []), "about:blank"]);
  // never leave a headless Chrome behind: kill it on exit, on a signal and on an uncaught error
  const reap = () => {
    try {
      chrome.kill("SIGKILL");
    } catch {}
  };
  process.on("exit", reap);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => (reap(), process.exit(130)));
  process.on("uncaughtException", (error) => (console.error(error), reap(), process.exit(1)));
  const port = await new Promise((done, fail) => {
    let text = "";
    const timer = setTimeout(() => fail(new Error("Chrome did not start")), 20000);
    chrome.stderr.on("data", (chunk) => {
      text += chunk;
      const match = text.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
      if (match) {
        clearTimeout(timer);
        done(Number(match[1]));
      }
    });
  });
  const page = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const problems = [];
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    } else if (data.method === "Runtime.consoleAPICalled" && (data.params.type === "error" || data.params.type === "warning")) problems.push(`console.${data.params.type}: ${data.params.args.map((arg) => arg.value ?? arg.description ?? "").join(" ").slice(0, 400)}`);
    else if (data.method === "Runtime.exceptionThrown") problems.push(`exception: ${data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text}`.slice(0, 400));
  };
  await new Promise((done) => (socket.onopen = done));
  const send = (method, params = {}) =>
    new Promise((done) => {
      const call = ++id;
      pending.set(call, done);
      socket.send(JSON.stringify({ id: call, method, params }));
    });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.result?.exceptionDetails) throw new Error(JSON.stringify(result.result.exceptionDetails).slice(0, 800));
    return result.result?.result?.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  const NO_GL = `(()=>{const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...rest){if(/webgl/.test(String(kind))&&!this.dataset.check)return null;return get.call(this,kind,...rest)}})();`;
  if (noWebgl) await send("Page.addScriptToEvaluateOnNewDocument", { source: NO_GL });
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: width < 600 });
  if (throttle > 1) await send("Emulation.setCPUThrottlingRate", { rate: throttle });
  const url = /^https?:|^file:/.test(target) ? target : pathToFileURL(resolve(target)).href;
  await send("Page.navigate", { url });
  // wait for the page to mount, not a fixed 1.5 s: a heavy page on a loaded machine mounts later (the turn hook
  // is the figure's own signal that it is ready); up to 120 s, then carry on and let the caller fail clearly
  for (let waited = 0; waited < 120000; waited += 250) {
    await new Promise((done) => setTimeout(done, 250));
    const ready = await send("Runtime.evaluate", { expression: "document.readyState === 'complete' && Boolean(window.__isoTurn && window.__isoTurn.controller)", returnByValue: true });
    if (ready.result?.result?.value) break;
  }
  await new Promise((done) => setTimeout(done, 300));
  const close = () => {
    socket.close();
    chrome.kill("SIGKILL");
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  };
  return { send, evaluate, close, problems };
}

const HELPERS = String.raw`(() => {
  const stage = document.querySelector(".iso-turn") || document.querySelector(".iso-stage");
  const svgs = [...stage.querySelectorAll(":scope > svg")];
  const hook = window.__isoTurn;
  const C = hook.controller;
  const vb = svgs[0].viewBox.baseVal;
  const W = vb.width;
  const H = vb.height;
  const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  const theme = (stage.closest("[data-theme]") || document.body).getAttribute("data-theme") || "dark";
  // (a380 follow-up, item 50) a tool owns the controller: C.set(state), then the page's own tick (a microtask when the
  // turn moved, else its next frame). On the A380 that tick re-sets the page's own state over the tool's when the turn
  // moved (its free groups follow the turn), so the tool's state is applied again once the tick has run; then set
  // until the painter's order stops moving (t3Order starts from the previous order: the first set after a jump
  // differed from a repeat, 10,080 px against 530 on state 365). The DOM is read only after all of that.
  const turnGroup = (C.scene().groups.find((g) => g.kind === "turn") || {}).name;
  const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 0))));
  const holds = (state) => {
    const v = C.values;
    if (typeof state === "number") return turnGroup ? Math.abs(v[turnGroup] - state) < 1e-9 : true;
    for (const k in state) if (typeof state[k] === "number" && Math.abs((v[k] ?? 0) - state[k]) > 1e-9) return false;
    return true;
  };
  let lastSet = { reapplied: 0, sets: 0, moved: 0 };
  // (a380 review round 1, fu/r1-verify) a path state may carry __vary: the alphas its clip's own channels give the vary
  // classes that move along it (a380/tools/verify-paths.mjs; the tug's fade on the push clip). The page computes its
  // vary alphas from its own model, so they are written over the page's here, after its tick (the page rewrites a
  // class only when its own alpha changes, and a held, paused page keeps its own). varyChanged: the classes whose
  // alpha changed at the last set, for the incremental pops (their parts join the changed region)
  const varyNow = {};
  const varyChanged = new Set();
  const applyVary = (vary) => {
    if (!vary) return;
    for (const cls in vary) {
      const a = String(vary[cls]);
      if (varyNow[cls] === a) continue;
      varyNow[cls] = a;
      varyChanged.add(cls);
      for (const svg of svgs) for (const el of svg.querySelectorAll("." + cls)) el.style.opacity = a;
    }
  };
  const setState = async (state) => {
    let vary = null;
    if (state && typeof state === "object" && state.__vary) {
      ({ __vary: vary, ...state } = state);
    }
    let s = C.set(state);
    let sets = 1;
    let reapplied = 0;
    await frame();
    if (!holds(state)) {
      s = C.set(state);
      sets++;
      reapplied++;
      await frame();
    }
    // a turn-only set leaves the free groups to the page's tick: set the turn again so the order converges on the
    // re-posed groups as well
    for (let i = 0; i < 4 && (s.moved || (typeof state === "number" && i === 0)); i++) {
      s = C.set(state);
      sets++;
    }
    applyVary(vary);
    lastSet = { reapplied, sets, moved: s.moved };
    return s;
  };
  // the page stops being a reader's: held by a tool (no tour), paused (no model time, no clock-driven fades), and
  // left until two snapshots of the live layers 300 ms apart are equal
  const snapshot = () => {
    const out = [];
    for (const svg of svgs) if (svg.dataset.live) for (const el of svg.querySelectorAll("[data-p]")) out.push(el.outerHTML);
    return out;
  };
  const ownPage = async () => {
    hook.set(C.values[turnGroup] ?? 0);
    if (window.__a380 && window.__a380.pv) window.__a380.pv.paused = true;
    let last = snapshot().join("");
    for (let waited = 0; waited < 15000; waited += 300) {
      await new Promise((done) => setTimeout(done, 300));
      const now = snapshot().join("");
      if (now === last) return waited + 300;
      last = now;
    }
    return -1;
  };
  // the self-check: the live layers right after setState and after one more page tick (2 frames and 100 ms)
  const settleCheck = async (state) => {
    await setState(state);
    const a = snapshot();
    const orderA = svgs.filter((s) => s.dataset.live).map((s) => [...s.querySelectorAll("[data-p]")].map((e) => e.dataset.p).join(",")).join("|");
    await frame();
    await new Promise((done) => setTimeout(done, 100));
    const b = snapshot();
    let differ = 0;
    const names = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++)
      if (a[i] !== b[i]) {
        differ++;
        const m = /data-p="(\d+)"/.exec(a[i] || b[i] || "");
        if (names.length < 6 && m) names.push(window.__isoVerify ? window.__isoVerify.parts[Number(m[1])].name : m[1]);
      }
    return { nodes: a.length, differ, names, order: orderA, set: lastSet };
  };
  const matrixOf = (el) => {
    const m = el.ownerSVGElement.getScreenCTM().inverse().multiply(el.getScreenCTM());
    return "matrix(" + m.a + " " + m.b + " " + m.c + " " + m.d + " " + m.e + " " + m.f + ")";
  };
  const decode = async (svg, w, h) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const image = new Image();
    await new Promise((done, fail) => { image.onload = done; image.onerror = fail; image.src = url; });
    const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, w, h);
    URL.revokeObjectURL(url);
    return ctx.getImageData(0, 0, w, h).data;
  };
  window.__tc = { stage, svgs, hook, C, W, H, css, theme, setState, matrixOf, decode, ownPage, settleCheck, snapshot, frame, varyChanged };
  return { W, H, layers: svgs.map((s) => s.dataset.live || null), theme };
})()`;

const ZBUFFER = String.raw`(() => {
  const { svgs, C, W, H, setState, matrixOf, decode } = window.__tc;
  const V = window.__isoVerify;
  const SCALE = 2;
  const w = W * SCALE;
  const h = H * SCALE;
  const STATIC = 30000;
  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const frameOf = (F) => {
    if (F.u && F.v) return F;
    const a = unit3(F.a);
    const helper = Math.abs(a[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
    const u = unit3(cross3(helper, a));
    return { o: F.o, a, u, v: cross3(a, u) };
  };
  function meshOf(shape) {
    const tris = [];
    const quad = (a, b, c, d) => tris.push(a, b, c, a, c, d);
    if (shape.kind === "prism") {
      const F = frameOf(shape.F);
      const at = (s, [x, y]) => add3(add3(F.o, mul3(F.a, s)), add3(mul3(F.u, x), mul3(F.v, y)));
      const n = shape.poly.length;
      const centre = shape.poly.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]);
      for (const s of [shape.s0, shape.s1]) for (let i = 0; i < n; i++) tris.push(at(s, centre), at(s, shape.poly[i]), at(s, shape.poly[(i + 1) % n]));
      for (let i = 0; i < n; i++) quad(at(shape.s0, shape.poly[i]), at(shape.s0, shape.poly[(i + 1) % n]), at(shape.s1, shape.poly[(i + 1) % n]), at(shape.s1, shape.poly[i]));
    } else if (shape.kind === "body") {
      const F = frameOf(shape.F);
      const count = 72;
      const ring = (s, r) => Array.from({ length: count }, (_, j) => { const t = (j / count) * Math.PI * 2; return add3(add3(F.o, mul3(F.a, s)), add3(mul3(F.u, r * Math.cos(t)), mul3(F.v, r * Math.sin(t)))); });
      const poly = shape.poly;
      for (let i = 0; i < poly.length; i++) {
        const [s0, r0] = poly[i];
        const [s1, r1] = poly[(i + 1) % poly.length];
        if (r0 < 1e-9 && r1 < 1e-9) continue;
        const a = ring(s0, r0);
        const b = ring(s1, r1);
        for (let j = 0; j < count; j++) quad(a[j], a[(j + 1) % count], b[(j + 1) % count], b[j]);
      }
    } else if (shape.kind === "ball") {
      const rows = 32;
      const cols = 64;
      const flats = shape.flats || [];
      const at = (i, j) => {
        const phi = (i / rows) * Math.PI;
        const t = (j / cols) * Math.PI * 2;
        let n = [Math.sin(phi) * Math.cos(t), Math.sin(phi) * Math.sin(t), Math.cos(phi)];
        let p = mul3(n, shape.r);
        for (const [nx, ny, nz, d] of flats) {
          const k = nx * p[0] + ny * p[1] + nz * p[2];
          if (k > d) p = sub3(p, mul3([nx, ny, nz], k - d));
        }
        return add3(shape.o, p);
      };
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) quad(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j));
    } else if (shape.kind === "hull") {
      for (const ring of shape.faces) for (let i = 1; i + 1 < ring.length; i++) tris.push(shape.points[ring[0]], shape.points[ring[i]], shape.points[ring[i + 1]]);
    } else if (shape.kind === "box") {
      const c = (sx, sy, sz) => add3(shape.o, add3(add3(mul3(shape.axes[0], sx * shape.half[0]), mul3(shape.axes[1], sy * shape.half[1])), mul3(shape.axes[2], sz * shape.half[2])));
      const v = [c(-1, -1, -1), c(1, -1, -1), c(1, 1, -1), c(-1, 1, -1), c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)];
      for (const [a, b, cc, d] of [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) quad(v[a], v[b], v[cc], v[d]);
    } else if (shape.kind === "tube") {
      const pts = [];
      const radii = [];
      shape.points.forEach((p, i) => {
        if (pts.length && Math.hypot(p[0] - pts[pts.length - 1][0], p[1] - pts[pts.length - 1][1], p[2] - pts[pts.length - 1][2]) < 1e-6) return;
        pts.push(p);
        radii.push(shape.radii[i]);
      });
      if (pts.length < 2) return tris;
      const count = 20;
      let u = null;
      const rings = pts.map((p, i) => {
        const t = unit3(sub3(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
        if (!u) { const helper = Math.abs(t[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]; u = unit3(cross3(helper, t)); } else u = unit3(sub3(u, mul3(t, dot3(u, t))));
        const v = cross3(t, u);
        const r = radii[i];
        return Array.from({ length: count }, (_, j) => { const a = (j / count) * Math.PI * 2; return add3(p, add3(mul3(u, r * Math.cos(a)), mul3(v, r * Math.sin(a)))); });
      });
      for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < count; j++) quad(rings[i][j], rings[i][(j + 1) % count], rings[i + 1][(j + 1) % count], rings[i + 1][j]);
      for (const [index, p] of [[0, pts[0]], [rings.length - 1, pts[pts.length - 1]]]) for (let j = 0; j < count; j++) tris.push(p, rings[index][j], rings[index][(j + 1) % count]);
    }
    return tris;
  }
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  canvas.dataset.check = "1";
  const gl = canvas.getContext("webgl", { antialias: false, preserveDrawingBuffer: true, alpha: false, depth: true });
  const vs = "attribute vec3 p;uniform vec3 uR0;uniform vec3 uR1;uniform vec3 uR2;uniform vec3 uT;uniform vec3 uM0;uniform vec3 uM1;uniform vec2 uO;uniform vec3 uV;uniform vec2 uView;uniform float uSpan;void main(){vec3 q=vec3(dot(uR0,p),dot(uR1,p),dot(uR2,p))+uT;vec2 s=uO+vec2(dot(uM0,q),dot(uM1,q));gl_Position=vec4(s.x/uView.x*2.-1.,1.-s.y/uView.y*2.,-dot(uV,q)/uSpan,1.);}";
  const fs = "precision highp float;uniform vec3 uId;void main(){gl_FragColor=vec4(uId,1.);}";
  const compile = (type, source) => { const sh = gl.createShader(type); gl.shaderSource(sh, source); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  gl.useProgram(program);
  const loc = (name) => gl.getUniformLocation(program, name);
  const where = { p: gl.getAttribLocation(program, "p"), R0: loc("uR0"), R1: loc("uR1"), R2: loc("uR2"), T: loc("uT"), M0: loc("uM0"), M1: loc("uM1"), O: loc("uO"), V: loc("uV"), view: loc("uView"), span: loc("uSpan"), id: loc("uId") };
  const bufferOf = (shapes) => {
    const pos = [];
    for (const shape of shapes) for (const p of meshOf(shape)) pos.push(p[0], p[1], p[2]);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW);
    return { b, count: pos.length / 3 };
  };
  const parts = V.parts.map((part, index) => ({ index, group: part.group, name: part.name, mesh: bufferOf(part.shapes) }));
  const statics = V.statics.map((item) => ({ rank: item.rank, mesh: bufferOf(item.shapes) }));
  const colour = (id) => [((id + 1) & 255) / 255, (((id + 1) >> 8) & 255) / 255, 0];
  const zIds = () => {
    const cams = C.cams();
    const world = cams.world;
    gl.viewport(0, 0, w, h);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.clearColor(0, 0, 0, 1);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniform3f(where.M0, world.m[0], world.m[1], world.m[2]);
    gl.uniform3f(where.M1, world.m[3], world.m[4], world.m[5]);
    gl.uniform2f(where.O, world.ox, world.oy);
    gl.uniform3f(where.V, world.V[0], world.V[1], world.V[2]);
    gl.uniform2f(where.view, W, H);
    gl.uniform1f(where.span, 4000);
    const draw = (mesh, R, t, id) => {
      gl.uniform3f(where.R0, R[0], R[1], R[2]);
      gl.uniform3f(where.R1, R[3], R[4], R[5]);
      gl.uniform3f(where.R2, R[6], R[7], R[8]);
      gl.uniform3f(where.T, t[0], t[1], t[2]);
      gl.uniform3fv(where.id, colour(id));
      gl.bindBuffer(gl.ARRAY_BUFFER, mesh.b);
      gl.enableVertexAttribArray(where.p);
      gl.vertexAttribPointer(where.p, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    };
    const eye = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    for (const item of statics) draw(item.mesh, eye, [0, 0, 0], STATIC + item.rank);
    for (const part of parts) {
      const cam = part.group >= 0 ? cams[part.group] : null;
      draw(part.mesh, cam ? cam.R : eye, cam ? cam.t : [0, 0, 0], part.index);
    }
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const ids = new Int32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((h - 1 - y) * w + x) * 4; ids[y * w + x] = pixels[i] + pixels[i + 1] * 256 - 1; }
    return ids;
  };
  const toId = (id) => "rgb(" + ((id + 1) & 255) + "," + (((id + 1) >> 8) & 255) + ",0)";
  const painterSvg = (reverse = false) => {
    const out = [];
    let rank = 0;
    for (const svg of svgs) {
      if (svg.dataset.live) {
        const nodes = [...svg.querySelectorAll("[data-p]")];
        if (reverse) nodes.reverse();
        for (const node of nodes) for (const el of node.querySelectorAll(".iso-fill, .tb-body")) out.push('<path d="' + el.getAttribute("d") + '" transform="' + matrixOf(el) + '" fill-rule="' + (el.getAttribute("fill-rule") || "nonzero") + '" fill="' + toId(Number(node.dataset.p)) + '"/>');
      } else {
        for (const el of svg.querySelectorAll(".iso-fill, .tb-body")) out.push('<path d="' + el.getAttribute("d") + '" transform="' + matrixOf(el) + '" fill-rule="' + (el.getAttribute("fill-rule") || "nonzero") + '" fill="' + toId(STATIC + rank) + '"/>');
        rank++;
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" width="' + w + '" height="' + h + '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="rgb(0,0,0)"/>' + out.join("") + "</svg>";
  };
  const pIds = async (reverse) => {
    const data = await decode(painterSvg(reverse), w, h);
    const ids = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) ids[i] = data[i * 4] + data[i * 4 + 1] * 256 - 1;
    return ids;
  };
  const nameOf = (id) => (id >= STATIC ? "static layer " + (id - STATIC) : id < 0 ? "empty" : V.parts[id].name);
  const joint = (a, b) => {
    const m = /^(.*):(\d+)$/;
    const x = a.match(m);
    const y = b.match(m);
    return Boolean(x && y && x[1] === y[1] && Math.abs(Number(x[2]) - Number(y[2])) <= 1);
  };
  async function check(state, { reverse = false } = {}) {
    await setState(state);
    // (fu/r2-verify) the z-buffer is rendered twice and a pixel counts only where both renders agree: the reference
    // (ANGLE GL, radeonsi, a shared GPU) now and then left one 4x4-px block of a hidden surface in front
    // (stage.platter.drum through stage.platter at a different bearing each sweep), and the check used to re-run a
    // failing state and waive any pair that did not repeat, which would waive a real 4 px fault the same way. Now the
    // verdict is exact for what the scene draws; the unstable pixels are reported, not waived pairs
    const Z = zIds();
    const Z2 = zIds();
    let unstable = 0;
    for (let i = 0; i < Z.length; i++) if (Z[i] !== Z2[i]) (unstable++, (Z[i] = -1));
    const P = await pIds(reverse);
    const tally = new Map();
    const interior = (ids, i, x, y) => {
      const v = ids[i];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; const yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h || ids[yy * w + xx] !== v) return false; }
      return true;
    };
    let total = 0;
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const p = P[i];
        const z = Z[i];
        if (p === z || p < 0 || z < 0) continue;
        if (!interior(P, i, x, y) || !interior(Z, i, x, y)) continue;
        const key = p + "|" + z;
        tally.set(key, (tally.get(key) || 0) + 1);
        total++;
      }
    const live = [];
    const layers = [];
    for (const [key, px] of tally) {
      const [p, z] = key.split("|").map(Number);
      const a = nameOf(p);
      const b = nameOf(z);
      if (p >= STATIC || z >= STATIC) layers.push({ painter: a, truth: b, px });
      else if (!joint(a, b)) live.push({ painter: a, truth: b, px });
    }
    live.sort((x, y) => y.px - x.px);
    layers.sort((x, y) => y.px - x.px);
    return { total, live, layers, unstable, stats: C.stats() };
  }
  async function footprint(state, name) {
    await setState(state);
    const index = V.parts.findIndex((part) => part.name === name);
    const Z = zIds();
    const P = await pIds(false);
    const boxOf = (ids) => {
      let n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let i = 0; i < ids.length; i++) if (ids[i] === index) { n++; const x = i % w, y = (i / w) | 0; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      return { px: n, box: n ? [x0 / SCALE, y0 / SCALE, x1 / SCALE, y1 / SCALE] : null };
    };
    return { painter: boxOf(P), truth: boxOf(Z) };
  }
  // the painter's fill-ID image of the state the page shows now (the settle check compares a first set with a repeat)
  const shown = async () => pIds(false);
  window.__tc.order = { check, footprint, shown, ids: () => pIds(false), zids: () => zIds(), nameOf };
  return { parts: parts.length, statics: statics.length, w, h };
})()`;

const POPS = String.raw`(() => {
  const { stage, svgs, W, H, css, theme, setState, decode } = window.__tc;
  const SCALE = 2;
  const w = W * SCALE;
  const h = H * SCALE;
  let hidden = null;
  const svgString = () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + H + '" width="' + w + '" height="' + h + '" class="iso iso-svg" data-theme="' + theme + '" style="--anatomy-paper:var(--anatomy-card)"><style>' + css + '</style><rect width="100%" height="100%" style="fill:var(--anatomy-card)"/>' + svgs.map((s) => '<g class="' + (s.getAttribute("class") || "") + '">' + s.innerHTML + "</g>").join("") + "</svg>";
  async function render(state, hide = null) {
    await setState(state);
    if (hide !== null) {
      hidden = stage.querySelector('[data-p="' + hide + '"]');
      if (hidden) hidden.setAttribute("display", "none");
    }
    const data = await decode(svgString(), w, h);
    if (hidden) {
      hidden.removeAttribute("display");
      hidden = null;
    }
    const lum = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) lum[i] = 0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2];
    return lum;
  }
  const erode = (mask) => {
    const out = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!mask[i]) continue;
        let all = 1;
        for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) if (!mask[i + dy * w + dx]) { all = 0; break; }
        out[i] = all;
      }
    return out;
  };
  const regionOf = (mask) => {
    let n = 0;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { n, box: n ? [x0 / SCALE, y0 / SCALE, x1 / SCALE, y1 / SCALE].map((v) => Math.round(v * 10) / 10) : null };
  };
  async function first(a, b, hide = null) {
    const A = await render(a);
    const B = await render(b, hide);
    let mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (Math.abs(A[i] - B[i]) >= 5) mask[i] = 1;
    mask = erode(erode(mask));
    last = { mask, frames: [a, b] };
    return regionOf(mask);
  }
  let last = null;
  let cache = null;
  async function second(a, b, c) {
    const A = cache && cache.x === a ? cache.lum : await render(a);
    const B = cache && cache.y === b ? cache.mid : await render(b);
    const Cl = await render(c);
    cache = { x: b, lum: B, y: c, mid: Cl };
    // (a380 review round 3) an antialiased edge moving 0.1° has a second difference of up to 60+ levels on its own
    // pixels: every edge in A, B or C, dilated 2 px, is left out, so a core is a tone that jumps on a face, not a
    // line that moves (every one of 3,599 steps flagged a core along the outlines)
    const edge = new Uint8Array(w * h);
    for (const L of [A, B, Cl])
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          if (Math.max(Math.abs(L[i + 1] - L[i - 1]), Math.abs(L[i + w] - L[i - w])) > 16) edge[i] = 1;
        }
    const nearEdge = new Uint8Array(w * h);
    for (let y = 2; y < h - 2; y++)
      for (let x = 2; x < w - 2; x++) {
        let hit = 0;
        for (let dy = -2; dy <= 2 && !hit; dy++) for (let dx = -2; dx <= 2; dx++) if (edge[(y + dy) * w + x + dx]) { hit = 1; break; }
        nearEdge[y * w + x] = hit;
      }
    let mask = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (nearEdge[i]) continue;
        const e = Math.abs(2 * B[i] - A[i] - Cl[i]);
        if (e <= 6) continue;
        let flat = true;
        for (let dy = -1; dy <= 1 && flat; dy++) for (let dx = -1; dx <= 1; dx++) if (Math.abs(B[i + dy * w + dx] - B[i]) > 4) { flat = false; break; }
        if (e > 56 || flat) mask[i] = 1;
      }
    mask = erode(mask);
    last = { mask, frames: [a, b, c] };
    const region = regionOf(mask);
    if (window.__tcDump && region.n >= 6 && !window.__tcDumped) {
      window.__tcDumped = true;
      const png = (lum, scaleBy = 1) => {
        const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
        const ctx = canvas.getContext("2d");
        const img = ctx.createImageData(w, h);
        for (let i = 0; i < w * h; i++) {
          const v = Math.max(0, Math.min(255, lum[i] * scaleBy));
          img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
          img.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        return canvas.toDataURL("image/png").split(",")[1];
      };
      const diff = new Float32Array(w * h);
      for (let i = 0; i < w * h; i++) diff[i] = Math.abs(2 * B[i] - A[i] - Cl[i]);
      window.__tcDumped = { a: png(A), b: png(B), c: png(Cl), e: png(diff, 4) };
    }
    return region;
  }
  // (follow-up item 46) what lies under the last surviving region: in each frame, the painter's top fill (part IDs) and
  // the z-buffer's (the truth) over the region's pixels, and the mechanism that follows from them:
  //   order swap      the painter's top part changed between the frames, the truth's did not;
  //   visibility      the truth's top part changed too (a part or face arrived or left in one step);
  //   tone or line    the same part on top in both: its tone, a band or a line changed on it.
  const STATIC_ID = 30000;
  const OWNERS = [[/^(nose|fus|door|skin)\./, "fuselage"], [/^(wings|eng|tail)\./, "wings"], [/^(nlg|wlg|blg)\./, "gear"], [/^(cabin|cockpit)\./, "interiors"], [/^(stage|light)\./, "lights"], [/^tug\./, "interaction"]]; // fu/r1-verify: the pushback tug (parts/tug.mjs)
  const ownerOf = (name) => (OWNERS.find(([re]) => re.test(name)) || [null, name.startsWith("static") ? "lights (stage layer)" : "?"])[1];
  async function diagnose() {
    if (!last || !window.__tc.order) return null;
    const O = window.__tc.order;
    const idx = [];
    for (let i = 0; i < last.mask.length; i++) if (last.mask[i]) idx.push(i);
    if (!idx.length) return null;
    const per = [];
    // each frame's roles of the parts under the region: which role was born or died (its path empty in one frame),
    // which changed tone class or opacity
    const rolesOf = (id) => {
      const el = id >= 0 ? stage.querySelector('[data-p="' + id + '"]') : null;
      const out = {};
      if (el) for (const r of el.querySelectorAll("[data-r]")) {
        const attrs = [...r.attributes].filter((a) => a.name !== "d" && a.name !== "transform" && a.name !== "cx" && a.name !== "cy").map((a) => a.name + "=" + a.value).join(" ");
        out[r.getAttribute("data-r")] = { on: (r.getAttribute("d") || "").length > 0 || r.tagName !== "path", d: r.getAttribute("d") || "", attrs, style: r.getAttribute("style") || "", op: r.closest("[style*=opacity]") ? r.closest("[style*=opacity]").style.opacity : "" };
      }
      return out;
    };
    const roleFrames = [];
    for (const state of last.frames) {
      await setState(state);
      const P = await O.ids();
      const Z = O.zids();
      const tally = (ids) => { const m = new Map(); for (const i of idx) m.set(ids[i], (m.get(ids[i]) || 0) + 1); return [...m].sort((x, y) => y[1] - x[1]); };
      const t = { P: tally(P), Z: tally(Z) };
      per.push(t);
      const ids = new Set([...t.P.slice(0, 2), ...t.Z.slice(0, 2)].map(([id]) => id).filter((id) => id >= 0 && id < STATIC_ID));
      roleFrames.push(Object.fromEntries([...ids].map((id) => [id, rolesOf(id)])));
    }
    const roleNotes = [];
    const moved = [];
    for (const id of new Set(roleFrames.flatMap((f) => Object.keys(f)))) {
      const fa = roleFrames[0][id] || {};
      const fb = roleFrames[1][id] || {};
      // roles whose path changed by more than a 0.02° drift: the subpath count or the length of the path text
      for (const role of Object.keys(fa)) if (fb[role] && fa[role].on && fb[role].on && fa[role].d !== fb[role].d) {
        const na = (fa[role].d.match(/M/g) || []).length, nb = (fb[role].d.match(/M/g) || []).length;
        const dl = Math.abs(fa[role].d.length - fb[role].d.length);
        if (na !== nb || dl > 12) moved.push(window.__tc.order.nameOf(+id) + " " + role + (na !== nb ? " " + na + "→" + nb + " subpaths" : " " + dl + " chars"));
      }
    }
    for (const id of new Set(roleFrames.flatMap((f) => Object.keys(f)))) {
      const fa = roleFrames[0][id] || {};
      const fb = roleFrames[1][id] || {};
      for (const role of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
        const x = fa[role], y = fb[role];
        if (!x || !y) continue;
        if (x.on !== y.on) roleNotes.push(window.__tc.order.nameOf(+id) + " " + role + (y.on ? " born" : " died"));
        else if (x.on && x.attrs !== y.attrs) roleNotes.push(window.__tc.order.nameOf(+id) + " " + role + " " + x.attrs.replace(/data-r=\S+ ?/, "") + " → " + y.attrs.replace(/data-r=\S+ ?/, ""));
        else if (x.on && (x.style !== y.style || x.op !== y.op)) roleNotes.push(window.__tc.order.nameOf(+id) + " " + role + " opacity " + (x.op || x.style) + " → " + (y.op || y.style));
      }
    }
    const top = (list) => (list.length ? list[0][0] : -1);
    const name = (id) => O.nameOf(id);
    const [a, b] = [per[0], per[per.length > 2 ? 1 : 1]];
    const c = per.length > 2 ? per[2] : null;
    let mechanism;
    let pair;
    const pa = top(a.P), pb = top(b.P), za = top(a.Z), zb = top(b.Z);
    if (pa !== pb && za === zb) {
      mechanism = "order swap";
      pair = [name(pa), name(pb)];
      mechanism += pa === za ? " (the second frame is out of order)" : pb === zb ? " (the first frame is out of order)" : "";
    } else if (pa !== pb) {
      mechanism = "visibility";
      pair = [name(pa), name(pb)];
    } else {
      mechanism = c && top(c.P) !== pb ? "order swap in the middle frame" : "tone or line";
      const second = a.P[1] ? name(a.P[1][0]) : b.P[1] ? name(b.P[1][0]) : null;
      pair = second ? [name(pa), second] : [name(pa)];
    }
    const show = (list) => list.slice(0, 3).map(([id, n]) => name(id) + " " + n).join(", ");
    if (mechanism === "tone or line" && !roleNotes.length && moved.length) roleNotes.push(...moved.map((m) => m + " (path jumped)"));
    if (mechanism === "tone or line" && roleNotes.length) mechanism = "role change: " + roleNotes.slice(0, 4).join("; ");
    else if (roleNotes.length) mechanism += " (roles: " + roleNotes.slice(0, 3).join("; ") + ")";
    return { mechanism, pair, owner: [...new Set(pair.map(ownerOf))].join(" / "), roles: roleNotes, frames: per.map((f) => ({ painter: show(f.P), truth: show(f.Z) })) };
  }
  // the region at 8x of 1x px: each frame rendered as the check renders it (2x), its pixels magnified 4x (nearest), side
  // by side, then the difference ×4 (grey) and the surviving pixels in magenta (a crop rendered at 8x rasterises
  // differently and showed no difference at all)
  async function zoom(frames, box, k = 4) {
    const m = 6;
    const x0 = Math.max(0, Math.floor((box[0] - m) * SCALE)), y0 = Math.max(0, Math.floor((box[1] - m) * SCALE));
    const x1 = Math.min(w, Math.ceil((box[2] + m) * SCALE)), y1 = Math.min(h, Math.ceil((box[3] + m) * SCALE));
    const cw = x1 - x0, ch = y1 - y0;
    const crops = [];
    for (const state of frames) {
      await setState(state);
      const data = await decode(svgString(), w, h);
      const c = new Uint8ClampedArray(cw * ch * 4);
      for (let y = 0; y < ch; y++) c.set(data.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x1) * 4), y * cw * 4);
      crops.push(c);
    }
    const n = crops.length;
    const L = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const diff = new Uint8ClampedArray(cw * ch * 4);
    for (let i = 0; i < cw * ch * 4; i += 4) { const e = n > 2 ? Math.abs(2 * L(crops[1], i) - L(crops[0], i) - L(crops[2], i)) : Math.abs(L(crops[1], i) - L(crops[0], i)); diff[i] = diff[i + 1] = diff[i + 2] = Math.min(255, e * 4); diff[i + 3] = 255; }
    if (last && last.mask) for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (last.mask[(y0 + y) * w + x0 + x]) { const i = (y * cw + x) * 4; diff[i] = 255; diff[i + 1] = 0; diff[i + 2] = 170; }
    const panels = [...crops, diff];
    const small = Object.assign(document.createElement("canvas"), { width: cw, height: ch });
    const sctx = small.getContext("2d");
    const canvas = Object.assign(document.createElement("canvas"), { width: (cw * k + 4) * panels.length, height: ch * k });
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#ff00aa";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    panels.forEach((data, j) => { const img = sctx.createImageData(cw, ch); img.data.set(data); sctx.putImageData(img, 0, 0); ctx.drawImage(small, j * (cw * k + 4), 0, cw * k, ch * k); });
    return canvas.toDataURL("image/png").split(",")[1];
  }
  window.__tc.pops = { first, second, render, diagnose, zoom, lastFrames: () => last && last.frames };
  return { w, h };
})()`;

// (a380 follow-up, items 48 and 49) paths of states: 470,000 states at 0.02 per state cannot be rendered whole (1.1 s
// a state). Along a path only the parts whose group moved, or that the painter re-ordered, change; every other pixel
// is the previous state's. INCR keeps the previous state's full-frame image (pops) or part-ID buffers (order) and
// re-renders only the region those parts cover in either state (their screen boxes, 4 units of margin for strokes),
// with the nodes that touch the region. The result is exact: a node outside the region draws nothing in it, and a
// crop on the 2x pixel grid rasterises as the full frame does (--incremental-check compares with full renders).
const INCR = String.raw`(() => {
  const { svgs, C, W, H, css, theme, setState, matrixOf, decode } = window.__tc;
  const SCALE = 2;
  const w = W * SCALE;
  const h = H * SCALE;
  const MARGIN = 4;
  const STATIC = 30000;
  const scene = C.scene();
  const live = svgs.filter((s) => s.dataset.live);
  const node = [];
  const layerOf = [];
  for (const svg of live) for (const el of svg.querySelectorAll("[data-p]")) { node[Number(el.dataset.p)] = el; layerOf[Number(el.dataset.p)] = svg; }
  const groupOf = scene.runs.map((run) => run.group);
  const byName = new Map(scene.runs.map((run) => [run.name, run.index]));
  const inv = new Map(live.map((svg) => [svg, svg.getScreenCTM().inverse()]));
  const box = [];
  // (a380 review round 1, fu/r1-verify) a part with clipped content (the platter's runway, taxiway and field sets run
  // kilometres past its rim under clip-path="url(#a3-dk-clip)") has a client box that takes in all of it: on the push
  // clip its far ends swung 3-28 px a step while the drawn rim moved 0.13 px. Its box is the union of its unclipped
  // children's boxes and each clipped group's box cut to its clip's region (the clip path's geometry in the group's user
  // space, userSpaceOnUse), so the changed region and the outline travel follow what is drawn
  const withClip = new Set();
  for (let p = 0; p < node.length; p++) if (node[p] && node[p].querySelector("[clip-path]")) withClip.add(p);
  const rectOf = (el) => { const r = el.getBoundingClientRect(); return r.width || r.height ? [r.left, r.top, r.right, r.bottom] : null; };
  const unite = (a, b) => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  const clipRegion = (el) => {
    const id = /url\(["']?#([^"')]+)/.exec(el.getAttribute("clip-path") || "");
    const cp = id && document.getElementById(id[1]);
    if (!cp || (cp.getAttribute("clipPathUnits") || "userSpaceOnUse") !== "userSpaceOnUse") return null;
    const m = el.getScreenCTM();
    let out = null;
    for (const shape of cp.children) {
      if (typeof shape.getBBox !== "function") continue;
      const b = shape.getBBox();
      const t = shape.transform && shape.transform.baseVal.consolidate() ? m.multiply(shape.transform.baseVal.consolidate().matrix) : m;
      const xs = [], ys = [];
      for (const [x, y] of [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]) { xs.push(t.a * x + t.c * y + t.e); ys.push(t.b * x + t.d * y + t.f); }
      out = unite(out, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
    }
    return out;
  };
  const drawnRect = (el) => {
    if (el.hasAttribute("clip-path")) {
      const r = rectOf(el);
      const c = clipRegion(el);
      if (!r || !c) return r;
      const x = [Math.max(r[0], c[0]), Math.max(r[1], c[1]), Math.min(r[2], c[2]), Math.min(r[3], c[3])];
      return x[2] > x[0] && x[3] > x[1] ? x : null;
    }
    if (!el.querySelector("[clip-path]")) return rectOf(el);
    let out = null;
    for (const child of el.children) out = unite(out, drawnRect(child));
    return out;
  };
  const measure = (p) => {
    const el = node[p];
    if (!el) return null;
    let r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    if (withClip.has(p)) {
      const d = drawnRect(el);
      if (!d) return null;
      r = { left: d[0], top: d[1], right: d[2], bottom: d[3] };
    }
    const m = inv.get(layerOf[p]);
    const xs = [];
    const ys = [];
    for (const [x, y] of [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]]) { xs.push(m.a * x + m.c * y + m.e); ys.push(m.b * x + m.d * y + m.f); }
    return [Math.min(...xs) - MARGIN, Math.min(...ys) - MARGIN, Math.max(...xs) + MARGIN, Math.max(...ys) + MARGIN];
  };
  const measureAll = () => { for (let p = 0; p < node.length; p++) box[p] = measure(p); };
  const samePose = (a, b) => { if (!a || !b) return a === b; for (let i = 0; i < 9; i++) if (a.R[i] !== b.R[i]) return false; return a.t[0] === b.t[0] && a.t[1] === b.t[1] && a.t[2] === b.t[2]; };
  let poses = null;
  // set a state; the region (2x pixel rect [x0, y0, x1, y1), exclusive) its changes cover, or null
  async function step(state) {
    C.events();
    await setState(state);
    const now = C.cams().poses.slice();
    const moved = new Set();
    if (poses) for (let g = 0; g < now.length; g++) if (!samePose(poses[g], now[g])) for (let p = 0; p < groupOf.length; p++) if (groupOf[p] === g) moved.add(p);
    for (const change of C.events()) for (const name of change.moved) if (byName.has(name)) moved.add(byName.get(name));
    // (fu/r1-verify) a part whose vary alpha the state changed (the tug fading in) changed too, though it did not move
    for (const cls of window.__tc.varyChanged) for (const svg of live) for (const el of svg.querySelectorAll("." + cls)) { const host = el.closest("[data-p]"); if (host) moved.add(Number(host.dataset.p)); }
    window.__tc.varyChanged.clear();
    poses = now;
    let r = null;
    let motion = 0; // the largest shift of a moved part's screen box, 1x px: how far its outline travelled
    let motionPart = -1; // (fu/r1-verify) the part that travelled it
    // a part parked 10 km up (a free group's sync rule) has a box far off the stage: it draws nothing there
    const onStage = (b) => b && b[2] > 0 && b[0] < W && b[3] > 0 && b[1] < H;
    for (const p of moved) {
      const before = box[p];
      const after = (box[p] = measure(p));
      // (fu/r1-verify) the travel of the box's edges inside the stage: a part's box takes in its clipped children too
      // (the platter's runway and field sets run kilometres past its rim under a clip path), and an edge beyond the
      // stage draws nothing. On the push clip the platter's box moved 28 px a 0.2° pair at its far ends, off the stage
      if (onStage(before) && onStage(after)) {
        const a = [Math.max(0, before[0]), Math.max(0, before[1]), Math.min(W, before[2]), Math.min(H, before[3])];
        const b = [Math.max(0, after[0]), Math.max(0, after[1]), Math.min(W, after[2]), Math.min(H, after[3])];
        for (let k = 0; k < 4; k++)
          if (Math.abs(b[k] - a[k]) > motion) {
            motion = Math.abs(b[k] - a[k]);
            motionPart = p;
          }
      }
      for (const b of [before, after]) if (onStage(b)) r = r ? [Math.min(r[0], b[0]), Math.min(r[1], b[1]), Math.max(r[2], b[2]), Math.max(r[3], b[3])] : b.slice();
    }
    const motionName = motionPart < 0 ? null : window.__isoVerify ? window.__isoVerify.parts[motionPart].name : String(motionPart);
    if (!r) return { region: null, moved: moved.size, motion, motionName };
    const x0 = Math.max(0, Math.floor(r[0] * SCALE));
    const y0 = Math.max(0, Math.floor(r[1] * SCALE));
    const x1 = Math.min(w, Math.ceil(r[2] * SCALE));
    const y1 = Math.min(h, Math.ceil(r[3] * SCALE));
    return { region: x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null, moved: moved.size, motion, motionName };
  }
  const meets = (b, R) => !b || (b[2] * SCALE > R[0] && b[0] * SCALE < R[2] && b[3] * SCALE > R[1] && b[1] * SCALE < R[3]);
  const openOf = (el) => { const c = el.cloneNode(false).outerHTML; return c.slice(0, c.lastIndexOf("</")); };
  // the stage as pops renders it, cut to region R (2x pixels), with only the nodes that touch it. The card and the
  // blurred halo under the figure are rendered once, whole: a blur cut at a crop's edge loses the pixels beyond it
  // (8,224 px differed by up to 26 levels). Everything else is rendered on a transparent crop and composited over them.
  const HALO = ".iso-halo";
  const header = (vb, pw, ph) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb.join(" ") + '" width="' + pw + '" height="' + ph + '" class="iso iso-svg" data-theme="' + theme + '" style="--anatomy-paper:var(--anatomy-card)"><style>' + css + "</style>";
  const statics = svgs.filter((svg) => !svg.dataset.live).map((svg) => {
    const clone = svg.cloneNode(true);
    const halos = [...clone.querySelectorAll(HALO)].map((el) => (el.remove(), el.outerHTML));
    return { cls: svg.getAttribute("class") || "", rest: clone.innerHTML, halos: halos.join("") };
  });
  let base = null;
  async function baseRender() {
    const svg = header([0, 0, W, H], w, h) + '<rect width="100%" height="100%" style="fill:var(--anatomy-card)"/>' + statics.map((x) => '<g class="' + x.cls + '">' + x.halos + "</g>").join("") + "</svg>";
    base = await decode(svg, w, h);
  }
  async function lum(R) {
    if (!base) await baseRender();
    const [x0, y0, x1, y1] = R;
    const cw = x1 - x0;
    const vb = [x0 / SCALE, y0 / SCALE, cw / SCALE, (y1 - y0) / SCALE];
    const out = statics.map((x) => '<g class="' + x.cls + '">' + x.rest + "</g>");
    for (const svg of live) {
      const container = svg.querySelector(".iso-parts");
      let inner = "";
      for (const el of container.children) if (meets(box[Number(el.dataset.p)], R)) inner += el.outerHTML;
      out.push('<g class="' + (svg.getAttribute("class") || "") + '">' + openOf(container) + inner + "</g></g>");
    }
    // a viewBox cut to the crop (the page's media queries touch only the legend and the plate, not the drawing)
    const data = await decode(header(vb, cw, y1 - y0) + out.join("") + "</svg>", cw, y1 - y0);
    const L = new Float32Array(cw * (y1 - y0));
    for (let y = 0; y < y1 - y0; y++)
      for (let x = 0; x < cw; x++) {
        const i = y * cw + x;
        const j = ((y0 + y) * w + x0 + x) * 4;
        const a = data[i * 4 + 3] / 255;
        const r = data[i * 4] * a + base[j] * (1 - a);
        const g = data[i * 4 + 1] * a + base[j + 1] * (1 - a);
        const bl = data[i * 4 + 2] * a + base[j + 2] * (1 - a);
        L[i] = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      }
    return L;
  }
  const FULL = [0, 0, w, h];
  let image = null;
  // pops along a path: the first difference of the previous state and this one, in the changed region only
  const pops = {
    async start(state) {
      poses = null;
      await setState(state);
      window.__tc.varyChanged.clear();
      poses = C.cams().poses.slice();
      measureAll();
      image = await lum(FULL);
      return { w, h };
    },
    async next(state, hide = null) {
      let { region, moved, motion, motionName } = await step(state);
      // the control: one part hidden for this step (its box joins the region)
      const hidden = hide === null ? null : node[hide];
      if (hidden) {
        const b = box[hide];
        const R = [Math.floor(b[0] * SCALE), Math.floor(b[1] * SCALE), Math.ceil(b[2] * SCALE), Math.ceil(b[3] * SCALE)].map((v, k) => Math.max(0, Math.min(k % 2 ? h : w, v)));
        region = region ? [Math.min(region[0], R[0]), Math.min(region[1], R[1]), Math.max(region[2], R[2]), Math.max(region[3], R[3])] : R;
        hidden.setAttribute("display", "none");
      }
      if (!region) return { n: 0, box: null, area: 0, moved, motion, motionName };
      const [x0, y0, x1, y1] = region;
      const cw = x1 - x0;
      const ch = y1 - y0;
      const B = await lum(region);
      if (hidden) hidden.removeAttribute("display");
      let mask = new Uint8Array(cw * ch);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const i = (y0 + y) * w + x0 + x; if (Math.abs(image[i] - B[y * cw + x]) >= 5) mask[y * cw + x] = 1; image[i] = B[y * cw + x]; }
      // two erosions; outside the region nothing changed (mask 0), so the region's border erodes as the full frame's
      const erode = (m) => {
        const o = new Uint8Array(cw * ch);
        for (let y = 1; y < ch - 1; y++)
          for (let x = 1; x < cw - 1; x++) {
            const gy = y0 + y;
            const gx = x0 + x;
            if (gy < 1 || gx < 1 || gy >= h - 1 || gx >= w - 1) continue;
            const i = y * cw + x;
            if (!m[i]) continue;
            let all = 1;
            for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) if (!m[i + dy * cw + dx]) { all = 0; break; }
            o[i] = all;
          }
        return o;
      };
      mask = erode(erode(mask));
      let n = 0, bx0 = w, by0 = h, bx1 = -1, by1 = -1;
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (mask[y * cw + x]) { n++; bx0 = Math.min(bx0, x0 + x); by0 = Math.min(by0, y0 + y); bx1 = Math.max(bx1, x0 + x); by1 = Math.max(by1, y0 + y); }
      return { n, box: n ? [bx0 / SCALE, by0 / SCALE, bx1 / SCALE, by1 / SCALE].map((v) => Math.round(v * 10) / 10) : null, area: cw * ch, moved, motion, motionName };
    },
    // the composite against the one-pass render pops uses for turns (window.__tc.pops.render), once
    async onePass(state) {
      const one = await window.__tc.pops.render(state);
      const F = await lum(FULL);
      let n = 0, worst = 0;
      for (let i = 0; i < F.length; i++) { const d = Math.abs(F[i] - one[i]); if (d >= 2) n++; if (d > worst) worst = d; }
      return { n, worst: Math.round(worst * 10) / 10 };
    },
    // the incremental image against a full render of the same state (the exactness control)
    // A crop rasterises long edges' antialiasing a little differently from the full frame (1 px speckle along them, up
    // to 26 levels): what matters is what the first difference sees, pixels 5+ levels apart that survive two erosions
    async verify() {
      const F = await lum(FULL);
      let n = 0, worst = 0;
      let mask = new Uint8Array(w * h);
      for (let i = 0; i < F.length; i++) { const d = Math.abs(F[i] - image[i]); if (d >= 1) n++; if (d > worst) worst = d; if (d >= 5) mask[i] = 1; }
      const erode = (m) => { const o = new Uint8Array(w * h); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (!m[i]) continue; let all = 1; for (let dy = -1; dy <= 1 && all; dy++) for (let dx = -1; dx <= 1; dx++) if (!m[i + dy * w + dx]) { all = 0; break; } o[i] = all; } return o; };
      mask = erode(erode(mask));
      let survive = 0;
      for (let i = 0; i < mask.length; i++) survive += mask[i];
      return { n, worst: Math.round(worst * 10) / 10, survive };
    },
  };
  pops.run = async (list) => { const out = []; for (const state of list) out.push(await pops.next(state)); return out; };
  window.__tc.incr = { pops, step, measureAll, box };
  return { parts: node.length };
})()`;

const PERF = String.raw`(async (frames, step, group) => {
  const { C, stage } = window.__tc;
  const A = window.__a380;
  const name = group || C.scene().groups.find((g) => g.kind === "turn")?.name;
  // (a380 review round 1, fu/r1-verify) the turn goes through the page when it has the hook: A3.tick(turn) sets pv.turn
  // and runs one page tick now (the page's own set() with every free group, deck, lights, GL frame, vary and paint), as
  // a drag's frame does. The tool's own C.set (the old loop, kept for figures without the hook) set the turntable only:
  // the page's microtask tick then set again with the cabin groups, two set() calls a frame, and the tool's own set
  // ran on a pose where the cabin lagged a step
  const through = Boolean(A && typeof A.tick === "function" && A.pv);
  const base = through ? A.pv.turn : C.values[name] || 0;
  const ms = [];
  const writes = [];
  const moved = [];
  const times = [];
  const perFrame = [];
  let calls = 0;
  const set0 = C.set;
  // every set() in the loop, the page's or the tool's, timed and counted (the controller is the page's own)
  C.set = function (...args) {
    const t0 = performance.now();
    const s = set0.apply(this, args);
    ms.push(performance.now() - t0);
    calls++;
    if (s) {
      writes.push(s.writes);
      moved.push(s.moved);
    }
    return s;
  };
  try {
    await new Promise((done) => {
      let i = 0;
      let last = 0;
      const tick = (now) => {
        times.push(now);
        if (i) perFrame.push(calls - last); // the set() calls since the last frame's turn, wherever they came from
        last = calls;
        if (i >= frames) return done();
        // the next frame first, so this callback runs before the page's own in each frame (A3.tick cancels that)
        requestAnimationFrame(tick);
        if (through) A.tick(base + i * step);
        else C.set({ [name]: base + i * step });
        i++;
      };
      requestAnimationFrame(tick);
    });
  } finally {
    C.set = set0;
  }
  const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  const sorted = (list) => list.slice().sort((a, b) => a - b);
  const median = (list) => (list.length ? sorted(list)[Math.floor(list.length / 2)] : 0);
  const p95 = (list) => (list.length ? sorted(list)[Math.floor(list.length * 0.95)] : 0);
  const live = [...stage.querySelectorAll("svg[data-live] *")].length;
  return { frames, through, setMedian: median(ms), setP95: p95(ms), setsPerFrame: median(perFrame), setsMax: Math.max(0, ...perFrame), writes: median(writes), moved: median(moved), gapMedian: median(gaps), gapP95: p95(gaps), live };
})`;

// (fu/r1-verify) --perf --state: put the page in a state through its own controls, the model running, then hold it.
// Returns a line describing the state reached. Keys go to the stage through CDP (as a reader's do); Inspect views through
// A3.inspect.step (which wakes the loop).
async function perfState(page, state) {
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const read = () => page.evaluate(`(() => { const A = window.__a380, pv = A.pv, s = A.state || {}; const d = s.doors ? Object.values(s.doors) : []; const cur = document.querySelector('[data-phase][aria-current="step"]'); return { cabin: +(+pv.cabin || 0).toFixed(3), cabinTarget: pv.cabinTarget, doorsOpen: d.filter((x) => x > 0.99).length, doorsShut: d.filter((x) => x < 0.01).length, doors: d.length, inspect: pv.inspect || null, phase: cur ? cur.dataset.phase : null, seek: Boolean(pv.seek), speed: +(+s.speed || 0).toFixed(1), paused: pv.paused, mode: pv.mode, zoom: +(+pv.zoom || 1).toFixed(4), deckPlan: +(+pv.deckPlan || 0).toFixed(3), turn: +(+pv.turn || 0).toFixed(2) }; })()`);
  const until = async (test, ms) => {
    for (let waited = 0; waited < ms; waited += 250) {
      const r = await read();
      if (test(r)) return r;
      await sleep(250);
    }
    return null;
  };
  const KEYS = { c: [67, "KeyC"], d: [68, "KeyD"], 5: [53, "Digit5"] };
  // a reader's input arms the page's 30 s idle resume (the tour takes over and seeks on): every input here is followed
  // by the tool's own hold (window.__isoTurn.set: hold("tool") disarms it), or a state measured more than 30 s after
  // its last key drifted on into the next phase
  const toolHold = () => page.evaluate("(window.__isoTurn.set(window.__isoTurn.controller.values.air), 0)");
  const key = async (k) => {
    await page.evaluate(`(document.querySelector(".a3-stage") || document.querySelector(".iso-stage")).focus(), 0`);
    const [vk, code] = KEYS[k];
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, text: k });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
    await toolHold();
  };
  const run = async (on) => page.evaluate(`(window.__a380.pv.paused = ${!on}, window.__a380.tick(), 0)`);
  const leave = async () => {
    if ((await read()).inspect) {
      await page.evaluate("window.__a380.inspect.leave()");
      await toolHold();
      await sleep(3000);
    }
  };
  const cutaway = async (open) => {
    if ((await read()).cabinTarget > 0.5 !== open) await key("c");
    return until((r) => (open ? r.cabin >= 0.999 : r.cabin <= 0.001), 20000);
  };
  // (fu/f4-verify) the stand: under load the page's own tour ran on into PUSHBACK while the tool waited for WebGL (the
  // GATE dwell is 14 s; first light took 14-23 s on a loaded machine), so rest, cutaway and cutawayDoors were measured
  // in whichever phase the tour had reached. Seek back to GATE through the page's own phase control, then hold
  const toGate = async () => {
    const now = await read();
    if (now.phase === "GATE" && !now.seek) return;
    await page.evaluate(`(() => { const b = document.querySelector('[data-phase="GATE"]'); if (b) b.click(); return 0; })()`);
    await toolHold();
    await until((x) => x.phase === "GATE" && !x.seek, 30000);
    await toolHold();
  };
  const [kind, arg] = state.split(":");
  let r = null;
  await run(true);
  if (kind === "rest") {
    await leave();
    await toGate();
    r = await read();
  } else if (kind === "cutaway") {
    await leave();
    await toGate();
    r = await cutaway(true);
  } else if (kind === "cutawayDoors") {
    await leave();
    await toGate();
    await cutaway(true);
    // D toggles: any door open closes them all, none open opens all 19 (at the stand)
    let now = await read();
    if (now.doorsOpen !== now.doors && now.doorsShut !== now.doors) {
      await key("d");
      now = (await until((x) => x.doorsShut === x.doors, 30000)) ?? now;
    }
    if (now.doorsOpen !== now.doors) {
      await key("d");
      await until((x) => x.doorsOpen === x.doors, 30000);
    }
    r = await read();
  } else if (kind === "inspect") {
    await page.evaluate(`window.__a380.inspect.step(0, ${JSON.stringify(arg)})`);
    await toolHold();
    // (fu/f4-verify) the view's ease (zoom, centre, bearing), its cutaway and the Deck plan's fade, until they settle:
    // the view named, and zoom, turn, cutaway and plan unchanged over half a second (at least 1.5 s, at most 30 s). A
    // fixed 4.5 s held the Deck plan with its cutaway still opening on a loaded machine
    await sleep(1500);
    let prev = await read();
    const key = (x) => `${x.inspect}|${x.zoom}|${x.turn}|${x.cabin}|${x.deckPlan}`;
    for (let waited = 1500; waited < 30000; waited += 500) {
      await sleep(500);
      const now = await read();
      if (now.inspect === arg && key(now) === key(prev) && Math.abs(now.cabin - (now.cabinTarget > 0.5 ? 1 : 0)) < 0.002) break;
      prev = now;
    }
    r = await read();
  } else if (kind === "takeoff") {
    await leave();
    await cutaway(true);
    await key("5");
    r = await until((x) => x.phase === "TAKEOFF" && !x.seek && x.speed > 30, 30000);
  } else throw new Error(`--state ${state}: rest, cutaway, cutawayDoors, inspect:<view id>, takeoff or all`);
  // held: the model paused (no clock-driven fades) except on the take-off roll, which runs (engines at power, lights)
  await toolHold();
  await run(kind === "takeoff");
  await sleep(1000);
  r = r ?? (await read());
  return { ok: Boolean(r), text: `${r ? "" : "NOT REACHED · "}phase ${r?.phase ?? "?"} · cutaway ${r?.cabin ?? "?"} · doors open ${r?.doorsOpen ?? "?"}/${r?.doors ?? "?"} · view ${r?.inspect ?? "none"} · ${r?.speed ?? "?"} kt · model ${kind === "takeoff" ? "running" : "paused"} · ${r?.mode ?? "?"}` };
}

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
    usage();
    process.exit(argv.length ? 0 : 1);
  }
  const value = (flag, fallback) => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : fallback;
  };
  const target = argv[0];
  let failed = 0;
  if (target.endsWith(".mjs")) {
    const F = await import("./turn-fidelity.mjs");
    // (fu/r2-verify) the build is imported in this process and writes its page: give it a page of its own, outside the
    // repository, unless the caller named one (the documented `turn-check a380/build.mjs --fidelity` had rebuilt the
    // shipping page a380/a380.html from whatever tree it ran on)
    if (!process.argv.some((a) => a.startsWith("--out="))) {
      const own = join(tmpdir(), `turn-check-fidelity-${process.pid}.html`);
      process.argv.push(`--out=${own}`);
      console.log(`fidelity: the imported build writes its page to ${own} (pass --out=<file> to choose)`);
    }
    const { T, P } = await import(pathToFileURL(resolve(target)).href);
    const angles = (value("--angles", "") || Array.from({ length: 12 }, (_, i) => 7 + i * 30).join(",")).split(",").map(Number);
    // the control: a prism drawn 2° off must fail. Any prism under a turn root qualifies (the A380's ride air >
    // lift > pitch, so none sits on the turn group itself and the control never ran)
    const rootKind = (g) => {
      while (g && g.parent) g = g.parent;
      return g ? g.kind : null;
    };
    const plant = T.parts.find((part) => part.kind === "prism" && part.group && part.group.kind === "turn") ?? T.parts.find((part) => part.kind === "prism" && part.group && part.group.kind !== "free" && rootKind(part.group) === "turn");
    if (plant) {
      const control = F.identity(T, P, angles.slice(0, 2), { plant: plant.name });
      console.log(`control (${plant.name} drawn 2° off): ${control.pass ? "did not fail: the check is broken" : "fails as it should"}`);
      if (control.pass) failed++;
    }
    // (follow-up item 47) the hulls in posed states, with the free groups (cabin, cockpit) at their synced pose with
    // the cutaway open; and two more controls: a hull's largest sub-band one step off, a round's largest band one step
    // off, each must fail
    const B = await import(pathToFileURL(resolve(target)).href);
    let hullStates = null;
    if (B.follow && B.W && B.W.groundChannels) {
      const ground = (extra) => B.follow(B.W.groundChannels(extra));
      const doors = Object.fromEntries(Object.keys(B.W.groundChannels()).filter((k) => k.startsWith("door.")).map((k) => [k, 1]));
      const full = B.W.CONF_ANGLES && B.W.CONF_ANGLES.FULL ? { slat: B.W.CONF_ANGLES.FULL[0], flap: B.W.CONF_ANGLES.FULL[1], droop: B.W.CONF_ANGLES.FULL[2] } : {};
      const restOf = (theta) => Object.fromEntries(T.groups.map((g) => [g.name, g.kind === "turn" && !g.parent ? theta : g.kind === "free" ? null : 0]));
      hullStates = [
        { label: "rest", values: restOf },
        { label: "cutaway open", values: (turn) => ground({ turn, cabin: 1 }) },
        { label: "doors open", values: (turn) => ground({ turn, ...doors }) },
        { label: "flaps FULL", values: (turn) => ground({ turn, ...full }) },
        { label: "gear 0.5", values: (turn) => ground({ turn, lift: 60, pitch: 8, trim: 1, gear: 0.5, gearDoors: 1 }) },
        { label: "spoilers 50", values: (turn) => ground({ turn, spoiler: 50, spoiler1: 50 }) },
      ];
      const smooth = T.parts.find((part) => part.kind === "hull" && /^fus\./.test(part.name) && part.spec.faces.some((f) => f.s)) ?? T.parts.find((part) => part.kind === "hull" && part.spec.faces.some((f) => f.s));
      if (smooth) {
        const control = F.hulls(T, P, angles.slice(0, 2), { states: [hullStates[1]], plant: { part: smooth.name }, source: "packed" });
        console.log(`hull control (${smooth.name}'s largest sub-band drawn one step off): ${control.pass ? "did not fail: the check is broken" : "fails as it should"}`);
        if (control.pass) failed++;
      }
      const rounds = T.parts.filter((part) => part.kind === "round" && part.group && part.group.kind !== "free" && rootKind(part.group) === "turn");
      const round = rounds.find((part) => /fancowl/.test(part.name)) ?? rounds[0];
      if (round) {
        const only = { test: (name) => name === round.name };
        const clean = F.rounds(T, P, angles.slice(0, 2), { only });
        const control = F.rounds(T, P, angles.slice(0, 2), { only, plant: round.name });
        console.log(`round control (${round.name}'s largest band drawn one step off): ${control.pass ? "did not fail: the check is broken" : `fails as it should (unplanted: ${clean.pass ? "passes" : "fails"})`}`);
        if (control.pass || !clean.pass) failed++;
      }
    }
    // the hulls against the page's own packed data (the drawing's fidelity; the pass criterion), then against the
    // build's unrounded vertices and normals (the packing's error, reported)
    for (const [name, run] of [["prisms", F.identity], ["rounds", F.rounds], ["hulls", (TT, PP, aa) => F.hulls(TT, PP, aa, { states: hullStates, source: "packed" })], ["hulls vs the build", (TT, PP, aa) => ({ ...F.hulls(TT, PP, aa, { states: hullStates, source: "built" }), pass: true })], ["tubes", F.tubes]]) {
      const result = run(T, P, angles);
      console.log(result.text);
      for (const line of result.worst) console.log(`  ${line}`);
      if (!result.pass) {
        console.log(`${name} FAILED`);
        failed++;
      }
    }
    console.log(failed ? `fidelity failed: ${failed}` : "fidelity passed");
    process.exit(failed ? 1 : 0);
  }
  const options = { width: Number(value("--width", 1440)), height: Number(value("--height", 1100)), scale: Number(value("--scale", argv.includes("--perf") ? (Number(value("--width", 1440)) < 600 ? 3 : 2) : 1)), throttle: Number(value("--throttle", 1)), noWebgl: argv.includes("--no-webgl") };
  const step = Number(value("--step", 1));
  const out = value("--out", null);
  const statesFile = value("--states", null);
  // --states a.json,b.json: several files, a null between them (a path's files overlap by one state, so no pair is
  // lost); --slice a:b keeps states a to b-1
  // (fu/r2-verify) --states-dir d: relative --states names are read from d (a --verify build with --out writes its states
  // and paths in <page>-states/ beside the page)
  const statesDir = value("--states-dir", null);
  const statesPath = (file) => (statesDir && !file.startsWith("/") ? join(statesDir, file) : file);
  let states = statesFile ? statesFile.split(",").flatMap((file, i) => [...(i ? [null] : []), ...JSON.parse(readFileSync(statesPath(file), "utf8"))]) : null;
  const slice = value("--slice", null);
  if (states && slice) {
    const [a, b] = slice.split(":").map((x) => (x === "" ? undefined : Number(x)));
    states = states.slice(a, b);
  }
  // (fu/r2-verify) which sources the page was built from, against the working tree
  const stale = staleness(target);
  if (stale) console.log(stale);
  const page = await browser(target, options);
  const labelOf = (state, index) => (typeof state === "number" ? `${state.toFixed(3)}°` : `state ${index}`);
  try {
    const info = await page.evaluate(HELPERS);
    console.log(`page ${info.W}×${info.H} · live layers ${info.layers.filter(Boolean).join(", ")} · theme ${info.theme}`);
    // (a380 review round 1, fu/r1-verify) WebGL first: the programs link in parallel 5.5-8.3 s after navigation, and a
    // renderer read before then said "no WebGL" on the GPU, and --perf's first run overlapped the compile frames. Wait
    // (while the page still runs its own loop) until every program has linked and GL has faded in (glShare ≥ 0.999, where the page's own fallback lights switch off; merge r2),
    // or the page has settled on its fallbacks; up to 90 s
    const glWait = await page.evaluate(`(async () => { const t0 = performance.now(); for (;;) { const A = window.__a380; const g = A && A.glInfo; if (!A || !g || (g.pending === 0 && (!g.ok || (A.pv && A.pv.glShare >= 0.999)))) return { ms: Math.round(performance.now() - t0), pending: g ? g.pending : null, ok: g ? g.ok : null, share: A && A.pv ? +A.pv.glShare.toFixed(3) : null }; if (performance.now() - t0 > 90000) return { ms: -1, pending: g.pending, ok: g.ok, share: A.pv ? +A.pv.glShare.toFixed(3) : null }; await new Promise((d) => setTimeout(d, 100)); } })()`);
    await page.evaluate(`window.__isoTurn.set(0) && 0`);
    // the tool owns the page from here (item 50): held, paused, settled
    const settled = await page.evaluate("window.__tc.ownPage()");
    const renderer = await page.evaluate("(window.__a380 && window.__a380.glInfo && window.__a380.glInfo.renderer) || 'no WebGL'");
    const gpuMiss = /swiftshader/i.test(renderer) ? "SwiftShader: the GPU fell back" : renderer === "no WebGL" ? (options.noWebgl ? "" : "no WebGL context") : "";
    console.log(`page held and paused by the tool: ${settled >= 0 ? `settled after ${settled} ms` : "did not settle in 15 s"} · renderer ${renderer}${gpuMiss ? ` (${gpuMiss})` : ""} · GL ${glWait.ms >= 0 ? `ready ${glWait.ms} ms after the mount` : "NOT READY after 90 s"} (pending ${glWait.pending}, ok ${glWait.ok}, glShare ${glWait.share})`);
    const sweep = states ?? Array.from({ length: Math.round(360 / step) }, (_, i) => i * step);
    if (argv.includes("--settle-check")) {
      // (item 50) the self-check: each sampled state's live layers right after the tool's set and after the page's next
      // tick; then the first state again after the others: its painter's fill image and its order check must equal the
      // first set's (round 3: the first set of state 365 read 10,080 px out of order, a repeat 530)
      const count = Number(value("--settle-check", "6")) || 6;
      const picks = sweep.filter((x) => x !== null).slice(0, count);
      const verify = await page.evaluate("Boolean(window.__isoVerify)");
      if (verify && !(await page.evaluate("Boolean(window.__tc.order)"))) await page.evaluate(ZBUFFER);
      const sum = (r) => r.live.filter((p) => p.px >= 4).reduce((t, p) => t + p.px, 0);
      let differ = 0;
      let firstIds = null;
      let firstCheck = null;
      for (const state of picks) {
        const r = await page.evaluate(`window.__tc.settleCheck(${JSON.stringify(state)})`);
        differ += r.differ;
        if (verify && state === picks[0]) {
          await page.evaluate("window.__tc.order.shown().then((ids) => (window.__tcFirst = ids, 0))");
          firstCheck = await page.evaluate(`window.__tc.order.check(${JSON.stringify(state)})`);
        }
        console.log(`  settle ${labelOf(state, sweep.indexOf(state))}: ${r.differ} of ${r.nodes} nodes differ after the page tick${r.names.length ? ` (${r.names.join(", ")})` : ""} · ${r.set.sets} sets, ${r.set.reapplied} re-applied after the page's tick`);
      }
      let same = true;
      if (verify) {
        await page.evaluate(`window.__tc.setState(${JSON.stringify(picks[0])})`);
        const px = await page.evaluate("window.__tc.order.shown().then((ids) => { let n = 0; for (let i = 0; i < ids.length; i++) if (ids[i] !== window.__tcFirst[i]) n++; return n; })");
        const again = await page.evaluate(`window.__tc.order.check(${JSON.stringify(picks[0])})`);
        same = px === 0 && sum(again) === sum(firstCheck);
        firstIds = px;
        console.log(`  ${labelOf(picks[0], sweep.indexOf(picks[0]))} set first, then again after the others: ${px} px of the painter's fill image differ · out of order ${sum(firstCheck)} px on the first set, ${sum(again)} px on the repeat`);
      }
      console.log(`settle check: ${differ} nodes differ after the page tick over ${picks.length} states${verify ? ` · the repeat ${same ? "equals" : "DIFFERS FROM"} the first set` : ""}`);
      void firstIds;
      if (differ || !same) failed++;
    }
    if (argv.includes("--order")) {
      const has = await page.evaluate("Boolean(window.__isoVerify)");
      if (!has) {
        console.log("order: this page has no window.__isoVerify; build it with --verify");
        failed++;
      } else {
        const z = await page.evaluate(ZBUFFER);
        console.log(`order: ${z.parts} live parts and ${z.statics} static items meshed, z-buffer ${z.w}×${z.h}`);
        let control = Infinity;
        for (const angle of [0, 90, 180, 270]) {
          const r = await page.evaluate(`window.__tc.order.check(${angle}, { reverse: true }).then((r) => r.live.reduce((s, p) => s + p.px, 0))`);
          control = Math.min(control, r);
        }
        console.log(`order control (each live layer reversed at 0, 90, 180, 270): least ${control} mismatched px ${control >= 1000 ? "· fails as it should" : "· did not fail: the check is broken"}`);
        if (control < 1000) failed++;
        const probe = value("--part", null);
        if (probe) for (const state of sweep.slice(0, 12)) console.log(`  ${probe} at ${JSON.stringify(state)}: ${JSON.stringify(await page.evaluate(`window.__tc.order.footprint(${JSON.stringify(state)}, ${JSON.stringify(probe)})`))}`);
        let bad = 0;
        const layerNotes = new Map();
        let worst = 0;
        // --order-stride k (or --stride k): every k-th state of a path, and each path's last state
        const ostride = Math.max(1, Number(value("--order-stride", value("--stride", 1))));
        let checked = 0;
        let unstableStates = 0;
        let unstablePx = 0;
        const t0 = Date.now();
        for (let index = 0; index < sweep.length; index++) {
          const state = sweep[index];
          if (state === null) continue; // a path separator (a380 review round 3)
          if (ostride > 1 && index % ostride && !(index + 1 >= sweep.length || sweep[index + 1] === null)) continue;
          checked++;
          const r = await page.evaluate(`window.__tc.order.check(${JSON.stringify(state)})`);
          // (fu/r2-verify) the verdict is the first check's, over the pixels both z-buffer renders agree on (check()); a
          // failing state is rendered again only as a diagnostic (fu/lights had waived pairs that did not repeat:
          // stage.platter over stage.platter.drum 4 px at 168°, 222°, 223°, 248°)
          if (r.unstable) {
            unstableStates++;
            unstablePx += r.unstable;
            if (unstableStates <= 10) console.log(`  ${labelOf(state, index)}: ${r.unstable} z-buffer px differed between two renders of the same state (left out of the comparison)`);
          }
          const errors = r.live.filter((p) => p.px >= 4);
          if (errors.length) {
            const again = new Set((await page.evaluate(`window.__tc.order.check(${JSON.stringify(state)})`)).live.filter((p) => p.px >= 4).map((p) => `${p.painter}|${p.truth}`));
            for (const p of errors) p.repeat = again.has(`${p.painter}|${p.truth}`);
          }
          worst = Math.max(worst, ...r.live.map((p) => p.px), 0);
          if (errors.length) {
            bad++;
            if (bad <= 30) console.log(`  ${labelOf(state, index)}: ${errors.map((e) => `${e.painter} over ${e.truth} ${e.px} px${e.repeat ? "" : " (not repeated on a re-render: counted)"}`).join(" · ")}${r.stats.forced ? ` · forced ${r.stats.forced}` : ""}`);
          }
          for (const l of r.layers) if (l.px >= 16) layerNotes.set(`${l.painter} / ${l.truth}`, Math.max(layerNotes.get(`${l.painter} / ${l.truth}`) ?? 0, l.px));
        }
        console.log(`order: ${sweep.length} states${ostride > 1 ? ` (${checked} checked, every ${ostride}th and each path's last)` : ""} · ${bad} with a live pair drawn out of order (4+ interior px at 2x) · worst live pair ${worst} px · z-buffer unstable in ${unstableStates} state${unstableStates === 1 ? "" : "s"} (${unstablePx} px left out) · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        if (layerNotes.size) console.log(`  static × live (recorded static shapes are stand-ins; the layer proofs own these): ${[...layerNotes].slice(0, 8).map(([k, v]) => `${k} ${v}px`).join(" · ")}`);
        if (bad) failed++;
      }
    }
    // --zoom-sites sites.json (with --out): the 20 largest sites of an earlier --diagnose run, re-checked and dumped
    if (value("--zoom-sites", null)) {
      await page.evaluate(POPS);
      const sites = JSON.parse(readFileSync(value("--zoom-sites", null), "utf8")).sort((x, y) => y.n - x.n).slice(0, Number(value("--zoom-count", 20)));
      const theme = await page.evaluate("window.__tc.theme");
      mkdirSync(out, { recursive: true });
      const prime = Number(value("--prime", 0)); // set the state `prime`° before the site first (the sweep's own history)
      const checked = [];
      for (const site of sites) {
        // (sites written before the fix carry the diagnosis in `frames`: the angles come from the label)
        if (site.frames[0] && site.frames[0].painter !== undefined) { const a = parseFloat(site.label); site.frames = site.kind === "first" ? [a, +(a + 0.02).toFixed(4)] : [+(a - 0.1).toFixed(4), a, +(a + 0.1).toFixed(4)]; }
        if (prime && typeof site.frames[0] === "number") await page.evaluate(`window.__tc.setState(${site.frames[0] - prime})`);
        const r = site.frames.length > 2 ? await page.evaluate(`window.__tc.pops.second(${site.frames.map((x) => JSON.stringify(x)).join(", ")})`) : await page.evaluate(`window.__tc.pops.first(${JSON.stringify(site.frames[0])}, ${JSON.stringify(site.frames[1])})`);
        let d = null;
        if (argv.includes("--diagnose")) {
          if (!(await page.evaluate("Boolean(window.__tc.order)"))) await page.evaluate(ZBUFFER);
          d = await page.evaluate("window.__tc.pops.diagnose()");
          if (d) console.log(`  ${site.label}: ${d.mechanism} · ${d.pair.join(" / ")} · owner ${d.owner} · painter ${d.frames.map((f) => `[${f.painter}]`).join(" → ")} · truth ${d.frames.map((f) => `[${f.truth}]`).join(" → ")}`);
          if (r.n) await page.evaluate(site.frames.length > 2 ? `window.__tc.pops.second(${site.frames.map((x) => JSON.stringify(x)).join(", ")})` : `window.__tc.pops.first(${JSON.stringify(site.frames[0])}, ${JSON.stringify(site.frames[1])})`);
        }
        const png = await page.evaluate(`window.__tc.pops.zoom(${JSON.stringify(site.frames)}, ${JSON.stringify(site.box)})`);
        const file = join(out, `pops-${site.kind}-${theme}-${String(site.label).replace(/[^0-9.a-z]/gi, "")}.png`);
        writeFileSync(file, Buffer.from(png, "base64"));
        console.log(`  ${site.kind} ${site.label}: ${r.n} px again${prime ? ` after ${site.frames[0] - prime}°` : " in isolation"} (was ${site.n}) · ${file}`);
        checked.push({ ...site, ...(d ?? {}), hits: d ? d.frames : undefined, frames: site.frames, n: r.n, was: site.n });
      }
      // the re-checked sites with their diagnosis, in the --diagnose sites' shape (a380/tools/pops-table.mjs reads it)
      const file = join(out, `pops-zoom-sites-${theme}.json`);
      writeFileSync(file, JSON.stringify(checked.map(({ frames, ...x }) => x), null, 1));
      console.log(`  ${checked.length} re-checked sites in ${file}`);
    }
    if (argv.includes("--pops")) {
      await page.evaluate(POPS);
      if (out) await page.evaluate("window.__tcDump = true");
      // (fu/f3-verify) the control's part: the one that shows most (hit-tested on a 16 x 16 grid over each of the 40
      // largest boxes), not the largest box. Round 2's content gave the largest boxes to parts that hardly show (the
      // push path planted wings.r.le.root, whose box spans the whole root but whose fill lies under the wing box and
      // the fairing): hiding it for a step changed nothing and both controls read "the check is broken"
      const pickAt = (state) => `(async () => { await window.__tc.setState(${JSON.stringify(state)}); await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))); const svgs = [...document.querySelectorAll("svg[data-live]")]; const live = svgs[svgs.length - 1]; const parts = [...live.querySelectorAll("[data-p]")].map((el) => [el, el.getBBox()]).sort((a, b) => b[1].width * b[1].height - a[1].width * a[1].height).slice(0, 40); const style = document.createElement("style"); style.textContent = "svg[data-live] *{pointer-events:visiblePainted!important}"; document.head.append(style); const ranked = []; for (const [el] of parts) { const r = el.getBoundingClientRect(); let hits = 0; const box = r.width * r.height / 256; for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) { const top = document.elementFromPoint(r.left + (r.width * (i + 0.5)) / 16, r.top + (r.height * (j + 0.5)) / 16); if (top && top.tagName === "path" && top.closest("[data-p]") === el) hits++; } if (hits) ranked.push([hits * box, Number(el.dataset.p)]); } style.remove(); return ranked.sort((a, b) => b[0] - a[0]).slice(0, 5).map((x) => x[1]); })()`;
      const plantAt = typeof sweep[0] === "number" ? 37 : sweep[0];
      // the five parts that show most there, tried in turn until one hidden part is flagged (a broken check flags none)
      const plantParts = await page.evaluate(pickAt(plantAt));
      let plantPart = plantParts[0] ?? null;
      let control = { n: 0 };
      for (const part of plantParts) {
        plantPart = part;
        control = await page.evaluate(`window.__tc.pops.first(${JSON.stringify(plantAt)}, ${JSON.stringify(typeof plantAt === "number" ? plantAt + 0.02 : plantAt)}, ${part})`);
        if (control.n) break;
      }
      console.log(`pops control (part ${plantPart} hidden for one frame): ${control.n ? `${control.n} px flagged · fails as it should` : "nothing flagged: the check is broken"}`);
      if (!control.n) failed++;
      let firstBad = 0;
      const firstStates = states ?? Array.from({ length: Math.round(360 / step) }, (_, i) => i * step);
      if (states) {
        // (follow-up items 48, 49) a path: incremental first differences (see INCR), segment by segment (a null starts a
        // new segment with a full render). --stride k compares state i with state i+k.
        // (review round 1, fu/r1-verify) A turn that moves inside a path is a step like any other, not a segment break:
        // the turn moves every group under the turntable, so INCR's step() takes every part they carry into the changed
        // region and the pair is compared as a full render. Splitting at every turn change had made each state of the
        // push clip (the turntable turning 0.5° a frame) a segment of one: 1,141 segments, 0 steps, and a pass.
        await page.evaluate(INCR);
        const stride = Math.max(1, Number(value("--stride", 1)));
        const checkEvery = Number(value("--incremental-check", 500));
        // (fu/r1-verify) the vary classes the path carries (__vary), and how many of the page's elements they reach
        {
          const varied = [...new Set(states.filter((x) => x && x.__vary).flatMap((x) => Object.keys(x.__vary)))];
          if (varied.length) {
            const reach = await page.evaluate(`${JSON.stringify(varied)}.map((cls) => cls + " " + window.__tc.svgs.reduce((n, svg) => n + svg.querySelectorAll("." + cls).length, 0))`);
            console.log(`path vary classes written over the page's (the clip's own alphas): ${reach.join(", ")} elements`);
          }
        }
        // the control: one hinge jumped 5° in one step must leave a region
        {
          const s0 = states.find((x) => x && typeof x === "object");
          if (s0) {
            const i0 = states.indexOf(s0);
            const one = await page.evaluate(`window.__tc.incr.pops.onePass(${JSON.stringify(s0)})`);
            console.log(`path images (crops composited over the card and halo) against the one-pass render: ${one.n} px differ by 2+ levels (largest ${one.worst})`);
            await page.evaluate(`window.__tc.incr.pops.start(${JSON.stringify(s0)})`);
            // (fu/f3-verify) the part that shows most in the step's own state
            const pathParts = await page.evaluate(pickAt(states[i0 + 1] ?? s0));
            let pathPart = pathParts[0] ?? null;
            let r = { n: 0 };
            for (const part of pathParts) {
              pathPart = part;
              await page.evaluate(`window.__tc.incr.pops.start(${JSON.stringify(s0)})`);
              r = await page.evaluate(`window.__tc.incr.pops.next(${JSON.stringify(states[i0 + 1] ?? s0)}, ${part})`);
              if (r.n) break;
            }
            console.log(`pops control along a path (part ${pathPart} hidden for one step): ${r.n ? `${r.n} px flagged · fails as it should` : "nothing flagged: the check is broken"}`);
            if (!r.n) failed++;
          }
        }
        const t0 = Date.now();
        let steps = 0;
        let area = 0;
        let fullChecks = 0;
        let fullWorst = 0;
        let fullPx = 0;
        let fullSpeckle = 0;
        let motionMax = 0;
        let motionWho = null; // (fu/r1-verify) the part and step of the largest travel
        const travel = (r, at) => {
          if ((r.motion || 0) > motionMax) {
            motionMax = r.motion;
            motionWho = `${r.motionName ?? "?"} at state ${at}`;
          }
        };
        let coarse = 0;
        let fineSteps = 0;
        let covered = 0;
        const windows = value("--windows", null) ? value("--windows", null).split(":").map(Number) : null;
        // every surviving step as a site (its two states), for --zoom-sites … --diagnose (written with --out)
        const pathSites = [];
        const site = (i, r) => pathSites.push({ kind: "first", label: `state-${i}`, n: r.n, box: r.box, frames: [states[i], states[i + 1]] });
        let segments = 0;
        let index = 0;
        while (index < states.length) {
          while (index < states.length && states[index] === null) index++;
          if (index >= states.length) break;
          const i0 = index;
          let end = i0;
          while (end + 1 < states.length && states[end + 1] !== null) end++;
          segments++;
          // --windows w:every: on a path where the whole airframe moves (pitch, lift: every step is a full render),
          // windows of w states at the path's own step, one every `every` states
          if (windows) {
            for (let s0 = i0; s0 < end; s0 += windows[1]) {
              const s1 = Math.min(end, s0 + windows[0]);
              await page.evaluate(`window.__tc.incr.pops.start(${JSON.stringify(states[s0])})`);
              for (let c = s0 + 1; c <= s1; c += 40) {
                const chunk = states.slice(c, Math.min(s1 + 1, c + 40));
                const results = await page.evaluate(`window.__tc.incr.pops.run(${JSON.stringify(chunk)})`);
                results.forEach((r, q) => {
                  steps++;
                  area += r.area;
                  travel(r, c + q);
                  if (!r.n) return;
                  firstBad++;
                  site(c + q - 1, r);
                  if (firstBad <= 30) console.log(`  first difference state ${c + q - 1} → ${c + q}: ${r.n} px survive two erosions in ${r.box.join(",")}`);
                });
              }
              covered += s1 - s0;
            }
            index = end + 1;
            continue;
          }
          covered += end - i0;
          await page.evaluate(`window.__tc.incr.pops.start(${JSON.stringify(states[i0])})`);
          const picks = [];
          for (let j = i0 + stride; j < end; j += stride) picks.push(j);
          if (end > i0) picks.push(end);
          for (let c = 0; c < picks.length; c += 40) {
            const chunk = picks.slice(c, c + 40);
            const results = await page.evaluate(`window.__tc.incr.pops.run(${JSON.stringify(chunk.map((j) => states[j]))})`);
            const flagged = [];
            results.forEach((r, k) => {
              steps++;
              area += r.area;
              travel(r, chunk[k]);
              if (r.n) flagged.push({ from: k ? chunk[k - 1] : c ? picks[c - 1] : i0, to: chunk[k], r });
            });
            // a coarse pair compares states k apart, so a smooth change can add up past the 5 levels: every flagged
            // window is run again at the path's own step, and only a step that flags there counts
            for (const { from, to, r } of flagged) {
              coarse++;
              if (stride === 1) {
                firstBad++;
                site(from, r);
                if (firstBad <= 30) console.log(`  first difference state ${from} → ${to}: ${r.n} px survive two erosions in ${r.box.join(",")}`);
                continue;
              }
              await page.evaluate(`window.__tc.incr.pops.start(${JSON.stringify(states[from])})`);
              const fine = await page.evaluate(`window.__tc.incr.pops.run(${JSON.stringify(states.slice(from + 1, to + 1))})`);
              fineSteps += fine.length;
              fine.forEach((f, q) => {
                if (!f.n) return;
                firstBad++;
                site(from + q, f);
                if (firstBad <= 30) console.log(`  first difference state ${from + q} → ${from + q + 1}: ${f.n} px survive two erosions in ${f.box.join(",")}`);
              });
            }
            if (flagged.length && stride > 1) await page.evaluate(`window.__tc.incr.pops.start(${JSON.stringify(states[chunk[chunk.length - 1]])})`);
            if (checkEvery && (steps % checkEvery < chunk.length || c + 40 >= picks.length)) {
              const v = await page.evaluate("window.__tc.incr.pops.verify()");
              fullChecks++;
              fullPx = Math.max(fullPx, v.survive);
              fullWorst = Math.max(fullWorst, v.worst);
              fullSpeckle = Math.max(fullSpeckle, v.n);
            }
          }
          index = end + 1;
        }
        const secs = (Date.now() - t0) / 1000;
        const pairs = states.reduce((n, x, i) => n + (x !== null && states[i + 1] !== undefined && states[i + 1] !== null ? 1 : 0), 0);
        console.log(`pops, first difference along the path: ${states.length} states in ${segments} segments · ${windows ? `windows of ${windows[0]} steps every ${windows[1]}: ${steps} steps, ${((100 * covered) / Math.max(1, pairs)).toFixed(1)}% of the path's ${pairs} pairs` : `${steps} steps (stride ${stride})`}${stride > 1 ? ` · ${coarse} coarse pairs flagged, re-run at the path's step (${fineSteps} steps)` : ""} · ${firstBad} with a surviving region · ${secs.toFixed(0)} s (${((secs * 1000) / Math.max(1, steps + fineSteps)).toFixed(1)} ms a step, mean region ${(area / Math.max(1, steps) / 4).toFixed(0)} px at 1x)`);
        console.log(`  largest outline travel in one compared pair: ${motionMax.toFixed(2)} px at 1x${motionWho ? ` (${motionWho})` : ""}${motionMax > 2.5 ? " · OVER 2.5 px: a pop that comes and goes inside one pair could hide; use a smaller --stride" : " (a pop is a jump; one that came and went inside a pair of this travel would have to undo itself within 2.5 px)"}`);
        if (motionMax > 2.5) failed++;
        if (out && pathSites.length) {
          mkdirSync(out, { recursive: true });
          const file = join(out, `pops-path-sites-${await page.evaluate("window.__tc.theme")}.json`);
          writeFileSync(file, JSON.stringify(pathSites));
          console.log(`  ${pathSites.length} surviving steps as sites in ${file} (re-check with --zoom-sites ${file} --diagnose --out <dir>)`);
        }
        // (fu/r1-verify) --windows never compared its image with a full render, and the line said "exact" over 0
        if (checkEvery && fullChecks) console.log(`  incremental image against ${fullChecks} full renders: ${fullPx} px 5+ levels apart survive two erosions${fullPx ? " · NOT EXACT for the first difference" : " · exact for the first difference"} (edge antialiasing: at most ${fullSpeckle} px differ by 1+ level, largest ${fullWorst})`);
        else if (checkEvery) console.log("  incremental image not compared with a full render (--windows: each window starts with one)");
        if (fullPx) failed++;
        if (firstBad) failed++;
        // (fu/r1-verify) a path run that compared nothing checked nothing: it fails, whatever the reason (a path of one
        // state, every pair across a separator)
        const pathPairs = states.reduce((n, x, i) => n + (x !== null && states[i + 1] !== undefined && states[i + 1] !== null ? 1 : 0), 0);
        if (!steps) {
          console.log(`pops along the path: 0 compared steps over ${states.length} states (${pathPairs} pairs): nothing was checked · FAILED`);
          failed++;
        }
      }
      // --diagnose (follow-up item 46): name the parts under every surviving region and its mechanism; with --out, the
      // 20 largest at 8x and every site as JSON
      const diagnose = argv.includes("--diagnose") && (await page.evaluate("Boolean(window.__isoVerify)"));
      if (diagnose && !(await page.evaluate("Boolean(window.__tc.order)"))) await page.evaluate(ZBUFFER);
      const sites = [];
      const report = async (kind, label, r, frames) => {
        const d = diagnose ? await page.evaluate("window.__tc.pops.diagnose()") : null;
        // every site's zoom while its mask is the last one (kept for the 20 largest below)
        const png = out && diagnose ? await page.evaluate(`window.__tc.pops.zoom(${JSON.stringify(frames)}, ${JSON.stringify(r.box)})`) : null;
        sites.push({ kind, label, n: r.n, box: r.box, ...(d ?? {}), hits: d ? d.frames : undefined, frames, png });
        return d ? ` · ${d.mechanism} · ${d.pair.join(" / ")} · owner ${d.owner} · painter ${d.frames.map((f) => `[${f.painter}]`).join(" → ")} · truth ${d.frames.map((f) => `[${f.truth}]`).join(" → ")}` : "";
      };
      const firstOnly = argv.includes("--first-only");
      const anglesFrom = value("--first-range", null);
      let firstChecked = 0;
      for (let index = 0; !states && index < firstStates.length; index++) {
        const a = firstStates[index];
        const b = typeof a === "number" ? a + 0.02 : firstStates[index + 1];
        if (b === undefined) break;
        // a null in a states file separates two paths: the pair across it is not a step (a380 review round 3)
        if (a === null || b === null) continue;
        if (anglesFrom && typeof a === "number") {
          const [lo, hi] = anglesFrom.split(":").map(Number);
          if (a < lo || a > hi) continue;
        }
        const r = await page.evaluate(`window.__tc.pops.first(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
        firstChecked++;
        if (r.n) {
          firstBad++;
          const extra = await report("first", labelOf(a, index), r, [a, b]);
          if (firstBad <= 20 || diagnose) console.log(`  first difference ${labelOf(a, index)}: ${r.n} px survive two erosions in ${r.box.join(",")}${extra}`);
        }
      }
      void firstOnly;
      if (!states) console.log(`pops, first difference: ${anglesFrom ? `${firstChecked} of ${firstStates.length} steps (--first-range ${anglesFrom})` : `${firstStates.length} steps`} · ${firstBad} with a surviving region`);
      if (!states && firstBad) failed++;
      if (!states && !firstOnly) {
        let cores = 0;
        const small = [];
        const fine = Number(value("--fine", 0.1));
        // --second-range a:b: only the middle frames from a to b (the light page's two runs of cores)
        const [lo, hi] = (value("--second-range", null) ?? `${-fine}:${360 + fine}`).split(":").map(Number);
        for (let x = Math.max(0, lo - fine); x + 2 * fine <= Math.min(360, hi + fine) + 1e-9; x += fine) {
          const r = await page.evaluate(`window.__tc.pops.second(${x.toFixed(4)}, ${(x + fine).toFixed(4)}, ${(x + 2 * fine).toFixed(4)})`);
          if (r.n >= 6) {
            cores++;
            const extra = await report("second", `${(x + fine).toFixed(2)}°`, r, [+x.toFixed(4), +(x + fine).toFixed(4), +(x + 2 * fine).toFixed(4)]);
            if (cores <= 20 || diagnose) console.log(`  second difference at ${(x + fine).toFixed(2)}°: core of ${r.n} px in ${r.box.join(",")}${extra}`);
          } else if (r.n) small.push(`${(x + fine).toFixed(2)}° ${r.n} px in ${r.box.join(",")}`);
        }
        console.log(`pops, second difference at ${fine}° over ${lo <= 0 && hi >= 360 ? "a full turn" : `${lo}–${hi}°`}: ${cores} cores of 6+ px · ${small.length} small cores to read${small.length ? `: ${small.slice(0, 12).join(" · ")}` : ""}`);
        const dumped = out ? await page.evaluate("window.__tcDumped && typeof window.__tcDumped === 'object' ? window.__tcDumped : null") : null;
        if (dumped) {
          mkdirSync(out, { recursive: true });
          for (const [key, data] of Object.entries(dumped)) writeFileSync(join(out, `pops-core-${key}.png`), Buffer.from(data, "base64"));
          console.log(`  first core dumped to ${out}/pops-core-{a,b,c,e}.png`);
        }
        if (cores) failed++;
      }
      if (out && sites.length) {
        mkdirSync(out, { recursive: true });
        const theme = await page.evaluate("window.__tc.theme");
        writeFileSync(join(out, `pops-sites-${theme}.json`), JSON.stringify(sites.map(({ png, ...x }) => x), null, 1));
        const largest = sites.slice().sort((x, y) => y.n - x.n).slice(0, 20);
        for (const site of largest) {
          const png = site.png ?? (await page.evaluate(`window.__tc.pops.zoom(${JSON.stringify(site.frames)}, ${JSON.stringify(site.box)})`));
          const file = join(out, `pops-${site.kind}-${theme}-${site.label.replace(/[^0-9.a-z]/gi, "")}.png`);
          writeFileSync(file, Buffer.from(png, "base64"));
        }
        console.log(`  ${sites.length} sites in ${join(out, `pops-sites-${theme}.json`)}; the ${largest.length} largest at 8x in ${out}/pops-*.png (frames side by side, then the difference ×4)`);
      }
    }
    if (argv.includes("--lines")) {
      const angles = Array.from({ length: 24 }, (_, i) => i * 15);
      const planted = await page.evaluate(`(async () => { await window.__tc.setState(0); const part = document.querySelector("svg[data-live] [data-p]"); const el = document.createElementNS("http://www.w3.org/2000/svg", "path"); el.setAttribute("class", "iso-line"); el.setAttribute("data-tone", "lo"); el.setAttribute("d", "M5 5L25 9"); el.setAttribute("data-plant", ""); part.appendChild(el); const r = (${LINE_ENDS})({ select: null, show: false }); el.remove(); return r ? r.problems.length : -1; })()`);
      console.log(`lines control (a planted floating line): ${planted > 0 ? "fails as it should" : "nothing flagged: the check is broken"}`);
      if (!(planted > 0)) failed++;
      let bad = 0;
      for (const angle of angles) {
        const r = await page.evaluate(`(async () => { await window.__tc.setState(${angle}); const r = (${LINE_ENDS})({ select: null, show: false }); return r ? { n: r.problems.length, list: r.problems.slice(0, 4).map((p) => p.what + " " + p.end + " " + p.gap.toFixed(2) + " px at " + p.at.join(",")) } : null; })()`);
        if (r && r.n) {
          bad += r.n;
          console.log(`  ${angle}°: ${r.n} floating ends: ${r.list.join(" · ")}`);
        }
      }
      console.log(`lines: ${angles.length} angles · ${bad} floating ends`);
      if (bad) failed++;
    }
    if (argv.includes("--perf")) {
      // (fu/r1-verify) the budget check runs on the GPU or not at all: SwiftShader, no WebGL context or GL not ready
      // fail it (unless --no-webgl asked for the fallbacks)
      if (!options.noWebgl && (gpuMiss || glWait.ms < 0 || !glWait.ok)) {
        console.log(`perf: not measured on the GPU (renderer ${renderer}${gpuMiss ? `: ${gpuMiss}` : ""}${glWait.ms < 0 ? ", GL not ready after 90 s" : !glWait.ok ? ", GL not on" : ""}) · FAILED`);
        failed++;
      }
      await page.send("Performance.enable");
      const metrics = async () => Object.fromEntries((await page.send("Performance.getMetrics")).result.metrics.map((m) => [m.name, m.value]));
      // --state a,b,…: rest (the default: the tour's start, held and paused), cutaway, cutawayDoors, inspect:<view id>,
      // takeoff, or all (every one, every Inspect view)
      let wanted = value("--state", "rest").split(",");
      if (wanted.includes("all")) {
        const views = await page.evaluate("window.__a380 && window.__a380.inspect ? window.__a380.inspect.views.map((v) => v.id) : []");
        wanted = ["rest", "cutaway", "cutawayDoors", ...views.map((id) => `inspect:${id}`), "takeoff"];
      }
      const all = [];
      for (const state of wanted) {
        let where = "the tour's start, held and paused";
        // (fu/f4-verify) a lone rest state is measured where the tool took the page, unless the tour had already left the
        // stand (then perfState seeks it back to GATE)
        const drifted = state === "rest" && (await page.evaluate(`(() => { const c = document.querySelector('[data-phase][aria-current="step"]'); return Boolean(window.__a380 && c && c.dataset.phase !== "GATE"); })()`));
        if (state !== "rest" || wanted.length > 1 || drifted) {
          const reached = await perfState(page, state);
          where = reached.text;
          if (!reached.ok) failed++;
        }
        const runs = [];
        for (let r = 0; r < 3; r++) {
          const before = await metrics();
          const result = await page.evaluate(`(${PERF})(240, 1.1, null)`);
          const after = await metrics();
          const per = (key) => ((after[key] - before[key]) * 1000) / result.frames;
          runs.push({ ...result, task: per("TaskDuration"), script: per("ScriptDuration"), style: per("RecalcStyleDuration"), layout: per("LayoutDuration") });
        }
        // the state after the three runs (a state that drifted while it was measured would show here)
        const after = await page.evaluate(`(() => { const A = window.__a380; if (!A || !A.pv) return ""; const cur = document.querySelector('[data-phase][aria-current="step"]'); return " · after: phase " + (cur ? cur.dataset.phase : "?") + ", " + A.pv.mode + ", view " + (A.pv.inspect || "none") + ", " + (+(A.state && A.state.speed) || 0).toFixed(1) + " kt"; })()`);
        where += after;
        const med = (key) => runs.map((r) => r[key]).sort((a, b) => a - b)[1];
        const how = runs[0].through ? "through the page (A3.tick: pv.turn and one page tick a frame)" : "through the tool's C.set (the page has no A3.tick)";
        console.log(`perf ${state} at ${options.width} px, DPR ${options.scale}, ${options.throttle}× CPU, median of 3 runs of 240 frames at 1.1° ${how}: set() ${med("setMedian").toFixed(2)} ms (p95 ${med("setP95").toFixed(2)}) · ${med("setsPerFrame")} set() a frame (most ${Math.max(...runs.map((r) => r.setsMax))}) · task ${med("task").toFixed(2)} ms · script ${med("script").toFixed(2)} ms · style ${med("style").toFixed(2)} ms · layout ${med("layout").toFixed(2)} ms per frame · frame interval ${med("gapMedian").toFixed(1)} ms (p95 ${med("gapP95").toFixed(1)}) · ${runs[0].live} live elements · ${med("writes")} writes and ${med("moved")} moves per set · runs' tasks ${runs.map((r) => r.task.toFixed(1)).join(", ")} ms · ${where}`);
        all.push({ state, where, runs });
      }
      if (out) {
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, `perf-${options.width}-${options.throttle}x.json`), JSON.stringify({ renderer, glWait, states: all }, null, 1));
      }
    }
    console.log(page.problems.length ? page.problems.join("\n") : "console: clean");
    if (page.problems.length) failed++;
  } catch (error) {
    console.error(error);
    failed++;
  } finally {
    page.close();
  }
  console.log(failed ? `turn check failed: ${failed}` : "turn check passed");
  process.exit(failed ? 1 : 0);
}

if (typeof WebSocket === "undefined" && !process.execArgv.includes("--experimental-websocket")) {
  const child = spawn(process.execPath, ["--experimental-websocket", ...process.argv.slice(1)], { stdio: "inherit" });
  // pass a stop on to the child, which kills its Chrome (killing only this wrapper orphaned it)
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => process.exit(code ?? 1));
} else {
  await main();
}
