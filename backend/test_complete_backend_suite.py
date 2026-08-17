import os
import sys
import json
import time
import requests

sys.stdout.reconfigure(line_buffering=True)
BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:5000")

USERS = [
    {
        "name": "User 1 (Admin)",
        "email": "it_admin@datalabscor.com",
        "password": "DataLabs2026Secure!"
    },
    {
        "name": "User 2 (Admin)",
        "email": "saisiddhartha.datalabs@gmail.com",
        "password": "Test@123"
    }
]

def get_system_secrets():
    tools_secret = "1mwP4NDBKrYmnaBvqqFm0JXTtHHYcFXx3SeiC8xy8nE"
    retell_key = "key_45b4e9afabfe88c320eabe689ffb"
    try:
        from src.db import SessionLocal, Settings
        db = SessionLocal()
        s_tool = db.query(Settings).filter(Settings.key.in_(["admission_tools_secret", "aegis_tools_secret"])).first()
        if s_tool and s_tool.value:
            tools_secret = s_tool.value
        s_retell = db.query(Settings).filter(Settings.key == "retell_api_key").first()
        if s_retell and s_retell.value:
            retell_key = s_retell.value
        db.close()
    except Exception as e:
        print(f"[WARN] Could not read secrets from DB: {e}", flush=True)
    return tools_secret, retell_key

