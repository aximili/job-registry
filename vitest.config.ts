import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'server/**/*.test.ts',
      'shared/**/*.test.ts',
      'tests/**/*.test.ts',
      'web/src/**/*.test.ts',
      'extension/src/**/*.test.ts',
    ],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    // Dates must be local to Sydney in tests, so day-boundary bugs show up.
    env: { TZ: 'Australia/Sydney' },
  },
});
