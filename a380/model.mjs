// @ts-check
// a380/model.mjs: the Airbus A380-800 truth model for the figure.
//
// Pure ESM: no imports, no Node or DOM APIs, no clock or random sources. Inlined into the page and
// imported by the Node build. Every number has a provenance tag; a380/truth.md lists the sources.
//   [S] sourced: read from a primary or named secondary document
//   [D] derived: computed from sourced numbers, or measured from a dimensioned Airbus drawing
//   [E] estimated: engineering estimate or community/simulator data, say how in truth.md
//
// Units: metres, degrees, seconds, percent, knots (heights in the readout are shown in feet).
// Frame: x aft from the nose tip, y to the right wing (pilot's right), z up from the ground.
// Rest pose: on the ground, gear down, static at MRW 562 t (WV000) with a mid CG (the mean of the
// AC's FWD 37.8% and AFT 41% columns). Wing and nacelle heights droop with fuel, so they are
// given at MRW plus a lift-driven bend (wingBend) for the take-off roll and flight.
// Engines are numbered 1-4 from the left (Airbus convention): 1 = left outboard.

// ---------------------------------------------------------------------------------------------
// small pure helpers
// ---------------------------------------------------------------------------------------------
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
/** Linear interpolation in a table of [x, ...values] rows, sorted by x; returns the value column. */
export function interp(table, x, col = 1) {
  if (x <= table[0][0]) return table[0][col];
  const last = table[table.length - 1];
  if (x >= last[0]) return last[col];
  for (let i = 1; i < table.length; i++) {
    const a = table[i - 1], b = table[i];
    if (x <= b[0]) return lerp(a[col], b[col], (x - a[0]) / (b[0] - a[0]));
  }
  return last[col];
}
const KT = 0.514444; // m/s per knot
const FT = 0.3048; // m per foot
const G0 = 9.80665;

// ---------------------------------------------------------------------------------------------
// overall dimensions
// ---------------------------------------------------------------------------------------------
export const STATIC = {
  weightT: 562, // [S] MRW WV000 (AC 2-1-1)
  cg: "mid (mean of AC 2-3-0 FWD 37.8% and AFT 41% MRW columns)",
  takeoffWeightT: 510, // [E] figure scenario: a typical long-haul take-off weight
};

export const DIM = {
  length: 72.73, // [S] AC 2-2-0 overall (nose tip to fin tip TE); Airbus facts 72.7
  lengthToTailplaneTip: 72.57, // [S] AC 2-2-0 plan view
  fuselageLength: 70.4, // [S] AC 2-2-0 (nose tip to tail cone end)
  span: 79.75, // [S] AC 2-2-0 (over the wingtip fences); Airbus facts "geometric 79.8"
  height: 24.15, // [S] AC 2-3-0 VT at MRW (24.17 FWD / 24.12 AFT); Airbus facts 24.1
  fuselageWidth: 7.14, // [S] AC 2-2-0 front view
  fuselageHeight: 8.41, // [S] AC 2-2-0 side view (constant section, keel to crown)
  keelZ: 2.36, // [S] AC 2-3-0 F1 at MRW (2.34 / 2.38)
  crownZ: 10.77, // [S] AC 2-3-0 F2 at MRW (10.75 / 10.79)
  mainDeckFloorZ: 5.15, // [S] AC 2-3-0 M-door sills at MRW (5.11-5.18)
  upperDeckFloorZ: 7.9, // [S] AC 2-3-0 U-door sills at MRW (7.88-7.93)
  lowerDeckFloorZ: 3.09, // [S] AC 2-3-0 C1/C2 cargo sills at MRW
  cabinLength: 49.9, // [S] Airbus A380 facts & figures (main deck)
  cabinWidthMain: 6.5, // [S] Airbus facts (max cabin width)
  cabinWidthUpper: 5.8, // [S] Airbus facts
  cabinAreaM2: 550, // [S] Airbus facts (both decks)
  wingArea: 845, // [S] Airbus facts (reference)
  aspectRatio: 7.53, // [D] span^2 / area; Flight International gives 7.52
  sweep25: 33.5, // [S] Airbus facts (25% chord)
  wheelbaseWLG: 28.605, // [S] AC 7-2-0 nose axle to WLG bogie centre
  wheelbaseBLG: 31.881, // [S] AC 7-2-0 nose axle to BLG centre axle (the usual "wheelbase")
  trackWLG: 12.456, // [S] AC 7-2-0 WLG centrelines
  trackBLG: 5.264, // [S] AC 7-2-0 BLG centrelines
  trackOuterTyres: 14.34, // [S] AC 2-2-0 outside faces of the WLG tyres (= 12.456 + 1.35 + 0.53)
  noseToNLG: 4.97, // [S] AC 2-2-0
  noseToWLG: 33.58, // [S] AC 2-2-0
  noseToBLG: 36.85, // [S] AC 2-2-0
  // Ground clearances, MRW, mean of FWD/AFT CG columns [S] AC 2-3-0. z in metres.
  clearance: {
    nacelleInboard: 1.065, // N1
    nacelleOutboard: 1.9, // N2
    bellyFairing: 1.66, // BF1 (x ~ 29.7)
    bellyFairingAft: 2.245, // BF2 (x ~ 44)
    fuselageFwd: 2.36, // F1 (x ~ 14.2)
    radome: 4.78, // RD1 (nose tip)
    cockpit: 7.15, // CP1 (cockpit eye reference)
    wingtipFenceTop: 7.52, // W1
    wingtipFenceBottom: 5.24, // W2 (W1 - W2 = 2.28 m at every weight: the fence)
    tailplaneTip: 9.175, // HT
    tailplaneRoot: 7.625, // HT1
    finTip: 24.145, // VT
    at300t: { nacelleInboard: 1.3, nacelleOutboard: 2.27, wingtipFenceTop: 8.25, finTip: 24.22 }, // [S] lighter weight for contrast
  },
  tailStrikePitch: { gearCompressed: 11.5, gearExtended: 13.5, geometryAtRest: 12.7 }, // [E] study notes; [D] 12.7 from the model's fuselage stations about the rear BLG axle (tools/model-test.mjs; was 12.9, fu/r2-interaction)
};

// The double-deck "ovoid" constant section. zRel is height above the keel (0 .. 8.41).
// Upper lobe from the AC front-view silhouette, lower lobe from the cargo-door section shape blended
// with the front view (the belly fairing hides it there). [D] Widest 7.14 m at zRel 4.14 (z 6.50).
export const SECTION = {
  keelZ: DIM.keelZ,
  height: 8.41,
  table: [
    [0.0, 0.0], [0.1, 0.85], [0.25, 1.36], [0.5, 1.88], [1.0, 2.52], [1.5, 2.92], [2.0, 3.2], [2.5, 3.37],
    [2.79, 3.43], [3.14, 3.48], [3.64, 3.54], [4.14, 3.57], [4.64, 3.54], [5.14, 3.44], [5.54, 3.37], [6.14, 3.17],
    [6.64, 2.93], [7.14, 2.61], [7.64, 2.14], [7.84, 1.88], [8.04, 1.55], [8.24, 1.1], [8.34, 0.7], [8.41, 0.0],
  ],
  // Fit: two half-superellipses sharing the widest station. |y/a|^n + |dz/b|^n = 1. [D]
  fit: { zRelMax: 4.14, halfWidth: 3.57, upper: { b: 4.27, n: 2.1 }, lower: { b: 4.14, n: 2.25 } },
  crownArc: { zRelCentre: 5.06, radius: 3.35, validAboveZRel: 6.1 }, // [D] circle through the crown points
  mainDeckFloorZRel: 2.79, // [S] 5.15 - 2.36
  upperDeckFloorZRel: 5.54, // [S] 7.90 - 2.36
};
/** Half-width of the constant section at height zRel above the keel (table interpolation). */
export function sectionHalfWidth(zRel) {
  return interp(SECTION.table, clamp(zRel, 0, SECTION.height));
}

// ---------------------------------------------------------------------------------------------
// fuselage stations: [x, halfWidth, topZ, bottomZ] from the AC 2-2-0 side and plan views, with the
// drawn section (8.55 m) scaled onto the AC's 8.41 m about the crown. Constant section 14-46 m.
// Aft of ~52 m the tail cone flattens sideways and ends in a 1.4 m tall, 0.4 m wide blade with the
// APU exhaust. The belly fairing (separate table) hangs below the keel from ~18.5 to ~46.5 m.
// ---------------------------------------------------------------------------------------------
export const FUSELAGE = {
  stations: [
    [0, 0, 4.81, 4.81], [0.25, 0.7, 5.57, 4.2], [0.5, 0.97, 5.91, 3.97], [1, 1.36, 6.41, 3.65],
    [1.5, 1.63, 6.75, 3.42], [2, 1.86, 7.14, 3.26], [2.5, 2.04, 7.58, 3.13], [3, 2.21, 8.03, 3.03],
    [4, 2.49, 8.73, 2.85], [5, 2.72, 9.27, 2.71], [6, 2.91, 9.67, 2.64], [7, 3.06, 9.94, 2.57],
    [8, 3.21, 10.16, 2.51], [9, 3.31, 10.34, 2.46], [10, 3.41, 10.48, 2.41], [12, 3.53, 10.68, 2.36],
    [14, 3.56, 10.77, 2.36], [18, 3.57, 10.77, 2.36], [30, 3.57, 10.77, 2.36], [46, 3.57, 10.76, 2.36],
    [48, 3.56, 10.76, 2.58], [50, 3.56, 10.76, 2.93], [52, 3.45, 10.73, 3.28], [54, 3.25, 10.67, 3.65],
    [56, 2.97, 10.53, 4.02], [58, 2.51, 10.33, 4.45], [60, 2.11, 10.12, 4.87], [62, 1.85, 9.91, 5.3],
    [64, 1.59, 9.7, 5.77], [66, 1.32, 9.48, 6.32], [68, 0.84, 9.26, 6.89], [69, 0.55, 9.15, 7.19],
    [70, 0.27, 9.04, 7.47], [70.4, 0.2, 8.99, 7.59],
  ], // [D] AC 2-2-0 drawings, see truth.md. f4-fuselage: x 64 half-width 1.73 -> 1.59 (the plan view
  // there is the tailplane-root fairing, not the cone: 62 -> 66 tapers on a straight line, slope -0.13 m/m)
  constantSection: [14, 46], // [D]
  noseTip: [0, 0, 4.81], // [D] (AC RD1 radome height 4.78 at MRW)
  tailConeEnd: { x: 70.4, z0: 7.59, z1: 8.99, halfWidth: 0.2 }, // [D] APU exhaust blade
  // Belly fairing (wing-body fairing + WLG bays): [x, bottomZ, halfWidth]. [D] AC BF1/BF2 + drawings.
  bellyFairing: [
    [18.5, 2.36, 3.3], [20, 2.24, 3.7], [22, 2.02, 4.0], [25, 1.82, 4.2], [28, 1.7, 4.3], [29.7, 1.66, 4.35],
    [35, 1.66, 4.35], [38, 1.74, 4.3], [40, 1.84, 4.2], [42, 1.97, 4.0], [44, 2.245, 3.75], [46.5, 2.36, 3.57],
  ],
  // Fin root line (horizontal, inside the tail cone top) and the dorsal fillet. [D]
  sectionsBuilt: [ // [S] Airbus/industrial sources (truth.md)
    { part: "nose and cockpit section, centre fuselage", site: "Saint-Nazaire (France)" },
    { part: "forward-centre and rear fuselage", site: "Hamburg (Germany)" },
    { part: "wings", site: "Broughton (UK), designed with Filton; flaps from Bremen" },
    { part: "horizontal tailplane", site: "Getafe, final assembly Puerto Real (Spain)" },
    { part: "vertical tail (CFRP)", site: "Stade (Germany)" },
    { part: "engine pylons", site: "Toulouse (France)" },
    { part: "final assembly", site: "Toulouse Jean-Luc Lagardère (France); cabin and paint in Hamburg" },
  ],
};
/** Fuselage outline at station x: { halfWidth, topZ, bottomZ }. */
export function fuselageAt(x) {
  const t = FUSELAGE.stations;
  return { halfWidth: interp(t, x, 1), topZ: interp(t, x, 2), bottomZ: interp(t, x, 3) };
}

