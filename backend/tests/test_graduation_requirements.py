import json


def _progress_by_category(service_module):
    result = service_module.get_graduation_requirements_progress()
    return {item["category"]: item for item in result["categories"]}


def _status(progress_item):
    progress = progress_item["progress_percent"]
    if progress is None or progress == 0:
        return "NOT_STARTED"
    if progress >= 100:
        return "SATISFIED"
    return "IN_PROGRESS"


def _create_semester_with_courses(service_module, semester_name, courses):
    summary = service_module.create_semester(semester_name)
    semester_id = summary["semesters"][-1]["id"]
    for course_code, grade in courses:
        service_module.add_course_to_semester(semester_id, course_code, grade)


def test_all_requirements_satisfied(requirement_engine):
    _create_semester_with_courses(
        requirement_engine,
        "Semester 1",
        [
            ("UNI 101", "A"),
            ("UNI 102", "A"),
            ("REQ 101", "A"),
            ("CORE 101", "A"),
            ("FAC 101", "A"),
        ],
    )
    _create_semester_with_courses(
        requirement_engine,
        "Semester 2",
        [
            ("CORE 102", "B"),
            ("AREA 101", "A"),
            ("FREE 101", "B"),
            ("FAC 102", "A"),
        ],
    )

    progress = _progress_by_category(requirement_engine)

    for category in (
        "University Courses",
        "Required Courses",
        "Core Electives",
        "Area Electives",
        "Free Electives",
        "Faculty Courses",
    ):
        assert _status(progress[category]) == "SATISFIED"


def test_partially_satisfied_transcript(requirement_engine):
    _create_semester_with_courses(
        requirement_engine,
        "Semester 1",
        [
            ("UNI 101", "A"),
            ("REQ 101", "B"),
        ],
    )

    progress = _progress_by_category(requirement_engine)

    assert _status(progress["University Courses"]) == "IN_PROGRESS"
    assert _status(progress["Required Courses"]) == "SATISFIED"
    assert _status(progress["Faculty Courses"]) == "IN_PROGRESS"
    assert _status(progress["Core Electives"]) == "NOT_STARTED"
    assert _status(progress["Area Electives"]) == "NOT_STARTED"
    assert _status(progress["Free Electives"]) == "NOT_STARTED"


def test_multi_category_course_prioritizes_area_before_free(requirement_engine):
    _create_semester_with_courses(
        requirement_engine,
        "Semester 1",
        [("MULTI 101", "A")],
    )

    progress = _progress_by_category(requirement_engine)

    assert progress["Area Electives"]["completed_su"] == 3.0
    assert _status(progress["Area Electives"]) == "SATISFIED"
    assert progress["Free Electives"]["completed_su"] == 0.0
    assert _status(progress["Free Electives"]) == "NOT_STARTED"


def test_core_course_missing_keeps_core_unsatisfied(requirement_engine):
    _create_semester_with_courses(
        requirement_engine,
        "Semester 1",
        [("CORE 101", "A")],
    )

    progress = _progress_by_category(requirement_engine)
    core = progress["Core Electives"]

    assert _status(core) == "IN_PROGRESS"
    assert core["completed_su"] == 3.0
    assert core["remaining_su"] == 3.0


def test_free_elective_overflow_does_not_inflate_other_categories(requirement_engine):
    _create_semester_with_courses(
        requirement_engine,
        "Semester 1",
        [
            ("FREE 101", "A"),
            ("FREE 102", "B"),
        ],
    )

    progress = _progress_by_category(requirement_engine)

    assert progress["Free Electives"]["completed_su"] == 6.0
    assert _status(progress["Free Electives"]) == "SATISFIED"
    assert progress["Area Electives"]["completed_su"] == 0.0
    assert progress["Required Courses"]["completed_su"] == 0.0


def test_elective_overflow_follows_core_area_free_priority(requirement_engine):
    data = json.loads(requirement_engine.REQUIREMENTS_PATH.read_text())
    data["categories"]["Core Electives"].append(
        {"course": "MULTI 101", "name": "Multi Category Course"}
    )
    requirement_engine.REQUIREMENTS_PATH.write_text(json.dumps(data))
    requirement_engine._requirements_data.cache_clear()

    _create_semester_with_courses(
        requirement_engine,
        "Semester 1",
        [
            ("CORE 101", "A"),
            ("CORE 102", "A"),
            ("MULTI 101", "A"),
            ("AREA 101", "A"),
        ],
    )

    progress = _progress_by_category(requirement_engine)

    assert progress["Core Electives"]["completed_su"] == 6.0
    assert progress["Area Electives"]["completed_su"] == 3.0
    assert progress["Free Electives"]["completed_su"] == 3.0


def test_empty_transcript_starts_everything_at_zero(requirement_engine):
    progress = _progress_by_category(requirement_engine)

    for item in progress.values():
        assert item["completed_su"] == 0.0
        assert item["completed_courses"] == 0
        assert _status(item) == "NOT_STARTED"


def test_s_grade_courses_still_count_toward_requirement_completion(requirement_engine):
    summary = requirement_engine.create_semester("Semester 1")
    semester_id = summary["semesters"][-1]["id"]

    with requirement_engine._connect() as conn:
        conn.execute(
            """
            INSERT INTO semester_courses (semester_id, course_code, grade, is_overload)
            VALUES (?, ?, ?, ?)
            """,
            (semester_id, "FREE 101", "S", 0),
        )

    progress = _progress_by_category(requirement_engine)

    assert progress["Free Electives"]["completed_su"] == 3.0
    assert progress["Free Electives"]["completed_courses"] == 1
    assert _status(progress["Free Electives"]) == "SATISFIED"
