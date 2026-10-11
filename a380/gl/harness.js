// a380/gl/harness.js (S): the WebGL harness, page side (GL.md §2, §8; DESIGN §6). Owned by the scaffold.
// Inlined after the kit (turn + gl) and gl/runtime.js, before live.js. It uses the kit's glLayer, smooth,
// burst, settle and runtime.js's flashTrain, pointVisibility and glPasses.
//
//   A3GL.effect({ id, canvas, fragment?, uniforms?, active(fx), draw(fx, pass) })   register an effect
//   A3GL.init({ stage, controller, data, light })                                   compile, check budget
//     (parallel compile: returns at once with info.pending > 0; GL comes on once every program has linked, and
//     A3GL.onRestore() wakes the page)
//   A3GL.frame(fx)                                                                  draw every active effect
//
// fx (built by live.js each frame): { controller, clock, dt, calm, moved, state, ch, pv, share, first,
// lights: { id: { level, flash, energy, anchor, vis } } }. An effect's draw(fx, pass) calls
// pass(values, box) once per scissored pass; `box` is a viewBox box every term must reach 0 inside.
// Canvas list: "runway" (under the airframe, over the deck), "ground" (same), "air" (over the airframe).
const A3GL = (() => {
  const registered = [];
  const layers = {};
  const view = [960, 680, 0, 0];
  let base = [960, 680];
  const canvases = {};
  const drawn = {};
  let ok = false;
  let lost = false;
  let info = null;
  const effect = (spec) => {
    registered.push(spec);
    return spec;
  };

  // ---- compiling (follow-up item 34). With KHR_parallel_shader_compile the programs are handed to the driver one at
  // a time from the first animation frame after init and polled each frame through COMPLETION_STATUS_KHR, so the page
  // is not blocked while the GPU compiles: the fallbacks stay up (glShare 0) until every program has linked, then first light fades GL in as
  // before. Without the extension (or with A3GL.serial set before init) each program compiles and links at init
  // through the kit's glLayer, as before. The heavy programs come split into chunks under about 200 ms each
  // (DATA.gl.effects entries with a `family`: windows.0, windows.1 … draw with the family's page spec).
  const GL_ATTRS = { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false };
  /** Start one program without waiting for it: { gl, ready(), finish(opts) → layer | null }. */
  function startLayer({ canvas, fragment, extensions = [] }) {
    const gl = canvas.getContext("webgl", GL_ATTRS);
    if (!gl) return null;
    const ext = gl.getExtension("KHR_parallel_shader_compile");
    const enabled = extensions.filter((name) => gl.getExtension(name.replace(/^GL_/, "")));
    const shader = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      return s;
    };
    const vs = shader(gl.VERTEX_SHADER, VERTEX);
    const fs = shader(gl.FRAGMENT_SHADER, enabled.map((name) => `#extension ${name} : enable\n`).join("") + GLSL_ISO + fragment);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    const t0 = performance.now();
    return {
      gl,
      t0,
      // a lost context never completes: report it ready, so finish() fails it instead of polling for ever
      ready: () => !ext || gl.isContextLost() || Boolean(gl.getProgramParameter(program, ext.COMPLETION_STATUS_KHR)),
      finish: (opts) => finishLayer(gl, program, vs, fs, enabled, opts),
    };
  }
  /** The kit's glLayer from a linked program (the same object: gl, program, extensions, set, draw, clear). */
  function finishLayer(gl, program, vs, fs, enabled, { canvas, view: drawn, camera, uniforms = [], fixed = {}, maxRatio = 1.5, onError }) {
    if (gl.isContextLost()) return null;
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) return onError(gl.getShaderInfoLog(vs)), null;
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) return onError(gl.getShaderInfoLog(fs)), null;
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return onError(gl.getProgramInfoLog(program)), null;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const where = {};
    for (const name of ["uCanvas", "uView", "uOrigin", "uK", "uCam", "uTime", ...uniforms, ...Object.keys(fixed)]) where[name] = gl.getUniformLocation(program, name);
    const types = {};
    const active = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let index = 0; index < active; index++) {
      const u = gl.getActiveUniform(program, index);
      if (u) types[u.name.replace(/\[0\]$/, "")] = u.type;
    }
    let painted = false;
    // fu/perf: the canvas box cached until a ResizeObserver reports a change, as kit/gl.mjs does (kit patch 21): read
    // every draw it forced a layout after the page's DOM writes, 230 ms in 3 s of a Deck-plan drag (review r1; fu/r1-lights
    // made the same fix, merged as this one)
    let sized = null;
    if (typeof ResizeObserver === "function") new ResizeObserver(() => (sized = null)).observe(canvas);
    // fu/perf end
    const fit = () => {
      const box = sized ?? (sized = canvas.getBoundingClientRect()); // fu/perf: sized fu/perf end
      const ratio = Math.min(maxRatio, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(box.width * ratio));
      const height = Math.max(1, Math.round(box.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };
    const set = (name, value) => {
      const at = where[name];
      if (at === undefined || at === null) return;
      if (typeof value === "number") gl.uniform1f(at, value);
      else if (value.length > 4) {
        const data = value instanceof Float32Array ? value : new Float32Array(value);
        const type = types[name];
        if (type === gl.FLOAT_VEC2) gl.uniform2fv(at, data);
        else if (type === gl.FLOAT_VEC3) gl.uniform3fv(at, data);
        else if (type === gl.FLOAT_VEC4) gl.uniform4fv(at, data);
        else gl.uniform1fv(at, data);
      } else if (value.length === 1) gl.uniform1f(at, value[0]);
      else if (value.length === 2) gl.uniform2f(at, value[0], value[1]);
      else if (value.length === 3) gl.uniform3f(at, value[0], value[1], value[2]);
      else if (value.length === 4) gl.uniform4f(at, value[0], value[1], value[2], value[3]);
    };
    for (const [name, value] of Object.entries(fixed)) set(name, value);
    const use = () => {
      if (gl.getParameter(gl.CURRENT_PROGRAM) === program) return;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    };
    return {
      gl,
      program,
      extensions: enabled,
      set(values = {}) {
        use();
        for (const [name, value] of Object.entries(values)) set(name, value);
      },
      draw(values = {}, time = 0) {
        use();
        fit();
        gl.viewport(0, 0, canvas.width, canvas.height);
        set("uCanvas", [canvas.width, canvas.height]);
        set("uView", drawn.length >= 4 ? drawn : [drawn[0], drawn[1], 0, 0]);
        set("uOrigin", camera.origin);
        set("uK", camera.k);
        set("uCam", camera.cam);
        set("uTime", time);
        for (const [name, value] of Object.entries(values)) set(name, value);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        painted = true;
      },
      clear() {
        if (!painted) return;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        painted = false;
      },
    };
  }
  /**
   * Compile `list` (specs with canvas and fragment) and call done(failed ids) once every program has linked or
   * failed. Parallel: polled once per animation frame (each spec gets .ms, its wall time to completion, and .frames,
   * the polls it took). Serial: at once, each spec's .ms its blocking compile and link.
   */
  function compileAll(list, opts, parallel, done) {
    const failed = [];
    if (!parallel) {
      for (const spec of list) {
        const t1 = performance.now();
        const layer = glLayer({ canvas: canvases[spec.canvas], fragment: spec.fragment, view, ...opts, uniforms: spec.uniforms ?? [], onError: (message) => opts.onError(spec, message) });
        spec.ms = performance.now() - t1;
        spec.frames = 0;
        if (layer) spec.layer = layer;
        else failed.push(spec.id);
      }
      done(failed);
      return;
    }
    // From the next animation frame on, one program at a time is handed to the driver and polled each frame through
    // COMPLETION_STATUS_KHR; once it reports complete it is finished (its link status and uniform table read) and the
    // next one is handed out in the same frame. Measured here (ANGLE on GL, Radeon 8060S, the machine at load 35): a
    // poll costs nothing while the driver compiles, but the first status read of a finished program waits 70-180 ms in
    // the GPU process, and with two or three in flight it also waits for the others' compiles (frames of 256-360 ms
    // with three, up to 290 ms with two). One in flight bounds every frame by one program's finish (at most 182 ms
    // there; every program compiles in under 200 ms serially), for a later first light (14 s at load 35 against 9 s
    // with three in flight; the fallbacks carry the picture meanwhile)
    const queue = list.slice();
    let current = null;
    let polls = 0;
    const steps = (info.steps = []);
    const step = () => {
      polls++;
      const t0 = performance.now();
      if (current) {
        // a guard: a program not done 60 s after it was handed out is given up (its fallback stays)
        const late = t0 - current.at > 60000;
        if (!current.job || late || current.job.ready()) {
          const { spec, job } = current;
          current = null;
          spec.ms = performance.now() - (job ? job.t0 : t0);
          spec.frames = polls;
          const layer = !job || late ? null : job.finish({ canvas: canvases[spec.canvas], view, ...opts, uniforms: spec.uniforms ?? [], onError: (message) => opts.onError(spec, message) });
          if (layer) spec.layer = layer;
          else failed.push(spec.id);
        }
      }
      if (!current && queue.length) {
        const spec = queue.shift();
        current = { spec, at: performance.now(), job: startLayer({ canvas: canvases[spec.canvas], fragment: spec.fragment, extensions: opts.extensions }) };
      }
      steps.push(Math.round(performance.now() - t0));
      if (!current && !queue.length) done(failed);
      // (review fu-1 tried polling between frames on a 4 ms timer: first light came 1.7-1.9 s later, 9.5 s against 7.7 s
      // at load 20, so the poll stays once a frame; notes/followup/r1-lights.md)
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---- inks from CSS tokens (follow-up item 35). DATA.gl.inks lists [role, uniform, token]; each token is read
  // through a probe's computed colour (so any CSS colour form works, and a theme override or a page's own override
  // is what the shader gets) and set on every program as a fixed uniform. A change to the root's style, class or
  // theme re-reads them and redraws.
  let inkList = [];
  let inkProbe = null;
  const inkValues = {};
  const inkByRole = {};
  function readInks(stage) {
    if (!inkList.length || typeof getComputedStyle !== "function") return false;
    if (!inkProbe || !inkProbe.isConnected) {
      inkProbe = document.createElement("i");
      inkProbe.className = "a3-ink-probe";
      inkProbe.setAttribute("aria-hidden", "true");
      inkProbe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none";
      stage.appendChild(inkProbe);
    }
    let changed = false;
    for (const [role, uniform, token] of inkList) {
      inkProbe.style.color = `var(${token}, rgb(255, 0, 255))`;
      const m = getComputedStyle(inkProbe).color.match(/[\d.]+/g);
      const rgb = m && m.length >= 3 ? [m[0] / 255, m[1] / 255, m[2] / 255] : [1, 0, 1];
      const was = inkValues[uniform];
      if (!was || was.some((v, i) => Math.abs(v - rgb[i]) > 1e-4)) changed = true;
      inkValues[uniform] = rgb;
      inkByRole[role] = rgb;
    }
    return changed;
  }
  function init({ stage, controller, data, light }) {
    const D = data;
    inkList = D.inks ?? [];
    readInks(stage);
    if (inkList.length && typeof MutationObserver === "function") {
      let queued = false;
      const reread = () => {
        queued = false;
        if (!readInks(stage)) return;
        for (const list of Object.values(layers)) for (const spec of list) if (spec.layer) spec.layer.set(inkValues);
        if (typeof A3GL.onRestore === "function") A3GL.onRestore();
      };
      const watch = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(reread);
      });
      for (const el of new Set([document.documentElement, document.body, stage.closest(".iso")].filter(Boolean))) watch.observe(el, { attributes: true, attributeFilter: ["style", "class", "data-theme"] });
    }
    // the viewBox window every canvas draws (width, height, x, y); Inspect zooms it (kit patch 10)
    view[0] = D.W;
    view[1] = D.H;
    view[2] = 0;
    view[3] = 0;
    base = [D.W, D.H];
    for (const name of D.canvases) canvases[name] = stage.querySelector(`[data-canvas="${name}"]`);
    const errors = [];
    // every effect shipped with a fragment in DATA.gl.effects compiles here; page-registered effects bring theirs
    // a later registration of an id replaces an earlier one (M8 request 0: the harness's own "points" is registered
    // first, M8's after it). A chunk of a split program (`family`: windows.2 of windows) takes its family's page spec
    // and keeps its own id, fragment and chunk
    const last = (id) => registered.filter((r) => r.id === id).pop();
    const ids = [...new Set(registered.map((r) => r.id))];
    let specs = [...D.effects.map((e) => (e.family && !last(e.id) ? { ...(last(e.family) ?? {}), ...e } : { ...e, ...(last(e.id) ?? {}) })), ...ids.filter((id) => !D.effects.some((e) => e.id === id || e.family === id)).map(last)];
    // M8's per-light passes (id "lights", with the ID mask, sectors and the gear gate) replace the scaffold's points
    if (specs.some((s) => s.id === "lights" && s.fragment)) specs = specs.filter((s) => s.id !== "points");
    // a chunk the page never draws in this build is not compiled: an effect's needs(spec, data) says so (cockpit.all,
    // the build-constant cockpit passes, drawn only in a build without M2's pane targets)
    const want = specs.filter((s) => s.fragment && canvases[s.canvas] && (!s.needs || s.needs(s, D)));
    const t0 = performance.now();
    // parallel when every canvas's context has the extension (and nobody asked for the serial path)
    const parallel =
      !A3GL.serial &&
      want.length > 0 &&
      [...new Set(want.map((s) => s.canvas))].every((name) => {
        const g = canvases[name].getContext("webgl", GL_ATTRS);
        return Boolean(g && g.getExtension("KHR_parallel_shader_compile"));
      });
    const opts = {
      camera: D.camera,
      // read at each compile (init, restore): the inks as the tokens give them then
      get fixed() {
        return { uLight: light, ...inkValues };
      },
      extensions: D.extensions, onError: (spec, message) => errors.push(`${spec.id}: ${message}`) };
    info = { ok: false, pending: want.length, parallel, renderer: null, max: 0, need: 0, errors, compileMs: 0, programs: [] };
    const vectors = (layer) => {
      const g = layer.gl;
      const count = g.getProgramParameter(layer.program, g.ACTIVE_UNIFORMS);
      let rows = 0;
      for (let i = 0; i < count; i++) rows += g.getActiveUniform(layer.program, i).size;
      return rows;
    };
    // every program in: the budget check, the passes, each effect's init, data-gl; the page wakes to fade GL in
    const ready = (failed) => {
      // the layers in the registered order (the draw order on each canvas), whatever order they linked in
      for (const spec of want) if (spec.layer) (layers[spec.canvas] ??= []).push(spec);
      const compiled = want.filter((s) => s.layer).length;
      const gl = Object.values(layers)[0]?.[0]?.layer.gl ?? null;
      const max = gl ? gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) : 0;
      const need = Math.max(0, ...Object.values(layers).flat().map((s) => vectors(s.layer)));
      ok = Boolean(gl) && !errors.length && !failed.length && compiled === want.length && max >= need + 8;
      const dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
      Object.assign(info, { ok, pending: 0, renderer: gl ? gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : null, max, need, compileMs: Math.round(performance.now() - t0), programs: want.filter((s) => s.layer).map((s) => ({ id: s.id, canvas: s.canvas, ms: Math.round(s.ms), frames: s.frames })) });
      if (ok) stage.setAttribute("data-gl", "");
      for (const [name, list] of Object.entries(layers)) list.passes = glPasses(list[0].layer, canvases[name], view);
      for (const spec of specs) if (spec.init && spec.layer) spec.init(spec, { stage, controller, data });
      if (typeof console !== "undefined" && errors.length) for (const e of errors) console.warn("a380 gl:", e);
      if (parallel && ok && typeof A3GL.onRestore === "function") A3GL.onRestore();
    };
    compileAll(want, opts, parallel, ready);
    // context loss and restore (review round 3: the page called preventDefault, which promises a restore, but never
    // rebuilt anything, so it stayed on the fallbacks for the session). On restore the canvas's programs, buffers and
    // the ID mask are built again (in parallel when the extension is there) and the page hands back to GL (glShare
    // settles to 1 again)
    const lostSet = new Set();
    const rebuild = (name, done) => {
      const list = layers[name];
      if (!list) return done(true);
      const restoreOpts = { ...opts, onError: (spec, message) => console.warn("a380 gl (restore):", `${spec.id}: ${message}`) };
      for (const spec of list) spec.layer = null;
      compileAll(list, restoreOpts, parallel, (failed) => {
        if (failed.length || list.some((spec) => !spec.layer)) return done(false);
        list.passes = glPasses(list[0].layer, canvases[name], view);
        drawn[name] = false;
        for (const spec of list) if (spec.init) spec.init(spec, { stage, controller, data });
        done(true);
      });
    };
    for (const [name, canvas] of Object.entries(canvases))
      if (canvas) {
        canvas.addEventListener("webglcontextlost", (event) => {
          if (ok || info.pending) event.preventDefault(); // a restore is wanted only when GL runs (the handler below rebuilds)
          lost = true;
          lostSet.add(name);
          stage.removeAttribute("data-gl");
        });
        canvas.addEventListener("webglcontextrestored", () => {
          if (!ok) return;
          rebuild(name, (fine) => {
            if (!fine) return;
            lostSet.delete(name);
            if (!lostSet.size) {
              lost = false;
              stage.setAttribute("data-gl", "");
              if (typeof A3GL.onRestore === "function") A3GL.onRestore();
            }
          });
        });
      }
    // a GPU-process reset can lose the contexts without the event arriving first: re-check on resume and each frame
    const checkLost = () => {
      if (lost) return;
      for (const [name, list] of Object.entries(layers))
        if (list[0] && list[0].layer && list[0].layer.gl && list[0].layer.gl.isContextLost && list[0].layer.gl.isContextLost()) {
          lost = true;
          lostSet.add(name);
          stage.removeAttribute("data-gl");
          return;
        }
    };
    A3GLcheckLost = checkLost;
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", checkLost);
    return info;
  }
  let A3GLcheckLost = null;
  // fu/perf: per-canvas draw gating (PLAN item 43): a canvas keeps its last picture while nothing that feeds it
  // changed: the airframe did not move, no GL effect animates on its own (A3M8.animating: envelopes, flashes, fans,
  // beams), and the view, the canvas size, the GL share, the ground scroll, the cabin light, the model's speed and
  // height and every light's energy and anchor are the same as when it was last drawn
  const gateKey = {};
  function shouldDraw(name, fx) {
    let key = "";
    if (!fx.moved && typeof A3M8 !== "undefined" && A3M8.animating && !A3M8.animating(fx)) {
      const canvas = canvases[name];
      let e = 0;
      for (const id in fx.lights) {
        const L = fx.lights[id];
        e += (L.energy || 0) * 1.618 + (L.anchor && L.anchor.screen ? L.anchor.screen[0] + 3.7 * L.anchor.screen[1] : 0);
      }
      const pv = fx.pv || {};
      const st = fx.state || {};
      key = [view[0], view[1], view[2], view[3], canvas ? canvas.width : 0, canvas ? canvas.height : 0, fx.share, fx.first, pv.scroll, pv.cabinLight, pv.cabin, pv.paused, st.speed, st.height, st.phase, e].join(",");
    }
    if (key && gateKey[name] === key) return false;
    gateKey[name] = key;
    return true;
  }
  // fu/perf end
  function frame(fx) {
    if (A3GLcheckLost) A3GLcheckLost();
    if (!ok || lost) return;
    for (const [name, list] of Object.entries(layers)) {
      const active = list.filter((spec) => (spec.active ? spec.active(fx) : true));
      if (!active.length) {
        if (drawn[name]) {
          list.passes.clear();
          drawn[name] = false;
        }
        gateKey[name] = ""; // fu/perf: a cleared canvas draws again when it next has work fu/perf end
        continue;
      }
      if (!shouldDraw(name, fx)) continue; // fu/perf: per-canvas draw gating (PLAN item 43) fu/perf end
      const passes = list.passes;
      passes.begin(fx.clock);
      for (const spec of active) {
        const pass = (values, box) => {
          if (!box) return 0;
          spec.layer.set(values);
          return passes.pass({}, box, fx.clock, spec.layer);
        };
        spec.draw(fx, pass, spec);
      }
      passes.end();
      drawn[name] = true;
    }
  }
  /** Inspect: draw the viewBox window of zoom z centred on (cx, cy) (viewBox units). */
  function setView(z, cx, cy) {
    const w = base[0] / z;
    const h = base[1] / z;
    view[0] = w;
    view[1] = h;
    view[2] = cx - w / 2;
    view[3] = cy - h / 2;
  }
  return {
    // set true before init to compile serially (verification: the path without KHR_parallel_shader_compile)
    serial: false,
    effect,
    init,
    frame,
    setView,
    view,
    get ok() {
      return ok && !lost;
    },
    get lost() {
      return lost;
    },
    get info() {
      return info;
    },
    /** An ink role's colour as the page's tokens give it (0..1 rgb), e.g. A3GL.ink("red"); null if unknown. */
    ink: (role) => inkByRole[role] ?? null,
    /** Re-read the ink tokens now (a MutationObserver does it on a root style, class or theme change). */
    readInks: () => {
      const stage = document.querySelector(".a3-stage");
      if (!stage || !readInks(stage)) return false;
      for (const list of Object.values(layers)) for (const spec of list) if (spec.layer) spec.layer.set(inkValues);
      return true;
    },
    layers,
  };
})();

