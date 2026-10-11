// a380/parts/lights.mjs (M8): Lights: WebGL ID mask, per-kind air programs, ground canvas, every exterior light,
// cabin windows, cockpit displays, fans, haze, daylight inks, canvas-safe fallbacks (DESIGN §6, §9 M8).
//
// M8 adds no airframe geometry. It builds:
//   - the GL programs, generated here from world.mjs and the built parts (part.world), shipped through
//     ctx.glEffect and drawn by gl/passes.js (page) through the scaffold's harness:
//       air:    windows, cockpit, engines, washes, lights (the `points` kind), volumes (beams dark only, haze both);
//       ground: pools, the lower beacon's and the strobes' washes (dark), the back halves of the beams (dark) and haze;
//     every air surface pass is masked by the GPU order-index mask (gl/mask.js);
//   - stand-in light, lamp and target registrations for every module that is still stubbed in this build
//     (the real modules register their own: DESIGN §9);
//   - the canvas-safe fallbacks: lamp-lens billboards, pools on the platter, wash and cockpit planes, each a
//     ctx.vary class whose alpha is envelope × sector × (1 − glShare) (A3M8.alpha, gl/passes.js);
//   - the page hook (A3.on("frame") → A3M8.frame), page data (DATA.mod.m8) and CSS.
// Groups: none. Units: shader constants are KIT METRES (kit units / 10), see gl/shaders.mjs.
import * as SH from "../gl/shaders.mjs";
import { glslPose } from "../../kit/gl.mjs";
import { convexHull3 } from "../../kit/hull3.mjs";
import { geom } from "./fuselage.mjs";

export const id = "lights";
export const owner = "M8";
export const title = "Lights: WebGL ID mask, per-kind air programs, ground canvas, every exterior light, cabin windows, cockpit displays, fans, haze, daylight inks, canvas-safe fallbacks";
/** Every part name this module creates starts with one of these (the harness enforces it). */
export const prefixes = ["light.fx", "lights."];
/** true: the harness builds stubs.mjs's stand-in instead of build(). */
export const stub = false;

const LIGHT_THEME = process.argv.includes("--light");
const D2R = Math.PI / 180;
const KM = SH.KM;
/** The inlet M4 draws (engines.mjs FAN): the dark disc radius, the fan plane depth, the spinner. */
const FAN = { ri: 1.475, depth: 1.88, rs: 0.42, ls: 1.04, blades: 24, twist: 1.3, slit: 0.14, spiral: 0.85, rpm100: 2900 };
/** The flight deck's instrument panel (T3; DESIGN §5.8, M7 builds the furniture): model metres. */
// The displays seen through the closed canopy sit where M7 built them (cabin.mjs; M7's request to M8, integrated),
// so nothing jumps when the canopy lifts and the cockpit group's own displays take over: the main row (PFD, ND,
// EWD, ND, PFD) on the panel face at x 2.226, centres z 6.575; the MFD-SD-MFD row at y ∓0.235 / 0, z 6.355 (its
// shelf is 0.16 m further aft; drawn on the panel plane through the panes, within 0.8 px at 1×).
export const FLIGHT_DECK = {
  panelX: 2.226, // the main panel face, about 0.7 m ahead of the eye (2.92), facing aft
  panelHalf: 0.98,
  display: [0.152, 0.203], // 6 × 8 in, portrait
  main: [
    { id: "PFD-L", y: -0.62, z: 6.575, kind: 0 },
    { id: "ND-L", y: -0.4, z: 6.575, kind: 1 },
    { id: "EWD", y: 0, z: 6.575, kind: 2 },
    { id: "ND-R", y: 0.4, z: 6.575, kind: 1 },
    { id: "PFD-R", y: 0.62, z: 6.575, kind: 0 },
    { id: "MFD-L", y: -0.235, z: 6.355, kind: 4 },
    { id: "SD", y: 0, z: 6.355, kind: 3 },
    { id: "MFD-R", y: 0.235, z: 6.355, kind: 4 },
  ],
  pedestal: [],
  pedestalTilt: 40,
};

/**
 * The surface inks, each a CSS token read on the page (follow-up item 35: SH.GL_INKS holds every ink role, its token
 * and its two values; the shaders carry the role's uniform, never the colour). A page carries one theme, so the glow
 * (dark) and the paper body (light) of a role are the one token's two theme values.
 */
const SURF = {
  windowDark: SH.inkU("win"), cargoDark: SH.inkU("cargo"), windowRim: SH.inkU("winRim"), windowBody: SH.inkU("win"), windowCore: SH.inkU("winCore"), windowCap: 0.92,
  cockpitDark: SH.inkU("ck"), cockpitRim: SH.inkU("ckRim"), cockpitBody: SH.inkU("ck"), cockpitCore: SH.inkU("ckCore"),
};
/**
 * Lamp defaults by switch. Pool and beam lamps: `spread` [horizontal, vertical] half-angles (deg, the outer
 * edge; elliptical beams), power (into tonemap), reach m, beam (dark volumes). Wash lamps (logo, scan) keep a
 * round `cone` [outer, inner] (deg). Sources: M.LIGHTS (landing 12 x 10 deg, taxi 0..26 deg, nose ±15 deg,
 * turn-off 15..73 deg) [E] for the vertical spreads.
 */
export const LAMPS = {
  landing: { spread: [7, 5.5], power: 4200, reach: 60, beam: true, lens: 0.17 },
  // taxi and turn-off beams brighter (review round 2: a night taxi's lamps lit nothing ahead at 1x)
  taxi: { spread: [14, 5], power: 2800, reach: 40, beam: true, lens: 0.13 },
  // f4-lights: the nose-strut taxi lamp's own switch (model.mjs lights.taxiNose: off when the gear doors start opening),
  // the same lamp as the wing-root taxi lamps
  taxiNose: { spread: [14, 5], power: 2800, reach: 40, beam: true, lens: 0.13 },
  takeoff: { spread: [15, 5], power: 2200, reach: 50, beam: true, lens: 0.1 },
  runwayTurnoff: { spread: [30, 5], power: 1200, reach: 28, beam: true, lens: 0.09 },
  camera: { spread: [24, 24], power: 12, reach: 12, beam: false, lens: 0.05 },
  cargoFlood: { spread: [42, 30], power: 16, reach: 12, beam: false, lens: 0.07 },
  gearBay: { spread: [55, 55], power: 10, reach: 8, beam: false, lens: 0.05 },
  // the logo lamps wash the fin and rudder evenly (a wide soft cone) at a lower level: they were the brightest mass in
  // the figure at the gate (review round 1)
  logo: { cone: [42, 18], power: 15, reach: 24, beam: false, lens: 0.07, wash: "fin" },
  wing: { cone: [9, 4], power: 520, reach: 48, beam: false, lens: 0.08, wash: "wing" },
  engine: { cone: [12, 5], power: 140, reach: 26, beam: false, lens: 0.08, wash: "nacelle" },
};
/**
 * The lower beacon's ground pool (dark; review fu-1): energy k·√cosθ / (d² + soft) (d the lens distance, m), reaching 0
 * between reach[0] and reach[1] m from the lens; tonemapped about R 120 under the belly at the flash's peak, below the
 * cargo-flood pool's 130. The no-WebGL pool samples the same law.
 */
export const BEACON_POOL = { k: 12.7, soft: 16, reach: [12, 22] };
/** Wash lamp slots in the washes program (uWS/uWD/uWC): logo L, R; wing scan L, R; engine scan L, R. */
export const WASH_SLOTS = { logo: [0, 1], wing: [2, 3], engine: [4, 5] };
const N_LAMPS = 24;

// --------------------------------------------------------------------------------------------- helpers
/**
 * Consecutive groups { from, to } of generated functions, each holding at most `budget` characters of them (at least
 * one function a group). Follow-up item 34: a program's compile and link time on this machine's GPU grows with its
 * source at about 4-5 ms per KB, and no program may take over about 200 ms.
 */
const CHUNK_BUDGET = 26 * 1024;
export function chunksOf(sources, budget) {
  const out = [];
  let cur = null;
  sources.forEach((s, k) => {
    if (!cur || (cur.size + s.length > budget && cur.to > cur.from)) out.push((cur = { from: k, to: k, size: 0 }));
    cur.to = k + 1;
    cur.size += s.length;
  });
  return out;
}
const unit = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const r3 = (p) => p.map((v) => Math.round(v * 1e4) / 1e4);
/** A model direction aimed by a bearing from the nose (0 forward, + starboard, deg) and a depression (deg). */
const aim = (bearing, depression) => [-Math.cos(depression * D2R) * Math.cos(bearing * D2R), Math.cos(depression * D2R) * Math.sin(bearing * D2R), -Math.sin(depression * D2R)];

// --------------------------------------------------------------------------------------------- stand-ins
/**
 * Registrations for the modules that are stubbed in this build, on the stub parts' names (DESIGN §9 lists who
 * registers what). Each is the true model light (M.LIGHTS) at its true position; housings are the stub parts.
 */
function standIns(ctx) {
  const { W, M } = ctx;
  const K = (p) => r3(W.kit(p));
  const Kd = (d) => r3(W.kitDir(unit(d)));
  const has = (name) => Boolean(ctx.part(name));
  const lights = [];
  const lamps = [];
  const light = (spec) => has(spec.part) && lights.push(spec);
  const lamp = (spec) => has(spec.part) && lamps.push(spec);
  const strobe = (tail) => ({ period: 1.0, offsets: tail ? [0] : [0, 0.11], rise: 0.05, fall: 0.04, phase: 0 });
  // the model's beacon (flashAt): on 0.12 s falling 1 → 0.7, then off; an LED's fast fall (τ 0.03 s)
  const beacon = beaconFlashOf(M);
  const L = M.LIGHTS;
  if (ctx.stubbed("wings")) {
    for (const [s, side] of W.SIDES) {
      const tip = `wings.${s}.box.6`;
      const fence = `wings.${s}.fence`;
      const nav = L.nav.find((n) => Math.sign(n.at[1]) === side && n.id !== "navTail");
      light({ id: nav.id, part: tip, group: "pitch", at: K(nav.at), normal: Kd([-0.35, side, 0]), kind: "nav", color: side < 0 ? "red" : "green", lens: 0.12, halo: 3.2, switch: "nav", settle: 0.22, sector: side < 0 ? [-110, 0] : [0, 110] });
      const st = L.strobe.find((n) => Math.sign(n.at[1]) === side);
      light({ id: st.id, part: tip, group: "pitch", at: K(st.at), normal: Kd([0.25, side, 0]), kind: "strobe", color: "white", lens: 0.12, halo: 4, switch: "strobe", settle: 0.2, flash: strobe(false) });
      for (const ob of L.obstruction.filter((o) => Math.sign(o.at[1]) === side)) {
        const top = ob.id.endsWith("Top");
        light({ id: ob.id, part: fence, group: "pitch", at: K([ob.at[0], ob.at[1] + side * 0.12, ob.at[2]]), normal: Kd([0, side, top ? 0.6 : -0.6]), kind: "obstruction", color: "white", lens: 0.06, halo: 2.4, switch: "obstruction", settle: 0.22 });
      }
      for (const ld of L.landing.filter((n) => Math.sign(n.at[1]) === side)) lamp({ id: ld.id, part: `wings.${s}.box.1`, group: "pitch", at: K(ld.at), dir: Kd(aim(side * 1.6, 3.5)), switch: "landing", ...LAMPS.landing });
      const tx = L.taxi.find((n) => Math.sign(n.at[1]) === side);
      lamp({ id: tx.id, part: `wings.${s}.box.1`, group: "pitch", at: K(tx.at), dir: Kd(aim(side * 13, 5)), switch: "taxi", ...LAMPS.taxi });
      const cam = L.camera.find((n) => n.id.startsWith("camWing") && Math.sign(n.at[1]) === side);
      lamp({ id: cam.id, part: `wings.${s}.box.2`, group: "pitch", at: K(cam.at), dir: Kd(sub([33.2, side * 5.2, 0], cam.at)), switch: "camera", ...LAMPS.camera });
    }
  }
  if (ctx.stubbed("tail")) {
    // the APU blade is M2's (T6: nav on top, strobe under it); the stub tail tip ends at 69.4 m: its end face
    light({ id: "navTail", part: "tail.tip", group: "pitch", at: K([69.42, 0, 8.85]), normal: [-1, 0, 0], kind: "nav", color: "white", lens: 0.12, halo: 3, switch: "nav", settle: 0.22, sector: [110, 250] });
    light({ id: "strobeTail", part: "tail.tip", group: "pitch", at: K([69.42, 0, 7.55]), normal: Kd([1, 0, -0.3]), kind: "strobe", color: "white", lens: 0.11, halo: 4, switch: "strobe", settle: 0.2, flash: strobe(true) });
    for (const lg of L.logo) {
      const side = Math.sign(lg.at[1]);
      lamp({ id: lg.id, part: `tail.htp.${side < 0 ? "l" : "r"}`, group: "pitch", at: K(lg.at), dir: Kd(sub([60.5, 0, 15.2], lg.at)), switch: "logo", ...LAMPS.logo });
    }
  }
  if (ctx.stubbed("skin")) {
    for (const [bid, part, group] of [["beaconUpperL", "light.beacon.upperL", "cut.up"], ["beaconUpperR", "light.beacon.upperR", "cut.up"], ["beaconLower", "light.beacon.lower", "pitch"]]) {
      const b = beaconMountOf(W, bid);
      light({ id: bid, part, group, at: K(b.tip), normal: r3(W.kitDir(b.n)), kind: "beacon", color: "red", lens: 0.12, halo: 4, switch: "beacon", settle: 0.2, flash: beacon });
    }
    for (const sc of L.wingScan) {
      const side = Math.sign(sc.at[1]);
      lamp({ id: sc.id, part: `nose.f.wall.${side < 0 ? "l" : "r"}`, group: "pitch", at: K(sc.at), dir: Kd(sub(sc.aimAt, sc.at)), switch: "wing", ...LAMPS.wing });
    }
    for (const cf of L.cargoFlood) lamp({ id: cf.id, part: cf.id === "cargoFwd" ? "nose.f.block" : "tail.aft", group: "pitch", at: K(cf.at), dir: Kd(sub([cf.at[0], 6.2, 0], cf.at)), switch: "cargoFlood", ...LAMPS.cargoFlood });
    lamp({ id: "bayWingL", part: "skin.fair.wlg", group: "pitch", at: K([32.9, -3.0, 2.3]), dir: [0, 0, -1], switch: "gearBay", ...LAMPS.gearBay });
    lamp({ id: "bayWingR", part: "skin.fair.wlg", group: "pitch", at: K([32.9, 3.0, 2.3]), dir: [0, 0, -1], switch: "gearBay", ...LAMPS.gearBay });
    lamp({ id: "bayBody", part: "skin.fair.blg", group: "pitch", at: K([38.3, 0, 2.6]), dir: [0, 0, -1], switch: "gearBay", ...LAMPS.gearBay });
  }
  // the engine scan lamps sit on the fuselage: M6 registers them with the wing scan lamps
  if (ctx.stubbed("skin"))
    for (const es of L.engineScan) {
      const side = Math.sign(es.at[1]);
      lamp({ id: es.id, part: "nose.fwd", group: "pitch", at: K(es.at), dir: Kd(sub(es.aimAt, es.at)), switch: "engine", ...LAMPS.engine });
      void side;
    }
  if (ctx.stubbed("gear")) {
    const leg = "nlg.leg";
    const tn = L.taxi.find((n) => n.id === "taxiNose");
    lamp({ id: tn.id, part: leg, group: "pitch", at: K(tn.at), dir: Kd(aim(0, 4)), switch: "taxiNose", gate: "gear", ...LAMPS.taxi });
    for (const to of L.takeoff) lamp({ id: to.id, part: leg, group: "pitch", at: K(to.at), dir: Kd(aim(Math.sign(to.at[1]) * 4, 3)), switch: "takeoff", gate: "gear", ...LAMPS.takeoff });
    for (const rw of L.runwayTurnoff) lamp({ id: rw.id, part: leg, group: "pitch", at: K(rw.at), dir: Kd(aim(Math.sign(rw.at[1]) * 44, 6)), switch: "runwayTurnoff", gate: "gear", ...LAMPS.runwayTurnoff });
    lamp({ id: "bayNose", part: "nose.fdfloor", group: "pitch", at: K([4.2, 0, 4.85]), dir: [0, 0, -1], switch: "gearBay", ...LAMPS.gearBay });
    for (const cn of L.camera.filter((c) => c.id.startsWith("camNose"))) {
      const side = Math.sign(cn.at[1]);
      lamp({ id: cn.id, part: `nose.baywall.${side < 0 ? "l" : "r"}`, group: "pitch", at: K(cn.at), dir: Kd(sub([5.2, 0, 0], cn.at)), switch: "camera", ...LAMPS.camera });
    }
  }
  return { lights, lamps };
}

