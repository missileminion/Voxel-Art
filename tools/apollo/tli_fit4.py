import sys; sys.path.insert(0, '/home/user/voxel-art/tools/apollo')
from run import *
s_land = up
T_E = T_PERI - 6 * 3600
def conic(params):
    y, sols, _ = coast_to_moon(params)
    s = sols[-1]; yy = s.sol(T_E) if s.t[0] <= T_E <= s.t[-1] else None
    pm_, vm_ = moon_state(T_E); r, v = yy[:3] - pm_, yy[3:] - vm_
    rn = np.linalg.norm(r); eps = v @ v / 2 - MU_M / rn; vinf = math.sqrt(2 * eps); a = -MU_M / (2 * eps)
    h = np.cross(r, v); ev = np.cross(v, h) / MU_M - r / rn; e = np.linalg.norm(ev); p = ev / e; hh = h / np.linalg.norm(h); q = np.cross(hh, p)
    sh = (p + math.sqrt(e * e - 1) * q) / e; B = np.cross(sh, h / vinf)
    H = math.acosh(max((1 - rn / a) / e, 1.0)) * np.sign(r @ v); M = e * math.sinh(H) - H; tp = T_E - M / math.sqrt(MU_M / abs(a) ** 3)
    return B, sh, vinf, tp, hh, a * (1 - e)
def resC(x):
    B, sh, vinf, tp, hh, rp = conic(x)
    e = 1 + RP_TARGET * vinf ** 2 / MU_M; b = RP_TARGET * math.sqrt((e + 1) / (e - 1))
    Np = N_TARGET - (N_TARGET @ sh) * sh; Np /= np.linalg.norm(Np)
    # orbit plane must contain the landing site: rotate the target normal about the asymptote to satisfy h . s_land = 0
    best = None
    for ang in np.linspace(-0.6, 0.6, 241):
        n2 = Np * math.cos(ang) + np.cross(sh, Np) * math.sin(ang)
        if best is None or abs(n2 @ s_land) < abs(best @ s_land): best = n2
    Bt = b * np.cross(sh, best)
    return np.array([*((B - Bt) / 200.0), (tp - T_PERI) / 30.0])
x = pickle.load(open(SCR + 'apollo_tli.pkl', 'rb'))['tli']
x = np.array([0.04555, 0.0, 1.0]) if x is None else x
B, sh, vinf, tp, hh, rp = conic(x); log('start: h.N %.3f rp %.0f tp-T %.0f s' % (hh @ N_TARGET, rp - R_M, tp - T_PERI))
r = least_squares(resC, x, diff_step=1e-6, x_scale=[1e-3, 1e-3, 1e-3], method='lm', max_nfev=60); x = r.x
B, sh, vinf, tp, hh, rp = conic(x); log('B-plane fit: pitch %.3f yaw %.3f k %.4f cost %.4f  h.N %.3f conic rp alt %.1f km tp err %.0f s' % (math.degrees(x[0]), math.degrees(x[1]), x[2], r.cost, hh @ N_TARGET, rp - R_M, tp - T_PERI))
pickle.dump(dict(tli=x), open(SCR + 'apollo_tli_b.pkl', 'wb'))
# exact closest-approach polish (now on the right side, smooth)
def resB(xx):
    y, sols, _ = coast_to_moon(xx); y2, s4 = prop(y, T_LOI1 - 1800, T_LOI1 + 3600)
    tc, rc = moon_ca(s4); yc = s4[-1].sol(tc); pm_, vm_ = moon_state(tc); rr, vv = yc[:3] - pm_, yc[3:] - vm_
    h = np.cross(rr, vv); h /= np.linalg.norm(h)
    return np.array([(np.linalg.norm(rr) - RP_TARGET) / 2.0, (tc - T_PERI) / 30.0, (h @ s_land) * 300])
r = least_squares(resB, x, diff_step=1e-6, x_scale=[1e-3, 1e-3, 1e-3], method='lm', max_nfev=40); x = r.x
log('FINAL pitch %.3f yaw %.3f k %.4f (=> %.1f ft/s vs 10441) resid %s' % (math.degrees(x[0]), math.degrees(x[1]), x[2], x[2] * 10441, np.round(r.fun, 3)))
pickle.dump(dict(tli=x), open(SCR + 'apollo_tli.pkl', 'wb'))
