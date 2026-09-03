"""Generate `fixtures.json` -- the Tier 3 external-library reference (#55).

    uv run --project tools/reference tools/reference/generate.py

Everything this script produces is a number computed by somebody else's code. That
is the entire point: `crosscheck.test.ts` already compares our analytic propagator
against our own numerical oracle, and both are ours, so a shared misunderstanding
of a convention would agree with itself. These fixtures cannot.

## The package is `hapsira`, and that is a decision, not a default

`poliastro` is archived. Its last release does not install on Python 3.12+, and it
will not be patched. `hapsira` is the maintained fork -- same lineage, same
`iod.izzo`, same Farnocchia propagator -- and it is what this script uses.

`astropy` alone was considered and rejected: it has no Kepler propagator and no
Lambert solver, so it cannot supply either row this fixture exists to fill.

**The `astropy` pin is load-bearing.** `hapsira` 0.18.0 imports
`astropy.coordinates.matrix_utilities.matrix_product`, which was removed in
`astropy` 8. With an unpinned `astropy` this script does not import at all. The pin
lives in `pyproject.toml` and the resolved versions are recorded in the fixture.

## Determinism

No randomness, no clock, no network. The case list below is literal, the ISS TLE is
committed beside this file rather than fetched, and `json.dump` writes floats with
`repr`, which is the shortest string that round-trips a float64 exactly. Running
this twice on the same interpreter and the same pinned versions produces a
byte-identical file; `tools/reference/README.md` records what that does and does not
promise across platforms.

## Units

`hapsira` works in kilometres. **This file is the boundary.** Everything written to
the fixture is SI -- metres, metres per second, seconds -- so no consumer of
`fixtures.json` has to know what units the generator preferred.
"""

from __future__ import annotations

import json
import platform
import sys
from importlib.metadata import version
from pathlib import Path

import numpy as np
from astropy import units as u
from hapsira.bodies import Earth
from hapsira.iod import izzo
from hapsira.twobody import Orbit
from sgp4.api import SGP4_ERRORS, Satrec

HERE = Path(__file__).resolve().parent
FIXTURES = HERE / "fixtures.json"
TLE_FILE = HERE / "iss-tle.txt"

KM = 1e3

# hapsira's Earth.k is 3.986004418e14 m^3/s^2, which is `MU_EARTH` in
# packages/astro/src/constants.ts to the digit. Asserted rather than assumed: a
# silent change upstream would turn every fixture below into a comparison against a
# different Earth, and every test would still pass for the wrong reason.
MU = 3.986004418e14
assert Earth.k.to_value(u.m**3 / u.s**2) == MU, "hapsira's Earth.k is no longer our MU_EARTH"

# Izzo's default rtol is 1e-8, which is looser than the 1e-9 the Lambert row is
# stated at. Tightened so the reference is better than the thing it checks.
LAMBERT_RTOL = 1e-12
LAMBERT_NUMITER = 100


def vec(q) -> list[float]:
    """A Quantity in km or km/s, as a plain SI list."""
    return [float(x) * KM for x in q.to_value(q.unit)]


# ---------------------------------------------------------------------------
# Two-body propagation, over a range of a and e (section 7.6 Tier 3).
#
# Named by periapsis and eccentricity, which are defined for every conic, rather
# than by semi-major axis, which is not. The grid spans low-Earth orbit to well
# beyond geostationary and circular to strongly eccentric, and includes the
# degenerate geometries that bite in this game: e = 0, i = 0, and both.
# ---------------------------------------------------------------------------

