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

/**
 * §8.8's *"visible focus ring, never suppressed"* — #169, NFR-016.
 *
 * The rule is easy to state and easy to break by accident: `outline: none` is the first
 * thing anybody reaches for when a focus ring looks wrong on one control, and it removes
 * the only cue a keyboard user has for where they are. Nothing about the page looks broken
 * afterwards, which is why this is a test and not a review item — ESLint cannot see CSS,
 * so it goes here beside the colour check for the same reason.
 *
 * **Suppression is allowed only with a replacement.** A control that draws its own focus
 * indicator — a `box-shadow` ring, an inset outline — is doing the right thing in a
 * different way, and forbidding it outright would push the next person into `!important`
 * or an inline style, where nothing checks anything. So the test asks the question that
 * actually matters: is there still something to see?
 */
const RULE_BLOCK = /([^{}]+)\{([^{}]*)\}/g;

/**
 * A block's declarations, as `[property, value]`.
 *
 * Declaration by declaration rather than by scanning the whole body with one regex, which
 * is how the first version of this check got it wrong: `outline\\s*:\\s*(?!none)` looks like
 * it rejects `outline: none`, and does not — `\\s*` backtracks to match zero spaces, which
 * puts the lookahead in front of the space rather than in front of `none`, and the negative
 * lookahead then succeeds. Splitting first removes the class of bug rather than the instance.
 */
const declarationsOf = (body: string): [property: string, value: string][] =>
  body
    .split(';')
    .map((declaration) => declaration.split(':'))
    .filter((parts): parts is [string, string] => parts.length === 2)
    .map(([property, value]) => [property.trim().toLowerCase(), value.trim().toLowerCase()]);

/** `outline: none`, `outline: 0`, and the longhands that say the same thing. */
const suppressesRing = (body: string): boolean =>
  declarationsOf(body).some(
    ([property, value]) =>
      ['outline', 'outline-style', 'outline-width'].includes(property) &&
      (value === 'none' || value === '0' || value.startsWith('0 ')),
  );

/** Something a focused element would still show: a ring drawn another way. */
const drawsItsOwnRing = (body: string): boolean =>
  declarationsOf(body).some(
    ([property, value]) =>
      (property === 'box-shadow' && value !== 'none') ||
      (property === 'outline' && value !== 'none' && value !== '0'),
  );

/** The blocks that take the ring away and put nothing back. */
const unreplacedSuppressions = (css: string): string[] =>
  [...css.matchAll(RULE_BLOCK)]
    .filter(([, , body = '']) => suppressesRing(body) && !drawsItsOwnRing(body))
    .map(([, selector = '']) => selector.trim());

describe('the focus ring is never suppressed without a replacement', () => {
  it('has no rule that removes the outline and puts nothing back', () => {
    const offenders = unreplacedSuppressions(stripComments(source));

    expect(
      offenders,
      `${String(offenders.length)} rule(s) suppress the focus ring with no replacement. ` +
        '§8.8: "visible focus ring, never suppressed". Draw one another way (box-shadow, ' +
        'an inset outline) or leave the browser default alone.',
    ).toEqual([]);
  });

  it('would catch a suppression, and allows one that draws its own ring', () => {
    // The check, tested through the same function the scan uses. A matcher that quietly
    // stopped matching would report a clean stylesheet forever, which is the failure this
    // file's neighbours are also written against — and is not hypothetical here: the first
    // version of this check passed everything, for the reason `declarationsOf` records.
    expect(unreplacedSuppressions('.x {\n  outline: none;\n}')).toEqual(['.x']);
    expect(unreplacedSuppressions('.x {\n  outline: 0;\n}')).toEqual(['.x']);
    expect(unreplacedSuppressions('.x {\n  outline-style: none;\n}')).toEqual(['.x']);
    expect(
      unreplacedSuppressions('.x {\n  outline: none;\n  box-shadow: 0 0 0 2px var(--accent);\n}'),
    ).toEqual([]);
    // And an ordinary focus rule is not swept up by it.
    expect(
      unreplacedSuppressions('.x:focus {\n  outline: var(--hh-line) solid var(--accent);\n}'),
    ).toEqual([]);
  });
});

/**
 * §8.8's skip link is *visible on focus* — #169, #141.
 *
 * `keyboard-walkthrough.test.tsx` proves the link exists, is first, and points at the
 * heading a route change focuses. What it cannot see is whether a player can *read* it:
 * the link is parked off-screen and is brought back by `:focus`, and that second rule is
 * the whole feature. Without it the link is reachable and invisible, which is worse than
 * absent — the player tabs onto nothing.
 */
describe('the skip link is off-screen until it is focused', () => {
  it('parks it off-screen and brings it back on focus', () => {
    const css = stripComments(source);
    const blocks = new Map<string, string>();
    for (const [, selector = '', body = ''] of css.matchAll(RULE_BLOCK)) {
      blocks.set(selector.trim(), body);
    }

    const parked = blocks.get('.hh-skip-link') ?? '';
    const focused = blocks.get('.hh-skip-link:focus') ?? '';

    expect(parked, '.hh-skip-link is not in the stylesheet').not.toBe('');
    // Moved out of view rather than hidden: `display: none` would take it out of the tab
    // order too, which is the one thing it must stay in.
    expect(parked).toMatch(/left\s*:\s*-\d/);
    expect(parked).not.toMatch(/display\s*:\s*none/);
    expect(focused, '.hh-skip-link:focus does not bring it back on screen').toMatch(
      /left\s*:\s*\d/,
    );
  });
});

/**
 * Every button gets the game's chrome, not the browser's — #267.
 *
 * There was no bare `button` rule at all: the stylesheet named buttons only inside four
 * containers, and most of those set padding and `font: inherit` without ever clearing the
 * user-agent defaults. Everything else rendered as Chrome's dark-mode button —
 * `rgb(107 107 107)` on a `2px outset white` bevel — including **Accept**, **Commit
 * plan**, and 36 of Settings' 37 controls.
 *
 * The check is on the stylesheet rather than on a rendered page because jsdom has no user
 * agent stylesheet to fall back to: a component test would report the same computed styles
 * whether or not this rule existed, which is exactly why nothing caught it. What can be
 * checked here is that the reset is present and resets the three properties that carry the
 * UA's look — and that it does so at the bare element, so a new button inherits it without
 * its author having to know.
 */
describe('buttons do not fall back to the user agent', () => {
  const bodyOf = (selector: string): string => {
    for (const [, found = '', body = ''] of stripComments(source).matchAll(RULE_BLOCK)) {
      if (found.trim() === selector) return body;
    }
    return '';
  };

  it('resets the user-agent chrome on the bare `button` element', () => {
    const body = bodyOf('button');
    expect(body, 'no bare `button` rule in app.css').not.toBe('');

    const declared = new Map(declarationsOf(body));
    // The three the UA supplies and that a padding-only rule leaves behind.
    for (const property of ['background', 'border', 'color']) {
      expect(declared.get(property), `button does not set ${property}`).toBeDefined();
    }
    // `outset` is the UA's bevel and the tell the browser check used. Nothing may restore
    // it, here or anywhere.
    expect(stripComments(source)).not.toMatch(/border[^;{}]*:\s*[^;{}]*\boutset\b/);
  });

  it('draws its edge from the palette, so all five reach it', () => {
    // Not a colour literal — that is the neighbouring test — but specifically a token, so
    // §8.3.12's palette setting changes buttons along with the panels around them. The
    // default chrome was the same grey in all five, High contrast included.
    expect(bodyOf('button')).toMatch(/var\(--/);
  });
});