/**
 * Every beacon's flash envelope, from the model (M.LIGHTS.flash.beacon: on for `on` s, falling 1 -> 0.7, then off):
 * an LED's quick rise, a hold to the model's off time, and a fast fall (tau 0.03 s). flashTrain's hold form.
 */
export function beaconFlashOf(M) {
  const B = M.LIGHTS.flash.beacon;
  const rise = 0.04;
  return { period: B.periodS, offsets: [0], rise, hold: Math.max(0.01, B.on - rise), fall: 0.03, phase: B.offsetS };
}

/** Where the scaffold's stub beacons stand (stubs.mjs beaconMount, repeated here: modules never import stubs). */
function beaconMountOf(W, id) {
  if (id === "beaconLower") {
    const x = W.LIGHT_AT.beaconLower[0];
    const za = Math.min(...W.FAIRING.half(22.5).map((p) => p[1]));
    const zb = Math.min(...W.FAIRING.half(25).map((p) => p[1]));
    const slope = (zb - za) / 2.5;
    const base = [x, 0, za + slope * (x - 22.5)];
    const n = unit([slope, 0, -1]);
    return { base, n, tip: add(base, mul(n, 0.18)) };
  }
  const at = W.LIGHT_AT[id];
  const side = Math.sign(at[1]);
  const f = W.facetLine(at[0], [13, 14], side);
  const s = (Math.abs(at[1]) - Math.abs(f.a[0])) / (Math.abs(f.b[0]) - Math.abs(f.a[0]));
  const base = [at[0], f.a[0] + (f.b[0] - f.a[0]) * s, f.a[1] + (f.b[1] - f.a[1]) * s];
  const n = [0, f.n[0], f.n[1]];
  return { base, n, tip: add(base, mul(n, 0.2)) };
}

// --------------------------------------------------------------------------------------------- geometry for GL
/** The window rows and doorways on every window-bearing piece (DESIGN §6.2: 218 windows, 19 doorways). */
export function windowParts(W, M) {
  const out = new Map();
  const entry = (name) => {
    if (!out.has(name)) {
      const piece = W.SHELL.find((p) => p.name === name);
      out.set(name, { name, group: piece.group, rows: [], doors: [] });
    }
    return out.get(name);
  };
  const S = M.WINDOWS.size;
  [["main", M.WINDOWS.mainZ], ["upper", M.WINDOWS.upperZ]].forEach(([deck, z], di) => {
    const byPart = new Map();
    for (const x of M.WINDOWS[deck])
      for (const side of [-1, 1]) {
        const p = W.partAt(x, z, side);
        const key = p.name;
        if (!byPart.has(key)) byPart.set(key, { xs: new Set(), sides: new Set() });
        byPart.get(key).xs.add(x);
        byPart.get(key).sides.add(side);
      }
    for (const [name, v] of byPart) {
      const piece = W.SHELL.find((p) => p.name === name);
      const side = piece.clip.side ?? 0;
      const xs = [...v.xs].map((x) => W.PIVOT_X - x).sort((a, b) => a - b);
      // the blinds the fallback draws (W.windowBlind), by the window's index in the row and the side
      const blinds = [];
      xs.forEach((kx, k) => {
        const g = M.WINDOWS[deck].findIndex((x) => Math.abs(W.PIVOT_X - x - kx) < 1e-6);
        for (const sd of side ? [side] : [-1, 1]) if (W.windowBlind(deck, g, sd)) blinds.push([k, sd]);
      });
      entry(name).rows.push({ id: di * 10 + entry(name).rows.length, deck, z, xs, side, w: S.width, h: S.height, r: 0.07, pitch: M.WINDOWS.pitch, blinds });
    }
  });
  const ids = M.DOOR_IDS;
  for (const O of doorOpenings(W, M)) {
    const p = W.partAt(O.d.x, O.cargo ? O.d.sillZ + O.d.height / 2 : O.d.sillZ + 1.0, O.side);
    entry(p.name).doors.push({ id: O.d.id, slot: ids.indexOf(O.d.id), x: W.PIVOT_X - O.d.x, z: O.d.sillZ + O.d.height / 2, hw: O.hw, hh: O.d.height / 2, s: O.s, hs: O.hs, r: O.r, sig: O.sig, band: O.band, side: O.side, cargo: O.cargo });
  }
  return [...out.values()];
}

/**
 * Every doorway's opening exactly as skin.mjs cuts it (review fu-1: the GL and fallback openings were rounded rects in
 * (x, z), the skin's are in (x, σ), σ the section's arc length, so on the sloped facets of the upper deck and in the nose
 * and tail tapers the light's ceiling stood 0.19-0.26 m above the opening, a cream tab on the outer skin), inset half a
 * stroke (0.04 m) to end at the opening's inner edge (webgl.md 8.6). Passenger doors: σ from the sill up the door's
 * height, the door's width, corner .2; cargo doors: 0.03 m inside the sill and head, 0.06 m narrower, corner .2; bulk:
 * the sill up the height, corner .14. Each: { d, side, cargo, s (centre σ), hs, hw, r, band (the cabin strips' depth in
 * σ, .3 m less the inset), sig: [[z, σ]] the section's breakpoints at the door's station (σ linear in z on each facet) }.
 */
export function doorOpenings(W, M) {
  const G = geom(W);
  const inset = 0.04;
  const out = [];
  const add = (d, side, cargo, s0, s1, width, r) => {
    const ring = W.ring2(d.x);
    // the facets the opening (and 0.3 m round it) crosses
    const sig = [];
    for (let i = 0; i <= 15; i++) if (G.SIG[i + 1] >= s0 - 0.3 && G.SIG[i] <= s1 + 0.3 && i < 15) sig.push([ring[i][1], G.SIG[i]], [ring[i + 1][1], G.SIG[i + 1]]);
    const pts = sig.filter((q, k) => !k || Math.abs(q[0] - sig[k - 1][0]) > 1e-9);
    out.push({ d, side, cargo, s: (s0 + s1) / 2, hs: (s1 - s0) / 2 - inset, hw: width / 2 - inset, r: r - inset, band: 0.3 - inset, sig: pts, G });
  };
  for (const d of M.DOORS.passenger) {
    const s0 = G.sigmaOf(d.x, d.sillZ);
    add(d, d.side === "L" ? -1 : 1, false, s0, s0 + d.height, d.width, 0.2);
  }
  for (const d of M.DOORS.cargo) {
    const side = d.side === "L" ? -1 : 1;
    if (d.id === "BULK") {
      const s0 = G.sigmaOf(d.x, d.sillZ);
      add(d, side, true, s0, s0 + d.height, d.width, 0.14);
    } else add(d, side, true, G.sigmaOf(d.x, d.sillZ) + 0.03, G.sigmaOf(d.x, d.sillZ + d.height) - 0.03, d.width - 0.06, 0.2);
  }
  return out;
}

/**
 * A shell piece's half-spaces from W.loft through glslFrustumPolygon (kit metres), compared with the built
 * part's faces: { loft, match, why }. Every loft plane must be a face plane and every face plane a loft plane
 * (normals within 1e-5, offsets within 1 mm).
 */
export function loftPlanes(W, name, part) {
  const spec = W.loft(name);
  const rings = spec.rings.map((r) => r.map((p) => p.map((v) => v * KM)));
  const flats = (spec.flats ?? []).map((fl) => ({ n: fl.n, d: fl.d * KM }));
  const loft = SH.glslFrustumPolygon(`chk`, rings, flats).planes;
  const faces = SH.planesOfHull(part);
  const same = (a, b) => a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2] > 1 - 1e-5 && Math.abs(a.d - b.d) < 1e-3;
  const extraLoft = loft.filter((a) => !faces.some((b) => same(a, b)));
  const extraFace = faces.filter((a) => !loft.some((b) => same(a, b)));
  // a loft plane the hull merged away is harmless only if it never cuts the hull: test the hull's points
  const cuts = extraLoft.filter((h) => part.world.points.some((p) => (h.n[0] * p[0] + h.n[1] * p[1] + h.n[2] * p[2]) * KM > h.d + 1e-4));
  const match = !cuts.length && !extraFace.length;
  // the loft planes that bound the piece (each one a face of the built hull; the redundant ones dropped)
  return { loft: loft.filter((a) => faces.some((b) => same(a, b))), match, why: `${cuts.length} loft planes cut the hull, ${extraFace.length} faces missing from the loft` };
}

/** The model's cockpit panes in the form the shader tests: starboard front polygons [y, z], kit-metre x ranges. */
export function panesOf(W, M) {
  return M.WINDOWS.cockpit.panes.map((p) => ({ id: p.id, poly: p.front.map(([y, z]) => [y, z]), x: [W.PIVOT_X - p.x[1], W.PIVOT_X - p.x[0]], inset: 0.03, front: p.front, xm: p.x }));
}

/** 3D points of a pane on the canopy loft (for its fallback plane): each front vertex at the x where the loft reaches it. */
function paneOnLoft(W, pane, side) {
  const half = (x, z) => {
    const r = W.ring2(x);
    let best = 0;
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      if ((a[1] - z) * (b[1] - z) > 0 || Math.abs(b[1] - a[1]) < 1e-9) continue;
      const t = (z - a[1]) / (b[1] - a[1]);
      best = Math.max(best, Math.abs(a[0] + (b[0] - a[0]) * t));
    }
    return best;
  };
  return pane.front.map(([y, z]) => {
    let lo = Math.max(1.9, pane.xm[0] - 0.4);
    let hi = Math.min(5.6, pane.xm[1] + 0.4);
    if (half(lo, z) > y) return [lo, side * y, z];
    if (half(hi, z) < y) return [hi, side * y, z];
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (half(mid, z) < y) lo = mid;
      else hi = mid;
    }
    return [Math.min(pane.xm[1], Math.max(pane.xm[0], (lo + hi) / 2)), side * y, z];
  });
}

/** The 8 displays (DESIGN §5.8; M7 builds the panel): kit-metre rects for the shader. */
export function displaysOf(W) {
  const F = FLIGHT_DECK;
  const X = W.PIVOT_X - F.panelX;
  const [w, h] = F.display;
  const main = F.main.map((d) => ({ id: d.id, c: [X - 0.004, d.y, d.z], u: [0, 1, 0], v: [0, 0, 1], n: [-1, 0, 0], w, h, kind: d.kind }));
  const t = F.pedestalTilt * D2R;
  const n = [-Math.sin(t) * 0 - Math.cos(t), 0, Math.sin(t)];
  const nn = unit([-Math.cos(t), 0, Math.sin(t)]);
  const v = unit(cross([0, 1, 0], nn)).map((x) => -x);
  void n;
  const ped = F.pedestal.map((d) => ({ id: d.id, c: [W.PIVOT_X - d.x, d.y, d.z], u: [0, 1, 0], v: v[2] < 0 ? v.map((x) => -x) : v, n: nn, w, h, kind: d.kind }));
  return { panel: { X, half: F.panelHalf, displays: F.main.map((d) => ({ y: d.y, z: d.z, w, h, kind: d.kind })) }, displays: [...main, ...ped] };
}

/** Airframe proxies for the beams' and haze's split (GL.md 4.4), grown 0.25 m: half-space sets, kit metres. */
function proxies(W, M) {
  const km = (p) => [W.PIVOT_X - p[0], p[1], p[2]];
  const list = [];
  const barrel = [];
  for (const x of [0.4, 14, 46.5, 69.4]) for (const [y, z] of W.ring2(Math.min(46.5, Math.max(14, x)))) barrel.push(km([x, y, z]));
  list.push({ name: "pxBarrel", planes: SH.planesOfPoints(barrel, convexHull3, 0.25) });
  for (const [s, side] of W.SIDES) {
    // each section thinned to every 4th point plus its leading and trailing edges and its top and bottom (follow-up
    // item 34: the full sections gave 72 planes a wing, which alone cost about 100 ms of the volumes and ground
    // programs' compile); the thinned hull is grown by whatever the full sections reach past it, so it still holds
    // the whole wing, 0.25 m clear
    const pts = [];
    const all = [];
    for (const y of [4.45, 13.88, 25.75, 39.875]) {
      const sec = W.wingSection(side * y).map(km);
      all.push(...sec);
      const pick = new Set(sec.map((_, i) => i).filter((i) => i % 4 === 0));
      for (const axis of [0, 2]) {
        let lo = 0;
        let hi = 0;
        sec.forEach((p, i) => {
          if (p[axis] < sec[lo][axis]) lo = i;
          if (p[axis] > sec[hi][axis]) hi = i;
        });
        pick.add(lo).add(hi);
      }
      for (const i of pick) pts.push(sec[i]);
    }
    const thin = SH.planesOfPoints(pts, convexHull3, 0);
    const past = Math.max(0, ...all.map((p) => Math.max(...thin.map((h) => h.n[0] * p[0] + h.n[1] * p[1] + h.n[2] * p[2] - h.d))));
    list.push({ name: `pxWing${s}`, planes: thin.map((h) => ({ n: h.n, d: h.d + past + 0.25 })) });
  }
  const E = M.EMPENNAGE;
  const fin = [];
  for (const [x0, c, z] of [[E.fin.rootLE[0], E.fin.rootChord, 9.6], [E.fin.tipLE[0], E.fin.tipChord, E.fin.tipLE[2]]]) for (const [dx, dy] of [[0, 0], [0.3 * c, 0.05 * c], [0.3 * c, -0.05 * c], [c + 2.6, 0]]) fin.push(km([x0 + dx, dy, z]));
  list.push({ name: "pxFin", planes: SH.planesOfPoints(fin, convexHull3, 0.25) });
  for (const [s, side] of W.SIDES) {
    const tp = E.tailplane;
    const pts = [];
    for (const [x, y, z, c] of [[58.1, 2.4, tp.rootZ, 9.0], [tp.tipLE[0], tp.tipLE[1], tp.tipZ, tp.tipChord]]) for (const [dx, dz] of [[0, 0.35], [0, -0.35], [c, 0.1], [c, -0.1]]) pts.push(km([x + dx, side * y, z + dz]));
    list.push({ name: `pxTail${s}`, planes: SH.planesOfPoints(pts, convexHull3, 0.25) });
  }
  const cyl = W.NACELLE.map((N) => ({ y: N.y, z: N.cz, r: 1.94 + 0.25, x0: W.PIVOT_X - N.lip - 8.39 - 0.25, x1: W.PIVOT_X - N.lip + 0.25 }));
  return { list, cyl };
}

// the proxies' hulls in one plane table and loop (follow-up item 34: a clip unrolled per plane cost about 100 ms of
// compile in each of the volumes and ground programs), then the nacelle cylinders
function proxyGlsl(px) {
  const f = SH.glsl.f;
  const v2 = SH.glsl.v2;
  const terms = px.cyl.map((c) => `s=slabX(o,d,${f(c.x0)},${f(c.x1)},cylX(o,d,${v2([c.y, c.z])},${f(c.r)}));if(s.x<s.y)t=max(t,s.y);`);
  return `${SH.glslConvexTable("airHulls", px.list)}
float airT(vec3 o,vec3 d){float t=airHulls(o,d);vec2 s;
  ${terms.join("\n  ")}
  return t;}`;
}

