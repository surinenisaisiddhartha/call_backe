"""
Call analytics — the aggregate picture across every caller.

The per-call analysis answers "how did that one go?". This answers the
questions you can only ask of the whole set: who is actually interested, who
is just passing time, and what are people ringing up to ask about.

Everything here is computed from the post-call analysis Retell writes onto
each CallAttempt (see school_agent.POST_CALL_ANALYSIS_FIELDS). Calls made
before that was configured simply have none and are reported separately
rather than being silently folded into the totals — a denominator that
quietly includes unanalysed calls would make every percentage wrong.
"""
import json
from collections import Counter
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.db import get_db, CallAttempt, Contact
from src.routers.auth import get_current_user

router = APIRouter(prefix="/api/analytics", tags=["Analytics"])

# The controlled vocabulary the agent is told to use for topics. Anything
# outside it is counted as "Other" rather than creating a new bucket, so one
# stray label can't fragment the counts.
KNOWN_TOPICS = [
    "Fees", "Admissions", "Curriculum", "Facilities", "Transport",
    "Hostel", "Timings", "Location", "Policies", "Other",
]
_TOPIC_LOOKUP = {t.lower(): t for t in KNOWN_TOPICS}


def _parse_analysis(raw: str):
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) and parsed else None
    except (ValueError, TypeError):
        return None


def _split_topics(value: str):
    """
    'Fees, Admissions' -> ['Fees', 'Admissions'].

    The model is instructed to use the exact vocabulary but does not always
    comply, so unknown labels collapse into 'Other' instead of becoming their
    own bucket. Without this, 'fee structure' and 'Fees' would show as two
    separate rows and each would undercount.
    """
    if not value:
        return []
    out = []
    for part in str(value).split(","):
        cleaned = part.strip().lower()
        if not cleaned or cleaned == "none":
            continue
        out.append(_TOPIC_LOOKUP.get(cleaned, "Other"))
    return out


@router.get("/calls")
def call_analytics(
    days: int = 30,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Aggregate view of the last `days` of calls, scoped to the caller's school.
    """
    since = datetime.utcnow() - timedelta(days=days)

    q = (
        db.query(CallAttempt)
        .join(Contact, CallAttempt.contact_id == Contact.id)
        .filter(CallAttempt.started_at >= since)
    )
    if current_user.get("school_id"):
        q = q.filter(Contact.school_id == current_user["school_id"])
    attempts = q.all()

    interest = Counter()
    engagement = Counter()
    caller_type = Counter()
    sentiment = Counter()
    primary_topic = Counter()
    all_topics = Counter()
    concerns = []
    analysed = 0

    for a in attempts:
        if a.user_sentiment:
            sentiment[a.user_sentiment] += 1

        data = _parse_analysis(a.analysis_json)
        if not data:
            continue
        analysed += 1

        if data.get("interest_level"):
            interest[data["interest_level"]] += 1
        if data.get("engagement_quality"):
            engagement[data["engagement_quality"]] += 1
        if data.get("caller_type"):
            caller_type[data["caller_type"]] += 1
        if data.get("primary_topic") and data["primary_topic"] != "NoQuestions":
            primary_topic[data["primary_topic"]] += 1
        for t in _split_topics(data.get("topics_discussed")):
            all_topics[t] += 1

        concern = (data.get("concerns_raised") or "").strip()
        if concern and concern.lower() != "none":
            concerns.append(concern)

    def as_rows(counter: Counter):
        total = sum(counter.values())
        return [
            {
                "label": k,
                "count": v,
                "percent": round(v * 100 / total, 1) if total else 0.0,
            }
            for k, v in counter.most_common()
        ]

    # Per-CALLER classification, not per-call: the same single label the Leads
    # Directory shows, so the two views can never disagree. Names are included
    # because "12 Time Pass" is a statistic, while knowing WHICH twelve is
    # something a team can act on this afternoon.
    from src.routers.contacts import compute_interest_levels, CLASSIFICATIONS

    contact_q = db.query(Contact)
    if current_user.get("school_id"):
        contact_q = contact_q.filter(Contact.school_id == current_user["school_id"])
    all_contacts = contact_q.all()
    per_contact = compute_interest_levels(db, all_contacts)

    # Counts only — deliberately NOT the names. At a thousand calls a day a
    # bucket holds hundreds of people: unreadable on screen, and a pointless
    # payload to send on every page load. The Leads Directory already filters
    # by this exact label, so each row here links there instead.
    by_class = {label: 0 for label in CLASSIFICATIONS}
    for c in all_contacts:
        label = per_contact.get(c.id, "Not Reached")
        by_class[label] = by_class.get(label, 0) + 1

    total_contacts = len(all_contacts) or 1
    caller_classification = [
        {
            "label": label,
            "count": count,
            "percent": round(count * 100 / total_contacts, 1),
        }
        for label, count in by_class.items()
    ]

    # ── What callers actually asked, and whether we could answer ──────────
    # Detected deterministically from the caller's own words, so this covers
    # every call ever recorded — including the ones made before LLM analysis
    # existed — and the same transcript always produces the same answer.
    from src.topics import detect_topics, knowledge_coverage, ALL_TOPICS

    asked = Counter()
    for a in attempts:
        labels = [x for x in (a.detected_topics or "").split(",") if x]
        if not labels and a.transcript:
            labels = detect_topics(a.transcript)   # not yet backfilled
        for label in labels:
            asked[label] += 1

    coverage = knowledge_coverage(db, current_user.get("school_id"))
    total_asked = sum(asked.values()) or 1
    questions_asked = [
        {
            "label": label,
            "count": count,
            "percent": round(count * 100 / total_asked, 1),
            "covered": coverage.get(label, False),
        }
        for label, count in asked.most_common()
    ]

    # The actionable half: subjects parents raise that the knowledge base has
    # nothing to say about, so the agent can only apologise. Knowing 40 people
    # asked about scholarships is interesting; knowing none of them got an
    # answer is what gets the page written.
    knowledge_gaps = [
        {"label": r["label"], "count": r["count"]}
        for r in questions_asked if not r["covered"]
    ]

    return {
        "window_days": days,
        "total_contacts": len(all_contacts),
        "questions_asked": questions_asked,
        "knowledge_gaps": knowledge_gaps,
        "all_topics": ALL_TOPICS,
        "caller_classification": caller_classification,
        "total_calls": len(attempts),
        # Stated plainly so nobody reads a percentage as covering every call.
        "analysed_calls": analysed,
        "unanalysed_calls": len(attempts) - analysed,
        "interest_level": as_rows(interest),
        "engagement_quality": as_rows(engagement),
        "caller_type": as_rows(caller_type),
        "sentiment": as_rows(sentiment),
        "primary_topic": as_rows(primary_topic),
        "topics_mentioned": as_rows(all_topics),
        # Verbatim, most recent first — the aggregate says how many objected,
        # only the wording says what to actually do about it.
        "recent_concerns": concerns[-15:][::-1],
    }
