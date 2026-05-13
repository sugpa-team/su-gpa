import json
from pathlib import Path

import pytest

from app.services import course_feedback_service, schedule_service


def test_feedback_crud_round_trips(requirement_engine):
    created = course_feedback_service.upsert_feedback(
        "core 101",
        difficulty="easy",
        workload="low",
        grading_style="project-heavy",
        recommendation="yes",
        note="Good elective when paired with a heavier course.",
    )

    assert created["course_code"] == "CORE 101"
    assert created["difficulty"] == "easy"
    assert created["workload"] == "low"

    updated = course_feedback_service.upsert_feedback(
        "CORE 101",
        difficulty="medium",
        workload="medium",
        grading_style="mixed",
        recommendation="maybe",
        note="Still useful, but more work than expected.",
    )

    assert updated["id"] == created["id"]
    assert updated["difficulty"] == "medium"
    assert updated["recommendation"] == "maybe"

    summaries = course_feedback_service.build_feedback_summaries()
    assert summaries["CORE 101"]["grading_style"] == "mixed"

    course_feedback_service.delete_feedback("CORE 101")
    with pytest.raises(LookupError):
        course_feedback_service.get_feedback("CORE 101")


def test_feedback_rejects_invalid_values(requirement_engine):
    with pytest.raises(ValueError):
        course_feedback_service.upsert_feedback(
            "CORE 101",
            difficulty="simple",
            workload="low",
            grading_style="mixed",
            recommendation="yes",
            note="",
        )


def test_feedback_rejects_unknown_course(requirement_engine):
    with pytest.raises(LookupError):
        course_feedback_service.upsert_feedback(
            "BOGUS 999",
            difficulty="easy",
            workload="low",
            grading_style="mixed",
            recommendation="yes",
            note="",
        )


def test_recommendations_use_feedback_requirements_and_prereqs(
    requirement_engine,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    data_dir = tmp_path / "schedule_data"
    data_dir.mkdir()
    payload = {
        "courses": [
            {
                "code": "REQ 101",
                "name": "Required Course",
                "classes": [
                    {
                        "type": "",
                        "sections": [
                            {
                                "crn": "10001",
                                "group": "A",
                                "instructors": 0,
                                "schedule": [{"day": 0, "place": 0, "start": 1, "duration": 2}],
                            }
                        ],
                    }
                ],
            },
            {
                "code": "CORE 101",
                "name": "Core Elective I",
                "classes": [
                    {
                        "type": "",
                        "sections": [
                            {
                                "crn": "10002",
                                "group": "A",
                                "instructors": 0,
                                "schedule": [{"day": 1, "place": 0, "start": 2, "duration": 1}],
                            }
                        ],
                    }
                ],
            },
            {
                "code": "CORE 102",
                "name": "Core Elective II",
                "classes": [
                    {
                        "type": "",
                        "sections": [
                            {
                                "crn": "10003",
                                "group": "A",
                                "instructors": 0,
                                "schedule": [{"day": 2, "place": 0, "start": 3, "duration": 1}],
                            }
                        ],
                    }
                ],
            },
        ],
        "instructors": ["Instructor"],
        "places": ["FENS"],
    }
    (data_dir / "202602.min.json").write_text(json.dumps(payload), encoding="utf-8")
    monkeypatch.setattr(schedule_service, "DATA_DIR", data_dir)
    schedule_service.clear_cache()

    requirements = json.loads(requirement_engine.REQUIREMENTS_PATH.read_text())
    requirements["prerequisites"] = {
        "courses": [{"code": "CORE 102", "prerequisites": ["REQ 101"]}],
    }
    requirement_engine.REQUIREMENTS_PATH.write_text(json.dumps(requirements), encoding="utf-8")
    requirement_engine._prerequisites_by_course.cache_clear()
    requirement_engine._requirements_data.cache_clear()

    course_feedback_service.upsert_feedback(
        "CORE 101",
        difficulty="easy",
        workload="low",
        grading_style="mixed",
        recommendation="yes",
        note="Good balance.",
    )

    result = course_feedback_service.build_recommendations("202602", limit=5)
    codes = [item["course_code"] for item in result["recommendations"]]

    assert codes[0] == "CORE 101"
    assert "REQ 101" in codes
    assert "CORE 102" not in codes
    assert "Core Electives" in result["recommendations"][0]["reasons"][0]

    schedule_service.clear_cache()