/** Heat haze plumes (GL.md 7.6): behind each core nozzle and the APU exhaust, kit metres. */
function plumes(W, M) {
  const list = W.NACELLE.map((N) => ({ y: N.y, z: N.cz, x: W.PIVOT_X - (N.lip + 6.93), r0: 0.9, spread: 0.06, length: 20, flow: 9 }));
  const apu = M.EMPENNAGE.apu.exhaust;
  list.push({ y: apu[1], z: apu[2], x: W.PIVOT_X - apu[0], r0: 0.3, spread: 0.05, length: 8, flow: 6 });
  return list;
}

// --------------------------------------------------------------------------------------------- groups, build
export function groups(ctx) {
  void ctx;
}

export function build(ctx) {
  const { W, M, P } = ctx;
  const f = SH.glsl.f;
  const v3 = SH.glsl.v3;
  const report = [];
  const page = { light: LIGHT_THEME ? 1 : 0, windows: [], cockpit: null, engines: [], washes: [], slots: WASH_SLOTS, nLamps: N_LAMPS, lamps: LAMPS, plumes: [], fallbacks: {}, doorIds: M.DOOR_IDS, fan: FAN, platter: W.STAGE.glWindow, beaconFlash: beaconFlashOf(M) };

  // ---- stand-ins for the stubbed modules (the real modules register their own; DESIGN §9)
  const stand = standIns(ctx);
  for (const L of stand.lights) ctx.light(L);
  for (const L of stand.lamps) ctx.lamp(L);
  report.push(`stand-ins: ${stand.lights.length} lights, ${stand.lamps.length} lamps for ${["wings", "tail", "skin", "engines", "gear", "cabin"].filter((m) => ctx.stubbed(m)).join(", ") || "none"}`);

  // ---- windows: one pass per window-bearing piece (its own faces), rows and doorways from W and the model
  const wparts = windowParts(W, M);
  const winFns = [];
  let frustumOk = 0;
  wparts.forEach((wp, k) => {
    const part = ctx.part(wp.name);
    if (!part) throw new Error(`M8: window piece ${wp.name} was not built`);
    const fn = `win${k}`;
    // the piece's surface: glslFrustumPolygon over W.loft's rings and clip flats (homothetic nose and tail rings,
    // S0 on the barrel, the belt strips), checked against the built part's own faces; the faces win a mismatch
    const planes = loftPlanes(W, wp.name, part);
    if (planes.match) frustumOk++;
    else report.push(`windows: ${wp.name} loft planes differ from its faces (${planes.why}); using the faces`);
    // the piece's own x range (kit metres): its window ink stops at its joints (a tan tick ran down every joint)
    const shell = W.SHELL.find((p) => p.name === wp.name);
    const xr = [W.PIVOT_X - shell.x[1], W.PIVOT_X - shell.x[0]];
    winFns.push(SH.glslWindowPart(fn, { planes: planes.match ? planes.loft : SH.planesOfHull(part), rows: wp.rows, doors: wp.doors, xr }, SURF));
    // scissor bands: each row's two ends on each side's skin, and each doorway's centre, with the reach of
    // their ink (half the window height plus the 0.55 m glow; a doorway's half diagonal), kit units
    const onSkin = (x, z, side) => W.kit(W.facetFrame(x, z, side).o).map((v) => Math.round(v * 100) / 100);
    const bands = [];
    for (const r of wp.rows)
      for (const side of r.side ? [r.side] : [-1, 1]) {
        const xs = r.xs.map((xk) => W.PIVOT_X - xk);
        bands.push({ a: onSkin(Math.min(...xs) - 0.2, r.z, side), b: onSkin(Math.max(...xs) + 0.2, r.z, side), r: W.m(r.h / 2 + 0.62) });
      }
    for (const dw of wp.doors) {
      const x = W.PIVOT_X - dw.x;
      const c = onSkin(x, dw.z, dw.side);
      bands.push({ a: c, b: c, r: W.m(Math.hypot(dw.hw, dw.hh) + 0.15) });
    }
    page.windows.push({ pass: k, part: wp.name, group: wp.group, rows: wp.rows.reduce((a, r) => a + r.xs.length * (r.side ? 1 : 2), 0), doors: wp.doors.map((d) => d.id), bands });
  });
  const nWin = page.windows.reduce((a, w) => a + w.rows, 0);
  const nDoor = page.windows.reduce((a, w) => a + w.doors.length, 0);
  report.push(`windows: ${nWin} windows and ${nDoor} doorways on ${wparts.length} pieces; glslFrustumPolygon matches the built faces on ${frustumOk}`);
  const COMMON = `${SH.GLSL_COMMON}${SH.GLSL_MASK}`;
  // split into chunks of whole pieces (follow-up item 34): one program held all 19 pieces and took 0.7-0.9 s to compile
  const WINDOWS = chunksOf(winFns, CHUNK_BUDGET).map(({ from, to }) => ({
    from,
    to,
    fragment: `${COMMON}${glslPose("G")}
uniform vec4 uDoors[5];
uniform vec4 uCabin;
${winFns.slice(from, to).join("\n")}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  vec3 o=toG(rayOf(vb))*${f(KM)};vec3 d=normalize(dirToG(towardViewer()));
  vec4 ink=vec4(0.);
  ${winFns.slice(from, to).map((_, j) => `${j ? "else " : ""}if(uPass<${f(from + j + 0.5)})ink=win${from + j}(o,d,uCabin.x,uCabin.y);`).join("\n  ")}
  gl_FragColor=finish(ink*visibleOf(uTarget)*uFirst*edgeFade(vb));
}`,
  }));
  WINDOWS.forEach((c, i) => ctx.glEffect({ id: `windows.${i}`, family: "windows", chunk: [c.from, c.to], canvas: "air", fragment: c.fragment, uniforms: ["uGX", "uGY", "uGZ", "uGT", "uDoors", "uCabin", "uPass", "uTarget", "uMaskInfo", "uFirst", "uNoDither"] }));

  // ---- cockpit: panes on the canopy (cut.fd) with the panel behind them; the lifted displays (cockpit group)
  const canopy = ctx.part("nose.canopy");
  if (!canopy) throw new Error("M8: nose.canopy was not built");
  const panes = panesOf(W, M);
  const deck = displaysOf(W);
  // two programs (follow-up item 34): the registration-driven passes the page draws (2: one pane, 3: one display; id
  // "cockpit", which the cabin's display fallback looks for) and the build-constant ones (0: every pane, 1: every
  // display) kept for a build without M2's or M7's targets; one program held both and took 160 ms to compile
  const COCKPIT_GLSL = SH.glslCockpit({ canopy: SH.planesOfHull(canopy), panes, panel: deck.panel, displays: deck.displays }, SURF);
  const cockpitOf = (call) => `${COMMON}${glslPose("G")}
uniform vec4 uCk;
${COCKPIT_GLSL}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  vec3 o=toG(rayOf(vb))*${f(KM)};vec3 d=normalize(dirToG(towardViewer()));
  vec4 ink=${call};
  gl_FragColor=finish(ink*visibleOf(uTarget)*uFirst*edgeFade(vb));
}`;
  const COCKPIT = cockpitOf("uPass<2.5?cockpitPaneU(o,d,uCk.x):cockpitDisplayU(o,d,uCk.y)");
  const COCKPIT_ALL = cockpitOf("uPass<.5?cockpitPanes(o,d,uCk.x):cockpitDisplays(o,d,uCk.y)");
  const ckUniforms = ["uGX", "uGY", "uGZ", "uGT", "uCk", "uPO", "uPU", "uPV", "uPN", "uPoly", "uPInfo", "uPass", "uTarget", "uMaskInfo", "uFirst", "uNoDither"];
  ctx.glEffect({ id: "cockpit", family: "cockpit", chunk: [2, 4], canvas: "air", fragment: COCKPIT, uniforms: ckUniforms });
  ctx.glEffect({ id: "cockpit.all", family: "cockpit", chunk: [0, 2], canvas: "air", fragment: COCKPIT_ALL, uniforms: ckUniforms });
  page.cockpit = { part: "nose.canopy", group: "cut.fd", panes: panes.length, displays: deck.displays.map((d) => d.id) };

  // ---- engines: inlet, fan and spinner per nacelle (the lip's front cap), from W.NACELLE and M4's FAN
  const sense = (() => {
    const o = W.kit([22.23, 14.8, 3.005]);
    const S = (p) => W.project(W.poseOf(p, { turn: 40 }), P);
    const s0 = S(o);
    const su = S([o[0], o[1] + 10, o[2]]);
    const sv = S([o[0], o[1], o[2] + 10]);
    return (su[0] - s0[0]) * (sv[1] - s0[1]) - (su[1] - s0[1]) * (sv[0] - s0[0]) > 0 ? 1 : -1;
  })();
  const engFns = W.NACELLE.map((N, i) => {
    const e = { y: N.y, z: N.cz, xl: W.PIVOT_X - N.lip, len: 8.39, rn: 1.94, ri: FAN.ri, depth: FAN.depth, rs: FAN.rs, ls: FAN.ls, blades: FAN.blades, twist: FAN.twist, slit: FAN.slit, spiral: FAN.spiral };
    page.engines.push({ i, n: N.id, part: `eng.${N.id}.lip`, at: W.kit([N.lip, N.y, N.cz]), r: 1.94, sense });
    return SH.glslNacelle(i, e);
  });
  const ENGINES = `${COMMON}${glslPose("Plane")}
${engFns.join("\n")}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  vec3 o=toPlane(rayOf(vb))*${f(KM)};vec3 d=normalize(dirToPlane(towardViewer()));
  vec4 ink=vec4(0.);
  ${W.NACELLE.map((_, i) => `${i ? "else " : ""}if(uPass<${f(i + 0.5)})ink=engine${i}(o,d);`).join("\n  ")}
  gl_FragColor=finish(ink*visibleOf(uTarget)*uFirst*edgeFade(vb));
}`;
  ctx.glEffect({ id: "engines", canvas: "air", fragment: ENGINES, uniforms: ["uPlaneX", "uPlaneY", "uPlaneZ", "uPlaneT", ...W.NACELLE.flatMap((_, i) => [`uRun${i}`, `uGain${i}`]), "uPass", "uTarget", "uMaskInfo", "uFirst", "uNoDither"] });

  // ---- washes: logo on the fin pieces (by day a warm darkening of the fin's paint, cap .3, gain 3, R > G > B), wing
  // scan on the outer box tops and slats, engine scan on the cowls
  const washTargets = [];
  // the fin, its rudders and the dorsal fillet: the logo is painted across fin and rudder, so the wash crosses the hinge
  const finParts = ["tail.fin.lo", "tail.fin.up", "tail.fin", "tail.rudder.lo", "tail.rudder.up", "tail.dorsal"].filter((n) => ctx.part(n));
  // by daylight too: a warm paper tint (cap .18, gain 3: a tint near .1 reads grey on white paint), so the Logo switch
  // shows on the light page
  // review round 3: by daylight a multiply-like warm tint of the fin's own grey, tonemapped (no flat slab at a cap)
  for (const name of finParts) washTargets.push({ name, kind: "logo", slots: WASH_SLOTS.logo, colours: { dark: SH.inkU("logo"), cap: LIGHT_THEME ? 0.3 : 0, paperGain: 3, mul: SH.inkU("logo") } });
  for (const name of scanTargetNames(ctx, W)) washTargets.push({ name, kind: "scan", slots: [...WASH_SLOTS.wing, ...WASH_SLOTS.engine], colours: { dark: SH.inkU("scan"), tint: SH.inkU("scan"), cap: 0.15 } });
  const washFns = washTargets.map((t, k) => {
    const part = ctx.part(t.name);
    let target;
    if (part.kind === "hull") target = { hull: SH.planesOfHull(part) };
    else if (part.kind === "round") {
      const Wd = part.world;
      const a = unit(Wd.F.a);
      let u = Wd.F.u ? sub(Wd.F.u, mul(a, dot(Wd.F.u, a))) : [0, 0, 1];
      u = unit(u);
      const v = cross(a, u);
      target = { cone: { c: mul(Wd.F.o, KM), a, u, v, s0: Wd.s0 * KM, s1: Wd.s1 * KM, r0: Wd.r0 * KM, r1: Wd.r1 * KM } };
    } else return null;
    page.washes.push({ pass: k, part: t.name, group: part.group.name ?? "pitch", kind: t.kind });
    return SH.glslWash(`wash${k}`, target, t.slots, t.colours);
  });
  // split into chunks of whole targets (follow-up item 34: one program of 35 targets took 0.7 s to compile)
  const WASHES = chunksOf(washFns.map((s) => s ?? ""), CHUNK_BUDGET).map(({ from, to }) => ({
    from,
    to,
    fragment: `${COMMON}${glslPose("G")}
uniform vec3 uWS[6];
uniform vec3 uWD[6];
uniform vec4 uWC[6];
${washFns.slice(from, to).filter(Boolean).join("\n")}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  vec3 o=toG(rayOf(vb))*${f(KM)};vec3 d=normalize(dirToG(towardViewer()));
  vec4 ink=vec4(0.);
  ${washFns
    .slice(from, to)
    .map((s, j) => (s ? from + j : -1))
    .filter((k) => k >= 0)
    .map((k, j) => `${j ? "else " : ""}if(uPass<${f(k + 0.5)})ink=wash${k}(o,d);`)
    .join("\n  ")}
  gl_FragColor=finish(ink*visibleOf(uTarget)*uFirst*edgeFade(vb));
}`,
  }));
  WASHES.forEach((c, i) => ctx.glEffect({ id: `washes.${i}`, family: "washes", chunk: [c.from, c.to], canvas: "air", fragment: c.fragment, uniforms: ["uGX", "uGY", "uGZ", "uGT", "uWS", "uWD", "uWC", "uPass", "uTarget", "uMaskInfo", "uFirst", "uNoDither"] }));
  report.push(`washes: ${washTargets.length} targets (${washTargets.filter((t) => t.kind === "logo").length} logo)`);

  // ---- lights: one pass per point light and per lamp lens (the `points` kind; id "lights")
  const LIGHTS_GL = `${COMMON}${SH.GLSL_POINT}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  gl_FragColor=finish(pointInk(vb)*uFirst*edgeFade(vb));
}`;
  ctx.glEffect({ id: "lights", canvas: "air", fragment: LIGHTS_GL, uniforms: ["uPt", "uPtC", "uPtP", "uPtV", "uMaskInfo", "uFrame", "uFirst", "uNoDither"] });

  // ---- volumes: the front halves of the beams (dark only) and the heat haze (both themes)
  const px = proxies(W, M);
  const haze = plumes(W, M);
  page.plumes = haze.map((h) => ({ at: W.kit([W.PIVOT_X - (h.x - h.length / 2), h.y, h.z]), r: h.length / 2 + 2 }));
  // every plume in one table and loop (follow-up item 34: a copy of the march per plume cost about 90 ms of compile)
  const hazeGlsl = SH.glslHazeTable(haze);
  const hazeSum = (side) => `hazeSum(o,d,tAir,${side},uHaze,uApu)`;
  // fu/r2-lights: the heat haze by daylight (webgl.md 8.1 haze: a grey, lightly warm ink, alpha cap·(1 − exp(−3·hz)),
  // the haze token's daylight value), the same plume table, N1 gate and split as the dark page's (front half here on
  // the air canvas, back half on the ground canvas); its density flows aft with the noise, so it shimmers as heat
  // (cap .1 and density gain 4.5: at k 3 and cap .09 the densest plume pixel darkened the pavement 6 levels, p95 3, and
  // the plume did not read at 1x; now about 8 and 4.5 levels on the grey pavement, about 11 over a white stripe)
  const HAZE_PAPER_CAP = 0.1;
  const HAZE_PAPER_K = 4.5;
  const hazePaper = (hz) => `tintInk(${f(HAZE_PAPER_K / 1.6)}*(${hz})*${f(HAZE_PAPER_CAP)},${SH.inkU("haze")},${f(HAZE_PAPER_CAP)})`;
  page.hazePaper = HAZE_PAPER_CAP;
  // fu/r2-lights: the daylight window law's inks and the fallback's layer colours (gl/passes.js winAlphasOf)
  if (LIGHT_THEME) {
    const P = windowPaperInks();
    const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    page.winPaper = { rim: SH.GL_INKS.winRim.light, body: SH.GL_INKS.win.light, core: SH.GL_INKS.winCore.light, glass: hexRgb("#b9c3cc"), layers: { amber: hexRgb("#e1b162"), rim: P.rim.map((v) => Math.round(v * 255) / 255), core: P.core.map((v) => Math.round(v * 255) / 255) } };
  }
  if (LIGHT_THEME) {
    const VOLUMES_PAPER = `${COMMON}${glslPose("Plane")}${proxyGlsl(px)}${hazeGlsl}
uniform vec4 uHaze;
uniform float uApu;
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  vec3 o=toPlane(rayOf(vb))*${f(KM)};vec3 d=normalize(dirToPlane(towardViewer()));
  float tAir=airT(o,d);
  float hz=${hazeSum("1.")};
  if(hz<=0.){gl_FragColor=vec4(0.);return;}
  gl_FragColor=finish(${hazePaper("hz")}*uFirst*edgeFade(vb)*frameFade());
}`;
    ctx.glEffect({ id: "volumes", canvas: "air", fragment: VOLUMES_PAPER, uniforms: ["uPlaneX", "uPlaneY", "uPlaneZ", "uPlaneT", "uHaze", "uApu", "uFrame", "uFirst", "uNoDither"] });
  }
  if (!LIGHT_THEME) {
    const VOLUMES = `${COMMON}${glslPose("Plane")}${proxyGlsl(px)}${hazeGlsl}${SH.glslLamps(N_LAMPS)}
uniform vec4 uHaze;
uniform float uApu;
uniform float uSteps;
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  vec3 p0=rayOf(vb)*${f(KM)};vec3 V=towardViewer();
  vec3 o=toPlane(rayOf(vb))*${f(KM)};vec3 d=normalize(dirToPlane(V));
  float tAir=airT(o,d);
  float air=beams(p0,V,tAir,1.,uSteps);
  float hz=${hazeSum("1.")};
  vec4 ink=glowOf(${SH.inkU("beam")}*air*.9+${SH.inkU("haze")}*.1*(1.-exp(-hz*3.)));
  gl_FragColor=finish(ink*uFirst*edgeFade(vb)*frameFade());
}`;
    ctx.glEffect({ id: "volumes", canvas: "air", fragment: VOLUMES, uniforms: ["uPlaneX", "uPlaneY", "uPlaneZ", "uPlaneT", "uLS", "uLD", "uLC", "uHaze", "uApu", "uSteps", "uFrame", "uFirst", "uNoDither"] });
  }

  // ---- ground: pools (platter-windowed), and in dark the beacon and strobe washes and the back halves
  // the pools fade to 0 over the last 1.4 m inside the platter (36.6-38.0 m), not in a rim-hugging 0.8 m: a pool that
  // met the rim at full strength read as cut by a stencil against the plinth top below it
  const [w0, w1] = [W.STAGE.glWindow[0] - 1.0, W.STAGE.glWindow[1] - 0.4];
  const GROUND = `${COMMON}${glslPose("Plane")}${proxyGlsl(px) + hazeGlsl}${SH.glslLamps(N_LAMPS)}
uniform vec4 uBeacon;
uniform vec4 uVolBox;
uniform vec4 uStrobe[3];
uniform vec4 uHaze;
uniform float uApu;
uniform float uSteps;
uniform float uWashH;
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  vec3 g=onFloor(vb,0.)*${f(KM)};
  float plat=1.-smoothstep(${f(w0)},${f(w1)},length(g.xy));
  // every ground-lit term fades with the true height (uWashH): the ground is far below once airborne
  float pool=lampPools(g)*plat*uWashH;
  ${
    LIGHT_THEME
      ? `vec4 ink=tintInk(pool*.9,${SH.inkU("pool")},.06);` + // daylight: a floodlight pool on concrete barely shows
        // fu/r2-lights: the back half of the daylight heat haze, inside its own box (as the dark page's back halves)
        `
  if((uHaze.x+uHaze.y+uHaze.z+uHaze.w+uApu>0.)&&vb.x>uVolBox.x&&vb.y>uVolBox.y&&vb.x<uVolBox.z&&vb.y<uVolBox.w){
    vec3 o=toPlane(rayOf(vb))*${f(KM)};vec3 d=normalize(dirToPlane(towardViewer()));
    float tAir=airT(o,d);
    float hz=${hazeSum("0.")};
    if(hz>0.)ink=over(${hazePaper("hz")}*frameFade(),ink);
  }`
      : `vec3 Lb=uBeacon.xyz*${f(KM)}-g;float lb=dot(Lb,Lb);
  // the lower beacon's pool: a red tint on the pavement, below the lamp pools (review fu-1: 90/(d²+1) clipped to R 247
  // under the belly, the loudest thing on the platter once a second); a wide soft law, peak about R 120 under the lens
  float rb=sqrt(lb);
  float beacon=uBeacon.w*sqrt(max(Lb.z,0.)/max(rb,1e-3))/(lb+${f(BEACON_POOL.soft)})*(1.-smoothstep(${f(BEACON_POOL.reach[0])},${f(BEACON_POOL.reach[1])},rb))*${f(BEACON_POOL.k)}*plat*uWashH;
  float flash=0.;
  for(int i=0;i<3;i++){vec4 s=uStrobe[i];if(s.w<=0.)continue;vec3 q=s.xyz*${f(KM)}-g;float d2=dot(q,q);flash+=s.w*max(q.z,0.)/sqrt(d2)/(d2+1.)*(1.-smoothstep(4.,8.,sqrt(d2)))*7.;}
  flash*=plat*uWashH;
  // review round 3: no ground term lies beyond the platter. The plinth is the edge of the world; the beam lamps'
  // true pools land 41-100 m out (DESIGN §11.7) and show only as the beams' haze in the volumes pass
  vec3 p0=rayOf(vb)*${f(KM)};vec3 V=towardViewer();
  vec3 o=toPlane(rayOf(vb))*${f(KM)};vec3 d=normalize(dirToPlane(V));
  // the back halves (proxies, beams, haze) only inside their own box: every term there reaches 0 before it
  bool vol=(uSteps>0.||uHaze.x+uHaze.y+uHaze.z+uHaze.w+uApu>0.)&&vb.x>uVolBox.x&&vb.y>uVolBox.y&&vb.x<uVolBox.z&&vb.y<uVolBox.w;
  float tAir=vol?airT(o,d):-1e9;
  float air=uSteps>0.?beams(p0,V,tAir,0.,uSteps):0.;
  float hz=vol?${hazeSum("0.")}:0.;
  // the back halves of the beams and the haze fade toward the card's frame over 40 CSS px (follow-up item 24); the pools
  // lie on the platter, inside it
  vec4 ink=glowOf(${SH.inkU("pool")}*pool+${SH.inkU("beacon")}*beacon+${SH.inkU("strobe")}*flash+(${SH.inkU("beam")}*air*.9+${SH.inkU("haze")}*.1*(1.-exp(-hz*3.)))*frameFade());`
  }
  gl_FragColor=finish(ink*uFirst*edgeFade(vb));
}`;
  ctx.glEffect({ id: "ground", canvas: "ground", fragment: GROUND, uniforms: ["uPlaneX", "uPlaneY", "uPlaneZ", "uPlaneT", "uLS", "uLD", "uLC", "uBeacon", "uVolBox", "uStrobe", "uHaze", "uApu", "uSteps", "uWashH", "uFrame", "uFirst", "uNoDither"] });

  // ---- fallbacks (DESIGN §6.3): every one a vary class, alpha = envelope × sector × (1 − glShare)
  fallbacks(ctx, page, stand, report);

  // ---- page: data, the frame hook, CSS
  const sum = (list) => list.reduce((a, c) => a + c.fragment.length, 0);
  const most = (list) => Math.max(...list.map((c) => c.fragment.length));
  page.sources = { windows: sum(WINDOWS), cockpit: COCKPIT.length, engines: ENGINES.length, washes: sum(WASHES), ground: GROUND.length };
  ctx.data("m8", page);
  ctx.script(`A3.on("frame", (fx) => A3M8.frame(fx));\nA3M8.attach(A3);`);
  ctx.css(`${SH.inkCss()}\n${CSS}\n${windowPaperCss()}\n${lensCss()}`);
  report.push(`programs: ${Object.entries(page.sources).map(([k, v]) => `${k} ${(v / 1024).toFixed(0)} KB`).join(", ")}; windows in ${WINDOWS.length} programs (largest ${(most(WINDOWS) / 1024).toFixed(0)} KB), washes in ${WASHES.length} (largest ${(most(WASHES) / 1024).toFixed(0)} KB)`);
  for (const line of report) ctx.report(line);
  void v3;
}