PROPAGATION_CASES: list[dict] = [
    # name,                  periapsis km, e,     i deg, raan deg, argp deg, nu deg, dt s
    dict(name="leo-circular-equatorial", rp=6778.0, ecc=0.0, inc=0.0, raan=0.0, argp=0.0, nu=0.0, dt=1800.0),
    dict(name="leo-circular-inclined", rp=6778.0, ecc=0.0, inc=51.6, raan=40.0, argp=0.0, nu=120.0, dt=2700.0),
    dict(name="leo-eccentric", rp=6678.0, ecc=0.15, inc=28.5, raan=10.0, argp=45.0, nu=30.0, dt=3600.0),
    dict(name="leo-polar", rp=6978.0, ecc=0.01, inc=90.0, raan=200.0, argp=90.0, nu=270.0, dt=5400.0),
    dict(name="leo-retrograde", rp=6878.0, ecc=0.02, inc=170.0, raan=95.0, argp=15.0, nu=200.0, dt=4000.0),
    dict(name="meo-moderate", rp=15000.0, ecc=0.3, inc=55.0, raan=120.0, argp=200.0, nu=80.0, dt=14400.0),
    dict(name="gto", rp=6678.0, ecc=0.73, inc=27.0, raan=0.0, argp=178.0, nu=10.0, dt=18000.0),
    dict(name="geo-circular", rp=42164.17, ecc=0.0, inc=0.0, raan=0.0, argp=0.0, nu=210.0, dt=43082.0),
    dict(name="molniya", rp=6978.0, ecc=0.74, inc=63.4, raan=90.0, argp=270.0, nu=0.0, dt=21600.0),
    dict(name="high-eccentric", rp=7000.0, ecc=0.9, inc=45.0, raan=300.0, argp=60.0, nu=150.0, dt=36000.0),
    dict(name="beyond-geo", rp=80000.0, ecc=0.1, inc=5.0, raan=15.0, argp=25.0, nu=35.0, dt=86400.0),
    # Backwards in time. The propagator is symmetric by construction; the fixture
    # should say so from outside rather than take our word for it.
    dict(name="leo-eccentric-reversed", rp=6678.0, ecc=0.15, inc=28.5, raan=10.0, argp=45.0, nu=30.0, dt=-3600.0),
    dict(name="molniya-reversed", rp=6978.0, ecc=0.74, inc=63.4, raan=90.0, argp=270.0, nu=180.0, dt=-10800.0),
    # Several revolutions, where a period error would have somewhere to accumulate.
    dict(name="leo-many-revolutions", rp=6778.0, ecc=0.001, inc=51.6, raan=0.0, argp=0.0, nu=0.0, dt=100000.0),
    # Hyperbolic. Farnocchia handles every conic, so the fixture does too.
    dict(name="hyperbolic-slow", rp=7500.0, ecc=1.2, inc=20.0, raan=30.0, argp=40.0, nu=-30.0, dt=3600.0),
    dict(name="hyperbolic-fast", rp=8000.0, ecc=3.0, inc=100.0, raan=250.0, argp=310.0, nu=-60.0, dt=7200.0),
]


def build_propagation() -> list[dict]:
    out = []
    for case in PROPAGATION_CASES:
        rp = case["rp"] * u.km
        ecc = case["ecc"] * u.one
        # hapsira takes the semi-major axis, which is infinite for a parabola and
        # negative for a hyperbola; a = rp / (1 - e) carries both correctly, and the
        # parabolic case is deliberately absent from the grid because `a` cannot
        # express it. Our own parabolic path is covered by Curtis and by the
        # golden fixtures.
        a = rp / (1 - case["ecc"])
        orbit = Orbit.from_classical(
            Earth,
            a=a,
            ecc=ecc,
            inc=case["inc"] * u.deg,
            raan=case["raan"] * u.deg,
            argp=case["argp"] * u.deg,
            nu=case["nu"] * u.deg,
        )
        moved = orbit.propagate(case["dt"] * u.s)
        out.append(
            {
                "name": case["name"],
                "dt": float(case["dt"]),
                "r0": vec(orbit.r),
                "v0": vec(orbit.v),
                "r": vec(moved.r),
                "v": vec(moved.v),
            }
        )
    return out


# ---------------------------------------------------------------------------
# Lambert, via Izzo's algorithm (section 7.6 Tier 3).
#
# This is the row that closes the **multi-revolution** gap. `docs/PHYSICS.md` records
# that Curtis does not treat the multi-revolution case at all and that no other
# reference was held in this workspace, so #51 shipped that solver checked only
# against oracles internal to the repository. `izzo.lambert` takes `M` and both
# branches through `lowpath`, so it can check what Curtis cannot.
# ---------------------------------------------------------------------------

LAMBERT_CASES: list[dict] = [
    dict(name="zero-rev-short", r1=[15000.0, 0.0, 0.0], r2=[10000.0, 12000.0, 0.0], tof=6000.0, M=0, lowpath=True),
    dict(name="zero-rev-inclined", r1=[7000.0, 1000.0, 2000.0], r2=[-6000.0, 3000.0, 2500.0], tof=4000.0, M=0, lowpath=True),
    dict(name="zero-rev-long-tof", r1=[9000.0, 500.0, -1200.0], r2=[-3000.0, 9500.0, 800.0], tof=20000.0, M=0, lowpath=True),
    dict(name="zero-rev-high", r1=[42164.0, 0.0, 0.0], r2=[-20000.0, 37000.0, 0.0], tof=40000.0, M=0, lowpath=True),
    dict(name="one-rev-low", r1=[12000.0, 0.0, 0.0], r2=[6000.0, 10000.0, 1000.0], tof=32000.0, M=1, lowpath=True),
    dict(name="one-rev-high", r1=[12000.0, 0.0, 0.0], r2=[6000.0, 10000.0, 1000.0], tof=32000.0, M=1, lowpath=False),
    dict(name="two-rev-low", r1=[11000.0, 0.0, 0.0], r2=[4000.0, 9000.0, 2000.0], tof=52000.0, M=2, lowpath=True),
    dict(name="two-rev-high", r1=[11000.0, 0.0, 0.0], r2=[4000.0, 9000.0, 2000.0], tof=52000.0, M=2, lowpath=False),
    dict(name="three-rev-low", r1=[10500.0, 0.0, 0.0], r2=[-2000.0, 9800.0, -1500.0], tof=72000.0, M=3, lowpath=True),
    dict(name="three-rev-high", r1=[10500.0, 0.0, 0.0], r2=[-2000.0, 9800.0, -1500.0], tof=72000.0, M=3, lowpath=False),
]


