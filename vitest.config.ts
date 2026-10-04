import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@hachi/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@hachi/store': fileURLToPath(new URL('./packages/store/src/index.ts', import.meta.url)),
      '@hachi/cloud': fileURLToPath(new URL('./packages/cloud/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts', 'services/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'services/*/src/**/*.ts'],
      // Entry points and the Firestore adapter are covered by emulator/E2E tests instead.
      exclude: ['services/*/src/server.ts', 'packages/store/src/firestore.ts'],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
