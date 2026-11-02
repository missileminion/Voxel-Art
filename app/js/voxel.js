// Voxel model builders. Every model is a list of voxels (x, y, z, color) turned into one InstancedMesh.
import * as THREE from './vendor/three.module.js';

const CUBE = new THREE.BoxGeometry(1, 1, 1);

export class VoxelSet {
  constructor(size) { this.s = size; this.pos = []; this.col = []; this.keys = new Set(); }
  add(x, y, z, color) {  // x,y,z in metres (snapped to the grid)
    const s = this.s, i = Math.round(x / s), j = Math.round(y / s), k = Math.round(z / s), key = i + ',' + j + ',' + k;
    if (this.keys.has(key)) return;
    this.keys.add(key); this.pos.push(i * s, j * s, k * s); this.col.push(color);
  }
  // solid primitives -------------------------------------------------------------------------
  box(x0, y0, z0, x1, y1, z1, color) {
    const s = this.s;
    for (let x = x0; x <= x1 + 1e-9; x += s) for (let y = y0; y <= y1 + 1e-9; y += s) for (let z = z0; z <= z1 + 1e-9; z += s)
      this.add(x, y, z, typeof color === 'function' ? color(x, y, z) : color);
  }
  // cylinder along +y (shell only), radius r, from y0 to y1
  cyl(cx, cz, r, y0, y1, color, solid = false) {
    const s = this.s;
    for (let y = y0; y <= y1 + 1e-9; y += s)
      for (let x = -r; x <= r; x += s) for (let z = -r; z <= r; z += s) {
        const d = Math.hypot(x, z);
        if (d <= r + s * 0.5 && (solid || d >= r - s * 0.9)) this.add(cx + x, y, cz + z, typeof color === 'function' ? color(cx + x, y, cz + z) : color);
      }
  }
  // cone/ogive along +y: radius goes r0 -> r1
  cone(cx, cz, r0, r1, y0, y1, color, shape = 1) {
    const s = this.s;
    for (let y = y0; y <= y1 + 1e-9; y += s) {
      const f = (y - y0) / Math.max(y1 - y0, 1e-9), r = r0 + (r1 - r0) * Math.pow(f, shape);
      for (let x = -r0 - s; x <= r0 + s; x += s) for (let z = -r0 - s; z <= r0 + s; z += s) {
        const d = Math.hypot(x, z);
        if (d <= r + s * 0.5 && d >= r - s * 1.2) this.add(cx + x, y, cz + z, typeof color === 'function' ? color(cx + x, y, cz + z) : color);
      }
    }
  }
  mesh(material) {
    const n = this.col.length;
    const m = new THREE.InstancedMesh(CUBE, material, n);
    const mat = new THREE.Matrix4(), c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      mat.makeScale(this.s, this.s, this.s).setPosition(this.pos[3 * i], this.pos[3 * i + 1], this.pos[3 * i + 2]);
      m.setMatrixAt(i, mat); m.setColorAt(i, c.set(this.col[i]));
    }
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.frustumCulled = false;
    return m;
  }
}

// ---- noise -------------------------------------------------------------------------------------
function hash(x, y, z) { let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  let r = 0;
  for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) for (let dz = 0; dz < 2; dz++)
    r += hash(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  return r;
}
export function fbm(x, y, z, oct = 4) { let a = 0.5, f = 1, s = 0; for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f); f *= 2.03; a *= 0.5; } return s; }

const mix = (a, b, t) => { const ca = new THREE.Color(a), cb = new THREE.Color(b); return ca.lerp(cb, Math.min(1, Math.max(0, t))).getHex(); };

