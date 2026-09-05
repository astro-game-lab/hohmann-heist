import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vite';

/**
 * What build this is — §14.4's *"the version is visible … in the debrief"*.
 *
 * Two values, because they answer two different questions and only one of them is a
 * version. `HH_VERSION` is the semver the release process sets; it identifies what was
 * *released*. `HH_COMMIT` is the short SHA; it identifies what is *running*, which is
 * the question that actually gets asked between releases — and which `docs/PLAYTEST-M2.md`
 * currently answers by hand, by reading the entry script's content hash out of the
 * deployed HTML and writing it into a table.
 *
 * Read from the root `package.json` rather than this app's, because the repository is
 * the app: the tag, the changelog heading and the deployed site all carry one number,
 * and having two that could disagree is how they eventually do.
 */
const rootPackage = (): { readonly version: string } =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
  ) as {
    version: string;
  };

/**
 * The short commit SHA, or `'unknown'`.
 *
 * Never throws: a build from a tarball, a shallow checkout without git, or a
 * `node_modules`-only environment has no repository to ask, and a version banner is not
 * worth failing a build over. `'unknown'` is the honest answer and is visibly not a SHA,
 * which is better than a stale one baked in from somewhere else.
 */
const commitSha = (): string => {
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'unknown';
  }
};

/**
 * Publish the scenario JSON Schema alongside the site.
 *
 * §11.5 gives the schema a `$schema` URL —
 * `https://astro-game-lab.github.io/hohmann-heist/schema/scenario-1.json` — and a URL
 * that 404s is worse than no URL: an editor that fetches it silently stops validating.
 * §11.13 says tagged releases publish it. There is no release workflow yet, so it is
 * emitted on **every** build instead, which is a superset of that requirement and makes
 * the link work from the first deploy rather than from the first tag.
 *
 * `emitFile` rather than `publicDir`, because the schema's home is
 * `packages/game/src/scenario/` — beside the loader it defines, which is what keeps it
 * a source file rather than a copy — and `publicDir` can only serve a directory this
 * app owns.
 */
const publishScenarioSchema = (): Plugin => ({
  name: 'hh-publish-scenario-schema',
  generateBundle() {
    const source = fileURLToPath(
      new URL('../../packages/game/src/scenario/scenario-1.schema.json', import.meta.url),
    );
    this.emitFile({
      type: 'asset',
      fileName: 'schema/scenario-1.json',
      source: readFileSync(source, 'utf8'),
    });
  },
});

export default defineConfig({
  plugins: [publishScenarioSchema()],
  // Build-time constants, not runtime lookups: the app must not read `package.json` or
  // shell out to git in a browser. `version.ts` declares them and gives them a fallback
  // for the test runner, which does not go through this config's `define`.
  define: {
    __HH_VERSION__: JSON.stringify(rootPackage().version),
    __HH_COMMIT__: JSON.stringify(commitSha()),
  },
  // GitHub Pages serves this repository under a subpath. Getting this wrong is the
  // classic "works locally, blank page once deployed" failure, so it is set now
  // rather than when the deploy workflow lands.
  base: '/hohmann-heist/',
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
    // The bundle-size gate (NFR-020) measures the initial load: the entry chunk
    // plus everything it statically imports. Only the manifest says which files
    // those are -- a glob over dist/assets would silently start counting
    // lazy-loaded chunks as initial the day the first one appears.
    manifest: true,
  },
  // Cross-origin isolation, for `vite preview` only.
  //
  // Without it Chromium coarsens `performance.now()` to 100 us as a Spectre
  // mitigation, which is the same order as a whole frame's work here -- the first
  // spike run (#238) came back with every per-stage median sitting on 0.0 or 0.1 ms,
  // measuring the timer rather than the code. These two headers restore the 5 us
  // resolution. They apply to the preview server only: the built output carries no
  // headers of its own, and GitHub Pages sets none, so nothing about the deployed
  // site changes.
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  // No Preact plugin. esbuild picks up `jsx` and `jsxImportSource` from the
  // tsconfig, which is all this needs; the preset exists for HMR refresh and
  // react-to-preact aliasing, neither of which applies here, and it would pull in
  // Babel for no benefit.
});
