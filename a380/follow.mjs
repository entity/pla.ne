// a380/follow.mjs (S): the figure's pure motion core, shared by the Node build and the page.
//
// Pure ESM with no imports: build.mjs inlines it into the page as `const F = (() => { … })()`, and the
// model is passed in as `M` wherever it is needed. It holds:
//   - makeFollow(rules, groups, TURN): figure channels → group values (DESIGN §3.3);
//   - the channel map from a model state (DESIGN §3.2);
//   - the rate table and the substepped model driver (DESIGN §7.1): fixed substeps of at most 1/30 s of
//     model time, so every display rate plays the same trajectory that poses() samples;
//   - tourBearing(t) and controlCheckAt(t) (DESIGN §7.6).

export const SUBSTEP = 1 / 30; // model seconds per substep (DESIGN §7.1)
export const GATE_DWELL = 14; // figure seconds at the gate before the push (DESIGN §7.1, tour table)
export const FL100_HOLD = 3; // figure seconds held after the landing lights go off (DESIGN §7.1)
// tour loop, figure seconds (DESIGN §7.6). The model's own timeline at these rates (--check prints it): PUSHBACK 14.0
// (the tug in view 17.1, connected 20.0, the push 21.2, engines 1+2 22.4, 3+4 29.0, the tug releases 33.4 and fades
// off 34.7-36.0), TAXI 36.4, LINEUP 47.7, TAKEOFF 52.9, CLIMB 78.7 (the gear retracts 79.4-85.8 at ×2.5), FL100 104.2,
// the FL100 hold ends 118.5, then the rewind to the gate (8 s). The loop's last hold covers the rewind, so the bearing
// never wraps before the gate. (Follow-up review 1: 123 s before the gear's transit played at ×2.5.)
export const LOOP = 128;
export const PHASE_ORDER = ["GATE", "PUSHBACK", "TAXI", "LINEUP", "TAKEOFF", "CLIMB", "FL100"];
export const PHASE_KEYS = { GATE: "1", PUSHBACK: "2", TAXI: "3", LINEUP: "4", TAKEOFF: "5", CLIMB: "6", FL100: "7" };
export const PHASE_SHORT = { GATE: "GATE", PUSHBACK: "PUSH", TAXI: "TAXI", LINEUP: "LINE", TAKEOFF: "T/O", CLIMB: "CLB", FL100: "FL100" };

// fu/r2-interaction: the phone readout's text, pure (the page writes it; tools/compact-check.mjs walks the departure with
// it). Sort review: it fell through every try at 40 characters and was cut mid-word ("gear movin"), dropping CONF, the
// N1 label and the rate during every gear transit. Now tokens shorten first, then whole fields go; nothing is sliced
export const COMPACT_MAX = 40; // DESIGN §1: the compact readout's limit
const TUG_SHORT = { "tug connecting": "tug arriving", "tug connected": "tug holding", "tug pushing": "tug push", "tug releasing": "tug leaving", "tug driving off": "tug leaving" };
const ftText = (s) => `${Math.round(s.height / 0.3048).toLocaleString("en-US")} ft`;
/** N1: "eng off", one value, or per engine while they disagree (a start, a shutdown). */
export function thrustShort(s) {
  const n1 = s.n1;
  const mean = n1.reduce((a, b) => a + b, 0) / 4;
  if (mean < 1 && !s.engineRun.some((r) => r)) return "eng off";
  return Math.max(...n1) - Math.min(...n1) > 2 ? `N1 ${n1.map((n) => Math.round(n)).join("·")}%` : `N1 ${Math.round(mean)}%`;
}
/** The ground speed, or the tug's moment in its place while it is at the nose wheel (short words). */
export function speedShort(M, s, kt = true) {
  const tug = M.tugWords ? M.tugWords(s) : "";
  if (s.onGround && s.speed < -0.5) return tug ? `tug ${Math.max(1, Math.round(-s.speed))} kt` : `push ${Math.max(1, Math.round(-s.speed))} kt`;
  if (tug) return TUG_SHORT[tug] ?? tug;
  return kt ? `${Math.round(Math.max(0, s.speed))} kt` : "";
}
/**
 * The phone readout (at most COMPACT_MAX characters): phase, CONF, N1, speed or the tug, the height in the air, the gear,
 * the rate (rate: the page's tag, " · ×12", " · paused" or ""). Tokens shorten in this order until it fits: the moving
 * gear to "gear ↕"; CONF onto the phase word ("CLB 1+F", clean dropped); the gear on the ground (always down there);
 * the N1 label; the gear word ("↑ ↓ ↕"); the per-engine N1 to its mean; the rate (a "paused" tag stays, N1 goes); N1.
 * Only then would whole fields go from the end: { text, sliced } (sliced true; tools/compact-check.mjs fails on it).
 * max: the characters the page's corner has room for (at most COMPACT_MAX; a container narrower than a phone).
 */
