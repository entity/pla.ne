// a380/parts/cabin-furniture.mjs (M7, imported by cabin.mjs; not a module of its own): the cut bays' furniture beyond
// the seats (follow-up item 2; review round 3 R13, R61, F04, P07).
//
//   - Bins (r1, follow-up review round 1): a row of 2.4 m units along each cut wall in every bay (F, U, M, UY), each side:
//     24 parts, at the aircraft's height, 1.6-2.1 m over the deck and 0.5 m deep at the top, over the window seats. They
//     stand above the cut plane, in the room of the crown that lifts, so each bay's bins ride their own free group, synced
//     (and faded in) once the crown is clear of them (binGroups). The units stand on the wall strips' tops at W.GAP and
//     follow the loft 0.05 m inside the skin; their underside slopes from the aisle face down to the wall's inner face.
//     Until review round 1 they stood under the cut, outboard of the window seats, from 0.46 m over the carpet to the cut
//     (a recorded height compromise): they covered the windows from inside and nothing read as an overhead bin.
//   - Window reveals: the lining's window frame and pane round every window on the cut walls' inner faces (planes on
//     the wall pieces through ctx.planeOn), now clear of the bins.
//   - Bay-end fronts: pictures on the bay-end faces of the fixed fuselage pieces (ctx.planeOn, as the flight-deck door on
//     nose.fwd): the F bay's aft wall (fus.B1 at x 15.8) shows the M2 galley front with the aisle curtains; the U bay's
//     forward wall (fus.B2 at x 23.5) the two U1 lavatory doors and curtains. The M4 galley gets its counter tops.
//   - Seat side art (the faces a 90° view sees) lives in cabin.mjs seatPlanes.
//
// Every new part uses the cavity tokens (name cabin.*, data-mat), so the cabin dimmer reaches it.

/**
 * api: { ctx, W, M, WQ, BAY, solid, face, K, KD, h } where h holds cabin.mjs's plane helpers (rr, circ, seg, line,
 * fill, cush). spans: per bay, the window seats' outer |y| (F: the suite walls) and the bins' aft end (x1).
 * Returns the records the checks print.
 */
/** The bins' underside at the aisle and their top, over the deck's floor (m), their depth at the top, the skin they keep. */
export const BIN = { under: 1.6, top: 2.1, depth: 0.5, skin: 0.05, clear: 0.03, fade: 6, near: [0.2, 0.6] };
/** The chamfer on the unit's top inner edge (the bin door's rounded top). */
const TOP_EDGE = 0.04;
/** The aisle faces' clearance from the window seats (the upper deck's side lockers keep it). */
export const AISLE_CLEAR = 0.03;
/** The cut groups the bays' crowns ride, and the wall pieces whose inner faces carry the window reveals. */
const BAY_CUT = { F: "cut.f", U: "cut.up", M: "cut.md", UY: "cut.up" };
const BAY_WALLS = { F: "nose.f.wall", U: "fus.U.wall", M: "fus.M.wall", UY: "fus.UY.wall" };
/**
 * r1 (fidelity): the bins hang where the aircraft's do, 1.6-2.1 m over the deck, over the window seats, inside the crown
 * that lifts for the cutaway. The crowns are solid lofts (W.SHELL, zMin cuts), so the bins cannot ride inside them; they
 * ride their own free groups (one per bay), synced, like the flight deck's aft wall (cabin.mjs AFT_SYNC), once the bay's
 * crown has lifted clear of their tops, and fading in over the next 0.6 m of its lift. Each stands on its wall strip's
 * top at W.GAP (the contract's cross-group gap, as the carpets stand on their floors), so the kit audit's cutaway-open
 * pass (crowns removed, free groups at their build pose) finds it supported.
 */
