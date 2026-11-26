"""Validate the ClearBill synthetic samples. Standard library only.

    python samples/generator/validate.py

Exits 0 when every check passes, 1 otherwise. Checks:
  * ground-truth.json against samples/schema/ground-truth.schema.json
  * bill.txt is printable ASCII (plus newlines)
  * every pii value sits exactly at its listed offsets, with no unlisted occurrence
  * mustKeep values occur outside every mustRedact span
  * redaction policy: only FACILITY_NAME, ADDRESS and PHONE may be mustRedact false;
    every NPI (labeled, unlabeled next to a provider name, or a 10-digit OTHER_ID)
    is listed as pii with mustRedact true
  * synthetic-number rules (phones incl. no toll-free area codes, emails, URLs,
    SSNs, NPIs, member IDs)
  * totals arithmetic, except where a MATH_ERROR is planted (then it must actually fail)
  * planted-issue line indexes; duplicates really are identical lines
  * set-level coverage: bill kinds, every issue type, >= 3 DOB formats, long bill
"""

from __future__ import annotations

import json
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SAMPLES = HERE.parent
BILLS = SAMPLES / "bills"
SCHEMA = SAMPLES / "schema" / "ground-truth.schema.json"

ISSUE_TYPES = {"DUPLICATE_CHARGE", "MATH_ERROR", "POSSIBLE_UPCODING", "POSSIBLE_UNBUNDLING",
               "NO_ITEMIZATION", "OUT_OF_NETWORK_SURPRISE", "SERVICE_NOT_RECEIVED_CHECK", "OTHER"}
EXAMPLE_DOMAINS = ("example.com", "example.org")

# Only facility identity (name, address, billing phone) may survive redaction.
# Patient, relative and clinician identity, diagnoses and every ID are always
# mustRedact true. Keep in sync with common.KEEPABLE_CATEGORIES.
KEEPABLE_CATEGORIES = {"FACILITY_NAME", "ADDRESS", "PHONE"}
TOLL_FREE_AREA_CODES = {"800", "888", "877", "866", "855", "844", "833"}
# How far (same line only) from a provider name an unlabeled 10-digit number is
# treated as that provider's NPI.
NPI_NEIGHBOURHOOD = 40

errors: list[str] = []


def fail(bill_id: str, msg: str) -> None:
    errors.append(f"[{bill_id}] {msg}")


# --------------------------------------------------------------------------
# Minimal JSON Schema (2020-12 subset used by our schema)
# --------------------------------------------------------------------------

def _type_ok(value, t):
    if t == "object":
        return isinstance(value, dict)
    if t == "array":
        return isinstance(value, list)
    if t == "string":
        return isinstance(value, str)
    if t == "boolean":
        return isinstance(value, bool)
    if t == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if t == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if t == "null":
        return value is None
    raise ValueError(f"unsupported type {t}")


def schema_errors(value, schema, root, path="$"):
    out = []
    if "$ref" in schema:
        ref = schema["$ref"]
        assert ref.startswith("#/$defs/"), ref
        return schema_errors(value, root["$defs"][ref[len("#/$defs/"):]], root, path)
    if "const" in schema and value != schema["const"]:
        out.append(f"{path}: expected {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        out.append(f"{path}: {value!r} not in enum")
    if "type" in schema:
        types = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(_type_ok(value, t) for t in types):
            return out + [f"{path}: expected type {types}"]
    if isinstance(value, dict):
        for key in schema.get("required", []):
            if key not in value:
                out.append(f"{path}: missing {key}")
        props = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            for key in value:
                if key not in props:
                    out.append(f"{path}: unexpected property {key}")
        for key, sub in props.items():
            if key in value:
                out += schema_errors(value[key], sub, root, f"{path}.{key}")
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            out.append(f"{path}: fewer than {schema['minItems']} items")
        if "items" in schema:
            for i, item in enumerate(value):
                out += schema_errors(item, schema["items"], root, f"{path}[{i}]")
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            out.append(f"{path}: too short")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            out.append(f"{path}: does not match {schema['pattern']}")
    if _type_ok(value, "number") and "minimum" in schema and value < schema["minimum"]:
        out.append(f"{path}: below minimum {schema['minimum']}")
    return out


# --------------------------------------------------------------------------
# Synthetic-number rules
# --------------------------------------------------------------------------

def luhn_ok(digits: str) -> bool:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def phone_ok(raw: str) -> bool:
    d = re.sub(r"\D", "", raw)
    if len(d) == 11 and d[0] == "1":
        d = d[1:]
    if len(d) == 10:
        if d[:3] in TOLL_FREE_AREA_CODES:
            return False
        d = d[3:]
    return len(d) == 7 and d.startswith("55501")


def ssn_ok(raw: str) -> bool:
    if re.fullmatch(r"XXX-XX-\d{4}", raw):
        return True
    d = re.sub(r"\D", "", raw)
    return len(d) == 9 and 900 <= int(d[:3]) <= 999 and 1 <= int(d[3:5]) <= 49


PHONE_RE = re.compile(r"(?<!\d)(?:1-)?\(?\d{3}\)?[-. ]\d{3}[-. ]\d{4}(?!\d)")
SSN_RE = re.compile(r"(?<!\d)\d{3}[- ]\d{2}[- ]\d{4}(?!\d)")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})")
URL_RE = re.compile(r"(?:https?://|www\.)([A-Za-z0-9.-]+)")
NPI_RE = re.compile(r"NPI[^0-9\n]{0,4}(\d{10})(?!\d)")
BARE_10_DIGITS_RE = re.compile(r"(?<![\dA-Za-z-])\d{10}(?!\d)")


