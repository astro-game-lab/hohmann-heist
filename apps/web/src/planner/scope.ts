/**
 * Which of §8.5.3's four scopes is showing — for #124's overlay.
 *
 * The overlay lists bindings by scope **with the current screen's first**, so a player in
 * the planner does not read the execution bindings before the ones they can use. That
 * needs an answer to "which screen am I on", and the router cannot give it: §8.2 puts
 * briefing, planner, execution and debrief behind *one* route (`/contract/:id`), because
 * they are one job seen from four positions. `route.name` is `contract` for all four.
 *
 * ## Why this reports upward rather than providing downward
 *
 * `ContractScreen` knows the phase; the overlay is rendered by the shell, which is its
 * **ancestor**. Context flows down, so a value published by the contract screen cannot be
 * read by the shell — the obvious arrangement is the one that cannot work.
 *
 * So the shell provides the *setter* and the contract screen calls it. That keeps the
 * plumbing out of `bodyFor`, which would otherwise grow a third callback threaded through
 * a function whose job is picking a component, and it keeps the dependency pointing the
 * right way: the screen tells the shell what it is, and the shell decides what to do with
 * that.
 *
 * `null` is honest and is the common case outside a contract — the title and settings
 * screens are not any of §8.5.3's scopes, and the overlay then shows its sections in the
 * default order rather than pretending one of them is current.
 */
import { createContext } from 'preact';
import { useContext, useEffect } from 'preact/hooks';

import type { Screen } from './keys.js';

export interface KeyboardScopeApi {
  readonly scope: Screen | null;
  readonly setScope: (scope: Screen | null) => void;
}

const KeyboardScopeContext = createContext<KeyboardScopeApi>({
  scope: null,
  setScope: () => undefined,
});

export const KeyboardScopeProvider = KeyboardScopeContext.Provider;

/** The scope showing, or `null` outside a contract. */
export const useKeyboardScope = (): Screen | null => useContext(KeyboardScopeContext).scope;

/**
 * Report the scope this screen is, for as long as it is mounted.
 *
 * The cleanup sets it back to `null` rather than leaving the last value behind: a player
 * who leaves a contract for the board is on no scope at all, and an overlay that still
 * put the execution bindings first would be answering a question nobody asked.
 */
export const useReportKeyboardScope = (scope: Screen): void => {
  const { setScope } = useContext(KeyboardScopeContext);
  useEffect(() => {
    setScope(scope);
    return () => {
      setScope(null);
    };
  }, [scope, setScope]);
};
