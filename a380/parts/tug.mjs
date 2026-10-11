// a380/parts/tug.mjs (follow-up, interaction): the pushback tug. A towbarless tractor of the class rated for the A380
// (TLD TPX-500-S, Goldhofer AST-1X; model.mjs TUG, truth.md §14a), drawn at true size round the nose wheels.
//
// Where it stands. The turntable's axis is at model station 41.30 (DESIGN §0.2), so the nose gear's axle (x 4.97) is
// 36.33 m from it and the platter's edge (r 38.6) only 2.27 m ahead of the axle; the 9.2 m tractor reaches 3.4 m past
// the nose tip, over the plinth and off the stage. The platter is a slice of airfield (its markings end at its
// edge, DESIGN §2), so the tug is drawn as far as the platter goes: a long, low chassis with rounded edges whose
// forward 0.4 m fades out toward the platter's edge, the driver's cab on it just ahead of the cradle (follow-up review 1: the hatched section read as a crate's cut
// face), two side frames that flank the nose wheels as the cradle's sides with a push plate between them, the drive
// wheels outboard of the frames on their hub motors, rubber bumpers, rear lamps and hazard chevrons.
// Its engine bay and steering axle lie beyond the edge and are not drawn (the label says so; fu/r2-interaction: the cab
// is drawn, it sits just ahead of the cradle).
//
// Motion. A free root group `tug`, synced to pitch's world pose slid forward by F.tugOffset(channel tug) (follow.mjs
// slideSync), parked while the channel is 0 or 2. The channel is the model's s.tug: it drives in over its last 6 m and
// fades in over the platter's edge (F.tugAlpha, one vary class for every part), stands at the wheel through the push,
// releases the wheel and drives off forward, fading as it leaves the platter. The nose gear does not steer while the
// cradle is at the wheel (follow.mjs channelsOf; the page refuses [ and ]).
//
// Contacts. The drive wheels stand tangent on the platter (z 0) like the aircraft's tyres. Every other part rests on a
// neighbour: the side frames and the push plate flush on the chassis's aft face, the plate between the frames' inner
// faces, the hub motors coaxial and flush between a frame's outer face and its wheel, the bumpers on the frames' aft
// faces, the cab on the deck, the deck's fade steps end to end. The cradle stands
// TUG.cradleClear (0.06 m) off the nose tyres (the real pick-up clamps and lifts them; checks()).
import * as Fx from "../follow.mjs";

export const id = "tug";
export const owner = "I";
export const title = "Pushback tug: towbarless tractor at the nose wheel, the push clip";
export const prefixes = ["tug."];
export const stub = false;

const m = (v) => v * 10;
const r3 = (v) => +v.toFixed(3);

