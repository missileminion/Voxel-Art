// Apollo 11 in real time: detailed models, real sun direction, shadows and eclipses, NASA timeline.
import * as THREE from '../../app/js/vendor/three.module.js';
import { Track, Uniform, loadBin, v3 } from '../../app/js/data.js';
import { materials, buildSaturnV, buildCSM, buildLM, buildSurfaceKit, buildAstronaut, buildChutes } from './models.js';

const $ = (id) => document.getElementById(id);
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
                set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

// ---------------------------------------------------------------- data
const meta = await fetch('apollo11/data/apollo.json').then(r => r.json());
const tbuf = await loadBin('apollo11/data/', 'tracks'), bbuf = await loadBin('apollo11/data/', 'bodies');
const track = {};
for (const [k, i] of Object.entries(meta.tracks)) track[k] = new Track(new Float64Array(tbuf, i.offset, i.count * 7));
const body = {};
for (const [k, i] of Object.entries(meta.bodies)) { const h = new Float64Array(bbuf, i.offset, 3); body[k] = new Uniform(h[0], h[1], h[2], new Float64Array(bbuf, i.offset + 24, h[2] * 6)); }
const TT = meta.t, EVENTS = meta.events, UTC0 = Date.parse(meta.utc0);
const R_E = 6378.137, R_M = 1737.4;

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('view').appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 4e7);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
const sun = new THREE.DirectionalLight(0xfff6ea, 3.0); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const earthshine = new THREE.DirectionalLight(0x9db8ff, 0); scene.add(earthshine, earthshine.target);
const ambient = new THREE.AmbientLight(0x404858, 0.04); scene.add(ambient);
const skyFill = new THREE.HemisphereLight(0xa8c8ff, 0x4a5a3a, 0); scene.add(skyFill);
const LD_V = '#include <common>\n#include <logdepthbuf_pars_vertex>\n', LD_F = '#include <logdepthbuf_pars_fragment>\n';
const loader = new THREE.TextureLoader(), texC = {};
function tex(n, srgb = true) { if (texC[n]) return texC[n]; const t = loader.load('app/tex/' + n); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return (texC[n] = t); }

// ---------------------------------------------------------------- sky (real stars + Milky Way), shared assets from the Voyager page
const skyGroup = new THREE.Group(); skyGroup.rotation.x = -23.4392911 * Math.PI / 180; scene.add(skyGroup);
const skyGain = { value: 1 };
const milky = new THREE.Mesh(new THREE.SphereGeometry(3e6, 64, 32), new THREE.MeshBasicMaterial({ map: tex('milkyway.jpg'), side: THREE.BackSide, depthWrite: false, depthTest: false, toneMapped: false }));
milky.rotation.x = Math.PI / 2; milky.renderOrder = -20; skyGroup.add(milky);
{
  const a = new Float32Array(await loadBin('app/tex/', 'stars')), n = a.length / 5;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), mag = new Float32Array(n);
  const BV = [[-0.4, 0.61, 0.70, 1.0], [0.0, 0.79, 0.85, 1.0], [0.4, 1.0, 0.97, 0.93], [0.8, 1.0, 0.88, 0.73], [1.2, 1.0, 0.78, 0.56], [1.6, 1.0, 0.69, 0.43], [2.2, 1.0, 0.6, 0.32]];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) pos[i * 3 + c] = a[i * 5 + c] * 2.5e6; mag[i] = a[i * 5 + 3];
    const bv = Math.max(-0.4, Math.min(2.2, a[i * 5 + 4])); let k = 0; while (k < BV.length - 2 && bv > BV[k + 1][0]) k++;
    const f = (bv - BV[k][0]) / (BV[k + 1][0] - BV[k][0]); for (let c = 0; c < 3; c++) col[i * 3 + c] = BV[k][c + 1] + (BV[k + 1][c + 1] - BV[k][c + 1]) * f;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  const m = new THREE.ShaderMaterial({ uniforms: { gain: skyGain, dpr: { value: renderer.getPixelRatio() } }, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, vertexColors: true, toneMapped: false,
    vertexShader: 'attribute float mag; uniform float dpr; varying vec3 vC; varying float vA; void main(){ float I=pow(10.0,-0.4*(mag-1.0)); vA=clamp(0.1+0.9*pow(10.0,-0.4*(mag-4.2)),0.0,1.0); vC=color; gl_PointSize=clamp(1.3+2.4*pow(I,0.28),1.3,7.0)*dpr; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'uniform float gain; varying vec3 vC; varying float vA; void main(){ vec2 d=gl_PointCoord-0.5; float r=dot(d,d)*4.0; if(r>1.0) discard; gl_FragColor=vec4(vC*(exp(-r*3.5)+0.12*exp(-r*0.8))*vA*gain,1.0); }' });
  const st = new THREE.Points(g, m); st.frustumCulled = false; st.renderOrder = -19; skyGroup.add(st);
}

// ---------------------------------------------------------------- Earth, Moon, Sun
const sunDirU = { value: new THREE.Vector3(1, 0, 0) };
function atmosphere(color, k) {
  return new THREE.ShaderMaterial({ uniforms: { sunDir: sunDirU, col: { value: new THREE.Color(color) }, k: { value: k } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    vertexShader: LD_V + 'varying vec3 vN; varying vec3 vV; void main(){ vec4 w=modelMatrix*vec4(position,1.0); vN=normalize(mat3(modelMatrix)*normal); vV=normalize(cameraPosition-w.xyz); gl_Position=projectionMatrix*viewMatrix*w;\n#include <logdepthbuf_vertex>\n}',
    fragmentShader: LD_F + 'uniform vec3 sunDir; uniform vec3 col; uniform float k; varying vec3 vN; varying vec3 vV; void main(){\n#include <logdepthbuf_fragment>\n float rim=pow(1.0-max(dot(vN,vV),0.0),2.6); float day=smoothstep(-0.25,0.4,dot(vN,sunDir)); gl_FragColor=vec4(col*rim*day*k,1.0); }' });
}
const earth = new THREE.Group(); scene.add(earth);
const earthSpin = new THREE.Group(); earth.add(earthSpin);
earthSpin.add(new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), new THREE.MeshStandardMaterial({ map: tex('earth.jpg'), roughness: 0.9 })));
const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.0018, 160, 80), new THREE.MeshStandardMaterial({ map: tex('earth_clouds.png'), transparent: true, depthWrite: false, roughness: 1 })); earthSpin.add(clouds);
earthSpin.children[0].scale.set(1, 6356.75 / 6378.137, 1); clouds.scale.copy(earthSpin.children[0].scale);
earth.add(new THREE.Mesh(new THREE.SphereGeometry(1.025, 96, 48), atmosphere(0x4f8dff, 1.6)));
earth.traverse(o => { if (o.isMesh && o.material.isMeshStandardMaterial) o.receiveShadow = false; });
const moon = new THREE.Group(); scene.add(moon);
const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 256, 128), new THREE.MeshStandardMaterial({ map: tex('moon.jpg'), roughness: 1 })); moon.add(moonMesh);
const sunMesh = new THREE.Group(); scene.add(sunMesh);
{
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, 'rgba(255,252,240,1)'); gr.addColorStop(0.08, 'rgba(255,240,210,0.9)'); gr.addColorStop(0.3, 'rgba(255,215,160,0.25)'); gr.addColorStop(1, 'rgba(255,200,140,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  sunMesh.add(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshBasicMaterial({ color: 0xfff8e8, toneMapped: false })));
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); sp.scale.setScalar(12); sunMesh.add(sp);
}

