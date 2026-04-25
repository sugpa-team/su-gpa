def _sample_parsed_payload() -> dict:
    return {
        "metadata": {"student": "Test Student"},
        "general_program_requirements": {},
        "sections": {
            "UNIVERSITY COURSES": {
                "courses": [
                    {"course": "UNI 101", "grade": "A", "su_credits": 3.0, "ects_credits": 5.0, "term": "202309"},
                    {"course": "UNI 102", "grade": "B+", "su_credits": 3.0, "ects_credits": 5.0, "term": "202401"},
                ],
            },
            "REQUIRED COURSES": {
                "courses": [
                    {"course": "REQ 101", "grade": "A-", "su_credits": 3.0, "ects_credits": 5.0, "term": "202309"},
                ],
            },
        },
        "analysis": {"total_sections_parsed": 2, "total_courses_parsed": 3},
    }


def test_import_creates_semesters_by_term_and_persists_courses(requirement_engine):
    result = requirement_engine.import_bannerweb_parse_result(_sample_parsed_payload())

    assert result["created_semesters"] == 2
    assert result["imported_courses"] == 3
    assert result["skipped"] == []

    semesters = result["summary"]["semesters"]
    assert [s["name"] for s in semesters] == ["202309", "202401"]
    fall = next(s for s in semesters if s["name"] == "202309")
    spring = next(s for s in semesters if s["name"] == "202401")
    assert sorted(c["course_code"] for c in fall["courses"]) == ["REQ 101", "UNI 101"]
    assert [c["course_code"] for c in spring["courses"]] == ["UNI 102"]


def test_import_is_reflected_in_graduation_requirements(requirement_engine):
    requirement_engine.import_bannerweb_parse_result(_sample_parsed_payload())

    progress = requirement_engine.get_graduation_requirements_progress()
    by_category = {item["category"]: item for item in progress["categories"]}

    assert by_category["University Courses"]["completed_courses"] == 2
    assert by_category["Required Courses"]["completed_courses"] == 1


def test_import_rerun_does_not_duplicate_semesters(requirement_engine):
    payload = _sample_parsed_payload()
    first = requirement_engine.import_bannerweb_parse_result(payload)
    second = requirement_engine.import_bannerweb_parse_result(payload)

    assert first["created_semesters"] == 2
    assert second["created_semesters"] == 0
    assert second["imported_courses"] == 0
    assert len(second["skipped"]) == 3
    assert all(entry["reason"] == "Already exists in semester" for entry in second["skipped"])

    semester_names = [s["name"] for s in second["summary"]["semesters"]]
    assert semester_names == ["202309", "202401"]


def test_import_skips_courses_not_in_catalog(requirement_engine):
    payload = {
        "sections": {
            "FOO": {
                "courses": [
                    {"course": "UNI 101", "grade": "A", "term": "202309"},
                    {"course": "BOGUS 999", "grade": "A", "term": "202309"},
                ],
            },
        },
    }

    result = requirement_engine.import_bannerweb_parse_result(payload)

    assert result["imported_courses"] == 1
    assert len(result["skipped"]) == 1
    assert result["skipped"][0]["course"] == "BOGUS 999"
    assert result["skipped"][0]["reason"] == "Course not found in catalog"


def test_import_skips_courses_without_term(requirement_engine):
    payload = {
        "sections": {
            "FOO": {
                "courses": [
                    {"course": "UNI 101", "grade": "A", "term": "202309"},
                    {"course": "UNI 102", "grade": "B"},
                    {"course": "REQ 101", "grade": "A", "term": ""},
                ],
            },
        },
    }

    result = requirement_engine.import_bannerweb_parse_result(payload)

    assert result["imported_courses"] == 1
    assert [s["name"] for s in result["summary"]["semesters"]] == ["202309"]


def test_import_reuses_existing_semester_with_matching_name(requirement_engine):
    requirement_engine.create_semester("202309")

    result = requirement_engine.import_bannerweb_parse_result({
        "sections": {
            "FOO": {
                "courses": [
                    {"course": "UNI 101", "grade": "A", "term": "202309"},
                ],
            },
        },
    })

    assert result["created_semesters"] == 0
    assert result["imported_courses"] == 1
    semesters = result["summary"]["semesters"]
    assert len(semesters) == 1
    assert semesters[0]["name"] == "202309"
    assert [c["course_code"] for c in semesters[0]["courses"]] == ["UNI 101"]


def test_import_accepts_pass_fail_grades(requirement_engine):
    payload = {
        "sections": {
            "UNIVERSITY COURSES": {
                "courses": [
                    {"course": "UNI 101", "grade": "S", "term": "202309"},
                    {"course": "UNI 102", "grade": "U", "term": "202309"},
                ],
            },
        },
    }

    result = requirement_engine.import_bannerweb_parse_result(payload)

    assert result["imported_courses"] == 2
    assert result["skipped"] == []
    semester = result["summary"]["semesters"][0]
    grades = {c["course_code"]: c["grade"] for c in semester["courses"]}
    assert grades["UNI 101"] == "S"
    assert grades["UNI 102"] == "U"
    assert all(c["grade_points"] is None for c in semester["courses"])


def test_import_empty_payload_returns_empty_result(requirement_engine):
    result = requirement_engine.import_bannerweb_parse_result({"sections": {}})

    assert result["created_semesters"] == 0
    assert result["imported_courses"] == 0
    assert result["skipped"] == []
    assert result["summary"]["semesters"] == []
