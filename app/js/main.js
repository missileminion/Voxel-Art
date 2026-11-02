// Voyager 2 voxel mission viewer.
import * as THREE from './vendor/three.module.js';
import { loadMission, loadBin, tdbToDate, v3 } from './data.js';
import { buildVoyager, buildPad } from './voxel.js';
import { Stack } from './launch.js';

const $ = (id) => document.getElementById(id);
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
                set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };

const { meta, voyager, bodies } = await loadMission();
const AU = meta.au, JD0 = meta.jd_ref, TL = meta.t_liftoff;
const EVENTS = meta.events;

// ---------------------------------------------------------------- renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
$('view').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 4e7);
camera.up.set(0, 0, 1);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

const sunLight = new THREE.DirectionalLight(0xffffff, 3);
scene.add(sunLight, sunLight.target);
const ambient = new THREE.AmbientLight(0x8090b0, 0.02); scene.add(ambient);
const skyFill = new THREE.HemisphereLight(0xa8c8ff, 0x4a5a3a, 0); scene.add(skyFill);
const voxMat = new THREE.MeshLambertMaterial();

// ---------------------------------------------------------------- shared shader bits (log depth)
const LD_V = '#include <common>\n#include <logdepthbuf_pars_vertex>\n', LD_F = '#include <logdepthbuf_pars_fragment>\n';
const texLoader = new THREE.TextureLoader();
const texCache = {};
function tex(name, srgb = true) {
  if (texCache[name]) return texCache[name];
  const t = texLoader.load('app/tex/' + name); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return (texCache[name] = t);
}

// ---------------------------------------------------------------- sky: real star catalogue (to mag 8) + Milky Way
// both are built in equatorial J2000 and turned into the ecliptic scene frame by one rotation about x
const skyGroup = new THREE.Group(); skyGroup.rotation.x = -23.4392911 * Math.PI / 180; scene.add(skyGroup);
const skyUniforms = { gain: { value: 1 } };
const milky = new THREE.Mesh(new THREE.SphereGeometry(3e6, 96, 48), new THREE.MeshBasicMaterial({ map: tex('milkyway.jpg'), side: THREE.BackSide, depthWrite: false, depthTest: false, toneMapped: false }));
milky.rotation.x = Math.PI / 2; milky.renderOrder = -20; skyGroup.add(milky);
{
  const buf = await loadBin('app/tex/', 'stars'), a = new Float32Array(buf), n = a.length / 5;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), mag = new Float32Array(n);
  const BV = [[-0.4, 0.61, 0.70, 1.0], [0.0, 0.79, 0.85, 1.0], [0.4, 1.0, 0.97, 0.93], [0.8, 1.0, 0.88, 0.73], [1.2, 1.0, 0.78, 0.56], [1.6, 1.0, 0.69, 0.43], [2.2, 1.0, 0.6, 0.32]];
  for (let i = 0; i < n; i++) {
    pos[i * 3] = a[i * 5] * 2.5e6; pos[i * 3 + 1] = a[i * 5 + 1] * 2.5e6; pos[i * 3 + 2] = a[i * 5 + 2] * 2.5e6; mag[i] = a[i * 5 + 3];
    const bv = Math.max(-0.4, Math.min(2.2, a[i * 5 + 4])); let k = 0; while (k < BV.length - 2 && bv > BV[k + 1][0]) k++;
    const f = (bv - BV[k][0]) / (BV[k + 1][0] - BV[k][0]);
    for (let c = 0; c < 3; c++) col[i * 3 + c] = BV[k][c + 1] + (BV[k + 1][c + 1] - BV[k][c + 1]) * f;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('mag', new THREE.BufferAttribute(mag, 1));
  // drawn in the opaque pass, before everything else (additive blending still applies without 'transparent')
  const m = new THREE.ShaderMaterial({ uniforms: { gain: skyUniforms.gain, dpr: { value: renderer.getPixelRatio() } }, transparent: false, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending, vertexColors: true, toneMapped: false,
    vertexShader: `attribute float mag; uniform float dpr; varying vec3 vC; varying float vA;
      void main(){ float I = pow(10.0, -0.4 * (mag - 1.0));
        vA = clamp(0.10 + 0.9 * pow(10.0, -0.4 * (mag - 4.2)), 0.0, 1.0);
        vC = color; gl_PointSize = clamp(1.3 + 2.4 * pow(I, 0.28), 1.3, 7.0) * dpr;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float gain; varying vec3 vC; varying float vA;
      void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d, d) * 4.0; if (r > 1.0) discard;
        float k = exp(-r * 3.5) + 0.12 * exp(-r * 0.8); gl_FragColor = vec4(vC * k * vA * gain, 1.0); }` });
  const stars = new THREE.Points(g, m); stars.frustumCulled = false; stars.renderOrder = -19; skyGroup.add(stars);
}

// ---------------------------------------------------------------- bodies: smooth textured spheres
const planets = meta.planets;
const bodyList = [];
const POINT_COL = { mercury: 0xb0a89c, venus: 0xf2e6c4, earth: 0x9cb8e8, moon: 0xc8c4bc, mars: 0xe08a5a, jupiter: 0xeedfc4, saturn: 0xe8d6a6,
  uranus: 0xb8e2e6, neptune: 0x7f9be8, Io: 0xf0e08a, Europa: 0xf2ece0, Ganymede: 0xc4bcb0, Callisto: 0x8a8070, Titan: 0xe8a858, Triton: 0xf0dcd4 };
