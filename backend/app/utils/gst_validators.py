"""
Indian GST / PAN / CIN Compliance Validators
=============================================
Central module for all Indian tax registration validations.
Used by Pydantic schemas, API endpoints, and DB triggers.
"""
import re
from typing import Optional

# ── State Code Master (GST Portal) ────────────────────────────────────────────
STATE_CODE_MAP: dict[str, str] = {
    "01": "Jammu & Kashmir",
    "02": "Himachal Pradesh",
    "03": "Punjab",
    "04": "Chandigarh",
    "05": "Uttarakhand",
    "06": "Haryana",
    "07": "Delhi",
    "08": "Rajasthan",
    "09": "Uttar Pradesh",
    "10": "Bihar",
    "11": "Sikkim",
    "12": "Arunachal Pradesh",
    "13": "Nagaland",
    "14": "Manipur",
    "15": "Mizoram",
    "16": "Tripura",
    "17": "Meghalaya",
    "18": "Assam",
    "19": "West Bengal",
    "20": "Jharkhand",
    "21": "Odisha",
    "22": "Chhattisgarh",
    "23": "Madhya Pradesh",
    "24": "Gujarat",
    "25": "Dadra & Nagar Haveli and Daman & Diu",
    "26": "Daman & Diu",              # legacy code (pre-merger, still valid on old GSTINs)
    "27": "Maharashtra",
    "28": "Andhra Pradesh (Old)",     # legacy pre-bifurcation code
    "29": "Karnataka",
    "30": "Goa",
    "31": "Lakshadweep",
    "32": "Kerala",
    "33": "Tamil Nadu",
    "34": "Puducherry",
    "35": "Andaman & Nicobar Islands",
    "36": "Telangana",
    "37": "Andhra Pradesh",
    "38": "Ladakh",
    "97": "Other Territory",
    "99": "Centre Jurisdiction",
}

# GSTIN checksum character set
_GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"

# ── GSTIN ─────────────────────────────────────────────────────────────────────

_GSTIN_PATTERN = re.compile(
    r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$"
)

def validate_gstin(gstin: Optional[str]) -> tuple[bool, str]:
    """
    Validates GSTIN format and state code.
    Returns (is_valid, error_message). Empty string = valid.
    """
    if not gstin or gstin.strip() == "":
        return True, ""

    g = gstin.strip().upper()

    if len(g) != 15:
        return False, f"GSTIN must be exactly 15 characters (got {len(g)})"

    if not _GSTIN_PATTERN.match(g):
        return False, "Invalid GSTIN format — expected: SS AAAAA 9999 A 9 Z C (e.g. 07ABCDE1234F1Z5)"

    state_code = g[:2]
    if state_code not in STATE_CODE_MAP:
        return False, f"Invalid state code '{state_code}' in GSTIN"

    pan_part = g[2:12]
    pan_ok, pan_err = validate_pan(pan_part)
    if not pan_ok:
        return False, f"Embedded PAN in GSTIN is invalid: {pan_err}"

    # Optional: verify checksum (Luhn-like MOD 36)
    checksum_ok, checksum_err = _verify_gstin_checksum(g)
    if not checksum_ok:
        return False, checksum_err

    return True, ""


def _verify_gstin_checksum(gstin: str) -> tuple[bool, str]:
    """Verify GSTIN checksum digit (position 15, index 14)."""
    try:
        factor = 1
        total = 0
        for i, ch in enumerate(gstin[:-1]):   # first 14 chars
            digit = _GSTIN_CHARS.index(ch) * factor
            digit = (digit // 36) + (digit % 36)
            total += digit
            factor = 2 if factor == 1 else 1
        expected_idx = (36 - (total % 36)) % 36
        correct_char = _GSTIN_CHARS[expected_idx]
        actual = _GSTIN_CHARS.index(gstin[-1])
        if expected_idx != actual:
            return False, (
                f"GSTIN checksum mismatch — last character should be '{correct_char}', "
                f"not '{gstin[-1]}'. Correct GSTIN: {gstin[:-1]}{correct_char}"
            )
        return True, ""
    except ValueError:
        return False, "GSTIN contains invalid character"


def extract_pan_from_gstin(gstin: str) -> str:
    """Extract embedded PAN — characters 3–12 (index 2:12)."""
    return gstin.strip().upper()[2:12]


def extract_state_code_from_gstin(gstin: str) -> str:
    """Extract state code — first 2 characters."""
    return gstin.strip().upper()[:2]


def get_state_name(state_code: str) -> Optional[str]:
    return STATE_CODE_MAP.get(state_code.strip().upper())


# ── PAN ───────────────────────────────────────────────────────────────────────

_PAN_PATTERN = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]{1}$")

