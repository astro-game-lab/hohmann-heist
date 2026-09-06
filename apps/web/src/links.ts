/**
 * Where the game links out to.
 *
 * Three screens now need a URL into the repository — §8.3.1's footer links
 * `docs/PHYSICS.md` from every screen (#118), §8.7's scenario-refusal *"offer to report
 * it"* files an issue (#125), and D12's beaten-par report already did (#121) — and the
 * third of those had the host written into it inline. A fourth copy is how one of them
 * ends up pointing at a repository that has been renamed.
 *
 * Not in the message catalogue, and deliberately: a URL is not prose, there is nothing in
 * it to translate, and FR-910 is about the sentences a player reads. The *link text* is in
 * the catalogue; the address is here.
 */

/** The repository these builds come from. */
export const REPO_URL = 'https://github.com/astro-game-lab/hohmann-heist';

/**
 * `docs/PHYSICS.md` — §8.3.1's *"the physics ↗"*.
 *
 * The document on `main` rather than a permalink to the built commit. The link is an
 * invitation to check the game's claims, and the current statement of them is the useful
 * one; a reader who wants the version this build shipped has the commit in the footer
 * beside it.
 */
export const PHYSICS_URL = `${REPO_URL}/blob/main/docs/PHYSICS.md`;

/** A prefilled new-issue URL. `URLSearchParams` so no field can break the link. */
export const issueHref = (fields: {
  readonly title: string;
  readonly body: string;
  readonly labels?: string;
}): string => {
  const params = new URLSearchParams({
    title: fields.title,
    body: fields.body,
    ...(fields.labels === undefined ? {} : { labels: fields.labels }),
  });
  return `${REPO_URL}/issues/new?${params.toString()}`;
};

/**
 * The release that can read a replay code from a newer schema — §8.7, §11.6.
 *
 * The releases index rather than a computed tag: the schema version in a replay code is
 * not the app's version (§14.4 — `e` is the *engine* major), so this build cannot know
 * which release first read schema *n*. Sending someone to the list they can read is honest;
 * inventing a tag that may not exist is not.
 */
export const RELEASES_URL = `${REPO_URL}/releases`;
