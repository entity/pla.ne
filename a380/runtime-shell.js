// a380/runtime-shell.js: the figure's theme-independent runtime (the theme switch). build.mjs puts the whole page
// script (the kit, the model `M`, follow `F`, the GL page files and live.js with the modules' scripts) at the BODY
// marker, inside boot(), so every boot has state of its own. Everything that state starts outside the figure's own
// elements is tracked (frame callbacks, timers, document and media-query listeners, observers, WebGL contexts), so
// stop() and release() end it all and the figure can be booted again, in the other theme, from a snapshot of its state
// (A3.snapshot() in live.js). The theme itself (its data, the vary functions, the layers' markup, the turn and GL
// data) is the argument to boot(): { name, light, data: (scope) => DATA, p: { deck, airframe, turn, gl } }.
window.__A3RT = (() => {
  const W = window;
  const realDoc = W.document;
  let live = null; // the booted figure's tracker (one at a time)
  // the WebGL contexts a figure makes, so dispose() can release them before the next boot makes its own
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const ctx = getContext.call(this, type, ...rest);
    if (live && ctx && (type === "webgl2" || type === "webgl")) live.ctxs.add(ctx);
    return ctx;
  };
  // stop(): nothing of the figure runs any more (its last frame stays on screen, so a theme switch can show it while the
  // next figure boots); release(): its WebGL contexts are given back. dispose() is both
  function stop(R) {
    if (R.dead) return;
    R.dead = true;
    for (const id of R.raf) W.cancelAnimationFrame(id);
    for (const id of R.timers) W.clearTimeout(id);
    for (const id of R.intervals) W.clearInterval(id);
    for (const [type, fn, opts] of R.docL) realDoc.removeEventListener(type, fn, opts);
    for (const [m, type, fn, opts] of R.mql) m.removeEventListener(type, fn, opts);
    for (const o of R.obs) o.disconnect();
    if (live === R) live = null;
  }
  function release(R) {
    stop(R);
    for (const gl of R.ctxs) {
      // the figure's own context-lost handlers would fall back to the canvas painter: they must not run
      const c = gl.canvas;
      if (c && c.addEventListener) c.addEventListener("webglcontextlost", (e) => e.stopImmediatePropagation(), true);
      try {
        const ext = gl.getExtension("WEBGL_lose_context");
        if (ext) ext.loseContext();
      } catch (_) {
        // a context already lost
      }
    }
    R.ctxs.clear();
  }
  async function boot(THEME, A3RT_CARRY = null) {
    if (live) throw new Error("a380: a figure is live; dispose it before booting another");
    const R = { dead: false, raf: new Set(), timers: new Set(), intervals: new Set(), docL: [], mql: [], obs: [], ctxs: new Set() };
    live = R;
    // the boot's own frame callbacks and timers: none runs after dispose()
    const requestAnimationFrame = (cb) => {
      const id = W.requestAnimationFrame((t) => {
        R.raf.delete(id);
        if (!R.dead) cb(t);
      });
      R.raf.add(id);
      return id;
    };
    const cancelAnimationFrame = (id) => {
      R.raf.delete(id);
      W.cancelAnimationFrame(id);
    };
    const setTimeout = (cb, ms, ...args) => {
      const id = W.setTimeout(() => {
        R.timers.delete(id);
        if (!R.dead) cb(...args);
      }, ms);
      R.timers.add(id);
      return id;
    };
    const clearTimeout = (id) => {
      R.timers.delete(id);
      W.clearTimeout(id);
    };
    const setInterval = (cb, ms, ...args) => {
      const id = W.setInterval(() => {
        if (!R.dead) cb(...args);
      }, ms);
      R.intervals.add(id);
      return id;
    };
    const clearInterval = (id) => {
      R.intervals.delete(id);
      W.clearInterval(id);
    };
    // media queries and the document: their listeners are removed by dispose()
    const matchMedia = (query) => {
      const m = W.matchMedia(query);
      return {
        get matches() {
          return m.matches;
        },
        media: m.media,
        addEventListener(type, fn, opts) {
          R.mql.push([m, type, fn, opts]);
          m.addEventListener(type, fn, opts);
        },
        removeEventListener: (type, fn, opts) => m.removeEventListener(type, fn, opts),
        addListener(fn) {
          R.mql.push([m, "change", fn, undefined]);
          m.addEventListener("change", fn);
        },
        removeListener: (fn) => m.removeEventListener("change", fn),
      };
    };
    // the document's listeners: build.mjs writes the body's document.addEventListener( calls as A3RT_docOn( (a Proxy
    // for the document cost every document read a trap), so dispose() can remove them
    const A3RT_docOn = (type, fn, opts) => {
      R.docL.push([type, fn, opts]);
      realDoc.addEventListener(type, fn, opts);
    };
    const ResizeObserver = class extends W.ResizeObserver {
      constructor(cb) {
        super(cb);
        R.obs.push(this);
      }
    };
    const IntersectionObserver = class extends W.IntersectionObserver {
      constructor(cb, opts) {
        super(cb, opts);
        R.obs.push(this);
      }
    };
    const MutationObserver = class extends W.MutationObserver {
      constructor(cb) {
        super(cb);
        R.obs.push(this);
      }
    };
    const A3S = { A3P: THEME.p ?? {} };
    {
      // (a block of its own: the body's top-level names may shadow the shell's)
      /*@BODY@*/
      return { A3, theme: THEME.name, snapshot: () => A3.snapshot(), stop: () => stop(R), release: () => release(R), dispose: () => release(R) };
    }
  }
  return { boot };
})();
