## What this changes

<!-- One or two sentences. Link the work item (for example W3). -->

## Owner and folders touched

<!-- Which Squad role owns this change, and which folders it touches (see .github/CODEOWNERS). -->

## How it was verified

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] Other (describe):

## Privacy checklist

All boxes must be checked before review.

- [ ] **No secrets.** No API keys, Firebase config values, reCAPTCHA keys, App Check debug tokens, `.env.local` contents or credentials are in the diff, the commit messages or screenshots.
- [ ] **Synthetic data only.** Every bill, fixture, screenshot and log in this PR is synthetic. No real patient, provider, insurer or account data.
- [ ] **The raw bill never goes to the cloud.** Nothing in this change sends raw bill text, images or PDFs to a cloud model, Firestore, Remote Config, analytics or logs. Only de-identified, on-device-redacted content may leave the device.
- [ ] Any new network call is listed below with what it sends.

<!-- New network calls (endpoint and payload summary), or "none": -->
