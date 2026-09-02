# Changelog

All notable changes to Hohmann Heist are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Changes to the physics model get their own note under **Physics**, with a pointer to
the `docs/PHYSICS.md` revision — players and contributors need to know when a number
they relied on has moved.

## [Unreleased]

### Added
- `@hh/propagation` gains **universal-variable Kepler propagation**: an arbitrary time offset,
  forwards or backwards, analytically, with one formulation covering elliptic, parabolic and
  hyperbolic orbits and no branch on conic class. Whole revolutions are removed before solving,
  which is what keeps the accuracy of a month-long propagation usable. Non-convergence is a typed
  return value. A single call costs about 1 µs against §11.9's 5 µs target.
- `@hh/propagation` gains the **`Arc`**: one Keplerian segment between impulses, an immutable value
  object whose classical elements are computed on first access and cached. Editing produces a new
  arc rather than mutating an existing one, which is what makes FR-104's incremental recompute safe
  rather than merely fast.
- `@hh/propagation` gains a **numerical integration oracle** — DOP853's 8th-order tableau with
  Richardson step control — reachable only from tests. FR-009 forbids advancing game state with it,
  and that prohibition is now a `dependency-cruiser` rule checked by deliberate violation rather
  than a comment.
- `@hh/astro` gains **equinoctial elements** `(p, f, g, h, k, L)`, with conversions to and
  from both a Cartesian state and the classical set. Non-singular at `e = 0` and at
  `sin i = 0`, which are the common case in this game. Retrograde orbits are supported
  through the retrograde factor rather than rejected.
- `@hh/astro` gains a **zero-revolution Lambert solver**, universal-variable, both transfer
  directions, with the direction chosen explicitly by the caller. Non-convergence is a
  typed return value; collinear positions are rejected with a typed error.
- `@hh/astro` gains the **closed-form two-body relations**: orbital period, mean motion,
  vis-viva, circular and escape speed, specific energy, and the Hohmann and bi-elliptic
  transfers.
- Initial project scaffold from `astro-game-lab/.repo-template`.

### Physics
- **Propagation exists, and is checked against an independent numerical method.** The analytic
  propagator and the DOP853-tableau oracle share no code, and agree to between 4e-14 and 7e-12
  relative across elliptic, near-parabolic and hyperbolic cases — inside the oracle's own
  sensitivity to its tolerance, which is where the test's threshold comes from rather than from
  what made it pass. **No published number has moved.** What is still missing is a Tier 3 external
  reference: both methods are ours, so the cross-check cannot catch a shared misunderstanding of a
  convention. The `poliastro`/Horizons row stays open against #55.
- **Corrected claim.** `docs/PHYSICS.md` implied §13.3's time-reversal requirement — 1e-12 relative
  over ±30 days — held across the element domain. It does not, and no propagator can make it: a
  float64 state determines its own orbital period to about one `eps`, and a few hundred revolutions
  amplify that past 1e-12. The measured envelope is now tabulated, together with the region where
  the flat 1e-12 does hold (`N·(1−e)^−2.5 ≤ 60`, which covers every v1.0 contract).
- **New measurement.** The oracle's energy drift is linear in orbit count and proportional to the
  requested tolerance — 4.5e-11 relative over a hundred orbits at `rtol = 1e-13` — and angular
  momentum drifts about three times less, not orders less. Recorded because an oracle whose fitness
  is assumed is not an oracle.
- **The Tier 1 closed-form validation suite is complete.** Every Tier 1 row in
  [`docs/PHYSICS.md`](docs/PHYSICS.md) now has a passing test with its expected value
  re-derived from the constants and, wherever one exists, an external anchor that does not
  come from those constants at all. **No published number has moved.**
- **Corrected claim.** `docs/PHYSICS.md` implied the equinoctial formulation fixes the
  cancellation in the eccentricity vector at low `e`. It does not, and nothing can: `e` at
  `1e-10` carries about `5e-16` of absolute error however it is computed, because that is
  the float64 representation limit of the *state*. What the equinoctial set fixes is the
  *periapsis direction*, whose classical error scales as `5e-16 / e` and which the
  classical convention stops reporting at all below `e = 1e-8`. The numerical notes now say
  so, with measurements.
- **Clarified claim.** The bi-elliptic thresholds 11.94 and 15.58 answer two different
  questions and are not the ends of one range. Both are now measured (11.9388, 15.5817) and
  shown to be independent of `μ` and of the inner radius.
- **New documented singularity.** The equinoctial set is an atlas of two charts switched at
  `i = π/2`; the singularity table records the switch, and that at `i = π/2` exactly the
  chart a round trip returns in is decided by round-off. Determinism is unaffected.
- **Lambert is validated against an independent reference.** Curtis §5.3 Examples 5.2
  (elliptical) and 5.3 (hyperbolic), to the book's printed precision. The hyperbolic case
  is the only external check on the negative-`z` branch of the Stumpff functions.
- **New documented limit.** The zero-revolution Lambert search stops at `4π² − 1e-4`,
  because the Stumpff `C(z)` cancels to exactly zero closer than that. The ceiling admits a
  transfer of roughly `4e19` s; beyond it the solver reports out-of-domain.
