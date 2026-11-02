"""Barycentric ecliptic-J2000 n-body propagator for a test particle (spacecraft)."""
import numpy as np
from scipy.interpolate import CubicSpline
from scipy.integrate import solve_ivp
import ephem, vmath as V

BODIES = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']
GMV = np.array([V.GM[b] for b in BODIES])
JD_REF = 2443375.0      # time zero for the integrator (TDB), days

class Ephem:
    def __init__(self, jd_start, jd_end, step=0.25):
        self.jd = np.arange(jd_start, jd_end + step, step)
        P = np.stack([ephem.body_v(b, self.jd) for b in BODIES], axis=1)   # (N,nb,3)
        self.cs = CubicSpline(self.jd, P, axis=0)
    def at(self, jd): return self.cs(jd)
    def body(self, name, jd): return self.cs(jd)[..., BODIES.index(name), :]

def make_rhs(E):
    cs = E.cs
    def rhs(t, y):
        p = cs(JD_REF + t / 86400.0)             # (nb,3)
        d = p - y[:3]
        r2 = np.einsum('ij,ij->i', d, d)
        a = (GMV / (r2 * np.sqrt(r2))) @ d
        return np.concatenate([y[3:], a])
    return rhs

def propagate(E, y0, t0, t1, rtol=1e-11, atol=1e-6, dense=True):
    """t in seconds since JD_REF. returns solve_ivp solution."""
    return solve_ivp(make_rhs(E), (t0, t1), y0, method='DOP853', rtol=rtol, atol=atol, dense_output=dense)

def tsec(jd): return (jd - JD_REF) * 86400.0
