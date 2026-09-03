/**
 * The departures registry — #84, §7.5, NFR-005.
 *
 * The half of the check that needs no filesystem. The other half — that the registry
 * and `docs/PHYSICS.md` agree, and that each named module exists — reads files, and
 * `node:fs` is banned in `packages/**` by the core guardrail block, so it lives in
 * `tools/guardrails/departures.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import type { Departure } from './departures.js';
import {
  DEPARTURES,
  departureById,
  isAboveCore,
  isCore,
  playerVisibleDepartures,
} from './departures.js';

const coreRows = DEPARTURES.filter(
  (d): d is Extract<Departure, { layer: 'core' }> => d.layer === 'core',
);

describe('the departures registry', () => {
  it('has no duplicate identifiers', () => {
    const ids = DEPARTURES.map((departure) => departure.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lists identifiers in order, so anything rendering it is deterministic', () => {
    const ids = DEPARTURES.map((departure) => departure.id);
    expect(ids).toStrictEqual([...ids].sort());
  });

  // §7.5's rule, and the reason this file exists: nothing in the table may sit in
  // `@hh/math`, `@hh/astro`, `@hh/propagation` or `@hh/sim` — unless it is one of the
  // rows that is not a simplification for fun, which has to say so.
  it('puts every departure in @hh/game or above, or states why it is in the core', () => {
    for (const departure of DEPARTURES) {
      if (departure.module === null) continue;
      if (departure.layer === 'above-core') {
        expect(isAboveCore(departure.module), `${departure.id} names ${departure.module}`).toBe(
          true,
        );
        expect(isCore(departure.module), `${departure.id} names ${departure.module}`).toBe(false);
      } else {
        expect(isCore(departure.module), `${departure.id} names ${departure.module}`).toBe(true);
      }
    }
  });

  it('requires a stated reason for every core row', () => {
    for (const departure of coreRows) {
      expect(departure.coreReason.length, `${departure.id} has no reason`).toBeGreaterThan(40);
    }
  });

  // The exception exists so the table can be honest, not so it can be convenient. If
  // this number grows, the growth should be a conversation rather than a diff.
  it('has exactly three core rows: DEP-01, DEP-09 and DEP-11', () => {
    expect(coreRows.map((departure) => departure.id)).toStrictEqual(['DEP-01', 'DEP-09', 'DEP-11']);
  });

  it('gives every active departure a summary', () => {
    for (const departure of DEPARTURES) {
      expect(departure.summary.length, departure.id).toBeGreaterThan(10);
    }
  });

  it('names a module for every departure this milestone implements', () => {
    const named = DEPARTURES.filter((d) => d.status === 'active' && d.module !== null).map(
      (d) => d.id,
    );
    // DEP-11 is active and has no module: it is realised by absence, which the type
    // permits and the registry documents.
    expect(named).toStrictEqual([
      'DEP-01',
      'DEP-02',
      'DEP-03',
      'DEP-04',
      'DEP-08',
      'DEP-09',
      'DEP-13',
    ]);
  });

  it('finds a row by identifier, and nothing for one that is not there', () => {
    expect(departureById('DEP-03')?.summary).toContain('Rendezvous tolerance');
    expect(departureById('DEP-99')).toBeUndefined();
  });

  it('exposes the player-visible rows the briefing and Codex render', () => {
    const visible = playerVisibleDepartures().map((departure) => departure.id);
    expect(visible).toContain('DEP-03');
    // DEP-07 (node snapping) and DEP-09 (quantisation) are the two the table marks
    // internal; the assist tray lists the first and nothing shows the second.
    expect(visible).not.toContain('DEP-07');
    expect(visible).not.toContain('DEP-09');
  });
});

describe('layer prefix tests', () => {
  it('matches a package and its subpaths, and nothing that merely starts the same way', () => {
    expect(isAboveCore('@hh/game')).toBe(true);
    expect(isAboveCore('@hh/game/objectives/tolerances')).toBe(true);
    expect(isAboveCore('@hh/gameplay')).toBe(false);
    expect(isCore('@hh/sim/quantise')).toBe(true);
    expect(isCore('@hh/simulator')).toBe(false);
  });
});
