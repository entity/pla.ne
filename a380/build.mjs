#!/usr/bin/env node
// a380/build.mjs (S): the harness that builds the A380 figure (DESIGN §8.3, §8.4). Owned by the scaffold.
//
//   node a380/build.mjs                    dark page a380/a380.html (canvas painter on the airframe layer)
//   node a380/build.mjs --light            a380/a380-light.html
//   --verify                               SVG painter everywhere + window.__isoVerify → a380[-light]-verify.html, tmp/s-states-*.json
//   --only=<ids>                           the core plus these modules; stubs for the rest. Ids: stage nose tail fuselage skin
//                                          wings engines gear cabin lights, or owners M1..M8. Audit line names (order, rigid,
//                                          swept, posed, routes, coverage, continuity, depth) in --only go to the orbit audit
//   --out=<path>                           write the page there
//   --check                                world checks + every module's checks(ctx, out)
//   --bench                                Node frame timing over 360 turn angles and the clips
//   --audit [--quick] [--clip=name[:a-b]]  kit audit, then the orbit audit (sweep, clips, poses)
//   --painter=svg|canvas, --lite           as named
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../kit/iso-kit.mjs";
import * as G from "../kit/lathe.mjs";
import * as A from "../kit/audit.mjs";
import { turning } from "../kit/turn-build.mjs";
import * as TA from "../kit/turn-audit.mjs";
import { TURN } from "../kit/turn.mjs";
import { turnScript, fixedScript, glScript } from "../scripts/inline-kit.mjs";
import * as M from "./model.mjs";
import * as W from "./world.mjs";
import * as F from "./follow.mjs";
import { MODULES, OWNERS } from "./parts/index.mjs";
import { STUBS } from "./stubs.mjs";
import { glData } from "./gl/harness.mjs";
import { sourceStamp } from "../scripts/source-hash.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const option = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const LIGHT = flag("light");
const VERIFY = flag("verify");
const AUDIT = flag("audit");
const QUICK = flag("quick");
const CHECK = flag("check");
const BENCH = flag("bench");
const LITE = flag("lite");
// f4-engine: --elevations=42[,50] proves the order data at those camera elevations too
// (T.build's `elevations`, kit E1) and adds the audit's sweep at each (`sweep@42°`); no option, no change. For a view
// that will adopt `$elevation` (the Cockpit view) and for the full audit's elevated shard
const ELEVATIONS = (option("elevations") ?? "").split(",").filter(Boolean).map(Number);
if (ELEVATIONS.some((e) => !(e > 0 && e < 90))) throw new Error(`--elevations: degrees between 0 and 90, got ${option("elevations")}`);
const ELEVATIONS_OPT = ELEVATIONS.length ? { elevations: ELEVATIONS } : {};
// --elevated-only (with --audit): audit the elevated families alone (sweep@e°), not the base sweep again
const ELEVATED_ONLY = flag("elevated-only");
// --lite stays a no-op (DESIGN §0, owner decision 0; PLAN item 45): it builds the full page and says so
if (LITE) console.log("--lite is not built (owner decision 0: every page ships every feature)");
const PAINTER = option("painter") ?? (VERIFY ? "svg" : "canvas");
const AUDIT_LINES = new Set(["order", "rigid", "swept", "posed", "routes", "coverage", "continuity", "depth"]);
const onlyRaw = (option("only") ?? "").split(",").filter(Boolean);
const auditOnly = onlyRaw.filter((x) => AUDIT_LINES.has(x));
const moduleOnly = onlyRaw.filter((x) => !AUDIT_LINES.has(x)).flatMap((x) => OWNERS[x] ?? [x]);
for (const id of moduleOnly) if (!MODULES.some((m) => m.id === id)) throw new Error(`build: --only names an unknown module or audit line: ${id}`);
const selected = new Set(moduleOnly.length ? moduleOnly : MODULES.map((m) => m.id));
const log = [];
const report = (line) => {
  log.push(line);
  if (!AUDIT) console.log(line);
};

// ---------------------------------------------------------------------------------------------
// scene
// ---------------------------------------------------------------------------------------------
const FIT = W.fit();
const P = FIT.P;
const R = A.recorder(P);
const T = turning(P, { recorder: R });
const VIEWBOX = [W.VIEW.width, W.VIEW.height];

// the motion chain (S, DESIGN §3.1)
const groupInfo = [];
const groupOwner = new Map();
const declare = (name, spec, owner) => {
  if (T.groups.some((g) => g.name === name)) throw new Error(`build: group ${name} declared twice (by ${groupOwner.get(name)} and ${owner})`);
  if (spec.parent && !T.groups.some((g) => g.name === spec.parent)) throw new Error(`build: group ${name} (${owner}) names an unknown parent ${spec.parent}`);
  const g = T.group(name, spec);
  groupOwner.set(name, owner);
  groupInfo.push({ name, kind: g.kind, range: g.range, point: g.point, axis: g.axis, owner });
  return g;
};
declare("air", { turn: { pivot: [0, 0] } }, "S");
declare("lift", { parent: "air", slide: { direction: [0, 0, 1], travel: W.LIFT.travel } }, "S");
declare("pitch", { parent: "lift", hinge: { point: W.PITCH.point, axis: W.PITCH.axis, range: W.PITCH.range } }, "S");
for (const [name, cut] of Object.entries(W.CUTS)) declare(name, { parent: "pitch", slide: { direction: [0, 0, 1], travel: cut.travel } }, "S");
const deck = T.layer("deck");
const airframe = T.layer("airframe");
T.stack(["back", "deck", "airframe"]);

// channels and rules (DESIGN §3.2, §3.3)
const CHANNELS = new Set(["turn", "lift", "pitch", "rot", "trim", "gear", "gearDoors", "steer", "slat", "flap", "droop", "roll", "pitchCmd", "yaw", "spoiler", "spoiler1", "cabin", ...M.DOOR_IDS.map((id) => `door.${id}`)]);
CHANNELS.add("tug"); // fu/interaction: the pushback tug (parts/tug.mjs, follow.mjs channelsOf)
CHANNELS.add("gearBody"); // fu/gear: the body gear's legs, trailing the wing gear by 2 s on extension (rules fall back to gear)
const rules = [];
const addRule = (rule, owner) => {
  if (!T.groups.some((g) => g.name === rule.group)) throw new Error(`build: rule (${owner}) names an unknown group ${rule.group}`);
  if (rule.sync) {
    if (!CHANNELS.has(rule.sync.channel) && !T.groups.some((g) => g.name === rule.sync.channel)) throw new Error(`build: sync rule for ${rule.group} (${owner}) reads an unknown channel ${rule.sync.channel}`);
  } else {
    if (!CHANNELS.has(rule.channel)) throw new Error(`build: rule for ${rule.group} (${owner}) reads an unknown channel ${rule.channel}`);
    if (rule.table) for (let i = 1; i < rule.table.length; i++) if (!(rule.table[i][0] > rule.table[i - 1][0])) throw new Error(`build: rule for ${rule.group} (${owner}): table x must increase (${JSON.stringify(rule.table)})`);
  }
  rules.push({ ...rule, owner });
};
addRule({ group: "air", channel: "turn" }, "S");
addRule({ group: "lift", channel: "lift" }, "S");
addRule({ group: "pitch", channel: "pitch" }, "S");
for (const [name, cut] of Object.entries(W.CUTS)) addRule({ group: name, channel: "cabin", table: cut.table, ease: "smooth" }, "S");

// ---------------------------------------------------------------------------------------------
// the module context (DESIGN §8.4; CONTRACT.md)
// ---------------------------------------------------------------------------------------------
const reg = { lights: [], lamps: [], targets: [], effects: [], labels: [], inspect: [], accents: new Set(), clips: [], hints: [], css: [], vary: new Map(), scripts: [], data: {}, planeOn: [] };
const partsByName = new Map();
const ownerOf = new Map();
const stubbed = new Set();

