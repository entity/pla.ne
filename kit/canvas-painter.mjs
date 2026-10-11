const CP_Q = 64;
const CP_SVG = "http://www.w3.org/2000/svg";

function cpScratch() {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  return c.getContext("2d");
}

function cpRgba(css, probe) {
  if (!css || css === "none" || css.startsWith("url(")) return null;
  probe.fillStyle = "#000";
  probe.fillStyle = css;
  const out = probe.fillStyle;
  if (out[0] === "#") return [parseInt(out.slice(1, 3), 16), parseInt(out.slice(3, 5), 16), parseInt(out.slice(5, 7), 16), 1];
  const nums = out.match(/-?[\d.]+(e-?\d+)?/g);
  if (!nums) return null;
  if (out.startsWith("color(")) {
    const v = nums.map(Number);
    return [v[0] * 255, v[1] * 255, v[2] * 255, v.length > 3 ? v[3] : 1];
  }
  const v = nums.map(Number);
  return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1];
}

// opaque colours as #rrggbb (a380 perf, kit-patches.md 24): the canvas parses a hex string about 45% faster than
// rgb(), and fillStyle and strokeStyle were a quarter of the painter's own time; the same colour
function cpCss(rgba, alpha = 1) {
  const a = rgba[3] * alpha;
  const r = Math.min(255, Math.max(0, Math.round(rgba[0])));
  const g = Math.min(255, Math.max(0, Math.round(rgba[1])));
  const b = Math.min(255, Math.max(0, Math.round(rgba[2])));
  if (a >= 1) return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  return `rgba(${r},${g},${b},${Math.round(a * 1000) / 1000})`;
}

function cpMatrixOf(text) {
  if (!text) return null;
  const nums = text.match(/-?[\d.]+(e-?\d+)?/g);
  if (!nums) return null;
  const v = nums.map(Number);
  if (text.startsWith("translate")) return [1, 0, 0, 1, v[0], v[1] ?? 0];
  if (text.startsWith("matrix")) return v;
  const m = new DOMMatrix(text);
  return [m.a, m.b, m.c, m.d, m.e, m.f];
}

function cpMul(A, B) {
  if (!A) return B;
  if (!B) return A;
  return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
}

function cpStaticMatrix(el) {
  const list = el.transform && el.transform.baseVal;
  if (!list || !list.numberOfItems) return null;
  const m = list.consolidate().matrix;
  return [m.a, m.b, m.c, m.d, m.e, m.f];
}

function cpGeometry(el) {
  const tag = el.localName;
  const num = (name) => parseFloat(el.getAttribute(name) ?? "0") || 0;
  if (tag === "path") return el.getAttribute("d") ? new Path2D(el.getAttribute("d")) : null;
  const p = new Path2D();
  if (tag === "circle") p.arc(num("cx"), num("cy"), num("r"), 0, Math.PI * 2);
  else if (tag === "ellipse") p.ellipse(num("cx"), num("cy"), num("rx"), num("ry"), 0, 0, Math.PI * 2);
  else if (tag === "rect") {
    const rx = num("rx") || num("ry");
    if (rx && p.roundRect) p.roundRect(num("x"), num("y"), num("width"), num("height"), rx);
    else p.rect(num("x"), num("y"), num("width"), num("height"));
  } else if (tag === "line") {
    p.moveTo(num("x1"), num("y1"));
    p.lineTo(num("x2"), num("y2"));
  } else if (tag === "polyline" || tag === "polygon") {
    const v = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
    for (let i = 0; i + 1 < v.length; i += 2) i ? p.lineTo(v[i], v[i + 1]) : p.moveTo(v[i], v[i + 1]);
    if (tag === "polygon") p.closePath();
  } else return null;
  return p;
}

