"""Shared helpers for the ClearBill synthetic sample generator.

Everything here is deterministic. All names, numbers and addresses produced
by this package are SYNTHETIC.

Templates use an inline PII marker syntax that is stripped from the final
text while the exact character offsets are recorded:

    <<CATEGORY|value>>   PII that redaction MUST remove (mustRedact: true)
    <<CATEGORY!|value>>  identifying but allowed to stay (mustRedact: false),
                         e.g. a facility name or a provider's public NPI

A value may contain newlines (used for numbers split across lines).
"""

from __future__ import annotations

import math
import random
import re

SEED = 20261125

PII_CATEGORIES = (
    "PATIENT_NAME", "PERSON_NAME", "PROVIDER_NAME", "FACILITY_NAME", "DOB",
    "ADDRESS", "PHONE", "EMAIL", "SSN", "MEMBER_ID", "ACCOUNT_NUMBER",
    "DIAGNOSIS", "OTHER_ID",
)

MARK_RE = re.compile(r"<<([A-Z_]+)(!?)\|(.*?)>>", re.S)

DESC_WIDTH = 34
MAX_LINE = 110


def M(category: str, value: str) -> str:
    """Marker for PII that must be redacted."""
    assert category in PII_CATEGORIES, category
    return f"<<{category}|{value}>>"


def K(category: str, value: str) -> str:
    """Marker for identifying text that may be kept (mustRedact: false)."""
    assert category in PII_CATEGORIES, category
    return f"<<{category}!|{value}>>"


def visible(s: str) -> str:
    """Text as it will be printed: markers replaced by their values."""
    return MARK_RE.sub(lambda m: m.group(3), s)


def rng_for(bill_id: str) -> random.Random:
    return random.Random(f"{SEED}-{bill_id}")


# --------------------------------------------------------------------------
# Synthetic identifiers
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


def npi_is_valid(npi: str) -> bool:
    """A real NPI passes Luhn when prefixed with 80840."""
    return len(npi) == 10 and npi.isdigit() and luhn_ok("80840" + npi)


def fake_npi(rng: random.Random) -> str:
    """10-digit NPI-shaped number that FAILS the NPI check digit."""
    body = "1" + "".join(str(rng.randrange(10)) for _ in range(9))
    if npi_is_valid(body):
        body = body[:-1] + str((int(body[-1]) + 1) % 10)
    assert not npi_is_valid(body)
    return body


def fake_member_id(rng: random.Random, prefix: str, ndigits: int = 9) -> str:
    """Member ID whose digit portion FAILS a Luhn mod-10 check."""
    digits = "".join(str(rng.randrange(10)) for _ in range(ndigits))
    if luhn_ok(digits):
        digits = digits[:-1] + str((int(digits[-1]) + 1) % 10)
    assert not luhn_ok(digits)
    return f"{prefix}{digits}"


def fake_ssn(rng: random.Random) -> str:
    """SSN with area 900-999 (never issued) and group 01-49 (outside ITIN ranges)."""
    return f"{rng.randrange(900, 1000)}-{rng.randrange(1, 50):02d}-{rng.randrange(1, 10000):04d}"


def fake_phone(rng: random.Random, area: str) -> str:
    """555-0100..555-0199 are reserved for fictional use."""
    return f"({area}) 555-01{rng.randrange(100):02d}"


def digits(rng: random.Random, n: int) -> str:
    return "".join(str(rng.randrange(10)) for _ in range(n))


# --------------------------------------------------------------------------
# Money / dates
# --------------------------------------------------------------------------

