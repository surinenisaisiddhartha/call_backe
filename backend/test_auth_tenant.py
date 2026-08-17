import requests

r = requests.post('http://127.0.0.1:5000/api/auth/login', json={'email': 'it_admin@datalabscor.com', 'password': 'DataLabs2026Secure!'})
print('Login Status:', r.status_code)
if r.status_code == 200:
    token = r.json().get('token')
    headers = {'Authorization': f'Bearer {token}'}
    
    schools = requests.get('http://127.0.0.1:5000/api/schools', headers=headers).json()
    print(f'Authenticated Schools: Found {len(schools)} schools:')
    for s in schools:
        print(f'  - {s.get("name")} (ID: {s.get("id")}, DID: {s.get("retell_phone_number")})')
        
    contacts = requests.get('http://127.0.0.1:5000/api/contacts', headers=headers).json()
    print(f'Contacts count for active tenant: {len(contacts)} contacts')
    
    classes = requests.get('http://127.0.0.1:5000/api/classes', headers=headers).json()
    print(f'Classes for active tenant: {len(classes.get("classes", []))} classes, {len(classes.get("batches", []))} batches')

    economics = requests.get('http://127.0.0.1:5000/api/providers/economics', headers=headers).json()
    print(f'Economics active providers: {len(economics.get("economics", []))}')
