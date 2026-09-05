/**
 * §6.6's assists, and what they cost — FR-301, FR-411, §6.7, §11.6.
 *
 * > *There is no difficulty setting. There is a set of assists, each individually
 * > toggleable, each of which affects medal eligibility.* — §6.6
 *
 * That sentence is the whole design, and it only works if the trade is legible at the
 * moment of choosing. This module is the model behind it: which assists exist, what each
 * one does to a medal, and what the best achievable medal is for a given set. FR-411 makes
 * the tray display that; `outcome.ts` applies it.
 *
 * ## The effects are not symmetric, and that is the thing to get right
 *
 * §6.6's table has three kinds of medal effect, and a reader skimming it will see two:
 *
 * - **None.** Element readouts, node snapping, coach marks. On by default, free.
 * - **Earns *Blind* when *disabled*.** Closest-approach markers, constraint preview.
 *   These are on by default and turning them **off** is what changes anything — it earns
 *   a modifier, which is a distinction rather than a penalty.
 * - **Caps the contract at Silver when *enabled*.** The targeting computer and the
 *   porkchop plot.
 *
 * An interface that showed a uniform "affects medals" badge would be wrong about half of
 * them, and a boolean "assists used" flag would be wrong about all of them. So the effect
 * is a named kind and the direction is part of it.
 *
 * ## Trajectory prediction is not here
 *
 * §6.6 lists it as *"On, cannot be disabled"* with no medal effect, because it is the
 * medium rather than an assist — §6.3 makes prediction the game. The scenario schema's
 * `Assist` union leaves it out for the same reason, and this module matches that union
 * exactly, checked by the compiler below. Putting it in a set of toggles would be offering
 * a control that must not exist.
 *
 * ## Clean Job, and the reading this implements
 *
 * §6.7: *"**Clean Job** — Gold with no medal-affecting assists enabled."*
 *
 * Read against §6.6's table, "medal-affecting **when enabled**" is true of exactly two
 * assists — the targeting computer and the porkchop. The other two affect a medal by being
 * **switched off**, and being off is not "enabled". So a player using every default assist
 * is Clean Job eligible, and a player who turns the markers off earns *Blind* on top.
 *
 * The alternative reading — that Clean Job means "no assists at all" — makes the default
 * configuration ineligible for the game's top award, which would make *Blind* mandatory
 * rather than optional and contradict §6.6's "each at their own level". This module takes
 * the literal reading; `assists.test.ts` states it as a named test so that changing it is a
 * deliberate act rather than a drifting one.
 */
import type { Assist } from './scenario/types.generated.js';

/**
 * The assists a player can toggle.
 *
 * Deliberately the scenario schema's own union — one list, so a contract cannot permit an
 * assist the model does not know about, and the compiler checks the two agree below.
 */
export type AssistId = Assist;

/** Every assist, in a fixed order. The order is §11.6's bitmask and is frozen — see below. */
export const ASSIST_IDS = [
  'elements',
  'closest_approach',
  'snapping',
  'constraints',
  'targeting_computer',
  'porkchop',
  'coach_marks',
] as const satisfies readonly AssistId[];

// Two of the three ways this list and the schema can drift are compile errors already:
// `satisfies readonly AssistId[]` above rejects an id the schema does not have, and
// {@link ASSISTS} is a mapped type over the schema union, so an id the schema gains and
// this file does not is a missing property.
//
// The third — an id present in `ASSISTS` but *omitted from this list* — type-checks fine
// and would silently drop an assist from every iteration, the bitmask included.
// `assists.test.ts` covers it, because expressing it in the type system costs a
// compile-time assertion with no runtime meaning and this is one assertion in a test.

/**
 * What an assist does to a medal.
 *
 * The direction is part of the kind, because two of §6.6's four effects fire when the
 * assist is *off*. See the module docstring.
 */
export type AssistEffect =
  /** Free. Element readouts, node snapping, coach marks. */
  | 'none'
  /** Turning it **off** earns the *Blind* modifier. Closest approach, constraint preview. */
  | 'blindWhenDisabled'
  /** Turning it **on** caps the contract at Silver. The targeting computer, the porkchop. */
  | 'capsWhenEnabled';

export interface AssistSpec {
  readonly id: AssistId;
  /** §6.6's "Default" column. */
  readonly defaultEnabled: boolean;
  readonly effect: AssistEffect;
}

/** §6.6's table, as data. */
export const ASSISTS: Readonly<Record<AssistId, AssistSpec>> = Object.freeze({
  elements: { id: 'elements', defaultEnabled: true, effect: 'none' },
  closest_approach: {
    id: 'closest_approach',
    defaultEnabled: true,
    effect: 'blindWhenDisabled',
  },
  snapping: { id: 'snapping', defaultEnabled: true, effect: 'none' },
  constraints: { id: 'constraints', defaultEnabled: true, effect: 'blindWhenDisabled' },
  targeting_computer: {
    id: 'targeting_computer',
    defaultEnabled: false,
    effect: 'capsWhenEnabled',
  },
  porkchop: { id: 'porkchop', defaultEnabled: false, effect: 'capsWhenEnabled' },
  // §6.6 defaults these on for C01–C04 only. Which contracts show them is FR-902's rule
  // and the scenario's `coachMarks` list; the default here is the setting's, and a
  // contract that declares no marks shows none whatever this says.
  coach_marks: { id: 'coach_marks', defaultEnabled: true, effect: 'none' },
});

