// a380/stubs.mjs (S): the stand-in geometry for every module that is not built yet (DESIGN §8.3 --only).
//
// A stub builds the module's boundary geometry from world.mjs, with the module's own part names, so that
// every other module (and the audits) can build against it: the exact W.SHELL lofts, the wing panels with a
// fillet and fences, one set of coaxial rounds per nacelle on a strut, the gear down with simple legs, the
// beacon housings and the beacon light. The stage stub is the full-craft turntable and plinth.
// A module replaces its stub completely once it exports `stub = false` (CONTRACT.md).

const D2R = Math.PI / 180;

function shellPieces(ctx, owner, prefix) {
  const { W } = ctx;
  for (const piece of W.SHELL) {
    if (piece.owner !== owner || !piece.name.startsWith(prefix)) continue;
    ctx.hull({ name: piece.name, group: piece.group, ...W.loft(piece.name) });
  }
}

// ---------------------------------------------------------------------------------------------
// M1 stage: the plinth (static), the platter (live, deck) and one plain marking set
// ---------------------------------------------------------------------------------------------
function stage(ctx) {
  const { k, A, W, P } = ctx;
  const S = W.STAGE;
  const m = W.m;
  const R = m(S.plinth.r);
  const z0 = m(S.plinth.z0);
  const z1 = m(S.plinth.z1);
  const plan = { x: -R, y: -R, w: 2 * R, d: 2 * R, r: R };
  const drum = k.slabOf(plan, z0, z1 - z0, P, 48, 0.8);
  const ringOn = (r, steps = 360) => k.ring(0, 0, m(r), z1, P, steps);
  const ticks = { minor: [], major: [] };
  for (let deg = 0; deg < 360; deg += S.ruler.minor) {
    const a = deg * D2R;
    const major = deg % S.ruler.major === 0;
    const r1 = m(major ? S.ruler.majorTo : S.ruler.minorTo);
    const r0 = m(S.ruler.r1);
    (major ? ticks.major : ticks.minor).push(k.lineOnTop([r0 * Math.cos(a), r0 * Math.sin(a)], [r1 * Math.cos(a), r1 * Math.sin(a)], z1, P));
  }
  const bolts = [];
  for (let i = 0; i < S.bolts.count; i++) {
    const a = (i / S.bolts.count) * 2 * Math.PI + 0.5 * D2R;
    bolts.push(k.iso([m(S.bolts.r) * Math.cos(a), m(S.bolts.r) * Math.sin(a), z1], P));
  }
  // label plate on the front of the annulus, toward the viewer (azimuth 40), between the ruler and the bolts
  const az = W.VIEW.azimuth * D2R;
  const t = [-Math.sin(az), Math.cos(az)];
  const n = [Math.cos(az), Math.sin(az)];
  const c = [m(40.95) * n[0], m(40.95) * n[1]];
  const half = [m(1.6), m(0.32)];
  const corner = (u, v) => [c[0] + t[0] * u + n[0] * v, c[1] + t[1] * u + n[1] * v];
  const plateRing = [corner(-half[0], -half[1]), corner(half[0], -half[1]), corner(half[0], half[1]), corner(-half[0], half[1])];
  const plate = k.extrude(plateRing, z1, 0.6, P, { bevel: 0.25 });
  const rules = [-0.12, 0, 0.12].map((v, i) => {
    const w = i === 1 ? 1.05 : 0.8;
    return k.lineOnTop(corner(-m(w), m(v)), corner(m(w), m(v)), z1 + 0.6, P);
  });
  const screws = [corner(-m(1.38), 0), corner(m(1.38), 0)].map(([x, y]) => k.iso([x, y, z1 + 0.6], P));
  const svg =
    `<path class="iso-halo" d="${k.haloOf({ x: -R - 6, y: -R - 6, w: 2 * R + 12, d: 2 * R + 12, r: R + 6 }, z0, z1 - z0, P)}"/>` +
    k.solidSvg(drum, { tone: "lo", inner: k.lineSvg(k.ring(0, 0, R - 2.2, z1, P, 360), { tone: "faint" }) }) +
    k.lineSvg(ringOn(S.ruler.r0) + ringOn(S.ruler.r1) + ringOn(S.ruler.minorTo) + ringOn(S.ruler.majorTo), { tone: "lo" }) +
    k.lineSvg(ticks.minor.join(""), { tone: "faint" }) +
    k.lineSvg(ticks.major.join(""), { tone: "lo" }) +
    k.lineSvg(ringOn(S.bead.r), { tone: "faint" }) +
    k.dotsSvg(bolts, { size: 0.5, tone: "mid" }) +
    k.solidSvg(plate, { tone: "mid" }) +
    k.lineSvg(rules.join(""), { tone: "lo", free: true }) +
    k.dotsSvg(screws, { size: 0.45, tone: "mid" });
  ctx.static({ name: "stand.plinth", at: [0, 0, z0], bias: -100, svg, shapes: [A.cylinder(0, 0, R, z0, z1 - z0, { name: "stand.plinth", ground: true })] });

  // the live platter: a vertical round on `air` (a fixed picture), kit tones
  const r = m(S.platter.r);
  const F = { o: [0, 0, 0], a: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] };
  const dots = [];
  for (let i = 0; i < S.platterBolts.count; i++) {
    const a = (i / S.platterBolts.count) * 2 * Math.PI;
    dots.push({ at: [0, m(S.platterBolts.r) * Math.cos(a), m(S.platterBolts.r) * Math.sin(a)], normal: [0, 0, 1], size: 0.42, tone: "lo" });
  }
  const platter = ctx.round({ name: "stage.platter", group: "air", layer: "deck", F, s0: m(S.platter.z0), s1: 0, r, tone: "mid", details: { dots } });
  // one plain runway set as planes on the top face (M1 replaces it with the three phase-keyed sets). The set
  // is a 50 m repeat drawn 500 units wider than the disc each way, clipped to the disc, and the page
  // translates it by the ground distance (live.js deck()).
  const mark = [];
  const rect = (x0, x1, y0, y1) => `M${x0.toFixed(2)} ${y0.toFixed(2)}H${x1.toFixed(2)}V${y1.toFixed(2)}H${x0.toFixed(2)}Z`;
  const span = r + m(50);
  for (let x = -Math.ceil(span / m(50)) * m(50) - m(15); x < span + m(50); x += m(50)) mark.push(rect(x, x + m(30), -m(0.45), m(0.45))); // centreline: 30 m stripes every 50 m
  for (const s of [-1, 1]) mark.push(rect(-span - m(50), span + m(50), s * m(30) - m(0.45), s * m(30) + m(0.45))); // edge stripes, 60 m runway
  for (const s of [-1, 1]) for (let x = -Math.ceil(span / m(50)) * m(50); x < span + m(50); x += m(50)) mark.push(rect(x, x + m(18), s * m(5.4) - m(0.9), s * m(5.4) + m(0.9))); // touchdown-zone style bars
  const disc = (r - 0.6).toFixed(2);
  ctx.plane(platter, { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1], fade: [-1, -0.9], svg: `<clipPath id="a3-platter-clip"><circle r="${disc}"/></clipPath><circle class="a3-pave" r="${disc}"/><g clip-path="url(#a3-platter-clip)"><g class="a3-set a3-set-stub"><path class="a3-mark" d="${mark.join("")}"/></g></g>` });
  // the lubber index at the nose bearing on the rim
  ctx.plane(platter, { o: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1], fade: [-1, -0.9], svg: `<path class="a3-lubber" d="M${(r - m(1.6)).toFixed(2)} -${m(0.18).toFixed(2)}L${(r - 0.4).toFixed(2)} 0L${(r - m(1.6)).toFixed(2)} ${m(0.18).toFixed(2)}Z"/>` });
}

