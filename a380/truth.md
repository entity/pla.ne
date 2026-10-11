# Airbus A380-800: truth sheet

Every number the figure shows, and every size and motion it draws, comes from `a380/model.mjs`. This sheet
says where each one comes from. Confidence tags:

- **S** sourced: read from the document cited (primary unless marked *secondary*).
- **D** derived: computed from sourced numbers, or measured on a dimensioned Airbus drawing (method in §16).
- **E** estimated: engineering estimate, or simulator/community data; how is stated.

## 1. Sources

| # | Source | Notes |
|---|---|---|
| AC | Airbus, *A380 Aircraft Characteristics: Airport and Maintenance Planning*, issue Mar 30/05, Rev. 20 Dec 01/25. https://www.aircraft.airbus.com/sites/g/files/jlcbta126/files/2025-12/AC_A380_20251201.pdf | Primary. Chapters cited as AC 2-2-0 etc. The drawings are vector PDF; measured as in §16. |
| TCA | EASA TCDS EASA.A.110 Airbus A380, Issue 17, 05 Aug 2026. https://www.easa.europa.eu/en/downloads/7309/en | Primary. |
| TCT | EASA TCDS E.012 RB211 Trent 900, Issue 12, 16 Mar 2026. https://www.easa.europa.eu/en/downloads/7779/en | Primary. |
| TCG | EASA TCDS IM.E.026 Engine Alliance GP7200, Issue 03, 04 Jan 2013. https://www.easa.europa.eu/sites/default/files/dfu/EASA-TCDS-E.026_(IM)_Engine_Alliance_GP7200_series_engines-03-04012013.pdf | Primary. |
| FF | Airbus, *A380 Facts & Figures*, Dec 2021. https://www.airbus.com/sites/g/files/jlcbta136/files/2021-12/EN-Airbus-A380-Facts-and-Figures-December-2021_0.pdf | Primary (marketing sheet). |
| SF | Airbus Safety First, *A Focus on the Takeoff Rotation*. https://safetyfirst.airbus.com/a-focus-on-the-takeoff-rotation/ (PDF https://mms-safetyfirst.s3.eu-west-3.amazonaws.com/pdf/safety+first/a-focus-on-the-takeoff-rotation.pdf) | Primary. |
| LG | A. Hebborn (Airbus UK), *A380 Landing Gear and Systems: An Overview*, DGLR Hamburg, June 2008. https://www.fzt.haw-hamburg.de/pers/Scholz/dglr/hh/text_2008_06_05_LandingGear.pdf | Primary. |
| COL | Collins Aerospace, *Airbus A380 Lighting Equipment*. https://www.rtx.com/collinsaerospace/-/media/CA/product-assets/files/military-and-defense/lighting/pdfs/aircraft-overviews/01_0005-airbus-a380-lighting-equipment.pdf | Supplier catalogue. |
| CFR | 14 CFR 25.1385-1401 (nav light sectors, anti-collision 40-100 cycles/min). https://www.ecfr.gov/current/title-14/chapter-I/subchapter-C/part-25/subpart-F | Regulation (CS-25 identical). |
| FBW | FlyByWire A380X docs (exterior lights panel https://docs.flybywiresim.com/pilots-corner/a380x/a380x-briefing/flight-deck/ovhd/ext-lt/ ; SOP https://docs.flybywiresim.com/pilots-corner/a380x/assets/sop/FBW_A380X_SOP.pdf ; engine start and taxi https://docs.flybywiresim.com/pilots-corner/a380x/a380x-beginner-guide/04_engine-start-taxi/) and source (`fbw-a380x/src/wasm/systems/a380_systems/src/hydraulic/mod.rs`, `fbw-common/.../hydraulic/flap_slat.rs`, issue #10183) https://github.com/flybywiresim/aircraft | *Secondary*: a community simulation written to mirror the FCOM. Used for panel behaviour and SOP flow, and (as **E**) for surface rates. |
| AN | Airliners.net "A380 Flap Settings" (quotes an EADS PDF) https://www.airliners.net/forum/viewtopic.php?t=754487 ; Capt. Dave (A380 pilot) https://captaindave.aero/2018/05/05/how-to-land-the-largest-passenger-aircraft-in-the-world/ | *Secondary*. |
| AVT | Avionics Today, *A380 Innovations: A Balancing Act* (2003). https://www.aviationtoday.com/2003/03/01/a380-innovations-a-balancing-act/ | *Secondary* (trade press). |
| FI | Flight International, *Creating a Titan* (14 Jun 2005). https://www.flightglobal.com/creating-a-titan/60787.article | *Secondary*, paywalled; figures from the search abstract only. |
| PP | PPRuNe "Airbus Strobes" https://www.pprune.org/tech-log/362746-airbus-strobes.html ; Collins A320 LED anti-collision spec https://www.rtx.com/collinsaerospace/-/media/CA/product-assets/files/military-and-defense/lighting/pdfs/anti-collision-lights/06_0010-led-anti-collision-lighting-system-a320.pdf | *Secondary*, A320-family timing. |
| MISC | Window pitch: https://www.airliners.net/forum/viewtopic.php?t=478603 ; gear timing: https://www.airliners.net/forum/viewtopic.php?f=5&t=744489 ; tail strike: https://quizlet.com/107468150/a380-limitations-flash-cards/ ; sites: https://www.airframer.com/aircraft_detail.html?model=A380 , https://simpleflying.com/how-the-airbus-a380-was-built/ ; flap/slat sequencing: Airbus patent US 9,457,888 https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9457888 | *Secondary*, low weight. |

## 2. Conventions and the rest pose

- Frame: x aft from the nose tip, y toward the right wing, z up from the ground. Metres, degrees, seconds, %, knots.
- Engines numbered 1-4 from the left (Airbus): 1 left outboard, 2 left inboard, 3 right inboard, 4 right outboard.
- Rest pose: gear down, static at **MRW 562 t (WV000), mid CG** = mean of the AC 2-3-0 FWD 37.8% and AFT 41% columns. **S**
- Wing and nacelle heights depend strongly on fuel: between 300 t and MRW the wingtip fence drops 0.72 m and the outboard nacelle 0.37 m (AC 2-3-0). The model stores MRW and a lift-driven bend (`wingBend`). **S/E**
- Figure scenario: take-off at 510 t, CONF 1+F, take-off N1 94%. **E**

## 3. Overall dimensions

| Fact | Value | Src | Conf |
|---|---|---|---|
| Overall length (nose to fin-tip TE) | 72.73 m (FF 72.7) | AC 2-2-0 | S |
| Fuselage length (nose to tail cone) | 70.40 m | AC 2-2-0 | S |
| Nose to tailplane tip TE | 72.57 m | AC 2-2-0 | S |
| Span (over the fences) | 79.75 m (FF "geometric 79.8") | AC 2-2-0 | S |
| Height (fin tip), MRW | 24.15 m (24.17 FWD / 24.12 AFT; 24.27 at 300 t); FF 24.1 | AC 2-3-0 | S |
| Fuselage width / height (constant section) | 7.14 / 8.41 m | AC 2-2-0 | S |
| Keel / crown height, MRW | 2.36 / 10.77 m (F1, F2) | AC 2-3-0 | S |
| Main / upper deck floor (door sills) | 5.15 / 7.90 m (M 5.11-5.18, U 7.88-7.93) | AC 2-3-0 | S |
| Lower deck (cargo sills C1/C2/C3) | 3.065 / 3.105 / 3.235 m | AC 2-3-0 | S |
| Cabin length, max widths | 49.9 m; main 6.5 m, upper 5.8 m; 550 m² | FF | S |
| Wing area, sweep (25%) | 845 m², 33.5° | FF | S |
| Aspect ratio | 7.53 (FI 7.52) | span²/area | D |
| Wheelbase | NLG to WLG centre 28.605 m; NLG to BLG centre axle 31.881 m | AC 7-2-0 | S |
| Tracks | WLG 12.456 m, BLG 5.264 m, outer WLG tyre faces 14.34 m | AC 7-2-0, 2-2-0 | S |
| Nose tip to NLG / WLG / BLG | 4.97 / 33.58 / 36.85 m | AC 2-2-0 | S |
| Ground clearances (MRW) | nacelle in/out 1.065 / 1.90; belly fairing 1.66 (x≈29.7); fwd fuselage 2.36; radome 4.78; fence top/bottom 7.52 / 5.24; tailplane tip 9.175, root 7.625 | AC 2-3-0 | S |
| Weights | MTOW 560 t (WV000; up to 575 t WV008/011), MLW 386 t, MZFW 361 t, fuel 323 546 l | AC 2-1-1, TCA | S |
| Max certified pax | 868 (upper 330, main 538); FF quotes 853 | TCA | S |
| Tail-strike pitch | 11.5° gear compressed / 13.5° extended | MISC (study notes) | E |
| | 12.7° static, about the rear BLG axle, from the model geometry (`DIM.tailStrikePitch.geometryAtRest`; `tools/model-test.mjs` prints it from the fuselage stations) | model | D |

## 4. Fuselage and the double-deck section

- Station table (34 stations, nose tip to the APU blade): `FUSELAGE.stations` [x, halfWidth, topZ, bottomZ]. Measured on AC 2-2-0 side and plan views; heights scaled by 0.9836 about the crown so the drawn section (8.55 m) matches the AC's 8.41 m (the drawing's crown matched F2 to 0.02 m, its keel sat 0.12 m below F1). **D**
- Constant section x 14-46 m. Nose: radome tip z 4.81 (AC RD1 4.78). Tail: the cone flattens sideways from x≈52 and ends at x 70.40 as a blade 1.40 m tall (z 7.59-8.99) and about 0.4 m wide carrying the APU exhaust. **D**
- Belly fairing (wing-body fairing with the WLG bays) x 18.5-46.5, lowest 1.66 m at x 29.7-35, up to ±4.35 m wide (front view). **D** (BF1/BF2 **S**)
- Section (`SECTION`): widest 7.14 m at z 6.50 (1.35 m above the main deck floor). Upper lobe from the front-view silhouette; lower lobe from the AC 2-7-0 cargo-door section shape blended with the front view (the belly fairing hides it). Fit: two half-superellipses on the widest station, upper b 4.27 m n 2.1, lower b 4.14 m n 2.25; crown arc R 3.35 m. Half-width at the main deck floor 3.43, at the upper deck floor 3.37. **D**
- Fin root line: horizontal at z 9.47, inside the descending tail-cone top. **D**
- <!-- f3-fuselage --> Drawn, not the aircraft (DESIGN §11.5, T9): S0's widest vertex is 3.526 m at z 7.25, so the constant section is drawn 7.05 m wide (7.14 m here, at z 6.50), −1.2%. The tail's rings (46.5, 50, 52.25, 66) are parallel-edge sections of S0 (each edge keeps S0's direction, so every facet between two rings is a planar trapezoid; the doors, the fin and tailplane roots keep planar facets), with edge lengths fitted to this table's section scaled by the barrel's 3.526/3.567 and the belt vertices held at their heights: half-width −1.0 to −1.5% from 46.5 to 52.25 and the bottom the model's (x 52: 3.28). The cone is one ring span (52.25-66: the fin root lies on its crown facet and the tailplane roots on its belt facets), so between its ends it is linear: half-width −4.0% at 54, −5.1% at 56, +0.2% at 58, +4.9% at 60, +3.2% at 62, +1.1% at 64 (f4-fuselage: the table's 64 m half-width is 1.59, on the straight taper 62-66; the 1.73 read before was the tailplane-root fairing in plan, so the earlier −7.1% was not the cone's), −1.1% at 66; the bottom up to 0.15 m high (60: 5.01 against 4.87) and the crown up to 0.15 m low (56: 10.38 against 10.53). Before (homothetic): −4.5% at 50, −5.5% at 52, −7.8% at 54, −8.5% at 56, the bottom 0.33 m low at 52. <!-- f3-fuselage end -->

## 5. Wing

| Fact | Value | Src | Conf |
|---|---|---|---|
| Planform polylines (LE 13 points, TE 15 points) | `WING.le`, `WING.te` | AC 2-2-0 plan scan | D |
| Checks against AC labels | inboard inlet 22.36 vs 22.23; outboard 30.1 vs 29.94; tip LE 46.92 vs 46.97; tip TE 50.95 | AC 2-2-0 | D |
| Root LE at the fuselage side | x 18.45 (y 3.57); AC labels 17.67 m (start of the LE fillet) | AC 2-2-0 | D |
| Root chord / centreline chord / tip chord | 18.4 / 20.2 / 3.98 m | AC | D / D / S |
| LE sweep | 41.2° inboard, 36.4° outboard, crank at y 13.8 | plan scan | D |
| TE sweep | 14.8° inboard, 22.4° outboard, kink at y 11.5 | plan scan | D |
| 25% chord sweep | 33.5° (scan gives 33.2°) | FF | S |
| Area | 845 m² (polylines carried to the centreline: 858) | FF | S/D |
| Dihedral | 5.6° (FI: "pronounced gulling") | FI | S-secondary |
| Static droop at MRW | chord-plane slope ~9.5° inboard, ~1.5° outboard; tip chord plane z 6.33 | AC front view + W1/W2/N1/N2 | D |
| Thickness | front-view silhouette t/c ≈ 10% at y 10, 8.8-9.3% outboard; root 12.5% | AC front view | D; root E |
| Wing root chord plane | z 3.95; upper surface ~5.1 just under the main deck floor | front view | E |
| Wingtip fence | 2.28 m tall (W1-W2 at every weight), 1.18 m above / 1.10 m below, on the aft tip: LE x 49.16, TE 52.07 | AC 2-2-0, 2-3-0 | S/D |
| In-flight bend vs static MRW | tip +2.0 m at 1 g, ∝ s^2.24 | | E |

## 6. Engines and nacelles (Trent 900; GP7200 noted)

| Fact | Value | Src | Conf |
|---|---|---|---|
| Positions y | ±14.80 (inboard), ±25.70 (outboard) | AC 2-2-0 (29.6 / 51.4) | S |
| Inlet (top lip) x | 22.23 inboard, 29.94 outboard | AC 2-2-0 | S |
| Centreline z (MRW) | 3.005 inboard, 3.84 outboard (clearance + 1.94) | AC 2-3-0 | D |
| Nacelle | max dia 3.88 m; 3.90 m to the pylon root; nose cowl 1.63 top / 1.30 bottom (scarfed inlet), fan cowl 2.18, reverser or fan-exhaust cowl 2.39, primary nozzle + plug 2.19; total 8.39 m | AC 2-12-0 | S |
| Inlet highlight, fan-nozzle exit, primary exit, plug | 3.26, 2.41, 1.67 m; plug base 0.99, length 1.46 m | AC 2-12-0 drawing | E |
| Fan | 2.95 m, 24 swept blades; LP and IP turn anticlockwise seen from the rear | TCT (24 blades: RR, secondary) | S |
| Bare engine | 5.48 m long, 3.94 m max dia, 6246 kg dry; 3 shafts (LP 1+5, IP 8+1, HP 6+1) | TCT | S |
| Thrust | Trent 970-84 334.29 kN, 972-84 341.41 kN (5 min, flat rated 30 °C) | TCT, TCA | S |
| N1 | 100% = 2900 rpm; take-off limit 97.2% | TCT | S |
| Ground protections | no stabilised N1 64-72% below 60 kt; N1 ≤ 78% below 32.5 kt ("modified take-off thrust setting") | TCT | S |
| Spool-up | 15% → 95% take-off power in 5.6 s | TCT note 12 | S |
| N1 lag model | τ up 1.9 s (3τ ≈ 5.6 s), τ down 3.0 s | | D / E |
| Ground idle | N1 ≈ 20%, N2 ≈ 66%, EGT ≈ 455 °C | FBW SOP | E |
| Take-off / climb N1 | take-off 88-95% (figure 94), CL ≈ 88% | | E |
| Start | order 1+2 then 3+4; ~50 s master-on to idle | FBW | E |
| Thrust reversers | inboard engines only (translating cowl, cascades, blocker doors); outboard: fixed fan duct | TCT, AC 2-12-0 | S |
| Pylon | fan-cowl top to the wing front spar; aft fairing ~1.5 m past the primary nozzle; ~0.9 m wide | | E |
| GP7200 (A380-861) | 100% N1 2467 rpm, max 111%, ground idle 450 rpm; fan 2.96 m, 24 blades; 332.4 / 357.2 kN (GP7270/7277); 4.92 m long | TCG, Engine Alliance | S |

## 7. Empennage and APU

| Fact | Value | Src | Conf |
|---|---|---|---|
| Fin | root LE x 53.94 on the root line z 9.47; root chord 12.06; tip LE x 68.02 at z 24.06; tip chord 4.70; height 14.59 | AC 2-2-0 | S |
| Fin sweep LE / TE, area | 44.0° / 24.7°, 122 m² | trapezoid | D |
| Rudder | 2 segments; hinge (62.55, 9.94)→(71.42, 24.08); split at z 14.45 | AC 2-2-0 side view | D |
| Tailplane | span 30.37; tip LE x 68.85 at y 15.185; tip chord 3.72; centreline LE 57.28 (68.85 - 11.57) | AC 2-2-0 | S/D |
| Tailplane sweep LE / TE, area, dihedral | 37.3° / 19.9°, 205 m² (published 205.6), ≈6° | plan scan, front view | D / D / E |
| Elevators | 2 per side; hinge (64.78, 1.63)→(70.57, 13.64); split at y 5.46 | AC 2-2-0 plan | D |
| APU | Pratt & Whitney Canada PW980A, exhaust at the tail-cone blade (70.4, 0, 8.29); compartment frames 110-117 | TCA, AC 2-12-0 | S / D |

## 8. Flight controls and configurations

| CONF | Slats | Flaps | Ailerons | VFE (E) |
|---|---|---|---|---|
| 0 | 0 | 0 | 0 | |
| 1 | 20 | 0 | 0 | 263 |
| 1+F | 20 | 8 | drooped 5 | 222 |
| 2 | 20 | 17 | 5 | 220 |
| 3 | 23 | 26 | 5 | 196 |
| FULL | 23 | 33 (one source 32) | 5 | 182 |

Slat/flap angles: AN (EADS PDF) and FBW SFCC agree except FULL (32 vs 33). Aileron droop 5° in 1+F: Capt. Dave (S-secondary); in 2/3/FULL: E. VFE: sim manual, E. On approach the A380 goes to 1+F automatically below 205 kt (AN).

Surfaces per wing, spanwise y, measured on the AC 2-3-0 front/rear views (**D**):

- Droop noses DN1 7.20-10.32, DN2 10.32-13.88 (gap 13.88-15.60 at the inboard pylon). Droop-nose angle follows the slats (E). (T1 re-scan of AC p035: the gaps straddle the pylons.)
- Slats S2 15.60-18.41, S3 -21.51, S4 -24.61 (gap 24.61-26.45 at the outboard pylon), S5 26.45-30.12, S6 -33.80, S7 33.80-38.05 (T1).
- Flaps (single-slotted Fowler, E): inner 4.43-12.45, mid 12.45-18.99, outer 18.99-25.53.
- Flap-track fairings at y 9.36, 13.49, 17.65, 21.87, 25.97 (AC 2-2-0, **S**), tips protruding to x 39.22-46.65; track 1 inside the belly fairing (E).
- Ailerons 26.00-27.76, 27.76-31.14, 31.14-35.24 (the drawn inner/mid boundary may be schematic).
- Spoilers 1-8: 4.14-8.90, 8.90-12.01, 12.77-15.62, 15.62-19.58, 19.58-23.05, 23.05-26.21, 26.21-28.93, 28.93-32.08. Ground spoilers: 1-2 at 35°, 3-8 at 50°, with the ailerons up 25°; speed brake in flight: all eight at 30°; roll on spoilers 3-8 (the up-aileron wing) up to 45° (captaindave.aero, "The A380 wing", **S-secondary**); the figure's control check deflects them 35° (E).

Transit (E, FlyByWire A380X hydraulic model, two motors at full pressure): flap drive 339 synchro° in 37.6 s, slat drive 327° in 31.7 s; the drive-to-angle maps make CONF 0→1 (slats 0→20) 27.8 s and 1→1+F (flaps 0→8, mostly Fowler travel) 23.9 s; 1+F→2 4.8 s, 2→3 8.2 s, 3→FULL 4.6 s. Order: slats then flaps on extension, flaps then slats on retraction (Airbus patent US 9,457,888: the clean-to-configuration time is the sum of both).

## 9. Landing gear

| Fact | Value | Src | Conf |
|---|---|---|---|
| Layout | NLG 2 wheels; 2 WLG × 4; 2 BLG × 6; 22 wheels | AC 2-9-0 | S |
| Tyres | main 1400x530 R23 40PR (15 bar); nose 1270x455 R22 32PR (14.1 bar) | AC 7-2-0, LG | S |
| NLG | axle x 4.97, wheels ±0.525 | AC | S |
| WLG | bogie centre x 33.575, y ±6.228; axles 1.70 apart, wheels 1.35 apart | AC 7-2-0 | S/D |
| BLG | axles x 35.151 / 36.851 / 38.551, y ±2.632; wheels 1.53 / 1.55 / 1.53 apart; rear axle steers | AC 7-2-0, LG | S/D |
| Retraction | NLG forward under the cockpit; WLG sideways inboard into the belly; BLG rearward into the fuselage | AC 2-9-0 | S |
| Weight on mains | 95.1% (WV000) | AC 7-2-0 | S |
| Brakes | carbon on all WLG wheels and the BLG front and centre axles; park brake on BLG only; wheels braked on retraction except the BLG aft axle | AC 2-9-0 | S |
| Hydraulics | 5000 psi; WLG and NLG green, BLG yellow; gravity free-fall back-up | LG, AC | S |
| NLG doors | 2 forward (hydraulic, R 1.89 m, open 62°, close after transit); 2 aft (leg-linked, 69.2°, open with the gear down) | AC 2-7-0, FBW | S |
| WLG doors | main door on the belly x 30.91-34.86, hinged at y 1.71, opens 79° to 0.10-0.25 m off the ground, closes after transit; hinged door and fairing door on the leg; auxiliary door (mechanical) | AC 2-7-0, 2-9-0 | S |
| BLG doors | outer doors x 35.67-40.84 (5.17 m), hinged outboard, open 99° to 0.25-0.35 m off the ground, close after transit leaving a slot for the leg; centre door (hydraulic); inner door R 1.32 m, 94° | AC 2-7-0, 2-9-0 | S |
| Leg geometry | NLG trunnion (5.3, 0, 3.0); WLG pintle z 4.3, leg 3.65; BLG trunnion z 3.3, leg 2.7; loaded tyre radius 0.65 / 0.60 | | E |
| Cycle times | retraction ~16 s (doors 3 / legs 10 / doors 3); extension ~20 s: doors 3 / NLG and WLG legs 11, the BLG legs ~2 s behind the WLG / doors 4 once the BLG locks | MISC (first-flight video estimate), Airbus patents for the order | E |

**Figure deviations (follow-up, recorded with DESIGN §11.3 and §11.5; fu/gear):**
- **BLG outer doors** follow the true sequence: hydraulic, 0 → 99° → 0 around each transit, closed with the gear
  down and up, leaving the slot for the leg. Each is drawn as two thin leaves (facet and bottom) meeting at the bend.
  [E] The bottom leaf ends at |y| 3.20 (the aircraft's runs on toward the leg): there its free edge passes the
  extended in-flight tyres 0.082 m clear as the door closes after extension; at |y| 2.95 it cut 0.11 m into the centre
  axle's outer tyre. The slot between it and the inner door's edge (|y| 2.40) is the leg's slot; it faces down, where
  the figure's view never looks.
- **BLG inner doors** (fu/f3-gear) follow the door sequence like the others: hydraulic, 0 → 94° → 0 around each
  transit, closed with the gear down and up. On the aircraft the inner doors carry fold-away parts that clear the
  extended bogie's wheels (the fillet for the tilted bogie's rear wheels). [E] In the figure the door is a 0.50 m main
  leaf and a 0.46 m fold leaf (0.03 m thick, fold line |y| 1.94) that folds up toward the bay in proportion to the
  swing, 178° at the door's 94°: the pair's swing passes the extended in-flight tyres 0.132 m clear, and open it stands
  0.053 m inboard of the inner tyres' faces as the gear moves (`--check`, BLG door swing). The one-piece 0.96 m door
  cut 0.25 m into the centre axle's inner tyre, so until this round the leg held it open with the gear down. The
  figure's bogie still hangs level in flight (the aircraft's pitch trimmer tilts it nose down).
