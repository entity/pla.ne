#!/usr/bin/env node
// a380/tools/build-site.mjs (fu/f3-hosting): the deployable static site, a380/dist/, from the shipping pages.
//
//   node a380/tools/build-site.mjs [--out a380/dist] [--dark a380/a380.html] [--light a380/a380-light.html]
//                                  [--rebuild] [--url https://example.com/a380/] [--shots dir] [--fresh-shots]
//
// --rebuild      build both pages first from the working tree (build.mjs --out=a380/tmp/site-src/…, two at once)
// --url          the public address the folder will be served from (with its subpath and a trailing slash): gives the
//                Open Graph and Twitter tags absolute image and page URLs, a canonical link and a sitemap; without it
//                every link is relative (the site works from any path, but some link previews want absolute URLs)
// --shots dir    take the card images and icons from dir (og-dark.png, og-light.png, icon-*.png) instead of capturing;
//                by default they are captured with scripts/drive.mjs (headless Chrome, WebGL on the GPU) once per page
//                build and kept in a380/tmp/site-shots/<page hashes>/; --fresh-shots captures again
//
// The pages are copied byte for byte apart from additions in <head> (meta tags, icons, a small stylesheet and an inline
// script), at the top of <main> (the no-JavaScript and cannot-start notes) and at its end, after the figure (the
// no-WebGL note and the site bar: theme toggle and credits link). The figure's own markup, data and scripts are not
// changed, and the card sits where it sits in the shipping page (site-check.mjs --layout checks both). Prints each file's raw, gzip and
// brotli sizes and writes them to a380/tmp/site-report.json.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync, inflateRawSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const A380 = resolve(HERE, "..");
const ROOT = resolve(A380, "..");
const SITE = join(A380, "site");
const argv = process.argv.slice(2);
const value = (flag, fallback) => {
  const eq = argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const at = argv.indexOf(flag);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith("--") ? argv[at + 1] : fallback;
};
const has = (flag) => argv.includes(flag);
function fail(message) {
  console.error(`build-site: ${message}`);
  process.exit(1);
}
if (has("--help") || has("-h")) {
  console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 20).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}
const OUT = resolve(value("--out", join(A380, "dist")));
let URL_BASE = value("--url", "");
if (URL_BASE && !/^https:\/\/[^/]+(\/.*)?$/.test(URL_BASE)) fail(`--url must be an https URL, got ${URL_BASE}`);
if (URL_BASE && !URL_BASE.endsWith("/")) URL_BASE += "/";
// the output must be a folder of its own, never one that holds the sources
if (OUT === ROOT || OUT === A380 || !relative(OUT, A380).startsWith("..")) fail(`--out ${OUT} would hold the sources`);

const t0 = Date.now();
const log = (line) => console.log(`build-site: ${line}`);

// ---------------------------------------------------------------------------------------------
// 1. the pages
// ---------------------------------------------------------------------------------------------
const run = (args, file) =>
  new Promise((done, failRun) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    child.stdout.on("data", (c) => (text += c));
    child.stderr.on("data", (c) => (text += c));
    child.on("exit", (code) => {
      if (file) writeFileSync(file, text);
      if (code === 0) done(text);
      else failRun(new Error(`${args.join(" ")} exited ${code}\n${text.slice(-3000)}`));
    });
  });
let pages = { dark: resolve(value("--dark", join(A380, "a380.html"))), light: resolve(value("--light", join(A380, "a380-light.html"))) };
if (has("--rebuild")) {
  const dir = join(A380, "tmp", "site-src");
  mkdirSync(dir, { recursive: true });
  pages = { dark: join(dir, "a380.html"), light: join(dir, "a380-light.html") };
  log("building both pages from the working tree (two builds at once) …");
  await Promise.all(
    Object.entries(pages).map(([theme, file]) =>
      run(["--max-old-space-size=24000", join(A380, "build.mjs"), ...(theme === "light" ? ["--light"] : []), `--out=${file}`], join(dir, `build-${theme}.txt`)).then((text) =>
        log(`${theme}: ${text.trim().split("\n").filter((l) => /wrote /.test(l)).pop() ?? "built"}`),
      ),
    ),
  );
}
const html = {};
for (const [theme, file] of Object.entries(pages)) {
  if (!existsSync(file)) fail(`no ${theme} page at ${file}`);
  html[theme] = readFileSync(file, "utf8");
  const stamp = /window\.__a380Source = (\{[^;]*\});/.exec(html[theme]);
  log(`${theme} page ${relative(ROOT, file)}: ${(html[theme].length / 1024).toFixed(0)} KB, built from ${stamp ? (({ describe, hash, at }) => `${describe} ${hash} at ${at}`)(JSON.parse(stamp[1])) : "(no source stamp)"}`);
}