// ---------------------------------------------------------------------------------------------
// wing (per side; mirror y for the left). Planform from AC 2-2-0 plan view scans, checked against
// the AC labels (engines within 0.15 m, tip LE 46.97, tip chord 3.98, fence TE 52.07).
// ---------------------------------------------------------------------------------------------
export const WING = {
  area: 845, span: 79.75, sweep25: 33.5, aspectRatio: 7.53, // [S]
  sweepLE: { inner: 41.2, outer: 36.4, crankY: 13.8 }, // [D] LE crank under the inboard pylon
  sweepTE: { inner: 14.8, outer: 22.4, kinkY: 11.5 }, // [D]
  dihedral: 5.6, // [S] Flight International ("gulling", static reference)
  dihedralStaticMRW: { inner: 9.5, outer: 1.5 }, // [D] chord-plane slopes at MRW on the ground (fuel droop)
  rootY: 3.57, // [D] fuselage side
  rootLE: { x: 18.45, y: 3.57, filletFromX: 17.67 }, // [D]; AC labels the root LE 17.67 (start of the LE fillet)
  rootChord: 18.4, // [D] at the fuselage side (LE 18.45 -> TE 36.86); < 18.3 m exit-distance limit quoted by Flight
  centrelineChord: 20.2, // [D] LE/TE lines extended to y = 0
  tipChord: 3.98, // [S] AC 2-2-0
  tipLE: { x: 46.97, y: 39.875 }, // [S]
  // Leading edge polyline [x, y] root -> tip [D]
  le: [[18.45, 3.57], [19.83, 4.5], [21.2, 6], [22.85, 8], [24.51, 10], [26.16, 12], [27.73, 13.8], [30.09, 17],
    [33.77, 22], [38.18, 28], [41.86, 33], [45.54, 38], [46.97, 39.875]],
  // Trailing edge polyline [x, y] (between flap-track fairings) [D]
  te: [[36.86, 3.57], [37.24, 5], [38.03, 8], [38.83, 11], [39.03, 11.5], [39.97, 14], [41.18, 17], [42.4, 20],
    [43.61, 23], [44.4, 25], [45.68, 28], [46.99, 31], [48.3, 34], [49.61, 37], [50.95, 39.875]],
  // Chord-plane height and thickness by span, static at MRW: [y, zMid, thickness, t/c] [D]+[E]
  // zMid from the AC front view, lowered by the measured MRW droop (outboard nacelle 2.38 -> 1.90,
  // fence bottom 6.60 -> 5.24). Thickness from the front view silhouette; root t/c estimated.
  z: [[3.57, 3.95, 2.3, 0.125], [6, 4.4, 1.85, 0.12], [10, 5.05, 1.41, 0.1], [14.8, 5.59, 1.12, 0.095],
    [20, 6.12, 0.89, 0.088], [25.7, 6.3, 0.72, 0.088], [30, 6.39, 0.61, 0.088], [35, 6.39, 0.49, 0.09],
    [38, 6.35, 0.42, 0.093], [39.875, 6.33, 0.38, 0.095]],
  rootZ: 3.95, // [E] chord plane at the fuselage side; upper surface ~5.1 just under the main deck floor [D]
  // Wingtip fence (A380 arrow-head fence on the aft part of the tip) [D] AC side view + W1/W2.
  fence: { height: 2.28, above: 1.18, below: 1.1, xLE: 49.16, xTE: 52.07, topChord: [51.59, 52.01], bottomChord: [50.79, 51.12], y: 39.875 },
  // In-flight bend relative to static MRW: dz = liftFraction * tipRise * ((y - 3.57) / 36.3)^2.24. [E]
  bend: { tipRise: 2.0, exponent: 2.24 },
};
/** Leading/trailing edge x and chord at span y (|y|). */
export function wingAt(y) {
  const a = Math.abs(y);
  const xs = (poly) => {
    if (a <= poly[0][1]) return poly[0][0];
    for (let i = 1; i < poly.length; i++) if (a <= poly[i][1]) return lerp(poly[i - 1][0], poly[i][0], (a - poly[i - 1][1]) / (poly[i][1] - poly[i - 1][1]));
    return poly[poly.length - 1][0];
  };
  const le = xs(WING.le), te = xs(WING.te);
  const zt = WING.z.map((r) => [r[0], r[1], r[2]]);
  return { le, te, chord: te - le, zMid: interp(zt, a, 1), thickness: interp(zt, a, 2) };
}
/** Extra height of the wing (and anything hung on it) at span y for a lift fraction 0..1 (1 = 1 g). */
export function wingBend(y, liftFraction) {
  const s = clamp((Math.abs(y) - WING.rootY) / (39.875 - WING.rootY), 0, 1);
  return clamp(liftFraction, 0, 1.2) * WING.bend.tipRise * Math.pow(s, WING.bend.exponent);
}

// ---------------------------------------------------------------------------------------------
// engines: four Rolls-Royce Trent 970/972 (A380-841/-842). GP7270 data alongside for the -861.
// ---------------------------------------------------------------------------------------------
const nac = (id, side, y, lip, cz, rev) => ({
  id, side, y, // [S] AC 2-2-0 tracks 29.6 / 51.4
  inletLipX: lip, // [S] AC 2-2-0: most forward point of the scarfed inlet (top lip)
  inletLipBottomX: +(lip + 0.33).toFixed(2), // [S] AC 2-12-0 nose cowl 1.63 top / 1.30 bottom
  fanFaceX: +(lip + 1.88).toFixed(2), // [E] fan blade LE just behind the fan-case front flange
  spinnerTipX: +(lip + 0.84).toFixed(2), // [D] AC 2-12-0 0.79 m spinner tip to front flange
  fanNozzleExitX: +(lip + 6.2).toFixed(2), // [S] 1.63 + 2.18 + 2.39
  primaryNozzleExitX: +(lip + 6.93).toFixed(2), // [D] AC drawing
  plugTipX: +(lip + 8.39).toFixed(2), // [S] + 2.19
  centreZ: cz, // [D] AC MRW nacelle ground clearance + 1.94
  thrustReverser: rev, // [S] TCDS E.012 & AC 2-12-0: reversers on the inboard engines only
  pylon: pylonFor(y, lip, cz), // [E] shape
});
function pylonFor(y, lip, cz) {
  const w = wingAt(y);
  return {
    frontX: +(lip + 1.0).toFixed(2), frontZ: +(cz + 1.94).toFixed(2), // on the fan cowl top
    wingFrontX: +(w.le + 0.15 * w.chord).toFixed(2), wingAftX: +(w.le + 0.65 * w.chord).toFixed(2), // front spar .. mid chord
    wingZ: +(w.zMid - w.thickness / 2).toFixed(2), // wing lower surface (static MRW)
    aftTipX: +(w.le + 0.75 * w.chord).toFixed(2), aftTipZ: +(w.zMid - w.thickness / 2 - 0.35).toFixed(2), // aft fairing under the wing, toward the flaps
    width: 0.9,
  };
}
export const ENGINES = {
  type: "Rolls-Royce Trent 970-84 / 972-84 (A380-841/-842)", // [S] TCDS A.110
  list: [
    nac(1, "L", -25.7, 29.94, 3.84, false),
    nac(2, "L", -14.8, 22.23, 3.005, true),
    nac(3, "R", 14.8, 22.23, 3.005, true),
    nac(4, "R", 25.7, 29.94, 3.84, false),
  ],
  nacelle: {
    length: 8.39, lengthBottom: 8.06, // [S] AC 2-12-0 (lip to plug tip)
    maxDiameter: 3.88, // [S] AC 2-12-0
    heightWithPylonRoot: 3.9, // [S] AC 2-12-0
    noseCowl: 1.63, noseCowlBottom: 1.3, fanCowl: 2.18, reverserOrFanExhaustCowl: 2.39, primaryNozzleAndPlug: 2.19, // [S]
    inletHighlightDiameter: 3.26, // [E] from the AC front view
    fanNozzleExitDiameter: 2.41, // [E] AC side view
    primaryNozzleExitDiameter: 1.67, // [E] AC side view
    plugBaseDiameter: 0.99, plugLength: 1.46, // [E] AC side view
    reverser: "fixed cascade, translating cowl and blocker doors (inboard nacelles); outboard: fixed fan duct", // [S] AC 2-12-0
    reverserTranslation: 0.7, // [E]
    fanCowlOpen: { initial: 40, full: 50 }, // [S] AC 2-12-0 (maintenance)
  },
  pylonNote: "per engine in list[i].pylon: from the fan-cowl top aft to the wing front spar, then an aft fairing under the wing to ~75% chord (E)",
  fan: { diameter: 2.95, blades: 24, rotation: "anticlockwise viewed from the rear (LP/IP)" }, // [S] TCDS E.012 (2.95, rotation); 24 blades [S] RR/secondary
  bareEngine: { length: 5.4775, maxDiameter: 3.944, dryMassKg: 6246 }, // [S] TCDS E.012
  spools: "three-shaft: LP 1 fan + 5 turbine stages, IP 8 compressor + 1, HP 6 + 1", // [S] TCDS E.012
  thrustKN: { "970-84": 334.29, "972-84": 341.41 }, // [S] TCDS E.012 take-off (5 min), flat rated 30 C
  n1: {
    rpmAt100: 2900, // [S] TCDS E.012 LP reference speed
    takeoffLimit: 97.2, // [S] TCDS E.012 max for take-off (5 min)
    groundIdle: 20, // [E] FBW A380X SOP/FlightGear (~20%; N2 ~66%)
    takeoffTypical: 94, // [E] typical FLEX/TOGA band 88-95; the figure uses 94
    toga: 95, // [E]
    climb: 88, // [E] CL detent
    taxiBreakaway: 30, // [E]
    stabilise: 50, // [E] Airbus: stabilise before FLX/TOGA (FBW SOP "25% THR" ~ 50% N1)
    groundKeepOut: [64, 72], // [S] TCDS: no stabilised operation on ground below 60 kt
    groundCapBelow32kt: 78, // [S] TCDS "Modified Engine Take-Off Thrust Setting" below 32.5 kt
    groundCapSpeedKt: 32.5, // [S]
  },
  spool: {
    accel15to95PctPowerS: 5.6, // [S] TCDS E.012 note 12
    tauUp: 1.9, // [D] first-order N1 lag: 3 tau ~ 5.6 s
    tauDown: 3.0, // [E]
    startS: 50, // [E] master ON to stable idle (FADEC dry crank 20 s at N2 20% per FBW SOP)
    startOrder: [[1, 2], [3, 4]], // [S-secondary] Airbus/FBW: 1 & 2 together, then 3 & 4
  },
  gp7200: { // [S] TCDS IM.E.026 (A380-861), Engine Alliance
    n1RpmAt100: 2467, n1Max: 111, groundIdleRpm: 450, fanDiameter: 2.96, blades: 24, takeoffKN: { GP7270: 332.4, GP7277: 357.2 },
    length: 4.92, fanCaseDiameter: 3.143, dryMassKg: 6718,
  },
};

// ---------------------------------------------------------------------------------------------
// empennage
// ---------------------------------------------------------------------------------------------
export const EMPENNAGE = {
  fin: {
    rootLineZ: 9.47, // [D] AC side view (horizontal root line inside the tail cone top)
    rootLE: [53.94, 0, 9.47], // [S] AC 2-2-0 53.94 m
    rootChord: 12.06, // [S] AC 2-2-0
    tipLE: [68.02, 0, 24.06], // [S] 53.94 + 14.08
    tipChord: 4.7, // [S]
    height: 14.59, // [S]
    sweepLE: 44.0, sweepTE: 24.7, // [D]
    area: 122, // [D] trapezoid (published ~123)
    dorsalFillet: [[53.92, 9.47], [55.88, 11.5]], // [D] side view
    tipZ: 24.145, // [S] VT at MRW
    rudders: [ // [D] AC side view: hinge (62.55, 9.94) -> (71.42, 24.08), split at z 14.45
      { id: "lower", z: [9.94, 14.45] },
      { id: "upper", z: [14.45, 24.08] },
    ],
    rudderHinge: [[62.55, 9.94], [71.42, 24.08]],
    rudderDeflection: 30, // [E]
    material: "CFRP", // [S] (Stade)
  },
  tailplane: {
    span: 30.37, // [S] AC 2-2-0
    rootLECentreline: 57.28, // [D] 68.85 - 11.57
    tipLE: [68.85, 15.185], // [S]
    tipChord: 3.72, // [S]
    centrelineChord: 9.65, // [D]
    sweepLE: 37.3, sweepTE: 19.9, // [D]
    dihedral: 6, // [E] AC front view mid-surface 6.2 deg; HT/HT1 heights
    area: 205, // [D] (published 205.6)
    rootZ: 7.5, tipZ: 9.175, // [S] HT at MRW; root [D]
    le: [[57.28, 0], [59.63, 3.25], [67.48, 13.55], [68.85, 15.185]], // [D]
    te: [[66.93, 0], [68.38, 4], [70.55, 10], [72.0, 14], [72.57, 15.185]], // [D]
    fuselageJunction: [[58.09, 2.49], [60.56, 2.01], [64.14, 1.73]], // [D]
    elevators: [ // [D] hinge (64.78, 1.63) -> (70.57, 13.64), split at y 5.46 (4 elevators)
      { id: "inner", y: [1.63, 5.46] },
      { id: "outer", y: [5.46, 13.64] },
    ],
    elevatorHinge: [[64.78, 1.63], [70.57, 13.64]],
    trimmable: true, // THS
  },
  apu: { type: "Pratt & Whitney Canada PW980A", exhaust: [70.4, 0, 8.29], compartment: "frames 110-117" }, // [S] TCDS A.110, AC 2-12-0; position [D]
};

