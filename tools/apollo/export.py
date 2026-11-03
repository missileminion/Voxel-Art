"""Export Apollo 11 viewer data to apollo11/data/.  Frame: geocentric ecliptic J2000, km, km/s; t = MET seconds."""
import sys, re
sys.path.insert(0, '/home/user/voxel-art/tools/apollo')
import mission as MS
from mission import *
from scipy.interpolate import PchipInterpolator

OUT = '/home/user/voxel-art/apollo11/data/'; os.makedirs(OUT, exist_ok=True)
TIMELINE = '/root/.claude/uploads/2a823091-dce1-502f-bc76-a75fc34c2a87/cbecef51-Apollo_11_Timeline_XYZ_Attitude_1.txt'

# ---------------------------------------------------------------- return leg (TEI fit + entry)
T = pickle.load(open(SCR + 'apollo_tei.pkl', 'rb'))
MS.EI_TARGET_LAT = 0.0
x = T['tei']
yy, sols_ret = tei_run(x, dense=True)
te, ye = ei_state(sols_ret)
y_last, s_tail = prop(sols_ret[-1].y[:, -1], sols_ret[-1].t[-1], te)
entry = entry_sim(te, ye, T['bank'])
CHUTES = {o[2]: o[0] for o in entry if o[2] in ('drogue', 'main') and True}
T_DROGUE = next(o[0] for o in entry if o[2] == 'drogue'); T_MAIN = next(o[0] for o in entry if o[2] == 'main')
T_SPL = entry[-1][0]
la, lo = latlon(T_SPL, entry[-1][1][:3])
log('splash model %.2fN %.2fE at %s (report 13.30N 169.15W at 195:18:35)' % (la, lo, T_SPL / 3600))

# ---------------------------------------------------------------- node writer
def nodes_from_track(trk, t0, t1, step_fn):
    out, t = [], t0
    while t < t1:
        y = trk(t); out.append([t, *y]); t += step_fn(t, y)
    out.append([t1, *trk(t1)]); return out
def step_default(t, y):
    pm = MOON(t); r_e = np.linalg.norm(y[:3]); r_m = np.linalg.norm(y[:3] - pm)
    tdyn = min(math.sqrt(r_e ** 3 / MU_E), math.sqrt(r_m ** 3 / MU_M))
    return float(np.clip(0.004 * tdyn, 1.0, 600.0))

# ascent (stylised): from the pad to the parking-orbit insertion state used by the solver
ALT = PchipInterpolator([0, 30, 60, 90, 120, 161.7, 200, 300, 400, 548, 600, T_INS],
                        [0, 0.008, 0.04, 0.10, 0.18, 0.36, 0.51, 0.76, 0.89, 0.955, 0.975, 1.0])
r0 = np.linalg.norm(pad_eq)
def _fixed_to_inertial(t):   # Earth-fixed -> equatorial J2000 at MET t (same model as geo.site_vec_eq)
    return geo.precession(jd(t)).T @ geo.R3(-geo.gmst(JD_UTC0 + t / 86400))
_pf = _fixed_to_inertial(T_LIFT).T @ (pad_eq / r0)                       # pad direction, Earth-fixed
import run as _RN
_ef = _fixed_to_inertial(T_INS).T @ (_RN.r_ins / np.linalg.norm(_RN.r_ins))     # insertion point direction, Earth-fixed
# downrange fraction: ~0 for the tower-clearing climb, ~3 km at 60 s, ~94 km at S-IC cutoff (Apollo 11 51 nmi)
DR = PchipInterpolator([0, 10, 20, 30, 60, 90, 120, 161.7, 200, 300, 400, 548, 600, T_INS],
                       [0, 0, 1e-5, 1.2e-4, 1.1e-3, 4.5e-3, 1.2e-2, 0.035, 0.062, 0.15, 0.28, 0.55, 0.67, 1.0])