function makeBody(name, R, Rp, opts = {}) {
  const b = { name, R, Rp: Rp || R, mesh: null, group: new THREE.Group(), pole: opts.pole, rot: opts.rot,
              alb: opts.alb ?? 0.3, isMoon: !!opts.moon, parent: opts.parent, orbit: opts.orbit, emissive: name === 'sun',
              pcol: new THREE.Color(POINT_COL[name] ?? 0xc8c4bc) };
  scene.add(b.group); bodyList.push(b); return b;
}
for (const n of ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'])
  makeBody(n, planets[n].r, planets[n].rp, { pole: planets[n].pole, rot: planets[n].rot, alb: planets[n].alb });
for (const m of meta.moons)
  makeBody(m.name, m.r, m.r, { moon: true, parent: m.planet, orbit: m, alb: m.alb, pole: planets[m.planet].pole });
const byName = Object.fromEntries(bodyList.map(b => [b.name, b]));

const sunDirU = { value: new THREE.Vector3(1, 0, 0) };
function atmosphere(color, strength) {
  return new THREE.ShaderMaterial({ uniforms: { sunDir: sunDirU, col: { value: new THREE.Color(color) }, k: { value: strength } },
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
    vertexShader: LD_V + `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: LD_F + `uniform vec3 sunDir; uniform vec3 col; uniform float k; varying vec3 vN; varying vec3 vV;
      void main(){
        #include <logdepthbuf_fragment>
        float rim = pow(1.0 - max(dot(vN, vV), 0.0), 2.6); float day = smoothstep(-0.25, 0.4, dot(vN, sunDir));
        gl_FragColor = vec4(col * rim * day * k, 1.0); }` });
}
function buildMesh(b) {
  const key = b.name.toLowerCase(), big = !b.isMoon;
  const geo = new THREE.SphereGeometry(1, big ? 192 : 64, big ? 96 : 32);
  const mat = b.emissive ? new THREE.MeshBasicMaterial({ map: tex('sun.jpg'), color: 0xffffff })
                         : new THREE.MeshLambertMaterial({ map: tex(key + '.jpg') });
  b.mesh = new THREE.Mesh(geo, mat); b.mesh.scale.set(1, b.Rp / b.R, 1);
  b.spin = new THREE.Group(); b.spin.add(b.mesh); b.group.add(b.spin);
  if (key === 'earth') {
    b.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.0018, 160, 80), new THREE.MeshLambertMaterial({ map: tex('earth_clouds.png'), transparent: true, depthWrite: false }));
    b.clouds.scale.copy(b.mesh.scale); b.spin.add(b.clouds);
    b.atm = new THREE.Mesh(new THREE.SphereGeometry(1.025, 96, 48), atmosphere(0x4f8dff, 1.6)); b.group.add(b.atm);
  }
  if (key === 'venus') { b.atm = new THREE.Mesh(new THREE.SphereGeometry(1.02, 64, 32), atmosphere(0xffe8b0, 0.8)); b.group.add(b.atm); }
  if (key === 'titan') { b.atm = new THREE.Mesh(new THREE.SphereGeometry(1.08, 64, 32), atmosphere(0xd99a42, 1.0)); b.group.add(b.atm); }
  if (['jupiter', 'saturn', 'uranus', 'neptune'].includes(key)) {
    const c = { jupiter: 0xe8d8b8, saturn: 0xe8d8a8, uranus: 0x9fe0e8, neptune: 0x6f8fff }[key];
    b.atm = new THREE.Mesh(new THREE.SphereGeometry(1.012, 96, 48), atmosphere(c, 0.35)); b.atm.scale.copy(b.mesh.scale); b.spin.add(b.atm);
  }
  const RING = { saturn: [66000, 141000], uranus: [41000, 52000], neptune: [41000, 63500] }[key];
  if (RING) {
    const g = new THREE.RingGeometry(RING[0] / b.R, RING[1] / b.R, 512, 1), p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getY(i)) * b.R; uv.setXY(i, (r - RING[0]) / (RING[1] - RING[0]), 0.5); }
    const rt = tex(key + '_ring.png');
    b.ring = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: rt, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    b.ring.rotation.x = -Math.PI / 2; b.spin.add(b.ring);
  }
  if (b.emissive) {
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,252,240,1)'); gr.addColorStop(0.08, 'rgba(255,240,210,0.9)'); gr.addColorStop(0.3, 'rgba(255,215,160,0.25)'); gr.addColorStop(1, 'rgba(255,200,140,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    b.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }));
    b.group.add(b.glow);
  }
}

// launch-area terrain: a curved, high-resolution disc of the real Earth texture around the Cape (1,500 km radius).
// The global sphere's flat facets would sit up to ~1 km below the true surface at the pad.
let terrain = null;
function buildTerrain() {
  const Rp = Math.hypot(...PAD), NR = 170, NA = 256, verts = [], uvs = [], idx = [];
  const [la, lo] = [Math.asin(PAD[2] / Rp), Math.atan2(PAD[1], PAD[0])];
  const up = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)], east = [-Math.sin(lo), Math.cos(lo), 0], north = v3.cross(up, east);
  for (let i = 0; i <= NR; i++) {
    const rho = 1500 * Math.pow(i / NR, 2.4), al = rho / Rp;
    for (let j = 0; j <= NA; j++) {
      const az = j / NA * 2 * Math.PI, se = Math.sin(az), cn = Math.cos(az);
      verts.push(Rp * Math.sin(al) * se * 1000, (Rp * Math.cos(al) - Rp) * 1000, -Rp * Math.sin(al) * cn * 1000);
      const d = v3.add(v3.scale(up, Math.cos(al)), v3.scale(v3.add(v3.scale(east, se), v3.scale(north, cn)), Math.sin(al)));
      uvs.push(0.5 + Math.atan2(d[1], d[0]) / (2 * Math.PI), 0.5 + Math.asin(d[2]) / Math.PI);
    }
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < NA; j++) { const a = i * (NA + 1) + j, b2 = a + NA + 1; idx.push(a, b2, a + 1, a + 1, b2, b2 + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx); g.computeVertexNormals();
  terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex('earth.jpg'), side: THREE.DoubleSide })); terrain.frustumCulled = false;
  padGroup.add(terrain);
}
const pad = buildPad(voxMat); const padGroup = new THREE.Group(); padGroup.add(pad); scene.add(padGroup);

// point sprites for bodies too small to resolve
const PTS = bodyList.length;
const ptGeo = new THREE.BufferGeometry();
ptGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PTS * 3), 3));
ptGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PTS * 3), 3));
ptGeo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(PTS), 1));
const points = new THREE.Points(ptGeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, vertexColors: true, blending: THREE.AdditiveBlending, toneMapped: false,
  vertexShader: LD_V + 'attribute float size; varying vec3 vC; void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size; gl_Position=projectionMatrix*mv;\n#include <logdepthbuf_vertex>\n}',
  fragmentShader: LD_F + 'varying vec3 vC; void main(){\n#include <logdepthbuf_fragment>\n vec2 d=gl_PointCoord-0.5; float r=dot(d,d)*4.0; if(r>1.0) discard; gl_FragColor=vec4(vC*(exp(-r*3.0)+0.1),1.0); }' }));
points.frustumCulled = false; scene.add(points);

// ---------------------------------------------------------------- spacecraft
const craft = new THREE.Group(); scene.add(craft);
const vparts = buildVoyager(voxMat);
const voy = new THREE.Group(); craft.add(voy);
voy.add(vparts.body, vparts.whips);
const scanPivot = new THREE.Group(); scanPivot.position.copy(vparts.scanPivot); scanPivot.add(vparts.scan); voy.add(scanPivot);
const magPivot = new THREE.Group(); magPivot.position.copy(vparts.magPivot); magPivot.add(vparts.mag); voy.add(magPivot);
const thrusterPuff = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.2, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xdfe8ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
thrusterPuff.rotation.x = Math.PI / 2; thrusterPuff.position.set(0, 0, -2.1); voy.add(thrusterPuff);
const stack = new Stack(scene, voxMat, meta);

// ---------------------------------------------------------------- Earth orientation (for the pad and Earth's globe)
const ECL = 23.4392911 * Math.PI / 180;
function R3(a) { const c = Math.cos(a), s = Math.sin(a); return [[c, s, 0], [-s, c, 0], [0, 0, 1]]; }
function R2(a) { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, -s], [0, 1, 0], [s, 0, c]]; }
function mm(A, B) { return A.map((r, i) => B[0].map((_, j) => r[0] * B[0][j] + r[1] * B[1][j] + r[2] * B[2][j])); }
function mv(A, v) { return [A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2], A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2], A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2]]; }
function T(A) { return [[A[0][0], A[1][0], A[2][0]], [A[0][1], A[1][1], A[2][1]], [A[0][2], A[1][2], A[2][2]]]; }
const AS = Math.PI / 648000;
function ecefToWorld(t) {
  const jdt = JD0 + t / 86400, Tc = (jdt - 2451545) / 36525;
  const zeta = (2306.2181 * Tc + 0.30188 * Tc * Tc) * AS, z = (2306.2181 * Tc + 1.09468 * Tc * Tc) * AS, th = (2004.3109 * Tc - 0.42665 * Tc * Tc) * AS;
  const P = mm(mm(R3(-z), R2(th)), R3(-zeta));
  const jdu = tdbToDate(JD0, t).getTime() / 86400000 + 2440587.5, d = jdu - 2451545;
  const g = ((280.46061837 + 360.98564736629 * d) % 360) * Math.PI / 180;
  const E = [[1, 0, 0], [0, Math.cos(ECL), Math.sin(ECL)], [0, -Math.sin(ECL), Math.cos(ECL)]];
  return mm(mm(E, T(P)), R3(-g));
}
const PADLL = [28.5833 * Math.PI / 180, -80.5772 * Math.PI / 180];
function padECEF() {
  const [la, lo] = PADLL, f = 1 / 298.257, e2 = f * (2 - f), N = 6378.137 / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
  return [N * Math.cos(la) * Math.cos(lo), N * Math.cos(la) * Math.sin(lo), N * (1 - e2) * Math.sin(la)];
}
const PAD = padECEF();

// ---------------------------------------------------------------- state & helpers
const st = { t: store.get('v2.t', TL - 45), speed: 1, auto: store.get('v2.auto', true), playing: true, exposureMode: 'auto', exposure: 1,
             userYaw: 0, userPitch: 0, zoom: 1, nearest: 'earth', u: null, lastEvent: -1 };
{ const q = new URLSearchParams(location.search);
  if (q.has('t')) { const v = q.get('t'); st.t = /^-?[\d.]+$/.test(v) ? TL + parseFloat(v) : (Date.parse(v) ? (await import('./data.js')).dateToTdb(JD0, new Date(v)) : st.t); }
  if (q.get('auto') === '0') st.auto = false; }
if (!(st.t >= TL - 120 && st.t <= meta.t_end)) st.t = TL - 45;
const S = { p: [0, 0, 0], v: [0, 0, 0] };
function bodyState(name, t) {
  if (bodies[name]) { if (name === 'moon' && !bodies.moon.covers(t)) return null; return bodies[name].state(t); }
  const b = byName[name]; if (!b?.orbit) return null;
  const o = b.orbit, P = bodies[o.planet].state(t), ph = o.phi0 + o.n * (t - o.t0);
  const c = Math.cos(ph), s = Math.sin(ph), w = o.n * o.a;
  return { p: [P.p[0] + o.a * (c * o.e1[0] + s * o.e2[0]), P.p[1] + o.a * (c * o.e1[1] + s * o.e2[1]), P.p[2] + o.a * (c * o.e1[2] + s * o.e2[2])],
           v: [P.v[0] + w * (-s * o.e1[0] + c * o.e2[0]), P.v[1] + w * (-s * o.e1[1] + c * o.e2[1]), P.v[2] + w * (-s * o.e1[2] + c * o.e2[2])] };
}
function vehicle(t) {   // spacecraft / rocket state; before liftoff it sits on the rotating pad
  if (t >= voyager.t0) return voyager.state(t);
  const E = bodies.earth.state(t), M = ecefToWorld(t), r = mv(M, PAD), w = 7.2921159e-5;
  const vr = mv(M, [-w * PAD[1], w * PAD[0], 0]);
  return { p: v3.add(E.p, r), v: v3.add(E.v, vr) };
}
const toV = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const fmt = (x, d = 1) => x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

// stack attitude: thrust axis along the air-relative velocity while in the atmosphere, inertial velocity above it
function stackQuat(t) {
  const X = vehicle(t), E = bodies.earth.state(t), r = v3.sub(X.p, E.p), up = v3.norm(r);
  let dir;
  const tl = t - TL;
  if (tl < 6) dir = up;
  else {
    const w = 7.2921159e-5, M = ecefToWorld(t), axis = mv(M, [0, 0, 1]);
    const vrot = v3.scale(v3.cross(axis, r), w), vrel = v3.sub(v3.sub(X.v, E.v), vrot), vin = v3.sub(X.v, E.v);
    const alt = v3.len(r) - 6371, k = Math.min(1, Math.max(0, (alt - 40) / 80));
    dir = v3.norm(v3.add(v3.scale(v3.norm(vrel), 1 - k), v3.scale(v3.norm(vin), k)));
    if (tl < 20) { const f = (tl - 6) / 14; dir = v3.norm(v3.add(v3.scale(up, 1 - f), v3.scale(dir, f))); }
  }
  const y = toV(dir).normalize(), north = toV(v3.norm(v3.cross(up, v3.cross([0, 0, 1], up))));
  let x = new THREE.Vector3().crossVectors(y, north); if (x.lengthSq() < 1e-6) x.set(1, 0, 0); x.normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  // roll so the SRMs sit north/south and the lettered side of the core faces east (the press-site view)
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
}
const qCache = new Map();
function qAt(t) { const k = Math.round(t * 10); if (!qCache.has(k)) { if (qCache.size > 400) qCache.clear(); qCache.set(k, stackQuat(t)); } return qCache.get(k); }

// Voyager attitude: +z (high-gain antenna) at Earth, rolled so Canopus stays in the star tracker (-y side)
const CANOPUS = meta.canopus;
const tcmWindows = meta.tcm.map(c => ({ ...c, dur: Math.max(60, c.dv / 0.0045), slew: 1800 }));   // 4 x 0.89 N on ~800 kg
function voyagerQuat(t, X) {
  const E = bodies.earth.state(t);
  let z = v3.norm(v3.sub(E.p, X.p));
  const date = t; // 2023-07-21..08-04: programming error mis-points the antenna by 2 degrees
  const tm1 = EVENTS.find(e => e.title.startsWith('Antenna mis-pointed'))?.t, tm2 = EVENTS.find(e => e.title.startsWith('Canberra'))?.t;
  let cp = v3.norm(v3.sub(CANOPUS, v3.scale(z, v3.dot(CANOPUS, z))));
  if (tm1 && t > tm1 && t < tm2 + 1800) { const a = 2 * Math.PI / 180 * Math.min(1, (t - tm1) / 600) * Math.min(1, Math.max(0, (tm2 + 1800 - t) / 1800)); z = v3.norm(v3.add(v3.scale(z, Math.cos(a)), v3.scale(cp, Math.sin(a)))); cp = v3.norm(v3.sub(CANOPUS, v3.scale(z, v3.dot(CANOPUS, z)))); }
  const yv = toV(v3.scale(cp, -1)), zv = toV(z), xv = new THREE.Vector3().crossVectors(yv, zv);
  let q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xv, yv, zv));
  for (const c of tcmWindows) {   // turn to burn attitude: thrust along +z
    const t0 = c.t - c.slew, t1 = c.t + c.dur + c.slew; if (t < t0 || t > t1) continue;
    const f = t < c.t ? (t - t0) / c.slew : t > c.t + c.dur ? (t1 - t) / c.slew : 1;
    const qb = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1).applyQuaternion(q), toV(c.dir)).multiply(q);
    q = q.clone().slerp(qb, f * f * (3 - 2 * f));
  }
  return q;
}
function inTCM(t) { return tcmWindows.find(c => t >= c.t && t <= c.t + c.dur); }

// ---------------------------------------------------------------- camera rule
const NORTH = new THREE.Vector3(0, 0, 1);
let camU = null;
function chooseNearest(X, t) {
  // frame the body that looks biggest (angular radius); a small moon that is nearer than its giant planet
  // does not steal the shot. Hysteresis avoids flip-flopping.
  let best = null, bs = -1, cur = -1;
  for (const b of bodyList) {
    const s = bodyState(b.name, t); if (!s) continue;
    const D = v3.len(v3.sub(s.p, X.p)), d = D - (b.name === 'earth' ? 6373.27 : b.R); b._d = d; b._s = s;
    const score = b.R / Math.max(D, b.R * 1.0001);
    if (b.name === st.nearest) cur = score;
    if (score > bs) { bs = score; best = b.name; }
  }
  if (cur > 0 && best !== st.nearest && bs < 1.25 * cur) best = st.nearest;
  st.nearest = best; return byName[best];
}

// ---------------------------------------------------------------- UI
const speeds = [1, 10, 60, 600, 3600, 21600, 86400, 604800, 2592000];
function setSpeedLabel() { $('spd').textContent = st.auto ? 'auto ×' + niceSpeed(st.speed) : '×' + niceSpeed(st.speed); }
function niceSpeed(s) { return s >= 86400 ? fmt(s / 86400, s < 864000 ? 1 : 0) + ' d/s' : s >= 3600 ? fmt(s / 3600, 1) + ' h/s' : fmt(s, 0); }
$('play').onclick = () => { st.playing = !st.playing; $('play').textContent = st.playing ? '❚❚' : '▶'; };
$('slower').onclick = () => { st.auto = false; const i = speeds.findIndex(s => s >= st.speed); st.speed = speeds[Math.max(0, i - 1)]; setSpeedLabel(); };
$('faster').onclick = () => { st.auto = false; const i = speeds.findIndex(s => s > st.speed); st.speed = speeds[i < 0 ? speeds.length - 1 : i]; setSpeedLabel(); };
$('autobtn').onclick = () => { st.auto = !st.auto; setSpeedLabel(); };
$('expo').onclick = () => { st.exposureMode = st.exposureMode === 'auto' ? 'fixed' : 'auto'; $('expo').textContent = st.exposureMode === 'auto' ? 'Exposure: auto' : 'Exposure: fixed (Earth)'; };
const K = 7, t0s = TL - 60, t1s = meta.t_end;
const toU = (t) => Math.log(1 + (Math.max(t, t0s) - t0s) / (t1s - t0s) * (Math.exp(K) - 1)) / K;
const fromU = (u) => t0s + (Math.exp(K * u) - 1) / (Math.exp(K) - 1) * (t1s - t0s);
$('scrub').oninput = (e) => jump(fromU(e.target.value / 1000));
function jump(t) { st.t = t; stack.clearParticles(); st.lastEvent = EVENTS.findIndex(e => e.t > t) - 1; }
// event list
const list = $('events');
for (const [i, e] of EVENTS.entries()) {
  const li = document.createElement('li');
  const d = tdbToDate(JD0, e.t);
  li.innerHTML = `<span class="d">${d.toISOString().slice(0, 10)}</span> <span class="tag ${e.tag}">${e.tag}</span> ${e.title}`;
  li.onclick = () => { jump(e.t - (e.kind === 'launch' ? 20 : e.kind === 'tcm' ? 2400 : e.kind === 'encounter' ? 6 * 3600 : 1800)); };
  list.appendChild(li); e.li = li;
}
$('evtoggle').onclick = () => $('panel').classList.toggle('open');
let toastTimer = 0;
function toast(e) {
  $('toast').innerHTML = `<b>${e.title}</b> <span class="tag ${e.tag}">${e.tag}</span><br>${e.text || ''}`;
  $('toast').classList.add('show'); toastTimer = 7;
}
// drag to orbit, wheel to zoom
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', (e) => { if (!drag) return; st.userYaw += (e.clientX - drag[0]) * 0.005; st.userPitch = Math.max(-1.2, Math.min(1.2, st.userPitch + (e.clientY - drag[1]) * 0.004)); drag = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('wheel', (e) => { st.zoom = Math.max(0.3, Math.min(20, st.zoom * Math.exp(e.deltaY * 0.001))); e.preventDefault(); }, { passive: false });
addEventListener('keydown', (e) => { if (e.key === ' ') $('play').click(); if (e.key === '[') $('slower').click(); if (e.key === ']') $('faster').click(); if (e.key === 'a') $('autobtn').click(); });
setSpeedLabel();

// labels
const labels = {};
function label(name, text) { if (!labels[name]) { const d = document.createElement('div'); d.className = 'lbl'; $('labels').appendChild(d); labels[name] = d; } labels[name].textContent = text; return labels[name]; }

// ---------------------------------------------------------------- auto speed
function autoSpeed(t, X, near) {
  const tl = t - TL;
  if (tl < -1) return 1;
  if (tl < meta.launch.t_ins + 30) return 1;
  if (tl < meta.launch.t_mes2 - 40) return 20;
  if (tl < (meta.t_escape - TL) + 120) return 1;
  if (tl < stack.detach.pm.t + 60) return 30;
  const rel = v3.sub(X.v, near._s.v), vr = Math.max(0.5, v3.len(rel));
  let s = Math.max(1, Math.min(3e6, (Math.max(near._d, 100) / vr) / 25));
  const tc = tcmWindows.find(c => t > c.t - c.slew - 600 && t < c.t + c.dur + c.slew);
  if (tc) s = Math.min(s, (tc.dur + 2 * tc.slew) / 25);
  return s;
}

// ---------------------------------------------------------------- frame
const clock = new THREE.Clock();
let lastSave = 0;
function frame() {
  const dtr = Math.min(clock.getDelta(), 0.1);
  const X0 = vehicle(st.t);
  const near0 = chooseNearest(X0, st.t);
  if (st.auto) { const target = autoSpeed(st.t, X0, near0); st.speed = Math.exp(Math.log(st.speed) + (Math.log(target) - Math.log(st.speed)) * Math.min(1, dtr * 2)); setSpeedLabel(); }
  const simDt = st.playing ? dtr * st.speed : 0;
  st.t = Math.min(meta.t_end, st.t + simDt);
  const t = st.t, tl = t - TL;
  const X = vehicle(t), near = chooseNearest(X, t);

  // events
  const ni = EVENTS.findIndex(e => e.t > t) - 1;
  if (ni > st.lastEvent && st.playing) { for (let i = st.lastEvent + 1; i <= ni; i++) if (simDt > 0 && t - EVENTS[i].t < 3 * Math.max(simDt / dtr, 1)) toast(EVENTS[i]); }
  st.lastEvent = ni;
  if (toastTimer > 0 && (toastTimer -= dtr) <= 0) $('toast').classList.remove('show');

  // light & exposure (irradiance ~ 1/r^2)
  const sun = bodyState('sun', t), toSun = v3.sub(sun.p, X.p), dSun = v3.len(toSun) / AU, E = 1 / (dSun * dSun);
  sunLight.position.copy(toV(v3.norm(toSun)).multiplyScalar(100)); sunLight.intensity = 3.2 * E;
  const expTarget = st.exposureMode === 'auto' ? Math.pow(E, -0.82) : 1;
  st.exposure = Math.exp(Math.log(st.exposure) + (Math.log(expTarget) - Math.log(st.exposure)) * Math.min(1, dtr * 1.5));
  renderer.toneMappingExposure = st.exposure;

  // altitude / sky
  const earth = bodyState('earth', t), rE = v3.sub(X.p, earth.p), alt = v3.len(rE) - 6373.27;  // local radius at the Cape
  const sunUp = v3.dot(v3.norm(rE), v3.norm(v3.sub(sun.p, earth.p)));
  const sky = Math.max(0, Math.min(1, 1 - alt / 70)) * Math.max(0, Math.min(1, sunUp * 4 + 0.2));
  scene.background.setRGB(0.32 * sky, 0.55 * sky, 0.95 * sky);
  skyGroup.visible = sky < 0.35; skyGroup.position.copy(camera.position);
  skyUniforms.gain.value = (1 - sky / 0.35) * Math.min(1.2, 0.55 + 0.17 * Math.log10(st.exposure + 1e-9) + 0.25);
  milky.material.color.setScalar(skyUniforms.gain.value);
  skyFill.intensity = 1.6 * sky; skyFill.position.copy(toV(v3.norm(rE)));
  const pressure = Math.exp(-Math.max(alt, 0) / 7.2);
  const vacuum = Math.min(1, Math.max(0, (alt - 12) / 60)) ** 1.5;   // plume expansion with altitude

  // bodies
  const H = renderer.domElement.height, f = (H / 2) / Math.tan(camera.fov * Math.PI / 360);
  const pp = ptGeo.attributes.position.array, pc = ptGeo.attributes.color.array, ps = ptGeo.attributes.size.array;
  sunDirU.value.copy(toV(v3.norm(toSun)));
  bodyList.forEach((b, i) => {
    const s = b._s || bodyState(b.name, t);
    ps[i] = 0;
    if (!s) { b.group.visible = false; return; }
    const rel = v3.sub(s.p, X.p), Dkm = v3.len(rel), D = Dkm * 1000, u = v3.scale(rel, 1 / Dkm);
    const R = b.R * 1000, surf = D - R;
    // true scale near a surface; farther away a log-compressed distance with angular size preserved
    const Dr = (surf < 2e6 && D < 3e7) ? D : (D < 5e3 ? D : 5e3 * (1 + Math.log(D / 5e3)));
    const sc = Dr / D, px = (b.R / Dkm) * f;
    const show = (px > 1.6 || b.emissive) && !(b.name === 'earth' && alt < 60);
    if (show) {
      if (!b.mesh) buildMesh(b);
      b.group.visible = true; b.group.position.set(u[0] * Dr, u[1] * Dr, u[2] * Dr); b.group.scale.setScalar(R * sc);
      if (b.name === 'earth') {
        const M = ecefToWorld(t);
        b.spin.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(toV(mv(M, [1, 0, 0])), toV(mv(M, [0, 0, 1])), toV(mv(M, [0, -1, 0]))));
        b.clouds.rotation.y = (t / 86400) * 0.15;                         // clouds drift slowly against the ground
      } else if (b.orbit || b.name === 'moon') {
        // synchronous rotation: sub-planet point at texture longitude 0, leading hemisphere at +90
        let r, h;
        if (b.orbit) { const o = b.orbit, ph = o.phi0 + o.n * (t - o.t0); r = v3.add(v3.scale(o.e1, Math.cos(ph)), v3.scale(o.e2, Math.sin(ph))); h = v3.norm(v3.cross(o.e1, o.e2)); }
        else { const E = bodyState('earth', t); r = v3.norm(v3.sub(s.p, E.p)); h = v3.norm(v3.cross(r, v3.sub(s.v, E.v))); }
        const x = toV(r).negate().normalize(), y = toV(h), z = new THREE.Vector3().crossVectors(x, y).normalize(); y.crossVectors(z, x);
        b.spin.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
      } else {
        const pole = toV(b.pole), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), pole);
        b.spin.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (t / 3600) / b.rot * 2 * Math.PI));
      }
      if (b.emissive) {
        const Dr2 = 5e3 * (1 + Math.log(D / 5e3)); b.group.position.set(u[0] * Dr2, u[1] * Dr2, u[2] * Dr2); b.group.scale.setScalar(R * Dr2 / D);
        b.glow.scale.setScalar(Math.max(6, (14 + 10 * Math.min(1, E)) * renderer.getPixelRatio() / Math.max(px, 1e-4)));
      }
    } else b.group.visible = false;
    // unresolved bodies: point brightness from albedo x cross-section x phase law / distances^2
    if (px <= 1.6 && !b.emissive) {
      const sb = v3.sub(sun.p, s.p), dsb = v3.len(sb) / AU;
      const cosA = v3.dot(v3.norm(sb), v3.scale(u, -1)), a = Math.acos(Math.max(-1, Math.min(1, cosA)));
      const phase = (Math.sin(a) + (Math.PI - a) * Math.cos(a)) / Math.PI;
      const lum = b.alb * (b.R / Dkm) ** 2 * phase / (dsb * dsb) * st.exposure / 2.6e-10;
      if (lum > 2e-4) {
        const pos = Math.min(Dr, 2.5e5) / Dr;
        pp.set([u[0] * Dr * pos, u[1] * Dr * pos, u[2] * Dr * pos], i * 3);
        ps[i] = Math.max(1.4, Math.min(9, 2.6 + 1.2 * Math.log10(lum))) * renderer.getPixelRatio();
        const k = Math.min(1.2, 0.3 + 0.3 * Math.log10(lum + 1) + Math.min(1, lum) * 0.5);
        pc.set([b.pcol.r * k, b.pcol.g * k, b.pcol.b * k], i * 3);
      }
    }
    b._u = u; b._Dr = Dr;
  });
  ptGeo.attributes.position.needsUpdate = ptGeo.attributes.color.needsUpdate = ptGeo.attributes.size.needsUpdate = true;

  // pad (rotates with the Earth)
  padGroup.visible = alt < 150;
  if (padGroup.visible && !terrain) buildTerrain();
  if (padGroup.visible) {
    pad.visible = alt < 40;
    const M = ecefToWorld(t), padW = v3.add(earth.p, mv(M, PAD)), rel = v3.scale(v3.sub(padW, X.p), 1000);
    const [la, lo] = PADLL;
    const up = toV(mv(M, [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)]));
    const east = toV(mv(M, [-Math.sin(lo), Math.cos(lo), 0])), south = new THREE.Vector3().crossVectors(east, up);
    padGroup.position.set(rel[0], rel[1], rel[2]);
    padGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, up, south));
  }

  // vehicle: launch stack or free-flying Voyager
  const inStack = tl < stack.detach.pm.t;
  let qv;
  const relSince = (td, dt, dvStack, q, ry) => {
    const Xd = vehicle(TL + td), qd = qAt(TL + td), dv = new THREE.Vector3(...dvStack).applyQuaternion(qd);
    const Ed = bodyState('earth', TL + td), r = v3.sub(Xd.p, Ed.p), rr = v3.len(r), g = v3.scale(r, -398600.4418 / (rr * rr * rr));
    const p = [0, 1, 2].map(k => Xd.p[k] + (Xd.v[k] + dv.getComponent(k) / 1000) * dt + 0.5 * g[k] * dt * dt);
    const rel = v3.scale(v3.sub(p, X.p), 1000); return toV(rel);
  };
  // near the ground the trajectory point is the pad; raise the stack so its base sits on the launch platform
  stack.lift = (stack.refY(tl) + 4) * Math.max(0, Math.min(1, 1 - (alt - 0.5) / 4));
  if (tl > -3600 && inStack) {
    const q = qAt(t);
    stack.update(tl, q, pressure, simDt, dtr, vacuum, { relSince, qAt: (td) => qAt(TL + td) });
    // stowed Voyager sits on top of the propulsion module, antenna up the thrust axis
    qv = q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
    voy.quaternion.copy(qv);
    voy.position.set(0, 43.3 - stack.refY(tl) + stack.lift, 0).applyQuaternion(q);
    voy.visible = tl > 285 || true;
    vparts.whips.visible = false; magPivot.scale.set(1, 0.02, 1);
    // smoke: world-anchored puffs drifting with the rotating atmosphere
    const w = 7.2921159e-5;
    stack.drawSmoke((s) => {
      if (!s.w) {
        const nz = new THREE.Vector3(...s.nz).add(new THREE.Vector3(0, -stack.refY(s.born) - 4 + stack.lift, 0)).applyQuaternion(qAt(TL + s.born));
        const Xb = vehicle(TL + s.born), Eb = bodyState('earth', TL + s.born), M = ecefToWorld(TL + s.born), ax = mv(M, [0, 0, 1]);
        const rb = v3.sub(Xb.p, Eb.p), vrot = v3.scale(v3.cross(ax, rb), w);
        s.w = { p: v3.add(Xb.p, [nz.x / 1000, nz.y / 1000, nz.z / 1000]), v: v3.add(Eb.v, vrot), j: [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5] };
      }
      const age = tl - s.born; if (age < 0 || age > 240) return null;
      const p = v3.add(s.w.p, v3.scale(s.w.v, age)), rel = v3.scale(v3.sub(p, X.p), 1000);
      const spread = 4 + age * 1.6;
      return { x: rel[0] + s.w.j[0] * spread, y: rel[1] + s.w.j[1] * spread, z: rel[2] + s.w.j[2] * spread, size: 3 + age * 0.5, c: 0.75 + s.k * 0.2 };
    });
    thrusterPuff.visible = false;
  } else {
    stack.update(tl, qAt(t), 0, 0, dtr, 1, { relSince, qAt: (td) => qAt(TL + td) });
    if (!stack.active(tl)) stack.group.visible = false;
    // attitude acquisition after propulsion-module jettison: blend into Earth/Canopus pointing over 30 min
    const qE = voyagerQuat(t, X), since = tl - stack.detach.pm.t;
    const qs = qAt(Math.min(t, TL + stack.detach.pm.t)).clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
    qv = since < 1800 ? qs.slerp(qE, Math.max(0, since / 1800)) : qE;
    voy.quaternion.copy(qv); voy.position.set(0, 0, 0); voy.visible = true;
    // booms: magnetometer Astromast extends over ~1 h about a day after launch (guess); whips deploy with it
    const mt = (tl - 86400) / 3600; magPivot.scale.set(1, Math.max(0.02, Math.min(1, mt)), 1); vparts.whips.visible = mt > 1;
    const tc = inTCM(t); thrusterPuff.visible = !!tc; if (tc) thrusterPuff.material.opacity = 0.08 + 0.06 * Math.random();
    // scan platform: track the nearest body while the platform is in use (until 1998); frozen after the 1981 jam
    const jam = EVENTS.find(e => e.title.startsWith('Scan platform azimuth'))?.t, off98 = EVENTS.find(e => e.title.startsWith('Scan platform and UVS'))?.t;
    if (t < off98 && !(t > jam && t < jam + 3 * 86400)) {
      const target = toV(near._u).applyQuaternion(qv.clone().invert());
      scanPivot.quaternion.slerp(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), target.normalize()), Math.min(1, dtr * 2));
    }
  }

  // camera: third person, nearest body always in frame
  const nu = toV(near._u).negate();                 // from nearest body toward the craft
  if (!camU) camU = nu.clone();
  camU.lerp(nu, 1 - Math.exp(-dtr / 1.2)).normalize();
  const altTilt = near.name === 'earth' ? 22 + 63 * Math.exp(-Math.max(alt, 0) / 300) : 22;
  const lookW = near.name === 'earth' ? 0.5 * (1 - Math.exp(-Math.max(alt, 0) / 80)) : 0.5;
  let k = new THREE.Vector3().crossVectors(camU, NORTH); if (k.lengthSq() < 1e-6) k.set(1, 0, 0); k.normalize();
  let c = camU.clone().applyAxisAngle(k, altTilt * Math.PI / 180 + st.userPitch).applyAxisAngle(camU, st.userYaw).normalize();
  if (near.name === 'earth' && alt < 80) {
    // launch: look west from the ocean side (east-south-east), tower behind the vehicle as in the press photos
    const M = ecefToWorld(t), [la, lo] = PADLL;
    const east = toV(mv(M, [-Math.sin(lo), Math.cos(lo), 0])), north = toV(mv(M, [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)]));
    const hz = east.multiplyScalar(0.85).add(north.multiplyScalar(-0.35)).normalize().applyAxisAngle(camU, st.userYaw);
    const el = (90 - altTilt) * Math.PI / 180 + st.userPitch;
    const cl = camU.clone().multiplyScalar(Math.sin(el)).add(hz.multiplyScalar(Math.cos(el))).normalize();
    c = cl.lerp(c, Math.max(0, Math.min(1, (alt - 30) / 50))).normalize();
  }
  const dist = (inStack && tl > -3600 ? (tl < 3 ? 105 : tl < 122 ? 150 : tl < 478 ? 110 : tl < meta.launch.t_sep ? 60 : 30) : 26) * st.zoom;
  camera.position.copy(c).multiplyScalar(dist).add(camU.clone().multiplyScalar(inStack ? stack.lift : 0));
  const look = c.clone().negate().lerp(camU.clone().negate(), lookW).normalize();
  camera.up.copy(camU); if (Math.abs(look.dot(camU)) > 0.995) camera.up.copy(NORTH);
  camera.lookAt(camera.position.clone().add(look));

  // labels for planets and the nearest body
  const proj = new THREE.Vector3();
  for (const b of bodyList) {
    const show = b._u && (!b.isMoon || b.name === near.name || (b._d < 3e6 && (b.parent === near.name || b.parent === near.parent))) && b.name !== 'moon' || (b.name === 'moon' && b._s && b._d < 2e6);
    const el = label(b.name, b.name.charAt(0).toUpperCase() + b.name.slice(1));
    if (!show || !b._Dr) { el.style.display = 'none'; continue; }
    proj.set(b._u[0], b._u[1], b._u[2]).multiplyScalar(Math.min(b._Dr, 2e5)).project(camera);
    if (proj.z > 1 || Math.abs(proj.x) > 1.05 || Math.abs(proj.y) > 1.05) { el.style.display = 'none'; continue; }
    el.style.display = 'block'; el.style.transform = `translate(${(proj.x + 1) / 2 * innerWidth + 8}px, ${(1 - proj.y) / 2 * innerHeight - 8}px)`;
    el.classList.toggle('near', b.name === near.name);
  }

  // HUD
  const date = tdbToDate(JD0, t);
  $('date').textContent = date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const met = tl, sign = met < 0 ? 'T−' : 'T+', am = Math.abs(met);
  $('met').textContent = sign + (am < 86400 ? new Date(am * 1000).toISOString().slice(11, 19) : fmt(am / 86400, 1) + ' days');
  const dEarth = v3.len(rE);
  $('dsun').textContent = fmt(dSun, dSun < 10 ? 3 : 2) + ' AU';
  $('dearth').textContent = dEarth < 1e6 ? fmt(Math.max(alt, 0), 1) + ' km alt' : fmt(dEarth / AU, 2) + ' AU';
  $('lt').textContent = dEarth < 3e5 ? '—' : (dEarth / 299792.458 < 3600 ? fmt(dEarth / 299792.458 / 60, 1) + ' min' : fmt(dEarth / 299792.458 / 3600, 2) + ' h');
  const vh = v3.len(v3.sub(X.v, sun.v));
  $('vel').textContent = (dEarth < 1e6 ? fmt(v3.len(v3.sub(X.v, earth.v)), 2) + ' km/s (Earth)' : fmt(vh, 2) + ' km/s (Sun)');
  $('near').textContent = near.name.charAt(0).toUpperCase() + near.name.slice(1) + ' · ' + (near._d > 1e7 ? fmt(near._d / AU, 2) + ' AU' : fmt(near._d, 0) + ' km');
  const ev = EVENTS[Math.max(0, ni)];
  $('phase').innerHTML = ni >= 0 ? `${ev.title} <span class="tag ${ev.tag}">${ev.tag}</span>` : 'Countdown';
  $('scrub').value = Math.round(toU(t) * 1000);
  if (performance.now() - lastSave > 2000) { store.set('v2.t', t); store.set('v2.auto', st.auto); lastSave = performance.now(); }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
$('loading').remove();
requestAnimationFrame(frame);