# PAN 4th char meaning
PAN_TYPE_MAP = {
    "P": "Individual",
    "C": "Company",
    "H": "HUF",
    "F": "Firm",
    "A": "AOP",
    "T": "Trust",
    "B": "BOI",
    "L": "Local Authority",
    "J": "Judicial (Artificial)",
    "G": "Government",
}

def validate_pan(pan: Optional[str]) -> tuple[bool, str]:
    """
    Validates PAN format: AAAAA9999A
    4th character indicates entity type.
    """
    if not pan or pan.strip() == "":
        return True, ""

    p = pan.strip().upper()

    if len(p) != 10:
        return False, f"PAN must be exactly 10 characters (got {len(p)})"

    if not _PAN_PATTERN.match(p):
        return False, "Invalid PAN format — expected: ABCDE1234F (5 letters, 4 digits, 1 letter)"

    entity_char = p[3]
    entity_type = PAN_TYPE_MAP.get(entity_char, "Unknown")

    return True, ""   # entity_type info available but not blocking


def get_pan_entity_type(pan: str) -> str:
    return PAN_TYPE_MAP.get(pan[3].upper(), "Unknown") if len(pan) >= 4 else "Unknown"


# ── CIN ───────────────────────────────────────────────────────────────────────

_CIN_PATTERN = re.compile(r"^[UL][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$")

# Company types that REQUIRE CIN
CIN_REQUIRED_TYPES = {"Pvt Ltd", "Private Limited", "Limited", "Public Ltd", "LLP"}

def validate_cin(cin: Optional[str], company_type: Optional[str] = None) -> tuple[bool, str]:
    """
    Validates CIN format and enforces mandatory rule for Pvt Ltd / Limited companies.
    CIN format: U74999MH2000PTC126385 (21 chars)
      U/L = Listed/Unlisted
      5 digits = NIC activity code
      2 letters = state code
      4 digits = year of incorporation
      3 letters = ownership type (PTC, GOI, NPL etc.)
      6 digits = registration number
    """
    if company_type and company_type in CIN_REQUIRED_TYPES:
        if not cin or cin.strip() == "":
            return False, f"CIN Number is mandatory for {company_type} companies"

    if not cin or cin.strip() == "":
        return True, ""

    c = cin.strip().upper()

    if len(c) != 21:
        return False, f"CIN must be exactly 21 characters (got {len(c)})"

    if not _CIN_PATTERN.match(c):
        return False, "Invalid CIN format — expected: U74999MH2000PTC126385"

    return True, ""


# ── GSTIN State vs Supplier State Consistency ─────────────────────────────────

def validate_gstin_state_match(gstin: str, supplier_state_code: str) -> tuple[bool, str]:
    """
    Check if GSTIN state code matches the supplier's registered state.
    """
    if not gstin or not supplier_state_code:
        return True, ""
    gstin_state = extract_state_code_from_gstin(gstin)
    if gstin_state != supplier_state_code.strip():
        gstin_state_name = STATE_CODE_MAP.get(gstin_state, gstin_state)
        supplier_state_name = STATE_CODE_MAP.get(supplier_state_code, supplier_state_code)
        return False, (
            f"GSTIN State Code '{gstin_state}' ({gstin_state_name}) does not match "
            f"selected state '{supplier_state_code}' ({supplier_state_name})"
        )
    return True, ""
