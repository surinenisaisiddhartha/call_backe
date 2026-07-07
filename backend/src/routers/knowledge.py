"""
Knowledge Base Router - API endpoints for managing TSRA knowledge base.
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from src.db import get_db
from src.routers.auth import get_current_user
from src.knowledge import refresh_knowledge_base, search_knowledge, get_knowledge_status, smart_truncate

router = APIRouter(prefix="/api/knowledge", tags=["Knowledge Base"])


@router.post("/refresh")
def refresh_knowledge(
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Trigger knowledge base refresh (scrape TSRA website)."""
    background_tasks.add_task(refresh_knowledge_base)
    return {
        "success": True,
        "message": "Knowledge base refresh started in background"
    }


@router.get("/status")
def get_status(
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Get knowledge base status."""
    return get_knowledge_status()


@router.get("/search")
def search(
    query: str,
    limit: int = 3,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Search knowledge base for relevant information."""
    if not query or len(query.strip()) < 3:
        raise HTTPException(status_code=400, detail="Query must be at least 3 characters")
    
    results = search_knowledge(query, limit)
    
    # Synthesize a short answer from top results
    if results:
        combined_content = " ".join([r["content"] for r in results])
        # For MVP, return raw chunks (smart-truncated at a sentence/word boundary
        # rather than a hard character cut). In production, would use LLM to synthesize.
        answer = smart_truncate(combined_content, 500)
    else:
        answer = "No relevant information found in knowledge base."
    
    return {
        "query": query,
        "answer": answer,
        "sources": results
    }
