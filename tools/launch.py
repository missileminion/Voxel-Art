"""Launch / parking-orbit / escape-burn model (geocentric inertial, equatorial J2000 -> returned in ecliptic J2000).

Everything between liftoff and the escape hyperbola's perigee is a *stylised* reconstruction:
  - injection geometry (plane, perigee, v_inf) is derived from the interplanetary solution  [derived]
  - ascent profile, parking-orbit altitude/azimuth, burn durations are educated guesses   [guess]
"""
import numpy as np, geo, vmath as V, ephem

MUE = V.GM['earth']
PAD = dict(lat=28.5833, lon=-80.5772)          # LC-41
R_PARK = 6378.137 + 167.0                      # parking orbit radius (guess: 167 km altitude)
AZ0 = np.radians(98.0)                         # launch azimuth (guess)
T_INS = 660.0                                  # liftoff -> parking-orbit insertion, s (guess)
DPHI_BURN = np.radians(28.0)                   # arc swept by the escape burn (guess)
# altitude profile (fraction of parking altitude vs time): typical Titan IIIE/Centaur shape (guess):
# ~8 km at T+60 s, ~43 km at SRM separation, ~118 km at stage 1 cutoff, ~165 km at stage 2 cutoff
from scipy.interpolate import PchipInterpolator
ALT_SHAPE = PchipInterpolator([0, 30, 60, 90, 122, 180, 262, 360, 470, 560, 660],
                              [0, 0.011, 0.048, 0.12, 0.25, 0.46, 0.69, 0.86, 0.96, 0.995, 1.0])

def rot(v, k, a):
    return v*np.cos(a) + np.cross(k, v)*np.sin(a) + k*(k@v)*(1-np.cos(a))
def unit(v): return v/np.linalg.norm(v)
def smooth(x): x = np.clip(x, 0, 1); return x*x*(3-2*x)

class Departure:
    def __init__(self, jd_utc, jd_tdb):
        self.jd_utc = jd_utc; self.jd_tdb = jd_tdb
        self.pad0 = geo.site_vec_eq(PAD['lat'], PAD['lon'], jd_utc, jd_tdb)     # equatorial J2000, km
        self.pad_hat = unit(self.pad0)

    def pad_at(self, t):
        """inertial pad position (eq J2000) t seconds after liftoff (Earth rotation about its axis)."""
        return geo.site_vec_eq(PAD['lat'], PAD['lon'], self.jd_utc + t/86400.0, self.jd_tdb + t/86400.0)

    def build(self, vinf_ecl):
        """Return dict with all geometry for a given departure asymptote velocity (ecliptic J2000, km/s)."""
        vinf_eq = geo.eq_from_ecl(vinf_ecl); vi = np.linalg.norm(vinf_eq); s = vinf_eq/vi
        # --- parking orbit: contains the pad at liftoff with azimuth AZ0
        east = unit(np.cross([0, 0, 1.0], self.pad_hat)); north = np.cross(self.pad_hat, east)
        tang = np.cos(AZ0)*north + np.sin(AZ0)*east
        n_p = unit(np.cross(self.pad_hat, tang))
        xh = self.pad_hat; yh = np.cross(n_p, xh)
        vc = np.sqrt(MUE/R_PARK); w = vc/R_PARK
        # --- escape hyperbola: plane contains the asymptote and the (injection-time) pad
        n_h = unit(np.cross(self.pad_hat, s))
        if n_h[2] < 0: n_h = -n_h
        # perigee radius from required hyperbola (guess: 200 km altitude at burnout)
        rp = 6378.137 + 200.0
        e = 1 + rp*vi**2/MUE; nu = np.arccos(-1/e)
        p_hat = rot(s, n_h, -nu); q_hat = np.cross(n_h, p_hat)
        vp = np.sqrt(vi**2 + 2*MUE/rp)
        B_pos = rp*p_hat; B_vel = vp*q_hat
        # --- burn start: point on the parking circle nearest to the burn-arc start
        target = rot(p_hat, n_h, -DPHI_BURN)*R_PARK
        psis = np.linspace(0, 2*np.pi, 7200, endpoint=False)
        pts = R_PARK*(np.cos(psis)[:, None]*xh + np.sin(psis)[:, None]*yh)
        k = int(np.argmin(np.linalg.norm(pts - target, axis=1))); psi_s = psis[k]
        th_ins = T_INS*vc/(2*R_PARK)                       # insertion angle (g = tau^2 profile)
        dpsi = (psi_s - th_ins) % (2*np.pi)
        if dpsi < np.radians(30): dpsi += 2*np.pi          # at least ~7 min of coast
        t_coast = dpsi/w
        A_pos = R_PARK*(np.cos(psi_s)*xh + np.sin(psi_s)*yh); A_vel = vc*(-np.sin(psi_s)*xh + np.cos(psi_s)*yh)
        chord = np.linalg.norm(B_pos - A_pos)
        t_burn = chord/(0.5*(vc+vp))
        return dict(vinf=vi, s=s, n_p=n_p, n_h=n_h, xh=xh, yh=yh, vc=vc, w=w, th_ins=th_ins, psi_s=psi_s,
                    t_coast=t_coast, t_burn=t_burn, A_pos=A_pos, A_vel=A_vel, B_pos=B_pos, B_vel=B_vel,
                    rp=rp, e=e, t_ins=T_INS, t_b=T_INS + t_coast + t_burn, p_hat=p_hat, q_hat=q_hat)

    # --- trajectory samples (geocentric, equatorial J2000) ---------------------------------
    def ascent_state(self, g, t):
        tau = np.clip(t/T_INS, 0, 1)
        r0 = np.linalg.norm(self.pad0)
        r = r0 + (R_PARK - r0)*float(ALT_SHAPE(np.clip(t, 0, T_INS)))
        th = g['th_ins']*tau**2
        O = r*(np.cos(th)*g['xh'] + np.sin(th)*g['yh'])
        wgt = smooth(tau/0.2)
        P = self.pad_at(t)
        d = (1-wgt)*P/np.linalg.norm(P) + wgt*O/np.linalg.norm(O)
        return d/np.linalg.norm(d)*r

    def coast_state(self, g, t):
        """t seconds after insertion."""
        psi = g['th_ins'] + g['w']*t
        pos = R_PARK*(np.cos(psi)*g['xh'] + np.sin(psi)*g['yh'])
        vel = g['vc']*(-np.sin(psi)*g['xh'] + np.cos(psi)*g['yh'])
        return pos, vel

    def burn_state(self, g, t):
        """t seconds after burn start (cubic Hermite from circular A to hyperbola perigee B)."""
        T = g['t_burn']; x = np.clip(t/T, 0, 1)
        h00 = 2*x**3 - 3*x**2 + 1; h10 = x**3 - 2*x**2 + x; h01 = -2*x**3 + 3*x**2; h11 = x**3 - x**2
        pos = h00*g['A_pos'] + h10*T*g['A_vel'] + h01*g['B_pos'] + h11*T*g['B_vel']
        d00 = (6*x**2 - 6*x)/T; d10 = (3*x**2 - 4*x + 1); d01 = (-6*x**2 + 6*x)/T; d11 = (3*x**2 - 2*x)
        vel = d00*g['A_pos'] + d10*g['A_vel'] + d01*g['B_pos'] + d11*g['B_vel']
        return pos, vel
