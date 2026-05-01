"""Integration tests for end-to-end flows.

Flow 1: Manual course entry → GPA update
Flow 2: Parsed import payload → graduation progress
Flow 3: Future planning simulation (planned semester drives projected CGPA)
Flow 4: Prerequisite validation (warning present / cleared)
"""

import json

import pytest


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _add_semester_with_courses(svc, semester_name, courses):
    """Create a semester, add (course_code, grade) pairs, return the semester id."""
    summary = svc.create_semester(semester_name)
    semester_id = summary["semesters"][-1]["id"]
    for course_code, grade in courses:
        svc.add_course_to_semester(semester_id, course_code, grade)
    return semester_id


def _inject_prerequisite(requirement_engine, course_code, prereq_codes):
    """Write a prerequisite constraint into the requirements JSON fixture."""
    data = json.loads(requirement_engine.REQUIREMENTS_PATH.read_text())
    courses_list = data.setdefault("prerequisites", {}).setdefault("courses", [])
    courses_list = [e for e in courses_list if e.get("code") != course_code]
    courses_list.append({"code": course_code, "prerequisites": list(prereq_codes)})
    data["prerequisites"]["courses"] = courses_list
    requirement_engine.REQUIREMENTS_PATH.write_text(json.dumps(data))
    requirement_engine._prerequisites_by_course.cache_clear()
    requirement_engine._requirements_data.cache_clear()


def _by_name(progress_result):
    """Index progress categories by name for convenient lookup in assertions."""
    return {cat["name"]: cat for cat in progress_result["categories"]}


# ===========================================================================
# Flow 1: Manual course entry → GPA update
# ===========================================================================

def test_flow1_four_courses_produce_correct_semester_gpa_and_cgpa(requirement_engine):
    """Adding 4 courses to a semester produces correct semester GPA and CGPA."""
    svc = requirement_engine
    summary = svc.create_semester("202401")
    semester_id = summary["semesters"][-1]["id"]

    # 3 SU credits each: A(4.0), B(3.0), A-(3.7), C(2.0)
    svc.add_course_to_semester(semester_id, "UNI 101", "A")
    svc.add_course_to_semester(semester_id, "UNI 102", "B")
    svc.add_course_to_semester(semester_id, "REQ 101", "A-")
    svc.add_course_to_semester(semester_id, "CORE 101", "C")

    # (4.0 + 3.0 + 3.7 + 2.0) × 3 / 12  =  38.1 / 12  =  3.175
    result = svc.get_semesters_summary()
    sem = result["semesters"][0]
    assert sem["gpa"] == 3.175
    assert result["cumulative_gpa"] == 3.175
    assert result["cgpa"] == 3.175


def test_flow1_deleting_one_course_recalculates_gpa(requirement_engine):
    """Deleting a course after it was added causes GPA to recalculate correctly."""
    svc = requirement_engine
    summary = svc.create_semester("202401")
    semester_id = summary["semesters"][-1]["id"]

    svc.add_course_to_semester(semester_id, "UNI 101", "A")    # 4.0 × 3
    svc.add_course_to_semester(semester_id, "UNI 102", "B")    # 3.0 × 3
    svc.add_course_to_semester(semester_id, "REQ 101", "A-")   # 3.7 × 3
    result = svc.add_course_to_semester(semester_id, "CORE 101", "C")  # 2.0 × 3

    core_row = next(
        c for c in result["semesters"][0]["courses"] if c["course_code"] == "CORE 101"
    )
    after_delete = svc.delete_course_record(core_row["id"])

    # Remaining: A(4.0) + B(3.0) + A-(3.7) over 9 credits = 32.1/9 = 3.567
    sem_after = after_delete["semesters"][0]
    assert sem_after["gpa"] == 3.567
    assert after_delete["cumulative_gpa"] == 3.567
    assert len(sem_after["courses"]) == 3


def test_flow1_updating_grade_recalculates_gpa(requirement_engine):
    """Patching a course grade immediately recalculates the semester and cumulative GPA."""
    svc = requirement_engine
    summary = svc.create_semester("202401")
    semester_id = summary["semesters"][-1]["id"]

    result = svc.add_course_to_semester(semester_id, "CORE 101", "F")
    assert result["semesters"][0]["gpa"] == 0.0

    core_row = next(
        c for c in result["semesters"][0]["courses"] if c["course_code"] == "CORE 101"
    )
    updated = svc.update_course_record(core_row["id"], "A")

    assert updated["semesters"][0]["gpa"] == 4.0
    assert updated["cumulative_gpa"] == 4.0


