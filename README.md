# pla.ne

An interactive, true-3D Airbus A380-800 you can turn, open up and fly from the gate to 10,000 ft, in one
self-contained web page.

- 795 parts: the double-deck fuselage, wings with slats, flaps, ailerons and spoilers, four Trent 970 engines with
  spinning fans, 22 wheels on gear that retracts in its true sequence, 18 doors that open, and a towbarless tug.
- The cabin opens up: all 555 seats on a deck plan, the cabins in cutaway, and a flight deck with its displays.
- Every exterior light in WebGL (nav, strobes, beacons, landing, taxi, logo, wing scan), plus cabin windows,
  heat haze and runway lights, drawn by a WebGL painter. A canvas fallback runs where WebGL can't.
- Seven flight phases from the airport-planning numbers: gate, push and start, taxi, line-up, take-off, climb and
  10,000 ft. Each phase drives the gear, flaps, thrust, doors and lights.
- Light and dark themes, phones to wide desktops, touch, mouse and keyboard.

## Try it

Open `a380/a380.html` (dark) or `a380/a380-light.html` (light) in a browser. Each page is a single file with no
network requests.

Controls: drag to turn · `1`–`7` flight phases · `C` cutaway · `D` doors · `I` / `Shift+I` close-up views ·
`Space` pause · `Esc` back. The full list is in [`a380/README.md`](a380/README.md).

## Build it

Requires Node.js 20.10 or later; there is nothing to install.

```sh
node a380/build.mjs                 # a380/a380.html
node a380/build.mjs --light         # a380/a380-light.html
node a380/build.mjs --check         # the figure's own checks
node a380/tools/build-site.mjs      # a380/dist/: a static site ready to deploy (see a380/site/DEPLOY.md)
```

The audits and browser checks (headless Chromium) are described in [`a380/README.md`](a380/README.md).

## Layout

- `a380/`: the figure, with its truth model (`model.mjs`, sources in `truth.md`), parts, WebGL shaders,
  page runtime, design notes and tools.
- `kit/`: the drawing kit from the [Anatomy](https://github.com/wheresryan22/anatomy) skill, extended with the 3D
  turn runtime and the WebGL painter (MIT, see `kit/LICENSE`).
- `scripts/`: headless-browser capture, drive and check scripts from the same skill.

Not affiliated with or endorsed by Airbus. Dimensions and procedures come from public Airbus and EASA documents;
values marked as estimates in `a380/truth.md` are estimates.
