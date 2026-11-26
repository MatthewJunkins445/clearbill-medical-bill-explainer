import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // design/copy.json is imported by bare alias so src/ui never uses a relative path out of its folder.
      '@design': path.resolve(import.meta.dirname, 'design'),
    },
  },
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