// ---------------------------------------------------------------------------------------------
// M2 nose and tail, M6 fuselage: the exact W.SHELL lofts (plus a plain fin and tailplanes)
// ---------------------------------------------------------------------------------------------
const nose = (ctx) => shellPieces(ctx, "M2", "nose.");
const fuselage = (ctx) => shellPieces(ctx, "M6", "fus.");
function tail(ctx) {
  const { W } = ctx;
  shellPieces(ctx, "M2", "tail.");
  const E = ctx.M.EMPENNAGE;
  // fin: root polygon in the tail cone's crown-facet plane, tip airfoil at z 24.06 (symmetric, t/c 0.08)
  const sec = [[0, 0], [0.02, 0.3], [0.06, 0.42], [0.12, 0.48], [0.25, 0.5], [0.4, 0.48], [0.6, 0.38], [0.8, 0.22], [1.0, 0.02]];
  const crownAt = (x) => {
    const r = W.ring2(x);
    return r[15][1];
  };
  const foil = (x0, chord, t, zAt, yScale = 1) => {
    const up = sec.map(([xi, eta]) => [x0 + xi * chord, eta * t * yScale]);
    return [...up, ...up.slice(1, -1).reverse().map(([x, y]) => [x, -y]), [x0 + chord, -0.02 * t]].map(([x, y]) => [x, y, zAt(x)]);
  };
  const rootX = E.fin.rootLE[0];
  const rootChord = E.fin.rootChord;
  const tipLE = E.fin.tipLE;
  const root = foil(rootX, rootChord, rootChord * 0.08, crownAt);
  const tip = foil(tipLE[0], E.fin.tipChord, E.fin.tipChord * 0.08, () => tipLE[2]);
  ctx.hull({ name: "tail.fin", group: "pitch", points: [...root, ...tip].map(W.kit), tone: "hi" });
  // tailplanes: root on the cone's main-belt facet, tip at the true tip (stub: one hull per side)
  for (const [s, side] of W.SIDES) {
    const xs = [57.6, 65.2];
    const rootPts = [];
    for (const x of xs) {
      const f = W.facetLine(x, W.S0_INDEX.mainBelt, side);
      // the facet line at this x: a point at z = mid of the belt and the belt's in-plane direction
      const zMid = (f.a[1] + f.b[1]) / 2;
      const half = Math.min(0.42, (f.b[1] - f.a[1]) / 2 - 0.04) * (x > 62 ? 0.45 : 1);
      for (const dz of [-half, half]) {
        const z = zMid + dz;
        const y = f.a[0] + (f.t[0] * (z - f.a[1])) / f.t[1];
        rootPts.push([x, y, z]);
      }
    }
    const tipY = side * E.tailplane.tipLE[1];
    const tipX0 = E.tailplane.tipLE[0];
    const tipZ = E.tailplane.tipZ;
    const tipPts = [[tipX0, tipY, tipZ], [tipX0 + 0.6, tipY, tipZ + 0.17], [tipX0 + 0.6, tipY, tipZ - 0.12], [tipX0 + E.tailplane.tipChord, tipY, tipZ]];
    ctx.hull({ name: `tail.htp.${s}`, group: "pitch", points: [...rootPts, ...tipPts].map(W.kit), tone: "hi" });
  }
}