- **WLG fairing door strips** (fu/f3-gear) carry a web at their aft end (0.006 m thick, 0.3 m deep), the forward wall
  of the GAP slit against `skin.fair.link` carried on into the bay, so no view ray runs down the slit to the stowed aft
  tyres (`tools/stowvis.mjs`: 6 px before, 0 after).
- **NLG forward doors** open 75° in the figure against the sourced 62°: held open at 62° the right door cuts 0.142 m
  into the right nose tyre mid-transit (gear 0.38); it clears from about 71° (70°: −0.011 m, 72°: +0.023, 75°: +0.074;
  `--check`, "NLG forward door held open through the transit", re-measured fu/f3-gear). The figure's bay is |y| ≤ 1.00 [E] and the doors span the whole bay
  from the hinge to the centreline. The label says "75° here (62° on the aircraft)".
- **BLG extension lag** is drawn: the body gear's legs read their own channel (`gearBody`), which starts 2.0 s after
  the wing and nose gear on extension; retraction moves all five legs together.

## 10. Doors

| Door | x | Sill z (MRW) | Clear opening | Notes |
|---|---|---|---|---|
| M1 L/R | 6.32 | 5.115 | 1.07 × 1.90 | Type A |
| M2 L/R | 16.50 | 5.13 | 1.07 × 1.90 | bridge (L), catering (R) at the gate |
| M3 L/R | 32.68 | 5.15 | 1.07 × 1.90 | over-wing emergency exit, ramp/slide without raft |
| M4 L/R | 44.74 | 5.165 | 1.07 × 1.90 | catering (R) |
| M5 L/R | 53.63 | 5.18 | 1.07 × 1.90 | catering via M5L and the rear lift |
| U1 L/R | 20.94 | 7.88 | 1.07 × 1.92 | bridge (L), catering (R) |
| U2 L/R | 40.30 | 7.905 | 1.07 × 1.92 | |
| U3 L/R | 49.19 | 7.925 | 1.07 × 1.92 | |
| Cargo FWD (R) | 11.73 | 3.065 | 3.11 × 1.75 | top-hinged, hydraulic, up and out, R 2.99 m |
| Cargo AFT (R) | 48.07 | 3.105 | 2.79 × 1.75 | top-hinged, hydraulic, R 3.07 m |
| Bulk (R) | 51.09 | 3.235 | 1.13 × ~0.99 (E) | manual, inward and up, R 1.40 m |