export function binGroups(W) {
  return ["F", "U", "M", "UY"].map((bay) => {
    const c = W.CUT[bay];
    const top = c.floor + BIN.top;
    // the crown's underside (c.cut, lifted by the group's value in units of 1 / W.UNIT m) clears the bins' top by BIN.clear
    const above = Math.ceil((top + BIN.clear - c.cut) * W.UNIT * 2) / 2;
    return { bay, group: `cabin.${bay.toLowerCase()}.bins`, channel: BAY_CUT[bay], above, top, cls: (s) => `a3-bins-${bay.toLowerCase()}-${s}` };
  });
}

export function furnish(api, spans) {
  const { ctx, W, M, WQ, BAY, solid, face, h } = api;
  const rec = { bins: [], fronts: [], reveals: [] };
  const fades = {};
  const g = W.GAP;
  // ---- bins: true height, own groups (binGroups)
  for (const spec of binGroups(W)) {
    const { bay } = spec;
    const B = BAY[bay];
    const c = W.CUT[bay];
    const zT = spec.top; // the top
    const zU = c.floor + BIN.under; // the underside at the aisle face
    const zF = c.walls[1] + g; // the foot: on the wall strip's top (the cut plane, c.cut)
    const xb = spans[bay].x1 ?? B.xb;
    const yo = (x, z) => WQ.ringY(x, z) - BIN.skin; // the outboard face, BIN.skin inside the loft
    const yw = (x) => WQ.wallIn(x, c.walls[1], B.belt); // the wall strip's inner face at its top
    // the outboard face's sample heights: the foot, the loft's ring vertices between, the top
    const zs = (x) => [zF, ...W.ring2(x).slice(0, 16).map((q) => q[1]).filter((z) => z > zF + 0.01 && z < zT - 0.01), zT];
    // one bin per 2.4 m or so, W.GAP apart (as before: a bin as long as the bay laid its screen box over every part of it)
    const n = Math.max(1, Math.round((xb - B.xa) / 2.4));
    const len = (xb - B.xa - (n - 1) * g) / n;
    for (const [s, sign] of W.SIDES) {
      for (let k = 0; k < n; k++) {
        const x0 = B.xa + k * (len + g);
        const x1 = k === n - 1 ? xb : x0 + len;
        const xs = [x0, ...W.RING_STATIONS.filter((x) => x > x0 + 1e-6 && x < x1 - 1e-6), x1];
        // the aisle face is one plane (its doors are drawn on it): BIN.depth inboard of the narrowest station's top
        const yIn = Math.min(...xs.map((x) => yo(x, zT))) - BIN.depth;
        const pts = [];
        for (const x of xs) {
          // foot on the wall strip (from its inner face out to the skin line), the outboard face up the loft, the top, the
          // aisle face with its rounded top edge, and the underside sloping from the aisle face down to the wall's inner face
          const prof = [[yw(x), zF], ...zs(x).map((z) => [yo(x, z), z]), [yIn + TOP_EDGE, zT], [yIn, zT - TOP_EDGE], [yIn, zU]];
          for (const [y, z] of prof) pts.push([x, sign * y, z]);
        }
        const name = `cabin.${bay.toLowerCase()}.bin.${s}.${k + 1}`;
        solid(name, bay, pts, { tone: "mid", material: "steel", kind: "bin", group: spec.group, cls: spec.cls(s) });
        const part = ctx.part(name);
        // the aisle face (vertical, at |y| = yIn), in dm from its top edge: the bin doors, about one per two window pitches,
        // each with its latch at the foot of the door (closed shapes: no line ends)
        const zA = zT - TOP_EDGE;
        const H = (zA - zU) * 10;
        const L = (x1 - x0) * 10;
        const m = Math.max(1, Math.round(L / 12.7));
        const pitch = L / m;
        let d = "";
        let kk = "";
        for (let i = 0; i < m; i++) {
          d += h.rr(i * pitch + 0.3, 0.35, pitch - 0.6, H - 0.7, 0.35);
          kk += h.rr(i * pitch + pitch / 2 - 0.7, H - 1.05, 1.4, 0.32, 0.12);
        }
        // the right side's face is drawn from aft (u = −x) so the plane's normal is its outward normal (u × v = n)
        const o = sign < 0 ? [x0, sign * yIn, zA] : [x1, sign * yIn, zA];
        face(part, { o, u: [sign < 0 ? 1 : -1, 0, 0], v: [0, 0, -1], n: [0, -sign, 0] }, h.line(d, "lo") + h.line(kk, "faint"));
        // the top: one closed panel inset from both long edges (the narrowest station's width)
        const yTop = yIn + TOP_EDGE;
        const wTop = Math.min(...xs.map((x) => yo(x, zT))) - yTop;
        if (wTop > 0.06) {
          const ya = sign < 0 ? -(yTop + wTop) : yTop;
          face(part, { o: [x0, ya, zT], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }, h.line(h.rr(0.4, 0.25, L - 0.8, wTop * 10 - 0.5, 0.15), "faint"));
        }
        rec.bins.push({ name, bay, side: s, group: spec.group, x: [x0, x1], z: [zF, zT], under: zU, yIn, depth: Math.min(...xs.map((x) => yo(x, zT))) - yIn, foot: xs.map((x) => [yw(x), yo(x, zF)]), loft: Math.min(...xs.flatMap((x) => zs(x).map((z) => WQ.ringY(x, z) - yo(x, z)))) });
      }
    }
    ctx.label(`cabin.${bay.toLowerCase()}.bin`, "Overhead bins · over the window seats, 1.6-2.1 m above the floor · they hang from the crown's structure and show once it has lifted", `inspect:${bay === "F" ? "first" : bay === "M" ? "main" : "upper"}`);
    // each side's alpha: the fade-in as the crown lifts past the bins (the cockpit's a3-fd does the same for the flight
    // deck), times the near-side cut. The near row's outboard face, turned toward the reader, stood over the near window
    // seats like a wall 0.8 m taller than the cut walls and hid a third of every bay's seats (verify captures, r1): while
    // a row's outboard face turns toward the reader (its normal · the view, from 0.2 to 0.6) it fades out, as a cutaway
    // drawing cuts the near side lower; the far row, and both rows seen along the fuselage, stay whole
    const table = JSON.stringify(W.CUTS[spec.channel].table);
    for (const [s, sign] of W.SIDES) {
      const facing = `(() => { const c = A3.controller; if (!c || !c.cams) return 0; const V = c.cams().world.V; const a = c.anchor("pitch", [0, 0, 0], [0, ${sign}, 0]); const d = a && a.direction; return d ? d[0] * V[0] + d[1] * V[1] + d[2] * V[2] : 0; })()`;
      ctx.vary(spec.cls(s), `F.smooth(${spec.above}, ${spec.above + (BIN.fade * W.UNIT) / 10}, F.tableAt(${table}, ch.cabin || 0, "smooth")) * (1 - F.smooth(${BIN.near[0]}, ${BIN.near[1]}, ${facing}))`);
      fades[spec.cls(s)] = [`^cabin\\.${bay.toLowerCase()}\\.bin\\.${s}\\.`];
    }
  }
  // a row faded under half is neither picked nor drawn into the GL mask (live.js merges DATA.mod.fades)
  ctx.data("fades", fades);

  // ---- the windows from inside: a reveal (the lining's window frame) and the pane round each window on the cut walls'
  // inner faces, now that no bin stands in front of them (r1, fidelity)
  {
    const win = M.WINDOWS;
    const hw = win.size.width / 2;
    for (const bay of ["F", "U", "M", "UY"]) {
      const B = BAY[bay];
      const c = W.CUT[bay];
      const deck = bay === "F" || bay === "M" ? "main" : "upper";
      const zc = c.floor + win.centreAboveFloor;
      const zTop = Math.min(zc + win.size.height / 2 + 0.04, c.walls[1] - 0.012);
      const zBot = zc - win.size.height / 2 - 0.04;
      // the windows clear of the bay's ends and of the M4 galley's side units (they stand against the walls from galleyX)
      const xEnd = Math.min(B.xb, spans[bay].x1 ?? B.xb) - hw - 0.08;
      const xs = win[deck].filter((x) => x - hw - 0.08 >= B.xa && x <= xEnd);
      for (const [s, sign] of W.SIDES) {
        const host = `${BAY_WALLS[bay]}.${s}`;
        for (const x of xs) {
          // the inner face's local frame at the window: P(x, z) = (x, sign · wallIn, z)
          const P = (xx, zz) => [xx, sign * WQ.wallIn(xx, zz, B.belt), zz];
          const o = P(x, zTop);
          const dz = W.vec.sub(P(x, zTop - 0.05), o);
          const dx = W.vec.sub(P(x + 0.05, zTop), o);
          const v = W.vec.unit(dz);
          let u = W.vec.unit(dx);
          let n = W.vec.unit(W.vec.cross(u, v));
          if (n[1] * sign > 0) {
            u = W.vec.mul(u, -1);
            n = W.vec.mul(n, -1);
          }
          const Hf = Math.hypot(...W.vec.sub(P(x, zBot), o)) * 10;
          const A = (hw + 0.04) * 10;
          const frame = h.rr(-A, 0, 2 * A, Hf, 0.9);
          const pane = h.rr(-hw * 10, 0.4, hw * 20, Hf - 0.8, 0.75);
          ctx.planeOn(host, { o: api.K(o), u: api.KD(u), v: api.KD(v), normal: api.KD(n), svg: h.line(frame, "lo") + `<path class="iso-line a3-win-in" data-tone="faint" d="${pane}"/>` });
        }
        rec.reveals.push({ bay, side: s, host, count: xs.length });
      }
    }
    ctx.css(`.iso{--a3-win-in:#c8d3dd}
.iso[data-theme="dark"]{--a3-win-in:#151a22}
.iso-line.a3-win-in{fill:var(--a3-win-in)}`);
  }

  // ---- bay-end fronts: pictures on the fixed pieces' end faces
  // r2 (craft-dark, major): the pictures were outlines only, in the shell's own tone (inside a trolley bay the same
  // luminance as the bare bulkhead, 34 by night), and read as a ghost wireframe beside the filled, lit M4 galley. They are
  // filled now: the galley block and its work deck in a cavity tone a step under the seats', the trolley bays a step
  // darker with lit handles, the curtains in a fabric tone, the closets and the lavatory doors in the lining's tone; the
  // lines stay as their edges. The planes sit on fus.B1 and fus.B2 (not cabin.* parts, so the painter bakes their
  // colours): the cabin dimmer reaches them as the doorways' does (skin.mjs), an overlay in --a3-cab-dim at its share
  const cabP = `((1 - Math.round(Math.pow(Math.max(0, Math.min(1, pv.cabinLight !== undefined ? pv.cabinLight : 1)), 0.66) * 12) / 12) * ${ctx.theme === "light" ? 0.35 : 0.5})`;
  ctx.vary("a3-bef-dim", cabP);
  const fillOf = (cls, d) => (d ? `<path class="${cls}" d="${d}"/>` : "");
  const dimOf = (d) => (d ? `<path class="a3-bef-dim" style="opacity:0" d="${d}"/>` : "");
  ctx.css(`.iso{--a3-bef-gal:#cdc7bc;--a3-bef-deck:#bdb6aa;--a3-bef-bay:#aea79b;--a3-bef-hdl:#e4dfd6;--a3-bef-cur:#a39ea8;--a3-bef-clo:#d4cfc6}
.iso[data-theme="dark"]{--a3-bef-gal:#46423c;--a3-bef-deck:#4f4b44;--a3-bef-bay:#3c3833;--a3-bef-hdl:#7d776d;--a3-bef-cur:#3d3944;--a3-bef-clo:#4a4741}
.a3-bef-gal{fill:var(--a3-bef-gal);stroke:none}
.a3-bef-deck{fill:var(--a3-bef-deck);stroke:none}
.a3-bef-bay{fill:var(--a3-bef-bay);stroke:none}
.a3-bef-hdl{fill:var(--a3-bef-hdl);stroke:none}
.a3-bef-cur{fill:var(--a3-bef-cur);stroke:none}
.a3-bef-clo{fill:var(--a3-bef-clo);stroke:none}
.a3-bef-dim{fill:var(--a3-cab-dim);stroke:var(--a3-cab-dim);stroke-width:.6px;stroke-linejoin:round}`);
  // the F bay's aft wall: fus.B1's forward face at x 15.8 (normal −x): the M2 galley front, the curtains in both aisles,
  // closets outboard
  {
    const B = BAY.F;
    const x = W.CUT.F.x[1] + 0.02; // 15.80: fus.B1's front face
    const zTop = B.top;
    const hw = Math.min(WQ.wallIn(B.xb, B.zc, "main"), WQ.wallIn(B.xb, zTop, "main")) - 0.02;
    const H = (zTop - B.zc) * 10;
    const X = (y) => (y + hw) * 10;
    let k = "";
    // the galley block (centre, ±1.15): four trolley bays and the work deck over them (the ovens are above the cut)
    const g0 = X(-1.15);
    const gw = 23;
    const gal = h.rr(g0, 0.3, gw, H - 0.3, 0.2);
    let bays = "";
    let hdl = "";
    for (let i = 0; i < 4; i++) {
      bays += h.rr(g0 + 0.5 + i * 5.5, H - 10.4, 5.1, 10.0, 0.3);
      hdl += h.rr(g0 + 0.5 + i * 5.5 + 1.8, H - 9.6, 1.5, 0.35, 0.12);
    }
    const deck = h.rr(g0 + 0.5, H - 11.2, gw - 1.0, 0.6, 0.1);
    // the aisle curtains (1.17-1.83 both sides): a closed drape, its pleats from rail to hem
    let cur = "";
    let clo = "";
    for (const s of [-1, 1]) {
      const a = X(s < 0 ? -1.83 : 1.17);
      cur += h.rr(a, 0.3, 6.6, H - 0.9, 0.3) + h.rr(a - 0.2, 0.0, 7.0, 0.3, 0.1);
      for (let i = 1; i < 6; i++) k += h.seg(a + i * 1.1, 0.3, a + i * 1.1, H - 0.6);
      // the closets outboard of the aisles, each with a door and a handle
      const c0 = s < 0 ? X(-hw + 0.05) : X(1.88);
      const cw = (hw - 1.93) * 10;
      if (cw > 2) {
        clo += h.rr(c0, 0.3, cw, H - 0.3, 0.3);
        k += h.rr(c0 + cw / 2 - 0.2, H * 0.45, 0.4, 1.4, 0.15);
      }
    }
    const svg = fillOf("a3-bef-gal", gal) + fillOf("a3-bef-bay", bays) + fillOf("a3-bef-deck", deck) + fillOf("a3-bef-hdl", hdl) + fillOf("a3-bef-cur", cur) + fillOf("a3-bef-clo", clo) + h.line(gal + bays + deck + cur + clo, "lo") + h.line(hdl + k, "faint") + dimOf(gal + cur + clo);
    ctx.planeOn("fus.B1", { o: api.K([x, -hw, zTop]), u: api.KD([0, 1, 0]), v: api.KD([0, 0, -1]), normal: api.KD([-1, 0, 0]), svg });
    rec.fronts.push({ bay: "F", end: "aft", host: "fus.B1", x, what: "M2 galley front, aisle curtains, closets (filled)" });
  }
  // the U bay's forward wall: fus.B2's aft face at x 23.5 (normal +x): the two U1 lavatory doors, curtains, closets
  {
    const B = BAY.U;
    const x = W.CUT.U.x[0] - 0.02; // 23.50
    const zTop = B.top;
    const hw = Math.min(WQ.wallIn(B.xa, B.zc + 0.3, "upper"), WQ.wallIn(B.xa, zTop, "upper")) - 0.02;
    const H = (zTop - B.zc) * 10;
    const X = (y) => (hw - y) * 10; // u = −y: seen from aft, starboard on the left
    let k = "";
    let lav = "";
    let sign = "";
    for (const [y0, y1] of [[-0.95, -0.02], [0.02, 0.95]]) {
      const a = X(y1);
      const w = (y1 - y0) * 10;
      lav += h.rr(a + 0.3, 0.3, w - 0.6, H - 0.3, 0.3);
      // the bi-fold door's hinge line, the vacant/occupied sign, the handle
      k += h.seg(a + w / 2, 0.3, a + w / 2, H);
      sign += h.rr(a + w / 2 - 1.4, 1.2, 2.8, 0.7, 0.2) + h.rr(a + w - 1.4, H * 0.45, 0.4, 1.2, 0.15);
    }
    let cur = "";
    let clo = "";
    for (const s of [-1, 1]) {
      const a = s > 0 ? X(1.25) : X(-0.98);
      cur += h.rr(a, 0.3, 2.7, H - 0.9, 0.3) + h.rr(a - 0.2, 0.0, 3.1, 0.3, 0.1);
      for (let i = 1; i < 3; i++) k += h.seg(a + i * 0.9, 0.3, a + i * 0.9, H - 0.6);
      const c0 = s > 0 ? X(hw - 0.05) : X(-1.3);
      const cw = (hw - 1.35) * 10;
      if (cw > 2) {
        clo += h.rr(c0, 0.3, cw, H - 0.3, 0.3);
        k += h.rr(c0 + cw / 2 - 0.2, H * 0.45, 0.4, 1.4, 0.15);
      }
    }
    const svg = fillOf("a3-bef-clo", lav) + fillOf("a3-bef-hdl", sign) + fillOf("a3-bef-cur", cur) + fillOf("a3-bef-clo", clo) + h.line(lav + cur + clo, "lo") + h.line(sign + k, "faint") + dimOf(lav + cur + clo);
    ctx.planeOn("fus.B2", { o: api.K([x, hw, zTop]), u: api.KD([0, -1, 0]), v: api.KD([0, 0, -1]), normal: api.KD([1, 0, 0]), svg });
    rec.fronts.push({ bay: "U", end: "fwd", host: "fus.B2", x, what: "U1 lavatory doors, aisle curtains, closets (filled)" });
  }
  return rec;
}

/** The M4 galley's counter tops (the faces the cutaway looks down on): work deck, sink, coffee makers, ovens' vents. */
export function galleyTops(api, part, t, x0, x1, y0, y1, zT) {
  const { face, h } = api;
  const L = (x1 - x0) * 10;
  const Wd = (y1 - y0) * 10;
  let d = h.rr(0.4, 0.4, L - 0.8, Wd - 0.8, 0.3);
  let k = "";
  if (t === "c") {
    k += h.circ(L * 0.3, Wd * 0.5, 1.1) + h.circ(L * 0.3, Wd * 0.5, 0.25);
    for (let i = 0; i < 3; i++) k += h.rr(L * 0.55 + i * 1.6 - 0.6, Wd * 0.5 - 1.8, 1.2, 1.4, 0.2) + h.rr(L * 0.55 + i * 1.6 - 0.6, Wd * 0.5 + 0.4, 1.2, 1.4, 0.2);
  } else {
    for (let i = 0; i < 3; i++) k += h.rr(1.0 + i * (L - 2) / 3, 1.0, (L - 2) / 3 - 0.6, Wd - 2.0, 0.2);
  }
  face(part, { o: [x0, y0, zT], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] }, h.line(d, "lo") + h.line(k, "faint"));
}