// ---------------------------------------------------------------- frames: Earth rotation (GMST + precession), Moon orientation (DE421 librations)
const ECL = 23.4392911 * Math.PI / 180, AS = Math.PI / 648000;
function R3(a) { const c = Math.cos(a), s = Math.sin(a); return [[c, s, 0], [-s, c, 0], [0, 0, 1]]; }
function R2(a) { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, -s], [0, 1, 0], [s, 0, c]]; }
function mm(A, B) { return A.map(r => B[0].map((_, j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j])); }
function mv(A, v) { return [0, 1, 2].map(i => A[i][0] * v[0] + A[i][1] * v[1] + A[i][2] * v[2]); }
function Tm(A) { return [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]]; }
function ecefToWorld(t) {
  const jdu = meta.jd_utc0 + t / 86400, Tc = (jdu + 40.2 / 86400 - 2451545) / 36525;
  const zeta = (2306.2181 * Tc + 0.30188 * Tc * Tc) * AS, z = (2306.2181 * Tc + 1.09468 * Tc * Tc) * AS, th = (2004.3109 * Tc - 0.42665 * Tc * Tc) * AS;
  const P = mm(mm(R3(-z), R2(th)), R3(-zeta)), g = ((280.46061837 + 360.98564736629 * (jdu - 2451545)) % 360) * Math.PI / 180;
  const E = [[1, 0, 0], [0, Math.cos(ECL), Math.sin(ECL)], [0, -Math.sin(ECL), Math.cos(ECL)]];
  return mm(mm(E, Tm(P)), R3(-g));
}
const MQ = meta.moon_q;
function moonQuat(t) {
  const x = (t - MQ.t0) / MQ.dt, i = Math.max(0, Math.min(MQ.q.length - 2, Math.floor(x))), f = Math.min(1, Math.max(0, x - i));
  const a = new THREE.Quaternion(...MQ.q[i]), b = new THREE.Quaternion(...MQ.q[i + 1]); return a.slerp(b, f);   // body -> ecliptic
}
const SITE = meta.site_bf;
function siteWorld(t, bf = SITE) { const q = moonQuat(t), p = new THREE.Vector3(...bf).applyQuaternion(q); const m = body.moon.state(t).p; return [m[0] + p.x, m[1] + p.y, m[2] + p.z]; }
function siteBasis(t) {   // east, up, north at the landing site in world (ecliptic) axes
  const q = moonQuat(t), [la, lo] = [meta.site_lat * Math.PI / 180, meta.site_lon * Math.PI / 180];
  const up = new THREE.Vector3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)).applyQuaternion(q);
  const east = new THREE.Vector3(-Math.sin(lo), Math.cos(lo), 0).applyQuaternion(q), north = new THREE.Vector3().crossVectors(up, east);
  return { up, east, north };
}

// ---------------------------------------------------------------- Tranquility Base terrain: curved disc with craters (procedural; West crater and Little West at their approximate places)
const CRATERS = [];
{ let s = 11; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 2600; i++) {   // mare plain: small craters everywhere, larger ones only away from the landing point
    const r = 1.0 * Math.pow(110, Math.pow(rnd(), 3)), d = Math.sqrt(rnd()) * 4000, a = rnd() * 6.283;
    if (d < r * 1.7 + 25) continue; CRATERS.push([Math.cos(a) * d, Math.sin(a) * d, r, 0.15 + rnd() * 0.25]); }
  CRATERS.push([400, -10, 95, 0.35]);        // West crater (~190 m) east of the landing point (approx)
  CRATERS.push([60, 5, 16.5, 0.4]);          // Little West crater (~33 m), visited by Armstrong (approx)
}
function terrainH(x, z) {     // metres; x east, z south
  let h = 0;
  for (const [cx, cz, r, d] of CRATERS) {
    const q = Math.hypot(x - cx, z + cz) / r; if (q > 1.6) continue;
    h += q < 1 ? -d * r * 0.35 * (1 - q * q) + 0.12 * r * q ** 6 : 0.12 * r * Math.exp(-(((q - 1) / 0.2) ** 2));
  }
  return h + 0.8 * Math.sin(x * 0.013) * Math.cos(z * 0.011) - H0;
}
let H0 = 0; H0 = terrainH(0, 0);
const lunarGround = new THREE.Group(); scene.add(lunarGround);
{
  const NR = 220, NA = 192, verts = [], idx = [], R = R_M * 1000 - 1930;
  for (let i = 0; i <= NR; i++) {
    const rho = 250000 * Math.pow(i / NR, 3.2), al = rho / R;
    for (let j = 0; j <= NA; j++) {
      const az = j / NA * 2 * Math.PI, x = Math.sin(az) * rho, z = -Math.cos(az) * rho;
      const h = rho < 6000 ? terrainH(x, z) * Math.min(1, (6000 - rho) / 1000) : 0;
      verts.push(Math.sin(az) * Math.sin(al) * (R + h), Math.cos(al) * (R + h) - R, -Math.cos(az) * Math.sin(al) * (R + h));
    }
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) { const a = i * (NA + 1) + j, b = a + NA + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setIndex(idx); g.computeVertexNormals();
  const regolith = new THREE.CanvasTexture((() => { const c = document.createElement('canvas'); c.width = c.height = 512; const x = c.getContext('2d'); const im = x.createImageData(512, 512);
    for (let i = 0; i < 512 * 512; i++) { const v = 118 + (Math.random() * 40 - 20); im.data.set([v, v * 0.98, v * 0.95, 255], i * 4); } x.putImageData(im, 0, 0); return c; })());
  regolith.wrapS = regolith.wrapT = THREE.RepeatWrapping; regolith.colorSpace = THREE.SRGBColorSpace;
  const uv = []; for (let i = 0; i < verts.length; i += 3) uv.push(verts[i] / 6, verts[i + 2] / 6); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: regolith, color: 0x9a968e, roughness: 1, side: THREE.DoubleSide })); mesh.receiveShadow = true; mesh.frustumCulled = false;
  lunarGround.add(mesh);
}
// Launch Complex 39A: pad, mobile launcher + red launch umbilical tower, ground disc textured from the Earth map
const padGroup = new THREE.Group(); scene.add(padGroup);
{
  const m = materials();
  const ground = new THREE.Mesh(new THREE.CircleGeometry(3000, 96), new THREE.MeshStandardMaterial({ color: 0x5f7a46, roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; padGroup.add(ground);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x1f4e74, roughness: 0.3, metalness: 0.1 })); sea.rotation.x = -Math.PI / 2; sea.position.set(3600, 0.05, 0); padGroup.add(sea);
  const hard = new THREE.Mesh(new THREE.CylinderGeometry(120, 140, 14, 8), new THREE.MeshStandardMaterial({ color: 0xb8b2a6, roughness: 0.9 })); hard.position.y = -6; hard.receiveShadow = true; padGroup.add(hard);
  const ml = new THREE.Mesh(new THREE.BoxGeometry(49, 7.6, 41), new THREE.MeshStandardMaterial({ color: 0x8d8b86, roughness: 0.8, metalness: 0.2 })); ml.position.y = 4.8; ml.castShadow = ml.receiveShadow = true; padGroup.add(ml);
  const red = new THREE.MeshStandardMaterial({ color: 0xa33a26, roughness: 0.6, metalness: 0.3 });
  const tower = new THREE.Group(); tower.position.set(-24, 8.6, 0);
  for (const [x, z] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.9, 120, 0.9), red); c.position.set(x, 60, z); tower.add(c); }
  for (let y = 0; y < 120; y += 6) for (const [w, d, x, z] of [[12, 0.5, 0, -6], [12, 0.5, 0, 6], [0.5, 12, -6, 0], [0.5, 12, 6, 0]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), red); b.position.set(x, y, z); tower.add(b); }
  for (const y of [18, 46, 60, 74, 86, 96, 102]) { const arm = new THREE.Mesh(new THREE.BoxGeometry(14, 1.6, 2.2), red); arm.position.set(13, y, 0); tower.add(arm); }
  const crane = new THREE.Mesh(new THREE.BoxGeometry(12, 1.5, 1.5), red); crane.position.set(4, 121, 0); tower.add(crane);
  tower.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  padGroup.add(tower);
}
const PADLL = [meta.pad[0] * Math.PI / 180, meta.pad[1] * Math.PI / 180];
function padECEF() { const [la, lo] = PADLL, f = 1 / 298.257, e2 = f * (2 - f), N = 6378.137 / Math.sqrt(1 - e2 * Math.sin(la) ** 2); return [N * Math.cos(la) * Math.cos(lo), N * Math.cos(la) * Math.sin(lo), N * (1 - e2) * Math.sin(la)]; }
const PAD = padECEF();
// Pacific at the splash point: a calm ocean disc
const ocean = new THREE.Mesh(new THREE.CircleGeometry(40000, 64), new THREE.MeshStandardMaterial({ color: 0x103e66, roughness: 0.25, metalness: 0.2 })); ocean.rotation.x = -Math.PI / 2;
const oceanGroup = new THREE.Group(); oceanGroup.add(ocean); scene.add(oceanGroup); ocean.receiveShadow = true;

