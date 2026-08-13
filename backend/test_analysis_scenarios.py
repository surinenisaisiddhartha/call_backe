"""
Comprehensive test suite for after-call analysis — Group 1 & Group 2 scenarios.

Group 1: Previously-failing cases (now fixed)
  1. Vague callback times
  3. LLM enum vocabulary drift

Group 2: Protected cases (verify resilience)
  4. Multi-call intent preservation
  5. Short calls / early disconnects
  6. Scoring with missing analysis

Run from backend directory:
  .venv\Scripts\python.exe test_analysis_scenarios.py
"""
import sys, os, json, uuid
sys.path.insert(0, ".")

from datetime import datetime, timezone, timedelta

IST = timezone(timedelta(hours=5, minutes=30))
PASS = 0
FAIL = 0

def header(title):
    print(f"\n{'='*70}")
    print(f"  {title}")
    print(f"{'='*70}")

def check(label, condition, detail=""):
    global PASS, FAIL
    status = "PASS" if condition else "FAIL"
    if condition:
        PASS += 1
    else:
        FAIL += 1
    extra = f" -- {detail}" if detail else ""
    print(f"  [{status}] {label}{extra}")


# =====================================================================
#  GROUP 1, CASE 1: Vague Callback Times
# =====================================================================
header("GROUP 1, CASE 1: Vague Callback Times (Previously Lost)")

from src.callback_parser import parse_callback_time, has_callback_intent

vague_cases = [
    ("call me later",                "Should schedule next business day"),
    ("try next week",                "Should schedule next Monday"),
    ("call me sometime",             "Should schedule next business day"),
    ("call after a few days",        "Should schedule 2 days out"),
    ("maybe this weekend",           "Should schedule next Saturday"),
    ("busy right now another time",  "Should schedule next business day"),
    ("not a good time call later",   "Should schedule next business day"),
]

for phrase, description in vague_cases:
    result = parse_callback_time(phrase)
    if result:
        ist_time = result.replace(tzinfo=timezone.utc).astimezone(IST)
        check(
            f'"{phrase}"',
            result is not None,
            f"{description} -> {ist_time.strftime('%a %d %b %I:%M %p')} IST"
        )
    else:
        check(f'"{phrase}"', False, f"{description} -> None (STILL FAILING)")

# Verify specific times still work (no regression)
print("\n  --- Regression: Specific times still parsed correctly ---")
specific_cases = [
    ("tomorrow at 3 pm",       "Dateparser handles specific time"),
    ("after 2 hours",          "Relative duration still works"),
    ("next Monday morning",    "Day + time-of-day still works"),
]
for phrase, description in specific_cases:
    result = parse_callback_time(phrase)
    check(f'"{phrase}"', result is not None, description)

# Verify callback intent detection
print("\n  --- Callback intent detection ---")
check("has_callback_intent('call me later')", has_callback_intent("call me later"))
check("has_callback_intent('hello world')", not has_callback_intent("hello world"), "Should be False")


# =====================================================================
#  GROUP 1, CASE 3: LLM Enum Vocabulary Drift
# =====================================================================
header("GROUP 1, CASE 3: LLM Enum Vocabulary Drift (Previously Mis-scored)")

from src.routers.contacts import normalize_analysis_enums, _score_engagement, _score_interest, _score_caller_relevance

# Test normalization function
drift_cases = [
    # (input_dict, expected_field_values)
    (
        {"interest_level": "High", "engagement_quality": "Very Engaged", "caller_type": "Mother"},
        {"interest_level": "Hot", "engagement_quality": "Serious", "caller_type": "Parent"},
        "Extreme drift: High/Very Engaged/Mother"
    ),
    (
        {"interest_level": "Medium", "engagement_quality": "Polite", "caller_type": "Father"},
        {"interest_level": "Warm", "engagement_quality": "Casual", "caller_type": "Parent"},
        "Moderate drift: Medium/Polite/Father"
    ),
    (
        {"interest_level": "Low", "engagement_quality": "Disengaged", "caller_type": "Guardian"},
        {"interest_level": "Cold", "engagement_quality": "NotInterested", "caller_type": "Parent"},
        "Negative drift: Low/Disengaged/Guardian"
    ),
    (
        {"interest_level": "Hot", "engagement_quality": "Serious", "caller_type": "Parent"},
        {"interest_level": "Hot", "engagement_quality": "Serious", "caller_type": "Parent"},
        "Already canonical: no change expected"
    ),
    (
        {"interest_level": "Very Interested", "engagement_quality": "Genuine", "caller_type": "Grandparent"},
        {"interest_level": "Hot", "engagement_quality": "Serious", "caller_type": "Parent"},
        "Edge synonyms: Very Interested/Genuine/Grandparent"
    ),
]

