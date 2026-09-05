/**
 * The palette matrix, checked — NFR-018, FR-907.
 *
 * Three claims, in order of how much they would cost to get wrong:
 *
 * 1. The contrast arithmetic agrees with the published standard. Checked against values
 *    computed independently of this code, so a sign error cannot hide behind the palettes
 *    being generous.
 * 2. Every palette fills every role.
 * 3. Every pair the interface draws clears §8.8's threshold, in every palette. This is
 *    the one CI blocks on.
 */
import { describe, expect, it } from 'vitest';

import { composite, mix, parseColour, toHex, withAlpha } from './colour.js';
import { contrastRatio, contrastRatioOf } from './contrast.js';
import { CONTRAST_PAIRS, minimumFor, type ContrastSubject } from './pairs.js';
import { PALETTES, paletteSet, type PaletteSet } from './palettes.js';
import {
  DEFAULT_PALETTE_ID,
  MEDAL_KEYS,
  PALETTE_IDS,
  TOKENS,
  TOKEN_ROLES,
  isPaletteId,
  type Token,
} from './tokens.js';

/**
 * Resolve a pair's subject, which is a token or an entry in the medal ramp.
 *
 * The prefix test narrows the template-literal type, so the two lookups need no cast and
 * a subject naming a medal that does not exist fails to compile.
 */
const valueOf = (set: PaletteSet, subject: ContrastSubject): string => {
  const medal = MEDAL_KEYS.find((key): boolean => subject === `medal.${key}`);
  return medal === undefined ? set.tokens[subject as Token] : set.medals[medal];
};