function makeCtx(mod, { phase, stub = false }) {
  const id = mod.id;
  const prefixes = mod.prefixes ?? [`${id}.`];
  const tag = stub ? `${mod.owner} stub` : mod.owner;
  const checkName = (name) => {
    if (!name) throw new Error(`build: ${tag} made a part without a name`);
    if (partsByName.has(name)) throw new Error(`build: part ${name} made twice (by ${ownerOf.get(name)} and ${tag})`);
    if (!prefixes.some((p) => name.startsWith(p))) throw new Error(`build: ${tag} part ${name} must start with one of ${prefixes.join(", ")}`);
  };
  const groupOf = (g) => {
    if (g === undefined || g === null) return T.groups.find((x) => x.name === "pitch");
    const found = typeof g === "string" ? T.groups.find((x) => x.name === g) : g;
    if (!found) throw new Error(`build: ${tag} uses an unknown group ${g}`);
    return found;
  };
  const wrap = (kind) => (opts) => {
    if (phase !== "build") throw new Error(`build: ${tag} called ctx.${kind} outside build()`);
    checkName(opts.name);
    const part = T[kind]({ layer: "airframe", material: kind === "fixed" ? undefined : "steel", tone: "hi", crease: "faint", ...opts, group: groupOf(opts.group), owner: undefined });
    partsByName.set(part.name, part);
    ownerOf.set(part.name, tag);
    part.module = id;
    return part;
  };
  const ctx = {
    k, G, A, TA, TURN, T, R, P, M, W, F,
    id,
    owner: mod.owner,
    stub,
    theme: LIGHT ? "light" : "dark",
    stubbed: (other) => stubbed.has(other),
    group(name, spec) {
      if (phase !== "groups") throw new Error(`build: ${tag} declared group ${name} outside groups()`);
      return declare(name, spec, tag);
    },
    g(name) {
      const g = T.groups.find((x) => x.name === name);
      if (!g) throw new Error(`build: ${tag} looked up an unknown group ${name}`);
      return g;
    },
    rule(rule) {
      if (phase !== "groups") throw new Error(`build: ${tag} added a rule outside groups()`);
      addRule(rule, tag);
    },
    prism: wrap("prism"),
    round: wrap("round"),
    ball: wrap("ball"),
    hull: wrap("hull"),
    tube: wrap("tube"),
    fixed: wrap("fixed"),
    part: (name) => partsByName.get(name) ?? null,
    plane(part, opts) {
      return T.plane({ part, ...opts });
    },
    billboard(part, opts) {
      return T.billboard({ part, ...opts });
    },
    planeOn(partName, opts) {
      reg.planeOn.push({ partName, opts, by: tag });
    },
    static(item) {
      if (!item.name || !item.name.startsWith("stand.")) throw new Error(`build: ${tag} static ${item.name} must be named stand.*`);
      return R.put({ layer: "back", ...item, shapes: (item.shapes ?? []).map((s) => R.solid(s)) });
    },
    css(text) {
      reg.css.push(`/* ${tag} */\n${text}`);
    },
    vary(cls, expr) {
      if (reg.vary.has(cls)) throw new Error(`build: vary class ${cls} declared twice`);
      reg.vary.set(cls, { expr: typeof expr === "function" ? expr.toString() : `(ch, pv, s) => (${expr})`, by: tag });
    },
    light(spec) {
      if (!spec.id || !spec.part || !spec.at) throw new Error(`build: ${tag} light needs id, part and at`);
      if (reg.lights.some((L) => L.id === spec.id)) throw new Error(`build: light ${spec.id} registered twice`);
      reg.lights.push({ group: "pitch", ...spec, by: tag });
    },
    lamp(spec) {
      reg.lamps.push({ group: "pitch", ...spec, by: tag });
    },
    // fu/r1-lights: the point lights and lamps registered so far (copies), for M8's fallbacks (its lens copy on the part
    // that carries the lens, painted over the tip; the pools sampled from the registered lamps' own law: review fu-1)
    registeredLights: () => reg.lights.map((L) => ({ ...L })),
    registeredLamps: () => reg.lamps.map((L) => ({ ...L })),
    // fu/r1-lights end
    glTarget(spec) {
      reg.targets.push({ ...spec, by: tag });
    },
    glEffect(spec) {
      reg.effects.push({ ...spec, by: tag });
    },
    label(prefix, text, action = null) {
      reg.labels.push({ prefix, text: typeof text === "function" ? text.toString() : JSON.stringify(text), fn: typeof text === "function", action, by: tag });
    },
    accent(family, opts) {
      reg.accents.add(family);
      return T.plane({ ...opts, svg: `<g class="a3-acc a3-acc-${family}">${opts.svg}</g>` });
    },
    inspect(view) {
      reg.inspect.push({ ...view, by: tag });
    },
    clip(spec) {
      reg.clips.push({ ...spec, by: tag });
    },
    poseHints(list) {
      reg.hints.push(...list);
    },
    script(js) {
      reg.scripts.push(`// ---- ${tag}\n${js}`);
    },
    data(key, value) {
      // fu/r1-interiors: fade sets from several modules (the tug, the cabin's bins) merge instead of replacing each other
      reg.data[key] = key === "fades" && reg.data.fades ? { ...reg.data.fades, ...value } : value;
      // fu/r1-interiors end
    },
    report: (line) => report(`${tag}: ${line}`),
  };
  return ctx;
}

// groups() for every module in order, then build() (or the stub)
const plan = MODULES.map((mod) => ({ mod, real: selected.has(mod.id) && !mod.stub }));
for (const { mod, real } of plan) if (!real) stubbed.add(mod.id);
for (const { mod, real } of plan) if (real && mod.groups) mod.groups(makeCtx(mod, { phase: "groups" }));
for (const { mod, real } of plan) {
  if (real) mod.build(makeCtx(mod, { phase: "build" }));
  else STUBS[mod.id](makeCtx(mod, { phase: "build", stub: true }));
}
for (const { partName, opts, by } of reg.planeOn) {
  const part = partsByName.get(partName);
  if (!part) throw new Error(`build: planeOn by ${by} names an unknown part ${partName}`);
  T.plane({ part, ...opts });
}
// Inspect fades (I, review round 1): in the gear views the near wing's inboard flap, its root trailing edge and
// track fairing, and the near tailplane, fade to 15% (kit patch 16: a part's class on its <g>, a vary class), so
// both bogies read. The body-gear view is I's (aft quarter, port side).
const INSPECT_FADE = {
  "a3-fade-wlg": [/^wings\.r\.(flap\.in|te\.root|canoe\.2\.)/, /^wings\.r\.spl\.[12]/, /^skin\.fair\.r\.link/],
  "a3-fade-blg": [/^skin\.fair\.l\./, /^blg\.l\.door\.(out|in)/, /^wings\.l\.(flap\.in|te\.root|canoe\.2\.)/],
};
// the Cockpit view looks forward from the aft quarter: the canopy, the forward fuselage aft of the flight deck, the M1
// doors and the lifted First-class crown (cut.f) lie between the reader and the deck, so they fade (review round 2)
INSPECT_FADE["a3-fade-fd"] = [/^nose\.(canopy|wiper|fwd|f\.top)/, /^door\.M1[LR]/, /^fus\.blade\.vhf1/];
// fu/r2-interiors: and the radome, whose aft cap filled the view above the glareshield (beside the windscreen the cockpit
// group now shows in this view, parts/cabin.mjs buildWindscreen) and named itself there
INSPECT_FADE["a3-fade-fd"].push(/^nose\.radome/);
// fu/r2-interiors end
// the flight deck's rear bulkhead and stowage (M7's aft group, review round 3): between the reader and the deck in the
// Cockpit view, and faded in as its group syncs (cut.fd 24 → 30 units)
INSPECT_FADE["a3-fade-fda"] = [/^cockpit\.aft\./];
// fu/r1-gear: the WLG main doors and the fairing-door strips riding the leg fade with the fairing they close (follow-up
// review 1: with skin.fair.l faded the port WLG's shut main door and its strips floated solid over the bogie; in the
// Wing gear view the starboard strips hung as a creased tent over the bogie)
INSPECT_FADE["a3-fade-blg"].push(/^wlg\.l\.(door|fairing)/);
INSPECT_FADE["a3-fade-wlg"].push(/^wlg\.r\.fairing/);
// fu/r1-gear end
for (const part of T.parts)
  for (const [cls, list] of Object.entries(INSPECT_FADE)) if (!part.cls && list.some((re) => re.test(part.name))) part.cls = cls;
