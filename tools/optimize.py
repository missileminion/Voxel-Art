"""Global least-squares fit of the whole Voyager 2 trajectory.

Unknowns : launch asymptote v_inf (3) + three post-flyby trajectory-correction impulses (3 x 3)
Residuals: published flyby radius (sigma 1 %) and time (sigma 120 s) at J/S/U/N,
           Neptune pass over the north polar region, heliocentric distance at the
           termination-shock (2007-08-30, 83.7 AU) and heliopause (2018-11-05, 119.0 AU) crossings,
           and a prior that each TCM component is small (sigma 3 m/s).
"""
import sys, time, pickle, json, numpy as np
sys.path.insert(0, '/home/user/voxel-art/tools')
from cruise import *
import geo, launch
from scipy.optimize import least_squares

SCR = '/tmp/claude-0/-home-user-voxel-art/2a823091-dce1-502f-bc76-a75fc34c2a87/scratchpad/'
OLD = '/tmp/claude-0/-home-user/2a823091-dce1-502f-bc76-a75fc34c2a87/scratchpad/solve_all.pkl'
T0 = time.time()
def log(*a): print('[%6.1fs]' % (time.time()-T0), *a, flush=True)

C = Cruise(JD(2049, 12, 30))
jd_utc = V.jd_from_utc(1977, 8, 20, 14, 29, 44)
jd_l = JD(1977, 8, 20, 14, 29, 44)
dep = launch.Departure(jd_utc, jd_l)
def T(utc): return (JD(*utc) - J)*86400.0

des0 = C.design(jd_l + 1.0/24)
G0 = dep.build(des0['vinf_launch']); TB = G0['t_b']
TCM_T = [T((1979, 8, 12, 18, 0, 0)), T((1981, 9, 25, 18, 0, 0)), T((1986, 3, 5, 18, 0, 0))]
T_END = T((2019, 1, 1, 0, 0, 0))
POLE_N = pole_ecl('neptune')

def inject(v):
    g = dep.build(v)
    jd_b = jd_l + TB/86400.0
    pe, ve = C.pl('earth', jd_b)
    y = np.concatenate([pe + geo.ecl_from_eq(g['B_pos']), ve + geo.ecl_from_eq(g['B_vel'])])
    return g, y, (jd_b - J)*86400.0

def build_x0():
    """sequential targeting: injection -> Jupiter, then post-flyby TCMs -> Saturn, Uranus, Neptune."""
    v = des0['vinf_launch'].copy(); t_x = (jd_l + 2.0 - J)*86400.0
    for it in range(8):
        g, y, t = inject(v)
        yx = C.prop(y, t, t_x, rtol=1e-11, dense=False).y[:, -1]
        dv, _ = C.target(yx, t_x, 'jupiter', des0['jupiter'], polish=False)
        v = v + dv
        if np.linalg.norm(dv) < 1e-6: break
    x = list(v)
    g, y, t = inject(v)
    for tt, tgt in zip(TCM_T, ['saturn', 'uranus', 'neptune']):
        y = C.prop(y, t, tt, rtol=1e-11, dense=False).y[:, -1].copy(); t = tt
        dv, _ = C.target(y, t, tgt, des0[tgt], polish=False)
        y[3:] += dv; x += list(dv)
    return np.array(x)

def run(x, t_end=T_END, rtol=1e-11):
    g, y, t = inject(x[:3])
    segs = []
    for k, tt in enumerate(TCM_T):
        s = C.prop(y, t, tt, rtol=rtol); segs.append(s)
        y = s.y[:, -1].copy(); y[3:] += x[3+3*k:6+3*k]; t = tt
    s = C.prop(y, t, t_end, rtol=rtol); segs.append(s)
    return segs

class Dense:
    def __init__(s, segs): s.segs = segs; s.t = [segs[0].t[0], segs[-1].t[-1]]
    def sol(s, t):
        for g in s.segs:
            if g.t[0] <= t <= g.t[-1]: return g.sol(t)
        return s.segs[-1].sol(t)

def metrics(x):
    D = Dense(run(x)); out = {}
    for k in ORDER:
        te = (ENC[k]['jd'] - J)*86400.0
        t, rv, rn = C.closest(D, k, te, span=4*86400.0)
        out[k] = (t - te, rn, rv)
    for name, utc in [('ts', (2007, 8, 30, 12, 0, 0)), ('hp', (2018, 11, 5, 12, 0, 0))]:
        t = T(utc); out[name] = np.linalg.norm(D.sol(t)[:3] - C.cs(J + t/86400.0)[0])/V.AU
    return out

def resid(x):
    m = metrics(x); r = []
    for k in ORDER:
        dt, rn, rv = m[k]
        r += [(rn - ENC[k]['rp'])/(0.01*ENC[k]['rp']), dt/120.0]
    ang = np.degrees(np.arccos(np.clip(unit(m['neptune'][2]) @ POLE_N, -1, 1)))
    r += [ang/20.0, (m['ts'] - 83.7)/0.3, (m['hp'] - 119.0)/0.3]
    r += list(x[3:]*1000/3.0)
    return np.array(r)

if __name__ == '__main__':
    x0 = build_x0()
    m = metrics(x0)
    log('start:', {k: (round(m[k][0], 1), round(m[k][1])) for k in ORDER}, 'ts %.2f hp %.2f' % (m['ts'], m['hp']))
    log('start TCM m/s:', [round(np.linalg.norm(x0[3+3*k:6+3*k])*1000, 2) for k in range(3)])
    it = [0]
    def cb_resid(x):
        r = resid(x); it[0] += 1
        if it[0] % 13 == 0:
            log('eval %d cost %.2f  TCMs %s' % (it[0], 0.5*r@r, [round(np.linalg.norm(x[3+3*k:6+3*k])*1000, 2) for k in range(3)]))
        return r
    res = least_squares(cb_resid, x0, x_scale=np.full(12, 1e-3), diff_step=1e-6, method='lm', max_nfev=600,
                        xtol=1e-10, ftol=1e-10)
    x = res.x
    m = metrics(x)
    log('final cost', res.cost)
    for k in ORDER:
        log('%-8s rp %10.0f km (pub %10.0f, %+5.2f %%)  time %+8.1f s' % (k, m[k][1], ENC[k]['rp'], 100*(m[k][1]/ENC[k]['rp']-1), m[k][0]))
    ang = np.degrees(np.arccos(unit(m['neptune'][2]) @ POLE_N))
    log('Neptune CA angle from north pole: %.1f deg' % ang)
    log('termination shock r = %.2f AU, heliopause r = %.2f AU' % (m['ts'], m['hp']))
    log('C3 = %.3f, TCMs (m/s): %s' % (x[:3]@x[:3], [round(np.linalg.norm(x[3+3*k:6+3*k])*1000, 2) for k in range(3)]))
    pickle.dump(dict(x=x, TB=TB, TCM_T=TCM_T), open(SCR + 'opt.pkl', 'wb'))
