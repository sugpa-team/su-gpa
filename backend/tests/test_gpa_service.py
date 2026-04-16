import pytest

from app.models.taken_course import CourseGrade, TakenCourse
from app.services import gpa_service


COURSE_CREDITS = {
    "ACC 201": 3.0,
    "ACC 301": 3.0,
    "ACC 401": 3.0,
    "ACC 402": 3.0,
    "AL 102": 3.0,
    "CIP 101N": 0.0,
    "CS 201": 3.0,
    "CS 204": 3.0,
    "DSA 210 / CS 210": 3.0,
    "CS 300": 3.0,
    "CS 301": 3.0,
    "CS 302": 3.0,
    "CS 303": 4.0,
    "CS 305": 3.0,
    "CS 306": 3.0,
    "CS 307": 3.0,
    "CS 308": 4.0,
    "CS 310": 3.0,
    "CS 395": 0.0,
    "SPS 101": 3.0,
    "SPS 102": 3.0,
    "TLL 101": 2.0,
}


@pytest.fixture(autouse=True)
def use_isolated_course_catalog(monkeypatch):
    monkeypatch.setattr(
        gpa_service,
        "load_courses",
        lambda: [
            {"Course": course, "SU Credits": credits}
            for course, credits in COURSE_CREDITS.items()
        ],
    )


def cg(course: str, grade: str) -> CourseGrade:
    return CourseGrade(course=course, grade=grade)


def test_standard_semester_calculates_semester_gpa_and_cgpa():
    grades = [[cg("CS 201", "A"), cg("CS 204", "B+"), cg("CS 300", "B"), cg("CS 301", "C+")]]

    summary = gpa_service.calculate_gpa_summary_from_letter_grades(grades)

    # Manual: (3*4.0 + 3*3.3 + 3*3.0 + 3*2.3) / 12 = 3.15.
    assert summary["semester_gpas"] == [3.15]
    assert summary["cumulative_gpa"] == 3.15


def test_mixed_grades_calculates_weighted_average():
    grades = [[cg("ACC 201", "A"), cg("ACC 301", "B"), cg("ACC 401", "C"), cg("ACC 402", "F")]]

    summary = gpa_service.calculate_gpa_summary_from_letter_grades(grades)

    # Manual: (3*4.0 + 3*3.0 + 3*2.0 + 3*0.0) / 12 = 2.25.
    assert summary["semester_gpas"] == [2.25]
    assert summary["cumulative_gpa"] == 2.25


def test_multi_semester_calculates_cgpa_across_all_semesters():
    grades = [
        [cg("CS 201", "A"), cg("CS 204", "B")],
        [cg("CS 300", "C"), cg("CS 301", "F")],
        [cg("CS 302", "A-"), cg("CS 305", "B+")],
    ]

    summary = gpa_service.calculate_gpa_summary_from_letter_grades(grades)

    # Manual semester GPAs: (4.0+3.0)/2 = 3.5, (2.0+0.0)/2 = 1.0,
    # (3.7+3.3)/2 = 3.5. CGPA: 3*(4+3+2+0+3.7+3.3) / 18 = 2.667.
    assert summary["semester_gpas"] == [3.5, 1.0, 3.5]
    assert summary["cumulative_gpa"] == 2.667


def test_high_performer_all_a_grades_have_perfect_cgpa():
    grades = [
        [cg("CS 201", "A"), cg("CS 204", "A")],
        [cg("CS 300", "A"), cg("CS 301", "A")],
    ]

    summary = gpa_service.calculate_gpa_summary_from_letter_grades(grades)

    # Manual: every graded SU credit has 4.0 points, so CGPA = 4.0.
    assert summary["semester_gpas"] == [4.0, 4.0]
    assert summary["cumulative_gpa"] == 4.0


def test_failing_semester_all_f_grades_have_zero_cgpa():
    grades = [[cg("CS 201", "F"), cg("CS 204", "F"), cg("CS 300", "F")]]

    summary = gpa_service.calculate_gpa_summary_from_letter_grades(grades)

    # Manual: (3*0.0 + 3*0.0 + 3*0.0) / 9 = 0.0.
    assert summary["semester_gpas"] == [0.0]
    assert summary["cumulative_gpa"] == 0.0


def test_non_gpa_only_semester_has_null_gpa_not_zero():
    grades = [[cg("CS 201", ""), cg("CS 204", "Select")]]

    summary = gpa_service.calculate_gpa_summary_from_letter_grades(grades)

    # Manual: 6 SU credits are planned, but 0 GPA-affecting credits exist, so GPA is null.
    assert summary["semester_su_credits"] == [6.0]
    assert summary["semester_gpas"] == [None]
    assert summary["cumulative_gpa"] is None


