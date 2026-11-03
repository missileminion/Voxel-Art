"""Full Apollo 11 reconstruction after the TLI fit: lunar orbit, landing, ascent/rendezvous, return, entry."""
import sys
sys.path.insert(0, '/home/user/voxel-art/tools/apollo')
from run import *

TLI = pickle.load(open(SCR + 'apollo_tli.pkl', 'rb'))['tli']
TRK = {k: Track() for k in ('csm', 'lm', 'sivb')}
EV = []    # derived results for the event list
def ev(t, title, text, tag='derived'): EV.append(dict(t=float(t), title=title, text=text, tag=tag))

# ---------------------------------------------------------------- Earth orbit, TLI, coast (CSM track starts at insertion)
p, yw, k = TLI
tli = Burn('TLI', T_TLI, D_TLI, DV_TLI * k, 421.0, 863.0, steer_angles(+1, p, yw))
y, s = prop(Y_INS, T_INS, T_EVA_SEP, [tli]); TRK['csm'].add(s)
y_sivb = y.copy()
ys, s = prop(y_sivb, T_EVA_SEP, T_EVA_SEP + 10 * 3600); TRK['sivb'].add(s)
y = sep_dv(T_EVA_SEP, y, 19.7 * FT, 'out')
y, s = prop(y, T_EVA_SEP, T_MCC2); TRK['csm'].add(s)
y = sep_dv(T_MCC2, y, 20.9 * FT, 'pos')
y, s = prop(y, T_MCC2, T_LOI1); TRK['csm'].add(s)
a, e, rp, ra, inc = elements(y[:3] - MOON(T_LOI1), y[3:] - moon_state(T_LOI1)[1], MU_M)
log('approach: lunar hyperbola periapsis %.1f km alt' % (rp - R_M))

# ---------------------------------------------------------------- LOI-1 / LOI-2 (SPS 91.2 kN, Isp 314 s)
def loi1(k, pitch=0.0):
    b = Burn('LOI1', T_LOI1, D_LOI1, DV_LOI1 * k, 314.0, 91.19, steer_angles(-1, pitch, 0.0), central='moon')
    y1, s1 = prop(y, T_LOI1, T_LOI1 + D_LOI1 + 10, [b]); return y1, s1, b
def r1(x):
    y1, _, _ = loi1(*x); hp, ha = lunar_alt_extrema(y1, T_LOI1 + D_LOI1 + 10); return [(hp - 60.9 * NMI) / 1.0, (ha - 169.9 * NMI) / 1.0]
_r = least_squares(r1, [1.0, 0.0], diff_step=1e-5, x_scale=[0.01, 0.01], method='lm'); kL1, pitch1 = _r.x
y, s, b1 = loi1(kL1, pitch1); TRK['csm'].add(s)
hp, ha = lunar_alt_extrema(y, T_LOI1 + D_LOI1 + 10)
log('LOI-1 model dV %.1f ft/s (report 2917.5), pitch %.2f deg -> orbit %.1f x %.1f nmi (report 60.9 x 169.9)' % (2917.5 * kL1, math.degrees(pitch1), hp / NMI, ha / NMI))
ev(T_LOI1 + D_LOI1, 'Lunar orbit achieved', 'Orbit %.1f x %.1f nmi (model).' % (hp / NMI, ha / NMI))
T_LOI2, D_LOI2, DV_LOI2 = met(80, 11, 36.8), 16.8, 158.8 * FT
y, s = prop(y, s[-1].t[-1], T_LOI2); TRK['csm'].add(s)
def loi2(k, pitch=0.0):
    b = Burn('LOI2', T_LOI2, D_LOI2, DV_LOI2 * k, 314.0, 91.19, steer_angles(-1, pitch, 0.0), central='moon')
    return prop(y, T_LOI2, T_LOI2 + D_LOI2 + 5, [b])
def r2(x):
    y2, _ = loi2(*x); hp, ha = lunar_alt_extrema(y2, T_LOI2 + D_LOI2 + 5); return [hp - 53.7 * NMI, ha - 65.7 * NMI]