def money(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    c = abs(cents)
    return f"{sign}{c // 100:,}.{c % 100:02d}"


def us_date(iso: str) -> str:
    y, m, d = iso.split("-")
    return f"{m}/{d}/{y}"


def approx_tokens(text: str) -> int:
    """Heuristic used across the repo: ~4 characters per token."""
    return math.ceil(len(text) / 4)


# --------------------------------------------------------------------------
# Line items and tables
# --------------------------------------------------------------------------

class Line:
    """One billed service. Money is held in integer cents.

    adj is the line's contractual / other adjustment; patient owes is derived:
    owes = charge - ins - adj.
    """

    def __init__(self, date, code, system, desc, units, charge, ins=0, adj=0):
        self.date = date
        self.code = code
        self.system = system
        self.desc = desc            # may contain PII markers and "\n"
        self.units = units
        self.charge = charge
        self.ins = ins
        self.adj = adj
        assert self.owes >= 0, (code, desc)

    @property
    def owes(self) -> int:
        return self.charge - self.ins - self.adj

    def ground_truth(self) -> dict:
        return {
            "serviceDate": self.date,
            "code": self.code,
            "codeSystem": self.system,
            "description": " ".join(visible(self.desc).split()),
            "units": self.units,
            "charge": self.charge / 100,
            "insurancePaid": self.ins / 100,
            "patientOwes": self.owes / 100,
        }


ITEMIZED_COLS = ("DESCRIPTION", "CHARGE", "INS PAID", "ADJUST", "PT OWES")
EOB_COLS = ("SERVICE", "BILLED", "PLAN PAID", "DISCOUNT", "YOU OWE")


def table_header(cols=ITEMIZED_COLS) -> str:
    d, c1, c2, c3, c4 = cols
    return (f"{'DATE':<11}{'CODE':<8}{d:<{DESC_WIDTH}}{'QTY':>4}"
            f"{c1:>12}{c2:>11}{c3:>11}{c4:>11}")


def table_rule() -> str:
    return "-" * 102


def table_row(line: Line) -> str:
    desc_lines = line.desc.split("\n")
    first = desc_lines[0]
    pad = " " * max(0, DESC_WIDTH - len(visible(first)))
    row = (f"{us_date(line.date):<11}{line.code:<8}{first}{pad}{line.units:>4}"
           f"{money(line.charge):>12}{money(line.ins):>11}{money(line.adj):>11}"
           f"{money(line.owes):>11}")
    for cont in desc_lines[1:]:
        row += "\n" + " " * 19 + cont
    return row


def table(lines, cols=ITEMIZED_COLS) -> str:
    return "\n".join([table_header(cols), table_rule()] + [table_row(l) for l in lines])


def totals_from_lines(lines) -> dict:
    return {
        "charges": sum(l.charge for l in lines),
        "adjustments": sum(l.adj for l in lines),
        "insurancePaid": sum(l.ins for l in lines),
        "patientResponsibility": sum(l.owes for l in lines),
    }


def totals_block(t: dict, labels=("TOTAL CHARGES", "TOTAL ADJUSTMENTS",
                                  "TOTAL INSURANCE PAID", "PATIENT RESPONSIBILITY")) -> str:
    vals = (t["charges"], t["adjustments"], t["insurancePaid"], t["patientResponsibility"])
    return "\n".join(f"{' ' * 52}{lab:<28}{money(v):>14}" for lab, v in zip(labels, vals))


# --------------------------------------------------------------------------
# Template finalisation
# --------------------------------------------------------------------------

def finalize(template: str):
    """Strip markers; return (text, pii) with every occurrence recorded.

    Raises if any PII value also occurs somewhere it was not marked, so the
    ground truth can never silently miss an occurrence.
    """
    out = []
    length = 0
    last = 0
    marks = {}  # value -> dict(category, mustRedact, starts)
    for m in MARK_RE.finditer(template):
        chunk = template[last:m.start()]
        out.append(chunk)
        length += len(chunk)
        cat, keep, value = m.group(1), m.group(2) == "!", m.group(3)
        entry = marks.setdefault(value, {"category": cat, "mustRedact": not keep, "starts": []})
        if entry["category"] != cat or entry["mustRedact"] != (not keep):
            raise ValueError(f"inconsistent marking for {value!r}")
        entry["starts"].append(length)
        out.append(value)
        length += len(value)
        last = m.end()
    out.append(template[last:])
    text = "".join(out)

    if "<<" in text or ">>" in text:
        raise ValueError("stray marker delimiter in text")
    try:
        text.encode("ascii")
    except UnicodeEncodeError as e:
        raise ValueError(f"non-ASCII text: {e}") from None
    for i, ln in enumerate(text.split("\n")):
        if len(ln) > MAX_LINE:
            raise ValueError(f"line {i + 1} longer than {MAX_LINE}: {ln!r}")

    pii = []
    for value, e in marks.items():
        found = []
        i = text.find(value)
        while i != -1:
            found.append(i)
            i = text.find(value, i + 1)
        if sorted(found) != sorted(e["starts"]):
            extra = sorted(set(found) - set(e["starts"]))
            raise ValueError(f"unmarked occurrence(s) of {value!r} at {extra}")
        pii.append({
            "category": e["category"],
            "value": value,
            "mustRedact": e["mustRedact"],
            "occurrences": [{"start": s, "end": s + len(value)} for s in sorted(found)],
        })
    pii.sort(key=lambda p: (p["occurrences"][0]["start"], p["value"]))
    return text, pii
