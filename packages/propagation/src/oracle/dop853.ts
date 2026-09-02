/**
 * A numerical two-body integrator, for use as a **test oracle only**.
 *
 * FR-009 requires this to exist and forbids using it to advance game state. That
 * prohibition is not a comment: this module is not re-exported from
 * `@hh/propagation`, it is reachable only through the `@hh/propagation/oracle`
 * subpath, and `.dependency-cruiser.cjs` fails the build if anything but a test
 * file imports it. `tools/guardrails/guardrails.test.ts` asserts that rule still
 * fires, because a blocking check that has silently stopped working buys nothing
 * but false confidence.
 *
 * The reason for the prohibition is D5. A stepped integrator accumulates error with
 * elapsed time, so the same plan evaluated at a different time step gives a
 * different answer, and §11.4's determinism guarantee dies. The game path is
 * analytic; this exists to disagree with it, so that when they agree the agreement
 * means something.
 *
 * ## What is Hairer's, and what is not
 *
 * The tableau is the 12-stage, 8th-order explicit Runge-Kutta core of DOP853 —
 * Hairer, Norsett and Wanner, *Solving Ordinary Differential Equations I:
 * Nonstiff Problems*, 2nd ed. (Springer, 1993), §II.5, the coefficients of
 * Dormand and Prince's 8(5,3) pair.
 *
 * **The step-size control is not Hairer's.** DOP853 embeds a 5th- and a 3rd-order
 * estimate and blends them; this uses **step doubling** — one step of `h` against
 * two of `h/2`, with the difference divided by `2^8 - 1` as the error estimate,
 * and the two-half-step result kept. That is a deliberate trade and the reason is
 * verifiability rather than taste. The tableau can be *checked inside this
 * repository*: `dop853.test.ts` asserts that every row of `a` sums to its `c`, and
 * that `sum b_i c_i^(k-1)` equals `1/k` for `k` up to 8 and demonstrably fails at
 * 9, which is the signature of a genuine 8th-order method and not of a
 * transcription. The embedded estimator's coefficients admit no such check — they
 * would have to be trusted — and this codebase does not assert numbers it cannot
 * verify. Step doubling costs three times the function evaluations per step and
 * needs no coefficients at all.
 *
 * So: an 8th-order integrator with Richardson step control, on DOP853's tableau.
 * `docs/PHYSICS.md` says the same thing, in the same words.
 *
 * ## Determinism
 *
 * The step sequence is a pure function of the initial state, the span, the
 * tolerances and the initial step. No wall clock, no randomness, no adaptive
 * behaviour that depends on anything but the numbers. Two runs with the same
 * arguments take the same steps in the same order and return bit-identical results,
 * which `dop853.test.ts` asserts — an oracle whose answer moved between runs would
 * be useless for deciding whether the analytic path had moved.
 */
import type { State } from '@hh/astro';
import { eci } from '@hh/astro';
import type { Seconds } from '@hh/math';
import { V, metres, metresPerSec } from '@hh/math';

/** Number of stages in the 8th-order core. */
const STAGES = 12;

/** Components in a state vector: position then velocity. */
const DIMENSION = 6;

/** Order of the method. Sets the Richardson divisor and the step-control exponent. */
const ORDER = 8;

/** Stage abscissae `c`. */
const C = Float64Array.of(
  0,
  0.05260015195876773,
  0.0789002279381516,
  0.1183503419072274,
  0.2816496580927726,
  0.3333333333333333,
  0.25,
  0.3076923076923077,
  0.6512820512820513,
  0.6,
  0.8571428571428571,
  1,
);

/**
 * Stage coefficients `a`, as written. Zeros are real zeros: DOP853 does not use
 * stages 2 and 3 after the fourth row.
 */
