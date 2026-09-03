/**
 * The golden-trajectory regression suite — §7.6 Tier 4, issue #71.
 *
 * Every case in `cases.ts` is re-evaluated and compared against `fixtures.json`. A
 * difference larger than 1e-9 relative fails, and — by `physics-doc-gate.mjs` — a pull
 * request that legitimately moves a golden has to update `docs/PHYSICS.md` in the same
 * pull request (§11.13).
 *
 * `cases.ts` explains what a golden is for and why the cases are the cases;
 * `evaluate.ts` explains what is recorded and how the two kinds of number are
 * compared. This file is the assertion, and the writer behind `pnpm goldens:write`.
 *
 * ## Regeneration is a separate, deliberate act
 *
 * `pnpm goldens:write` runs this file with the writer enabled: it evaluates every case
 * and rewrites `fixtures.json`, asserting nothing. That is the only way the file
 * changes, and the change lands in the diff of the pull request that caused it, where
 * a reviewer can see which numbers moved and by how much. A suite that quietly
 * re-baselined itself on failure would be a suite that never fails.
 *
 * The writer lives in this file rather than in a script of its own because the two
 * have to agree exactly on what a record is, and the cheapest way to guarantee that is
 * for them to be the same code. `generate.mjs` is the entry point; it does nothing but
 * set the flag and start Vitest, because there is no TypeScript runner in this
 * toolchain and adding one for this would cost a dependency and an NFR-024 licence row.
 *
 * ## Why this is not in `packages/sim`
 *
 * It reads a file and, under the flag, writes one. `packages/**` is where the code that
 * must run unchanged in a browser and a Worker lives, and the core guardrail block bans
 * `process` there for exactly that reason. `tools/` is where this repository puts the
 * things that need a host, which is the same argument that put the benchmarks here.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { GoldenCase } from './cases.js';
import { GOLDEN_CASES } from './cases.js';
import type { GoldenRecord, RecordedState, Triple } from './evaluate.js';
import { evaluateCase, vectorDifference } from './evaluate.js';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures.json');

/** §7.6 Tier 4: "moves a golden value by more than 1e-9 relative". */
const TOLERANCE = 1e-9;

/** Set by `generate.mjs`. Anything else, including `0`, leaves the suite asserting. */
const WRITING = env['HH_WRITE_GOLDENS'] === '1';

/** The fixture file's own shape. */
interface FixtureFile {
  readonly note: string;
  readonly tolerance: number;
  readonly caseCount: number;
  readonly cases: readonly GoldenRecord[];
}

// ── Serialisation ──────────────────────────────────────────────────────────────
//
// Hand-rolled rather than `JSON.stringify(value, null, 2)`, for one reason: a
// pretty-printed array puts every element on its own line, which would turn a
// three-component position into four lines and a 90 kB file into a 400 kB one that
// nobody can read a diff of. Numeric arrays stay inline; everything else is indented.
// The number formatting is `JSON.stringify`'s own, which is the shortest string that
// round-trips to the same float64 — so the file is exact, and the 1e-9 tolerance below
// is the *contract*, not a limitation of the storage.

const isNumberArray = (value: readonly unknown[]): boolean =>
  value.every((entry) => typeof entry === 'number');

const write = (value: unknown, indent: string): string => {
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    if (items.length === 0) return '[]';
    if (isNumberArray(items)) return `[${items.map((n) => JSON.stringify(n)).join(', ')}]`;
    const inner = `${indent}  `;
    return `[\n${items.map((item) => `${inner}${write(item, inner)}`).join(',\n')}\n${indent}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const inner = `${indent}  `;
    const body = entries
      .map(([key, entry]) => `${inner}${JSON.stringify(key)}: ${write(entry, inner)}`)
      .join(',\n');
    return `{\n${body}\n${indent}}`;
  }
  // Strings and numbers only by the time we get here: `GoldenRecord` admits nothing
  // else, so `JSON.stringify`'s `undefined` return — which it gives for a function or
  // for `undefined` itself — is unreachable, and TypeScript types it away accordingly.
  return JSON.stringify(value);
};

const serialise = (file: FixtureFile): string => `${write(file, '')}\n`;

// ── Comparison ─────────────────────────────────────────────────────────────────

/** `expect` on a vector, phrased so the failure message says which vector and by how much. */
const expectVector = (actual: Triple, expected: Triple, what: string): void => {
  const difference = vectorDifference(actual, expected);
  if (difference <= TOLERANCE) return;
  throw new Error(
    `${what} moved by ${difference.toExponential(3)} relative, above §7.6's ${TOLERANCE.toExponential(0)}.\n` +
      `  golden:   [${expected.join(', ')}]\n` +
      `  measured: [${actual.join(', ')}]\n` +
      'If this change is intended, regenerate with `pnpm goldens:write` and record what changed ' +
      'in docs/PHYSICS.md in the same pull request (§11.13).',
  );
};

