// f3-painter: the GL painter against the canvas painter, pixel for pixel, in one page and one frame.
//
//   node a380/tools/gl-parity.mjs page.html [--width 1440] [--height 1100] [--scale 2] [--out dir] [--images worst|all|none]
//                                 [--states default|quick] [--samples 4]
//
// The page is opened with ?painter=gl&tee=1: every call the canvas painter makes goes to the WebGL context and to a 2D
// context on an unseen canvas of the same size (kit/gl-painter.mjs gpTee), so the two pictures are the same ops at the
// same moment; the model is paused at each state. For each state: the share of painted pixels (either picture covers
// them) whose premultiplied channels are all within 8 and within 2 levels, the largest difference, and the 32-px cells
// with the most pixels over 8. --images writes gl, canvas and diff PNGs (diff: grey = within 8, red = over 8).
// Exit 1 when the page fails to mount, the console is not clean, or WebGL is not on the GPU.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const target = argv.find((a) => !a.startsWith("--") && !argv[argv.indexOf(a) - 1]?.startsWith("--"));
if (!target) {
  console.log("usage: node a380/tools/gl-parity.mjs page.html [--width 1440] [--height 1100] [--scale 2] [--out dir] [--images worst|all|none] [--states default|quick]");
  process.exit(2);
}
const width = Number(value("--width", 1440));
const height = Number(value("--height", width < 600 ? 844 : 1100));
const scale = Number(value("--scale", 2));
const out = value("--out", null);
const images = value("--images", "worst");
const samples = value("--samples", null);
const statesKind = value("--states", "default");
if (out) mkdirSync(out, { recursive: true });

function chromePath() {
  const linux = join(homedir(), ".cache/ms-playwright");
  const c = [process.env.CHROME_PATH].filter(Boolean);
  if (existsSync(linux)) for (const dir of readdirSync(linux).sort().reverse()) for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) c.push(join(linux, dir, sub));
  return c.find((p) => existsSync(p));
}

