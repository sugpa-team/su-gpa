# SUGpa

Sabanci University Degree Evaluation and GPA Planning Calculator.

SUGpa is a project that helps students track graduation requirements, calculate GPA/CGPA, and simulate future semester outcomes.

## Project Overview

- Degree Evaluation: Matches completed courses with program requirements and shows remaining courses.
- GPA Calculation and Simulation: Calculates semester GPA and CGPA and tests possible grade scenarios.
- Course Planning: Supports planning for upcoming semesters.

## Project Structure

- `backend/`: FastAPI-based API
- `frontend/`: React-based interface

## Run the Project

Requirements:
- Python `3.10+`
- Node.js `20.19+` or `22.12+`
- npm `10+`

### 1) Backend

macOS/Linux:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Windows (PowerShell):

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

If activation is blocked in PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Backend endpoints:
- `http://127.0.0.1:8000`
- `http://127.0.0.1:8000/docs`

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend:
- `http://localhost:5173`

## Expected Impact

SUGpa transforms static degree evaluation data into an interactive academic planning experience and helps students make more informed course and grade strategies.
