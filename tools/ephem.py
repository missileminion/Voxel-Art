"""Minimal DE421 reader for the old jplephem 'npy' layout (shape: intervals x 3 x ncoef).
Frame: ICRF barycentric, km, TDB. Converted to ecliptic J2000 by rot_ecl()."""
import os
import numpy as np
from numpy.polynomial import chebyshev as C

JD0 = 2414992.5           # DE421 start (1899-12-04 00:00 TDB)
SPAN = 109632.0           # days covered by the pip DE421 arrays (32-day blocks)
EMRAT = 81.30056
OBL = np.radians(23.4392911)   # J2000 obliquity

_NAMES = ['mercury', 'venus', 'earthmoon', 'mars', 'jupiter', 'saturn',
          'uranus', 'neptune', 'pluto', 'sun', 'moon']
_data = {}

def load(dirpath):
    for n in _NAMES:
        _data[n] = np.load(os.path.join(dirpath, 'jpl-%s.npy' % n), allow_pickle=False)

def raw(name, jd):
    """barycentric (sun/planets) or geocentric (moon) position, km, ICRF."""
    a = _data[name]
    n = a.shape[0]
    L = SPAN / n
    x = (np.asarray(jd, float) - JD0) / L
    i = np.clip(np.floor(x).astype(int), 0, n - 1)
    t = 2.0 * (x - i) - 1.0
    scalar = np.ndim(jd) == 0
    t = np.atleast_1d(t); i = np.atleast_1d(i)
    out = np.empty((t.size, 3))
    for k in range(t.size):
        for c in range(3):
            out[k, c] = C.chebval(t[k], a[i[k], c])
    return out[0] if scalar else out

def rot_ecl(v):
    c, s = np.cos(OBL), np.sin(OBL)
    v = np.asarray(v)
    x, y, z = v[..., 0], v[..., 1], v[..., 2]
    return np.stack([x, c * y + s * z, -s * y + c * z], axis=-1)

def body(name, jd):
    """barycentric ecliptic-J2000 position of a body (km)."""
    if name == 'earth':
        return rot_ecl(raw('earthmoon', jd) - raw('moon', jd) / (1.0 + EMRAT))
    if name == 'moon':
        return rot_ecl(raw('earthmoon', jd) + raw('moon', jd) * EMRAT / (1.0 + EMRAT))
    return rot_ecl(raw(name, jd))


def raw_v(name, jd):
    """vectorised raw(): jd array -> (N,3) km, ICRF."""
    a = _data[name]; n = a.shape[0]; L = SPAN / n
    x = (np.asarray(jd, float) - JD0) / L
    i = np.clip(np.floor(x).astype(int), 0, n - 1)
    t = 2.0 * (x - i) - 1.0
    co = a[i]                                   # (N,3,K)
    K = co.shape[2]
    T = np.empty((t.size, K)); T[:, 0] = 1.0
    if K > 1: T[:, 1] = t
    for k in range(2, K): T[:, k] = 2 * t * T[:, k - 1] - T[:, k - 2]
    return np.einsum('nk,nck->nc', T, co)

def body_v(name, jd):
    if name == 'earth':
        return rot_ecl(raw_v('earthmoon', jd) - raw_v('moon', jd) / (1.0 + EMRAT))
    if name == 'moon':
        return rot_ecl(raw_v('earthmoon', jd) + raw_v('moon', jd) * EMRAT / (1.0 + EMRAT))
    return rot_ecl(raw_v(name, jd))


# ---- lunar orientation (DE421 physical librations: Euler angles phi, theta, psi; ICRF -> lunar PA frame)
_lib = None
def load_librations(dirpath):
    global _lib
    _lib = np.load(os.path.join(dirpath, 'jpl-librations.npy'), allow_pickle=False)

def moon_matrix(jd):
    """3x3 matrix taking ICRF (equatorial J2000) vectors to the lunar Mean-Earth body frame."""
    a = _lib; n = a.shape[0]; L = SPAN / n
    x = (jd - JD0) / L; i = int(np.clip(np.floor(x), 0, n - 1)); t = 2.0 * (x - i) - 1.0
    phi, th, psi = [C.chebval(t, a[i, k]) for k in range(3)]
    def Rz(g): c, s = np.cos(g), np.sin(g); return np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]])
    def Rx(g): c, s = np.cos(g), np.sin(g); return np.array([[1, 0, 0], [0, c, s], [0, -s, c]])
    def Ry(g): c, s = np.cos(g), np.sin(g); return np.array([[c, 0, -s], [0, 1, 0], [s, 0, c]])
    pa = Rz(psi) @ Rx(th) @ Rz(phi)
    asec = np.pi / 648000          # DE421 principal-axis -> mean-Earth rotation (Williams et al. 2008)
    me = Rx(-0.30 * asec) @ Ry(-78.56 * asec) @ Rz(-67.92 * asec)
    return me @ pa
