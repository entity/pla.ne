#!/bin/bash
# a380/tools/full-audit.sh (follow-up package verify, item 53; DESIGN §10 "Orbit audit, sharded"): the full (non-quick)
# orbit audit, one background process per clip family and per orbit eighth, a few at a time, longest first.
#
#   a380/tools/full-audit.sh --list             the shards, their estimated wall times and commands (nothing runs)
#   a380/tools/full-audit.sh --dry-run [-j 9]   the same, as the exact command lines; the expected wall time at -j (longest
#                                               first, from the estimates); a check that every audit clip in the index
#                                               (a --verify build's states-paths.json) is in a shard, that the orbit's
#                                               ranges cover 0-360 and that the shards' --only lines cover every line
#   a380/tools/full-audit.sh [-j 9] [--out a380/tmp/full] [--times summary.txt] [--index states-paths.json] [shard …]
#                                               run the shards (all, or the named ones), at most -j at once, longest
#                                               first (each one builds the figure, about 2.5-5 GB, then audits); every
#                                               log is <out>/<shard>.txt with the wall time and peak memory on its last
#                                               line; <out>/summary.txt has each shard's verdict and the gate. It first
#                                               runs the same checks as --dry-run and refuses to start when a clip is in
#                                               no shard, the orbit has a gap, a line is in no shard or the index is
#                                               missing (review round 1: the push clip was in no shard, and only the dry
#                                               run said so)
#   a380/tools/full-audit.sh … --reuse <old out>  (fu/f3-verify) run only the shards a change touches: a shard whose
#                                               fingerprint (below, before the gate) is unchanged since <old out> and
#                                               whose log there is clean is copied, not run; with --dry-run, say which
#   a380/tools/full-audit.sh --gate [--out a380/tmp/full]
#                                               the gate alone, over the logs already in <out>
#
# --times <file>: take the order from a previous run's summary.txt ("done <shard>: … · <s> s …" lines) where it names a
# shard; the estimates below otherwise. --index: the clip index to check against (default a380/tmp/states-paths.json;
# a --verify build with --out writes it in <out name>-states/ beside the page).
#
# The kit audit (both reachable passes) is clip-independent: only the `static` shard runs it; every other shard runs
# with --no-kit-audit (round 12 ran it in all 16 shards, about 4 min each). Every shard runs the 24 key states, then its
# own lines over its own clips. Together the shards cover every line of `node a380/build.mjs --audit` (no --only, no
# --clip): the static lines (rigid, swept, coverage, routes) on the turn sweep, and order, posed, continuity and depth
# on the sweep, the orbit (in eighths) and every clip.
#
# The gate (fu/r2-verify; review round 12: no shard can print "turn audit passed", since every shard runs with --only):
# it passes when the kit audit passed in both passes (the static shard), every shard ended "turn audit passed" or
# "turn audit partial: no problems in what ran", and the shards' --only lines together are every audit line, their
# clips every clip, and the orbit's ranges 0-360. It ends "full audit gate passed" or "full audit gate failed: …".
#
# (fu/f3-verify) Now 44 shards from round 13's measured times (the table below): 846 min of shard time, about 76 min at
# -j 12 and 58 at -j 16 by the longest-first schedule (round 13's 28 shards, 83 min at -j 12, would schedule at 83 and
# 60 with their measured times); the longest shard is the sweep, 35 min. Clip slices start on the clip's audit frame
# grid (checked), so no step between two slices goes unchecked.
#
# Wall times (round 12, main at 7002974, -j 9 under load 16-31, the kit audit in every shard): orbit quarters
# 3,205-3,494 s, ground 3,338, flaps over 3,302 (stopped), takeoff 2,804, doors over 2,781 (stopped), sweep 2,680, tail
# 2,303, cabin 2,256, cutawayDoors 2,050, gearDown 1,982, cutaway 1,956, gearUp 1,931, static 390: 16 shards, about
# 42,000 s in all, so -j 9 needs at least 78 min whatever the split. The estimates below take the kit audit (about
# 240 s) out of every shard but static and split the long families (round 2, -j 2 under load 23: flaps+flaps220
# 3,249 s, so flaps and flaps220 are apart too; doors 2,436 s, doors180 2,145, controlCheck 1,561); --dry-run prints
# the longest-first schedule: 28 shards, 708 min of shard time: about 85 min at -j 9, 69 at -j 12, 52 at -j 16 (the
# longest shards, the sweep and doors, 41 min). The work bounds -j 9 at 79 min; one shard's time takes -j 16, about
# 80 GB at peak.
set -u
cd "$(dirname "$0")/../.." || exit 1
J=9
OUT=a380/tmp/full
MODE=run
TIMES=
INDEX=a380/tmp/states-paths.json
REUSE=
PICK=()
while [ $# -gt 0 ]; do
  case "$1" in
    --list) MODE=list ;;
    --dry-run) MODE=dry ;;
    --gate) MODE=gate ;;
    -j) J=$2; shift ;;
    --out) OUT=$2; shift ;;
    --times) TIMES=$2; shift ;;
    --index) INDEX=$2; shift ;;
    --reuse) REUSE=$2; shift ;;
    *) PICK+=("$1") ;;
  esac
  shift
