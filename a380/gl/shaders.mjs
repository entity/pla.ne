// a380/gl/shaders.mjs (M8; seeded by the scaffold from a380/spikes/gl/gl-shaders.mjs, unchanged but for the import path).
// The A380 WebGL layer, build side: GLSL generated from the figure's own model, so every number the
// shader uses is the number the SVG was built from (webgl.md section 5). Nothing here runs in the
// page; build.mjs puts the finished fragment sources into DATA.
import { glslPose } from "../../kit/gl.mjs";

const f = (x) => {
  if (!Number.isFinite(x)) throw new Error(`gl-shaders: non-finite constant ${x}`);
  const s = (+x.toFixed(5)).toString();
  const t = /[.e]/.test(s) ? s : `${s}.`;
  return x < 0 ? `(${t})` : t;
};
const v2 = (a) => `vec2(${f(a[0])},${f(a[1])})`;
// (a string is already GLSL: an ink uniform, follow-up item 35)
const v3 = (a) => (typeof a === "string" ? a : `vec3(${f(a[0])},${f(a[1])},${f(a[2])})`);

/**
 * Every shader ink, read from a CSS token (follow-up item 35; webgl.md 8.3 and 8.5). Each role has its token and the
 * token's two values: by daylight (`light`, the paper ink the shader lays) and at night (`dark`, the colour of the
 * glow, which goes into tonemap). The CSS (lights.mjs) is generated from this table; the page reads each token
 * through a probe's computed colour at GL init (gl/harness.js) and passes it as the uniform `uInk<Role>`. A page
 * carries one theme, so each program reads the one value its theme branch uses. Roles named here are the only
 * colours in the GLSL; the remaining literals are listed in notes/followup/lights.md with their reasons.
 */
export const GL_INKS = {
  // lights and lamps (points, lamp lenses, runway lights)
  red: { token: "--a3-gl-red", light: [0.86, 0.1, 0.08], dark: [1.0, 0.16, 0.1] },
  green: { token: "--a3-gl-green", light: [0.08, 0.6, 0.3], dark: [0.2, 1.0, 0.45] },
  white: { token: "--a3-gl-white", light: [0.55, 0.6, 0.66], dark: [1.0, 0.95, 0.88] },
  amber: { token: "--a3-gl-amber", light: [0.98, 0.74, 0.34], dark: [1.0, 0.72, 0.32] },
  blue: { token: "--a3-gl-blue", light: [0.32, 0.5, 0.94], dark: [0.45, 0.66, 1.0] },
  lamp: { token: "--a3-gl-lamp", light: [0.55, 0.6, 0.66], dark: [1.0, 0.93, 0.82] },
  // cabin windows and doorways
  win: { token: "--a3-gl-win", light: [0.99, 0.79, 0.43], dark: [1.0, 0.8, 0.52] },
  winRim: { token: "--a3-gl-win-rim", light: [0.92, 0.6, 0.24], dark: [0.92, 0.6, 0.24] },
  winCore: { token: "--a3-gl-win-core", light: [1.0, 0.96, 0.85], dark: [1.0, 0.96, 0.85] },
  cargo: { token: "--a3-gl-cargo", light: [0.78, 0.86, 1.0], dark: [0.78, 0.86, 1.0] },
  door: { token: "--a3-gl-door", light: [0.98, 0.82, 0.55], dark: [0.98, 0.82, 0.55] },
  // flight deck
  ck: { token: "--a3-gl-ck", light: [0.42, 0.62, 0.92], dark: [0.42, 0.58, 0.86] },
  ckRim: { token: "--a3-gl-ck-rim", light: [0.32, 0.5, 0.82], dark: [0.32, 0.5, 0.82] },
  ckCore: { token: "--a3-gl-ck-core", light: [0.86, 0.94, 1.0], dark: [0.86, 0.94, 1.0] },
  screen: { token: "--a3-gl-screen", light: [0.2, 0.24, 0.3], dark: [0.2, 0.24, 0.3] },
  // washes: the logo shares the fallback's token (the paper ink a warm darkening of the paint), the scan has its own
  // (review fu-1: by daylight #c2ab75 moved the shaded fin to R = G > B, olive; the ink is solved so the wash darkens the
  // fin's grey least in red and most in blue, R > G > B on the lit and the shaded fin: measured ΔR 0, ΔG −8, ΔB −16)
  logo: { token: "--a3-m8-wash", light: [0.753, 0.604, 0.439], dark: [1.0, 0.93, 0.8] },
  scan: { token: "--a3-gl-scan", light: [1.0, 0.86, 0.42], dark: [1.0, 0.95, 0.85] },
  // ground: the pools share the fallback's token
  pool: { token: "--a3-m8-pool", light: [0.97, 0.9, 0.78], dark: [1.0, 0.93, 0.8] },
  beacon: { token: "--a3-gl-beacon-wash", light: [0.9, 0.16, 0.12], dark: [1.0, 0.12, 0.08] },
  strobe: { token: "--a3-gl-strobe-wash", light: [0.4, 0.58, 0.96], dark: [0.85, 0.9, 1.0] },
  beam: { token: "--a3-gl-beam", light: [1.0, 0.88, 0.5], dark: [1.0, 0.93, 0.82] },
  haze: { token: "--a3-gl-haze", light: [0.5, 0.46, 0.42], dark: [0.5, 0.46, 0.42] },
  // the inlet: by daylight the grey of each tone (paper uses .r), at night the light the metal adds (base + lift)
  fan: { token: "--a3-gl-fan", light: [0.2, 0.2, 0.2], dark: [0.05, 0.055, 0.06] },
  fanBlade: { token: "--a3-gl-fan-blade", light: [0.42, 0.42, 0.42], dark: [0.16, 0.17, 0.19] },
  fanMark: { token: "--a3-gl-fan-mark", light: [0.7, 0.7, 0.7], dark: [0.2, 0.2, 0.21] },
  inletDeep: { token: "--a3-gl-inlet-deep", light: [0.45, 0.45, 0.45], dark: [0.02, 0.02, 0.02] },
  inletWall: { token: "--a3-gl-inlet-wall", light: [0.72, 0.72, 0.72], dark: [0.13, 0.135, 0.14] },
  spinner: { token: "--a3-gl-spinner", light: [0.4, 0.4, 0.4], dark: [0.1, 0.1, 0.1] },
  spinnerLit: { token: "--a3-gl-spinner-lit", light: [0.6, 0.6, 0.6], dark: [0.28, 0.28, 0.28] },
  spinnerMark: { token: "--a3-gl-spinner-mark", light: [0.94, 0.94, 0.94], dark: [0.5, 0.5, 0.5] },
};
/** The uniform that carries a role's ink: `uInkRed`, `uInkWinRim`. */
export const inkU = (role) => {
  if (!GL_INKS[role]) throw new Error(`gl-shaders: no ink role ${role}`);
  return `uInk${role[0].toUpperCase()}${role.slice(1)}`;
};
/** [[role, uniform, token]] for the page (gl/harness.js reads each token at init). */
export const inkTokens = () => Object.keys(GL_INKS).map((role) => [role, inkU(role), GL_INKS[role].token]);
const hex = (c) => `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
/** The tokens' CSS: the daylight values on .iso, the night values under the dark theme. */
export const inkCss = () =>
  `.iso{${Object.values(GL_INKS).map((r) => `${r.token}:${hex(r.light)}`).join(";")}}\n.iso[data-theme="dark"]{${Object.values(GL_INKS)
    .filter((r) => hex(r.dark) !== hex(r.light))
    .map((r) => `${r.token}:${hex(r.dark)}`)
    .join(";")}}`;
const maxOf = (terms, empty = "0.") => (terms.length ? terms.reduce((acc, t) => `max(${acc},${t})`) : empty);
export const glsl = { f, v2, v3 };

const unit = (a) => {
  const l = Math.hypot(...a);
  return a.map((x) => x / l);
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// The kit's frameFrom (turn-build.mjs): a unit, u made orthogonal to a, v kept if it already is.
export function frameOf(F) {
  const a = unit(F.a);
  let u = F.u ? F.u.map((x, i) => x - a[i] * dot(F.u, a)) : null;
  u = unit(u);
  const c = cross(a, u);
  const v = F.v && Math.abs(dot(c, F.v)) > 0.999 ? unit(F.v) : c;
  return { o: F.o.slice(), a, u, v };
}

// ---------------------------------------------------------------- common chunk
// uLight is fixed per page (0 dark, 1 light). uFirst is first light: the finished premultiplied ink
// of every light is scaled by it once (webgl.md 8.2). uPass selects the scissored pass.
export const GLSL_COMMON = `
${Object.keys(GL_INKS)
  .map((role) => `uniform vec3 ${inkU(role)};`)
  .join("")}
uniform float uLight;
uniform float uFirst;
uniform float uPass;
uniform float uNoDither;
#ifdef GL_OES_standard_derivatives
#define FW(x) max(fwidth(x),1e-6)
#else
#define FW(x) (pixelOf()*1.5)
#endif
float strokePx(){return .3*uCanvas.x/uView.x;}
vec4 over(vec4 top,vec4 under){return top+under*(1.-top.a);}
vec4 inkFor(vec3 seen,float cover){vec3 absorbed=1.-seen;float a=max(max(absorbed.r,max(absorbed.g,absorbed.b)),cover);return vec4(vec3(a)-absorbed,a);}
vec4 glowOf(vec3 c){vec3 t=tonemap(c,1.);return vec4(t,max(t.r,max(t.g,t.b)));}
vec4 lampInk(float e,vec3 rim,vec3 body,vec3 core,float floorA){
  float m=1.-exp(-e);
  vec3 seen=mix(vec3(1.),rim,smoothstep(0.,.3,m));
  seen=mix(seen,body,smoothstep(.2,.55,m));
  seen=mix(seen,core,smoothstep(.64,.97,m));
  return inkFor(seen,floorA*smoothstep(.5,.9,m));
}
float inkOf(vec4 k){return k.a-dot(k.rgb,vec3(.2126,.7152,.0722));}
vec4 tintInk(float e,vec3 hue,float cap){float a=cap*(1.-exp(-1.6*max(e,0.)/cap));return vec4(hue*a,a);}
vec4 finish(vec4 ink){
  ink=clamp(ink,0.,1.);ink.rgb=min(ink.rgb,vec3(ink.a));
  float n=(hash12(gl_FragCoord.xy+fract(uTime*.61)*91.)+hash12(gl_FragCoord.yx*1.37+fract(uTime*.37)*57.)-1.)/255.;
  ink+=vec4(n)*smoothstep(0.,1.5/255.,ink.a)*(1.-uNoDither);
  ink=clamp(ink,0.,1.);ink.rgb=min(ink.rgb,vec3(ink.a));
  return ink;
}
// the beams' and the heat haze's fade toward the card's inner frame (follow-up item 24): uFrame = the stage's CSS width
// and height and the fade's width in CSS px; the frame line sits about 4 CSS px inside the stage's edge. In CSS px, so
// an Inspect zoom does not narrow it (review round 3: the old fade was in zoomed viewBox units)
uniform vec4 uFrame;
float frameFade(){
  if(uFrame.z<=0.)return 1.;
  vec2 c=gl_FragCoord.xy*uFrame.xy/uCanvas;vec2 e=uFrame.xy-c;
  float d=min(min(c.x,e.x),min(c.y,e.y))-4.;
  return smoothstep(0.,uFrame.z,d);
}
float edgeFade(vec2 vb){float z=960./uView.x;vec2 q=(vb-uView.zw)*z;vec2 e=uView.xy*z-q;return smoothstep(3.,14.,q.x)*smoothstep(3.,14.,e.x)*smoothstep(3.,14.,q.y)*smoothstep(3.,14.,e.y);}
float sdRoundRect(vec2 p,vec2 b,float r){vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}
void clipPlane(float num,float den,inout vec2 span){if(abs(den)<1e-7){if(num<0.)span=vec2(1e9,-1e9);}else{float t=num/den;if(den>0.)span.y=min(span.y,t);else span.x=max(span.x,t);}}
vec2 cylX(vec3 o,vec3 d,vec2 c,float r){vec2 oc=o.yz-c;float a=dot(d.yz,d.yz);float b=dot(oc,d.yz);float k=dot(oc,oc)-r*r;float h=b*b-a*k;if(h<=0.||a<1e-9)return vec2(1e9,-1e9);h=sqrt(h);return vec2((-b-h)/a,(-b+h)/a);}
vec2 ballSpan(vec3 o,vec3 d,vec3 c,float r){vec3 oc=o-c;float b=dot(oc,d);float k=dot(oc,oc)-r*r;float h=b*b-k;if(h<=0.)return vec2(1e9,-1e9);h=sqrt(h);return vec2(-b-h,-b+h);}
vec2 slabX(vec3 o,vec3 d,float x0,float x1,vec2 s){clipPlane(x1-o.x,d.x,s);clipPlane(o.x-x0,-d.x,s);return s;}
float spotAt(vec3 p,vec3 n,vec3 S,vec3 D,vec4 cone){
  vec3 L=S-p;float d2=dot(L,L);float d=sqrt(d2);L/=max(d,1e-4);
  float spot=smoothstep(cone.x,cone.y,dot(-L,D));
  return cone.z*spot*max(dot(n,L),0.)*(1.-smoothstep(cone.w*.55,cone.w,d))/(d2+1.);
}
`;

// ---------------------------------------------------------------- covers
// The cover chunk sized to the budget, without counts (packCovers in gl-runtime.js).
export function glslCover(P, E) {
  return `
