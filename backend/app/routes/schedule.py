from fastapi import APIRouter, HTTPException

from app.services.schedule_service import (
    get_course_schedule,
    get_term_schedule,
    list_available_terms,
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
