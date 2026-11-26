# tests

Owner: **tester**

- `tests/e2e/`: Playwright (`npm run test:e2e`; config in `tests/playwright.config.ts`). Install a browser once with `npx playwright install chromium`.
- Unit tests do not live here. They are co-located as `src/**/*.test.ts`, owned by the folder's owner, and run with `npm test` (Vitest).