_S = math.acos(float(np.clip(_pf @ _ef, -1, 1)))
def ascent_pos(t):
    # defined over the rotating Earth, so the vehicle rises straight off the pad (it already carries the
    # pad's eastward velocity) and pitches downrange along the ground track to the solver's insertion point
    tau = min(max(t / T_INS, 0), 1)
    r = r0 + (R_PARK - r0) * float(ALT(min(max(t, 0), T_INS)))
    a = _S * float(DR(min(max(t, 0), T_INS)))
    d = (math.sin(_S - a) * _pf + math.sin(a) * _ef) / math.sin(_S)
    return geo.ecl_from_eq(_fixed_to_inertial(t) @ (d / np.linalg.norm(d) * r))
log('ascent ground track %.0f km to insertion, %.1f km at S-IC cutoff' % (_S * r0, _S * r0 * float(DR(161.7))))
csm_nodes = []
for t in np.arange(-120.0, T_INS, 1.0):
    p = ascent_pos(t); v = (ascent_pos(t + 0.25) - ascent_pos(t - 0.25)) / 0.5
    csm_nodes.append([t, *p, *v])
TRK['csm'].segs.sort(key=lambda s: s.t[0])
t_a, t_b = TRK['csm'].range()
csm_nodes += nodes_from_track(TRK['csm'], T_INS, T_TEI, step_default)
ret = Track(); ret.add(sols_ret + s_tail)
csm_nodes += nodes_from_track(ret, T_TEI + 1, te, step_default)[1:]
for o in entry[1:]:
    if o[0] - csm_nodes[-1][0] >= 0.5: csm_nodes.append([o[0], *o[1]])
# LM: undock -> PDI (track), powered descent (guidance), surface, ascent, rendezvous, docked, jettisoned ascent stage
lm_nodes = nodes_from_track(TRK['lm'], T_UNDOCK, T_PDI, step_default)
lm_nodes += [[t, *y] for (t, y, th) in desc[1:]]
for t in np.arange(T_LAND + 1, T_ASC, 60.0): lm_nodes.append([t, *site_state(t)])
lm_nodes += [[t, *y] for (t, y, th) in ascent[1:]]
lmt = Track(); lmt.add(lm_segs)
lm_nodes += nodes_from_track(lmt, T_ASC + D_ASC + 0.5, T_DOCK, step_default)[1:]
cs = Track(); cs.segs = TRK['csm'].segs
for t in np.arange(T_DOCK + 30, T_JET, 60.0): lm_nodes.append([t, *cs(t)])
yj, sj = prop(y_asc_lm, T_JET, T_JET + 6 * 3600); jt = Track(); jt.add(sj)
lm_nodes += nodes_from_track(jt, T_JET, T_JET + 6 * 3600, step_default)
sv = TRK['sivb']; sivb_nodes = nodes_from_track(sv, T_EVA_SEP, T_EVA_SEP + 10 * 3600 - 1, step_default)
# S-IVB before the evasive burn shares the stack/CSM path
def dedupe(nodes):
    out = []
    for n in sorted(nodes, key=lambda q: q[0]):
        if not out or n[0] - out[-1][0] > 1e-3: out.append(n)
    return out
tracks = {'csm': dedupe(csm_nodes), 'lm': dedupe(lm_nodes), 'sivb': dedupe(sivb_nodes)}
blob = b''; index = {}
for k, nodes in tracks.items():
    a = np.array(nodes, '<f8'); index[k] = dict(offset=len(blob), count=len(a)); blob += a.tobytes()
open(OUT + 'tracks.bin', 'wb').write(blob)
log('tracks', {k: len(v) for k, v in tracks.items()}, '%.1f MB' % (len(blob) / 1e6))

# ---------------------------------------------------------------- thrust directions (attitude during burns)
def thrust_samples(burn, dt=1.0, track=None):
    ts = np.arange(burn.t0, burn.t0 + burn.dur + 1e-6, dt); out = []
    for t in ts:
        y = track(t); out.append(list(burn.steer(t, y, burn)))
    return dict(t0=burn.t0, dt=dt, dur=burn.dur, v=np.round(np.array(out), 5).ravel().tolist())
