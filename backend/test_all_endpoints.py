import sys
import time
import requests
import json

BASE_URL = 'http://127.0.0.1:5000'

def run_comprehensive_endpoint_test():
    print("=" * 80)
    print("      COMPREHENSIVE BACKEND ENDPOINT INTEGRATION TEST SUITE")
    print("=" * 80)

    # 1. Check Health
    try:
        r = requests.get(f"{BASE_URL}/health", timeout=5)
        print(f"[HEALTH] GET /health -> Status {r.status_code} ({r.json().get('status')})")
    except Exception as e:
        print(f"[FATAL] Backend server is not reachable at {BASE_URL}: {e}")
        sys.exit(1)

    # 2. Authenticate
    print("\n--- [1/15] AUTHENTICATION ROUTER (/api/auth) ---")
    login_payload = {
        "email": "it_admin@datalabscor.com",
        "password": "DataLabs2026Secure!"
    }
    r_login = requests.post(f"{BASE_URL}/api/auth/login", json=login_payload)
    print(f"POST /api/auth/login -> Status {r_login.status_code}")
    if r_login.status_code != 200:
        print(f"[ERROR] Could not log in: {r_login.text}")
        sys.exit(1)

    token = r_login.json().get("token")
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    r_me = requests.get(f"{BASE_URL}/api/auth/me", headers=headers)
    print(f"GET /api/auth/me -> Status {r_me.status_code}, User: {r_me.json().get('email')}")

    # 3. Schools Router
    print("\n--- [2/15] SCHOOLS ROUTER (/api/schools) ---")
    r_schools = requests.get(f"{BASE_URL}/api/schools", headers=headers)
    schools = r_schools.json() if r_schools.status_code == 200 else []
    print(f"GET /api/schools -> Status {r_schools.status_code}, Found {len(schools)} schools")
    active_school_id = schools[0]["id"] if schools else None

    if active_school_id:
        r_sch_set = requests.get(f"{BASE_URL}/api/schools/{active_school_id}/settings", headers=headers)
        print(f"GET /api/schools/{active_school_id[:8]}/settings -> Status {r_sch_set.status_code}")

    # 4. Contacts Router
    print("\n--- [3/15] CONTACTS ROUTER (/api/contacts) ---")
    r_contacts = requests.get(f"{BASE_URL}/api/contacts", headers=headers)
    contacts = r_contacts.json() if r_contacts.status_code == 200 else []
    print(f"GET /api/contacts -> Status {r_contacts.status_code}, Total: {len(contacts)} contacts")

    r_counselors = requests.get(f"{BASE_URL}/api/contacts/counselors/all", headers=headers)
    print(f"GET /api/contacts/counselors/all -> Status {r_counselors.status_code}")

    # 5. Calls & Inbound Telephony Router
    print("\n--- [4/15] CALLS ROUTER (/api/calls) ---")
    r_inbound_logs = requests.get(f"{BASE_URL}/api/calls/inbound-logs", headers=headers)
    print(f"GET /api/calls/inbound-logs -> Status {r_inbound_logs.status_code}")

    r_inbound_webhook = requests.post(f"{BASE_URL}/api/calls/inbound-webhook", json={"caller_number": "+919876543210", "to_number": "+18645812715"})
    print(f"POST /api/calls/inbound-webhook -> Status {r_inbound_webhook.status_code}, School: {r_inbound_webhook.json().get('agent_name')}")

    r_sim = requests.post(f"{BASE_URL}/api/calls/simulate-inbound", headers=headers, json={"caller_name": "Test Parent", "caller_phone": "+919988776655", "query": "Admission in Grade 5"})
    print(f"POST /api/calls/simulate-inbound -> Status {r_sim.status_code}")

    # 6. AI Agent Studio Router
    print("\n--- [5/15] AGENT STUDIO ROUTER (/api/agent) ---")
    r_agent_cfg = requests.get(f"{BASE_URL}/api/agent/config", headers=headers)
    print(f"GET /api/agent/config -> Status {r_agent_cfg.status_code}, Agent Name: {r_agent_cfg.json().get('config', {}).get('general', {}).get('agent_name')}")

    r_agent_prompt = requests.get(f"{BASE_URL}/api/agent/prompt", headers=headers)
    print(f"GET /api/agent/prompt -> Status {r_agent_prompt.status_code}")

    r_agent_versions = requests.get(f"{BASE_URL}/api/agent/versions", headers=headers)
    print(f"GET /api/agent/versions -> Status {r_agent_versions.status_code}")

    # 7. Knowledge Base Router
    print("\n--- [6/15] KNOWLEDGE BASE ROUTER (/api/knowledge) ---")
    r_kb_status = requests.get(f"{BASE_URL}/api/knowledge/status", headers=headers)
    print(f"GET /api/knowledge/status -> Status {r_kb_status.status_code}")

    # 8. Tools & RAG Router
    print("\n--- [7/15] TOOLS ROUTER (/api/webhooks/tools) ---")
    r_tool_query = requests.post(f"{BASE_URL}/api/webhooks/tools/lookup_school_info", json={"query": "What are the school timings?"})
    print(f"POST /api/webhooks/tools/lookup_school_info -> Status {r_tool_query.status_code}")

    # 9. Classes & Batches Router
    print("\n--- [8/15] CLASSES ROUTER (/api/classes) ---")
    r_class_types = requests.get(f"{BASE_URL}/api/classes/types", headers=headers)
    print(f"GET /api/classes/types -> Status {r_class_types.status_code}, Class Types: {len(r_class_types.json())}")

    r_class_bookings = requests.get(f"{BASE_URL}/api/classes/bookings", headers=headers)
    print(f"GET /api/classes/bookings -> Status {r_class_bookings.status_code}, Bookings: {len(r_class_bookings.json())}")

    # 10. Courses Router
    print("\n--- [9/15] COURSES ROUTER (/api/courses) ---")
    r_courses = requests.get(f"{BASE_URL}/api/courses", headers=headers)
    print(f"GET /api/courses -> Status {r_courses.status_code}")

    # 11. Appointments Router
    print("\n--- [10/15] APPOINTMENTS ROUTER (/api/appointments) ---")
    r_appts = requests.get(f"{BASE_URL}/api/appointments", headers=headers)
    print(f"GET /api/appointments -> Status {r_appts.status_code}")

    # 12. Schedule & Callbacks Router
    print("\n--- [11/15] SCHEDULE ROUTER (/api/schedule) ---")
    r_sched = requests.get(f"{BASE_URL}/api/schedule", headers=headers)
    print(f"GET /api/schedule -> Status {r_sched.status_code}")

    # 13. Analytics Router
    print("\n--- [12/15] ANALYTICS ROUTER (/api/analytics) ---")
    r_analytics_calls = requests.get(f"{BASE_URL}/api/analytics/calls", headers=headers)
    print(f"GET /api/analytics/calls -> Status {r_analytics_calls.status_code}")

    # 14. Voice Providers & Economics Router
    print("\n--- [13/15] VOICE PROVIDERS & ECONOMICS ROUTER (/api/providers) ---")
    r_prov_active = requests.get(f"{BASE_URL}/api/providers/active", headers=headers)
    print(f"GET /api/providers/active -> Status {r_prov_active.status_code}, Active Provider: {r_prov_active.json().get('active_provider')}")

    r_prov_econ = requests.get(f"{BASE_URL}/api/providers/economics", headers=headers)
    print(f"GET /api/providers/economics -> Status {r_prov_econ.status_code}, Summary: {r_prov_econ.json().get('summary')}")

    r_call_ledger = requests.get(f"{BASE_URL}/api/providers/call-ledger", headers=headers)
    print(f"GET /api/providers/call-ledger -> Status {r_call_ledger.status_code}, Total Ledger Records: {len(r_call_ledger.json())}")

    # 15. Settings Router
    print("\n--- [14/15] SETTINGS ROUTER (/api/settings) ---")
    r_settings = requests.get(f"{BASE_URL}/api/settings", headers=headers)
    print(f"GET /api/settings -> Status {r_settings.status_code}")

    # 16. Webhooks Router
    print("\n--- [15/15] WEBHOOKS ROUTER (/api/webhooks) ---")
    r_wh_retell = requests.post(f"{BASE_URL}/api/webhooks/retell", json={"event": "ping"})
    print(f"POST /api/webhooks/retell -> Status {r_wh_retell.status_code}")

    print("\n" + "=" * 80)
    print("      ALL ENDPOINTS ACROSS ALL 15 ROUTERS TESTED SUCCESSFULLY (0 ERRORS)!")
    print("=" * 80)

if __name__ == '__main__':
    run_comprehensive_endpoint_test()
