from fastapi import APIRouter, HTTPException

from app.services import plan_service
from app.services.schedule_service import (
    get_course_schedule,
    get_planner_courses,
    get_term_schedule,
    list_available_terms,
)
from app.services.taken_course_service import (
    _course_catalog,
    _prerequisites_by_course,
    get_category_membership,
    get_retake_eligibility,
    get_taken_course_codes,
)

router = APIRouter()


@router.get("/terms")
def list_terms() -> dict:
    return {"terms": list_available_terms()}


@router.get("/{term}")
def get_schedule(term: str) -> dict:
    try:
        return get_term_schedule(term)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/{term}/courses/{course_code}")
def get_course(term: str, course_code: str) -> dict:
    try:
        return get_course_schedule(term, course_code)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/{term}/planner")
def get_planner_view(term: str) -> dict:
    """Schedule + catalog credits + prereqs + requirement-category
    membership + the user's already-taken courses, in one call. The
    frontend planner uses this to render section pickers, tally credits,
    and warn about missing prereqs."""
    try:
        courses = get_planner_courses(
            term,
            _course_catalog(),
            _prerequisites_by_course(),
            get_category_membership(),
        )
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

    promote_semester_name = plan_service.resolve_promote_semester_name(term)
    retake_eligibility = get_retake_eligibility(promote_semester_name)
    for course in courses:
        retake_status = retake_eligibility.get(" ".join(str(course.get("code", "")).upper().split()))
        if retake_status:
            course["retake_allowed"] = retake_status["can_retake"]
            course["retake_reason"] = retake_status["reason"]
            course["last_taken_term"] = retake_status["last_taken_term"]

    return {
        "term": term,
        "promote_semester_name": promote_semester_name,
        "taken_course_codes": sorted(get_taken_course_codes()),
        "courses": courses,
    }