// ---- planet surface colour functions (stylised; lat/lon in radians, n = unit normal in body frame, +y = north pole)
export const SURFACES = {
  sun: () => 0xfff1c0,
  mercury: (lat, lon, n) => mix(0x8c8580, 0x5d5853, fbm(n[0] * 4, n[1] * 4, n[2] * 4)),
  venus: (lat, lon, n) => mix(0xe9d7a6, 0xc9aa72, fbm(n[0] * 2 + 7, n[1] * 6, n[2] * 2) * 0.9),
  earth: (lat, lon, n) => {
    const cloud = fbm(n[0] * 5 + 11, n[1] * 5, n[2] * 5 + 3);
    if (Math.abs(lat) > 1.22) return 0xf2f6fa;
    if (cloud > 0.66) return 0xf4f6f8;
    const land = fbm(n[0] * 2.2, n[1] * 2.2, n[2] * 2.2, 5);
    if (land > 0.53) return mix(0x4f7a3a, 0xa08a5a, (land - 0.53) * 5 + (Math.abs(lat) < 0.45 ? 0.4 : 0));
    return mix(0x0e3a7a, 0x1b5aa6, land * 1.5);
  },
  moon: (lat, lon, n) => mix(0xb4b0aa, 0x6d6a66, fbm(n[0] * 3, n[1] * 3, n[2] * 3) > 0.55 ? 0.9 : 0.15),
  mars: (lat, lon, n) => Math.abs(lat) > 1.3 ? 0xf0ece6 : mix(0xc1693c, 0x7a3b22, fbm(n[0] * 3, n[1] * 3, n[2] * 3)),
  jupiter: (lat, lon, n) => {
    const grs = Math.hypot((lat + 0.39) / 0.07, ((lon + Math.PI * 2) % (Math.PI * 2) - 1.0) / 0.16);
    if (grs < 1) return mix(0xc0583a, 0xd88a5a, grs * grs);
    const t = lat + 0.04 * Math.sin(lon * 3 + lat * 20) + 0.03 * (fbm(n[0] * 6, n[1] * 20, n[2] * 6) - 0.5);
    const b = Math.sin(t * 13.0);
    return b > 0.25 ? mix(0xf1e6cf, 0xe6d3ad, b) : mix(0xa9714a, 0xc99a6c, b + 0.6);
  },
  saturn: (lat, lon, n) => {
    const b = Math.sin(lat * 16 + 0.6 * Math.sin(lat * 5));
    return Math.abs(lat) > 1.25 ? 0x9fae9a : mix(0xe8d6a0, 0xc8ad74, 0.5 + 0.5 * b + 0.1 * fbm(n[0] * 4, n[1] * 14, n[2] * 4));
  },
  uranus: (lat, lon, n) => mix(0x9fd8de, 0xc4ecef, Math.max(0, -Math.sin(lat)) * 0.7 + 0.05 * Math.sin(lat * 12)),
  neptune: (lat, lon, n) => {
    const gds = Math.hypot((lat + 0.36) / 0.09, (((lon + 6.283) % 6.283) - 2.2) / 0.2);
    if (gds < 1) return 0x1d2f8a;
    if (Math.abs(lat + 0.12) < 0.03 && fbm(n[0] * 8, n[1] * 8, n[2] * 8) > 0.55) return 0xeef4ff;
    return mix(0x2f56c9, 0x4a74e0, 0.5 + 0.4 * Math.sin(lat * 9) + 0.2 * (fbm(n[0] * 4, n[1] * 9, n[2] * 4) - 0.5));
  },
  // moons
  Io: (lat, lon, n) => { const f = fbm(n[0] * 5, n[1] * 5, n[2] * 5); return f > 0.68 ? 0x2a1d10 : mix(0xe6d25a, 0xd2803a, f * 1.4); },
  Europa: (lat, lon, n) => (Math.abs(Math.sin(n[0] * 9 + n[1] * 7) * Math.cos(n[2] * 8)) < 0.06 ? 0x8a5a3a : mix(0xeae2d4, 0xc9b9a0, fbm(n[0] * 3, n[1] * 3, n[2] * 3))),
  Ganymede: (lat, lon, n) => mix(0x8a7b6a, 0xbdb2a6, fbm(n[0] * 3, n[1] * 3, n[2] * 3) > 0.5 ? 1 : 0.1),
  Callisto: (lat, lon, n) => hash(Math.round(n[0] * 20), Math.round(n[1] * 20), Math.round(n[2] * 20)) > 0.93 ? 0xe0ddd8 : 0x4e463c,
  Amalthea: () => 0x8b4b32,
  Titan: (lat, lon, n) => mix(0xd99a3c, 0xc07a28, 0.5 + 0.5 * Math.sin(lat * 4)),
  Iapetus: (lat, lon, n) => (n[0] > 0.1 ? 0x2b231b : 0xe8e4dc),
  Triton: (lat, lon, n) => lat < -0.3 ? mix(0xf1d8cf, 0xe8bfb2, fbm(n[0] * 4, n[1] * 4, n[2] * 4)) : mix(0xc9c0b4, 0x9d978e, fbm(n[0] * 5, n[1] * 5, n[2] * 5)),
  Miranda: (lat, lon, n) => (Math.abs(Math.sin(n[0] * 12)) < 0.15 ? 0x6e6a66 : 0xa8a49e),
  default: (lat, lon, n) => mix(0xbab4ac, 0x8a847c, fbm(n[0] * 4, n[1] * 4, n[2] * 4)),
};

