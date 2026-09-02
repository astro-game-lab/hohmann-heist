# Attributions

Third-party material bundled with or used by Hohmann Heist, and the terms it comes under.

Every asset, dataset, and kernel that this repository ships or downloads is listed here. If you add one, add its row in the same commit — an unattributed asset is a licensing bug, and CI cannot catch it for us.

## Assets

Art, audio, models, fonts, and other authored media.

| File / directory | Source | Author | Licence | Notes |
| --- | --- | --- | --- | --- |
| _none yet_ | | | | |

## Data

Ephemerides, SPICE kernels, TLE sets, planetary constants, imagery, and other datasets.

| File / directory | Source | Provider | Licence / terms | Retrieved |
| --- | --- | --- | --- | --- |
| _none yet_ | | | | |

Large data files should not be committed raw — link them or fetch them with a script, and record the source and retrieval date here either way. Note that most public ephemeris sources (JPL, CelesTrak, Space-Track) have their own terms of use and attribution requirements, and some prohibit redistribution.

## Physical constants

Values baked into the simulation, with their source. Keep this in sync with `docs/PHYSICS.md`.

| Constant | Value | Source |
| --- | --- | --- |
| `MU_EARTH` | 3.986004418e14 m³/s² | EGM-96 / WGS-84 geocentric gravitational constant |
| `R_EARTH_EQ` | 6378137.0 m | WGS-84 semi-major axis |
| `J2_EARTH` | 1.08262668e-3 | EGM-96. Stored but unused in v1.0 — the model is strictly two-body. |
| `OMEGA_EARTH` | 7.2921150e-5 rad/s | IERS nominal mean sidereal rotation rate. Implies an 86164.1006 s sidereal day against the measured 86164.0905 s; the 10 ms gap is documented in `docs/PHYSICS.md`. |
| `R_GEO` | 42164172.9 m | **Derived**, not sourced: `(μ/ω²)^(1/3)` from the two constants above. Agrees with the published 42164.17 km to 3 m. |
| `AU` | 1.495978707e11 m | IAU 2012 definition (exact). Reserved; unused in v1.0. |

## Software dependencies

Runtime and build dependencies are declared in the manifest and lockfile, and their licences travel with them; they are not duplicated here. Vendored or patched third-party source, however, goes in this table.

| Path | Upstream | Licence | Why vendored |
| --- | --- | --- | --- |
| _none_ | | | |

## Algorithms

Published algorithms implemented from their specifications, and the reference data used to validate them.

| Where | Algorithm | Source | Validation |
| --- | --- | --- | --- |
| `packages/math/src/rng.ts` | PCG32 (PCG-XSH-RR 64/32) | M. E. O'Neill, *PCG: A Family of Simple Fast Space-Efficient Statistically Good Algorithms for Random Number Generation* (2014); reference implementation at <https://www.pcg-random.org/>. Apache-2.0 / MIT. | Reference vectors from `pcg32-demo.c` for `seed=42, seq=54`, asserted in `rng.test.ts` |
| `packages/math/src/root.ts` | Brent's method | R. P. Brent, *Algorithms for Minimization without Derivatives* (1973), ch. 4 | Convergence and bracket-handling tests in `root.test.ts` |
| `packages/astro/src/elements.ts` | Classical elements ↔ Cartesian state (Algorithms 4.2 and 4.5) | H. D. Curtis, *Orbital Mechanics for Engineering Students*, 4th ed., Butterworth-Heinemann/Elsevier (2020), ISBN 978-0-08-102133-0 — §4.4 and §4.6 | Worked Examples 4.3 and 4.7 asserted in `elements.test.ts`, to the book's printed precision |
