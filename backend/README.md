# EnquiryCall — FastAPI Backend

## Project Setup

### 1. Create Virtual Environment
```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Run the server
```bash
python -m uvicorn src.main:app --host 0.0.0.0 --port 5000 --reload
```

The API will be available at: http://localhost:5000  
Interactive API docs: http://localhost:5000/docs
