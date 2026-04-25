import json
from pathlib import Path

import pytest

from app.services import schedule_service


SAMPLE_PAYLOAD = {
    "courses": [
        {
            "code": "CS 201",
            "name": "Programming Fundamentals",
            "classes": [
                {
                    "type": "",
                    "sections": [
                        {
                            "crn": "20055",
                            "group": "A",
                            "instructors": 0,
                            "schedule": [
                                {"day": 0, "place": 0, "start": 1, "duration": 2},
                                {"day": 2, "place": 1, "start": 4, "duration": 1},
                            ],
                        },
                        {
                            "crn": "20056",
                            "group": "B",
                            "instructors": 1,
                            "schedule": [
                                {"day": 1, "place": 0, "start": 3, "duration": 2},
                            ],
                        },
                    ],
                },
                {
                    "type": "L",
                    "sections": [
                        {
                            "crn": "20057",
                            "group": "L01",
                            "instructors": 0,
                            "schedule": [
                                {"day": 4, "place": 1, "start": 5, "duration": 2},
                            ],
                        },
                    ],
                },
            ],
        },
        {
            "code": "MATH 101",
            "name": "Calculus I",
            "classes": [
                {
                    "type": "",
                    "sections": [
                        {
                            "crn": "30100",
                            "group": "A",
                            "instructors": 1,
                            "schedule": [
                                {"day": 0, "place": 0, "start": 6, "duration": 1},
                            ],
                        },
                    ],
                },
            ],
        },
    ],
    "instructors": ["Jane Doe (P)", "John Smith"],
    "places": ["FENS L065", "FASS G019"],
}


@pytest.fixture
def schedule_term(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> str:
    data_dir = tmp_path / "schedule_data"
    data_dir.mkdir()
    (data_dir / "999999.min.json").write_text(json.dumps(SAMPLE_PAYLOAD), encoding="utf-8")

    monkeypatch.setattr(schedule_service, "DATA_DIR", data_dir)
    schedule_service.clear_cache()
    yield "999999"
    schedule_service.clear_cache()


def test_list_available_terms_returns_terms_in_directory(schedule_term):
    assert schedule_service.list_available_terms() == ["999999"]


def test_list_available_terms_empty_when_dir_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(schedule_service, "DATA_DIR", tmp_path / "does-not-exist")
    schedule_service.clear_cache()
    assert schedule_service.list_available_terms() == []


def test_get_term_schedule_returns_full_payload(schedule_term):
    result = schedule_service.get_term_schedule(schedule_term)
    assert result["term"] == schedule_term
    assert len(result["courses"]) == 2
    assert result["instructors"] == ["Jane Doe (P)", "John Smith"]
    assert result["places"] == ["FENS L065", "FASS G019"]


def test_get_term_schedule_unknown_term_raises(schedule_term):
    with pytest.raises(LookupError):
        schedule_service.get_term_schedule("000000")


def test_get_course_schedule_resolves_indices_to_strings(schedule_term):
    course = schedule_service.get_course_schedule(schedule_term, "CS 201")

    assert course["code"] == "CS 201"
    assert course["name"] == "Programming Fundamentals"
    assert len(course["classes"]) == 2

    main_section = course["classes"][0]["sections"][0]
    assert main_section["crn"] == "20055"
    assert main_section["instructor"] == "Jane Doe (P)"
    assert main_section["schedule"][0]["place"] == "FENS L065"
    assert main_section["schedule"][1]["place"] == "FASS G019"


def test_get_course_schedule_normalizes_lookup(schedule_term):
    # case + whitespace insensitive
    assert schedule_service.get_course_schedule(schedule_term, "cs201")["code"] == "CS 201"
    assert schedule_service.get_course_schedule(schedule_term, "  CS  201  ")["code"] == "CS 201"


def test_get_course_schedule_unknown_course_raises(schedule_term):
    with pytest.raises(LookupError):
        schedule_service.get_course_schedule(schedule_term, "BOGUS 999")


def test_get_course_schedule_handles_lab_class(schedule_term):
    course = schedule_service.get_course_schedule(schedule_term, "CS 201")
    lab = course["classes"][1]
    assert lab["type"] == "L"
    assert lab["sections"][0]["crn"] == "20057"


def test_get_course_schedule_invalid_indices_become_none(tmp_path, monkeypatch):
    payload = {
        "courses": [
            {
                "code": "BAD 100",
                "name": "Bad Indices",
                "classes": [
                    {
                        "type": "",
                        "sections": [
                            {
                                "crn": "11111",
                                "group": "A",
                                "instructors": 99,  # out of range
                                "schedule": [{"day": 0, "place": 99, "start": 0, "duration": 1}],
                            },
                        ],
                    },
                ],
            },
        ],
        "instructors": ["Only Instructor"],
        "places": ["Only Place"],
    }
    data_dir = tmp_path / "schedule_data"
    data_dir.mkdir()
    (data_dir / "111111.min.json").write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(schedule_service, "DATA_DIR", data_dir)
    schedule_service.clear_cache()

    course = schedule_service.get_course_schedule("111111", "BAD 100")
    section = course["classes"][0]["sections"][0]
    assert section["instructor"] is None
    assert section["schedule"][0]["place"] is None
