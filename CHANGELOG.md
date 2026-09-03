# Changelog

All notable changes to Hohmann Heist are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Changes to the physics model get their own note under **Physics**, with a pointer to
the `docs/PHYSICS.md` revision — players and contributors need to know when a number
they relied on has moved.

## [Unreleased]

### Added
- **Golden trajectories (§7.6 Tier 4).** 31 committed plans with their evaluated states at fixed
  epochs — 326 sampled states in all — covering every conic class including exactly parabolic, the
  degenerate geometries (e = 0, i = 0, both, i = π, polar), the degenerate plan structures (empty,
  a node on the start epoch, a node on the horizon, the minimum legal spacing, a zero-Δv node,
  twelve nodes), and two plans that change conic class mid-timeline. CI fails when a value moves by
  more than 1e-9 relative. **A golden asserts that a number has not changed, never that it is
  right**; the tests it sits behind are what say it is right.
- **A golden that moves takes `docs/PHYSICS.md` with it.** §11.13 has promised this check since M0
  and nothing enforced it. `tools/goldens/physics-doc-gate.mjs` now does, on every pull request: a
  fixture file only moves when an evaluated trajectory moved, which makes it a change to the
  physics model rather than to a test fixture. The check is deliberately shallow — it asks whether
  the document is in the same diff, not whether what was written there is any good, because no
  script can check the second and pretending to would be worse than not trying.
- **In-process determinism fuzz (FR-109).** 10 000 seeded random plans per CI run, each evaluated
  twice, compared on every float a timeline holds — arc boundaries, arc states, cached elements,
  both sides of every impulse, the inertial Δv, and five `stateAt` lookups — with `Object.is`, so
  `-0` and `+0` are distinguished and the comparison is bit-level rather than numeric. §11.4
  requires same-runtime determinism to be *exact*, and a tolerance would mask exactly the bugs this
  exists to catch. A 200 000-plan soak found no difference. Cross-runtime agreement is out of scope
  and remains #73.
- **Benchmark regression gate (NFR-011, NFR-021).** The benchmarks asserted §11.9's hard limits and
  nothing else, which catches a catastrophe and misses a forty-percent regression entirely. They now
  record their measurements and `pnpm bench:check` compares them against a committed baseline. Three
  choices in the comparison were measured rather than assumed: the **minimum** over each benchmark's
  batches rather than the median (worst-case run-to-run spread 19.7% against 31.5%); a baseline
  recorded **from CI** as the per-metric median of five runs; and each metric divided by the
  **median across all twenty in the same run**, so the gate asks whether an operation got slower
  than its neighbours did. The tolerance is 30%.
- **The relative comparison exists because the runner fleet spans a factor of two.** Six CI runs of
  one identical commit executed the suite at 0.52× to 1.02× of each other's pace. Absolute
  comparison across that cannot work — the fastest host reads 48% under a baseline recorded on the
  mid-range ones — while dividing by the run's own median removes the host exactly and leaves a
  per-metric scatter that is flat across the whole range (worst upward deviation 9.7% to 14.4%).
  The known blind spot is a uniform slowdown, which divides out; §11.9's absolute hard limits still
  backstop it and the host offset is printed on every run.
- **A synthetic normalisation was tried and rejected on measurement.** Every benchmark also times a
  frozen scalar arithmetic loop and records `measurement / yardstick`, on the theory that a
  dimensionless ratio makes a baseline portable. It over-corrects across machine families (a runner
  is 1.16× slower than the development machine on real workloads but 1.45× slower on the yardstick,
  putting every normalised row a systematic 22% under its baseline) and under-corrects within the
  fleet, while adding noise of its own. Two runs with yardsticks of 364 ns and 365 ns executed the
  suite at 0.96× and 0.79×. The ratio stays in the recorded results as the evidence for the
  decision, and is not used by the gate.

- **The two §11.9 frame-time budgets are measured** for the first time — idle 0.008–0.010 ms,
  dragging a node 0.041–0.048 ms, against 4 ms and 8 ms targets. What is measured is the geometry
  pipeline owned by `@hh/sim` and `@hh/render`; rasterisation is the browser's and cannot be
  measured from Node, so **passing does not mean §11.9's frame rows are met** — that is a
  real-device pass, #188 and #189. The benchmark says so, and so does `docs/PHYSICS.md`.
- **Benchmark files no longer run in parallel.** Four benchmarks competing for the same cores while
  each tries to measure elapsed time were partly measuring the scheduler. It matters more now that
  a gate reads those numbers.
