/**
 * An independent check on the search — #89's "reference and citation" requirement.
 *
 * §7.6's process rule is that a physics result is checked against something that does not
 * share its assumptions. A search cannot check itself: if the grid, the simplex and the
 * Lambert solver all agreed on a wrong answer they would agree quietly. So where a
 * contract's geometry admits a closed form, the derivation reports both numbers and their
 * difference, and a reader can see that two unrelated code paths met.
 *
 * ## Four geometries, four closed forms
 *
 * v1.0's Act I–II content is coplanar, equatorial-equivalent and circular, which is
 * exactly the regime where closed forms exist. Each contract gets the one its geometry
 * admits, and a contract whose geometry admits none says so in its entry rather than
 * implying a check happened.
 *
 * | Geometry | Closed form | Contracts |
 * | --- | --- | --- |
 * | `intercept` between circular orbits of **different** radii | the tangential impulse that raises apoapsis to the target radius | C03 |
 * | `intercept` between circular orbits of the **same** radius | the phasing orbit that closes the phase in the achieved time | C05, C06 |
 * | `reach_orbit` between circular orbits, or to an apsis | the Hohmann pair, or its first burn alone | C01, C02, C04 |
 * | `station` | the first-order drift relation `λ̇ = −3Δv/a` | C07 |
 *
 * Two of those deserve a word. The same-radius `intercept` is the one a naive Hohmann
 * check gets **silently wrong**: `hohmannTransfer(r, r)` is zero, so a phasing contract
 * would appear to be checked and would in fact be compared against nothing. And the
 * phasing form is stated in terms of the *achieved* time of flight rather than the
 * revolution count the search picked, so it does not read anything out of the search's
 * own internals — it asks "given that the solution took this long, what must it have
 * cost?", which is a question about the physics rather than about the code.
 *
 * ## What is being compared, and what that is worth
 *
 * The two paths share `MU_EARTH`, `OMEGA_EARTH` and nothing else. The search propagates
 * orbits, quantises to DEP-09's counts and evaluates through the game's own timeline;
 * these evaluate an algebraic expression. Agreement is therefore evidence about the
 * **search**, not about the physics.
 *
 * The physics underneath it is checked elsewhere and independently: `docs/PHYSICS.md`'s
 * Tier 1 table asserts `hohmannTransfer` against the LEO→GEO figures to 0.05 m/s, and
 * Tier 3 asserts the propagator and Lambert against Vallado, Curtis and a poliastro-lineage
 * fixture. **No number in this file is copied from `docs/PRODUCT.md`** — §7.6's rule — and
 * every closed form is recomputed from the constants rather than quoted.
 *
 * ## Each reference carries its own tolerance, and says why
 *
 * Three of the four are exact relations and are held to DEP-09's quantisation noise. The
 * drift relation is **first-order** — it linearises `n(a)` about the geostationary radius
 * — so comparing it to a quantum would be asserting that a first-order expansion is
 * exact. It carries a relative tolerance sized to its own second-order term instead, and
 * says so, which is a more useful check than a tighter one that would have to be wrong.
 */
import { MU_EARTH, OMEGA_EARTH, hohmannTransfer } from '@hh/astro';
import type { LoadedScenario } from '@hh/game';
import { metres } from '@hh/math';

/** How close two element values must be to count as "the same" for this test. */
const COPLANAR_TOLERANCE_RAD = 1e-12;
const CIRCULAR_TOLERANCE = 1e-12;

/**
 * How far a search may sit from an exact closed form, m/s.
 *
 * Set by **quantisation, not by the search**. DEP-09 rounds each Δv component to
 * 1e-4 m/s, so the magnitude of a quantised three-component impulse can differ from the
 * exact one by up to about 1.7e-4 m/s however good the search was, and a plan with three
 * impulses can accumulate three of those. A millimetre-per-second leaves room for that and
 * for nothing else: a search that had genuinely found the wrong minimum would miss by
 * whole m/s.
 */
const QUANTISATION_TOLERANCE_MPS = 1e-3;

/**
 * How far the drift relation may sit from the exact answer, as a fraction.
 *
 * `λ̇ = −3Δv/a` is the derivative of mean motion with respect to semi-major axis
 * evaluated *at* the geostationary radius, so it is exact only in the limit of a
 * vanishing burn. C07's burn moves the semi-major axis by about 20 km out of 42 164 km,
 * and the second-order term is that ratio again — a few parts in ten thousand. 0.5%
 * covers it with an order of magnitude to spare while still being tight enough to catch a
 * factor-of-three error in the relation, which is the class of mistake this exists to
 * find. The measured difference is reported in `docs/PARS.md` beside the two numbers, so
 * a reader sees the actual agreement rather than only that it passed.
 */
const DRIFT_RELATIVE_TOLERANCE = 5e-3;

