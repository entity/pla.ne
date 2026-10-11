// (fu/r2-verify) edges: true also checks the kit's own face-edge strokes, the creases (.iso-crease: a hull's or prism's
// sharp edges between faces) and any open outline (.iso-edge), against the painted result: each end must meet another
// stroke (an outline, a crease, a seam) or a dot within the tolerance, or lie under a fill painted after it. Their
// ends are counted apart (edgeEnds, edgeLines; problems carry edge: true) so the texture-line count stays comparable.
// The sort review found crease strokes on Engine 2's pylon flank ending in mid-face while the texture-line gate passed.
// strict: true (fu/r2-verify) counts only visible line strokes as something to end on: .iso-line (texture lines,
// outlines, creases, seams) and .tb-edge strokes and dots, not the same-tone strokes of face and shading polygons
// (.iso-tn and the like, drawn to hide anti-aliasing seams). Engine 2's pylon joint seams (faint .iso-line) ended in
// mid-face on a hull sub-band polygon's boundary and passed. And an end under a fill painted later is followed back
// along its line to where it shows: that visible end must meet a visible stroke too (an outline cut by an occluder
// meets the occluder's outline; a line that stops at a fill boundary with no stroke floats there).
function lineEnds({ select = null, tolerance = 1, root: rootSlack = 2, mark = 7, least = 0.3, cover = 0.5, show = false, edges = false, strict = false } = {}) {
  const plate = (select && document.querySelector(select)) || document.querySelector(".iso-plate") || document.body;
  const box = plate.getBoundingClientRect();
  const style = document.createElement("style");
  style.textContent = `${select || ".iso-plate"} *{pointer-events:none!important}${select || ".iso-plate"} svg,${select || ".iso-plate"} svg *{pointer-events:visiblePainted!important}`;
  document.head.append(style);
  const skipClass = ["iso-edge", "iso-bevel", "iso-crease", "tb-edge"];
  const svgs = [...plate.querySelectorAll("svg")];
  const shapes = svgs.flatMap((svg) => [...svg.querySelectorAll("path, line, polyline, polygon, circle, ellipse, rect")]).filter((el) => !el.closest("defs, clipPath, mask, pattern, marker, symbol"));
  const opacityOf = (el) => {
    let alpha = 1;
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (cs.display === "none") return 0;
      alpha *= Number(cs.opacity);
      if (node === plate) break;
    }
    return getComputedStyle(el).visibility === "hidden" ? 0 : alpha;
  };
  const numbers = (text) => (text.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []).map(Number);
  const subpathsOf = (d) => {
    const out = [];
    let current = null;
    let x = 0;
    let y = 0;
    let sx = 0;
    let sy = 0;
    let control = null;
    const push = (px, py) => {
      current.points.push([px, py]);
      x = px;
      y = py;
    };
    const start = (px, py) => {
      current = { points: [[px, py]], closed: false };
      out.push(current);
      x = sx = px;
      y = sy = py;
    };
    const cubic = (x1, y1, x2, y2, px, py) => {
      const x0 = x;
      const y0 = y;
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const u = 1 - t;
        push(u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * px, u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * py);
      }
      control = [x2, y2];
    };
    const quad = (x1, y1, px, py) => {
      const x0 = x;
      const y0 = y;
      for (let i = 1; i <= 6; i++) {
        const t = i / 6;
        const u = 1 - t;
        push(u * u * x0 + 2 * u * t * x1 + t * t * px, u * u * y0 + 2 * u * t * y1 + t * t * py);
      }
      control = [x1, y1];
    };
    for (const [, command, args] of d.matchAll(/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g)) {
      const v = numbers(args);
      const rel = command === command.toLowerCase();
      const C = command.toUpperCase();
      const ox = () => (rel ? x : 0);
      const oy = () => (rel ? y : 0);
      if (C === "Z") {
        if (current) {
          current.closed = true;
          push(sx, sy);
        }
        current = null;
        continue;
      }
      if (C === "M") {
        for (let i = 0; i + 1 < v.length; i += 2) {
          if (i === 0) start(v[0] + ox(), v[1] + oy());
          else push(v[i] + ox(), v[i + 1] + oy());
        }
        control = null;
        continue;
      }
      if (!current) start(x, y);
      if (C === "L") for (let i = 0; i + 1 < v.length; i += 2) push(v[i] + ox(), v[i + 1] + oy());
      else if (C === "H") for (const value of v) push(value + ox(), y);
      else if (C === "V") for (const value of v) push(x, value + oy());
      else if (C === "C") for (let i = 0; i + 5 < v.length; i += 6) cubic(v[i] + ox(), v[i + 1] + oy(), v[i + 2] + ox(), v[i + 3] + oy(), v[i + 4] + ox(), v[i + 5] + oy());
      else if (C === "S")
        for (let i = 0; i + 3 < v.length; i += 4) {
          const reflected = control ? [2 * x - control[0], 2 * y - control[1]] : [x, y];
          cubic(reflected[0], reflected[1], v[i] + ox(), v[i + 1] + oy(), v[i + 2] + ox(), v[i + 3] + oy());
        }
      else if (C === "Q") for (let i = 0; i + 3 < v.length; i += 4) quad(v[i] + ox(), v[i + 1] + oy(), v[i + 2] + ox(), v[i + 3] + oy());
      else if (C === "T")
        for (let i = 0; i + 1 < v.length; i += 2) {
          const reflected = control ? [2 * x - control[0], 2 * y - control[1]] : [x, y];
          quad(reflected[0], reflected[1], v[i] + ox(), v[i + 1] + oy());
        }
      else if (C === "A") for (let i = 0; i + 6 < v.length; i += 7) push(v[i + 5] + ox(), v[i + 6] + oy());
      if (C !== "C" && C !== "S" && C !== "Q" && C !== "T") control = null;
    }
    return out;
  };
  const geometryOf = (el) => {
    const tag = el.tagName.toLowerCase();
    const num = (name) => Number(el.getAttribute(name) || 0);
    if (tag === "path") return subpathsOf(el.getAttribute("d") || "");
    if (tag === "line") return [{ points: [[num("x1"), num("y1")], [num("x2"), num("y2")]], closed: false }];
    if (tag === "polyline" || tag === "polygon") {
      const v = numbers(el.getAttribute("points") || "");
      const points = [];
      for (let i = 0; i + 1 < v.length; i += 2) points.push([v[i], v[i + 1]]);
      if (tag === "polygon" && points.length) points.push(points[0]);
      return [{ points, closed: tag === "polygon" }];
    }
    if (tag === "rect") {
      const [x, y, w, h] = [num("x"), num("y"), num("width"), num("height")];
      return [{ points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], closed: true }];
    }
    return [];
  };
  const cell = 6;
  const grid = new Map();
  const add = (gx, gy, entry) => {
    const id = `${gx},${gy}`;
    let list = grid.get(id);
    if (!list) grid.set(id, (list = []));
    if (list[list.length - 1] !== entry) list.push(entry);
  };
  // the indexed region: the plates' client rects (with a margin). A zoomed figure (Inspect) has segments far off
  // screen: indexing each one's whole bounding box overflowed the Map, so segments are walked cell by cell instead
  const bound = (() => {
    const boxes = svgs.map((svg) => (svg.closest(".iso-plate") ?? svg).getBoundingClientRect());
    if (!boxes.length) return [-1e9, -1e9, 1e9, 1e9];
    return [Math.min(...boxes.map((b) => b.left)) - 60, Math.min(...boxes.map((b) => b.top)) - 60, Math.max(...boxes.map((b) => b.right)) + 60, Math.max(...boxes.map((b) => b.bottom)) + 60];
  })();
  const inBound = (x, y) => x >= bound[0] && y >= bound[1] && x <= bound[2] && y <= bound[3];
  // (strict) an end counts only where the layers show it: inside their own boxes (the stage's window), not in the
  // 60 px margin (an Inspect view's lines run on past the window's edge)
  const view = (() => {
    // (fu/f4-verify) each layer's box cut by its clipping ancestors (overflow other than visible: the stage window), so
    // a line the window cuts ends at the window's edge, not at the layer's wider box (the Tail view's flap wall outline
    // ended at the card's right edge and floated, 3.71 px)
    const clipped = (svg) => {
      const r = svg.getBoundingClientRect();
      let [l, t, rr, b] = [r.left, r.top, r.right, r.bottom];
      for (let n = svg.parentElement; n && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.overflowX === "visible" && cs.overflowY === "visible" && (!cs.clipPath || cs.clipPath === "none")) continue;
        const c = n.getBoundingClientRect();
        if (cs.overflowX !== "visible" || cs.clipPath !== "none") (l = Math.max(l, c.left), rr = Math.min(rr, c.right));
        if (cs.overflowY !== "visible" || cs.clipPath !== "none") (t = Math.max(t, c.top), b = Math.min(b, c.bottom));
      }
      return { left: l, top: t, right: rr, bottom: b, width: rr - l, height: b - t };
    };
    const boxes = svgs.map(clipped).filter((b) => b.width > 0 && b.height > 0);
    if (!strict || !boxes.length) return bound;
    // 2 px in from the window's edge: a line the window cuts ends at its edge, not in the drawing
    return [Math.min(...boxes.map((b) => b.left)) + 2, Math.min(...boxes.map((b) => b.top)) + 2, Math.max(...boxes.map((b) => b.right)) - 2, Math.max(...boxes.map((b) => b.bottom)) - 2];
  })();
  const inView = (x, y) => x >= view[0] && y >= view[1] && x <= view[2] && y <= view[3];
  const addSegment = (a, b, entry) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / (cell / 2)));
    for (let k = 0; k <= n; k++) {
      const x = a[0] + ((b[0] - a[0]) * k) / n;
      const y = a[1] + ((b[1] - a[1]) * k) / n;
      if (!inBound(x, y)) continue;
      const gx = Math.floor(x / cell);
      const gy = Math.floor(y / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) add(gx + dx, gy + dy, entry);
    }
  };
  const lines = [];
  let scale = 1;
  for (const el of shapes) {
    const cs = getComputedStyle(el);
    const alpha = opacityOf(el);
    if (alpha < 0.1) continue;
    const ctm = el.getScreenCTM();
    if (!ctm) continue;
    const map = ([px, py]) => [ctm.a * px + ctm.c * py + ctm.e, ctm.b * px + ctm.d * py + ctm.f];
    const tag = el.tagName.toLowerCase();
    const stroked = cs.stroke !== "none" && parseFloat(cs.strokeWidth) > 0 && Number(cs.strokeOpacity) > 0.05;
    const filled = cs.fill !== "none" && Number(cs.fillOpacity) > 0.05;
    if (tag === "circle" || tag === "ellipse") {
      if (!stroked && !filled) continue;
      const c = map([Number(el.getAttribute("cx") || 0), Number(el.getAttribute("cy") || 0)]);
      const r = Number(el.getAttribute("r") || el.getAttribute("rx") || 0) * Math.hypot(ctm.a, ctm.b);
      const entry = { el, kind: "dot", c, r };
      const x0 = Math.max(bound[0], c[0] - r);
      const x1 = Math.min(bound[2], c[0] + r);
      const y0 = Math.max(bound[1], c[1] - r);
      const y1 = Math.min(bound[3], c[1] + r);
      for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++) for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) add(gx, gy, entry);
      continue;
    }
    if (!stroked) continue;
    const target = !strict || ((el.classList.contains("iso-line") || el.classList.contains("tb-edge")) && Number(cs.strokeOpacity) * alpha >= 0.1);
    const owner = el.closest("svg");
    const viewCtm = owner && owner.getScreenCTM();
    if (viewCtm) scale = Math.hypot(viewCtm.a, viewCtm.b) || scale;
    // (fu/f4-verify) each line's own layer scale: a page that zooms through a wrapper <g> (the canvas pages' Inspect
    // views, applyView) leaves the <svg>'s CTM at 1x, and one global scale taken from the last stroked element's <svg>
    // judged the Deck plan's 7-10 px stair treads at 1.55x as full lines on the shipping pages. The scale is that of the
    // line's outermost <g> under its <svg> (the zoom wrapper, where there is one), as an area scale (sqrt |det|), not
    // the element's own CTM: a part drawn in a local frame (the platter's skewed ring marks) is not a zoom
    let top = el;
    while (top.parentElement && top.parentElement !== owner) top = top.parentElement;
    const layerCtm = top !== el && top.getScreenCTM ? top.getScreenCTM() : viewCtm;
    const own = (layerCtm && Math.sqrt(Math.abs(layerCtm.a * layerCtm.d - layerCtm.b * layerCtm.c))) || scale;
    const subpaths = geometryOf(el).map((sub, index) => ({ ...sub, index, flat: sub.points.map(map) }));
    subpaths.forEach((sub) => {
      for (let i = 0; i < sub.flat.length - 1; i++) {
        const a = sub.flat[i];
        const b = sub.flat[i + 1];
        const entry = { el, kind: "segment", a, b, sub: sub.index, i };
        if (target) addSegment(a, b, entry);
      }
    });
    // (strict) a dotted row (a dash of at most 0.1 px with round caps: rivets) is a row of dots, not a line: it stops a
    // rivet pitch short of a panel's edge by design and has no end to float
    const dotted = strict && (() => {
      const dash = cs.strokeDasharray;
      if (!dash || dash === "none") return false;
      const first = parseFloat(dash);
      return Number.isFinite(first) && first <= 0.1;
    })();
    const checked = el.classList.contains("iso-line") && !skipClass.some((name) => el.classList.contains(name)) && alpha >= least && !dotted;
    const edge = edges && !checked && el.classList.contains("iso-line") && (el.classList.contains("iso-crease") || el.classList.contains("iso-edge")) && alpha >= least;
    if (checked || edge) lines.push({ el, subpaths, alpha, free: el.getAttribute("data-free"), edge, scale: own });
  }
  const near = (p, reach) => {
    const out = new Set();
    for (let gx = Math.floor((p[0] - reach) / cell); gx <= Math.floor((p[0] + reach) / cell); gx++) for (let gy = Math.floor((p[1] - reach) / cell); gy <= Math.floor((p[1] + reach) / cell); gy++) for (const entry of grid.get(`${gx},${gy}`) || []) out.add(entry);
    return out;
  };
  const segmentDistance = (p, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const span = dx * dx + dy * dy;
    const t = span > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / span)) : 0;
    return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
  };
  const lengthOf = (flat) => flat.reduce((sum, p, i) => (i ? sum + Math.hypot(p[0] - flat[i - 1][0], p[1] - flat[i - 1][1]) : 0), 0);
  const hidden = (el, p) => {
    const stack = document.elementsFromPoint(p[0], p[1]);
    const at = stack.indexOf(el);
    const above = at < 0 ? stack : stack.slice(0, at);
    return above.some((node) => {
      if (!(node instanceof SVGGeometryElement) || node.contains(el)) return false;
      const cs = getComputedStyle(node);
      return cs.fill !== "none" && Number(cs.fillOpacity) * opacityOf(node) >= cover && node.isPointInFill(new DOMPoint(...inverse(node, p)));
    });
  };
  const inverse = (node, p) => {
    const m = node.getScreenCTM().inverse();
    return [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f];
  };
  // offset (strict): the end was followed back this far along its line from under a fill, so its own line up to there
  // is not something it can meet
  const clearance = (line, sub, end, p, reach, offset = 0) => {
    let best = Infinity;
    const own = sub.flat;
    const skipNear = 2 * reach;
    const along = [0];
    for (let i = 1; i < own.length; i++) along.push(along[i - 1] + Math.hypot(own[i][0] - own[i - 1][0], own[i][1] - own[i - 1][1]));
    const total = along[along.length - 1];
    const candidates = [];
    for (const entry of near(p, reach * 4)) {
      if (entry.kind === "dot") {
        best = Math.min(best, Math.max(0, Math.hypot(p[0] - entry.c[0], p[1] - entry.c[1]) - entry.r));
        continue;
      }
      if (entry.el === line.el && entry.sub === sub.index) {
        const from = along[entry.i];
        const to = along[entry.i + 1];
        const gapFrom = end === "start" ? from : total - to;
        if (gapFrom < offset + skipNear) continue;
      }
      const dist = segmentDistance(p, entry.a, entry.b);
      if (strict && dist <= reach) candidates.push([dist, entry]);
      else if (dist < best) best = dist;
    }
    // (strict) the stroke met must show there: a seam that meets another part's seam hidden under a third part's fill
    // ends in mid-face on the page (Engine 2's pylon joint seams). Nearest first, so one or two hit tests an end
    if (strict) {
      candidates.sort((x, y) => x[0] - y[0]);
      for (const [dist, entry] of candidates) {
        if (dist >= best) break;
        const dx = entry.b[0] - entry.a[0];
        const dy = entry.b[1] - entry.a[1];
        const span = dx * dx + dy * dy;
        const t = span > 0 ? Math.max(0, Math.min(1, ((p[0] - entry.a[0]) * dx + (p[1] - entry.a[1]) * dy) / span)) : 0;
        if (hidden(entry.el, [entry.a[0] + dx * t, entry.a[1] + dy * t])) continue;
        best = dist;
        break;
      }
    }
    return best;
  };
  const describe = (el) => {
    const item = el.closest("[data-part], [data-name], [data-item], .it");
    const tag = item && item !== el ? (item.getAttribute("data-part") || item.getAttribute("data-name") || item.getAttribute("data-item") || `it k ${item.getAttribute("data-k") || ""}`) : "";
    return `${el.getAttribute("class")}${el.getAttribute("data-tone") ? ` ${el.getAttribute("data-tone")}` : ""}${tag ? ` in ${tag}` : ""}`;
  };
  // (fu/f3-verify) what an owner needs to fix a floating end: the nearest visible stroke it could meet (and whether the
  // nearest of all is hidden), the first visible stroke straight ahead along the line (how far to extend it), the fill
  // that hides the drawn end when the end was followed out from under one, and the end in the element's own
  // coordinates (the units of its d, as the part's source writes them). Computed for failing ends only
  const firstFill = (el, p) => {
    const stack = document.elementsFromPoint(p[0], p[1]);
    const at = stack.indexOf(el);
    for (const node of at < 0 ? stack : stack.slice(0, at)) {
      if (!(node instanceof SVGGeometryElement) || node.contains(el)) continue;
      const cs = getComputedStyle(node);
      if (cs.fill !== "none" && Number(cs.fillOpacity) * opacityOf(node) >= cover && node.isPointInFill(new DOMPoint(...inverse(node, p)))) return node;
    }
    return null;
  };
  const explain = (line, sub, end, p, drawn) => {
    const own = (entry) => entry.el === line.el && entry.sub === sub.index;
    const segs = [...near(p, 48)].filter((entry) => entry.kind === "segment" && !own(entry)).map((entry) => [segmentDistance(p, entry.a, entry.b), entry]).sort((x, y) => x[0] - y[0]);
    const at = (entry) => {
      const dx = entry.b[0] - entry.a[0];
      const dy = entry.b[1] - entry.a[1];
      const span = dx * dx + dy * dy;
      const t = span > 0 ? Math.max(0, Math.min(1, ((p[0] - entry.a[0]) * dx + (p[1] - entry.a[1]) * dy) / span)) : 0;
      return [entry.a[0] + dx * t, entry.a[1] + dy * t];
    };
    const r1 = (x) => Math.round(x * 100) / 100;
    let nearest = null;
    let nearestAny = null;
    for (const [dist, entry] of segs.slice(0, 24)) {
      if (!nearestAny) nearestAny = { what: describe(entry.el), dist: r1(dist), hidden: hidden(entry.el, at(entry)) };
      if (!hidden(entry.el, at(entry))) {
        nearest = { what: describe(entry.el), dist: r1(dist) };
        break;
      }
    }
    // straight ahead: the line's direction at this end, outward (towards the drawn end when it was followed out)
    const f = sub.flat;
    const [q0, q1] = end === "start" ? [f[1], f[0]] : [f[f.length - 2], f[f.length - 1]];
    const len = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) || 1;
    const dir = [(q1[0] - q0[0]) / len, (q1[1] - q0[1]) / len];
    let ahead = null;
    for (const entry of near(p, 48)) {
      if (entry.kind !== "segment" || own(entry)) continue;
      const ex = entry.b[0] - entry.a[0];
      const ey = entry.b[1] - entry.a[1];
      const den = dir[0] * ey - dir[1] * ex;
      if (Math.abs(den) < 1e-9) continue;
      const wx = entry.a[0] - p[0];
      const wy = entry.a[1] - p[1];
      const t = (wx * ey - wy * ex) / den;
      const u = (wx * dir[1] - wy * dir[0]) / den;
      if (t <= 0 || t > 48 || u < 0 || u > 1 || (ahead && t >= ahead.dist)) continue;
      const hit = [p[0] + dir[0] * t, p[1] + dir[1] * t];
      if (hidden(entry.el, hit)) continue;
      ahead = { what: describe(entry.el), dist: r1(t) };
    }
    const local = (end === "start" ? sub.points[0] : sub.points[sub.points.length - 1]).map((v) => Math.round(v * 1000) / 1000);
    const under = drawn ? firstFill(line.el, drawn) : null;
    return { nearest, nearestAny: nearestAny && nearest && nearestAny.what === nearest.what && nearestAny.dist === nearest.dist ? null : nearestAny, ahead, local, under: under ? describe(under) : null, drawnAt: drawn ? [Math.round((drawn[0] - box.left) * 10) / 10, Math.round((drawn[1] - box.top) * 10) / 10] : null };
  };
  const problems = [];
  let ends = 0;
  let edgeEnds = 0;
  const visibleEnd = new Map();
  // (strict) the tolerances are screen px, at most twice the page's: in an Inspect view at 9x a viewBox px is 9 screen
  // px, so a seam 29 px long counted as a 7-unit tick (one rooted end was enough) and any end within 9 px passed. At
  // zoom a gap up to 2 screen px (a stroke's width and its anti-aliasing) still reads as meeting
  // (fu/f4-verify) per line: the scale is the line's own (lines.push), so a zoomed layer and a 1x layer on one page
  // each get their own tolerance; zoom reports the largest
  const zoom = lines.length ? Math.max(...lines.map((l) => l.scale)) : scale;
  const zoomLeast = lines.length ? Math.min(...lines.map((l) => l.scale)) : scale;
  for (const line of lines) {
    const scale = strict ? Math.min(line.scale, 2) : line.scale;
    const slack = tolerance * scale;
    const rooted = rootSlack * scale;
    for (const sub of line.subpaths) {
      if (sub.closed || sub.flat.length < 2) continue;
      const first = sub.flat[0];
      const last = sub.flat[sub.flat.length - 1];
      // a line wholly outside the plate (a parked free group, or beyond a zoomed view's window) is not drawn there
      if (!sub.flat.some(([x, y]) => inBound(x, y))) continue;
      if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.05 * scale) continue;
      const length = lengthOf(sub.flat);
      if (length < 0.2 * scale) continue;
      const result = {};
      for (const [end, p] of [["start", first], ["end", last]]) {
        if (line.free === "" || line.free === "both" || line.free === end || !inView(p[0], p[1])) {
          result[end] = 0;
          continue;
        }
        if (line.edge) edgeEnds++;
        else ends++;
        if (!hidden(line.el, p)) result[end] = clearance(line, sub, end, p, Math.max(slack, rooted));
        else if (!strict) result[end] = 0;
        else {
          // follow the line back from the hidden end to where it first shows: coarse steps (at most 16 a line, at least
          // 4 px), then halving to half a px between the last hidden and the first shown point
          const pts = end === "start" ? sub.flat : [...sub.flat].reverse();
          const along = [0];
          for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
          const at = (u) => {
            let i = 1;
            while (i < pts.length - 1 && along[i] < u) i++;
            const span = along[i] - along[i - 1] || 1;
            const k = Math.max(0, Math.min(1, (u - along[i - 1]) / span));
            return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k];
          };
          const shows = (u) => {
            const q = at(u);
            return inView(q[0], q[1]) && !hidden(line.el, q);
          };
          const stride = Math.max(4 * scale, length / 16);
          let lo = 0;
          let hi = null;
          for (let u = Math.min(stride, length); ; u = Math.min(u + stride, length)) {
            if (shows(u)) {
              hi = u;
              break;
            }
            lo = u;
            if (u >= length) break;
          }
          let shown = null;
          if (hi !== null) {
            while (hi - lo > 0.5 * scale) {
              const mid = (lo + hi) / 2;
              if (shows(mid)) hi = mid;
              else lo = mid;
            }
            shown = at(hi);
          }
          // (fu/f4-verify) the point just past the shown end is outside the window, not under a fill: the line shows up
          // to the window's edge and the window cuts it there (the Tail view's flap wall outline, 3.71 px "short" 2.5 px
          // inside the card's edge). Not an end in the drawing
          const cutByWindow = shown && (() => {
            const q = at(lo);
            return !inView(q[0], q[1]);
          })();
          result[end] = shown && !cutByWindow ? clearance(line, sub, end, shown, Math.max(slack, rooted), hi) : 0;
          if (shown && result[end] > slack) visibleEnd.set(`${line.el.getAttribute("d")}|${sub.index}|${end}`, shown);
        }
      }
      const straight = sub.flat.length === 2 || sub.flat.every((q) => segmentDistance(q, first, last) < 0.15 * scale);
      // an edge stroke is never a tick: both its ends must meet something
      const isMark = !line.edge && straight && length <= mark * scale;
      const fail = (end) => result[end] !== undefined && result[end] > slack;
      let bad = [];
      if (isMark) {
        const best = Math.min(result.start ?? Infinity, result.end ?? Infinity);
        if (!(best <= rooted)) bad = ["start", "end"].filter((end) => result[end] !== undefined && result[end] > 0);
      } else bad = ["start", "end"].filter(fail);
      for (const end of bad) {
        const shownAt = visibleEnd.get(`${line.el.getAttribute("d")}|${sub.index}|${end}`);
        const p = shownAt ?? (end === "start" ? first : last);
        problems.push({ ...(strict ? { why: explain(line, sub, end, p, shownAt ? (end === "start" ? first : last) : null) } : {}), what: describe(line.el), edge: line.edge, d: (line.el.getAttribute("d") || "").slice(0, 36), end, mark: isMark, gap: result[end] / (strict ? 1 : scale), at: [Math.round((p[0] - box.left) * 10) / 10, Math.round((p[1] - box.top) * 10) / 10], client: p, opacity: Math.round(line.alpha * 100) / 100, length: Math.round((length / (strict ? 1 : scale)) * 10) / 10 });
      }
    }
  }
  style.remove();
  problems.sort((a, b) => b.gap - a.gap);
  if (show) {
    const ns = "http://www.w3.org/2000/svg";
    const overlay = document.createElementNS(ns, "svg");
    overlay.setAttribute("data-line-ends", "");
    overlay.setAttribute("style", `position:fixed;left:0;top:0;width:${innerWidth}px;height:${innerHeight}px;pointer-events:none;z-index:2147483647;overflow:visible`);
    for (const problem of problems) {
      const ring = document.createElementNS(ns, "circle");
      ring.setAttribute("cx", problem.client[0]);
      ring.setAttribute("cy", problem.client[1]);
      ring.setAttribute("r", 5);
      ring.setAttribute("style", `fill:none;stroke:${problem.edge ? "#00c8ff" : "#ff0050"};stroke-width:1.5`);
      overlay.append(ring);
    }
    document.body.append(overlay);
  }
  return { zoom: Math.round(zoom * 100) / 100, zoomLeast: Math.round(zoomLeast * 100) / 100, ends, lines: lines.filter((l) => !l.edge).length, edgeEnds, edgeLines: lines.filter((l) => l.edge).length, edges, strict, problems: problems.map((x) => ({ ...x, client: x.client.map((v) => Math.round(v * 100) / 100) })) };
}

export const LINE_ENDS = lineEnds.toString();
