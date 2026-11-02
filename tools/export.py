"""Export viewer data: app/data/{voyager.bin, bodies.bin, mission.json}.

All positions: km, barycentric, ecliptic J2000.  Time: seconds from JD_REF (TDB).
Binary layout (little-endian Float64):
  voyager.bin  : N x [t, x, y, z, vx, vy, vz]
  bodies.bin   : per body block [t0, dt, n, then n x (x y z vx vy vz)]   (offsets listed in mission.json)
"""
import sys, os, json, pickle, numpy as np
sys.path.insert(0, '/home/user/voxel-art/tools')
import optimize as O
from optimize import C, J, ENC, V, unit, jd_l, pole_ecl, log
import geo, launch, nbody

OUT = '/home/user/voxel-art/app/data/'; SCR = O.SCR
F = pickle.load(open(SCR + 'final.pkl', 'rb'))
def T(utc): return (O.JD(*utc) - J)*86400.0
JD_END = O.JD(2049, 12, 30)
T_LIFT = (jd_l - J)*86400.0

# --------------------------------------------------------------- spacecraft dense solution
segs = []
for t0, y0, t1 in F['segments']:
    segs.append(C.prop(np.array(y0), t0, t1, rtol=1e-12))
def sc(t):
    for s in segs:
        if s.t[0] <= t <= s.t[-1]: return s.sol(t)
    return segs[-1].sol(t)
GMB = np.array([V.GM[b] for b in nbody.BODIES])
RADB = np.array([696000, 2440, 6052, 6378, 1737, 3396, 71492, 60268, 25559, 24764])
def step_for(t, y):
    P = C.cs(J + t/86400.0)
    d = np.maximum(np.linalg.norm(P - y[:3], axis=1), RADB)
    tdyn = np.sqrt(d**3/GMB)
    return float(np.clip(0.01*tdyn.min(), 2.0, 2*86400.0))

nodes = []
# launch phase (stylised, see launch.py)
dp = launch.Departure(launch.V.jd_from_utc(1977, 8, 20, 14, 29, 44), jd_l)
G = dp.build(F['V_INJ'])
def earth_state(t):
    pe, ve = C.pl('earth', J + t/86400.0); return pe, ve
def push_geo(t_rel, pos_eq, vel_eq):
    t = T_LIFT + t_rel; pe, ve = earth_state(t)
    nodes.append([t, *(pe + geo.ecl_from_eq(pos_eq)), *(ve + geo.ecl_from_eq(vel_eq))])
for tr in np.arange(0.0, G['t_ins'], 1.0):
    p0 = dp.ascent_state(G, tr); p1 = dp.ascent_state(G, tr + 0.25); pm = dp.ascent_state(G, max(tr - 0.25, 0))
    v = (p1 - pm)/(0.25 + min(tr, 0.25))
    push_geo(tr, p0, v)
for tr in np.arange(0.0, G['t_coast'], 10.0):
    p, v = dp.coast_state(G, tr); push_geo(G['t_ins'] + tr, p, v)
for tr in np.arange(0.0, G['t_burn'], 1.0):
    p, v = dp.burn_state(G, tr); push_geo(G['t_ins'] + G['t_coast'] + tr, p, v)
t = segs[0].t[0]; t_end = segs[-1].t[-1]
while t < t_end:
    y = sc(t); nodes.append([t, *y]); t += step_for(t, y)
nodes.append([t_end, *sc(t_end)])
nodes = np.array(nodes, dtype='<f8')
nodes.tofile(OUT + 'voyager.bin')
log('voyager nodes', len(nodes), 'size %.1f MB' % (nodes.nbytes/1e6))

# --------------------------------------------------------------- bodies
BODY_STEP = dict(sun=8, mercury=2, venus=4, earth=1, moon=0.0625, mars=8, jupiter=8, saturn=16, uranus=32, neptune=32)
blobs = []; index = {}; off = 0
t0b = T_LIFT - 86400.0
dcs = C.cs.derivative()
for b, stp in BODY_STEP.items():
    i = nbody.BODIES.index(b)
    t1b = (T_LIFT + 60*86400.0) if b == 'moon' else (JD_END - J)*86400.0 - 86400.0
    dt = stp*86400.0
    ts = np.arange(t0b, t1b, dt); jd = J + ts/86400.0
    P = C.cs(jd)[:, i, :]; Vv = dcs(jd)[:, i, :]/86400.0
    blk = np.concatenate([[ts[0], dt, len(ts)], np.hstack([P, Vv]).ravel()]).astype('<f8')
    index[b] = dict(offset=off, count=len(ts)); off += blk.nbytes; blobs.append(blk)
open(OUT + 'bodies.bin', 'wb').write(b''.join(x.tobytes() for x in blobs))
log('bodies.bin %.1f MB' % (off/1e6))

