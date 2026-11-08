"""Mail Intel Core Module - Pure Python execution engine for Home Assistant.

Handles IMAP email polling across multiple accounts, USPS Informed Delivery image extraction,
package notification scraping, Gemini AI structured extraction & cross-account correlation,
rule-based fallbacks, 17Track integration hooks, and SQLite database persistence.
"""

import os
import sys
import re
import json
import ssl
import imaplib
import email
import email.utils
import email.header
from email.header import decode_header
from html.parser import HTMLParser
import struct
import sqlite3
import datetime
from datetime import datetime as dt, date, timedelta
import urllib.request
import urllib.error
import shutil
import logging

_LOGGER = logging.getLogger("mail_intel")

DB_PATH = "/config/mail_intel/mail_intel.db"
USPS_WWW_DIR = "/config/www/mail_intel/usps"
CONFIG_ENTRIES_PATH = "/config/.storage/core.config_entries"
SECRETS_PATH = "/config/secrets.yaml"

STATUS_RANK = {
    "delivered": 4,
    "delivering_today": 3,
    "exception": 2,
    "in_transit": 1,
    "unknown": 0
}

BLACKLIST_SENDERS = [
    "deals@da.slickdeals.net", "slickdeals.net", "petsmart@mail.petsmart.com",
    "hello@yaycoloringpages", "cash@square.com", "instagram.com", "spotify.com",
    "goldencorral.net", "qemailserver.com"
]

SENSITIVE_KEYWORDS = [
    "vaginal", "pelvic", "kegel", "tightening", "perineal", "dilator",
    "vibrat", "dildo", "intimate", "erotic", "adult toy", "lingerie",
    "lubricant", "lube", "prostate", "bdsm", "sensual", "contraceptive",
    "pregnancy test", "hemorrhoid", "incontinence", "enema", "suppository",
    "menstrual", "speculum", "pessary"
]


def is_sensitive_text(text):
    """Check if text contains any sensitive keyword (case-insensitive)."""
    if not text:
        return False
    t_lower = str(text).lower()
    return any(k in t_lower for k in SENSITIVE_KEYWORDS)


def sanitize_sensitive_item(items_summary, merchant=None):
    """Sanitize sensitive, medical, intimate, or adult keywords from items_summary and merchant.

    If item title or sender contains sensitive keywords:
    - If paired with non-sensitive items in the same shipment, redact sensitive item to 'Health & Personal Care Item'.
    - If only sensitive items or single item, replace with 'Health & Personal Care'.
    """
    clean_merchant = merchant
    if merchant and is_sensitive_text(merchant):
        clean_merchant = "Health & Personal Care"

    if not items_summary:
        if clean_merchant == "Health & Personal Care":
            return "Health & Personal Care", clean_merchant
        return items_summary, clean_merchant

    merchant_is_sensitive = (clean_merchant == "Health & Personal Care") or (merchant and is_sensitive_text(merchant))
    summary_is_sensitive = is_sensitive_text(items_summary)

    if not summary_is_sensitive and not merchant_is_sensitive:
        return items_summary, clean_merchant

    raw_parts = [p.strip() for p in str(items_summary).split(",") if p.strip()]

    if len(raw_parts) <= 1:
        return "Health & Personal Care", clean_merchant

    variant_regex = re.compile(
        r"^(?:[A-Za-z0-9_/\s\-]+(?:function|mode|size|color|qty|piece|pack|set|plug|voltage|standard|version)[\w\s\(\)\-]*|\w+\s*\([\w\s]+\)\s*(?:x\d+)?|x\d+|color\s*:|size\s*:)",
        re.IGNORECASE
    )

    clean_parts = []
    i = 0
    while i < len(raw_parts):
        part = raw_parts[i]
        if is_sensitive_text(part):
            while (i + 1 < len(raw_parts)) and (
                variant_regex.match(raw_parts[i + 1]) or
                (len(raw_parts[i + 1].split()) <= 3 and not any(w in raw_parts[i + 1].lower() for w in ["bottle", "cable", "case", "tool", "charger", "plug", "shirt", "pant", "shoe", "bag"]))
            ):
                i += 1
            clean_parts.append("Health & Personal Care Item")
        else:
            clean_parts.append(part)
        i += 1

    non_sensitive = [p for p in clean_parts if p != "Health & Personal Care Item" and not is_sensitive_text(p)]

    if not non_sensitive:
        return "Health & Personal Care", clean_merchant

    final_parts = []
    hpc_added = False
    for p in clean_parts:
        if p == "Health & Personal Care Item":
            if not hpc_added:
                final_parts.append(p)
                hpc_added = True
        else:
            final_parts.append(p)

    return ", ".join(final_parts), clean_merchant


# ==============================================================================
# Helper Utilities: HTML Parsing, Strings, Images, Config
# ==============================================================================

class CleanTextExtractor(HTMLParser):
    """HTML parser that ignores scripts, styles, and extracts plain text."""
    def __init__(self):
        super().__init__()
        self.result = []
        self.in_skip = False

    def handle_starttag(self, tag, attrs):
        if tag.lower() in ("style", "script", "head"):
            self.in_skip = True

    def handle_endtag(self, tag):
        if tag.lower() in ("style", "script", "head"):
            self.in_skip = False

    def handle_data(self, d):
        if not self.in_skip:
            s = d.strip().replace("\u200c", "").replace("\u200b", "")
            if s:
                self.result.append(s)

    def get_text(self):
        return " ".join(self.result)


def get_clean_body_text(msg):
    """Extract and sanitize plain text from an email message, skipping HTML head/style/scripts."""
    text_parts = []
    for part in msg.walk():
        ctype = part.get_content_type()
        if ctype in ("text/plain", "text/html"):
            payload = part.get_payload(decode=True)
            if payload:
                charset = part.get_content_charset() or "utf-8"
                raw_str = payload.decode(charset, errors="ignore")
                if ctype == "text/html":
                    parser = CleanTextExtractor()
                    try:
                        parser.feed(raw_str)
                        text_parts.append(parser.get_text())
                    except Exception:
                        clean_regex = re.sub(r"<[^>]+>", " ", raw_str)
                        text_parts.append(" ".join(clean_regex.split()))
                else:
                    text_parts.append(" ".join(raw_str.split()))
    return " ".join(text_parts)


def decode_mime_str(s):
    """Safely decode RFC2047 MIME encoded headers."""
    if not s:
        return ""
    result = ""
    try:
        pieces = decode_header(s)
        for piece, enc in pieces:
            if isinstance(piece, bytes):
                result += piece.decode(enc or "utf-8", errors="ignore")
            else:
                result += str(piece)
    except Exception:
        result = str(s)
    return result.strip()


def parse_email_date_and_ts(msg, header_date=""):
    """Parse email Date header into YYYY-MM-DD string and epoch timestamp."""
    d_raw = msg.get("Date") or header_date
    date_str = dt.now().strftime("%Y-%m-%d")
    ts = 0
    if d_raw:
        try:
            parsed = email.utils.parsedate_tz(d_raw)
            if parsed:
                ts = email.utils.mktime_tz(parsed)
                date_str = dt.fromtimestamp(ts).strftime("%Y-%m-%d")
        except Exception:
            pass
    return date_str, ts


def get_image_size(data):
    """Determine width and height of JPEG, PNG, or GIF bytes without external libraries."""
    if not data or len(data) < 24:
        return None
    # PNG: 89 50 4E 47 0D 0A 1A 0A
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        w, h = struct.unpack(">II", data[16:24])
        return int(w), int(h)
    # GIF: GIF87a or GIF89a
    elif data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        w, h = struct.unpack("<HH", data[6:10])
        return int(w), int(h)
    # JPEG / JFIF
    elif data.startswith(b"\xff\xd8"):
        offset = 2
        length = len(data)
        while offset < length:
            if data[offset] != 0xFF:
                offset += 1
                continue
            marker = data[offset + 1]
            offset += 2
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                if offset + 7 <= length:
                    h, w = struct.unpack(">HH", data[offset + 3:offset + 7])
                    return int(w), int(h)
                break
            elif marker in (0xD9, 0xDA):
                break
            else:
                if offset + 2 <= length:
                    segment_len = struct.unpack(">H", data[offset:offset + 2])[0]
                    offset += segment_len
                else:
                    break
    return None


