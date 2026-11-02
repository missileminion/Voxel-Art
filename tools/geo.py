import numpy as np, ephem
ARCSEC = np.pi/648000.0
def R1(a): c,s=np.cos(a),np.sin(a); return np.array([[1,0,0],[0,c,s],[0,-s,c]])
def R2(a): c,s=np.cos(a),np.sin(a); return np.array([[c,0,-s],[0,1,0],[s,0,c]])
def R3(a): c,s=np.cos(a),np.sin(a); return np.array([[c,s,0],[-s,c,0],[0,0,1]])

def precession(jd_tt):
    T = (jd_tt - 2451545.0)/36525.0
    zeta = (2306.2181*T + 0.30188*T**2 + 0.017998*T**3)*ARCSEC
    z    = (2306.2181*T + 1.09468*T**2 + 0.018203*T**3)*ARCSEC
    th   = (2004.3109*T - 0.42665*T**2 - 0.041833*T**3)*ARCSEC
    return R3(-z) @ R2(th) @ R3(-zeta)       # J2000 -> date

def gmst(jd_ut1):
    d = jd_ut1 - 2451545.0; T = d/36525.0
    g = 280.46061837 + 360.98564736629*d + 0.000387933*T**2 - T**3/38710000.0
    return np.radians(g % 360.0)

def ecl_from_eq(v):  # equatorial J2000 (ICRF) -> ecliptic J2000
    return ephem.rot_ecl(v)
def eq_from_ecl(v):
    c, s = np.cos(ephem.OBL), np.sin(ephem.OBL)
    x, y, z = v
    return np.array([x, c*y - s*z, s*y + c*z])

def site_vec_eq(lat_deg, lon_deg, jd_ut, jd_tt, alt_km=0.0, Re=6378.137, f=1/298.257):
    """site position, equatorial J2000 (ICRF), km, Earth centred."""
    lat, lon = np.radians(lat_deg), np.radians(lon_deg)
    e2 = f*(2-f); N = Re/np.sqrt(1 - e2*np.sin(lat)**2)
    x = (N+alt_km)*np.cos(lat)*np.cos(lon); y = (N+alt_km)*np.cos(lat)*np.sin(lon); z = (N*(1-e2)+alt_km)*np.sin(lat)
    ang = gmst(jd_ut)
    r_date = R3(-ang) @ np.array([x, y, z])
    return precession(jd_tt).T @ r_date
