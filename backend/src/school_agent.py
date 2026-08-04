"""
Per-school Retell agent provisioning.

agent_prompt.md remains the single canonical prompt template; this module
renders it for a specific school by substituting the school-specific literals
(name, location, contact phone) that the template was originally written with,
then creates/updates that school's own dedicated Retell LLM + Agent.

The original single-tenant agent (the default 'shri-ram-academy' school) keeps
working untouched — setup_retell_agent.py still manages it at startup.
"""
import os
from pathlib import Path

PROMPT_FILE = Path(__file__).parent.parent / "agent_prompt.md"

# The literals the template was authored with — each maps to a School column.
_TEMPLATE_SCHOOL_NAME_FULL = "The Shri Ram Academy"
_TEMPLATE_SCHOOL_NAME = "Shri Ram Academy"
_TEMPLATE_LOCATION_FULL = "Gachibowli, Hyderabad"
_TEMPLATE_LOCALITY = "Gachibowli"
_TEMPLATE_PHONE = "+91 7569891111"
_TEMPLATE_ABBREVIATION = "TSRA"

VOICE_ID_DEFAULT = "11labs-Monika"


# ── Post-call analysis ───────────────────────────────────────────────────
# Retell runs an LLM over the finished transcript and returns these as
# `custom_analysis_data` on the call_analyzed webhook. Without this list it
# returns an empty {} and all we get is a generic one-paragraph summary.
#
# Kept deliberately small. Every field is another thing the analysis model has
# to judge, and a long list makes each answer shallower — these are the four
# an admissions team actually acts on, plus the two that make a lead findable.
POST_CALL_ANALYSIS_FIELDS = [
    {
        "type": "string",
        "name": "call_synopsis",
        "description": (
            "A detailed account of how the call actually went, in 3-6 sentences. "
            "Cover what the caller wanted, what they were told, any hesitation or "
            "objection they raised, and how it ended. Write about what was really "
            "said — do not pad it with generic sales language."
        ),
    },
    {
        "type": "enum",
        "name": "primary_topic",
        "description": (
            "The ONE subject this caller cared about most. Pick the closest "
            "category even if they used different words — someone asking 'how much "
            "per year', 'what is the cost', or 'any discount for siblings' is all "
            "Fees. Policies covers rules and conditions: refund, uniform, "
            "attendance, leave, discipline. NoQuestions means they asked nothing."
        ),
        "choices": [
            "Fees", "Admissions", "Curriculum", "Facilities", "Transport",
            "Hostel", "Timings", "Location", "Policies", "Other", "NoQuestions",
        ],
    },
    {
        "type": "string",
        "name": "topics_discussed",
        "description": (
            "EVERY subject raised, as a comma-separated list using ONLY these exact "
            "words: Fees, Admissions, Curriculum, Facilities, Transport, Hostel, "
            "Timings, Location, Policies, Other. Do not invent other labels and do "
            "not write a sentence — this list is counted across calls, so the exact "
            "words matter. Answer 'none' if they asked nothing."
        ),
    },
    {
        "type": "enum",
        "name": "engagement_quality",
        "description": (
            "How seriously this caller was actually engaging, which is NOT the same "
            "as being polite or staying on the line. "
            "Serious = genuinely evaluating the school, asked substantive questions, "
            "gave real answers about their child. "
            "Casual = engaged pleasantly but non-committal, browsing, would not give "
            "details, agreed to things just to end the call politely. "
            "NotInterested = made clear they do not want this. "
            "Unclear = too short or garbled to judge."
        ),
        "choices": ["Serious", "Casual", "NotInterested", "Unclear"],
    },
    {
        "type": "enum",
        "name": "interest_level",
        "description": (
            "How interested the caller sounded, judged on what they said and how "
            "they engaged — not on whether anything was booked. "
            "Hot = keen, asked real questions, wants to proceed. "
            "Warm = open but not committing, wants time or more information. "
            "Cold = disengaged, unhappy, or clearly not pursuing it. "
            "Unclear = too short or too garbled to judge."
        ),
        "choices": ["Hot", "Warm", "Cold", "Unclear"],
    },
    {
        "type": "enum",
        "name": "caller_type",
        "description": (
            "Who we actually reached. Parent = a parent or guardian enquiring for "
            "their child. Student = the prospective student. WrongNumber = not the "
            "person we asked for and no connection to them. NotAvailable = the right "
            "household but the person could not talk. Other = anyone else, such as an "
            "agent or consultant."
        ),
        "choices": ["Parent", "Student", "WrongNumber", "NotAvailable", "Other"],
    },
    {
        "type": "string",
        "name": "concerns_raised",
        "description": (
            "Any hesitation, objection or blocker the caller expressed — cost, "
            "distance, timing, comparing other schools, needing to consult a spouse. "
            "Quote or closely paraphrase them. Answer 'none' if they raised nothing."
        ),
    },
    {
        "type": "string",
        "name": "recommended_next_step",
        "description": (
            "One concrete sentence on what the admissions team should do next for "
            "this specific lead, based on what was said."
        ),
    },
]


