import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig, type Plugin } from 'vite';

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