/**
 * How far the phasing relation may sit from the search's answer, as a fraction.
 *
 * Not quantisation either. The relation is exact, but it is stated in terms of the
 * **achieved closest-approach epoch**, and that is deliberately not the same instant as
 * the nominal return: a close approach is a minimum of *range*, while the construction
 * returns the ship to its departure point at a minimum of *along-track angle*, and the
 * two differ by a fraction of a second. C05's differ by about a quarter of one.
 *
 * That would not matter except that the derived Δv is stiff in the period — dividing the
 * elapsed time by eight revolutions means a quarter-second of arrival moves the phasing
 * period by 0.03 s, and the impulse by about 0.01 m/s. A tenth of a percent covers it
 * three times over and still catches the errors this exists to find, which are
 * factor-sized: a wrong revolution count moves the answer by whole m/s, and the
 * `hohmannTransfer(r, r) = 0` mistake this form replaced moved it by all of it.
 *
 * Keying the form to the achieved epoch rather than to the revolution count the search
 * chose is what buys the independence, so paying a tenth of a percent for it is the
 * trade, and it is the right way round.
 */
const PHASING_RELATIVE_TOLERANCE = 1e-3;

/** A closed-form comparison, whatever geometry produced it. */
export interface ClosedFormReference {
  /** Which of the four forms this is, for the document to narrow on. */
  readonly kind: 'apoapsis-raise' | 'phasing' | 'transfer' | 'drift';
  /** One sentence naming the relation, for `docs/PARS.md`. */
  readonly method: string;
  /** What the closed form says the whole solution costs, m/s. */
  readonly expectedMps: number;
  /** How far the search may sit from it, m/s, and why. */
  readonly toleranceMps: number;
  readonly rationale: string;
  /** Numbers the document quotes. Shape depends on `kind`. */
  readonly detail: Readonly<Record<string, number>>;
  /** A second figure worth reporting — the two-burn cost of a one-burn answer, say. */
  readonly aside: string | null;
}

/** `true` when a document's declared elements make it circular. */
const isCircular = (e: number): boolean => e <= CIRCULAR_TOLERANCE;

/** Semi-major axis of the orbit whose period is `T`. */
const axisForPeriod = (periodSeconds: number, mu: number): number =>
  Math.cbrt(mu * (periodSeconds / (2 * Math.PI)) ** 2);

/** Speed on an orbit of semi-major axis `a` at radius `r`. */
const visViva = (r: number, a: number, mu: number): number => Math.sqrt(mu * (2 / r - 1 / a));

/**
 * The closed-form cost for this contract, or `null` when its geometry admits none.
 *
 * Read from the **document's declared elements** rather than from the propagated state:
 * the author wrote `"e": 0`, and that statement is what makes the closed form applicable.
 * Re-deriving eccentricity from a Cartesian state to decide whether the author meant zero
 * would put a cancellation-prone quantity in the way of a question the file already
 * answers (`docs/PHYSICS.md` § Element conditioning near a circular orbit).
 *
 * `achievedSeconds` is the mission elapsed time the search's answer reported. Only the
 * phasing form uses it, and it uses it as an *input to the physics* rather than as a
 * result to be reproduced — see the module docstring.
 */
