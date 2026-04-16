import json
import sqlite3
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote, unquote

from app.services.gpa_service import (
    MAX_SEMESTER_SU_CREDITS,
    grade_to_points,
    normalize_letter_grade,
)
from app.utils.loader import load_courses

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "taken_courses.db"
REQUIREMENTS_PATH = DATA_DIR / "cs_bscs_requirements_v1.json"
MAX_OVERLOAD_COURSES_PER_SEMESTER = 2


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_taken_courses_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS taken_courses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                course_code TEXT NOT NULL,
                grade TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS semesters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS semester_courses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                semester_id INTEGER NOT NULL,
                course_code TEXT NOT NULL,
                grade TEXT,
                is_overload INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (semester_id, course_code),
                FOREIGN KEY (semester_id)
                    REFERENCES semesters (id)
                    ON DELETE CASCADE
            )
            """
        )
        columns = {
            row[1]
            for row in conn.execute("PRAGMA table_info(semester_courses)").fetchall()
        }
        if "is_overload" not in columns:
            conn.execute(
                "ALTER TABLE semester_courses ADD COLUMN is_overload INTEGER NOT NULL DEFAULT 0"
            )


def add_taken_course(course_code: str, grade: str) -> None:
    init_taken_courses_db()
    with _connect() as conn:
        conn.execute(
            "INSERT INTO taken_courses (course_code, grade) VALUES (?, ?)",
            (course_code, grade),
        )


def get_taken_courses() -> list[dict]:
    init_taken_courses_db()
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT id, course_code, grade
            FROM taken_courses
            ORDER BY id DESC
            """
        ).fetchall()

    return [dict(row) for row in rows]


def _normalize_course_code(course_code: str) -> str:
    normalized = " ".join(course_code.upper().split())
    alias_map = {
        "CS 210": "DSA 210 / CS 210",
        "DSA 210": "DSA 210 / CS 210",
    }
    return alias_map.get(normalized, normalized)


def _course_catalog() -> dict[str, dict]:
    return {
        _normalize_course_code(course["Course"]): course
        for course in load_courses()
        if course.get("Course")
    }


def _course_su_credits(course_code: str, courses_by_code: dict[str, dict]) -> float:
    normalized_course_code = _normalize_course_code(course_code)
    course = courses_by_code.get(normalized_course_code)
    if course is None:
        raise LookupError(f"Course not found: {normalized_course_code}")

    su_credits = course.get("SU Credits")
    if su_credits is None:
        raise ValueError(f"Course has no SU credits: {normalized_course_code}")

    return float(su_credits)


def _course_ects_credits(
    course_code: str,
    courses_by_code: dict[str, dict],
) -> float | None:
    normalized_course_code = _normalize_course_code(course_code)
    course = courses_by_code.get(normalized_course_code)
    if course is None:
        raise LookupError(f"Course not found: {normalized_course_code}")

    ects_credits = course.get("ECTS Credits")
    if ects_credits is None:
        return None
    return float(ects_credits)


@lru_cache(maxsize=1)
def _prerequisites_by_course() -> dict[str, set[str]]:
    if not REQUIREMENTS_PATH.exists():
        return {}

    with REQUIREMENTS_PATH.open("r", encoding="utf-8") as file:
        requirements = json.load(file)

    courses = requirements.get("prerequisites", {}).get("courses", [])
    if not isinstance(courses, list):
        return {}

    mapping: dict[str, set[str]] = {}
    for item in courses:
        if not isinstance(item, dict):
            continue
        course_code = _normalize_course_code(item.get("code", ""))
        if not course_code:
            continue
        prerequisites = item.get("prerequisites", [])
        if not isinstance(prerequisites, list):
            prerequisites = []
        mapping[course_code] = {
            _normalize_course_code(prereq)
            for prereq in prerequisites
            if str(prereq).strip()
        }

    return mapping


@lru_cache(maxsize=1)
def _program_required_totals() -> tuple[float | None, float | None]:
    if not REQUIREMENTS_PATH.exists():
        return None, None
    try:
        with REQUIREMENTS_PATH.open("r", encoding="utf-8") as file:
            requirements = json.load(file)
        totals = requirements.get("requirement_summary", {}).get("total", {})
        min_su = totals.get("min_su")
        min_ects = totals.get("min_ects")
        return (
            float(min_su) if min_su is not None else None,
            float(min_ects) if min_ects is not None else None,
        )
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return None, None


