// a380/parts/cabin-plan.mjs (M7, imported by cabin.mjs; not a module of its own): the Deck plan Inspect view.
//
// Follow-up item 1 (review round 3 R03, F03, P07; DESIGN §0.0, §11.6): every one of the 555 seats in some view. Both
// decks are drawn at true scale as one picture on stage.platter's top face (ctx.planeOn), a plan like Airbus's AC 2-4-0
// cabin drawing: the main deck (with the flight deck ahead of it) and, beside it to starboard, the upper deck. Every
// seat from M.CABIN by class (F 22, J 96, Y 437), every monument from M.CABIN.decks.*.monuments (stairs, galleys,
// lavatories, lifts, coats, crew rest), the passenger doors as gaps in the walls, deck and class labels, and the five
// cut bays (W.CUT) outlined, so the plan ties to the 3D cutaway.
//
// It shows only in its view: the plan's root carries the vary class a3-dp (alpha pv.deckPlan, eased by the page
// script below), and while it shows the airframe canvas, the GL canvases and the platter shadow ghost to 5% (one CSS
// variable on the stage, --a3-dp). Nothing here is a solid: no part, no order pair, no audit line.
//
// Layout (model metres; plane units are dm): the plan lies 2.0 m aft of its true station (the flight deck's nose at
// x 1.92 would cross the platter rim, r 38.0 m); the main deck is centred on the fuselage's track, the upper deck
// 9.0 m to starboard. Seen from the view's bearing (b −90, the port side, nose left) the upper deck lies above the
// main deck and the text, written 2× tall in the plane, reads at its natural height (sin 30° = 0.5).
//
// Seats: row stations and lateral layouts are M.CABIN's [D]. A seat whose outer edge would cross the
// cabin wall's inner face at cushion height is left out: that drops the window seats of the last two main-deck side rows (51.67,
// 52.44, where the tail cone narrows the cabin), which turns the zone's 338 row places into the AC's 334. The upper
// deck's rows give 104 places against the AC's 103 and nothing in the geometry removes one: the plan draws the last
// centre row (47.58) three-abreast [E]. Monument x ranges are M.CABIN's [D] (coarse); their lateral layout is [E],
// fitted between the seat blocks, and three are moved a little where the seats need it (listed in MONUMENTS).

export const PLAN_VIEW = "deck-plan";
const DX = 2.0; // the plan lies this far aft of its true station (m)
const DY_UPPER = 9.0; // the upper deck's centreline, m to starboard of the main deck's
const GHOST = 0.05; // the airframe, shadow and GL alpha while the plan shows (8% let its outlines cross the floor 17 levels dark in light)
const ZOOM = 1.55;
const BEARING = -90;

const f1 = (v) => {
  const r = Math.round(v * 10) / 10;
  return Object.is(r, -0) ? "0" : String(r);
};
/** Plan coordinates (dm): X aft from the nose, Y toward port (screen down at b −90): the svg's own axes. */
const PX = (x) => x * 10;
const PY = (y) => -y * 10;
/** A closed rounded rectangle over model x0..x1, y0..y1 (m). */
function box(x0, x1, y0, y1, r = 0.06) {
  const X0 = PX(x0);
  const W = PX(x1) - X0;
  const Y0 = Math.min(PY(y0), PY(y1));
  const H = Math.abs(PY(y1) - PY(y0));
  const q = Math.max(0, Math.min(r * 10, W / 2, H / 2));
  if (q < 0.15) return `M${f1(X0)} ${f1(Y0)}h${f1(W)}v${f1(H)}h${f1(-W)}Z`;
  const a = f1(W - 2 * q);
  const b = f1(H - 2 * q);
  const Q = f1(q);
  return `M${f1(X0 + q)} ${f1(Y0)}h${a}q${Q} 0 ${Q} ${Q}v${b}q0 ${Q} -${Q} ${Q}h-${a}q-${Q} 0 -${Q} -${Q}v-${b}q0 -${Q} ${Q} -${Q}Z`;
}
const seg = (x0, y0, x1, y1) => `M${f1(PX(x0))} ${f1(PY(y0))}L${f1(PX(x1))} ${f1(PY(y1))}`;
const circ = (x, y, r) => `M${f1(PX(x) - r * 10)} ${f1(PY(y))}a${f1(r * 10)} ${f1(r * 10)} 0 1 0 ${f1(r * 20)} 0a${f1(r * 10)} ${f1(r * 10)} 0 1 0 ${f1(-r * 20)} 0Z`;
const polyM = (pts) => `M${pts.map(([x, y]) => `${f1(PX(x))} ${f1(PY(y))}`).join("L")}Z`;
const path = (cls, d, tone = null) => (d ? `<path class="${tone ? "iso-line " : ""}${cls}"${tone ? ` data-tone="${tone}"` : ""} d="${d}"/>` : "");
const line = (d, tone = "lo") => (d ? `<path class="iso-line" data-tone="${tone}" d="${d}"/>` : "");
/** Engraved text, 2× tall in the plane so it reads at its height from the 30° camera; size in dm of screen height. */
const text = (x, y, s, size = 4, cls = "a3-dp-t", anchor = "start", baseline = null) => `<text class="${cls}" text-anchor="${anchor}"${baseline ? ` dominant-baseline="${baseline}"` : ""} font-size="${size}" transform="translate(${f1(PX(x))} ${f1(PY(y))}) scale(1 2)">${s}</text>`;
/**
 * r1 (craft): the plan carries only the two deck names, engraved large; the counts and the class key are in the card (the
 * key inset, below) and every block, monument and door names itself on hover or tap (pick regions). The names are 8 plan
 * units tall (a 7.6 px cap at 1440, where the plan is 14.7 px/m) and 16 under 600 px (the phone's plan is about 0.3 of the
 * desktop's): at the old 2.8-3.6 units every label but the deck names was a grey dash at 1x.
 */
const DECK_NAME = { size: 8, phone: 16 };

/**
 * The monuments drawn for each M.CABIN monument (same order): footprints [x0, x1, y0, y1] in model metres, lateral
 * layout [E]. `moved` notes where the drawn x range leaves the data's (the seats or a door's cross-aisle need it).
 */