// ---------------------------------------------------------------------------------------------
// controls: high lift, roll, spoilers. Spanwise y per wing, measured from AC 2-3-0 front/rear views.
// ---------------------------------------------------------------------------------------------
// Drive positions (synchro/FPPU degrees) to surface angle, from the FlyByWire A380X SFCC model. [E]
const FLAP_MAP = [[0, 0], [122.2, 0], [215.68, 8], [259.28, 17], [279.84, 22], [297.59, 26], [338.99, 33]];
const SLAT_MAP = [[0, 0], [286.48, 20], [327.39, 23]];
const invMap = (map, deg) => {
  if (deg <= 0) return 0;
  for (let i = 1; i < map.length; i++) {
    const a = map[i - 1], b = map[i];
    if (deg <= b[1] && b[1] > a[1]) return lerp(a[0], b[0], (deg - a[1]) / (b[1] - a[1]));
  }
  return map[map.length - 1][0];
};
export const CONTROLS = {
  conf: [ // [S-secondary] slats/flaps: Airliners.net (EADS), A380 pilot blog, FBW SFCC; FULL 33 (32 in one source)
    { id: "0", slat: 0, flap: 0, aileronDroop: 0, vfe: null },
    { id: "1", slat: 20, flap: 0, aileronDroop: 0, vfe: 263 },
    { id: "1+F", slat: 20, flap: 8, aileronDroop: 5, vfe: 222 },
    { id: "2", slat: 20, flap: 17, aileronDroop: 5, vfe: 220 },
    { id: "3", slat: 23, flap: 26, aileronDroop: 5, vfe: 196 },
    { id: "FULL", slat: 23, flap: 33, aileronDroop: 5, vfe: 182 },
  ], // vfe [E] sim manual; aileron droop 5 in 1+F [S-secondary], other confs [E]
  transit: { // [E] FlyByWire A380X hydraulic model, two motors, full pressure
    flapFullS: 37.6, slatFullS: 31.7,
    flapDrivePerS: 9.02, slatDrivePerS: 10.33, // drive degrees per second
    extendOrder: "slats first, then flaps", retractOrder: "flaps first, then slats", // [S] Airbus patent (times add)
    examples: { conf0to1: 27.8, conf1to1F: 23.9, conf1Fto2: 4.8, conf2to3: 4.2 + 4.0, conf3toFull: 4.6 },
  },
  flapMap: FLAP_MAP, slatMap: SLAT_MAP,
  droopNose: [ // [D] AC 2-2-0 p035 re-scan (truth amendment T1); gap at the inboard pylon 13.88-15.60
    { id: "DN1", y: [7.2, 10.32] }, { id: "DN2", y: [10.32, 13.88] },
  ],
  droopNoseDeflection: "moves with the slat schedule (about 20/23 deg)", // [E]
  slats: [ // [D] AC 2-2-0 p035 re-scan (truth amendment T1); gap at the outboard pylon 24.61-26.45
    { id: "S2", y: [15.6, 18.41] }, { id: "S3", y: [18.41, 21.51] }, { id: "S4", y: [21.51, 24.61] },
    { id: "S5", y: [26.45, 30.12] }, { id: "S6", y: [30.12, 33.8] }, { id: "S7", y: [33.8, 38.05] },
  ],
  flaps: [ // [D] AC 2-3-0; single-slotted Fowler flaps [E]
    { id: "inner", y: [4.43, 12.45] }, { id: "mid", y: [12.45, 18.99] }, { id: "outer", y: [18.99, 25.53] },
  ],
  flapTracks: [ // [S] fairing stations from AC 2-2-0; track 1 inside the belly fairing [E]; aft tip x [D]
    { id: 1, y: 5.0, tipX: null }, { id: 2, y: 9.36, tipX: 39.22 }, { id: 3, y: 13.49, tipX: 40.8 },
    { id: 4, y: 17.65, tipX: 43.44 }, { id: 5, y: 21.87, tipX: 45.11 }, { id: 6, y: 25.97, tipX: 46.65 },
  ],
  flapTravelAft: 0.18, // [E] Fowler aft travel at 33 deg as a fraction of local chord
  ailerons: [ // [D] AC 2-3-0
    { id: "inner", y: [26.0, 27.76] }, { id: "mid", y: [27.76, 31.14] }, { id: "outer", y: [31.14, 35.24] },
  ],
  aileronRange: [-30, 20], // [E] up/down
  spoilers: [ // [D] AC 2-3-0 (8 per wing, numbered from the root)
    { id: 1, y: [4.14, 8.9] }, { id: 2, y: [8.9, 12.01] }, { id: 3, y: [12.77, 15.62] }, { id: 4, y: [15.62, 19.58] },
    { id: 5, y: [19.58, 23.05] }, { id: 6, y: [23.05, 26.21] }, { id: 7, y: [26.21, 28.93] }, { id: 8, y: [28.93, 32.08] },
  ],
  spoilerRange: { ground: 50, speedbrake: 30, roll: 35 }, // [E]
};
/** Surface angles for drive positions. */
export const flapAngle = (drive) => interp(FLAP_MAP, drive);
export const slatAngle = (drive) => interp(SLAT_MAP, drive);
/** Configuration name for actual slat/flap angles (nearest; "moving" when between detents). */
export function confName(slat, flap) {
  let best = CONTROLS.conf[0], d = 1e9;
  for (const c of CONTROLS.conf) {
    const e = Math.abs(c.slat - slat) + Math.abs(c.flap - flap);
    if (e < d) { d = e; best = c; }
  }
  return best.id;
}
/** The flaps lever position (0 "0", 1 "1" or "1+F", 2, 3, 4 "FULL") of a configuration name. */
export const LEVER_POSITIONS = ["0", "1", "2", "3", "FULL"];
export function leverOfConf(name) {
  return name === "0" ? 0 : name === "1" || name === "1+F" ? 1 : name === "2" ? 2 : name === "3" ? 3 : 4;
}

// ---------------------------------------------------------------------------------------------
// landing gear
// ---------------------------------------------------------------------------------------------
export const GEAR = {
  tyres: { main: { size: "1400x530 R23 40PR", diameter: 1.4, width: 0.53, bar: 15 }, nose: { size: "1270x455 R22 32PR", diameter: 1.27, width: 0.455, bar: 14.1 } }, // [S] AC 7-2-0
  staticLoadedRadius: { main: 0.65, nose: 0.6 }, // [E]
  nose: {
    wheels: 2, axle: [4.97, 0, 0.6], wheelY: [-0.525, 0.525], // [S] x, spacing 1.05; z [E]
    trunnion: [5.3, 0, 3.0], // [E]
    retracts: "forward into the bay under the cockpit", // [S] AC 2-9-0
    bay: { x: [2.6, 5.9], halfWidth: 1.0 }, // [E]
    doors: [
      { id: "fwdL", kind: "hydraulic, closes after transit", hinge: "longitudinal, y -1.05", width: 1.89, openDeg: 62 }, // [S] AC 2-7-0 (R 1.89, 62 deg); hinge [E]
      { id: "fwdR", kind: "hydraulic, closes after transit", hinge: "longitudinal, y +1.05", width: 1.89, openDeg: 62 },
      { id: "aftL", kind: "linked to the leg, open while the gear is down", openDeg: 69.2 }, // [S] AC 2-7-0 (69.2 deg)
      { id: "aftR", kind: "linked to the leg, open while the gear is down", openDeg: 69.2 },
    ],
    steering: "nose wheel steering by hand wheels", // [S]
  },
  wing: {
    wheels: 4, centre: [33.575, 6.228], // [D] 4.97 + 28.605; [S] track 12.456
    axleX: [32.725, 34.425], wheelY: [-0.675, 0.675], // [S] axles 1.70 apart, wheels 1.35 apart
    pintleZ: 4.3, // [E] leg top on the wing rear spar / gear beam
    legLength: 3.65, // [E] pintle to bogie pivot
    retracts: "sideways inboard toward the centreline, bogie into the belly bay", // [S] AC 2-9-0
    bay: { x: [30.91, 34.86], y: [1.71, 4.28] }, // [S] AC 2-7-0 main door
    doors: [
      { id: "main", kind: "hydraulic, belly, hinged at y 1.71, closes after transit", length: 3.95, openDeg: 79, openGroundClearance: [0.1, 0.25] }, // [S] AC 2-7-0
      { id: "hinged", kind: "on the leg" }, { id: "fairing", kind: "fixed to the leg" }, { id: "auxiliary", kind: "mechanical" }, // [S] AC 2-9-0
    ],
    brakes: "carbon brakes on all 4 wheels", // [S]
    bogieTrim: "bogie trim actuator positions the bogie for retraction", // [S]
    hydraulics: "green", // [S] Airbus UK 2008
  },
  body: {
    wheels: 6, centre: [36.851, 2.632], // [D]/[S]
    axleX: [35.151, 36.851, 38.551], // [D] 1.70 apart
    wheelY: { front: [-0.765, 0.765], centre: [-0.775, 0.775], rear: [-0.765, 0.765] }, // [S] 1.53 / 1.55 / 1.53
    trunnionZ: 3.3, legLength: 2.7, // [E]
    rearAxleSteering: true, // [S]
    retracts: "rearward into the fuselage bay", // [S] AC 2-9-0
    bay: { x: [35.67, 40.84] }, // [S] AC 2-7-0 outer doors
    doors: [
      { id: "outer", kind: "hydraulic, hinged on its outboard edge, closes after transit (leaves a slot for the leg)", length: 5.17, openDeg: 99, openGroundClearance: [0.25, 0.35] }, // [S] AC 2-7-0
      { id: "centre", kind: "hydraulic, closes after transit" }, // [S] AC 2-9-0
      { id: "inner", kind: "small door near the leg", radius: 1.32, openDeg: 94 }, // [S] AC 2-7-0
    ],
    brakes: "front and centre axles; park brake on the BLG only", // [S] AC 2-9-0
    hydraulics: "yellow", // [S]
  },
  weightOnMainGearPct: 95.1, // [S] AC 7-2-0 (WV000)
  timing: { // [E] retraction ~16 s observed on the first-flight video; extension ~20 s
    retract: { doorsOpen: 3, legs: 10, doorsClose: 3, total: 16 },
    // fu/gear: the body gear's legs start bodyLag s after the wing and nose gear's on extension (truth §9), so the doors
    // close bodyLag s later: 3 + 2 + 11 + 4 = 20 s; retraction moves all five legs together
    extend: { doorsOpen: 3, legs: 11, doorsClose: 4, bodyLag: 2, total: 20 },
    // fu/gear end
  },
};

