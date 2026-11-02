"""Generate planet / moon / ring / sky textures into app/tex/.

Equirectangular maps: u = 0.5 + lon/360 (lon 0 at the centre), v = 0 at the north pole.
Real data: Earth coastlines (Natural Earth 1:110m, via the geopandas 0.14 test datasets), star catalogue and
Milky Way outline (d3-celestial, Hipparcos/Tycho-based). Everything else is painted procedurally to match
the features Voyager 2 actually photographed (see notes per body).
"""
import json, os, sys, math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

PK = '/tmp/claude-0/-home-user-voxel-art/2a823091-dce1-502f-bc76-a75fc34c2a87/scratchpad/pkgs/'
OUT = '/home/user/voxel-art/app/tex/'
os.makedirs(OUT, exist_ok=True)

# ------------------------------------------------------------------ helpers
def grid(W, H):
    lon = (np.arange(W) + 0.5) / W * 2 * np.pi - np.pi
    lat = np.pi / 2 - (np.arange(H) + 0.5) / H * np.pi
    LON, LAT = np.meshgrid(lon, lat)
    x = np.cos(LAT) * np.cos(LON); y = np.cos(LAT) * np.sin(LON); z = np.sin(LAT)
    return LON, LAT, x, y, z

def _hash(ix, iy, iz, seed):
    h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 144665) & 0xffffffff
    h = (h ^ (h >> 13)) * 1274126177 & 0xffffffff
    return ((h ^ (h >> 16)) & 0xffff) / 65535.0

def vnoise(x, y, z, seed=0):
    xi, yi, zi = np.floor(x).astype(np.int64), np.floor(y).astype(np.int64), np.floor(z).astype(np.int64)
    xf, yf, zf = x - xi, y - yi, z - zi
    u, v, w = xf * xf * (3 - 2 * xf), yf * yf * (3 - 2 * yf), zf * zf * (3 - 2 * zf)
    r = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                r = r + _hash(xi + dx, yi + dy, zi + dz, seed) * (u if dx else 1 - u) * (v if dy else 1 - v) * (w if dz else 1 - w)
    return r

def fbm(x, y, z, oct=5, seed=0, lac=2.03, gain=0.5):
    a, f, s, n = 0.5, 1.0, 0, 0
    for i in range(oct):
        s = s + a * vnoise(x * f, y * f, z * f, seed + i * 17); n += a; f *= lac; a *= gain
    return s / n

def lerp(a, b, t): return a + (b - a) * np.clip(t, 0, 1)[..., None]
def C(h): return np.array([(h >> 16) & 255, (h >> 8) & 255, h & 255], float)
def save(img, name, q=90):
    arr = np.clip(img, 0, 255).astype(np.uint8)
    im = Image.fromarray(arr)
    if name.endswith('.jpg'): im.save(OUT + name, quality=q, optimize=True)
    else: im.save(OUT + name, optimize=True)
    print('wrote', name, im.size)

def ellipse_mask(LON, LAT, lon0, lat0, a_deg, b_deg, soft=0.25):
    dl = (LON - math.radians(lon0) + np.pi) % (2 * np.pi) - np.pi
    d = np.hypot(dl * np.cos(LAT) / math.radians(a_deg), (LAT - math.radians(lat0)) / math.radians(b_deg))
    return np.clip((1 - d) / soft, 0, 1)

def crater_field(x, y, z, n, rmin, rmax, seed, W, H, LON, LAT, rim=0.25, dark=0.2):
    rng = np.random.default_rng(seed); out = np.zeros(LON.shape)
    for _ in range(n):
        lo, la = rng.uniform(-180, 180), math.degrees(math.asin(rng.uniform(-1, 1)))
        r = rmin * (rmax / rmin) ** (rng.random() ** 2.5)
        m = ellipse_mask(LON, LAT, lo, la, r / max(math.cos(math.radians(la)), 0.15) * math.cos(math.radians(la)), r, soft=0.15)
        ring = np.clip(1 - np.abs(m - 0.15) / 0.15, 0, 1)
        out += -dark * m + rim * ring
    return out

