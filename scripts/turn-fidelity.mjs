import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import { tubePieces } from "../kit/tube.mjs";
import { TURN } from "../kit/turn.mjs";

const rootOf = (group) => {
  let root = group;
  while (root && root.parent) root = root.parent;
  return root && root.kind === "turn" ? root : null;
};
const restValues = (T, theta) => Object.fromEntries(T.groups.map((g) => [g.name, g.kind === "turn" && !g.parent ? theta : g.kind === "free" ? null : 0]));

export function identity(T, P, angles, { plant = null } = {}) {
  const scene = TURN.prepare(T.data, { unit: 1 });
const subpaths = (d) => {
    const out = [];
    for (const [, body] of (d ?? "").matchAll(/M([^M]*)/g)) {
      const nums = (body.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
      const pts = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
      out.push({ pts, closed: /Z\s*$/.test(body) });
    }
    return out;
  };
  const segDist = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
    return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
  };
  const toPoly = (pts, closed) => (pts, closed);
  void toPoly;
  const distToPoly = (p, poly, closed = true) => {
    let best = Infinity;
    const n = poly.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) best = Math.min(best, segDist(p, poly[i], poly[(i + 1) % n]));
    if (n === 1) best = Math.hypot(p[0] - poly[0][0], p[1] - poly[0][1]);
    return best;
  };
  const oneWay = (A, B) => {
    let worst = 0;
    for (const p of A) {
      let near = null;
      let gap = Infinity;
      for (const q of B) {
        const g = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (g < gap) {
          gap = g;
          near = q;
        }
      }
      worst = Math.max(worst, gap < 0.15 ? Math.max(Math.abs(p[0] - near[0]), Math.abs(p[1] - near[1])) : distToPoly(p, B));
    }
    return worst;
  };
  const hausdorff = (A, B) => Math.max(oneWay(A, B), oneWay(B, A));
  const applyMatrix = (pts, t) => {
    const v = (t.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
    return pts.map(([x, y]) => [v[0] * x + v[2] * y + v[4], v[1] * x + v[3] * y + v[5]]);
  };
  const levelOf = (score, bands) => {
    let u = 0;
    for (const t of bands) {
      const x = Math.min(1, Math.max(0, (score - (t - 0.035)) / 0.07));
      u += x * x * (3 - 2 * x);
    }
    return u;
  };
  
  
const results = { outline: 0, top: 0, faces: 0, compared: 0, skipped: 0, missing: 0, crease: 0 };
const worstAt = {};
for (const theta of angles) {
  const cams = TURN.cams(scene, restValues(T, theta));
  const Pp = { ...P, azimuth: P.azimuth - theta };
  for (const part of T.parts) {
    if (part.kind !== "prism" || !rootOf(part.group) || part.group.kind === "free") continue;
    const planted = plant && part.name === plant;
    const run = scene.runs[part.id];
    const cam = part.group ? cams[part.group.index] : cams.world;
    const f = TURN.emit(run, cam, TURN.frame(run));
    let root = part.group;
    while (root && root.parent) root = root.parent;
    const pivot = root ? [root.origin[0], root.origin[1], 0] : [0, 0, 0];
    const a = k.iso(pivot, P);
    const b = k.iso(pivot, Pp);
    const shift = [a[0] - b[0], a[1] - b[1]];
    const sh = (pts) => pts.map(([x, y]) => [x + shift[0], y + shift[1]]);
    const { F, ring, s0, s1 } = part.world;
    const up = run.up;
    const Pk = planted ? { ...Pp, azimuth: Pp.azimuth - 2 } : Pp;
    // the reference at 10x, scaled back: the kit's paths round to 0.1, whose diagonal (0.07) alone exceeded the
    // 0.06 limit (the rounds check already compares against its 10x reference)
    const Pk10 = { ...Pk, origin: [Pk.origin[0] * 10, Pk.origin[1] * 10], scale: Pk.scale * 10 };
    const kit = up ? k.extrude(ring, s0, s1 - s0, Pk10) : G.prismOf(F, ring, s0, s1, Pk10);
    const fine = (pts) => pts.map(([x, y]) => [x / 10, y / 10]);
    const mine = subpaths(f.d[run.role.edge])[0].pts;
    const theirs = sh(fine(subpaths(kit.fill)[0].pts));
    const ho = hausdorff(mine, theirs);
    results.outline = Math.max(results.outline, ho);
    if (ho > (worstAt[part.name]?.outline ?? -1)) worstAt[part.name] = { ...(worstAt[part.name] ?? {}), outline: ho, at: theta };
    if (up) {
      const topMine = applyMatrix(subpaths(part.planPath)[0].pts, f.t[run.role.top]);
      const topKit = sh(fine(subpaths(kit.top)[0].pts));
      results.top = Math.max(results.top, hausdorff(topMine, topKit));
    }
    const kitFaces = kit.shades.map((d) => subpaths(d)).concat(up ? [] : [subpaths(kit.top)]);
    const faceCount = up ? run.n : run.n + 2;
    for (let i = 0; i < faceCount; i++) {
      const role = run.role[`f${i}`];
      const d = f.d[role];
      if (!d) continue;
      const q = f.q[role];
      if (q % TURN.q !== 0) {
        results.skipped++;
        continue;
      }
      const tone = q / TURN.q;
      const pts = subpaths(d)[0].pts;
      let best = Infinity;
      for (const sp of kitFaces[tone] ?? []) best = Math.min(best, hausdorff(pts, sh(fine(sp.pts))));
      if (!Number.isFinite(best)) {
        results.missing++;
        continue;
      }
      results.compared++;
      results.faces = Math.max(results.faces, best);
      // (fu/r1-verify) the face that is off is named too (only outlines were, so a failing face line named nothing)
      if (best > (worstAt[part.name]?.face ?? -1)) worstAt[part.name] = { ...(worstAt[part.name] ?? {}), face: best, faceAt: theta, faceIndex: i, faceTone: tone };
    }
  }
}

  const limit = 0.06;
  const pass = results.outline <= limit && results.top <= limit && results.faces <= limit && results.missing === 0;
  const worst = [
    ...Object.entries(worstAt).filter(([, w]) => w.outline > limit).map(([name, w]) => `${name} outline ${w.outline.toFixed(3)} at ${w.at}°`),
    ...Object.entries(worstAt).filter(([, w]) => w.face > limit).sort((x, y) => y[1].face - x[1].face).map(([name, w]) => `${name} face f${w.faceIndex} (tone ${w.faceTone}) ${w.face.toFixed(3)} px from the kit's face of that tone at ${w.faceAt}°`),
  ];
  return { pass, text: `prisms at ${angles.length} angles: outline ${results.outline.toFixed(4)} px · top ${results.top.toFixed(4)} px · faces ${results.faces.toFixed(4)} px over ${results.compared} faces (${results.skipped} in crossfade windows, ${results.missing} with no kit face of that tone)`, worst };
}

