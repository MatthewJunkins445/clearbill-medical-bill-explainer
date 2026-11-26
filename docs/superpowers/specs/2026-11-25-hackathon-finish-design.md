# ClearBill: finishing for #BuildHybridAI 2026

Date: 2026-11-25. Submission due 2026-11-30. Target: submit on 2026-11-29, keep the 30th as buffer.

## Intent and why

ClearBill explains US medical bills in plain language. The hybrid-AI pitch is the point of the entry: the bill is read and redacted on the user's computer with Gemini Nano, the user checks what was removed, and only then may a redacted summary reach cloud Gemini through Firebase AI Logic.

The judges will most likely watch a video, so the product has to work well enough to record one honest, clean run. Everything else is secondary.

## Where things stand (main at 10c9ba8)

Done: UX package (`design/`: flows, 19 wireframes, `copy.json`, accessibility, badges), AI contract (`src/ai/contract.ts`), deterministic mock (`src/ai/mock/`), Firebase runtime (`src/firebase/`), 12 synthetic sample bills, CI.

Not done: the UI (`src/ui/app.ts` is a placeholder), any real inference (`createClearBillAI` returns only the mock and throws in production builds), store, e2e tests, submission materials. Dependencies are not installed and there is no `.env.local`.

## Submission requirements (from the Devpost page, pasted 2026-11-26)

Deadline: **Nov 30, 2026, 5:00 pm EST.** Category: Web (Chrome), so it can also compete for the $3,000 Best Web/Chrome App prize.

Required:
- A working demo app, built with Firebase AI Logic. App Check is required; debug tokens are accepted.
- A public GitHub or GitLab repo with a visible open-source license (Apache-2.0 is already in `LICENSE`; confirm GitHub shows it in the About box). The repo must hold all source, assets and run instructions, and must show Firebase AI Logic **imported and actually called at runtime**. A mock-only build does not satisfy this, so the real AI layer is a requirement, not a stretch goal.
- A demo video of **3 minutes or less**, on YouTube and public, in English, showing the project working on Chrome.
- A text description covering how Firebase AI Logic is used, the features, and the value proposition.

Strongly encouraged: a hosted URL for judges to try. Judges' machines may not have Gemini Nano, so the hosted build has to behave sensibly without it: on-device steps fall back to `LOCAL_RULES`, and the built-in sample's explanation can fall back to cloud (where the region gate allows it).

Judged on: technological implementation (effective use of hybrid inference), design (a complete, coherent product), potential impact, and quality of the idea.

All commits are dated 2026-11-25, so this is a new project and the existing-app summary does not apply.

## Goals

1. A working app that runs the main path end to end on the built-in sample, with real Gemini Nano on-device steps and real cloud Gemini through Firebase AI Logic for the consented steps.
2. Every AI result shows its source badge (`ON_DEVICE`, `IN_CLOUD`, `LOCAL_RULES`) and the "Under the hood" screen shows the log, so the hybrid story is visible without narration.
3. A 2 to 3 minute demo video, a written submission, and a README that lets a judge run or view the project.
4. A live link on Firebase Hosting. The page says a hosted project is highly encouraged, so this moves from nice-to-have to a planned deliverable, but it is not a gate.
5. A demo video of 3 minutes or less. Beats go in the order of the demo path below; the first 3 minutes are all that is judged.

## Non-goals (cut for time)

- PDF and photo import (S01b). Paste and the built-in sample only.
- The kill-switch screen (S11) and rare error states beyond the generic error pattern (S12).
- The `src/store` persistence and Firestore. State lives in the tab.
- Cloud inference for user-imported bills. This stays off, as the contract already says.
- Pixel-perfect polish on every screen. Polish the screens that appear in the video.

## Anti-goals

- A video that shows canned mock output while implying it is real inference. Any mock-backed moment in the video is labelled as such, or re-recorded.
- Sending anything to the cloud before the user has seen the redaction review and consented.
- Claiming perfect redaction. The user stays the final check, per the design principles.

## Constraints

