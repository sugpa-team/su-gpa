def _add_courses(service_module, semester_name, courses):
    summary = service_module.create_semester(semester_name)
    semester_id = summary["semesters"][-1]["id"]
    for course_code, grade in courses:
        service_module.add_course_to_semester(semester_id, course_code, grade)


def _by_id(result):
    return {cat["id"]: cat for cat in result["categories"]}


def test_empty_transcript_returns_zeroed_data(requirement_engine):
    result = requirement_engine.get_progress_summary()

    assert result["overall_completion_pct"] == 0.0
    assert result["total_credits_completed"] == 0.0
    assert result["cgpa"] == 0.0
    assert result["meets_minimum_gpa"] is False
    for cat in result["categories"]:
        assert cat["status"] == "NOT_STARTED"
        assert cat["credits_completed"] == 0.0
        assert cat["completed_courses"] == []

    cats = _by_id(result)
    # Core and Area list the full pool; others are empty
    assert set(cats["core_electives"]["remaining_courses"]) == {"CORE 101", "CORE 102"}
    assert set(cats["area_electives"]["remaining_courses"]) == {"AREA 101", "MULTI 101"}
    assert cats["university_courses"]["remaining_courses"] == []
    assert cats["free_electives"]["remaining_courses"] == []


def test_response_contains_required_top_level_fields(requirement_engine):
    result = requirement_engine.get_progress_summary()

    for field in (
        "overall_completion_pct",
        "total_credits_completed",
        "total_credits_required",
        "cgpa",
        "meets_minimum_gpa",
        "categories",
    ):
        assert field in result


def test_category_items_have_required_fields(requirement_engine):
    result = requirement_engine.get_progress_summary()

    for cat in result["categories"]:
        for field in ("id", "name", "credits_completed", "credits_required", "completion_pct", "status", "completed_courses", "remaining_courses"):
            assert field in cat


def test_in_progress_after_partial_core_completion(requirement_engine):
    _add_courses(requirement_engine, "Semester 1", [("CORE 101", "B")])

    cats = _by_id(requirement_engine.get_progress_summary())

    assert cats["core_electives"]["status"] == "IN_PROGRESS"
    assert cats["core_electives"]["credits_completed"] == 3.0
    assert cats["core_electives"]["completion_pct"] == 50.0


def test_satisfied_when_credits_met(requirement_engine):
    _add_courses(
        requirement_engine,
        "Semester 1",
        [("CORE 101", "A"), ("CORE 102", "B")],
    )

    cats = _by_id(requirement_engine.get_progress_summary())

    assert cats["core_electives"]["status"] == "SATISFIED"
    assert cats["core_electives"]["credits_completed"] == 6.0
    assert cats["core_electives"]["completion_pct"] == 100.0


def test_remaining_courses_populated_only_for_core_and_area(requirement_engine):
    _add_courses(requirement_engine, "Semester 1", [("CORE 101", "A")])

    cats = _by_id(requirement_engine.get_progress_summary())

    assert cats["core_electives"]["remaining_courses"] == ["CORE 102"]
    assert set(cats["area_electives"]["remaining_courses"]) == {"AREA 101", "MULTI 101"}
    assert cats["university_courses"]["remaining_courses"] == []
    assert cats["required_courses"]["remaining_courses"] == []
    assert cats["free_electives"]["remaining_courses"] == []
    assert cats["faculty_courses"]["remaining_courses"] == []


def test_remaining_courses_shrinks_as_courses_are_added(requirement_engine):
    _add_courses(
        requirement_engine,
        "Semester 1",
        [("CORE 101", "A"), ("CORE 102", "B")],
    )

    cats = _by_id(requirement_engine.get_progress_summary())

    assert cats["core_electives"]["remaining_courses"] == []


def test_completed_courses_lists_taken_course_codes(requirement_engine):
    _add_courses(
        requirement_engine,
        "Semester 1",
        [("UNI 101", "A"), ("UNI 102", "B")],
    )

    cats = _by_id(requirement_engine.get_progress_summary())

    assert set(cats["university_courses"]["completed_courses"]) == {"UNI 101", "UNI 102"}
    assert cats["required_courses"]["completed_courses"] == []


def test_cgpa_reflects_graded_courses(requirement_engine):
    _add_courses(requirement_engine, "Semester 1", [("CORE 101", "A")])

    result = requirement_engine.get_progress_summary()

    # Single 3-credit A: (3 * 4.0) / 3 = 4.0
    assert result["cgpa"] == 4.0
    assert result["meets_minimum_gpa"] is True


def test_meets_minimum_gpa_false_when_below_threshold(requirement_engine):
    _add_courses(requirement_engine, "Semester 1", [("CORE 101", "F")])

    result = requirement_engine.get_progress_summary()

    assert result["cgpa"] == 0.0
    assert result["meets_minimum_gpa"] is False


def test_total_credits_completed_sums_all_planned_courses(requirement_engine):
    _add_courses(
        requirement_engine,
        "Semester 1",
        [("UNI 101", "A"), ("CORE 101", "B"), ("FREE 101", None)],
    )

    result = requirement_engine.get_progress_summary()

    assert result["total_credits_completed"] == 9.0


def test_total_credits_required_from_requirements_file(requirement_engine):
    result = requirement_engine.get_progress_summary()

    # FIXTURE_REQUIREMENTS sets min_su=18
    assert result["total_credits_required"] == 18.0


def test_overall_completion_pct_is_average_of_category_percents(requirement_engine):
    # Satisfy exactly one category: Required Courses (min_su=3, min_courses=1)
    _add_courses(requirement_engine, "Semester 1", [("REQ 101", "A")])

    result = requirement_engine.get_progress_summary()
    cats = _by_id(result)

    category_percents = [
        cat["completion_pct"]
        for cat in result["categories"]
        if cat["completion_pct"] is not None
    ]
    expected = round(sum(category_percents) / len(category_percents), 1)
    assert result["overall_completion_pct"] == expected
    assert cats["required_courses"]["status"] == "SATISFIED"


def test_free_elective_courses_appear_in_completed_list(requirement_engine):
    _add_courses(requirement_engine, "Semester 1", [("FREE 101", "B")])

    cats = _by_id(requirement_engine.get_progress_summary())

    assert "FREE 101" in cats["free_electives"]["completed_courses"]


def test_faculty_course_count_drives_status(requirement_engine):
    _add_courses(
        requirement_engine,
        "Semester 1",
        [("FAC 101", "A"), ("FAC 102", "B")],
    )

    cats = _by_id(requirement_engine.get_progress_summary())

    # min_courses=2 satisfied
    assert cats["faculty_courses"]["status"] == "SATISFIED"
    assert set(cats["faculty_courses"]["completed_courses"]) == {"FAC 101", "FAC 102"}