// glPasses from runtime.js draws through one layer; the harness hands each pass the effect's own layer.
const a3PassDraw = glPasses;
// eslint-disable-next-line no-func-assign
glPasses = function (layer, canvas, view) {
  const base = a3PassDraw(layer, canvas, view);
  const gl = layer.gl;
  return {
    ...base,
    pass(values, box, time, own = layer) {
      if (!box) return 0;
      // box in viewBox units → canvas pixels through the drawn window (width, height, x, y)
      const scale = canvas.width / view[0];
      const ox = view[2] ?? 0;
      const oy = view[3] ?? 0;
      const x0 = Math.max(0, Math.floor((box[0] - ox) * scale) - 1);
      const x1 = Math.min(canvas.width, Math.ceil((box[2] - ox) * scale) + 1);
      const y0 = Math.max(0, Math.floor((view[1] - (box[3] - oy)) * scale) - 1);
      const y1 = Math.min(canvas.height, Math.ceil((view[1] - (box[1] - oy)) * scale) + 1);
      if (x1 <= x0 || y1 <= y0) return 0;
      gl.scissor(x0, y0, x1 - x0, y1 - y0);
      own.draw(values, time);
      return (x1 - x0) * (y1 - y0);
    },
  };
};

// ---- the scaffold's one effect: every registered point light, one scissored pass each (GL.md §7.1)
A3GL.effect({
  id: "points",
  canvas: "air",
  active: (fx) => fx.data.lights.some((L) => (fx.lights[L.id]?.energy ?? 0) > 1e-3),
  draw(fx, pass) {
    const k = fx.data.camera.k;
    for (const L of fx.data.lights) {
      const s = fx.lights[L.id];
      if (!s || !(s.energy > 1e-3) || !s.anchor) continue;
      const [x, y] = s.anchor.screen;
      const lens = L.lens * k;
      const reach = Math.max(lens, 0.6 * (fx.data.W / (fx.canvasWidth || fx.data.W))) * L.halo * 6 + 2;
      pass({ uPt: [x, y, lens, s.energy], uPtC: [...L.dark, L.halo], uPtP: [...L.paper, 0.5], uFirst: fx.first }, [x - reach, y - reach, x + reach, y + reach]);
    }
  },
});
