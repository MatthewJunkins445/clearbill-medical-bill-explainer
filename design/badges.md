# Badge spec

Every AI result in ClearBill carries a badge that says where it was made. The badge is the main way judges and users see the hybrid story, so it appears on every result, not only in Under the hood.

The badge reads its value straight from the result. For model calls that is `result.response.inferenceSource` (`ON_DEVICE` or `IN_CLOUD`, Firebase JS SDK 12.5.0 or later). For the regex-only path the app sets `LOCAL_RULES` itself. The badge never guesses from the requested mode: a `PREFER_ON_DEVICE` call that fell back to the cloud shows **In the cloud**.

## The three sources

| Source | Visible label (`copy.json`) | Icon | Screen-reader label | Tooltip |
|---|---|---|---|---|
| `ON_DEVICE` | On this device (`badges.ON_DEVICE.label`) | Laptop: a rounded screen over a base line | `badges.ON_DEVICE.srLabel` | `badges.ON_DEVICE.tooltip` |
| `IN_CLOUD` | In the cloud (`badges.IN_CLOUD.label`) | Cloud outline with an up arrow inside | `badges.IN_CLOUD.srLabel` | `badges.IN_CLOUD.tooltip` |
| `LOCAL_RULES` | Simple rules (`badges.LOCAL_RULES.label`) | Three stacked lines with a check (a checklist) | `badges.LOCAL_RULES.srLabel` | `badges.LOCAL_RULES.tooltip` |
| pending | Working (`badges.pending.label`) | Three dots (static when reduced motion is on) | `badges.pending.srLabel` | none |

Rules that keep the badge readable without colour:

1. **Icon plus text, always.** The label is never hidden, even in tight layouts. In a narrow column the badge wraps under the result title instead of losing its text.
2. **Three different shapes.** The laptop, cloud and checklist differ in outline, so the badges stay distinct in greyscale, for colour-blind users and in print.
3. **Border style differs too.** `ON_DEVICE` uses a solid 1px border, `IN_CLOUD` a solid 1px border plus an up arrow in the icon, and `LOCAL_RULES` a dashed 1px border. The dashed border signals "not AI".
4. **Icons are decorative to screen readers** (`aria-hidden="true"`). The text carries the meaning.

## Anatomy

```
 ┌───────────────────────────┐
 │ [icon 16px] On this device │   height 24px, padding 2px 8px, radius 12px
 └───────────────────────────┘   gap icon-to-text 6px, text 13px/600, no all-caps
```

- Minimum target if the badge is interactive (it opens a tooltip): 24 x 24 CSS px, per WCAG 2.2 target size.
- The tooltip opens on hover **and** on focus, and closes with Escape. It must not hide on pointer move into it (WCAG 1.4.13).
- The badge sits at the top right of each result card, after the title in DOM order, so a screen reader hears the title first.

## Colour tokens

Contrast was computed with the WCAG 2.x relative-luminance formula. AA needs 4.5:1 for text and 3:1 for the border against the page.

### Light theme (page background `#FFFFFF`)

| Token | Text | Fill | Text on fill | Border | Border on page |
|---|---|---|---|---|---|
| `--badge-device` | `#0B5132` | `#E6F4EC` | 8.28:1 | `#2E7D55` solid | 5.02:1 |
| `--badge-cloud` | `#173F7A` | `#E7EEF9` | 8.87:1 | `#3A64A8` solid | 5.89:1 |
| `--badge-rules` | `#5C4300` | `#FBF1D3` | 8.25:1 | `#8A6A00` dashed | 5.07:1 |
| `--badge-pending` | `#3D4450` | `#EEF0F3` | 8.59:1 | `#3D4450` dotted | high |

### Dark theme (page background `#121417`)

| Token | Text | Fill | Text on fill | Border | Border on page |
|---|---|---|---|---|---|
| `--badge-device` | `#B9EBCD` | `#123726` | 9.89:1 | `#5FBF8A` solid | 8.18:1 |
| `--badge-cloud` | `#C6DAFA` | `#162A4A` | 10.11:1 | `#7FA6E6` solid | 7.47:1 |
| `--badge-rules` | `#F4DE9C` | `#3A2E07` | 10.02:1 | `#C9A43A` dashed | 7.78:1 |
| `--badge-pending` | `#D3D8E0` | `#262A31` | 10.06:1 | `#D3D8E0` dotted | high |

The colours are a proposal. Frontend may adjust them to the final palette, as long as each pair stays at or above 4.5:1 (text) and 3:1 (border), and the icon and border-style differences stay.

## Audit flag tags (not source badges, but the same rules)

Audit flags use a tag with the same anatomy. They must never say "error" on its own.

| Severity | Label (`copy.json`) | Icon | Light text / fill | Dark text / fill |
|---|---|---|---|---|
| `likely_error` | Likely error (`audit.severity.likely_error.label`) | Triangle with an exclamation mark | `#8A1C1C` / `#FBE9E9` (7.92:1) | `#F6C3C3` / `#4A1616` (9.53:1) |
| `worth_asking` | Worth asking about (`audit.severity.worth_asking.label`) | Speech bubble with a question mark | `#4A2D7A` / `#F0EAF8` (9.15:1) | `#DCCBF7` / `#2E1F4A` (9.87:1) |

`worth_asking` uses purple, not amber, so it can't be mixed up with the `LOCAL_RULES` badge. An audit card shows both a severity tag and a source badge, for example "Likely error" plus "In the cloud".

## Where badges appear

| Place | Badge |
|---|---|
| Redaction review header | The source of the redaction pass: `ON_DEVICE`, or `LOCAL_RULES` in the rules-only fallback. The final regex guard always adds a second small `LOCAL_RULES` badge next to the "Always removed" notice. |
| Bill-type check (not-a-bill screen) | `ON_DEVICE` or `LOCAL_RULES` (heuristic fallback) |
| Each explained line item | `ON_DEVICE` or `IN_CLOUD` |
| Summary card | Same as the explanation call |
| Each question answer | `ON_DEVICE` or `IN_CLOUD` |
| Each audit flag and the audit header | Usually `IN_CLOUD`; `ON_DEVICE` if the cloud-first call fell back |
| Letter header | Usually `IN_CLOUD` |
| "Fill in my details" toggle on the letter | `LOCAL_RULES` (it is a local find-and-replace, no model) |
| Under the hood call log, "Ran" column | The same badge, in a compact form (icon plus short text) |

## Live updates

- While a call runs, the card shows the pending badge. When the result lands, the badge swaps to the real source without moving the layout (all badges reserve the width of the longest label, "On this device").
- The swap is announced politely only for the first result of each step (for example "Explanation ready, made on this device"), not for every line, to avoid a flood of announcements.
