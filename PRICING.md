# Call Manager (Aegis Calling) — Pricing

**Document version:** 1.1 (INR)
**Covers:** (1) monthly operating cost to run the system, (2) a project
pricing estimate for delivering it to a client.
**Exchange rate used:** ₹96.3 / USD (as of 22 July 2026) — reverify before
quoting, since this rate moves daily.

---

## Part 1 — Monthly Operating Cost

This is what it actually costs to **run** the system as currently built,
based on Retell AI's own published rate card (retellai.com/pricing), priced
exactly for the components this project actually uses — not a generic
blended estimate.

### Per-minute cost, itemized (this project's exact configuration)

| Component | Retell's published rate | Applies here because |
|---|---|---|
| Voice infrastructure (STT + orchestration) | $0.055 / min | Always charged |
| Text-to-speech — **ElevenLabs** | $0.040 / min | Agent uses voice `11labs-Monika` |
| LLM — **GPT-4.1** | $0.045 / min | Agent runs on `gpt-4.1` |
| Telephony (US number, Twilio) | $0.015 / min | Standard outbound calling |
| Knowledge base usage | $0.005 / min | Native Retell KB is attached to this agent |
| **Total per minute** | **$0.160 / min** | **= ₹15.41 / min** |

Optional add-ons **not currently enabled** (would increase this rate if turned on):

| Add-on | Extra cost | Currently used? |
|---|---|---|
| Advanced denoising | +$0.005 / min (~₹0.48) | No |
| Safety guardrails | +$0.005 / min (~₹0.48) | No |
| PII removal | +$0.01 / min (~₹0.96) | No |
| AI quality assurance | first 100 min free, then $0.10/min (~₹9.63) | No |

### Monthly call volume estimate

| Monthly call volume | Estimated minutes | Retell cost/month (₹15.41/min) |
|---|---|---|
| Light (50 calls/day, ~2 min avg) | ~3,000 min | **₹46,224** |
| Moderate (150 calls/day, ~2 min avg) | ~9,000 min | **₹1,38,672** |
| Heavy (400 calls/day, ~2 min avg) | ~24,000 min | **₹3,69,792** |

### Retell monthly subscription items (separate from per-minute usage)

| Item | Retell's rate | Cost for this project |
|---|---|---|
| Phone number (standard) | $2.00/month | **~₹193/month** |
| Verified phone number (optional upgrade) | $10.00/month + one-time $10 | ~₹963/month + one-time ~₹963 |
| Concurrency (20 free, then $8/each/month) | Free up to 20 | **₹0** — this project runs at 15 concurrent, within the free tier |
| Knowledge base (10 free, then $8/each/month) | Free up to 10 | **₹0** — this project uses 1 KB, within the free tier |
| New-account free credit | $10 one-time (~67–90 min) | Negligible at production volume |

### Fixed infrastructure (non-Retell)

| Item | Typical monthly cost |
|---|---|
| AWS EC2 (backend — small instance, e.g. `t3.small`) | ₹1,440 – ₹2,400 |
| AWS RDS PostgreSQL (small instance, e.g. `db.t3.micro`) | ₹1,440 – ₹2,880 |
| Domain + SSL (if not already owned) | ~₹100 – ₹200 (amortized) |

**Fixed infra subtotal: ~₹3,000 – ₹5,500/month**

### Free / near-zero cost

