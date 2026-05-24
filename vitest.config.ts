import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals:     true,
    include:     ['src/__tests__/**/*.stress.test.ts'],
    // Each test file runs in its own worker so module mocks are fully isolated.
    pool:        'forks',
    reporters:   ['verbose'],
  },
});
