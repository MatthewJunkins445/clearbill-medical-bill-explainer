# src/ai

Owner: **ai**

Hybrid inference with Firebase AI Logic: on-device Gemini Nano first, cloud Gemini only for de-identified content. This is the only folder allowed to import `firebase/ai` (enforced by ESLint).

The public entry point is `src/ai/index.ts`; `src/ui` may import only that file. The contract (`contract.ts`) and the mock are written by ai in W5a.
