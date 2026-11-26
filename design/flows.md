# ClearBill flows

This file describes the end-to-end flow, the device model states, and how special states and errors branch off the main path. Screen IDs (S01 and so on) match the files in [`wireframes/`](wireframes/README.md). String keys refer to [`copy.json`](copy.json).

## 1. The main path

```mermaid
flowchart TD
    S01["S01 Add bill<br/>paste / PDF (pdf.js) / photo JPEG-PNG"] --> CHK{"Bill-type check<br/>ON_DEVICE or heuristic"}
    CHK -- "too long" --> S02L["S02 Long-bill notice<br/>paste one page at a time"]
    CHK -- "not a bill" --> S02N["S02 Not a bill"]
    CHK -- "bad file" --> S02U["S02 Unsupported input"]
    S02L --> S01
    S02N -- "use a different bill" --> S01
    S02N -- "continue anyway" --> S03
    CHK -- "looks like a bill" --> S03{"S03 Device model check"}
    S03 -- "available" --> S04["S04 Removing details<br/>ONLY_ON_DEVICE"]
    S03 -- "downloadable: user clicks Download" --> DL["S03 Downloading"] --> S04
    S03 -- "unsupported / unavailable / user picks simple rules" --> S04R["S04 Removing details<br/>LOCAL_RULES"]
    S04 --> S05["S05 Check what we removed<br/>add / remove redactions"]
    S04R --> S05R["S05 Check what we removed<br/>rules-only banner"]
    S05 --> GUARD["Final regex guard<br/>re-adds SSN, MEMBER_ID, ACCOUNT_NUMBER,<br/>PHONE, EMAIL, DOB"]
    S05R --> GUARD
    GUARD --> S06["S06 What leaves your computer<br/>consent"]
    S06 -- "agree" --> S07["S07 Explanation<br/>PREFER_ON_DEVICE"]
    S06 -- "keep everything here" --> S07D["S07 Explanation<br/>device only, audit and letter off"]
    S07 --> S08["S08 Questions<br/>single-turn, PREFER_ON_DEVICE"]
    S07D --> S08
    S07 --> S09["S09 Things worth checking<br/>PREFER_IN_CLOUD"]
    S08 --> S09
    S09 --> S10["S10 Letter<br/>PREFER_IN_CLOUD, fill-in on device"]
```

Notes on the path:

1. **The guard runs on Continue from S05**, not later. S06 shows the text after the guard, so what the user agrees to is exactly what can be sent.
2. **Consent comes before the explanation**, as agreed in the Design Review. The explanation prefers the device, but `PREFER_ON_DEVICE` can fall back to the cloud. Asking first means no fallback ever sends text the user hasn't approved. If the user declines, the app calls the explanation and questions with `ONLY_ON_DEVICE` instead (see open question F1).
3. **Explanation, Questions, Audit and Letter are a tabbed results area** after S06. The step bar lets the user move between them freely. They are not a forced sequence after consent.
4. **Questions are single-turn.** Each question is sent with the redacted bill as context and no earlier questions. The UI says so (`questions.intro`, `questions.standsAlone`) and shows past answers as separate cards, not as a chat thread.
5. **Start over** is always available in the header. It clears everything in the tab after a confirm dialog.

### Which step uses which mode

| Step | Inference mode | Badge sources possible | Needs consent |
|---|---|---|---|
| Bill-type check | `ONLY_ON_DEVICE`, heuristic fallback | `ON_DEVICE`, `LOCAL_RULES` | No |
| Remove details | `ONLY_ON_DEVICE`, regex fallback | `ON_DEVICE`, `LOCAL_RULES` | No |
| Final guard | regex | `LOCAL_RULES` | No |
| Explain lines | `PREFER_ON_DEVICE` (or `ONLY_ON_DEVICE` if declined) | `ON_DEVICE`, `IN_CLOUD` | Only if it could reach the cloud |
| Questions | `PREFER_ON_DEVICE` (or `ONLY_ON_DEVICE` if declined) | `ON_DEVICE`, `IN_CLOUD` | Only if it could reach the cloud |
| Audit | `PREFER_IN_CLOUD` | `IN_CLOUD`, `ON_DEVICE` | Yes |
| Letter | `PREFER_IN_CLOUD` | `IN_CLOUD`, `ON_DEVICE` | Yes |
| Fill in my details (letter) | local find-and-replace | `LOCAL_RULES` | No |

## 2. Device model states

`DeviceModelState` is `'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available'`. The download starts only when the user clicks **Download model**. Progress may be indeterminate.