const expectState = (actual: RecordedState, expected: RecordedState, what: string): void => {
  expectVector(actual.r, expected.r, `${what} position`);
  expectVector(actual.v, expected.v, `${what} velocity`);
};

const compare = (test: GoldenCase, golden: GoldenRecord): void => {
  const actual = evaluateCase(test);

  // The spec itself, first. A case edited without a regeneration would otherwise
  // surface as a state difference, which names the symptom and not the cause.
  expect(
    {
      description: actual.description,
      mu: actual.mu,
      startTicks: actual.startTicks,
      horizonTicks: actual.horizonTicks,
      nodes: actual.nodes,
    },
    `the spec for "${test.id}" differs from the one the fixture was generated from. ` +
      'Regenerate with `pnpm goldens:write`.',
  ).toEqual({
    description: golden.description,
    mu: golden.mu,
    startTicks: golden.startTicks,
    horizonTicks: golden.horizonTicks,
    nodes: golden.nodes,
  });

  // Arc boundaries are exact: every one is a tick count over 1024, so a difference of
  // one ulp is a change of method rather than round-off. See `evaluate.ts`.
  expect(actual.arcs, `arc boundaries of "${test.id}"`).toEqual(golden.arcs);

  expectState(actual.initial, golden.initial, `"${test.id}" initial state`);

  expect(actual.impulses.length, `impulse count of "${test.id}"`).toBe(golden.impulses.length);
  for (const [i, impulse] of actual.impulses.entries()) {
    const expected = golden.impulses[i];
    if (expected === undefined) throw new Error(`missing golden impulse ${String(i)}`);
    expect(impulse.epoch, `"${test.id}" impulse ${String(i)} epoch`).toBe(expected.epoch);
    expectState(impulse.before, expected.before, `"${test.id}" impulse ${String(i)} before`);
    expectState(impulse.after, expected.after, `"${test.id}" impulse ${String(i)} after`);
    expectVector(impulse.dvEci, expected.dvEci, `"${test.id}" impulse ${String(i)} Δv (ECI)`);
  }

  expect(
    actual.samples.map((sample) => sample.ticks),
    `sample epochs of "${test.id}"`,
  ).toEqual(golden.samples.map((sample) => sample.ticks));

  for (const [i, sample] of actual.samples.entries()) {
    const expected = golden.samples[i];
    if (expected === undefined) throw new Error(`missing golden sample ${String(i)}`);
    const at = `"${test.id}" sample at ${String(sample.ticks)} ticks`;
    expectVector(sample.r, expected.r, `${at} position`);
    expectVector(sample.v, expected.v, `${at} velocity`);
  }
};

// ── The suite ──────────────────────────────────────────────────────────────────