// review round 3: the faded pieces go lower (a 15% shell's outline and facet seams crossed the whole deck as a web of
// ghost lines); follow-up review 1 (fu/r1-gear, fu/r1-interiors, merged): to 0 in the Cockpit and gear views
// fu/r1-gear: the gear sets go to 0 (follow-up review 1: each part drawn at 10% stacked its ghost on the others' and
// doubled every facet seam, a milky band lifting the bogie's tyres about 80 levels); G's gear view takes the view's depth
const fadeIn = (view, gearShow = false, depth = 0.9) => `(ch, pv) => Math.min(pv.inspect === ${JSON.stringify(view)} ? 1 - ${depth} * Math.min(1, Math.max(0, ((pv.zoom || 1) - 1) / 3)) : 1, ${gearShow ? `1 - ${depth} * (pv.gearShow || 0)` : "1"})`;
reg.vary.set("a3-fade-wlg", { expr: fadeIn("wing-gear", false, 1), by: "I" });
// G on the ground (the 1x gear view at b -140) fades the port set as the Body gear view does
reg.vary.set("a3-fade-blg", { expr: fadeIn("body-gear", true, 1), by: "I" });
// fu/r1-gear end
// fu/r1-interiors: the Cockpit view takes the faded shells to 0, not 5% (they lie between the reader and the deck): at 5% the
// canopy's facet seams still drew light lines over the seats and the glareshield, and the fallback displays, painted under
// those shells, read 47 levels lighter than the GL displays painted over them
const FD_FADE = 1;
reg.vary.set("a3-fade-fd", { expr: fadeIn("cockpit", false, FD_FADE), by: "I" });
reg.vary.set("a3-fade-fda", { expr: `(ch, pv) => Math.min((${fadeIn("cockpit", false, FD_FADE)})(ch, pv), F.smooth(24, 30, F.tableAt(${JSON.stringify(W.CUTS["cut.fd"].table)}, ch.cabin || 0, "smooth")))`, by: "I" });
// fu/r1-interiors end
reg.inspect.push({ id: "body-gear", label: "Body gear", centre: [M.GEAR.body.centre[0], -M.GEAR.body.centre[1], 1.0], group: "blg.l.bogie", bearing: -150, zoom: 6, cutaway: 0, by: "I" });
// fallback billboards for every registered point light (lens sized in viewBox px), class a3-l-<id>
for (const L of reg.lights) {
  const part = partsByName.get(L.part);
  if (!part) throw new Error(`build: light ${L.id} names an unknown part ${L.part}`);
  // the lens has the GL pass's screen floor (1.4 px at 1x, and 2.2 px for a daylight glint): a true-size lens was a
  // 1.5 px grey speck without WebGL; a pale core over the saturated body, the halo under both
  const rl = Math.max(W.m(L.lens ?? 0.1) * FIT.k, LIGHT ? 2.2 : 1.4);
  const color = L.color ?? "white";
  T.billboard({ part, at: L.at, normal: L.normal ?? [0, 0, 1], fade: [-0.12, 0.22], svg: `<g class="a3-l a3-l-${L.id}" style="opacity:0"><circle class="a3-l-halo" data-color="${color}" r="${(rl * 3.2).toFixed(2)}"/><circle class="a3-l-lens" data-color="${color}" r="${rl.toFixed(2)}"/><circle class="a3-l-core" data-color="${color}" r="${(rl * 0.45).toFixed(2)}"/></g>` });
  if (!reg.vary.has(`a3-l-${L.id}`)) reg.vary.set(`a3-l-${L.id}`, { expr: "() => 0", by: "S" });
}
for (const family of reg.accents) if (!reg.vary.has(`a3-acc-${family}`)) reg.vary.set(`a3-acc-${family}`, { expr: `(ch, pv) => (pv.accent && pv.accent[${JSON.stringify(family)}]) || 0`, by: "S" });

