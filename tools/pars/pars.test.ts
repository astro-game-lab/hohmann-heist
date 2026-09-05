/**
 * The par harness, in both of its modes — #89.
 *
 * `pnpm pars:check` (the default) recomputes every contract's par from the scenario alone
 * and fails when it does not match what is committed. `pnpm pars:write` recomputes and
 * writes the answer into the scenario files and into `docs/PARS.md`.
 *
 * Writer and checker are the same file for the reason `tools/goldens` gives: the cheapest
 * guarantee that a generated artefact matches what regenerating it would produce is for
 * one piece of code to do both. If the two were separate, "reproduces the same par" would
 * be a claim about two implementations agreeing rather than about the search being
 * deterministic.
 *
 * ## Why this is not in `pnpm test:all`
 *
 * It is a **search**, not an assertion. Every other project in `vitest.config.ts` costs
 * milliseconds; this one runs tens of thousands of Lambert solves. It is a separate CI
 * step (`pnpm pars:check`) beside `pnpm schema:check`, which gates exactly the same thing
 * without charging every inner-loop `pnpm test` for it. §13.4's seven checks — which *are*
 * fast, because they only replay a stored answer — run in `test:all` as the `content`
 * project.
 *
 * ## The rounding is the tolerance
 *
 * `docs/PARS.md` explains that §11.4 does not claim bit-identical results across
 * JavaScript engines, so a recomputed par can move in its last digits. Rather than
 * comparing with a tolerance bolted on top, the written values are **rounded to DEP-09's
 * quanta** — 1e-4 m/s and 1e-3 s — and compared exactly. Rounding absorbs anything below
 * half a quantum, which is four orders of magnitude more headroom than float noise needs,
 * and it means the committed number is exactly the number a re-run produces rather than
 * one that is merely near it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env, stdout } from 'node:process';

import { format, resolveConfig } from 'prettier';
import { beforeAll, describe, expect, it } from 'vitest';

import { replayTextFor, requireContract } from '../content/evaluate.js';
import type { ContractFile } from '../content/scenarios.js';
import { REPO_ROOT, contractFiles } from '../content/scenarios.js';
import { closedFormFor } from './crosscheck.js';
import type { ParRecord } from './document.js';
import { parBlockFor, parsDocument } from './document.js';
import { solvePar } from './solve.js';

const PARS_DOCUMENT = join(REPO_ROOT, 'docs', 'PARS.md');

const WRITING = env['HH_WRITE_PARS'] === '1';

const files = contractFiles();
const solved = new Map<string, ParRecord>();

const recordFor = (stem: string): ParRecord => {
  const record = solved.get(stem);
  if (record === undefined) {
    throw new Error(`no par was computed for "${stem}"; the solve must have failed`);
  }
  return record;
};

beforeAll(() => {
  for (const file of files) {
    const scenario = requireContract(file);
    const solution = solvePar(scenario);
    solved.set(file.stem, {
      file,
      scenario,
      solution,
      replayText: replayTextFor(scenario, solution.outcome),
    });
  }
  // The searches are the whole cost of this project, so say what they bought. Written
  // unconditionally: on the check path it is the only sign the work happened at all.
  for (const file of files) {
    const { solution } = recordFor(file.stem);
    const { search } = solution;
    // Each family did different work, so each says what it did rather than all three
    // being described in the terms of the one that happened to be written first.
    const effort =
      search.kind === 'lambert'
        ? `${String(search.gridPoints)} grid points and ` +
          `${String(search.refinementIterations)} simplex iterations`
        : search.kind === 'transfer'
          ? `${String(search.departureSamples)} departure samples and ` +
            `${String(search.refinementIterations)} simplex iterations`
          : search.kind === 'phasing'
            ? `${String(search.membersEnumerated)} phasing members`
            : `${String(search.family.length)} drift-family members`;
    stdout.write(
      `${file.stem}: ${solution.outcome.dvMps.toFixed(4)} m/s in ` +
        `${String(solution.outcome.burns)} burn(s) at MET ` +
        `${(solution.outcome.metSeconds ?? 0).toFixed(3)} s, from ${effort}\n`,
    );
  }
}, 600_000);

/** The scenario file with its `par` block replaced, formatted the way the repo formats. */
const scenarioTextFor = async (record: ParRecord): Promise<string> => {
  const document = JSON.parse(record.file.text) as Record<string, unknown>;
  // Assignment to an existing key, so `par` keeps its place in the file rather than
  // moving to the end and making every regeneration a whole-file diff.
  document['par'] = parBlockFor(record);
  const config = await resolveConfig(record.file.path);
  return format(JSON.stringify(document, null, 2), {
    ...(config ?? {}),
    filepath: record.file.path,
  });
};