// ---------------------------------------------------------------------------------------------
// M6 skin: the belly fairing as solid lofts, and the beacon housings
// ---------------------------------------------------------------------------------------------
/** Where the beacon housings stand (shared by the skin and lights stubs): { base, n (outward, model), tip }. */
export function beaconMount(W, id) {
  if (id === "beaconLower") {
    const x = W.LIGHT_AT.beaconLower[0];
    const xa = 22.5;
    const xb = 25;
    const za = Math.min(...W.FAIRING.half(xa).map((p) => p[1]));
    const zb = Math.min(...W.FAIRING.half(xb).map((p) => p[1]));
    const slope = (zb - za) / (xb - xa);
    const base = [x, 0, za + slope * (x - xa)];
    const n = W.vec.unit([slope, 0, -1]);
    return { base, n, tip: W.vec.add(base, W.vec.mul(n, 0.06 + 0.12)), s1: 0.06, r: 0.12 };
  }
  const at = W.LIGHT_AT[id];
  const side = Math.sign(at[1]);
  const f = W.facetLine(at[0], [13, 14], side);
  const s = (Math.abs(at[1]) - Math.abs(f.a[0])) / (Math.abs(f.b[0]) - Math.abs(f.a[0]));
  const base = [at[0], f.a[0] + (f.b[0] - f.a[0]) * s, f.a[1] + (f.b[1] - f.a[1]) * s];
  const n = [0, f.n[0], f.n[1]];
  return { base, n, tip: W.vec.add(base, W.vec.mul(n, 0.07 + 0.13)), s1: 0.07, r: 0.13 };
}