def find_npis(text, pii):
    """Return {npi_value: reason} for every NPI the validator can recognise.

    Recognised: a 10-digit number after an "NPI" label; an unlabeled 10-digit
    number on the same line as, and within NPI_NEIGHBOURHOOD characters of, a
    PROVIDER_NAME occurrence; any OTHER_ID pii value that is exactly 10 digits.
    Not recognised: an unlabeled 10-digit number far from any provider name.
    """
    found = {}
    for m in NPI_RE.finditer(text):
        found.setdefault(m.group(1), "labeled NPI")
    for p in pii:
        if p["category"] == "OTHER_ID" and re.fullmatch(r"\d{10}", p["value"]):
            found.setdefault(p["value"], "10-digit OTHER_ID")
        if p["category"] != "PROVIDER_NAME":
            continue
        for o in p["occurrences"]:
            line_start = text.rfind("\n", 0, o["start"]) + 1
            line_end = text.find("\n", o["end"])
            line_end = len(text) if line_end == -1 else line_end
            lo = max(line_start, o["start"] - NPI_NEIGHBOURHOOD)
            hi = min(line_end, o["end"] + NPI_NEIGHBOURHOOD)
            for m in BARE_10_DIGITS_RE.finditer(text, lo, hi):
                found.setdefault(m.group(0), f"unlabeled, next to {p['value']!r}")
    return found


def check_redaction_policy(bid, text, pii):
    for p in pii:
        if not p["mustRedact"] and p["category"] not in KEEPABLE_CATEGORIES:
            fail(bid, f"{p['category']} {p['value']!r} is mustRedact false; only "
                      f"{sorted(KEEPABLE_CATEGORIES)} may be kept")
    by_value = {p["value"]: p for p in pii}
    for npi, why in sorted(find_npis(text, pii).items()):
        if luhn_ok("80840" + npi):
            fail(bid, f"NPI {npi} ({why}) passes the check digit (could be real)")
        p = by_value.get(npi)
        if p is None:
            fail(bid, f"NPI {npi} ({why}) is not listed in pii")
        elif not p["mustRedact"]:
            fail(bid, f"NPI {npi} ({why}) is mustRedact false")


def domain_ok(host: str) -> bool:
    host = host.lower().rstrip(".")
    return any(host == d or host.endswith("." + d) for d in EXAMPLE_DOMAINS)


def check_synthetic(bid, text, pii):
    for m in PHONE_RE.finditer(text):
        if not phone_ok(m.group(0)):
            fail(bid, f"phone-like number {m.group(0)!r} is not 555-01xx on a geographic "
                      f"(non-toll-free) area code")
    for m in SSN_RE.finditer(text):
        if PHONE_RE.fullmatch(m.group(0)):
            continue
        if not ssn_ok(m.group(0)):
            fail(bid, f"SSN-like number {m.group(0)!r} not in area 900-999 / group 01-49")
    for m in EMAIL_RE.finditer(text):
        if not domain_ok(m.group(1)):
            fail(bid, f"email domain {m.group(1)!r} is not example.com/.org")
    for m in URL_RE.finditer(text):
        if not domain_ok(m.group(1)):
            fail(bid, f"URL host {m.group(1)!r} is not example.com/.org")
    for p in pii:
        v, cat = p["value"], p["category"]
        if cat == "PHONE" and not phone_ok(v):
            fail(bid, f"PHONE {v!r} is not 555-01xx on a geographic area code")
        if cat == "SSN" and not ssn_ok(v):
            fail(bid, f"SSN {v!r} not in area 900-999 / group 01-49")
        if cat == "EMAIL" and not re.search(r"(?:@|\sat\s)(?:[\w-]+\.)*example\.(?:com|org)$", v):
            fail(bid, f"EMAIL {v!r} is not on example.com/.org")
        if cat == "MEMBER_ID":
            d = re.sub(r"\D", "", v)
            if len(d) < 2 or luhn_ok(d):
                fail(bid, f"MEMBER_ID {v!r} digits pass Luhn (must fail)")