if (WRITING) {
  describe('regenerating tools/goldens/fixtures.json', () => {
    it('evaluates every case and writes the fixture file', () => {
      const cases = GOLDEN_CASES.map(evaluateCase);
      const file: FixtureFile = {
        note:
          'Golden trajectories — docs/PRODUCT.md §7.6 Tier 4. Generated by `pnpm goldens:write` ' +
          'from tools/goldens/cases.ts; do not edit by hand. A change here is a change to a ' +
          'physics result and must be described in docs/PHYSICS.md in the same pull request ' +
          '(§11.13, enforced by tools/goldens/physics-doc-gate.mjs).',
        tolerance: TOLERANCE,
        caseCount: cases.length,
        cases,
      };

      writeFileSync(FIXTURES, serialise(file));
      stdout.write(
        `  wrote ${String(cases.length)} golden cases, ` +
          `${String(cases.reduce((n, c) => n + c.samples.length, 0))} sampled states, to ` +
          'tools/goldens/fixtures.json\n',
      );
      expect(cases.length).toBe(GOLDEN_CASES.length);
    }, 120_000);
  });
} else {
  const parsed: unknown = JSON.parse(readFileSync(FIXTURES, 'utf8'));
  const fixtures = parsed as FixtureFile;

  describe('golden trajectories (§7.6 Tier 4)', () => {
    it('has a fixture for every case and no others', () => {
      expect(
        fixtures.cases.map((entry) => entry.id),
        'the fixture file and the case set have drifted apart — run `pnpm goldens:write`',
      ).toEqual(GOLDEN_CASES.map((test) => test.id));
      expect(fixtures.caseCount).toBe(fixtures.cases.length);
      expect(fixtures.tolerance).toBe(TOLERANCE);
    });

    it('covers every conic class and the degenerate cases #71 names', () => {
      // Not a tautology over the ids: this reads the eccentricities and inclinations
      // out of the specs, so deleting the retrograde case or softening the parabolic
      // one to e = 0.99 fails here rather than silently thinning the set.
      const eccentricities = GOLDEN_CASES.map((test) => test.elements.eccentricity);
      const inclinations = GOLDEN_CASES.map((test) => test.elements.inclination as number);

      expect(eccentricities, 'a circular case').toContain(0);
      expect(eccentricities, 'an exactly parabolic case').toContain(1);
      expect(
        eccentricities.some((e) => e > 0 && e < 0.5),
        'a low-eccentricity case',
      ).toBe(true);
      expect(
        eccentricities.some((e) => e >= 0.5 && e < 0.99),
        'a high-eccentricity case',
      ).toBe(true);
      expect(
        eccentricities.some((e) => e > 0.99 && e < 1),
        'a near-parabolic ellipse',
      ).toBe(true);
      expect(
        eccentricities.some((e) => e > 1 && e < 1.01),
        'a near-parabolic hyperbola',
      ).toBe(true);
      expect(
        eccentricities.some((e) => e >= 1.01),
        'a well-open hyperbola',
      ).toBe(true);

      expect(inclinations, 'an equatorial prograde case').toContain(0);
      expect(inclinations, 'a retrograde equatorial case (sin i = 0, i ≠ 0)').toContain(Math.PI);
      expect(
        inclinations.some((i) => i > Math.PI / 2 && i < Math.PI),
        'a retrograde case',
      ).toBe(true);
      expect(inclinations, 'a polar case').toContain(Math.PI / 2);

      // The plan-structure group, read the same way.
      expect(
        GOLDEN_CASES.some((test) => test.nodes.length === 0),
        'an empty plan',
      ).toBe(true);
      expect(
        GOLDEN_CASES.some((test) => test.nodes.length === 12),
        '§13.3’s twelve-node maximum',
      ).toBe(true);
      expect(
        GOLDEN_CASES.some((test) => test.nodes.some(([t]) => t === test.startTicks)),
        'a node on the start epoch',
      ).toBe(true);
      expect(
        GOLDEN_CASES.some((test) => test.nodes.some(([t]) => t === test.horizonTicks)),
        'a node on the horizon',
      ).toBe(true);
      expect(
        GOLDEN_CASES.some((test) =>
          test.nodes.some(([, r, tr, n]) => r === 0 && tr === 0 && n === 0),
        ),
        'a zero-Δv node',
      ).toBe(true);
    });

    it.each(GOLDEN_CASES.map((test) => [test.id, test] as const))(
      'reproduces %s',
      (id, test) => {
        const golden = fixtures.cases.find((entry) => entry.id === id);
        if (golden === undefined) {
          throw new Error(`no golden fixture for "${id}" — run \`pnpm goldens:write\``);
        }
        compare(test, golden);
      },
      60_000,
    );
  });
}
