// Detailed procedural models of the Apollo 11 vehicles (metres).
// Saturn V stack: +y up, base of the S-IC at y = 0.  CSM: +y = CM apex direction (SPS thrust axis), origin at SM aft
// bulkhead.  LM: +y up, origin on the ground plane under the footpads (legs deployed).
// Paint schemes follow the AS-506 launch photographs; small markings are approximations.
import * as THREE from '../../app/js/vendor/three.module.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- canvas textures
function canvasTex(w, h, paint, { repeatX = 1, srgb = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); paint(g, w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping; t.repeat.x = repeatX; t.anisotropy = 8; return t;
}
function noiseNormal(size, strength, scale) {   // crinkled foil / panel bump as a normal map
  return canvasTex(size, size, (g, w, h) => {
    const img = g.createImageData(w, h), d = img.data;
    const hgt = new Float32Array(w * h);
    for (let k = 0; k < 6; k++) {
      const n = 4 + k * scale, amp = 1 / (k + 1);
      const ph = Array.from({ length: 8 }, () => Math.random() * TAU);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
        hgt[y * w + x] += amp * Math.sin((x / w) * n * TAU + ph[k % 8] + Math.sin((y / h) * n * 2.3 + ph[(k + 3) % 8]) * 2) * Math.cos((y / h) * n * TAU + ph[(k + 5) % 8]);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, dx = hgt[y * w + ((x + 1) % w)] - hgt[i], dy = hgt[((y + 1) % h) * w + x] - hgt[i];
      const nx = -dx * strength, ny = -dy * strength, nz = 1, l = Math.hypot(nx, ny, nz);
      d[i * 4] = (nx / l * 0.5 + 0.5) * 255; d[i * 4 + 1] = (ny / l * 0.5 + 0.5) * 255; d[i * 4 + 2] = (nz / l * 0.5 + 0.5) * 255; d[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}
function vtext(g, text, x, y, size, color = '#111') {      // vertical stacked letters
  g.fillStyle = color; g.font = `700 ${size}px Helvetica, Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'top';
  for (let i = 0; i < text.length; i++) g.fillText(text[i], x, y + i * size * 1.05);
}
function flag(g, x, y, w, h) {
  for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#f4f4f4' : '#b22234'; g.fillRect(x, y + i * h / 13, w, h / 13 + 0.5); }
  g.fillStyle = '#3c3b6e'; g.fillRect(x, y, w * 0.4, h * 7 / 13);
}

// ---------------------------------------------------------------- materials
const M = {};
export function materials() {
  if (M.white) return M;
  M.white = new THREE.MeshStandardMaterial({ color: 0xf2f2ef, roughness: 0.55, metalness: 0.0 });
  M.black = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.6 });
  M.alu = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.4, metalness: 0.45 });
  M.darkMetal = new THREE.MeshStandardMaterial({ color: 0x3b3d40, roughness: 0.45, metalness: 0.7 });
  M.nozzle = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide });
  M.f1nozzle = new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide });
  M.niobium = new THREE.MeshStandardMaterial({ color: 0x8e8a86, roughness: 0.4, metalness: 0.75, side: THREE.DoubleSide });
  M.mylar = new THREE.MeshStandardMaterial({ color: 0xe8eaee, roughness: 0.28, metalness: 0.55 });
  const foilN = noiseNormal(256, 2.2, 3);
  M.gold = new THREE.MeshStandardMaterial({ color: 0xd8a33c, roughness: 0.28, metalness: 1.0, normalMap: foilN, normalScale: new THREE.Vector2(0.9, 0.9) });
  M.amber = new THREE.MeshStandardMaterial({ color: 0xb87a26, roughness: 0.35, metalness: 0.9, normalMap: foilN });
  M.blackFoil = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.45, metalness: 0.5, normalMap: foilN, normalScale: new THREE.Vector2(0.5, 0.5) });
  M.lmGrey = new THREE.MeshStandardMaterial({ color: 0x8d8f91, roughness: 0.55, metalness: 0.35 });
  M.lmDark = new THREE.MeshStandardMaterial({ color: 0x2c2d30, roughness: 0.6, metalness: 0.3 });
  M.window = new THREE.MeshStandardMaterial({ color: 0x0b1018, roughness: 0.05, metalness: 0.9 });
  M.orange = new THREE.MeshStandardMaterial({ color: 0xc8502a, roughness: 0.5 });
  M.heatshield = new THREE.MeshStandardMaterial({ color: 0x6b5338, roughness: 0.85 });
  M.char = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.95 });
  M.chute = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.8, side: THREE.DoubleSide });
  M.chuteRed = new THREE.MeshStandardMaterial({ color: 0xd8442c, roughness: 0.8, side: THREE.DoubleSide });
  return M;
}

function cyl(r0, r1, y0, y1, mat, seg = 64, open = false) {
  const g = new THREE.CylinderGeometry(r1, r0, y1 - y0, seg, 1, open);
  const m = new THREE.Mesh(g, mat); m.position.y = (y0 + y1) / 2; return m;
}
function lathe(points, mat, seg = 64) {
  const m = new THREE.Mesh(new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg), mat); return m;
}
function shadowAll(o) { o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } }); return o; }

// ---------------------------------------------------------------- Saturn V
export function buildSaturnV() {
  const m = materials();
  const P = {};
  // S-IC: 42.1 m x 10.06 m.  Roll pattern on the lower tank and the forward skirt, UNITED STATES lettering, flag.
  const sicTex = canvasTex(2048, 2048, (g, w, h) => {
    g.fillStyle = '#f2f2ef'; g.fillRect(0, 0, w, h);
    const Y = (y) => h - (y / 42.1) * h;
    for (let q = 0; q < 8; q++) if (q % 2 === 0) { g.fillStyle = '#141414'; g.fillRect(q * w / 8, Y(10.5), w / 8, Y(3.0) - Y(10.5)); }   // lower roll pattern
    for (let q = 0; q < 8; q++) if (q % 2 === 1) { g.fillStyle = '#141414'; g.fillRect(q * w / 8, Y(42.1), w / 8, Y(39.0) - Y(42.1)); }   // forward skirt
    g.fillStyle = '#141414'; g.fillRect(0, Y(24.0), w, Y(21.8) - Y(24.0));                                                        // intertank band
    for (let x = 0; x < w; x += 6) { g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x, Y(24.0), 2, Y(21.8) - Y(24.0)); }      // corrugations
    vtext(g, 'UNITED', w * 0.125 + w / 16, Y(37.5), 58); vtext(g, 'STATES', w * 0.125 + w / 16, Y(30.0) + 10, 58);
    vtext(g, 'USA', w * 0.625 + w / 16, Y(20.0), 90);
    flag(g, w * 0.625 + w / 16 - 60, Y(37.5), 120, 80);
  });
  const sicMat = new THREE.MeshStandardMaterial({ map: sicTex, roughness: 0.55 });
  const sic = new THREE.Group();
  sic.add(cyl(5.03, 5.03, 0, 42.1, sicMat, 96));
  // engine fairings (4 conical shrouds) + fins
  for (let k = 0; k < 4; k++) {
    const a = TAU * k / 4 + Math.PI / 4;
    const f = cyl(1.9, 1.2, -1.2, 6.0, m.white, 32); f.position.set(Math.cos(a) * 4.2, f.position.y, Math.sin(a) * 4.2); sic.add(f);
    const fin = new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, -1.4), new THREE.Vector2(3.4, -1.4), new THREE.Vector2(1.2, 4.0), new THREE.Vector2(0, 5.5)]), { depth: 0.18, bevelEnabled: false }), m.white);
    fin.position.set(Math.cos(a) * 5.4, 0, Math.sin(a) * 5.4); fin.rotation.y = -a; fin.translateZ(-0.09); sic.add(fin);
  }
  // five F-1 engines (3.76 m exit, 5.8 m long bell)
  const f1 = [];
  for (const [x, z] of [[0, 0], [2.4, 2.4], [-2.4, 2.4], [2.4, -2.4], [-2.4, -2.4]]) {
    const e = new THREE.Group();
    e.add(lathe([[1.88, -5.8], [1.6, -4.2], [1.15, -2.4], [0.75, -1.0], [0.55, -0.2], [0.0, -0.2]], m.f1nozzle, 48));
    e.add(cyl(0.9, 0.9, -1.2, 0.2, m.darkMetal, 24));
    const band = cyl(1.75, 1.75, -4.6, -4.4, m.darkMetal, 48, true); e.add(band);
    e.position.set(x, 0, z); sic.add(e); f1.push(e);
  }
  sic.userData.nozzles = f1.map(e => [e.position.x, -5.8, e.position.z]);
  P.sic = shadowAll(sic);
  // S-II: 24.84 m; white, black forward-skirt band; interstage at the base
  const siiTex = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#f2f2ef'; g.fillRect(0, 0, w, h);
    const Y = (y) => h - (y / 24.84) * h;
    g.fillStyle = '#141414'; g.fillRect(0, Y(24.84), w, Y(23.2) - Y(24.84));
    for (let q = 0; q < 8; q++) if (q % 2) g.fillRect(q * w / 8, Y(5.6), w / 8, Y(3.6) - Y(5.6));
  });
  const sii = new THREE.Group(); sii.add(cyl(5.03, 5.03, 42.1, 66.94, new THREE.MeshStandardMaterial({ map: siiTex, roughness: 0.55 }), 96));
  const j2s = [];
  for (const [x, z] of [[0, 0], [1.8, 1.8], [-1.8, 1.8], [1.8, -1.8], [-1.8, -1.8]]) {
    const e = lathe([[1.0, -3.4], [0.8, -2.4], [0.5, -1.2], [0.0, -1.0]], m.nozzle, 36); e.position.set(x, 42.1 + 3.4, z); sii.add(e); j2s.push([x, 42.1, z]);
  }
  sii.userData.nozzles = j2s;
  P.sii = shadowAll(sii);
  // S-II/S-IVB interstage (truncated cone) belongs to the S-II after separation
  P.interstage = shadowAll(new THREE.Group().add(cyl(5.03, 3.3, 66.94, 70.2, m.white, 96)));   // group, so staging offsets don't move the cone itself
  // S-IVB: 17.85 m x 6.6 m with aft skirt roll pattern and APS modules
  const sivbTex = canvasTex(1024, 1024, (g, w, h) => {
    g.fillStyle = '#f2f2ef'; g.fillRect(0, 0, w, h);
    const Y = (y) => h - (y / 14.6) * h;
    g.fillStyle = '#141414';
    for (let q = 0; q < 8; q++) if (q % 2 === 0) g.fillRect(q * w / 8, Y(3.0), w / 8, Y(0) - Y(3.0));
    g.fillRect(0, Y(14.6), w, Y(14.0) - Y(14.6));
    vtext(g, 'USA', w * 0.3, Y(12.0), 70);
  });
  const sivb = new THREE.Group();
  sivb.add(cyl(3.3, 3.3, 70.2, 84.8, new THREE.MeshStandardMaterial({ map: sivbTex, roughness: 0.55 }), 80));
  for (const a of [0, Math.PI]) { const aps = new THREE.Mesh(new THREE.BoxGeometry(1.0, 2.2, 0.9), m.black); aps.position.set(Math.cos(a) * 3.5, 71.6, Math.sin(a) * 3.5); aps.rotation.y = -a; sivb.add(aps); }
  sivb.add(lathe([[1.0, -3.0], [0.8, -2.0], [0.5, -0.9], [0.0, -0.8]], m.nozzle, 40)); sivb.children.at(-1).position.y = 70.2 + 0.5;
  // instrument unit
  sivb.add(cyl(3.3, 3.3, 84.8, 85.7, new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.45, metalness: 0.2 }), 80));
  sivb.userData.nozzles = [[0, 70.2 - 2.5, 0]];
  P.sivb = shadowAll(sivb);
  // spacecraft-LM adapter: four panels that open like petals (cone 6.6 m -> 3.9 m, 8.5 m tall)
  P.sla = [];
  for (let k = 0; k < 4; k++) {
    const g = new THREE.CylinderGeometry(1.955, 3.3, 8.5, 24, 1, true, k * TAU / 4, TAU / 4);
    const panel = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xe9e9e4, roughness: 0.6, side: THREE.DoubleSide }));
    const pivot = new THREE.Group(); pivot.position.y = 85.7;
    const ang = k * TAU / 4 + TAU / 8;
    pivot.userData.hinge = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
    panel.position.y = 4.25; pivot.add(panel); P.sla.push(shadowAll(pivot));
  }
  // launch escape system: boost protective cover + tower + motor
  const les = new THREE.Group();
  les.add(lathe([[1.97, 0], [1.6, 0.9], [0.9, 2.3], [0.4, 3.2], [0.0, 3.3]], m.white, 64));
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xb8432a, roughness: 0.55, metalness: 0.2 });
  for (let k = 0; k < 4; k++) {
    const a = TAU * k / 4 + Math.PI / 4, b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.3, 8), towerMat);
    const p0 = new THREE.Vector3(Math.cos(a) * 1.15, 3.2, Math.sin(a) * 1.15), p1 = new THREE.Vector3(Math.cos(a) * 0.45, 6.4, Math.sin(a) * 0.45);
    b.position.copy(p0).add(p1).multiplyScalar(0.5); b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize()); les.add(b);
  }
  for (let y = 3.6; y < 6.4; y += 0.9) les.add(cyl(1.15 - (y - 3.2) * 0.22, 1.15 - (y - 3.2) * 0.22, y, y + 0.06, towerMat, 4, true));
  les.add(cyl(0.33, 0.33, 6.4, 10.4, m.white, 32));
  les.add(lathe([[0.33, 10.4], [0.25, 11.2], [0.12, 11.8], [0.0, 12.0]], m.white, 32));
  les.add(cyl(0.06, 0.06, 12.0, 12.4, m.darkMetal, 8));
  les.position.y = 98.9; P.les = shadowAll(les);
  // CSM + LM ride on top
  const csm = buildCSM(true); csm.position.y = 94.2; P.csm = csm;
  const lm = buildLM({ stowed: true }); lm.position.y = 86.0; P.lm = lm;
  return P;
}

// ---------------------------------------------------------------- CSM
export function buildCSM(underCover = false) {
  const m = materials();
  const g = new THREE.Group();
  // service module: 3.91 m diameter, aluminium with white radiator panels, UNITED STATES lettering
  const smTex = canvasTex(1024, 512, (c, w, h) => {
    c.fillStyle = '#c3c6ca'; c.fillRect(0, 0, w, h);
    for (let k = 0; k < 6; k++) { c.fillStyle = '#e9ebec'; c.fillRect(k * w / 6 + 8, h * 0.18, w / 6 * 0.42, h * 0.7); }
    for (let k = 0; k < 6; k++) { c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(k * w / 6, 0, 2, h); }
    vtext(c, 'UNITED', w * 0.83, h * 0.06, 30); vtext(c, 'STATES', w * 0.86, h * 0.06 + 6 * 31.5, 30);
  });
  const smMat = new THREE.MeshStandardMaterial({ map: smTex, roughness: 0.45, metalness: 0.3 });
  g.add(cyl(1.955, 1.955, 0, 4.0, smMat, 72));
  g.add(cyl(1.955, 1.955, 4.0, 4.25, m.alu, 72));
  // SPS engine: niobium/titanium bell, 2.5 m exit
  g.add(lathe([[1.25, -2.85], [1.05, -2.0], [0.75, -1.0], [0.45, -0.2], [0.35, 0.05], [0, 0.05]], m.niobium, 56));
  g.add(cyl(1.4, 1.95, -0.05, 0.02, m.darkMetal, 72));
  // RCS quads (4) with nozzles
  for (let k = 0; k < 4; k++) {
    const a = TAU * k / 4 + 7.25 * Math.PI / 180, q = new THREE.Group();   // quads sit 7.25 deg off the body axes
    q.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.24), m.alu));
    for (const [x, y, rz] of [[0, 0.62, 0], [0, -0.62, Math.PI], [0.36, 0, -Math.PI / 2], [-0.36, 0, Math.PI / 2]]) {
      const n = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.25, 12, 1, true), m.darkMetal); n.position.set(x, y, 0); n.rotation.z = rz; q.add(n);
    }
    q.position.set(Math.cos(a) * 2.05, 3.1, Math.sin(a) * 2.05); q.rotation.y = -a + Math.PI / 2; g.add(q);
  }
  // high-gain S-band antenna (four dishes) on its boom at the aft end
  const hga = new THREE.Group();
  for (const [x, y] of [[0.4, 0.4], [-0.4, 0.4], [0.4, -0.4], [-0.4, -0.4]]) {
    const d = lathe([[0.0, 0], [0.3, 0.06], [0.39, 0.12]], m.white, 24); d.rotation.x = Math.PI / 2; d.position.set(x, y, 0); hga.add(d);
  }
  const boom = cyl(0.04, 0.04, 0, 1.4, m.alu, 8); boom.rotation.z = Math.PI / 2; boom.position.set(-0.7, 0, 0); hga.add(boom);
  hga.position.set(2.7, -0.3, 0); g.add(hga); g.userData.hga = hga;
  // command module: 3.91 m base, 3.23 m tall, aluminised Mylar; windows; docking probe
  const cm = new THREE.Group();
  cm.add(lathe([[1.955, 0], [1.96, 0.05], [1.75, 0.6], [0.95, 2.35], [0.62, 2.95], [0.5, 3.2], [0, 3.23]], m.mylar, 96));
  cm.add(lathe([[0, -0.05], [1.2, -0.12], [1.85, -0.05], [1.955, 0.0]], m.heatshield, 96));        // aft heat shield
  for (const a of [-0.55, 0.55]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.33, 0.33), m.window);
    const r = 1.38, y = 1.38; w.position.set(Math.sin(a) * r, y, Math.cos(a) * r); w.lookAt(Math.sin(a) * 3, y + 1.1, Math.cos(a) * 3); cm.add(w);
  }
  const hatch = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.7), new THREE.MeshStandardMaterial({ color: 0xbfc2c6, roughness: 0.3, metalness: 0.8 }));
  hatch.position.set(0, 1.3, 1.43); hatch.lookAt(0, 2.4, 4); cm.add(hatch);
  cm.add(cyl(0.12, 0.05, 3.23, 3.9, m.darkMetal, 16));                   // docking probe
  cm.position.y = 4.25; g.add(cm); g.userData.cm = cm;
  if (underCover) g.userData.coverable = true;
  g.userData.nozzles = [[0, -2.85, 0]];
  return shadowAll(g);
}

// ---------------------------------------------------------------- LM
export function buildLM({ stowed = false } = {}) {
  const m = materials();
  const lm = new THREE.Group();
  const desc = new THREE.Group();
  // descent stage: octagonal box 4.22 m across, 1.65 m tall, wrapped in gold/amber Kapton and black foil
  const body = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 1.65, 8, 1), [m.gold, m.amber, m.amber]);
  body.rotation.y = Math.PI / 8; body.position.y = 2.2; desc.add(body);
  for (let k = 0; k < 4; k++) {   // black thermal panels on the quad faces
    const a = TAU * k / 4, p = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.2), m.blackFoil);
    p.position.set(Math.sin(a) * 2.04, 2.2, Math.cos(a) * 2.04); p.rotation.y = a; desc.add(p);
  }
  desc.add(lathe([[0.75, 1.0], [0.62, 1.15], [0.4, 1.38], [0.0, 1.4]], m.nozzle, 36));          // DPS bell (1.5 m exit)
  // ladder on the forward (+z) leg, porch
  const porch = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.7), m.amber); porch.position.set(0, 3.05, 2.35); desc.add(porch);
  // landing gear: four legs with primary struts, secondary struts, footpads and probes
  const legs = [];
  for (let k = 0; k < 4; k++) {
    const a = TAU * k / 4, leg = new THREE.Group(), dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    const top = dir.clone().multiplyScalar(2.1).setY(2.8), foot = dir.clone().multiplyScalar(4.4).setY(0.18);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, top.distanceTo(foot), 12), m.gold);
    strut.position.copy(top).add(foot).multiplyScalar(0.5); strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), foot.clone().sub(top).normalize()); leg.add(strut);
    for (const s of [-1, 1]) {
      const side = new THREE.Vector3(Math.cos(a) * s, 0, -Math.sin(a) * s), base = dir.clone().multiplyScalar(2.15).add(side.clone().multiplyScalar(1.1)).setY(1.6);
      const mid = top.clone().lerp(foot, 0.62), b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, base.distanceTo(mid), 8), m.alu);
      b.position.copy(base).add(mid).multiplyScalar(0.5); b.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), mid.clone().sub(base).normalize()); leg.add(b);
    }
    const pad = lathe([[0, 0.0], [0.47, 0.04], [0.47, 0.16], [0.3, 0.2], [0, 0.2]], m.gold, 28); pad.position.copy(foot).setY(0); leg.add(pad);
    if (k !== 0) {   // contact probes (1.7 m) on three legs, not the ladder leg
      const pr = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.7, 6), m.alu); pr.position.copy(foot).setY(-0.85); leg.add(pr);
    }
    if (k === 0) for (let y = 0.5; y < 2.6; y += 0.24) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.04), m.alu); r.position.copy(top.clone().lerp(foot, 1 - (y - 0.18) / 2.62)).add(new THREE.Vector3(0, 0, 0.12)); leg.add(r); }
    // re-pivot the leg on its upper hinge so it can fold: children relative to the hinge
    for (const c of leg.children) c.position.sub(top);
    leg.position.copy(top); leg.userData.axis = new THREE.Vector3(Math.cos(a), 0, -Math.sin(a));
    leg.userData.secondary = leg.children.filter(c => c.geometry && c.geometry.type === 'CylinderGeometry' && c.geometry.parameters.radiusTop === 0.035);
    legs.push(leg); desc.add(leg);
  }
  desc.userData.legs = legs; desc.userData.nozzles = [[0, 1.0, 0]];
  lm.add(desc);
  // ascent stage: crew cabin (front faceted), aft equipment bay, RCS quads, antennas, windows, docking tunnel
  const asc = new THREE.Group();
  const cabin = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.25, 1.9, 10, 1), m.lmGrey); cabin.position.set(0, 4.05, 0.2); asc.add(cabin);
  const front = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.6, 0.8), m.lmGrey); front.position.set(0, 3.95, 1.1); asc.add(front);
  const aft = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.5, 1.3), m.blackFoil); aft.position.set(0, 3.9, -1.3); asc.add(aft);
  const tank1 = new THREE.Mesh(new THREE.SphereGeometry(0.62, 24, 16), m.lmGrey); tank1.position.set(1.5, 3.9, -0.1); tank1.scale.set(0.9, 1, 1); asc.add(tank1);
  const tank2 = tank1.clone(); tank2.position.x = -1.5; asc.add(tank2);
  for (const s of [-1, 1]) {   // triangular forward windows
    const sh = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.5 * s, 0), new THREE.Vector2(0.12 * s, 0.55)]);
    const w = new THREE.Mesh(new THREE.ShapeGeometry(sh), m.window); w.position.set(0.12 * s, 4.25, 1.51); asc.add(w);
  }
  const hatchF = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), m.lmDark); hatchF.position.set(0, 3.55, 1.51); asc.add(hatchF);
  asc.add(Object.assign(cyl(0.42, 0.42, 4.95, 5.55, m.lmDark, 24), {}));                                      // docking tunnel
  const drogue = lathe([[0.42, 5.55], [0.3, 5.5], [0.05, 5.42]], m.alu, 24); asc.add(drogue);
  for (const [x, z] of [[1.35, 1.0], [-1.35, 1.0], [1.35, -1.6], [-1.35, -1.6]]) {     // RCS quads with plume deflectors
    const q = new THREE.Group(); q.add(new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), m.lmDark));
    for (const d of [[0, 1, 0], [0, -1, 0], [Math.sign(x), 0, 0], [0, 0, Math.sign(z)]]) {
      const n = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 10, 1, true), m.darkMetal);
      n.position.set(d[0] * 0.25, d[1] * 0.25, d[2] * 0.25); n.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(...d)); q.add(n);
    }
    q.position.set(x * 1.08, 4.6, z); asc.add(q);
  }
  const sband = new THREE.Group(); sband.add(lathe([[0, 0], [0.22, 0.05], [0.33, 0.12]], m.white, 20)); sband.position.set(-0.9, 5.25, -0.6); sband.rotation.x = -0.6; asc.add(sband);
  const rr = new THREE.Group(); rr.add(lathe([[0, 0], [0.4, 0.08], [0.5, 0.16]], m.white, 20)); rr.position.set(0.0, 4.95, 1.25); rr.rotation.x = 0.9; asc.add(rr);
  for (const s of [-1, 1]) { const v = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.8, 4), m.alu); v.position.set(1.0 * s, 5.2, -1.6); v.rotation.z = 0.5 * s; asc.add(v); }
  asc.add(lathe([[0.4, 3.0], [0.3, 2.85], [0, 2.82]], m.nozzle, 24));                                          // ascent engine (recessed)
  asc.userData.nozzles = [[0, 2.82, 0]];
  lm.add(asc);
  lm.userData.desc = desc; lm.userData.asc = asc;
  lm.userData.setGear = (f) => {   // f = 0 stowed (folded up against the descent stage, struts retracted), 1 deployed
    for (const leg of legs) {
      const fold = (1 - f) * -2.44, s = 0.45 + 0.55 * f;
      leg.quaternion.setFromAxisAngle(leg.userData.axis, fold); leg.scale.setScalar(s);
      for (const c of leg.userData.secondary) c.visible = f > 0.98;
    }
  };
  lm.userData.setGear(stowed ? 0 : 1);
  return shadowAll(lm);
}

// ---------------------------------------------------------------- surface items: flag, TV camera, EASEP, astronauts
export function buildSurfaceKit() {
  const m = materials(), g = new THREE.Group();
  const flagTex = canvasTex(256, 160, (c, w, h) => flag(c, 0, 0, w, h));
  const pole = cyl(0.015, 0.015, 0, 2.2, m.alu, 8);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.9, 12, 6), new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.8 }));
  const p = cloth.geometry.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, 0.04 * Math.sin(p.getX(i) * 5));   // the permanent crease
  cloth.position.set(0.75, 1.75, 0); const fl = new THREE.Group(); fl.add(pole, cloth); g.userData.flag = fl;
  const tv = new THREE.Group(); tv.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.15, 0.3), m.white)); tv.position.y = 1.1;
  for (let k = 0; k < 3; k++) { const l = cyl(0.01, 0.01, 0, 1.1, m.alu, 4); l.rotation.z = 0.25; l.rotation.y = k * TAU / 3; tv.add(l); l.position.y = -1.1; }
  g.userData.tv = tv;
  const psep = new THREE.Group(); psep.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.45, 0.6), m.gold));
  for (const s of [-1, 1]) { const panel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, 0.6), new THREE.MeshStandardMaterial({ color: 0x1a2440, roughness: 0.3, metalness: 0.6 })); panel.position.set(s * 0.75, 0.25, 0); psep.add(panel); }
  psep.position.y = 0.25; g.userData.psep = psep;
  const lrrr = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.05, 0.46), new THREE.MeshStandardMaterial({ color: 0x7c7f84, roughness: 0.2, metalness: 0.9 }));
  lrrr.position.y = 0.35; lrrr.rotation.x = -0.3; g.userData.lrrr = lrrr;
  const swc = new THREE.Group(); swc.add(cyl(0.015, 0.015, 0, 1.4, m.alu, 6)); const foil = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 1.2), m.mylar); foil.position.set(0.16, 0.85, 0); swc.add(foil);
  g.userData.swc = swc;
  return g;
}
export function buildAstronaut(name) {
  const m = materials(), g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.85 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.55, 6, 12), suit); body.position.y = 1.15; g.add(body);
  const plss = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.65, 0.25), suit); plss.position.set(0, 1.25, -0.27); g.add(plss);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), new THREE.MeshStandardMaterial({ color: 0xd8a33c, roughness: 0.08, metalness: 1 })); helmet.position.y = 1.72; g.add(helmet);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.55, 4, 8), suit); leg.position.set(0.12 * s, 0.4, 0); g.add(leg); g.userData['leg' + s] = leg;
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.45, 4, 8), suit); arm.position.set(0.33 * s, 1.15, 0.03); g.add(arm);
  }
  if (name === 'Armstrong') { const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.02, 6, 16), new THREE.MeshStandardMaterial({ color: 0xc81e1e })); stripe.rotation.x = Math.PI / 2; stripe.position.y = 1.55; g.add(stripe); }
  return shadowAll(g);
}

// ---------------------------------------------------------------- re-entry: CM with chutes
export function buildChutes() {
  const m = materials(), g = new THREE.Group(), mains = [];
  for (let k = 0; k < 3; k++) {
    const c = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(13, 32, 12, 0, TAU, 0, 1.2), k % 2 ? m.chuteRed : m.chute); canopy.position.y = 28; c.add(canopy);
    for (let i = 0; i < 12; i++) { const a = TAU * i / 12, line = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 28, 3), m.alu); line.position.set(Math.cos(a) * 5.5, 14.5, Math.sin(a) * 5.5); line.rotation.z = Math.cos(a) * 0.4; line.rotation.x = -Math.sin(a) * 0.4; c.add(line); }
    c.rotation.z = (k - 1) * 0.35; g.add(c); mains.push(c);
  }
  g.userData.mains = mains;
  const drogues = new THREE.Group();
  for (const s of [-1, 1]) { const d = new THREE.Mesh(new THREE.ConeGeometry(2.5, 3, 16, 1, true), m.chute); d.position.set(s * 2, 22, 0); d.rotation.x = Math.PI; drogues.add(d); }
  g.userData.drogues = drogues; g.add(drogues);
  return g;
}

// ---------------------------------------------------------------- NASA LM model (NASA 3D Resources, public domain)
// Loaded from apollo11/models/lm.glb (Draco-compressed glTF). Scaled to the real LM (7.04 m tall, 9.4 m across the
// footpads); +Z = front (hatch, porch, ladder), legs on the +-X / +-Z axes, origin on the ground under the footpads.
import { GLTFLoader } from '../../app/js/vendor/addons/GLTFLoader.js';
import { DRACOLoader } from '../../app/js/vendor/addons/DRACOLoader.js';
export async function loadNasaLM(url = 'apollo11/models/lm.glb') {
  const draco = new DRACOLoader(); draco.setDecoderPath('app/js/vendor/addons/draco/');
  const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
  let buf;
  try { const r = await fetch(url); if (!r.ok) throw 0; buf = await r.arrayBuffer(); if (new Uint32Array(buf, 0, 1)[0] !== 0x46546C67) throw 0; }
  catch { const r = await fetch(url.replace(/\.glb$/, '.b64.txt')); const b = atob((await r.text()).trim()); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); buf = u.buffer; }   // hosts that don't serve .glb
  const gltf = await loader.parseAsync(buf, '');
  const S = 1.38;                                   // model units -> metres
  const lm = new THREE.Group(), desc = new THREE.Group(), asc = new THREE.Group();
  lm.add(desc, asc);
  const meshes = []; gltf.scene.updateMatrixWorld(true); gltf.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
  const foil = materials().gold.normalMap;
  for (const m of meshes) {
    const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld); g.scale(S, S, S); g.computeBoundingBox();
    const bb = g.boundingBox, c = bb.getCenter(new THREE.Vector3()), r = Math.hypot(c.x, c.z), rmax = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z);
    const mat = m.material.clone();
    if (mat.color && mat.color.r > 0.6 && mat.color.g > 0.45 && mat.color.b < 0.35) { mat.normalMap = foil; mat.normalScale = new THREE.Vector2(0.8, 0.8); mat.metalness = 0.85; mat.roughness = 0.32; }   // gold Kapton foil
    const mesh = new THREE.Mesh(g, mat); mesh.castShadow = mesh.receiveShadow = true;
    const isAscent = c.y > 3.38 && rmax < 3.0;        // ascent stage sits above ~3.3 m
    (isAscent ? asc : desc).add(mesh);
    mesh.userData.gear = !isAscent && rmax > 2.5;      // landing gear meshes (all four legs share meshes)
  }
  // landing gear: fold each leg about its upper hinge (outrigger ~2.15 m out, 2.9 m up) by rotating its vertices
  const HINGE_R = 2.15, HINGE_Y = 2.9, FOLD = -1.95;
  for (const mesh of desc.children) {
    if (!mesh.userData.gear) continue;
    const p = mesh.geometry.attributes.position, deployed = Float32Array.from(p.array), folded = Float32Array.from(p.array);
    const v = new THREE.Vector3(), q = new THREE.Quaternion();
    for (let i = 0; i < p.count; i++) {
      v.fromArray(deployed, i * 3);
      const ax = Math.abs(v.x) > Math.abs(v.z) ? new THREE.Vector3(Math.sign(v.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(v.z));
      const out = v.dot(ax); if (out < HINGE_R - 0.4) continue;
      const tang = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), ax);
      const hinge = ax.clone().multiplyScalar(HINGE_R).setY(HINGE_Y);
      const w = Math.min(1, (out - (HINGE_R - 0.4)) / 0.4);           // soften the bend next to the body
      q.setFromAxisAngle(tang, FOLD * w);
      v.sub(hinge).applyQuaternion(q).add(hinge); v.toArray(folded, i * 3);
    }
    mesh.userData.deployed = deployed; mesh.userData.folded = folded;
  }
  lm.userData.setGear = (f) => {
    if (lm.userData._gear === f) return; lm.userData._gear = f;
    for (const mesh of desc.children) if (mesh.userData.gear) {
      const a = mesh.geometry.attributes.position.array, d = mesh.userData.deployed, fo = mesh.userData.folded;
      for (let i = 0; i < a.length; i++) a[i] = fo[i] + (d[i] - fo[i]) * f;
      mesh.geometry.attributes.position.needsUpdate = true; mesh.geometry.computeBoundingSphere();
    }
  };
  lm.userData.desc = desc; lm.userData.asc = asc;
  desc.userData.nozzles = [[0, 1.15, 0]]; asc.userData.nozzles = [[0, 3.25, 0]];
  lm.userData.tunnelTop = 6.4;                         // docking drogue height above the LM origin
  // RCS quads: four clusters on the ascent stage corners (45 deg azimuths), ~4.7 m up
  lm.userData.rcs = [0, 1, 2, 3].map(k => { const a = Math.PI / 4 + k * Math.PI / 2; return new THREE.Vector3(Math.sin(a) * 2.45, 4.75, Math.cos(a) * 2.45); });
  return lm;
}
