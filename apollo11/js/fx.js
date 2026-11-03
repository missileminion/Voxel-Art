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
// A quad = 4 nozzles (+/-roll and +/-pitch/yaw directions). fire(dirLocal) lights the nozzles whose exhaust points along dirLocal.
export function makeRcsQuad(radialDir) {
  const q = new THREE.Group(), up = new THREE.Vector3(0, 1, 0), r = radialDir.clone().normalize(), t = new THREE.Vector3().crossVectors(up, r).normalize();
  q.userData.jets = [up, up.clone().negate(), t, t.clone().negate()].map(d => {
    const p = makePlume('rcs'); p.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), d); p.position.copy(d).multiplyScalar(0.18); q.add(p);
    p.userData.dir = d; p.userData.until = 0; return p;
  });
  return q;
}
export class RCS {
  constructor() { this.quads = []; this.prevQ = new Map(); this.prevW = new Map(); }
  attach(obj, positions, radialOf = (p) => new THREE.Vector3(p.x, 0, p.z)) {
    const list = positions.map(p => { const q = makeRcsQuad(radialOf(p)); q.position.copy(p); obj.add(q); return q; });
    obj.userData.rcsQuads = list; this.quads.push(...list); return list;
  }
  // light the jets on obj whose exhaust points along 'dirWorld' (translation) for 'dur' real seconds
  pulse(obj, dirWorld, dur = 0.25, nowReal) {
    if (!obj.userData.rcsQuads) return; const inv = obj.quaternion.clone().invert(), d = dirWorld.clone().applyQuaternion(inv).normalize();
    for (const q of obj.userData.rcsQuads) for (const j of q.userData.jets) if (j.userData.dir.dot(d) > 0.7) j.userData.until = Math.max(j.userData.until, nowReal + dur);
  }
  // fire attitude jets from the change in angular velocity (couples on opposite quads)
  attitude(obj, simDt, nowReal, enabled) {
    const id = obj.uuid, q = obj.quaternion.clone(), pq = this.prevQ.get(id); this.prevQ.set(id, q);
    if (!pq || !enabled || simDt <= 0 || simDt > 30) { this.prevW.set(id, new THREE.Vector3()); return; }
    const dq = q.clone().multiply(pq.clone().invert()); if (dq.w < 0) { dq.x *= -1; dq.y *= -1; dq.z *= -1; dq.w *= -1; }
    const ang = 2 * Math.acos(Math.min(1, dq.w)), ax = new THREE.Vector3(dq.x, dq.y, dq.z); if (ax.lengthSq() > 1e-12) ax.normalize();
    const w = ax.multiplyScalar(ang / simDt), pw = this.prevW.get(id) || w.clone(); this.prevW.set(id, w.clone());
    const alpha = w.clone().sub(pw).divideScalar(simDt); if (alpha.length() < 2e-4) return;     // rad/s^2 threshold
    const aLocal = alpha.applyQuaternion(obj.quaternion.clone().invert());
    if (!obj.userData.rcsQuads) return;
    for (const qd of obj.userData.rcsQuads) for (const j of qd.userData.jets) {
      const thrust = j.userData.dir.clone().negate(), torque = new THREE.Vector3().crossVectors(qd.position, thrust);
      if (torque.normalize().dot(aLocal.clone().normalize()) > 0.6) j.userData.until = Math.max(j.userData.until, nowReal + 0.18);
    }
  }
  update(nowReal) {
    for (const q of this.quads) for (const j of q.userData.jets) {
      const on = nowReal < j.userData.until; j.userData.set(on, on ? 0.75 + 0.25 * Math.random() : 0, 1, nowReal);
    }
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
