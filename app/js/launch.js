// Titan IIIE / Centaur stack: staging, detached-part ballistics and voxel exhaust plumes.
import * as THREE from './vendor/three.module.js';
import { buildTitan } from './voxel.js';

// Exhaust appearance per engine (educated guesses from propellant chemistry):
//  SRM  UA1205 (PBAN + aluminium): blinding white-yellow core, thick white alumina smoke at low altitude
//  LR87 / LR91 (Aerozine-50 / N2O4): translucent orange-peach flame with a pinkish fringe
//  RL10 (LH2 / LOX): nearly invisible; faint blue-violet glow, very wide in vacuum
//  Star 37E / TE-M-364-4 (aluminised solid): bright white-orange, wide vacuum plume
export const ENGINES = {
  srm:   { core: 0xfff6dc, mid: 0xffcf73, edge: 0xff8a3a, alpha: 0.95, len: 34, rad: 1.6, speed: 1.0, smoke: true },
  lr87:  { core: 0xffd2a0, mid: 0xff9a55, edge: 0xd2648c, alpha: 0.32, len: 16, rad: 0.7, speed: 1.0 },
  lr91:  { core: 0xffd2a0, mid: 0xff9a55, edge: 0xd2648c, alpha: 0.3, len: 14, rad: 0.8, speed: 1.0 },
  rl10:  { core: 0xc9d6ff, mid: 0x8d9cff, edge: 0x6a52ff, alpha: 0.05, len: 10, rad: 0.5, speed: 1.0 },
  star37:{ core: 0xfff3d6, mid: 0xffc070, edge: 0xff7a30, alpha: 0.85, len: 9, rad: 0.45, speed: 1.0 },
};

