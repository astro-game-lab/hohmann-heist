import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'tools/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Gated packages only. `render` and `ui` join once they hold code and have a
      // browser-environment testing story — see docs/PRODUCT.md NFR-022.
      include: ['packages/{math,astro,propagation,sim,game}/src/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: {
        // NFR-022: >=90% statements in the core packages.
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
        // NFR-022: >=70% in the game layer.
        'packages/game/src/**': {
          statements: 70,
          branches: 60,
          functions: 70,
          lines: 70,
        },
      },
    },
  },
});
