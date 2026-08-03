# EnquiryCall — Current Features

**Document type:** Feature catalog (as-built, grounded directly in the codebase)
**Document version:** 2.0
**As of:** 30 July 2026, `deployment1` branch

---

## 1. Overview

EnquiryCall is a live, working **multi-tenant** AI outbound-calling platform
for school admissions outreach. Each onboarded school ("tenant") gets its own
login, its own leads, its own voice agent, and its own knowledge base built
from its own website.

This document describes what the system **actually does today** — every item
below is implemented and running, not planned. Section 13 lists the known
limits, which are as much a part of the as-built picture as the features.

---

## 2. Multi-School Tenancy

- **One row per school** (`schools`), carrying its identity (name, location,
  contact phone, website) and its own Retell agent/LLM ids.
- **Per-school voice agent**: `agent_prompt.md` remains the single canonical
  prompt template; each school's agent is provisioned from it with that
  school's name, location and phone substituted in. The school the template
  was originally written about is rendered **verbatim**, because substituting
  into it corrupted its own content (see section 12).
- **Data scoping**: leads and campaigns carry `school_id`; appointments,
  callbacks and call attempts inherit their tenant through `contact_id`.
  Knowledge chunks carry their own `school_id`.
- **Per-school overrides** (all optional, falling back to the platform
  default): Cal.com account and event slugs, Google Calendar, SMTP sender,
  and outbound caller ID.
- **Platform admin vs school user**: an admin sees every school; a school user
  is pinned to their own tenant and cannot reach another's data or settings.
- **"View as school"**: an admin can mint a short-lived token scoped to a
  school to see exactly what that school sees.

---

## 3. AI Voice Agent ("Maya")

- **Voice**: ElevenLabs `11labs-Monika` (Indian-accented female voice).
- **Multilingual**: understands and replies in **English, Hindi and Tamil**,
  including natural code-switching ("Hinglish"). If a caller speaks Telugu the
  agent says plainly that it cannot understand and offers Hindi or English —
  Retell has no Telugu locale, so this is a platform ceiling, not a config gap.
- **Identity check opening**: every call opens with "Hi, am I speaking with
  {name}?" and recognises a wide range of colloquial/regional affirmatives.
- **Grounded answers only**: every factual claim about the school comes from a
  real-time lookup against **that school's own** knowledge base — never from
  the model's memory, and never from another school's content.
- **One question at a time** during booking: date/time, then purpose, then
  email, waiting for a real answer each time.
- **No fabricated confirmations**: "your appointment is booked" or "callback
  scheduled" is only ever spoken after the corresponding backend tool call has
  actually run and returned success.

### Tools the agent can call mid-conversation
| Tool | Purpose |
|---|---|
| `lookup_school_info` | Real-time factual lookup, scoped to the calling school |
| `schedule_callback` | Creates a callback for a specific resolved time |
| `book_appointment` | Books a campus visit or an online counselling session |
| `mark_outcome` | Records the final call outcome |
| `end_call` | Hangs up (a native Retell tool, not a webhook) |

All four webhook tools carry a shared-secret header; see section 11.

---

## 4. Outbound Calling