All **S** (AC 2-7-0 stations and sizes, AC 2-3-0 sills, AC 5-2-1 gate use) except where marked. Passenger doors: leaf 1.26 × 2.13 (main) / 2.11 (upper) m; plug doors that unlock and lift, swing outward and forward on a support arm and park parallel to the skin forward of the opening, door skin 0.72 m outboard of the scuff plate (0.70 at M3), 2.51 m swing envelope (**S**). Electrically assisted, opening ~8 s (**E**). 16 slides: dual-lane slide/rafts everywhere, M3 ramp/slides stowed in the belly fairing (AC 2-8-0, **S**). Holds: FWD 17.4 m, AFT 9.7 m, bulk 2.8 m (AC 2-6-0, **S**).

## 11. Windows and flight-deck glazing

- Pitch 0.635 m (25 in): forum (MISC) and measured 0.635-0.642 m on AC 2-2-0 (**S-secondary/D**).
- Per side: upper deck 52 windows at x 13.02-53.32 in four runs between U1/U2/U3 (**D**); main deck 57: 40 visible on AC 2-2-0 plus 17 behind the wing inferred at the same pitch with gaps at M3 and M4 (**D/E**). Total 218, "about 220" (secondary).
- Size 0.26 × 0.33 m drawn (**E**, consistent with "similar to A330/A340 windows"); centres 1.05 m above each deck floor (z 6.20 and 8.95) (**D**).
- Flight deck: three panes per side (windshield, forward side, aft side; the forward side window slides open for rope escape, T3 / AC 2-8-0 **S**); outlines in `WINDOWS.cockpit` from the AC front and side views (**D**). Pilot eye (T3) x 2.92, z 7.17 (the design eye 2.92 m from the nose); vision 31° up, 19.5° down, 121° aft (AC 4-4-0, **S**); eye y ±0.53 (E).

