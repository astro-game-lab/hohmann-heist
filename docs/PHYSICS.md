# Physics model — __GAME_NAME__

> **This document is a contract, not a formality.** It states what the simulation claims to be true, and how each claim was checked. A reviewer should be able to read it and know exactly how far to trust a number the game prints. Fill it in before the first release, and update it in the same PR as any change to the model.
>
> Delete this blockquote once you have.

## Status

| | |
| --- | --- |
| **Model** | _e.g. two-body, patched conic, J2-perturbed_ |
| **Fidelity claim** | _e.g. "Delta-v budgets accurate to <0.1% vs. closed form; not suitable for real mission planning"_ |
| **Last validated** | _date, and against what_ |

## Conventions

These follow the [org defaults](https://github.com/astro-game-lab/.github/blob/main/CONTRIBUTING.md#physics-and-simulation-changes). Note any deviation explicitly.

| | |
| --- | --- |
| **Units** | SI throughout the core: metres, seconds, kilograms, radians. Conversion happens at the UI and file-format boundary only. |
| **Inertial frame** | _e.g. ECI, J2000/ICRF-aligned_ |
| **Other frames used** | _e.g. perifocal for element conversion; ECEF for ground tracks_ |
| **Time scale** | _e.g. TAI internally, seconds past J2000; UTC only for display_ |
| **Angle normalization** | _`[0, 2π)` or `(-π, π]` — pick one and say which_ |
| **Precision** | Float64 for simulation state; float32 only in the renderer. |

## Constants

Every constant, its value, and its source. Keep in sync with `ATTRIBUTIONS.md`.

| Symbol | Value | Units | Source |
| --- | --- | --- | --- |
| `MU_EARTH` | 3.986004418e14 | m³/s² | EGM-96 / WGS-84 |
| `R_EARTH_EQ` | 6378137.0 | m | WGS-84 semi-major axis |

## What is modelled

- _e.g. Two-body point-mass gravity of a single central body._
- _e.g. Impulsive maneuvers (instantaneous delta-v)._

## What is neglected

Be specific and quantitative where you can — "we neglect drag, which matters below ~500 km over timescales longer than a few days" is useful; "simplified" is not.

- _e.g. Atmospheric drag. Consequence: orbits below ~400 km will not decay._
- _e.g. Third-body perturbations from the Moon and Sun._
- _e.g. J2 and higher-order geopotential. Consequence: no nodal regression, so sun-synchronous orbits cannot be modelled._
- _e.g. Solar radiation pressure; relativistic corrections._

## Domain of validity

Where the model is trustworthy, and where it stops being so.

- **Valid for:** _e.g. closed orbits around a single body, eccentricity 0 ≤ e < 0.99, timescales up to weeks._
- **Breaks down when:** _e.g. e → 1 (near-parabolic; the Kepler solver falls back to bisection and loses precision), altitudes below ~200 km (drag dominates), or near the sphere-of-influence boundary._
- **Known singularities:** circular orbits (argument of periapsis undefined) and equatorial orbits (RAAN undefined). State how the code handles each — a convention, an equinoctial formulation, or an explicit error.

## Gameplay departures

**Every place the game layer knowingly departs from the physics goes here.** This is the honesty rule: simplifications are allowed, hiding them is not. Cross-reference the corresponding section of `docs/DESIGN.md`.

| Departure | Where it lives | Why | Player-visible? |
| --- | --- | --- | --- |
| _e.g. Time acceleration up to 10000×_ | `src/game/` | Playability | Yes, shown in HUD |
| _e.g. Maneuver nodes snap to periapsis within 30 s_ | `src/game/` | Precision is not the fun part | No |

Nothing in this table may live in the simulation core.

## Validation

How each claim above was checked. Every row points at a test. The properties below are the ones worth covering for a two-body model — fill in the test column as you write them, and add rows as the model grows.

| Property | Method | Reference | Test |
| --- | --- | --- | --- |
| Orbital period | Closed form, Kepler's third law | T = 2π√(a³/μ) | _todo_ |
| Speed at radius | Closed form, vis-viva | v² = μ(2/r − 1/a) | _todo_ |
| Element ↔ Cartesian | Round-trip identity | — | _todo_ |
| Energy & angular momentum | Conserved over a full orbit | — | _todo_ |
| Kepler solver | Convergence across the eccentricity range | — | _todo_ |
| Determinism | Same seed ⇒ identical trajectory | — | _todo_ |

### External references

Closed-form tests catch unit, frame, and algebra errors, but they **cannot** catch a wrong constant or a misunderstood convention — the test and the code share the same mistake. Validate against an independent implementation too, and record it here:

- **GMAT** — mission-level trajectories and force models.
- **JPL Horizons** — ephemerides and real-body state vectors.
- **`poliastro` / `astropy` / `skyfield`** — element conversions, time scales, frame transforms.
- **Published worked examples** — Vallado, *Fundamentals of Astrodynamics and Applications*; Curtis, *Orbital Mechanics for Engineering Students*; Battin. Cite edition and example number.

| Case | Reference source | Reference value | Our value | Agreement |
| --- | --- | --- | --- | --- |
| _none yet_ | | | | |

## Numerical notes

- **Integrator:** _which one, fixed or adaptive, and why._
- **Timestep:** _value, and what set it._
- **Tolerances:** _solver convergence criteria and iteration caps._
- **Known drift:** _e.g. energy drift over 10⁴ orbits, measured._
- **Cancellation risks:** watch specific-energy and eccentricity-vector computations at low eccentricity.