uniform vec3 uCov[${P * E}];
float coverAt(vec2 vb,float soft){
  float c=0.;
  for(int p=0;p<${P};p++){
    float inside=-1e6;
    for(int e=0;e<${E};e++){vec3 h=uCov[p*${E}+e];inside=max(inside,h.x*vb.x+h.y*vb.y+h.z);}
    c=max(c,1.-smoothstep(-soft,soft,inside));
  }
  return c;
}`;
}

// ---------------------------------------------------------------- convex prisms (wings, fin, fairings)
// The same F, polygon, s0, s1 given to T.prism. Defines <name>Local/Dir (frame coordinates
// u, v, s), <name>Sd(vec2 uv) (signed distance, < 0 inside; exact inside, a lower bound outside)
// and <name>Span(o, d, grow) (the ray's span through the prism grown by `grow`).
export function glslPrism(name, { F, polygon, s0, s1 }) {
  const fr = frameOf(F);
  let pts = polygon.slice();
  let area = 0;
  for (let i = 0; i < pts.length; i++) area += pts[i][0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * pts[i][1];
  if (area < 0) pts = pts.reverse();
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = [(b[1] - a[1]) / l, -(b[0] - a[0]) / l];
    return [n[0], n[1], n[0] * a[0] + n[1] * a[1]];
  });
  return `
vec3 ${name}Local(vec3 p){vec3 q=p-${v3(fr.o)};return vec3(dot(q,${v3(fr.u)}),dot(q,${v3(fr.v)}),dot(q,${v3(fr.a)}));}
vec3 ${name}Dir(vec3 d){return vec3(dot(d,${v3(fr.u)}),dot(d,${v3(fr.v)}),dot(d,${v3(fr.a)}));}
float ${name}Sd(vec2 p){return ${maxOf(lines.map(([nx, ny, k]) => `dot(p,${v2([nx, ny])})-${f(k)}`))};}
vec2 ${name}Span(vec3 o,vec3 d,float grow){vec3 lo=${name}Local(o);vec3 ld=${name}Dir(d);vec2 s=vec2(-1e9,1e9);
  clipPlane(${f(s1)}+grow-lo.z,ld.z,s);clipPlane(lo.z-${f(s0)}+grow,-ld.z,s);
  ${lines.map(([nx, ny, k]) => `clipPlane(${f(k)}+grow-dot(lo.xy,${v2([nx, ny])}),dot(ld.xy,${v2([nx, ny])}),s);`).join("\n  ")}
  return s;}
`;
}

// Light from lamps fixed on the airframe washing one face of a prism (logo lights on the fin, scan
// lights on the wing's top). The face is s = s1 (side +1) or s = s0 (side -1) in the prism frame;
// the face toward the viewer is used. lamps: [{ S, D, cone: [cosOuter, cosInner, intensity, reach],
// side }] in group rest-world coordinates; a lamp lights only the face on its own side.
// colours: { dark, tint, cap }. Returns `vec4 <name>Wash(vec3 o,vec3 d,float level)`.
export function glslFaceWash(name, prism, lamps, colours) {
  const fr = frameOf(prism.F);
  return `
vec4 ${name}Wash(vec3 o,vec3 d,float level){
  vec3 lo=${name}Local(o);vec3 ld=${name}Dir(d);
  if(abs(ld.z)<.02)return vec4(0.);
  float side=ld.z>0.?1.:-1.;
  float t=((side>0.?${f(prism.s1)}:${f(prism.s0)})-lo.z)/ld.z;
  vec3 p=o+t*d;vec2 uv=(lo+t*ld).xy;
  float sd=${name}Sd(uv);
  float inside=1.-smoothstep(-.5,.5,sd/FW(sd)+strokePx());
  if(inside<=0.)return vec4(0.);
  vec3 n=side*${v3(fr.a)};
  float e=0.;
${lamps.map((L) => `  e+=step(0.,side*${f(L.side)})*spotAt(p,n,${v3(L.S)},${v3(unit(L.D))},${`vec4(${L.cone.map(f).join(",")})`});`).join("\n")}
  e*=inside*smoothstep(.02,.18,abs(ld.z));
  vec4 dark=glowOf(${v3(colours.dark)}*e);
  vec4 paper=tintInk(e*${f(colours.paperGain ?? 1)},${v3(colours.tint)},${f(colours.cap)});
  return mix(dark,paper,uLight)*level;
}`;
}

// ---------------------------------------------------------------- the cabin (window lattice)
// The barrel is an elliptic cylinder along group x: centre (y, z), semi-axes (ry, rz), windows only
// for x in [x0, x1]. Each deck is a row: hz (row centre height above the axis), x0 (first window
// centre), pitch, count, w, h, r (window size and corner radius, along x and along the surface),
// doors [[xa, xb]...] (a window whose centre lies in a door span is not there).
// Windows are an analytic lattice: the nearest window index from x, never one uniform per window.
// The near root of the ray is the only surface seen, so far-side windows never draw; the facing
// fade takes the limb; the lattice fades to its mean density once the pitch is under ~3 px.
// A barrel whose section is a convex polygon in (y, z), the same polygon the SVG prism is built from
// (the A380's section is two half-superellipses, not a circle). half: the starboard half (y >= 0)
// from the keel to the crown. Returns GLSL for barrelHit(o, d, p, facing, s, side) with the same
// contract as the elliptic version: the near (exit) facet is the visible surface; s is the arc
// length along the section from the widest point (positive up), measured on each side.
export function glslBarrelPolygon(half, zc) {
  const full = [...half, ...half.slice(1, -1).reverse().map(([y, z]) => [-y, z])];
  const arcOf = [];
  let acc = 0;
  for (let i = 0; i < half.length; i++) {
    if (i) acc += Math.hypot(half[i][0] - half[i - 1][0], half[i][1] - half[i - 1][1]);
    arcOf.push(acc);
  }
  // the widest point's arc (where the half reaches its largest y; interpolate to z = zc)
  let wide = 0;
  for (let i = 1; i < half.length; i++) if ((half[i - 1][1] - zc) * (half[i][1] - zc) <= 0) {
    const t = (zc - half[i - 1][1]) / (half[i][1] - half[i - 1][1] || 1);
    wide = arcOf[i - 1] + t * (arcOf[i] - arcOf[i - 1]);
    break;
  }
  const n = full.length;
  const edges = full.map((a, k) => {
    const b = full[(k + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const e = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    const nrm = [e[1], -e[0]]; // outward for a counter-clockwise ring in (y, z)
    const K = nrm[0] * a[0] + nrm[1] * a[1];
    // arc at the edge start, and the arc direction along the edge (+1 up the starboard half, -1 down the port half)
    const onStbd = k < half.length - 1;
    const arc0 = onStbd ? arcOf[k] - wide : arcOf[half.length - 1 - (k - (half.length - 1))] - wide;
    return { a, e, nrm, K, arc0, sigma: onStbd ? 1 : -1 };
  });
  let area = 0;
  for (let k = 0; k < n; k++) area += full[k][0] * full[(k + 1) % n][1] - full[(k + 1) % n][0] * full[k][1];
  if (area <= 0) throw new Error("glslBarrelPolygon: give the starboard half from the keel up (y >= 0)");
  return `
bool barrelHit(vec3 o,vec3 d,out vec3 p,out float facing,out float s,out float side){
  float tin=-1e9;float tout=1e9;float kk=-1.;bool miss=false;
${edges.map((E, k) => `  {vec2 N=${v2(E.nrm)};float den=dot(d.yz,N);float num=${f(E.K)}-dot(o.yz,N);if(den>1e-7){float t=num/den;if(t<tout){tout=t;kk=${f(k)};}}else if(den<-1e-7){tin=max(tin,num/den);}else if(num<0.){miss=true;}}`).join("\n")}
  if(miss||tin>=tout||kk<0.)return false;
  p=o+tout*d;
  vec2 A=vec2(0.);vec2 E=vec2(0.);vec2 N=vec2(0.);float arc0=0.;float sg=1.;
${edges.map((E, k) => `  if(kk==${f(k)}){A=${v2(E.a)};E=${v2(E.e)};N=${v2(E.nrm)};arc0=${f(E.arc0)};sg=${f(E.sigma)};}`).join("\n")}
  facing=dot(vec3(0.,N),d);
  side=p.y>=0.?1.:-1.;
  s=arc0+sg*dot(p.yz-A,E);
  return true;
}`;
}

// The elliptic barrel (a T.round is the special case ry = rz): barrelHit(o, d, p, facing, s, side), the
// visible surface under this pixel: hit, facing, arc coordinate s from the waterline, side (+1 = +y).
export function glslBarrelEllipse(barrel) {
  const rm = (barrel.ry + barrel.rz) / 2;
  return `
bool barrelHit(vec3 o,vec3 d,out vec3 p,out float facing,out float s,out float side){
  vec2 R=${v2([barrel.ry, barrel.rz])};
  vec2 oc=(o.yz-${v2([barrel.y, barrel.z])})/R;vec2 dc=d.yz/R;
  float a=dot(dc,dc);float b=dot(oc,dc);float k=dot(oc,oc)-1.;float h=b*b-a*k;
  if(h<=0.||a<1e-9)return false;
  float t=(-b+sqrt(h))/a;
  p=o+t*d;
  vec2 q=p.yz-${v2([barrel.y, barrel.z])};
  vec3 n=normalize(vec3(0.,q/(R*R)));
  facing=dot(n,d);
  side=q.x>=0.?1.:-1.;
  s=atan(q.y/R.y,abs(q.x)/R.x)*${f(rm)};
  return true;
}`;
}

export function glslCabin({ barrel, decks, cockpit, inks }) {
  const rm = (barrel.ry + barrel.rz) / 2;
  const deckFns = decks.map((deck, k) => {
    const gone = maxOf((deck.doors ?? []).map(([a, b]) => `step(${f(a)},xi)*step(xi,${f(b)})`));
    const row = barrel.rowArc ? barrel.rowArc(deck.hz) : Math.asin(Math.max(-1, Math.min(1, deck.hz / barrel.rz))) * rm;
    return `
void deck${k}(float x,float s,float side,inout float cov,inout float lum,inout float halo){
  float aaS=FW(s);
  if(abs(s-${f(row)})>${f(deck.h / 2)}+.8+3.*aaS)return;
  float i=clamp(floor((x-${f(deck.x0)})/${f(deck.pitch)}+.5),0.,${f(deck.count - 1)});
  float xi=${f(deck.x0)}+i*${f(deck.pitch)};
  float gone=${gone};
  vec2 p=vec2(x-xi,s-${f(row)});
  float dd=sdRoundRect(p,${v2([deck.w / 2, deck.h / 2])},${f(deck.r)});
  float sharp=(1.-smoothstep(-.5,.5,dd/FW(dd)))*(1.-gone);
  float band=1.-smoothstep(-.5,.5,(abs(p.y)-${f(deck.h / 2)})/aaS);
  float fine=smoothstep(.3,.5,FW(x)/${f(deck.pitch)});
  float c=mix(sharp,band*${f(deck.w / deck.pitch)},fine);
  float blind=step(.07,hash12(vec2(i*1.7+${f(k * 13.1)},side*13.+${f(k)})));
  float shade=(.74+.26*hash12(vec2(i,${f(k * 17 + 3)}+side*31.)))*blind;
  float hot=mix(.62+.5*smoothstep(0.,-.1,dd),.86,fine)*mix(shade,.8,fine);
  lum=mix(lum,hot,c);
  cov=max(cov,c);
  halo+=(exp(-max(dd,0.)/.14)*(1.-smoothstep(.3,.55,dd))*(1.-gone)*shade*(1.-fine)+fine*band*.35)*(1.-smoothstep(.3,.55,abs(p.y)-${f(deck.h / 2)}));
}`;
  });
  const pane = cockpit
    ? (() => {
        const row = barrel.rowArc ? barrel.rowArc(cockpit.hz) : Math.asin(Math.max(-1, Math.min(1, cockpit.hz / barrel.rz))) * rm;
        return `
vec4 cockpitInk(vec3 p,vec3 d,float s,float level){
  float i=clamp(floor((p.x-${f(cockpit.x0)})/${f(cockpit.pitch)}+.5),0.,${f(cockpit.count - 1)});
  float xi=${f(cockpit.x0)}+i*${f(cockpit.pitch)};
  vec2 q=vec2(p.x-xi,s-${f(row)});
  float dd=sdRoundRect(q,${v2([cockpit.w / 2, cockpit.h / 2])},${f(cockpit.r)});
  float pane=1.-smoothstep(-.5,.5,dd/FW(dd));
  if(pane<=0.)return vec4(0.);
  // behind the pane: the panel plane x = XP, facing aft, seen when the viewer is aft of it
  float disp=0.;
  if(d.x<-.05){
    vec3 r=p+d*((${f(cockpit.panel)}-p.x)/d.x);
    vec2 g=vec2(r.y-${f(barrel.y)},r.z-${f(barrel.z)});
    float cell=floor(g.x/${f(cockpit.display[0])}+.5);
    vec2 dq=vec2(g.x-cell*${f(cockpit.display[0])},g.y-${f(cockpit.display[2])});
    float dsd=sdRoundRect(dq,${v2([cockpit.display[1] / 2, cockpit.display[3] / 2])},.04);
    disp=(1.-smoothstep(-.5,.5,dsd/FW(dsd)))*step(abs(cell),${f(cockpit.display[4])});
  }
  float e=.55+.9*disp;
  vec4 dark=glowOf(mix(${v3(inks.cockpitDark)},${v3(inks.displayDark)},disp)*e);
  vec4 paper=lampInk(1.7+1.6*disp,${v3(inks.cockpitRim)},${v3(inks.cockpitBody)},${v3(inks.cockpitCore)},.9);
  return mix(dark,paper,uLight)*pane*level;
}`;
      })()
    : "";
  return `
