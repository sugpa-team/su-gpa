from app.models.taken_course import TakenCourse


def calculate_gpa(taken_courses: list[TakenCourse]) -> float:
    total_credits = sum(course.credits for course in taken_courses)
    if total_credits == 0:
        return 0.0

    weighted_sum = sum(course.grade * course.credits for course in taken_courses)
    return round(weighted_sum / total_credits, 2)