# --------------------------------------------------------------- physical data
def pole(n): return [float(x) for x in pole_ecl(n)] if n in O.POLE else None
POLES_EQ = dict(sun=(286.13, 63.87), mercury=(281.01, 61.42), venus=(272.76, 67.16), earth=(0.0, 90.0), moon=(266.86, 65.64),
                mars=(317.68, 52.89), jupiter=(268.057, 64.495), saturn=(40.589, 83.537), uranus=(257.311, -15.175), neptune=(299.36, 43.46))
def pole_vec(n):
    ra, de = np.radians(POLES_EQ[n])
    return [float(x) for x in geo.ecl_from_eq(np.array([np.cos(de)*np.cos(ra), np.cos(de)*np.sin(ra), np.sin(de)]))]
PLANETS = {   # radius eq/polar km, rotation h (negative = retrograde), geometric albedo
 'sun': dict(r=696000, rp=696000, rot=609.12, alb=1.0),
 'mercury': dict(r=2440.5, rp=2438.3, rot=1407.6, alb=0.142), 'venus': dict(r=6051.8, rp=6051.8, rot=-5832.5, alb=0.689),
 'earth': dict(r=6378.1, rp=6356.8, rot=23.9345, alb=0.434), 'moon': dict(r=1737.4, rp=1736.0, rot=655.72, alb=0.12),
 'mars': dict(r=3396.2, rp=3376.2, rot=24.6229, alb=0.170), 'jupiter': dict(r=71492, rp=66854, rot=9.925, alb=0.538),
 'saturn': dict(r=60268, rp=54364, rot=10.656, alb=0.499), 'uranus': dict(r=25559, rp=24973, rot=-17.24, alb=0.488),
 'neptune': dict(r=24764, rp=24341, rot=16.11, alb=0.442)}
for k in PLANETS: PLANETS[k]['pole'] = pole_vec(k); PLANETS[k]['gm'] = V.GM[k]

# --------------------------------------------------------------- moons (placed from the trajectory)
# (planet, name, a km, radius km, albedo, Voyager 2 closest-approach distance km [approx, from memory] or None)
MOONS = [
 ('jupiter', 'Amalthea', 181366, 83.5, 0.09, 558370), ('jupiter', 'Io', 421700, 1821.6, 0.63, 1129900),
 ('jupiter', 'Europa', 671034, 1560.8, 0.67, 205720), ('jupiter', 'Ganymede', 1070412, 2634.1, 0.43, 62130),
 ('jupiter', 'Callisto', 1882709, 2410.3, 0.22, 214930),
 ('saturn', 'Mimas', 185539, 198.2, 0.96, 309990), ('saturn', 'Enceladus', 237948, 252.1, 1.0, 87010),
 ('saturn', 'Tethys', 294619, 531.1, 0.80, 93010), ('saturn', 'Dione', 377396, 561.4, 0.55, 502250),
 ('saturn', 'Rhea', 527108, 763.8, 0.95, 645260), ('saturn', 'Titan', 1221870, 2574.7, 0.22, 666190),
 ('saturn', 'Hyperion', 1481010, 135.0, 0.30, 470840), ('saturn', 'Iapetus', 3560820, 734.5, 0.25, 909070),
 ('uranus', 'Miranda', 129390, 235.8, 0.32, 29000), ('uranus', 'Ariel', 191020, 578.9, 0.53, 127000),
 ('uranus', 'Umbriel', 266300, 584.7, 0.26, 325000), ('uranus', 'Titania', 435910, 788.4, 0.35, 365200),
 ('uranus', 'Oberon', 583520, 761.4, 0.31, 470600),
 ('neptune', 'Proteus', 117647, 210.0, 0.10, None), ('neptune', 'Triton', 354759, 1353.4, 0.76, 39800),
]
moons_out = []
def basis(pole):
    z = np.array(pole); x = unit(np.cross([0, 0, 1.0], z)) if abs(z[2]) < 0.999 else np.array([1.0, 0, 0]); y = np.cross(z, x)
    return x, y, z