const MONUMENTS = {
  main: [
    { kind: "stair", stair: { x: [5.58, 6.29], y: [-0.45, 0.45], up: -1 }, moved: "starts at the flight deck's rear bulkhead (5.56), not 4.86: the flight deck lies ahead of it" },
    { kind: "coat", boxes: "fdStow", moved: "the flight deck's coat and stowage cupboards (cockpit.aft.stow), x 5.02-5.39" },
    { kind: "lav", lavs: [[7.7, 8.67, -2.2, -1.0], [7.7, 8.67, 0.95, 2.15]] },
    { kind: "stair", stair: { x: [7.74, 10.08], y: [-0.85, 0.75], up: 1 } },
    { kind: "galley", boxes: [[17.1, 21.07, -1.15, 1.15]], lift: [17.18, 17.72, -0.27, 0.27], moved: "from 17.10, not 16.34: the M2 doors' cross-aisle stays open" },
    { kind: "lav", lavs: [[32.0, 33.26, -1.15, -0.4], [32.0, 33.26, -0.38, 0.38], [32.0, 33.26, 0.4, 1.15]], moved: "from 32.00, not 31.66: the centre row at 31.69 reaches 31.95" },
    { kind: "galley", boxes: [[42.58, 45.32, -1.05, 1.05], [42.58, 43.9, 1.49, "wall"], [42.58, 43.9, "wall", -1.49]] },
    { kind: "lav", lavs: [[52.48, 53.45, -1.1, -0.02], [52.48, 53.45, 0.02, 1.1], [54.95, 55.85, 1.0, 2.0]], moved: "the third lavatory to 55.85 beside the aft stair" },
    { kind: "lift", lift: [54.38, 54.91, 1.05, 1.6] },
    { kind: "stair", spiral: { c: [55.1, -0.2], r: 0.9 }, moved: "the spiral stair as M.CABIN.stairs.aft (x 54.2-56.0 about 55.1)" },
  ],
  upper: [
    { kind: "stair", stair: { x: [8.77, 11.89], y: [-0.85, 0.75], up: 1, well: true } },
    { kind: "coat", boxes: [[9.37, 11.85, 0.95, 2.0]] },
    { kind: "lav", lavs: [[9.39, 11.0, -2.05, -1.0], [11.05, 12.73, -2.05, -1.0]] },
    { kind: "galley", boxes: [[19.05, 22.3, -0.95, 0.95]], lift: [19.12, 19.66, -0.27, 0.27], moved: "from 19.05, not 18.90: the J centre row at 18.57 reaches 19.00" },
    { kind: "lav", lavs: [[22.35, 23.1, -0.95, -0.02], [22.35, 23.1, 0.02, 0.95]], moved: "to 23.10, not 23.25: the J centre row at 23.71 starts at 23.17" },
    { kind: "lav", lavs: [[48.78, 50.18, -1.2, -0.42], [48.78, 50.18, -0.39, 0.39], [48.78, 50.18, 0.42, 1.2]] },
    { kind: "galley", boxes: [[50.25, 53.35, -1.6, 0.6]] },
    { kind: "crewRest", room: [50.3, 54.3, 0.66, 2.5], bunks: 5 },
    { kind: "lift", lift: [53.4, 53.94, -1.6, -1.05] },
    { kind: "stair", spiral: { c: [55.1, -0.2], r: 0.9 }, moved: "the spiral stair as M.CABIN.stairs.aft (x 54.2-56.0 about 55.1)" },
  ],
};
/** Each monument's name when pointed at (same order as MONUMENTS and M.CABIN.decks.*.monuments). */
const MON_LABEL = {
  main: [
    "Flight-deck stair · the short stair up from the main deck to the flight-deck door",
    "Coat and stowage cupboards · the flight deck's, against its rear bulkhead",
    "Lavatories · 2 · at M1, either side of the forward stair",
    "Forward stair · straight and wide · main deck to the upper deck",
    "Galley M2 · trolley bays and a cart lift between the decks",
    "Lavatories · 3 · at M3",
    "Galley M4 · trolley bays, in the centre and against both walls",
    "Lavatories · 3 · aft, at M5",
    "Lift · carts between the decks, aft",
    "Aft spiral stair · main deck to the upper deck",
  ],
  upper: [
    "Top of the forward stair · upper deck, its balustrade round the well",
    "Coats · upper deck forward",
    "Lavatories · 2 · upper deck forward",
    "Galley U1 · trolley bays and a cart lift between the decks",
    "Lavatories · 2 · at U1",
    "Lavatories · 3 · at U3",
    "Galley · upper deck aft",
    "Crew rest · 5 bunks · upper deck aft",
    "Lift · carts between the decks, aft",
    "Top of the aft spiral stair · upper deck",
  ],
};
const DECK_END = { main: [1.92, 56.75], upper: [8.6, 56.4] };
const FD_END = 5.56; // the flight deck's rear bulkhead, aft face (cabin.mjs: bulkhead 5.40-5.56)

/**
 * Build the plan: returns the records the checks print. ctx: the module context; wall(x, z, belt): the inner face of
 * the cabin wall (cabin.mjs worldOf().wallIn); ringY(x, z): the loft's half-width.
 */