## 11a. Air-data probes (fu/r2-fuselage)

- The A380's ADIRS takes its air data from three **multi-function probes** (MFP 1, 2, 3), each one probe carrying the
  pitot, the total-air-temperature sensor and the angle-of-attack vane it turns with; three **side-slip angle** (SSA)
  probes; six **integrated static probes** (ISP); and a separate **standby pitot** (with standby static ports) for the
  ISIS (**S-secondary**: Airbus A380 General Familiarization Course, https://pdfcoffee.com/a380-general-familiarization-course-pdf-free.html ;
  A380 ATA 34 Navigation training manual, https://www.scribd.com/document/349573655/Level-III-Ata-34-Navigation ;
  Airbus Safety First, "Pitot probe performance covered on the ground": A380/A350 MFPs plus a standby pitot). There
  are no separate pitots, AoA vanes or TAT probe as on the A320/A330.
- Drawn on nose.fwd's lower facets (**E** positions, from photographs, model x, z, side): MFP 1 left 6.15, 4.02;
  MFP 2 right 6.15, 4.02; MFP 3 left 6.60, 3.72; standby pitot left 7.05, 4.05; SSA 1 left 7.45, 3.75; SSA 2 right
  6.60, 3.72; SSA 3 right 7.30, 3.75; ISP discs both sides at 6.40, 4.25 · 6.85, 3.92 · 7.65, 4.00. The three-port
  plates on the main belt at x 8.35 (z 5.47) stay as the standby static ports.

