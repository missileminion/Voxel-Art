"""Apollo 11 trajectory reconstruction (geocentric ecliptic J2000, km, km/s; t = seconds of MET).

Timeline and burn durations / delta-V come from the Apollo 11 Mission Report (MSC-00171) as summarised in the
user's timeline file. Gravity: Earth, Moon, Sun (DE421).  Burns are finite (constant thrust, mass flow from the
rocket equation) except small RCS trims.  Where the report gives no geometry, burns are steered by a small number
of fitted angles chosen to reproduce the published orbits (tagged 'derived' in the event list).
"""
import sys, os, json, pickle, math
import numpy as np
from scipy.interpolate import CubicSpline
from scipy.integrate import solve_ivp
from scipy.optimize import least_squares, minimize_scalar, brentq
sys.path.insert(0, '/home/user/voxel-art/tools')
import ephem, vmath as V, geo

DE = '/tmp/claude-0/-home-user/2a823091-dce1-502f-bc76-a75fc34c2a87/scratchpad/de421x/de421-2008.1/de421'
ephem.load(DE); ephem.load_librations(DE)
SCR = '/tmp/claude-0/-home-user-voxel-art/2a823091-dce1-502f-bc76-a75fc34c2a87/scratchpad/'
FT = 0.3048e-3                     # ft -> km
NMI = 1.852                        # nmi -> km
MU_E, MU_M, MU_S = 398600.4418, 4902.800066, 1.32712440018e11
R_E, R_M = 6378.137, 1737.4
G0 = 9.80665e-3                    # km/s^2

def met(h, m=0, s=0.0): return h * 3600 + m * 60 + s
JD_UTC0 = V.jd_from_utc(1969, 7, 16, 13, 32, 0)
JD0 = JD_UTC0 + 40.2 / 86400        # TDB at range zero (TT-UTC ~ 40.2 s in 1969)
def jd(t): return JD0 + t / 86400

# ---------------------------------------------------------------- ephemeris splines (geocentric, ecliptic)
_ts = np.arange(-2 * 86400, 10 * 86400, 300.0)
_moon = ephem.rot_ecl(ephem.raw_v('moon', jd(_ts)))
_sun = ephem.rot_ecl(ephem.raw_v('sun', jd(_ts)) - (ephem.raw_v('earthmoon', jd(_ts)) - ephem.raw_v('moon', jd(_ts)) / (1 + ephem.EMRAT)))
MOON = CubicSpline(_ts, _moon, axis=0); SUN = CubicSpline(_ts, _sun, axis=0); DMOON = MOON.derivative()
def moon_state(t): return MOON(t), DMOON(t)

# landing site (Mean-Earth frame): Tranquility Base 0.67408 N, 23.47297 E, radius 1735.47 km (approx)
SITE_LAT, SITE_LON, SITE_R = math.radians(0.67408), math.radians(23.47297), 1735.47
SITE_BF = SITE_R * np.array([math.cos(SITE_LAT) * math.cos(SITE_LON), math.cos(SITE_LAT) * math.sin(SITE_LON), math.sin(SITE_LAT)])
def moon_rot(t):
    """matrix: lunar body frame -> ecliptic J2000."""
    M = ephem.moon_matrix(jd(t))                 # ICRF -> body
    E = np.array([[1, 0, 0], [0, math.cos(ephem.OBL), math.sin(ephem.OBL)], [0, -math.sin(ephem.OBL), math.cos(ephem.OBL)]])
    return E @ M.T
def site_sel(t, bf=SITE_BF):
    """site position relative to the Moon's centre (ecliptic) and its inertial velocity from lunar rotation."""
    p = moon_rot(t) @ bf; p2 = moon_rot(t + 1) @ bf
    return p, (p2 - p)

# ---------------------------------------------------------------- dynamics
class Burn:
    def __init__(self, name, t0, dur, dv, isp, F, steer, central='earth'):
        self.name, self.t0, self.dur, self.steer, self.central = name, t0, dur, steer, central
        ve = isp * G0
        self.m0 = F * dur / (ve * (1 - math.exp(-dv / ve)))     # mass from the rocket equation (kg*km/s^2 units)
        self.mdot = F / ve; self.F = F
    def acc(self, t, y):
        if not (self.t0 <= t <= self.t0 + self.dur): return None
        m = self.m0 - self.mdot * (t - self.t0)
        return (self.F / m) * self.steer(t, y, self)

def frame(t, y, central):
    if central == 'moon':
        pm, vm = moon_state(t); r, v = y[:3] - pm, y[3:] - vm
    else: r, v = y[:3], y[3:]
    vh = v / np.linalg.norm(v); h = np.cross(r, v); h /= np.linalg.norm(h); n = np.cross(h, vh)
    return vh, n, h, r, v

def steer_angles(sign, p, yw):
    def f(t, y, b):
        vh, n, h, r, v = frame(t, y, b.central)
        return sign * math.cos(p) * math.cos(yw) * vh + math.sin(p) * n + math.sin(yw) * h
    return f

def rhs_factory(burns):
    def rhs(t, y):
        r = y[:3]; pm = MOON(t); ps = SUN(t)
        a = -MU_E * r / np.linalg.norm(r) ** 3
        d = pm - r; a += MU_M * (d / np.linalg.norm(d) ** 3 - pm / np.linalg.norm(pm) ** 3)
        d = ps - r; a += MU_S * (d / np.linalg.norm(d) ** 3 - ps / np.linalg.norm(ps) ** 3)
        for b in burns:
            ab = b.acc(t, y)
            if ab is not None: a = a + ab
        return np.concatenate([y[3:], a])
    return rhs

def prop(y0, t0, t1, burns=(), rtol=1e-11, dense=True, max_step=np.inf):
    tstops = sorted({t0, t1} | {b.t0 for b in burns if t0 < b.t0 < t1} | {b.t0 + b.dur for b in burns if t0 < b.t0 + b.dur < t1})
    sols = []; y = np.array(y0, float)
    for a, b in zip(tstops[:-1], tstops[1:]):
        active = [bb for bb in burns if bb.t0 < b and bb.t0 + bb.dur > a]
        ms = 2.0 if active else max_step
        s = solve_ivp(rhs_factory(active), (a, b), y, method='DOP853', rtol=rtol, atol=1e-9, dense_output=dense, max_step=ms)
        sols.append(s); y = s.y[:, -1]
    return y, sols

class Track:
    def __init__(self): self.segs = []
    def add(self, sols): self.segs += sols
    def __call__(self, t):
        for s in self.segs:
            if s.t[0] <= t <= s.t[-1]: return s.sol(t)
        raise ValueError('t outside track %f' % t)
    def range(self): return self.segs[0].t[0], self.segs[-1].t[-1]

def elements(r, v, mu):
    rn = np.linalg.norm(r); en = v @ v / 2 - mu / rn; a = -mu / (2 * en)
    h = np.cross(r, v); e = np.cross(v, h) / mu - r / rn; ecc = np.linalg.norm(e)
    return a, ecc, a * (1 - ecc), a * (1 + ecc), np.degrees(np.arccos(h[2] / np.linalg.norm(h)))

def lunar_alt_extrema(y, t, T=None):
    pm, vm = moon_state(t); a, e, rp, ra, i = elements(y[:3] - pm, y[3:] - vm, MU_M)
    return rp - R_M, ra - R_M

LOG = []
def log(*a):
    s = ' '.join(str(x) for x in a); print(s, flush=True); LOG.append(s)
