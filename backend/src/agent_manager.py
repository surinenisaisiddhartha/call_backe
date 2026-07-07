"""
Agent Manager - Creates and manages Retell AI agents with static prompts.
"""

import os
import httpx
from typing import Optional
from src.db import SessionLocal, Settings

# agent_prompt.md is the ONLY place the real persona/behaviour/rules live (see
# that file's own header). We used to keep a full hardcoded copy here as a
# fallback, but it had drifted out of sync with agent_prompt.md — different
# agent name, missing hard rules, and one rule that directly CONTRADICTED the
# real prompt (telling the agent to reply in Hindi/Telugu, when the real
# prompt requires English-only). A silently-used, silently-wrong fallback is
# worse than an obvious one, so this fallback is now a minimal fail-safe stub:
# if it's ever actually used, the agent apologizes for a technical issue and
# ends the call immediately, instead of running with a different persona or
# contradictory rules.
AGENT_PROMPT_TEMPLATE = """You are a phone assistant for The Shri Ram Academy (TSRA).
Your configuration failed to load correctly (agent_prompt.md was not found or
could not be read). Do not attempt to have a normal conversation, invent a
persona, or answer questions about the school.

Say exactly: "Hi, I'm sorry — I'm having a technical issue on my end right
now. Someone from our admissions team will call you back shortly. Thank you
for your patience!"

Then immediately call `mark_outcome` with outcome `undetermined` and notes
`agent_prompt.md failed to load`, and call `end_call` to hang up. Do not say
anything else."""

# Load the real prompt dynamically from agent_prompt.md to keep the two in sync.
try:
    current_dir = os.path.dirname(os.path.abspath(__file__))
    prompt_file_path = os.path.abspath(os.path.join(current_dir, "..", "agent_prompt.md"))
    if os.path.exists(prompt_file_path):
        with open(prompt_file_path, "r", encoding="utf-8") as f:
            AGENT_PROMPT_TEMPLATE = f.read()
    else:
        print(f"[AGENT MANAGER] CRITICAL: agent_prompt.md not found at {prompt_file_path} — falling back to a fail-safe stub prompt that ends calls immediately. Live calls will NOT behave normally until this is fixed.")
except Exception as e:
    print(f"[AGENT MANAGER] CRITICAL: Could not load agent_prompt.md ({e}) — falling back to a fail-safe stub prompt that ends calls immediately. Live calls will NOT behave normally until this is fixed.")


def get_static_agent_prompt(name: str, notes: str = "") -> str:
    """
    Generate agent prompt with student-specific information.
    
    Args:
        name: Student's name
        notes: Additional notes about the student
    
    Returns:
        Formatted agent prompt
    """
    return AGENT_PROMPT_TEMPLATE.replace(
        "{{caller_name}}", name
    ).replace(
        "{{notes}}", notes or "No additional notes available"
    )


def create_retell_agent(api_key: str, agent_name: str = "Education Outreach Agent") -> Optional[str]:
    """
    Create a new Retell AI agent with static prompt.
    
    Args:
        api_key: Retell API key
        agent_name: Name for the agent
    
    Returns:
        Agent ID if successful, None otherwise
    """
    url = "https://api.retellai.com/create-agent"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    # Base prompt without variables (variables will be injected per call)
    base_prompt = AGENT_PROMPT_TEMPLATE

    
    body = {
        "agent_name": agent_name,
        "prompt": [
            {
                "role": "system",
                "content": base_prompt
            }
        ],
        "language": "en-US",
        "voice_id": "eleven_multilingual_v2",  # Default voice, can be customized
        "beginning_message": "Hello, this is a call from our educational institution. I'm reaching out regarding your interest in our programs."
    }
    
    try:
        response = httpx.post(url, headers=headers, json=body, timeout=30.0)
        if response.status_code == 200:
            data = response.json()
            agent_id = data.get("agent_id")
            print(f"[AGENT MANAGER] Created agent: {agent_id}")
            return agent_id
        else:
            print(f"[AGENT MANAGER] Failed to create agent: {response.text}")
            return None
    except Exception as e:
        print(f"[AGENT MANAGER] Error creating agent: {e}")
        return None


def get_or_create_local_agent() -> Optional[str]:
    """
    Get existing local agent ID from settings or create a new one.
    
    Returns:
        Agent ID if successful, None otherwise
    """
    db = SessionLocal()
    try:
        # Check if local agent already exists
        existing = db.query(Settings).filter(Settings.key == "local_agent_id").first()
        if existing and existing.value:
            return existing.value
        
        # Check for existing retell_agent_id (not mock)
        fallback = db.query(Settings).filter(Settings.key == "retell_agent_id").first()
        if fallback and fallback.value and not fallback.value.startswith("agent_mock"):
            # Use existing real agent
            setting = Settings(key="local_agent_id", value=fallback.value)
            db.add(setting)
            db.commit()
            return fallback.value
        
        # Get API key
        api_key_setting = db.query(Settings).filter(Settings.key == "retell_api_key").first()
        api_key = (api_key_setting.value if api_key_setting else None) or os.getenv("RETELL_API_KEY", "")
        
        if not api_key or api_key == "YOUR_RETELL_API_KEY":
            print("[AGENT MANAGER] No valid API key found")
            return None
        
        # Create new agent
        agent_id = create_retell_agent(api_key, "Local Education Outreach Agent")
        
        if agent_id:
            # Save to settings
            setting = Settings(key="local_agent_id", value=agent_id)
            db.add(setting)
            db.commit()
            return agent_id
        
        return None
    finally:
        db.close()


def update_agent_prompt(api_key: str, agent_id: str, new_prompt: str) -> bool:
    """
    Update an existing agent's prompt.
    
    Args:
        api_key: Retell API key
        agent_id: Agent ID to update
        new_prompt: New prompt content
    
    Returns:
        True if successful, False otherwise
    """
    url = f"https://api.retellai.com/update-agent/{agent_id}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    body = {
        "prompt": [
            {
                "role": "system",
                "content": new_prompt
            }
        ]
    }
    
    try:
        response = httpx.patch(url, headers=headers, json=body, timeout=30.0)
        if response.status_code == 200:
            print(f"[AGENT MANAGER] Updated agent: {agent_id}")
            return True
        else:
            print(f"[AGENT MANAGER] Failed to update agent: {response.text}")
            return False
    except Exception as e:
        print(f"[AGENT MANAGER] Error updating agent: {e}")
        return False