${deckFns.join("\n")}
${pane}
${barrel.section ? glslBarrelPolygon(barrel.section, barrel.z) : glslBarrelEllipse(barrel)}
vec4 cabinInk(vec3 o,vec3 d,float level,float cockpitLevel){
  vec3 p;float facing;float s;float side;
  if(!barrelHit(o,d,p,facing,s,side))return vec4(0.);
  float face=smoothstep(.04,.3,facing);
  if(face<=0.)return vec4(0.);
  float keep=smoothstep(${f(barrel.x0)},${f(barrel.x0 + 0.4)},p.x)*(1.-smoothstep(${f(barrel.x1 - 0.4)},${f(barrel.x1)},p.x));
  vec4 ink=vec4(0.);
  if(keep>0.){
    float cov=0.;float lum=0.;float halo=0.;
${decks.map((_, k) => `    deck${k}(p.x,s,side,cov,lum,halo);`).join("\n")}
    // dark: the lit pane plus a short glow on the skin around it; paper: the pane only (no bloom)
    vec4 dark=glowOf(${v3(inks.windowDark)}*(lum*3.6*cov+halo*.26));
    // paper, dimming (webgl.md 8.2): the hue of the dimmer energy (it warms down the amber body
    // instead of thinning to grey over the glass), scaled to the full-energy ink, then faded by the
    // level, so the ink on white is exactly ink(full) x level: it falls with the light, never rises
    vec4 full=lampInk(2.4*lum,${v3(inks.windowRim)},${v3(inks.windowBody)},${v3(inks.windowCore)},.92);
    vec4 dim=lampInk(2.4*lum*(.4+.6*level),${v3(inks.windowRim)},${v3(inks.windowBody)},${v3(inks.windowCore)},.92);
    vec4 paper=dim*(inkOf(full)/max(inkOf(dim),1e-4))*level*cov;
    ink=mix(dark*level,paper,uLight)*keep;
  }
  ${cockpit ? `ink=over(cockpitInk(p,d,s,cockpitLevel)*window(p.x,${f(cockpit.x0 - cockpit.pitch)},${f(cockpit.x0 + cockpit.count * cockpit.pitch)},.2),ink);` : ""}
  return ink*face;
}`;
}

// ---------------------------------------------------------------- engines: inlet, fan, spinner, nacelle wash
// e: { y, z (axis), xl (lip plane, the nacelle's front face), len (nacelle length aft of the lip),
//      rn (outer radius), ri (inlet radius: the drawn inlet ring), depth (lip to fan plane),
//      rs, ls (spinner base radius and length forward of the fan plane), blades, twist, slit,
//      spiral (turns of the spinner marking) }
// Uniforms per engine (vec4 uRun{i}: fan phase, spinner gain, n1, scan level; vec4 uGain{i}: blade
// harmonic gains g1..g4 from fanGains()).
export function glslEngine(i, e, scan, inks) {
  const C = v2([e.y, e.z]);
  const xf = e.xl - e.depth;
  const k2 = (e.rs / e.ls) ** 2;
  return `
uniform vec4 uRun${i};
uniform vec4 uGain${i};
vec4 engine${i}(vec3 o,vec3 d){
  vec4 run=uRun${i};vec4 g=uGain${i};
  vec4 ink=vec4(0.);
  // the nacelle's outer skin, lit by the scan light
  vec2 sp=cylX(o,d,${C},${f(e.rn)});
  if(sp.x<sp.y&&run.w>0.){
    vec3 p=o+sp.y*d;
    float along=smoothstep(-.5,.5,(${f(e.xl)}-p.x)/FW(p.x)-strokePx())*smoothstep(-.5,.5,(p.x-${f(e.xl - e.len)})/FW(p.x)-strokePx());
    vec2 oc=o.yz-${C};float a=dot(d.yz,d.yz);float b=dot(oc,d.yz);float h=b*b-a*(dot(oc,oc)-${f(e.rn * e.rn)});
    float limb=smoothstep(-.5,.5,h/FW(h)-strokePx());
    vec3 n=vec3(0.,normalize(p.yz-${C}));
    float en=0.;
${scan.map((L) => `    en+=spotAt(p,n,${v3(L.S)},${v3(unit(L.D))},vec4(${L.cone.map(f).join(",")}));`).join("\n")}
    en*=along*limb*run.w;
    ink=over(mix(glowOf(${v3(inks.scanDark)}*en),tintInk(en,${v3(inks.scanTint)},${f(inks.scanCap)}),uLight),ink);
  }
  // the inlet: seen through the lip opening (masked in the lip plane), then the inner wall or the fan
  if(d.x<.015)return ink;
  float face=smoothstep(.015,.12,d.x);
  vec3 pl=o+((${f(e.xl)}-o.x)/d.x)*d;float rl=length(pl.yz-${C});
  float open=(1.-smoothstep(-.5,.5,(rl-${f(e.ri)})/FW(rl)+strokePx()))*face;
  if(open<=0.)return ink;
  vec3 pf=o+((${f(xf)}-o.x)/d.x)*d;vec2 w=pf.yz-${C};float rf=length(w);
  vec2 wall=cylX(o,d,${C},${f(e.ri)});
  float depth=clamp((${f(e.xl)}-(o.x+wall.x*d.x))/${f(e.depth)},0.,1.);
  float onWall=smoothstep(-.5,.5,(rf-${f(e.ri)})/FW(rf));
  // fan: harmonics of a sawtooth (each blade's twisted face) and a dark slit at its edge, each gain
  // the product of the motion-blur gain (JS) and a screen band-limit (harmonic period under ~4 px)
  float r=rf/${f(e.ri)};
  float u=${f(e.blades)}*(atan(w.y,w.x)-run.x)+${f(e.twist)}*r;
  float fu=length(vec2(dFdx(u),dFdy(u)));
  vec4 G=g*vec4(1.-smoothstep(1.5708,3.14159,fu),1.-smoothstep(1.5708,3.14159,2.*fu),1.-smoothstep(1.5708,3.14159,3.*fu),1.-smoothstep(1.5708,3.14159,4.*fu));
  float saw=G.x*sin(u)+G.y*sin(2.*u)*.5+G.z*sin(3.*u)/3.+G.w*sin(4.*u)*.25;
  float sl=${f(e.slit)};
  float slit=sl+2.*(G.x*sin(3.14159*sl)/3.14159*cos(u)+G.y*sin(6.28318*sl)/6.28318*cos(2.*u)+G.z*sin(9.42478*sl)/9.42478*cos(3.*u)+G.w*sin(12.56637*sl)/12.56637*cos(4.*u));
  float blade=clamp((.52+.3*saw)*(1.-.75*slit),0.,1.);
  float hub=smoothstep(${f(e.rs / e.ri)},${f(e.rs / e.ri + 0.08)},r);
  // one marked blade (a once-per-rev cue, run.w = its gain: fades in with N1, out as its own blur grows): the reader
  // sees the fan begin to turn at real speed, where the 24 blades blur into a disc from N1 4% (review round 3)
  float mkA=cos(atan(w.y,w.x)-run.x+${f(e.twist)}*r/${f(e.blades)});
  float mk=run.w*smoothstep(.975,.998,mkA)*smoothstep(.42,.55,r)*(1.-smoothstep(.86,.95,r));
  vec3 Lg=normalize(dirToPlane(lightDir()));
  // spinner: a cone from the fan plane forward; the near root, soft at its silhouette and base
  vec3 w0=o-vec3(${f(xf + e.ls)},${f(e.y)},${f(e.z)});
  float qa=dot(d.yz,d.yz)-${f(k2)}*d.x*d.x;float qb=dot(w0.yz,d.yz)-${f(k2)}*w0.x*d.x;float qc=dot(w0.yz,w0.yz)-${f(k2)}*w0.x*w0.x;
  float qh=qb*qb-qa*qc;float spin=0.;vec3 ps=vec3(0.);
  if(qh>0.){
    float sq=sqrt(qh);float t1=(-qb+sq)/qa;float t2=(-qb-sq)/qa;
    float h1=-(w0.x+t1*d.x);float h2=-(w0.x+t2*d.x);
    float t=(h1>=0.&&h1<=${f(e.ls)}&&(t1>t2||h2<0.||h2>${f(e.ls)}))?t1:t2;
    ps=w0+t*d;float hs=-ps.x;
    spin=smoothstep(-.5,.5,qh/FW(qh))*smoothstep(-.5,.5,(${f(e.ls)}-hs)/FW(hs))*step(0.,hs);
  }
  // inks
  float wallTone=pow(1.-depth,1.4);
  float spinTone=0.;float mark=0.;
  if(spin>0.){
    vec3 nr=normalize(vec3(${f(e.rs / e.ls)},normalize(ps.yz)));
    spinTone=.35+.55*max(dot(nr,Lg),0.);
    float hs=clamp(-ps.x/${f(e.ls)},0.,1.);
    float su=atan(ps.z,ps.y)-run.x+6.28318*${f(e.spiral)}*hs;
    float m=smoothstep(.55,.8,cos(su));
    float gs=run.y*(1.-smoothstep(1.2,2.2,FW(su)));
    mark=.2+gs*(m-.2);
  }
  vec3 fanD=${inkU("fan")}+${inkU("fanBlade")}*blade*hub+${inkU("fanMark")}*mk;
  vec3 wallD=${inkU("inletDeep")}+${inkU("inletWall")}*wallTone;
  vec3 spinD=${inkU("spinner")}+${inkU("spinnerLit")}*spinTone+${inkU("spinnerMark")}*mark;
  vec3 darkC=mix(mix(fanD,wallD,onWall),spinD,spin);
  // paper: the fan face (a darker disc, .2-.42) apart from the inlet wall (a lighter ramp, .45-.72), so the face reads
  // when the blades band-limit at 1x; a faint swirl above 5% N1 shows the spool-up; the spinner mid-grey, dark-rimmed
  float swirl=smoothstep(.05,.2,run.z)*.05*sin(3.*atan(w.y,w.x)-run.x+7.*r)*hub;
  float fanS=mix(mix(${inkU("fan")}.r,${inkU("fanBlade")}.r,blade*hub)+swirl,${inkU("fanMark")}.r,mk);
  float wallS=mix(${inkU("inletDeep")}.r,${inkU("inletWall")}.r,wallTone);
  float rimS=1.-.22*(1.-smoothstep(0.,3.,qh/FW(qh)));
  float spinS=(mix(${inkU("spinner")}.r,${inkU("spinnerLit")}.r,spinTone)+(${inkU("spinnerMark")}.r-mix(${inkU("spinner")}.r,${inkU("spinnerLit")}.r,spinTone))*mark*.85)*rimS;
  float seen=mix(mix(fanS,wallS,onWall),spinS,spin);
  vec4 dark=vec4(darkC,max(darkC.r,max(darkC.g,darkC.b)));
  vec4 paper=inkFor(vec3(seen,seen*1.01,seen*1.03),.94);
  return over(mix(dark,paper,uLight)*open,ink);
}`;
}

// Heat haze behind a nozzle: a faint shimmer in a plume volume in group space, marched over the
// chord of its bounding cylinder, flowing aft, split between the canvases by the airframe proxies.
// h: { y, z, x (nozzle exit plane), r0 (exit radius), spread (radius growth per unit), length }.
export function glslHaze(i, h) {
  const rmax = h.r0 + h.spread * h.length;
  return `
float haze${i}(vec3 o,vec3 d,float tAir,float side,float thrust){
  if(thrust<.002)return 0.;
  vec2 s=slabX(o,d,${f(h.x - h.length)},${f(h.x)},cylX(o,d,${v2([h.y, h.z])},${f(rmax)}));
  if(s.x>=s.y)return 0.;
  float dt=(s.y-s.x)/10.;float j=hash12(gl_FragCoord.yx+fract(uTime*.53)*37.);float sum=0.;
  for(int k=0;k<10;k++){
    float t=s.x+(float(k)+j)*dt;vec3 p=o+t*d;
    float a=${f(h.x)}-p.x;float rr=${f(h.r0)}+${f(h.spread)}*a;
    float q=length(p.yz-${v2([h.y, h.z])})/rr;
    float env=exp(-q*q*2.2)*smoothstep(0.,${f(h.length * 0.08)},a)*(1.-smoothstep(${f(h.length * 0.55)},${f(h.length)},a));
    float n=noise3(vec3(p.x*.7+uTime*${f(h.flow ?? 9)},p.y*1.4,p.z*1.4));
    float n2=noise3(vec3(p.x*1.9+uTime*${f((h.flow ?? 9) * 1.6)},p.y*3.1+7.,p.z*3.1));
    float f=smoothstep(-.6,.6,t-tAir);
    sum+=env*max(n*.65+n2*.45-.55,0.)*mix(1.-f,f,side);
  }
  return sum*dt*thrust;
}`;
}

// Every plume in one loop (follow-up item 34): the same march and noise as glslHaze, with each plume's numbers
// read from a table instead of a copy of the loop per plume (five copies of a 10-step two-octave noise march
// cost about 90 ms of compile in each program that held them). `float hazeOf(int i, ...)` for i < count, and
// `float hazeSum(o, d, tAir, side, vec4 thrust, float apu)`: plumes 0-3 take thrust.xyzw, plume 4 the APU's.
export function glslHazeTable(list) {
  const rows = list.map((h, i) => {
    const rmax = h.r0 + h.spread * h.length;
    return `if(i==${i}){A=vec4(${f(h.y)},${f(h.z)},${f(h.x)},${f(h.length)});B=vec4(${f(h.r0)},${f(h.spread)},${f(rmax)},${f(h.flow ?? 9)});}`;
  });
  return `
