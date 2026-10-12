# A380 figure: design (revision 2)

> References to `notes/` (status, audits, kit patches, the module contract, follow-up packages) point to the
> working notes kept while the figure was built. They are not part of this repository; the code and these
> documents carry the decisions that matter.

This is the design for `a380/a380.html` (dark) and `a380/a380-light.html` (light), written by
`node a380/build.mjs [--light]`. It replaces revision 1 after three critics' reviews (feasibility, fidelity, craft).
Every finding and how it was resolved is in §12. The work is done by these roles:
- **S, the scaffold:** the harness, world, kit patches, truth amendments and page core. S works first.
- **M1–M8, eight builder modules:** they build in parallel against S's analytic world and stubs.
- **I, the integrator:** the interaction layer of `live.js`, then integration, the full audits and the release.
  S's agent may continue as I.

Every number comes from `a380/model.mjs`, with tags in `a380/truth.md`, unless it is marked **[E]**. [E] means a
figure decision or an estimate. Read this together with:
- `notes/KIT3D.md`, the 3D kit cookbook;
- `notes/GL.md`, the WebGL cookbook. The sections that §6 replaces are listed there.
- `notes/TRUTH-SUMMARY.md`.

Figure-world numbers are kit units (1 unit = 1 dm) unless they say m. Positions written as (x, y, z) are model
metres: x aft from the nose tip, y to starboard, z up from the runway.

Contents: 0 Decisions · 1 Concept · 2 World · 3 Groups, channels, follow · 4 Layers · 5 Geometry · 6 WebGL ·
7 Interaction and motion · 8 Roles, files, contract · 9 Modules · 10 Verification · 11 Compromises and risks ·
12 Review log.

---

## 0. Decisions at a glance

0. **Owner decision (2026-10-09): all features stay, including the full cabin interior.** The owner wants the
   figure to go all out. Never ship a page without the cabin, flight deck, gear doors or any other feature to meet a
   performance budget; `--lite` (§5, item 7) is not the shipping page and is not a fix for a performance finding.
   Recover speed with levers that keep every feature: canvas painting (kit patch 11), parked groups costing
   nothing while the cutaway is closed, adaptive half rate, detail by speed, framed planes, merging small parts
   into `details`, and render-only-when-changed. Showing more of what is already built (all 555 seats, the
   main-gear bogies, a richer flight deck) is in scope.

1. **One boundary function.** The kit world is the model mirrored once:
   `kit([x, y, z]) = [10·(41.30 − x), 10·y, 10·z]`. Kit x points forward, y to starboard and z up. The kit's
   projection is a reflection (GL.md 1.1), so the kit world must be left-handed. This function in `world.mjs` is
   the only place the flip happens.
   - The KIT3D spikes use +y = left wing. Copy their recipes, never their coordinates.
   - **Mirror test (`--check`):** at `turn = 40` the nose faces the reader, with red on the reader's right.
2. **Turntable axis at model station 41.30.** This pivot gives the smallest swept radius: 41.30 m to both the nose
   tip and the fence trailing edge.
3. **Stage.**
   - A live platter, r 38.6 m, on a static round plinth, r 42.5 m, which carries a heading ring.
   - The platter carries three phase-keyed marking sets (stand, taxiway, runway) that scroll with the model's ground
     distance and crossfade by phase.
   - A turning soft shadow lies under the aircraft.
4. **Camera:** azimuth 40°, elevation 30°, viewBox **960 × 680**. The fit uses the real extremes of the whole
   trajectory, and the plinth spans 85% of the width: scale ≈ 0.759 and **k ≈ 0.960 px per unit**.
5. **Kit extension `T.hull`** (patch 6) is built by S before any module starts on geometry. It has two modes:
   - **faceted**, a convex polyhedron from points;
   - **ring loft** with **smooth tone bands**, so curved bodies never shade as a staircase.
   It ships with its runtime, audit shape, turn-check mesh, plane and dot emission, and a fidelity check.
6. **Fuselage section S0.** The model's two-superellipse section is sampled as a 32-gon with flat belts.
   - Barrel, x 14–46.5: S0.
   - Nose and tail: homothetic rings of S0 wherever a door, window, pane or root sits, because their facets must be
     planar.
   - Radome tip (x < 1.9) and tail tip (x > 66): anisotropic rings, which match the model's width and height exactly.
   - All of these are ring lofts with smooth shading.
7. **Motion chain:** `air` (turn) > `lift` (slide in z, 6 m) > `pitch` (hinge about the rear body-gear axle,
   0–12.5°) > everything that rides the aircraft. Heights are drawn as `6·tanh(h/6)` m. The true altitude is in the
   readout.
8. **No wing bend.** The wing is drawn at its static 562 t shape. The in-flight flex is [E], was not requested, and
   would cut through nine devices per wing (§12, F1).
9. **Gear** (22 wheels on 5 legs) retracts in its true directions and sequence, into bays defined as convex
   polyhedra in `world.mjs`.
   - Two-link stays, the leg-mounted doors and the BLG centre door are modelled.
   - Bogies stay on the runway during rotation: a counter-rotating bogie plus an oleo slide.
   - The tyres are true size, with the axles at the free radius, so they touch z 0 by construction.
10. **Cutaway, five bays.**
    - Bays: flight deck, First, upper Business, main Economy, upper Economy.
    - Every cut plane lies above the interior below it, and every wall is a single-facet strip. So the deck interior
      (free group `cabin`) is fully enclosed while the cut is closed.
    - The flight-deck interior (free group `cockpit`) is synced only once the canopy has cleared it, and fades in
      through the canvas painter's `vary`.
11. **Doors.** The 16 passenger doors hang on parallel arms whose axes follow the facet the arm lies on. Each door
    parks 0.72 m out, forward of its opening. The 2 cargo doors are top-hinged. Every door can be clicked open on
    its own.
12. **Painter.** The canvas painter draws the airframe layer on the shipping page, and SVG draws the deck and back.
    - Every fallback and every per-frame alpha goes through `vary`. The canvas painter is mounted after GL
      initialisation.
    - Browser order checks run on the SVG `--verify` page.
13. **WebGL draws every light and effect** (§6).
    - Occlusion comes from a **GPU order-index mask** built from the controller's projected hulls. There are no
      per-target cover sets and no CPU visibility walks.
    - A few programs, each for one kind of pass.
    - The light theme is designed as daylight: lens glints, no bloom in the air.
14. **Interaction** (§7):
    - phases;
    - systems: doors, cutaway, flaps lever, control check, gear lever, engines, speed brake;
    - an overhead-style light panel;
    - **Inspect** views that zoom every layer;
    - hover and tap to name a part, click to operate it.
15. **Phases come from the model.** It is stepped in fixed substeps (≤ 1/30 s of model time), so every rate plays
    the same trajectory that `poses()` sampled.
    - Seeking forward takes at most 3 s.
    - Rewinding plays the recorded history backward.
    - Nothing jumps.
16. **Budget:**
    - at most 400 live airframe parts plus about 100 cabin and cockpit parts, which are parked when hidden;
    - Node CPU ≤ 7 ms per frame;
    - `data.turn` ≤ 600 KB (§5.11).

---

## 1. Concept

**Paragraph.** A museum-grade display model of the Airbus A380-800 stands on a turntable, drawn from Airbus's own
airport-planning drawings:
- the double-deck section and the long drooping nose, both window rows and 16 doors;
- the wingtip fences, droop noses, slats, Fowler flaps on their track fairings, ailerons and spoilers;
- the fin with its two-part rudder, the tailplanes with four elevators, the APU blade and the belly fairing;
- four Trent 970s on their pylons, and 22 wheels on five legs with their stays and doors.

The platter under it is a slice of airfield that changes with the phase: the stand at the gate, a taxiway, then the
runway. The figure flies Airbus's departure from the truth model:
1. At the gate the doors and holds are open.
2. For the push the doors close and the beacon comes on, and engines 1+2 then 3+4 spool up.
3. The slats, then the flaps, set CONF 1+F while the taxiway scrolls past.
4. At line-up the strobes and landing lights come on.
5. On the take-off roll the FADEC holds 78% N1 below 32.5 kt. The aircraft rotates at 3°/s from 153 kt, its bogies
   following the runway.
6. In the climb the gear folds into its bays, and the flaps then slats run in.

The reader can turn the model, lift the roof off the flight deck and all four cabin bays, look closely at any of
them, open any door, start and stop the engines, work the lights, the gear, the flaps and the speed brake, and click
any part to learn what it is.

**What moves and what it means.** The aircraft's parts move exactly as the model's procedure moves them, so thrust,
surfaces, gear, doors and lights change on Airbus's rules at their real rates. The turntable lets the reader walk
round the aircraft.

**Card corners.**
- Fig: `Fig 1`.
- Title: `Airbus A380-800`.
- Hint:
  - `Drag to turn · click a part · keys below` with a fine pointer;
  - `Drag to turn · tap a part or a button` when `(pointer: coarse)`.
- Readout, wide form (plate ≥ 600 px): the model's `readout(state)` plus a rate tag, for example
  `Take-off · CONF 1+F · N1 94% · 164 kt · 35 ft · gear down · ×2`.
  - Compact form, chosen by a ResizeObserver on the plate: at most 40 characters, for example
    `T/O · 1+F · 94% · 164 kt · 35 ft · ×2`. It drops the phase word (the legend shows it) and uses
    `GATE PUSH TAXI LINE T/O CLB FL100`.
  - While a part is hovered or tapped, the readout shows that part's label (§7.2) and reverts 1.5 s after the
    pointer leaves.

**Legend.** A `<figcaption>` of real `<button>`s in three rows, written by `build.mjs`. Each button carries a key
chip and an `aria-pressed` or `aria-current` state.
- **Phases:** `1 Gate` · `2 Push & start` · `3 Taxi` · `4 Line-up` · `5 Take-off` · `6 Climb` · `7 10,000 ft`.
- **Systems:** `D Doors` · `C Cutaway` · `F Flaps 0/1/2/3/FULL` · `K Control check` · `G Gear` · `E Engines` ·
  `B Speed brake` · `I Inspect`.
- **Lights** (in the order of the real overhead panel): `Nav & logo` · `Beacon` · `Strobe Off/Auto/On` ·
  `Land` · `Nose Off/Taxi/T.O` · `Rwy turn-off` · `S Wing & eng scan` · `Cabin`.
- An action that is not legal now **arms** instead, where arming is meaningful (motion.md, "Arming"):
  - `D` in flight seeks back to the stand, the readout says `rewinding · arming doors`, then the doors open;
  - `K` in flight seeks back to taxi, then the check runs.
- An action with no legal way to arm, such as gear up on the ground, is `aria-disabled="true"`: it stays focusable,
  and the reason is shown as visible text in the button's tooltip line under the legend.

