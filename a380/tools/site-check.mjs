#!/usr/bin/env node
// a380/tools/site-check.mjs (fu/f3-hosting): load the built site from a static server (a380/tools/serve-site.mjs) in
// headless Chrome, cold, and time it; or check it with JavaScript off.
//
//   node a380/tools/site-check.mjs --timing http://127.0.0.1:8741/a380/ [--runs 3] [--profiles desktop,phone,phone-slow]
//   node a380/tools/site-check.mjs --nojs http://127.0.0.1:8741/a380/ --out a380/tmp/site-work
//   node a380/tools/site-check.mjs --layout http://127.0.0.1:8741/a380/ [--out a380/tmp/site-work]
//
// Layout (fu/f4-hosting): both figure pages at 320 × 568, 390 × 844 and 844 × 390 (touch, mobile) and 1280 × 800 and
// 1440 × 900 (mouse): every site-bar link lies on the page (top ≥ 0), is inside the viewport once scrolled to, and is
// the element at its own centre; touch links are at least 44 px tall; the card (.iso-plate) is not moved by the site
// layer (its rect equals the one with the layer removed) and, with the no-WebGL note shown, the card still ends where
// it ended without it. Exits 1 on any failure. --nojs also checks that the Credits link can be reached.
//
// Timing: each run is a fresh Chrome profile with the cache disabled, navigating to the URL given (index.html follows
// its theme pick with location.replace, which is counted). Times are from the navigation request: the HTML received,
// DOMContentLoaded, first contentful paint, the figure mounted (window.__a380.controller), and first light: every WebGL
// program linked and GL faded in (glShare ≥ 0.999), the moment the page's lights are whole (the measure turn-check
// reports as "GL ready … after the mount"). Profiles:
//   desktop     1440 × 1100 at DPR 2, no throttling
//   phone       390 × 844 at DPR 3, mobile, 4× CPU throttle, a 4G network (9 Mbps down, 1.5 up, 60 ms RTT)
//   phone-slow  the same on Lighthouse's slow 4G (1.6 Mbps down, 750 kbps up, 150 ms RTT)
// The renderer is printed; a SwiftShader run is flagged. Medians and every run go to stdout and --json file.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";


function chromePath() {
  const candidates = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
  const cache = join(homedir(), ".cache/ms-playwright");
  if (existsSync(cache)) for (const dir of readdirSync(cache).sort().reverse()) for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) candidates.push(join(cache, dir, sub));
  return candidates.find((p) => existsSync(p));
}

async function open() {
  const profile = mkdtempSync(join(tmpdir(), "site-check-"));
  const chrome = spawn(chromePath(), ["--headless=new", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-angle=gl-egl", "about:blank"]);
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
      if (m) {
        clearTimeout(timer);
        done(Number(m[1]));
      }
    });
  });
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const problems = [];
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    } else if (data.method === "Runtime.consoleAPICalled" && /error|warning/.test(data.params.type)) problems.push(`console.${data.params.type}: ${data.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`);
    else if (data.method === "Runtime.exceptionThrown") problems.push(`exception: ${data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text}`.slice(0, 300));
    else if (data.method === "Network.loadingFailed" && !/net::ERR_ABORTED/.test(data.params.errorText)) problems.push(`request failed: ${data.params.errorText}`);
    else if (data.method === "Network.responseReceived" && data.params.response.status >= 400) problems.push(`HTTP ${data.params.response.status} ${data.params.response.url}`);
  };
  await new Promise((done) => (socket.onopen = done));
  const send = (method, params = {}) =>
    new Promise((done) => {
      const call = ++id;
      pending.set(call, done);
      socket.send(JSON.stringify({ id: call, method, params }));
    });
  const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
  const close = () => {
    socket.close();
    reap();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {}
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Network.enable");
  await send("Network.setCacheDisabled", { cacheDisabled: true });
  return { send, evaluate, close, problems };
}