// ---------------------------------------------------------------------------------------------
// poses (DESIGN §3.4): exactly 24·q entries, the key states at the sampled indices
// ---------------------------------------------------------------------------------------------
const followNode = F.makeFollow(rules, groupInfo, TURN);
const traj = F.trajectory(M, { every: 0.5, until: 140 });
const tourPhases = (() => {
  const sim = F.createSim(M);
  const out = { GATE: 0 };
  let t = 0;
  while (t < F.LOOP) {
    F.advance(M, sim, 1 / 60);
    t += 1 / 60;
    if (out[sim.phase] === undefined) out[sim.phase] = +t.toFixed(3);
    if (sim.phase === "FL100" && sim.done && sim.held >= F.FL100_HOLD) break;
  }
  out.END = +t.toFixed(3);
  return out;
})();
const timeline = {};
for (const s of traj) if (timeline[s.phase] === undefined) timeline[s.phase] = s.state.clock;
const reachable = [];
for (const s of traj) reachable.push(F.channelsOf(s.state, { cabin: 0 }));
// toggles on ground states (cutaway, doors, speed brake, steer), gear lever and speed brake in flight
const groundStates = traj.filter((s) => s.state.onGround).filter((_, i) => i % 6 === 0);
for (const s of groundStates) {
  for (const cabin of [0.3, 0.7, 1]) reachable.push(F.channelsOf(s.state, { cabin }));
  reachable.push(F.channelsOf(s.state, { spoiler: 50, spoiler1: 50, steer: (((reachable.length * 37) % 141) - 70) }));
  // the ground spoilers as the B button sets them: spoiler 1 at 35, 2-8 at 50, ailerons up 25 (and half way)
  reachable.push(F.channelsOf(s.state, { spoiler: 50, spoiler1: 35, aileron: -25 }));
  reachable.push(F.channelsOf(s.state, { spoiler: 25, spoiler1: 17.5, aileron: -12.5 }));
}
// spoilers 1 and 2 through their travel, and the B button's ground deployment (1-2 at 0.7 of 3-8, ailerons up)
{
  const g0 = groundStates[0] ?? traj[0];
  for (let sp = 5; sp <= 50; sp += 5) reachable.push(F.channelsOf(g0.state, { spoiler: sp, spoiler1: sp }));
  for (let sp = 5; sp <= 35; sp += 5) reachable.push(F.channelsOf(g0.state, { spoiler: Math.min(50, sp * 50 / 35), spoiler1: sp, aileron: (-25 * sp) / 35 }));
}
for (const s of traj.filter((x) => !x.state.onGround).filter((_, i) => i % 8 === 0)) {
  reachable.push(F.channelsOf(s.state, { spoiler: 30, cabin: 0.5 }));
  reachable.push(F.channelsOf(s.state, { spoiler: 30, spoiler1: 30 }));
}
reachable.push(...reg.hints);
// poses() takes reachable[(i·7) mod n]: every state is sampled only if n is prime to 7 and at most the 2,856 non-key
// entries. Review round 2: n was 525 = 7 × 75, so only 75 of the 525 states ever reached poses() (the kit's
// nearness test for groups in different frames runs over every state). The framed planes themselves come from the 24
// key states only (kit patch 9 is not done): spoilers 1 and 2 through their travel are in W.KEY_STATES.
while (reachable.length % 7 === 0) reachable.push(reachable[reachable.length - 1]);
if (reachable.length > 24 * 119) report(`poses: ${reachable.length} reachable states, more than the ${24 * 119} sampled: some are skipped`);
const Q = 120;
const POSES = 24 * Q;
function poses() {
  const out = [];
  for (let i = 0; i < POSES; i++) {
    const turn = (i * 360) / POSES;
    const base = i % Q === 0 ? W.KEY_STATES[i / Q] : reachable[(i * 7) % reachable.length];
    out.push(followNode({ ...base, turn }));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// T.build
// ---------------------------------------------------------------------------------------------
const t0 = Date.now();
// --turn-cache=<file> (development only): reuse a previous T.build's output for page-side iteration (live.js, the
// model's interaction, shaders, CSS). The caller deletes the file whenever geometry, planes or poses change; release
// builds never pass it.
const TURN_CACHE = option("turn-cache");
// fu/f4-interiors (f3-engine E1): the Inspect views' own camera elevations (ctx.inspect({ elevation })), proved by the
// build's order data and swept by the audit (sweep@e)
const VIEW_ELEVATIONS = [...new Set(reg.inspect.map((v) => v.elevation).filter((e) => typeof e === "number"))];
let out;
if (TURN_CACHE && existsSync(TURN_CACHE)) {
  const c = JSON.parse(readFileSync(TURN_CACHE, "utf8"));
  out = { data: c.data, css: c.css, svg: c.svg, svgBare: c.svgBare ?? c.svg, report: c.report, verify: c.verify };
  // the runtime scene of the cached data, so --bench and --check also run on a cache (perf iteration on kit/turn*.mjs)
  out.scene = TURN.prepare(out.data, { unit: T.scale });
  out.layerSvg = (name, { width, height, label = "", bare = false }) => `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg iso-live iso-layer" data-live="${name}" viewBox="0 0 ${width} ${height}" aria-hidden="true"${label ? ` aria-label="${label}"` : ""}>${(bare ? out.svgBare : c.svg)[name]}</svg>`;
  console.log(`build: T.build output reused from ${TURN_CACHE} (development only)`);
} else {
  // merge f4: the views' own elevations (interiors) and --elevations (engine), together
  const buildElevations = [...new Set([...VIEW_ELEVATIONS, ...ELEVATIONS])];
  out = T.build({ statics: R.items, poses, verify: VERIFY, ...(buildElevations.length ? { elevations: buildElevations } : {}) });
  if (TURN_CACHE) writeFileSync(TURN_CACHE, JSON.stringify({ data: out.data, css: out.css, svg: out.svg, svgBare: out.svgBare, verify: out.verify, report: { parts: out.report.parts, groups: out.report.groups, layers: out.report.layers, seconds: out.report.seconds } }));
}
report(`built ${out.report.parts} parts, ${out.report.groups} groups in ${out.report.seconds.toFixed(1)} s · ${out.report.layers.map((l) => `${l.name}: ${l.parts} parts, ${l.planar} planar, ${l.framed} framed, ${l.groupPairs} group pairs, ${l.dynamic} dynamic`).join(" · ")}`);
// kit patch 9 and the framed-plane sets (kit patches 9, 23): what they did, logged with the build
if (out.report.patch9) {
  const p9 = out.report.patch9;
  report(`patch 9: framed planes checked on every distinct relative pose (at most ${p9.poses} per group and frame, ${p9.capped} lists capped at 256): ${p9.failed} planes failed between the 24 sampled poses, ${p9.reframed} framed again, ${p9.dynamic} left dynamic${p9.names.length ? ` (${p9.names.join(", ")}${p9.failed > p9.names.length ? ", …" : ""})` : ""}`);
}
// f3-engine (E1, E3): the extra elevations proved, the re-ranked framed planes (if any)
if (out.report.elevations && out.report.elevations.length > 1) report(`elevations: order data proved at ${out.report.elevations.join("°, ")}°`);
if (out.report.rerank && out.report.rerank.near) report(`rerank: ${out.report.rerank.near} near-touching framed planes, ${out.report.rerank.changed} re-ranked${out.report.rerank.names.length ? ` (${out.report.rerank.names.join(", ")})` : ""}`);
if (out.report.subPairs) {
  const sp = out.report.subPairs;
  report(`framed sets: ${sp.covered} of ${sp.pairs} framed pairs covered by ${sp.sets} set pairs (${sp.members} members), each drawing only the pairs it covers`);
}
if (out.report.mirrored !== undefined) report(`mirrored hulls stored once: ${out.report.mirrored} (their planes too: ${out.report.mirroredPlanes})`);
if (out.report.copied !== undefined) report(`moved copies of hulls stored once: ${out.report.copied} (their planes too: ${out.report.copiedPlanes})`);
const turnBytes = JSON.stringify(out.data).length;
report(`data.turn ${(turnBytes / 1024).toFixed(0)} KB · stubs: ${[...stubbed].join(", ") || "none"}`);
A.settle(R, P);

// ---------------------------------------------------------------------------------------------
// checks (S world checks + modules)
// ---------------------------------------------------------------------------------------------
function worldChecks() {
  const lines = [];
  const fail = [];
  // mirror test: at turn 40 the nose faces the reader with the left (red) wing tip on the reader's right
  const tipL = W.poseOf(W.kit([47.3, -39.8, 6.36]), { turn: 40 });
  const tipR = W.poseOf(W.kit([47.3, 39.8, 6.36]), { turn: 40 });
  const xl = W.project(tipL, P)[0];
  const xr = W.project(tipR, P)[0];
  (xl > xr ? lines : fail).push(`mirror: at turn 40 the red tip is ${xl > xr ? "right" : "LEFT"} of the green tip (${xl.toFixed(1)} vs ${xr.toFixed(1)})`);
  lines.push(`fit: scale ${P.scale}, k ${FIT.k.toFixed(3)}, origin ${P.origin.join(", ")}, extremes y ${FIT.top.toFixed(1)}..${FIT.bottom.toFixed(1)}, x ${FIT.left.toFixed(1)}..${FIT.right.toFixed(1)} in ${VIEWBOX.join(" × ")}`);
  if (FIT.top < W.VIEW.pad - 0.5 || FIT.bottom > W.VIEW.height - W.VIEW.pad + 0.5 || FIT.left < 0 || FIT.right > W.VIEW.width) fail.push("fit: an extreme leaves the pad");
  // tour: peak ω and reversals
  let peak = 0;
  let reversal = false;
  let prev = F.tourBearing(0);
  for (let t = 1 / 60; t < F.LOOP; t += 1 / 60) {
    const b = F.tourBearing(t);
    const w = (b - prev) * 60;
    peak = Math.max(peak, Math.abs(w));
    if (w > 1e-6) reversal = true;
    prev = b;
  }
  (peak <= 30 && !reversal ? lines : fail).push(`tour: peak ω ${peak.toFixed(1)}°/s, ${reversal ? "REVERSES" : "no reversal"}`);
  // piece boundaries: no window crosses a boundary between the pieces that carry its row, none inside a door leaf
  const halfW = M.WINDOWS.size.width / 2;
  const halfH = M.WINDOWS.size.height / 2;
  const rowBounds = (z) => {
    const list = W.SHELL.filter((p) => !p.clip.side && (p.clip.zMin ?? -1e9) <= z - halfH + 1e-6 && (p.clip.zMax ?? 1e9) >= z + halfH - 1e-6);
    const strips = W.SHELL.filter((p) => p.clip.strip && p.clip.side > 0 && p.clip.zMin <= z - halfH + 1e-6 && p.clip.zMax >= z + halfH - 1e-6);
    return [...new Set([...list, ...strips].flatMap((p) => p.x.map((x) => Math.round(x * 1000) / 1000)))].filter((b) => b > 1.95 && b < 69);
  };
  let worst = Infinity;
  for (const [deckRow, z] of [["upper", M.WINDOWS.upperZ], ["main", M.WINDOWS.mainZ]])
    for (const x of M.WINDOWS[deckRow])
      for (const b of rowBounds(z)) {
        const gap = Math.abs(x - b) - halfW;
        worst = Math.min(worst, gap);
        if (gap < 0) fail.push(`window ${deckRow} ${x} crosses piece boundary ${b}`);
      }
  lines.push(`windows: smallest margin to a boundary of the pieces carrying their row ${worst.toFixed(3)} m`);
  for (const d of M.DOORS.passenger) for (const b of rowBounds(d.sillZ + 1)) if (Math.abs(d.x - b) < d.leafWidth / 2) fail.push(`door ${d.id} leaf crosses piece boundary ${b}`);
  // sync-pose test: the free-group sync equals the pitch group's world pose
  let err = 0;
  const scene = out.scene;
  for (let i = 0; i < 50; i++) {
    const ch = { ...W.KEY_STATES[i % 24], turn: i * 7.3, lift: (i % 7) * 8, pitch: (i % 5) * 2.5 };
    const vals = followNode(ch);
    const cams = TURN.cams(scene, vals);
    const pitch = cams[T.groups.find((g) => g.name === "pitch").index];
    const Rz = TURN.rotation([0, 0, 1], ch.turn);
    const Rp = TURN.rotation(W.PITCH.axis, ch.pitch);
    const Rs = TURN.compose(Rz, Rp);
    const Pp = W.PITCH.point;
    const rp = [Rp[0] * Pp[0] + Rp[1] * Pp[1] + Rp[2] * Pp[2], Rp[3] * Pp[0] + Rp[4] * Pp[1] + Rp[5] * Pp[2], Rp[6] * Pp[0] + Rp[7] * Pp[1] + Rp[8] * Pp[2]];
    const d = [Pp[0] - rp[0], Pp[1] - rp[1], Pp[2] - rp[2] + ch.lift];
    const t = [Rz[0] * d[0] + Rz[1] * d[1], Rz[3] * d[0] + Rz[4] * d[1], d[2]];
    // a rest point in pitch's local frame (relative to its origin) maps to R·local + t
    const local = [10, 20, 30];
    const world = [0, 1, 2].map((r) => pitch.R[3 * r] * local[0] + pitch.R[3 * r + 1] * local[1] + pitch.R[3 * r + 2] * local[2] + pitch.t[r]);
    const rest = [local[0] + Pp[0], local[1] + Pp[1], local[2] + Pp[2]];
    const viaSync = [0, 1, 2].map((r) => Rs[3 * r] * rest[0] + Rs[3 * r + 1] * rest[1] + Rs[3 * r + 2] * rest[2] + t[r]);
    err = Math.max(err, Math.hypot(world[0] - viaSync[0], world[1] - viaSync[1], world[2] - viaSync[2]));
  }
  (err < 1e-9 ? lines : fail).push(`sync pose: largest error ${err.toExponential(2)} over 50 states`);
  // the quadrant turns (follow-up r1, kit patch 30): within 1.7e-13° of 40 + 90k° (the push clip's 40 + 30t at t = 3 s
  // gives 129.99999999999983) every part's outline box and both layers' order equal the exact turn's
  {
    const frames = scene.runs.map((run) => TURN.frame(run));
    const take = (turn) => {
      const vals = followNode(W.groundChannels({ turn }));
      const cams = TURN.cams(scene, vals);
      for (const run of scene.runs) TURN.emit(run, run.group >= 0 ? cams[run.group] : cams.world, frames[run.index]);
      return { boxes: frames.map((f) => Array.from(f.box)), orders: scene.layers.map((layer) => Array.from(TURN.order(layer, frames, cams, layer.rest, {}, scene))) };
    };
    let worstBox = 0;
    let moved = 0;
    for (const q of [40, 130, 220, 310]) {
      const exact = take(q);
      for (const eps of [1.7e-13, -1.7e-13]) {
        const near = take(q + eps);
        for (let r = 0; r < near.boxes.length; r++) for (let c = 0; c < 4; c++) worstBox = Math.max(worstBox, Math.abs(near.boxes[r][c] - exact.boxes[r][c]));
        near.orders.forEach((o, l) => o.forEach((v, at) => (moved += v !== exact.orders[l][at] ? 1 : 0)));
      }
    }
    (worstBox < 1e-6 && moved === 0 ? lines : fail).push(`quadrant turns: 8 states 1.7e-13° off 40/130/220/310°: largest outline box change ${worstBox.toExponential(1)} units, ${moved} parts moved in the order`);
  }
  lines.push(`timeline (model s at phase start): ${Object.entries(timeline).map(([p, t]) => `${p} ${t.toFixed(0)}`).join(", ")}`);
  lines.push(`tour (figure s at phase start): ${Object.entries(tourPhases).map(([p, t]) => `${p} ${t.toFixed(1)}`).join(", ")}; loop ${F.LOOP} s, control check at ${F.CHECK_AT}–${F.CHECK_AT + 6} s`);
  if (tourPhases.TAXI > F.CHECK_AT) fail.push(`tour: the control check (${F.CHECK_AT} s) starts before TAXI (${tourPhases.TAXI} s)`);
  if (tourPhases.END > F.LOOP - 8.5) fail.push(`tour: the FL100 hold ends at ${tourPhases.END} s, too late for the 8 s rewind inside the ${F.LOOP} s loop`);
  lines.push(`WLG solve (M5): pintle ${JSON.stringify(W.WLG_SOLVE.pintle)}, θW ${W.WLG_SOLVE.thetaW}°, leg ${W.WLG_SOLVE.legLength} m, stay pin ${JSON.stringify(W.WLG_SOLVE.stayPivots.airframe)}`);
  return { lines, fail };
}
// fu/f4-verify: the README's Features line states the airframe's part and group counts; --check prints the built counts
// and fails when the line disagrees (the line kept the 743 / 162 of an earlier pass while main built 785 / 164)
function readmeCounts(fail) {
  const air = out.report.layers.find((l) => l.name === "airframe");
  const built = { parts: out.report.parts, groups: out.report.groups, aircraft: air ? air.parts : null };
  console.log(`S: counts: ${built.parts} parts in ${built.groups} motion groups, ${built.aircraft} of them the aircraft and its tug (the airframe layer)`);
  const file = join(HERE, "README.md");
  const m = existsSync(file) && readFileSync(file, "utf8").match(/\*\*Airframe\*\* \((\d+) parts in (\d+) motion groups, (\d+) of them the aircraft and its tug\)/);
  if (!m) fail.push("README.md: no '**Airframe** (n parts in n motion groups, n of them the aircraft and its tug)' line to compare the counts with");
  else if (+m[1] !== built.parts || +m[2] !== built.groups || +m[3] !== built.aircraft) fail.push(`README.md Features says ${m[1]} parts in ${m[2]} groups, ${m[3]} the aircraft and tug; the build has ${built.parts}, ${built.groups}, ${built.aircraft}`);
}
// fu/f4-verify end
if (CHECK) {
  const { lines, fail } = worldChecks();
  for (const line of lines) console.log(`S: ${line}`);
  for (const { mod, real } of plan)
    if (real && mod.checks) {
      try {
        mod.checks(makeCtx(mod, { phase: "checks" }), out);
      } catch (error) {
        fail.push(`${mod.owner} ${mod.id}: ${error.message}`);
      }
    }
  readmeCounts(fail); // fu/f4-verify
  for (const f of fail) console.log(`FAIL ${f}`);
  console.log(fail.length ? `check failed: ${fail.length}` : "check passed");
  if (fail.length) process.exitCode = 1;
}

// ---------------------------------------------------------------------------------------------
// audit (DESIGN §3.5, §10)
// ---------------------------------------------------------------------------------------------
const restCh = (extra = {}) => W.groundChannels(extra);
const withElevation = (ch, values) => (typeof ch.$elevation === "number" ? { ...values, $elevation: ch.$elevation } : values); // fu/f4-interiors
const CLIPS = [
  { name: "orbit", at: (x) => followNode(restCh({ turn: x })), from: 0, to: 360, frame: 0.05 },
  { name: "cutaway", at: (t) => followNode(restCh({ turn: 40, cabin: t < 1 ? F.smooth(0, 1, t) : 1 - F.smooth(1, 2, t) })), from: 0, to: 2, frame: 1 / 120 },
  { name: "takeoff", at: (t) => followNode(restCh({ turn: 125, lift: F.liftOf(Math.max(0, t - 2) * 3), pitch: Math.min(12.5, t * 3), rot: Math.min(12.5, t * 3) * (1 - F.smooth(0, 0.3, Math.max(0, t - 2) * 3)), trim: F.smooth(0.3, 2, Math.max(0, t - 2) * 3) })), from: 0, to: 6, frame: 1 / 60 },
  // fu/f4-interiors: a clip's state may carry a camera elevation (f3-engine E1), kept through the follow
  ...reg.clips.map((c) => ({ ...c, at: (t) => withElevation(c.at(t), followNode(c.at(t))) })),
  // review round 3: the stand with every door and hold open while the cutaway opens and closes (the canopy settling
  // over open M1 doors forced 49-123 picks in the browser's order check; no clip combined the two)
  { name: "cutawayDoors", at: (t) => followNode(restCh({ turn: 75, cabin: t < 1 ? F.smooth(0, 1, t) : 1 - F.smooth(1, 2, t), ...Object.fromEntries(M.DOOR_IDS.map((id) => [`door.${id}`, 1])) })), from: 0, to: 2, frame: 1 / 120 },
];
// A group the figure does not draw in a state: a free group parked by its sync rule (F.PARKED, 10 km up).
const isParked = (v) => Boolean(v && typeof v === "object" && v.t && v.t[2] >= 1e4);
const parkedGroups = (values) => Object.keys(values).filter((name) => isParked(values[name]));
// The parts of a set of groups and of every group under them.
const partsUnder = (names) => {
  const roots = new Set(names);
  const under = (g) => {
    for (let x = g; x; x = x.parent) if (roots.has(x.name)) return true;
    return false;
  };
  return new Set(T.parts.filter((part) => part.group && under(part.group)).map((part) => part.name));
};
// The kit audit runs at rest, where every group is at 0 and a free group sits where it was built. The rest pose of
// the figure has the cutaway closed, so the free groups (cabin, cockpit) are parked there and are absent. They are
// audited in the reachable state that shows them instead: the cutaway open, where every cut piece (and whatever
// rides it) is lifted at least 1.4 m clear of them (M7's checks), so those pieces are absent from that pass.
const auditPasses = () => {
  const restValues = followNode(restCh());
  const parked = partsUnder(parkedGroups(restValues));
  const lifted = partsUnder(Object.keys(W.CUTS));
  const without = (drop) => ({ ...R, solids: R.solids.filter((shape) => !drop.has(shape.name)), settled: R.settled });
  return [
    { name: "rest (cutaway closed, cabin and cockpit parked)", R: without(parked) },
    { name: "cutaway open (cabin and cockpit synced, cut pieces lifted clear)", R: without(lifted) },
  ];
};
if (AUDIT) {
  const clipArg = option("clip");
  let clips = CLIPS;
  let sweep = { at: (x) => followNode(restCh({ turn: x })), from: 0, to: 360, frame: 0.3 };
  if (clipArg) {
    // --clip=a,b:0-2,sweep: those clips (or slices), and the turn sweep only if named; no default sweep, in which
    // free groups would stand at rest while the airframe turns
    const names = clipArg.split(",");
    clips = names
      .filter((n) => n !== "sweep")
      .map((arg) => {
        const [name, range] = arg.split(":");
        const c = CLIPS.find((x) => x.name === name);
        if (!c) throw new Error(`build: --clip names an unknown clip ${name} (${CLIPS.map((x) => x.name).join(", ")})`);
        const [a, b] = range ? range.split("-").map(Number) : [c.from, c.to];
        return { ...c, from: a, to: b };
      });
    if (!names.includes("sweep")) sweep = false;
  }
  if (flag("list-clips")) console.log(`clips: ${CLIPS.map((c) => `${c.name} ${c.from}–${c.to} @${+c.frame.toFixed(4)}`).join(", ")}`);
  const passes = auditPasses();
  // fu/r2-verify: --no-kit-audit skips the kit audit (the clip-independent passes); the sharded full audit runs it in
  // one shard instead of all of them (a380/tools/full-audit.sh; 4 min a shard in round 12)
  if (flag("no-kit-audit")) console.log("kit audit skipped (--no-kit-audit)");
  else
  for (const pass of passes) {
    console.log(`kit audit · ${pass.name}`);
    A.auditOrExit(pass.R, P, { argv: [...argv, "--audit"] });
  }
  // f3-engine (E4): the riding pass. The cutaway pass above drops the lifted cut
  // pieces, so a part that rides one (a panel carried by the canopy) cannot be supported there; here every group is
  // posed in the open state (the cut pieces lifted, the free groups synced), the cut pieces' own parts held, and every
  // other solid must reach them or the ground (kit/turn-audit.mjs riding)
  if (!flag("no-kit-audit")) TA.ridingOrExit(T, R, followNode(restCh({ cabin: 1 })), { argv: [...argv, "--audit"], hosts: Object.keys(W.CUTS), absent: parkedGroups, name: "riding (cutaway open: cut pieces lifted and held, free groups synced, riders posed)" });
  // f3-engine end
  // f4-engine: the audit's extra elevations are --elevations' and every one the build proved (a state of poses() that
  // carries $elevation declares it), so a view that adopts an elevation is audited at it without a flag; merge f4: plus
  // the Inspect views' own elevations (interiors)
  const auditElevations = () => {
    const all = [...new Set([...ELEVATIONS, ...VIEW_ELEVATIONS, ...((out.report && out.report.elevations) || [])])].filter((e) => e !== (P.elevation ?? 30));
    return all.length ? { elevations: all } : {};
  };
  TA.orbitOrExit(T, passes[0].R, P, { argv: [...argv, "--audit"], quick: QUICK, only: auditOnly.length ? auditOnly : undefined, sweep, clips, poses: W.KEY_STATES.map((s) => followNode(s)), absent: parkedGroups, ...auditElevations(), ...(ELEVATED_ONLY ? { elevatedOnly: true } : {}) });
}

// fu/f3-verify: --shard-prints (a380/tools/full-audit.sh --reuse): what each audit shard audits, hashed, so a full audit
// re-runs only the shards a change touches. "print scene" covers the turn data, the recorded solids, the projection
// and the 24 key states every shard runs; "print clip <name>" every state of that clip at its audit frame (and the
// sweep's at 0.3°). Nothing is audited; the page goes where --out says (a380/tmp without it)
if (flag("shard-prints")) {
  const { createHash } = await import("node:crypto");
  const hashOf = (...items) => {
    const seen = new WeakSet();
    const plain = (key, v) => (v && typeof v === "object" ? (seen.has(v) ? undefined : (seen.add(v), ArrayBuffer.isView(v) ? Array.from(v) : v)) : typeof v === "function" ? undefined : v);
    const h = createHash("sha256");
    for (const item of items) h.update(JSON.stringify(item, plain) ?? "");
    return h.digest("hex").slice(0, 16);
  };
  const statesOf = (c) => {
    const list = [];
    for (let i = 0, n = Math.max(1, Math.round((c.to - c.from) / c.frame)); i <= n; i++) list.push(c.at(c.from + i * c.frame));
    return list;
  };
  console.log(`print scene ${hashOf(out.data, R.solids, P, W.KEY_STATES.map((s) => followNode(s)))}`);
  for (const c of CLIPS) console.log(`print clip ${c.name} ${hashOf(c.from, c.to, c.frame, statesOf(c))}`);
  console.log(`print clip sweep ${hashOf(statesOf({ at: (x) => followNode(restCh({ turn: x })), from: 0, to: 360, frame: 0.3 }))}`);
}
// fu/f3-verify end

// ---------------------------------------------------------------------------------------------
// bench (Node frame timing; DESIGN §5.11)
// ---------------------------------------------------------------------------------------------
if (BENCH) {
  // perf (followup/perf.md): the shipping pages paint the airframe on canvas, so they run kit/turn-fixed.mjs with its
  // numeric path arena (no SVG strings); the bench times that runtime ("bench:"), and the SVG runtime of the verify
  // pages (kit/turn.mjs, path strings) on its own line ("bench (svg runtime):")
  const { TURN: TURN_FIXED } = await import("../kit/turn-fixed.mjs");
  const runtimes = [
    { tag: "bench", RT: TURN_FIXED, numeric: true },
    { tag: "bench (svg runtime)", RT: TURN, numeric: false },
  ];
  // as the runtime renders (turn*.mjs render()): a run is re-emitted only when its group's pose changed (M7 S7)
  const samePose = (a, b) => {
    if (!a || !b) return false;
    for (let i = 0; i < 9; i++) if (a.R[i] !== b.R[i]) return false;
    return a.t[0] === b.t[0] && a.t[1] === b.t[1] && a.t[2] === b.t[2];
  };
  const turnList = Array.from({ length: 360 }, (_, i) => followNode(restCh({ turn: i })));
  const clipLists = CLIPS.filter((x) => x.name !== "orbit").map((c) => {
    const list = [];
    for (let t = c.from; t <= c.to; t += c.frame) list.push(c.at(t));
    return { name: c.name, list };
  });
  for (const { tag, RT, numeric } of runtimes) {
    const scene = RT.prepare(out.data, { unit: T.scale });
    const frames = scene.runs.map((run) => RT.frame(run));
    const time = (list) => {
      const t1 = performance.now();
      let last = null;
      if (numeric) RT.arena(true);
      for (const values of list) {
        const cams = RT.cams(scene, values);
        for (const run of scene.runs) {
          const g = run.group;
          if (last && (g < 0 || samePose(cams.poses[g], last[g]))) continue;
          RT.emit(run, g >= 0 ? cams[g] : cams.world, frames[run.index]);
        }
        last = cams.poses;
        for (const layer of scene.layers) RT.order(layer, frames, cams, layer.rest, {}, scene);
      }
      if (numeric) RT.arena(false);
      return (performance.now() - t1) / list.length;
    };
    time(turnList.slice(0, 30));
    console.log(`${tag}: turn ${time(turnList).toFixed(2)} ms/frame over 360 angles, ${scene.runs.length} parts`);
    for (const { name, list } of clipLists) console.log(`${tag}: ${name} ${time(list).toFixed(2)} ms/frame over ${list.length} frames`);
  }
}

// ---------------------------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const backItems = R.items.filter((item) => item.layer === "back" && typeof item.svg === "string").sort((a, b) => a.key - b.key);
const backSvg = `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg iso-layer a3-back" viewBox="0 0 ${VIEWBOX[0]} ${VIEWBOX[1]}" aria-hidden="true">${backItems.map((i) => i.svg).join("")}</svg>`;
const sizer = `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg a3-sizer" viewBox="0 0 ${VIEWBOX[0]} ${VIEWBOX[1]}" aria-hidden="true"></svg>`;
const canvasOf = (name) => `<canvas class="iso-layer a3-gl" data-canvas="${name}" aria-hidden="true"></canvas>`;
const DESC = "An Airbus A380-800 on a turntable: the double-deck fuselage, wings, four engines and the landing gear, turning slowly while it plays its departure. Drag, or use the left and right arrow keys, to turn it; keys 1 to 7 go to a phase of the departure, and the buttons below the drawing work the doors, cutaway, flaps, gear, engines, lights and the Inspect views."; // fu/f3-interaction: for a public reader
// perf (followup/perf.md): the shipping (canvas) pages carry the live layers' markup, the turn data and the GL data
// deflated in one payload, inflated by the page script (DecompressionStream) before the figure mounts; the verify
// pages keep everything inline for the tools
const PAYLOAD = PAINTER === "canvas" && !VERIFY;
const payload = {};
const liveLayer = (name, opts) => {
  const full = out.layerSvg(name, opts);
  if (!PAYLOAD) return full;
  const open = full.indexOf(">") + 1;
  payload[name] = full.slice(open, -"</svg>".length);
  return full.slice(0, open) + "</svg>";
};
const stageHtml = `<div class="iso-stage iso-turn a3-stage" tabindex="0" role="slider" aria-label="Airbus A380-800 on a turntable" aria-roledescription="turntable" aria-valuemin="0" aria-valuemax="359" aria-valuenow="0" aria-valuetext="Turntable 0°" aria-describedby="a3-desc">${sizer}${backSvg}${liveLayer("deck", VIEWBOX_OPTS())}${canvasOf("runway")}${canvasOf("ground")}${liveLayer("airframe", { ...VIEWBOX_OPTS(), bare: PAINTER === "canvas" })}${canvasOf("air")}</div><p id="a3-desc" class="a3-sr">${esc(DESC)}</p>`;
function VIEWBOX_OPTS() {
  return { width: VIEWBOX[0], height: VIEWBOX[1] };
}
const chip = (key) => (key ? `<kbd class="a3-chip">${esc(key)}</kbd>` : "");
const button = ({ key, label, phase, action, tip, state, hidden }) => `<button type="button" class="a3-btn"${hidden ? " hidden" : ""}${phase ? ` data-phase="${phase}" aria-current="false"` : ` data-action="${action}" aria-pressed="false"`} aria-describedby="a3-tip" data-tip="${esc(tip ?? "")}">${chip(key)}<span class="a3-label">${esc(label)}</span>${state ? `<span class="a3-state">${esc(state)}</span>` : ""}</button>`;
const PHASE_LABELS = { GATE: "Gate", PUSHBACK: "Push & start", TAXI: "Taxi", LINEUP: "Line-up", TAKEOFF: "Take-off", CLIMB: "Climb", FL100: "10,000 ft" };
// reader-facing tips, one statement per event (review round 3: the tips were the model's notes, with code names, a
// repeated sentence, and a jet bridge and a tug the figure does not draw)
const PHASE_TIPS = {
  GATE: "At the stand: passenger doors open for boarding and catering, all three cargo holds open, the APU running",
  PUSHBACK: "A towbarless tug picks up the nose wheel while the doors close and the slides arm; the beacon comes on once cleared to push; the tug pushes back while engines 1 and 2 start, then 3 and 4; it releases the nose wheel as they come up to idle and drives off",
  TAXI: "Slats then flaps set CONF 1+F (slats 20°, flaps 8°, ailerons drooped 5°); taxi and runway turn-off lights on",
  LINEUP: "Entering the runway: strobes, landing lights and the nose take-off light on",
  TAKEOFF: "Take-off thrust; rotation at 3° a second from 153 kt, lift-off at 163 kt",
  CLIMB: "Gear up after positive climb; climb thrust at 1,500 ft; flaps then slats in; nose and turn-off lights off",
  FL100: "Passing 10,000 ft the landing lights go off; strobes, beacon and nav stay on",
};
const legendRows = [
  // fu/f4-interaction: a Pause button (a touch reader has no Space key: review, "no pause control without a keyboard")
  { name: "Phases", items: [...F.PHASE_ORDER.map((id) => ({ key: F.PHASE_KEYS[id], label: PHASE_LABELS[id], phase: id, tip: PHASE_TIPS[id] })), { key: "Space", label: "Pause", action: "pause", tip: "Pause or resume the departure, a seek or a door swing" }] },
  {
    name: "Systems",
    items: [
      { key: "D", label: "Doors", action: "doors", tip: "Open or close all 19 doors (at the stand)" },
      { key: "C", label: "Cutaway", action: "cutaway", tip: "Lift the roof off the flight deck and the four cabin bays" },
      { key: "F", label: "Flaps", action: "flaps", state: "0/1/2/3/FULL", tip: "Flaps lever: 0, 1 (1+F on the ground and below 205 kt), 2, 3, FULL" },
      { key: "K", label: "Control check", action: "check", tip: "Full and free: roll, pitch and yaw (on the ground)" },
      // fu/r1-interaction: the gear's times from the model (the tip said 18 s down; the body gear's 2 s lag makes it 20)
      { key: "G", label: "Gear", action: "gear", tip: `Gear lever in flight (${M.GEAR.timing.retract.total} s up, ${M.GEAR.timing.extend.total} s down); on the ground, show the main gear (the near fairing and flap fade)` },
      { key: "E", label: "Engines", action: "engines", tip: "Start 1 and 2, then 3 and 4, or shut down all four (on the ground)" },
      { key: "B", label: "Speed brake", action: "speedbrake", tip: "Ground spoilers 1–2 at 35°, 3–8 at 50°, ailerons up 25°; in flight all eight at 30°" },
      { key: "I", label: "Inspect", action: "inspect", state: " ", tip: "Look closely at the cockpit, cabins, an engine, the gear, a door and the tail (I next, Shift+I previous, Esc back)" },
      { key: "Shift+I", label: "Prev view", action: "inspect:prev", tip: "The previous Inspect view (before the first, back to the turntable)", hidden: true }, // fu/f4-interaction: touch had no Shift+I
      { key: "Esc", label: "Back", action: "inspect:leave", tip: "Leave the Inspect view", hidden: true },
    ],
  },
  {
    name: "Lights",
    items: [
      // in the order of the A380's EXT LT panel: STROBE, BEACON, WING, NAV, LOGO, RWY TURN OFF, LAND, NOSE
      { label: "Strobe", action: "light:strobe", state: "Off", tip: "Strobes: Off, Auto (on when airborne), On" },
      { label: "Beacon", action: "light:beacon", tip: "Red anti-collision beacons, two on top and one below" },
      { key: "S", label: "Wing & eng scan", action: "light:scan", tip: "Wing and engine scan lights" },
      { label: "Nav", action: "light:nav", tip: "Navigation lights: red left, green right, white tail" },
      { label: "Logo", action: "light:logo", state: "Auto", tip: "Logo lights on the tailplanes: Auto (on the ground, or with the slats out), On, Off" },
      { label: "Rwy turn-off", action: "light:runwayTurnoff", tip: "Runway turn-off lights on the nose gear (dark with the gear up)" }, // fu/r1-interaction: no chip (the reason is on the tip line)
      { label: "Land", action: "light:landing", tip: "Landing lights, two at each wing root (off passing 10,000 ft)" },
      { label: "Nose", action: "light:takeoff", state: "Off", tip: "Nose: Off, Taxi, T.O (the nose-strut lights go dark with the gear up; the wing-root taxi lights stay on)" }, // fu/r1-interaction: the wing-root taxi lights
      { label: "Cabin", action: "light:cabin", tip: "Cabin lights" },
    ],
  },
];
const legend = `<div class="a3-legend" role="group" aria-label="Controls">${legendRows.map((row) => `<div class="a3-row" role="group" aria-label="${row.name}"><span class="a3-row-name">${row.name}</span>${row.items.map(button).join("")}</div>`).join("")}<p class="a3-tip" id="a3-tip" aria-live="off"></p></div>`;
const CAPTION =
  "An Airbus A380-800 on a turntable, built from Airbus's airport-planning drawings: 72.7 m long, 79.8 m across the wingtip fences and 24.1 m tall. It stands at its 562 t ramp weight and takes off at 510 t. It has four 334 kN Rolls-Royce Trent 970s, 22 wheels on five legs, and Airbus's standard 555 seats in three classes on two decks. It flies the Airbus departure at the model's rates. The doors close and the beacon comes on before the push. Engines 1 and 2 start, then 3 and 4. The slats and then the flaps set CONF 1+F in 52 s of taxiing. The take-off roll lasts 57 s and 2.1 km, rotating at 3° a second from 153 kt to lift off at 163 kt. Gear up is selected 2 s after positive climb and retracts in 16 s. Thrust comes back to climb at 1,500 ft, the flaps and then the slats retract at S speed, and the landing lights go off passing 10,000 ft. Time runs compressed by the factor in the readout, and heights above a few metres are compressed on the turntable. Speeds, thrust settings, and the gear and flap timings are engineering estimates.";
// fu/f4-interaction: "keys beside" where the legend stands beside the card (a380.css, landscape tablets and laptops)
const hint = `<span class="a3-hint-fine">Drag to turn · click a part · keys <span class="a3-hint-below">below</span><span class="a3-hint-beside">beside</span></span><span class="a3-hint-coarse">Drag to turn · tap a part or button</span>`;
const plateBody = `<style>${out.css}\n${readFileSync(join(HERE, "a380.css"), "utf8")}\n${reg.css.join("\n")}</style>${stageHtml}<p class="a3-live a3-sr" aria-live="polite"></p>`;
let plateHtml = k.plateHtml({ fig: "Fig 1", title: "Airbus A380-800", hint: "HINT", readout: "", body: plateBody });
plateHtml = plateHtml.replace(">HINT<", `>${hint}<`).replace("</div></figure>", `</div><figcaption class="iso-legend a3-figcaption">${legend}<p class="iso-caption a3-caption">${esc(CAPTION)}</p></figcaption></figure>`);

const gl = glData({ P, W, reg, view: VIEWBOX });
const varyFns = [...reg.vary.entries()].map(([cls, v]) => `${JSON.stringify(cls)}: ${v.expr}`).join(",\n");
const labels = reg.labels.map((L) => `{ prefix: ${JSON.stringify(L.prefix)}, text: ${L.text}, action: ${JSON.stringify(L.action)} }`).join(",\n");
const DATA = { fades: Object.fromEntries(Object.entries(INSPECT_FADE).map(([cls, list]) => [cls, list.map((re) => re.source)])), turn: out.data, rules: rules.map(({ owner, ...r }) => r), groups: groupInfo, painter: PAINTER, gl, timeline, tourPhases, inspect: reg.inspect, mod: reg.data, verify: VERIFY ? out.verify : undefined, light: LIGHT };
if (PAYLOAD) {
  payload.turn = DATA.turn;
  payload.gl = DATA.gl;
  DATA.turn = "__A3P_TURN__";
  DATA.gl = "__A3P_GL__";
}
const dataSrc = JSON.stringify(DATA)
  .replace(/^\{/, `{ varyFns: {${varyFns}}, labels: [${labels}], `)
  .replace('"__A3P_TURN__"', "A3P.turn")
  .replace('"__A3P_GL__"', "A3P.gl");
const wrapModule = (file, name) => {
  const src = readFileSync(join(HERE, file), "utf8");
  const names = [...src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z0-9_$]+)/gm)].map((m) => m[1]);
  return `const ${name} = (() => {\n${src.replace(/^export\s+/gm, "")}\nreturn { ${names.join(", ")} };\n})();\n`;
};
// theme switch: the page script is a theme-independent runtime (runtime-shell.js: the kit, M, F, the GL page files and
// live.js inside boot()) and the theme (its DATA as a factory: the vary functions and labels are code, and they name
// the runtime's F, M, A3, A3GL and A3M8, handed over by boot; the layers' markup, turn and GL data in the payload).
// Both themes build the same runtime byte for byte (build-site.mjs checks it); the site loads one theme at a time
const live = readFileSync(join(HERE, "live.js"), "utf8")
  .replace("const DATA = __DATA__;", () => 'const DATA = THEME.data(Object.assign(A3S, { F, M, A3GL, A3M8: typeof A3M8 !== "undefined" ? A3M8 : undefined }));')
  .replace("window.__a380 = A3;", () => "window.__a380 = A3;\nif (A3S.bindA3) A3S.bindA3(A3);")
  .replace("\n/*@MODULES@*/\n", () => `\n${reg.scripts.join("\n")}\n`);
