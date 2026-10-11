#!/usr/bin/env node
// scripts/devices.mjs (fu/f3-verify): the device pass for a review or a release. Loads a figure page in headless Chrome
// (WebGL on the GPU through ANGLE/EGL on Linux) once per device profile (CSS width × height, DPR, touch or mouse, CPU
// throttle), then: times the mount and the WebGL fade-in, records the frame intervals while the page runs on its own,
// during a drag across the stage and its coast, taps the stage (a part's label) and a control (Cutaway), and reports
// layout faults: horizontal overflow, controls off the screen, controls under 44 px (touch) or 24 px (mouse), controls
// that overlap, text under 11 px, a stage that shows (cut by its card's clip) wider or taller than the screen, console
// errors. One screenshot per device.
//
//   node scripts/devices.mjs <page.html | url> [--devices phone,phone-land,…] [--device 412x915@2.6/4t]…
//                            [--out a380/tmp/devices] [--idle 3000] [--throttle n] [--min-text 11] [--list]
//
// --device WxH@DPR/N[t|m]: a profile of your own (t touch, m mouse; N the CPU throttle), e.g. 360x740@3/6t.
// --site (fu/f4-verify): the page is the hosted site's (a380/dist, served by a380/tools/serve-site.mjs): also check that
// every link and button lies inside the viewport at the top of the page (the site bar hangs above the figure in the page's
// top margin, where a phone's smaller margin put it off the screen). On by itself when the page has a .site-bar.
// The stage tap (fu/f4-verify) waits for the drag's coast to end (the turn steady for 300 ms), taps the projected middle of
// a part that is on top there (the belly fairing when it shows, else the fuselage or a wing), and taps once more if that
// named nothing; a stage tap that names nothing twice is a failed interaction.
// Prints one block per device and a table; writes <out>/devices.json, <out>/devices.md and <out>/<device>.png (the
// screen after the page settled, at the device's pixels). Exit 1 when any device has a layout fault, a console error
// or a failed interaction (a drag that did not turn the stage, a control tap that changed nothing); frame times are
// reported, not gated. The frame interval is measured from requestAnimationFrame in the page (what the reader sees),
// long tasks (over 50 ms) from a PerformanceObserver. The renderer is named; under SwiftShader the timings are not the
// GPU's. Devices run one after another (one Chrome at a time) so their timings share a machine state.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";


// name: CSS width × height, device pixel ratio, touch, CPU throttle (the release's phone measure is 390 px, DPR 3, 4×)
function profiles() {
  return {
    "phone-small": { width: 360, height: 740, dpr: 3, touch: true, throttle: 6, what: "small Android phone, 6x CPU" },
    phone: { width: 390, height: 844, dpr: 3, touch: true, throttle: 4, what: "iPhone 12-15 class, 4x CPU (the release's phone measure)" },
    "phone-land": { width: 844, height: 390, dpr: 3, touch: true, throttle: 4, what: "the same phone in landscape" },
    tablet: { width: 820, height: 1180, dpr: 2, touch: true, throttle: 2, what: "iPad Air class, 2x CPU" },
    laptop: { width: 1280, height: 800, dpr: 2, touch: false, throttle: 1, what: "13-inch laptop" },
    desktop: { width: 1440, height: 900, dpr: 2, touch: false, throttle: 1, what: "the release's desktop measure" },
    wide: { width: 1920, height: 1080, dpr: 1, touch: false, throttle: 1, what: "1080p monitor" },
  };
}

function chromePath() {
  const candidates = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
  for (const base of [join(homedir(), ".cache/ms-playwright"), join(homedir(), "Library/Caches/ms-playwright")])
    if (existsSync(base)) for (const dir of readdirSync(base).sort().reverse()) for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) candidates.push(join(base, dir, sub));
  return candidates.find((c) => existsSync(c));
}