export function rounds(T, P, angles, { only = null, plant = null } = {}) {
  const scene = TURN.prepare(T.data, { unit: 1 });
  const CELL = 0.1;
const subpaths = (d) => {
    const out = [];
    for (const [, body] of (d ?? "").matchAll(/M([^M]*)/g)) {
      const nums = (body.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
      const pts = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
      out.push(pts);
    }
    return out;
  };
  const segDist = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
    return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
  };
  const distToPoly = (p, poly) => {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) best = Math.min(best, segDist(p, poly[i], poly[(i + 1) % poly.length]));
    return best;
  };
  const hausdorff = (A, B) => {
    let worst = 0;
    for (const p of A) worst = Math.max(worst, distToPoly(p, B));
    for (const p of B) worst = Math.max(worst, distToPoly(p, A));
    return worst;
  };
  function raster(layers, box, grow = 0) {
    const [x0, y0, x1, y1] = box;
    const w = Math.ceil((x1 - x0) / CELL) + 1;
    const h = Math.ceil((y1 - y0) / CELL) + 1;
    const out = new Int8Array(w * h).fill(-1);
    for (const { tone, d } of layers) {
      if (!d) continue;
      const mask = new Uint8Array(w * h);
      const polys = subpaths(d);
      for (let row = 0; row < h; row++) {
        const y = y0 + row * CELL + CELL / 2;
        const hits = [];
        for (const poly of polys)
          for (let i = 0; i < poly.length; i++) {
            const a = poly[i];
            const b = poly[(i + 1) % poly.length];
            if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
              const x = a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
              hits.push([x, b[1] > a[1] ? 1 : -1]);
            }
          }
        hits.sort((p, q) => p[0] - q[0]);
        let wind = 0;
        for (let i = 0; i < hits.length - 1; i++) {
          wind += hits[i][1];
          if (!wind) continue;
          const from = Math.max(0, Math.ceil((hits[i][0] - x0 - CELL / 2) / CELL));
          const to = Math.min(w - 1, Math.floor((hits[i + 1][0] - x0 - CELL / 2) / CELL));
          for (let c = from; c <= to; c++) mask[row * w + c] = 1;
        }
      }
      const reach = Math.round(grow / CELL);
      for (let row = 0; row < h; row++)
        for (let c = 0; c < w; c++) {
          let on = mask[row * w + c];
          for (let dy = -reach; dy <= reach && !on; dy++)
            for (let dx = -reach; dx <= reach && !on; dx++) {
              if (dx * dx + dy * dy > reach * reach) continue;
              const rr = row + dy;
              const cc = c + dx;
              if (rr >= 0 && cc >= 0 && rr < h && cc < w && mask[rr * w + cc]) on = 1;
            }
          if (on) out[row * w + c] = tone;
        }
    }
    return { out, w, h };
  }
  