# --------------------------------------------------------------------------
# Per-bill checks
# --------------------------------------------------------------------------

def cents(x) -> int:
    return round(x * 100)


def check_bill(d: Path, schema):
    bid = d.name
    gt_path = d / "ground-truth.json"
    if not gt_path.is_file():
        fail(bid, "missing ground-truth.json")
        return None
    gt = json.loads(gt_path.read_text(encoding="utf-8"))
    errs = schema_errors(gt, schema, schema)
    for e in errs:
        fail(bid, f"schema: {e}")
    if errs:
        return None
    if gt["id"] != bid:
        fail(bid, f"id {gt['id']!r} does not match directory")

    raw = (d / gt["files"]["text"]).read_bytes()
    try:
        text = raw.decode("ascii")
    except UnicodeDecodeError:
        fail(bid, "bill.txt is not ASCII")
        return None
    bad = sorted({c for c in text if c != "\n" and not (32 <= ord(c) < 127)})
    if bad:
        fail(bid, f"bill.txt has non-printable characters {bad!r}")
    if "pdf" in gt["files"] and not (d / "bill.pdf").read_bytes().startswith(b"%PDF-"):
        fail(bid, "bill.pdf is not a PDF")
    if "image" in gt["files"] and not (d / "bill.png").read_bytes().startswith(b"\x89PNG"):
        fail(bid, "bill.png is not a PNG")
    if gt["approxTokens"] != math.ceil(len(text) / 4):
        fail(bid, f"approxTokens {gt['approxTokens']} != ceil(len/4) {math.ceil(len(text) / 4)}")

    # PII offsets: exact and exhaustive.
    redact_spans = []
    seen_values = set()
    for p in gt["pii"]:
        v = p["value"]
        if v in seen_values:
            fail(bid, f"pii value {v!r} listed twice")
        seen_values.add(v)
        listed = sorted(o["start"] for o in p["occurrences"])
        for o in p["occurrences"]:
            if text[o["start"]:o["end"]] != v:
                fail(bid, f"pii {v!r} not at {o['start']}:{o['end']} "
                          f"(found {text[o['start']:o['end']]!r})")
            if p["mustRedact"]:
                redact_spans.append((o["start"], o["end"]))
        actual = []
        i = text.find(v)
        while i != -1:
            actual.append(i)
            i = text.find(v, i + 1)
        missing = sorted(set(actual) - set(listed))
        if missing:
            fail(bid, f"pii {v!r} has unlisted occurrence(s) at {missing}")

    # mustKeep: present outside redaction.
    for k in gt["mustKeep"]:
        v = k["value"]
        ok = False
        i = text.find(v)
        while i != -1 and not ok:
            j = i + len(v)
            ok = not any(s < j and i < e for s, e in redact_spans)
            i = text.find(v, i + 1)
        if not ok:
            fail(bid, f"mustKeep {v!r} has no occurrence outside redacted spans")

    check_synthetic(bid, text, gt["pii"])
    check_redaction_policy(bid, text, gt["pii"])

    # Totals arithmetic.
    items = gt["lineItems"]
    for idx, li in enumerate(items):
        if cents(li["insurancePaid"]) + cents(li["patientOwes"]) > cents(li["charge"]):
            fail(bid, f"line {idx}: insurancePaid + patientOwes exceeds charge")
    issues = gt["plantedIssues"]
    has_math_error = any(i["type"] == "MATH_ERROR" for i in issues)
    t = gt["totals"]
    if t is None:
        if gt["kind"] != "not_medical":
            fail(bid, "totals is null on a medical bill")
    else:
        problems = []
        if cents(t["charges"]) - cents(t["adjustments"]) - cents(t["insurancePaid"]) != \
                cents(t["patientResponsibility"]):
            problems.append("charges - adjustments - insurancePaid != patientResponsibility")
        if items:
            sums = {
                "charges": sum(cents(li["charge"]) for li in items),
                "insurancePaid": sum(cents(li["insurancePaid"]) for li in items),
                "patientResponsibility": sum(cents(li["patientOwes"]) for li in items),
            }
            sums["adjustments"] = sums["charges"] - sums["insurancePaid"] - sums["patientResponsibility"]
            for key, val in sums.items():
                if cents(t[key]) != val:
                    problems.append(f"totals.{key} {t[key]} != line sum {val / 100}")
        if has_math_error and not problems:
            fail(bid, "MATH_ERROR planted but the totals are arithmetically consistent")
        if not has_math_error:
            for pr in problems:
                fail(bid, pr)

    for iss in issues:
        for ix in iss["lineIndexes"]:
            if ix >= len(items):
                fail(bid, f"{iss['type']} lineIndex {ix} out of range")
        if iss["type"] == "DUPLICATE_CHARGE":
            sel = [items[ix] for ix in iss["lineIndexes"] if ix < len(items)]
            keys = {(li["serviceDate"], li["code"], li["charge"]) for li in sel}
            if len(sel) < 2 or len(keys) != 1:
                fail(bid, "DUPLICATE_CHARGE lines are not identical (date, code, charge)")
        if iss["type"] == "NO_ITEMIZATION" and items:
            fail(bid, "NO_ITEMIZATION planted but the bill has line items")
    return gt