// recorded in every document from its start: absolute times (epoch ms) of the milestones
const PROBE = `(() => {
  const T = (window.__siteT = { origin: performance.timeOrigin, href: location.href });
  const now = () => performance.timeOrigin + performance.now();
  try { new PerformanceObserver((list) => { for (const e of list.getEntries()) if (e.name === "first-contentful-paint") T.fcp = performance.timeOrigin + e.startTime; }).observe({ type: "paint", buffered: true }); } catch {}
  document.addEventListener("DOMContentLoaded", () => (T.dcl = now()));
  const tick = setInterval(() => {
    const A = window.__a380;
    if (!T.mount && A && A.controller) T.mount = now();
    const g = A && A.glInfo;
    if (!T.light && g && g.pending === 0 && (!g.ok || (A.pv && A.pv.glShare >= 0.999))) { T.light = now(); T.glOk = g.ok; T.renderer = g.renderer; clearInterval(tick); }
  }, 20);
})();`;

const PROFILES = {
  desktop: { width: 1440, height: 1100, scale: 2, mobile: false, cpu: 1, net: null },
  phone: { width: 390, height: 844, scale: 3, mobile: true, cpu: 4, net: { latency: 60, downloadThroughput: (9e6 / 8) | 0, uploadThroughput: (1.5e6 / 8) | 0 } },
  "phone-slow": { width: 390, height: 844, scale: 3, mobile: true, cpu: 4, net: { latency: 150, downloadThroughput: (1.6e6 / 8) | 0, uploadThroughput: (750e3 / 8) | 0 } },
};

async function timing(url, runs, names, jsonOut) {
  const all = {};
  for (const name of names) {
    const P = PROFILES[name];
    all[name] = [];
    for (let r = 0; r < runs; r++) {
      const b = await open();
      await b.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
      await b.send("Emulation.setDeviceMetricsOverride", { width: P.width, height: P.height, deviceScaleFactor: P.scale, mobile: P.mobile });
      if (P.mobile) await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      if (P.cpu > 1) await b.send("Emulation.setCPUThrottlingRate", { rate: P.cpu });
      if (P.net) await b.send("Network.emulateNetworkConditions", { offline: false, ...P.net });
      const t0 = Date.now();
      await b.send("Page.navigate", { url });
      let T = null;
      for (let waited = 0; waited < 180000; waited += 250) {
        await new Promise((d) => setTimeout(d, 250));
        T = await b.evaluate("window.__siteT && window.__siteT.light ? JSON.stringify({ ...window.__siteT, nav: performance.getEntriesByType('navigation')[0]?.toJSON() }) : null").catch(() => null);
        if (T) break;
      }
      if (!T) {
        console.log(`${name} run ${r + 1}: no first light in 180 s · ${b.problems.join(" | ")}`);
        b.close();
        continue;
      }
      T = JSON.parse(T);
      const n = T.nav;
      const at = (abs) => (abs ? Math.round(abs - t0) : null);
      const row = {
        html: at(T.origin + n.responseEnd),
        dcl: at(T.dcl),
        fcp: at(T.fcp),
        mount: at(T.mount),
        light: at(T.light),
        lightAfterMount: T.mount ? Math.round(T.light - T.mount) : null,
        transfer: n.transferSize,
        encoded: n.encodedBodySize,
        decoded: n.decodedBodySize,
        page: T.href.replace(/^.*\//, ""),
        renderer: T.renderer,
        glOk: T.glOk,
        problems: [...b.problems],
      };
      all[name].push(row);
      console.log(`${name} run ${r + 1}: ${row.page} · HTML received ${row.html} ms (${(row.transfer / 1024).toFixed(0)} KB on the wire, ${(row.decoded / 1024).toFixed(0)} KB) · DOMContentLoaded ${row.dcl} · first contentful paint ${row.fcp} · mounted ${row.mount} · first light ${row.light} ms (${row.lightAfterMount} after the mount) · ${row.renderer ?? "no WebGL"}${/SwiftShader/i.test(row.renderer ?? "") ? " (SWIFTSHADER)" : ""}${row.problems.length ? ` · ${row.problems.join(" | ")}` : " · clean"}`);
      b.close();
    }
    const med = (key) => {
      const v = all[name].map((x) => x[key]).filter((x) => x != null).sort((a, b) => a - b);
      return v.length ? v[(v.length - 1) >> 1] : null;
    };
    if (all[name].length) console.log(`${name} median of ${all[name].length}: HTML ${med("html")} ms · DCL ${med("dcl")} · FCP ${med("fcp")} · mounted ${med("mount")} · first light ${med("light")} ms (${med("lightAfterMount")} after the mount)`);
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ url, runs, at: new Date().toISOString(), profiles: PROFILES, results: all }, null, 1));
}

