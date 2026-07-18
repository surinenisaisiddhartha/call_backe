"""
setup_retell_agent.py

Creates (once) or updates (on every re-run) the single shared Retell AI
"Arjun" agent for Aegis Calling Manager, using agent_prompt.md as the
ENTIRE system prompt — nothing else, no default template content.

Behaviour:
- First run: creates a Retell LLM Response Engine with your prompt + tools,
  creates an Agent on top of it, and saves both ids to retell_agent_state.json.
- Every subsequent run: finds the saved ids, PATCHES the existing LLM's
  general_prompt (so prompt edits go live without creating a new agent), and
  does NOT create a second agent. This is what guarantees "once created,
  only that agent should be used."

Usage:
    pip install retell-sdk python-dotenv --break-system-packages
    export RETELL_API_KEY=your_key
    export WEBHOOK_BASE_URL=https://your-ngrok-or-prod-domain/api/webhooks
    python setup_retell_agent.py
"""

import os
import json
import sys
from pathlib import Path

from retell import Retell

STATE_FILE = Path(__file__).parent / "retell_agent_state.json"
PROMPT_FILE = Path(__file__).parent / "agent_prompt.md"

# Load dotenv if present
from dotenv import load_dotenv
load_dotenv()

RETELL_API_KEY = os.environ.get("RETELL_API_KEY")
WEBHOOK_BASE_URL = os.environ.get("WEBHOOK_BASE_URL")

# Load the shared Postgres settings table to fill any gaps (env vars win).
try:
    import sys as _sys
    _sys.path.insert(0, str(Path(__file__).parent))
    from src.db import SessionLocal, Settings as SettingsModel
    _db = SessionLocal()
    settings_map = {s.key: s.value for s in _db.query(SettingsModel).all()}
    _db.close()
except Exception as db_err:
    settings_map = {}
    print(f"[SETUP] Note: could not load settings from database: {db_err}")

if not RETELL_API_KEY:
    RETELL_API_KEY = settings_map.get("retell_api_key")
if not WEBHOOK_BASE_URL:
    ngrok_url = settings_map.get("ngrok_url")
    if ngrok_url:
        WEBHOOK_BASE_URL = f"{ngrok_url.rstrip('/')}/api/webhooks"

VOICE_ID = os.environ.get("RETELL_VOICE_ID", "11labs-Monika")
AGENT_NAME = "TSRA Admissions Assistant - Arjun"

# Retell-native knowledge base id ("TSRA School Info") — created once via the
# Retell API from the TSRA site URLs + static fact sheets, with auto-refresh
# enabled so Retell re-scrapes the site itself. Attached to the LLM on every
# setup run so it can never be silently detached.
KNOWLEDGE_BASE_ID = os.environ.get("RETELL_KNOWLEDGE_BASE_ID", "knowledge_base_76fd44f08752bcb8")

# Optional shared secret sent as a header on every custom tool call so the
# backend can verify these webhook requests actually came from Retell (see
# verify_tools_secret in src/routers/tools.py). Set the same value in
# Settings -> aegis_tools_secret (or AEGIS_TOOLS_SECRET env var) on the backend.
AEGIS_TOOLS_SECRET = os.environ.get("AEGIS_TOOLS_SECRET", "") or settings_map.get("aegis_tools_secret", "")
if not AEGIS_TOOLS_SECRET:
    print("[SETUP] WARNING: AEGIS_TOOLS_SECRET not set — tool webhook calls will be unauthenticated until you set one (Settings -> aegis_tools_secret or the env var) and re-run this script.")

if not RETELL_API_KEY:
    sys.exit("ERROR: set RETELL_API_KEY in your environment/database first.")
if not WEBHOOK_BASE_URL:
    sys.exit("ERROR: set WEBHOOK_BASE_URL (your ngrok/prod base URL) first.")
if not PROMPT_FILE.exists():
    sys.exit(f"ERROR: {PROMPT_FILE} not found. Put agent_prompt.md next to this script.")

client = Retell(api_key=RETELL_API_KEY)


def load_state():
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {}


def save_state(state: dict):
    STATE_FILE.write_text(json.dumps(state, indent=2))