export const closedFormFor = (
  scenario: LoadedScenario,
  achievedSeconds: number,
): ClosedFormReference | null => {
  const document = scenario.document;
  const objective = document.objective;
  const ship = document.ship.state;
  const mu = scenario.mu;

  if (!isCircular(ship.e)) return null;

  if (objective.kind === 'reach_orbit') {
    const goal = objective.goal;
    if (Math.abs(ship.i_rad - goal.i_rad) > COPLANAR_TOLERANCE_RAD) return null;

    const r1 = ship.a_m;
    const goalPeriapsis = goal.a_m * (1 - goal.e);
    const goalApoapsis = goal.a_m * (1 + goal.e);

    // Which manoeuvre the contract asks for: one impulse when one of the goal's apsides is
    // **already at the ship's radius**, two otherwise. Not "which apsis is nearer" — a
    // circular goal has both at the same radius, so a nearer-of-the-two test answers "one
    // impulse" for every circularisation and compares C02's 216.68 m/s against C01's
    // 109.12. Sharing the branch with the strategy is deliberate and is not sharing an
    // assumption: which manoeuvre a goal describes is a reading of the contract, while
    // what it costs is the thing being checked, and only the second is computed twice.
    const tolerance =
      scenario.objective.kind === 'reach_orbit' ? scenario.objective.tolerance.radiusM : 0;
    const circularGoal = goalApoapsis - goalPeriapsis <= 2 * tolerance;
    const nearIsHere = !circularGoal && Math.abs(goalPeriapsis - r1) <= tolerance;
    const farIsHere = !circularGoal && Math.abs(goalApoapsis - r1) <= tolerance;
    const oneImpulse = nearIsHere || farIsHere;
    if (!circularGoal && !oneImpulse) return null;

    const r2 = nearIsHere ? goalApoapsis : goalPeriapsis;
    const transfer = hohmannTransfer(metres(r1), metres(r2), mu);

    return {
      kind: 'transfer',
      method: oneImpulse
        ? 'the tangential impulse that raises the far apsis to the goal’s'
        : 'the two-impulse Hohmann transfer between the two circular radii',
      expectedMps: oneImpulse ? transfer.firstBurn : transfer.totalDeltaV,
      toleranceMps: QUANTISATION_TOLERANCE_MPS,
      rationale: 'an exact relation, held to DEP-09’s quantisation noise',
      detail: {
        departureRadiusM: r1,
        arrivalRadiusM: r2,
        firstBurnMps: transfer.firstBurn,
        secondBurnMps: transfer.secondBurn,
        timeOfFlightSeconds: transfer.timeOfFlight,
      },
      aside: oneImpulse
        ? `Circularising there as well — what C02 costs — would be ${transfer.totalDeltaV.toFixed(4)} m/s.`
        : null,
    };
  }

  if (objective.kind === 'station') {
    const radius = ship.a_m;
    const slot = objective.slotOffset_rad;
    if (slot === 0 || achievedSeconds <= 0) return null;

    // λ̇ = −3Δv/a, so Δv = −λ̇·a/3, and the plan pays it twice: once to start the drift
    // and once to stop it. The sign is dropped after the magnitude is taken — what is
    // being checked is the size of the relation, and its direction is asserted by the
    // contract being met at all.
    const driftRate = slot / achievedSeconds;
    const perBurn = Math.abs((driftRate * radius) / 3);

    return {
      kind: 'drift',
      method: 'the first-order drift relation λ̇ = −3Δv/a, paid twice',
      expectedMps: 2 * perBurn,
      toleranceMps: DRIFT_RELATIVE_TOLERANCE * 2 * perBurn,
      rationale:
        'a first-order relation, held to its own second-order term rather than to a quantum',
      detail: {
        radiusM: radius,
        slotOffsetRad: slot,
        driftRateRadPerSec: driftRate,
        perBurnMps: perBurn,
        elapsedSeconds: achievedSeconds,
      },
      aside: null,
    };
  }

  // ── The proximity kinds ────────────────────────────────────────────────────
  if (!('targetId' in objective)) return null;
  const target = (document.targets ?? []).find((candidate) => candidate.id === objective.targetId);
  if (target === undefined) return null;
  if (!isCircular(target.state.e)) return null;
  if (Math.abs(ship.i_rad - target.state.i_rad) > COPLANAR_TOLERANCE_RAD) return null;

  const r1 = ship.a_m;
  const r2 = target.state.a_m;

  // Same radius: this is a phasing problem, and a Hohmann check would compare against
  // zero and call it agreement.
  if (Math.abs(r2 - r1) <= 1) {
    if (achievedSeconds <= 0) return null;
    const shipPeriod = 2 * Math.PI * Math.sqrt(r1 ** 3 / mu);
    // The ship flies a whole number of phasing revolutions and arrives where it began;
    // how many is whichever integer the achieved time is nearest to.
    const revolutions = Math.max(1, Math.round(achievedSeconds / shipPeriod));
    const driftPeriod = achievedSeconds / revolutions;
    const driftAxis = axisForPeriod(driftPeriod, mu);
    const perBurn = Math.abs(visViva(r1, driftAxis, mu) - Math.sqrt(mu / r1));

    return {
      kind: 'phasing',
      method:
        'the phasing orbit whose period closes the phase in the achieved time, entered ' +
        'with one tangential impulse',
      // One impulse: DEP-04 asks for range and nothing about relative velocity, so the
      // re-circularisation a phasing *rendezvous* would need is not bought here.
      expectedMps: perBurn,
      toleranceMps: PHASING_RELATIVE_TOLERANCE * perBurn,
      rationale:
        'an exact relation keyed to the achieved closest approach, held to the difference ' +
        'between that instant and the nominal return',
      detail: {
        radiusM: r1,
        revolutions,
        shipPeriodSeconds: shipPeriod,
        driftPeriodSeconds: driftPeriod,
        driftSemiMajorAxisM: driftAxis,
        otherApsisRadiusM: 2 * driftAxis - r1,
      },
      aside:
        `Re-circularising at the end — what a *rendezvous* would cost here — would be ` +
        `${(2 * perBurn).toFixed(4)} m/s.`,
    };
  }

  const transfer = hohmannTransfer(metres(r1), metres(r2), mu);
  return {
    kind: 'apoapsis-raise',
    method: 'the tangential impulse that raises apoapsis to the target radius',
    expectedMps: transfer.firstBurn,
    toleranceMps: QUANTISATION_TOLERANCE_MPS,
    rationale: 'an exact relation, held to DEP-09’s quantisation noise',
    detail: {
      shipRadiusM: r1,
      targetRadiusM: r2,
      firstBurnMps: transfer.firstBurn,
      timeOfFlightSeconds: transfer.timeOfFlight,
    },
    aside: `A full two-burn Hohmann — what a *rendezvous* would cost here — is ${transfer.totalDeltaV.toFixed(4)} m/s.`,
  };
};

/** Earth's rotation rate, re-exported so the document can quote what the drift form used. */
export { OMEGA_EARTH, MU_EARTH };