// ---------------------------------------------------------------- vehicles
materials();
const V = buildSaturnV();
const stack = new THREE.Group(); scene.add(stack);
const stackParts = { sic: V.sic, sii: V.sii, inter: V.interstage, sivb: V.sivb, les: V.les };
for (const p of Object.values(stackParts)) stack.add(p);
for (const p of V.sla) stack.add(p);
const csm = buildCSM(); scene.add(csm);
const lm = buildLM(); scene.add(lm);
const lmDescent = lm.userData.desc;          // left on the Moon at ascent
const kit = buildSurfaceKit(); for (const k of ['flag', 'tv', 'psep', 'lrrr', 'swc']) scene.add(kit.userData[k]);
const crew = { Armstrong: buildAstronaut('Armstrong'), Aldrin: buildAstronaut('Aldrin') }; scene.add(crew.Armstrong, crew.Aldrin);
const chutes = buildChutes(); scene.add(chutes);
const cover = V.les;                         // boost protective cover + tower (jettisoned at 3:17.9)

// exhaust plumes: additive shader cones (smooth gradients, flicker, expansion with altitude)
function plumeMat(c0, c1, alpha) {
  return new THREE.ShaderMaterial({ uniforms: { c0: { value: new THREE.Color(c0) }, c1: { value: new THREE.Color(c1) }, a: { value: alpha }, time: { value: 0 }, k: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
    vertexShader: LD_V + 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);\n#include <logdepthbuf_vertex>\n}',
    fragmentShader: LD_F + `uniform vec3 c0; uniform vec3 c1; uniform float a; uniform float time; uniform float k; varying vec2 vUv;
      void main(){
        #include <logdepthbuf_fragment>
        float s = 1.0 - vUv.y; float fl = 0.85 + 0.15 * sin(time * 40.0 + s * 30.0);
        float edge = sin(vUv.x * 3.14159 * 2.0 * 6.0 + time * 7.0) * 0.06;
        float i = pow(1.0 - s, 1.6) * (0.75 + edge) * fl * a * k;
        gl_FragColor = vec4(mix(c0, c1, s) * i, 1.0); }` });
}
function plume(len, r0, r1, c0, c1, alpha) { const g = new THREE.CylinderGeometry(r0, r1, len, 32, 1, true); g.translate(0, -len / 2, 0); const m = new THREE.Mesh(g, plumeMat(c0, c1, alpha)); m.frustumCulled = false; return m; }
const PL = {
  f1: V.sic.userData.nozzles.map(n => { const p = plume(60, 1.9, 5, 0xfff1c0, 0xff7a20, 1.2); p.position.set(n[0], n[1], n[2]); V.sic.add(p); return p; }),
  j2ii: V.sii.userData.nozzles.map(n => { const p = plume(18, 1.0, 3, 0xc9d4ff, 0x7a5cff, 0.12); p.position.set(n[0], n[1], n[2]); V.sii.add(p); return p; }),
  j2ivb: [(() => { const p = plume(16, 1.0, 3.4, 0xc9d4ff, 0x7a5cff, 0.12); p.position.set(0, 70.2 - 2.5, 0); V.sivb.add(p); return p; })()],
  sps: [(() => { const p = plume(10, 1.25, 4, 0xffd8a8, 0xff9a60, 0.08); p.position.set(0, -2.85, 0); csm.add(p); return p; })()],
  dps: [(() => { const p = plume(6, 0.75, 3, 0xffd8a8, 0xffa070, 0.07); p.position.set(0, 1.0, 0); lmDescent.add(p); return p; })()],
  aps: [(() => { const p = plume(5, 0.4, 2, 0xffd0a0, 0xff9050, 0.1); p.position.set(0, 2.82, 0); lm.userData.asc.add(p); return p; })()],
  les: [(() => { const p = plume(14, 0.3, 2.5, 0xfff4d0, 0xff9a40, 1.0); p.position.set(0, 6.4, 0); p.rotation.z = Math.PI; cover.add(p); return p; })()],
};
const plasma = new THREE.Mesh(new THREE.SphereGeometry(3.2, 32, 16), new THREE.ShaderMaterial({ uniforms: { k: { value: 0 }, time: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  vertexShader: LD_V + 'varying vec3 vN; varying vec3 vP; void main(){ vN=normal; vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);\n#include <logdepthbuf_vertex>\n}',
  fragmentShader: LD_F + 'uniform float k; uniform float time; varying vec3 vN; varying vec3 vP; void main(){\n#include <logdepthbuf_fragment>\n float f = smoothstep(-0.2, -1.0, vN.y); float tail = smoothstep(0.0, 1.0, vN.y) * 0.25; gl_FragColor = vec4(vec3(1.0, 0.55, 0.35) * (f + tail) * k * (0.9 + 0.1 * sin(time * 30.0)), 1.0); }' }));
plasma.frustumCulled = false; csm.add(plasma);

// ---------------------------------------------------------------- mission clock: real time 1:1, anchored so it keeps running while the page is closed
const st = { speed: 1, playing: true, follow: 'auto', zoom: 1, yaw: 0, pitch: 0 };
let anchor = store.get('a11.anchor', null);           // {wall: ms, met: s}
const q = new URLSearchParams(location.search);
if (q.has('t')) anchor = { wall: Date.now(), met: parseFloat(q.get('t')) };
if (!anchor || !(anchor.met > -600)) anchor = { wall: Date.now(), met: -60 };
let met = anchor.met + (Date.now() - anchor.wall) / 1000;
if (met > TT.splash + 3600) met = TT.splash + 3600;
function reanchor() { anchor = { wall: Date.now(), met }; store.set('a11.anchor', anchor); }
reanchor();

// ---------------------------------------------------------------- helpers
const S = (k, t) => track[k].state(Math.min(Math.max(t, track[k].t0), track[k].t1));
const toV = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const fmt = (x, d = 1) => x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
function thrustDir(name, t) {
  const b = meta.thrust[name]; if (!b) return null; const i = Math.max(0, Math.min(b.v.length / 3 - 1, Math.round((t - b.t0) / b.dt)));
  return new THREE.Vector3(b.v[i * 3], b.v[i * 3 + 1], b.v[i * 3 + 2]);
}
function burning(name, t) { const b = meta.burns[name]; return b && t >= b[0] && t <= b[0] + b[1]; }
function quatFromAxes(yAxis, zHint) {     // object +y along yAxis, +z toward zHint
  const y = yAxis.clone().normalize(), x = new THREE.Vector3().crossVectors(y, zHint); if (x.lengthSq() < 1e-8) x.set(1, 0, 0).cross(y); x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y); return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}