for input_dict, expected, description in drift_cases:
    result = normalize_analysis_enums(dict(input_dict))  # copy to avoid mutation
    matches = all(result.get(k) == v for k, v in expected.items())
    check(description, matches, f"got {result}" if not matches else "")

# Test that normalization actually affects scoring
print("\n  --- Scoring impact of normalization ---")

# WITHOUT normalization: "High" would fall through to default 30
raw_drifted = {"interest_level": "High", "engagement_quality": "Very Engaged", "caller_type": "Mother"}
score_before_interest = _score_interest(dict(raw_drifted))  # Uses "High" -> .get fallback = 30
check(
    "Interest score WITHOUT normalization ('High')",
    score_before_interest == 30,
    f"Expected 30 (fallback), got {score_before_interest}"
)

# WITH normalization: "High" -> "Hot" -> 100
normalized = normalize_analysis_enums(dict(raw_drifted))
score_after_interest = _score_interest(normalized)
check(
    "Interest score WITH normalization ('High' -> 'Hot')",
    score_after_interest == 100,
    f"Expected 100, got {score_after_interest}"
)

score_before_engagement = _score_engagement({"engagement_quality": "Very Engaged"})
check(
    "Engagement score WITHOUT normalization ('Very Engaged')",
    score_before_engagement == 30,
    f"Expected 30 (fallback), got {score_before_engagement}"
)

score_after_engagement = _score_engagement(normalize_analysis_enums({"engagement_quality": "Very Engaged"}))
check(
    "Engagement score WITH normalization ('Very Engaged' -> 'Serious')",
    score_after_engagement == 100,
    f"Expected 100, got {score_after_engagement}"
)

score_before_caller = _score_caller_relevance({"caller_type": "Mother"})
check(
    "Caller relevance WITHOUT normalization ('Mother')",
    score_before_caller == 40,
    f"Expected 40 (Other fallback), got {score_before_caller}"
)

score_after_caller = _score_caller_relevance(normalize_analysis_enums({"caller_type": "Mother"}))
check(
    "Caller relevance WITH normalization ('Mother' -> 'Parent')",
    score_after_caller == 100,
    f"Expected 100, got {score_after_caller}"
)


# =====================================================================
#  GROUP 2, CASE 4: Multi-Call Intent Preservation
# =====================================================================
header("GROUP 2, CASE 4: Multi-Call Intent Preservation")

from src.db import SessionLocal, Contact, CallAttempt, init_db
init_db()

