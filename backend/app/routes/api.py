from fastapi import APIRouter, HTTPException

from app.models.taken_course import (
    BannerwebAnalyzeRequest,
    CourseCreateRequest,
    GpaResponse,
    GraduationRequirementsProgressResponse,
    ProgressResponse,
    SemesterCourseGradeUpdateRequest,
    SemestersSummaryResponse,
)
from app.services.bannerweb_degree_eval_parser import parse_bannerweb_degree_evaluation
from app.services.taken_course_service import (
    add_course_to_semester,
    delete_course_record,
    get_graduation_requirements_progress,
    get_progress_summary,
    get_requirements_course_catalog,
    get_semesters_summary,
    import_bannerweb_parse_result,
    update_course_record,
)

router = APIRouter()


def _raise_http_error(error: Exception) -> None:
    if isinstance(error, LookupError):
        raise HTTPException(status_code=404, detail=str(error)) from error
    raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/progress", response_model=ProgressResponse)
def get_progress() -> dict:
    return get_progress_summary()


@router.get("/gpa", response_model=GpaResponse)
def get_gpa() -> dict:
    return get_semesters_summary()


@router.get(
    "/graduation-requirements",
    response_model=GraduationRequirementsProgressResponse,
)
def get_graduation_requirements() -> dict:
    return get_graduation_requirements_progress()


@router.get("/graduation-requirements/catalog")
def get_graduation_requirements_catalog() -> dict:
    return get_requirements_course_catalog()


@router.post("/bannerweb/analyze")
def analyze_bannerweb_degree_evaluation(payload: BannerwebAnalyzeRequest) -> dict:
    raw_text = (payload.raw_text or "").strip()
    if not raw_text:
        raise HTTPException(status_code=400, detail="Pasted text is empty.")
    return parse_bannerweb_degree_evaluation(raw_text)


@router.post("/bannerweb/import")
def import_bannerweb_degree_evaluation(payload: BannerwebAnalyzeRequest) -> dict:
    raw_text = (payload.raw_text or "").strip()
    if not raw_text:
        raise HTTPException(status_code=400, detail="Pasted text is empty.")
    parsed = parse_bannerweb_degree_evaluation(raw_text)
    try:
        return import_bannerweb_parse_result(parsed)
    except (LookupError, ValueError) as error:
        _raise_http_error(error)


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