// ---------------------------------------------------------------------------------------------
// doors
// ---------------------------------------------------------------------------------------------
const pdoor = (id, deck, x, sill, side) => ({
  id, deck, x, side, sillZ: sill, // [S] AC 2-7-0 stations, AC 2-3-0 sills (MRW mean)
  width: 1.07, height: deck === "main" ? 1.9 : 1.92, // [S] clear opening
  leafWidth: 1.26, leafHeight: deck === "main" ? 2.13 : 2.11, // [S] AC 2-7-0 door leaf incl. structure
  type: id.startsWith("M3") ? "Type A emergency exit (over-wing ramp/slide, no raft)" : "Type A, dual-lane slide/raft",
  opens: "plug door: handle unlocks and lifts it, then it swings outward and forward on its support arm and parks parallel to the skin, forward of the opening",
  parkedOffset: id.startsWith("M3") ? 0.7 : 0.72, sweep: 2.51, // [S] AC 2-7-0 (door skin 0.72 m outboard of the scuff plate; 2.51 m swing envelope)
  openS: 8, // [E] electrically assisted
});
export const DOORS = {
  passenger: [
    ...[["M1", 6.32, 5.115], ["M2", 16.5, 5.13], ["M3", 32.68, 5.15], ["M4", 44.74, 5.165], ["M5", 53.63, 5.18]].flatMap(([n, x, s]) => [pdoor(n + "L", "main", x, s, "L"), pdoor(n + "R", "main", x, s, "R")]),
    ...[["U1", 20.94, 7.88], ["U2", 40.3, 7.905], ["U3", 49.19, 7.925]].flatMap(([n, x, s]) => [pdoor(n + "L", "upper", x, s, "L"), pdoor(n + "R", "upper", x, s, "R")]),
  ],
  cargo: [
    { id: "FWD", x: 11.73, side: "R", sillZ: 3.065, width: 3.11, height: 1.75, opens: "top-hinged, hydraulic, swings up and outward (hinge radius 2.99 m)", openS: 20 }, // [S] AC 2-7-0; time [E]
    { id: "AFT", x: 48.07, side: "R", sillZ: 3.105, width: 2.79, height: 1.75, opens: "top-hinged, hydraulic, swings up and outward (hinge radius 3.07 m)", openS: 20 },
    { id: "BULK", x: 51.09, side: "R", sillZ: 3.235, width: 1.13, height: 0.99, opens: "manual, swings inward and up (radius 1.40 m)", openS: 6 }, // height [E] from section B-B
  ],
  gateOps: { // [S] AC 5-2-1 standard turn-round (90 min, 555 pax)
    bridges: ["M2L", "U1L"], catering: ["M2R", "M4R", "U1R", "M5L"], cargo: ["FWD", "AFT", "BULK"],
  },
  slides: "16 slides: dual-lane slide/rafts at every door; M3L/R ramp/slides without raft, stowed in the belly fairing", // [S] AC 2-8-0
};
export const DOOR_IDS = DOORS.passenger.map((d) => d.id).concat(DOORS.cargo.map((d) => d.id));

// ---------------------------------------------------------------------------------------------
// windows
// ---------------------------------------------------------------------------------------------
export const WINDOWS = {
  pitch: 0.635, // [S-secondary] 25 in frame pitch; [D] 0.635-0.642 measured on AC 2-2-0
  size: { width: 0.26, height: 0.33 }, // [E] AC side view; similar to A330/A340 windows
  centreAboveFloor: 1.05, // [D] AC side view (z 6.20 main, 8.95 upper)
  mainZ: 6.2, upperZ: 8.95,
  // per side (mirror for the other side). Upper deck [D] AC 2-2-0 (52/side); main deck [D] 40 seen + 17 behind the wing [E]
  upper: [13.02, 13.65, 14.29, 14.92, 15.55, 16.19, 16.83, 17.46, 18.09, 18.73, 19.37, 22.54, 23.2, 23.86, 24.52, 25.18, 25.85,
    26.51, 27.17, 27.83, 28.49, 29.15, 29.81, 30.46, 31.12, 31.73, 32.37, 33.01, 33.64, 34.28, 34.92, 35.54, 36.18, 36.82,
    37.45, 38.08, 38.72, 41.9, 42.54, 43.17, 43.8, 44.44, 45.07, 45.7, 46.34, 46.98, 47.61, 50.79, 51.42, 52.06, 52.69, 53.32],
  main: [7.94, 8.57, 9.21, 9.84, 10.47, 11.11, 11.74, 12.38, 13.01, 13.65, 14.28, 14.92, 18.11, 18.75, 19.39, 20.02, 20.65,
    21.29, 21.92, 22.56, 23.19, 23.84, 24.53, 25.17, 25.85, 26.51, 27.17, 27.82, 28.49, 29.14, 29.81, 30.45, 31.09,
    34.27, 34.91, 35.55, 36.2, 36.84, 37.48, 38.12, 38.76, 39.41, 40.05, 40.69, 41.33, 41.97, 42.62, 43.26, 46.98, 47.61,
    48.25, 48.89, 49.52, 50.15, 50.79, 51.42, 52.06],
  counts: { upperPerSide: 52, mainPerSide: 57, total: 218 }, // [D]; "about 220" [S-secondary]
  cockpit: { // [D] AC 2-2-0 front and side views: three panes per side; [y, z] polygons for the right side
    panes: [
      { id: "windshield", front: [[0.05, 6.9], [0.18, 6.84], [0.86, 6.88], [0.9, 6.94], [0.8, 7.29], [0.69, 7.36], [0.05, 7.27]], x: [1.92, 2.29] },
      { id: "forwardSide", front: [[0.96, 7.01], [1.04, 6.91], [1.59, 6.71], [1.62, 6.77], [1.16, 7.37], [1.1, 7.41], [0.91, 7.41], [0.87, 7.37]], x: [2.45, 2.96], opens: "slides open (crew escape with ropes; T3)" },
      { id: "aftSide", front: [[1.26, 7.36], [1.77, 6.69], [1.9, 6.75], [1.91, 6.82], [1.65, 7.24], [1.43, 7.4], [1.26, 7.4]], x: [2.99, 3.96] }, // [S] AC 2-8-0
    ],
    pilotEye: { x: 2.92, y: 0.53, z: 7.17 }, // [S] AC 4-4-0: 2.92 m from the nose to the eye line (truth amendment T3); eye 7.17 m; y [E]
    visibility: { up: 31, down: 19.5, sideAft: 121 }, // [S] AC 4-4-0
  },
};

// ---------------------------------------------------------------------------------------------
// cabin: Airbus standard 3-class, 555 seats (22 F, 96 J, 437 Y) [S] AC 2-4-0 / 5-2-1.
// Row stations [D]: AC plan views remapped so each door's cross-aisle sits on its AC station.
// Lateral layouts [S] AC 2-5-0 cross sections. y > 0 is the right side.
// ---------------------------------------------------------------------------------------------
export const CABIN = {
  config: "Airbus A380-800 standard 3-class (AC 2-4-0, as used in the AC 5-2-1 turn-round): 555 seats",
  decks: {
    main: {
      seats: 356, floorZ: 5.15,
      zones: [
        { cls: "F", seats: 22, abreast: "2-2-2", seatWidth: 1.45, aisle: 0.97, pitch: 1.81, x: [10.04, 15.47],
          sideRows: [10.04, 11.85, 13.66, 15.47], centreRows: [11.54, 13.35, 15.16] },
        { cls: "Y", seats: 334, abreast: "3-4-3", seatWidth: 0.52, tripleWidth: 1.57, aisle: 0.51, pitch: 0.8, x: [19.97, 52.44],
          sideRows: [19.97, 20.77, 21.57, 22.38, 23.18, 23.98, 24.79, 25.59, 26.39, 27.2, 28.0, 28.8, 29.61, 30.41, 31.21, 34.17, 34.97,
            35.78, 36.58, 37.38, 38.18, 38.99, 39.79, 40.59, 41.39, 42.19, 46.22, 46.99, 47.76, 48.56, 49.33, 50.1, 50.87, 51.67, 52.44],
          centreRows: [22.06, 22.86, 23.66, 24.46, 25.27, 26.07, 26.87, 27.68, 28.48, 29.28, 30.09, 30.89, 31.69, 34.03, 34.84, 35.64,
            36.44, 37.24, 38.04, 38.85, 39.65, 40.45, 41.25, 42.05, 46.44, 47.23, 48.03, 48.82, 49.62, 50.42, 51.21, 52.01] },
      ],
      layoutY: { F: [-2.5, -1.95, -0.36, 0.36, 1.95, 2.5], Y: [-2.87, -2.35, -1.83, -0.81, -0.27, 0.27, 0.81, 1.83, 2.35, 2.87] }, // [D] the triples moved out 0.10 m: aisles 0.50 m (AC 2-5-0: 0.51; review round 2)
      monuments: [ // [D] x ranges
        { kind: "stair", note: "short stair up to the flight deck", x: [4.86, 6.29] },
        { kind: "coat", x: [4.86, 6.29] }, { kind: "lav", x: [7.7, 8.67], count: 2 },
        { kind: "stair", note: "forward straight stair to the upper deck", x: [7.74, 10.08] },
        { kind: "galley", x: [16.34, 21.07], note: "galleys and a cart lift at M2" },
        { kind: "lav", x: [31.66, 33.26], count: 3, note: "at M3" },
        { kind: "galley", x: [42.58, 45.32], note: "at M4" },
        { kind: "lav", x: [52.48, 55.6], count: 3 }, { kind: "lift", x: [54.38, 54.91] },
        { kind: "stair", note: "aft spiral stair", x: [55.09, 56.59] },
      ],
    },
    upper: {
      seats: 199, floorZ: 7.9,
      zones: [
        { cls: "J", seats: 30, abreast: "2-2-2", seatWidth: 0.69, pairWidth: 1.37, aisle: 0.58, pitch: 1.17, x: [13.67, 18.57],
          sideRows: [13.67, 14.84, 16.0, 17.17, 18.34], centreRows: [13.9, 15.07, 16.23, 17.4, 18.57] },
        { cls: "J", seats: 66, abreast: "2-2-2", seatWidth: 0.69, pairWidth: 1.37, aisle: 0.58, pitch: 1.17, x: [23.71, 35.78],
          sideRows: [24.09, 25.26, 26.43, 27.6, 28.77, 29.93, 31.1, 32.27, 33.44, 34.61, 35.78],
          centreRows: [23.71, 24.88, 26.05, 27.22, 28.39, 29.56, 30.72, 31.89, 33.06, 34.23, 35.4] },
        { cls: "Y", seats: 103, abreast: "2-4-2", seatWidth: 0.54, pairWidth: 1.07, aisle: 0.51, pitch: 0.78, x: [36.82, 47.58],
          sideRows: [37.16, 37.94, 38.72, 41.14, 41.91, 42.69, 43.47, 44.25, 45.03, 45.81, 46.59, 47.37],
          centreRows: [36.82, 37.6, 38.38, 39.16, 40.56, 41.34, 42.12, 42.9, 43.68, 44.46, 45.24, 46.02, 46.8, 47.58] },
      ],
      layoutY: { J: [-2.31, -1.62, -0.34, 0.34, 1.62, 2.31], Y: [-2.4, -1.86, -0.8, -0.27, 0.27, 0.8, 1.86, 2.4] }, // [D]
      monuments: [
        { kind: "stair", note: "top of the forward stair", x: [8.77, 11.89] }, { kind: "coat", x: [9.37, 11.85] },
        { kind: "lav", x: [9.39, 12.73], count: 2 },
        { kind: "galley", x: [18.9, 22.62], note: "galleys and a cart lift at U1" }, { kind: "lav", x: [22.35, 23.25], count: 2 },
        { kind: "lav", x: [48.78, 50.18], count: 3, note: "at U3" }, { kind: "galley", x: [50.17, 53.4] },
        { kind: "crewRest", x: [50.18, 54.57], note: "5 bunks" }, { kind: "lift", x: [53.4, 53.94] },
        { kind: "stair", note: "top of the aft spiral stair", x: [53.82, 55.63] },
      ],
    },
  },
  stairs: [
    { id: "forward", type: "straight, wide", x: [7.7, 11.9], y: [-0.85, 0.75], rises: "between the main deck behind M1 and the front of the upper deck" }, // [D]
    { id: "aft", type: "spiral", x: [54.2, 56.0], centre: [55.1, -0.2], diameter: 2.3 }, // [D]
  ],
  flightDeck: { // [S] Avionics Today / FlightGlobal / AC; seats [E]
    pilotSeats: 2, observerSeats: 2, floorZ: 6.0,
    displays: { count: 8, sizeIn: [6, 8], layout: ["PFD", "ND", "MFD", "EWD", "SD", "MFD", "ND", "PFD"], note: "8 identical 6x8 in LCDs: PFD and ND per pilot, EWD and SD centre, 2 MFDs on the pedestal; plus 2 OIT screens" },
    sidesticks: "one on each outboard console, not linked", kccu: 2, hud: "optional", isis: 2,
    x: [1.4, 4.8], // [E]
  },
};

