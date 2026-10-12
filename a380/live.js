// a380/live.js (S core; I extends the interaction layer): the page loop of the A380 figure.
//
// Inlined after the kit (turn-fixed + canvas painter, or turn), kit gl, the model (`M`), follow.mjs (`F`),
// gl/runtime.js, gl/harness.js (`A3GL`), and the M8/M1 page files. build.mjs replaces __DATA__ and inserts
// every module's ctx.script(...) at the /*@MODULES@*/ marker, after the A3 page API exists and before the
// controller mounts.
const DATA = __DATA__;
const BASE_ELEVATION = (DATA.turn && DATA.turn.P && DATA.turn.P.elevation) ?? 30; // fu/f4-interiors: the page's camera elevation (P)
// modules may add fade sets (the pushback tug, parts/tug.mjs): picking, the hover hull and the GL mask honour them
if (DATA.mod && DATA.mod.fades) DATA.fades = { ...(DATA.fades ?? {}), ...DATA.mod.fades };
const stage = document.querySelector(".a3-stage");
const plate = stage.closest(".iso-plate");
const readoutEl = document.querySelector("[data-readout]");
const liveEl = document.querySelector(".a3-live");
const tipEl = document.querySelector(".a3-tip");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const LIGHT = (stage.closest("[data-theme]")?.getAttribute("data-theme") ?? "dark") !== "dark" ? 1 : 0;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrap360 = (a) => ((a % 360) + 360) % 360;

// ---------------------------------------------------------------------------------------------
// A3: the page API modules extend (CONTRACT.md "page hooks")
// ---------------------------------------------------------------------------------------------
const A3 = {
  data: DATA,
  hooks: {},
  /** Register a page hook: "frame" (after controller.set), "deck" (every frame, deck scroll values), "phase", "action". */
  on(event, fn) {
    (this.hooks[event] ??= []).push(fn);
    return fn;
  },
  emit(event, arg) {
    for (const fn of this.hooks[event] ?? []) fn(arg);
  },
  /** Page actions by name (vocabulary: door:ID, engine:n, cutaway, inspect:view, gear, flaps, light:switch, steer). */
  actions: {},
  action(name, arg) {
    const [head, rest] = String(name).split(":");
    const fn = this.actions[name] ?? this.actions[head];
    if (!fn) return false;
    fn(rest ?? arg, name);
    this.emit("action", { name, arg });
    return true;
  },
  effects: {}, // canvas painter effects { partName: fn(ctx, w, h, base, rect) } (kit patch 11 territory)
  gl: A3GL,
  pv: null,
  state: null,
  ch: null,
  controller: null,
  canvas: null,
};
window.__a380 = A3;

/*@MODULES@*/

// ---------------------------------------------------------------------------------------------
// state: the model simulation, page values and the history
// ---------------------------------------------------------------------------------------------
let sim = F.createSim(M, {});
const pv = {
  turn: F.turnOfBearing(F.tourBearing(0)),
  steer: 0,
  roll: 0,
  pitchCmd: 0,
  yaw: 0,
  spoiler: 0,
  spoiler1: 0,
  cabin: 0,
  cabinTarget: 0,
  mode: still.matches ? "hold" : "tour",
  paused: false,
  tourT: 0,
  rate: 1,
  seek: null, // { phase, kind: "forward" | "back" }
  scroll: 0,
  speedFade: 1,
  seekFade: 1,
  glShare: 0,
  first: 0,
  accent: {},
  label: null,
};
A3.pv = pv;
const env = { gearShow: { x: 0, v: 0 }, cabin: { x: 0, v: 0 }, glShare: { x: 0, v: 0 }, first: { x: 0, v: 0 }, detail: { x: 1, v: 0 }, seekFade: { x: 1, v: 0 }, rate: { x: F.RATES.GATE, v: 0 }, accent: {}, zoom: { x: 1, v: 0 }, cx: { x: 0, v: 0 }, cy: { x: 0, v: 0 }, lights: {} };
const history = [];
let historyClock = 0;
const HISTORY_EVERY = 0.1;
const HISTORY_MAX = 2400; // 240 s of page time
// a forward seek records its path every SEEK_RECORD model seconds (follow-up, item 60: a seek to 10,000 ft recorded the
// departure in about 30 page-time entries, so the rewind after a long hold went from the climb to the runway in one
// frame: 6 m of lift, the gear and 16.7 km of ground at once)
const SEEK_RECORD = 1;
const SEEK_STEP = 0.25; // model s: the seek's path is examined this often, and recorded where the picture moved (visualStep)
let seekRecorded = null; // the state last recorded along a seek

// ---------------------------------------------------------------------------------------------
// controller, follow and painters
// ---------------------------------------------------------------------------------------------
const follow = F.makeFollow(DATA.rules, DATA.groups, TURN);
let own = true; // the mount's own first render must not overwrite pv.turn
let mounted = false; // set after the first tick's controller.set: until then onFrame is the mount's own render
let toolTurn = false; // a tool turned the controller: the next tick must set (never skipped at half rate)
let toolTickQueued = false;
let lastSetMs = 0;
let ema = 0;
let half = false;
let frameIndex = 0;
let lastValues = null;
let airMoved = true;
const controller = await (TURN.mountAsync ?? TURN.mount)(stage, DATA.turn, { // fu/perf: two tasks (review r1) fu/perf end
  painter: DATA.painter,
  canvasLayers: DATA.painter === "canvas" ? ["airframe"] : undefined,
  onHold: () => {
    hold("tool");
    wake();
  },
  onFrame: (c) => {
    airMoved = true;
    if (!own && mounted) {
      // a tool (drive.mjs ["turn", θ], turn-check) set the controller: follow it. One tick re-poses the free cabin
      // and cockpit groups (their sync pose depends on the turn), also under reduced motion
      const air = c.values.air;
      if (typeof air === "number" && Math.abs(air - pv.turn) > 1e-9) {
        pv.turn = air;
        turnTarget = null;
        toolTurn = true;
        // the vary alphas (nav sectors, the lit panes, fades) follow the tool's turn before the tool reads the page:
        // one tick as a microtask, so a check right after set() sees no previous-bearing alphas
        if (!toolTickQueued) {
          toolTickQueued = true;
          queueMicrotask(() => {
            toolTickQueued = false;
            if (frame) {
              cancelAnimationFrame(frame);
              frame = 0;
            }
            tick(performance.now());
          });
        }
        wake();
      }
    }
  },
});
A3.controller = controller;
own = false;
const glInfo = A3GL.init({ stage, controller, data: DATA.gl, light: LIGHT });
A3.glInfo = glInfo;
// a restored WebGL context (gl/harness.js rebuilt its programs): redraw from the current pose
A3GL.onRestore = () => {
  airMoved = true;
  wake();
};
if (glInfo && glInfo.renderer) console.info(`a380 gl: ${glInfo.ok ? "on" : "fallback"} · ${glInfo.renderer} · uniforms ${glInfo.need}/${glInfo.max} · compile ${glInfo.compileMs} ms`);
// fu/lights: the mount in three tasks, not one of about 465 ms (follow-up item 34: no task over 300 ms at mount). The
// tools' hook is held back until the first tick has run, so no tool turns a half-mounted page
const isoHook = window.__isoTurn;
delete window.__isoTurn;
await new Promise((done) => setTimeout(done, 0));
// fu/lights end

// vary: per-frame alphas for classes, for both painters (DESIGN §6.3)
const VARY = DATA.varyFns;
const FADE_CLASSES = Object.keys(DATA.fades ?? {}).filter((cls) => VARY[cls]);
const alpha = {};
for (const cls of Object.keys(VARY)) alpha[cls] = 0;
const varyMap = Object.fromEntries(Object.keys(VARY).map((cls) => [cls, () => alpha[cls]]));
let canvas = null;
// the airframe canvas at a pixel ratio of at most 2 (DESIGN §5.11 levers: a phone's DPR 3 rasterises 2.25× the pixels
// of DPR 2 for no visible gain at this line weight)
// f3-painter: the airframe layer is painted through WebGL2 (kit/gl-painter.mjs: the canvas painter's own ops,
// tessellated and batched into a 4× multisampled target), and by the canvas painter when WebGL2 or 4× MSAA is missing,
// when the context is lost, or with ?painter=canvas. ?painter=gl&tee=1 is the parity tool's (a380/tools/gl-parity.mjs)
const GL_QUERY = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
const GL_DEFAULT = true; // the GL painter by default (?painter=canvas forces the canvas painter; false: opt-in, ?painter=gl)
const GL_PAINTER = typeof GLPAINT !== "undefined" && (GL_QUERY !== null && GL_QUERY.get("painter") === "gl" || (GL_DEFAULT && (GL_QUERY === null || GL_QUERY.get("painter") !== "canvas")));
const GL_OPTIONS = GL_PAINTER && GL_QUERY !== null ? { tee: GL_QUERY.get("tee") === "1", samples: Number(GL_QUERY.get("samples") ?? 4) } : {};
// f3-painter end
if (DATA.painter === "canvas" && typeof CANVAS2D !== "undefined") canvas = await (GL_PAINTER ? GLPAINT.mountAsync : CANVAS2D.mountAsync ?? CANVAS2D.mount)(stage, controller, { only: ["airframe"], vary: varyMap, effects: Object.keys(A3.effects).length ? A3.effects : null, maxRatio: 2, ...GL_OPTIONS }); // fu/perf: the compile in tasks of 40 parts (review r1) fu/perf end
A3.canvas = canvas;
const varyEls = {};
const POOL_VARY = /^a3-m8-(pool|bpool|spool)/; // merge r2: the fallback light pools (see the vary writer)
const refreshVaryEls = () => {
  for (const cls of Object.keys(VARY)) varyEls[cls] = [...stage.querySelectorAll(`svg .${cls}`)];
};
refreshVaryEls();
const lastAlpha = {};

// ---------------------------------------------------------------------------------------------
// readout, aria, live region (DESIGN §1, §7.8)
// ---------------------------------------------------------------------------------------------
let compact = false;
const figureOf = stage.closest("figure") ?? plate;
// the readout's room (follow-up review 1: in the push the 103-character readout printed over the hint, "KEYS BPushback"):
// the corner's width beside the hint (24 px apart), measured on resize; texts are measured with a canvas, no layout
const hintEl = plate.querySelector('[data-corner="hint"]');
const fit = { room: Infinity, full: Infinity, font: "", spacing: 0, ctx: null };
let stageWidth = null;
function measureRoom() {
  const corners = readoutEl.parentElement.getBoundingClientRect();
  const cs = getComputedStyle(readoutEl);
  fit.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  fit.spacing = parseFloat(cs.letterSpacing) || 0;
  fit.full = corners.width;
  const h = hintEl ? hintEl.getBoundingClientRect() : null;
  const r = readoutEl.getBoundingClientRect();
  // the hint on its own line (narrow plates lift it 18 px) leaves the readout the whole width
  const sameLine = h && h.width > 0 && h.bottom > r.top + 1 && h.top < r.bottom - 1;
  fit.room = sameLine ? corners.right - h.right - 24 : corners.width;
}
const textWidth = (text) => {
  fit.ctx ??= document.createElement("canvas").getContext("2d");
  if (!fit.ctx) return text.length * 6.8;
  fit.ctx.font = fit.font;
  return fit.ctx.measureText(text).width + fit.spacing * text.length;
};
if (typeof ResizeObserver === "function")
  new ResizeObserver(() => {
    compact = plate.getBoundingClientRect().width < 600;
    figureOf.classList.toggle("a3-compact", compact); // the legend's touch-size buttons (a380.css)
    measureRoom();
    shown = "";
    stageWidth = stage.getBoundingClientRect().width; // the composition's CSS px (applyView)
  }).observe(plate);
const rateTag = (short = false) => {
  if (pv.paused) return " · paused";
  if (still.matches) return ""; // nothing runs between inputs: no rate to show
  // a held phase that is done and still shows no rate (×2 at an idle stand said something was running)
  if (pv.mode === "hold" && !pv.seek && sim.state.onGround && Math.abs(sim.state.speed) < 0.05 && heldSettled()) return "";
  // fu/r2-interaction: the tour's stand too (it read ×2 while nothing ran, and no rate after a seek to the gate): the
  // figure holds the stand, it does not play the 90-minute turn-round
  if (!pv.seek && sim.phase === "GATE" && heldSettled()) return "";
  const r = pv.rateShown ?? pv.rate;
  if (!(r >= 0.1) || Math.abs(r - 1) <= 0.05) return "";
  // quantised, so a slow frame's clamp does not change the text every frame (the loop could never go quiet)
  const q = r >= 10 || short ? (r >= 1 ? Math.round(r) : +r.toPrecision(1)) : Math.round(r * 2) / 2;
  return q === 1 ? "" : ` · ×${q}`;
};
const ftOf = (s) => `${Math.round(s.height / 0.3048).toLocaleString("en-US")} ft`;
// fu/r2-interaction: the short forms and the phone readout are F's (follow.mjs compactText: tokens shorten, then whole
// fields go, never a cut word; tools/compact-check.mjs walks the departure with it)
const thrustShort = (s) => F.thrustShort(s);
const speedShort = (s, kt = true) => F.speedShort(M, s, kt);
// the corner's room in characters too (a container narrower than a phone): never more than F.COMPACT_MAX
const compactReadout = (s) => F.compactText(M, s, rateTag(true), Number.isFinite(fit.room) ? Math.max(12, Math.min(F.COMPACT_MAX, Math.floor(fit.room / Math.max(1, textWidth("0"))))) : F.COMPACT_MAX).text;
// fu/r2-interaction end
/** The wide readout's shorter form, used where the full one does not fit beside the hint (the push's start). */
const MEDIUM_PHASE = { GATE: "At the gate", PUSHBACK: "Push & start" };
function mediumReadout(s) {
  const phase = s.phase === "FL100" ? M.phaseWords(s) : MEDIUM_PHASE[s.phase] ?? M.phaseWords(s);
  const parts = [phase, `CONF ${M.confName(s.slat, s.flap)}`, thrustShort(s), speedShort(s)];
  if (!s.onGround && !(s.phase === "FL100" && s.height >= 10000 * 0.3048)) parts.push(ftOf(s));
  if (!s.onGround) parts.push(s.gear.stage === "up" ? "gear up" : s.gear.stage === "locked" ? "gear down" : s.gear.cmd ? "gear extending" : "gear retracting"); // on the ground it is down
  return parts.filter(Boolean).join(" · ");
}
let shown = "";
let shownCore = ""; // the readout without its rate tag (the loop's quiet test)
// fu/f4-interaction: the open Inspect view, named in the readout's place (review: on a phone the view's name showed only
// on the Inspect button and the tip line, both below the fold): { label, index, count }, set by inspectStep
let readoutView = null;
function writeReadout() {
  const s = sim.state;
  let text;
  if (pv.label) text = shownCore = pv.label;
  else if (readoutView && !pv.seek) {
    // the view first; on a wide card the flight readout follows where it fits
    const head = `Inspect · ${readoutView.label} · ${readoutView.index + 1}/${readoutView.count}`;
    text = shownCore = head;
    if (!compact) {
      for (const tail of [M.readout(s), mediumReadout(s)]) {
        if (textWidth(`${head} · ${tail}`) <= fit.room) {
          text = shownCore = `${head} · ${tail}`;
          break;
        }
      }
    }
    if (pv.paused) text = shownCore = `${text} · paused`;
  } else if (pv.seek) text = shownCore = `${pv.seek.kind === "back" ? "rewinding" : "fast-forward"} · ${pv.seek.arming ?? M.PHASES.find((p) => p.id === pv.seek.phase)?.label ?? pv.seek.phase}${pv.paused ? " · paused" : ""}`;
  else if (compact) {
    text = compactReadout(s);
    shownCore = text.replace(/ · ×[\d.]+$/, "");
  } else {
    // the full readout where it fits beside the hint, else the shorter form, else the phone's
    const tag = rateTag();
    shownCore = M.readout(s);
    text = shownCore + tag;
    if (textWidth(text) > fit.room) {
      shownCore = mediumReadout(s);
      text = shownCore + tag;
      if (textWidth(text) > fit.room) {
        text = compactReadout(s);
        shownCore = text.replace(/ · ×[\d.]+$/, "");
      }
    }
  }
  if (text !== shown) {
    readoutEl.textContent = text;
    shown = text;
  }
}
let ariaTimer = 0;
const bearingWords = (b) => {
  const a = ((b % 360) + 540) % 360 - 180;
  const side = a > 0 ? "right" : "left";
  const m = Math.abs(a);
  if (m < 20) return "seeing the nose";
  if (m < 70) return `seeing the nose and ${side} side`;
  if (m < 110) return `seeing the ${side} side`;
  if (m < 160) return `seeing the tail and ${side} side`;
  return "seeing the tail";
};
let ariaHeading = null;
let ariaAt = 0;
const writeValueText = () => {
  const heading = Math.round(wrap360(pv.turn));
  stage.setAttribute("aria-valuetext", `Turntable ${heading}°, ${bearingWords(F.bearingOfTurn(pv.turn))}`);
  ariaHeading = heading;
  ariaAt = performance.now();
};
function describe(force = false) {
  const heading = Math.round(wrap360(pv.turn));
  stage.setAttribute("aria-valuenow", String(heading));
  const moved = ariaHeading === null ? 360 : Math.abs(((heading - ariaHeading + 540) % 360) - 180);
  if (force || moved >= 5 || performance.now() - ariaAt > 1000) writeValueText();
  clearTimeout(ariaTimer);
  ariaTimer = setTimeout(writeValueText, 700);
}
let focused = false;
// fu/r2-interaction: the polite live region is not flooded (sort review: one Inspect change under a resting mouse spoke 12
// part names in 6 s, holding ] for 2 s spoke 30 steering lines). A line identical to the last one within 2 s is
// skipped; a held key's repeats (sayDefer) keep only their last line, spoken on keyup; a part's name is spoken only for
// a real pointer move, tap or click (pointerPick), not for the re-pick that runs while the stage moves under a still pointer
let pointerPick = false;
let sayDefer = false;
let sayHeld = null;
let saidText = "";
let saidAt = 0;
const say = (text) => {
  if (!liveEl || !(pv.mode === "hold" || focused)) return;
  if (sayDefer) {
    sayHeld = text;
    return;
  }
  const now = performance.now();
  if (text === saidText && now - saidAt < 2000) return;
  saidText = text;
  saidAt = now;
  liveEl.textContent = text;
};
// fu/r2-interaction end
stage.addEventListener("focus", () => {
  focused = true;
  say(M.ariaText(sim.state));
});
stage.addEventListener("blur", () => (focused = false));
// fu/f4-interaction: the narrow layout draws the stage's keyboard ring on the card (a380.css .a3-ring)
{
  const ringPlate = stage.closest(".iso-plate");
  if (ringPlate) {
    // on focus, and after a key (a key pressed on a stage focused by a pointer turns its ring on)
    const ring = () => ringPlate.classList.toggle("a3-ring", document.activeElement === stage && stage.matches(":focus-visible"));
    stage.addEventListener("focus", ring);
    stage.addEventListener("keydown", () => setTimeout(ring, 0));
    stage.addEventListener("blur", () => ringPlate.classList.remove("a3-ring"));
  }
}

// ---------------------------------------------------------------------------------------------
// modes, seek, rewind
// ---------------------------------------------------------------------------------------------
let idleTimer = 0;
let idleDue = 0; // theme switch (site): when the idle timer fires, so a remount carries it
const armIdle = (ms) => {
  idleDue = performance.now() + ms;
  return setTimeout(idleResume, ms);
};
let idleArmed = false; // a reader's hold (not a tool's): the tour resumes 30 s after the held phase settles
let holdAt = 0;
let wasSettled = true;
const IDLE_MS = 30000; // DESIGN §7.6: the tour resumes after 30 s without input
const IDLE_WAIT_MAX = 150000; // a phase that can never settle (stopped on the runway with the engines off) still resumes
function hold(why) {
  if (pv.mode !== "hold") pv.mode = "hold";
  clearTimeout(idleTimer);
  // a tool (drive.mjs, turn-check) holding the controller is not a reader: the tour does not resume under it, so a
  // slow verification session is not turned away from the bearing it set
  idleArmed = why !== "tool" && !still.matches;
  holdAt = performance.now();
  wasSettled = heldSettled();
  if (idleArmed) idleTimer = armIdle(IDLE_MS);
  syncLegend();
}
/** The held phase has finished what it was asked to do: no seek, no engine start, its goals met (the gate: doors still). */
function heldSettled() {
  if (pv.seek || engSeq || F.enginesBusy(sim.state, sim.target) || checkT >= 0) return false;
  if (sim.state.hlMoving) return false; // fu/r2-interaction: a reader's flaps still driving (the tour took over mid-drive at the stand)
  if (sim.phase === "GATE") return !F.doorsMoving(sim.state, sim.target);
  // fu/r2-interaction: the reader shut the engines down on the ground and the aircraft stands: nothing more will happen
  // (the phase is not done: model.mjs phaseDone), so the 30 s idle wait runs, no rate shows, and the resumed tour
  // restarts the engines in this phase (clearOverrides) instead of jumping on
  if (sim.state.onGround && Math.abs(sim.state.speed) < 0.05 && sim.overrides && sim.overrides.engineRun && !sim.state.engineRun.some((r) => r) && !F.doorsMoving(sim.state, sim.target)) return true;
  return Boolean(sim.done);
}
function idleResume() {
  // a reader's pause (Space) holds until the next Space: the tour never takes over a paused figure (follow-up review
  // 1: it resumed 30 s later and ran at ×2 while the live region still said "Paused"). Any later input re-arms this
  if (pv.paused) return;
  if (!heldSettled() && performance.now() - holdAt < IDLE_WAIT_MAX) {
    // the chosen phase is still running (a seek, an engine start, a take-off roll): wait for it to finish, then hold
    // it 30 s (the tick restarts the timer when it settles)
    idleTimer = armIdle(3000);
    return;
  }
  resumeTourClean();
}
/**
 * Back to the tour from the current state (the idle timer and Esc share it): the reader's overrides are cleared and
 * the phase's own targets rebuilt (applyOverrides only merges, so clearing sim.overrides alone left them in
 * sim.target), the page's own targets reset, Inspect left, the pause lifted; nothing on screen jumps.
 */
