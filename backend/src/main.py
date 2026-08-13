import os
from datetime import datetime
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from src.db import init_db, SessionLocal, Contact, UploadBatch
from src.scheduler import init_scheduler

# Import Routers
from src.routers.auth import router as auth_router
from src.routers.contacts import router as contacts_router
from src.routers.calls import router as calls_router
from src.routers.schedule import router as schedule_router
from src.routers.webhooks import router as webhooks_router
from src.routers.settings import router as settings_router
from src.routers.agent import router as agent_router
from src.routers.knowledge import router as knowledge_router
from src.routers.tools import router as tools_router
from src.routers.appointments import router as appointments_router
from src.routers.schools import router as schools_router
from src.routers.analytics import router as analytics_router
from src.routers.courses import router as courses_router
from src.routers.classes import router as classes_router
from src.events import router as events_router, event_manager

app = FastAPI(title="EnquiryCall API", version="1.0.0")

# CORS middleware config
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(auth_router)
app.include_router(contacts_router)
app.include_router(calls_router)
app.include_router(schedule_router)
app.include_router(webhooks_router)
app.include_router(settings_router)
app.include_router(agent_router)
app.include_router(knowledge_router)
app.include_router(tools_router)
app.include_router(appointments_router)
app.include_router(schools_router)
app.include_router(analytics_router)
app.include_router(courses_router)
app.include_router(classes_router)
app.include_router(events_router)

# Mount static files for uploads (like logos)
os.makedirs("uploads/logos", exist_ok=True)
app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")


@app.get("/health")
def health_check():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}

@app.on_event("startup")
def startup_event():
    import asyncio
    try:
        loop = asyncio.get_event_loop()
        event_manager.set_loop(loop)
    except Exception as e:
        print(f"[STARTUP] Could not bind event manager loop: {e}")

    print("Initializing database...")
    try:
        init_db()
        print("Database initialized successfully.")
        # Start ngrok tunnel in a background thread
        import threading
        from src.tunnel import start_ngrok_tunnel
        def run_tunnel_async():
            db = SessionLocal()
            try:
                start_ngrok_tunnel(db)
            finally:
                db.close()
        threading.Thread(target=run_tunnel_async, daemon=True).start()
    except Exception as e:
        print(f"WARNING: Database connection failed: {e}")
        print("The server will still start, but database operations will fail until connection is restored.")
    print("Starting background scheduler...")
    try:
        init_scheduler()
    except Exception as e:
        print(f"WARNING: Scheduler failed to start: {e}")

    # Cognito is the ONLY login path. Without it the app starts and serves
    # every page, but /api/auth/login returns 503 and NOBODY can sign in —
    # which previously only became visible when someone tried to log in and
    # got a failure with no clue in the deploy logs. Say it loudly at startup.
    try:
        from src import cognito
        if not cognito.cognito_enabled():
            missing = [
                name for name, value in (
                    ("COGNITO_REGION", cognito.COGNITO_REGION),
                    ("COGNITO_USER_POOL_ID", cognito.COGNITO_USER_POOL_ID),
                    ("COGNITO_CLIENT_ID", cognito.COGNITO_CLIENT_ID),
                ) if not value
            ]
            print("=" * 78)
            print("[STARTUP] LOGIN IS DISABLED — Cognito is not configured.")
            print(f"[STARTUP] Missing environment variable(s): {', '.join(missing)}")
            print("[STARTUP] Set them in your deployment's environment settings and redeploy.")
            print("[STARTUP] Until then /api/auth/login returns 503 and no one can sign in.")
            print("=" * 78)
        else:
            print("[STARTUP] Cognito login is configured.")
    except Exception as e:
        print(f"[STARTUP] Could not determine Cognito status: {e}")

    # Auto-seed knowledge bases on startup — per school, so a school onboarded
    # while the app was down (or one whose provisioning half-failed) still gets
    # its own website scraped instead of being left with an empty knowledge
    # base that makes its agent answer "I don't have that information" to
    # everything. Schools that already have chunks are left alone; the nightly
    # job handles keeping those current.
    import threading
    def _seed_knowledge_if_empty():
        try:
            from src.db import SessionLocal, KnowledgeChunk, School
            from src.knowledge import refresh_knowledge_base, DEFAULT_SCHOOL_SLUG
            db = SessionLocal()
            try:
                schools = db.query(School).filter(School.status == "active").all()
                if not schools:
                    # Fresh single-tenant deployment with no schools row yet.
                    if db.query(KnowledgeChunk).count() == 0:
                        print("[STARTUP] Knowledge base is empty — seeding now...")
                        total = refresh_knowledge_base()
                        print(f"[STARTUP] Knowledge base seeded: {total} chunks loaded.")
                    else:
                        print("[STARTUP] Knowledge base already populated — skipping seed.")
                    return
                targets = [
                    (s.id, s.name)
                    for s in schools
                    if (s.slug == DEFAULT_SCHOOL_SLUG or (s.website or "").strip())
                    and db.query(KnowledgeChunk).filter(KnowledgeChunk.school_id == s.id).count() == 0
                ]
            finally:
                db.close()

            if not targets:
                print("[STARTUP] Every school already has a knowledge base — skipping seed.")
                return
            for school_id, name in targets:
                print(f"[STARTUP] '{name}' has an empty knowledge base — seeding from its website...")
                total = refresh_knowledge_base(school_id)
                print(f"[STARTUP] '{name}' knowledge base seeded: {total} chunks loaded.")
        except Exception as e:
            print(f"[STARTUP] Knowledge base seed failed: {e}")

    threading.Thread(target=_seed_knowledge_if_empty, daemon=True).start()

    # Sync and persist all lead scores so that database columns lead_score and
    # lead_classification are fully up to date for indexed SQL filtering.
    def _rescore_all_contacts_on_startup():
        try:
            from src.db import SessionLocal, Contact
            from src.routers.contacts import persist_lead_scores
            db = SessionLocal()
            try:
                contacts = db.query(Contact).all()
                if contacts:
                    persist_lead_scores(db, contacts)
                    print(f"[STARTUP] Lead scores synced and persisted for {len(contacts)} contacts.")
            finally:
                db.close()
        except Exception as e:
            print(f"[STARTUP] Initial lead scoring sync failed (non-fatal): {e}")

    threading.Thread(target=_rescore_all_contacts_on_startup, daemon=True).start()

    # Auto-configure the shared Retell agent to point at THIS deployment.
    # Permanent fix for "every new deployment needs someone to manually run
    # setup_retell_agent.py" — the agent/llm ids are persisted in the DB
    # settings table (shared across every deployment), so this always finds
    # and patches the SAME agent instead of creating a duplicate, using
    # whatever WEBHOOK_BASE_URL this specific deployment was started with.
    # Non-fatal: a transient Retell API issue must never block app startup.
    def _configure_retell_agent():
        try:
            from setup_retell_agent import run_agent_setup
            result = run_agent_setup()
            if result:
                print(f"[STARTUP] Retell agent auto-configured: agent_id={result.get('agent_id')}")
        except Exception as e:
            print(f"[STARTUP] Retell agent auto-configuration failed (non-fatal): {e}")

    threading.Thread(target=_configure_retell_agent, daemon=True).start()
    print("EnquiryCall API is ready.")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "5000"))
    uvicorn.run("src.main:app", host="0.0.0.0", port=port, reload=True)