# ------------------------------------------------------------------ Earth (real coastlines)
def earth():
    import shapefile
    W, H = 4096, 2048
    r = shapefile.Reader(PK + 'gp/geopandas/datasets/naturalearth_lowres/naturalearth_lowres.shp')
    land = Image.new('L', (W, H), 0); ice = Image.new('L', (W, H), 0)
    dl, di = ImageDraw.Draw(land), ImageDraw.Draw(ice)
    for sh, rec in zip(r.shapes(), r.records()):
        name = rec[2]
        parts = list(sh.parts) + [len(sh.points)]
        for a, b in zip(parts[:-1], parts[1:]):
            pts = [((lo + 180) / 360 * W, (90 - la) / 180 * H) for lo, la in sh.points[a:b]]
            for shift in (-W, 0, W):
                pp = [(px + shift, py) for px, py in pts]
                dl.polygon(pp, fill=255)
                if name in ('Antarctica', 'Greenland'): di.polygon(pp, fill=255)
    L = np.asarray(land, float) / 255; I = np.asarray(ice, float) / 255
    coast = np.asarray(land.filter(ImageFilter.GaussianBlur(10)), float) / 255
    LON, LAT, x, y, z = grid(W, H)
    lat, lon = np.degrees(LAT), np.degrees(LON)
    n1 = fbm(x * 6, y * 6, z * 6, 5, seed=3); n2 = fbm(x * 18, y * 18, z * 18, 4, seed=9)
    # ocean: deep navy, lighter over shelves near coasts
    ocean = lerp(C(0x0a2350)[None, None], C(0x163f7a)[None, None], 0.35 * n1 + 0.0)
    ocean = lerp(ocean, C(0x2a6a9a)[None, None], np.clip(coast * 1.6 - 0.15, 0, 1) * 0.55)
    # land biomes by latitude + named dry regions
    def box(la0, la1, lo0, lo1, s=4):
        return np.clip(np.minimum.reduce([(lat - la0) / s, (la1 - lat) / s, (lon - lo0) / s, (lo1 - lon) / s]), 0, 1)
    desert = np.maximum.reduce([box(14, 33, -17, 35), box(13, 32, 35, 60), box(24, 38, 52, 72, 3), box(36, 46, 75, 112, 3),
                                box(-32, -19, 117, 142, 3), box(-28, -17, 12, 24, 2), box(25, 37, -117, -103, 2),
                                box(-28, -16, -72, -68, 1.5), box(-50, -38, -71, -65, 2), box(40, 48, 50, 66, 3)])
    desert = np.asarray(Image.fromarray((desert * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(28)), float) / 255
    desert = np.clip((desert * (0.55 + 0.9 * n2) - 0.15) * 1.6, 0, 1)
    rain = np.clip(1 - np.abs(lat) / 12, 0, 1) * (0.6 + 0.4 * n1)
    boreal = np.clip(1 - np.abs(lat - 58) / 9, 0, 1)
    tundra = np.clip((np.abs(lat) - 62) / 6, 0, 1)
    g = lerp(C(0x56743a)[None, None], C(0x7a8a4a)[None, None], n2)              # temperate green / grass
    g = lerp(g, C(0x2f5a2a)[None, None], rain)                                   # rainforest
    g = lerp(g, C(0x34503a)[None, None], boreal * 0.85)                          # boreal forest
    g = lerp(g, C(0x8a7f62)[None, None], tundra)                                 # tundra
    g = lerp(g, C(0xc9a56a)[None, None], desert)                                 # deserts
    g = lerp(g, C(0xb08a5a)[None, None], desert * np.clip(n2 - 0.55, 0, 1) * 3)  # rocky desert
    snow = np.maximum(I, np.clip((np.abs(lat) - 70) / 4, 0, 1) * L)
    g = lerp(g, C(0xf2f5f8)[None, None], snow)
    # August sea ice: Arctic pack poleward of ~78-80 N, Antarctic winter pack to ~60 S
    seaice = np.clip((lat - 79 + 3 * n1) / 2, 0, 1) + np.clip((-lat - 62 + 4 * n1) / 2, 0, 1)
    ocean = lerp(ocean, C(0xe6ecf2)[None, None], np.clip(seaice, 0, 1))
    img = lerp(ocean, g, L)
    save(img, 'earth.jpg', 88)
    # clouds: ITCZ, mid-latitude storm tracks, clearer subtropics, stretched east-west
    W2, H2 = 2048, 1024
    LON, LAT, x, y, z = grid(W2, H2); lat = np.degrees(LAT)
    wx = fbm(x * 3, y * 3, z * 3, 3, seed=21) - 0.5
    c = fbm(x * 5 + wx * 2, y * 5 + wx * 2, z * 14, 6, seed=33)
    band = 0.55 + 0.25 * np.exp(-((lat - 6) / 7) ** 2) + 0.3 * np.exp(-((np.abs(lat) - 52) / 12) ** 2) - 0.25 * np.exp(-((np.abs(lat) - 24) / 8) ** 2)
    a = np.clip((c * band - 0.33) * 3.2, 0, 1) ** 1.3
    save(np.dstack([np.full_like(a, 255), np.full_like(a, 255), np.full_like(a, 255), a * 255]), 'earth_clouds.png')

# ------------------------------------------------------------------ gas giants
def jupiter():
    W, H = 2048, 1024
    LON, LAT, x, y, z = grid(W, H); lat, lon = np.degrees(LAT), np.degrees(LON)
    warp = fbm(x * 4, y * 4, z * 4, 4, seed=5) - 0.5
    t = lat + 2.2 * warp + 0.8 * np.sin(np.radians(lon) * 3 + lat * 0.3)
    # Voyager-era belt/zone profile (planetographic latitude, deg)
    prof = [(-90, 0x8a8170), (-60, 0x9b8f7a), (-45, 0xc7b79a), (-38, 0x9e7f5c), (-33, 0xe9dcc4), (-27, 0xa98260),
            (-24, 0xf1e6d2), (-19, 0xf3e8d4), (-17, 0xa8714a), (-8, 0xb57c52), (-6, 0xefe2c8), (6, 0xf0e1c2),
            (8, 0xa56b45), (17, 0xb07a52), (19, 0xeee3cc), (23, 0xe6d8bd), (25, 0xa27a58), (30, 0xb08a66),
            (33, 0xe2d4ba), (40, 0xb09a7c), (55, 0xa59781), (90, 0x8d8474)]
    lats = np.array([p[0] for p in prof], float); cols = np.array([C(p[1]) for p in prof])
    img = np.stack([np.interp(t, lats, cols[:, k]) for k in range(3)], -1)
    turb = fbm(x * 10 + warp * 3, y * 10 + warp * 3, z * 40, 5, seed=8)
    img *= (0.9 + 0.2 * turb)[..., None]
    # festoons: blue-grey plumes from the NEB edge into the equatorial zone
    fest = np.clip(1 - np.abs(lat - 6.5) / 3, 0, 1) * (np.sin(np.radians(lon) * 11 + warp * 6) > 0.6)
    img = lerp(img, C(0x6f7a86)[None, None], fest * 0.55)
    # Great Red Spot (22 S, ~21 x 10 deg) with its pale collar and turbulent wake to the west
    grs = ellipse_mask(LON, LAT, 40, -22.3, 10.5, 5.2, soft=0.5)
    collar = ellipse_mask(LON, LAT, 40, -22.3, 13.5, 6.8, soft=0.3) - grs
    img = lerp(img, C(0xf6eee2)[None, None], np.clip(collar, 0, 1) * 0.8)
    img = lerp(img, C(0xc4553a)[None, None], grs * (0.75 + 0.25 * turb))
    wake = np.clip(1 - np.abs(lat + 18) / 4, 0, 1) * np.clip(1 - (((lon - 40) % 360) - 300) / 60, 0, 1) * (((lon - 40) % 360) > 300)
    img = lerp(img, C(0xf3e8d6)[None, None], wake * turb * 0.7)
    for lo in (-60, 70, 160):  # white ovals BC, DE, FA near 33 S
        img = lerp(img, C(0xfaf6ee)[None, None], ellipse_mask(LON, LAT, lo, -33.5, 3.4, 2.4, 0.4))
    save(img, 'jupiter.jpg')

def saturn():
    W, H = 2048, 1024
    LON, LAT, x, y, z = grid(W, H); lat, lon = np.degrees(LAT), np.degrees(LON)
    warp = fbm(x * 3, y * 3, z * 3, 3, seed=2) - 0.5
    t = lat + 1.2 * warp
    prof = [(-90, 0x8f8a74), (-60, 0xb5a37c), (-40, 0xd2bd8c), (-25, 0xc9b080), (-12, 0xe8d4a2), (0, 0xeedcae),
            (12, 0xe4cf9c), (20, 0xc7ac78), (30, 0xd8c294), (42, 0xc3ab7c), (55, 0xb8a37a), (70, 0x9a9a84), (90, 0x7c8a8c)]
    lats = np.array([p[0] for p in prof], float); cols = np.array([C(p[1]) for p in prof])
    img = np.stack([np.interp(t, lats, cols[:, k]) for k in range(3)], -1)
    img *= (0.95 + 0.1 * fbm(x * 8, y * 8, z * 30, 4, seed=4))[..., None]
    # north polar hexagon (~78 N), first seen in Voyager images
    th = (np.radians(lon) % (np.pi / 3)) - np.pi / 6
    r_hex = 13.0 / np.cos(th)
    colat = 90 - lat
    hexline = np.clip(1 - np.abs(colat - r_hex) / 1.2, 0, 1) * (lat > 60)
    img = lerp(img, C(0x6f7f86)[None, None], hexline * 0.7)
    img = lerp(img, C(0x7d8b8c)[None, None], (colat < r_hex - 1) * 0.35)
    save(img, 'saturn.jpg')

def uranus():
    W, H = 1024, 512
    LON, LAT, x, y, z = grid(W, H); lat = np.degrees(LAT)
    base = lerp(C(0x9fd3da)[None, None], C(0xb9e3e6)[None, None], 0.5 + 0.03 * np.sin(np.radians(lat) * 14))
    # sunlit south polar region in 1986: slightly paler, desaturated "hood" with faint concentric bands
    hood = np.clip((-lat - 40) / 25, 0, 1)
    base = lerp(base, C(0xc6dcd6)[None, None], hood * (0.6 + 0.08 * np.sin(np.radians(lat) * 30)))
    save(base, 'uranus.jpg')

def neptune():
    W, H = 2048, 1024
    LON, LAT, x, y, z = grid(W, H); lat, lon = np.degrees(LAT), np.degrees(LON)
    warp = fbm(x * 4, y * 4, z * 4, 3, seed=12) - 0.5
    t = lat + 2 * warp
    prof = [(-90, 0x2c4aa6), (-70, 0x2a46a0), (-55, 0x3557b8), (-30, 0x3e64c6), (-10, 0x4269cc), (10, 0x3f66c8),
            (30, 0x3a5fc2), (60, 0x3456b6), (90, 0x2f4fae)]
    lats = np.array([p[0] for p in prof], float); cols = np.array([C(p[1]) for p in prof])
    img = np.stack([np.interp(t, lats, cols[:, k]) for k in range(3)], -1)
    img *= (0.95 + 0.1 * fbm(x * 8, y * 8, z * 24, 4, seed=13))[..., None]
    img = lerp(img, C(0x2a3f98)[None, None], np.clip(1 - np.abs(lat + 63) / 5, 0, 1) * 0.6)   # dark south polar band
    # Great Dark Spot (22 S, ~32 x 15 deg) with bright companion clouds on its southern edge
    gds = ellipse_mask(LON, LAT, 0, -22, 16, 7.5, soft=0.5)
    img = lerp(img, C(0x1b2a78)[None, None], gds)
    comp = ellipse_mask(LON, LAT, 6, -29.5, 9, 1.6, soft=0.6)
    img = lerp(img, C(0xf2f6ff)[None, None], comp * 0.9)
    img = lerp(img, C(0xf2f6ff)[None, None], ellipse_mask(LON, LAT, 60, -42, 3.5, 1.5, 0.5))            # "Scooter"
    img = lerp(img, C(0x24378c)[None, None], ellipse_mask(LON, LAT, 110, -55, 5, 3.5, 0.5))              # small dark spot D2
    img = lerp(img, C(0xeef3ff)[None, None], ellipse_mask(LON, LAT, 110, -55, 1.6, 1.2, 0.5))
    streak = np.clip(1 - np.abs(lat - 27) / 1.2, 0, 1) * (fbm(x * 12, y * 12, z * 12, 3, seed=31) > 0.55)
    streak += np.clip(1 - np.abs(lat + 20) / 1.0, 0, 1) * (fbm(x * 12, y * 12, z * 12, 3, seed=32) > 0.6)
    img = lerp(img, C(0xf5f8ff)[None, None], np.clip(streak, 0, 1) * 0.85)
    save(img, 'neptune.jpg')

# ------------------------------------------------------------------ terrestrial / Moon / Sun
def rocky(name, W, H, c_hi, c_lo, seed, craters=0, extra=None, scale=4):
    LON, LAT, x, y, z = grid(W, H)
    n = fbm(x * scale, y * scale, z * scale, 6, seed=seed)
    img = lerp(C(c_lo)[None, None], C(c_hi)[None, None], n)
    if craters:
        cf = crater_field(x, y, z, craters, 1.5, 14, seed, W, H, LON, LAT)
        img *= (1 + 0.6 * cf)[..., None]
    if extra: img = extra(img, LON, LAT, x, y, z)
    save(img, name)

def moon_extra(img, LON, LAT, x, y, z):
    # near side maria (selenographic lon/lat; near side centred on lon 0)
    for lo, la, a, b in [(-16, 33, 16, 12), (17, 28, 9, 8), (31, 8, 10, 8), (59, 17, 7, 5), (-57, 18, 22, 25),
                         (-38, -21, 10, 8), (-16, -21, 8, 7), (35, -15, 6, 5), (-3, 10, 9, 6), (53, -5, 6, 6)]:
        img = lerp(img, C(0x5d5a56)[None, None], ellipse_mask(LON, LAT, lo, la, a, b, 0.5) * 0.85)
    img = lerp(img, C(0xd6d3cc)[None, None], ellipse_mask(LON, LAT, -11, -43, 1.8, 1.8, 0.5))   # Tycho
    return img

def mars_extra(img, LON, LAT, x, y, z):
    lat = np.degrees(LAT)
    img = lerp(img, C(0x6e3a26)[None, None], ellipse_mask(LON, LAT, 70, 9, 10, 14, 0.6) * 0.8)   # Syrtis Major
    img = lerp(img, C(0xd8a37a)[None, None], ellipse_mask(LON, LAT, 70, -42, 20, 12, 0.6) * 0.7) # Hellas
    img = lerp(img, C(0x5a2e20)[None, None], np.clip(1 - np.abs(lat + 8) / 1.5, 0, 1) * ellipse_mask(LON, LAT, -70, -8, 32, 6, 0.4) * 0.8)  # Valles Marineris
    for lo, la in [(-133, 18), (-120, 1), (-113, -9), (-101, 12)]:
        img = lerp(img, C(0xb06a4a)[None, None], ellipse_mask(LON, LAT, lo, la, 4, 4, 0.5))     # Tharsis volcanoes
    img = lerp(img, C(0xf4f0ea)[None, None], np.clip((np.abs(lat) - 80) / 3, 0, 1))
    return img

def sun():
    W, H = 1024, 512
    LON, LAT, x, y, z = grid(W, H)
    g = fbm(x * 40, y * 40, z * 40, 3, seed=1)
    save(lerp(C(0xffd28a)[None, None], C(0xfff6e0)[None, None], g), 'sun.jpg')

# ------------------------------------------------------------------ moons (leading hemisphere = lon +90, sub-planet = lon 0)
def moons():
    def io(img, LON, LAT, x, y, z):
        n = fbm(x * 6, y * 6, z * 6, 5, seed=41)
        img = lerp(C(0xe7d36a)[None, None], C(0xd88a3c)[None, None], n * 1.3)
        img = lerp(img, C(0xf2eedc)[None, None], np.clip(np.abs(np.degrees(LAT)) / 70 - 0.4, 0, 1) * 0.4)
        rng = np.random.default_rng(4)
        for _ in range(40):
            m = ellipse_mask(LON, LAT, rng.uniform(-180, 180), rng.uniform(-60, 60), rng.uniform(1, 3), rng.uniform(1, 3), 0.4)
            img = lerp(img, C(0x2a1a0c)[None, None], m)
        pele = ellipse_mask(LON, LAT, -105, -19, 12, 10, 0.25) - ellipse_mask(LON, LAT, -105, -19, 8, 7, 0.25)
        img = lerp(img, C(0xc0442a)[None, None], np.clip(pele, 0, 1) * 0.8)            # Pele plume deposit ring
        return img
    def europa(img, LON, LAT, x, y, z):
        img = lerp(C(0xece5d6)[None, None], C(0xc7b294)[None, None], fbm(x * 3, y * 3, z * 3, 4, seed=51))
        for k in range(14):
            a = fbm(x * 2 + k, y * 2, z * 2, 2, seed=60 + k)
            img = lerp(img, C(0x8c5a3a)[None, None], np.clip(1 - np.abs(a - 0.5) / 0.006, 0, 1) * 0.8)
        return img
    def ganymede(img, LON, LAT, x, y, z):
        n = fbm(x * 3, y * 3, z * 3, 5, seed=71)
        img = lerp(C(0x9c8f80)[None, None], C(0xc9c0b4)[None, None], (n > 0.5) * 1.0)
        img = lerp(img, C(0x5f5244)[None, None], ellipse_mask(LON, LAT, 145, 35, 40, 30, 0.6) * 0.85)  # Galileo Regio
        img *= (1 + 0.5 * crater_field(x, y, z, 60, 1, 5, 7, 0, 0, LON, LAT))[..., None]
        return img
    def callisto(img, LON, LAT, x, y, z):
        img = lerp(C(0x4a4136)[None, None], C(0x5d5347)[None, None], fbm(x * 5, y * 5, z * 5, 4, seed=81))
        rng = np.random.default_rng(8)
        for _ in range(500):
            img = lerp(img, C(0xd8d2c8)[None, None], ellipse_mask(LON, LAT, rng.uniform(-180, 180), math.degrees(math.asin(rng.uniform(-1, 1))), 0.9, 0.9, 0.5) * 0.9)
        for r in (6, 12, 18, 24):  # Valhalla multi-ring basin
            ring = ellipse_mask(LON, LAT, -56, 18, r + 1, r + 1, 0.3) - ellipse_mask(LON, LAT, -56, 18, r, r, 0.3)
            img = lerp(img, C(0xb5ab9c)[None, None], np.clip(ring, 0, 1) * 0.6)
        return img
    def iapetus(img, LON, LAT, x, y, z):
        lead = ellipse_mask(LON, LAT, 90, 0, 100, 60, 0.35)          # Cassini Regio on the leading hemisphere
        return lerp(C(0xe6e1d6)[None, None] * (0.9 + 0.1 * fbm(x * 6, y * 6, z * 6, 3, seed=91))[..., None], C(0x2e2219)[None, None], lead)
    def mimas(img, LON, LAT, x, y, z):
        img = img * (1 + 0.5 * crater_field(x, y, z, 120, 1, 6, 9, 0, 0, LON, LAT))[..., None]
        her = ellipse_mask(LON, LAT, 90, 0, 22, 22, 0.25)            # Herschel, ~1/3 of the diameter
        return lerp(img, C(0x9a9690)[None, None], np.clip(her * 1.2 - ellipse_mask(LON, LAT, 90, 0, 3, 3, 0.4), 0, 1) * 0.6)
    def tethys(img, LON, LAT, x, y, z):
        img = img * (1 + 0.4 * crater_field(x, y, z, 80, 1, 5, 11, 0, 0, LON, LAT))[..., None]
        img = lerp(img, C(0xa49e96)[None, None], ellipse_mask(LON, LAT, 128, 30, 30, 30, 0.3) * 0.5)   # Odysseus
        ith = np.clip(1 - np.abs(np.degrees(np.arctan2(z, x * np.sin(0.5) + y * np.cos(0.5)))) / 2.5, 0, 1)
        return lerp(img, C(0x8f8982)[None, None], ith * 0.6)        # Ithaca Chasma
    def dione(img, LON, LAT, x, y, z):
        img = img * (1 + 0.4 * crater_field(x, y, z, 60, 1, 5, 13, 0, 0, LON, LAT))[..., None]
        wisp = (fbm(x * 8, y * 8, z * 8, 3, seed=14) > 0.6) * ellipse_mask(LON, LAT, -90, 0, 70, 60, 0.4)   # trailing-side wisps
        return lerp(img * (1 - 0.25 * ellipse_mask(LON, LAT, -90, 0, 80, 70, 0.6))[..., None], C(0xf2f0ec)[None, None], wisp * 0.7)
    def titan(img, LON, LAT, x, y, z):
        lat = np.degrees(LAT)
        img = lerp(C(0xd99a42)[None, None], C(0xc27e2c)[None, None], 0.5 + 0.5 * np.tanh(-lat / 25))   # N/S hemispheric asymmetry
        return lerp(img, C(0x8e6a3a)[None, None], np.clip((lat - 65) / 10, 0, 1) * 0.6)                  # dark north polar hood
    def miranda(img, LON, LAT, x, y, z):
        img = img * (1 + 0.3 * crater_field(x, y, z, 50, 1, 4, 15, 0, 0, LON, LAT))[..., None]
        for lo, la in [(-90, -30), (0, -40), (90, -35)]:             # Inverness, Arden, Elsinore coronae
            m = ellipse_mask(LON, LAT, lo, la, 30, 25, 0.3)
            stripes = (np.sin((x * 3 + y * 5 + z * 7) * 25) > 0) * m
            img = lerp(img, C(0x6c6964)[None, None], stripes * 0.6)
        return img
    def umbriel(img, LON, LAT, x, y, z):
        img = lerp(C(0x4c4a48)[None, None], C(0x5c5a57)[None, None], fbm(x * 5, y * 5, z * 5, 4, seed=17))
        ring = ellipse_mask(LON, LAT, 0, -10, 9, 9, 0.3) - ellipse_mask(LON, LAT, 0, -10, 5, 5, 0.3)
        return lerp(img, C(0xcac6be)[None, None], np.clip(ring, 0, 1))  # Wunda
    def triton(img, LON, LAT, x, y, z):
        lat = np.degrees(LAT)
        cant = lerp(C(0xb7b0a4)[None, None], C(0x8e877c)[None, None], (fbm(x * 18, y * 18, z * 18, 3, seed=19) > 0.5) * 1.0)  # cantaloupe terrain
        cap = lerp(C(0xf1d9cf)[None, None], C(0xe9c3b3)[None, None], fbm(x * 6, y * 6, z * 6, 3, seed=20))
        img = lerp(cant, cap, np.clip((-lat - 5 + 8 * (fbm(x * 3, y * 3, z * 3, 2, seed=23) - 0.5)) / 6, 0, 1))
        rng = np.random.default_rng(21)
        for _ in range(50):  # dark geyser streaks on the polar cap, all blown roughly the same way
            lo, la = rng.uniform(-180, 180), rng.uniform(-75, -20)
            img = lerp(img, C(0x5a4a44)[None, None], ellipse_mask(LON, LAT, lo + 3, la, 6, 0.8, 0.5) * 0.7)
        return img
    specs = [  # name, W, colour hi, colour lo, seed, craters, extra
        ('io', 1024, 0, 0, 1, 0, io), ('europa', 1024, 0, 0, 2, 0, europa), ('ganymede', 1024, 0, 0, 3, 0, ganymede),
        ('callisto', 1024, 0, 0, 4, 0, callisto), ('amalthea', 256, 0x9a5a3a, 0x6e3a24, 5, 10, None),
        ('mimas', 512, 0xdedad4, 0xb8b4ae, 6, 0, mimas), ('enceladus', 512, 0xfafaf8, 0xe6e8ea, 7, 20, None),
        ('tethys', 512, 0xe6e3dd, 0xc8c4bd, 8, 0, tethys), ('dione', 512, 0xd9d6d0, 0xb3afa8, 9, 0, dione),
        ('rhea', 512, 0xd5d2cc, 0xaaa69f, 10, 160, None), ('titan', 512, 0, 0, 11, 0, titan),
        ('hyperion', 256, 0xb5a690, 0x8a7a66, 12, 60, None), ('iapetus', 512, 0, 0, 13, 0, iapetus),
        ('miranda', 512, 0xb2aea8, 0x8f8b85, 14, 0, miranda), ('ariel', 512, 0xc3c0ba, 0x9a978f, 15, 60, None),
        ('umbriel', 512, 0, 0, 16, 0, umbriel), ('titania', 512, 0xb0aaa2, 0x8a847c, 17, 80, None),
        ('oberon', 512, 0xa59c92, 0x7a7168, 18, 80, None), ('triton', 1024, 0, 0, 19, 0, triton),
        ('proteus', 256, 0x5e5a56, 0x403c38, 20, 30, None)]
    for name, W, hi, lo, seed, cr, extra in specs:
        rocky(name + '.jpg', W, W // 2, hi or 0xaaaaaa, lo or 0x888888, seed, cr, extra)

# ------------------------------------------------------------------ rings (radial strips, RGBA)
def rings():
    def strip(name, rmin, rmax, bands, W=2048):
        r = np.linspace(rmin, rmax, W); col = np.zeros((W, 3)); a = np.zeros(W)
        for r0, r1, c, op in bands:
            m = (r >= r0) & (r <= r1); col[m] = C(c); a[m] = op
        rng = np.random.default_rng(3)
        a *= (0.85 + 0.3 * rng.random(W)) * (0.9 + 0.1 * np.sin(r / 230))
        img = np.dstack([col[None].repeat(4, 0), (np.clip(a, 0, 1) * 255)[None].repeat(4, 0)])
        save(img, name)
    # Saturn: D ring, C ring, B ring (brightest), Cassini division, A ring with Encke gap, F ring
    strip('saturn_ring.png', 66000, 141000, [
        (66900, 74500, 0x6e6658, 0.03), (74500, 92000, 0x8f8676, 0.22), (92000, 104000, 0xd8c9a8, 0.85),
        (104000, 117580, 0xe2d3b2, 0.95), (117580, 122170, 0x5a554c, 0.08), (122170, 133400, 0xcdbf9f, 0.65),
        (133400, 133750, 0x000000, 0.0), (133750, 136775, 0xc5b796, 0.55), (140100, 140300, 0xd8ceb8, 0.5)])
    # Uranus: narrow dark rings; epsilon (51,149 km) is the widest/brightest
    strip('uranus_ring.png', 41000, 52000, [(41837, 41900, 0x6a6a6a, 0.5), (42234, 42290, 0x6a6a6a, 0.5), (42570, 42630, 0x6a6a6a, 0.5),
        (44718, 44780, 0x6a6a6a, 0.5), (45661, 45720, 0x6a6a6a, 0.5), (47175, 47230, 0x6a6a6a, 0.5), (47627, 47690, 0x6a6a6a, 0.5),
        (48300, 48360, 0x6a6a6a, 0.5), (50023, 50080, 0x6a6a6a, 0.5), (51100, 51200, 0x8a8a88, 0.8)])
    # Neptune: Galle, Le Verrier, Lassell, Arago, Adams (faint)
    strip('neptune_ring.png', 41000, 63500, [(41000, 43000, 0x6f6f72, 0.05), (53150, 53250, 0x8a8a8c, 0.18),
        (53250, 57200, 0x6f6f72, 0.03), (57150, 57250, 0x8a8a8c, 0.08), (62880, 62980, 0x9a9a9c, 0.25)])

# ------------------------------------------------------------------ sky: Milky Way + star catalogue
def sky():
    W, H = 4096, 2048
    # Milky Way from galactic coordinates: thin disc, central bulge toward Sagittarius, Great Rift dust lane
    LON, LAT, x, y, z = grid(W, H)              # here lon = RA - 180 deg (u = 0.5 + RA/360), lat = Dec
    ra = LON; X, Y, Z = np.cos(LAT) * np.cos(ra), np.cos(LAT) * np.sin(ra), np.sin(LAT)
    M = np.array([[-0.0548755604, -0.8734370902, -0.4838350155], [0.4941094279, -0.4448296300, 0.7469822445],
                  [-0.8676661490, -0.1980763734, 0.4559837762]])
    gx, gy, gz = (M[0, 0] * X + M[0, 1] * Y + M[0, 2] * Z), (M[1, 0] * X + M[1, 1] * Y + M[1, 2] * Z), (M[2, 0] * X + M[2, 1] * Y + M[2, 2] * Z)
    l, b = np.degrees(np.arctan2(gy, gx)), np.degrees(np.arcsin(np.clip(gz, -1, 1)))
    cl = 0.5 + 0.5 * np.cos(np.radians(l))                    # 1 toward the centre, 0 toward the anticentre
    warp = fbm(x * 6, y * 6, z * 6, 4, seed=70) - 0.5
    disc = np.exp(-((b + 2 * warp) / (5 + 6 * cl)) ** 2) * (0.35 + 0.65 * cl)
    bulge = np.exp(-(l / 15) ** 2 - (b / 9) ** 2) * 0.55
    clouds = fbm(x * 22, y * 22, z * 22, 5, seed=71)
    v = (disc * (0.6 + 0.8 * clouds) + bulge * (0.8 + 0.4 * clouds))
    rift = np.exp(-((b - 1.0 + 3 * warp) / 2.2) ** 2) * np.clip(1 - np.abs(l - 30) / 70, 0, 1) * np.clip((fbm(x * 12, y * 12, z * 12, 4, seed=72) - 0.35) * 2.5, 0, 1)
    v *= 1 - 0.85 * rift
    for L0, B0, a, bb in [(280.5, -32.9, 5, 4), (302.8, -44.3, 2.5, 2)]:   # Magellanic Clouds
        dl = (l - L0 + 180) % 360 - 180
        v += 0.5 * np.exp(-(dl / a) ** 2 - ((b - B0) / bb) ** 2) * (0.7 + 0.6 * clouds)
    col = lerp(C(0x9fb0d8)[None, None], C(0xf4e3c6)[None, None], np.clip(bulge * 1.5 + cl * 0.3, 0, 1))
    img = col * (np.clip(v, 0, 1.4) * 0.26)[..., None]
    save(img, 'milkyway.jpg', 85)
    # stars: equatorial unit vectors + magnitude + colour index (Float32 x5)
    st = json.load(open(PK + 'cel/package/data/stars.8.json'))['features']
    arr = []
    for s in st:
        ra, de = s['geometry']['coordinates']; ra, de = math.radians(ra % 360), math.radians(de)
        bv = s['properties'].get('bv'); bv = float(bv) if bv not in (None, '') else 0.6
        arr.append([math.cos(de) * math.cos(ra), math.cos(de) * math.sin(ra), math.sin(de), s['properties']['mag'], bv])
    a = np.array(arr, '<f4'); a.tofile(OUT + 'stars.bin'); print('stars', len(a))

if __name__ == '__main__':
    which = sys.argv[1:] or ['earth', 'jupiter', 'saturn', 'uranus', 'neptune', 'rocky', 'sun', 'moons', 'rings', 'sky']
    for w in which:
        if w == 'rocky':
            rocky('moon.jpg', 1024, 512, 0xb8b4ae, 0x8c8882, 30, 160, moon_extra)
            rocky('mercury.jpg', 1024, 512, 0xa8a29a, 0x7a746c, 31, 200)
            rocky('venus.jpg', 1024, 512, 0xefdcae, 0xd7bc84, 32, 0, lambda i, LON, LAT, x, y, z: lerp(i, C(0xe0c690)[None, None], np.clip(np.sin(np.degrees(LAT) / 6 + 8 * fbm(x * 2, y * 2, z * 2, 3, seed=40)), 0, 1) * 0.4), scale=2)
            rocky('mars.jpg', 1024, 512, 0xc87a4c, 0x9a5434, 33, 40, mars_extra)
        else:
            globals()[w]()
