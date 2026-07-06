"""
Agent Management Router - API endpoints for managing local Retell AI agent.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from src.db import get_db, Settings
from src.routers.auth import get_current_user
from src.agent_manager import create_retell_agent, update_agent_prompt, get_or_create_local_agent, AGENT_PROMPT_TEMPLATE

router = APIRouter(prefix="/api/agent", tags=["Agent Management"])


@router.get("/prompt")
def get_agent_prompt():
    """Get the current static agent prompt template."""
    return {
        "prompt": AGENT_PROMPT_TEMPLATE,
        "description": "Static agent prompt with placeholders for {name} and {notes}"
    }


@router.post("/create")
def create_agent(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Create a new local Retell AI agent with static prompt."""
    from src.agent_manager import get_static_agent_prompt
    
    # Get API key
    api_key_setting = db.query(Settings).filter(Settings.key == "retell_api_key").first()
    api_key = (api_key_setting.value if api_key_setting else None) or ""
    
    if not api_key or api_key == "YOUR_RETELL_API_KEY":
        raise HTTPException(status_code=400, detail="Valid Retell API key required")
    
    # Create agent
    agent_id = create_retell_agent(api_key, "Local Education Outreach Agent")
    
    if not agent_id:
        raise HTTPException(status_code=500, detail="Failed to create agent")
    
    # Save to settings
    existing = db.query(Settings).filter(Settings.key == "local_agent_id").first()
    if existing:
        existing.value = agent_id
    else:
        setting = Settings(key="local_agent_id", value=agent_id)
        db.add(setting)
    
    db.commit()
    
    return {
        "success": True,
        "agent_id": agent_id,
        "message": "Local agent created successfully"
    }


@router.post("/update-prompt")
def update_prompt(
    new_prompt: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Update the local agent's prompt."""
    # Get API key and agent ID
    api_key_setting = db.query(Settings).filter(Settings.key == "retell_api_key").first()
    api_key = (api_key_setting.value if api_key_setting else None) or ""
    
    agent_setting = db.query(Settings).filter(Settings.key == "local_agent_id").first()
    agent_id = agent_setting.value if agent_setting else None
    
    if not api_key or not agent_id:
        raise HTTPException(status_code=400, detail="API key and agent ID required")
    
    # Update agent
    success = update_agent_prompt(api_key, agent_id, new_prompt)
    
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update agent prompt")
    
    return {
        "success": True,
        "message": "Agent prompt updated successfully"
    }


@router.get("/status")
def get_agent_status(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Get the status of the local agent."""
    agent_setting = db.query(Settings).filter(Settings.key == "local_agent_id").first()
    
    return {
        "has_local_agent": agent_setting is not None and agent_setting.value is not None,
        "agent_id": agent_setting.value if agent_setting else None
    }


@router.delete("/reset")
def reset_agent(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Delete the local agent reference (falls back to external agent)."""
    agent_setting = db.query(Settings).filter(Settings.key == "local_agent_id").first()
    if agent_setting:
        db.delete(agent_setting)
        db.commit()
    
    return {
        "success": True,
        "message": "Local agent reference removed. Will use external agent."
    }
