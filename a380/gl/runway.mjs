// a380/gl/runway.mjs (M1): the runway-light GLSL generator, build side (DESIGN §5.2, §6.1, §6.2 runway row).
//
// Every light lies in platter space: the platter rides `air`, so a lattice is a row of points at a fixed
// platter y that the page scrolls along platter x by the set's ground distance. Per pixel the shader takes
// its floor point, brings it into the platter frame with toAir() (TURN.poseUniforms(controller, "air",
// "uAir")), and evaluates each row in screen space (the glow is round on screen) and on the floor (the pool
// on the pavement). Fixed geometry (rows, pitches, colours, the platter window) is compiled in; only the
// scroll, the set mix, the per-frame displacement, the threshold position and the levels are uniforms.
//
// The streak term (DESIGN §7.5): a lattice of pitch p moving d per frame is integrated analytically over
// the frame's displacement (each light smeared over [x, x + d]); with a Gaussian kernel the sum over the
// lattice has a closed form (erf), so the result is exact for any d. The point term crossfades into it
// between d = p/6 and p/3, long before point sampling could alias (d > p/2 crawls backward), so no light
// ever crawls backward. Every term is windowed to 0 inside r 38.4 m of the platter axis and by edgeFade
// before every canvas edge.
import { glslPose } from "../../kit/gl.mjs";
import { GLSL_COMMON, glsl } from "./shaders.mjs";

const { f, v3 } = glsl;

/**
 * The fragment source of the runway program.
 * rows: [{ set (0 stand, 1 taxi, 2 runway), y, z, x0, pitch, lens, halo, gain, pool, dark, paper, inset (bool),
 *          range: [a, b] strip range (periodic, units) or null, gate: "thr" or null }]
 * bar:  { set, count, y0, step, z, lens, halo, gain, pool, green: {dark, paper}, red: {dark, paper} } (threshold and
 *       runway-end lights across the runway at the threshold, which the page passes in uThr.x)
 * window: [r0, r1] platter radius (units) where the pixel window falls from 1 to 0; lightWindow: same, per light.
 */
export function runwayFragment({ rows, bar, repeat, window, lightWindow, theme = "dark" }) {
  const paperInk = theme === "light";
  const rowCode = rows.map((R, i) => rowAlong(R, i, repeat, lightWindow, paperInk)).join("\n");
  const barCode = bar ? rowAcross(bar, paperInk) : "";
  return `${GLSL_COMMON}
${glslPose("Air")}
uniform vec3 uScroll;   // per set (stand, taxi, runway): scroll along platter +x, units, in [0, repeat)
uniform vec3 uSetMix;   // per set weight: set mix x seek fade x altitude fade
uniform vec3 uStreak;   // per set: this frame's displacement (units, signed); lights move by -d along platter x
uniform vec4 uThr;      // x: the threshold's platter x (units; -1e5 when there is none), y: its group weight, zw: the
                        // viewer's floor direction in the platter frame (unit)
uniform vec4 uAxO;      // the platter frame on screen (affine): xy = project(fromAir(0)), zw = per unit platter x
uniform vec4 uAxYZ;     // xy = per unit platter y, zw = per unit z
uniform float uLevel;   // the lights' own settled level
float erfA(float x){
  float s=x<0.?-1.:1.;float a=abs(x);
  float t=1./(1.+.3275911*a);
  float y=1.-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*exp(-a*a);
  return s*y;
}
// the comb antiderivative in index units: sum_j of the integral up to x of exp(-((s-j)L/sg)^2) ds (sg << L)
float combA(float x,float L,float sg){float J=floor(x+.5);return 1.7724539*sg/L*(J+.5*(1.+erfA((x-J)*L/sg)));}
// the comb kernel averaged over the streak [u - lam, u] (index units, lam signed, |lam| >= 1/6 where used)
float combStreak(float u,float lam,float L,float sg){return (combA(u,L,sg)-combA(u-lam,L,sg))/lam;}
// one light smeared over a screen segment of length len (along the segment s_par from the light, sg the kernel)
float segStreak(float sPar,float len,float sg){return .886227*sg/len*(erfA(sPar/sg)-erfA((sPar-len)/sg));}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  float px=uView.x/uCanvas.x;
  vec3 g=onFloor(vb,0.);
  vec3 q=toAir(g);
  float rq=length(q.xy);
  float win=1.-smoothstep(${f(window[0])},${f(window[1])},rq);
  if(win<=0.||uLevel<=0.){gl_FragColor=vec4(0.);return;}
  vec2 va=uThr.zw;
  float bidir=mix(.35,1.,smoothstep(.15,.85,abs(va.x)));   // inset lights beam along the runway, both ways
  ${paperInk ? "vec4 paper=vec4(0.);" : "vec3 glow=vec3(0.);"}
  // the platter frame on screen: project(fromAir(p)) = PO + p.x PX + p.y PY + p.z PZ (affine), shared by every row
  vec2 PO=uAxO.xy;vec2 PX=uAxO.zw;vec2 PY=uAxYZ.xy;vec2 PZ=uAxYZ.zw;
  float lX=length(PX);vec2 hX=PX/lX;
${rowCode}
${barCode}
  ${paperInk ? "if(paper.a<=0.){gl_FragColor=vec4(0.);return;}" : "if(glow.r+glow.g+glow.b<=0.){gl_FragColor=vec4(0.);return;}"}   // far from every light
  vec4 ink=${paperInk ? "paper" : "glowOf(glow)"}*win*uLevel;
  gl_FragColor=finish(ink*uFirst*edgeFade(vb));
}`;
}

