"""
Callback time parser using dateparser.
Parses natural language phrases from call transcripts into UTC datetimes.
All times are interpreted in Asia/Kolkata (IST) then stored as UTC.
"""
import re
from datetime import datetime, timedelta
from typing import Optional, Tuple

import dateparser

IST_TZ = "Asia/Kolkata"

# Keywords that indicate a callback is being requested
CALLBACK_KEYWORDS = [
    "call back", "callback", "call me back", "call again",
    "reschedule", "better time", "available at", "try again",
    "ring me", "phone me", "reach me", "contact me later",
    "not a good time", "busy right now", "in a meeting",
    "call me", "call you back", "calling you back",
    "call after", "call in", "call tomorrow", "call later",
    "talk later", "talk after", "busy", "meeting", "driving",
    "convenient time", "another time"
]

# Phrases where AM/PM is ambiguous (just a number like "11" or "3")
AMBIGUOUS_HOUR_PATTERN = re.compile(
    r"\b(at|around|by)?\s*(\d{1,2})\s*(o'?clock)?\s*$",
    re.IGNORECASE
)


def has_callback_intent(text: str) -> bool:
    """Check if the text contains a callback scheduling intent."""
    if not text:
        return False
    text_lower = text.lower()
    return any(kw in text_lower for kw in CALLBACK_KEYWORDS)


def is_ambiguous_time(text: str) -> bool:
    """
    Returns True if the time phrase is ambiguous — e.g. just '11' or 'at 3'
    without AM/PM or morning/evening context.
    """
    if not text:
        return False
    text_clean = text.strip().lower()
    # Remove common prefixes/context words
    text_clean = re.sub(r"(call back|callback|at|around|tomorrow|today|next\s+\w+)", "", text_clean).strip()

    # If the remaining text is purely a number (or "X o'clock") with no AM/PM
    if re.fullmatch(r"\d{1,2}(\s*o'?clock)?", text_clean):
        return True

    # Explicit AM/PM provided → not ambiguous
    if re.search(r"\b(am|pm|a\.m|p\.m|morning|afternoon|evening|night)\b", text_clean):
        return False

    return bool(AMBIGUOUS_HOUR_PATTERN.search(text_clean))