if (!live.includes("THEME.data(") || !live.includes("A3S.bindA3(A3)")) throw new Error("build: live.js lost its DATA or window.__a380 line (the theme factory's hooks)");
const THEME_NAME = LIGHT ? "light" : "dark";
const themeSrc = `(window.__A3THEME ??= {})[${JSON.stringify(THEME_NAME)}] = { name: ${JSON.stringify(THEME_NAME)}, light: ${LIGHT}, data: (S) => {
  const { F, M, A3GL, A3M8, A3P } = S;
  const LIGHT = ${LIGHT ? 1 : 0};
  let A3;
  S.bindA3 = (a) => {
    A3 = a;
  };
  return ${dataSrc};
} };`;
const pageFiles = ["gl/runtime.js", "gl/harness.js", "gl/mask.js", "gl/passes.js", "gl/runway.js"].map((f) => `// ==== a380/${f}\n${readFileSync(join(HERE, f), "utf8")}`).join("\n");
// the payload's loader: top-level await in the page's module script, so the figure's own code runs after it
const payloadJson = JSON.stringify(payload);
// theme switch: the inflate stays in the standalone page (its boot section); the markup's install is the runtime's, so a
// remount in the other theme installs that theme's markup
const loader = PAYLOAD
  ? `const A3P = await (async () => {
  const text = atob(${JSON.stringify(deflateRawSync(Buffer.from(payloadJson, "utf8"), { level: 9 }).toString("base64"))});
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  const json = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
  return JSON.parse(json);
})();`
  : "const A3P = {};";
