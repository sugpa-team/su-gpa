from app.models.taken_course import CourseGrade


def _course(course: str, grade: str):
    return CourseGrade(course=course, grade=grade)


def test_standard_semester_gpa_and_cgpa(gpa_engine):
    result = gpa_engine.calculate_gpa_summary_from_letter_grades(
        [[
            _course("GPA 101", "A"),
            _course("GPA 102", "B"),
            _course("GPA 103", "A-"),
            _course("GPA 104", "C"),
        ]]
    )

    # (3*4.0 + 3*3.0 + 3*3.7 + 3*2.0) / 12 = 3.175
    assert result["semester_gpas"] == [3.175]
    assert result["cumulative_gpa"] == 3.175


def test_mixed_grades_weighted_average(gpa_engine):
    result = gpa_engine.calculate_gpa_summary_from_letter_grades(
        [[
            _course("GPA 101", "A"),
            _course("GPA 102", "B"),
            _course("GPA 103", "C"),
            _course("GPA 104", "F"),
        ]]
    )

    # (3*4.0 + 3*3.0 + 3*2.0 + 3*0.0) / 12 = 2.25
    assert result["semester_gpas"] == [2.25]
    assert result["cumulative_gpa"] == 2.25


def test_multi_semester_cgpa(gpa_engine):
    result = gpa_engine.calculate_gpa_summary_from_letter_grades(
        [
            [_course("GPA 101", "A"), _course("GPA 102", "B")],
            [_course("GPA 103", "A-"), _course("GPA 104", "C+")],
            [_course("GPA 105", "B+"), _course("GPA 106", "A")],
        ]
    )

    # ((3*4.0 + 3*3.0) + (3*3.7 + 3*2.3) + (4*3.3 + 2*4.0)) / 18 = 3.344...
    assert result["semester_gpas"] == [3.5, 3.0, 3.533]
    assert result["cumulative_gpa"] == 3.344


def test_high_performer_has_exact_four_point_zero(gpa_engine):
    result = gpa_engine.calculate_gpa_summary_from_letter_grades(
        [
            [_course("GPA 101", "A"), _course("GPA 102", "A")],
            [_course("GPA 103", "A"), _course("GPA 104", "A")],
        ]
    )

    # All included credits are multiplied by 4.0, so CGPA stays exactly 4.0
    assert result["semester_gpas"] == [4.0, 4.0]
    assert result["cumulative_gpa"] == 4.0


def test_failing_semester_has_zero_gpa(gpa_engine):
    result = gpa_engine.calculate_gpa_summary_from_letter_grades(
        [[
            _course("GPA 101", "F"),
            _course("GPA 102", "F"),
            _course("GPA 103", "F"),
        ]]
    )

    # (3*0 + 3*0 + 3*0) / 9 = 0.0
    assert result["semester_gpas"] == [0.0]
    assert result["cumulative_gpa"] == 0.0


def test_mixed_gpa_and_non_gpa_course_excludes_select_grade(gpa_engine):
    result = gpa_engine.calculate_gpa_summary_from_letter_grades(
        [[
            _course("GPA 101", "A"),
            _course("GPA 102", "Select"),
        ]]
    )

    # Only GPA 101 counts: (3*4.0) / 3 = 4.0
    assert result["semester_gpas"] == [4.0]
    assert result["cumulative_gpa"] == 4.0
    assert result["semester_su_credits"] == [6.0]


def test_single_course_bb_equivalent_uses_supported_b_grade(gpa_engine):
    result = gpa_engine.calculate_gpa_summary_from_letter_grades(
        [[_course("GPA 101", "B")]]
    )

    # One 3-credit B course: (3*3.0) / 3 = 3.0
    assert result["semester_gpas"] == [3.0]
    assert result["cumulative_gpa"] == 3.0


def test_zero_credit_course_does_not_affect_cgpa_denominator(gpa_engine):
    result = gpa_engine.calculate_gpa_summary_from_letter_grades(
        [[
            _course("GPA 101", "A"),
            _course("ZERO 100", "F"),
        ]]
    )

    # ZERO 100 has 0 credits, so only GPA 101 counts: (3*4.0) / 3 = 4.0
    assert result["semester_gpas"] == [4.0]
    assert result["cumulative_gpa"] == 4.0
    assert result["semester_su_credits"] == [3.0]


def test_repeated_course_uses_latest_attempt_for_cumulative_gpa(gpa_engine):
    result = gpa_engine.calculate_gpa_summary_from_letter_grades(
        [
            [_course("REPEAT 101", "F")],
            [_course("REPEAT 101", "A")],
        ]
    )

    # Latest attempt policy keeps only the second 3-credit A in CGPA: (3*4.0) / 3 = 4.0
    assert result["semester_gpas"] == [0.0, 4.0]
    assert result["cumulative_gpa"] == 4.0


def test_non_gpa_only_semester_returns_zero_in_current_engine(gpa_engine):
    result = gpa_engine.calculate_gpa_summary_from_letter_grades(
        [[
            _course("GPA 101", "Select"),
            _course("GPA 102", "Select"),
        ]]
    )

    # No GPA-affecting grades are present, so the current engine returns 0.0
    assert result["semester_gpas"] == [0.0]
    assert result["cumulative_gpa"] == 0.0
