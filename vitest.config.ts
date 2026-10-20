import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/domain/**/*.test.ts', 'tests/ingestion/**/*.test.ts', 'tests/build/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
  },
});
