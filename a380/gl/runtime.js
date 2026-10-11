// a380/gl/runtime.js (M8; seeded by the scaffold from a380/spikes/gl/gl-runtime.js, unchanged). Inlined in the page after the harness.
// The A380 WebGL layer, page side. Inlined after turnScript() + glScript(): it uses the kit's
// TURN, smooth and burst and must not redeclare them. Pure helpers, no state.

// A periodic train of kit bursts (smoothstep attack, exponential decay). Airbus wingtip strobes
// are a double flash: offsets [0, gap]. max() of bursts is continuous, and the previous cycle is
// included so a tail never wraps to 0.
function flashTrain(t, { period, offsets = [0], rise = 0.03, fall = 0.06, phase = 0, hold = 0 }) {
  if (!(period > 0)) return 0;
  const cycle = (((t - phase) % period) + period) % period;
  let v = 0;
  const held = (x) => {
    // rise (smoothstep), hold falling from 1 to 0.7 (the model's beacon: 0.12 s), then an exponential fall
    if (x < 0) return 0;
    if (x < rise) return smooth(0, rise, x);
    if (x < rise + hold) return 1 - (0.3 * (x - rise)) / hold;
    return 0.7 * Math.exp(-(x - rise - hold) / fall);
  };
  for (const back of [0, period]) for (const o of offsets) v = Math.max(v, hold > 0 ? held(cycle + back - o) : burst(cycle + back - o, rise, fall));
  return v;
}

// Signed angular distance into a sector [from, to] (degrees, counter-clockwise, wraps),
// smoothed over `soft` degrees: 1 inside, 0 outside, 0.5 on the boundary.
function sectorOf(az, from, to, soft = 4) {
  const span = (((to - from) % 360) + 360) % 360 || 360;
  const a = (((az - from) % 360) + 360) % 360;
  const d = a <= span ? Math.min(a, span - a) : -Math.min(a - span, 360 - a);
  return smooth(-soft, soft, d);
}

// The viewer's direction in a group's rest frame: azimuth in degrees (0 = dead ahead along the
// group's +x, positive toward +y, the aircraft's left) and elevation in degrees.
function viewOfGroup(controller, group) {
  const V = controller.cams().world.V;
  const u = TURN.poseUniforms(controller, group, "u");
  const g = [V[0] * u.uX[0] + V[1] * u.uX[1] + V[2] * u.uX[2], V[0] * u.uY[0] + V[1] * u.uY[1] + V[2] * u.uY[2], V[0] * u.uZ[0] + V[1] * u.uZ[1] + V[2] * u.uZ[2]];
  return { dir: g, az: (Math.atan2(g[1], g[0]) * 180) / Math.PI, el: (Math.asin(Math.max(-1, Math.min(1, g[2]))) * 180) / Math.PI };
}

// Temporal band-limit for a rotating pattern. x is a harmonic's phase advance during the
// exposure (radians). A box shutter is sinc(x/2); past Nyquist (x > pi) the harmonic would alias
// into a wagon wheel, so it fades to 0 by pi.
function blurGain(x) {
  const s = x < 1e-4 ? 1 : Math.sin(x / 2) / (x / 2);
  return Math.max(0, s) * (1 - smooth(0.6 * Math.PI, Math.PI, x));
}
function fanGains(omega, exposure, blades) {
  const w = Math.abs(omega) * exposure;
  return [1, 2, 3, 4].map((k) => blurGain(k * blades * w));
}
// Reduced motion's one still frame is a 1/500 s exposure, not a running band limit: the blades blur by omega x 0.002
// (a pure sinc per harmonic), with a floor on the first harmonic so a running fan still shows its blades
function stillGain(x, floor = 0) {
  const s = x < 1e-4 ? 1 : Math.sin(x / 2) / (x / 2);
  return Math.max(floor, s);
}
function fanGainsStill(omega, exposure, blades) {
  const w = Math.abs(omega) * exposure;
  return [1, 2, 3, 4].map((k) => stillGain(k * blades * w, k === 1 ? 0.35 : 0));
}

// TURN.cover packs a count per polygon; this repacks it without counts so one vec3 array is the
// whole cover budget: an unused edge is (0,0,-1e6) and never raises the max; an empty polygon
// starts with (0,0,1e6) and is never inside.
function packCovers(cover, polygons, edges, out = new Float32Array(polygons * edges * 3)) {
  for (let p = 0; p < polygons; p++) {
    const n = cover ? cover.uCoverCount[p] ?? 0 : 0;
    for (let e = 0; e < edges; e++) {
      const at = (p * edges + e) * 3;
      if (e < n) {
        out[at] = cover.uCoverEdge[at];
        out[at + 1] = cover.uCoverEdge[at + 1];
        out[at + 2] = cover.uCoverEdge[at + 2];
      } else {
        out[at] = 0;
        out[at + 1] = 0;
        out[at + 2] = n === 0 && e === 0 ? 1e6 : -1e6;
      }
    }
  }
  return out;
}

function glHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Signed distance from q to a convex polygon (counter-clockwise, y down or up alike): < 0 inside.
function glHullDistance(q, hull) {
  let inside = -Infinity;
  let outside = Infinity;
  let isIn = true;
  const n = hull.length;
  let area = 0;
  for (let i = 0; i < n; i++) area += hull[i][0] * hull[(i + 1) % n][1] - hull[(i + 1) % n][0] * hull[i][1];
  const s = area >= 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % n];
    const ex = b[0] - a[0];
    const ey = b[1] - a[1];
    const l = Math.hypot(ex, ey) || 1;
    const side = (s * ((q[0] - a[0]) * ey - (q[1] - a[1]) * ex)) / l;
    if (side > 0) isIn = false;
    inside = Math.max(inside, side);
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * ex + (q[1] - a[1]) * ey) / (l * l)));
    outside = Math.min(outside, Math.hypot(q[0] - a[0] - ex * t, q[1] - a[1] - ey * t));
  }
  return isIn ? inside : outside;
}

function glFramePoints(f) {
  const points = [];
  if (f.quadN) for (const [buf, count] of f.quadList) for (let i = 0; i < count; i++) points.push([buf[2 * i], buf[2 * i + 1]]);
  else for (let i = 0; i < f.hullN; i++) points.push([f.hull[2 * i], f.hull[2 * i + 1]]);
  return points;
}

// Visibility (0..1) of a point light on part `name` at screen point q (viewBox): every part painted
// after it in its live layer (and in `layers` above) that covers q, by its exact convex silhouette
// pushed out `pad` (the kit cover's 0.3 vb), smoothed over `soft` vb. A point source is seen or
// not, so its whole glow (lens, halo, bloom) rides this one scalar: no per-pixel mask, no uniforms.
function pointVisibility(controller, name, q, { soft = 0.6, pad = 0.3, layers = null } = {}) {
  const scene = controller.scene();
  const frames = controller.frames();
  const run = scene.runs.find((r) => r.name === name);
  if (!run) return 1;
  let vis = 1;
  scene.layers.forEach((layer, index) => {
    if (vis <= 0 || index < run.layer) return;
    if (index > run.layer && !(layers && layers.includes(layer.name))) return;
    const order = controller.orderIndex(layer.name);
    if (!order) return;
    const from = index === run.layer ? Array.prototype.indexOf.call(order, run.index) + 1 : 0;
    for (let at = from; at < order.length && vis > 0; at++) {
      const f = frames[order[at]];
      const b = f.box;
      const r = soft + pad;
      if (q[0] < b[0] - r || q[0] > b[2] + r || q[1] < b[1] - r || q[1] > b[3] + r) continue;
      const hull = glHull(glFramePoints(f));
      if (hull.length < 3) continue;
      vis = Math.min(vis, smooth(-soft, soft, glHullDistance(q, hull) - pad));
    }
  });
  return vis;
}

// Union of the screen boxes (viewBox) of named parts, padded; null when none is found.
function partBox(controller, names, pad = 1) {
  const scene = controller.scene();
  const frames = controller.frames();
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const run of scene.runs) {
    if (!names.includes(run.name)) continue;
    const b = frames[run.index].box;
    box[0] = Math.min(box[0], b[0]);
    box[1] = Math.min(box[1], b[1]);
    box[2] = Math.max(box[2], b[2]);
    box[3] = Math.max(box[3], b[3]);
  }
  return box[0] < box[2] ? [box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad] : null;
}
function unionBox(boxes) {
  const list = boxes.filter(Boolean);
  if (!list.length) return null;
  return [Math.min(...list.map((b) => b[0])), Math.min(...list.map((b) => b[1])), Math.max(...list.map((b) => b[2])), Math.max(...list.map((b) => b[3]))];
}

// Several draws of one glLayer program on one canvas, each scissored to a screen box (viewBox)
// and composited premultiplied-over. Each pass carries its own uniforms (its own cover set), so
// the cover budget is per target and a pass only costs the pixels of its box. Every term a pass
// draws must reach 0 inside its box: the box is a bound like any other.
function glPasses(layer, canvas, view) {
  const gl = layer.gl;
  let scale = 1;
  const stats = { passes: 0, pixels: 0 };
  return {
    stats,
    begin(time) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, 0, 0, 0);
      layer.draw({ uPass: -1 }, time);
      scale = canvas.width / view[0];
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.enable(gl.SCISSOR_TEST);
      stats.passes = 0;
      stats.pixels = 0;
    },
    pass(values, box, time) {
      if (!box) return 0;
      const x0 = Math.max(0, Math.floor(box[0] * scale) - 1);
      const x1 = Math.min(canvas.width, Math.ceil(box[2] * scale) + 1);
      const y0 = Math.max(0, Math.floor((view[1] - box[3]) * scale) - 1);
      const y1 = Math.min(canvas.height, Math.ceil((view[1] - box[1]) * scale) + 1);
      if (x1 <= x0 || y1 <= y0) return 0;
      gl.scissor(x0, y0, x1 - x0, y1 - y0);
      layer.draw(values, time);
      stats.passes++;
      stats.pixels += (x1 - x0) * (y1 - y0);
      return (x1 - x0) * (y1 - y0);
    },
    end() {
      gl.disable(gl.SCISSOR_TEST);
    },
    clear() {
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },
  };
}
