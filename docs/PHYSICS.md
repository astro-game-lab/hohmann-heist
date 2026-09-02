# Physics model — Hohmann Heist

This document is a contract, not a formality. It states what the simulation claims to be true, and how each claim was checked. A reviewer should be able to read it and know exactly how far to trust a number the game prints.

It is updated in the same pull request as any change to the model. If the simulation ever disagrees with a textbook, that is a bug — please [report it](https://github.com/astro-game-lab/hohmann-heist/issues/new/choose) using the physics discrepancy template.

## Status

| | |
| --- | --- |
| **Model** | Two-body, point-mass Earth. Impulsive (zero-duration) maneuvers. Massless targets. |
| **Fidelity claim** | Delta-v and time of flight for any closed transfer are intended to be exact to within float64 round-off of the closed-form two-body solution. **Not suitable for mission planning**: no drag, no J2, no third body. |
| **Propagation** | Analytic, via universal-variable Kepler propagation. No numerical integration in the game path. |
| **Last validated** | 2026-09-02 — constants, time, frames, the Kepler solvers, classical and equinoctial element ↔ Cartesian conversion, the closed-form two-body relations and transfers, and zero-revolution Lambert (against Curtis, both the elliptical and hyperbolic cases). Propagation does not exist yet; see [Validation](#validation) for exactly what is and is not checked. |

> **Read the validation section before trusting a number from this build.** At the time of writing the repository has constants, time, reference frames, the Kepler solvers, both element sets, the closed-form two-body relations, and Lambert's problem for the zero-revolution case — but **no propagation**, and no multi-revolution Lambert. Every validation row without a passing test names the issue that will provide it rather than being left to look covered.

## Conventions

These follow the [org defaults](https://github.com/astro-game-lab/.github/blob/main/CONTRIBUTING.md#physics-and-simulation-changes). There are no deviations.

| | |
| --- | --- |
| **Units** | SI throughout the core: metres, seconds, kilograms, radians. Conversion happens at the UI and file-format boundary only. |
| **Inertial frame** | ECI, J2000-aligned. Named `r_eci_m`, `v_eci_mps`. |
| **Other frames used** | **Perifocal (PQW)** for element → Cartesian conversion. **RTN/LVLH** (radial, transverse, normal) for expressing maneuver Δv relative to the spacecraft's instantaneous state — this is the only frame a player ever sees a vector in. |
| **Time scale** | **TAI**, as a float64 offset in seconds from the J2000 epoch. Mission elapsed time is a separate scalar starting at 0 per contract, and is what the UI shows. **Leap seconds are not implemented, so there is no TAI↔UTC conversion.** Nothing in v1.0 needs one: the UI shows mission elapsed time, and the daily-challenge key is a UTC calendar *date* used as a seed, never derived from an epoch. Calendar output is therefore labelled **TAI**, because a formatter that says UTC while doing TAI arithmetic is the kind of quiet lie this document exists to prevent. |
| **Angle normalization** | **`[0, 2π)`**, everywhere, without exception. Any function returning an angle normalizes before returning. |
| **Quadrant** | `atan2` only. `acos` on a dot product appears nowhere in the codebase. This is enforced as a lint rule, not left as a convention — see `eslint.config.js`. |
| **Precision** | Float64 for all simulation state; float32 only inside the renderer, after the camera transform. |
| **Dimensionality** | Vectors are 3D always. v1.0 content is coplanar and sets `z = 0`, but nothing in the core knows or cares, so inclination costs no rework later. |

### The RTN frame, stated precisely

For a spacecraft at `r`, `v`:

```
R̂ = r / |r|                     radial, outward
N̂ = (r × v) / |r × v|           normal, along angular momentum
T̂ = N̂ × R̂                      transverse, completing the right-handed set
```

`T̂` is *transverse*, not along-velocity: the two coincide only for circular orbits, and differ by the flight-path angle otherwise. The UI labels the transverse axis **"prograde"** because that is the word players know. That is a naming departure, not a physics one, and it is recorded as DEP-10 below.

## Constants

Every constant, its value, and its source. Kept in sync with `ATTRIBUTIONS.md`. Defined once, in `packages/astro/src/constants.ts`.

| Symbol | Value | Units | Source |
| --- | --- | --- | --- |
| `MU_EARTH` | 3.986004418e14 | m³ s⁻² | EGM-96 / WGS-84 |
| `R_EARTH_EQ` | 6378137.0 | m | WGS-84 semi-major axis |
| `J2_EARTH` | 1.08262668e-3 | — | EGM-96. **Stored, unused in v1.0** — present so a future J2 option has one source of truth. |
| `OMEGA_EARTH` | 7.2921150e-5 | rad s⁻¹ | IERS nominal mean sidereal rotation rate |
| `R_GEO` | 42164172.9 | m | **Derived**, not written down: `(μ/ω²)^(1/3)`. See below. |
| `AU` | 1.495978707e11 | m | IAU 2012 definition (exact). Reserved; nothing in v1.0 is heliocentric. |

### Two notes on the constants

**`R_GEO` is derived, deliberately.** A circular orbit is geostationary when its mean motion equals Earth's rotation rate, so `ω²r³ = μ`. An independently written literal can drift from the μ and ω it is supposed to follow from, and in an earlier draft of the product definition exactly that happened: a hard-coded `42164140.0` sat 33 m away from what these constants imply. Computing it makes that class of error impossible. The test asserts the defining relation, and separately checks the result against the independently published 42 164.17 km.

**`OMEGA_EARTH` carries a known 10 ms discrepancy.** The rounded IERS nominal value implies a sidereal day of 86 164.1006 s against the measured 86 164.0905 s. That is far below anything this game resolves, but it is real, and the test tolerance is set to admit exactly that difference rather than tightened until it passes.

## What is modelled

- Point-mass Newtonian gravity of a single central body (Earth).
- Keplerian orbits: elliptic, parabolic and hyperbolic, via the universal-variable formulation.
- Impulsive maneuvers: instantaneous change of velocity, with no change of position and no change of mass.
- Lambert's problem, zero- and multi-revolution, both transfer directions.
- Event finding: apsis crossings, closest approach between two objects, altitude-shell crossings, conical (ground-station) visibility, and cylindrical-shadow (umbra) intervals.
- Earth rotation, for ground-station positions only — a uniform rotation at `OMEGA_EARTH`. It affects nothing dynamical.

## What is neglected

Specific and quantitative, because "simplified" is not an answer.

| Neglected | Consequence |
| --- | --- |
| **Atmospheric drag** | Orbits below ~500 km will not decay. A real 400 km orbit loses roughly 1–2 km per day at solar maximum; ours loses nothing. This matters for contracts longer than a few days at low altitude, which is why the phasing contracts are ~12 h rather than weeks. |
| **J2 and higher geopotential** | No nodal regression (−4.98°/day at 400 km, i = 51.6°) and no apsidal precession. Sun-synchronous orbits cannot be modelled. Since v1.0 content is coplanar and equatorial-equivalent, the visible error is apsidal drift only, which is zero for the circular orbits that dominate the early contracts. **This is the largest single omission.** |
| **Third-body gravity (Moon, Sun)** | Negligible below ~50 000 km over hours. At the bi-elliptic contract's 108 450 km apogee over 17 days it is *not* negligible — a real spacecraft would need a mid-course correction there, and the Codex says so. |
| **Solar radiation pressure** | Around 10⁻⁷ m s⁻² for a typical spacecraft. Irrelevant at these timescales. |
| **Relativistic corrections** | Around 10⁻⁹ of the Newtonian term. Irrelevant. |
| **Finite burn duration** | See DEP-01. A 200 m/s burn on a real upper stage takes ~60 s and costs roughly 1% in gravity losses. |
| **Spacecraft mass and propellant** | See DEP-02. |
| **Target maneuvering** | Targets follow fixed Keplerian orbits and never react. |
| **Attitude dynamics** | The spacecraft points wherever the Δv vector says, instantly. |

## Domain of validity

- **Valid for:** closed orbits about Earth, altitudes from 100 km to about 400 000 km, eccentricity 0 ≤ e ≤ 0.95, timescales up to about 30 days.
- **Degrades when:** altitude below 200 km over multi-day spans (drag would dominate); beyond ~200 000 km over weeks (lunar third-body).

### Near-parabolic orbits, measured

Folklore says Kepler solvers fall over as e → 1. Ours do not, and the distinction matters enough to record the actual numbers.

| e | Worst residual | Max Newton iterations | Failures |
| --- | --- | --- | --- |
| 0.9 | 8.9 × 10⁻¹⁶ | 9 | 0 |
| 0.999 | 8.9 × 10⁻¹⁶ | 14 | 0 |
| 0.99999 | 8.9 × 10⁻¹⁶ | 19 | 0 |
| 0.9999999 | 8.9 × 10⁻¹⁶ | 20 (cap; fallback engages) | 0 |
| 1.000001 | 3.6 × 10⁻¹⁶ (relative) | — | 0 |
| 1.1 | 2.8 × 10⁻¹⁶ (relative) | — | 0 |

Sampled over 200 mean anomalies per eccentricity for the elliptic case, and ten spanning ±100 for the hyperbolic one.

**What actually degrades is iteration count, not accuracy** — and when Newton hits its cap the bracketed fallback takes over and still converges. What remains genuinely ill-conditioned near e = 1 is the *element set itself*: a small change in eccentric anomaly produces a large change in radius, so the elements stop being a good way to describe the orbit long before the solver stops being able to invert Kepler's equation. That is a representation problem, which the universal-variable formulation (#56) addresses, and it is why the UI switches to a state-vector readout above e = 0.95.

### Known singularities

Circular and equatorial orbits are the **common case** in this game, not an edge case, so these paths are the hot paths and are tested first.

| Singularity | Handling |
| --- | --- |
| **e = 0** — argument of periapsis undefined | In the classical set (`elements.ts`), detected at e < 1e-8: ω is suppressed and the true anomaly carries the argument of latitude. **The implementation wherever an element feeds logic is the equinoctial set** (`equinoctial.ts`), which has no case to detect — `f` and `g` are defined and continuous through e = 0. The UI shows "circular" and suppresses ω. Never an error. |
| **i = 0** — RAAN undefined | Classical: detected at **sin i < 1e-8**, which catches retrograde equatorial orbits (i near π) as well as prograde ones — the node vector vanishes at both ends, and a test on i alone would return a Ω derived from the direction of a zero-length vector. Equinoctial: no detection, `h` and `k` are continuous through i = 0. The UI suppresses Ω. Every v1.0 contract is equatorial-equivalent, so this is the ordinary path. |
| **e = 0 and i = 0** | Classical: both suppressed, true longitude the only angular element. Equinoctial: nothing suppressed. |
| **i = π** — the equinoctial chart's own pole | The equinoctial set is an **atlas of two charts**, selected by the retrograde factor `I = ±1`: `I = +1` is built on `tan(i/2)` and is regular at i = 0, `I = -1` on `cot(i/2)` and regular at i = π. Retrograde orbits are therefore supported rather than rejected. The chart is chosen by the sign of `h_z`, switching at **i = π/2** — as far from both poles as it is possible to get, where the two charts agree to round-off and the divisor is exactly 2. At i = π/2 exactly the chart a round trip returns in is decided by round-off; both describe the same orbit, and the conversion remains a pure function of the state, so determinism is unaffected. |
| **Lambert transfer angle 0 or π** | Rejected at construction with a typed error. At π the two positions do not span a plane and *every* plane containing the line is a valid answer; returning one would hide the rest. Near-π is not rejected but is ill-conditioned. |
| **Rectilinear orbits** — h = 0 | Rejected at construction with a typed error. Unreachable in normal play. |

## Gameplay departures

**Every place the game knowingly departs from the physics.** This is the honesty rule: simplifications are allowed, hiding them is not. Nothing in this table may live in `@hh/math`, `@hh/astro`, `@hh/propagation`, or `@hh/sim` — every row names a module in `@hh/game` or above, and the import direction is enforced in CI by `dependency-cruiser` (see `.dependency-cruiser.cjs`).

| ID | Departure | Lives in | Why | Player-visible? |
| --- | --- | --- | --- | --- |
| DEP-01 | **Impulsive burns** — zero duration, no gravity losses | `@hh/game` | Finite burns make planning about throttle timing rather than trajectory. Costs roughly 1% of Δv for large burns. | Yes — Codex, "Why burns are instant" |
| DEP-02 | **Δv as a scalar tank**; no mass, Isp or rocket equation | `@hh/game` | Propellant bookkeeping is a second learning curve. | Yes — the budget is labelled "Δv", not "fuel" |
| DEP-03 | **Rendezvous tolerance** 100 m and 0.5 m/s | `@hh/game` | Real proximity operations run to ~0.1 m/s over hours. Ours ends where the interesting part ends. | Yes — briefing and HUD |
| DEP-04 | **Intercept tolerance** 1 000 m | `@hh/game` | As above, for grab-and-go objectives. | Yes |
| DEP-05 | **Time acceleration** during execution, up to 100 000× | `@hh/game` | Nobody watches a 17-day transfer. | Yes — the rate is in the HUD |
| DEP-06 | **Fixed Sun direction** for the duration of a contract | `@hh/game` | Avoids an ephemeris dependency. The Sun moves 0.041°/h, so over a 12 h contract that is 0.5° of umbra rotation, well inside the eclipse-window tolerance. Contracts longer than 3 days do not use eclipse constraints. | Yes — Codex, and the briefing says "sun-fixed approximation" |
| DEP-07 | **Node snapping** to apsis or node crossing within 30 s | `@hh/game` | Hitting periapsis to the millisecond is not the fun part. Can be disabled. | Listed in the assist tray |
| DEP-08 | **Altitude floor** at 100 km is an instant fail | `@hh/game` | Stands in for drag and reentry, which are not modelled. | Yes — drawn as a hazard shell |
| DEP-09 | **Node epochs quantised** to 1/1024 s; Δv components to 1e-4 m/s | `@hh/game` | Exact representability for replay codes and cross-platform verification. Both quanta are far below any perceptible or scoring-relevant threshold. | No |
| DEP-10 | The transverse axis is **labelled "prograde"** | `@hh/game` | Player vocabulary. The two coincide for circular orbits and differ by the flight-path angle otherwise. | Yes — Codex, "Prograde vs transverse" |
| DEP-11 | **Targets are massless** and do not perturb the ship | `@hh/sim` *(assumption, not a cheat)* | A 5 t satellite's gravity at 100 m is about 3 × 10⁻⁹ m s⁻². Standard practice. | Yes — Codex |
| DEP-12 | **Par values are the best known**, not the proven optimum | `@hh/game` | For Lambert contracts the true optimum is a continuous search; ours is a fine grid refined by local optimisation. | Yes — the debrief invites a bug report if a player beats par |

## Validation

**Nothing below is assumed. Where a check does not exist yet, the row says so and names the issue that will provide it.** A validation table that implies coverage it does not have is worse than no table, because it converts an open question into false confidence.

### Tier 1 — closed form

Catches unit, frame and algebra errors. Cheap and fast.

| Property | Check | Status |
| --- | --- | --- |
| Constants finite, positive, singly defined | — | ✅ `constants.test.ts` |
| `R_GEO` satisfies ω²r³ = μ | Defining relation | ✅ `constants.test.ts` |
| `R_GEO` vs published 42 164.17 km | Independent source | ✅ `constants.test.ts`, 10 m tolerance |
| `OMEGA_EARTH` vs sidereal day | 86 164.0905 s | ✅ `constants.test.ts`, 20 ms tolerance |
| Orbital period | `T = 2π√(a³/μ)` | ✅ `twobody.test.ts`, against the measured sidereal day to 20 ms |
| Speed at radius | vis-viva, `v² = μ(2/r − 1/a)` | ✅ `twobody.test.ts`, against states built by `elements.ts` to 1e-14 |
| Circular speed | 7 668.6 m/s at 400 km; 3 074.66 m/s at GEO | ✅ `twobody.test.ts`, to 0.05 and 0.005 m/s — half an ulp of each printed digit |
| Hohmann Δv | LEO 400 km → GEO = 3 854.0 m/s (2 397.5 + 1 456.5) | ✅ `twobody.test.ts`, to 0.05 m/s |
| Hohmann time of flight | 19 048.6 s = 5.29 h | ✅ `twobody.test.ts`, to 0.05 s |
| Bi-elliptic threshold | Hohmann wins below r₂/r₁ = 11.94; bi-elliptic above 15.58 | ✅ `twobody.test.ts` — measured at 11.9388 and 15.5817. **The two numbers answer different questions;** see below |
| Element → Cartesian at periapsis | `r = a(1−e)`, `v = √(μ(1+e)/(a(1−e)))`, purely transverse | ✅ `elements.test.ts` |
| Converted state satisfies `\|r × v\| = √(μp)` | Definition of the semi-latus rectum | ✅ `elements.test.ts` |
| Converted state satisfies `ε = −μ/2a` | Energy integral; and `ε = 0` for the parabolic case | ✅ `elements.test.ts` |
| Specific energy sign per orbit class | `ε = v²/2 − μ/r`, negative / zero / positive | ✅ `twobody.test.ts`, one case per class, plus constancy over an orbit |
| Equinoctial ↔ Cartesian, both directions | Non-singular at `e = 0`, `sin i = 0`, and both | ✅ `equinoctial.test.ts` |

**On the bi-elliptic thresholds.** 11.94 and 15.58 are not the two ends of one comparison, and a test that treats them that way gets the second one wrong — a sweep that picks the best intermediate radius reproduces 11.94 and never sees 15.58. Below **11.94** Hohmann wins for *every* intermediate radius, because that is where the bi-elliptic with `r_b → ∞` — the best it can ever do — ties Hohmann. Above **15.58** bi-elliptic wins for *every* `r_b > r₂`, because that is where `∂Δv_bi/∂r_b` turns negative at `r_b = r₂`, so leaving the Hohmann geometry at all immediately pays. Between them it depends on `r_b`, which is the regime the bi-elliptic contract sits in. Both are dimensionless and independent of μ and of r₁, which is asserted rather than assumed.

### Tier 2 — properties

| Property | Status |
| --- | --- |
| Element ↔ Cartesian round-trip, including e = 0, i = 0, and both | ✅ `elements.test.ts` — a curated grid covering both conversion directions across every conic class and every degenerate combination, prograde and retrograde, to 1e-12. The **randomised** sweep is still ⏳ #53. |
| Specific orbital energy conserved over a full period | ⏳ #53 |
| Angular momentum conserved in magnitude and direction | ⏳ #53 |
| Kepler solver converges across e ∈ [0, 0.999] ∪ (1, 10] | ✅ `kepler.test.ts` — and cross-checked against an independent bisection to 1e-15 |
| Universal-variable vs classical elliptic solver agreement | ⏳ #53 |
| Lambert round-trip reproduces the target position | ✅ `lambert.test.ts` — propagating `r₁, v₁` for Δt through `elements.ts` and `kepler.ts` lands on `r₂` to 1e-9, with 2e-13 observed, across a grid of eccentricities and transfer angles |
| Lambert recovers a known orbit it was not told about | ✅ `lambert.test.ts` — an orbit sampled at two true anomalies, with the elapsed time from Kepler's equation, so the correct velocity is known exactly at both ends |
| Equinoctial ↔ Cartesian round-trip, including `i = π` | ✅ `equinoctial.test.ts` — a curated grid over `a ∈ [6.6e6, 4e8]`, `e ∈ [0, 0.95]` and every inclination including both chart poles, to 1e-12. The randomised sweep is still ⏳ #53 |
| Propagate +Δt then −Δt is the identity | ⏳ #53 |
| Determinism across runtimes | ⏳ #73 |

### Tier 3 — independent references

Closed-form tests share the code's assumptions and cannot catch a wrong constant or a misunderstood convention. These can.

| Case | Reference | Status |
| --- | --- | --- |
| State ↔ elements | Curtis, *Orbital Mechanics for Engineering Students*, 4th ed. (Elsevier, 2020), Examples 4.3 (§4.4, pp. 193–195) and 4.7 (§4.6, p. 211) | ✅ `elements.test.ts`, to 1e-3 relative — the book's printed precision, not a tuned tolerance. Read from the book per the §7.6 process rule. Covers the general and hyperbolic paths; the degenerate cases appear in neither example and rest on closed forms instead. |
| Kepler's equation | Vallado, *Fundamentals of Astrodynamics and Applications*, Ch. 2 | ⏳ #54 |
| Lambert | Curtis, *Orbital Mechanics for Engineering Students*, 4th ed. (Elsevier, 2020), §5.3, Examples 5.2 (pp. 245–247, elliptical) and 5.3 (pp. 248–249, hyperbolic) | ✅ `lambert.test.ts`, to 1e-3 relative on the derived elements and 3e-5 on the velocities — the book's printed precision, not a tuned tolerance. Read from that edition per the §7.6 process rule; the copy is a PDF whose text extraction loses minus signs, so every sign was re-derived from the book's own given data and intermediate quantities. Vallado Ch. 7 and the `poliastro.iod.izzo` cross-check remain ⏳ #54 |
| Two-body propagation over a range of a, e | `poliastro` / `astropy` fixture, generated by a committed script with a pinned version | ⏳ #55 |
| Real orbit | ISS TLE-derived state propagated one orbit vs SGP4 — asserts the *magnitude of the disagreement* matches what the model predicts, which is a stronger check than agreement | ⏳ #55 |

> **Process rule.** Every textbook citation is verified against the physical book by the person writing the test. No reference value may be copied out of `docs/PRODUCT.md` into a test without independent confirmation — that document's numbers were computed from these constants and are there to be *checked*, not trusted. This rule has already earned its keep: it is how the wrong `R_GEO` was found.

### Tier 4 — regression

| Property | Status |
| --- | --- |
| Golden trajectories: ~30 plans with states at fixed epochs, 1e-9 relative | ⏳ #71 |
| Contract solvability: every shipped contract's reference solution still meets its objective at par ± 0.5% | ⏳ #87 |

## Numerical notes

- **Integrator:** none in the game path. Propagation is analytic (universal-variable Kepler), so the state at time *t* is a pure function of the state at *t₀* and the elapsed time, and error does not accumulate with elapsed time. A DOP853 integrator ships in `@hh/propagation` **as a test oracle only** (#58).
- **Timestep:** not applicable to propagation. The game's fixed timestep governs playback, not state.
- **Tolerances:** solver convergence criteria and iteration caps are set per solver and recorded with it. Not yet implemented.
- **Cancellation risks:** specific orbital energy and the eccentricity vector both suffer catastrophic cancellation at low eccentricity. **This is not fixed by the equinoctial set, and it is worth being exact about what is.** The eccentricity *magnitude* at e = 1e-10 carries about 5e-16 of absolute error whichever way it is computed — measured for three formulations, all on the same floor, because that floor is the float64 representation of the state rather than a property of the algebra. What the equinoctial set fixes is the *periapsis direction*: ω is an angle to a direction of length e, so its error scales as 5e-16 / e and it loses a digit per decade (5.4e-12 rad at e = 1e-4, 1.7e-8 at e = 2e-8), and below the 1e-8 threshold the classical convention stops returning it at all. `f` and `g` are components of that direction and stay flat at 7e-16 across the whole range. That continuity — not better eccentricity — is why elements feeding logic use the equinoctial set.
- **Stumpff functions near zero:** `C(z) = (1 − cos √z)/z` and `S(z)` differ two nearly equal numbers, so both are evaluated by series below `|z| = 0.1`. At the other end the same cancellation sets a hard ceiling: within about 1.5e-8 of `√z = 2π`, `C` returns exactly zero and the Lambert time of flight comes back infinite. The zero-revolution search therefore stops at `4π² − 1e-4`, which still admits a transfer of roughly 4e19 s; beyond that the solver reports out-of-domain rather than answering from a `NaN`.
- **Julian Date precision:** a JD near 2 451 545 has a float64 ULP of about 5 × 10⁻¹⁰ days, or ~47 µs, and differencing two nearby Julian Dates loses that entirely to cancellation. The `Epoch` scalar does not have this problem — seconds past J2000 stay near 10⁹ at most, giving ~2 × 10⁻⁷ s resolution. Simulation arithmetic is done on epochs; Julian Dates and calendar dates appear only at display.
- **Cross-platform equality:** bit-identical results are **not** claimed. `Math.sin`, `Math.cos` and friends are not required to be correctly rounded and do differ between JavaScript engines. Determinism is achieved by quantising inputs (DEP-09) and scoring on rounded bands, not by assuming float equality.