## 12. Cabin (Airbus standard 3-class, 555 seats)

- Configuration: AC 2-4-0 standard layout, the one AC 5-2-1 uses for the 90-min turn-round: 22 First + 334 Y on the main deck (356), 96 Business + 103 Y upper (199). **S**
- Abreast and widths (AC 2-5-0, **S**): main Y 3-4-3 (triple 1.57 m, aisles 0.51), main F 2-2-2 (1.45 m units, aisles 0.97); upper Y 2-4-2 (doubles 1.07, aisles 0.51), upper J 2-2-2 (1.37 m units, aisles 0.58).
- Row stations and pitch (**D**): AC plans remapped so each door's cross-aisle lands on its AC station (main deck piecewise through M1-M5; upper deck linear through U1 and U3, U2 then falls inside its cross-aisle). F 4 rows x 10.0-15.5 (1.81 m); Y main 19.97-31.69 / 34.0-42.2 / 46.2-52.4 (0.80 m); J upper 13.7-18.6 and 23.7-35.8 (1.17 m); Y upper 36.8-47.6 (0.78 m). The drawn blocks resolve to 332 of the 334 main-deck Y seats.
- Stairs (**D**): forward straight stair x ≈ 7.7-11.9 (between the main deck behind M1 and the front of the upper deck), aft spiral stair x ≈ 54.2-56.0 (dia ≈ 2.3). A short stair from the main deck up to the flight deck at x 4.9-6.3.
- Monuments (**D**, coarse): galleys and cart lifts at M2/U1 and M4, lavatories at M1, M3, M5, U1, U3; upper-deck aft crew rest (5 bunks); coat stowages forward.
- Overhead bins (**E**): aisle face 1.60-2.10 m over the deck, 0.50 m deep at the top, over the window seats (`cabin-furniture.mjs` `BIN`; follow-up fix round 1, interiors).
- Flight deck (**S** AVT/FBW, layout **E**): 2 pilot seats + 2 observer seats; 8 identical 6×8 in LCDs (PFD and ND per pilot, EWD and SD in the centre, 2 MFDs on the pedestal), 2 OIT screens, 2 KCCUs, 2 ISIS, optional HUD; sidesticks on the outboard consoles, not linked.

