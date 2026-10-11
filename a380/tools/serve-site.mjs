#!/usr/bin/env node
// a380/tools/serve-site.mjs (fu/f3-hosting): serve the built site (a380/dist) the way a static host would, to test it
// before it is deployed: under a subpath, with brotli or gzip by Accept-Encoding, the _headers file's cache headers, and
// 404.html for a missing path. Localhost only.
//
//   node a380/tools/serve-site.mjs --port 8741 [--dir a380/dist] [--base /a380/] [--log]
//
// Then open http://127.0.0.1:8741/a380/ (or through the SSH tunnel). Stop it with Ctrl-C or by its PID.
import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const argv = process.argv.slice(2);
const value = (flag, fallback) => {
  const eq = argv.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const at = argv.indexOf(flag);
  return at >= 0 ? argv[at + 1] : fallback;
};
const DIR = resolve(value("--dir", join(fileURLToPath(new URL("..", import.meta.url)), "dist")));
const PORT = Number(value("--port", 0));
let BASE = value("--base", "/");
if (!BASE.startsWith("/")) BASE = `/${BASE}`;
if (!BASE.endsWith("/")) BASE += "/";
if (!PORT || [8080, 8090, 8000, 5173].includes(PORT) || (PORT >= 9400 && PORT <= 9499)) {
  console.error("serve-site: give a free --port of your own (not 8000, 5173, 8080, 8090 or 9400-9499)");
  process.exit(1);
}
if (!existsSync(join(DIR, "index.html"))) {
  console.error(`serve-site: no index.html in ${DIR}: run node a380/tools/build-site.mjs first`);
  process.exit(1);
}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml" };
const TEXT = new Set([".html", ".js", ".css", ".json", ".webmanifest", ".svg", ".txt", ".xml"]);
// _headers (Netlify and Cloudflare Pages syntax): a path pattern line, then indented "Name: value" lines
const rules = [];
if (existsSync(join(DIR, "_headers")))
  for (const line of readFileSync(join(DIR, "_headers"), "utf8").split("\n")) {
    if (/^\S/.test(line)) rules.push({ re: new RegExp(`^${line.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`), headers: [] });
    else if (line.trim() && rules.length) rules.at(-1).headers.push(line.trim().split(/:\s*/, 2));
  }
const cache = new Map();
const encode = (file, kind) => {
  const key = `${file}\0${kind}\0${statSync(file).mtimeMs}`;
  if (!cache.has(key)) {
    const data = readFileSync(file);
    cache.set(key, kind === "br" ? brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }) : kind === "gzip" ? gzipSync(data, { level: 9 }) : data);
  }
  return cache.get(key);
};
const LOG = argv.includes("--log");
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let path = decodeURIComponent(url.pathname);
  const send = (status, file, sitePath) => {
    const ext = extname(file);
    const accept = String(req.headers["accept-encoding"] || "");
    const kind = TEXT.has(ext) ? (/\bbr\b/.test(accept) ? "br" : /\bgzip\b/.test(accept) ? "gzip" : null) : null;
    const body = encode(file, kind);
    const headers = { "Content-Type": TYPES[ext] || "application/octet-stream", "Content-Length": body.length, Vary: "Accept-Encoding" };
    if (kind) headers["Content-Encoding"] = kind;
    for (const rule of rules) if (rule.re.test(sitePath)) for (const [k, v] of rule.headers) headers[k] = v;
    res.writeHead(status, headers);
    res.end(req.method === "HEAD" ? undefined : body);
    if (LOG) console.log(`${status} ${req.method} ${req.url} ${kind || "identity"} ${body.length}`);
  };
  if (path === BASE.slice(0, -1)) {
    res.writeHead(301, { Location: BASE });
    return res.end();
  }
  if (!path.startsWith(BASE)) return send(404, join(DIR, "404.html"), "/404.html");
  let site = `/${path.slice(BASE.length)}`;
  if (site.endsWith("/")) site += "index.html";
  const file = normalize(join(DIR, site));
  if (!file.startsWith(DIR + sep) || /\/\./.test(site) || !existsSync(file) || statSync(file).isDirectory()) return send(404, join(DIR, "404.html"), "/404.html");
  send(200, file, site);
});
// compress every text file before listening, as a host that precompresses does (brotli 11 of a 1.8 MB page takes
// seconds, which would otherwise land on the first request and on every timing)
const warm = (dir) => {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    if (statSync(file).isDirectory()) warm(file);
    else if (TEXT.has(extname(file))) for (const kind of ["br", "gzip", null]) encode(file, kind);
  }
};
warm(DIR);
server.listen(PORT, "127.0.0.1", () => console.log(`serve-site: ${DIR} at http://127.0.0.1:${PORT}${BASE} (pid ${process.pid})`));