function resumeTourClean() {
  clearTimeout(idleTimer);
  // the live region says what happened before the mode changes (follow-up review 1: Esc mid-rewind and the idle resume
  // announced nothing, and it kept saying "Seeking to At the gate" or "Paused" while the tour ran)
  const stopped = pv.seek ? `${pv.seek.kind === "back" ? "Rewind" : "Fast-forward"} stopped at ${phaseLabel(sim.phase)} · tour resumed` : "Tour resumed";
  // a seek or rewind in flight stops where the model is (review round 3: it ran on under the tour, whose clock played
  // the push's bearings while the aircraft flew to 10,000 ft)
  if (pv.seek) {
    pv.seek = null;
    sim.rateSnap = true;
  }
  leaveInspect();
  say(stopped);
  sim.pin = null;
  pv.mode = "tour";
  pv.paused = false;
  clearOverrides();
  armed = null;
  pv.gearShowTarget = 0;
  pv.steerTarget = 0;
  readerCabin = 0; // the tour owns the cutaway again
  resumeTour();
  syncLegend();
  wake();
}
/** Clear every reader override and rebuild the phase's targets from the model. */
function clearOverrides() {
  sim.overrides = {};
  sim.target = M.phaseState(sim.phase);
  engSeq = null;
  checkT = -1;
  checkStill = -1;
  pv.spoilerTarget = 0;
  pv.spoiler1Target = 0;
  pv.aileronUp = 0;
  pv.groundSpoilers = false;
  syncLever();
}
/**
 * A seek to `phase` drops the reader's settings that conflict with the goals of the phases it must pass through
 * (M.phaseDone): the flaps lever, the gear lever and the speed brake on any seek; the doors and the engines for the
 * push and later. Lights and the cabin dimmer persist (DESIGN §7.3). The phase's targets are rebuilt.
 */
function dropConflicts(phase) {
  const o = { ...(sim.overrides ?? {}) };
  for (const key of ["slat", "flap", "aileronDroop", "gear", "spoilers"]) delete o[key];
  if (F.PHASE_ORDER.indexOf(phase) >= 1) {
    delete o.doors;
    delete o.engineRun;
    delete o.n1;
    engSeq = null;
  }
  sim.overrides = o;
  sim.target = M.phaseState(sim.phase);
  F.applyOverrides(sim);
  pv.spoilerTarget = 0;
  pv.spoiler1Target = 0;
  pv.aileronUp = 0;
  pv.groundSpoilers = false;
  checkT = -1;
  checkStill = -1;
  syncLever();
}
/**
 * Reduced motion: an action's end state at once (DESIGN §7.9: one still frame per input). The model is substepped
 * synchronously, without leaving the phase, until the doors, surfaces, gear and engines reach their targets.
 */
let refusedNow = false; // the input's action was refused: its tick must not step the model (review round 3)
function jumpToTargets() {
  if (refusedNow) {
    refusedNow = false;
    return;
  }
  if (!still.matches) return;
  const near = () => {
    const s = sim.state;
    const t = sim.target;
    if (engSeq) return false; // the start sequence waits for the beacon, then 1+2 at idle, then 3+4
    if (F.doorsMoving(s, t)) return false;
    if (t.cabin !== undefined && Math.abs((s.cabin ?? 1) - t.cabin) > 0.01) return false; // the cabin dimmer
    if (Math.abs((s.slat ?? 0) - (t.slat ?? s.slat)) > 0.05 || Math.abs((s.flap ?? 0) - (t.flap ?? s.flap)) > 0.05) return false;
    // the gear's own end stage, not only its numbers (doors at 2e-15 left the model in "doorsClosing" for good)
    if (t.gear !== undefined && (Math.abs(s.gear.leg - t.gear) > 1e-3 || Math.abs((s.gear.body ?? s.gear.leg) - t.gear) > 1e-3 || s.gear.doors > 1e-3 || s.gear.stage !== (t.gear ? "locked" : "up"))) return false;
    if (t.n1 && s.engineRun.some((r, i) => r && Math.abs(s.n1[i] - Math.max(M.ENGINES.n1.groundIdle, t.n1[i])) > 0.5)) return false;
    if (t.engineRun && t.engineRun.some((r, i) => r && !s.engineRun[i])) return false;
    if (t.engineRun && t.engineRun.some((r, i) => !r && s.engineRun[i])) return false; // commanded off, not yet shut down
    if (s.engineRun.some((r) => !r) && s.n1.some((n, i) => !s.engineRun[i] && n > 0.5)) return false; // spooling down
    return true;
  };
  // one model substep first: a switch (lights, the cabin dimmer) takes effect in step(), and near() does not look at
  // lights (a light switch under reduced motion changed nothing until another input stepped the model)
  F.advance(M, sim, F.SUBSTEP, { auto: false, rate: 1 });
  pinPath();
  for (let i = 0; i < 4000 && !near(); i++) {
    F.advance(M, sim, 0.05, { auto: false, rate: 30 });
    pinPath();
    engineSequence();
  }
  pv.spoiler = pv.spoilerTarget ?? 0;
  pv.spoiler1 = pv.spoiler1Target ?? 0;
  pv.aileronUpNow = pv.aileronUp ?? 0;
}
/** The tour clock that matches the model's phase (DATA.tourPhases: figure s at each phase start in the tour). */
function resumeTour() {
  const T = DATA.tourPhases ?? {};
  const at = F.PHASE_ORDER.indexOf(sim.phase);
  const start = T[sim.phase] ?? 0;
  const next = T[F.PHASE_ORDER[at + 1]] ?? F.LOOP - 8;
  if (sim.phase === "GATE") {
    // the gate: from the tour time the hold began if that was at the gate, else from its start, so the cutaway's
    // cabin hold plays (sim.t counts the held seconds: the resumed tour pushed back at once, review round 3); the
    // gate dwell restarts from the same clock
    pv.tourT = pv.tourT >= start && pv.tourT < next - 0.05 ? pv.tourT : 0;
    sim.t = pv.tourT - start;
  } else pv.tourT = Math.min(start + Math.max(0, sim.t), next - 0.05);
  pv.catchUp = true;
}
let reducedTugHeld = false; // fu/f3-interaction: a reduced-motion Push & start stopped with the tug at the nose wheel
function seekTo(phase) {
  sim.pin = null;
  const order = F.PHASE_ORDER;
  const at = order.indexOf(sim.phase);
  const want = order.indexOf(phase);
  if (want < 0) return;
  hold("seek");
  dropConflicts(phase);
  if (still.matches) {
    // reduced motion: jump through synchronous substeps to the phase's end state. Small slices with the phase
    // checked after each: one long slice at a high rate ran through several phases (auto-advance) in one call.
    if (want < at) sim = F.createSim(M, sim.overrides);
    if (want > 0 && sim.phase === "GATE") F.enterPhase(M, sim, "PUSHBACK");
    let steps = 0;
    while (F.PHASE_ORDER.indexOf(sim.phase) < want && steps++ < 20000) F.advance(M, sim, 0.05, { rate: 30, stopAt: phase });
    if (sim.phase !== phase) F.enterPhase(M, sim, phase);
    // the end state exactly: single model substeps with phaseDone checked after each (coarse slices overshot the
    // take-off's 35 ft by 140 ft)
    // fu/f3-interaction: Push & start stops first where the pushback tug holds the pushed-back aircraft, its cradle on
    // the nose wheel (the phase's end has the tug gone, so a reduced-motion reader never saw it); the same key again
    // (or the next phase) runs on to the end, the tug released and gone
    const tugStop = phase === "PUSHBACK" && !(reducedTugHeld && want === at);
    reducedTugHeld = false;
    let guard = 0;
    while (!M.phaseDone(sim.state, sim.phase) && guard++ < 60000) {
      const keep = sim.state;
      const keepT = sim.t;
      F.advance(M, sim, F.SUBSTEP, { auto: false, rate: 1 });
      if (tugStop && (keep.tug ?? 0) >= 1 && (sim.state.tug ?? 0) > 1) {
        sim.state = keep;
        sim.t = keepT;
        reducedTugHeld = true;
        break;
      }
    }
    sim.done = M.phaseDone(sim.state, sim.phase);
    if (!sim.state.onGround) levelOff();
    pinPath();
    sim.rateSnap = true;
    syncLever();
    doneSaid = sim.phase;
    say(phaseLine(sim.phase));
    wake();
    return;
  }
  if (want === at && pv.seek === null) {
    F.enterPhase(M, sim, phase);
    syncLever();
    wake();
    return;
  }
  // a phase key while paused plays its seek and pauses again where it arrives (follow-up review 1: Space, then 5 left
  // the readout on the line-up while the legend marked the take-off); Space during the seek freezes it
  const repause = pv.paused || Boolean(pv.seek && pv.seek.repause);
  pv.paused = false;
  pv.seek = { phase, kind: want > at ? "forward" : "back", from: performance.now(), repause, reader: true }; // fu/r2-interaction: reader
  if (pv.seek.kind === "back") {
    // play the recorded history backward over at most REWIND_MAX_S s
    let target = -1;
    for (let i = history.length - 1; i >= 0; i--) if (history[i].phase === phase) target = i;
    if (target < 0) {
      sim = F.createSim(M, sim.overrides);
      if (phase !== "GATE") pv.seek = { phase, kind: "forward", from: performance.now(), repause, reader: true };
      else {
        seekArrived(pv.seek);
        syncLever();
        say(`${phaseLabel("GATE")}: rewound · ${phaseLine("GATE")}`);
        return;
      }
    } else pv.seek.target = target;
  }
  wake();
  say(`Seeking to ${M.PHASES[want].label}`);
}
/** A seek or rewind has arrived: the phase's own rate (not the seek's ×66 in the tag), and the reader's pause again. */
function seekArrived(seek) {
  pv.seek = null;
  sim.rateSnap = true;
  pv.rate = pv.rateShown = F.rateOf(sim.phase, sim.state, sim.target);
  if (seek && seek.repause) pv.paused = true;
  // fu/r2-interaction: a forward seek's arrival is said, as a rewind's is (the live region kept "Seeking to Take-off")
  if (seek && seek.kind === "forward" && seek.reader) say(`${phaseLabel(sim.phase)}: arrived${pv.paused ? " · paused" : ""}`);
}
/** Model seconds from the current state to the start of `phase` along the departure (DATA.timeline). */
function modelSecondsTo(phase) {
  const T = DATA.timeline ?? {};
  const here = T[sim.phase] ?? 0;
  return Math.max(0.5, (T[phase] ?? here) - here - (sim.state.phaseTime ?? 0));
}
/** In HOLD, an airborne phase that is done levels off at its height (the model's levelOff), so HOLD holds. */
function levelOff() {
  if (sim.target.levelOff) return;
  sim.target.levelOff = true;
  sim.target.height = Math.max(sim.state.height, 0);
}
/**
 * HOLD in an airborne phase that is done: the flight path is pinned at the phase's end state (height, speed,
 * pitch), so the readout reads the phase's end for the whole hold (review round 3: the climb drifted to 3,223 ft and
 * 251 kt, FL100 to 10,046 ft). Lights, fans, gear, flaps and the ground's scroll still run.
 */
function pinPath() {
  const st = sim.state;
  // the tour's FL100 hold too (follow-up review 1: it climbed on to 10,663 ft under a header reading 10,000 ft)
  const holding = pv.mode === "hold" || (pv.mode === "tour" && sim.phase === "FL100");
  if (!holding || pv.seek || !sim.done || st.onGround) {
    if (sim.pin && (sim.pin.phase !== sim.phase || st.onGround || !holding || pv.seek)) sim.pin = null;
    return;
  }
  if (!sim.pin || sim.pin.phase !== sim.phase) sim.pin = sim.doneAt && sim.doneAt.phase === sim.phase ? { ...sim.doneAt } : { phase: sim.phase, height: st.height, speed: st.speed, pitch: st.pitch, gamma: st.gamma, vs: st.vs };
  const p = sim.pin;
  st.height = p.height;
  st.speed = p.speed;
  st.pitch = p.pitch;
  st.gamma = p.gamma;
  st.vs = p.vs;
}
/** One history entry for the rewind (every HISTORY_EVERY s of page time, and along a forward seek's path). */
function recordHistory() {
  // a settled hold adds nothing to rewind through: it is not recorded (review round 3: a 4-minute hold at FL100 filled
  // the history with one static state, the rewind replayed it for 7 s and then jumped from 10,000 ft to the stand)
  const prev = history[history.length - 1];
  const same = prev && prev.phase === sim.phase && pv.mode === "hold" && heldSettled() && Math.abs(prev.state.height - sim.state.height) < 0.05 && Math.abs(prev.state.speed - sim.state.speed) < 0.05 && Math.abs(prev.state.gear.leg - sim.state.gear.leg) < 1e-4 && Math.abs((prev.state.gear.body ?? prev.state.gear.leg) - (sim.state.gear.body ?? sim.state.gear.leg)) < 1e-4 && Math.abs(prev.state.slat - sim.state.slat) < 0.01 && Math.abs(prev.state.flap - sim.state.flap) < 0.01;
  if (!same) history.push({ state: sim.state, phase: sim.phase, t: sim.t });
  // full: the older half is thinned to every other entry, so every phase of the departure keeps a sparse record and
  // the oldest gate entry stays (the loop's rewind and key 1 always find the stand)
  if (history.length > HISTORY_MAX) {
    const half = Math.floor(history.length / 2);
    const keep = [];
    for (let i = 0; i < half; i++) if (i === 0 || i % 2 === 0 || history[i].phase !== history[i - 1].phase) keep.push(history[i]);
    history.splice(0, half, ...keep);
  }
}
/**
 * How much the picture changes between two history states (follow-up, item 60): the rewind spends its time where the
 * drawing moves (lift, pitch, gear, surfaces, doors, the tug, the ground on the roll), not evenly per entry, so the
 * take-off's last 35 ft (6 m of drawn lift in 3 model seconds) is not crossed in one frame.
 */
function visualStep(a, b) {
  let d = 0.05;
  d += Math.abs(F.liftOf(a.height) - F.liftOf(b.height)) / 10;
  d += Math.abs((a.pitch ?? 0) - (b.pitch ?? 0)) / 2;
  d += Math.abs(a.gear.leg - b.gear.leg) * 3 + Math.abs((a.gear.body ?? a.gear.leg) - (b.gear.body ?? b.gear.leg)) * 3 + Math.abs(a.gear.doors - b.gear.doors); // merge: the body gear trails on extension (gear request R13)
  d += (Math.abs(a.slat - b.slat) + Math.abs(a.flap - b.flap)) / 10;
  let door = 0;
  for (const id in a.doors) door = Math.max(door, Math.abs(a.doors[id] - (b.doors[id] ?? 0)));
  d += door;
  d += Math.abs(F.tugAlpha(a.tug ?? 0) - F.tugAlpha(b.tug ?? 0)) * 2;
  if (a.onGround && b.onGround) d += 0.3 * Math.min(1, Math.abs(a.groundDistance - b.groundDistance) / 50);
  return d;
}
/** The picture change between two states without the constant and the ground (the forward seek's per-frame cap). */
function pictureStep(a, b) {
  let d = Math.abs(F.liftOf(a.height) - F.liftOf(b.height)) / 10;
  d += Math.abs((a.pitch ?? 0) - (b.pitch ?? 0)) / 2;
  d += Math.abs(a.gear.leg - b.gear.leg) * 3 + Math.abs((a.gear.body ?? a.gear.leg) - (b.gear.body ?? b.gear.leg)) * 3 + Math.abs(a.gear.doors - b.gear.doors) * 3;
  d += (Math.abs(a.slat - b.slat) + Math.abs(a.flap - b.flap)) / 10;
  let door = 0;
  for (const id in a.doors) door = Math.max(door, Math.abs(a.doors[id] - (b.doors[id] ?? 0)));
  return d + door + Math.abs(F.tugAlpha(a.tug ?? 0) - F.tugAlpha(b.tug ?? 0)) * 2;
}
// the forward seek shows at most this much picture change per second of its clock (the whole departure is about 46)
const SEEK_PICTURE_PER_S = 30;
const REWIND_MAX_S = 4; // fu/f3-interaction: a rewind's longest run (was 8 s)
const REWIND_ENTRIES_PER_S = 150; // fu/f3-interaction: history entries a rewind crosses at most per second
/**
 * A state between two history entries (follow-up review 1: the tour's loop rewind stepped 2 m of lift and 2° of pitch
 * in one frame near lift-off, where two entries a tenth of a second apart are far apart in the picture): the
 * continuous values interpolated, everything else from the nearer entry.
 */
const LERP_KEYS = ["height", "pitch", "speed", "groundDistance", "gamma", "vs", "lift", "slat", "flap", "slatDrive", "flapDrive", "aileronDroop", "spoilers", "tug", "cabin", "apu"];
function lerpState(a, b, f) {
  if (f <= 0) return a;
  if (f >= 1) return b;
  const out = { ...(f < 0.5 ? a : b) };
  const mix = (x, y) => (typeof x === "number" && typeof y === "number" ? x + (y - x) * f : f < 0.5 ? x : y);
  for (const k of LERP_KEYS) if (k in a || k in b) out[k] = mix(a[k], b[k]);
  out.n1 = a.n1.map((v, i) => mix(v, b.n1[i]));
  out.gear = { ...out.gear, leg: mix(a.gear.leg, b.gear.leg), doors: mix(a.gear.doors, b.gear.doors), body: mix(a.gear.body ?? a.gear.leg, b.gear.body ?? b.gear.leg) };
  out.doors = Object.fromEntries(Object.keys(a.doors).map((id) => [id, mix(a.doors[id], b.doors[id] ?? a.doors[id])]));
  return out;
}
function rewindHistory(now) {
  const s = pv.seek;
  // driven by wall time, so a slow page still rewinds in at most 8 s (the per-frame dt is clamped)
  if (s.start === undefined) {
    s.start = history.length - 1;
    s.run = 0;
    // the cumulative picture change from the newest entry back to the target
    s.cum = [0];
    // (follow-up review 1: the picture's own change weighs 2.5 times more than before, so the lift-off, the rotation and
    // the gear take their share of the 8 s over the constant per entry and the ground's scroll)
    s.picture = 0; // fu/f3-interaction: the drawing's own change along the path (the forward seek's measure)
    for (let i = s.start; i > s.target; i--) {
      const a = history[i].state;
      const b = history[i - 1].state;
      const p = pictureStep(a, b);
      s.picture += p;
      s.cum.push(s.cum[s.cum.length - 1] + visualStep(a, b) + 1.5 * p);
    }
  }
  s.run += s.dt ?? 0; // running time only (the loop asleep offscreen does not count)
  const span = Math.max(1, s.start - s.target);
  // fu/f3-interaction: as long as the picture needs at the forward seek's pace (SEEK_PICTURE_PER_S), and at most
  // REWIND_ENTRIES_PER_S history entries a second, within 0.5-REWIND_MAX_S s (it was span / 30 entries, up to 8 s:
  // the whole departure took 8 s to rewind against a 3 s seek forward)
  const duration = Math.min(REWIND_MAX_S, Math.max(0.5, s.picture / SEEK_PICTURE_PER_S, span / REWIND_ENTRIES_PER_S));
  const u = Math.min(1, s.run / duration);
  // the position whose cumulative picture change is u of the whole (binary search), between two entries
  const total = s.cum[s.cum.length - 1];
  const want = total * u;
  let lo = 0;
  let hi = s.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.cum[mid] < want - 1e-9) lo = mid + 1;
    else hi = mid;
  }
  // lo: the first entry (counted back from the start) at or past the wanted change; the part of the step before it
  const c0 = lo > 0 ? s.cum[lo - 1] : 0;
  const frac = u >= 1 || lo === 0 ? 0 : clamp((want - c0) / Math.max(1e-9, s.cum[lo] - c0), 0, 1);
  const back = u >= 1 ? span : lo > 0 ? lo - 1 + frac : 0;
  let index = Math.max(s.target, s.start - Math.floor(back + 1e-9));
  if (index > history.length - 1) index = history.length - 1;
  history.length = index + 1;
  const f = index > s.target ? back - Math.floor(back + 1e-9) : 0;
  const h = f > 1e-6 ? { state: lerpState(history[index].state, history[index - 1].state, f), phase: f < 0.5 ? history[index].phase : history[index - 1].phase, t: history[index].t } : history[index];
  sim.state = h.phase === h.state.phase ? h.state : { ...h.state, phase: h.phase };
  sim.phase = h.phase;
  sim.target = M.phaseState(h.phase);
  F.applyOverrides(sim);
  sim.t = h.t;
  sim.done = false;
  sim.doneAt = null;
  sim.held = 0;
  if (index === s.target) {
    // no gate entry left to land on (never recorded): the history played back, then a fresh stand
    if (s.toGate && sim.phase !== "GATE") {
      const o = sim.overrides;
      sim = F.createSim(M, pv.mode === "tour" ? {} : o);
      history.length = 0;
    }
    seekArrived(s);
    syncLever();
    // the tour restarts its clock only where it starts (the gate); a rewind that landed elsewhere resumes from there
    if (pv.mode === "tour") {
      if (sim.phase === "GATE") pv.tourT = 0;
      else resumeTour();
    } else say(`${phaseLabel(sim.phase)}: rewound`);
  }
}