// --------------------------------------------------------------------------------------------- fallbacks
/** The part a light's lens is drawn on when it is painted after the housing (the GL mask's rule, gl/passes.js maskIdOf). */
export function lensPartOf(L) {
  if (L.id === "strobeTail" || L.id === "navTail") return "tail.apu.blade";
  if (L.kind === "nav" || L.kind === "strobe") {
    const p = String(L.part);
    if (p.startsWith("wings.l.")) return "wings.l.le.tip";
    if (p.startsWith("wings.r.")) return "wings.r.le.tip";
  }
  return null;
}
/**
 * A lens's fallback markup (viewBox units, centred), as the points program draws it at 1x (GLSL_POINT): the lens radius
 * rl with the GL's screen floor (1.4 GL px), the daylight glint radius gr (2.2 GL px; a GL px at 1x is 2/3 of a viewBox
 * unit on a desktop card), colour `color` (an ink role). By day (paper): the rim ink ring (the colour the shader's ink
 * lays at its rim, un-premultiplied: 1 − absorbed/a at alpha a, so it reads the same over any paint) over 1.6-2.2 gr, the
 * body to 1.05 gr and the pale core; at night: the halo as four stacked soft rings over the halo radius hs (the cover
 * .65, .4, .2, .06 at r .5, 1, 1.5, 2.2 hs, the GL's two Gaussians), the lens and its core.
 */
/** The GL pixel sizes (viewBox units per GL canvas pixel) the lens copies are drawn for: a desktop card at DPR 1.5+,
 *  at DPR 1, and a phone (gl/passes.js glPxWeights crossfades the copies by the page's own size). */
const LENS_PX = [0.672, 1.0, 1.75];
/** f4-lights: the GL pixel size of a second drawing inside copy 0, for Inspect zoom (the lens and halo floors at 0.672
 *  made a floor-sized halo there twice the GL's width); gl/passes.js crossfades the two by pv.glPxZ (classes
 *  a3-m8-zs / a3-m8-zb, no extra billboards) */
const LENS_ZOOM = 0.3;
const zoomed = (i, draw) => (i === 0 ? `<g class="a3-m8-zs">${draw(LENS_ZOOM)}</g><g class="a3-m8-zb">${draw(LENS_PX[0])}</g>` : draw(LENS_PX[i]));
function lensSvg(rlTrue, color, halo, PX = LENS_PX[0]) {
  const rl = Math.max(rlTrue, 1.4 * PX);
  const c = (x) => x.toFixed(2);
  if (LIGHT_THEME) {
    // the glint as the shader lays it by day (its radial profile, sampled in Node): a pale core to .6 gr, the rim ink's
    // band to 1.75 gr (over a coloured light's saturated body to 1.05 gr), fading out by 2.25 gr
    const gr = Math.max(rl, 2.2 * PX);
    const white = color === "white" || color === "lamp";
    return `<circle class="a3-m8-lr0 a3-m8-c-${color}" r="${c(gr * 2.25)}"/><circle class="a3-m8-lr1 a3-m8-c-${color}" r="${c(gr * 1.75)}"/>${white ? "" : `<circle class="a3-m8-lb a3-m8-c-${color}" r="${c(gr * 1.05)}"/>`}<circle class="a3-m8-lc a3-m8-c-${color}" r="${c(Math.max(gr * 0.6, rl * 0.8))}"/>`;
  }
  // the night halo (f4-lights: one radial gradient, haloSvg; the five stacked rings it replaced read as concentric steps
  // at Inspect zoom). `halo` 0: the lens alone (a flasher's halo is its own billboard, swollen with the flash)
  const rings = halo > 0 ? haloSvg(rl, color, halo, PX) : "";
  return `${rings}<circle class="a3-m8-lb a3-m8-c-${color}" r="${c(rl)}"/><circle class="a3-m8-lc a3-m8-c-${color}" r="${c(rl * 0.45)}"/>`;
}
/**
 * f4-lights: the night halo as the points program draws it (GLSL_POINT): hs = max(rl × halo, 4 GL px), cover
 * 1 − exp(−E), E = (exp(−(r/hs)²) × .55 + exp(−r/1.5hs) × .2) × tail, the tail fading over .55-1 of the reach
 * max(6 rl × halo, 12 GL px). The reach is 3 hs (floor-sized halos) or 6 hs: one gradient per colour role and reach
 * (haloDefs, in the deck's <defs>, so a display:none never hides it), filled on one circle of the reach's radius. The
 * canvas painter paints a gradient-filled circle with a canvas radial gradient (kit/canvas-painter.mjs, f4-lights).
 */
export const HALO_ROLES = ["red", "green", "white", "lamp", "blue", "amber"];
const haloReach = (rl, halo, PX) => {
  const a = rl * halo;
  const hs = Math.max(a, 4 * PX);
  return { hs, q: Math.max(6 * a, 12 * PX) / hs < 4.5 ? 3 : 6 };
};
export const haloCover = (x, q) => {
  const t = Math.min(1, Math.max(0, (x - 0.55 * q) / (0.45 * q)));
  const E = (Math.exp(-x * x) * 0.55 + Math.exp(-x / 1.5) * 0.2) * (1 - t * t * (3 - 2 * t));
  return 1 - Math.exp(-E);
};
function haloSvg(rl, color, halo, PX) {
  const { hs, q } = haloReach(rl, halo, PX);
  return `<circle class="a3-m8-lg" r="${(hs * q).toFixed(2)}" style="fill:url(#a3-m8-hg-${HALO_ROLES.includes(color) ? color : "white"}-${q})"/>`;
}
/** The halo gradients (dark pages; stage.mjs puts them in the deck's <defs>): 26 stops each, denser toward the centre,
 *  every neighbouring pair within 4/255 of cover, so no step or plateau shows (the gradient interpolates between). */
export function haloDefs() {
  if (LIGHT_THEME) return "";
  const out = [];
  for (const q of [3, 6])
    for (const role of HALO_ROLES) {
      const stops = [];
      for (let i = 0; i <= 25; i++) {
        const t = Math.pow(i / 25, 1.35);
        stops.push(`<stop offset="${t.toFixed(4)}" stop-opacity="${haloCover(t * q, q).toFixed(4)}"/>`);
      }
      out.push(`<radialGradient id="a3-m8-hg-${role}-${q}" class="a3-m8-hg-${role}">${stops.join("")}</radialGradient>`);
    }
  return out.join("");
}
/**
 * The lens inks per colour role (CSS): the body is the role's ink (dark) or, by day, the paper body the points program
 * uses (a white or lamp light: its ink 45% toward white; a coloured light: its ink); the rim rings are the rim ink as the
 * shader lays it, un-premultiplied (1 − absorbed/a at alpha a, so it reads the same over any paint), each ring's
 * fill-opacity its share of the stacked cover; the core pale.
 */
