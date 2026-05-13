"""Course feedback storage and lightweight recommendation helpers.

Feedback is intentionally small and structured. SUGpa has no user/account
model yet, so this stores one editable feedback record per course in the same
local SQLite database used for semesters and saved plans.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

from app.services import schedule_service, taken_course_service

DIFFICULTY_VALUES = {"easy", "medium", "hard"}
WORKLOAD_VALUES = {"low", "medium", "high"}
GRADING_STYLE_VALUES = {"exam-heavy", "project-heavy", "mixed"}
RECOMMENDATION_VALUES = {"yes", "maybe", "no"}
MAX_NOTE_LENGTH = 500


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(taken_course_service.DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def init_course_feedback_db() -> None:
    Path(taken_course_service.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS course_feedback (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                course_code TEXT NOT NULL UNIQUE,
                difficulty TEXT NOT NULL,
                workload TEXT NOT NULL,
                grading_style TEXT NOT NULL,
                recommendation TEXT NOT NULL,
                note TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


def _normalize_course_code(course_code: str) -> str:
    normalized = taken_course_service._normalize_course_code(str(course_code or ""))
    if not normalized:
        raise ValueError("Course code is required.")
    return normalized


def _validate_choice(field: str, value: str, allowed: set[str]) -> str:
    cleaned = str(value or "").strip().lower()
    if cleaned not in allowed:
        allowed_list = ", ".join(sorted(allowed))
        raise ValueError(f"{field} must be one of: {allowed_list}.")
    return cleaned


def _validate_note(note: str | None) -> str:
    cleaned = str(note or "").strip()
    if len(cleaned) > MAX_NOTE_LENGTH:
        raise ValueError(f"Note must be {MAX_NOTE_LENGTH} characters or fewer.")
    return cleaned


def _ensure_course_exists(course_code: str) -> None:
    catalog = taken_course_service._course_catalog()
    if course_code not in catalog:
        raise LookupError(f"Course not found: {course_code}")


def _row_to_feedback(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "course_code": row["course_code"],
        "difficulty": row["difficulty"],
        "workload": row["workload"],
        "grading_style": row["grading_style"],
        "recommendation": row["recommendation"],
        "note": row["note"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_feedback() -> list[dict]:
    init_course_feedback_db()
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM course_feedback
            ORDER BY updated_at DESC, course_code ASC
            """
        ).fetchall()
    return [_row_to_feedback(row) for row in rows]


def get_feedback(course_code: str) -> dict:
    normalized = _normalize_course_code(course_code)
    init_course_feedback_db()
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM course_feedback WHERE course_code = ?",
            (normalized,),
        ).fetchone()
    if row is None:
        raise LookupError(f"Feedback not found for course: {normalized}")
    return _row_to_feedback(row)


def feedback_by_course() -> dict[str, dict]:
    return {item["course_code"]: item for item in list_feedback()}


def upsert_feedback(
    course_code: str,
    difficulty: str,
    workload: str,
    grading_style: str,
    recommendation: str,
    note: str | None = None,
) -> dict:
    normalized = _normalize_course_code(course_code)
    _ensure_course_exists(normalized)

    cleaned_difficulty = _validate_choice("difficulty", difficulty, DIFFICULTY_VALUES)
    cleaned_workload = _validate_choice("workload", workload, WORKLOAD_VALUES)
    cleaned_grading_style = _validate_choice(
        "grading_style",
        grading_style,
        GRADING_STYLE_VALUES,
    )
    cleaned_recommendation = _validate_choice(
        "recommendation",
        recommendation,
        RECOMMENDATION_VALUES,
    )
    cleaned_note = _validate_note(note)

    init_course_feedback_db()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO course_feedback
                (course_code, difficulty, workload, grading_style, recommendation, note)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(course_code) DO UPDATE SET
                difficulty = excluded.difficulty,
                workload = excluded.workload,
                grading_style = excluded.grading_style,
                recommendation = excluded.recommendation,
                note = excluded.note,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                normalized,
                cleaned_difficulty,
                cleaned_workload,
                cleaned_grading_style,
                cleaned_recommendation,
                cleaned_note,
            ),
        )

    return get_feedback(normalized)


def delete_feedback(course_code: str) -> None:
    normalized = _normalize_course_code(course_code)
    init_course_feedback_db()
    with _connect() as conn:
        result = conn.execute(
            "DELETE FROM course_feedback WHERE course_code = ?",
            (normalized,),
        )
    if result.rowcount == 0:
        raise LookupError(f"Feedback not found for course: {normalized}")


def build_feedback_summaries() -> dict[str, dict]:
    """Return a compact mapping for frontend course lists."""
    summaries: dict[str, dict] = {}
    for item in list_feedback():
        summaries[item["course_code"]] = {
            "course_code": item["course_code"],
            "difficulty": item["difficulty"],
            "workload": item["workload"],
            "grading_style": item["grading_style"],
            "recommendation": item["recommendation"],
            "note": item["note"],
        }
    return summaries