- `@hh/sim` gains the **timeline**: applying a plan to an initial state over a horizon produces
  the alternating sequence of Keplerian arcs and instantaneous impulses FR-102 describes, with
  `stateAt` evaluating it anywhere inside the horizon and `withPlan` re-evaluating it from an
  edited node onward. This is what turns a plan into a trajectory; until now `@hh/sim` held the
  plan and nothing that ran it.
- **The empty plan is not a special case.** It produces one coasting arc from the start epoch to
  the horizon because the fold never enters its loop, not because a branch checks for it. A
  structure whose degenerate case is written separately is a structure with two behaviours to
  keep in step.
- **A node epoch belongs to the arc that starts there.** Timeline arcs inherit the half-open
  `[start, end)` rule the event finders already run on, so `stateAt` at a node returns the
  **post-impulse** state and the pre-impulse one is on the impulse record. The last arc is closed
  at the horizon so the deadline itself is evaluable, and an epoch outside the horizon is rejected
  with a typed `EpochOutOfHorizonError` carrying the bounds, rather than extrapolated into a plan
  that says nothing about that time.
- **Incremental re-evaluation is the same fold entered later, not a second implementation.**
  Arc *j*'s state depends on the initial state and nodes 0 … *j*−1, so an edit at node *k* cannot
  reach anything before *k*; `withPlan` diffs on the integer counts, reuses the earlier arcs **by
  reference** — element caches and all — and restarts the same loop at *k*. Moving, inserting and
  deleting a node are therefore one path rather than three. Measured: an 8-node plan re-evaluates
  fully in 0.03–0.05 ms against §11.9's 2 ms target, a last-node drag in 0.007–0.009 ms against
  NFR-011's 16.7 ms frame, and a timeline `stateAt` in 0.8–1.4 µs against a 5 µs target.
- **The arc lookup is measured as a binary search, not asserted as one.** Timing `stateAt` would
  prove nothing — the Kepler solve costs microseconds and the search nanoseconds — so the
  benchmark times the search alone: 228× more arcs costs 4.0× more, against 3.5× for a binary
  search and 228× for a linear scan.
- `@hh/propagation` gains the **five FR-008 event finders**: apsis crossings, closest approach
  between two independently propagated bodies, altitude-shell crossings, ground-station conical
  visibility, and cylindrical umbra intervals. They ship together because the interesting part of
  each is the same three decisions — what an interval endpoint means, what tolerance a returned
  epoch carries, and what happens to a feature the search cannot resolve — and five finders written
  apart would have answered them five ways.
- **The endpoint rule is half-open, `[start, end)`.** An event exactly at the start is reported and
  one exactly at the end is not, so searching two abutting arcs and concatenating reports every
  event exactly once instead of leaving a caller to de-duplicate on a float comparison. An interval
  already in progress at a bound is returned **clipped**, flagged as such, rather than dropped —
  a pass that begins at `start` because the search began there is a different fact from one that
  begins there because the spacecraft rose.
- **Apsis and shell crossings are closed-form, not root-found.** Both issues asked for root-finding
  to a stated tolerance; on an unperturbed conic both are algebraic — periapsis *is* true anomaly
  zero, and `r = p/(1 + e cos ν) = R` solves for `ν` directly — so they are exact to round-off,
  have no convergence tolerance, and have **no floor on the shortest feature they can find**. The
  shell's inverse cosine is written as a half-angle `atan2`, which `acos` is banned for (NFR-006)
  and which stays well conditioned at both ends besides.
- **Umbra samples in true anomaly rather than in time.** The shadow condition depends only on where
  the spacecraft is, so the grid is uniform in position around the orbit; that is what makes a
  short eclipse near periapsis no harder to find than a long one near apoapsis. Refinement still
  runs in epoch, so the stated tolerance means what it says.
- `@hh/astro` gains the **ECEF frame**: `EcefVector`, `ecef`, and the body-fixed ↔ inertial
  rotation. A ground station is the one thing in this simulation that is constant in the rotating
  frame and not in the inertial one, so it is stated in the rotating one and the compiler refuses
  to let it be passed where an inertial vector belongs. The rotation takes an **angle**, not an
  epoch — converting an epoch needs a sidereal-time model, which is data with a source and an
  expiry, and a scenario states its own station angle.