_r = least_squares(r2, [1.0, 0.0], diff_step=1e-5, x_scale=[0.05, 0.05], method='lm'); kL2, pitch2 = _r.x
y, s = loi2(kL2, pitch2); TRK['csm'].add(s)
hp, ha = lunar_alt_extrema(y, T_LOI2 + D_LOI2 + 5)
log('LOI-2 model dV %.1f ft/s (report 158.8), pitch %.1f deg -> orbit %.1f x %.1f nmi (report 53.7 x 65.7)' % (158.8 * kL2, math.degrees(pitch2), hp / NMI, ha / NMI))
ev(T_LOI2 + D_LOI2, 'Circular lunar orbit', 'Orbit %.1f x %.1f nmi (model).' % (hp / NMI, ha / NMI))

# ---------------------------------------------------------------- undock, CSM separation, DOI
T_UNDOCK, T_SEP, T_DOI, T_PDI = met(100, 12, 0), met(100, 39, 52.9), met(101, 36, 14), met(102, 33, 5.01)
y, s = prop(y, s[-1].t[-1], T_UNDOCK); TRK['csm'].add(s)
y_lm = y.copy()
y, s = prop(y, T_UNDOCK, T_SEP); TRK['csm'].add(s)
vh, n, h, r, v = frame(T_SEP, y, 'moon'); y = y.copy(); y[3:] += -n * 1.4 * FT       # radial-down separation (direction guess)
y_lm, s = prop(y_lm, T_UNDOCK, T_DOI); TRK['lm'].add(s)
def doi(dv_scale=1.0, pitch=0.0):
    acc = 76.4 * FT * dv_scale / 30.0
    st = steer_angles(-1, pitch, 0.0)
    class B: pass
    b = Burn('DOI', T_DOI, 30.0, 76.4 * FT * dv_scale, 305.0, 10.0, st, central='moon')
    return prop(y_lm, T_DOI, T_PDI, [b])
def rd(x):
    yy, _ = doi(x[0]); hp_, ha_ = lunar_alt_extrema(yy, T_PDI); return [hp_ - 8.5 * NMI]
kD = least_squares(rd, [1.0], diff_step=1e-5, method='trf').x[0]
y_pdi, s = doi(kD); TRK['lm'].add(s)
log('DOI model dV %.1f ft/s (report 76.4)' % (76.4 * kD))
hp, ha = lunar_alt_extrema(y_pdi, T_PDI)
pm = MOON(T_PDI); alt_pdi = np.linalg.norm(y_pdi[:3] - pm) - SITE_R
log('DOI -> LM orbit %.1f x %.1f nmi (report ~8.5 x 57); altitude at PDI %.1f km (report 50,000 ft = 15.2 km)' % (hp / NMI, ha / NMI, alt_pdi))
ps, _ = site_sel(T_PDI); rr = y_pdi[:3] - pm
rng_pdi = math.degrees(math.acos(np.clip(rr @ ps / np.linalg.norm(rr) / np.linalg.norm(ps), -1, 1)))
log('LM to site angle at PDI: %.2f deg (%.0f km)' % (rng_pdi, math.radians(rng_pdi) * R_M))
if '--phase' in sys.argv: sys.exit(0)

# ---------------------------------------------------------------- powered descent: explicit guidance through gates
def guide(y0, t0, waypoints, dt=0.5):
    """linear-acceleration-optimal guidance: a = 6(rf - r - v tgo)/tgo^2 - 2(vf - v)/tgo, thrust = a - gravity."""
    t, yy, out, dv = t0, y0.copy(), [(t0, y0.copy(), np.zeros(3))], 0.0
    for (tf, pos_fn) in waypoints:
        hold = [None]
        while t < tf - 1e-9:
            h = min(dt, tf - t)
            def accel(tt, Y):
                g = rhs_factory([])(tt, Y)[3:]
                if tf - tt < 2.0 and hold[0] is not None: return hold[0], hold[0] - g     # freeze the command for the last 2 s
                rf, vf = pos_fn(tt)
                tgo = tf - tt
                ac = 6 * (rf - Y[:3] - Y[3:] * tgo) / tgo ** 2 - 2 * (vf - Y[3:]) / tgo
                return ac, ac - g
            def f(tt, Y): ac, th = accel(tt, Y); return np.concatenate([Y[3:], ac])
            k1 = f(t, yy); k2 = f(t + h / 2, yy + h / 2 * k1); k3 = f(t + h / 2, yy + h / 2 * k2); k4 = f(t + h, yy + h * k3)
            ac0, th = accel(t, yy); dv += np.linalg.norm(th) * h
            if tf - t >= 2.0: hold[0] = ac0
            yy = yy + h / 6 * (k1 + 2 * k2 + 2 * k3 + k4); t += h
            out.append((t, yy.copy(), accel(t, yy)[1]))
    return out, dv