export function compactText(M, s, rate = "", max = COMPACT_MAX) {
  const confId = M.confName(s.slat, s.flap);
  let head = PHASE_SHORT[s.phase] ?? s.phase;
  let conf = `CONF ${confId}`;
  let n1 = thrustShort(s);
  const speed = speedShort(M, s);
  const height = !s.onGround && !(s.phase === "FL100" && s.height >= 10000 * 0.3048) ? ftText(s) : "";
  let gear = s.gear.stage === "up" ? "gear ↑" : s.gear.stage === "locked" ? "gear ↓" : "gear moving";
  let tag = String(rate).replace(/^ · /, "");
  const fields = () => [head, conf, n1, speed, height, gear, tag].filter(Boolean);
  const text = () => fields().join(" · ");
  const steps = [
    () => (gear = gear === "gear moving" ? "gear ↕" : gear),
    () => {
      head = confId === "0" ? head : `${head} ${confId}`;
      conf = "";
    },
    () => (gear = s.onGround ? "" : gear),
    () => (n1 = n1.replace(/^N1 /, "")),
    () => (gear = gear.replace(/^gear /, "")),
    () => (n1 = n1.includes("·") ? `${Math.round(s.n1.reduce((a, b) => a + b, 0) / 4)}%` : n1),
    // a rate goes before N1; "paused" stays (it says nothing runs) and N1 goes in its place
    () => {
      if (tag === "paused") n1 = "";
      else tag = "";
    },
    () => (n1 = ""),
  ];
  for (const step of steps) {
    if (text().length <= max) return { text: text(), sliced: false };
    step();
  }
  if (text().length <= max) return { text: text(), sliced: false };
  const list = fields();
  while (list.length > 1 && list.join(" · ").length > max) list.pop();
  return { text: list.join(" · "), sliced: true };
}
// fu/r2-interaction end

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const smoother = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (6 * x - 15) + 10);
};

// ---------------------------------------------------------------------------------------------
// rates (DESIGN §7.1): model seconds per figure second
// ---------------------------------------------------------------------------------------------
export const RATES = { GATE: 2, PUSHBACK: 12, PUSHBACK_DOORS: 3, PUSHBACK_TUG: 3, TAXI: 7.5, LINEUP: 9, TAKEOFF: 2, CLIMB: 10, FL100: 30, FL100_HELD: 1, GEAR_TRANSIT: 2.5, FLAP_TRANSIT: 2.5 };
/**
 * The gear's transit, and a reader's flaps in flight, play near real time (follow-up review 1: at the climb's ×10 and
 * FL100's ×30 a reader's G blinked the 20 s extension in 0.66 s, and the tour's retraction took about 2 s): the gear
 * from its doors opening to its doors closed (16 s up, 20 s down: 6.4 and 8 s on screen), a reader's flaps while they
 * move in the air. "gear" or "flaps" while one of them is in transit, else false.
 */
export function transitOf(state, target) {
  if (!state) return false;
  const g = state.gear;
  if (g && g.stage !== "up" && g.stage !== "locked") return "gear";
  // a reader's gear lever, from the moment it is moved (the model starts the doors on its next step: the rate drops with
  // the lever, so the whole 20 s extension plays at the transit rate). The crew's own lever is not counted here, so the
  // tour's trajectory (and the build's poses) are the gear stage's alone
  if (g && !state.onGround && target && target.readerGear && (target.gear ? 1 : 0) !== g.cmd) return "gear";
  return !state.onGround && target && target.readerHighLift && state.hlMoving ? "flaps" : false;
}