- `@hh/sim` opens with the **plan side of the simulation**: `Plan` and `ManeuverNode` with
  quantisation at entry (FR-101, FR-105, DEP-09), impulsive Δv applied in RTN (FR-006), and
  canonical JSON serialisation of a plan (§11.6). A node's canonical identity is its **integer
  count** — ticks of 1/1024 s and counts of 1e-4 m/s — and its SI values are derived from those
  counts rather than from the caller's arguments, which is what makes quantisation idempotent by
  construction rather than by discipline. FR-101's "≥ 1 s apart" is an integer comparison, because
  differencing two 2026 epochs as floats loses about 1e-7 s to cancellation and a plan that
  validates on one runtime should not fail on another.
- `@hh/sim` gains **canonical JSON replay codes**: keys sorted by an explicit writer rather than
  inherited from a literal's insertion order, no whitespace, integers only, and strict parsing that
  rejects an unknown schema version, an unrecognised key or a non-integer instead of dropping it.
  Node epochs are written as mission-elapsed ticks — §11.6's own claim field is plainly MET — so the
  origin cancels exactly on the way back. A share code for an 8-node plan measures 306 bytes, or 408
  base64url characters **with no compression at all**, which is how FR-607's 512-character budget is
  asserted: deflate is headroom, not an assumption the budget rests on.
- `@hh/render` gains the **`Renderer` seam and a Canvas 2-D implementation**. The interface takes a
  whole `Scene` bucketed by layer rather than a stream of drawing calls, so §11.8's draw order lives
  in the package as a constant instead of emerging from the order a caller happens to make its
  calls. There is no text primitive at all — that is what keeps labels in the DOM (D8) rather than
  leaving it to review — and the backing store is capped at 2x for battery.
- `@hh/render` gains an **orthographic camera**: pan and zoom as pure state transforms with no
  canvas anywhere, auto-framing of the ship ∪ target ∪ plan ∪ Earth union with a 12% margin, the
  20% re-frame rule, and manual zoom clamped to [0.5x, 40x] of the auto-frame scale. Scale is
  linear, per §8.4. The world-to-camera transform runs in float64 and `projectInto` is the only
  float32 in the package (NFR-010) — a test asserts that narrowing the world coordinate first
  loses more than a pixel of a 100 m detail at 1e8 m, which is the failure the rule exists to
  prevent.
- `@hh/render` gains **orbit tessellation with adaptive subdivision**, sampled in eccentric
  anomaly for an ellipse, hyperbolic anomaly for a hyperbola, and Barker's `D` inside a band around
  `e = 1`, refined until the screen-space sagitta is under 0.5 px and capped at 512 vertices. The
  cache is keyed by (elements, scale bucket) and the bucket rounds *up*, so a reused tessellation is
  never coarser than the scale it is drawn at. True anomaly is not in the key — scrubbing the
  timeline does not change the path — and neither is the camera basis or centre, so panning and
  rotating cost nothing. Measured at 0.009–0.09 ms per orbit against §11.9's 0.5 ms target, and
  0.0006 ms on a cache hit.
- **A benchmark for §11.9's orbit-tessellation budget**, alongside the propagation one, asserting the
  2 ms hard limit and reporting the 0.5 ms target.
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

### Changed
- `pnpm coverage` no longer runs the benchmark project (`vitest run --project !bench`). V8 coverage
  instruments every function and slows the code under measurement by roughly a factor of four, so a
  §11.9 budget asserted under it measures the profiler rather than the simulation — the
  ground-station search's 3.3 ms reads as 13.9 ms and trips an 8 ms limit nothing has broken. The
  second reason points the same way: a line reached only by a benchmark is *timed*, not tested, and
  counting it as covered overstates the number NFR-022's gate exists to keep honest. `pnpm bench`
  and `pnpm test:all` are unaffected.
- `@hh/render` compiles against its own TypeScript project. It draws on a canvas, so it needs the
  DOM library, and the root project deliberately has none so that a browser type in the simulation
  core is a compile error rather than something only the lint rule's list of global names catches.
  `pnpm typecheck` now runs three projects, and the guardrail suite checks both halves of the split
  by deliberate violation. Only the Canvas 2-D implementation actually needs a DOM; it sits behind
  the `@hh/render/canvas2d` subpath so the package's barrel — and the camera and tessellator behind
  it — stays runnable under Node.