float hazeOf(int i,vec3 o,vec3 d,float tAir,float side,float thrust){
  vec4 A=vec4(0.);vec4 B=vec4(0.);
  ${rows.join("\n  ")}
  if(thrust<.002)return 0.;
  vec2 s=slabX(o,d,A.z-A.w,A.z,cylX(o,d,A.xy,B.z));
  if(s.x>=s.y)return 0.;
  float dt=(s.y-s.x)/10.;float j=hash12(gl_FragCoord.yx+fract(uTime*.53)*37.);float sum=0.;
  for(int k=0;k<10;k++){
    float t=s.x+(float(k)+j)*dt;vec3 p=o+t*d;
    float a=A.z-p.x;float rr=B.x+B.y*a;
    float q=length(p.yz-A.xy)/rr;
    float env=exp(-q*q*2.2)*smoothstep(0.,A.w*.08,a)*(1.-smoothstep(A.w*.55,A.w,a));
    float n=noise3(vec3(p.x*.7+uTime*B.w,p.y*1.4,p.z*1.4));
    float n2=noise3(vec3(p.x*1.9+uTime*B.w*1.6,p.y*3.1+7.,p.z*3.1));
    float f=smoothstep(-.6,.6,t-tAir);
    sum+=env*max(n*.65+n2*.45-.55,0.)*mix(1.-f,f,side);
  }
  return sum*dt*thrust;
}
float hazeSum(vec3 o,vec3 d,float tAir,float side,vec4 thrust,float apu){
  float sum=0.;
  for(int i=0;i<${list.length};i++){float th=i==0?thrust.x:i==1?thrust.y:i==2?thrust.z:i==3?thrust.w:apu;sum+=hazeOf(i,o,d,tAir,side,th);}
  return sum;
}`;
}

/**
 * The largest t inside any of several convex polyhedra (follow-up item 34): `float <name>(o, d)` loops over one table
 * of planes (kit metres) instead of unrolling a clip per plane, which cost about 100 ms of compile per program for the
 * airframe proxies. hulls: [{ planes: [{ n, d }] }]. Returns -1e9 where the ray misses them all.
 */
export function glslConvexTable(name, hulls) {
  const all = hulls.flatMap((h) => h.planes);
  const ends = [];
  let at = 0;
  for (const h of hulls) ends.push((at += h.planes.length));
  // a balanced if-tree over the plane index: log2(n) comparisons a lookup, not a chain of n
  const tree = (lo, hi) => {
    if (lo === hi) return `return vec4(${f(all[lo].n[0])},${f(all[lo].n[1])},${f(all[lo].n[2])},${f(all[lo].d)});`;
    const mid = (lo + hi) >> 1;
    return `if(k<=${mid}){${tree(lo, mid)}}else{${tree(mid + 1, hi)}}`;
  };
  return `
vec4 ${name}Plane(int k){${tree(0, all.length - 1)}}
float ${name}(vec3 o,vec3 d){
  float best=-1e9;float tin=-1e9;float tout=1e9;int h=0;
  for(int k=0;k<${all.length};k++){
    vec4 P=${name}Plane(k);float den=dot(d,P.xyz);float num=P.w-dot(o,P.xyz);
    if(den>1e-7)tout=min(tout,num/den);else if(den<-1e-7)tin=max(tin,num/den);else if(num<0.)tin=1e9;
    ${ends.map((e, i) => `${i ? "else " : ""}if(k==${e - 1}){if(tin<tout&&tin<1e8&&tout<1e8)best=max(best,tout);tin=-1e9;tout=1e9;}`).join("")}
  }
  return best;
}`;
}

// ---------------------------------------------------------------- beams (spot lamps in world space)
// N spot lamps, each anchored every frame (controller.anchor): uSpotS[i] world position, uSpotD[i]
// world direction, uSpotC[i] = (cos outer, cos inner, intensity x envelope, reach).
export function glslSpots(N, scatter = 3e-4) {
  return `
uniform vec3 uSpotS[${N}];
uniform vec3 uSpotD[${N}];
uniform vec4 uSpotC[${N}];
// light on the runway (world plane z = 0) from every lamp
float spotPools(vec3 g){
  float e=0.;
  for(int i=0;i<${N};i++){vec4 c=uSpotC[i];if(c.z<=0.)continue;e+=spotAt(g,vec3(0.,0.,1.),uSpotS[i],uSpotD[i],c);}
  return e;
}
// The ray's span inside a lamp's cone (apex S, axis D, half-angle with cosine cosA), forward
// nappe only, clipped to lim. Marching only this span keeps every sample in the light.
vec2 coneSpan(vec3 p0,vec3 V,vec3 S,vec3 D,float cosA,vec2 lim){
  vec3 w=p0-S;float vd=dot(V,D);float wd=dot(w,D);float c2=cosA*cosA;
  float a=vd*vd-c2;float b=wd*vd-c2*dot(w,V);float c=wd*wd-c2*dot(w,w);
  vec2 fwd=vd>1e-6?vec2(-wd/vd,1e9):(vd<-1e-6?vec2(-1e9,-wd/vd):(wd>=0.?vec2(-1e9,1e9):vec2(1e9,-1e9)));
  vec2 span=vec2(1e9,-1e9);
  float disc=b*b-a*c;
  if(abs(a)<1e-6){span=fwd;}
  else if(disc<0.){if(a>0.)span=fwd;}
  else{
    float sq=sqrt(disc);float t1=(-b-sq)/a;float t2=(-b+sq)/a;
    if(t1>t2){float x=t1;t1=t2;t2=x;}
    if(a<0.)span=vec2(t1,t2);
    else{
      vec2 A=vec2(max(-1e9,fwd.x),min(t1,fwd.y));vec2 B=vec2(max(t2,fwd.x),min(1e9,fwd.y));
      span=(A.y-A.x>B.y-B.x)?A:B;
    }
  }
  span=vec2(max(span.x,max(fwd.x,lim.x)),min(span.y,min(fwd.y,lim.y)));
  return span;
}
// light scattered toward the eye along the pixel's ray by every lamp's cone: a dithered march of
// the ray's span inside the cone (widened 3 degrees so the spot's soft edge is inside), above the
// ground and inside the reach sphere; side 1 keeps the samples in front of the airframe proxies,
// side 0 the samples behind them (drawn on the back canvas, where the airframe's SVG covers them)
float beams(vec3 p0,vec3 V,float tAir,float side){
  float sum=0.;
  for(int i=0;i<${N};i++){
    vec4 c=uSpotC[i];if(c.z<=0.)continue;
    vec3 S=uSpotS[i];vec3 D=uSpotD[i];
    vec2 ball=ballSpan(p0,V,S,c.w);
    if(ball.x>=ball.y)continue;
    float cosW=cos(atan(max(c.x,c.y))+.05);
    vec2 sp=coneSpan(p0,V,S,D,cosW,vec2(max(ball.x,(.05-p0.z)/V.z),ball.y));
    if(sp.y<=sp.x)continue;
    float dt=(sp.y-sp.x)/16.;float j=hash12(gl_FragCoord.xy+fract(uTime*.37)*41.+float(i)*7.);float b=0.;
    for(int k=0;k<16;k++){
      float t=sp.x+(float(k)+j)*dt;vec3 p=p0+t*V;vec3 L=p-S;float l2=dot(L,L);float l=sqrt(l2);
      float spot=spotE(L/max(l,1e-4),D,c.xy);
      float w=spot*(1.-smoothstep(c.w*.55,c.w,l))*smoothstep(.05,.8,p.z)/(l2+6.);
      float fr=smoothstep(-.6,.6,t-tAir);
      b+=w*mix(1.-fr,fr,side);
    }
    sum+=b*dt*c.z;
  }
  return sum*${f(scatter)};
}`;
}

// ---------------------------------------------------------------- point lights (screen space from JS anchors)
// uPt[i] = (x, y in viewBox, lens radius in viewBox, level); uPtC[i] = (dark rgb, halo scale);
// uPtP[i] = (paper body rgb, paper halo share). Level already holds envelope x sector x facing x
// visibility x first light. Every term is windowed to 0 by its reach, inside the pass box.
export function glslPoints(N) {
  return `
uniform vec4 uPt[${N}];
uniform vec4 uPtC[${N}];
uniform vec4 uPtP[${N}];
uniform float uPtSel;
float pointReach(vec4 P,vec4 C){return P.z*C.w*6.;}
vec4 pointsInk(vec2 vb){
  float px=uView.x/uCanvas.x;
  vec3 sum=vec3(0.);vec4 paper=vec4(0.);
  for(int i=0;i<${N};i++){
    vec4 P=uPt[i];if(P.w<=0.||abs(float(i)-uPtSel)>.5)continue;
    vec4 C=uPtC[i];vec4 Q=uPtP[i];
    float r=length(vb-P.xy);float reach=pointReach(P,C);
    if(r>=reach)continue;
    float rl=max(P.z,.6*px);
    float lens=1.-smoothstep(rl-.5*px,rl+.5*px,r);
    float core=exp(-r*r/(rl*rl*.2));
    float tail=1.-smoothstep(reach*.55,reach,r);
    float halo=(exp(-pow(r/(rl*C.w),2.))*.55+exp(-r/(rl*C.w*1.5))*.2)*tail;
    sum+=C.rgb*(lens*1.3+core*1.6+halo)*P.w;
    float hp=exp(-pow(r/(rl*(1.+.35*C.w)),2.))*tail;
    float e=(lens*1.2+core*2.4+hp*Q.w);
    vec3 body=Q.rgb;vec3 rim=body*vec3(.86,.86,.9);vec3 pale=mix(vec3(1.),body,.12);
    paper=over(lampInk(e,rim,body,pale,.95)*P.w,paper);
  }
  return mix(glowOf(sum),paper,uLight);
}`;
}

// ---------------------------------------------------------------- runway lights (static lattices on the base)
// Each lattice: { A (world lens point of light 0), U (world step), n, lens (world radius), dark
// (rgb), paper (rgb), gain (directional factor for this fixed camera), pool (world radius of the
// light it throws on the pavement) }. One index from the pixel's projection onto the lattice line,
// plus both neighbours for overlapping halos; never one uniform per light.
export function glslRunway(lattices, poolTint) {
  const fns = lattices.map((L, k) => {
    const A0 = [L.A[0], L.A[1], 0];
    const U2 = dot(L.U, L.U);
    return `
void lattice${k}(vec2 vb,vec3 g,float level,inout vec3 dark,inout vec4 paper,inout float pool){
  vec2 a=project(${v3(L.A)});vec2 b=project(${v3([L.A[0] + L.U[0], L.A[1] + L.U[1], L.A[2] + L.U[2]])})-a;
  float i=floor(dot(vb-a,b)/dot(b,b)+.5);
  float rl=max(${f(L.lens)}*uK,.55*uView.x/uCanvas.x);
  float px=uView.x/uCanvas.x;
  for(int m=-1;m<=1;m++){
    float j=i+float(m);
    if(j<0.||j>${f(L.n - 1)})continue;
    float r=length(vb-a-j*b);
    float reach=rl*7.;
    if(r>=reach)continue;
    float lens=1.-smoothstep(rl-.5*px,rl+.5*px,r);
    float core=exp(-r*r/(rl*rl*.2));
    float halo=(exp(-pow(r/(rl*2.6),2.))*.5+exp(-r/(rl*3.))*.15)*(1.-smoothstep(reach*.5,reach,r));
    dark+=${v3(L.dark)}*(lens*1.2+core*1.4+halo)*${f(L.gain)}*level;
    float e=lens*1.1+core*2.2+exp(-pow(r/(rl*1.4),2.))*.25;
    paper=over(lampInk(e,${v3(L.paper)}*vec3(.86),${v3(L.paper)},mix(vec3(1.),${v3(L.paper)},.12),.95)*${f(Math.min(1, L.gain))}*level,paper);
  }
  float jg=clamp(floor(dot(g-${v3(A0)},${v3(L.U)})/${f(U2)}+.5),0.,${f(L.n - 1)});
  vec3 c=${v3(A0)}+jg*${v3(L.U)};
  float dg=length(g.xy-c.xy);
  pool+=exp(-dg*dg/${f(L.pool * L.pool)})*(1.-smoothstep(${f(L.pool * 1.6)},${f(L.pool * 2.6)},dg))*${f(L.gain)}*level;
}`;
  });
  return `
${fns.join("\n")}
vec4 runwayInk(vec2 vb,float level){
  if(level<=0.)return vec4(0.);
  vec3 g=onFloor(vb,0.);
  vec3 dark=vec3(0.);vec4 paper=vec4(0.);float pool=0.;
${lattices.map((_, k) => `  lattice${k}(vb,g,level,dark,paper,pool);`).join("\n")}
  dark+=${v3(poolTint.dark)}*pool*.35;
  paper=over(paper,tintInk(pool*.4,${v3(poolTint.paper)},.18));
  return mix(glowOf(dark),paper,uLight);
}`;
}

// ---------------------------------------------------------------- airframe proxies (the split)
// The visible surface of a generous proxy of the airframe along a ray in group space: the largest
// t inside any proxy, or -1e9. barrel: capsule (cylinder plus end balls); prisms by name; cylinders.
export function glslProxies({ barrel, prisms = [], cylinders = [] }, grow = 0.25) {
  const terms = [];
  if (barrel) {
    terms.push(`s=slabX(o,d,${f(barrel.x0)},${f(barrel.x1)},cylX(o,d,${v2([barrel.y, barrel.z])},${f(Math.max(barrel.ry, barrel.rz) + grow)}));if(s.x<s.y)t=max(t,s.y);`);
    for (const x of barrel.balls ?? []) terms.push(`s=ballSpan(o,d,${v3([x, barrel.y, barrel.z])},${f(Math.max(barrel.ry, barrel.rz) + grow)});if(s.x<s.y)t=max(t,s.y);`);
  }
  for (const name of prisms) terms.push(`s=${name}Span(o,d,${f(grow)});if(s.x<s.y)t=max(t,s.y);`);
  for (const c of cylinders) terms.push(`s=slabX(o,d,${f(c.x0 - grow)},${f(c.x1 + grow)},cylX(o,d,${v2([c.y, c.z])},${f(c.r + grow)}));if(s.x<s.y)t=max(t,s.y);`);
  return `
