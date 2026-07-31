import os
import uuid
from datetime import datetime
from sqlalchemy import create_engine, Column, String, Integer, Float, DateTime, ForeignKey, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

# Postgres is the single database for every environment — local dev connects
# to the same instance via its public URL (see backend/.env), production via
# Coolify's internal hostname. The old SQLite fallback is gone: it silently
# split data across throwaway per-machine files and masked misconfiguration.
if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. This app requires a Postgres connection "
        "string (postgres://user:pass@host:port/db) — set it in backend/.env "
        "for local dev or in the deployment's environment variables."
    )
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# The connection must actually work — fail loudly at startup so a bad
# DATABASE_URL is impossible to miss.
# pool_pre_ping + pool_recycle: DATABASE_URL points at a remote Postgres over
# the public internet, which silently drops idle connections. Without these,
# the pool hands out a stale connection, the request hangs on a dead socket
# until the OS-level TCP timeout (~20s+), and Retell's tool-call timeout aborts
# before the backend ever responds — even though a fresh connection works
# instantly. pool_pre_ping validates (and transparently replaces) a stale
# connection before use; pool_recycle proactively retires connections before
# they go stale.
engine = create_engine(
    DATABASE_URL,
    # TCP keepalives: pool_pre_ping's own validation ping can itself hang if a
    # connection died silently (no clean FIN/RST — common on a remote/public
    # internet path) — the ping just sits waiting on a dead socket exactly
    # like a real query would, so it doesn't fully protect against this.
    # Keepalives make the OS detect and report a dead connection fast instead
    # of relying on default OS timeouts (often much longer), so both pre_ping
    # and real queries fail fast instead of hanging.
    #
    # idle=20/interval=10/count=3 (up to ~50s worst case) was still too loose:
    # confirmed in production that book_appointment hung for exactly 20005ms —
    # Retell's own tool-call timeout (20000ms) firing on a request stuck
    # waiting on a dead connection, not a code bug. Tightened so detection
    # completes in single-digit seconds, comfortably inside that budget.
    # statement_timeout is a second, independent backstop: bounds a query that
    # DOES get a live connection but stalls for another reason (e.g. lock
    # contention), so even that failure mode can't eat the whole 20s budget.
    connect_args={
        "connect_timeout": 3,
        "keepalives": 1,
        "keepalives_idle": 3,
        "keepalives_interval": 2,
        "keepalives_count": 2,
        "options": "-c statement_timeout=8000",
    },
    pool_pre_ping=True,
    # Lowered from 280s -> 90s -> 45s: pool_pre_ping's single lightweight ping
    # isn't fully catching every stale-connection case (still saw ECONNABORTED
    # timeouts in production after each prior tightening) — likely an
    # intermediate network hop/NAT dropping idle connections faster than
    # expected. Recycling more aggressively shrinks the staleness window.
    pool_recycle=45,
)
with engine.connect():
    pass

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class Settings(Base):
    __tablename__ = "settings"
    key = Column(String(255), primary_key=True)
    value = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class School(Base):
    """
    One row per onboarded school (tenant). All campaign data is scoped to a
    school via contacts.school_id / upload_batches.school_id — appointments,
    callbacks, and call attempts inherit their school through contact_id, so
    they don't need their own column.
    Each school gets its OWN Retell agent/LLM (provisioned at onboarding from
    the shared prompt template with the school's name/location substituted);
    the ids live here, not in the global settings table.
    """
    __tablename__ = "schools"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)                 # e.g. "The Shri Ram Academy"
    slug = Column(String(100), nullable=False, unique=True)    # e.g. "shri-ram-academy"
    location = Column(String(255), nullable=True)              # e.g. "Gachibowli, Hyderabad"
    contact_phone = Column(String(50), nullable=True)          # spoken in voicemail/closing lines
    website = Column(String(500), nullable=True)               # knowledge-base scrape source
    logo_url = Column(String(500), nullable=True)              # url to the uploaded school logo
    admin_email = Column(String(255), nullable=True)           # the school's Cognito login email
    retell_agent_id = Column(String(255), nullable=True)       # this school's dedicated agent
    retell_llm_id = Column(String(255), nullable=True)
    knowledge_base_id = Column(String(255), nullable=True)     # optional per-school Retell KB
    status = Column(String(50), default="active")              # active, suspended
    created_at = Column(DateTime, default=datetime.utcnow)

    # ── Per-school overrides ──────────────────────────────────────────
    # All nullable: a school with none of these set falls back to the
    # platform's global Settings/env values (src/school_settings.py), so
    # existing schools keep working unchanged until an admin configures
    # them individually. retell_api_key is deliberately NOT here — one
    # Retell account serves every school's (separate) agent.
    retell_phone_number = Column(String(50), nullable=True)         # this school's outbound caller ID
    google_calendar_credentials_json = Column(Text, nullable=True)  # this school's own service account
    google_calendar_id = Column(String(255), nullable=True)
    cal_com_api_key = Column(String(255), nullable=True)            # this school's own Cal.com account
    cal_com_event_link = Column(String(500), nullable=True)
    # Which Cal.com event type to book for each meeting kind. Resolved by slug
    # rather than by "first event type in the account" — once an account has
    # both a video and an in-person event type, guessing sends a campus visitor
    # a video link (or a virtual attendee a street address).
    cal_com_virtual_event_slug = Column(String(255), nullable=True)
    cal_com_in_person_event_slug = Column(String(255), nullable=True)
    smtp_server = Column(String(255), nullable=True)                # this school's own confirmation-email sender
    smtp_port = Column(Integer, nullable=True)
    smtp_username = Column(String(255), nullable=True)
    smtp_password = Column(String(255), nullable=True)
    smtp_from_email = Column(String(255), nullable=True)