const A_ROWS: readonly (readonly number[])[] = [
  [],
  [0.05260015195876773],
  [0.0197250569845379, 0.0591751709536137],
  [0.02958758547680685, 0, 0.08876275643042054],
  [0.2413651341592667, 0, -0.8845494793282861, 0.924834003261792],
  [0.037037037037037035, 0, 0, 0.17082860872947386, 0.12546768756682242],
  [3.7109375e-2, 0, 0, 0.17025221101954405, 0.06021653898045596, -1.7578125e-2],
  [
    0.03709200011850479, 0, 0, 0.17038392571223998, 0.10726203044637328, -0.015319437748624402,
    0.008273789163814023,
  ],
  [
    0.6241109587160757, 0, 0, -3.3608926294469414, -0.868219346841726, 27.59209969944671,
    20.154067550477894, -43.48988418106996,
  ],
  [
    0.47766253643826434, 0, 0, -2.4881146199716677, -0.590290826836843, 21.230051448181193,
    15.279233632882423, -33.28821096898486, -0.020331201708508627,
  ],
  [
    -0.9371424300859873, 0, 0, 5.186372428844064, 1.0914373489967295, -8.149787010746927,
    -18.52006565999696, 22.739487099350505, 2.4936055526796523, -3.0467644718982196,
  ],
  [
    2.273310147516538, 0, 0, -10.53449546673725, -2.0008720582248625, -17.9589318631188,
    27.94888452941996, -2.8589982771350235, -8.87285693353063, 12.360567175794303,
    0.6433927460157636,
  ],
];

/**
 * The same coefficients, flat, indexed `i * STAGES + j`.
 *
 * Flat and typed rather than a nested plain array because the inner loop reads it
 * once per stage per component, and because `noUncheckedIndexedAccess` types every
 * element of a ragged nested array as possibly `undefined` — which is true of the
 * ragged form and false of this one. Reshaping is the fix; a non-null assertion
 * would only have been a way of not fixing it.
 */
const A = new Float64Array(STAGES * STAGES);
for (let i = 0; i < STAGES; i++) {
  const row = A_ROWS[i] ?? [];
  for (let j = 0; j < row.length; j++) A[i * STAGES + j] = row[j] ?? 0;
}

/** Eighth-order weights `b`. */
const B = Float64Array.of(
  0.054293734116568765,
  0,
  0,
  0,
  0,
  4.450312892752409,
  1.8915178993145003,
  -5.801203960010585,
  0.3111643669578199,
  -0.1521609496625161,
  0.20136540080403034,
  0.04471061572777259,
);

/** Row views onto `A`, for the order-condition assertions. Views, not copies. */
const A_VIEWS: readonly Float64Array[] = Object.freeze(
  Array.from({ length: STAGES }, (_, i) => A.subarray(i * STAGES, i * STAGES + STAGES)),
);

/** Exposed so `dop853.test.ts` can assert the order conditions on the real tableau. */
export const TABLEAU = Object.freeze({ c: C, a: A_VIEWS, b: B, order: ORDER });

/** Tuning for an integration. */
export interface IntegrationOptions {
  /**
   * Absolute tolerance, per state component. Default 1e-9.
   *
   * The state mixes metres with metres per second, so a scalar absolute tolerance
   * is not dimensionally meaningful on its own. It is not meant to be: it is the
   * floor below which a component counts as negligible, which stops a component
   * passing through zero — `z` and `vz` on an equatorial orbit, which is the common
   * case here — from demanding infinite relative accuracy. The relative tolerance
   * is what actually sets the accuracy.
   */
  readonly absoluteTolerance?: number;
  /** Relative tolerance, per state component. Default 1e-12. */
  readonly relativeTolerance?: number;
  /** First step attempted, in seconds. Defaults to 1/1000 of the span. */
  readonly initialStep?: number;
  /** Cap on accepted steps. Default 100 000. */
  readonly maxSteps?: number;
}

/** What an integration returns. */
export type IntegrationResult =
  | {
      readonly converged: true;
      readonly state: State;
      /** Accepted steps. */
      readonly steps: number;
      /** Rejected step attempts. Part of the deterministic step sequence. */
      readonly rejected: number;
      /** Derivative evaluations. The honest cost of the answer. */
      readonly evaluations: number;
      /** Smallest accepted step, in seconds. Reported so a caller can see conditioning. */
      readonly smallestStep: number;
    }
  | {
      readonly converged: false;
      readonly reason: 'max-steps' | 'step-underflow' | 'out-of-domain';
      readonly steps: number;
    };