// ---------------------------------------------------------------------------------------------
// the pushback tug (follow-up): its channel is the model's s.tug (0 none, 0..1 driving in, 1 connected, 1..1.3
// releasing, 1.3..2 driving off, 2 clear). The free group `tug` (parts/tug.mjs) is synced to pitch's pose slid
// forward by tugOffset(channel) kit units (+x, ahead of the nose), and faded by tugAlpha as it leaves the platter
// ---------------------------------------------------------------------------------------------
/** True while the tug drives in, releases the wheel or drives off in view (the push itself runs at the push's rate). */
export const tugMoving = (state) => {
  const c = state && state.tug ? state.tug : 0;
  return (c > 0 && c < 1) || (c > 1 && c < 2 && tugOffset(c) < TUG_FADE);
};
const TUG_RUN = 60; // kit units (6 m): the tug comes in from, and drives off to, 6 m ahead of its place at the nose wheel
/** The tug's slide (kit units forward of its place at the nose wheel) for a channel value, as a follow table. */
export const TUG_SLIDE = (() => {
  const out = [];
  for (let i = 0; i <= 12; i++) out.push([i / 12, +(TUG_RUN * (1 - i / 12) ** 2).toFixed(3)]); // decelerating in
  out.push([1.3, 0]); // releasing: standing
  for (let i = 1; i <= 12; i++) out.push([1.3 + (0.7 * i) / 12, +(TUG_RUN * (i / 12) ** 2).toFixed(3)]); // accelerating away
  return out;
})();
export const TUG_FADE = 14; // kit units: the tug (cut at the platter's edge when connected) fades over its first 1.4 m off it
export const tugOffset = (c) => tableAt(TUG_SLIDE, c);
/** The tug's alpha: 0 parked, 1 at the nose wheel, fading as it drives in from or off over the platter's edge. */
export const tugAlpha = (c) => (c > 0 && c < 2 ? 1 - smooth(0, TUG_FADE, tugOffset(c)) : 0);

/** True while any door is not at the target the model is driving it to. */
export function doorsMoving(state, target) {
  for (const id of Object.keys(state.doors)) {
    const want = target.doors && id in target.doors ? target.doors[id] : 0;
    if (Math.abs(state.doors[id] - want) > 1e-6) return true;
  }
  return false;
}

/** True while an engine is starting, spooling down, or commanded to start (the reader's E at the stand). */
export function enginesBusy(state, target) {
  const idle = 20; // M.ENGINES.n1.groundIdle (follow.mjs takes no imports)
  for (let i = 0; i < 4; i++) {
    const run = state.engineRun ? state.engineRun[i] : 0;
    const n1 = state.n1 ? state.n1[i] : 0;
    const want = target && target.engineRun ? target.engineRun[i] : 0;
    if (want && !run) return true;
    if (run && n1 < idle - 0.6) return true;
    if (!run && n1 > 0.5) return true;
  }
  return false;
}

/** The display rate of a phase (model s per figure s). */
export function rateOf(phase, state, target) {
  const base = phaseRate(phase, state, target);
  const tr = transitOf(state, target);
  return tr ? Math.min(base, tr === "gear" ? RATES.GEAR_TRANSIT : RATES.FLAP_TRANSIT) : base;
}
function phaseRate(phase, state, target) {
  if (phase === "GATE") return enginesBusy(state, target) ? RATES.PUSHBACK : RATES.GATE;
  if (phase === "PUSHBACK") return doorsMoving(state, target) ? RATES.PUSHBACK_DOORS : tugMoving(state) ? RATES.PUSHBACK_TUG : RATES.PUSHBACK;
  // the 3 s hold after the landing lights go off at 10,000 ft plays near real time, so the readout stays at 10,000 ft
  if (phase === "FL100" && state && state.height >= FL100_FT) return RATES.FL100_HELD;
  return RATES[phase] ?? 1;
}
const FL100_FT = 10000 * 0.3048;
const RATE_SETTLE = 0.6; // s: the display rate eases across a phase change (×2 → ×10 at the climb: the ground does not jump)
/** The eased display rate (a critically damped spring, as the page's settle()); snaps when sim.rateSnap is set. */
function easeRate(sim, want, h) {
  if (sim.rateX === undefined || sim.rateX === null || sim.rateSnap) {
    sim.rateX = want;
    sim.rateV = 0;
    sim.rateSnap = false;
    return want;
  }
  const w = 1 / RATE_SETTLE;
  for (let i = 0; i < 4; i++) {
    const q = h / 4;
    sim.rateV += (w * w * (want - sim.rateX) - 2 * w * sim.rateV) * q;
    sim.rateX += sim.rateV * q;
  }
  if (Math.abs(want - sim.rateX) < 1e-4 && Math.abs(sim.rateV) < 1e-4) {
    sim.rateX = want;
    sim.rateV = 0;
  }
  return Math.max(0, sim.rateX);
}

