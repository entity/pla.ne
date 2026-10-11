// Steps the A380 model through every phase at 60 fps (real time) and checks for NaN and jumps.
// node a380/tools/model-test.mjs   (tracked copy of the review rounds' a380/tmp/model-test.mjs; output recorded in notes/followup/interaction.md)
import { readFileSync } from "node:fs";
import * as M from "../model.mjs";

const src = readFileSync(new URL("../model.mjs", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const banned = [/^\s*import\s/m, /\brequire\(/, /\bprocess\./, /\bDate\b/, /Math\.random/, /\bwindow\./, /\bdocument\./, /\bglobalThis\./];
for (const b of banned) if (b.test(src)) { console.error("banned token in model.mjs:", b); process.exitCode = 1; }

// --- derived checks
const shoelace = (pts) => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
{
  const le = M.WING.le.map(([x, y]) => [x, y]), te = M.WING.te.map(([x, y]) => [x, y]);
  const exposed = shoelace([...le, ...te.slice().reverse()]) * 2;
  // reference area: LE and TE lines carried straight to the centreline (Airbus reference is trapezoidal-ish)
  const leIn = [[le[0][0] - 3.57 * 0.874, 0], ...le], teIn = [[te[0][0] - 3.57 * 0.265, 0], ...te];
  const gross = shoelace([...leIn, ...teIn.slice().reverse()]) * 2;
  console.log(`wing exposed area ${exposed.toFixed(0)} m2, gross to centreline ${gross.toFixed(0)} m2 (Airbus reference 845)`);
  const tp = M.EMPENNAGE.tailplane; console.log(`tailplane area ${(shoelace([...tp.le, ...tp.te.slice().reverse()]) * 2).toFixed(0)} m2 (published 205.6)`);
  const f = M.EMPENNAGE.fin; console.log(`fin area ${(((f.rootChord + f.tipChord) / 2) * f.height).toFixed(1)} m2`);
  const pax = M.CABIN.decks.main.zones.reduce((a, z) => a + z.seats, 0) + M.CABIN.decks.upper.zones.reduce((a, z) => a + z.seats, 0);
  console.log(`seats ${pax} (555), doors ${M.DOORS.passenger.length} pax + ${M.DOORS.cargo.length} cargo, windows/side main ${M.WINDOWS.main.length} upper ${M.WINDOWS.upper.length}`);
  // door/window/seat conflicts: no window inside a door opening, no seat row across a door cross-aisle
  for (const d of M.DOORS.passenger) {
    const wins = d.deck === "main" ? M.WINDOWS.main : M.WINDOWS.upper;
    const hit = wins.filter((x) => Math.abs(x - d.x) < d.width / 2 + 0.13);
    if (hit.length) { console.error("window inside door", d.id, hit); process.exitCode = 1; }
    const zones = M.CABIN.decks[d.deck].zones;
    const rows = zones.flatMap((z) => z.sideRows);
    const block = rows.filter((x) => Math.abs(x - d.x) < d.width / 2 + 0.2);
    if (block.length) { console.error("seat row in door cross-aisle", d.id, block); process.exitCode = 1; }
  }
  for (const [x] of M.FUSELAGE.stations) { const a = M.fuselageAt(x); if (x > 0 && !(a.topZ > a.bottomZ)) { console.error("station inverted", x); process.exitCode = 1; } }
  console.log("fuselage stations", M.FUSELAGE.stations.length, "section half-width at main deck floor", M.sectionHalfWidth(M.SECTION.mainDeckFloorZRel).toFixed(2));
  // tail strike geometry about the rear BLG axle
  const rear = M.GEAR.body.axleX[2]; let minA = 90;
  for (const [x, , , z] of M.FUSELAGE.stations) if (x > rear + 3) minA = Math.min(minA, (Math.atan2(z, x - rear) * 180) / Math.PI);
  console.log(`tail-strike pitch about the rear BLG axle (static) ${minA.toFixed(1)} deg`);
}

// --- dynamics at 60 fps
const dt = 1 / 60;
let s = M.initialState();
const caps = { GATE: 30, PUSHBACK: 400, TAXI: 700, LINEUP: 120, TAKEOFF: 200, CLIMB: 600, FL100: 900 };
const jumpLimit = { speed: 0.12, height: 1.0, pitch: 0.08, n1: 1.2, slat: 0.12, flap: 0.12, leg: 0.02, door: 0.03, cabin: 0.01, tug: 0.01 };
let errors = 0;
const num = (st) => ({ n1s: st.n1.slice(), stage: st.proc.stage, beacon: st.lights.beacon, speed: st.speed, height: st.height, pitch: st.pitch, slat: st.slat, flap: st.flap, leg: st.gear.leg, cabin: st.cabin, n1: Math.max(...st.n1), door: Math.max(...Object.values(st.doors)), tug: st.tug ?? 0 });
const events = [];
let prevLights = { ...s.lights };
// fu/r2-interaction: the tail's least clearance through the rotation and the first seconds airborne (the fuselage stations
// pitched about the rear BLG axle, plus the height; the oleo's extension is not counted, so it is conservative)
const tailRear = M.GEAR.body.axleX[2];
const tailPts = M.FUSELAGE.stations.filter(([x]) => x > tailRear + 3).map(([x, , , z]) => [x - tailRear, z]);
let tailMin = { m: Infinity };
for (const id of M.PHASE_IDS) {
  const target = M.phaseState(id);
  let t = 0;
  console.log(`\n== ${id} start  | ${M.readout(s)}`);
  let vrAt = null, loAt = null, stage = s.gear.stage, slatPrev = s.slat, flapPrev = s.flap;
  while (t < caps[id]) {
    const prev = num(s);
    s = M.step(s, target, dt);
    t += dt;
    const cur = num(s);
    for (const k of Object.keys(cur)) {
      if (k === "n1s" || k === "stage" || k === "beacon") continue;
      if (!Number.isFinite(cur[k])) { console.error(`NaN ${k} at ${id} t=${t.toFixed(2)}`); errors++; }
      else if (Math.abs(cur[k] - prev[k]) > jumpLimit[k]) { console.error(`jump ${k} ${prev[k].toFixed(3)} -> ${cur[k].toFixed(3)} at ${id} t=${t.toFixed(2)}`); errors++; }
    }
    if (errors > 20) break;
    if (id === "TAKEOFF" && vrAt === null && s.speed >= M.PERF.vr) { vrAt = t; events.push(`TAKEOFF  VR ${M.PERF.vr} kt at ${t.toFixed(1)} s, roll from brake release ${(s.groundDistance - (s.brakeReleaseD ?? 0)).toFixed(0)} m`); }
    if (id === "TAKEOFF" && loAt === null && !s.onGround) { loAt = t; events.push(`TAKEOFF  lift-off at ${t.toFixed(1)} s (${(t - vrAt).toFixed(1)} s after VR) pitch ${s.pitch.toFixed(1)} speed ${s.speed.toFixed(0)} kt, roll from brake release ${(s.groundDistance - (s.brakeReleaseD ?? 0)).toFixed(0)} m (${s.groundDistance.toFixed(0)} m from the stand)`); }
    if (s.gear.stage !== stage) { events.push(`${id}  gear ${stage} -> ${s.gear.stage} at ${t.toFixed(1)} s, ${(s.height / 0.3048).toFixed(0)} ft`); stage = s.gear.stage; }
    if (id === "TAKEOFF" && !s.onGround && s.height < 40 && Math.floor((t - dt) * 2) !== Math.floor(t * 2)) events.push(`TAKEOFF  airborne ${t.toFixed(1)} s: ${(s.height / 0.3048).toFixed(0)} ft pitch ${s.pitch.toFixed(1)} VS ${(s.vs / 0.3048 * 60).toFixed(0)} fpm ${s.speed.toFixed(0)} kt`);
    if ((Math.abs(s.slat - slatPrev) > 0 && (s.slat === 0 || s.slat === 20 || s.slat === 23)) || (Math.abs(s.flap - flapPrev) > 0 && (s.flap === 0 || s.flap === 8))) events.push(`${id}  surfaces settle slat ${s.slat.toFixed(1)} flap ${s.flap.toFixed(1)} at ${t.toFixed(1)} s, ${s.speed.toFixed(0)} kt`);
    slatPrev = s.slat; flapPrev = s.flap;
    for (const k of Object.keys(s.lights)) if (s.lights[k] !== prevLights[k]) { events.push(`${id}  light ${k} ${prevLights[k]} -> ${s.lights[k]} at ${t.toFixed(1)} s`); }
    prevLights = { ...s.lights };
    if (id === "TAKEOFF" && prev.speed < 32.5 && s.speed >= 32.5) events.push(`TAKEOFF  32.5 kt at ${t.toFixed(1)} s, N1 ${s.n1[0].toFixed(1)} (FADEC cap 78 until here)`);
    if (id === "TAKEOFF" && prev.speed < 80 && s.speed >= 80) events.push(`TAKEOFF  80 kt at ${t.toFixed(1)} s, N1 ${s.n1[0].toFixed(1)}`);
    for (let i = 0; i < 4; i++) if (prev.n1s[i] < 19.5 && s.n1[i] >= 19.5) events.push(`${id}  engine ${i + 1} stable idle at ${t.toFixed(1)} s`);
    if (id === "TAKEOFF" && prev.stage === 0 && s.proc.stage === 1) events.push(`TAKEOFF  thrust stabilised at ${t.toFixed(1)} s, ${s.speed.toFixed(1)} kt`);
    if (id === "CLIMB" && Math.floor((t - dt) / 10) !== Math.floor(t / 10)) events.push(`CLIMB  t ${t.toFixed(0)} s: ${(s.height / 0.3048).toFixed(0)} ft, ${s.speed.toFixed(0)} kt, pitch ${s.pitch.toFixed(1)}, VS ${(s.vs / 0.3048 * 60).toFixed(0)} fpm, N1 ${s.n1[0].toFixed(1)}, slat ${s.slat.toFixed(1)} flap ${s.flap.toFixed(1)}`);
    if (id === "PUSHBACK" && prev.beacon === 0 && s.lights.beacon === 1) events.push(`PUSHBACK  beacon on at ${t.toFixed(1)} s (doors shut, slides ${s.slides})`);
    // the pushback tug (follow-up): connected, the push, released, clear
    for (const [v, what] of [[1, "connected to the nose wheel"], [1.0001, "releasing the nose wheel"], [1.3, "driving off"], [2, "clear"]]) if (id === "PUSHBACK" && prev.tug < v && (s.tug ?? 0) >= v) events.push(`PUSHBACK  tug ${what} at ${t.toFixed(1)} s, ${s.speed.toFixed(2)} kt, ${s.groundDistance.toFixed(1)} m from the stand`);
    if (id === "PUSHBACK" && prev.speed > -0.5 && s.speed <= -0.5) events.push(`PUSHBACK  push under way at ${t.toFixed(1)} s`);
    if ((id === "TAKEOFF" || id === "CLIMB") && s.height < 15 && s.pitch > 1) {
      const th = (s.pitch * Math.PI) / 180;
      const m = s.height + Math.min(...tailPts.map(([dx, z]) => z * Math.cos(th) - dx * Math.sin(th)));
      if (m < tailMin.m) tailMin = { m, id, t, pitch: s.pitch, ft: s.height / 0.3048 };
    }
    if (M.phaseDone(s, id) && t > 0.5) break;
  }
  console.log(`== ${id} end after ${t.toFixed(1)} s real (done=${M.phaseDone(s, id)}) | ${M.readout(s)}`);
  console.log(`   aria: ${M.ariaText(s)}`);
}
console.log("\nevents:\n  " + events.join("\n  "));
console.log(`\ntail clearance, least through the rotation: ${tailMin.m.toFixed(2)} m at ${tailMin.id} ${tailMin.t.toFixed(1)} s, pitch ${tailMin.pitch.toFixed(1)}°, ${tailMin.ft.toFixed(0)} ft (static tail-strike pitch ${M.DIM.tailStrikePitch.geometryAtRest}°)`);
if (!(tailMin.m > 0)) { console.error("tail strike in the rotation"); errors++; }
// --- the figure's way: compressed time, 60 fps, phase switches on phaseDone or after figureS
{
  let st = M.initialState(), frames = 0, bad = 0, maxTipJump = 0, prevLift = st.lift;
  for (const p of M.PHASES) {
    const tg = M.phaseState(p.id); let f = 0;
    while (f < p.figureS * 60 * 3) {
      st = M.step(st, tg, p.compression / 60); f++; frames++;
      const vals = [st.speed, st.height, st.pitch, st.slat, st.flap, st.gear.leg, st.lift, ...st.n1];
      if (vals.some((v) => !Number.isFinite(v))) bad++;
      maxTipJump = Math.max(maxTipJump, Math.abs(st.lift - prevLift) * M.WING.bend.tipRise); prevLift = st.lift;
      if (M.phaseDone(st, p.id) && f > 2) break;
    }
    console.log(`figure ${p.id}: ${(f / 60).toFixed(1)} s on screen (suggested ${p.figureS} s) | ${M.readout(st)}`);
  }
  console.log(`compressed run: ${frames} frames, NaN frames ${bad}, max wingtip bend step per frame ${maxTipJump.toFixed(3)} m`);
  if (bad) process.exitCode = 1;
}
console.log(errors ? `\nFAILED: ${errors} problems` : "\nno NaN, no jumps");
if (errors) process.exitCode = 1;