// the pages must stand alone: nothing from the repo, a dev server or the network, and no verify build
const problems = [];
for (const [theme, text] of Object.entries(html)) {
  const checks = [
    [/\/home\/[a-z]|\/Users\/[A-Za-z]|\b[A-Z]:\\\\[A-Za-z]/g, "an absolute local path"],
    [/file:\/\//g, "a file:// URL"],
    [/\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?\b/g, "a local server address"],
    [/https?:\/\/(?!www\.w3\.org\/)[^\s"'`)<]+/g, "an http(s) URL other than the SVG namespace"],
    [/\b(?:src|href)\s*=\s*["']?\/\//gi, "a protocol-relative src or href"],
    [/\bimport\s*\(\s*["'`]|\bimport\s+[\w{}*,\s$]+\s+from\s*["'`]/g, "a module import"],
    [/\bfetch\s*\(\s*["'`](?!data:)/g, "a fetch of a URL"],
    [/window\.__isoVerify\s*=/g, "the verify build's audit shapes"],
  ];
  for (const [re, what] of checks) {
    const hits = [...text.matchAll(re)].map((m) => text.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, " "));
    if (hits.length) problems.push(`${theme}: ${what} (${hits.length}×), e.g. …${hits[0]}…`);
  }
  if (!text.includes('<main class="iso-page">') || !/<\/title>/.test(text)) problems.push(`${theme}: not a kit page (no <main class="iso-page"> or <title>)`);
  if (!text.includes(`<body class="iso" data-theme="${theme}">`)) problems.push(`${theme}: its body is not data-theme="${theme}"`);
}
if (problems.length) fail(`the pages are not ready to host:\n  ${problems.join("\n  ")}`);
log("pages stand alone: no local paths, no server or network addresses, no imports or fetches, not a verify build");

// ---------------------------------------------------------------------------------------------
// 2. the card images and icons (captured once per page build)
// ---------------------------------------------------------------------------------------------
const hash = (data, n = 10) => createHash("sha256").update(data).digest("hex").slice(0, n);
const favicon = readFileSync(join(SITE, "favicon.svg"));
const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
const mark = "// " + "@shots";
const captureSource = self.slice(self.indexOf(`${mark}:`), self.indexOf(`${mark} end`));
if (captureSource.length < 2000) fail("cannot find the capture code's markers in build-site.mjs");
const shotsKey = hash(`${html.dark}\0${html.light}\0${favicon}\0${captureSource}`, 12);
const shots = resolve(value("--shots", join(A380, "tmp", "site-shots", shotsKey)));
const SHOT_FILES = ["og-dark.png", "og-light.png", "icon-32.png", "icon-180.png", "icon-192.png", "icon-512.png"];
if (has("--fresh-shots") || !SHOT_FILES.every((f) => existsSync(join(shots, f)))) {
  if (value("--shots", null)) fail(`--shots ${shots} lacks ${SHOT_FILES.filter((f) => !existsSync(join(shots, f))).join(", ")}`);
  await capture(shots);
} else log(`card images and icons from ${relative(ROOT, shots)} (captured before for these pages)`);

// @shots: the capture (its source is part of the cache key)
async function capture(dir) {
  mkdirSync(dir, { recursive: true });
  const drive = join(ROOT, "scripts", "drive.mjs");
  const READOUT = "document.querySelector('[data-readout]').textContent";
  // take-off above 100 kt, paused, GL faded in, at bearing 45° (turn −5): the release captures' takeoff-b45
  const takeoff = (theme) => [
    ["until", "window.__a380 && window.__a380.state && window.__a380.controller", 240000],
    ["wait", 1500],
    ["key", "5"],
    ["until", `__a380.state.phase==='TAKEOFF' && !__a380.pv.seek && +(/(\\d+) kt/.exec(${READOUT})||[0,0])[1] > 100`, 90000],
    ["key", " "],
    ["wait", 800],
    ["until", "!__a380.glInfo || __a380.glInfo.pending === 0 && (!__a380.glInfo.ok || __a380.pv.glShare >= 0.999)", 90000],
    ["eval", "'renderer ' + ((__a380.glInfo && __a380.glInfo.renderer) || 'none (fallback)') + ' · ok ' + (__a380.glInfo && __a380.glInfo.ok)"],
    ["turn", -5],
    ["wait", 1500],
    // the stage at 1200:630 (936 × 492 CSS px of the 952 × 674 stage in a 1200 px window, inside its border), from the
    // fin's tip to the nose gear
    ["shot", join(dir, `stage-${theme}.png`), ".a3-stage", 2, [8, 46, 936, 492]],
  ];
  const jobs = [];
  for (const theme of ["dark", "light"]) {
    const steps = join(dir, `drive-${theme}.json`);
    writeFileSync(steps, JSON.stringify(takeoff(theme)));
    jobs.push(run([drive, pages[theme], "--actions", steps, "--width", "1200", "--height", "1000"], join(dir, `drive-${theme}.txt`)));
  }
  log("capturing the take-off in both themes (headless Chrome, two at once) …");
  const texts = await Promise.all(jobs);
  for (const text of texts) {
    const renderer = /renderer ([^"]*)/.exec(text)?.[1] ?? "unknown";
    log(`  ${renderer}`);
    if (/SwiftShader/i.test(renderer)) log("  WARNING: the capture rendered on SwiftShader, not the GPU");
    if (!/console: clean/.test(text)) log(`  console: ${text.split("\n").filter((l) => /console|exception/.test(l)).join(" | ").slice(0, 400)}`);
  }
  // the card, 1200 × 630: the stage at 90% to the right of the plate's corner labels (the fin clears the title)
  const card = (theme) => {
    const dark = theme === "dark";
    return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;background:${dark ? "#0b0b0b" : "#f2f2ef"}}
#og{position:relative;width:1200px;height:630px;overflow:hidden;background:${dark ? "#131313" : "#fbfbfa"};font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
#og img{position:absolute;left:160px;top:32px;width:1080px;height:568px;-webkit-mask-image:linear-gradient(to right,transparent,#000 6%),linear-gradient(to bottom,transparent,#000 5%,#000 95%,transparent);-webkit-mask-composite:source-in;mask-image:linear-gradient(to right,transparent,#000 6%),linear-gradient(to bottom,transparent,#000 5%,#000 95%,transparent);mask-composite:intersect}
.t{position:absolute;left:40px;top:34px;line-height:1.25}
.f{font:500 15px/1 ui-monospace,"SF Mono",Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;color:${dark ? "#6e6e6e" : "#8c8c90"}}
.n{margin-top:12px;font-size:40px;font-weight:600;letter-spacing:-.01em;color:${dark ? "#e6e6e6" : "#18181a"}}
.d{margin-top:8px;font-size:19px;color:${dark ? "#a3a3a3" : "#57575a"}}
</style></head><body><div id="og"><img src="stage-${theme}.png" onload="try{const c=document.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawImage(this,8,8,1,1,0,0,1,1);const d=c.getContext('2d').getImageData(0,0,1,1).data;document.getElementById('og').style.background='rgb('+d[0]+','+d[1]+','+d[2]+')';document.title='bg '+d.join(',')}catch(e){document.title='bg kept: '+e.message}"><div class="t"><div class="f">Fig 1 · interactive</div><div class="n">Airbus A380-800</div><div class="d">A true-3D cutaway:<br>drag to turn, click to operate</div></div></div></body></html>`;
  };
  copyFileSync(join(SITE, "favicon.svg"), join(dir, "favicon.svg"));
  const compose = [];
  for (const theme of ["dark", "light"]) {
    writeFileSync(join(dir, `og-${theme}.html`), card(theme));
    const steps = join(dir, `og-${theme}.json`);
    writeFileSync(steps, JSON.stringify([["wait", 500], ["eval", "document.title"], ["shot", join(dir, `og-${theme}.png`), "#og", 1, [0, 0, 1200, 630]]]));
    compose.push(run([drive, join(dir, `og-${theme}.html`), "--actions", steps, "--width", "1200", "--height", "630"], join(dir, `og-${theme}.txt`)));
  }
  await Promise.all(compose);
  const sizes = [32, 180, 192, 512];
  // the PNG icons are full-bleed squares (iOS and Android round them; the SVG favicon keeps its own corners), side by side
  const square = favicon.toString().replace(/ rx="\d+"/, "");
  let left = 0;
  const placed = sizes.map((s) => ((left += s + 8), [s, left - s - 8]));
  writeFileSync(join(dir, "icons.html"), `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0}div{position:absolute;top:0}svg{display:block}</style></head><body>${placed.map(([s, x]) => `<div id="i${s}" style="left:${x}px">${square.replace("<svg ", `<svg width="${s}" height="${s}" `)}</div>`).join("")}</body></html>`);
  writeFileSync(join(dir, "icons.json"), JSON.stringify([["wait", 300], ...sizes.map((s) => ["shot", join(dir, `icon-${s}.png`), `#i${s}`, 1, [0, 0, s, s]])]));
  await run([drive, join(dir, "icons.html"), "--actions", join(dir, "icons.json"), "--width", String(left + 8), "--height", "600"], join(dir, "icons.txt"));
  const missing = SHOT_FILES.filter((f) => !existsSync(join(dir, f)));
  if (missing.length) fail(`the capture did not write ${missing.join(", ")} (logs in ${relative(ROOT, dir)})`);
  log(`captured into ${relative(ROOT, dir)}: ${SHOT_FILES.join(", ")} (read the PNGs before you publish)`);
}
// @shots end

// ---------------------------------------------------------------------------------------------
// 3. the site
// ---------------------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TITLE = "Airbus A380-800 · an interactive 3D cutaway";
const DESCRIPTION =
  "An interactive, true-3D cutaway of the Airbus A380-800 on a turntable: all 19 doors, the 22-wheel gear, slats and flaps, four Trent 970s, every exterior light and both cabin decks, flying Airbus's departure from the gate to 10,000 ft.";
const ALT = "The A380 drawn in 3D on a turntable slice of runway at take-off, its lights on";
const PAGE_BG = { dark: "#0b0b0b", light: "#f2f2ef" };

if (existsSync(OUT)) {
  // only a folder this tool wrote (it carries the marker) is cleared
  if (!existsSync(join(OUT, ".build-site"))) fail(`${OUT} exists and was not written by build-site (no .build-site marker): remove it or pick another --out`);
  rmSync(OUT, { recursive: true, force: true });
}
mkdirSync(join(OUT, "assets"), { recursive: true });
const files = new Map(); // dist path -> Buffer
const asset = (name, data) => {
  const dot = name.lastIndexOf(".");
  const path = `assets/${name.slice(0, dot)}.${hash(data)}${name.slice(dot)}`;
  files.set(path, data);
  return path;
};
const A = {
  favicon: asset("favicon.svg", favicon),
  icon32: asset("icon-32.png", readFileSync(join(shots, "icon-32.png"))),
  icon180: asset("apple-touch-icon.png", readFileSync(join(shots, "icon-180.png"))),
  icon192: asset("icon-192.png", readFileSync(join(shots, "icon-192.png"))),
  icon512: asset("icon-512.png", readFileSync(join(shots, "icon-512.png"))),
  ogDark: asset("og-a380-dark.png", readFileSync(join(shots, "og-dark.png"))),
  ogLight: asset("og-a380-light.png", readFileSync(join(shots, "og-light.png"))),
};
// the manifest sits in assets/ beside its icons, so its icon paths are bare names; start_url and scope are the site's root
const manifest = Buffer.from(
  JSON.stringify(
    {
      name: TITLE,
      short_name: "A380",
      description: DESCRIPTION,
      start_url: "../",
      scope: "../",
      display: "browser",
      background_color: PAGE_BG.dark,
      theme_color: PAGE_BG.dark,
      icons: [
        { src: A.icon192.slice(7), sizes: "192x192", type: "image/png" },
        { src: A.icon512.slice(7), sizes: "512x512", type: "image/png" },
        { src: A.favicon.slice(7), sizes: "any", type: "image/svg+xml" },
      ],
    },
    null,
    1,
  ),
);
const manifestPath = asset("site.webmanifest", manifest);

const abs = (path) => (URL_BASE ? URL_BASE + path : path);
const pageUrl = (path) => abs(path === "index.html" ? "" : path);
const head = ({ path, theme, title = TITLE, description = DESCRIPTION, og = theme === "light" ? A.ogLight : A.ogDark }) =>
  [
    `<meta name="description" content="${esc(description)}">`,
    `<meta name="color-scheme" content="${theme === "auto" ? "dark light" : theme}">`,
    theme === "auto"
      ? `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${PAGE_BG.light}"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="${PAGE_BG.dark}">`
      : `<meta name="theme-color" content="${PAGE_BG[theme]}">`,
    URL_BASE ? `<link rel="canonical" href="${esc(pageUrl(path))}">` : "",
    `<link rel="icon" href="${A.favicon}" type="image/svg+xml">`,
    `<link rel="icon" href="${A.icon32}" type="image/png" sizes="32x32">`,
    `<link rel="apple-touch-icon" href="${A.icon180}">`,
    `<link rel="manifest" href="${manifestPath}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Airbus A380-800 · Fig 1">`,
    `<meta property="og:title" content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    URL_BASE ? `<meta property="og:url" content="${esc(pageUrl(path))}">` : "",
    `<meta property="og:image" content="${esc(abs(og))}">`,
    `<meta property="og:image:type" content="image/png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${esc(ALT)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    `<meta name="twitter:image" content="${esc(abs(og))}">`,
    `<meta name="twitter:image:alt" content="${esc(ALT)}">`,
  ]
    .filter(Boolean)
    .join("");

// ---------------------------------------------------------------------------------------------
// the single page (theme switch): index.html is the figure itself, with a System / Light / Dark switch. The two built
// pages hold the same runtime byte for byte (build.mjs: runtime-shell.js around the kit, the model, follow, the GL page
// files and live.js) and differ only in their theme: the DATA factory (vary functions, labels, the M8 settings) and
// the payload (the live layers' markup, the turn data, the GL data with its shaders and inks). So the site ships one
// runtime and, per theme, a small script and a JSON payload, each under a content-hashed name. index.html picks the
// theme before first paint, loads that theme only, and prefetches the other at idle after first light; a switch
// remounts the figure in place from a snapshot of its state (A3.snapshot) while the old figure's last frame stays on
// screen
// ---------------------------------------------------------------------------------------------
const SECTION = (text, name, theme) => {
  const open = `/*@a3:${name}@*/\n`;
  const a = text.indexOf(open);
  const b = text.indexOf(`\n/*@a3:${name}:end@*/`);
  if (a < 0 || b < a) fail(`the ${theme} page has no ${name} section (built before the theme switch? rebuild it)`);
  return text.slice(a + open.length, b);
};
const split = {};
for (const theme of ["dark", "light"]) {
  const text = html[theme];
  const open = text.indexOf('<script type="module">');
  const close = text.lastIndexOf("</script>");
  if (open < 0 || close < open || text.indexOf("<script", open + 1) >= 0) fail(`the ${theme} page must end in one module script`);
  const boot = SECTION(text, "boot", theme);
  const b64 = /atob\("([A-Za-z0-9+/=]+)"\)/.exec(boot)?.[1];
  if (!b64) fail(`the ${theme} page carries no payload (a verify or svg-painter build?)`);
  const payload = inflateRawSync(Buffer.from(b64, "base64"));
  const p = JSON.parse(payload.toString("utf8"));
  for (const key of ["deck", "airframe", "turn", "gl"]) if (p[key] === undefined) fail(`the ${theme} payload has no ${key}`);
  split[theme] = { before: text.slice(0, open), after: text.slice(close + "</script>".length), runtime: SECTION(text, "runtime", theme), theme: SECTION(text, "theme", theme), payload, stamp: /window\.__a380Source = \{[^;\n]*\};/.exec(text)?.[0] ?? "" };
}
if (split.dark.runtime !== split.light.runtime) fail("the two pages' runtimes differ: build both from the same tree (--rebuild)");
const unthemed = (s, theme) => s.replace(`<body class="iso" data-theme="${theme}">`, "<body>").replace(`<meta name="color-scheme" content="${theme}">`, "").replace(/<meta name="theme-color" content="[^"]*">/, "");
if (unthemed(split.dark.before, "dark") !== unthemed(split.light.before, "light") || split.dark.after !== split.light.after) fail("the two pages' markup differs beyond the theme attributes");
log(`one runtime for both themes (${(split.dark.runtime.length / 1024).toFixed(0)} KB); themes: dark ${(split.dark.theme.length / 1024).toFixed(0)} KB + ${(split.dark.payload.length / 1024).toFixed(0)} KB payload, light ${(split.light.theme.length / 1024).toFixed(0)} KB + ${(split.light.payload.length / 1024).toFixed(0)} KB payload`);
const RUNTIME = asset("a380-runtime.js", Buffer.from(split.dark.runtime));
const THEMES = Object.fromEntries(["dark", "light"].map((t) => [t, { js: asset(`a380-${t}.js`, Buffer.from(split[t].theme)), json: asset(`a380-${t}.json`, split[t].payload) }]));

// the site layer: small and outside the figure. The site bar is a footer row in normal flow after the figure (and the
// no-WebGL note just above it), so neither moves or shortens the card, which fu/f3-interaction fits to the viewport's
// height. Touch targets are at least 44 px tall. The theme switch is three native radio buttons in a fieldset (arrow
// keys move between them, a screen reader names the group and the choice)
const SITE_CSS = `
.site-bar{display:flex;justify-content:flex-end;margin:24px 0 0}
.site-bar-row{display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:8px 12px;font-size:12.5px;line-height:1;color:var(--anatomy-muted)}
.site-bar a{color:var(--anatomy-text);text-decoration:none;border-radius:6px;padding:4px 8px}
.site-bar a:hover{color:var(--anatomy-strong)}
.site-bar a:focus-visible{outline:2px solid var(--anatomy-blue);outline-offset:1px}
.site-theme-row{display:inline-flex;align-items:center;gap:8px}
.site-theme{display:inline-flex;align-items:center;gap:2px;margin:0;padding:2px;border:0;border-radius:8px;box-shadow:var(--anatomy-lift);background:var(--anatomy-card);min-inline-size:0}
.site-theme legend,.site-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.site-theme label{position:relative;display:inline-flex;cursor:pointer}
.site-theme input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
.site-theme span{display:inline-flex;align-items:center;padding:4px 9px;border-radius:6px;color:var(--anatomy-text);white-space:nowrap}
.site-theme label:hover span{color:var(--anatomy-strong)}
.site-theme input:checked+span{color:var(--anatomy-strong);background:var(--anatomy-faint)}
.site-theme input:focus-visible+span{outline:2px solid var(--anatomy-blue);outline-offset:1px}
.site-note{margin:0 0 16px;padding:12px 14px;border-radius:10px;background:var(--anatomy-card);box-shadow:var(--anatomy-lift);color:var(--anatomy-text);font-size:13px;line-height:1.5}
#site-nogl{margin:24px 0 0}
.site-note[hidden]{display:none}
.site-note strong{color:var(--anatomy-strong);font-weight:600}
.site-note img{display:block;width:100%;height:auto;margin-top:10px;border-radius:6px}
.iso.a3-theme-host{display:contents}
@media (any-pointer:coarse){.site-bar a,.site-theme span{display:inline-flex;align-items:center;min-height:44px;padding:0 12px}.site-bar a{padding:0 14px}}
`.trim();
// the theme, picked in <head> before anything is painted: ?theme=system|light|dark (stored, then taken off the address),
// else the stored choice, else System; System follows prefers-color-scheme. It preloads the runtime's theme files
const PICK = `(function(){var K="a380-theme",p=null,q=/[?&]theme=(system|dark|light)\\b/.exec(location.search);
try{p=q?q[1]:localStorage.getItem(K);if(q)localStorage.setItem(K,q[1])}catch(_){}
if(q&&history.replaceState)try{history.replaceState(history.state,"",location.pathname+location.search.replace(/([?&])theme=[^&]*(&|$)/,"$1").replace(/[?&]$/,"")+location.hash)}catch(_){}
if(p!=="dark"&&p!=="light")p="system";
var t=p==="system"?(window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p;
window.__a3site={pref:p,theme:t};
var m=document.querySelector('meta[name="color-scheme"]');if(m)m.content=t;
m=document.querySelector('meta[name="theme-color"]');if(m)m.content=t==="light"?"${PAGE_BG.light}":"${PAGE_BG.dark}";
var A=${JSON.stringify(THEMES)};
function pre(rel,href,fetch){var l=document.createElement("link");l.rel=rel;l.href=href;if(fetch){l.as="fetch";l.crossOrigin="anonymous"}document.head.appendChild(l)}
pre("modulepreload",A[t].js);pre("preload",A[t].json,1)})();`;
// right after <body>: the picked theme on the page and on the figure's host, before the first paint
const PAINT = `<script>(function(){var t=window.__a3site?__a3site.theme:"dark";document.body.setAttribute("data-theme",t)})()</script>`;
// a classic inline script in <head>: shows the no-WebGL note from the figure's own GL state (window.__a380.glInfo,
// read twice a second until it settles; it opens no context of its own); shows the cannot-start note when the figure
// throws before it mounts or the browser lacks what the page needs (ES modules, structuredClone). Nothing per frame.
const SITE_JS = `(function(){
function show(id){var n=document.getElementById(id);if(n)n.hidden=false}
var old=!("noModule" in HTMLScriptElement.prototype)||!("structuredClone" in window);
function check(){var A=window.__a380;if(!(A&&A.controller))show("site-fail")}
window.addEventListener("error",function(){setTimeout(check,3000)});
window.addEventListener("unhandledrejection",function(){setTimeout(check,3000)});
document.addEventListener("DOMContentLoaded",function(){
if(old){show("site-fail");return}
var n=0,t=setInterval(function(){var A=window.__a380,g=A&&A.glInfo;
if(g&&g.pending===0){clearInterval(t);if(!g.ok)show("site-nogl")}else if(++n>240)clearInterval(t)},500)});
})();`;
const NOTES = (og) =>
  `<noscript><style>.iso-figure{display:none}</style><p class="site-note"><strong>This figure needs JavaScript.</strong> It is an interactive drawing: turn it, open its doors, run its engines and step through the departure. Turn JavaScript on to use it; below is a still of it at take-off.<picture><source srcset="${A.ogLight}" media="(prefers-color-scheme: light)"><img src="${og}" alt="${esc(ALT)}" width="1200" height="630"></picture></p></noscript>` +
  `<p class="site-note" id="site-fail" role="alert" hidden><strong>The figure could not start in this browser.</strong> It needs a current Chrome, Edge, Firefox or Safari (16.4 or later). Below is a still of it at take-off.<img src="${og}" alt="${esc(ALT)}" width="1200" height="630" loading="lazy"></p>`;
// the no-WebGL note sits after the figure, beside the site bar: the figure still works, and above it the note pushed the
// card (fitted to the viewport's height) below the fold on a landscape phone
const NOGL = `<p class="site-note" id="site-nogl" role="status" hidden><strong>WebGL is off or unavailable in this browser.</strong> Everything in the figure still works; its lights, glows and beams are drawn more simply, and the engines’ heat haze is not drawn.</p>`;
const THEME_CHOICES = [["system", "System"], ["light", "Light"], ["dark", "Dark"]];
const bar = () =>
  `<nav class="site-bar" aria-label="Site"><div class="site-bar-row"><span class="site-theme-row"><span aria-hidden="true">Theme</span><fieldset class="site-theme"><legend>Theme</legend>${THEME_CHOICES.map(([v, label]) => `<label><input type="radio" name="a3-theme" value="${v}"${v === "system" ? " checked" : ""}><span>${label}</span></label>`).join("")}</fieldset></span><span class="site-sr" id="site-theme-said" aria-live="polite"></span><a href="credits.html">Credits</a></div></nav>` +
  `<script>(function(){var p=window.__a3site&&__a3site.pref;if(p)for(var r of document.querySelectorAll('input[name="a3-theme"]'))r.checked=r.value===p})()</script>`;
// the page's module script: boots the picked theme, then wires the switch. A switch (or, on System, a change of the
// system's scheme while the page is open) loads the other theme (prefetched at idle after first light), takes the
// figure's state (A3.snapshot: phase and model, bearing, Inspect, cutaway, doors, pause, the tour, the reader's
// settings), stops the figure, and boots the other theme in a fresh copy of the figure's markup with that state. The
// stopped figure's last frame stays over the new one until the new one has drawn its first frame. Its ids are renamed
// so the new figure's markup resolves its own; the page keeps the old theme's colours meanwhile (body data-theme off,
// its custom properties pinned), so neither figure takes the other's theme rules
const BOOT = `const S = window.__a3site;
const ASSETS = ${JSON.stringify(THEMES)};
const KEY = "a380-theme";
const RT = window.__A3RT;
const BG = ${JSON.stringify(PAGE_BG)};
const mq = matchMedia("(prefers-color-scheme: light)");
const want = () => (S.pref === "system" ? (mq.matches ? "light" : "dark") : S.pref);
const texts = {};
const payloadText = (t) =>
  (texts[t] ??= fetch(ASSETS[t].json).then((r) => {
    if (!r.ok) throw new Error(\`a380: \${ASSETS[t].json}: \${r.status}\`);
    return r.text();
  })).catch((e) => {
    delete texts[t];
    throw e;
  });
const themeOf = async (t) => {
  const [, text] = await Promise.all([import(new URL(ASSETS[t].js, document.baseURI).href), payloadText(t)]);
  return { ...window.__A3THEME[t], p: JSON.parse(text) };
};
let host = document.querySelector(".a3-theme-host");
for (const s of host.querySelectorAll(":scope > script")) s.remove();
const template = host.cloneNode(true);
host.setAttribute("data-theme", S.theme);
let current = S.theme;
let fig = (window.__a380Figure = await RT.boot(await themeOf(current)));
const setMeta = (t) => {
  const cs = document.querySelector('meta[name="color-scheme"]');
  if (cs) cs.content = t;
  const tc = document.querySelector('meta[name="theme-color"]');
  if (tc) tc.content = BG[t];
};
// keep the page's look while two figures of different themes are in it
const pinPage = () => {
  const body = document.body;
  const cs = getComputedStyle(body);
  const pinned = [];
  for (let i = 0; i < cs.length; i++) if (cs[i].startsWith("--")) pinned.push([cs[i], cs.getPropertyValue(cs[i])]);
  for (const k of ["background-color", "color", "color-scheme"]) pinned.push([k, cs.getPropertyValue(k)]);
  for (const [k, v] of pinned) body.style.setProperty(k, v);
  body.setAttribute("data-theme", "switching");
  return () => {
    for (const [k] of pinned) body.style.removeProperty(k);
  };
};
let freezes = 0;
const freeze = (oldHost) => {
  const figure = oldHost.querySelector(".iso-figure");
  const n = ++freezes;
  const ids = new Map();
  for (const svg of figure.querySelectorAll("svg")) {
    for (const e of svg.querySelectorAll("[id]")) {
      ids.set(e.id, \`\${e.id}--was\${n}\`);
      e.id = ids.get(e.id);
    }
  }
  if (ids.size) {
    const ref = /url\\(\\s*["']?#([^"')\\s]+)["']?\\s*\\)/g;
    for (const svg of figure.querySelectorAll("svg"))
      for (const e of svg.querySelectorAll("*"))
        for (const a of e.attributes) {
          const v = a.value;
          if (v.includes("url(")) {
            const next = v.replace(ref, (m, id) => (ids.has(id) ? \`url(#\${ids.get(id)})\` : m));
            if (next !== v) a.value = next;
          } else if ((a.localName === "href") && v[0] === "#" && ids.has(v.slice(1))) a.value = \`#\${ids.get(v.slice(1))}\`;
        }
  }
  for (const e of figure.querySelectorAll("[id]")) e.removeAttribute("id");
  const main = oldHost.parentElement;
  if (getComputedStyle(main).position === "static") main.style.position = "relative";
  const box = figure.getBoundingClientRect();
  const at = main.getBoundingClientRect();
  Object.assign(figure.style, { position: "absolute", left: \`\${box.left - at.left}px\`, top: \`\${box.top - at.top}px\`, width: \`\${box.width}px\`, height: \`\${box.height}px\`, margin: "0", zIndex: "3", pointerEvents: "none" });
  figure.inert = true;
  figure.setAttribute("aria-hidden", "true");
};
const said = document.getElementById("site-theme-said");
const radios = [...document.querySelectorAll('input[name="a3-theme"]')];
const syncRadios = () => {
  for (const r of radios) r.checked = r.value === S.pref;
};
let busy = false;
async function apply(announce) {
  syncRadios();
  const t = want();
  if (busy || t === current) return;
  busy = true;
  try {
    const theme = await themeOf(t);
    if (want() === t) {
      const old = fig;
      const oldHost = host;
      const carry = old.snapshot();
      old.stop();
      const unpin = pinPage();
      freeze(oldHost);
      const fresh = template.cloneNode(true);
      fresh.setAttribute("data-theme", t);
      oldHost.before(fresh);
      host = fresh;
      try {
        fig = window.__a380Figure = await RT.boot(theme, carry);
        current = t;
      } finally {
        document.body.setAttribute("data-theme", t);
        unpin();
        setMeta(t);
        oldHost.remove();
        old.release();
      }
      if (announce && said) said.textContent = \`\${t === "light" ? "Light" : "Dark"} theme\${S.pref === "system" ? " (system)" : ""}\`;
    }
  } catch (e) {
    // (a theme that cannot load is not retried in a loop: the switch shows the theme that is on screen)
    console.error(e);
    busy = false;
    S.pref = current;
    syncRadios();
    return;
  }
  busy = false;
  if (want() !== current) apply(announce);
}
for (const r of radios)
  r.addEventListener("change", () => {
    if (!r.checked) return;
    S.pref = r.value;
    try {
      localStorage.setItem(KEY, S.pref);
    } catch (_) {}
    apply(true);
  });
mq.addEventListener("change", () => {
  if (S.pref === "system") apply(true);
});
syncRadios();
// the other theme at idle after first light (the GL programs compiled, the cross-fade done), so a switch is near-instant
const other = () => (current === "light" ? "dark" : "light");
const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 200));
const prefetch = () =>
  idle(() => {
    import(new URL(ASSETS[other()].js, document.baseURI).href).catch(() => {});
    payloadText(other()).catch(() => {});
  });
(function wait(n) {
  const A = window.__a380;
  const g = A && A.glInfo;
  if (n > 120 || !g || (g.pending === 0 && (!g.ok || A.pv.glShare >= 0.999))) prefetch();
  else setTimeout(() => wait(n + 1), 250);
})(0);
if (want() !== current) apply(false);`;
// index.html: the figure page (the dark build's markup, which is the light build's apart from the theme attributes)
// with the site layer, its scripts replaced by the runtime, the theme picked in <head> and the switch
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
{
  let text = split.dark.before;
  const headPart = text.slice(0, text.indexOf("</head>"));
  const own = (name) => new RegExp(`<meta name="${name}"`).test(headPart);
  const description = unescape(/<meta name="description" content="([^"]*)"/.exec(headPart)?.[1] ?? DESCRIPTION);
  const tags = head({ path: "index.html", theme: "dark", description })
    .split(/(?=<meta |<link )/)
    .filter((tag) => !["description", "color-scheme", "theme-color"].some((name) => tag.startsWith(`<meta name="${name}"`) && own(name)))
    .join("");
  const steps = [
    [/<title>[^<]*<\/title>/, () => `<title>${esc(TITLE)}</title>${tags}<script>${PICK}</script><link rel="modulepreload" href="${RUNTIME}"><style id="site-css">${SITE_CSS}</style><script>${SITE_JS}</script>`],
    ['<body class="iso" data-theme="dark">', () => `<body class="iso" data-theme="dark">${PAINT}`],
    ['<main class="iso-page">', () => `<main class="iso-page">${NOTES(A.ogDark)}`],
    ['<figure class="iso-figure">', () => `<div class="iso a3-theme-host" data-theme="dark"><script>document.currentScript.parentNode.setAttribute("data-theme",window.__a3site?__a3site.theme:"dark")</script><figure class="iso-figure">`],
    ["</figure></main>", () => `</figure></div>${NOGL}${bar()}</main>`],
  ];
  for (const [find, put] of steps) {
    const next = text.replace(find, put);
    if (next === text || text.split(find).length > 2) fail(`could not place the site layer at ${find}`);
    text = next;
  }
  text += `<script>${split.dark.stamp}</script><script type="module" src="${RUNTIME}"></script><script type="module">${BOOT}</script>${split.dark.after}`;
  files.set("index.html", Buffer.from(text));
}

// the plain pages (index, credits, 404): the page colours of the figure's themes, the stored choice or the system's
const shell = ({ path, title, body, script = "", description = DESCRIPTION, base = "" }) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${base ? `<base href="${esc(base)}">` : ""}<title>${esc(title)}</title>${head({ path, theme: "auto", title, description })}${script ? `<script>${script}</script>` : ""}<style>
:root{--bg:${PAGE_BG.dark};--card:#131313;--text:#a3a3a3;--strong:#e6e6e6;--muted:#6e6e6e;--line:#2a2a2a;--link:#8fb3ff;color-scheme:dark}
@media (prefers-color-scheme:light){:root:not([data-theme="dark"]){--bg:${PAGE_BG.light};--card:#fbfbfa;--text:#57575a;--strong:#18181a;--muted:#77777c;--line:#d4d4d6;--link:#3e63dd;color-scheme:light}}
:root[data-theme="light"]{--bg:${PAGE_BG.light};--card:#fbfbfa;--text:#57575a;--strong:#18181a;--muted:#77777c;--line:#d4d4d6;--link:#3e63dd;color-scheme:light}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{width:min(760px,100% - 32px);margin:56px auto 96px}h1{color:var(--strong);font-size:26px;font-weight:600;letter-spacing:-.01em;margin:0 0 8px}
h2{color:var(--strong);font-size:16px;font-weight:600;margin:32px 0 8px}a{color:var(--link)}.muted{color:var(--muted)}strong{color:var(--strong)}
.card{background:var(--card);border-radius:12px;padding:14px 16px;box-shadow:0 0 0 1px var(--line)}img{display:block;max-width:100%;height:auto;border-radius:8px}
pre{white-space:pre-wrap;font:12.5px/1.55 ui-monospace,"SF Mono",Menlo,Consolas,monospace;background:var(--card);box-shadow:0 0 0 1px var(--line);border-radius:10px;padding:14px 16px}
ul{padding-left:20px}li{margin:6px 0;overflow-wrap:anywhere}.pick{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}
.pick a{display:inline-block;padding:10px 14px;border-radius:8px;box-shadow:0 0 0 1px var(--line);background:var(--card);color:var(--strong);text-decoration:none}
</style></head><body><main>${body}</main></body></html>`;
// credits and 404 take the stored theme (System, or none: the system's)
const THEME_ATTR = `(function(){try{var t=localStorage.getItem("a380-theme");if(t==="dark"||t==="light")document.documentElement.setAttribute("data-theme",t)}catch(_){}})();`;
// credits.html: the not-affiliated notice, the kit's MIT licence and the sources (truth.md §1)
const truth = readFileSync(join(A380, "truth.md"), "utf8");
const sourceRows = (truth.split(/^## 1\. Sources/m)[1] ?? "").split(/^## /m)[0].split("\n").filter((l) => /^\| [A-Z]+ \|/.test(l));
const linkify = (s) =>
  esc(s)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/https?:\/\/[^\s<]+[^\s<.,;)]/g, (u) => `<a href="${u}" rel="noopener">${u.replace(/^https?:\/\//, "").replace(/\/.*/, "")}</a>`);
const sources = sourceRows.map((row) => {
  const cells = row.split("|").map((c) => c.trim());
  // the truth sheet's own section references (§16: how the drawings were measured) point at a document the site does not
  // publish, so they are left out of the public list
  cells[3] = (cells[3] ?? "").replace(/[;,]?\s*(?:measured )?as in §\d+(?:\.\d+)*/g, "").replace(/\s*\(§\d+(?:\.\d+)*\)/g, "").replace(/\s+\./g, ".");
  return `<li>${linkify(cells[2])}${cells[3] ? ` <span class="muted">${linkify(cells[3])}</span>` : ""}</li>`;
});
if (sources.length < 5) fail(`found only ${sources.length} sources in truth.md §1`);
const KIT_LICENCE = readFileSync(join(SITE, "LICENSE-anatomy-kit.txt"), "utf8").trim();
files.set(
  "credits.html",
  Buffer.from(
    shell({
      path: "credits.html",
      title: "Credits and licence · Airbus A380-800 · Fig 1",
      description: "Credits, sources and licences for the interactive Airbus A380-800 figure.",
      script: THEME_ATTR,
      body: `<p><a href="./">← Back to the figure</a></p><h1>Credits and licence</h1>
<p class="card"><strong>Not affiliated with Airbus.</strong> This figure is an independent illustration. It is not made, endorsed, sponsored or approved by Airbus, Rolls-Royce or any airline. Airbus and A380 are trademarks of Airbus; Rolls-Royce and Trent are trademarks of Rolls-Royce plc. They are used here only to name what is drawn. The drawing is not an engineering model and is not for operational, training or safety use.</p>
<h2>The figure</h2>
<p>An interactive, true-3D cutaway of the Airbus A380-800 on a turntable, drawn in the browser: the airframe is projected and painted every frame, and the lights, glow and effects are drawn with WebGL. Every size, rate and rule comes from the sources below; the numbers the project's truth sheet (in its source repository) marks as estimates are engineering estimates, and heights and time are compressed for the turntable.</p>
<h2>Built with the Anatomy kit</h2>
<p>The figure is built with the Anatomy skill's kit (the isometric and true-3D figure builder, the turntable, the painters and the WebGL layer), released under the MIT licence:</p>
<pre>${esc(KIT_LICENCE)}</pre>
<h2>Sources</h2>
<p>The measurements and procedures come from these documents; the project's truth sheet (in its source repository) cites each number to one of them.</p>
<ul>${sources.join("")}</ul>`,
    }),
  ),
);
// the host serves 404.html at whatever path was asked for, so with --url its links resolve from the site's root (<base>)
files.set("404.html", Buffer.from(shell({ path: "404.html", base: URL_BASE, title: "Not found · Airbus A380-800 · Fig 1", script: THEME_ATTR, body: `<h1>Not found</h1><p>There is nothing at this address.</p><p><a href="${URL_BASE || "./"}">Open the A380 figure</a></p>` })));
files.set("robots.txt", Buffer.from(`User-agent: *\nAllow: /\n${URL_BASE ? `\nSitemap: ${URL_BASE}sitemap.xml\n` : ""}`));
if (URL_BASE)
  files.set(
    "sitemap.xml",
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${["", "credits.html"].map((p) => `  <url><loc>${esc(URL_BASE + p)}</loc></url>`).join("\n")}\n</urlset>\n`),
  );
// headers for the hosts that read them (Cloudflare Pages and Netlify: _headers; Vercel: vercel.json); site/DEPLOY.md.
// The paths are relative to the deployed folder's root: under a subpath, prefix them (DEPLOY.md)
const LONG = "public, max-age=31536000, immutable";
const SHORT = "public, max-age=0, must-revalidate";
files.set(
  "_headers",
  Buffer.from(
    [
      ["/*", [["X-Content-Type-Options", "nosniff"], ["Referrer-Policy", "strict-origin-when-cross-origin"], ["Cache-Control", SHORT]]],
      ["/assets/*", [["Cache-Control", LONG]]],
    ]
      .map(([path, list]) => `${path}\n${list.map(([k, v]) => `  ${k}: ${v}`).join("\n")}`)
      .join("\n\n") + "\n",
  ),
);
files.set(
  "vercel.json",
  Buffer.from(
    JSON.stringify(
      {
        headers: [
          { source: "/(.*)", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }, { key: "Cache-Control", value: SHORT }] },
          { source: "/assets/(.*)", headers: [{ key: "Cache-Control", value: LONG }] },
        ],
      },
      null,
      1,
    ) + "\n",
  ),
);
files.set(".nojekyll", Buffer.from("")); // GitHub Pages: serve the folder as it is
files.set(".build-site", Buffer.from("written by a380/tools/build-site.mjs, which clears and rewrites this folder\n"));

for (const [path, data] of files) {
  mkdirSync(dirname(join(OUT, path)), { recursive: true });
  writeFileSync(join(OUT, path), data);
}

// ---------------------------------------------------------------------------------------------
// 4. sizes
// ---------------------------------------------------------------------------------------------
const report = [];
for (const [path, data] of [...files].sort((a, b) => b[1].length - a[1].length)) {
  if (path.startsWith(".")) continue;
  const text = !/\.png$/.test(path);
  const gz = text ? gzipSync(data, { level: 9 }).length : null;
  const br = text ? brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }).length : null;
  report.push({ path, raw: data.length, gzip: gz, brotli: br });
}
const kb = (n) => (n == null ? "-" : `${(n / 1024).toFixed(1)} KB`);
log(`wrote ${relative(ROOT, OUT)}/ (${files.size} files) in ${((Date.now() - t0) / 1000).toFixed(1)} s${URL_BASE ? ` for ${URL_BASE}` : " with relative links (no --url)"}`);
console.log(`${"file".padEnd(44)} ${"raw".padStart(11)} ${"gzip -9".padStart(11)} ${"brotli 11".padStart(11)}`);
for (const r of report) console.log(`${r.path.padEnd(44)} ${kb(r.raw).padStart(11)} ${kb(r.gzip).padStart(11)} ${kb(r.brotli).padStart(11)}`);
mkdirSync(join(A380, "tmp"), { recursive: true });
writeFileSync(join(A380, "tmp", "site-report.json"), JSON.stringify({ out: OUT, url: URL_BASE || null, pages, at: new Date().toISOString(), files: report }, null, 1));
// fu/f4-hosting: link previews (Facebook, Slack, X, LinkedIn) do not resolve a relative og:image, so a folder built
// without --url is for testing, not for publishing
const relativeImages = [...files].filter(([path, data]) => /\.html$/.test(path) && /<meta (?:property|name)="(?:og|twitter):image" content="(?!https:\/\/)/.test(data.toString())).map(([path]) => path);
if (relativeImages.length)
  log(`WARNING: og:image and twitter:image are relative in ${relativeImages.join(", ")} (no --url): link previews will show no image. Build the folder you publish with --url https://<domain>/<path>/ (site/DEPLOY.md)`);