// ---------------------------------------------------------------------------------------------
// actions and the legend (core subset; I adds arming, Inspect, the light panel's AUTO rules)
// ---------------------------------------------------------------------------------------------
const onGroundStill = () => sim.state.onGround && Math.abs(sim.state.speed) < 1;
const setOverride = (key, value) => {
  sim.overrides = sim.overrides ?? {};
  sim.overrides[key] = value;
  F.applyOverrides(sim);
};
let tipTimer = 0;
/** The tooltip line under the legend; it clears itself (stale reasons must not linger). */
const tip = (text, ms = 3000) => {
  if (!tipEl) return;
  tipEl.textContent = text;
  clearTimeout(tipTimer);
  if (text) tipTimer = setTimeout(() => (tipEl.textContent = ""), ms);
};
// an action that is not legal now arms where arming is meaningful (DESIGN §1): seek or rewind to `phase`, then run
let armed = null;
// theme switch (site): an armed action is named (kind, arg), so a remount in another theme can carry it
const ARMED = {};
const arm = (phase, kind, arg, words) => {
  armed = { phase, kind, arg, words, then: () => ARMED[kind](arg) };
  seekTo(phase);
  if (pv.seek) pv.seek.arming = words;
};
const phaseLabel = (id) => M.PHASES.find((p) => p.id === id)?.label ?? id;
/** A phase's line for the live region, from the true state (said when the phase completes or a seek arrives). */
function phaseLine(phase) {
  const s = sim.state;
  const conf = M.confName(s.slat, s.flap);
  const kt = `${Math.round(Math.max(0, s.speed))} knots`;
  const ft = `${Math.round(s.height / 0.3048).toLocaleString("en-US")} feet`;
  const running = s.engineRun.filter(Boolean).length;
  const engines = running === 4 ? "all four engines at idle" : running ? `${running} engines running` : "engines off";
  const open = M.DOOR_IDS.filter((d) => s.doors[d] > 0.02).length;
  const gear = s.gear.stage === "up" ? "gear up" : s.gear.stage === "locked" ? "gear down" : s.gear.cmd ? "gear extending" : "gear retracting";
  if (phase === "GATE") return `Gate: ${open ? `${open} doors and holds open` : "all doors closed"}, ${engines}`;
  if (phase === "PUSHBACK") return `Push and start: pushed back, ${(s.tug ?? 2) >= 2 ? "the tug clear" : "the tug at the nose wheel"}, doors closed, slides ${s.slides}, beacon ${s.lights.beacon ? "on" : "off"}, ${engines}`;
  if (phase === "TAXI") return `Taxi: CONF ${conf} set, ${kt}`;
  if (phase === "LINEUP") return `Line-up: strobes ${s.lights.strobe ? "on" : "off"}, landing lights ${s.lights.landing ? "on" : "off"}, take-off lights ${s.lights.takeoff ? "on" : "off"}`;
  if (phase === "TAKEOFF") return `Take-off: lift-off, ${ft}, ${kt}, CONF ${conf}`;
  if (phase === "CLIMB") return `Climb: ${gear}, CONF ${conf}, ${ft}`;
  if (phase === "FL100") return `10,000 feet: landing lights ${s.lights.landing ? "on" : "off"}, ${kt}`;
  return phaseLabel(phase);
}
let doneSaid = null; // the phase whose completion was announced
let tugSaid = ""; // the pushback tug's last announced moment
let lightKey = ""; // the lights and switches the legend last showed
let cabinMixCss = -1; // the cabin dimmer's displayed mix on the stage's CSS, and the one the canvas painter baked
let cabinMixCanvas = 1;
let restTicks = 0; // fu/perf: ticks since the turntable last turned (the canvas ratio cap, PLAN item 41) fu/perf end
let restTurn = NaN; // fu/perf: the bearing it had then fu/perf end
let lastDetail = 1; // f3-perf: the line detail of the last set() f3-perf end
let viewDt = 0; // f3-perf: the time a half-rate skipped frame's view easing carries to the next f3-perf end
let paintOwed = false; // f3-perf: a skipped frame's canvas repaint, owed to the next frame f3-perf end
// f4-perf: the view's numbers (zoom, centre) applyView last computed, and their value at the previous tick (the rest
// test reads how far the view moved, not whether its 0.01-unit key changed: a composition's eased tail stepped the key
// every 10-15 ticks for seconds, so the 6 still ticks never came before the loop slept and the canvas stayed at the
// moving ratio, review f3 blocker); the governor's sample: the ticks and time since the last set() of a movement
const viewNow = [1, 0, 0];
const viewPrev = [1, 0, 0];
let viewSnapped = false; // applyView snapped the view spring's tail this tick
let govSpan = 0; // s since the last set() (that tick's interval included)
let govTicks = 0; // ticks since then
let govClean = false; // every tick since then set() or was a half-rate skip (one movement, no idle tick between)
// f4-perf end
// f3-perf: the adaptive quality governor (DESIGN §5.11; owner decision 0: every part and every feature stays drawn).
// While the airframe moves and frames run long (phones, slow machines), it lowers what costs per pixel and per line,
// a level at a time: the airframe canvas's backing store 2 → 1.5 → 1 device pixels per CSS pixel, then the fade lines
// (seams, ribs, rivet dots: the kit's `detail`, eased out as a fast spin already does). Every part, face, light and
// effect is drawn at every level. A step is kept only if it pays: after a step down the frame interval is measured
// again, and a step that did not shorten it by a tenth is undone and not tried again for a while (a page bound by its
// script, not by raster, keeps full quality). At rest (6 still ticks) full quality comes back at once: the ratio up to
// 4 (the device's, for reader zoom) and the lines eased back in; the next movement starts again from level 0 (f4-perf).
// A3.quality: { enabled, force (a level, for measurements), level, ema }; ?quality=full turns it off.
const GOV_LEVELS = [
  { ratio: 2, detail: 1 },
  { ratio: 1.5, detail: 1 },
  { ratio: 1, detail: 1 },
  { ratio: 1, detail: 0 },
];
const GOV = { enabled: !/[?&]quality=full\b/.test(location.search), force: null, level: 0, ema: 0, slow: 0, probe: 0, before: 0, cap: GOV_LEVELS.length - 1, capFor: 0, steps: [] };
const GOV_SLOW = 26; // ms a frame: under about 38 fps
const GOV_STEP = 12; // slow frames in a row before a step down
const GOV_PROBE = 30; // frames measured after a step down (the first 6 skipped: the resize and the lines' fade)
const GOV_HOLD = 1800; // frames a step that did not pay is not tried again
function governFrame(intervalMs) {
  if (GOV.force !== null) {
    GOV.level = Math.max(0, Math.min(GOV_LEVELS.length - 1, GOV.force));
    return;
  }
  if (!GOV.enabled) {
    GOV.level = 0;
    return;
  }
  if (!(intervalMs > 0 && intervalMs < 1000)) return; // a stall or a wake, not a frame
  if (GOV.capFor > 0 && --GOV.capFor === 0) GOV.cap = GOV_LEVELS.length - 1;
  if (GOV.probe > 0) {
    GOV.probe--;
    if (GOV.probe === GOV_PROBE - 6) GOV.ema = intervalMs; // measured afresh from here
    else GOV.ema = 0.85 * GOV.ema + 0.15 * intervalMs;
    if (GOV.probe === 0 && !(GOV.ema < 0.9 * GOV.before)) {
      GOV.steps.push(`${GOV.level}: ${GOV.before.toFixed(1)} → ${GOV.ema.toFixed(1)} ms, undone`);
      GOV.level--;
      GOV.cap = GOV.level;
      GOV.capFor = GOV_HOLD;
    } else if (GOV.probe === 0) GOV.steps.push(`${GOV.level}: ${GOV.before.toFixed(1)} → ${GOV.ema.toFixed(1)} ms, kept`);
    if (GOV.steps.length > 20) GOV.steps.shift();
    return;
  }
  GOV.ema = GOV.ema ? 0.8 * GOV.ema + 0.2 * intervalMs : intervalMs;
  GOV.slow = GOV.ema > GOV_SLOW ? GOV.slow + 1 : 0;
  if (GOV.slow >= GOV_STEP && GOV.level < GOV.cap) {
    GOV.before = GOV.ema;
    GOV.level++;
    GOV.probe = GOV_PROBE;
    GOV.slow = 0;
  }
}
// f4-perf: at rest full quality comes back and the next movement starts from it (review f3: one level a rest left a
// throttled page's next movement two levels down before it was measured); a probe running is dropped (its "after"
// would mix two movements), and the EMA starts afresh with the next movement's frames
function governRest() {
  if (GOV.force === null) {
    GOV.level = 0;
    GOV.probe = 0;
  }
  GOV.ema = 0;
  GOV.slow = 0;
} // f4-perf end
A3.quality = GOV;
// f3-perf end
const CABIN_RUN = (name) => name.startsWith("cabin."); // fu/perf: the tinted runs (kit patch 24) fu/perf end; fu/r2-interiors: the cabin only, not the flight deck (its lights are not on the cabin crew's panel) fu/r2-interiors end
// the cutaway's owner (follow-up review 1): the tour opens it at the gate (3.5-13 s); a reader who takes over keeps it
// while the figure stays at the stand, and it eases shut (2.5 s) once a seek or the model leaves the gate, unless the
// reader opened it (C, the Cutaway button, a canopy or crown click). Before, a phase key pressed in that window flew
// the whole departure with the crowns and the canopy lifted off
let readerCabin = 0; // the reader's own cutaway
let tourCut = false; // the cutaway shown now was opened by the tour
A3.actions.cutaway = () => {
  pv.cabinTarget = pv.cabinTarget > 0.5 ? 0 : 1;
  tourCut = false;
  if (!inspect) readerCabin = pv.cabinTarget;
  say(pv.cabinTarget ? "Cutaway open: flight deck, first class and both cabin decks" : "Cutaway closed");
};
/** Open or close doors (open: true/false; null toggles: any open → close all). Returns true when closing. */
const toggleDoors = (ids, open = null) => {
  const closing = open === null ? ids.some((d) => (sim.target.doors[d] ?? 0) > 0.5) : !open;
  setOverride("doors", { ...(sim.overrides.doors ?? {}), ...Object.fromEntries(ids.map((d) => [d, closing ? 0 : 1])) });
  return closing;
};
ARMED.door = (id) => {
  toggleDoors(id ? [id] : M.DOOR_IDS, true);
  say(`${id ? `Door ${id}` : "Doors"} opening`);
};
A3.actions.door = (id) => {
  const ids = id ? [id] : M.DOOR_IDS;
  const what = id ? `Door ${id}` : "Doors";
  // fu/r2-interaction: an arming action during a reader's seek or rewind re-targeted it (sort review: K during the rewind
  // to the stand turned it into a rewind to the taxi)
  if (pv.seek && pv.seek.reader) return refuse(`${what}: wait for the ${pv.seek.kind === "back" ? "rewind" : "seek"} to arrive`);
  if (!onGroundStill() || sim.phase !== "GATE") {
    // in flight, moving, or anywhere past the stand: rewind to the stand, then open (DESIGN §1, "Arming"); the phase
    // label never changes without the aircraft being there
    arm("GATE", "door", id, "arming doors");
    say(`Rewinding to the stand · arming ${id ? `door ${id}` : "doors"}`);
    return;
  }
  const opening = ids.some((d) => (sim.target.doors[d] ?? 0) <= 0.5);
  if (opening && !ids.some((d) => (sim.target.doors[d] ?? 0) > 0.5) && enginesTurning()) return refuse("Doors: shut the engines down first (E)");
  const closing = toggleDoors(ids);
  say(`${what} ${closing ? "closing" : "opening"}`);
};
A3.actions.doors = () => A3.actions.door("");
// engines: on the ground, the beacon first, then 1 and 2, then 3 and 4 once 1 and 2 are at idle; or shut down all four
let engSeq = null;
function engineSequence() {
  if (!engSeq) return;
  const s = sim.state;
  if (!s.onGround) {
    engSeq = null;
    return;
  }
  if (engSeq.stage === -1) {
    // the doors first (E at the stand with doors open): then the beacon
    if (!F.doorsMoving(s, sim.target) && !anyDoorOpen()) {
      setOverride("lights", { ...(sim.overrides.lights ?? {}), beacon: 1 });
      engSeq.stage = 0;
    }
    return;
  }
  if (engSeq.stage === 0 && s.lights.beacon) {
    setOverride("engineRun", [1, 1, 0, 0]);
    setOverride("n1", [M.ENGINES.n1.groundIdle, M.ENGINES.n1.groundIdle, 0, 0]);
    engSeq.stage = 1;
  } else if (engSeq.stage === 1 && s.n1[0] >= M.ENGINES.n1.groundIdle - 0.6 && s.n1[1] >= M.ENGINES.n1.groundIdle - 0.6) {
    setOverride("engineRun", [1, 1, 1, 1]);
    setOverride("n1", [1, 1, 1, 1].map(() => M.ENGINES.n1.groundIdle));
    engSeq = null;
  }
}
const ROLL_KT = 30;
/** Any passenger or cargo door open, or opening (the state or the target). */
const anyDoorOpen = () => M.DOOR_IDS.some((d) => (sim.state.doors[d] ?? 0) > 0.002 || (sim.target.doors[d] ?? 0) > 0.5);
const enginesTurning = () => sim.state.engineRun.some((r) => r) || sim.state.n1.some((n) => n > 2);
const onRoll = () => sim.state.onGround && sim.phase === "TAKEOFF" && sim.state.speed > ROLL_KT;
/** The pushback tug is at the nose wheel (connecting, connected, pushing, releasing). fu/r2-interaction */
const tugHolds = () => (sim.state.tug ?? 0) > 0 && (sim.state.tug ?? 0) < 2;
/** A refused action: the reason on the tip line and to screen readers (the tip line is aria-live off). */
const refuse = (text) => {
  refusedNow = true;
  tip(text);
  say(text);
};
// fu/f4-interaction: Pause / Resume, for Space and the legend's Pause button (review: a phone reader had no way to
// freeze the departure; input only held the tour while the model ran on)
A3.actions.pause = () => {
  hold("pause");
  pv.paused = !pv.paused;
  // a pause during a seek freezes it (the tick skips it); the reader's own Space decides what happens on arrival
  if (pv.seek) pv.seek.repause = false;
  say(pv.paused ? (pv.seek ? `Paused · ${pv.seek.kind === "back" ? "rewinding" : "fast-forward"} to ${phaseLabel(pv.seek.phase)}` : "Paused") : "Running");
};
// fu/f4-interaction end
A3.actions.engines = () => {
  // fu/f4-interaction: the seek's own motion is not the reader's to stop (review: "stop the aircraft first" in a rewind)
  if (pv.seek && pv.seek.reader) return refuse(`Engines: wait for the ${pv.seek.kind === "back" ? "rewind" : "seek"} to arrive`);
  if (!sim.state.onGround) return refuse("Engines start and stop on the ground");
  if (onRoll()) return refuse(`Engines: no shutdown on the take-off roll above ${ROLL_KT} kt`);
  const running = sim.state.engineRun.some((r) => r);
  // fu/r2-interaction (sort review): a shutdown while taxiing or during the push left a half-done phase (the taxi
  // declared complete at 0 kt, a stuck push reading ×12 for 45 s): the aircraft stops first, and the tug lets go
  if (running && tugHolds()) return refuse("Engines: wait for the pushback tug to release the nose wheel");
  if (running && Math.abs(sim.state.speed) > 1) return refuse("Engines: stop the aircraft first");
  // fu/r2-interaction end
  engSeq = null;
  if (running) {
    setOverride("engineRun", [0, 0, 0, 0]);
    setOverride("n1", [0, 0, 0, 0]);
    say("Engines shutting down");
  } else if (anyDoorOpen()) {
    // review round 3: the start ran with all 19 doors open. As the push does: the doors close first, then the
    // beacon comes on and the engines start
    toggleDoors(M.DOOR_IDS, false);
    engSeq = { stage: -1 };
    say("Doors closing · then beacon on, engines 1 and 2, then 3 and 4");
  } else {
    setOverride("lights", { ...(sim.overrides.lights ?? {}), beacon: 1 });
    engSeq = { stage: 0 };
    say("Beacon on · starting engines 1 and 2, then 3 and 4");
  }
};
// one engine on the ground (M4 request R2): a part's click action engine:{n}
A3.actions.engine = (n) => {
  const i = Number(n) - 1;
  if (!(i >= 0 && i < 4)) return;
  if (!sim.state.onGround) return refuse("Engines start and stop on the ground");
  if (onRoll()) return refuse(`Engines: no shutdown on the take-off roll above ${ROLL_KT} kt`);
  const run = sim.state.engineRun.slice();
  const on = !run[i];
  if (on && anyDoorOpen()) return refuse("Engines: close the doors first (D)");
  if (!on && tugHolds()) return refuse("Engines: wait for the pushback tug to release the nose wheel"); // fu/r2-interaction
  if (!on && Math.abs(sim.state.speed) > 1) return refuse("Engines: stop the aircraft first"); // fu/r2-interaction
  engSeq = null;
  run[i] = on ? 1 : 0;
  setOverride("engineRun", run);
  const n1 = (sim.overrides.n1 ?? sim.target.n1 ?? [0, 0, 0, 0]).slice();
  n1[i] = on ? M.ENGINES.n1.groundIdle : 0;
  setOverride("n1", n1);
  if (on) setOverride("lights", { ...(sim.overrides.lights ?? {}), beacon: 1 });
  accentHint = { family: `eng${i + 1}`, until: performance.now() + 6000 };
  say(`Engine ${n} ${on ? "starting" : "shutting down"}`);
};
// on the ground G shows the main gear at 1x: the turntable turns to the port aft quarter and the near fairing, body
// gear doors and inboard flap fade to 20% (the 20 main wheels are hidden from every bearing behind them otherwise)
const GEAR_SHOW_BEARING = -140;
A3.actions.gear = () => {
  if (sim.state.onGround) {
    pv.gearShowTarget = pv.gearShowTarget ? 0 : 1;
    if (pv.gearShowTarget) {
      const want = F.turnOfBearing(GEAR_SHOW_BEARING);
      turnTarget = pv.turn + (((((want - pv.turn) % 360) + 540) % 360) - 180);
      omega = 0;
    }
    say(pv.gearShowTarget ? "Main gear shown: the near fairing, gear doors and inner flap faded; G again to restore" : "Gear view closed");
    return;
  }
  // fu/f4-interaction: a reader's seek or rewind owns the configuration until it arrives (as D, K and F)
  if (pv.seek && pv.seek.reader) return refuse(`Gear: wait for the ${pv.seek.kind === "back" ? "rewind" : "seek"} to arrive`);
  const down = (sim.target.gear ?? 1) > 0.5;
  setOverride("gear", down ? 0 : 1);
  say(down ? "Gear up selected" : "Gear down selected");
};
const LEVER = M.LEVER_POSITIONS ?? ["0", "1", "2", "3", "FULL"];
let lever = 0;
/**
 * The flaps lever as the model has it (follow-up review 1: the legend read the phase's target, "0 · CONF 0", for the
 * first 150 s of the climb while the aircraft flew in CONF 1+F): the configuration selected, which the crew moves to 0
 * at S speed, or the reader's own selection (M.leverSelect is the model's own rule, so a paused figure agrees too).
 */