function sunVisibility(pKm, sunKm) {        // fraction of the solar disc not hidden by Earth or the Moon
  let vis = 1; const ds = v3.sub(sunKm, pKm), dsn = v3.len(ds), as = 696000 / dsn;
  for (const [c, R] of [[[0, 0, 0], R_E + 30], [body.moon.state(met).p, R_M]]) {
    const dc = v3.sub(c, pKm), dcn = v3.len(dc); if (dcn < R) continue;
    const ab = Math.asin(R / dcn), sep = Math.acos(Math.max(-1, Math.min(1, v3.dot(ds, dc) / dsn / dcn)));
    const f = (sep - (ab - as)) / (2 * as); vis = Math.min(vis, Math.max(0, Math.min(1, f)));
  }
  return vis;
}

// ---------------------------------------------------------------- attitude & configuration by mission phase
const tdeStart = TT.tde, tdeDock = TT.dock1;
function stackQuat(t, X) {
  const r = toV(X.p), up = r.clone().normalize();
  if (t < 12) return quatFromAxes(up, eastAt(t, X).negate());
  const M = ecefToWorld(t), axis = toV(mv(M, [0, 0, 1])), vrot = axis.clone().cross(r).multiplyScalar(7.2921159e-5);
  const vrel = toV(X.v).sub(vrot), alt = r.length() - R_E, k = Math.max(0, Math.min(1, (alt - 30) / 80));
  const dir = vrel.normalize().multiplyScalar(1 - k).add(toV(X.v).normalize().multiplyScalar(k)).normalize();
  // Saturn V pitch program (tilt from vertical, approx.): slow start after the roll, ~66 deg at S-IC cutoff, then follow velocity
  const PP = [[12, 0], [30, 4], [60, 20], [90, 38], [120, 52], [161.7, 66], [200, 72]];
  let tilt = PP[PP.length - 1][1]; for (let i = 0; i < PP.length - 1; i++) if (t < PP[i + 1][0]) { tilt = PP[i][1] + (PP[i + 1][1] - PP[i][1]) * (t - PP[i][0]) / (PP[i + 1][0] - PP[i][0]); break; }
  const horiz = dir.clone().projectOnPlane(up).normalize();
  const prog = up.clone().multiplyScalar(Math.cos(tilt * Math.PI / 180)).add(horiz.multiplyScalar(Math.sin(tilt * Math.PI / 180))).normalize();
  const f = Math.min(1, Math.max(0, (t - 200) / 60)), d = prog.lerp(dir, f).normalize();
  // roll program 13.2-31 s: heading 90 -> 72 deg; heads-down crew attitude (+z toward the ground track's down side)
  return quatFromAxes(d, up.clone().negate().projectOnPlane(d).lengthSq() > 1e-6 ? up.clone().negate().projectOnPlane(d) : eastAt(t, X));
}
function eastAt(t, X) { const M = ecefToWorld(t), ax = toV(mv(M, [0, 0, 1])); return ax.cross(toV(X.p)).normalize(); }
function ptcQuat(t, X) {   // passive thermal control: long axis perpendicular to the Sun line, rolling ~0.3 deg/s
  const s = toV(body.sun.state(t).p).sub(toV(X.p)).normalize(), ec = new THREE.Vector3(0, 0, 1);
  const axis = new THREE.Vector3().crossVectors(s, ec).normalize();
  return quatFromAxes(axis, s).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (t * 0.3 * Math.PI / 180) % (2 * Math.PI)));
}
function localHorizontal(t, X, center, forwardIsCM = true) {
  const r = toV(X.p).sub(toV(center)), v = toV(X.v).sub(toV(center === 0 ? [0, 0, 0] : body.moon.state(t).v));
  const down = r.clone().normalize().negate();
  return quatFromAxes(forwardIsCM ? v : v.clone().negate(), down);
}

// ---------------------------------------------------------------- UI
const list = $('events');
for (const e of EVENTS) {
  const li = document.createElement('li');
  li.innerHTML = `<span class="d">${metStr(e.t)}</span> <span class="tag ${e.tag}">${e.tag}</span> ${e.title}`;
  li.onclick = () => { met = e.t - 20; reanchor(); }; list.appendChild(li);
}
$('evtoggle').onclick = () => $('panel').classList.toggle('open');
const speeds = [1, 10, 60, 600, 3600];
$('live').onclick = () => { st.speed = 1; st.playing = true; setSpeed(); reanchor(); };
$('faster').onclick = () => { const i = speeds.indexOf(st.speed); st.speed = speeds[Math.min(speeds.length - 1, i + 1)]; setSpeed(); };
$('slower').onclick = () => { const i = speeds.indexOf(st.speed); st.speed = speeds[Math.max(0, i - 1)]; setSpeed(); };
$('play').onclick = () => { st.playing = !st.playing; $('play').textContent = st.playing ? '❚❚' : '▶'; reanchor(); };
$('followbtn').onclick = () => { st.follow = { auto: 'csm', csm: 'lm', lm: 'auto' }[st.follow]; $('followbtn').textContent = 'Follow: ' + st.follow.toUpperCase(); };
function setSpeed() { $('spd').textContent = st.speed === 1 ? 'real time' : '×' + st.speed; }
setSpeed();
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', (e) => { if (!drag) return; st.yaw += (e.clientX - drag[0]) * 0.005; st.pitch = Math.max(-1.3, Math.min(1.3, st.pitch + (e.clientY - drag[1]) * 0.004)); drag = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('wheel', (e) => { st.zoom = Math.max(0.2, Math.min(30, st.zoom * Math.exp(e.deltaY * 0.001))); e.preventDefault(); }, { passive: false });
function metStr(t) { const s = Math.abs(t), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (t < 0 ? '−' : '') + String(h).padStart(3, '0') + ':' + String(m).padStart(2, '0') + ':' + x.toFixed(0).padStart(2, '0'); }
let toastT = 0, lastEv = EVENTS.findIndex(e => e.t > met) - 1;
function toast(e) { $('toast').innerHTML = `<b>${e.title}</b> <span class="tag ${e.tag}">${e.tag}</span><br>${e.text || ''}`; $('toast').classList.add('show'); toastT = 8; }