def get_imap_accounts():
    """Extract the 3 existing mail_and_packages IMAP account credentials from core.config_entries."""
    accounts = []
    if not os.path.exists(CONFIG_ENTRIES_PATH):
        _LOGGER.warning("Config entries path %s does not exist", CONFIG_ENTRIES_PATH)
        return accounts

    try:
        with open(CONFIG_ENTRIES_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        entries = data.get("data", {}).get("entries", [])
        for entry in entries:
            if entry.get("domain") == "mail_and_packages":
                entry_data = entry.get("data", {})
                user = entry_data.get("username")
                pwd = entry_data.get("password")
                if user and pwd:
                    accounts.append({
                        "username": user,
                        "password": pwd,
                        "host": entry_data.get("host", "imap.gmail.com"),
                        "port": int(entry_data.get("port", 993)),
                        "folder": entry_data.get("folder", "INBOX"),
                        "ssl": entry_data.get("ssl", True)
                    })
    except Exception as e:
        _LOGGER.error("Failed to read IMAP accounts from config entries: %s", e)

    return accounts


def get_gemini_api_key():
    """Read gemini_api_key from environment variable or /config/secrets.yaml."""
    env_key = os.environ.get("GEMINI_API_KEY")
    if env_key:
        return env_key.strip()
    if not os.path.exists(SECRETS_PATH):
        return None
    try:
        with open(SECRETS_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("gemini_api_key:"):
                    return line.split(":", 1)[1].strip().strip("\"'")
    except Exception as e:
        _LOGGER.error("Failed to read gemini_api_key from %s: %s", SECRETS_PATH, e)
    return None


# ==============================================================================
# Database Initialization & Migration
# ==============================================================================

def get_db_connection():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Ensure SQLite database schema is created and upgraded."""
    conn = get_db_connection()
    c = conn.cursor()

    c.execute("""
        CREATE TABLE IF NOT EXISTS mailpieces (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            account_email TEXT NOT NULL,
            image_url TEXT NOT NULL,
            filename TEXT NOT NULL,
            width INTEGER,
            height INTEGER,
            created_at TEXT NOT NULL
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_mailpieces_date ON mailpieces(date)")

    c.execute("""
        CREATE TABLE IF NOT EXISTS packages (
            tracking_number TEXT PRIMARY KEY NOT NULL,
            carrier TEXT NOT NULL,
            tracking_url TEXT,
            status TEXT NOT NULL,
            expected_date TEXT,
            delivered_date TEXT,
            merchant_or_sender TEXT,
            raw_sender TEXT,
            items_summary TEXT,
            order_total TEXT,
            source_emails TEXT,
            correlation_note TEXT,
            matched_receipts TEXT,
            is_masked INTEGER DEFAULT 0,
            is_hidden INTEGER DEFAULT 0,
            last_updated TEXT NOT NULL
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_packages_status ON packages(status)")

    # Ensure is_masked and is_hidden columns exist
    c.execute("PRAGMA table_info(packages)")
    cols = [r["name"] for r in c.fetchall()]
    if "is_masked" not in cols:
        c.execute("ALTER TABLE packages ADD COLUMN is_masked INTEGER DEFAULT 0")
    if "is_hidden" not in cols:
        c.execute("ALTER TABLE packages ADD COLUMN is_hidden INTEGER DEFAULT 0")

    c.execute("""
        CREATE TABLE IF NOT EXISTS receipts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_email TEXT NOT NULL,
            imap_uid TEXT NOT NULL,
            order_id TEXT,
            merchant TEXT,
            items TEXT,
            total TEXT,
            date TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_receipts_order ON receipts(order_id)")

    c.execute("""
        CREATE TABLE IF NOT EXISTS processed_emails (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_email TEXT NOT NULL,
            imap_uid TEXT NOT NULL,
            subject TEXT,
            from_address TEXT,
            date TEXT NOT NULL,
            processed_at TEXT NOT NULL,
            UNIQUE(account_email, imap_uid)
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_processed_emails_uid ON processed_emails(account_email, imap_uid)")

    # Clean existing packages: sanitize sensitive terms
    c.execute("SELECT tracking_number, items_summary, merchant_or_sender FROM packages")
    for row in c.fetchall():
        t_num = row["tracking_number"]
        itm = row["items_summary"]
        merch = row["merchant_or_sender"]
        s_itm, s_merch = sanitize_sensitive_item(itm, merch)
        if s_itm != itm or s_merch != merch:
            c.execute("UPDATE packages SET items_summary = ?, merchant_or_sender = ? WHERE tracking_number = ?",
                      (s_itm, s_merch, t_num))

    # Run deduplication pass on ALI- placeholders
    deduplicate_packages(conn)

    # Transition past-date delivering_today packages
    today_str = dt.now().strftime("%Y-%m-%d")
    c.execute("SELECT tracking_number, carrier, merchant_or_sender, expected_date, last_updated FROM packages WHERE status = 'delivering_today'")
    for row in c.fetchall():
        exp_d = row["expected_date"]
        t_num = row["tracking_number"]
        if exp_d and exp_d < today_str:
            carrier_str = ((row["carrier"] or "") + " " + (row["merchant_or_sender"] or "")).lower()
            if "usps" in carrier_str:
                c.execute("UPDATE packages SET status = 'delivered', delivered_date = ?, last_updated = ? WHERE tracking_number = ?",
                          (exp_d, dt.now().isoformat(), t_num))
            else:
                c.execute("UPDATE packages SET status = 'in_transit', last_updated = ? WHERE tracking_number = ?",
                          (dt.now().isoformat(), t_num))

    conn.commit()
    conn.close()


def deduplicate_packages(conn):
    """Merge duplicate packages (such as AliExpress ALI-<order_id> merged with carrier tracking number)."""
    c = conn.cursor()
    c.execute("SELECT * FROM packages")
    rows = [dict(r) for r in c.fetchall()]

    ali_rows = [r for r in rows if str(r.get("tracking_number", "")).startswith("ALI-")]
    carrier_rows = [r for r in rows if not str(r.get("tracking_number", "")).startswith("ALI-")]

    for a_pkg in ali_rows:
        a_track = a_pkg["tracking_number"]
        a_ord = a_track[4:]
        a_items = (a_pkg.get("items_summary") or "").strip().lower()

        matched_carrier_pkg = None
        for c_pkg in carrier_rows:
            c_items = (c_pkg.get("items_summary") or "").strip().lower()
            # Match by order ID in carrier tracking or identical/substring item summary
            if a_ord and a_ord in str(c_pkg.get("tracking_number", "")):
                matched_carrier_pkg = c_pkg
                break
            if a_items and c_items and (
                a_items == c_items or
                (len(a_items) > 15 and a_items[:25] in c_items) or
                (len(c_items) > 15 and c_items[:25] in a_items) or
                "dropper bottl" in a_items and "dropper bottl" in c_items
            ):
                matched_carrier_pkg = c_pkg
                break

        if matched_carrier_pkg:
            src1 = []
            try:
                src1 = json.loads(matched_carrier_pkg.get("source_emails") or "[]")
            except Exception:
                pass
            try:
                src2 = json.loads(a_pkg.get("source_emails") or "[]")
                src1 = list(set(src1 + src2))
            except Exception:
                pass

            is_masked = 1 if (matched_carrier_pkg.get("is_masked") == 1 or a_pkg.get("is_masked") == 1) else 0
            is_hidden = 1 if (matched_carrier_pkg.get("is_hidden") == 1 or a_pkg.get("is_hidden") == 1) else 0

            # Merge items_summary if the carrier one was generic
            final_items = matched_carrier_pkg.get("items_summary")
            if (not final_items or final_items in ("Delivery Package", "AliExpress Package")) and a_pkg.get("items_summary"):
                final_items = a_pkg.get("items_summary")

            c.execute("""
                UPDATE packages
                SET source_emails = ?,
                    items_summary = ?,
                    is_masked = ?,
                    is_hidden = ?,
                    last_updated = ?
                WHERE tracking_number = ?
            """, (json.dumps(src1), final_items, is_masked, is_hidden, dt.now().isoformat(), matched_carrier_pkg["tracking_number"]))

            c.execute("DELETE FROM packages WHERE tracking_number = ?", (a_track,))
            _LOGGER.info("Merged and deleted redundant placeholder %s into %s", a_track, matched_carrier_pkg["tracking_number"])

    conn.commit()


def toggle_package_mask(package_key):
    """Toggle is_masked flag for a package and immediately return fresh dashboard data."""
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        UPDATE packages
        SET is_masked = CASE WHEN is_masked = 1 THEN 0 ELSE 1 END,
            last_updated = ?
        WHERE tracking_number = ?
    """, (dt.now().isoformat(), str(package_key).strip()))
    conn.commit()
    conn.close()
    return build_dashboard_data()


def hide_package(package_key):
    """Set is_hidden = 1 for a package and immediately return fresh dashboard data."""
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        UPDATE packages
        SET is_hidden = 1,
            last_updated = ?
        WHERE tracking_number = ?
    """, (dt.now().isoformat(), str(package_key).strip()))
    conn.commit()
    conn.close()
    return build_dashboard_data()


def unhide_all_packages():
    """Reset is_hidden = 0 for all packages and immediately return fresh dashboard data."""
    conn = get_db_connection()
    c = conn.cursor()
    c.execute("""
        UPDATE packages
        SET is_hidden = 0,
            last_updated = ?
    """, (dt.now().isoformat(),))
    conn.commit()
    conn.close()
    return build_dashboard_data()


def prune_old_records(days_to_keep=7):
    """Automatically prune USPS mailpieces and folders older than 7 days."""
    cutoff_date = dt.now().date() - timedelta(days=days_to_keep)
    cutoff_str = cutoff_date.strftime("%Y-%m-%d")

    conn = get_db_connection()
    c = conn.cursor()
    c.execute("DELETE FROM mailpieces WHERE date < ?", (cutoff_str,))
    deleted = c.rowcount
    conn.commit()
    conn.close()

    if deleted > 0:
        _LOGGER.info("Pruned %d USPS mailpiece records older than %s", deleted, cutoff_str)

    if os.path.exists(USPS_WWW_DIR):
        for entry in os.listdir(USPS_WWW_DIR):
            folder_path = os.path.join(USPS_WWW_DIR, entry)
            if os.path.isdir(folder_path):
                if re.match(r"^\d{4}-\d{2}-\d{2}$", entry):
                    if entry < cutoff_str:
                        try:
                            shutil.rmtree(folder_path)
                            _LOGGER.info("Pruned old USPS image folder: %s", folder_path)
                        except Exception as e:
                            _LOGGER.error("Failed to delete old folder %s: %s", folder_path, e)


# ==============================================================================
# Tracking Number Normalization & Carrier Detection
# ==============================================================================

def normalize_tracking_number(carrier, tracking_num):
    """Normalize USPS routing prefixes (420+zip) to canonical tracking numbers."""
    if not tracking_num:
        return ""
    t = str(tracking_num).strip().upper()
    # If 420 followed by 5-digit zip and a 20-30 digit USPS number, strip 420+zip
    m = re.match(r"^420\d{5}(9\d{21})$", t)
    if m:
        return m.group(1)
    return t


def generate_tracking_url(carrier, tracking_num):
    """Generate carrier tracking URL."""
    if not tracking_num:
        return None
    carrier_upper = (carrier or "").upper()
    t = str(tracking_num).strip()

    if "USPS" in carrier_upper:
        clean_num = normalize_tracking_number("USPS", t)
        return f"https://tools.usps.com/go/TrackConfirmAction?tLabels={clean_num}"
    elif "UPS" in carrier_upper:
        return f"https://www.ups.com/track?tracknum={t}"
    elif "FEDEX" in carrier_upper:
        return f"https://www.fedex.com/fedextrack/?trknbr={t}"
    elif "DHL" in carrier_upper:
        return f"https://www.dhl.com/en/express/tracking.html?AWB={t}"
    elif "AMAZON" in carrier_upper:
        if t.startswith("TB") or re.match(r"^\d{3}-\d{7}-\d{7}$", t):
            return f"https://www.amazon.com/progress-tracker/package/ref=ppx_yo_dt_b_track_package?orderId={t}"
        return "https://www.amazon.com/gp/your-account/order-history"
    elif "ALIEXPRESS" in carrier_upper or "CAINIAO" in carrier_upper:
        return f"https://global.cainiao.com/newDetail.htm?mailNoList={t}"
    elif "ONTRAC" in carrier_upper:
        return f"https://www.ontrac.com/tracking/?number={t}"
    elif "LASERSHIP" in carrier_upper:
        return f"https://www.lasership.com/track/{t}"
    else:
        return f"https://t.17track.net/en#nums={t}"


def detect_carrier_and_tracking(text):
    """Extract carrier and tracking number using strict regex."""
    if not text:
        return []
    results = []

    # UPS: 1Z...
    for m in re.finditer(r"\b(1Z[0-9A-Z]{16})\b", text, re.IGNORECASE):
        results.append(("UPS", m.group(1).upper()))

    # USPS: standard barcodes
    for m in re.finditer(r"\b(9[1-5]\d{20,26})\b", text):
        results.append(("USPS", m.group(1)))
    for m in re.finditer(r"\b(420\d{5}(9[1-5]\d{20,26}))\b", text):
        results.append(("USPS", m.group(2)))
    for m in re.finditer(r"\b([A-Z]{2}\d{9}US)\b", text):
        results.append(("USPS", m.group(1).upper()))

    # FedEx: 12, 15, or 20 digits, often starting with 96, 7489, etc.
    for m in re.finditer(r"\b(7489\d{16}|6129\d{16}|96\d{20})\b", text):
        results.append(("FedEx", m.group(1)))
    for m in re.finditer(r"\b(\d{12})\b", text):
        span = m.span()
        context = text[max(0, span[0] - 40) : min(len(text), span[1] + 40)].lower()
        if "fedex" in context:
            results.append(("FedEx", m.group(1)))

    # Amazon TBA
    for m in re.finditer(r"\b(TBA\d{12,18}|TBC\d{12,18}|TBM\d{12,18})\b", text, re.IGNORECASE):
        results.append(("Amazon", m.group(1).upper()))

    # AliExpress / Cainiao
    for m in re.finditer(r"\b(1MCAINI[0-9A-Z]+|LP\d{14}|[A-Z]{2}\d{9}[A-Z]{2})\b", text, re.IGNORECASE):
        results.append(("Cainiao", m.group(1).upper()))
    for m in re.finditer(r"\b(420\d{26,30})\b", text):
        norm = normalize_tracking_number("USPS", m.group(1))
        results.append(("AliExpress (USPS)", norm))

    seen = set()
    dedup = []
    for c, t in results:
        if t not in seen:
            seen.add(t)
            dedup.append((c, t))
    return dedup


# ==============================================================================
# USPS Informed Delivery Mailpiece Filter & Saver
# ==============================================================================

def is_usps_mailpiece(filename, cid, payload_bytes):
    """Accurately distinguishes actual scanned mailpieces from promotional ride-alongs and USPS logos."""
    if not payload_bytes:
        return False

    name_lower = (filename or "").lower()
    cid_lower = (cid or "").lower()

    blacklist_words = [
        "mailer-", "content-", "banner", "logo", "icon", "social", "ridealong",
        "ride-along", "campaign-ridealong", "facebook", "twitter", "instagram",
        "youtube", "app-btn", "apple", "google", "button", "footer", "header",
        "spacer", "pixel", "tracking", "transparent", "refer-friends"
    ]
    for b in blacklist_words:
        if b in name_lower or b in cid_lower:
            return False

    dims = get_image_size(payload_bytes)
    if not dims:
        return False
    w, h = dims

    if w < 350 or h < 160:
        return False
    ratio = w / float(h)
    if ratio < 1.25 or ratio > 3.4:
        return False

    if re.match(r"^\d{8,}-\d{3}\.jpe?g$", name_lower):
        return True
    if "mailpiece" in name_lower or "mailpiece" in cid_lower:
        return True

    return True


def process_usps_digest_email(msg, account_email, email_date_str):
    """Extract individual mailpiece images from USPS Informed Delivery digest."""
    subject = decode_mime_str(msg.get("Subject", ""))
    target_date = email_date_str

    sub_match = re.search(r"for\s+(?:[A-Za-z]+,\s+)?(\d{1,2}/\d{1,2})", subject, re.IGNORECASE)
    if sub_match:
        try:
            m_part = sub_match.group(1)
            parsed_d = dt.strptime(f"{dt.now().year}/{m_part}", "%Y/%m/%d").date()
            target_date = parsed_d.strftime("%Y-%m-%d")
        except Exception:
            pass

    out_dir = os.path.join(USPS_WWW_DIR, target_date)
    os.makedirs(out_dir, exist_ok=True)

    mailpiece_images = []
    for part in msg.walk():
        ctype = part.get_content_type()
        if "image" in ctype:
            payload = part.get_payload(decode=True)
            fname = part.get_filename() or ""
            cid = part.get("Content-ID", "").strip("<>")
            if is_usps_mailpiece(fname, cid, payload):
                dims = get_image_size(payload) or (0, 0)
                mailpiece_images.append({
                    "bytes": payload,
                    "filename": fname or f"mailpiece_{len(mailpiece_images)+1}.jpg",
                    "width": dims[0],
                    "height": dims[1]
                })

    conn = get_db_connection()
    c = conn.cursor()
    c.execute("SELECT count(*) as cnt FROM mailpieces WHERE date = ? AND account_email = ?", (target_date, account_email))
    existing_count = c.fetchone()["cnt"]

    if existing_count == 0 and mailpiece_images:
        for idx, item in enumerate(mailpiece_images, start=1):
            out_filename = f"mailpiece_{idx}.jpg"
            save_path = os.path.join(out_dir, out_filename)
            try:
                with open(save_path, "wb") as f:
                    f.write(item["bytes"])
                local_url = f"/local/mail_intel/usps/{target_date}/{out_filename}"
                c.execute("""
                    INSERT INTO mailpieces (date, account_email, image_url, filename, width, height, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (target_date, account_email, local_url, out_filename, item["width"], item["height"], dt.now().isoformat()))
            except Exception as e:
                _LOGGER.error("Failed to save mailpiece %s: %s", save_path, e)

    conn.commit()
    conn.close()


# ==============================================================================
# Helper Extractors for AliExpress and UPS
# ==============================================================================

def extract_aliexpress_items(body):
    """Extract item names and counts from AliExpress notification emails."""
    clean = (body or "").replace("\u200c", "").replace("\u200b", "")
    m = re.search(r"Package details\s*\.\s*(.*?)\s*\.\s*Ship to", clean, re.IGNORECASE)
    if not m:
        m = re.search(r"Track (?:order|delivery)\s*\.\s*(.*?)\s*(?:Ship to|Order total|See order details)", clean, re.IGNORECASE)
    if m:
        chunk = m.group(1)
        parts = [p.strip(" .") for p in re.split(r"\s*\.\s*", chunk) if p.strip(" .")]
        valid = [p for p in parts if len(p) > 4 and not any(k in p.lower() for k in [
            "fast delivery", "free returns", "click", "check details", "enjoy your", "we hope", "please note"
        ])]
        if valid:
            return ", ".join(valid[:3])
    return None


def extract_ups_merchant(body):
    """Extract sender merchant from UPS notification emails (e.g. 'THE WORKS')."""
    m = re.search(r"From\s+([A-Z0-9\s&,.-]{2,30}?)\s+(?:Delivered|Track|Shipped)", body or "")
    if m:
        cand = m.group(1).strip()
        if cand and len(cand) > 2 and "table" not in cand.lower():
            return cand
    return "UPS Delivery"


def extract_ups_delivery_date(body, default_date):
    """Extract delivery date from UPS delivered notification body."""
    m = re.search(r"Delivered\s+[A-Za-z]+,?\s+(\d{1,2}/\d{1,2}/\d{2,4})", body or "")
    if m:
        try:
            raw_d = m.group(1)
            parts = raw_d.split("/")
            year = parts[2]
            if len(year) == 2:
                year = f"20{year}"
            return f"{int(year):04d}-{int(parts[0]):02d}-{int(parts[1]):02d}"
        except Exception:
            pass
    return default_date


# ==============================================================================
# Gemini AI & Cross-Email Correlation Engine
# ==============================================================================

def call_gemini_api(api_key, new_emails_data, active_packages, recent_receipts):
    """Call Google Gemini API with structured JSON output for extraction and cross-account correlation."""
    if not api_key:
        return None

    models = ["gemini-2.5-flash", "gemini-3.8-flash", "gemini-flash-latest"]
    prompt = f"""
You are the AI engine for Home Assistant Smart Mail & Package Correlation.
Today's local date is: {dt.now().strftime('%Y-%m-%d')}.

You are given:
1. NEW UNSEEN EMAILS across 3 monitored accounts:
{json.dumps(new_emails_data, indent=2)}

2. ACTIVE RECENT PACKAGES already in SQLite (last 14 days):
{json.dumps(active_packages, indent=2)}

3. RECENT RECEIPTS & ORDERS already in SQLite (last 14 days):
{json.dumps(recent_receipts, indent=2)}

STRICT RULES:
1. NEVER classify an email with merchant 'Amazon' unless the sender is genuinely from '@amazon.com', '@amazon.ca', or contains a 'TBA...' tracking number.
2. Completely IGNORE promotional emails, deal alerts (e.g. Slickdeals), safety notices, or review requests.
3. For AliExpress emails, identify carrier ('Cainiao', 'AliExpress (USPS)'), extract specific item titles, and record order numbers.
4. For UPS and Amazon emails, identify delivered packages and do not downgrade delivered packages to in_transit.

Return a JSON object conforming exactly to this schema:
{{
  "packages": [
    {{
      "tracking_number": "string",
      "carrier": "string",
      "tracking_url": "string or null",
      "status": "delivering_today | in_transit | delivered | exception",
      "expected_date": "YYYY-MM-DD or null",
      "delivered_date": "YYYY-MM-DD or null",
      "merchant_or_sender": "string",
      "raw_sender": "string",
      "items_summary": "string",
      "order_total": "string or null",
      "source_emails": ["email1", "email2"],
      "correlation_note": "string or null"
    }}
  ],
  "receipts": [
    {{
      "account_email": "string",
      "imap_uid": "string",
      "order_id": "string",
      "merchant": "string",
      "items": "string",
      "total": "string or null",
      "date": "YYYY-MM-DD"
    }}
  ]
}}
"""

    req_payload = {
        "contents": [
            {
                "parts": [{"text": prompt}]
            }
        ],
        "generationConfig": {
            "response_mime_type": "application/json"
        }
    }

    for model in models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        req = urllib.request.Request(
            url,
            data=json.dumps(req_payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "X-goog-api-key": api_key
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=25) as resp:
                res_json = json.loads(resp.read().decode("utf-8"))
                text_content = res_json["candidates"][0]["content"]["parts"][0]["text"]
                return json.loads(text_content)
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            _LOGGER.warning("Gemini API %s error (HTTP %d): %s", model, e.code, err_body[:160])
        except Exception as e:
            _LOGGER.warning("Gemini API %s failed: %s", model, e)

    return None


def rule_based_fallback_extract(email_item):
    """High-precision rule-based extraction fallback for shipping emails and receipts."""
    account = email_item.get("account_email", "")
    sub = email_item.get("subject", "")
    frm = email_item.get("from_address", "")
    body = email_item.get("body", "")
    msg_date = email_item.get("date_str", dt.now().strftime("%Y-%m-%d"))
    ts = email_item.get("timestamp", 0)

    frm_lower = frm.lower()
    sub_lower = sub.lower()
    body_clean = body

    # 0. Blacklist / promotional filter
    if any(b in frm_lower for b in BLACKLIST_SENDERS):
        return [], []

    extracted_packages = []
    extracted_receipts = []

    # 1. Amazon Validation & Extraction
    is_amazon_domain = any(d in frm_lower for d in ["@amazon.com", "@amazon.ca", "@amazon.co.uk"])
    has_tba = bool(re.search(r"\b(TBA\d{12,18})\b", body, re.IGNORECASE))
    if is_amazon_domain or has_tba:
        ignored_patterns = [
            "safety notice", "review it on", "meet your expectations",
            "replace the air filters", "air filters on thermostat",
            "password assistance", "sign-in attempt", "household",
            "subscribe & save", "recommendation for"
        ]
        if any(p in sub_lower or p in frm_lower for p in ignored_patterns):
            return [], []

        ord_m = re.search(r"\b(\d{3}-\d{7}-\d{7})\b", f"{sub} {body}")
        order_id = ord_m.group(1) if ord_m else None

        # Check receipt
        if any(k in sub_lower for k in ["ordered ", "order confirmed", "your amazon.com order of"]):
            tot_m = re.search(r"\$(\d+(?:\.\d{2})?)", body)
            items_m = re.search(r"Ordered\s+\d+\s+item[s]?:\s*([^<\n\r]+)", sub, re.IGNORECASE)
            items_name = items_m.group(1).strip() if items_m else (sub.split(":", 1)[-1].strip() if ":" in sub else "Amazon Order")
            extracted_receipts.append({
                "account_email": account,
                "imap_uid": email_item.get("imap_uid", ""),
                "order_id": order_id or sub[:30],
                "merchant": "Amazon",
                "items": items_name,
                "total": f"${tot_m.group(1)}" if tot_m else None,
                "date": msg_date
            })
            return extracted_packages, extracted_receipts

        # Check shipment
        is_shipment = any(k in sub_lower for k in ["shipped ", "out for delivery", "delivered ", "delay in shipping:"]) or \
                      any(k in body_clean.lower() for k in ["package was shipped", "package is out for delivery", "package was delivered"])

        if is_shipment and (order_id or has_tba):
            status = "in_transit"
            delivered_date = None
            if "delivered" in sub_lower or "package was delivered" in body_clean.lower():
                status = "delivered"
                delivered_date = msg_date
            elif "out for delivery" in sub_lower or "is out for delivery" in body_clean.lower():
                status = "delivering_today"

            items_m = re.search(r"(?:Delivered|Shipped|Out for delivery|Ordered)\s+\d+\s+item[s]?:\s*([^<\n\r]+)", sub, re.IGNORECASE)
            items_summary = items_m.group(1).strip() if items_m else "Amazon Order"

            tba_m = re.search(r"\b(TBA\d{12,18})\b", body, re.IGNORECASE)
            track_num = tba_m.group(1).upper() if tba_m else order_id

            extracted_packages.append({
                "tracking_number": track_num,
                "carrier": "Amazon",
                "tracking_url": generate_tracking_url("Amazon", track_num),
                "order_id": order_id,
                "status": status,
                "delivered_date": delivered_date,
                "expected_date": msg_date if status == "delivering_today" else None,
                "merchant_or_sender": "Amazon",
                "raw_sender": frm,
                "items_summary": items_summary,
                "order_total": None,
                "source_emails": [account],
                "correlation_note": None,
                "email_date": msg_date,
                "timestamp": ts
            })
            return extracted_packages, extracted_receipts

        return [], []

    # 2. AliExpress Validation & Extraction
    is_ali = "@notice.aliexpress.com" in frm_lower or "@aliexpress.com" in frm_lower or "cainiao" in frm_lower or "aliexpress" in frm_lower
    if is_ali:
        if any(k in sub_lower for k in ["you have messages", "flash deals", "coupon"]):
            return [], []

        ord_m = re.search(r"\b(821\d{13}|\d{16})\b", f"{sub} {body_clean}")
        order_id = ord_m.group(1) if ord_m else None

        if "order confirmed" in sub_lower or "your order is confirmed" in sub_lower:
            tot_m = re.search(r"\$(\d+(?:\.\d{2})?)", body_clean)
            item_name = extract_aliexpress_items(body_clean) or "AliExpress Order"
            extracted_receipts.append({
                "account_email": account,
                "imap_uid": email_item.get("imap_uid", ""),
                "order_id": order_id or sub[:30],
                "merchant": "AliExpress",
                "items": item_name,
                "total": f"${tot_m.group(1)}" if tot_m else None,
                "date": msg_date
            })
            return extracted_packages, extracted_receipts

        cainiao_m = re.search(r"\b(1MCAINI[0-9A-Z]+|LP\d{14})\b", f"{sub} {body_clean}", re.IGNORECASE)
        usps420_m = re.search(r"\b(420\d{26,30})\b", f"{sub} {body_clean}")
        track_num = None
        carrier = "AliExpress"
        if cainiao_m:
            track_num = cainiao_m.group(1).upper()
            carrier = "Cainiao"
        elif usps420_m:
            track_num = normalize_tracking_number("USPS", usps420_m.group(1))
            carrier = "AliExpress (USPS)"
        elif order_id:
            track_num = f"ALI-{order_id}"

        if track_num:
            status = "in_transit"
            delivered_date = None
            if "delivered" in sub_lower or "has been successfully delivered" in body_clean.lower():
                status = "delivered"
                delivered_date = msg_date
            elif "out for delivery" in sub_lower or "is out for delivery" in body_clean.lower():
                status = "delivering_today"

            items_summary = extract_aliexpress_items(body_clean) or "AliExpress Package"
            extracted_packages.append({
                "tracking_number": track_num,
                "carrier": carrier,
                "tracking_url": generate_tracking_url(carrier, track_num),
                "order_id": order_id,
                "status": status,
                "delivered_date": delivered_date,
                "expected_date": msg_date if status == "delivering_today" else None,
                "merchant_or_sender": "AliExpress",
                "raw_sender": frm,
                "items_summary": items_summary,
                "order_total": None,
                "source_emails": [account],
                "correlation_note": None,
                "email_date": msg_date,
                "timestamp": ts
            })
            return extracted_packages, extracted_receipts

        return [], []

    # 3. UPS Validation & Extraction
    if "@ups.com" in frm_lower or "mcinfo@ups.com" in frm_lower:
        if any(k in sub_lower for k in ["expiration alert", "changes to your"]):
            return [], []
        ups_m = re.search(r"\b(1Z[0-9A-Z]{16})\b", f"{sub} {body_clean}", re.IGNORECASE)
        if ups_m:
            track_num = ups_m.group(1).upper()
            status = "in_transit"
            delivered_date = None
            if "was delivered" in sub_lower or "package was delivered" in body_clean.lower():
                status = "delivered"
                delivered_date = extract_ups_delivery_date(body_clean, msg_date)
            elif "delivery today" in sub_lower or "scheduled for delivery today" in body_clean.lower():
                status = "delivering_today"

            merchant = extract_ups_merchant(body_clean)
            extracted_packages.append({
                "tracking_number": track_num,
                "carrier": "UPS",
                "tracking_url": generate_tracking_url("UPS", track_num),
                "order_id": None,
                "status": status,
                "delivered_date": delivered_date,
                "expected_date": msg_date if status == "delivering_today" else None,
                "merchant_or_sender": merchant,
                "raw_sender": frm,
                "items_summary": "Delivery Package",
                "order_total": None,
                "source_emails": [account],
                "correlation_note": None,
                "email_date": msg_date,
                "timestamp": ts
            })
            return extracted_packages, extracted_receipts
        return [], []

    # 4. USPS Validation & Extraction
    if "@tracking.usps.com" in frm_lower or "auto-reply@tracking.usps.com" in frm_lower:
        usps_m = re.search(r"\b(9[1-5]\d{20,26}|420\d{5}(9[1-5]\d{20,26}))\b", f"{sub} {body_clean}")
        if usps_m:
            track_num = usps_m.group(2) if usps_m.group(2) else usps_m.group(1)
            status = "in_transit"
            delivered_date = None
            if "delivered" in sub_lower or "delivered" in body_clean.lower():
                status = "delivered"
                delivered_date = msg_date
            elif "out for delivery" in sub_lower or "out for delivery" in body_clean.lower():
                status = "delivering_today"

            extracted_packages.append({
                "tracking_number": track_num,
                "carrier": "USPS",
                "tracking_url": generate_tracking_url("USPS", track_num),
                "order_id": None,
                "status": status,
                "delivered_date": delivered_date,
                "expected_date": msg_date if status == "delivering_today" else None,
                "merchant_or_sender": "USPS Delivery",
                "raw_sender": frm,
                "items_summary": "Delivery Package",
                "order_total": None,
                "source_emails": [account],
                "correlation_note": None,
                "email_date": msg_date,
                "timestamp": ts
            })
            return extracted_packages, extracted_receipts
        return [], []

    # 5. General Carrier Trackings (e.g. Targil Seasoning, Central Vapors, FedEx)
    carrier_trackings = detect_carrier_and_tracking(f"{sub} {body_clean}")
    for carrier, track_num in carrier_trackings:
        m_name = "Package Delivery"
        if "targil" in frm_lower or "targil" in body_clean.lower():
            m_name = "Targil Seasoning & Butcher Supplies"
        elif "central vapors" in frm_lower or "central vapors" in body_clean.lower():
            m_name = "Central Vapors"
        elif "walmart" in frm_lower:
            m_name = "Walmart"
        elif "target" in frm_lower:
            m_name = "Target"
        elif "home depot" in frm_lower:
            m_name = "Home Depot"

        status = "in_transit"
        delivered_date = None
        if "delivered" in sub_lower or "delivered" in body_clean.lower():
            status = "delivered"
            delivered_date = msg_date
        elif "out for delivery" in sub_lower or "out for delivery" in body_clean.lower():
            status = "delivering_today"

        items_name = "Delivery Package"
        if "targil" in m_name.lower():
            items_name = "Cajun Seasoning & Butcher Supplies"
        elif "central vapors" in m_name.lower():
            items_name = "Vape Supplies"

        extracted_packages.append({
            "tracking_number": track_num,
            "carrier": carrier,
            "tracking_url": generate_tracking_url(carrier, track_num),
            "order_id": None,
            "status": status,
            "delivered_date": delivered_date,
            "expected_date": msg_date if status == "delivering_today" else None,
            "merchant_or_sender": m_name,
            "raw_sender": frm,
            "items_summary": items_name,
            "order_total": None,
            "source_emails": [account],
            "correlation_note": None,
            "email_date": msg_date,
            "timestamp": ts
        })

    return extracted_packages, extracted_receipts


def correlate_packages_with_receipts(packages, receipts):
    """Correlate packages across accounts with receipts by order ID, merchant, items, or total."""
    for pkg in packages:
        m_pkg = (pkg.get("merchant_or_sender") or "").lower()
        items_pkg = (pkg.get("items_summary") or "").lower()
        pkg_ord = pkg.get("order_id")
        src_emails = set(pkg.get("source_emails") or [])

        for rec in receipts:
            rec_ord = rec.get("order_id")
            m_rec = (rec.get("merchant") or "").lower()
            items_rec = (rec.get("items") or "").lower()
            rec_acct = rec.get("account_email")
            rec_total = rec.get("total")
            rec_date = rec.get("date")

            matched = False
            # 1. Exact Order ID match
            if pkg_ord and rec_ord and (pkg_ord == rec_ord or pkg_ord in rec_ord or rec_ord in pkg_ord):
                matched = True
            # 2. Merchant & Items match
            elif m_pkg and m_rec and (m_pkg in m_rec or m_rec in m_pkg):
                if items_pkg and items_rec and any(w in items_rec for w in items_pkg.split() if len(w) > 3):
                    matched = True

            if matched:
                if rec_acct:
                    src_emails.add(rec_acct)
                pkg["source_emails"] = list(src_emails)
                if not pkg.get("order_total") and rec_total:
                    pkg["order_total"] = rec_total
                if not pkg.get("correlation_note"):
                    pkg["correlation_note"] = f"Linked with receipt ({rec_total or 'order'}) to {rec.get('merchant')} on {rec_date} via {rec_acct}"
                break
    return packages


# ==============================================================================
# Full IMAP Sync & SQLite Persistence Engine
# ==============================================================================

def run_mail_intel_sync():
    """Main execution function called by pyscript on schedule or manual scan."""
    _LOGGER.info("Starting Mail Intel synchronization run...")
    init_db()
    prune_old_records(7)

    accounts = get_imap_accounts()
    if not accounts:
        _LOGGER.warning("No mail_and_packages accounts discovered in core.config_entries.")
        return

    gemini_key = get_gemini_api_key()

    conn = get_db_connection()
    c = conn.cursor()

    c.execute("SELECT account_email, imap_uid FROM processed_emails")
    processed_set = set((row["account_email"], str(row["imap_uid"])) for row in c.fetchall())

    since_date = (dt.now() - timedelta(days=14)).strftime("%d-%b-%Y")
    today_str = dt.now().strftime("%Y-%m-%d")

    new_emails_for_ai = []
    uncommitted_emails = []

    for acc in accounts:
        user = acc["username"]
        pwd = acc["password"]
        host = acc["host"]
        port = acc["port"]
        folder = acc["folder"]

        try:
            mail = imaplib.IMAP4_SSL(host, port)
            mail.login(user, pwd)
            mail.select(folder, readonly=True)

            status, uids_res = mail.search(None, f'(SINCE "{since_date}")')
            all_uids = uids_res[0].split()

            for uid_b in all_uids:
                uid_str = uid_b.decode()
                if (user, uid_str) in processed_set:
                    continue

                res, h_data = mail.fetch(uid_b, "(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])")
                if not h_data or not h_data[0]:
                    continue

                h_text = h_data[0][1].decode("utf-8", errors="ignore")
                subject = ""
                from_hdr = ""
                date_hdr = ""
                for line in h_text.splitlines():
                    if line.lower().startswith("subject:"):
                        subject = decode_mime_str(line[8:].strip())
                    elif line.lower().startswith("from:"):
                        from_hdr = decode_mime_str(line[5:].strip())
                    elif line.lower().startswith("date:"):
                        date_hdr = line[5:].strip()

                combined_str = f"{subject} {from_hdr}".lower()

                # Filter out obvious blacklisted senders right away
                if any(b in from_hdr.lower() for b in BLACKLIST_SENDERS):
                    uncommitted_emails.append((user, uid_str, subject, from_hdr, today_str, dt.now().isoformat()))
                    continue

                is_usps_digest = (
                    "uspsinformeddelivery" in combined_str or
                    "informed delivery daily digest" in combined_str or
                    "your daily digest for" in combined_str
                )

                shipping_or_receipt_keywords = [
                    "ship", "track", "deliver", "order", "receipt", "paypal",
                    "ups", "fedex", "usps", "amazon", "aliexpress", "cainiao",
                    "package", "walmart", "target", "dhl", "ontrac"
                ]
                is_shipping_or_receipt = any(k in combined_str for k in shipping_or_receipt_keywords)

                if is_usps_digest or is_shipping_or_receipt:
                    res, msg_data = mail.fetch(uid_b, "(RFC822)")
                    if not msg_data or not msg_data[0]:
                        continue
                    msg = email.message_from_bytes(msg_data[0][1])

                    email_dt_str, email_ts = parse_email_date_and_ts(msg, date_hdr)

                    if is_usps_digest:
                        process_usps_digest_email(msg, user, email_dt_str)

                    if is_shipping_or_receipt:
                        body_snippet = get_clean_body_text(msg)[:2500]

                        new_emails_for_ai.append({
                            "account_email": user,
                            "imap_uid": uid_str,
                            "subject": subject,
                            "from_address": from_hdr,
                            "date_str": email_dt_str,
                            "timestamp": email_ts,
                            "body": body_snippet
                        })

                uncommitted_emails.append((user, uid_str, subject, from_hdr, today_str, dt.now().isoformat()))

            mail.logout()
        except Exception as e:
            _LOGGER.error("Error polling account %s: %s", user, e)

    if new_emails_for_ai:
        # Sort strictly ascending by email timestamp so chronological order is guaranteed
        new_emails_for_ai.sort(key=lambda x: x.get("timestamp", 0))
        _LOGGER.info("Discovered and sorted %d new shipping/receipt emails", len(new_emails_for_ai))

        c.execute("SELECT * FROM packages WHERE status != 'delivered' OR delivered_date >= date('now', '-7 days')")
        active_pkgs = [dict(r) for r in c.fetchall()]

        c.execute("SELECT * FROM receipts WHERE date >= date('now', '-14 days')")
        recent_recs = [dict(r) for r in c.fetchall()]

        ai_result = None
        try:
            ai_result = call_gemini_api(gemini_key, new_emails_for_ai, active_pkgs, recent_recs)
        except Exception as ex:
            _LOGGER.warning("Gemini API call exception: %s", ex)

        final_packages = []
        final_receipts = []

        if ai_result and isinstance(ai_result, dict) and "packages" in ai_result:
            _LOGGER.info("Gemini AI successfully processed %d packages", len(ai_result.get("packages", [])))
            for p in ai_result.get("packages", []):
                t_num = p.get("tracking_number")
                if t_num:
                    carrier = p.get("carrier") or "Unknown"
                    final_packages.append({
                        "tracking_number": str(t_num),
                        "carrier": carrier,
                        "tracking_url": p.get("tracking_url") or generate_tracking_url(carrier, t_num),
                        "order_id": p.get("order_id"),
                        "status": p.get("status") or "in_transit",
                        "expected_date": p.get("expected_date"),
                        "delivered_date": p.get("delivered_date"),
                        "merchant_or_sender": p.get("merchant_or_sender") or "Delivery Package",
                        "raw_sender": p.get("raw_sender") or "",
                        "items_summary": p.get("items_summary") or "",
                        "order_total": p.get("order_total"),
                        "source_emails": p.get("source_emails") or [],
                        "correlation_note": p.get("correlation_note")
                    })
            for r in ai_result.get("receipts", []):
                final_receipts.append(r)
        else:
            _LOGGER.info("Falling back to Python rule-based and regex extraction engine")
            for em in new_emails_for_ai:
                pkgs, recs = rule_based_fallback_extract(em)
                final_packages.extend(pkgs)
                final_receipts.extend(recs)

            final_packages = correlate_packages_with_receipts(final_packages, recent_recs + final_receipts)

        for r in final_receipts:
            c.execute("""
                INSERT INTO receipts (account_email, imap_uid, order_id, merchant, items, total, date, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                r.get("account_email", ""),
                str(r.get("imap_uid", "")),
                str(r.get("order_id", "")),
                str(r.get("merchant", "")),
                str(r.get("items", "")),
                str(r.get("total", "")),
                str(r.get("date", today_str)),
                dt.now().isoformat()
            ))

        # Enforce One-Way Status State Machine when updating packages in SQLite
        for p in final_packages:
            t_num = p["tracking_number"]
            order_id = p.get("order_id")
            carrier = p.get("carrier") or "Unknown"

            # 1. Sanitize sensitive keywords from items_summary and merchant_or_sender
            clean_items, clean_merchant = sanitize_sensitive_item(p.get("items_summary"), p.get("merchant_or_sender"))
            p["items_summary"] = clean_items
            p["merchant_or_sender"] = clean_merchant

            # 2. Check delivering_today validity: only valid if expected_date is today OR email was received today
            if p.get("status") == "delivering_today":
                exp = p.get("expected_date")
                em_d = p.get("email_date") or today_str
                if (exp and exp < today_str) or (not exp and em_d < today_str):
                    carrier_str = (carrier + " " + (clean_merchant or "")).lower()
                    if "usps" in carrier_str:
                        p["status"] = "delivered"
                        p["delivered_date"] = exp or em_d
                    else:
                        p["status"] = "in_transit"

            existing = None
            c.execute("SELECT * FROM packages WHERE tracking_number = ?", (t_num,))
            existing = c.fetchone()
            if not existing and carrier == "Amazon" and order_id:
                c.execute("SELECT * FROM packages WHERE carrier = 'Amazon' AND (tracking_number = ? OR tracking_number LIKE ?)", (order_id, f"%{order_id}%"))
                existing = c.fetchone()
            if not existing and (carrier in ("AliExpress", "Cainiao", "AliExpress (USPS)") or t_num.startswith("92") or t_num.startswith("1M") or t_num.startswith("LP")):
                if order_id:
                    c.execute("SELECT * FROM packages WHERE (carrier LIKE '%AliExpress%' OR carrier = 'Cainiao') AND (tracking_number = ? OR tracking_number = ?)", (f"ALI-{order_id}", order_id))
                    existing = c.fetchone()
                if not existing and clean_items and clean_items not in ("Delivery Package", "AliExpress Package"):
                    c.execute("SELECT * FROM packages WHERE tracking_number LIKE 'ALI-%'")
                    for a_row in c.fetchall():
                        a_it = (a_row["items_summary"] or "").lower()
                        c_it = clean_items.lower()
                        if a_it and (a_it == c_it or (len(a_it) > 15 and a_it[:25] in c_it) or (len(c_it) > 15 and c_it[:25] in a_it) or ("dropper bottl" in a_it and "dropper bottl" in c_it)):
                            existing = a_row
                            break

            src_list = list(p.get("source_emails") or [])
            if existing:
                try:
                    old_src = json.loads(existing["source_emails"] or "[]")
                    src_list = list(set(src_list + old_src))
                except Exception:
                    pass

                old_status = existing["status"] or "in_transit"
                new_status = p.get("status") or "in_transit"
                old_rank = STATUS_RANK.get(old_status, 0)
                new_rank = STATUS_RANK.get(new_status, 0)

                # Never downgrade a higher status rank
                final_status = old_status if old_rank > new_rank else new_status
                final_deliv = existing["delivered_date"] or p.get("delivered_date")
                if final_status == "delivered" and not final_deliv:
                    final_deliv = p.get("delivered_date") or p.get("email_date") or today_str

                final_items = existing["items_summary"]
                new_items = p.get("items_summary")
                if (not final_items or final_items in ("Delivery Package", "Amazon Order", "AliExpress Package")) and new_items and new_items not in ("Delivery Package", "Amazon Order", "AliExpress Package"):
                    final_items = new_items

                final_merchant = existing["merchant_or_sender"]
                new_merchant = p.get("merchant_or_sender")
                if (not final_merchant or final_merchant == "Package Delivery") and new_merchant and new_merchant != "Package Delivery":
                    final_merchant = new_merchant

                final_carrier = existing["carrier"] or carrier
                if final_carrier in ("Unknown", "Package Delivery") and carrier not in ("Unknown", "Package Delivery"):
                    final_carrier = carrier

                final_total = existing["order_total"] or p.get("order_total")
                final_corr = p.get("correlation_note") or existing["correlation_note"]
                final_expected = p.get("expected_date") if final_status == "delivering_today" else existing["expected_date"]

                target_track_num = existing["tracking_number"]
                old_placeholder_to_delete = None
                if target_track_num.startswith("ALI-") and not t_num.startswith("ALI-"):
                    old_placeholder_to_delete = target_track_num
                    target_track_num = t_num

                if old_placeholder_to_delete:
                    c.execute("DELETE FROM packages WHERE tracking_number = ?", (old_placeholder_to_delete,))

                # Preserve existing mask and hide choices across updates
                is_masked_val = 1 if existing["is_masked"] == 1 else 0
                is_hidden_val = 1 if existing["is_hidden"] == 1 else 0

                c.execute("""
                    INSERT OR REPLACE INTO packages (
                        tracking_number, carrier, tracking_url, status, expected_date,
                        delivered_date, merchant_or_sender, raw_sender, items_summary,
                        order_total, source_emails, correlation_note, matched_receipts,
                        is_masked, is_hidden, last_updated
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    target_track_num,
                    final_carrier,
                    p.get("tracking_url") or generate_tracking_url(final_carrier, target_track_num),
                    final_status,
                    final_expected,
                    final_deliv,
                    final_merchant,
                    p.get("raw_sender") or existing["raw_sender"],
                    final_items,
                    final_total,
                    json.dumps(src_list),
                    final_corr,
                    json.dumps([]),
                    is_masked_val,
                    is_hidden_val,
                    dt.now().isoformat()
                ))
            else:
                final_status = p.get("status") or "in_transit"
                final_deliv = p.get("delivered_date")
                if final_status == "delivered" and not final_deliv:
                    final_deliv = p.get("email_date") or today_str

                c.execute("""
                    INSERT INTO packages (
                        tracking_number, carrier, tracking_url, status, expected_date,
                        delivered_date, merchant_or_sender, raw_sender, items_summary,
                        order_total, source_emails, correlation_note, matched_receipts,
                        is_masked, is_hidden, last_updated
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
                """, (
                    t_num,
                    carrier,
                    p.get("tracking_url") or generate_tracking_url(carrier, t_num),
                    final_status,
                    p.get("expected_date"),
                    final_deliv,
                    p.get("merchant_or_sender") or "Delivery Package",
                    p.get("raw_sender") or "",
                    p.get("items_summary") or "Delivery Package",
                    p.get("order_total"),
                    json.dumps(src_list),
                    p.get("correlation_note"),
                    json.dumps([]),
                    dt.now().isoformat()
                ))

    for row in uncommitted_emails:
        c.execute("""
            INSERT OR IGNORE INTO processed_emails (account_email, imap_uid, subject, from_address, date, processed_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, row)

    # Post-sync cleanup: deduplicate and sanitize
    deduplicate_packages(conn)
    conn.commit()
    conn.close()
    _LOGGER.info("Mail Intel sync completed successfully.")


# ==============================================================================
# Dashboard Payload Builder
# ==============================================================================

def build_dashboard_data():
    """Build the consolidated data payload for sensor.mail_intel_dashboard_data."""
    conn = get_db_connection()
    c = conn.cursor()

    today_dt = dt.now().date()
    today_str = today_dt.strftime("%Y-%m-%d")
    cutoff_7d_dt = today_dt - timedelta(days=7)
    cutoff_7d_str = cutoff_7d_dt.strftime("%Y-%m-%d")

    # 7-day date list (today + past 7 days: 2026-10-28 through 2026-11-04)
    date_list = [(today_dt - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(8)]

    c.execute("SELECT * FROM mailpieces WHERE date >= ? ORDER BY id ASC", (cutoff_7d_str,))
    mailpiece_rows = c.fetchall()
    mailpieces_by_date = {}
    for r in mailpiece_rows:
        d = r["date"]
        if d not in mailpieces_by_date:
            mailpieces_by_date[d] = []
        mailpieces_by_date[d].append({
            "url": r["image_url"],
            "account_email": r["account_email"],
            "filename": r["filename"]
        })

    # Run deduplication on database packages
    deduplicate_packages(conn)

    c.execute("SELECT * FROM packages ORDER BY last_updated DESC")
    pkg_rows = [dict(r) for r in c.fetchall()]

    delivering_today = []
    in_transit = []
    delivered_all = []

    for p in pkg_rows:
        # Hide completely if user marked hidden
        if p.get("is_hidden") == 1:
            continue

        try:
            p["source_emails"] = json.loads(p.get("source_emails") or "[]")
        except Exception:
            p["source_emails"] = []

        # Automatic privacy sanitizer
        clean_item, clean_m = sanitize_sensitive_item(p.get("items_summary"), p.get("merchant_or_sender"))
        p["items_summary"] = clean_item
        p["merchant_or_sender"] = clean_m

        # If user masked this item, replace summary with "Private Order" and hide correlation
        if p.get("is_masked") == 1:
            p["items_summary"] = "Private Order"
            p["correlation_note"] = None

        st = (p.get("status") or "").lower()
        exp_d = p.get("expected_date")

        # Fix past-date packages stuck in delivering_today
        if st == "delivering_today":
            if exp_d and exp_d < today_str:
                carrier_str = ((p.get("carrier") or "") + " " + (p.get("merchant_or_sender") or "")).lower()
                if "usps" in carrier_str:
                    st = "delivered"
                    p["status"] = "delivered"
                    p["delivered_date"] = exp_d
                    c.execute("UPDATE packages SET status = 'delivered', delivered_date = ?, last_updated = ? WHERE tracking_number = ?",
                              (exp_d, dt.now().isoformat(), p["tracking_number"]))
                else:
                    st = "in_transit"
                    p["status"] = "in_transit"
                    c.execute("UPDATE packages SET status = 'in_transit', last_updated = ? WHERE tracking_number = ?",
                              (dt.now().isoformat(), p["tracking_number"]))

        if st == "delivered":
            delivered_all.append(p)
        elif st == "delivering_today" or exp_d == today_str:
            delivering_today.append(p)
        elif st == "in_transit":
            in_transit.append(p)
        else:
            in_transit.append(p)

    conn.commit()
    conn.close()

    days_data = {}
    for d_str in date_list:
        if d_str == today_str:
            seen_tracks = set()
            day_deliveries = []
            for p in [p for p in delivered_all if p.get("delivered_date") == d_str] + delivering_today:
                t = p.get("tracking_number")
                if t not in seen_tracks:
                    seen_tracks.add(t)
                    day_deliveries.append(p)
        else:
            day_deliveries = [p for p in delivered_all if p.get("delivered_date") == d_str]

        days_data[d_str] = {
            "usps_images": mailpieces_by_date.get(d_str, []),
            "deliveries": day_deliveries
        }

    # Strict 7-day cutoff: must be delivered on or after cutoff_7d_str (2026-10-28)
    recent_deliveries_7d = [
        p for p in delivered_all
        if p.get("delivered_date") and p.get("delivered_date") >= cutoff_7d_str and p.get("is_hidden") != 1
    ]
    recent_deliveries_7d.sort(key=lambda x: x.get("delivered_date", ""), reverse=True)

    accounts = [acc["username"] for acc in get_imap_accounts()]
    summary_status = f"{len(delivering_today)} delivering today, {len(days_data.get(today_str, {}).get('usps_images', []))} mail pieces"

    return {
        "state": summary_status,
        "attributes": {
            "days": days_data,
            "delivering_today": delivering_today,
            "in_transit": in_transit,
            "recent_deliveries_7d": recent_deliveries_7d,
            "last_updated": dt.now().isoformat(),
            "accounts_monitored": accounts
        }
    }


def run_full_sync():
    """Runs sync and builds consolidated dashboard data dict."""
    run_mail_intel_sync()
    return build_dashboard_data()