def test_flow1_two_semester_cgpa_is_credit_weighted_average(requirement_engine):
    """CGPA across two semesters equals the credit-weighted mean of all courses."""
    svc = requirement_engine

    _add_semester_with_courses(svc, "202401", [
        ("UNI 101", "A"),   # 4.0 × 3
        ("CORE 101", "B"),  # 3.0 × 3
    ])
    _add_semester_with_courses(svc, "202402", [
        ("UNI 102", "A-"),  # 3.7 × 3
        ("CORE 102", "B+"), # 3.3 × 3
    ])

    result = svc.get_semesters_summary()
    sems = result["semesters"]

    # Sem 1: (4.0 + 3.0) × 3 / 6 = 3.5
    # Sem 2: (3.7 + 3.3) × 3 / 6 = 3.5
    # CGPA:  (4.0 + 3.0 + 3.7 + 3.3) × 3 / 12 = 42/12 = 3.5
    assert sems[0]["gpa"] == 3.5
    assert sems[1]["gpa"] == 3.5
    assert result["cumulative_gpa"] == 3.5


def test_flow1_total_planned_su_credits_accumulates_across_semesters(requirement_engine):
    """total_planned_su_credits in the summary reflects credits from all semesters."""
    svc = requirement_engine

    _add_semester_with_courses(svc, "202401", [("UNI 101", "A"), ("UNI 102", "B")])
    _add_semester_with_courses(svc, "202402", [("REQ 101", "B+"), ("CORE 101", "A-")])

    result = svc.get_semesters_summary()

    # Each course is 3 SU credits; 4 courses total = 12
    assert result["total_planned_su_credits"] == 12.0


# ===========================================================================
# Flow 2: Parsed import payload → graduation progress
# ===========================================================================

def _full_import_payload():
    """Parsed Bannerweb payload covering six graduation-requirement categories."""
    return {
        "metadata": {"student": "Test Student"},
        "sections": {
            "UNIVERSITY COURSES": {
                "courses": [
                    {"course": "UNI 101", "grade": "A",  "su_credits": 3.0, "ects_credits": 5.0, "term": "202309"},
                    {"course": "UNI 102", "grade": "B",  "su_credits": 3.0, "ects_credits": 5.0, "term": "202309"},
                ],
            },
            "REQUIRED COURSES": {
                "courses": [
                    {"course": "REQ 101", "grade": "A-", "su_credits": 3.0, "ects_credits": 5.0, "term": "202309"},
                ],
            },
            "CORE ELECTIVES": {
                "courses": [
                    {"course": "CORE 101", "grade": "B+", "su_credits": 3.0, "ects_credits": 5.0, "term": "202309"},
                    {"course": "CORE 102", "grade": "B",  "su_credits": 3.0, "ects_credits": 5.0, "term": "202401"},
                ],
            },
            "AREA ELECTIVES": {
                "courses": [
                    {"course": "AREA 101", "grade": "A",  "su_credits": 3.0, "ects_credits": 5.0, "term": "202401"},
                ],
            },
            "FREE ELECTIVES": {
                "courses": [
                    {"course": "FREE 101", "grade": "B",  "su_credits": 3.0, "ects_credits": 5.0, "term": "202401"},
                ],
            },
        },
    }


def test_flow2_import_creates_correct_semesters_and_course_count(requirement_engine):
    """Importing a full payload creates two semesters and seven courses without skips."""
    result = requirement_engine.import_bannerweb_parse_result(_full_import_payload())

    assert result["created_semesters"] == 2
    assert result["imported_courses"] == 7
    assert result["skipped"] == []


def test_flow2_progress_categories_satisfied_after_full_import(requirement_engine):
    """After importing all required courses, relevant graduation categories are SATISFIED."""
    requirement_engine.import_bannerweb_parse_result(_full_import_payload())
    cats = _by_name(requirement_engine.get_progress_summary())

    assert cats["University Courses"]["status"] == "SATISFIED"
    assert cats["Required Courses"]["status"] == "SATISFIED"
    assert cats["Core Electives"]["status"] == "SATISFIED"
    assert cats["Area Electives"]["status"] == "SATISFIED"
    assert cats["Free Electives"]["status"] == "SATISFIED"


def test_flow2_cgpa_and_credit_totals_correct_after_import(requirement_engine):
    """Progress summary reports correct CGPA and total credits after import."""
    requirement_engine.import_bannerweb_parse_result(_full_import_payload())
    result = requirement_engine.get_progress_summary()

    # 7 courses × 3 SU credits = 21 total
    assert result["total_credits_completed"] == 21.0
    assert result["cgpa"] > 0.0
    assert result["meets_minimum_gpa"] is True