// voxel sphere shell, N voxels across, unit radius (scale later). +y = pole
export function voxelSphere(N, colorFn, material, oblate = 1) {
  const r = N / 2, vs = new VoxelSet(1 / r);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
    const d = Math.hypot(i, j, k);
    if (d > r + 0.5 || d < r - 0.9) continue;
    const n = [i / d, j / d, k / d], lat = Math.asin(n[1]), lon = Math.atan2(n[2], n[0]);
    vs.add(i / r, (j / r) * oblate, k / r, colorFn(lat, lon, n));
  }
  return vs.mesh(material);
}

// ring: flat voxel annulus in the xz plane, radii in planet radii
export function voxelRing(bands, R, cell, material) {
  const vs = new VoxelSet(cell);
  const rmax = Math.max(...bands.map(b => b[1])) / R;
  for (let x = -rmax; x <= rmax; x += cell) for (let z = -rmax; z <= rmax; z += cell) {
    const d = Math.hypot(x, z) * R;
    for (const [r0, r1, op] of bands) if (d >= r0 && d <= r1) {
      const tone = 0.75 + 0.25 * Math.sin(d / 900) * Math.sin(d / 310);
      if (hash(Math.round(x / cell), 0, Math.round(z / cell)) < op + 0.15) vs.add(x, 0, z, new THREE.Color(0xd8c9a3).multiplyScalar(tone * (0.6 + op * 0.5)).getHex());
    }
  }
  const m = vs.mesh(material);
  // flatten voxels
  const mat = new THREE.Matrix4();
  for (let i = 0; i < m.count; i++) {
    m.getMatrixAt(i, mat); const p = new THREE.Vector3().setFromMatrixPosition(mat);
    mat.makeScale(cell, cell * 0.08, cell).setPosition(p); m.setMatrixAt(i, mat);
  }
  m.instanceMatrix.needsUpdate = true;
  return m;
}