// ---------------------------------------------------------------- frame
const clock = new THREE.Clock();
const camU = new THREE.Vector3(0, 0, 1);
function place(obj, pKm, originKm) { obj.position.set((pKm[0] - originKm[0]) * 1000, (pKm[1] - originKm[1]) * 1000, (pKm[2] - originKm[2]) * 1000); }
function bodyPlace(obj, centerKm, radiusKm, originKm, f) {
  const rel = v3.sub(centerKm, originKm), D = v3.len(rel) * 1000, R = radiusKm * 1000, u = v3.scale(rel, 1 / v3.len(rel));
  const Dr = (D - R < 3e6 && D < 4e7) ? D : 5e3 * (1 + Math.log(D / 5e3)); obj.position.set(u[0] * Dr, u[1] * Dr, u[2] * Dr); obj.scale.setScalar(R * Dr / D);
  return { u, D, px: (radiusKm / v3.len(rel)) * f };
}
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (st.playing) met += dt * st.speed;
  met = Math.min(met, TT.splash + 3600);
  const t = met;
  // --- which vehicle is followed
  const lmActive = t >= TT.undock && t < TT.dock2 + 120;
  let who = st.follow === 'auto' ? (lmActive ? 'lm' : 'csm') : st.follow;
  if (who === 'lm' && !(t >= TT.undock)) who = 'csm';
  const X = (who === 'lm' && t >= track.lm.t0) ? S('lm', t) : S('csm', t);
  const O = X.p;                                                   // floating origin (km)
  // --- celestial bodies
  const H = renderer.domElement.height, f = (H / 2) / Math.tan(camera.fov * Math.PI / 360);
  const sunS = body.sun.state(t), moonS = body.moon.state(t);
  const e = bodyPlace(earth, [0, 0, 0], R_E, O, f);
  const M = ecefToWorld(t); earthSpin.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(toV(mv(M, [1, 0, 0])), toV(mv(M, [0, 0, 1])), toV(mv(M, [0, -1, 0]))));
  clouds.rotation.y = t / 86400 * 0.15;
  const mo = bodyPlace(moon, moonS.p, R_M, O, f);
  const mq = moonQuat(t), mb = new THREE.Matrix4().makeRotationFromQuaternion(mq);
  const bx = new THREE.Vector3(1, 0, 0).applyMatrix4(mb), by = new THREE.Vector3(0, 1, 0).applyMatrix4(mb), bz = new THREE.Vector3(0, 0, 1).applyMatrix4(mb);
  moonMesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(bx, bz, by.clone().negate()));
  const toSun = v3.sub(sunS.p, O), sd = v3.norm(toSun);
  const sp = bodyPlace(sunMesh, sunS.p, 696000, O, f); sunMesh.children[1].scale.setScalar(Math.max(6, 18 / Math.max(sp.px, 1e-3)));
  sunDirU.value.set(sd[0], sd[1], sd[2]);
  // --- light: real Sun direction, eclipses by Earth and Moon, earthshine
  const vis = sunVisibility(O, sunS.p);
  sun.position.set(sd[0] * 400, sd[1] * 400, sd[2] * 400); sun.intensity = 3.0 * vis;
  const toE = v3.scale(O, -1), dE = v3.len(toE), eDir = v3.norm(toE);
  const ePhase = (1 + v3.dot(v3.norm(v3.sub(sunS.p, [0, 0, 0])), v3.scale(eDir, -1))) / 2;   // illuminated fraction seen from here
  earthshine.position.set(eDir[0] * 400, eDir[1] * 400, eDir[2] * 400); earthshine.intensity = Math.min(0.5, 0.35 * ePhase * (384400 / Math.max(dE, 7000)) ** 2 * 0.05);
  // shadow camera around the followed vehicle
  const size = t < TT.sii_on ? 80 : (who === 'lm' && t > TT.land && t < TT.asc + 20 ? 60 : 30);
  const sc = sun.shadow.camera; sc.left = sc.bottom = -size; sc.right = sc.top = size; sc.near = 1; sc.far = 1000; sc.updateProjectionMatrix();
  // --- sky colour near the ground (launch day, Florida morning; Pacific morning at splashdown)
  const altE = v3.len(O) - R_E, sunUp = v3.dot(v3.norm(O), sd);
  const sky = Math.max(0, Math.min(1, 1 - altE / 70)) * Math.max(0, Math.min(1, sunUp * 4 + 0.2));
  scene.background.setRGB(0.32 * sky, 0.55 * sky, 0.95 * sky); skyFill.intensity = 1.4 * sky; skyFill.position.set(O[0], O[1], O[2]).normalize();
  skyGroup.visible = sky < 0.35; skyGroup.position.copy(camera.position); skyGain.value = 1 - sky / 0.35; milky.material.color.setScalar(skyGain.value * 0.9);
  // --- ground patches
  padGroup.visible = altE < 60 && t < 3600;
  if (padGroup.visible) {
    const pw = v3.add([0, 0, 0], mv(M, PAD)); place(padGroup, pw, O);
    const [la, lo] = PADLL, up = toV(mv(M, [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)])), east = toV(mv(M, [-Math.sin(lo), Math.cos(lo), 0]));
    padGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, new THREE.Vector3().crossVectors(east, up)));
  }
  const site = siteWorld(t), sb = siteBasis(t), altSite = v3.len(v3.sub(O, moonS.p)) - (R_M - 1.93);
  lunarGround.visible = altSite < 40 && t > TT.pdi - 600 && t < TT.asc_end + 600;
  if (lunarGround.visible) { place(lunarGround, site, O); lunarGround.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(sb.east, sb.up, sb.north.clone().negate())); }
  moon.visible = !(lunarGround.visible && altSite < 25);
  oceanGroup.visible = t > TT.main - 60 && t < TT.splash + 3600;
  if (oceanGroup.visible) {
    const sp2 = S('csm', TT.splash).p, up = toV(sp2).normalize(); place(oceanGroup, sp2, O); oceanGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
  }
  earth.visible = !(oceanGroup.visible && altE < 15);
  // --- Saturn V stack (liftoff -> CSM separation at TD&E)
  const inStack = t < tdeStart;
  stack.visible = t < TT.evasive + 3 * 3600;
  csm.visible = true; lm.visible = t >= TT.dock1 - 5 || inStack;
  const timeNow = performance.now() / 1000;
  for (const arr of Object.values(PL)) for (const p of arr) { p.visible = false; p.material.uniforms.time.value = timeNow; }
  if (stack.visible) {
    const Xs = t < TT.evasive ? S('csm', t) : S('sivb', t);
    place(stack, Xs.p, O);
    const lift = 14.5 * Math.max(0, Math.min(1, 1 - (altE - 0.3) / 3));          // stack stands on the mobile launcher deck
    let qS;
    if (t < TT.ins) qS = stackQuat(t, Xs);
    else if (burning('TLI', t)) qS = quatFromAxes(thrustDir('TLI', t), toV(Xs.p).negate());
    else if (t < TT.tli) qS = localHorizontal(t, Xs, [0, 0, 0]);
    else qS = quatFromAxes(thrustDir('TLI', TT.tli_off - 1), toV(S('csm', TT.tli_off).p).negate());
    stack.quaternion.copy(qS);
    stack.position.add(new THREE.Vector3(0, lift, 0).applyQuaternion(qS));
    const altK = Math.max(0, altE);
    stackParts.sic.visible = t < TT.sic_off + 0.7 + 30; stackParts.sii.visible = stackParts.inter.visible = t < TT.sii_off + 30;
    // dropped stages fall behind: simple relative motion in the stack frame
    const drop = (part, tsep, y0) => { const d = t - tsep; part.position.y = d > 0 ? -(0.5 * 18 * d * d) : 0; };
    drop(stackParts.sic, TT.sic_off + 0.7); drop(stackParts.sii, TT.sii_off + 1); stackParts.inter.position.y = t > TT.sic_off + 30 ? -(0.5 * 12 * (t - TT.sic_off - 30) ** 2) : 0;
    cover.visible = t < TT.les + 15; cover.position.y = 98.9 + (t > TT.les ? 0.5 * 60 * Math.min(t - TT.les, 15) ** 2 / 15 : 0);
    const pr = Math.exp(-altK / 7.2);
    if (t >= -8.9 && t < TT.sic_off) for (const p of PL.f1) { p.visible = true; p.scale.set(1 + (1 - pr) * 4, 1 + (1 - pr) * 2.5, 1 + (1 - pr) * 4); p.material.uniforms.k.value = Math.min(1, (t + 8.9) / 6); }   // ignition sequence starts T-8.9 s
    if (t >= TT.sii_on && t < TT.sii_off) for (const p of PL.j2ii) p.visible = true;
    if ((t >= TT.sivb_on && t < TT.sivb_off) || burning('TLI', t)) PL.j2ivb[0].visible = true;
    if (t >= TT.les && t < TT.les + 4) PL.les[0].visible = true;
    // SLA petals open at TD&E
    for (const p of V.sla) { const open = Math.max(0, Math.min(1, (t - tdeStart) / 8)); p.quaternion.setFromAxisAngle(p.userData.hinge, open * 0.8); p.visible = t < tdeStart + 120; }
    if (t > tdeStart + 8) for (const p of V.sla) { const d = t - tdeStart - 8; p.position.copy(p.userData.hinge.clone().cross(new THREE.Vector3(0, 1, 0)).multiplyScalar(-0.3 * d)).setY(85.7 - 0.05 * d); }
    else for (const p of V.sla) p.position.set(0, 85.7, 0);
  }
  // --- CSM placement & attitude
  const Xc = S('csm', t);
  let qC = null, csmOff = new THREE.Vector3();
  if (inStack) {   // CSM + LM ride on the stack
    csm.position.copy(stack.position).add(new THREE.Vector3(0, 94.2, 0).applyQuaternion(stack.quaternion)); csm.quaternion.copy(stack.quaternion);
    lm.position.copy(stack.position).add(new THREE.Vector3(0, 86.0, 0).applyQuaternion(stack.quaternion)); lm.quaternion.copy(stack.quaternion);
  } else {
    place(csm, Xc.p, O);
    if (t < TT.eject + 400) {   // transposition, docking and extraction choreography relative to the S-IVB (approx)
      const qs = stack.quaternion, base = stack.position.clone();
      const ax = new THREE.Vector3(0, 1, 0).applyQuaternion(qs);
      let dist, flip;
      if (t < tdeDock) {
        const u = (t - tdeStart) / (tdeDock - tdeStart);
        // separate and coast out ~16 m, pitch 180 deg, then close in until the probe meets the LM drogue (CSM origin at 99.7 m)
        flip = Math.max(0, Math.min(1, (u - 0.35) / 0.25)); flip = flip * flip * (3 - 2 * flip);
        dist = u < 0.35 ? 94.2 + u / 0.35 * 16 : u < 0.6 ? 110.2 : 110.2 - Math.min(1, (u - 0.6) / 0.38) * (110.2 - 99.7);
      } else { dist = 99.7 + (t > TT.eject ? Math.min(t - TT.eject, 400) * 0.3 : 0); flip = 1; }
      const qf = qs.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), flip * Math.PI));
      csm.quaternion.copy(qf); csm.position.copy(base).add(ax.clone().multiplyScalar(dist));
      if (t >= tdeDock) { lm.position.copy(base).add(ax.clone().multiplyScalar(86.0 + (t > TT.eject ? Math.min(t - TT.eject, 400) * 0.3 : 0))); lm.quaternion.copy(qs); }
    } else {
      const docked = t < TT.undock || (t > TT.dock2 && t < TT.jet);
      if (burning('LOI1', t)) qC = quatFromAxes(thrustDir('LOI1', t), toV(Xc.p).sub(toV(moonS.p)).negate());
      else if (burning('LOI2', t)) qC = quatFromAxes(thrustDir('LOI2', t), toV(Xc.p).sub(toV(moonS.p)).negate());
      else if (burning('TEI', t)) qC = quatFromAxes(thrustDir('TEI', t), toV(Xc.p).sub(toV(moonS.p)).negate());
      else if ((t > TT.eject + 3 * 3600 && t < TT.loi1 - 2 * 3600) || (t > TT.tei + 2 * 3600 && t < TT.cmsm - 1800)) qC = ptcQuat(t, Xc);
      else if (t > TT.loi1 && t < TT.tei) qC = localHorizontal(t, Xc, moonS.p, false);
      else if (t >= TT.ei) {   // entry: heat shield forward, ~20 deg trim, lift vector banked
        const v = toV(Xc.v).sub(new THREE.Vector3(0, 0, 0)), up = toV(Xc.p).normalize();
        qC = quatFromAxes(v.clone().negate(), up).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.35));
      } else qC = quatFromAxes(toV(Xc.v), toV(Xc.p).negate());
      csm.quaternion.copy(qC);
      if (docked) {   // LM docked ahead of the CM: probe-drogue, LM upside down relative to the CSM
        lm.quaternion.copy(qC).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI));
        lm.position.copy(csm.position).add(new THREE.Vector3(0, 8.2 + 5.55, 0).applyQuaternion(qC));
        lm.userData.desc.visible = t < TT.undock;
      }
    }
  }
  if (burning('LOI1', t) || burning('LOI2', t) || burning('TEI', t) || burning('MCC2', t) || burning('EVA', t)) PL.sps[0].visible = true;
  // --- LM after undocking (descent, surface, ascent, rendezvous, jettison)
  const lmFree = t >= TT.undock && !(t > TT.dock2 && t < TT.jet);
  if (lmFree && t >= track.lm.t0) {
    const Xl = S('lm', t); place(lm, Xl.p, O);
    // both craft share one trajectory point until they separate: keep the docked spacing (LM ~13.75 m beyond the CM apex)
    if (t < TT.pdi) lm.position.add(new THREE.Vector3(0, 13.75, 0).applyQuaternion(csm.quaternion));
    const rM = toV(Xl.p).sub(toV(moonS.p)), up = rM.clone().normalize();
    let ql;
    if (burning('DOI', t)) ql = quatFromAxes(thrustDir('DOI', t), up);
    else if (t >= TT.pdi && t < TT.land) {
      const th = thrustDir('PDI', t);
      // face-down until the yaw at 102:36:57, face-up after 102:37:59 (windows = +z)
      const yawF = Math.max(0, Math.min(1, (t - TT.yaw0) / (TT.yaw1 - TT.yaw0)));
      const fwd = toV(Xl.v).sub(toV(moonS.v)).projectOnPlane(th).normalize();
      const down = up.clone().negate().projectOnPlane(th).normalize();
      const zDir = down.clone().multiplyScalar(Math.cos(yawF * Math.PI)).add(fwd.clone().cross(th).normalize().multiplyScalar(Math.sin(yawF * Math.PI))).normalize();
      ql = quatFromAxes(th, zDir.lengthSq() > 0.1 ? zDir : fwd); PL.dps[0].visible = true; PL.dps[0].material.uniforms.k.value = 1;
    } else if (t >= TT.land && t < TT.asc) {   // on the surface: tilted 4.4 deg pitch, 0.5 deg roll, yaw 13.3 deg (Table 9.6-IV); +z faces west (approx)
      const west = sb.east.clone().negate(), qs = quatFromAxes(sb.up, west.applyAxisAngle(sb.up, 13.3 * Math.PI / 180));
      ql = qs.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(4.4 * Math.PI / 180, 0, 0.5 * Math.PI / 180)));
      place(lm, site, O); lm.position.add(sb.up.clone().multiplyScalar(0));
    } else if (t >= TT.asc && t < TT.asc_end) { ql = quatFromAxes(thrustDir('ASC', t), toV(Xl.v).sub(toV(moonS.v))); PL.aps[0].visible = true; }
    else if (t >= TT.asc_end && t < TT.dock2 + 120) ql = quatFromAxes(up, toV(Xc.p).sub(toV(Xl.p)).normalize());   // radar pointing at the CSM
    else ql = quatFromAxes(toV(Xl.v).sub(toV(moonS.v)), up.clone().negate());
    lm.quaternion.copy(ql);
    lm.userData.desc.visible = t < TT.asc;
  }
  // descent stage stays at Tranquility Base after liftoff
  if (t >= TT.asc && lunarGround.visible) {
    if (lmDescent.parent === lm) { scene.add(lmDescent); }
    lmDescent.visible = true; place(lmDescent, site, O);
    const west = sb.east.clone().negate(); lmDescent.quaternion.copy(quatFromAxes(sb.up, west.applyAxisAngle(sb.up, 13.3 * Math.PI / 180)));
  } else if (lmDescent.parent !== lm && t < TT.asc) { lm.add(lmDescent); lmDescent.position.set(0, 0, 0); lmDescent.quaternion.identity(); }
  else if (t >= TT.asc && !lunarGround.visible && lmDescent.parent !== lm) lmDescent.visible = false;
  { const gd = TT.undock - 3 * 3600; V.lm && 0; const f = Math.max(0, Math.min(1, (t - gd) / 8)); lm.userData.setGear(f); if (V.lm.userData.setGear) V.lm.userData.setGear(0); }   // landing gear deployed before undocking (time approx)
  // --- surface activities: flag, TV camera, experiments, astronauts (positions approximate, times from the report)
  const onSurf = lunarGround.visible && t > TT.land;
  const surf = (obj, e, n, tShow, tHide = Infinity) => { obj.visible = onSurf && t > tShow && t < tHide; if (!obj.visible) return;
    const p = sb.east.clone().multiplyScalar(e).add(sb.north.clone().multiplyScalar(n)); place(obj, site, O); obj.position.add(p).add(sb.up.clone().multiplyScalar(terrainH(e, -n) * 0));
    obj.quaternion.copy(quatFromAxes(sb.up, sb.north)); };
  surf(kit.userData.flag, -6, 6, met_(110, 9)); surf(kit.userData.tv, -10, 17, met_(109, 52)); surf(kit.userData.psep, -6, -16, met_(111, 0)); surf(kit.userData.lrrr, -12, -14, met_(111, 3)); surf(kit.userData.swc, 2, 7, met_(109, 58), met_(111, 18));
  const walk = (a, path) => {   // path: [[met, east, north], ...]
    const t0 = path[0][0], tn = path[path.length - 1][0]; a.visible = onSurf && t >= t0 && t <= tn; if (!a.visible) return;
    let k = 0; while (k < path.length - 2 && t > path[k + 1][0]) k++;
    const [ta, ea, na] = path[k], [tb, eb, nb] = path[k + 1], u = Math.max(0, Math.min(1, (t - ta) / (tb - ta)));
    const e2 = ea + (eb - ea) * u, n2 = na + (nb - na) * u; place(a, site, O); a.position.add(sb.east.clone().multiplyScalar(e2)).add(sb.north.clone().multiplyScalar(n2));
    const dir = sb.east.clone().multiplyScalar(eb - ea).add(sb.north.clone().multiplyScalar(nb - na)); a.quaternion.copy(quatFromAxes(sb.up, dir.lengthSq() > 1e-6 ? dir : sb.north));
    const hop = Math.abs(Math.sin(timeNow * 4)) * (dir.lengthSq() > 1e-6 ? 0.25 : 0); a.position.add(sb.up.clone().multiplyScalar(hop));
  };
  walk(crew.Armstrong, [[met_(109, 21), -3.9, 0.4], [met_(109, 24, 15), -4.6, 0.5], [met_(109, 34), -6, 2], [met_(109, 43), -10, 15], [met_(110, 4), -6, 6], [met_(110, 18), -3, -6], [met_(110, 41), 5, -3], [met_(111, 0), -6, -14], [met_(111, 11), 60, 3], [met_(111, 18), -4, 1], [met_(111, 37), -4.2, 0.4]]);
  walk(crew.Aldrin, [[met_(109, 41), -4.2, 0.4], [met_(109, 44), -5, 1], [met_(109, 58), 2, 7], [met_(110, 4), -6, 5.2], [met_(110, 34), 3, 3], [met_(110, 53), -6, -15], [met_(111, 11), -2, -4], [met_(111, 23), -4.2, 0.4]]);
  // --- re-entry: plasma, chutes, SM jettisoned
  const inEntry = t >= TT.ei && t < TT.drogue;
  plasma.visible = inEntry; if (inEntry) { const v = v3.len(Xc.v), rho = Math.exp(-(v3.len(Xc.p) - R_E) / 7.2); plasma.material.uniforms.k.value = Math.min(2.5, rho * v ** 3 * 6); /* ~ density x velocity^3 (heating rate) */ plasma.material.uniforms.time.value = timeNow; }
  const cmOnly = t >= TT.cmsm;
  for (const c of csm.children) if (c !== csm.userData.cm && c !== plasma && c !== PL.sps[0]) c.visible = !cmOnly;
  if (cmOnly) PL.sps[0].visible = false;
  chutes.visible = t >= TT.drogue && t < TT.splash + 600;
  if (chutes.visible) { chutes.position.copy(csm.position); chutes.quaternion.copy(quatFromAxes(toV(Xc.p).normalize(), new THREE.Vector3(1, 0, 0)));
    chutes.userData.drogues.visible = t < TT.main; for (const mm2 of chutes.userData.mains) { mm2.visible = t >= TT.main; mm2.scale.setScalar(Math.min(1, (t - TT.main) / 8 + 0.15)); } }
  if (t >= TT.drogue) csm.quaternion.copy(quatFromAxes(toV(Xc.p).normalize(), new THREE.Vector3(1, 0, 0)));
  // --- camera: third person, nearest body kept in frame
  const target = t >= TT.drogue ? csm.position.clone().add(toV(Xc.p).normalize().multiplyScalar(t >= TT.main ? 16 : 8)) : (who === 'lm' && lmFree) ? lm.position : (inStack ? stack.position.clone().add(new THREE.Vector3(0, t < 0.6 ? 55 : 60, 0).applyQuaternion(stack.quaternion)) : csm.position);
  const nearDir = (() => { const dE2 = v3.len(O) - R_E, dM = v3.len(v3.sub(O, moonS.p)) - R_M; const c = (R_E / v3.len(O)) > (R_M / v3.len(v3.sub(O, moonS.p))) ? [0, 0, 0] : moonS.p; return toV(v3.norm(v3.sub(O, c))); })();
  camU.lerp(nearDir, 1 - Math.exp(-dt / 1.5)).normalize();
  const baseDist = inStack ? (t < TT.sic_off ? 230 : 160) : (t >= TT.drogue ? (t >= TT.main ? 110 : 60) : (who === 'lm' ? (t > TT.land && t < TT.asc ? 32 : 26) : (t > TT.cmsm ? 18 : 40)));
  const dist = baseDist * st.zoom;
  const lowAlt = (altE < 50 && t < 3600) || (lunarGround.visible && altSite < 2) || (oceanGroup.visible && altE < 8);
  const tilt = lowAlt ? 78 : 25;
  let k = new THREE.Vector3().crossVectors(camU, new THREE.Vector3(0, 0, 1)); if (k.lengthSq() < 1e-6) k.set(1, 0, 0); k.normalize();
  let c = camU.clone().applyAxisAngle(k, tilt * Math.PI / 180 + st.pitch).applyAxisAngle(camU, st.yaw).normalize();
  if (lunarGround.visible && altSite < 2) c = sb.up.clone().multiplyScalar(Math.sin(0.25 + st.pitch * 0.5)).add(sb.east.clone().applyAxisAngle(sb.up, 0.9 + st.yaw).multiplyScalar(Math.cos(0.25))).normalize();
  camera.position.copy(target).add(c.multiplyScalar(dist));
  const look = c.clone().negate().lerp(camU.clone().negate(), lowAlt ? 0.0 : 0.45).normalize();
  camera.up.copy(camU); camera.lookAt(camera.position.clone().add(look.lengthSq() > 0 ? look : new THREE.Vector3(1, 0, 0)));
  if (lowAlt && !lunarGround.visible) camera.lookAt(target);
  if (lunarGround.visible && altSite < 2) camera.lookAt(target.clone().add(sb.up.clone().multiplyScalar(2)));
  sun.target.position.copy(target); sun.position.add(target); earthshine.target.position.copy(target); earthshine.position.add(target);
  // --- exposure (sunlit vs. shadowed scenes)
  renderer.toneMappingExposure = vis > 0.05 ? 1.0 : 2.5;
  // --- events & HUD
  const ni = EVENTS.findIndex(ev => ev.t > t) - 1;
  if (ni > lastEv) { for (let i = lastEv + 1; i <= ni; i++) if (t - EVENTS[i].t < 30 * st.speed) toast(EVENTS[i]); }
  lastEv = ni; if (toastT > 0 && (toastT -= dt) <= 0) $('toast').classList.remove('show');
  $('met').textContent = 'MET ' + metStr(t);
  $('utc').textContent = new Date(UTC0 + t * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const dM = v3.len(v3.sub(X.p, moonS.p));
  const nearMoon = R_M / dM > R_E / v3.len(X.p);
  const pe = mv(Tm(M), X.p), latg = Math.asin(pe[2] / v3.len(pe)), rLocal = 6378.137 * (1 - 0.0033528 * Math.sin(latg) ** 2);
  $('alt').textContent = nearMoon ? fmt(dM - (R_M - 1.93), 1) + ' km above the Moon' : fmt(Math.max(0, v3.len(X.p) - rLocal), 1) + ' km above Earth';
  const wE = mv(M, [0, 0, 1]), vEarthFixed = v3.sub(X.v, v3.scale(v3.cross(wE, X.p), 7.2921159e-5));
  const mpole = new THREE.Vector3(0, 0, 1).applyQuaternion(mq), rM = v3.sub(X.p, moonS.p), wM = 2 * Math.PI / (27.321661 * 86400);
  const vMoonFixed = v3.sub(v3.sub(X.v, moonS.v), v3.scale(v3.cross([mpole.x, mpole.y, mpole.z], rM), wM));
  const vrel = nearMoon ? (dM - R_M < 50 ? v3.len(vMoonFixed) : v3.len(v3.sub(X.v, moonS.v))) : (v3.len(X.p) < R_E + 2000 ? v3.len(vEarthFixed) : v3.len(X.v));
  $('vel').textContent = fmt(vrel * 3280.84, 0) + ' ft/s (' + (nearMoon ? 'Moon' : 'Earth') + ')';
  $('dist').textContent = fmt(v3.len(X.p), 0) + ' km from Earth · ' + fmt(dM, 0) + ' km from Moon';
  $('sunlit').textContent = vis > 0.99 ? 'sunlit' : vis > 0.01 ? 'penumbra' : (v3.len(v3.sub(X.p, moonS.p)) < 5000 ? 'in the Moon\'s shadow' : 'in Earth\'s shadow');
  $('who').textContent = who === 'lm' ? 'Eagle (LM)' : (t < TT.tde ? 'Saturn V' : 'Columbia (CSM)');
  const ev = EVENTS[Math.max(0, ni)]; $('phase').innerHTML = ni >= 0 ? `${ev.title} <span class="tag ${ev.tag}">${ev.tag}</span>` : 'Countdown';
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
function met_(h, m, s = 0) { return h * 3600 + m * 60 + s; }
$("loading").remove();
requestAnimationFrame(frame);
setInterval(() => reanchor(), 5000);