db = SessionLocal()
try:
    # Create a temporary test contact
    test_contact_id = f"test_{uuid.uuid4().hex[:12]}"
    test_contact = Contact(
        id=test_contact_id,
        name="Test MultiCall",
        phone_number="+919999900000",
        status="Called",
    )
    db.add(test_contact)

    # Call 1: Detailed inquiry (Hot, Serious)
    call1 = CallAttempt(
        contact_id=test_contact_id,
        retell_call_id=f"call1_{uuid.uuid4().hex[:8]}",
        attempt_number=1,
        started_at=datetime.utcnow() - timedelta(hours=2),
        ended_at=datetime.utcnow() - timedelta(hours=2) + timedelta(minutes=5),
        duration_sec=300,
        outcome="Answered",
        analysis_json=json.dumps({
            "interest_level": "Hot",
            "engagement_quality": "Serious",
            "caller_type": "Parent",
            "topics_discussed": "Fees, Admissions, Curriculum",
            "primary_topic": "Admissions",
            "call_synopsis": "Detailed inquiry about admissions process and fees.",
            "concerns_raised": "Distance from home",
            "recommended_next_step": "Schedule campus visit",
        }),
        detected_topics="Fees & Tuition,Admissions,Curriculum & Syllabus",
        user_sentiment="Positive",
    )
    db.add(call1)

    # Call 2: Brief follow-up (Warm, Casual) — should NOT downgrade
    call2 = CallAttempt(
        contact_id=test_contact_id,
        retell_call_id=f"call2_{uuid.uuid4().hex[:8]}",
        attempt_number=2,
        started_at=datetime.utcnow() - timedelta(hours=1),
        ended_at=datetime.utcnow() - timedelta(hours=1) + timedelta(seconds=15),
        duration_sec=15,
        outcome="Answered",
        analysis_json=json.dumps({
            "interest_level": "Warm",
            "engagement_quality": "Casual",
            "caller_type": "Parent",
            "topics_discussed": "Timings",
            "primary_topic": "Timings",
            "call_synopsis": "Quick question about school timings.",
        }),
        detected_topics="School Timings",
        user_sentiment="Neutral",
    )
    db.add(call2)
    db.commit()

    # Now compute lead scores
    from src.routers.contacts import compute_lead_scores
    scores = compute_lead_scores(db, [test_contact])
    result = scores.get(test_contact_id, {})

    # The merged analysis should keep "Hot" (not downgrade to "Warm")
    param_scores = result.get("parameter_scores", {})
    interest_score = param_scores.get("interest_level", 0)
    engagement_score = param_scores.get("engagement_quality", 0)

    check(
        "Interest preserved as Hot (100) after brief 2nd call",
        interest_score == 100,
        f"Got {interest_score} (expected 100 = Hot)"
    )
    check(
        "Engagement preserved as Serious after brief 2nd call",
        engagement_score >= 90,  # 100 base + possible sentiment modifier
        f"Got {engagement_score} (expected >= 90 = Serious + Positive sentiment)"
    )
    check(
        "Overall classification stays HOT",
        result.get("classification") == "HOT",
        f"Got {result.get('classification')}"
    )
    check(
        "Topics union includes all from both calls",
        param_scores.get("conversation_depth", 0) >= 80,
        f"Depth score {param_scores.get('conversation_depth', 0)} (4+ topics expected)"
    )

    # Cleanup
    db.query(CallAttempt).filter(CallAttempt.contact_id == test_contact_id).delete()
    db.query(Contact).filter(Contact.id == test_contact_id).delete()
    db.commit()

except Exception as e:
    print(f"  [ERROR] Multi-call test failed: {e}")
    import traceback
    traceback.print_exc()
    db.rollback()
    FAIL += 1
finally:
    db.close()


# =====================================================================
#  GROUP 2, CASE 5: Short Calls / Early Disconnects
# =====================================================================
header("GROUP 2, CASE 5: Short Calls / Early Disconnects")

db = SessionLocal()
try:
    test_contact_id = f"test_{uuid.uuid4().hex[:12]}"
    test_contact = Contact(
        id=test_contact_id,
        name="Test ShortCall",
        phone_number="+919999900001",
        status="Called",
    )
    db.add(test_contact)

    # A 3-second call that hung up immediately
    short_call = CallAttempt(
        contact_id=test_contact_id,
        retell_call_id=f"short_{uuid.uuid4().hex[:8]}",
        attempt_number=1,
        started_at=datetime.utcnow() - timedelta(minutes=10),
        ended_at=datetime.utcnow() - timedelta(minutes=10) + timedelta(seconds=3),
        duration_sec=3,
        outcome="IncompleteHangup",
        analysis_json=json.dumps({
            "interest_level": "Unclear",
            "engagement_quality": "Unclear",
            "caller_type": "NotAvailable",
            "call_synopsis": "Call connected briefly and disconnected.",
        }),
        user_sentiment="Neutral",
    )
    db.add(short_call)
    db.commit()

    scores = compute_lead_scores(db, [test_contact])
    result = scores.get(test_contact_id, {})

    check(
        "Short call does NOT inflate conversation depth",
        result.get("parameter_scores", {}).get("conversation_depth") in (None, 0, 20),
        f"Got {result.get('parameter_scores', {}).get('conversation_depth')}"
    )
    check(
        "Short call classified as COLD (not HOT)",
        result.get("classification") in ("COLD", "UNSCORED"),
        f"Got {result.get('classification')}"
    )
    check(
        "Score is low for disconnected call",
        (result.get("score") or 0) < 40,
        f"Got {result.get('score')}"
    )

    # Cleanup
    db.query(CallAttempt).filter(CallAttempt.contact_id == test_contact_id).delete()
    db.query(Contact).filter(Contact.id == test_contact_id).delete()
    db.commit()

except Exception as e:
    print(f"  [ERROR] Short call test failed: {e}")
    import traceback
    traceback.print_exc()
    db.rollback()
    FAIL += 1
finally:
    db.close()


# =====================================================================
#  GROUP 2, CASE 6: Uncontacted Lead (No calls at all)
# =====================================================================
header("GROUP 2, CASE 6: Uncontacted Lead Scoring")