/** The tug's numbers in model metres (attached, at rest), from the model and the world. */
function dims(M, W) {
  const T = M.TUG;
  const nose = M.GEAR.nose;
  const RN = M.GEAR.tyres.nose.diameter / 2;
  const tyreOut = nose.wheelY[1] + M.GEAR.tyres.nose.width / 2; // 0.7525: the nose tyres' outer faces
  const axleX = nose.axle[0];
  const front = axleX - RN; // 4.335: the nose tyres' front
  const rear = axleX + RN; // 5.605
  const clear = T.cradleClear;
  const armIn = tyreOut + clear; // the side frames' inner faces: the cradle's sides
  const back1 = front - clear; // the backplate's rear face, toward the tyres
  const back0 = back1 - 0.285; // [E] 0.285 m thick: the chassis ends here, the side frames run aft from it
  const cut = W.PIVOT_X - W.STAGE.platter.r; // 2.70: the platter's edge ahead of the nose gear
  const R = T.driveTyre.diameter / 2;
  const half = T.width / 2;
  const wIn = half - T.driveTyre.width; // 1.82: the drive tyres' inner faces
  return {
    T, RN, tyreOut, axleX, front, rear, clear, armIn, back0, back1, cut, half,
    // [E] a long, low chassis (deck 1.0 m; AST-1X 1.65 m overall, TPX-500-MTS 2.155 m with the cab), its top edges rounded;
    // the part drawn fades out over its last 0.7 m toward the platter's edge, where the rest of the tractor continues
    body: { x0: cut, x1: back0, z0: 0.2, z1: 1.0, r: 0.18, fades: [cut + 0.2, cut + 0.4] },
    // [E] the operator's cab: the TPX-500-S seats the driver "perfectly aligned with NLG and very close to the cradle"
    // (TLD), so a narrow cab stands on the centreline just ahead of it; roof 1.95 m (TPX-500-MTS 2.155 m overall)
    cab: { x0: cut + 0.48, x1: back0 - 0.05, y: 0.78, z0: 1.0, z1: 1.95, r: 0.14 },
    // [E] the side frames flank the nose wheels (the cradle's sides), low and rounded, a chamfer and a bumper aft
    frame: { x0: back0, x1: rear + 0.3, xEnd: rear + 0.45, y1: wIn - 0.16, z0: 0.2, z1: 0.95, zEnd: 0.85, r: 0.16 },
    plate: { x0: back0, x1: back1, z0: 0.15, z1: 0.8 }, // [E] the push plate with its rubber pad
    wheel: { x: axleX, z: R, r: R, w: T.driveTyre.width, out: half, in: wIn },
    motor: { r: 0.3 }, // [E] the hydrostatic wheel motor and reducer
    bumper: { x1: rear + 0.55, y0: armIn + 0.14, y1: wIn - 0.3, z0: 0.28, z1: 0.56 }, // [E] rubber, on the frame's aft face
  };
}

export function groups(ctx) {
  ctx.group("tug", { free: { origin: [0, 0, 0] } });
  // synced while the tug is there (0 < tug < 2), slid forward along kit +x by the channel's table
  ctx.rule({ group: "tug", sync: { channel: "tug", above: 0, below: 2, slide: { channel: "tug", axis: [1, 0, 0], table: Fx.TUG_SLIDE } } });
}

/** A section (y, z) with rounded top corners (radius r, rIn on the inner side y0), as model points at station x. */
function roundedSection(x, y0, y1, z0, z1, r, rIn = r, steps = 4) {
  const pts = [[x, y0, z0], [x, y1, z0]];
  const arc = (cy, cz, rad, a0, a1) => {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push([x, cy + rad * Math.cos(a), cz + rad * Math.sin(a)]);
    }
  };
  arc(y1 - r, z1 - r, r, 0, Math.PI / 2);
  arc(y0 + rIn, z1 - rIn, rIn, Math.PI / 2, Math.PI);
  return pts;
}

