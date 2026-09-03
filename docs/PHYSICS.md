# Physics model — Hohmann Heist

This document is a contract, not a formality. It states what the simulation claims to be true, and how each claim was checked. A reviewer should be able to read it and know exactly how far to trust a number the game prints.

It is updated in the same pull request as any change to the model. If the simulation ever disagrees with a textbook, that is a bug — please [report it](https://github.com/astro-game-lab/hohmann-heist/issues/new/choose) using the physics discrepancy template.

## Status

| | |
| --- | --- |
| **Model** | Two-body, point-mass Earth. Impulsive (zero-duration) maneuvers. Massless targets. |
| **Fidelity claim** | Delta-v and time of flight for any closed transfer are intended to be exact to within float64 round-off of the closed-form two-body solution. **Not suitable for mission planning**: no drag, no J2, no third body. |
| **Propagation** | Analytic, via universal-variable Kepler propagation. No numerical integration in the game path. |
| **Last validated** | 2026-09-02 — constants, time, frames, the Kepler solvers, classical and equinoctial element ↔ Cartesian conversion, the closed-form two-body relations and transfers, Lambert for zero and multiple revolutions, and the five event finders (apsis, closest approach, altitude shell, ground-station visibility, umbra). Zero-revolution Lambert is checked against Curtis, both the elliptical and hyperbolic cases; **the multi-revolution case has no external reference yet** — Curtis does not treat it — and rests on the in-repository oracles alone. Propagation is now analytic and checked against a numerical oracle across all three conic classes; **it still has no external Tier 3 reference** (⏳ #55). The event finders are checked against closed forms independent of their implementation and, where one exists, against a published figure; **the eclipse figures are widely quoted rather than a single citable worked example**, which the Tier 3 table says explicitly. Plan evaluation now has a timeline — arcs and impulses over a horizon, `stateAt`, and incremental re-evaluation — checked as *properties*: determinism in-process, continuity across arc boundaries, and bit-identity between an incremental re-evaluation and a full rebuild. There is no external reference for an evaluation structure and none is claimed; what is checked is that it agrees with itself and with the propagator underneath it. See [Validation](#validation) for exactly what is and is not checked. |

> **Read the validation section before trusting a number from this build.** At the time of writing the repository has constants, time, reference frames, the Kepler solvers, both element sets, the closed-form two-body relations, Lambert's problem for zero and multiple revolutions, **universal-variable propagation with the arc abstraction over it**, and **the timeline that turns a plan into a trajectory**. What propagation still lacks is an *independent* reference: it is checked against a numerical integrator that lives in this repository, not against `poliastro` or JPL Horizons. Every validation row without a passing test names the issue that will provide it rather than being left to look covered.

## Conventions

These follow the [org defaults](https://github.com/astro-game-lab/.github/blob/main/CONTRIBUTING.md#physics-and-simulation-changes). There are no deviations.

| | |
| --- | --- |
| **Units** | SI throughout the core: metres, seconds, kilograms, radians. Conversion happens at the UI and file-format boundary only. |
| **Inertial frame** | ECI, J2000-aligned. Named `r_eci_m`, `v_eci_mps`. |
| **Other frames used** | **Perifocal (PQW)** for element → Cartesian conversion. **RTN/LVLH** (radial, transverse, normal) for expressing maneuver Δv relative to the spacecraft's instantaneous state — this is the only frame a player ever sees a vector in. |
| **Time scale** | **TAI**, as a float64 offset in seconds from the J2000 epoch. Mission elapsed time is a separate scalar starting at 0 per contract, and is what the UI shows. **Leap seconds are not implemented, so there is no TAI↔UTC conversion.** Nothing in v1.0 needs one: the UI shows mission elapsed time, and the daily-challenge key is a UTC calendar *date* used as a seed, never derived from an epoch. Calendar output is therefore labelled **TAI**, because a formatter that says UTC while doing TAI arithmetic is the kind of quiet lie this document exists to prevent. |
| **Angle normalization** | **`[0, 2π)`** for every *circular* angle — anomalies, node angles, arguments, phases — and any function returning one normalizes before returning. **Two angles are not circular and are not normalized:** hyperbolic anomaly, which is not periodic, and **topocentric elevation**, which is a latitude-like coordinate on `[-π/2, π/2]` whose sign is its entire content. Wrapping an elevation of −10° to 350° would make `elevation ≥ mask` true for every spacecraft on the far side of the planet. This document previously said "without exception"; the exceptions were already there, and stating them is better than a rule the code has to quietly break. |
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

**Impulses do not add in RTN components.** The basis is attached to the state, and an impulse changes that state: `r` survives it, so `R̂` does, but `v` changes, so `r × v` moves and `N̂` and `T̂` rotate with it. Applying `a` then `b` is therefore *not* applying `a + b` — the two delta-vs were read in different bases. §13.3's "two impulses at the same epoch equal their vector sum" is true in the **inertial** frame, which is where the addition actually happens, and `maneuver.test.ts` asserts it in that form and measures the gap left by the naive reading. A plan cannot reach the ambiguous case in any event: FR-101 keeps consecutive nodes at least a second apart.

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
- Plan evaluation: a plan applied to an initial state over a horizon, as an alternating sequence of Keplerian arcs and instantaneous impulses, evaluable at any epoch inside that horizon and re-evaluable from an edited node onward.
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

**What actually degrades is iteration count, not accuracy** — and when Newton hits its cap the bracketed fallback takes over and still converges. What remains genuinely ill-conditioned near e = 1 is the *element set itself*: a small change in eccentric anomaly produces a large change in radius, so the elements stop being a good way to describe the orbit long before the solver stops being able to invert Kepler's equation. That is a representation problem, which the universal-variable formulation now in `@hh/propagation` addresses — it never forms the elements at all — and it is why the UI switches to a state-vector readout above e = 0.95.

### Time reversal, measured

§13.3 asks that propagating +Δt then −Δt return the initial state to 1e-12 relative, for Δt across [−30 d, +30 d]. **That is not attainable in float64 across the whole element domain, and the shortfall is a property of the state representation rather than of the solver.** Recording what actually holds is more useful than recording the requirement.

Reversing a propagation starts from a state that is itself known only to about one `eps`. Kepler dynamics amplify that: an energy error becomes a period error, which becomes an along-track error growing with every revolution; and near periapsis of an eccentric orbit the same displacement in time is a much larger displacement in space. Worst relative error over `a` ∈ [6.6e6, 4e8] m, five true anomalies and both signs of Δt:

| e | 1 rev | 10 rev | 100 rev |
| --- | --- | --- | --- |
| 0.00 | 8.6 × 10⁻¹⁵ | 7.4 × 10⁻¹⁴ | 8.2 × 10⁻¹³ |
| 0.30 | 1.1 × 10⁻¹⁴ | 2.2 × 10⁻¹³ | 2.1 × 10⁻¹² |
| 0.60 | 1.0 × 10⁻¹³ | 8.3 × 10⁻¹³ | 7.5 × 10⁻¹² |
| 0.80 | 4.7 × 10⁻¹³ | 5.7 × 10⁻¹² | 3.1 × 10⁻¹¹ |
| 0.90 | 3.2 × 10⁻¹² | 2.6 × 10⁻¹¹ | 2.6 × 10⁻¹⁰ |
| 0.95 | 1.9 × 10⁻¹¹ | 1.9 × 10⁻¹⁰ | 1.9 × 10⁻⁹ |

Every cell is `8 × 10⁻¹⁵ · N · (1 − e)^−2.5` to within a factor of 1.3, across three decades of revolutions and three of eccentricity. The linear growth in N and the divergence as e → 1 are both expected; **the exponent 2.5 is fitted to this table, not derived**, and is stated that way deliberately.

**§13.3's flat 1e-12 does hold wherever `N · (1 − e)^−2.5 ≤ 60`** — measured, not solved for, since the fit's own spread puts the analytic crossing higher than the observed one. A near-circular orbit therefore satisfies the requirement literally for sixty revolutions, which covers every v1.0 contract: the longest routine one is twelve hours, or about seven and a half LEO revolutions.

None of this is improved by a better propagator. The binding constraint is that a float64 state determines its own orbital period to about one `eps`, and a few hundred revolutions amplify that to the numbers above. It is recorded here rather than hidden behind a loosened tolerance.

### Known singularities

Circular and equatorial orbits are the **common case** in this game, not an edge case, so these paths are the hot paths and are tested first.

| Singularity | Handling |
| --- | --- |
| **e = 0** — argument of periapsis undefined | In the classical set (`elements.ts`), detected at e < 1e-8: ω is suppressed and the true anomaly carries the argument of latitude. **The implementation wherever an element feeds logic is the equinoctial set** (`equinoctial.ts`), which has no case to detect — `f` and `g` are defined and continuous through e = 0. The UI shows "circular" and suppresses ω. Never an error. |
| **i = 0** — RAAN undefined | Classical: detected at **sin i < 1e-8**, which catches retrograde equatorial orbits (i near π) as well as prograde ones — the node vector vanishes at both ends, and a test on i alone would return a Ω derived from the direction of a zero-length vector. Equinoctial: no detection, `h` and `k` are continuous through i = 0. The UI suppresses Ω. Every v1.0 contract is equatorial-equivalent, so this is the ordinary path. |
| **e = 0 and i = 0** | Classical: both suppressed, true longitude the only angular element. Equinoctial: nothing suppressed. |
| **i = π** — the equinoctial chart's own pole | The equinoctial set is an **atlas of two charts**, selected by the retrograde factor `I = ±1`: `I = +1` is built on `tan(i/2)` and is regular at i = 0, `I = -1` on `cot(i/2)` and regular at i = π. Retrograde orbits are therefore supported rather than rejected. The chart is chosen by the sign of `h_z`, switching at **i = π/2** — as far from both poles as it is possible to get, where the two charts agree to round-off and the divisor is exactly 2. At i = π/2 exactly the chart a round trip returns in is decided by round-off; both describe the same orbit, and the conversion remains a pure function of the state, so determinism is unaffected. |
| **Lambert transfer angle 0 or π** | Rejected at construction with a typed error. At π the two positions do not span a plane and *every* plane containing the line is a valid answer; returning one would hide the rest. Near-π is not rejected but is ill-conditioned. |
| **Lambert Δt at the N-revolution minimum** — the two branches coincide | Returned **once**, tagged `'minimum'`, rather than as two identical entries or as neither. The two roots of an N-revolution interval sit either side of the time-of-flight minimum and merge onto it; below it no such transfer exists and the solver reports `out-of-domain`. Asking for the `'low'` or `'high'` label there returns the same coincident transfer, so a stored plan re-solves whichever label it carries. |
| **Lambert near-collinear at a revolution boundary** | Not rejected, but the usable interval is trimmed. At the lower boundary of an N-revolution interval `y → r₁ + r₂ − √2·A`, and `A → √2·√(r₁r₂)` as the transfer angle closes, so `y` approaches `(√r₁ − √r₂)²` — zero for equal radii. The interval's ends are walked inward until `y > 0` and the time of flight is finite, rather than the geometry being refused outright. |
| **Rectilinear orbits** — h = 0 | Rejected at construction with a typed error. **Reachable from a legal plan**, though not in normal play: a burn that exactly cancels the transverse velocity leaves position and velocity parallel, and there is nothing in FR-101 to forbid authoring one. The timeline therefore *returns* it as a `rectilinear` failure rather than throwing — the planner re-evaluates on every frame of a node drag, and "that burn is not physical" has to be something the UI can show rather than something that crashes it. |

## Gameplay departures

**Every place the game knowingly departs from the physics.** This is the honesty rule: simplifications are allowed, hiding them is not. No row that is a *simplification for fun* may live in `@hh/math`, `@hh/astro`, `@hh/propagation`, or `@hh/sim` — each of those names a module in `@hh/game` or above, and the import direction is enforced in CI by `dependency-cruiser` (see `.dependency-cruiser.cjs`).

Two rows sit in the core and are marked accordingly, because they are not simplifications for fun and the table would be misleading if it implied they were. DEP-09 is a determinism mechanism (§11.4 lists it as one), and DEP-11 is a modelling assumption with a magnitude attached. They are listed here because they are still departures a player is entitled to know about, not because they are cheats.

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
| DEP-09 | **Node epochs quantised** to 1/1024 s; Δv components to 1e-4 m/s | `@hh/sim` *(determinism mechanism, not a cheat)* | Exact, identical input for replay codes and cross-platform verification (§11.4). What is exactly representable is the **integer count**, not the SI quantity: 1/1024 is a binary fraction and an epoch tick really is exact, but 1e-4 is not, so a quantised Δv is the correctly-rounded product and not the decimal it prints as. Both quanta are far below any perceptible or scoring-relevant threshold. | No |
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
| Impulsive Δv leaves the position untouched | FR-006 | ✅ `maneuver.test.ts` — by object identity, so there is no tolerance to argue about |
| Transverse Δv on a circular orbit adds to the speed | Flight-path angle is zero there, so the answer is closed-form | ✅ `maneuver.test.ts`, to 1e-9 m/s; radial Δv checked to add in quadrature |
| RTN axes lie where this document says | R along `r`, N along `r × v`, T completing the set | ✅ `maneuver.test.ts` — asserted per axis, because every Δv in the game points somewhere else if one moved |
| Epoch tick is exactly representable | 1/1024 is a binary fraction | ✅ `quantise.test.ts` — `toBe`, not `toBeCloseTo`, in both directions and at a realistic 2026 epoch |
| Apsis epochs satisfy the definition of an apsis | `r · v = 0` and `r = a(1 ∓ e)`, evaluated by the **DOP853 oracle** rather than by the analytic propagator the epochs came from | ✅ `apsis.test.ts` — normalised radial rate below 1e-11 across elliptic, hyperbolic and parabolic conics, prograde, retrograde and polar |
| Periapsis spacing | `T = 2π√(a³/μ)`, Kepler's third law | ✅ `apsis.test.ts`, to 1e-6 s over five revolutions; apoapsis lands at exactly `T/2` |
| Shell crossings lie on the shell | `\|r\| = R` at every unclipped boundary, again through the oracle | ✅ `shell.test.ts`, to 1e-9 relative, with the radius strictly smaller inside the interval and strictly larger 60 s either side |
| Closest approach of two coplanar circular orbits | `r₂ − r₁` at each conjunction, recurring at the synodic period `2π/\|n₁−n₂\|`, at relative speed `\|√(μ/r₁) − √(μ/r₂)\|` | ✅ `approach.test.ts`, to 1e-9 relative on all three quantities |
| Separation of co-orbiting bodies at a fixed phase offset | The chord `2r sin(Δν/2)` | ✅ `approach.test.ts`, to 1e-11 relative — and the case that exercises the tie-break, since every instant is a minimum |
| Ground-station pass duration | `λT/π`, with `cos(ε+λ) = (R/r)cos ε` from the sine rule on the centre–station–spacecraft triangle | ✅ `station.test.ts`, to 1e-9 relative at 0°, 5° and 10° masks, with the station's rotation rate set to zero so the closed form is exact rather than approximate |
| Eclipse duration, circular orbit, Sun in plane | `T·asin(R/r)/π` | ✅ `umbra.test.ts`, to 1e-9 relative at 400 km and at GEO |
| Grazing eclipse boundary | A circular orbit is eclipsed only while `sin β < R/r` | ✅ `umbra.test.ts` — empty above it, non-empty below it, and no zero-width interval at it |

**On the bi-elliptic thresholds.** 11.94 and 15.58 are not the two ends of one comparison, and a test that treats them that way gets the second one wrong — a sweep that picks the best intermediate radius reproduces 11.94 and never sees 15.58. Below **11.94** Hohmann wins for *every* intermediate radius, because that is where the bi-elliptic with `r_b → ∞` — the best it can ever do — ties Hohmann. Above **15.58** bi-elliptic wins for *every* `r_b > r₂`, because that is where `∂Δv_bi/∂r_b` turns negative at `r_b = r₂`, so leaving the Hohmann geometry at all immediately pays. Between them it depends on `r_b`, which is the regime the bi-elliptic contract sits in. Both are dimensionless and independent of μ and of r₁, which is asserted rather than assumed.

### Tier 2 — properties

| Property | Status |
| --- | --- |
| Element ↔ Cartesian round-trip, including e = 0, i = 0, and both | ✅ `elements.test.ts` — a curated grid covering both conversion directions across every conic class and every degenerate combination, prograde and retrograde, to 1e-12. The **randomised** sweep is still ⏳ #53. |
| Specific orbital energy conserved over a full period | ⏳ #53 |
| Angular momentum conserved in magnitude and direction | ⏳ #53 |
| Kepler solver converges across e ∈ [0, 0.999] ∪ (1, 10] | ✅ `kepler.test.ts` — and cross-checked against an independent bisection to 1e-15 |
| Universal-variable vs classical elliptic solver agreement | ✅ `universal.test.ts` — worst 1.5e-12 over `a` ∈ [6.6e6, 4e8], `e` ∈ [0, 0.95] and spans from 1% to 17 periods, against the requirement's 1e-11 |
| Lambert round-trip reproduces the target position | ✅ `lambert.test.ts` — propagating `r₁, v₁` for Δt through `elements.ts` and `kepler.ts` lands on `r₂` to 1e-9, with 2e-13 observed, across a grid of eccentricities and transfer angles |
| Lambert recovers a known orbit it was not told about | ✅ `lambert.test.ts` — an orbit sampled at two true anomalies, with the elapsed time from Kepler's equation, so the correct velocity is known exactly at both ends |
| Multi-revolution Lambert recovers an orbit it was not told about | ✅ `lambert.test.ts` — the same oracle with N whole periods added to the elapsed time, so the orbit is one of the N-revolution transfers and its velocity is still known exactly. Six geometries × 1, 2 and 3 revolutions; exactly one returned branch matches, and it is the N-revolution one |
| Every returned Lambert branch reproduces the target position | ✅ `lambert.test.ts` — all 158 branches over that grid propagate to `r₂` to 1e-9, worst observed 1.1e-11. This is what stops a second branch from being decoration: a misplaced minimum, a root returned twice under two labels, or a residual never driven to zero all fail here |
| Multi-revolution branch count follows the time of flight | ✅ `lambert.test.ts` — zero branches below the N-revolution minimum and two above it, at every N tested; the ceiling `N ≤ Δt / (2π√((s/2)³/μ))` is checked against transfers that demonstrably exist, and asking beyond it returns `out-of-domain` rather than a wrong transfer |
| Lambert branch order is stable | ✅ `lambert.test.ts` — the exact sequence `(0, single), (1, low), (1, high), …` asserted, not incidental. §11.4 requires a stored plan's branch reference to mean the same transfer on every runtime |
| Lambert low branch is the higher-energy transfer | ✅ `lambert.test.ts` — the low branch's semi-major axis exceeds the high branch's across every geometry and revolution count tested. Recorded as a measured property, not as the branch naming: `a` is not monotone along the high branch, so "low-energy" would not pick out one of the two |
| Equinoctial ↔ Cartesian round-trip, including `i = π` | ✅ `equinoctial.test.ts` — a curated grid over `a ∈ [6.6e6, 4e8]`, `e ∈ [0, 0.95]` and every inclination including both chart poles, to 1e-12. The randomised sweep is still ⏳ #53 |
| Propagate +Δt then −Δt is the identity | ✅ `universal.test.ts` — **not** to a flat 1e-12 across the whole domain; see [Time reversal, measured](#time-reversal-measured) for what actually holds and why |
| Analytic propagation vs a numerical integrator | ✅ `crosscheck.test.ts` — elliptic, near-parabolic and hyperbolic, agreeing to 4e-14–7e-12, inside the oracle's own tolerance sensitivity |
| DOP853 tableau satisfies the order conditions | ✅ `oracle/dop853.test.ts` — row sums to sub-ulp, quadrature exact to k = 8 and failing at k = 9 |
| Oracle converges at 8th order | ✅ `oracle/dop853.test.ts` — measured 7.88–7.96 per halving on a circular orbit |
| Arc elements cached once and never stale | ✅ `arc.test.ts` — by identity, not by tolerance |
| Applying zero Δv changes nothing | ✅ `maneuver.test.ts` — an exact equality, not a closeness: rotating the zero vector is exact and adding zero to a float is exact |
| Two impulses at the same epoch equal their vector sum | ✅ `maneuver.test.ts` — **in the inertial frame**, which is the form that is true; see [The RTN frame, stated precisely](#the-rtn-frame-stated-precisely). The naive RTN-component reading is asserted to *fail*, by a margin two orders of magnitude above float64 noise, so it cannot be quietly reintroduced |
| Quantisation is idempotent, and its counts round-trip exactly | ✅ `quantise.test.ts` — randomised over the epoch and Δv domains, plus a JSON round-trip on the integer counts, which is the thing §11.4 actually claims survives one |
| Canonical JSON is a stable identity | ✅ `replay.test.ts` — byte-identical through serialise → parse → serialise and through a full plan → replay → JSON → plan cycle, and identical for an object whose keys were built in a different order |
| Anomaly ↔ epoch map agrees with universal-variable propagation | ✅ `events.test.ts` — two independent routes to the same instant (ν → E → M → t in closed form against a transcendental solve in the universal anomaly): 2.4e-14 circular, 3.4e-14 at e = 0.42, 2.3e-14 hyperbolic, 3.1e-14 parabolic. At e = 0.97 it is 1.8e-11, which is **the propagator's** limit there and not the map's — see [Time reversal, measured](#time-reversal-measured) |
| Closest approach is the *global* minimum, not the first local one | ✅ `approach.test.ts` — agrees with a 400 000-sample brute-force scan over a multi-pass geometry, to within 0.2 s of epoch and never a larger separation. The brute-force scan is the time-stepping FR-103 forbids in the product, which is exactly what makes it a fair oracle for the search that replaces it |
| Half-open `[start, end)` endpoint rule | ✅ `apsis.test.ts`, `shell.test.ts` — two abutting searches report every crossing exactly once, which is the property a timeline of touching arcs depends on. ✅ `timeline.test.ts` — the timeline now applies the same rule to its own arcs, so an epoch exactly on a node belongs to the arc that *starts* there and `stateAt` returns the post-impulse state. It also settles the degenerate case where a plan's first node sits on the start epoch: arc 0 has zero length and is never selected |
| Interval results are ordered, non-overlapping, and clipped rather than dropped at the bounds | ✅ `shell.test.ts`, `station.test.ts`, `umbra.test.ts` — including a pass in progress at each bound, and a whole search interval spent inside the condition |
| Tangential geometry produces neither a spurious nor a duplicated crossing | ✅ `shell.test.ts` — a shell at periapsis, a shell at apoapsis, and a circular orbit exactly on the shell; ✅ `umbra.test.ts` — at the grazing beta angle |
| Event searches are deterministic | ✅ all five finders — the same call twice is deeply equal, and the sample grid is a pure function of its index rather than an accumulation (§11.4) |
| Timeline `stateAt` is continuous across arc boundaries | ✅ `timeline.property.test.ts` — over random plans of 1 to 12 nodes. At a node epoch the answer is the post-impulse state *exactly*, by the endpoint rule above. Approaching from the left it reaches the pre-impulse state within the bound the geometry sets — the speed times the offset in position, the local gravitational acceleration times it in velocity — rather than within a constant tuned until the suite went green |
| Plan evaluation is deterministic in-process | ✅ `timeline.property.test.ts`, `timeline.test.ts` — the same plan evaluated twice gives bit-identical arcs and impulses, asserted as equality rather than as closeness. Construction reads no clock and no ambient randomness, so anything weaker would let smuggled state through |
| Incremental re-evaluation equals a full rebuild | ✅ `timeline.test.ts`, `timeline.property.test.ts` — bit-identical across a move, a Δv change, an insert, a delete, an append and a delete-everything, and the two paths must also agree on *whether* an edit is evaluable. Separately, the arcs before the first changed node are asserted to be the **same objects**, which is what makes "recomputed only from *k* onward" observable rather than inferred from the answer being right |
| Determinism across runtimes | ⏳ #73 |

### Tier 3 — independent references

Closed-form tests share the code's assumptions and cannot catch a wrong constant or a misunderstood convention. These can.

| Case | Reference | Status |
| --- | --- | --- |
| State ↔ elements | Curtis, *Orbital Mechanics for Engineering Students*, 4th ed. (Elsevier, 2020), Examples 4.3 (§4.4, pp. 193–195) and 4.7 (§4.6, p. 211) | ✅ `elements.test.ts`, to 1e-3 relative — the book's printed precision, not a tuned tolerance. Read from the book per the §7.6 process rule. Covers the general and hyperbolic paths; the degenerate cases appear in neither example and rest on closed forms instead. |
| Kepler's equation | Vallado, *Fundamentals of Astrodynamics and Applications*, Ch. 2 | ⏳ #54 |
| Lambert, zero revolution | Curtis, *Orbital Mechanics for Engineering Students*, 4th ed. (Elsevier, 2020), §5.3, Examples 5.2 (pp. 245–247, elliptical) and 5.3 (pp. 248–249, hyperbolic) | ✅ `lambert.test.ts`, to 1e-3 relative on the derived elements and 3e-5 on the velocities — the book's printed precision, not a tuned tolerance. Read from that edition per the §7.6 process rule; the copy is a PDF whose text extraction loses minus signs, so every sign was re-derived from the book's own given data and intermediate quantities. Vallado Ch. 7 and the `poliastro.iod.izzo` cross-check remain ⏳ #54 |
| **Lambert, multiple revolutions** | — none available | ⏳ #54 (Vallado Ch. 7) and ⏳ #55 (`poliastro.iod.izzo` fixture). **Curtis does not treat the multi-revolution case at all** — Algorithm 5.2 is zero-revolution only and the book has no worked example — and no other reference is held in this workspace, so #51 shipped the implementation with the Tier 1 and Tier 2 rows above and left this one open rather than manufacturing a number. The in-repository oracles are strong (a closed-form answer at both ends, plus propagation to 1e-9) but they are not independent of the repository, which is the whole distinction this table draws |
| Two-body propagation over a range of a, e | `poliastro` / `astropy` fixture, generated by a committed script with a pinned version | ⏳ #55 — **the cross-check in `crosscheck.test.ts` is not a substitute.** Both methods are ours, so a shared misunderstanding of a convention or a wrong constant would agree with itself. What that test excludes is an error in either *algorithm*, which is worth having and is not the same thing. |
| Real orbit | ISS TLE-derived state propagated one orbit vs SGP4 — asserts the *magnitude of the disagreement* matches what the model predicts, which is a stronger check than agreement | ⏳ #55 |
| Ground-station visibility | The **81.3° geostationary visibility limit** — the geocentric angle beyond which a station cannot see a geostationary satellite at zero elevation. A standard satellite-communications figure | ✅ `station.test.ts` — re-derived from the pass geometry as 81.30° and asserted from both sides, at 0.005 rad either side of it |
| Eclipse duration | **~36 minutes** of darkness per orbit at ISS altitude, and a **~70 minute** maximum geostationary eclipse near equinox | ✅ `umbra.test.ts` — the closed form gives 36.1 and 69.4 minutes, asserted to the precision those are quoted at. **These are widely quoted figures rather than a single citable worked example**, so they are recorded as an external sanity bound and not as a full Tier 3 reference in the sense the process rule means. A fixture from an independent eclipse implementation would be the real thing and does not exist here yet |

> **Process rule.** Every textbook citation is verified against the physical book by the person writing the test. No reference value may be copied out of `docs/PRODUCT.md` into a test without independent confirmation — that document's numbers were computed from these constants and are there to be *checked*, not trusted. This rule has already earned its keep: it is how the wrong `R_GEO` was found.

### Tier 4 — regression

| Property | Status |
| --- | --- |
| Golden trajectories: ~30 plans with states at fixed epochs, 1e-9 relative | ⏳ #71 |
| Contract solvability: every shipped contract's reference solution still meets its objective at par ± 0.5% | ⏳ #87 |

## Numerical notes

- **Integrator:** none in the game path. Propagation is analytic (universal-variable Kepler, `packages/propagation/src/universal.ts`), so the state at time *t* is a pure function of the state at *t₀* and the elapsed time, and error does not accumulate with elapsed time. A high-order integrator ships in `packages/propagation/src/oracle/` **as a test oracle only**. It is not exported from `@hh/propagation`, is reachable only through the `@hh/propagation/oracle` subpath, and `dependency-cruiser` fails the build on any import of it from a file that is not a test — the `no-oracle-in-game-path` rule, itself checked by deliberate violation in the guardrail suite.
- **What the oracle is, precisely.** The 12-stage 8th-order explicit Runge–Kutta *tableau* of DOP853 (Hairer, Nørsett & Wanner, 2nd ed., §II.5), with **step doubling** rather than Hairer's embedded 5(3) estimator for step-size control. The substitution is deliberate: the tableau can be verified inside this repository from the order conditions, and the embedded estimator's coefficients cannot — they would have to be trusted. That check earned its keep immediately, catching a transcribed coefficient that had lost its exponent. Step doubling costs three times the derivative evaluations per step and needs no coefficients at all.
- **Oracle energy drift, measured.** Explicit Runge–Kutta is not symplectic and its energy error is not bounded. At `rtol = 1e-13` the relative energy error is 4.3e-13 after one orbit, 4.5e-12 after ten and 4.5e-11 after a hundred — **linear in orbit count and proportional to the tolerance**. Angular momentum drifts about three times less, not orders less. This is exactly why FR-009 keeps it out of the game path.
- **Timestep:** not applicable to propagation. The game's fixed timestep governs playback, not state.
- **Tolerances:** solver convergence criteria and iteration caps are set per solver and recorded with it. The propagator's tolerance is **relative on the universal anomaly**, defaulting to 1e-14 with a Newton cap of 30 before a bracketed fallback. Relative rather than absolute because `χ` has units of √m and scales with `√a` times the swept anomaly; on `χ` rather than on the elapsed time because stopping when the *time* residual is small leaves a position error of `v·Δt` times that residual, which is an amplification of a few thousand over a month at LEO.
- **Whole revolutions are removed before solving.** On a closed orbit the state after `Δt` and after `Δt − N·T` are the same state, exactly, so the solve runs on the remainder. This is load-bearing rather than tidy: `√z` is the eccentric anomaly swept and float64 knows it only to a relative `eps`, so the unreduced error grows faster than the revolution count. Measured on the unreduced solver over 30 days: 5e-15 relative at one revolution, 1.3e-10 at ninety-two, 1.9e-8 at four hundred and eighty-six. With reduction the same worst case is 2.3e-12.
- **A timeline lookup is a binary search, and is measured as one.** Evaluating a plan at an epoch is a search over arc start epochs followed by a single propagation — no iteration over time steps at any plan size (FR-103). Timing `stateAt` would not demonstrate that: the solve costs microseconds and the search nanoseconds, so a linear scan over two thousand arcs would still be swamped by the solve and the curve would look flat either way. `tools/bench/timeline.bench.test.ts` therefore times the search alone. Grown from 8 nodes to 2 048 — 228× the arcs — the lookup goes from **126 ns to 498 ns, a factor of 4.0**, against the 3.5 a binary search predicts and the 228 a linear scan would cost. A full timeline `stateAt` measures **0.8–1.4 µs**, inside §11.9's 5 µs target.
- **Evaluating a plan costs one Kepler solve per node; editing one costs a solve per node after it.** Full evaluation of an 8-node plan measures **0.03–0.05 ms** against §11.9's 2 ms target, and dragging its last node re-evaluates in **0.007–0.009 ms** — about 3.6× cheaper than the rebuild, and three orders of magnitude inside NFR-011's 16.7 ms frame. The saving is structural rather than tuned: arc *j*'s state is a function of the initial state and nodes 0 … *j*−1, so an edit at node *k* cannot reach anything before *k*, and those arcs are reused **by reference** — element caches and all. One thing is deliberately left on the table: a Δv-only change at node *k* leaves arc *k* equal in value and it is recomputed anyway, because a single code path that is provably identical to a rebuild is worth more than a second one that would save one Kepler solve out of a 16.7 ms budget.
- **A single arc `stateAt()` call costs 0.7–1.1 µs** on the development machine, against §11.9's 5 µs target and 20 µs hard limit. Measured by `tools/bench/`, which asserts the hard limit and reports the median against the target on every run; the target is not asserted because a timing gate that flakes on a shared CI runner gets silenced, and a silenced gate enforces nothing.
- **Cancellation risks:** specific orbital energy and the eccentricity vector both suffer catastrophic cancellation at low eccentricity. **This is not fixed by the equinoctial set, and it is worth being exact about what is.** The eccentricity *magnitude* at e = 1e-10 carries about 5e-16 of absolute error whichever way it is computed — measured for three formulations, all on the same floor, because that floor is the float64 representation of the state rather than a property of the algebra. What the equinoctial set fixes is the *periapsis direction*: ω is an angle to a direction of length e, so its error scales as 5e-16 / e and it loses a digit per decade (5.4e-12 rad at e = 1e-4, 1.7e-8 at e = 2e-8), and below the 1e-8 threshold the classical convention stops returning it at all. `f` and `g` are components of that direction and stay flat at 7e-16 across the whole range. That continuity — not better eccentricity — is why elements feeding logic use the equinoctial set.
- **Stumpff functions near zero:** `C(z) = (1 − cos √z)/z` and `S(z)` differ two nearly equal numbers, so both are evaluated by series below `|z| = 0.1`. At the other end the same cancellation sets a hard ceiling: within about 1.5e-8 of `√z = 2π`, `C` returns exactly zero and the Lambert time of flight comes back infinite. The zero-revolution search therefore stops at `4π² − 1e-4`, which still admits a transfer of roughly 4e19 s; beyond that the solver reports out-of-domain rather than answering from a `NaN`.
- **Stumpff cancellation is per revolution, not once.** `cos(2πk) = 1` exactly for every integer `k`, so `C` vanishes at *every* `√z = 2πk` — each multi-revolution interval is bounded by the same singularity at both ends, not just the first one. The margin is therefore set in `√z` rather than in `z`: writing `√z = 2πk + d`, the numerator is `1 − cos d ≈ d²/2`, which stops resolving against 1 below `d ≈ 2e-8` whatever `k` is. The interval ends are then walked further inward while `y(z) ≤ 0` or the time of flight is not finite, which is what handles a near-collinear geometry whose `y` approaches zero at the lower boundary. One consequence is visible and tested: the two branches of a revolution have **different reach**, because each runs to its own boundary — at a circular-LEO quarter-turn geometry the low branch tops out near 1.4e19 s and the high branch near 4.0e20 s. Past its own limit each reports `out-of-domain`, and where the bracket survives but the time of flight moves by ~4e10 s per ULP of `z`, `max-iterations` — never a converged answer it cannot justify.
- **Event finding: closed form where it exists, bracketed root-finding where it does not.** Apsis crossings and altitude-shell crossings are solved algebraically for a true anomaly and converted to epochs by Kepler's equation in the direction that needs no solver, so they carry no convergence tolerance and have **no floor on the shortest feature they can find**. The other three cannot be: closest approach involves a second independently propagated body, ground-station visibility a rotating station, and umbra a Sun direction, and none of those is a function of one conic's anomaly. Those three sample and refine with Brent to an absolute **1e-6 s** on the epoch — 7.7 mm of along-track motion at LEO, four orders of magnitude below DEP-03's 100 m rendezvous tolerance.
- **What a sampled event search can miss, and the defaults.** A bracketed search finds a feature only if the sample grid straddles it, and no finite sampling can guarantee every root of an arbitrary continuous function. The grid is laid out per *revolution* rather than per wall-clock second, so it is as dense at GEO as at LEO in the terms that matter, and each finder's default is sized for the shortest feature its own geometry produces: **32 per revolution** for closest approach (relative range has a handful of extrema per revolution), **64** for umbra (a LEO eclipse spans ~40% of a revolution, a GEO one ~5%), **256** for ground-station visibility (a pass is a few percent of a revolution and the shortest worth finding is shorter still — this resolves a pass longer than ~22 s at 400 km). Umbra samples in **true anomaly** rather than in time, because the shadow condition depends only on where the spacecraft is; that is what makes a short eclipse near periapsis no harder to find than a long one near apoapsis.
- **The cylindrical shadow, and what it costs.** The umbra model is a cylinder of the body's radius projected anti-sunward: no penumbra, and no convergence of the shadow cone. The real umbra is a cone — the Sun is a disc, so the shadow closes about 1 384 000 km behind Earth — which makes this model's shadow *wider* than the real one, increasingly so with altitude. Measured, for a circular orbit with the Sun in plane: at 400 km the eclipse comes out **36.11 min against a true-cone 35.71 min, 1.1% long**; at geostationary altitude **69.41 min against 67.28 min, 3.2% long**. The penumbra — partial shadow, reported here as full sunlight — adds a band **0.8 min** wide at 400 km and **4.3 min** at GEO. DEP-06's own note bounds the fixed-Sun error at 0.5° of umbra rotation over a 12 h contract, which is the smaller of the two effects.
- **Near-tangential crossings are ill-conditioned in epoch, by the geometry and not by the method.** Where a trajectory grazes a shell, `dr/dt → 0`, so a fixed error in the radius becomes an unbounded error in the epoch. Measured on a 400 × 800 km orbit, moving the shell towards apoapsis: the radius residual at the returned crossing stays on the float64 floor (~3e-9 m, about 4e-16 relative) at every separation, while the epoch error implied by it grows from **2.0e-11 s** at 100 km below apoapsis to **2.8e-8 s** at 1 cm below it — inversely with the radial rate, hence as `1/√(gap)`. The closed form adds nothing to this; a root-finder would inherit exactly the same conditioning.
- **A circular orbit cannot be asked where it crosses a shell.** `cos ν* = (p/R − 1)/e` divides one small number by another, and the eccentricity magnitude carries about 5e-16 of absolute error however it is computed (see the cancellation note below). A state built from `e = 0` returns from `elementsFromState` with `e ≈ 1e-16`, so a circular orbit sitting exactly on a shell satisfies `r_p < R < r_a` in float64, and a naive crossing search reports being inside for half of every revolution — over a radius excursion of a nanometre. The shell finder therefore treats `e ≤ 5e-16` as circular and answers *entirely inside* or *entirely outside*, which are both well conditioned and are what DEP-08 actually asks about a parking orbit.
- **Event-search cost, measured.** Over a 14 h contract horizon at 400 km, against §11.9's 2 ms full-timeline row: **closest approach 0.62 ms** (the one #61 ties to that budget, and it is linear in the horizon — 0.60 ms doubles to 1.17 ms), **umbra 0.60 ms**, **apsis 0.008 ms** and **shell 0.005 ms** (both closed-form), and **ground-station visibility 3.35 ms**. The last is the most expensive by an order of magnitude and knowingly so: its 256 samples per revolution are what resolve a short pass, and thinning the grid to make the number smaller would trade a real capability for a benchmark. It is a per-contract call rather than a per-frame one, and it has no §11.9 row of its own. Measured by `tools/bench/events.bench.test.ts` on the development machine, which is not §11.9's reference device; these are quiet-run medians and the same figures move by up to half again under load, which is exactly why the target is reported and only the hard limit is asserted. The benchmark project is excluded from `pnpm coverage` — V8 instrumentation slows the measured code about fourfold, so a budget asserted under it would be measuring the profiler.
- **Julian Date precision:** a JD near 2 451 545 has a float64 ULP of about 5 × 10⁻¹⁰ days, or ~47 µs, and differencing two nearby Julian Dates loses that entirely to cancellation. The `Epoch` scalar does not have this problem — seconds past J2000 stay near 10⁹ at most, giving ~2 × 10⁻⁷ s resolution. Simulation arithmetic is done on epochs; Julian Dates and calendar dates appear only at display.
- **Cross-platform equality:** bit-identical results are **not** claimed. `Math.sin`, `Math.cos` and friends are not required to be correctly rounded and do differ between JavaScript engines. Determinism is achieved by quantising inputs (DEP-09) and scoring on rounded bands, not by assuming float equality.
