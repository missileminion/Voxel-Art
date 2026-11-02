"""Assemble the final Voyager 2 trajectory and export data for the viewer (app/data/)."""
import sys, os, json, time, pickle, struct, numpy as np
sys.path.insert(0, '/home/user/voxel-art/tools')
import optimize as O
from optimize import C, des0, dep, J, ENC, V, unit, jd_l, POLE_N, log, pole_ecl
import geo, launch, nbody
from scipy.optimize import minimize_scalar, brentq

OUT = '/home/user/voxel-art/app/data/'
SCR = O.SCR
os.makedirs(OUT, exist_ok=True)
def T(utc): return (O.JD(*utc) - J)*86400.0
def rotv(v, k, a): return v*np.cos(a) + np.cross(k, v)*np.sin(a) + k*(k@v)*(1-np.cos(a))
JD_END = O.JD(2049, 12, 30)
PUBLISHED_RP = {k: ENC[k]['rp'] for k in ENC}

# ------------------------------------------------------------------ injection / legs
def inject(v, disp=np.zeros(3)):
    g = dep.build(v)
    jd_b = jd_l + g['t_b']/86400.0
    pe, ve = C.pl('earth', jd_b)
    y = np.concatenate([pe + geo.ecl_from_eq(g['B_pos']), ve + geo.ecl_from_eq(g['B_vel']) + disp])
    return g, y, (jd_b - J)*86400.0

def solve_inj(aimJ, v0):
    v = v0.copy(); t_x = (jd_l + 2.0 - J)*86400.0
    for it in range(12):
        g, y, t = inject(v)
        yx = C.prop(y, t, t_x, rtol=1e-11, dense=False).y[:, -1]
        dv, _ = C.target(yx, t_x, 'jupiter', aimJ, polish=False)
        v = v + dv
        if np.linalg.norm(dv) < 1e-7: break
    return v

def adv(y, t, t1): return C.prop(y, t, t1, rtol=1e-11, dense=False).y[:, -1].copy()

t_postJ = T((1979, 8, 12, 18, 0, 0)); t_postS = T((1981, 9, 25, 18, 0, 0)); t_postU = T((1986, 3, 5, 18, 0, 0))

# 1. Jupiter periapsis radius: the value that minimises the Jupiter->Saturn correction (published dates fixed)
cache = {}
def dvJ(rp):
    ENC['jupiter']['rp'] = rp
    v = solve_inj(des0['jupiter'], des0['vinf_launch'])
    g, y, t = inject(v); y = adv(y, t, t_postJ)
    dv, _ = C.target(y, t_postJ, 'saturn', des0['saturn'], polish=False)
    cache[rp] = (v, dv)
    m = np.linalg.norm(dv)*1000; log('  rp_J %.0f -> TCM(J->S) %.1f m/s' % (rp, m)); return m
r = minimize_scalar(dvJ, bounds=(660000, 760000), method='bounded', options=dict(xatol=2000))
RP_J = r.x; ENC['jupiter']['rp'] = RP_J
log('Jupiter periapsis chosen: %.0f km (published-derived %.0f), J->S correction %.1f m/s' % (RP_J, PUBLISHED_RP['jupiter'], r.fun))
V_INJ = cache[min(cache, key=lambda k: abs(k - RP_J))][0]
V_INJ = solve_inj(des0['jupiter'], V_INJ)

# 2. Neptune approach side: rotate the pole-based aim to match the 2007/2018 boundary distances
def boundary_err(a_deg, full=False):
    aimN = dict(s=des0['neptune']['s'], p=rotv(des0['neptune']['p'], des0['neptune']['s'], np.radians(a_deg)))
    y, t = Y_U, t_postU
    dv, _ = C.target(y, t, 'neptune', aimN, polish=False)
    y2 = y.copy(); y2[3:] += dv
    s = C.prop(y2, t, T((2019, 1, 1, 0, 0, 0)), rtol=1e-11)
    rr = []
    for utc in [(2007, 8, 30, 12, 0, 0), (2018, 11, 5, 12, 0, 0)]:
        tt = T(utc); rr.append(np.linalg.norm(s.sol(tt)[:3] - C.cs(J + tt/86400.0)[0])/V.AU)
    log('  Neptune aim rotation %+6.1f deg: TCM %.1f m/s, r(2007-08-30) %.2f AU, r(2018-11-05) %.2f AU' % (a_deg, np.linalg.norm(dv)*1000, rr[0], rr[1]))
    return (rr[0]-83.7)**2 + (rr[1]-119.0)**2 if not full else (aimN, dv, rr)

