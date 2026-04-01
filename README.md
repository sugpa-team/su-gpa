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

### 1) Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Backend endpoints:
- `http://127.0.0.1:8000`

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