function lensCss() {
  const G = SH.GL_INKS;
  const hex = (v) => `#${v.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, "0")).join("")}`;
  const roles = ["red", "green", "white", "amber", "blue", "lamp"];
  const rules = [];
  const tokens = [];
  for (const r of roles) {
    const ink = G[r].light;
    const white = r === "white" || r === "lamp";
    const rim = white ? G.white.light : ink.map((v, i) => v * [0.62, 0.62, 0.66][i]);
    const absorbed = rim.map((v) => 1 - v);
    const a = Math.max(...absorbed);
    const rimInk = absorbed.map((v) => 1 - v / a);
    const body = white ? G.white.light.map((v) => v + (1 - v) * 0.55) : ink;
    const core = white ? [1, 1, 1] : ink.map((v) => 1 + (v - 1) * 0.15);
    tokens.push(`--a3-m8-lr-${r}:${hex(rimInk)};--a3-m8-lb-${r}:${hex(body)};--a3-m8-lc-${r}:${hex(core)}`);
    // composite cover outside-in .38a (the fade) and .9a (the band): each ring's own alpha
    let prev = 0;
    [0.38, 0.9].forEach((share, i) => {
      const target = share * a;
      const own = 1 - (1 - target) / (1 - prev);
      prev = target;
      rules.push(`.a3-m8-lr${i}.a3-m8-c-${r}{fill:var(--a3-m8-lr-${r});fill-opacity:${own.toFixed(3)}}`);
    });
    rules.push(`.a3-m8-lb.a3-m8-c-${r}{fill:var(--a3-m8-lb-${r})}`, `.a3-m8-lc.a3-m8-c-${r}{fill:var(--a3-m8-lc-${r})}`, `.a3-m8-lh.a3-m8-c-${r}{fill:var(--a3-gl-${r})}`);
  }
  const dark = roles.map((r) => `.iso[data-theme="dark"] .a3-m8-lb.a3-m8-c-${r}{fill:var(--a3-gl-${r})}`);
  return `.iso{${tokens.join(";")}}
.a3-m8-lr0,.a3-m8-lr1,.a3-m8-lb,.a3-m8-lc,.a3-m8-lh,.a3-m8-lg{stroke:none}
${HALO_ROLES.map((r) => `.a3-m8-hg-${r} stop{stop-color:var(--a3-gl-${r})}`).join("\n")}
${rules.join("\n")}
${dark.join("\n")}
.iso[data-theme="dark"] .a3-m8-lc{fill:var(--a3-m8-core)}`;
}
/**
 * Level-set bands of a field alpha(x, y) on a plane (plane units): the field sampled over `box` [x0, y0, x1, y1] finds
 * its peak inside the convex `clip` polygon (counter-clockwise), each level's boundary is traced along 48 rays from the
 * peak (the field must be star-shaped about it, as a lamp's pool on the ground is), clipped to `clip`, and each band (the
 * region between two level sets, even-odd) is one path at its level's alpha: every pixel composited once (no drift in
 * 8-bit compositing). [] when the field stays under 2e-3.
 */
