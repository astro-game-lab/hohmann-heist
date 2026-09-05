/**
 * The join between the two consumers — #116, FR-907, NFR-018.
 *
 * `@hh/ui`'s `palette.test.ts` checks the token matrix. This checks the two things only
 * `apps/web` can know: that the stylesheet and the canvas are reading the *same* palette,
 * and that the inks derived for the scene — the ones with no token of their own — still
 * meet §8.8 where they are lines.
 */
import { describe, expect, it } from 'vitest';
import {
  GRAPHIC_CONTRAST_MIN,
  PALETTE_IDS,
  TOKENS,
  contrastRatioOf,
  paletteSet,
  type PaletteId,
} from '@hh/ui';

import {
  applyPalette,
  cssVariableFor,
  cssVariablesFor,
  paletteFromHash,
  sceneColoursFor,
} from './palette.js';

/** The derived inks, and what each has to be legible against. */
const sceneChecks = (id: PaletteId): readonly [string, string, string, string][] => {
  const scene = sceneColoursFor(id);
  const { tokens } = paletteSet(id);
  return [
    // Earth's limb has to be visible from both sides at once, which is what makes the
    // coastline lift a real constraint rather than a free parameter.
    ['coastline against the disc', scene.earthCoastline, scene.earthFill, 'earth.ts stroke'],
    ['coastline against space', scene.earthCoastline, tokens.bg, 'earth.ts stroke'],
    // The shell's boundary circles are drawn opaque (`shells.ts`), and they are what makes
    // a hazard shell visible at rest. The hatch inside it is texture at the renderer's own
    // alpha and is deliberately not the thing measured here.
    ['hazard boundary at rest', scene.hazard, tokens.bg, 'shells.ts boundary'],
    ['hazard boundary when violated', scene.hazardViolated, tokens.bg, 'shells.ts boundary'],
    ['ship marker', scene.ship, tokens.bg, 'markers.ts'],
    ['node marker', scene.node, tokens.bg, 'nodes.ts'],
    ['selected node ring', scene.nodeSelected, tokens.bg, 'nodes.ts'],
    ['apsis and tie-line annotation', scene.annotation, tokens.bg, 'apsis.ts'],
  ];
};

describe('the stylesheet and the canvas read one palette', () => {
  it.each(PALETTE_IDS)('%s publishes every token as a custom property', (id) => {
    const variables = cssVariablesFor(id);
    for (const token of TOKENS) {
      expect(variables[cssVariableFor(token)]).toBe(paletteSet(id).tokens[token]);
    }
  });

  it.each(PALETTE_IDS)('%s gives the canvas the same values it gives CSS', (id) => {
    const variables = cssVariablesFor(id);
    const scene = sceneColoursFor(id);

    // Every scene ink that *is* a token, checked against the property CSS would resolve.
    // The derived ones are absent by construction: they have no token to be equal to,
    // which is what the contrast block below covers instead.
    expect(scene.background).toBe(variables['--bg']);
    expect(scene.current).toBe(variables['--accent']);
    expect(scene.planned).toBe(variables['--plan']);
    expect(scene.target).toBe(variables['--target']);
    expect(scene.targetMarker).toBe(variables['--target']);
    expect(scene.node).toBe(variables['--plan']);
    expect(scene.nodeSelected).toBe(variables['--accent']);
    expect(scene.ship).toBe(variables['--fg']);
    expect(scene.annotation).toBe(variables['--fg-dim']);
    expect(scene.earthFill).toBe(variables['--earth']);
    expect(scene.hazardViolated).toBe(variables['--bad']);
  });

  it('strips the hazard token alpha for the canvas and keeps it for CSS', () => {
    // The renderer applies its own alpha to the fill and the hatch and draws the boundary
    // opaque; the timeline band uses the token as the wash §9.2 defines. Multiplying the
    // two would fade the shell, so the asymmetry is asserted rather than left to comment.
    for (const id of PALETTE_IDS) {
      const token = paletteSet(id).tokens.hazard;
      expect(token).toMatch(/^#[0-9a-f]{8}$/);
      expect(sceneColoursFor(id).hazard).toBe(token.slice(0, 7));
      expect(cssVariablesFor(id)['--hazard']).toBe(token);
    }
  });

  it('sets the properties on the element and records which palette is showing', () => {
    const root = document.createElement('div');
    applyPalette(root, 'high-contrast');

    expect(root.dataset['palette']).toBe('high-contrast');
    expect(root.style.getPropertyValue('--bg')).toBe(paletteSet('high-contrast').tokens.bg);
    expect(root.style.getPropertyValue('--medal-gold')).toBe(
      paletteSet('high-contrast').medals.gold,
    );

    // Switching is a re-publish onto the same element, not a second element or a class
    // swap — which is what makes it take effect without a reload.
    applyPalette(root, 'default');
    expect(root.dataset['palette']).toBe('default');
    expect(root.style.getPropertyValue('--bg')).toBe(paletteSet('default').tokens.bg);
  });
});

describe('derived scene inks meet §8.8 where they are lines (NFR-018)', () => {
  it.each(PALETTE_IDS)('%s', (id) => {
    const failures = sceneChecks(id)
      .map(([what, ink, ground, where]) => {
        const ratio = contrastRatioOf(ink, ground) ?? 0;
        return ratio < GRAPHIC_CONTRAST_MIN
          ? `${what} — ${ratio.toFixed(2)}:1, needs ${String(GRAPHIC_CONTRAST_MIN)}:1 (${where})`
          : '';
      })
      .filter((line) => line !== '');

    expect(failures, `${id}:\n  ${failures.join('\n  ')}`).toEqual([]);
  });
});

describe('the temporary palette source (#122, #186 replace it)', () => {
  it('reads a palette from the hash query, and ignores anything else', () => {
    expect(paletteFromHash('#/board?palette=deuteranopia')).toBe('deuteranopia');
    expect(paletteFromHash('#/board?palette=high-contrast')).toBe('high-contrast');
    expect(paletteFromHash('#/board')).toBe('default');
    expect(paletteFromHash('#/board?palette=sepia')).toBe('default');
    expect(paletteFromHash('#/board?other=1')).toBe('default');
    expect(paletteFromHash('')).toBe('default');
  });
});