### Removed
- **Pull-request preview deployments.** Every pull request published its build to
  `pr-preview/pr-<n>/` on `gh-pages` and commented the link; the whole facility is gone — both
  workflows, `tools/pages/pr-comment.sh`, and `publish.sh`'s second mode. A branch is verified
  locally instead: `pnpm build`, `pnpm --filter @hh/web preview`, and a real browser pointed at it.
  Two things follow from previews being the only other writer to the branch. `publish.sh` no longer
  preserves a path it does not own and no longer has a `remove` mode, so its usage is now
  `publish.sh <source-dir> <message>` and a publish replaces the tree whole. And the first deploy to
  `main` after this lands takes the stale preview directories with it, so no cleanup step has to be
  written or run.

### Fixed
- `docs/PHYSICS.md` said angles normalise to `[0, 2π)` "everywhere, without exception". Two of them
  do not, and one of the two was already shipping: hyperbolic anomaly, which is not periodic, and
  now topocentric elevation, which is a latitude-like coordinate on `[-π/2, π/2]` whose sign is its
  entire content — wrapping −10° to 350° would make `elevation ≥ mask` true for every spacecraft on
  the far side of the planet. The convention now says it governs *circular* angles and names both
  exceptions, rather than being a rule the code has to quietly break.
- `docs/PRODUCT.md` §11.6's "an 8-node plan is ~120 bytes of JSON" was optimistic by a factor of
  about 2.5 and is replaced by the measurement: 306 bytes, 408 base64url characters. A 123.75 m/s
  burn is 1 237 500 quantised counts, and every node carries three of those plus an epoch.
- `docs/PHYSICS.md` recorded DEP-09 as living in `@hh/game` and described quantised values as
  "exactly representable". Quantisation is a determinism mechanism (§11.4) and now lives in
  `@hh/sim`, and what is exactly representable is the integer count: 1/1024 is a binary fraction,
  1e-4 is not, so a quantised Δv is the correctly-rounded product rather than the decimal it prints
  as. The departures table's preamble now accounts for its two core-resident rows instead of
  forbidding them.

### Physics
- **The umbra is a cylinder, and that costs something measurable.** The real umbra is a cone — the
  Sun is a disc, so the shadow closes about 1 384 000 km behind Earth — and there is a penumbra
  outside it. This model has neither, which makes its shadow wider than the real one, increasingly
  so with altitude. Measured for a circular orbit with the Sun in plane: at 400 km the eclipse is
  **36.11 min against a true-cone 35.71 min, 1.1% long**; at geostationary altitude **69.41 min
  against 67.28 min, 3.2% long**. The penumbra, reported here as full sunlight, is a further
  0.8 min at 400 km and 4.3 min at GEO. **No previously published number has moved** — the shadow
  model is new — but the closed form behind it lands on the widely quoted ~36 min ISS eclipse and
  ~70 min maximum geostationary eclipse, and `docs/PHYSICS.md` records that those are quoted
  figures rather than a citable worked example.
- **Near-tangential shell crossings are ill-conditioned in epoch, and the closed form does not fix
  it.** Where a trajectory grazes a shell `dr/dt → 0`, so a fixed radius error becomes an unbounded
  epoch error. Measured on a 400 × 800 km orbit: the radius residual stays on the float64 floor at
  every separation, while the implied epoch error grows from 2.0e-11 s at 100 km below apoapsis to
  2.8e-8 s at 1 cm below it. A root-finder would inherit exactly the same conditioning; this is the
  geometry, not the method.
- **A circular orbit cannot be asked where it crosses a shell.** `cos ν* = (p/R − 1)/e` divides one
  small number by another, and a state built from `e = 0` returns with `e ≈ 1e-16`, so a circular
  orbit sitting exactly on a shell satisfies `r_p < R < r_a` in float64 — and a naive search
  reports being inside for half of every revolution, over a radius excursion of a nanometre. The
  finder now treats `e ≤ 5e-16`, the measured cancellation floor on the eccentricity magnitude, as
  circular and answers *entirely inside* or *entirely outside*. Circular orbits are the common case
  here, so this is the ordinary path rather than an edge case.
- **Impulsive Δv, with no model change.** FR-006 is applied through the existing `fromRtn`,
  unchanged: instantaneous, same position, no mass. **No published number has moved.** What is new
  is a frame property that was implicit and easy to get wrong — **impulses do not add in RTN
  components.** An impulse changes `v`, so `r × v` moves and the `T̂`/`N̂` axes rotate under the
  second delta-v. §13.3's "two impulses at the same epoch equal their vector sum" holds in the
  *inertial* frame; the RTN-component reading is now asserted to *fail*, by a margin two orders of
  magnitude above float64 noise, so it cannot be reintroduced quietly. `docs/PHYSICS.md` states it
  under the RTN frame.
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