const install = `await (async () => {
  const p = A3S.A3P;
  if (p.deck === undefined && p.airframe === undefined) return;
  for (const name of ["deck", "airframe"]) {
    const svg = document.querySelector(\`svg[data-live="\${name}"]\`);
    if (svg && p[name] !== undefined) svg.innerHTML = p[name];
    // (follow-up r1: the bare airframe markup is only the canvas painter's source; it is not shown before the painter
    // replaces it. Opacity, not visibility: the painter's compile reads the parts' computed styles)
    if (svg && name === "airframe") svg.style.opacity = "0";
  }
  // follow-up r1: the markup's first style and layout in a task of their own, then the mount (one 979 ms task on a
  // phone at 4x CPU held the loader, the controller's mount and the first style recalc)
  await new Promise((done) => {
    const late = setTimeout(done, 100);
    requestAnimationFrame(() => {
      clearTimeout(late);
      setTimeout(done, 0);
    });
  });
})();`;
// fu/r2-verify: the page carries the sources it was built from (git describe and a hash of the a380/ and kit/ sources,
// scripts/source-hash.mjs); lines.mjs and turn-check print it and warn when the working tree differs
const SOURCE_STAMP = { ...sourceStamp(join(HERE, "..")), at: new Date().toISOString().slice(0, 19) + "Z" };
const body = [(PAINTER === "canvas" ? fixedScript() : turnScript()), glScript(), wrapModule("model.mjs", "M"), wrapModule("follow.mjs", "F"), pageFiles, install, live].join("\n");
const shell = readFileSync(join(HERE, "runtime-shell.js"), "utf8");
if (shell.split("/*@BODY@*/").length !== 2) throw new Error("build: runtime-shell.js must hold one /*@BODY@*/ marker");
const docOn = body.split("document.addEventListener(").length - 1;
if (!docOn) throw new Error("build: no document.addEventListener( in the page body (runtime-shell.js tracks them as A3RT_docOn)");
const runtime = shell.replace("/*@BODY@*/", () => body.replaceAll("document.addEventListener(", "A3RT_docOn("));
// the page script's sections, each between markers (a380/tools/build-site.mjs splits the page there): the runtime, the
// theme and the standalone page's boot (the payload inflated from the page, then boot())
const section = (name, text) => `/*@a3:${name}@*/\n${text}\n/*@a3:${name}:end@*/`;
const bootSrc = `${loader}\nwindow.__a380Figure = await window.__A3RT.boot({ ...window.__A3THEME[${JSON.stringify(THEME_NAME)}], p: A3P });`;
const script = [`window.__a380Source = ${JSON.stringify(SOURCE_STAMP)};`, VERIFY ? `window.__isoVerify = ${JSON.stringify(out.verify)};` : "", section("runtime", runtime), section("theme", themeSrc), section("boot", bootSrc)].join("\n");
// fu/f3-interaction: the public page's head: a title and description for a reader arriving from a link, viewport-fit=cover
// (a380.css clears the safe-area insets), and the theme's colour for the browser's bars
const page = k
  .pageHtml({ title: "Airbus A380-800 · an interactive 3D cutaway", theme: LIGHT ? "light" : "dark", body: plateHtml, script, width: 1000 })
  .replace('<meta name="viewport" content="width=device-width, initial-scale=1">', () => `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="description" content="An interactive 3D cutaway of the Airbus A380-800: turn it, open its doors and cabins, and play its departure from the gate to 10,000 ft."><meta name="color-scheme" content="${LIGHT ? "light" : "dark"}"><meta name="theme-color" content="${LIGHT ? "#f2f2ef" : "#0b0b0b"}">`);