| Service | Cost |
|---|---|
| Google Calendar API (service account) | Free at this volume |
| Gmail SMTP | Free at this volume (watch Gmail's ~500/day sending limit at high volume — consider AWS SES if exceeded) |
| Website scraping (knowledge base source) | Free (self-hosted) |

### Total estimated monthly cost

| Volume tier | Retell calling | Retell phone number | Fixed infra | **Total/month** |
|---|---|---|---|---|
| Light | ₹46,224 | ₹193 | ₹3,000 – ₹5,500 | **~₹49,400 – ₹51,900** |
| Moderate | ₹1,38,672 | ₹193 | ₹3,000 – ₹5,500 | **~₹1.42L – ₹1.44L** |
| Heavy | ₹3,69,792 | ₹193 | ₹3,000 – ₹5,500 | **~₹3.73L – ₹3.75L** |

> Calling cost (voice + LLM + telephony + knowledge base, all per-minute)
> dominates the bill at any real volume — infrastructure and subscriptions are
> small, fixed line items by comparison. The single biggest lever for
> reducing cost is call volume and average call duration, not the hosting choice.

---

## Part 2 — Project Pricing Estimate (Development / Delivery)

This estimates what a project of this scope would typically cost to build
and deliver, based on the actual work involved. **Treat this as a reference
point, not a fixed quote** — your final client price should also reflect your
market, relationship with the client, and desired margin, none of which I can
determine on your behalf.

### Scope actually delivered (basis for the estimate)

- Custom FastAPI backend: campaign dialer, scheduler, webhook handlers, 5+ tool endpoints, JWT auth, role separation
- React dashboard: 5 pages (Dashboard, Campaigns, Contacts, Scheduling, Settings)
- AI voice agent: extensive prompt engineering, multilingual support (3 languages), tool-calling logic, iteratively hardened against real-call edge cases
- Integrations: Retell AI, Google Calendar (service account), SMTP, website scraping/knowledge base
- Production deployment: Docker, database migration, self-configuring agent (deployment-agnostic), reliability hardening (connection pooling, double-dial prevention, error surfacing)
- Extensive live-call QA and iterative bug-fixing (the majority of actual project effort in a system like this)

### Estimate by delivery model

| Model | Basis | Estimated range |
|---|---|---|
| **Fixed-price project** | Comparable custom AI-voice-agent + dashboard builds | **₹7.7L – ₹17.3L** (one-time) |
| **Time & materials** | ~250–450 hours at a blended ₹3,850–₹7,700/hr rate (varies heavily by region/market) | **₹9.6L – ₹34.6L** |
| **Monthly retainer** (ongoing support/iteration, post-launch) | Bug fixes, prompt tuning, feature additions | **₹77,000 – ₹2.4L/month** |

*(L = lakh = ₹100,000)*

### What drives the estimate up or down

| Pushes price up | Pushes price down |
|---|---|
| Additional languages beyond English/Hindi/Tamil | Reusing this exact codebase for a similar client (much of the hard-won prompt/reliability work transfers) |
| Custom CRM/analytics integrations | Client provides their own AWS/Retell accounts (reduces setup scope) |
| SLA/uptime guarantees, on-call support | Lower call volume (less load-testing/tuning needed) |
| Multiple concurrent campaigns/agents per client | — |

---

## Assumptions & Caveats

- **The Retell per-minute figures above are pulled directly from Retell's own
  official pricing page** (retellai.com/pricing), itemized exactly for the
  components this project actually uses (ElevenLabs voice, GPT-4.1, native
  knowledge base) — not a rough or blended third-party estimate.
- Retell pricing is in USD; converted at **₹96.3/USD (22 July 2026)** — a
  materially different exchange rate later should be re-applied to these figures.
- Retell's own pricing changes over time — reverify current rates at
  [retellai.com/pricing](https://www.retellai.com/pricing) before quoting a
  client, since AI-voice pricing has moved quickly year over year (their rate
  card has changed noticeably even within 2026).
- The development estimate in Part 2 is a **market-rate reference**, not a
  fixed quote — you know your own rate, relationship with this client, and
  margin targets better than any generic estimate can.
- Costs above assume moderate English/Hindi/Tamil call volume similar to what
  this project has been tested against; a materially different usage
  pattern (e.g., much longer average calls) should be re-modeled.

---

*Sources: Retell AI's official pricing page ([retellai.com/pricing](https://www.retellai.com/pricing)),
fetched directly on 22 July 2026, for all per-minute and subscription figures;
USD/INR rate via live market data (22 July 2026); AWS/Google/SMTP costs based
on standard published rates for comparable instance sizes.*
