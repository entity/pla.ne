# Airbus A380-800 · Fig 1

An interactive, true-3D cutaway drawing of an Airbus A380-800 on a turntable, built with the Anatomy skill's 3D mode
(`kit/turn-build.mjs`, `kit/turn.mjs`) and WebGL (`kit/gl.mjs`) for every light, glow and effect. It is one
self-contained HTML page with no network requests:

- `a380/a380.html`: dark theme (night, the lights carry the picture);
- `a380/a380-light.html`: light theme (daylight; lenses read as glints, no bloom).

Both are written by `node a380/build.mjs`. Every size, rate and rule comes from `a380/model.mjs`, which is sourced
in `a380/truth.md` (Airbus airport-planning drawings, EASA type certificates, Airbus Safety First and the other
sources listed there). Numbers marked as estimates in the truth sheet are engineering estimates.

## What it shows

A museum-style display model stands on a slowly turning platter. The platter is a slice of airfield that follows
the phase: the stand at the gate, a code F taxiway, then the runway; in the air it becomes fields, hedges, roads
and a river far below. The model flies Airbus's departure from the truth model, in seven phases:

1. **Gate.** Passenger doors open for boarding and catering, all three cargo holds open, the APU running.
2. **Push & start.** A towbarless tug picks up the nose wheel while the doors close and the slides arm; the beacon
   comes on once cleared to push; the tug pushes the aircraft back about 76 m while engines 1 and 2 start, holds it
   while 3 and 4 start, releases the nose wheel as they come up to idle, and drives off.
3. **Taxi.** The slats then the flaps set CONF 1+F (slats 20°, flaps 8°, ailerons drooped 5°); taxi and runway
   turn-off lights on; the flight-control check runs (roll, pitch, yaw).
4. **Line-up.** Strobes, landing lights and the nose take-off light on.
5. **Take-off.** Take-off thrust; the FADEC holds 78% N1 below 32.5 kt; rotation at 3° a second from 153 kt,
   lift-off at 163 kt, the bogies following the runway as the aircraft pitches.
6. **Climb.** Gear up 2 s after positive climb (16 s, true sequence and directions; extending, the body gear's legs
   trail the wing gear's by 2 s, 20 s in all; on screen the gear's transit plays at ×2.5, about 6.4 s up and 8 s
   down); climb thrust at 1,500 ft; the flaps lever comes back at S speed, flaps then slats in; nose and turn-off
   lights off (the nose-strut lights go dark with the gear up, the wing-root taxi lights stay on with NOSE until then).
7. **10,000 ft.** The landing lights go off; strobes, beacon and nav stay on.

When nobody touches it, an idle tour plays the whole departure in a 128 s loop, walking the turntable round the
aircraft (the cutaway opens at the gate so the cabins can be read), then rewinds to the stand. Time is compressed by
the factor shown in the readout (×2 to ×30); heights above a few metres are compressed on the turntable
(`6·tanh(h/6)` m) while the readout shows the true altitude.

## Features

**Airframe** (795 parts in 164 motion groups, 793 of them the aircraft and its tug):
- the double-deck fuselage, 72.7 m, with its true two-superellipse section, the drooping nose and radome (the canopy
  stations follow the model's section, with planar facets under the windscreen panes), the windscreen and wipers,
  lap joints, antennas and drains, the A380's air-data probes (three multi-function probes with their AoA vanes, the
  standby pitot, three side-slip vanes and six flush static ports);
- 218 cabin windows on both decks, 16 passenger doors (M1–M5 and U1–U3, both sides) on their parallel arms, each
  swinging out and parking forward of its doorway with a lit doorway interior; a shut door is a flush plate with one
  outline, its porthole and a one-stroke handle bar;