describe('contrast arithmetic (WCAG 2.2)', () => {
  it('reports 21:1 for black on white, the maximum the formula admits', () => {
    expect(contrastRatioOf('#000000', '#ffffff')).toBeCloseTo(21, 10);
  });

  it('reports 1:1 for a colour on itself', () => {
    expect(contrastRatioOf('#5bc0eb', '#5bc0eb')).toBeCloseTo(1, 12);
  });

  it('is symmetric: the order of the two colours does not change the ratio', () => {
    expect(contrastRatioOf('#767676', '#ffffff')).toBeCloseTo(
      contrastRatioOf('#ffffff', '#767676') ?? 0,
      12,
    );
  });

  // Two greys either side of AA on white, computed from the WCAG 2.2 definition by hand
  // rather than taken from this module: #777777 is the widely quoted 4.48:1 near-miss and
  // #767676 the 4.54:1 pass, which is why they are the pair the standard's own examples
  // use to illustrate the boundary. If the exponent, the 0.055 offset, the 0.05 floor or
  // the luminance weights were wrong, these two would not straddle 4.5 by 0.06.
  it('straddles AA between #777777 and #767676 on white, as the standard does', () => {
    expect(contrastRatioOf('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
    expect(contrastRatioOf('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('reads short hex the way CSS does', () => {
    expect(parseColour('#abc')).toEqual(parseColour('#aabbcc'));
    expect(parseColour('#abcd')).toEqual(parseColour('#aabbccdd'));
  });

  it('refuses a value that is not a hex colour rather than guessing', () => {
    expect(parseColour('rgba(0, 0, 0, 0.5)')).toBeUndefined();
    expect(parseColour('#12345')).toBeUndefined();
    expect(parseColour('red')).toBeUndefined();
    expect(contrastRatioOf('not a colour', '#000000')).toBeUndefined();
  });

  it('composites a translucent colour over its ground before measuring it', () => {
    // 50% white over black is mid-grey, whose luminance is far below 0.5 — the sRGB
    // transfer curve is the whole reason a translucent token cannot be judged by its
    // opaque value.
    const half = parseColour('#ffffff80');
    const black = parseColour('#000000');
    if (half === undefined || black === undefined) throw new Error('unreachable');

    const blended = composite(half, black);
    expect(blended.a).toBe(1);
    expect(blended.r).toBeCloseTo(128 / 255, 6);

    // And the ratio uses the blend, not the source: pure white would be 21:1.
    expect(contrastRatio(half, black)).toBeLessThan(11);
  });
});

describe('colour algebra', () => {
  it('round-trips a colour through parse and format', () => {
    for (const value of ['#05070d', '#ffffff', '#f4705c40', '#000000']) {
      const parsed = parseColour(value);
      if (parsed === undefined) throw new Error(`unparsed: ${value}`);
      expect(toHex(parsed)).toBe(value);
    }
  });

  it('drops the alpha pair when a colour is opaque, so a derived value reads like a token', () => {
    expect(withAlpha('#5bc0eb80', 1)).toBe('#5bc0eb');
    expect(withAlpha('#5bc0eb', 0.5)).toBe('#5bc0eb80');
  });

  it('mixes toward the second colour, and clamps outside the unit interval', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#000000', '#ffffff', -1)).toBe('#000000');
    expect(mix('#000000', '#ffffff', 2)).toBe('#ffffff');
  });

  it('is the same operation as compositing, which is what stops the two drifting', () => {
    // 40% of `bad` over the ground, reached both ways: as a translucent colour painted
    // over it, and as a mix toward it. `./colour.ts` defines the first in terms of the
    // second, and this is what would fail if someone re-wrote either in linear light.
    const ground = parseColour('#05070d');
    const translucent = parseColour('#f4705c66');
    if (ground === undefined || translucent === undefined) throw new Error('unreachable');

    expect(toHex(composite(translucent, ground))).toBe(mix('#05070d', '#f4705c', 102 / 255));
  });

  it('refuses to blend something that is not a colour', () => {
    expect(mix('#000000', 'chartreuse', 0.5)).toBeUndefined();
    expect(withAlpha('nope', 0.5)).toBeUndefined();
  });
});

describe('the palettes fill every role (FR-907, §9.2)', () => {
  it('names thirteen tokens, and a role for each', () => {
    expect(TOKENS).toHaveLength(13);
    expect(Object.keys(TOKEN_ROLES).sort()).toEqual([...TOKENS].sort());
  });

  it.each(PALETTE_IDS)('%s defines every token, and every value is a colour', (id) => {
    const set = paletteSet(id);
    expect(Object.keys(set.tokens).sort()).toEqual([...TOKENS].sort());
    for (const token of TOKENS) {
      expect(parseColour(set.tokens[token]), `${id}/${token} is not a colour`).toBeDefined();
    }
    expect(Object.keys(set.medals).sort()).toEqual([...MEDAL_KEYS].sort());
    for (const medal of MEDAL_KEYS) {
      expect(parseColour(set.medals[medal]), `${id}/medal.${medal} is not a colour`).toBeDefined();
    }
  });

  it('ships the five palettes §8.3.12 offers, and no others', () => {
    expect(Object.keys(PALETTES).sort()).toEqual([...PALETTE_IDS].sort());
    expect(isPaletteId(DEFAULT_PALETTE_ID)).toBe(true);
    expect(isPaletteId('sepia')).toBe(false);
  });
});

describe('contrast across the token matrix (NFR-018, §8.8)', () => {
  it.each(PALETTE_IDS)('%s meets §8.8 for every pair the interface draws', (id) => {
    const set = paletteSet(id);
    const failures: string[] = [];

    for (const pair of CONTRAST_PAIRS) {
      const ratio = contrastRatioOf(valueOf(set, pair.subject), set.tokens[pair.ground]);
      if (ratio === undefined) {
        failures.push(`${pair.subject} on ${pair.ground}: not a colour`);
        continue;
      }
      const minimum = minimumFor(pair.kind);
      if (minimum !== undefined && ratio < minimum) {
        failures.push(
          `${pair.subject} on ${pair.ground} (${pair.kind}) — ` +
            `${ratio.toFixed(2)}:1, needs ${minimum.toFixed(1)}:1 — ${pair.where}`,
        );
      }
    }

    expect(failures, `${id}:\n  ${failures.join('\n  ')}`).toEqual([]);
  });

  // What a fill *is* held to, stated where it is enforced rather than as a threshold in
  // `pairs.ts` that would look like a published standard. Two properties, both true of a
  // region tint: it is visible at all, and something else covers its edge.
  it.each(PALETTE_IDS)('%s draws a visible fill, with its edge covered elsewhere', (id) => {
    const set = paletteSet(id);
    const fills = CONTRAST_PAIRS.filter((pair) => pair.kind === 'fill');
    expect(fills.length).toBeGreaterThan(0);

    for (const pair of fills) {
      const ratio = contrastRatioOf(valueOf(set, pair.subject), set.tokens[pair.ground]);
      expect(ratio, `${id}/${pair.subject} is invisible against ${pair.ground}`).toBeGreaterThan(1);
      expect(
        pair.linedBy ?? '',
        `${pair.subject} is a fill and must say where its edge is checked`,
      ).not.toBe('');
    }
  });

  it('holds every non-fill pair to a published threshold', () => {
    for (const pair of CONTRAST_PAIRS) {
      const minimum = minimumFor(pair.kind);
      if (pair.kind === 'fill') expect(minimum).toBeUndefined();
      else expect(minimum).toBeGreaterThan(1);
    }
  });

  it('measures every pair against a ground that is opaque', () => {
    for (const pair of CONTRAST_PAIRS) {
      for (const id of PALETTE_IDS) {
        expect(parseColour(paletteSet(id).tokens[pair.ground])?.a).toBe(1);
      }
    }
  });
});