- **Campaign dialing**: an admin uploads an Excel/CSV lead list, which becomes
  a campaign; the system dials up to a configurable concurrency limit
  (effective limit = min(local setting, the Retell account's own limit)).
- **Independent per-campaign queues**: one campaign's pace never blocks another.
- **Auto-retry with a cap**: unanswered or unresolved calls are retried
  automatically — capped at 2 automatic retries (3 attempts total) — before the
  contact is flagged for manual follow-up.
- **Do-Not-Call enforcement**: excluded from all future dials.
- **Manual "Call Now"** per contact from the dashboard.
- **Busy-contact protection**: a contact already on an active call is never
  dialed again by a different trigger; the second attempt defers instead.
- **Per-school caller ID and agent**: each call is placed with the contact's
  own school's agent and outbound number.

---

## 5. Appointment Booking — Cal.com

**Cal.com is the primary path for every appointment.** One booking call makes
Cal.com create the booking, write the event to the calendar connected to the
Cal.com account, and email the attendee. Google Calendar and SMTP are the
**fallback**, used only for a school with no Cal.com key configured — so such
a school still gets an event and an email rather than silently nothing.

| | In-person | Virtual |
|---|---|---|
| Cal.com event type | address-located (e.g. `campus-visit`) | Cal Video (e.g. `calling`) |
| Attendee receives | the campus address | their own per-booking Cal Video room |
| `virtual_meeting_link` | not set | the Cal Video URL |

- **Event types resolve by explicit slug** per meeting kind. If no slug
  matches, the booking is **refused** rather than guessed — an account with
  both a video and an in-person type would otherwise mail a campus visitor a
  video link. There is deliberately no "use the first event type" fallback.
- **Idempotent**: re-booking a contact who already has a "Booked" appointment
  updates that record, cancels the superseded Cal.com booking (and any stale
  Google Calendar event left over from the fallback path), and rebooks.
- **Zero added call latency**: all of it runs as a background task; the live
  call is never held waiting.
- **Email correction handling**: if the caller says the on-file email is wrong,
  the agent must obtain and confirm a new one before booking. Speech-to-text
  artefacts in spelled-out addresses (stray hyphens, a trailing dot before the
  `@`) are repaired automatically.
- **Staff bookings use the same path**, so a booking made by hand in the
  dashboard produces the same confirmation and calendar event as one booked by
  the agent. Reschedules, cancellations and deletions all flow through Cal.com
  too, so the attendee is actually told and the slot is actually freed.

---

## 6. Reschedule / Callback Flow

- Resolves relative time expressions ("in 10 minutes", "tomorrow evening")
  against the actual call timestamp, in IST, and confirms the resolved time
  back to the caller before scheduling.
- A callback is only confirmed to the caller after the scheduling tool call has
  actually succeeded.
- Fires from a background scheduler independent of the dashboard being open.
- **Callbacks create no calendar event.** A callback is an outbound phone call
  *we* promised to make, not a meeting the parent booked; it used to generate a
  calendar entry that read like a meeting.
- **Transcript recovery safety net**: if a caller asked to be called back but
  the agent's tool call didn't go through, the request is recovered from the
  transcript — suppressed when the agent already resolved the call
  definitively, so a booked meeting is not misread as a callback request.

---

## 7. Knowledge Base — Per School

- Each school's knowledge base is built from **its own website**
  (`schools.website`). Pages are discovered by crawling the homepage and
  ranking same-domain links by admissions relevance; asset links are skipped.
- The original single-tenant school keeps its hand-verified URL list and its
  curated static fact chunks. Those facts are injected for **that school
  only** — asserting them about a different school would be fabrication.
- **Scoped lookup**: `lookup_school_info` only ever searches the calling
  school's chunks, identified by the Retell agent that placed the call.
- **Built at onboarding**, rebuilt when a school's website changes, refreshed
  nightly for every active school, and seeded at startup for any school with
  an empty base.
- Keyword search with stop-word filtering and speech-to-text tolerations
  (homophones and common mis-transcriptions).
- A dashboard **test-search** box shows staff exactly what their agent would
  find for a given question.

---

## 8. Dashboard (React frontend)

**Dashboard** — contacts, recent call history, upcoming appointments and
pending callbacks at a glance.

**Campaigns** — all uploaded campaigns; expand for per-contact call history,
trigger an individual call, view transcripts inline.

**Leads Directory** — search and filter by status; per-contact call history,
transcript and recording playback; manual reschedule.

**Scheduling** — Callbacks and Appointments in one page via tabs; edit a
callback's time or create one manually.

**Schools** (admin only) — onboard a school (creating its agent, its Cognito
login and its knowledge base in one step), and per school:
- **Settings** showing every setting **as currently in effect**, with its
  source marked *this school* / *platform default* / *not configured*, plus
  which booking provider the school is on. Secrets are masked.
- **Edit** its name, location, contact phone, website and status. Changing
  identity re-renders its agent prompt; changing the website rebuilds its
  knowledge base.
- **Change login email** — moves the Cognito login to a new address (create
  new, then delete old, in that order, so a failure never leaves the school
  with no login).
- **Refresh agent** and **reset password**.

**System Settings** (admin only) — Retell credentials, Cal.com key/link and
event slugs, Google Calendar and SMTP fallbacks, dialer concurrency, retry
policy, and the tool-webhook shared secret. Secrets are masked once saved.

**Login** — email/password against Cognito, with a first-login
"set a new password" step.

---

## 9. Backend Reliability

- **Self-configuring voice agent**: on every startup the agent's prompt, tools
  and webhook URL are synchronised to point at *that* deployment. The
  agent/LLM identity lives in the database, so this always patches the same
  agent instead of creating duplicates, on any host.
- **Resilient database connections**: TCP keepalives, pre-flight validation,
  aggressive connection recycling and a statement timeout — all tuned to stay
  inside Retell's 20-second tool-call budget, since a stale connection used to
  hang until Retell gave up.
- **Self-healing migrations**: additive schema changes are applied and
  backfilled at startup; pre-multitenancy rows are adopted into a default
  school.
- **No silent failure masking**: a failed call placement surfaces the real
  error and reverts the contact's status instead of getting stuck.
- **Webhook signature verification**: Retell and Cal.com webhooks are
  HMAC-verified when a real signing secret is configured.
- **Atomic callback claiming**: the exact-time job and the one-minute sweep
  claim a callback with a single atomic status update, so it can never be
  double-dialed.
- **Background jobs**: safety status reset (3 min), callback sweep (1 min),
  nightly knowledge refresh, Google Calendar reconciliation (10 min).

---

## 10. Integrations

| System | What it's used for |
|---|---|
| **Retell AI** | Voice calls, speech-to-text/text-to-speech, LLM conversation |
| **Cal.com** | **Primary**: booking, calendar event and confirmation email, for both in-person and virtual |
| **AWS Cognito** | The only login path — school users and platform admins alike |
| **Google Calendar** | Fallback calendar, for a school with no Cal.com key |
| **Gmail SMTP** | Fallback confirmation email, for a school with no Cal.com key |
| **Each school's website** | Source content for that school's knowledge base |

---

## 11. Security

- **Cognito-only authentication.** The old hardcoded admin/staff login is gone;
  until the `COGNITO_*` variables are set, login returns 503 rather than
  falling back to anything. Platform admins are members of the
  `platform-admin` group.
- **Tenant isolation** enforced at three layers: query scoping on every
  data endpoint, knowledge-base scoping by calling agent, and tool-webhook
  contact resolution scoped to the calling school — so two schools sharing a
  lead's phone number cannot have a booking attached to the wrong tenant.
- **Tool-webhook shared secret** (`X-Aegis-Tools-Secret`) is configured and
  enforced: the tool endpoints reject unauthenticated calls. They are publicly
  reachable and can create bookings and callbacks, so this matters. Note the
  secret must be set in **one** place — the DB settings table or the env var,
  not both with different values, or every tool call is rejected.
- **`JWT_SECRET`** is a real random value, not the former published demo
  default. It signs only the short-lived "view as school" impersonation token.
- **Secrets masked** in both the System Settings and per-school settings UIs.
- **Webhook signature verification** for Retell and Cal.com.

---

## 12. Data Tracked (8 tables)

| Table | What it stores |
|---|---|
| `schools` | Tenants — identity, their agent ids, their per-school overrides |
| `contacts` | Leads — name, phone, email, status, `school_id` |
| `upload_batches` | Campaigns, scoped by `school_id` |
| `call_attempts` | Every call — outcome, duration, transcript, recording |
| `scheduled_callbacks` | Pending and fired reschedule requests |
| `appointments` | Bookings, with Cal.com booking id and meeting type |
| `knowledge_chunks` | Scraped website content, scoped by `school_id` |
| `settings` | Platform-wide config, including the agent's persisted identity |

---

## 13. Known Limits

These are current, real constraints — not planned work.

- **One Cal.com account serves every school by default.** Its in-person event
  type carries a single fixed address, so a second school needs its own
  Cal.com key and event slugs, or its campus visits will send parents to the
  first school's address.
- **Confirmation emails use Cal.com's own template**, not the app's branded
  HTML. That is inherent to routing email through Cal.com.
- **Knowledge retrieval is keyword-based, not semantic.** No native Retell
  knowledge base is attached (`schools.knowledge_base_id` is unset), so
  retrieval is the custom keyword search alone.
- **A page that 404s keeps its previous chunks** rather than losing content to
  a transient fetch failure, so a permanently removed page can leave stale
  content behind until the next successful full refresh.
- **Multi-tenancy is verified by test, not by production use** — only one
  school currently exists.
- **The database is shared with unrelated applications**, so table-level
  changes need care.
- A Cal.com API key was previously committed to this repository. It has been
  removed from the source, but **removing it does not revoke it** — it remains
  valid in git history until rotated in Cal.com.

---

*This document describes the system as it exists in the codebase today. Where
behaviour differs between a configured and an unconfigured school, both paths
are described rather than only the happy one.*
