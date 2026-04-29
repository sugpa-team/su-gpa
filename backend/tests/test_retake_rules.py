import pytest


def _create_semester(requirement_engine, term):
    summary = requirement_engine.create_semester(term)
    return summary["semesters"][-1]["id"]


def test_manual_add_allows_retake_until_third_regular_semester(requirement_engine):
    first_semester_id = _create_semester(requirement_engine, "202201")
    requirement_engine.add_course_to_semester(first_semester_id, "REQ 101", "C")
    retake_semester_id = _create_semester(requirement_engine, "202302")

    summary = requirement_engine.add_course_to_semester(
        retake_semester_id,
        "REQ 101",
        "B",
    )

    retake_semester = summary["semesters"][-1]
    assert retake_semester["name"] == "202302"
    assert [course["course_code"] for course in retake_semester["courses"]] == ["REQ 101"]


def test_manual_add_blocks_retake_after_third_regular_semester(requirement_engine):
    first_semester_id = _create_semester(requirement_engine, "202201")
    requirement_engine.add_course_to_semester(first_semester_id, "REQ 101", "C")
    late_semester_id = _create_semester(requirement_engine, "202401")

    with pytest.raises(ValueError, match="within three regular semesters"):
        requirement_engine.add_course_to_semester(late_semester_id, "REQ 101", "B")


def test_manual_add_blocks_retake_by_gpa_calculator_semester_order(requirement_engine):
    first_semester_id = _create_semester(requirement_engine, "Semester 1")
    requirement_engine.add_course_to_semester(first_semester_id, "REQ 101", "C")
    _create_semester(requirement_engine, "Semester 2")
    _create_semester(requirement_engine, "Semester 3")
    _create_semester(requirement_engine, "Semester 4")
    late_semester_id = _create_semester(requirement_engine, "Semester 5")

    with pytest.raises(ValueError, match="within three regular semesters"):
        requirement_engine.add_course_to_semester(late_semester_id, "REQ 101", "B")


def test_late_retake_is_removed_from_gpa_calculator_eligible_courses(requirement_engine):
    first_semester_id = _create_semester(requirement_engine, "Semester 1")
    requirement_engine.add_course_to_semester(first_semester_id, "REQ 101", "C")
    _create_semester(requirement_engine, "Semester 2")
    _create_semester(requirement_engine, "Semester 3")
    allowed_summary = requirement_engine.create_semester("Semester 4")
    _create_semester(requirement_engine, "Semester 5")

    allowed_semester = allowed_summary["semesters"][-1]
    blocked_semester = requirement_engine.get_semesters_summary()["semesters"][-1]

    assert "REQ 101" in allowed_semester["eligible_course_codes"]
    assert "REQ 101" not in blocked_semester["eligible_course_codes"]


def test_retake_window_does_not_count_summer_terms(requirement_engine):
    first_semester_id = _create_semester(requirement_engine, "202201")
    requirement_engine.add_course_to_semester(first_semester_id, "REQ 101", "C")
    summer_semester_id = _create_semester(requirement_engine, "202203")
    requirement_engine.add_course_to_semester(summer_semester_id, "CORE 101", "B")

    eligibility = requirement_engine.get_retake_eligibility("202302")

    assert eligibility["REQ 101"]["can_retake"] is True
    assert eligibility["REQ 101"]["regular_terms_since_last_taken"] == 3
    assert "CORE 101" not in eligibility
