import { describe, expect, it } from 'vitest';

import { CURRENT_SAVE_VERSION } from './schema.js';
import { MIGRATIONS, isContiguous, migrate, type Migration, type UnknownSave } from './migrate.js';

/**
 * A synthetic chain, standing in for the migrations that do not exist yet.
 *
 * Version 1 is the first version, so `MIGRATIONS` is empty and there is nothing real to
 * drive the machinery with. Testing it against a made-up chain is the whole point rather
 * than a compromise: what has to be true on the day the first real migration is written
 * is that steps run in order, that a gap is refused, and that a future version never
 * reaches a reader — none of which depends on what any particular migration does.
 */
const migrate_1_2: Migration = {
  from: 1,
  to: 2,
  apply: (save) => ({ ...save, v: 2, added: 'by 1→2' }),
};

const migrate_2_3: Migration = {
  from: 2,
  to: 3,
  apply: (save) => ({ ...save, v: 3, added: `${String(save['added'])} then 2→3` }),
};

const CHAIN = [migrate_1_2, migrate_2_3];

describe('the shipped chain', () => {
  // Not a placeholder. `migrate.ts` says why an invented `migrate_0_1` would be worse
  // than an empty array.
  it('is empty, because version 1 is the first version', () => {
    expect(MIGRATIONS).toStrictEqual([]);
    expect(CURRENT_SAVE_VERSION).toBe(1);
  });

  it('runs from 1 to the current version with no gaps', () => {
    expect(isContiguous(MIGRATIONS)).toBe(true);
  });

  // The check above is trivially satisfied today and will not be tomorrow, so this is
  // what proves it is a check at all.
  it('would reject a chain with a gap, or one that goes backwards', () => {
    expect(isContiguous([migrate_1_2, migrate_2_3], 3)).toBe(true);
    expect(isContiguous([migrate_1_2], 3)).toBe(false);
    expect(isContiguous([migrate_2_3], 3)).toBe(false);
    expect(isContiguous([{ from: 1, to: 1, apply: (s) => s }], 1)).toBe(false);
  });
});

describe('migrating forward', () => {
  it('leaves a current save alone and says it did not migrate', () => {
    const result = migrate({ v: 3, kept: true }, CHAIN, 3);
    expect(result).toMatchObject({ ok: true, migrated: false });
    if (result.ok) expect(result.document).toStrictEqual({ v: 3, kept: true });
  });

  it('runs every step in order', () => {
    const result = migrate({ v: 1 }, CHAIN, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.migrated).toBe(true);
    expect(result.document).toStrictEqual({ v: 3, added: 'by 1→2 then 2→3' });
  });

  it('starts from the version the document declares, not from the beginning', () => {
    const result = migrate({ v: 2, added: 'already' }, CHAIN, 3);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document).toStrictEqual({ v: 3, added: 'already then 2→3' });
  });

  // The raw document is the only copy of the player's progress until a good one has been
  // written, so a step that mutated it would make a failed upgrade unrecoverable.
  it('does not touch the document it was given', () => {
    const original: UnknownSave = Object.freeze({ v: 1 });
    const result = migrate(original, CHAIN, 3);
    expect(result.ok).toBe(true);
    expect(original).toStrictEqual({ v: 1 });
  });
});

describe('refusing what it cannot read', () => {
  // The one that matters. Reading the fields we recognise and ignoring the rest is how a
  // v2 save comes back as a v1 save with no medals, and then gets written back that way.
  it('refuses a future version before reading anything', () => {
    const result = migrate({ v: 2, medals: 'in some new shape' }, [], 1);
    expect(result).toStrictEqual({
      ok: false,
      problem: { code: 'futureVersion', found: 2, supported: 1 },
    });
  });

  it('refuses a version it has no step from', () => {
    expect(migrate({ v: 1 }, [migrate_2_3], 3)).toMatchObject({
      ok: false,
      problem: { code: 'unknownVersion' },
    });
  });

  // Too old and too new are symmetric: both are declared versions this build cannot
  // reach, and neither is written over. `0` is not a version this game ever shipped, but
  // saying "no step reaches it" is accurate where "this is not a save" would be a guess.
  it('refuses a version below the chain as unreachable, not as corruption', () => {
    expect(migrate({ v: 0 }, CHAIN, 3)).toMatchObject({
      ok: false,
      problem: { code: 'unknownVersion', found: 0 },
    });
  });

  it('refuses a document with no usable version', () => {
    for (const document of [{}, { v: '1' }, { v: 1.5 }, { v: -1 }]) {
      expect(migrate(document, CHAIN, 3), JSON.stringify(document)).toMatchObject({
        ok: false,
        problem: { code: 'unreadable' },
      });
    }
  });

  it('refuses something that is not an object at all', () => {
    for (const document of [null, 'save', 7, [1, 2, 3]]) {
      expect(migrate(document, CHAIN, 3), JSON.stringify(document)).toMatchObject({
        ok: false,
        problem: { code: 'unreadable' },
      });
    }
  });

  // A step that claims to land where it started would otherwise spin forever.
  it('refuses a stalling step rather than looping', () => {
    const stall: Migration = { from: 1, to: 1, apply: (s) => s };
    expect(migrate({ v: 1 }, [stall], 2)).toMatchObject({
      ok: false,
      problem: { code: 'unknownVersion' },
    });
  });
});