**Caption** (true numbers; §10's Truth row checks every one):
"An Airbus A380-800 on a turntable, built from Airbus's airport-planning drawings: 72.7 m long, 79.8 m across the
wingtip fences and 24.1 m tall. It stands at its 562 t ramp weight and takes off at 510 t. It has four 334 kN
Rolls-Royce Trent 970s, 22 wheels on five legs, and Airbus's standard 555 seats in three classes on two decks. It
flies the Airbus departure at the model's rates. The doors close and the beacon comes on before the push. Engines 1
and 2 start, then 3 and 4. The slats and then the flaps set CONF 1+F in 52 s of taxiing. The take-off roll lasts
57 s and 2.1 km, rotating at 3° a second from 153 kt to lift off at 163 kt. Gear up is selected 2 s after positive
climb and retracts in 16 s. Thrust comes back to climb at 1,500 ft, the flaps and then the slats retract at S speed,
and the landing lights go off passing 10,000 ft. Time runs compressed by the factor in the readout, and heights above
a few metres are compressed on the turntable. Speeds, thrust settings, and the gear and flap timings are engineering
estimates."

---

## 2. World

| Item | Value |
|---|---|
| Units | 1 unit = 1 dm. The kit's tolerances become 8 mm interlock, 1 cm framed margin, 2 cm joint gap and 1.5 cm support (KIT3D §2). |
| Frame | `W.kit(p)` above; directions convert with `W.kitDir([dx, dy, dz]) = [−dx, dy, dz]`. The origin is the turntable axis on the runway surface. The model's side sign (L −1, R +1) carries over to kit y. |
| Bearing | At `turn = 0` the viewer is 40° right of the nose. The viewer's bearing in the aircraft frame is `b = 40° − turn` (0 = nose-on, + = starboard). GL sectors use the same b. |
| Camera | Azimuth 40°, elevation 30°. At any reachable pitch the body-frame elevation stays between 17.5° and 42.5°, so no underside is ever seen. The bays and doors rely on this. |
| Fit | `W.fit()` projects the plinth rim (r 42.5 m at z −1.6 and −0.6 m) and, at 2.5° turn steps, the airframe extremes over every sampled trajectory state and every lifted cut piece. The extremes are the nose tip, crowns, fin tip and TE, fence tops, tailplane tips and tyre bottoms. It then picks the scale at which the plinth spans 85% of 960, with a 35 px vertical pad. Measured (§12, F8): fin tip up to **28.47 m** (CLIMB, pitch 2.6°, lift 6 m); scale 0.759, k 0.960, viewBox **960 × 680**, origin ≈ (480, 427); the swept aircraft spans 83% of the width. `--check` re-projects every `poses()` state at 5° turns and fails on any point outside the pad, or any point inside the title or readout corner boxes. |
| On screen | At 1440 the plate is about 1000 CSS px wide (≈ 1.0 CSS px per unit). At 390 it is about 358 px (≈ 0.36 per unit): the fuselage is 26 px and a window 1 px. Inspect (§7.4) is how a reader reads cockpit and seats. |
| Swept circle | 41.30 m at the nose tip and the fence TE. Other reaches: tailplane tip 34.76, fin TE 31.43, NLG axle 36.33, outboard inlet 29.88 m. |
| Platter (live, `deck` layer, group `air`) | A vertical round, r 38.6 m, top at z 0, bottom at −0.6 m, in kit tones (`lo` drum, `mid` rim). It carries the marking sets, the shadow and the GL runway lights. The wings overhang it over the plinth. |
| Plinth (static, `back`) | Round base, r 42.5 m, z −1.6 to −0.6 m. Top annulus: ruler ring r 38.9–39.3 m with ticks every 2°, majors every 10° reaching r 40.1 and 40.6; a label plate; a bolt ring at r 41.5 m. It lies wholly below the live layers (horizontal-plane rule). Its halo is in `back`. |
| Gear contact | Tyres are true size: main r 0.70, nose r 0.635. **Axles sit at the free radius**: main z 0.70, nose z 0.635 [E]. The airframe stays at the AC's sourced MRW heights; the legs are 5 cm and 3.5 cm shorter than a loaded oleo would be. Every tyre touches z 0 at rest by construction. |
| Pitch pivot | The rear body-gear axle line, (38.551, 0, 0.70), which is kit [27.49, 0, 7.0]. |
| Lift | `lift = 10·6·tanh(h/6)` units, with h the true height in m. 35 ft is 5.6 m, and the lift saturates at 6 m. Pitch is drawn true, in the range [0, 12.5]. In flight the marking sets and runway lights fade by `exp(−h/60 m)`. |

`world.mjs` exports all of these, plus every shared shape in §5.1. No module hard-codes a projection, a station or
a neighbour's geometry.

---

## 3. Groups, channels, follow

### 3.1 Group tree

Points are model coordinates. Signs: **+ is the natural "open / extend / up" sense**, and each owner proves its signs
in `--check`. Ranges are in degrees for hinges and units for slides. **Every cross-group contact other than a hinge
knuckle keeps a gap of at least 0.02 m (0.2 units)**, so it gets a framed plane rather than a dynamic flush pair
(KIT3D §5, pitfall 14).

| Group | Kind | Parent | Pivot, axis or direction | Range | Owner |
|---|---|---|---|---|---|
| `air` | turn | – | kit [0, 0] | any | S |
| `lift` | slide | air | z | 0…60 | S |
| `pitch` | hinge | lift | (38.551, 0, 0.70), lateral axis, + nose up | 0…12.5 | S |
| `cut.fd` | slide | pitch | z | 0…40 | S |
| `cut.f`, `cut.up`, `cut.md` | slide | pitch | z | 0…60 | S |
| `cabin`, `cockpit` | free | root | origin kit [0, 0, 0] | synced or parked | M7 |
| `rudder.lo`, `rudder.up` | hinge | pitch | hinge line (62.55, 0, 9.94) → (71.42, 0, 24.08) | −30…30 | M2 |
| `elev.{l,r}.{in,out}` | hinge | pitch | (64.78, ±1.63) → (70.57, ±13.64), on the tailplane's mid-plane | −30…20 (+ TE down) | M2 |
| `wing.{s}.droop.{1,2}` | hinge | pitch | inside the LE, on the droop arc (M3 places it) | 0…23 | M3 |
| `wing.{s}.slat.{2..7}` | hinge | pitch | aft of and below each slat, giving a circular track forward and down | 0…23 | M3 |
| `wing.{s}.flap.{in,mid,out}.track` | slide | pitch | along the track: aft, 8° down | 0…0.18·local chord | M3 |
| `wing.{s}.flap.{in,mid,out}` | hinge | its track | the flap's nose-circle line | 0…33 (+ TE down) | M3 |
| `wing.{s}.ail.{in,mid,out}` | hinge | pitch | nose-circle line on the outer TE face | −30…20 | M3 |
| `wing.{s}.spl.{1..8}` | hinge | pitch | spoiler LE line, 0.02 m above the upper facet | 0…50 (+ up) | M3 |
| `nlg.leg` | hinge | pitch | (5.45, 0, 3.45) [E] (3.55 put the tyres 0.04 m into the radome mid-swing), lateral, + forward retraction | 0…θN | M5 |
| `nlg.stay.up` → `nlg.stay.lo` | hinge → hinge | pitch → stay.up | dragstay, ahead of the leg | from the 4-bar solve | M5 |
| `nlg.steer` | hinge | nlg.leg | **vertical through the axle centre** (4.97, 0, ·) when down | −70…70 | M5 |
| `nlg.door.{fl,fr,al,ar}` | hinge | pitch | bay lower edges, y ±1.00 | 0…62 / 0…69.2 | M5 |
| `wlg.{s}.leg` | hinge | pitch | `W.WLG_SOLVE.pintle`, `.axis` | 0…θW | M5 |
| `wlg.{s}.stay.up` → `.stay.lo` | hinge → hinge | pitch → stay.up | sidestay to the wing well | from the 4-bar solve | M5 |
| `wlg.{s}.oleo` | slide | wlg.leg | along the leg, down | 0…6 [E] | M5 |
| `wlg.{s}.bogie` | hinge | wlg.oleo | bogie pivot, lateral | −20…20 | M5 |
| `wlg.{s}.door` | hinge | pitch | main door, along x at y ±1.71 on the fairing bottom | 0…79 | M5 |
| `blg.{s}.leg` | hinge | pitch | trunnion [E] (M5), lateral, + aft retraction | 0…θB | M5 |
| `blg.{s}.stay.up` → `.stay.lo` | hinge → hinge | pitch → stay.up | dragstay | from the 4-bar solve | M5 |
| `blg.{s}.oleo` | slide | blg.leg | along the leg, down | 0…3.5 | M5 |
| `blg.{s}.bogie` | hinge | blg.oleo | bogie pivot, lateral | −100…15 | M5 |
| `blg.{s}.steer` | hinge | blg.bogie | vertical through the rear axle | −15…15 | M5 |
| `blg.{s}.door.{out,in,ctr}` | hinge | pitch | outer door on its outboard edge, inner near the leg, centre door | 0…99 / 0…94 / 0…90 [E] | M5 |
| `door.{ID}.arm` (16) | hinge | the group of `W.partAt(door)` (`pitch`, or `cut.md` for U2) | up vector of the facet the arm lies on, at the door's forward edge, 0.03 m off the skin | 0…120 | M6 |
| `door.{ID}` (16) | hinge | its arm | a parallel axis 0.84 m aft, at the arm's end | −120…0 | M6 |
| `door.FWD`, `door.AFT` | hinge | pitch | top hinge line on the belly facet | 0…110 [E] | M6 |

There are about 135 groups. Every wing device hangs from `pitch`, because there are no bend groups.

### 3.2 Channels

`live.js` sets these every frame (S).

| Channel | Source | Unit |
|---|---|---|
| `turn` | pointer, keys, tour | deg |
| `lift` | `10·6·tanh(h/6)` | units |
| `pitch` | `state.pitch` | deg |
| `rot` | `pitch × (1 − smooth(0, 0.3 m, h))`: on-ground rotation | deg |
| `trim` | `smooth(0.3 m, 2 m, h)`: bogie trim and full oleo extension after lift-off | 0…1 |
| `gear`, `gearDoors` | `state.gear.leg`, `state.gear.doors` | 0…1 |
| `steer` | keys `[` `]`, only below 0.5 kt | deg |
| `slat`, `flap`, `droop` | `state.slat`, `state.flap`, `state.aileronDroop` | deg |
| `roll`, `pitchCmd`, `yaw` | control-check clip (§7.6) | −1…1 |
| `spoiler`, `spoiler1` | the speed brake: on the ground all 8 at 50 [E]; in flight spoilers 2–8 at 30 and spoiler 1 at 0 | deg |
| `cabin` | cutaway, eased (`settle`, 2.5 s) | 0…1 |
| `door.{ID}` (19) | `state.doors[ID]` | 0…1 |

Page-only values (no groups): `n1[4]`, `scroll[set]`, `setMix[set]`, `lights`, `cabinLight`, `first`, `clock`,
`glShare`, `accent[family]`, `inspect`, `wheelPhase`, `fanPhase[4]`.

### 3.3 Follow rules

`a380/follow.mjs` (S) is pure and inlined in the page. It exports `makeFollow(rules, groups, TURN)`.
- A rule maps one channel through a piecewise-linear table, with an optional `"smooth"` ease between knots.
- Rules on one group add, and the sum is clamped to the group's range.
- A `sync` rule returns the composed world pose of `pitch`. That is `R = Rz(turn)·Rp(pitch)` and
  `t = Rz(turn)·(Pp − Rp·Pp) + [0, 0, lift]`, built with `TURN.rotation` and `TURN.compose`.
- Otherwise a `sync` rule returns `PARKED = { R: I, t: [0, 0, 1e5] }`.

| Group(s) | Rules (channel: table) |
|---|---|
| air, lift, pitch | identity |
| cut.fd / cut.f / cut.up / cut.md | `cabin`: `[[0,0],[0.5,40]]` / `[[0.15,0],[0.7,60]]` / `[[0.15,0],[0.7,60]]` / `[[0.4,0],[1,60]]`, smooth: the canopy first, the main-deck chunk last |
| `cabin` (free) | sync while `cabin > 0` |
| `cockpit` (free) | sync while `cut.fd ≥ 14.5` units, the canopy clear of the tallest interior part (§5.9). Its parts fade in through `vary` with `a3-fd` alpha `smooth(14.5, 20, cut.fd)` |
| droop noses, slats | `slat`: identity |
| flap tracks | `flap`: `[[0,0],[8,0.55],[17,0.80],[26,0.92],[33,1.0]]` × that flap's travel [E] |
| flaps | `flap`: identity |
| ailerons | `droop` identity, **plus** `roll`: left `[[−1,−30],[0,0],[1,20]]`, right mirrored |
| spoilers 2–8 | `spoiler` identity, **plus** `roll` on the up-aileron wing to 35 [E] |
| spoiler 1 | `spoiler1` identity |
| elevators / rudders | `pitchCmd`: `[[−1,−30],[0,0],[1,20]]` / `yaw`: `[[−1,−30],[1,30]]` |
| `nlg.leg`, `wlg.s.leg`, `blg.s.leg` | `gear`: `[[0,θ],[1,0]]`, smooth (θN, θW, θB from §5.6) |
| stays | `gear`: a 33-knot table from the closed-form 4-bar solve, which is printed by `--check` with its closure error (≤ 0.005 m) |
| `nlg.steer` / `blg.s.steer` | `steer` identity / `[[−70,15],[−20,0],[20,0],[70,−15]]` [E] |
| `blg.s.bogie` | `gear`: `[[0, −θB + γ],[1, 0]]` (stays flat in transit), **plus** `rot`: `[[0,0],[12.5,−12.5]]` (stays level on the ground), **plus** `trim`: `[[0,0],[1,βB]]` [E] |
| `blg.s.oleo` | `rot`: Δ(θ) = (1.70·sinθ − 0.35·(1 − cosθ))/cosθ, at 0.5° knots (0.29 m at 10°), **plus** `trim`: to full stroke 0.35 |
| `wlg.s.bogie`, `wlg.s.oleo` | `rot`: bogie to its stop (aft axle down), and the oleo from the solve in §5.6; **plus** `trim`, and `gear` for the stow angle |
| hydraulic gear doors | `gearDoors`: `[[0,0],[1,open°]]`. Leg-linked doors: `gear` |
| `door.ID.arm` / `door.ID` | `door.ID`: `[[0,0],[1,120]]` / `[[0,0],[1,−120]]` |
| `door.FWD`, `door.AFT` | `door.ID`: `[[0,0],[1,110]]` [E] |

Sequencing comes from the model, and the rules only map it:
- the doors open, then the legs move, then the doors close (16 s up, 18 s down);
- the slats extend first and retract last;
- on the ground the bogies follow the runway, and after lift-off they trim.

The body gear's 2 s lag on extension ([E]) is not drawn.

### 3.4 `poses()` and key states

`poses()` returns exactly `24·q` entries, with q = 120 (2,880 entries). Each entry is `follow(values)`, and entry i
has `turn = i·360/2880`. The other channels come from **reachable states only**:
- the model trajectory, sampled every 0.5 s of figure time with fixed substeps (§7.1), so lift, pitch, rot and gear
  are always consistent;
- toggles applied to ground states, and the gear lever and speed brake in flight states.

**Kit patch 9** (S, §8.6) builds framed planes from every distinct relative pose of the two groups in all of
`poses()`, deduplicated at 1e-4 and capped at 256 per pair, instead of 24 entries. The 24 sampled indices still hold
`W.KEY_STATES`, each at turn `i·15°`:
1. Gate: all 19 doors 1, cutaway 1.
2. Gate: doors 0.5, cutaway 0.5, steer −70.
3. Gate: doors 0.75, cutaway 0.25, steer +70.
4. Gate: doors 0, cutaway 0, steer −35.
5. Taxi: CONF 1+F, steer +35.
6. Taxi: CONF 2.
7. Taxi: CONF 3.
8. Taxi: CONF FULL with roll, pitchCmd and yaw −1.
9. Taxi: CONF FULL with roll, pitchCmd and yaw +1, spoiler 50, spoiler1 50.
10. Taxi: CONF 0 with roll −0.5, pitchCmd 0.5, yaw −0.5, spoiler 25, spoiler1 17.5 (the ground spoilers half way).
11. Taxi: CONF 1+F with roll 0.5, pitchCmd −0.5, yaw 0.5.
12. Take-off on the ground: rot 5.
13. Take-off on the ground: rot 10.
14. Lift 0.5 m, pitch 12.5, trim 0.5.
15–18. Climb: gear 0.75, 0.5, 0.25 and 0, all with the doors open.
19. Climb: gear 0, doors closed, CONF 1+F.
20. Climb: lift 6, pitch 2.6, CONF 0, cutaway 1.
21. Climb: lift 6, pitch 9, cutaway 0.5, speed brake 30 (spoiler and spoiler1).
22. Climb: CONF 1, cutaway 0.
23. Gate: cut.fd 16 units with the cockpit synced, and the FWD and AFT doors open.
24. Taxi: steer 0, ground spoilers (spoiler 50, spoiler1 35), doors 0.

Kit patch 9 is not done: the framed planes are built from these 24 states only, so a pair whose relative pose
changes through a channel's travel needs that travel in the key states. Spoilers 1 and 2 ride one channel (spoiler1)
on their own hinge lines; review round 2 put spoiler1 at 0, 17.5, 30, 35 and 50 across items 9, 10, 21 and 24 (with
only 0 and 50 the speed brake clip found the pair unseparated mid-way).

The parked cabin and cockpit poses never enter `poses()`; the synced poses replace them. A build takes ≤ 120 s.

### 3.5 Audit clips

Every clip is a pure function of time, sampled at **the page's own step**, which is model dt = rate/60 at the phase's
display rate.

| Clip | Frames | Turns |
|---|---|---|
| `orbit`: turn 0–360 at 0.05° (needed for continuity under the chain, KIT3D §6) | 7,200 | – |
| `gearUp` (16 s at ×10) and `gearDown` (18 s at ×10) | ≈ 100 each | 0, 125, 230 |
| `takeoff`: VR to 35 ft at ×2, with rot, oleos, lift and pitch | ≈ 230 | 0, 125, 230 |
| `flaps`: 0 → FULL → 0 at ×7.5 | ≈ 1,100 | 40, 220 |
| `doors`: all 19 doors open and close at ×2 | ≈ 480 | 0, 180 |
| `cutaway`: 0 → 1 → 0, with the cockpit sync | ≈ 360 | 0, 125, 230 |
| `controlCheck` (§7.6) | 360 | 220 |
| `steer`: −70 → 70 | 140 | 40 |
| `speedbrake`: 0 → 50 → 0 | 120 | 220 |

Each module adds its clips with `ctx.clip(...)`. `--clip=<name>[:a-b]` runs one clip or a slice of one, for sharding
(§10).

---

## 4. Layers

`T.stack(["back", "deck", "airframe"])`. The stage markup interleaves the WebGL canvases:

```
back       static SVG   plinth (drum, top annulus, heading ring, label plate, bolts), halo
deck       live SVG     platter (fixed-picture round on `air`); on it, as planes: the three marking sets (each an
                        inner <g> the page translates), the turning shadow, contact darkenings, fallback runway dots
gl-runway  canvas       runway, taxiway and stand lights in platter space; redrawn every frame while the deck scrolls
gl-ground  canvas       everything windowed to the platter disc: pools, belly-beacon wash, gear-bay and flood pools;
                        in dark only, the BACK half of beams and haze
airframe   live         every part riding `pitch`, plus the free `cabin` and `cockpit` (canvas painter when shipped)
gl-air     canvas       ID mask (offscreen), then scissored passes by kind: windows, cockpit, engines, washes,
                        points, and in dark only the FRONT half of beams and haze
```

- **The deck is its own live layer, and stays SVG on the shipping page.** The scrolling markings are inner
  transforms, which the canvas painter bakes (KIT3D 9.4), and the shadow uses an SVG blur filter. The platter lies
  wholly at z ≤ 0 and the airframe at z ≥ 0, so their order never changes.
- **The airframe is one live layer.** The near wing passes both in front of and behind the fuselage and cabin.
  Mount it with `CANVAS2D.mount(stage, controller, { only: ["airframe"], vary, effects })`, **after** GL
  initialisation, so `glShare` exists when `vary` is compiled.
- **No front static layer:** nothing static ever covers the aircraft.
- **Blending:** screen in dark and premultiplied normal in light (GL.md §2).

---

## 5. Geometry

### 5.1 Shared geometry in `world.mjs` (S)

Every shape that two modules share is an **analytic function in `world.mjs`**. Modules build against these, never
against each other's part objects.

**Section S0** (model metres; starboard half, from keel to crown; mirror y for 32 vertices):
```
[0.400,2.36] keel facet ±0.40   [0.972,2.46] [1.445,2.61] [1.933,2.86] [2.536,3.36] [2.921,3.86]
[3.202,4.40] belly line         [3.416,5.05] MAIN BELT  [3.526,7.25] shoulder  [3.402,7.90] UPPER BELT
[2.871,9.15] upper top          [2.253,9.90] [1.879,10.20] [1.342,10.50] [0.715,10.70] [0.350,10.77] crown facet ±0.35
```
Facet normals rotate monotonically from −80.1° to 79.1°.
- **Main belt** (z 5.05–7.25): carries the main-deck doors, the main windows (z 6.035–6.365), the main-deck cutaway
  walls and the scan lamps.
- **Upper belt** (z 7.90–9.15): carries the upper windows (8.785–9.115) and the upper-deck cutaway walls.
- **Upper top** (z 9.15–9.90): carries the upper doors' arms.

Helpers:
- `W.S0`;
- `W.ring(x)`, the section at station x;
- `W.facetFrame(x, z, side)`, which returns `{ o, u (forward), v (in-plane up), n (outward), facet }`;
- `W.partAt(x, z, side)`, which returns `{ name, group }` from `W.SHELL`;
- `W.loft(name)`, the T.hull ring spec of a shell piece.

**Rings.**

| Range | Kind | Stations (x: K, c), or source |
|---|---|---|
| Radome, 0.06–1.9 | anisotropic `(Ky·y, c + Kz·z)`, with Ky, Kz and c matching the model's width, height and top at 0.06, 0.25, 0.5, 1.0 and 1.5 | `FUSELAGE.stations` |
| Nose, 1.9–14.0 | homothetic `(K·y, c + K·z)`; K matches the height and c the top | 1.9 (0.4782, 1.9118) · 2.4 (0.5156, 1.9392) · 2.98 (0.5919, 1.6371) · 4.0 (0.6992, 1.2000) · 5.65 (0.8163, 0.7379) · 7.2 (0.8830, 0.4741) · **8.90 (0.9343, 0.2600)** · 10.1 (0.9611, 0.1394) · 13.4 (0.9968, 0.0076) · 14.0 (1, 0) |
| Barrel, 14.0–46.5 | S0 | – |
| Tail, 46.5–66 | homothetic; K is the mean of the height and width ratios; c matches the top | 46.5 (1, 0) · 50 (0.9641, 0.3765) · **52.25 (0.9194, 0.8203)** · 66 (0.3727, 5.4655) |
| Tail tip, 66–69.4 | anisotropic | 68, 69, 69.4 from `FUSELAGE.stations` |

- Homothetic rings make every side facet planar, so doors, windows, panes and roots sit flush. Every ring loft is
  smooth-shaded (patch 6), so neither facet steps nor twisted quads show.
- The single tail segment 52.25–66 keeps the crown line straight (z 10.722 → 9.479; 10.569 at the fin LE, x 53.94)
  under the fin root. It also keeps a planar main-belt facet for the tailplane roots.
- Residual error: the tail bottom runs up to 0.34 m low at x 50–54 (§11). The tip from 66 is exact.

**`W.SHELL`: every fuselage piece.** Each row gives a name, x range, clip, group and owner. Each piece is built as
one ring-loft T.hull over all its rings.
- **Every piece boundary lies in a gap between the windows on the two pieces it separates, and outside every door
  leaf.** `--check` asserts this against `WINDOWS` and `DOORS`.
- Checked: the smallest window margin is 0.03 m (at 46.5). The B3/B4 split at 31.6 only separates main-deck windows;
  the upper windows above it sit on `fus.U.wall`.

| Piece | x | Shape (model z) | Group | Owner |
|---|---|---|---|---|
| `nose.radome` | 0.06–1.9 | full loft | pitch | M2 |
| `nose.canopy` | 1.9–5.65 | loft ∩ z ≥ 6.02 (it carries the windshield and both side panes) | cut.fd | M2 |
| `nose.fdfloor` | 1.9–5.65 | loft ∩ 4.90 ≤ z ≤ 6.00 (the flight-deck floor; the NLG bay ceiling below) | pitch | M2 |
| `nose.baywall.{l,r}` | 1.9–5.65 | loft ∩ z ≤ 4.90 ∩ \|y\| ≥ 1.00 | pitch | M2 |
| `nose.fwd` | 5.65–8.90 | full loft (M1 door, first windows) | pitch | M2 |
| `nose.f.block` | 8.90–15.80 | loft ∩ z ≤ 5.15 (the FWD cargo door sits on its lower lobe) | pitch | M2 |
| `nose.f.wall.{l,r}` | 8.90–15.80 | loft ∩ 5.15 ≤ z ≤ 6.45, the main-belt facet strip, 0.10 m thick | pitch | M2 |
| `nose.f.top` | 8.90–15.80 | loft ∩ z ≥ 6.47 | **cut.f** | M2 |
| `fus.B1` | 15.80–18.5 | full S0 | pitch | M6 |
| `fus.B2` | 18.5–23.5 | S0 ∩ z ≥ 4.40 | pitch | M6 |
| `fus.B3` | 23.5–31.6 | S0 ∩ 4.40 ≤ z ≤ 7.90 | pitch | M6 |
| `fus.B4` | 31.6–35.9 | S0 ∩ 5.05 ≤ z ≤ 7.90 (the WLG bay ceiling) | pitch | M6 |
| `fus.B4belly.{l,r}` | 31.6–35.9 | the belly facet slab, z 4.40–5.05, 0.06 m thick | pitch | M6 |
| `fus.U.wall.{l,r}` | 23.5–35.9 | the upper-belt facet strip, z 7.90–9.15, 0.10 m thick | pitch | M6 |
| `fus.U.crown` | 23.5–35.9 | S0 ∩ z ≥ 9.17 | **cut.up** | M6 |
| `fus.B5` | 35.9–43.5 | S0 ∩ 4.40 ≤ z ≤ 5.15 | pitch | M6 |
| `fus.M.wall.{l,r}` | 35.9–43.5 | the main-belt strip, z 5.15–6.45, 0.10 m thick | pitch | M6 |
| `fus.M.chunk` | 35.9–43.5 | S0 ∩ z ≥ 6.47 (it carries the upper windows and the U2 doors) | **cut.md** | M6 |
| `fus.B6` | 43.5–46.5 | S0 ∩ 4.40 ≤ z ≤ 7.90 (M4 door) | pitch | M6 |
| `fus.UY.wall.{l,r}` | 43.5–46.5 | the upper-belt strip, z 7.90–9.15 | pitch | M6 |
| `fus.UY.crown` | 43.5–46.5 | S0 ∩ z ≥ 9.17 | **cut.up** | M6 |
| `tail.aft` | 46.5–52.25 | full loft (AFT cargo door, U3, bulk outline, windows) | pitch | M2 |
| `tail.cone` | 52.25–66 | full loft (M5 door, fin root, tailplane roots) | pitch | M2 |
| `tail.tip` | 66–69.4 | full loft | pitch | M2 |

**Cutaway bays** (`W.CUT`). Each bay's interior must lie **at least 0.02 m below its cut plane**, inside its walls,
and at least 0.02 m from the bay's end faces. M7 asserts this for every part.

| Bay | x | Floor | Cut plane | Walls | Interior limit | Group |
|---|---|---|---|---|---|---|
| FD flight deck | 1.92–5.60 | 6.00 | canopy bottom 6.02 | none: the canopy is the whole roof, and the cockpit group syncs only when it is clear | true heights | cut.fd + `cockpit` |
| F first class | 8.92–15.78 | 5.15 | 6.47 | main-belt strips 5.15–6.45 | ≤ 6.43 (1.28 m) | cut.f |
| U upper business | 23.52–35.88 | 7.90 | 9.17 | upper-belt strips 7.90–9.15 | ≤ 9.13 (1.23 m) | cut.up |
| M main economy | 35.92–43.48 | 5.15 | 6.47 | main-belt strips | ≤ 6.43 | cut.md |
| UY upper economy | 43.52–46.48 | 7.90 | 9.17 | upper-belt strips | ≤ 9.13 | cut.up |

Every bay is closed fore and aft by solid neighbours' end faces, below by its floor piece, and above by its cut
piece. Cut pieces sit 0.02 m above the parts below them, which reads as a lap joint at 4× and makes framed planes.

**Bays for the gear** (`W.BAYS`, convex polyhedra; no part may intrude one, with 0.025 m clearance, in any reachable
state except the gear that stows there):
- `nlg`: x 1.90–5.65, |y| ≤ 1.00, from the nose bottom up to z 4.88.
- `blg`: x 35.92–40.90. Its section is the fairing section (below) offset inward by 0.175 m (the 0.15 m cheek plate
  plus 0.025 m), clipped at z ≤ 4.38. Measured: a stowed BLG bogie (outer tyre face at |y| 3.672) fits with its
  **centre at z 2.90–3.05** over the whole length.
- `wlg.{s}`: x 31.85–35.30, |y| ≥ 1.80. It is the intersection of these half-spaces:
  - the fairing section offset inward by 0.085 m (the 0.06 m door plus 0.025 m);
  - the inner face of `fus.B4belly` minus 0.025 m;
  - z ≤ 4.98.
  Measured: a stowed WLG bogie, axles vertical, fits with its centre at y 2.55–3.15 and z 2.60–2.90.

**Fairing section** (`W.FAIRING.section(x)`). The template at the widest station, starboard:
`(3.202, 4.40) → (3.95, 3.85) → (4.30, 3.30) → (4.35, 2.70) → (4.20, 2.10) → (3.70, 1.66)`, convex.
- At other stations y is scaled between 3.202 and the station's half-width, and z between 4.40 and its bottom, from
  `FUSELAGE.bellyFairing`.
- The top vertex is exactly the barrel's belly-line vertex, so the joint is seamless.
- `--check` asserts:
  - the section stays at |y| ≤ 4.35, inside the wing root plane (4.45);
  - it clears the fillet's lower face by ≥ 0.10 m (the closest is near the root TE: about 0.16 m at (4.30, 3.30));
  - it clears every wing part by ≥ 0.05 m.

**Wing** (`W.WING`):
- **Root plane** y = ±4.45. Inboard of it is the fillet.
- **Panel stations:** y 4.45, 6.80, 12.45, 13.88, 18.99, 25.75 and 39.875.
- **Face lines.** The box's LE face and TE face are vertical planes along these straight plan lines:
  - LE face, inner: from LE+0.11c at 4.45 to LE+0.11c at 13.88.
  - LE face, outer: 13.88 → 39.10.
  - TE face, inner: 4.45 → 12.45.
  - TE face, mid: 12.45 → 25.75.
  - TE face, outer: 25.75 → 39.875.
  - Each face is planar within a panel and coplanar across any station where its line is straight. That is the
    condition under which a device may span a station. The true TE kink at 11.5 m moves to 12.45 (≤ 0.10 m).
- **Airfoil.** `W.wingSection(y)` is the airfoil polygon (flat bottom) at y. Points (ξ, ζ):
  `(0.025,0) (0.006,0.12) (0,0.42) (0.01,0.62) (0.03,0.78) (0.07,0.90) (0.12,0.97) (0.25,1.00) (0.40,0.97)`
  `(0.55,0.86) (0.70,0.62) (0.80,0.45) (0.90,0.26) (1.0,0.06) (1.0,0)`.
  - Chord and LE come from `M.wingAt(y)`.
  - Thickness and zMid also come from `M.wingAt(y)`, except at the root: 2.08 m at y 4.45 (t/c 0.12, [E]).
  - Bottom = zMid − t/2.
  - The bottom is planar within each panel. **The panels from 18.99 to 39.875 share one bottom plane** [E], at most
    0.12 m from the true bottom at 25.75. The outboard pylon then hangs flush from a single plane (§5.5).
- **Device spans** (after truth amendment T1, §8.5):
  - droop noses DN1 7.20–10.32 and DN2 10.32–13.88;
  - LE gap at the inboard pylon 13.88–15.60;
  - slats S2 15.60–18.41, S3 –21.51, S4 –24.61;
  - LE gap at the outboard pylon 24.61–26.45;
  - slats S5 26.45–30.12, S6 –33.80, S7 –38.05;
  - fixed LE: root 4.45–7.20, the four gap strips beside the pylons, tip 38.05–39.875;
  - flaps: inner 4.60–12.45, mid 12.45–18.99, outer 18.99–25.53;
  - fixed TE 25.53–26.00, split at 25.75;
  - ailerons 26.00–27.76, 27.76–31.14, 31.14–35.24 (or the re-measured T1b values);
  - fixed TE tip 35.24–39.875;
  - spoilers from `CONTROLS.spoilers`, except spoiler 1, which starts at 4.50.
- **Pylon slots:** y 14.35–15.25 and 25.25–26.15, inside the LE gaps.
- **WLG well** (computed by S):
  - Ceiling: the plane fitted 0.15 m below the local upper skin over x 32.55 → TE face and y 4.45–6.80 (about 4.0 at
    (32.55, 4.45) and 4.55 at (32.55, 6.80), falling aft with the airfoil). The skin above it is always ≥ 0.15 m thick.
  - The void runs from the wing bottom up to the ceiling, from x 32.55 to the TE face, and from the root plane to
    y 6.80.
  - No fillet slot is needed. The solve requires the swept leg to clear the fillet, whose top surface stays closed.

**Nacelle tangent planes** (`W.NACELLE[i]`, from `ENGINES.nacelle`):
- the fan cowl's top generator plane, tilted 0.69° down aft, tangent along x_lip + 0.50 → + 3.81;
- the aft cowl's top generator plane, tangent along + 3.81 → + 6.20;
- the core's top generator plane.
The pylons sit on these.

**WLG solve** (S, before M3 and M5 start, against the analytic shapes above; M5 later verifies it against the parts):
- **Search:** the pintle (x 32.6–33.6, |y| 5.3–6.4, z between 3.6 and the well ceiling − 0.10), the axis skew
  (0–25° forward-inboard), the leg rake and the stow angle.
- **Constraints:**
  - when down, the bogie is at its true position;
  - when stowed, the bogie lies inside `W.BAYS.wlg`;
  - the swept leg, bogie and wheels clear every analytic shape by ≥ 0.05 m, sampled every 1° at 4 bogie trims;
  - the leg passes the root plane below the root's upper skin.
- **Seed:** pintle (33.1, 5.57, 4.0), leg 3.0 m, inboard swing about 79°.
- **Output:** `W.WLG_SOLVE = { pintle, axis, θW, βW, βstow, stayPivots }`, printed by `--check`.
- **No solution:** fallback 2 in §11.

### 5.2 M1 Stage: plinth, platter, marking sets, shadow

| Part or plane | Construction | Notes |
|---|---|---|
| `stand.plinth` (static, back) | kit `cylinder` drum and annulus, r 425 units, z −16…−6 | ruler ring r 389–393 with ticks to r 401/406 every 2°/10°; label plate on the front at az 40 with three rule lines and two screws; a bolt ring at r 415 and an edge bead at r 422 (both outside the platter, whose edge is r 386); halo `k.haloOf` |
| `stage.platter` | vertical T.round, kit tones (`lo` drum, `mid` top rim) | a fixed picture; bolt circle of 120 dots at r 383; a lubber index (a short rule) at the nose bearing on the rim |
| marking sets | one T.plane on the platter's top face, clipped to r 386 units, with three inner `<g class="a3-set-{stand,taxi,rwy}">` | each set is a 600 m strip pattern the page translates by `scroll[set]` along kit −x, with opacity `setMix[set] × speedFade × seekFade × exp(−h/60 m)` (§7.5) |
| shadow | T.plane on the platter's top face, drawn after the markings | the aircraft's planform footprint at rest (fuselage, wings, tailplanes, nacelles) from `W`, filled `--a3-shadow` and blurred by an SVG filter; the page writes its blur and opacity from lift and its scale along kit x from pitch |
| contact darkenings | 5 small ellipses on the same plane, under each gear's tyres | opacity × (gear = 1) × (1 − smooth(0, 0.3 m, h)) |

**Sets:**
- **stand** (GATE, PUSHBACK): grey concrete with 7.5 m slab joints, a yellow lead-in line with a stop bar, the stand
  box, and rubber marks.
- **taxiway** (TAXI): a yellow centreline and edge lines.
- **runway** (LINEUP onward):
  - threshold piano keys at line-up, then touchdown-zone and aiming-point bars;
  - the 30 m centreline stripes repeating every 50 m; edge stripes; rubber streaks along the main-gear tracks;
  - no numerals (one-label rule).

Cost: planes only.

GL runway lights (`gl/runway.*`) are lattices per set:
- stand: none, or blue apron edge lights;
- taxiway: green centreline every 15 m and blue edge lights every 30 m;
- runway: white centreline every 15 m and white edge lights every 60 m.

They have per-set colour constants and a **streak** term: each lattice is integrated analytically over the per-frame
displacement d along the scroll axis, crossfading in once d exceeds pitch/6. Fallback dots sit in the same set
groups.

### 5.3 M2 Nose and tail

**Nose shell:** the `W.SHELL` pieces owned by M2, built as ring lofts. Then:

| Part | Shape | Group |
|---|---|---|
| panes | `T.plane`s on `nose.canopy`: the windshield, forward side and aft side, from `WINDOWS.cockpit`, placed by `W.facetFrame`. Each pane is one plane through its own points (a chord, inside the surface). Pane fills use `a3-pane`; frames use `iso-line` `mid` | cut.fd |
| `nose.wiper.{l,r}` | prism blades 0.9 × 0.05 m, flush on the canopy's windshield facet | cut.fd |
| `nose.probe.{pitot1..3,aoa1..2,tat}` | 0.25 × 0.04 m blades flush on `nose.fwd`'s lower facets [E] | pitch |
| radome seam, static ports | planes on `nose.radome` and `nose.fwd` | – |

- The NLG bay is open at the bottom. Its ceiling (`nose.fdfloor`'s bottom, z 4.90) and its walls' inner faces are
  never seen. `nose.radome`'s aft face closes it at 1.9, and `nose.fwd`'s front face at 5.65.
- When the canopy is lifted, the flight-deck floor, the forward bulkhead (`nose.radome`'s aft face above z 6.0) and
  the aft bulkhead (`nose.fwd`'s face at 5.65) show. They are drawn `mid` with a door outline plane on the aft
  bulkhead.

**Tail and empennage** (positions as revision 1 unless stated):

| Part | Construction | Notes |
|---|---|---|
| `tail.apu.blade` | T.hull | z 7.59–8.99, ±0.20, from 69.4 to 70.40. Its front face is flush on `tail.tip`'s end face, which spans z 7.30–9.11 and half-width 0.44 (checked) |
| `tail.apu.exhaust` | T.round on the blade's aft face | r 0.30 at z 8.29 |
| `tail.fin.{lo,up}` | T.hull, split at z 14.45 | symmetric, t/c 0.08. The root face lies in `tail.cone`'s crown-facet plane, from (53.94, 10.569) to 66.0. The LE runs to (68.02, 24.06); tip chord 4.70; TE face on the rudder hinge line |
| `tail.dorsal` | T.hull | from x 53.92 to 55.88 on the crown facet, flush ahead of the fin root |
| `tail.rudder.{lo,up}` | T.hull with a semicircular nose on the hinge line (KIT3D 4.3) | groups `rudder.*` |
| `tail.htp.{l,r}.{in,out}`, `.tip` | T.hull, flat bottom, t/c 0.09 | the root on `tail.cone`'s main-belt facet (z 6.25–7.77 at x 58); span axis normal to it; split at y 5.46; the fixed part ends on the elevator hinge line |
| `tail.elev.{l,r}.{in,out}` | T.hull with a semicircular nose | the inner elevator's root face is ≥ 0.05 m from `tail.cone` over its full range |
| `light.navTail` | T.round dome on the blade's top face, 0.15 m from its aft edge | **(70.25, 0, 8.99)** [E], clear of the exhaust (8.59) |
| `light.strobeTail` | T.round dome under the blade's bottom face | **(70.10, 0, 7.59)** [E] |
| `light.logo.{l,r}` | T.round domes on the tailplane tops | (63.5, ±5.0, 8.3) |

Detail (planes): wicks on the rudder and elevator TE faces, spar fastener rows on the fin and tailplanes (dotted
paths, one plane per row), and hinge-line fairing ends.

Counts: nose 18 parts, tail 27. About 75 weight units.

### 5.4 M3 Wings (per side; mirror with `side`)

| Part | Shape | Group |
|---|---|---|
| `wings.s.fillet` | T.hull: the barrel's S0 vertex line (3.416, 5.05) between the LE and TE carried inboard, plus the root section's upper contour at y 4.45. Line contact with the barrel; flush with the root face | pitch |
| `wings.s.box.1f` | panel 4.45–6.80, full height, x ≤ 32.55 | pitch |
| `wings.s.box.1u` | panel 4.45–6.80, x ≥ 32.55, above the well ceiling | pitch |
| `wings.s.box.{2..6}` | panels 6.80–12.45, 12.45–13.88, 13.88–18.99, 18.99–25.75, 25.75–39.875 | pitch |
| `wings.s.le.{root,gin.a,gin.b,gout.a,gout.b,tip}` | fixed LE strips (ξ 0 to the LE face): 4.45–7.20, 13.88–14.35, 15.25–15.60, 24.61–25.25, 26.15–26.45, 38.05–39.875. The gap strips end flush on the pylon side planes y = const | pitch |
| `wings.s.droop.{1,2}`, `wings.s.slat.{2..7}` | T.hull. At rest the back face sits 0.02 m off the LE face | groups |
| `wings.s.flap.{in,mid,out}` | T.hull with a semicircular nose, 0.02 m clear of the TE face at rest; flat bottom | track > hinge |
| `wings.s.te.{gap.a,gap.b,tip}` | fixed TE strips 25.53–25.75, 25.75–26.00, 35.24–39.875 | pitch |
| `wings.s.ail.{in,mid,out}` | T.hull with a semicircular nose tangent to the outer TE face | groups |
| `wings.s.spl.{1..8}` | thin T.hull plates on the ξ 0.55–0.70 facet, 0.02 m above it, with a half-cylinder LE on the hinge line. A spoiler that crosses a station is split there if the facet deviates by more than 0.015 m from its plate | groups |
| `wings.s.canoe.{2..5}.fwd` | **fixed fore fairings** under the box, ending 0.02 m ahead of the TE face plane, with the top flush on the box bottom | pitch |
| `wings.s.canoe.{2..5}.aft` | **aft fairings flush under the flap's flat bottom**, on the flap's hinge group. At rest they start 0.02 m behind the fore fairing; they open a visible seam as the flap runs out | flap group |
| `wings.s.canoe.6` | one fixed teardrop under `te.gap.b`, y 25.77–25.97 [E] (0.20 inboard of the AC station, to keep it out of the aileron's swept volume) | pitch |
| `wings.s.te.root.{fill,in,out,wall,side}` | **fixed root trailing edge over the wing-gear well** (integration): the stowed leg lies aft of the swept TE face, under the inner flap's root, so (as on the aircraft, where fixed structure aft of the rear spar covers the gear well) the trailing edge over y 4.46–6.76, from the TE face to x 34.05, is fixed structure from the well-ceiling plane up to the top skin, with an aft wall (x 33.98–34.05) and an outboard wall (y 6.72–6.76, through the well). The inner flap's root (y < 6.80) is its aft part from x 34.06. The inboard piece starts at x 32.85, 0.3 m aft of the box's TE face, and a filler forward of it closes the top: a moving or fixed piece over the leg flush on the swept TE face closed painter's cycles with the stowed stay | pitch |
| `wings.s.fence` | T.hull arrowhead on the tip face: 1.18 m up, 1.10 m down, LE 49.16, TE 52.07, 0.12 m thick | pitch |
| `wings.s.tiplight` | T.round housing on the tip face, ahead of the fence | pitch |
| lens planes | landing ×2 and taxi ×1 on `le.root` at (21.17/21.3, ±5.86, 4.22/3.63/4.86); the wing camera light under box.2 at (27.5, ±9.0) | – |

**Why the flaps clear the canoes.** The aft fairings move with their flap. The fore fairings stay ahead of the TE
face plane, and every flap point stays aft of its nose circle's forward extent, which only moves aft (the track
translation of about 0.18 m per degree dominates the rotation's 0.014 m per degree). The flap's nose circle never
moves forward of its rest position.

**Detail** (planes):
- fastener rows on the front and rear spar lines (ξ 0.11 and 0.62) and on every panel joint;
- flap-track and aileron-hinge fairing ends on the top skin;
- wicks on the aileron and tip TE faces;
- the fence's edge rule.

Counts: 50 per wing (fillet 1, box 7, fixed LE 6, droop 2, slats 6, flaps 3, fixed TE 3, ailerons 3, spoilers 8,
canoes 9, fence 1, tip light 1), 100 in all. About 145 weight units.

### 5.5 M4 Engines: 4 × Trent 970

Each nacelle is a row of coaxial T.rounds on a horizontal axis through (x_lip, y, centreZ) (KIT3D 4.4). The 0.33 m
inlet scarf is not modelled.

| Part | s (m from the lip) | r (m) | Material |
|---|---|---|---|
| `eng.n.lip` | 0 → 0.50 | 1.70 → 1.94; the front cap is the inlet face | chrome. Its accent is the phase accent's ring, not a static `lit` |
| `eng.n.fancowl` | 0.50 → 3.81 | 1.94 → 1.90; planes for cowl seams, the hinge line and latches | steel |
| `eng.n.aftcowl` | 3.81 → 6.20 | 1.90 → 1.205. Engines 2 and 3 get the translating-cowl seam ring and the cascade-zone panel lines (planes) | steel |
| `eng.n.core` | 6.20 → 6.93 | 1.00 → 0.835 (the fan-nozzle annulus step) | gunmetal |
| `eng.n.plug` | 6.93 → 8.39 | 0.495 → 0.08 | gunmetal |
| `eng.n.pylon.fwd` | T.hull, ±0.45 about the engine's y. Hull of: the fan cowl's tangent strip (x_lip + 1.0 → the LE face); the wing's LE profile (`W.wingSection` from ξ 0 to the LE face) at y ± 0.45; and the LE face itself. It rises from the cowl into the wing LE, **≥ 0.9 m deep at the LE** (z 4.95 → 6.0 inboard, 5.78 → 6.6 outboard) | | steel |
| `eng.n.pylon.mid` | T.hull between the fan-cowl tangent plane (top, flush under pylon.fwd) and the aft cowl's tangent plane (bottom), from x_lip + 3.81 to the LE face | | steel |
| `eng.n.pylon.aft` | T.hull under the box bottom plane (top flush) from the LE face to `pylon.wingAftX`, then the fairing down to (`aftTipX`, `aftTipZ`); bottom on the aft cowl's and the core's tangent planes. On the outboard engines it is split at y 25.75 into two hulls, flush at that plane | | steel |
| `eng.n.chine` | thin prism on the inboard side of the fan cowl (tangent line) | | gunmetal |

- The fan face is a T.plane on the lip's front cap. It holds the fallback (§6.3): a dark inlet disc, 24 spokes whose
  `vary` alpha fades as N1 rises, and the spinner.
- **Fan rotation:** clockwise as the reader sees the inlet. The TCDS gives anticlockwise from the rear.
- **Detail:** fan-cowl hinge line, acoustic-panel seam, cowl latches (planes); the reverser seam on engines 2 and 3.

Counts: 9 per engine plus 2 split halves, 38 in all. About 95 weight units.

### 5.6 M5 Gear: 22 wheels, 5 legs, stays and doors

- **Joint pattern** (KIT3D 4.6): a fitting flush on the host, a knuckle on the child group coaxial with the hinge, a
  leg tangent to the knuckle, a beam, and the wheels.
- **Tyres:** true size, inner face flush on the beam or axle end; axles at the free radius (§2).
- **Wheel details:** a hub ring, an 8-bolt circle, and one **hub-mark plane** per wheel, which the page rotates by
  `wheelPhase` (§7.5).
- **Stays:**
  - each stay is two links: `stay.up` hinged on the airframe at its fitting, `stay.lo` hinged on `stay.up` at the
    knee;
  - the lower link ends in a knuckle coaxial with a pin on a lug on the leg (a dynamic knuckle contact);
  - the angles come from a closed-form 4-bar solve at build time, tabulated in the follow rules, closure error
    ≤ 0.005 m;
  - the links lock straight when the gear is down and fold in transit;
  - when stowed they lie inside their bay.

**NLG** (about 22 parts):
- **Parts:**
  - fitting on the bay ceiling, knuckle, upper leg (raked to the steering collar), steering-collar knuckle;
  - **vertical lower leg** through the axle centre, torque link, axle, 2 tyres 1.27 × 0.455 at y ±0.525;
  - lamp bar on the leg above the collar (non-steering) carrying the taxi, take-off and turn-off lens planes;
  - dragstay ahead of the leg (it retracts forward);
  - doors: forward L/R as 2 strips each on the bay walls' lower facets (hydraulic, 62°, close after transit), and
    aft L/R (leg-linked, 69.2°).
- **Steering:** about a vertical axis through the axle centre, so every tyre bottom stays at z 0 over −70…70.
- **[E]:** the hinge (5.45, 0, 3.45) (at 3.55 the tyres passed 0.04 m into the radome mid-swing) and the stow angle θN
  (93.5° as built), with the wheels inside `W.BAYS.nlg`.

**WLG ×2** (about 20 parts each):
- **Parts:**
  - fitting on the well ceiling at `WLG_SOLVE.pintle`, knuckle, leg;
  - the oleo's lower leg (on `wlg.oleo`), bogie knuckle, beam, 4 tyres 1.40 × 0.53 (axles x 32.725 and 34.425,
    wheels ±0.675);
  - sidestay to the well;
  - doors:
    - **main door** (hydraulic, hinged at y ±1.71 on the fairing bottom, 79°, closes after transit), 2 strips: the
      bottom and the lowest fairing facet;
    - **fairing door**, on the leg (AC 2-9-0): strips on the upper fairing facets that close the cheek when stowed;
    - **hinged door**, on the leg: closes the wing's root-face opening if the stowed visibility test shows it.
    The auxiliary door is not modelled.
- **Rotation on the ground:** the bogie tilts to its stop (aft axle down), and the oleo extends up to 0.6 m [E]. The
  aft axle stays on the runway until lift-off (checked: rise 0.86 m at 10°, against 0.38 m from the tilt plus a
  0.5 m stroke).

**BLG ×2** (about 21 parts each):
- **Parts:**
  - fitting pillar from `fus.B5`'s bottom face (z 4.40, x ≥ 35.92), knuckle, leg, oleo lower leg;
  - bogie knuckle, beam, rear-axle steer knuckle, 6 tyres (axles 35.151, 36.851, 38.551; wheels ±0.765, ±0.775,
    ±0.765);
  - dragstay;
  - doors: outer (99°) and inner (94°), both linked to the leg (open by gear 0.12: a hydraulic inner door could not
    close after extension, its free edge would pass through the extended inner tyres), and the **centre** door, the
    only hydraulic one (closes after transit).
- **Stow:** aft into `W.BAYS.blg`, bogie centre at z 2.90–3.05, bogie flat.
- **Rotation on the ground:** the bogie stays level (`rot`), and the oleo extends by Δ(θ), so all six tyres stay
  tangent to z 0 at every on-ground pitch.

**Stowed visibility test:** at gear 0 with the doors closed, a z-buffer render of every recorded shape (patch 6
gives hulls a turn-check mesh) at 72 turns × pitch {3, 9, 12.5} shows 0 gear pixels.

Counts: 22 + 40 + 42 = 104 parts. About 230 weight units, mostly the 22 tyres and about 30 knuckles.

### 5.7 M6 Fuselage skin: barrel, fairing, doors, windows, bay liners, small parts, detail

**Barrel:** the `fus.*` pieces of `W.SHELL`.

**Passenger doors (16).**
- **Plates:** the leaf width 1.26 m, 0.06 m thick, standing **0.02 m** off the facet. The strip count depends on the
  facets:
  - M2–M4: 1 strip on the main belt, z from sill − 0.02 to sill + 1.98.
  - M1 and M5: 2 strips (belt and shoulder), same heights.
  - U1–U3: 2 strips, z 7.91 → 9.83 [E] (the true leaf is 2.11 m).
  The plates are 2.00 m and 1.92 m against the AC's 2.13 and 2.11 m, recorded as [E] in §11.
- **Arm:** a prism bar 0.84 × 0.06 × 0.06 m lying **entirely on one facet**:
  - main belt, z sill + 2.00 to + 2.06, for M2–M4;
  - shoulder, for M1 and M5;
  - upper top, z 9.84–9.89, for U1–U3.
  Its axis is that facet's up vector. One end is a knuckle round, coaxial and tangent to the facet. The other end's
  face is flush on the plate's top face. The U doors therefore lift as they swing.
- **Motion:** at full open the door is displaced 1.26 m forward and 0.72 m outboard (0.70 for M3).
- **Doorway:** a plane on the host part draws the rounded opening (`a3-dw-{ID}`). Its `vary` alpha follows
  `door.{ID}`.
- **Detail:** the door surround, porthole and handle marks, slide-bustle outline (planes).
- **Labels and actions:** `ctx.label` on every plate and arm, with action `door:{ID}`.

**Cargo doors.**
- FWD spans x 10.175–13.285, on `nose.f.block`'s lower facets. AFT spans 46.675–49.465, on `tail.aft`.
- Each is a knuckle round on the top hinge line plus 4 strips, 0.02 m off the skin; it opens to 110° [E].
- The bulk door is an outline plus a doorway that darkens.

**Windows:** one T.plane per row per host part, through `ctx.planeOn` (§8.4).
- 218 windows, rounded rects 0.26 × 0.33 m, r 0.07, at the model's stations.
- Class `a3-win` is glass. The lit copy `a3-win-lit` takes `vary` alpha `cabinLight × (1 − glShare)`.

**Belly fairing** (section from `W.FAIRING`):

| Part | x | Shape |
|---|---|---|
| `skin.fair.nose` | 18.5–22.5 | solid, from S0 ∩ z ≤ 4.40 at 18.5 to the full section |
| `skin.fair.{l,r}.mid` | 22.5–31.85 | solid cheeks |
| WLG gap | 31.85–35.30 | no fairing parts; M5's doors reproduce the section when closed |
| `skin.fair.{l,r}.link` | 35.30–35.92 | solid cheeks (also the BLG bay's front wall) |
| `skin.fair.{l,r}.up`, `.lo` | 35.92–40.90 | 0.15 m cheek plates (so the BLG bay is a void) |
| `skin.fair.tail` | 40.90–46.5 | solid, flush on `tail.aft`'s front face |

**Bay liners:**
- `skin.keel`: a solid block |y| ≤ 1.69 (clear of the WLG main-door hinges at ±1.71), z 1.66–5.05, x 31.85–35.30, between the WLG bays. Seen through an open
  cheek, it is the bay's inner wall.

**Small parts:**
- crown blades ×4 at x 12 (`nose.f.top`), 22 (`fus.B2`), 33 (`fus.U.crown`) and 41 (`fus.M.chunk`), each on **its
  host's group**;
- `light.beacon.upper{L,R}` at (26.9, ±0.8, 10.84) on `fus.U.crown` (group **cut.up**);
- `light.beacon.lower` on the fairing bottom;
- scan-lamp housings ×4;
- cargo-flood and camera lens planes.

**Detail** (planes):
- faint circumferential production-joint lines at the frame stations of the section joints (`FUSELAGE.sectionsBuilt`);
- lap-joint rules along the belt vertex lines;
- painted door surrounds, static-port and probe plates;
- a SATCOM fairing outline on the crown;
- panel lines on the fairing cheeks.

Counts: about 100 parts and 120 weight units.

### 5.8 M7 Cabin and flight deck (free groups `cabin` and `cockpit`)

Each interior stands on a carpet slab flush on its floor. Blocks are convex side profiles extruded across a seat
group.
- **Seat placement:** side blocks sit at `sideRows`, centre blocks at `centreRows`, and lateral positions come from
  `layoutY`.
- **Class distinction** (by tone and shape):
  - F: `hi` steel suites with tall privacy shells;
  - J: `hi` steel with shell backs;
  - Y: `mid` steel;
  - upholstery: rubber.
  There are no gold seats; warm material is reserved for the phase accent (§7.7).

| Bay (from W.CUT) | Contents | Shown seats (to verify in `checks`) |
|---|---|---|
| FD, group `cockpit` | Built to fidelity amendment T3:<br>• floor at 6.00;<br>• glareshield top at ≤ 6.82, just under the windshield sill (6.84);<br>• main panel about 0.7 m ahead of the eye, carrying 8 display planes (PFD, ND, MFD, EWD, SD, MFD, ND, PFD; 6 × 8 in);<br>• pedestal with 2 MFDs and 2 KCCUs;<br>• side consoles with sidesticks;<br>• 2 pilot seats placing the eye at (2.92, ±0.53, 7.17), and 2 observer seats;<br>• the rear bulkhead door outline.<br>About 16 parts, all x ≥ 1.94. | 4 crew |
| F | 2-2-2 suites at the F rows; about 12 blocks | 22 (all F rows, if they fit 8.92–15.78; `checks` prints the count) |
| U | J 2-2-2: side pairs at `sideRows`, centre pairs at `centreRows`; 22 rows of blocks; suites ≤ 1.23 m | 66 |
| M | Y 3-4-3: side triples at the 8 side rows 36.58–42.19, centre quads at the 8 centre rows 36.44–42.05; front of the M4 galley | 80 |
| UY | upper Y 2-4-2: side rows 44.25, 45.03, 45.81 and centre rows 43.68–46.02 | 28 |

Total shown: 4 crew + 196 passenger seats in four bays, against the true 555 (the caption says 555 for the
aircraft). About 100 parts, parked when closed: 1% each in `--bench`.

### 5.9 M8 Lights

M8 adds no airframe geometry. It adds:
- fallback billboards on the housing parts, the GL target registry consumer, and `vary` classes for every fallback;
- every WebGL program except the runway (§6).

### 5.10 Phase accent and labels

These touch every module.
- **Accent families**, `ctx.accent(family, plane)`. Each module adds lit-tone edge rule planes for its moving
  families (class `a3-acc-{family}`):
  - `doors`: door outlines (M6);
  - `eng1`…`eng4`: lip rings (M4);
  - `slats`, `flaps`: LE and TE edges (M3);
  - `surfaces`: aileron, elevator and rudder TE edges (M2, M3);
  - `gear`: legs and stays (M5);
  - `cabin`: cutaway rims (M6, M2).
  The page writes one family's alpha at a time through `vary` (§7.7).
- **Labels**, `ctx.label(namePrefix, text | (state) => text, action?)`. Every module labels its parts; the text is
  short and true. For example:
  - `M2L · main-deck Type A door · sill 5.13 m · open`;
  - `Engine 3 · Trent 970 · N1 94% · thrust reverser fitted (inboard engines only)`;
  - `Body gear R · 6 wheels · rear axle steers`.
  Actions use a fixed vocabulary: `door:{ID}`, `engine:{n}`, `cutaway`, `inspect:{view}`, `gear`, `flaps`,
  `light:{switch}`, `steer`.
- **Inspect views**, `ctx.inspect({ id, label, centre (model point), group, bearing, zoom, cutaway })`. Owners are
  listed in §7.4.

### 5.11 Counts, weight and budget

Weights are in prism units: 1 unit is about 0.0055 ms of Node time per frame (KIT3D 9.1). A round is 3.5 units, a
smooth ring loft 1.5–3 units by ring count, and a fixed picture 0.2.

| Module | Parts | Weight |
|---|---|---|
| M1 stage | 1 (+ planes) | 1 |
| M2 nose and tail | 45 | 75 |
| M3 wings | 100 | 145 |
| M4 engines | 38 | 95 |
| M5 gear | 104 | 230 |
| M6 skin | 100 | 120 |
| **Airframe** | **388** | **666** |
| M7 cabin and cockpit (shown only; about 1% each parked) | 100 | 105 |

**Budgets and expectations:**
- **Node CPU ≤ 7 ms** per frame. Expect 666 × 0.0055 ms plus about 0.35 ms of order, about 4–5 ms. `--bench` times a
  pure turn **and** the `takeoff`, `gearUp` and `flaps` clips, where many groups move together.
- **Browser:**
  - Canvas painter at 1440, DPR 2, headless SwiftShader: about 20–25 ms per task, about 11 ms per displayed frame at
    half rate.
  - Phone (390, 4× throttle): a 12–15 fps figure in headless.
  - Both must be measured on real hardware before release, with `RENDERER` logged.
- **`data.turn` ≤ 600 KB.** Expect about 500 KB: about 260 KB flat × 1.9 for pitch. Patch 9 may add 10–20%; measure.
- **Page ≤ 2.5 MB.** **`T.build` ≤ 120 s.**

**Levers, in order:**
1. half rate (on by default);
2. detail by speed;
3. wicks, crown blades and lamp housings as planes (−15 parts);
4. merge tail and nose pieces where no door sits;
5. restrict the pitch sampling to on-trajectory states;
6. GL: `maxRatio` 1.25, 10 beam samples, haze off;
7. a `--lite` build for plates under 600 px: no cabin, gear doors as planes, stays as planes.

---

## 6. WebGL plan

This follows GL.md, with these replacements:
- §4's cover sets and `pointVisibility` give way to the **ID mask**;
- §5's single air program and lite tier give way to **one program per pass kind**;
- §10's paper inks follow the **daylight rule** below.

The scaffold copies `spikes/gl/gl-shaders.mjs` to `a380/gl/shaders.mjs` and `gl-runtime.js` to `a380/gl/runtime.js`
once. M8 owns them from then on, and M1 owns `gl/runway.*`.

### 6.1 Canvases, programs and occlusion

- **`gl-runway`** (M1): lattices per marking set in platter space, using `toAir()` from `TURN.poseUniforms(controller,
  "air", "uAir")`.
  - Uniforms: `uScroll[3]`, `uSetMix[3]`, `uStreak[3]` and the level.
  - Every term is windowed to 0 inside r 38.4 m.
  - It redraws when its key changes: scroll, level, set mix, first light, or size.
- **`gl-ground`** (M8): pools and washes in world space at z 0, all multiplied by the **platter window**
  `1 − smooth(37.6, 38.4 m, r)`. Nothing is ever drawn on the plinth or beyond.
  - In dark only, it also draws the back halves of beams and haze, split by airframe proxies (GL.md 4.4).
  - It is cleared and skipped when no term is above 0.
- **`gl-air`** (M8):
  1. **ID mask.** When the airframe moved, draw every airframe-layer part's projected hull
     (`controller.frames()[i].hull`, in `controller.orderIndex("airframe")` order) into an offscreen RGBA8 target at
     2× the canvas resolution (capped at 4 Mpx). Encode the order index in R + 256·G, use no blending, and dilate
     each hull by 0.6 viewBox px so ink stops outside the occluder's stroke. This is about 6k vertices in one draw.
  2. **Programs**, one per kind:
     - `windows`: per window-bearing part, with `glslBarrelPolygon` on the barrel and `glslFrustumPolygon` (new) on
       the nose and tail lofts;
     - `cockpit`: the canopy panes and the display panel;
     - `engines`: inlet, fan and spinner per nacelle;
     - `washes`: fin logo wash (dark only), wing and engine scan;
     - `points`: one pass per lit point light;
     - `volumes`: the front halves of beams and haze, dark only.
  3. **Masking.** Each surface pass multiplies its ink by `visibleOf(target)`, which is the fraction of 2×2 mask
     samples whose index is ≤ the target part's index. A point pass computes its scalar visibility in the shader from
     9 mask taps around the lens, against the housing's index.
     - No cover uniforms and no CPU walks.
     - The JS per moving frame is the hull upload (about 0.1 ms) plus anchors.
- **Uniforms.** Each program carries only its own terms; the largest, `points`, is about 70 vectors. If
  `MAX_FRAGMENT_UNIFORM_VECTORS` < max(need) + 8, or any program fails to link, the page stays on the SVG fallbacks.
  It logs `RENDERER`, the limits and each program's compile and link times.
- **Shader sources** are generated in Node from `world.mjs` and ship in `DATA.gl`:
  - window stations and door gaps;
  - each window part's ring planes and section;
  - pane polygons, nacelle stations, the fin and wing face planes.
  Fixed geometry is never a uniform.

### 6.2 Effect table

Anchors: anything on a sub-group (gear, doors, flaps) is anchored each frame with `controller.anchor`. Surfaces on
`pitch` and the cut groups use group-space constants under that group's pose.

| Effect (model id) | Anchor, sector | Pattern, envelope | Pass, occlusion | Dark | Paper (daylight rule) | Fallback (`vary` class) |
|---|---|---|---|---|---|---|
| Nav red / green (`navLeft/Right`) | tip lights; b −110…0 / 0…110, 5° soft | steady; settle 0.22 s × lens facing | points, mask | glow | lens glint: saturated body, pale core, dark rim | billboard `a3-l-navL/R` |
| Nav white (`navTail`, 70.25, 0, 8.99) | \|b\| ≥ 110 | steady | points | glow | **neutral white rule**: white core, rim (.55,.60,.66) | billboard |
| Obstruction ×4 | fence top and bottom | with NAV, on the ground | points | small glow | neutral white glint | billboard |
| Beacons (`beaconUpperL/R` on cut.up, `beaconLower`) | housings; the lower lens is hidden by facing | `flashTrain` period 1.0 s, offset 0.5, rise 0.06, fall 0.10 | points; lower: ground wash | glow + red ground wash | glint only, **no wash** | billboard |
| Strobes wing / tail | tip lights / blade | double flash at 0 and 0.11 s (GL.md 7.1) / single | points (+ a small ground wash in dark, platter-windowed) | white glow | **neutral white glint, not blue; no wash** | billboard |
| Logo L/R | `pitch` constants, aimed at the fin | settle 0.35 s; AUTO per the model | washes on both fin pieces | warm wash, cap .45 | **none** (daylight) | gradient plane on the fin, dark only |
| Wing / engine scan | `pitch` | settle 0.35 s; S toggle | washes on the outer box tops (box.4–box.6) and the slats; nacelles | warm wash .42 | faint tint, cap .15 | gradient planes |
| Landing ×4, taxi ×3, take-off ×3, turn-off ×2 | wing root (pitch); nose lamps on `nlg.leg` × down-lock | settle 0.3 s; switches; the model's rules (landing off passing 10,000 ft, nose lights dark with the gear) | **lens**: points. **Beam**: dark only, volumes plus ground back half, windowed to 0 inside r 42.0 m. **Pool**: only where the true cone meets the platter (in practice the turn-off lamps' outer fringe) | lens, beam, pool | lens glint; pool only on the pavement token, cap .25; **no beam** | billboard lens; pool ellipse when on the platter |
| Camera ×4, cargo flood ×2, gear bay ×4 | per the model | per the model's lights | ground pools, platter-windowed | warm pools | cap .2 on pavement only | pool ellipses |
| Cabin windows (218) and open doorways (19) | window parts (`fus.*`, `nose.fwd`, `nose.f.*`, `tail.aft`, `tail.cone`) | `cabinLight` through settle 1.3 s; 7% of blinds down (hash); doorways weighted by `door.{ID}` | windows program, one pass per part, mask | warm glow | glass plus blinds; warm tint at a **lower cap .5**, dimmed by the ember match | `a3-win-lit`, `vary`: `cabinLight × (1 − glShare)` |
| Cockpit panes and displays | `nose.canopy` (cut.fd): panes from `WINDOWS.cockpit`; a display panel plane at the T3 panel position behind them, for parallax. With the canopy lifted, the `cockpit` group's display planes | settle 0.7 s once powered (APU or engines) | cockpit program | blue-white | blue ramp (GL.md §10) | display planes `a3-disp`, `vary` |
| Engines ×4: inlet, fan, spinner | lip constants; N1 per engine | N1 lag (τ 1.9 s up, 3.0 s down); phase += ω·dt, ω = 2π·2900·N1/60, **clockwise as seen from the front**; `fanGains` | engines program, mask | metal | cavity greys | inlet plane: disc, spokes (`vary` alpha by N1), spinner; spins on the canvas page via patch 11 |
| Heat haze ×4 + APU | plume volumes | `smooth(.55, .92, N1)`, cap .05 | volumes plus ground back | faint | **none** | none |
| Runway, taxiway and stand lights (M1) | platter lattices per set | settle 0.5 s × set mix × speed streak × `exp(−h/60 m)` | runway canvas, painter's order | glow | glint with a small rim; pavement tint cap .12 | dots in each set group |

**Sign checks** (`--check` and drive):
- At turn 40 (nose-on), red is right of centre.
- At turn −70 (b 110), red and white crossfade with no step.
- A slowed sheet at N1 5% and turn 40 shows a marked blade moving **clockwise** on screen, for all four engines.

### 6.3 Fallbacks on the canvas page

- Every fallback element lives inside its part and is a `vary` class whose alpha is
  `envelope × sector × (1 − glShare)`.
- Nothing inside the airframe layer uses `display:none`, `visibility:hidden` or CSS-variable opacity. The canvas
  painter compiles the former away for good and bakes the latter (`canvas-painter.mjs` lines 80–82 and 133–148).
- `glShare` is 0 without WebGL and settles 1 → 0 on context loss.
- Kit patch 11 lets an `effects` function draw the compiled part first and then extra marks. The fallback fan spokes
  and the wheel hub marks rotate this way.
- **Checks** on the shipping canvas page and on the SVG page, in both themes: `--no-webgl`, `--reduced` and a forced
  context loss.

### 6.4 Loop, reduced motion, first light

- `refresh()` recomputes the mask, anchors and boxes only when the airframe moved.
- GL draws every frame while anything animates (flashes, fans, haze, scroll); otherwise it stops and keeps its
  frames.
- **Reduced motion:** flashes at 0, nav steady, fans frozen with an exposure of 1/60, one still frame per input.
- **First light:** `settle(first, 1, dt, 0.4)` scales every finished ink, and the fallbacks hand over through `vary`.

---

## 7. Interaction and motion

### 7.1 Time

- The model runs in real seconds. `live.js` calls `M.step(state, target, h)` in **fixed substeps h ≤ 1/30 s of model
  time**, `ceil(dt_page × rate / h)` times per frame. Every rate therefore plays the identical trajectory, which is
  the one `poses()` sampled.
- **History:** every 0.1 s of page time, store the channel vector, a state snapshot and the phase.

| Context | Rate |
|---|---|
| GATE | the model is idle; a 14 s dwell; doors at ×2 |
| PUSHBACK | ×3 while any door moves, ×12 otherwise |
| TAXI | ×7.5 |
| LINEUP | ×9 |
| TAKEOFF | ×2 |
| CLIMB | ×10 |
| FL100 | ×30, then a 3 s hold after the landing lights go off |
| Seek forward | **rate = remaining model seconds / 3 s**: any later phase is reached in ≤ 3 s. Substeps keep it exact, the markings fade to pavement, and the readout says `fast-forward · Take-off` |
| Rewind | plays the history back over at most 8 s, with markings faded to pavement |
| Paused (Space) | ×0 |

### 7.2 Pointer

- **Drag on empty stage** turns `air`, through `controller.angleAt`. Capture after 1.5°, follow with τ 0.12 s, and
  keep turning with inertia that decays with τ 1.2 s. `touch-action: pan-y`.
- **Hover** (fine pointers) and **tap** (coarse pointers) pick the topmost airframe part under the pointer:
  - the pick tests the controller's per-frame projected hulls in reverse paint order (the same data as the ID mask);
  - the readout shows the part's `ctx.label`;
  - on the SVG page the part gets a faint `a3-hover` outline.
- **Click, or a second tap,** runs the part's action:
  - one door opens or closes;
  - an engine starts or stops on the ground;
  - the canopy or a cabin crown toggles the cutaway;
  - a seat block opens that deck's Inspect view.
  A drag of more than 1.5° never counts as a click.
- **The tour** pauses on any input and resumes 30 s after the last one (§7.6), easing from the current state.

### 7.3 Keyboard (stage focused, `tabindex=0`)

| Key | Action |
|---|---|
| ← / → | turn 3° (Shift: 15°) |
| Home | back to the tour's current bearing |
| 1–7 | seek to that phase (enters HOLD) |
| Space | pause or resume |
| D | all doors (on the ground below 1 kt; otherwise arms) |
| C | cutaway |
| F | flaps lever 0 → 1 → 2 → 3 → FULL → 0. Lever 1 gives CONF 1+F on the ground and below 205 kt, CONF 1 above. A position above its VFE is aria-disabled with its reason |
| K | control check (on the ground; otherwise arms) |
| G | gear lever (in flight only; true 16 s up and 18 s down) |
| E | engines: on the ground, start 1+2 then 3+4 (the beacon comes on first), or shut down all four |
| B | speed brake |
| S | wing and engine scan lights |
| I / Shift+I | next or previous Inspect view; Esc returns to 1× |
| [ / ] | steer −/+ 10° (only below 0.5 kt; returns to 0 over 2 s after release) |
| Esc | leave Inspect, or return to the tour |

The light-panel buttons are reachable by Tab. Each writes an override into the model's light targets, which `step()`
honours. AUTO positions keep the model's rules: the logo off with the slats in, the nose lights dark with the gear
up, the strobes on when airborne. Overrides persist in HOLD and are cleared when the tour resumes.

### 7.4 Inspect

A view is `{ id, label, centre (model point on a group), bearing b, zoom, cutaway }`:

| View | Owner | Centre | b | Zoom | Cutaway |
|---|---|---|---|---|---|
| Cockpit | M7 | the main panel | 180 (looking forward and down into the panel) | 10× | canopy up |
| First | M7 | the F bay centre | +60 | 5× | open |
| Upper deck | M7 | the U bay centre | +55 | 4× | open |
| Main deck | M7 | the M bay centre | −55 | 4× | open |
| Engine 2 | M4 | the inlet | −20 | 6× | – |
| Wing gear | M5 | the WLG bogie | +120 | 6× | – |
| Door M2L | M6 | the M2L door | −80 | 6× | – |
| Tail | M2 | the fin root | +150 | 3× | – |

Entering a view:
1. eases zoom and centre with `settle` 0.6 s;
2. eases the turntable to the bearing;
3. sets the cutaway;
4. forces `detail = 1` and full rate.

Applying a view to every layer in one place:
- `canvas.zoom(z, cx, cy)` for the airframe;
- the `viewBox` of the back and deck SVGs;
- `uView` scale and offset for the three GL canvases (kit patch 10), which also covers the ID mask.

Drag still turns about the turntable axis, with the centre re-anchored each frame from the group pose. The model
keeps running.

### 7.5 Motion of the stage

- **Marking sets:**
  - `scroll[set] = groundDistance mod repeat`, written every frame **even at half rate**;
  - `setMix` crossfades by phase with settle 1.0 s (stand → taxiway at TAXI, taxiway → runway during LINEUP);
  - `speedFade = 1 − smooth(pitch/6, pitch/2, d)` on the SVG stripes, where d is the per-frame displacement, while
    the GL lattices crossfade into their analytic streak;
  - `seekFade` takes every set to plain pavement during seek and rewind.
  No light ever crawls backward.
- **Shadow:** blur 6 → 18 px and opacity .35 → .12 (light theme: .18 → .06) as lift goes from 0 to 6 m. Scale along
  the axis by cos(pitch), with the offset following the pitched footprint.
- **Wheels:** `wheelPhase += groundSpeed·dt / r`, per gear. After gear-up selection every wheel stops within 3 s
  except the BLG aft axle (AC 2-9-0). Reduced motion: static.

### 7.6 Modes and the idle tour

- **TOUR** runs when idle. **HOLD** is entered by any phase, system, light or Inspect input; the chosen phase runs
  to `phaseDone` and holds. After 30 s without input the tour resumes from the current state.
- **Taking over never resets anything.** Toggles act on the values on screen. Test every toggle in every tour phase.

**`tourBearing(t)`** is one pure function, monotone, one turn per 114 s loop. Between holds it eases with
smootherstep in time, so velocity is continuous and zero at each hold. Peak ω is 29.5°/s, and there are no reversals.

| t (s) | Phase, event | b |
|---|---|---|
| 0–3.5 | GATE: doors and holds open (starboard: cargo, catering) | hold +100 |
| 3.5–7 | the cutaway opens (3.5 s, settle 2.5 s) | +100 → +45 |
| 7–13 | **cutaway fully open: hold to read the cabin** (6 s) | hold +45 |
| 13–19 | the cutaway closes; at 14 PUSHBACK: doors close, slides arm, beacon on (20.7) | +45 → −40 |
| 19–27 | the push (from 21); engines 1+2 start (port, 22.8) | hold −40 |
| 27–33 | engines 3+4 (29.5) | −40 → −130 |
| 33–45.5 | **aft quarter:** TAXI begins at 34.4; CONF 1+F (slats 34.4–38.1, then flaps 40.0–41.3); the **control check** runs at 37–43 s (roll, pitchCmd, yaw −1 → +1, 2 s each, eased) | hold −130 |
| 45.5–49.5 | LINEUP (46.4): strobes, landing and take-off lights | −130 → −190 |
| 49.5–52 | tail-on: tail strobe, white nav light, logo wash | hold −190 |
| 52–58 | TAKEOFF roll (from 51.4) | −190 → −260 |
| 58–123 | **starboard profile:** rotation at 77.9 s, lift-off at 79.9, gear up at 82, CLIMB, FL100 (100.8), the hold ends at 114.2, then the REWIND (8 s). −260 ≡ +100, so the loop is continuous; the tour clock holds in this last hold until the rewind reaches the gate | hold −260 |

As built (integration): the model's own phase times at the tour's rates are 5 s later than revision 2's table
assumed (TAXI 34.4 instead of 29), so the knots and the check are re-timed to them (`F.TOUR`, `F.CHECK_AT`,
`F.LOOP` 123); `--check` asserts that the check starts after TAXI and that the rewind fits the loop. Peak ω
29.5°/s, no reversal. When the tour resumes after a hold its clock is set from the model's phase (figure times
from `DATA.tourPhases`) and the turntable eases to the tour's bearing at no more than 30°/s.

The control check (`controlCheckAt(t)`) follows the FCOM's "FLT CTL check" in taxi; its deflections are [E].
`--check` prints the tour's peak ω and the largest Δω per frame.

### 7.7 Phase accent

Exactly one family carries the lit accent at a time:

| Phase | Family |
|---|---|
| GATE, early PUSHBACK | `doors` |
| PUSHBACK, each engine as it starts | `eng1`…`eng4` in turn |
| TAXI | `slats`, then `flaps` while each moves |
| control check | `surfaces` |
| TAKEOFF roll | all four engines |
| CLIMB | `gear` while it moves, then `flaps`, then `slats` |
| FL100 | none |
| cutaway open | `cabin` |
| Inspect | the inspected family |

The page writes the family's `vary` alpha with settle 0.4 s. The inlet lips stay chrome but not `lit`.

### 7.8 Readout, aria, live region

- **Readout:** the wide or compact form (§1), written only when the string changes. While a part is picked it shows
  the part's label.
- **Stage:** `role="slider"` with the heading in `aria-valuenow`. `aria-valuetext` (for example "Turntable 40°,
  seeing the nose and right side") is written 700 ms after input settles.
- **Live region:** written **only in HOLD, or while the stage or a legend button has focus**, and silent during
  TOUR. It gets short phase lines, for example `Taxi: CONF 1+F set, 18 knots`, plus the result of each toggle. It
  starts empty and gets the full `M.ariaText(state)` on focus.
- **Graphics:** the `<svg>` and canvases are `role="img"` with the object's description, or `aria-hidden`.

### 7.9 Loop

One `tick(now)` does, in order:
1. clamp dt to 1/30 s;
2. tour, input and inspect targets;
3. substep the model;
4. channels;
5. `follow`, then `controller.set` only if a group value changed (half rate: on alternate frames above 14 ms);
6. deck scroll, set mix, shadow and wheels, every frame;
7. GL refresh and draw;
8. `vary` alphas, then `canvas.paint`;
9. the readout.

- Detail by speed: `detail = settle(1 − smooth(120, 240, |ω|), 0.25 s)`, forced to 1 in Inspect.
- Offscreen stop: an IntersectionObserver with rootMargin 120 px, reading the newest entry.
- Reduced motion: no tour and no inertia. Phases jump to their end state through synchronous substeps, with one
  still frame per input.

---

## 8. Roles, files and the module contract

### 8.1 Layout and ownership

```
a380/
  model.mjs, truth.md, notes/TRUTH-SUMMARY.md, tmp/model-test.mjs   S (truth amendments, §8.5); read-only for modules
  world.mjs              S   frame, fit, S0, rings, SHELL, CUT, BAYS, FAIRING, WING, NACELLE, WLG_SOLVE, KEY_STATES, partAt, facetFrame, stubs
  follow.mjs             S   makeFollow (pure; inlined)
  build.mjs              S   harness, ctx, stubs, flags
  live.js                S core (loop, model substeps, history, seek, rewind, tour, readout, aria, half rate, vary writer)
                         I interaction (legend, light panel, systems keys, arming, Inspect, picking, labels, compact readout)
  a380.css               S tokens; build.mjs appends each module's ctx.css block, marked by module
  notes/AUDIT.md         I   audit runs, timings, accepted lines with their proof
  parts/stage.mjs        M1        gl/runway.mjs, gl/runway.js     M1
  parts/nose.mjs         M2        parts/tail.mjs                  M2
  parts/wings.mjs        M3        parts/engines.mjs               M4
  parts/gear.mjs         M5        parts/fuselage.mjs, parts/skin.mjs   M6
  parts/cabin.mjs        M7        parts/lights.mjs                M8
  gl/shaders.mjs, gl/runtime.js, gl/passes.js, gl/mask.js          M8 (shaders.mjs and runtime.js are seeded by S from the spike)
  tmp/, shots/           gitignored scratch; each role writes only files prefixed with its id (s-, i-, m1-, … m8-); nobody cleans tmp
```

A module never edits `build.mjs`, `world.mjs`, `follow.mjs`, `live.js` or `model.mjs`. If it needs a change there, it
asks S or I with the exact function and numbers. They own those files and answer within the module's working time.

### 8.2 Dependency graph

```
S: world.mjs (analytic shapes, WLG solve, KEY_STATES) · kit patches 6–11 · truth T1–T6 · harness + stubs · live.js core
   │
   ├─ M1 stage ─┐
   ├─ M2 nose & tail ─┤
   ├─ M3 wings ─┤
   ├─ M4 engines ─┤   all in parallel, each building against W and stubs only
   ├─ M5 gear ─┤
   ├─ M6 skin ─┤
   ├─ M7 cabin ─┤
   └─ M8 lights ─┘
I (in parallel with M1–M8: live.js interaction) → integration → full audits, perf, captures, caption
```

- No module needs another module's part objects.
- Planes on another module's part go through `ctx.planeOn(partName, spec)`, resolved after all modules have built.
  An example is M6's windows on M2's `nose.fwd`.
- Shared geometry comes from `W`.

### 8.3 `build.mjs` flags

| Flag | Effect |
|---|---|
| (none) | dark `a380.html`, with the canvas painter on the airframe layer |
| `--light` | `a380-light.html` |
| `--verify` | SVG painter for every layer, plus `window.__isoVerify`. Writes `a380[-light]-verify.html` and `tmp/states-*.json` (phase paths, and reachable per-hinge paths at 0.02°, the pitch with lift taken from the trajectory) |
| `--only=<ids>` | builds S's scaffold plus the listed modules, with **stubs** for the rest: each missing module's `W.stub(id)` (exact `W.SHELL` lofts, the wing boxes, one round per nacelle, down-position tyres, and no cabin). An `--only` acceptance therefore means one module against stubs |
| `--check` | every module's `checks(ctx, out)` plus S's world checks (mirror, fit, tour ω, piece boundaries, fairing clearances, WLG solve report, sync-pose test) |
| `--bench` | Node frame timing over 360 turn angles **and** the `takeoff`, `gearUp` and `flaps` clips, per module and in total |
| `--audit [--quick] [--only=lines] [--clip=name[:a-b]]` | `A.auditOrExit`, then `TA.orbitOrExit` with the sweep, the clips and `poses` |
| `--painter=svg\|canvas`, `--out=`, `--lite` | as named |

### 8.4 Module interface

```js
export const id = "wings";          // part names start `${id}.`; statics `stand.`
export function groups(ctx) {}      // declare groups and follow rules (all modules, in order, before any build)
export function build(ctx) {}       // parts, planes, labels, accents, inspect views, GL registrations, CSS, clips
export function checks(ctx, out) {} // assertions after T.build; throw with a readable message
```
Order: `stage, nose, tail, fuselage, skin, wings, engines, gear, cabin, lights`. `planeOn` is resolved after the last
module.

| `ctx` member | Meaning |
|---|---|
| `k, G, A, TA, TURN, T, R, P, M, W` | kit core, lathe, audit, turn-audit, runtime, `turning(P,{recorder})`, recorder, projection, model, world |
| `ctx.group(name, spec)`, `ctx.g(name)` | declare (in `groups()` only), or look up any group (throws if unknown) |
| `ctx.rule(rule)` | add a follow rule; validated (group exists, channel known, table monotonic in x) |
| `ctx.prism / round / ball / hull / tube / fixed(opts)` | `T.*` wrappers: name prefix, defaults (layer `airframe`, `steel`, `hi`, crease `faint`), ownership |
| `ctx.plane(part, opts)`, `ctx.billboard(part, opts)` | `T.plane` / `T.billboard` on your own parts |
| `ctx.planeOn(partName, opts)` | a plane on any part, by name (resolved last; works against stubs) |
| `ctx.static(item)` | `R.put` on `back`, shapes wrapped in `R.solid`; names `stand.` |
| `ctx.css(text)` | page CSS: light values first, `.iso[data-theme="dark"]` overrides after; every class used must be declared |
| `ctx.vary(cls, expr)` | per-frame alpha for a class, for both painters. `expr` is a page-side expression over channels and page values |
| `ctx.light(spec)`, `ctx.lamp(spec)`, `ctx.glTarget(spec)` | GL registry: `{ id, part, group, at, normal/dir, kind, sector, cone, switch, gate }`; targets `{ name, part, kind: "windows"\|"cockpit"\|"fin"\|"wing"\|"nacelle"\|"panel", constants }` |
| `ctx.label(prefix, text, action?)`, `ctx.accent(family, plane)`, `ctx.inspect(view)` | §5.10 |
| `ctx.clip(spec)`, `ctx.poseHints(list)`, `ctx.report(line)` | audit clip, extra reachable states, build log |

**Rules for modules:**
1. Every coordinate goes through `W.kit`.
2. Parts are convex. No part of one module intrudes another module's part or a `W.BAYS` polyhedron in any reachable
   state.
3. Cross-group contacts keep 0.02 m, except hinge knuckles.
4. Flush neighbours share an outline tone.
5. Nothing in the airframe layer is hidden with `display` or CSS-variable opacity; use `vary`.
6. Any part whose footprint lies on a cut piece rides that piece's group. Find it with `W.partAt`.

### 8.5 Truth amendments (S applies them to `model.mjs`, `truth.md`, `TRUTH-SUMMARY.md` and `model-test.mjs` first)

| # | Change | Source and tag |
|---|---|---|
| T1 | LE devices re-scanned from AC 2-2-0 p035: DN1 7.20–10.32, DN2 10.32–13.88, pylon gap 13.88–15.60, S2 15.60–18.41, S3 –21.51, S4 –24.61, pylon gap 24.61–26.45, S5 26.45–30.12, S6 –33.80, S7 –38.05; `WING.sweepLE.crankY` 13.88 if the scan supports it. **T1b:** re-measure the aileron splits (the critic reads about 28.3, 30.9 and 34.6) and adopt them only if confirmed | D (AC drawing); Airbus flight-controls talk (HAW Hamburg 2007): droop noses inboard of the inner engine |
| T2 | FL100 keeps `landing: 1`. `step()` switches landing off when height ≥ 10,000 ft. `phaseDone(FL100)` holds 3 s after that | S-secondary (SOP) |
| T3 | `WINDOWS.cockpit.pilotEye` = (2.92, ±0.53, 7.17); `opens` moves to the forwardSide pane (sliding window). `CABIN.flightDeck.x` = [1.92, 5.60] | S (AC 4-4-0: 2.92 m from the nose to the eye line; the binocular chart) |
| T4 | `model-test` prints the ground roll from brake release (2,101 m at ×1). `truth.md` and TRUTH-SUMMARY 40 say "roll 2.1 km". `PHASES.TAKEOFF` comment fixed | D |
| T5 | `readout()` rounds the speed before choosing the pushback branch, and shows `pushback` with no number below 0.5 kt | – |
| T6 | `LIGHTS.navTail` at (70.25, 0, 8.99) and `strobeTail` at (70.10, 0, 7.59), on the APU blade | E (positions were already E) |

After T1–T6, S re-runs `model-test.mjs` and records the new numbers in `truth.md`.

### 8.6 Kit work (S, before any module starts geometry; logged in `notes/kit-patches.md`; the turning-dial regression must stay unchanged)

**Patch 6: `T.hull`.** `T.hull({ name, group, layer, points | rings, flats?, smooth?, tone, crease, material, lit,
owner, details: { dots } })`.
- **Faceted mode** (`points`): a quickhull with coplanar faces merged at 1e-6 × size, outward normals. It throws below
  4 non-coplanar points. `part.world = { points, faces: [{ ring, n, d }] }`. It exports `convexHull3`.
- **Ring-loft mode** (`rings`): consecutive planar convex rings with equal vertex counts, plus optional clip `flats`.
  - The body is the hull of the rings.
  - **Smooth shading:** vertex normals are averaged across smooth edges, and the facing value is interpolated
    bilinearly over each side quad. Tone-band boundaries are found by marching squares at the kit's thresholds and
    emitted as one band polygon per tone per ring strip, so bands slide continuously as the part turns, like the
    rounds' `labelledArcs`.
  - Caps and clip flats are flat faces with the kit's smoothed staircase. Outline and creases are unchanged: no crease
    across a smooth edge; creases on flats where the dihedral exceeds 20°.
- **Runtime,** in both `turn.mjs` and `turn-fixed.mjs`:
  - outline is the 2D hull of the projected vertices;
  - roles named like a prism's (`fill`, `face*`, `crease`, `edge`, `band*`);
  - `t3EmitPlanes` and `t3EmitDots` for hulls.
- **Audit shape `A.hull`:** distance (maximum plane distance inside, GJK outside), bounds, surface samples, screen box,
  and a ray cast by half-space clipping. Continuity's `snap()` and halving read the new roles.
- **Tools:**
  - a `hull` branch in `scripts/turn-check.mjs` `meshOf()` (fan-triangulated faces), so `--order` and the stowed
    visibility test see hulls;
  - hulls in `turn-bench`;
  - `--fidelity` for hulls: projected vertices, outline and visible faces against `k.iso` at P′(θ), ≤ 0.06 px.
- **Controls** (all must hold):
  1. A box built as a prism and as a hull emits the same outline and faces at 24 angles (≤ 0.06 px).
  2. A clipped frustum hull passes fidelity.
  3. A smooth 64-gon ring loft matches a `T.round` of the same radius: band boundaries within 0.5 px at 24 angles.
  4. Two interpenetrating hulls fail `separation`.
  5. **A hull hidden from `--order`'s mesh makes `--order` fail** (planted fault).
  6. The turning dial is unchanged.

**Patch 7: continuity births go through the halving test.** Control: a part that appears in one step still fails.

**Patch 8: the swap-area limit scales with contact length for flush pairs** (margin < 0.05):
`limit = max(0.5, 0.02 × contact length in px)` px². Control: two crossed parts that swap with a real overlap still fail.

**Patch 9: framed planes use every distinct relative pose** of the group pair in `poses()` (deduplicated at 1e-4,
capped at 256, uniformly thinned beyond). Controls:
- a hinge pair that bulges between its sampled extremes is framed correctly;
- the build time on the XL2 groups spike is logged.

**Patch 10: `kit/gl.mjs` `viewOf`** takes `uView` as a vec4 (scale x, y and offset x, y) for Inspect zoom. Covers and
scissors stay in viewBox units. Control: at zoom 1 every spike shot is identical.

**Patch 11: canvas painter.**
- An `effects[name]` function receives `drawBase()`, so it can draw the compiled part and then extra marks (spinning
  fallback fans, wheel hub marks).
- `vary` applies to a part's root class, so a whole part can fade (the cockpit fade-in).
- Control: a varied part's alpha changes with no recompile, and an effect's base drawing equals the compiled drawing.

### 8.7 Shared boundaries (model coordinates; every one an analytic function in `W`)

| Boundary | A ↔ B | Interface | Contact |
|---|---|---|---|
| Nose ↔ barrel | M2 `nose.f.*` ↔ M6 `fus.B1` | plane x 15.80, the S0 ring (K 1 at 14.0 onward), clipped as in `W.SHELL` | flush, same group (`nose.f.top` on cut.f ↔ `fus.B1` on pitch: 0.02 m gap) |
| Barrel ↔ tail | M6 `fus.B6` / UY ↔ M2 `tail.aft` | plane x 46.5, S0 | flush (crown on cut.up: 0.02 m gap) |
| Cut pieces ↔ their neighbours | M6, M2 | every face between a cut piece and a piece on another group | 0.02 m gap |
| Barrel ↔ fairing | M6 internal | `fus.*` bottom faces at z 4.40, \|y\| ≤ 3.202; the fairing top vertex is the belly-line vertex | flush |
| Barrel ↔ fillet | M6 ↔ M3 | S0 vertex line (±3.416, 5.05), x from the LE to the TE carried inboard, over B2, B3, B4 and B5 (B4 keeps the 5.05 line) | line |
| Wing ↔ fairing | M3 ↔ M6 | none: the fairing stays at \|y\| ≤ 4.35 and ≥ 0.10 m below the fillet's lower face | clear ≥ 0.05 m |
| LE gap ↔ pylon | M3 ↔ M4 | side planes y = ±(14.35, 15.25) and ±(25.25, 26.15); the LE profile `W.wingSection(y)`; the LE face plane | flush |
| Box bottom ↔ pylon | M3 ↔ M4 | `W.WING.bottomPlane(panel)`; outboard, one plane over 18.99–39.875, but the pylon is split at y 25.75 because the box parts are split there | flush |
| Pylon ↔ nacelle | M4 internal | `W.NACELLE[i]` tangent planes (fan cowl tilted 0.69°, aft cowl, core) | line |
| Wing ↔ WLG | M3 ↔ M5 | the well (§5.1); the fitting flush on the ceiling at the pintle | flush; else ≥ 0.05 m |
| Fairing ↔ WLG doors | M6 ↔ M5 | cheeks stop at 31.85 and resume at 35.30. Closed, M5's main door and fairing door strips reproduce `W.FAIRING.section(x)` facets, 0.02 m outboard | 0.02 m |
| Fairing ↔ BLG | M6 ↔ M5 | `W.BAYS.blg`; doors close the bottom | clear |
| Barrel ↔ BLG | M6 ↔ M5 | fitting pillars flush on `fus.B5`'s bottom (z 4.40, x ≥ 35.92) | flush |
| Nose ↔ NLG | M2 ↔ M5 | the bay ceiling (`nose.fdfloor` bottom, z 4.90, \|y\| ≤ 1.00); fitting at x 5.15–5.65; door hinges on the walls' bottom inner edges (y ±1.00) | flush |
| Doors ↔ skin | M6 ↔ M2, M6 | `W.facetFrame` on `W.partAt`; arms on one facet each | 0.02 m; arm tangent |
| Cabin ↔ floors | M7 ↔ M2, M6 | `W.CUT` floors and limits | flush (free group) |
| Cockpit ↔ canopy | M7 ↔ M2 | sync threshold cut.fd ≥ 14.5 units | – |
| Fin, tailplanes ↔ tail | M2 internal | `tail.cone`'s crown facet and main-belt facet | flush |

---

## 9. Roles and modules

Every brief below is meant to be workable on its own, together with `world.mjs`, the cookbooks and §5. Run long jobs
in the background (`nohup … > a380/tmp/<id>-<run>.txt 2>&1 &`). Set `CHROME_PATH=~/projects/anatomy/a380/tools/chrome`.
Read every PNG before judging it.

### S Scaffold (first; not a module)

- **Files:** `world.mjs`, `follow.mjs`, `build.mjs`, `live.js` (core), `a380.css`.
- **Also:** kit patches 6–11, truth amendments T1–T6, and seeding `gl/shaders.mjs` and `gl/runtime.js` from the
  spike.
- **Builds:**
  - Every §5.1 function and table: `kit`, `fit`, `S0`, rings, `SHELL`, `CUT`, `BAYS`, `FAIRING`, `WING` (stations,
    face lines, sections, bottom planes, the well), `NACELLE` tangent planes, `partAt`, `facetFrame`, `loft`,
    `stub(id)`, `KEY_STATES`.
  - The WLG solve, into `W.WLG_SOLVE`.
  - Groups `air`, `lift`, `pitch` and `cut.*` with their rules.
  - The harness, ctx and stubs (§8.3–8.4).
  - `live.js` core: substepped model, rates, history, seek (≤ 3 s), rewind, the tour bearing function, readout (both
    forms), aria rules, half rate, the `vary` writer for both painters, offscreen stop, reduced motion.
- **Acceptance:**
  - `--check` passes:
    - the mirror test, the fit (no extreme outside the pad at 5° steps over every `poses()` state), and the tour
      (peak ω ≤ 30°/s, no reversal);
    - every piece boundary in a window gap and outside every door leaf;
    - fairing clearances; the BLG and WLG stow feasibility; the WLG solve report; the sync-pose test (error < 1e-9
      at 50 states);
    - landing lights off within ±50 ft of 10,000 ft.
  - Patch controls 6–11 pass, and the turning dial is unchanged.
  - `--only=` with every module stubbed builds both pages; `--audit --quick --only=order,rigid,posed` reports no
    problems.
  - Drive runs: tour, seek and rewind (markings at pavement), pause, drag with inertia, keys, focus ring, aria
    silent in TOUR, reduced motion. The console is clean.

### I Integrator (in parallel with the modules on `live.js`, then integration)

- **Files:** the interaction layer of `live.js`, and `notes/AUDIT.md`.
- **Builds:**
  - the legend (three rows, chips, arming, aria-disabled with visible reasons);
  - the light panel (overrides into model targets, with AUTO rules kept);
  - the G, E, B, F, K, D actions;
  - Inspect (one view applier for canvas zoom, SVG viewBox and GL `uView`);
  - hover, tap and click picking from the projected hulls;
  - label display; the accent scheduler (§7.7); the compact readout and touch hint;
  - the live-region rules;
  - the 115% stage scale under 600 px (craft.md §6).
- **Integration:**
  - full builds and the §10 runs, with audits sharded across cores and one final full run (§10);
  - perf on real hardware if available;
  - captures and the caption check;
  - the final review at 4× and on the 390 px phone.

### M1 Stage

- **Files:** `parts/stage.mjs`, `gl/runway.mjs`, `gl/runway.js`.
- **Builds:**
  - the static plinth (r 42.5 m, ruler ring, ticks, label plate, bolt ring, halo);
  - the live platter (r 38.6 m, kit tones, bolt circle, lubber index);
  - the three marking sets as planes on the platter (§5.2), the shadow plane and the contact darkenings;
  - the CSS tokens for pavement, paint, shadow and set colours;
  - the runway-light program: lattices per set, streaks, set mix, platter window, both inks.
  `gl/runway.js` exports `drawRunway(state)`, which `live.js` calls.
- **Groups:** none (the platter is on `air`).
- **Boundaries:**
  - nothing above z 0 except the platter's own planes;
  - the plinth wholly below z −0.6 (horizontal-plane proof);
  - markings and runway lights windowed inside r 38.4 m.
- **Acceptance:**
  - Build proofs pass (plinth by horizontal plane).
  - Slowed sheets show no backward crawl: the runway at VR, a ×40 seek, the rewind, and taxi at half rate.
  - The set crossfade at TAXI and LINEUP has no pop.
  - The shadow, at rest, at lift-off and at 10,000 ft, reads as contact and then height in both themes.
  - The scroll speed matches the readout speed within 2% at take-off.
  - `lines.mjs` reports 0 line ends on the markings.
  - 4× crops: the ring, ticks, label plate, the platter rim with the markings, and the shadow edge.

### M2 Nose and tail

- **Files:** `parts/nose.mjs`, `parts/tail.mjs`.
- **Builds:**
  - the `W.SHELL` pieces it owns, as ring lofts:
    - `nose.radome`, `nose.canopy` (cut.fd), `nose.fdfloor`, `nose.baywall.{l,r}`, `nose.fwd`;
    - `nose.f.block`, `nose.f.wall.{l,r}`, `nose.f.top` (cut.f);
    - `tail.aft`, `tail.cone`, `tail.tip`;
  - cockpit panes (planes on the canopy), wipers, probes, the radome seam;
  - APU blade and exhaust, fin (2), dorsal fillet, rudders (2), tailplanes (4 plus tips), elevators (4);
  - housings for the tail nav light, tail strobe and logo lights, with their `ctx.light` registrations;
  - detail planes (wicks, spar fastener rows, hinge fairings);
  - the cockpit glTarget (panes);
  - labels; the `surfaces` and `cabin` accent planes; the Tail inspect view.
- **Groups:** `rudder.lo`, `rudder.up`, `elev.{l,r}.{in,out}`.
- **Boundaries:**
  - x 15.80 with M6 (S0, 0.02 m gap where groups differ);
  - x 46.5 with M6;
  - the NLG bay (`W.BAYS.nlg`: x 1.90–5.65, |y| ≤ 1.00, z ≤ 4.88, kept empty);
  - flight-deck floor 6.00 and canopy bottom 6.02 (the cockpit syncs at cut.fd ≥ 14.5);
  - bay F floor 5.15, walls 5.15–6.45, top ≥ 6.47;
  - tail strobe and nav light on the APU blade (T6).
- **Acceptance:**
  - `checks` prints the loft's top, bottom and width against `FUSELAGE.stations` at every station (exact at the
    rings; residuals listed).
  - Fin: root LE 53.94, chord 12.06, tip LE 68.02 at 24.06, tip chord 4.70. Tailplane: span 30.37, tip LE 68.85,
    chord 3.72.
  - Each pane lies on the canopy.
  - The rudder, elevator and cutaway clips are clean on `posed` and `order` against stubs.
  - The fin-root and tailplane-root gaps are ≤ 0.08 m.
  - Smooth shading on an orbit sheet at 2° steps: no staircase on the radome or tail tip.
  - 4× crops: radome, windscreen, nose bay walls, fin root, rudder, APU blade.

### M3 Wings

- **Files:** `parts/wings.mjs`.
- **First step:** a recipe spike in `a380/tmp/m3-spike.mjs` with one flap, its fore and aft canoe and the inner
  aileron, passing `--audit --quick --only=order,posed` at flaps 0, 8, 17, 26 and 33 and roll ±1.
- **Builds** (both sides, §5.4):
  - the fillet; box panels on the stations 4.45, 6.80, 12.45, 13.88, 18.99, 25.75 and 39.875, with `.1f`/`.1u`
    around the WLG well;
  - fixed LE and TE strips, droop noses, slats (T1 spans), flaps on tracks, ailerons, spoilers;
  - canoes split into fixed fore fairings and aft fairings that ride the flaps; canoe 6 whole at 25.77–25.97;
  - fence and tip light;
  - lens planes and the wing camera light;
  - light registrations: landing, wing taxi, nav, strobes, obstruction, wing camera;
  - wing glTargets for the scan wash;
  - detail planes (spar fastener rows, fairing ends, wicks);
  - labels; accents `slats`, `flaps`, `surfaces`.
- **Groups:** `wing.{s}.droop.*`, `.slat.*`, `.flap.*.track`, `.flap.*`, `.ail.*`, `.spl.*`.
- **Boundaries:**
  - the barrel line (±3.416, 5.05) for the fillet;
  - the root plane y ±4.45;
  - the pylon side planes y ±(14.35, 15.25, 25.25, 26.15), where the fixed gap strips end flush on M4's pylon;
  - LE and TE face lines and bottom planes from `W.WING`;
  - the well ceiling from `W`;
  - the fairing stays ≥ 0.05 m away;
  - devices 0.02 m off the box faces at rest; spoilers 0.02 m above the facet; spoiler 1 from 4.50.
- **Acceptance:**
  - Planform: LE and TE at every station within 0.10 m of `WING.le/te` (TE inside 11.5–12.45 within 0.10). Fence span
    79.75 ± 0.05.
  - The span report equals `CONTROLS` after T1.
  - No slat or droop nose overlaps a pylon's y range in any CONF.
  - The `flaps`, `controlCheck` and `speedbrake` clips are clean on `posed` and `order` against stubs.
  - The wing top is continuous over x 32–35 at y 4.45–6.80 (no well hole visible).
  - Smooth wing tops on an orbit sheet.
  - 4× crops: the LE with the slats out, a droop nose, a flap with its canoe at FULL showing the opened seam,
    spoilers at 50°, an aileron, the fence and tip lights.

### M4 Engines

- **Files:** `parts/engines.mjs`.
- **Builds** × 4 (§5.5):
  - lip, fan cowl, aft cowl, core and plug rounds;
  - pylon fwd, mid and aft hulls (the outboard aft split at y 25.75), and the chine;
  - the inlet fallback plane (disc, 24 spokes with N1 `vary`, spinner), spinning on the canvas page through patch 11;
  - the reverser seam and cascade-zone lines on engines 2 and 3, and the cowl hinge and latch planes;
  - the engine scan registrations, nacelle glTargets, labels (with N1 and "thrust reverser fitted, inboard engines
    only" on 2 and 3), the `eng1`–`eng4` accents, and the Engine 2 inspect view.
- **Groups:** none (all on `pitch`).
- **Boundaries:**
  - from `W.NACELLE[i]`: lip x 22.23 / 29.94, centreline z 3.005 / 3.84, y ±14.80 / ±25.70;
  - from `W.WING`: the LE profile, the LE face plane and the bottom planes, flush;
  - pylon side planes y = yc ± 0.45, flush with M3's gap strips;
  - nothing within 0.02 m of a slat, droop nose or flap in any state.
- **Acceptance:**
  - Checked against the model: inlet stations, centrelines, max diameter 3.88, length 8.39.
  - Ground clearance 1.065 / 1.90 m within 0.03.
  - Pylon visible depth above the cowl at the wing LE ≥ 0.5 m.
  - Line contact with the cowl along the tilted tangent plane (`checks` prints the gap ≤ 0.01).
  - The fan-direction sheet: clockwise on screen, nose-on.
  - `posed` clean in the `flaps` clip.
  - 4× crops: the pylon at the wing and the cowl, the inlet in GL and in fallback, the core and plug.

### M5 Gear

- **Files:** `parts/gear.mjs`.
- **Builds** (§5.6):
  - NLG: fitting, knuckle, upper leg, steering collar, **vertical lower leg**, torque link, axle, tyres, lamp bar,
    dragstay, fwd and aft doors;
  - WLG ×2: fitting at `W.WLG_SOLVE.pintle`, knuckle, leg, oleo, bogie, 4 tyres, sidestay, main door, the leg-mounted
    fairing door, and a hinged door if needed;
  - BLG ×2: pillar from `fus.B5`, knuckle, leg, oleo, bogie, steer knuckle, 6 tyres, dragstay, outer, inner and centre
    doors;
  - the 4-bar stay solves;
  - on-ground rotation rules (`rot`: BLG level plus oleo Δ(θ); WLG tilt plus oleo) and trim after lift-off;
  - hub-mark planes and their rotation (wheel phase; braking on gear-up except the BLG aft axle);
  - nose lamps (`ctx.lamp` with the down-lock gate), gear-bay pools, the NLG camera lights;
  - labels, the `gear` accent, and the Wing gear inspect view.
- **Groups:** everything under `nlg.*`, `wlg.*` and `blg.*` in §3.1.
- **Boundaries:**
  - axles at z 0.70 (main) and 0.635 (nose); tyres r 0.70 and 0.635;
  - `W.BAYS.{nlg,blg,wlg}` (stowed bogie centres: BLG z 2.90–3.05, WLG about y 2.6–3.1 and z 2.6–2.9);
  - `W.WLG_SOLVE`, which you verify against the real parts and report;
  - the WLG main door hinge y ±1.71; door strips reproduce `W.FAIRING.section` 0.02 m outboard when closed;
  - the BLG pillar on z 4.40 at x ≥ 35.92;
  - the NLG fitting on z 4.90 at x 5.15–5.65.
- **Acceptance:**
  - 22 tyres, with positions within 0.01 m of `GEAR`.
  - Every tyre's lowest point at 0 ± 0.05 units:
    - at rest;
    - over steer −70…70;
    - at every on-ground pitch (BLG all six; WLG until lift-off).
  - The stay closure error is ≤ 0.005 m.
  - `gearUp`, `gearDown`, `takeoff` and `steer` clips at 3 turns are clean on `posed`, `order` and `continuity`
    (against stubs, then in full).
  - The stowed visibility test shows 0 gear pixels.
  - Door timing follows `GEAR.timing` on a sheet.
  - 4× crops: each bogie, leg, stay and door, down and mid-transit.

### M6 Fuselage skin

- **Files:** `parts/fuselage.mjs` (the `fus.*` shell pieces), `parts/skin.mjs`.
- **Builds** (§5.7):
  - the barrel pieces, including the cut pieces on `cut.up` and `cut.md` and the B4 belly slabs;
  - 16 passenger doors with arms on one facet each, and 2 cargo doors; the bulk door outline;
  - doorways (`vary`);
  - 218 windows (`ctx.planeOn` on M2's and M6's parts);
  - the belly fairing (sections from `W.FAIRING`) and the keel liner;
  - crown blades, beacons R, L and lower, scan-lamp housings, flood and camera lenses (each on its host's group);
  - the surface detail table (production joints, lap joints, door surrounds, ports, the SATCOM outline, fairing panel
    lines);
  - window glTargets with constants (ring planes, section, stations, door gaps), beacon and scan registrations;
  - labels with `door:{ID}` actions; accents `doors` and `cabin`; the Door M2L inspect view.
- **Groups:** `door.{ID}.arm`, `door.{ID}` (16 each), `door.FWD`, `door.AFT`.
- **Boundaries:**
  - `W.SHELL` stations and clips, including floors 5.15 and 7.90 and cut planes 6.47 and 9.17;
  - x 15.80 and 46.5 with M2;
  - the fillet line (±3.416, 5.05) for M3;
  - the fairing within |y| ≤ 4.35, the cheek gap 31.85–35.30 for M5, and the BLG cheek plates 0.15 m thick around
    `W.BAYS.blg`;
  - door plates 0.02 m off the facet.
- **Acceptance:**
  - 218 windows at the model's stations, none inside a door opening, none crossing a part boundary.
  - Door stations, sills and leaves follow `DOORS` (plate heights per §11).
  - Each door parks 0.72 ± 0.03 m out, forward of its opening. Arm–facet tangency ≤ 0.01 units at 0, 60, 90 and
    120°.
  - The `doors` and `cutaway` clips are clean on `posed` and `order`.
  - The fairing bottom and width are within 0.05 m of `bellyFairing`.
  - A 4× tile grid over the fuselage at 3 bearings has a true feature in every tile.
  - 4× crops: each door type open and closed with its doorway, the cargo doors, both window belts at a part joint,
    the fillet–fairing junction, the cut-piece lap joints.

### M7 Cabin and flight deck

- **Files:** `parts/cabin.mjs`.
- **Builds** (§5.8):
  - free groups `cabin` (sync rule `cabin > 0`) and `cockpit` (sync at cut.fd ≥ 14.5, fade-in `vary` class `a3-fd`);
  - flight-deck interior per T3: floor 6.00, glareshield ≤ 6.82, panel with 8 display planes, pedestal, consoles,
    sidesticks, 2 pilot and 2 observer seats placing the eye at (2.92, ±0.53, 7.17), x ≥ 1.94;
  - F suites, J suites (U), main Y (M), upper Y (UY) at `sideRows` and `centreRows` with `layoutY`; carpets; the M4
    galley front;
  - class by tone and shape (no gold); the display-panel glTarget;
  - labels (class, layout, seats in this bay), the `cabin` accent, and the Cockpit, First, Upper deck and Main deck
    inspect views.
- **Groups:** `cabin`, `cockpit`.
- **Boundaries:** `W.CUT`. Every part lies ≥ 0.02 m below its bay's cut plane, inside its walls, and ≥ 0.02 m from
  the bay's end faces; the floors are flush.
- **Acceptance:**
  - The sync-pose test passes for both groups.
  - Parked cost ≤ 2% each (`--bench`).
  - Blocks within 0.02 m of the row stations.
  - `checks` prints the seats shown per bay (targets 4 / 22 / 66 / 80 / 28) and asserts the cut-plane clearances.
  - The `cutaway` clip at 3 turns and in the climb is clean on `posed` and `order`; the cockpit fade has no pop on a
    slowed sheet.
  - Inspect captures of the Cockpit (displays ≥ 10 px at 1440), First, Upper and Main, at 1440 and 390 in both
    themes.

### M8 Lights

- **Files:** `gl/shaders.mjs`, `gl/runtime.js`, `gl/passes.js`, `gl/mask.js`, `parts/lights.mjs`.
- **First step:** a spike on `spikes/gl` of the **ID mask** (hull upload, 2× target, 2×2 masked surface pass, 9-tap
  point visibility), compared with the old cover sets at 36 headings: the far inlet cut at the fuselage stroke, and
  ink ending outside every occluder's stroke. Also `glslFrustumPolygon` with the real S0 on one nose ring loft.
- **Builds:**
  - every §6 effect from the registry: the ground and air canvases (`drawGL()`, exported from `gl/passes.js` and
    called by `live.js`);
  - programs per kind, the platter window, beams and haze in dark only;
  - the daylight paper inks (neutral white rule; no beams, washes or logo wash on paper; pools only on pavement);
  - fallback billboards and planes as `vary` classes; context-loss handling; ink logging hooks.
- **Groups:** none.
- **Boundaries:**
  - registrations from every module (`ctx.light`, `ctx.lamp`, `ctx.glTarget`), with anchors through
    `controller.anchor` for sub-groups;
  - window constants from `W`;
  - the runway program belongs to M1.
- **Acceptance** (GL.md §12, on the A380):
  - dark and light orbits at taxi, take-off and a night climb;
  - slowed sheets of the strobes and beacons, the fan spool-up, the gear interlock fade, first light, the sector
    crossfades and the cockpit fade;
  - canvas edges read 0 in every phase and theme;
  - window ink monotonic through dimming; a per-frame ink log for every light on paper, and a human read of the light
    orbit at 1× and 4×;
  - `--no-webgl`, `--reduced` and context loss on **the shipping canvas page** and on the SVG page, both themes;
  - `turn-check --pops` with WebGL on;
  - a clean console;
  - program compile and link times logged.

---

## 10. Verification and acceptance

Set `export CHROME_PATH=~/projects/anatomy/a380/tools/chrome`. Run long jobs in the background, writing to
`a380/tmp/<id>-<run>.txt`, and poll. Read every PNG before judging it.

| Check | Command | Pass |
|---|---|---|
| Build | `node a380/build.mjs`, `--light`, `--verify`, `--verify --light` | no throw; parts within §5.11; `data.turn` ≤ 600 KB; page ≤ 2.5 MB; build ≤ 120 s |
| World and module checks | `node a380/build.mjs --check` | every assertion in §9 (S and M1–M8) |
| Kit audit | part of `--audit` | `audit passed` |
| Orbit audit, iterating | `--audit --quick --only=order,rigid,posed`, per module with `--only=<id>` against stubs | no problems |
| Orbit audit, sharded | `a380/tools/full-audit.sh -j 9 --out a380/tmp/full` (28 shards: per clip family and per orbit eighth, longest first; the kit audit in the `static` shard only; `--dry-run` prints the expected wall time) | `full audit gate passed`: every shard `passed` or `partial: no problems in what ran`, the kit audit passed in both passes, every line, clip and orbit turn in a shard |
| Orbit audit, final | `nohup node --max-old-space-size=16384 a380/build.mjs --audit > a380/tmp/i-audit-full.txt 2>&1 &`. **Budget about 3 h** (XL2 at 214 parts took 12.6 min with 46 depth states; this figure has about 1.8× the parts and about 5× the clip states) | ends `turn audit passed`. Any accepted line is recorded in `notes/AUDIT.md` with its halving or crop proof, and patches 7–8 have kept their controls failing |
| Fidelity | `node --max-old-space-size=24000 scripts/turn-check.mjs a380/build.mjs --fidelity --out=a380/tmp/fid.html` (the build is imported and writes its page; without `--out=` turn-check gives it one in the system temp folder) | prisms, rounds **and hulls** within tolerance |
| Order | `turn-check a380/a380-verify.html --order --step 1`, plus `--states` for take-off, gear, doors, cutaway, speed brake and the reachable hinge paths | 0 failing live pairs (hulls included) |
| Pops | `turn-check … --pops --no-webgl --step 1`, the reachable per-hinge paths, then again with WebGL on | 0 cores |
| Lines | `lines.mjs --edges` on the verify page and its light page; `drive.mjs <verify page> --actions a380/tools/drives/verify-lines.json` (the default view, every Inspect view and after Esc, with `edges`); `drive.mjs … '[["lines"]]'` at the gate (doors and cutaway open), taxi (CONF FULL) and the climb (gear up). `--edges` (fu/r2-verify) also checks the creases and open outlines against the painted result, counted apart | `line ends: 0` and `edge ends: 0` |
| Perf | `turn-check a380.html --perf --width 1440` and `--width 390 --throttle 4`; `--bench` (turn and the take-off, gear and flaps clips) | the §5.11 budgets, or a logged lever decision; real-hardware numbers with `RENDERER` before release |
| GL | M8's list in §9 | as listed |
| Captures | `capture.mjs` and `drive.mjs` on desktop and on the 390 px phone in both themes: the start and end of every phase at b = +45, −40, −130, 180, −260; **the longest readout string at 390**; every Inspect view at 1440 and 390; the 4× crops below | read and approved |
| 4× density grid | a tile grid at 4× over the whole figure at 3 bearings, both themes | every tile holds a true feature |
| Truth | the readout at each phase end equals `model-test.mjs` after T1–T6; every caption number matches | exact |

**4× crops** (both themes, at rest and in motion):
- radome, windscreen and wipers; the nose bay with its doors mid-transit;
- each door type open and closed, with its doorway; the cargo doors open;
- both window belts at a part joint;
- the cut-piece lap joints, closed and lifting;
- the fillet-to-fairing junction, front and rear;
- the wing LE with slats out, and a droop nose;
- a flap at FULL with its canoe seam, spoilers at 50°, an aileron;
- the fence and tip lights;
- a pylon at the wing and the cowl; the inlet in GL and in the fallback; the core and plug;
- the fin root, rudder, tailplane root, elevator and APU blade;
- every bogie, leg, stay and door, down and mid-retraction; the bogies during rotation;
- every cabin bay and the flight deck;
- the plinth's ring, ticks and label; the platter rim with each marking set; the shadow edge.

At each crop ask: is it instantly an A380? Is every region rich in true parts? Does every line end on something? Is
any face bare? Does any curved surface step?

---

## 11. Compromises and risks

**Where the kit cannot do what the reader would want, and what the figure does instead.**
1. **Smooth double curvature** (nose, tail, wing). These are ring lofts with smooth tone bands (patch 6).
   - If smooth mode fails its controls by the end of the scaffold, the lofts ship faceted. The reader would see tone
     steps on the radome, tail and wing tops: a known fault that the release notes must name.
   - Every interface stays the same.
2. **Gear bays are concave.** Each bay is a void enclosed by convex parts and open only underneath, where the camera
   never looks.
   - The WLG stows inboard through a well in the wing root, found by S's solve.
   - **Fallback 2,** if no clean solve exists: the WLG swings inboard to the largest clean angle at which it is
     invisible from every reachable view, and the doors close outboard of it. The figure says "gear up" only when no
     gear is visible.
3. **Not modelled:**
   - **Wing flex in flight**: [E], not requested, and it would split nine devices per wing.
   - **Thrust-reverser deployment.** In the kit's convex rigid parts, a translating cowl over a core interpenetrates
     the core when deployed, and any cascade band interpenetrates the cowl at rest. So engines 2 and 3 show the
     translating-cowl seam and cascade zone, and are labelled "thrust reverser fitted (inboard engines only)".
     The speed brake (B) shows the ground spoilers instead.
   - The pushback tug: it would touch the NLG on a free group needing its own clip proofs. The push reads from the
     moving stand markings and the readout.
   - The bulk door's inward swing; the plug doors' lift; the inlet scarf; the auxiliary WLG door; the body gear's
     2 s extension lag.
4. **Heights are compressed** above a few metres (`6·tanh(h/6)`), and the markings fade in flight. The true altitude
   is in the readout.
5. **Geometry tolerances [E]:**
   - The TE kink moves from 11.5 to 12.45 m (≤ 0.10 m).
   - The outer wing's bottom is one plane from 18.99 m (≤ 0.12 m at 25.75).
   - Root t/c is 0.12.
   - Canoe 6 sits 0.20 m inboard of its AC station.
   - The tail bottom is up to 0.34 m low at x 50–54. Homothetic rings are required there for planar door and root
     facets; the tail tip from 66 m is exact.
   - Door plates are 2.00 m (main) and 1.92 m (upper), against the true leaves of 2.13 and 2.11 m. Their arms must lie
     on one facet each.
   - Axles sit at the tyres' free radius, with the legs 5 cm and 3.5 cm short of a loaded oleo.
   - The nose is 5–9% narrow around the windshield (half-width 1.69 against 1.81 m at x 1.9, 1.86 against 2.04 at
     2.5) and its underside up to 0.25 m low just behind the radome (bottom 3.04 against 3.29 at x 1.9): the nose
     rings are homothetic with K matched to height, so the canopy and side panes sit on planar facets (review
     round 2, fidelity; affine rings with one Ky/Kz ratio would fix it but re-place every pane and the M2 loft).
6. **Seats:** the cutaway shows 196 of the 555 seats, in four bays (F, J upper, Y main, Y upper), plus the flight
   deck. The rest stay enclosed. The caption gives the true total.
7. **Lamp pools.** At their true aims, the landing, taxi and take-off lamps throw their pools 41–100 m from the
   turntable axis, beyond the platter. The figure shows them as lens glints, plus beams in dark. Pools appear only
   where a true cone meets the platter: the turn-off lamps' outer fringe, flood, camera and bay lights.
8. **Cockpit reveal.** The flight-deck furniture is taller than any convex wall the small nose section allows. So the
   cockpit group syncs only once the canopy has lifted clear, and fades in over 0.55 m of lift. This is a
   presentation device, like the cutaway itself.
9. **Wheel hubs on the canvas page** rotate through patch 11's effects. If 22 hubs cost more than 0.2 ms, they stay
   static on the shipping page (they still rotate on the SVG page), and this note stays.

**Risks.**
- **Patch 6 is large engine work** (hull, smooth loft bands, runtime ×2, audit shape, turn-check mesh, fidelity) on
  the critical path. Mitigation: S builds it first, with controls. Modules can start against faceted hulls, because
  the smooth mode changes only the shading.
- **The ID mask is new.** M8 spikes it first against the spike's cover sets. If it fails, fall back to cover sets
  scissored per window row band, logging `cover.dropped` per pass, with their cost (about 0.13 ms per target) in the
  JS budget.
- **The WLG solve** may find no clean path. Fallback 2 is defined.
- **Browser cost.** About 390 live parts is past KIT3D's headless SVG limit. Shipping relies on the canvas painter,
  half rate and the GL ID mask. Phones are unmeasured; `--lite` is the contingency.
- **`data.turn`** of about 500 KB (budget 600 KB). Patch 9 adds framed-plane work, and its build time is unmeasured.
- **The final audit takes about 3 h.** Patches 7–9 change the audit, so their controls must keep failing on planted
  faults; otherwise a pass means nothing.
- **Truth amendment T1** depends on a re-scan of AC p035. If the scan disagrees with the critic's reading, S records
  the measured spans, and M3 and M4 take them from the model.
- **Shared `a380/tmp`:** prefixed files only, and no cleaning.

---

## 12. Review log

Severity: **B** blocker, **Ma** major, **mi** minor. Critics: **F** feasibility, **T** fidelity (truth), **C** craft.
Each row gives the finding, its resolution and where it lives.

| # | Critic, sev. | Finding | Resolution |
|---|---|---|---|
| F1 | F, B | Bend joints cut nine devices per wing; joint 1 needs 3.7° | **Dropped the wing bend** (§0.8, §11.3). It is [E], was not requested, and costs about 24 groups plus split devices. Moving the joints to common break stations does not work: only one station breaks every row (y 12.46), and a credible bend needs three joints. This also removes the climb-frame cost of moving wing groups (F22) |
| F2 | F, B | Flaps cannot ride over canoes that extend under them; the spike failed exactly this | Canoes are split: fixed fore fairings end 0.02 m ahead of the TE face plane, and aft fairings hang flush under the flap on the flap's hinge group, opening a seam (§5.4). Canoe 6 moved inside the fixed TE gap. M3 must first pass a one-flap spike (`order,posed`) at five flap angles (§9 M3) |
| F3 | F, Ma | Tyres sunk 0.5 and 0.35 units | Option (b), without lifting the airframe: axles at the free radius (0.70 and 0.635), true tyres, airframe at the AC heights, and the pivot at z 0.70 (§2). Tangency is true by construction |
| F4 | F, Ma | NLG steer about the raked leg drives a tyre into the platter | The steering axis is vertical through the axle centre; the lower leg below the collar is vertical. The tyre-height check covers steer −70…70 (§5.6, §9 M5) |
| F5 | F, Ma | WLG well ceiling above the upper skin | The ceiling is a plane 0.15 m below the local upper skin, computed by S; the pintle search stays below it. `box.1u` keeps the skin closed, and a check confirms it (§5.1, §9 M3) |
| F6 | F, Ma | BLG bay box contradicts the fairing section | The fairing section is redefined fuller (6 vertices) and `W.BAYS` are convex polyhedra derived from it. Measured: BLG bogie centre z 2.90–3.05, WLG centre y 2.55–3.15 and z 2.60–2.90 (§5.1). M5 and M6 assert against the same function |
| F7 | F, Ma | Interior synced while still inside closed shells | Cut planes sit above the interior (F, M at 6.47; U, UY at 9.17), on single-facet walls. The flight deck syncs only when the canopy is clear, then fades in (§5.1 `W.CUT`, §5.8, §11.8). Asserted by M7 |
| F8 | F, Ma | Fin leaves the viewBox in CLIMB (28.47 m) | `W.fit()` uses the real trajectory extremes. ViewBox 960 × 680 with k 0.960 (plinth at 85% width, with C12), and a `--check` over every `poses()` state (§2) |
| F9 | F, Ma | Forward lamp pools land off the platter | Accepted as true geometry, without re-aiming the lamps: that would falsify the AC beams. Every ground term is windowed to the platter. Forward lamps show as lens glints, plus beams in dark windowed inside the plinth (§6.2, §11.7). A static apron ring was rejected: it would break the display-model reading |
| F10 | F, Ma | 8×12 covers too few, and the cover JS is unbudgeted | Replaced by the **GPU order-index mask** with per-kind programs. No covers and no CPU walks; the air programs fall to about 70 vectors each. M8 spikes it first, and the fallback is defined in §11 (§6.1) |
| F11 | F, Ma | Canvas painter freezes or drops the GL fallbacks | Every fallback is a `vary` class; the canvas painter mounts after GL init; context loss is handled; checks run on the shipping canvas page (§6.3, §4) |
| F12 | F, Ma | Modules circular and not isolable | Every shared shape is analytic in `world.mjs` (`SHELL`, `WING`, `FAIRING`, `BAYS`, `NACELLE`, `CUT`). The WLG solve runs in S. Planes on others' parts go through `ctx.planeOn`. Stubs exist for `--only`. The DAG is published (§8.2–8.4) |
| F13 | F, Ma | T.hull spec misses the tools and the plane emission | Patch 6 now covers the `turn-check` mesh, turn-bench, planes and dots in both runtimes, prism-compatible roles, hull fidelity and a planted `--order` fault. Panes, wicks and panel lines use `T.plane` / `ctx.planeOn`, not `details.rules` (§8.6) |
| F14 | F, Ma | Full audit far longer than 40–70 min | Clips are sampled at the page's step, iteration is sharded per clip and orbit quarter, and the final run uses a 16 GB heap. **Budget about 3 h**, with times recorded in `notes/AUDIT.md` (§3.5, §10) |
| F15 | F, mi | Key states hold only extremes | Mid states are added (doors 0.5 and 0.75, CONF 1+F, 2 and 3, half roll, pitch and yaw, steer ±35), plus **kit patch 9**: framed planes from every distinct relative pose (§3.4, §8.6) |
| F16 | F, mi | Upper beacons and crown blades on `pitch` under lifting pieces | The beacons ride `cut.up`, and each blade rides its host's group. Harness rule 6 enforces this (§5.7, §8.4) |
| F17 | F, mi | Spoiler 1 over the fillet; flight deck in solid lofts; nav and strobe slips | Spoiler 1 starts at 4.50; the flight deck is at x ≥ 1.94 on its own floor; the nav light is on top of the blade and the strobe under it (T6); assertions added (§5.3, §5.4, §5.8) |
| F18 | F, mi | Pylon contact specified two ways | One definition everywhere: `W.NACELLE` tangent planes, the fan cowl's tilted 0.69° (§5.1, §5.5, §8.7) |
| F19 | F, mi | Seek too slow, and big steps change the trajectory | Fixed substeps ≤ 1/30 s at every rate; seek rate = remaining model time / 3 s (§7.1) |
| F20 | F, mi | U-door arms land on a third facet | Each arm lies wholly on one facet, with its axis on that facet's up vector. U plates run 7.91–9.83 and their arms 9.84–9.89 on the upper top. A tangency check at 0, 60, 90 and 120° (§5.7) |
| F21 | F, mi | Pitch range 0…13 exceeds the drawn tail strike at lift 0 | Range [0, 12.5]. The verify pitch paths are generated from reachable states, with lift from the trajectory (§3.1, §8.3) |
| F22 | F, mi | Bench covers only a pure turn | `--bench` also times the `takeoff`, `gearUp` and `flaps` clips; there is no bend (§8.3, §5.11) |
| F23 | F, mi | One giant air program; frustum windows unproven | Programs split per kind; `glslFrustumPolygon` is spiked with the real S0 before the build; compile and link times are logged (§6.1, §9 M8) |
| T1 | T, B | Pylons are slivers; LE gaps miss the pylons | Truth amendment T1: re-scan the LE devices so the gaps straddle the pylons. The pylon is redefined as fwd, mid and aft hulls rising into the LE profile, ≥ 0.9 m deep at the LE. The gap strips end flush on the pylon's side planes. Checks: depth ≥ 0.5 m, and no device overlapping a pylon's y range (§5.1, §5.5, §8.5) |
| T2 | T, Ma | Landing lights go off at 3,208 ft | T2: the model switches them off when height ≥ 10,000 ft, and FL100 holds 3 s after. The caption is reworded, including "gear up is selected 2 s after positive climb and retracts in 16 s" (§1, §8.5) |
| T3 | T, Ma | No stays, wrong WLG doors, no BLG centre door | Two-link stays on all five legs from a 4-bar solve; the AC's leg-mounted fairing door (and a hinged door if visible) replaces the invented cheek door; the BLG centre door is added (§5.6) |
| T4 | T, Ma | Rigid rotation lifts the bogies off the runway | The `rot` channel. BLG: the bogie stays level and the oleo extends by Δ(θ). WLG: tilt plus up to 0.6 m of oleo until lift-off. Checks on every on-ground pitch (§3.3, §5.6) |
| T5 | T, Ma | Flight-deck floor too high; impossible eye point | Floor at 6.00 (the model's value). T3: the eye at (2.92, ±0.53, 7.17) and the sliding window forward. The panel is about 0.7 m ahead of the eye, the glareshield ≤ 6.82 (§5.8, §8.5) |
| T6 | T, Ma | Only 26% of seats; F and upper Y never shown; staggered rows ignored | Five bays: FD, F (new cut piece `nose.f.top` on `cut.f`), U, M and UY (new), at true `sideRows` and `centreRows`. The U/M boundary moved to 35.9. Shown: 4 + 22 + 66 + 80 + 28 (§5.1, §5.8) |
| T7 | T, Ma | Reversers and ground spoilers never move | **Partly declined.** Ground spoilers now deploy with the speed brake (B), all 8 at 50° on the ground and 2–8 at 30° in flight. Reverser deployment cannot be drawn with convex rigid parts (§11.3), so the inboard reversers are shown as their seams and cascade zone and named in the labels |
| T8 | T, mi | 18 windows straddle part boundaries | Boundaries moved into window gaps (8.90, 15.80, 23.5, 35.9, 43.5, 52.25). `--check` asserts no window or door crosses a boundary (§5.1) |
| T9 | T, mi | Homothetic tail wrong at both ends; blade misfit | The tail tip from 66 m uses exact anisotropic rings, and the blade fits the end face (checked). The 50–54 m bottom stays up to 0.34 m low, because doors and roots need homothetic facets (§5.1, §11.5). A fully anisotropic tail was declined: it would twist the U3, cargo, M5 and tailplane-root facets |
| T10 | T, mi | Flaps lever cycles a non-existent 1+F | Lever 0 / 1 / 2 / 3 / FULL; lever 1 gives 1+F on the ground and below 205 kt (§7.3) |
| T11 | T, mi | Fan direction unspecified in a mirror projection | Clockwise as seen from the front, with a sheet check on all four engines (§5.5, §6.2) |
| T12 | T, mi | Wheels never turn | Hub-mark planes rotate with ground speed; every wheel stops on gear-up except the BLG aft axle (§7.5). On the canvas page through patch 11, with a cost guard (§11.9) |
| T13 | T, mi | Gate, push and taxi drawn on a runway | Three phase-keyed marking sets with their own light colours: stand, taxiway (green and blue), runway (§5.2) |
| T14 | T, mi | Body-gear lag claimed but absent; plates short | The lag claim is dropped (not drawn, §11.3). The plate heights are recorded as [E] (§11.5) |
| C1 | C, B | Cockpit and seats illegible; no way to look closer | **Inspect** views: zoom 3–10× applied to every layer (canvas zoom, SVG viewBox, GL `uView`, patch 10), with the cutaway, bearing, detail 1 and full rate. Cockpit displays ≥ 10 px at 1440. Captured at 1440 and 390 (§7.4) |
| C2 | C, Ma | Lights, gear and engines not operable; nothing responds on the aircraft | The light panel (overrides into model targets with AUTO kept); the gear lever G (in flight), engines E, speed brake B; hover and tap labels; click actions per part (§1, §7.2–7.3, §5.10) |
| C3 | C, Ma | The readout overflows at 390; the hint is wrong for touch | A compact readout of ≤ 40 characters below 600 px; a touch hint; a 115% stage scale under 600 px; phone captures of the longest readout (§1, §9 I, §10) |
| C4 | C, Ma | Runway scroll races and aliases | Speed-aware markings: SVG contrast fades and the GL lattices streak analytically as the per-frame displacement grows; markings go to pavement during seek and rewind; the scroll is written every frame even at half rate (§5.2, §7.5) |
| C5 | C, Ma | The tour rocks back and forth at 200°/s | `tourBearing(t)`: monotone, one turn per loop, smootherstep holds, peak 29.5°/s, no reversals; the cutaway is held 6 s at a cabin bearing (§7.6) |
| C6 | C, Ma | Light theme stains and false colours | The daylight rule: lens glints; no beams, haze, strobe or beacon washes or logo wash on paper; pools only on pavement at a lower cap; a neutral rule for white lights (strobes no longer blue); window tint capped; ink logs and a human read (§6.2) |
| C7 | C, Ma | A static accent cannot direct the eye | A phase-accent channel: lit edge planes per family via `vary`, one family at a time, scheduled by phase. The lips are no longer `lit` (§5.10, §7.7) |
| C8 | C, Ma | No shadow or halo under the aircraft | A turning blurred planform shadow on the platter, driven by lift and pitch, plus contact darkenings under the tyres (§5.2, §7.5) |
| C9 | C, Ma | Parked on a runway; a blank slab | Phase-keyed stand, taxiway and runway sets with slab joints, rubber streaks, the threshold and touchdown zone (§5.2). A continuous ground-distance strip was rejected: the straight push followed by taxiing forward would re-cross the stand |
| C10 | C, Ma | Bare faces at 4× | A per-surface detail table in each module (wings, barrel, fin, tailplanes, nacelles), and a 4× tile-grid check (§5.3–5.7, §10) |
| C11 | C, Ma | Faceted lofts shade as a staircase | Patch 6's smooth ring-loft mode, with a control against `T.round` (≤ 0.5 px), on every fuselage, nose, tail and wing loft. The "facets read as panel joints" claim is withdrawn (§8.6, §11.1) |
| C12 | C, Ma | Caption roll 2.66 km is from the gate | T4: roll 2.1 km from brake release. The caption explains 562 t ramp against 510 t take-off (§1, §8.5) |
| C13 | C, Ma | The live region chatters during the tour | Written only in HOLD or under focus; short phase lines; full text on focus (§7.8) |
| C14 | C, mi | The plinth fills 92% of the width | Plinth r 42.5 m, spanning 85% of the width; the swept aircraft at 83%. A turntable figure cannot reach 55–65% without shrinking the subject under legibility; the turning-dial reference sits at about 83% (§2) |
| C15 | C, mi | Platter in a material; gold seats compete | Platter in kit tones; cabin classes by tone and shape, no gold; warm material only for the accent (§2, §5.8) |
| C16 | C, mi | Disabled buttons with `title` | Arming for D and K; `aria-disabled` with visible reasons otherwise (§1) |
| C17 | C, mi | Seek takes 9–13 s | Total seek ≤ 3 s (§7.1) |
| C18 | C, mi | "pushback 0 kt"; cryptic hint | T5 rounds before the branch; new hint strings (§1, §8.5) |
| C19 | C, mi | No tug; the nose steers while the ground scrolls | The push steer clip is dropped, and steering works only below 0.5 kt. **The tug is declined** (§11.3): a free group touching the NLG needs its own proofs, and the push reads clearly without it |

### Review round 1 (as built)

Six critics (craft dark and light, interaction, WebGL, fidelity, audits) reviewed the integrated figure; the fixes
are in `notes/STATUS.md` and the commit "Fix review round 1". Deviations from this design that they introduced:
- §0.5, §5.1: `T.hull` smooth faces shade in 13 sub-bands along a continuous ramp, and pieces of one skin meet at
  faint (mid round the cutaway) joint seams instead of outlines (kit patch 15). Rounds keep five bands.
- §5.2: the platter is two smooth hulls (its drum seam a joint), and an airborne land and cloud layer scrolls with the
  ground distance / 100 and / 160, fading in with height.
- §5.3: the tail tip loft runs to the model's tail-cone end (70.4 m) and carries a 6 cm bevel with the APU exhaust;
  T6's tail lights sit on the loft. The radome has ten rings and a full-resolution tip; the windscreen is draped on
  the canopy's planar facets over one mask.
- §5.4: track fairings 0.08 × chord wide and 0.085 deep, their aft part 28% of the flap chord past its TE.
- §5.7: open doorways draw the cabin beyond (ceiling, galley face, carpet) and 0.2 m jambs and sill as planes.
- §6.2: point lights have a screen-space floor; beams run their true reach (edgeFade stops them); the beacon holds
  (LED); wing strobes are seen from ahead and astern; paper windows sit on a pale glass token; daylight pools cap .06.
- §7.1–7.6: dt clamps at 0.25 s; the driver eases the display rate; seeks drop conflicting settings and run on wall
  time; HOLD levels off in the air; the idle resume (30 s, §7.2 corrected) and Esc share one clean resume.
- §7.4: Cockpit view at b +125, 14×, the lifted canopy faded; a Body gear view at b −150; the gear views fade the parts
  in front (kit patch 16).

### Review round 2 (as built)

Six critics (craft dark and light, interaction, WebGL, fidelity, audits) reviewed the figure again; the fixes are in
`notes/STATUS.md` and the commit "Fix review round 2". Deviations from this design that they introduced:
- §0.5, §5.5, kit patch 17: a round built with `{ bands: 13 }` shades in the hulls' 13 sub-bands; the nacelle rows use
  it (five bands read as a staircase down each cowl). `turn-fidelity`'s rounds check compares such a round against an
  analytic z-buffer of the true cone banded on the 13 thresholds.
- §1, §7.3: G on the ground shows the main gear at 1x (the turntable turns to b −140 and the port fairing, body-gear
  doors and inner flap fade to 20%); in flight it is the gear lever. E and engine clicks are refused on the take-off
  roll above 30 kt; with the engines off on the roll the aircraft brakes to a stop. D past the stand arms a rewind to
  the stand (the phase label never changes without the aircraft being there). Under reduced motion K shows the
  control check as three stills, one per press.
- §1, §7.8: the readout corner shows a part's short label (≤ 40 characters, the part and its state); the full label
  goes to the tip line and the live region, and the hint hides while a label shows. Refusals are said to the live
  region; legend buttons are described by the tip line.
- §5.2: the cloud deck is layered cumulus (cast shadow, underside, body, lit crown) at 15–30 m; the country stays
  faint under it. Tyre contacts are radial gradients inside the footprint; nose-wheel scrub marks are tapered bands
  on 20–30 m arcs tangent to the lead-in at their own stations.
- §5.3: the radome is one smooth surface (no creases across the belt corners); the diverter strips stop 0.45 m short
  of the tip; the windshields reach 0.05 m of the crown line (a 0.1 m post) and the pane edges take the mask's token.
- §5.4: spoiler outlines are mid gap lines; spoilers 1–2 ride `spoiler1` (35° on the ground), 3–8 roll (35° in the
  control check [E]; the source's limit is 45°); the key states hold `spoiler1` at 0, 17.5, 30, 35 and 50 (spoilers 1
  and 2 turn on their own hinge lines, and the framed planes come from the key states, §3.4); the fence's leading
  edges are chamfered.
- §5.5: the pylon's forward fairing tapers to a point on the cowl crest (side walls set back to s 2.2).
- §5.6: braked wheels carry brake stacks (on the inboard face and between hub and rim), the main legs torque links.
- §5.7: a door's or cargo door's strips meet at faint joints (one outline per door).
- §5.8: F suites have constant 1.13 m walls with a rounded front and an aisle-side opening; J backrests recline 26° into
  a 1.04 m shell; carpets carry seat tracks; dark cabin tokens are warm greys; an overhead panel is shown face up over
  the deck. Main-deck Y triples at ±1.83/2.35/2.87 (aisles 0.50 m). The Cockpit view is from b 168 at 12×, centred
  on (2.6, 0, 6.6), with the canopy, nose.fwd, the M1 doors and the lifted First crown faded.
- §6.2: every ground-lit term fades with the true height (1 − smooth(15 m, 60 m, h)); the beacon envelope is the
  model's (LED hold); nav sectors overlap 5° past dead ahead; under reduced motion strobes hold at 0.25 (no swell)
  and the beacon's ground wash at 0.1; beams are integrated analytically (no jitter); the dark page draws a faint
  off-platter wash where a beam lamp's cone meets the ground (fading 40 px inside the card frame); the cabin dimmer
  goes through one displayed-luminance curve (cabin^0.66) on both painters; the logo wash shows by daylight (tint cap
  .18); the light inlet separates a darker fan face from a lighter wall; the ID mask's growth is constant on screen.
- §7.1, §7.6: explicit-rate advances check phaseDone after every model substep; seek and rewind clocks count only
  running time (each frame whole up to 1 s, so a seek still lands in about 3 s at 1–4 fps; a sleeping loop restarts
  its clock); the 30 s idle timer runs from the moment the held phase settles (a pause resumes regardless); the
  oldest gate history entry is pinned; FL100 completes at 10,000 ft exactly.
- §3.4: `poses()` samples every reachable state: their count (525) was a multiple of the index stride 7, so only 75
  ever reached it; the list is now kept prime to 7. The framed planes still come from the 24 key states only (kit
  patch 9 is not done), so the key states now carry spoilers 1–2 mid-travel (the quick audit found the pair
  unseparated in the speed brake clip with only 0 and 50 sampled).
- §7.5: the deck hook (marking-set mix, stripe fades) runs on the page's dt; its own 1/30 s clamp made the sets settle
  ten times slower than the page at 3 fps (a rewind to the stand showed the runway's markings for seconds).
- §8.3: `--verify` writes `tmp/states-hinge-<clip>.json`, each clip's six largest frame steps interpolated so no hinge
  or slide moves more than 0.02 per state.

### Review round 3 (as built)

Six critics (craft dark and light, interaction, WebGL, fidelity, audits) reviewed the figure a third time; the fixes
are in `notes/STATUS.md` and the commit "Fix review round 3". Deviations from this design that they introduced:
- §2, §7.4: the composition eases the view window 30 px down while the aircraft is on the ground (the figure rises in
  the card) and back as it lifts (the fit keeps the climb's nose-on fin tip for headroom); not on the SVG verify page.
  `W.fit()` no longer reserves the unreachable 12.5° pitch at 6 m of lift.
- §5.4: the wing box panels' LE and TE faces, the slats' and droops' aft faces and the fixed surfaces' faces at the
  rudders and elevators are mid joints (kit patch 15); flaps, ailerons, canoes, fixed TE strips, rudders and elevators
  have mid outlines. Canoe 6 stays 0.20 m wide (the fixed TE gap between the outer flap and the aileron, whose travel
  it clears) but is a blunt pod: deeper, ending 28% of the chord past the TE, its last ring 0.8 wide and 0.7 deep.
- §5.5: the inlet lips' chrome ramp is monotonic and close (the kit's chrome jumps 133 levels between two tones).
- §5.6: each BLG outer door is two thin leaves in its hinge group (the facet leaf and the bottom leaf, mitred on a
  straight bend). It stays leg-linked (open 99° with the gear down): its swing would cross the extended tyres; truth.md
  §9 and the label record it, with the NLG forward door's 75° (62° on the aircraft).
- §5.7: the doors accent draws one outline per door (each strip leaves out the edge it shares with its neighbour);
  the doorway jambs and sill take the doorway facet's facing as well as their own; door portholes carry a pale core.
- §5.8: the flight deck has no overhead slab or posts: the Cockpit view shows the overhead panel's layout as a framed
  inset with its EXT LT switches live. Pilot and observer seats are a pedestal, a seat pan, the back and (pilots) a
  headrest; the side consoles carry the OIT screen and the pull-out keyboard table; a rear bulkhead with the flight-deck
  door and two stowage blocks rides a new free group `cockpit.aft`, synced at cut.fd 24 (it stands to 8.39 m) and faded
  in over 24-30. The Cockpit view is centred at (2.75, 0, 6.85) at 13x. Economy seats are two parts (pan and back),
  business shells rise steeply into a rounded hood. The faded pieces go to 5% (Cockpit) and 10% (gear views); a part
  under half its fade alpha is neither picked, outlined nor clicked.
- §5.8, webgl.md 8.3: the cabin dimmer reaches the interior: the cavity faces mix toward a warm dark by
  (1 − cabin^.66) × 50% (35% by daylight); the canvas painter re-bakes the cabin parts (kit patch 18).
- §6.2: no ground term lies beyond the platter (the off-platter beam wash is gone; the beams' haze still runs past
  the rim). Windows dim in energy before the tonemap (the hue holds), share one blinds set with the fallback
  (`W.windowBlind`), vary 10% per window, and stop at their piece's joints; the fallback stacks the 40% light colour
  under the gate colour. The logo wash by daylight is a multiply-like warm tint, tonemapped; its fallback comes from
  the same lamp law sampled in Node. The spinner is half an ellipsoid; a once-per-rev blade mark shows the spool-up.
  Coloured point lights keep their hue (at most 30% toward white); a lens is masked against the part that carries it.
  The threshold bar's fallback has a red and a green face crossfaded by the bearing. No halo discs on daylight
  fallbacks; daylight runway pavement tint cap .05. The EWD shows four N1 dials. M8 envelopes run on the page's dt and
  stand still while paused. A restored WebGL context is rebuilt.
- §7: B is refused on the take-off roll and during a seek, and the ground spoilers retract at lift-off; light buttons
  show the lit state with the switch position (the model now moves the crew's switches: beacon on once cleared to push,
  nose and turn-off off after flap retraction, landing off passing 10,000 ft; a reader's setting is theirs); Nav and
  Logo are separate (Logo Auto/On/Off), in the EXT LT panel's order; E at the stand with doors open closes them first,
  D is refused with engines turning; a held airborne phase is pinned at its exact end state; a settled hold adds no
  history and a full history thins its older half; Esc during a seek stops it; the gate resumes its own dwell; reduced
  motion's gear jump waits for the gear's end stage and a refused input steps nothing; the aileron droop follows the
  configuration; Inspect has a Back button and touch wording; phase tips are written for readers.
- §10: `--verify`'s hinge paths keep every step ≤ 0.02 and separate their segments with nulls; the pops check's second
  difference ignores pixels within 2 px of an edge; a `cutawayDoors` audit clip combines open doors with the cutaway.

### Follow-up fix round 1 (as built)

Follow-up review round 1 filed findings against the eight follow-up packages; their fixes were merged on 2026-10-10
(`notes/STATUS.md`, `notes/followup/r1-<id>.md`). Deviations from this design that they introduced:
- §5.4: each wingtip fence carries a top obstruction-light housing (a 0.12 m chrome dome on its top face, overhanging
  the fence's inboard face by 0.04 m; +2 parts), so the light's halo sorts above the tip. The box panels shade flat to
  8°. The root trailing edge over the gear recess is one shroud (faint splits, a mid front), its well walls cavity
  faces.
- §5.5: `pylon.fwd` is a thirteen-ring half-ellipse loft; the fillets start flush with the fairing's side walls and
  flare to 0.50 m by s 2.6. At Inspect zoom the inlet lip's overlay shades across the lip's section (a deep stop at the
  throat, a narrow glint; `--a3-lip-deep`, `--a3-lip-glint`); the phase accent is one ring at the throat; the lip's rim
  crease is faint. By daylight the no-WebGL inlet inks match the GL program within 5 levels; the fallback blades are
  shaded wedges.
- §5.6: the Wing gear and Body gear views and G's gear view cut the near fairing, its gear doors and strips and the
  inner flap away (opacity 0), not to 10%; the WLG main door and fairing-door strips fade with the fairing they close.
  The wheel-well detail is drawn in well tones (at most about 90 lum in dark), fading with its depth into the bay.
- §5.7: open doorways follow the cabin dimmer in both painters (an overlay in `--a3-cab-dim` at the cabin's share);
  the cargo hinge rings are rounded to the packed precision; the fairing cheeks shade flat (flatAngle 4); the bulk
  cargo door is a pick region (three plates at alpha 0) with its label and action; pitots are raked struts with
  forward tubes and the AoA vanes thin blades. The aft fuselage stays homothetic and is drawn 4.5–8.5% narrow between
  x 50 and 56 m (T9; `truth.md` §4).
- §5.8: the overhead bins stand at their true height (aisle face 1.60–2.10 m over the deck [E], 0.50 m deep) on four
  free groups (`cabin.{f,u,m,uy}.bins`), synced once the bay's crown is 0.062 m clear and faded in; the row whose
  outboard face turns toward the reader fades out (normal · view 0.2 → 0.6). Window reveals are planes on every cut
  wall. The Cockpit view is centred at (3.05, 0, 6.82) at 30x and its faded shells go to 0; `cockpit.mat` is a carpet;
  the seat backs, headrests and pedestals carry their aft-face detail. The Deck plan carries only its deck names; its
  counts and key are a card-corner inset; every block, monument and door is a pick region (`A3.pickPlan`). On phones
  the overhead inset shows only its EXT LT row.
- §6.2–6.3 (lights): by daylight the fallback windows draw a pale core and a warm rim at Inspect zoom (`pv.winCore`);
  the GL doorway openings are cut in (x, arc length) as the skin cuts them; M8 draws every fallback lens (three
  copies for the GL pixel size, crossfaded), the lamp pools, the beacon pool and strobe washes as level-set bands
  sampled from the shaders' laws, and each beam as a banded shaft (an approximation; no heat-haze fallback). The
  threshold bar's faces have separate lobes and go dark side-on. The lower beacon's pool law is k·√cosθ/(d²+16), 0 at
  12–22 m. The GL runway window ends at r 38.0 m; the platter drum is 1.5 cm inside the rim; lens halos fade toward
  the card's frame, more at Inspect zoom.
- §5.11, §7.9 (perf): a settled page sleeps with the cutaway open (pose values compared by value; the cutaway snaps at
  0.004 of its travel); the loop also stays awake while the cabin dimmer eases (merge fix). The hub turn mark fades
  out past 20–30° a frame and stowed hubs stand still. On the canvas page the SVG layers zoom by a CSS transform (the
  verify page keeps viewBox writes); the canvas ratio at rest follows the device up to 4. Kit patches 30 (camera snap
  near axis-aligned turns), 31 (a view without a paint or a layout, hub rects, a mount in tasks) and 32 (moved copies of
  hulls) are in `notes/kit-patches.md`, with the set-plane floor (fuselage), the `t3HullOf` x ties (wings) and the
  `t3Strip` chord count (gear).
- §7 (interaction): the tour loop is 128 s; the gear's transit and a reader's in-flight flaps play at ×2.5; the flaps
  lever is a model state (a crew retraction waits for S speed); a phase entered by a seek takes its phase state at once;
  a pause holds until the next Space and freezes seeks and rewinds; held keys repeat only for ← / → and [ / ]; light
  chips show the switch position in a fixed width, the qualifier moving to the tip and the description; a view change
  zooms out to 1× or 2×, turns, then zooms in; the composition balances the airframe's projected top against the
  plinth; forward seeks are paced by the picture, rewinds interpolate; steering holds its angle; the wing-root taxi
  lights stay on with NOSE while the nose-strut lamp follows the gear. The tug is a low chassis with a cab placed from
  TLD's description [E], its forward 0.4 m fading out, no mudguards (painter's order).
- §10 (verify): a path's turn is a step for the pops check; paths bound the turntable and free groups to 0.02 a state
  and carry their clip's vary alphas; `push` is in the audit shards (oC); `turn-check --perf` waits for WebGL and turns
  through the page (`A3.tick`); the line-end gate is the verify pages.