def build_general_tools():
    """
    The four custom function tools the agent can call mid-conversation.
    URLs point at your FastAPI backend's tool webhook endpoints.
    Match these names EXACTLY to what agent_prompt.md Section 10 references.
    """
    base = WEBHOOK_BASE_URL.rstrip("/")
    tool_headers = {"X-Aegis-Tools-Secret": AEGIS_TOOLS_SECRET} if AEGIS_TOOLS_SECRET else None
    tools = [
        {
            "type": "custom",
            "name": "lookup_school_info",
            "description": (
                "REQUIRED before answering ANY factual question about The Shri "
                "Ram Academy (curriculum, admissions, fees, campus, facilities, "
                "contact details, events, hostel/boarding, transport, etc). You "
                "MUST actually call this function — never skip straight to "
                "apologizing or saying you don't have information without "
                "having called it first. Never answer from memory; school "
                "details change."
            ),
            "url": f"{base}/tools/lookup",
            "method": "POST",
            "speak_during_execution": True,
            "speak_after_execution": True,
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The caller's question, in their own words.",
                    }
                },
                "required": ["query"],
            },
            "timeout_ms": 15000,
        },
        {
            "type": "custom",
            "name": "schedule_callback",
            "description": (
                "REQUIRED to actually schedule a callback. You MUST call this "
                "as soon as the caller confirms when they want to be called back "
                "— nothing is scheduled until you call it. Never say you'll call "
                "them back without calling this first. Resolve relative "
                "expressions (e.g. 'in 10 minutes', 'tomorrow evening') into an "
                "absolute ISO datetime using current_datetime as the anchor "
                "BEFORE calling. You do NOT need the caller's phone number."
            ),
            "url": f"{base}/tools/schedule-callback",
            "method": "POST",
            "speak_during_execution": True,
            "speak_after_execution": True,
            "parameters": {
                "type": "object",
                "properties": {
                    "datetime_iso": {
                        "type": "string",
                        "description": "Resolved absolute callback time, ISO 8601, e.g. 2026-07-02T18:00:00+05:30",
                    },
                    "reason": {
                        "type": "string",
                        "description": "Short reason, e.g. 'requested callback'.",
                    },
                },
                "required": ["datetime_iso", "reason"],
            },
            # 8000ms was too tight: the DB round-trip to the remote Postgres
            # plus APScheduler job registration occasionally exceeded it,
            # causing Retell to abort with ECONNABORTED even though the
            # backend would have succeeded a moment later. Raised to give
            # real headroom.
            "timeout_ms": 20000,
        },
        {
            "type": "custom",
            "name": "book_appointment",
            "description": (
                "REQUIRED to create any campus visit / counseling booking. You "
                "MUST call this function as soon as the caller has confirmed a "
                "date, time, and purpose — nothing is booked until you call it. "
                "Never promise, describe, or claim a booking (or a booking "
                "problem) without actually calling this. You do NOT need the "
                "caller's phone number; the system already has it."
            ),
            "url": f"{base}/tools/book-appointment",
            "method": "POST",
            "speak_during_execution": True,
            "speak_after_execution": True,
            "parameters": {
                "type": "object",
                "properties": {
                    "datetime_iso": {"type": "string", "description": "Resolved absolute appointment time, ISO 8601."},
                    "purpose": {"type": "string", "description": "e.g. 'campus tour', 'admission counseling'."},
                    "attendee_name": {"type": "string", "description": "Caller's name (optional — the backend already knows it)."},
                    "attendee_phone": {"type": "string", "description": "Optional — leave blank; the backend uses the number that was dialed. Do NOT ask the caller for their phone number just to book."},
                    "attendee_email": {"type": "string", "description": "The caller's confirmed or collected email ID (for the confirmation email)."},
                },
                "required": ["datetime_iso", "purpose"],
            },
            # Same reasoning as schedule_callback's timeout: give the remote
            # Postgres round-trip real headroom instead of aborting early.
            "timeout_ms": 20000,
        },
        {
            "type": "custom",
            "name": "mark_outcome",
            "description": (
                "Call this EXACTLY ONCE, right before ending every call, to "
                "record what happened."
            ),
            "url": f"{base}/tools/mark-outcome",
            "method": "POST",
            "speak_during_execution": False,
            "speak_after_execution": False,
            "parameters": {
                "type": "object",
                "properties": {
                    "outcome": {
                        "type": "string",
                        "enum": [
                            "interested_followup_scheduled",
                            "appointment_booked",
                            "not_interested",
                            "do_not_call",
                            "wrong_number",
                            "no_answer",
                            "undetermined",
                        ],
                    },
                    "notes": {"type": "string"},
                },
                "required": ["outcome"],
            },
            "timeout_ms": 12000,
        },
        {
            "type": "end_call",
            "name": "end_call",
            "description": "Call this to hang up the phone and end the call immediately."
        }
    ]

    if tool_headers:
        for tool in tools:
            if tool["type"] == "custom":
                tool["headers"] = tool_headers

    return tools


