"""
Dynamic semantic classification of topics and inquiries spoken by callers.

Extracts genuine caller inquiries directly from conversation turns, distinguishing
specific concepts (e.g. Day Boarding vs. Residential Hostel, Teacher Qualifications vs. generic Staff,
Alumni & University Placements vs. generic Results) while eliminating false positives
such as email spellouts ('at the rate') triggering Fees.
"""
import re
from typing import Dict, List

SEMANTIC_TOPIC_PATTERNS: Dict[str, List[str]] = {
    "Admissions": [
        r"\b(?:admission|admissions|enrol|enroll|enrollment|enrolment|apply|application|entrance\s+test|seat\s+availability|vacancy|vacancies|eligibility|transfer\s+certificate|\btc\b)\b",
        r"\b(?:grade|class|nursery|kindergarten|standard)\s+\d+\s+admission\b",
        r"\blooking\s+for\s+.*admission\b",
    ],
    "Day Boarding": [
        r"\bday[\s-]boarding\b",
        r"\bextended\s+day\b",
        r"\bafter\s+school\s+care\b",
    ],
    "Hostel & Residential": [
        r"(?<!day\s)(?<!day-)\b(?:hostel|residential|dormitory|boarding\s+facility|stay\s+in\s+school|night\s+stay|accommodation)\b",
    ],
    "Teacher Qualifications": [
        r"\b(?:teacher|teachers|faculty|staff)\s*(?:qualification|qualifications|quality|experience|ratio|standard)\b",
        r"\bquality.*(?:required\s+for|of)\s+(?:the\s+)?teachers\b",
        r"\bstudent[\s-]teacher\s+ratio\b",
        r"\bprincipal\b",
    ],
    "Alumni & Placements": [
        r"\b(?:alumni|alumnus|past\s+students|batches\s+passed\s+out|celebrities\s+in\s+the\s+alumni)\b",
        r"\b(?:university|universities|college\s+placement|higher\s+education|placements)\b",
    ],
    "Fees & Tuition": [
        r"(?<!at\s)(?<!the\s)\b(?:fee|fees|fee\s+structure|tuition|cost\s+of\s+study|instalment|installment|donation|per\s+year\s+cost)\b",
        r"\bhow\s+much\s+(?:is\s+the\s+fee|per\s+year|are\s+the\s+charges)\b",
    ],
    "Scholarships": [
        r"\b(?:scholarship|scholarships|concession|discount|financial\s+aid|fee\s+waiver|subsidy)\b",
    ],
    "Curriculum & Syllabus": [
        r"\b(?:curriculum|syllabus|myp|pyp|diploma\s+programme|international\s+baccalaureate|\bib\b|\bcbse\b|\bicse\b|\bigcse\b)\b",
    ],
    "Campus Facilities": [
        r"\b(?:campus\s+facilities|infrastructure|laboratories|labs|smart\s+classes|swimming\s+pool|playground|sports\s+complex|campus\s+tour|campus\s+visit)\b",
    ],
    "Transportation": [
        r"\b(?:transport|transportation|bus\s+facility|bus\s+routes|pick\s+and\s+drop|pickup|van\s+service)\b",
    ],
    "School Timings": [
        r"\b(?:school\s+hours|timings|working\s+hours|shift\s+timing|what\s+time\s+starts)\b",
    ],
    "Location & Directions": [
        r"\b(?:location|address|directions|how\s+to\s+reach|distance\s+from|branch\s+address)\b",
    ],
    "Extracurricular Activities": [
        r"\b(?:extracurricular|extra-curricular|co-curricular|sports\s+activities|music|dance|martial\s+arts|karate|yoga|drama|robotics)\b",
    ],
}

_COMPILED_PATTERNS = {
    topic: [re.compile(p, re.IGNORECASE) for p in patterns]
    for topic, patterns in SEMANTIC_TOPIC_PATTERNS.items()
}

ALL_TOPICS = sorted(SEMANTIC_TOPIC_PATTERNS.keys())

