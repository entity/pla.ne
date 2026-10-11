// a380/gl/runway.js (M1): the stage's page side (DESIGN §5.2, §6.1, §7.5). Inlined before live.js, after the GL
// harness (A3GL) and the kit's gl layer (settle, smooth). Plain script: no exports.
//
//   A3RUNWAY.install(A3, helpers, data)   called from parts/stage.mjs's ctx.script (A3 exists by then): hooks the
//                                          page's "deck" (every frame, even at half rate) and "frame" events
//   drawRunway(fx)                         draws the runway, taxiway and stand lights on the `runway` canvas
//
// Every frame (the "deck" hook) it writes, from the model state:
//   - scroll[set] = ground distance mod the 600 m repeat, per set (the runway's measured from its brake-release
//     anchor, so the threshold sits at the line-up point), as each set's inner translate along platter -x;
//   - setMix by phase with settle 1.0 s (stand -> taxiway at TAXI, taxiway -> runway through LINEUP);
//   - each set's opacity: setMix x speedFade (per set, from its finest transverse pitch) x seekFade x exp(-h/60 m);
//   - the shadow: blur 6 -> 18 px and opacity .35 -> .12 (light .18 -> .06) as the drawn lift goes 0 -> 6 m, scaled
//     along platter x by cos(pitch) about the pitch pivot and shifted aft as the pitched footprint is;
//   - the five contact darkenings: x (gear down) x (1 - smooth(0, 0.3 m, the gear's own height)).
// The GL lights are drawn only when their key changes (scroll, mix, displacement, threshold, pose, level, first
// light, canvas size): every frame while the deck scrolls or the turntable turns, never while it rests.
const A3RUNWAY = (() => {
  const SETS = ["stand", "taxi", "rwy"];
  const st = {
    t: 0,
    D: null, // ground distance, units (dm)
    d: 0, // this frame's displacement, units
    anchor: null, // the runway set's brake-release distance, units
    lastPhase: null,
    scroll: [0, 0, 0],
    delta: 0, // ground distance past the brake-release anchor, units
    thrX: -1e5,
    mix: [
      { x: 1, v: 0 },
      { x: 0, v: 0 },
      { x: 0, v: 0 },
    ],
    alpha: [1, 0, 0],
    sf: [1, 1, 1],
    glMix: [1, 0, 0],
    once: 0,
    level: { x: 0, v: 0 },
    shadow: null,
    contacts: [],
    key: "",
    drawn: false,
    draws: 0,
    edge: null,
  };
  let A3 = null;
  let H = null;
  let D = null;
  const specs = [null, null, null];
  let els = null;
  let resized = 0;
  const written = new Map();
  const write = (el, name, value) => {
    if (!el) return;
    const k = written.get(el) ?? {};
    if (k[name] === value) return;
    k[name] = value;
    written.set(el, k);
    if (name === "opacity") el.style.opacity = value;
    else if (name === "visibility") el.style.visibility = value;
    else el.setAttribute(name, value);
  };
  const r2 = (v) => (Math.round(v * 100) / 100).toString();
  const r3 = (v) => (Math.round(v * 1000) / 1000).toString();
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const reduced = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  // the harness compiles the fragment shipped in DATA.gl.effects (ctx.glEffect) on the runway canvas; this effect
  // is never `active` for the harness, because the page draws it itself only when its key changes (see drawRunway)
  ["runway", "runway.taxi", "runway.rwy"].forEach((id, set) =>
    A3GL.effect({
      id,
      canvas: "runway",
      active: () => false,
      init(s) {
        specs[set] = s;
      },
    }),
  );

  function install(api, helpers, data) {
    A3 = api;
    H = helpers;
    D = { ...data, light: api.data && api.data.light ? 1 : 0 };
    const stage = document.querySelector(".a3-stage");
    const q = (sel) => stage.querySelector(sel);
    // (review fu-1: each set has two copies, the markings under the aircraft's shadow and the lit fallback lights over it)
    const qa = (sel) => [...stage.querySelectorAll(sel)];
    els = {
      stage,
      sets: SETS.map((name) => qa(`.a3-set-${name}`)),
      moves: [qa(".a3-set-stand"), qa(".a3-set-taxi"), qa(".a3-rwy-rep")],
      once: qa(".a3-rwy-once"),
      shadow: q(".a3-dk-shadow"),
      footprint: q(".a3-dk-footprint"),
      blur: q("#a3-dk-shadow-blur feGaussianBlur"),
      contacts: D.gears.map((g) => q(`.a3-dk-contact[data-gear="${g.id}"]`)),
      canvas: q('[data-canvas="runway"]'),
      land: q(".a3-set-land"),
      landMove: q(".a3-land-move"),
      cloud: q(".a3-set-cloud"),
      cloudMove: q(".a3-cloud-move"),
      // the fallback lights' height groups (review fu-1): a light z above the deck is drawn on the deck plane shifted by z
      // along the floor, away from the viewer, so it projects where the GL lens is (an elevated edge light sat 2-3 CSS px low)
      ups: [...stage.querySelectorAll(".a3-rl-up")].map((el) => ({ el, z: parseFloat(el.getAttribute("data-z")) || 0 })).filter((u) => u.z > 0),
      // fu/r2-lights: the fallback lights' billboards (one inner group per kind; every light is a <use> of its kind)
      bbs: [...stage.querySelectorAll(".a3-rl-bb")],
      // and their lit groups: taken out of the render (not only at opacity 0) while GL draws every light
      lits: [...stage.querySelectorAll(".a3-rl-lit,.a3-rl-thr-g,.a3-rl-thr-r")],
    };
    // f3-lights (the deck off the per-frame layout): the platter's plane groups turn with the turntable, a new SVG
    // transform every turned frame, and every shape under them with vector-effect non-scaling-stroke (the kit's
    // .iso-svg rule) is laid out again on every one (its stroke depends on the screen transform): 1.5-2 ms of layout a
    // frame at 1440 px. A shape that strokes nothing draws the same without the effect, so it is dropped there (once,
    // here: the deck's classes never change); the stroked lines keep it (their 1 px width on screen). The sets at
    // opacity 0 (the taxiway and runway sets at the stand, the country and the cloud deck on the ground: about 1,400
    // elements) are also display:none, not only hidden, so they cost no layout either; the picture is the same.
    const deckSvg = stage.querySelector('svg[data-live="deck"]');
    if (deckSvg && typeof getComputedStyle === "function") {
      for (const plane of deckSvg.querySelectorAll(".iso-solid > g"))
        for (const el of plane.querySelectorAll("path, circle, ellipse, rect, polygon, polyline, line")) {
          const cs = getComputedStyle(el);
          if (cs.vectorEffect === "non-scaling-stroke" && cs.stroke === "none") el.style.vectorEffect = "none";
        }
    }
    if (els.canvas && typeof ResizeObserver === "function") new ResizeObserver(() => resized++).observe(els.canvas);
    api.on("deck", deck);
    api.on("frame", drawRunway);
    api.stage = st; // window.__a380.stage: the deck state, for drive checks
    api.drawRunway = drawRunway;
  }

  function deck(e) {
    if (!els) return;
    const now = performance.now();
    // the page's own clock (its dt, clamped at 0.25 s): a private 1/30 s clamp made the set mix settle ten times
    // slower than the page on a 3 fps machine (a rewind to the stand showed the runway's markings for seconds)
    const dt = typeof e.dt === "number" ? e.dt : st.t ? Math.min(Math.max((now - st.t) / 1000, 0), 1 / 30) : 1 / 60;
    st.t = now;
    const s = A3.state;
    const ch = A3.ch ?? {};
    const pv = A3.pv;
    const calm = reduced.matches;
    const Dn = (e.distance ?? s.groundDistance ?? 0) * 10;
    // reduced motion jumps: no streaks and no speed fade (one still frame shows the end state)
    st.d = st.D === null || calm ? 0 : Dn - st.D;
    st.D = Dn;
    const phase = s.phase;
    const rank = H.phaseRank(phase);
    // the brake-release distance comes from the model (s.brakeReleaseD, set as the roll begins), not from the frames
    // this hook happened to see: a reduced-motion jump or a fast seek past the line-up put the threshold under the
    // aircraft at 35 ft
    if (phase === "LINEUP" && st.lastPhase !== "LINEUP") st.anchor = Dn + 10 * H.stopDistanceOf(s.speed ?? 0);
    else if (rank < 3) st.anchor = null;
    else if (rank >= 4 && typeof s.brakeReleaseD === "number") st.anchor = 10 * s.brakeReleaseD;
    else if (st.anchor === null) st.anchor = Dn;
    st.lastPhase = phase;
    const R = D.repeat;
    st.scroll[0] = H.wrapScroll(Dn, R);
    st.scroll[1] = H.wrapScroll(Dn, R);
    st.delta = st.anchor === null ? 0 : Dn - st.anchor;
    st.scroll[2] = H.wrapScroll(st.delta, R);
    st.thrX = st.anchor === null ? -1e5 : D.thrX - st.delta;
    // set mix, fades
    const target = H.setTargetOf(phase);
    const h = Math.max(0, s.height ?? 0);
    const alt = Math.exp(-h / 60);
    const seek = pv.seekFade ?? 1;
    for (let i = 0; i < 3; i++) {
      settle(st.mix[i], target[i], dt, 1.0, calm);
      const mix = clamp01(st.mix[i].x);
      // speedFade eased (0.08 s down, 0.2 s up) so a jump in the display rate fades the stripes instead of
      // cutting them, and capped so a stripe never shows past 0.42 of its pitch per frame (it would read backward)
      const p = D.pitch[i];
      const want = H.speedFadeOf(Math.abs(st.d), p);
      const tau = want < st.sf[i] ? 0.08 : 0.2;
      st.sf[i] = calm ? want : st.sf[i] + (want - st.sf[i]) * (1 - Math.exp(-dt / tau));
      const cap = 1 - smooth(0.42 * p, 0.5 * p, Math.abs(st.d));
      st.alpha[i] = mix * Math.min(st.sf[i], cap) * seek * alt;
      const gm = mix * seek * alt;
      st.glMix[i] = gm < 0.002 ? 0 : gm; // a set that has all but settled out is not drawn (no program, no tiles)
    }
    st.once = st.anchor === null ? 0 : 1;
    for (let i = 0; i < 3; i++) {
      const a = Math.round(st.alpha[i] * 1000) / 1000;
      for (const el of els.sets[i]) {
        write(el, "opacity", String(a));
        write(el, "visibility", a > 0 ? "visible" : "hidden");
        write(el, "display", a > 0 ? "inline" : "none"); // f3-lights: out of layout too (below)
      }
      if (a > 0) for (const el of els.moves[i]) write(el, "transform", `translate(${r2(-st.scroll[i])} 0)`);
    }
    if (st.alpha[2] > 0) for (const el of els.once) write(el, "transform", `translate(${r2(Math.max(-D.onceReach, Math.min(D.onceReach, -st.delta)))} 0)`);
    // airborne: the country below at map scale (ground distance / 100), fading in as the airfield fades out and out
    // again above about 8,000 ft; a broken cloud deck from about 2,000 ft, drifting slower
    // the country stays faint under the cloud deck (it shows through the gaps at 10,000 ft)
    const landA = Math.round((1 - alt) * (1 - 0.62 * smooth(1800, 3200, h)) * seek * 1000) / 1000;
    const cloudA = Math.round(smooth(500, 2200, h) * seek * 1000) / 1000;
    write(els.land, "opacity", String(landA));
    write(els.land, "visibility", landA > 0 ? "visible" : "hidden");
    write(els.land, "display", landA > 0 ? "inline" : "none");
    if (landA > 0) write(els.landMove, "transform", `translate(${r2(-H.wrapScroll(Dn / 100, R))} 0)`);
    write(els.cloud, "opacity", String(cloudA));
    write(els.cloud, "visibility", cloudA > 0 ? "visible" : "hidden");
    write(els.cloud, "display", cloudA > 0 ? "inline" : "none");
    if (cloudA > 0) write(els.cloudMove, "transform", `translate(${r2(-H.wrapScroll(Dn / 160, R))} 0)`);
    // fu/r2-lights: the fallback's lit lights are hidden while GL draws every light
    const fbOn = (pv.glShare ?? 0) < 0.999;
    // (display, not visibility: the deck is live SVG, not the airframe painter, and a display:none subtree costs no style
    // or paint; about 600 <use> and pool elements at night, 380 by day)
    for (const el of els.lits) write(el, "display", fbOn ? "inline" : "none");
    // f3-lights: the stage carries data-a3-fb while the fallback shows (lights.mjs screens the deck's pools only then)
    if (st.fbOn !== fbOn) {
      st.fbOn = fbOn;
      els.stage.toggleAttribute("data-a3-fb", fbOn);
    }
    // the fallback's elevated lights, while the fallback shows (liftOf: the floor offset of a point z up, platter frame)
    if (els.ups.length && (pv.glShare ?? 0) < 0.999 && A3.controller) {
      const [dx, dy] = liftOf(A3.controller);
      for (const u of els.ups) write(u.el, "transform", `translate(${r2(dx * u.z)} ${r2(dy * u.z)})`);
      // fu/r2-lights: the glow is round on screen, as GL's: k·L⁻¹ for the deck plane's linear part L = [PX PY]
      // the threshold bar's lobes take the viewer's floor direction in the platter frame, as the shader's uThr.zw
      // (the vary's cos(40 − turn) stood 80° off at line-up: half the red face at b −80 where GL draws it full)
      const pose = TURN.poseUniforms(A3.controller, "air", "uAir");
      const [sa, ca, se, ce] = A3.data.gl.camera.cam;
      const V = [ca * ce, sa * ce, se];
      const vx = V[0] * pose.uAirX[0] + V[1] * pose.uAirX[1] + V[2] * pose.uAirX[2];
      const vy = V[0] * pose.uAirY[0] + V[1] * pose.uAirY[1] + V[2] * pose.uAirY[2];
      st.vaX = vx / (Math.hypot(vx, vy) || 1);
      if (els.bbs.length) {
        const B = billboardOf(A3.controller);
        if (B) for (const el of els.bbs) write(el, "transform", `matrix(${B.map(r3).join(" ")} 0 0)`);
      }
    }
    // the shadow and the contact darkenings
    const liftM = 6 * Math.tanh(h / 6);
    const pitch = Math.max(0, Math.min(12.5, ch.pitch ?? s.pitch ?? 0));
    const sh = H.shadowOf(liftM, pitch, D.light, D.shadow);
    st.shadow = sh;
    write(els.footprint, "transform", `matrix(${r3(sh.sx)} 0 0 1 ${r2(sh.tx)} 0)`);
    write(els.shadow, "opacity", r3(sh.opacity));
    write(els.blur, "stdDeviation", (Math.round(sh.blur * 10) / 10).toString());
    const gear = ch.gear ?? 1;
    D.gears.forEach((g, i) => {
      const a = H.contactOf(gear, h, pitch, g.arm, g.max) * (D.light ? D.contact[1] : D.contact[0]);
      st.contacts[i] = a;
      write(els.contacts[i], "opacity", r3(a));
      if (g.steer) write(els.contacts[i], "transform", `rotate(${r2(ch.steer ?? 0)} ${r2(g.x)} ${r2(g.y)})`);
    });
  }

  /** The platter-frame floor offset (per unit of height) whose projection equals a unit rise: away from the viewer by
   *  cot(elevation) along the horizontal view direction. */
  function billboardOf(controller) {
    const pose = TURN.poseUniforms(controller, "air", "uAir");
    const cam = A3.data.gl.camera;
    const [sa, ca, se] = cam.cam;
    const J = (p) => [p[0] * sa - p[1] * ca, (p[0] * ca + p[1] * sa) * se];
    const PX = J(pose.uAirX);
    const PY = J(pose.uAirY);
    const det = PX[0] * PY[1] - PY[0] * PX[1];
    if (Math.abs(det) < 1e-6) return null;
    return [PY[1] / det, -PX[1] / det, -PY[0] / det, PX[0] / det];
  }
  function liftOf(controller) {
    const pose = TURN.poseUniforms(controller, "air", "uAir");
    const [sa, ca, se, ce] = A3.data.gl.camera.cam;
    const cot = ce / Math.max(se, 1e-3);
    const X = pose.uAirX;
    const Y = pose.uAirY;
    return [-cot * (ca * X[0] + sa * X[1]), -cot * (ca * Y[0] + sa * Y[1])];
  }

  function drawRunway(fx) {
    if (!els || !specs.every((sp) => sp && sp.layer)) return 0;
    const list = A3GL.layers && A3GL.layers.runway;
    if (!list || !list.passes) return 0;
    settle(st.level, A3GL.ok ? 1 : 0, fx.dt ?? 1 / 60, 0.5, fx.calm);
    const level = st.level.x;
    const total = (st.glMix[0] + st.glMix[1] + st.glMix[2]) * level;
    if (!A3GL.ok || total < 1e-4) {
      if (st.drawn && A3GL.ok) list.passes.clear();
      st.drawn = false;
      st.key = "";
      return 0;
    }
    const pose = TURN.poseUniforms(fx.controller, "air", "uAir");
    // the platter frame on screen (affine) and the viewer's floor direction in it, once per draw
    const cam = (fx.data ?? A3.data.gl).camera;
    const [sa, ca, se, ce] = cam.cam;
    const J = (p) => [cam.k * (p[0] * sa - p[1] * ca), cam.k * ((p[0] * ca + p[1] * sa) * se - p[2] * ce)];
    const PO = J(pose.uAirT);
    const PX = J(pose.uAirX);
    const PY = J(pose.uAirY);
    const PZ = J(pose.uAirZ);
    const V = [ca * ce, sa * ce, se];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    let vx = dot(V, pose.uAirX);
    let vy = dot(V, pose.uAirY);
    const vl = Math.hypot(vx, vy) || 1;
    vx /= vl;
    vy /= vl;
    const d = st.d;
    // the drawn viewBox window is in the key (review fu-1: an Inspect zoom easing out, or the composition easing, moved
    // the SVG while the lights kept the old window's picture, so lenses stood in the card outside the platter's rim)
    const key = [st.scroll.map(r2).join(","), st.glMix.map(r3).join(","), r2(d), r2(st.thrX), st.once, r3(level), r3(fx.first ?? 1), resized, pose.uAirX.map(r3).join(","), pose.uAirT.map(r2).join(","), A3GL.view.map(r3).join(",")].join("|");
    if (key === st.key) return 0;
    st.key = key;
    const passes = list.passes;
    passes.begin(fx.clock ?? 0);
    // scissor only the tiles a light row's glow or pool can reach: each active row is a screen segment (its chord
    // inside the platter window) with a half-width that covers 5 halo radii and 2.6 pool radii (where the shader's
    // own windows reach 0), so every term is 0 outside the tiles drawn
    const O = [cam.origin[0] + PO[0], cam.origin[1] + PO[1]];
    const S = (x, y, z) => [O[0] + x * PX[0] + y * PY[0] + z * PZ[0], O[1] + x * PX[1] + y * PY[1] + z * PZ[1]];
    const lz = Math.hypot(PZ[0], PZ[1]);
    const segsOf = (set) => {
      const segs = [];
      for (const R of D.rows) {
        if (R.set !== set) continue;
        const rh = Math.max(R.lens * 10 * cam.k, 0.6) * R.halo;
        const h = Math.max(5 * rh, 2.6 * R.pool * cam.k) + Math.abs(R.z) * lz + 3;
        const cx = Math.sqrt(Math.max(0, D.window * D.window - R.y * R.y));
        segs.push([S(-cx, R.y, R.z), S(cx, R.y, R.z), h]);
      }
      const B = D.bar;
      if (B.set === set && st.once > 0 && Math.abs(st.thrX) < D.window + Math.abs(d) + B.reach) {
        const rh = Math.max(B.lens * 10 * cam.k, 0.6) * B.halo;
        const hb = Math.max(5 * rh, 2.6 * B.pool * cam.k) + Math.abs(B.z) * lz + 3;
        const n = Math.min(12, Math.ceil((Math.abs(d) * cam.k) / hb) + 1);
        const extra = n === 12 ? (Math.abs(d) * cam.k) / 24 : 0;
        for (let i = 0; i <= n; i++) {
          const x = st.thrX + (d * i) / n;
          segs.push([S(x, B.y0, B.z), S(x, B.y0 + (B.count - 1) * B.step, B.z), hb + extra]);
        }
      }
      return segs;
    };
    const box = D.box;
    const cols = 36;
    const rows = 18;
    const tw = (box[2] - box[0]) / cols;
    const th = (box[3] - box[1]) / rows;
    const hd = Math.hypot(tw, th) / 2;
    const near = (c, [a, b, h]) => {
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const l2 = ex * ex + ey * ey || 1;
      const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * ex + (c[1] - a[1]) * ey) / l2));
      return Math.hypot(c[0] - a[0] - ex * t, c[1] - a[1] - ey * t) < h + hd + Math.max(tw, th);
    };
    const values = { ...pose, uAxO: [O[0], O[1], PX[0], PX[1]], uAxYZ: [PY[0], PY[1], PZ[0], PZ[1]], uScroll: st.scroll, uSetMix: st.glMix, uStreak: [d, d, d], uThr: [st.thrX, st.once, vx, vy], uLevel: level, uFirst: fx.first ?? 1 };
    let tiles = 0;
    if (window.__m1Probe) st.debug = { segs: [], boxes: [], O, PX, PY, PZ };
    for (let set = 0; set < 3; set++) {
      if (!(st.glMix[set] > 0)) continue;
      const segs = segsOf(set);
      if (st.debug) st.debug.segs.push(...segs.map((sg) => [set, ...sg]));
      const layer = specs[set].layer;
      // the uniforms go to the program before any tile: a pass whose tile lies off the canvas returns before it draws,
      // and at Inspect zoom most tiles do, so the first tile's values never arrived and the lights were drawn with an
      // earlier pose (displaced 25 vb, and cut by the tiles of the true pose)
      layer.set(values);
      let first = false;
      for (let r = 0; r < rows; r++) {
        let run = -1;
        for (let c = 0; c <= cols; c++) {
          const on = c < cols && segs.some((sg) => near([box[0] + (c + 0.5) * tw, box[1] + (r + 0.5) * th], sg));
          if (on && run < 0) run = c;
          if (!on && run >= 0) {
            passes.pass(first ? values : {}, [box[0] + run * tw, box[1] + r * th, box[0] + c * tw, box[1] + (r + 1) * th], fx.clock ?? 0, layer);
            if (st.debug) st.debug.boxes.push([set, box[0] + run * tw, box[1] + r * th, box[0] + c * tw, box[1] + (r + 1) * th]);
            first = false;
            tiles += c - run;
            run = -1;
          }
        }
      }
    }
    st.tiles = tiles;
    passes.end();
    st.drawn = true;
    st.draws++;
    if (window.__m1Probe) probeEdges();
    return 1;
  }

  // drive checks: the largest alpha in the outer 2 rows and columns of the runway canvas right after a draw
  function probeEdges() {
    const gl = specs[0].layer.gl;
    const c = els.canvas;
    const w = c.width;
    const hgt = c.height;
    let most = 0;
    const read = (x, y, cw, chh) => {
      const buf = new Uint8Array(cw * chh * 4);
      gl.readPixels(x, y, cw, chh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      for (let i = 3; i < buf.length; i += 4) most = Math.max(most, buf[i]);
    };
    read(0, 0, w, 2);
    read(0, hgt - 2, w, 2);
    read(0, 0, 2, hgt);
    read(w - 2, 0, 2, hgt);
    st.edge = Math.max(st.edge ?? 0, most);
  }

  return { install, deck, draw: drawRunway, state: st };
})();
function drawRunway(fx) {
  return A3RUNWAY.draw(fx);
}