def main():
    general_prompt = PROMPT_FILE.read_text()
    general_tools = build_general_tools()
    state = load_state()

    if "llm_id" in state and "agent_id" in state:
        # --- REUSE PATH: update the existing LLM's prompt, don't create anything new ---
        llm_id = state["llm_id"]
        agent_id = state["agent_id"]
        print(f"Found existing agent (agent_id={agent_id}, llm_id={llm_id}).")
        print("Updating its prompt + tools in place (no new agent created)...")

        client.llm.update(
            llm_id,
            general_prompt=general_prompt,
            general_tools=general_tools,
            # gpt-4.1 for stronger reasoning (better time-expression parsing and
            # intent handling on messy real calls). Trades a little latency for
            # accuracy; mini was tried and reverted.
            model="gpt-4.1",
            model_high_priority=True,
            # Retell-native knowledge base ("TSRA School Info"): semantic
            # retrieval over the school's site + static facts, auto-injected
            # into the conversation. Far more robust to messy real-caller
            # phrasing than the keyword lookup tool (which stays as fallback).
            # Passed explicitly on every update so a re-run can never detach it.
            knowledge_base_ids=[KNOWLEDGE_BASE_ID] if KNOWLEDGE_BASE_ID else None,
        )
        print("Prompt updated successfully. Existing agent will use the new prompt on its next call.")
        if KNOWLEDGE_BASE_ID:
            print(f"Native knowledge base attached: {KNOWLEDGE_BASE_ID}")

        new_voice_id = VOICE_ID
        new_webhook_url = f"{WEBHOOK_BASE_URL.rstrip('/')}/retell"
        client.agent.update(
            agent_id,
            agent_name=AGENT_NAME,
            voice_id=new_voice_id,
            end_call_after_silence_ms=30000,
            # "multi" is Retell's legacy catch-all covering 10 languages
            # (incl. Hindi, Spanish, Russian) and is documented to misdetect
            # between them mid-call — seen directly in transcripts as random
            # Spanish/Russian words when the caller was speaking Hindi.
            # Narrowing to an explicit locale array (per Retell SDK's
            # agent_update_params.py) restricts detection to just these,
            # and en-IN (vs en-US) is tuned for Indian accents/Hinglish.
            # Agent now converses in English, Hindi, or Tamil (agent_prompt.md
            # Hard Rule 7). NOTE: Retell has NO Telugu locale at all anywhere
            # on the platform (confirmed via docs.retellai.com/build/
            # language-support — no te-IN, no provider covers it for STT or
            # TTS) — this is a hard platform ceiling, not a config gap.
            language=["en-IN", "hi-IN", "ta-IN"],
            webhook_url=new_webhook_url,
            # Max responsiveness: agent starts speaking as soon as it can,
            # trimming the pause before each reply.
            responsiveness=1,
            # 0.4 was tried to stop background noise/line static from falsely
            # triggering "user interrupted" and chopping the agent's speech.
            # That overcorrected the other way: real callers speaking over the
            # agent stopped interrupting it at all — the agent just talked
            # through them. Raised to a middle value so genuine caller speech
            # reliably interrupts, without being as trigger-happy as the
            # (likely ~0.7-1.0) platform default that caused the original
            # noise-triggered choppiness.
            interruption_sensitivity=0.6,
        )
        print(f"Voice updated to: {new_voice_id} (silence timeout: 30s, language: en-IN + hi-IN)")
        print(f"Call-lifecycle webhook_url updated to: {new_webhook_url}")
        print("interruption_sensitivity set to 0.6 (balanced: real interruptions work, noise-triggered chopping stays reduced).")


        print(f"agent_id to use in your backend/.env: {agent_id}")
        return

    # --- FIRST-RUN PATH: create LLM, then Agent, then persist ids ---
    print("No existing agent found in state file — creating for the first time...")

    llm_response = client.llm.create(
        general_prompt=general_prompt,
        general_tools=general_tools,
        model="gpt-4.1",
        # start_speaker left as default; begin_message left unset so the LLM
        # generates the opening line dynamically per agent_prompt.md Section 3
    )
    llm_id = llm_response.llm_id
    print(f"Created Retell LLM: {llm_id}")

    agent_response = client.agent.create(
        response_engine={"llm_id": llm_id, "type": "retell-llm"},
        voice_id=VOICE_ID,
        agent_name=AGENT_NAME,
        webhook_url=f"{WEBHOOK_BASE_URL.rstrip('/')}/retell",
        # See the matching comment in the update-path above: explicit locale
        # array instead of legacy "multi" to avoid Hindi/Spanish/Russian
        # cross-detection. Telugu is not supported anywhere on the platform.
        language=["en-IN", "hi-IN", "ta-IN"],
        end_call_after_silence_ms=30000,
    )
    agent_id = agent_response.agent_id
    print(f"Created Agent: {agent_id}")

    save_state({"llm_id": llm_id, "agent_id": agent_id})
    print(f"Saved to {STATE_FILE} — future runs will UPDATE this agent, not create a new one.")
    print()
    print("Next steps:")
    print(f"  1. Put RETELL_AGENT_ID={agent_id} in your backend's Settings/.env")
    print(f"  2. Confirm webhook URL in Retell dashboard matches: {WEBHOOK_BASE_URL.rstrip('/')}/retell")
    print(f"  3. Make a test call and confirm the agent opens with the TSRA greeting, not a generic one.")


if __name__ == "__main__":
    main()
