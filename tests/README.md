# tests

Owner: **tester**

- `tests/e2e/`: Playwright (`npm run test:e2e`; config in `tests/playwright.config.ts`). Tests run against the Vite dev server in mock AI mode (`VITE_AI_MODE=mock`) in the locally installed Google Chrome (`channel: 'chrome'`), so no browser download is needed.
- Unit tests do not live here. They are co-located as `src/**/*.test.ts`, owned by the folder's owner, and run with `npm test` (Vitest).