const comp = (set) => ["x", "y", "z"][set];

// A row of lights along platter x (the scroll axis): centreline and edge lights. Dark: glow (lens, core, two halo
// Gaussians) and a coloured pool; paper (daylight rule): a glint with a small rim and a pale core, and no pavement tint
// (review fu-1: a .05 tint still read as a pink stain 17 CSS px round each red light; a runway light does not tint the
// pavement by day, webgl.md 8.3).
function rowAlong(R, i, repeat, lightWindow, paperInk) {
  const c = comp(R.set);
  const s = R.set;
  const gate = R.range
    ? `float gx=mod(xl+s${i}-${f(R.range[0])},${f(repeat)});float gate=step(gx,${f(R.range[1] - R.range[0])});
    float gxs=mod(q.x+s${i}-${f(R.range[0])},${f(repeat)});float gateS=smoothstep(0.,20.,gxs)*(1.-smoothstep(${f(R.range[1] - R.range[0] - 20)},${f(R.range[1] - R.range[0])},gxs));`
    : R.gate === "thr"
      ? `float gate=step(uThr.x-1.,xl);float gateS=smoothstep(uThr.x-30.,uThr.x,q.x);`
      : "float gate=1.;float gateS=1.;";
  const dark = v3(R.dark);
  const body = v3(R.paper);
  // (a colour may come as its ink uniform, follow-up item 35: the rim and core are then GLSL of it)
  const rim = typeof R.paper === "string" ? `(${R.paper}*.86)` : v3(R.paper.map((x) => x * 0.86));
  const core = typeof R.paper === "string" ? `mix(vec3(1.),${R.paper},.12)` : v3(R.paper.map((x) => 1 - 0.12 * (1 - x)));
  const point = paperInk
    ? `float rp=rl*1.6;
    float eP=lens*1.2+core*2.4+exp(-r2/(rp*rp))*.5;`
    : `float rh2=rh*rh;
    float eP=lens*1.2+core*1.4+exp(-r2/rh2)*.55+exp(-r2/(rh2*4.))*.18;`;
  const streak = paperInk
    ? `eS=lensS*1.2+coreS*2.4+combStreak(u,lam,bl,rp)*exp(-pw*pw/(rp*rp))*.5;`
    : `eS=lensS*1.2+coreS*1.4+combStreak(u,lam,bl,rh)*exp(-pw*pw/rh2)*.55+combStreak(u,lam,bl,rh*2.)*exp(-pw*pw/(rh2*4.))*.18;`;
  const ink = paperInk
    ? `vec4 lampP=lampInk(eP*g,${rim},${body},${core},.95)*lw;
    vec4 lampS=ws>0.?lampInk(eS*g,${rim},${body},${core},.95)*gateS:vec4(0.);
    paper=over(mix(lampP,lampS,ws)*w*wG,paper);`
    : `glow+=${dark}*(mix(eP*lw,eS*gateS,ws)*g*wG+pl*.32)*w;`;
  return `  // row ${i}: set ${s}, y ${R.y}, pitch ${R.pitch}${R.inset ? ", inset bidirectional" : ", elevated"}
  if(uSetMix.${c}>0.){
    float s${i}=uScroll.${c};float dd=uStreak.${c};
    float ph=mod(${f(R.x0)}-s${i},${f(R.pitch)});
    vec2 a=PO+ph*PX+${f(R.y)}*PY+${f(R.z)}*PZ;
    float bl=${f(R.pitch)}*lX;vec2 bh=hX;
    vec2 rel=vb-a;
    float u=dot(rel,bh)/bl;
    float pw=dot(rel,vec2(-bh.y,bh.x));
    float rl=max(${f(R.lens)}*uK,.55*px);
    float rh=rl*${f(R.halo)};
    float dy=q.y-${f(R.y)};
    // only pixels near the row on screen (glow) or on the floor (pool) do any more work; both windows reach 0
    if(abs(pw)<rh*5.||abs(dy)<${f(R.pool * 2.6)}){
    float wG=1.-smoothstep(rh*4.,rh*5.,abs(pw));
    float wP=1.-smoothstep(${f(R.pool * 2)},${f(R.pool * 2.6)},abs(dy));
    float j=floor(u+.5);
    float xl=ph+j*${f(R.pitch)};
    ${gate}
    float lw=(1.-smoothstep(${f(lightWindow[0])},${f(lightWindow[1])},length(vec2(xl,${f(R.y)}))))*gate;
    float da=(u-j)*bl;
    float r2=da*da+pw*pw;
    float lens=1.-smoothstep(rl-.5*px,rl+.5*px,sqrt(r2));
    float core=exp(-r2/(rl*rl*.2));
    ${point}
    // the floor pool around each light (platter units)
    float uf=(q.x-ph)/${f(R.pitch)};float jf=floor(uf+.5);
    float dx=(uf-jf)*${f(R.pitch)};
    float xf=ph+jf*${f(R.pitch)};
    float gf=${R.range ? `step(mod(xf+s${i}-${f(R.range[0])},${f(repeat)}),${f(R.range[1] - R.range[0])})` : R.gate === "thr" ? "step(uThr.x-1.,xf)" : "1."};
    float pool=exp(-(dx*dx+dy*dy)/${f(R.pool * R.pool)})*(1.-smoothstep(${f(lightWindow[0])},${f(lightWindow[1])},length(vec2(xf,${f(R.y)}))))*gf;
    float lam=dd/${f(R.pitch)};
    float ws=smoothstep(1./6.,1./3.,abs(lam));
    float eS=0.;float pS=0.;
    if(ws>0.){
      float sl=rl*.75;float sc=rl*.45;
      float lensS=combStreak(u,lam,bl,sl)*exp(-pw*pw/(sl*sl));
      float coreS=combStreak(u,lam,bl,sc)*exp(-pw*pw/(sc*sc));
      ${streak}
      pS=combStreak(uf,lam,${f(R.pitch)},${f(R.pool)})*exp(-dy*dy/${f(R.pool * R.pool)})*gateS;
    }
    // physical light (gain, beam direction) in the energy; every fade multiplies the finished ink once
    float g=${f(R.gain)}${R.inset ? "*bidir" : ""};
    float w=uSetMix.${c};
    float pl=mix(pool,pS,ws)*g*wP;
    ${ink}
    }
  }`;
}