if (WRITING) {
  describe('regenerating par values', () => {
    it('writes the par block into every scenario file', async () => {
      expect(files).not.toEqual([]);
      for (const file of files) {
        const record = recordFor(file.stem);
        writeFileSync(record.file.path, await scenarioTextFor(record));
        stdout.write(`wrote ${record.file.relativePath}\n`);
      }
    });

    it('writes docs/PARS.md', () => {
      writeFileSync(PARS_DOCUMENT, parsDocument(files.map((file) => recordFor(file.stem))), 'utf8');
      stdout.write('wrote docs/PARS.md\n');
    });
  });
} else {
  describe('the search itself', () => {
    // Every assertion below is per contract, so an empty directory would pass the suite
    // by having nothing to run.
    it('found a contract to solve', () => {
      expect(files.map((file) => file.stem)).not.toEqual([]);
    });
  });

  describe.each(files.map((file): readonly [string, ContractFile] => [file.stem, file]))(
    '%s',
    (stem) => {
      it('reproduces the committed par (#89)', () => {
        const record = recordFor(stem);
        const expected = parBlockFor(record);
        const committed = record.scenario.document.par;
        expect({
          dv_mps: committed.dv_mps,
          time_s: committed.time_s,
          burns: committed.burns,
        }).toEqual({
          dv_mps: expected.dv_mps,
          time_s: expected.time_s,
          burns: expected.burns,
        });
      });

      it('reproduces the committed derivation and reference replay', () => {
        const record = recordFor(stem);
        const expected = parBlockFor(record);
        expect(record.scenario.document.par.derivation).toBe(expected.derivation);
        expect(record.scenario.document.par.referenceReplay).toBe(expected.referenceReplay);
      });

      it('is committed exactly as `pnpm pars:write` would write it', async () => {
        const record = recordFor(stem);
        expect(await scenarioTextFor(record)).toBe(record.file.text);
      });
    },
  );

  describe('independent cross-check (§7.6)', () => {
    /**
     * Each contract against the closed form its own geometry admits, at that form's own
     * tolerance.
     *
     * The tolerance travels with the reference rather than being one constant here,
     * because the four forms are not equally exact: three are algebraic identities and are
     * held to DEP-09's quantisation noise, while the drift relation is a first-order
     * expansion and is held to its own second-order term. `crosscheck.ts` carries the
     * reasoning for each; asserting them all to a quantum would mean asserting that a
     * linearisation is exact.
     */
    it('agrees with the closed form on every contract whose geometry admits one', () => {
      const checked: string[] = [];
      for (const file of files) {
        const record = recordFor(file.stem);
        const reference = closedFormFor(record.scenario, record.solution.outcome.metSeconds ?? 0);
        // A contract with an eccentric target or an arrival burn has no one-line closed
        // form; `docs/PARS.md` says so in its entry rather than implying a check happened.
        if (reference === null) continue;
        checked.push(file.stem);
        const difference = Math.abs(record.solution.outcome.dvMps - reference.expectedMps);
        expect(
          difference,
          `${file.stem}: the search found ${String(record.solution.outcome.dvMps)} m/s and ` +
            `${reference.method} gives ${String(reference.expectedMps)} m/s`,
        ).toBeLessThan(reference.toleranceMps);
      }
      // Vacuous otherwise: a suite that checked nothing must not report success.
      expect(checked).not.toEqual([]);
    });

    /**
     * Every shipped contract has a cross-check, and the suite says so out loud.
     *
     * `closedFormFor` returning `null` is a legitimate answer — an eccentric target has no
     * one-line form — but at M3 every contract is coplanar, circular and equatorial, so a
     * `null` here means the geometry test stopped recognising something rather than that
     * the contract is genuinely unreachable by a closed form. Without this, a refactor that
     * broke the recognition would make the check above pass by checking nothing.
     */
    it('finds a closed form for every contract that ships today', () => {
      const missing = files
        .map((file) => recordFor(file.stem))
        .filter(
          (record) =>
            closedFormFor(record.scenario, record.solution.outcome.metSeconds ?? 0) === null,
        )
        .map((record) => record.file.stem);
      expect(missing).toEqual([]);
    });
  });

  describe('docs/PARS.md (§6.7)', () => {
    it('records the derivation the solver actually produced', () => {
      const expected = parsDocument(files.map((file) => recordFor(file.stem)));
      expect(readFileSync(PARS_DOCUMENT, 'utf8')).toBe(expected);
    });
  });
}