class TestRunner:
    def __init__(self):
        self.results = []
        self.passed = 0
        self.failed = 0
        self.tools_secret, self.retell_key = get_system_secrets()

    def record(self, category, name, method, url, status_code, expected_status, passed, detail=""):
        self.results.append({
            "category": category,
            "name": name,
            "method": method,
            "url": url,
            "status_code": status_code,
            "expected_status": expected_status,
            "passed": passed,
            "detail": detail
        })
        if passed:
            self.passed += 1
            print(f"  [PASS] {method} {url} -> {status_code} ({detail})", flush=True)
        else:
            self.failed += 1
            print(f"  [FAIL] {method} {url} -> {status_code} (Expected {expected_status}: {detail})", flush=True)

    def run_tests_for_user(self, user_info):
        email = user_info["email"]
        password = user_info["password"]
        label = user_info["name"]

        print(f"\n================================================================================", flush=True)
        print(f" TESTING AS: {label} ({email})", flush=True)
        print(f"================================================================================", flush=True)

        # ---------------------------------------------------------------------
        # 1. AUTHENTICATION ROUTER (/api/auth)
        # ---------------------------------------------------------------------
        print("\n--- [1/16] Authentication Router (/api/auth) ---", flush=True)
        
        # POST /api/auth/identify
        try:
            r = requests.post(f"{BASE_URL}/api/auth/identify", json={"email": email}, timeout=10)
            self.record("Auth", "POST /api/auth/identify", "POST", "/api/auth/identify", r.status_code, [200], r.status_code == 200, f"Next: {r.json().get('next')}")
        except Exception as e:
            self.record("Auth", "POST /api/auth/identify", "POST", "/api/auth/identify", 0, [200], False, str(e))

        # POST /api/auth/login
        token = None
        headers = {}
        try:
            r = requests.post(f"{BASE_URL}/api/auth/login", json={"email": email, "password": password}, timeout=10)
            passed = r.status_code == 200 and "token" in r.json()
            if passed:
                token = r.json().get("token")
                headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
                user_obj = r.json().get("user", {})
                self.record("Auth", "POST /api/auth/login", "POST", "/api/auth/login", r.status_code, [200], True, f"Role: {user_obj.get('role')}")
            else:
                self.record("Auth", "POST /api/auth/login", "POST", "/api/auth/login", r.status_code, [200], False, r.text[:100])
        except Exception as e:
            self.record("Auth", "POST /api/auth/login", "POST", "/api/auth/login", 0, [200], False, str(e))

        if not token:
            print(f"[ABORT] Cannot proceed with authenticated endpoints for {email} without token.", flush=True)
            return

        # GET /api/auth/me
        try:
            r = requests.get(f"{BASE_URL}/api/auth/me", headers=headers, timeout=10)
            self.record("Auth", "GET /api/auth/me", "GET", "/api/auth/me", r.status_code, [200], r.status_code == 200, f"Email: {r.json().get('email')}")
        except Exception as e:
            self.record("Auth", "GET /api/auth/me", "GET", "/api/auth/me", 0, [200], False, str(e))

        # ---------------------------------------------------------------------
        # 2. SYSTEM HEALTH & CORE
        # ---------------------------------------------------------------------
        print("\n--- [2/16] System Health & Docs ---", flush=True)
        try:
            r = requests.get(f"{BASE_URL}/health", timeout=10)
            self.record("Health", "GET /health", "GET", "/health", r.status_code, [200], r.status_code == 200, f"Status: {r.json().get('status')}")
        except Exception as e:
            self.record("Health", "GET /health", "GET", "/health", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/openapi.json", timeout=10)
            self.record("Docs", "GET /openapi.json", "GET", "/openapi.json", r.status_code, [200], r.status_code == 200, f"Title: {r.json().get('info', {}).get('title')}")
        except Exception as e:
            self.record("Docs", "GET /openapi.json", "GET", "/openapi.json", 0, [200], False, str(e))

        # ---------------------------------------------------------------------
        # 3. SCHOOLS & TENANCY (/api/schools)
        # ---------------------------------------------------------------------
        print("\n--- [3/16] Schools Router (/api/schools) ---", flush=True)
        schools = []
        target_school_id = None
        try:
            r = requests.get(f"{BASE_URL}/api/schools", headers=headers, timeout=10)
            schools = r.json() if r.status_code == 200 else []
            self.record("Schools", "GET /api/schools", "GET", "/api/schools", r.status_code, [200], r.status_code == 200, f"Count: {len(schools)}")
            if schools:
                target_school_id = schools[0]["id"]
        except Exception as e:
            self.record("Schools", "GET /api/schools", "GET", "/api/schools", 0, [200], False, str(e))

        if target_school_id:
            try:
                r = requests.get(f"{BASE_URL}/api/schools/{target_school_id}/settings", headers=headers, timeout=10)
                self.record("Schools", "GET /api/schools/{id}/settings", "GET", f"/api/schools/{target_school_id[:8]}/settings", r.status_code, [200], r.status_code == 200, f"Provider: {r.json().get('active_provider')}")
            except Exception as e:
                self.record("Schools", "GET /api/schools/{id}/settings", "GET", f"/api/schools/{target_school_id[:8]}/settings", 0, [200], False, str(e))

            try:
                patch_payload = {"contact_phone": "+18645812715"}
                r = requests.patch(f"{BASE_URL}/api/schools/{target_school_id}", json=patch_payload, headers=headers, timeout=10)
                self.record("Schools", "PATCH /api/schools/{id}", "PATCH", f"/api/schools/{target_school_id[:8]}", r.status_code, [200], r.status_code == 200, "Updated contact_phone")
            except Exception as e:
                self.record("Schools", "PATCH /api/schools/{id}", "PATCH", f"/api/schools/{target_school_id[:8]}", 0, [200], False, str(e))

            try:
                patch_settings_payload = {"smtp_port": 587}
                r = requests.patch(f"{BASE_URL}/api/schools/{target_school_id}/settings", json=patch_settings_payload, headers=headers, timeout=10)
                self.record("Schools", "PATCH /api/schools/{id}/settings", "PATCH", f"/api/schools/{target_school_id[:8]}/settings", r.status_code, [200], r.status_code == 200, "Updated smtp_port")
            except Exception as e:
                self.record("Schools", "PATCH /api/schools/{id}/settings", "PATCH", f"/api/schools/{target_school_id[:8]}/settings", 0, [200], False, str(e))

            try:
                r = requests.post(f"{BASE_URL}/api/schools/{target_school_id}/view-as", headers=headers, timeout=10)
                self.record("Schools", "POST /api/schools/{id}/view-as", "POST", f"/api/schools/{target_school_id[:8]}/view-as", r.status_code, [200], r.status_code == 200, "Impersonation token minted")
            except Exception as e:
                self.record("Schools", "POST /api/schools/{id}/view-as", "POST", f"/api/schools/{target_school_id[:8]}/view-as", 0, [200], False, str(e))

        # Create & Delete School Flow
        temp_school_id = None
        try:
            unique_suffix = int(time.time())
            create_payload = {
                "name": f"Automated Test Academy {unique_suffix}",
                "location": "Hyderabad, Telangana",
                "contact_phone": "+919876543210",
                "website": "https://datalabscor.com",
                "admin_email": f"school_test_{unique_suffix}@example.com"
            }
            r = requests.post(f"{BASE_URL}/api/schools", json=create_payload, headers=headers, timeout=15)
            passed = r.status_code == 200 and "school" in r.json()
            if passed:
                temp_school_id = r.json()["school"]["id"]
                self.record("Schools", "POST /api/schools (Create)", "POST", "/api/schools", r.status_code, [200], True, f"Created ID: {temp_school_id[:8]}")
            else:
                self.record("Schools", "POST /api/schools (Create)", "POST", "/api/schools", r.status_code, [200], False, r.text[:100])
        except Exception as e:
            self.record("Schools", "POST /api/schools (Create)", "POST", "/api/schools", 0, [200], False, str(e))

        if temp_school_id:
            try:
                r = requests.delete(f"{BASE_URL}/api/schools/{temp_school_id}", headers=headers, timeout=10)
                self.record("Schools", "DELETE /api/schools/{id}", "DELETE", f"/api/schools/{temp_school_id[:8]}", r.status_code, [200], r.status_code == 200, "Cleaned up test school")
            except Exception as e:
                self.record("Schools", "DELETE /api/schools/{id}", "DELETE", f"/api/schools/{temp_school_id[:8]}", 0, [200], False, str(e))

        # ---------------------------------------------------------------------
        # 4. CONTACTS & CRM ROUTER (/api/contacts)
        # ---------------------------------------------------------------------
        print("\n--- [4/16] Contacts Router (/api/contacts) ---", flush=True)
        try:
            r = requests.get(f"{BASE_URL}/api/contacts", headers=headers, timeout=10)
            contacts_list = r.json() if r.status_code == 200 else []
            self.record("Contacts", "GET /api/contacts", "GET", "/api/contacts", r.status_code, [200], r.status_code == 200, f"Found {len(contacts_list)} contacts")
        except Exception as e:
            self.record("Contacts", "GET /api/contacts", "GET", "/api/contacts", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/contacts/stats", headers=headers, timeout=10)
            self.record("Contacts", "GET /api/contacts/stats", "GET", "/api/contacts/stats", r.status_code, [200], r.status_code == 200, f"Total: {r.json().get('total', 0)}")
        except Exception as e:
            self.record("Contacts", "GET /api/contacts/stats", "GET", "/api/contacts/stats", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/contacts/batches", headers=headers, timeout=10)
            batches = r.json() if r.status_code == 200 else []
            self.record("Contacts", "GET /api/contacts/batches", "GET", "/api/contacts/batches", r.status_code, [200], r.status_code == 200, f"Batches: {len(batches)}")
        except Exception as e:
            self.record("Contacts", "GET /api/contacts/batches", "GET", "/api/contacts/batches", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/contacts/history/all", headers=headers, timeout=10)
            history = r.json() if r.status_code == 200 else []
            self.record("Contacts", "GET /api/contacts/history/all", "GET", "/api/contacts/history/all", r.status_code, [200], r.status_code == 200, f"History items: {len(history)}")
        except Exception as e:
            self.record("Contacts", "GET /api/contacts/history/all", "GET", "/api/contacts/history/all", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/contacts/counselors/all", headers=headers, timeout=10)
            counselors = r.json() if r.status_code == 200 else []
            self.record("Contacts", "GET /api/contacts/counselors/all", "GET", "/api/contacts/counselors/all", r.status_code, [200], r.status_code == 200, f"Counselors: {len(counselors)}")
        except Exception as e:
            self.record("Contacts", "GET /api/contacts/counselors/all", "GET", "/api/contacts/counselors/all", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/contacts/counselors/analytics", headers=headers, timeout=10)
            self.record("Contacts", "GET /api/contacts/counselors/analytics", "GET", "/api/contacts/counselors/analytics", r.status_code, [200], r.status_code == 200, "Counselor metrics retrieved")
        except Exception as e:
            self.record("Contacts", "GET /api/contacts/counselors/analytics", "GET", "/api/contacts/counselors/analytics", 0, [200], False, str(e))

        # Contact Create -> Get -> Update -> Activity -> Delete Flow
        created_contact_id = None
        try:
            unique_ts = int(time.time())
            contact_payload = {
                "name": "Integration Test Lead",
                "phone_number": f"+91987654{unique_ts % 10000:04d}",
                "email": f"test_{unique_ts}@example.com",
                "grade_applying": "Grade 5",
                "city": "Hyderabad",
                "lead_source": "API Test Suite"
            }
            r = requests.post(f"{BASE_URL}/api/contacts", json=contact_payload, headers=headers, timeout=10)
            passed = r.status_code in [200, 201]
            if passed:
                created_contact_id = r.json().get("contact", {}).get("id") or r.json().get("id")
                self.record("Contacts", "POST /api/contacts", "POST", "/api/contacts", r.status_code, [200, 201], True, f"Contact ID: {created_contact_id}")
            else:
                self.record("Contacts", "POST /api/contacts", "POST", "/api/contacts", r.status_code, [200, 201], False, r.text[:100])
        except Exception as e:
            self.record("Contacts", "POST /api/contacts", "POST", "/api/contacts", 0, [200, 201], False, str(e))

        if created_contact_id:
            # GET /api/contacts/{id}
            try:
                r = requests.get(f"{BASE_URL}/api/contacts/{created_contact_id}", headers=headers, timeout=10)
                self.record("Contacts", "GET /api/contacts/{id}", "GET", f"/api/contacts/{created_contact_id}", r.status_code, [200], r.status_code == 200, f"Name: {r.json().get('name')}")
            except Exception as e:
                self.record("Contacts", "GET /api/contacts/{id}", "GET", f"/api/contacts/{created_contact_id}", 0, [200], False, str(e))

            # PATCH /api/contacts/{id}
            try:
                r = requests.patch(f"{BASE_URL}/api/contacts/{created_contact_id}", json={"notes": "Updated via automated test"}, headers=headers, timeout=10)
                self.record("Contacts", "PATCH /api/contacts/{id}", "PATCH", f"/api/contacts/{created_contact_id}", r.status_code, [200], r.status_code == 200, "Notes updated")
            except Exception as e:
                self.record("Contacts", "PATCH /api/contacts/{id}", "PATCH", f"/api/contacts/{created_contact_id}", 0, [200], False, str(e))

            # POST /api/contacts/{id}/activities
            try:
                act_payload = {"action_type": "Note", "notes": "Automated test note entry"}
                r = requests.post(f"{BASE_URL}/api/contacts/{created_contact_id}/activities", json=act_payload, headers=headers, timeout=10)
                self.record("Contacts", "POST /api/contacts/{id}/activities", "POST", f"/api/contacts/{created_contact_id}/activities", r.status_code, [200, 201], r.status_code in [200, 201], "Activity logged")
            except Exception as e:
                self.record("Contacts", "POST /api/contacts/{id}/activities", "POST", f"/api/contacts/{created_contact_id}/activities", 0, [200, 201], False, str(e))

            # GET /api/contacts/{id}/activities
            try:
                r = requests.get(f"{BASE_URL}/api/contacts/{created_contact_id}/activities", headers=headers, timeout=10)
                self.record("Contacts", "GET /api/contacts/{id}/activities", "GET", f"/api/contacts/{created_contact_id}/activities", r.status_code, [200], r.status_code == 200, f"Activities: {len(r.json())}")
            except Exception as e:
                self.record("Contacts", "GET /api/contacts/{id}/activities", "GET", f"/api/contacts/{created_contact_id}/activities", 0, [200], False, str(e))

            # DELETE /api/contacts/{id}
            try:
                r = requests.delete(f"{BASE_URL}/api/contacts/{created_contact_id}", headers=headers, timeout=10)
                self.record("Contacts", "DELETE /api/contacts/{id}", "DELETE", f"/api/contacts/{created_contact_id}", r.status_code, [200], r.status_code == 200, "Cleaned up contact")
            except Exception as e:
                self.record("Contacts", "DELETE /api/contacts/{id}", "DELETE", f"/api/contacts/{created_contact_id}", 0, [200], False, str(e))

        # Counselor Create -> Patch -> Delete Flow
        temp_counselor_id = None
        try:
            unique_ts = int(time.time())
            counselor_payload = {
                "name": f"Test Counselor {unique_ts}",
                "email": f"counselor_{unique_ts}@example.com",
                "phone_number": "+919876543211",
                "role": "Admissions"
            }
            r = requests.post(f"{BASE_URL}/api/contacts/counselors", json=counselor_payload, headers=headers, timeout=10)
            if r.status_code in [200, 201]:
                temp_counselor_id = r.json().get("counselor", {}).get("id") or r.json().get("id")
                self.record("Contacts", "POST /api/contacts/counselors", "POST", "/api/contacts/counselors", r.status_code, [200, 201], True, f"Counselor ID: {temp_counselor_id}")
            else:
                self.record("Contacts", "POST /api/contacts/counselors", "POST", "/api/contacts/counselors", r.status_code, [200, 201], False, r.text[:100])
        except Exception as e:
            self.record("Contacts", "POST /api/contacts/counselors", "POST", "/api/contacts/counselors", 0, [200, 201], False, str(e))

        if temp_counselor_id:
            try:
                r = requests.patch(f"{BASE_URL}/api/contacts/counselors/{temp_counselor_id}", json={"name": "Updated Counselor Name"}, headers=headers, timeout=10)
                self.record("Contacts", "PATCH /api/contacts/counselors/{id}", "PATCH", f"/api/contacts/counselors/{temp_counselor_id}", r.status_code, [200], r.status_code == 200, "Updated counselor name")
            except Exception as e:
                self.record("Contacts", "PATCH /api/contacts/counselors/{id}", "PATCH", f"/api/contacts/counselors/{temp_counselor_id}", 0, [200], False, str(e))

            try:
                r = requests.delete(f"{BASE_URL}/api/contacts/counselors/{temp_counselor_id}", headers=headers, timeout=10)
                self.record("Contacts", "DELETE /api/contacts/counselors/{id}", "DELETE", f"/api/contacts/counselors/{temp_counselor_id}", r.status_code, [200], r.status_code == 200, "Cleaned up counselor")
            except Exception as e:
                self.record("Contacts", "DELETE /api/contacts/counselors/{id}", "DELETE", f"/api/contacts/counselors/{temp_counselor_id}", 0, [200], False, str(e))

        # ---------------------------------------------------------------------
        # 5. CALLS & TELEPHONY ROUTER (/api/calls)
        # ---------------------------------------------------------------------
        print("\n--- [5/16] Calls Router (/api/calls) ---", flush=True)
        try:
            r = requests.get(f"{BASE_URL}/api/calls/concurrency", headers=headers, timeout=10)
            self.record("Calls", "GET /api/calls/concurrency", "GET", "/api/calls/concurrency", r.status_code, [200], r.status_code == 200, f"Limit: {r.json().get('concurrency_limit')}")
        except Exception as e:
            self.record("Calls", "GET /api/calls/concurrency", "GET", "/api/calls/concurrency", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/calls/inbound-logs", headers=headers, timeout=10)
            self.record("Calls", "GET /api/calls/inbound-logs", "GET", "/api/calls/inbound-logs", r.status_code, [200], r.status_code == 200, f"Logs: {len(r.json())}")
        except Exception as e:
            self.record("Calls", "GET /api/calls/inbound-logs", "GET", "/api/calls/inbound-logs", 0, [200], False, str(e))

        try:
            sim_payload = {"caller_name": "API Tester", "caller_phone": "+919876543210", "query": "Admission into grade 11"}
            r = requests.post(f"{BASE_URL}/api/calls/simulate-inbound", json=sim_payload, headers=headers, timeout=10)
            self.record("Calls", "POST /api/calls/simulate-inbound", "POST", "/api/calls/simulate-inbound", r.status_code, [200], r.status_code == 200, "Simulated call recorded")
        except Exception as e:
            self.record("Calls", "POST /api/calls/simulate-inbound", "POST", "/api/calls/simulate-inbound", 0, [200], False, str(e))

        try:
            inbound_wh_payload = {"caller_number": "+919876543210", "to_number": "+18645812715"}
            r = requests.post(f"{BASE_URL}/api/calls/inbound-webhook", json=inbound_wh_payload, timeout=10)
            self.record("Calls", "POST /api/calls/inbound-webhook", "POST", "/api/calls/inbound-webhook", r.status_code, [200], r.status_code == 200, f"Agent: {r.json().get('agent_name')}")
        except Exception as e:
            self.record("Calls", "POST /api/calls/inbound-webhook", "POST", "/api/calls/inbound-webhook", 0, [200], False, str(e))

        # ---------------------------------------------------------------------
        # 6. AGENT STUDIO ROUTER (/api/agent)
        # ---------------------------------------------------------------------
        print("\n--- [6/16] Agent Studio Router (/api/agent) ---", flush=True)
        try:
            r = requests.get(f"{BASE_URL}/api/agent/config", headers=headers, timeout=10)
            self.record("Agent", "GET /api/agent/config", "GET", "/api/agent/config", r.status_code, [200], r.status_code == 200, "Config loaded")
        except Exception as e:
            self.record("Agent", "GET /api/agent/config", "GET", "/api/agent/config", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/agent/prompt", headers=headers, timeout=10)
            self.record("Agent", "GET /api/agent/prompt", "GET", "/api/agent/prompt", r.status_code, [200], r.status_code == 200, f"Prompt length: {len(r.json().get('prompt', ''))}")
        except Exception as e:
            self.record("Agent", "GET /api/agent/prompt", "GET", "/api/agent/prompt", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/agent/versions", headers=headers, timeout=10)
            self.record("Agent", "GET /api/agent/versions", "GET", "/api/agent/versions", r.status_code, [200], r.status_code == 200, f"Versions count: {len(r.json())}")
        except Exception as e:
            self.record("Agent", "GET /api/agent/versions", "GET", "/api/agent/versions", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/agent/status", headers=headers, timeout=10)
            self.record("Agent", "GET /api/agent/status", "GET", "/api/agent/status", r.status_code, [200], r.status_code == 200, f"Status: {r.json().get('status')}")
        except Exception as e:
            self.record("Agent", "GET /api/agent/status", "GET", "/api/agent/status", 0, [200], False, str(e))

        try:
            r = requests.post(f"{BASE_URL}/api/agent/prompt/preview", json={"caller_name": "Siddhartha", "grade": "Grade 10"}, headers=headers, timeout=10)
            self.record("Agent", "POST /api/agent/prompt/preview", "POST", "/api/agent/prompt/preview", r.status_code, [200], r.status_code == 200, "Preview generated")
        except Exception as e:
            self.record("Agent", "POST /api/agent/prompt/preview", "POST", "/api/agent/prompt/preview", 0, [200], False, str(e))

        try:
            r = requests.post(f"{BASE_URL}/api/agent/validate", json={"config": {}}, headers=headers, timeout=10)
            self.record("Agent", "POST /api/agent/validate", "POST", "/api/agent/validate", r.status_code, [200], r.status_code == 200, "Validation executed")
        except Exception as e:
            self.record("Agent", "POST /api/agent/validate", "POST", "/api/agent/validate", 0, [200], False, str(e))

        try:
            r = requests.post(f"{BASE_URL}/api/agent/test", json={"lead": {"student_name": "Test Child", "grade_sought": "Grade 5"}}, headers=headers, timeout=10)
            self.record("Agent", "POST /api/agent/test", "POST", "/api/agent/test", r.status_code, [200], r.status_code == 200, "Interactive simulation executed")
        except Exception as e:
            self.record("Agent", "POST /api/agent/test", "POST", "/api/agent/test", 0, [200], False, str(e))

        # ---------------------------------------------------------------------
        # 7. KNOWLEDGE BASE ROUTER (/api/knowledge)
        # ---------------------------------------------------------------------
        print("\n--- [7/16] Knowledge Base Router (/api/knowledge) ---", flush=True)
        try:
            r = requests.get(f"{BASE_URL}/api/knowledge/status", headers=headers, timeout=10)
            self.record("Knowledge", "GET /api/knowledge/status", "GET", "/api/knowledge/status", r.status_code, [200], r.status_code == 200, f"Chunks: {r.json().get('total_chunks', 0)}")
        except Exception as e:
            self.record("Knowledge", "GET /api/knowledge/status", "GET", "/api/knowledge/status", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/knowledge/search?query=curriculum", headers=headers, timeout=10)
            self.record("Knowledge", "GET /api/knowledge/search", "GET", "/api/knowledge/search?query=curriculum", r.status_code, [200], r.status_code == 200, f"Search results: {len(r.json().get('results', []))}")
        except Exception as e:
            self.record("Knowledge", "GET /api/knowledge/search", "GET", "/api/knowledge/search?query=curriculum", 0, [200], False, str(e))

        # ---------------------------------------------------------------------
        # 8. RETELL TOOLS & CALL ACTIONS (/api/webhooks/tools)
        # ---------------------------------------------------------------------
        print("\n--- [8/16] Retell Tools & Webhooks (/api/webhooks/tools) ---", flush=True)
        tools_headers = {"x-admission-tools-secret": self.tools_secret, "Content-Type": "application/json"}

        # Lookup POST
        try:
            r = requests.post(f"{BASE_URL}/api/webhooks/tools/lookup", json={"query": "What are the school fees?"}, headers=tools_headers, timeout=10)
            self.record("Tools", "POST /api/webhooks/tools/lookup", "POST", "/api/webhooks/tools/lookup", r.status_code, [200], r.status_code == 200, "Answer retrieved")
        except Exception as e:
            self.record("Tools", "POST /api/webhooks/tools/lookup", "POST", "/api/webhooks/tools/lookup", 0, [200], False, str(e))

        # Lookup GET
        try:
            r = requests.get(f"{BASE_URL}/api/webhooks/tools/lookup?query=timing", headers=tools_headers, timeout=10)
            self.record("Tools", "GET /api/webhooks/tools/lookup", "GET", "/api/webhooks/tools/lookup?query=timing", r.status_code, [200], r.status_code == 200, "GET lookup worked")
        except Exception as e:
            self.record("Tools", "GET /api/webhooks/tools/lookup", "GET", "/api/webhooks/tools/lookup?query=timing", 0, [200], False, str(e))

        # Schedule Callback
        try:
            cb_payload = {"datetime_iso": "2026-08-20T10:00:00Z", "reason": "Parent inquiry", "phone_number": "+919876543210"}
            r = requests.post(f"{BASE_URL}/api/webhooks/tools/schedule-callback", json=cb_payload, headers=tools_headers, timeout=10)
            self.record("Tools", "POST /api/webhooks/tools/schedule-callback", "POST", "/api/webhooks/tools/schedule-callback", r.status_code, [200], r.status_code == 200, "Callback booked")
        except Exception as e:
            self.record("Tools", "POST /api/webhooks/tools/schedule-callback", "POST", "/api/webhooks/tools/schedule-callback", 0, [200], False, str(e))

        # Book Appointment
        try:
            appt_payload = {"datetime_iso": "2026-08-22T11:00:00Z", "purpose": "School campus visit", "attendee_name": "Test Parent", "attendee_phone": "+919876543210"}
            r = requests.post(f"{BASE_URL}/api/webhooks/tools/book-appointment", json=appt_payload, headers=tools_headers, timeout=10)
            self.record("Tools", "POST /api/webhooks/tools/book-appointment", "POST", "/api/webhooks/tools/book-appointment", r.status_code, [200], r.status_code == 200, "Appointment handled")
        except Exception as e:
            self.record("Tools", "POST /api/webhooks/tools/book-appointment", "POST", "/api/webhooks/tools/book-appointment", 0, [200], False, str(e))

        # Book Class
        try:
            bc_payload = {"student_name": "Test Student", "class_type": "STEM Robotics Workshop", "datetime_iso": "2026-08-23T10:00:00Z"}
            r = requests.post(f"{BASE_URL}/api/webhooks/tools/book-class", json=bc_payload, headers=tools_headers, timeout=10)
            self.record("Tools", "POST /api/webhooks/tools/book-class", "POST", "/api/webhooks/tools/book-class", r.status_code, [200], r.status_code == 200, "Class booked")
        except Exception as e:
            self.record("Tools", "POST /api/webhooks/tools/book-class", "POST", "/api/webhooks/tools/book-class", 0, [200], False, str(e))

        # Mark Outcome
        try:
            outcome_payload = {"outcome": "interested_followup_scheduled", "notes": "Parent interested in admission"}
            r = requests.post(f"{BASE_URL}/api/webhooks/tools/mark-outcome", json=outcome_payload, headers=tools_headers, timeout=10)
            self.record("Tools", "POST /api/webhooks/tools/mark-outcome", "POST", "/api/webhooks/tools/mark-outcome", r.status_code, [200], r.status_code == 200, "Outcome saved")
        except Exception as e:
            self.record("Tools", "POST /api/webhooks/tools/mark-outcome", "POST", "/api/webhooks/tools/mark-outcome", 0, [200], False, str(e))

        # Save Profile
        try:
            profile_payload = {"student_name": "Aditi", "grade": "Grade 6"}
            r = requests.post(f"{BASE_URL}/api/webhooks/tools/save-profile", json=profile_payload, headers=tools_headers, timeout=10)
            self.record("Tools", "POST /api/webhooks/tools/save-profile", "POST", "/api/webhooks/tools/save-profile", r.status_code, [200], r.status_code == 200, "Profile updated")
        except Exception as e:
            self.record("Tools", "POST /api/webhooks/tools/save-profile", "POST", "/api/webhooks/tools/save-profile", 0, [200], False, str(e))

        # Transfer Counselor
        try:
            trans_payload = {"reason": "Live consultation request"}
            r = requests.post(f"{BASE_URL}/api/webhooks/tools/transfer-counselor", json=trans_payload, headers=tools_headers, timeout=10)
            self.record("Tools", "POST /api/webhooks/tools/transfer-counselor", "POST", "/api/webhooks/tools/transfer-counselor", r.status_code, [200], r.status_code == 200, "Transfer checked")
        except Exception as e:
            self.record("Tools", "POST /api/webhooks/tools/transfer-counselor", "POST", "/api/webhooks/tools/transfer-counselor", 0, [200], False, str(e))

        # End Call
        try:
            r = requests.post(f"{BASE_URL}/api/webhooks/tools/end-call", json={}, headers=tools_headers, timeout=10)
            self.record("Tools", "POST /api/webhooks/tools/end-call", "POST", "/api/webhooks/tools/end-call", r.status_code, [200], r.status_code == 200, "End call processed")
        except Exception as e:
            self.record("Tools", "POST /api/webhooks/tools/end-call", "POST", "/api/webhooks/tools/end-call", 0, [200], False, str(e))

        # ---------------------------------------------------------------------
        # 9. CLASSES & BATCHES ROUTER (/api/classes)
        # ---------------------------------------------------------------------
        print("\n--- [9/16] Classes & Batches Router (/api/classes) ---", flush=True)
        try:
            r = requests.get(f"{BASE_URL}/api/classes/types", headers=headers, timeout=10)
            types_list = r.json() if r.status_code == 200 else []
            self.record("Classes", "GET /api/classes/types", "GET", "/api/classes/types", r.status_code, [200], r.status_code == 200, f"Types: {len(types_list)}")
        except Exception as e:
            self.record("Classes", "GET /api/classes/types", "GET", "/api/classes/types", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/classes/availability", headers=headers, timeout=10)
            self.record("Classes", "GET /api/classes/availability", "GET", "/api/classes/availability", r.status_code, [200], r.status_code == 200, "Availability slots returned")
        except Exception as e:
            self.record("Classes", "GET /api/classes/availability", "GET", "/api/classes/availability", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/classes/stats", headers=headers, timeout=10)
            self.record("Classes", "GET /api/classes/stats", "GET", "/api/classes/stats", r.status_code, [200], r.status_code == 200, f"Total classes: {r.json().get('total_classes')}")
        except Exception as e:
            self.record("Classes", "GET /api/classes/stats", "GET", "/api/classes/stats", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/classes/bookings", headers=headers, timeout=10)
            self.record("Classes", "GET /api/classes/bookings", "GET", "/api/classes/bookings", r.status_code, [200], r.status_code == 200, f"Bookings: {len(r.json())}")
        except Exception as e:
            self.record("Classes", "GET /api/classes/bookings", "GET", "/api/classes/bookings", 0, [200], False, str(e))

        # Class Type Create -> Update -> Delete Flow
        temp_class_type_id = None
        try:
            unique_ts = int(time.time())
            ct_payload = {
                "name": f"Trial Coding Class {unique_ts}",
                "description": "Trial class for kids",
                "icon": "coding",
                "color": "green",
                "fee": 500,
                "duration_minutes": 45,
                "max_per_slot": 15,
                "is_active": True
            }
            r = requests.post(f"{BASE_URL}/api/classes/types", json=ct_payload, headers=headers, timeout=10)
            if r.status_code in [200, 201]:
                temp_class_type_id = r.json().get("id")
                self.record("Classes", "POST /api/classes/types", "POST", "/api/classes/types", r.status_code, [200, 201], True, f"Created ID: {temp_class_type_id}")
            else:
                self.record("Classes", "POST /api/classes/types", "POST", "/api/classes/types", r.status_code, [200, 201], False, r.text[:100])
        except Exception as e:
            self.record("Classes", "POST /api/classes/types", "POST", "/api/classes/types", 0, [200, 201], False, str(e))

        if temp_class_type_id:
            try:
                r = requests.put(f"{BASE_URL}/api/classes/types/{temp_class_type_id}", json={"name": f"Updated Coding Class {int(time.time())}", "fee": 600}, headers=headers, timeout=10)
                self.record("Classes", "PUT /api/classes/types/{id}", "PUT", f"/api/classes/types/{temp_class_type_id}", r.status_code, [200], r.status_code == 200, "Updated fee")
            except Exception as e:
                self.record("Classes", "PUT /api/classes/types/{id}", "PUT", f"/api/classes/types/{temp_class_type_id}", 0, [200], False, str(e))

            try:
                r = requests.delete(f"{BASE_URL}/api/classes/types/{temp_class_type_id}", headers=headers, timeout=10)
                self.record("Classes", "DELETE /api/classes/types/{id}", "DELETE", f"/api/classes/types/{temp_class_type_id}", r.status_code, [200], r.status_code == 200, "Cleaned up class type")
            except Exception as e:
                self.record("Classes", "DELETE /api/classes/types/{id}", "DELETE", f"/api/classes/types/{temp_class_type_id}", 0, [200], False, str(e))

        # ---------------------------------------------------------------------
        # 10. COURSES ROUTER (/api/courses)
        # ---------------------------------------------------------------------
        print("\n--- [10/16] Courses Router (/api/courses) ---", flush=True)
        try:
            r = requests.get(f"{BASE_URL}/api/courses", headers=headers, timeout=10)
            courses_list = r.json() if r.status_code == 200 else []
            self.record("Courses", "GET /api/courses", "GET", "/api/courses", r.status_code, [200], r.status_code == 200, f"Found {len(courses_list)} courses")
        except Exception as e:
            self.record("Courses", "GET /api/courses", "GET", "/api/courses", 0, [200], False, str(e))

        # Course Create -> Update -> Delete Flow
        temp_course_id = None
        try:
            unique_ts = int(time.time())
            course_payload = {
                "name": f"Robotics 101 {unique_ts}",
                "code": f"ROB-{unique_ts % 1000}",
                "target_grade": "Grade 6 - 10",
                "stream": "Robotics & STEM",
                "fee_structure": "₹ 2,00,000 / annum",
                "duration": "1 Year",
                "status": "Active",
                "description": "Introduction to Robotics and Automation"
            }
            r = requests.post(f"{BASE_URL}/api/courses", json=course_payload, headers=headers, timeout=10)
            if r.status_code in [200, 201]:
                temp_course_id = r.json().get("id")
                self.record("Courses", "POST /api/courses", "POST", "/api/courses", r.status_code, [200, 201], True, f"Course ID: {temp_course_id}")
            else:
                self.record("Courses", "POST /api/courses", "POST", "/api/courses", r.status_code, [200, 201], False, r.text[:100])
        except Exception as e:
            self.record("Courses", "POST /api/courses", "POST", "/api/courses", 0, [200, 201], False, str(e))

        if temp_course_id:
            try:
                r = requests.put(f"{BASE_URL}/api/courses/{temp_course_id}", json={"name": "Robotics Advanced", "fee_structure": "₹ 2,50,000 / annum"}, headers=headers, timeout=10)
                self.record("Courses", "PUT /api/courses/{id}", "PUT", f"/api/courses/{temp_course_id}", r.status_code, [200], r.status_code == 200, "Updated course fee")
            except Exception as e:
                self.record("Courses", "PUT /api/courses/{id}", "PUT", f"/api/courses/{temp_course_id}", 0, [200], False, str(e))

            try:
                r = requests.delete(f"{BASE_URL}/api/courses/{temp_course_id}", headers=headers, timeout=10)
                self.record("Courses", "DELETE /api/courses/{id}", "DELETE", f"/api/courses/{temp_course_id}", r.status_code, [200], r.status_code == 200, "Cleaned up course")
            except Exception as e:
                self.record("Courses", "DELETE /api/courses/{id}", "DELETE", f"/api/courses/{temp_course_id}", 0, [200], False, str(e))

        # ---------------------------------------------------------------------
        # 11. APPOINTMENTS ROUTER (/api/appointments)
        # ---------------------------------------------------------------------
        print("\n--- [11/16] Appointments Router (/api/appointments) ---", flush=True)
        try:
            r = requests.get(f"{BASE_URL}/api/appointments", headers=headers, timeout=10)
            appts = r.json() if r.status_code == 200 else []
            self.record("Appointments", "GET /api/appointments", "GET", "/api/appointments", r.status_code, [200], r.status_code == 200, f"Appointments: {len(appts)}")
        except Exception as e:
            self.record("Appointments", "GET /api/appointments", "GET", "/api/appointments", 0, [200], False, str(e))

        # Appointment Create -> Get -> Update -> Delete Flow using existing contact
        temp_appt_id = None
        existing_contact_id = None
        try:
            r_c = requests.get(f"{BASE_URL}/api/contacts", headers=headers, timeout=10)
            if r_c.status_code == 200 and r_c.json():
                existing_contact_id = r_c.json()[0]["id"]
        except Exception:
            pass

        if existing_contact_id:
            try:
                appt_payload = {
                    "contact_id": existing_contact_id,
                    "scheduled_for": "2026-08-25T10:30:00Z",
                    "purpose": "Campus tour and principal meet",
                    "meeting_type": "in_person"
                }
                r = requests.post(f"{BASE_URL}/api/appointments", json=appt_payload, headers=headers, timeout=10)
                if r.status_code in [200, 201]:
                    temp_appt_id = r.json().get("id")
                    self.record("Appointments", "POST /api/appointments", "POST", "/api/appointments", r.status_code, [200, 201], True, f"Created Appt ID: {temp_appt_id}")
                else:
                    self.record("Appointments", "POST /api/appointments", "POST", "/api/appointments", r.status_code, [200, 201], False, r.text[:100])
            except Exception as e:
                self.record("Appointments", "POST /api/appointments", "POST", "/api/appointments", 0, [200, 201], False, str(e))

        if temp_appt_id:
            try:
                r = requests.get(f"{BASE_URL}/api/appointments/{temp_appt_id}", headers=headers, timeout=10)
                self.record("Appointments", "GET /api/appointments/{id}", "GET", f"/api/appointments/{temp_appt_id}", r.status_code, [200], r.status_code == 200, f"Contact: {r.json().get('contact_name')}")
            except Exception as e:
                self.record("Appointments", "GET /api/appointments/{id}", "GET", f"/api/appointments/{temp_appt_id}", 0, [200], False, str(e))

            try:
                r = requests.patch(f"{BASE_URL}/api/appointments/{temp_appt_id}", json={"status": "Completed"}, headers=headers, timeout=10)
                self.record("Appointments", "PATCH /api/appointments/{id}", "PATCH", f"/api/appointments/{temp_appt_id}", r.status_code, [200], r.status_code == 200, "Status updated to Completed")
            except Exception as e:
                self.record("Appointments", "PATCH /api/appointments/{id}", "PATCH", f"/api/appointments/{temp_appt_id}", 0, [200], False, str(e))

            try:
                r = requests.delete(f"{BASE_URL}/api/appointments/{temp_appt_id}", headers=headers, timeout=10)
                self.record("Appointments", "DELETE /api/appointments/{id}", "DELETE", f"/api/appointments/{temp_appt_id}", r.status_code, [200], r.status_code == 200, "Cleaned up appointment")
            except Exception as e:
                self.record("Appointments", "DELETE /api/appointments/{id}", "DELETE", f"/api/appointments/{temp_appt_id}", 0, [200], False, str(e))

        # ---------------------------------------------------------------------
        # 12. SCHEDULE & CALLBACKS ROUTER (/api/schedule)
        # ---------------------------------------------------------------------
        print("\n--- [12/16] Schedule & Callbacks Router (/api/schedule) ---", flush=True)
        try:
            r = requests.get(f"{BASE_URL}/api/schedule", headers=headers, timeout=10)
            callbacks = r.json() if r.status_code == 200 else []
            self.record("Schedule", "GET /api/schedule", "GET", "/api/schedule", r.status_code, [200], r.status_code == 200, f"Callbacks: {len(callbacks)}")
        except Exception as e:
            self.record("Schedule", "GET /api/schedule", "GET", "/api/schedule", 0, [200], False, str(e))

        # Schedule Callback Create -> Update -> Delete Flow
        temp_cb_id = None
        if existing_contact_id:
            try:
                cb_payload = {
                    "contactId": existing_contact_id,
                    "scheduledFor": "2026-08-26T11:00:00+05:30",
                    "callType": "Follow-up"
                }
                r = requests.post(f"{BASE_URL}/api/schedule", json=cb_payload, headers=headers, timeout=10)
                if r.status_code in [200, 201]:
                    temp_cb_id = r.json().get("id")
                    self.record("Schedule", "POST /api/schedule", "POST", "/api/schedule", r.status_code, [200, 201], True, f"Callback ID: {temp_cb_id}")
                else:
                    self.record("Schedule", "POST /api/schedule", "POST", "/api/schedule", r.status_code, [200, 201], False, r.text[:100])
            except Exception as e:
                self.record("Schedule", "POST /api/schedule", "POST", "/api/schedule", 0, [200, 201], False, str(e))

        if temp_cb_id:
            try:
                r = requests.put(f"{BASE_URL}/api/schedule/{temp_cb_id}", json={"status": "Completed"}, headers=headers, timeout=10)
                self.record("Schedule", "PUT /api/schedule/{id}", "PUT", f"/api/schedule/{temp_cb_id}", r.status_code, [200], r.status_code == 200, "Updated callback status")
            except Exception as e:
                self.record("Schedule", "PUT /api/schedule/{id}", "PUT", f"/api/schedule/{temp_cb_id}", 0, [200], False, str(e))

            try:
                r = requests.delete(f"{BASE_URL}/api/schedule/{temp_cb_id}", headers=headers, timeout=10)
                self.record("Schedule", "DELETE /api/schedule/{id}", "DELETE", f"/api/schedule/{temp_cb_id}", r.status_code, [200], r.status_code == 200, "Cleaned up callback")
            except Exception as e:
                self.record("Schedule", "DELETE /api/schedule/{id}", "DELETE", f"/api/schedule/{temp_cb_id}", 0, [200], False, str(e))

        # ---------------------------------------------------------------------
        # 13. ANALYTICS ROUTER (/api/analytics)
        # ---------------------------------------------------------------------
        print("\n--- [13/16] Analytics Router (/api/analytics) ---", flush=True)
        try:
            r = requests.get(f"{BASE_URL}/api/analytics/calls", headers=headers, timeout=10)
            self.record("Analytics", "GET /api/analytics/calls", "GET", "/api/analytics/calls", r.status_code, [200], r.status_code == 200, "Analytics metrics retrieved")
        except Exception as e:
            self.record("Analytics", "GET /api/analytics/calls", "GET", "/api/analytics/calls", 0, [200], False, str(e))

        # ---------------------------------------------------------------------
        # 14. VOICE PROVIDERS & PLATFORM ECONOMICS (/api/providers)
        # ---------------------------------------------------------------------
        print("\n--- [14/16] Voice Providers & Economics (/api/providers) ---", flush=True)
        try:
            r = requests.get(f"{BASE_URL}/api/providers", headers=headers, timeout=10)
            self.record("Providers", "GET /api/providers", "GET", "/api/providers", r.status_code, [200], r.status_code == 200, f"Providers: {len(r.json())}")
        except Exception as e:
            self.record("Providers", "GET /api/providers", "GET", "/api/providers", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/providers/active", headers=headers, timeout=10)
            self.record("Providers", "GET /api/providers/active", "GET", "/api/providers/active", r.status_code, [200], r.status_code == 200, f"Active: {r.json().get('active_provider')}")
        except Exception as e:
            self.record("Providers", "GET /api/providers/active", "GET", "/api/providers/active", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/providers/rates", headers=headers, timeout=10)
            self.record("Providers", "GET /api/providers/rates", "GET", "/api/providers/rates", r.status_code, [200], r.status_code == 200, "Rates retrieved")
        except Exception as e:
            self.record("Providers", "GET /api/providers/rates", "GET", "/api/providers/rates", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/providers/school-markups", headers=headers, timeout=10)
            self.record("Providers", "GET /api/providers/school-markups", "GET", "/api/providers/school-markups", r.status_code, [200], r.status_code == 200, f"School markups: {len(r.json())}")
        except Exception as e:
            self.record("Providers", "GET /api/providers/school-markups", "GET", "/api/providers/school-markups", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/providers/customer-pricing", headers=headers, timeout=10)
            self.record("Providers", "GET /api/providers/customer-pricing", "GET", "/api/providers/customer-pricing", r.status_code, [200], r.status_code == 200, "Customer pricing retrieved")
        except Exception as e:
            self.record("Providers", "GET /api/providers/customer-pricing", "GET", "/api/providers/customer-pricing", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/providers/call-ledger", headers=headers, timeout=10)
            self.record("Providers", "GET /api/providers/call-ledger", "GET", "/api/providers/call-ledger", r.status_code, [200], r.status_code == 200, f"Ledger records: {len(r.json())}")
        except Exception as e:
            self.record("Providers", "GET /api/providers/call-ledger", "GET", "/api/providers/call-ledger", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/providers/economics", headers=headers, timeout=10)
            self.record("Providers", "GET /api/providers/economics", "GET", "/api/providers/economics", r.status_code, [200], r.status_code == 200, "Economics data retrieved")
        except Exception as e:
            self.record("Providers", "GET /api/providers/economics", "GET", "/api/providers/economics", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/providers/logs", headers=headers, timeout=10)
            self.record("Providers", "GET /api/providers/logs", "GET", "/api/providers/logs", r.status_code, [200], r.status_code == 200, f"Logs: {len(r.json())}")
        except Exception as e:
            self.record("Providers", "GET /api/providers/logs", "GET", "/api/providers/logs", 0, [200], False, str(e))

        try:
            r = requests.get(f"{BASE_URL}/api/providers/comparisons", headers=headers, timeout=10)
            self.record("Providers", "GET /api/providers/comparisons", "GET", "/api/providers/comparisons", r.status_code, [200], r.status_code == 200, f"Comparisons: {len(r.json())}")
        except Exception as e:
            self.record("Providers", "GET /api/providers/comparisons", "GET", "/api/providers/comparisons", 0, [200], False, str(e))

        for prov in ["retell", "omnidimension", "bolna"]:
            try:
                r = requests.get(f"{BASE_URL}/api/providers/{prov}/capabilities", headers=headers, timeout=10)
                self.record("Providers", f"GET /api/providers/{prov}/capabilities", "GET", f"/api/providers/{prov}/capabilities", r.status_code, [200], r.status_code == 200, "Capabilities checked")
            except Exception as e:
                self.record("Providers", f"GET /api/providers/{prov}/capabilities", "GET", f"/api/providers/{prov}/capabilities", 0, [200], False, str(e))

            try:
                r = requests.get(f"{BASE_URL}/api/providers/{prov}/health", headers=headers, timeout=10)
                self.record("Providers", f"GET /api/providers/{prov}/health", "GET", f"/api/providers/{prov}/health", r.status_code, [200], r.status_code == 200, f"Status: {r.json().get('status') or r.json().get('healthy')}")
            except Exception as e:
                self.record("Providers", f"GET /api/providers/{prov}/health", "GET", f"/api/providers/{prov}/health", 0, [200], False, str(e))

            try:
                r = requests.get(f"{BASE_URL}/api/providers/{prov}/agents", headers=headers, timeout=10)
                self.record("Providers", f"GET /api/providers/{prov}/agents", "GET", f"/api/providers/{prov}/agents", r.status_code, [200], r.status_code == 200, "Agents list checked")
            except Exception as e:
                self.record("Providers", f"GET /api/providers/{prov}/agents", "GET", f"/api/providers/{prov}/agents", 0, [200], False, str(e))

            try:
                r = requests.get(f"{BASE_URL}/api/providers/{prov}/phone-numbers", headers=headers, timeout=10)
                self.record("Providers", f"GET /api/providers/{prov}/phone-numbers", "GET", f"/api/providers/{prov}/phone-numbers", r.status_code, [200], r.status_code == 200, "Phone numbers list checked")
            except Exception as e:
                self.record("Providers", f"GET /api/providers/{prov}/phone-numbers", "GET", f"/api/providers/{prov}/phone-numbers", 0, [200], False, str(e))

        # ---------------------------------------------------------------------
        # 15. SETTINGS ROUTER (/api/settings)
        # ---------------------------------------------------------------------
        print("\n--- [15/16] Settings Router (/api/settings) ---", flush=True)
        try:
            r = requests.get(f"{BASE_URL}/api/settings", headers=headers, timeout=10)
            self.record("Settings", "GET /api/settings", "GET", "/api/settings", r.status_code, [200], r.status_code == 200, f"Settings count: {len(r.json())}")
        except Exception as e:
            self.record("Settings", "GET /api/settings", "GET", "/api/settings", 0, [200], False, str(e))

        try:
            r = requests.post(f"{BASE_URL}/api/settings", json={"test_suite_key": "active"}, headers=headers, timeout=10)
            self.record("Settings", "POST /api/settings", "POST", "/api/settings", r.status_code, [200], r.status_code == 200, "Settings saved")
        except Exception as e:
            self.record("Settings", "POST /api/settings", "POST", "/api/settings", 0, [200], False, str(e))

        # ---------------------------------------------------------------------
        # 16. WEBHOOKS ROUTER (/api/webhooks)
        # ---------------------------------------------------------------------
        print("\n--- [16/16] Webhooks Router (/api/webhooks) ---", flush=True)
        try:
            from retell.lib.webhook_auth import symmetric
            retell_body = json.dumps({"event": "ping", "data": {}})
            retell_sig = symmetric["sign"](retell_body, self.retell_key)
            r = requests.post(
                f"{BASE_URL}/api/webhooks/retell",
                data=retell_body,
                headers={"x-retell-signature": retell_sig, "Content-Type": "application/json"},
                timeout=10
            )
            self.record("Webhooks", "POST /api/webhooks/retell", "POST", "/api/webhooks/retell", r.status_code, [200], r.status_code == 200, "Retell signed ping processed")
        except Exception as e:
            self.record("Webhooks", "POST /api/webhooks/retell", "POST", "/api/webhooks/retell", 0, [200], False, str(e))

        try:
            r = requests.post(f"{BASE_URL}/api/webhooks/omnidimension", json={"event": "ping"}, timeout=10)
            self.record("Webhooks", "POST /api/webhooks/omnidimension", "POST", "/api/webhooks/omnidimension", r.status_code, [200], r.status_code == 200, "Omnidimension ping processed")
        except Exception as e:
            self.record("Webhooks", "POST /api/webhooks/omnidimension", "POST", "/api/webhooks/omnidimension", 0, [200], False, str(e))

        try:
            r = requests.post(f"{BASE_URL}/api/webhooks/bolna", json={"event": "ping"}, timeout=10)
            self.record("Webhooks", "POST /api/webhooks/bolna", "POST", "/api/webhooks/bolna", r.status_code, [200], r.status_code == 200, "Bolna ping processed")
        except Exception as e:
            self.record("Webhooks", "POST /api/webhooks/bolna", "POST", "/api/webhooks/bolna", 0, [200], False, str(e))

        try:
            r = requests.post(f"{BASE_URL}/api/webhooks/cal", json={"triggerEvent": "BOOKING_CREATED", "payload": {}}, timeout=10)
            self.record("Webhooks", "POST /api/webhooks/cal", "POST", "/api/webhooks/cal", r.status_code, [200], r.status_code == 200, "Cal.com webhook processed")
        except Exception as e:
            self.record("Webhooks", "POST /api/webhooks/cal", "POST", "/api/webhooks/cal", 0, [200], False, str(e))


def main():
    print("=" * 80, flush=True)
    print("      STARTING COMPREHENSIVE BACKEND ENDPOINT INTEGRATION TEST SUITE", flush=True)
    print("=" * 80, flush=True)

    runner = TestRunner()
    for user in USERS:
        runner.run_tests_for_user(user)

    print("\n" + "=" * 80, flush=True)
    print("                          FINAL TEST SUMMARY", flush=True)
    print("=" * 80, flush=True)
    print(f"Total Tests Executed : {runner.passed + runner.failed}", flush=True)
    print(f"Passed (Status 200)  : {runner.passed}", flush=True)
    print(f"Failed               : {runner.failed}", flush=True)
    print("=" * 80, flush=True)

    with open("test_results.json", "w") as f:
        json.dump(runner.results, f, indent=2)
    print(f"Saved detailed results to test_results.json\n", flush=True)

    if runner.failed > 0:
        print("Failed Tests Details:", flush=True)
        for r in runner.results:
            if not r["passed"]:
                print(f" - [{r['category']}] {r['name']} ({r['method']} {r['url']}) -> Code: {r['status_code']} Detail: {r['detail']}", flush=True)
        sys.exit(1)
    else:
        print("SUCCESS: ALL ENDPOINTS ACROSS ALL 16 ROUTERS ARE 100% OPERATIONAL (0 ERRORS)!", flush=True)
        sys.exit(0)

if __name__ == "__main__":
    main()