function leverState() {
  const sel = M.leverSelect ? M.leverSelect(sim.state, sim.target) : { slat: sim.target.slat ?? sim.state.slat, flap: sim.target.flap ?? sim.state.flap };
  const conf = M.confName(sel.slat, sel.flap);
  return { pos: M.leverOfConf ? M.leverOfConf(conf) : conf === "0" ? 0 : conf === "FULL" ? 4 : conf === "2" ? 2 : conf === "3" ? 3 : 1, conf };
}
/** The lever follows the model: synced on every phase entry, seek, rewind and override clear. */
function syncLever() {
  lever = leverState().pos;
}
const leverConf = (pos) => {
  const s = sim.state;
  const name = pos === 1 ? (s.onGround || s.speed < 205 ? "1+F" : "1") : LEVER[pos];
  return M.CONTROLS.conf.find((k) => k.id === name);
};
const leverReason = (pos) => {
  const c = leverConf(pos);
  return c && c.vfe && sim.state.speed > c.vfe ? `Flaps ${LEVER[pos]} is above its limit: VFE ${c.vfe} kt` : "";
};
/**
 * F: the next detent down the gate, skipping any above its VFE; -1 at FULL or when every later detent is over its limit
 * (fu/r2-interaction, sort review: F past FULL wrapped the lever to 0 and retracted everything in one press, also in the
 * air at 168 kt). Shift+F: one back.
 */
const leverNext = () => {
  let next = lever + 1;
  while (next < LEVER.length && leverReason(next)) next++;
  return next >= LEVER.length ? -1 : next;
};
let leverDir = 1; // fu/r2-interaction: the legend button walks forward to FULL, then back one detent at a time to 0
A3.actions.flaps = (arg) => {
  syncLever();
  // fu/r2-interaction: a reader's seek owns the configuration until it arrives (as B: a lever set during a rewind from
  // FL100 carried CONF 1 onto the taxiway)
  if (pv.seek) return refuse(`Flaps: wait for the ${pv.seek.kind === "back" ? "rewind" : "seek"} to arrive`);
  // in the air the lever comes back to 0 at S speed, not below it (a clean wing under S speed is under its minimum)
  const sKt = M.PERF && M.PERF.sSpeed;
  const cleanRefused = (pos) => pos === 0 && !sim.state.onGround && sKt && sim.state.speed < sKt;
  let back = arg === "back";
  if (arg === "cycle") {
    if (leverDir > 0 && leverNext() < 0) leverDir = -1;
    else if (leverDir < 0 && (lever === 0 || cleanRefused(lever - 1))) leverDir = 1;
    back = leverDir < 0;
  }
  if (back && lever === 0) return refuse("Flaps lever at 0");
  const next = back ? lever - 1 : leverNext();
  if (next < 0) return refuse(lever >= LEVER.length - 1 ? "Flaps lever at FULL · Shift+F to retract" : `${leverReason(lever + 1)} · Shift+F to retract`);
  if (back && cleanRefused(next)) return refuse(`Flaps 0: below S speed (${sKt} kt; ${Math.round(sim.state.speed)} kt now)`);
  // fu/r2-interaction end
  const skipped = !back && next !== lever + 1 ? leverReason(lever + 1) : "";
  lever = next;
  const c = leverConf(lever);
  setOverride("slat", c.slat);
  setOverride("flap", c.flap);
  setOverride("aileronDroop", c.aileronDroop);
  if (skipped) tip(`${skipped}: lever to ${LEVER[lever]}`);
  say(`Flaps ${LEVER[lever]}: CONF ${c.id}`);
};
A3.actions.speedbrake = () => {
  // an A380 captain's account (captaindave.aero, "The A380 wing"; truth.md §8, S-secondary): on the ground spoilers 1
  // and 2 at 35° and 3-8 at 50°, the ailerons up 25°; in flight all eight spoilers work as speed brakes at 30°
  const on = (pv.spoilerTarget ?? 0) > 0;
  const ground = sim.state.onGround;
  // review round 3: B on the take-off roll carried the ground spoilers through lift-off into the climb. The roll
  // refuses them (as E is refused); a seek owns the configuration until it arrives (dropConflicts ran at its start)
  if (!on && ground && sim.phase === "TAKEOFF" && sim.state.speed > 1) return refuse("Speed brake: no ground spoilers on the take-off roll");
  if (!on && pv.seek) return refuse(`Speed brake: wait for the ${pv.seek.kind === "back" ? "rewind" : "seek"} to arrive`); // fu/f4-interaction: names a rewind
  // (spoiler1 drives spoilers 1 and 2; spoiler drives 3-8, which also roll)
  pv.spoilerTarget = on ? 0 : ground ? 50 : 30;
  pv.spoiler1Target = on ? 0 : ground ? 35 : 30;
  pv.aileronUp = on || !ground ? 0 : -25;
  pv.groundSpoilers = !on && ground;
  say(on ? "Speed brake retracted" : ground ? "Ground spoilers extended: spoilers 1 and 2 at 35°, 3 to 8 at 50°, ailerons up 25°" : "Speed brake extended, all eight spoilers at 30°");
};
let checkT = -1;
// reduced motion: the check is three stills, one per press of K (full roll, full pitch, full yaw), then off
let checkStill = -1;
const CHECK_STILLS = [
  { roll: 1, pitchCmd: 0, yaw: 0, words: "full roll: left aileron down, right aileron and spoilers up" },
  { roll: 0, pitchCmd: 1, yaw: 0, words: "full pitch: elevators up" },
  { roll: 0, pitchCmd: 0, yaw: 1, words: "full yaw: rudders right" },
];
const startCheck = () => {
  if (still.matches) {
    checkStill = checkStill + 1 >= CHECK_STILLS.length ? -1 : checkStill + 1;
    say(checkStill < 0 ? "Flight control check done" : `Flight control check, still ${checkStill + 1} of 3: ${CHECK_STILLS[checkStill].words}${checkStill < 2 ? " · K for the next" : ""}`);
    return;
  }
  checkT = 0;
  say("Flight control check: roll, pitch and yaw, full and free");
};
ARMED.check = () => {
  checkStill = -1;
  startCheck();
};
A3.actions.check = () => {
  if (pv.seek && pv.seek.reader) return refuse(`Control check: wait for the ${pv.seek.kind === "back" ? "rewind" : "seek"} to arrive`); // fu/r2-interaction
  if (!sim.state.onGround || Math.abs(sim.state.speed) > 40) {
    // in flight: rewind to the taxi, then run the check (DESIGN §1, "Arming")
    arm("TAXI", "check", null, "arming control check");
    say("Rewinding to the taxi · arming the control check");
    return;
  }
  startCheck();
};
/** The overhead panel's switch positions: the model's (phase target, crew SOP actions, the reader's settings). */
const switchesOf = () => sim.state.switches ?? sim.target.lights;
/** The nose-gear lights (taxi, take-off, runway turn-off) are dark unless the gear is down and locked. */
const noseGearDown = () => sim.state.gear.stage === "locked" && sim.state.gear.leg >= 0.999;
/**
 * Whether a light-panel switch lights anything now (sim.state.lights): the legend's pressed state and the overhead
 * inset's lamp (follow-up review 1: the inset lit STROBE and LOGO for AUTO while the strobes were dark at the gate).
 * NOSE lights the nose-strut taxi and take-off lamps and the wing-root taxi lamps (which stay on with the gear up).
 */
function litOf(sw) {
  const lit = sim.state.lights;
  if (sw === "scan" || sw === "wing") return Boolean(lit.wing);
  if (sw === "cabin") return (sim.target.cabin ?? 1) > 0.5;
  if (sw === "takeoff") return Boolean(lit.taxi || lit.taxiNose || lit.takeoff);
  return Boolean(lit[sw]) && lit[sw] !== "off";
}
/** Why a set switch is dark (or partly dark) now, for the tip line and aria-description; "" when nothing holds it. */
function heldOf(sw) {
  const SW = switchesOf();
  const lit = sim.state.lights;
  if (sw === "strobe") return SW.strobe === "auto" && !lit.strobe ? "Auto: off on the ground" : "";
  if (sw === "logo") return SW.logo === "auto" && !lit.logo ? "Auto: dark with the slats in" : "";
  if (sw === "takeoff") return (SW.taxi || SW.takeoff) && !(lit.taxiNose || lit.takeoff) ? (lit.taxi ? "nose-strut lights dark with the gear up; the wing-root taxi lights stay on" : "dark with the gear up") : "";
  if (sw === "runwayTurnoff") return SW.runwayTurnoff && !lit.runwayTurnoff ? "dark with the gear up" : "";
  return "";
}
A3.actions.light = (sw) => {
  const L = { ...(sim.overrides.lights ?? {}) };
  const SW = switchesOf();
  const cur = SW[sw];
  // a switch that cannot light anything now says why instead of claiming "on" (review round 3)
  if ((sw === "takeoff" || sw === "runwayTurnoff") && !noseGearDown()) return refuse(`${sw === "takeoff" ? "Nose lights" : "Runway turn-off lights"}: on the nose gear, dark with the gear up`);
  if (sw === "strobe") L.strobe = cur === "on" ? "off" : cur === "off" ? "auto" : "on";
  else if (sw === "takeoff") {
    // nose switch: off → taxi → T.O
    const taxi = SW.taxi ? 1 : 0;
    const to = SW.takeoff ? 1 : 0;
    const next = !taxi ? [1, 0] : !to ? [1, 1] : [0, 0];
    L.taxi = next[0];
    L.takeoff = next[1];
  } else if (sw === "scan") {
    const on = SW.wing ? 0 : 1;
    L.wing = on;
    L.engine = on;
  } else if (sw === "logo") {
    // LOGO: Auto (the model's rule: on on the ground or with the slats out) → On → Off → Auto
    const pos = cur === "auto" ? "auto" : cur ? "on" : "off";
    L.logo = pos === "auto" ? 1 : pos === "on" ? 0 : "auto";
  } else if (sw === "cabin") setOverride("cabin", (sim.target.cabin ?? 1) > 0.5 ? 0.1 : 1);
  else L[sw] = cur ? 0 : 1;
  if (sw !== "cabin") setOverride("lights", L);
  // fu/r2-interaction: paused, the model does not step, so a switch applied only at the next step did nothing visible
  // and the button stayed unpressed while the live region said "on" (sort review): the light rules run at once
  if (pv.paused && sw !== "cabin" && M.applyLights) M.applyLights(sim.state, sim.target);
  const shown = sw === "logo" ? (L.logo === "auto" ? "auto" : L.logo ? "on" : "off") : sw === "cabin" ? ((sim.target.cabin ?? 1) > 0.5 ? "on" : "dimmed") : sw === "scan" ? (L.wing ? "on" : "off") : sw === "strobe" ? (L.strobe === "auto" && sim.state.onGround ? "auto (off until airborne)" : L.strobe) : sw === "takeoff" ? (L.takeoff ? "T.O" : L.taxi ? "taxi" : "off") : L[sw] ? "on" : "off";
  say(`${{ nav: "Nav lights", logo: "Logo lights", beacon: "Beacon", strobe: "Strobes", landing: "Landing lights", takeoff: "Nose light", runwayTurnoff: "Runway turn-off lights", scan: "Wing and engine scan lights", cabin: "Cabin lights" }[sw] ?? sw} ${shown}`);
};
A3.actions.steer = (dir) => {
  // the pushback tug's cradle holds the nose wheels from its approach to its drive-off (follow.mjs centres the steer)
  if ((sim.state.tug ?? 0) > 0 && (sim.state.tug ?? 0) < 2) return refuse("Steering: the pushback tug holds the nose wheel; it steers the push");
  if (!(Math.abs(sim.state.speed) < 0.5 && sim.state.onGround)) return refuse("Steering works below 0.5 kt");
  pv.steerTarget = clamp((pv.steerTarget ?? 0) + (dir === "left" ? -10 : 10), -70, 70);
  say(`Nose wheel steered ${Math.abs(pv.steerTarget)}° ${pv.steerTarget < 0 ? "left" : pv.steerTarget > 0 ? "right" : "(centred)"}`.replace(" 0° (centred)", " to the centre"));
};
A3.actions.inspect = (id) => (id === "leave" ? leaveInspect() : inspectStep(id === "prev" ? -1 : 1, id && id !== "prev" ? id : null));

const legendButtons = [...document.querySelectorAll(".a3-legend button")];
let overhead = null; // the Cockpit view's overhead panel inset (made with the Inspect views below)
function syncLegend() {
  const s = sim.state;
  if (overhead) overhead.sync();
  const reasons = {
    gear: "",
    engines: !s.onGround ? "Engines: start and stop on the ground only" : onRoll() ? `Engines: no shutdown on the take-off roll above ${ROLL_KT} kt` : "",
    speedbrake: "",
  };
  for (const b of legendButtons) {
    const phase = b.dataset.phase;
    if (phase) b.setAttribute("aria-current", sim.phase === phase ? "step" : "false");
    const act = b.dataset.action;
    if (!act) continue;
    const state = b.querySelector(".a3-state");
    if (act === "cutaway") b.setAttribute("aria-pressed", String(pv.cabinTarget > 0.5));
    if (act === "doors") b.setAttribute("aria-pressed", String(M.DOOR_IDS.some((d) => (sim.target.doors[d] ?? 0) > 0.5)));
    if (act === "engines") b.setAttribute("aria-pressed", String(s.engineRun.some((r) => r)));
    if (act === "gear") b.setAttribute("aria-pressed", String(s.onGround ? Boolean(pv.gearShowTarget) : (sim.target.gear ?? 1) < 0.5));
    if (act === "check") b.setAttribute("aria-pressed", String(checkT >= 0 || checkStill >= 0 || pv.checking || Boolean(armed && armed.phase === "TAXI")));
    if (act === "speedbrake") b.setAttribute("aria-pressed", String((pv.spoilerTarget ?? 0) > 0));
    if (act === "pause" && b.getAttribute("aria-pressed") !== String(Boolean(pv.paused))) b.setAttribute("aria-pressed", String(Boolean(pv.paused))); // fu/f4-interaction
    if (act === "flaps") {
      reasons.flaps = ""; // the lever always has a legal next position (0); detents above VFE are skipped
      const L = leverState();
      if (state) state.textContent = `${LEVER[L.pos]} · CONF ${L.conf}`;
    }
    if (act === "inspect") {
      b.setAttribute("aria-pressed", String(Boolean(inspect)));
      if (state) state.textContent = inspect ? inspect.view.label : "";
    }
    // the Back button shows while a view is open (a touch reader has no Esc: review round 3)
    if (act === "inspect:leave" || act === "inspect:prev") b.hidden = !inspect; // fu/f4-interaction: Prev view too
    if (act in reasons) {
      b.setAttribute("aria-disabled", String(Boolean(reasons[act])));
      b.dataset.reason = reasons[act];
    }
    if (act.startsWith("light:")) {
      // pressed = the light is lit (sim.state.lights); the chip = the switch position only, in a box of fixed width
      // (follow-up review 1: "Auto · off on the ground" against "On" moved every later button 139 px, so a second
      // click on the same spot pressed the Beacon). Where a rule holds a set switch dark, the reason goes to the tip
      // line and the button's aria-description, and the chip is underlined (a3-held)
      const sw = act.slice(6);
      const SW = switchesOf();
      b.setAttribute("aria-pressed", String(litOf(sw)));
      let chip = null;
      if (sw === "strobe") chip = SW.strobe === "on" ? "On" : SW.strobe === "auto" ? "Auto" : "Off";
      else if (sw === "takeoff") chip = SW.takeoff ? "T.O" : SW.taxi ? "Taxi" : "Off";
      else if (sw === "logo") chip = SW.logo === "auto" ? "Auto" : SW.logo ? "On" : "Off";
      if (state && chip !== null && state.textContent !== chip) state.textContent = chip;
      const held = heldOf(sw);
      if ((b.dataset.held ?? "") !== held) {
        if (held) {
          b.dataset.held = held;
          b.setAttribute("aria-description", held);
        } else {
          delete b.dataset.held;
          b.removeAttribute("aria-description");
        }
        b.classList.toggle("a3-held", Boolean(held));
      }
    }
  }
}
const tipOf = (b) => (b.dataset.reason ? `${b.dataset.reason}` : `${b.dataset.tip ?? ""}${b.dataset.held ? ` · now ${b.dataset.held}` : ""}`);
for (const b of legendButtons) {
  b.addEventListener("click", () => {
    const phase = b.dataset.phase;
    if (phase) seekTo(phase);
    else if (b.dataset.action) {
      hold("legend");
      refusedNow = false;
      if (b.getAttribute("aria-disabled") === "true") refuse(tipOf(b));
      else {
        A3.action(b.dataset.action === "flaps" ? "flaps:cycle" : b.dataset.action); // fu/r2-interaction: the button walks the gate both ways
        jumpToTargets();
      }
      refusedNow = false;
    }
    syncLegend();
    wake();
  });
  b.addEventListener("pointerenter", () => tip(tipOf(b)));
  b.addEventListener("focus", () => {
    focused = true;
    tip(tipOf(b));
  });
  b.addEventListener("blur", () => (focused = false));
}

// ---------------------------------------------------------------------------------------------
// pointer: drag to turn with inertia (DESIGN §7.2); picking and click actions are I's
// ---------------------------------------------------------------------------------------------
let drag = null;
let omega = 0; // deg/s, inertia
const OMEGA_MAX = 240; // fu/r2-interaction: deg/s at release (sort review: a 330°/s flick coasted 374°)
let turnTarget = null;
stage.style.touchAction = "pan-y pinch-zoom"; // fu/f3-interaction: a pinch zooms the page, never stuck
stage.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  drag = { id: e.pointerId, start: controller.angleAt(e.clientX, e.clientY, 0, "air"), from: pv.turn, captured: false, last: performance.now(), lastTurn: pv.turn };
});
stage.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const a = controller.angleAt(e.clientX, e.clientY, 0, "air");
  const d = a - drag.start;
  if (!drag.captured && Math.abs(d) > 1.5) {
    drag.captured = true;
    stage.setPointerCapture(e.pointerId);
    hold("drag");
    endTransit(); // the reader turns: the zoom eases to the view from where it is
  }
  if (drag.captured) {
    turnTarget = drag.from + d;
    const now = performance.now();
    const dt = Math.max(1e-3, (now - drag.last) / 1000);
    // fu/f3-interaction: the flick's speed is smoothed over time (τ 50 ms), not per event: 0.3 a move was 0.3 per 16 ms on
    // a 60 Hz pointer and the same share per 4 ms on a 240 Hz pen or touch screen (a flick's coast depended on the rate)
    const share = 1 - Math.exp(-dt / 0.05);
    omega += share * ((turnTarget - drag.lastTurn) / dt - omega);
    drag.last = now;
    drag.lastTurn = turnTarget;
    wake();
  }
});
const endDrag = (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  // fu/f3-interaction: a cancel (the browser took the gesture: a pinch, a vertical page scroll) never flicks
  if (drag.captured && !still.matches && e.type !== "pointercancel" && performance.now() - drag.last < 80) {
    turnTarget = null;
    omega = clamp(omega, -OMEGA_MAX, OMEGA_MAX); // fu/r2-interaction: a flick coasts at most about 290° (τ 1.2 s)
  } else omega = 0;
  if (!drag.captured) {
    omega = 0;
    // a click (or a tap) that did not turn the stage more than 1.5°: name the part, and run its action on a click
    // with a fine pointer or on a second tap of the same part with a coarse one
    if (e.type === "pointerup") {
      const name = pickAt(e.clientX, e.clientY);
      const coarse = e.pointerType === "touch";
      const again = picked && picked.name === name && performance.now() - picked.at < 4000;
      if (name) {
        // fu/r2-interaction: a tap that names a part is input: the tour holds at once, so the second tap lands on the
        // same part (sort review: on touch the turntable kept turning and the second tap named another part)
        hold("pick");
        // fu/f4-interaction: the name first, then the action, so the action's own line (its confirmation or the reason it
        // was refused) is the last write to the live region and the tip line; the readout's label follows the part's
        // state every tick, so it reads "starting" or "opening" once the target moves (review: the name overwrote both)
        pointerPick = true;
        showLabel(name);
        if (!coarse || again) {
          const spokeAt = saidAt;
          // an action that spoke ("Engine 4 starting") puts its line on the tip line too, over the name's stale state
          if (runPicked(name) && saidAt !== spokeAt) tip(saidText, 6000); // (a refusal tipped it already: the same text)
        }
        if (coarse) {
          clearTimeout(labelTimer);
          labelTimer = setTimeout(() => showLabel(null), 2500);
        }
      } else showLabel(null);
    }
  }
  drag = null;
  wake();
};
stage.addEventListener("pointerup", endDrag);
stage.addEventListener("pointercancel", endDrag);