export function buildDeckPlan(ctx, { wall, ringY }) {
  const { M, W } = ctx;
  const rec = { seats: { F: 0, J: 0, Y: 0 }, deck: { main: 0, upper: 0 }, dropped: [], fd: 0, monuments: [], bays: [], overlaps: [], outside: [], glyphW: Infinity, glyphH: Infinity };
  const D = { main: M.CABIN.decks.main, upper: M.CABIN.decks.upper };
  const floorZ = { main: D.main.floorZ, upper: D.upper.floorZ };
  /** Half-width of the cabin at x, 0.5 m over the deck (the wall's inner face); the flight deck's floor ahead of 5.56. */
  const half = (deck, x) => {
    if (deck === "main" && x < FD_END) return ringY(x, 6.3) - 0.06;
    return wall(x, floorZ[deck] + 0.5, deck === "main" ? "main" : "upper");
  };
  const halfMin = (deck, x0, x1) => Math.min(half(deck, x0), half(deck, x1), half(deck, (x0 + x1) / 2));
  const yOff = { main: 0, upper: DY_UPPER };
  const out = { main: [], upper: [] }; // svg per deck, in the deck's own y
  const boxes = { main: [], upper: [] }; // occupied footprints [x0, x1, y0, y1, what] for the overlap check
  const S = { floor: { main: "", upper: "" }, wall: { main: "", upper: "" }, leaf: { main: "", upper: "" }, cushF: { main: "" }, shellF: { main: "" }, suite: { main: "" }, cushJ: { upper: "" }, shellJ: { upper: "" }, cushY: { main: "", upper: "" }, backY: { main: "", upper: "" }, mon: { main: "", upper: "" }, monLine: { main: "", upper: "" }, monFaint: { main: "", upper: "" }, lav: { main: "", upper: "" }, fd: { main: "" }, fdLine: { main: "" } };
  const add = (key, deck, d) => {
    S[key][deck] = (S[key][deck] ?? "") + d;
  };
  // r1 (interaction, fidelity): pick regions. Each is a polygon in the deck's own model (x, y), a name (a label prefix
  // under cabin.plan.) and a priority (0 first: doors, monuments, the flight deck; 1 the seat blocks; 2 the decks): while
  // the plan shows, live.js's pickAt asks the page script below, which tests them in that order
  const regions = [];
  const labels = new Map();
  const region = (name, deck, pts, label, rank) => {
    regions.push({ name, deck, rank, pts: pts.map(([x, y]) => [+x.toFixed(3), +(y + yOff[deck]).toFixed(3)]) });
    if (!labels.has(name)) labels.set(name, label);
  };
  const rect = (x0, x1, y0, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

  // ---- the decks' floors and walls, with the doors as gaps
  for (const deck of ["main", "upper"]) {
    const [x0, x1] = DECK_END[deck];
    const xs = [];
    for (let x = x0; x < x1; x += 0.25) xs.push(x);
    xs.push(x1);
    add("floor", deck, polyM([...xs.map((x) => [x, -half(deck, x)]), ...xs.slice().reverse().map((x) => [x, half(deck, x)])]));
    const t = 0.12;
    const doors = M.DOORS.passenger.filter((d) => d.deck === deck && d.side === "L").map((d) => [d.x - d.width / 2, d.x + d.width / 2, d]);
    // wall slivers between the doors on each side; the first and last wrap round the deck's ends
    const sideRun = (a, b, s) => {
      const pts = [];
      for (let x = a; x < b; x += 0.25) pts.push(x);
      pts.push(b);
      return pts.map((x) => [x, s * half(deck, x)]);
    };
    const outer = (pts, s) => pts.map(([x]) => [x, s * (half(deck, x) + t)]);
    const first = doors[0][0];
    const last = doors[doors.length - 1][1];
    {
      const port = sideRun(x0, first, -1);
      const stbd = sideRun(x0, first, 1);
      // forward U: port inner from the door to the end, across, starboard inner back to the door; then outside
      add("wall", deck, polyM([...port.slice().reverse(), ...stbd, ...outer(stbd, 1).reverse(), [x0 - t, half(deck, x0) + t], [x0 - t, -half(deck, x0) - t], ...outer(port, -1)]));
      const portA = sideRun(last, x1, -1);
      const stbdA = sideRun(last, x1, 1);
      add("wall", deck, polyM([...portA, ...stbdA.slice().reverse(), ...outer(stbdA, 1), [x1 + t, half(deck, x1) + t], [x1 + t, -half(deck, x1) - t], ...outer(portA, -1).reverse()]));
    }
    for (let i = 1; i < doors.length; i++) {
      for (const s of [-1, 1]) {
        const run = sideRun(doors[i - 1][1], doors[i][0], s);
        add("wall", deck, polyM([...run, ...outer(run, s).reverse()]));
      }
    }
    // door leaves, closed, in the skin outboard of each gap, and the door names on the reader's side
    for (const [a, b, d] of doors) {
      for (const s of [-1, 1]) {
        const h = half(deck, (a + b) / 2) + t;
        add("leaf", deck, box(a - 0.04, b + 0.04, s * (h + 0.005), s * (h + 0.09), 0.02));
      }
    }
    // every door (both sides) names itself: a pick region over its gap and leaf, reaching into the cabin a little
    for (const d of M.DOORS.passenger.filter((q) => q.deck === deck)) {
      const s = d.side === "L" ? -1 : 1;
      const h = half(deck, d.x);
      region(`cabin.plan.door.${d.id}`, deck, [[d.x - d.width / 2 - 0.05, s * (h - 0.35)], [d.x + d.width / 2 + 0.05, s * (h - 0.35)], [d.x + d.width / 2 + 0.05, s * (h + 0.4)], [d.x - d.width / 2 - 0.05, s * (h + 0.4)]], `Door ${d.id} · ${deck} deck, ${d.side === "L" ? "left" : "right"} side · ${d.type}`, 0);
    }
  }

  // ---- seats
  const zonesOf = (deck) => D[deck].zones;
  const glyph = (deck, cls, x, y, w, lane) => {
    // x: the station (seat reference point); y: the seat's centre; w: its width
    if (cls === "Y") {
      add("cushY", deck, box(x - 0.42, x - 0.04, y - w / 2 + 0.05, y + w / 2 - 0.05, 0.07));
      add("backY", deck, box(x - 0.04, x + 0.12, y - w / 2 + 0.04, y + w / 2 - 0.04, 0.04));
      boxes[deck].push([x - 0.42, x + 0.12, y - w / 2 + 0.04, y + w / 2 - 0.04, "Y seat"]);
      rec.glyphW = Math.min(rec.glyphW, 0.54);
      rec.glyphH = Math.min(rec.glyphH, w - 0.08);
    } else if (cls === "J") {
      // the shell wraps the reclined back; the seat and its legrest ahead of it
      add("shellJ", deck, box(x - 0.1, x + 0.43, y - w / 2 + 0.03, y + w / 2 - 0.03, 0.12));
      add("cushJ", deck, box(x - 0.54, x - 0.02, y - w / 2 + 0.09, y + w / 2 - 0.09, 0.08));
      boxes[deck].push([x - 0.54, x + 0.43, y - w / 2 + 0.03, y + w / 2 - 0.03, "J seat"]);
      rec.glyphW = Math.min(rec.glyphW, 0.97);
      rec.glyphH = Math.min(rec.glyphH, w - 0.06);
    } else {
      // First: the seat, the ottoman at the suite's front, the shell behind
      add("cushF", deck, box(x - 0.6, x - 0.02, y - 0.22, y + 0.22, 0.09) + box(x - 0.94, x - 0.66, y - 0.19, y + 0.19, 0.05));
      add("shellF", deck, box(x - 0.02, x + 0.26, y - lane / 2 + 0.03, y + lane / 2 - 0.03, 0.05));
      rec.glyphW = Math.min(rec.glyphW, 0.58);
      rec.glyphH = Math.min(rec.glyphH, 0.44);
    }
  };
  for (const deck of ["main", "upper"]) {
    for (const zone of zonesOf(deck)) {
      const ys = D[deck].layoutY[zone.cls];
      const sideCount = zone.cls === "Y" && deck === "main" ? 3 : 2;
      const cols = { l: ys.slice(0, sideCount), c: ys.slice(sideCount, ys.length - sideCount), r: ys.slice(ys.length - sideCount) };
      const w = zone.cls === "F" ? 0.55 : zone.seatWidth;
      let placed = 0;
      const rows = [...zone.sideRows.map((x) => [x, "side"]), ...zone.centreRows.map((x) => [x, "centre"])].sort((a, b) => a[0] - b[0]);
      const lastCentre = Math.max(...zone.centreRows);
      for (const [x, kind] of rows) {
        let list = kind === "side" ? [...cols.l, ...cols.r] : cols.c.slice();
        // upper-deck Y: the AC's 103 (see the header): the last centre row three-abreast [E]
        if (deck === "upper" && zone.cls === "Y" && kind === "centre" && x === lastCentre) list = list.slice(0, list.length - 1);
        // f3-fuselage (shared edit, interiors' file): the main deck's last two side rows (51.67, 52.44) are 2-4-2, the
        // window seats left out where the tail narrows the cabin (AC's 334). This was the wall check's doing while the
        // tail was drawn 4.5-8.5% narrow; with the tail at the model's width those window seats clear the wall by a few
        // centimetres, so the AC's layout is stated here, as the upper deck's last centre row is above.
        const taper = deck === "main" && zone.cls === "Y" && kind === "side" && x >= 51.6 ? Math.max(...list.map(Math.abs)) : null;
        const len = zone.cls === "F" ? [0.97, 0.28] : zone.cls === "J" ? [0.54, 0.43] : [0.42, 0.12];
        for (const y of list) {
          const room = halfMin(deck, x - len[0], x + len[1]);
          if (taper !== null && Math.abs(y) === taper) {
            rec.dropped.push({ deck, cls: zone.cls, x, y, edge: Math.abs(y) + w / 2, wall: room, taper: true });
            continue;
          }
          if (Math.abs(y) + w / 2 > room) {
            rec.dropped.push({ deck, cls: zone.cls, x, y, edge: Math.abs(y) + w / 2, wall: room });
            continue;
          }
          glyph(deck, zone.cls, x, y, w, w);
          placed++;
        }
        if (zone.cls === "F") {
          // the suites: one wall round each pair (as the 3D suites), open toward the aisle
          for (const group of kind === "side" ? [cols.l, cols.r] : [cols.c]) {
            const y0 = group[0] - 0.275 - 0.055 - 0.04;
            const y1 = group[group.length - 1] + 0.275 + 0.055 + 0.04;
            add("suite", deck, box(x - 0.97, x + 0.28, y0, y1, 0.08));
            boxes[deck].push([x - 0.97, x + 0.28, y0, y1, "F suite"]);
          }
        }
      }
      // the zone's blocks: one region per seat column group (outboard, centre, outboard), all under the zone's name
      {
        const len = zone.cls === "F" ? [0.97, 0.28] : zone.cls === "J" ? [0.54, 0.43] : [0.42, 0.12];
        const pad = zone.cls === "F" ? 0.37 : 0.03;
        const same = zonesOf(deck).filter((z) => z.cls === zone.cls);
        const zi = same.indexOf(zone);
        const name = `cabin.plan.${deck}.${zone.cls.toLowerCase()}${zi + 1}`;
        const word = { F: "First", J: "Business", Y: "Economy" }[zone.cls];
        const part = same.length > 1 ? (zi === 0 ? " forward" : " aft") : "";
        const label = `${word} ${placed} seats, ${deck} deck${part} · ${zone.cls === "F" ? "suites " : ""}${zone.abreast} · rows ${zone.x[0].toFixed(1)}-${zone.x[1].toFixed(1)} m from the nose`;
        for (const [list, kind] of [[cols.l, "side"], [cols.c, "centre"], [cols.r, "side"]]) {
          const here = rows.filter(([, k]) => k === kind).map((r) => r[0]);
          if (!list.length || !here.length) continue;
          region(name, deck, rect(Math.min(...here) - len[0], Math.max(...here) + len[1], list[0] - w / 2 - pad, list[list.length - 1] + w / 2 + pad), label, 1);
        }
      }
      rec.seats[zone.cls] += placed;
      rec.deck[deck] += placed;
      rec.zones = [...(rec.zones ?? []), { deck, cls: zone.cls, seats: placed, want: zone.seats, x: zone.x }];
    }
  }

  // ---- the flight deck (main strip, ahead of the main deck): 2 pilot and 2 observer seats, panel, pedestal, consoles
  {
    const E = W.PILOT_EYE;
    for (const s of [-1, 1]) {
      const yc = s * E[1];
      add("fd", "main", box(2.56, 3.06, yc - 0.24, yc + 0.24, 0.08) + box(3.06, 3.17, yc - 0.23, yc + 0.23, 0.04));
      add("fd", "main", box(3.98, 4.42, s * 0.66 - 0.22, s * 0.66 + 0.22, 0.07) + box(4.42, 4.5, s * 0.66 - 0.2, s * 0.66 + 0.2, 0.03));
      add("fdLine", "main", box(2.62, 3.42, s > 0 ? 0.82 : -1.08, s > 0 ? 1.08 : -0.82, 0.04));
      rec.fd += 2;
    }
    add("fdLine", "main", box(2.1, 2.4, -0.98, 0.98, 0.04) + box(2.52, 3.42, -0.25, 0.25, 0.04));
    // the rear bulkhead (5.40-5.56) with its door, and the stowage either side
    const bh = half("main", 5.48);
    add("mon", "main", box(5.4, 5.56, -bh, -0.47, 0.02) + box(5.4, 5.56, 0.47, bh, 0.02));
    add("monLine", "main", box(5.4, 5.56, -bh, -0.47, 0.02) + box(5.4, 5.56, 0.47, bh, 0.02));
    add("monFaint", "main", seg(5.44, -0.45, 5.44, 0.45) + box(5.38, 5.44, -0.45, 0.45, 0.01));
  }

  region("cabin.plan.main.fd", "main", rect(1.94, 5.4, -1.1, 1.1), `Flight deck · ${rec.fd} seats: 2 pilots and 2 observers · 8 displays`, 0);

  // ---- monuments
  const wallY = (deck, x0, x1) => halfMin(deck, x0, x1) - 0.03;
  for (const deck of ["main", "upper"]) {
    const data = D[deck].monuments;
    MONUMENTS[deck].forEach((m, i) => {
      const src = data[i];
      if (!src || src.kind !== m.kind) throw new Error(`deck plan: ${deck} monument ${i} is ${src && src.kind}, the plan draws ${m.kind}`);
      const drawn = [];
      const foot = [];
      const keep = (x0, x1, y0, y1, what) => {
        drawn.push([x0, x1]);
        boxes[deck].push([x0, x1, Math.min(y0, y1), Math.max(y0, y1), what]);
        foot.push(what === "spiral stair" ? Array.from({ length: 12 }, (_, k) => [(x0 + x1) / 2 + ((x1 - x0) / 2) * Math.cos((k * Math.PI) / 6), (y0 + y1) / 2 + ((y1 - y0) / 2) * Math.sin((k * Math.PI) / 6)]) : rect(x0, x1, Math.min(y0, y1), Math.max(y0, y1)));
      };
      if (m.stair) {
        const { x, y, up, well } = m.stair;
        add("mon", deck, box(x[0], x[1], y[0], y[1], 0.03));
        add("monLine", deck, box(x[0], x[1], y[0], y[1], 0.03));
        let d = "";
        for (let t = x[0] + 0.27; t < x[1] - 0.05; t += 0.27) d += seg(t, y[0], t, y[1]);
        // the handrails along both sides (closed slivers), and on the upper deck the balustrade round the well
        d += box(x[0], x[1], y[0] + 0.04, y[0] + 0.09, 0.02) + box(x[0], x[1], y[1] - 0.09, y[1] - 0.04, 0.02);
        add("monFaint", deck, d);
        if (well) add("monLine", deck, box(x[0] - 0.06, x[1] + 0.06, y[0] - 0.06, y[1] + 0.06, 0.05));
        // the climb's direction: a chevron at the top end (a closed mark)
        const xt = up > 0 ? x[1] - 0.3 : x[0] + 0.3;
        const ym = (y[0] + y[1]) / 2;
        add("monLine", deck, polyM([[xt, ym - 0.22], [xt + up * 0.18, ym], [xt, ym + 0.22], [xt + up * 0.08, ym]]));
        keep(x[0], x[1], y[0], y[1], "stair");
      }
      if (m.spiral) {
        const { c, r } = m.spiral;
        add("mon", deck, circ(c[0], c[1], r));
        add("monLine", deck, circ(c[0], c[1], r) + circ(c[0], c[1], 0.16));
        let d = "";
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * 2 * Math.PI + (deck === "upper" ? 0.2 : 0);
          d += seg(c[0] + 0.16 * Math.cos(a), c[1] + 0.16 * Math.sin(a), c[0] + r * Math.cos(a), c[1] + r * Math.sin(a));
        }
        add("monFaint", deck, d);
        keep(c[0] - r, c[0] + r, c[1] - r, c[1] + r, "spiral stair");
      }
      if (m.lavs) {
        for (const [x0, x1, y0, y1] of m.lavs) {
          add("lav", deck, box(x0, x1, y0, y1, 0.05));
          add("monLine", deck, box(x0, x1, y0, y1, 0.05));
          // the pan (an oval against the outboard or aft wall), the basin, the door
          const ym = (y0 + y1) / 2;
          const xc = x1 - 0.22;
          add("monFaint", deck, `M${f1(PX(xc) - 1.5)} ${f1(PY(ym))}a1.5 1.1 0 1 0 3 0a1.5 1.1 0 1 0 -3 0Z` + circ(x0 + 0.2, ym, 0.1) + seg(x0 + 0.06, y0 + 0.08, x0 + 0.06, y1 - 0.08));
          keep(x0, x1, y0, y1, "lavatory");
        }
      }
      if (m.boxes) {
        const list = m.boxes === "fdStow" ? [[5.02, 5.39, 0.85, "wall"], [5.02, 5.39, "wall", -0.85]] : m.boxes;
        for (const b of list) {
          const [x0, x1] = b;
          const y0 = b[2] === "wall" ? -wallY(deck, x0, x1) : b[2];
          const y1 = b[3] === "wall" ? wallY(deck, x0, x1) : b[3];
          add("mon", deck, box(x0, x1, y0, y1, 0.04));
          add("monLine", deck, box(x0, x1, y0, y1, 0.04));
          if (m.kind === "galley") {
            // trolley bays along the long faces (closed), the work deck between
            let d = "";
            const n = Math.max(1, Math.floor((x1 - x0 - 0.2) / 0.32));
            const pitch = (x1 - x0 - 0.2) / n;
            for (let k = 0; k < n; k++) {
              const a = x0 + 0.1 + k * pitch;
              if (y1 - y0 > 1.2) d += box(a + 0.03, a + pitch - 0.03, y0 + 0.06, y0 + 0.44, 0.02) + box(a + 0.03, a + pitch - 0.03, y1 - 0.44, y1 - 0.06, 0.02);
              else d += box(a + 0.03, a + pitch - 0.03, y0 + 0.06, y1 - 0.06, 0.02);
            }
            add("monFaint", deck, d);
          } else {
            // the coat rail: a closed bar along the cupboard
            add("monFaint", deck, box(x0 + 0.08, x1 - 0.08, (y0 + y1) / 2 - 0.02, (y0 + y1) / 2 + 0.02, 0.01));
          }
          keep(x0, x1, y0, y1, m.kind);
        }
      }
      if (m.lift) {
        const [x0, x1, y0, y1] = m.lift;
        add("mon", deck, box(x0, x1, y0, y1, 0.02));
        add("monLine", deck, box(x0, x1, y0, y1, 0.02) + seg(x0, y0, x1, y1) + seg(x0, y1, x1, y0));
        // a galley's cart lift lies inside the galley; a passenger lift is a monument of its own
        if (m.kind === "lift") keep(x0, x1, y0, y1, "lift");
      }
      if (m.room) {
        const [x0, x1, y0, y1] = m.room;
        add("mon", deck, box(x0, x1, y0, y1, 0.05));
        add("monLine", deck, box(x0, x1, y0, y1, 0.05));
        let d = "";
        const bw = (x1 - x0 - 0.1) / m.bunks;
        for (let k = 0; k < m.bunks; k++) {
          const a = x0 + 0.05 + k * bw;
          d += box(a + 0.04, a + bw - 0.04, y0 + 0.08, y1 - 0.08, 0.06) + box(a + 0.12, a + bw - 0.12, y1 - 0.42, y1 - 0.14, 0.05);
        }
        add("monFaint", deck, d);
        keep(x0, x1, y0, y1, "crew rest");
      }
      // its name, from the data (kind, count, note): every monument names itself on hover or tap
      for (const pts of foot) region(`cabin.plan.${deck}.${m.kind}.${i + 1}`, deck, pts, MON_LABEL[deck][i] ?? `${m.kind} · ${deck} deck`, 0);
      const xs = drawn.flat();
      rec.monuments.push({ deck, kind: m.kind, count: m.lavs ? m.lavs.length : src.count ?? 1, want: src.count ?? 1, x: [Math.min(...xs), Math.max(...xs)], data: src.x, moved: m.moved ?? null, note: src.note ?? "" });
    });
  }
  // ---- the five cut bays, outlined (the lit accent: they are the 3D cutaway's bays)
  let bays = "";
  for (const [key, deck] of [["FD", "main"], ["F", "main"], ["M", "main"], ["U", "upper"], ["UY", "upper"]]) {
    const c = W.CUT[key];
    const h = Math.max(half(deck, c.x[0]), half(deck, c.x[1]), half(deck, (c.x[0] + c.x[1]) / 2)) + 0.32;
    const d = box(c.x[0], c.x[1], -h, h, 0.25);
    bays += `<g transform="translate(0 ${f1(PY(yOff[deck]))})">${line(d, "lit")}</g>`;
    rec.bays.push({ key, deck, x: c.x });
  }

  // ---- the decks: their names engraved large outside the strips (the only words in the plane), and a pick region each
  const hm = half("main", 30);
  const hu = half("upper", 30);
  out.main.push(text(2.2, -hm - 1.0, "MAIN DECK", DECK_NAME.size, "a3-dp-t a3-dp-th", "start", "hanging"));
  out.upper.push(text(8.6, hu + 1.0, "UPPER DECK", DECK_NAME.size, "a3-dp-t a3-dp-th"));
  const yMain = rec.zones.find((z) => z.deck === "main" && z.cls === "Y").seats;
  const yUpper = rec.zones.find((z) => z.deck === "upper" && z.cls === "Y").seats;
  for (const deck of ["main", "upper"]) {
    const [x0, x1] = DECK_END[deck];
    const xs = [];
    for (let x = x0; x < x1; x += 1.0) xs.push(x);
    xs.push(x1);
    const what = deck === "main" ? `First ${rec.seats.F}, Economy ${yMain} · and the flight deck's ${rec.fd} crew seats` : `Business ${rec.seats.J}, Economy ${yUpper}`;
    region(`cabin.plan.${deck}`, deck, [...xs.map((x) => [x, -half(deck, x) - 0.12]), ...xs.slice().reverse().map((x) => [x, half(deck, x) + 0.12])], `${deck === "main" ? "Main" : "Upper"} deck · ${rec.deck[deck]} seats · ${what}`, 2);
  }
  rec.key = { main: rec.deck.main, upper: rec.deck.upper, F: rec.seats.F, J: rec.seats.J, Y: rec.seats.Y, yMain, yUpper, fd: rec.fd };

  // ---- overlap and fit checks (seats against seats, monuments and the walls)
  for (const deck of ["main", "upper"]) {
    const list = boxes[deck];
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (Math.max(Math.abs(a[2]), Math.abs(a[3])) > halfMin(deck, a[0], a[1]) + 1e-6 && a[4] !== "spiral stair") rec.outside.push(`${deck} ${a[4]} at x ${a[0].toFixed(2)}..${a[1].toFixed(2)} reaches |y| ${Math.max(Math.abs(a[2]), Math.abs(a[3])).toFixed(2)} (wall ${halfMin(deck, a[0], a[1]).toFixed(2)})`);
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (a[4] === "F suite" && b[4] === "F suite") continue;
        const spiral = a[4] === "spiral stair" ? a : b[4] === "spiral stair" ? b : null;
        if (spiral) {
          // the spiral stair is a circle: the nearest point of the other box to its centre
          const o = spiral === a ? b : a;
          const c = [(spiral[0] + spiral[1]) / 2, (spiral[2] + spiral[3]) / 2];
          const r = (spiral[1] - spiral[0]) / 2;
          const q = [Math.min(Math.max(c[0], o[0]), o[1]), Math.min(Math.max(c[1], o[2]), o[3])];
          if (Math.hypot(q[0] - c[0], q[1] - c[1]) < r - 1e-6) rec.overlaps.push(`${deck} spiral stair × ${o[4]} ${o[0].toFixed(2)}..${o[1].toFixed(2)}`);
          continue;
        }
        if (a[0] < b[1] - 1e-6 && b[0] < a[1] - 1e-6 && a[2] < b[3] - 1e-6 && b[2] < a[3] - 1e-6) rec.overlaps.push(`${deck} ${a[4]} ${a[0].toFixed(2)}..${a[1].toFixed(2)} × ${b[4]} ${b[0].toFixed(2)}..${b[1].toFixed(2)}`);
      }
    }
  }

  // ---- the picture: per deck, floors, walls, seats, monuments; then the bays and the words
  const deckSvg = (deck) => {
    const p = [
      path("a3-dp-floor", S.floor[deck]),
      path("a3-dp-mon", S.mon[deck]),
      path("a3-dp-lav", S.lav[deck]),
      line(S.monLine[deck], "lo"),
      line(S.monFaint[deck], "faint"),
      path("a3-dp-suite", S.suite[deck] ?? "", "faint"),
      path("a3-dp-shf", S.shellF[deck] ?? "", "lo"),
      path("a3-dp-cf", S.cushF[deck] ?? "", "lo"),
      path("a3-dp-shj", S.shellJ[deck] ?? "", "lo"),
      path("a3-dp-cj", S.cushJ[deck] ?? "", "faint"),
      path("a3-dp-by", S.backY[deck] ?? "", "lo"),
      path("a3-dp-cy", S.cushY[deck] ?? "", "faint"),
      path("a3-dp-fd", S.fd[deck] ?? "", "lo"),
      line(S.fdLine[deck] ?? "", "lo"),
      path("a3-dp-wall", S.wall[deck], "mid"),
      path("a3-dp-leaf", S.leaf[deck], "lo"),
      ...out[deck],
    ].join("");
    return `<g transform="translate(0 ${f1(PY(yOff[deck]))})">${p}</g>`;
  };
  const svg = `<g class="a3-dp" style="opacity:0;visibility:hidden">${deckSvg("main")}${deckSvg("upper")}${bays}</g>`;
  ctx.planeOn("stage.platter", { o: W.kit([DX, 0, 0]), u: W.kitDir([1, 0, 0]), v: W.kitDir([0, -1, 0]), normal: [0, 0, 1], fade: [-1, -0.9], svg });
  rec.svgKB = svg.length / 1024;

  // ---- tokens (light first, dark after) and the ghost rules
  ctx.css(`.iso{--a3-dp-floor:#f6f4ef;--a3-dp-wall:#9a948c;--a3-dp-mon:#dedad2;--a3-dp-lav:#e6e3dc;--a3-dp-cy:#c9c0b4;--a3-dp-by:#8d8377;--a3-dp-cj:#b6aa9b;--a3-dp-shj:#776c60;--a3-dp-cf:#a39484;--a3-dp-shf:#6b5f53;--a3-dp-suite:#ebe6de;--a3-dp-fd:#6f6a64}
.iso[data-theme="dark"]{--a3-dp-floor:#2b2926;--a3-dp-wall:#6e6961;--a3-dp-mon:#3b3834;--a3-dp-lav:#35332f;--a3-dp-cy:#5c554d;--a3-dp-by:#857b6f;--a3-dp-cj:#6e655b;--a3-dp-shj:#9a8f82;--a3-dp-cf:#7e7163;--a3-dp-shf:#a89a8a;--a3-dp-suite:#34312d;--a3-dp-fd:#8a847c}
.a3-dp{pointer-events:none}
.a3-dp-floor{fill:var(--a3-dp-floor);stroke:none}
.a3-dp-wall{fill:var(--a3-dp-wall)}
.a3-dp-leaf{fill:var(--a3-dp-wall)}
.a3-dp-mon{fill:var(--a3-dp-mon);stroke:none}
.a3-dp-lav{fill:var(--a3-dp-lav);stroke:none}
.a3-dp-cy{fill:var(--a3-dp-cy)}
.a3-dp-by{fill:var(--a3-dp-by)}
.a3-dp-cj{fill:var(--a3-dp-cj)}
.a3-dp-shj{fill:var(--a3-dp-shj)}
.a3-dp-cf{fill:var(--a3-dp-cf)}
.a3-dp-shf{fill:var(--a3-dp-shf)}
.a3-dp-suite{fill:var(--a3-dp-suite)}
.a3-dp-fd{fill:var(--a3-dp-fd)}
.a3-dp-t{font-family:var(--anatomy-mono);fill:var(--anatomy-muted);letter-spacing:.06em}
.a3-dp-th{fill:var(--anatomy-text);letter-spacing:.08em}
.a3-dp-tb{fill:var(--anatomy-mid)}
.a3-dp-tm{fill:var(--anatomy-mid)}
@media (max-width:600px){.a3-dp .a3-dp-th{font-size:${DECK_NAME.phone}px}}
.a3-dpk{position:absolute;left:10px;bottom:10px;width:max-content;max-width:46%;white-space:nowrap;z-index:2;pointer-events:none;background:var(--anatomy-card);box-shadow:inset 0 0 0 1px var(--anatomy-faint);border-radius:4px;padding:6px 8px 5px;font:10px/1.45 var(--anatomy-mono);color:var(--anatomy-muted);letter-spacing:.02em}
.a3-dpk[hidden]{display:none}
.a3-dpk p{margin:0}
.a3-dpk .a3-dpk-t{color:var(--anatomy-text);margin-bottom:3px}
.a3-dpk i{display:inline-block;width:.8em;height:.8em;margin:0 .35em 0 .1em;vertical-align:-.05em;border-radius:1px;box-shadow:inset 0 0 0 1px var(--anatomy-lo)}
.a3-dpk .a3-dpk-f{background:var(--a3-dp-cf)}
.a3-dpk .a3-dpk-j{background:var(--a3-dp-cj)}
.a3-dpk .a3-dpk-y{background:var(--a3-dp-cy)}
.a3-dpk .a3-dpk-h{margin-top:3px}
.a3-dpk .a3-dpk-coarse{display:none}
@media (pointer:coarse){.a3-dpk .a3-dpk-coarse{display:inline}.a3-dpk .a3-dpk-fine{display:none}}
.a3-compact .a3-dpk .a3-dpk-coarse{display:inline}.a3-compact .a3-dpk .a3-dpk-fine{display:none}
@media (max-width:600px){.a3-dpk{left:calc(6.5% + 4px);bottom:12px;max-width:70%;font-size:9px;padding:4px 6px}}
.a3-stage{--a3-dp:0}
.a3-stage>canvas.iso-layer,.a3-stage>svg.iso-layer[data-live="airframe"],.a3-stage .a3-dk-footprint,.a3-stage .a3-dk-contacts,.a3-stage g[clip-path="url(#a3-m8-pool-clip)"]{opacity:calc(1 - ${(1 - GHOST).toFixed(2)} * var(--a3-dp))}
.a3-stage .a3-set-stand .a3-dk-yellow{opacity:calc(1 - ${(1 - GHOST).toFixed(2)} * var(--a3-dp))}
.a3-stage.a3-dp-on :is(.a3-m8-pool,.a3-m8-bpool,.a3-m8-spool)>path{opacity:calc(1 - ${(1 - GHOST).toFixed(2)} * var(--a3-dp))}`);
  // f3-interiors: without WebGL the lamps' ground pools (lights.mjs, a plane on the platter after this one: the cargo
  // floods and the gear-bay lamps at the gate) drew over the plan as soft pools on the flight deck, the upper deck's nose
  // and the wing box; under WebGL the same light is on the GL canvases, which ghost. Their paths ghost with the airframe
  // (the groups' own opacity is the lamps' vary alpha, written inline, so the rule sits on the paths and multiplies it;
  // it applies only while the plan shows, class a3-dp-on on the stage, so no other state's style changes)
  // r2 (craft-dark): the stand's yellow markings (the lead-in, its stop bars, the equipment boxes) ghost with the airframe
  // in the Deck plan: the nose stop bar, 0.3 m wide across the stand, drew over the flight deck's plan (luminance 69-122
  // where the plan's floor reads 41)
  // (merge: the lamps' ground pools without WebGL are SVG on the deck layer, under the plan; they ghost with the airframe)
  // the plan's alpha (and the ghost) ease with the view: pv.deckPlan settles toward 1 in the view, 0 outside it
  ctx.vary("a3-dp", "pv.deckPlan || 0");
  // r1 (interaction, fidelity): every region names itself; the labels (no action: a click names, never operates)
  for (const [name, label] of labels) ctx.label(name, label);
  regions.sort((a, b) => a.rank - b.rank);
  rec.regions = { count: regions.length, names: labels.size, byRank: [0, 1, 2].map((r) => regions.filter((q) => q.rank === r).length) };
  const nDoors = M.DOORS.passenger.length;
  const nMon = D.main.monuments.length + D.upper.monuments.length;
  const K3 = [W.kit([DX, 0, 0]), W.kit([DX + 1, 0, 0]), W.kit([DX, 1, 0])];
  const k = rec.key;
  const keyHtml = `<p class="a3-dpk-t">Deck plan · ${k.main + k.upper} seats</p><p>Upper ${k.upper} · <i class="a3-dpk-j"></i>Business ${k.J} · <i class="a3-dpk-y"></i>Economy ${k.yUpper}</p><p>Main ${k.main} · <i class="a3-dpk-f"></i>First ${k.F} · <i class="a3-dpk-y"></i>Economy ${k.yMain}</p><p>Flight deck ${k.fd} · ${nMon} monuments · ${nDoors} doors</p><p class="a3-dpk-h"><span class="a3-dpk-fine">Point at</span><span class="a3-dpk-coarse">Tap</span> a block or a door to name it</p>`;
  rec.keyText = keyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  ctx.script(`(() => {
  let x = 0;
  let shown = null;
  let css = "";
  const plan = () => document.querySelector(".a3-stage .a3-dp");
  // the key: the plan's counts and its class colours, in the card's corner while the view is open
  const stageEl = document.querySelector(".a3-stage");
  const key = document.createElement("div");
  key.className = "a3-dpk";
  key.hidden = true;
  key.setAttribute("aria-hidden", "true");
  key.innerHTML = ${JSON.stringify(keyHtml)};
  if (stageEl) stageEl.appendChild(key);
  // pick regions in plan metres (x from the plan's origin, y with the upper deck's offset), nearest first
  const REG = ${JSON.stringify(regions.map((r) => ({ n: r.name, p: r.pts.flat() })))};
  const K3 = ${JSON.stringify(K3)};
  const inside = (p, u, v) => {
    let c = false;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      const xi = p[i], yi = p[i + 1], xj = p[j], yj = p[j + 1];
      if (yi > v !== yj > v && u < ((xj - xi) * (v - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  // the picked region's outline: an overlay over the stage in the deck layer's (zoomed) viewBox, styled as the canvas
  // page's hover hull (live.js); the plan itself is the kit's plane, which the runtime re-emits
  const NS = "http://www.w3.org/2000/svg";
  const deckLayer = () => stageEl && stageEl.querySelector('svg[data-live="deck"]');
  const over = document.createElementNS(NS, "svg");
  over.setAttribute("class", "iso-layer a3-hover-layer a3-dp-over");
  over.setAttribute("aria-hidden", "true");
  const hotPath = document.createElementNS(NS, "path");
  hotPath.setAttribute("class", "a3-hover-hull");
  over.appendChild(hotPath);
  if (stageEl) stageEl.appendChild(over);
  /** The plan's affine map to the view (deck viewBox units): origin and the screen steps of 1 m along x and y. */
  const frameOf = () => {
    const c = A3.controller;
    if (!c || typeof c.anchor !== "function") return null;
    const a = c.anchor("air", K3[0]).screen;
    const b = c.anchor("air", K3[1]).screen;
    const e = c.anchor("air", K3[2]).screen;
    return { a, ex: [b[0] - a[0], b[1] - a[1]], ey: [e[0] - a[0], e[1] - a[1]] };
  };
  let hot = null;
  let hotKey = "";
  const drawHot = () => {
    let d = "";
    const f = hot ? frameOf() : null;
    if (f) for (const r of REG) if (r.n === hot) {
      for (let i = 0; i < r.p.length; i += 2) {
        const X = f.a[0] + r.p[i] * f.ex[0] + r.p[i + 1] * f.ey[0];
        const Y = f.a[1] + r.p[i] * f.ex[1] + r.p[i + 1] * f.ey[1];
        d += (i ? "L" : "M") + X.toFixed(2) + " " + Y.toFixed(2);
      }
      d += "Z";
    }
    const dl = deckLayer();
    const vb = dl ? dl.getAttribute("viewBox") : null;
    const key = d + "|" + vb;
    if (key === hotKey) return;
    hotKey = key;
    if (vb) over.setAttribute("viewBox", vb);
    hotPath.setAttribute("d", d);
  };
  const setHot = (name) => {
    hot = name;
    drawHot();
  };
  /** live.js pickAt asks this while the plan shows: view (deck viewBox) coordinates to the region under them, or null. */
  A3.pickPlan = (vx, vy) => {
    const f = frameOf();
    if (!f) return null;
    const det = f.ex[0] * f.ey[1] - f.ex[1] * f.ey[0];
    if (Math.abs(det) < 1e-9) return null;
    const qx = vx - f.a[0];
    const qy = vy - f.a[1];
    const u = (qx * f.ey[1] - qy * f.ey[0]) / det;
    const v = (f.ex[0] * qy - f.ex[1] * qx) / det;
    let name = null;
    for (const r of REG) if (inside(r.p, u, v)) { name = r.n; break; }
    setHot(name);
    return name;
  };
  A3.on("frame", (fx) => {
    const pv = fx.pv;
    const want = pv.inspect === ${JSON.stringify(PLAN_VIEW)} ? 1 : 0;
    const k = fx.calm ? 1 : 1 - Math.exp(-Math.max(0, fx.dt) / 0.18);
    x += (want - x) * k;
    if (Math.abs(want - x) < 0.004) x = want;
    pv.deckPlan = x;
    const v = (Math.round(x * 1000) / 1000).toString();
    if (v !== css) {
      css = v;
      document.querySelector(".a3-stage").style.setProperty("--a3-dp", v);
    }
    const on = x > 0;
    if (on !== shown) {
      shown = on;
      const el = plan();
      if (el) el.style.visibility = on ? "" : "hidden";
      if (stageEl) stageEl.classList.toggle("a3-dp-on", on); // f3-interiors: the no-WebGL pools' ghost rule
    }
    key.hidden = x < 0.05;
    if (!key.hidden) key.style.opacity = String(Math.round(x * 100) / 100);
    if (hot && (x < 0.5 || !pv.label)) setHot(null);
    else if (hot) drawHot();
  });
})();`);
  // the view: from the port side (nose left), framing both decks
  const cx = (DECK_END.main[0] + DECK_END.main[1]) / 2 + DX;
  const cy = (-(hm + 2.75) + DY_UPPER + hu + 2.8) / 2; // (the frame the old labels set; the deck names lie inside it)
  ctx.inspect({ id: PLAN_VIEW, label: "Deck plan", centre: [cx, cy, 0], kit: W.kit([cx, cy, 0]), group: "air", bearing: BEARING, zoom: ZOOM, cutaway: 0 });
  ctx.data("deckPlan", { view: PLAN_VIEW, ghost: GHOST, seats: rec.seats, decks: rec.deck });
  return rec;
}