// ---- Voyager (metres). Body frame: +z = high-gain antenna boresight (toward Earth), +x = science boom side.
export function buildVoyager(mat) {
  const parts = {};
  const v = new VoxelSet(0.07);
  const DISH = 0xf2f0ea, FEED = 0xcfcfcf, BUS = 0x2a2a2e, GOLD = 0xc9a23a, MLI = 0x1b1b1f, BOOM = 0x9a9a9a;
  // decagonal bus ~1.78 m across, 0.47 m tall, sitting below the dish
  for (let z = -0.9; z <= -0.43; z += 0.07)
    for (let x = -0.9; x <= 0.9; x += 0.07) for (let y = -0.9; y <= 0.9; y += 0.07) {
      const a = Math.atan2(y, x), seg = Math.PI / 5, rr = 0.89 * Math.cos(Math.PI / 10) / Math.cos(((a % seg) + seg) % seg - seg / 2);
      if (Math.hypot(x, y) <= rr) v.add(x, y, z, (Math.abs(Math.hypot(x, y) - rr) < 0.08) ? (z > -0.6 && Math.abs(a - 0.3) < 0.15 ? GOLD : BUS) : MLI);
    }
  // golden record on the outside of one bay
  v.box(0.86, -0.18, -0.82, 0.93, 0.18, -0.5, GOLD);
  // high-gain dish: paraboloid, diameter 3.66 m, focal ~1.4 m
  for (let x = -1.83; x <= 1.83; x += 0.07) for (let y = -1.83; y <= 1.83; y += 0.07) {
    const r = Math.hypot(x, y); if (r > 1.83) continue;
    v.add(x, y, -0.36 + r * r / (4 * 1.4), DISH);
  }
  // sub-reflector + struts
  v.box(-0.2, -0.2, 1.1, 0.2, 0.2, 1.16, FEED);
  for (const a of [0, 2.1, 4.2]) for (let t = 0; t <= 1; t += 0.04) v.add(Math.cos(a) * 1.1 * (1 - t) + 0, Math.sin(a) * 1.1 * (1 - t), 0.1 + t * 1.0, FEED);
  // RTG boom (-x): three RTGs in a row
  for (let x = -0.9; x >= -3.1; x -= 0.07) v.add(x, 0, -0.7, BOOM);
  for (const xc of [-1.6, -2.15, -2.7]) {
    for (let x = xc - 0.21; x <= xc + 0.21; x += 0.07) for (let y = -0.2; y <= 0.2; y += 0.07) for (let z = -0.9; z <= -0.5; z += 0.07)
      if (Math.hypot(y, z + 0.7) < 0.2) v.add(x, y, z, 0x3a3a3a);
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; for (let r = 0.2; r < 0.36; r += 0.07) v.add(xc, Math.cos(a) * r, -0.7 + Math.sin(a) * r, 0x555555); }
  }
  // science boom (+x) to scan platform
  for (let x = 0.9; x <= 3.2; x += 0.07) v.add(x, 0, -0.75, BOOM);
  parts.body = v.mesh(mat);
  // scan platform as separate part so it can slew (pivot at boom tip)
  const sp = new VoxelSet(0.06);
  sp.box(-0.25, -0.25, -0.2, 0.25, 0.25, 0.2, 0x3a3326);
  sp.box(0.05, 0.0, 0.2, 0.2, 0.15, 0.95, 0x1d1d1d);   // narrow-angle camera
  sp.box(-0.2, 0.0, 0.2, -0.08, 0.12, 0.6, 0x1d1d1d);   // wide-angle camera
  sp.box(-0.2, -0.25, 0.2, 0.15, -0.08, 0.45, 0x6b5a2e); // IRIS
  sp.box(0.1, -0.24, 0.2, 0.22, -0.12, 0.7, 0x2c2c2c);  // UVS
  parts.scan = sp.mesh(mat); parts.scanPivot = new THREE.Vector3(3.25, 0, -0.75);
  // magnetometer boom (13 m) along -y, deployable
  const mg = new VoxelSet(0.05);
  for (let y = 0; y <= 13; y += 0.05) mg.add(0, -y, 0, y % 1.0 < 0.1 ? 0xbbbbbb : 0x7f7f7f);
  mg.box(-0.08, -13.1, -0.08, 0.08, -12.9, 0.08, 0xdddddd);
  parts.mag = mg.mesh(mat); parts.magPivot = new THREE.Vector3(0.3, -0.9, -0.6);
  // plasma-wave / radio-astronomy whip antennas (10 m) -- a V pair
  const wa = new VoxelSet(0.04);
  for (let t = 0; t <= 10; t += 0.04) { wa.add(-t * 0.5, -0.4 - t * 0.85, -0.9, 0x777777); wa.add(t * 0.5, -0.4 - t * 0.85, -0.9, 0x777777); }
  parts.whips = wa.mesh(mat);
  return parts;
}

