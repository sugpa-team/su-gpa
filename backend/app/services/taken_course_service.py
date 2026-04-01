import json
import sqlite3
from pathlib import Path
from urllib.parse import quote, unquote

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "taken_courses.db"


def init_taken_courses_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS taken_courses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                course_code TEXT NOT NULL,
                grade TEXT NOT NULL
            )
            """
        )


def add_taken_course(course_code: str, grade: str) -> None:
    init_taken_courses_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            "INSERT INTO taken_courses (course_code, grade) VALUES (?, ?)",
            (course_code, grade),
        )


def get_taken_courses() -> list[dict]:
    init_taken_courses_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT id, course_code, grade
            FROM taken_courses
            ORDER BY id DESC
            """
        ).fetchall()

    return [dict(row) for row in rows]


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
