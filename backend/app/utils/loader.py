import json
import sqlite3
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
JSON_PATH = DATA_DIR / "courses_SU.json"
DB_PATH = DATA_DIR / "courses_SU.db"
CREATE_COURSES_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS courses (
    course TEXT PRIMARY KEY,
    name TEXT,
    ects_credits REAL,
    su_credits REAL,
    faculty TEXT
)
"""


def _read_courses_from_json() -> list[dict]:
    with JSON_PATH.open("r", encoding="utf-8") as file:
        return json.load(file)


def _to_float_or_none(value: object) -> float | None:
    if value is None:
        return None
    return float(value)


def _seed_courses(conn: sqlite3.Connection) -> None:
    courses = _read_courses_from_json()
    rows = [
        (
            course["Course"],
            course["Name"],
            _to_float_or_none(course.get("ECTS Credits")),
            _to_float_or_none(course.get("SU Credits")),
            course.get("Faculty"),
        )
        for course in courses
    ]
    if rows:
        json_course_codes = {row[0] for row in rows}
        stale_rows = conn.execute("SELECT course FROM courses").fetchall()
        conn.executemany(
            "DELETE FROM courses WHERE course = ?",
            [
                (row[0],)
                for row in stale_rows
                if row[0] not in json_course_codes
            ],
        )
    conn.executemany(
        """
        INSERT INTO courses (course, name, ects_credits, su_credits, faculty)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(course) DO UPDATE SET
            name = excluded.name,
            ects_credits = excluded.ects_credits,
            su_credits = excluded.su_credits,
            faculty = excluded.faculty
        """,
        rows,
    )


def ensure_courses_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(CREATE_COURSES_TABLE_SQL)

        try:
            _seed_courses(conn)
        except sqlite3.IntegrityError:
            # Rebuild the table if an older stricter schema exists locally.
            conn.execute("DROP TABLE IF EXISTS courses")
            conn.execute(CREATE_COURSES_TABLE_SQL)
            _seed_courses(conn)


def load_courses() -> list[dict]:
    ensure_courses_db()

    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT
                course AS "Course",
                name AS "Name",
                ects_credits AS "ECTS Credits",
                su_credits AS "SU Credits",
                faculty AS "Faculty"
            FROM courses
            ORDER BY course
            """
        ).fetchall()

    return [dict(row) for row in rows]
