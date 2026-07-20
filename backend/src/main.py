import os
from datetime import datetime
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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

app = FastAPI(title="Aegis Calling API", version="1.0.0")

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


@app.get("/health")
def health_check():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}
@app.on_event("startup")
def startup_event():
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

    # Auto-seed knowledge base on first startup if it's empty
    import threading
    def _seed_knowledge_if_empty():
        try:
            from src.db import SessionLocal, KnowledgeChunk
            db = SessionLocal()
            try:
                count = db.query(KnowledgeChunk).count()
                if count == 0:
                    print("[STARTUP] Knowledge base is empty — seeding now from TSRA website...")
                    from src.knowledge import refresh_knowledge_base
                    total = refresh_knowledge_base()
                    print(f"[STARTUP] Knowledge base seeded: {total} chunks loaded.")
                else:
                    print(f"[STARTUP] Knowledge base already has {count} chunks — skipping seed.")
            finally:
                db.close()
        except Exception as e:
            print(f"[STARTUP] Knowledge base seed failed: {e}")

    threading.Thread(target=_seed_knowledge_if_empty, daemon=True).start()

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
    print("Aegis Calling API is ready.")

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "5000"))
    uvicorn.run("src.main:app", host="0.0.0.0", port=port, reload=True)
