# Call Manager (Aegis Calling) — Current Features

**Document type:** Feature catalog (as-built, grounded directly in the codebase)
**Document version:** 1.0
**As of:** July 2026, `deployment1` branch

---

## 1. Overview

Call Manager is a live, working AI outbound-calling platform for The Shri Ram
Academy (TSRA) admissions outreach. This document describes what the system
**actually does today** — every item below is implemented and running, not
planned or aspirational.

---

## 2. AI Voice Agent ("Maya")

- **Single shared voice agent** across every campaign, driven entirely by one
  prompt file (`agent_prompt.md`) — no per-campaign forks or duplicated logic.
- **Voice**: ElevenLabs `11labs-Monika` (Indian-accented female voice).
- **Multilingual conversation**: understands and replies in **English, Hindi,
  and Tamil**, including natural code-switching ("Hinglish"). If a caller
  speaks Telugu, the agent plainly says it cannot understand and offers to
  continue in Hindi or English rather than guessing.
- **Identity check opening**: every call opens with a fixed "Hi, am I
  speaking with {name}?" and recognizes a wide range of colloquial/regional
  affirmatives ("ha", "haan", "achha", "aama," etc.), including short or
  garbled variants.
- **Grounded answers only**: every factual claim about the school is backed
  by a real-time knowledge lookup (native Retell knowledge base +
  a custom `lookup_school_info` tool) — never invented from memory.
- **One question at a time**: during booking, the agent asks for date/time,
  then purpose, then email — separately, waiting for a real answer each time
  — rather than bundling multiple questions into one confusing turn.
- **No fabricated confirmations**: a spoken "your appointment is booked" or
  "callback scheduled" is only ever said after the corresponding backend
  tool call has actually run and returned success.
- **Natural, human tone**: varied phrasing rather than repetitive scripted
  politeness ("could you kindly..." on every single line was deliberately
  removed in favor of natural variation).

### Available tools the agent can call mid-conversation
| Tool | Purpose |
|---|---|
| `lookup_school_info` | Real-time factual lookup from the scraped school website |
| `schedule_callback` | Creates a callback for a specific resolved time |
| `book_appointment` | Books a campus visit / admission counseling slot |
| `mark_outcome` | Records the final call outcome |
| `end_call` | Hangs up |

---

## 3. Outbound Calling

- **Campaign-based dialing**: admin uploads an Excel/CSV lead list, which
  becomes a campaign ("UploadBatch"); the system dials contacts up to a
  configurable concurrency limit.
- **Independent per-campaign queues**: one campaign's pace never blocks
  another's.
- **Auto-retry with a cap**: if a call is unanswered or ends unresolved, the
  system automatically retries — capped at 2 automatic retries (3 total
  attempts) — before flagging the contact for manual follow-up.
- **Do-Not-Call enforcement**: contacts marked DoNotCall are excluded from
  all future dials, campaign or manual.
- **Manual "Call Now"**: staff can trigger an immediate call to any single
  contact from the dashboard.
- **Busy-contact protection**: a contact already on an active call cannot be
  dialed again by a different trigger (another scheduled callback, a manual
  call, or a campaign dial) — the second attempt defers instead of
  double-ringing the same person.

---

## 4. Appointment Booking

- Collects and confirms date, time, purpose, and email before booking.
- **Idempotent booking**: re-booking for a contact with an existing "Booked"
  appointment updates that same record instead of creating a duplicate.
- **Zero added call latency**: Google Calendar sync and confirmation email
  are dispatched as background tasks — the live call is never held up
  waiting on either.
- **Email correction handling**: if the caller says the on-file email is
  wrong, the agent must obtain and confirm a new one before booking — it
  will not book with an empty or unconfirmed email.

---

## 5. Reschedule / Callback Flow

- Resolves relative time expressions ("in 10 minutes," "tomorrow evening")
  against the actual call timestamp, in IST.
- Confirms the resolved time back to the caller before scheduling.
- A callback is only ever confirmed to the caller after the scheduling tool
  call has actually succeeded.
- Fires automatically at the scheduled time via a background scheduler
  (APScheduler), independent of the live dashboard being open.

---

## 6. Knowledge Base

