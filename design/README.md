# ClearBill design package (W2)

UX design for ClearBill, a Chrome web app that explains US medical bills. ClearBill looks for details to remove on the device, and the user checks the result. The built-in sample can use cloud features after consent when region and availability checks allow it. Imported bills and typed questions use on-device features. Explanations and questions on the device require a ready model.

This package is the input for W8 (frontend UI). Frontend imports `copy.json` read-only and builds the screens from the wireframes. Wording changes go through ux-designer, and consent and disclaimer wording also through Rai.

## Contents

| File | What it is |
|---|---|
| [`flows.md`](flows.md) | The end-to-end flow, the device model state diagram, consent states, special states and the error map |
| [`wireframes/`](wireframes/README.md) | 19 low-fidelity SVG wireframes (S01 to S13, with variants), each with a Markdown description of every numbered element |
| [`badges.md`](badges.md) | Badge spec for `ON_DEVICE`, `IN_CLOUD` and `LOCAL_RULES`, plus the audit severity tags, with measured contrast ratios |
| [`copy.json`](copy.json) | Every user-facing string, keyed by screen: all `DeviceModelState` values, all `AIErrorCode` values, consent, "what leaves your computer", disclaimers, PII category labels, screen-reader labels and Under the hood labels |
| [`accessibility.md`](accessibility.md) | Keyboard and focus order on the review screen, screen-reader labels for redaction highlights, reduced motion, and a test checklist |

## Screen map

| Step | Screens |
|---|---|
| 1 Add bill | S01 paste or built-in sample, S01b PDF or photo |
| 2 Set up | S03a downloadable, S03b downloading, S03c unsupported or unavailable, S03d ready |
| 3 Check details | S04 classify and remove details, S02a long bill, S02b not a bill, S05a/S05b review |
| 4 Your choice | S06 consent: what leaves your computer |
| 5 Explanation | S07 |
| 6 Questions | S08 (single-turn) |
| 7 Things to check | S09 audit, S11 kill switch |
| 8 Letter | S10 |
| Any step | S12 error pattern, S13 Under the hood |

## Contracts this package follows

From the lead's Design Review and corrected Contract amendment 1:

- `DeviceModelState`: `unsupported | unavailable | downloadable | downloading | available`. Download only on click; progress may be indeterminate.
- Result sources: `ON_DEVICE | IN_CLOUD | LOCAL_RULES`. Badges are icon plus text, never colour alone, WCAG AA.
- `AIErrorCode`: `DEVICE_MODEL_NOT_READY, INPUT_TOO_LONG, NOT_A_BILL, UNSUPPORTED_INPUT, CONSENT_REQUIRED, CLOUD_NOT_ALLOWED, SCHEMA_PARSE_FAILED, SAFETY_BLOCKED, QUOTA_OR_RATE_LIMIT, APP_CHECK_FAILED, NETWORK, KILL_SWITCH, ABORTED, UNKNOWN`. Each has copy under `errors.<CODE>`.
- Inference modes: `ONLY_ON_DEVICE | PREFER_ON_DEVICE | PREFER_IN_CLOUD | NONE`. A single `createRedactionDraft` call classifies and redacts with the on-device model or local rules. `askQuestion` always uses `ONLY_ON_DEVICE`, including for the sample. See [the consent states](flows.md#3-consent-states) for the other methods.
- PII categories: `PATIENT_NAME, PERSON_NAME, PROVIDER_NAME, FACILITY_NAME, DOB, ADDRESS, PHONE, EMAIL, SSN, MEMBER_ID, ACCOUNT_NUMBER, DIAGNOSIS, OTHER_ID`, with labels under `pii.<CATEGORY>`. Placeholders look like `[PATIENT_NAME_1]`.
- Final regex guard re-adds `SSN, MEMBER_ID, ACCOUNT_NUMBER, PHONE, EMAIL, DOB`; explained in `review.guardTitle` / `review.guardBody` and on every affected row.
- Audit flags are "Likely error" or "Worth asking about", never "error" alone.

## Using `copy.json`

- Keys are nested by screen, for example `review.guardBody` or `errors.NETWORK.title`.
- `{name}` marks a value the app fills in. Never show braces.
- Keys ending `_one` / `_other` are plurals; pick by count.
- The `_meta` block is for people, not the UI.
- Text in the SVG wireframes is a sample. If it differs from `copy.json`, the JSON wins.

## Design principles

1. **Show where it ran, every time.** Every AI result has a source badge. Under the hood shows the full log. The hybrid story is visible without opening anything.
2. **The user is the final check.** Never promise perfect redaction. The review screen is a real step with real controls, not a formality.
3. **Declining is a first-class choice.** "Keep everything on this computer" is a full button. A ready model can explain the bill and answer questions on the device.
4. **No dead ends.** Every state and error has a next action. With no model, simple rules can help remove details from text. The user can review that text and set up the model when available.
5. **Calm, plain words.** Grade 8 reading level. Flags are questions to ask, not accusations.

## Branding

No third-party logos or trademarks. Chrome, Gemini Nano, Gemini and Firebase are named in plain text only. Icons are generic shapes (laptop, cloud, checklist).
