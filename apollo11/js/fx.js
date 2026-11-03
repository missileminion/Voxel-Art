// Visual effects: engine plumes, RCS jets, re-entry plasma, parachutes.
import * as THREE from '../../app/js/vendor/three.module.js';

const LD_V = '#include <common>\n#include <logdepthbuf_pars_vertex>\n', LD_F = '#include <logdepthbuf_pars_fragment>\n';
const NOISE = `
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }`;

// ---------------------------------------------------------------- engine plumes
// Plume = soft volumetric cone drawn as nested additive shells. Parameters per engine (educated from photos):
//   F-1  (RP-1/LOX): opaque yellow-white core, a dark sooty sheath at the nozzle exit (turbine exhaust film), orange body
//   J-2  (LH2/LOX):  nearly transparent; faint blue-violet glow, very wide in vacuum
//   SPS/DPS/APS (Aerozine-50/N2O4, vacuum): faint, translucent yellow-orange
//   RCS (MMH/N2O4, 445 N): short bright flash with a faint wide cone
//   LES / solids: bright white-orange
export const PLUMES = {
  f1:  { len: 55, r0: 1.85, r1: 6.5, core: 0xfff3c8, mid: 0xffb040, edge: 0xc04a10, a: 1.6, soot: 0.55, shells: 3 },
  j2:  { len: 20, r0: 1.0, r1: 5.0, core: 0xdfe6ff, mid: 0x9aa8ff, edge: 0x5a3cff, a: 0.07, soot: 0, shells: 2 },
  sps: { len: 12, r0: 1.25, r1: 4.5, core: 0xfff0d8, mid: 0xffd0a0, edge: 0xffa070, a: 0.045, soot: 0, shells: 2 },
  dps: { len: 8, r0: 0.75, r1: 3.0, core: 0xfff0d8, mid: 0xffd0a0, edge: 0xffa070, a: 0.04, soot: 0, shells: 2 },
  aps: { len: 6, r0: 0.45, r1: 2.0, core: 0xfff0d8, mid: 0xffc890, edge: 0xff9a60, a: 0.06, soot: 0, shells: 2 },
  rcs: { len: 1.6, r0: 0.05, r1: 0.55, core: 0xffffff, mid: 0xfff0d8, edge: 0xffb070, a: 0.9, soot: 0, shells: 1 },
  solid: { len: 12, r0: 0.3, r1: 2.2, core: 0xfffbea, mid: 0xffc060, edge: 0xff7a30, a: 1.4, soot: 0, shells: 2 },
};
function plumeMaterial(P, shell) {
  return new THREE.ShaderMaterial({
    uniforms: { core: { value: new THREE.Color(P.core) }, mid: { value: new THREE.Color(P.mid) }, edge: { value: new THREE.Color(P.edge) },
                a: { value: P.a / (shell + 1) }, soot: { value: P.soot }, time: { value: 0 }, k: { value: 1 }, vac: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    vertexShader: LD_V + `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: LD_F + NOISE + `uniform vec3 core; uniform vec3 mid; uniform vec3 edge; uniform float a; uniform float soot; uniform float time; uniform float k; uniform float vac;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        #include <logdepthbuf_fragment>
        float s = 1.0 - vUv.y;                                 // 0 at the nozzle, 1 at the tail
        float facing = pow(abs(dot(vN, vV)), 0.6);             // soft, volume-like edges
        float turb = n2(vec2(vUv.x * 14.0, s * 9.0 - time * 18.0)) * 0.5 + n2(vec2(vUv.x * 31.0, s * 23.0 - time * 31.0)) * 0.5;
        float body = pow(1.0 - s, 1.2 + vac * 1.5) * (0.65 + 0.55 * turb);
        float sootBand = soot * smoothstep(0.0, 0.03, s) * (1.0 - smoothstep(0.05, 0.13, s));
        vec3 c = mix(core, mid, smoothstep(0.0, 0.45, s)); c = mix(c, edge, smoothstep(0.35, 1.0, s));
        float i = body * facing * a * k * (1.0 - sootBand);
        gl_FragColor = vec4(c * i, 1.0); }`,
  });
}
export function makePlume(type) {
  const P = PLUMES[type], g = new THREE.Group(); g.userData.mats = [];
  for (let s = 0; s < P.shells; s++) {
    const geo = new THREE.CylinderGeometry(P.r0 * (1 + s * 0.35), P.r1 * (1 + s * 0.5), P.len * (1 - s * 0.15), 40, 8, true); geo.translate(0, -P.len * (1 - s * 0.15) / 2, 0);
    const m = new THREE.Mesh(geo, plumeMaterial(P, s)); m.frustumCulled = false; g.add(m); g.userData.mats.push(m.material);
  }
  g.userData.type = type; g.visible = false;
  g.userData.set = (on, k = 1, vac = 0, time = 0) => {
    g.visible = on && k > 0.01; if (!g.visible) return;
    for (const m of g.userData.mats) { m.uniforms.k.value = k; m.uniforms.vac.value = vac; m.uniforms.time.value = time; }
    const e = (type === 'f1') ? vac : vac * 0.15; g.scale.set(1 + e * 2.5, 1 + e * 1.2, 1 + e * 2.5);
  };
  return g;
}

// ---------------------------------------------------------------- RCS jets
// A quad is a cluster of nozzles; each spec gives its position (in the owner's frame, or the parent's for a sub-assembly)
// and the exhaust directions of its nozzles. Jets are chosen physically: a rotation lights the nozzles whose thrust
// (opposite the exhaust) makes a torque about the centre of mass along the commanded angular acceleration; a
// translation lights the nozzles whose exhaust points opposite the commanded velocity change.
const V = (x, y, z) => new THREE.Vector3(x, y, z);
export function makeRcsQuad(dirs, offsets) {
  const q = new THREE.Group();
  q.userData.jets = dirs.map((d0, i) => {
    const d = d0.clone().normalize(), p = makePlume('rcs'); p.quaternion.setFromUnitVectors(V(0, -1, 0), d);
    p.position.copy(d).multiplyScalar(offsets ? offsets[i] : 0.18); q.add(p);
    p.userData.dir = d; p.userData.until = 0; return p;
  });
  return q;
}
// Apollo SM quad: two nozzles fire along the long axis (fore/aft, pitch & yaw), two tangentially (roll)
export function smQuadSpecs(r = 2.2, y = 3.1, phase = 7.25 * Math.PI / 180) {
  return [0, 1, 2, 3].map(k => { const a = Math.PI / 2 * k + phase, rad = V(Math.cos(a), 0, Math.sin(a)), tan = V(-Math.sin(a), 0, Math.cos(a));
    return { p: rad.clone().multiplyScalar(r).setY(y), dirs: [V(0, 1, 0), V(0, -1, 0), tan, tan.clone().negate()], off: [0.62, 0.62, 0.36, 0.36] }; });
}
// LM ascent-stage quad (45 deg between the body axes): up- and down-firing nozzles plus two side nozzles along the body axes
export function lmQuadSpecs(points) {
  return points.map(p => ({ p, dirs: [V(0, 1, 0), V(0, -1, 0), V(Math.sign(p.x), 0, 0), V(0, 0, Math.sign(p.z))], off: [0.3, 0.3, 0.25, 0.25] }));
}
// CM reaction control (12 nozzles, approximate layout): pitch and yaw pairs high on the cone, two roll pairs low
export function cmQuadSpecs() {
  const out = [];
  for (const [x, z] of [[0, 0.87], [0, -0.87], [0.87, 0], [-0.87, 0]]) { const rad = V(x, 0, z).normalize().multiplyScalar(0.55);
    out.push({ p: V(x, 2.5, z), dirs: [V(0, 1, 0).add(rad), V(0, -1, 0).add(rad)], off: [0.12, 0.12] }); }
  for (const x of [1.57, -1.57]) out.push({ p: V(x, 1.0, 0), dirs: [V(0, 0, 1), V(0, 0, -1)], off: [0.12, 0.12] });
  return out;
}
export class RCS {
  constructor() { this.quads = []; this.prevQ = new Map(); this.prevW = new Map(); this.lastHold = new Map(); }
  // owner: object whose attitude the jets act on; parent: where the quads hang (owner or a child of it, offset 'parentOffset')
  attach(owner, specs, { key = 'rcsQuads', com = V(0, 0, 0), parent = owner, parentOffset = V(0, 0, 0) } = {}) {
    const list = specs.map(sp => { const q = makeRcsQuad(sp.dirs, sp.off); q.position.copy(sp.p); parent.add(q); q.userData.posObj = sp.p.clone().add(parentOffset); return q; });
    owner.userData[key] = list; owner.userData[key + 'Com'] = com; this.quads.push(...list); return list;
  }
  // translation: light the jets whose exhaust points along 'dirWorld'
  pulse(obj, dirWorld, dur = 0.25, nowReal, key = 'rcsQuads') {
    const qs = obj.userData[key]; if (!qs) return; const d = dirWorld.clone().applyQuaternion(obj.quaternion.clone().invert()).normalize();
    // jets along the body axis nearest the commanded direction (off-axis translations combine two or three axes)
    for (const q of qs) for (const j of q.userData.jets) { const c = j.userData.dir.dot(d); if (c > 0.45) j.userData.until = Math.max(j.userData.until, nowReal + dur * Math.min(1, c / 0.9)); }
  }
  // rotation: light the jets whose torque about the centre of mass lies along the angular acceleration (body frame)
  torque(obj, alphaLocal, dur, nowReal, key = 'rcsQuads') {
    const qs = obj.userData[key]; if (!qs || alphaLocal.lengthSq() === 0) return; const a = alphaLocal.clone().normalize(), com = obj.userData[key + 'Com'];
    for (const q of qs) { const r = q.userData.posObj.clone().sub(com);
      for (const j of q.userData.jets) { const tq = new THREE.Vector3().crossVectors(r, j.userData.dir.clone().negate());
        if (tq.lengthSq() > 1e-6 && tq.normalize().dot(a) > 0.55) j.userData.until = Math.max(j.userData.until, nowReal + dur); } }
  }
  // scripted rotations (transposition & docking): angular acceleration from successive attitudes
  attitude(obj, simDt, nowReal, enabled, key = 'rcsQuads') {
    const id = obj.uuid + key, q = obj.quaternion.clone(), pq = this.prevQ.get(id); this.prevQ.set(id, q);
    if (!pq || !enabled || simDt <= 0 || simDt > 30) { this.prevW.set(id, null); return; }
    const w = rotVec(q.clone().multiply(pq.clone().invert())).divideScalar(simDt), pw = this.prevW.get(id); this.prevW.set(id, w.clone());
    if (!pw) return; const alpha = w.clone().sub(pw).divideScalar(simDt); if (alpha.length() < 4e-4) return;
    this.torque(obj, alpha.applyQuaternion(obj.quaternion.clone().invert()), 0.15, nowReal, key);
  }
  // attitude hold inside a deadband: occasional minimum-impulse couples about a random axis
  hold(obj, simDt, nowReal, ratePerSimS, key = 'rcsQuads') {
    if (simDt <= 0 || ratePerSimS <= 0) return; const id = obj.uuid + key, last = this.lastHold.get(id) || 0;
    if (nowReal - last < 0.6 || Math.random() > 1 - Math.exp(-ratePerSimS * simDt)) return; this.lastHold.set(id, nowReal);
    const ax = [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)][Math.floor(Math.random() * 3)].multiplyScalar(Math.random() < 0.5 ? -1 : 1);
    this.torque(obj, ax, 0.08 + Math.random() * 0.08, nowReal, key);
  }
  update(nowReal) {
    for (const q of this.quads) for (const j of q.userData.jets) {
      const on = nowReal < j.userData.until && q.parent && q.parent.visible; j.userData.set(on, on ? 0.75 + 0.25 * Math.random() : 0, 1, nowReal);
    }
  }
}
function rotVec(dq) {   // quaternion -> rotation vector (axis * angle)
  const q = dq.clone(); if (q.w < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; }
  const s = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z); if (s < 1e-12) return V(0, 0, 0);
  const ang = 2 * Math.atan2(s, q.w); return V(q.x, q.y, q.z).multiplyScalar(ang / s);
}
// Attitude control: the vehicle turns toward its commanded attitude at a limited rate and angular acceleration
// (bang-coast-bang, as the autopilot did), tracking the target's own rotation. step() returns the body-frame angular
// acceleration it applied, which is what the jets have to produce.
export class Slew {
  constructor(rateDeg, accDeg) { this.wmax = rateDeg * Math.PI / 180; this.acc = accDeg * Math.PI / 180; this.q = null; this.qT = null; this.t = null; this.w = V(0, 0, 0); }
  snap(q, t) { this.q = q.clone(); this.qT = q.clone(); this.t = t; this.w.set(0, 0, 0); this.fresh = true; this.aAvg = V(0, 0, 0); }
  step(qT, t) {
    const out = { q: null, alpha: V(0, 0, 0), firing: false };
    const h = this.t === null ? -1 : t - this.t;
    if (!this.q || h < 0 || h > 120) { this.snap(qT, t); out.q = this.q.clone(); return out; }
    if (h === 0) { out.q = this.q.clone(); return out; }
    let wT = rotVec(qT.clone().multiply(this.qT.clone().invert())).divideScalar(h); if (wT.length() > 0.05) wT.set(0, 0, 0);   // target jumped (mode change): no feed-forward
    if (this.fresh) { this.fresh = false; this.w.copy(wT); this.q = qT.clone(); this.qT = qT.clone(); this.t = t; out.q = this.q.clone(); return out; }   // first step after a snap: adopt the target's rate
    const n = Math.min(240, Math.ceil(h / 0.25)), hs = h / n, dwSum = V(0, 0, 0), qa = this.qT.clone();
    for (let i = 1; i <= n; i++) {
      const qTi = qa.clone().slerp(qT, i / n), e = rotVec(qTi.clone().multiply(this.q.clone().invert())), th = e.length();
      const sp = th < 0.003 ? th / 3 : Math.min(this.wmax, 0.9 * Math.sqrt(2 * this.acc * th));
      const wDes = wT.clone().add(th > 1e-9 ? e.multiplyScalar(sp / th) : V(0, 0, 0));
      const dw = wDes.sub(this.w), lim = this.acc * hs; if (dw.length() > lim) dw.setLength(lim);
      this.w.add(dw); dwSum.add(dw);
      const ang = this.w.length() * hs; if (ang > 0) this.q.premultiply(new THREE.Quaternion().setFromAxisAngle(this.w.clone().normalize(), ang)).normalize();
    }
    this.qT = qT.clone(); this.t = t;
    out.q = this.q.clone(); out.alpha = dwSum.divideScalar(h).applyQuaternion(this.q.clone().invert());
    this.aAvg = (this.aAvg || V(0, 0, 0)).lerp(out.alpha, 1 - Math.exp(-h / 0.3));   // smoothed: frame-time noise never fires a jet
    out.firing = this.aAvg.length() > this.acc * 0.35; out.alpha = this.aAvg.clone();
    return out;
  }
}

// ---------------------------------------------------------------- re-entry: shock layer on the heat shield + glowing wake
export function makeEntryGlow() {
  const g = new THREE.Group();
  const shockMat = new THREE.ShaderMaterial({ uniforms: { k: { value: 0 }, time: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    vertexShader: LD_V + 'varying vec3 vP; varying vec3 vN; varying vec3 vV; void main(){ vP = position; vec4 w = modelMatrix * vec4(position,1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w;\n#include <logdepthbuf_vertex>\n}',
    fragmentShader: LD_F + NOISE + `uniform float k; uniform float time; varying vec3 vP; varying vec3 vN; varying vec3 vV;
      void main(){
        #include <logdepthbuf_fragment>
        float r = length(vP.xz) / 2.4; float rim = pow(1.0 - abs(dot(vN, vV)), 1.5);
        float f = (1.0 - smoothstep(0.0, 1.05, r)) * 0.8 + rim * 0.6;
        float fl = 0.85 + 0.15 * n2(vP.xz * 3.0 + time * 6.0);
        vec3 c = mix(vec3(1.0, 0.95, 0.85), vec3(1.0, 0.45, 0.2), smoothstep(0.2, 1.0, r));
        gl_FragColor = vec4(c * f * fl * k, 1.0); }` });
  const shock = new THREE.Mesh(new THREE.SphereGeometry(2.6, 48, 16, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38), shockMat);
  shock.position.y = 1.6; shock.frustumCulled = false; g.add(shock);
  const wakeMat = new THREE.ShaderMaterial({ uniforms: { k: { value: 0 }, time: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
    vertexShader: LD_V + 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n#include <logdepthbuf_vertex>\n}',
    fragmentShader: LD_F + NOISE + `uniform float k; uniform float time; varying vec2 vUv;
      void main(){
        #include <logdepthbuf_fragment>
        float s = vUv.y;                               // 1 at the capsule, 0 at the tail
        float streak = n2(vec2(vUv.x * 24.0, s * 6.0 + time * 4.0)) * 0.6 + 0.4;
        vec3 c = mix(vec3(0.75, 0.35, 0.9), vec3(1.0, 0.6, 0.35), s);
        gl_FragColor = vec4(c * pow(s, 2.2) * streak * k * 0.55, 1.0); }` });
  const wakeGeo = new THREE.CylinderGeometry(2.0, 9.0, 140, 40, 1, true); wakeGeo.translate(0, 70 + 1.2, 0);
  const wake = new THREE.Mesh(wakeGeo, wakeMat); wake.frustumCulled = false; g.add(wake);
  g.userData.set = (k, time) => { g.visible = k > 0.005; shockMat.uniforms.k.value = Math.min(1.6, k); wakeMat.uniforms.k.value = Math.min(1.4, k); shockMat.uniforms.time.value = wakeMat.uniforms.time.value = time; };
  return g;   // local +y points along the capsule's apex (wake trails behind the heat shield, shock on the -y side)
}

// ---------------------------------------------------------------- parachutes (ringsail mains, orange/white; conical ribbon drogues)
function stripeTex(bands) {
  const c = document.createElement('canvas'); c.width = 16; c.height = 512; const x = c.getContext('2d');
  bands.forEach(([a, b, col]) => { x.fillStyle = col; x.fillRect(0, a * 512, 16, (b - a) * 512); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function canopy(diam, height, tex) {
  const R = diam / 2, pts = [];
  for (let i = 0; i <= 24; i++) { const u = i / 24, a = u * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * R * (0.98 + 0.02 * Math.cos(u * 40)), Math.cos(a) * height)); }
  const geo = new THREE.LatheGeometry(pts, 48);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, side: THREE.DoubleSide })); m.castShadow = true; return m;
}
export function makeChutes() {
  const g = new THREE.Group(), mains = [], drogues = [];
  const orange = '#e2662a', white = '#f2f0ea';
  const mainTex = stripeTex([[0, 0.12, orange], [0.12, 0.3, white], [0.3, 0.46, orange], [0.46, 0.62, white], [0.62, 0.78, orange], [0.78, 1, white]]);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xbfbab0, transparent: true, opacity: 0.7 });
  const LINE = 28;                                  // suspension lines + riser length (m)
  for (let k = 0; k < 3; k++) {
    const c = new THREE.Group(), cp = canopy(25.4, 8.5, mainTex); cp.position.y = LINE; c.add(cp);
    const verts = []; for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; verts.push(0, 0, 0, Math.cos(a) * 12.4, LINE + 0.3, Math.sin(a) * 12.4); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); c.add(new THREE.LineSegments(lg, lineMat));
    c.rotation.z = (k - 1) * 0.42; c.rotation.x = (k === 1 ? 0.3 : -0.12); g.add(c); mains.push(c);
  }
  const dTex = stripeTex([[0, 0.5, white], [0.5, 0.6, orange], [0.6, 1, white]]);
  for (const s of [-1, 1]) {
    const c = new THREE.Group(), cp = canopy(5.0, 2.6, dTex); cp.position.y = 14; c.add(cp);
    const verts = []; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; verts.push(0, 0, 0, Math.cos(a) * 2.4, 14.2, Math.sin(a) * 2.4); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); c.add(new THREE.LineSegments(lg, lineMat));
    c.rotation.z = s * 0.25; g.add(c); drogues.push(c);
  }
  g.userData.mains = mains; g.userData.drogues = drogues;
  // reefing: mains open in stages (reefed ~8 s, then ~6 s more to full), drogues likewise
  g.userData.set = (t, tDrogue, tMain) => {
    for (const d of drogues) { d.visible = t >= tDrogue && t < tMain + 2; const f = Math.min(1, (t - tDrogue) / 4); d.scale.set(0.35 + 0.65 * f, 1, 0.35 + 0.65 * f); }
    for (const m of mains) { m.visible = t >= tMain; const u = t - tMain, f = u < 1.5 ? 0.15 : u < 9 ? 0.45 : Math.min(1, 0.45 + (u - 9) / 5 * 0.55);
      m.children[0].scale.set(f, 0.6 + 0.4 * f, f); }
  };
  return g;
}