```mermaid
stateDiagram-v2
    [*] --> checking
    checking --> unsupported: browser or hardware can't run it
    checking --> unavailable: Chrome reports not available now
    checking --> downloadable: model not on disk
    checking --> downloading: download already running (e.g. other tab)
    checking --> available: model ready

    downloadable --> downloading: user clicks "Download model"
    downloading --> available: download complete
    downloading --> unavailable: download fails or disk fills
    unavailable --> checking: user clicks "Check again"

    downloadable --> rulesOnly: user picks "Use simple rules instead"
    downloading --> rulesOnly: user picks "Use simple rules while I wait"
    unsupported --> rulesOnly: user picks "Use simple rules"
    unavailable --> rulesOnly: user picks "Use simple rules"

    rulesOnly --> checking: user clicks "Set up the on-device model"
    available --> [*]
    rulesOnly --> [*]
```

`checking` and `rulesOnly` are UI states, not `DeviceModelState` values. `checking` shows `deviceModel.checking` for at most a moment. `rulesOnly` means "the user chose to go on without the model".

| State | What the user sees (S03) | Primary action | Secondary action | Under the hood value |
|---|---|---|---|---|
| `unsupported` | `deviceModel.states.unsupported` | Use simple rules | What does my computer need? (expands the requirements) | Not supported |
| `unavailable` | `deviceModel.states.unavailable` | Use simple rules | Check again | Not available |
| `downloadable` | `deviceModel.states.downloadable` | Download model | Use simple rules instead | Not downloaded |
| `downloading` | `deviceModel.states.downloading`, progress bar (determinate) or moving stripe (indeterminate; static with reduced motion) | none, the download runs | Use simple rules while I wait | Downloading |
| `available` | `deviceModel.states.available` | Continue (shown only after a download the user started; nothing moves on by itself) | none | Ready |

Returning users with the model already downloaded never see S03: the app goes from S01 straight to S04 and records the state in Under the hood.

If the model finishes downloading while the user is in rules-only mode, a polite banner says `deviceModel.downloadDone` and offers **Run again with the on-device model** on S05 (see open question F2).

## 3. Consent states

```mermaid
stateDiagram-v2
    [*] --> notAsked
    notAsked --> agreed: "Agree and continue" (checkbox ticked)
    notAsked --> declined: "Keep everything on this computer"
    agreed --> withdrawn: "Stop sending to the cloud"
    declined --> agreed: "Change my choice" then agree
    withdrawn --> agreed: "Change my choice" then agree
```

- Consent is per bill, per tab (`consent.scope`). Start over resets it to `notAsked`.
- Any cloud-bound call while the state is not `agreed` returns `CONSENT_REQUIRED`, and the UI shows `errors.CONSENT_REQUIRED` with a link back to S06.
- Editing redactions after agreeing (going back to S05) resets consent to `notAsked`, because the text has changed.

## 4. Special states

| State | Trigger | Where it shows | Wireframe |
|---|---|---|---|
| Rules-only fallback | Model `unsupported` or `unavailable`, or the user chose simple rules | Banner on S04 and S05, `LOCAL_RULES` badge on the redaction pass, extra nudge to look for names and diagnoses | S05b |
| Not a bill | Bill-type check says not medical | Full step screen after S01 | S02b |
| Long bill | `INPUT_TOO_LONG`, or the text is over the device model's limit | Full step screen after S01 | S02a |
| Kill switch | Remote Config turns cloud features off | Banner on all result screens, audit and letter cards replaced by a paused notice, consent screen shows only the on-device choice | S11 |
| Offline | `navigator.onLine` is false, or a `NETWORK` error | Banner; cloud actions disabled with a reason | S12 (pattern) |

## 5. Errors

Every `AIErrorCode` has a title, body and at least one action in `copy.json` under `errors.<CODE>`. They use one pattern (S12): an inline alert in the card where the error happened, never a modal, never a dead end. Focus moves to the alert's heading.

| Code | Typical step | Recovery |
|---|---|---|
| `DEVICE_MODEL_NOT_READY` | Remove details, explain | Go to setup (S03) or use simple rules |
| `INPUT_TOO_LONG` | Bill-type check, remove details | Edit the text (back to S01 with the text kept) |
| `NOT_A_BILL` | Bill-type check | Different bill, or continue anyway |
| `UNSUPPORTED_INPUT` | Import | Choose another file |
| `CONSENT_REQUIRED` | Explain (fallback), questions, audit, letter | Review my choice (S06) |
| `SCHEMA_PARSE_FAILED` | Any model step | Try again |
| `SAFETY_BLOCKED` | Questions mostly | Edit my question |
| `QUOTA_OR_RATE_LIMIT` | Cloud steps | Try again after a wait; on-device still works |
| `APP_CHECK_FAILED` | Cloud steps | Reload page |
| `NETWORK` | Cloud steps | Try again |
| `KILL_SWITCH` | Audit, letter | OK; switches the screen to the kill-switch state |
| `ABORTED` | Any step the user stopped | Start it again |
| `UNKNOWN` | Any | Try again, or start over |