- Five days, one builder. Chrome desktop only.
- Firebase Spark plan. Console setup (`docs/firebase-setup.md`, steps 1 to 8 and 11) must be done by the user. I cannot do it.
- Gemini Nano must be downloaded on the recording machine (Chrome 158.0.8127.37 is installed; model status not yet checked).
- Node 24.11.0 is installed, `engines` asks for >=24.12.0. Upgrade Node, or install with the warning if nothing breaks.
- Import boundaries are enforced by ESLint: `src/ui` may import only `src/ai/index.ts` and `src/firebase/index.ts`; only `src/ai` may import `firebase/ai`.
- UI wording comes from `design/copy.json`, read-only. Changes to wording are noted, not silently made.

## Approaches considered

- **A. Mock-backed UI only.** Fastest and safest, but nothing real runs, which undersells a hybrid-AI entry.
- **B. Real vertical slice (chosen by the user, 2026-11-25).** Build the UI on the mock first, then add a real implementation behind the same contract, so a demo can never be fully blocked by Nano or the network.
- **C. Everything real across all 13 screens.** Too much for five days.

## Design (approach B)

**UI.** Plain TypeScript and DOM, no framework: the repo has no UI dependency and `app.ts` is already vanilla. One small step-state machine drives the screens from `design/flows.md`. The screens in scope: S01 add bill (paste, sample), S03a to S03d model setup, S04 working, S05a/S05b review what was removed, S06 consent, S07 explanation, S08 questions, S09 things to check, S10 letter, S12 error pattern, S13 Under the hood, plus S02a and S02b as simple branches. Styling is hand-written CSS in `public/` or imported from `src/ui`, following `design/badges.md` and `design/accessibility.md` for badges, focus order and reduced motion.

**AI layer.** Add `src/ai/real/` implementing `ClearBillAI`, selected in `createClearBillAI`: mock when `VITE_AI_MODE=mock`, real otherwise. The current production-build throw is removed once the real implementation exists. Build order inside it, most valuable first:
1. `getDeviceStatus`, `subscribeDeviceStatus`, `prepareDeviceModel` from Chrome's Prompt API availability and download-progress events.
2. `createRedactionDraft` on-device with structured output, plus the regex rules from the mock's `redaction.ts` as the `LOCAL_RULES` fallback, and `approveRedaction` with the final regex guard and the local vault.
3. `explainBill` with `PREFER_ON_DEVICE`, and `askQuestion` with `ONLY_ON_DEVICE`.
4. `auditBill` and `draftLetter` with `PREFER_IN_CLOUD`, built-in sample only. If these slip, the video uses the mock for them with a visible label.

Mode, cloud-gate and consent rules follow `design/flows.md` sections 1 to 3. Remote Config keys are those in `docs/firebase-setup.md` step 7. The exact `firebase/ai` hybrid API surface in version 13.4.0 is checked against the installed package, not assumed.

**Demo path (the video).** Open the app, show the model state, load the built-in sample, show it classified and redacted on-device with `ON_DEVICE` badges, show the review screen and the regex guard, show the consent screen and what would leave the computer, agree, show the explanation, ask a question on-device, show the audit flags and a drafted letter with `IN_CLOUD` badges, then open Under the hood to show where each step ran. Also show the "keep everything on this computer" choice.

## Schedule

| Day | Work | Needs from the user |
|---|---|---|
| Nov 25 to 26 | Node/install, tooling check, UI shell, S01, S03, S04, S05 on the mock | Firebase console steps 1 to 8, `.env.local`, Gemini Nano download (step 11) |
| Nov 26 | S06 to S08, S12, S13, badges, mock-mode full path, Playwright smoke test | |
| Nov 27 | Real AI: device status, redaction, explain, questions; verify in Chrome | Recording machine with Nano ready |
| Nov 28 | Real audit and letter, Hosting deploy (add `<project>.web.app` to the reCAPTCHA key), bug fixes | |
| Nov 29 | Record video (3 minutes or less), upload to YouTube as public, write description and README, submit | YouTube upload, Devpost form, confirm repo is public |
| Nov 30 | Buffer. Deadline is 5:00 pm EST | |

## Open and left to the builder

- Exact styling and layout details inside the wireframes.
- Whether Nano's output on a long bill needs chunking beyond what the contract describes. Find out when the real redaction step runs on all 12 sample bills.
- Hosting deploy only if reCAPTCHA domains and App Check are working by Nov 28.

## Decisions I made (not yet agreed)

- No UI framework.
- Real implementation lives in `src/ai/real/` and replaces the production-build guard.
- Cuts listed under Non-goals.
- Work on feature branches in the main checkout, not the per-work-item worktrees. I will not commit or push until you ask.