export function build(ctx) {
  const { M, W } = ctx;
  const D = dims(M, W);
  const K = (p) => W.kit(p);
  const group = "tug";
  const cls = "a3-tug";
  const box = (name, x0, x1, y0, y1, z0, z1, opts = {}) => {
    const pts = [];
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) pts.push(K([x, y, z]));
    return ctx.hull({ name, group, points: pts, cls, material: "gold", tone: "mid", ...opts });
  };
  const loft = (name, sections, opts = {}) => ctx.hull({ name, group, rings: sections.map((ring) => ring.map(K)), smooth: true, sharp: 35, cls, material: "gold", tone: "mid", ...opts });
  const face = (part, o, u, v, normal, svg, fade = [0.02, 0.25]) => ctx.plane(part, { o: K(o), u: W.kitDir(u), v: W.kitDir(v), normal: W.kitDir(normal), svg, fade });
  const line = (d, tone = "lo") => `<path class="iso-line" data-tone="${tone}" d="${d}"/>`;

  // ---- the chassis: a low deck with rounded top edges. Follow-up review 1: the 45° hatched section at the platter's
  // edge read as a crate's cut face ("blueprint furniture"); the deck now fades over its last 0.4 m toward the edge in
  // two steps (a3-tug-f1, a3-tug-f2), so the tractor reads as continuing past the platter as its markings do
  const b = D.body;
  const deckSec = (x) => roundedSection(x, -D.half, D.half, b.z0, b.z1, b.r);
  const body = loft("tug.body", [deckSec(b.fades[1]), deckSec(b.x1)]);
  loft("tug.body.f1", [deckSec(b.fades[0]), deckSec(b.fades[1])], { cls: "a3-tug-f1" });
  loft("tug.body.f2", [deckSec(b.x0), deckSec(b.fades[0])], { cls: "a3-tug-f2" });
  {
    // the deck: two tread-plate covers and the hydraulic hatch between them (on the opaque part only)
    const top = (x0, x1, y0, y1) => `M${m(x0 - b.fades[1]).toFixed(2)} ${m(y0 + D.half).toFixed(2)}H${m(x1 - b.fades[1]).toFixed(2)}V${m(y1 + D.half).toFixed(2)}H${m(x0 - b.fades[1]).toFixed(2)}Z`;
    const deck = line(top(b.fades[1] + 0.08, b.x1 - 0.1, -D.half + b.r + 0.1, -0.12), "faint") + line(top(b.fades[1] + 0.08, b.x1 - 0.1, 0.12, D.half - b.r - 0.1), "faint");
    face(body, [b.fades[1], -D.half, b.z1], [1, 0, 0], [0, 1, 0], [0, 0, 1], deck);
  }

  // ---- the cab, on the centreline just ahead of the cradle: glazed all round, a roof lamp
  {
    const c = D.cab;
    const sec = (x) => roundedSection(x, -c.y, c.y, c.z0, c.z1, c.r);
    const cab = loft("tug.cab", [sec(c.x0), sec(c.x1)]);
    const H = m(c.z1 - c.z0);
    const glass = (w, h, x, y) => `<rect class="a3-tug-glass" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="0.5"/>`;
    // the aft face (toward the nose wheel: the driver's view of the cradle) and the forward face, u across y, v down
    for (const [x, n, uy] of [[c.x1, 1, -1], [c.x0, -1, 1]]) face(cab, [x, -uy * c.y, c.z1 - c.r], [0, uy, 0], [0, 0, -1], [n, 0, 0], glass(m(2 * c.y) - 2.4, H * 0.5, 1.2, 0.6));
    // the sides: one window each, u along x
    for (const sd of [-1, 1]) face(cab, [c.x0, sd * c.y, c.z1 - c.r], [1, 0, 0], [0, 0, -1], [0, sd, 0], glass(m(c.x1 - c.x0) - 2.0, H * 0.45, 1.0, 0.8));
    face(cab, [(c.x0 + c.x1) / 2, -0.2, c.z1], [1, 0, 0], [0, 1, 0], [0, 0, 1], `<circle class="a3-tug-amber" cx="0" cy="2" r="0.9"/>`);
  }

  // ---- the side frames: they flank the nose wheels as the cradle's sides, the drive wheels outboard of them
  const f = D.frame;
  for (const [s, sd] of W.SIDES) {
    // in model y the frame runs from the cradle (|y| armIn) to f.y1; its outer top edge rounded, the inner one eased
    const sec = (x, z1) => {
      const raw = roundedSection(x, D.armIn, f.y1, f.z0, z1, f.r, 0.05);
      return sd < 0 ? raw.map(([px, py, pz]) => [px, -py, pz]) : raw;
    };
    const arm = loft(`tug.arm.${s}`, [sec(f.x0, f.z1), sec(f.x1, f.z1), sec(f.xEnd, f.zEnd)]);
    // the aft face: the rear warning lamp and an amber marker over the bumper (TLD sheet: LED rear lights)
    const w = m(f.y1 - D.armIn);
    const lamps = `<rect class="a3-tug-lamp" x="${(w * 0.2).toFixed(2)}" y="0.9" width="1.6" height="0.8" rx="0.25"/><rect class="a3-tug-amber" x="${(w * 0.62).toFixed(2)}" y="0.9" width="1.3" height="0.8" rx="0.25"/>`;
    // the aft face is at x = f.xEnd facing aft (+x model); u across in y (inboard to outboard on the right), v down
    face(arm, sd < 0 ? [f.xEnd, -D.armIn, f.zEnd - 0.05] : [f.xEnd, D.armIn, f.zEnd - 0.05], [0, sd, 0], [0, 0, -1], [1, 0, 0], lamps);
    // the outer face: hazard chevrons along the frame below the motor (black and yellow, as the tractors carry)
    let chev = "";
    for (let k = 0; k < 7; k++) {
      const u0 = 0.6 + k * 2.6;
      chev += `M${u0.toFixed(2)} 0L${(u0 + 1.2).toFixed(2)} 0L${(u0 + 2.2).toFixed(2)} 1.6L${(u0 + 1.0).toFixed(2)} 1.6Z`;
    }
    face(arm, [f.x0 + 0.1, sd * f.y1, 0.42], [1, 0, 0], [0, 0, -1], [0, sd, 0], `<path class="a3-tug-chevron" d="${chev}"/>`);
    // the rubber bumper on the frame's aft face
    const bp = D.bumper;
    box(`tug.bumper.${s}`, f.xEnd, bp.x1, sd < 0 ? -bp.y1 : bp.y0, sd < 0 ? -bp.y0 : bp.y1, bp.z0, bp.z1, { material: "rubber", tone: "lo" });
  }
  const p = D.plate;
  const plate = box("tug.backplate", p.x0, p.x1, -D.armIn, D.armIn, p.z0, p.z1, { material: "gunmetal" });
  {
    // the rubber pad that bears on the tyres (on its aft face)
    const w = m(2 * D.armIn);
    const pad = `<rect class="a3-tug-pad" x="1.2" y="1.6" width="${(w - 2.4).toFixed(2)}" height="${(m(p.z1 - p.z0) - 2.8).toFixed(2)}" rx="0.6"/>`;
    face(plate, [p.x1, -D.armIn, p.z1], [0, 1, 0], [0, 0, -1], [1, 0, 0], pad);
  }

  // ---- drive wheels (16.00-25) and their hub motors
  for (const [s, sd] of W.SIDES) {
    const wl = D.wheel;
    // the tyre: a round along ±y, inner face at |y| wl.in, outer at wl.out, tangent to the platter
    const tyre = ctx.round({ name: `tug.tyre.${s}`, group, F: { o: K([wl.x, sd * wl.in, wl.z]), a: W.kitDir([0, sd, 0]), u: W.kitDir([1, 0, 0]) }, s0: 0, s1: m(wl.w), r: m(wl.r), cls, tone: "mid", material: "rubber", details: { seams: [0.25, 0.5, 0.75].map((q) => m(wl.w * q)) } });
    {
      // the outer face: rim, hub and eight wheel nuts (static: the tug's wheels are not driven by the turn's scroll)
      const R = m(wl.r);
      const nuts = Array.from({ length: 8 }, (_, i) => {
        const t = (i / 8) * 2 * Math.PI;
        return `<circle class="a3-tug-nut" cx="${(0.3 * R * Math.cos(t)).toFixed(2)}" cy="${(0.3 * R * Math.sin(t)).toFixed(2)}" r="${(0.03 * R).toFixed(2)}"/>`;
      }).join("");
      const svg = `<circle class="a3-tug-rim" r="${(0.62 * R).toFixed(2)}"/><circle class="iso-line" data-tone="lo" r="${(0.62 * R).toFixed(2)}" fill="none"/><circle class="iso-line" data-tone="faint" r="${(0.4 * R).toFixed(2)}" fill="none"/>${nuts}`;
      ctx.plane(tyre, { o: K([wl.x, sd * wl.out, wl.z]), u: W.kitDir([1, 0, 0]), v: W.kitDir([0, 0, 1]), normal: W.kitDir([0, sd, 0]), svg, fade: [0.04, 0.3] });
    }
    ctx.round({ name: `tug.motor.${s}`, group, F: { o: K([wl.x, sd * f.y1, wl.z]), a: W.kitDir([0, sd, 0]), u: W.kitDir([1, 0, 0]) }, s0: 0, s1: m(wl.in - f.y1), r: m(D.motor.r), cls, tone: "mid", material: "gunmetal" });
    // (no mudguard: a plate over the tyre on a stay swapped painter's order with the cab while they overlapped on
    // screen in the push clip; the tyre stands open outboard of its frame, as the reader should see it)
  }

  // one vary class: the whole tug fades in over its last 1.4 m in and out over its first 1.4 m off (F.tugAlpha); the
  // deck's two forward steps at 55% and 22% of it (the fade toward the platter's edge)
  ctx.vary(cls, "F.tugAlpha(ch.tug || 0)");
  ctx.vary("a3-tug-f1", "0.55 * F.tugAlpha(ch.tug || 0)");
  ctx.vary("a3-tug-f2", "0.22 * F.tugAlpha(ch.tug || 0)");
  // the page's fade sets (DATA.fades): a tug faded under half is neither picked nor drawn into the GL mask (live.js
  // merges DATA.mod.fades)
  ctx.data("fades", { [cls]: ["^tug\\."] });
  ctx.css(`.a3-tug-chevron{fill:var(--a3-tug-stripe);stroke:none}
.a3-tug-lamp{fill:var(--a3-red);stroke:none}
.a3-tug-amber{fill:var(--a3-tug-amber);stroke:none}
.a3-tug-glass{fill:var(--a3-tug-glass);stroke:var(--anatomy-lo);stroke-width:.25}
.a3-tug-pad{fill:var(--a3-tug-pad);stroke:none}
.a3-tug-rim{fill:var(--a3-tug-rim);stroke:none}
.a3-tug-nut{fill:var(--a3-tug-nut);stroke:none}
.iso{--a3-tug-stripe:#2b2b2b;--a3-tug-pad:#4a4a48;--a3-tug-rim:#c9c4b4;--a3-tug-nut:#6c6a63;--a3-tug-amber:#d98a1c;--a3-tug-glass:#5c6670}
.iso[data-theme="dark"]{--a3-tug-stripe:#0e0e0e;--a3-tug-pad:#1a1a19;--a3-tug-rim:#4b4840;--a3-tug-nut:#2a2925;--a3-tug-amber:#b8701a;--a3-tug-glass:#161a1e}`);

  // the label follows the tug's state (the readout says the same: M.tugWords)
  ctx.label("tug.", (s) => {
    const c = s.tug || 0;
    // short state words: the readout corner keeps the part's name and a state of at most 40 characters together
    const what = c <= 0 || c >= 2 ? "clear" : c < 1 ? "moving in" : c >= 1.3 ? "driving off" : c > 1 ? "releasing the wheel" : s.speed < -0.5 ? `pushing back at ${Math.max(1, Math.round(-s.speed))} kt` : "on the nose wheel";
    return `Pushback tug · ${what} · towbarless, A380-rated (TLD TPX-500-S class), 9.2 × 4.5 m, its cradle between the side frames round the nose wheels, drive wheels outboard · the driver's cab just ahead of the cradle; its engine bay and steering axle lie beyond the platter's edge, where it fades`;
  });

  // the push clip (follow-up acceptance: posed, depth and order on the tug): driving in, standing at the wheel, releasing
  // and driving off, with the turntable turning through every bearing (30°/s) so the order is checked all round
  const tugAt = (t) => (t < 6 ? Math.max(0.02, t / 6) : t < 15 ? 1 : t < 16.2 ? 1 + (0.3 * (t - 15)) / 1.2 : Math.min(1.98, 1.3 + (0.7 * (t - 16.2)) / 2.7));
  ctx.clip({ name: "push", at: (t) => ({ ...W.groundChannels({ turn: 40 + 30 * t }), tug: tugAt(t) }), from: 0, to: 19, frame: 1 / 60 });
  ctx.report(`tug: ${ctx.T.parts.filter((q) => q.name.startsWith("tug.")).length} parts on free group tug; cradle ${r3(D.clear)} m off the nose tyres; cut at x ${r3(D.cut)} (r ${W.STAGE.platter.r} m); slide ${Fx.TUG_SLIDE.length} knots, fade over ${Fx.TUG_FADE / 10} m`);
}