def test_mixed_gpa_and_non_gpa_courses_excludes_non_gpa_course():
    grades = [[cg("CS 201", "A"), cg("CS 204", "")]]

    summary = gpa_service.calculate_gpa_summary_from_letter_grades(grades)

    # Manual: CS 204 has no grade points; 3*4.0 / 3 = 4.0.
    assert summary["semester_su_credits"] == [6.0]
    assert summary["semester_gpas"] == [4.0]
    assert summary["cumulative_gpa"] == 4.0


def test_single_course_semester_uses_that_course_grade():
    grades = [[cg("CS 201", "B")]]

    summary = gpa_service.calculate_gpa_summary_from_letter_grades(grades)

    # Manual: one 3-credit B course is 3*3.0 / 3 = 3.0.
    assert summary["semester_gpas"] == [3.0]
    assert summary["cumulative_gpa"] == 3.0


def test_zero_credit_course_does_not_affect_gpa_denominator():
    grades = [[cg("CS 201", "B"), cg("CS 395", "F")]]

    summary = gpa_service.calculate_gpa_summary_from_letter_grades(grades)

    # Manual: CS 395 has 0 SU credits; (3*3.0 + 0*0.0) / 3 = 3.0.
    assert summary["semester_su_credits"] == [3.0]
    assert summary["semester_gpas"] == [3.0]
    assert summary["cumulative_gpa"] == 3.0


def test_repeated_course_uses_latest_attempt_for_cumulative_gpa():
    grades = [
        [cg("CS 201", "F")],
        [cg("CS 201", "A"), cg("CS 204", "B")],
    ]

    summary = gpa_service.calculate_gpa_summary_from_letter_grades(grades)

    # Manual: semester GPAs are 0.0 and (4.0+3.0)/2 = 3.5.
    # Cumulative policy uses latest CS 201 attempt: (3*4.0 + 3*3.0) / 6 = 3.5.
    assert summary["semester_gpas"] == [0.0, 3.5]
    assert summary["cumulative_gpa"] == 3.5


def test_course_alias_uses_catalog_credits():
    grades = [[cg("CS 210", "A")]]

    summary = gpa_service.calculate_gpa_summary_from_letter_grades(grades)

    # Manual: CS 210 aliases to DSA 210 / CS 210; 3*4.0 / 3 = 4.0.
    assert summary["semester_su_credits"] == [3.0]
    assert summary["cumulative_gpa"] == 4.0


def test_invalid_letter_grade_is_rejected_without_extending_grade_set():
    with pytest.raises(ValueError, match="Invalid letter grade: AA"):
        gpa_service.calculate_gpa_summary_from_letter_grades([[cg("CS 201", "AA")]])


def test_duplicate_course_in_same_semester_is_rejected():
    with pytest.raises(ValueError, match="Course already exists in this semester: CS 201"):
        gpa_service.calculate_gpa_summary_from_letter_grades([[cg("CS 201", "A"), cg("cs   201", "B")]])


def test_unknown_course_is_rejected():
    with pytest.raises(ValueError, match="Unknown course or missing SU credits: NOPE 101"):
        gpa_service.calculate_gpa_summary_from_letter_grades([[cg("NOPE 101", "A")]])


def test_semester_su_credit_limit_is_enforced():
    grades = [[
        cg("CS 201", "A"),
        cg("CS 204", "A"),
        cg("CS 300", "A"),
        cg("CS 301", "A"),
        cg("CS 302", "A"),
        cg("CS 303", "A"),
        cg("CS 308", "A"),
    ]]

    with pytest.raises(ValueError, match="exceeding the limit of 20.0"):
        gpa_service.calculate_gpa_summary_from_letter_grades(grades)


def test_grade_helpers_normalize_existing_letter_grades_only():
    assert gpa_service.grade_to_points(" b+ ") == 3.3
    assert gpa_service.grade_to_points("Select") is None


def test_legacy_numeric_gpa_calculation_is_unchanged():
    taken_courses = [
        TakenCourse(code="CS 201", credits=3, grade=4.0),
        TakenCourse(code="CS 204", credits=3, grade=3.0),
    ]

    # Manual: (3*4.0 + 3*3.0) / 6 = 3.5.
    assert gpa_service.calculate_gpa(taken_courses) == 3.5
    assert gpa_service.calculate_gpa([]) == 0.0
