# submission

#BuildHybridAI 2026 submission materials.

| File | What it is |
|---|---|
| [`devpost-description.md`](devpost-description.md) | The text for the Devpost description field. Has `[TODO: ...]` markers to fill in. |
| [`video-script.md`](video-script.md) | Timed shot list and narration for the demo video (3:00 maximum, target 2:45), a pre-recording checklist and the honesty rule. |
| `README.md` | This index and the submission checklist. |

The project README is [`../README.md`](../README.md).

## Submission checklist

Deadline: **Nov 30, 2026, 5:00 pm EST.** We plan to submit on Nov 29.

- [ ] Repo is public, and GitHub's About box shows the Apache-2.0 license.
- [ ] No `.env.local` or tokens in git. Run `git ls-files | findstr /i env`. Only `.env.example` (and `src/firebase/env.d.ts`, a type file) should appear.
- [ ] Gemini Nano is installed and `await LanguageModel.availability()` returns `"available"` on the recording machine.
- [ ] Demo video is 3:00 or less, in English, shows the app working in Chrome, and any mock or simulated moment is labelled on screen.
- [ ] Video is uploaded to YouTube as **Public**, and the link works in a private window.
- [ ] Hosted URL is live and tested (`https://clearbill-2c019.web.app` is only planned until deployed). If it is not live, remove it from `README.md` and the Devpost text.
- [ ] Every `[TODO: ...]` in `README.md` and `devpost-description.md` is filled in or removed (YouTube link, GitHub URL, status paragraph, accuracy numbers).
- [ ] The Status section of `README.md` still matches reality after the final real run.
- [ ] Description is pasted into the Devpost form: how Firebase AI Logic is used, features, value proposition.
- [ ] Repo link, video link and (if live) hosted link are added to the Devpost form.
- [ ] Submit before the deadline (Nov 30, 5:00 pm EST).
