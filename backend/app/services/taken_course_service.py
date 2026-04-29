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
FACULTY_COURSES_PATH = DATA_DIR / "faculty_courses_SU.json"
MAX_OVERLOAD_COURSES_PER_SEMESTER = 2
PROJ_201_CODE = "PROJ 201"
_MIN_GRADUATION_GPA = 2.0
_CATEGORIES_WITH_REMAINING = frozenset({"Core Electives", "Area Electives"})
_BANNERWEB_PRIMARY_SECTION_CATEGORIES = {
    "UNIVERSITY COURSES": "University Courses",
    "REQUIRED COURSES": "Required Courses",
    "CORE ELECTIVES": "Core Electives",
    "AREA ELECTIVES": "Area Electives",
    "FREE ELECTIVES": "Free Electives",
}


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
        if "engineering_ects" not in columns:
            conn.execute(
                "ALTER TABLE semester_courses ADD COLUMN engineering_ects REAL NOT NULL DEFAULT 0"
            )
        if "basic_science_ects" not in columns:
            conn.execute(
                "ALTER TABLE semester_courses ADD COLUMN basic_science_ects REAL NOT NULL DEFAULT 0"
            )
        if "bannerweb_category" not in columns:
            conn.execute(
                "ALTER TABLE semester_courses ADD COLUMN bannerweb_category TEXT"
            )
        if "bannerweb_su_credits" not in columns:
            conn.execute(
                "ALTER TABLE semester_courses ADD COLUMN bannerweb_su_credits REAL"
            )
        if "bannerweb_ects_credits" not in columns:
            conn.execute(
                "ALTER TABLE semester_courses ADD COLUMN bannerweb_ects_credits REAL"
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


def _regular_term_index(term: str) -> int | None:
    term = str(term or "").strip()
    if len(term) != 6 or not term.isdigit():
        return None
    year = int(term[:4])
    suffix = term[4:]
    if suffix == "01":
        return year * 2
    if suffix == "02":
        return year * 2 + 1
    return None


def _regular_term_distance(from_term: str, to_term: str) -> int | None:
    from_index = _regular_term_index(from_term)
    to_index = _regular_term_index(to_term)
    if from_index is None or to_index is None:
        return None
    return to_index - from_index


def _course_catalog() -> dict[str, dict]:
    catalog: dict[str, dict] = {}
    for course in load_courses():
        if not course.get("Course"):
            continue
        raw_code = " ".join(str(course["Course"]).upper().split())
        catalog[raw_code] = course
        catalog[_normalize_course_code(raw_code)] = course
    return catalog


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


def _row_su_credits(row: dict, courses_by_code: dict[str, dict]) -> float:
    if "bannerweb_su_credits" in row.keys() and row["bannerweb_su_credits"] is not None:
        return float(row["bannerweb_su_credits"])
    return _course_su_credits(row["course_code"], courses_by_code)


def _row_ects_credits(row: dict, courses_by_code: dict[str, dict]) -> float | None:
    if "bannerweb_ects_credits" in row.keys() and row["bannerweb_ects_credits"] is not None:
        return float(row["bannerweb_ects_credits"])
    return _course_ects_credits(row["course_code"], courses_by_code)


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


@lru_cache(maxsize=1)
def _faculty_courses_data() -> list[dict]:
    if not FACULTY_COURSES_PATH.exists():
        return []
    try:
        with FACULTY_COURSES_PATH.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return []

    courses = payload.get("courses", [])
    return courses if isinstance(courses, list) else []


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


def _min_su_by_category(category_requirements: list[dict]) -> dict[str, float]:
    minimums: dict[str, float] = {}
    for item in category_requirements:
        if not isinstance(item, dict):
            continue
        category_name = item.get("category")
        min_su = item.get("min_su")
        if not category_name or min_su is None:
            continue
        try:
            minimums[category_name] = float(min_su)
        except (TypeError, ValueError):
            continue
    return minimums


def _is_free_elective_eligible(course_code: str, courses_by_code: dict[str, dict]) -> bool:
    course = courses_by_code.get(_normalize_course_code(course_code))
    if not course:
        return False
    faculty = (course.get("Faculty") or "").upper()
    return faculty in {"FASS", "SBS", "FENS"}


def _build_category_code_sets(
    latest_attempt_rows: list[sqlite3.Row],
    category_requirements: list[dict],
    category_definitions: dict,
    courses_by_code: dict[str, dict],
) -> dict[str, set[str]]:
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
    faculty_codes = {
        _normalize_course_code(item.get("code", ""))
        for item in _faculty_courses_data()
        if isinstance(item, dict) and item.get("code")
    }

    minimum_su = _min_su_by_category(category_requirements)
    ordered_latest_codes = [
        _normalize_course_code(row["course_code"])
        for row in latest_attempt_rows
    ]
    latest_rows_by_code = {
        _normalize_course_code(row["course_code"]): row
        for row in latest_attempt_rows
    }
    bannerweb_allocated = {
        category: set()
        for category in _BANNERWEB_PRIMARY_SECTION_CATEGORIES.values()
    }
    for row in latest_attempt_rows:
        category = (
            str(row["bannerweb_category"] or "").strip()
            if "bannerweb_category" in row.keys()
            else ""
        )
        if category in bannerweb_allocated:
            bannerweb_allocated[category].add(_normalize_course_code(row["course_code"]))

    bannerweb_assigned_codes = set().union(*bannerweb_allocated.values())
    fixed_codes = university_codes | required_codes
    assigned_codes = set(bannerweb_assigned_codes)
    assigned_codes.update(
        code
        for code in ordered_latest_codes
        if code in fixed_codes and code not in bannerweb_assigned_codes
    )

    def allocate_until_satisfied(candidates: list[str], required_su: float | None) -> set[str]:
        allocated: set[str] = set()
        completed_su = 0.0
        for code in candidates:
            if code in assigned_codes:
                continue
            if required_su is not None and completed_su >= required_su:
                break
            allocated.add(code)
            assigned_codes.add(code)
            completed_su += _row_su_credits(latest_rows_by_code[code], courses_by_code)
        return allocated

    core_allocated = set(bannerweb_allocated["Core Electives"])
    core_allocated.update(allocate_until_satisfied(
        [code for code in ordered_latest_codes if code in core_codes and code not in fixed_codes],
        minimum_su.get("Core Electives"),
    ))
    area_allocated = set(bannerweb_allocated["Area Electives"])
    area_allocated.update(allocate_until_satisfied(
        [
            code
            for code in ordered_latest_codes
            if code in (area_codes | core_codes) and code not in fixed_codes
        ],
        minimum_su.get("Area Electives"),
    ))
    free_allocated = {
        code
        for code in ordered_latest_codes
        if code not in assigned_codes
        and code not in fixed_codes
        and _is_free_elective_eligible(code, courses_by_code)
    }
    free_allocated.update(bannerweb_allocated["Free Electives"])

    return {
        "University Courses": university_codes | bannerweb_allocated["University Courses"],
        "Required Courses": required_codes | bannerweb_allocated["Required Courses"],
        "Core Electives": core_allocated,
        "Area Electives": area_allocated,
        "Free Electives": free_allocated,
        "Faculty Courses": faculty_codes,
        "_Core Electives Eligible": core_codes,
        "_Area Electives Eligible": area_codes,
    }


def _safe_progress_percent(completed: float, required: float) -> float | None:
    if required <= 0:
        return None
    return round(min(100.0, (completed / required) * 100.0), 1)


def get_category_membership() -> dict[str, list[str]]:
    """Return { course_code: [category, ...] } for all courses listed in
    the requirements JSON. Used by the planner to surface which graduation
    categories a candidate course satisfies. A course may appear in
    multiple categories (e.g. CS 201 in both Required Courses and Faculty
    Courses)."""
    requirements = _requirements_data()
    category_definitions = requirements.get("categories", {})
    if not isinstance(category_definitions, dict):
        category_definitions = {}

    membership: dict[str, list[str]] = {}

    def add(code: str, category: str) -> None:
        if not code:
            return
        bucket = membership.setdefault(code, [])
        if category not in bucket:
            bucket.append(category)

    for category_name in (
        "University Courses",
        "Required Courses",
        "Core Electives",
        "Area Electives",
    ):
        for code in _extract_course_codes_from_category_definition(
            category_definitions.get(category_name, [])
        ):
            add(code, category_name)

    for item in _faculty_courses_data():
        if isinstance(item, dict):
            add(_normalize_course_code(item.get("code", "")), "Faculty Courses")

    return membership


def get_taken_course_codes() -> set[str]:
    """Return normalized codes the user has on file (any semester, any grade).
    Used by the planner to flag prerequisite satisfaction."""
    init_taken_courses_db()
    with _connect() as conn:
        rows = conn.execute("SELECT DISTINCT course_code FROM semester_courses").fetchall()
    return {_normalize_course_code(row[0]) for row in rows}


def get_retake_eligibility(target_term: str) -> dict[str, dict]:
    """Return retake eligibility for courses already present in regular terms.

    A course can be retaken for at most three regular semesters after the
    latest regular-term attempt. Summer terms (`YYYY03`) are ignored.
    """
    init_taken_courses_db()
    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT sc.course_code, s.name AS semester_name
            FROM semester_courses sc
            JOIN semesters s ON s.id = sc.semester_id
            ORDER BY s.id ASC, sc.id ASC
            """
        ).fetchall()

    latest_by_course: dict[str, tuple[str, int]] = {}
    for row in rows:
        term = str(row["semester_name"] or "").strip()
        term_index = _regular_term_index(term)
        if term_index is None:
            continue
        course_code = _normalize_course_code(row["course_code"])
        current = latest_by_course.get(course_code)
        if current is None or term_index > current[1]:
            latest_by_course[course_code] = (term, term_index)

    out: dict[str, dict] = {}
    for course_code, (last_term, _) in latest_by_course.items():
        distance = _regular_term_distance(last_term, target_term)
        can_retake = distance is None or 0 <= distance <= 3
        out[course_code] = {
            "course_code": course_code,
            "last_taken_term": last_term,
            "target_term": str(target_term).strip(),
            "regular_terms_since_last_taken": distance,
            "can_retake": can_retake,
            "reason": None
            if can_retake
            else (
                f"{course_code} was last taken in {last_term}; retakes are only allowed "
                "within three regular semesters."
            ),
        }
    return out


def can_retake_course(course_code: str, target_term: str) -> tuple[bool, str | None]:
    status = get_retake_eligibility(target_term).get(_normalize_course_code(course_code))
    if status is None:
        return True, None
    if status["can_retake"]:
        return True, None
    return False, status["reason"]


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
        SELECT course_code, bannerweb_su_credits
        FROM semester_courses
        WHERE semester_id IN ({placeholders})
        """,
        previous_ids,
    ).fetchall()
    return sum(
        _row_su_credits(row, courses_by_code)
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


def _ordered_semester_ids(conn: sqlite3.Connection) -> list[int]:
    rows = conn.execute(
        """
        SELECT id
        FROM semesters
        ORDER BY id ASC
        """
    ).fetchall()
    return [row["id"] for row in rows]


def _has_course_in_any_semester(
    conn: sqlite3.Connection,
    semester_ids: list[int],
    course_code: str,
) -> bool:
    if not semester_ids:
        return False
    placeholders = ",".join("?" for _ in semester_ids)
    row = conn.execute(
        f"""
        SELECT 1
        FROM semester_courses
        WHERE semester_id IN ({placeholders}) AND course_code = ?
        LIMIT 1
        """,
        [*semester_ids, course_code],
    ).fetchone()
    return row is not None


def _enforce_proj_201_by_semester_four(
    conn: sqlite3.Connection,
    courses_by_code: dict[str, dict],
) -> int | None:
    semester_ids = _ordered_semester_ids(conn)
    if len(semester_ids) < 4:
        return None

    first_three = semester_ids[:3]
    fourth_semester_id = semester_ids[3]
    normalized_proj = _normalize_course_code(PROJ_201_CODE)

    if _has_course_in_any_semester(conn, first_three, normalized_proj):
        return None
    if _semester_has_course(conn, fourth_semester_id, normalized_proj):
        return fourth_semester_id

    try:
        semester_credits = _semester_credit_total(conn, fourth_semester_id, courses_by_code)
        proj_credits = _course_su_credits(normalized_proj, courses_by_code)
    except (LookupError, ValueError):
        return None

    is_overload = 1 if semester_credits + proj_credits > MAX_SEMESTER_SU_CREDITS else 0
    conn.execute(
        """
        INSERT INTO semester_courses (semester_id, course_code, grade, is_overload)
        VALUES (?, ?, ?, ?)
        """,
        (fourth_semester_id, normalized_proj, None, is_overload),
    )
    return fourth_semester_id


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
        """
        SELECT course_code, bannerweb_su_credits
        FROM semester_courses
        WHERE semester_id = ?
        """,
        (semester_id,),
    ).fetchall()
    return sum(
        _row_su_credits(row, courses_by_code)
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

        credits = _row_su_credits(row, courses_by_code)
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
    proj_201_forced_semester_id = _enforce_proj_201_by_semester_four(conn, courses_by_code)
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
        SELECT id, semester_id, course_code, grade, is_overload,
               bannerweb_su_credits, bannerweb_ects_credits
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
            su_credits = _row_su_credits(course_row, courses_by_code)
            ects_credits = _row_ects_credits(course_row, courses_by_code)
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
                "notes": (
                    [
                        "PROJ 201 was automatically added because it was not taken in the first three semesters."
                    ]
                    if proj_201_forced_semester_id == semester["id"]
                    else []
                ),
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
        total_planned_su_credits += _row_su_credits(row, courses_by_code)
        ects_credits = _row_ects_credits(row, courses_by_code)
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
            SELECT id, semester_id, course_code, grade,
                   engineering_ects, basic_science_ects, bannerweb_category,
                   bannerweb_su_credits, bannerweb_ects_credits
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
    latest_rows_by_code = {
        _normalize_course_code(row["course_code"]): row
        for row in latest_attempt_rows
    }

    # Engineering and Basic Science are partial-credit attributions per course;
    # sum the per-row columns populated by the Bannerweb import.
    engineering_completed_ects = round(
        sum(float(row["engineering_ects"] or 0.0) for row in latest_attempt_rows),
        2,
    )
    basic_science_completed_ects = round(
        sum(float(row["basic_science_ects"] or 0.0) for row in latest_attempt_rows),
        2,
    )
    engineering_completed_courses = sum(
        1 for row in latest_attempt_rows if float(row["engineering_ects"] or 0.0) > 0
    )
    basic_science_completed_courses = sum(
        1 for row in latest_attempt_rows if float(row["basic_science_ects"] or 0.0) > 0
    )

    category_code_sets = _build_category_code_sets(
        latest_attempt_rows,
        category_requirements,
        category_definitions,
        courses_by_code,
    )

    attribution_metrics = {
        "Engineering": (
            0.0,
            engineering_completed_ects,
            engineering_completed_courses,
        ),
        "Basic Science": (
            0.0,
            basic_science_completed_ects,
            basic_science_completed_courses,
        ),
    }

    def compute_metrics(course_codes: set[str]) -> tuple[float, float, int]:
        completed_su = 0.0
        completed_ects = 0.0
        completed_courses = 0
        for course_code in course_codes:
            if course_code not in latest_attempt_codes:
                continue
            completed_courses += 1
            row = latest_rows_by_code[course_code]
            completed_su += _row_su_credits(row, courses_by_code)
            ects = _row_ects_credits(row, courses_by_code)
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
        if category_name in attribution_metrics:
            completed_su, completed_ects, completed_courses = attribution_metrics[category_name]
        else:
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


def get_requirements_course_catalog() -> dict:
    requirements = _requirements_data()
    categories = requirements.get("categories", {})
    if not isinstance(categories, dict):
        return {"categories": {}}

    def extract_courses(value: object) -> list[dict]:
        collected: list[dict] = []
        if isinstance(value, dict):
            if value.get("course"):
                collected.append(
                    {
                        "course": _normalize_course_code(value.get("course")),
                        "name": value.get("name"),
                    }
                )
            for nested in value.values():
                collected.extend(extract_courses(nested))
        elif isinstance(value, list):
            for item in value:
                collected.extend(extract_courses(item))
        return collected

    response: dict[str, list[dict]] = {}
    for category_name, category_value in categories.items():
        dedup: dict[str, dict] = {}
        for item in extract_courses(category_value):
            dedup[item["course"]] = item
        if category_name == "Faculty Courses":
            for item in _faculty_courses_data():
                if not isinstance(item, dict):
                    continue
                course_code = _normalize_course_code(item.get("code", ""))
                if not course_code:
                    continue
                dedup[course_code] = {
                    "course": course_code,
                    "name": item.get("name"),
                }
        response[category_name] = sorted(dedup.values(), key=lambda x: x["course"])

    return {"categories": response}


def get_progress_summary() -> dict:
    init_taken_courses_db()
    requirements = _requirements_data()
    category_requirements = requirements.get("requirement_summary", {}).get("categories", [])
    category_definitions = requirements.get("categories", {})

    if not isinstance(category_requirements, list):
        category_requirements = []
    if not isinstance(category_definitions, dict):
        category_definitions = {}

    courses_by_code = _course_catalog()

    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        course_rows = conn.execute(
            """
            SELECT id, semester_id, course_code, grade, bannerweb_category,
                   bannerweb_su_credits, bannerweb_ects_credits
            FROM semester_courses
            ORDER BY semester_id ASC, id ASC
            """
        ).fetchall()

    latest_attempts = _latest_attempts_by_course(course_rows)
    latest_attempt_rows = list(latest_attempts.values())
    latest_graded_rows = [
        row for row in latest_attempt_rows if grade_to_points(row["grade"]) is not None
    ]
    cgpa = _weighted_gpa(latest_graded_rows, courses_by_code)
    latest_attempt_codes = {
        _normalize_course_code(row["course_code"]) for row in latest_attempt_rows
    }
    latest_rows_by_code = {
        _normalize_course_code(row["course_code"]): row
        for row in latest_attempt_rows
    }

    category_code_sets = _build_category_code_sets(
        latest_attempt_rows,
        category_requirements,
        category_definitions,
        courses_by_code,
    )

    total_credits_completed = round(
        sum(_row_su_credits(row, courses_by_code) for row in latest_attempt_rows),
        2,
    )
    min_su_total, _ = _program_required_totals()

    progress_percents: list[float] = []
    category_items: list[dict] = []

    for item in category_requirements:
        if not isinstance(item, dict):
            continue
        category_name = item.get("category")
        if not category_name:
            continue

        required_su = item.get("min_su")
        required_ects = item.get("min_ects")
        required_courses_count = item.get("min_courses")
        course_codes = category_code_sets.get(category_name, set())

        completed_codes: list[str] = sorted(
            code for code in course_codes if code in latest_attempt_codes
        )
        completed_su = round(
            sum(_row_su_credits(latest_rows_by_code[code], courses_by_code) for code in completed_codes), 2
        )
        completed_ects = 0.0
        for code in completed_codes:
            ects = _row_ects_credits(latest_rows_by_code[code], courses_by_code)
            if ects is not None:
                completed_ects += ects
        completed_ects = round(completed_ects, 2)

        progress_candidates: list[float] = []
        if required_su is not None:
            v = _safe_progress_percent(completed_su, float(required_su))
            if v is not None:
                progress_candidates.append(v)
        if required_ects is not None:
            v = _safe_progress_percent(completed_ects, float(required_ects))
            if v is not None:
                progress_candidates.append(v)
        if required_courses_count is not None and int(required_courses_count) > 0:
            progress_candidates.append(
                round(min(100.0, (len(completed_codes) / int(required_courses_count)) * 100.0), 1)
            )
        progress_percent = min(progress_candidates) if progress_candidates else None

        if progress_percent is not None:
            progress_percents.append(progress_percent)

        if progress_percent is not None and progress_percent >= 100.0:
            status = "SATISFIED"
        elif completed_su > 0 or len(completed_codes) > 0:
            status = "IN_PROGRESS"
        else:
            status = "NOT_STARTED"

        remaining_codes: list[str] = (
            sorted(
                category_code_sets.get(f"_{category_name} Eligible", course_codes)
                - latest_attempt_codes
            )
            if category_name in _CATEGORIES_WITH_REMAINING
            else []
        )

        category_items.append({
            "id": category_name.lower().replace(" ", "_"),
            "name": category_name,
            "credits_completed": completed_su,
            "credits_required": float(required_su) if required_su is not None else None,
            "completion_pct": progress_percent,
            "status": status,
            "completed_courses": completed_codes,
            "remaining_courses": remaining_codes,
        })

    overall_completion_pct = (
        round(sum(progress_percents) / len(progress_percents), 1)
        if progress_percents
        else 0.0
    )

    return {
        "overall_completion_pct": overall_completion_pct,
        "total_credits_completed": total_credits_completed,
        "total_credits_required": float(min_su_total) if min_su_total is not None else None,
        "cgpa": cgpa,
        "meets_minimum_gpa": cgpa >= _MIN_GRADUATION_GPA,
        "categories": category_items,
    }


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


def import_bannerweb_parse_result(parsed: dict) -> dict:
    """Persist courses from a parsed Bannerweb degree evaluation.

    Groups courses by term code and creates one semester per unique term
    (reusing any existing semester with the same name). Inserts courses
    directly, bypassing prerequisite/overload validation since Bannerweb
    data is authoritative. Courses not in the catalog or already present
    in the target semester are reported in `skipped`.

    Per-course Engineering and Basic Science ECTS attributions from the
    matching Bannerweb sections are stored alongside each course; they
    feed the otherwise-unmappable Engineering and Basic Science
    graduation requirements.
    """
    if not isinstance(parsed, dict):
        raise ValueError("Parsed payload must be a dict.")

    sections = parsed.get("sections", {}) or {}

    # Engineering and Basic Science sections list per-course partial ECTS
    # attributions (a course's ECTS is split across these categories).
    # Build lookup keyed by (term, normalized_course_code).
    def _attribution_lookup(section_name: str) -> dict[tuple[str, str], float]:
        section = sections.get(section_name) or {}
        out: dict[tuple[str, str], float] = {}
        for course in section.get("courses", []) or []:
            if not isinstance(course, dict):
                continue
            term = str(course.get("term", "") or "").strip()
            raw_code = str(course.get("course", "") or "").strip()
            ects = course.get("ects_credits")
            if not term or not raw_code or ects is None:
                continue
            try:
                out[(term, _normalize_course_code(raw_code))] = float(ects)
            except (TypeError, ValueError):
                continue
        return out

    engineering_lookup = _attribution_lookup("ENGINEERING")
    basic_science_lookup = _attribution_lookup("BASIC SCIENCE")

    courses_by_term: dict[str, list[dict]] = {}
    for section_name, section in sections.items():
        if section_name in {"FACULTY COURSES", "ENGINEERING", "BASIC SCIENCE"}:
            # These sections are attribution lookups, not course rows
            # to insert (their values are category attributions, not
            # authoritative transcript rows).
            continue
        if not isinstance(section, dict):
            continue
        for course in section.get("courses", []) or []:
            if not isinstance(course, dict):
                continue
            term = str(course.get("term", "") or "").strip()
            raw_code = str(course.get("course", "") or "").strip()
            if not term or not raw_code:
                continue
            course_entry = dict(course)
            course_entry["_bannerweb_category"] = _BANNERWEB_PRIMARY_SECTION_CATEGORIES.get(section_name)
            courses_by_term.setdefault(term, []).append(course_entry)

    init_taken_courses_db()
    courses_by_code = _course_catalog()

    skipped: list[dict] = []
    created_semesters = 0
    imported_courses = 0

    with _connect() as conn:
        conn.row_factory = sqlite3.Row

        for term in sorted(courses_by_term.keys()):
            existing_semester = conn.execute(
                "SELECT id FROM semesters WHERE name = ? LIMIT 1",
                (term,),
            ).fetchone()
            if existing_semester:
                semester_id = existing_semester["id"]
            else:
                cursor = conn.execute(
                    "INSERT INTO semesters (name) VALUES (?)",
                    (term,),
                )
                semester_id = cursor.lastrowid
                created_semesters += 1

            for course in courses_by_term[term]:
                raw_code = str(course.get("course", "") or "").strip()
                normalized_code = _normalize_course_code(raw_code)
                grade = normalize_letter_grade(course.get("grade"))
                bannerweb_su_credits = course.get("su_credits")
                bannerweb_ects_credits = course.get("ects_credits")

                if normalized_code not in courses_by_code and bannerweb_su_credits is None:
                    skipped.append(
                        {
                            "course": raw_code,
                            "term": term,
                            "reason": "Course not found in catalog",
                        }
                    )
                    continue

                if _semester_has_course(conn, semester_id, normalized_code):
                    skipped.append(
                        {
                            "course": raw_code,
                            "term": term,
                            "reason": "Already exists in semester",
                        }
                    )
                    continue

                try:
                    new_credits = (
                        float(bannerweb_su_credits)
                        if bannerweb_su_credits is not None
                        else _course_su_credits(normalized_code, courses_by_code)
                    )
                    semester_credits = _semester_credit_total(
                        conn,
                        semester_id,
                        courses_by_code,
                    )
                except (LookupError, ValueError) as err:
                    skipped.append(
                        {
                            "course": raw_code,
                            "term": term,
                            "reason": str(err),
                        }
                    )
                    continue

                is_overload = (
                    1
                    if semester_credits + new_credits > MAX_SEMESTER_SU_CREDITS
                    else 0
                )

                attribution_key = (term, normalized_code)
                engineering_ects = engineering_lookup.get(attribution_key, 0.0)
                basic_science_ects = basic_science_lookup.get(attribution_key, 0.0)
                bannerweb_category = course.get("_bannerweb_category")

                conn.execute(
                    """
                    INSERT INTO semester_courses
                        (semester_id, course_code, grade, is_overload,
                         engineering_ects, basic_science_ects, bannerweb_category,
                         bannerweb_su_credits, bannerweb_ects_credits)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        semester_id,
                        normalized_code,
                        grade,
                        is_overload,
                        engineering_ects,
                        basic_science_ects,
                        bannerweb_category,
                        bannerweb_su_credits,
                        bannerweb_ects_credits,
                    ),
                )
                imported_courses += 1

        summary = _build_semesters_summary(conn)

    return {
        "created_semesters": created_semesters,
        "imported_courses": imported_courses,
        "skipped": skipped,
        "summary": summary,
    }


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
