from fastapi import APIRouter, Request, Response

from app.models.taken_course import (
    CalculateGpaRequest,
    TakenCourse,
    TakenCourseCreateRequest,
    TakenCourseRecord,
)
from app.services.gpa_service import calculate_gpa, calculate_gpa_from_letter_grades
from app.services.taken_course_service import (
    add_taken_course,
    build_taken_courses_cookie,
    get_taken_courses,
)

router = APIRouter()


@router.get("/", response_model=list[TakenCourseRecord])
def list_taken_courses() -> list[TakenCourseRecord]:
    return [TakenCourseRecord(**course) for course in get_taken_courses()]


@router.post("/gpa")
def gpa_from_taken_courses(taken_courses: list[TakenCourse]) -> dict[str, float]:
    return {"gpa": calculate_gpa(taken_courses)}


@router.post("/add-taken-course", status_code=201)
def create_taken_course(
    payload: TakenCourseCreateRequest,
    request: Request,
    response: Response,
) -> dict[str, str]:
    add_taken_course(payload.course_code, payload.grade)

    cookie_value = build_taken_courses_cookie(
        request.cookies.get("taken_courses"),
        payload.course_code,
        payload.grade,
    )
    response.set_cookie(
        "taken_courses",
        cookie_value,
        max_age=31536000,
        samesite="lax",
        secure=False,
    )

    return {"message": "Course added successfully"}


@router.post("/calculate-gpa")
def calculate_gpa_from_grade_list(payload: CalculateGpaRequest) -> dict[str, float]:
    return {"gpa": calculate_gpa_from_letter_grades(payload.grades)}