@lru_cache(maxsize=1)
def _requirements_data() -> dict:
    if not REQUIREMENTS_PATH.exists():
        return {}
    try:
        with REQUIREMENTS_PATH.open("r", encoding="utf-8") as file:
            return json.load(file)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return {}


def _extract_course_codes_from_category_definition(category_data: object) -> set[str]:
    codes: set[str] = set()

    def collect(value: object) -> None:
        if isinstance(value, dict):
            course_code = value.get("course")
            if course_code:
                codes.add(_normalize_course_code(course_code))
            for nested in value.values():
                collect(nested)
        elif isinstance(value, list):
            for item in value:
                collect(item)

    collect(category_data)
    return codes


def _safe_progress_percent(completed: float, required: float) -> float | None:
    if required <= 0:
        return None
    return round(min(100.0, (completed / required) * 100.0), 1)


def _previous_semester_course_codes(
    conn: sqlite3.Connection,
    semester_id: int,
) -> set[str]:
    semester_rows = conn.execute(
        """
        SELECT id
        FROM semesters
        ORDER BY id ASC
        """
    ).fetchall()
    ordered_semester_ids = [row["id"] for row in semester_rows]
    if semester_id not in ordered_semester_ids:
        raise LookupError(f"Semester not found: {semester_id}")

    target_index = ordered_semester_ids.index(semester_id)
    previous_ids = ordered_semester_ids[:target_index]
    if not previous_ids:
        return set()

    placeholders = ",".join("?" for _ in previous_ids)
    rows = conn.execute(
        f"""
        SELECT DISTINCT course_code
        FROM semester_courses
        WHERE semester_id IN ({placeholders})
        """,
        previous_ids,
    ).fetchall()
    return {_normalize_course_code(row["course_code"]) for row in rows}


def _previous_semester_total_su_credits(
    conn: sqlite3.Connection,
    semester_id: int,
    courses_by_code: dict[str, dict],
) -> float:
    semester_rows = conn.execute(
        """
        SELECT id
        FROM semesters
        ORDER BY id ASC
        """
    ).fetchall()
    ordered_semester_ids = [row["id"] for row in semester_rows]
    if semester_id not in ordered_semester_ids:
        raise LookupError(f"Semester not found: {semester_id}")

    target_index = ordered_semester_ids.index(semester_id)
    previous_ids = ordered_semester_ids[:target_index]
    if not previous_ids:
        return 0.0

    placeholders = ",".join("?" for _ in previous_ids)
    rows = conn.execute(
        f"""
        SELECT course_code
        FROM semester_courses
        WHERE semester_id IN ({placeholders})
        """,
        previous_ids,
    ).fetchall()
    return sum(
        _course_su_credits(row["course_code"], courses_by_code)
        for row in rows
    )