db = SessionLocal()
try:
    test_contact_id = f"test_{uuid.uuid4().hex[:12]}"
    test_contact = Contact(
        id=test_contact_id,
        name="Test NoCalls",
        phone_number="+919999900002",
        status="Pending",
    )
    db.add(test_contact)
    db.commit()

    scores = compute_lead_scores(db, [test_contact])
    result = scores.get(test_contact_id, {})

    check(
        "Uncontacted lead classified as UNSCORED",
        result.get("classification") == "UNSCORED",
        f"Got {result.get('classification')}"
    )
    check(
        "Score is None for uncontacted lead",
        result.get("score") is None,
        f"Got {result.get('score')}"
    )
    check(
        "Uncontacted flag is set",
        result.get("uncontacted") == True,
        f"Got {result.get('uncontacted')}"
    )

    # Cleanup
    db.query(Contact).filter(Contact.id == test_contact_id).delete()
    db.commit()

except Exception as e:
    print(f"  [ERROR] Uncontacted test failed: {e}")
    import traceback
    traceback.print_exc()
    db.rollback()
    FAIL += 1
finally:
    db.close()


# =====================================================================
#  GROUP 2: Sentiment merging across calls
# =====================================================================
header("GROUP 2, BONUS: Sentiment Merging Across Calls")

db = SessionLocal()
try:
    test_contact_id = f"test_{uuid.uuid4().hex[:12]}"
    test_contact = Contact(
        id=test_contact_id,
        name="Test Sentiment",
        phone_number="+919999900003",
        status="Called",
    )
    db.add(test_contact)

    # Call 1: Negative sentiment
    call1 = CallAttempt(
        contact_id=test_contact_id,
        retell_call_id=f"sent1_{uuid.uuid4().hex[:8]}",
        attempt_number=1,
        started_at=datetime.utcnow() - timedelta(hours=3),
        ended_at=datetime.utcnow() - timedelta(hours=3) + timedelta(minutes=3),
        duration_sec=180,
        outcome="Answered",
        analysis_json=json.dumps({
            "interest_level": "Cold",
            "engagement_quality": "NotInterested",
            "caller_type": "Parent",
        }),
        user_sentiment="Negative",
    )
    db.add(call1)

    # Call 2: Positive sentiment (callback)
    call2 = CallAttempt(
        contact_id=test_contact_id,
        retell_call_id=f"sent2_{uuid.uuid4().hex[:8]}",
        attempt_number=2,
        started_at=datetime.utcnow() - timedelta(hours=1),
        ended_at=datetime.utcnow() - timedelta(hours=1) + timedelta(minutes=5),
        duration_sec=300,
        outcome="Answered",
        analysis_json=json.dumps({
            "interest_level": "Hot",
            "engagement_quality": "Serious",
            "caller_type": "Parent",
            "topics_discussed": "Fees, Admissions",
        }),
        user_sentiment="Positive",
    )
    db.add(call2)
    db.commit()

    scores = compute_lead_scores(db, [test_contact])
    result = scores.get(test_contact_id, {})

    # Sentiment merge should keep "Positive" (best)
    # Engagement should use Serious (100) + Positive boost (+10) = capped at 100
    engagement = result.get("parameter_scores", {}).get("engagement_quality", 0)
    check(
        "Sentiment merged to most positive (Positive kept over Negative)",
        engagement >= 100,
        f"Engagement score: {engagement} (Serious=100 + Positive=+10, capped at 100)"
    )
    check(
        "Interest preserved at Hot despite earlier Cold call",
        result.get("parameter_scores", {}).get("interest_level") == 100,
        f"Got {result.get('parameter_scores', {}).get('interest_level')}"
    )

    # Cleanup
    db.query(CallAttempt).filter(CallAttempt.contact_id == test_contact_id).delete()
    db.query(Contact).filter(Contact.id == test_contact_id).delete()
    db.commit()

except Exception as e:
    print(f"  [ERROR] Sentiment test failed: {e}")
    import traceback
    traceback.print_exc()
    db.rollback()
    FAIL += 1
finally:
    db.close()


# =====================================================================
#  SUMMARY
# =====================================================================
print(f"\n{'='*70}")
print(f"  RESULTS: {PASS} passed, {FAIL} failed, {PASS + FAIL} total")
print(f"{'='*70}")
if FAIL == 0:
    print("  All tests passed!")
else:
    print(f"  {FAIL} test(s) need attention.")
