# Accessibility

Target: WCAG 2.2 level AA in Chrome on desktop, with keyboard only, with NVDA and with JAWS on Windows, with VoiceOver on macOS, and at 200% zoom. Strings named here are keys in [`copy.json`](copy.json).

## 1. Whole app

- **Landmarks:** `header` (banner) with the app name, the step bar (`nav`, labelled `steps.navLabel`), the Under the hood toggle and Start over; `main`; Under the hood is an `aside` (complementary) labelled `underTheHood.title`; `footer` (contentinfo) with the privacy line and short disclaimer.
- **Skip link:** first focusable element, `app.skipLink`, jumps to the `main` heading.
- **One `h1` per step**, the step title. Moving to a new step moves focus to that `h1` (with `tabindex="-1"`) and updates `document.title` to "{step title} · ClearBill".
- **Step bar:** an ordered list. The current step has `aria-current="step"`. Each item's accessible name uses `steps.current`, `steps.completed` or `steps.upcoming`. Finished steps are links; future steps are plain text, not disabled buttons.
- **Focus visible:** a 2px solid outline with a 2px offset, at least 3:1 against both the element and the page. Never removed.
- **Targets:** at least 24 x 24 CSS px; primary buttons are 40px tall.
- **Zoom and reflow:** works at 320 CSS px wide (400% zoom) in one column. The two-pane review screen stacks: list first, then the preview.
- **Live regions:** one polite region (`role="status"`) for progress and confirmations, one assertive region only for errors after a user action. Messages are short, not repeated, and never streamed token by token.
- **No time limits.** Nothing advances on its own. The model download has no timeout the user must beat.
- **Language:** `lang="en"` on `html`.

## 2. Review screen (S05a and S05b)

This is the most important screen to get right: it is where the user decides what can leave the device.

### Layout in DOM order

1. `h1` "Check what we removed" plus the redaction source badge.
2. Intro (`review.intro`) and summary (`review.summary_one/_other`).
3. Rules-only banner (S05b only), `role="note"`.
4. Guard notice (`review.guardTitle`, `review.guardBody`), `role="note"`.
5. **Details we found** list (the main control surface).
6. **Add a detail we missed** form.
7. **Text after removal** preview region.
8. Guard-applied notice (`review.guardAppliedNotice_*`), when present.
9. Actions: "Use a different bill", "Looks right, continue".