def parse_callback_time(text: str, prefer_am: Optional[bool] = None) -> Optional[datetime]:
    """
    Parse a natural language time phrase into a UTC datetime.

    Args:
        text: The raw phrase, e.g. "tomorrow at 11", "next Monday", "after one hour"
        prefer_am: If not None, forces AM (True) or PM (False) when parsing ambiguous times.

    Returns:
        datetime in UTC, or None if parsing fails.

    Examples:
        "today evening"      → today at 18:00 IST → UTC
        "after one hour"     → now + 1 hour
        "after two minutes"  → now + 2 minutes
        "tomorrow at 11"     → tomorrow 11:00 IST → UTC  (may be ambiguous)
        "next Monday"        → next Monday 09:00 IST → UTC (defaults to 9 AM)
        "tomorrow at 11 am"  → tomorrow 11:00 AM IST → UTC
    """
    if not text:
        return None

    # Clean common filler/prefix words first so both relative and absolute parsing benefit from it
    text_clean = text.lower()
    fillers = [
        "call back", "callback", "call me back", "call again", 
        "arrange for a", "arrange a", "arrange", "around", 
        "approx", "approximately", "about", "on", "at", 
        "please", "kindly", "will", "exactly", "just"
    ]
    for f in fillers:
        text_clean = re.sub(r"\b" + re.escape(f) + r"\b", "", text_clean)

    # ── Handle explicit relative durations first (more reliable than dateparser) ──
    # Matches: "after X minutes", "in X minutes", "after X hours", "X minutes later", etc.
    WORD_TO_NUM = {
        "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
        "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
        "fifteen": 15, "twenty": 20, "thirty": 30, "forty": 40,
        "forty-five": 45, "half": 30,
    }

    relative_pattern = re.compile(
        r"(?:after|in)\s+(\d+|" + "|".join(WORD_TO_NUM.keys()) + r")\s+"
        r"(minutes?|mins?|hours?|hrs?)",
        re.IGNORECASE
    )
    match = relative_pattern.search(text_clean)
    if match:
        amount_str = match.group(1).lower()
        unit = match.group(2).lower()
        amount = WORD_TO_NUM.get(amount_str) or int(amount_str)
        if unit.startswith("h"):
            delta = timedelta(hours=amount)
        else:
            delta = timedelta(minutes=amount)
        return datetime.utcnow() + delta

    # Also handle "X minutes later" pattern
    later_pattern = re.compile(
        r"(\d+|" + "|".join(WORD_TO_NUM.keys()) + r")\s+"
        r"(minutes?|mins?|hours?|hrs?)\s+later",
        re.IGNORECASE
    )
    match = later_pattern.search(text_clean)
    if match:
        amount_str = match.group(1).lower()
        unit = match.group(2).lower()
        amount = WORD_TO_NUM.get(amount_str) or int(amount_str)
        if unit.startswith("h"):
            delta = timedelta(hours=amount)
        else:
            delta = timedelta(minutes=amount)
        return datetime.utcnow() + delta

    # ── Fall back to dateparser for absolute/complex times ──
    settings = {
        "PREFER_DATES_FROM": "future",
        "TIMEZONE": IST_TZ,
        "RETURN_AS_TIMEZONE_AWARE": True,
        "PREFER_DAY_OF_MONTH": "first",
        "TO_TIMEZONE": "UTC",
    }

    # Check if a specific time is present (e.g. 2:00 PM, 10 AM, etc.)
    has_specific_time = bool(re.search(r"\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m|p\.m)\b", text_clean))
    if has_specific_time:
        # Remove redundant vague time descriptors that conflict with the specific time
        for v in ["morning", "afternoon", "evening", "night"]:
            text_clean = re.sub(r"\b" + v + r"\b", "", text_clean)
    else:
        # Map vague times to specific hours ONLY if no specific time is present
        time_substitutions = {
            r"\bmorning\b": "09:00",
            r"\bevening\b": "18:00",
            r"\bafternoon\b": "14:00",
            r"\bnight\b": "20:00",
            r"\bnoon\b": "12:00",
            r"\bmidnight\b": "00:00",
        }
        for pattern, replacement in time_substitutions.items():
            text_clean = re.sub(pattern, replacement, text_clean, flags=re.IGNORECASE)

    # Handle AM/PM preference for ambiguous times
    if prefer_am is True:
        settings["PREFER_DAY_OF_MONTH"] = "first"
        # Force morning interpretation by appending AM
        text_clean = re.sub(r"(\d{1,2})\s*o'?clock", r"\1", text_clean)
        text_clean = re.sub(r"(\d{1,2})(?!\s*(am|pm))", r"\1 AM", text_clean, count=1)
    elif prefer_am is False:
        text_clean = re.sub(r"(\d{1,2})(?!\s*(am|pm))", r"\1 PM", text_clean, count=1)

    text_clean = re.sub(r"\s+", " ", text_clean).strip()

    parsed = dateparser.parse(text_clean, settings=settings)

    if parsed is None:
        return None

    # Make sure it's in the future (at least 30 seconds from now)
    now_utc = datetime.utcnow()
    if parsed.replace(tzinfo=None) < now_utc + timedelta(seconds=30):
        return None

    return parsed.replace(tzinfo=None)  # Return naive UTC datetime for DB storage


def extract_callback_phrase(summary: str, transcript: str) -> Optional[str]:
    """
    Try to extract the specific callback time phrase from the call summary or transcript.
    Returns the most relevant phrase for parsing, or None.
    """
    # Look in summary first (more structured)
    sources = []
    if summary:
        sources.append(summary)
    if transcript:
        # Take last 500 chars of transcript (most recent context)
        sources.append(transcript[-500:])

    # Patterns that typically precede a callback time
    time_patterns = [
        r"call (?:back|me|again)?\s+(?:at|around|by|on|in)?\s+([^.!?\n]{3,50})",
        r"available\s+(?:at|on|in|after)?\s+([^.!?\n]{3,50})",
        r"try\s+(?:again|me)?\s+(?:at|on|in|after)?\s+([^.!?\n]{3,50})",
        r"(?:tomorrow|today|next\s+\w+|after\s+\w+)[^.!?\n]{0,40}",
        r"(?:morning|afternoon|evening|night)\s+(?:would|works?|is\s+fine)[^.!?\n]{0,30}",
        r"(\d{1,2}(?::\d{2})?\s*(?:am|pm|o'clock)?[^.!?\n]{0,20})",
    ]

    for source in sources:
        source_lower = source.lower()
        if not any(kw in source_lower for kw in CALLBACK_KEYWORDS):
            continue
        for pattern in time_patterns:
            match = re.search(pattern, source, re.IGNORECASE)
            if match:
                phrase = match.group(0).strip()
                if len(phrase) > 3:
                    return phrase

    return None