def test_flow2_partial_import_leaves_unimported_categories_not_started(requirement_engine):
    """A partial import (University Courses only) leaves other categories NOT_STARTED."""
    partial_payload = {
        "sections": {
            "UNIVERSITY COURSES": {
                "courses": [
                    {"course": "UNI 101", "grade": "A", "su_credits": 3.0, "ects_credits": 5.0, "term": "202309"},
                    {"course": "UNI 102", "grade": "B", "su_credits": 3.0, "ects_credits": 5.0, "term": "202309"},
                ],
            },
        },
    }
    requirement_engine.import_bannerweb_parse_result(partial_payload)
    cats = _by_name(requirement_engine.get_progress_summary())

    assert cats["University Courses"]["status"] == "SATISFIED"
    assert cats["Required Courses"]["status"] == "NOT_STARTED"
    assert cats["Core Electives"]["status"] == "NOT_STARTED"
    assert cats["Area Electives"]["status"] == "NOT_STARTED"


def test_flow2_graduation_requirements_progress_mirrors_import(requirement_engine):
    """get_graduation_requirements_progress course counts match what was imported."""
    requirement_engine.import_bannerweb_parse_result(_full_import_payload())
    progress = requirement_engine.get_graduation_requirements_progress()
    by_cat = {item["category"]: item for item in progress["categories"]}

    assert by_cat["University Courses"]["completed_courses"] == 2
    assert by_cat["Required Courses"]["completed_courses"] == 1
    assert by_cat["Core Electives"]["completed_su"] == 6.0


# ===========================================================================
# Flow 3: Future planning simulation
# ===========================================================================

def test_flow3_planned_semester_raises_projected_cgpa(requirement_engine):
    """Adding a planned semester with higher grades raises the projected CGPA."""
    svc = requirement_engine

    # Existing semester — all C grades
    _add_semester_with_courses(svc, "202401", [
        ("UNI 101", "C"),   # 2.0 × 3
        ("CORE 101", "C"),  # 2.0 × 3
    ])
    current_cgpa = svc.get_semesters_summary()["cumulative_gpa"]
    assert current_cgpa == 2.0

    # Planned semester — all A grades
    _add_semester_with_courses(svc, "202402", [
        ("UNI 102", "A"),   # 4.0 × 3
        ("CORE 102", "A"),  # 4.0 × 3
    ])
    projected = svc.get_semesters_summary()["cumulative_gpa"]

    assert projected > current_cgpa
    # (2+2+4+4) × 3 / 12  =  36/12  =  3.0
    assert projected == 3.0


def test_flow3_cgpa_delta_is_arithmetically_correct(requirement_engine):
    """The delta between projected and current CGPA is computed correctly."""
    svc = requirement_engine

    _add_semester_with_courses(svc, "202401", [
        ("UNI 101", "B"),   # 3.0 × 3
        ("REQ 101", "B"),   # 3.0 × 3
    ])
    current_cgpa = svc.get_semesters_summary()["cumulative_gpa"]

    _add_semester_with_courses(svc, "202402", [
        ("UNI 102", "A"),   # 4.0 × 3
        ("CORE 101", "A"),  # 4.0 × 3
    ])
    projected_cgpa = svc.get_semesters_summary()["cumulative_gpa"]

    delta = round(projected_cgpa - current_cgpa, 3)
    # Projected: (3+3+4+4) × 3 / 12 = 42/12 = 3.5; delta = 0.5
    assert projected_cgpa == 3.5
    assert delta == 0.5


def test_flow3_adding_failing_planned_semester_lowers_projected_cgpa(requirement_engine):
    """A planned semester with failing grades lowers the projected CGPA below current."""
    svc = requirement_engine

    _add_semester_with_courses(svc, "202401", [
        ("UNI 101", "A"),   # 4.0 × 3
        ("CORE 101", "A"),  # 4.0 × 3
    ])
    current_cgpa = svc.get_semesters_summary()["cumulative_gpa"]
    assert current_cgpa == 4.0

    _add_semester_with_courses(svc, "202402", [
        ("UNI 102", "F"),   # 0.0 × 3
        ("CORE 102", "F"),  # 0.0 × 3
    ])
    projected_cgpa = svc.get_semesters_summary()["cumulative_gpa"]

    assert projected_cgpa < current_cgpa
    # (4+4+0+0) × 3 / 12  =  24/12  =  2.0
    assert projected_cgpa == 2.0


def test_flow3_three_semester_projected_cgpa_credit_weighted(requirement_engine):
    """Projected CGPA across three semesters is the correct credit-weighted mean."""
    svc = requirement_engine

    _add_semester_with_courses(svc, "202401", [
        ("UNI 101", "C"),   # 2.0 × 3
    ])
    _add_semester_with_courses(svc, "202402", [
        ("UNI 102", "B"),   # 3.0 × 3
    ])
    _add_semester_with_courses(svc, "202501", [
        ("REQ 101", "A"),   # 4.0 × 3
    ])

    result = svc.get_semesters_summary()

    # (2 + 3 + 4) × 3 / 9  =  27/9  =  3.0
    assert result["cumulative_gpa"] == 3.0
    assert result["total_planned_su_credits"] == 9.0