// ---------------------------------------------------------------------------------------------
// keyboard (DESIGN §7.3)
// ---------------------------------------------------------------------------------------------
const KEYS = { d: "doors", c: "cutaway", f: "flaps", k: "check", g: "gear", e: "engines", b: "speedbrake", s: "light:scan", i: "inspect" };
// the shortcuts work wherever focus is inside the figure (the stage or a legend button, which keeps focus after a
// click); Space and Enter on a focused button keep their native meaning
const figureEl = stage.closest("figure") ?? plate;
function onFigureKey(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key;
  if (e.target !== stage && e.target.closest && e.target.closest("button") && (key === " " || key === "Enter")) return;
  // a held key's auto-repeat: turning and steering keep it, every toggle and phase key fires once per press (follow-up
  // review 1: holding D for a second opened and closed the doors seven times, holding 7 restarted its seek five times)
  if (e.repeat && !(key === "ArrowLeft" || key === "ArrowRight" || key === "[" || key === "]")) {
    if (/^[1-7 ]$/.test(key) || key === "Home" || key === "Escape" || KEYS[key.toLowerCase()]) e.preventDefault();
    return;
  }
  let used = true;
  if (key === "ArrowLeft" || key === "ArrowRight") {
    hold("key");
    const step = (e.shiftKey ? 15 : 3) * (key === "ArrowLeft" ? -1 : 1);
    endTransit(); // a turn key during a view change: the zoom eases to the view from where it is
    turnTarget = (turnTarget ?? pv.turn) + step;
    omega = 0;
  } else if (key === "Home") {
    turnTarget = F.turnOfBearing(F.tourBearing(pv.tourT));
    omega = 0;
  } else if (/^[1-7]$/.test(key)) seekTo(F.PHASE_ORDER[Number(key) - 1]);
  else if (key === " ") A3.actions.pause(); // fu/f4-interaction: the same code as the legend's Pause button
  else if (key === "[" || key === "]") {
    hold("key");
    sayDefer = e.repeat; // fu/r2-interaction: a held key's lines wait for its keyup (one line, the angle it reached)
    A3.action("steer", key === "[" ? "left" : "right");
    sayDefer = false;
  }
  else if (key === "Escape") {
    if (inspect) leaveInspect();
    else if (pv.mode !== "tour" && !still.matches) resumeTourClean();
  } else if (key.toLowerCase() === "i") {
    hold("key");
    A3.action("inspect", e.shiftKey ? "prev" : undefined);
  } else if (key.toLowerCase() === "f" && e.shiftKey) {
    hold("key");
    refusedNow = false;
    A3.action("flaps:back");
    jumpToTargets();
    refusedNow = false;
  } else if (KEYS[key.toLowerCase()]) {
    hold("key");
    refusedNow = false;
    A3.action(KEYS[key.toLowerCase()]);
    jumpToTargets();
    refusedNow = false;
  } else used = false;
  if (used) {
    e.preventDefault();
    syncLegend();
    wake();
  }
}
figureEl.addEventListener("keydown", onFigureKey);

// fu/r2-interaction: a held key's last line, once it is released
const onFigureKeyUp = () => {
  if (sayHeld === null) return;
  const text = sayHeld;
  sayHeld = null;
  say(text);
};
figureEl.addEventListener("keyup", onFigureKeyUp);
// fu/f4-interaction: on a page with one figure, the keys on the buttons' chips also work before focus has entered it
// (review: just after load focus is on the body, and C or 7 did nothing). Only keys aimed at the page itself (the body
// or the root, never an input, a link or another widget), only while the figure is on screen, and not Home (the page's
// own scroll-to-top). A page with more than one figure keeps the figure-scoped listener alone; a host page can turn
// this off with <html data-a3-keys="figure">
const pageKeys = () => document.querySelectorAll(".a3-stage").length === 1 && document.documentElement.dataset.a3Keys !== "figure";
const aimedAtPage = (e) => (e.target === document.body || e.target === document.documentElement) && e.key !== "Home";
const figureOnScreen = () => {
  const r = figureEl.getBoundingClientRect();
  return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
};
document.addEventListener("keydown", (e) => {
  if (aimedAtPage(e) && pageKeys() && figureOnScreen()) onFigureKey(e);
});
document.addEventListener("keyup", (e) => {
  if (aimedAtPage(e) && pageKeys()) onFigureKeyUp();
});
// fu/f4-interaction end
// fu/r2-interaction end

// ---------------------------------------------------------------------------------------------
// the deck: scroll, set mix and fades every frame (DESIGN §7.5). The marking sets' per-set scroll, mix and
// opacity are M1's (gl/runway.js, from the "deck" hook); this writes the shared page values.
// ---------------------------------------------------------------------------------------------
let lastDistance = 0;
function deck(dt) {
  const s = sim.state;
  const d = s.groundDistance - lastDistance;
  lastDistance = s.groundDistance;
  settle(env.seekFade, pv.seek ? 0 : 1, dt, 0.25, still.matches);
  pv.seekFade = env.seekFade.x;
  pv.scroll = (s.groundDistance * 10) % 500; // kit units (1 dm), one 50 m pattern repeat
  pv.speedFade = 1 - smooth(500 / 6, 500 / 2, Math.abs(d * 10));
  A3.emit("deck", { dt, scroll: pv.scroll, speedFade: pv.speedFade, seekFade: pv.seekFade, height: s.height, distance: s.groundDistance });
}

// ---------------------------------------------------------------------------------------------
// lights (envelopes, anchors, visibility) for the GL harness and the fallbacks
// ---------------------------------------------------------------------------------------------
const lightState = {};
A3.lights = lightState;
// M8's "lights" pass reads point visibility from the GPU order-index mask, so the CPU walk is not needed then
let maskLightsMemo = null;
// fu/lights: the programs arrive over several frames (parallel compile): decide once they have (nothing reads the
// CPU visibility while GL is pending: the fallbacks carry no visibility term)
const maskLights = () => (A3GL.info && A3GL.info.pending ? true : (maskLightsMemo ??= Boolean(A3GL.ok && A3GL.layers.air && A3GL.layers.air.some((e) => e.id === "lights"))));
// fu/lights end
let clock = 0;
function lights(dt, moved) {
  const s = sim.state;
  const V = controller.cams().world.V;
  for (const L of DATA.gl.lights) {
    const st = (lightState[L.id] ??= { level: { x: 0, v: 0 }, energy: 0, anchor: null, vis: 1 });
    const on = L.switch ? (s.lights[L.switch] ? 1 : 0) : 1;
    settle(st.level, on, dt, L.settle, still.matches);
    // reduced motion: a flashing light burns steady at reduced energy (the beacon and strobes stay readable)
    const flash = L.flash ? (still.matches ? 0.6 : flashTrain(clock, L.flash)) : 1;
    if (moved || !st.anchor) {
      st.anchor = controller.anchor(L.group, L.at, L.normal);
      st.facing = smooth(-0.12, 0.22, st.anchor.direction ? st.anchor.direction[0] * V[0] + st.anchor.direction[1] * V[1] + st.anchor.direction[2] * V[2] : 1);
      st.vis = maskLights() ? 1 : pointVisibility(controller, L.part, st.anchor.screen, { soft: 0.6 });
    }
    st.flash = flash;
    st.energy = st.level.x * flash * st.facing * st.vis;
    alpha[`a3-l-${L.id}`] = st.level.x * flash * (1 - pv.glShare);
  }
}

// ---------------------------------------------------------------------------------------------
// picking: hover (fine pointers) or tap (coarse) names the topmost airframe part; click runs its action
// (DESIGN §7.2). The pick tests the controller's projected hulls in reverse paint order.
// ---------------------------------------------------------------------------------------------
const LABELS = DATA.labels.slice().sort((a, b) => b.prefix.length - a.prefix.length); // the longest prefix wins
const labelOf = (name) => LABELS.find((L) => name.startsWith(L.prefix)) ?? null;
const textOf = (L) => {
  try {
    return typeof L.text === "function" ? String(L.text(sim.state, pv)) : String(L.text);
  } catch (error) {
    return L.prefix.replace(/\.$/, "");
  }
};
const deckSvg = stage.querySelector('svg[data-live="deck"]');
const toView = (clientX, clientY) => {
  const box = deckSvg.getBoundingClientRect();
  const vb = deckSvg.viewBox.baseVal;
  const x = vb.x + ((clientX - box.left) / box.width) * vb.width;
  const y = vb.y + ((clientY - box.top) / box.height) * vb.height;
  return controller.viewMap ? controller.viewMap(x, y) : [x, y]; // fu/r2-perf: through the zoom wrappers (applyView) fu/r2-perf end
};
// the vary classes that fade whole parts (the Inspect and gear-view fades, DATA.fades; the cockpit's a3-fd), per run
// index, built once: a part faded under half its alpha is not picked, so the pick falls through to what the view
// was built to show (review round 3: the 15% crown named itself over the whole flight deck and a click on the deck
// ran its cutaway action)
let fadeOfRun = null;
function fadeClassesOf(i) {
  if (!fadeOfRun) {
    fadeOfRun = new Map();
    const runs = controller.scene().runs;
    const sets = Object.entries(DATA.fades ?? {}).map(([cls, list]) => [cls, list.map((src) => new RegExp(src))]);
    for (const run of runs) {
      const list = sets.filter(([, res]) => res.some((re) => re.test(run.name))).map(([cls]) => cls);
      if (run.name.startsWith("cockpit.")) list.push("a3-fd");
      if (list.length) fadeOfRun.set(run.index, list);
    }
  }
  return fadeOfRun.get(i) ?? null;
}
/** True while a run's fade class holds it under half its alpha: it is neither picked nor outlined. */
function runFaded(i) {
  // fu/interiors: the Deck plan view ghosts the whole airframe to 5% (parts/cabin-plan.mjs): nothing of it is picked
  if ((pv.deckPlan ?? 0) > 0.5) return true;
  // fu/interiors end
  const list = fadeClassesOf(i);
  return Boolean(list && list.some((cls) => (alpha[cls] ?? 1) < 0.5));
}
function pickAt(clientX, clientY) {
  const [x, y] = toView(clientX, clientY);
  // fu/r1-interiors: while the Deck plan shows, its seat blocks, monuments and doors are picked (parts/cabin-plan.mjs)
  if ((pv.deckPlan ?? 0) > 0.5 && A3.pickPlan) return A3.pickPlan(x, y);
  // fu/r1-interiors end
  const order = controller.orderIndex("airframe");
  if (!order) return null;
  const frames = controller.frames();
  const runs = controller.scene().runs;
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    const f = frames[i];
    const n = f && f.hullN;
    if (!n || n < 3) continue;
    const name = runs[i].name;
    if (runFaded(i)) continue;
    const h = f.hull;
    let sign = 0;
    let inside = true;
    for (let j = 0; j < n && inside; j++) {
      const ax = h[2 * j];
      const ay = h[2 * j + 1];
      const bx = h[2 * ((j + 1) % n)];
      const by = h[2 * ((j + 1) % n) + 1];
      const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
      if (Math.abs(c) < 1e-9) continue;
      if (!sign) sign = Math.sign(c);
      else if (Math.sign(c) !== sign) inside = false;
    }
    if (inside && labelOf(name)) return name;
  }
  return null;
}
let picked = null; // { name, label, at (ms) }
let labelTimer = 0;
let hoverEl = null;
// the readout corner holds a short form (the part and its state, at most 40 characters); the full label goes to the
// tip line under the legend and to the live region (a 126-character label ran off a phone's plate)
const LABEL_MAX = 40;
const STATEFUL = /\d|°|%|\b(open|closed|opening|closing|on|off|running|starting|idle|stopped|down|up|extended|retracted|locked|moving|lit|dark|parked|deployed|stowed|releasing|connecting|pushing|driving|clear)\b/i;
function shortLabel(text) {
  const segs = String(text).split(" · ");
  let out = segs[0].length > LABEL_MAX ? `${segs[0].slice(0, LABEL_MAX - 1).trimEnd()}…` : segs[0];
  for (const seg of segs.slice(1)) if (STATEFUL.test(seg) && out.length + 3 + seg.length <= LABEL_MAX) out += ` · ${seg}`;
  return out;
}
// the canvas page's selection: the picked part's projected hull stroked in the lit accent on an overlay (the SVG page
// outlines the part itself, .a3-hover)
const SVGNS = "http://www.w3.org/2000/svg";
let hoverPath = null;
// fu/r2-interaction: the outline is masked by the parts painted after the hovered one (their projected hulls): solid
// where the part shows, a faint dashed line where it is covered (the kit's hidden-edge convention). Sort review: the
// tail cone's outline ran across the near tailplane and the fin root, the brightest line in the picture
let hoverHidden = null;
let hoverOcc = null; // the occluders' path, in both masks
if (DATA.painter === "canvas") {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("class", "iso-layer a3-hover-layer");
  svg.setAttribute("viewBox", deckSvg.getAttribute("viewBox"));
  svg.setAttribute("aria-hidden", "true");
  const vb = deckSvg.viewBox.baseVal;
  const uid = `a3h${Math.random().toString(36).slice(2, 8)}`;
  const big = `x="${vb.x - vb.width}" y="${vb.y - vb.height}" width="${3 * vb.width}" height="${3 * vb.height}"`;
  svg.innerHTML = `<defs><mask id="${uid}v" maskUnits="userSpaceOnUse" ${big}><rect ${big} fill="#fff"/><path class="a3-hover-occ" fill="#000"/></mask><mask id="${uid}o" maskUnits="userSpaceOnUse" ${big}><path class="a3-hover-occ" fill="#fff"/></mask></defs>`;
  hoverPath = document.createElementNS(SVGNS, "path");
  hoverPath.setAttribute("class", "a3-hover-hull");
  hoverPath.setAttribute("mask", `url(#${uid}v)`);
  hoverHidden = document.createElementNS(SVGNS, "path");
  hoverHidden.setAttribute("class", "a3-hover-hidden");
  hoverHidden.setAttribute("mask", `url(#${uid}o)`);
  svg.appendChild(hoverHidden);
  svg.appendChild(hoverPath);
  hoverOcc = [...svg.querySelectorAll(".a3-hover-occ")];
  stage.appendChild(svg);
}
let runOfName = null;
/** A projected hull as a path, wound one way (so a union of hulls fills with the nonzero rule). fu/r2-interaction */
function hullPath(f) {
  const h = f.hull;
  const n = f.hullN;
  let area = 0;
  for (let j = 0; j < n; j++) area += h[2 * j] * h[2 * ((j + 1) % n) + 1] - h[2 * ((j + 1) % n)] * h[2 * j + 1];
  let d = "";
  for (let k = 0; k < n; k++) {
    const j = area >= 0 ? k : n - 1 - k;
    d += `${k ? "L" : "M"}${h[2 * j].toFixed(2)} ${h[2 * j + 1].toFixed(2)}`;
  }
  return `${d}Z`;
}
/** A point inside a convex projected hull (either winding). fu/r2-interaction */
function inHull(h, n, x, y) {
  let sign = 0;
  for (let j = 0; j < n; j++) {
    const ax = h[2 * j], ay = h[2 * j + 1], bx = h[2 * ((j + 1) % n)], by = h[2 * ((j + 1) % n) + 1];
    const c = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (Math.abs(c) < 1e-9) continue;
    if (!sign) sign = Math.sign(c);
    else if (Math.sign(c) !== sign) return false;
  }
  return true;
}
// fu/f4-interaction: the outline covers the whole named part: every run its label names (review: "Engine 4" outlined the
// inlet lip and part of the fan cowl only, not the aft cowl, core and plug). Each run's projected hull is convex, so
// the named part's outline is the convex hull of its runs' hulls; the runs of each label, found once
let runsOfLabel = null;
function labelRuns(L) {
  if (!runsOfLabel) {
    runsOfLabel = new Map();
    for (const r of controller.scene().runs) {
      const M2 = labelOf(r.name);
      if (!M2) continue;
      if (!runsOfLabel.has(M2)) runsOfLabel.set(M2, []);
      runsOfLabel.get(M2).push(r.index);
    }
  }
  return runsOfLabel.get(L) ?? [];
}
/** The convex hull of a flat [x0, y0, x1, y1, …] point list (monotone chain), as a flat list, counter-clockwise. */
function convexHull(pts) {
  const n = pts.length / 2;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => pts[2 * a] - pts[2 * b] || pts[2 * a + 1] - pts[2 * b + 1]);
  const cross = (o, a, b) => (pts[2 * a] - pts[2 * o]) * (pts[2 * b + 1] - pts[2 * o + 1]) - (pts[2 * a + 1] - pts[2 * o + 1]) * (pts[2 * b] - pts[2 * o]);
  const lower = [];
  for (const i of idx) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop();
    lower.push(i);
  }
  const upper = [];
  for (let k = idx.length - 1; k >= 0; k--) {
    const i = idx[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop();
    upper.push(i);
  }
  const out = [];
  for (const i of lower.slice(0, -1).concat(upper.slice(0, -1))) out.push(pts[2 * i], pts[2 * i + 1]);
  return out;
}
const hullBox = (h, n) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let j = 0; j < n; j++) {
    x0 = Math.min(x0, h[2 * j]); x1 = Math.max(x1, h[2 * j]);
    y0 = Math.min(y0, h[2 * j + 1]); y1 = Math.max(y1, h[2 * j + 1]);
  }
  return [x0, y0, x1, y1];
};
const boxesMeet = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
let orderPos = null; // run index -> its place in the airframe's paint order
function drawHover() {
  if (!hoverPath) return;
  const name = picked && pv.label ? picked.name : null;
  let d = "";
  let occ = "";
  if (name) {
    if (!runOfName) runOfName = new Map(controller.scene().runs.map((r) => [r.name, r.index]));
    const i = runOfName.get(name);
    const frames = controller.frames();
    const order = controller.orderIndex("airframe");
    if (order) {
      // rebuilt each call: the order may be re-sorted in place as the stage turns
      if (!orderPos || orderPos.length !== frames.length) orderPos = new Int32Array(frames.length);
      orderPos.fill(-1);
      for (let k = 0; k < order.length; k++) orderPos[order[k]] = k;
    }
    // the named part's runs: the picked run and its label's others, each unfaded and drawn
    const members = [];
    for (const m of picked.L ? labelRuns(picked.L) : [i]) {
      const g = frames[m];
      if (g && g.hullN >= 3 && !runFaded(m)) members.push(m);
    }
    if (!members.includes(i) && frames[i] && frames[i].hullN >= 3 && !runFaded(i)) members.push(i);
    if (members.length) {
      const pts = [];
      for (const m of members) {
        const g = frames[m];
        for (let j = 0; j < 2 * g.hullN; j++) pts.push(g.hull[j]);
      }
      const h = members.length === 1 ? frames[members[0]].hull : convexHull(pts);
      const n = members.length === 1 ? frames[members[0]].hullN : h.length / 2;
      d = hullPath({ hull: h, hullN: n });
      // every unfaded part painted after one of the named runs whose box it overlaps, and not wholly inside the outline
      // (windows on a fuselage section), masks the outline: dashed where it covers it
      const box = hullBox(h, n);
      const own = new Set(members);
      const mBoxes = members.map((m) => [orderPos && orderPos[m] >= 0 ? orderPos[m] : Infinity, hullBox(frames[m].hull, frames[m].hullN)]);
      const first = Math.min(...mBoxes.map((b) => b[0]));
      if (order && Number.isFinite(first)) {
        for (let k = first + 1; k < order.length; k++) {
          if (own.has(order[k])) continue;
          const g = frames[order[k]];
          if (!g || !(g.hullN >= 3) || runFaded(order[k])) continue;
          const gb = hullBox(g.hull, g.hullN);
          if (!boxesMeet(gb, box)) continue;
          if (!mBoxes.some(([at, mb]) => at < k && boxesMeet(gb, mb))) continue;
          if (inHull(h, n, gb[0], gb[1]) && inHull(h, n, gb[2], gb[1]) && inHull(h, n, gb[0], gb[3]) && inHull(h, n, gb[2], gb[3])) continue;
          occ += hullPath(g);
        }
      }
    }
  }
  if (hoverPath.getAttribute("d") !== d) {
    hoverPath.setAttribute("d", d);
    hoverHidden.setAttribute("d", d);
  }
  if (hoverOcc[0].getAttribute("d") !== occ) for (const el of hoverOcc) el.setAttribute("d", occ);
  // merge r2: the outline's width is not divided by the zoom here. The SVG layers zoom through a wrapper <g>'s SVG
  // transform (fu/r2-perf, applyView), which keeps non-scaling strokes at their CSS width, so the sort review's
  // 20 px outline is already 1.25 px in the views; dividing as well would leave it 1.25/z px
}
const plateEl = stage.closest(".iso-plate");
const showLabel = (name) => {
  const L = name ? labelOf(name) : null;
  // the label clears 1.5 s after the pointer leaves the part; a re-pick every frame (the stage moving under a still
  // pointer) must not restart that wait (follow-up review 1: the tug's label outlived the faded tug for good)
  if (!L && picked && picked.leaving) return;
  clearTimeout(labelTimer);
  if (hoverEl) hoverEl.classList.remove("a3-hover");
  hoverEl = null;
  if (!L) {
    if (picked) picked.leaving = true;
    if (picked) labelTimer = setTimeout(() => {
      picked = null;
      pv.label = null;
      pv.labelFull = null;
      if (plateEl) plateEl.classList.remove("a3-labelled");
      drawHover();
      writeReadout();
    }, 1500);
    return;
  }
  picked = { name, L, at: performance.now() };
  pv.labelFull = textOf(L);
  pv.label = shortLabel(pv.labelFull);
  if (plateEl) plateEl.classList.add("a3-labelled");
  tip(pv.labelFull, 6000);
  if (pointerPick) say(pv.labelFull); // fu/r2-interaction: a real pointer pick only
  pointerPick = false;
  if (DATA.painter !== "canvas") {
    hoverEl = stage.querySelector(`svg[data-live="airframe"] [data-name="${CSS.escape(name)}"]`);
    if (hoverEl) hoverEl.classList.add("a3-hover");
  }
  drawHover();
  writeReadout();
};
let pickQueued = null;
let hoverAt = null; // the fine pointer's last position over the stage: re-picked while the stage moves under it
stage.addEventListener("pointermove", (e) => {
  if (drag && drag.captured) return;
  if (e.pointerType !== "mouse" && e.pointerType !== "pen") return;
  hoverAt = { x: e.clientX, y: e.clientY };
  if (pickQueued) return;
  pickQueued = requestAnimationFrame(() => {
    pickQueued = null;
    if (!hoverAt) return;
    const name = pickAt(hoverAt.x, hoverAt.y);
    // hovering a part is input: the tour holds (motion.md, "Idle tour"), and resumes 30 s after the last input
    if (name) {
      hold("hover");
      wake();
    }
    if (name !== (picked && !picked.leaving ? picked.name : null)) {
      pointerPick = true; // fu/r2-interaction: a real move speaks the name
      showLabel(name);
    }
  });
});
stage.addEventListener("pointerleave", () => {
  hoverAt = null;
  showLabel(null);
});
const runPicked = (name) => {
  const L = labelOf(name);
  if (!L || !L.action) return false;
  if (!runOfName) runOfName = new Map(controller.scene().runs.map((r) => [r.name, r.index]));
  if (runFaded(runOfName.get(name))) return false; // a part faded out (an Inspect view) never runs its action
  hold("pick");
  refusedNow = false;
  A3.action(L.action);
  jumpToTargets();
  refusedNow = false;
  syncLegend();
  wake();
  return true;
};

