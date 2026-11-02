// Voyager 2 voxel mission viewer.
import * as THREE from './vendor/three.module.js';
import { loadMission, tdbToDate, v3 } from './data.js';
import { voxelSphere, voxelRing, SURFACES, buildVoyager, buildPad } from './voxel.js';
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

// ---------------------------------------------------------------- stars
{
  const n = 5000, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z), R = 3e5;
    pos.set([Math.cos(a) * r * R, Math.sin(a) * r * R, z * R], i * 3);
    const m = Math.pow(rnd(), 3), t = rnd();
    col.set([0.75 + 0.25 * t, 0.8 + 0.1 * t, 1.0 - 0.25 * t].map(c => c * (0.35 + m)), i * 3);
    size[i] = 1 + m * 2.5;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, vertexColors: true,
    vertexShader: 'attribute float size; varying vec3 vC; void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size; gl_Position=projectionMatrix*mv; }',
    fragmentShader: 'varying vec3 vC; void main(){ vec2 d=gl_PointCoord-0.5; if(dot(d,d)>0.25) discard; gl_FragColor=vec4(vC,1.0); }' });
  const stars = new THREE.Points(g, m); stars.frustumCulled = false; stars.renderOrder = -10; scene.add(stars);
  var starField = stars;
}

// ---------------------------------------------------------------- bodies
const planets = meta.planets;
const VOX_N = { sun: 40, mercury: 28, venus: 40, earth: 88, moon: 36, mars: 40, jupiter: 80, saturn: 72, uranus: 56, neptune: 56 };
const bodyList = [];
function makeBody(name, R, Rp, colorKey, opts = {}) {
  const b = { name, R, Rp: Rp || R, colorKey, mesh: null, group: new THREE.Group(), N: opts.N || 24, pole: opts.pole, rot: opts.rot,
              alb: opts.alb ?? 0.3, isMoon: !!opts.moon, parent: opts.parent, orbit: opts.orbit, label: null, emissive: name === 'sun' };
  scene.add(b.group);
  bodyList.push(b);
  return b;
}
for (const n of ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'])
  makeBody(n, planets[n].r, planets[n].rp, n, { N: VOX_N[n], pole: planets[n].pole, rot: planets[n].rot, alb: planets[n].alb });
for (const m of meta.moons)
  makeBody(m.name, m.r, m.r, m.name, { N: m.r > 1000 ? 30 : m.r > 400 ? 22 : 14, moon: true, parent: m.planet, orbit: m, alb: m.alb,
    pole: planets[m.planet].pole, rot: 2 * Math.PI / m.n / 3600 });
const byName = Object.fromEntries(bodyList.map(b => [b.name, b]));

function buildHi(b) {
  const fn = SURFACES[b.colorKey] || SURFACES.default;
  b.meshHi = voxelSphere(Math.min(150, Math.round(b.N * 2.2)), fn, voxMat, b.Rp / b.R); b.spin.add(b.meshHi);
}
function buildMesh(b) {
  const fn = SURFACES[b.colorKey] || SURFACES.default;
  const mat = b.emissive ? new THREE.MeshBasicMaterial({ color: 0xfff4d6 }) : voxMat;
  b.mesh = voxelSphere(b.N, fn, mat, b.Rp / b.R);
  b.spin = new THREE.Group(); b.spin.add(b.mesh); b.group.add(b.spin);
  const ring = meta.rings[b.name];
  if (ring) {
    const cell = b.name === 'saturn' ? 0.028 : 0.02;
    const rm = voxelRing(ring, b.R, cell, new THREE.MeshLambertMaterial({ transparent: b.name !== 'saturn', opacity: 0.6 }));
    b.spin.add(rm); b.ring = rm;
  }
  if (b.name === 'sun') {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,250,235,1)'); gr.addColorStop(0.2, 'rgba(255,230,170,0.6)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    b.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    b.group.add(b.glow);
  }
}
// smooth Earth for low altitude (voxels would be ~140 km cubes at true scale)
const earthSmooth = (() => {
  const g = new THREE.SphereGeometry(1, 256, 128), p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const n = [p.getX(i), p.getY(i), p.getZ(i)], lat = Math.asin(n[1]), lon = Math.atan2(n[2], n[0]);
    c.set(SURFACES.earth(lat, lon, n)); col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  const atm = new THREE.Mesh(new THREE.SphereGeometry(1.012, 128, 64), new THREE.MeshBasicMaterial({ color: 0x5fa0ff, transparent: true, opacity: 0.18, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  const grp = new THREE.Group(); grp.add(m, atm); scene.add(grp); grp.visible = false; return grp;
})();
const pad = buildPad(voxMat); const padGroup = new THREE.Group(); padGroup.add(pad); scene.add(padGroup);

// point sprites for bodies too small to resolve
const PTS = bodyList.length;
const ptGeo = new THREE.BufferGeometry();
ptGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PTS * 3), 3));
ptGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PTS * 3), 3));
ptGeo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(PTS), 1));
const points = new THREE.Points(ptGeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, vertexColors: true, blending: THREE.AdditiveBlending,
  vertexShader: 'attribute float size; varying vec3 vC; void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size; gl_Position=projectionMatrix*mv; }',
  fragmentShader: 'varying vec3 vC; void main(){ vec2 d=gl_PointCoord-0.5; float r=dot(d,d); if(r>0.25) discard; gl_FragColor=vec4(vC*(1.0-r*3.0),1.0); }' }));
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
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
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
  starField.visible = sky < 0.3;
  skyFill.intensity = 1.6 * sky; skyFill.position.copy(toV(v3.norm(rE)));
  const pressure = Math.exp(-Math.max(alt, 0) / 7.2);
  const vacuum = Math.min(1, Math.max(0, (alt - 12) / 60)) ** 1.5;   // plume expansion with altitude

  // bodies
  const H = renderer.domElement.height, f = (H / 2) / Math.tan(camera.fov * Math.PI / 360);
  const pp = ptGeo.attributes.position.array, pc = ptGeo.attributes.color.array, ps = ptGeo.attributes.size.array;
  bodyList.forEach((b, i) => {
    const s = b._s || bodyState(b.name, t);
    ps[i] = 0;
    if (!s) { b.group.visible = false; if (labels[b.name]) labels[b.name].style.display = 'none'; return; }
    const rel = v3.sub(s.p, X.p), Dkm = v3.len(rel), D = Dkm * 1000, u = v3.scale(rel, 1 / Dkm);
    const R = b.R * 1000, surf = D - R;
    const Dr = (surf < 2e6 && D < 3e7) ? D : (D < 5e3 ? D : 5e3 * (1 + Math.log(D / 5e3)));
    const sc = Dr / D, px = (b.R / Dkm) * f;
    const isEarthLow = b.name === 'earth' && alt < 1500;
    earthSmooth.visible = earthSmooth.visible || false;
    if (px > 1.6 || isEarthLow) {
      if (!b.mesh && !isEarthLow) buildMesh(b);
      if (b.mesh && !b.emissive && !b.isMoon) { const hi = px > 700; if (hi && !b.meshHi) buildHi(b); b.mesh.visible = !hi; if (b.meshHi) b.meshHi.visible = hi; }
      b.group.visible = !isEarthLow; b.group.position.set(u[0] * Dr, u[1] * Dr, u[2] * Dr); b.group.scale.setScalar(R * sc);
      // orientation: +y = pole; spin about it
      if (b.spin) {
        if (b.name === 'earth') {
          const M = ecefToWorld(t); const ex = toV(mv(M, [1, 0, 0])), ez = toV(mv(M, [0, 0, 1])), ey = toV(mv(M, [0, -1, 0]));
          b.spin.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ex, ez, ey.negate().negate()));
        } else {
          const pole = toV(b.pole), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), pole);
          const spin = (t / 3600) / b.rot * 2 * Math.PI;
          b.spin.quaternion.copy(q).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin));
        }
      }
      if (b.glow) { b.glow.scale.setScalar(6 + 2 * Math.min(4, E)); }
      if (isEarthLow) {
        earthSmooth.visible = true; earthSmooth.position.set(u[0] * D, u[1] * D, u[2] * D); earthSmooth.scale.setScalar(6371000);
        const M = ecefToWorld(t);
        earthSmooth.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(toV(mv(M, [1, 0, 0])), toV(mv(M, [0, 0, 1])), toV(mv(M, [0, 1, 0])).negate()));
      }
    } else b.group.visible = false;
    if (b.name === 'earth' && !isEarthLow) earthSmooth.visible = false;
    // brightness of unresolved bodies: albedo x cross-section x phase / distances^2
    if (px <= 1.6 && b.name !== 'sun') {
      const sb = v3.sub(sun.p, s.p), dsb = v3.len(sb) / AU;
      const cosA = v3.dot(v3.norm(sb), v3.scale(u, -1)), a = Math.acos(Math.max(-1, Math.min(1, cosA)));
      const phase = (Math.sin(a) + (Math.PI - a) * Math.cos(a)) / Math.PI;
      const F = b.alb * (b.R / Dkm) ** 2 * phase / (dsb * dsb);
      const lum = F * st.exposure / 2.6e-10;
      if (lum > 1e-4) {
        const pos = Math.min(Dr, 2.5e5) / Dr;
        pp.set([u[0] * Dr * pos, u[1] * Dr * pos, u[2] * Dr * pos], i * 3);
        ps[i] = Math.max(1.2, Math.min(8, 2.4 + 1.1 * Math.log10(lum)));
        const k = Math.min(1, 0.25 + 0.3 * Math.log10(lum + 1) + Math.min(1, lum) * 0.5);
        const c = new THREE.Color(SURFACES[b.colorKey] ? SURFACES[b.colorKey](0.2, 0.3, [0.5, 0.5, 0.5]) : 0xcccccc);
        pc.set([c.r * k + 0.15 * k, c.g * k + 0.15 * k, c.b * k + 0.15 * k], i * 3);
      }
    }
    if (b.name === 'sun') { b.group.visible = true; if (!b.mesh) buildMesh(b); const Dr2 = 5e3 * (1 + Math.log(D / 5e3)); b.group.position.set(u[0] * Dr2, u[1] * Dr2, u[2] * Dr2); b.group.scale.setScalar(R * Dr2 / D); if (b.glow) b.glow.scale.setScalar(Math.max(8, 40 * (1 / dSun))); }
    b._u = u; b._Dr = Dr;
  });
  ptGeo.attributes.position.needsUpdate = ptGeo.attributes.color.needsUpdate = ptGeo.attributes.size.needsUpdate = true;

  // pad (rotates with the Earth)
  padGroup.visible = alt < 150;
  if (padGroup.visible) {
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
  if (tl > -3600 && inStack) {
    const q = qAt(t);
    stack.update(tl, q, pressure, simDt, dtr, vacuum, { relSince, qAt: (td) => qAt(TL + td) });
    // stowed Voyager sits on top of the propulsion module, antenna up the thrust axis
    qv = q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
    voy.quaternion.copy(qv);
    voy.position.set(0, 43.3 - stack.refY(tl), 0).applyQuaternion(q);
    voy.visible = tl > 285 || true;
    vparts.whips.visible = false; magPivot.scale.set(1, 0.02, 1);
    // smoke: world-anchored puffs drifting with the rotating atmosphere
    const w = 7.2921159e-5;
    stack.drawSmoke((s) => {
      if (!s.w) {
        const nz = new THREE.Vector3(...s.nz).add(new THREE.Vector3(0, -stack.refY(s.born) - 4, 0)).applyQuaternion(qAt(TL + s.born));
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
  const altTilt = near.name === 'earth' ? 25 + 60 * Math.exp(-Math.max(alt, 0) / 300) : 28;
  const lookW = near.name === 'earth' ? 0.3 * (1 - Math.exp(-Math.max(alt, 0) / 80)) : 0.38;
  let k = new THREE.Vector3().crossVectors(camU, NORTH); if (k.lengthSq() < 1e-6) k.set(1, 0, 0); k.normalize();
  const c = camU.clone().applyAxisAngle(k, altTilt * Math.PI / 180 + st.userPitch).applyAxisAngle(camU, st.userYaw).normalize();
  const dist = (inStack && tl > -3600 ? (tl < 122 ? 150 : tl < 478 ? 110 : tl < meta.launch.t_sep ? 60 : 30) : 26) * st.zoom;
  camera.position.copy(c).multiplyScalar(dist);
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