function levelBands(alphaAt, box, clip, LEVELS = 16, opts = {}) {
  // (f4-lights: opts.grid, opts.rays, opts.min: the scan wash's many small patches take a coarser trace and skip faint ones)
  const [x0, y0, x1, y1] = box;
  const step = Math.max(x1 - x0, y1 - y0) / (opts.grid ?? 120);
  const MIN = opts.min ?? 2e-3;
  const RAYS = opts.rays ?? 48;
  const inside = (x, y) => {
    for (let i = 0; i < clip.length; i++) {
      const a = clip[i];
      const b = clip[(i + 1) % clip.length];
      if ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
    }
    return true;
  };
  let peak = null;
  for (let x = x0; x <= x1; x += step)
    for (let y = y0; y <= y1; y += step) {
      if (!inside(x, y)) continue;
      const a = alphaAt(x, y);
      if (a > MIN && (!peak || a > peak[2])) peak = [x, y, a];
    }
  if (!peak) return [];
  // refine the peak on a finer grid round it
  for (let x = peak[0] - step; x <= peak[0] + step; x += step / 6)
    for (let y = peak[1] - step; y <= peak[1] + step; y += step / 6) {
      const a = inside(x, y) ? alphaAt(x, y) : 0;
      if (a > peak[2]) peak = [x, y, a];
    }
  const top = peak[2];
  const reach = Math.hypot(x1 - x0, y1 - y0);
  const fine = step / 4;
  const rays = Array.from({ length: RAYS }, (_, i) => {
    const t = (i / RAYS) * 2 * Math.PI;
    const dx = Math.cos(t);
    const dy = Math.sin(t);
    const prof = [];
    for (let r = 0; r <= reach; r += fine) {
      const a = alphaAt(peak[0] + dx * r, peak[1] + dy * r);
      prof.push([r, a]);
      if (a <= top * 0.25 / LEVELS) break;
    }
    return { dx, dy, prof };
  });
  const crossing = (ray, level) => {
    const P = ray.prof;
    for (let j = 1; j < P.length; j++) if (P[j][1] < level) return P[j - 1][0] + ((P[j - 1][1] - level) / Math.max(P[j - 1][1] - P[j][1], 1e-9)) * (P[j][0] - P[j - 1][0]);
    return P[P.length - 1][0];
  };
  const clipConvex = (poly) => {
    let out = poly;
    for (let i = 0; i < clip.length && out.length; i++) {
      const a = clip[i];
      const b = clip[(i + 1) % clip.length];
      const side = (q) => (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
      const input = out;
      out = [];
      for (let j = 0; j < input.length; j++) {
        const p = input[j];
        const q = input[(j + 1) % input.length];
        const sp = side(p);
        const sq = side(q);
        if (sp >= 0) out.push(p);
        if ((sp >= 0) !== (sq >= 0)) {
          const t = sp / (sp - sq);
          out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
        }
      }
    }
    return out;
  };
  const rings = [];
  // (f4-lights: opts.step, a fixed alpha step: neighbouring patches share their contour levels, so a band edge meets its
  // neighbour's across a patch boundary instead of stepping there)
  const STEP = opts.step ?? top / LEVELS;
  const NL = opts.step ? Math.max(1, Math.round(top / opts.step)) : LEVELS;
  for (let k = 1; k <= NL; k++) {
    const level = STEP * (k - 0.5);
    const ring = clipConvex(rays.map((ray) => {
      const r = crossing(ray, level);
      return [peak[0] + ray.dx * r, peak[1] + ray.dy * r];
    }));
    if (ring.length < 3) break;
    rings.push({ ring, alpha: STEP * k });
  }
  const pathOf = (pts) => `M${pts.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join("L")}Z`;
  return rings.map((R, i) => ({ alpha: R.alpha, d: `${pathOf(R.ring)}${rings[i + 1] ? pathOf(rings[i + 1].ring) : ""}` }));
}
/** The scan washes' targets (the GL's washes program and, f4-lights, its fallback): the outer wing box tops and slats,
 *  the nacelle lips and cowls, in that order. */
function scanTargetNames(ctx, W) {
  const out = [];
  for (const [s] of W.SIDES) for (const b of ["box.4", "box.5", "box.6", ...["2", "3", "4", "5", "6", "7"].map((n) => `slat.${n}`)]) out.push(`wings.${s}.${b}`);
  for (const N of W.NACELLE) for (const row of ["lip", "fancowl", "aftcowl"]) out.push(`eng.${N.id}.${row}`);
  return out.filter((name) => ctx.part(name));
}
function fallbacks(ctx, page, stand, report) {
  const { W, M, P } = ctx;
  const k = W.fit().k;
  const vary = (cls, key) => ctx.vary(cls, `(typeof A3M8 !== "undefined" ? A3M8.alpha(${JSON.stringify(key)}) : 0)`);
  let n = 0;
  // lamp lenses (lamps are not lights: the harness gives them no billboard). M8's own stand-in lamps, plus every
  // beam lamp of the model that a real module registers: M8 cannot read other modules' registrations at build
  // time (request 2), so it finds each one's housing by the model position (lensHosts) and fades the billboard
  // by the registered lamp's id on the page (A3M8.alpha("lamp:<id>"): 0 when no lamp of that id exists)
  // review fu-1 (webgl.md 8.5, 8.3): every lens drawn as the points program draws it (lensSvg): by day a pale body and
  // core in a ring of the rim ink (a lamp's body #e8eaee on the white skin with no rim vanished), at night the lens and
  // a halo of stacked soft rings (a flat disc read hard-edged)
  // each lens in three copies, drawn for the GL pixel sizes LENS_PX (the shader's screen floors are in GL pixels), faded
  // by the page's own GL pixel size (pv.glPxW)
  ctx.vary("a3-m8-zs", "(pv.glPxZ || 0)"); // f4-lights: the Inspect-zoom drawing's share of copy 0 (zoomed)
  ctx.vary("a3-m8-zb", "1 - (pv.glPxZ || 0)");
  const sized = (cls, key) => LENS_PX.forEach((_, i) => ctx.vary(`${cls}-x${i}`, `(typeof A3M8 !== "undefined" ? A3M8.alpha(${JSON.stringify(key)}) : 0) * ((pv.glPxW || [1, 0, 0])[${i}])`));
  const lens = (L) => {
    const part = ctx.part(L.part);
    if (!part) return;
    LENS_PX.forEach((_, i) => ctx.billboard(part, { at: L.at, normal: L.dir, fade: [0.2, 0.55], svg: `<g class="a3-m8-lens a3-m8-lens-${L.id}-x${i}" style="opacity:0">${zoomed(i, (px) => lensSvg(W.m(L.lens ?? 0.12) * k, "lamp", 3, px))}</g>` }));
    sized(`a3-m8-lens-${L.id}`, `lamp:${L.id}`);
    n++;
  };
  // the registered point lights' lenses (nav, strobes, beacons, fence and logo lenses): the harness's billboard on the
  // housing (build.mjs a3-l-<id>) gives way to these (A3M8.frame writes it 0); a light whose lens sits on a part that
  // can be painted over its housing (the wing-tip lights on the tip's leading edge, the tail lights on the APU blade:
  // LENS_ON) gets a copy on that part too, and the page shows the copy on whichever of the two is painted later (review
  // fu-1: the nav lens read as a 3 px sliver under the tip, the strobe and fence lenses at a sixth of the GL's pixels)
  let nPt = 0;
  for (const L of ctx.registeredLights ? ctx.registeredLights() : []) {
    const hosts = [L.part, lensPartOf(L)].filter((name, i, a) => name && ctx.part(name) && a.indexOf(name) === i);
    hosts.forEach((name, h) => {
      // a wing-tip strobe (outboard normal) burns full from ahead and astern too, as the GL's facing has it
      const outboard = L.kind === "strobe" && L.normal && Math.abs(L.normal[1]) > 0.9;
      const fade = outboard ? [-0.55, -0.1] : [-0.12, 0.22];
      // f4-lights: a beacon's or strobe's night halo swells with the flash as the points program's does (gl/passes.js:
      // halo × (0.8 + 1.7 flash), ×2.5 at the peak): the lens alone, then its halo at ×1 and at ×2.5 crossfaded by the
      // swell (A3M8 alpha ph: / pw:), so a flash washes the crown or the tip as the GL's does (review f3: the fallback
      // beacon read as two dots, 7.6× fewer red pixels, and the strobe flash 4× weaker)
      const swell = !LIGHT_THEME && (L.kind === "strobe" || L.kind === "beacon");
      // (the two halos nested in the lens's own billboard, each with its crossfade weight: no extra billboards)
      const halos = (px) => (swell ? [["ph", 1], ["pw", 2.5]].map(([tag, m]) => `<g class="a3-m8-${tag}-${L.id}" style="opacity:0">${haloSvg(Math.max(L.lens * k, 1.4 * px), L.color ?? "white", (L.halo ?? 3) * m, px)}</g>`).join("") : "");
      LENS_PX.forEach((_, i) => ctx.billboard(ctx.part(name), { at: L.at, normal: L.normal ?? [0, 0, 1], fade, svg: `<g class="a3-m8-pt a3-m8-pt-${L.id}-${h}-x${i}" style="opacity:0">${zoomed(i, (px) => halos(px) + lensSvg(L.lens * k, L.color ?? "white", swell ? 0 : L.halo ?? 3, px))}</g>` }));
      sized(`a3-m8-pt-${L.id}-${h}`, `pt:${L.id}:${h}`);
      if (swell && h === 0) for (const tag of ["ph", "pw"]) vary(`a3-m8-${tag}-${L.id}`, `${tag}:${L.id}`);
      nPt++;
    });
  }
  page.lensOn = Object.fromEntries((ctx.registeredLights ? ctx.registeredLights() : []).map((L) => [L.id, lensPartOf(L)]).filter(([, v]) => v));
  // (review fu-1: the registered lamps themselves, where the GL draws their lenses; before, M8 could not read them and
  // found each housing by the model position, a lens or two off the GL's)
  const beamLamps = ctx.registeredLamps ? ctx.registeredLamps().filter((L) => (L.beam ?? LAMPS[L.switch]?.beam) && L.at && L.dir) : null;
  if (beamLamps) for (const L of beamLamps) lens({ ...L, lens: L.lens ?? LAMPS[L.switch]?.lens });
  else {
    for (const L of stand.lamps) if (LAMPS[L.switch]?.beam) lens(L);
    const found = lensHosts(ctx, new Set(stand.lamps.map((L) => L.id)));
    for (const L of found) lens(L);
    if (found.length) report.push(`lens fallbacks found by model position: ${found.map((L) => `${L.id} on ${L.part} (${(L.score * 10).toFixed(0)} cm)`).join(", ")}`);
  }
  // the ground's light on the platter (deck layer, SVG on both pages), each from the shader's own law sampled here at rest
  // and drawn as level-set bands (levelBands; review fu-1: hand-placed pools read half the GL's level and 5 CSS px low,
  // and the beacon's and the strobes' ground washes had no fallback at all):
  //   - every registered lamp's pool (lampPools: power × spotE × incidence × reach / (d² + 1), the platter window), dark
  //     the screened glow 1 − exp(−e), light the tint .06(1 − exp(−1.6 × .9e / .06)); vary pool:<switch>:<id>;
  //   - dark only, as the ground program draws them: the lower beacon's pool (BEACON_POOL) and each strobe's wash, faded
  //     with the flash (vary beacon:pool and strobe:pool:<id>, gl/passes.js)
  const platter = ctx.part("stage.platter") ? "stage.platter" : null;
  const pools = [];
  const registered = ctx.registeredLamps ? ctx.registeredLamps() : stand.lamps;
  const lampLaw = (L) => {
    const def = LAMPS[L.switch] ?? {};
    const outer = typeof L.cone === "number" ? L.cone : Array.isArray(L.cone) && L.cone[0] > 1 ? L.cone[0] : L.cone && L.cone.outer ? L.cone.outer : null;
    const beam = L.beam ?? def.beam ?? false;
    const spread = L.spread ?? (outer ? [outer, beam ? Math.min(outer, def.spread?.[1] ?? 6) : outer] : null) ?? def.spread ?? [20, 20];
    return { ...L, beam, wash: L.wash ?? def.wash ?? null, tan: spread.map((a) => Math.tan((Math.min(a, 80) * Math.PI) / 180)), power: L.power ?? def.power ?? 400, reach: L.reach ?? def.reach ?? 20, S: mul(L.at, KM), D: unit(L.dir) };
  };
  const lamps = registered.filter((L) => L.at && L.dir).map(lampLaw).filter((L) => !L.wash);
  const ssJ = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const spotE = (Lv, D, t) => {
    const ld = dot(Lv, D);
    if (ld <= 1e-4) return 0;
    const H = Math.abs(D[2]) > 0.95 ? [1, 0, 0] : unit(cross(D, [0, 0, 1]));
    const U = cross(H, D);
    return 1 - ssJ(0.45, 1, Math.hypot(dot(Lv, H) / (ld * t[0]), dot(Lv, U) / (ld * t[1])));
  };
  const [w0, w1] = [W.STAGE.glWindow[0] - 1.0, W.STAGE.glWindow[1] - 0.4];
  const plat = (x, y) => 1 - ssJ(w0, w1, Math.hypot(x, y) * KM);
  const R0 = W.m(W.STAGE.glWindow[1]) - 0.5;
  const disc = Array.from({ length: 72 }, (_, i) => [R0 * Math.cos((i / 72) * 2 * Math.PI), R0 * Math.sin((i / 72) * 2 * Math.PI)]);
  const groundBox = [-R0, -R0, R0, R0];
  if (platter) {
    for (const L of lamps) {
      const energy = (x, y) => {
        const g = [x * KM, y * KM, 0];
        const Lv = sub(g, L.S);
        const d = Math.hypot(...Lv);
        const n = mul(Lv, 1 / Math.max(d, 1e-4));
        return (L.power * spotE(n, L.D, L.tan) * Math.max(-n[2], 0) * (1 - ssJ(L.reach * 0.55, L.reach, d))) / (d * d + 1);
      };
      const alphaAt = (x, y) => {
        const e = energy(x, y) * plat(x, y);
        return LIGHT_THEME ? 0.06 * (1 - Math.exp((-1.6 * e * 0.9) / 0.06)) : 1 - Math.exp(-e);
      };
      const bands = levelBands(alphaAt, groundBox, disc, 32);
      if (!bands.length) continue;
      pools.push(`<g class="a3-m8-pool a3-m8-pool-${L.id}" style="opacity:0">${bands.map((b) => `<path style="fill-opacity:${b.alpha.toFixed(4)};fill-rule:evenodd" d="${b.d}"/>`).join("")}</g>`);
      vary(`a3-m8-pool-${L.id}`, `pool:${L.switch}:${L.id}`);
    }
    if (!LIGHT_THEME) {
      const lights = ctx.registeredLights ? ctx.registeredLights() : stand.lights;
      const lower = lights.find((L) => L.kind === "beacon" && L.normal && L.normal[2] < -0.5);
      if (lower) {
        const S = mul(lower.at, KM);
        const alphaAt = (x, y) => {
          const Lb = sub(S, [x * KM, y * KM, 0]);
          const lb = dot(Lb, Lb);
          const rb = Math.sqrt(lb);
          const e = (Math.sqrt(Math.max(Lb[2], 0) / Math.max(rb, 1e-3)) / (lb + BEACON_POOL.soft)) * (1 - ssJ(BEACON_POOL.reach[0], BEACON_POOL.reach[1], rb)) * BEACON_POOL.k * plat(x, y);
          return 1 - Math.exp(-e);
        };
        const bands = levelBands(alphaAt, groundBox, disc, 32);
        if (bands.length) {
          pools.push(`<g class="a3-m8-bpool" style="opacity:0">${bands.map((b) => `<path style="fill-opacity:${b.alpha.toFixed(4)};fill-rule:evenodd" d="${b.d}"/>`).join("")}</g>`);
          vary("a3-m8-bpool", "beacon:pool");
        }
      }
      for (const L of lights.filter((q) => q.kind === "strobe")) {
        const S = mul(L.at, KM);
        const alphaAt = (x, y) => {
          const q = sub(S, [x * KM, y * KM, 0]);
          const d2 = dot(q, q);
          const d = Math.sqrt(d2);
          const e = ((Math.max(q[2], 0) / Math.max(d, 1e-3) / (d2 + 1)) * (1 - ssJ(4, 8, d)) * 7 * plat(x, y));
          return 1 - Math.exp(-e);
        };
        const bands = levelBands(alphaAt, groundBox, disc, 12);
        if (!bands.length) continue;
        pools.push(`<g class="a3-m8-spool a3-m8-spool-${L.id}" style="opacity:0">${bands.map((b) => `<path style="fill-opacity:${b.alpha.toFixed(4)};fill-rule:evenodd" d="${b.d}"/>`).join("")}</g>`);
        vary(`a3-m8-spool-${L.id}`, `strobe:pool:${L.id}`);
      }
    }
    ctx.planeOn(platter, { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1], fade: [-1, -0.9], svg: pools.join("") });
  }
  // dark: each beam lamp's shaft (the volumes and ground programs' beams), a fan of level-set bands in the beam's own
  // level plane (its axis and its horizontal spread) on the lamp's housing, brightness from the scattering law along
  // the axis (the in-cone path over the 1/(l² + 6) falloff, ∝ l/(l² + 6)), the soft edge as an outer band at a third,
  // cut where the axis meets the ground (the GL's p.z fade) and by the reach; vary beam:<id> = level × (1 − glShare)
  let nBeam = 0;
  if (!LIGHT_THEME)
    for (const L of lamps.filter((q) => q.beam)) {
      const part = ctx.part(L.part);
      if (!part) continue;
      const D = L.D;
      let H = Math.abs(D[2]) > 0.95 ? [1, 0, 0] : unit(cross(D, [0, 0, 1]));
      if (cross(D, H)[2] < 0) H = mul(H, -1);
      const hM = L.S[2];
      const lGround = D[2] < -1e-3 ? Math.min(L.reach, hM / -D[2]) : L.reach;
      const edges = [0.3, 1, 2, 3.5, 5.5, 8, 11, 15, 20, 26, 33, 41, 50, 60].filter((l) => l < lGround);
      edges.push(lGround);
      const A = (l) => ((0.15 * (L.power / 4200) * (l / (l * l + 6))) / 0.204) * Math.exp(-l / 30) * (1 - ssJ(L.reach * 0.55, L.reach, l)) * ssJ(0, 0.15 * lGround, lGround - l);
      const quad = (l0, l1, q) => {
        const pts = [[l0, -l0 * L.tan[0] * q], [l1, -l1 * L.tan[0] * q], [l1, l1 * L.tan[0] * q], [l0, l0 * L.tan[0] * q]];
        return `M${pts.map((p) => `${W.m(p[0]).toFixed(2)} ${W.m(p[1]).toFixed(2)}`).join("L")}Z`;
      };
      const paths = [];
      for (let i = 0; i + 1 < edges.length; i++) {
        const a = A((edges[i] + edges[i + 1]) / 2);
        if (a < 2e-3) continue;
        paths.push(`<path style="fill-opacity:${a.toFixed(4)}" d="${quad(edges[i], edges[i + 1], 0.62)}"/>`);
        paths.push(`<path style="fill-opacity:${(a * 0.35).toFixed(4)};fill-rule:evenodd" d="${quad(edges[i], edges[i + 1], 0.95)}${quad(edges[i], edges[i + 1], 0.62)}"/>`);
      }
      if (!paths.length) continue;
      ctx.plane(part, { o: L.at, u: D, v: H, normal: cross(D, H), fade: [-1, -0.9], svg: `<g class="a3-m8-beam a3-m8-beam-${L.id}" style="opacity:0">${paths.join("")}</g>` });
      vary(`a3-m8-beam-${L.id}`, `beam:${L.id}`);
      nBeam++;
    }
  report.push(`ground fallbacks: ${pools.length} level-set pools and washes, ${nBeam} beam shafts`);
  const facePlane = (part, side, axis = 1) => {
    const Wd = part.world;
    let best = null;
    for (const face of Wd.faces) if (!best || face.n[axis] * side > best.n[axis] * side) best = face;
    const pts = best.ring.map((i) => Wd.points[i]);
    const c = pts.reduce((a, p) => add(a, p), [0, 0, 0]).map((x) => x / pts.length);
    return { c, n: best.n, pts };
  };
  // the logo wash's fallback (follow-up item 25; review round 3 R16, R48): the alpha the shader composites, drawn as
  // level-set bands. On every piece the GL washes (fin, rudders, dorsal fillet), per side, the logo lamps' energy with
  // the shader's law (spotAt: the lamp the tail registers, its 34° cone with half of it inner, power 15, reach 24 m,
  // incidence, 1/(d² + 1); both lamps, as both slots are summed) on the piece's own surface. The composited alpha is
  // 1 − exp(−e) in dark (the screened glow, red channel: the wash token is the ink) and .3(1 − exp(−3e)) by daylight
  // (the tint's cover), drawn in 20 levels, each the region between two level sets, clipped to the piece's side.
  // Before, one soft oval per fin piece from a stand-in lamp: 60 levels under the GL wash at its brightest (Tail view)
  {
    const L = M.LIGHTS;
    const K = (p) => r3(W.kit(p));
    const Kd = (d) => r3(W.kitDir(unit(d)));
    const logoLamps = W.SIDES.map(([s, side]) => {
      const round = ctx.part(`light.logo.${s}`);
      const aimAt = W.kit([60.6, 0, 13.0]);
      if (round && round.world && round.world.F) {
        // tail.mjs: the lens 7 cm out of the tailplane along the face normal, aimed at the fin (60.6, 0, 13.0)
        const S = add(round.world.F.o, mul(unit(round.world.F.a), W.m(0.07)));
        return { S, D: unit(sub(aimAt, S)), cos: [Math.cos(34 * D2R), Math.cos(17 * D2R)] };
      }
      // the stub tail's registration (above): at the model position, aimed at (60.5, 0, 15.2), the switch's cone
      const lg = L.logo.find((x) => Math.sign(x.at[1]) === side);
      return lg ? { S: K(lg.at), D: unit(Kd(sub([60.5, 0, 15.2], lg.at))), cos: LAMPS.logo.cone.map((c) => Math.cos(c * D2R)) } : null;
    }).filter(Boolean);
    const smoothJs = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const energyAt = (P, n) => {
      let e = 0;
      for (const T of logoLamps) {
        const Lv = mul(sub(T.S, P), KM);
        const d = Math.hypot(...Lv);
        const Ln = mul(Lv, 1 / Math.max(d, 1e-4));
        const spot = smoothJs(T.cos[0], T.cos[1], -dot(Ln, T.D));
        e += (LAMPS.logo.power * spot * Math.max(dot(n, Ln), 0) * (1 - smoothJs(LAMPS.logo.reach * 0.55, LAMPS.logo.reach, d))) / (d * d + 1);
      }
      return e;
    };
    const alphaOf = (e) => (LIGHT_THEME ? 0.3 * (1 - Math.exp(-3 * e)) : 1 - Math.exp(-e));
    // Sutherland-Hodgman: a polygon clipped by a convex one (counter-clockwise)
    const clipConvex = (poly, clip) => {
      let out = poly;
      for (let i = 0; i < clip.length && out.length; i++) {
        const a = clip[i];
        const b = clip[(i + 1) % clip.length];
        const side = (q) => (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
        const input = out;
        out = [];
        for (let j = 0; j < input.length; j++) {
          const p = input[j];
          const q = input[(j + 1) % input.length];
          const sp = side(p);
          const sq = side(q);
          if (sp >= 0) out.push(p);
          if ((sp >= 0) !== (sq >= 0)) {
            const t = sp / (sp - sq);
            out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
          }
        }
      }
      return out;
    };
    const LEVELS = 40;
    let made = false;
    const logoReport = [];
    for (const name of ["tail.fin.lo", "tail.fin.up", "tail.fin", "tail.rudder.lo", "tail.rudder.up", "tail.dorsal"]) {
      const part = ctx.part(name);
      if (!part || part.kind !== "hull" || !logoLamps.length) continue;
      for (const side of [-1, 1]) {
        const fp = facePlane(part, side);
        const n = unit(fp.n);
        const u = unit(sub([1, 0, 0], mul(n, n[0])));
        const v = unit(cross(n, u));
        // the piece's outline seen along the face normal (its convex hull in the plane): a lofted piece's most sideways
        // facet is only a strip at its thickest chord, so the wash is cut to the whole side, not to that facet
        const flat = part.world.points.map((p) => [dot(sub(p, fp.c), u), dot(sub(p, fp.c), v)]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const turn = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
        const lower = [];
        const upper = [];
        for (const q of flat) {
          while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
          lower.push(q);
        }
        for (const q of flat.slice().reverse()) {
          while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
          upper.push(q);
        }
        const poly = [...lower.slice(0, -1), ...upper.slice(0, -1)];
        const xs = poly.map((q) => q[0]);
        const ys = poly.map((q) => q[1]);
        const w = Math.max(...xs) - Math.min(...xs);
        const h = Math.max(...ys) - Math.min(...ys);
        // the plane sampled over three times the face's box (the level sets are fitted whole, then clipped)
        const step = Math.max(w, h) / 90;
        const samples = [];
        let top = 0;
        // the energy where the shader takes it: on the piece's own surface, with the normal of the facet the line of
        // sight along the face normal enters (the lofted side turns away toward its edges); off the piece, on the plane
        const faces = part.world.faces.map((F) => ({ n: F.n, d: dot(F.n, part.world.points[F.ring[0]]) }));
        const surfaceAt = (q) => {
          const o = add(q, mul(n, 1000));
          let tIn = -Infinity;
          let tOut = Infinity;
          let hit = null;
          for (const F of faces) {
            const den = -dot(F.n, n);
            const t = (F.d - dot(F.n, o)) / (Math.abs(den) > 1e-9 ? den : 1e-9);
            if (den < 0) {
              if (t > tIn) {
                tIn = t;
                hit = F;
              }
            } else tOut = Math.min(tOut, t);
          }
          return hit && tIn <= tOut ? { P: add(o, mul(n, -tIn)), n: hit.n } : null;
        };
        for (let gx = Math.min(...xs) - w; gx <= Math.max(...xs) + w; gx += step)
          for (let gy = Math.min(...ys) - h; gy <= Math.max(...ys) + h; gy += step) {
            const q = add(add(fp.c, mul(u, gx)), mul(v, gy));
            const S = surfaceAt(q);
            const a = alphaOf(S ? energyAt(S.P, S.n) : energyAt(q, n));
            if (a <= 0) continue;
            samples.push([gx, gy, a]);
          }
        // the brightest alpha on the face itself sets the levels, and the rays start there (review fu-1: from the field's
        // peak off the piece, the rudder's rays crossed a dip before reaching it, and its bands covered a strip by the
        // hinge: the wash ended at the hinge line)
        let onPeak = null;
        for (const q of samples)
          if (q[2] > top && clipConvex([[q[0], q[1]], [q[0] + 1e-3, q[1]], [q[0], q[1] + 1e-3]], poly).length) {
            top = q[2];
            onPeak = q;
          }
        if (!(top > 2e-3)) {
          logoReport.push(`${name}${side < 0 ? "L" : "R"} unlit`);
          continue;
        }
        // each level's boundary traced along 40 rays from the field's peak (the lit patch is egg-shaped, brightest
        // nearest the lamp: an ellipse fitted to it overshot its narrow end by 20 levels), then clipped to the outline
        const peak = onPeak;
        const alphaAt = (gx, gy) => {
          const q = add(add(fp.c, mul(u, gx)), mul(v, gy));
          const S = surfaceAt(q);
          return alphaOf(S ? energyAt(S.P, S.n) : energyAt(q, n));
        };
        const reachOut = 2 * Math.hypot(w, h);
        const rays = Array.from({ length: 40 }, (_, i) => {
          const t = (i / 40) * 2 * Math.PI;
          const dx = Math.cos(t);
          const dy = Math.sin(t);
          const prof = [];
          // along the ray as far as the piece's outline reaches (the field need not fall monotonically from the peak)
          const rMax = Math.min(reachOut, Math.max(...poly.map((q) => (q[0] - peak[0]) * dx + (q[1] - peak[1]) * dy)) + step);
          for (let r = 0; r <= rMax; r += step / 3) prof.push([r, alphaAt(peak[0] + dx * r, peak[1] + dy * r)]);
          return { dx, dy, prof };
        });
        // the farthest distance along a ray where alpha is still at a level (linear between samples): review fu-1, the
        // first crossing stopped the rudder's rays at a dip by the hinge, so its bands covered a sliver and the wash
        // ended at the hinge line; the farthest one holds the whole lit region (a star-shaped superset of it)
        const crossing = (ray, level) => {
          const P = ray.prof;
          for (let j = P.length - 1; j >= 1; j--) if (P[j - 1][1] >= level) return P[j][1] >= level ? P[j][0] : P[j - 1][0] + ((P[j - 1][1] - level) / Math.max(P[j - 1][1] - P[j][1], 1e-9)) * (P[j][0] - P[j - 1][0]);
          return 0;
        };
        // one band per level, each the region between its level set and the next one in (even-odd), filled at that
        // level's alpha: every pixel is composited once (24 nested layers of 1-2% each drifted toward red in the
        // canvas's 8-bit rounding)
        const rings = [];
        for (let k = 1; k <= LEVELS; k++) {
          const level = (top * (k - 0.5)) / LEVELS;
          if (level > peak[2]) break;
          const ring = rays.map((ray) => {
            const r = crossing(ray, level);
            return [peak[0] + ray.dx * r, peak[1] + ray.dy * r];
          });
          const cut = clipConvex(ring, poly);
          if (cut.length < 3) break;
          rings.push({ cut, alpha: (top * k) / LEVELS });
        }
        const pathOf = (pts) => `M${pts.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join("L")}Z`;
        const shapes = rings.map((R, i) => `<path class="a3-m8-lw" style="fill-opacity:${R.alpha.toFixed(4)};fill-rule:evenodd" d="${pathOf(R.cut)}${rings[i + 1] ? pathOf(rings[i + 1].cut) : ""}"/>`);
        logoReport.push(`${name}${side < 0 ? "L" : "R"} ${shapes.length} bands to ${top.toFixed(3)}`);
        if (!shapes.length) continue;
        const cls = `a3-m8-logo a3-m8-logo-${side < 0 ? "l" : "r"}`;
        ctx.plane(part, { o: add(fp.c, mul(n, 0.05)), u, v, normal: n, fade: [0.05, 0.3], svg: `<g class="${cls}" style="opacity:0">${shapes.join("")}</g>` });
        made = true;
      }
    }
    report.push(`logo fallback: ${logoReport.join(", ")}`);
    if (made) {
      vary("a3-m8-logo-l", "wash:logo:-1");
      vary("a3-m8-logo-r", "wash:logo:1");
    }
  }
  // f4-lights: the scan wash's fallback on the GL's own wash targets (washTargets kind "scan": the outer wing box tops
  // and slats, the nacelle lips and cowls), the shader's law (glslWash: spotAt of every registered wing and engine scan
  // lamp, 1/(d² + 1), its cone, reach and incidence) sampled on each target's surface and drawn as level-set bands:
  // every face of a hull target, and every 15° strip of a round target (the strip between two generators of the
  // frustum is planar), with the frustum's smooth normal. The wing lamps' bands and the engine lamps' bands are two
  // groups on one plane, faded by their switches (wash:wing / wash:engine). Before, free-standing soft ellipses on the
  // box tops and a tangent plane by each fan cowl: the cowls stayed dark (+1.4 levels against the GL's +28) and the
  // ellipses glowed in the air ahead of the far wing's leading edge (review f3).
  {
    const coneCosJs = (cone) => {
      const a = typeof cone === "number" ? [cone, cone * 0.5] : Array.isArray(cone) ? cone : cone ? [cone.outer, cone.inner] : [20, 10];
      return a[0] <= 1 && a[1] <= 1 ? a : a.map((x) => Math.cos(x * D2R));
    };
    const scanLamps = (ctx.registeredLamps ? ctx.registeredLamps() : stand.lamps)
      .filter((L) => (L.switch === "wing" || L.switch === "engine") && L.at && L.dir)
      .map((L) => {
        const def = LAMPS[L.switch];
        return { sw: L.switch, S: mul(L.at, KM), D: unit(L.dir), cos: coneCosJs(L.cone ?? def.cone), power: L.power ?? def.power, reach: L.reach ?? def.reach };
      });
    const ssJ = (a, b, x) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    // spotAt (gl/shaders.mjs) at a kit point P with unit normal n, the lamps of one switch
    const energy = (sw, P, n) => {
      let e = 0;
      const p = mul(P, KM);
      for (const T of scanLamps) {
        if (T.sw !== sw) continue;
        const Lv = sub(T.S, p);
        const d2 = dot(Lv, Lv);
        const d = Math.sqrt(d2);
        const Ln = mul(Lv, 1 / Math.max(d, 1e-4));
        e += (T.power * ssJ(T.cos[0], T.cos[1], -dot(Ln, T.D)) * Math.max(dot(n, Ln), 0) * (1 - ssJ(T.reach * 0.55, T.reach, d))) / (d2 + 1);
      }
      return e;
    };
    // the composited alpha: dark the screened glow 1 − exp(−e); light the tint's cover (tintInk, cap .15)
    const alphaOfE = (e) => (LIGHT_THEME ? 0.15 * (1 - Math.exp((-1.6 * e) / 0.15)) : 1 - Math.exp(-e));
    const ccw = (poly) => {
      let a = 0;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        a += p[0] * q[1] - q[0] * p[1];
      }
      return a < 0 ? poly.slice().reverse() : poly;
    };
    let nPlanes = 0;
    let nBands = 0;
    const perPart = new Map();
    const peakOf = new Map();
    // one planar patch: corners (kit), its plane normal, the surface normal at a kit point
    const patch = (part, corners, nPlane, normalAt, levels) => {
      const c = corners.reduce((a, p) => add(a, p), [0, 0, 0]).map((x) => x / corners.length);
      const u = unit(sub(corners[1], corners[0]));
      const v = cross(nPlane, u);
      const clip = ccw(corners.map((p) => [dot(sub(p, c), u), dot(sub(p, c), v)]));
      const xs = clip.map((q) => q[0]);
      const ys = clip.map((q) => q[1]);
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const at = (x, y) => add(add(c, mul(u, x)), mul(v, y));
      const groups = [];
      for (const sw of ["wing", "engine"]) {
        const bands = levelBands((x, y) => {
          const P = at(x, y);
          return alphaOfE(energy(sw, P, normalAt(P)));
        }, box, clip, levels, { grid: 48, rays: 24, min: 0.03, step: 0.02 });
        if (!bands.length) continue;
        nBands += bands.length;
        peakOf.set(part.name, Math.max(peakOf.get(part.name) ?? 0, bands.at(-1).alpha));
        groups.push(`<g class="a3-m8-scan-${sw === "wing" ? "w" : "e"}" style="opacity:0">${bands.map((B) => `<path class="a3-m8-sw" style="fill-opacity:${B.alpha.toFixed(4)};fill-rule:evenodd" d="${B.d}"/>`).join("")}</g>`);
      }
      if (!groups.length) return;
      ctx.plane(part, { o: add(c, mul(nPlane, 0.05)), u, v, normal: nPlane, fade: [0, 0.15], svg: `<g class="a3-m8-scan">${groups.join("")}</g>` });
      nPlanes++;
      perPart.set(part.name, (perPart.get(part.name) ?? 0) + 1);
    };
    for (const name of scanTargetNames(ctx, W)) {
      const part = ctx.part(name);
      const Wd = part.world;
      if (part.kind === "hull") {
        for (const face of Wd.faces) {
          const corners = face.ring.map((i) => Wd.points[i]);
          if (corners.length < 3) continue;
          patch(part, corners, face.n, () => face.n, 8);
        }
      } else if (part.kind === "round") {
        const a = unit(Wd.F.a);
        const U = unit(sub(Wd.F.u, mul(a, dot(Wd.F.u, a))));
        const V = cross(a, U);
        const k = (Wd.r1 - Wd.r0) / (Wd.s1 - Wd.s0);
        const P = (sv, ph) => add(add(Wd.F.o, mul(a, sv)), mul(add(mul(U, Math.cos(ph)), mul(V, Math.sin(ph))), Wd.r0 + k * (sv - Wd.s0)));
        const normalAt = (q) => {
          const L = sub(q, Wd.F.o);
          const nr = unit(sub(L, mul(a, dot(L, a))));
          return unit(sub(nr, mul(a, k)));
        };
        const N = 12;
        for (let i = 0; i < N; i++) {
          const p0 = (i / N) * 2 * Math.PI;
          const p1 = ((i + 1) / N) * 2 * Math.PI;
          const corners = [P(Wd.s0, p0), P(Wd.s0, p1), P(Wd.s1, p1), P(Wd.s1, p0)];
          let n = unit(cross(sub(corners[1], corners[0]), sub(corners[3], corners[0])));
          const mid = normalAt(P((Wd.s0 + Wd.s1) / 2, (p0 + p1) / 2));
          if (dot(n, mid) < 0) n = mul(n, -1);
          patch(part, corners, n, normalAt, 6);
        }
      }
    }
    if (nPlanes) {
      ctx.vary("a3-m8-scan-w", `(typeof A3M8 !== "undefined" ? A3M8.alpha("wash:wing:-1") : 0)`);
      ctx.vary("a3-m8-scan-e", `(typeof A3M8 !== "undefined" ? A3M8.alpha(${JSON.stringify(`wash:engine:${W.NACELLE[0].id}`)}) : 0)`);
    }
    report.push(`scan fallback: ${nPlanes} planes, ${nBands} bands from ${scanLamps.length} lamps (${[...perPart].map(([k, v]) => `${k} ${v} to ${(peakOf.get(k) ?? 0).toFixed(2)}`).join(", ")})`);
  }
  // cockpit panes: the lit copy on the canopy (the panes themselves are M2's glass)
  const canopy = ctx.part("nose.canopy");
  if (canopy) {
    for (const pane of panesOf(W, M))
      for (const side of [-1, 1]) {
        const pts = paneOnLoft(W, pane, side).map((p) => W.kit(p));
        let nrm = [0, 0, 0];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % pts.length];
          nrm = add(nrm, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
        }
        nrm = unit(nrm);
        const c = pts.reduce((a, p) => add(a, p), [0, 0, 0]).map((x) => x / pts.length);
        const out = W.kit([3.5, side * 0.0, 6.6]);
        if (dot(nrm, sub(c, out)) < 0) nrm = mul(nrm, -1);
        const u = unit(sub([0, 0, 1], mul(nrm, nrm[2])));
        const v = unit(cross(nrm, u));
        const d = pts.map((p) => {
          const q = sub(p, c);
          return [dot(q, u), dot(q, v)];
        });
        const path = `M${d.map((q) => `${q[0].toFixed(2)} ${q[1].toFixed(2)}`).join("L")}Z`;
        ctx.plane(canopy, { o: add(c, mul(nrm, 0.06)), u, v, normal: nrm, fade: [0.02, 0.25], svg: `<path class="a3-m8-ck" style="opacity:0" d="${path}"/>` });
      }
    vary("a3-m8-ck", "cockpit");
  }
  const lit = doorwayFallbacks(ctx);
  report.push(`fallbacks: ${n} lens billboards, ${nPt} point-light lens billboards, ${pools.length} pools, logo, scan and cockpit planes, ${lit} lit doorway strips`);
  void P;
}