export class Stack {
  constructor(scene, mat, meta) {
    this.meta = meta; this.L = meta.launch;
    this.group = new THREE.Group(); scene.add(this.group);
    this.parts = buildTitan(mat);
    for (const p of Object.values(this.parts)) this.group.add(p);
    this.loose = new THREE.Group(); scene.add(this.loose);
    const L = this.L, T = (x) => x;
    // detach schedule (seconds after liftoff) and separation velocity in stack frame (m/s) + tumble (rad/s)
    this.detach = {
      srmL: { t: 122, dv: [-14, -6, 0], w: [0, 0, 0.25] }, srmR: { t: 122, dv: [14, -6, 0], w: [0, 0, -0.25] },
      cssA: { t: 285, dv: [-6, 0, 0], w: [0, 0, 0.4] }, cssB: { t: 285, dv: [6, 0, 0], w: [0, 0, -0.4] },
      stage1: { t: 262.5, dv: [0, -3, 0], w: [0.02, 0, 0.01] }, stage2: { t: 478, dv: [0, -2, 0], w: [0.01, 0.02, 0] },
      centaur: { t: L.t_sep - 2, dv: [0, -1.0, 0], w: [0.01, 0, 0.02] },
      pm: { t: (meta.t_escape - meta.t_liftoff) + 900, dv: [0, -0.4, 0], w: [0.05, 0.3, 0.02] },
    };
    // engine burn windows (s after liftoff)
    this.burns = [
      { part: 'srmL', eng: 'srm', t0: 0, t1: 122, tail: 116 }, { part: 'srmR', eng: 'srm', t0: 0, t1: 122, tail: 116 },
      { part: 'stage1', eng: 'lr87', t0: 112, t1: 262 }, { part: 'stage2', eng: 'lr91', t0: 263, t1: 470 },
      { part: 'centaur', eng: 'rl10', t0: 490, t1: L.t_ins }, { part: 'centaur', eng: 'rl10', t0: L.t_mes2, t1: L.t_sep - 4 },
      { part: 'pm', eng: 'star37', t0: L.t_sep, t1: meta.t_escape - meta.t_liftoff },
    ];
    // flame particles live in the vehicle frame; smoke lives in the world frame (co-rotating air)
    const N = 2600;
    this.flame = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, vertexColors: false }), N);
    this.flame.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.flame.frustumCulled = false;
    this.flame.setColorAt(0, new THREE.Color());
    this.group.add(this.flame);
    this.fp = []; this.FN = N;
    const M = 3500;
    this.smoke = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.55, depthWrite: false }), M);
    this.smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.smoke.frustumCulled = false;
    this.smoke.setColorAt(0, new THREE.Color());
    scene.add(this.smoke);
    this.sp = []; this.SM = M;
    this.tmp = new THREE.Matrix4(); this.col = new THREE.Color();
  }

  // stack reference (camera target) in stack coordinates, by phase
  refY(tl) { if (tl < 478) return 22; if (tl < this.L.t_sep - 2) return 37; if (tl < this.detach.pm.t) return 42; return 43.3; }

  attached(name, tl) { const d = this.detach[name]; return !d || tl < d.t; }
  active(tl) { return tl >= -3600 && tl < this.detach.pm.t + 1; }

  // q: stack orientation (THREE.Quaternion, stack +y = thrust axis); X(t): vehicle world km state fn
  update(tl, q, pressure, simDt, realDt, vacuum, ctx) {
    const on = this.active(tl);
    this.group.visible = on; this.loose.visible = on; this.smoke.visible = on && tl < 400;
    if (!on) return;
    const ry = this.refY(tl);
    this.group.quaternion.copy(q);
    this.group.position.set(0, -ry + (this.lift || 0), 0).applyQuaternion(q);
    for (const [name, part] of Object.entries(this.parts)) {
      if (this.attached(name, tl)) {
        if (part.parent !== this.group) this.group.add(part);
        part.position.set(0, 0, 0); part.quaternion.identity();
      } else {
        // ballistic relative motion since separation (stateless: depends on t only)
        const d = this.detach[name], dt = tl - d.t;
        if (part.parent !== this.loose) this.loose.add(part);
        const rel = ctx.relSince(d.t, dt, d.dv, q, ry);   // metres, world frame, relative to current vehicle
        if (!rel || rel.length() > 60000) { part.visible = false; continue; }
        part.visible = true;
        part.position.copy(rel);
        const qs = ctx.qAt(d.t), w = new THREE.Vector3(...d.w);
        const qt = new THREE.Quaternion().setFromAxisAngle(w.clone().normalize(), w.length() * dt);
        part.quaternion.copy(qs).multiply(qt);
        part.position.add(new THREE.Vector3(0, -ry, 0).applyQuaternion(qs));
      }
    }
    // stowed Voyager is drawn by main.js inside the stack group via this.voyagerSlot
    this.emit(tl, pressure, vacuum, Math.min(realDt, 0.05), simDt);
  }

  emit(tl, pressure, vac, dtr, simDt) {
    // spawn flame particles
    for (const b of this.burns) {
      if (tl < b.t0 || tl > b.t1 || !this.attached(b.part, tl)) continue;
      const E = ENGINES[b.eng];
      let thr = 1; if (b.tail && tl > b.tail) thr = Math.max(0, 1 - (tl - b.tail) / (b.t1 - b.tail));
      if (tl - b.t0 < 1.5) thr *= (tl - b.t0) / 1.5;
      const nozzles = this.parts[b.part].userData.nozzles || [[0, 0, 0]];
      const per = Math.ceil((b.eng === 'srm' ? 34 : 22) * thr * (b.eng === 'rl10' ? 0.6 : 1));
      for (const nz of nozzles) for (let i = 0; i < per; i++) {
        if (this.fp.length >= this.FN) this.fp.shift();
        const spread = (b.eng === 'srm' ? 0.035 : 0.05) + vac * (b.eng === 'srm' ? 0.3 : 0.55);
        const a = Math.random() * Math.PI * 2, r = Math.random() * spread;
        this.fp.push({ x: nz[0], y: nz[1], z: nz[2], vx: Math.cos(a) * r, vz: Math.sin(a) * r,
          life: 0, max: 0.18 + Math.random() * 0.14, E, len: E.len * (0.7 + 0.8 * vac) * (0.6 + 0.4 * thr), size: E.rad * (1 + vac * 1.2) });
      }
      if (E.smoke && pressure > 0.02 && simDt > 0) {
        const n = Math.min(12, Math.ceil(simDt * 40));
        for (let i = 0; i < n; i++) { if (this.sp.length >= this.SM) this.sp.shift(); this.sp.push({ born: tl, w: null, nz: nozzles[i % nozzles.length], part: b.part, k: Math.random() }); }
      }
    }
    // draw flame
    const m = this.tmp; let k = 0;
    for (let i = this.fp.length - 1; i >= 0; i--) {
      const p = this.fp[i]; p.life += dtr; if (p.life > p.max) { this.fp.splice(i, 1); continue; }
      const f = p.life / p.max, d = f * p.len;
      const s = p.size * (0.3 + f * (0.5 + vac * 0.8));
      m.makeScale(s, s * 1.6, s).setPosition(p.x + p.vx * d * 6, p.y - d, p.z + p.vz * d * 6);
      this.flame.setMatrixAt(k, m);
      const E = p.E, fade = 1 - (E.smoke || E === ENGINES.star37 ? 0.45 : 0.75) * vac;
      this.col.set(f < 0.25 ? E.core : f < 0.6 ? E.mid : E.edge).multiplyScalar(E.alpha * fade * (1 - f) * 1.4);
      this.flame.setColorAt(k, this.col); k++;
    }
    this.flame.count = k; this.flame.instanceMatrix.needsUpdate = true; if (this.flame.instanceColor) this.flame.instanceColor.needsUpdate = true;
  }

  // smoke: positions are computed by main.js (needs world transforms)
  drawSmoke(fn) {
    const m = this.tmp; let k = 0;
    for (const s of this.sp) {
      const r = fn(s); if (!r) continue;
      m.makeScale(r.size, r.size, r.size).setPosition(r.x, r.y, r.z); this.smoke.setMatrixAt(k, m);
      this.col.setRGB(r.c, r.c, r.c * 0.97); this.smoke.setColorAt(k, this.col); k++;
    }
    this.smoke.count = k; this.smoke.instanceMatrix.needsUpdate = true; if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true;
  }
  clearParticles() { this.fp.length = 0; this.sp.length = 0; }
}