On wide screens the preview is shown on the left and the list on the right, using CSS grid. The DOM order above stays the same, so keyboard and screen-reader order follow the controls first. (Visual order differs from DOM order only across columns, which WCAG 1.3.2 allows because the meaning doesn't depend on it.)

### Focus order and keys

| Order | Element | Keys |
|---|---|---|
| 1 | `h1` (receives focus on arrival, not in tab order after) | |
| 2 | "Show original" / "Show text after removal" toggle (a `button` with `aria-pressed`) | Enter, Space |
| 3 | Details list: **one tab stop** for the whole list (roving `tabindex`) | Up/Down move between items; Home/End go to first/last; Enter or Space toggles Keep/Remove; Page Up/Down jump between category groups |
| 4 | "Words to remove" text field | |
| 5 | "What kind of detail is it?" `select` | Arrow keys |
| 6 | "Remove these words" button | Enter |
| 7 | Preview region (`tabindex="0"`, `role="region"`, labelled with `highlight.previewRegionLabel`) | Arrow keys scroll; Shift+arrows select text with caret browsing; when text is selected, the "Remove selected words" button appears right after the region in tab order |
| 8 | "Remove selected words" (only while a selection exists) | Enter |
| 9 | "Use a different bill" | Enter |
| 10 | "Looks right, continue" | Enter |

Details:

- **The list is the keyboard path, the inline highlights are not.** Highlights in the preview are not tab stops (there could be dozens). Moving through the list scrolls the matching highlight into view and outlines it, so sighted keyboard users see the context.
- **Each list item** is a row with the category, the placeholder (or the kept original), and a toggle `button` with `aria-pressed="true"` when the detail is removed. The toggle's accessible name is "Remove {category} {placeholder}" or "Keep {category} {placeholder}", built from `review.toggleRemove` / `review.toggleKeep` and `pii.<CATEGORY>.label`.
- **Locked categories** (SSN, MEMBER_ID, ACCOUNT_NUMBER, PHONE, EMAIL, DOB) can still be toggled, because the contract lets the user unmark them, but the row shows `review.lockedTag` and the toggle has `aria-describedby` pointing at the guard notice. When the user keeps one, the polite region announces `highlight.srKeptButGuarded`.
- **After toggling**, focus stays on the same row. The polite region announces `review.keptAnnounce` or `review.removedAnnounce`.
- **After adding a redaction**, focus moves to the new row in the list and the polite region announces `review.addedAnnounce_one/_other`. If nothing matched, the field gets `aria-invalid="true"` and `review.addNoMatch` is tied to it with `aria-describedby`.
- **Escape** inside the add form clears it. Escape is never used to leave the screen.

### Screen-reader labels for redaction highlights

Each highlight in the preview is a `mark`-like `span` with visible text (the placeholder or the kept original). Screen readers would otherwise read "[PATIENT_NAME_1]" as "left bracket patient underscore name underscore one". So each highlight gets an accessible text built from `copy.json`:

| Highlight state | Visible | Accessible text (key) | Example |
|---|---|---|---|
| Removed by the model or rules | `[PATIENT_NAME_1]` | `highlight.srRemoved` | "Removed Patient name: patient name 1." |
| Removed, always-removed category | `[DOB_1]` | `highlight.srRemovedLocked` | "Removed Date of birth: date of birth 1. Always removed." |
| Kept by the user | `Dr. Lee` (dashed underline) | `highlight.srKept` | "Kept Doctor or provider name: Dr. Lee. It appears as written in the text after removal." |
| Kept by the user but re-added by the guard | `[ACCOUNT_NUMBER_1]` | `highlight.srKeptButGuarded` | "You kept this Account number, but the final check removes it. The text after removal shows account number 1." |
| Added by the user | `[PERSON_NAME_2]` | `highlight.srManual` | "Removed by you as Other person's name: other person's name 2." |

Implementation notes for frontend:

- Render the placeholder for speech as words: the category label in lower case plus the number ("patient name 1"). Don't make the screen reader spell out underscores.
- Use a visually hidden span for the accessible text and `aria-hidden="true"` on the visible bracketed label, rather than `aria-label` on a `span` (which many screen readers ignore on non-interactive elements).
- The preview region's own label (`highlight.previewRegionLabel`) gives the total count, so users know what to expect before reading.
- Never rely on colour: removed = filled chip, always removed = chip with a thick border, kept = dashed underline (see the legend in S05a). These shapes stay visible in Windows High Contrast / forced-colors mode: use `border` and `text-decoration`, not `background` alone, and test with `@media (forced-colors: active)`.

## 3. Consent screen (S06)

- The checkbox has a real `label` (`consent.agreeLabel`). "Agree and continue" uses `aria-disabled="true"` (not the `disabled` attribute) until it's ticked, so it stays focusable and its reason (`consent.agreeButtonDisabledHint`) is announced via `aria-describedby`.
- Keep `consent.keptOnPurpose` and `consent.notStored` inside the consent card above the checkbox, at the same size and contrast as body text. The checkbox references both notes with `aria-describedby`. The terms link appears beside the data-use notice.
- "Keep everything on this computer" is a full button of the same size, never a link or a small text option.
- "See the exact text" is a disclosure (`button` with `aria-expanded`) that reveals the same redacted text, in a focusable region with the same highlight labels as S05.
- Focus order: `h1`, "Always stays" card, "Leaves only if you agree" card, "See the exact text", data-use and review notes with terms link, checkbox, "Agree and continue", "Keep everything on this computer", "Back". In the device-only variant, announce the availability reason before the continue action. Omit the cloud checkbox and offer to set up the model if it is unavailable.

## 4. Badges, tags and results

- Badge icons are `aria-hidden="true"`; the badge text is visible, and a visually hidden `badges.<SOURCE>.srLabel` follows it for a fuller sentence.
- Tooltips open on hover and focus, close on Escape, and stay open while hovered (WCAG 1.4.13).
- Each result card (line item, answer, audit flag) is an `article` with a heading, so users can jump by heading (H key) or landmark.
- Audit severity is a text tag with an icon. Flags are sorted likely errors first, so order also carries meaning for screen-reader users.

## 5. Under the hood (S13)

- A non-modal `aside`. Opening it moves focus to its heading; Close or Escape returns focus to the header toggle. The toggle has `aria-expanded` and `aria-controls`.
- The call log is a `table` with `caption` (`underTheHood.callsSection`) and `th scope="col"` headers. New rows are not announced (they would be noise); the running total sentence (`underTheHood.totalSent`) is in the polite region only when it changes from "nothing" to something.

## 6. Reduced motion

Respect `@media (prefers-reduced-motion: reduce)`:

| Motion | Default | Reduced |
|---|---|---|
| Indeterminate download bar | Stripes slide left to right | Static stripes, text `deviceModel.states.downloading.bodyIndeterminate` carries the meaning |
| Skeleton loading (S04, line cards) | Gentle shimmer | Static grey bars |
| Pending badge dots | Dots pulse in turn | Static dots |
| Scrolling the preview to a highlight | Smooth scroll | Instant jump (`scroll-behavior: auto`) |
| Under the hood panel | Slides in (200 ms) | Appears without sliding |
| Step change | Cross-fade (150 ms) | Instant |
| "Copied" confirmation | Fades out after 2 s | Stays until next action |

No animation runs longer than 5 seconds without a way to pause, and nothing flashes more than 3 times a second.

## 7. Content and reading level

- Copy aims at US grade 8. Check each screen with a readability tool before release; the consent and disclaimer strings need Rai's sign-off.
- Avoid idioms. Spell out "Explanation of Benefits (EOB)" the first time.
- Money is shown as "$1,850.00", and dates as "March 2" in prose. Codes (CPT, HCPCS) are always labelled "Code 99284", never bare.

## 8. Test checklist for tester (W11)

1. Tab through S05a with no mouse: can you keep a name, add a missed name, and continue?
2. With NVDA, does each highlight read as "Removed Patient name: patient name 1" and not as symbols?
3. Does keeping an account number announce that it will still be removed?
4. At 400% zoom (320px), is every screen usable in one column with no horizontal scroll (except the preview region, which may scroll inside itself)?
5. With reduced motion on, does anything still move?
6. In forced-colors mode, can you still tell removed, kept and always-removed apart, and tell the three badges apart?
7. Can a keyboard user reach and close Under the hood, and does focus return to the toggle?