for planet, name, a, rad, alb, dist in MOONS:
    te = (ENC[planet]['jd'] - J)*86400.0; GMp = V.GM[planet]
    n = np.sqrt(GMp/a**3)
    span = max(4.0, min(12.0, 3*a/1e6*1.5))*86400.0
    ts = np.arange(te - span, te + span, 120.0)
    pl = C.cs(J + ts/86400.0)[:, nbody.BODIES.index(planet), :]
    Vrel = np.array([sc(t)[:3] for t in ts]) - pl
    x, y, z = basis(PLANETS[planet]['pole'])
    retro = (name == 'Triton')
    incl_opts = [None]
    best = None
    nodes_try = np.radians(np.arange(0, 360, 5)) if retro else [0.0]
    for Om in nodes_try:
        if retro:   # Triton: retrograde, 156.865 deg to Neptune's equator, node free (guess)
            inc = np.radians(156.865)
            xn = x*np.cos(Om) + y*np.sin(Om); yn0 = -x*np.sin(Om) + y*np.cos(Om)
            e1 = xn; e2 = yn0*np.cos(inc) + z*np.sin(inc)
        else:
            e1, e2 = x, y
        phis = np.radians(np.arange(0, 360, 0.5))
        ang = phis[:, None] + n*(ts - te)[None, :]
        P = a*(np.cos(ang)[..., None]*e1 + np.sin(ang)[..., None]*e2)
        Dm = np.linalg.norm(P - Vrel[None], axis=2)
        k = Dm.argmin(axis=1); dmin = Dm[np.arange(len(phis)), k]; tca = ts[k]
        if dist is None:
            score = np.abs(phis - np.radians(137.0))      # arbitrary phase (guess)
        else:
            want_t = te + 5.1*3600 if retro else te
            score = np.abs(dmin - dist)/dist*50 + np.abs(tca - want_t)/86400.0
        j = int(np.argmin(score))
        cand = (score[j], float(phis[j]), float(tca[j]), float(dmin[j]), e1, e2)
        if best is None or cand[0] < best[0]: best = cand
    _, phi0, tca, dmin, e1, e2 = best
    moons_out.append(dict(planet=planet, name=name, a=a, r=rad, alb=alb, n=n, phi0=phi0, t0=te, e1=list(e1), e2=list(e2),
                          ca_t=tca if dist else None, ca_d=dmin if dist else None, ca_pub=dist))
    if dist: log('%-9s CA %9.0f km (target %9.0f) at %+7.2f h from planet CA' % (name, dmin, dist, (tca - te)/3600))

# --------------------------------------------------------------- events
def utc_t(*u): return T(u)
L = T_LIFT
ev = []
def E(t, title, text='', tag='derived', kind='event'): ev.append(dict(t=float(t), title=title, text=text, tag=tag, kind=kind))
E(L, 'Liftoff', 'Titan IIIE/Centaur TC-7 lifts off from Space Launch Complex 41, Cape Canaveral, 14:29:44 UTC.', 'sourced', 'launch')
LAUNCH_SEQ = [  # seconds after liftoff (guess) -- consistent with the stylised ascent model
 (8, 'Roll and pitch program', 'guess'), (112, 'Titan stage 1 (LR87) ignition', 'guess'),
 (122, 'SRM jettison', 'guess'), (262, 'Stage 1 shutdown / stage 2 (LR91) ignition', 'guess'),
 (285, 'Centaur Standard Shroud jettison', 'guess'), (470, 'Titan stage 2 shutdown', 'guess'),
 (478, 'Titan / Centaur separation', 'guess'), (490, 'Centaur main engine start 1', 'guess'),
 (G['t_ins'], 'Centaur MECO 1: parking orbit (167 km)', 'guess')]
for tt, title, tag in LAUNCH_SEQ: E(L + tt, title, '', tag, 'launch')
t_mes2 = G['t_ins'] + G['t_coast']; t_sep = t_mes2 + 0.80*G['t_burn']
E(L + t_mes2, 'Centaur main engine start 2', 'Escape burn begins; includes a plane change out of the ~29 deg parking orbit (derived geometry).', 'guess', 'launch')
E(L + t_sep - 4, 'Centaur MECO 2 / separation', '', 'guess', 'launch')
E(L + t_sep, 'Propulsion module (TE-M-364-4) ignition', '', 'guess', 'launch')
E(L + G['t_b'], 'Propulsion module burnout: Earth escape', 'C3 = %.1f km2/s2 (derived).' % (F['V_INJ'] @ F['V_INJ']), 'derived', 'launch')
E(L + G['t_b'] + 900, 'Propulsion module jettison', '', 'guess', 'launch')
E(L + 3*3600, 'Science boom deployment', 'Boom latch indication anomaly worried controllers.', 'approx')
E(utc_t(1977, 9, 5, 12, 56, 0), 'Voyager 1 launches', 'The twin follows 16 days later on a faster path.', 'sourced')
E(utc_t(1978, 4, 5, 0, 0, 0), 'Primary radio receiver lost', 'Switched to the backup receiver, whose failed capacitor leaves it able to hear only one exact frequency.', 'approx')
for tc in F['tcm']:
    E(tc['t'], tc['label'], 'Trajectory correction toward %s: %.2f m/s (derived).' % (tc['target'].capitalize(), tc['dv']), 'derived', 'tcm')
for k, title in [('jupiter', 'Jupiter closest approach'), ('saturn', 'Saturn closest approach'), ('uranus', 'Uranus closest approach'), ('neptune', 'Neptune closest approach')]:
    e = F['enc'][k]
    E(e['t'], title, '%.0f km from the planet centre (derived; published %.0f km), %.1f km/s relative.' % (e['rp'], e['rp_published'], e['v']), 'derived', 'encounter')
