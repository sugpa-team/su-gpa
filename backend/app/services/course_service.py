from app.models.course import Course
from app.utils.loader import load_courses


def get_courses() -> list[dict]:
    courses = load_courses()
    return [Course(**course).model_dump() for course in courses]