// ---------------------------------------------------------------------------------------------
// the substepped model driver
// ---------------------------------------------------------------------------------------------
/** A fresh simulation at the gate: { state, phase, target, t (figure s in phase), done, held (s after done) }. */
export function createSim(M, overrides = null) {
  const sim = { state: M.initialState(), phase: "GATE", target: M.phaseState("GATE"), t: 0, done: false, held: 0, overrides };
  applyOverrides(sim);
  return sim;
}

/** Merge page overrides ({ doors: {id: 0|1}, lights: {...}, engineRun: [...], gear, slat, flap, spoilers }) into the phase target. */
export function applyOverrides(sim) {
  const o = sim.overrides;
  if (!o) return;
  const t = sim.target;
  if (o.doors) t.doors = { ...t.doors, ...o.doors };
  // a reader's flaps lever moves at once in the air (the model holds only the crew's retraction for S speed), and its
  // transit plays near real time (rateOf)
  t.readerHighLift = o.slat !== undefined || o.flap !== undefined;
  t.readerGear = o.gear !== undefined;
  if (o.lights) {
    t.lights = { ...t.lights, ...o.lights };
    // the switches the reader set: the model's crew never moves them (M.step)
    t.readerLights = Object.fromEntries(Object.keys(o.lights).map((k) => [k, 1]));
  }
  for (const key of ["gear", "slat", "flap", "aileronDroop", "spoilers", "engineRun", "n1", "cabin"]) if (o[key] !== undefined) t[key] = Array.isArray(o[key]) ? o[key].slice() : o[key];
}

/** Enter a phase (its targets from the model, plus the overrides that persist). */
export function enterPhase(M, sim, phase) {
  sim.phase = phase;
  // the state enters the phase now (follow-up review 1: it changed only on the next model step, so a seek that arrived
  // while the figure was paused read the previous phase)
  if (M.enterPhaseState) sim.state = M.enterPhaseState(sim.state, phase);
  sim.target = M.phaseState(phase);
  sim.t = 0;
  sim.done = false;
  sim.doneAt = null;
  sim.held = 0;
  applyOverrides(sim);
}

/**
 * Advance the simulation by dtFig figure seconds at `rate` (default: the phase's display rate), in fixed
 * substeps of at most SUBSTEP model seconds. `auto` advances to the next phase when the current one is done
 * (the tour); otherwise the phase holds at its end state. Returns the number of model substeps taken.
 */
