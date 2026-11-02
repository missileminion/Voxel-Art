"""Cruise + flyby solver for Voyager 2 (barycentric ecliptic J2000, km, km/s, seconds since JD_REF).

Design: heliocentric Lambert chain (Earth -> Jupiter -> Saturn -> Uranus -> Neptune) supplies the
target periapsis direction at each planet; full n-body propagation + small impulsive TCMs (least squares
on the closest-approach vector and time) make the real trajectory hit the published flyby radii and times.
"""
import sys, json, numpy as np
sys.path.insert(0, '/home/user/voxel-art/tools')
import ephem, vmath as V, nbody
from scipy.optimize import least_squares, minimize_scalar

DE = '/tmp/claude-0/-home-user/2a823091-dce1-502f-bc76-a75fc34c2a87/scratchpad/de421x/de421-2008.1/de421'
ephem.load(DE)
JD = V.utc_to_tdb_jd
J = nbody.JD_REF

# ---- published encounter anchors (UTC) -------------------------------------------------
ENC = {
 'jupiter': dict(jd=JD(1979,7,9,22,29,0),    rp=570000+71492, ev='Jupiter closest approach'),
 'saturn':  dict(jd=JD(1981,8,26,3,24,5),    rp=101000+60268, ev='Saturn closest approach'),
 'uranus':  dict(jd=JD(1986,1,24,17,59,47),  rp=81500+25559,  ev='Uranus closest approach'),
 'neptune': dict(jd=JD(1989,8,25,3,56,36),   rp=4950+24341,   ev='Neptune closest approach'),
}
ORDER = ['jupiter', 'saturn', 'uranus', 'neptune']
POLE = {  # IAU north pole (RA, Dec) deg, equatorial J2000
 'jupiter': (268.057, 64.495), 'saturn': (40.589, 83.537), 'uranus': (257.311, -15.175), 'neptune': (299.36, 43.46)}

def pole_ecl(n):
    ra, de = np.radians(POLE[n])
    import geo
    return geo.ecl_from_eq(np.array([np.cos(de)*np.cos(ra), np.cos(de)*np.sin(ra), np.sin(de)]))

def unit(v): return v / np.linalg.norm(v)