def gate(t_g, alt, uprange, vh_, vv_, lateral=0.0, vlat=0.0):
    """state relative to the site at time t_g in a local frame: up, downrange (west), cross."""
    def fn(tt):
        p, vs = site_sel(t_g); pm, vm = moon_state(t_g)
        upv = p / np.linalg.norm(p); pole = moon_rot(t_g) @ np.array([0, 0, 1.0])
        wst = -np.cross(pole, upv); wst /= np.linalg.norm(wst); crs = np.cross(upv, wst)
        rf = pm + p + upv * alt - wst * uprange + crs * lateral
        vf = vm + vs + wst * vh_ + upv * vv_ + crs * vlat
        return rf, vf
    return fn

GATES = [
    (met(102, 41, 32), gate(met(102, 41, 32), 7129 * FT, 10.2, 152e-3, -125 * FT)),         # P64 high gate (report alt / sink rate)
    (met(102, 43, 22), gate(met(102, 43, 22), 429 * FT, 0.70, 18e-3, -6e-3)),               # P66 start (radar 429 ft)
    (T_LAND, gate(T_LAND, 0.0, 0.0, 0.0, -1.7 * FT, 0.0, -2.1 * FT)),                       # touchdown: 1.7 ft/s down, 2.1 ft/s left
]
desc, dv_desc = guide(y_pdi, T_PDI, GATES)
log('powered descent: model delta-V %.0f ft/s (report 6930 ft/s incl. hover margin)' % (dv_desc / FT))

# ---------------------------------------------------------------- surface stay, ascent, rendezvous
T_ASC, D_ASC = met(124, 22, 0.79), 434.88
T_CSI, T_CDH, T_TPI, T_TPF, T_DOCK = met(125, 19, 35.5), met(126, 17, 49.6), met(127, 3, 51.8), met(127, 46, 9.8), met(128, 3, 0)
y, s = prop(y, T_SEP, T_DOCK + 600); TRK['csm'].add(s)
csm_track_tmp = Track(); csm_track_tmp.add(s); csm2 = csm_track_tmp
def site_state(t):
    p, vs = site_sel(t); pm, vm = moon_state(t); return np.concatenate([pm + p, vm + vs])
# ascent target: insertion at 60,000 ft, horizontal, speed for a 9.4 x 45 nmi orbit, ~ 13 deg downrange (west)
r_ins = R_M + 60000 * FT; a_ins = (2 * R_M + 9.4 * NMI + 45.2 * NMI) / 2 + 0 * 1
r_peri = R_M + 9.4 * NMI
v_ins = math.sqrt(MU_M * (2 / r_ins - 1 / a_ins))
def ins_gate(tt):
    tg = T_ASC + D_ASC
    p, vs = site_sel(tg); pm, vm = moon_state(tg); upv = p / np.linalg.norm(p)
    # CSM orbit plane at insertion
    yc = csm_track_tmp(tg); hc = np.cross(yc[:3] - pm, yc[3:] - vm); hc /= np.linalg.norm(hc)
    upp = upv - (upv @ hc) * hc; upp /= np.linalg.norm(upp)
    ang = math.radians(INS_ANG[0])     # downrange angle along the CSM direction of motion (solved below)
    w = np.cross(hc, upp)
    pos = r_ins * (math.cos(-ang) * upp + math.sin(-ang) * w)
    vdir = np.cross(hc, pos / np.linalg.norm(pos))
    return pm + pos, vm + vdir * v_ins + 32 * FT * pos / np.linalg.norm(pos)
INS_ANG = [-9.5]
y_asc0 = site_state(T_ASC)
def up_gate(tt):
    p, vs = site_sel(T_ASC + 10); pm, vm = moon_state(T_ASC + 10); u = p / np.linalg.norm(p)
    return pm + p + u * 0.065, vm + vs + u * 0.012