// ---------------------------------------------------------------------------------------------
// exterior lights. Positions [x, y, z] in the rest frame; coverage in degrees; colours as names.
// Inventory [S] AC 2-10-0 (items 1-19) + FBW A380X panel docs; positions [D] from AC 2-10-0 beam
// origins and dots, z [E] where the AC draws them only in plan. Flash timing [E] (A320-family
// Collins/AMM figures; A380 catalogue confirms a double wing strobe).
// ---------------------------------------------------------------------------------------------
export const LIGHTS = {
  nav: [
    { id: "navLeft", color: "red", at: [47.3, -39.8, 6.36], coverage: { from: 0, to: -110 } }, // [S] CS/FAR 25.1385-1387 sectors
    { id: "navRight", color: "green", at: [47.3, 39.8, 6.36], coverage: { from: 0, to: 110 } },
    { id: "navTail", color: "white", at: [70.25, 0, 8.99], coverage: { from: 110, to: 250 }, note: "140 deg aft cone (70 each side)" },
  ],
  obstruction: [ // [S] two white per wingtip, lit with NAV on the ground only; positions [E]
    { id: "obstrLeftTop", at: [51.8, -39.875, 7.5] }, { id: "obstrLeftBottom", at: [51.0, -39.875, 5.26] },
    { id: "obstrRightTop", at: [51.8, 39.875, 7.5] }, { id: "obstrRightBottom", at: [51.0, 39.875, 5.26] },
  ],
  beacon: [ // [S] two on top (offset), one under; red. [D] AC 2-10-0 plan
    { id: "beaconUpperL", at: [26.9, -0.8, 10.84] }, { id: "beaconUpperR", at: [26.9, 0.8, 10.84] },
    { id: "beaconLower", at: [24.7, 0, 1.78] },
  ],
  strobe: [ // [S] one per wingtip (double flash) + one below the tail cone (single)
    { id: "strobeLeft", at: [47.6, -39.85, 6.3], pattern: "double" },
    { id: "strobeRight", at: [47.6, 39.85, 6.3], pattern: "double" },
    { id: "strobeTail", at: [70.1, 0, 7.59], pattern: "single" }, // T6: on the APU blade [E]
  ],
  logo: [ // [S] one on each tailplane upper surface, lights the fin. Position [E]
    { id: "logoL", at: [63.5, -5.0, 8.3], aim: "fin" }, { id: "logoR", at: [63.5, 5.0, 8.3], aim: "fin" },
  ],
  wingScan: [{ id: "wingScanL", at: [11.24, -3.51, 6.4], aimAt: [45.9, -38.3, 6.4] }, { id: "wingScanR", at: [11.24, 3.51, 6.4], aimAt: [45.9, 38.3, 6.4] }], // [D] beam origin, z [E]
  engineScan: [{ id: "engineScanL", at: [8.42, -3.26, 6.0], aimAt: [24, -20, 3.4] }, { id: "engineScanR", at: [8.42, 3.26, 6.0], aimAt: [24, 20, 3.4] }], // [D]
  landing: [ // [S] two per wing root LE; [D] AC 2-10-0 (x 21.2, y 5.86, z 4.22 / 3.63)
    { id: "landL1", at: [21.17, -5.86, 4.22] }, { id: "landL2", at: [21.3, -5.86, 3.63] },
    { id: "landR1", at: [21.17, 5.86, 4.22] }, { id: "landR2", at: [21.3, 5.86, 3.63] },
  ],
  landingBeam: { toeOutDeg: 1.6, spreadH: 12, spreadV: 10, rangeM: 60 }, // [D] AC 2-10-0 plan; spreadV [E]
  taxi: [ // [S] one at each wing root LE + one on the NLG strut
    { id: "taxiL", at: [21.17, -5.86, 4.86], beam: { from: 0, to: -26 } }, { id: "taxiR", at: [21.17, 5.86, 4.86], beam: { from: 0, to: 26 } },
    { id: "taxiNose", at: [5.0, 0, 2.15], beam: { from: -15, to: 15 } },
  ],
  takeoff: [ // [S] three on the NLG strut; beam about +-15 deg [D]
    { id: "toNose1", at: [5.0, -0.3, 1.69] }, { id: "toNose2", at: [5.0, 0, 1.75] }, { id: "toNose3", at: [5.0, 0.3, 1.69] },
  ],
  runwayTurnoff: [ // [S] two on the NLG strut; [D] beams 15-73 deg off the nose each side
    { id: "rwyL", at: [5.29, -0.33, 1.27], beam: { from: -15, to: -73 } }, { id: "rwyR", at: [5.29, 0.33, 1.27], beam: { from: 15, to: 73 } },
  ],
  camera: [ // [S] NLG and MLG taxi-camera lights (ETACS); positions [E]
    { id: "camNoseL", at: [3.4, -1.6, 3.2] }, { id: "camNoseR", at: [3.4, 1.6, 3.2] },
    { id: "camWingL", at: [27.5, -9.0, 4.6] }, { id: "camWingR", at: [27.5, 9.0, 4.6] },
  ],
  cargoFlood: [{ id: "cargoFwd", at: [11.73, 3.3, 4.9] }, { id: "cargoAft", at: [48.07, 3.2, 4.9] }], // [S] item 18; positions [E]
  gearBay: [{ id: "bayNose", at: [4.2, 0, 2.9] }, { id: "bayWingL", at: [32.9, -3.0, 2.3] }, { id: "bayWingR", at: [32.9, 3.0, 2.3] }, { id: "bayBody", at: [38.3, 0, 2.6] }], // [S] item 19; [E]
  flash: { // [E]
    strobe: { periodS: 1.0, double: [[0, 0.05], [0.11, 0.16]], single: [[0, 0.05]] },
    beacon: { periodS: 1.0, offsetS: 0.5, on: 0.12 },
    note: "beacons flash between the strobe pulses; wing strobes double, tail strobe single",
  },
  autos: {
    strobeAuto: "on when the main gear struts are not compressed", // [S] FBW panel docs
    logoAuto: "on on the ground, and in flight with slats extended", // [S]
    obstruction: "with NAV, on the ground only", // [S]
    noseAndTurnoffOff: "the nose-strut lights (taxi, take-off, runway turn-off) go off when the gear retracts; the wing-root taxi lights stay on with NOSE", // [S] FBW A380X EXT LT
  },
};
/** Strobe/beacon intensity 0..1 at time t (seconds). kind: "double" | "single" | "beacon". */
export function flashAt(kind, t) {
  if (kind === "beacon") {
    const p = (((t - LIGHTS.flash.beacon.offsetS) % 1) + 1) % 1;
    return p < LIGHTS.flash.beacon.on ? 1 - p / LIGHTS.flash.beacon.on * 0.3 : 0;
  }
  const p = ((t % LIGHTS.flash.strobe.periodS) + LIGHTS.flash.strobe.periodS) % LIGHTS.flash.strobe.periodS;
  const pulses = kind === "double" ? LIGHTS.flash.strobe.double : LIGHTS.flash.strobe.single;
  for (const [a, b] of pulses) if (p >= a && p < b) return 1;
  return 0;
}

// ---------------------------------------------------------------------------------------------
// performance scenario for the figure [E]: 510 t take-off, CONF 1+F, FLEX
// ---------------------------------------------------------------------------------------------
export const PERF = {
  massKg: 510000, wingArea: 845, rho: 1.225,
  v1: 148, vr: 153, v2: 159, // [E] scaled from MTOW speeds by sqrt(W)
  sSpeed: 210, // [E] slat retraction (S) speed at this weight
  greenDot: 240, // [E]
  climbSpeed: 250, // [S] ATC 250 kt below 10 000 ft
  thrustReductionFt: 1500, accelerationFt: 1500, // [S] Airbus default (FBW SOP)
  rotationRateDegS: 3, // [S] Airbus Safety First "A focus on the take-off rotation"
  rotationPitch: 12.5, // [S-secondary] FBW A380X SOP initial pitch target (10 deg with an engine out)
  liftoffPitch: 10, // [S] Safety First: lift-off ~4-5 s after rotation start at ~10 deg pitch
  gearUpReactionS: 2, // [E] "positive climb" call to lever
  taxiSpeed: 18, taxiMaxStraight: 30, taxiTurn: 10, // [E] Airbus taxi guidance
  pushbackSpeed: 3, // [E]
  thrustPerEngineKN: 334.29, // [S] Trent 970-84
  rollingFriction: 0.015, // [E]
  cd0: { "0": 0.018, "1": 0.03, "1+F": 0.04, "2": 0.05, "3": 0.065, FULL: 0.085, gear: 0.015 }, // [E] zero-lift drag
  inducedK: 0.0528, // [E] 1 / (pi e AR), e 0.8, AR 7.53
  cl0: { "0": 0.25, "1": 0.55, "1+F": 0.8, "2": 0.95, "3": 1.1, FULL: 1.25 }, // [E] lift coefficient at zero body pitch
  clAlphaPerDeg: 0.087, // [E]
  groundCl: 0.45, // [E] ground roll in 1+F at zero pitch
};
const PUSH_DELAY = 5; // [E] s from doors shut / beacon ON (and the tug connected) to the tug moving
const PUSH_SECONDS = 141.2; // [E] phaseDone's wait from the push's start (it waits PUSH_SECONDS + 10 s and the tug clear); the roll itself is PUSH_ROLL_S
// fu/r2-interaction: the roll itself (sort review: 141 s at 3 kt pushed the aircraft 219 m straight back, three lengths). A
// stand push runs about one aircraft length onto the taxilane, then the tug holds the aircraft, connected, while engines
// 3 and 4 come to idle; it releases the wheel at TUG_RELEASE_S, 173 s into the phase as before (event order and the 185 s
// phase unchanged)
const PUSH_ROLL_S = 48; // [E] at 3 kt: about 76 m with the ramps (tools/model-test.mjs)
const TUG_RELEASE_S = 148; // [E] s from the push's start to the tug's release: 173 s into the phase, as with the long push

// ---------------------------------------------------------------------------------------------
// the pushback tug (follow-up, interaction): a towbarless tractor of the class rated for the A380 (TLD TPX-500-S,
// Goldhofer AST-1X). Its cradle closes round the nose wheels; it pushes the aircraft back, releases the wheel and
// drives off forward. State s.tug: 0 none, 0..1 driving in and picking up the nose wheel, 1 connected (pushing),
// 1..1.3 releasing the wheel, 1.3..2 driving off, 2 clear. truth.md §14a.
// ---------------------------------------------------------------------------------------------
export const TUG = {
  kind: "towbarless tractor, TLD TPX-500-S / Goldhofer AST-1X class", // [S] both rated for the A380 (TLD, Goldhofer)
  length: 9.21, // [S-secondary] TPX-500-MTS 9,210 mm (dealer data); AST-1X 490/680 9,490 mm (Airport Technology)
  width: 4.5, // [S-secondary] TPX-500-MTS 4,495 mm; AST-1X 4,500 mm
  height: 2.16, // [S-secondary] TPX-500-MTS 2,155 mm (cab roof)
  driveTyre: { size: "16.00-25", diameter: 1.49, width: 0.43 }, // [S] TLD TPX-500 sheet (size); diameter and width [D] from the nominal 16.00-25 dimensions
  steerTyre: { size: "295/60-22.5" }, // [S] TLD TPX-500 sheet
  maxNlgWidth: 1.58, // [S] TLD TPX-500 sheet: maximum nose-gear width 1,580 mm (A380 NLG over the tyres 1.505 m, D)
  maxNlgLoadKN: 420, // [S] TLD TPX-500 sheet
  grossT: 23.75, // [S] TLD TPX-500 sheet, without GPU
  maxSpeedKmh: 30, // [S] TLD TPX-500 sheet (AST-1X 32 km/h, Goldhofer)
  cradleClear: 0.06, // [E] figure: the cradle's arms and backplate stand 0.06 m off the nose tyres (the real pick-up clamps them)
  approachS: 18, // [E] drive in, line up and pick up the nose wheel (done before the doors are shut: 20 s)
  releaseS: 4, // [E] lower and release the nose wheel after the push
  driveOffS: 8, // [E] drive away forward, clear of the aircraft
};
/** Seconds since the push began (PUSHBACK only; -1 before it). */
const pushTimeOf = (s) => (s.phase === "PUSHBACK" && s.proc.readyAt !== null ? s.phaseTime - s.proc.readyAt - PUSH_DELAY : -1);
/** Thrust fraction of rated take-off thrust for an N1 (static, sea level). [E] */
export function thrustFraction(n1) {
  if (n1 <= 0) return 0;
  if (n1 < ENGINES.n1.groundIdle) return 0.04 * (n1 / ENGINES.n1.groundIdle);
  const x = clamp((n1 - ENGINES.n1.groundIdle) / (ENGINES.n1.toga - ENGINES.n1.groundIdle), 0, 1.05);
  return 0.04 + 0.96 * Math.pow(x, 2.2);
}

