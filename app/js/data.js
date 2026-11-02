// Data loading and interpolation. Positions are km, barycentric ecliptic J2000; time is seconds from JD_REF (TDB).

export async function loadMission(base = 'app/data/') {
  const [meta, vbuf, bbuf] = await Promise.all([
    fetch(base + 'mission.json').then(r => r.json()),
    loadBin(base, 'voyager'),
    loadBin(base, 'bodies'),
  ]);
  const voyager = new Track(new Float64Array(vbuf));
  const bodies = {};
  for (const [name, info] of Object.entries(meta.bodies)) {
    const head = new Float64Array(bbuf, info.offset, 3);
    const data = new Float64Array(bbuf, info.offset + 24, head[2] * 6);
    bodies[name] = new Uniform(head[0], head[1], head[2], data);
  }
  return { meta, voyager, bodies };
}

// binary data; hosts that cannot serve .bin get a base64 copy (<name>.b64.txt)
export async function loadBin(base, name) {
  const r = await fetch(base + name + '.bin').catch(() => null);
  if (r && r.ok && !(r.headers.get('content-type') || '').includes('text/html')) return r.arrayBuffer();
  const txt = await (await fetch(base + name + '.b64.txt')).text();
  const raw = atob(txt.trim()), out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

function hermite(h, s, p0, v0, p1, v1, out, off) {
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  const d00 = (6 * s2 - 6 * s) / h, d10 = 3 * s2 - 4 * s + 1, d01 = (-6 * s2 + 6 * s) / h, d11 = 3 * s2 - 2 * s;
  for (let k = 0; k < 3; k++) {
    out.p[k] = h00 * p0[k] + h10 * h * v0[k] + h01 * p1[k] + h11 * h * v1[k];
    out.v[k] = d00 * p0[k] + d10 * v0[k] + d01 * p1[k] + d11 * v1[k];
  }
  return out;
}

// spacecraft: irregular nodes [t, x, y, z, vx, vy, vz]
export class Track {
  constructor(f64) { this.d = f64; this.n = f64.length / 7; this.last = 0; }
  get t0() { return this.d[0]; }
  get t1() { return this.d[(this.n - 1) * 7]; }
  index(t) {
    const d = this.d; let i = this.last;
    if (i < 0 || i >= this.n - 1 || t < d[i * 7] || t > d[(i + 1) * 7]) {
      let lo = 0, hi = this.n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (d[m * 7] <= t) lo = m; else hi = m; }
      i = lo;
    }
    this.last = i; return i;
  }
  state(t, out = { p: [0, 0, 0], v: [0, 0, 0] }) {
    t = Math.min(Math.max(t, this.t0), this.t1);
    const i = this.index(t), d = this.d, a = i * 7, b = a + 7;
    const h = d[b] - d[a] || 1, s = (t - d[a]) / h;
    return hermite(h, s, [d[a + 1], d[a + 2], d[a + 3]], [d[a + 4], d[a + 5], d[a + 6]],
      [d[b + 1], d[b + 2], d[b + 3]], [d[b + 4], d[b + 5], d[b + 6]], out);
  }
}

// planets: uniform samples
export class Uniform {
  constructor(t0, dt, n, data) { Object.assign(this, { t0, dt, n, d: data }); this.t1 = t0 + dt * (n - 1); }
  covers(t) { return t >= this.t0 && t <= this.t1; }
  state(t, out = { p: [0, 0, 0], v: [0, 0, 0] }) {
    const tc = Math.min(Math.max(t, this.t0), this.t1 - 1e-6);
    const i = Math.floor((tc - this.t0) / this.dt), s = (tc - this.t0) / this.dt - i, d = this.d, a = i * 6, b = a + 6;
    return hermite(this.dt, s, [d[a], d[a + 1], d[a + 2]], [d[a + 3], d[a + 4], d[a + 5]],
      [d[b], d[b + 1], d[b + 2]], [d[b + 3], d[b + 4], d[b + 5]], out);
  }
}

// ---- time ------------------------------------------------------------------------------------
const LEAPS = [[1972.5, 11], [1973, 12], [1974, 13], [1975, 14], [1976, 15], [1977, 16], [1978, 17], [1979, 18], [1980, 19],
  [1981.5, 20], [1982.5, 21], [1983.5, 22], [1985.5, 23], [1988, 24], [1990, 25], [1991, 26], [1992.5, 27], [1993.5, 28],
  [1994.5, 29], [1996, 30], [1997.5, 31], [1999, 32], [2006, 33], [2009, 34], [2012.5, 35], [2015.5, 36], [2017, 37]];
export function tdbToDate(jdRef, t) {
  const jd = jdRef + t / 86400;
  const yr = 2000 + (jd - 2451544.5) / 365.25;
  let leap = 10; for (const [y, n] of LEAPS) if (yr >= y) leap = n;
  const jdUtc = jd - (leap + 32.184) / 86400;
  return new Date((jdUtc - 2440587.5) * 86400000);
}
export function dateToTdb(jdRef, date) {
  const jdUtc = date.getTime() / 86400000 + 2440587.5;
  const yr = 2000 + (jdUtc - 2451544.5) / 365.25;
  let leap = 10; for (const [y, n] of LEAPS) if (yr >= y) leap = n;
  return (jdUtc + (leap + 32.184) / 86400 - jdRef) * 86400;
}

// ---- small vector helpers (Float64, plain arrays) ---------------------------------------------
export const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