/**
 * The open doorways' light without WebGL (follow-up item 30, review round 3 R48: with GL an open doorway is a lit card,
 * without it a dark brown hole). The windows program lights each doorway on its window piece, plane by plane: the
 * carpet strip (lower 18%, tone .35), the galley face (tone 1) and the ceiling (upper 18%, tone .8), dimmed with the
 * cabin (cabin^.66) and scaled by the door's open share; the cargo doorways in the cargo flood's cool white. Here the
 * same three strips are planes on the same host piece, split along the section's facets (each strip's piece of a facet
 * lies in that facet's own plane, as the skin's doorway does), filled with the colour the shader's tonemap gives that
 * tone, at the alpha it gives, through one vary class per strip: open × (1 − glShare) × the tone's glow. By daylight
 * the shader warms only the ceiling (a .13 tint), so the fallback does the same. Returns the strip count.
 */
function doorwayFallbacks(ctx) {
  const { W, M } = ctx;
  const lvD = "Math.pow(Math.max(0, pv.cabinLight !== undefined ? pv.cabinLight : (s && s.cabin) || 0), 0.66)";
  const GL = SH.GL_INKS;
  // a rounded rectangle in (x, σ) model metres, corners in 6 steps
  const roundRect = (xc, zc, hw, hh, r) => {
    const pts = [];
    for (const [cx, cz, a0] of [[xc + hw - r, zc - hh + r, -90], [xc + hw - r, zc + hh - r, 0], [xc - hw + r, zc + hh - r, 90], [xc - hw + r, zc - hh + r, 180]])
      for (let k = 0; k <= 6; k++) {
        const a = ((a0 + (k * 90) / 6) * Math.PI) / 180;
        pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
      }
    return pts;
  };
  // a polygon clipped to za <= σ <= zb (Sutherland-Hodgman, two planes)
  const clipZ = (poly, za, zb) => {
    const cut = (P, keep, at) => {
      const out = [];
      for (let i = 0; i < P.length; i++) {
        const a = P[i];
        const b = P[(i + 1) % P.length];
        const ka = keep(a);
        const kb = keep(b);
        if (ka) out.push(a);
        if (ka !== kb) {
          const t = (at - a[1]) / (b[1] - a[1]);
          out.push([a[0] + t * (b[0] - a[0]), at]);
        }
      }
      return out;
    };
    return cut(cut(poly, (p) => p[1] >= za, za), (p) => p[1] <= zb, zb);
  };
  let made = 0;
  // the openings exactly as skin.mjs cuts them and the windows program lights them (doorOpenings: (x, σ), inset half a
  // stroke; review fu-1: in (x, z) the ceiling strip stood up to 0.26 m above the upper-deck, nose and tail openings)
  for (const O of doorOpenings(W, M)) {
    const d = { ...O.d, cargo: O.cargo, s: O.side };
    const xc = d.x;
    const host = W.partAt(d.x, d.cargo ? d.sillZ + d.height / 2 : d.sillZ + 1.0, d.s);
    const part = host && ctx.part(host.name);
    if (!part) continue;
    const s0 = O.s - O.hs;
    const s1 = O.s + O.hs;
    const strips = LIGHT_THEME ? [["c", s1 - O.band, s1]] : [["f", s0, s0 + O.band], ["w", s0 + O.band, s1 - O.band], ["c", s1 - O.band, s1]];
    const outline = roundRect(xc, O.s, O.hw, O.hs, O.r);
    const ring = W.ring2(xc);
    const SIG = O.G.SIG;
    for (const [k, za, zb] of strips) {
      const paths = [];
      // the section's side facets this strip crosses, in σ; each piece mapped to (x, z) on its facet (σ linear in z there)
      for (let i = 0; i < 15; i++) {
        const fa = Math.max(za, SIG[i]);
        const fb = Math.min(zb, SIG[i + 1]);
        if (fb - fa < 1e-4) continue;
        const piece = clipZ(outline, fa, fb).map(([x, sg]) => [x, ring[i][1] + ((sg - SIG[i]) / (SIG[i + 1] - SIG[i])) * (ring[i + 1][1] - ring[i][1])]);
        if (piece.length < 3) continue;
        const zm = ring[i][1] + (((fa + fb) / 2 - SIG[i]) / (SIG[i + 1] - SIG[i])) * (ring[i + 1][1] - ring[i][1]);
        const F = W.facetFrame(xc, zm, d.s);
        // (x, z) on the facet's plane → (u, v) metres: x − o.x = u.x a + v.x b, z − o.z = u.z a + v.z b
        const det = F.u[0] * F.v[2] - F.v[0] * F.u[2];
        const uv = ([x, z]) => {
          const dx = x - F.o[0];
          const dz = z - F.o[2];
          return [W.m((dx * F.v[2] - F.v[0] * dz) / det), W.m((F.u[0] * dz - dx * F.u[2]) / det)];
        };
        const pts = piece.map(uv);
        paths.push({ F, d: `M${pts.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join("L")}Z` });
      }
      for (const { F, d: path } of paths) {
        // planeOn: painted after the skin's own doorway interior, which its plane book adds through planeOn too
        ctx.planeOn(host.name, { o: W.kit(F.o), u: W.kitDir(F.u), v: W.kitDir(F.v), normal: W.kitDir(F.n), fade: [0.04, 0.3], svg: `<path class="a3-m8-dl a3-m8-dl-${d.cargo ? "c" : "p"}${k} a3-m8-dl-${d.id}-${k}" style="opacity:0" d="${path}"/>` });
        made++;
      }
      // the strip's alpha: the red (passenger) or blue (cargo) channel of the shader's glow for this tone, which is
      // the glow's largest channel; its colour is the glow divided by that (the tokens below)
      const open = `(ch[${JSON.stringify(`door.${d.id}`)}] || 0)`;
      const tone = { f: 0.35, w: 1, c: 0.8 }[k];
      const alpha = LIGHT_THEME
        ? `${d.cargo ? "0.85" : lvD} * 0.13 * (1 - Math.exp(-14.77 * ${d.cargo ? "0.85" : lvD} * 0.95))` // fu/r1-fuselage: × the envelope, as the shader's tint
        : d.cargo
          ? `0.85 * (1 - Math.exp(-${(0.572 * tone).toFixed(4)} * ${GL.cargo.dark[2]}))`
          : `(1 - Math.exp(-${(0.88 * tone).toFixed(4)} * ${GL.win.dark[0]} * ${lvD}))`;
      ctx.vary(`a3-m8-dl-${d.id}-${k}`, `(1 - (pv.glShare || 0)) * ${open} * ${alpha}`);
    }
  }
  // the strips' colours: the shader's tonemapped glow for each tone at the gate's light, normalised to its largest
  // channel (the alpha above carries the level), from the same window and cargo inks the shader reads
  const glow = (ink, k) => {
    const g = ink.map((c) => 1 - Math.exp(-c * k));
    const m = Math.max(...g);
    return g.map((c) => c / m);
  };
  const hex = (c) => `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
  const tones = { f: 0.35, w: 1, c: 0.8 };
  const dark = Object.entries(tones).flatMap(([k, t]) => [`--a3-m8-dl-p${k}:${hex(glow(GL.win.dark, 0.88 * t))}`, `--a3-m8-dl-c${k}:${hex(glow(GL.cargo.dark, 0.572 * t))}`]);
  ctx.css(`.iso{${Object.keys(tones).flatMap((k) => [`--a3-m8-dl-p${k}:${hex(GL.door.light)}`, `--a3-m8-dl-c${k}:${hex(GL.door.light)}`]).join(";")}}
.iso[data-theme="dark"]{${dark.join(";")}}
.a3-m8-dl{stroke:none}
${Object.keys(tones).flatMap((k) => [`.a3-m8-dl-p${k}{fill:var(--a3-m8-dl-p${k})}`, `.a3-m8-dl-c${k}{fill:var(--a3-m8-dl-c${k})}`]).join("\n")}`);
  return made;
}

/**
 * The beam lamps of the model that a REAL module registers (wings: landing, wing taxi; gear: nose taxi, take-off,
 * turn-off), each with its housing found by the model position: among that module's convex hulls, the one whose
 * surface the lens point lies closest to (|max over faces of n·p − d|, kit units). Lamps in `skip` (M8's own
 * stand-ins) are left out. Returns lamp specs for the lens billboard: { id, part, at, dir, lens, switch }.
 */
function lensHosts(ctx, skip) {
  const { W, M } = ctx;
  const L = M.LIGHTS;
  const owners = [
    ...L.landing.map((x) => ({ ...x, module: "wings", sw: "landing", dir: aim(Math.sign(x.at[1]) * 1.6, 3.5) })),
    ...L.taxi.map((x) => (x.id === "taxiNose" ? { ...x, module: "gear", sw: "taxiNose", dir: aim(0, 4) } : { ...x, module: "wings", sw: "taxi", dir: aim(Math.sign(x.at[1]) * 13, 5) })),
    ...L.takeoff.map((x) => ({ ...x, module: "gear", sw: "takeoff", dir: aim(Math.sign(x.at[1]) * 4, 3) })),
    ...L.runwayTurnoff.map((x) => ({ ...x, module: "gear", sw: "runwayTurnoff", dir: aim(Math.sign(x.at[1]) * 44, 6) })),
  ];
  // the face a point is nearest to (the largest signed distance n·p − d over a convex hull's faces)
  const nearestFace = (Wd, at) => {
    let best = null;
    for (const f of Wd.faces) {
      const q = Wd.points[f.ring[0]];
      const s = f.n[0] * (at[0] - q[0]) + f.n[1] * (at[1] - q[1]) + f.n[2] * (at[2] - q[2]);
      if (!best || s > best.s) best = { f, s };
    }
    return best;
  };
  const isHull = (part) => part && part.world && part.world.points && part.world.faces && part.world.faces.length;
  // the housings the modules register these lamps on (CONTRACT §5, DESIGN §6.2); any other hull of the module
  // when they are absent
  const named = (o) => (o.module === "gear" ? "nlg.lamps" : `wings.${o.at[1] < 0 ? "l" : "r"}.le.root`);
  const out = [];
  for (const o of owners) {
    if (skip.has(o.id) || ctx.stubbed(o.module)) continue;
    const at = W.kit(o.at);
    let best = null;
    const pref = ctx.part(named(o));
    if (isHull(pref)) best = { part: pref, score: Math.abs(nearestFace(pref.world, at).s) };
    else
      for (const part of ctx.T.parts) {
        if (part.module !== o.module || !isHull(part)) continue;
        const score = Math.abs(nearestFace(part.world, at).s);
        if (!best || score < best.score) best = { part, score };
      }
    if (!best || best.score > 6) continue; // no housing within 0.6 m of the model's lens: leave it to request 2
    // the lens on the housing's surface: the model point moved onto its nearest face (as M3 places its lenses),
    // and into that face's polygon when it falls outside it (pulled 0.05 units in from the edge)
    const nf = nearestFace(best.part.world, at);
    const ring = nf.f.ring.map((i) => best.part.world.points[i]);
    const onPlane = sub(at, mul(nf.f.n, nf.s));
    const c = ring.reduce((a, p) => add(a, p), [0, 0, 0]).map((v) => v / ring.length);
    let pos = 0;
    let neg = 0;
    let near = null;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const e = sub(b, a);
      const w = dot(cross(e, sub(onPlane, a)), nf.f.n);
      if (w > 1e-9) pos++;
      else if (w < -1e-9) neg++;
      const t = Math.max(0, Math.min(1, dot(sub(onPlane, a), e) / Math.max(dot(e, e), 1e-12)));
      const q = add(a, mul(e, t));
      const d = Math.hypot(...sub(onPlane, q));
      if (!near || d < near.d) near = { q, d };
    }
    const inside = !(pos && neg);
    const flat = inside ? onPlane : add(near.q, mul(unit(sub(c, near.q)), Math.min(0.05, Math.hypot(...sub(c, near.q)))));
    const on = add(flat, mul(nf.f.n, 0.02));
    best.score = Math.hypot(...sub(on, at));
    out.push({ id: o.id, part: best.part.name, at: r3(on), dir: r3(W.kitDir(unit(o.dir))), lens: LAMPS[o.sw].lens, switch: o.sw, score: best.score });
  }
  return out;
}

const CSS = `
/* a lost (or never started) WebGL canvas must not paint over the figure: Chrome draws a lost context's
   canvas as an opaque placeholder. The harness removes data-gl on loss; the canvases are not airframe parts */
.a3-stage:not([data-gl]) .a3-gl{visibility:hidden}
/* (review round 3: every colour a token, with its dark override; the light wash a warm darkening of the paint, the
   multiply-like tint the shader lays, not a yellow over the blue-grey paint) */
.iso{--a3-m8-core:#ffffff;--a3-m8-ck:#9fb4d4}
.iso[data-theme="dark"]{--a3-m8-ck:#7fa6ff}
/* (follow-up item 35: --a3-m8-pool and --a3-m8-wash are shader inks too, written with the --a3-gl-* tokens from
   SH.GL_INKS; the GL reads them on the page, so a pool or a wash has one colour in both painters) */
.a3-m8-pool path{fill:var(--a3-m8-pool);stroke:none}
.a3-m8-bpool path{fill:var(--a3-gl-beacon-wash);stroke:none}
.a3-m8-spool path{fill:var(--a3-gl-strobe-wash);stroke:none}
.a3-m8-beam path{fill:var(--a3-gl-beam);stroke:none}
.a3-m8-wash{fill:var(--a3-m8-wash);fill-opacity:.012;stroke:none}
.a3-m8-lw{fill:var(--a3-m8-wash);stroke:none}
.a3-m8-sw{fill:var(--a3-gl-scan);stroke:none}
.a3-m8-ck{fill:var(--a3-m8-ck);fill-opacity:.1;stroke:none}
.iso[data-theme="dark"] .a3-m8-wash{fill-opacity:.012}
.iso[data-theme="dark"] .a3-m8-ck{fill-opacity:.42}
/* fu/f3-lights: at night the GL draws these glows on canvases screened over the figure (a380.css .a3-gl), so a wash
   lightens what is under it by t(1 − under); drawn "over" at the same alpha the fallback also darkened it by alpha ×
   under (the logo wash read up to 24 levels under the GL's on the upper fin). Screened here as there, in both painters
   (kit/canvas-painter.mjs paints a screen-blended static path with the canvas's "screen" composite) */
.iso[data-theme="dark"] :is(.a3-m8-beam path,.a3-m8-wash,.a3-m8-lw,.a3-m8-sw){mix-blend-mode:screen}
/* the pools are live SVG on the deck: screened only while the fallback shows (gl/runway.js sets data-a3-fb), so that
   under WebGL the deck holds no blended element (it changed how the GL canvases screen over it by up to 10 levels) */
.iso[data-theme="dark"] .a3-stage[data-a3-fb] :is(.a3-m8-pool path,.a3-m8-bpool path,.a3-m8-spool path){mix-blend-mode:screen}
/* the lit-window fallback's dimmed colour (follow-up item 26; skin.mjs's token, set here so the windows' two painters
   meet in one file, measured on the GL): dark, the colour at 40% light (cabin .25) is the GL's window core at that
   level, (183, 164, 128) at 4x (skin's #cbb993 read 17-20 levels over the GL at line-up and in the climb); light, the
   GL's composite over the fuselage paint (skin's #f9c565 read 15-30 levels over it) */
.iso{--a3-win-lit:#e1b162}
.iso[data-theme="dark"]{--a3-win-lit:#b7a480}
`;

/**
 * The daylight lit pane's two fallback inks (review fu-1), from the shader's own law (glslWindowPart's paper branch at
 * the gate's cabin light: lampInk of energy 2.4 × lum, cap .92, composited over the pane's glass, skin.mjs --a3-glass by
 * day #b9c3cc): the pale core at the pane's centre (lum 1.12 × the mean shade .95) and the warm rim 0.003 m in from its
 * edge. skin.mjs draws them over the amber 1x pane (a3-win-hot, a3-win-core) as pv.winCore brings the GL's core in.
 */
export function windowPaperInks() {
  const G = SH.GL_INKS;
  const ss = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const lamp = (e, rim, body, core, fa) => {
    const m = 1 - Math.exp(-e);
    let seen = mix([1, 1, 1], rim, ss(0, 0.3, m));
    seen = mix(seen, body, ss(0.2, 0.55, m));
    seen = mix(seen, core, ss(0.64, 0.97, m));
    const ab = seen.map((v) => 1 - v);
    const a = Math.max(...ab, fa * ss(0.5, 0.9, m));
    return [...ab.map((v) => a - v), a];
  };
  const glass = [0xb9, 0xc3, 0xcc].map((v) => v / 255);
  const seenAt = (lum) => {
    const k = lamp(2.4 * lum, G.winRim.light, G.win.light, G.winCore.light, 0.92).map((v) => v * 0.92);
    return k.slice(0, 3).map((v, i) => v + (1 - k[3]) * glass[i]);
  };
  return { core: seenAt(1.12 * 0.95), rim: seenAt((0.62 + 0.5 * ss(0, 0.03, 0.003)) * 0.95) };
}
function windowPaperCss() {
  const hex = (c) => `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
  const P = windowPaperInks();
  // fu/r2-lights: a closed blind at night (skin.mjs a3-win-shut, faded by lvD): the windows program's blind glow at the
  // gate's light (lum BLIND_LUM × the mean shade .95, plus its own small halo), screened over the dark glass
  const e = SH.BLIND_LUM * 0.95 * (2.6 + 0.3);
  const glassDark = [0x06, 0x08, 0x0a].map((v) => v / 255);
  const shut = SH.GL_INKS.win.dark.map((w, i) => {
    const t = 1 - Math.exp(-w * e);
    return t + glassDark[i] * (1 - t);
  });
  return `.iso{--a3-m8-win-rim:${hex(P.rim)};--a3-m8-win-core:${hex(P.core)};--a3-m8-win-shut:${hex(shut)}}
.a3-win-shut{fill:var(--a3-m8-win-shut);stroke:none}
.iso[data-theme="light"] .a3-win-hot{fill:var(--a3-m8-win-rim)}
.iso[data-theme="light"] .a3-win-lit-door{fill:var(--a3-win-lit)}
.iso[data-theme="light"] .a3-port-gl{fill:var(--a3-m8-win-rim)}
.iso[data-theme="light"] .a3-port-core{fill:var(--a3-m8-win-core)}
.a3-win-cbase,.a3-port-cbase{fill:var(--a3-glass);stroke:none}
.a3-win-core{fill:var(--a3-m8-win-core);stroke:none}`;
}

// --------------------------------------------------------------------------------------------- checks
export function checks(ctx, out) {
  void out;
  const { W, M } = ctx;
  const fails = [];
  const wp = windowParts(W, M);
  const windows = wp.reduce((a, p) => a + p.rows.reduce((b, r) => b + r.xs.length * (r.side ? 1 : 2), 0), 0);
  const doors = wp.reduce((a, p) => a + p.doors.length, 0);
  if (windows !== M.WINDOWS.counts.total) fails.push(`windows ${windows}, model ${M.WINDOWS.counts.total}`);
  if (doors !== M.DOOR_IDS.length) fails.push(`doorways ${doors}, model ${M.DOOR_IDS.length}`);
  for (const p of wp) if (!ctx.part(p.name)) fails.push(`window piece ${p.name} missing`);
  // every window lies inside its piece's z clip and x range, rectangle and all
  for (const p of wp) {
    const piece = W.SHELL.find((s) => s.name === p.name);
    for (const r of p.rows)
      for (const xk of r.xs) {
        const x = W.PIVOT_X - xk;
        if (x - r.w / 2 < piece.x[0] - 1e-6 || x + r.w / 2 > piece.x[1] + 1e-6) fails.push(`${p.name}: window at ${x} crosses x ${piece.x}`);
        if ((piece.clip.zMin ?? -1e9) > r.z - r.h / 2 || (piece.clip.zMax ?? 1e9) < r.z + r.h / 2) fails.push(`${p.name}: row ${r.z} crosses its z clip`);
      }
  }
  const disp = displaysOf(W).displays;
  if (disp.length !== M.CABIN.flightDeck.displays.count) fails.push(`displays ${disp.length}`);
  // the beacons' envelope against the model's flashAt at 10 ms steps over one period: lit (> 0.5) exactly where the
  // model's beacon is on, within one 10 ms step at each edge, and below 0.05 by 0.1 s after it goes off
  {
    const B = beaconFlashOf(M);
    const train = (t) => {
      const cycle = (((t - B.phase) % B.period) + B.period) % B.period;
      let v = 0;
      for (const back of [0, B.period]) {
        const x = cycle + back;
        const y = x < 0 ? 0 : x < B.rise ? (x / B.rise) ** 2 * (3 - 2 * (x / B.rise)) : x < B.rise + B.hold ? 1 - (0.3 * (x - B.rise)) / B.hold : 0.7 * Math.exp(-(x - B.rise - B.hold) / B.fall);
        v = Math.max(v, y);
      }
      return v;
    };
    let edges = 0;
    let tail = 0;
    for (let t = 0; t < B.period; t += 0.01) {
      const lit = train(t) > 0.5;
      const on = M.flashAt("beacon", t) > 0;
      if (lit !== on && M.flashAt("beacon", t - 0.012) > 0 === on && M.flashAt("beacon", t + 0.012) > 0 === on && train(t - 0.012) > 0.5 === lit) edges++;
      const off = (((t - M.LIGHTS.flash.beacon.offsetS) % 1) + 1) % 1;
      if (off > M.LIGHTS.flash.beacon.on + 0.1 && off < 0.95) tail = Math.max(tail, train(t));
    }
    console.log(`M8: beacon envelope vs flashAt at 10 ms: ${edges} mismatched steps away from the edges, ${tail.toFixed(3)} after the off time + 0.1 s`);
    if (edges || tail > 0.05) fails.push(`beacon envelope differs from M.flashAt (${edges} steps, tail ${tail.toFixed(3)})`);
  }
  console.log(`M8: ${windows} windows and ${doors} doorways on ${wp.length} pieces; ${disp.length} displays; stand-ins ${["wings", "tail", "skin", "engines", "gear"].filter((m) => ctx.stubbed(m)).join(", ") || "none"}`);
  if (fails.length) throw new Error(fails.join("; "));
}