csmT = Track(); csmT.segs = TRK['csm'].segs
thrust = {'TLI': thrust_samples(tli, 1.0, csmT), 'LOI1': thrust_samples(b1, 1.0, csmT)}
b2 = Burn('LOI2', T_LOI2, D_LOI2, DV_LOI2 * kL2, 314.0, 91.19, steer_angles(-1, pitch2, 0.0), central='moon'); thrust['LOI2'] = thrust_samples(b2, 1.0, csmT)
bt = Burn('TEI', T_TEI, D_TEI, 3279.0 * FT * x[2], 314.0, 91.19, steer_angles(+1, x[0], x[1]), central='moon'); thrust['TEI'] = thrust_samples(bt, 1.0, ret)
def guided(samples, t0, dur, dt=1.0):
    ts = np.arange(t0, t0 + dur + 1e-6, dt); tt = np.array([s[0] for s in samples]); vv = np.array([s[2] for s in samples])
    out = []
    for t in ts:
        i = int(np.clip(np.searchsorted(tt, t), 1, len(tt) - 1)); v = vv[i]; n = np.linalg.norm(v); out.append(list(v / n if n > 0 else [0, 0, 1]))
    return dict(t0=t0, dt=dt, dur=dur, v=np.round(np.array(out), 5).ravel().tolist())
thrust['PDI'] = guided(desc, T_PDI, T_LAND - T_PDI); thrust['ASC'] = guided(ascent, T_ASC, D_ASC)
lmT = Track(); lmT.segs = TRK['lm'].segs
bd = Burn('DOI', T_DOI, 30.0, 76.4 * FT, 305.0, 10.0, steer_angles(-1, 0.0, 0.0), central='moon'); thrust['DOI'] = thrust_samples(bd, 1.0, lmT)

# ---------------------------------------------------------------- bodies & lunar orientation
def block(fn, t0, t1, dt):
    ts = np.arange(t0, t1 + dt, dt); P = np.array([fn(t)[0] for t in ts]); Vv = np.array([fn(t)[1] for t in ts])
    return np.concatenate([[ts[0], dt, len(ts)], np.hstack([P, Vv]).ravel()]).astype('<f8')
dsun = SUN.derivative()
blocks = {'moon': block(moon_state, -3600, T_SPL + 7200, 600.0), 'sun': block(lambda t: (SUN(t), dsun(t)), -3600, T_SPL + 7200, 3600.0)}
bb = b''; bidx = {}
for k, a in blocks.items(): bidx[k] = dict(offset=len(bb), count=int(a[2])); bb += a.tobytes()
open(OUT + 'bodies.bin', 'wb').write(bb)
from scipy.spatial.transform import Rotation
mq = [list(np.round(Rotation.from_matrix(moon_rot(t)).as_quat(), 8)) for t in np.arange(-3600, T_SPL + 7200, 600.0)]

# ---------------------------------------------------------------- events: the user's report timeline + derived results
events = []
for line in open(TIMELINE, encoding='utf-8'):
    m = re.match(r'^(\d{2,3}):(\d{2}):(\d{2}(?:\.\d+)?)\s*\|\s*(.+?)\s*\|\s*(PDF[^|]*)$', line.strip())
    if not m: continue
    t = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    title = m.group(4).strip(); tag = 'derived' if 'DERIVED' in title else 'sourced'
    title = re.sub(r'\s*\[(DERIVED|EXACT tabulated)[^\]]*\]', '', title)
    events.append(dict(t=t, title=title, text=m.group(5).strip().replace('PDF', 'Mission Report PDF'), tag=tag))
events += EV
events += [dict(t=T_DROGUE, title='Drogue parachutes', text='Model: 23,300 ft.', tag='approx'),
           dict(t=T_MAIN, title='Main parachutes', text='Model: 10,500 ft.', tag='approx'),
           dict(t=met(3, 19, 30), title='CSM turns around', text='Transposition: 180 deg pitch before docking.', tag='approx'),
           dict(t=met(10, 0, 0), title='Passive thermal control', text='Slow "barbecue" roll, about 3 revolutions per hour.', tag='approx')]
