import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    target: 'es2023',
    sourcemap: true,
  },
  test: {
    // Unit tests are co-located with the code they test (src/**/x.test.ts).
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