float airT(vec3 o,vec3 d){float t=-1e9;vec2 s;
  ${terms.join("\n  ")}
  return t;}`;
}

export const glslPlanePose = (name = "Plane") => glslPose(name);

// =====================================================================================================
// M8: the A380's programs (DESIGN §6). Everything below is generated in Node from world.mjs and the built
// parts (part.world), in KIT METRES: kit units / 10, kit axes (x forward, y starboard, z up, origin on the
// turntable axis). A pixel's ray in a group's rest frame is o = toG(rayOf(vb))·0.1, d = dirToG(towardViewer()).
// =====================================================================================================
export const KM = 0.1;

/** The ID-mask chunk (gl/mask.js): visibleOf(target) for surface passes, pointVis(vb, r, target) for points. */
export const GLSL_MASK = `
uniform sampler2D uMask;
uniform vec4 uMaskInfo;
uniform float uTarget;
float maskAt(vec2 frag){vec4 c=texture2D(uMask,frag*uMaskInfo.x/uMaskInfo.yz);return floor(c.r*255.+.5)+256.*floor(c.g*255.+.5);}
float visibleOf(float target){
  if(uMaskInfo.w<.5||target<.5)return 1.;
  vec2 f=gl_FragCoord.xy;float t=target+.5;
  return .25*(step(maskAt(f+vec2(-.25,-.25)),t)+step(maskAt(f+vec2(.25,-.25)),t)+step(maskAt(f+vec2(-.25,.25)),t)+step(maskAt(f+vec2(.25,.25)),t));
}
float pointVis(vec2 vb,float rad,float target){
  if(uMaskInfo.w<.5||target<.5)return 1.;
  float sc=uCanvas.x/uView.x;vec2 c=vec2((vb.x-uView.z)*sc,uCanvas.y-(vb.y-uView.w)*sc);float r=max(rad*sc,1.);float t=target+.5;
  float v=step(maskAt(c),t);
  for(int i=0;i<8;i++){float a=float(i)*.7853982;v+=step(maskAt(c+r*vec2(cos(a),sin(a))),t);}
  return v/9.;
}
`;

/** Half-spaces { n, d } (n·p ≤ d inside) of a built T.hull part, in its group's rest frame, kit metres. */
export function planesOfHull(part, grow = 0) {
  const W = part.world;
  if (!W || !W.faces) throw new Error(`gl-shaders: ${part.name} is not a hull`);
  return W.faces.map((face) => {
    const p = W.points[face.ring[0]];
    return { n: face.n.slice(), d: (face.n[0] * p[0] + face.n[1] * p[1] + face.n[2] * p[2]) * KM + grow };
  });
}

/** Half-spaces of the convex hull of kit-metre points (Node quickhull from the kit), grown by `grow` m. */
export function planesOfPoints(points, convexHull3, grow = 0) {
  const h = convexHull3(points.map((p) => p.slice()), { name: "gl proxy" });
  return h.faces.map((face) => {
    const p = h.points[face.ring[0]];
    return { n: face.n.slice(), d: face.n[0] * p[0] + face.n[1] * p[1] + face.n[2] * p[2] + grow };
  });
}

/**
 * The ray's span through a convex polyhedron (half-spaces in kit metres): `bool <name>(o, d, out p, out n,
 * out span)`. p is the exit point (largest t: the surface nearest the viewer), n the face it leaves through,
 * span = tout − tin (> 0 inside the silhouette, < 0 outside, continuous across it: span/FW(span) is a
 * signed pixel distance to the outline). Also `vec2 <name>Span(o, d)` for proxies.
 */
export function glslConvex(name, planes) {
  const rows = planes.map((h, k) => `  {vec3 N=${v3(h.n)};float den=dot(d,N);float num=${f(h.d)}-dot(o,N);if(den>1e-7){float t=num/den;if(t<tout){tout=t;kk=${k};}}else if(den<-1e-7){tin=max(tin,num/den);}else if(num<0.){tin=1e9;}}`);
  const pick = planes.map((h, k) => `${k ? "else " : ""}if(kk==${k})n=${v3(h.n)};`).join("");
  return `
bool ${name}(vec3 o,vec3 d,out vec3 p,out vec3 n,out float span){
  float tin=-1e9;float tout=1e9;int kk=-1;
${rows.join("\n")}
  span=tout-tin;p=o+tout*d;n=vec3(0.,0.,1.);
  ${pick}
  return kk>=0&&tin<1e8;
}
vec2 ${name}Span(vec3 o,vec3 d){vec3 p;vec3 n;float s;bool h=${name}(o,d,p,n,s);return h&&s>0.?vec2(dot(p-o,d)-s,dot(p-o,d)):vec2(1e9,-1e9);}`;
}

/**
 * A homothetic ring loft (DESIGN §5.1: every facet planar): rings of equal counts, consecutive rings
 * joined facet by facet, capped at both ends, clipped by `flats` ({ n, d } kit metres). The half-spaces go
 * through glslConvex, so `bool <name>(o, d, out p, out n, out span)` hits the nose and tail lofts with the
 * true S0 facets (glslBarrelPolygon is the one-ring special case).
 */
export function glslFrustumPolygon(name, rings, flats = []) {
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const planes = [];
  const centre = rings.flat().reduce((c, p) => [c[0] + p[0], c[1] + p[1], c[2] + p[2]], [0, 0, 0]).map((v) => v / rings.flat().length);
  const add = (a, b, c) => {
    let n = unit(cross(sub3(b, a), sub3(c, a)));
    let d = dot(n, a);
    if (dot(n, centre) > d) {
      n = n.map((x) => -x);
      d = -d;
    }
    if (planes.some((q) => dot(q.n, n) > 1 - 1e-9 && Math.abs(q.d - d) < 1e-6)) return;
    planes.push({ n, d });
  };
  for (let r = 0; r + 1 < rings.length; r++) {
    const A = rings[r];
    const B = rings[r + 1];
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length;
      const area = Math.hypot(...cross(sub3(A[j], A[i]), sub3(B[i], A[i])));
      if (area < 1e-9) continue;
      add(A[i], A[j], B[i]);
    }
  }
  for (const R of [rings[0], rings[rings.length - 1]]) add(R[0], R[1], R[2]);
  for (const fl of flats) planes.push({ n: unit(fl.n), d: fl.d });
  return { planes, glsl: glslConvex(name, planes) };
}

/** `float <name>(float x, out float k)`: the nearest of the sorted stations xs to x, by a balanced if-tree. */
export function glslNearest(name, xs) {
  const s = xs.slice().sort((a, b) => a - b);
  const gen = (lo, hi) => {
    if (lo === hi) return `{k=${f(lo)};return ${f(s[lo])};}`;
    const mid = (lo + hi) >> 1;
    return `if(x<${f((s[mid] + s[mid + 1]) / 2)})${gen(lo, mid)}else ${gen(mid + 1, hi)}`;
  };
  return `float ${name}(float x,out float k){${gen(0, s.length - 1)}}`;
}

/** Signed distance to a 2D polygon (any winding; exact, iq's sdPolygon): `float <name>(vec2 p)`. */
export function glslPolygonSd(name, pts) {
  const n = pts.length;
  const body = pts.map((vi, i) => {
    const vj = pts[(i + n - 1) % n];
    return `  {vec2 e=${v2(vj)}-${v2(vi)};vec2 w=p-${v2(vi)};vec2 b=w-e*clamp(dot(w,e)/dot(e,e),0.,1.);d=min(d,dot(b,b));bvec3 c=bvec3(p.y>=${f(vi[1])},p.y<${f(vj[1])},e.x*w.y>e.y*w.x);if(all(c)||all(not(c)))s=-s;}`;
  });
  return `float ${name}(vec2 p){float d=dot(p-${v2(pts[0])},p-${v2(pts[0])});float s=1.;
${body.join("\n")}
  return s*sqrt(d);}`;
}

/**
 * One window-bearing part (DESIGN §6.2): its hull (the part's own faces), its window rows and its doorways.
 * rows: [{ id, z (row centre), xs (stations, kit m), side (0 both, ±1), w, h, r, pitch }];
 * doors: [{ slot (0..19 into uDoors), x, z (centre), hw, hh, r, side, cargo }].
 * Returns `vec4 <name>(o, d, level)`: dark glow or paper ink, x facing; the window rectangles live in each
 * hit facet's own frame (u along it, v the ring edge, as W.facetFrame), so they sit on the true surface.
 */
/** A closed blind's luminance in the windows program (lit from behind; 1 is a lit pane's rim, about 1.12 its core). */
export const BLIND_LUM = 0.1;
export function glslWindowPart(name, { planes, rows, doors, xr = null }, inks) {
  const hit = glslConvex(`${name}Hit`, planes);
  const nears = rows.map((row, j) => glslNearest(`${name}N${j}`, row.xs)).join("\n");
  // Every fwidth() below runs in uniform control flow: no early return and no branch around it, because
  // derivatives after a divergent branch are undefined (SwiftShader returned a different picture each draw).
  const rowCode = rows
    .map(
      (row, j) => `
  {float i;float xi=${name}N${j}(p.x,i);
    vec3 D=vec3(p.x-xi,0.,p.z-${f(row.z)});D.y=-(n.x*D.x+n.z*D.z)/ny;
    vec2 q=vec2(dot(D,u),dot(D,v));
    float dd=sdRoundRect(q,${v2([row.w / 2, row.h / 2])},${f(row.r)});
    float sharp=1.-smoothstep(-.5,.5,dd/FW(dd));
    float band=1.-smoothstep(-.5,.5,(abs(q.y)-${f(row.h / 2)})/FW(q.y));
    float fine=smoothstep(.3,.5,1./(pxPerM*${f(row.pitch)}));
    float near=${row.side ? `step(0.,side*${f(row.side)})` : "1."}*(1.-step(${f(row.h / 2 + 0.7)},abs(p.z-${f(row.z)})));
    float c=mix(sharp,band*${f(row.w / row.pitch)},fine)*near;
    // the blinds are the fallback's (W.windowBlind, review round 3); the per-window shade varies 10%, not 26% (runs of
    // dimmer windows read as a whole piece losing its glow)
    // (uCabin.z the blinds channel, model.mjs: 1 at the stand, 0 all open from the pushback on, for take-off and landing)
    float blind=1.-(1.-1.${(row.blinds ?? []).map(([k, sd]) => `*(1.-(1.-step(.5,abs(i-${f(k)})))*step(0.,side*${f(sd)}))`).join("")})*uCabin.z;
    // fu/r2-lights: a closed blind is a dim pane lit from behind (lum .1, flat), not a hole: black, it read darker than
    // the card (luminance 11 against 19, the skin 56)
    float shade=(.9+.1*hash12(vec2(i+${f(row.id * 7)},${f(j * 17 + 3)}+side*31.)))*mix(${f(BLIND_LUM)},1.,blind);
    float hot=mix(mix(1.,.62+.5*smoothstep(0.,-.03,dd),blind),.86,fine)*mix(shade,.8,fine);
    lum=mix(lum,hot,c);cov=max(cov,c);shutC=max(shutC,c*(1.-blind));
    halo+=near*(exp(-max(dd,0.)/.14)*(1.-smoothstep(.3,.55,dd))*shade*(1.-fine)+fine*band*.35)*(1.-smoothstep(.3,.55,abs(q.y)-${f(row.h / 2)}));
  }`,
    )
    .join("");
  // review fu-1: each opening in (x, σ) as skin.mjs cuts it (σ the section's arc length, piecewise linear in z on the
  // facets: dw.sig's breakpoints), so the ceiling never stands above the skin's opening; the carpet and ceiling planes are
  // the skin's 0.3 m bands (dw.band, inset)
  const sigOf = (pts) => pts.slice(1).reduce((e, q, i) => `${e}+clamp(p.z-${f(pts[i][0])},0.,${f(q[0] - pts[i][0])})*${f((q[1] - pts[i][1]) / (q[0] - pts[i][0]))}`, f(pts[0][1]));
  const doorCode = doors
    .map((dw) => {
      const fF = dw.band / (2 * dw.hs);
      return `
  {float open=uDoors[${Math.floor(dw.slot / 4)}].${"xyzw"[dw.slot % 4]}*step(0.,side*${f(dw.side)});
   float sg=${sigOf(dw.sig)};
   float dd=sdRoundRect(vec2(p.x-${f(dw.x)},sg-${f(dw.s)}),${v2([dw.hw, dw.hs])},${f(dw.r)});
   float c=(1.-smoothstep(-.5,.5,dd/FW(dd)))*open;
   // the cabin beyond the opening, plane by plane (not one vertical gradient): the carpet dark (.35) with the sill's
   // edge, the galley face at the warm peak, the ceiling at .8; the far jamb's face (the one the reader sees) lit, the
   // near edge in the near jamb's shade
   float up=clamp((sg-${f(dw.s)})/${f(2 * dw.hs)}+.5,0.,1.);
   float jw=clamp(.2*abs(d.x)/max(abs(d.y),.25),.03,${f(dw.hw * 0.5)});
   float sx=(p.x-${f(dw.x)})*(d.x>=0.?1.:-1.);
   float tone=up<${f(fF)}?.35:(up<${f(1 - fF)}?1.:.8);
   tone*=1.-.55*(1.-smoothstep(.0,.035,abs(up-${f(fF)})));
   float far=1.-smoothstep(-${f(dw.hw)}+jw-.02,-${f(dw.hw)}+jw+.02,sx);
   float nearS=smoothstep(${f(dw.hw)}-.18,${f(dw.hw)}-.02,sx);
   tone=mix(tone,.9,far)*(1.-.6*nearS);
   float deep=${dw.cargo ? ".52" : ".8"}*tone;
   dlum=mix(dlum,deep,c);dcov=max(dcov,c);dcargo=max(dcargo,c*${dw.cargo ? "1." : "0."});dceil=max(dceil,c*smoothstep(${f(1 - fF)},${f(1 - fF + 0.06)},up)*(1.-far));}`;
    })
    .join("");
  return `${hit}
