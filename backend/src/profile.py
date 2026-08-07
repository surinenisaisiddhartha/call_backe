"""
The 20-point lead profile — what we try to learn about every enquiry.

WHY THIS IS CAPTURED MID-CALL RATHER THAN EXTRACTED AFTERWARDS
The alternative was a second LLM pass over the finished transcript. This is
better on three counts that matter here:

  * It records what the parent actually SAID, not what a model inferred they
    meant. "Around two lakhs" becomes budget_band=1to2L because the agent
    heard it, not because a summariser guessed.
  * It survives a dropped call. Half a conversation still yields half a
    profile, where post-call extraction over a truncated transcript tends to
    yield nothing usable.
  * It costs nothing extra per call. At 1,000-10,000 calls a day a second
    analysis pass per call is a real line item.

The trade-off is prompt weight: the agent has to be told to gather these
without turning a conversation into an interrogation. See agent_prompt.md.

WHY NOT JUST ADD THEM TO POST_CALL_ANALYSIS_FIELDS
That list is deliberately short (school_agent.py). Every field added to it is
another judgement the analysis model makes in one pass, and a long list makes
each answer shallower. Those eight fields judge the CALL; these twenty record
FACTS about the family. Different jobs, different mechanisms.

PARTIAL UPDATES ARE THE NORMAL CASE
The agent calls save_profile whenever it learns something — typically three or
four times across a call, each with only the fields it just heard. Writes MERGE:
a field absent from the payload leaves the stored value alone. Overwriting a
known value with null because the caller didn't repeat it would make the
profile get worse the longer the conversation ran.
"""
from typing import Optional

# name -> (kind, choices, description)
# kind "enum" constrains the agent to a fixed vocabulary because these values
# are counted and filtered on downstream; "string" is free text.
#
# THIS LIST IS THE SINGLE SOURCE OF TRUTH. The Contact columns, the Retell
# tool schema and the API responses are all derived from it, and db.py asserts
# at startup that the model matches — so adding a field here and nowhere else
# fails loudly instead of silently dropping data.
PROFILE_FIELDS = [
    # ── Who the child is ──────────────────────────────────────────────────
    {
        "name": "child_name",
        "kind": "string",
        "description": "The child's name, if the caller gives it.",
    },
    {
        "name": "child_age",
        "kind": "string",
        "description": "The child's age as stated, e.g. '5', '5 years', 'turning 6 in March'.",
    },
    {
        "name": "grade_sought",
        "kind": "string",
        "description": (
            "The grade or class the caller wants admission INTO, as they say it "
            "— 'Nursery', 'LKG', 'Grade 5', 'Class 8', '11th commerce'."
        ),
    },
    {
        "name": "academic_year",
        "kind": "string",
        "description": "The intake year they are asking about, e.g. '2026-27'.",
    },
    {
        "name": "current_school",
        "kind": "string",
        "description": "The school the child attends now, if mentioned. 'None' if not yet schooling.",
    },

    # ── Fit ───────────────────────────────────────────────────────────────
    {
        "name": "board_preference",
        "kind": "enum",
        "choices": ["CBSE", "ICSE", "IB", "IGCSE", "State", "Undecided"],
        "description": "Which curriculum/board the caller wants.",
    },
    {
        "name": "locality",
        "kind": "string",
        "description": "Where the family lives — area, suburb or landmark as they say it.",
    },
    {
        "name": "sibling_status",
        "kind": "enum",
        "choices": ["AlreadyEnrolled", "ApplyingTogether", "NoSiblings", "Unknown"],
        "description": (
            "Whether a sibling already studies here (AlreadyEnrolled), is being "
            "applied for at the same time (ApplyingTogether), or there is no "
            "sibling (NoSiblings)."
        ),
    },
    {
        "name": "transport_needed",
        "kind": "enum",
        "choices": ["Yes", "No", "Unknown"],
        "description": "Whether the family needs school transport.",
    },
    {
        "name": "boarding_needed",
        "kind": "enum",
        "choices": ["DayScholar", "DayBoarding", "Residential", "Unknown"],
        "description": "Which attendance mode the family wants.",
    },
    {
        "name": "special_requirements",
        "kind": "string",
        "description": (
            "Any specific need raised — learning support, medical condition, "
            "dietary requirement, sports or music focus. 'none' if nothing raised."
        ),
    },

    # ── Money ─────────────────────────────────────────────────────────────
    {
        "name": "budget_band",
        "kind": "enum",
        "choices": ["Under1L", "1to2L", "2to3L", "3to5L", "Above5L", "NotDiscussed"],
        "description": (
            "The annual fee range the family is comfortable with, in Indian rupees. "
            "Map what they say: 'around two lakhs' is 1to2L, 'under one lakh' is "
            "Under1L. Use NotDiscussed if budget never came up — do NOT guess."
        ),
    },

    # ── Intent ────────────────────────────────────────────────────────────
    {
        "name": "competition_considered",
        "kind": "string",
        "description": (
            "Other schools the family names as also being considered. 'none' if "
            "they mention no others."
        ),
    },
    {
        "name": "decision_timeline",
        "kind": "enum",
        "choices": ["Immediate", "ThisMonth", "ThisQuarter", "NextYear", "Unknown"],
        "description": "How soon they intend to decide.",
    },
    {
        "name": "decision_maker",
        "kind": "enum",
        "choices": ["Self", "Spouse", "Both", "ExtendedFamily", "Unknown"],
        "description": (
            "Who decides. Spouse means the person on the call must consult "
            "someone else before committing."
        ),
    },
    {
        "name": "admission_urgency",
        "kind": "enum",
        "choices": ["Urgent", "Planned", "JustExploring", "Unknown"],
        "description": (
            "Urgent = needs a seat now, often mid-year or relocating. Planned = "
            "normal cycle. JustExploring = gathering information with no intent yet."
        ),
    },
    {
        "name": "campus_visit_interest",
        "kind": "enum",
        "choices": ["Yes", "No", "AlreadyVisited", "Unknown"],
        "description": "Whether they want to visit the campus.",
    },

    # ── How to reach them ─────────────────────────────────────────────────
    {
        "name": "referral_source",
        "kind": "string",
        "description": "How they heard about the school — friend, hoarding, Google, event.",
    },
    {
        "name": "preferred_contact_time",
        "kind": "string",
        "description": "When they prefer to be called, in their own words.",
    },
    {
        "name": "language_preference",
        "kind": "enum",
        "choices": ["English", "Hindi", "Telugu", "Other", "Unknown"],
        "description": (
            "The language the caller would rather be spoken to in. Record it even "
            "if the call continues in English — it tells the counselor who calls "
            "back which language to use."
        ),
    },
]

