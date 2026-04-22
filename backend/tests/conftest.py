import json
import sys
from pathlib import Path

import pytest


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services import taken_course_service as service
from app.services import gpa_service


FIXTURE_COURSES = [
    {"Course": "UNI 101", "Name": "University Course I", "ECTS Credits": 5.0, "SU Credits": 3.0, "Faculty": "FASS"},
    {"Course": "UNI 102", "Name": "University Course II", "ECTS Credits": 5.0, "SU Credits": 3.0, "Faculty": "FASS"},
    {"Course": "REQ 101", "Name": "Required Course", "ECTS Credits": 5.0, "SU Credits": 3.0, "Faculty": "FENS"},
    {"Course": "CORE 101", "Name": "Core Elective I", "ECTS Credits": 5.0, "SU Credits": 3.0, "Faculty": "FENS"},
    {"Course": "CORE 102", "Name": "Core Elective II", "ECTS Credits": 5.0, "SU Credits": 3.0, "Faculty": "FENS"},
    {"Course": "AREA 101", "Name": "Area Elective", "ECTS Credits": 5.0, "SU Credits": 3.0, "Faculty": "FENS"},
    {"Course": "MULTI 101", "Name": "Multi Category Course", "ECTS Credits": 5.0, "SU Credits": 3.0, "Faculty": "FENS"},
    {"Course": "FREE 101", "Name": "Free Elective I", "ECTS Credits": 5.0, "SU Credits": 3.0, "Faculty": "SBS"},
    {"Course": "FREE 102", "Name": "Free Elective II", "ECTS Credits": 5.0, "SU Credits": 3.0, "Faculty": "FASS"},
    {"Course": "FAC 101", "Name": "Faculty Course I", "ECTS Credits": 5.0, "SU Credits": 3.0, "Faculty": "FENS"},
    {"Course": "FAC 102", "Name": "Faculty Course II", "ECTS Credits": 5.0, "SU Credits": 3.0, "Faculty": "FENS"},
]

FIXTURE_REQUIREMENTS = {
    "requirement_summary": {
        "total": {"min_ects": 30, "min_su": 18},
        "categories": [
            {"category": "University Courses", "min_su": 6, "min_courses": 2},
            {"category": "Required Courses", "min_su": 3, "min_courses": 1},
            {"category": "Core Electives", "min_su": 6},
            {"category": "Area Electives", "min_su": 3},
            {"category": "Free Electives", "min_su": 3},
            {"category": "Faculty Courses", "min_courses": 2},
        ],
    },
    "categories": {
        "University Courses": [
            {"course": "UNI 101", "name": "University Course I"},
            {"course": "UNI 102", "name": "University Course II"},
        ],
        "Required Courses": [
            {"course": "REQ 101", "name": "Required Course"},
        ],
        "Core Electives": [
            {"course": "CORE 101", "name": "Core Elective I"},
            {"course": "CORE 102", "name": "Core Elective II"},
        ],
        "Area Electives": [
            {"course": "AREA 101", "name": "Area Elective"},
            {"course": "MULTI 101", "name": "Multi Category Course"},
        ],
        "Free Electives": {
            "min_su_credits": 3,
            "definition": "All courses not counted in explicit categories.",
        },
        "Faculty Courses": {},
    },
    "prerequisites": {"courses": []},
}

FIXTURE_FACULTY_COURSES = {
    "program_name": "Fixture Program",
    "category_name": "FENS Faculty Courses",
    "courses": [
        {"code": "REQ 101", "name": "Required Course", "ects_credits": 5, "su_credits": 3, "faculty": "FENS"},
        {"code": "CORE 101", "name": "Core Elective I", "ects_credits": 5, "su_credits": 3, "faculty": "FENS"},
        {"code": "AREA 101", "name": "Area Elective", "ects_credits": 5, "su_credits": 3, "faculty": "FENS"},
        {"code": "MULTI 101", "name": "Multi Category Course", "ects_credits": 5, "su_credits": 3, "faculty": "FENS"},
        {"code": "FAC 101", "name": "Faculty Course I", "ects_credits": 5, "su_credits": 3, "faculty": "FENS"},
        {"code": "FAC 102", "name": "Faculty Course II", "ects_credits": 5, "su_credits": 3, "faculty": "FENS"},
    ],
}

GPA_FIXTURE_COURSES = [
    {"Course": "GPA 101", "Name": "GPA Course I", "ECTS Credits": 6.0, "SU Credits": 3.0, "Faculty": "FENS"},
    {"Course": "GPA 102", "Name": "GPA Course II", "ECTS Credits": 6.0, "SU Credits": 3.0, "Faculty": "FENS"},
    {"Course": "GPA 103", "Name": "GPA Course III", "ECTS Credits": 6.0, "SU Credits": 3.0, "Faculty": "FENS"},
    {"Course": "GPA 104", "Name": "GPA Course IV", "ECTS Credits": 6.0, "SU Credits": 3.0, "Faculty": "FENS"},
    {"Course": "GPA 105", "Name": "GPA Course V", "ECTS Credits": 6.0, "SU Credits": 4.0, "Faculty": "FENS"},
    {"Course": "GPA 106", "Name": "GPA Course VI", "ECTS Credits": 6.0, "SU Credits": 2.0, "Faculty": "FENS"},
    {"Course": "ZERO 100", "Name": "Zero Credit Course", "ECTS Credits": 1.0, "SU Credits": 0.0, "Faculty": "FENS"},
    {"Course": "REPEAT 101", "Name": "Repeatable Course", "ECTS Credits": 6.0, "SU Credits": 3.0, "Faculty": "FENS"},
]


@pytest.fixture
def requirement_engine(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    requirements_path = tmp_path / "requirements.json"
    faculty_courses_path = tmp_path / "faculty_courses.json"
    db_path = tmp_path / "taken_courses.db"

    requirements_path.write_text(
        json.dumps(FIXTURE_REQUIREMENTS, indent=2),
        encoding="utf-8",
    )
    faculty_courses_path.write_text(
        json.dumps(FIXTURE_FACULTY_COURSES, indent=2),
        encoding="utf-8",
    )

    monkeypatch.setattr(service, "REQUIREMENTS_PATH", requirements_path)
    monkeypatch.setattr(service, "FACULTY_COURSES_PATH", faculty_courses_path)
    monkeypatch.setattr(service, "DB_PATH", db_path)
    monkeypatch.setattr(service, "load_courses", lambda: FIXTURE_COURSES)

    service._prerequisites_by_course.cache_clear()
    service._program_required_totals.cache_clear()
    service._requirements_data.cache_clear()
    service._faculty_courses_data.cache_clear()

    try:
        yield service
    finally:
        service._prerequisites_by_course.cache_clear()
        service._program_required_totals.cache_clear()
        service._requirements_data.cache_clear()
        service._faculty_courses_data.cache_clear()


@pytest.fixture
def gpa_engine(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(gpa_service, "load_courses", lambda: GPA_FIXTURE_COURSES)
    yield gpa_service