${nears}
vec4 ${name}(vec3 o,vec3 d,float level,float cargo){
  vec3 p;vec3 n;float span;
  bool hit=${name}Hit(o,d,p,n,span);
  p=hit?p:o;
  float side=p.y>=0.?1.:-1.;
  // the outer skin only: a strip's inner face (seen through the lifted crown) carries no windows
  float keep=(hit?1.:0.)*step(0.,span)*smoothstep(.04,.3,dot(n,d))*step(.25,n.y*side);
  ${xr ? `keep*=smoothstep(${f(xr[0] + 0.005)},${f(xr[0] + 0.025)},p.x)*(1.-smoothstep(${f(xr[1] - 0.025)},${f(xr[1] - 0.005)},p.x));` : ""}
  float ny=side*max(abs(n.y),.25);
  vec3 v=normalize(vec3(0.,n.z,-ny));v*=sign(v.z+1e-6);
  vec3 u=normalize(cross(v,n));
  float cov=0.;float lum=0.;float halo=0.;float dcov=0.;float dlum=0.;float dcargo=0.;float dceil=0.;float shutC=0.;
  // canvas px per metre along the barrel axis (the window pitch on screen): from the pose, not fwidth, which
  // jumps where a 2x2 quad straddles a facet edge and would turn a row of pixels into the mean band
  vec3 xw=dirFromG(vec3(1.,0.,0.));
  float pxPerM=length(vec2(xw.x*uCam.x-xw.y*uCam.y,(xw.x*uCam.y+xw.y*uCam.x)*uCam.z))*uK*10.*uCanvas.x/uView.x;
  // a window only 2-4 device px across shows mostly its body colour: the pale core fades in with the pane's size, so
  // a 1x window reads amber by daylight, not khaki
  float small=1.-smoothstep(2.,4.,pxPerM*.3);
${rowCode}
${doorCode}
  vec3 W=${v3(inks.windowDark)};vec3 Wc=${v3(inks.cargoDark)};
  // the cabin dimmer through one displayed-luminance curve that the fallback shares (lvD = level^.66: cabin .25 shows
  // at 40% of the gate's light, with the core still warm): exposing the tonemap with the level saturated the core,
  // so a 75% dim read as a 3-10% change
  float lvD=pow(max(level,0.),.66);
  // review round 3: dimmed in energy BEFORE the tonemap, so the light keeps its hue as it falls (scaling the tonemapped
  // core turned a 25% cabin into a neutral grey dot); the gate's core is a warm white, not saturated to white
  vec4 dark=glowOf((W*(lum*2.6*cov+halo*.3)+W*dlum*1.1*dcov*(1.-dcargo))*lvD)+glowOf(Wc*dlum*1.1*dcov*dcargo)*cargo;
  float lv=max(level,1e-3);
  float eS=mix(1.,.45,small);
  vec4 full=lampInk(2.4*lum*eS,${v3(inks.windowRim)},${v3(inks.windowBody)},${v3(inks.windowCore)},.92);
  vec4 dim=lampInk(2.4*lum*eS*(.4+.6*lv),${v3(inks.windowRim)},${v3(inks.windowBody)},${v3(inks.windowCore)},.92);
  // by daylight the saturated body stays as the cabin dims (cover floor .5 of the gate's ink): a dimmed lit window read
  // as an unlit grey pane
  float pc=.5*smoothstep(0.,.4,lvD)+.5*smoothstep(.4,1.,lvD);
  // (fu/r2-lights: a closed blind lays no daylight ink; its dim backlit lum would read as a saturated rim tint)
  vec4 paper=dim*(inkOf(full)/max(inkOf(dim),1e-4))*pc*cov*(1.-shutC)*${f(inks.windowCap)};
  float dl=mix(lvD,cargo,dcargo);
  // paper: the doorway's interior is drawn (warm cavity tokens, plane by plane); the cabin light warms only its
  // ceiling, at a low cap (a .3 tint over the whole opening turned it into an ochre slab)
  // fu/r1-fuselage: the tint scales with the cabin envelope (dl: cabin^.66, or the cargo flood) too; saturated, it held
  // 95% of its strength at cabin .1 while the cabin dimmed
  paper=over(tintInk(dl*dceil*1.2,${inkU("door")},.13)*dl,paper);
  return mix(dark,paper,uLight)*keep;
}`;
}

/**
 * The cockpit (DESIGN §6.2): panes on the canopy loft, seen glowing from the flight deck, with the main
 * instrument panel behind them for parallax; and, with the canopy lifted, the cockpit group's displays.
 * canopy: half-spaces of nose.canopy (cut.fd frame). panes: [{ poly [[y, z]…] (starboard, model m),
 * x: [X0, X1] (kit m), inset }]. panel: { X (kit m, faces kit −x), half (y), displays: [{ y, z, w, h, kind }] }.
 * displays (lifted): [{ c, u, v, n (kit m, cockpit frame), w, h, kind }].
 */
export function glslCockpit({ canopy, panes, panel, displays }, inks) {
  const paneSd = panes.map((pane, i) => glslPolygonSd(`paneSd${i}`, pane.poly)).join("\n");
  // a display's picture: kind 0 PFD (sky over ground, horizon, speed and altitude tapes), 1 ND (compass arc,
  // route), 2 EWD (four N1 dials, memo lines), 3 SD (synoptic lines), 4 MFD (text rows). q in [-.5,.5]^2.
  const content = `
// fu/r2-lights: a symbol line of half-width w (display units) at a pixel of qp display units: at least a pixel wide,
// its ink spread over that pixel (review fu-r2: under GL the SD's rules, a fifth of the others' width, and the ND's route
// broke into dots and dashes at the Cockpit view's zoom, where the no-WebGL symbology drew continuous lines)
float lineQ(float x,float qp,float w){float hw=max(w,.5*qp);return (1.-smoothstep(hw-.004-.5*qp,hw+.004+.5*qp,x))*w/hw;}
vec3 screenOf(float kind,vec2 q,float qp,out float lit){
  vec3 c=vec3(.03,.04,.07);lit=.25;
  if(kind<.5){
    float sky=smoothstep(-.01,.01,q.y-.08*q.x);c=mix(vec3(.45,.27,.12),vec3(.12,.42,.85),sky);lit=.85;
    float hor=lineQ(abs(q.y-.08*q.x),qp,.011);c=mix(c,vec3(1.),hor*.9);
    // fu/r2-interiors: the pitch ladder (5 and 10 degree rungs), the tapes' ticks and their yellow index, a bold aircraft
    // symbol (wings and the centre square); the fallback (parts/cabin.mjs display) draws the same (review: sky and ground only)
    // merge r2: every line through lineQ (fu/r2-lights: at least a pixel wide, so no rung breaks into dots)
    float lad=max(max(lineQ(abs(q.y-.08*q.x-.1),qp,.007)*step(abs(q.x),.06),lineQ(abs(q.y-.08*q.x+.1),qp,.007)*step(abs(q.x),.06)),max(lineQ(abs(q.y-.08*q.x-.2),qp,.007)*step(abs(q.x),.1),lineQ(abs(q.y-.08*q.x+.2),qp,.007)*step(abs(q.x),.1)));
    c=mix(c,vec3(1.),lad*.85);
    float tape=step(.32,abs(q.x));c=mix(c,vec3(.06,.07,.1),tape*.85);
    float tk=lineQ(abs(fract(q.y*10.+.5)-.5)*.1,qp,.007)*step(abs(q.y),.45)*tape*step(abs(q.x),.37);c=mix(c,vec3(.85),tk*.8);
    float idx=lineQ(abs(q.y),qp,.01)*tape;c=mix(c,vec3(1.,.85,.1),idx);
    float wing=max(lineQ(abs(q.y),qp,.016)*step(abs(q.x),.16)*step(.05,abs(q.x)),step(abs(q.x),.015)*step(abs(q.y),.015));c=mix(c,vec3(1.,.85,.1),wing);
    // fu/r2-interiors end
  }else if(kind<1.5){
    float r=length(q-vec2(0.,-.32));float arc=lineQ(abs(r-.62),qp,.01)*step(-.3,q.y);
    float rt=lineQ(abs(q.x-.15*(q.y+.32))*.989,qp,.008)*step(-.3,q.y)*step(q.y,.4);
    c=mix(c,vec3(.9),arc);c=mix(c,vec3(.15,.95,.35),rt);lit=.5;
    // fu/f4-interiors (review f3, craft-dark): the rose's ticks every 10 degrees (every 30 longer) inside the arc, the
    // heading box (inside the rose, under the lubber) with its three digits, the yellow lubber line and aircraft symbol; the fallback (parts/cabin.mjs
    // display) draws the same
    vec2 rq=q-vec2(0.,-.32);float th=atan(rq.x,rq.y);float tk=floor(th/.174533+.5);float tl=mod(tk,3.)<.5?.06:.035;
    float tick=lineQ(r*abs(th-tk*.174533),qp,.006)*step(.62-tl,r)*step(r,.62)*step(-.3,q.y)*step(abs(tk),5.5);
    vec2 bb=abs(q-vec2(0.,.19))-vec2(.06,.045);float bsd=length(max(bb,0.))+min(max(bb.x,bb.y),0.);
    float hbox=max(lineQ(abs(bsd),qp,.006),lineQ(abs(q.y-.19),qp,.006)*(step(abs(q.x+.03),.009)+step(abs(q.x),.009)+step(abs(q.x-.03),.009)));
    c=mix(c,vec3(.9),min(max(tick,hbox),1.));
    float acs=max(max(lineQ(abs(q.x),qp,.008)*(step(abs(q.y-.2675),.0325)+step(abs(q.y+.32),.08)),lineQ(abs(q.y+.3),qp,.008)*step(abs(q.x),.075)),lineQ(abs(q.y+.385),qp,.008)*step(abs(q.x),.03));
    c=mix(c,vec3(1.,.85,.1),min(acs,1.));
    // fu/f4-interiors end
  }else if(kind<2.5){
    // four N1 dials, one per engine, in a row (review round 3: the cell count drew two), q in display units
    vec2 g=vec2((fract((q.x+.5)*4.)-.5)*.25,(q.y-.24)*.76);float dial=lineQ(abs(length(g)-.085),qp,.011)*step(abs(q.x),.49);
    dial=max(dial,lineQ(abs(g.y+g.x*.6)*.857,qp,.008)*step(length(g),.08)*step(g.x,0.));
    float memo=step(.5,fract(q.y*14.))*step(q.y,-.12)*step(abs(q.x+.1),.3);
    c=mix(c,vec3(.95),dial);c=mix(c,vec3(.1,.9,.35),memo*.6);lit=.55;
  }else if(kind<3.5){
    float line=lineQ(abs(fract(q.y*5.)-.5)*.2,qp,.011)*step(abs(q.x),.35)*step(abs(q.y),.4)+lineQ(abs(q.x),qp,.011)*step(abs(q.y),.3);
    c=mix(c,vec3(.15,.95,.4),min(line,1.));lit=.45;
  }else{
    float row=step(.55,fract(q.y*11.))*step(abs(q.x+.05),.38)*step(abs(q.y),.42);
    c=mix(c,vec3(.25,.85,.95),row*.8);lit=.4;
  }
  return c;
}`;
  const paneRows = panes
    .map((pane, i) => `  {float sd=paneSd${i}(q)+${f(pane.inset)};pane=max(pane,(1.-smoothstep(-.5,.5,sd/FW(sd)))*window(p.x,${f(pane.x[0])},${f(pane.x[1])},.025));}`)
    .join("\n");
  const cells = panel.displays
    .map((dp) => `  {vec2 g=vec2(r.y-${f(dp.y)},r.z-${f(dp.z)});float sd=sdRoundRect(g,${v2([dp.w / 2, dp.h / 2])},.012);float c=(1.-smoothstep(-.5,.5,sd/FW(sd)))*inPanel;float l;vec3 sc=screenOf(${f(dp.kind)},g/${v2([dp.w, dp.h])},pixelOf()*${f(KM)}/${f(Math.min(dp.w, dp.h))},l);col=mix(col,sc,c);disp=max(disp,c*l);}`)
    .join("\n");
  const lifted = displays
    .map(
      (dp) => `  {float dn=dot(d,${v3(dp.n)});if(dn>.02){float t=dot(${v3(dp.c)}-o,${v3(dp.n)})/dn;vec3 q=o+t*d-${v3(dp.c)};vec2 g=vec2(dot(q,${v3(dp.u)}),dot(q,${v3(dp.v)}));
    float sd=sdRoundRect(g,${v2([dp.w / 2, dp.h / 2])},.01);float c=(1.-smoothstep(-.5,.5,sd/FW(sd)))*smoothstep(.02,.15,dn);
    if(c>0.){float l;vec3 s=screenOf(${f(dp.kind)},g/${v2([dp.w, dp.h])},pixelOf()*${f(KM)}/${f(Math.min(dp.w, dp.h))}/max(dn,.15),l);col=mix(col,s,c);lit=mix(lit,l,c);cov=max(cov,c);}}}`,
    )
    .join("\n");
  return `${glslConvex("canopyHit", canopy)}
