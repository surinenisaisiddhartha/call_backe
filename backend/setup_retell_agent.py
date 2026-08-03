"""
setup_retell_agent.py

Creates (once) or updates (on every run) the single shared Retell AI
"Maya" agent for EnquiryCall, using agent_prompt.md as the
ENTIRE system prompt — nothing else, no default template content.

PERMANENT / DEPLOYMENT-AGNOSTIC BEHAVIOUR:
The agent's llm_id/agent_id are persisted in the shared Postgres `settings`
table (keys: local_agent_id, retell_llm_id) — NOT a local JSON file. A local
file doesn't travel with a fresh deployment (Coolify, AWS, or anywhere else),
which used to mean every new deployment had no way to find the existing
agent and either required someone to manually re-run this script with the
right env vars, or risked creating a duplicate agent. Since the database is
the one thing every deployment shares, storing the IDs there makes this
fully self-healing: `run_agent_setup()` is called automatically on backend
startup (see src/main.py) and always finds/updates the SAME agent, pointing
its webhook at whatever WEBHOOK_BASE_URL *this* deployment is running with.

A local retell_agent_state.json is still written as a convenience cache for
fast local dev, but it is never required and never the source of truth.

Manual usage (still supported):
    export RETELL_API_KEY=your_key
    export WEBHOOK_BASE_URL=https://your-domain/api/webhooks
    python setup_retell_agent.py
"""

import os
import json
import sys
from pathlib import Path

STATE_FILE = Path(__file__).parent / "retell_agent_state.json"
PROMPT_FILE = Path(__file__).parent / "agent_prompt.md"

VOICE_ID_DEFAULT = "11labs-Monika"
AGENT_NAME = "TSRA Admissions Assistant - Maya"
KNOWLEDGE_BASE_ID_DEFAULT = "knowledge_base_76fd44f08752bcb8"


def _load_db_settings() -> dict:
    """Best-effort read of the shared settings table. Never raises."""
    try:
        from src.db import SessionLocal, Settings as SettingsModel
        db = SessionLocal()
        try:
            return {s.key: s.value for s in db.query(SettingsModel).all()}
        finally:
            db.close()
    except Exception as db_err:
        print(f"[SETUP] Note: could not load settings from database: {db_err}")
        return {}


def load_state(retell_api_key: str, settings_map: dict) -> dict:
    """
    Find the existing agent/llm ids. DB settings are the source of truth
    (survive across deployments); the local JSON file is only a fallback for
    environments where the DB isn't reachable yet.
    """
    agent_id = settings_map.get("local_agent_id")
    llm_id = settings_map.get("retell_llm_id")

    if agent_id and not llm_id:
        # Migration case: an agent_id was already persisted (e.g. by
        # agent_manager.py / earlier runs) but retell_llm_id never got
        # backfilled. Look it up from the live agent instead of creating a
        # new one, then persist it so this only happens once.
        try:
            from retell import Retell
            client = Retell(api_key=retell_api_key)
            agent = client.agent.retrieve(agent_id)
            llm_id = agent.response_engine.llm_id
            print(f"[SETUP] Backfilled retell_llm_id={llm_id} from existing agent {agent_id}.")
            _save_db_setting("retell_llm_id", llm_id)
        except Exception as backfill_err:
            print(f"[SETUP] Could not backfill llm_id for existing agent {agent_id}: {backfill_err}")

    if agent_id and llm_id:
        return {"agent_id": agent_id, "llm_id": llm_id}

    # Fallback: local file (dev convenience only, not deployment-portable).
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except Exception:
            pass
    return {}


def _save_db_setting(key: str, value: str) -> None:
    try:
        from src.db import SessionLocal, Settings as SettingsModel
        db = SessionLocal()
        try:
            row = db.query(SettingsModel).filter(SettingsModel.key == key).first()
            if row:
                row.value = value
            else:
                db.add(SettingsModel(key=key, value=value))
            db.commit()
        finally:
            db.close()
    except Exception as db_err:
        print(f"[SETUP] WARNING: could not persist {key} to DB settings: {db_err}")


def save_state(state: dict) -> None:
    """Persist to DB (source of truth) and mirror to a local file (dev cache)."""
    if "agent_id" in state:
        _save_db_setting("local_agent_id", state["agent_id"])
        # Keep the legacy manual-override key in sync too, since dialer.py /
        # agent_manager.py's fallback path reads it.
        _save_db_setting("retell_agent_id", state["agent_id"])
    if "llm_id" in state:
        _save_db_setting("retell_llm_id", state["llm_id"])
    try:
        STATE_FILE.write_text(json.dumps(state, indent=2))
    except Exception:
        pass  # local file is a convenience cache only — never fatal


def build_general_tools(webhook_base_url: str, aegis_tools_secret: str):
    """
    The four custom function tools the agent can call mid-conversation.
    URLs point at your FastAPI backend's tool webhook endpoints.
    Match these names EXACTLY to what agent_prompt.md Section 10 references.
    """
    base = webhook_base_url.rstrip("/")
    tool_headers = {"X-Aegis-Tools-Secret": aegis_tools_secret} if aegis_tools_secret else None
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
            # Was 15000ms; observed hitting ECONNABORTED twice in real calls
            # despite the DB pool_pre_ping fix (idle-connection staleness isn't
            # fully caught by a single pre-flight ping under some network
            # conditions). Raised to match the other tools' safety margin.
            "timeout_ms": 20000,
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
                    "meeting_type": {
                        "type": "string",
                        "enum": ["in_person", "virtual"],
                        "description": "Whether the caller wants an in-person campus visit or a virtual online meeting. Ask the caller directly; default to 'in_person' only if they don't specify. For 'virtual', a unique meeting link is generated and emailed automatically — never read it aloud on the call.",
                    },
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