export function advance(M, sim, dtFig, { rate = null, auto = true, stopAt = null } = {}) {
  let steps = 0;
  let left = Math.max(0, dtFig);
  // advance in figure-time slices so the rate (which depends on the state) is re-read often. Without an explicit
  // rate the display rate eases across phase changes here, so the page and the build's trajectory (poses, the tour
  // timing in DATA.tourPhases) play the same timeline
  while (left > 1e-9) {
    const slice = Math.min(left, 0.05);
    left -= slice;
    sim.t += slice;
    const want = rateOf(sim.phase, sim.state, sim.target);
    // at the stand the aircraft stands still while the doors close and the tug comes and goes: the rate changes at
    // once there (nothing on the ground moves, so nothing jumps), and the tug's moves play at their own rate
    if (rate === null && sim.phase === "PUSHBACK" && sim.rateWant !== undefined && want !== sim.rateWant && Math.abs(sim.state.speed) < 0.25) sim.rateSnap = true;
    sim.rateWant = want;
    // a transit that starts (the gear lever, a reader's flaps in flight) takes its rate at once: eased over 0.6 s, the
    // first 9 model s of a 20 s extension ran at the climb's rate (follow-up review 1)
    const transit = transitOf(sim.state, sim.target);
    if (rate === null && transit && !sim.inTransit && want < (sim.rateX ?? want)) sim.rateSnap = true;
    sim.inTransit = transit;
    const r = rate ?? easeRate(sim, want, slice);
    if (rate !== null) sim.rateX = rate;
    if (sim.phase === "GATE" && !sim.overrides?.gateHold) {
      // the model is idle at the gate apart from doors (and engines) the reader toggles (DESIGN §7.1)
      steps += substeps(M, sim, slice * r);
      if (auto && sim.t >= GATE_DWELL) enterPhase(M, sim, "PUSHBACK");
      if (stopAt && sim.phase === stopAt) return steps;
      continue;
    }
    // a held phase (auto off) also checks phaseDone after every substep, and records the state it ended in: HOLD pins
    // an airborne phase at exactly that state (review round 3: it drifted 10-40 ft past the model's end state)
    if (rate !== null || stopAt || !auto) {
      // an explicit rate (a seek, a reduced-motion jump) can carry many model seconds per slice: phaseDone is checked
      // after every model substep and the next phase is entered on that exact substep, so a fast seek arrives in the
      // same state as the tour (a slice-level check let the take-off climb to 80-250 ft before the climb began)
      let model = slice * r;
      while (model > 1e-9) {
        const h = Math.min(SUBSTEP, model);
        model -= h;
        sim.state = M.step(sim.state, sim.target, h);
        steps++;
        if (!sim.done && M.phaseDone(sim.state, sim.phase)) {
          sim.done = true;
          const st = sim.state;
          sim.doneAt = { phase: sim.phase, height: st.height, speed: st.speed, pitch: st.pitch, gamma: st.gamma, vs: st.vs };
        }
        if (sim.done) sim.held += r > 0 ? h / r : 0;
        if (auto && sim.done) {
          const next = PHASE_ORDER[PHASE_ORDER.indexOf(sim.phase) + 1];
          const wait = sim.phase === "FL100" ? FL100_HOLD : 0;
          if (next && sim.held >= wait) enterPhase(M, sim, next);
          // a seek stops on its phase's first substep (a fast seek must not run through it in one call)
          if (stopAt && sim.phase === stopAt) return steps;
        }
        if (stopAt && sim.phase === stopAt) return steps;
      }
      continue;
    }
    steps += substeps(M, sim, slice * r);
    if (!sim.done && M.phaseDone(sim.state, sim.phase)) {
      sim.done = true;
      // the state it ended in: the tour pins the FL100 hold there too (follow-up review 1: it climbed on to 10,663 ft
      // under a header that read 10,000 ft)
      const st = sim.state;
      sim.doneAt = { phase: sim.phase, height: st.height, speed: st.speed, pitch: st.pitch, gamma: st.gamma, vs: st.vs };
    }
    if (sim.done) sim.held += slice;
    if (auto && sim.done) {
      const next = PHASE_ORDER[PHASE_ORDER.indexOf(sim.phase) + 1];
      const wait = sim.phase === "FL100" ? FL100_HOLD : 0;
      if (next && sim.held >= wait) enterPhase(M, sim, next);
    }
  }
  return steps;
}

function substeps(M, sim, modelSeconds) {
  if (!(modelSeconds > 0)) return 0;
  const n = Math.max(1, Math.ceil(modelSeconds / SUBSTEP - 1e-9));
  const h = modelSeconds / n;
  for (let i = 0; i < n; i++) sim.state = M.step(sim.state, sim.target, h);
  return n;
}

/**
 * The tour's trajectory, sampled every `every` figure seconds from the gate to the end of the FL100 hold
 * (about 106 s): [{ t, phase, state }]. poses(), the fit and the audit clips use it.
 */
