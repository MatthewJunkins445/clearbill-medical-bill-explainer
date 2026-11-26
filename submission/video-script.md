# ClearBill demo video script

Target length 2:45 (the table ends at 2:45). Hard limit 3:00: Devpost judges only the first 3 minutes. English. Must show the project working in Chrome. Narration is about 272 words, no row above 140 words per minute, which leaves slack for a slower real run.

## Honesty rules (read before recording)

- Record in real mode, not mock. If any moment is shown on the mock or a simulated state (for example a forced kill switch or error), label it on screen ("Simulated" or "Mock AI") for the whole moment, or re-record it.
- Do not edit a result to look faster or better than it was.
- **Narrate the badge that is actually on screen.** The script below assumes the audit and letter show "In the cloud". With `PREFER_IN_CLOUD`, if the cloud call fails with a network or HTTP error (such as HTTP 500 "high demand") and Nano is installed, the SDK answers on the device: the badge reads "On this device" (not "In the cloud"), and only the Under the hood row for that step shows "(Used a fallback)". If that happens, retake until the badge says "In the cloud", or narrate it honestly: "The cloud was busy, so the SDK answered on this device." Other failures (a 45-second timeout, a blocked response, a malformed reply) show an error card even with Nano, and a failed call gets no row in Under the hood; the narration must match what is on screen.
- Do not claim accuracy numbers unless they are measured and in the README.
- Mention the hosted URL only if it is deployed and tested.

## Pre-recording checklist

- [ ] Gemini Nano is installed. In the DevTools console, `await LanguageModel.availability()` returns `"available"`. If it says `"downloadable"`, run the download first (see `docs/firebase-setup.md` step 11).
- [ ] That console call uses no options, but the app probes with English text in and out. Also confirm the app's own state: open "Under the hood" and check Status: Ready and Model: Gemini Nano.
- [ ] Real mode: `.env.local` is filled in and `VITE_AI_MODE` is not set. If you used the mock in this PowerShell session, run `Remove-Item Env:VITE_AI_MODE` and restart `npm run dev`.
- [ ] App Check token works (no App Check error in the console; see the Troubleshooting section in `docs/firebase-setup.md`).
- [ ] The cloud model is not overloaded. Do one test audit first and look at the badge. If the badge says "On this device" instead of "In the cloud" (Under the hood shows "(Used a fallback)" for that step), or an error card appears, wait and retry later.
- [ ] Do a full dry run end to end, note the real timings, and trim the narration to fit.
- [ ] Clean Chrome profile or guest window, no extensions visible, bookmarks bar hidden, notifications off.
- [ ] Browser zoom 125%. Record at 1080p.
- [ ] Use the built-in sample (do not paste your own bill).
- [ ] English narration, or English subtitles.
- [ ] After recording: upload to YouTube as **Public**, then paste the link into Devpost and `README.md`.

## Shot list

With Nano ready, "Try a sample bill" skips the Set up screen. The screens you will see are: Add bill, the "Removing your personal details" working screen (the step bar highlights "Set up" for it), Check details (the review), Your choice, then the results (Explanation, Questions, Things to check, Letter).

| Time | On screen | Narration |
|---|---|---|
| 0:00-0:13 | Title card "ClearBill", then a zoomed shot of a bill full of codes. | "Medical bills are hard to read, and getting help usually means pasting private details into a cloud chatbot. ClearBill explains a bill and keeps your details on your computer." |
| 0:13-0:27 | Open the app in Chrome. Open "Under the hood" and point at Status: Ready and Model: Gemini Nano. Close it. | "ClearBill runs in Chrome on Firebase AI Logic hybrid inference. Under the hood shows that Gemini Nano, Chrome's on-device model, is ready on this computer." |
| 0:27-0:37 | Add bill screen: point at the made-up sample note, click "Try a sample bill". | "I'll use the built-in sample. It is made up, and only this sample can ever use the cloud." |
| 0:37-0:53 | The "Removing your personal details" working screen with the "Made-up sample bill" chip, then Check details (the review) with highlighted details and the "On this device" badge. | "Gemini Nano finds personal details on this device and replaces them with labels. Nothing has been sent, and the badge says where this ran." |
| 0:53-1:07 | Review screen: point at the "Always removed" tag and the guard text; add a missed word if one was missed. Click "Looks right, continue". | "I check what was removed and can add what it missed. A final regex guard always removes labelled IDs, phone numbers and emails, even if I keep them." |
| 1:07-1:27 | Your choice screen: open "See the exact text". Show "Keep everything on this computer". Tick the box, click "Agree and continue". | "Now I choose. This is the exact text that would leave my computer. I can keep everything here, or agree. I'll agree, because this is the made-up sample." |
| 1:27-1:43 | Explanation screen with line items and the source badge (On this device or In the cloud, whichever really happened). | "Each charge is explained in plain words. This step prefers the device, and the badge shows whether Nano or the cloud did it." |
| 1:43-1:57 | Questions tab: type "Why was I charged twice for the Tdap vaccine?" (the sample lists code 90715 twice), or use "Ask about this charge" on that line. Show the answer and its badge. | "Questions never leave the device. This answer came from Gemini Nano." |
| 1:57-2:15 | Things to check: flags with the badge. Then "Draft a letter" and the letter text. | "Now the cloud steps. Gemini checks the redacted sample for things worth asking about, and drafts a polite letter. The flags are questions, not accusations." |
| 2:15-2:27 | Open "Under the hood": the table of calls (Step, Mode, Ran, Model, Time) and the status block (cloud consent: Agreed, cloud features: On). | "Under the hood lists every completed call: the mode, where it ran, the model and the time. Redaction and questions ran on the device." |
| 2:27-2:45 | Reach the Your choice screen on a fresh bill (Start over, load the sample, continue) and point at "Keep everything on this computer"; or show "Stop sending to the cloud". Any kill-switch visual is labelled "Simulated". | "If I keep everything here, a fresh bill never leaves this computer. A Remote Config kill switch and region gate can turn the cloud off, and App Check protects the backend. ClearBill: you choose what leaves your computer." |

Notes for the last row: text already sent to the cloud cannot be called back, so the claim is about a fresh bill. If the dry run runs past 3:00, cut the Remote Config sentence first, then the "Always removed" pointer.

## Fallback plan if the cloud is busy during recording

1. With Nano installed, a network or HTTP failure (such as HTTP 500 "high demand") makes the SDK answer on the device, so the audit or letter badge reads "On this device" and Under the hood shows "(Used a fallback)" for that step. Wait a few minutes and retake the step until the badge says "In the cloud". If the step instead times out (45 seconds) or shows an error card, retake it too: a timeout does not fall back and shows the busy card, "Cloud AI is temporarily unavailable" (try again after a wait).
2. If the cloud stays unavailable, record the on-device path now (redaction, review, consent, explanation, questions) and re-record the audit and letter segment later. Edit the parts together.
3. If you must publish with the fallback result, keep it and narrate it honestly: "The cloud was busy, so the SDK answered on this device." A timeout, blocked response or malformed reply shows an error card even with Nano, and without Nano an HTTP failure shows one too; a failed call does not get an Under the hood row. If you show one, show it as it is.
4. Do not substitute mock output unless it is labelled "Mock AI" on screen.
