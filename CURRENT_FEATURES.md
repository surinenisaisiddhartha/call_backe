# EnquiryCall — Current Features

**Document type:** Feature catalog (as-built, grounded directly in the codebase)
**Document version:** 3.0
**As of:** 3 August 2026, `feature/merged-updates` branch

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
- **One question per turn** during booking — a hard rule, not a preference.
  At most one question mark per turn, and "and"/"also" joining two questions
  is forbidden. It also may not describe what an appointment involves until
  the caller has said in-person or virtual, must answer a caller's own
  question before continuing its own, and must not re-ask something already
  given. This was tightened after a real call where the agent asked three
  things at once, described a campus tour to someone who wanted a video
  call, and had to be corrected twice.
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

**Landing page** — a public marketing page at the root URL for signed-out
visitors, describing the product; "Login to Console" reveals the sign-in form
(`#login`). Signed-in users never see it.

**Dashboard** — contacts, recent call history, upcoming appointments and
pending callbacks at a glance, with a time-of-day greeting.

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
- **Logo upload** — a school's logo is uploaded to AWS S3 and shown in its
  dashboard header. Requires `S3_BUCKET_NAME` and an AWS region on the
  server; the endpoint returns a clear 500 if they are missing.
- **Refresh agent** and **reset password**.

**Pagination** on the Campaigns, Leads, Scheduling and Schools tables, with a
selectable page size.

**System Settings** (admin only) — Retell credentials, Cal.com key/link and
event slugs, Google Calendar and SMTP fallbacks, dialer concurrency, retry
policy, and the tool-webhook shared secret. Secrets are masked once saved.

**Login** — two steps: enter an email, which identifies which school it
belongs to (by registered address, or by domain against the school's own
website host), then a password on a screen branded with that school. A
first-login "set a new password" step follows a temporary password.

### Error handling
- Every failure states what actually went wrong rather than one generic
  message: server unreachable, request timed out, permission denied, item
  gone, server error. It also detects an **HTML body on a JSON API** and says
  the API URL is likely wrong — the exact symptom of a misrouted deployment.
- **Login errors are inline and persist** until a field is edited, rather
  than a toast that vanishes in four seconds away from the field concerned.
  The email step validates the address before spending a round trip.
- A wrong password and an unknown email give **identical wording**, so the
  form cannot be used to discover which accounts exist.
- An **error boundary** catches render crashes and offers Reload or "Sign out
  and reset", instead of a blank white page.

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

### Performance
The database is remote, so a query costs tens of milliseconds of network
latency rather than real work (measured: 18–44 ms warm, ~80 ms on a new
connection). The work below removed round trips rather than computation.

- **No N+1 queries** on the dashboard endpoints. Appointments fetched one
  contact per row (11 queries for 10 rows); campaigns ran a `GROUP BY` per
  campaign; callbacks lazy-loaded each contact. All are now single batched
  or joined queries, so they no longer degrade as rows are added.
- **A short-lived in-process cache** (`src/cache.py`) for the things that
  don't change between calls: platform settings (30 s), a school by agent id
  (60 s), a school's knowledge chunks (5 min, storing the pre-processed
  search form), Cal.com event types (5 min), and Retell's account
  concurrency limit (60 s).
- Caches are **invalidated explicitly on write** — a knowledge refresh, a
  settings save, or an agent provision clears the relevant entry at once
  rather than waiting for the TTL. This matters most for the tools secret: a
  stale one would reject every tool call mid-conversation.
- A Cal.com failure is deliberately **never** cached, so one network blip
  cannot keep bookings failing for the whole TTL.

Effect: the full dashboard load went from ~2.9 s to ~0.65 s, and
`lookup_school_info` — which runs while a caller waits on the phone — from
611 ms with 3 queries to 14 ms with none.

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
- **The cache is per process.** Run with more than one uvicorn worker and
  each holds its own copy; invalidating in one does not clear the others.
  The TTLs bound how far a worker can lag — hence 30 s for settings. Scaling
  beyond a single process means moving this to Redis.
- **Pagination is client-side.** The table pages through a list that was
  fetched in full, so it improves readability, not load time. Large lead
  lists will still transfer entirely on every page load.
- **Logo upload needs AWS S3 configured** (`S3_BUCKET_NAME` plus a region
  and credentials). Without it the upload endpoint returns a 500.
- **Multi-tenancy is verified by test, not by production use** — only one
  school currently exists.
- **A Cognito login is bound to whichever database was active when it was
  created** (`custom:school_id`). Onboarding a school against one database
  and signing in against another produces an account that authenticates but
  sees no data. The clean fix is granting
  `cognito-idp:AdminUpdateUserAttributes` to the backend's IAM user so the
  binding can be corrected in one call.
- **The database is shared with unrelated applications**, so table-level
  changes need care.
- A Cal.com API key was previously committed to this repository. It has been
  removed from the source, but **removing it does not revoke it** — it remains
  valid in git history until rotated in Cal.com.

---

*This document describes the system as it exists in the codebase today. Where
behaviour differs between a configured and an unconfigured school, both paths
are described rather than only the happy one.*
