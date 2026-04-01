from app.models.taken_course import CourseGrade, TakenCourse
from app.utils.loader import load_courses

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


def calculate_gpa(taken_courses: list[TakenCourse]) -> float:
    total_credits = sum(course.credits for course in taken_courses)
    if total_credits == 0:
        return 0.0

    weighted_sum = sum(course.grade * course.credits for course in taken_courses)
    return round(weighted_sum / total_credits, 2)


def calculate_gpa_from_letter_grades(grades: list[list[CourseGrade]]) -> float:
    courses = load_courses()
    su_credits_by_code = {
        course["Course"]: float(course["SU Credits"])
        for course in courses
        if course.get("Course") and course.get("SU Credits") is not None
    }

    course_grades: dict[str, dict[str, float]] = {}
    for semester in grades:
        for course in semester:
            course_code = course.course
            grade = course.grade

            if not course_code or grade == "Select":
                continue

            if grade not in LETTER_GRADE_POINTS:
                continue

            credits = su_credits_by_code.get(course_code)
            if credits is None:
                continue

            course_grades[course_code] = {
                "credits": credits,
                "grade": LETTER_GRADE_POINTS[grade],
            }

    total_credits = sum(course["credits"] for course in course_grades.values())
    if total_credits == 0:
        return 0.0

    total_grade_points = sum(
        course["credits"] * course["grade"] for course in course_grades.values()
    )
    return round(total_grade_points / total_credits, 3)
