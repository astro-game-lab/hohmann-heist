/**
 * The departures registry against `docs/PHYSICS.md` — #84, §7.5, NFR-005.
 *
 * The half of #84 that needs a filesystem, and so cannot live beside the code it checks:
 * `node:fs` is banned in `packages/**` by the core guardrail block, correctly, since the
 * simulation must never read a file. `packages/game/src/departures.test.ts` holds the
 * rest.
 *
 * ## Why a cross-check rather than one list
 *
 * Two lists that can drift are one list too many, and the obvious fix — generate the
 * table from the registry — is worse than it looks. The table is prose: each row argues
 * why the departure is acceptable, in a document a reader is expected to read straight
 * through. Generating it would either lose the prose or move the prose into a
 * TypeScript string literal, and a paragraph inside a `.ts` file is a paragraph nobody
 * edits.
 *
 * So both exist, and this asserts they say the same thing about the three facts that
 * are checkable: **which departures there are, which layer each lives in, and whether
 * the player is told**. The *reasons* are not compared — no script can check an
 * argument, and pretending to would be worse than not trying.
 *
 * ## What "checkable" excludes, and why the gate is still worth having
 *
 * A departure implemented in code and written down nowhere is invisible to this, to
 * `dependency-cruiser`, and to every other mechanical check: it looks exactly like a
 * constant. Nothing here closes that. What it does close is the failure that actually
 * happens — someone adds a row to one list, means to add it to the other, and does not.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEPARTURES, isAboveCore, isCore } from '@hh/game';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PHYSICS_DOC = join(REPO_ROOT, 'docs', 'PHYSICS.md');

/** One row of the gameplay-departures table, as the document states it. */
interface DocumentedDeparture {
  readonly id: string;
  /** The package named in the "Lives in" cell, without any parenthetical note. */
  readonly package: string;
  /** Whether the "Lives in" cell carries the *(… not a cheat)* marker. */
  readonly markedCore: boolean;
  readonly playerVisible: boolean;
}

/** Split a markdown table row into its cells. */
const cells = (line: string): string[] =>
  line
    .slice(1, line.lastIndexOf('|'))
    .split('|')
    .map((cell) => cell.trim());

/**
 * Parse the gameplay-departures table out of `docs/PHYSICS.md`.
 *
 * Deliberately literal: it matches rows beginning `| DEP-`, and reads the first
 * backticked token of the "Lives in" cell as the package. A parser that tried to be
 * clever about the prose would fail in ways that are hard to tell apart from a real
 * disagreement, which is the one thing a gate must not do.
 */
const parseDocument = (): readonly DocumentedDeparture[] =>
  readFileSync(PHYSICS_DOC, 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('| DEP-'))
    .map((line) => {
      const [id, , livesIn, , visible] = cells(line);
      const packageName = /`([^`]+)`/.exec(livesIn ?? '')?.[1] ?? '';
      return {
        id: id ?? '',
        package: packageName,
        markedCore: (livesIn ?? '').includes('not a cheat'),
        playerVisible: (visible ?? '').startsWith('Yes'),
      };
    });

const documented = parseDocument();
const byId = new Map(documented.map((row) => [row.id, row]));

describe('the departures table parses at all', () => {
  // If this fails, every assertion below is vacuous — so it is asserted rather than
  // assumed. A gate that silently stops finding anything is worse than no gate.
  it('finds every row, with a package and a visibility for each', () => {
    expect(documented.length).toBeGreaterThanOrEqual(13);
    for (const row of documented) {
      expect(row.id, JSON.stringify(row)).toMatch(/^DEP-\d\d$/);
      expect(row.package, row.id).toMatch(/^@hh\//);
    }
  });
});

describe('the registry and docs/PHYSICS.md agree', () => {
  // The failure this exists to catch: a row added to one list and not the other.
  it('lists exactly the same departures', () => {
    expect(DEPARTURES.map((departure) => departure.id)).toStrictEqual(
      documented.map((row) => row.id),
    );
  });

  it('puts each departure in the same package', () => {
    for (const departure of DEPARTURES) {
      const row = byId.get(departure.id);
      expect(row, `${departure.id} is not in docs/PHYSICS.md`).toBeDefined();
      if (row === undefined || departure.module === null) continue;
      // The registry names a module; the table names a package. Compare the package.
      expect(
        departure.module.startsWith(row.package),
        `${departure.id}: registry says ` + `${departure.module}, the table says ${row.package}`,
      ).toBe(true);
    }
  });

  it('marks the same rows as core exceptions', () => {
    for (const departure of DEPARTURES) {
      const row = byId.get(departure.id);
      if (row === undefined) continue;
      expect(row.markedCore, departure.id).toBe(departure.layer === 'core');
      expect(isCore(row.package), departure.id).toBe(departure.layer === 'core');
      if (departure.layer === 'above-core') expect(isAboveCore(row.package)).toBe(true);
    }
  });

  it('agrees on which departures the player is told about', () => {
    for (const departure of DEPARTURES) {
      const row = byId.get(departure.id);
      if (row === undefined) continue;
      expect(row.playerVisible, departure.id).toBe(departure.visibility === 'player-visible');
    }
  });
});

describe('§7.5’s rule, against the document rather than the registry', () => {
  // Same assertion as the package test, made against the *other* list: a departure
  // could be moved into the core in the table alone, and that must fail too.
  it('keeps every departure in @hh/game or above unless the table says why', () => {
    for (const row of documented) {
      if (isAboveCore(row.package)) continue;
      expect(isCore(row.package), row.id).toBe(true);
      expect(row.markedCore, `${row.id} sits in the core without a stated reason`).toBe(true);
    }
  });
});