class Cruise:
    def __init__(self, jd_end):
        self.E = nbody.Ephem(JD(1977,8,19), jd_end, 0.25)
        self.cs = self.E.cs
        self.dcs = self.cs.derivative()
        self.rhs = nbody.make_rhs(self.E)
    def pl(self, name, jd):  # barycentric state (pos, vel km/s)
        i = nbody.BODIES.index(name)
        return self.cs(jd)[i], self.dcs(jd)[i] / 86400.0
    def prop(self, y0, t0, t1, rtol=1e-11, dense=True):
        return nbody.propagate(self.E, y0, t0, t1, rtol=rtol, dense=dense)

    # -- Lambert design ----------------------------------------------------------------
    def hel(self, n, jd):
        return self.cs(jd)[nbody.BODIES.index(n)] - self.cs(jd)[0]
    def hvel(self, n, jd):
        i = nbody.BODIES.index(n)
        return (self.dcs(jd)[i] - self.dcs(jd)[0]) / 86400.0
    def design(self, jd_dep):
        pts = [('earth', jd_dep)] + [(n, ENC[n]['jd']) for n in ORDER]
        dep, arr = {}, {}
        for (a, ja), (b, jb) in zip(pts[:-1], pts[1:]):
            v1, v2 = V.lambert(self.hel(a, ja), self.hel(b, jb), (jb - ja)*86400)
            dep[a] = v1; arr[b] = v2
        out = {}
        out['vinf_launch'] = dep['earth'] - self.hvel('earth', jd_dep)
        for k in ORDER[:-1]:
            vin = arr[k] - self.hvel(k, ENC[k]['jd']); vout = dep[k] - self.hvel(k, ENC[k]['jd'])
            s, o = unit(vin), unit(vout)
            out[k] = dict(s=s, p=unit(s - o), vin=np.linalg.norm(vin), vout=np.linalg.norm(vout))
        vin = arr['neptune'] - self.hvel('neptune', ENC['neptune']['jd'])
        s = unit(vin); mu = V.GM['neptune']; rp = ENC['neptune']['rp']; vi = np.linalg.norm(vin)
        e = 1 + rp*vi**2/mu; half = np.arcsin(1/e)       # delta/2
        pole = pole_ecl('neptune'); b = unit(pole - (pole@s)*s)
        out['neptune'] = dict(s=s, p=np.sin(half)*s + np.cos(half)*b, vin=vi, vout=vi)
        return out

    # -- closest approach ---------------------------------------------------------------
    def closest(self, sol, name, t_guess, span=15*86400.0):
        i = nbody.BODIES.index(name)
        def d(t):
            return np.linalg.norm(sol.sol(t)[:3] - self.cs(J + t/86400.0)[i])
        ts = np.linspace(t_guess - span, t_guess + span, 1201)
        ts = ts[(ts >= sol.t[0]) & (ts <= sol.t[-1])]
        ds = np.array([d(t) for t in ts]); k = int(np.argmin(ds))
        lo, hi = ts[max(k-1, 0)], ts[min(k+1, len(ts)-1)]
        r = minimize_scalar(d, bounds=(lo, hi), method='bounded', options=dict(xatol=1e-3))
        t = r.x
        rv = sol.sol(t)[:3] - self.cs(J + t/86400.0)[i]
        return t, rv, float(np.linalg.norm(rv))

    # -- TCM targeting -----------------------------------------------------------------
    def conic(self, y, t, name):
        """B-plane vector, v_inf, periapsis time (s) from planetocentric 2-body conic at time t (s)."""
        i = nbody.BODIES.index(name); mu = V.GM[name]
        pp, pv = self.pl(name, J + t/86400.0)
        r = y[:3] - pp; v = y[3:] - pv
        rn = np.linalg.norm(r); eps = v@v/2 - mu/rn
        vinf = np.sqrt(2*eps); a = -mu/(2*eps)
        h = np.cross(r, v); ev = np.cross(v, h)/mu - r/rn; e = np.linalg.norm(ev)
        p = ev/e; hh = h/np.linalg.norm(h); q = np.cross(hh, p)
        s = (p + np.sqrt(e*e-1)*q)/e
        B = np.cross(s, h/vinf)
        coshH = (1 - rn/a)/e; H = np.arccosh(max(coshH, 1.0))*np.sign(r@v)
        M = e*np.sinh(H) - H; n = np.sqrt(mu/abs(a)**3)
        return B, s, vinf, t - M/n

    def target(self, y0, t0, name, des, lead=1.0*86400.0, polish=True):
        enc = ENC[name]; t_enc = (enc['jd'] - J)*86400.0; mu = V.GM[name]
        t_e = t_enc - lead
        def stage1(dv):
            y = y0.copy(); y[3:] += dv
            sol = self.prop(y, t0, t_e, rtol=1e-11, dense=False)
            B, s, vinf, tp = self.conic(sol.y[:, -1], t_e, name)
            e = 1 + enc['rp']*vinf**2/mu
            b = enc['rp']*np.sqrt((e+1)/(e-1))
            bh = des['p'] - (des['p']@s)*s; bh /= np.linalg.norm(bh)
            return np.concatenate([(B - b*bh)/300.0, [(tp - t_enc)/30.0]])
        r1 = least_squares(stage1, np.zeros(3), diff_step=1e-5, x_scale=1e-3, method='lm', xtol=1e-13, ftol=1e-13, gtol=1e-13, max_nfev=60)
        dv = r1.x
        info = dict(stage1_cost=float(r1.cost))
        if polish:
            p_t = des['p']*enc['rp']
            def stage2(d):
                y = y0.copy(); y[3:] += d
                sol = self.prop(y, t0, t_enc + 2*86400.0, rtol=1e-11)
                t, rv, rn = self.closest(sol, name, t_enc, span=6*86400.0)
                return np.concatenate([(rv - p_t)/50.0, [(t - t_enc)/10.0]])
            r2 = least_squares(stage2, dv, diff_step=1e-5, x_scale=1e-3, method='lm', xtol=1e-13, ftol=1e-13, gtol=1e-13, max_nfev=25)
            dv = r2.x; info['stage2_cost'] = float(r2.cost)
        return dv, info


    def conic2(self, y, t, name):
        B, s, vinf, tp = self.conic(y, t, name)
        mu = V.GM[name]; i = nbody.BODIES.index(name)
        pp, pv = self.pl(name, J + t/86400.0); r = y[:3]-pp; v = y[3:]-pv
        h = np.cross(r, v); ev = np.cross(v, h)/mu - r/np.linalg.norm(r); e = np.linalg.norm(ev)
        a = mu/(vinf**2)
        return dict(B=B, s=s, vinf=vinf, tp=tp, e=e, rp=a*(e-1), p=ev/e)

    def target_free(self, y0, t0, name, lead=1.0*86400.0):
        """minimum-|dv| impulse so that the conic periapsis radius and time match the published values."""
        from scipy.optimize import minimize
        enc = ENC[name]; t_enc = (enc['jd'] - J)*86400.0; t_e = t_enc - lead
        def cons(dv):
            y = y0.copy(); y[3:] += dv
            sol = self.prop(y, t0, t_e, rtol=1e-11, dense=False)
            c = self.conic2(sol.y[:, -1], t_e, name)
            return np.array([(c['rp'] - enc['rp'])/5.0, (c['tp'] - t_enc)/5.0])
        x0 = np.zeros(3)
        # start from a min-norm Newton step to land on the manifold
        for _ in range(4):
            f = cons(x0); Jm = np.empty((2, 3))
            for k in range(3):
                d = np.zeros(3); d[k] = 1e-5; Jm[:, k] = (cons(x0 + d) - f)/1e-5
            x0 = x0 - np.linalg.pinv(Jm) @ f
        return x0, float(np.linalg.norm(cons(x0)))

if __name__ == '__main__':
    pass