// The threshold (green toward the approach, -x) and runway-end (red toward the runway, +x) lights: one row
// across the runway at the threshold, which moves with the runway set. Each light streaks on its own.
function rowAcross(B, paperInk) {
  const c = comp(B.set);
  const n = B.count;
  const gD = v3(B.green.dark);
  const rD = v3(B.red.dark);
  const gP = v3(B.green.paper);
  const rP = v3(B.red.paper);
  const point = paperInk ? `float rp=rl*1.6;float eP=lens*1.2+core*2.4+exp(-r2/(rp*rp))*.5;` : `float eP=lens*1.2+core*1.4+exp(-r2/(rh*rh))*.55+exp(-r2/(rh*rh*4.))*.18;`;
  const streak = paperInk
    ? `eS=segStreak(sp,len,sl)*exp(-pw*pw/(sl*sl))*1.2+segStreak(sp,len,sc)*exp(-pw*pw/(sc*sc))*2.4+segStreak(sp,len,rp)*exp(-pw*pw/(rp*rp))*.5;`
    : `eS=segStreak(sp,len,sl)*exp(-pw*pw/(sl*sl))*1.2+segStreak(sp,len,sc)*exp(-pw*pw/(sc*sc))*1.4
        +segStreak(sp,len,rh)*exp(-pw*pw/(rh*rh))*.55+segStreak(sp,len,rh*2.)*exp(-pw*pw/(rh*rh*4.))*.18;`;
  // each face has its own directional lobe and the two never overlap: side-on both fall to dark (review fu-1: one colour
  // mixed toward the other across 70° of bearings read olive, salmon or brown side-on); by day no pavement tint
  const ink = paperInk
    ? `vec3 pp=gW>rW?${gP}:${rP};
    vec4 lampP=lampInk(eP*g,pp*.86,pp,mix(vec3(1.),pp,.12),.95);
    vec4 lampS=ws>0.?lampInk(eS*g,pp*.86,pp,mix(vec3(1.),pp,.12),.95):vec4(0.);
    paper=over(mix(lampP,lampS,ws)*w*wB,paper);`
    : `glow+=(gW>rW?${gD}:${rD})*(mix(eP,eS,ws)*g+pl*.3)*w*wB;`;
  return `  // threshold and runway-end lights across the runway at uThr.x
  if(uSetMix.${c}>0.&&uThr.y>0.){
    float tx=uThr.x;float dd=uStreak.${c};
    float dxf=q.x-tx;
    // only pixels within the glow's floor reach of the bar (and its streak) do any more work
    float dseg=max(0.,max(min(0.,dd)-dxf,dxf-max(0.,dd)));   // floor distance to the swept segment [tx, tx + dd]
    if(dseg<${f(B.reach)}){
    float wB=1.-smoothstep(${f(B.reach * 0.75)},${f(B.reach)},dseg);
    vec2 a=PO+tx*PX+${f(B.y0)}*PY+${f(B.z)}*PZ;
    vec2 by=${f(B.step)}*PY;
    vec2 bx=PX;
    vec2 rel=vb-a;
    float det=bx.x*by.y-bx.y*by.x;
    float iy=(bx.x*rel.y-bx.y*rel.x)/det;
    float k=clamp(floor(iy+.5),0.,${f(n - 1)});
    vec2 rk=rel-k*by;
    float yk=${f(B.y0)}+k*${f(B.step)};
    float lw=1.-smoothstep(${f(B.lightWindow[0])},${f(B.lightWindow[1])},length(vec2(tx,yk)));
    float rl=max(${f(B.lens)}*uK,.55*px);
    float rh=rl*${f(B.halo)};
    float r2=dot(rk,rk);
    float lens=1.-smoothstep(rl-.5*px,rl+.5*px,sqrt(r2));
    float core=exp(-r2/(rl*rl*.2));
    ${point}
    float dyf=q.y-yk;
    float pool=exp(-(dxf*dxf+dyf*dyf)/${f(B.pool * B.pool)});
    float ws=smoothstep(1./6.,1./3.,abs(dd)/${f(B.streakPitch)});
    float eS=0.;float pS=0.;
    if(ws>0.){
      float bl=length(bx);vec2 eh=bx/bl*sign(dd);
      float len=abs(dd)*bl;
      float sp=dot(rk,eh);float pw=dot(rk,vec2(-eh.y,eh.x));
      float sl=rl*.75;float sc=rl*.45;
      ${streak}
      float spf=dxf*sign(dd);
      pS=segStreak(spf,abs(dd),${f(B.pool)})*exp(-dyf*dyf/${f(B.pool * B.pool)});
    }
    // the approach side (va.x < 0) sees green, the runway side red; inset directional lights, dark side-on
    float gW=smoothstep(0.,.35,-va.x);float rW=smoothstep(0.,.35,va.x);
    float g=${f(B.gain)}*(gW+rW);                           // (one of the two is 0: the lobe of the face seen)
    float w=uSetMix.${c}*uThr.y*lw;
    float pl=mix(pool,pS,ws)*g;
    ${ink}
    }
  }`;
}

/** The uniforms the page sets (glLayer needs every name). */
export const RUNWAY_UNIFORMS = ["uAirX", "uAirY", "uAirZ", "uAirT", "uAxO", "uAxYZ", "uScroll", "uSetMix", "uStreak", "uThr", "uLevel", "uFirst"];
