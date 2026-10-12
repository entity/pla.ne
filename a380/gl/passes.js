// a380/gl/passes.js (M8): the per-kind air and ground programs on the page (DESIGN §6.1–6.4).
// Inlined after gl/runtime.js, gl/harness.js and gl/mask.js, before live.js. The programs themselves are
// generated in Node (parts/lights.mjs) and shipped in DATA.gl.effects; this file registers each one's page side
// with the scaffold's harness (A3GL.effect: active, draw), keeps the envelopes, anchors and boxes, draws the
// ID mask (gl/mask.js) when the airframe moved, and writes the fallbacks' vary alphas.
//
//   air:    windows · cockpit · engines · washes · lights (the `points` kind) · volumes (beams and haze; by day the haze)
//   ground: ground (pools and the back half of the haze; in dark the beacon and strobe washes and the beams' back halves)
//
// A3M8.frame(fx) runs from A3.on("frame") (parts/lights.mjs ctx.script) before A3GL.frame(fx); the effects draw
// in A3GL.frame. Nothing here generates GLSL. drawGL(fx) is DESIGN's name for one GL frame (= A3GL.frame).
// Ink logging (drive probes): window.__a380m8.log(true) collects a row per frame (levels and energies of every
// light), window.__a380m8.ink(key | true) reads back the ink each pass lays (verification only).
const A3M8 = (() => {
  const M8 = { A3: null, D: null, G: null, mask: null, maskDirty: true, maskFrame: -1, frame: 0, js: 0, jsMax: 0 };
  const env = new Map();
  const alphas = new Map();
  const st = { view: null, V: [0, 0, 1], lights: [], lamps: [], lampS: null, lampD: null, lampC: null, wS: new Float32Array(18), wD: new Float32Array(18), wC: new Float32Array(24), doors: new Float32Array(20), cutFd: 0, first: 0, levels: { cockpit: 0, logo: 0, wing: 0, engine: 0 }, exposure: 1 / 60, moved: true, nPool: 0, ownFan: false };
  const logState = { on: false, rows: [], max: 4000 };
  const inkProbe = { want: null, rows: [] };
  const E = (key, x0 = 0) => {
    let e = env.get(key);
    if (!e) env.set(key, (e = { x: x0, v: 0 }));
    return e;
  };
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // a light's ink from its colour's CSS token (follow-up item 35: A3GL.ink reads --a3-gl-<colour> on the page); the
  // build's values only if the token cannot be read. A page has one theme, so the one value serves both branches
  const inkOf = (color, fallback) => A3GL.ink(color) ?? fallback;
  const coneCos = (cone) => {
    if (!cone) return [Math.cos((20 * Math.PI) / 180), Math.cos((10 * Math.PI) / 180)];
    // a cone may come as [outer, inner] degrees, cosines, { outer, inner }, or one outer angle (inner half of it)
    const a = typeof cone === "number" ? [cone, cone * 0.5] : Array.isArray(cone) ? cone : [cone.outer, cone.inner];
    return a[0] <= 1 && a[1] <= 1 ? [a[0], a[1]] : [Math.cos((a[0] * Math.PI) / 180), Math.cos((a[1] * Math.PI) / 180)];
  };

  // controller.anchor without its per-call group lookup (scene.groups.findIndex by name, ~120 groups on the full
  // figure): the same arithmetic as the kit's t3Anchor, with the group index cached per scene. Every anchor M8
  // takes per moving frame (lights, lamps, window bands, inlets, plumes) goes through here.
  let groupIdx = null;
  function anchorOf(c, name, point, direction) {
    const scene = c.scene();
    if (!groupIdx || groupIdx.scene !== scene) {
      groupIdx = new Map();
      groupIdx.scene = scene;
      scene.groups.forEach((g, i) => groupIdx.set(g.name, i));
    }
    const index = name === null || name === undefined ? -1 : groupIdx.get(name) ?? -1;
    const cams = c.cams();
    const cam = index >= 0 ? cams[index] : cams.world;
    const o = index >= 0 ? scene.groups[index].origin : [0, 0, 0];
    const R = cam.R;
    const q0 = point[0] - o[0];
    const q1 = point[1] - o[1];
    const q2 = point[2] - o[2];
    const world = [R[0] * q0 + R[1] * q1 + R[2] * q2 + cam.t[0], R[3] * q0 + R[4] * q1 + R[5] * q2 + cam.t[1], R[6] * q0 + R[7] * q1 + R[8] * q2 + cam.t[2]];
    const w = cams.world;
    const out = { world, screen: [w.ox + w.m[0] * world[0] + w.m[1] * world[1] + w.m[2] * world[2], w.oy + w.m[3] * world[0] + w.m[4] * world[1] + w.m[5] * world[2]] };
    if (direction) out.direction = [R[0] * direction[0] + R[1] * direction[1] + R[2] * direction[2], R[3] * direction[0] + R[4] * direction[1] + R[5] * direction[2], R[6] * direction[0] + R[7] * direction[1] + R[8] * direction[2]];
    return out;
  }

  // ---------------------------------------------------------------------------------------------- setup
  function attach(A3) {
    M8.A3 = A3;
    M8.D = A3.data.mod.m8;
    M8.G = A3.data.gl;
    const D = M8.D;
    const G = M8.G;
    if (!D || !G) return;
    const N = D.nLamps;
    st.lampS = new Float32Array(3 * N);
    st.lampD = new Float32Array(3 * N);
    st.lampC = new Float32Array(4 * N);
    st.lights = G.lights.map((L) => ({
      L,
      white: L.color === "white" ? 1 : 0,
      // a beacon's envelope is the model's (M.LIGHTS.flash.beacon, an LED's hold and fast fall: D.beaconFlash), whoever
      // registered the light; strobes keep their registered double or single pulse
      flash: L.kind === "beacon" && D.beaconFlash ? D.beaconFlash : L.flash ?? (L.kind === "strobe" ? { period: 1, offsets: [0, 0.11], rise: 0.05, fall: 0.04 } : L.kind === "beacon" ? { period: 1, offsets: [0], rise: 0.04, hold: 0.08, fall: 0.03, phase: 0.5 } : null),
      energy: 0,
      level: 0,
      flashV: 0,
      anchor: null,
      facing: 0,
      sector: 1,
      fallback: 0,
    }));
    st.lamps = (G.lamps ?? []).map((L) => {
      const sw = L.switch ?? "";
      const def = D.lamps[sw] ?? {};
      // a pool or beam lamp's elliptical spread [horizontal, vertical] (deg): registered, or from a registered
      // round cone (beam lamps keep the switch's vertical spread: a nose lamp's beam is wide and flat), or the default
      const outer = typeof L.cone === "number" ? L.cone : Array.isArray(L.cone) && L.cone[0] > 1 ? L.cone[0] : L.cone && L.cone.outer ? L.cone.outer : null;
      const beam = L.beam ?? def.beam ?? false;
      const spread = L.spread ?? (outer ? [outer, beam ? Math.min(outer, def.spread?.[1] ?? 6) : outer] : null) ?? def.spread ?? [20, 20];
      const tan = spread.map((a) => Math.tan((Math.min(a, 80) * Math.PI) / 180));
      return { L, sw, cos: coneCos(L.cone ?? def.cone), tan, power: L.power ?? def.power ?? 400, reach: L.reach ?? def.reach ?? 20, beam, lens: (L.lens ?? def.lens ?? 0.1) * 10, wash: L.wash ?? def.wash ?? null, level: 0, energy: 0, facing: 0, anchor: null, slot: -1 };
    });
    // wash lamps go to their program slots (logo L/R, wing scan L/R, engine scan L/R); the rest to the lamp arrays
    let n = 0;
    for (const T of st.lamps) {
      if (T.wash) {
        const key = T.sw === "logo" ? "logo" : T.sw === "engine" ? "engine" : "wing";
        T.slot = D.slots[key][(T.L.at?.[1] ?? 0) < 0 ? 0 : 1];
      } else if (n < N) T.index = n++;
    }
    st.nPool = n;
    // fan phase: M4 keeps pv.fanPhase when it is built; otherwise M8 does
    st.ownFan = !A3.data.mod.engines;
  }

  // ---------------------------------------------------------------------------------------------- frame
  function frame(fx) {
    const D = M8.D;
    if (!D) return;
    const t0 = performance.now();
    offPoints();
    if (!M8.logged && A3GL.info && !A3GL.info.pending) {
      // the limits and each program's compile + link time, once (DESIGN §6.1)
      const I = A3GL.info;
      M8.logged = true;
      if (typeof console !== "undefined") console.info(`a380 gl M8: ${I.ok ? "on" : "fallback"} · ${I.renderer} · MAX_FRAGMENT_UNIFORM_VECTORS ${I.max}, largest program ${I.need} · ${I.programs.map((p) => `${p.id} ${p.ms} ms`).join(", ")} · mask ${M8.mask ? M8.mask.size.slice(0, 2).join("×") : "none"}`);
    }
    const s = fx.state;
    const pv = fx.pv;
    const c = fx.controller;
    // live.js's first rAF tick can carry a negative dt (its timestamp precedes the synchronous first tick),
    // which drives a critically damped settle past its target: clamp dt, and clamp first light to [0, 1]
    // the page's own dt (clamped at 0.25 s as live.js clamps it): at the tour's measured 15 fps a 1/30 s clamp settled
    // every envelope at half speed (review round 3). Paused, the model-driven envelopes stand still with the model
    const dt = fx.pv && fx.pv.paused ? 0 : Math.max(0, Math.min(fx.dt, 0.25));
    const dtSw = Math.max(0, Math.min(fx.dt, 0.25)); // fu/r2-interaction: switch envelopes (l:, p:, w:, sw:) settle while paused too (a switch pressed while paused lights; flashes stay frozen) fu/r2-interaction end
    const calm = fx.calm;
    st.first = clamp01(fx.first);
    const share = clamp01(1 - (pv.glShare || 0));
    M8.frame++;
    if (fx.moved || !st.view) {
      st.view = viewOfGroup(c, "pitch");
      st.V = c.cams().world.V;
      M8.maskDirty = true;
      M8.maskStamp = (M8.maskStamp ?? 0) + 1;
      st.moved = true;
    } else st.moved = false;
    const b = st.view.az;
    const V = st.V;
    const lightsOn = s.lights ?? {};
    const gearDown = (fx.ch.gear ?? 1) > 0.995 ? 1 : 0;
    const gateOf = (g) => (g === "gear" || g === "downlock" ? gearDown : 1);
    // point lights: envelope (switch × gate) × flash × sector × lens facing; visibility comes from the mask
    for (const P of st.lights) {
      const L = P.L;
      const on = (L.switch ? (lightsOn[L.switch] ? 1 : 0) : 1) * gateOf(L.gate);
      const e = E(`l:${L.id}`);
      settle(e, on, dtSw, L.settle ?? 0.22, calm); // fu/r2-interaction: dtSw
      P.level = clamp01(e.x);
      // reduced motion: steady at reduced energy, no pulse (a beacon or strobe the panel shows on must be seen)
      // (a steady strobe at .15: at .25 its white glow whitened the nav lens beside it)
      P.flashV = P.flash ? (calm ? (L.kind === "strobe" ? 0.15 : 0.6) : flashTrain(fx.clock, P.flash)) : 1;
      P.sector = L.sector ? sectorOf(b, L.sector[0], L.sector[1], 5) : 1;
      if (st.moved || !P.anchor) {
        P.anchor = anchorOf(c, L.group, L.at, L.normal);
        // a wingtip strobe (outboard normal) is seen at full brightness from dead ahead and astern too: it fades
        // only when the wing's own tip is between it and the reader
        const fd = P.anchor.direction ? dot3(P.anchor.direction, V) : 1;
        P.facing = L.kind === "strobe" && L.normal && Math.abs(L.normal[1]) > 0.9 ? smooth(-0.55, -0.1, fd) : smooth(-0.12, 0.22, fd);
      }
      P.energy = P.level * P.flashV * P.sector * P.facing;
      P.fallback = P.level * P.flashV * P.sector * share;
    }
    // lamps: envelope, anchor (sub-groups move), lens facing inside the beam, uniforms
    const N = D.nLamps;
    st.lampC.fill(0);
    st.wC.fill(0);
    for (const T of st.lamps) {
      const L = T.L;
      const on = (lightsOn[T.sw] ? 1 : 0) * gateOf(L.gate);
      const e = E(`p:${L.id}`);
      settle(e, on, dtSw, L.settle ?? 0.3, calm); // fu/r2-interaction: dtSw
      T.level = clamp01(e.x);
      if (st.moved || !T.anchor) T.anchor = anchorOf(c, L.group, L.at, L.dir);
      const a = T.anchor;
      T.facing = smooth(0.2, 0.95, a.direction ? dot3(a.direction, V) : 0);
      T.energy = T.level * T.facing;
      if (T.slot >= 0) {
        st.wS.set(a.world, 3 * T.slot);
        st.wD.set(a.direction, 3 * T.slot);
        st.wC.set([T.cos[0], T.cos[1], T.power * T.level, T.reach], 4 * T.slot);
      } else if (T.index !== undefined && T.index < N) {
        st.lampS.set(a.world, 3 * T.index);
        st.lampD.set(a.direction, 3 * T.index);
        st.lampC.set([T.tan[0], T.tan[1], T.power * T.level, T.beam ? T.reach : -T.reach], 4 * T.index);
      }
    }
    // cabin, cockpit, doors, logo and scan levels
    const cabin = E("cabin", s.cabin ?? 1);
    settle(cabin, s.cabin ?? 1, dt, 1.3, calm);
    pv.cabinLight = clamp01(cabin.x);
    st.blinds = clamp01(s.blinds ?? 1); // the window blinds (model.mjs): 1 the stand's 7% down, 0 all open
    const powered = (s.apu ?? 0) > 0.02 || (s.engineRun ?? []).some((r) => r) ? 1 : 0;
    const ck = E("cockpit");
    settle(ck, powered, dt, 0.7, calm);
    st.levels.cockpit = clamp01(ck.x);
    D.doorIds.forEach((id, i) => (st.doors[i] = clamp01(fx.ch[`door.${id}`] ?? 0)));
    st.cutFd = c.values["cut.fd"] ?? 0;
    const lv = (sw) => {
      const e = E(`w:${sw}`);
      settle(e, lightsOn[sw] ? 1 : 0, dtSw, 0.35, calm); // fu/r2-interaction: dtSw
      return clamp01(e.x);
    };
    st.levels.logo = lv("logo");
    st.levels.wing = lv("wing");
    st.levels.engine = lv("engine");
    // engines: N1 (the model already lags it: τ 1.9 s up, 3.0 s down), fan phase, exposure
    const n1 = (s.n1 ?? [0, 0, 0, 0]).map((v) => (v || 0) / 100);
    pv.n1 = n1;
    if (st.ownFan) {
      pv.fanPhase ??= [0, 0, 0, 0];
      n1.forEach((v, i) => {
        if (!calm && !pv.paused) pv.fanPhase[i] = (pv.fanPhase[i] + ((2 * Math.PI * D.fan.rpm100 * v) / 60) * dt) % (2 * Math.PI);
      });
    }
    // reduced motion: a short exposure, so a turning fan's blades still read in the one still frame
    st.exposure = calm ? 1 / 500 : Math.min(dt, 1 / 30);
    // fallbacks: the harness's light billboards (live.js writes them without sector or gate: corrected here),
    // and M8's own vary classes through alpha(key)
    // (review fu-1: M8 draws every point light's fallback lens itself, lights.mjs lensSvg: the harness's billboard stays
    // at 0, and a lens with a copy on the part that carries it shows the copy on whichever part is painted later)
    try {
      // eslint-disable-next-line no-undef
      if (typeof alpha !== "undefined") for (const P of st.lights) alpha[`a3-l-${P.L.id}`] = 0;
    } catch (_) {
      /* live.js not ready */
    }
    if (st.moved || !st.lensLater) st.lensLater = lensLater(c);
    const ground = (1 - smooth(0.5, 3, fx.ch.pitch ?? 0)) * (1 - smooth(0, 4, fx.ch.lift ?? 0)) * (1 - smooth(15, 60, s.height ?? 0));
    alphas.clear();
    for (const T of st.lamps) {
      // f3-lights: the fallback lens is covered as the GL's is (pointVis: the share of 9 taps no later-painted part covers)
      alphas.set(`lamp:${T.L.id}`, T.level * share * (share > 0 && T.level > 0 ? lampVisCpu(fx, T) : 1));
      alphas.set(`pool:${T.sw}:${T.L.id}`, T.level * ground * share);
    }
    for (const sw of ["camera", "cargoFlood", "gearBay", "runwayTurnoff"]) {
      const e = E(`sw:${sw}`);
      settle(e, lightsOn[sw] ? 1 : 0, dtSw, 0.3, calm); // fu/r2-interaction: dtSw
      alphas.set(`sw:${sw}`, clamp01(e.x) * ground * share);
    }
    // the ground's flash washes and the beam shafts without WebGL (lights.mjs fallbacks): dark only, as the ground and
    // volumes programs draw them, with the same envelopes (review fu-1)
    if (!D.light) {
      const washH = 1 - smooth(15, 60, s.height ?? 0);
      for (const P of st.lights) {
        if (P.L.kind === "beacon" && P.L.normal && P.L.normal[2] < -0.5) alphas.set("beacon:pool", P.level * (calm ? 0.1 : P.flashV) * washH * share);
        else if (P.L.kind === "strobe") alphas.set(`strobe:pool:${P.L.id}`, P.level * P.flashV * washH * share);
      }
      for (const T of st.lamps) if (T.beam) alphas.set(`beam:${T.L.id}`, T.level * share);
    }
    for (const P of st.lights) {
      const later = st.lensLater.get(P.L.id) ?? 0;
      alphas.set(`pt:${P.L.id}:0`, P.fallback * (1 - later));
      alphas.set(`pt:${P.L.id}:1`, P.fallback * later);
      // f4-lights: a flasher's night halo at ×1 and ×2.5 (lights.mjs), crossfaded by the swell 0.8 + 1.7 flash (none calm)
      if (!D.light && (P.L.kind === "strobe" || P.L.kind === "beacon")) {
        const u = fx.calm ? 0 : clamp01((1.7 * P.flashV - 0.2) / 1.5);
        // (nested in the lens billboard, whose alpha pt: already carries the light's level and flash)
        alphas.set(`ph:${P.L.id}`, 1 - u);
        alphas.set(`pw:${P.L.id}`, u);
      }
    }
    alphas.set("wash:logo:-1", st.levels.logo * share);
    alphas.set("wash:logo:1", st.levels.logo * share);
    alphas.set("wash:wing:-1", st.levels.wing * share);
    alphas.set("wash:wing:1", st.levels.wing * share);
    for (const e of D.engines) alphas.set(`wash:engine:${e.n}`, st.levels.engine * share);
    alphas.set("cockpit", st.levels.cockpit * (1 - smooth(3, 14.5, st.cutFd)) * share);
    pv.m8 = st.levels;
    if (D.light) {
      pv.winCore = winCoreOf();
      pv.winA = winAlphasOf(); // fu/r2-lights
    }
    pv.glPxW = glPxWeights();
    if (logState.on) logRow(fx);
    M8.js = performance.now() - t0;
    if (fx.moved) M8.jsMoved = M8.js;
    M8.jsMax = Math.max(M8.jsMax, M8.js);
  }

  // the stage's CSS width, read once and again on a resize (no layout read in the frame)
  const stageBox = { width: 0, watch: false };
  const stageWidth = () => {
    if (!stageBox.width) {
      const el = document.querySelector(".a3-stage");
      if (!el) return 0;
      stageBox.width = el.getBoundingClientRect().width;
      if (!stageBox.watch && typeof ResizeObserver === "function") {
        stageBox.watch = true;
        new ResizeObserver(() => (stageBox.width = 0)).observe(el);
      }
    }
    return stageBox.width;
  };
  /**
   * The share of a lit window's pale core by daylight, as the windows program draws it (shaders.mjs glslWindowPart):
   * the core comes in with the pane's size on the GL canvas (`small`: pixels per metre along the barrel, on the GL canvas,
   * capped at 1.5 device px per CSS px) through lampInk's core blend at the pane's centre (energy 2.4 × 1.064 × eS,
   * × (.4 + .6 × the cabin level) as the dimmed ink),
   * rescaled to 0 at its 1x value (review fu-1: the no-WebGL pane is then the GL's at Inspect zoom and unchanged at 1x).
   * Read by skin.mjs's a3-win-hot (the warm rim) and a3-win-core (the pale core) by daylight.
   */
  function winCoreOf() {
    const G = M8.G;
    if (!G || !st.view) return 0;
    const W0 = G.W ?? 960;
    const zoom = W0 / A3GL.view[0];
    const ratio = Math.min(1.5, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    const ax = st.view.dir[0];
    const pxPerM = G.camera.k * 10 * Math.sqrt(Math.max(0, 1 - ax * ax)) * ((stageWidth() * ratio) / W0) * zoom;
    const small = 1 - smooth(2, 4, pxPerM * 0.3);
    // dimmed, the core's energy falls as the shader's dim ink does (× (.4 + .6 level))
    const lv = Math.max(M8.A3?.pv?.cabinLight ?? 1, 1e-3);
    const m = 1 - Math.exp(-2.4 * 1.064 * (1 - 0.55 * small) * (0.4 + 0.6 * Math.min(1, lv)));
    const w = smooth(0.64, 0.97, m);
    // (held at 0 under a tenth: at 1x the pane is the 1x amber, unchanged)
    return smooth(0.1, 1, clamp01((w - 0.0463) / (0.9432 - 0.0463)));
  }

  /**
   * fu/r2-lights: the daylight fallback pane's layer alphas [amber, rim, core, glass under the core] (skin.mjs a3-win-lit,
   * a3-win-hot, a3-win-core over a3-win-cbase, over the glass; the shut doors' portholes alike), fitted so the panes' centre and rim composite what the
   * windows program lays there (shaders.mjs glslWindowPart's paper branch, ported: lampInk of 2.4 × lum × eS, dimmed in
   * energy by .4 + .6 × the cabin, normalised to the gate's ink, × the cover floor pc and the cap .92, over the glass),
   * at this frame's pane size on the GL canvas (`small`) and cabin level. Review fu-r2: at the Tail and Wing gear zooms with
   * the cabin dimmed the GL panes are the glass (192,195,193), the fallback stayed amber (208,188,152). Cached on
   * (small, cabin) to two decimals; the colours come from DATA (lights.mjs page.winPaper).
   */
  const winFit = { key: "", value: null };
  function winAlphasOf() {
    const WP = M8.D.winPaper;
    const G = M8.G;
    if (!WP || !G || !st.view) return null;
    const W0 = G.W ?? 960;
    const zoom = W0 / A3GL.view[0];
    const ratio = Math.min(1.5, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    const ax = st.view.dir[0];
    const pxPerM = G.camera.k * 10 * Math.sqrt(Math.max(0, 1 - ax * ax)) * ((stageWidth() * ratio) / W0) * zoom;
    const small = 1 - smooth(2, 4, pxPerM * 0.3);
    const lv = Math.max(0, Math.min(1, M8.A3?.pv?.cabinLight ?? 1));
    const key = `${small.toFixed(2)}|${lv.toFixed(2)}`;
    if (key === winFit.key) return winFit.value;
    const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const lamp = (e) => {
      const m = 1 - Math.exp(-e);
      let sn = mix([1, 1, 1], WP.rim, smooth(0, 0.3, m));
      sn = mix(sn, WP.body, smooth(0.2, 0.55, m));
      sn = mix(sn, WP.core, smooth(0.64, 0.97, m));
      const ab = sn.map((v) => 1 - v);
      const a = Math.max(ab[0], ab[1], ab[2], 0.92 * smooth(0.5, 0.9, m));
      return [a - ab[0], a - ab[1], a - ab[2], a];
    };
    const inkOf = (k) => k[3] - (0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2]);
    const lvD = Math.pow(lv, 0.66);
    const pc = 0.5 * smooth(0, 0.4, lvD) + 0.5 * smooth(0.4, 1, lvD);
    const eS = 1 - 0.55 * small;
    const seen = (lum) => {
      const full = lamp(2.4 * lum * eS);
      const dim = lamp(2.4 * lum * eS * (0.4 + 0.6 * lv));
      const r = (inkOf(full) / Math.max(inkOf(dim), 1e-4)) * pc * 0.92;
      const a = Math.min(1, Math.max(0, dim[3] * r));
      return WP.glass.map((g, i) => Math.min(Math.max(0, dim[i] * r), a) + g * (1 - a));
    };
    const Tc = seen(1.12 * 0.95);
    // the rim band (the pane's edge to the core's inset, 2 cm): the mean of the shader's 3 cm ramp across it
    const Tr = [0.002, 0.006, 0.01, 0.014, 0.018].map((x) => seen((0.62 + 0.5 * smooth(0, 0.03, x)) * 0.95)).reduce((t, c) => [t[0] + c[0] / 5, t[1] + c[1] / 5, t[2] + c[2] / 5], [0, 0, 0]);
    const L = WP.layers;
    const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
    let best = null;
    for (let i = 0; i <= 20; i++)
      for (let j = 0; j <= 20; j++) {
        const R = mix(mix(WP.glass, L.amber, i / 20), L.rim, j / 20);
        const e = d2(R, Tr);
        if (!best || e < best.e) best = { e, a1: i / 20, a2: j / 20, R };
      }
    // the centre: a glass underlay (a3-win-cbase) and the pale core over the rim's composite, both on the inset path (the
    // GL centre can be cooler than its rim: dimmed at Inspect zoom it is the glass inside a warm rim)
    let bc = null;
    for (let i = 0; i <= 20; i++)
      for (let j = 0; j <= 20; j++) {
        const C = mix(mix(best.R, WP.glass, i / 20), L.core, j / 20);
        const e = d2(C, Tc);
        if (!bc || e < bc.e) bc = { e, a4: i / 20, a3: j / 20 };
      }
    winFit.key = key;
    winFit.value = [best.a1, best.a2, bc.a3, bc.a4];
    return winFit.value;
  }

  // f3-lights: a beam lamp's fallback lens, covered as the GL covers it. The points program shows a lamp's lens by the
  // ID mask (gl/mask.js: every airframe part's screen hull, grown g, in paint order; pointVis: of 9 taps, the centre and 8
  // at max(lens, 0.8) viewBox units round it, the share whose topmost part is the housing or one painted before it). The
  // fallback billboard had only its facing fade, so a lens under a part painted after its housing showed through (the
  // nose-strut lamps' glow over the nose-gear doors and radome at b10). This is the same rule on the CPU, from the same
  // hulls, the same grow and the same faded-run skip, recomputed only when the airframe moved or the fades changed.
  // All lit lamps are done together, once per stamp: each part's screen box is found once and tested against the lamps
  // painted before it whose taps it can reach.
  const lampVis = new Map(); // id → v, for lampStamp
  let lampStamp = "";
  function lampVisCpu(fx, T) {
    const c = fx.controller;
    if (!c || !T.anchor || !T.anchor.screen) return 1;
    const stamp = `${M8.maskStamp}|${fadeState()}`;
    if (stamp !== lampStamp || !lampVis.has(T.L.id)) {
      if (stamp !== lampStamp) lampVis.clear();
      lampStamp = stamp;
      lampVisAll(fx, c);
    }
    return lampVis.get(T.L.id) ?? 1;
  }
  function lampVisAll(fx, c) {
    if (!runByName) {
      runByName = new Map();
      for (const run of c.scene().runs) runByName.set(run.name, run);
    }
    const order = c.orderIndex("airframe");
    if (!order) return;
    const posOf = new Map();
    for (let k = 0; k < order.length; k++) posOf.set(order[k], k);
    const view = A3GL.view || [M8.G.W ?? 960, 1, 0, 0];
    const g = 0.6 * Math.min(1, view[0] / (M8.G.W ?? 960));
    const list = [];
    let first = order.length;
    for (const T of st.lamps) {
      if (!(T.level > 0) || !T.anchor || !T.anchor.screen || lampVis.has(T.L.id)) continue;
      const run = runByName.get(T.L.part);
      const kH = run ? posOf.get(run.index) ?? -1 : -1;
      if (kH < 0) {
        lampVis.set(T.L.id, 1);
        continue;
      }
      const [x, y] = T.anchor.screen;
      const r = Math.max(T.lens * M8.G.camera.k, 0.8);
      const tx = new Float64Array(9);
      const ty = new Float64Array(9);
      tx[0] = x;
      ty[0] = y;
      for (let i = 0; i < 8; i++) {
        tx[i + 1] = x + r * Math.cos(i * 0.7853982);
        ty[i + 1] = y + r * Math.sin(i * 0.7853982);
      }
      list.push({ T, kH, tx, ty, box: [x - r - g, y - r - g, x + r + g, y + r + g], covered: new Uint8Array(9) });
      if (kH < first) first = kH;
    }
    if (!list.length) return;
    const frames = c.frames();
    const skip = fadedRuns(fx);
    const test = (h, n, k) => {
      if (n < 3) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, area = 0;
      for (let i = 0; i < n; i++) {
        const px = h[2 * i], py = h[2 * i + 1];
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
        const j = (i + 1) % n;
        area += px * h[2 * j + 1] - h[2 * j] * py;
      }
      if (Math.abs(area) < 1e-9) return;
      const sg = area > 0 ? 1 : -1;
      for (const E of list) {
        if (E.kH >= k || x0 > E.box[2] || x1 < E.box[0] || y0 > E.box[3] || y1 < E.box[1]) continue;
        for (let t = 0; t < 9; t++) {
          if (E.covered[t]) continue;
          let inside = true;
          for (let i = 0; i < n && inside; i++) {
            const j = (i + 1) % n;
            let ex = h[2 * j] - h[2 * i], ey = h[2 * j + 1] - h[2 * i + 1];
            const l = Math.sqrt(ex * ex + ey * ey);
            if (l < 1e-9) continue;
            ex /= l;
            ey /= l;
            // the outward distance (mask.js's edge normal (s·ay, −s·ax)) at most the grow
            if ((E.tx[t] - h[2 * i]) * sg * ey - (E.ty[t] - h[2 * i + 1]) * sg * ex > g) inside = false;
          }
          if (inside) E.covered[t] = 1;
        }
      }
    };
    for (let k = first + 1; k < order.length; k++) {
      const index = order[k];
      const f = frames[index];
      if (!f || (skip && skip(index))) continue;
      if (f.quadN) for (let q = 0; q < f.quadN; q++) test(f.quadList[q][0], f.quadList[q][1], k);
      else test(f.hull, f.hullN, k);
    }
    for (const E of list) {
      let n = 0;
      for (let t = 0; t < 9; t++) n += E.covered[t];
      lampVis.set(E.T.L.id, (9 - n) / 9);
    }
  }

  // 1 for a light whose lens part (DATA.mod.m8.lensOn) is painted after its housing in this frame's order, else 0
  let runByName = null;
  function lensLater(c) {
    const out = new Map();
    const on = M8.D.lensOn ?? {};
    if (!Object.keys(on).length || !c) return out;
    if (!runByName) {
      runByName = new Map();
      for (const run of c.scene().runs) runByName.set(run.name, run);
    }
    const layers = c.scene().layers;
    const pos = new Map();
    const posOf = (run) => {
      const name = layers[run.layer].name;
      if (!pos.has(name)) {
        const ord = c.orderIndex(name);
        const at = new Map();
        if (ord) for (let i = 0; i < ord.length; i++) at.set(ord[i], i);
        pos.set(name, at);
      }
      return pos.get(name).get(run.index) ?? -1;
    };
    for (const P of st.lights) {
      const lensPart = on[P.L.id];
      const a = runByName.get(P.L.part);
      const b = lensPart ? runByName.get(lensPart) : null;
      out.set(P.L.id, a && b && a.layer === b.layer && posOf(b) > posOf(a) ? 1 : 0);
    }
    return out;
  }
  /**
   * The weights of the fallback lens copies (lights.mjs LENS_PX: drawn for 0.672, 1 and 1.75 viewBox units per GL pixel):
   * the shader's lens floors are in GL pixels, so the copy whose pixel size is nearest the page's (viewBox units per GL
   * canvas pixel at this zoom: the stage's width and min(1.5, DPR)) shows, crossfaded in log size between neighbours.
   */
  const LENS_PX = [0.672, 1.0, 1.75];
  const LENS_ZOOM = 0.3; // f4-lights: lights.mjs LENS_ZOOM
  function glPxWeights() {
    const W0 = M8.G?.W ?? 960;
    const width = stageWidth();
    if (!width) return [1, 0, 0];
    const ratio = Math.min(1.5, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    const zoom = W0 / A3GL.view[0];
    const px = W0 / (width * ratio * zoom);
    // f4-lights: copy 0 (0.672) holds a second drawing for Inspect zoom (LENS_ZOOM, lights.mjs): its share of copy 0
    pv.glPx = px;
    pv.glPxZ = px >= LENS_PX[0] ? 0 : px <= LENS_ZOOM ? 1 : Math.log(LENS_PX[0] / px) / Math.log(LENS_PX[0] / LENS_ZOOM);
    const w = [0, 0, 0];
    if (px <= LENS_PX[0]) w[0] = 1;
    else if (px >= LENS_PX[2]) w[2] = 1;
    else {
      const i = px < LENS_PX[1] ? 0 : 1;
      const t = Math.log(px / LENS_PX[i]) / Math.log(LENS_PX[i + 1] / LENS_PX[i]);
      w[i] = 1 - t;
      w[i + 1] = t;
    }
    return w;
  }
  function alphaOf(key) {
    const v = alphas.get(key);
    if (v !== undefined) return v;
    if (key.startsWith("pool:")) return alphas.get(`sw:${key.split(":")[1]}`) ?? 0;
    return 0;
  }

  // ---------------------------------------------------------------------------------------------- mask, boxes
  let runIndex = null;
  function runOf(c, name) {
    if (!runIndex) {
      runIndex = new Map();
      for (const run of c.scene().runs) runIndex.set(run.name, run.index);
    }
    return runIndex.get(name);
  }
  function boxOf(fx, name, pad = 1.5) {
    const c = fx.controller;
    const i = runOf(c, name);
    if (i === undefined) return null;
    const f = c.frames()[i];
    if (!f) return null;
    const b = f.box;
    const v = A3GL.view; // the drawn viewBox window (Inspect zooms it)
    if (!(b[2] > b[0]) || b[0] > v[2] + v[0] || b[2] < v[2] || b[1] > v[3] + v[1] || b[3] < v[3]) return null;
    return [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
  }
  // parts the page fades out (Inspect views, DATA.fades): left out of the mask while their alpha is under 0.5
  let fadeRuns = null;
  let fadeKey = "";
  function fadedRuns(fx) {
    const fades = M8.A3 && M8.A3.data.fades;
    if (!fades) return null;
    if (!fadeRuns) {
      fadeRuns = {};
      const runs = fx.controller.scene().runs;
      for (const [cls, sources] of Object.entries(fades)) {
        const res = sources.map((src) => new RegExp(src));
        fadeRuns[cls] = new Set(runs.filter((run) => res.some((re) => re.test(run.name))).map((run) => run.index));
      }
    }
    let a = {};
    try {
      // eslint-disable-next-line no-undef
      a = typeof alpha !== "undefined" ? alpha : {};
    } catch (_) {
      a = {};
    }
    const off = Object.keys(fadeRuns).filter((cls) => (a[cls] ?? 1) < 0.5);
    if (!off.length) return null;
    return (index) => off.some((cls) => fadeRuns[cls].has(index));
  }
  function fadeState() {
    let a = {};
    try {
      // eslint-disable-next-line no-undef
      a = typeof alpha !== "undefined" ? alpha : {};
    } catch (_) {
      a = {};
    }
    return Object.keys(M8.A3?.data.fades ?? {}).filter((cls) => (a[cls] ?? 1) < 0.5).join(",");
  }
  function ensureMask(fx) {
    const fk = fadeState();
    if (fk !== fadeKey) {
      fadeKey = fk;
      M8.maskDirty = true;
    }
    const m = M8.mask;
    if (!m || M8.noMask) return { uMaskInfo: [0, 1, 1, 0] };
    if (M8.maskFrame !== M8.frame) {
      const t0 = performance.now();
      if (M8.maskDirty || m.stale()) {
        m.refresh(fx.controller, "airframe", fadedRuns(fx));
        M8.maskDirty = false;
      }
      m.bind(0);
      M8.maskFrame = M8.frame;
      M8.maskMs = performance.now() - t0;
    }
    return m.uniforms();
  }
  const nd = () => (M8.noDither ? 1 : 0);
  const on = (id) => !M8.only || M8.only.includes(id);
  // a window piece's scissor boxes: its rows' bands and its doorways, clipped to the piece's box and merged
  // where they overlap (a pixel must be drawn once per piece: passes composite over). Cached until it moves.
  const bandCache = new Map();
  function bandsOf(fx, w, part) {
    const hit = bandCache.get(w.part);
    if (hit && hit.frame === M8.maskStamp) return hit.boxes;
    const k = M8.G.camera.k;
    let boxes = [];
    for (const B of w.bands) {
      const a = anchorOf(fx.controller, w.group, B.a).screen;
      const b = anchorOf(fx.controller, w.group, B.b).screen;
      const r = B.r * k + 1.5;
      const box = [Math.max(part[0], Math.min(a[0], b[0]) - r), Math.max(part[1], Math.min(a[1], b[1]) - r), Math.min(part[2], Math.max(a[0], b[0]) + r), Math.min(part[3], Math.max(a[1], b[1]) + r)];
      if (box[2] > box[0] && box[3] > box[1]) boxes.push(box);
    }
    const meets = (p, q) => p[0] <= q[2] + 2 && q[0] <= p[2] + 2 && p[1] <= q[3] + 2 && q[1] <= p[3] + 2;
    for (let merged = true; merged; ) {
      merged = false;
      outer: for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++)
          if (meets(boxes[i], boxes[j])) {
            const p = boxes[i];
            const q = boxes[j];
            boxes[i] = [Math.min(p[0], q[0]), Math.min(p[1], q[1]), Math.max(p[2], q[2]), Math.max(p[3], q[3])];
            boxes.splice(j, 1);
            merged = true;
            break outer;
          }
    }
    bandCache.set(w.part, { frame: M8.maskStamp, boxes });
    return boxes;
  }
  const idOf = (fx, name) => (M8.mask ? M8.mask.idOf(fx.controller, name) : 0);
  // a point light's mask index: its housing's, or the part that carries the lens when that is painted after the housing
  // (review round 3: the tail strobe's lens lay under the APU blade's hull, the wingtip lenses under the tip's LE, so
  // 5-6 of the 9 mask taps read as covered at every bearing)
  // (the table is lights.mjs lensPartOf's, shipped as DATA.mod.m8.lensOn: the fallback lens copies use it too)
  const maskIdOf = (fx, L) => {
    let id = idOf(fx, L.part);
    const on = (M8.D.lensOn ?? {})[L.id];
    if (on) id = Math.max(id, idOf(fx, on));
    return id;
  };
  const poseOf = (fx, group, prefix) => TURN.poseUniforms(fx.controller, group, prefix);
  const probeInk = (spec, key, box) => {
    if (!inkProbe.want || (inkProbe.want !== true && inkProbe.want !== key) || !box) return;
    const gl = spec.layer.gl;
    const cv = gl.canvas;
    const v = A3GL.view;
    const sc = cv.width / v[0];
    const x0 = Math.max(0, Math.floor((box[0] - v[2]) * sc));
    const y0 = Math.max(0, Math.floor((v[1] - (box[3] - v[3])) * sc));
    const w = Math.min(cv.width - x0, Math.ceil((box[2] - box[0]) * sc));
    const h = Math.min(cv.height - y0, Math.ceil((box[3] - box[1]) * sc));
    if (w <= 0 || h <= 0) return;
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(x0, y0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let ink = 0;
    let lum = 0;
    for (let i = 0; i < px.length; i += 4) {
      const bare = 255 - px[i + 3];
      ink += 255 - (0.2126 * (px[i] + bare) + 0.7152 * (px[i + 1] + bare) + 0.0722 * (px[i + 2] + bare));
      lum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    }
    if (inkProbe.keep) {
      inkProbe.prev = inkProbe.last;
      inkProbe.last = { px, w, h, x0, y0, cw: cv.width, ch: cv.height };
    }
    inkProbe.rows.push({ f: M8.frame, key, ink: Math.round(ink), lum: Math.round(lum) });
    if (inkProbe.rows.length > 20000) inkProbe.rows.shift();
  };

  // ---------------------------------------------------------------------------------------------- effects
  // the harness's own `points` effect gives way to M8's per-light passes (id "lights"). Registering a second
  // effect with id "points" does not replace it (A3GL.init merges DATA.gl.effects with the FIRST registered spec
  // of an id, the harness's), so M8 switches the compiled spec off in its frame hook (offPoints), once: else the
  // harness draws every light again, without sector, gate or the mask, and with its own lens size
  function offPoints() {
    if (M8.pointsOff || !A3GL.layers) return;
    let found = 0;
    for (const list of Object.values(A3GL.layers))
      for (const spec of list)
        if (spec.id === "points") {
          spec.active = () => false;
          found++;
        }
    if (found || (A3GL.info && !A3GL.info.pending)) M8.pointsOff = true; // switched off, or never compiled (the harness skips it for "lights")
  }

  // a split program (DATA.gl.effects entries with a family and a chunk [from, to) of pass indices; follow-up item 34):
  // each chunk's spec draws only its own passes
  const inChunk = (spec, k) => !spec.chunk || (k >= spec.chunk[0] && k < spec.chunk[1]);
  A3GL.effect({
    id: "windows",
    canvas: "air",
    init(spec, { stage }) {
      // one mask for every air program (the chunks share the air canvas's context): built by the first chunk
      if (spec.chunk && spec.chunk[0] !== 0) return;
      const canvas = stage.querySelector('[data-canvas="air"]');
      M8.mask = A3Mask.create(spec.layer.gl, { canvas, view: A3GL.view, base: M8.G.W ?? 960 });
      // (also after a context restore: the new mask is built on its first frame)
      M8.maskDirty = true;
      M8.maskFrame = -1;
    },
    active: (fx) => on("windows") && ((fx.pv.cabinLight ?? 0) > 1e-3 || st.doors.some((v) => v > 1e-3)),
    draw(fx, pass, spec) {
      const mask = ensureMask(fx);
      const common = { ...mask, uDoors: st.doors, uCabin: [fx.pv.cabinLight, 0.85, st.blinds ?? 1, 0], uFirst: st.first, uNoDither: nd() };
      // a piece the page has faded out (an Inspect view) carries no lit windows either
      const faded = fadedRuns(fx);
      for (const w of M8.D.windows) {
        if (!inChunk(spec, w.pass)) continue;
        if (faded && faded(runOf(fx.controller, w.part))) continue;
        const part = boxOf(fx, w.part, 2);
        if (!part) continue;
        const boxes = bandsOf(fx, w, part);
        if (!boxes.length) continue;
        const v = { ...common, ...poseOf(fx, w.group, "uG"), uPass: w.pass, uTarget: idOf(fx, w.part) };
        for (const box of boxes) pass(v, box);
        probeInk(spec, `win:${w.part}`, part);
      }
    },
  });

  A3GL.effect({
    id: "cockpit",
    canvas: "air",
    // the build-constant passes (chunk 0-2, "cockpit.all") are drawn only without M2's pane targets (pass 1 never): in
    // a build with them that program is not compiled (follow-up item 34: 160-270 ms of compile for nothing)
    needs: (spec, data) => !spec.chunk || spec.chunk[1] > 2 || !(data.targets ?? []).some((t) => t.kind === "cockpit" && t.constants && Array.isArray(t.constants.panes)),
    active: () => on("cockpit") && (st.levels.cockpit > 1e-3),
    draw(fx, pass, spec) {
      const mask = ensureMask(fx);
      const D = M8.D;
      const lifted = smooth(14.5, 20, st.cutFd);
      const ck = [st.levels.cockpit * (1 - smooth(3, 14.5, st.cutFd)), st.levels.cockpit * lifted, 0, 0];
      const targets = M8.G.targets ?? [];
      const common = { ...mask, uCk: ck, uFirst: st.first, uNoDither: nd() };
      // two programs (follow-up item 34): "cockpit" draws passes 2 and 3, "cockpit.all" the build-constant 0 and 1
      const mine = (k) => inChunk(spec, k);
      if (ck[0] > 1e-3) {
        const box = boxOf(fx, D.cockpit.part, 2);
        const panes = targets.find((t) => t.kind === "cockpit" && t.constants && Array.isArray(t.constants.panes))?.constants.panes;
        if (box && panes) {
          if (!mine(2)) return;
          // M2's panes, exactly as it draws them: one pass per pane, its polygon and frame as uniforms
          const pose = poseOf(fx, D.cockpit.group, "uG");
          const id = idOf(fx, D.cockpit.part);
          for (const P of panes) {
            const poly = new Float32Array(64);
            const n = Math.min(32, P.polygon.length);
            for (let i = 0; i < n; i++) {
              const q = [P.polygon[i][0] - P.o[0], P.polygon[i][1] - P.o[1], P.polygon[i][2] - P.o[2]];
              poly[2 * i] = (q[0] * P.u[0] + q[1] * P.u[1] + q[2] * P.u[2]) * 0.1;
              poly[2 * i + 1] = (q[0] * P.v[0] + q[1] * P.v[1] + q[2] * P.v[2]) * 0.1;
            }
            // the pane's normal points out of the canopy (away from the flight deck, kit [378, 0, 66])
            const out = [P.o[0] - 378, P.o[1], P.o[2] - 66];
            const N = out[0] * P.n[0] + out[1] * P.n[1] + out[2] * P.n[2] < 0 ? P.n.map((x) => -x) : P.n;
            pass({ ...common, ...pose, uPO: P.o.map((x) => x * 0.1), uPU: P.u, uPV: P.v, uPN: N, uPoly: poly, uPInfo: [n, 0.03, 0, 0], uPass: 2, uTarget: id }, box);
          }
          probeInk(spec, "cockpit", box);
        } else if (box && mine(0)) {
          pass({ ...common, ...poseOf(fx, D.cockpit.group, "uG"), uPass: 0, uTarget: idOf(fx, D.cockpit.part) }, box);
          probeInk(spec, "cockpit", box);
        }
      }
      if (ck[1] > 1e-3 && mine(3)) {
        // M7's displays, one pass each (centre, frame and size from its panel glTargets), on its parts
        const k = M8.G.camera.k;
        const KINDS = { PFD: 0, ND: 1, EWD: 2, SD: 3, MFD: 4 };
        for (const t of targets) {
          if (t.kind !== "panel" || !t.constants || !t.constants.centre) continue;
          const C = t.constants;
          const group = t.group ?? "cockpit";
          const a = anchorOf(fx.controller, group, C.centre);
          const R = (Math.max(C.w, C.h) * 0.75 + 1) * k;
          const box = [a.screen[0] - R, a.screen[1] - R, a.screen[0] + R, a.screen[1] + R];
          const kind = KINDS[String(C.screen).toUpperCase()] ?? 4;
          pass({ ...common, ...poseOf(fx, group, "uG"), uPO: C.centre.map((x) => x * 0.1), uPU: C.u, uPV: C.v, uPN: C.n, uPInfo: [0, kind, C.w * 0.1, C.h * 0.1], uPass: 3, uTarget: idOf(fx, t.part) }, box);
        }
      }
    },
  });

  const inletFacing = (fx, e) => {
    const a = anchorOf(fx.controller, "pitch", e.at, [1, 0, 0]);
    return { a, facing: a.direction ? dot3(a.direction, st.V) : 0 };
  };
  A3GL.effect({
    id: "engines",
    canvas: "air",
    active: (fx) => on("engines") && ((M8.D?.engines ?? []).some((e) => inletFacing(fx, e).facing > 0.015)),
    draw(fx, pass, spec) {
      const mask = ensureMask(fx);
      const D = M8.D;
      const pose = poseOf(fx, "pitch", "uPlane");
      const k = M8.G.camera.k;
      for (const e of D.engines) {
        const { a, facing } = inletFacing(fx, e);
        if (facing < 0.015) continue;
        const n1 = fx.pv.n1 ? fx.pv.n1[e.i] : 0;
        const omega = (2 * Math.PI * D.fan.rpm100 * n1) / 60;
        const phase = (fx.pv.fanPhase ? fx.pv.fanPhase[e.i] : 0) * e.sense;
        const R = e.r * 10 * k + 3;
        const box = [a.screen[0] - R, a.screen[1] - R, a.screen[0] + R, a.screen[1] + R];
        const v = { ...mask, ...pose, uPass: e.i, uTarget: idOf(fx, e.part), uFirst: st.first, uNoDither: nd() };
        // the once-per-rev mark: in with N1 from rest, out once its own blur passes a radian
        const mark = smooth(0.003, 0.03, n1) * (1 - smooth(0.8, 2.2, omega * st.exposure));
        v[`uRun${e.i}`] = [phase, fx.calm ? stillGain(omega * st.exposure, 0.3) : blurGain(omega * st.exposure), n1, mark];
        v[`uGain${e.i}`] = fx.calm ? fanGainsStill(omega, st.exposure, D.fan.blades) : fanGains(omega, st.exposure, D.fan.blades);
        pass(v, box);
        probeInk(spec, `eng:${e.n}`, box);
      }
    },
  });

  A3GL.effect({
    id: "washes",
    canvas: "air",
    active: () => on("washes") && (st.levels.logo > 1e-3 || st.levels.wing > 1e-3 || st.levels.engine > 1e-3),
    draw(fx, pass, spec) {
      const mask = ensureMask(fx);
      const common = { ...mask, uWS: st.wS, uWD: st.wD, uWC: st.wC, uFirst: st.first, uNoDither: nd() };
      for (const w of M8.D.washes) {
        if (!inChunk(spec, w.pass)) continue;
        if (w.kind === "logo" && st.levels.logo <= 1e-3) continue;
        if (w.kind === "scan" && st.levels.wing <= 1e-3 && st.levels.engine <= 1e-3) continue;
        const box = boxOf(fx, w.part, 2);
        if (!box) continue;
        pass({ ...common, ...poseOf(fx, w.group, "uG"), uPass: w.pass, uTarget: idOf(fx, w.part) }, box);
        probeInk(spec, `wash:${w.part}`, box);
      }
    },
  });

  A3GL.effect({
    id: "lights",
    canvas: "air",
    active: () => on("lights") && (st.lights.some((P) => P.energy > 1e-3) || st.lamps.some((T) => T.energy > 1e-3 && T.beam)),
    draw(fx, pass, spec) {
      const mask = ensureMask(fx);
      const k = M8.G.camera.k;
      const px = A3GL.view[0] / (fx.canvasWidth || M8.G.W);
      const frame = frameOf(fx);
      for (const P of st.lights) {
        if (!(P.energy > 1e-3) || !P.anchor) continue;
        const L = P.L;
        const [x, y] = P.anchor.screen;
        const lens = L.lens * k;
        // a strobe or beacon flash outshines the runway lights: its halo swells with the flash (×2.5 at the peak)
        // (steady under reduced motion: no swell, so a steady strobe does not wash out the nav lens beside it)
        const halo = (L.halo ?? 3) * ((L.kind === "strobe" || L.kind === "beacon") && !fx.calm ? 0.8 + 1.7 * P.flashV : 1);
        // the box reaches exactly as far as pointInk does (its lens floor is 1.4 device px, the dark reach 12 px, the
        // paper glint 3 x 2.2 px): a smaller box cut the halo square at Inspect zoom
        const rl = Math.max(lens, 1.4 * px);
        // fu/r2-lights: by day a strobe's flash draws its keyline and glint (shaders.mjs GLSL_POINT, uPtV.z), out to 6 gr
        const flash = M8.D.light && L.kind === "strobe" ? P.flashV : 0;
        const reach = Math.max(rl * halo * 6, 12 * px, Math.max(rl, 2.2 * px) * (flash > 0 ? 6.2 : 3)) + 2 * px;
        const box = [x - reach, y - reach, x + reach, y + reach];
        const rgb = inkOf(L.color, M8.D.light ? L.paper : L.dark);
        pass({ ...mask, uPt: [x, y, lens, P.energy], uPtC: [...rgb, halo], uPtP: [...rgb, P.white], uPtV: [maskIdOf(fx, L), Math.max(lens, 0.8), flash, 0], uFrame: frame, uFirst: st.first, uNoDither: nd() }, box);
        probeInk(spec, `l:${L.id}`, box);
      }
      const lampRgb = inkOf("lamp", [1, 1, 1]);
      for (const T of st.lamps) {
        if (!T.beam || !(T.energy > 1e-3) || !T.anchor) continue;
        const [x, y] = T.anchor.screen;
        const lens = T.lens * k;
        const rl = Math.max(lens, 1.4 * px);
        const reach = Math.max(rl * 3 * 6, 12 * px, Math.max(rl, 2.2 * px) * 3) + 2 * px;
        const box = [x - reach, y - reach, x + reach, y + reach];
        pass({ ...mask, uPt: [x, y, lens, T.energy], uPtC: [...lampRgb, 3], uPtP: [...lampRgb, 1], uPtV: [idOf(fx, T.L.part), Math.max(lens, 0.8), 0, 0], uFrame: frame, uFirst: st.first, uNoDither: nd() }, box);
        probeInk(spec, `p:${T.L.id}`, box);
      }
    },
  });

  // each lit beam's screen box: the bounding box of its elliptical cone (apex and the corners of the far cap's
  // bounding rectangle at the reach), 5% wide, so a narrow beam aimed across the figure no longer costs the
  // disc of its reach (glslLamps: spotE is 0 outside the tangents, every sample 0 beyond the reach)
  const volumeBoxes = (fx) => {
    const w = fx.controller.cams().world;
    const boxes = [];
    for (const T of st.lamps) {
      if (!T.beam || T.level <= 1e-3 || !T.anchor || !T.anchor.direction) continue;
      const S = T.anchor.world;
      const D = T.anchor.direction;
      // the beam's full reach (its falloff reaches 0 there): a 44 m cap cut a 60 m landing beam's far part square
      const L = T.reach * 10;
      let H = [D[1], -D[0], 0];
      const hl = Math.hypot(H[0], H[1]);
      H = Math.abs(D[2]) > 0.95 || hl < 1e-6 ? [1, 0, 0] : [H[0] / hl, H[1] / hl, 0];
      const U = [H[1] * D[2] - H[2] * D[1], H[2] * D[0] - H[0] * D[2], H[0] * D[1] - H[1] * D[0]];
      const a = L * T.tan[0] * 1.05;
      const b = L * T.tan[1] * 1.05;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const put = (p) => {
        const sx = w.ox + w.m[0] * p[0] + w.m[1] * p[1] + w.m[2] * p[2];
        const sy = w.oy + w.m[3] * p[0] + w.m[4] * p[1] + w.m[5] * p[2];
        x0 = Math.min(x0, sx);
        y0 = Math.min(y0, sy);
        x1 = Math.max(x1, sx);
        y1 = Math.max(y1, sy);
      };
      put(S);
      for (const sa of [-1, 1])
        for (const sb of [-1, 1]) put([S[0] + D[0] * L + H[0] * a * sa + U[0] * b * sb, S[1] + D[1] * L + H[1] * a * sa + U[1] * b * sb, S[2] + D[2] * L + H[2] * a * sa + U[2] * b * sb]);
      boxes.push([x0 - 4, y0 - 4, x1 + 4, y1 + 4]);
    }
    return boxes;
  };
  // the card frame fade's numbers (follow-up item 24): the stage's CSS size and the fade's width, 40 CSS px (at most 12% of
  // the stage's shorter side, so a phone keeps its picture); read when the canvas changes size
  const cardFrame = { key: "", value: [0, 0, 0, 0] };
  const frameOf = (fx) => {
    const cv = fx.controller && document.querySelector('[data-canvas="air"]');
    if (!cv) return cardFrame.value;
    const key = `${cv.width}x${cv.height}`;
    if (key !== cardFrame.key) {
      const r = cv.getBoundingClientRect();
      cardFrame.key = key;
      cardFrame.value = [r.width, r.height, Math.min(40, 0.12 * Math.min(r.width, r.height)), 0];
    }
    // in an Inspect zoom the beams and haze run on past the frame, brighter toward their lamps: a 40 px fade cut them
    // into a bright bar 12 CSS px inside the stage edge (review fu-1), and no fade left the canvas edge's own 11 px ramp
    // (5-7 levels a pixel). The fade widens with the zoom (40 CSS px × zoom, to 3×, at most a quarter of the stage's
    // shorter side), so the haze falls over its visible run toward the frame, under 3 levels a pixel
    const zoom = Math.min(3, Math.max(1, (M8.G.W ?? 960) / A3GL.view[0]));
    if (zoom <= 1.0001) return cardFrame.value;
    const v = cardFrame.value;
    return [v[0], v[1], Math.max(v[2], Math.min(40 * zoom, 0.25 * Math.min(v[0], v[1]))), 0];
  };
  /** The ground-lit terms' fade with the true height: 1 on the ground, 0 from 60 m (continuous through rotation). */
  const groundWashOf = (fx) => 1 - smooth(15, 60, fx.state.height ?? 0);
  const hazeLevels = (fx) => {
    const n1 = fx.pv.n1 ?? [0, 0, 0, 0];
    return { uHaze: [0, 1, 2, 3].map((i) => smooth(0.55, 0.92, n1[i] ?? 0)), uApu: (fx.state.apu ?? 0) * 0.25 };
  };
  const hazeBoxes = (fx, h) => {
    const k = M8.G.camera.k;
    const out = [];
    (M8.D.plumes ?? []).forEach((p, i) => {
      if ((i < 4 ? h.uHaze[i] : h.uApu) <= 0.002) return;
      const a = anchorOf(fx.controller, "pitch", p.at);
      const R = p.r * 10 * k;
      out.push([a.screen[0] - R, a.screen[1] - R, a.screen[0] + R, a.screen[1] + R]);
    });
    return out;
  };
  A3GL.effect({
    id: "volumes",
    canvas: "air",
    // fu/r2-lights: by day the program is the heat haze alone (no beams, DESIGN §6.2)
    active: (fx) => on("volumes") && ((!M8.D.light && st.lamps.some((T) => T.beam && T.level > 1e-3)) || (fx.pv.n1 ?? []).some((v) => v > 0.55) || (fx.state.apu ?? 0) > 0.02),
    draw(fx, pass) {
      const h = hazeLevels(fx);
      const box = unionBox([...(M8.D.light ? [] : volumeBoxes(fx)), ...hazeBoxes(fx, h)]);
      if (!box) return;
      pass({ ...poseOf(fx, "pitch", "uPlane"), uLS: st.lampS, uLD: st.lampD, uLC: st.lampC, ...h, uSteps: 10, uFrame: frameOf(fx), uFirst: st.first, uNoDither: nd() }, box);
    },
  });

  A3GL.effect({
    id: "ground",
    canvas: "ground",
    active: (fx) => on("ground") && (st.lamps.some((T) => T.slot < 0 && T.level > 1e-3) || (fx.pv.n1 ?? []).some((v) => v > 0.55) || (fx.state.apu ?? 0) > 0.02 || (!M8.D.light && st.lights.some((P) => (P.L.kind === "beacon" || P.L.kind === "strobe") && P.level * P.flashV > 1e-3))),
    draw(fx, pass, spec) {
      const pl = boxOf(fx, "stage.platter", 2) ?? [A3GL.view[2], A3GL.view[3], A3GL.view[2] + A3GL.view[0], A3GL.view[3] + A3GL.view[1]];
      const dark = !M8.D.light;
      // every ground-lit term fades with the TRUE height (the platter shows the ground 6 m below at most): just after
      // lift-off it is gone, so no beacon pool lies on the country or the cloud deck in the climb
      const washH = groundWashOf(fx);
      let beacon = [0, 0, 0, 0];
      const strobes = new Float32Array(12);
      if (dark && washH > 1e-3) {
        let si = 0;
        for (const P of st.lights) {
          if (!P.anchor || !(P.level * P.flashV > 1e-3)) continue;
          const w = P.anchor.world;
          // reduced motion holds the flash steady: its pool is drawn at a quarter of the flash peak (a steady red pool
          // read as fire and outshone the accent)
          const e = P.level * (fx.calm ? 0.1 : P.flashV);
          if (P.L.kind === "beacon" && P.L.normal && P.L.normal[2] < -0.5) beacon = [w[0], w[1], w[2], e];
          else if (P.L.kind === "strobe" && si < 3) strobes.set([w[0], w[1], w[2], P.level * P.flashV], 4 * si++);
        }
      }
      const h = hazeLevels(fx); // fu/r2-lights: the back half of the haze by day too
      // the pass box: the union of every lit term's own reach (pools, washes, back halves), not the whole platter
      const k = M8.G.camera.k;
      const c = fx.controller;
      const disc = (g, R) => {
        const q = anchorOf(c, null, [g[0], g[1], 0]).screen;
        return [q[0] - R * k, q[1] - R * k * 0.6, q[0] + R * k, q[1] + R * k * 0.6];
      };
      const terms = [];
      for (const T of st.lamps) {
        if (T.slot >= 0 || T.level <= 1e-3 || !T.anchor || washH <= 1e-3) continue;
        const S = T.anchor.world;
        const D = T.anchor.direction;
        const t = D[2] < -0.05 ? Math.min(S[2] / -D[2], T.reach * 10) : 0;
        const b = disc([S[0] + D[0] * t, S[1] + D[1] * t], Math.min(T.reach, 30) * 10 * 0.8 + 20);
        terms.push(b);
      }
      if (beacon[3] > 0) terms.push(disc(beacon, 230));
      for (let i = 0; i < 3; i++) if (strobes[4 * i + 3] > 0) terms.push(disc([strobes[4 * i], strobes[4 * i + 1]], 90));
      const vols = [...(dark ? volumeBoxes(fx) : []), ...hazeBoxes(fx, h)];
      const vbox = unionBox(vols) ?? [0, 0, 0, 0];
      // only the pools and washes are cut to the platter's box (the shader's platter window does the rest); the back
      // halves of the beams and the haze are not (cutting them left a hard airframe-shaped hole round the nose)
      const u = unionBox(terms);
      const pools = u ? [Math.max(pl[0], u[0]), Math.max(pl[1], u[1]), Math.min(pl[2], u[2]), Math.min(pl[3], u[3])] : null;
      const box = unionBox([pools && pools[2] > pools[0] && pools[3] > pools[1] ? pools : null, ...vols].filter(Boolean));
      if (!box || box[2] <= box[0] || box[3] <= box[1]) return;
      pass({ ...poseOf(fx, "pitch", "uPlane"), uLS: st.lampS, uLD: st.lampD, uLC: st.lampC, uBeacon: beacon, uVolBox: vbox, uStrobe: strobes, ...h, uSteps: dark && st.lamps.some((T) => T.beam && T.level > 1e-3) ? 10 : 0, uWashH: washH, uFrame: frameOf(fx), uFirst: st.first, uNoDither: nd() }, box);
      probeInk(spec, "ground", box);
    },
  });

  // ---------------------------------------------------------------------------------------------- logging
  function logRow(fx) {
    const row = { f: M8.frame, t: +fx.clock.toFixed(3), cabin: +fx.pv.cabinLight.toFixed(4), first: +fx.first.toFixed(4), share: +(fx.pv.glShare || 0).toFixed(4), az: +st.view.az.toFixed(2), l: {}, p: {} };
    for (const P of st.lights) row.l[P.L.id] = [+P.level.toFixed(4), +P.flashV.toFixed(4), +P.sector.toFixed(4), +P.facing.toFixed(4), +P.energy.toFixed(4), +P.fallback.toFixed(4)];
    for (const T of st.lamps) row.p[T.L.id] = [+T.level.toFixed(4), +T.energy.toFixed(4)];
    row.levels = { ...st.levels };
    row.js = +M8.js.toFixed(3);
    row.mask = M8.maskMs ? +M8.maskMs.toFixed(3) : 0;
    logState.rows.push(row);
    if (logState.rows.length > logState.max) logState.rows.shift();
  }

  /** True while a GL effect animates on its own (a flash, a turning fan, a beam's dither): the loop keeps running. */
  function animating(fx) {
    if (!M8.D || !A3GL.ok) return false;
    // paused, the page's clock and the fans stand still: every pass would redraw the same picture
    // f4-perf: and only the switch envelopes (l:, p:, w:, sw:) still settle (dtSw); the others hold their velocity frozen
    // at dt 0, so one paused mid-ease (the cockpit's power-up at the gate: v 1.5e-3 held) kept the page at 60 fps for
    // as long as it stayed paused
    if (fx.pv && fx.pv.paused) {
      for (const [key, e] of env) if (/^(l|p|w|sw):/.test(key) && Math.abs(e.v) > 1e-4) return true;
      return false;
    } // f4-perf end
    for (const e of env.values()) if (Math.abs(e.v) > 1e-4) return true; // an envelope still settling
    if (st.lights.some((P) => P.flash && P.level * P.sector > 1e-3)) return !fx.calm;
    if ((fx.pv.n1 ?? []).some((v) => v > 0.002)) return !fx.calm;
    if (!M8.D.light && st.lamps.some((T) => T.beam && T.level > 1e-3)) return !fx.calm;
    return false;
  }
  const api = {
    attach,
    frame,
    animating,
    alpha: alphaOf,
    state: st,
    M8,
    log(on = true) {
      logState.on = on;
      if (on) logState.rows.length = 0;
      return logState.rows.length;
    },
    get rows() {
      return logState.rows;
    },
    ink(want = true) {
      inkProbe.want = want;
      inkProbe.rows.length = 0;
      return true;
    },
    diffInk() {
      const a = inkProbe.prev;
      const b = inkProbe.last;
      if (!a || !b) return null;
      let n = 0;
      const where = [];
      for (let i = 0; i < Math.min(a.px.length, b.px.length); i += 4) {
        const d = Math.abs(a.px[i] - b.px[i]) + Math.abs(a.px[i + 3] - b.px[i + 3]);
        if (d > 2) {
          n++;
          if (where.length < 12) where.push([(i / 4) % a.w, Math.floor(i / 4 / a.w), a.px[i + 3], b.px[i + 3]]);
        }
      }
      return { n, where, a: [a.w, a.h, a.x0, a.y0, a.cw, a.ch], b: [b.w, b.h, b.x0, b.y0, b.cw, b.ch] };
    },
    keepInk(v = true) {
      inkProbe.keep = v;
    },
    get inkRows() {
      return inkProbe.rows;
    },
    vectors() {
      const out = {};
      for (const list of Object.values(A3GL.layers))
        for (const spec of list) {
          const g = spec.layer.gl;
          const n = g.getProgramParameter(spec.layer.program, g.ACTIVE_UNIFORMS);
          let rows = 0;
          for (let i = 0; i < n; i++) rows += g.getActiveUniform(spec.layer.program, i).size;
          out[spec.id] = rows;
        }
      return out;
    },
    stats() {
      return { pointsOff: M8.pointsOff, effects: Object.fromEntries(Object.entries(A3GL.layers).map(([k, v]) => [k, v.map((sp) => sp.id)])), js: M8.js, jsMoved: M8.jsMoved, jsMax: M8.jsMax, maskMs: M8.maskMs, mask: M8.mask ? { ...M8.mask.stats, size: M8.mask.size } : null, lights: st.lights.length, lamps: st.lamps.length, pools: st.nPool, info: A3GL.info };
    },
    set only(v) {
      M8.only = v;
    },
    set noDither(v) {
      M8.noDither = Boolean(v);
    },
    set noMask(v) {
      M8.noMask = Boolean(v);
    },
    /** Verification: anchorOf against the kit's controller.anchor for every light and lamp (largest difference). */
    anchorCheck() {
      const c = M8.A3 && M8.A3.controller;
      if (!c) return null;
      let worst = 0;
      for (const L of [...st.lights.map((P) => [P.L.group, P.L.at, P.L.normal]), ...st.lamps.map((T) => [T.L.group, T.L.at, T.L.dir])]) {
        const a = anchorOf(c, L[0], L[1], L[2]);
        const b = c.anchor(L[0], L[1], L[2]);
        for (const k of ["world", "screen", "direction"]) if (a[k] && b[k]) for (let i = 0; i < a[k].length; i++) worst = Math.max(worst, Math.abs(a[k][i] - b[k][i]));
      }
      return worst;
    },
    /** Verification (f3-lights): each lit beam lamp's lens cover on the CPU (lampVisCpu, the fallback's) and, with GL, the
     *  mask's own taps (pointVis's 9 taps read back through probeMask against the housing's index). */
    lampVisCheck() {
      const c = M8.A3 && M8.A3.controller;
      if (!c) return null;
      const fx = { controller: c };
      return st.lamps.filter((T) => T.anchor && T.level > 0).map((T) => {
        lampStamp = "";
        const cpu = lampVisCpu(fx, T);
        let gl = null;
        if (M8.mask) {
          const id = idOf(fx, T.L.part);
          const [x, y] = T.anchor.screen;
          const r = Math.max(T.lens * M8.G.camera.k, 0.8);
          let v = 0;
          for (let i = -1; i < 8; i++) {
            const at = i < 0 ? [x, y] : [x + r * Math.cos(i * 0.7853982), y + r * Math.sin(i * 0.7853982)];
            if (M8.mask.probe(at) <= id) v++;
          }
          gl = v / 9;
        }
        return { id: T.L.id, part: T.L.part, facing: +T.facing.toFixed(3), cpu: +cpu.toFixed(3), gl: gl === null ? null : +gl.toFixed(3) };
      });
    },
    probeMask(vb) {
      return M8.mask ? M8.mask.probe(vb) : -1;
    },
    /** Verification: the fade state the mask was last built with, and the faded run count per class. */
    fadeDebug() {
      return { fadeKey, sets: fadeRuns ? Object.fromEntries(Object.entries(fadeRuns).map(([k, v]) => [k, v.size])) : null, refreshes: M8.mask ? M8.mask.stats.refreshes : 0, now: fadeState() };
    },
  };
  if (typeof window !== "undefined") window.__a380m8 = api;
  return api;
})();

/** DESIGN §6.1's name for one GL frame: live.js calls A3GL.frame(fx) directly, after A3M8.frame (its frame hook). */
function drawGL(fx) {
  A3M8.frame(fx);
  A3GL.frame(fx);
}
void drawGL;