y_csi0 = None
def tpi_cost(csi_fts, want_tpi=False):
    yl_ = y_csi0.copy(); vh_, *_ = frame(T_CSI, yl_, 'moon'); yl_[3:] += vh_ * csi_fts * FT
    yl_, _ = prop(yl_, T_CSI, T_CDH, dense=False)
    pm_, vm_ = moon_state(T_CDH); yc_ = csm2(T_CDH); rl_, vl_ = yl_[:3] - pm_, yl_[3:] - vm_; rc_, vc_ = yc_[:3] - pm_, yc_[3:] - vm_
    dh_ = np.linalg.norm(rc_) - np.linalg.norm(rl_); a_c_ = elements(rc_, vc_, MU_M)[0]; rn_ = np.linalg.norm(rl_)
    uh_ = rl_ / rn_; hl_ = np.cross(rl_, vl_); hl_ /= np.linalg.norm(hl_); th_ = np.cross(hl_, uh_); a_t_ = a_c_ - dh_
    vr_ = (vc_ @ (rc_ / np.linalg.norm(rc_))) * math.sqrt(a_c_ / a_t_); vt_ = math.sqrt(max(MU_M * (2 / rn_ - 1 / a_t_) - vr_ ** 2, 0))
    yl_ = yl_.copy(); yl_[3:] = vr_ * uh_ + vt_ * th_ + vm_
    yl_, _ = prop(yl_, T_CDH, T_TPI, dense=False); pm_, vm_ = moon_state(T_TPI); ycf_ = csm2(T_TPF); pmf_, vmf_ = moon_state(T_TPF)
    pro_ = np.cross(yl_[:3] - pm_, yl_[3:] - vm_)[2] > 0
    if want_tpi:
        v1_, _ = V.lambert(yl_[:3] - pm_, ycf_[:3] - pmf_, T_TPF - T_TPI, mu=MU_M, prograde=pro_)
        return np.linalg.norm(v1_ - (yl_[3:] - vm_))
    return abs(dh_ - 15.0 * NMI)          # coelliptic sequence: LM 15 nmi below the CSM after CDH (report)
def tpi_for_angle(ang):
    global y_csi0
    INS_ANG[0] = ang
    asc, _ = guide(y_asc0, T_ASC, [(T_ASC + 10, up_gate), (T_ASC + D_ASC, ins_gate)], dt=1.0)
    y_csi0, _ = prop(asc[-1][1], T_ASC + D_ASC, T_CSI, dense=False)
    csi = minimize_scalar(tpi_cost, bounds=(0, 150), method='bounded', options=dict(xatol=0.1)).x
    return tpi_cost(csi, True)