def run_agent_setup(webhook_base_url: str = None, retell_api_key: str = None, raise_on_error: bool = False) -> dict:
    """
    Idempotently create-or-update the single shared Retell agent, pointing its
    webhook + tool URLs at `webhook_base_url` (defaults to the WEBHOOK_BASE_URL
    env var / DB setting for whichever deployment calls this).

    Safe to call on every backend startup: finds the existing agent via DB
    settings and PATCHES it in place — never creates a duplicate once one
    exists. Returns {"agent_id":..., "llm_id":...} on success, or {} if
    skipped/failed (and raise_on_error is False).
    """
    from retell import Retell
    from dotenv import load_dotenv
    load_dotenv()

    settings_map = _load_db_settings()

    api_key = retell_api_key or os.environ.get("RETELL_API_KEY") or settings_map.get("retell_api_key")
    base_url = webhook_base_url or os.environ.get("WEBHOOK_BASE_URL")
    if not base_url:
        ngrok_url = settings_map.get("ngrok_url")
        if ngrok_url:
            base_url = f"{ngrok_url.rstrip('/')}/api/webhooks"

    voice_id = os.environ.get("RETELL_VOICE_ID", VOICE_ID_DEFAULT)
    knowledge_base_id = os.environ.get("RETELL_KNOWLEDGE_BASE_ID", KNOWLEDGE_BASE_ID_DEFAULT)
    aegis_tools_secret = os.environ.get("AEGIS_TOOLS_SECRET", "") or settings_map.get("aegis_tools_secret", "")

    problems = []
    if not api_key:
        problems.append("RETELL_API_KEY not set (env or Settings->retell_api_key)")
    if not base_url:
        problems.append("WEBHOOK_BASE_URL not set (env), and no ngrok_url fallback in Settings")
    if not PROMPT_FILE.exists():
        problems.append(f"{PROMPT_FILE} not found")

    if problems:
        msg = "[SETUP] Skipping Retell agent auto-configuration: " + "; ".join(problems)
        print(msg)
        if raise_on_error:
            raise RuntimeError(msg)
        return {}

    if not aegis_tools_secret:
        print("[SETUP] WARNING: AEGIS_TOOLS_SECRET not set — tool webhook calls will be unauthenticated until you set one (Settings -> aegis_tools_secret or the env var).")

    client = Retell(api_key=api_key)
    general_prompt = PROMPT_FILE.read_text()
    general_tools = build_general_tools(base_url, aegis_tools_secret)
    state = load_state(api_key, settings_map)

    if "llm_id" in state and "agent_id" in state:
        # --- REUSE PATH: update the existing LLM's prompt, don't create anything new ---
        llm_id = state["llm_id"]
        agent_id = state["agent_id"]
        print(f"[SETUP] Found existing agent (agent_id={agent_id}, llm_id={llm_id}). Updating in place...")

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
            # into the conversation. Passed explicitly every run so a re-run
            # can never silently detach it.
            knowledge_base_ids=[knowledge_base_id] if knowledge_base_id else None,
        )
        print("[SETUP] Prompt/tools updated.")

        new_webhook_url = f"{base_url.rstrip('/')}/retell"
        client.agent.update(
            agent_id,
            agent_name=AGENT_NAME,
            voice_id=voice_id,
            end_call_after_silence_ms=30000,
            # "multi" is Retell's legacy catch-all covering 10 languages
            # (incl. Hindi, Spanish, Russian) and is documented to misdetect
            # between them mid-call. Explicit locale array restricts detection
            # to just these; en-IN is tuned for Indian accents/Hinglish.
            # Retell has NO Telugu locale anywhere on the platform — hard
            # ceiling, not a config gap (agent_prompt.md Hard Rule 7 handles
            # this gracefully in-conversation).
            language=["en-IN", "hi-IN", "ta-IN"],
            webhook_url=new_webhook_url,
            responsiveness=1,
            # Balanced value: high enough that real caller interruptions work,
            # low enough that background-noise/line-static false interrupts
            # (the original choppiness complaint) stay reduced.
            interruption_sensitivity=0.6,
        )
        print(f"[SETUP] Agent updated: voice={voice_id}, webhook={new_webhook_url}")
        save_state({"llm_id": llm_id, "agent_id": agent_id})
        return {"agent_id": agent_id, "llm_id": llm_id}

    # --- FIRST-RUN PATH: create LLM, then Agent, then persist ids ---
    print("[SETUP] No existing agent found anywhere (DB or local cache) — creating for the first time...")

    llm_response = client.llm.create(
        general_prompt=general_prompt,
        general_tools=general_tools,
        model="gpt-4.1",
    )
    llm_id = llm_response.llm_id
    print(f"[SETUP] Created Retell LLM: {llm_id}")

    agent_response = client.agent.create(
        response_engine={"llm_id": llm_id, "type": "retell-llm"},
        voice_id=voice_id,
        agent_name=AGENT_NAME,
        webhook_url=f"{base_url.rstrip('/')}/retell",
        language=["en-IN", "hi-IN", "ta-IN"],
        end_call_after_silence_ms=30000,
    )
    agent_id = agent_response.agent_id
    print(f"[SETUP] Created Agent: {agent_id}")

    save_state({"llm_id": llm_id, "agent_id": agent_id})
    print("[SETUP] Persisted agent_id/llm_id to DB settings — every future deployment will reuse this same agent automatically.")
    return {"agent_id": agent_id, "llm_id": llm_id}


if __name__ == "__main__":
    try:
        result = run_agent_setup(raise_on_error=True)
        print()
        print(f"agent_id: {result.get('agent_id')}")
        print(f"llm_id:   {result.get('llm_id')}")
    except Exception as e:
        sys.exit(f"ERROR: {e}")