- 3 cargo doors (forward, aft, bulk) on the right side, the forward and aft ones opening 110° onto their **cargo
  holds** (the bulk door, which opens inward and up, names itself and opens or closes on a click): the lining, the
  ceiling light strip and the roller floor, two LD3 containers in the forward hold, an LD3 and a netted pallet aft,
  and bags behind the net in the bulk hold (they read from the right side; the open panels hang over them from the
  turntable's 30° camera);
- wings spanning 79.8 m over the wingtip fences: droop noses, slats, three Fowler flaps per side on their track
  fairings (canoes), three ailerons, eight spoilers per side, landing and taxi lamps in the wing roots, fence lights
  (the top obstruction light in its own housing); the root trailing edge over the gear recess reads as one shroud over
  a dark cove;
- the fin with its two-part rudder, the tailplanes with four elevators, logo lamps, the APU and its exhaust;
- four Rolls-Royce Trent 970s on their rounded pylons (a round half-ellipse nose): chrome inlet lips (at Inspect zoom
  shaded across the lip's section, from a deep throat to a narrow glint, with one accent ring at the throat),
  fans that spin clockwise (seen from the front) at the model's N1 with a once-per-revolution blade mark, seen
  through the inlet's parallax crescent (also without WebGL), spinners, cores and plugs, and heat haze at power;
- 22 wheels on five legs: the steerable nose gear, two wing gears and two six-wheel body gears with steered rear
  axles, two-link stays, leg-mounted and hydraulic doors, oleo travel and bogie tilt, retracting in their true
  directions (nose forward, wing gear inboard, body gear aft) into their bays. The body gear's outer doors open 99°
  and close again around each transit; the wing- and body-gear bays show their frames, hydraulic lines with clamps,
  uplock boxes and door actuators, in dark well tones that fade with their depth into the bay.

**At the stand:** the pushback tug, a towbarless tractor of the A380 class (TLD TPX-500-S, Goldhofer AST-1X), drives
in and picks up the nose wheel while the doors close, pushes the aircraft back, then releases the wheel and drives off.
It is a long, low chassis with the driver's cab just ahead of the cradle, side frames flanking the nose wheels and its
drive wheels outboard on hub motors, with chevrons and lamps; it is drawn as far as the platter goes, its forward end
fading out toward the platter's edge.

**Cutaway and interiors** (C, or click the canopy or a crown): the roof lifts off the flight deck and four cabin
bays:
- the flight deck: captain's and first officer's seats with headrests, two observer seats, the windscreen seen from
  inside (six panes, posts, coamings and the cut side wall's sill under the side windows, while the Cockpit view
  fades the canopy), side consoles with the upright OIT
  screens and keypads, keyboard tables sliding out under the main panel, the sidesticks with their grips and takeover
  buttons, the thrust quadrant with four levers, the pedestal, the gear lever, gear lamps, autobrake and clock on the
  centre-right panel, the two ISIS, the glareshield and eight displays (PFD with pitch ladder and tapes, ND with its
  compass rose, heading box and aircraft symbol, EWD with
  four N1 dials, ND, PFD, MFD, SD, MFD) that light up once powered (without WebGL in the GL output's colours), the seat
  backs with their back panels, inertia-reel housings and map pockets, a carpeted floor, the rear bulkhead with the
  flight-deck door, a coat and a stowage cupboard, and an inset of the overhead panel whose EXT LT row shows the light
  switches live, each lamp named (on phones only that row);
- First (main deck forward suites), upper-deck Business (shells with hoods), main-deck Economy and upper-deck
  Economy: 190 seats in the four cut bays (FD 4, F 22, U 60, M 80, UY 24), seats on legs side-on (cushion bands,
  rails, armrests), overhead bins at their true height over the window seats (24 units with doors and latches, 1.6–2.1 m
  over the deck, riding their own groups once the crowns are clear; the row whose outboard face turns toward the reader
  fades out, as a cutaway cuts the near side lower), the window reveals on every cut wall,
  the bay-end fronts (the M2 galley with its trolley bays, aisle curtains and closets; the U1 lavatory doors), the
  forward stair, the upper-deck side stowage and the M4 galley with its counter tops, carpets that follow the cabin
  lighting;
- the **Deck plan** (the last Inspect view): both decks at true scale on the platter with all 555 seats by class
  (First 22, Business 96, Economy 334 and 103; 356 main, 199 upper) plus the 4 flight-deck seats, the 16 passenger
  doors, and all 20 monuments (stairs, galleys with trolley bays and cart lifts, 15 lavatories, coats, the crew rest);
  the four cut bays are outlined, and the airframe ghosts to 5% behind it. The plan carries only its two deck names; a
  key box in the card's corner gives the counts and the class key, and every seat zone, monument, door, the flight deck
  and each deck names itself (and is outlined) on hover or tap.

**Lights** (WebGL, masked by the parts in front of them; a canvas/SVG fallback for each when WebGL is missing or
its context is lost):
- navigation lights (red left, green right, white tail) with their true sectors, and fence obstruction lights;
- red beacons, two on top and one below, the lower one washing the pavement red at night;
- white wing-tip and tail strobes (double flash);
- logo lights washing the fin; wing and engine scan lights;
- four landing lights, three taxi lights, three nose take-off lights and two runway turn-off lights, each with its
  lens, its beam and haze at night, and its pool where the cone meets the platter; ground pools from the camera,
  cargo-flood and gear-bay lights;
- the cabin lighting in all 218 windows and the open doorways (warm, dimmable, some blinds down), dimmed for
  take-off as the real cabin is;
- the cockpit windows and displays; the stand, taxiway and runway lights on the platter, including the threshold
  bar, green toward the approach and red toward the runway (dark side-on);
- light rules come from the model: landing lights off passing 10,000 ft, the nose-strut lights dark with the gear up
  (the wing-root taxi lights stay on with NOSE), the logo lights on the ground or with the slats out, the strobes on in
  the air on AUTO; open doorways and the cabin interior follow the cabin dimmer;
- WebGL programs compile one at a time after the first frame, so the page comes up drawn and the lights arrive over
  about 6–10 s at 1440 px; the canvas/SVG fallback matches the GL windows (also their pale cores at Inspect zoom), the
  lamp lenses (their night halos one smooth gradient each, a beacon's or strobe's swelling with the flash as the GL's
  does, with a second drawing for Inspect zoom), the ground pools, the beacon pool, the strobe washes, the logo wash and
  the scan washes on the wing slats, box tops and nacelles within a few levels, and draws each beam as a flat banded
  shaft; the engines' heat haze is GL-only.

**Readout and labels.** The card's readout shows the phase, flap configuration, N1, speed, altitude, gear and time
rate; where the full readout does not fit beside the hint it uses a shorter form, and the phone form shows CONF, N1,
speed, height, the gear (↑ ↓ moving) and the rate. Pointing at, or tapping, any of the parts names it with a sourced fact (for
example a tyre's size, pressure and braking); the label follows the part's state. In the push the readout names the
tug (`tug connecting`, `tug pushing 3 kt`, `tug releasing`, `tug driving off`), and the tug has its own label.
While an Inspect view is open the readout names it first (`Inspect · Cockpit · 1/10`), followed on a wide card by
the flight readout where it fits. A picked part is outlined whole: the outline is the convex hull of every solid its
label names (an engine's lip, cowls, core and plug).

## Controls

**Pointer.**
- Drag anywhere on the stage to turn the turntable (it keeps turning with inertia). On a touch screen a sideways drag
  turns it and an upright one scrolls the page; a pinch zooms the page as anywhere else.
- Hover (mouse) or tap (touch) a part to name it in the readout.
- Click, or tap a second time, to operate it: a door opens or closes; an engine starts or stops (on the ground); the
  canopy or a cabin crown toggles the cutaway; a seat block opens that deck's Inspect view.

**Keyboard** (on a page with one figure the keys work as soon as it is on screen; with focus elsewhere in the page, a
link or a field, focus the figure first; the legend's buttons are reachable with Tab):

| Key | Action |
|---|---|
| ← / → | turn 3° (Shift: 15°) |
| Home | back to the tour's bearing |
| 1–7 | go to a phase (Gate, Push & start, Taxi, Line-up, Take-off, Climb, 10,000 ft); any later phase is reached in at most 3 s, an earlier one by rewinding; pressed while paused, the seek plays and the figure pauses again where it arrives |
| Space | pause or resume (the legend's Pause button too); a pause holds until the next Space (the tour does not take over), and freezes a seek or rewind |
| D | all 19 doors; away from the stand it rewinds to the stand first and opens them there (refused with a reason while the engines turn at the stand) |
| C | cutaway |
| F / Shift+F | flaps lever forward (0, 1, 2, 3, FULL) / back; FULL and 0 are the ends of the gate, a position above its speed limit is refused with the reason, and in the air the lever comes back to 0 only at S speed (the legend's button walks forward to FULL, then back); D, K, G (in flight), E and the lever wait for a reader's seek or rewind to arrive |
| K | flight-control check (on the ground) |
| G | gear lever in flight; on the ground, show the main gear (the near fairing and flap fade) |
| E | engines: start 1+2 then 3+4, or shut down all four (on the ground, stopped, with the pushback tug gone) |
| B | speed brake: on the ground spoilers 1–2 at 35°, 3–8 at 50° and ailerons up; in flight all eight at 30°; refused on the take-off roll |
| S | wing and engine scan lights |
| I / Shift+I | next / previous Inspect view |
| [ / ] | steer the nose wheel −/+ 10° (below 0.5 kt; held until the next press, a phase change or the aircraft moving; refused while the pushback tug holds it) |
| Esc | leave Inspect, stop a seek or rewind, or return to the tour |

Held keys repeat only for ← / → and [ / ]; every other key acts once per press.

**Legend** (buttons under the card, in three rows):
- **Phases:** Gate, Push & start, Taxi, Line-up, Take-off, Climb, 10,000 ft, and Pause (pressed while paused; the same
  as Space, so a touch reader can freeze the departure, a door swing or a seek).
- **Systems:** Doors, Cutaway, Flaps (with the lever position and CONF), Control check, Gear, Engines, Speed brake,
  Inspect, and Prev view and Back while a view is open.
- **Lights**, in the order of the A380's EXT LT panel: Strobe (Off/Auto/On), Beacon, Wing & eng scan, Nav, Logo
  (Auto/On/Off), Rwy turn-off, Land, Nose (Off/Taxi/T.O), and Cabin. Each button's pressed state shows whether the
  light is lit; its chip shows the switch position (Strobe, Logo, Nose) in a fixed width; where a rule holds it dark
  the chip is underlined and the reason is on the tip line and in the button's description; a click that cannot take
  effect says why. The overhead inset's EXT LT lamps follow the same lit state.

**Inspect views** (I): Cockpit, First, Upper deck, Main deck, Engine 2, Wing gear, Body gear, Door M2L, Tail and
Deck plan. Each eases the zoom and the turntable to its view and opens or closes the cutaway; a view change zooms out
(to 1× or 2×), turns, then zooms in. Dragging still turns the model, and the model keeps running. The Cockpit view
looks down at 42° instead of the page's 30° (eased in over the last part of its zoom), so both PFDs show over the
seats' headrests. In the Cockpit view the shells between the reader and the deck are cut away (opacity 0), as are the near fairing, its gear doors and the
inner flap in the Wing gear and Body gear views and G's gear view. The Inspect button's tip lists the views the page has. In the Deck plan nothing of
the ghosted airframe is picked.

Any input pauses the tour (the figure holds); the tour resumes 30 s after the held phase settles (a seek arrived, an
engine start or a take-off roll finished: input during the roll holds it at lift-off first), from where the model is.
With `prefers-reduced-motion`, there is no tour or inertia, phases jump to their end state (Push & start
first to the tug holding the pushed-back aircraft, its end on a second press), flashes hold steady and the fans are
still. Screen readers get a slider for the turntable, a live region with short phase and toggle lines
while the reader is in control, and real buttons with pressed states.

## Build

Requirements: Node (26 here); nothing to install. From the repository root:

```sh
node a380/build.mjs               # a380/a380.html (dark), about 25 s
node a380/build.mjs --light       # a380/a380-light.html
node a380/build.mjs --verify      # a380/a380-verify.html: SVG painter everywhere plus the audit shapes (ignored by git)
node a380/build.mjs --check       # every module's assertions and the world checks; prints "check passed"
node a380/build.mjs --bench       # Node frame time over 360 turn angles and every clip
node a380/build.mjs --audit --quick [--only=order,posed,…] [--clip=name[:a-b],sweep] [--out=file.html]
```

`--out=` writes the page elsewhere (audits and checks use it so they never touch the shipping pages; without it,
`--check`, `--audit`, `--bench` and a build imported by a tool write `a380/tmp/<mode>-<pid>.html`, never a shipping
page). A verify page built with `--out=` gets its states and paths beside it in `<page name>-states/` (the default verify
pages keep theirs in `a380/tmp`). Every page carries the sources it was built from (`window.__a380Source`: `git
describe` and a hash of the `a380/` and `kit/` sources); `drive.mjs`, `lines.mjs` and `turn-check` print it and warn when
the working tree differs (`node scripts/source-hash.mjs <page>` checks one). `--lite` is
parsed but not built: by the owner's decision every page ships every feature. `--turn-cache=<file>` is for
development only. A page build takes about 1.5 GB (a verify page about 4 GB); give builds and audits
`--max-old-space-size=24000`.

## Verify

The checks behind the numbers below (DESIGN §10 has the full list). Long runs go in the background with their output
in a file.

```sh
# kit audit + quick orbit audit, sharded (one process per shard, about 35 min on 32 cores)
for s in "lines --only=rigid,swept,coverage --clip=sweep" "posed --only=posed" "depth --only=depth" \
         "cont --only=continuity" "oA --only=order --clip=sweep" "oB --only=order --clip=orbit" \
         "oC --only=order --clip=cutaway,takeoff,takeoff.0,takeoff.230,steer,speedbrake,push" \
         "oD --only=order --clip=gearUp,gearDown,gearUp.125,gearDown.125,gearUp.230,gearDown.230" \
         "oE --only=order --clip=flaps,flaps220,controlCheck,rudder,rudder.side,elevator,elevator.side" \
         "oF --only=order --clip=doors,doors180,cabin0,cabin125,cabin230,cabinClimb" "oG --only=order --clip=cutawayDoors"; do
  set -- $s; n=$1; shift
  nohup node --max-old-space-size=24000 a380/build.mjs --audit --quick --out=a380/tmp/q-$n.html "$@" > a380/tmp/q-$n.txt 2>&1 &
done

# the full orbit audit: sharded (a380/tools/full-audit.sh --list shows its 46 shards, longest first; the kit audit runs
# in the static shard only), ending "full audit gate passed" or "failed"; or in one process (hours)
a380/tools/full-audit.sh --dry-run -j 9                     # the commands, the expected wall time, the coverage checks
setsid nohup a380/tools/full-audit.sh -j 9 --out a380/tmp/full > a380/tmp/full-runner.txt 2>&1 &
a380/tools/full-audit.sh --gate --out a380/tmp/full          # the gate again over the logs
a380/tools/full-audit.sh -j 16 --out a380/tmp/full2 --reuse a380/tmp/full   # fu/f3-verify: re-run only the shards whose
                                                            # fingerprint (kit, audit code, scene, clip states) changed
nohup node --max-old-space-size=24000 a380/build.mjs --audit --out=a380/tmp/audit-full.html > a380/audit-full.txt 2>&1 &

# browser checks (headless Chromium from ~/.cache/ms-playwright, WebGL on the GPU through ANGLE/EGL)
node scripts/lines.mjs a380/a380-verify.html --wait 6000 --edges   # the merge gate, and a380/a380-light-verify.html: the
                                                            # airframe's texture lines, and (--edges) its creases and open outlines
node scripts/drive.mjs a380/a380-verify.html --actions a380/tools/drives/verify-lines.json   # the same in every Inspect view
node a380/tools/lines-sites.mjs a380/a380-verify.html       # fu/f3-verify: that gate's floating ends by owner and part,
                                                            # with what each could meet and a 4x crop (<out>/sites.md)
node scripts/devices.mjs a380/a380.html                     # fu/f3-verify: phones to desktops (--list): frame times,
                                                            # a drag, taps, layout faults, one shot each
node scripts/devices.mjs http://127.0.0.1:8741/a380/a380.html --site   # fu/f4-verify: the hosted site (dist/ served by
                                                            # serve-site.mjs): also every link and button inside the viewport
node scripts/lines.mjs a380/a380.html --wait 4000          # the deck's SVG lines only (the airframe is painted on a canvas)
node scripts/turn-check.mjs a380/a380.html --perf --width 1440 --state all
node scripts/turn-check.mjs a380/a380.html --perf --width 390 --throttle 4 --state all
node a380/tools/path-checks.mjs a380/a380-verify.html --only pops --jobs hinge-push --max-job 3000   # every pair (hours)
node scripts/turn-check.mjs a380/a380-verify.html --order --step 1   # (--states-dir d: read --states files from d)
node --max-old-space-size=24000 scripts/turn-check.mjs a380/build.mjs --fidelity --out=a380/tmp/fid.html
node scripts/turn-check.mjs a380/a380-verify.html --pops --no-webgl --step 1
node scripts/drive.mjs a380/a380.html --actions steps.json  # drive keys, clicks and shots; see the script's usage
node a380/tools/model-test.mjs                              # the model's departure: phase ends, events, no jumps
node a380/tools/stowvis.mjs                                 # stowed gear invisible (--control: gear down must fail)
node a380/tools/captures.mjs --list                         # the capture set
```

## View

Open `a380/a380.html` or `a380/a380-light.html` in a browser; it runs from `file://`. On the headless dev server,
serve the folder on localhost and use the SSH tunnel:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 -d a380   # then http://localhost:8080/a380.html
```

The page fits its container's width and the card fits the viewport's height (a landscape phone shows the whole card;
the legend scrolls below it, or beside it on a landscape phone, where the card stays in view); it clears the
safe-area insets. Landscape windows up to 900 px tall (tablets, 1280 × 800 to 1440 × 900 laptops) and large
monitors at DPR 1–1.5 put the legend beside the sticky card too, so the controls are on screen with it; on those
monitors the card grows to 1400 px (at most 2,100 device px across) with 12 px corner type. Under 600 px it switches to the compact readout and touch
wording; on any touch screen the legend's buttons are at least 44 px tall. Checked from 320 × 568 to 2560 × 1440,
portrait and landscape (`notes/followup/f3-interaction.md`).

The airframe is painted through WebGL2 (`kit/gl-painter.mjs`: the canvas painter's own drawing, tessellated and drawn
in a few batched calls into a 4× multisampled target). `?painter=canvas` uses the 2D canvas painter instead; the page
falls back to it by itself when WebGL2 or 4× MSAA is missing or the WebGL context is lost (`data-painter` on the
stage says which one draws). `node a380/tools/gl-parity.mjs <page>` compares the two painters pixel for pixel;
`node a380/tools/gl-prof.mjs <page> --painter gl|canvas` times one against the other.

## Host

`node a380/tools/build-site.mjs [--rebuild] [--url https://<domain>/<path>/]` writes the deployable static site to
`a380/dist/` (ignored): an `index.html` that picks the theme (stored choice, `?theme=`, then the system's), both figure
pages (byte for byte plus meta, Open Graph and Twitter tags, a remembered Dark | Light toggle, a Credits link, and the
no-JavaScript and no-WebGL notes), `credits.html` (not affiliated with Airbus; the kit's MIT licence; the sources),
`404.html`, hashed icons and link-card images, `robots.txt`, `_headers` and `vercel.json`. It loads from any subpath.
`a380/site/DEPLOY.md` covers Cloudflare Pages, Netlify, Vercel, GitHub Pages and plain servers, with the cache,
compression and CSP headers; `node a380/tools/serve-site.mjs` serves `dist/` on localhost for a check and
`a380/tools/site-check.mjs` times a cold load. The figure's own licence is for the owner to state.

## Measured: the finished figure (2026-10-11, 22:52–23:45 UTC)

The shipping pages and `a380/dist/` were checked against `main` at 5f7c95b (sources identical to 92d6ad6:
`scripts/source-hash.mjs` reads "current" for `a380.html`, `a380-light.html` and `dist/a380.html`), on forge, GPU
renderer `ANGLE (AMD, Radeon 8060S …, OpenGL ES 3.2)` in every browser run (never SwiftShader), WebGL2 painter
drawing (`data-painter="gl"`). "Start" is the release at 0d4332b, as recorded; the Node rows also ran 0d4332b's tree
beside this one in the same window (load 1–2). Logs: `a380/tmp/rel/` (local, ignored).

| Measure | Finished figure | Start (0d4332b) | Budget |
|---|---|---|---|
| `--check` | **check passed** (dark) | passed | passed |
| `data.turn` | 611 KB, 795 parts | 601 KB, 773 parts | 600 KB |
| Node frame (`--bench`), turn | 7.90 ms; same window 0d4332b 7.94 ms (level; this window's machine is slower than the 5.1 ms recorded at the start) | 5.1 ms recorded | 7 ms |
| the same, take-off / push | 7.79 / 9.80 ms; same window 0d4332b 6.96 / 7.92 ms (single runs; the round added 22 parts and the Cockpit view) | | |
| Browser 1440 px, DPR 2, gate (`turn-check --perf`) | task **14.63 ms** (`set()` 10.9), **60 fps** | 23 ms at 30 fps | 13 ms |
| the same, take-off / cutaway / Inspect views | 15.5 / 13.8 ms; Inspect 12.1 (Engine 2) to 22.9 ms (Deck plan), all at 60 fps median interval | | |
| Browser 390 px, DPR 3, 4× CPU, gate | task **55.0 ms** (`set()` 42.2), frame interval 66.7 ms (**15 fps**) | 92 ms at about 10 fps | 33 ms |
| the same, Inspect views | 45–84 ms (Engine 2 fastest, Upper slowest) | | |
| Line ends (`lines.mjs`), both shipping pages | 0 of 630, consoles clean | 0 of 630 | 0 |
| Device harness (`devices.mjs --site`, served `dist/`) | **`devices passed: 7 profiles, no layout fault, console clean`**; frame median on its own / while dragging: 1920 × 1080, 1440 × 900 and 1280 × 800 60 / 60 fps; tablet 820 × 1180 (2× CPU) 60 / 30 fps; phone 390 × 844 (4×) 30 / 15 fps; phone landscape 20 / 15 fps; small phone 360 × 740 (6×) 30 / 9 fps; every profile back to the full canvas ratio at rest; taps name parts and toggle the cutaway; warning only: corner type 10.5 px (under the harness's 11 px). The phone profiles ran while three capture browsers were also running | | |
| Site checks (`site-check.mjs --nojs`, `--layout`, 320 × 568 to 1440 × 900) | `site-check: passed` both | | passed |
| Full orbit audit | 45 of 46 shards clean, kit audit passed (round 14); gate failed on one Cockpit-view 3-cycle | | `full audit gate passed` |

Against the start the desktop gate is 36% faster and holds 60 fps, the throttled phone gate 40% faster (10 → 15 fps).
Both are still over their budgets (13 ms, 33 ms). The phone runs are a headless Chrome with a 4× CPU throttle, not a
real phone (D8).

## Phone and desktop support

- **Desktop:** drag to turn (with inertia), hover a part to name it, click to operate it, the full keyboard
  (Controls above) and the legend's buttons; the Inspect views zoom in. From 1280 × 800 laptops to 2560 × 1440 monitors the legend sits beside
  the sticky card; large monitors get a card up to 1400 px.
- **Phone and tablet:** a sideways drag turns and an upright one scrolls the page, a pinch zooms the page, tap a part
  to name it and tap again to operate it; the legend's buttons are at least
  44 px tall on touch screens; under 600 px the compact readout and touch wording; landscape phones show the whole
  card with the legend beside it; the page clears the safe-area insets. Checked from 320 × 568 to 2560 × 1440.
- **Performance on small devices:** the adaptive quality governor lowers the airframe canvas's pixel ratio and line
  detail only while the figure moves and restores full quality at rest (`?quality=full` turns it off); every feature
  stays on every device (DESIGN §0, decision 0).
- **Painter:** WebGL2 with 4× MSAA by default (`kit/gl-painter.mjs`); the 2D canvas painter takes over by itself
  without WebGL2 or MSAA, or on a lost context (`?painter=canvas` forces it). Both draw the same figure.

## Deploy

```sh
node a380/tools/build-site.mjs --url https://<domain>/<path>/   # writes a380/dist/ from the shipping pages
node a380/tools/serve-site.mjs --port <free port>               # look at it on localhost first
node scripts/devices.mjs http://127.0.0.1:<port>/a380.html --site
```

Then copy `a380/dist/` to the static host; `a380/site/DEPLOY.md` has the per-host steps and headers. Nothing in this
repository deploys it.

## Measured (release, 2026-10-11)

The fix round 4 and WebGL painter merge is measured in `notes/STATUS.md` (top section), the GL painter against
`?painter=canvas` in the same window: 1440 px gate **13.5–13.7 ms** (canvas 15.8), Upper deck 20 (22), take-off 14
(16.2); the 4×-throttled phone gate 53–55 ms (canvas 62–63); the Cockpit view level (13.7 / 48–50 ms); `data.turn`
611 KB. The finishing round's merge before it measured 17–18 ms at 1440 against the release's 25–28 ms. The table
below is the release's.

On forge (32 cores, Radeon 8060S; WebGL renderer `ANGLE (AMD, Radeon 8060S Graphics (radeonsi strix_halo ACO),
OpenGL ES 3.2)` in every browser run, never SwiftShader), on the shipping pages of `main` at the release (built from
the same sources: `scripts/source-hash.mjs` reads "current"), at load 0.8–2.3. The pass that ends here (follow-up round
2: the sort review, eight fix packages, the merge and the full audit; `notes/STATUS.md`) started from `main` at 7002974
(the round 1 merge). "Start" quotes the numbers recorded then; "same window" is the start's shipping page
(`git show 7002974:a380/a380.html`) or tree measured again beside the release, one run each, interleaved. Logs:
`a380/tmp/release/` (local, ignored).

| Measure | Release | Start of the pass (7002974) | Budget (DESIGN §5.11) |
|---|---|---|---|
| Parts / groups | 773 (771 airframe with the tug, 2 deck) / 162 | 743 / 162 | |
| Turn data / page size | `data.turn` **601 KB** (dark), 598 KB (light) / 1,823 and 1,785 KB | 630 / 628 KB; 1,705 and 1,665 KB | 600 KB / 2.5 MB |
| Build | 14–17 s a page (two at once) | 16 s | 120 s |
| Node frame (`--bench`), canvas runtime | turn 5.09 ms; every clip ≤ 5.35 (take-off.0 5.35, push 5.29, take-off 4.90) | recorded: turn 5.03, clips ≤ 5.19; same window: turn 4.90, take-off.0 5.28, push 5.19, take-off 4.75 | 7 ms |
| Node frame, SVG (verify) runtime | turn 10.67, push 11.37, take-off.0 11.97 ms | recorded 10.85, 11.24, 11.81; same window 10.74, 11.23, 11.95 | |
| Browser, 1440 px, DPR 2 (`turn-check --perf`), at the gate | task **23.07 / 23.04 ms** (`set()` 10.3–10.4, script 16.7, layout 1.5), 30 fps | recorded **23.07** (`set()` 10.9, layout 1.0); same window 22.89 (`set()` 10.8, script 17.2, layout 1.0) | 13 ms task |
| the same, take-off | 16.61 ms, 60 fps | same window 16.44 ms, 60 fps | |
| the same, Inspect views (`--state all`) | Cockpit 15.3, First 18.6, Upper 24.6, Main 23.5, Engine 2 15.7, Wing gear 16.9, Body gear 16.1, Door M2L 14.9, Tail 16.8, Deck plan 22.9 ms; all at 60 fps but the Deck plan (30); rest 23.1, cutaway 22.6, cutawayDoors 23.2 | recorded 20.2, 21.7, 27.1, 26.3, 20.2, 23.8, 23.0, 20.2, 23.9, 30.5 ms; First in the same window 23.73 ms at 30 fps | |
| Browser, 390 px, DPR 3, 4× CPU throttle | held at the tour's start: task **92.45 ms** (`set()` 42.5, script 67.7, layout 5.7), 10 fps; take-off 68.90 ms at 15 fps (frame interval 66.7) | recorded **68.03 ms** (measured in the push, a different state); same window: start 92.31 ms (layout 3.9), take-off 67.65 ms at 12 fps (interval 83.2) | 33 ms task |
| WebGL | 25 programs, one at a time after the first frame; GL faded in (glShare ≥ 0.999) 6.5–6.8 s after the mount at 1440, 6.3 s on the throttled phone | 5.6 s at 1440 (recorded) | 300 ms a task |
| Line ends (`lines.mjs`) | shipping pages 0 of 630 (the deck's SVG lines; the airframe is on a canvas), consoles clean; verify pages (proof run, same sources): 0 of 5,572 / 5,568 | 0 of 630; 0 of 5,498 / 5,508 | 0 |
| `--check` | passed, dark and light: seats in the cut bays FD 4, F 22, U 60, M 80, UY 24; Deck plan 555 of 555, 20 of 20 monuments; the 24 bins at 1.60–2.10 m; quadrant turns 0 parts moved; tug 0.060 m off the nose tyres; tour loop 128 s | passed | passed |
| Kit audit | passed in both passes (489 solids at rest, 757 with the cutaway open), support 0; rigid, swept, coverage 0 | passed (482 / 727) | passed |
| Full orbit audit | `main` at 9c272b9 with kit patch 41, sharded (round 13, `notes/AUDIT.md`): 28 of 28 shards clean, **`full audit gate passed`** (one 0.75 px² depth sliver at orbit 165° fixed by patch 41; the ten shards whose orders it changes re-run clean) | round 12 (7002974): a cycle at 23.65°, two depth slivers, five clips unfinished | `full audit gate passed` |
| Model and readout | `tools/model-test.mjs`: no NaN, no jumps; `tools/compact-check.mjs`: passed | | |
| Captures | `shots/final-3/` (both themes; every PNG read): see `notes/STATUS.md` | | |

So against the start of the pass the browser frame is level at the gate (+0.8% at 1440, +0.2% on the phone, within run
to run noise) and at take-off (+1%; on the phone +1.8% task at a better frame rate), and faster in every Inspect view
(First −22% in the same window, 30 → 60 fps); the layout is 0.5 ms (1440) and 1.8 ms (phone) a frame dearer for the
round's larger deck (2,463 live elements against 1,690). The Node frame is 0.1–0.2 ms (2–4%) slower in single runs, with
30 more parts. `data.turn` is 29 KB smaller.

## Known limitations

- **One open audit line.** Fix round 4 and the WebGL painter (`notes/STATUS.md`) merged on the finishing round; the
  tree has passed `--check`, the kit audit (with the riding pass) and the browser gates, and the full sharded orbit
  audit (`notes/AUDIT.md` round 14) is clean in 45 of 46 shards. Open: in the Cockpit view (42°, cutaway open) the
  glareshield, the left windshield sill and the radome form a painter's 3-cycle at turns 126.5–127.0° (the runtime
  breaks it; no wrong pixel measured; not accepted). The every-pair push path pops run: dark, on the release tree, 346 steps keep a
  surviving region (wings 256: wingtip band sweeps up to 205 px and fin, rudder and tailplane-tip flips of 20–75 px;
  fuselage 81, gear 6, shared 3; `notes/followup/f3-verify.md`); light (round 4), 1,704 steps with a region, none over
  100 px, largest 54 (`notes/followup/f4-verify.md`; most are 1–7 px tone flips on the card's centre line, not yet
  diagnosed).
- **Audits.** The full orbit audit of the release (round 13, 28 shards) passed its gate after kit patch 41. The audit
  is now 46 shards (`tools/full-audit.sh`; with the Cockpit view's clip and the sweep at 42°, round 14 took 133 min at
  `-j 12`), and `--reuse` re-runs only the shards a change touches.
- **Stowed gear.** `tools/stowvis.mjs` reads 0 px (limit 3) on the GPU: the 12 mm gap between the wing-gear fairing
  door strips and the fairing link that let a sight line reach the aft tyres at pitch 12.5 is closed by thin webs on
  the strips' aft ends. The test now prints the renderer of its own WebGL context.
- **Performance is over budget in the browser.** At the finished figure (Measured above): 1440 px gate 14.6 ms at
  60 fps (budget 13 ms), the 4×-throttled 390 px phone gate 55 ms at 15 fps (budget 33 ms), Inspect views 12–23 ms at
  1440 and 45–84 ms on the phone; `data.turn` 611 KB (budget 600). After the finishing round (`notes/STATUS.md`): at 1440 px the gate
  costs about 17–18 ms a frame at 60 fps (the release 25–28 ms at 30 fps in the same window), take-off and the cutaway
  likewise; the Inspect views 14–26 ms (Upper and the Deck plan at 30 fps). On the 4×-throttled phone the gate is about
  64 ms (the release 74–100 ms) and take-off about 50 ms. The levers: half-rate frames that draw nothing new, the deck
  off the per-frame layout path, an adaptive quality governor (`A3.quality`; it lowers the airframe canvas's pixel ratio
  and then the fade-line detail only while moving, keeps a step only when it pays, restores full quality at rest; turn it
  off with `?quality=full`), and the intake lip's lighter gradients while moving. The budgets (13 ms, 33 ms) are still
  missed. The WebGL painter (f3, `notes/followup/f3-painter.md`; the default, `?painter=canvas` for the canvas one) cuts
  the GPU process's work a frame about fourfold and the main thread's task by 2–20% by state at 1440 and 3–19% on the
  throttled phone (level in the zoomed Inspect views), and holds 60 fps in every state at 1440; what is left is set()
  and the painter's op walk. Not measured on a real phone (D8 below). The governor measures the airframe's own update
  (under half rate, a set frame and the skipped one together) and goes back to level 0, the device's ratio (up to 4)
  and full line detail on every rest (fu/f4-perf). The turn data is **611 KB** (light 609 KB), 11 KB over its
  600 KB budget even with shared tube rings and zero shifts stored once (kit patch 44): round 4's scan-wash planes,
  rounded door leaves, cockpit sills and gear strip added 14 KB.
- **Cabin.** The cut bays draw 190 seats; the Deck plan draws all 555. The overhead bins ride their own groups and
  fade in once the crowns are clear; the near row fades out while it faces the reader, so at in-between bearings it is
  drawn translucent over the seats (a judgement call for the next review). The overhead panel is an inset in the
  Cockpit view, not in the roof: its face points down, so no camera above the horizon would see a roof panel
  (`notes/followup/f4-interiors.md`). The Cockpit view uses its own camera elevation, 42° (`notes/followup/f3-engine.md`
  E1): the quick order, depth and continuity audits at 42° (the parked sweep and the view's own state, cutaway open,
  every bearing) found nothing; the full sharded audit has not run at 42° yet. The coamings carry the windshield-heat and wiper-motor access cover, the wiper
  motor and three demister slots. The Deck plan is the slowest Inspect view: the cost is the airframe still painted
  under it at 5%, not the plan (a bitmap plan was built, measured no gain, and was taken out).
- **Cargo holds** read from the right side only (all three cargo doors are on the right); from the turntable's 30°
  camera the open 110° panels hang over the doorways, so only their edges show at most bearings. The bulk door's
  inward swing is not modelled (its plates name it and take its click); with the tail at the model's section its sourced
  sill (3.235 m) lies 0.13 m above the keel, so the doorway lies on facets facing 30-60° down and at the bearings checked
  (b60-b150) the hull hides it from the turntable's 30° camera (it showed as a lit sliver while the tail was drawn 0.3 m
  low); its handle fades as it opens.
- **Doors.** An open passenger door's leaf has rounded corners (0.16 m, five planes a corner) and its hulls take the
  kit's `rerank` (`notes/followup/f4-fuselage.md`); `data.turn` grows 4 KB for them.
- **Gear doors.** The body-gear inner doors close with the gear down, as on the aircraft: each is a 94° hydraulic door
  with a fold leaf that folds up as it swings (clearing the in-flight tyres by 0.13 m; the fold leaf is from forum
  sources, not an Airbus document). The nose-gear forward doors open 75°, not the aircraft's 62°: the doors span the
  estimated bay half (|y| 1.00), so at 62° they cut 0.14 m into the tyre; a true 62° needs a wider bay. No wheel-well
  detail in the nose bay (it opens downward, which the view never shows).
- **Pushback tug.** Drawn to the platter's edge (the turntable puts the nose gear 2.3 m from it): its forward end fades
  out there, the cab's place and size are estimates from TLD's description, and its cradle stands 0.06 m off the nose
  tyres without lifting them (lifting the wheel needs the airframe's pitch and the tug's free group, which follows that
  pitch, to part: `notes/followup/f3-interaction.md`). Under reduced motion, Push & start stops where the tug holds the
  pushed-back aircraft; the same key again (or the next phase) runs on to its end.
- **Seeks.** A forward seek is paced by the picture but leaves the ground out: the take-off roll still crosses
  hundreds of metres of runway in a frame (the runway markings fade out during a seek and with speed). A seek's caps
  are per second, so at a low frame rate each frame carries a larger step (the seek keeps its 3 s promise). Rewinds
  take at most 4 s (paced by the picture, as the forward seek).
- **Fuselage width.** The constant section is drawn 7.05 m wide (7.14 m on the aircraft, −1.2%). The tail from 46.5 to
  52.25 m is within 1.5% of the model's width with its bottom; the tail cone (52.25–66 m, one ring span carrying the fin
  and tailplane roots) is linear between its ends, so it is 4–5% narrow at 54–56 m and 3–5% wide at 60–62 m, within 1.1%
  at 64–66 m (`truth.md` §4; every facet stays planar). Ring stations inside the cone need a `tail.mjs` change.
- **Engines.** The once-per-revolution blade mark shows in about a third of the frames at real speed and fades out by
  idle. The nacelle rings between cowl rows use the lowered structural tone: the kit's new round joint option
  (`jointCaps`) is not adopted yet; the pylon flank is a flat face, shaded flat. The intake lip's gradients use 2
  pieces while the figure moves and 4 at rest (about 25–30% less lip draw time). A 1 px fin/rudder strip shows at 219°
  (the fin's trailing-edge face passing edge-on).
- **Lights and WebGL.** First light takes 9–11 s under machine load: the 25 programs compile one at a time in the GPU
  process (profiled; nothing in the page's code is left to cut). The heat haze is drawn in both themes with WebGL and
  not at all without it. Without WebGL the night washes, pools, beams and runway lights are screen-blended as the GL
  canvases are, and the lamp lenses use the GL mask's cover rule (the nose-strut lens blob at b10 is gone); still: each
  beam is a flat banded shaft, the logo bands show faint contour seams at DPR 2, at DPR 1 the runway lights lack GL's
  floor smear and the head-on red bar by day reads 15–25 levels under GL, and neighbouring cloud puffs keep a 4–8-level
  dip (their cast shadows, the same in both painters). In the Engine Inspect views the scan wash on the inlet lip is
  painted over by the lip's own continuous-ramp canvas effect (the cowls behind it show the wash); and the no-WebGL
  turn keeps 18 one-step band moves in the platter's pools at 281–312° (`notes/followup/f4-lights.md`).
- **Nose.** The radome and its tip shade in 6 sub-bands a tone step (the kit's `subBands`), so its facet steps are
  1–2 levels; the forward crown keeps one 4-level patch in the First view. The radome's lightning diverter strips fade
  out toward the tip by design, so the strict line gate counts their faded ends.
- **Smaller items:** CSS colour literals outside the engines, lights and windows; the hover outline uses convex hulls
  (of the whole named part since `fu/f4-interaction`, so a concave group such as a cabin bay's seats is outlined as
  one convex shape),
  so a later part's hull can dash a stretch of outline its concave shape does not cover (it never draws over a part in
  front).
- The drawing is not an engineering model: the wing is drawn at its static 562 t shape (no in-flight bend), heights
  and time are compressed for the turntable, and the rates marked as estimates in `truth.md` are estimates.

## Deferred: for the owner to decide

Features the figure does not have yet, each costed in `notes/followup/PLAN.md` §5; none has been chosen.

- **D1. Landing and roll-out:** approach in CONF FULL, gear down, flare, touchdown with ground spoilers and reverse on
  engines 2 and 3, autobrake, taxi-in. The most visible operation missing; it needs sourced phases in `model.mjs` and
  `truth.md`, a longer tour, new poses, clips and every audit (2–3 days).
- **D2. Thrust reversers** (engines 2 and 3 only, as on the A380): segmented convex sleeve panels sliding aft, cascades
  and blocker doors (about 4 h plus clips); pairs with D1 or a ground-only key.
- **D3. Full-length 3D cutaway:** every seat, galley, lavatory, both stairs, the lifts and the crew rest in 3D with the
  upper deck lifted off (the shell re-split into floor, wall and crown pieces; 2–3 days). The Deck plan shows all of it
  meanwhile.
- **D4. Gate equipment:** jet bridges, catering high-loaders, belt and ULD loaders, GPU, fuel dispenser (not part of
  the aircraft; each a free group touching a door).
- **D5. Emergency equipment deployed:** the 16 slides (double-lane on the upper deck) and the RAT.
- **D6. Small surface detail:** the ETACS fin and belly camera fairings, the belly fairing's ram-air inlets and outlets
  (about 1 h, for a polish pass).
- **D7. Not modelled:** the bulk door's inward swing, the plug doors' lift, the inlet scarf, the WLG auxiliary door,
  opening cockpit side windows, the optional HUD.
- **D8. Real-phone measurement:** there is no phone on the dev server; the phone numbers are headless with a 4× CPU
  throttle.
- **D9. Wing flex in flight:** declined (DESIGN §0, decision 8).
- **D10. 3D ULDs inside the holds:** the holds are solid hull volume; the cargo-hold pictures stand in.

## Files

- `build.mjs` (the build, checks, bench and audits), `live.js` (the page loop and interaction), `a380.css`;
- `model.mjs` (the truth model), `follow.mjs` (channels and the tour), `world.mjs` (shared geometry);
- `parts/` (stage, nose, fuselage, skin, wings, tail, engines, gear, cabin with `cabin-plan.mjs` and
  `cabin-furniture.mjs`, lights, tug), `gl/` (shaders, passes, mask, runway);
- `tools/` (model test, stowed-gear test, the sharded full audit, path checks, captures);
- `DESIGN.md`, `truth.md`, `notes/` (status, audits, kit patches, GL and 3D cookbooks, the module contract).
- Captures of the finishing round's merge are in `shots/f3-merge/` (each track's in `shots/f3/<track>/`), of the release in `shots/final-3/` and of the finished figure in `shots/final-4/` locally, those of the follow-up merges in `shots/sort-merge/`,
  `shots/followup-ship/` and `shots/followup-merge-1/` (`a380/shots/` is not committed).