function skin(ctx) {
  const { W } = ctx;
  const ringAt = (x) => W.FAIRING.section(x).map(([y, z]) => W.kit([x, y, z]));
  // nose piece: from the barrel's lower lobe at 18.5 to the full section at 22.5
  const lower = W.ring2(18.5).filter(([, z]) => z <= 4.4 + 1e-9).map(([y, z]) => W.kit([18.5, y, z]));
  const stations = (x0, x1) => [x0, ...W.FAIRING.stations.filter((x) => x > x0 + 1e-6 && x < x1 - 1e-6), x1];
  ctx.hull({ name: "skin.fair.nose", group: "pitch", rings: [lower, ...stations(18.5, 22.5).slice(1).map(ringAt)], smooth: true, sharp: 35 });
  for (const [name, x0, x1] of [["skin.fair.mid", 22.5, 31.85], ["skin.fair.wlg", 31.85, 35.3], ["skin.fair.blg", 35.3, 40.9], ["skin.fair.tail", 40.9, 46.5]])
    ctx.hull({ name, group: "pitch", rings: stations(x0, x1).map(ringAt), smooth: true, sharp: 35 });
  // beacon housings: domed rounds on their facets (the upper pair rides fus.U.crown: group cut.up)
  for (const [id, name, group] of [["beaconUpperL", "light.beacon.upperL", "cut.up"], ["beaconUpperR", "light.beacon.upperR", "cut.up"], ["beaconLower", "light.beacon.lower", "pitch"]]) {
    const b = beaconMount(W, id);
    const helper = Math.abs(b.n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
    ctx.round({ name, group, F: { o: W.kit(b.base), a: W.kitDir(b.n), u: W.kitDir(helper), v: [0, 0, 1] }, s0: 0, s1: W.m(b.s1), r: W.m(b.r), ends: ["flat", "dome"], tone: "hi", material: "chrome" });
  }
}

// ---------------------------------------------------------------------------------------------
// M3 wings: the fillet, six full-chord panels per side and the fence
// ---------------------------------------------------------------------------------------------
function wings(ctx) {
  const { W, M } = ctx;
  for (const [s, side] of W.SIDES) {
    const root = W.WING.section(side * W.WING.rootY);
    const contour = root.points.filter(([, z], i) => i >= 1 && i <= 13 && z >= root.bottom + 0.5 * root.thickness);
    const xLE = contour[0][0];
    const xTE = contour[contour.length - 1][0];
    const line = [];
    // the line along the barrel's S0 vertex (±3.416, 5.05), 6 mm off the skin so the stub's plane is clean
    for (const x of [xLE + 0.3, xTE - 0.3]) line.push([x, side * 3.422, 5.05]);
    const rootUpper = contour.map(([x, z]) => [x, side * W.WING.rootY, z]);
    ctx.hull({ name: `wings.${s}.fillet`, group: "pitch", points: [...line, ...rootUpper].map(W.kit), tone: "hi" });
    W.WING.panels.forEach(([y0, y1], i) => {
      ctx.hull({ name: `wings.${s}.box.${i + 1}`, group: "pitch", rings: [W.wingSection(side * y0), W.wingSection(side * y1)].map((r) => r.map(W.kit)), smooth: true, sharp: 35, tone: "hi" });
    });
    // the fence: an arrowhead on the tip face (DESIGN §5.4), 0.12 m thick
    const fe = M.WING.fence;
    const tip = W.WING.at(39.875);
    const zMid = tip.bottom + 0.45 * tip.thickness;
    const poly = [[fe.xLE, zMid], [fe.topChord[0], zMid + fe.above], [fe.topChord[1], zMid + fe.above], [fe.xTE, zMid], [fe.bottomChord[1], zMid - fe.below], [fe.bottomChord[0], zMid - fe.below]];
    const pts = [];
    for (const y of [39.875, 39.995]) for (const [x, z] of poly) pts.push([x, side * y, z]);
    ctx.hull({ name: `wings.${s}.fence`, group: "pitch", points: pts.map(W.kit), tone: "hi" });
  }
}

// ---------------------------------------------------------------------------------------------
// M4 engines: coaxial rounds per nacelle and a strut to the wing's front-bottom edge
// ---------------------------------------------------------------------------------------------
function engines(ctx) {
  const { W } = ctx;
  for (const N of W.NACELLE) {
    const F = { o: W.kit([N.lip, N.y, N.cz]), a: W.kitDir([1, 0, 0]), u: [0, 0, 1], v: [0, 1, 0] };
    const mat = { lip: "chrome", fancowl: "steel", aftcowl: "steel", core: "gunmetal", plug: "gunmetal" };
    for (const row of N.rows) ctx.round({ name: `eng.${N.id}.${row.part}`, group: "pitch", F, s0: W.m(row.s[0]), s1: W.m(row.s[1]), r: [W.m(row.r[0]), W.m(row.r[1])], tone: "hi", material: mat[row.part] });
    // strut: the fan cowl's top tangent line (DESIGN W.NACELLE) to the wing's front-bottom edge, ±0.45 m
    const pts = [];
    const sec = (y) => W.WING.section(y);
    for (const dy of [-0.45, 0.45]) {
      const y = N.y + dy;
      for (const s of [1.0, 3.81]) {
        const x = N.lip + s;
        const z = (N.fanTop.d - N.fanTop.n[0] * x) / N.fanTop.n[2];
        pts.push([x, y, z]);
      }
      const w = sec(y);
      pts.push([w.le + 0.025 * w.chord, y, w.bottom]);
    }
    ctx.hull({ name: `eng.${N.id}.pylon`, group: "pitch", points: pts.map(W.kit), tone: "hi", material: "steel" });
  }
}

// ---------------------------------------------------------------------------------------------
// M5 gear: 22 tyres down, axles and beams, plain legs to the airframe
// ---------------------------------------------------------------------------------------------
function gear(ctx) {
  const { W, M } = ctx;
  const G = M.GEAR;
  const alongY = (x, y, z) => ({ o: W.kit([x, y, z]), a: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] });
  const vertical = (x, y) => ({ o: W.kit([x, y, 0]), a: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] });
  const tyre = (name, x, yc, half, r, w) => {
    // inner face flush on the axle end at |y - yc| = half
    for (const [s, sign] of [["l", -1], ["r", 1]]) ctx.round({ name: `${name}.${s}`, group: "pitch", F: alongY(x, yc, r), s0: W.m(sign < 0 ? -half - w : half), s1: W.m(sign < 0 ? -half : half + w), r: W.m(r), tone: "hi", material: "rubber" });
  };
  // nose gear: axle at the free radius 0.635, tyres 1.27 × 0.455 at y ±0.525
  const rn = G.tyres.nose.diameter / 2;
  const wn = G.tyres.nose.width;
  const xn = G.nose.axle[0];
  const halfN = 0.525 - wn / 2;
  ctx.round({ name: "nlg.axle", group: "pitch", F: alongY(xn, 0, rn), s0: -W.m(halfN), s1: W.m(halfN), r: W.m(0.1), tone: "mid", material: "steel" });
  tyre("nlg.tyre", xn, 0, halfN, rn, wn);
  ctx.round({ name: "nlg.leg", group: "pitch", F: vertical(xn, 0), s0: W.m(rn + 0.1), s1: W.m(4.9), r: W.m(0.13), tone: "mid", material: "steel" });
  // wing gear: 4 tyres per bogie; beam on the axle tops; leg to a fitting flush on the wing's bottom plane
  const rm = G.tyres.main.diameter / 2;
  const wm = G.tyres.main.width;
  for (const [s, side] of W.SIDES) {
    const yc = side * G.wing.centre[1];
    const half = 0.675 - wm / 2;
    for (const [i, x] of G.wing.axleX.entries()) {
      ctx.round({ name: `wlg.${s}.axle${i + 1}`, group: "pitch", F: alongY(x, yc, rm), s0: -W.m(half), s1: W.m(half), r: W.m(0.12), tone: "mid", material: "steel" });
      tyre(`wlg.${s}.tyre${i + 1}`, x, yc, half, rm, wm);
    }
    const beamTop = rm + 0.12 + 0.3;
    ctx.prism({ name: `wlg.${s}.beam`, group: "pitch", F: { o: [0, W.m(yc), W.m(rm + 0.12)], a: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, polygon: [[W.m(41.3 - 34.55), -W.m(0.16)], [W.m(41.3 - 32.6), -W.m(0.16)], [W.m(41.3 - 32.6), W.m(0.16)], [W.m(41.3 - 34.55), W.m(0.16)]], s0: 0, s1: W.m(0.3), tone: "mid", material: "gunmetal" });
    const xc = G.wing.centre[0];
    const bp = W.WING.bottomPlane(yc);
    const zAt = (x, y) => (bp.d - bp.n[0] * x - bp.n[1] * y) / bp.n[2];
    const fitBottom = Math.min(zAt(xc - 0.35, yc - 0.35), zAt(xc - 0.35, yc + 0.35), zAt(xc + 0.35, yc - 0.35), zAt(xc + 0.35, yc + 0.35)) - 0.12;
    const fit = [];
    for (const dx of [-0.35, 0.35]) for (const dy of [-0.35, 0.35]) fit.push([xc + dx, yc + dy, zAt(xc + dx, yc + dy)], [xc + dx, yc + dy, fitBottom]);
    ctx.hull({ name: `wlg.${s}.fitting`, group: "pitch", points: fit.map(W.kit), tone: "mid", material: "gunmetal" });
    ctx.round({ name: `wlg.${s}.leg`, group: "pitch", F: vertical(xc, yc), s0: W.m(beamTop), s1: W.m(fitBottom), r: W.m(0.2), tone: "mid", material: "steel" });
  }
  // body gear: 6 tyres per bogie; leg to the fairing's bottom face
  for (const [s, side] of W.SIDES) {
    const yc = side * G.body.centre[1];
    for (const [i, x] of G.body.axleX.entries()) {
      const wy = [0.765, 0.775, 0.765][i];
      const half = wy - wm / 2;
      ctx.round({ name: `blg.${s}.axle${i + 1}`, group: "pitch", F: alongY(x, yc, rm), s0: -W.m(half), s1: W.m(half), r: W.m(0.12), tone: "mid", material: "steel" });
      tyre(`blg.${s}.tyre${i + 1}`, x, yc, half, rm, wm);
    }
    const beamTop = rm + 0.12 + 0.3;
    ctx.prism({ name: `blg.${s}.beam`, group: "pitch", F: { o: [0, W.m(yc), W.m(rm + 0.12)], a: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, polygon: [[W.m(41.3 - 38.8), -W.m(0.16)], [W.m(41.3 - 34.9), -W.m(0.16)], [W.m(41.3 - 34.9), W.m(0.16)], [W.m(41.3 - 38.8), W.m(0.16)]], s0: 0, s1: W.m(0.3), tone: "mid", material: "gunmetal" });
    const xc = G.body.centre[0];
    // the fairing bottom face between stations 35.92 and 38 (planar): z at the leg axis
    const za = Math.min(...W.FAIRING.half(35.92).map((p) => p[1]));
    const zb = Math.min(...W.FAIRING.half(38).map((p) => p[1]));
    const zTop = za + ((zb - za) * (xc - 35.92)) / (38 - 35.92) - 0.006;
    ctx.round({ name: `blg.${s}.leg`, group: "pitch", F: vertical(xc, yc), s0: W.m(beamTop), s1: W.m(zTop), r: W.m(0.2), tone: "mid", material: "steel" });
  }
}

// ---------------------------------------------------------------------------------------------
// M7 cabin: nothing (the cutaway shows empty bays until M7 builds)
// M8 lights: the beacons, the one working WebGL effect of the scaffold
// ---------------------------------------------------------------------------------------------
function cabin() {}
function lights(ctx) {
  const { W } = ctx;
  for (const [id, part, group] of [["beaconUpperL", "light.beacon.upperL", "cut.up"], ["beaconUpperR", "light.beacon.upperR", "cut.up"], ["beaconLower", "light.beacon.lower", "pitch"]]) {
    const b = beaconMount(W, id);
    ctx.light({ id, part, group, at: W.kit(b.tip), normal: W.kitDir(b.n), kind: "beacon", color: "red", lens: 0.11, halo: 3.0, switch: "beacon", flash: { period: 1.0, offsets: [0], rise: 0.06, fall: 0.1, phase: 0.5 } });
  }
}

// fu/interaction: the pushback tug (parts/tug.mjs) has no stand-in: --only builds without it draw no tug
function tug() {}
// fu/interaction end
export const STUBS = { stage, nose, tail, fuselage, skin, wings, engines, gear, cabin, lights, tug };
