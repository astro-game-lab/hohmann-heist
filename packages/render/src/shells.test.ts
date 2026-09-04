import { R_EARTH_EQ, R_GEO } from '@hh/astro';
import { describe, expect, it } from 'vitest';

import type { Camera } from './camera.js';
import { EQUATORIAL_BASIS, boundsOfSphere, frameBounds } from './camera.js';
import type { Primitive, Viewport } from './renderer.js';
import type { HazardShell, ShellState } from './shells.js';
import {
  HATCH_SPACING_PX,
  VIOLATED_HATCH_FACTOR,
  hatchTickCount,
  hazardShellPrimitives,
} from './shells.js';
import type { SceneColours } from './style.js';

const VIEWPORT: Viewport = { width: 800, height: 600, devicePixelRatio: 2 };

const COLOURS: SceneColours = {
  earthFill: '#12233f',
  earthCoastline: '#2b4766',
  earthNight: '#00000066',
  hazard: '#a33333',
  hazardViolated: '#ff4444',
  current: '#5bc0eb',
  planned: '#9bb1c9',
  target: '#c9a86b',
  ship: '#eeeeee',
  targetMarker: '#c9a86b',
  node: '#f5a623',
  nodeSelected: '#ffd479',
  annotation: '#8fa3bb',
};

const cameraFor = (radius: number): Camera =>
  frameBounds(boundsOfSphere(radius), VIEWPORT, EQUATORIAL_BASIS);

/** The 100 km altitude floor — the radii, not the meaning, which stays in `@hh/game`. */
const altitudeFloor = (state: ShellState = 'clear'): HazardShell => ({
  id: 'altitude-floor',
  innerRadiusMetres: R_EARTH_EQ,
  outerRadiusMetres: R_EARTH_EQ + 100_000,
  state,
});

/** §6.5's no-fly annulus — a different pair of radii, and nothing else different. */
const noFlyShell = (state: ShellState = 'clear'): HazardShell => ({
  id: 'no-fly',
  innerRadiusMetres: 12_000_000,
  outerRadiusMetres: 14_000_000,
  state,
});

const counts = (primitives: readonly Primitive[]) => ({
  polygons: primitives.filter((p) => p.kind === 'polygon').length,
  polylines: primitives.filter((p) => p.kind === 'polyline').length,
});

describe('one mechanism for every shell', () => {
  it('draws the no-fly annulus with the same structure as the altitude floor', () => {
    // #107: "Arbitrary hazard shells reuse this mechanism rather than a second code path."
    //
    // The two cannot produce *identical* primitive lists — the hatch count follows the
    // on-screen circumference, so a shell at GEO radius has more ticks than one at
    // Earth's surface, and that is the scale-invariant spacing working. What must match
    // is the structure: a band, then hatch, then two boundary circles.
    const camera = cameraFor(R_GEO);

    const structureOf = (shell: HazardShell): string => {
      const primitives = hazardShellPrimitives(camera, shell, COLOURS);
      const [first, ...rest] = primitives;
      const boundaries = rest.filter((p) => p.kind === 'polyline' && p.closed === true);
      const hatch = rest.filter((p) => p.kind === 'polyline' && p.closed !== true);
      return `${first?.kind ?? 'none'}|hatch>0=${String(hatch.length > 0)}|boundaries=${String(boundaries.length)}`;
    };

    expect(structureOf(noFlyShell())).toBe(structureOf(altitudeFloor()));
    expect(structureOf(altitudeFloor())).toBe('polygon|hatch>0=true|boundaries=2');
  });

  it('knows nothing about what 100 km means', () => {
    // DEP-08 lives in `@hh/game/legality` and §7.5 forbids it below the game layer. The
    // structural evidence is that the floor is expressed purely as two radii the caller
    // chose, and swapping them for any other pair changes only the geometry.
    const camera = cameraFor(R_GEO);
    const arbitrary = hazardShellPrimitives(
      camera,
      { id: 'x', innerRadiusMetres: 9e6, outerRadiusMetres: 9.4e6, state: 'clear' },
      COLOURS,
    );
    expect(arbitrary.length).toBeGreaterThan(0);
  });
});

