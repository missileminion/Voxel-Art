import numpy as np
MU_SUN = 1.32712440018e11
AU = 149597870.7
GM = dict(sun=MU_SUN, mercury=22031.78, venus=324858.59, earth=398600.436, moon=4902.80,
          mars=42828.375, jupiter=126712764.8, saturn=37940585.2, uranus=5794548.6, neptune=6836527.1)

def stumpff(z):
    if z > 1e-8:
        s = np.sqrt(z); return (1 - np.cos(s)) / z, (s - np.sin(s)) / s**3
    if z < -1e-8:
        s = np.sqrt(-z); return (np.cosh(s) - 1) / (-z), (np.sinh(s) - s) / s**3
    return 0.5 - z/24, 1/6 - z/120

def lambert(r1, r2, tof, mu=MU_SUN, prograde=True):
    """Universal-variable Lambert (short-way, <=1 rev). Returns v1, v2."""
    r1n, r2n = np.linalg.norm(r1), np.linalg.norm(r2)
    cosd = np.dot(r1, r2) / (r1n * r2n)
    cr = np.cross(r1, r2)[2]
    dth = np.arccos(np.clip(cosd, -1, 1))
    if (prograde and cr < 0) or ((not prograde) and cr >= 0):
        dth = 2*np.pi - dth
    A = np.sin(dth) * np.sqrt(r1n * r2n / (1 - np.cos(dth)))
    def F(z):
        C, S = stumpff(z)
        y = r1n + r2n + A * (z*S - 1) / np.sqrt(C)
        if y < 0: return -1e30, y
        x = np.sqrt(y / C)
        return (x**3 * S + A*np.sqrt(y)) / np.sqrt(mu) - tof, y
    lo, hi = -4*np.pi**2, 4*np.pi**2 - 1e-6
    # bracket: find lo where F<0 ... F increasing in z
    zlo = -2000.0
    zhi = hi
    for _ in range(200):
        zm = 0.5*(zlo + zhi)
        f, _ = F(zm)
        if f > 0: zhi = zm
        else: zlo = zm
        if zhi - zlo < 1e-13: break
    z = 0.5*(zlo+zhi); C, S = stumpff(z)
    y = r1n + r2n + A*(z*S - 1)/np.sqrt(C)
    f = 1 - y/r1n; g = A*np.sqrt(y/mu); gd = 1 - y/r2n
    return (r2 - f*r1)/g, (gd*r2 - r1)/g

def jd_from_utc(y, mo, d, h=0, mi=0, s=0.0):
    a = (14 - mo)//12; yy = y + 4800 - a; m = mo + 12*a - 3
    jdn = d + (153*m+2)//5 + 365*yy + yy//4 - yy//100 + yy//400 - 32045
    return jdn - 0.5 + (h + mi/60 + s/3600)/24

_LEAP = [(1972.5,11),(1973.0,12),(1974.0,13),(1975.0,14),(1976.0,15),(1977.0,16),(1978.0,17),(1979.0,18),
         (1980.0,19),(1981.5,20),(1982.5,21),(1983.5,22),(1985.5,23),(1988.0,24),(1990.0,25),(1991.0,26),
         (1992.5,27),(1993.5,28),(1994.5,29),(1996.0,30),(1997.5,31),(1999.0,32),(2006.0,33),(2009.0,34),
         (2012.5,35),(2015.5,36),(2017.0,37)]
def tai_utc(jd):
    yr = 2000 + (jd - 2451544.5)/365.25
    v = 10
    for t, n in _LEAP:
        if yr >= t: v = n
    return v

def utc_to_tdb_jd(y, mo, d, h=0, mi=0, s=0.0):
    jd = jd_from_utc(y, mo, d, h, mi, s)
    return jd + (tai_utc(jd) + 32.184)/86400.0
