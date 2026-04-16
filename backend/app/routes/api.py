from fastapi import APIRouter, HTTPException

from app.models.taken_course import (
    CourseCreateRequest,
    GpaResponse,
    GraduationRequirementsProgressResponse,
    SemesterCourseGradeUpdateRequest,
    SemestersSummaryResponse,
)
from app.services.taken_course_service import (
    add_course_to_semester,
    delete_course_record,
    get_graduation_requirements_progress,
    get_semesters_summary,
    update_course_record,
)

router = APIRouter()


def _raise_http_error(error: Exception) -> None:
    if isinstance(error, LookupError):
        raise HTTPException(status_code=404, detail=str(error)) from error
    raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/gpa", response_model=GpaResponse)
def get_gpa() -> dict:
    return get_semesters_summary()


@router.get(
    "/graduation-requirements",
    response_model=GraduationRequirementsProgressResponse,
)
def get_graduation_requirements() -> dict:
    return get_graduation_requirements_progress()


@router.post("/courses", response_model=SemestersSummaryResponse, status_code=201)
def create_course(payload: CourseCreateRequest) -> dict:
    try:
        return add_course_to_semester(
            payload.semester_id,
            payload.course_code,
            payload.grade,
        )
    except (LookupError, ValueError) as error:
        _raise_http_error(error)


@router.patch("/courses/{course_id}", response_model=SemestersSummaryResponse)
def update_course(
    course_id: int,
    payload: SemesterCourseGradeUpdateRequest,
) -> dict:
    try:
        return update_course_record(course_id, payload.grade)
    except (LookupError, ValueError) as error:
        _raise_http_error(error)


@router.delete("/courses/{course_id}", response_model=SemestersSummaryResponse)
def delete_course(course_id: int) -> dict:
    try:
        return delete_course_record(course_id)
    except (LookupError, ValueError) as error:
        _raise_http_error(error)
