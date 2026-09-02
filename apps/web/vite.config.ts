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
  },
  // No Preact plugin. esbuild picks up `jsx` and `jsxImportSource` from the
  // tsconfig, which is all this needs; the preset exists for HMR refresh and
  // react-to-preact aliasing, neither of which applies here, and it would pull in
  // Babel for no benefit.
});
