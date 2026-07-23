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
    # Keepalives make the OS detect and report a dead connection within
    # ~30-50s instead of relying on default OS timeouts (often much longer),
    # so both pre_ping and real queries fail fast instead of hanging.
    connect_args={
        "connect_timeout": 3,
        "keepalives": 1,
        "keepalives_idle": 20,
        "keepalives_interval": 10,
        "keepalives_count": 3,
    },
    pool_pre_ping=True,
    # Lowered from 280s: pool_pre_ping's single lightweight ping isn't fully
    # catching every stale-connection case (still saw ECONNABORTED timeouts
    # in production after this was first applied) — likely an intermediate
    # network hop/NAT dropping idle connections faster than expected.
    # Recycling more aggressively shrinks the staleness window.
    pool_recycle=90,
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

class UploadBatch(Base):
    __tablename__ = "upload_batches"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
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
    __tablename__ = "knowledge_chunks"
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
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
    except Exception as e:
        print(f"[DB] Migration warning: {e}")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