events.sort(key=lambda e: e['t'])

# LM descent gimbal data (inner X) from the user's file, for the HUD
gim = []
for line in open(TIMELINE, encoding='utf-8'):
    m = re.match(r'^(102):(\d{2}):(\d{2}\.\d+)\s+([+-]\d+\.\d+)\s+([+-]\d+\.\d+)\s+([+-]\d+\.\d+)\s+(\d+\.\d+)$', line.strip())
    if m: gim.append([int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)), float(m.group(4)), float(m.group(5)), float(m.group(6)), float(m.group(7))])

# delta-V directions of the impulsive RCS burns (unit vectors, scene frame) so the viewer fires the right jets
_un = lambda a: [float(x) for x in (np.asarray(a) / np.linalg.norm(a))]
dvdir = dict(CSI=_un(frame(T_CSI, lmt(T_CSI - 0.5), 'moon')[0]), CDH=_un(MS.dv_cdh), TPI=_un(MS.dv_tpi), TPF=_un(MS.dv_tpf))
meta = dict(jd_utc0=JD_UTC0, utc0='1969-07-16T13:32:00Z', tracks=index, bodies=bidx, moon_q=dict(t0=-3600, dt=600.0, q=mq),
            site_bf=list(SITE_BF), site_lat=0.67408, site_lon=23.47297, pad=[PAD_LAT, PAD_LON],
            t=dict(liftoff=0.6, ins=T_INS, tli=T_TLI, tde=met(3, 17, 4.6), dock1=met(3, 24, 3.1), eject=met(4, 16, 59.1), evasive=T_EVA_SEP,
                   loi1=T_LOI1, loi2=T_LOI2, undock=T_UNDOCK, sep=T_SEP, doi=T_DOI, pdi=T_PDI, yaw0=met(102, 36, 57), yaw1=met(102, 37, 59),
                   land=T_LAND, hatch_open=met(109, 7, 33), step=met(109, 24, 15), hatch_close=met(111, 39, 13), asc=T_ASC, asc_end=T_ASC + D_ASC,
                   tpi=T_TPI, tpf=T_TPF, dock2=T_DOCK, jet=T_JET, fsep=T_FSEP, tei=T_TEI, cmsm=T_CMSM, ei=te, drogue=T_DROGUE, main=T_MAIN,
                   splash=T_SPL, les=met(0, 3, 17.9), sic_off=met(0, 2, 41.7), sii_on=met(0, 2, 43.0), sii_off=met(0, 9, 8.3),
                   sivb_on=met(0, 9, 12.2), sivb_off=met(0, 11, 39.3), tli_off=T_TLI + D_TLI, mcc2=T_MCC2, mcc5=T_MCC5),
            burns=dict(TLI=[T_TLI, D_TLI], LOI1=[T_LOI1, D_LOI1], LOI2=[T_LOI2, D_LOI2], DOI=[T_DOI, 30.0], PDI=[T_PDI, T_LAND - T_PDI + 1.5],
                       ASC=[T_ASC, D_ASC], TEI=[T_TEI, D_TEI], MCC2=[T_MCC2, 3.1], MCC5=[T_MCC5, 11.2], SEP=[T_SEP, 5.2], EVA=[T_EVA_SEP, 2.9],
                       CSI=[T_CSI, 47.0], CDH=[T_CDH, 17.8], TPI=[T_TPI, 22.7], TPF=[T_TPF, 28.4], FSEP=[T_FSEP, 7.2]),
            thrust=thrust, dvdir=dvdir, events=events, gimbal=gim, entry_bank=T['bank'], log=LOG)
json.dump(meta, open(OUT + 'apollo.json', 'w'), separators=(',', ':'))
log('wrote apollo.json with %d events' % len(events))
