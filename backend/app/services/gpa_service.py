from app.models.taken_course import CourseGrade, TakenCourse
from app.utils.loader import load_courses

MAX_SEMESTER_SU_CREDITS = 20.0
UNGRADED_VALUES = {"", "Select", None}

LETTER_GRADE_POINTS = {
    "A": 4.0,
    "A-": 3.7,
    "B+": 3.3,
    "B": 3.0,
    "B-": 2.7,
    "C+": 2.3,
    "C": 2.0,
    "C-": 1.7,
    "D+": 1.3,
    "D": 1.0,
    "F": 0.0,
}

COURSE_CODE_ALIASES = {
    "CS 210": "DSA 210 / CS 210",
    "DSA 210": "DSA 210 / CS 210",
}


def normalize_letter_grade(grade: str | None) -> str | None:
    if grade in UNGRADED_VALUES:
        return None

    normalized_grade = grade.strip() if grade else ""
    if not normalized_grade or normalized_grade.lower() == "select":
        return None

    normalized_grade = normalized_grade.upper()
    if normalized_grade not in LETTER_GRADE_POINTS:
        raise ValueError(f"Invalid letter grade: {grade}")

    return normalized_grade


def grade_to_points(grade: str | None) -> float | None:
    normalized_grade = normalize_letter_grade(grade)
    if normalized_grade is None:
        return None
    return LETTER_GRADE_POINTS[normalized_grade]


def _calculate_weighted_gpa(weighted_courses: list[tuple[float, float]]) -> float | None:
    total_credits = sum(credits for credits, _ in weighted_courses)
    if total_credits == 0:
        return None

    total_grade_points = sum(
        credits * grade_points for credits, grade_points in weighted_courses
    )
    return round(total_grade_points / total_credits, 3)


def _su_credits_by_course_code() -> dict[str, float]:
    courses = load_courses()
    return {
        COURSE_CODE_ALIASES.get(course["Course"], course["Course"]): float(course["SU Credits"])
        for course in courses
        if course.get("Course") and course.get("SU Credits") is not None
    }


def calculate_gpa(taken_courses: list[TakenCourse]) -> float:
    total_credits = sum(course.credits for course in taken_courses)
    if total_credits == 0:
        return 0.0

    weighted_sum = sum(course.grade * course.credits for course in taken_courses)
    return round(weighted_sum / total_credits, 2)


def calculate_gpa_from_letter_grades(grades: list[list[CourseGrade]]) -> float | None:
    return calculate_gpa_summary_from_letter_grades(grades)["cumulative_gpa"]


def calculate_gpa_summary_from_letter_grades(
    grades: list[list[CourseGrade]],
) -> dict[str, object]:
    su_credits_by_code = _su_credits_by_course_code()
    semester_gpas: list[float | None] = []
    semester_su_credits: list[float] = []
    latest_weighted_by_course: dict[str, tuple[float, float]] = {}

    for semester in grades:
        semester_codes: set[str] = set()
        semester_credits = 0.0
        semester_weighted_courses: list[tuple[float, float]] = []

        for course in semester:
            course_code = " ".join(course.course.upper().split())
            course_code = COURSE_CODE_ALIASES.get(course_code, course_code)
            if not course_code:
                continue

            if course_code in semester_codes:
                raise ValueError(f"Course already exists in this semester: {course_code}")
            semester_codes.add(course_code)

            credits = su_credits_by_code.get(course_code)
            if credits is None:
                raise ValueError(f"Unknown course or missing SU credits: {course_code}")

            semester_credits += credits
            if semester_credits > MAX_SEMESTER_SU_CREDITS:
                raise ValueError(
                    f"{course_code} cannot be added. Semester SU credits would be "
                    f"{semester_credits}, exceeding the limit of "
                    f"{MAX_SEMESTER_SU_CREDITS}."
                )

            grade_points = grade_to_points(course.grade)
            if grade_points is None:
                continue

            weighted_course = (credits, grade_points)
            semester_weighted_courses.append(weighted_course)
            # Retaken courses count once in cumulative GPA with the latest attempt.
            latest_weighted_by_course[course_code] = weighted_course

        semester_su_credits.append(round(semester_credits, 2))
        semester_gpas.append(_calculate_weighted_gpa(semester_weighted_courses))

    cumulative_gpa = _calculate_weighted_gpa(list(latest_weighted_by_course.values()))
    return {
        "gpa": cumulative_gpa,
        "cumulative_gpa": cumulative_gpa,
        "semester_gpas": semester_gpas,
        "semester_su_credits": semester_su_credits,
        "max_semester_su_credits": MAX_SEMESTER_SU_CREDITS,
    }