## 13. Exterior lights

Inventory: AC 2-10-0 items 1-19 (**S**) cross-checked with FBW panel docs and COL. Technology (COL, **S**): LED nav, tail nav and obstruction lights; xenon wing strobes (double) and tail strobe; red beacons; HID landing, NLG take-off, taxi/runway turn-off, wing scan, engine scan and logo lights; NLG and MLG taxi-camera lights; HID cargo and loading-area lights; LED gear-bay lights.

| Light | Where (model frame) | Colour / coverage | Behaviour |
|---|---|---|---|
| Nav L / R | wingtip forward, (47.3, ±39.8, 6.36) | red L / green R, 0-110° each side | NAV switch (S) |
| Nav tail | tail cone (70.4, 0, 8.6) | white, 140° aft (±70°) | CFR 25.1387 (S) |
| Obstruction | 2 white per wingtip (positions E) | white | with NAV on the ground only (S) |
| Beacons | 2 on the crown offset ±0.8 at x 26.9; 1 under the belly fairing at x 24.7 (D) | red | ON when cleared to push; signal engines starting/running (S) |
| Strobes | each wingtip (double flash) + one below the tail cone (single) | white | ON/AUTO/OFF; AUTO = main gear struts extended (S) |
| Logo | 1 on each tailplane upper surface, lights the fin | white | AUTO: on on the ground and in flight with slats out (S) |
| Wing scan | fuselage side (11.24, ±3.51, ~6.4), aimed along the wing LE | white | ice inspection (S); origin D |
| Engine scan | fuselage side (8.42, ±3.26, ~6.0), aimed at the nacelles | white | origin D |
| Landing | 2 per wing root LE: (21.17, ±5.86, 4.22) and (21.3, ±5.86, 3.63) | white, ~12° beam toed out 1.6° | LAND ON/OFF (S); positions D |
| Taxi | each wing root LE (21.17, ±5.86, 4.86), beam 0-26° outboard; one on the NLG strut | white | NOSE TAXI; NOSE T.O = taxi + take-off (S) |
| Take-off | 3 on the NLG strut (x 5.0), beam ±15° | white | NOSE T.O (S) |
| Runway turn-off | 2 on the NLG strut (5.29, ±0.33, 1.27), beams 15-73° off the nose each side | white | ON/OFF (S); beams D |
| Taxi-camera lights | 4: both sides of the nose, under each wing (E positions) | white | with ETACS (S) |
| Cargo flood, gear bay | holds and bays | white | ground ops |