${paneSd}
${content}
vec4 cockpitPanes(vec3 o,vec3 d,float level){
  vec3 p;vec3 n;float span;
  bool hit=canopyHit(o,d,p,n,span);
  p=hit?p:o;
  float face=(hit?1.:0.)*step(0.,span)*smoothstep(.02,.25,dot(n,d));
  vec2 q=vec2(abs(p.y),p.z);
  float pane=0.;
${paneRows}
  // behind the pane: the main panel (facing aft, seen when the viewer is aft of it: d.x < 0 is uniform)
  float disp=0.;vec3 col=${v3(inks.cockpitDark)};
  if(d.x<-.02){
    float s=(${f(panel.X)}-p.x)/(-d.x);vec3 r=p-s*d;
    float inPanel=1.-step(${f(panel.half)},abs(r.y));
${cells}
  }
  float e=1.1+1.6*disp;
  vec4 dark=glowOf(mix(${v3(inks.cockpitDark)},col,disp)*e*level);
  vec4 paper=lampInk(1.7+1.6*disp,${v3(inks.cockpitRim)},${v3(inks.cockpitBody)},${v3(inks.cockpitCore)},.9)*level;
  return mix(dark,paper,uLight)*pane*face;
}
// registration-driven passes (one pane or one display per pass, from M2's and M7's glTargets): a planar
// polygon of up to 32 vertices in its own (u, v) frame, and a display rectangle with its picture
uniform vec3 uPO;uniform vec3 uPU;uniform vec3 uPV;uniform vec3 uPN;
uniform vec2 uPoly[32];
uniform vec4 uPInfo;
float polySdU(vec2 p){
  float d=dot(p-uPoly[0],p-uPoly[0]);float s=1.;
  vec2 prev=uPoly[0];
  for(int k=0;k<32;k++){if(float(k)==uPInfo.x-1.)prev=uPoly[k];}
  for(int i=0;i<32;i++){
    if(float(i)>=uPInfo.x)break;
    vec2 vi=uPoly[i];vec2 vj=prev;prev=vi;
    vec2 e=vj-vi;vec2 w=p-vi;vec2 b=w-e*clamp(dot(w,e)/dot(e,e),0.,1.);d=min(d,dot(b,b));
    bvec3 c=bvec3(p.y>=vi.y,p.y<vj.y,e.x*w.y>e.y*w.x);if(all(c)||all(not(c)))s=-s;
  }
  return s*sqrt(d);
}
vec4 cockpitPaneU(vec3 o,vec3 d,float level){
  float dn=dot(d,uPN);
  float face=smoothstep(.02,.25,dn);
  vec3 p=o+d*(dot(uPO-o,uPN)/(abs(dn)>1e-5?dn:1e-5));
  vec2 q=vec2(dot(p-uPO,uPU),dot(p-uPO,uPV));
  float sd=polySdU(q)+uPInfo.y;
  float pane=(1.-smoothstep(-.5,.5,sd/FW(sd)))*face;
  float disp=0.;vec3 col=${v3(inks.cockpitDark)};
  if(d.x<-.02){
    float s=(${f(panel.X)}-p.x)/(-d.x);vec3 r=p-s*d;
    float inPanel=1.-step(${f(panel.half)},abs(r.y));
${cells}
  }
  // one glass for every pane: a faint, even display glow (dark) and, by daylight, a faint cool tint only (a flight
  // deck's displays cannot be seen from outside in daylight)
  vec4 dark=glowOf(${v3(inks.cockpitDark)}*(.32+.18*disp)*level);
  vec4 paper=tintInk(level*(.6+.4*disp),${v3(inks.cockpitBody)},.1);
  return mix(dark,paper,uLight)*pane;
}
vec4 cockpitDisplayU(vec3 o,vec3 d,float level){
  float dn=dot(d,uPN);
  vec3 q3=o+d*(dot(uPO-o,uPN)/(abs(dn)>1e-5?dn:1e-5))-uPO;
  vec2 g=vec2(dot(q3,uPU),dot(q3,uPV));
  float sd=sdRoundRect(g,uPInfo.zw*.5,.01);
  float c=(1.-smoothstep(-.5,.5,sd/FW(sd)))*smoothstep(.02,.15,dn);
  float lit;vec3 col=screenOf(uPInfo.y,g/uPInfo.zw,pixelOf()*${f(KM)}/min(uPInfo.z,uPInfo.w)/max(abs(dn),.15),lit);
  vec4 dark=glowOf(col*(.6+1.6*lit))*c;
  vec4 paper=inkFor(mix(${inkU("screen")},col,.35+.65*lit),.97)*c;
  return mix(dark,paper,uLight)*level;
}
vec4 cockpitDisplays(vec3 o,vec3 d,float level){
  vec3 col=vec3(0.);float lit=0.;float cov=0.;
${lifted}
  if(cov<=0.)return vec4(0.);
  vec4 dark=glowOf(col*(.6+1.6*lit))*cov;
  vec4 paper=inkFor(mix(${inkU("screen")},col,.35+.65*lit),.97)*cov;
  return mix(dark,paper,uLight)*level;
}`;
}

/**
 * A surface washed by lamps fixed on the airframe or a flap (DESIGN §6.2: logo on the fin, wing and engine
 * scan). Lamps come as uniforms in world kit units (uWS position, uWD direction, uWC = cos outer, cos inner,
 * power x envelope, reach m); `slots` lists the lamps that can reach this target. hull: half-spaces;
 * cone: { c, a, u, v, s0, s1, r0, r1 } kit metres (a nacelle row). `vec4 <name>(o, d)`: ink ending at the
 * outline stroke's inner edge, facing-correct, tinted (dark: glow; paper: tint capped at `cap`).
 */
export function glslWash(name, target, slots, colours) {
  const lamps = slots
    .map((k) => `  {vec4 C=uWC[${k}];if(C.z>0.){vec3 S=toG(uWS[${k}])*${f(KM)};vec3 D=normalize(dirToG(uWD[${k}]));e+=spotAt(p,n,S,D,C);}}`)
    .join("\n");
  let surface;
  if (target.hull) {
    surface = `${glslConvex(`${name}Hit`, target.hull)}
float ${name}Surf(vec3 o,vec3 d,out vec3 p,out vec3 n){float span;bool h=${name}Hit(o,d,p,n,span);span=max(span,-1e3);return (h?1.:0.)*smoothstep(-.5,.5,span/FW(span)-strokePx())*smoothstep(.0,.12,dot(n,d));}`;
  } else {
    const c = target.cone;
    const k = (c.r1 - c.r0) / (c.s1 - c.s0);
    surface = `
float ${name}Surf(vec3 o,vec3 d,out vec3 p,out vec3 n){
  vec3 q=o-${v3(c.c)};vec3 Q=vec3(dot(q,${v3(c.u)}),dot(q,${v3(c.v)}),dot(q,${v3(c.a)}));vec3 E=vec3(dot(d,${v3(c.u)}),dot(d,${v3(c.v)}),dot(d,${v3(c.a)}));
  float r0=${f(c.r0 - k * c.s0)};float k=${f(k)};
  float A=E.x*E.x+E.y*E.y-k*k*E.z*E.z;float B=Q.x*E.x+Q.y*E.y-k*(r0+k*Q.z)*E.z;float Cq=Q.x*Q.x+Q.y*Q.y-(r0+k*Q.z)*(r0+k*Q.z);
  float h=B*B-A*Cq;p=o;n=vec3(0.,0.,1.);
  if(abs(A)<1e-8)return 0.;
  float sq=sqrt(max(h,0.));float t=(-B+sq)/A;float t2=(-B-sq)/A;if(t2>t){float x=t;t=t2;t2=x;}
  float s=Q.z+t*E.z;
  p=o+t*d;vec3 L=Q+t*E;vec3 nl=normalize(vec3(L.x,L.y,-k*(r0+k*L.z)));
  n=nl.x*${v3(c.u)}+nl.y*${v3(c.v)}+nl.z*${v3(c.a)};
  float rim=smoothstep(-.5,.5,h/FW(h)-strokePx());
  float ends=smoothstep(-.5,.5,(s-${f(c.s0)})/FW(s)-strokePx())*smoothstep(-.5,.5,(${f(c.s1)}-s)/FW(s)-strokePx());
  return rim*ends*step(0.,h)*smoothstep(.0,.12,dot(n,d));
}`;
  }
  return `${surface}
vec4 ${name}(vec3 o,vec3 d){
  vec3 p;vec3 n;float cov=${name}Surf(o,d,p,n);
  if(cov<=0.)return vec4(0.);
  float e=0.;
${lamps}
  e*=cov;
  vec4 dark=glowOf(${v3(colours.dark)}*e);
  ${colours.mul ? `// a multiply-like tint (review round 3): the face's own grey pulled warm, its cover tonemapped from the lamps' energy
  // so the wash falls off with height (a yellow over the blue-grey paint read as an olive slab at its cap)
  float wa=${f(colours.cap)}*(1.-exp(-${f(colours.paperGain ?? 1)}*e));
  vec4 paper=vec4(${v3(colours.mul)}*wa,wa);` : `vec4 paper=tintInk(e*${f(colours.paperGain ?? 1)},${v3(colours.tint)},${f(colours.cap)});`}
  return mix(dark,paper,uLight);
}`;
}

/**
 * One point light per pass (DESIGN §6.2 `points`): uPt (x, y viewBox, lens radius viewBox, energy), uPtC
 * (dark rgb, halo scale), uPtP (paper body rgb, white rule 0|1), uPtV (housing paint index, tap radius vb).
 * Dark: a glow (lens, core, halo). Paper (daylight rule): a lens glint, saturated body, pale core and a dark
 * rim, no bloom in air; white lights take the neutral rule (white core, rim .55/.60/.66).
 */
export const GLSL_POINT = `
uniform vec4 uPt;
uniform vec4 uPtC;
uniform vec4 uPtP;
uniform vec4 uPtV;
vec4 pointInk(vec2 vb){
  vec4 P=uPt;if(P.w<=0.)return vec4(0.);
  float px=uView.x/uCanvas.x;
  float r=length(vb-P.xy);float rl=max(P.z,1.4*px);float reach=max(rl*uPtC.w*6.,12.*px);
  if(r>=reach)return vec4(0.);
  float tail=1.-smoothstep(reach*.55,reach,r);
  float lens=1.-smoothstep(rl-.5*px,rl+.5*px,r);
  float core=exp(-r*r/(rl*rl*.2));
  float hs=max(rl*uPtC.w,4.*px);
  // the halo (a glow in the air) fades toward the card's frame as the beams do (review fu-1: at Inspect zoom a lamp's
  // halo from off-frame, cut by the canvas edge, was a bright bar 12-16 CSS px inside the stage edge); the lens does not
  float halo=(exp(-pow(r/hs,2.))*.55+exp(-r/(hs*1.5))*.2)*tail*frameFade();
  // a coloured light keeps its hue to the core (review round 3: the tonemap whitened the nav lenses to mint and pink):
  // intensity tonemapped, the colour not mixed toward white; white lights keep the plain glow. The air canvas is
  // screened over the airframe in dark, so a lens over a wing tip's bright outline (about 146) is already lifted toward
  // grey by it: mixed 30% toward white the tip cores read G-R 60 and R-G 55, 6% R-G 75-83 (follow-up item 29)
  float E=lens*1.3+core*1.6+halo;
  float hm=max(uPtC.r,max(uPtC.g,uPtC.b));
  float iv=1.-exp(-E*hm);
  vec3 hc=uPtC.rgb/max(hm,1e-3)*iv;
  vec4 dark=uPtP.w>.5?glowOf(uPtC.rgb*E):vec4(hc,max(hc.r,max(hc.g,hc.b)));
  float gr=max(rl,2.2*px);
  float g=exp(-pow(r/(gr*1.45),2.))*(1.-smoothstep(gr*2.2,gr*3.,r));
  float e=lens*1.4+core*2.6+g*.9;
  vec3 body=uPtP.rgb;
  vec3 rim=mix(body*vec3(.62,.62,.66),${inkU("white")},uPtP.w);
  vec3 b2=mix(body,mix(${inkU("white")},vec3(1.),.55),uPtP.w);
  vec3 pale=mix(mix(vec3(1.),body,.15),vec3(1.),uPtP.w);
  vec4 paper=lampInk(e,rim,b2,pale,.95)*(1.-smoothstep(gr*2.2,gr*3.,r));
  // fu/r2-lights: a strobe's flash by day (uPtV.z, the flash 0-1): a crisp white core in a thin dark keyline and a short
  // four-ray glint, so each pulse reads on white paint at 1x (review fu-r2: the glint's grey rim alone darkened the tip)
  if(uPtV.z>0.){
    float fr=gr*1.5;
    float cw=1.-smoothstep(fr-.5*px,fr+.5*px,r);
    float key=(1.-smoothstep(fr+.8*px,fr+1.8*px,r))*(1.-cw);
    vec2 dv=abs(vb-P.xy);
    // f4-lights: the rays end at the lens (2.2 fr) and are a pale cool tint, never grey ink: dark rays over the paper
    // read as a reticle mark, not a flash (review f3: luminance 0xb4-0xd0 out to 10 CSS px; webgl.md 8.1, 8.3)
    float ray=(1.-smoothstep(.25*px,.85*px,min(dv.x,dv.y)))*smoothstep(fr,fr+1.5*px,r)*(1.-smoothstep(fr*1.5,fr*2.2,r));
    vec4 fl=over(inkFor(vec3(1.),1.)*cw,over(inkFor(vec3(.28,.31,.36),.92)*key,inkFor(vec3(.93,.96,1.),.25)*ray));
    paper=over(fl*uPtV.z,paper);
  }
  vec4 ink=mix(dark,paper,uLight)*P.w;
  return ink*pointVis(P.xy,max(uPtV.y,rl),uPtV.x);
}`;

/**
 * Spot lamps as uniforms (world kit units): uLS, uLD, uLC = (tan of the horizontal and vertical half-spreads,
 * power x envelope, ±reach m; < 0: no beam). A lamp's beam is elliptical, as the real ones are (a landing light
 * 12 x 10 deg, a turn-off light wide and flat): its horizontal axis is level, so a lamp aimed a few degrees down
 * throws its pool where the true cone meets the ground, mostly beyond the platter (DESIGN §11.7).
 */
export function glslLamps(N) {
  return `