// the 13 sub-band thresholds on the facing ramp (kit patch 15's T3_HT, from its knots T3_HS)
const HS = [-0.15, 0.1, 0.31, 0.52, 0.85];
const HT = Array.from({ length: 12 }, (_, kk) => {
  const u = (kk + 0.5) / 3;
  const i = Math.min(3, Math.floor(u));
  return HS[i] + (u - i) * (HS[i + 1] - HS[i]);
});
function subBandReference(F, s0, s1, r0, r1, Pp, box, shift) {
  const [x0, y0, x1, y1] = box;
  const w = Math.ceil((x1 - x0) / CELL) + 1;
  const h = Math.ceil((y1 - y0) / CELL) + 1;
  const out = new Int8Array(w * h).fill(-1);
  const depth = new Float64Array(w * h).fill(-Infinity);
  const V = G.viewOf(Pp);
  const L = G.lightOf(Pp);
  const g = (r1 - r0) / (s1 - s0 || 1);
  const norm = Math.hypot(1, g);
  const ns = Math.max(60, Math.ceil(((s1 - s0) * Pp.scale * 1.6) / CELL));
  const na = Math.max(720, Math.ceil((2 * Math.PI * Math.max(r0, r1) * Pp.scale * 1.6) / CELL));
  for (let j = 0; j < na; j++) {
    const t = ((j + 0.5) / na) * 2 * Math.PI;
    const c = Math.cos(t);
    const q = Math.sin(t);
    const radial = [F.u[0] * c + F.v[0] * q, F.u[1] * c + F.v[1] * q, F.u[2] * c + F.v[2] * q];
    const n = [(radial[0] - g * F.a[0]) / norm, (radial[1] - g * F.a[1]) / norm, (radial[2] - g * F.a[2]) / norm];
    if (n[0] * V[0] + n[1] * V[1] + n[2] * V[2] <= 1e-9) continue;
    const score = n[0] * L[0] + n[1] * L[1] + n[2] * L[2];
    let band = 0;
    while (band < HT.length && score >= HT[band]) band++;
    for (let i = 0; i <= ns; i++) {
      const sv = s0 + ((s1 - s0) * i) / ns;
      const p = G.pointOf(F, sv, r0 + g * (sv - s0), t);
      const sp = k.iso(p, Pp);
      const cx = Math.floor((sp[0] + shift[0] - x0) / CELL);
      const cy = Math.floor((sp[1] + shift[1] - y0) / CELL);
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
      const dd = p[0] * V[0] + p[1] * V[1] + p[2] * V[2];
      const at = cy * w + cx;
      if (dd > depth[at]) {
        depth[at] = dd;
        out[at] = band;
      }
    }
  }
  return { out, w, h };
}
const stats = { outline: 0, outlineFine: 0, bands: 0, cells: 0, mismatched: 0, parts: 0 };
const worst = [];
for (const theta of angles) {
  const cams = TURN.cams(scene, restValues(T, theta));
  const Pp = { ...P, azimuth: P.azimuth - theta };
  const Pf = { ...Pp, origin: [Pp.origin[0] * 10, Pp.origin[1] * 10], scale: Pp.scale * 10 };
  for (const part of T.parts) {
    if ((part.kind !== "round" && part.kind !== "lathe") || (only && !only.test(part.name)) || !rootOf(part.group) || part.group.kind === "free") continue;
    const run = scene.runs[part.id];
    const cam = part.group ? cams[part.group.index] : cams.world;
    const f = TURN.emit(run, cam, TURN.frame(run));
    let root = part.group;
    while (root && root.parent) root = root.parent;
    const pivot = root ? [root.origin[0], root.origin[1], 0] : [0, 0, 0];
    const a = k.iso(pivot, P);
    const b = k.iso(pivot, Pp);
    const shift = [a[0] - b[0], a[1] - b[1]];
    let F, s0, s1, r0, r1, ends, profile;
    if (part.kind === "lathe") {
      const { curve, knots } = part.world;
      F = part.world.F;
      s0 = curve.s0;
      s1 = curve.s1;
      r0 = curve.radius(s0);
      r1 = curve.radius(s1);
      ends = ["flat", "flat"];
      profile = [[s0, r0], ...knots.slice(1, -1).map((sv) => [sv, curve.radius(sv), 1]), [s1, r1]];
    } else ({ F, s0, s1, r0, r1, ends, profile } = part.world);
    const meridian = [[profile[0][0], 0], ...profile.filter((p) => p[1] > 1e-9), [profile[profile.length - 1][0], 0]];
    const domed = ends.includes("dome");
    const radius = (s) => {
      if (ends[0] === "dome" && s < s0) return Math.sqrt(Math.max(0, r0 * r0 - (s - s0) ** 2));
      if (ends[1] === "dome" && s > s1) return Math.sqrt(Math.max(0, r1 * r1 - (s - s1) ** 2));
      return r0 + ((r1 - r0) * (Math.max(s0, Math.min(s1, s)) - s0)) / (s1 - s0);
    };
    const slope = (s) => {
      if (ends[0] === "dome" && s < s0) return -(s - s0) / Math.max(1e-4, radius(s));
      if (ends[1] === "dome" && s > s1) return -(s - s1) / Math.max(1e-4, radius(s));
      return (r1 - r0) / (s1 - s0);
    };
    const lo = ends[0] === "dome" ? s0 - r0 : s0;
    const hi = ends[1] === "dome" ? s1 + r1 : s1;
    const knots = [];
    for (let i = 0; i <= 64; i++) knots.push(lo + ((hi - lo) * i) / 64);
    const analytic = [[lo, 0], ...knots.slice(1, -1).map((sv) => [sv, radius(sv), 1]), [hi, 0]];
    if (ends[0] !== "dome") analytic.splice(1, 0, [lo, r0]);
    if (ends[1] !== "dome") analytic.splice(analytic.length - 1, 0, [hi, r1]);
    const lathed = part.kind === "lathe" ? { slope: part.world.curve.slope, radius: part.world.curve.radius } : null;
    const kit = lathed ? G.lathe(meridian, F, Pp, { smooth: lathed }) : domed ? G.lathe(analytic, F, Pp, { smooth: { slope, radius } }) : G.lathe(meridian, F, Pp, { smooth: true });
    const kitFine = lathed ? G.lathe(meridian, F, Pf, { smooth: lathed }) : domed ? G.lathe(analytic, F, Pf, { smooth: { slope, radius } }) : G.lathe(meridian, F, Pf, { smooth: true });
    const sh = (pts) => pts.map(([x, y]) => [x + shift[0], y + shift[1]]);
    const mine = subpaths(f.d[run.role.edge])[0];
    const theirs = sh(subpaths(kit.fill)[0]);
    const fineRef = subpaths(kitFine.fill)[0].map(([x, y]) => [x / 10 + shift[0], y / 10 + shift[1]]);
    const ho = hausdorff(mine, theirs);
    const hf = hausdorff(mine, fineRef);
    stats.outline = Math.max(stats.outline, ho);
    stats.outlineFine = Math.max(stats.outlineFine, hf);
    stats.parts++;
    // kit patch 17: a round with sub-bands (roles h0..h12) is checked against an analytic reference (a z-buffer of
    // the true cone at 10x, each sample banded by its light score on the 13 sub-band thresholds), not the 5-tone lathe
    const sub = run.role.h0 !== undefined;
    const ours = sub ? Array.from({ length: 13 }, (_, t) => ({ tone: t, d: f.d[run.role[`h${t}`]] })) : [0, 1, 2, 3, 4].map((t) => ({ tone: t, d: f.d[run.role[`s${t}`]] }));
    // the control (follow-up item 47): the planted part's largest band drawn one step off
    if (plant && part.name === plant) {
      const big = ours.reduce((m, x) => ((x.d ?? "").length > (m.d ?? "").length ? x : m), ours[0]);
      big.tone += big.tone < ours.length - 1 ? 1 : -1;
    }
    for (const end of [0, 1]) {
      const role = run.role[`k${end}`];
      if (role === undefined || !f.d[role]) continue;
      const q = f.q[role];
      ours.push({ tone: sub ? 9 : q % TURN.q === 0 ? q / TURN.q : 9, d: f.d[role] });
    }
    const theirsLayers = [...kitFine.shades.map((d, t) => ({ tone: t, d })), { tone: 4, d: kitFine.top }].map(({ tone, d }) => ({ tone, d: subpaths(d).map((poly) => "M" + poly.map(([x, y]) => `${x / 10 + shift[0]} ${y / 10 + shift[1]}`).join("L") + "Z").join("") }));
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of mine) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    const box = [x0 - 1, y0 - 1, x1 + 1, y1 + 1];
    const A = raster(ours, box, 0.2);
    const B = sub ? subBandReference(F, s0, s1, r0, r1, Pp, box, shift) : raster(theirsLayers, box, 0.2);
    const inside = raster([{ tone: 1, d: f.d[run.role.edge] }], box).out;
    const capCells = raster([0, 1].map((end) => ({ tone: 1, d: run.role[`k${end}`] !== undefined ? f.d[run.role[`k${end}`]] : "" })), box, 0.6).out;
    const capExempt = part.kind === "lathe";
    const insideKit = raster([{ tone: 1, d: "M" + fineRef.map(([x, y]) => `${x} ${y}`).join("L") + "Z" }], box).out;
    let worstGap = 0;
    const reach = Math.ceil(0.5 / CELL) + 2;
    for (let row = 0; row < A.h; row++)
      for (let c = 0; c < A.w; c++) {
        const i = row * A.w + c;
        if (inside[i] < 0 || insideKit[i] < 0) continue;
        const ta = A.out[i];
        const tb = B.out[i];
        if (ta === 9 || ta < 0 || tb < 0) continue;
        if (capExempt && capCells[i] >= 0) continue;
        stats.cells++;
        if (ta === tb) continue;
        let edge = false;
        for (let dy = -3; dy <= 3 && !edge; dy++) for (let dx = -3; dx <= 3; dx++) if (inside[(row + dy) * A.w + c + dx] < 0) edge = true;
        if (edge) continue;
        stats.mismatched++;
        let near = Infinity;
        for (let dy = -reach; dy <= reach; dy++)
          for (let dx = -reach; dx <= reach; dx++) {
            const rr = row + dy;
            const cc = c + dx;
            if (rr < 0 || cc < 0 || rr >= A.h || cc >= A.w) continue;
            if (B.out[rr * A.w + cc] === ta) near = Math.min(near, Math.hypot(dx, dy) * CELL);
          }
        worstGap = Math.max(worstGap, near);
      }
    stats.bands = Math.max(stats.bands, worstGap);
    if (worstGap > 0.5 || hf > 0.05) worst.push({ part: part.name, theta, band: worstGap, outline: hf });
  }
}

  return { pass: stats.outlineFine <= 0.05 && stats.bands <= 0.5, text: `rounds: ${stats.parts} frames at ${angles.length} angles: outline vs kit ${stats.outline.toFixed(4)} px (kit rounds to 0.1), vs kit at 10x ${stats.outlineFine.toFixed(4)} px · band boundaries ≤ ${stats.bands.toFixed(2)} px apart (${stats.mismatched} of ${stats.cells} interior cells differ)`, worst: worst.sort((a, b) => b.band - a.band || b.outline - a.outline).slice(0, 12).map((w) => `${w.part} at ${w.theta}°: outline ${w.outline.toFixed(3)} px, band ${w.band.toFixed(2)} px`) };
}