// ---------------------------------------------------------------------------------------------
// the phase accent (DESIGN §7.7): one family carries the lit edge at a time, settled 0.4 s
// ---------------------------------------------------------------------------------------------
const FAMILIES = Object.keys(DATA.varyFns).filter((c) => c.startsWith("a3-acc-")).map((c) => c.slice(7));
const INSPECT_FAMILY = { cockpit: "cabin", first: "cabin", upper: "cabin", main: "cabin", engine2: "eng2", "wing-gear": "gear", "body-gear": "gear", "door-M2L": "doors", tail: "surfaces", "deck-plan": "cabin" };
let accentHint = null;
let lastAccentState = null;
function accents(dt, calm) {
  const s = sim.state;
  const p = lastAccentState ?? s;
  const moving = (k) => Math.abs((s[k] ?? 0) - (p[k] ?? 0)) > 1e-5;
  const gearMoving = Math.abs(s.gear.leg - p.gear.leg) > 1e-6 || Math.abs((s.gear.body ?? s.gear.leg) - (p.gear.body ?? p.gear.leg)) > 1e-6 || Math.abs(s.gear.doors - p.gear.doors) > 1e-6; // merge: gear.body too (gear request R13)
  const want = new Set();
  if (inspect) want.add(INSPECT_FAMILY[inspect.view.id] ?? "");
  else if (accentHint && performance.now() < accentHint.until) want.add(accentHint.family);
  else if (pv.checking || checkT >= 0) want.add("surfaces");
  else if (pv.cabinTarget > 0.5 || pv.cabin > 0.5) want.add("cabin");
  else if (sim.phase === "GATE") want.add("doors");
  else if (sim.phase === "PUSHBACK") {
    const starting = [0, 1, 2, 3].filter((i) => s.engineRun[i] && s.n1[i] < M.ENGINES.n1.groundIdle - 0.5);
    if (starting.length) for (const i of starting) want.add(`eng${i + 1}`);
    else if (F.doorsMoving(s, sim.target) || !s.engineRun.some((r) => r)) want.add("doors");
  } else if (sim.phase === "TAXI") {
    if (moving("slat")) want.add("slats");
    else if (moving("flap")) want.add("flaps");
  } else if (sim.phase === "TAKEOFF" && s.onGround) for (let i = 1; i <= 4; i++) want.add(`eng${i}`);
  else if (sim.phase === "CLIMB") {
    if (gearMoving) want.add("gear");
    else if (moving("flap")) want.add("flaps");
    else if (moving("slat")) want.add("slats");
  }
  for (const f of FAMILIES) {
    const st = (env.accent[f] ??= { x: 0, v: 0 });
    settle(st, want.has(f) ? 1 : 0, dt, 0.4, calm);
    pv.accent[f] = clamp(st.x, 0, 1);
  }
  lastAccentState = s;
}

// ---------------------------------------------------------------------------------------------
// Inspect (DESIGN §7.4): one view applier for the canvas painter's zoom, the SVG layers' viewBox and the GL
// canvases' view (kit patch 10), eased with settle 0.6 s; the turntable eases to the view's bearing
// ---------------------------------------------------------------------------------------------
const VIEW_ORDER = ["cockpit", "first", "upper", "main", "engine2", "wing-gear", "body-gear", "door-M2L", "tail", "deck-plan"];
const VIEWS = (DATA.inspect ?? []).slice().sort((a, b) => (VIEW_ORDER.indexOf(a.id) + 99) % 99 - ((VIEW_ORDER.indexOf(b.id) + 99) % 99));
let inspect = null;
let inspectCabin = 0;
let transit = null; // a view change in progress: { from, to, t, turn0, turn1, zFrom, zMid, dOut, dTurn, dIn, c0 }
const smootherStep = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * t * (t * (6 * t - 15) + 10);
};
/** The screen centre of a view's anchor at the current pose (null when it is off the projection). */
function viewCentre(v) {
  // a free group's synced pose is pitch's, so the centre is anchored on pitch when it is parked
  const group = v.group === "cockpit" || v.group === "cabin" ? "pitch" : v.group;
  const k = v.kit ?? [10 * (41.3 - v.centre[0]), 10 * v.centre[1], 10 * v.centre[2]];
  const a = controller.anchor(group, k);
  return a && a.screen ? a.screen : null;
}
const FADING_VIEWS = new Set(["cockpit", "wing-gear", "body-gear", "deck-plan"]);
/** Stop a view change where it is (the reader turns): the new view named, the zoom eased by the spring from here. */
function endTransit() {
  if (transit && !transit.named) nameView(transit.to);
  transit = null;
}
/** The view the page values name (the Inspect fades, the Deck plan's ghost, the stage attribute). */
function nameView(v) {
  pv.inspect = v ? v.id : null;
  if (v) stage.setAttribute("data-inspect", v.id);
  else stage.removeAttribute("data-inspect");
}
/** The transit's turn (called where the tick sets the turn): out, then the turn, then in; it ends on the view. */
function transitTurn(dt) {
  const T = transit;
  T.t += dt;
  if (!T.named && T.t >= T.dOut) {
    T.named = true;
    nameView(T.to);
  }
  const u = clamp((T.t - T.dOut) / Math.max(1e-6, T.dTurn), 0, 1);
  pv.turn = T.turn0 + (T.turn1 - T.turn0) * smootherStep(u);
  if (T.t >= T.dOut + T.dTurn + T.dIn) {
    pv.turn = T.turn1;
    transit = null;
  }
}
/** The transit's zoom and centre now: [zoom, cx, cy]. */
function transitView(T) {
  const lerp = (a, b, x) => a + (b - a) * x;
  const from = T.from ? viewCentre(T.from) ?? T.c0 : T.c0;
  const to = viewCentre(T.to) ?? from;
  if (T.t < T.dOut) {
    // from where the window is (a change during a change) onto the old view's anchor, zooming out
    const x = smootherStep(T.t / T.dOut);
    return [Math.exp(lerp(Math.log(T.zFrom), Math.log(T.zMid), x)), lerp(T.c0[0], from[0], x), lerp(T.c0[1], from[1], x)];
  }
  if (T.t < T.dOut + T.dTurn) {
    const x = smootherStep((T.t - T.dOut) / T.dTurn);
    return [T.zMid, lerp(from[0], to[0], x), lerp(from[1], to[1], x)];
  }
  const x = T.dIn > 0 ? smootherStep((T.t - T.dOut - T.dTurn) / T.dIn) : 1;
  return [Math.exp(lerp(Math.log(T.zMid), Math.log(T.to.zoom), x)), to[0], to[1]];
}
const VB = (() => {
  const vb = deckSvg.viewBox.baseVal;
  return { w: vb.width, h: vb.height };
})();
env.cx.x = VB.w / 2;
env.cy.x = VB.h / 2 + (DATA.verify ? 0 : 38); // COMPOSE: the figure starts on the ground
const zoomSvgs = [...stage.querySelectorAll("svg.iso-layer")];
// fu/r2-perf: on the canvas page each SVG layer zooms through one wrapper <g> and its SVG transform (sort finding: a CSS
// transform on the <svg> scaled the non-scaling strokes by the zoom, deck lines 3-6x heavy and the hover outline 20 px
// in the views; an SVG transform keeps them 1 px as the viewBox did, without the viewBox's relayout every frame)
const zoomWraps = DATA.painter === "canvas" ? zoomSvgs.map((svg) => { const g = document.createElementNS(SVGNS, "g"); g.setAttribute("class", "a3-zoom"); while (svg.firstChild) g.appendChild(svg.firstChild); svg.appendChild(g); return g; }) : null;
// the wrappers' map inverted for the pointer (toView, the kit's angleAt): a viewBox point u to X + (u - W/2) / z
const zoomMap = { z: 1, X: VB.w / 2, Y: VB.h / 2 };
if (zoomWraps) controller.viewMap = (x, y) => [zoomMap.X + (x - VB.w / 2) / zoomMap.z, zoomMap.Y + (y - VB.h / 2) / zoomMap.z];
// fu/r2-perf end
let lastView = "";
function inspectStep(dir, id) {
  if (!VIEWS.length) return tip("No inspect views in this build");
  hold("inspect");
  const i = id ? VIEWS.findIndex((v) => v.id === id) : inspect ? inspect.index + dir : dir > 0 ? 0 : VIEWS.length - 1;
  if (i < 0 || i >= VIEWS.length) return leaveInspect();
  const v = VIEWS[i];
  const from = inspect ? inspect.view : null;
  // the reader's cutaway, restored on leave. fu/r2-interaction (sort review): not the tour's (pv.cabinTarget at the gate
  // is the tour's while it shows its cutaway): Inspect takes the cutaway over, a view with cutaway 0 closes it, and
  // leaving restores the reader's own choice
  if (!inspect) {
    inspectCabin = tourCut ? readerCabin : pv.cabinTarget;
    tourCut = false;
  }
  inspect = { view: v, index: i };
  readoutView = { label: v.label, index: i, count: VIEWS.length }; // fu/f4-interaction
  const want = F.turnOfBearing(v.bearing);
  const toTurn = pv.turn + (((((want - pv.turn) % 360) + 540) % 360) - 180);
  omega = 0;
  // follow-up review 1: the turn eased in 0.12 s while the zoom took 0.6 s and more, so Cockpit → First swept about 106°
  // across empty platter, a flap and a nacelle at 20×. A view change now goes through a zoomed-out midpoint: out to at
  // most 2×, then the turn, then in to the new view (reduced motion jumps)
  if (!still.matches && (Math.abs(toTurn - pv.turn) > 3 || from)) {
    turnTarget = null;
    const zFrom = Math.max(1, env.zoom.x);
    // a view that fades parts (by zoom, build.mjs INSPECT_FADE; the Deck plan's ghost) hands over at 1× so nothing
    // pops; the others at 2×. The old view stays named (its fades held) until the zoom-out ends
    const fades = (x) => x && FADING_VIEWS.has(x.id);
    const zMid = fades(from) || fades(v) ? 1 : Math.min(zFrom, v.zoom, 2);
    transit = { from, to: v, t: 0, turn0: pv.turn, turn1: toTurn, zFrom, zMid: Math.min(zFrom, zMid), c0: [env.cx.x, env.cy.x], named: false };
    transit.dOut = transit.zFrom > transit.zMid * 1.01 ? 0.25 + 0.22 * Math.log(transit.zFrom / transit.zMid) : 0;
    transit.dTurn = Math.abs(toTurn - pv.turn) > 0.5 ? 0.3 + 0.0045 * Math.abs(toTurn - pv.turn) : 0;
    transit.dIn = v.zoom > transit.zMid * 1.01 ? 0.25 + 0.22 * Math.log(v.zoom / transit.zMid) : 0;
  } else {
    transit = null;
    turnTarget = toTurn;
  }
  if (!transit || !from) nameView(v);
  pv.cabinTarget = v.cutaway ? 1 : 0; // fu/r2-interaction: a view declared cutaway 0 closes it (C still toggles it in the view)
  const touch = compact || matchMedia("(pointer: coarse)").matches;
  tip(touch ? `Inspect · ${v.label} · tap Inspect for the next view, Prev view for the last one, Back to leave` : `Inspect · ${v.label} · I for the next view, Shift+I for the previous, Esc to return`, 6000);
  say(`Inspect: ${v.label}`);
  syncLegend();
}
function leaveInspect() {
  if (!inspect) return;
  inspect = null;
  readoutView = null; // fu/f4-interaction
  transit = null;
  nameView(null);
  pv.cabinTarget = inspectCabin;
  tip("");
  say("Inspect closed");
  syncLegend();
}
A3.inspect = { step: inspectStep, leave: leaveInspect, views: VIEWS };
Object.assign(A3.inspect, { step: (dir, id) => (inspectStep(dir, id), wake()), leave: () => (leaveInspect(), wake()) }); // fu/verify: an API call (eval, a tool) wakes a sleeping loop (P16) // fu/verify end
// fu/r1-verify: a tool turns through the page (turn-check --perf): A3.tick(turn) sets pv.turn and runs one page tick
// now, as a drag's frame does (one set() a frame, every free group with it); the page's own pending frame is cancelled
// so no frame ticks twice. A3.tick() with no turn wakes a sleeping loop
A3.tick = (turn) => {
  if (typeof turn !== "number") return wake();
  pv.turn = turn;
  turnTarget = null;
  omega = 0;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  tick(performance.now());
};
// fu/r1-verify end
{
  const b = document.querySelector('.a3-legend button[data-action="inspect"]');
  if (b && VIEWS.length) b.dataset.tip = `Look closely: ${VIEWS.map((v) => v.label).join(", ")} (I next, Shift+I previous, Esc back)`;
}
// the overhead panel inset (review round 3): the A380's overhead panel is in the ceiling, its face down, where the
// figure's 17.5-42.5° view never looks; the Cockpit view shows its layout as a framed inset instead of a slab on posts.
// Its EXT LT row follows the light panel's switches.
const EXT_LT = [["strobe", "STROBE"], ["beacon", "BCN"], ["wing", "WING"], ["nav", "NAV"], ["logo", "LOGO"], ["runwayTurnoff", "RWY"], ["landing", "LAND"], ["takeoff", "NOSE"]]; // fu/r2-interaction: the panel's short names, drawn under the lamps
overhead = (() => {
  const box = document.createElement("div");
  box.className = "a3-oh";
  box.hidden = true;
  box.setAttribute("aria-hidden", "true");
  const r = (x, y, w, h, cls) => `<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx=".8"/>`;
  let svg = r(0.5, 0.5, 99, 67, "a3-oh-f"); // fu/r2-interaction: 68 tall (the EXT LT lamps' names under them)
  // rows aft (bottom) to forward (top): EXT LT; ANTI ICE and ENG START; FUEL and HYD; ELEC and AIR; CALLS and OXY
  svg += r(3, 3, 94, 6, "a3-oh-p") + Array.from({ length: 14 }, (_, i) => r(5 + i * 6.5, 4.6, 3, 2.8, "a3-oh-s")).join("");
  svg += r(3, 11, 45, 13, "a3-oh-p") + r(52, 11, 45, 13, "a3-oh-p") + Array.from({ length: 6 }, (_, i) => r(6 + i * 7, 16, 4, 3, "a3-oh-s") + r(55 + i * 7, 16, 4, 3, "a3-oh-s")).join("");
  svg += `<text x="5" y="14.6">ELEC</text><text x="54" y="14.6">AIR COND</text>`;
  svg += r(3, 26, 45, 13, "a3-oh-p") + r(52, 26, 45, 13, "a3-oh-p") + Array.from({ length: 5 }, (_, i) => r(7 + i * 8, 32, 4, 3, "a3-oh-s") + r(56 + i * 8, 32, 4, 3, "a3-oh-s")).join("");
  svg += `<text x="5" y="29.6">FUEL</text><text x="54" y="29.6">HYD</text>`;
  // fu/r2-interiors: the row's box from y 40 (was 41, 8 tall), so its label sits 3.6 under the box top and 1.4 over the
  // switches as in the other rows (review: the box's top border struck the label, its glyphs touched the switches)
  // merge r2: fu/r2-interaction re-spaced the same row (40.3, 9.4); the interiors spacing is kept, interaction's EXT LT
  // names and its taller panel stay
  svg += r(3, 40, 94, 9.6, "a3-oh-p") + Array.from({ length: 12 }, (_, i) => r(6 + i * 7.6, 45, 4, 3, "a3-oh-s")).join("") + `<text x="5" y="43.6">ANTI ICE · ENG START</text>`;
  // fu/r2-interiors end
  svg += r(3, 51, 94, 15, "a3-oh-p") + `<text x="5" y="54.4">EXT LT</text>`;
  svg += EXT_LT.map(([id, name], i) => `${r(6 + i * 11.5, 56, 4.5, 4, "a3-oh-s")}<circle class="a3-oh-lamp" data-sw="${id}" cx="${(8.25 + i * 11.5).toFixed(2)}" cy="58" r="1.1"/><text class="a3-oh-n" x="${(8.25 + i * 11.5).toFixed(2)}" y="63.6" text-anchor="middle">${name}</text>`).join("");
  box.innerHTML = `<p class="a3-oh-t">Overhead panel · in the ceiling above the pilots</p><svg viewBox="0 0 100 68" aria-hidden="true">${svg}</svg>`;
  stage.appendChild(box);
  const lamps = [...box.querySelectorAll(".a3-oh-lamp")];
  let shownAlpha = 1;
  return {
    // fu/f4-interaction: the inset comes in with the Cockpit view's zoom-in (the transit's last stage), not at its start
    // over the zoomed-out turntable (review, d11-sheet-cockpit); it goes at once when the view is left (sync)
    fade() {
      if (box.hidden) return;
      const T = transit;
      const a = T && T.to && T.to.id === "cockpit" ? (T.t < T.dOut + T.dTurn ? 0 : T.dIn > 0 ? smootherStep((T.t - T.dOut - T.dTurn) / T.dIn) : 1) : 1;
      if (Math.abs(a - shownAlpha) < 0.01 && (a === 1) === (shownAlpha === 1)) return;
      shownAlpha = a;
      box.style.opacity = a >= 1 ? "" : a.toFixed(3);
    },
    sync() {
      const show = Boolean(inspect && inspect.view.id === "cockpit");
      if (box.hidden === show) box.hidden = !show;
      if (!show) return;
      this.fade(); // fu/f4-interaction: hidden until the zoom-in when it opens in a transit
      // each lamp lit with what its switch lights now, as the legend's pressed state (follow-up review 1)
      for (const el of lamps) {
        const on = litOf(el.dataset.sw);
        el.classList.toggle("a3-oh-on", on);
        el.classList.toggle("a3-oh-s", !on);
      }
    },
  };
})();
// composition (review round 3): the fit reserves headroom for the climb's highest reachable pose (the fin at the nose-on
// bearings, lifted 6 m); on the ground that left 110-220 px of empty card over the aircraft and a 35 px margin under the
// plinth. The window eases down by up to COMPOSE px while the aircraft is on the ground (the figure rises in the card)
// and back as it lifts, so the margins balance in every phase and nothing leaves the frame
// (not on the SVG verify page, whose tools read the stage in the fit's own viewBox)
const COMPOSE = DATA.verify ? 0 : 38; // follow-up item 67: 38 balances the fin (gate, t000) and plinth clearances at 1440 (30 left them 16 px apart)
// follow-up review 1: one fixed lift left up to 157 px of empty card over the aircraft against 75 px under the plinth at
// some bearings, and none in the air (the plinth then sat 22-37 px off the frame). The window now follows the figure's
// projected top for the current pose and bearing: the room over the airframe and under the plinth balance, the plinth
// keeps at least COMPOSE_FOOT CSS px off the frame, and nothing of the airframe leaves the card
const COMPOSE_FOOT = 40; // CSS px under the plinth, at least
const COMPOSE_HEAD = 10; // CSS px over the airframe, at least (the footroom gives way first only if both cannot hold)
const COMPOSE_MAX = 140; // viewBox units: the window's largest lift
let plinthBottom = null; // viewBox y of the plinth's lowest point (the back layer: platter, rim and plinth), measured once
let figureTop = null; // viewBox y of the airframe's highest point at the current pose (when the pose changes)
function measureFigureTop() {
  const order = controller.orderIndex("airframe");
  if (!order) return;
  const frames = controller.frames();
  let top = Infinity;
  for (const i of order) {
    const f = frames[i];
    if (!f || !(f.hullN >= 3)) continue;
    const y = f.box[1];
    if (y < -VB.h || f.box[3] > 2 * VB.h) continue; // a parked group (the tug at the stand)
    if (y < top) top = y;
  }
  if (top < Infinity) figureTop = top;
}
function composeOffset() {
  if (DATA.verify) return 0;
  if (plinthBottom === null) {
    try {
      const b = stage.querySelector("svg.a3-back").getBBox();
      plinthBottom = b.y + b.height;
    } catch (error) {
      plinthBottom = VB.h - 35;
    }
  }
  if (figureTop === null) return A3.ch ? COMPOSE * (1 - smooth(0, 30, A3.ch.lift || 0)) : COMPOSE;
  stageWidth ??= stage.getBoundingClientRect().width;
  const unit = VB.w / Math.max(1, stageWidth); // viewBox units per CSS px
  let off = (figureTop + plinthBottom - VB.h) / 2; // equal room over and under
  off = Math.max(off, plinthBottom - VB.h + COMPOSE_FOOT * unit);
  off = Math.min(off, figureTop - COMPOSE_HEAD * unit);
  return clamp(off, 0, COMPOSE_MAX);
}
const STAGE_OVERSCALE = 1.15; // fu/f4-interaction: a380.css's narrow-layout stage width (115%)
function applyView(dt, calm) {
  let zoom = 1;
  let cx = VB.w / 2;
  let cy = VB.h / 2 + composeOffset();
  if (inspect) {
    const v = inspect.view;
    zoom = v.zoom;
    const c = viewCentre(v);
    if (c) [cx, cy] = c;
  }
  if (transit && inspect) {
    // the view change's own path (inspectStep): no spring, so nothing lags the turn
    const [z, x, y] = transitView(transit);
    env.zoom.x = z;
    env.cx.x = x;
    env.cy.x = y;
    env.zoom.v = env.cx.v = env.cy.v = 0;
  } else {
    settle(env.zoom, zoom, dt, 0.6, calm);
    settle(env.cx, cx, dt, 0.6, calm);
    settle(env.cy, cy, dt, 0.6, calm);
    // f4-perf: the view spring's tail snaps home within 0.1 CSS px (and a zoom within 2e-4 of itself): the spring's own
    // 1e-4-unit snap left a turned or paused figure's composition creeping 1-2 CSS px a second for 5-10 s after it
    // looked still, the canvas repainting every tick and never at rest (its full ratio and lines), review f3
    const tol = (0.1 * VB.w) / Math.max(1, stageWidth ?? VB.w) / Math.max(1, env.zoom.x);
    for (const [st, goal, near] of [[env.cx, cx, tol], [env.cy, cy, tol], [env.zoom, zoom, 2e-4 * zoom]]) {
      if (st.x !== goal && Math.abs(goal - st.x) < near && Math.abs(st.v) < 4 * near) {
        st.x = goal;
        st.v = 0;
        viewSnapped = true; // the rest test does not count the snap's step as movement
      }
    } // f4-perf end
  }
  if (overhead) overhead.fade(); // fu/f4-interaction
  // fu/f4-interaction: the narrow layout draws the stage at 115% under the card's clip (a380.css) to crop the plinth's
  // margin; zoomed into a view that crop fell on the subject (review: the Cockpit's side windshield frames ran off the
  // plate). The window zooms 1.15x less there, so a view shows what it shows on a wide card. pv.zoom (the views' fades)
  // keeps the view's own zoom. Continuous: 1x until the zoom passes 1.15
  const z = Math.max(1, compact ? env.zoom.x / STAGE_OVERSCALE : env.zoom.x);
  pv.zoom = Math.max(1, env.zoom.x);
  // keep the zoomed window inside the plate (no empty margin beyond the viewBox edges)
  const hw = VB.w / (2 * z);
  const hh = VB.h / (2 * z);
  const X = clamp(env.cx.x, hw, VB.w - hw);
  const Y = clamp(env.cy.x, hh, VB.h - hh + COMPOSE_MAX);
  const key = `${z.toFixed(4)}|${X.toFixed(2)}|${Y.toFixed(2)}|${canvas && canvas.fit ? canvas.fit : ""}`; // fu/perf: the fit too (the SVG layers' transform) fu/perf end
  viewNow[0] = z; // f4-perf
  viewNow[1] = X;
  viewNow[2] = Y; // f4-perf end
  if (key === lastView) return;
  lastView = key;
  const box = [X - hw, Y - hh, 2 * hw, 2 * hh];
  // zoomed, the SVG layers would draw past the stage into the card's corners: clip the stage while zoomed
  stage.classList.toggle("a3-zoomed", z > 1.0005 || Math.abs(Y - VB.h / 2) > 0.01);
  // fu/perf: on the canvas page the SVG layers zoom by one CSS transform, not a viewBox write (a viewBox relaid out the
  // deck's 1,875 elements every turning frame of a view: 11-15 ms on a phone); the painter's setView neither paints
  // (the tick does, once) nor forces a layout (review r1)
  if (canvas && canvas.setView) {
    // fu/r2-perf: the viewBox's map (a user point p to W/2 + z (p - X)) as the wrappers' SVG transform; the layers clip
    // to their own viewport as with the viewBox
    const t = `translate(${(VB.w / 2).toFixed(3)} ${(VB.h / 2).toFixed(3)}) scale(${z.toFixed(4)}) translate(${(-X).toFixed(3)} ${(-Y).toFixed(3)})`;
    for (const g of zoomWraps) g.setAttribute("transform", t);
    zoomMap.z = z;
    zoomMap.X = X;
    zoomMap.Y = Y; // fu/r2-perf end
    canvas.setView(z, X, Y);
  } else // fu/perf end
  for (const svg of zoomSvgs) svg.setAttribute("viewBox", box.map((v) => v.toFixed(3)).join(" "));
  if (canvas && canvas.zoom && !canvas.setView) canvas.zoom(z, X, Y); // fu/perf: !setView fu/perf end
  if (A3GL.setView) A3GL.setView(z, X, Y);
  airMoved = true;
}