describe('the intersecting state', () => {
  it('changes fill, hatch density and stroke together, not just colour', () => {
    // §8.3.4 principle 5. Red on a dark field is exactly the signal a large number of
    // players cannot read, so the state has to survive greyscale.
    const camera = cameraFor(R_EARTH_EQ + 400_000);
    const clear = hazardShellPrimitives(camera, altitudeFloor('clear'), COLOURS);
    const violated = hazardShellPrimitives(camera, altitudeFloor('violated'), COLOURS);

    const clearBand = clear.find((p) => p.kind === 'polygon');
    const violatedBand = violated.find((p) => p.kind === 'polygon');

    // 1. Fill deepens.
    expect(violatedBand?.kind === 'polygon' ? violatedBand.fill.alpha : 0).toBeGreaterThan(
      clearBand?.kind === 'polygon' ? (clearBand.fill.alpha ?? 1) : 1,
    );

    // 2. Hatch doubles in density — strictly more polylines.
    expect(counts(violated).polylines).toBeGreaterThan(counts(clear).polylines);

    // 3. Stroke thickens.
    const boundaryWidth = (ps: readonly Primitive[]): number => {
      const closed = ps.find((p) => p.kind === 'polyline' && p.closed === true);
      return closed?.kind === 'polyline' ? closed.stroke.width : 0;
    };
    expect(boundaryWidth(violated)).toBeGreaterThan(boundaryWidth(clear));
  });

  it('also changes colour, as redundant reinforcement rather than as the carrier', () => {
    const camera = cameraFor(R_EARTH_EQ + 400_000);
    const clear = hazardShellPrimitives(camera, altitudeFloor('clear'), COLOURS);
    const violated = hazardShellPrimitives(camera, altitudeFloor('violated'), COLOURS);

    const bandColour = (ps: readonly Primitive[]): string | undefined => {
      const band = ps.find((p) => p.kind === 'polygon');
      return band?.kind === 'polygon' ? band.fill.colour : undefined;
    };
    expect(bandColour(clear)).toBe(COLOURS.hazard);
    expect(bandColour(violated)).toBe(COLOURS.hazardViolated);
  });

  it('halves the hatch spacing, which is the thing the factor actually controls', () => {
    // Not "exactly doubles the count": the count is a rounded circumference-over-spacing,
    // and the two roundings are independent, so 179.5 -> 180 against 359.0 -> 359 is a
    // legitimate off-by-one. The invariant that matters is the spacing.
    const outerPx = 400;
    const spacing = (state: ShellState): number =>
      (2 * Math.PI * outerPx) / hatchTickCount(outerPx, state);

    expect(spacing('clear') / spacing('violated')).toBeCloseTo(VIOLATED_HATCH_FACTOR, 1);
    expect(hatchTickCount(outerPx, 'violated')).toBeGreaterThan(hatchTickCount(outerPx, 'clear'));
  });
});

describe('the hatch holds up at every framing', () => {
  it('keeps the same screen-space spacing at LEO and at GEO', () => {
    // §8.4 spans LEO to 17 Earth radii. Spacing the ticks in metres would give a solid
    // smear at one framing and three lonely ticks at the other; spacing them in screen
    // pixels keeps the texture identical.
    const leo = cameraFor(R_EARTH_EQ + 400_000);
    const geo = cameraFor(R_GEO);

    const spacingAt = (camera: Camera, shell: HazardShell): number => {
      const outerPx = shell.outerRadiusMetres * camera.scale;
      return (2 * Math.PI * outerPx) / hatchTickCount(outerPx, shell.state);
    };

    // Both land within a tick of the target spacing, because the count is rounded.
    expect(spacingAt(leo, altitudeFloor())).toBeCloseTo(HATCH_SPACING_PX, 0);
    expect(spacingAt(geo, noFlyShell())).toBeCloseTo(HATCH_SPACING_PX, 0);
  });

  it('clamps the tick count so an enormous shell cannot eat the frame budget', () => {
    // A shell zoomed to a 40x LEO framing has a circumference of tens of thousands of
    // pixels, and the ticks stop being resolvable long before they stop being drawn.
    expect(hatchTickCount(1e9, 'clear')).toBeLessThanOrEqual(360);
    expect(hatchTickCount(1e9, 'violated')).toBeLessThanOrEqual(360);
  });

  it('keeps a minimum so a tiny shell is still visibly hatched', () => {
    expect(hatchTickCount(1, 'clear')).toBeGreaterThanOrEqual(12);
    expect(hatchTickCount(0, 'clear')).toBeGreaterThanOrEqual(12);
  });
});

describe('the band', () => {
  it('is a ring: outer circle out, inner circle back', () => {
    const camera = cameraFor(R_EARTH_EQ + 400_000);
    const band = hazardShellPrimitives(camera, altitudeFloor(), COLOURS).find(
      (p) => p.kind === 'polygon',
    );
    expect(band?.kind).toBe('polygon');

    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const radii = (band?.kind === 'polygon' ? band.points : []).map((p) =>
      Math.hypot(p.x - centre.x, p.y - centre.y),
    );
    const outer = R_EARTH_EQ + 100_000;
    // Every vertex sits on one of the two circles and nowhere between them.
    for (const r of radii) {
      const onInner = Math.abs(r - R_EARTH_EQ * camera.scale) < 1e-6;
      const onOuter = Math.abs(r - outer * camera.scale) < 1e-6;
      expect(onInner || onOuter).toBe(true);
    }
    // The first half traces the outer circle, the second the inner.
    expect(radii[0]).toBeCloseTo(outer * camera.scale, 6);
    expect(radii[radii.length - 1]).toBeCloseTo(R_EARTH_EQ * camera.scale, 6);
  });
});

describe('degenerate shells', () => {
  it('draws nothing rather than throwing, so a bad scenario cannot crash a drag', () => {
    const camera = cameraFor(R_EARTH_EQ);
    const bad = (inner: number, outer: number): Primitive[] =>
      hazardShellPrimitives(
        camera,
        { id: 'bad', innerRadiusMetres: inner, outerRadiusMetres: outer, state: 'clear' },
        COLOURS,
      );

    expect(bad(1e6, 1e6)).toEqual([]);
    expect(bad(2e6, 1e6)).toEqual([]);
    expect(bad(-1, 1e6)).toEqual([]);
    expect(bad(Number.NaN, 1e6)).toEqual([]);
    expect(bad(1e6, Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it('drops the inner boundary for a shell collapsed onto the origin', () => {
    const camera = cameraFor(R_EARTH_EQ);
    const disc = hazardShellPrimitives(
      camera,
      { id: 'origin', innerRadiusMetres: 0, outerRadiusMetres: 1e6, state: 'clear' },
      COLOURS,
    );
    const closed = disc.filter((p) => p.kind === 'polyline' && p.closed === true);
    expect(closed).toHaveLength(1);
  });
});