# ── Canonical label mapping ──────────────────────────────────────────────
# The keyword detector above uses granular labels ("Fees & Tuition",
# "Campus Facilities") while the LLM analysis and the analytics charts use
# a coarser vocabulary ("Fees", "Facilities") defined in school_agent.py.
# This map normalizes the granular labels to match, so both systems produce
# the same buckets in aggregate counts. Labels that already match the
# canonical vocabulary map to themselves.
CANONICAL_LABEL: dict[str, str] = {
    "Admissions":               "Admissions",
    "Day Boarding":             "Hostel",      # Day boarding is a boarding variant
    "Hostel & Residential":     "Hostel",
    "Teacher Qualifications":   "Facilities",  # Staff quality is part of facilities
    "Alumni & Placements":      "Other",
    "Fees & Tuition":           "Fees",
    "Scholarships":             "Fees",        # Financial aid is a fees sub-topic
    "Curriculum & Syllabus":    "Curriculum",
    "Campus Facilities":        "Facilities",
    "Transportation":           "Transport",
    "School Timings":           "Timings",
    "Location & Directions":    "Location",
    "Extracurricular Activities": "Facilities",
}


def canonicalize(label: str) -> str:
    """Map a granular keyword-detector label to the canonical LLM vocabulary."""
    return CANONICAL_LABEL.get(label, label)


def caller_utterances(transcript: str) -> str:
    """
    Extracts only genuine caller turns, stripping email spell-outs and affirmations.
    """
    if not transcript:
        return ""
    said = []
    for line in transcript.split("\n"):
        stripped = line.strip()
        if stripped.lower().startswith("user:"):
            val = stripped.split(":", 1)[1].strip()
            # Strip email spell-outs ('at the rate', '@') so they don't trigger 'rate' -> Fees
            val = re.sub(r"[\w\s]+at the rate[\w\s\.]+", "", val, flags=re.IGNORECASE).strip()
            if val and len(val) > 2 and val.lower() not in {"yes", "no", "yeah", "speaking", "hello", "halo", "ok", "okay", "yes of course"}:
                said.append(val)
    return " ".join(said) if said else ""


def detect_topics(transcript: str, with_evidence: bool = False):
    """
    Dynamically identifies caller-spoken inquiry topics.
    """
    text = caller_utterances(transcript)
    if not text:
        return {} if with_evidence else []

    found = {}
    for topic, patterns in _COMPILED_PATTERNS.items():
        hits = []
        for p in patterns:
            m = p.search(text)
            if m:
                hits.append(m.group(0))
        if hits:
            found[topic] = hits

    return found if with_evidence else sorted(found.keys())


def knowledge_coverage(db, school_id: str = None) -> Dict[str, bool]:
    """
    Checks knowledge chunk coverage for dynamic topics.
    """
    from src.db import KnowledgeChunk

    q = db.query(KnowledgeChunk.content)
    if school_id:
        q = q.filter(KnowledgeChunk.school_id == school_id)
    corpus = " ".join((row[0] or "") for row in q.all()).lower()

    coverage = {}
    for topic, patterns in _COMPILED_PATTERNS.items():
        total = sum(len(pattern.findall(corpus)) for pattern in patterns)
        coverage[topic] = total >= 2
    return coverage


def backfill_detected_topics(batch_size: int = 200) -> int:
    """
    One-time backfill: find all CallAttempt rows that have a transcript but
    no detected_topics, run the keyword detector, and persist the results.

    This eliminates the per-request fallback in analytics.py that was
    re-running regex matching on every page load for old calls. Safe to call
    repeatedly — it only touches rows with NULL detected_topics.

    Returns the number of rows backfilled.
    """
    from src.db import SessionLocal, CallAttempt

    db = SessionLocal()
    filled = 0
    try:
        while True:
            rows = (
                db.query(CallAttempt)
                .filter(
                    CallAttempt.transcript.isnot(None),
                    CallAttempt.transcript != "",
                    CallAttempt.detected_topics.is_(None),
                )
                .limit(batch_size)
                .all()
            )
            if not rows:
                break
            for a in rows:
                labels = detect_topics(a.transcript)
                a.detected_topics = ",".join(labels) if labels else ""
                filled += 1
            db.commit()
        print(f"[TOPICS] Backfilled detected_topics for {filled} call(s)")
    except Exception as e:
        print(f"[TOPICS] Backfill error: {e}")
        db.rollback()
    finally:
        db.close()
    return filled