if (!page.includes("viewport-fit=cover")) throw new Error("build: the page head's viewport tag changed (fu/f3-interaction)");
// fu/r2-verify: only a plain build run directly writes a default page (a380[-light][-verify].html). Imported (turn-check
// --fidelity, the audit tools) or with --check, --audit or --bench, a build without --out writes a380/tmp/<mode>-<pid>.html,
// so a check never rewrites the shipping pages from whatever tree it runs on (sort review: the documented fidelity
// command rebuilt a380/a380.html)
const MAIN = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const SIDE = !MAIN ? "import" : CHECK ? "check" : AUDIT ? "audit" : BENCH ? "bench" : flag("shard-prints") ? "shard-prints" : null; // fu/f3-verify: shard-prints
const file = option("out") ? resolve(option("out")) : SIDE ? join(HERE, "tmp", `${SIDE}-${process.pid}${LIGHT ? "-light" : ""}${VERIFY ? "-verify" : ""}.html`) : join(HERE, `a380${LIGHT ? "-light" : ""}${VERIFY ? "-verify" : ""}.html`);
if (SIDE && !option("out")) {
  mkdirSync(dirname(file), { recursive: true });
  console.log(`build: ${SIDE === "import" ? "imported" : `--${SIDE}`} without --out: the page goes to ${file}, not a shipping page`);
}
writeFileSync(file, page);
report(`wrote ${file} (${(page.length / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)} s${PAYLOAD ? ` · payload ${(payloadJson.length / 1024).toFixed(0)} KB deflated into the page` : ""}`);
if (VERIFY) {
  // fu/r2-verify: a default verify page's states and paths go to a380/tmp as before; a page written elsewhere (--out,
  // or a check's tmp page) gets its own beside it, <page name>-states/, so two agents building verify pages from
  // different trees no longer overwrite each other's inputs (path-checks finds that folder from the page; turn-check
  // --states-dir, hinge-cover and full-audit.sh --index take it)
  const statesDir = file === join(HERE, `a380${LIGHT ? "-light" : ""}-verify.html`) ? join(HERE, "tmp") : join(dirname(file), `${basename(file).replace(/\.html$/, "")}-states`);
  mkdirSync(statesDir, { recursive: true });
  report(`verify states and paths: ${statesDir}`);
  const states = [];
  for (const c of CLIPS.filter((x) => x.name !== "orbit")) for (let t = c.from; t <= c.to + 1e-9; t += c.frame) states.push(c.at(t));
  writeFileSync(join(statesDir, `s-states-clips${LIGHT ? "-light" : ""}.json`), JSON.stringify(states));
  // fu/verify: one continuous path per clip (every frame pair, ≤ 0.02 per state, ≤ 3,000 states per file) and the 7
  // phase paths (R63); the code is a380/tools/verify-paths.mjs
  const { writeVerifyPaths } = await import("./tools/verify-paths.mjs");
  // fu/r1-verify: the module clips' channels and the vary classes, for the paths' __vary (the tug's fade on push)
  const channels = new Map(reg.clips.map((c) => [c.name, c.at]));
  for (const line of writeVerifyPaths({ dir: statesDir, clips: CLIPS, F, M, follow: followNode, light: LIGHT, channels, vary: reg.vary })) report(line);
  // fu/r1-verify end
  // fu/verify end
}
export { T, R, P, W, followNode as follow, out, CLIPS };
