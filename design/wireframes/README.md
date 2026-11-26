# Wireframes

Low-fidelity, greyscale wireframes for every ClearBill screen and state. Each screen has an SVG and a Markdown file that describes every numbered callout. Layout is drawn at 1200px wide; the build should reflow to one column below 900px.

Conventions used in every frame:

- Header: ClearBill name, the 'Under the hood' toggle, 'Start over'. Below it, the eight-step progress bar (current step bold, finished steps ticked).
- Footer: the privacy line and the short disclaimer, on every screen.
- Badges: laptop = On this device, cloud with arrow = In the cloud, checklist with dashed border = Simple rules, dots with dotted border = Working. See [`../badges.md`](../badges.md).
- Redactions: filled chip = removed, filled chip with thick border = always removed, dashed underline = kept by you.
- Black numbered circles are annotations, not UI.

| Screen | Title | Purpose |
|---|---|---|
| [S01](s01.md) | Add bill: paste text | Start the flow. Explain the privacy promise in three short points before asking for anything. |
| [S01b](s01b.md) | Add bill: PDF or photo chosen | Show a chosen file and the on-device reading step for PDFs (pdf.js) and photos (JPEG/PNG). |
| [S02a](s02a.md) | Long-bill notice | Stop gently when the text is over the device model's limit. Tell the user to paste one page at a time. |
| [S02b](s02b.md) | Not a medical bill | Tell the user the text doesn't look like a medical bill or EOB, without blocking them. |
| [S03a](s03a.md) | Set up: model downloadable | Explain the on-device model and let the user start the download. The download starts only on click. |
| [S03b](s03b.md) | Set up: model downloading | Show download progress, determinate or indeterminate, and let the user go on with simple rules meanwhile. |
| [S03c](s03c.md) | Set up: unsupported or unavailable | Explain that the on-device model can't run, without blame, and offer simple rules. |
| [S03d](s03d.md) | Set up: model ready | Confirm the download finished. The user moves on when ready; nothing advances by itself. |
| [S04](s04.md) | Removing details | Short wait while redaction runs locally. Reassure that nothing has been sent. |
| [S05a](s05a.md) | Check what we removed (on-device) | The core trust screen. Show every redaction in context, let the user keep or remove each, add missed ones, and explain the always-removed guard. |
| [S05b](s05b.md) | Check what we removed (rules-only fallback) | Same as S05a, but simple rules did the pass. Push the user to look for names, places and diagnoses. |
| [S06](s06.md) | What leaves your computer (consent) | Get informed, specific, reversible consent before any redacted text can reach the cloud. |
| [S07](s07.md) | Your bill, explained | Explain each line in plain words, show where each answer was made, and lead to questions and the audit. |
| [S08](s08.md) | Ask about your bill (single-turn) | Answer one question at a time against the redacted bill. Make it obvious each answer stands alone. |
| [S09](s09.md) | Things worth checking (audit) | Show audit flags as questions to ask, not accusations. Let the user pick which go in the letter. |
| [S10](s10.md) | Your letter | Give an editable, polite draft letter and put the user's real details back in on the device. |
| [S11](s11.md) | Kill switch: cloud features paused | When Remote Config turns cloud features off, keep the on-device product working and say plainly what is paused. |
| [S12](s12.md) | Error pattern (all AIErrorCodes) | One inline error pattern for every AIErrorCode. Shows examples; the full copy is in copy.json under errors. |
| [S13](s13.md) | Under the hood panel | Show judges and curious users exactly where each step ran: device model state, consent, and a per-call log with mode, source, model and latency. |
