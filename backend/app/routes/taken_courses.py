from fastapi import APIRouter, HTTPException, Request, Response

from app.models.taken_course import (
    CalculateGpaResponse,
    CalculateGpaRequest,
    SemesterCourseCreateRequest,
    SemesterCourseGradeUpdateRequest,
    SemesterCreateRequest,
    SemestersSummaryResponse,
    TakenCourse,
    TakenCourseCreateRequest,
    TakenCourseRecord,
)
from app.services.gpa_service import calculate_gpa, calculate_gpa_summary_from_letter_grades
from app.services.taken_course_service import (
    add_taken_course,
    add_course_to_semester,
    build_taken_courses_cookie,
    create_semester,
    delete_course_from_semester,
    delete_semester,
    get_semesters_summary,
    get_taken_courses,
    update_semester_course_grade,
)

router = APIRouter()


def _raise_http_error(error: Exception) -> None:
    if isinstance(error, LookupError):
        raise HTTPException(status_code=404, detail=str(error)) from error
    raise HTTPException(status_code=400, detail=str(error)) from error


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


@router.get("/semesters", response_model=SemestersSummaryResponse)
def list_semesters() -> dict:
    return get_semesters_summary()


@router.post("/semesters", response_model=SemestersSummaryResponse, status_code=201)
def create_semester_plan(payload: SemesterCreateRequest) -> dict:
    try:
        return create_semester(payload.name)
    except (LookupError, ValueError) as error:
        _raise_http_error(error)


@router.delete("/semesters/{semester_id}", status_code=204)
def remove_semester(semester_id: int) -> Response:
    try:
        delete_semester(semester_id)
    except (LookupError, ValueError) as error:
        _raise_http_error(error)

    return Response(status_code=204)


@router.post(
    "/semesters/{semester_id}/courses",
    response_model=SemestersSummaryResponse,
    status_code=201,
)
def create_semester_course(
    semester_id: int,
    payload: SemesterCourseCreateRequest,
) -> dict:
    try:
        return add_course_to_semester(
            semester_id,
            payload.course_code,
            payload.grade,
        )
    except (LookupError, ValueError) as error:
        _raise_http_error(error)


@router.patch(
    "/semesters/{semester_id}/courses/{course_code}/grade",
    response_model=SemestersSummaryResponse,
)
def update_semester_course_letter_grade(
    semester_id: int,
    course_code: str,
    payload: SemesterCourseGradeUpdateRequest,
) -> dict:
    try:
        return update_semester_course_grade(semester_id, course_code, payload.grade)
    except (LookupError, ValueError) as error:
        _raise_http_error(error)


@router.delete(
    "/semesters/{semester_id}/courses/{course_code}",
    response_model=SemestersSummaryResponse,
)
def remove_semester_course(semester_id: int, course_code: str) -> dict:
    try:
        return delete_course_from_semester(semester_id, course_code)
    except (LookupError, ValueError) as error:
        _raise_http_error(error)


@router.post("/calculate-gpa", response_model=CalculateGpaResponse)
def calculate_gpa_from_grade_list(payload: CalculateGpaRequest) -> dict:
    try:
        return calculate_gpa_summary_from_letter_grades(payload.grades)
    except ValueError as error:
        _raise_http_error(error)