_scan = [(tpi_for_angle(a), a) for a in np.arange(-18.0, -5.9, 1.0)]   # keep a realistic ~200-550 km ascent range
_best = min(_scan)[1]
INS_ANG[0] = minimize_scalar(tpi_for_angle, bounds=(max(-18, _best - 1), min(-6, _best + 1)), method='bounded', options=dict(xatol=0.05)).x
log('ascent insertion %.2f deg downrange (solved so the terminal phase works)' % -INS_ANG[0])
ascent, dv_asc = guide(y_asc0, T_ASC, [(T_ASC + 10, up_gate), (T_ASC + D_ASC, ins_gate)])
log('ascent: model delta-V %.0f ft/s (report 6070 ft/s)' % (dv_asc / FT))
y_l = ascent[-1][1]
hp, ha = lunar_alt_extrema(y_l, T_ASC + D_ASC)
log('LM insertion orbit %.1f x %.1f nmi (report 9.4 x 45.2)' % (hp / NMI, ha / NMI))
ev(T_ASC + D_ASC, 'Ascent engine cutoff', 'Orbit %.1f x %.1f nmi (model).' % (hp / NMI, ha / NMI))
# CSM propagated through rendezvous
# CSI: posigrade 51.5 ft/s
yl, s_a = prop(y_l, T_ASC + D_ASC, T_CSI); lm_segs = list(s_a)
y_csi0 = yl.copy()
CSI_FTS = minimize_scalar(tpi_cost, bounds=(0, 150), method='bounded', options=dict(xatol=0.05)).x
log('CSI model %.1f ft/s (report 51.5 ft/s)' % CSI_FTS)
vh, n, h, r, v = frame(T_CSI, yl, 'moon'); yl = yl.copy(); yl[3:] += vh * CSI_FTS * FT
# CDH: make the LM orbit coelliptic (constant height below the CSM) -- solved, compare with 19.9 ft/s
yl, s_b = prop(yl, T_CSI, T_CDH); lm_segs += s_b
pm, vm = moon_state(T_CDH); yc = csm2(T_CDH)
rl, vl = yl[:3] - pm, yl[3:] - vm; rc, vc = yc[:3] - pm, yc[3:] - vm
dh = np.linalg.norm(rc) - np.linalg.norm(rl)
# coelliptic: same eccentricity vector shape -> match radial velocity scaled and horizontal speed for a = a_csm - dh
a_c, e_c, _, _, _ = elements(rc, vc, MU_M)
rn = np.linalg.norm(rl); uhat = rl / rn; hl = np.cross(rl, vl); hl /= np.linalg.norm(hl); that = np.cross(hl, uhat)
a_t = a_c - dh
vr_t = (vc @ (rc / np.linalg.norm(rc))) * math.sqrt(a_c / a_t)
vt_t = math.sqrt(max(MU_M * (2 / rn - 1 / a_t) - vr_t ** 2, 0))
dv_cdh = (vr_t * uhat + vt_t * that) - vl
yl = yl.copy(); yl[3:] += dv_cdh
log('CDH: model %.1f ft/s (report 19.9 ft/s), height difference %.1f nmi (report ~15)' % (np.linalg.norm(dv_cdh) / FT, dh / NMI))
# TPI: Lambert to the CSM (30 m behind) at TPF time; TPF matches velocity
yl, s_c = prop(yl, T_CDH, T_TPI); lm_segs += s_c
pm, vm = moon_state(T_TPI); ycf = csm2(T_TPF); pmf, vmf = moon_state(T_TPF)
pro = np.cross(yl[:3] - pm, yl[3:] - vm)[2] > 0           # Apollo lunar orbits are retrograde in this frame
v1, v2 = V.lambert(yl[:3] - pm, ycf[:3] - pmf - 0.03 * (ycf[3:] - vmf) / np.linalg.norm(ycf[3:] - vmf), T_TPF - T_TPI, mu=MU_M, prograde=pro)
dv_tpi = v1 - (yl[3:] - vm); yl = yl.copy(); yl[3:] = v1 + vm
log('TPI: model %.1f ft/s (report 25.3 ft/s)' % (np.linalg.norm(dv_tpi) / FT))
yl, s_d = prop(yl, T_TPI, T_TPF); lm_segs += s_d
dv_tpf = ycf[3:] - yl[3:]; yl = yl.copy(); yl[3:] = ycf[3:]; yl[:3] = ycf[:3] - 0.03 * dv_tpf * 0 - 0.03 * (ycf[3:] - vmf) / np.linalg.norm(ycf[3:] - vmf)
log('TPF: model %.1f ft/s (report 31.4 ft/s)' % (np.linalg.norm(dv_tpf) / FT))
ev(T_TPI, 'TPI burn', 'Model %.1f ft/s (report 25.3).' % (np.linalg.norm(dv_tpi) / FT))
yl, s_e = prop(yl, T_TPF, T_DOCK); lm_segs += s_e

# ---------------------------------------------------------------- jettison, TEI, return, entry
T_JET, T_FSEP, T_TEI, D_TEI = met(130, 9, 31.2), met(130, 30, 1.0), met(135, 23, 42.3), 151.4
T_MCC5, T_CMSM, T_EI, T_SPLASH = met(150, 29, 57.4), met(194, 49, 12.7), met(195, 3, 5.7), met(195, 18, 35)
y, s = prop(csm2(T_DOCK + 600), T_DOCK + 600, T_JET); TRK['csm'].add(s)
y_asc_lm = y.copy(); vh, n, h, r, v = frame(T_JET, y, 'moon'); y_asc_lm[3:] += -vh * 0.3e-3
y, s = prop(y, T_JET, T_FSEP); TRK['csm'].add(s)
vh, n, h, r, v = frame(T_FSEP, y, 'moon'); y = y.copy(); y[3:] += n * 2.2 * FT       # separation (direction guess)
y, s = prop(y, T_FSEP, T_TEI); TRK['csm'].add(s)
y_tei0 = y.copy()
SPLASH_LAT, SPLASH_LON = math.radians(13.3), math.radians(-169.15)    # 13 deg 19' N, 169 deg 9' W

