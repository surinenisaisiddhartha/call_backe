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

    # Strip relative weekday prefixes ("next", "this", "coming") before weekday names
    # so dateparser (configured with PREFER_DATES_FROM="future") correctly parses
    # relative weekday + time-of-day phrases like "next Monday morning" -> "monday 09:00"
    # to the upcoming Monday at 09:00 IST instead of returning None.
    weekdays_pattern = r"\b(next|this|coming)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b"
    text_clean = re.sub(weekdays_pattern, r"\2", text_clean, flags=re.IGNORECASE)

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
        # ── Vague-phrase heuristic fallback ──────────────────────────────
        # When the caller says "call me later", "sometime next week", etc.,
        # dateparser can't extract a specific date. Rather than dropping
        # the callback entirely, we map well-known vague phrases to sensible
        # default scheduling times so the counselor gets a concrete reminder.
        parsed = _vague_callback_fallback(text)
        if parsed is None:
            return None

    # Make sure it's in the future (at least 30 seconds from now)
    now_utc = datetime.utcnow()
    if parsed.replace(tzinfo=None) < now_utc + timedelta(seconds=30):
        return None

    return parsed.replace(tzinfo=None)  # Return naive UTC datetime for DB storage


def _vague_callback_fallback(raw_text: str) -> Optional[datetime]:
    """
    Map common vague callback phrases to sensible default scheduling times.

    This handles the gap where dateparser returns None because the caller
    said something like "call me later" or "try again next week" without
    specifying an exact time. Instead of losing the callback entirely, we
    schedule at a reasonable default time.

    Returns a naive UTC datetime, or None if no vague pattern matches.
    """
    from datetime import timezone

    IST = timezone(timedelta(hours=5, minutes=30))
    now_ist = datetime.now(IST)
    text = raw_text.lower().strip()

    # ── Pattern → (days_ahead, hour_ist) mapping ─────────────────────
    # Each pattern produces a callback at the specified IST hour,
    # offset by the given number of days from now.
    VAGUE_PATTERNS = [
        # "later today" / "this evening" → today at 6 PM IST (or tomorrow if past 6 PM)
        (r"\b(later\s+today|this\s+evening)\b",                    0, 18),
        # "tomorrow" without a time → tomorrow at 10 AM IST
        (r"\btomorrow\b",                                          1, 10),
        # "later" / "sometime" / "another time" → next business day at 10 AM IST
        (r"\b(later|sometime|some\s+time|another\s+time|not\s+now|busy)\b", 1, 10),
        # "couple of days" / "few days" / "2-3 days" → 2 days out at 10 AM IST
        (r"\b(couple\s+of\s+days|few\s+days|2[\-\s]*3\s+days|in\s+a\s+few\s+days)\b", 2, 10),
        # "next week" / "coming week" → next Monday at 10 AM IST
        (r"\b(next\s+week|coming\s+week)\b",                      None, 10),  # None = next Monday
        # "after X days" (catch-all for digit)
        (r"\bafter\s+(\d+)\s+days?\b",                            None, 10),  # dynamic
        # "weekend" → next Saturday at 10 AM IST
        (r"\b(this\s+weekend|next\s+weekend|on\s+weekend|weekend)\b", None, 10),
    ]

    for pattern, days_ahead, hour_ist in VAGUE_PATTERNS:
        match = re.search(pattern, text)
        if not match:
            continue

        if "next week" in text or "coming week" in text:
            # Advance to next Monday
            days_until_monday = (7 - now_ist.weekday()) % 7
            if days_until_monday == 0:
                days_until_monday = 7  # If today is Monday, go to next Monday
            target_ist = now_ist.replace(
                hour=hour_ist, minute=0, second=0, microsecond=0
            ) + timedelta(days=days_until_monday)
        elif "weekend" in text:
            # Advance to next Saturday
            days_until_saturday = (5 - now_ist.weekday()) % 7
            if days_until_saturday == 0:
                days_until_saturday = 7
            target_ist = now_ist.replace(
                hour=hour_ist, minute=0, second=0, microsecond=0
            ) + timedelta(days=days_until_saturday)
        elif pattern == r"\bafter\s+(\d+)\s+days?\b":
            num_days = int(match.group(1))
            target_ist = now_ist.replace(
                hour=hour_ist, minute=0, second=0, microsecond=0
            ) + timedelta(days=num_days)
        else:
            target_ist = now_ist.replace(
                hour=hour_ist, minute=0, second=0, microsecond=0
            ) + timedelta(days=days_ahead)

        # If the target time has already passed today, push to next day
        if target_ist <= now_ist:
            target_ist += timedelta(days=1)

        # Skip Sunday (weekday 6) — push to Monday
        if target_ist.weekday() == 6:
            target_ist += timedelta(days=1)

        # Convert IST → UTC for DB storage
        target_utc = target_ist.astimezone(timezone.utc).replace(tzinfo=None)
        print(f"[CALLBACK] Vague phrase '{raw_text}' -> fallback: {target_ist.strftime('%a %d %b %I:%M %p')} IST")
        return target_utc

    return None


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
