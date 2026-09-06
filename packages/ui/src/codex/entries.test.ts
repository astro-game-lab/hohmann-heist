/**
 * The entries are complete, consistent, and point at things that exist — #161, #163.
 *
 * The compiler already carries most of FR-903 here: `CODEX_ENTRIES` is a **total** record
 * over `CodexSlug`, so a slug with no entry does not build, and each entry's key fields are
 * typed as the one literal they may hold. What is left for a test is the half a type cannot
 * state — that the ids inside an entry name real things, and that the runtime list and the
 * union have not drifted apart behind a cast.
 */
import { CODEX_SLUGS, departureById } from '@hh/game';
import { describe, expect, it } from 'vitest';

import { createCatalogue } from '../catalogue/resolve.js';

import { keysOf, resolveNumbers } from './entry.js';
import { CODEX_ENTRIES, entriesByAct, entryBySlug } from './entries.js';

const catalogue = createCatalogue();
const entries = Object.values(CODEX_ENTRIES);

describe('coverage', () => {
  /**
   * FR-903: *"one entry per learning outcome in §6.12"*.
   *
   * The record is total over the union, so the compiler enforces one direction. This is the
   * other: `CODEX_SLUGS` is hand-ordered for the index's reading order, and an entry added
   * to the table without a row there would be invisible to anything iterating the list.
   */
  it('has an entry for every slug, and a slug for every entry', () => {
    expect([...CODEX_SLUGS].sort()).toStrictEqual(Object.keys(CODEX_ENTRIES).sort());
  });

  it('gives every entry the slug it is filed under', () => {
    for (const [slug, entry] of Object.entries(CODEX_ENTRIES)) {
      expect(entry.slug, slug).toBe(slug);
    }
  });

  /**
   * #163: *"a test asserts every Codex slug referenced by a diagnosis rule resolves."*
   *
   * Every rule's `codex` field is typed `CodexSlug` and this covers the whole union, so
   * there is no rule this misses — including C08's, whose entry is an act ahead of its
   * milestone precisely so that this can be true (see `entries.ts`).
   */
  it('resolves every slug a diagnosis rule can name', () => {
    for (const slug of CODEX_SLUGS) {
      expect(entryBySlug(slug), slug).toBeDefined();
    }
  });

  it('does not resolve anything else', () => {
    expect(entryBySlug('not-an-entry')).toBeUndefined();
    // A prototype property is not an entry. `Object.hasOwn` is what makes this true, and it
    // is the kind of thing a refactor to `in` would quietly break.
    expect(entryBySlug('toString')).toBeUndefined();
    expect(entryBySlug('constructor')).toBeUndefined();
  });
});

describe('every layer says something', () => {
  it('resolves all five of each entry’s keys to non-empty text', () => {
    for (const entry of entries) {
      for (const key of keysOf(entry)) {
        expect(catalogue.has(key), `${entry.slug}: ${key}`).toBe(true);
      }
      // The three parameterless layers, and then the numbers with the entry's own figures —
      // which is the call the view makes, cast and all.
      expect(catalogue.resolve(entry.titleKey, {}).trim(), entry.slug).not.toBe('');
      expect(catalogue.resolve(entry.subtitleKey, {}).trim(), entry.slug).not.toBe('');
      expect(catalogue.resolve(entry.sentenceKey, {}).trim(), entry.slug).not.toBe('');
      expect(catalogue.resolve(entry.realWorldKey, {}).trim(), entry.slug).not.toBe('');
      expect(resolveNumbers(entry, catalogue.resolve).trim(), entry.slug).not.toBe('');
    }
  });

  /**
   * #163: *"every entry's first layer is one sentence that answers its outcome without the
   * other three layers."*
   *
   * One sentence, checked as one terminal full stop. Crude, and it catches the thing worth
   * catching: a "sentence" layer that has quietly become a paragraph is a layer that no
   * longer does the job §8.3.10 gives it, and the drift happens an edit at a time.
   */
  it('keeps the first layer to a single sentence', () => {
    for (const entry of entries) {
      const sentence = catalogue.resolve(entry.sentenceKey, {});
      expect(sentence.trim().endsWith('.'), entry.slug).toBe(true);
      // Abbreviations would break a naive count; there are none in these six, and a full
      // stop appearing mid-layer is exactly the second sentence being caught.
      expect(
        sentence.split('.').filter((part) => part.trim() !== ''),
        entry.slug,
      ).toHaveLength(1);
    }
  });

  /** No number is rendered as `undefined` because a figure was misnamed. */
  it('never renders a missing figure', () => {
    for (const entry of entries) {
      expect(resolveNumbers(entry, catalogue.resolve), entry.slug).not.toContain('undefined');
      expect(resolveNumbers(entry, catalogue.resolve), entry.slug).not.toContain('NaN');
    }
  });
});

describe('FR-904’s departures', () => {
  /**
   * *"Every Codex entry MUST link the relevant departures from §7.5 and `docs/PHYSICS.md`."*
   *
   * Resolved through `@hh/game`'s registry rather than described in prose, so an entry
   * cannot characterise a simplification differently from the way the departures table
   * does — and a DEP id that is renamed or retired fails here rather than rendering as a
   * dangling reference.
   */
  it('names only departures that are in the registry', () => {
    for (const entry of entries) {
      for (const id of entry.departures) {
        expect(departureById(id), `${entry.slug}: ${id}`).toBeDefined();
      }
    }
  });

  it('gives every entry at least one', () => {
    for (const entry of entries) {
      expect(entry.departures.length, entry.slug).toBeGreaterThan(0);
    }
  });

  it('names each departure once per entry', () => {
    for (const entry of entries) {
      expect([...new Set(entry.departures)], entry.slug).toStrictEqual([...entry.departures]);
    }
  });
});

describe('the index groups itself', () => {
  it('lists every entry exactly once, in act order', () => {
    const grouped = entriesByAct();
    expect(grouped.map(([act]) => act)).toStrictEqual([...grouped.map(([act]) => act)].sort());
    expect(grouped.flatMap(([, group]) => group)).toHaveLength(entries.length);
    for (const [act, group] of grouped) {
      for (const entry of group) expect(entry.act, entry.slug).toBe(act);
    }
  });

  it('puts Acts I and II first, which is what M3 ships', () => {
    expect(entriesByAct()[0]?.[0]).toBe(1);
    expect(entries.filter((entry) => entry.act <= 2)).toHaveLength(6);
  });
});