Automatic: the lights on the nose strut (NOSE taxi and take-off, RWY TURN OFF) go off when the gear retracts (FBW A380X
EXT LT page: "The lights on the nose strut go off automatically when the gear retracts", S-secondary, fetched
2026-10-10). The wing-root taxi lights, also on NOSE, stay lit until the crew sets NOSE OFF after flap retraction
(follow-up review 1 amendment: the model darkened them with the gear; `s.lights.taxi` is now the wing-root pair and
`s.lights.taxiNose` the strut lamp).

Flash timing (**E**): wing strobes double (50 ms on, 60 off, 50 on) at 55-60 per minute, tail strobe single, beacons single red at ~60 per minute flashing between strobe pulses (PP; COL confirms the A380 wing strobe is a double unit). CFR 25.1401: 40-100 cycles per minute.

Standard use (FBW SOP, which follows the FCOM structure; **S-secondary**):

| Phase | NAV/LOGO | BEACON | STROBE | NOSE | RWY TURN OFF | LAND |
|---|---|---|---|---|---|---|
| Gate (cockpit prep) | ON | OFF | AUTO | OFF | OFF | OFF |
| Before pushback / start | ON | ON (when cleared to push) | AUTO | OFF | OFF | OFF |
| Taxi | ON | ON | AUTO | TAXI | AS RQRD (ON) | OFF |
| Entering the runway / line-up | ON | ON | ON | T.O | ON | ON |
| Take-off, initial climb | ON | ON | ON | (off with the gear) | (off with the gear) | ON |
| After flap retraction | ON (logo AUTO off) | ON | ON | OFF | OFF | ON |
| Climbing through 10 000 ft | ON | ON | ON | OFF | OFF | OFF |

## 14. Procedures, speeds and the phase model

- Gate: AC 5-2-1 standard turn-round 90 min, bridges at M2L and U1L, catering at M2R, M4R, U1R and via M5L, all three holds worked. **S**
- Before pushback: doors closed, slides armed, BEACON ON when cleared; engines 1+2 then 3+4 started during the push (FBW). **S-secondary**. APU on until after start. The towbarless tug connects before the push and drives off after it (§14a).
- Taxi: flaps to the take-off setting after start; NOSE TAXI. Idle is enough; breakaway ~30% N1 (E). Speed ~18 kt (E; Airbus guidance ≤30 kt straight, ~10 kt turns).
- Take-off: stabilise (~50% N1) then FLX/TOGA; the Trent FADEC holds ≤78% N1 below 32.5 kt (TCT); thrust set before 80 kt (FBW). Rotation at VR at **3°/s** (SF); lift-off ~4-5 s later at ~10° (SF); initial pitch target 12.5° (FBW; 10° with an engine out); then SRS (V2+10).
- Climb: positive climb → gear up (2 s reaction, E); 1500 ft thrust reduction → CL, acceleration; at F speed flaps 1, at S speed flaps 0 (for a 1+F take-off there is no F speed) (FBW); 250 kt below 10 000 ft; LAND lights off at 10 000 ft.
  The model keeps the flaps lever as a state (`s.lever`, `s.flapLever`, `s.flapSel`; follow-up review 1): it stays at 1
  (CONF 1+F) after the take-off and goes to 0 at S speed, the moment the flaps start in; the legend reads it.
- Scenario speeds at 510 t (**E**, scaled from MTOW figures by √W): V1 148, VR 153, V2 159, S ≈ 210, green dot ≈ 240 kt.
- Point-mass model in `step()` (**E**): thrust = 334.29 kN × f(N1) × (1 - 0.00145·V) × σ^0.7 with f(94%) = 0.97; drag polar CD = CD0(conf) + 0.015 (gear) + 0.0528·CL²; rolling friction 0.015. Result: lift-off 57 s after brake release, roll 2.1 km, VLOF 163 kt, initial climb ~1550 fpm at 169 kt, gear up by 650 ft, 3000 ft after 195 s.

| Phase | Real duration | Compression | On screen |
|---|---|---|---|
| GATE | 90 min (S); the figure holds the stand with the doors and holds open, it does not play the turn-round (follow-up round 2: this row said ×600) | held, no rate shown (model ×2) | the tour's dwell, 14 s |
| PUSHBACK | 185 s (tug connected 18 s, doors 20 s, push from 25 s: 48 s at 3 kt, about 76 m, then held by the tug while engines 3+4 start; engines 3+4 idle at 177 s, tug releases at 173 s, clear at 185 s) | ×12 (×3 while the doors move and while the tug comes and goes in view) | 15 s (16.4 s in the tour) |
| TAXI | ~10 min; first 90 s shown (flaps set in 52 s) | ×7.5 | 12 s |
| LINEUP | 45 s | ×9 | 5 s |
| TAKEOFF | 60 s to 35 ft | ×2 | 30 s |
| CLIMB | 195 s to 3000 ft | ×10 | 20 s |
| FL100 | 315 s to 10 000 ft | ×30 | 10 s |

## 14a. The pushback tug (follow-up)

A380s are pushed by towbarless tractors: the tractor backs onto the nose gear, its cradle closes round the nose wheels
and picks them up, and it pushes the aircraft back; then it lowers and releases the wheel and drives off. TLD's
TPX-500-S was designed for the A380 and towed the first one at Toulouse; Goldhofer's AST-1X is rated for 400-600 t
aircraft up to the A380 (Lufthansa uses it at Frankfurt). The figure draws a tractor of that class (`model.mjs`
`TUG`, `parts/tug.mjs`).

