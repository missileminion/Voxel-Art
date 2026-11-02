# Voyager 2 Voxel

A voxel-art simulation of Voyager 2: Titan IIIE/Centaur launch from SLC-41 (20 Aug 1977), the Jupiter, Saturn,
Uranus and Neptune flybys, and the cruise into interstellar space (data runs to the end of 2049).

## Run it

It is a static site (HTML + ES modules + data files), no build step:

```bash
python3 -m http.server 8000
```

then open http://localhost:8000. GitHub Pages serves it as-is.

URL options: `?t=<seconds after liftoff>` or `?t=1989-08-25T04:00Z` to jump, `?auto=0` to start with manual speed.
Keys: space pause, `[` `]` speed, `a` auto speed. Drag to orbit the camera, wheel to zoom.

## How the trajectory is made (`tools/`)

- `ephem.py`: JPL DE421 planetary ephemeris (from the `de421` PyPI package).
- `cruise.py`, `nbody.py`: n-body propagation (Sun, all planets, Moon) and B-plane targeting.
- `launch.py`: launch azimuth, parking orbit, escape burn (stylised ascent; geometry derived from the solution).
- `final.py`: builds the trajectory: published encounter times and radii, correction burns, Neptune approach
  fitted to the 2007 termination-shock (83.7 AU) and 2018 heliopause (119 AU) distances.
- `export.py`: writes `app/data/` (trajectory, planet ephemerides, moons placed from the trajectory, events).
- `textures.py`: writes `app/tex/` (Earth from Natural Earth coastlines; stars to magnitude 8 from the d3-celestial catalogue; Milky Way from galactic coordinates; planets and moons painted from Voyager-era features).

Every event carries a tag: `sourced` (published), `derived` (computed here), `approx` (date known roughly),
`guess` (educated guess, e.g. launch staging times).