DOB_FORMATS = [
    ("MM/DD/YYYY", r"\d{2}/\d{2}/\d{4}"),
    ("M/D/YY", r"\d{1,2}/\d{1,2}/\d{2}"),
    ("YYYY-MM-DD", r"\d{4}-\d{2}-\d{2}"),
    ("YYYYMMDD", r"\d{8}"),
    ("Month D, YYYY", r"[A-Z][a-z]+\.? \d{1,2}, \d{4}"),
    ("DD-MON-YYYY", r"\d{2}-[A-Z]{3}-\d{4}"),
    ("DD MON YYYY", r"\d{1,2} [A-Z]{3} \d{4}"),
]


def check_set(gts):
    s = "set"
    if len(gts) < 12:
        fail(s, f"only {len(gts)} bills, need >= 12")
    kinds = [g["kind"] for g in gts]
    for kind, n in (("itemized_bill", 4), ("eob", 2), ("summary_statement", 2), ("not_medical", 1)):
        if kinds.count(kind) < n:
            fail(s, f"need >= {n} {kind}, have {kinds.count(kind)}")
    tags = [set(g["tags"]) for g in gts]
    if sum("hospital" in t and g["kind"] == "itemized_bill" for t, g in zip(tags, gts)) < 4:
        fail(s, "need >= 4 itemized hospital bills")
    if not any("long" in t and g["approxTokens"] > 9000 for t, g in zip(tags, gts)):
        fail(s, "need a bill tagged long with approxTokens > 9000")
    for tag in ("adversarial", "prompt_injection", "utility"):
        if not any(tag in t for t in tags):
            fail(s, f"no bill tagged {tag}")
    covered = {i["type"] for g in gts for i in g["plantedIssues"]}
    if ISSUE_TYPES - covered:
        fail(s, f"issue types not covered: {sorted(ISSUE_TYPES - covered)}")
    formats = set()
    for g in gts:
        for p in g["pii"]:
            if p["category"] == "DOB":
                fmt = next((n for n, rx in DOB_FORMATS if re.fullmatch(rx, p["value"])), "other")
                formats.add(fmt)
    if len(formats) < 3:
        fail(s, f"DOB formats {sorted(formats)}: need >= 3")
    return covered, formats


def main() -> int:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    dirs = sorted(p for p in BILLS.iterdir() if p.is_dir()) if BILLS.is_dir() else []
    gts = [g for g in (check_bill(d, schema) for d in dirs) if g]
    covered, formats = check_set(gts)
    for g in gts:
        print(f"  {g['id']:<34} {g['kind']:<18} pii={len(g['pii']):<3} "
              f"lines={len(g['lineItems']):<4} tokens~{g['approxTokens']}")
    print(f"issue types covered: {len(covered)}/{len(ISSUE_TYPES)}; "
          f"DOB formats: {', '.join(sorted(formats))}")
    if errors:
        print(f"\nFAILED: {len(errors)} problem(s)")
        for e in errors:
            print("  " + e)
        return 1
    print(f"\nPASSED: {len(gts)} bills validated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