// ---------------------------------------------------------------------------------------------
// the loop (DESIGN §7.9)
// ---------------------------------------------------------------------------------------------
let frame = 0;
let last = 0;
let visible = false;
let quietFrames = 0;
let lastShown = "";
let painted = false;
let lastPaintView = null;
let lastBearingT = 0;
let lastFadeKey = ""; // which fade classes hold their parts under half (picking): a change re-picks under the pointer
let modelChanged = true;
function wake() {
  if (!frame && visible) frame = requestAnimationFrame(tick);
}
function tick(now) {
  frame = 0;
  // dt is clamped for stability only (a tab returning from the background), not to 1/30 s: below 30 fps the figure
  // kept its timeline only at 30 fps and ran in slow motion. The model substeps at ≤ 1/30 model-s anyway (§7.1)
  const dtRaw = last ? Math.max(0, (now - last) / 1000) : 1 / 60;
  const dt = Math.min(dtRaw, 0.25);
  const slowed = dtRaw > 0 ? dt / dtRaw : 1; // < 1 only when the clamp bit: the effective rate shown
  // a seek's or rewind's clock: the loop's running time, slow frames counted whole (a seek promises its phase in about
  // 3 s at any frame rate, and at 1-4 fps the 0.25 s clamp stretched that to 12 s); a stall counts at most one second
  // (a sleeping loop restarts its clock on waking, see the end of tick)
  const dtSeek = Math.min(dtRaw, 1);
  last = now;
  const calm = still.matches;
  // 2. tour, input targets
  if (pv.mode === "tour" && !calm && !pv.seek) {
    pv.tourT = Math.min(pv.tourT + dt, F.LOOP - 1e-3);
    const want = F.turnOfBearing(F.tourBearing(pv.tourT));
    // keep the unwrapped turn continuous; after a hold the tour eases back to its bearing (≤ 30°/s, no jump)
    const diff = ((((want - pv.turn) % 360) + 540) % 360) - 180;
    if (pv.catchUp) {
      const step = Math.sign(diff) * Math.min(Math.abs(diff) * (1 - Math.exp(-dt / 0.7)), 30 * dt);
      pv.turn += step;
      if (Math.abs(diff) < 0.25) pv.catchUp = false;
    } else pv.turn += diff;
    turnTarget = null;
    omega = 0;
    pv.cabinTarget = F.tourCutaway(pv.tourT);
    tourCut = pv.cabinTarget > 0.5;
  } else if (transit) {
    transitTurn(dt);
    turnTarget = null;
    omega = 0;
  } else if (turnTarget !== null) {
    const k = calm ? 1 : 1 - Math.exp(-dt / 0.12);
    pv.turn += (turnTarget - pv.turn) * k;
    if (Math.abs(turnTarget - pv.turn) < 0.01) {
      pv.turn = turnTarget;
      if (!drag) turnTarget = null;
    }
  } else if (Math.abs(omega) > 0.5 && !calm) {
    pv.turn += omega * dt;
    omega *= Math.exp(-dt / 1.2);
  } else omega = 0;
  // 3. the model in fixed substeps
  const before = sim.phase;
  if (pv.seek && pv.paused) {
    // Space froze the seek or rewind where it is (follow-up review 1: both ran on to their phase while paused)
    pv.rate = 0;
    pv.rateShown = 0;
  } else if (pv.seek && pv.seek.kind === "back") {
    pv.seek.dt = dtSeek;
    rewindHistory(now);
  } else if (pv.seek && pv.seek.kind === "forward") {
    // rate = remaining model seconds / the rest of the 3 s budget, from wall time (DESIGN §7.1): any later phase is
    // reached in about 3 s at any frame rate
    if (sim.phase === "GATE") F.enterPhase(M, sim, "PUSHBACK");
    // the seek's clock counts only the time the loop ran (a page scrolled away or a hidden tab stops the loop, and
    // wall time across that sleep made the seek race at its top rate)
    pv.seek.elapsed = (pv.seek.elapsed ?? 0) + dtSeek;
    const elapsed = pv.seek.elapsed;
    // (budgeted at 2.5 s so a slow frame or two still lands inside the 3 s promise). The estimate comes from the
    // departure's timeline; a state that needs more model time than it says (flaps set by the reader, which retract
    // only at S speed) never lets the rate fall below the first frame's, and past the budget it climbs
    const estimate = clamp(modelSecondsTo(pv.seek.phase) / Math.max(0.2, 2.5 - elapsed), 4, 8000);
    pv.seek.rate0 ??= estimate;
    const rate = clamp(Math.max(estimate, pv.seek.rate0 * (elapsed > 2.5 ? Math.min(4, 1 + 3 * (elapsed - 2.5)) : 1)), 4, 8000);
    pv.rate = rate;
    pv.rateShown = rate * (slowed < 0.95 ? Math.round(slowed * 10) / 10 : 1);
    const from = sim.phase;
    if (sim.phase !== pv.seek.phase) {
      // the path in slices of at most SEEK_STEP model seconds, recorded every SEEK_RECORD s or sooner where the picture
      // moves (the take-off's last 35 ft lift the drawing 6 m in 3 s). Follow-up review 1: paced by the picture too: a
      // frame shows at most SEEK_PICTURE_PER_S·dt of picture change (lift, pitch, gear, surfaces, doors, the tug), with
      // the slices halved where it moves fast, so the lift-off and the gear take several frames (one frame carried
      // 5.8 m of lift and the whole gear); the model time this costs is made up where the picture is quiet
      const cap = SEEK_PICTURE_PER_S * dtSeek;
      const start = sim.state;
      let step = pv.seek.step ?? SEEK_STEP;
      let left = dtSeek * rate;
      while (left > 1e-9 && sim.phase !== pv.seek.phase) {
        const before = sim.state;
        const h = Math.min(left, step);
        F.advance(M, sim, h / rate, { rate, stopAt: pv.seek.phase });
        left -= h;
        const moved = pictureStep(before, sim.state);
        if (moved > cap / 4 && step > F.SUBSTEP * 1.01) step = Math.max(F.SUBSTEP, step / 2);
        else if (moved < cap / 16) step = Math.min(SEEK_STEP, step * 2);
        const last = seekRecorded;
        if (!last || sim.state.clock - last.clock >= SEEK_RECORD - 1e-6 || visualStep(sim.state, last) - 0.05 >= 0.25 || sim.phase !== last.phase) {
          recordHistory();
          seekRecorded = sim.state;
        }
        if (pictureStep(start, sim.state) >= cap) break;
      }
      pv.seek.step = step;
    }
    // a guard, never the plan: a phase whose goals have not arrived well past the budget is entered by force (never
    // past the seek's own phase)
    const here = F.PHASE_ORDER.indexOf(sim.phase);
    const goal = F.PHASE_ORDER.indexOf(pv.seek.phase);
    if (sim.phase === from && here < goal && elapsed > 6 + 2 * here) {
      const next = F.PHASE_ORDER[here + 1];
      console.warn(`a380: seek forced ${sim.phase} → ${next} after ${elapsed.toFixed(1)} s (phaseDone never arrived)`);
      F.enterPhase(M, sim, next);
    }
    if (F.PHASE_ORDER.indexOf(sim.phase) >= goal) seekArrived(pv.seek);
  } else if (!pv.paused && !calm) {
    // (reduced motion: inputs jump to their end state synchronously; the model does not run between them)
    // the display rate eases across a forward phase change inside the driver (M1 request R4), so the page plays the
    // trajectory and tour timing the build sampled; after a seek or a rewind it starts at the phase's own rate
    F.advance(M, sim, dt, { auto: pv.mode === "tour" });
    pv.rate = sim.rateX ?? 1;
    // the effective rate while it eases (follow-up review 1: the tag vanished at the FL100 hold while the rate was
    // still easing from ×30 to ×1)
    pv.rateShown = (sim.rateX ?? F.rateOf(sim.phase, sim.state, sim.target)) * (slowed < 0.95 ? Math.round(slowed * 10) / 10 : 1);
    // HOLD holds: a done airborne phase is pinned at its end state instead of climbing on
    if (pv.mode === "hold" && sim.done && !sim.state.onGround) levelOff();
    pinPath();
    // the tour loops: after the FL100 hold, rewind to the gate
    if (pv.mode === "tour" && sim.phase === "FL100" && sim.done && sim.held >= F.FL100_HOLD) {
      const gate = history.findIndex((h) => h.phase === "GATE");
      pv.seek = { phase: "GATE", kind: "back", target: Math.max(0, gate), toGate: gate < 0, from: now };
    }
  } else {
    pv.rate = 0;
    pv.rateShown = 0;
  }
  if (sim.phase !== before) {
    A3.emit("phase", { from: before, to: sim.phase });
    pv.steerTarget = 0;
    if (!pv.seek && pv.mode === "tour") syncLever();
    else if (!pv.seek) syncLever();
    doneSaid = null;
    syncLegend();
  }
  // the light panel follows the lights and switches the model moves (the crew's SOP actions, the gear's gate): the
  // legend re-syncs when any of them changes, not only on input (review round 3)
  {
    const L = sim.state.lights;
    const SW = sim.state.switches ?? {};
    let key = `${sim.state.gear.stage}${sim.state.flapLever}${sim.state.flapSel}`; // the flaps lever too (S speed)
    for (const k in L) key += L[k];
    for (const k in SW) key += SW[k];
    if (key !== lightKey) {
      lightKey = key;
      syncLegend();
    }
  }
  // the pushback tug's two moments on the live region (it picks up the nose wheel; it releases it and drives off)
  {
    const word = M.tugWords(sim.state);
    const key = word === "tug pushing" ? "tug connected" : word === "tug driving off" ? "tug releasing" : word;
    if (key !== tugSaid) {
      if (!pv.seek && key === "tug connected" && tugSaid === "tug connecting") say("The pushback tug has picked up the nose wheel");
      else if (!pv.seek && key === "tug releasing" && tugSaid === "tug connected") say("The pushback tug releases the nose wheel and drives off");
      tugSaid = key;
    }
  }
  // a reader's hold: the 30 s idle timer runs from the moment the chosen phase settles (DESIGN §7.6), so every phase
  // completes, says its line and holds 30 s at any frame rate
  if (pv.mode === "hold" && idleArmed) {
    const settled = heldSettled();
    if (settled && !wasSettled) {
      clearTimeout(idleTimer);
      idleTimer = armIdle(IDLE_MS);
    }
    wasSettled = settled;
  }
  // the live region: a phase line with the true state when the phase completes (also after a seek arrives)
  if (!pv.seek && sim.done && doneSaid !== sim.phase) {
    doneSaid = sim.phase;
    say(phaseLine(sim.phase));
  }
  if (!pv.seek && armed && sim.phase === armed.phase) {
    const run = armed;
    armed = null;
    run.then();
    jumpToTargets(); // reduced motion: the armed action's end state too (doors open, the check's first still)
    syncLegend();
  }
  historyClock += dt;
  // (a forward seek records its own path, in the seek branch above; a rewind records nothing)
  if (historyClock >= HISTORY_EVERY && !pv.seek) {
    historyClock = 0;
    recordHistory();
  }
  // the ground spoilers retract when the aircraft leaves the ground (in flight B gives the 30° speed brake only)
  if (pv.groundSpoilers && !sim.state.onGround) {
    pv.groundSpoilers = false;
    pv.spoilerTarget = 0;
    pv.spoiler1Target = 0;
    pv.aileronUp = 0;
    say("Ground spoilers retracted: airborne");
    syncLegend();
  }
  // a tour-opened cutaway closes once the reader's figure leaves the stand (a seek away from it, or the model moving on)
  if (tourCut && pv.mode !== "tour" && (sim.phase !== "GATE" || (pv.seek && pv.seek.phase !== "GATE"))) {
    tourCut = false;
    if (inspect) inspectCabin = readerCabin;
    else pv.cabinTarget = readerCabin;
    syncLegend();
  }
  // page values eased
  settle(env.cabin, pv.cabinTarget, dt, 2.5, calm);
  // fu/perf: the cutaway snaps home with under 0.004 of its travel left: the crowns' remaining travel is 500·d² kit units
  // (both ends ease), under 0.01 units, a tenth of a device pixel at 6x zoom; the 1e-4 snap kept the page at 30 fps for
  // 15 s after the cut looked still (review r1)
  if (Math.abs(env.cabin.x - pv.cabinTarget) < 4e-3 && Math.abs(env.cabin.v) < 4e-3) {
    env.cabin.x = pv.cabinTarget;
    env.cabin.v = 0;
  } // fu/perf end
  pv.cabin = clamp(env.cabin.x, 0, 1);
  pv.spoiler += ((pv.spoilerTarget ?? 0) - pv.spoiler) * (calm ? 1 : 1 - Math.exp(-dt / 0.4));
  pv.spoiler1 += ((pv.spoiler1Target ?? 0) - pv.spoiler1) * (calm ? 1 : 1 - Math.exp(-dt / 0.4));
  pv.aileron = (pv.aileron ?? 0) + ((pv.aileronUp ?? 0) - (pv.aileron ?? 0)) * (calm ? 1 : 1 - Math.exp(-dt / 0.4));
  // the nose wheel holds the commanded angle until the next [ or ], a phase change or the aircraft moving (follow-up
  // review 1: it sprang back to the centre about 2 s after each press, which neither the README nor the tip said)
  pv.steer += ((pv.steerTarget ?? 0) - pv.steer) * (calm ? 1 : 1 - Math.exp(-dt / 0.3));
  // the steering only works below 0.5 kt on the ground (DESIGN §7.3): any other state centres it
  if (!(sim.state.onGround && Math.abs(sim.state.speed) < 0.5)) pv.steerTarget = 0;
  if (checkStill >= 0 && !(sim.state.onGround && Math.abs(sim.state.speed) <= 40)) checkStill = -1;
  const check = pv.mode === "tour" && sim.phase === "TAXI" ? F.controlCheckAt(pv.tourT) : checkT >= 0 ? F.controlCheckAt(F.CHECK_AT + checkT) : checkStill >= 0 ? CHECK_STILLS[checkStill] : null;
  if (checkT >= 0) checkT = checkT + dt > 6 ? -1 : checkT + dt;
  pv.roll = check ? check.roll : 0;
  pv.pitchCmd = check ? check.pitchCmd : 0;
  pv.yaw = check ? check.yaw : 0;
  pv.checking = Boolean(check && (check.roll || check.pitchCmd || check.yaw));
  // the 1x gear view (G on the ground) closes once airborne or in an Inspect view
  if (pv.gearShowTarget && (!sim.state.onGround || inspect)) pv.gearShowTarget = 0;
  settle(env.gearShow, pv.gearShowTarget ? 1 : 0, dt, 0.5, calm);
  pv.gearShow = clamp(env.gearShow.x, 0, 1);
  engineSequence();
  settle(env.glShare, A3GL.ok ? 1 : 0, dt, 0.4, calm);
  pv.glShare = env.glShare.x;
  pv.first = pv.glShare;
  // 4. channels, 5. follow and set (adaptive half rate above 14 ms)
  const ch = F.channelsOf(sim.state, pv);
  A3.ch = ch;
  A3.state = sim.state;
  const values = follow(ch);
  // fu/f4-interiors (f3-engine E1): an Inspect view's own camera elevation (the Cockpit view looks down at 42°, so the
  // captain's PFD clears the headrest), eased in over the last part of the view's zoom (the stage's statics, drawn at the
  // page's 30°, are out of frame by then) and out the same way; exactly the page's elevation outside it, sent once
  // (the runtime then draws at P itself) and then dropped
  {
    const ev = inspect && typeof inspect.view.elevation === "number" ? inspect.view : null;
    const e = ev ? BASE_ELEVATION + (ev.elevation - BASE_ELEVATION) * smooth(0.7 * ev.zoom, 0.95 * ev.zoom, pv.zoom || 1) : BASE_ELEVATION;
    if (e !== BASE_ELEVATION || (lastValues && lastValues.$elevation !== undefined && lastValues.$elevation !== BASE_ELEVATION)) values.$elevation = e;
    pv.elevation = e;
  } // fu/f4-interiors end
  const omegaNow = inspect ? 0 : Math.abs(omega) + (pv.mode === "tour" ? 30 : 0);
  settle(env.detail, Math.min(1 - smooth(120, 240, omegaNow), restTicks >= 6 ? 1 : GOV_LEVELS[GOV.level].detail), dt, 0.25, calm); // f3-perf: the governor's line level while moving f3-perf end
  // half rate never skips an input's frame: under reduced motion there is one tick per input, so a skipped set()
  // left the airframe (and the GL anchors) on the previous pose; a tool turn sets at once too
  if (inspect || calm || toolTurn) half = false;
  // fu/perf: a free group's pose ({R, t}) is compared by value: follow() builds a new one every frame, and by identity a
  // settled cutaway re-set, repainted and redrew GL every frame and the page never slept (review r1)
  const samePose = (a, b) => a === b || (Boolean(a) && Boolean(b) && Boolean(a.R) && Boolean(b.R) && a.R.every((x, i) => Math.abs(x - b.R[i]) <= 1e-9) && a.t.every((x, i) => Math.abs(x - b.t[i]) <= 1e-9));
  const changed = env.detail.x !== lastDetail || !lastValues || Object.keys(values).some((key) => (typeof values[key] === "number" ? Math.abs(values[key] - lastValues[key]) > 1e-6 : !samePose(values[key], lastValues[key]))); // fu/perf end
  frameIndex++;
  let setRan = false;
  if (changed && (!half || frameIndex % 2 === 0)) {
    setRan = true;
    own = true;
    const t0 = performance.now();
    controller.set(values, { detail: env.detail.x });
    lastDetail = env.detail.x; // f3-perf f3-perf end
    lastSetMs = performance.now() - t0;
    if (!inspect) measureFigureTop(); // the composition follows the pose (applyView)
    own = false;
    ema = ema ? 0.9 * ema + 0.1 * lastSetMs : lastSetMs;
    // half rate (DESIGN §5.11 lever 1, review round 3): from a 10 ms set() (the turn measured 12.9 ms on a desktop GPU
    // and stayed at full rate under the old 14 ms threshold); back to full rate under 6 ms
    if (ema > 10) half = true;
    else if (ema < 6) half = false;
    lastValues = values;
    toolTurn = false;
    mounted = true;
    describe();
  }
  // f3-perf: half rate under load: a frame whose set() half rate skipped (the airframe holds its pose) moves nothing
  // else of the picture either: the view (the composition follows the pose) eases on the next frame with both frames'
  // time, and the airframe canvas is not repainted for a view or vary-alpha change alone (it was: 48 ms of a 56 ms
  // skipped frame on the throttled phone repainted the held pose half a pixel lower); those repaint on the next frame.
  // The canvas, the SVG layers and GL keep one view; GL's own effects (lights, exhaust) and the deck run every frame
  const skipped = changed && half && !setRan;
  viewDt += dt;
  // f3-perf end
  // Inspect: the view follows its centre each frame
  if (!skipped) { // f3-perf
    applyView(viewDt, calm);
    viewDt = 0; // f3-perf
  } // f3-perf
  // 6. deck every frame
  deck(dt);
  // 7. lights and GL
  clock += pv.paused ? 0 : dt;
  lights(dt, airMoved);
  // the fade classes (Inspect views, the 1x gear view) before the GL frame: the ID mask leaves faded parts out, and a
  // mask built with the previous tick's alphas let the faded crown cover the cockpit displays for a tick (reduced
  // motion's one tick per input showed them black)
  for (const cls of FADE_CLASSES) alpha[cls] = clamp(VARY[cls](ch, pv, sim.state) || 0, 0, 1);
  const fx = { controller, clock, dt, calm, moved: airMoved, state: sim.state, ch, pv, share: pv.glShare, first: pv.first, lights: lightState, data: DATA.gl, canvasWidth: stage.querySelector('[data-canvas="air"]')?.width ?? 0 };
  A3.emit("frame", fx);
  // fu/f4-interiors (f3-engine E1, kit/gl.mjs glCameraAt): the GL layers project with the camera the runtime drew, so at an
  // Inspect view's own elevation their lights and displays land on the parts (in place: every layer holds this object)
  if (DATA.gl && DATA.gl.camera && DATA.gl.camera.cam) {
    const w = controller.cams().world;
    if (w && w.se !== undefined && (DATA.gl.camera.cam[2] !== w.se || DATA.gl.camera.cam[3] !== w.ce)) {
      DATA.gl.camera.cam[2] = w.se;
      DATA.gl.camera.cam[3] = w.ce;
    }
  } // fu/f4-interiors end
  A3GL.frame(fx);
  airMoved = false;
  // the cabin dimmer on the interior (review round 3): the cavity tokens read --a3-cabin-mix; the canvas painter re-bakes
  // the cabin and flight-deck parts when it has moved by 1/12 (about 80 ms each) (and only while they are shown)
  let restyled = false;
  {
    const mix = Math.round(Math.pow(clamp(pv.cabinLight ?? 1, 0, 1), 0.66) * 12) / 12;
    if (mix !== cabinMixCss) {
      cabinMixCss = mix;
      stage.style.setProperty("--a3-cabin-mix", String(mix));
      // the darkening share: up to 50% in dark, 35% by daylight (a plain percentage: the canvas painter parses it)
      stage.style.setProperty("--a3-cab-p", `${Math.round((1 - mix) * (LIGHT ? 35 : 50))}%`);
    }
    // fu/perf: the painter tints the cabin faces at paint time (kit patch 24, PLAN item 42), no 80 ms re-bake
    if (canvas && canvas.tint && cabinMixCanvas !== mix) {
      cabinMixCanvas = mix;
      restyled = canvas.tint(CABIN_RUN, getComputedStyle(stage).getPropertyValue("--a3-cab-dim").trim(), Math.round((1 - mix) * (LIGHT ? 35 : 50)) / 100);
    } else // fu/perf end
    if (canvas && canvas.restyle && pv.cabin > 0 && cabinMixCanvas !== mix) {
      cabinMixCanvas = mix;
      canvas.restyle(CABIN_RUN); // fu/r2-interiors: the cabin only fu/r2-interiors end
      restyled = true;
    }
  }
  // 8. vary alphas (the accent first), then paint
  accents(dt, calm);
  for (const [cls, fn] of Object.entries(VARY)) {
    if (cls.startsWith("a3-l-")) continue;
    alpha[cls] = clamp(fn(ch, pv, sim.state) || 0, 0, 1);
  }
  let alphaChanged = false;
  for (const cls of Object.keys(VARY)) {
    const a = Math.round(alpha[cls] * 1000) / 1000;
    if (lastAlpha[cls] === a) continue;
    lastAlpha[cls] = a;
    alphaChanged = true;
    for (const el of varyEls[cls] ?? []) el.style.opacity = String(a);
    // merge r2: a fallback light pool (paint only, no pick) at alpha 0 leaves the render, as gl/runway.js does for the
    // runway lights: under GL (and by day) its 330 band paths were laid out every turned frame at opacity 0 (fu/r2-lights
    // doubled the bands: layout +0.4 ms a frame at 1440, +1.7 ms on the throttled phone)
    if (POOL_VARY.test(cls)) for (const el of varyEls[cls] ?? []) el.style.display = a > 0 ? "" : "none";
  }
  // the airframe canvas repaints only when the controller set a new pose, a vary alpha moved or the view changed
  const viewMoved = lastView !== lastPaintView;
  // fu/perf: phone DPR (PLAN item 41): the airframe canvas at the device's ratio up to 4 at rest (review r1: 4x reader zoom), 2 while it turns
  // (an easing crown or door is not turning: it never got under the 1e-6 change test for long)
  // f4-perf: still = the turn moved under 1e-3° and the view under 0.05 CSS px or 2 CSS px/s this tick (review f3: exact equality of
  // the view key restarted the count on an eased composition's 0.01-unit tail, and the loop slept first), no drag
  const viewStep = (Math.max(Math.abs(viewNow[1] - viewPrev[1]), Math.abs(viewNow[2] - viewPrev[2])) * viewNow[0] * Math.max(1, stageWidth ?? VB.w)) / VB.w + Math.abs(viewNow[0] - viewPrev[0]) * 100;
  viewPrev[0] = viewNow[0];
  viewPrev[1] = viewNow[1];
  viewPrev[2] = viewNow[2];
  const stillTick = !drag && !(Math.abs(pv.turn - restTurn) > 1e-3) && (viewSnapped || viewStep < Math.max(0.05, 2 * dt)); // a view under 2 CSS px a second: a spring's tail
  viewSnapped = false;
  restTicks = stillTick ? restTicks + 1 : 0;
  GOV.rest = restTicks; // f4-perf: for the tools (devices.mjs, drives): still ticks so far
  restTurn = pv.turn;
  // f4-perf: the governor's sample is the airframe's update, measured whole (review f3: under half rate the interval
  // that ended at a set() tick was the cheap skipped tick before it; the long one after the set() was never sampled, so
  // a throttled phone's tour at 6 poses a second read as 50 fps). The time since the previous set() of the same
  // movement, over its ticks: the frame time of the pair, so a 60 fps loop at half rate (bound by set(), which no ratio
  // helps) is not probed in vain, and a phone's 17 + 150 ms pair reads 83 ms
  govSpan += dtRaw;
  govTicks++;
  if (setRan) {
    if (govClean && restTicks === 0) governFrame((govSpan / govTicks) * 1000);
    govSpan = 0;
    govTicks = 0;
    govClean = restTicks === 0;
  } else if (!skipped) govClean = false;
  // f4-perf end
  if (restTicks === 6) governRest(); // f3-perf f3-perf end
  const ratioChanged = Boolean(canvas && canvas.setMaxRatio && canvas.setMaxRatio(restTicks >= 6 ? 4 : GOV_LEVELS[GOV.level].ratio)); // f3-perf: the governor's ratio while moving f3-perf end
  // review r1: at rest up to 4 (4x reader zoom), the page is idle then
  // fu/perf end
  const effectsMoved = Boolean(A3.repaint); // fu/perf: a page effect turned (the canvas hubs, kit patch 11) fu/perf end
  A3.repaint = false; // fu/perf fu/perf end
  // f3-perf: a skipped frame's view or alpha change is owed to the next frame (a resize, which clears the backing store,
  // and the first paint are never put off; a hub turn alone paints its rects now)
  const deferred = skipped && painted && !ratioChanged && (alphaChanged || viewMoved || restyled);
  if (deferred) paintOwed = true;
  const full = !deferred && (setRan || alphaChanged || viewMoved || restyled || !painted || ratioChanged || paintOwed);
  if (canvas && (full || effectsMoved)) {
    canvas.paint(!full ? { spinsOnly: true } : undefined); // fu/perf: only the hubs turned: their rects (review r1) fu/perf end
    painted = true;
    if (full) {
      lastPaintView = lastView;
      paintOwed = false;
    }
  }
  // f3-perf end
  // 9. readout (a shown part's label follows its state: a door opening, an engine starting); while the stage moves
  // under a still pointer the part under it is picked again, so the label always names what is under the cursor
  // (also when a fade takes a part's picking away or gives it back: follow-up review 1, the readout named the tug after
  // it had faded out at the platter's edge)
  let fadeKey = (pv.deckPlan ?? 0) > 0.5 ? "p" : "";
  for (const cls of FADE_CLASSES) fadeKey += (alpha[cls] ?? 1) < 0.5 ? "0" : "1";
  const fadesMoved = fadeKey !== lastFadeKey;
  lastFadeKey = fadeKey;
  if (hoverAt && !drag && (setRan || (viewMoved && !deferred) || fadesMoved)) { // f3-perf: !deferred
    const name = pickAt(hoverAt.x, hoverAt.y);
    if (name !== (picked && !picked.leaving ? picked.name : null)) showLabel(name);
  }
  if (picked && pv.label) {
    const text = textOf(picked.L);
    if (text !== pv.labelFull) {
      pv.labelFull = text;
      pv.label = shortLabel(text);
    }
  }
  if (setRan || (viewMoved && !deferred)) drawHover(); // f3-perf: !deferred
  writeReadout();
  modelChanged = true;
  // render only while active (webgl.md §7, §10): with the model paused or holding still, nothing easing and no GL
  // effect animating on its own, the loop stops after a few quiet frames and keeps its last picture; any input
  // wakes it
  // merge fu-r1: the cabin dimmer ramps in the model (0.25 a second) and its light envelope eases after it; neither moves
  // the pose, a vary or the readout on the first ticks after a Cabin click, so once a settled page could sleep
  // (fu/r1-perf) the click stepped one tick and the loop slept with the cabin still lit
  const cabinEasing = !pv.paused && !calm && (Math.abs((sim.state.cabin ?? 1) - (sim.target.cabin ?? 1)) > 1e-4 || Math.abs((pv.cabinLight ?? sim.state.cabin ?? 1) - (sim.state.cabin ?? 1)) > 1e-3);
  // merge fu-r1 end
  // fu/r2-interaction: the high-lift drive too (sort review, blocker: the Fowler flaps stay at 0° for the first ~127
  // drive degrees, so neither the pose, a vary nor the readout changed and the loop slept mid-drive at the stand)
  const hlDriving = !pv.paused && !calm && Boolean(sim.state.hlMoving);
  const moving = hlDriving || cabinEasing || Boolean(transit) || (pv.seek && !pv.paused) || (!pv.paused && !calm && Math.abs(sim.state.speed) > 0.05) || turnTarget !== null || Math.abs(omega) > 0.5 || drag || Math.abs(env.zoom.v) > 1e-4 || Math.abs(env.cx.v) > 1e-3 || Math.abs(env.cy.v) > 1e-3;
  const glBusy = typeof A3M8 !== "undefined" && A3M8.animating ? A3M8.animating(fx) : !calm;
  const quiet = !moving && !glBusy && (pv.paused || pv.mode === "hold") && !setRan && !alphaChanged && shownCore === lastShown;
  lastShown = shownCore;
  quietFrames = quiet ? quietFrames + 1 : 0;
  // f4-perf: and until the rest restore has painted: the loop never sleeps between a movement's end and the seventh
  // still tick (the sixth puts the canvas back to the device's ratio, up to 4, the seventh eases the lines back to full
  // detail; review f3: it slept first, and a paused, turned or zoomed figure kept the moving ratio and the faded lines
  // until the next input). Also under reduced motion (one tick an input) and after a tool's turn; at most 2 s of quiet
  // ticks, so nothing that is not motion keeps a page awake
  const restoring = restTicks < 7 && quietFrames < 120;
  // f4-perf: and while the WebGL cross-fade runs (paused at the mount, the loop slept at glShare 0.99993: GL's frozen
  // envelopes no longer keep a paused page awake, see gl/passes.js animating)
  const glFading = env.glShare.x !== (A3GL.ok ? 1 : 0);
  const animating = moving || paintOwed || restoring || glFading || (!calm && quietFrames < 20); // f3-perf: paintOwed
  if (visible && animating) frame = requestAnimationFrame(tick);
  else last = 0; // the next wake starts with a fresh dt, not the time spent asleep
  void lastBearingT;
  void modelChanged;
}
new IntersectionObserver(
  (entries) => {
    visible = entries[entries.length - 1].isIntersecting;
    if (visible) wake();
  },
  { rootMargin: "120px" },
).observe(stage);
still.addEventListener("change", () => {
  pv.mode = still.matches ? "hold" : "tour";
  wake();
});
// theme switch (the site's index.html swaps the theme in place: a380/tools/build-site.mjs): the page's state as plain
// data, and its restore in the remounted figure of the other theme. Carried: the model and its overrides, the page
// values and springs (zoom, centre, cutaway, lights), the rewind history, the tour, the pause, a seek, the reader's
// settings, the turntable and its inertia, Inspect and a view change in flight, an armed action and the idle timer.
// Not carried: render caches, the quality governor and the WebGL fade-in, which start as on a first load
const carryLets = () => ({ historyClock, seekRecorded, idleArmed, holdAt, wasSettled, reducedTugHeld, doneSaid, tugSaid, readerCabin, tourCut, engSeq, lever, leverDir, checkT, checkStill, omega, turnTarget, clock, inspectCabin });
A3.snapshot = () =>
  structuredClone({
    sim,
    pv: { ...pv, label: null },
    env: Object.fromEntries(Object.entries(env).filter(([k]) => k !== "glShare" && k !== "first")),
    history,
    lets: carryLets(),
    armed: armed && { phase: armed.phase, kind: armed.kind, arg: armed.arg, words: armed.words },
    inspect: inspect ? inspect.index : null,
    transit: transit && { ...transit, from: transit.from ? transit.from.id : null, to: transit.to.id },
    readoutView,
    lightState,
    idleLeft: idleArmed && pv.mode === "hold" ? Math.max(0, idleDue - performance.now()) : null,
  });
