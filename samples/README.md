# ClearBill sample bills

**All data in this directory is synthetic.** Every patient, relative, provider,
facility, insurer, town, address, phone number, email, SSN, NPI, member ID,
account number and claim number was invented for this project. Nothing comes
from a real bill or a real person. CPT, HCPCS, revenue and ICD-10 codes are
real public code sets. Their descriptions are short paraphrases.

These samples drive the demo video, the judges' test data, the AI layer's mock
responses and the redaction tests.

## Layout

```
samples/
  bills/<id>/
    bill.txt            canonical text, printable ASCII + "\n" only
    bill.pdf            same text in Courier with a real (extractable) text layer
    bill.png            same text rendered as an image (only some bills)
    ground-truth.json   expected redactions, line items, totals and planted issues
  schema/ground-truth.schema.json
  generator/
    common.py           marker parser, synthetic-ID helpers, table rendering
    bills.py            the bill definitions
    generate.py         writes samples/bills/ (deterministic)
    validate.py         checks everything (standard library only)
  requirements.txt      pinned generator dependencies
```

## The bills

| id | kind | planted issues |
|---|---|---|
| itemized-er-laceration | itemized_bill | POSSIBLE_UPCODING, DUPLICATE_CHARGE |
| itemized-inpatient-appendectomy | itemized_bill | POSSIBLE_UNBUNDLING, OUT_OF_NETWORK_SURPRISE, OTHER |
| itemized-outpatient-mri | itemized_bill | SERVICE_NOT_RECEIVED_CHECK, MATH_ERROR |
| itemized-labor-delivery | itemized_bill | DUPLICATE_CHARGE, SERVICE_NOT_RECEIVED_CHECK |
| itemized-long-icu-stay | itemized_bill (459 lines, about 12.9K tokens) | DUPLICATE_CHARGE, SERVICE_NOT_RECEIVED_CHECK |
| eob-specialist-visit | eob | OTHER (denied for prior auth) |
| eob-er-out-of-network | eob | OUT_OF_NETWORK_SURPRISE |
| summary-statement-er | summary_statement | NO_ITEMIZATION |
| summary-statement-final-notice | summary_statement | NO_ITEMIZATION, OTHER |
| adversarial-urgent-care | itemized_bill | MATH_ERROR |
| not-medical-utility | not_medical | none |
| prompt-injection-lab | itemized_bill | POSSIBLE_UNBUNDLING, OTHER (prompt injection) |

The adversarial bill puts names inside line descriptions, writes names in
lowercase and after "Pt:" prefixes, splits the account number, member ID,
phone number and address across lines, spaces out the SSN and writes the email
as "name at example.com". DOBs appear in seven formats across the set.

## Ground-truth conventions

- `pii[].occurrences` are 0-based, end-exclusive JavaScript string indices into
  `bill.txt`. The text is ASCII, so indices are identical in JS, Python and
  bytes. Every occurrence is listed. Matching is exact and case-sensitive, so
  `AGATHA SPROCKETMORE` and `agatha sprocketmore` are separate entries. A value
  may contain `\n` when the bill splits it across lines.
- `mustRedact: false` marks identifying text the app may keep because the
  explanation needs it: facility names and addresses, billing phone numbers,
  provider names and provider NPIs. Everything about the patient or their family
  is `mustRedact: true`, including diagnoses.
- `mustKeep` lists the codes, service dates, line charges and totals that
  redaction must not remove.
- Each line item's adjustment is implicit:
  `charge - insurancePaid - patientOwes`. `totals.adjustments` is the sum of
  those adjustments.
- `totals` holds the amounts printed on the bill. On bills with a planted
  `MATH_ERROR`, the printed totals do not match the line items. That mismatch
  is the planted issue. `totals` is `null` only on the non-medical bill.
- `approxTokens` = `ceil(len(bill.txt) / 4)`.

## Synthetic-data rules (enforced by validate.py)

- Phone numbers use 555-0100 to 555-0199, the range reserved for fiction.
- Emails and URLs are on example.com or example.org.
- SSNs use area numbers 900-999, which are never issued, and group 01-49,
  which is outside the ITIN ranges.
- NPIs fail the NPI Luhn check with the 80840 prefix.
- The digits in each member ID fail a Luhn mod-10 check.
- Names are deliberately whimsical and towns are fictional (Sampleton OH,
  Fauxville PA, Nowhere Falls CO, Lake Imaginary MN). ZIP codes are in the
  correct range for each state.

## Regenerate

Requires Python 3.12.

```sh
python -m venv samples/.venv
samples/.venv/Scripts/python -m pip install -r samples/requirements.txt   # Windows
# samples/.venv/bin/python -m pip install -r samples/requirements.txt     # macOS/Linux
samples/.venv/Scripts/python samples/generator/generate.py
```

Output is deterministic: the same code and pinned dependencies give
byte-identical files. The PDFs use reportlab's invariant mode. The PNGs use
the Courier Type 1 font bundled with reportlab, not a system font. The
generated files are committed.

To add a bill, write a builder in `generator/bills.py`. Wrap each PII value
with `M(CATEGORY, value)`, or with `K(...)` if it may be kept, and add the
builder to `BUILDERS`. The generator records the offsets itself. It refuses to
write a bill if a marked value also appears anywhere unmarked.

## Validate

```sh
python samples/generator/validate.py
```

The validator needs only the standard library, so it runs without the venv.
It exits with a non-zero code on any failure. It checks the schema, ASCII
text, exact and exhaustive PII offsets, mustKeep values that sit outside
redacted spans, the synthetic-number rules, the totals arithmetic and
duplicate-line consistency. It also checks coverage across the set: bill
kinds, every issue type, at least 3 DOB formats and a long bill over 9K
tokens.