// ---------------------------------------------------------------------------------------------
// phases: targets per channel, real durations and a suggested compression for the figure.
// Within a phase the procedure is rule-driven by step() (thrust staging, rotation at VR, gear up at
// positive climb, thrust reduction at 1500 ft, flaps 0 at S speed), so the targets are end states.
// ---------------------------------------------------------------------------------------------
const doorSet = (open = []) => Object.fromEntries(DOOR_IDS.map((id) => [id, open.includes(id) ? 1 : 0]));
const LIGHTS_OFF = { nav: 0, beacon: 0, strobe: "auto", logo: "auto", wing: 0, engine: 0, landing: 0, taxi: 0, takeoff: 0, runwayTurnoff: 0, camera: 0, cargoFlood: 0, gearBay: 0 };
const n1x4 = (v) => [v, v, v, v];
export const PHASES = [
  {
    id: "GATE", label: "At the gate",
    realDurationS: 5400, compression: 600, figureS: 9, // [S] AC 5-2-1 90 min turn-round. The figure holds the stand with no rate shown (truth §14); compression is read only by tools/model-test.mjs's step
    target: {
      doors: doorSet(["M2L", "U1L", "M2R", "M4R", "U1R", "M5L", "FWD", "AFT", "BULK"]), slides: "disarmed",
      gear: 1, slat: 0, flap: 0, aileronDroop: 0, spoilers: 0, n1: n1x4(0), engineRun: [0, 0, 0, 0], apu: 1,
      pitch: 0, height: 0, speed: 0,
      lights: { ...LIGHTS_OFF, nav: 1, cargoFlood: 1, gearBay: 1 }, cabin: 1.0, blinds: 1,
    },
    notes: "Bridges at M2L and U1L; catering at M2R, M4R, U1R and via M5L; all three holds open. APU running, beacon off.",
  },
  {
    id: "PUSHBACK", label: "Pushback and start",
    realDurationS: 185, compression: 12, figureS: 15, // [D] model: doors shut 20 s, push 48 s, the tug holds to 173 s (released as engines 3+4 come to idle, 177 s)
    target: {
      doors: doorSet([]), slides: "armed", gear: 1, slat: 0, flap: 0, aileronDroop: 0, spoilers: 0,
      n1: n1x4(ENGINES.n1.groundIdle), engineRun: [1, 1, 1, 1], startAtS: [15, 15, 95, 95], apu: 1, // starts: s after the push begins
      pitch: 0, height: 0, speed: -PERF.pushbackSpeed,
      lights: { ...LIGHTS_OFF, nav: 1, beacon: 1 }, cabin: 0.8, blinds: 0,
    },
    notes: "The towbarless tug drives in and picks up the nose wheel while the doors close and the slides arm; beacon ON when cleared to push; the tug moves 5 s later; engines 1+2 start 15 s into the push, 3+4 at 95 s; the tug holds the aircraft and releases the nose wheel as 3+4 come up to idle, then drives off; APU stays on until after start.",
  },
  {
    id: "TAXI", label: "Taxi",
    realDurationS: 600, minS: 90, compression: 7.5, figureS: 12, // [E] taxi ~10 min; the figure shows the first 90 s (flaps set in 52 s)
    target: {
      doors: doorSet([]), slides: "armed", gear: 1, slat: 20, flap: 8, aileronDroop: 5, spoilers: 0,
      n1: n1x4(ENGINES.n1.groundIdle), breakawayS: 8, apu: 0,
      pitch: 0, height: 0, speed: PERF.taxiSpeed,
      lights: { ...LIGHTS_OFF, nav: 1, beacon: 1, taxi: 1, runwayTurnoff: 1, camera: 1 }, cabin: 0.3, blinds: 0,
    },
    notes: "Flaps to the take-off setting after start (CONF 1+F: slats 20, flaps 8, ailerons drooped 5). NOSE TAXI, runway turn-off on.",
  },
  {
    id: "LINEUP", label: "Line-up",
    realDurationS: 45, compression: 9, figureS: 5, // [E]
    target: {
      doors: doorSet([]), slides: "armed", gear: 1, slat: 20, flap: 8, aileronDroop: 5, spoilers: 0,
      n1: n1x4(ENGINES.n1.groundIdle), apu: 0, pitch: 0, height: 0, speed: 0,
      lights: { ...LIGHTS_OFF, nav: 1, beacon: 1, strobe: "on", landing: 1, taxi: 1, takeoff: 1, runwayTurnoff: 1, camera: 1 }, cabin: 0.25, blinds: 0,
    },
    notes: "Strobes ON entering the runway; landing lights ON, NOSE T.O (taxi + take-off lights), runway turn-off ON.",
  },
  {
    id: "TAKEOFF", label: "Take-off",
    realDurationS: 60, compression: 2, figureS: 30, // [D] model: lift-off 57 s after brake release (roll 2.1 km), 35 ft at 60 s
    target: {
      doors: doorSet([]), slides: "armed", gear: 1, slat: 20, flap: 8, aileronDroop: 5, spoilers: 0,
      n1: n1x4(ENGINES.n1.takeoffTypical), apu: 0, pitch: PERF.rotationPitch, height: 35 * FT, speed: PERF.v2 + 10,
      lights: { ...LIGHTS_OFF, nav: 1, beacon: 1, strobe: "on", landing: 1, taxi: 1, takeoff: 1, runwayTurnoff: 1, camera: 1 }, cabin: 0.25, blinds: 0,
    },
    notes: "Stabilise ~50% N1, then FLX: FADEC holds 78% below 32.5 kt, take-off thrust set by 80 kt. Rotate at VR at 3 deg/s; lift-off ~10 deg; target 12.5 deg.",
  },
  {
    id: "CLIMB", label: "Climb",
    realDurationS: 195, compression: 10, figureS: 20, // [D] model: 35 ft to 3000 ft, gear up by 18 s, flaps in by 190 s
    target: {
      doors: doorSet([]), slides: "armed", gear: 0, slat: 0, flap: 0, aileronDroop: 0, spoilers: 0,
      n1: n1x4(ENGINES.n1.climb), apu: 0, pitch: 9, height: 3000 * FT, speed: PERF.climbSpeed,
      lights: { ...LIGHTS_OFF, nav: 1, beacon: 1, strobe: "on", landing: 1, taxi: 1, takeoff: 1, runwayTurnoff: 1, camera: 1 }, cabin: 0.25, blinds: 0,
    },
    notes: "Switches unchanged after lift-off; the nose-strut lights (taxi, take-off, runway turn-off) and the camera lights go dark as the gear retracts, the wing-root taxi lights stay on. Positive climb: gear up. 1500 ft: thrust CL, accelerate. S speed: flaps lever 0 (flaps first, then slats). NOSE and RWY TURN OFF off after flap retraction; logo (AUTO) off when the slats are in.",
  },
  {
    id: "FL100", label: "Climb to 10,000 ft",
    realDurationS: 315, compression: 30, figureS: 10, // [D] model: 3000 to 10 000 ft at 250 kt
    target: {
      doors: doorSet([]), slides: "armed", gear: 0, slat: 0, flap: 0, aileronDroop: 0, spoilers: 0,
      n1: n1x4(ENGINES.n1.climb), apu: 0, pitch: 8, height: 10000 * FT, speed: PERF.climbSpeed,
      lights: { ...LIGHTS_OFF, nav: 1, beacon: 1, strobe: "on", landing: 1 }, cabin: 0.6, blinds: 0,
    },
    notes: "Passing 10,000 ft: landing lights OFF (Airbus SOP; step() switches them off at 10,000 ft). Strobes, beacon and nav stay on.",
  },
];
export const PHASE_IDS = PHASES.map((p) => p.id);
const PHASE_BY_ID = Object.fromEntries(PHASES.map((p) => [p.id, p]));
const deepCopy = (o) => (Array.isArray(o) ? o.map(deepCopy) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deepCopy(v)])) : o);
/** Targets for a phase (a fresh copy, safe to mutate). */
export function phaseState(id) {
  const p = PHASE_BY_ID[id];
  if (!p) throw new Error("unknown phase " + id);
  return { phase: id, label: p.label, ...deepCopy(p.target) };
}

// ---------------------------------------------------------------------------------------------
// state and dynamics
// ---------------------------------------------------------------------------------------------
/**
 * The aircraft's state as step() advances it (doors, gear, high-lift, engines, flight path, lights, the cabin dimmer
 * and blinds, the tug): what initialState() returns.
 * @typedef {ReturnType<typeof initialState>} State
 */
/** The rest state: parked at the gate (GATE targets already reached). */
export function initialState() {
  const t = phaseState("GATE");
  return {
    phase: "GATE", phaseTime: 0, clock: 0,
    doors: { ...t.doors }, slides: t.slides,
    gear: { leg: 1, doors: 0, cmd: 1, stage: "locked", body: 1, legT: 0 }, // leg 1 = down and locked; doors = hydraulic gear doors open fraction; body = the body gear's legs (fu/gear: they trail on extension), legT = s in the legs stage
    slatDrive: 0, flapDrive: 0, slat: 0, flap: 0, aileronDroop: 0, spoilers: 0,
    // the flaps lever (follow-up review 1): the configuration selected (the surfaces follow it), its position and CONF.
    // The crew moves it at its moment (to 1+F in the taxi, to 0 at S speed in the climb); hlMoving: a surface moved
    lever: { slat: 0, flap: 0 }, flapLever: 0, flapSel: "0", hlMoving: false,
    n1: [0, 0, 0, 0], engineRun: [0, 0, 0, 0], apu: 1,
    onGround: true, speed: 0, groundDistance: 0, height: 0, vs: 0, pitch: 0, gamma: 0, lift: 0,
    brakeReleaseD: null, // the ground distance where the take-off roll began (the runway's threshold is placed from it)
    proc: { stage: 0, rotating: false, posClimbAt: null, readyAt: null },
    lights: { nav: 1, beacon: 0, strobe: 0, logo: 1, wing: 0, engine: 0, landing: 0, taxi: 0, taxiNose: 0, takeoff: 0, runwayTurnoff: 0, camera: 0, cargoFlood: 1, gearBay: 1, obstruction: 1 },
    cabin: 1,
    // the window blinds (world.mjs windowBlind: 7% of the windows): 1 down as passengers left them at the stand, 0 all open.
    // [E] operators' cabin-secure check: every blind open for take-off and landing (the crew and passengers see out,
    // eyes adjusted to the outside light), so the crew raise them as the doors close and the aircraft is pushed back
    blinds: 1,
    tug: 0, // the pushback tug (TUG): 0 none at the stand
  };
}
const approach = (v, target, rate, dt) => (v < target ? Math.min(target, v + rate * dt) : Math.max(target, v - rate * dt));
const confDrive = (slatDeg, flapDeg) => [invMap(SLAT_MAP, slatDeg), invMap(FLAP_MAP, flapDeg)];

/**
 * Advance the state by dt seconds toward the phase targets with the real rates. Pure: returns a new
 * state. dt is real (aircraft) time; a figure that compresses time passes dt * compression, in
 * sub-steps of at most 0.1 s (step does this itself).
 * @param {State} state
 * @param {ReturnType<typeof phaseState>} target
 * @param {number} dt seconds
 * @returns {State}
 */
export function step(state, target, dt) {
  let s = deepCopy(state);
  if (target.phase && target.phase !== s.phase) enterPhaseIn(s, target.phase);
  let left = Math.max(0, dt);
  while (left > 1e-9) {
    const h = Math.min(0.05, left);
    s = substep(s, target, h);
    left -= h;
  }
  return s;
}
/** A phase change on a state (mutates s): the brake release, the phase clock and the procedure restart. */
function enterPhaseIn(s, phase) {
  if (phase === "TAKEOFF") s.brakeReleaseD = s.groundDistance; // brake release (every path into the roll passes here)
  if (phase === "GATE") s.brakeReleaseD = null;
  s.phase = phase; s.phaseTime = 0; s.proc = { stage: 0, rotating: false, posClimbAt: null, readyAt: null };
}
/**
 * The state as it enters `phase` (a fresh copy), before any time passes: what step() does first when the target's phase
 * differs. The page enters a phase with it, so a seek that arrives while the figure is paused (no step runs) already
 * reads the new phase (follow-up review 1: the readout stayed on the previous phase while the legend marked the new one).
 */
export function enterPhaseState(state, phase) {
  const s = deepCopy(state);
  if (phase && phase !== s.phase) enterPhaseIn(s, phase);
  return s;
}

/**
 * The configuration the flaps lever selects for a state and its targets: the target's, except that in the air the
 * crew's retraction waits for S speed (the lever stays where it was); a reader's selection (tg.readerHighLift) moves at
 * once. The page reads the same rule for the legend, so a paused figure shows the lever the next step would set.
 */
