// scripts/source-hash.mjs (fu/r2-verify): which sources a built page came from, so a check run on a stale page says so.
//
// sourceStamp(root) -> { describe, hash, files }: `git describe --always --dirty` of the checkout, and a SHA-256 over
// every file a page is built from (a380/*.mjs, *.js, *.css, a380/parts/, a380/gl/, kit/ and scripts/inline-kit.mjs),
// path and content, in path order. The build embeds it in every page (`window.__a380Source`, also readable as text);
// pageStamp(html) reads it back; staleness(page, root) compares a page with the working tree and returns a line to print
// (or null when the page has no stamp to compare).
//
//   node scripts/source-hash.mjs [page.html …]     the working tree's stamp, and each page's, with "stale" or "current"
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = /\.(mjs|js|css|ts|tsx)$/;
const walk = (dir, list = []) => {
  if (!existsSync(dir)) return list;
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, list);
    else if (SOURCE.test(name)) list.push(path);
  }
  return list;
};
// the files a page is built from (the a380 folder's own sources, not its tools, notes, captures or scratch)
export const sourceFiles = (root = ROOT) => {
  const a380 = join(root, "a380");
  const top = existsSync(a380) ? readdirSync(a380).filter((name) => SOURCE.test(name)).sort().map((name) => join(a380, name)) : [];
  return [...top, ...walk(join(a380, "parts")), ...walk(join(a380, "gl")), ...walk(join(root, "kit")), join(root, "scripts", "inline-kit.mjs")].filter((f) => existsSync(f));
};
export const sourceStamp = (root = ROOT) => {
  const files = sourceFiles(root);
  const sha = createHash("sha256");
  for (const file of files) {
    sha.update(relative(root, file));
    sha.update("\0");
    sha.update(readFileSync(file));
    sha.update("\0");
  }
  let describe = "unknown";
  try {
    describe = execFileSync("git", ["-C", root, "describe", "--always", "--dirty"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {}
  return { describe, hash: sha.digest("hex").slice(0, 16), files: files.length };
};
// the stamp a page carries (the build writes `window.__a380Source = {...};`), or null
export const pageStamp = (html) => {
  const hit = /window\.__a380Source = (\{[^;\n]*\});/.exec(html);
  if (!hit) return null;
  try {
    return JSON.parse(hit[1]);
  } catch {
    return null;
  }
};
// the checkout a page lies in (the nearest folder above it with a380/build.mjs), else this script's
export const rootOf = (page) => {
  for (let dir = dirname(resolve(page)); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "a380", "build.mjs"))) return dir;
    if (dirname(dir) === dir) return ROOT;
  }
};
// one line about a page file against the working tree it lies in; null for a URL or a missing file
export const staleness = (page, root = null) => {
  if (!page || /^[a-z]+:\/\//i.test(page) || !existsSync(page)) return null;
  root = root ?? rootOf(page);
  const stamp = pageStamp(readFileSync(page, "utf8"));
  if (!stamp) return `source: ${page} carries no source stamp (built before fu/r2-verify): it may be stale against the working tree; rebuild it`;
  const now = sourceStamp(root);
  const built = `${stamp.describe} ${stamp.hash}${stamp.at ? ` at ${stamp.at}` : ""}`;
  if (stamp.hash === now.hash) return `source: ${page} built from ${built}: current (the working tree's sources hash the same)`;
  return `WARNING source: ${page} was built from ${built}, the working tree is ${now.describe} ${now.hash}: the page is stale; rebuild it before trusting this check`;
};
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const now = sourceStamp();
  console.log(`working tree ${ROOT}: ${now.describe} ${now.hash} (${now.files} source files)`);
  for (const page of process.argv.slice(2)) console.log(staleness(resolve(page)) ?? `${page}: not a page file`);
}
