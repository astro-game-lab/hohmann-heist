/**
 * Message construction — FR-910.
 *
 * There is not much to test here, and that is the point: a `GameMessage` is a key and a
 * frozen bag of values, and the interesting guarantees are structural. What a test can
 * still say is that nothing in this package assembles a sentence, and that the
 * parameters cannot be edited on the way to the UI.
 */
import { describe, expect, it } from 'vitest';

import { NO_PARAMS, gameMessage } from './messages.js';

describe('gameMessage', () => {
  it('pairs a key with its parameters', () => {
    const message = gameMessage('legality.l1.overBudget', {
      usedMps: 274,
      budgetMps: 250,
      excessMps: 24,
    });
    expect(message.key).toBe('legality.l1.overBudget');
    expect(message.params.excessMps).toBe(24);
  });

  it('freezes the message, so a UI layer cannot edit a rule', () => {
    const message = gameMessage('legality.l5.nodesTooClose', {
      firstIndex: 0,
      secondIndex: 1,
      gapSeconds: 0.5,
      minimumSeconds: 1,
    });
    expect(Object.isFrozen(message)).toBe(true);
  });

  it('has a shared empty parameter bag for the messages that take none', () => {
    expect(gameMessage('legality.l6.objectiveNotMet', NO_PARAMS).params).toStrictEqual({});
  });

  // The one thing that would quietly break FR-910 is a parameter that is already a
  // rendered sentence. Values are numbers, identifiers, or lists of identifiers.
  it('carries values rather than fragments of prose', () => {
    const message = gameMessage('scenario.error.notAllowed', {
      path: '/objective/kind',
      allowed: ['reach_orbit', 'intercept'],
    });
    expect(message.params.allowed).toStrictEqual(['reach_orbit', 'intercept']);
    for (const value of message.params.allowed) {
      expect(value).not.toMatch(/\s/);
    }
  });
});