def build_lambert() -> list[dict]:
    out = []
    for case in LAMBERT_CASES:
        r1 = np.array(case["r1"]) * u.km
        r2 = np.array(case["r2"]) * u.km
        v1, v2 = izzo.lambert(
            Earth.k,
            r1,
            r2,
            case["tof"] * u.s,
            M=case["M"],
            lowpath=case["lowpath"],
            numiter=LAMBERT_NUMITER,
            rtol=LAMBERT_RTOL,
        )
        out.append(
            {
                "name": case["name"],
                "revolutions": case["M"],
                "lowpath": case["lowpath"],
                "tof": float(case["tof"]),
                "r1": [x * KM for x in case["r1"]],
                "r2": [x * KM for x in case["r2"]],
                "v1": vec(v1),
                "v2": vec(v2),
            }
        )
    return out


# ---------------------------------------------------------------------------
# The ISS case (section 7.6 Tier 3, "real orbit").
#
# A TLE-derived state propagated one orbit against SGP4. **Agreement would be the
# wrong test** -- we have no J2 and no drag, so the two must disagree, and what is
# worth asserting is that the disagreement is the size the missing physics predicts.
#
# Frames: SGP4 produces TEME. The two-body comparison starts from the same TEME
# state and stays there, so no transform is involved and none can be got wrong. The
# fixture says TEME explicitly so a consumer cannot assume otherwise.
# ---------------------------------------------------------------------------

ISS_SAMPLES = 8

# Earth's J2 and equatorial radius, for the predicted magnitude below. From
# ATTRIBUTIONS.md's constants table, matching packages/astro/src/constants.ts.
J2_EARTH = 1.08262668e-3
R_EARTH_EQ = 6378137.0


def build_iss() -> dict:
    lines = [ln.rstrip("\n") for ln in TLE_FILE.read_text(encoding="utf-8").splitlines() if ln.strip()]
    name, line1, line2 = lines[0], lines[1], lines[2]

    sat = Satrec.twoline2rv(line1, line2)
    jd, fr = sat.jdsatepoch, sat.jdsatepochF
    err, r0_km, v0_km = sat.sgp4(jd, fr)
    if err != 0:
        raise RuntimeError(f"SGP4 failed at epoch: {SGP4_ERRORS.get(err, err)}")

    orbit = Orbit.from_vectors(Earth, np.array(r0_km) * u.km, np.array(v0_km) * u.km / u.s)
    period = float(orbit.period.to_value(u.s))

    samples = []
    for k in range(1, ISS_SAMPLES + 1):
        dt = period * k / ISS_SAMPLES
        err, r_sgp4, _ = sat.sgp4(jd, fr + dt / 86400.0)
        if err != 0:
            raise RuntimeError(f"SGP4 failed at +{dt} s: {SGP4_ERRORS.get(err, err)}")
        two_body = orbit.propagate(dt * u.s)
        separation = float(np.linalg.norm(np.array(r_sgp4) - two_body.r.to_value(u.km))) * KM
        samples.append(
            {
                "dt": dt,
                "sgp4_r": [x * KM for x in r_sgp4],
                "twobody_r": vec(two_body.r),
                "separation": separation,
            }
        )

    # What the missing physics predicts. The J2 acceleration at this radius is
    # 1.5 J2 mu Re^2 / r^4; over an elapsed time t an unmodelled constant
    # acceleration displaces a trajectory by about half a t squared. That is an
    # upper bound rather than an estimate -- J2's direction rotates with the orbit
    # so it partly averages out -- which is exactly the claim the test makes.
    r0 = float(np.linalg.norm(r0_km)) * KM
    j2_acceleration = 1.5 * J2_EARTH * MU * R_EARTH_EQ**2 / r0**4

    return {
        "frame": "TEME",
        "tle": {"name": name, "line1": line1, "line2": line2},
        "epoch_jd": jd + fr,
        "period": period,
        "r0": [x * KM for x in r0_km],
        "v0": [x * KM for x in v0_km],
        "j2_acceleration": j2_acceleration,
        "j2_displacement_bound": 0.5 * j2_acceleration * period**2,
        "samples": samples,
    }


def main() -> None:
    document = {
        "README": "Generated by tools/reference/generate.py. Do not edit by hand. See tools/reference/README.md.",
        "units": "SI throughout: metres, metres per second, seconds.",
        "mu": MU,
        "versions": {
            "python": platform.python_version(),
            "hapsira": version("hapsira"),
            "astropy": version("astropy"),
            "numpy": version("numpy"),
            "scipy": version("scipy"),
            "sgp4": version("sgp4"),
        },
        "lambert_solver": {"algorithm": "izzo", "rtol": LAMBERT_RTOL, "numiter": LAMBERT_NUMITER},
        "propagation": build_propagation(),
        "lambert": build_lambert(),
        "iss": build_iss(),
    }

    FIXTURES.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {FIXTURES.relative_to(HERE.parent.parent)}", file=sys.stderr)


if __name__ == "__main__":
    main()
