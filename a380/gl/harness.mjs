// a380/gl/harness.mjs (S): the WebGL harness, build side (GL.md, DESIGN §6). Owned by the scaffold.
//
// It turns the GL registry the modules filled (ctx.light, ctx.lamp, ctx.glTarget, ctx.glEffect) into
// DATA.gl: the camera, the canvases, every light with its anchor and inks, and the fragment sources of the
// effects. The page side (gl/harness.js) compiles one program per effect on its canvas and draws them each
// frame through scissored passes. The scaffold ships ONE effect, `points`: every registered point light
// (beacons now; nav, strobes, lenses when M8 and the other modules register them).
import { glCamera } from "../../kit/gl.mjs";
import { GLSL_COMMON, GL_INKS, inkTokens } from "./shaders.mjs";

/**
 * Inks per light colour: dark glow rgb and the paper body (GL.md §10, the daylight rule in DESIGN §6.2). The values
 * live in SH.GL_INKS with their CSS tokens (follow-up item 35); the page reads the tokens (gl/harness.js A3GL.ink).
 */
export const INKS = Object.fromEntries(["red", "green", "white", "amber", "blue", "lamp"].map((c) => [c, { dark: GL_INKS[c].dark, paper: GL_INKS[c].light }]));

/** The points program: one light per scissored pass (uniforms persist between passes; GL.md §7.1). */
export const POINTS_FRAGMENT = `${GLSL_COMMON}
uniform vec4 uPt;   // x, y (viewBox), lens radius (viewBox), energy (envelope x facing x visibility)
uniform vec4 uPtC;  // dark rgb, halo scale
uniform vec4 uPtP;  // paper body rgb, rim weight
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  float px=uView.x/uCanvas.x;
  vec4 P=uPt;vec4 C=uPtC;vec4 Q=uPtP;
  if(P.w<=0.){gl_FragColor=vec4(0.);return;}
  float r=length(vb-P.xy);
  float rl=max(P.z,.6*px);
  float reach=rl*C.w*6.;
  float lens=1.-smoothstep(rl-.5*px,rl+.5*px,r);
  float core=exp(-r*r/(rl*rl*.2));
  float tail=1.-smoothstep(reach*.55,reach,r);
  float halo=(exp(-pow(r/(rl*C.w),2.))*.55+exp(-r/(rl*C.w*1.5))*.2)*tail;
  vec3 sum=C.rgb*(lens*1.3+core*1.6+halo)*P.w;
  float hp=exp(-pow(r/(rl*(1.+.35*C.w)),2.))*tail;
  float e=lens*1.2+core*2.4+hp*Q.w;
  vec3 body=Q.rgb;vec3 rim=body*vec3(.86,.86,.9);vec3 pale=mix(vec3(1.),body,.12);
  vec4 paper=lampInk(e,rim,body,pale,.95)*P.w*tail;
  vec4 ink=mix(glowOf(sum),paper,uLight);
  gl_FragColor=finish(ink*uFirst*edgeFade(vb));
}`;

/**
 * DATA.gl from the registry. `reg` = { lights, lamps, targets, effects } as the ctx collected them;
 * lights carry kit-space anchors on their groups' rest frames.
 */
export function glData({ P, W, reg, view }) {
  const camera = glCamera(P);
  const lights = reg.lights.map((L) => ({
    id: L.id,
    part: L.part,
    group: L.group,
    at: L.at,
    normal: L.normal,
    kind: L.kind ?? "steady",
    color: INKS[L.color] ? L.color : "white",
    sector: L.sector ?? null,
    switch: L.switch ?? null,
    gate: L.gate ?? null,
    lens: W.m(L.lens ?? 0.08),
    halo: L.halo ?? 3,
    flash: L.flash ?? null,
    settle: L.settle ?? 0.22,
    dark: (INKS[L.color] ?? INKS.white).dark,
    paper: (INKS[L.color] ?? INKS.white).paper,
  }));
  const effects = [{ id: "points", canvas: "air", fragment: POINTS_FRAGMENT, uniforms: ["uPt", "uPtC", "uPtP", "uFirst"] }, ...reg.effects];
  return { W: view[0], H: view[1], camera, lights, lamps: reg.lamps, targets: reg.targets, effects, extensions: ["GL_OES_standard_derivatives"], canvases: ["runway", "ground", "air"], inks: inkTokens() };
}
