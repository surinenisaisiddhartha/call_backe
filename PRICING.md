# Call Manager (Aegis Calling) — Pricing

**Document version:** 1.1 (INR)
**Covers:** (1) monthly operating cost to run the system, (2) a project
pricing estimate for delivering it to a client.
**Exchange rate used:** ₹96.3 / USD (as of 22 July 2026) — reverify before
quoting, since this rate moves daily.

---

## Part 1 — Monthly Operating Cost

This is what it actually costs to **run** the system as currently built,
based on real 2026 provider pricing. Assumes a moderate call volume for a
single school's admissions outreach.

### Usage-based: Voice calling (Retell AI)

Retell AI's real production cost isn't just its advertised per-minute rate —
it's four components stacked together: voice infrastructure, text-to-speech,
the LLM, and telephony.

| Component | Rate |
|---|---|
| Retell voice infrastructure (STT + orchestration) | ₹6.7 / min |
| LLM (this project uses `gpt-4.1`, not a basic model) | ~₹3 – ₹6 / min |
| Text-to-speech (ElevenLabs `11labs-Monika`) | included in blended rate below |
| **Blended real-world rate for this exact setup** | **~₹19 – ₹24 / min** |

| Monthly call volume | Estimated minutes | Estimated Retell cost/month |
|---|---|---|
| Light (50 calls/day, ~2 min avg) | ~3,000 min | **₹57,600 – ₹72,000** |
| Moderate (150 calls/day, ~2 min avg) | ~9,000 min | **₹1,72,800 – ₹2,16,000** |
| Heavy (400 calls/day, ~2 min avg) | ~24,000 min | **₹4,60,800 – ₹5,76,000** |

Additional Retell line items:
- Branded Caller ID (if desired): **+₹19,200/month**
- New accounts get ₹960 in free credit (~67–90 minutes) — not meaningful at production volume.

### Fixed infrastructure

| Item | Typical monthly cost |
|---|---|
| AWS EC2 (backend — small instance, e.g. `t3.small`) | ₹1,440 – ₹2,400 |
| AWS RDS PostgreSQL (small instance, e.g. `db.t3.micro`) | ₹1,440 – ₹2,880 |
| Domain + SSL (if not already owned) | ~₹100 – ₹200 (amortized) |
| Retell phone number rental | ~₹200 – ₹960 |

**Fixed infra subtotal: ~₹3,200 – ₹6,400/month**

### Free / near-zero cost

| Service | Cost |
|---|---|
| Google Calendar API (service account) | Free at this volume |
| Gmail SMTP | Free at this volume (watch Gmail's ~500/day sending limit at high volume — consider AWS SES if exceeded) |
| Website scraping (knowledge base) | Free (self-hosted) |

### Total estimated monthly cost

| Volume tier | Retell (calling) | Fixed infra | **Total/month** |
|---|---|---|---|
| Light | ₹57,600 – ₹72,000 | ₹3,200 – ₹6,400 | **~₹61,000 – ₹78,000** |
| Moderate | ₹1,72,800 – ₹2,16,000 | ₹3,200 – ₹6,400 | **~₹1.76L – ₹2.22L** |
| Heavy | ₹4,60,800 – ₹5,76,000 | ₹3,200 – ₹6,400 | **~₹4.64L – ₹5.82L** |

> Calling cost dominates the bill at any real volume — infrastructure is a
> small, fairly fixed line item by comparison. The single biggest lever for
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

- Retell pricing is in USD; converted at **₹96.3/USD (22 July 2026)** — a
  materially different exchange rate later should be re-applied to these figures.
- Retell's own pricing changes over time — reverify current rates at
  [retellai.com/pricing](https://www.retellai.com) before quoting a client,
  since AI-voice pricing has moved quickly year over year.
- The development estimate is a **market-rate reference**, not a fixed quote
  — you know your own rate, relationship with this client, and margin
  targets better than any generic estimate can.
- Costs above assume moderate English/Hindi/Tamil call volume similar to what
  this project has been tested against; a materially different usage
  pattern (e.g., much longer average calls) should be re-modeled.

---

*Sources: Retell AI 2026 pricing data gathered via current market research
([retellai.com/blog](https://www.retellai.com/blog/ai-voice-agent-pricing-full-cost-breakdown-platform-comparison-roi-analysis),
[cekura.ai](https://www.cekura.ai/blogs/retell-ai-pricing-per-minute)); USD/INR
rate via live market data (22 July 2026); AWS/Google/SMTP costs based on
standard published rates for comparable instance sizes.*