done
DYN=order,posed,continuity,depth
NOKIT=--no-kit-audit
# name | estimated wall time in s (round 12, the kit audit taken out; split families pro rata) | arguments after
# `node a380/build.mjs --audit`
# (fu/f3-verify) round 13's measured wall times (main at 9c272b9, -j 12 on an otherwise quiet machine, the kit audit
# in the static shard only; the orbit, push and cabin-b from the re-run on kit patch 41), and every family over about
# 1,800 s split in halves at a clip time (or into its clips) (--clip=name:a-b, as the orbit's eighths were): the halves' estimates are half
# the family's time less a fixed part (about 100 s: the build, the 24 key states) plus that part. The sweep (2,084 s, a
# periodic family the build cannot slice) is now the longest shard, so -j 16 runs in about the work's own bound
SHARDS=(
  "static|242|--only=rigid,swept,coverage,routes --clip=sweep"
  "sweep|2084|--only=$DYN --clip=sweep $NOKIT"
  "orbit-s01|1040|--only=$DYN --clip=orbit:0-22.5 $NOKIT"
  "orbit-s02|1040|--only=$DYN --clip=orbit:22.5-45 $NOKIT"
  "orbit-s03|1090|--only=$DYN --clip=orbit:45-67.5 $NOKIT"
  "orbit-s04|1090|--only=$DYN --clip=orbit:67.5-90 $NOKIT"
  "orbit-s05|1040|--only=$DYN --clip=orbit:90-112.5 $NOKIT"
  "orbit-s06|1040|--only=$DYN --clip=orbit:112.5-135 $NOKIT"
  "orbit-s07|1050|--only=$DYN --clip=orbit:135-157.5 $NOKIT"
  "orbit-s08|1050|--only=$DYN --clip=orbit:157.5-180 $NOKIT"
  "orbit-s09|1065|--only=$DYN --clip=orbit:180-202.5 $NOKIT"
  "orbit-s10|1065|--only=$DYN --clip=orbit:202.5-225 $NOKIT"
  "orbit-s11|1030|--only=$DYN --clip=orbit:225-247.5 $NOKIT"
  "orbit-s12|1030|--only=$DYN --clip=orbit:247.5-270 $NOKIT"
  "orbit-s13|1010|--only=$DYN --clip=orbit:270-292.5 $NOKIT"
  "orbit-s14|1010|--only=$DYN --clip=orbit:292.5-315 $NOKIT"
  "orbit-s15|1035|--only=$DYN --clip=orbit:315-337.5 $NOKIT"
  "orbit-s16|1035|--only=$DYN --clip=orbit:337.5-360 $NOKIT"
  "cutaway|1511|--only=$DYN --clip=cutaway $NOKIT"
  "cutawayDoors|1728|--only=$DYN --clip=cutawayDoors $NOKIT"
  "takeoff|1395|--only=$DYN --clip=takeoff $NOKIT"
  "takeoff.0|1015|--only=$DYN --clip=takeoff.0 $NOKIT"
  "takeoff.230|1015|--only=$DYN --clip=takeoff.230 $NOKIT"
  "ground|1457|--only=$DYN --clip=steer,speedbrake $NOKIT"
  "push-a|1245|--only=$DYN --clip=push:0-9.5 $NOKIT"
  "push-b|1245|--only=$DYN --clip=push:9.5-19 $NOKIT"
  "gear-0|1532|--only=$DYN --clip=gearUp,gearDown $NOKIT"
  "gear-125|1497|--only=$DYN --clip=gearUp.125,gearDown.125 $NOKIT"
  "gear-230|1544|--only=$DYN --clip=gearUp.230,gearDown.230 $NOKIT"
  "flaps-a|995|--only=$DYN --clip=flaps:0-69.25 $NOKIT"
  "flaps-b|995|--only=$DYN --clip=flaps:69.25-138.6 $NOKIT"
  "flaps220-a|1065|--only=$DYN --clip=flaps220:0-69.25 $NOKIT"
  "flaps220-b|1065|--only=$DYN --clip=flaps220:69.25-138.6 $NOKIT"
  "controls|1399|--only=$DYN --clip=controlCheck $NOKIT"
  "rudder|1453|--only=$DYN --clip=rudder,rudder.side $NOKIT"
  "elevator|1432|--only=$DYN --clip=elevator,elevator.side $NOKIT"
  "doors-a|1076|--only=$DYN --clip=doors:0-10 $NOKIT"
  "doors-b|1076|--only=$DYN --clip=doors:10-20 $NOKIT"
  "doors180-a|1083|--only=$DYN --clip=doors180:0-10 $NOKIT"
  "doors180-b|1083|--only=$DYN --clip=doors180:10-20 $NOKIT"
  "cabin0|950|--only=$DYN --clip=cabin0 $NOKIT"
  "cabin125|950|--only=$DYN --clip=cabin125 $NOKIT"
  "cabin230|944|--only=$DYN --clip=cabin230 $NOKIT"
  "cabinClimb|944|--only=$DYN --clip=cabinClimb $NOKIT"
  # (prove round, f4) fu/f4-interiors added the clip cockpitView (turns 0-360 at 0.5°, the cutaway open, the camera at
  # 42°); it was in no shard, so the runner refused to start. Two halves; estimated from the orbit eighths' rate
  # (about 2.1 s a state plus 100 s) with the cutaway's larger scene: not yet measured
  "cockpitView-a|1100|--only=$DYN --clip=cockpitView:0-180 $NOKIT"
  "cockpitView-b|1100|--only=$DYN --clip=cockpitView:180-360 $NOKIT"
)
# every line of the orbit audit (kit/turn-audit.mjs ORBIT_CHECKS)
LINES="order rigid swept posed routes coverage continuity depth"
KIT_SHARD=static
cmd() { echo "node --max-old-space-size=24000 a380/build.mjs --audit $2 --out=$OUT/$1.html"; }
selected() {
  [ ${#PICK[@]} -eq 0 ] && return 0
  for p in "${PICK[@]}"; do [ "$p" = "$1" ] && return 0; done
  return 1
}
for p in "${PICK[@]}"; do
  printf '%s\n' "${SHARDS[@]}" | cut -d'|' -f1 | grep -qx "$p" || { echo "no shard named $p (--list shows them)"; exit 1; }
done
# the estimate for a shard: the last "done <name>: … · <s> s" line of --times when that run's shard of the same name
# audited the same clips (its "start <name> …: <command>" line has the same --clip; round 12's 16 shards reused names
# that are smaller now), else the table's
estimate() {
  local t="" was now
  if [ -n "$TIMES" ] && [ -f "$TIMES" ]; then
    was=$(grep -E "start $1( |:)" "$TIMES" | tail -1 | grep -o -- '--clip=[^ ]*')
    now=$(echo "$3" | grep -o -- '--clip=[^ ]*')
    [ "$was" = "$now" ] && t=$(sed -n "s/^.* done $1: .* · \([0-9.]*\) s .*/\1/p" "$TIMES" | tail -1)
  fi
  [ -n "$t" ] && echo "${t%.*}" || echo "$2"
}
# the shards, longest first: lines "estimate|name|args"
ordered() {
  for s in "${SHARDS[@]}"; do
    name=${s%%|*}; rest=${s#*|}; est=${rest%%|*}; args=${rest#*|}
    selected "$name" || continue
    echo "$(estimate "$name" "$est" "$args")|$name|$args"
  done | sort -t'|' -k1,1nr
}
# the expected wall time at -j: the longest-first schedule over the estimates
expected() {
  ordered | cut -d'|' -f1 | node -e '
    const t = require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean).map(Number);
    const j = +process.argv[1]; const lanes = new Array(Math.min(j, t.length)).fill(0);
    for (const x of t) { let k = 0; for (let i = 1; i < lanes.length; i++) if (lanes[i] < lanes[k]) k = i; lanes[k] += x; }
    const sum = t.reduce((a, b) => a + b, 0);
    console.log(`${t.length} shards, ${Math.round(sum / 60)} min of shard time; at -j ${j}, longest first: about ${Math.round(Math.max(...lanes) / 60)} min (the longest shard ${Math.round(Math.max(...t) / 60)} min)`);' "$J"
}
# the shards' coverage, over all of SHARDS (not only the picked ones): every audit clip of the index in a shard, the
# orbit's ranges 0-360 without a gap, and every audit line in some shard's --only. 0 when all hold, 1 when one fails,
# 2 when there is no index to check the clips against
coverage() {
  local covered missing count status=0 lines_missing orbit_gap
  lines_missing=$(for l in $LINES; do printf '%s\n' "${SHARDS[@]}" | grep -q -- "--only=[^ ]*\b$l\b" || echo "$l"; done)
  if [ -n "$lines_missing" ]; then echo "audit lines in no shard: $(echo $lines_missing)"; status=1; fi
  # (fu/f3-verify) every sliced clip's slices cover its whole time (the orbit's 0-360; a clip's from-to from the index)
  orbit_gap=$(printf '%s\n' "${SHARDS[@]}" | grep -o -- '--clip=[^ ]*' | sed 's/--clip=//' | tr ',' '\n' | node -e '
    const fs = require("fs");
    const specs = fs.readFileSync(0, "utf8").split("\n").filter(Boolean);
    let index = null;
    try { index = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch {}
    const span = (name) => (name === "orbit" ? [0, 360] : index && (index.hinge.find((e) => e.name === name) || {}).to !== undefined ? [index.hinge.find((e) => e.name === name).from ?? 0, index.hinge.find((e) => e.name === name).to] : null);
    const byName = new Map();
    for (const spec of specs) { const [name, range] = spec.split(":"); if (!byName.has(name)) byName.set(name, []); byName.get(name).push(range ? range.split("-").map(Number) : null); }
    const gaps = [];
    for (const [name, list] of byName) {
      if (list.some((r) => r === null)) continue;
      const whole = span(name);
      if (!whole) { gaps.push(`${name} (sliced, but its time span is not in the index)`); continue; }
      // a slice boundary off the clip audit frame grid would leave the step across it unchecked (each slice samples
      // from its own start: flaps at 0.125 s split at 69.3 compared 69.25 and 69.3 with neither)
      const frame = name === "orbit" ? 0.05 : (index.hinge.find((e) => e.name === name) || {}).frame;
      for (const [a, b] of list) for (const x of [a, b]) { const k = (x - whole[0]) / frame; if (x < whole[1] - 1e-9 && Math.abs(k - Math.round(k)) > 1e-6) gaps.push(`${name} boundary ${x} off its ${+frame.toFixed(5)} frame grid`); }
      let at = whole[0];
      for (const [a, b] of list.sort((x, y) => x[0] - y[0])) { if (a > at + 1e-9) gaps.push(`${name} ${at}-${a}`); at = Math.max(at, b); }
      if (at < whole[1] - 1e-9) gaps.push(`${name} ${at}-${whole[1]}`);
    }
    if (gaps.length) console.log(gaps.join(", "));' "$INDEX")
  if [ -n "$orbit_gap" ]; then echo "clip times in no shard: $orbit_gap"; status=1; fi
  if [ ! -f "$INDEX" ]; then
    echo "clip check: $INDEX not found: build with --verify (it writes the index) to check that every clip is in a shard"
    [ $status -eq 0 ] && status=2
    return $status
  fi
  covered=$(printf '%s\n' "${SHARDS[@]}" | sed -n 's/.*--clip=\([^ ]*\).*/\1/p' | tr ',' '\n' | sed 's/:.*//' | sort -u)
  missing=$(node -e 'const i=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(["orbit",...i.hinge.map((e)=>e.name)].join("\n"))' "$INDEX" | sort -u | comm -23 - <(echo "$covered"))
  count=$(node -e 'const i=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(i.hinge.length+1)' "$INDEX")
  if [ -n "$missing" ]; then
    echo "clips in no shard: $(echo $missing)"
    return 1
  fi
  [ $status -eq 0 ] && echo "every audit clip ($count with the orbit, from $INDEX of $(date -u -r "$INDEX" '+%F %T') UTC) is in a shard; the orbit's and every sliced clip's ranges cover their whole time; every audit line ($(echo $LINES | wc -w)) is in a shard"
  return $status
}
# a shard log's verdict: its last verdict line, or how it ended when it printed none
verdict() {
  local f=$1 v
  [ -f "$f" ] || { echo "no log"; return; }
  v=$(grep -E 'turn audit (passed|failed|partial|quick)|^audit failed|Error|Command terminated' "$f" | tail -1)
  [ -n "$v" ] && echo "$v" || echo "no verdict ($(tail -1 "$f"))"
}
# the gate over the logs in $OUT (every shard of SHARDS, not only the picked ones): see the header
gate() {
  local bad=() clean=0 total=0 v kit
  for s in "${SHARDS[@]}"; do
    name=${s%%|*}
    total=$((total + 1))
    v=$(verdict "$OUT/$name.txt")
    case "$v" in
      "turn audit passed"*|"turn audit partial: no problems in what ran"*) clean=$((clean + 1)) ;;
      *) bad+=("$name: $v") ;;
    esac
  done
  kit=$(grep -c '^audit passed' "$OUT/$KIT_SHARD.txt" 2>/dev/null)
  [ "${kit:-0}" -ge 2 ] || bad+=("kit audit: $KIT_SHARD.txt has ${kit:-0} of 2 'audit passed' (both passes)")
  coverage > "$OUT/.coverage.txt"
  local cs=$?
  [ $cs -eq 0 ] || bad+=("coverage: $(tr '\n' ' ' < "$OUT/.coverage.txt")")
  echo "clean shards: $clean of $total (\"turn audit passed\" or \"partial: no problems in what ran\"); kit audit passed in ${kit:-0} of 2 passes ($KIT_SHARD)"
  if [ ${#bad[@]} -eq 0 ]; then
    echo "full audit gate passed"
    return 0
  fi
  printf '  %s\n' "${bad[@]}"
  echo "full audit gate failed: ${#bad[@]} reason$([ ${#bad[@]} -eq 1 ] || echo s)"
  return 1
}
# (fu/f3-verify) --reuse <old out>: re-run only the shards a change touches. Each shard's fingerprint hashes what it
# audits: the kit's sources (kit/*.mjs), the build's audit section, the scene (turn data, recorded solids, projection,
# the 24 key states: `build.mjs --shard-prints`), every state of each of its clips at the audit frame, and its own
# arguments. A shard whose fingerprint is the same as in <old out>/prints.txt and whose old log is clean is not run:
# its log is copied into --out, and the summary says so. Any change to the geometry, the kit or the audit code touches
# every shard; a change to one clip touches its shards only; a change to the page alone (live.js, CSS, the WebGL
# layer, the painter) touches none. Every run writes <out>/prints.txt for the next.
prints() {
  mkdir -p "$OUT"
  local kit audit_block raw name rest args clips fp c
  kit=$(cat kit/*.mjs | sha256sum | cut -c1-16)
  audit_block=$(sed -n '/^\/\/ audit (DESIGN §3.5/,/^\/\/ bench (Node frame/p' a380/build.mjs | sha256sum | cut -c1-16)
  node --max-old-space-size=24000 a380/build.mjs --shard-prints --out="$OUT/prints.html" > "$OUT/prints-build.txt" 2>&1
  if ! grep -q '^print scene ' "$OUT/prints-build.txt"; then
    echo "shard prints: the build printed none ($(tail -1 "$OUT/prints-build.txt")): every shard runs"
    : > "$OUT/prints.txt"
    return 1
  fi
  : > "$OUT/prints.txt"
  for s in "${SHARDS[@]}"; do
    name=${s%%|*}; rest=${s#*|}; args=${rest#*|}
    clips=$(echo "$args" | grep -o -- '--clip=[^ ]*' | sed 's/--clip=//' | tr ',' '\n' | sed 's/:.*//')
    raw="kit $kit audit $audit_block $(grep '^print scene ' "$OUT/prints-build.txt") args $args"
    for c in $clips; do raw="$raw $(grep "^print clip $c " "$OUT/prints-build.txt" || echo "clip $c unknown")"; done
    fp=$(echo "$raw" | sha256sum | cut -c1-16)
    echo "shard $name $fp" >> "$OUT/prints.txt"
  done
  rm -f "$OUT/prints.html"
  echo "shard prints: $(wc -l < "$OUT/prints.txt") shards fingerprinted (kit $kit, audit section $audit_block, $(grep '^print scene ' "$OUT/prints-build.txt")) in $OUT/prints.txt"
}
# 0 when <REUSE> has the same fingerprint for the shard and a clean log
reusable() {
  local name=$1 now was v
  [ -n "$REUSE" ] && [ -f "$REUSE/prints.txt" ] && [ -f "$OUT/prints.txt" ] || return 1
  now=$(grep "^shard $name " "$OUT/prints.txt" | cut -d' ' -f3)
  was=$(grep "^shard $name " "$REUSE/prints.txt" | cut -d' ' -f3)
  [ -n "$now" ] && [ "$now" = "$was" ] || return 1
  v=$(verdict "$REUSE/$name.txt")
  case "$v" in "turn audit passed"*|"turn audit partial: no problems in what ran"*) return 0 ;; esac
  return 1
}
if [ "$MODE" = gate ]; then
  gate
  exit $?
fi
if [ "$MODE" != run ]; then
  ordered | while IFS='|' read -r est name args; do
    if [ "$MODE" = list ]; then printf '%-14s %5s s  %s\n' "$name" "$est" "$args"; else echo "nohup /usr/bin/time -f '%e s %M KB' $(cmd "$name" "$args") > $OUT/$name.txt 2>&1 &"; fi
  done
  expected
  if [ "$MODE" = dry ] && [ -n "$REUSE" ]; then
    prints
    torun=(); kept=()
    while IFS='|' read -r est name args; do if reusable "$name"; then kept+=("$name"); else torun+=("$name"); fi; done < <(ordered)
    echo "--reuse $REUSE: ${#kept[@]} shards unchanged and clean there (${kept[*]:-none}); ${#torun[@]} to run (${torun[*]:-none})"
  fi
  if [ "$MODE" = dry ]; then
    coverage
    [ $? -eq 1 ] && exit 1
  fi
  exit 0
fi
# (review round 1, fu/r1-verify) the merge gate: never start a full audit that would leave a clip unaudited
coverage
status=$?
if [ $status -ne 0 ]; then
  echo "full audit not started: $([ $status -eq 1 ] && echo "a clip, an orbit range or an audit line is in no shard (fix SHARDS)" || echo "no clip index to check the shards against (--index)")"
  exit 1
fi
mkdir -p "$OUT"
start=$(date +%s)
{ echo "full audit, sharded: started $(date -u '+%F %T') UTC, at most $J at once, longest first, logs in $OUT"; expected; } | tee "$OUT/summary.txt"
prints | tee -a "$OUT/summary.txt"
while IFS='|' read -r est name args; do
  if reusable "$name"; then
    cp "$REUSE/$name.txt" "$OUT/$name.txt"
    echo "$(date -u '+%T') reused $name from $REUSE (fingerprint $(grep "^shard $name " "$OUT/prints.txt" | cut -d' ' -f3) unchanged): $(verdict "$OUT/$name.txt") · $(tail -1 "$OUT/$name.txt")" | tee -a "$OUT/summary.txt"
    continue
  fi
  while [ "$(jobs -rp | wc -l)" -ge "$J" ]; do sleep 5; done
  echo "$(date -u '+%T') start $name (estimate $est s): $(cmd "$name" "$args")" | tee -a "$OUT/summary.txt"
  ( /usr/bin/time -f '%e s %M KB' $(cmd "$name" "$args") > "$OUT/$name.txt" 2>&1
    echo "$(date -u '+%T') done $name: $(verdict "$OUT/$name.txt") · $(tail -1 "$OUT/$name.txt")" >> "$OUT/summary.txt" ) &
done < <(ordered)
wait
echo "all shards ended after $(( ($(date +%s) - start) / 60 )) min" | tee -a "$OUT/summary.txt"
if [ ${#PICK[@]} -gt 0 ]; then
  echo "(the gate reads every shard's log in $OUT; only ${PICK[*]} ran now)" >> "$OUT/summary.txt"
fi
gate >> "$OUT/summary.txt"
cat "$OUT/summary.txt"