uniform vec3 uLS[${N}];
uniform vec3 uLD[${N}];
uniform vec4 uLC[${N}];
float spotE(vec3 L,vec3 D,vec2 t){
  float ld=dot(L,D);if(ld<=1e-4)return 0.;
  vec3 H=abs(D.z)>.95?vec3(1.,0.,0.):normalize(cross(D,vec3(0.,0.,1.)));vec3 U=cross(H,D);
  vec2 q=vec2(dot(L,H),dot(L,U))/(ld*t);
  return 1.-smoothstep(.45,1.,length(q));
}
float lampPools(vec3 g){
  float e=0.;
  for(int i=0;i<${N};i++){
    vec4 c=uLC[i];if(c.z<=0.)continue;
    vec3 L=g-uLS[i]*${f(KM)};float d2=dot(L,L);float d=sqrt(d2);L/=max(d,1e-4);
    e+=c.z*spotE(L,uLD[i],c.xy)*max(-L.z,0.)*(1.-smoothstep(abs(c.w)*.55,abs(c.w),d))/(d2+1.);
  }
  return e;
}
vec2 coneSpan(vec3 p0,vec3 V,vec3 S,vec3 D,float cosA,vec2 lim){
  vec3 w=p0-S;float vd=dot(V,D);float wd=dot(w,D);float c2=cosA*cosA;
  float a=vd*vd-c2;float b=wd*vd-c2*dot(w,V);float c=wd*wd-c2*dot(w,w);
  vec2 fwd=vd>1e-6?vec2(-wd/vd,1e9):(vd<-1e-6?vec2(-1e9,-wd/vd):(wd>=0.?vec2(-1e9,1e9):vec2(1e9,-1e9)));
  vec2 span=vec2(1e9,-1e9);
  float disc=b*b-a*c;
  if(abs(a)<1e-6){span=fwd;}
  else if(disc<0.){if(a>0.)span=fwd;}
  else{
    float sq=sqrt(disc);float t1=(-b-sq)/a;float t2=(-b+sq)/a;
    if(t1>t2){float x=t1;t1=t2;t2=x;}
    if(a<0.)span=vec2(t1,t2);
    else{vec2 A=vec2(max(-1e9,fwd.x),min(t1,fwd.y));vec2 B=vec2(max(t2,fwd.x),min(1e9,fwd.y));span=(A.y-A.x>B.y-B.x)?A:B;}
  }
  return vec2(max(span.x,max(fwd.x,lim.x)),min(span.y,min(fwd.y,lim.y)));
}
// light scattered toward the eye along the ray inside each beam lamp's cone; side 1 keeps the part of the ray in
// front of the airframe proxies (air canvas), side 0 the part behind (ground canvas, under the airframe SVG);
// faded above the ground; the beam runs its true reach and edgeFade stops it at the card's frame.
// No random jitter: the span is cut into sub-intervals, the 1/(l^2+6) falloff is integrated exactly over each
// (atan), and the slowly varying cone, reach and ground terms are taken at each sub-interval's centre. The result is
// smooth from pixel to pixel (a per-pixel jittered march salted the gear and the runway in the beam with +-6 levels)
float beamSeg(vec3 p0,vec3 V,vec3 S,vec3 D,vec4 c,float a,float b,float n){
  if(b<=a)return 0.;
  vec3 q=p0-S;float qv=dot(q,V);float B=sqrt(max(dot(q,q)-qv*qv,0.)+6.);
  float dt=(b-a)/n;float acc=0.;
  for(int k=0;k<16;k++){
    if(float(k)>=n)break;
    float t0=a+float(k)*dt;float t1=t0+dt;float tm=t0+.5*dt;
    vec3 p=p0+tm*V;vec3 L=p-S;float l=length(L);
    float spot=spotE(L/max(l,1e-4),D,c.xy);
    float w=spot*(1.-smoothstep(c.w*.55,c.w,l))*smoothstep(.05,.8,p.z);
    acc+=w*(atan((t1+qv)/B)-atan((t0+qv)/B))/B;
  }
  return acc;
}
float beams(vec3 p0,vec3 V,float tAir,float side,float steps){
  float sum=0.;
  for(int i=0;i<${N};i++){
    vec4 c=uLC[i];if(c.z<=0.||c.w<=0.)continue;
    vec3 S=uLS[i]*${f(KM)};vec3 D=uLD[i];
    vec2 ball=ballSpan(p0,V,S,c.w);
    if(ball.x>=ball.y)continue;
    float cosW=cos(atan(max(c.x,c.y))+.05);
    vec2 sp=coneSpan(p0,V,S,D,cosW,vec2(max(ball.x,(.05-p0.z)/V.z),ball.y));
    if(sp.y<=sp.x)continue;
    // the side's part of the span: in front of the proxies (t > tAir) or behind them
    vec2 part=side>.5?vec2(max(sp.x,tAir),sp.y):vec2(sp.x,min(sp.y,tAir));
    // more sub-intervals over a long in-beam span (about one per 1.5 m), at most 16
    float n=clamp(floor((part.y-part.x)/1.5),max(steps*.5,4.),16.);
    sum+=beamSeg(p0,V,S,D,c,part.x,part.y,n)*c.z;
  }
  return sum*8e-4;
}
// dark: where a beam lamp's cone meets the ground beyond the platter (DESIGN §11.7: 41-100 m out), a faint soft wash
// with a longer falloff than the platter pools; the caller windows it off the platter and fades it before the frame
float beamPools(vec3 g){
  float e=0.;
  for(int i=0;i<${N};i++){
    vec4 c=uLC[i];if(c.z<=0.||c.w<=0.)continue;
    vec3 L=g-uLS[i]*${f(KM)};float d2=dot(L,L);float d=sqrt(d2);L/=max(d,1e-4);
    e+=c.z*spotE(L,uLD[i],c.xy)*max(-L.z,0.)*(1.-smoothstep(c.w*1.2,c.w*2.6,d))/(.04*d2+30.);
  }
  return e;
}`;
}

/**
 * The inlet, fan and spinner of one nacelle (DESIGN §6.2 `engines`), from the seeded glslEngine with every
 * fwidth() in uniform control flow (no early return after a per-pixel test; d is uniform: the camera is
 * orthographic). e: kit metres { y, z, xl (lip plane), ri (M4's inlet disc), depth (lip to fan), rs, ls
 * (spinner), blades, twist, slit, spiral }. uRun<i> = (fan phase × sense, spinner gain, n1, 0); uGain<i> =
 * blade harmonic gains (fanGains). The fan turns clockwise as the reader sees the inlet (sense from the build).
 */
/** The spinner's painted spiral stripe: half its width, in radians of the spinner's angle (fu/f4-wings). */
export const SPIRAL_HW = 0.1;
export function glslNacelle(i, e) {
  const C = v2([e.y, e.z]);
  const xf = e.xl - e.depth;
  const k2 = (e.rs / e.ls) ** 2;
  return `
uniform vec4 uRun${i};
uniform vec4 uGain${i};
vec4 engine${i}(vec3 o,vec3 d){
  vec4 run=uRun${i};vec4 g=uGain${i};
  if(d.x<.015)return vec4(0.);
  float face=smoothstep(.015,.12,d.x);
  vec3 pl=o+((${f(e.xl)}-o.x)/d.x)*d;float rl=length(pl.yz-${C});
  float open=(1.-smoothstep(-.5,.5,(rl-${f(e.ri)})/FW(rl)+strokePx()))*face;
  vec3 pf=o+((${f(xf)}-o.x)/d.x)*d;vec2 w=pf.yz-${C};float rf=length(w);
  vec2 wall=cylX(o,d,${C},${f(e.ri)});
  float depth=clamp((${f(e.xl)}-(o.x+wall.x*d.x))/${f(e.depth)},0.,1.);
  float onWall=smoothstep(-.5,.5,(rf-${f(e.ri)})/FW(rf));
  float r=rf/${f(e.ri)};
  float u=${f(e.blades)}*(atan(w.y,w.x)-run.x)+${f(e.twist)}*r;
  float fu=length(vec2(dFdx(u),dFdy(u)));
  vec4 G=g*vec4(1.-smoothstep(1.5708,3.14159,fu),1.-smoothstep(1.5708,3.14159,2.*fu),1.-smoothstep(1.5708,3.14159,3.*fu),1.-smoothstep(1.5708,3.14159,4.*fu));
  float saw=G.x*sin(u)+G.y*sin(2.*u)*.5+G.z*sin(3.*u)/3.+G.w*sin(4.*u)*.25;
  float sl=${f(e.slit)};
  float slit=sl+2.*(G.x*sin(3.14159*sl)/3.14159*cos(u)+G.y*sin(6.28318*sl)/6.28318*cos(2.*u)+G.z*sin(9.42478*sl)/9.42478*cos(3.*u)+G.w*sin(12.56637*sl)/12.56637*cos(4.*u));
  float blade=clamp((.52+.3*saw)*(1.-.75*slit),0.,1.);
  // (the blade tips fade into the casing over the last 6% of the radius: at 1-2 device px a row of tips read as a dotted
  // seam against the wall, review round 3)
  float hub=smoothstep(${f(e.rs / e.ri)},${f(e.rs / e.ri + 0.08)},r)*(1.-.8*smoothstep(.93,.995,r));
  // one marked blade (a once-per-rev cue, run.w = its gain: fades in with N1, out as its own blur grows): the reader
  // sees the fan begin to turn at real speed, where the 24 blades blur into a disc from N1 4% (review round 3)
  float mkA=cos(atan(w.y,w.x)-run.x+${f(e.twist)}*r/${f(e.blades)});
  float mk=run.w*smoothstep(.975,.998,mkA)*smoothstep(.42,.55,r)*(1.-smoothstep(.86,.95,r));
  vec3 Lg=normalize(dirToPlane(lightDir()));
  // the spinner (review round 3): half an ellipsoid on the fan plane (semi-axes ls forward, rs across), one surface with
  // one near root, so no mirrored nappe and no far root can be drawn (the double cone drew a half cone and a pale wedge
  // beside it, with a speckled seam where the root choice flipped); soft at its silhouette and base
  vec3 w0=o-vec3(${f(xf)},${f(e.y)},${f(e.z)});
  // fu/wings: solve from the ray's closest approach to the base centre: from o itself (far up the ray) qb*qb and qa*qc
  // are large and nearly equal, and their float difference stepped near the silhouette (the dotted, stepped edge, R18 R39)
  w0+=(-dot(w0,d)/dot(d,d))*d;
  // fu/wings end
  vec3 ie=vec3(${f(1 / (e.ls * e.ls))},${f(1 / (e.rs * e.rs))},${f(1 / (e.rs * e.rs))});
  float qa=dot(d*d,ie);float qb=dot(w0*d,ie);float qc=dot(w0*w0,ie)-1.;
  float qh=qb*qb-qa*qc;
  float t=(-qb+sqrt(max(qh,0.)))/qa;
  vec3 pe=w0+t*d;
  vec3 ps=pe-vec3(${f(e.ls)},0.,0.);float hs=-ps.x;
  float spin=smoothstep(-.5,.5,qh/FW(qh))*smoothstep(-.5,.5,pe.x/FW(pe.x));
  vec3 nr=normalize(pe*ie);
  float spinTone=.35+.55*max(dot(nr,Lg),0.);
  float hz=clamp(hs/${f(e.ls)},0.,1.);
  float su=atan(ps.z,ps.y)-run.x+6.28318*${f(e.spiral)}*hz;
  // fu/f4-wings: the spiral is a painted stripe (half-width ${f(SPIRAL_HW)} rad) on the radii .18-.92 of the base radius, as
  // the no-WebGL spinner draws it; the earlier band (cos(su) > .55-.8, about 115 degrees wide, on every radius) painted the
  // whole base flank near-white by daylight: the pale wedge and notch beside the spinner (f3 review, craft-light). Its
  // anti-alias is a box filter of the stripe over the pixel's angular footprint, from the continuous angle derivative
  // (no atan branch jump), so a footprint that grows at the silhouette only spreads the stripe, never drops it.
  vec2 sq=ps.yz;float s2=max(dot(sq,sq),1e-8);float sk=6.28318*${f(e.spiral)};
  float sdx=(sq.x*dFdx(sq.y)-sq.y*dFdx(sq.x))/s2+sk*dFdx(hz);float sdy=(sq.x*dFdy(sq.y)-sq.y*dFdy(sq.x))/s2+sk*dFdy(hz);
  float sfp=max(length(vec2(sdx,sdy)),1e-4);
  float sa=abs(mod(su+3.14159,6.28318)-3.14159);
  float m=clamp((min(sa+.5*sfp,${f(SPIRAL_HW)})-max(sa-.5*sfp,-${f(SPIRAL_HW)}))/sfp,0.,1.);
  float rho=length(pe.yz)/${f(e.rs)};
  float sband=smoothstep(.15,.22,rho)*(1.-smoothstep(.86,.93,rho));
  // fu/wings: the spiral's anti-alias gate from the surface's facing (smooth per pixel), not fwidth(su), whose 2x2-quad
  // derivative blows up at the silhouette (whole quads dropped the bright stripe there: the rest of the dotted edge)
  float gs=run.y*smoothstep(.06,.3,max(dot(nr,normalize(d)),0.));
  // fu/wings end
  // blurred, the stripe spreads into its duty cycle over the band (the 1-per-rev blur gain run.y)
  float mark=(${f(SPIRAL_HW / Math.PI)}+gs*(m-${f(SPIRAL_HW / Math.PI)}))*sband*smoothstep(-.5,.5,qh/FW(qh));
  // fu/f4-wings end
  float wallTone=pow(1.-depth,1.4);
  vec3 fanD=${inkU("fan")}+${inkU("fanBlade")}*blade*hub+${inkU("fanMark")}*mk;
  vec3 wallD=${inkU("inletDeep")}+${inkU("inletWall")}*wallTone;
  vec3 spinD=${inkU("spinner")}+${inkU("spinnerLit")}*spinTone+${inkU("spinnerMark")}*mark;
  vec3 darkC=mix(mix(fanD,wallD,onWall),spinD,spin);
  // paper: the fan face (a darker disc, .2-.42) apart from the inlet wall (a lighter ramp, .45-.72), so the face reads
  // when the blades band-limit at 1x; a faint swirl above 5% N1 shows the spool-up; the spinner mid-grey, dark-rimmed
  float swirl=smoothstep(.05,.2,run.z)*.05*sin(3.*atan(w.y,w.x)-run.x+7.*r)*hub;
  float fanS=mix(mix(${inkU("fan")}.r,${inkU("fanBlade")}.r,blade*hub)+swirl,${inkU("fanMark")}.r,mk);
  float wallS=mix(${inkU("inletDeep")}.r,${inkU("inletWall")}.r,wallTone);
  float rimS=1.-.22*(1.-smoothstep(0.,3.,qh/FW(qh)));
  float spinS=(mix(${inkU("spinner")}.r,${inkU("spinnerLit")}.r,spinTone)+(${inkU("spinnerMark")}.r-mix(${inkU("spinner")}.r,${inkU("spinnerLit")}.r,spinTone))*mark*.85)*rimS;
  float seen=mix(mix(fanS,wallS,onWall),spinS,spin);
  vec4 dark=vec4(darkC,max(darkC.r,max(darkC.g,darkC.b)));
  vec4 paper=inkFor(vec3(seen,seen*1.01,seen*1.03),.94);
  return mix(dark,paper,uLight)*open;
}`;
}