def gmst_ecl_ecef(t):
    """matrix ecliptic -> Earth-fixed (ECEF) at MET t."""
    M = geo.precession(jd(t))          # J2000 -> date
    g = geo.gmst(JD_UTC0 + t / 86400)
    E = np.array([[1, 0, 0], [0, math.cos(ephem.OBL), -math.sin(ephem.OBL)], [0, math.sin(ephem.OBL), math.cos(ephem.OBL)]])  # ecl->eq
    return geo.R3(g) @ M @ E

def tei_run(params, to=T_EI + 1200, dense=False):
    p, yw, k = params
    b = Burn('TEI', T_TEI, D_TEI, 3279.0 * FT * k, 314.0, 91.19, steer_angles(+1, p, yw), central='moon')
    yy, s1 = prop(y_tei0, T_TEI, T_MCC5, [b], dense=dense)
    yy = sep_dv(T_MCC5, yy, 4.8 * FT, 'pos')
    yy, s2 = prop(yy, T_MCC5, T_EI - 3600, dense=True)
    return yy, s1 + s2
def tei_seed():
    best = None
    for k in (1.0, 1.02, 1.04):
        for p in np.radians(np.arange(-40, 41, 10)):
            for yw in np.radians([-10, 0, 10]):
                try: yy, sols = tei_run([p, yw, k]); tp, rp = earth_ca(sols)
                except Exception: continue
                c = abs(tp - T_EI) / 3600 + abs(rp - R_E - 40) / 1000
                if best is None or c < best[0]: best = (c, [p, yw, k])
    log('TEI seed: pitch %.0f yaw %.0f k %.2f (score %.2f)' % (math.degrees(best[1][0]), math.degrees(best[1][1]), best[1][2], best[0]))
    return np.array(best[1])

def ei_state(sols):
    s = sols[-1]; yy, s3 = prop(s.y[:, -1], s.t[-1], T_EI + 1800)
    f = lambda t: np.linalg.norm(s3[-1].sol(t)[:3]) - (R_E + 400000 * FT)
    tt = np.linspace(s3[-1].t[0], s3[-1].t[-1], 400); fv = [f(x) for x in tt]
    i = next((j for j in range(len(fv) - 1) if fv[j] > 0 >= fv[j + 1]), None)
    if i is None: return None
    te = brentq(f, tt[i], tt[i + 1]); return te, s3[-1].sol(te)

def ei_geo(te, ye):
    r, v = ye[:3], ye[3:]; gam = math.degrees(math.asin(r @ v / np.linalg.norm(r) / np.linalg.norm(v)))
    pe = gmst_ecl_ecef(te) @ r; lat = math.degrees(math.asin(pe[2] / np.linalg.norm(pe))); lon = math.degrees(math.atan2(pe[1], pe[0]))
    return gam, lat, lon

GAMMA_EI = -6.48                                   # entry flight-path angle (approx)
EI_TARGET_LAT = 0.0                                # updated after an entry simulation (see below)
def earth_ca(sols):
    s = sols[-1]; yy, s3 = prop(s.y[:, -1], s.t[-1], T_EI + 30 * 3600)
    f = lambda t: np.linalg.norm(s3[-1].sol(t)[:3])
    r = minimize_scalar(f, bounds=(s3[-1].t[0], s3[-1].t[-1]), method='bounded'); return r.x, r.fun
def resid_tei(x):
    yy, sols = tei_run(x)
    r = ei_state(sols)
    if r is None:       # smooth fallback: steer the vacuum perigee toward ~40 km altitude at the right time
        tp, rp = earth_ca(sols); return np.array([(tp - T_EI) / 120.0, (rp - (R_E + 40)) / 20.0, 0.0])
    te, ye = r; gam, lat, lon = ei_geo(te, ye)
    return np.array([(te - T_EI) / 20.0, (gam - GAMMA_EI) / 0.05, (lat - EI_TARGET_LAT) / 0.2])

