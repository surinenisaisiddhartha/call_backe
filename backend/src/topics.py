"""
What callers actually asked about — detected from their own words.

WHY THIS EXISTS ALONGSIDE THE LLM ANALYSIS
Retell's post-call analysis already returns a primary_topic and a topics list.
This does not replace that; it does a different job:

  * It is DETERMINISTIC. The same transcript always yields the same topics, so
    counts across thousands of calls can be trusted and compared month to
    month. An LLM asked to pick from a list complies most of the time, not
    every time, and a category that quietly drifts makes a trend line lie.
  * It works on calls ALREADY MADE. There are 116 transcripts stored that
    predate the analysis config and can never be re-analysed by Retell. This
    reads them today.
  * It is FREE and instant — no API call, no per-call cost at 10,000 a day.
  * It is auditable: every hit can point at the phrase that caused it.

The two are complementary. The LLM judges intent and nuance; this counts
subjects reliably.

ONLY THE CALLER'S WORDS COUNT
Detection runs over the caller's lines alone. The agent says "fees" in
practically every call while explaining something, and counting that would
show 100% of callers asking about fees — the opposite of a useful signal.

KEYWORDS ARE INDIAN-ENGLISH ADMISSIONS LANGUAGE
Grounded in how parents actually phrase things ("what is the rate", "any
concession", "donation", "TC"), not textbook vocabulary.
"""
import re
from typing import Dict, List

# label -> phrases that mean the caller raised it.
# Multi-word phrases are matched first so "fee structure" doesn't merely count
# as "fee". Every entry is lowercase; matching is word-boundary aware so
# "rate" does not fire inside "accurate".
TOPIC_KEYWORDS: Dict[str, List[str]] = {
    "Fees": [
        "fee", "fees", "fee structure", "fees structure", "how much", "cost",
        "costs", "charges", "charge", "rate", "rates", "tuition", "annual fee",
        "per year", "per month", "payment", "instalment", "installment", "emi",
        "donation", "expensive", "affordable", "budget", "price",
    ],
    "Scholarships": [
        "scholarship", "scholarships", "concession", "discount", "sibling discount",
        "financial aid", "free seat", "rte", "subsidy", "waiver", "fee waiver",
        "merit", "reduction",
    ],
    "Admissions": [
        "admission", "admissions", "apply", "application", "enrol", "enroll",
        "enrolment", "enrollment", "seat", "seats", "vacancy", "vacancies",
        "availability", "available", "form", "procedure", "process",
        "eligibility", "criteria", "entrance", "entrance test", "interview",
        "age", "age limit", "documents", "document", "certificate",
        "birth certificate", "transfer certificate", "tc", "deadline",
        "last date", "registration",
    ],
    "Curriculum": [
        "curriculum", "syllabus", "ib", "cbse", "icse", "igcse", "board",
        "subjects", "subject", "stream", "academics", "academic", "pyp", "myp",
        "diploma", "programme", "program", "medium", "language",
    ],
    "Facilities": [
        "facility", "facilities", "campus", "infrastructure", "lab", "labs",
        "laboratory", "library", "playground", "swimming", "pool", "classroom",
        "classrooms", "smart class", "building", "ground",
    ],
    "Activities": [
        "sports", "games", "activities", "activity", "extracurricular",
        "extra curricular", "co curricular", "music", "dance", "art", "drama",
        "club", "clubs", "martial", "karate", "yoga", "coaching", "swimming",
        "athletics", "competition",
    ],
    "Transport": [
        "transport", "transportation", "bus", "buses", "van", "pick up",
        "pickup", "drop", "route", "conveyance", "cab",
    ],
    "Hostel": [
        "hostel", "boarding", "residential", "day boarding", "accommodation",
        "mess", "food", "meals", "canteen", "lunch", "breakfast", "menu",
    ],
    "Timings": [
        "timing", "timings", "school hours", "what time", "start time",
        "closing time", "shift", "working days", "holidays", "vacation",
        "half day", "schedule",
    ],
    "Location": [
        "location", "address", "directions", "how to reach", "distance",
        "nearby", "near by", "area", "branch", "landmark",
    ],
    "Staff": [
        "teacher", "teachers", "faculty", "staff", "qualification",
        "qualifications", "experience", "ratio", "student teacher ratio",
        "class size", "strength", "principal",
    ],
    "Policies": [
        "policy", "policies", "rules", "uniform", "dress code", "attendance",
        "leave", "refund", "withdrawal", "discipline", "safety", "security",
        "cctv", "medical", "insurance",
    ],
    "Results": [
        "results", "result", "performance", "board results", "university",
        "placement", "alumni", "ranking", "rank", "accreditation",
        "affiliation", "recognised", "recognized",
    ],
}

# Precompiled, longest phrase first so multi-word terms win over their parts.
_PATTERNS = {
    topic: [
        (kw, re.compile(r"(?<![a-z])" + re.escape(kw) + r"(?![a-z])"))
        for kw in sorted(keywords, key=len, reverse=True)
    ]
    for topic, keywords in TOPIC_KEYWORDS.items()
}

ALL_TOPICS = sorted(TOPIC_KEYWORDS.keys())


def caller_utterances(transcript: str) -> str:
    """
    Just the caller's half of the conversation.

    Retell transcripts are "Agent: ...\\nUser: ..." lines. Counting the agent's
    words would report that nearly every caller asked about fees, because the
    agent mentions them while answering.
    """
    if not transcript:
        return ""
    said = []
    for line in transcript.split("\n"):
        stripped = line.strip()
        if stripped.lower().startswith("user:"):
            said.append(stripped.split(":", 1)[1])
    # Fall back to the whole transcript only if it carries no speaker labels at
    # all, which is better than detecting nothing.
    return " ".join(said).lower() if said else transcript.lower()


def detect_topics(transcript: str, with_evidence: bool = False):
    """
    Topics the CALLER raised.

    Returns a sorted list of labels, or {label: [matched phrases]} when
    with_evidence is set — the evidence exists so a surprising count can always
    be traced back to the words that produced it.
    """
    text = caller_utterances(transcript)
    if not text:
        return {} if with_evidence else []

    found = {}
    for topic, patterns in _PATTERNS.items():
        hits = [kw for kw, pattern in patterns if pattern.search(text)]
        if hits:
            found[topic] = hits

    return found if with_evidence else sorted(found.keys())


def knowledge_coverage(db, school_id: str = None) -> Dict[str, bool]:
    """
    Which topics this school can actually answer, judged by whether its
    knowledge base contains the words at all.

    This is the point of the whole exercise. Knowing that 40 parents asked
    about scholarships is interesting; knowing the agent had nothing to tell
    any of them is what gets the page written. Checked against the school's own
    scraped content, so it is specific to that school rather than assumed.
    """
    from src.db import KnowledgeChunk

    q = db.query(KnowledgeChunk.content)
    if school_id:
        q = q.filter(KnowledgeChunk.school_id == school_id)
    corpus = " ".join((row[0] or "") for row in q.all()).lower()

    coverage = {}
    for topic, patterns in _PATTERNS.items():
        # A topic counts as covered if the knowledge base mentions any of its
        # terms more than once — a single incidental mention is not an answer.
        total = sum(len(pattern.findall(corpus)) for _, pattern in patterns)
        coverage[topic] = total >= 2
    return coverage