/** --check: clearances to the nose tyres, contacts, and the push's timeline at the tour's rates. */
export function checks(ctx) {
  const { M, W, A, F } = ctx;
  const D = dims(M, W);
  const fail = [];
  // 1. clearance: points on the nose tyres' surfaces against every tug part's audit shape (both at rest = connected)
  const tugParts = ["body", "cab", "body.f1", "body.f2", "arm.l", "arm.r", "backplate", "tyre.l", "tyre.r", "motor.l", "motor.r", "bumper.l", "bumper.r"].map((n) => ctx.part(`tug.${n}`));
  if (tugParts.some((q) => !q)) throw new Error("tug: a part is missing");
  let worst = Infinity;
  let at = "";
  for (const sd of [-1, 1]) {
    const yc = sd * M.GEAR.nose.wheelY[1];
    const half = M.GEAR.tyres.nose.width / 2;
    for (let i = 0; i < 72; i++) {
      const t = (i / 72) * 2 * Math.PI;
      for (const dy of [-half, -half / 2, 0, half / 2, half]) {
        const p = W.kit([D.axleX + D.RN * Math.cos(t), yc + dy, D.RN + D.RN * Math.sin(t)]);
        for (const q of tugParts) {
          const d = A.sdf(q.shapes[0], p) / 10;
          if (d < worst) {
            worst = d;
            at = q.name;
          }
        }
      }
    }
  }
  (worst >= 0.05 ? ctx.report : (l) => fail.push(l))(`tug: nearest part to the nose tyres ${at}, ${worst.toFixed(3)} m (≥ 0.05)`);
  // 2. the drive tyres stand on the platter
  const tyreLow = D.wheel.z - D.wheel.r;
  if (Math.abs(tyreLow) > 1e-9) fail.push(`tug: drive tyres ${tyreLow} m off the platter`);
  // 3. the push's timeline in the tour (figure s from the start of PUSHBACK)
  const sim = F.createSim(M);
  F.enterPhase(M, sim, "PUSHBACK");
  const marks = {};
  let t = 0;
  let prevTug = 0;
  while (t < 60 && sim.phase === "PUSHBACK") {
    F.advance(M, sim, 1 / 60);
    t += 1 / 60;
    const c = sim.state.tug;
    for (const [k, v] of [["in view", 0.52], ["connected", 1], ["releasing", 1.0001], ["driving off", 1.3], ["faded", 1.64], ["clear", 2]]) if (marks[k] === undefined && prevTug < v && c >= v) marks[k] = +t.toFixed(2);
    if (marks.push === undefined && sim.state.speed < -0.5) marks.push = +t.toFixed(2);
    prevTug = c;
  }
  ctx.report(`tug in the tour (figure s into PUSHBACK): ${Object.entries(marks).map(([k, v]) => `${k} ${v}`).join(", ")}; PUSHBACK ends at ${t.toFixed(2)} s`);
  if (!(marks.connected < marks.push && marks.push < marks.releasing)) fail.push("tug: the push does not wait for the tug or the tug leaves during the push");
  if (fail.length) throw new Error(fail.join("; "));
}