// ---- Titan IIIE / Centaur (metres; +y up, base of core at y = 0) ------------------------------
export function buildTitan(mat) {
  const P = {};
  const R = 1.52, s = 0.2;
  const WHITE = 0xeeeeea, BLACK = 0x1c1c1c, CORE = 0xb8b2a4, CSS = 0xf4f4f4, SILVER = 0xb9bec4, NOZ = 0x2a2a2a;
  // stage 1 (LR87 twin)
  let v = new VoxelSet(s);
  v.cyl(0, 0, R, 0.0, 22.2, (x, y) => (y > 21.6 ? 0x8c8778 : CORE));
  for (const dx of [-0.65, 0.65]) v.cone(dx, 0, 0.35, 0.55, -2.4, -0.2, NOZ, 1);
  P.stage1 = v.mesh(mat); P.stage1.userData.nozzles = [[-0.65, -2.4, 0], [0.65, -2.4, 0]];
  // stage 2 (LR91)
  v = new VoxelSet(s);
  v.cyl(0, 0, R, 22.4, 29.4, (x, y) => (y < 23.0 ? 0x8c8778 : CORE));
  v.cone(0, 0, 0.45, 0.75, 21.0, 22.4, NOZ, 1);
  P.stage2 = v.mesh(mat); P.stage2.userData.nozzles = [[0, 21.0, 0]];
  // SRMs (UA1205, 5 segments) -- white with black bands
  for (const side of [-1, 1]) {
    v = new VoxelSet(s);
    const cx = side * (R + 1.55);
    v.cyl(cx, 0, R, 1.2, 26.0, (x, y) => ((y > 22 && y < 23.6) || (y > 3 && y < 4) ? BLACK : WHITE));
    v.cone(cx, 0, R, 0.15, 26.0, 29.6, WHITE, 0.6);
    v.cone(cx, 0, 0.75, 1.15, -1.4, 1.2, NOZ, 1);
    for (let y = 4; y < 24; y += 6) v.box(side > 0 ? R : R + 0.0, y, -0.3, side > 0 ? cx - R : -R, y + 0.4, 0.3, 0x777777);
    P['srm' + (side < 0 ? 'L' : 'R')] = v.mesh(mat);
    P['srm' + (side < 0 ? 'L' : 'R')].userData.nozzles = [[cx, -1.4, 0]];
  }
  // Centaur D-1T (silver balloon tank) inside the shroud, plus the propulsion module + Voyager on top
  v = new VoxelSet(s);
  v.cyl(0, 0, R, 30.6, 39.6, SILVER);
  v.cone(0, 0, R, 0.6, 39.6, 40.6, SILVER, 2);
  for (const dx of [-0.5, 0.5]) v.cone(dx, 0, 0.25, 0.42, 29.2, 30.6, NOZ, 1);
  P.centaur = v.mesh(mat); P.centaur.userData.nozzles = [[-0.5, 29.2, 0], [0.5, 29.2, 0]];
  v = new VoxelSet(0.1);
  v.cyl(0, 0, 0.47, 40.8, 41.9, 0x3d3d3d, true);           // TE-M-364-4 (Star 37E)
  v.cone(0, 0, 0.18, 0.38, 40.2, 40.8, NOZ, 1);
  v.cyl(0, 0, 0.95, 41.9, 42.4, 0x6c6c6c);                // PM structure / thrusters ring
  P.pm = v.mesh(mat); P.pm.userData.nozzles = [[0, 40.2, 0]];
  // Centaur Standard Shroud: two halves, 4.27 m diameter, ogive nose
  for (const half of [-1, 1]) {
    v = new VoxelSet(s);
    const RS = 2.13, keep = (x) => (half < 0 ? x <= 0.05 : x >= -0.05);
    const col = (x, y) => (keep(x) ? CSS : null);
    for (let y = 29.4; y <= 49.4; y += s) {
      const f = y < 43.5 ? 1 : Math.pow(Math.cos(((y - 43.5) / 5.9) * Math.PI / 2), 0.7);
      const r = Math.max(0.1, RS * f);
      for (let x = -RS; x <= RS; x += s) for (let z = -RS; z <= RS; z += s) {
        const d = Math.hypot(x, z);
        if (d <= r + s * 0.5 && d >= r - s * 1.1 && keep(x)) v.add(x, y, z, (y > 31 && y < 31.4) ? 0x999999 : CSS);
      }
    }
    P['css' + (half < 0 ? 'A' : 'B')] = v.mesh(mat);
  }
  return P;
}

// ---- launch complex (local ENU frame: +y up, +x east, +z south) --------------------------------
export function buildPad(mat) {
  const v = new VoxelSet(2.0);
  for (let x = -300; x <= 300; x += 2) for (let z = -300; z <= 300; z += 2) {
    const d = Math.hypot(x, z);
    let c = x > 180 ? 0x1f4f7a : (d < 40 ? 0xb9b4a8 : (hash(x, 3, z) > 0.5 ? 0x5f7e45 : 0x6b8a4f));
    if (Math.abs(z) < 4 && x < 0 && x > -280) c = 0x9a958a;              // rail line toward the integrate building
    v.add(x, -1, z, c);
  }
  v.box(-8, 0, -8, 8, 4, 8, 0x8d8a82);                                     // launch platform
  v.box(-14, 0, 10, -6, 62, 18, (x, y) => ((Math.floor(y / 6) % 2) ? 0xa63a2a : 0x8a8a8a)); // umbilical tower
  for (let y = 14; y < 56; y += 10) v.box(-6, y, 12, -2, y + 1.5, 14, 0x777777); // swing arms
  return v.mesh(mat);
}
