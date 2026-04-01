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
    conn.executemany(
        """
        INSERT INTO courses (course, name, ects_credits, su_credits, faculty)
        VALUES (?, ?, ?, ?, ?)
        """,
        rows,
    )


def ensure_courses_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(CREATE_COURSES_TABLE_SQL)

        row_count = conn.execute("SELECT COUNT(*) FROM courses").fetchone()[0]
        if row_count > 0:
            return

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
