# Contributing

Thanks for looking. Issues and pull requests are welcome: a wrong number, a light that behaves unlike the real
aircraft, a procedure out of order, a rendering glitch on your device, or a performance win.

## Getting started

```sh
npm install         # dev tools only (TypeScript, Wrangler); the figure itself needs nothing installed
npm run build       # a380/a380.html and a380/a380-light.html, about 25 s each
npm run check       # the figure's checks and the flight-model test (CI runs these)
npm run typecheck   # tsc over the files marked // @ts-check (CI runs this)
npm run site        # the hosted one-page site in a380/dist, then `npm run serve` to try it on 127.0.0.1:8741
```

Open the built page in a browser; it runs from `file://`. The browser checks in `a380/README.md` (frame times,
captures, audits) need a local Chrome or Chromium; set `CHROME_PATH` if it isn't found.

## Where things live

- `a380/model.mjs`: the truth model. Every size, rate and rule the figure shows comes from here.
- `a380/truth.md`: where each of those numbers comes from.
- `a380/parts/`: the airframe, cabin, gear, lights and stage, as the build draws them.
- `a380/gl/`: the WebGL programs (`shaders.mjs` writes the GLSL) and the per-frame passes.
- `a380/live.js`: the page runtime: interaction, the flight phases, the readout.
- `a380/DESIGN.md`: the design and the decisions behind it. Decision 0 matters most: features are never removed to
  meet a performance budget; find speed elsewhere.
- `kit/`: the drawing kit from the Anatomy skill, with the 3D turn runtime and the WebGL painter.

## Rules of the road

- **Sources.** A new number goes in `model.mjs` with a tag: `[S]` read from a cited document, `[D]` derived from
  sourced numbers, `[E]` an estimate or a figure decision, with the reason. Add the source to `truth.md`.
- **Both themes, both painters.** A visual change should look right in the dark and light themes, and with WebGL off
  (`?painter=canvas`, or a browser without WebGL): the fallback draws what the shaders draw.
- **Comments.** The code explains why in its comments; keep that voice and density.
- **Types.** New or heavily changed modules should start with `// @ts-check` and carry JSDoc on what they export.
- **Commits.** Use [Conventional Commits](https://www.conventionalcommits.org/): `fix(lights): …`, `perf(gl): …`,
  `docs: …`. Rebuilt pages are not committed; releases carry them.

## Licence

By contributing you agree that your work is released under the MIT licence in [`LICENSE`](LICENSE).
