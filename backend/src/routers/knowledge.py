"""
Knowledge Base Router — API endpoints for managing a school's knowledge base.

Every endpoint is scoped to the caller's own school. A platform admin (no
school_id of their own) may target a specific school with ?school_id=...;
without it, an admin sees/refreshes across all schools.
"""

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from src.db import get_db, School
from src.routers.auth import get_current_user
from src.knowledge import (
    refresh_knowledge_base,
    refresh_all_school_knowledge_bases,
    search_knowledge,
    get_knowledge_status,
    smart_truncate,
)

router = APIRouter(prefix="/api/knowledge", tags=["Knowledge Base"])


def resolve_target_school_id(
    db: Session, current_user: dict, requested_school_id: str = None
) -> str | None:
    """
    The school this request may act on. A school user is pinned to their own
    tenant and cannot reach another's knowledge base by passing school_id;
    only a platform admin can target one explicitly.
    """
    own_school_id = current_user.get("school_id")
    if own_school_id:
        return own_school_id
    if requested_school_id:
        if not db.query(School).filter(School.id == requested_school_id).first():
            raise HTTPException(status_code=404, detail="School not found")
        return requested_school_id
    return None


@router.post("/refresh")
def refresh_knowledge(
    background_tasks: BackgroundTasks,
    school_id: str = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Rebuild a knowledge base by re-scraping the school's own website.
    A platform admin with no school_id refreshes every active school.
    """
    target_school_id = resolve_target_school_id(db, current_user, school_id)

    if target_school_id is None:
        background_tasks.add_task(refresh_all_school_knowledge_bases)
        return {
            "success": True,
            "message": "Knowledge base refresh started in background for all active schools"
        }

    school = db.query(School).filter(School.id == target_school_id).first()
    background_tasks.add_task(refresh_knowledge_base, target_school_id)
    return {
        "success": True,
        "message": f"Knowledge base refresh started in background for {school.name if school else 'this school'}"
    }


@router.get("/status")
def get_status(
    school_id: str = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """Get knowledge base status."""
    return get_knowledge_status(resolve_target_school_id(db, current_user, school_id))


@router.get("/search")
def search(
    query: str,
    limit: int = 3,
    school_id: str = None,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    """
    Search a knowledge base — the dashboard's test-search box, so staff can see
    exactly what their agent would find for a given question.
    """
    if not query or len(query.strip()) < 3:
        raise HTTPException(status_code=400, detail="Query must be at least 3 characters")

    target_school_id = resolve_target_school_id(db, current_user, school_id)
    results = search_knowledge(query, limit, school_id=target_school_id)

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
