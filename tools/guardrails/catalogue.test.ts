/**
 * The message catalogue cannot rot in either direction — #88, FR-910.
 *
 * ## What the compiler already guarantees, and what it cannot
 *
 * `Messages` in `@hh/ui` is a mapped type over every key `@hh/game` declares plus every
 * key the UI declares, so a message missing from the catalogue does not compile and a
 * message for a key that does not exist does not compile either. That is the
 * missing-key half of #88's criterion, and it is stronger than a test.
 *
 * The half a type cannot state is **unused**: a key can be declared, given a message,
 * and produced by nothing. Nothing about that fails to compile, and it is the ordinary
 * end state of a key whose call site was deleted. Finding it needs a scan of the
 * source, which needs a filesystem, which is why this is under `tools/` rather than
 * beside the catalogue.
 *
 * ## What counts as a use
 *
 * Any occurrence of the key outside the three files that *declare* it — `messages.ts`,
 * the UI's `types.ts`, and the message set itself. Deliberately a textual search rather
 * than anything cleverer: the keys are string literals in the source, a regex finds
 * them exactly, and a call-graph analysis would be a large amount of machinery to
 * answer a question that has a small honest answer.
 *
 * The cost of the simple approach is that a key mentioned only in a comment reads as
 * used. That is an acceptable false negative — it still means someone wrote the key
 * down on purpose — where the false *positive* would not be: a gate that reported a
 * live key as dead would be turned off.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCatalogue } from '@hh/ui';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where a key may be used. */
const SEARCH_ROOTS = ['packages/game/src', 'packages/ui/src', 'apps/web/src'];

/**
 * The files that merely *declare* keys.
 *
 * A key that appears only here is declared and unused, which is exactly what this is
 * looking for — so they are excluded from the search rather than counted as uses.
 */
const DECLARATION_FILES = [
  'packages/game/src/messages.ts',
  'packages/ui/src/catalogue/types.ts',
  'packages/ui/src/catalogue/en.ts',
];

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

const walk = (directory: string): string[] => {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    if (!SOURCE_EXTENSIONS.has(extname(entry.name))) return [];
    return [path];
  });
};

interface SourceFile {
  readonly path: string;
  readonly text: string;
}

const sources: readonly SourceFile[] = SEARCH_ROOTS.flatMap((root) => walk(join(REPO_ROOT, root)))
  .map((path) => ({
    path: relative(REPO_ROOT, path).replaceAll('\\', '/'),
    text: readFileSync(path, 'utf8'),
  }))
  .filter(
    (file) =>
      !file.path.includes('.test.') &&
      !file.path.includes('.generated.') &&
      !file.path.endsWith('test-support.ts') &&
      !DECLARATION_FILES.includes(file.path),
  );

const catalogue = createCatalogue();

describe('the search itself', () => {
  // If the walk found nothing, every assertion below is vacuous.
  it('reads the source it means to read', () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.map((file) => file.path)).toContain('apps/web/src/app.tsx');
    expect(sources.map((file) => file.path)).toContain('packages/game/src/legality.ts');
    expect(sources.map((file) => file.path)).not.toContain('packages/game/src/messages.ts');
  });
});

describe('no key rots', () => {
  it('has a producer or a consumer for every key in the catalogue', () => {
    const unused = catalogue.keys.filter(
      (key) => !sources.some((file) => file.text.includes(`'${key}'`)),
    );
    expect(unused).toEqual([]);
  });

  // The reverse direction is a compile error in `@hh/ui`, and asserting it here as well
  // catches the one case a mapped type cannot see: a key assembled at runtime.
  it('has a catalogue entry for every key the source names', () => {
    const named = new Set<string>();
    const pattern = /gameMessage\(\s*'([^']+)'/g;
    for (const file of sources) {
      for (const match of file.text.matchAll(pattern)) {
        const key = match[1];
        if (key !== undefined) named.add(key);
      }
    }

    expect(named.size).toBeGreaterThan(20);
    expect([...named].filter((key) => !catalogue.has(key))).toEqual([]);
  });
});