async function open(url, device) {
  const profile = mkdtempSync(join(tmpdir(), "devices-"));
  const angle = process.platform === "linux" ? [`--use-angle=${process.env.DRIVE_ANGLE || "gl-egl"}`] : [];
  const chrome = spawn(chromePath(), ["--headless=new", ...(process.platform === "linux" ? ["--no-sandbox"] : []), ...angle, "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--allow-file-access-from-files", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "about:blank"]);
  const reap = () => {
    try {
      chrome.kill("SIGKILL");
    } catch {}
  };
  process.on("exit", reap);
  const port = await new Promise((done, fail) => {
    let text = "";
    const timer = setTimeout(() => fail(new Error("Chrome did not start")), 20000);
    chrome.stderr.on("data", (chunk) => {
      text += chunk;
      const m = text.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
      if (m) (clearTimeout(timer), done(Number(m[1])));
    });
  });
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const problems = [];
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) (pending.get(data.id)(data), pending.delete(data.id));
    else if (data.method === "Runtime.consoleAPICalled" && (data.params.type === "error" || data.params.type === "warning")) problems.push(`console.${data.params.type}: ${data.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`);
    else if (data.method === "Runtime.exceptionThrown") problems.push(`exception: ${data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text}`.slice(0, 300));
  };
  await new Promise((done) => (socket.onopen = done));
  const send = (method, params = {}) =>
    new Promise((done) => {
      const call = ++id;
      pending.set(call, done);
      socket.send(JSON.stringify({ id: call, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
    return r.result?.result?.value;
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: device.width, height: device.height, deviceScaleFactor: device.dpr, mobile: device.touch, screenWidth: device.width, screenHeight: device.height });
  if (device.touch) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  if (device.throttle > 1) await send("Emulation.setCPUThrottlingRate", { rate: device.throttle });
  // the frame recorder, installed before the page's own scripts: rAF timestamps and long tasks into window.__dev
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(()=>{const d=window.__dev={frames:[],long:[],rec:false};const loop=(t)=>{if(d.rec)d.frames.push(t);requestAnimationFrame(loop)};requestAnimationFrame(loop);try{new PerformanceObserver((l)=>{for(const e of l.getEntries())if(d.rec)d.long.push(e.duration)}).observe({type:"longtask",buffered:false})}catch{}})();`,
  });
  const t0 = Date.now();
  await send("Page.navigate", { url });
  const close = () => {
    socket.close();
    reap();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  };
  return { send, evaluate, close, problems, t0 };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const stats = (frames, long) => {
  const gaps = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
  const q = (p) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] : null);
  return { frames: frames.length, median: q(0.5), p95: q(0.95), max: gaps.length ? gaps[gaps.length - 1] : null, over50: gaps.filter((g) => g > 50).length, fps: q(0.5) ? 1000 / q(0.5) : null, longTasks: long.length, longMs: long.reduce((s, x) => s + x, 0) };
};
const fmt = (s) => (s.median == null ? "no frames" : `${s.median.toFixed(1)} ms median (${s.fps.toFixed(0)} fps), p95 ${s.p95.toFixed(1)}, max ${s.max.toFixed(0)} · ${s.over50} over 50 ms of ${s.frames - 1} · long tasks ${s.longTasks} (${s.longMs.toFixed(0)} ms)`);

// layout faults, evaluated in the page
// (small text is a warning, not a fault: the card's type sizes are a design choice; --min-text sets the size, 11 px)
const LAYOUT = (touch, minText, site) => `(() => {
  const MIN_TEXT = ${minText};
  const SITE = ${site ? "true" : "false"} || Boolean(document.querySelector(".site-bar"));
  const vw = innerWidth, vh = innerHeight, faults = [], notes = [], warnings = [];
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return null; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const c = getComputedStyle(n); if (c.display === "none" || c.visibility === "hidden" || Number(c.opacity) === 0) return null; } return r; };
  const name = (el) => (el.getAttribute("aria-label") || el.textContent || el.className || el.tagName).toString().trim().replace(/\\s+/g, " ").slice(0, 28);
  const sw = document.documentElement.scrollWidth;
  if (sw > vw + 1) faults.push("horizontal overflow: the document is " + sw + " px wide in a " + vw + " px screen");
  const controls = [...document.querySelectorAll("button, a[href], input, select, [role=button]")].map((el) => [el, visible(el)]).filter(([, r]) => r);
  const off = controls.filter(([, r]) => r.left < -1 || r.right > vw + 1);
  if (off.length) faults.push(off.length + " control(s) off the screen sideways: " + off.slice(0, 4).map(([el, r]) => name(el) + " " + Math.round(r.left) + "-" + Math.round(r.right)).join(", "));
  const least = ${touch ? 44 : 24};
  const small = controls.filter(([el, r]) => el.tagName !== "A" && (r.width < least - 0.5 || r.height < least - 0.5) && !el.closest("svg"));
  if (small.length) faults.push(small.length + " control(s) under " + least + " px: " + small.slice(0, 5).map(([el, r]) => name(el) + " " + Math.round(r.width) + "x" + Math.round(r.height)).join(", "));
  const overlaps = [];
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
    const [a, ra] = controls[i], [b, rb] = controls[j];
    if (a.contains(b) || b.contains(a)) continue;
    const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
    if (w > 2 && h > 2) overlaps.push(name(a) + " / " + name(b));
  }
  if (overlaps.length) faults.push(overlaps.length + " overlapping control pair(s): " + overlaps.slice(0, 4).join(", "));
  const tiny = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim() || !n.parentElement || n.parentElement.closest("svg, script, style, .a3-sr")) continue;
    const r = visible(n.parentElement); if (!r) continue;
    const px = parseFloat(getComputedStyle(n.parentElement).fontSize);
    if (px < MIN_TEXT) tiny.push(n.textContent.trim().slice(0, 20) + " " + px.toFixed(1) + "px");
  }
  if (tiny.length) warnings.push(tiny.length + " text run(s) under " + MIN_TEXT + " px: " + tiny.slice(0, 5).join(", "));
  const stage = document.querySelector(".iso-turn") || document.querySelector(".iso-stage");
  const sr = stage && stage.getBoundingClientRect();
  // (fu/f4-verify) the stage as shown: its box cut by its clipping ancestors (the card clips a stage box that overhangs
  // it on a phone, so a 403 px box in a 390 px screen showed whole and the page did not scroll sideways). A fault is what
  // the reader loses: the shown stage running off the screen or taller than it
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    let [l, t, rr, b] = [r.left, r.top, r.right, r.bottom];
    for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const c = n.getBoundingClientRect();
      if (cs.overflowX !== "visible") (l = Math.max(l, c.left), rr = Math.min(rr, c.right));
      if (cs.overflowY !== "visible") (t = Math.max(t, c.top), b = Math.min(b, c.bottom));
    }
    return { left: l, top: t, right: rr, bottom: b, width: rr - l, height: b - t };
  };
  const ss = stage && shown(stage);
  if (ss && (ss.right > vw + 1 || ss.left < -1)) faults.push("the stage shows " + Math.round(ss.left) + "-" + Math.round(ss.right) + " px across a " + vw + " px screen (box " + Math.round(sr.width) + " px)");
  if (ss && ss.height > vh + 1) faults.push("the stage shows " + Math.round(ss.height) + " px tall in a " + vh + " px screen (it cannot be seen whole)");
  if (sr && ss && (sr.width > ss.width + 1 || sr.height > ss.height + 1)) notes.push("the stage box " + Math.round(sr.width) + "x" + Math.round(sr.height) + " is clipped to " + Math.round(ss.width) + "x" + Math.round(ss.height) + " by its card");
  // (fu/f4-verify) the site: every link and button inside the viewport at the top of the page, sideways and above (a fixed
  // or sticky one below the bottom too); each counted whether or not it is faded (a hidden bar is still a fault to find)
  if (SITE) {
    const fixedish = (el) => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === "fixed" || p === "sticky") return true; } return false; };
    const outside = [], cut = [];
    for (const el of document.querySelectorAll("a, button")) {
      const cs = getComputedStyle(el);
      if (el.closest("[hidden], noscript") || cs.display === "none") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) continue;
      const top = r.top + scrollY, bottom = r.bottom + scrollY;
      // the share of its box the reader can reach: inside the screen's width and below the page's top (and above the
      // screen's bottom for a fixed or sticky one). Under 3/4 is a fault; a box cut by a px or two is a warning
      const w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0));
      const h = Math.max(0, Math.min(bottom, fixedish(el) ? vh + scrollY : Infinity) - Math.max(top, 0));
      const share = (w * h) / Math.max(1e-6, r.width * r.height);
      const where = name(el) + " " + Math.round(r.left) + "," + Math.round(top) + "-" + Math.round(r.right) + "," + Math.round(bottom);
      if (share < 0.75) outside.push(where);
      else if (share < 0.999) cut.push(where + " (" + Math.round(share * 100) + "% shows)");
    }
    if (outside.length) faults.push("site: " + outside.length + " link(s) or button(s) outside the " + vw + "x" + vh + " viewport: " + outside.slice(0, 5).join(", "));
    if (cut.length) warnings.push("site: " + cut.length + " link(s) or button(s) cut by the viewport's edge: " + cut.slice(0, 5).join(", "));
    notes.push("site checks: " + document.querySelectorAll("a, button").length + " links and buttons" + (document.querySelector(".site-bar") ? ", site bar present" : ", no site bar"));
  }
  const plate = document.querySelector(".iso-plate");
  const pr = plate && plate.getBoundingClientRect();
  if (pr) notes.push("card " + Math.round(pr.width) + "x" + Math.round(pr.height) + " px, stage " + (sr ? Math.round(sr.width) + "x" + Math.round(sr.height) : "none") + ", page " + document.documentElement.scrollHeight + " px tall, " + controls.length + " controls");
  const live = document.querySelector("canvas[data-canvas-live]");
  if (live) { const r = live.getBoundingClientRect(); notes.push("airframe canvas " + live.width + "x" + live.height + " backing for " + Math.round(r.width) + "x" + Math.round(r.height) + " CSS px (" + (live.width / (r.width * devicePixelRatio)).toFixed(2) + " of the device's pixels)"); }
  if (stage) notes.push("stage touch-action " + getComputedStyle(stage).touchAction);
  return { faults, notes, warnings };
})()`;

// (fu/f4-verify) where to tap the A380's stage: the client point of the middle of a part's projected hull (the
// controller's frames, in the deck layer's view coordinates, through the Inspect zoom's view map) where that part is the
// topmost hull in the airframe's paint order, inside the stage as shown and the viewport, and the stage's own element
// there (no control over it). The belly fairing first, then the fuselage, the wings and anything else
const TARGET = `(() => {
  const A = window.__a380, c = A && A.controller;
  if (!c || !c.orderIndex) return null;
  const order = c.orderIndex("airframe"), frames = c.frames(), runs = c.scene().runs;
  const svg = document.querySelector('svg[data-live="deck"]') || document.querySelector("svg[data-live]");
  if (!order || !svg) return null;
  const box = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
  const vm = c.viewMap || ((x, y) => [x, y]);
  const o = vm(0, 0), ex = vm(1, 0), ey = vm(0, 1);
  const a = ex[0] - o[0], b = ex[1] - o[1], cc = ey[0] - o[0], d = ey[1] - o[1], det = a * d - b * cc;
  const toClient = (x, y) => { const u = ((x - o[0]) * d - (y - o[1]) * cc) / det, v = (a * (y - o[1]) - b * (x - o[0])) / det; return [box.left + ((u - vb.x) / vb.width) * box.width, box.top + ((v - vb.y) / vb.height) * box.height]; };
  const stage = document.querySelector(".iso-turn") || document.querySelector(".iso-stage");
  let sr = stage.getBoundingClientRect(); let L = sr.left, T = sr.top, R = sr.right, B = sr.bottom;
  for (let n = stage.parentElement; n && n !== document.documentElement; n = n.parentElement) { const cs = getComputedStyle(n), r = n.getBoundingClientRect(); if (cs.overflowX !== "visible") (L = Math.max(L, r.left), R = Math.min(R, r.right)); if (cs.overflowY !== "visible") (T = Math.max(T, r.top), B = Math.min(B, r.bottom)); }
  L = Math.max(L, 0) + 8; T = Math.max(T, 0) + 8; R = Math.min(R, innerWidth) - 8; B = Math.min(B, innerHeight) - 8;
  const inside = (h, n, x, y) => { let sign = 0; for (let j = 0; j < n; j++) { const ax = h[2 * j], ay = h[2 * j + 1], bx = h[2 * ((j + 1) % n)], by = h[2 * ((j + 1) % n) + 1]; const s = (bx - ax) * (y - ay) - (by - ay) * (x - ax); if (Math.abs(s) < 1e-9) continue; if (!sign) sign = Math.sign(s); else if (Math.sign(s) !== sign) return false; } return true; };
  const rank = (name) => (/^skin\.fair/.test(name) ? 0 : /^fus\./.test(name) ? 1 : /^wings\./.test(name) ? 2 : 3);
  const candidates = [];
  for (let k = order.length - 1; k >= 0; k--) { const i = order[k], f = frames[i]; if (f && f.hullN >= 3) candidates.push([rank(runs[i].name), k, i]); }
  candidates.sort((p, q) => p[0] - q[0] || q[1] - p[1]);
  for (const [, k, i] of candidates) {
    const f = frames[i], n = f.hullN, h = f.hull;
    let x = 0, y = 0; for (let j = 0; j < n; j++) (x += h[2 * j], y += h[2 * j + 1]); x /= n; y /= n;
    let top = -1; for (let m = order.length - 1; m >= 0; m--) { const g = frames[order[m]]; if (g && g.hullN >= 3 && inside(g.hull, g.hullN, x, y)) { top = order[m]; break; } }
    if (top !== i) continue;
    const [cx, cy] = toClient(x, y);
    if (!(cx > L && cx < R && cy > T && cy < B)) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (!hit || !stage.contains(hit)) continue;
    return { x: cx, y: cy, part: runs[i].name };
  }
  return null;
})()`;

async function runDevice(url, name, device, { idle, out, minText, site }) {
  const result = { name, ...device, faults: [], notes: [] };
  const page = await open(url, device);
  try {
    let mounted = null;
    for (let w = 0; w < 180000; w += 200) {
      await sleep(200);
      if (await page.evaluate("document.readyState === 'complete' && Boolean((window.__a380 && window.__a380.controller) || (window.__isoTurn && window.__isoTurn.controller))").catch(() => false)) {
        mounted = Date.now() - page.t0;
        break;
      }
    }
    result.mountMs = mounted;
    if (mounted == null) {
      result.faults.push("the page did not mount in 180 s");
      return result;
    }
    const a380 = await page.evaluate("Boolean(window.__a380)");
    // the A380's WebGL layer: glInfo.pending 0 and the fade done (pv.glShare); other figures skip this
    let gl = null;
    for (let w = 0; a380 && w < 60000; w += 250) {
      gl = await page.evaluate("window.__a380.glInfo ? { pending: __a380.glInfo.pending, share: __a380.pv ? __a380.pv.glShare : null } : null").catch(() => null);
      if (!gl) break;
      if (gl.pending === 0 && (gl.share == null || gl.share >= 0.99)) {
        result.glMs = Date.now() - page.t0;
        break;
      }
      await sleep(250);
    }
    result.renderer = await page.evaluate("(() => { const c = document.createElement('canvas').getContext('webgl'); if (!c) return 'no WebGL'; const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER); })()");
    if (/swiftshader/i.test(result.renderer)) result.notes.push("SwiftShader (software WebGL): frame times are not the GPU's");
    if (gl && result.glMs == null) result.notes.push(`WebGL not faded in after 60 s (pending ${gl.pending}, share ${gl.share})`);
    await sleep(1000);
    const shot = await page.send("Page.captureScreenshot", { format: "png" });
    mkdirSync(out, { recursive: true });
    result.shot = join(out, `${name}.png`);
    writeFileSync(result.shot, Buffer.from(shot.result.data, "base64"));
    await page.evaluate("(scrollTo(0, 0), 1)");
    const layout = await page.evaluate(LAYOUT(device.touch, minText, site));
    result.faults.push(...layout.faults);
    result.notes.push(...layout.notes);
    result.warnings = layout.warnings;
    const record = async (ms, during) => {
      await page.evaluate("(__dev.frames = [], __dev.long = [], __dev.rec = true, 1)");
      const started = Date.now();
      if (during) await during();
      const left = ms - (Date.now() - started);
      if (left > 0) await sleep(left);
      const d = await page.evaluate("(__dev.rec = false, { frames: __dev.frames, long: __dev.long })");
      return stats(d.frames, d.long);
    };
    // the page on its own (the A380's tour)
    result.idle = await record(idle);
    // a drag across the stage: 30% to 75% of its width at its middle, 40 moves 16 ms apart, then the coast (2.2 s in all)
    const box = await page.evaluate("(() => { const s = document.querySelector('.iso-turn') || document.querySelector('.iso-stage'); s.scrollIntoView({ block: 'center' }); const r = s.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()");
    await sleep(300);
    const turnOf = "window.__a380 ? __a380.pv.turn : null";
    const before = await page.evaluate(`({ turn: ${turnOf}, scrollY: scrollY })`);
    const y = box.y + box.h * 0.5;
    const x0 = box.x + box.w * 0.3;
    const x1 = box.x + box.w * 0.75;
    const steps = 40;
    const drag = async () => {
      if (device.touch) {
        await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] });
        for (let i = 1; i <= steps; i++) (await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y }] }), await sleep(16));
        await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0, y });
        await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: x0, y, button: "left", buttons: 1, clickCount: 1 });
        for (let i = 1; i <= steps; i++) (await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x0 + ((x1 - x0) * i) / steps, y, button: "left", buttons: 1 }), await sleep(16));
        await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x1, y, button: "left", buttons: 0, clickCount: 1 });
      }
    };
    result.drag = await record(2200, drag);
    const after = await page.evaluate(`({ turn: ${turnOf}, scrollY: scrollY })`);
    result.turned = before.turn != null && after.turn != null ? +(after.turn - before.turn).toFixed(1) : null;
    if (result.turned != null && Math.abs(result.turned) < 5) result.faults.push(`a drag across ${Math.round(x1 - x0)} px of the stage turned it ${result.turned}° (it should turn it)`);
    if (Math.abs(after.scrollY - before.scrollY) > 2) result.faults.push(`a sideways drag on the stage scrolled the page ${Math.round(after.scrollY - before.scrollY)} px`);
    // (fu/f4-verify) the coast ends first: the turn steady (under 0.01°) for 300 ms, at most 15 s. A tap while the stage
    // still turned landed on whatever passed under it (8 of 21 profiles named nothing at the stage's middle)
    if (a380) {
      let last = await page.evaluate(turnOf);
      let since = Date.now();
      const begun = Date.now();
      while (Date.now() - since < 300 && Date.now() - begun < 15000) {
        await sleep(50);
        const now = await page.evaluate(turnOf);
        if (Math.abs(now - last) > 0.01) (since = Date.now(), (last = now));
      }
      result.coastMs = Date.now() - begun;
      if (Date.now() - since < 300) result.notes.push("the turn was still changing 15 s after the drag");
    }
    await sleep(300);
    const tap = async (x, yy) => {
      if (device.touch) {
        await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: yy }] });
        await sleep(60);
        await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y: yy });
        await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y: yy, button: "left", buttons: 1, clickCount: 1 });
        await sleep(60);
        await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y: yy, button: "left", buttons: 0, clickCount: 1 });
      }
      await sleep(400);
    };
    // a tap on the stage: on the A380, at the projected middle of a part on top there (TARGET); on another figure, the
    // stage's middle. On a part, the A380 names it (pv.label, and its tip)
    const middle = "(() => { const s = document.querySelector('.iso-turn') || document.querySelector('.iso-stage'); const r = s.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.5, part: null }; })()";
    const named = "(() => { const t = document.querySelector('.a3-tip, .iso-tip, [role=tooltip]'); return { tip: t ? t.textContent.trim().slice(0, 60) : null, label: window.__a380 && __a380.pv.label ? String(__a380.pv.label).slice(0, 60) : null }; })()";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const spot = (a380 && (await page.evaluate(TARGET).catch(() => null))) || (await page.evaluate(middle));
      await tap(spot.x, spot.y);
      const got = a380 ? await page.evaluate("({ tip: null, label: __a380.pv.label ? String(__a380.pv.label).slice(0, 60) : null })") : await page.evaluate(named);
      result.tap = { ...got, at: [Math.round(spot.x), Math.round(spot.y)], part: spot.part, attempts: attempt };
      if (!a380 || got.label) break;
      await sleep(700);
    }
    if (a380 && !result.tap.label) result.faults.push(`two taps on the stage (the last at ${result.tap.at.join(",")}${result.tap.part ? `, on ${result.tap.part}` : ""}) named no part`);
    // a tap on the Cutaway control (the A380); the change of its target is the response
    const cut = await page.evaluate("(() => { const b = [...document.querySelectorAll('button')].find((x) => /cutaway/i.test(x.textContent)); if (!b) return null; b.scrollIntoView({ block: 'center' }); return { before: window.__a380 ? __a380.pv.cabinTarget : null }; })()");
    if (cut) {
      await sleep(300);
      const at = await page.evaluate("(() => { const b = [...document.querySelectorAll('button')].find((x) => /cutaway/i.test(x.textContent)); const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()");
      await tap(at[0], at[1]);
      const now = await page.evaluate("window.__a380 ? __a380.pv.cabinTarget : null");
      result.control = { name: "Cutaway", before: cut.before, after: now };
      if (cut.before != null && now === cut.before) result.faults.push(`a tap on Cutaway did not change the cutaway's target (${cut.before})`);
    }
    // f4-perf: full quality comes back at rest (review f3, blocker): paused, a drag and its coast, then still: the airframe
    // canvas must be back at the device's ratio (up to 4) and the governor at level 0 (full line detail) within 2 s of
    // the coast's end (owner decision 0 lowers quality only while the figure moves)
    if (a380) {
      await page.evaluate("(() => { const s = document.querySelector('.iso-turn') || document.querySelector('.iso-stage'); s.scrollIntoView({ block: 'center' }); if (!__a380.pv.paused) (s.closest('figure') || s).dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); return __a380.pv.paused; })()");
      await sleep(300);
      const b2 = await page.evaluate("(() => { const s = document.querySelector('.iso-turn') || document.querySelector('.iso-stage'); const r = s.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()");
      const yy = b2.y + b2.h * 0.5;
      const [r0, r1] = [b2.x + b2.w * 0.3, b2.x + b2.w * 0.75];
      if (device.touch) {
        await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r0, y: yy }] });
        for (let i = 1; i <= steps; i++) (await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: r0 + ((r1 - r0) * i) / steps, y: yy }] }), await sleep(16));
        await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      } else {
        await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x: r0, y: yy, button: "left", buttons: 1, clickCount: 1 });
        for (let i = 1; i <= steps; i++) (await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r0 + ((r1 - r0) * i) / steps, y: yy, button: "left", buttons: 1 }), await sleep(16));
        await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r1, y: yy, button: "left", buttons: 0, clickCount: 1 });
      }
      // the coast ends (the turn still for 0.5 s), then 2 s
      let last = null;
      const until = Date.now() + 30000;
      for (let still = 0; still < 5 && Date.now() < until; ) {
        await sleep(100);
        const t = await page.evaluate("__a380.pv.turn");
        still = last !== null && Math.abs(t - last) < 1e-3 ? still + 1 : 0;
        last = t;
      }
      await sleep(2000);
      const rest = await page.evaluate("(() => { const q = __a380.quality || {}; const c = __a380.canvas; return { paused: __a380.pv.paused, ratio: c ? c.ratio : null, want: Math.min(4, devicePixelRatio), level: q.level ?? null, rest: q.rest ?? null }; })()");
      result.rest = rest;
      if (rest.ratio != null && rest.ratio !== rest.want) result.faults.push(`at rest (paused, 2 s after a drag's coast) the airframe canvas is at ratio ${rest.ratio}, not the device's ${rest.want}`);
      if (rest.level != null && rest.level !== 0) result.faults.push(`at rest the quality governor holds level ${rest.level}, not 0 (full detail)`);
    }
    result.faults.push(...page.problems);
    return result;
  } finally {
    page.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const all = profiles();
  if (!argv.length || argv.includes("--help") || argv.includes("--list")) {
    console.log("node scripts/devices.mjs <page.html | url> [--devices a,b] [--device WxH@DPR/N[t|m]]… [--out dir] [--idle ms] [--throttle n] [--site]");
    for (const [n, d] of Object.entries(all)) console.log(`  ${n.padEnd(12)} ${d.width}x${d.height} @${d.dpr} ${d.touch ? "touch" : "mouse"} ${d.throttle}x CPU  ${d.what}`);
    process.exit(argv.includes("--list") ? 0 : 1);
  }
  const value = (flag, fallback) => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : fallback;
  };
  const VALUED = new Set(["--devices", "--device", "--out", "--idle", "--throttle", "--min-text"]); // fu/f4-verify: --site takes no value
  const target = argv.find((a, i) => !a.startsWith("--") && !(i && VALUED.has(argv[i - 1])));
  const url = /^https?:|^file:/.test(target) ? target : pathToFileURL(resolve(target)).href;
  const out = resolve(value("--out", "a380/tmp/devices"));
  const idle = Number(value("--idle", 3000));
  const minText = Number(value("--min-text", 11));
  const site = argv.includes("--site");
  const chosen = [];
  for (const n of (value("--devices", argv.includes("--device") ? "" : Object.keys(all).join(",")) || "").split(",").filter(Boolean)) {
    if (!all[n]) throw new Error(`no device ${n} (--list)`);
    chosen.push([n, { ...all[n] }]);
  }
  argv.forEach((a, i) => {
    if (a !== "--device") return;
    const m = argv[i + 1].match(/^(\d+)x(\d+)@([\d.]+)(?:\/(\d+(?:\.\d+)?)?([tm])?)?$/);
    if (!m) throw new Error(`--device ${argv[i + 1]}: use WxH@DPR/N[t|m] (t touch, m mouse, N the CPU throttle)`);
    chosen.push([argv[i + 1].replace(/[^\w.@x-]/g, "_"), { width: +m[1], height: +m[2], dpr: +m[3], throttle: +(m[4] ?? 1), touch: m[5] ? m[5] === "t" : +m[1] < 600, what: "custom" }]);
  });
  if (value("--throttle", null)) for (const [, d] of chosen) d.throttle = Number(value("--throttle"));
  console.log(`devices: ${target} · ${chosen.length} profile(s), one Chrome at a time · out ${out}`);
  const results = [];
  for (const [n, d] of chosen) {
    const r = await runDevice(url, n, d, { idle, out, minText, site }).catch((e) => ({ name: n, ...d, faults: [`the run failed: ${e.message}`], notes: [] }));
    results.push(r);
    console.log(`\n${n}: ${d.width}x${d.height} CSS px, DPR ${d.dpr}, ${d.touch ? "touch" : "mouse"}, ${d.throttle}x CPU (${d.what})`);
    console.log(`  renderer ${r.renderer ?? "?"} · mounted ${r.mountMs ?? "–"} ms · WebGL faded in ${r.glMs ?? "–"} ms after navigation`);
    if (r.idle) console.log(`  on its own: ${fmt(r.idle)}`);
    if (r.drag) console.log(`  drag and coast: ${fmt(r.drag)} · turned ${r.turned}°`);
    if (r.rest) console.log(`  at rest (paused, after a drag): canvas ratio ${r.rest.ratio} (device ${r.rest.want}), governor level ${r.rest.level}, still ticks ${r.rest.rest}`); // f4-perf
    if (r.tap) console.log(`  tap on the stage${r.tap.part ? ` (on ${r.tap.part}, after a ${r.coastMs} ms coast${r.tap.attempts > 1 ? `, ${r.tap.attempts} taps` : ""})` : ""}: ${r.tap.tip || r.tap.label ? `named "${r.tap.tip || r.tap.label}"` : "named nothing"}${r.control ? ` · tap on ${r.control.name}: target ${r.control.before} → ${r.control.after}` : ""}`);
    for (const note of r.notes) console.log(`  note: ${note}`);
    for (const w of r.warnings ?? []) console.log(`  warning: ${w}`);
    for (const f of r.faults) console.log(`  FAULT: ${f}`);
    if (r.shot) console.log(`  shot ${r.shot}`);
  }
  const ms = (s, k) => (s && s[k] != null ? s[k].toFixed(1) : "–");
  const table = ["| Device | CSS px @DPR | Input | CPU | Mount ms | GL ms | Idle median / p95 ms | Drag median / p95 ms | Long tasks (drag) | Turned | Faults | Warnings |", "|---|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const r of results) table.push(`| ${r.name} | ${r.width}x${r.height} @${r.dpr} | ${r.touch ? "touch" : "mouse"} | ${r.throttle}x | ${r.mountMs ?? "–"} | ${r.glMs ?? "–"} | ${ms(r.idle, "median")} / ${ms(r.idle, "p95")} | ${ms(r.drag, "median")} / ${ms(r.drag, "p95")} | ${r.drag ? `${r.drag.longTasks} (${r.drag.longMs.toFixed(0)} ms)` : "–"} | ${r.turned ?? "–"}° | ${r.faults.length ? r.faults.join("; ") : "none"} | ${(r.warnings ?? []).join("; ") || "none"} |`);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "devices.json"), JSON.stringify({ page: target, at: new Date().toISOString(), results }, null, 1));
  writeFileSync(join(out, "devices.md"), `# Device pass: ${target}\n\n${new Date().toISOString()} · renderer ${[...new Set(results.map((r) => r.renderer))].join(", ")}\n\n${table.join("\n")}\n`);
  console.log(`\n${table.join("\n")}`);
  const bad = results.filter((r) => r.faults.length);
  console.log(bad.length ? `devices: ${bad.length} of ${results.length} with faults (${bad.map((r) => r.name).join(", ")})` : `devices passed: ${results.length} profiles, no layout fault, console clean`);
  process.exit(bad.length ? 1 : 0);
}

if (typeof WebSocket === "undefined" && !process.execArgv.includes("--experimental-websocket")) {
  const child = spawn(process.execPath, ["--experimental-websocket", ...process.argv.slice(1)], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 1));
} else await main();
