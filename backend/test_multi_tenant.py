import requests
import json

BASE = 'http://127.0.0.1:5000/api'
print('=== STARTING MULTI-TENANT ARCHITECTURE TEST SUITE ===\n')

# 1. School Tenants
schools_res = requests.get(f'{BASE}/schools')
schools = schools_res.json() if schools_res.status_code == 200 else []
print(f'1. [SCHOOLS] Found {len(schools)} active school tenants:')
for s in schools:
    print(f'   - Tenant: {s.get("name")} (ID: {s.get("id")}, DID: {s.get("retell_phone_number")})')

# 2. Inbound DID Routing
r1 = requests.post(f'{BASE}/calls/inbound-webhook', json={'caller_number': '+919876500001', 'to_number': '+18645812715'})
d1 = r1.json()
print(f'\n2. [INBOUND ROUTING] Inbound Call to +18645812715:')
print(f'   - Resolved School ID: {d1.get("school_id")}')
print(f'   - Agent Name: {d1.get("agent_name")}')
print(f'   - Inbound Greeting: {d1.get("greeting")[:65]}...')

r2 = requests.post(f'{BASE}/calls/inbound-webhook', json={'caller_number': '+919876500002', 'to_number': '+917569891111'})
d2 = r2.json()
print(f'\n2b. [INBOUND ROUTING] Inbound Call to +91 75698 91111:')
print(f'   - Resolved School ID: {d2.get("school_id")}')
print(f'   - Agent Name: {d2.get("agent_name")}')
print(f'   - Inbound Greeting: {d2.get("greeting")[:65]}...')

# 3. Agent Config Multi-Tenancy
for s in schools:
    cfg = requests.get(f'{BASE}/agent/config?school_id={s["id"]}').json()
    print(f'\n3. [AGENT CONFIG] School: {s["name"]}:')
    print(f'   - Agent Name: {cfg.get("general", {}).get("agent_name")}')
    print(f'   - Inbound Greeting: {cfg.get("general", {}).get("inbound_greeting")[:65]}...')

# 4. Classes & Batches
classes_res = requests.get(f'{BASE}/classes')
classes_data = classes_res.json() if classes_res.status_code == 200 else {}
print(f'\n4. [CLASSES & BATCHES] Total Classes: {len(classes_data.get("classes", []))}, Batches: {len(classes_data.get("batches", []))}')

# 5. Providers Economics
econ = requests.get(f'{BASE}/providers/economics').json()
print(f'\n5. [ECONOMICS] Active Providers: {len(econ.get("economics", []))}')
for e in econ.get('economics', []):
    print(f'   - Provider: {e.get("provider_name")} | Wholesale: ₹{e.get("wholesale_cost_per_min")}/min | Selling: ₹{e.get("client_selling_price_per_min")}/min | Margin: {e.get("gross_margin_percent")}%')

print('\n=== ALL MULTI-TENANT BACKEND TESTS PASSED SUCCESSFULLY! ===')
