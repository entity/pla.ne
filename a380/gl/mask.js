// a380/gl/mask.js (M8): the GPU order-index mask (DESIGN §6.1). Inlined in the page after gl/harness.js.
//
// Each moving frame, every live part of one layer is drawn as its projected convex hull
// (controller.frames()[i].hull, or a tube's quads), in the layer's paint order
// (controller.orderIndex(layer)), into an offscreen RGBA8 texture at 2x the canvas resolution (capped
// at 4 Mpx). Each hull is grown 0.6 viewBox px (so ink ends outside the occluder's stroke) and written
// with its 1-based paint position in R + 256 G, no blending: a texel holds the index of the topmost part
// that covers it, 0 where nothing does. A surface pass for part T keeps the fraction of its 2x2 texels
// whose index is <= T's index (nothing painted after T is there); a point pass reads 9 taps around the
// lens against its housing's index. No cover uniforms and no CPU walks: the JS is one buffer upload.
//
//   const mask = A3Mask.create(gl, { canvas, view });
//   mask.refresh(controller, "airframe");      // when the airframe moved or the canvas changed size
//   mask.bind(0);                              // texture unit 0 (a sampler2D's default)
//   mask.uniforms()                            // { uMaskInfo: [scale, width, height, 1] }
//   mask.idOf("fus.B3")                        // the part's 1-based paint position (0: not in the layer)
const A3Mask = (() => {
  // uView: the drawn viewBox window (width, height, x, y); Inspect zooms it (kit patch 10)
  const VS = "attribute vec3 a;uniform vec4 uView;varying float vId;void main(){vId=a.z;gl_Position=vec4((a.x-uView.z)/uView.x*2.-1.,1.-(a.y-uView.w)/uView.y*2.,0.,1.);}";
  const FS = "precision highp float;varying float vId;void main(){float i=floor(vId+.5);float g=floor(i/256.);gl_FragColor=vec4((i-g*256.)/255.,g/255.,0.,1.);}";

  function create(gl, { canvas, view, maxPixels = 4e6, grow = 0.6, base = 960 } = {}) {
    const fail = (why) => {
      if (typeof console !== "undefined") console.warn("a380 gl mask:", why);
      return null;
    };
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : (fail(gl.getShaderInfoLog(s)), null);
    };
    const vs = shader(gl.VERTEX_SHADER, VS);
    const fs = shader(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return null;
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return fail(gl.getProgramInfoLog(program));
    const attr = gl.getAttribLocation(program, "a");
    const uView = gl.getUniformLocation(program, "uView");
    const buffer = gl.createBuffer();
    const texture = gl.createTexture();
    const fbo = gl.createFramebuffer();
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    let width = 0;
    let height = 0;
    let scale = 0;
    let data = new Float32Array(3 * 4096);
    let idByRun = new Int32Array(0);
    let nameToRun = null;
    const stats = { parts: 0, vertices: 0, ms: 0, buildMs: 0, glMs: 0, buildMax: 0, refreshes: 0, history: [] };
    let lastCanvas = "";

    function fit() {
      const cw = Math.max(1, canvas.width);
      const ch = Math.max(1, canvas.height);
      const s = Math.min(2, Math.sqrt(maxPixels / (cw * ch)), maxTex / cw, maxTex / ch);
      const w = Math.max(1, Math.round(cw * s));
      const h = Math.max(1, Math.round(ch * s));
      if (w === width && h === height) return false;
      width = w;
      height = h;
      scale = w / cw;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) fail("framebuffer incomplete");
      return true;
    }

    // a convex polygon (flat x, y list) grown by `grow` viewBox px: mitred corners, bevelled where the
    // mitre would reach past 2·grow; then fanned into triangles with the part's id
    let poly = new Float64Array(256);
    let n = 0;
    const push = (x, y) => {
      if (2 * n + 2 > poly.length) {
        const next = new Float64Array(poly.length * 2);
        next.set(poly);
        poly = next;
      }
      poly[2 * n] = x;
      poly[2 * n + 1] = y;
      n++;
    };
    let at = 0;
    const emit = (x, y, id) => {
      if (at + 3 > data.length) {
        const next = new Float32Array(data.length * 2);
        next.set(data);
        data = next;
      }
      data[at++] = x;
      data[at++] = y;
      data[at++] = id;
    };
    function addPolygon(src, count, id) {
      if (count < 3) return;
      let area = 0;
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        area += src[2 * i] * src[2 * j + 1] - src[2 * j] * src[2 * i + 1];
      }
      if (Math.abs(area) < 1e-9) return;
      const s = area > 0 ? 1 : -1;
      n = 0;
      for (let i = 0; i < count; i++) {
        const p = (i + count - 1) % count;
        const q = (i + 1) % count;
        const x = src[2 * i];
        const y = src[2 * i + 1];
        let ax = x - src[2 * p];
        let ay = y - src[2 * p + 1];
        let bx = src[2 * q] - x;
        let by = src[2 * q + 1] - y;
        // sqrt, not Math.hypot: hypot's overflow care costs several times more per call, on every hull vertex
        const la = Math.sqrt(ax * ax + ay * ay);
        const lb = Math.sqrt(bx * bx + by * by);
        if (la < 1e-9 || lb < 1e-9) continue;
        ax /= la;
        ay /= la;
        bx /= lb;
        by /= lb;
        // outward normals of the two edges (counter-clockwise in y-down screen space when s > 0)
        const n1x = s * ay;
        const n1y = -s * ax;
        const n2x = s * by;
        const n2y = -s * bx;
        const c = n1x * n2x + n1y * n2y;
        if (c > -0.5) {
          const k = g / (1 + c);
          push(x + (n1x + n2x) * k, y + (n1y + n2y) * k);
        } else {
          push(x + n1x * g, y + n1y * g);
          push(x + n2x * g, y + n2y * g);
        }
      }
      for (let i = 1; i + 1 < n; i++) {
        emit(poly[0], poly[1], id);
        emit(poly[2 * i], poly[2 * i + 1], id);
        emit(poly[2 * i + 2], poly[2 * i + 3], id);
      }
    }

    // the growth is a constant on screen, not in viewBox units: Inspect's zoom (view[0] < base) divides it, or at 14x a
    // 0.6-unit growth (8 device px) let the glareshield's hull cover the five displays beneath it
    let g = grow;
    function refresh(controller, layer = "airframe", skip = null) {
      const t0 = performance.now();
      g = grow * Math.min(1, view[0] / base);
      const resized = fit();
      const order = controller.orderIndex(layer);
      const frames = controller.frames();
      if (!order) return false;
      if (idByRun.length !== frames.length) idByRun = new Int32Array(frames.length);
      idByRun.fill(0);
      at = 0;
      for (let k = 0; k < order.length; k++) {
        const index = order[k];
        const id = k + 1;
        idByRun[index] = id;
        const f = frames[index];
        if (!f) continue;
        if (skip && skip(index)) continue; // a part faded out on the page (an Inspect view) does not occlude
        if (f.quadN) for (let q = 0; q < f.quadN; q++) addPolygon(f.quadList[q][0], f.quadList[q][1], id);
        else addPolygon(f.hull, f.hullN, id);
      }
      const t1 = performance.now();
      // the refresh runs inside a frame's passes (the first effect that needs the mask builds it), between
      // glPasses.begin(), which turns the scissor test on, and the passes that rely on it: the test is put back as it
      // was (follow-up item 27: it stayed off, so every later pass of that frame drew the whole canvas, and a window
      // piece with two or more band boxes laid its ink two or more times: whole pieces' rows read 40 levels brighter
      // in flight, and every pass cost the full canvas)
      const scissored = gl.isEnabled(gl.SCISSOR_TEST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.BLEND);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform4f(uView, view[0], view[1], view[2] ?? 0, view[3] ?? 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, at), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(attr);
      gl.vertexAttribPointer(attr, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, at / 3);
      gl.disableVertexAttribArray(attr);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (scissored) gl.enable(gl.SCISSOR_TEST);
      stats.parts = order.length;
      stats.vertices = at / 3;
      stats.ms = performance.now() - t0;
      stats.buildMs = t1 - t0;
      stats.glMs = stats.ms - stats.buildMs;
      stats.buildMax = Math.max(stats.buildMax ?? 0, stats.buildMs);
      stats.refreshes++;
      // the last 240 refresh times (verification: the median per moving frame)
      stats.history.push(stats.ms);
      if (stats.history.length > 240) stats.history.shift();
      lastCanvas = `${canvas.width}x${canvas.height}`;
      void resized;
      return true;
    }

    return {
      refresh,
      /** True when the canvas changed size since the last refresh (the mask must be redrawn). */
      stale: () => `${canvas.width}x${canvas.height}` !== lastCanvas,
      bind(unit = 0) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
      },
      uniforms: () => ({ uMaskInfo: [scale, width, height, 1] }),
      idOf(controller, name) {
        if (!nameToRun) {
          nameToRun = new Map();
          for (const run of controller.scene().runs) nameToRun.set(run.name, run.index);
        }
        const index = nameToRun.get(name);
        return index === undefined ? 0 : idByRun[index] ?? 0;
      },
      /** Read the mask index at a viewBox point (verification only: a synchronous readPixels). */
      probe(vb) {
        const x = Math.max(0, Math.min(width - 1, Math.floor(((vb[0] - (view[2] ?? 0)) / view[0]) * width)));
        const y = Math.max(0, Math.min(height - 1, Math.floor((1 - (vb[1] - (view[3] ?? 0)) / view[1]) * height)));
        const px = new Uint8Array(4);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return px[0] + 256 * px[1];
      },
      stats,
      get size() {
        return [width, height, scale];
      },
      texture,
    };
  }
  return { create };
})();
