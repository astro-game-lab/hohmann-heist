/**
 * What build this is — §14.4.
 *
 * > *App follows semver on the deployed site; the version is visible on the title screen
 * > and in the debrief, and is embedded in every replay code.*
 *
 * Two of those three are this module's business. The third is not: the replay code's `e`
 * field is the **engine** major (§11.6, §14.4), which is a different number with a
 * different meaning — it moves only when a physics result changes — and `@hh/sim` already
 * carries it. The app version has no slot in `ReplayV1` and does not need one.
 *
 * The title screen is #118 and does not exist yet, so the debrief is the one surface that
 * shows this today. It is a module rather than two literals at the call site because a
 * second surface is coming and because the test runner needs the fallback below.
 *
 * ## Why there are two values
 *
 * `VERSION` answers *what was released*. `COMMIT` answers *what is running*, and between
 * releases that is the question actually being asked — most sharply by
 * `docs/PLAYTEST-M2.md`, whose protocol says a session run against a stale deployment
 * measures the deployment, and which pins its build by reading the entry script's content
 * hash out of the deployed HTML and copying it into a table by hand. A build that states
 * its own SHA turns that into looking at the screen.
 *
 * ## Why they are injected rather than read
 *
 * `package.json` is not readable from a browser and `git` is not runnable in one. Both
 * values are substituted at build time by `vite.config.ts`'s `define`, so they are string
 * literals in the bundle and cost nothing at runtime.
 *
 * The `typeof` guards are for the test runner, which does not apply the app's `define`.
 * Without them every test that renders the debrief would throw on an undeclared global —
 * a failure with nothing to do with what the test was checking.
 */

declare const __HH_VERSION__: string;
declare const __HH_COMMIT__: string;

/**
 * The app's semver, from the root `package.json`.
 *
 * `'0.0.0'` until the first release. That is not a placeholder to be tidied away — it is
 * what an unreleased build honestly is, and it is why {@link COMMIT} exists: a version
 * that has not moved since the repository was created cannot identify a build, and the
 * SHA can.
 */
export const VERSION: string = typeof __HH_VERSION__ === 'string' ? __HH_VERSION__ : '0.0.0';

/** The short commit SHA, or `'unknown'` where there was no repository to ask. */
export const COMMIT: string = typeof __HH_COMMIT__ === 'string' ? __HH_COMMIT__ : 'unknown';

/**
 * The build as one string: `0.0.0 (ae569e9)`.
 *
 * Deliberately not routed through the message catalogue. Every other string on screen is
 * (FR-910, and a lint rule refuses literal text in JSX), but this one is an identifier
 * rather than prose: there is nothing here to translate, and a locale that reordered or
 * localised the digits would break the one thing it is for, which is being read back
 * verbatim into a bug report or a playtest sheet.
 */
export const BUILD_ID = `${VERSION} (${COMMIT})`;
