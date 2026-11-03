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

# Apollo 11 Live (`apollo11.html`)

Apollo 11 at 1:1 real time, from T-60 s on the pad to splashdown, with detailed models (Saturn V, CSM, LM,
crew, surface experiments), the real Sun direction, shadows, Earth/Moon eclipses and earthshine. The mission
clock is anchored to the wall clock and keeps running while the page is closed; an hour after splashdown
it starts over from T-60 s. "Real time" re-syncs it, `?t=<MET seconds>` jumps.

Attitude: each vehicle turns toward its commanded attitude (burn attitude 20 min before SPS burns, PTC roll,
local horizontal, entry attitude) at a limited rate and acceleration; the RCS jets that produce each angular
acceleration (torque about the centre of mass) are lit, plus deadband pulses in attitude hold, ullage, and the
report's translation burns along the solved delta-V.

Trajectory (`tools/apollo/`): n-body (Earth, Moon, Sun from DE421; lunar orientation from DE421 librations),
finite burns with the report's ignition times, durations and delta-V. Fitted to the Mission Report:
TLI 10,432 ft/s (report 10,441), pericynthion 60 nmi on the far side in a retrograde orbit through
Tranquility Base, LOI-2 to 53.7 x 65.7 nmi, DOI to 8.5 nmi, powered descent by explicit guidance through
the report's P64/P66 gates (6,878 ft/s vs 6,930), ascent to 9.0 x 45.5 nmi (report 9.4 x 45.2),
coelliptic rendezvous, TEI, and a lifting entry (L/D 0.3) to the Pacific.
Run `tli_fit4.py`, then `mission.py`, then `export.py`.
