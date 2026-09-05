/**
 * §6.6's assist model, checked — FR-301, FR-411, §6.7, §11.6.
 *
 * The tests that matter here are the ones about **direction**. Two of §6.6's four medal
 * effects fire when the assist is switched *off*, and an implementation that treated
 * "affects medals" as one thing would pass any test that only ever turned assists on.
 */
import { describe, expect, it } from 'vitest';

import {
  ASSISTS,
  ASSIST_IDS,
  blindModifier,
  cappingAssists,
  cleanEligible,
  decodeAssists,
  defaultAssistState,
  encodeAssists,
  medalCap,
  restrictToAllowed,
  type AssistId,
  type AssistState,
} from './assists.js';

/** A state with everything at its §6.6 default, then the named overrides applied. */
const withAssists = (overrides: Partial<Record<AssistId, boolean>> = {}): AssistState =>
  Object.freeze({ ...defaultAssistState(), ...overrides });

describe('the set matches §6.6', () => {
  it('has the seven toggleable assists, and not trajectory prediction', () => {
    // §6.6 lists eight rows; prediction is "on, cannot be disabled" because it is the
    // medium (§6.3), so offering it as a toggle would be offering a control that must not
    // exist. The scenario schema leaves it out for the same reason.
    expect(ASSIST_IDS).toHaveLength(7);
    expect(ASSIST_IDS).not.toContain('prediction');
  });

  it('gives every assist a default and an effect, from the table', () => {
    const table: Readonly<Record<AssistId, readonly [boolean, string]>> = {
      elements: [true, 'none'],
      closest_approach: [true, 'blindWhenDisabled'],
      snapping: [true, 'none'],
      constraints: [true, 'blindWhenDisabled'],
      targeting_computer: [false, 'capsWhenEnabled'],
      porkchop: [false, 'capsWhenEnabled'],
      coach_marks: [true, 'none'],
    };

    for (const id of ASSIST_IDS) {
      const [defaultEnabled, effect] = table[id];
      expect(ASSISTS[id].defaultEnabled, `${id} default`).toBe(defaultEnabled);
      expect(ASSISTS[id].effect, `${id} effect`).toBe(effect);
    }
  });

  it('lists every assist it describes', () => {
    // The one drift the type system does not catch: an id present in `ASSISTS` but left
    // out of `ASSIST_IDS` compiles, and would silently vanish from every iteration —
    // the §11.6 bitmask included, which would change what a replay means.
    expect([...ASSIST_IDS].sort()).toEqual(Object.keys(ASSISTS).sort());
  });

  it('starts every assist at its default', () => {
    const state = defaultAssistState();
    for (const id of ASSIST_IDS) expect(state[id]).toBe(ASSISTS[id].defaultEnabled);
  });
});

describe('the effects are not symmetric', () => {
  it('earns Blind by turning an assist OFF, not by leaving it on', () => {
    expect(blindModifier(defaultAssistState())).toBe(false);
    expect(blindModifier(withAssists({ closest_approach: false }))).toBe(true);
    expect(blindModifier(withAssists({ constraints: false }))).toBe(true);
  });

  it('does not earn Blind for turning off an assist that reveals nothing', () => {
    // Snapping and element readouts are free in both directions (§6.6's "None").
    expect(blindModifier(withAssists({ snapping: false }))).toBe(false);
    expect(blindModifier(withAssists({ elements: false }))).toBe(false);
    expect(blindModifier(withAssists({ coach_marks: false }))).toBe(false);
  });

  it('caps by turning an assist ON, not by leaving it off', () => {
    expect(medalCap(defaultAssistState())).toBe('clean');
    expect(medalCap(withAssists({ targeting_computer: true }))).toBe('silver');
    expect(medalCap(withAssists({ porkchop: true }))).toBe('silver');
  });

  it('names which assist capped the run', () => {
    expect(cappingAssists(defaultAssistState())).toEqual([]);
    expect(cappingAssists(withAssists({ porkchop: true }))).toEqual(['porkchop']);
    expect(cappingAssists(withAssists({ targeting_computer: true, porkchop: true }))).toEqual([
      'targeting_computer',
      'porkchop',
    ]);
  });

  it('lifts the cap for a contract designed around the tool', () => {
    // §6.6: "unless the contract is designed around it (Act V)".
    const state = withAssists({ targeting_computer: true });
    expect(medalCap(state)).toBe('silver');
    expect(medalCap(state, ['targeting_computer'])).toBe('clean');
    expect(cappingAssists(state, ['targeting_computer'])).toEqual([]);
  });

  it('lifts it only for the tool the contract names', () => {
    const state = withAssists({ targeting_computer: true, porkchop: true });
    expect(medalCap(state, ['targeting_computer'])).toBe('silver');
    expect(cappingAssists(state, ['targeting_computer'])).toEqual(['porkchop']);
  });
});