export function trajectory(M, { every = 0.5, until = LOOP - 8 } = {}) {
  const sim = createSim(M);
  const out = [{ t: 0, phase: sim.phase, state: sim.state }];
  let t = 0;
  while (t < until - 1e-9) {
    advance(M, sim, every);
    t += every;
    out.push({ t, phase: sim.phase, state: sim.state });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// channels (DESIGN §3.2)
// ---------------------------------------------------------------------------------------------
export const LIFT_CAP = 6; // metres: heights are drawn as 6·tanh(h/6)
export const liftOf = (h) => 10 * LIFT_CAP * Math.tanh(Math.max(0, h) / LIFT_CAP);

/**
 * Figure channels from a model state plus page values: { turn, steer, roll, pitchCmd, yaw, spoiler,
 * spoiler1, cabin }. Every key is a number; door channels are `door.<ID>`.
 */
export function channelsOf(state, page = {}) {
  const h = state.height ?? 0;
  // the tug's cradle closes round the nose wheels: while it is at the wheel (driving its last metre in, connected,
  // releasing, its first metre off) the nose gear does not steer (the page refuses [ and ] while it is there)
  const tug = state.tug ?? 0;
  const steerFree = 1 - smooth(0.4, 0.6, tug) * (1 - smooth(1.4, 1.6, tug));
  const out = {
    turn: page.turn ?? 0,
    lift: liftOf(h),
    pitch: clamp(state.pitch ?? 0, 0, 12.5),
    rot: clamp(state.pitch ?? 0, 0, 12.5) * (1 - smooth(0, 0.3, h)),
    trim: smooth(0.3, 2, h),
    gear: state.gear ? state.gear.leg : 1,
    gearDoors: state.gear ? state.gear.doors : 0,
    gearBody: state.gear ? state.gear.body ?? state.gear.leg : 1, // fu/gear: the body gear's legs (they trail on extension)
    steer: (page.steer ?? 0) * steerFree,
    tug,
    slat: state.slat ?? 0,
    flap: state.flap ?? 0,
    droop: (state.aileronDroop ?? 0) + (page.aileron ?? 0), // the ground spoilers' ailerons up 25° add here
    roll: page.roll ?? 0,
    pitchCmd: page.pitchCmd ?? 0,
    yaw: page.yaw ?? 0,
    spoiler: page.spoiler ?? 0,
    spoiler1: page.spoiler1 ?? 0,
    cabin: page.cabin ?? 0,
  };
  for (const [id, v] of Object.entries(state.doors ?? {})) out[`door.${id}`] = v;
  return out;
}

// ---------------------------------------------------------------------------------------------
// follow rules (DESIGN §3.3)
// ---------------------------------------------------------------------------------------------
/** Piecewise-linear table lookup, with an optional smoothstep ease between knots. */
export function tableAt(table, x, ease = null) {
  if (x <= table[0][0]) return table[0][1];
  const last = table[table.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1];
    const [x1, y1] = table[i];
    if (x <= x1) {
      let t = (x - x0) / (x1 - x0 || 1);
      if (ease === "smooth") t = t * t * (3 - 2 * t);
      return y0 + (y1 - y0) * t;
    }
  }
  return last[1];
}

export const PARKED = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 1e5] };

/**
 * A sync rule's two options (the pushback tug): `below` parks the group again once the channel reaches it, and
 * `slide: { channel, axis, table }` moves the synced pose along `axis` (pitch's frame, kit) by table(channel) kit
 * units: a rest point p is drawn at R·(p + axis·d) + t.
 */
function slideSync(pose, s, ch) {
  if (pose === PARKED) return pose;
  if (s.below !== undefined && (ch[s.channel] ?? 0) >= s.below) return PARKED;
  if (!s.slide) return pose;
  const d = tableAt(s.slide.table, ch[s.slide.channel] ?? 0);
  const a = s.slide.axis;
  const R = pose.R;
  const off = [a[0] * d, a[1] * d, a[2] * d];
  return { R, t: [pose.t[0] + R[0] * off[0] + R[1] * off[1] + R[2] * off[2], pose.t[1] + R[3] * off[0] + R[4] * off[1] + R[5] * off[2], pose.t[2] + R[6] * off[0] + R[7] * off[1] + R[8] * off[2]] };
}

/**
 * makeFollow(rules, groups, TURN) → follow(channels) → group values.
 * rules: [{ group, channel, table?, ease?, sync? }]. A rule without a table is the identity. Rules on one
 * group add, then the sum is clamped to the group's range. A `sync` rule ({ group, sync: { channel, above },
 * pivot }) returns the composed world pose of `pitch` while channels[channel] > above, else PARKED.
 * groups: [{ name, kind, range, point }] (pitch must carry its hinge point and axis).
 */
