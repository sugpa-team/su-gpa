import pytest

from app.services import plan_service


@pytest.fixture
def plans(requirement_engine, monkeypatch):
    """Reuse requirement_engine to get a tmp DB + course catalog. Both
    plan_service and the bannerweb-side import_bannerweb_parse_result
    write to the same SQLite path that requirement_engine monkeypatches
    on taken_course_service. Yield the plan_service module."""
    yield plan_service


SAMPLE_SECTIONS = [
    {"course_code": "REQ 101", "crn": "10001", "class_index": 0},
    {"course_code": "CORE 101", "crn": "10002", "class_index": 0},
]


def test_create_and_get_plan_round_trips(plans):
    created = plans.create_plan("202602", "Plan A", SAMPLE_SECTIONS)
    assert created["term"] == "202602"
    assert created["name"] == "Plan A"
    assert len(created["sections"]) == 2

    fetched = plans.get_plan(created["id"])
    assert fetched == created


def test_list_plans_filters_by_term(plans):
    plans.create_plan("202602", "Plan A", SAMPLE_SECTIONS)
    plans.create_plan("202602", "Plan B", SAMPLE_SECTIONS)
    plans.create_plan("202603", "Summer plan", SAMPLE_SECTIONS)

    spring = plans.list_plans(term="202602")
    summer = plans.list_plans(term="202603")
    nofilter = plans.list_plans()

    assert {p["name"] for p in spring} == {"Plan A", "Plan B"}
    assert {p["name"] for p in summer} == {"Summer plan"}
    assert len(nofilter) == 3


def test_update_plan_changes_name_and_sections(plans):
    created = plans.create_plan("202602", "Original", SAMPLE_SECTIONS)
    updated = plans.update_plan(
        created["id"],
        name="Renamed",
        sections=[{"course_code": "AREA 101", "crn": "20001"}],
    )
    assert updated["name"] == "Renamed"
    assert len(updated["sections"]) == 1
    assert updated["sections"][0]["course_code"] == "AREA 101"


def test_update_plan_partial_keeps_other_fields(plans):
    created = plans.create_plan("202602", "Original", SAMPLE_SECTIONS)
    only_name = plans.update_plan(created["id"], name="Just renamed")
    assert only_name["name"] == "Just renamed"
    assert len(only_name["sections"]) == len(SAMPLE_SECTIONS)


def test_delete_plan_removes_it(plans):
    created = plans.create_plan("202602", "Plan A", SAMPLE_SECTIONS)
    plans.delete_plan(created["id"])
    with pytest.raises(LookupError):
        plans.get_plan(created["id"])


def test_promote_creates_semester_and_adds_courses(plans, requirement_engine):
    plan = plans.create_plan("202602", "Spring 26", SAMPLE_SECTIONS)
    result = plans.promote_plan_to_semester(plan["id"])

    assert result["created_semester"] is True
    assert result["semester_name"] == "202602"
    assert result["imported_courses"] == 2
    assert result["skipped"] == []

    semesters = result["summary"]["semesters"]
    assert len(semesters) == 1
    assert semesters[0]["name"] == "202602"
    assert sorted(c["course_code"] for c in semesters[0]["courses"]) == ["CORE 101", "REQ 101"]


def test_promote_skips_courses_not_in_catalog(plans, requirement_engine):
    plan = plans.create_plan(
        "202602",
        "Mixed plan",
        [
            {"course_code": "REQ 101", "crn": "10001"},
            {"course_code": "BOGUS 999", "crn": "99999"},
        ],
    )
    result = plans.promote_plan_to_semester(plan["id"])

    assert result["imported_courses"] == 1
    assert len(result["skipped"]) == 1
    assert result["skipped"][0]["course_code"] == "BOGUS 999"
    assert result["skipped"][0]["reason"] == "Course not in catalog"


def test_promote_reuses_existing_semester_with_matching_name(plans, requirement_engine):
    requirement_engine.create_semester("202602")  # pre-existing semester
    plan = plans.create_plan("202602", "Spring 26", SAMPLE_SECTIONS)
    result = plans.promote_plan_to_semester(plan["id"])

    assert result["created_semester"] is False
    assert result["imported_courses"] == 2
    assert len(result["summary"]["semesters"]) == 1


def test_create_rejects_empty_term_or_name(plans):
    with pytest.raises(ValueError):
        plans.create_plan("", "Plan A", SAMPLE_SECTIONS)
    with pytest.raises(ValueError):
        plans.create_plan("202602", "", SAMPLE_SECTIONS)


def test_create_rejects_malformed_sections(plans):
    with pytest.raises(ValueError):
        plans.create_plan("202602", "Plan A", "not a list")
    with pytest.raises(ValueError):
        plans.create_plan("202602", "Plan A", [{"course_code": "REQ 101"}])  # no crn


def test_promote_bypasses_prereq_validation(plans, requirement_engine):
    # Add a prereq: REQ 101 requires UNI 101 (in this fixture).
    # The user has not taken UNI 101. Plan should still promote successfully —
    # the planner records intent, not validated transcript history.
    requirement_engine._prerequisites_by_course.cache_clear()

    # Inject a prereq override into the requirements fixture for this test
    import json
    fixture_path = requirement_engine.REQUIREMENTS_PATH
    data = json.loads(fixture_path.read_text())
    data["prerequisites"] = {
        "courses": [{"code": "REQ 101", "prerequisites": ["UNI 101"]}],
    }
    fixture_path.write_text(json.dumps(data))
    requirement_engine._prerequisites_by_course.cache_clear()
    requirement_engine._requirements_data.cache_clear()

    plan = plans.create_plan("202602", "skip-prereq", [
        {"course_code": "REQ 101", "crn": "10001"},
    ])
    result = plans.promote_plan_to_semester(plan["id"])

    assert result["imported_courses"] == 1
    assert result["skipped"] == []