# ---------------------------------------------------------------- entry simulation (lifting capsule, L/D 0.3)
OMEGA_E = 7.2921159e-5
POLE_ECL = geo.ecl_from_eq(np.array([0, 0, 1.0]))
def entry_sim(te, ye, bank_deg, dt=0.5):
    beta, LD = 358.0, 0.30                  # kg/m^2, lift-to-drag at trim (approx)
    t, y = te, ye.copy(); out = [(t, y.copy(), 'entry')]; phase = 'entry'
    sb = math.radians(bank_deg)
    def f(t, y, phase):
        r, v = y[:3], y[3:]; rn = np.linalg.norm(r); h = rn - R_E
        vr = v - np.cross(POLE_ECL * OMEGA_E, r); vn = np.linalg.norm(vr)
        rho = 1.225 * math.exp(-max(h, 0) / 7.2)
        b = {'entry': beta, 'drogue': 95.0, 'main': 4.8}[phase]; ld = LD if phase == 'entry' else 0.0
        D = 0.5 * rho * (vn * 1000) ** 2 / b / 1000.0           # km/s^2
        vh = vr / vn; upp = r / rn - (r / rn @ vh) * vh; upp /= np.linalg.norm(upp); side = np.cross(vh, upp)
        lift = ld * D * (math.cos(sb) * upp + math.sin(sb) * side)
        a = -MU_E * r / rn ** 3 - D * vh + lift
        return np.concatenate([v, a])
    while True:
        h = np.linalg.norm(y[:3]) - R_E
        if phase == 'entry' and h < 23300 * FT: phase = 'drogue'; out.append((t, y.copy(), 'drogue'))
        if phase == 'drogue' and h < 10500 * FT: phase = 'main'; out.append((t, y.copy(), 'main'))
        if h <= 0: break
        st = dt if h > 0.05 else 0.05
        k1 = f(t, y, phase); k2 = f(t + st / 2, y + st / 2 * k1, phase); k3 = f(t + st / 2, y + st / 2 * k2, phase); k4 = f(t + st, y + st * k3, phase)
        y = y + st / 6 * (k1 + 2 * k2 + 2 * k3 + k4); t += st
        out.append((t, y.copy(), phase))
    return out

def latlon(t, r):
    pe = gmst_ecl_ecef(t) @ r; return math.degrees(math.asin(pe[2] / np.linalg.norm(pe))), math.degrees(math.atan2(pe[1], pe[0]))

def gc_dist(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    return R_E * math.acos(np.clip(math.sin(la1) * math.sin(la2) + math.cos(la1) * math.cos(la2) * math.cos(lo1 - lo2), -1, 1))

if __name__ == '__main__':
    target = (math.degrees(SPLASH_LAT), math.degrees(SPLASH_LON))
    lat_t = target[0]
    def perigee(x):
        yy, sols = tei_run(x); tp, rp = earth_ca(sols)
        s = sols[-1]; yy2, s3 = prop(s.y[:, -1], s.t[-1], tp + 1); la_, lo_ = latlon(tp, s3[-1].sol(tp)[:3]); return tp, rp, la_, lo_, sols
    x = tei_seed()
    for it in range(4):
        def _rf(x):
            tp, rp, la_, lo_, _ = perigee(x); return np.array([(tp - T_EI) / 120.0, (rp - (R_E + 40)) / 20.0, 0.0])
        x = least_squares(_rf, x, diff_step=1e-6, x_scale=[1e-2, 1e-2, 1e-3], method='trf', max_nfev=60).x
        tp, rp, la_, lo_, sols = perigee(x); te, ye = ei_state(sols)
        best = min(((gc_dist(latlon(o[-1][0], o[-1][1][:3]), target), b, o) for b in range(0, 181, 5) for o in [entry_sim(te, ye, b)]), key=lambda q: q[0])
        miss, bank, out = best; la, lo = latlon(out[-1][0], out[-1][1][:3])
        log('TEI iter %d: dv %.0f ft/s (report 3279), pitch %.1f yaw %.1f, perigee lat target %.2f, bank %d deg, splash %.2fN %.2fE, miss %.0f km, splash MET %.3f h' %
            (it, x[2] * 3279, math.degrees(x[0]), math.degrees(x[1]), lat_t, bank, la, lo, miss, out[-1][0] / 3600))
        break
    pickle.dump(dict(tei=x, bank=bank), open(SCR + 'apollo_tei.pkl', 'wb'))
