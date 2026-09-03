import { defineConfig } from 'vite';

export default defineConfig({
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
