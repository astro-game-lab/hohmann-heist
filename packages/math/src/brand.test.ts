import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Metres, MetresPerSec, Seconds } from './brand.js';
import { metres, metresPerSec, radians, seconds, unbrand } from './brand.js';

describe('branded units', () => {
  it('are plain numbers at runtime', () => {
    expect(metres(6378137)).toBe(6378137);
    expect(unbrand(seconds(60))).toBe(60);
  });

  it('keep distinct units distinct to the compiler', () => {
    const distance: Metres = metres(1000);
    const time: Seconds = seconds(10);

    expectTypeOf(distance).not.toEqualTypeOf<Seconds>();
    expectTypeOf(time).not.toEqualTypeOf<Metres>();
    expectTypeOf(metresPerSec(100)).not.toEqualTypeOf<Metres>();
    expectTypeOf(radians(1)).not.toEqualTypeOf<Metres>();
  });

  it('reject a raw number where a branded one is required', () => {
    const takesMetres = (m: Metres): number => m;

    // @ts-expect-error a bare number is not Metres -- this is the whole point
    takesMetres(1000);
    // @ts-expect-error seconds are not metres
    takesMetres(seconds(1000));

    expect(takesMetres(metres(1000))).toBe(1000);
  });

  it('allow arithmetic between branded values, which stays plain', () => {
    // The boundary rule: brands are load-bearing on signatures, not inside formulas.
    const speed: MetresPerSec = metresPerSec(metres(1000) / seconds(10));
    expect(speed).toBe(100);
  });
});