def get_school_agent_id(db, contact) -> str | None:
    """
    The Retell agent to dial a given contact with: their school's own agent,
    whose prompt carries that school's name/location/phone. Returns None for
    contacts with no school (pre-multitenancy rows) or a school whose agent
    wasn't provisioned — callers fall back to the shared default agent.
    """
    if contact is None or not getattr(contact, "school_id", None):
        return None
    from src.db import School
    school = db.query(School).filter(School.id == contact.school_id).first()
    return school.retell_agent_id if school and school.retell_agent_id else None


def render_school_prompt(school) -> str:
    """Render agent_prompt.md with this school's identity substituted in."""
    text = PROMPT_FILE.read_text(encoding="utf-8")

    name = (school.name or "").strip()
    name_no_article = name[4:] if name.lower().startswith("the ") else name
    name_full = name if name.lower().startswith("the ") else f"The {name}"
    location = (school.location or "").strip() or _TEMPLATE_LOCATION_FULL
    locality = location.split(",")[0].strip()
    phone = (school.contact_phone or "").strip() or _TEMPLATE_PHONE
    abbreviation = "".join(w[0] for w in name_no_article.split() if w and w[0].isalpha()).upper() or _TEMPLATE_ABBREVIATION

    # Is this the very school the template was written about? Then the prompt
    # already says exactly the right thing and must be used verbatim.
    # Substituting anyway is not the harmless no-op it looks like:
    #   - the derived abbreviation of "Shri Ram Academy" is "SRA", not "TSRA",
    #     so the line **Never say the abbreviation "TSRA" out loud** got
    #     rewritten to forbid "SRA" instead — un-guarding the one abbreviation
    #     the agent must never speak, and
    #   - "an IB day-boarding school" is true of this school, so the generic
    #     rewrite below downgraded an accurate description to a vague one.
    # Both fired every time the Schools page re-provisioned this school after
    # a name/location/phone edit.
    if name_full == _TEMPLATE_SCHOOL_NAME_FULL:
        return text

    # Order matters: longest literals first so partial overlaps can't corrupt
    # the longer strings (e.g. replacing "Shri Ram Academy" before
    # "The Shri Ram Academy" would break the latter).
    text = text.replace(_TEMPLATE_SCHOOL_NAME_FULL, name_full)
    text = text.replace(_TEMPLATE_SCHOOL_NAME, name_no_article)
    text = text.replace(_TEMPLATE_LOCATION_FULL, location)
    text = text.replace(_TEMPLATE_LOCALITY, locality)
    text = text.replace(_TEMPLATE_PHONE, phone)
    text = text.replace(_TEMPLATE_ABBREVIATION, abbreviation)
    # "an IB day-boarding school" is a factual claim about the template's
    # original school — don't assert it about a different one.
    text = text.replace("an IB day-boarding school", "a school")
    return text


def provision_school_agent(school, retell_api_key: str, webhook_base_url: str, aegis_tools_secret: str = "") -> dict:
    """
    Creates (or updates, if ids already exist) the school's dedicated Retell
    LLM + Agent. Returns {"agent_id": ..., "llm_id": ...}. Raises on failure —
    callers decide whether provisioning failure blocks onboarding.
    """
    from retell import Retell
    from setup_retell_agent import build_general_tools

    client = Retell(api_key=retell_api_key)
    prompt = render_school_prompt(school)
    tools = build_general_tools(webhook_base_url, aegis_tools_secret)
    voice_id = os.environ.get("RETELL_VOICE_ID", VOICE_ID_DEFAULT)
    agent_name = f"{school.name} Admissions Assistant - Maya"
    webhook_url = f"{webhook_base_url.rstrip('/')}/retell"

    llm_kwargs = dict(
        general_prompt=prompt,
        general_tools=tools,
        model="gpt-4.1",
        model_high_priority=True,
        knowledge_base_ids=[school.knowledge_base_id] if school.knowledge_base_id else None,
    )
    agent_kwargs = dict(
        agent_name=agent_name,
        voice_id=voice_id,
        end_call_after_silence_ms=30000,
        language=["en-IN", "hi-IN", "ta-IN"],
        webhook_url=webhook_url,
        responsiveness=1,
        interruption_sensitivity=0.6,
        post_call_analysis_data=POST_CALL_ANALYSIS_FIELDS,
    )

    if school.retell_llm_id and school.retell_agent_id:
        client.llm.update(school.retell_llm_id, **llm_kwargs)
        client.agent.update(school.retell_agent_id, **agent_kwargs)
        print(f"[SCHOOL AGENT] Updated agent for '{school.name}': {school.retell_agent_id}")
        return {"agent_id": school.retell_agent_id, "llm_id": school.retell_llm_id}

    llm = client.llm.create(**llm_kwargs)
    agent = client.agent.create(
        response_engine={"llm_id": llm.llm_id, "type": "retell-llm"},
        **agent_kwargs,
    )
    print(f"[SCHOOL AGENT] Created agent for '{school.name}': {agent.agent_id} (llm {llm.llm_id})")
    return {"agent_id": agent.agent_id, "llm_id": llm.llm_id}