const profile = mkdtempSync(join(tmpdir(), "gl-parity-"));
const chrome = spawn(chromePath(), ["--headless=new", "--no-sandbox", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars", "--allow-file-access-from-files", "--ignore-gpu-blocklist", "--use-angle=gl-egl", "about:blank"]);
const reap = () => {
  try {
    chrome.kill("SIGKILL");
  } catch {}
  try {
    rmSync(profile, { recursive: true, force: true });
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
const info = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const socket = new WebSocket(info.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const problems = [];
socket.onmessage = (message) => {
  const data = JSON.parse(message.data);
  if (data.id && pending.has(data.id)) {
    pending.get(data.id)(data);
    pending.delete(data.id);
  } else if (data.method === "Runtime.consoleAPICalled" && (data.params.type === "error" || data.params.type === "warning")) problems.push(`console.${data.params.type}: ${data.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)}`);
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
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((d) => setTimeout(d, ms));
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: width < 600 });
// --preload file.js: a script run before the page's own (e.g. refusing WebGL1 so the lights' fallbacks draw)
if (value("--preload", null)) await send("Page.addScriptToEvaluateOnNewDocument", { source: (await import("node:fs")).readFileSync(value("--preload", null), "utf8") });
const url = `${/^file:|^https?:/.test(target) ? target.replace(/\?.*$/, "") : pathToFileURL(resolve(target)).href}?painter=gl&tee=1${samples ? `&samples=${samples}` : ""}`;
await send("Page.navigate", { url });
for (let w = 0; w < 120000; w += 250) {
  await sleep(250);
  if (await evaluate("Boolean(window.__a380 && window.__a380.canvas && window.__isoTurn && window.__a380.canvas.parity)").catch(() => false)) break;
}
// GL lights linked (the page is idle enough to hold)
for (let w = 0; w < 90000; w += 250) {
  const ok = await evaluate("(() => { const A = window.__a380, g = A.glInfo; return !g || g.pending === 0; })()").catch(() => false);
  if (ok) break;
  await sleep(250);
}
const head = await evaluate(`(() => { const A = window.__a380; const gl = A.canvas.glContexts[0]; const g = gl && gl.gl; const ext = g && g.getExtension("WEBGL_debug_renderer_info"); return { painter: document.querySelector(".a3-stage").dataset.painter, renderer: g ? g.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : g.RENDERER) : null, samples: gl ? gl.samples : null, theme: document.body.dataset.theme, views: A.inspect.views.map((v) => v.id), dpr: devicePixelRatio, ratio: A.canvas.ratio }; })()`);
console.log(`gl-parity ${target} · ${width}×${height} DPR ${scale} · theme ${head.theme} · painter ${head.painter} · ${head.renderer} · MSAA ${head.samples} · canvas ratio ${head.ratio}`);
if (head.painter !== "gl" || /swiftshader/i.test(head.renderer ?? "")) {
  console.log("FAILED: not the GL painter on the GPU");
  process.exit(1);
}

// the page's own controls, then held and paused
const run = (on) => evaluate(`(window.__a380.pv.paused = ${!on}, window.__a380.tick(), 0)`);
const hold = () => evaluate("(window.__isoTurn.set(window.__isoTurn.controller.values.air), 0)");
const read = () => evaluate(`(() => { const A = window.__a380, pv = A.pv; const cur = document.querySelector('[data-phase][aria-current="step"]'); return { cabin: +(+pv.cabin || 0).toFixed(3), cabinTarget: pv.cabinTarget, inspect: pv.inspect || null, phase: cur ? cur.dataset.phase : null, seek: Boolean(pv.seek), turn: +(+pv.turn).toFixed(2) }; })()`);
const until = async (test, ms) => {
  for (let w = 0; w < ms; w += 250) {
    const r = await read();
    if (test(r)) return r;
    await sleep(250);
  }
  return null;
};
const key = async (k, code, vk) => {
  await evaluate(`document.querySelector(".a3-stage").focus(), 0`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, text: k });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk });
  await hold();
};
const leave = async () => {
  if ((await read()).inspect) {
    await evaluate("window.__a380.inspect.leave()");
    await hold();
    await sleep(3000);
  }
};
const cutaway = async (open) => {
  if ((await read()).cabinTarget > 0.5 !== open) await key("c", "KeyC", 67);
  await until((r) => (open ? r.cabin >= 0.999 : r.cabin <= 0.001), 20000);
};
const phase = async (id) => {
  await leave();
  await evaluate(`(() => { const b = document.querySelector('[data-phase="${id}"]'); if (b) b.click(); return 0; })()`);
  await until((r) => r.phase === id && !r.seek, 40000);
  await hold();
  await sleep(1500);
};
const turn = async (deg) => {
  await evaluate(`(window.__isoTurn.set(${deg}), 0)`);
  await sleep(400);
};
const phases = await evaluate(`[...document.querySelectorAll('[data-phase]')].map((b) => b.dataset.phase)`);
const steps = [];
const add = (name, fn, spin = false) => steps.push({ name, fn, spin });
add("rest", async () => {});
const only = value("--only", null);
if (statesKind !== "quick") for (const a of [30, 75, 140, 200, 260, 330]) add(`turn ${a}`, () => turn(a));
add("cutaway", async () => {
  await leave();
  await cutaway(true);
});
if (statesKind !== "quick") add("cutaway turn 120", () => turn(120));
for (const v of head.views) add(`inspect ${v}`, async () => {
  await evaluate(`window.__a380.inspect.step(0, ${JSON.stringify(v)})`);
  await hold();
  await sleep(4500);
});
add("leave", async () => {
  await leave();
  await cutaway(false);
});
if (statesKind !== "quick") for (const p of [...new Set(phases)].filter((p) => p !== "GATE")) add(`phase ${p}`, () => phase(p));

// a spin-only repaint (kit patch 11's hub rects: clip, clear and redraw), compared without a full paint after it
add("spin repaint", async () => {
  await leave();
}, true);
// the backing store at the page's rest cap (4: the device's own ratio, 3 on a DPR 3 phone), then back to 2
add("ratio cap 4", async () => {
  await leave();
  await evaluate("(window.__a380.canvas.setMaxRatio(4), 0)");
});
add("ratio cap 2", async () => {
  await evaluate("(window.__a380.canvas.setMaxRatio(2), 0)");
});
// a resize across 600 px and back (the canvas painter's ResizeObserver, the wings' and tail's re-bake through restyle,
// the GL target reallocated)
const other = width < 600 ? 1440 : 390;
add(`resize to ${other}`, async () => {
  await send("Emulation.setDeviceMetricsOverride", { width: other, height: other < 600 ? 844 : 1100, deviceScaleFactor: scale, mobile: other < 600 });
  await sleep(2500);
});
add(`resize back to ${width}`, async () => {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: width < 600 });
  await sleep(2500);
});
if (only) steps.splice(0, steps.length, ...steps.filter((s) => s.name === "rest" || new RegExp(only).test(s.name)));
const results = [];
for (const step of steps) {
  await run(true);
  try {
    await step.fn();
  } catch (e) {
    console.log(`${step.name}: could not reach (${e.message.slice(0, 120)})`);
  }
  await hold();
  await run(false);
  await sleep(800);
  const want = images === "all";
  // a spin step: a full paint, then every hub turned and only their rects repainted (the clip, clear and redraw path)
  const paintJs = step.spin ? `A.canvas.paint(); for (const k of A.canvas.spinKeys) A.canvas.spin(k, 0.7); const st = A.canvas.paint({ spinsOnly: true }); window.__spinRects = st.rects;` : "A.canvas.paint();";
  const r = (await evaluate(`(async () => { const A = window.__a380; A.canvas.paint(); await new Promise((d) => requestAnimationFrame(() => setTimeout(d, 0))); ${paintJs} return A.canvas.parity({ images: ${want} }); })()`))[0];
  // --probe: the first call that makes the two pictures differ at the worst structural pixels
  // (--probe-bright: the pixels where the GL picture is most brighter instead)
  const probeAt = argv.includes("--probe-bright") ? r.bright.map(([, x, y]) => ({ px: [0, x, y] })) : r.sworst;
  if (argv.includes("--probe") || argv.includes("--probe-bright")) for (const cellInfo of probeAt.slice(0, Number(value("--probe-n", 3)))) {
    const [, x, y] = cellInfo.px;
    const pr = (await evaluate(`window.__a380.canvas.probe(${x}, ${y})`));
    console.log(`  probe ${x},${y}: ${JSON.stringify(pr)}`);
  }
  if (step.spin) console.log(`spin repaint: ${await evaluate("window.__a380.canvas.spinKeys.length")} hub keys, ${await evaluate("window.__spinRects")} rects repainted`);
  const now = await read();
  r.name = step.name;
  r.at = now;
  results.push(r);
  console.log(`${step.name.padEnd(22)} ${r.W}×${r.H} (ratio ${await evaluate("window.__a380.canvas.ratio")}) · painted ${r.painted} · within 8 ${(100 * r.within8).toFixed(3)}% · within 2 ${(100 * r.within2).toFixed(2)}% · light ratio ${r.light.toFixed(4)} · over8 brighter/darker ${r.brighter}/${r.darker} · structural ${r.structural}${r.sworst.length ? ` at ${r.sworst.slice(0, 3).map((c) => `${c.x},${c.y}:${c.structural}`).join()}` : ""} · max ${Math.round(r.max)} · worst cells ${r.worst.slice(0, 3).map((c) => `${c.x},${c.y}:${c.over8}`).join(" ")} · phase ${now.phase} cutaway ${now.cabin} view ${now.inspect ?? "none"} turn ${now.turn}`);
  if (out && want) for (const k of ["gl", "canvas", "diff", "crop"]) writeFileSync(join(out, `${step.name.replace(/\W+/g, "-")}-${k}.png`), Buffer.from(r[k].split(",")[1], "base64"));
  delete r.gl;
  delete r.canvas;
  delete r.diff;
  delete r.crop;
}
// the worst state's pictures
if (out && images === "worst" && results.length) {
  const worst = results.reduce((a, b) => (b.within8 < a.within8 ? b : a));
  const idx = results.indexOf(worst);
  await run(true);
  await steps[idx].fn().catch(() => {});
  await hold();
  await run(false);
  await sleep(800);
  const r = (await evaluate(`(async () => { const A = window.__a380; A.canvas.paint(); await new Promise((d) => requestAnimationFrame(() => setTimeout(d, 0))); A.canvas.paint(); return A.canvas.parity({ images: true }); })()`))[0];
  for (const k of ["gl", "canvas", "diff", "crop"]) writeFileSync(join(out, `worst-${worst.name.replace(/\W+/g, "-")}-${k}.png`), Buffer.from(r[k].split(",")[1], "base64"));
  console.log(`worst state ${worst.name}: images in ${out}`);
}
const painted = results.reduce((s, r) => s + r.painted, 0);
const over = results.reduce((s, r) => s + r.over8, 0);
const stats = await evaluate("window.__a380.canvas.glStats");
console.log(`summary: ${results.length} states · painted pixels within 8 levels ${(100 * (1 - over / painted)).toFixed(3)}% overall, worst state ${(100 * Math.min(...results.map((r) => r.within8))).toFixed(3)}% · unsupported ${JSON.stringify(stats.flatMap((s) => s.unsupported))}`);
console.log(`console: ${problems.length ? problems.join(" | ") : "clean"}`);
if (out) writeFileSync(join(out, `parity-${head.theme}-${width}-${scale}.json`), JSON.stringify({ head, results }, null, 1));
reap();
process.exit(problems.length ? 1 : 0);
