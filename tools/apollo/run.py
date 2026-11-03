import sys
sys.path.insert(0, '/home/user/voxel-art/tools/apollo')
from solve import *

# ---------------------------------------------------------------- 1. parking orbit insertion
PAD_LAT, PAD_LON = 28.6082, -80.6041                       # LC-39A
T_LIFT = 0.6; T_INS = met(0, 11, 49.3)
INC = math.radians(32.521)                                  # parking-orbit inclination (approx)
R_PARK = R_E + 184.6                                        # 100.4 x 98.9 nmi parking orbit, taken as circular (approx)
pad_eq = geo.site_vec_eq(PAD_LAT, PAD_LON, JD_UTC0 + T_LIFT / 86400, jd(T_LIFT))
ph = pad_eq / np.linalg.norm(pad_eq)
east = np.cross([0, 0, 1.0], ph); east /= np.linalg.norm(east); north = np.cross(ph, east)
sinA = math.cos(INC) / math.sqrt(1 - ph[2] ** 2)            # inertial azimuth giving the inclination
A = math.asin(min(1, sinA)); tang = math.cos(A) * north + math.sin(A) * east
n_eq = np.cross(ph, tang); n_eq /= np.linalg.norm(n_eq)
TH_INS = 0.415                                              # downrange angle at insertion (rad, stylised ascent)
xh, yh = ph, np.cross(n_eq, ph)
r_ins = R_PARK * (math.cos(TH_INS) * xh + math.sin(TH_INS) * yh)
v_ins = math.sqrt(MU_E / R_PARK) * (-math.sin(TH_INS) * xh + math.cos(TH_INS) * yh)
Y_INS = np.concatenate([geo.ecl_from_eq(r_ins), geo.ecl_from_eq(v_ins)])
log('inertial launch azimuth %.2f deg' % math.degrees(A))

# ---------------------------------------------------------------- 2. TLI targeting
T_TLI, D_TLI, DV_TLI = met(2, 44, 16.2), 347.3, 10441.0 * FT
T_EVA_SEP = met(4, 40, 1.8)
T_MCC2 = met(26, 44, 58.7)
T_LOI1, D_LOI1, DV_LOI1 = met(75, 49, 50.4), 357.5, 2917.5 * FT
T_PERI = T_LOI1 + D_LOI1 / 2
T_LAND = met(102, 45, 39.9)
RP_TARGET = R_M + 60.0 * NMI                                # pericynthion before LOI (approx 60 nmi)

def sep_dv(t, y, mag, kind):
    vh, n, h, r, v = frame(t, y, 'earth')
    d = {'pos': vh, 'out': n}[kind]
    y = y.copy(); y[3:] += mag * d; return y

def coast_to_moon(params, want_sols=False):
    p, yw, k = params
    tli = Burn('TLI', T_TLI, D_TLI, DV_TLI * k, 421.0, 863.0, steer_angles(+1, p, yw))
    y, s1 = prop(Y_INS, T_INS, T_EVA_SEP, [tli], dense=want_sols)
    y_sivb = y.copy()
    y = sep_dv(T_EVA_SEP, y, 19.7 * FT, 'out')              # evasive SPS burn away from the S-IVB (direction guess)
    y, s2 = prop(y, T_EVA_SEP, T_MCC2, dense=want_sols)
    y = sep_dv(T_MCC2, y, 20.9 * FT, 'pos')                 # MCC-2 (direction guess)
    y, s3 = prop(y, T_MCC2, T_LOI1 - 1800, dense=True)
    return y, (s1 + s2 + s3), y_sivb

def moon_ca(sols):
    s = sols[-1]
    f = lambda t: np.linalg.norm(s.sol(t)[:3] - MOON(t))
    r = minimize_scalar(f, bounds=(s.t[0], s.t[-1]), method='bounded', options=dict(xatol=1e-2))
    return r.x, r.fun

# target plane: at landing, the orbit runs east-to-west over the site (Apollo flew retrograde, sun behind)
ps_land, _ = site_sel(T_LAND)
up = ps_land / np.linalg.norm(ps_land)
pole_m = moon_rot(T_LAND) @ np.array([0, 0, 1.0])
west = -np.cross(pole_m, up); west /= np.linalg.norm(west)
N_TARGET = np.cross(up, west); N_TARGET /= np.linalg.norm(N_TARGET)

def resid_tli(params):
    y, sols, _ = coast_to_moon(params)
    # propagate the free hyperbola to its closest approach (extend coast)
    y2, s4 = prop(y, T_LOI1 - 1800, T_LOI1 + 3600)
    tc, rc = moon_ca(s4)
    yc = s4[-1].sol(tc); pm, vm = moon_state(tc); r, v = yc[:3] - pm, yc[3:] - vm
    hh = np.cross(r, v); hh /= np.linalg.norm(hh)
    return np.array([(rc - RP_TARGET) / 2.0, (tc - T_PERI) / 30.0, *(10 * (hh - N_TARGET))])

if __name__ == '__main__':
    x0 = np.array([0.0, 0.0, 1.0])
    r = least_squares(resid_tli, x0, diff_step=1e-6, x_scale=[1e-3, 1e-3, 1e-3], method='lm', max_nfev=80)
    log('TLI fit: pitch %.3f deg, yaw %.3f deg, dv scale %.4f (=> %.1f ft/s vs report 10441), resid %s' %
        (math.degrees(r.x[0]), math.degrees(r.x[1]), r.x[2], r.x[2] * 10441, np.round(r.fun, 3)))
    pickle.dump(dict(tli=r.x), open(SCR + 'apollo_tli.pkl', 'wb'))
