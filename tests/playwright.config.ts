import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the production build served by `vite preview`.
// Run with `npm run test:e2e`, which passes `-c tests/playwright.config.ts`.
// Install a browser once with: npx playwright install chromium
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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    cwd: repoRoot,
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
  },
});