describe('Clean Job is Gold with no medal-affecting assists ENABLED (§6.7)', () => {
  // The reading this implements, as a named test: changing it should be a deliberate act.
  //
  // "Medal-affecting when enabled" is true of exactly the two capping assists. The other
  // two affect a medal by being switched *off*, and being off is not "enabled". The
  // alternative reading — no assists at all — would make the default configuration
  // ineligible for the game's top award, which makes Blind mandatory rather than optional
  // and contradicts §6.6's "each at their own level".
  it('is eligible with every default assist on', () => {
    expect(cleanEligible(defaultAssistState())).toBe(true);
  });

  it('is lost by enabling a capping assist, and only by that', () => {
    expect(cleanEligible(withAssists({ targeting_computer: true }))).toBe(false);
    expect(cleanEligible(withAssists({ porkchop: true }))).toBe(false);
    expect(cleanEligible(withAssists({ closest_approach: false }))).toBe(true);
    expect(cleanEligible(withAssists({ constraints: false, snapping: false }))).toBe(true);
  });

  it('agrees with the cap, since both answer the same question', () => {
    for (const id of ASSIST_IDS) {
      const state = withAssists({ [id]: !ASSISTS[id].defaultEnabled });
      expect(cleanEligible(state)).toBe(medalCap(state) === 'clean');
    }
  });
});

describe('a contract permits what it permits', () => {
  it('forces off anything the scenario does not list', () => {
    // How the targeting computer stays unavailable before C13 without the model knowing
    // what a contract number is.
    const state = restrictToAllowed(withAssists({ targeting_computer: true }), [
      'elements',
      'snapping',
    ]);

    expect(state.targeting_computer).toBe(false);
    expect(state.elements).toBe(true);
    expect(state.snapping).toBe(true);
    // Permitted but switched off stays off.
    expect(state.closest_approach).toBe(false);
  });

  it('offers nothing when a scenario lists nothing', () => {
    const state = restrictToAllowed(defaultAssistState(), undefined);
    for (const id of ASSIST_IDS) expect(state[id]).toBe(false);
  });
});

describe("§11.6's bitmask", () => {
  it('round-trips every subset', () => {
    // 2^7 = 128 states, so this is exhaustive rather than sampled.
    for (let mask = 0; mask < 1 << ASSIST_IDS.length; mask++) {
      const state = decodeAssists(mask);
      expect(state, `mask ${String(mask)}`).toBeDefined();
      if (state !== undefined) expect(encodeAssists(state)).toBe(mask);
    }
  });

  it('assigns each assist a fixed bit, in the declared order', () => {
    // The order is frozen: a replay records which assists a run used and the server
    // re-evaluates against it (§11.11), so reordering would re-interpret every replay
    // ever recorded. Asserted against the literal list rather than against itself.
    expect(ASSIST_IDS).toEqual([
      'elements',
      'closest_approach',
      'snapping',
      'constraints',
      'targeting_computer',
      'porkchop',
      'coach_marks',
    ]);

    for (const [bit, id] of ASSIST_IDS.entries()) {
      const only = Object.fromEntries(ASSIST_IDS.map((each) => [each, each === id])) as AssistState;
      expect(encodeAssists(only), id).toBe(1 << bit);
    }
  });

  it('refuses a mask carrying bits this build does not know', () => {
    // A replay from a build with more assists. Scoring it as though those assists were
    // absent would produce a confident wrong medal, so it is refused (§8.7).
    expect(decodeAssists(1 << ASSIST_IDS.length)).toBeUndefined();
    expect(decodeAssists(-1)).toBeUndefined();
    expect(decodeAssists(1.5)).toBeUndefined();
  });

  it('encodes the default set to something stable', () => {
    // elements, closest_approach, snapping, constraints, coach_marks — bits 0,1,2,3,6.
    expect(encodeAssists(defaultAssistState())).toBe(0b1001111);
  });
});
