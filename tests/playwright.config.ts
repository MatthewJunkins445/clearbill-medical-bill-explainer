import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the Vite dev server in mock AI mode (VITE_AI_MODE=mock), using the
// locally installed Google Chrome (channel: 'chrome'), so no browser download is needed.
// Run with `npm run test:e2e`, which passes `-c tests/playwright.config.ts`.
// Relative paths here resolve against this file's folder (tests/); output and the web server
// use the repo root.
const repoRoot = path.resolve(import.meta.dirname, '..');

export default defineConfig({
  testDir: 'e2e',
  outputDir: path.join(repoRoot, 'test-results'),
  reporter: [['list'], ['html', { open: 'never', outputFolder: path.join(repoRoot, 'playwright-report') }]],
  use: {
    baseURL: 'http://localhost:4173',
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }],
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort',
    env: { VITE_AI_MODE: 'mock' },
    cwd: repoRoot,
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
  },
});