FIELD_NAMES = [f["name"] for f in PROFILE_FIELDS]
_FIELDS_BY_NAME = {f["name"]: f for f in PROFILE_FIELDS}

assert len(PROFILE_FIELDS) == 20, f"the 20-point profile has {len(PROFILE_FIELDS)} points"
assert len(FIELD_NAMES) == len(set(FIELD_NAMES)), "duplicate profile field name"


def build_tool_parameters() -> dict:
    """
    The JSON-schema `parameters` block for the save_profile Retell tool.

    Every field is optional: the agent calls this repeatedly with whatever it
    has just learned, and requiring anything would push it to invent values to
    satisfy the schema.
    """
    properties = {}
    for field in PROFILE_FIELDS:
        prop = {"type": "string", "description": field["description"]}
        if field["kind"] == "enum":
            prop["enum"] = field["choices"]
        properties[field["name"]] = prop

    return {"type": "object", "properties": properties, "required": []}


def normalize_value(name: str, value) -> Optional[str]:
    """
    Clean one incoming value, or None to leave the stored value untouched.

    Enums are matched case-insensitively and returned in their canonical
    spelling, because these are filtered on by exact string downstream. A value
    that matches no choice is DROPPED rather than stored: a budget_band of
    "maybe 2 lakhs" would otherwise sit in the column and never match a filter,
    which is harder to notice than it simply being absent.
    """
    field = _FIELDS_BY_NAME.get(name)
    if field is None or value is None:
        return None

    text = str(value).strip()
    if not text:
        return None
    # The agent sometimes fills a field with a placeholder rather than omitting
    # it. Treat those as "not learned yet" so a later, real answer can land.
    if text.lower() in {"unknown", "n/a", "na", "null", "none given", "not mentioned", "not discussed"}:
        # "Unknown"/"NotDiscussed" ARE meaningful for enums that offer them.
        if field["kind"] == "enum":
            for choice in field["choices"]:
                if choice.lower() == text.lower().replace(" ", ""):
                    return choice
        return None

    if field["kind"] == "enum":
        squashed = text.lower().replace(" ", "").replace("_", "").replace("-", "")
        for choice in field["choices"]:
            if choice.lower() == squashed:
                return choice
        return None

    return text[:500]


def apply_profile(contact, payload: dict) -> list:
    """
    Merge a partial profile onto a Contact. Returns the field names actually
    written, so the caller can log and the tool can tell the agent what stuck.
    """
    written = []
    for name in FIELD_NAMES:
        if name not in payload:
            continue
        cleaned = normalize_value(name, payload[name])
        if cleaned is None:
            continue
        if getattr(contact, name, None) == cleaned:
            continue
        setattr(contact, name, cleaned)
        written.append(name)
    return written


def profile_dict(contact) -> dict:
    """The stored profile as a plain dict, omitting fields never learned."""
    out = {}
    for name in FIELD_NAMES:
        value = getattr(contact, name, None)
        if value:
            out[name] = value
    return out


def completeness(contact) -> int:
    """How many of the 20 points are filled — the 'profile strength' figure."""
    return len(profile_dict(contact))
