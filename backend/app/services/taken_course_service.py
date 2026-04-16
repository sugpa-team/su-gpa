import json
import sqlite3
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
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (semester_id, course_code),
                FOREIGN KEY (semester_id)
                    REFERENCES semesters (id)
                    ON DELETE CASCADE
            )
            """
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
    return " ".join(course_code.upper().split())


def _course_catalog() -> dict[str, dict]:
    return {
        _normalize_course_code(course["Course"]): course
        for course in load_courses()
        if course.get("Course")
    }


def _course_su_credits(course_code: str, courses_by_code: dict[str, dict]) -> float:
    course = courses_by_code.get(course_code)
    if course is None:
        raise LookupError(f"Course not found: {course_code}")

    su_credits = course.get("SU Credits")
    if su_credits is None:
        raise ValueError(f"Course has no SU credits: {course_code}")

    return float(su_credits)


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


def _build_semesters_summary(conn: sqlite3.Connection) -> dict:
    courses_by_code = _course_catalog()
    semester_rows = conn.execute(
        """
        SELECT id, name
        FROM semesters
        ORDER BY id ASC
        """
    ).fetchall()
    course_rows = conn.execute(
        """
        SELECT id, semester_id, course_code, grade
        FROM semester_courses
        ORDER BY semester_id ASC, id ASC
        """
    ).fetchall()

    courses_by_semester_id: dict[int, list[dict]] = {}
    for row in course_rows:
        courses_by_semester_id.setdefault(row["semester_id"], []).append(dict(row))

    semesters = []
    all_graded_courses = []

    for semester in semester_rows:
        semester_courses = courses_by_semester_id.get(semester["id"], [])
        total_su_credits = 0.0
        course_records = []

        for course_row in semester_courses:
            course_code = course_row["course_code"]
            course = courses_by_code.get(course_code, {})
            su_credits = _course_su_credits(course_code, courses_by_code)
            total_su_credits += su_credits
            grade_points = grade_to_points(course_row["grade"])

            if grade_points is not None:
                all_graded_courses.append(course_row)

            course_records.append(
                {
                    "id": course_row["id"],
                    "semester_id": course_row["semester_id"],
                    "course_code": course_code,
                    "course_name": course.get("Name"),
                    "su_credits": su_credits,
                    "grade": course_row["grade"],
                    "grade_points": grade_points,
                }
            )

        semester_gpa = _weighted_gpa(semester_courses, courses_by_code)
        semesters.append(
            {
                "id": semester["id"],
                "name": semester["name"],
                "total_su_credits": round(total_su_credits, 2),
                "gpa": semester_gpa,
                "courses": course_records,
            }
        )

    cumulative_gpa = _weighted_gpa(all_graded_courses, courses_by_code)
    return {
        "semesters": semesters,
        "cumulative_gpa": cumulative_gpa,
        "max_semester_su_credits": MAX_SEMESTER_SU_CREDITS,
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
    new_course_credits = _course_su_credits(normalized_course_code, courses_by_code)

    with _connect() as conn:
        conn.row_factory = sqlite3.Row
        _ensure_semester_exists(conn, semester_id)

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
        if next_semester_credits > MAX_SEMESTER_SU_CREDITS:
            raise ValueError(
                f"{normalized_course_code} cannot be added. Semester SU credits "
                f"would be {next_semester_credits}, exceeding the limit of "
                f"{MAX_SEMESTER_SU_CREDITS}."
            )

        conn.execute(
            """
            INSERT INTO semester_courses (semester_id, course_code, grade)
            VALUES (?, ?, ?)
            """,
            (semester_id, normalized_course_code, normalized_grade),
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
