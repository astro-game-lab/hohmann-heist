# Attributions

Third-party material bundled with or used by Hohmann Heist, and the terms it comes under.

Every asset, dataset, and kernel that this repository ships or downloads is listed here. If you add one, add its row in the same commit — an unattributed asset is a licensing bug, and CI cannot catch it for us.

## Assets

Art, audio, models, fonts, and other authored media.

| File / directory | Source | Author | Licence | Notes |
| --- | --- | --- | --- | --- |
| `apps/web/src/icons/index.tsx` | This repository | Hohmann Heist contributors | [CC BY 4.0](LICENSE-ASSETS.md) | §9.6's icon set: hand-drawn inline SVG on a 24-unit grid, no icon font and no third-party glyph source. Listed because §9.6 asks for a row per asset, not because anything here is borrowed. |

## Data

Ephemerides, SPICE kernels, TLE sets, planetary constants, imagery, and other datasets.

| File / directory | Source | Provider | Licence / terms | Retrieved |
| --- | --- | --- | --- | --- |
| `packages/render/data/coastlines-110m.json` | <https://naciscdn.org/naturalearth/110m/physical/ne_110m_coastline.zip> | Natural Earth (Nathaniel Vaughn Kelso, Tom Patterson, and contributors) | Public domain. Natural Earth asks for no attribution and grants none exclusively; the row is here because §9.6 requires every third-party asset to carry one. Release 4.1.0, SHA-256 `664449b3…f64817`, pinned in `tools/coastlines/process.mjs`. | 2026-09-03 |
| `tools/reference/iss-tle.txt` | <https://celestrak.org/NORAD/elements/gp.php?CATNR=25544> | CelesTrak (Dr. T. S. Kelso) | The orbital data originates in the US Space Force's public catalogue; CelesTrak redistributes it and asks that the source be cited. One three-line TLE for ISS (ZARYA), NORAD ID 25544, epoch 2026-09-03. | 2026-09-03 |

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

### The offline reference-fixture generator

`tools/reference/` is a Python project that regenerates `tools/reference/fixtures.json`,
the Tier 3 external-library reference. **It ships nothing.** CI never installs or runs
it, no dependency below reaches the browser bundle, and the committed fixture is the
only artefact the test suite reads. The versions are pinned in
`tools/reference/pyproject.toml`, locked in `tools/reference/uv.lock`, and recorded
inside the fixture itself so a number can always be traced to what produced it.

Listed here rather than left to the lockfile because these libraries are the *source*
of reference values this repository asserts against, which makes them evidence rather
than build machinery.

| Package | Version | Licence | Used for |
| --- | --- | --- | --- |
| `hapsira` | 0.18.0 | MIT | The maintained fork of the archived `poliastro`. Farnocchia two-body propagation, and Izzo's Lambert solver — the only external reference held here for the **multi-revolution** case. |
| `astropy` | 6.1.7 | BSD-3-Clause | Units, time scales and the orbit machinery `hapsira` is built on. Pinned below 8; see `tools/reference/README.md` for why that pin is load-bearing. |
| `sgp4` | 2.27 | MIT (© 2012–2016 Brandon Rhodes) | The reference SGP4 implementation, for the ISS real-orbit case. |
| `numpy` | 1.26.4 | BSD-3-Clause | Array arithmetic beneath the above. |
| `scipy` | 1.17.1 | BSD-3-Clause | Root finding beneath `hapsira`. |

## Algorithms

Published algorithms implemented from their specifications, and the reference data used to validate them.

| Where | Algorithm | Source | Validation |
| --- | --- | --- | --- |
| `packages/math/src/rng.ts` | PCG32 (PCG-XSH-RR 64/32) | M. E. O'Neill, *PCG: A Family of Simple Fast Space-Efficient Statistically Good Algorithms for Random Number Generation* (2014); reference implementation at <https://www.pcg-random.org/>. Apache-2.0 / MIT. | Reference vectors from `pcg32-demo.c` for `seed=42, seq=54`, asserted in `rng.test.ts` |
| `tools/coastlines/process.mjs` | Douglas–Peucker line simplification, on the sphere | D. H. Douglas and T. K. Peucker, *Algorithms for the reduction of the number of points required to represent a digitized line or its caricature*, Cartographica 10:2 (1973), 112–122 | Point-reduction ratio and output size asserted in `coastlines.test.ts`; the tolerance is stated against §9.3's 0.5 px screen budget rather than tuned |
| `packages/math/src/root.ts` | Brent's method | R. P. Brent, *Algorithms for Minimization without Derivatives* (1973), ch. 4 | Convergence and bracket-handling tests in `root.test.ts` |
| `packages/astro/src/elements.ts` | Classical elements ↔ Cartesian state (Algorithms 4.2 and 4.5) | H. D. Curtis, *Orbital Mechanics for Engineering Students*, 4th ed., Butterworth-Heinemann/Elsevier (2020), ISBN 978-0-08-102133-0 — §4.4 and §4.6 | Worked Examples 4.3 and 4.7 asserted in `elements.test.ts`, to the book's printed precision |
| `packages/astro/src/kepler.ts` | Kepler's equation — elliptic, hyperbolic, and Barker's equation for the parabolic case | D. A. Vallado, *Fundamentals of Astrodynamics and Applications*, 4th ed., Microcosm Press/Springer (2013), ISBN 978-1-881883-18-0 — §2.2, Algorithms 2, 3 and 4 | Worked Examples 2-1, 2-2 and 2-3 asserted in `kepler.test.ts`. Example 2-1 agrees to **one ulp**: the book prints fifteen significant figures and its answer satisfies Kepler's equation to round-off, so the tolerance there is ours rather than the book's |
| `packages/astro/src/lambert.ts` | Lambert's problem, universal-variable formulation | Curtis §5.3 Algorithm 5.2 (zero revolution); Vallado §7.6 (universal variables); D. Izzo, *Revisiting Lambert's problem*, Celest. Mech. Dyn. Astron. 121 (2015), via `hapsira.iod.izzo` as a fixture only | Curtis Examples 5.2 and 5.3 and Vallado Example 7-5 asserted in `lambert.test.ts`; `hapsira`'s Izzo solver in `tools/reference/`, which is the only external check on the multi-revolution branches |
| `packages/propagation/src/universal.ts` | Universal-variable Kepler propagation | D. A. Vallado, *Fundamentals of Astrodynamics and Applications*, 4th ed. — §2.3, Algorithm 8 | Worked Example 2-4 asserted in `universal.test.ts`, and sixteen `hapsira` Farnocchia cases in `tools/reference/`, agreeing to 6.7e-15 |
