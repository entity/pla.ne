// f3-painter: where a turned frame's time goes, canvas painter against GL painter, in one window.
//
//   node a380/tools/gl-prof.mjs page.html [--painter canvas|gl] [--width 1440] [--scale 2] [--throttle 1] [--frames 120]
//                               [--state rest|cutaway|inspect:<id>] [--profile] [--trace]
//
// Holds the page (paused), then turns it 1.1° a frame through window.__a380.tick inside requestAnimationFrame (as
// turn-check --perf). Prints the main thread's task time a frame (Performance.getMetrics), with --profile the top
// functions by self time (CDP Profiler), with --trace the GPU process main thread's busy time a frame (CrGpuMain,
// from a Chrome trace) and the renderer main thread's.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const target = argv[0];
const painter = value("--painter", "canvas");
const width = Number(value("--width", 1440));
const height = Number(value("--height", width < 600 ? 844 : 1100));
const scale = Number(value("--scale", width < 600 ? 3 : 2));
const throttle = Number(value("--throttle", 1));
const frames = Number(value("--frames", 120));
const state = value("--state", "rest");
const doProfile = argv.includes("--profile");
const doTrace = argv.includes("--trace");

const linux = join(homedir(), ".cache/ms-playwright");
const cands = [process.env.CHROME_PATH].filter(Boolean);
if (existsSync(linux)) for (const dir of readdirSync(linux).sort().reverse()) cands.push(join(linux, dir, "chrome-linux64/chrome"));
const profileDir = mkdtempSync(join(tmpdir(), "gl-prof-"));
const chrome = spawn(cands.find((p) => existsSync(p)), ["--headless=new", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${profileDir}`, "--no-first-run", "--hide-scrollbars", "--allow-file-access-from-files", "--ignore-gpu-blocklist", "--use-angle=gl-egl", "about:blank"]);
const reap = () => {
  try {
    chrome.kill("SIGKILL");
  } catch {}
  try {
    rmSync(profileDir, { recursive: true, force: true });
  } catch {}
};
process.on("exit", reap);
const port = await new Promise((done) => {
  let text = "";
  chrome.stderr.on("data", (c) => {
    text += c;
    const m = text.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
    if (m) done(Number(m[1]));
  });
});
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const info = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const open = async (url) => {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    } else events.push(d);
  };
  await new Promise((d) => (ws.onopen = d));
  const send = (method, params = {}) =>
    new Promise((done) => {
      const call = ++id;
      pending.set(call, done);
      ws.send(JSON.stringify({ id: call, method, params }));
    });
  return { send, events, ws };
};
const page = await open(info.webSocketDebuggerUrl);
const browser = await open(version.webSocketDebuggerUrl);
const send = page.send;
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((d) => setTimeout(d, ms));
await send("Runtime.enable");
await send("Page.enable");
await send("Performance.enable");
await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: width < 600 });
const samples = value("--samples", null);
const url = pathToFileURL(resolve(target)).href + (painter === "gl" ? `?painter=gl${samples ? `&samples=${samples}` : ""}` : "?painter=canvas");
await send("Page.navigate", { url });
for (let w = 0; w < 120000; w += 250) {
  await sleep(250);
  if (await evaluate("Boolean(window.__a380 && window.__a380.canvas && window.__isoTurn)").catch(() => false)) break;
}
for (let w = 0; w < 90000; w += 250) {
  if (await evaluate("(() => { const A = window.__a380, g = A.glInfo; return !g || (g.pending === 0 && A.pv.glShare >= 0.999); })()").catch(() => false)) break;
  await sleep(250);
}
const hold = () => evaluate("(window.__isoTurn.set(window.__isoTurn.controller.values.air), 0)");
const [kind, arg] = state.split(":");
await evaluate("(window.__a380.pv.paused = false, window.__a380.tick(), 0)");
if (kind === "cutaway") {
  await evaluate(`document.querySelector(".a3-stage").focus(), 0`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "c", code: "KeyC", windowsVirtualKeyCode: 67, text: "c" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "c", code: "KeyC", windowsVirtualKeyCode: 67 });
  await hold();
  await sleep(6000);
} else if (kind === "inspect") {
  await evaluate(`window.__a380.inspect.step(0, ${JSON.stringify(arg)})`);
  await hold();
  await sleep(4500);
}
await hold();
await evaluate("(window.__a380.pv.paused = true, window.__a380.tick(), 0)");
await sleep(1000);
if (throttle > 1) await send("Emulation.setCPUThrottlingRate", { rate: throttle });
const head = await evaluate(`(() => { const st = document.querySelector(".a3-stage"); return { painter: st.dataset.painter, ratio: window.__a380.canvas.ratio }; })()`);
// the painter's own time a frame: paint() (stats().ms) and, for the GL painter, the commit after it (a microtask:
// the batch's upload, draw and blit calls), timed by wrapping the contexts' commit
const loop = (n) => `(async () => { const A = window.__a380; const out = []; const paint = []; let commit = 0; const cs = (A.canvas.glContexts || []); const C = A.controller; const setOrig = C.set; let setMs = 0; C.set = function (...a) { const t = performance.now(); const r = setOrig.apply(this, a); setMs += performance.now() - t; return r; }; const orig = cs.map((c) => c.commit); cs.forEach((c, k) => { c.commit = function () { const t = performance.now(); const r = orig[k].call(this); commit += performance.now() - t; return r; }; }); for (let i = 0; i < ${n}; i++) { await new Promise((d) => requestAnimationFrame(() => { const t = performance.now(); A.pv.turn += 1.1; A.tick(performance.now()); out.push(performance.now() - t); paint.push(A.canvas.stats().ms); d(); })); } cs.forEach((c, k) => { c.commit = orig[k]; }); C.set = setOrig; const med = (v) => [...v].sort((a, b) => a - b)[v.length >> 1]; return { tick: med(out), paint: med(paint), commit: commit / ${n}, set: setMs / ${n}, ms: out.reduce((a, b) => a + b, 0) }; })()`;
await evaluate(loop(20));
const metric = async () => Object.fromEntries((await send("Performance.getMetrics")).result.metrics.map((m) => [m.name, m.value]));
if (doProfile) {
  await send("Profiler.enable");
  await send("Profiler.setSamplingInterval", { interval: Number(value("--interval", 200)) });
  await send("Profiler.start");
}
if (doTrace) {
  await browser.send("Tracing.start", { traceConfig: { includedCategories: ["toplevel", "disabled-by-default-devtools.timeline", "gpu", "viz"], recordMode: "recordContinuously" }, transferMode: "ReturnAsStream" });
}
const s0 = painter === "gl" ? await evaluate("window.__a380.canvas.glStats") : null;
const m0 = await metric();
const w0 = Date.now();
const r = await evaluate(loop(frames));
const wall = Date.now() - w0;
const m1 = await metric();
const task = ((m1.TaskDuration - m0.TaskDuration) * 1000) / frames;
const script = ((m1.ScriptDuration - m0.ScriptDuration) * 1000) / frames;
console.log(`${painter} (${head.painter}, ratio ${head.ratio}) ${state} ${width}px DPR ${scale} ${throttle}x · tick ${r.tick.toFixed(2)} ms (median, in rAF) · paint ${r.paint.toFixed(2)} ms (median) + commit ${r.commit.toFixed(2)} ms · set() ${r.set.toFixed(2)} ms · task ${task.toFixed(2)} ms · script ${script.toFixed(2)} ms a frame · interval ${(wall / frames).toFixed(1)} ms a frame (wall) · load ${(await import("node:os")).loadavg()[0].toFixed(1)}`);
if (doTrace) {
  const done = new Promise((d) => {
    const iv = setInterval(() => {
      const e = browser.events.find((x) => x.method === "Tracing.tracingComplete");
      if (e) {
        clearInterval(iv);
        d(e.params.stream);
      }
    }, 100);
  });
  await browser.send("Tracing.end");
  const stream = await done;
  let text = "";
  for (;;) {
    const c = await browser.send("IO.read", { handle: stream, size: 1 << 22 });
    text += c.result.base64Encoded ? Buffer.from(c.result.data, "base64").toString() : c.result.data;
    if (c.result.eof) break;
  }
  const events = JSON.parse(text).traceEvents ?? JSON.parse(text);
  const names = new Map();
  for (const e of events) if (e.ph === "M" && e.name === "thread_name") names.set(`${e.pid}:${e.tid}`, e.args.name);
  const busy = new Map();
  const tops = new Map();
  for (const e of events) {
    if (e.ph !== "X" || !e.dur) continue;
    const t = names.get(`${e.pid}:${e.tid}`) ?? "?";
    if (!/CrGpuMain|CrRendererMain|VizCompositor|Compositor/.test(t)) continue;
    if (e.name === "ThreadControllerImpl::RunTask" || e.name === "RunTask") busy.set(t, (busy.get(t) ?? 0) + e.dur);
    if (/CrGpuMain/.test(t)) tops.set(e.name, (tops.get(e.name) ?? 0) + e.dur);
  }
  console.log(`trace: busy a frame ${[...busy].map(([t, d]) => `${t} ${(d / 1000 / frames).toFixed(2)} ms`).join(" · ")}`);
  console.log(`trace: GPU main top ${[...tops].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, d]) => `${n} ${(d / 1000 / frames).toFixed(2)}`).join(" · ")}`);
}
if (doProfile) {
  const prof = (await send("Profiler.stop")).result.profile;
  const self = new Map();
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const dt = prof.timeDeltas;
  for (let i = 0; i < prof.samples.length; i++) {
    const n = byId.get(prof.samples[i]);
    const k = `${n.callFrame.functionName || "(anon)"}:${n.callFrame.lineNumber + 1}`;
    self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0));
  }
  // --lines re: the hottest source lines of the functions whose name matches
  const lineRe = value("--lines", null);
  if (lineRe) {
    const re = new RegExp(lineRe);
    const lines = new Map();
    const total = prof.timeDeltas.reduce((a, b) => a + b, 0) / prof.samples.length;
    for (const n of prof.nodes) if (re.test(n.callFrame.functionName) && n.positionTicks) for (const t of n.positionTicks) lines.set(`${n.callFrame.functionName}:${t.line}`, (lines.get(`${n.callFrame.functionName}:${t.line}`) ?? 0) + t.ticks);
    console.log(`lines: ms a frame ${[...lines].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, t]) => `${k} ${((t * total) / 1000 / frames).toFixed(2)}`).join(" · ")}`);
  }
  console.log(`profile: self ms a frame ${[...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, us]) => `${k} ${(us / 1000 / frames).toFixed(2)}`).join(" · ")}`);
}
if (painter === "gl" && s0) {
  const s1 = await evaluate("window.__a380.canvas.glStats");
  const per = Object.fromEntries(Object.keys(s1[0]).filter((k) => typeof s1[0][k] === "number").map((k) => [k, Math.round((s1[0][k] - s0[0][k]) / frames)]));
  console.log(`gl a frame: ${JSON.stringify(per)} · unsupported ${JSON.stringify(s1[0].unsupported)}`);
}
reap();
process.exit(0);
