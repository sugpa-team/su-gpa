from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import course_feedback_service

router = APIRouter()


class CourseFeedbackRequest(BaseModel):
    difficulty: str
    workload: str
    grading_style: str
    recommendation: str
    note: str | None = ""


def _raise_http_error(error: Exception) -> None:
    if isinstance(error, LookupError):
        raise HTTPException(status_code=404, detail=str(error)) from error
    raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("")
def list_feedback() -> dict:
    return {"feedback": course_feedback_service.list_feedback()}


@router.get("/summary")
def list_feedback_summaries() -> dict:
    return {"summaries": course_feedback_service.build_feedback_summaries()}


@router.get("/recommendations")
def get_recommendations(term: str, limit: int = 8) -> dict:
    try:
        return course_feedback_service.build_recommendations(term, limit)
    except (LookupError, ValueError) as error:
        _raise_http_error(error)


@router.get("/{course_code:path}")
def get_feedback(course_code: str) -> dict:
    try:
        return course_feedback_service.get_feedback(course_code)
    except (LookupError, ValueError) as error:
        _raise_http_error(error)


@router.put("/{course_code:path}")
def upsert_feedback(course_code: str, payload: CourseFeedbackRequest) -> dict:
    try:
        return course_feedback_service.upsert_feedback(
            course_code,
            payload.difficulty,
            payload.workload,
            payload.grading_style,
            payload.recommendation,
            payload.note,
        )
    except (LookupError, ValueError) as error:
        _raise_http_error(error)


@router.delete("/{course_code:path}", status_code=204)
def delete_feedback(course_code: str) -> None:
    try:
        course_feedback_service.delete_feedback(course_code)
    except (LookupError, ValueError) as error:
        _raise_http_error(error)
