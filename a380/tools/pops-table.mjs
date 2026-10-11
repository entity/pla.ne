#!/usr/bin/env node
// a380/tools/pops-table.mjs (follow-up package verify, item 46): the AUDIT.md table of pops sites from the JSON that
// `turn-check --pops --diagnose --out <dir>` writes (pops-sites-<theme>.json).
//
//   node a380/tools/pops-table.mjs <sites.json> [<sites.json> …]
//
// One row per site: theme, kind (first difference, second-difference core), angle, box (1x px), surviving px, the
// parts under it, a mechanism class and the owner. The class is read from the diagnosis (painter and z-buffer IDs in
// both frames, the roles born, died or changed) and from the parts:
//   fallback fan and lip  the no-WebGL fan face drawn on the lip (its blade marks) and the lip's fill and edge (their point count) change between two angles (the round's
//                     silhouette resampled) on the lips and fallback fans nose-on and tail-on;
//   band sweep        a sub-band boundary moves several px per step across a near-flat smooth face (the band's
//                     iso-line is ill-conditioned where the corner normals barely differ: the fidelity check's 12-24 px);
//   band flip         a band polygon or a flat face changes tone in one step on a small sliver;
//   door strip flip   the same on an open door's thin leaf strips (1-11 px);
//   face birth        a flat face (and its crease) turns front-facing and is drawn at once at full tone;
//   door visibility   the thin door arm and leaf strips trade the top pixel (both painter and z-buffer change);
//   order swap        the painter's order changes between the frames and the z-buffer's does not (a cycle's pick).
// A site that does not reproduce in isolation (`--zoom-sites` re-check: 0 px, its diagnosis empty) is "not reproduced".
import { readFileSync } from "node:fs";

const rows = [];
for (const file of process.argv.slice(2)) {
  const theme = /light/.test(file) ? "light" : "dark";
  for (const s of JSON.parse(readFileSync(file, "utf8"))) {
    const parts = (s.pair ?? []).join(" / ");
    const mech = s.mechanism ?? "";
    const roles = (s.roles ?? []).join("; ");
    let cls;
    if (/order swap/.test(mech)) cls = "order swap"; // (the cutawayDoors cycle on its path) before the part-name classes
    else if (/\.lip\b/.test(parts)) cls = "fallback fan and lip";
    else if (s.kind !== "second" && /(crease|\bf\d+) born/.test(roles)) cls = "face birth";
    else if (s.kind === "second" || /fair|fdfloor|box\.\d|radome/.test(parts)) cls = "band sweep";
    else if (mech.startsWith("visibility")) cls = "door visibility";
    else if (/^door\./.test(parts)) cls = "door strip flip";
    else cls = "band flip";
    if (s.was !== undefined && !s.n) cls = "not reproduced";
    rows.push({ theme, kind: s.kind === "second" ? "core" : "first", label: s.label, box: (s.box ?? []).join(", "), n: s.n, parts, cls, owner: s.owner ?? "?" });
  }
}
console.log("| Theme | Kind | Angle | Box (1x px) | px | Parts | Mechanism | Owner |");
console.log("|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.theme} | ${r.kind} | ${r.label} | ${r.box} | ${r.n} | ${r.parts} | ${r.cls} | ${r.owner} |`);
const by = (key) => Object.entries(rows.reduce((m, r) => ((m[r[key]] = (m[r[key]] ?? 0) + 1), m), {})).map(([k, v]) => `${k} ${v}`).join(", ");
console.log(`\n${rows.length} sites · by mechanism: ${by("cls")} · by owner: ${by("owner")}`);