if (typeof A3RT_CARRY !== "undefined" && A3RT_CARRY) {
  const C = A3RT_CARRY;
  sim = C.sim;
  const { glShare: _glShare, first: _first, ...pvCarried } = C.pv;
  Object.assign(pv, pvCarried);
  Object.assign(env, C.env);
  history.push(...C.history);
  ({ historyClock, seekRecorded, idleArmed, holdAt, wasSettled, reducedTugHeld, doneSaid, tugSaid, readerCabin, tourCut, engSeq, lever, leverDir, checkT, checkStill, omega, turnTarget, clock, inspectCabin } = C.lets);
  if (C.armed && ARMED[C.armed.kind]) armed = { ...C.armed, then: () => ARMED[C.armed.kind](C.armed.arg) };
  const viewOf = (id) => VIEWS.find((v) => v.id === id) ?? null;
  if (C.inspect !== null && VIEWS[C.inspect]) inspect = { view: VIEWS[C.inspect], index: C.inspect };
  if (C.transit && viewOf(C.transit.to)) transit = { ...C.transit, from: viewOf(C.transit.from), to: viewOf(C.transit.to) };
  readoutView = C.readoutView;
  Object.assign(lightState, C.lightState);
  nameView(viewOf(pv.inspect));
  if (C.idleLeft !== null) idleTimer = armIdle(C.idleLeft);
  A3.state = sim.state;
}
syncLever();
syncLegend();
writeReadout();
// fu/lights: the first tick in a task of its own (item 34)
await new Promise((done) => setTimeout(done, 0));
// fu/lights end
// one synchronous frame so the first paint is the real state (reduced motion keeps it)
// fu/perf: the IntersectionObserver may already have reported the stage and woken the loop (the mount yields now):
// keep what it saw, and one loop
const seenBefore = visible;
if (frame) {
  cancelAnimationFrame(frame);
  frame = 0;
}
// fu/perf end
visible = true;
tick(performance.now());
visible = seenBefore; // fu/perf fu/perf end
mounted = true;
describe(true);
// fu/lights: mounted: the tools' hook back (item 34)
if (isoHook && !window.__isoTurn) window.__isoTurn = isoHook;
// fu/lights end