const failures = [];

const VIEWPORTS = [
  ["320x568", 320, 568, true],
  ["390x844", 390, 844, true],
  ["844x390", 844, 390, true],
  ["1280x800", 1280, 800, false],
  ["1440x900", 1440, 900, false],
];
// measured in the page: the bar's links (on the page, in view once scrolled to, hit at their centre, height), the card's
// rect at scroll 0 with the layer, with the no-WebGL note shown, and with the whole site layer removed
const MEASURE = `(async () => {
  const frame = () => new Promise((d) => requestAnimationFrame(() => requestAnimationFrame(d)));
  const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y + scrollY), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom + scrollY) }; };
  const plate = document.querySelector('.iso-plate');
  const out = { inner: [innerWidth, innerHeight], coarse: matchMedia('(any-pointer: coarse)').matches, links: [] };
  scrollTo(0, 0); await frame();
  out.plate = R(plate);
  for (const a of document.querySelectorAll('.site-bar a')) {
    const page = R(a);
    a.scrollIntoView({ block: 'center' }); await frame();
    const r = a.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    out.links.push({ text: a.textContent, page, inView: r.top >= -0.5 && r.left >= -0.5 && r.bottom <= innerHeight + 0.5 && r.right <= innerWidth + 0.5, rect: [r.x, r.y, r.right, r.bottom].map((v) => Math.round(v * 10) / 10), scroll: scrollY, hit: !!hit && (hit === a || a.contains(hit)), h: Math.round(r.height) });
  }
  scrollTo(0, 0); await frame();
  const nogl = document.getElementById('site-nogl');
  nogl.hidden = false; await frame(); out.plateNogl = R(plate); out.nogl = R(nogl); nogl.hidden = true;
  const layer = [...document.querySelectorAll('.site-bar, .site-note')];
  const marks = layer.map((e) => { const m = document.createComment('site'); e.replaceWith(m); return [m, e]; });
  await frame(); out.plateBare = R(plate);
  for (const [m, e] of marks) m.replaceWith(e);
  await frame();
  return JSON.stringify(out);
})()`;

async function layout(url, out) {
  mkdirSync(out, { recursive: true });
  const base = url.replace(/[^/]*$/, "");
  for (const page of ["a380.html", "a380-light.html"])
    for (const [name, width, height, touch] of VIEWPORTS) {
      const b = await open();
      await b.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: touch ? 3 : 1, mobile: touch });
      if (touch) await b.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      await b.send("Page.navigate", { url: base + page });
      let ready = false;
      for (let waited = 0; waited < 120000 && !ready; waited += 250) {
        await new Promise((d) => setTimeout(d, 250));
        ready = await b.evaluate("!!(window.__a380 && window.__a380.controller && document.fonts && document.fonts.status === 'loaded')").catch(() => false);
      }
      const where = `${page} ${name}${touch ? " touch" : ""}`;
      if (!ready) {
        failures.push(`${where}: the figure did not mount in 120 s`);
        b.close();
        continue;
      }
      await new Promise((d) => setTimeout(d, 600));
      const m = JSON.parse(await b.evaluate(MEASURE));
      const bad = [];
      if (m.links.length !== 3) bad.push(`${m.links.length} site-bar links, not 3`);
      for (const l of m.links) {
        if (l.page.y < 0) bad.push(`${l.text} above the page (top ${l.page.y})`);
        if (!l.inView) bad.push(`${l.text} not inside the viewport when scrolled to (at ${l.rect.join(',')} scrolled ${l.scroll})`);
        if (!l.hit) bad.push(`${l.text} not the element at its centre`);
        if (touch && l.h < 44) bad.push(`${l.text} ${l.h} px tall (< 44)`);
      }
      if (touch && !m.coarse) bad.push("touch emulation did not give any-pointer: coarse");
      const same = (p, q) => p.x === q.x && p.y === q.y && p.w === q.w && p.h === q.h;
      if (!same(m.plate, m.plateBare)) bad.push(`the site layer moves the card: ${JSON.stringify(m.plate)} against ${JSON.stringify(m.plateBare)} without it`);
      if (!same(m.plateNogl, m.plate)) bad.push(`the no-WebGL note moves the card: ${JSON.stringify(m.plateNogl)} against ${JSON.stringify(m.plate)}`);
      const shot = await b.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(4000, Math.max(height, m.links.reduce((y, l) => Math.max(y, l.page.b), 0) + 24)), scale: 1 } });
      const file = join(out, `layout-${page.replace(".html", "")}-${name}.png`);
      writeFileSync(file, Buffer.from(shot.result.data, "base64"));
      if (b.problems.length) bad.push(...b.problems);
      console.log(`${where}: plate ${m.plate.x},${m.plate.y} ${m.plate.w}x${m.plate.h} (bottom ${m.plate.b} of ${height}) · links ${m.links.map((l) => `${l.text}@${l.page.x},${l.page.y} ${l.page.w}x${l.h}${l.inView && l.hit ? "" : " (!)"}`).join(", ")} · no-WebGL note at ${m.nogl.y}..${m.nogl.b} · ${bad.length ? "FAIL: " + bad.join("; ") : "ok"} · ${file}`);
      for (const x of bad) failures.push(`${where}: ${x}`);
      b.close();
    }
}