// a380 perf (kit-patches.md 24): a static element's geometry as a command list, replayed into the current path under
// the plane's matrix and stroked after the matrix is reset (a non-scaling stroke without a transformed Path2D, whose
// addPath and DOMMatrix were a fifth of the painter's own time). Absolute commands: M, L, C, Q, E (an SVG arc as a
// canvas ellipse), Z. Null when the element has anything else (it keeps the Path2D route).
function cpArc(out, x1, y1, rx, ry, angle, large, sweep, x2, y2) {
  if (x1 === x2 && y1 === y2) return;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (!rx || !ry) {
    out.push(["L", x2, y2]);
    return;
  }
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy;
  const yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const den = rx * rx * yp * yp + ry * ry * xp * xp;
  const coef = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * yp) / ry;
  const cyp = (-coef * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = ang(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = ang((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  out.push(["E", cx, cy, rx, ry, phi, t1, t1 + dt, sweep ? 0 : 1]);
}

function cpPathCommands(d) {
  const tokens = d.match(/[A-Za-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g);
  if (!tokens) return null;
  const out = [];
  let i = 0;
  let cmd = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let cx2 = null;
  let cy2 = null;
  let qx = null;
  let qy = null;
  const num = () => {
    const t = tokens[i++];
    if (t === undefined || /[A-Za-z]/.test(t)) throw new Error("path");
    return Number(t);
  };
  // an arc flag may be packed with the next number ("01" is two flags in some writers)
  const flag = () => {
    const t = tokens[i];
    if (t === "0" || t === "1") {
      i++;
      return Number(t);
    }
    if (/^[01]\d/.test(t)) {
      tokens[i] = t.slice(1);
      return Number(t[0]);
    }
    throw new Error("flag");
  };
  try {
    while (i < tokens.length) {
      if (/[A-Za-z]/.test(tokens[i])) cmd = tokens[i++];
      else if (cmd === null) return null;
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      if (C === "Z") {
        out.push(["Z"]);
        x = sx;
        y = sy;
        cx2 = qx = null;
        if (i < tokens.length && !/[A-Za-z]/.test(tokens[i])) return null;
        continue;
      }
      if (C === "M") {
        x = (rel ? x : 0) + num();
        y = (rel ? y : 0) + num();
        sx = x;
        sy = y;
        out.push(["M", x, y]);
        cmd = rel ? "l" : "L";
        cx2 = qx = null;
      } else if (C === "L") {
        x = (rel ? x : 0) + num();
        y = (rel ? y : 0) + num();
        out.push(["L", x, y]);
        cx2 = qx = null;
      } else if (C === "H") {
        x = (rel ? x : 0) + num();
        out.push(["L", x, y]);
        cx2 = qx = null;
      } else if (C === "V") {
        y = (rel ? y : 0) + num();
        out.push(["L", x, y]);
        cx2 = qx = null;
      } else if (C === "C" || C === "S") {
        let x1;
        let y1;
        if (C === "C") {
          x1 = (rel ? x : 0) + num();
          y1 = (rel ? y : 0) + num();
        } else {
          x1 = cx2 === null ? x : 2 * x - cx2;
          y1 = cy2 === null ? y : 2 * y - cy2;
        }
        const x2 = (rel ? x : 0) + num();
        const y2 = (rel ? y : 0) + num();
        const ex = (rel ? x : 0) + num();
        const ey = (rel ? y : 0) + num();
        out.push(["C", x1, y1, x2, y2, ex, ey]);
        cx2 = x2;
        cy2 = y2;
        qx = null;
        x = ex;
        y = ey;
      } else if (C === "Q" || C === "T") {
        let x1;
        let y1;
        if (C === "Q") {
          x1 = (rel ? x : 0) + num();
          y1 = (rel ? y : 0) + num();
        } else {
          x1 = qx === null ? x : 2 * x - qx;
          y1 = qy === null ? y : 2 * y - qy;
        }
        const ex = (rel ? x : 0) + num();
        const ey = (rel ? y : 0) + num();
        out.push(["Q", x1, y1, ex, ey]);
        qx = x1;
        qy = y1;
        cx2 = null;
        x = ex;
        y = ey;
      } else if (C === "A") {
        const rx = num();
        const ry = num();
        const angle = num();
        const large = flag();
        const sweep = flag();
        const ex = (rel ? x : 0) + num();
        const ey = (rel ? y : 0) + num();
        cpArc(out, x, y, rx, ry, angle, large, sweep, ex, ey);
        x = ex;
        y = ey;
        cx2 = qx = null;
      } else return null;
    }
  } catch {
    return null;
  }
  return out;
}

function cpCommands(el) {
  const tag = el.localName;
  const num = (name) => parseFloat(el.getAttribute(name) ?? "0") || 0;
  if (tag === "path") return el.getAttribute("d") ? cpPathCommands(el.getAttribute("d")) : null;
  if (tag === "circle") return [["E", num("cx"), num("cy"), num("r"), num("r"), 0, 0, Math.PI * 2, 0]];
  if (tag === "ellipse") return [["E", num("cx"), num("cy"), num("rx"), num("ry"), 0, 0, Math.PI * 2, 0]];
  if (tag === "line") return [["M", num("x1"), num("y1")], ["L", num("x2"), num("y2")]];
  if (tag === "rect" && !(num("rx") || num("ry"))) {
    const x = num("x");
    const y = num("y");
    const w = num("width");
    const h = num("height");
    return [["M", x, y], ["L", x + w, y], ["L", x + w, y + h], ["L", x, y + h], ["Z"]];
  }
  return null;
}

// r2-perf (kit-patches.md 34): a static element's commands as one flat program, each command an opcode (1 M, 2 L, 3 C,
// 4 Q, 5 E, 6 Z) and its numbers, replayed without an array per command and a string compare per command (the same
// canvas calls with the same numbers as the command arrays gave)
function cpProgram(cmds) {
  if (!cmds) return null;
  let n = 0;
  for (const c of cmds) n += c.length;
  const prog = new Float64Array(n);
  let at = 0;
  for (const c of cmds) {
    const k = c[0];
    prog[at++] = k === "M" ? 1 : k === "L" ? 2 : k === "C" ? 3 : k === "Q" ? 4 : k === "E" ? 5 : 6;
    for (let i = 1; i < c.length; i++) prog[at++] = c[i];
  }
  return prog;
}

function cpReplayProgram(ctx, prog) {
  ctx.beginPath();
  const n = prog.length;
  let i = 0;
  while (i < n) {
    const k = prog[i];
    if (k === 2) {
      ctx.lineTo(prog[i + 1], prog[i + 2]);
      i += 3;
    } else if (k === 1) {
      ctx.moveTo(prog[i + 1], prog[i + 2]);
      i += 3;
    } else if (k === 4) {
      ctx.quadraticCurveTo(prog[i + 1], prog[i + 2], prog[i + 3], prog[i + 4]);
      i += 5;
    } else if (k === 3) {
      ctx.bezierCurveTo(prog[i + 1], prog[i + 2], prog[i + 3], prog[i + 4], prog[i + 5], prog[i + 6]);
      i += 7;
    } else if (k === 5) {
      ctx.ellipse(prog[i + 1], prog[i + 2], prog[i + 3], prog[i + 4], prog[i + 5], prog[i + 6], prog[i + 7], prog[i + 8] === 1);
      i += 9;
    } else {
      ctx.closePath();
      i += 1;
    }
  }
}

function cpStyle(el, probe) {
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden") return null;
  const fill = cpRgba(cs.fill, probe);
  const stroke = cpRgba(cs.stroke, probe);
  const fillOpacity = parseFloat(cs.fillOpacity);
  const strokeOpacity = parseFloat(cs.strokeOpacity);
  const dash = cs.strokeDasharray && cs.strokeDasharray !== "none" ? cs.strokeDasharray.split(/[\s,]+/).map(parseFloat).filter((v) => !Number.isNaN(v)) : null;
  return {
    cs,
    fill: fill ? cpCss(fill, isNaN(fillOpacity) ? 1 : fillOpacity) : null,
    fillRaw: fill ? cpCss(fill) : null,
    stroke: stroke ? cpCss(stroke, isNaN(strokeOpacity) ? 1 : strokeOpacity) : null,
    width: parseFloat(cs.strokeWidth) || 0,
    cap: cs.strokeLinecap || "butt",
    join: cs.strokeLinejoin || "miter",
    miter: parseFloat(cs.strokeMiterlimit) || 4,
    dash,
    dashOffset: parseFloat(cs.strokeDashoffset) || 0,
    rule: cs.fillRule === "evenodd" ? "evenodd" : "nonzero",
    opacity: parseFloat(cs.opacity),
    nonScaling: cs.vectorEffect === "non-scaling-stroke",
    // a380 fu/f3-lights: an element's CSS mix-blend-mode screen (a glow on a dark page, as its WebGL canvas composites)
    // is painted with the canvas's "screen" composite (static paths only, flat kind 5); any other mode paints as before
    blend: cs.mixBlendMode === "screen" ? "screen" : null,
    // a380 fu/f4-lights: a <circle> filled with a url(#radialGradient) (objectBoundingBox units, centred) is painted with a
    // canvas radial gradient of the same stops (a soft glow in one fill; before, a url() fill painted nothing)
    grad: fill === null ? cpGradientOf(el, cs, probe) : null,
  };
}

// a380 fu/f4-lights: { cx, cy, r, stops: [[offset, css]] } for a circle whose computed fill is url(#id) naming a
// <radialGradient> with the default units and centre, else null (any other url() fill paints nothing, as before)
function cpGradientOf(el, cs, probe) {
  if (el.localName !== "circle" || !cs.fill || !cs.fill.startsWith("url(")) return null;
  const m = /url\(\s*["']?#([^"')]+)["']?\s*\)/.exec(cs.fill);
  const g = m && el.ownerDocument ? el.ownerDocument.getElementById(m[1]) : null;
  if (!g || g.localName !== "radialGradient") return null;
  for (const at of ["gradientUnits", "gradientTransform", "cx", "cy", "r", "fx", "fy", "href", "xlink:href"]) if (g.hasAttribute(at)) return null;
  const fo = parseFloat(cs.fillOpacity);
  const stops = [];
  for (const st of g.children) {
    if (st.localName !== "stop") continue;
    const scs = getComputedStyle(st);
    const rgba = cpRgba(scs.stopColor, probe);
    if (!rgba) return null;
    const so = parseFloat(scs.stopOpacity);
    const off = parseFloat(st.getAttribute("offset") ?? "0");
    stops.push([Math.min(1, Math.max(0, off)), cpCss(rgba, (isNaN(so) ? 1 : so) * (isNaN(fo) ? 1 : fo))]);
  }
  if (!stops.length) return null;
  const num = (n) => parseFloat(el.getAttribute(n) ?? "0") || 0;
  return { cx: num("cx"), cy: num("cy"), r: num("r"), stops };
}
function cpGradient(ctx, G) {
  const g = ctx.createRadialGradient(G.cx, G.cy, 0, G.cx, G.cy, G.r);
  for (const [o, c] of G.stops) g.addColorStop(o, c);
  return g;
}

function cpCompilePart(node, run, probe, unsupported, vary) {
  const ops = [];
  const roleOf = (el) => {
    const name = el === node ? "move" : el.getAttribute("data-r");
    if (name === null || run.role[name] === undefined) return -1;
    return run.role[name];
  };
  const varyOf = (el) => {
    if (!vary || !el.classList) return null;
    for (const cls of el.classList) if (vary[cls]) return vary[cls];
    return null;
  };
  const walk = (el, chain, alphaRoles, alpha, varies = []) => {
    const varied = varyOf(el);
    const ownVaries = varied ? varies.concat([varied]) : varies;
    const r = roleOf(el);
    const type = r >= 0 ? run.roles[r].type : null;
    const tag = el.localName;
    let nextChain = chain;
    if (type === "self" || type === "plane" || type === "xform") nextChain = chain.concat([{ r }]);
    else {
      const m = el === node ? null : cpStaticMatrix(el);
      if (m) nextChain = chain.concat([{ m }]);
      // kit patch 11 (a380 perf): a <g data-spin="key"> turns at paint time by the painter's spin(key, angle)
      const spin = el !== node && el.getAttribute ? el.getAttribute("data-spin") : null;
      if (spin) nextChain = nextChain.concat([{ spin }]);
    }
    if (tag === "g" || tag === "svg") {
      let groupAlpha = alpha;
      let groupRoles = alphaRoles;
      if (type === "plane") groupRoles = alphaRoles.concat([r]);
      else if (varied) {
      } else if (el !== node) {
        const op = parseFloat(getComputedStyle(el).opacity);
        if (!Number.isNaN(op)) groupAlpha *= op;
      }
      for (const child of el.children) walk(child, nextChain, groupRoles, groupAlpha, ownVaries);
      return;
    }
    if (tag === "title" || tag === "desc") return;
    const style = cpStyle(el, probe);
    if (!style) return;
    let ownAlpha = alpha;
    let ownRoles = alphaRoles;
    if (type === "slot") ownRoles = alphaRoles.concat([r]);
    else if (!varied && !Number.isNaN(style.opacity)) ownAlpha *= style.opacity;
    const op = { tag, r, type, chain: nextChain, alpha: ownAlpha, alphaRoles: ownRoles, varies: ownVaries, style, path: null, size: 0, last: null };
    if (type === "face") {
      const cs = style.cs;
      op.ramp = [0, 1, 2, 3, 4].map((i) => cpRgba(cs.getPropertyValue(`--tn-${i}`).trim(), probe) ?? [0, 0, 0, 1]);
      op.rampKey = op.ramp.map((c) => c.join(",")).join("|");
      op.baseWidth = style.width;
    } else if (type === "dot") {
      op.size = parseFloat(el.getAttribute("r")) || 0.5;
    } else if (type === "path" || type === "slot") {
    } else if (tag === "text") {
      const cs = style.cs;
      op.text = el.textContent;
      op.x = parseFloat(el.getAttribute("x") ?? "0") || 0;
      op.y = parseFloat(el.getAttribute("y") ?? "0") || 0;
      op.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      op.align = cs.textAnchor === "middle" ? "center" : cs.textAnchor === "end" ? "right" : "left";
      op.spacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
      op.baseline = cs.dominantBaseline === "central" || cs.dominantBaseline === "middle" ? "middle" : cs.dominantBaseline === "hanging" ? "hanging" : "alphabetic";
    } else {
      op.path = cpGeometry(el);
      if (!op.path) {
        unsupported.add(tag);
        return;
      }
      op.cmds = style.nonScaling && style.stroke ? cpCommands(el) : null;
    }
    ops.push(op);
  };
  walk(node, [], [], 1);
  return ops;
}

function cpTrace(ctx, d, arena) {
  ctx.beginPath();
  for (let i = 0; i + 4 < d.length; i += 5) {
    const at = 2 * (d.charCodeAt(i + 1) | (d.charCodeAt(i + 2) << 16));
    const count = d.charCodeAt(i + 3);
    ctx.moveTo(arena[at], arena[at + 1]);
    for (let k = 1; k < count; k++) ctx.lineTo(arena[at + 2 * k], arena[at + 2 * k + 1]);
    if (d.charCodeAt(i + 4)) ctx.closePath();
  }
}

// kit patch 24 (a380 perf, grown faces): an opaque face is filled and then stroked in its own colour, the stroke only
// hiding the seams between faces. Its union is the face grown by half the stroke width, so one fill of the grown
// outline draws the same picture with one canvas op instead of two (the stroke was half the GPU process's raster
// time). A convex vertex gets the miter point when it turns by at most 90°, else two (the round join's arc split in
// two; either lies outside the arc by at most 0.41 of the half width); a vertex turning back by up to about 25°
// (rounding) gets its miter point too. Every subpath is written counterclockwise, so overlapping grown neighbours
// add under the nonzero rule. A subpath that is open, has under three distinct points or turns back more is traced
// as it is and listed in `left` (the caller strokes those after the fill, as before).
const cpGrow = { x: new Float64Array(256), y: new Float64Array(256), nx: new Float64Array(256), ny: new Float64Array(256) };

function cpGrowOne(ctx, arena, at, count, r) {
  if (cpGrow.x.length < count) Object.assign(cpGrow, { x: new Float64Array(2 * count), y: new Float64Array(2 * count), nx: new Float64Array(2 * count), ny: new Float64Array(2 * count) });
  const g = cpGrow;
  const X = g.x;
  const Y = g.y;
  let n = 0;
  for (let k = 0; k < count; k++) {
    const x = arena[at + 2 * k];
    const y = arena[at + 2 * k + 1];
    if (n > 0 && Math.abs(x - X[n - 1]) < 1e-9 && Math.abs(y - Y[n - 1]) < 1e-9) continue;
    X[n] = x;
    Y[n] = y;
    n++;
  }
  while (n > 1 && Math.abs(X[n - 1] - X[0]) < 1e-9 && Math.abs(Y[n - 1] - Y[0]) < 1e-9) n--;
  if (n < 3) return false;
  let area = 0;
  for (let k = 0; k < n; k++) {
    const j = k + 1 === n ? 0 : k + 1;
    area += X[k] * Y[j] - X[j] * Y[k];
  }
  if (!(Math.abs(area) > 1e-9)) return false;
  const s = area > 0 ? 1 : -1;
  const NX = g.nx;
  const NY = g.ny;
  for (let k = 0; k < n; k++) {
    const j = k + 1 === n ? 0 : k + 1;
    const dx = X[j] - X[k];
    const dy = Y[j] - Y[k];
    const l = Math.sqrt(dx * dx + dy * dy);
    NX[k] = (s * dy) / l;
    NY[k] = (-s * dx) / l;
  }
  // the turn at each vertex: a convex one turns with the outline's sense; one turning back by more than about 25° is
  // left to the stroke
  for (let k = 0; k < n; k++) {
    const p = k === 0 ? n - 1 : k - 1;
    const turn = NX[p] * NY[k] - NY[p] * NX[k];
    if (turn * s < 0 && NX[p] * NX[k] + NY[p] * NY[k] < 0.9) return false;
  }
  // written counterclockwise (positive area): forwards when s > 0, backwards otherwise
  let first = true;
  for (let step = 0; step < n; step++) {
    const k = s > 0 ? step : n - 1 - step;
    const p = k === 0 ? n - 1 : k - 1;
    const ax = NX[p];
    const ay = NY[p];
    const bx = NX[k];
    const by = NY[k];
    const c = ax * bx + ay * by;
    const px = X[k];
    const py = Y[k];
    if (c >= 0) {
      // one miter point (a convex turn of at most 90°, or a slight turn back)
      const q = r / (1 + c);
      const qx = px + (ax + bx) * q;
      const qy = py + (ay + by) * q;
      if (first) ctx.moveTo(qx, qy);
      else ctx.lineTo(qx, qy);
      first = false;
      continue;
    }
    // a sharp convex turn: the arc split at its middle direction h, each half by its miter point
    let hx = ax + bx;
    let hy = ay + by;
    let hl = Math.sqrt(hx * hx + hy * hy);
    if (hl < 1e-6) {
      // a spike: the middle direction is along the incoming edge
      hx = -ay * s;
      hy = ax * s;
      hl = 1;
    }
    hx /= hl;
    hy /= hl;
    const ca = ax * hx + ay * hy;
    const cb = bx * hx + by * hy;
    const fa = r / (1 + ca);
    const fb = r / (1 + cb);
    const p1x = px + (ax + hx) * fa;
    const p1y = py + (ay + hy) * fa;
    const p2x = px + (hx + bx) * fb;
    const p2y = py + (hy + by) * fb;
    // in the written order the incoming edge's normal comes first
    if (s > 0) {
      if (first) ctx.moveTo(p1x, p1y);
      else ctx.lineTo(p1x, p1y);
      ctx.lineTo(p2x, p2y);
    } else {
      if (first) ctx.moveTo(p2x, p2y);
      else ctx.lineTo(p2x, p2y);
      ctx.lineTo(p1x, p1y);
    }
    first = false;
  }
  ctx.closePath();
  return true;
}

function cpTraceGrow(ctx, d, arena, r, left) {
  ctx.beginPath();
  let nLeft = 0;
  for (let i = 0; i + 4 < d.length; i += 5) {
    const at = 2 * (d.charCodeAt(i + 1) | (d.charCodeAt(i + 2) << 16));
    const count = d.charCodeAt(i + 3);
    const closed = d.charCodeAt(i + 4);
    if (closed && count >= 3 && cpGrowOne(ctx, arena, at, count, r)) continue;
    // traced as it is, counterclockwise like the grown ones, and stroked after the fill
    let area = 0;
    for (let k = 0; k < count; k++) {
      const j = k + 1 === count ? 0 : k + 1;
      area += arena[at + 2 * k] * arena[at + 2 * j + 1] - arena[at + 2 * j] * arena[at + 2 * k + 1];
    }
    if (area >= 0) {
      ctx.moveTo(arena[at], arena[at + 1]);
      for (let k = 1; k < count; k++) ctx.lineTo(arena[at + 2 * k], arena[at + 2 * k + 1]);
    } else {
      ctx.moveTo(arena[at + 2 * count - 2], arena[at + 2 * count - 1]);
      for (let k = count - 2; k >= 0; k--) ctx.lineTo(arena[at + 2 * k], arena[at + 2 * k + 1]);
    }
    if (closed) ctx.closePath();
    left[nLeft++] = i;
  }
  return nLeft;
}

function cpTraceLeft(ctx, d, arena, left, nLeft) {
  ctx.beginPath();
  for (let q = 0; q < nLeft; q++) {
    const i = left[q];
    const at = 2 * (d.charCodeAt(i + 1) | (d.charCodeAt(i + 2) << 16));
    const count = d.charCodeAt(i + 3);
    ctx.moveTo(arena[at], arena[at + 1]);
    for (let k = 1; k < count; k++) ctx.lineTo(arena[at + 2 * k], arena[at + 2 * k + 1]);
    if (d.charCodeAt(i + 4)) ctx.closePath();
  }
}

const cpScratchMatrix = typeof DOMMatrix === "function" ? new DOMMatrix() : null;

function cpMount(stage, controller, options = {}) {
  return cpMountWith(stage, controller, options, null);
}

// a380 follow-up r1 (kit-patches.md 31): the same mount with the part compile cut into tasks of about `chunk` parts (on
// a phone at 4x CPU the one-task compile was 1.1 s); resolves to the painter. Nothing is drawn until it resolves
async function cpMountAsync(stage, controller, options = {}) {
  const chunk = options.chunk ?? 40;
  const yieldTask = () => new Promise((done) => setTimeout(done, 0));
  const pending = [];
  const painter = cpMountWith(stage, controller, options, pending);
  for (let at = 0; at < pending.length; at += chunk) {
    await yieldTask();
    for (const job of pending.slice(at, at + chunk)) job();
  }
  await yieldTask();
  painter._finish();
  return painter;
}

function cpMountWith(stage, controller, { keepSvg = false, vary = null, only = null, effects = null, below = null, mask = null, maxRatio = Infinity, grownFaces = true, context = null } = {}, deferred = null) {
  // kit patch 14: the backing store's pixel ratio may be capped (raster cost goes with its square)
  let ratioCap = maxRatio;
  const ratioOf = () => Math.min(ratioCap, window.devicePixelRatio || 1);
  const probe = cpScratch();
  const scene = () => controller.scene();
  const unsupported = new Set();
  const layers = [];
  const programs = [];
  const wanted = only ?? controller.canvasLayers ?? null;
  const svgs = [...stage.querySelectorAll("svg[data-live]")].filter((svg) => !wanted || wanted.includes(svg.dataset.live));
  const first = svgs[0];
  const vb = first.viewBox.baseVal;
  const W = vb.width;
  const H = vb.height;
  const runs = scene().runs;
  const t0 = performance.now();
  // set once the drawing ops can be flattened (after the mount's own compile; a deferred compile flattens each part)
  let flatten = null;
  let spinOf = null;
  for (const svg of svgs) {
    const name = svg.dataset.live;
    const canvas = document.createElement("canvas");
    canvas.className = "iso-layer iso-canvas";
    canvas.dataset.canvasLive = name;
    canvas.setAttribute("aria-hidden", "true");
    svg.before(canvas);
    // f3-painter: `context` (canvas → a 2D context or a look-alike: kit/gl-painter.mjs) draws the layer elsewhere
    const ctx = context ? context(canvas) : canvas.getContext("2d", { alpha: true, desynchronized: false });
    const container = svg.querySelector(".iso-parts") ?? svg;
    for (const node of container.querySelectorAll(":scope > [data-p]")) {
      const index = Number(node.dataset.p);
      const effect = effects && effects[runs[index].name];
      // kit patch 11: an effect function keeps the part's compiled drawing as its base, drawn by the drawBase() it receives
      const job = () => {
        const ops = effect === false ? [] : effect ? [{ effect, base: cpCompilePart(node, runs[index], probe, unsupported, vary) }] : cpCompilePart(node, runs[index], probe, unsupported, vary);
        programs[index] = flatten ? ops.map(flatten) : ops;
        if (spinOf) spinOf(index);
      };
      if (deferred) deferred.push(job);
      else job();
    }
    layers.push({ name, canvas, ctx, svg });
  }
  let compileMs = performance.now() - t0;
  let effectRuns = [];
  const findEffectRuns = () => {
    effectRuns = effects ? runs.filter((run) => typeof effects[run.name] === "function" && effects[run.name].always !== false && programs[run.index]).map((run) => run.index) : [];
  };
  const view = { zoom: 1, cx: W / 2, cy: H / 2 };
  let cssPerUnit = 1;
  let dpr = ratioOf();
  let base = [1, 0, 0, 1, 0, 0];
  // a380 follow-up r1 (kit-patches.md 31): the stage box is measured on mount, on a resize (ResizeObserver) and on a
  // DPR change only; a view change (setView, every frame while an Inspect view follows its anchor) reuses it, so it
  // forces no layout (getBoundingClientRect was 30% of the busy main thread in the Deck plan on a phone)
  let box = null;
  let fit = 1;
  const measure = () => {
    const b = stage.getBoundingClientRect();
    box = { left: b.left, top: b.top, width: b.width, height: b.height };
  };
  const placeView = () => {
    const cssW = box.width;
    const cssH = box.height;
    const snapX = box.left - Math.round(box.left);
    const snapY = box.top - Math.round(box.top);
    fit = Math.min(cssW / W, cssH / H);
    const offX = (cssW - W * fit) / 2;
    const offY = (cssH - H * fit) / 2;
    const s = fit * view.zoom;
    cssPerUnit = s;
    const tx = offX + (W / 2) * fit - view.cx * s;
    const ty = offY + (H / 2) * fit - view.cy * s;
    base = [s * dpr, 0, 0, s * dpr, (tx + snapX) * dpr, (ty + snapY) * dpr];
    // r2-perf (kit-patches.md 36): the controller emits in part the canvas runs wholly outside this canvas (with the 4
    // units drawRun's own test allows); drawRun completes one first (a view that moved since the set())
    if (controller.cull && layers.length) {
      let cw = 0;
      let ch = 0;
      for (const layer of layers) {
        cw = Math.max(cw, layer.canvas.width);
        ch = Math.max(ch, layer.canvas.height);
      }
      const x0 = -base[4] / base[0];
      const y0 = -base[5] / base[3];
      const x1 = (cw - base[4]) / base[0];
      const y1 = (ch - base[5]) / base[3];
      controller.cull({ x0: x0 - 4, y0: y0 - 4, x1: x1 + 4, y1: y1 + 4 });
    }
    const unit = Math.round(Math.pow(2, Math.round(Math.log2(s) * 4) / 4) * 100) / 100;
    if (controller.setUnit) controller.setUnit(unit);
  };
  const resize = (remeasure = true) => {
    forceFull = true;
    if (remeasure || !box) measure();
    dpr = ratioOf();
    const snapX = box.left - Math.round(box.left);
    const snapY = box.top - Math.round(box.top);
    const boxW = Math.ceil(box.width + snapX - 1e-6);
    const boxH = Math.ceil(box.height + snapY - 1e-6);
    const w = Math.max(1, Math.round(boxW * dpr));
    const h = Math.max(1, Math.round(boxH * dpr));
    for (const layer of layers) {
      if (layer.canvas.width !== w) layer.canvas.width = w;
      if (layer.canvas.height !== h) layer.canvas.height = h;
      layer.canvas.style.width = `${boxW}px`;
      layer.canvas.style.height = `${boxH}px`;
      layer.canvas.style.left = `${-snapX}px`;
      layer.canvas.style.top = `${-snapY}px`;
    }
    placeView();
  };
  const faceCache = new Map();
  const faceColour = (op, q) => {
    let table = faceCache.get(op.rampKey);
    if (!table) {
      table = new Array(4 * CP_Q + 1);
      faceCache.set(op.rampKey, table);
    }
    let css = table[q];
    if (css === undefined) {
      const band = Math.min(3, Math.floor(q / CP_Q));
      const f = (q - CP_Q * band) / CP_Q;
      const a = op.ramp[band];
      const b = op.ramp[band + 1];
      css = cpCss([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f]);
      table[q] = css;
    }
    return css;
  };
  const stats = { ms: 0, ops: 0, paths: 0, parsed: 0, touched: 0, rects: 0, full: 0, left: 0 };
  let growOn = grownFaces;
  let growLeft = new Int32Array(1024);
  let tintTest = null;
  let tintRuns = null;
  let tintRgb = null;
  let tintP = 0;
  let tintKey = "";
  const tintCache = new Map();
  const tintedTable = (op) => {
    const key = `${op.rampKey}|${tintKey}`;
    let table = tintCache.get(key);
    if (!table) {
      table = new Array(4 * CP_Q + 1);
      for (let q = 0; q <= 4 * CP_Q; q++) {
        const band = Math.min(3, Math.floor(q / CP_Q));
        const f = (q - CP_Q * band) / CP_Q;
        const a = op.ramp[band];
        const b = op.ramp[band + 1];
        const c = [0, 1, 2, 3].map((k) => a[k] + (b[k] - a[k]) * f);
        table[q] = cpCss([0, 1, 2].map((k) => c[k] * (1 - tintP) + tintRgb[k] * tintP).concat([c[3]]));
      }
      tintCache.set(key, table);
    }
    return table;
  };
  const lastBox = [];
  let painted = false;
  const PAD = 3;
  const rectsOf = (frames, emitted) => {
    const list = [];
    const pad = PAD / cssPerUnit;
    for (const index of emitted) {
      const b = frames[index].box;
      const old = lastBox[index];
      let x0 = b[0];
      let y0 = b[1];
      let x1 = b[2];
      let y1 = b[3];
      if (old) {
        x0 = Math.min(x0, old[0]);
        y0 = Math.min(y0, old[1]);
        x1 = Math.max(x1, old[2]);
        y1 = Math.max(y1, old[3]);
      }
      if (!(x1 >= x0)) continue;
      list.push([x0 - pad, y0 - pad, x1 + pad, y1 + pad]);
    }
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < list.length && !merged; i++)
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const c = list[j];
          if (a[0] <= c[2] && c[0] <= a[2] && a[1] <= c[3] && c[1] <= a[3]) {
            list[i] = [Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.max(a[2], c[2]), Math.max(a[3], c[3])];
            list.splice(j, 1);
            merged = true;
            break;
          }
        }
    }
    return list.map(([x0, y0, x1, y1]) => {
      const dx0 = Math.floor(base[0] * x0 + base[4]);
      const dy0 = Math.floor(base[3] * y0 + base[5]);
      const dx1 = Math.ceil(base[0] * x1 + base[4]);
      const dy1 = Math.ceil(base[3] * y1 + base[5]);
      return { dx0, dy0, dx1, dy1, x0: (dx0 - base[4]) / base[0] - pad, y0: (dy0 - base[5]) / base[3] - pad, x1: (dx1 - base[4]) / base[0] + pad, y1: (dy1 - base[5]) / base[3] + pad };
    });
  };
  const keepBoxes = (frames, list) => {
    for (const index of list) {
      const b = frames[index].box;
      const slot = lastBox[index] ?? (lastBox[index] = new Float64Array(4));
      slot[0] = b[0];
      slot[1] = b[1];
      slot[2] = b[2];
      slot[3] = b[3];
    }
  };
  const pathOf = (op, d) => {
    if (op.last === d) return op.path;
    op.last = d;
    op.path = d ? new Path2D(d) : null;
    stats.parsed++;
    return op.path;
  };
  const linkMatrix = (link, f) => {
    if (link.m) return link.m;
    if (link.spin) return spins.get(link.spin) ?? null;
    const t = f.t[link.r];
    if (t === "\u0002") return f.tm[link.r];
    return cpMatrixOf(t);
  };
  const spins = new Map();
  const chainMatrix = (chain, f) => {
    if (chain.length === 1) return linkMatrix(chain[0], f);
    let M = null;
    for (let i = 0; i < chain.length; i++) {
      const m = linkMatrix(chain[i], f);
      if (m) M = cpMul(M, m);
    }
    return M;
  };
  const tableOf = (op) => {
    let table = faceCache.get(op.rampKey);
    if (!table) {
      table = new Array(4 * CP_Q + 1);
      for (let q = 0; q <= 4 * CP_Q; q++) {
        const band = Math.min(3, Math.floor(q / CP_Q));
        const f = (q - CP_Q * band) / CP_Q;
        const a = op.ramp[band];
        const b = op.ramp[band + 1];
        table[q] = cpCss([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f]);
      }
      faceCache.set(op.rampKey, table);
    }
    return table;
  };
  // r2-perf (kit-patches.md 37): the fields drawRun reads for every op first, the rest after (one op was 34 fields over
  // five cache lines, and drawRun's loads of them were a third of its own time)
  const flat = (op) => ({
    kind: op.effect ? 4 : op.tag === "text" ? 3 : op.type === "dot" ? 2 : op.type === "path" || op.type === "slot" || op.type === "face" ? 1 : op.style && op.style.blend ? 5 : 0, // fu/f3-lights: 5, a static path screened
    alpha: op.alpha ?? 1,
    roles: op.alphaRoles && op.alphaRoles.length ? Int32Array.from(op.alphaRoles) : null,
    varies: op.varies && op.varies.length ? op.varies : null,
    r: op.r ?? -1,
    face: op.type === "face",
    table: op.type === "face" ? tableOf(op) : null,
    fill: op.style ? (op.type === "dot" ? op.style.fillRaw : op.style.fill) : null,
    stroke: op.style ? op.style.stroke : null,
    width: op.style ? op.style.width : 0,
    chain: op.chain && op.chain.length ? op.chain : null,
    growable: op.type === "face" && !(op.style && op.style.rule === "evenodd") && !(op.style && op.style.dash),
    nonScaling: Boolean(op.style && op.style.nonScaling),
    evenodd: Boolean(op.style && op.style.rule === "evenodd"),
    path: op.path ?? null,
    prog: op.cmds ? cpProgram(op.cmds) : null,
    cap: op.style ? op.style.cap : "butt",
    join: op.style ? op.style.join : "miter",
    miter: op.style ? op.style.miter : 4,
    dash: op.style && op.style.dash ? op.style.dash : null,
    dashOffset: op.style ? op.style.dashOffset : 0,
    size: op.size ?? 0,
    ramp: op.type === "face" ? op.ramp : null,
    rampKey: op.type === "face" ? op.rampKey : null,
    last: null,
    text: op.text ?? "",
    x: op.x ?? 0,
    y: op.y ?? 0,
    font: op.font ?? "",
    align: op.align ?? "left",
    spacing: op.spacing ?? "0px",
    baseline: op.baseline ?? "alphabetic",
    effect: op.effect ?? null,
    base: op.base ? op.base.map(flat) : null,
    grad: op.style && op.style.grad && op.tag === "circle" && !(op.type === "path" || op.type === "slot" || op.type === "face" || op.type === "dot") ? op.style.grad : null, // fu/f4-lights
    gradFill: null,
  });
  // (a deferred compile flattens each part as it compiles)
  flatten = flat;
  for (let i = 0; i < programs.length; i++) if (programs[i]) programs[i] = programs[i].map(flat);
  // kit patch 11 + r1: the runs whose drawing holds a <g data-spin> link, by key, so a hub turn repaints only them
  const spinRuns = new Map();
  const spinDirty = new Set();
  spinOf = (index) => {
    const ops = programs[index];
    if (!ops) return;
    for (const op of ops) {
      const links = [...(op.chain ?? []), ...(op.base ?? []).flatMap((b) => b.chain ?? [])];
      for (const link of links) if (link.spin) (spinRuns.get(link.spin) ?? spinRuns.set(link.spin, new Set()).get(link.spin)).add(index);
    }
  };
  for (let i = 0; i < programs.length; i++) spinOf(i);
  const paintLayer = (layer, frames, rect = null) => {
    const ctx = layer.ctx;
    // r2-perf (kit-patches.md 34): the transform last set, so a setTransform to the same matrix (the ops of one plane,
    // one after another) is not issued again; NaN forces the next one (after an effect or the mask, which set their own)
    let t0 = NaN;
    let t1 = NaN;
    let t2 = NaN;
    let t3 = NaN;
    let t4 = NaN;
    let t5 = NaN;
    const setT = (a, b, c, d, e, g) => {
      if (a === t0 && b === t1 && c === t2 && d === t3 && e === t4 && g === t5) return;
      ctx.setTransform(a, b, c, d, e, g);
      t0 = a;
      t1 = b;
      t2 = c;
      t3 = d;
      t4 = e;
      t5 = g;
    };
    setT(1, 0, 0, 1, 0, 0);
    if (rect) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.dx0, rect.dy0, rect.dx1 - rect.dx0, rect.dy1 - rect.dy0);
      ctx.clip();
      ctx.clearRect(rect.dx0, rect.dy0, rect.dx1 - rect.dx0, rect.dy1 - rect.dy0);
    } else ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    const b0 = base[0];
    const b3 = base[3];
    const b4 = base[4];
    const b5 = base[5];
    setT(b0, 0, 0, b3, b4, b5);
    const order = controller.orderIndex(layer.name);
    if (!order) {
      if (rect) ctx.restore();
      return;
    }
    const unitLine = 1 / cssPerUnit;
    const seen = { x0: -b4 / b0 - 4, y0: -b5 / b3 - 4, x1: (layer.canvas.width - b4) / b0 + 4, y1: (layer.canvas.height - b5) / b3 + 4 };
    let curFill = null;
    let curStroke = null;
    let curWidth = -1;
    let curCap = null;
    let curJoin = null;
    let curMiter = -1;
    let curAlpha = 1;
    let curTransformed = false;
    let curBx = b4;
    let curBy = b5;
    let dashed = false;
    let opCount = 0;
    ctx.globalAlpha = 1;
    const drawRun = (index, only = null) => {
      const ops = only ?? programs[index];
      if (ops === undefined) return;
      const f = frames[index];
      const fb = f.box;
      if (fb[0] > seen.x1 || fb[2] < seen.x0 || fb[1] > seen.y1 || fb[3] < seen.y0) return;
      if (rect !== null) {
        if (fb[0] > rect.x1 || fb[2] < rect.x0 || fb[1] > rect.y1 || fb[3] < rect.y0) return;
        stats.touched++;
      }
      // r2-perf (kit-patches.md 36): a run the controller emitted in part (outside the canvas when it was set) is
      // emitted in full now, before it is drawn
      if (f.partial === true) controller.complete(index);
      const bx = b4 + b0 * (f.sx || 0);
      const by = b5 + b3 * (f.sy || 0);
      if (bx !== curBx || by !== curBy) {
        curBx = bx;
        curBy = by;
        curTransformed = true;
      }
      for (let o = 0; o < ops.length; o++) {
        const op = ops[o];
        const kind = op.kind;
        if (kind === 4) {
          setT(1, 0, 0, 1, 0, 0);
          ctx.globalAlpha = 1;
          curAlpha = 1;
          const baseOps = op.base;
          const drawBase = () => {
            if (!baseOps) return;
            t0 = NaN;
            setT(b0, 0, 0, b3, bx, by);
            curTransformed = false;
            curFill = null;
            curStroke = null;
            curWidth = -1;
            curCap = null;
            curJoin = null;
            curMiter = -1;
            curAlpha = -1;
            drawRun(index, baseOps);
            setT(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            curAlpha = 1;
          };
          op.effect(ctx, layer.canvas.width, layer.canvas.height, base, rect, drawBase);
          t0 = NaN;
          setT(b0, 0, 0, b3, bx, by);
          curTransformed = false;
          curFill = null;
          curStroke = null;
          curWidth = -1;
          curCap = null;
          curJoin = null;
          curMiter = -1;
          continue;
        }
        let alpha = op.alpha;
        const roles = op.roles;
        if (roles !== null) for (let k = 0; k < roles.length; k++) alpha *= f.o[roles[k]];
        const varies = op.varies;
        if (varies !== null) for (let k = 0; k < varies.length; k++) alpha *= varies[k]();
        if (alpha <= 0.001) continue;
        let path = null;
        let token = null;
        let fill = op.fill;
        let stroke = op.stroke;
        let width = op.width;
        if (kind === 1) {
          const d = f.d[op.r];
          if (d === "" || d === undefined) continue;
          if (d.charCodeAt(0) === 1) token = d;
          else {
            path = pathOf(op, d);
            if (path === null) continue;
          }
          if (op.face) {
            fill = stroke = tintP > 0 && tintRuns !== null && tintRuns[index] === 1 ? tintedTable(op)[f.q[op.r]] : op.table[f.q[op.r]];
            const w = f.w[op.r];
            if (w >= 0) width = w;
          }
        } else if (kind === 2) {
          alpha *= f.o[op.r];
          if (alpha <= 0.001) continue;
        } else {
          path = op.path;
          // fu/f4-lights: a gradient-filled circle (made once, in the circle's own units: the transform places it)
          if (op.grad !== null) fill = op.gradFill ?? (op.gradFill = cpGradient(ctx, op.grad));
        }
        opCount++;
        if (alpha !== curAlpha) {
          ctx.globalAlpha = alpha;
          curAlpha = alpha;
        }
        const M = op.chain !== null ? chainMatrix(op.chain, f) : null;
        if (kind === 3) {
          const T = cpMul(base, M);
          setT(T[0], T[1], T[2], T[3], T[4], T[5]);
          curTransformed = true;
          ctx.font = op.font;
          ctx.textAlign = op.align;
          ctx.textBaseline = op.baseline;
          if ("letterSpacing" in ctx) ctx.letterSpacing = op.spacing;
          if (fill) {
            ctx.fillStyle = fill;
            curFill = fill;
            ctx.fillText(op.text, op.x, op.y);
          }
          continue;
        }
        let drawPath = path;
        const plain = M === null || (M[0] === 1 && M[1] === 0 && M[2] === 0 && M[3] === 1);
        // kit patch 24 (grown faces): an opaque face whose stroke is in its own colour is one fill of its grown outline
        // (a non-scaling stroke only under a plain matrix, where its width is width × unitLine in the path's units)
        const grow = growOn && op.growable && token !== null && width > 0 && alpha >= 0.999 && fill.charCodeAt(0) === 35 && (plain || !op.nonScaling);
        const growR = grow ? (op.nonScaling ? width * unitLine : width) / 2 : 0;
        let nLeft = 0;
        if (grow && token.length > 5 * growLeft.length) growLeft = new Int32Array(token.length);
        if (kind === 2) {
          if (M === null) {
            if (curTransformed) {
              setT(b0, 0, 0, b3, bx, by);
              curTransformed = false;
            }
          } else {
            setT(b0 * M[0], b3 * M[1], b0 * M[2], b3 * M[3], b0 * M[4] + bx, b3 * M[5] + by);
            curTransformed = true;
          }
          ctx.beginPath();
          ctx.arc(f.cx[op.r], f.cy[op.r], op.size, 0, 6.283185307179586);
          drawPath = null;
        } else if (M === null) {
          if (curTransformed) {
            setT(b0, 0, 0, b3, bx, by);
            curTransformed = false;
          }
          if (grow) nLeft = cpTraceGrow(ctx, token, f.arena, growR, growLeft);
          else if (token !== null) cpTrace(ctx, token, f.arena);
        } else if (plain || !(stroke && op.nonScaling)) {
          setT(b0 * M[0], b3 * M[1], b0 * M[2], b3 * M[3], b0 * M[4] + bx, b3 * M[5] + by);
          curTransformed = true;
          if (grow) nLeft = cpTraceGrow(ctx, token, f.arena, growR, growLeft);
          else if (token !== null) cpTrace(ctx, token, f.arena);
        } else if (op.prog !== null) {
          // the geometry replayed under the plane's matrix, then the matrix reset so the stroke keeps its width
          setT(b0 * M[0], b3 * M[1], b0 * M[2], b3 * M[3], b0 * M[4] + bx, b3 * M[5] + by);
          cpReplayProgram(ctx, op.prog);
          setT(b0, 0, 0, b3, bx, by);
          curTransformed = false;
          drawPath = null;
        } else {
          if (curTransformed) {
            setT(b0, 0, 0, b3, bx, by);
            curTransformed = false;
          }
          // one DOMMatrix reused (a380 perf, kit-patches.md 24): a new one per op per frame was 3.5% of the page's time
          const T = cpScratchMatrix;
          T.a = M[0];
          T.b = M[1];
          T.c = M[2];
          T.d = M[3];
          T.e = M[4];
          T.f = M[5];
          drawPath = new Path2D();
          drawPath.addPath(path, T);
        }
        if (fill !== null) {
          if (fill !== curFill) {
            ctx.fillStyle = fill;
            curFill = fill;
          }
          if (kind === 5) ctx.globalCompositeOperation = "screen"; // fu/f3-lights
          if (drawPath !== null) op.evenodd ? ctx.fill(drawPath, "evenodd") : ctx.fill(drawPath);
          else op.evenodd ? ctx.fill("evenodd") : ctx.fill();
          if (kind === 5) ctx.globalCompositeOperation = "source-over"; // fu/f3-lights
        }
        if (grow) {
          // only the subpaths the fill could not grow are stroked
          if (nLeft === 0) continue;
          cpTraceLeft(ctx, token, f.arena, growLeft, nLeft);
          stats.left += nLeft;
        }
        if (stroke !== null && width > 0) {
          if (stroke !== curStroke) {
            ctx.strokeStyle = stroke;
            curStroke = stroke;
          }
          const scaleOf = M === null || plain ? 1 : Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2]));
          const lw = op.nonScaling ? (width * unitLine) / (drawPath === path ? scaleOf : 1) : width;
          if (lw !== curWidth) {
            ctx.lineWidth = lw;
            curWidth = lw;
          }
          if (op.cap !== curCap) {
            ctx.lineCap = op.cap;
            curCap = op.cap;
          }
          if (op.join !== curJoin) {
            ctx.lineJoin = op.join;
            curJoin = op.join;
          }
          if (op.miter !== curMiter) {
            ctx.miterLimit = op.miter;
            curMiter = op.miter;
          }
          if (op.dash !== null || dashed) {
            ctx.setLineDash(op.dash !== null ? op.dash.map((v) => v * (op.nonScaling ? unitLine : 1)) : []);
            ctx.lineDashOffset = op.dashOffset;
            dashed = op.dash !== null;
          }
          if (drawPath !== null) ctx.stroke(drawPath);
          else ctx.stroke();
        }
      }
        };
    if (below) {
      for (let at = 0; at < order.length; at++) if (below(order[at])) drawRun(order[at]);
      if (mask) {
        mask(ctx, rect);
        t0 = NaN;
        setT(b0, 0, 0, b3, b4, b5);
        curTransformed = false;
        curBx = b4;
        curBy = b5;
        curFill = null;
        curStroke = null;
        curWidth = -1;
        curAlpha = -1;
        ctx.globalAlpha = 1;
      }
      for (let at = 0; at < order.length; at++) if (!below(order[at])) drawRun(order[at]);
    } else for (let at = 0; at < order.length; at++) drawRun(order[at]);
    stats.ops += opCount;
    stats.paths += opCount;
    if (dashed) ctx.setLineDash([]);
    if (rect) ctx.restore();
  };
  let numeric = Boolean(controller.numeric);
  let incremental = false;
  let forceFull = true;
  const paint = (opts = null) => {
    const t = performance.now();
    // a380 follow-up r1: only the spun hubs changed (no pose, alpha or view): their parts' rects are repainted
    if (opts && opts.spinsOnly && painted && !forceFull && spinDirty.size) {
      stats.ops = 0;
      stats.paths = 0;
      stats.parsed = 0;
      stats.left = 0;
      stats.touched = 0;
      stats.full = 0;
      const frames = controller.frames();
      const dirty = [...spinDirty];
      spinDirty.clear();
      const rects = rectsOf(frames, dirty);
      stats.rects = rects.length;
      for (const rect of rects) for (const layer of layers) paintLayer(layer, frames, rect);
      stats.ms = performance.now() - t;
      return stats;
    }
    spinDirty.clear();
    stats.ops = 0;
    stats.paths = 0;
    stats.parsed = 0;
    stats.left = 0;
    stats.touched = 0;
    stats.rects = 0;
    stats.full = 0;
    const frames = controller.frames();
    const emitted = controller.emitted ? controller.emitted() : null;
    const all = runs.length;
    const full = !incremental || forceFull || !painted || !emitted || emitted.length > all * 0.25;
    if (full) {
      for (const layer of layers) paintLayer(layer, frames);
      stats.full = 1;
      keepBoxes(frames, runs.map((run) => run.index));
    } else if (emitted.length || effectRuns.length) {
      const dirty = effectRuns.length ? emitted.concat(effectRuns) : emitted;
      const rects = rectsOf(frames, dirty);
      stats.rects = rects.length;
      for (const rect of rects) for (const layer of layers) paintLayer(layer, frames, rect);
      keepBoxes(frames, dirty);
    }
    painted = true;
    forceFull = false;
    stats.ms = performance.now() - t;
    return stats;
  };
  let watching = null;
  const finish = () => {
    compileMs = performance.now() - t0;
    findEffectRuns();
    resize();
    for (const layer of layers) {
      if (keepSvg) layer.svg.style.visibility = "hidden";
      else layer.svg.remove();
    }
    if (typeof ResizeObserver === "function") {
      let first = true;
      watching = new ResizeObserver(() => {
        // (its first call reports the size the mount just measured)
        if (first && box) {
          first = false;
          const b = stage.getBoundingClientRect();
          if (b.width === box.width && b.height === box.height && b.left === box.left && b.top === box.top) return;
        }
        first = false;
        resize();
        paint();
      });
      watching.observe(stage);
    }
  };
  if (!deferred) finish();
  const dprQuery = () => {
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener("change", () => {
      resize();
      paint();
      dprQuery();
    }, { once: true });
  };
  dprQuery();
  stage.setAttribute("data-painter", "canvas");
  return {
    paint,
    _finish: finish,
    base: () => base.slice(),
    stats: () => ({ ...stats }),
    get compileMs() {
      return compileMs;
    },
    // a380 follow-up r1: CSS px per viewBox unit at zoom 1 (the SVG layers' transform zoom uses it)
    get fit() {
      return fit;
    },
    exportSvg({ gl = true, background = true } = {}) {
      controller.snapshot();
      const out = [];
      for (const child of stage.children) {
        const tag = child.localName;
        if (tag === "svg") {
          if (child.style.visibility === "hidden") continue;
          out.push(`<g class="${child.getAttribute("class") || ""}">${child.innerHTML}</g>`);
        } else if (tag === "canvas") {
          const layer = layers.find((l) => l.canvas === child);
          if (layer) out.push(`<g class="${layer.svg.getAttribute("class") || ""}">${layer.svg.innerHTML}</g>`);
          else if (gl && child.width > 1 && getComputedStyle(child).display !== "none") out.push(`<image href="${child.toDataURL("image/png")}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>`);
        }
      }
      const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
      const holder = stage.closest("[data-theme]");
      const theme = holder ? holder.getAttribute("data-theme") : "dark";
      const card = getComputedStyle(stage.closest(".iso-plate") || stage).getPropertyValue("--anatomy-card").trim() || "#fff";
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><style>${css.replace(/<\/style/gi, "")}</style><g class="iso" data-theme="${theme}"><g class="iso-plate" style="padding:0;box-shadow:none">${background ? `<rect width="${W}" height="${H}" fill="${card}"/>` : ""}<g class="${stage.getAttribute("class") || ""}">${out.join("")}</g></g></g></svg>`;
    },
    set incremental(on) {
      incremental = Boolean(on);
      forceFull = true;
    },
    get incremental() {
      return incremental;
    },
    flush() {
      for (const layer of layers) layer.ctx.getImageData(0, 0, 1, 1);
    },
    get numeric() {
      return numeric;
    },
    unsupported: [...unsupported],
    layers: layers.map((l) => l.name),
    ops: programs.reduce((sum, ops) => sum + (ops ? ops.length : 0), 0),
    // a380 perf (kit-patches.md 24, PLAN item 42): tint the face tones of the runs whose name passes `test` toward
    // `color` by `p` (0..1) at paint time, as CSS color-mix(in srgb, tone, color p) would: no recompile (restyle cost
    // about 80 ms per step on the A380's cabin). The mixed tables are cached per tone ramp and step
    tint(test, color, p) {
      if (test !== tintTest) {
        tintTest = test;
        tintRuns = new Uint8Array(runs.length);
        for (const run of runs) tintRuns[run.index] = test(run.name) ? 1 : 0;
      }
      const rgb = cpRgba(color, probe) ?? [0, 0, 0, 1];
      const key = `${rgb.join(",")}|${Math.round(p * 1e4)}`;
      if (key === tintKey) return false;
      tintKey = key;
      tintRgb = rgb;
      tintP = Math.max(0, Math.min(1, p));
      forceFull = true;
      return true;
    },
    // kit patch 18 (a380 review round 3): recompile the parts whose run name passes `test` from their live computed
    // styles (a page that moves a CSS variable those parts read, such as a cabin dimmer, re-bakes only them)
    restyle(test) {
      let n = 0;
      for (const layer of layers) {
        // the mount removed the SVG (keepSvg off): computed styles need it in the document while it compiles, unseen
        // (opacity 0 on the root, which the compile does not read: visibility:hidden would hide every element from it)
        const attach = !layer.svg.isConnected;
        if (attach) {
          layer.svg.style.opacity = "0";
          layer.canvas.after(layer.svg);
        }
        const container = layer.svg.querySelector(".iso-parts") ?? layer.svg;
        for (const node of container.querySelectorAll(":scope > [data-p]")) {
          const index = Number(node.dataset.p);
          const run = runs[index];
          if (!run || !test(run.name)) continue;
          const effect = effects && effects[run.name];
          if (effect) continue;
          programs[index] = cpCompilePart(node, run, probe, unsupported, vary).map(flat);
          n++;
        }
        if (attach) {
          layer.svg.remove();
          layer.svg.style.opacity = "";
        }
      }
      forceFull = true;
      return n;
    },
    // kit patch 11: turn every <g data-spin="key"> by `angle` radians (as SVG rotate); true when it changed (the
    // caller repaints)
    spin(key, angle) {
      const c = Math.round(Math.cos(angle) * 1e6) / 1e6;
      const sn = Math.round(Math.sin(angle) * 1e6) / 1e6;
      const old = spins.get(key);
      if (old && old[0] === c && old[1] === sn) return false;
      spins.set(key, [c, sn, -sn, c, 0, 0]);
      const list = spinRuns.get(key);
      if (list) for (const index of list) spinDirty.add(index);
      return true;
    },
    // kit patch 24 (grown faces): on by default; off draws every face as a fill and a stroke, as before
    set grownFaces(on) {
      growOn = Boolean(on);
      forceFull = true;
    },
    get grownFaces() {
      return growOn;
    },
    // a380 perf (kit-patches.md 24, PLAN item 41): change the pixel-ratio cap; true when the backing store changed
    // (the caller repaints)
    setMaxRatio(cap) {
      if (cap === ratioCap) return false;
      ratioCap = cap;
      const before = dpr;
      if (ratioOf() === before) return false;
      resize(false);
      return dpr !== before;
    },
    get ratio() {
      return dpr;
    },
    zoom(z, cx = W / 2, cy = H / 2) {
      view.zoom = z;
      view.cx = cx;
      view.cy = cy;
      resize();
      return paint();
    },
    // a380 follow-up r1 (kit-patches.md 31): the view (zoom about a viewBox centre) without a paint or a layout: the
    // caller paints once (zoom() painted, then the page's tick painted again: two paints a frame in every Inspect view)
    setView(z, cx = W / 2, cy = H / 2) {
      if (view.zoom === z && view.cx === cx && view.cy === cy) return false;
      view.zoom = z;
      view.cx = cx;
      view.cy = cy;
      forceFull = true;
      if (!box) measure();
      placeView();
      return true;
    },
    destroy() {
      if (watching) watching.disconnect();
    },
  };
}

export const CANVAS2D = { mount: cpMount, mountAsync: cpMountAsync };
