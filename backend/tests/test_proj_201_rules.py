import pytest

from tests.conftest import FIXTURE_COURSES


@pytest.fixture
def proj_engine(requirement_engine, monkeypatch):
    monkeypatch.setattr(
        requirement_engine,
        "load_courses",
        lambda: [
            *FIXTURE_COURSES,
            {
                "Course": "PROJ 201",
                "Name": "Undergraduate Project Course",
                "ECTS Credits": 1.0,
                "SU Credits": 1.0,
                "Faculty": "FENS",
            },
        ],
    )
    return requirement_engine


def _create_semesters(service_module, names):
    summary = None
    for name in names:
        summary = service_module.create_semester(name)
    return summary


def test_proj_201_is_auto_added_to_fourth_gpa_calculator_semester(proj_engine):
    summary = _create_semesters(
        proj_engine,
        ["Semester 1", "Semester 2", "Semester 3", "Semester 4"],
    )

    fourth = summary["semesters"][3]
    assert fourth["name"] == "Semester 4"
    assert [course["course_code"] for course in fourth["courses"]] == ["PROJ 201"]
    assert "PROJ 201 was automatically added" in fourth["notes"][0]


def test_proj_201_fourth_semester_count_ignores_summer_terms(proj_engine):
    summary = _create_semesters(
        proj_engine,
        ["202201", "202202", "202203", "202301", "202302"],
    )

    semesters = {semester["name"]: semester for semester in summary["semesters"]}
    assert [course["course_code"] for course in semesters["202302"]["courses"]] == ["PROJ 201"]
    assert semesters["202301"]["courses"] == []


def test_proj_201_not_auto_added_if_taken_before_fourth_semester(proj_engine):
    first = proj_engine.create_semester("Semester 1")
    first_semester_id = first["semesters"][-1]["id"]
    proj_engine.add_course_to_semester(first_semester_id, "PROJ 201", None)

    summary = _create_semesters(
        proj_engine,
        ["Semester 2", "Semester 3", "Semester 4"],
    )

    fourth = summary["semesters"][3]
    assert fourth["courses"] == []


def test_proj_201_cannot_be_added_after_fourth_semester(proj_engine):
    summary = _create_semesters(
        proj_engine,
        ["Semester 1", "Semester 2", "Semester 3", "Semester 4", "Semester 5"],
    )
    fifth_semester_id = summary["semesters"][4]["id"]

    with pytest.raises(ValueError, match="after the fourth regular semester"):
        proj_engine.add_course_to_semester(fifth_semester_id, "PROJ 201", None)


def test_proj_201_cannot_be_retaken_after_fourth_semester_even_within_retake_window(proj_engine):
    summary = _create_semesters(
        proj_engine,
        ["Semester 1", "Semester 2", "Semester 3"],
    )
    third_semester_id = summary["semesters"][2]["id"]
    proj_engine.add_course_to_semester(third_semester_id, "PROJ 201", None)
    summary = _create_semesters(proj_engine, ["Semester 4", "Semester 5"])
    fifth_semester_id = summary["semesters"][4]["id"]

    with pytest.raises(ValueError, match="after the fourth regular semester"):
        proj_engine.add_course_to_semester(fifth_semester_id, "PROJ 201", None)


def test_proj_201_after_fourth_semester_is_not_eligible(proj_engine):
    summary = _create_semesters(
        proj_engine,
        ["Semester 1", "Semester 2", "Semester 3", "Semester 4", "Semester 5"],
    )

    fifth = summary["semesters"][4]
    assert "PROJ 201" not in fifth["eligible_course_codes"]