export function tubes(T, P, angles) {
  const scene = TURN.prepare(T.data, { unit: 1 });
const subpaths = (d) => [...(d ?? "").matchAll(/M([^M]*)/g)].map(([, body]) => {
    const nums = (body.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    return pts;
  });
  const segDist = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
    return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
  };
  const compare = (mine, theirs) => {
    const A = subpaths(mine);
    const B = subpaths(theirs);
    if (A.length !== B.length) return { error: Infinity, why: `subpaths ${A.length} vs ${B.length}` };
    let worst = 0;
    for (let i = 0; i < A.length; i++) {
      if (A[i].length === B[i].length) for (let j = 0; j < A[i].length; j++) worst = Math.max(worst, Math.abs(A[i][j][0] - B[i][j][0]), Math.abs(A[i][j][1] - B[i][j][1]));
      else for (const p of A[i]) worst = Math.max(worst, Math.min(...B[i].slice(1).map((q, j) => segDist(p, B[i][j], q))));
    }
    return { error: worst };
  };
  
const stats = { body: 0, shine: 0, shade: 0, edges: 0, rings: 0, chunks: 0 };
const bad = [];
for (const theta of angles) {
  const cams = TURN.cams(scene, restValues(T, theta));
  const Pp = { ...P, azimuth: P.azimuth - theta };
  const Pf = { ...Pp, origin: [Pp.origin[0] * 10, Pp.origin[1] * 10], scale: Pp.scale * 10 };
  for (const route of T.routes) {
    if (route.group && (!rootOf(route.group) || route.group.kind === "free")) continue;
    const root = rootOf(route.group);
    const pivot = root ? [root.origin[0], root.origin[1], 0] : [0, 0, 0];
    const a = k.iso(pivot, P);
    const b = k.iso(pivot, Pp);
    const shift = [a[0] - b[0], a[1] - b[1]];
    const kit = tubePieces(route.world, route.r, Pf, { maxLength: route.chunk, spacing: route.spacing, gaps: route.gaps, breaks: route.breaks, caps: route.caps, stripes: route.wide, rings: route.rings });
    const scaled = (d) => subpaths(d).map((pts) => "M" + pts.map(([x, y]) => `${x / 10 + shift[0]} ${y / 10 + shift[1]}`).join("L")).join("");
    const chunks = T.parts.filter((part) => part.route === route.name);
    if (kit.length !== chunks.length) {
      bad.push(`${route.name}: ${chunks.length} chunks vs kit ${kit.length}`);
      continue;
    }
    chunks.forEach((part, index) => {
      const run = scene.runs[part.id];
      const f = TURN.emit(run, route.group ? cams[route.group.index] : cams.world, TURN.frame(run));
      const piece = kit[index];
      stats.chunks++;
      for (const key of ["body", "shine", "shade", "edges"]) {
        if (run.role[key] === undefined) continue;
        const { error, why } = compare(f.d[run.role[key]], scaled(piece[key]));
        stats[key] = Math.max(stats[key], error);
        if (error > 0.05) bad.push(`${part.name} ${key} at ${theta}°: ${why ?? error.toFixed(3)}`);
      }
      if (route.rings) {
        const mine = run.roles.filter((role) => role.name.startsWith("r")).map((role) => f.d[run.role[role.name]]).join("");
        const theirs = scaled(piece.rings.filter((ring) => ring.alpha * 32 >= 0.5).map((ring) => ring.d).join(""));
        const A = subpaths(mine);
        const B = subpaths(theirs);
        let worst = A.length === B.length ? 0 : Infinity;
        for (const seg of A) {
          let best = Infinity;
          for (const other of B) best = Math.min(best, Math.max(...seg.map((p, j) => Math.hypot(p[0] - other[j][0], p[1] - other[j][1]))));
          worst = Math.max(worst, best);
        }
        stats.rings = Math.max(stats.rings, worst);
        if (worst > 0.05) bad.push(`${part.name} rings at ${theta}°: ${A.length} vs ${B.length} segments, worst ${worst.toFixed(3)}`);
      }
    });
  }
}

  return { pass: !bad.length, text: `tubes: ${stats.chunks} chunk frames at ${angles.length} angles against tubePieces at 10x: body ${stats.body.toFixed(4)} · shine ${stats.shine.toFixed(4)} · shade ${stats.shade.toFixed(4)} · edges ${stats.edges.toFixed(4)} · rings ${stats.rings.toFixed(4)} px`, worst: bad.slice(0, 20) };
}