export function leverSelect(s, tg) {
  const cur = s.lever ?? { slat: s.slat, flap: s.flap };
  const sel = { slat: tg.slat ?? cur.slat, flap: tg.flap ?? cur.flap };
  const retracting = sel.slat < cur.slat - 0.01 || sel.flap < cur.flap - 0.01;
  // fu/r2-interaction: lever 1 on the ground is CONF 1+F (a reader's in-flight CONF 1 must not survive onto the ground)
  if (s.onGround && tg.readerHighLift && confName(sel.slat, sel.flap) === "1") return { slat: 20, flap: 8 };
  return !s.onGround && retracting && s.speed < PERF.sSpeed && !tg.readerHighLift ? { slat: cur.slat, flap: cur.flap } : sel;
}

function substep(s, tg, dt) {
  s.clock += dt; s.phaseTime += dt;
  const airborne = !s.onGround;
  const phase = s.phase;

  // ---- doors (passenger 8 s, cargo per door) and slides
  for (const id of DOOR_IDS) {
    const want = tg.doors && id in tg.doors ? tg.doors[id] : 0;
    const spec = DOORS.cargo.find((d) => d.id === id);
    const rate = 1 / (spec ? spec.openS : 8);
    s.doors[id] = approach(s.doors[id], want, rate, dt);
  }
  const allShut = DOOR_IDS.every((id) => s.doors[id] === 0);
  s.slides = tg.slides === "armed" && allShut ? "armed" : "disarmed";
  // the pushback tug: at the stand none; in PUSHBACK it drives in and picks up the nose wheel (TUG.approachS), and once
  // the push is over and the aircraft stands still it releases the wheel and drives off; after the push it is clear
  if (s.tug === undefined) s.tug = 0;
  if (phase === "GATE") s.tug = 0;
  else if (phase !== "PUSHBACK") s.tug = 2;
  else if (s.tug < 1) s.tug = Math.min(1, s.tug + dt / TUG.approachS);
  // pushback: doors shut, slides armed and the tug connected -> beacon on -> push starts PUSH_DELAY s later
  if (phase === "PUSHBACK" && s.proc.readyAt === null && s.slides === "armed" && s.tug >= 1) s.proc.readyAt = s.phaseTime;
  const pushT = phase === "PUSHBACK" && s.proc.readyAt !== null ? s.phaseTime - s.proc.readyAt - PUSH_DELAY : -1; // time since the push began
  if (phase === "PUSHBACK" && s.tug >= 1 && s.tug < 2 && pushT >= TUG_RELEASE_S && Math.abs(s.speed) < 0.2) s.tug = Math.min(2, s.tug + dt * (s.tug < 1.3 ? 0.3 / TUG.releaseS : 0.7 / TUG.driveOffS));

  // ---- engines: start sequence, then first-order N1 lag with the TCDS time constant
  for (let i = 0; i < 4; i++) {
    const startAt = tg.startAtS ? tg.startAtS[i] : 0;
    const clockForStart = phase === "PUSHBACK" ? pushT : s.phaseTime;
    const wantRun = (tg.engineRun ? tg.engineRun[i] : tg.n1[i] > 0 ? 1 : 0) && clockForStart >= startAt;
    if (wantRun) s.engineRun[i] = 1;
    if (tg.engineRun && tg.engineRun[i] === 0 && tg.n1[i] === 0) s.engineRun[i] = 0;
    let cmd = s.engineRun[i] ? Math.max(ENGINES.n1.groundIdle, tg.n1[i]) : 0;
    // taxi breakaway thrust for the first seconds of the taxi
    if (phase === "TAXI" && s.phaseTime < (tg.breakawayS || 0) && s.speed < 5) cmd = Math.max(cmd, ENGINES.n1.taxiBreakaway);
    // take-off staging: stabilise, then FLX; FADEC ground cap below 32.5 kt (Trent 900 TCDS)
    if (phase === "TAKEOFF" && s.onGround) {
      if (s.proc.stage === 0) { cmd = Math.min(cmd, ENGINES.n1.stabilise); if (s.n1.every((n) => n >= ENGINES.n1.stabilise - 2)) s.proc.stage = 1; }
      if (s.speed < ENGINES.n1.groundCapSpeedKt) cmd = Math.min(cmd, ENGINES.n1.groundCapBelow32kt);
    }
    // climb: take-off thrust until the thrust reduction altitude
    if (phase === "CLIMB" && s.height < PERF.thrustReductionFt * FT) cmd = Math.max(cmd, ENGINES.n1.takeoffTypical);
    const cur = s.n1[i];
    if (!s.engineRun[i]) s.n1[i] = cur + (0 - cur) * (1 - Math.exp(-dt / 6)); // spool down after shutdown
    else if (cur < ENGINES.n1.groundIdle - 0.5 && cmd <= ENGINES.n1.groundIdle + 0.5) {
      // start: light-up and acceleration to idle over ~ENGINES.spool.startS
      s.n1[i] = Math.min(ENGINES.n1.groundIdle, cur + (ENGINES.n1.groundIdle / ENGINES.spool.startS) * dt * (0.4 + 1.2 * cur / ENGINES.n1.groundIdle));
    } else {
      const tau = cmd > cur ? ENGINES.spool.tauUp : ENGINES.spool.tauDown;
      s.n1[i] = cur + (cmd - cur) * (1 - Math.exp(-dt / tau));
    }
  }
  s.apu = approach(s.apu, tg.apu ?? 0, 1 / 20, dt);

  // ---- high lift: drive positions at the FBW rates, slats first on extension, flaps first on retraction
  // the lever (follow-up review 1): the surfaces follow the configuration selected. The crew selects the phase's
  // configuration at once, except that in the air a retraction waits for S speed (the lever stays at 1+F through the
  // first 150 s of the climb, as the readout and the surfaces do); a reader's lever (tg.readerHighLift) moves at once
  s.lever = leverSelect(s, tg);
  s.flapSel = confName(s.lever.slat, s.lever.flap);
  s.flapLever = leverOfConf(s.flapSel);
  const wantSlat = s.lever.slat, wantFlap = s.lever.flap;
  const drives0 = s.slatDrive + 1e3 * s.flapDrive;
  const [slatT, flapT] = confDrive(wantSlat, wantFlap);
  const extending = slatT > s.slatDrive + 1e-6 || flapT > s.flapDrive + 1e-6;
  if (extending) {
    if (slatT > s.slatDrive + 1e-6) s.slatDrive = approach(s.slatDrive, slatT, CONTROLS.transit.slatDrivePerS, dt);
    else s.flapDrive = approach(s.flapDrive, flapT, CONTROLS.transit.flapDrivePerS, dt);
  } else {
    if (flapT < s.flapDrive - 1e-6) s.flapDrive = approach(s.flapDrive, flapT, CONTROLS.transit.flapDrivePerS, dt);
    else s.slatDrive = approach(s.slatDrive, slatT, CONTROLS.transit.slatDrivePerS, dt);
  }
  s.slat = slatAngle(s.slatDrive); s.flap = flapAngle(s.flapDrive);
  s.hlMoving = Math.abs(s.slatDrive + 1e3 * s.flapDrive - drives0) > 1e-9; // the page slows a reader's flaps in flight
  // the droop follows the configuration the flaps are in (CONF 1+F and beyond droop 5°), not the phase's target: the
  // climb's target (0) retracted it at lift-off while the aircraft stayed in 1+F for 150 s (review round 3)
  const confRow = CONTROLS.conf.find((c) => c.id === confName(s.slat, s.flap));
  s.aileronDroop = approach(s.aileronDroop, s.flap > 4 ? (confRow ? confRow.aileronDroop : 5) : 0, 2, dt);
  s.spoilers = approach(s.spoilers, tg.spoilers || 0, 20, dt);

  // ---- landing gear sequence (doors open, legs move, doors close)
  const g = s.gear, T = GEAR.timing;
  let gearCmd = tg.gear;
  if (s.onGround) gearCmd = 1; // never on the ground
  else if (gearCmd === 0 && phase === "CLIMB") {
    if (s.proc.posClimbAt === null && s.vs > 0.5 && s.height > 10 * FT) s.proc.posClimbAt = s.clock;
    if (s.proc.posClimbAt === null || s.clock - s.proc.posClimbAt < PERF.gearUpReactionS) gearCmd = 1;
  }
  if (gearCmd !== g.cmd) { g.cmd = gearCmd; g.stage = "doorsOpening"; }
  if (g.stage === "doorsOpening") {
    g.doors = approach(g.doors, 1, 1 / (g.cmd ? T.extend.doorsOpen : T.retract.doorsOpen), dt);
    if (g.doors >= 1) { g.stage = "legs"; g.legT = 0; } // fu/gear: legT times the body gear's lag
  } else if (g.stage === "legs") {
    g.leg = approach(g.leg, g.cmd, 1 / (g.cmd ? T.extend.legs : T.retract.legs), dt);
    // fu/gear: the body gear's legs trail by bodyLag s on extension (only the time past the lag counts), with the leg's rate
    const lag = g.cmd ? T.extend.bodyLag || 0 : 0;
    g.legT = (g.legT || 0) + dt;
    g.body = approach(g.body ?? g.leg, g.cmd, 1 / (g.cmd ? T.extend.legs : T.retract.legs), Math.max(0, Math.min(dt, g.legT - lag)));
    if (g.leg === g.cmd && g.body === g.cmd) g.stage = "doorsClosing";
    // fu/gear end
  } else if (g.stage === "doorsClosing") {
    g.doors = approach(g.doors, 0, 1 / (g.cmd ? T.extend.doorsClose : T.retract.doorsClose), dt);
    if (g.doors <= 0) g.stage = g.cmd ? "locked" : "up";
  }

  // ---- motion: ground roll, rotation, lift-off and climb (point-mass, small angles) [E]
  const P = PERF, m = P.massKg, W = m * G0;
  const V = Math.max(0, s.speed) * KT;
  const sigma = Math.exp(-s.height / 9000);
  const q = 0.5 * P.rho * sigma * V * V;
  const conf = confName(s.slat, s.flap);
  const cl = s.onGround ? P.groundCl + P.clAlphaPerDeg * s.pitch : (W * Math.cos(s.gamma)) / Math.max(1, q * P.wingArea);
  const cd = P.cd0[conf] + P.cd0.gear * (g.leg > 0.02 || g.doors > 0.02 ? 1 : 0) + P.inducedK * Math.min(cl, 2.2) ** 2;
  const thrust = s.n1.reduce((a, n) => a + P.thrustPerEngineKN * 1000 * thrustFraction(n) * (1 - 0.00145 * Math.max(0, s.speed)) * Math.pow(sigma, 0.7), 0);
  const drag = q * P.wingArea * cd;
  if (s.onGround) {
    const lift = q * P.wingArea * (P.groundCl + P.clAlphaPerDeg * s.pitch);
    s.lift = approach(s.lift, clamp(lift / W, 0, 1), 0.5, dt); // wing bend follows the lift
    let accel;
    if (phase === "TAKEOFF") {
      accel = (thrust - drag - P.rollingFriction * Math.max(0, W - lift)) / m;
      // the engines shut down on the roll (allowed below 30 kt only): no thrust, brake to a stop as in the taxi
      if (!s.proc.rotating && (!s.engineRun.some((r) => r) || s.n1.every((n) => n < ENGINES.n1.groundIdle - 2))) accel = clamp((0 - s.speed) * KT * 0.6, -0.45 * 1.6, 0);
      // rotation at VR, 3 deg/s, eased into the target
      if (s.speed >= P.vr) s.proc.rotating = true;
      if (s.proc.rotating) s.pitch = approach(s.pitch, tg.pitch, Math.min(P.rotationRateDegS, 0.5 + 2.5 * Math.min(1, s.pitch / 1.5), 0.3 + 1.5 * Math.abs(tg.pitch - s.pitch)), dt);
      if (s.pitch >= P.liftoffPitch && lift + 0.05 * W >= W * Math.cos(0)) s.onGround = false;
      if (s.pitch >= P.liftoffPitch + 0.3) s.onGround = false; // the tail would touch first; geometry wins
    } else {
      // taxi and push: speed held by thrust and brakes, gentle accelerations
      let want = tg.speed;
      if (phase === "PUSHBACK") want = pushT >= 0 && pushT < PUSH_ROLL_S ? tg.speed : 0; // fu/r2-interaction: the roll, then held
      else if (!s.engineRun.some((r) => r) || s.n1.every((n) => n < ENGINES.n1.groundIdle - 2)) want = 0; // no thrust: brake to a stop
      const rate = phase === "PUSHBACK" ? 0.25 : 0.45; // m/s^2 [E]
      accel = clamp((want - s.speed) * KT * 0.6, -rate * 1.6, rate);
      if (phase === "LINEUP" || phase === "GATE") accel = clamp((0 - s.speed) * KT * 0.8, -0.8, 0.8);
      s.pitch = approach(s.pitch, 0, 1, dt);
    }
    s.speed += (accel / KT) * dt;
    if (phase !== "PUSHBACK" && s.speed < 0) s.speed = Math.max(s.speed, 0);
    s.groundDistance += s.speed * KT * dt;
    s.vs = 0; s.gamma = 0;
  } else {
    // airborne: SRS / speed-on-pitch climb. Excess thrust splits between climb and acceleration.
    const accAlt = P.accelerationFt * FT;
    const vTarget = s.height < accAlt ? P.v2 + 10 : Math.min(tg.speed, s.slat > 0.5 && s.height < accAlt + 600 ? P.sSpeed + 15 : tg.speed);
    const excess = (thrust - drag) / W; // available gradient (rad)
    const aCmd = clamp((vTarget - s.speed) * KT * 0.12, -0.4, s.height < accAlt ? 0.25 : 0.45);
    let gammaCmd = clamp(excess - aCmd / G0, 0.03, 0.2); // keep climbing (~2 deg) while accelerating
    if (tg.levelOff) { // optional level-off at the phase height (off by default: phases end by height)
      if (s.height >= tg.height - 1) gammaCmd = 0;
      else if (s.height > tg.height - 120) gammaCmd = Math.min(gammaCmd, (tg.height - s.height) / 1200);
    }
    s.gamma = approach(s.gamma, gammaCmd, 0.03, dt);
    let accel = (thrust - drag - W * Math.sin(s.gamma)) / m;
    if (accel > aCmd + 0.05) accel = aCmd + 0.05; // autothrust trims what pitch cannot absorb
    s.speed = Math.max(0, s.speed + (accel / KT) * dt);
    s.vs = V * Math.sin(s.gamma);
    s.height = Math.max(0, s.height + s.vs * dt);
    s.groundDistance += V * Math.cos(s.gamma) * dt;
    const alpha = clamp((cl - P.cl0[conf]) / P.clAlphaPerDeg, 0, 14);
    const pitchWant = clamp((s.gamma * 180) / Math.PI + alpha, 0, 15);
    if (phase === "TAKEOFF") s.pitch = approach(s.pitch, tg.pitch, Math.min(P.rotationRateDegS, 0.3 + 1.5 * Math.abs(tg.pitch - s.pitch)), dt); // rotation continues to the target
    else s.pitch = approach(s.pitch, pitchWant, 1.5, dt); // then follow the SRS / speed guidance
    s.lift = approach(s.lift, 1, 0.5, dt);
  }

  // ---- lights (applyLights: the switches, the crew's SOP actions, the reader's settings, the automatic rules)
  applyLights(s, tg);
  s.cabin = approach(s.cabin, tg.cabin ?? 1, 0.25, dt);
  s.blinds = approach(s.blinds ?? 1, tg.blinds ?? 0, 0.1, dt); // [E] the cabin crew's walk down both decks, about 10 s
  return s;
}

