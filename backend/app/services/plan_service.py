"""Persistence for next-semester plans (a named selection of CRNs per term).

A plan is a saved working draft from the Planner UI: which sections you
intend to register for, in which term, under a name. Multiple plans per
term are supported (alternative scheduling scenarios).

Storage: the same SQLite DB as taken_courses (taken_course_service owns
the schema bootstrap; we just register an extra table here on first use).
"""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from app.services import taken_course_service

# Reuse the same DB path the rest of the app uses. Resolved at call time
# so monkeypatched DB_PATH (in tests) is picked up.


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(taken_course_service.DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def init_plans_db() -> None:
    """Bootstrap the plans table. Called from every public function so
    callers don't need to remember; cheap because it's CREATE IF NOT EXISTS.
    """
    Path(taken_course_service.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS plans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                term TEXT NOT NULL,
                name TEXT NOT NULL,
                sections_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


def _row_to_plan(row: sqlite3.Row) -> dict:
    sections_raw = row["sections_json"] or "[]"
    try:
        sections = json.loads(sections_raw)
    except json.JSONDecodeError:
        sections = []
    return {
        "id": row["id"],
        "term": row["term"],
        "name": row["name"],
        "sections": sections,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_plans(term: str | None = None) -> list[dict]:
    init_plans_db()
    with _connect() as conn:
        if term:
            rows = conn.execute(
                "SELECT * FROM plans WHERE term = ? ORDER BY updated_at DESC",
                (term,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM plans ORDER BY updated_at DESC"
            ).fetchall()
    return [_row_to_plan(r) for r in rows]


def get_plan(plan_id: int) -> dict:
    init_plans_db()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM plans WHERE id = ?", (plan_id,)).fetchone()
    if row is None:
        raise LookupError(f"Plan not found: {plan_id}")
    return _row_to_plan(row)


def _validate_sections(sections: object) -> list[dict]:
    if not isinstance(sections, list):
        raise ValueError("`sections` must be a list of objects.")
    cleaned: list[dict] = []
    for item in sections:
        if not isinstance(item, dict):
            raise ValueError("Each section entry must be an object.")
        course_code = str(item.get("course_code", "") or "").strip()
        crn = str(item.get("crn", "") or "").strip()
        if not course_code or not crn:
            raise ValueError("Each section entry needs course_code and crn.")
        cleaned.append(
            {
                "course_code": course_code,
                "crn": crn,
                "class_index": int(item.get("class_index", 0) or 0),
            }
        )
    return cleaned


def create_plan(term: str, name: str, sections: object) -> dict:
    if not term.strip():
        raise ValueError("Term is required.")
    if not name.strip():
        raise ValueError("Plan name is required.")
    cleaned = _validate_sections(sections)

    init_plans_db()
    with _connect() as conn:
        cursor = conn.execute(
            "INSERT INTO plans (term, name, sections_json) VALUES (?, ?, ?)",
            (term.strip(), name.strip(), json.dumps(cleaned)),
        )
        plan_id = cursor.lastrowid
    return get_plan(plan_id)


def update_plan(plan_id: int, name: str | None = None, sections: object | None = None) -> dict:
    init_plans_db()
    with _connect() as conn:
        existing = conn.execute("SELECT id FROM plans WHERE id = ?", (plan_id,)).fetchone()
        if existing is None:
            raise LookupError(f"Plan not found: {plan_id}")

        sets: list[str] = []
        params: list[object] = []
        if name is not None:
            if not name.strip():
                raise ValueError("Plan name cannot be empty.")
            sets.append("name = ?")
            params.append(name.strip())
        if sections is not None:
            cleaned = _validate_sections(sections)
            sets.append("sections_json = ?")
            params.append(json.dumps(cleaned))
        if not sets:
            return get_plan(plan_id)

        sets.append("updated_at = CURRENT_TIMESTAMP")
        params.append(plan_id)
        conn.execute(f"UPDATE plans SET {', '.join(sets)} WHERE id = ?", params)
    return get_plan(plan_id)


def delete_plan(plan_id: int) -> None:
    init_plans_db()
    with _connect() as conn:
        result = conn.execute("DELETE FROM plans WHERE id = ?", (plan_id,))
        if result.rowcount == 0:
            raise LookupError(f"Plan not found: {plan_id}")


def promote_plan_to_semester(plan_id: int) -> dict:
    """Materialize a plan as a real semester in the GPA tracker.

    Creates a semester named after the plan's term (or reuses an existing
    semester with that name), then inserts each course directly. Bypasses
    add_course_to_semester's prerequisite + overload validation: the
    planner is a record of user intent, not a sanity-checked transcript
    entry. (E.g. a student may be planning a course alongside its
    prereq in the same term.)

    Catalog miss and "already in semester" still skip with reasons, so
    nothing surprising lands in the DB.
    """
    plan = get_plan(plan_id)
    term = plan["term"]
    sections = plan["sections"]

    taken_course_service.init_taken_courses_db()
    courses_by_code = taken_course_service._course_catalog()

    imported = 0
    skipped: list[dict] = []
    with _connect() as conn:
        existing = conn.execute(
            "SELECT id FROM semesters WHERE name = ? LIMIT 1", (term,)
        ).fetchone()
        if existing:
            semester_id = existing["id"]
            created_semester = False
        else:
            cursor = conn.execute("INSERT INTO semesters (name) VALUES (?)", (term,))
            semester_id = cursor.lastrowid
            created_semester = True

        for entry in sections:
            raw_code = entry["course_code"]
            normalized = " ".join(str(raw_code).upper().split())
            if normalized not in courses_by_code:
                skipped.append({"course_code": raw_code, "reason": "Course not in catalog"})
                continue

            duplicate = conn.execute(
                "SELECT id FROM semester_courses WHERE semester_id = ? AND course_code = ? LIMIT 1",
                (semester_id, normalized),
            ).fetchone()
            if duplicate:
                skipped.append({"course_code": raw_code, "reason": "Already in semester"})
                continue

            try:
                conn.execute(
                    """
                    INSERT INTO semester_courses
                        (semester_id, course_code, grade, is_overload)
                    VALUES (?, ?, ?, ?)
                    """,
                    (semester_id, normalized, None, 0),
                )
                imported += 1
            except sqlite3.Error as error:
                skipped.append({"course_code": raw_code, "reason": str(error)})

    return {
        "plan_id": plan_id,
        "semester_id": semester_id,
        "semester_name": term,
        "created_semester": created_semester,
        "imported_courses": imported,
        "skipped": skipped,
        "summary": taken_course_service.get_semesters_summary(),
    }
