# src/firebase

Owner: **devops**

Firebase app setup: client config, App Check (reCAPTCHA Enterprise, plus a debug token in development only), Anonymous Auth and Remote Config. The public entry point is `src/firebase/index.ts`; `src/ui` may import only that file.

Config comes from `import.meta.env` (see `.env.example`). Real values live only in `.env.local` on your machine. See `docs/firebase-setup.md`.