export function makeFollow(rules, groups, TURN) {
  const byGroup = new Map();
  for (const rule of rules) {
    if (!byGroup.has(rule.group)) byGroup.set(rule.group, []);
    byGroup.get(rule.group).push(rule);
  }
  const info = new Map(groups.map((g) => [g.name, g]));
  const pitch = info.get("pitch");
  const order = [...byGroup.keys()];
  return function follow(ch) {
    const values = {};
    let synced = null;
    const syncPose = () => {
      if (synced) return synced;
      const Rz = TURN.rotation([0, 0, 1], ch.turn ?? 0);
      const Rp = TURN.rotation(pitch.axis, ch.pitch ?? 0);
      const P = pitch.point;
      const rp = [Rp[0] * P[0] + Rp[1] * P[1] + Rp[2] * P[2], Rp[3] * P[0] + Rp[4] * P[1] + Rp[5] * P[2], Rp[6] * P[0] + Rp[7] * P[1] + Rp[8] * P[2]];
      const d = [P[0] - rp[0], P[1] - rp[1], P[2] - rp[2] + (ch.lift ?? 0)];
      const t = [Rz[0] * d[0] + Rz[1] * d[1] + Rz[2] * d[2], Rz[3] * d[0] + Rz[4] * d[1] + Rz[5] * d[2], Rz[6] * d[0] + Rz[7] * d[1] + Rz[8] * d[2]];
      synced = { R: TURN.compose(Rz, Rp), t };
      return synced;
    };
    for (const name of order) {
      const list = byGroup.get(name);
      const g = info.get(name);
      if (list[0].sync) {
        const s = list[0].sync;
        const x = ch[s.channel] ?? values[s.channel] ?? 0;
        values[name] = x > (s.above ?? 0) ? syncPose() : PARKED;
        if (s.below !== undefined || s.slide) values[name] = slideSync(values[name], s, ch); // fu/interaction: the tug
        continue;
      }
      let v = 0;
      for (const rule of list) {
        const x = ch[rule.channel] ?? (rule.fallback ? ch[rule.fallback] : undefined) ?? 0; // fu/gear: a channel a state omits (gearBody) reads its fallback (gear)
        v += rule.table ? tableAt(rule.table, x, rule.ease ?? null) : x;
      }
      if (g && g.range && g.kind !== "turn") v = clamp(v, Math.min(g.range[0], g.range[1]), Math.max(g.range[0], g.range[1]));
      values[name] = v;
    }
    return values;
  };
}

// ---------------------------------------------------------------------------------------------
// the idle tour (DESIGN §7.6): one monotone turn per 114 s loop, smootherstep between holds
// ---------------------------------------------------------------------------------------------
// [t, bearing b] knots: holds are pairs of knots with the same b. b = 40° − turn. Timed to the model (above):
// gate starboard side, the cutaway held open at the cabin bearing, round the nose as the tug drives in, the push
// from the port side (engines 1+2 at 22.4 s), round to the port beam as engines 3 and 4 start (29.0 s) and the tug
// releases the nose wheel and drives off (33.4-36.0 s), then the aft quarter for the slats, the flaps and the control
// check in taxi, tail-on at line-up, then the starboard profile from the roll through the climb, FL100 and the rewind.
export const TOUR = [
  [0, 100], [3.5, 100], [7, 45], [13, 45], [19, -40], [27, -40], [31, -90], [36.4, -100], [39.5, -130], [45.5, -130], [49.5, -190], [52, -190], [58, -260], [LOOP, -260],
];
/** The cutaway in the tour (DESIGN §7.6): it opens at 3.5 s and is held open until 13 s (page settle 2.5 s). */
export const tourCutaway = (t) => (t >= 3.5 && t < 13 ? 1 : 0);
/** The control check in the tour starts here (figure s), after TAXI begins (36.4 s) and the turn to the aft quarter. */
export const CHECK_AT = 39.5;
/** The tour bearing b (degrees, aircraft frame) at loop time t. Monotone non-increasing; continuous velocity. */
export function tourBearing(t) {
  const x = ((t % LOOP) + LOOP) % LOOP;
  for (let i = 1; i < TOUR.length; i++) {
    const [t0, b0] = TOUR[i - 1];
    const [t1, b1] = TOUR[i];
    if (x <= t1) return b0 + (b1 - b0) * smoother((x - t0) / (t1 - t0 || 1));
  }
  return TOUR[TOUR.length - 1][1];
}
export const turnOfBearing = (b) => 40 - b;
export const bearingOfTurn = (turn) => 40 - turn;

/** The control check in taxi (FCOM "FLT CTL check"; deflections [E]): CHECK_AT + 0…6 s of the tour, 2 s per axis. */
export function controlCheckAt(t) {
  const out = { roll: 0, pitchCmd: 0, yaw: 0 };
  const axes = ["roll", "pitchCmd", "yaw"];
  for (let i = 0; i < 3; i++) {
    const t0 = CHECK_AT + 2 * i;
    if (t < t0 || t > t0 + 2) continue;
    const u = (t - t0) / 2;
    // −1 → +1 → 0, eased: a full sweep each way
    out[axes[i]] = u < 0.25 ? -smoother(u / 0.25) : u < 0.75 ? -1 + 2 * smoother((u - 0.25) / 0.5) : 1 - smoother((u - 0.75) / 0.25);
  }
  return out;
}