const DEFAULT_ABSOLUTE_TOLERANCE = 1e-9;
const DEFAULT_RELATIVE_TOLERANCE = 1e-12;
const DEFAULT_MAX_STEPS = 100_000;

/** Step-control safety factor, and the bounds on how fast the step may change. */
const SAFETY = 0.9;
const MIN_SHRINK = 0.2;
const MAX_GROWTH = 5;

/** Richardson divisor: the two-half-step result's error is 1/(2^p - 1) of the difference. */
const RICHARDSON = 2 ** ORDER - 1;

/** A state as six numbers: position then velocity. */
type Y = Float64Array;

/**
 * Read one element of a numeric buffer.
 *
 * `noUncheckedIndexedAccess` is on, and it applies to typed arrays as well as to
 * plain ones. Every read below goes through this rather than through a non-null
 * assertion, because the assertion would suppress a check the compiler is right to
 * make and this does not. Out of range yields `NaN` rather than zero: a numerical
 * routine that silently reads a missing coefficient as zero produces a plausible
 * wrong answer, which is the outcome this package exists to make impossible.
 */
const at = (values: ArrayLike<number>, index: number): number => values[index] ?? Number.NaN;

const state6 = (): Y => new Float64Array(DIMENSION);

/**
 * Two-body acceleration, written into `out` at `offset`. The only physics here.
 */
const derivative = (y: Y, yOffset: number, mu: number, out: Y, outOffset: number): void => {
  const x = at(y, yOffset);
  const yy = at(y, yOffset + 1);
  const z = at(y, yOffset + 2);
  const r = Math.sqrt(x * x + yy * yy + z * z);
  const factor = -mu / (r * r * r);
  out[outOffset] = at(y, yOffset + 3);
  out[outOffset + 1] = at(y, yOffset + 4);
  out[outOffset + 2] = at(y, yOffset + 5);
  out[outOffset + 3] = factor * x;
  out[outOffset + 4] = factor * yy;
  out[outOffset + 5] = factor * z;
};

/** Scratch buffers, allocated once per integration rather than once per step. */
interface Scratch {
  /** Stage derivatives, flat: stage `i` component `c` at `i * DIMENSION + c`. */
  readonly k: Float64Array;
  /** The argument each stage derivative is evaluated at. */
  readonly stage: Y;
}

/**
 * One 8th-order step of size `h` from `y`, given `f(y)` already in `k1`.
 *
 * `k1` is passed in rather than recomputed because every caller already has it: the
 * outer loop keeps the derivative at the current point, and the two half steps share
 * their first stage with the full step.
 */
const step = (
  y: Y,
  k1: Y,
  h: number,
  mu: number,
  out: Y,
  scratch: Scratch,
  budget: { evaluations: number },
): void => {
  const { k, stage } = scratch;
  k.set(k1, 0);

  for (let i = 1; i < STAGES; i++) {
    for (let component = 0; component < DIMENSION; component++) {
      let sum = 0;
      for (let j = 0; j < i; j++) {
        const coefficient = at(A, i * STAGES + j);
        if (coefficient !== 0) sum += coefficient * at(k, j * DIMENSION + component);
      }
      stage[component] = at(y, component) + h * sum;
    }
    derivative(stage, 0, mu, k, i * DIMENSION);
    budget.evaluations += 1;
  }

  for (let component = 0; component < DIMENSION; component++) {
    let sum = 0;
    for (let i = 0; i < STAGES; i++) {
      const weight = at(B, i);
      if (weight !== 0) sum += weight * at(k, i * DIMENSION + component);
    }
    out[component] = at(y, component) + h * sum;
  }
};

/**
 * Integrate the two-body problem from `state` by `dt` seconds.
 *
 * Takes the same shape of arguments as `propagate` so that `crosscheck.test.ts` can
 * put the two side by side without an adapter standing between them.
 *
 * @param dt Elapsed time. Negative integrates backwards, which is the same code.
 */
