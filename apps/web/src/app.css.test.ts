/**
 * The stylesheet holds no colour of its own — #116, FR-907, NFR-018.
 *
 * Two assertions, and between them they are what makes a sixth palette a thirteen-value
 * change rather than an archaeology exercise.
 *
 * **The `:root` block is a copy, and copies rot.** `applyPalette` publishes the chosen
 * palette at runtime, but a script runs after the first paint, so the default palette is
 * also written into the stylesheet to give the page a ground before any JavaScript has
 * run. That is a duplicate of `@hh/ui`'s data, and the only acceptable duplicate is one
 * something fails on. This is that something — the same arrangement `schema:check` and
 * the golden fixtures have.
 *
 * **Nothing below it may contain a colour.** A single `#5bc0eb` left in a rule is a
 * component that four of the five palettes cannot restyle, and it would be invisible in
 * review: the default palette makes it look correct. ESLint cannot see CSS, so the check
 * is here.
 *
 * ## Why the parser is this crude, and why that is fine
 *
 * It strips comments and then looks for colour syntax inside declarations. It does not
 * understand the cascade, nesting, or `@supports`. It does not need to: the question is
 * "does a colour literal appear anywhere it is not the palette block", and a false
 * positive is a comment someone wrote a hex code in, which is worth being told about
 * anyway. The one thing it must not do is flag `#123` in a comment as a colour, because
 * this file's neighbours are full of issue references — hence stripping comments first,
 * and hence the test that proves the stripping works.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { cssVariablesFor } from './palette.js';

// Read from the workspace root rather than from `import.meta.url`. This file is
// transformed by Vite, which rewrites `import.meta.url` to a served URL rather than a
// `file:` one, so the usual `fileURLToPath` idiom the guardrail suite uses does not
// survive here. Vitest runs with the workspace root as the working directory, which is
// the same anchor `vitest.config.ts` resolves its projects against.
const source = readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'app.css'), 'utf8');

/** Everything outside a block comment, so an issue number in prose is never a colour. */
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Any CSS colour syntax: hex, `rgb`/`rgba`, `hsl`/`hsla`, `color-mix`, `oklch`. */
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|color-mix|oklch|oklab|lab|lch)\(/g;

/** The `:root { … }` block, which is the one place a colour is allowed. */
const rootBlock = (css: string): string => {
  const start = css.indexOf(':root {');
  expect(start, 'app.css has no :root block').toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  expect(end, ':root block is not closed').toBeGreaterThan(start);
  return css.slice(start, end);
};

describe('app.css carries the default palette and nothing else', () => {
  it("declares exactly `cssVariablesFor('default')` in :root", () => {
    const declared = new Map<string, string>();
    for (const line of rootBlock(stripComments(source)).split('\n')) {
      const match = /^\s*(--[a-z-]+):\s*([^;]+);/.exec(line);
      if (match?.[1] !== undefined && match[2] !== undefined) {
        declared.set(match[1], match[2].trim());
      }
    }

    const expected = cssVariablesFor('default');
    for (const [name, value] of Object.entries(expected)) {
      expect(declared.get(name), `${name} in app.css does not match the palette`).toBe(value);
    }

    // And nothing extra that looks like a token: a stray `--accent-2` would be a colour
    // outside the palette wearing a custom property's clothes.
    const palette = [...declared.keys()].filter((name) => !name.startsWith('--hh-'));
    expect(palette.sort()).toEqual(Object.keys(expected).sort());
  });

  it('contains no colour literal outside :root', () => {
    const css = stripComments(source);
    const body = css.slice(css.indexOf('\n}', css.indexOf(':root {')));

    const found = body.match(COLOUR) ?? [];
    expect(
      found,
      `app.css declares ${String(found.length)} colour(s) outside the palette block: ` +
        `${[...new Set(found)].join(', ')}. Use a token — see @hh/ui's palette module.`,
    ).toEqual([]);
  });

  it('strips comments before looking, so an issue reference is not a colour', () => {
    expect(stripComments('/* see #133 */\na { color: red; }')).not.toContain('#133');
    expect(stripComments('a { color: #abc; }')).toContain('#abc');
  });

  it('would catch a colour reintroduced into a rule', () => {
    const css = stripComments('.x {\n  color: #5bc0eb;\n}');
    expect(css.match(COLOUR)).toEqual(['#5bc0eb']);
    expect(stripComments('.x {\n  color: var(--accent);\n}').match(COLOUR)).toBeNull();
  });
});
