/**
 * Telling §8.7's two replay failures apart — #125.
 *
 * > *Replay code invalid or from a future schema version: explicit message naming the
 * > version mismatch, with a link to the release that can read it.*
 *
 * `parseReplay` refuses both, and correctly — but it refuses them the same way, with a
 * `RangeError`. The two need different words: a malformed code is the *sender's* problem
 * and the answer is to ask for it again, while a code from a newer schema arrived
 * perfectly intact and re-copying it would send the player round a loop with no exit. So
 * this reads the version field first, and only then hands the string to the real parser.
 *
 * ## What it does not do
 *
 * §11.6's wire format is `base64url(deflateRaw(canonicalJson(ReplayV1)))`, and this reads
 * **canonical JSON only** — the outer two layers are M6's, along with the replay viewer
 * itself. That is not a shortcut: it is the format the game actually produces today
 * (`ContractScreen` stores `canonicalJson(replayFromPlan(…))` and the save carries it), so
 * these two states are reachable with a code the game itself wrote. When the codec lands,
 * decoding goes in front of this and the classification below does not change.
 *
 * ## Version before validity
 *
 * Deliberately the first thing checked, and on a minimally-parsed object rather than a
 * fully validated one. A replay from a newer schema may legitimately carry fields this
 * build has never heard of — that is what a newer schema *is* — and `parseReplay` rejects
 * unrecognised keys before it looks at anything else. Checking `v` first means the newer
 * code is diagnosed as newer rather than as malformed, which is the entire distinction
 * this module exists to make.
 */
import { REPLAY_SCHEMA_VERSION, parseReplay, type ReplayV1 } from '@hh/sim';

/** What a replay code turned out to be. */
export type ReplayDiagnosis =
  | { readonly kind: 'ok'; readonly replay: ReplayV1 }
  | { readonly kind: 'invalid' }
  | {
      readonly kind: 'futureVersion';
      readonly found: number;
      readonly supported: number;
    };

/** The schema version a code claims, or `null` when it does not claim one readably. */
const claimedVersion = (code: string): number | null => {
  try {
    const parsed: unknown = JSON.parse(code);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const version = (parsed as Record<string, unknown>)['v'];
    return typeof version === 'number' && Number.isInteger(version) ? version : null;
  } catch {
    // Not JSON at all. `invalid`, and the caller finds that out below.
    return null;
  }
};

/**
 * Classify a replay code.
 *
 * Total: never throws, whatever it is given. §8.7's rule for this shape of thing, and the
 * same one `share.ts` follows — a failure a screen has to render is a value, not an
 * exception.
 */
export const diagnoseReplay = (code: string): ReplayDiagnosis => {
  const version = claimedVersion(code);
  if (version !== null && version > REPLAY_SCHEMA_VERSION) {
    return { kind: 'futureVersion', found: version, supported: REPLAY_SCHEMA_VERSION };
  }

  try {
    return { kind: 'ok', replay: parseReplay(code) };
  } catch {
    return { kind: 'invalid' };
  }
};