/**
 * Hulls (kit patch 6's promised reference, review round 1; follow-up item 47): every hull's emitted drawing against an
 * independent reference built from its posed world vertices, in each state and at each angle.
 *   - outline: the emitted fill against the 2D convex hull of the posed vertices projected by the kit's iso() at 10x;
 *   - flat faces: each visible flat face's tone (the kit's smoothed staircase on the light score of its Newell normal,
 *     T3_LB with a 0.035 soft step, in 64ths) and its boundary (Hausdorff to the projected face polygon);
 *   - sub-bands (kit patch 15): every emitted band polygon's tone against the reference score at its centroid (the
 *     corner normals' light scores, interpolated over the face's fan triangle, banded on the 13 thresholds); a polygon
 *     in the wrong band must lie within 0.5 px of that threshold's iso-line; and the bands must cover the visible smooth
 *     faces (area within 1%).
 * states: [{ label, values(theta) }] (group values, e.g. follow(channels)); a group parked 10 km up is skipped, and a
 * free group with no value (the kit's rest) is skipped as before. plant: { part, what: "band" } shifts the part's
 * largest emitted sub-band one step (the control, which must fail).
 */
export function hulls(T, P, angles, { states = null, plant = null, source = "built" } = {}) {
  const scene = TURN.prepare(T.data, { unit: 1 });
  const RAD = Math.PI / 180;
  const LB = [0, 0.2, 0.42, 0.62];
  const SOFT = 0.035;
  const HS = [-0.15, 0.1, 0.31, 0.52, 0.85];
  const HT = Array.from({ length: 12 }, (_, kk) => {
    const u = (kk + 0.5) / 3;
    const i = Math.min(3, Math.floor(u));
    return HS[i] + (u - i) * (HS[i + 1] - HS[i]);
  });
  const stepS = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const levelOf = (score) => Math.round(LB.reduce((u, b) => u + stepS(b - SOFT, b + SOFT, score), 0) * 64);
  const bandOf = (score) => {
    let t = 0;
    while (t < HT.length && score >= HT[t]) t++;
    return t;
  };
  const polys = (d) => [...(d ?? "").matchAll(/M([^M]*)/g)].map(([, body]) => {
    const nums = (body.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    return pts;
  });
  const area = (pts) => {
    let s2 = 0;
    for (let i = 0; i < pts.length; i++) s2 += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
    return Math.abs(s2) / 2;
  };
  const centroid = (pts) => {
    let cx = 0, cy = 0, a2 = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1) % pts.length];
      const c = x0 * y1 - x1 * y0;
      a2 += c;
      cx += (x0 + x1) * c;
      cy += (y0 + y1) * c;
    }
    if (Math.abs(a2) < 1e-12) return pts.reduce((m, q) => [m[0] + q[0] / pts.length, m[1] + q[1] / pts.length], [0, 0]);
    return [cx / (3 * a2), cy / (3 * a2)];
  };
  const hull2 = (points) => {
    // snapped to 1e-6 first: a ring's two vertices either side of an extreme project to the same x up to float noise,
    // and the monotone chain then dropped an extreme vertex as "collinear" (a 0.37 px false gap on the platter)
    const p = points.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [];
    for (const q of p) {
      while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 1e-12) lo.pop();
      lo.push(q);
    }
    const up = [];
    for (let i = p.length - 1; i >= 0; i--) {
      while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p[i]) <= 1e-12) up.pop();
      up.push(p[i]);
    }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  };
  const segDist = (q, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l)) : 0;
    return Math.hypot(q[0] - a[0] - dx * t, q[1] - a[1] - dy * t);
  };
  const toPoly = (q, poly) => {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) best = Math.min(best, segDist(q, poly[i], poly[(i + 1) % poly.length]));
    return best;
  };
  const haus = (A, B) => Math.max(...A.map((q) => toPoly(q, B)), ...B.map((q) => toPoly(q, A)));
  const apply = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
  // the camera's view and light directions in world space (t3Camera)
  const a = (P.azimuth ?? 45) * RAD;
  const e = (P.elevation ?? 30) * RAD;
  const Vw = [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)];
  const lw = Math.hypot(Math.sin(a), Math.cos(a), 1.2);
  const Lw = [-Math.sin(a) / lw, Math.cos(a) / lw, 1.2 / lw];
  const P10 = { ...P, origin: [P.origin[0] * 10, P.origin[1] * 10], scale: P.scale * 10 };
  const project = (q) => {
    const s = k.iso(q, P10);
    return [s[0] / 10, s[1] / 10];
  };
  const list = states ?? [{ label: "rest", values: (theta) => restValues(T, theta) }];
  const stats = { slivers: 0, frames: 0, parts: new Set(), free: new Set(), outline: 0, flatFaces: 0, flatTone: 0, flatEdge: 0, bands: 0, bandPolys: 0, bandMiss: 0, bandWorst: 0, cover: 0, matched: 0, reordered: 0, unmatched: 0, bandParts: new Map() };
  // (a380 review round 1, fu/r1-verify) source "built": a build face's role is the packed face with the same corners,
  // not the one at its own index. The page stores a mirrored hull once and rebuilds the mirror at mount (perf's
  // "mirrored hulls stored once"), and the rebuild reverses and reorders its faces: pairing the jth built flat face
  // with the page's f<j> compared fus.M.wall.r's faces with other faces' tones and paths (256 64ths, 29 px edges).
  // Per part, once: each built flat face → the index among the packed flat faces of the face whose corners are the
  // same points (each within TOL kit units of one of the other's: the packing rounds to 3 decimals)
  const TOL = 0.01;
  const flatMaps = new Map();
  const flatMapOf = (part, run, o) => {
    if (flatMaps.has(part.name)) return flatMaps.get(part.name);
    const packed = run.faces.filter((x) => !x.s).map((x) => Array.from(x.v).map((i) => [run.V[3 * i], run.V[3 * i + 1], run.V[3 * i + 2]]));
    const local = part.world.points.map((q) => [q[0] - o[0], q[1] - o[1], q[2] - o[2]]);
    const near = (a, b) => Math.abs(a[0] - b[0]) < TOL && Math.abs(a[1] - b[1]) < TOL && Math.abs(a[2] - b[2]) < TOL;
    const same = (A, B) => A.length === B.length && A.every((a) => B.some((b) => near(a, b))) && B.every((b) => A.some((a) => near(a, b)));
    const map = [];
    const used = new Set();
    for (const face of part.spec.faces) {
      if (face.s) continue;
      const corners = face.v.map((i) => local[i]);
      const jf = map.length;
      // the face at its own index first (most parts keep their order), then any other unused one
      let k = jf < packed.length && !used.has(jf) && same(corners, packed[jf]) ? jf : packed.findIndex((q, kk) => !used.has(kk) && same(corners, q));
      if (k < 0) {
        stats.unmatched++;
        k = jf;
      } else {
        used.add(k);
        stats.matched++;
        if (k !== jf) stats.reordered++;
      }
      map.push(k);
    }
    flatMaps.set(part.name, map);
    return map;
  };
  const worstAt = {};
  const note = (name, key, v, where) => {
    const w = (worstAt[name] ??= {});
    if (!(v <= (w[key]?.v ?? -1))) w[key] = { v, where };
  };
  for (const state of list)
    for (const theta of angles) {
      const values = state.values(theta);
      const cams = TURN.cams(scene, values);
      for (const part of T.parts) {
        if (part.kind !== "hull" || !part.group) continue;
        const g = part.group;
        const free = g.kind === "free" || (() => { let x = g; while (x.parent) x = x.parent; return x.kind === "free"; })();
        let root = g;
        while (root.parent) root = root.parent;
        if (root.kind === "free" && !(values[root.name] && typeof values[root.name] === "object")) continue; // the kit's rest
        const pose = cams.poses[g.index];
        if (!pose || pose.t[2] >= 1e4) continue; // parked
        const run = scene.runs[part.id];
        const f = TURN.emit(run, cams[g.index], TURN.frame(run));
        const mine = polys(f.d[run.role.fill])[0] ?? [];
        if (mine.length < 3) continue;
        const R = pose.R;
        const o = g.origin;
        // source "built": the build's own vertices and corner normals; "packed": the page's (data.turn, 3 decimals),
        // what the runtime draws from. The difference between the two is the packing's error, not the drawing's.
        const local = source === "packed" ? Array.from({ length: run.V.length / 3 }, (_, i) => [run.V[3 * i], run.V[3 * i + 1], run.V[3 * i + 2]]) : part.world.points.map((q) => [q[0] - o[0], q[1] - o[1], q[2] - o[2]]);
        const posed = local.map((q) => {
          const r = apply(R, q);
          return [r[0] + pose.t[0], r[1] + pose.t[1], r[2] + pose.t[2]];
        });
        const S = posed.map(project);
        const where = `${state.label} at ${theta}°`;
        const ho = haus(mine, hull2(S));
        stats.frames++;
        stats.parts.add(part.name);
        if (free) stats.free.add(part.name);
        stats.outline = Math.max(stats.outline, ho);
        note(part.name, "outline", ho, where);
        // faces
        // the packed spec re-indexes its corner normals: its faces go with its normals, the build's with the build's
        const faces = source === "packed" ? run.faces.map((x) => ({ v: Array.from(x.v), s: x.s, c: x.c ? Array.from(x.c) : null })) : part.spec.faces;
        const N = source === "packed" ? run.N : part.spec.N;
        const shift = plant && plant.part === part.name ? plant : null;
        let smoothArea = 0;
        const tris = [];
        faces.forEach((face, j) => {
          const v = face.v;
          // Newell normal of the posed face (independent of the runtime's prepared normals)
          let nx = 0, ny = 0, nz = 0;
          for (let i = 0; i < v.length; i++) {
            const p0 = posed[v[i]];
            const p1 = posed[v[(i + 1) % v.length]];
            nx += (p0[1] - p1[1]) * (p0[2] + p1[2]);
            ny += (p0[2] - p1[2]) * (p0[0] + p1[0]);
            nz += (p0[0] - p1[0]) * (p0[1] + p1[1]);
          }
          const l = Math.hypot(nx, ny, nz) || 1;
          const n = [nx / l, ny / l, nz / l];
          const facing = n[0] * Vw[0] + n[1] * Vw[1] + n[2] * Vw[2];
          const ring = v.map((i) => S[i]);
          if (!face.s) {
            const flat = faces.slice(0, j).filter((x) => !x.s).length;
            const role = run.role[`f${source === "packed" ? flat : flatMapOf(part, run, o)[flat]}`];
            const d = f.d[role];
            if (!(facing > 1e-6)) return;
            if (!d) return;
            stats.flatFaces++;
            const want = levelOf(n[0] * Lw[0] + n[1] * Lw[1] + n[2] * Lw[2]);
            const dq = Math.abs(f.q[role] - want);
            stats.flatTone = Math.max(stats.flatTone, dq);
            note(part.name, "flatTone", dq, where);
            const he = haus(polys(d)[0], ring);
            stats.flatEdge = Math.max(stats.flatEdge, he);
            note(part.name, "flatEdge", he, where);
            return;
          }
          if (!(facing > 1e-6)) return;
          smoothArea += area(ring);
          const sc = face.c.map((c) => {
            const nn = apply(R, [N[3 * c], N[3 * c + 1], N[3 * c + 2]]);
            return nn[0] * Lw[0] + nn[1] * Lw[1] + nn[2] * Lw[2];
          });
          for (let i = 1; i + 1 < ring.length; i++) tris.push({ p: [ring[0], ring[i], ring[i + 1]], s: [sc[0], sc[i], sc[i + 1]] });
        });
        if (!tris.length) continue;
        // the emitted sheets h0..h12
        let bandArea = 0;
        let largest = -1;
        let largestArea = -1;
        const sheets = [];
        for (let t = 0; t < 13; t++) {
          const list2 = polys(f.d[run.role[`h${t}`]]).filter((q) => q.length >= 3);
          const ar = list2.reduce((s2, q) => s2 + area(q), 0);
          bandArea += ar;
          if (ar > largestArea) {
            largestArea = ar;
            largest = t;
          }
          sheets.push(list2);
        }
        // within 1% or 1 px² (a face seen nearly edge-on has 1-2 px², and the paths round to 0.01 px)
        const cover = smoothArea > 1 && Math.abs(bandArea - smoothArea) > 1 ? Math.abs(bandArea - smoothArea) / smoothArea : 0;
        stats.cover = Math.max(stats.cover, cover);
        note(part.name, "cover", cover, where);
        for (let t = 0; t < 13; t++)
          for (const q of sheets[t]) {
            // slivers (under 0.05 px², or under 0.1 px wide) are below anything drawn, and the paths' 0.01 px rounding
            // can move their centroid across the edge of the fan triangle they were clipped from
            const perim = q.reduce((sum, p0, i) => sum + Math.hypot(q[(i + 1) % q.length][0] - p0[0], q[(i + 1) % q.length][1] - p0[1]), 0);
            if (area(q) < 0.05 || (2 * area(q)) / perim < 0.1) {
              stats.slivers++;
              continue;
            }
            const tone = shift && t === largest ? t + 1 : t;
            const c = q.reduce((m, p0) => [m[0] + p0[0] / q.length, m[1] + p0[1] / q.length], [0, 0]);
            // the reference triangle under the centroid (the most interior one where thin fan triangles of a face with
            // near-collinear corners overlap), its interpolated score and gradient (px)
            let hit = null;
            let best = -Infinity;
            for (const tri of tris) {
              const [A, B, C] = tri.p;
              const det = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
              if (Math.abs(det) < 1e-12) continue;
              const u = ((c[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (c[1] - A[1])) / det;
              const w = ((B[0] - A[0]) * (c[1] - A[1]) - (c[0] - A[0]) * (B[1] - A[1])) / det;
              const inner = Math.min(u, w, 1 - u - w);
              if (inner < -1e-6 || inner <= best) continue;
              best = inner;
              const s = tri.s[0] + u * (tri.s[1] - tri.s[0]) + w * (tri.s[2] - tri.s[0]);
              // ∇s in screen space from the barycentric gradients
              const gu = [(C[1] - A[1]) / det, -(C[0] - A[0]) / det];
              const gw = [-(B[1] - A[1]) / det, (B[0] - A[0]) / det];
              const gx = (tri.s[1] - tri.s[0]) * gu[0] + (tri.s[2] - tri.s[0]) * gw[0];
              const gy = (tri.s[1] - tri.s[0]) * gu[1] + (tri.s[2] - tri.s[0]) * gw[1];
              hit = { s, grad: Math.hypot(gx, gy) };
            }
            if (!hit) continue;
            stats.bandPolys++;
            const ref = bandOf(hit.s);
            if (ref === tone) continue;
            // how far the centroid lies from the threshold between the two bands (linear score in the triangle)
            const edge = tone > ref ? HT[tone - 1] : HT[tone];
            const gap = Math.abs(tone - ref) > 1 || edge === undefined ? Infinity : hit.grad > 1e-12 ? Math.abs(hit.s - edge) / hit.grad : Infinity;
            stats.bandMiss++;
            stats.bandParts.set(part.name, (stats.bandParts.get(part.name) ?? 0) + 1);
            stats.bandWorst = Math.max(stats.bandWorst, gap);
            note(part.name, "band", gap, where);
          }
      }
    }
  const limit = 0.06;
  const pass = stats.outline <= limit && stats.flatTone <= 1 && stats.flatEdge <= limit && stats.bandWorst <= 0.5 && stats.cover <= 0.01;
  const bad = [];
  for (const [name, w] of Object.entries(worstAt)) {
    if (w.outline && w.outline.v > limit) bad.push(`${name} outline ${w.outline.v.toFixed(3)} px (${w.outline.where})`);
    if (w.flatTone && w.flatTone.v > 1) bad.push(`${name} flat face tone ${w.flatTone.v} 64ths off (${w.flatTone.where})`);
    if (w.flatEdge && w.flatEdge.v > limit) bad.push(`${name} flat face edge ${w.flatEdge.v.toFixed(3)} px (${w.flatEdge.where})`);
    if (w.band && w.band.v > 0.5) bad.push(`${name} sub-band ${Number.isFinite(w.band.v) ? w.band.v.toFixed(2) + " px" : "a band or more"} from its threshold (${w.band.where})`);
    if (w.cover && w.cover.v > 0.01) bad.push(`${name} bands cover ${(100 * (1 - w.cover.v)).toFixed(1)}% of its smooth faces (${w.cover.where})`);
  }
  return {
    pass,
    count: stats.parts.size,
    free: stats.free.size,
    text: `hulls (${source === "packed" ? "against the page's packed vertices and normals" : "against the build's own vertices and normals"}): ${stats.parts.size} hulls (${stats.parts.size - stats.free.size} fixed, ${stats.free.size} in free groups) in ${stats.frames} frames over ${list.length} states (${list.map((x) => x.label).join(", ")}) at ${angles.length} angles: outline vs the projected vertices' hull at 10x ${stats.outline.toFixed(4)} px · ${stats.flatFaces} flat faces: tone within ${stats.flatTone} 64ths of the kit's staircase, edges ${stats.flatEdge.toFixed(4)} px · ${stats.bandPolys} sub-band polygons (${stats.slivers} slivers under 0.05 px² left out): ${stats.bandMiss} in another band than the reference at their centroid, the farthest ${Number.isFinite(stats.bandWorst) ? stats.bandWorst.toFixed(3) : "∞"} px from its threshold · bands cover the visible smooth faces within ${(100 * stats.cover).toFixed(2)}%${source === "packed" ? "" : ` · flat faces paired with the page's by their corners: ${stats.matched} matched (${stats.reordered} at another index: the mirrored hulls' rebuild), ${stats.unmatched} unmatched`}${stats.bandParts.size ? ` · sub-band polygons in another band by part: ${[...stats.bandParts].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([n, c]) => `${n} ${c}`).join(", ")}${stats.bandParts.size > 8 ? `, … (${stats.bandParts.size} parts)` : ""}` : ""}`,
    worst: bad.slice(0, 16),
  };
}