def _semester_has_course(
    conn: sqlite3.Connection,
    semester_id: int,
    course_code: str,
) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM semester_courses
        WHERE semester_id = ? AND course_code = ?
        LIMIT 1
        """,
        (semester_id, course_code),
    ).fetchone()
    return row is not None


def _find_semester_id_for_course(
    conn: sqlite3.Connection,
    course_code: str,
) -> int | None:
    row = conn.execute(
        """
        SELECT semester_id
        FROM semester_courses
        WHERE course_code = ?
        ORDER BY semester_id ASC
        LIMIT 1
        """,
        (course_code,),
    ).fetchone()
    return row["semester_id"] if row else None


def _ensure_graduation_project_rules(
    conn: sqlite3.Connection,
    semester_id: int,
    course_code: str,
    courses_by_code: dict[str, dict],
) -> None:
    if course_code not in {"ENS 491", "ENS 492"}:
        return

    semester_rows = conn.execute(
        """
        SELECT id
        FROM semesters
        ORDER BY id ASC
        """
    ).fetchall()
    ordered_semester_ids = [row["id"] for row in semester_rows]
    target_index = ordered_semester_ids.index(semester_id)

    if course_code == "ENS 491":
        completed_su_before = _previous_semester_total_su_credits(
            conn,
            semester_id,
            courses_by_code,
        )
        if completed_su_before < 80:
            raise ValueError(
                "ENS 491 cannot be added before completing at least 80 SU "
                "credits in previous semesters."
            )

        ens492_semester_id = _find_semester_id_for_course(conn, "ENS 492")
        if ens492_semester_id is not None:
            ens492_index = ordered_semester_ids.index(ens492_semester_id)
            if ens492_index != target_index + 1:
                raise ValueError(
                    "ENS 491 and ENS 492 must be taken in consecutive semesters."
                )

    if course_code == "ENS 492":
        if target_index == 0:
            raise ValueError(
                "ENS 492 cannot be added to the first semester. ENS 491 and ENS 492 "
                "must be taken in consecutive semesters."
            )

        previous_semester_id = ordered_semester_ids[target_index - 1]
        if not _semester_has_course(conn, previous_semester_id, "ENS 491"):
            raise ValueError(
                "ENS 492 can only be added if ENS 491 is taken in the immediately "
                "previous semester."
            )

def _ensure_prerequisites_met(
    conn: sqlite3.Connection,
    semester_id: int,
    course_code: str,
    prerequisites_by_course: dict[str, set[str]],
) -> None:
    required_prerequisites = prerequisites_by_course.get(course_code, set())
    if not required_prerequisites:
        return

    completed_before_semester = _previous_semester_course_codes(conn, semester_id)
    missing = sorted(required_prerequisites - completed_before_semester)
    if missing:
        raise ValueError(
            f"{course_code} cannot be added before completing prerequisites: "
            f"{', '.join(missing)}."
        )


def _eligible_course_codes_for_semester(
    conn: sqlite3.Connection,
    semester_id: int,
    all_course_codes: list[str],
    prerequisites_by_course: dict[str, set[str]],
    courses_by_code: dict[str, dict],
) -> list[str]:
    completed_before_semester = _previous_semester_course_codes(conn, semester_id)
    eligible = []
    for course_code in all_course_codes:
        required_prerequisites = prerequisites_by_course.get(course_code, set())
        if not required_prerequisites.issubset(completed_before_semester):
            continue
        try:
            _ensure_graduation_project_rules(
                conn,
                semester_id,
                course_code,
                courses_by_code,
            )
        except ValueError:
            continue
        eligible.append(course_code)
    return eligible


def _ensure_semester_exists(conn: sqlite3.Connection, semester_id: int) -> None:
    row = conn.execute(
        "SELECT id FROM semesters WHERE id = ?",
        (semester_id,),
    ).fetchone()
    if row is None:
        raise LookupError(f"Semester not found: {semester_id}")


def _get_semester_course_row(conn: sqlite3.Connection, course_id: int) -> sqlite3.Row:
    row = conn.execute(
        """
        SELECT id, semester_id, course_code, grade
        FROM semester_courses
        WHERE id = ?
        """,
        (course_id,),
    ).fetchone()
    if row is None:
        raise LookupError(f"Course not found: {course_id}")

    return row


def _semester_credit_total(
    conn: sqlite3.Connection,
    semester_id: int,
    courses_by_code: dict[str, dict],
) -> float:
    rows = conn.execute(
        "SELECT course_code FROM semester_courses WHERE semester_id = ?",
        (semester_id,),
    ).fetchall()
    return sum(
        _course_su_credits(row["course_code"], courses_by_code)
        for row in rows
    )


def _semester_overload_course_count(
    conn: sqlite3.Connection,
    semester_id: int,
) -> int:
    row = conn.execute(
        """
        SELECT COUNT(*) AS count
        FROM semester_courses
        WHERE semester_id = ? AND is_overload = 1
        """,
        (semester_id,),
    ).fetchone()
    return int(row["count"]) if row else 0


def _weighted_gpa(rows: list[dict], courses_by_code: dict[str, dict]) -> float:
    total_credits = 0.0
    total_grade_points = 0.0

    for row in rows:
        grade_points = grade_to_points(row["grade"])
        if grade_points is None:
            continue

        credits = _course_su_credits(row["course_code"], courses_by_code)
        total_credits += credits
        total_grade_points += credits * grade_points

    if total_credits == 0:
        return 0.0

    return round(total_grade_points / total_credits, 3)


def _latest_attempts_by_course(rows: list[dict]) -> dict[str, dict]:
    latest_by_course: dict[str, dict] = {}
    for row in rows:
        course_code = _normalize_course_code(row["course_code"])
        current = latest_by_course.get(course_code)
        if current is None:
            latest_by_course[course_code] = row
            continue

        current_key = (current["semester_id"], current["id"])
        candidate_key = (row["semester_id"], row["id"])
        if candidate_key > current_key:
            latest_by_course[course_code] = row

    return latest_by_course


def _build_semesters_summary(conn: sqlite3.Connection) -> dict:
    courses_by_code = _course_catalog()
    all_course_codes = sorted(courses_by_code.keys())
    prerequisites_by_course = _prerequisites_by_course()
    semester_rows = conn.execute(
        """
        SELECT id, name
        FROM semesters
        ORDER BY id ASC
        """
    ).fetchall()
    course_rows = conn.execute(
        """
        SELECT id, semester_id, course_code, grade, is_overload
        FROM semester_courses
        ORDER BY semester_id ASC, id ASC
        """
    ).fetchall()

    courses_by_semester_id: dict[int, list[dict]] = {}
    for row in course_rows:
        courses_by_semester_id.setdefault(row["semester_id"], []).append(dict(row))

    semesters = []

    for semester in semester_rows:
        semester_courses = courses_by_semester_id.get(semester["id"], [])
        total_su_credits = 0.0
        course_records = []

        for course_row in semester_courses:
            course_code = _normalize_course_code(course_row["course_code"])
            course = courses_by_code.get(course_code, {})
            su_credits = _course_su_credits(course_code, courses_by_code)
            ects_credits = _course_ects_credits(course_code, courses_by_code)
            total_su_credits += su_credits
            grade_points = grade_to_points(course_row["grade"])

            course_records.append(
                {
                    "id": course_row["id"],
                    "semester_id": course_row["semester_id"],
                    "course_code": course_code,
                    "course_name": course.get("Name"),
                    "su_credits": su_credits,
                    "ects_credits": ects_credits,
                    "grade": course_row["grade"],
                    "grade_points": grade_points,
                    "is_overload": bool(course_row["is_overload"]),
                }
            )

        semester_gpa = _weighted_gpa(semester_courses, courses_by_code)
        eligible_course_codes = _eligible_course_codes_for_semester(
            conn,
            semester["id"],
            all_course_codes,
            prerequisites_by_course,
            courses_by_code,
        )
        semesters.append(
            {
                "id": semester["id"],
                "name": semester["name"],
                "total_su_credits": round(total_su_credits, 2),
                "gpa": semester_gpa,
                "courses": course_records,
                "eligible_course_codes": eligible_course_codes,
                "overload_course_count": _semester_overload_course_count(conn, semester["id"]),
            }
        )

    latest_attempts = _latest_attempts_by_course(course_rows)
    latest_attempt_rows = list(latest_attempts.values())
    latest_graded_attempt_rows = [
        row
        for row in latest_attempt_rows
        if grade_to_points(row["grade"]) is not None
    ]
    cumulative_gpa = _weighted_gpa(latest_graded_attempt_rows, courses_by_code)

    total_planned_su_credits = 0.0
    total_planned_ects_credits = 0.0
    for row in latest_attempt_rows:
        total_planned_su_credits += _course_su_credits(row["course_code"], courses_by_code)
        ects_credits = _course_ects_credits(row["course_code"], courses_by_code)
        if ects_credits is not None:
            total_planned_ects_credits += ects_credits

    program_required_su_credits, program_required_ects_credits = _program_required_totals()
    return {
        "semesters": semesters,
        "cumulative_gpa": cumulative_gpa,
        "max_semester_su_credits": MAX_SEMESTER_SU_CREDITS,
        "total_planned_su_credits": round(total_planned_su_credits, 2),
        "total_planned_ects_credits": round(total_planned_ects_credits, 2),
        "program_required_su_credits": program_required_su_credits,
        "program_required_ects_credits": program_required_ects_credits,
        "semester_gpa": {
            semester["id"]: semester["gpa"]
            for semester in semesters
        },
        "cgpa": cumulative_gpa,
    }


def get_semesters_summary() -> dict:
    init_taken_courses_db()
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        return _build_semesters_summary(conn)


def get_graduation_requirements_progress() -> dict:
    init_taken_courses_db()
    requirements = _requirements_data()
    category_requirements = requirements.get("requirement_summary", {}).get("categories", [])
    category_definitions = requirements.get("categories", {})
    if not isinstance(category_requirements, list):
        category_requirements = []
    if not isinstance(category_definitions, dict):
        category_definitions = {}

    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        course_rows = conn.execute(
            """
            SELECT id, semester_id, course_code, grade
            FROM semester_courses
            ORDER BY semester_id ASC, id ASC
            """
        ).fetchall()

    latest_attempts = _latest_attempts_by_course(course_rows)
    latest_attempt_rows = list(latest_attempts.values())
    courses_by_code = _course_catalog()
    latest_attempt_codes = {
        _normalize_course_code(row["course_code"])
        for row in latest_attempt_rows
    }

    university_codes = _extract_course_codes_from_category_definition(
        category_definitions.get("University Courses", {})
    )
    required_codes = _extract_course_codes_from_category_definition(
        category_definitions.get("Required Courses", [])
    )
    core_codes = _extract_course_codes_from_category_definition(
        category_definitions.get("Core Electives", [])
    )
    area_codes = _extract_course_codes_from_category_definition(
        category_definitions.get("Area Electives", [])
    )

    explicit_codes = university_codes | required_codes | core_codes | area_codes
    free_codes: set[str] = set()
    for course_code in latest_attempt_codes:
        if course_code in explicit_codes:
            continue
        course = courses_by_code.get(course_code)
        if not course:
            continue
        faculty = (course.get("Faculty") or "").upper()
        if faculty in {"FASS", "SBS", "FENS"}:
            free_codes.add(course_code)

    category_code_sets = {
        "University Courses": university_codes,
        "Required Courses": required_codes,
        "Core Electives": core_codes,
        "Area Electives": area_codes,
        "Free Electives": free_codes,
    }

    def compute_metrics(course_codes: set[str]) -> tuple[float, float, int]:
        completed_su = 0.0
        completed_ects = 0.0
        completed_courses = 0
        for course_code in course_codes:
            if course_code not in latest_attempt_codes:
                continue
            completed_courses += 1
            completed_su += _course_su_credits(course_code, courses_by_code)
            ects = _course_ects_credits(course_code, courses_by_code)
            if ects is not None:
                completed_ects += ects
        return round(completed_su, 2), round(completed_ects, 2), completed_courses

    category_progress = []
    for item in category_requirements:
        if not isinstance(item, dict):
            continue
        category_name = item.get("category")
        if not category_name:
            continue

        required_su = item.get("min_su")
        required_ects = item.get("min_ects")
        required_courses = item.get("min_courses")
        course_codes = category_code_sets.get(category_name, set())
        completed_su, completed_ects, completed_courses = compute_metrics(course_codes)

        remaining_su = (
            round(max(0.0, float(required_su) - completed_su), 2)
            if required_su is not None
            else None
        )
        remaining_ects = (
            round(max(0.0, float(required_ects) - completed_ects), 2)
            if required_ects is not None
            else None
        )
        remaining_courses = (
            max(0, int(required_courses) - completed_courses)
            if required_courses is not None
            else None
        )

        progress_candidates = []
        if required_su is not None:
            value = _safe_progress_percent(completed_su, float(required_su))
            if value is not None:
                progress_candidates.append(value)
        if required_ects is not None:
            value = _safe_progress_percent(completed_ects, float(required_ects))
            if value is not None:
                progress_candidates.append(value)
        if required_courses is not None and int(required_courses) > 0:
            progress_candidates.append(
                round(min(100.0, (completed_courses / int(required_courses)) * 100.0), 1)
            )
        progress_percent = min(progress_candidates) if progress_candidates else None

        category_progress.append(
            {
                "category": category_name,
                "required_su": float(required_su) if required_su is not None else None,
                "required_ects": float(required_ects) if required_ects is not None else None,
                "required_courses": int(required_courses) if required_courses is not None else None,
                "completed_su": completed_su,
                "completed_ects": completed_ects,
                "completed_courses": completed_courses,
                "remaining_su": remaining_su,
                "remaining_ects": remaining_ects,
                "remaining_courses": remaining_courses,
                "progress_percent": progress_percent,
            }
        )

    return {"categories": category_progress}


def create_semester(name: str) -> dict:
    semester_name = name.strip()
    if not semester_name:
        raise ValueError("Semester name cannot be empty")

    init_taken_courses_db()
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        conn.execute(
            "INSERT INTO semesters (name) VALUES (?)",
            (semester_name,),
        )
        return _build_semesters_summary(conn)


def delete_semester(semester_id: int) -> None:
    init_taken_courses_db()
    with _connect() as conn:
        _ensure_semester_exists(conn, semester_id)
        conn.execute("DELETE FROM semesters WHERE id = ?", (semester_id,))


def add_course_to_semester(
    semester_id: int,
    course_code: str,
    grade: str | None = None,
) -> dict:
    normalized_course_code = _normalize_course_code(course_code)
    if not normalized_course_code:
        raise ValueError("Course code cannot be empty")

    normalized_grade = normalize_letter_grade(grade)

    init_taken_courses_db()
    courses_by_code = _course_catalog()
    prerequisites_by_course = _prerequisites_by_course()
    new_course_credits = _course_su_credits(normalized_course_code, courses_by_code)

    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        _ensure_semester_exists(conn, semester_id)
        _ensure_prerequisites_met(
            conn,
            semester_id,
            normalized_course_code,
            prerequisites_by_course,
        )
        _ensure_graduation_project_rules(
            conn,
            semester_id,
            normalized_course_code,
            courses_by_code,
        )

        existing_row = conn.execute(
            """
            SELECT id
            FROM semester_courses
            WHERE semester_id = ? AND course_code = ?
            """,
            (semester_id, normalized_course_code),
        ).fetchone()
        if existing_row is not None:
            raise ValueError(
                f"{normalized_course_code} already exists in semester {semester_id}"
            )

        semester_credits = _semester_credit_total(conn, semester_id, courses_by_code)
        next_semester_credits = semester_credits + new_course_credits
        is_overload_course = next_semester_credits > MAX_SEMESTER_SU_CREDITS
        if is_overload_course:
            overload_count = _semester_overload_course_count(conn, semester_id)
            if overload_count >= MAX_OVERLOAD_COURSES_PER_SEMESTER:
                raise ValueError(
                    f"{normalized_course_code} cannot be added. Semester SU credits would "
                    f"be {next_semester_credits}, exceeding the limit of "
                    f"{MAX_SEMESTER_SU_CREDITS}. You must submit an overload request "
                    f"(maximum {MAX_OVERLOAD_COURSES_PER_SEMESTER} overload courses)."
                )

        conn.execute(
            """
            INSERT INTO semester_courses (semester_id, course_code, grade, is_overload)
            VALUES (?, ?, ?, ?)
            """,
            (
                semester_id,
                normalized_course_code,
                normalized_grade,
                1 if is_overload_course else 0,
            ),
        )
        return _build_semesters_summary(conn)


def update_semester_course_grade(
    semester_id: int,
    course_code: str,
    grade: str | None,
) -> dict:
    normalized_course_code = _normalize_course_code(course_code)
    normalized_grade = normalize_letter_grade(grade)

    init_taken_courses_db()
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        _ensure_semester_exists(conn, semester_id)

        result = conn.execute(
            """
            UPDATE semester_courses
            SET grade = ?
            WHERE semester_id = ? AND course_code = ?
            """,
            (normalized_grade, semester_id, normalized_course_code),
        )
        if result.rowcount == 0:
            raise LookupError(
                f"Course not found in semester {semester_id}: {normalized_course_code}"
            )

        return _build_semesters_summary(conn)


def update_course_record(course_id: int, grade: str | None) -> dict:
    normalized_grade = normalize_letter_grade(grade)

    init_taken_courses_db()
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        _get_semester_course_row(conn, course_id)

        conn.execute(
            """
            UPDATE semester_courses
            SET grade = ?
            WHERE id = ?
            """,
            (normalized_grade, course_id),
        )

        return _build_semesters_summary(conn)


def delete_course_record(course_id: int) -> dict:
    init_taken_courses_db()
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        _get_semester_course_row(conn, course_id)

        conn.execute(
            "DELETE FROM semester_courses WHERE id = ?",
            (course_id,),
        )

        return _build_semesters_summary(conn)


def delete_course_from_semester(semester_id: int, course_code: str) -> dict:
    normalized_course_code = _normalize_course_code(course_code)

    init_taken_courses_db()
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        _ensure_semester_exists(conn, semester_id)

        result = conn.execute(
            """
            DELETE FROM semester_courses
            WHERE semester_id = ? AND course_code = ?
            """,
            (semester_id, normalized_course_code),
        )
        if result.rowcount == 0:
            raise LookupError(
                f"Course not found in semester {semester_id}: {normalized_course_code}"
            )

        return _build_semesters_summary(conn)


def reset_tracking_data() -> None:
    init_taken_courses_db()
    with _connect() as conn:
        conn.execute("DELETE FROM semester_courses")
        conn.execute("DELETE FROM semesters")
        conn.execute("DELETE FROM taken_courses")


def parse_taken_courses_cookie(raw_cookie_value: str | None) -> dict[str, str]:
    if not raw_cookie_value:
        return {}

    try:
        decoded = unquote(raw_cookie_value)
        parsed = json.loads(decoded)
        if isinstance(parsed, str):
            parsed = json.loads(parsed)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def build_taken_courses_cookie(
    raw_cookie_value: str | None,
    course_code: str,
    grade: str,
) -> str:
    courses_dict = parse_taken_courses_cookie(raw_cookie_value)
    courses_dict[course_code] = grade
    return quote(json.dumps(courses_dict))