# ===========================================================================
# Flow 4: Prerequisite validation
# ===========================================================================

def test_flow4_adding_course_with_unmet_prerequisite_raises_error(requirement_engine):
    """Adding a course whose prerequisite has not been completed raises ValueError."""
    _inject_prerequisite(requirement_engine, "CORE 102", ["CORE 101"])

    summary = requirement_engine.create_semester("202401")
    semester_id = summary["semesters"][-1]["id"]

    with pytest.raises(ValueError, match="CORE 102 cannot be added before completing prerequisites"):
        requirement_engine.add_course_to_semester(semester_id, "CORE 102", "A")


def test_flow4_prerequisite_warning_clears_after_taking_prereq_in_prior_semester(requirement_engine):
    """After the prerequisite is taken, the dependent course can be added without error."""
    _inject_prerequisite(requirement_engine, "CORE 102", ["CORE 101"])

    sem1_id = _add_semester_with_courses(requirement_engine, "202401", [("CORE 101", "B")])

    sem2_summary = requirement_engine.create_semester("202402")
    sem2_id = sem2_summary["semesters"][-1]["id"]
    result = requirement_engine.add_course_to_semester(sem2_id, "CORE 102", "A")

    codes = [c["course_code"] for c in result["semesters"][1]["courses"]]
    assert "CORE 102" in codes


def test_flow4_prerequisite_in_same_semester_does_not_satisfy_requirement(requirement_engine):
    """A prerequisite taken in the same semester does not count for that semester's courses."""
    _inject_prerequisite(requirement_engine, "CORE 102", ["CORE 101"])

    summary = requirement_engine.create_semester("202401")
    semester_id = summary["semesters"][-1]["id"]

    # Prereq taken in the same (not a prior) semester
    requirement_engine.add_course_to_semester(semester_id, "CORE 101", "B")

    with pytest.raises(ValueError, match="CORE 102 cannot be added before completing prerequisites"):
        requirement_engine.add_course_to_semester(semester_id, "CORE 102", "A")


def test_flow4_course_with_no_prerequisites_is_always_addable(requirement_engine):
    """Courses without any prerequisites can be added freely at any time."""
    summary = requirement_engine.create_semester("202401")
    semester_id = summary["semesters"][-1]["id"]

    result = requirement_engine.add_course_to_semester(semester_id, "UNI 101", "A")
    codes = [c["course_code"] for c in result["semesters"][0]["courses"]]
    assert "UNI 101" in codes


def test_flow4_only_one_of_two_prerequisites_taken_still_blocks_course(requirement_engine):
    """When a course requires two prerequisites and only one is satisfied, it is blocked."""
    data = json.loads(requirement_engine.REQUIREMENTS_PATH.read_text())
    data.setdefault("prerequisites", {})["courses"] = [
        {"code": "AREA 101", "prerequisites": ["UNI 101", "REQ 101"]},
    ]
    requirement_engine.REQUIREMENTS_PATH.write_text(json.dumps(data))
    requirement_engine._prerequisites_by_course.cache_clear()
    requirement_engine._requirements_data.cache_clear()

    # Only UNI 101 is taken — REQ 101 is missing
    sem1_id = _add_semester_with_courses(requirement_engine, "202401", [("UNI 101", "A")])

    sem2_summary = requirement_engine.create_semester("202402")
    sem2_id = sem2_summary["semesters"][-1]["id"]

    with pytest.raises(ValueError, match="AREA 101 cannot be added before completing prerequisites"):
        requirement_engine.add_course_to_semester(sem2_id, "AREA 101", "B")


def test_flow4_all_prerequisites_satisfied_allows_course_addition(requirement_engine):
    """When every prerequisite is met, the dependent course can be added successfully."""
    data = json.loads(requirement_engine.REQUIREMENTS_PATH.read_text())
    data.setdefault("prerequisites", {})["courses"] = [
        {"code": "AREA 101", "prerequisites": ["UNI 101", "REQ 101"]},
    ]
    requirement_engine.REQUIREMENTS_PATH.write_text(json.dumps(data))
    requirement_engine._prerequisites_by_course.cache_clear()
    requirement_engine._requirements_data.cache_clear()

    sem1_id = _add_semester_with_courses(requirement_engine, "202401", [
        ("UNI 101", "A"),
        ("REQ 101", "B"),
    ])

    sem2_summary = requirement_engine.create_semester("202402")
    sem2_id = sem2_summary["semesters"][-1]["id"]
    result = requirement_engine.add_course_to_semester(sem2_id, "AREA 101", "A")

    codes = [c["course_code"] for c in result["semesters"][1]["courses"]]
    assert "AREA 101" in codes
