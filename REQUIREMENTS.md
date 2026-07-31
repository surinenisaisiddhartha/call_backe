# EnquiryCall — Requirements Specification

**Project:** AI-powered outbound admissions calling platform
**Client:** The Shri Ram Academy (TSRA), Gachibowli, Hyderabad
**Document version:** 1.0
**Status:** Live in production (AWS deployment)

---

## 1. Purpose

Automate admissions outreach calling for TSRA: an AI voice agent calls prospective
families, answers questions about the school, books campus visits, schedules
callbacks, and syncs results to Google Calendar and email — without a human
dialer for first-contact outreach.

---

## 2. Stakeholders / User Roles

| Role | Access | Responsibilities |
|---|---|---|
| **Admin** | Full dashboard access | Upload leads, manage campaigns, configure Settings (API keys, SMTP, dialer limits), view all data |
| **Staff** | Dashboard access, no Settings | View/manage contacts, campaigns, appointments, callbacks |
| **Prospective family (caller)** | Phone only | Receives/answers calls from the AI agent |

---

## 3. Functional Requirements

### FR-1 — Campaign Management
- FR-1.1: Admin can upload a lead list (Excel/CSV) to create a campaign ("UploadBatch").
- FR-1.2: System auto-dials contacts in a campaign up to a configurable concurrency limit.
- FR-1.3: Each campaign has an independent dial queue (one campaign's pace never blocks another).
- FR-1.4: As a call ends, the next queued contact in that campaign is dialed automatically.
- FR-1.5: Do-Not-Call contacts (by phone number) are excluded from any future dial, campaign or otherwise.

### FR-2 — AI Voice Conversation
- FR-2.1: The agent ("Maya") opens every call with a fixed identity check.
- FR-2.2: The agent answers factual questions about the school using only
  grounded, live-scraped knowledge — **never invented facts**.
- FR-2.3: The agent converses in **English, Hindi, or Tamil**, matching the
  caller's language, including natural code-switching ("Hinglish").
  - Telugu is explicitly **out of scope** — no provider on the underlying
    voice platform supports Telugu STT or TTS. The agent must say so
    plainly rather than guess.
- FR-2.4: The agent asks for one piece of information at a time during
  booking (date/time, then purpose, then email) — never bundles multiple
  open-ended questions into a single turn.
- FR-2.5: The agent must never resolve a date, time, purpose, or email from
  an ambiguous reply (e.g. a bare "yes" to a multi-part question) — it must
  ask again for the specific missing piece.
- FR-2.6: The agent recognizes colloquial/multilingual affirmatives ("ha",
  "haan", "achha", "aama", etc.) as "yes", including short/garbled variants.
- FR-2.7: A spoken promise (booking confirmed, callback scheduled) is only
  valid if the corresponding backend tool was actually invoked and returned
  success — the agent must never narrate an outcome it didn't actually
  produce.

### FR-3 — Reschedule / Callback Flow
- FR-3.1: Caller can request to be called back at a specific time; the agent
  resolves relative time expressions ("in 10 minutes," "tomorrow evening")
  against the actual call timestamp (IST).
- FR-3.2: A callback is created via a real tool call and confirmed to the
  caller only after that tool call succeeds.
- FR-3.3: If a scheduled callback's target time arrives while the contact is
  **already on an active call** (from any trigger — another callback, a
  manual call, or a campaign dial), the callback must defer rather than
  double-dial the contact.
- FR-3.4: If a call goes unanswered, or ends with nothing resolved, the
  system automatically retries — capped at 2 automatic retries (3 total
  attempts) before flagging the contact for manual follow-up.

### FR-4 — Appointment Booking
- FR-4.1: Caller can book a campus visit / admission counseling session; the
  agent collects and confirms date, time, purpose, and email before booking.
- FR-4.2: Booking a second time for a contact with an existing "Booked"
  appointment updates the existing record in place — never creates a
  duplicate.
- FR-4.3: On successful booking, a Google Calendar event is created and a
  confirmation email is sent — both as background tasks with **zero added
  latency** to the live call.
- FR-4.4: If the caller states the on-file email is incorrect, the agent
  must obtain and confirm a corrected email before booking — never book
  with an empty or unconfirmed email address.
- FR-4.5: If a tool call fails, the agent must not claim success; it must
  reassure the caller their request is noted and schedule a callback so the
  request isn't lost.

### FR-5 — Knowledge Base
- FR-5.1: The school's website is scraped periodically (and on-demand) into
  searchable knowledge chunks.
- FR-5.2: Every factual answer must be grounded in a real, current lookup —
  the agent must actually invoke the lookup tool, never skip straight to an
  "I don't have that information" apology.
- FR-5.3: If a lookup genuinely returns nothing relevant, the agent offers
  to have the admissions team follow up rather than guessing.

### FR-6 — Dashboard
- FR-6.1: Campaigns page — upload leads, view/start/monitor campaigns.
- FR-6.2: Contacts/Leads page — per-contact status, call history, transcripts, recordings.
- FR-6.3: Scheduling page — view/manage scheduled callbacks and booked appointments.
- FR-6.4: Settings page (admin only) — configure Retell, Google Calendar, SMTP, dialer limits, tool auth secret.
- FR-6.5: JWT-based session auth with role separation (admin vs staff).

### FR-7 — Outcome Tracking
- FR-7.1: Every call ends with exactly one recorded outcome: `interested_followup_scheduled`, `appointment_booked`, `not_interested`, `do_not_call`, `wrong_number`, `no_answer`, or `undetermined`.
- FR-7.2: Outcome recording drives contact status and the dashboard's reporting.

---

## 4. Non-Functional Requirements

### NFR-1 — Reliability
- NFR-1.1: The shared voice agent's configuration (prompt, tools, webhook)
  must self-configure on backend startup, on any deployment, without a
  manual setup step. Agent/LLM identity must be persisted in the shared
  database (not a local file) so it survives across deployments.
- NFR-1.2: Backend tool endpoints (booking, scheduling, lookup) must respond
  within the voice platform's tool-call timeout under normal conditions;
  database connections must survive idle periods without silently hanging
  (TCP keepalives + connection pre-validation + periodic recycling).
- NFR-1.3: A contact must never be dialed twice simultaneously by two
  different triggers (scheduled callback, manual call, campaign dial).

### NFR-2 — Security
- NFR-2.1: Tool webhook endpoints should be protected by a shared secret
  header, verified on every request, once configured.
- NFR-2.2: Session auth (JWT) must use a non-default, random secret in production.
- NFR-2.3: Admin/staff credentials must be rotated from demo defaults before handling real lead data.
- NFR-2.4: Webhook payloads from the voice platform should be signature-verified when a real API key is configured.

### NFR-3 — Performance
- NFR-3.1: Booking/scheduling must not add latency to the live call — any
  slow operation (calendar sync, email) runs as a background task.
- NFR-3.2: Backend and database should be co-located in the same
  geographic region as end users to minimize dashboard/API latency.

### NFR-4 — Data Integrity
- NFR-4.1: Contact records must be resolvable unambiguously from a live
  call (via call ID, then phone, then email) — duplicate contacts sharing a
  phone number must not cause bookings/callbacks to attach to the wrong record.
- NFR-4.2: The database used by this project must be logically isolated
  from unrelated applications' data.

### NFR-5 — Observability
- NFR-5.1: Every webhook event and tool call should be logged with enough
  context (call ID, contact ID) to trace a live incident after the fact.

---

## 5. System Architecture

```
Frontend (React 19 + TS)  --HTTPS-->  Backend (FastAPI)  -->  PostgreSQL (dedicated DB)
                                            |
        +----------------+----------------+----------------+------------------+
        v                v                v                v                  v
   Voice AI          Google           SMTP/Gmail      TSRA Website     Shared voice
   (Retell -         Calendar         (confirmation    (scraped for     agent config
   calls, STT/TTS,   (service         emails)          knowledge base)  (self-configured
   webhooks)         account)                                           on startup)
```

- **Frontend**: React 19 + TypeScript + Vite. 4 pages: Campaigns, Leads, Scheduling, Settings.
- **Backend**: FastAPI + SQLAlchemy. REST API + APScheduler background jobs + webhook receivers.
- **Voice agent**: One shared Retell agent ("Maya," voice `11labs-Monika`), driven entirely by `agent_prompt.md` — no per-campaign forks.
- **Database**: Dedicated PostgreSQL instance — 7 tables (see §6).

---

## 6. Data Model (7 core tables)

| Table | Purpose |
|---|---|
| `contacts` | Leads — name, phone, email, status |
| `upload_batches` | Campaigns (one per uploaded file) |
| `call_attempts` | Every call — outcome, duration, transcript, recording URL |
| `scheduled_callbacks` | Pending/fired reschedule requests |
| `appointments` | Booked campus visits, with Google Calendar links |
| `knowledge_chunks` | Scraped website content for factual answers |
| `settings` | Runtime-configurable credentials/config, including the shared agent's persisted `local_agent_id` / `retell_llm_id` |

---

## 7. External Integrations

| System | Purpose | Notes |
|---|---|---|
| Retell AI | Voice calls, STT/TTS, LLM orchestration | Single shared agent across all campaigns |
| Google Calendar API | Appointment events | Service account; cannot add formal "attendees" without Workspace domain delegation — caller notified via email instead |
| Gmail SMTP | Booking confirmation emails | Requires an App Password, not the account password |
| TSRA website | Source of truth for factual answers | Scraped nightly + on-demand refresh |

---

## 8. Known Constraints / Out of Scope

- **Telugu is not supported** by the underlying voice platform for either
  speech recognition or speech synthesis, on any provider. This is a
  platform-level limitation, not a configuration gap — no setting can add it.
- **Google Calendar attendee invites** are not possible with the current
  service-account setup (requires a paid Google Workspace domain with
  delegated authority).
- Caller-initiated reschedule requests ("call me back later") are not
  capped — a caller can request unlimited callbacks; only the
  system-initiated no-answer retry is capped at 3 total attempts.
- The voice platform's "multi" legacy language mode is intentionally not
  used — it covers a wider but less accurate set of languages (including
  documented cross-language misdetection); the system uses an explicit
  English/Hindi/Tamil locale set instead for better accuracy.

---

## 9. Acceptance Criteria Summary

A call is considered correctly handled when:
- No factual claim is made without a grounded knowledge lookup.
- No booking/callback detail (date, time, purpose, email) is invented —
  every value traces back to something the caller actually said.
- Every spoken confirmation of a booking or callback corresponds to an
  actual, successful backend tool call.
- The contact is never dialed by two different triggers at once.
- The outcome recorded matches what actually happened on the call.

---

*This document reflects requirements established and validated through
extensive live-call testing during initial development and the AWS
production migration.*