- The school's website is scraped into searchable content chunks.
- **Automatic nightly refresh** (3 AM IST) plus an on-demand "Refresh Now"
  button in the dashboard.
- **Native Retell knowledge base** is attached to the agent for fast,
  semantically-aware retrieval, with the custom keyword-search tool as a
  fallback.
- Dashboard includes a **test-search** box so staff can directly query the
  knowledge base and see what the agent would find for a given question.

---

## 7. Dashboard (React frontend)

### Dashboard (overview) page
- At-a-glance view combining contacts, recent call history, upcoming
  appointments, and pending callbacks in one place.

### Campaigns page
- Lists all uploaded campaigns.
- Expand any campaign to see its per-contact call history.
- Trigger an individual call directly from the campaign view.
- View full transcripts inline.

### Contacts / Leads page
- Search and filter contacts by status.
- Per-contact call history, transcript, and recording playback.
- Manual reschedule action per contact (set a new callback time directly).

### Scheduling page
- Two views in one page: **Callbacks** and **Appointments**, switchable via tabs.
- Edit/reschedule an existing callback's time.
- Manually create a new scheduled callback.

### Settings page (admin only)
- Configure Retell API key, phone number, agent ID.
- Configure Google Calendar service-account credentials and calendar ID.
- Configure SMTP host/port/username/password/from-address.
- Configure dialer concurrency limit, max retry attempts, retry backoff hours.
- Configure the tool-webhook shared secret (`aegis_tools_secret`).
- Secrets are masked in the UI once saved.

### Login page
- Email/password authentication issuing a JWT session token.
- Role separation: admin (full access) vs staff (no Settings access).

---

## 8. Backend Reliability Features

- **Self-configuring voice agent**: on every backend startup, the shared
  Retell agent's prompt, tools, and webhook URL are automatically
  synchronized to point at *that* deployment — no manual setup script needs
  to be run on a fresh deployment, ever. The agent/LLM identity is persisted
  in the database (not a local file), so this works identically whether
  deployed on Coolify, AWS, or anywhere else.
- **Resilient database connections**: TCP keepalives, pre-flight connection
  validation, and periodic connection recycling — protects against a remote
  database silently dropping idle connections and causing tool-call timeouts.
- **No silent failure masking**: a failed call-placement request now
  surfaces the real error (e.g. a genuine Retell API rejection) instead of
  being hidden behind a fabricated "success" response — and a contact's
  status correctly reverts if the call was never actually placed, instead of
  getting stuck.
- **Webhook signature verification**: incoming Retell/Cal.com webhooks are
  HMAC-verified when a real signing secret is configured.
- **Background job scheduler** running four recurring jobs: safety status
  reset, callback dialer sweep (every minute), nightly knowledge refresh,
  and Google Calendar reconciliation (every 10 minutes).

---

## 9. Integrations

| System | What it's used for |
|---|---|
| **Retell AI** | Voice calls, speech-to-text/text-to-speech, LLM-driven conversation |
| **Google Calendar API** | Creates a calendar event for every booked appointment (via service account) |
| **Gmail SMTP** | Sends styled HTML confirmation emails for bookings |
| **TSRA website** | Source content for the knowledge base (scraped, not hand-maintained) |

---

## 10. Data Tracked (7 core tables)

| Table | What it stores |
|---|---|
| `contacts` | Leads — name, phone, email, status |
| `upload_batches` | Campaigns |
| `call_attempts` | Every call placed — outcome, duration, transcript, recording |
| `scheduled_callbacks` | Pending and fired reschedule requests |
| `appointments` | Booked campus visits with Google Calendar links |
| `knowledge_chunks` | Scraped website content |
| `settings` | Runtime credentials/config, including the agent's persisted identity |

---

## 11. Security Features Currently Implemented

- JWT-based session authentication with admin/staff role separation.
- Secrets masked in the Settings UI once saved.
- Optional shared-secret header (`aegis_tools_secret`) to authenticate
  incoming tool-webhook calls.
- Webhook signature verification when a real signing key is configured.

---

*This document describes the system as it exists in the codebase today —
every feature listed has been implemented and exercised through live
testing, not merely designed.*