/**
 * The exterior lights from the switches (fu/r2-interaction: one function, so the page applies a switch pressed while
 * paused at once instead of at the next model step; substep calls it as before).
 */
export function applyLights(s, tg) {
  // the switches (the phase's targets, the crew's SOP actions, the reader's own settings), then the
  // automatic behaviours. The crew moves a switch at its moment: BEACON ON once the doors are shut and the push is
  // cleared, NOSE and RWY TURN OFF OFF after flap retraction, LAND OFF passing 10,000 ft (T2). A switch the reader set
  // (tg.readerLights, F.applyOverrides) is theirs: the crew never moves it, and a reader's ON beats these rules, as a
  // real switch would. s.switches is what the overhead panel shows (review round 3: the panel and the lights agree)
  const R = tg.readerLights || {};
  const L = { ...(tg.lights || {}) };
  if (s.phase === "PUSHBACK" && !R.beacon && L.beacon) L.beacon = s.proc.readyAt !== null ? 1 : 0;
  if (s.phase === "CLIMB" && !s.onGround && s.slat < 0.5 && s.flap < 0.5) for (const k of ["taxi", "takeoff", "runwayTurnoff", "camera"]) if (!R[k]) L[k] = 0;
  if (s.phase === "FL100" && s.height >= 10000 * FT && !R.landing) L.landing = 0;
  s.switches = L;
  const g = s.gear;
  const gearDown = g.leg >= 0.999 && g.cmd === 1;
  s.lights.nav = L.nav ? 1 : 0;
  s.lights.obstruction = L.nav && s.onGround ? 1 : 0;
  s.lights.beacon = L.beacon ? 1 : 0;
  s.lights.strobe = L.strobe === "on" || (L.strobe === "auto" && !s.onGround) ? 1 : 0;
  s.lights.logo = L.logo === "auto" ? (s.onGround || s.slat > 0.5 ? 1 : 0) : L.logo ? 1 : 0;
  s.lights.wing = L.wing ? 1 : 0; s.lights.engine = L.engine ? 1 : 0;
  s.lights.landing = L.landing ? 1 : 0;
  // follow-up review 1: the NOSE switch's taxi position lights the wing-root taxi lights too, and only the nose-strut
  // lights go off when the gear retracts (FBW A380X EXT LT: "the lights on the nose strut go off automatically when the
  // gear retracts"); the wing roots stay lit until the crew sets NOSE OFF after flap retraction. lights.taxi is the
  // switch's wing-root lamps; the nose-strut taxi lamp (gate "gear" in GL) is lights.taxiNose
  s.lights.taxi = L.taxi ? 1 : 0;
  s.lights.taxiNose = L.taxi && gearDown ? 1 : 0;
  s.lights.takeoff = L.takeoff && gearDown ? 1 : 0;
  s.lights.runwayTurnoff = L.runwayTurnoff && gearDown ? 1 : 0;
  s.lights.camera = L.camera && gearDown ? 1 : 0;
  s.lights.cargoFlood = L.cargoFlood && (s.doors.FWD > 0 || s.doors.AFT > 0) ? 1 : 0;
  s.lights.gearBay = L.gearBay ? 1 : 0;
}

/** True when the phase's goals are met (a figure can advance on this). */
export function phaseDone(state, id = state.phase) {
  const s = state;
  switch (id) {
    case "GATE": return DOOR_IDS.every((d) => s.doors[d] === phaseState("GATE").doors[d]);
    case "PUSHBACK": return s.proc.readyAt !== null && s.phaseTime - s.proc.readyAt - PUSH_DELAY >= PUSH_SECONDS + 10 && s.n1.every((n) => n >= ENGINES.n1.groundIdle - 0.5) && Math.abs(s.speed) < 0.2 && (s.tug ?? 2) >= 2;
    case "TAXI": return s.phaseTime >= PHASE_BY_ID.TAXI.minS && Math.abs(s.slat - 20) < 0.05 && Math.abs(s.flap - 8) < 0.05 && s.engineRun.some((r) => r); // fu/r2-interaction: not with the engines shut down
    case "LINEUP": return s.phaseTime >= PHASE_BY_ID.LINEUP.realDurationS && s.speed < 0.5;
    case "TAKEOFF": return !s.onGround && s.height >= 35 * FT;
    case "CLIMB": return s.gear.stage === "up" && s.slat < 0.01 && s.flap < 0.01 && s.height >= 3000 * FT - 2;
    case "FL100": return s.height >= 10000 * FT;
    default: return true;
  }
}

// ---------------------------------------------------------------------------------------------
// readouts
// ---------------------------------------------------------------------------------------------
const fmt = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
function gearWord(s) {
  const g = s.gear;
  if (g.stage === "locked") return "gear down";
  if (g.stage === "up") return "gear up";
  return g.cmd ? "gear extending" : "gear retracting";
}
function confWord(s) {
  const name = confName(s.slat, s.flap);
  const c = CONTROLS.conf.find((k) => k.id === name);
  const moving = Math.abs(c.slat - s.slat) > 0.2 || Math.abs(c.flap - s.flap) > 0.2;
  return moving ? `CONF ${name}, flaps moving` : `CONF ${name}`;
}
/** Short live readout, e.g. "Take-off · CONF 1+F · N1 92% · 150 kt · gear down". */
/** The phase's words for the readout: FL100 reads "10,000 ft" once there. */
export function phaseWords(s) {
  if (s.phase === "FL100" && s.height >= 10000 * FT) return "10,000 ft";
  return PHASE_BY_ID[s.phase] ? PHASE_BY_ID[s.phase].label : s.phase;
}
/** N1 words: "engines off", "N1 88%", or per engine while they disagree ("N1 20·20·4·4%", "starting" while any lights up). */
export function n1Words(s) {
  const n1 = s.n1;
  const max = Math.max(...n1);
  if (max < 1 && !s.engineRun.some((r) => r)) return "engines off";
  const starting = s.engineRun.some((r, i) => r && n1[i] < ENGINES.n1.groundIdle - 0.6 && s.onGround);
  const spread = max - Math.min(...n1);
  const value = spread > 2 ? `N1 ${n1.map((n) => Math.round(n)).join("·")}%` : `N1 ${Math.round(n1.reduce((a, b) => a + b, 0) / 4)}%`;
  return starting ? `engines starting · ${value}` : value;
}
/** The pushback tug's words ("tug connecting", "tug pushing", …), or "" when there is none (PUSHBACK only). */
export function tugWords(s) {
  const c = s.tug ?? 0;
  if (s.phase !== "PUSHBACK" || !(c > 0 && c < 2)) return "";
  if (c < 1) return "tug connecting";
  if (c >= 1.3) return "tug driving off";
  if (c > 1) return "tug releasing";
  return s.speed < -0.5 ? "tug pushing" : "tug connected";
}
export function readout(s) {
  const parts = [phaseWords(s), confWord(s), n1Words(s)];
  const tug = tugWords(s);
  if (s.onGround && s.speed < -0.5) parts.push(`${tug === "tug pushing" ? "tug pushing" : "pushback"} ${Math.max(1, Math.round(-s.speed))} kt`);
  else parts.push(`${Math.round(Math.max(0, s.speed))} kt${tug ? ` · ${tug}` : ""}`);
  // the height, unless the phase word already names it ("10,000 ft · … · 10,000 ft" said it twice: follow-up review 1)
  if (!s.onGround && !(s.phase === "FL100" && s.height >= 10000 * FT)) parts.push(`${fmt(s.height / FT)} ft`);
  parts.push(gearWord(s));
  return parts.join(" · ");
}
/** Spoken description for assistive technology. */
export function ariaText(s) {
  const label = phaseWords(s);
  const open = DOOR_IDS.filter((d) => s.doors[d] > 0.02);
  // fu/r2-interaction: sentences start with a capital, and the holds' doors are named in words (it read "doors M2L, …,
  // FWD, AFT, BULK open")
  const HOLD = { FWD: "forward", AFT: "aft", BULK: "bulk" };
  const and = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
  const pax = open.filter((d) => !(d in HOLD));
  const holds = open.filter((d) => d in HOLD).map((d) => HOLD[d]);
  const doorText = [pax.length ? `doors ${pax.join(", ")} open` : "", holds.length ? `${and(holds)} cargo door${holds.length > 1 ? "s" : ""} open` : ""].filter(Boolean).join("; ");
  const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
  const doors = cap(open.length ? doorText : `all doors closed, slides ${s.slides}`);
  const running = s.engineRun.reduce((a, b) => a + b, 0);
  const eng = running ? `${running} of 4 engines running, average N1 ${Math.round(s.n1.reduce((a, b) => a + b, 0) / 4)} percent` : "Engines off";
  const lights = ["beacon", "strobe", "landing", "taxi", "takeoff", "runwayTurnoff", "logo", "nav"].filter((k) => s.lights[k]).map((k) => ({ runwayTurnoff: "runway turn-off", takeoff: "take-off" }[k] || k));
  const where = s.onGround ? `on the ground at ${Math.round(Math.abs(s.speed))} knots` : `${fmt(s.height / FT)} feet, ${Math.round(s.speed)} knots, pitch ${s.pitch.toFixed(1)} degrees`;
  const tug = tugWords(s);
  return `Airbus A380-800. ${label}: ${where}${tug ? `, ${tug.replace("tug", "the pushback tug")}` : ""}. ${confWord(s)}, ${gearWord(s)}. ${eng}. ${doors}. Lights on: ${lights.join(", ") || "none"}.`;
}
