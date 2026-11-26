# ClearBill: Devpost description

## Before pasting (not part of the description)

- [ ] Replace every `[TODO: ...]` below, or delete that line.
- [ ] Hosted URL: `https://clearbill-2c019.web.app` is only the planned address and is not deployed yet. Add it below only after it is deployed and tested.
- [ ] Update the Status paragraph after the final real run (Gemini Nano installed, a live cloud generation seen).
- [ ] Add redaction accuracy figures only if they were measured on the 12 sample bills.
- [ ] Re-check test counts if the tests changed.

---- paste everything below this line ----

Code: [TODO: public GitHub URL] | Demo video: [TODO: public YouTube URL] | Hosted app: [TODO: hosted URL, once deployed]

## Inspiration / Problem

Many people find US medical bills hard to read. Getting help from a cloud chatbot means pasting in a name, birth date, insurance ID and diagnoses. ClearBill explains the bill in plain language and keeps private details on the user's computer.

## What it does

You paste a medical bill into this Chrome web app, or load the built-in made-up sample.

1. Gemini Nano, running inside Chrome, finds personal details and replaces them with labels like `[PATIENT_NAME_1]`.
2. You review what was removed. A final regex pass always removes SSNs, phone numbers and emails, and labelled member IDs, account numbers and birth dates.
3. A consent screen shows the exact text that would leave your computer. "Keep everything on this computer" is a full choice.
4. Each charge is explained in plain words, and questions are answered on the device.
5. For the built-in sample, if you agree, cloud Gemini flags items worth asking about and drafts a letter.

Every result has a source badge. An "Under the hood" panel logs each completed call: step, mode, where it ran, model, time and any fallback.

## How we built it: Firebase AI Logic hybrid inference

Every model call uses Firebase AI Logic (`firebase/ai`, Gemini Developer API backend) in one file, `src/ai/real/generate.ts`: `getAI`, then `getGenerativeModel` with a hybrid `mode`, `onDeviceParams` (Gemini Nano) and `inCloudParams` (cloud model), then `generateContent`. Each step builds its own model, so each has its own mode and JSON schema:

- Remove details: `ONLY_ON_DEVICE`, or simple rules without Nano. Never the cloud.
- Explanation: `PREFER_ON_DEVICE`; the cloud is allowed only when the cloud gate is open, otherwise `ONLY_ON_DEVICE`.
- Questions: always `ONLY_ON_DEVICE`.
- Audit and letter: `PREFER_IN_CLOUD`, only after consent and only for the built-in synthetic sample.

The badge comes from the SDK's reported `inferenceSource`, so it shows where the call really ran. If a `PREFER_IN_CLOUD` call fails with a network or HTTP error and Nano is available, the SDK answers on the device: the badge reads "On this device" and the panel shows a fallback.

Other Firebase products: **App Check** (reCAPTCHA Enterprise), **Anonymous Authentication**, and **Remote Config** for a kill switch (`cloud_features_enabled`), a region gate (`cloud_region_allowed`: false for the EEA, UK and Switzerland, and closed if the fetch fails), the cloud model name and an input limit. Hosting is planned, not deployed.

## Privacy by design

A bill you paste never leaves your computer. Only the built-in synthetic sample can reach the cloud, only after you could view the redaction and the exact outgoing text, and never for redaction itself. Prompts treat bill text and questions as untrusted data. All sample data is invented.

## Challenges

Nano is small, so each step needs a JSON schema, reply validation and a rules fallback. The cloud model sometimes answers "high demand" (HTTP 500): with Nano the SDK falls back to the device; otherwise the app shows a try-again message.

## Accomplishments

- A complete flow, from paste to letter, with a visible source for every step.
- 361 unit tests (Vitest) and 64 Playwright e2e tests at the last full run, using a mock AI that exists only in dev and test builds.
- Live in Chrome: App Check exchange succeeded, Remote Config fetched, and the AI Logic request reached Google authenticated.
- 12 synthetic sample bills with ground truth.

## Status (honest)

As of 2026-11-26 we have not yet seen a successful real generation end to end: Gemini Nano had not yet become available on our development machine, and the cloud model returned HTTP 500 "high demand" when we tested. [TODO: update after the final real run.]

Redaction accuracy on the 12 sample bills: [TODO: add recall figures after the real run, or delete.]

## What's next

PDF and photo import (cut from this version), measured redaction accuracy, and Firebase Hosting.

Limits: simple rules cannot find names or diagnoses; Gemini Nano needs desktop Chrome and a several-gigabyte download. ClearBill is not medical, legal or financial advice.

Built with Firebase AI Logic, Gemini Nano, Gemini, App Check, Remote Config, TypeScript and Vite. License: Apache-2.0.