export const integrate = (
  state: State,
  dt: Seconds,
  mu: number,
  options: IntegrationOptions = {},
): IntegrationResult => {
  const atol = options.absoluteTolerance ?? DEFAULT_ABSOLUTE_TOLERANCE;
  const rtol = options.relativeTolerance ?? DEFAULT_RELATIVE_TOLERANCE;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;

  if (!(mu > 0) || !Number.isFinite(mu) || !Number.isFinite(dt)) {
    return { converged: false, reason: 'out-of-domain', steps: 0 };
  }
  if (!(atol > 0) || !(rtol > 0)) {
    return { converged: false, reason: 'out-of-domain', steps: 0 };
  }
  if (V.norm(state.position) === 0) {
    return { converged: false, reason: 'out-of-domain', steps: 0 };
  }

  const y = Float64Array.of(
    state.position.x,
    state.position.y,
    state.position.z,
    state.velocity.x,
    state.velocity.y,
    state.velocity.z,
  );

  const finish = (
    steps: number,
    rejected: number,
    evaluations: number,
    smallestStep: number,
  ): IntegrationResult => ({
    converged: true,
    state: {
      position: eci(V.vec3(metres(at(y, 0)), metres(at(y, 1)), metres(at(y, 2)))),
      velocity: eci(V.vec3(metresPerSec(at(y, 3)), metresPerSec(at(y, 4)), metresPerSec(at(y, 5)))),
    },
    steps,
    rejected,
    evaluations,
    smallestStep,
  });

  if (dt === 0) return finish(0, 0, 0, 0);

  const direction = Math.sign(dt);
  const span = Math.abs(dt);
  let h = Math.abs(options.initialStep ?? span / 1000);
  if (!(h > 0) || !Number.isFinite(h)) h = span / 1000;
  h = Math.min(h, span);

  const budget = { evaluations: 0 };
  const scratch: Scratch = { k: new Float64Array(STAGES * DIMENSION), stage: state6() };
  const k1 = state6();
  const halfK1 = state6();
  const full = state6();
  const half = state6();
  const twice = state6();

  let elapsed = 0;
  let steps = 0;
  let rejected = 0;
  let smallestStep = Number.POSITIVE_INFINITY;

  while (elapsed < span) {
    if (steps >= maxSteps) return { converged: false, reason: 'max-steps', steps };

    // Land exactly on the end rather than overshooting and interpolating back.
    h = Math.min(h, span - elapsed);
    // A step this small cannot advance `elapsed` in float64, so the loop would spin.
    if (h <= elapsed * Number.EPSILON * 8 || h === 0) {
      return { converged: false, reason: 'step-underflow', steps };
    }

    const signedStep = direction * h;
    derivative(y, 0, mu, k1, 0);
    budget.evaluations += 1;

    step(y, k1, signedStep, mu, full, scratch, budget);
    step(y, k1, signedStep / 2, mu, half, scratch, budget);
    derivative(half, 0, mu, halfK1, 0);
    budget.evaluations += 1;
    step(half, halfK1, signedStep / 2, mu, twice, scratch, budget);

    // Richardson: the two-half-step result is the accurate one, and the scaled
    // difference estimates *its* error rather than the single step's.
    let sumOfSquares = 0;
    for (let component = 0; component < DIMENSION; component++) {
      const scale =
        atol + rtol * Math.max(Math.abs(at(y, component)), Math.abs(at(twice, component)));
      const componentError = (at(twice, component) - at(full, component)) / RICHARDSON;
      sumOfSquares += (componentError / scale) ** 2;
    }
    const error = Math.sqrt(sumOfSquares / DIMENSION);

    // `error ** (-1/9)` for a method of order 8, clamped so one bad step cannot send
    // the step size to either extreme. `error === 0` means the step was exact to
    // float64, which does happen on a well-behaved orbit at a loose tolerance.
    const factor =
      error === 0
        ? MAX_GROWTH
        : Math.min(MAX_GROWTH, Math.max(MIN_SHRINK, SAFETY * error ** (-1 / (ORDER + 1))));

    if (error <= 1) {
      y.set(twice);
      elapsed += h;
      steps += 1;
      smallestStep = Math.min(smallestStep, h);
      h *= factor;
    } else {
      rejected += 1;
      // Never grow after a rejection: the estimate that rejected the step is the
      // best information available, and growing on it would oscillate.
      h *= Math.min(1, factor);
    }
  }

  return finish(steps, rejected, budget.evaluations, smallestStep);
};
