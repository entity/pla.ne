import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
if (!argv.length || argv.includes("--help") || argv.includes("-h")) {
  console.log(`Check that every texture line in a figure ends on something.

  node lines.mjs <file.html | url> [--out marks.png] [--tolerance 1] [--select css] [--wait 1500] [--edges | --strict] [drive.mjs flags]

Every open subpath of every .iso-line (seams, grooves, ribs, rule lines, ticks, needles) must end on another stroke,
a dot or an outline within the tolerance (viewBox px), or under a fill painted after it. A short straight mark (a tick)
needs one rooted end. Outlines, creases, bevels and tube edges are the kit's own and are not checked, unless --edges:
then every crease and open outline must also end on another stroke (counted apart, "edge ends", ringed in blue), and
every end is strict: only visible line strokes count (not the same-tone strokes of face polygons), and an end under a
later fill is followed back to where it shows, which must meet a stroke (--strict: that for the texture lines alone). The page's source stamp is printed and a stale page is named. Lines drawn with
fadeLineSvg ramp out and pass; lineSvg(d, { free: true | "start" | "end" }) marks an end that is meant to stop (a needle
tip, rule lines standing for printed text). Exits 1 if any end floats; --out writes the card with each one ringed.`);
  process.exit(argv.length ? 0 : 1);
}
const take = (flag, fallback) => {
  const at = argv.indexOf(flag);
  if (at < 0) return fallback;
  const value = argv[at + 1];
  argv.splice(at, 2);
  return value;
};
const out = take("--out", null);
const tolerance = Number(take("--tolerance", 1));
const select = take("--select", null);
const wait = Number(take("--wait", 1500));
// (fu/r2-verify) --edges: also the kit's face-edge strokes (creases, open outlines), counted apart, and strict ends
// (only visible line strokes count as something to end on; an end under a fill is followed back to where it shows);
// --strict: strict ends for the texture lines alone
const edges = argv.includes("--edges");
if (edges) argv.splice(argv.indexOf("--edges"), 1);
const strict = edges || argv.includes("--strict");
if (argv.includes("--strict")) argv.splice(argv.indexOf("--strict"), 1);
const actions = JSON.stringify([["wait", wait], ["lines", out, select, { tolerance, edges, strict }]]);
const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "drive.mjs"), argv[0], actions, ...argv.slice(1)], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
