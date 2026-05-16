# SUGpa

Sabanci University Degree Evaluation and GPA Planning Calculator.

SUGpa helps students track graduation requirements, calculate GPA/CGPA, and
simulate future semester outcomes — all in the browser.

## Project Overview

- Degree Evaluation: matches completed courses with program requirements and
  shows remaining courses.
- GPA Calculation and Simulation: calculates semester GPA and CGPA and tests
  possible grade scenarios.
- Course Planning: supports planning for upcoming semesters with conflict
  detection.
- Bannerweb Importer: paste your degree-evaluation page text to seed the
  tracker.

## Architecture

SUGpa now runs **entirely in the browser**. All user data (semesters,
courses, plans, profile) lives in `localStorage`, and all calculation (GPA,
requirement matching, Bannerweb parsing) happens client-side.

- `frontend/` — Vite + React app. The only thing that ships.
- `frontend/public/data/` — static catalogs (courses, requirements, schedules)
  the app fetches at runtime.
- `scripts/scrape_suchedule/` — daily scraper that refreshes
  `frontend/public/data/schedule_data/{term}.min.json` from BannerWeb.
- `backend/` — legacy FastAPI server kept for reference. The frontend does
  not depend on it at runtime.

User data lives only in this browser. Use **Settings → Export backup (JSON)**
before switching devices or clearing browser data.

## Run locally

Requirements:
- Node.js 20.19+ or 22.12+
- npm 10+

```bash
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (defaults to `http://localhost:5173/su-gpa/`).

## Build for production

```bash
cd frontend
npm run build       # outputs to frontend/dist/
npm run preview     # serves dist/ locally at /su-gpa/
```

## Deploy to GitHub Pages

The project is configured to deploy to `https://<user>.github.io/su-gpa/`.

1. In repository settings, set **Pages → Source** to *GitHub Actions*.
2. Push to `main`. `.github/workflows/deploy.yml` builds `frontend/` and
   publishes `frontend/dist/` to Pages.

The Vite base path is `'/su-gpa/'` (see `frontend/vite.config.js`). If you
fork to a differently-named repo, update that value.

## Schedule data refresh

`.github/workflows/scrape-suchedule.yaml` runs nightly and refreshes the
files in `frontend/public/data/schedule_data/` directly. The scraper lives
at `scripts/scrape_suchedule/scrape.py` and is self-contained — it does
not depend on the rest of the codebase.