for m in moons_out:
    if m['ca_t']: E(m['ca_t'], m['name'] + ' closest approach', '%.0f km (placed to match ~%.0f km).' % (m['ca_d'], m['ca_pub']), 'derived', 'moon')
E(F['enc']['jupiter']['t'] - 30*3600, 'Io volcano watch begins', '10-hour campaign confirms active volcanism on Io.', 'approx')
E(F['enc']['saturn']['t'] + 1.2*3600, 'Scan platform azimuth actuator seizes', 'Lubricant failure jams the platform; partial recovery by ground commands.', 'approx', 'anomaly')
E(utc_t(1987, 12, 18, 18, 0, 0), '1987 course correction', 'Sets up the pass over Neptune\'s north pole.', 'sourced')
E(utc_t(1989, 8, 25, 12, 0, 0), 'Great Dark Spot', 'Storm discovered in Neptune\'s southern hemisphere.', 'sourced')
LATER = [((1991, 1, 1), 'Photopolarimeter turned off', 'sourced'), ((1992, 2, 20), 'Observes nova V1974 Cygni in far-UV', 'approx'),
 ((1994, 7, 16), 'Watches for Shoemaker-Levy 9 impacts on Jupiter', 'sourced'), ((1998, 1, 1), 'Scan platform and UVS shut down', 'sourced'),
 ((2002, 6, 30), 'Plasma-wave high-rate receiver fails', 'sourced'), ((2006, 11, 29), 'Magnetometer heaters wrongly switched on', 'sourced'),
 ((2006, 12, 4), 'Magnetometer heaters off again', 'sourced'), ((2007, 8, 30), 'Termination shock crossed', 'sourced'),
 ((2008, 1, 1), 'Planetary Radio Astronomy off', 'sourced'), ((2010, 4, 22), 'Flipped bit garbles science data', 'sourced'),
 ((2010, 5, 23), 'Science data restored', 'sourced'), ((2018, 11, 5), 'Heliopause: interstellar space', 'sourced'),
 ((2020, 3, 1), 'DSS-43 upgrade: no commands for months', 'approx'), ((2020, 11, 2), 'Commands reach Voyager 2 again', 'sourced'),
 ((2021, 2, 12), 'Full communications restored', 'sourced'), ((2023, 7, 18), 'Passes Pioneer 10 in distance', 'sourced'),
 ((2023, 7, 21), 'Antenna mis-pointed by 2 degrees', 'sourced', 'anomaly'), ((2023, 8, 4), 'Canberra "shout" restores pointing', 'sourced'),
 ((2024, 10, 1), 'Plasma Science instrument off', 'approx'), ((2025, 3, 1), 'LECP instrument off', 'approx'),
 ((2026, 8, 15), '"Big Bang" power reconfiguration', 'approx'), ((2027, 6, 1), 'Cosmic Ray Subsystem off (projected)', 'approx'),
 ((2030, 6, 1), 'No power left for instruments (projected)', 'approx'), ((2036, 6, 1), 'Beyond Deep Space Network range (projected)', 'approx')]
for item in LATER:
    u, title, tag = item[:3]; E(utc_t(*u, 12, 0, 0), title, '', tag, item[3] if len(item) > 3 else 'event')
ev.sort(key=lambda e: e['t'])

meta = dict(
    jd_ref=J, t_liftoff=T_LIFT, t_escape=T_LIFT + G['t_b'], t_end=float(nodes[-1, 0]),
    launch=dict(t_ins=G['t_ins'], t_coast=G['t_coast'], t_burn=G['t_burn'], t_mes2=t_mes2, t_sep=t_sep,
                seq=[dict(t=float(x[0]), name=x[1]) for x in LAUNCH_SEQ]),
    bodies=index, body_order=list(BODY_STEP), planets=PLANETS, moons=moons_out, events=ev,
    encounters=F['enc'], tcm=F['tcm'], au=V.AU,
    canopus=[float(x) for x in geo.ecl_from_eq(np.array([np.cos(np.radians(-52.69566))*np.cos(np.radians(95.98796)),
                                                          np.cos(np.radians(-52.69566))*np.sin(np.radians(95.98796)), np.sin(np.radians(-52.69566))]))],
    rings=dict(saturn=[[74500, 92000, 0.25], [92000, 117580, 0.9], [122170, 136775, 0.7]], uranus=[[41837, 51149, 0.15]],
               neptune=[[41900, 62930, 0.05]], jupiter=[[122000, 129000, 0.03]]),
)
json.dump(meta, open(OUT + 'mission.json', 'w'), separators=(',', ':'))
log('mission.json: %d events, %d moons' % (len(ev), len(moons_out)))