/** Which assists are on. Every assist, so there is no "unset" to interpret. */
export type AssistState = Readonly<Record<AssistId, boolean>>;

/** §6.6's defaults. */
export const defaultAssistState = (): AssistState =>
  Object.freeze(
    Object.fromEntries(ASSIST_IDS.map((id) => [id, ASSISTS[id].defaultEnabled])),
  ) as AssistState;

/**
 * The set with only the assists a contract offers, others forced off.
 *
 * `assistsAllowed` is a **permission**, not a default: an assist the contract does not
 * list cannot be enabled at all, which is how the targeting computer stays unavailable
 * before C13 without the model needing to know what a contract number is. A scenario that
 * lists nothing offers nothing.
 */
export const restrictToAllowed = (
  state: AssistState,
  allowed: readonly AssistId[] | undefined,
): AssistState => {
  const permitted = new Set(allowed ?? []);
  return Object.freeze(
    Object.fromEntries(ASSIST_IDS.map((id) => [id, permitted.has(id) && state[id]])),
  ) as AssistState;
};

/**
 * The best medal a set of assists can reach. `clean` means nothing is capped.
 *
 * The same names §6.7's ladder uses, so a cap and a medal are comparable without a
 * translation step — `outcome.ts` compares them directly.
 */
export type MedalCap = 'bronze' | 'silver' | 'gold' | 'clean';

/**
 * What using this set caps the run at.
 *
 * `designedAround` is the contract's exemption. §6.6 caps the targeting computer and the
 * porkchop at Silver *"unless the contract is designed around it (Act V)"* — so the cap is
 * a property of the pairing, not of the assist.
 *
 * **It is a separate argument from `assistsAllowed` on purpose**, and this is the one
 * place the model departs from what #81 originally asked for. Those two lists look like
 * one list until you write down what each has to do: availability answers *may the player
 * switch this on*, and the exemption answers *does switching it on cost anything*. Folding
 * them together makes the cap unreachable — an assist a contract does not permit cannot be
 * enabled, so it could never cap anything, and §6.6's rule would be dead text.
 *
 * Nothing supplies a non-empty `designedAround` yet: the targeting computer is M5 and Act V
 * is where the exemption first has a consumer. The parameter exists so that the rule is
 * implemented and tested now rather than being invented alongside the feature that needs
 * it, and so that the scenario field feeding it is a decision Act V makes deliberately.
 */
export const medalCap = (
  state: AssistState,
  designedAround: readonly AssistId[] = [],
): MedalCap => {
  const exempt = new Set(designedAround);
  const capped = ASSIST_IDS.some(
    (id) => state[id] && ASSISTS[id].effect === 'capsWhenEnabled' && !exempt.has(id),
  );
  return capped ? 'silver' : 'clean';
};

/** Which assist, if any, is responsible for the cap — so the tray and debrief can name it. */
export const cappingAssists = (
  state: AssistState,
  designedAround: readonly AssistId[] = [],
): readonly AssistId[] => {
  const exempt = new Set(designedAround);
  return ASSIST_IDS.filter(
    (id) => state[id] && ASSISTS[id].effect === 'capsWhenEnabled' && !exempt.has(id),
  );
};

/**
 * §6.7's Clean Job eligibility: Gold with no medal-affecting assists **enabled**.
 *
 * See the module docstring on why that is the two capping assists and not all four.
 */
export const cleanEligible = (state: AssistState): boolean =>
  !ASSIST_IDS.some((id) => state[id] && ASSISTS[id].effect === 'capsWhenEnabled');

/**
 * §6.6's *Blind* modifier: earned by turning off an assist that reveals something.
 *
 * A modifier rather than a medal — it sits beside the result rather than in the ladder,
 * and nothing gates on it. It is here because the tray has to be able to say "disabling
 * this earns Blind" (FR-411), and because a leaderboard that segregates Clean from
 * Assisted (§6.7) will want it.
 */
export const blindModifier = (state: AssistState): boolean =>
  ASSIST_IDS.some((id) => !state[id] && ASSISTS[id].effect === 'blindWhenDisabled');

/**
 * §11.6's `a` field: the assist set as a bitmask.
 *
 * **The bit order is {@link ASSIST_IDS} and it is frozen.** A replay code records which
 * assists a run used, and the server re-evaluates against it (§11.11) — so reordering this
 * list would silently re-interpret every replay ever recorded. Adding an assist appends a
 * bit; it never inserts one.
 */
export const encodeAssists = (state: AssistState): number =>
  ASSIST_IDS.reduce((mask, id, bit) => (state[id] ? mask | (1 << bit) : mask), 0);

/**
 * The inverse. `undefined` for a mask with bits this build does not know.
 *
 * Refused rather than masked off, because an unknown bit means the replay was recorded by
 * a build with more assists than this one — and scoring it as though those assists were
 * absent would produce a confident wrong medal. §8.7 gives that case a message.
 */
export const decodeAssists = (mask: number): AssistState | undefined => {
  if (!Number.isInteger(mask) || mask < 0) return undefined;
  if (mask >= 1 << ASSIST_IDS.length) return undefined;
  return Object.freeze(
    Object.fromEntries(ASSIST_IDS.map((id, bit) => [id, (mask & (1 << bit)) !== 0])),
  ) as AssistState;
};