class UploadBatch(Base):
    __tablename__ = "upload_batches"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    school_id = Column(String(36), ForeignKey("schools.id", ondelete="CASCADE"), nullable=True)
    file_name = Column(String(255), nullable=False)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    total_contacts = Column(Integer, nullable=False)
    uploaded_by = Column(String(255), nullable=False)
    # Campaign state: idle, running, paused, completed
    status = Column(String(50), default="idle")

    contacts = relationship("Contact", back_populates="batch", cascade="all, delete-orphan")

class Contact(Base):
    __tablename__ = "contacts"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    school_id = Column(String(36), ForeignKey("schools.id", ondelete="CASCADE"), nullable=True)
    batch_id = Column(String(36), ForeignKey("upload_batches.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(255), nullable=False)
    phone_number = Column(String(255), nullable=False)
    email = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    status = Column(String(50), default="Pending")  # Pending, Calling, Completed, NeedsReschedule, Scheduled, Failed
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    batch = relationship("UploadBatch", back_populates="contacts")
    attempts = relationship("CallAttempt", back_populates="contact", cascade="all, delete-orphan")
    schedules = relationship("ScheduledCallback", back_populates="contact", cascade="all, delete-orphan")

class CallAttempt(Base):
    __tablename__ = "call_attempts"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    contact_id = Column(String(36), ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    retell_call_id = Column(String(255), nullable=False, unique=True)
    attempt_number = Column(Integer, nullable=False)
    started_at = Column(DateTime, nullable=False)
    ended_at = Column(DateTime, nullable=True)
    outcome = Column(String(50), nullable=True)  # Answered, NoAnswer, Busy, Rejected, Failed, InProgress
    transcript = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    recording_url = Column(String(500), nullable=True)   # Retell-hosted recording URL
    duration_sec = Column(Float, nullable=True)           # Call duration in seconds
    callback_raw_text = Column(Text, nullable=True)       # Raw phrase from lead e.g. "tomorrow at 11"
    created_at = Column(DateTime, default=datetime.utcnow)

    contact = relationship("Contact", back_populates="attempts")

class ScheduledCallback(Base):
    __tablename__ = "scheduled_callbacks"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    contact_id = Column(String(36), ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    scheduled_for = Column(DateTime, nullable=False)       # Stored in UTC
    google_calendar_event_id = Column(String(255), nullable=True)
    status = Column(String(50), default="Scheduled")       # Scheduled, Triggered, Cancelled
    batch_call_id = Column(String(255), nullable=True)
    call_type = Column(String(50), default="Follow-up")   # Follow-up, Reminder, Check-in
    reason = Column(Text, nullable=True)                  # Reason for callback
    created_at = Column(DateTime, default=datetime.utcnow)
    dial_attempts = Column(Integer, default=0)            # Bounds the dial-failure retry in scheduler.py

    contact = relationship("Contact", back_populates="schedules")

class Appointment(Base):
    __tablename__ = "appointments"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    contact_id = Column(String(36), ForeignKey("contacts.id", ondelete="CASCADE"), nullable=False)
    scheduled_for = Column(DateTime, nullable=False)
    purpose = Column(Text, nullable=True)
    google_calendar_event_id = Column(String(255), nullable=True)
    google_calendar_html_link = Column(String(1024), nullable=True)
    calcom_booking_id = Column(String(255), nullable=True)  # Cal.com booking uid (needed for cancel/reschedule)
    meeting_type = Column(String(20), default="in_person")   # in_person, virtual
    virtual_meeting_link = Column(String(1024), nullable=True)  # Cal Video meeting URL, set when meeting_type == "virtual"
    status = Column(String(50), default="Booked")       # Booked, Cancelled, Completed
    created_from_call_attempt_id = Column(String(36), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class KnowledgeChunk(Base):
    """
    Scraped website content the voice agent answers factual questions from.
    Scoped per school: each tenant's chunks come from ITS OWN website
    (schools.website), and lookup_school_info only ever searches the calling
    school's chunks — otherwise every school's agent would answer questions
    using the original single-tenant school's facts.
    school_id is nullable only so the migration can adopt pre-existing rows.
    """
    __tablename__ = "knowledge_chunks"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    school_id = Column(String(36), ForeignKey("schools.id", ondelete="CASCADE"), nullable=True)
    source_url = Column(String(500), nullable=False)
    page_title = Column(String(500), nullable=True)
    content = Column(Text, nullable=False)              # ~300-500 token chunk
    content_hash = Column(String(64), nullable=False)   # To detect changes
    scraped_at = Column(DateTime, default=datetime.utcnow)

def init_db():
    Base.metadata.create_all(bind=engine)
    # Self-healing migration for appointments google_calendar_html_link column
    from sqlalchemy import inspect, text
    try:
        inspector = inspect(engine)
        columns = [c['name'] for c in inspector.get_columns('appointments')]
        if 'google_calendar_html_link' not in columns:
            print("[DB] Self-healing migration: adding google_calendar_html_link to appointments table")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE appointments ADD COLUMN google_calendar_html_link TEXT;"))
                conn.commit()

        cb_columns = [c['name'] for c in inspector.get_columns('scheduled_callbacks')]
        if 'dial_attempts' not in cb_columns:
            print("[DB] Self-healing migration: adding dial_attempts to scheduled_callbacks table")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE scheduled_callbacks ADD COLUMN dial_attempts INTEGER DEFAULT 0;"))
                conn.commit()

        if 'meeting_type' not in columns:
            print("[DB] Self-healing migration: adding meeting_type to appointments table")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE appointments ADD COLUMN meeting_type VARCHAR(20) DEFAULT 'in_person';"))
                conn.commit()

        if 'virtual_meeting_link' not in columns:
            print("[DB] Self-healing migration: adding virtual_meeting_link to appointments table")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE appointments ADD COLUMN virtual_meeting_link TEXT;"))
                conn.commit()

        # ── Multi-tenancy: school_id on contacts + upload_batches, and a ──
        # ── default school that adopts all pre-existing (single-tenant) data ──
        contact_columns = [c['name'] for c in inspector.get_columns('contacts')]
        if 'school_id' not in contact_columns:
            print("[DB] Self-healing migration: adding school_id to contacts table")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE contacts ADD COLUMN school_id VARCHAR(36);"))
                conn.commit()

        batch_columns = [c['name'] for c in inspector.get_columns('upload_batches')]
        if 'school_id' not in batch_columns:
            print("[DB] Self-healing migration: adding school_id to upload_batches table")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE upload_batches ADD COLUMN school_id VARCHAR(36);"))
                conn.commit()

        kc_columns = [c['name'] for c in inspector.get_columns('knowledge_chunks')]
        if 'school_id' not in kc_columns:
            print("[DB] Self-healing migration: adding school_id to knowledge_chunks table")
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE knowledge_chunks ADD COLUMN school_id VARCHAR(36);"))
                conn.commit()

        # Backfill: every row without a school belongs to the original
        # single-tenant deployment's school. Create it once (fixed slug) and
        # adopt orphaned rows into it, carrying over the currently-live
        # shared Retell agent ids from settings so its calls keep working.
        with engine.connect() as conn:
            default_school = conn.execute(text(
                "SELECT id FROM schools WHERE slug = 'shri-ram-academy'"
            )).fetchone()
            if not default_school:
                orphan_contacts = conn.execute(text(
                    "SELECT count(*) FROM contacts WHERE school_id IS NULL"
                )).scalar() or 0
                # Knowledge chunks count too: a deployment can have a seeded
                # knowledge base before its first lead is uploaded, and those
                # chunks are the original school's website content — they need
                # the same adoption or per-school lookup finds nothing.
                orphan_chunks = conn.execute(text(
                    "SELECT count(*) FROM knowledge_chunks WHERE school_id IS NULL"
                )).scalar() or 0
                if orphan_contacts > 0 or orphan_chunks > 0:
                    default_id = str(uuid.uuid4())
                    agent_row = conn.execute(text("SELECT value FROM settings WHERE key = 'local_agent_id'")).fetchone()
                    llm_row = conn.execute(text("SELECT value FROM settings WHERE key = 'retell_llm_id'")).fetchone()
                    conn.execute(text(
                        "INSERT INTO schools (id, name, slug, location, contact_phone, website, status, retell_agent_id, retell_llm_id, created_at) "
                        "VALUES (:id, 'The Shri Ram Academy', 'shri-ram-academy', 'Gachibowli, Hyderabad', '+91 7569891111', "
                        "'https://tsrahyderabad.com/', 'active', :agent, :llm, :now)"
                    ), {"id": default_id, "agent": agent_row[0] if agent_row else None,
                        "llm": llm_row[0] if llm_row else None, "now": datetime.utcnow()})
                    conn.execute(text("UPDATE contacts SET school_id = :sid WHERE school_id IS NULL"), {"sid": default_id})
                    conn.execute(text("UPDATE upload_batches SET school_id = :sid WHERE school_id IS NULL"), {"sid": default_id})
                    conn.execute(text("UPDATE knowledge_chunks SET school_id = :sid WHERE school_id IS NULL"), {"sid": default_id})
                    conn.commit()
                    print(f"[DB] Migration: created default school 'The Shri Ram Academy' ({default_id}) and adopted {orphan_contacts} existing contacts, {orphan_chunks} knowledge chunks")
            else:
                # School exists — still adopt any strays (e.g. rows created
                # by an old app instance mid-deploy).
                conn.execute(text("UPDATE contacts SET school_id = (SELECT id FROM schools WHERE slug='shri-ram-academy') WHERE school_id IS NULL"))
                conn.execute(text("UPDATE upload_batches SET school_id = (SELECT id FROM schools WHERE slug='shri-ram-academy') WHERE school_id IS NULL"))
                conn.execute(text("UPDATE knowledge_chunks SET school_id = (SELECT id FROM schools WHERE slug='shri-ram-academy') WHERE school_id IS NULL"))
                conn.execute(text(
                    "UPDATE schools SET website = 'https://tsrahyderabad.com/' "
                    "WHERE slug = 'shri-ram-academy' AND (website IS NULL OR website = '')"
                ))
                conn.commit()

        # Per-school setting overrides (calendar/Cal.com/SMTP/phone) — all
        # nullable, added independently of whether the schools table already
        # existed above.
        school_columns = [c['name'] for c in inspector.get_columns('schools')]
        school_override_columns = {
            "retell_phone_number": "VARCHAR(50)",
            "google_calendar_credentials_json": "TEXT",
            "google_calendar_id": "VARCHAR(255)",
            "cal_com_api_key": "VARCHAR(255)",
            "cal_com_event_link": "VARCHAR(500)",
            "cal_com_virtual_event_slug": "VARCHAR(255)",
            "cal_com_in_person_event_slug": "VARCHAR(255)",
            "smtp_server": "VARCHAR(255)",
            "smtp_port": "INTEGER",
            "smtp_username": "VARCHAR(255)",
            "smtp_password": "VARCHAR(255)",
            "smtp_from_email": "VARCHAR(255)",
        }
        for col_name, col_type in school_override_columns.items():
            if col_name not in school_columns:
                print(f"[DB] Self-healing migration: adding {col_name} to schools table")
                with engine.connect() as conn:
                    conn.execute(text(f"ALTER TABLE schools ADD COLUMN {col_name} {col_type};"))
                    conn.commit()
    except Exception as e:
        print(f"[DB] Migration warning: {e}")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