# ------------------------------------------------------------------ full chain with TCMs
rng = np.random.default_rng(1977)
DISP = np.array([2.1, -1.4, 0.9])/1000.0          # injection error (guess)
G, y, t = inject(V_INJ, DISP)
TB = t
log('t_b = %.0f s after liftoff; C3 = %.2f km2/s2' % (G['t_b'], V_INJ @ V_INJ))
aims = {'jupiter': des0['jupiter'], 'saturn': des0['saturn'], 'uranus': des0['uranus'], 'neptune': None}
TCMS = [('TCM-1', (1977, 8, 29, 18, 0, 0), 'jupiter'), ('TCM-2', (1977, 12, 11, 18, 0, 0), 'jupiter'),
        ('TCM-3', (1979, 2, 9, 18, 0, 0), 'jupiter'), ('TCM-4', (1979, 8, 12, 18, 0, 0), 'saturn'),
        ('TCM-5', (1980, 9, 3, 18, 0, 0), 'saturn'), ('TCM-6', (1981, 9, 25, 18, 0, 0), 'uranus'),
        ('TCM-7', (1984, 4, 11, 18, 0, 0), 'uranus'), ('TCM-8', (1985, 10, 14, 18, 0, 0), 'uranus'),
        ('TCM-9', (1986, 3, 5, 18, 0, 0), 'neptune'), ('TCM-10', (1987, 12, 18, 18, 0, 0), 'neptune'),
        ('TCM-11', (1989, 4, 25, 18, 0, 0), 'neptune')]
segments = []; tcm_log = []
for label, utc, tgt in TCMS:
    tt = T(utc)
    s = C.prop(y, t, tt, rtol=1e-12); segments.append(s)
    y = s.y[:, -1].copy(); t = tt
    if label == 'TCM-9':
        Y_U = y.copy()
        best = min([(boundary_err(a), a) for a in range(-60, 61, 15)])
        rr = minimize_scalar(boundary_err, bounds=(best[1]-15, best[1]+15), method='bounded', options=dict(xatol=0.5))
        aims['neptune'], _, _ = boundary_err(rr.x, full=True)
        log('Neptune aim rotation %.1f deg' % rr.x)
    dv, _ = C.target(y, t, tgt, aims[tgt], polish=False)
    mag = np.linalg.norm(dv)
    ex = dv*(1 + 0.01*rng.standard_normal()) + mag*np.radians(0.3)*rng.standard_normal(3)/np.sqrt(3)
    y[3:] += ex
    tcm_log.append(dict(label=label, t=tt, target=tgt, dv=float(np.linalg.norm(ex))*1000, dir=list(unit(ex))))
    log('%-6s -> %-8s %8.3f m/s' % (label, tgt, np.linalg.norm(ex)*1000))
s = C.prop(y, t, (JD_END - J)*86400.0, rtol=1e-12); segments.append(s)

class Dense:
    def __init__(s): s.t = [segments[0].t[0], segments[-1].t[-1]]
    def sol(s, tt):
        for g in segments:
            if g.t[0] <= tt <= g.t[-1]: return g.sol(tt)
        return segments[-1].sol(tt)
D = Dense()
enc_out = {}
for k in O.ORDER:
    te = (ENC[k]['jd'] - J)*86400.0
    tc, rv, rn = C.closest(D, k, te, span=3*86400.0)
    pp, pv = C.pl(k, J + tc/86400.0); vrel = D.sol(tc)[3:] - pv
    enc_out[k] = dict(t=tc, rp=rn, rp_published=PUBLISHED_RP[k], dt=tc - te, v=float(np.linalg.norm(vrel)))
    log('%-8s rp %9.0f km (published %9.0f, %+.2f %%), time %+6.1f s, speed %.2f km/s' % (k, rn, PUBLISHED_RP[k], 100*(rn/PUBLISHED_RP[k]-1), tc-te, np.linalg.norm(vrel)))
for name, utc, ref in [('termination shock', (2007, 8, 30, 12, 0, 0), 83.7), ('heliopause', (2018, 11, 5, 12, 0, 0), 119.0)]:
    tt = T(utc); log('%s: %.2f AU (published %.1f)' % (name, np.linalg.norm(D.sol(tt)[:3] - C.cs(J + tt/86400.0)[0])/V.AU, ref))
pickle.dump(dict(segments=[(g.t[0], g.y[:, 0].copy(), g.t[-1]) for g in segments], tcm=tcm_log, enc=enc_out, G=G, V_INJ=V_INJ, RP_J=RP_J,
                 aimN=aims['neptune']), open(SCR + 'final.pkl', 'wb'))
log('saved final.pkl')