def _category_needs() -> set[str]:
    progress = taken_course_service.get_graduation_requirements_progress()
    needed: set[str] = set()
    for item in progress.get("categories", []):
        category = item.get("category")
        if not category:
            continue
        pct = item.get("progress_percent")
        required_su = item.get("required_su")
        required_ects = item.get("required_ects")
        required_courses = item.get("required_courses")
        has_requirement = any(
            value is not None
            for value in (required_su, required_ects, required_courses)
        )
        if has_requirement and (pct is None or float(pct) < 100):
            needed.add(category)
    return needed


def _has_schedulable_section(course: dict) -> bool:
    for cls in course.get("classes", []):
        for section in cls.get("sections", []):
            if section.get("schedule"):
                return True
    return False


def _feedback_score(feedback: dict | None) -> tuple[int, list[str]]:
    if not feedback:
        return 0, []

    score = 0
    reasons: list[str] = []
    recommendation = feedback.get("recommendation")
    workload = feedback.get("workload")
    difficulty = feedback.get("difficulty")

    if recommendation == "yes":
        score += 14
        reasons.append("Marked as recommended in course feedback.")
    elif recommendation == "maybe":
        score += 5
        reasons.append("Feedback says it may be worth taking.")
    elif recommendation == "no":
        score -= 18
        reasons.append("Feedback does not recommend this course.")

    if workload == "low":
        score += 9
        reasons.append("Low workload feedback.")
    elif workload == "medium":
        score += 3
    elif workload == "high":
        score -= 6
        reasons.append("High workload feedback.")

    if difficulty == "easy":
        score += 7
        reasons.append("Easy difficulty feedback.")
    elif difficulty == "medium":
        score += 2
    elif difficulty == "hard":
        score -= 4
        reasons.append("Hard difficulty feedback.")

    return score, reasons


def build_recommendations(term: str, limit: int = 8) -> dict:
    cleaned_term = str(term or "").strip()
    if not cleaned_term:
        raise ValueError("Term is required.")
    safe_limit = max(1, min(int(limit or 8), 20))

    courses = schedule_service.get_planner_courses(
        cleaned_term,
        taken_course_service._course_catalog(),
        taken_course_service._prerequisites_by_course(),
        taken_course_service.get_category_membership(),
    )
    feedback_map = feedback_by_course()
    taken_codes = taken_course_service.get_taken_course_codes()
    retake_eligibility = taken_course_service.get_retake_eligibility(cleaned_term)
    needed_categories = _category_needs()

    recommendations: list[dict] = []
    for course in courses:
        code = taken_course_service._normalize_course_code(course.get("code", ""))
        if not code:
            continue

        retake_status = retake_eligibility.get(code)
        already_taken = code in taken_codes
        if already_taken and not (retake_status and retake_status.get("can_retake")):
            continue

        selected_codes = set(taken_codes)
        if already_taken:
            selected_codes.discard(code)
        missing_prereqs = [
            prereq
            for prereq in course.get("prerequisites", [])
            if taken_course_service._normalize_course_code(prereq) not in selected_codes
        ]
        if missing_prereqs:
            continue

        score = 0
        reasons: list[str] = []
        categories = course.get("requirement_categories", [])
        matched_categories = [cat for cat in categories if cat in needed_categories]
        if matched_categories:
            score += 30 + len(matched_categories) * 4
            reasons.append(f"Counts toward {', '.join(matched_categories)}.")
        elif categories:
            score += 6
            reasons.append(f"Matches {', '.join(categories)}.")

        if _has_schedulable_section(course):
            score += 10
            reasons.append("Available in the selected planning term.")

        if course.get("prerequisites"):
            score += 4
            reasons.append("No missing prerequisites.")

        if already_taken:
            score -= 10
            reasons.append("Retake is still within the allowed window.")

        feedback = feedback_map.get(code)
        feedback_delta, feedback_reasons = _feedback_score(feedback)
        score += feedback_delta
        reasons.extend(feedback_reasons)

        recommendations.append(
            {
                "course_code": course.get("code"),
                "course_name": course.get("name"),
                "su_credits": course.get("su_credits"),
                "ects_credits": course.get("ects_credits"),
                "requirement_categories": categories,
                "feedback": feedback,
                "score": score,
                "reasons": reasons[:5],
            }
        )

    recommendations.sort(
        key=lambda item: (-item["score"], str(item["course_code"] or "")),
    )
    return {
        "term": cleaned_term,
        "needed_categories": sorted(needed_categories),
        "recommendations": recommendations[:safe_limit],
    }