| Fact | Value | Src | Conf |
|---|---|---|---|
| Type | towbarless tractor, TLD TPX-500-S / Goldhofer AST-1X class, rated for the A380 | TLD product page https://www.tld-group.com/products/towbarless-aircraft-tractors/tpx-500-s/ ; Goldhofer https://www.goldhofer.com/en/towbarless-tractors/ast-1x | S |
| Length × width | 9.21 × 4.495 m (TPX-500-MTS, the A380-capable sister of the -S); AST-1X 490/680: 9.49 × 4.50 m | dealer listing https://aviaco-gse.com/catalogue/tld-tpx-500-mts/ ; Airport Technology profile https://www.airport-technology.com/contractors/groundequipment/goldhofer/ | S-secondary |
| Height | 2.155 m (TPX-500-MTS, cab roof); AST-1X 1360 about 1.65 m | dealer listings | S-secondary |
| Drive / steering tyres | 16.00-25 / 295/60-22.5 (2WD, 2WS); 16.00-25 drawn 1.49 m × 0.43 m (nominal size) | TLD TPX-500 sheet https://aeroservicios.com/uploads/manuals/TLD%20TPX-500.pdf ; nominal tyre dimensions | S / D |
| Nose gear it takes | up to 1,580 mm wide, 420 kN (the A380's nose gear is 1.505 m over the tyres) | TLD TPX-500 sheet; AC 7-2-0 | S / D |
| Weight, speed | 23.75 t (no GPU), 30 km/h (AST-1X 32 km/h) | TLD TPX-500 sheet; Goldhofer | S |
| Paint | TLD's standard is white RAL 9016 (custom paint offered); drawn in ground-equipment yellow, as Lufthansa's AST-1X | TLD sheet; photographs | S / E (figure choice) |
| Drive in and pick up the nose wheel | 18 s, while the doors close (20 s): the push waits for both | figure model | E |
| The push | 48 s at 3 kt, about 76 m (one aircraft length onto the taxilane), then the tug holds the aircraft, connected, until it releases the wheel at 173 s (follow-up round 2: the push ran 141 s, 219 m straight back) | figure model; typical stand pushes | E |
| Release, drive off | 4 s to lower and release the wheel once the aircraft has stopped; 8 s to drive away forward | figure model | E |
| Cradle clearance in the figure | the side arms and the backplate stand 0.06 m off the nose tyres; the real pick-up clamps and lifts them a few centimetres | figure decision | E |
| Steering | the nose gear does not steer while the cradle holds it (the tractor steers the push; the steering bypass pin is in) | standard towing practice | E |

**What the figure draws.** The turntable's axis is at x 41.30 (DESIGN §0.2), so the nose gear's axle is 36.33 m from it
and the platter's edge (r 38.6 m) is only 2.27 m ahead of the axle; the tractor reaches 3.4 m past the nose tip. The
platter is a slice of airfield (its markings end at its edge), so the tug is drawn as far as the platter goes: a long,
low chassis with rounded edges whose forward 0.4 m fades out toward the platter's edge, the driver's cab on the
centreline just ahead of the cradle (size [E], follow-up review 1), the side frames that flank the nose wheels as the
cradle's sides with the push plate between them, and the drive wheels outboard on their hub motors. Its engine bay and
steering axle lie beyond the edge and are not drawn (corrected in follow-up round 2: this paragraph still described the
round-0 tug, with fenders and a hatched section). Driving in and off, it fades over its last and first 1.4 m (it is cut
at the edge, so any further travel would leave the platter).

## 15. Where it was built

Nose/cockpit and centre fuselage: Saint-Nazaire; forward-centre and rear fuselage: Hamburg; wings: Broughton (with Filton; flaps from Bremen); horizontal tailplane: Getafe, assembled at Puerto Real; CFRP vertical tail: Stade; pylons: Toulouse; final assembly: Toulouse (Jean-Luc Lagardère); cabin and paint: Hamburg. **S-secondary** (MISC).

## 16. How the drawings were measured

The AC PDF is vector. Each page was converted to SVG with a small PDF content-stream interpreter (paths and text, no rasterising), rendered with headless Chromium to check by eye, and scanned numerically: silhouette paths were flattened (Béziers in 12-24 steps) and cut with horizontal/vertical lines. Scales come from the AC's own dimensions on the same drawing (72.73 m length, 72.57 m plan length, 79.75 m span, the 9.36-25.97 m flap-fairing stations). Checks: plan-view engine inlets within 0.15 m and the wingtip within 0.05 m of the labelled values; side-view crown within 0.02 m of F2; fin geometry reproduces the labelled 53.94 / 12.06 / 14.08 / 4.7 / 14.59 m exactly.

## 17. Not sourced (risks)

- Gear cycle times (no FCOM/AMM figure public): ~16 s retraction is a video observation; extension 20 s (the body gear's
  legs 2 s behind the wing gear's, §9) and the sub-phase split are estimates. On screen the gear's transit plays at
  ×2.5 at most (6.4 s up, 8 s down; follow-up review 1), so the tour and a reader's G show it whole.
- Flap/slat transit times come from a simulator's hydraulic model, not Airbus data.
- Take-off and climb N1, idle N1, VR/V2/S speeds, the thrust lapse and drag polar are engineering estimates for a 510 t scenario.
- Strobe/beacon timing is A320-family data; A380 units are confirmed only as double wing strobes.
- Window size, main-deck windows hidden by the wing, wing root thickness and chord-plane height, tailplane dihedral, gear leg geometry, NLG bay extent, pylon shape, obstruction/camera/logo light positions, light beam vertical spreads: estimated.
- The cabin plan is drawn to a slightly different scale aft; rows were remapped to the door stations (±0.3 m).
- Tail-strike 11.5° / 13.5° comes from study notes; the model's static geometry gives 12.7° (`DIM.tailStrikePitch.geometryAtRest`, as `tools/model-test.mjs` computes it from the fuselage stations; 12.9° until follow-up round 2).
- FULL flaps: 33° (FBW SFCC) vs 32° (forum quoting an EADS PDF).
- Aileron inner/mid boundary (27.76 m) looks schematic on the AC drawing.
