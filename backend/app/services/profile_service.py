import json
import sqlite3
from pathlib import Path

from app.services.taken_course_service import reset_tracking_data
from app.utils.loader import DB_PATH as COURSES_DB_PATH

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
PROFILE_DB_PATH = DATA_DIR / "user_profile.db"
CS_REQUIREMENTS_PATH = DATA_DIR / "cs_bscs_requirements_v1.json"


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(PROFILE_DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def _read_program_rows_from_source() -> list[sqlite3.Row]:
    # Programs are sourced from the scraper-populated database table.
    try:
        with sqlite3.connect(COURSES_DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """
                SELECT id, faculty, department, program_name
                FROM programs
                ORDER BY faculty, department, program_name
                """
            ).fetchall()
            if rows:
                return rows
    except sqlite3.OperationalError:
        pass

    return _read_program_rows_from_requirements()


def _read_program_rows_from_requirements() -> list[dict]:
    try:
        with CS_REQUIREMENTS_PATH.open("r", encoding="utf-8") as file:
            requirements = json.load(file)
    except (FileNotFoundError, json.JSONDecodeError):
        return []

    program = requirements.get("program") or {}
    faculty = program.get("faculty_name")
    department = program.get("department_name")
    program_name = program.get("program_name")
    if not faculty or not department or not program_name:
        return []

    return [
        {
            "id": 1,
            "faculty": faculty,
            "department": department,
            "program_name": program_name,
        }
    ]


def init_profile_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS programs (
                id INTEGER PRIMARY KEY,
                faculty TEXT NOT NULL,
                department TEXT NOT NULL,
                program_name TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_profile (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                faculty TEXT,
                department TEXT,
                program_id INTEGER,
                FOREIGN KEY (program_id) REFERENCES programs (id)
            )
            """
        )
        columns = {
            row["name"]
            for row in conn.execute("PRAGMA table_info(user_profile)").fetchall()
        }
        if "entry_term" not in columns:
            conn.execute("ALTER TABLE user_profile ADD COLUMN entry_term TEXT")
        conn.execute("INSERT OR IGNORE INTO user_profile (id) VALUES (1)")

        program_rows = _read_program_rows_from_source()
        for row in program_rows:
            conn.execute(
                """
                INSERT INTO programs (id, faculty, department, program_name)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    faculty = excluded.faculty,
                    department = excluded.department,
                    program_name = excluded.program_name
                """,
                (
                    row["id"],
                    row["faculty"],
                    row["department"],
                    row["program_name"],
                ),
            )


def get_programs() -> list[dict]:
    init_profile_db()
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, faculty, department, program_name
            FROM programs
            ORDER BY faculty, department, program_name
            """
        ).fetchall()
    return [dict(row) for row in rows]


def get_profile() -> dict:
    init_profile_db()
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT
                p.faculty,
                p.program_id,
                pr.program_name,
                p.entry_term
            FROM user_profile p
            LEFT JOIN programs pr ON pr.id = p.program_id
            WHERE p.id = 1
            """
        ).fetchone()
    return dict(row) if row else {}


def update_profile(faculty: str, program_id: int, entry_term: str) -> dict:
    init_profile_db()
    trimmed_faculty = faculty.strip()
    trimmed_entry_term = entry_term.strip()
    if not trimmed_faculty:
        raise ValueError("Faculty is required.")
    if not trimmed_entry_term:
        raise ValueError("Entry term is required.")

    with _connect() as conn:
        current = conn.execute(
            "SELECT program_id FROM user_profile WHERE id = 1"
        ).fetchone()
        current_program_id = current["program_id"] if current else None

        matched_program = conn.execute(
            """
            SELECT id, faculty, department, program_name
            FROM programs
            WHERE id = ?
            """,
            (program_id,),
        ).fetchone()
        if matched_program is None:
            raise LookupError(f"Program not found: {program_id}")

        if matched_program["faculty"] != trimmed_faculty:
            raise ValueError("Selected faculty does not match program.")

        conn.execute(
            """
            UPDATE user_profile
            SET faculty = ?, department = ?, program_id = ?, entry_term = ?
            WHERE id = 1
            """,
            (
                trimmed_faculty,
                matched_program["department"],
                program_id,
                trimmed_entry_term,
            ),
        )

    tracking_reset = (
        current_program_id is not None
        and current_program_id != program_id
    )
    if tracking_reset:
        reset_tracking_data()

    return {
        "profile": get_profile(),
        "tracking_reset": tracking_reset,
    }
