/**
 * Copying the replay code — §8.3.9's SHARE, FR-305.
 *
 * One function, and it exists as its own module for one reason: **`navigator.clipboard`
 * is typed as always present and is not.** It is `undefined` over plain HTTP, inside
 * some embedded web views, and behind a permissions policy that denies it. The DOM
 * typings do not say so, so a component reaching for it directly either crashes on a
 * real browser or carries a cast that has to be re-argued at every call site.
 *
 * The write can also *reject* on a browser that has it — most commonly because the
 * document does not have focus at the moment of the call. That is not an error worth
 * throwing either: the code is on screen and can be selected by hand, which is what the
 * failure message tells the player to do.
 *
 * So both failures come back as a value. §8.7's rule for this shape of thing.
 */

/** Whether the copy landed. Never an exception — see the docstring. */
export type ShareResult = 'copied' | 'failed';

/** The part of the platform this module needs, named so a test can supply it. */
export interface ClipboardHost {
  readonly clipboard?: { writeText(text: string): Promise<void> } | undefined;
}

/**
 * Copy `text`, reporting whether it worked.
 *
 * The host is a parameter with `navigator` as its default, following `motion.ts`: a
 * structural interface naming exactly the one member used means a test drives both
 * branches with a plain object, rather than depending on what jsdom happens to provide.
 */
export const copyReplay = async (
  text: string,
  host: ClipboardHost = navigator,
): Promise<ShareResult> => {
  const { clipboard } = host;
  if (clipboard === undefined) return 'failed';
  try {
    await clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
};