async function nojs(url, out) {
  mkdirSync(out, { recursive: true });
  const base = url.replace(/[^/]*$/, "");
  for (const [name, path, width] of [["index", "", 1440], ["dark", "a380.html", 1440], ["light", "a380-light.html", 390]]) {
    const b = await open();
    await b.send("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
    await b.send("Emulation.setScriptExecutionDisabled", { value: true });
    await b.send("Page.navigate", { url: base + path });
    await new Promise((d) => setTimeout(d, 3000));
    const credits = await b.evaluate(`(() => { const a = [...document.querySelectorAll('a[href="credits.html"]')].find((e) => e.offsetParent); if (!a) return 'no Credits link shown'; a.scrollIntoView({ block: 'center' }); const r = a.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit && (hit === a || a.contains(hit)) ? 'ok' : 'Credits link covered or off screen'; })()`);
    if (credits !== "ok") failures.push(`nojs ${name}: ${credits}`);
    await b.evaluate("scrollTo(0, 0)");
    const info = await b.evaluate("JSON.stringify({ credits: " + JSON.stringify(credits) + ", href: location.href, noscriptShown: [...document.querySelectorAll('.site-note, .card')].filter((e) => e.offsetParent).map((e) => e.textContent.slice(0, 60)), figure: document.querySelector('.iso-figure') ? getComputedStyle(document.querySelector('.iso-figure')).display : null, imgs: [...document.images].filter((i) => i.offsetParent).map((i) => i.naturalWidth + 'x' + i.naturalHeight) })");
    const shot = await b.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(join(out, `nojs-${name}.png`), Buffer.from(shot.result.data, "base64"));
    console.log(`nojs ${name}: ${info} · ${b.problems.length ? b.problems.join(" | ") : "clean"} · ${join(out, `nojs-${name}.png`)}`);
    b.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const value = (flag, fallback) => {
    const at = argv.indexOf(flag);
    return at >= 0 ? argv[at + 1] : fallback;
  };
  if (argv.includes("--timing")) await timing(value("--timing"), Number(value("--runs", 3)), value("--profiles", "desktop,phone,phone-slow").split(","), value("--json", null));
  else if (argv.includes("--nojs")) await nojs(value("--nojs"), value("--out", "a380/tmp/site-work"));
  else if (argv.includes("--layout")) await layout(value("--layout"), value("--out", "a380/tmp/site-work"));
  else console.log("usage: site-check.mjs --timing <url> [--runs 3] [--profiles desktop,phone,phone-slow] [--json file] | --nojs <url> [--out dir] | --layout <url> [--out dir]");
  if (failures.length) {
    console.log(`site-check: FAILED (${failures.length}):\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  if (argv.includes("--layout") || argv.includes("--nojs")) console.log("site-check: passed");
  process.exit(0);
}

// run (at the end, after the constants above are initialised)
if (typeof WebSocket === "undefined" && !process.execArgv.includes("--experimental-websocket")) {
  const child = spawn(process.execPath, ["--experimental-websocket", ...process.argv.slice(1)], { stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(signal, () => child.kill(signal));
  child.on("exit", (code) => process.exit(code ?? 1));
} else await main();
