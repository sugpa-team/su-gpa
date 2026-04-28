"""Read-only access to the scraped Bannerweb course schedule.

Data lives at app/data/schedule_data/{term}.min.json, refreshed daily by
the GitHub Actions cron in .github/workflows/scrape-suchedule.yaml.
The schema follows the suchedule format: courses with classes/sections,
plus interned `instructors` and `places` arrays referenced by index.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Iterable

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "schedule_data"


def _data_path(term: str) -> Path:
    return DATA_DIR / f"{term}.min.json"


def list_available_terms() -> list[str]:
    if not DATA_DIR.is_dir():
        return []
    terms = [p.stem for p in DATA_DIR.glob("*.min.json")]
    # Strip the second ".min" tail produced by Path.stem on .min.json
    return sorted(t.split(".")[0] for t in terms)


@lru_cache(maxsize=8)
def _load_term(term: str) -> dict:
    path = _data_path(term)
    if not path.exists():
        raise LookupError(f"No schedule data for term {term}")
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def get_term_schedule(term: str) -> dict:
    """Return the raw scraped JSON for a term — courses, instructors, places."""
    payload = _load_term(term)
    return {
        "term": term,
        "courses": payload.get("courses", []),
        "instructors": payload.get("instructors", []),
        "places": payload.get("places", []),
    }


def get_course_schedule(term: str, course_code: str) -> dict:
    """Return one course (by code) from a term's schedule, with the
    instructor + place index references resolved to strings for caller
    convenience.

    Course code matching is case- and whitespace-insensitive.
    """
    payload = _load_term(term)
    instructors: list[str] = payload.get("instructors", [])
    places: list[str] = payload.get("places", [])

    target = _normalize_course_code(course_code)
    course = next(
        (
            c
            for c in payload.get("courses", [])
            if _normalize_course_code(c.get("code", "")) == target
        ),
        None,
    )
    if course is None:
        raise LookupError(f"Course {course_code} not in schedule for term {term}")

    return {
        "term": term,
        "code": course.get("code"),
        "name": course.get("name"),
        "classes": [_resolve_class(cls, instructors, places) for cls in course.get("classes", [])],
    }


def _normalize_course_code(code: str) -> str:
    return "".join(str(code).upper().split())


def _resolve_class(cls: dict, instructors: list[str], places: list[str]) -> dict:
    return {
        "type": cls.get("type", ""),
        "sections": [
            _resolve_section(section, instructors, places)
            for section in cls.get("sections", [])
        ],
    }


def _resolve_section(section: dict, instructors: list[str], places: list[str]) -> dict:
    instructor_idx = section.get("instructors")
    instructor = (
        instructors[instructor_idx]
        if isinstance(instructor_idx, int) and 0 <= instructor_idx < len(instructors)
        else None
    )
    return {
        "crn": section.get("crn"),
        "group": section.get("group"),
        "instructor": instructor,
        "schedule": [_resolve_meeting(m, places) for m in section.get("schedule", [])],
    }


def _resolve_meeting(meeting: dict, places: list[str]) -> dict:
    place_idx = meeting.get("place")
    place = (
        places[place_idx]
        if isinstance(place_idx, int) and 0 <= place_idx < len(places)
        else None
    )
    return {
        "day": meeting.get("day"),
        "start": meeting.get("start"),
        "duration": meeting.get("duration"),
        "place": place,
    }


def clear_cache() -> None:
    """Drop in-memory cache; tests use this between runs."""
    _load_term.cache_clear()
