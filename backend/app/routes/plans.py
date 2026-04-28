"""HTTP routes for next-semester plans (CRUD + promote-to-semester)."""
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import plan_service

router = APIRouter()


class SectionEntry(BaseModel):
    course_code: str
    crn: str
    class_index: int = 0
    expected_grade: str | None = None


class PlanCreateRequest(BaseModel):
    term: str
    name: str
    sections: list[SectionEntry] = []


class PlanUpdateRequest(BaseModel):
    name: str | None = None
    sections: list[SectionEntry] | None = None


def _to_dicts(sections: list[SectionEntry] | None) -> list[dict[str, Any]] | None:
    if sections is None:
        return None
    return [s.model_dump() for s in sections]


@router.get("")
def list_all_plans(term: str | None = None) -> dict:
    return {"plans": plan_service.list_plans(term)}


@router.get("/{plan_id}")
def get_plan(plan_id: int) -> dict:
    try:
        return plan_service.get_plan(plan_id)
    except LookupError as e:
        raise HTTPException(404, detail=str(e))


@router.post("", status_code=201)
def create_plan(payload: PlanCreateRequest) -> dict:
    try:
        return plan_service.create_plan(
            payload.term, payload.name, _to_dicts(payload.sections) or []
        )
    except ValueError as e:
        raise HTTPException(400, detail=str(e))


@router.patch("/{plan_id}")
def update_plan(plan_id: int, payload: PlanUpdateRequest) -> dict:
    try:
        return plan_service.update_plan(
            plan_id,
            name=payload.name,
            sections=_to_dicts(payload.sections),
        )
    except LookupError as e:
        raise HTTPException(404, detail=str(e))
    except ValueError as e:
        raise HTTPException(400, detail=str(e))


@router.delete("/{plan_id}", status_code=204)
def delete_plan(plan_id: int) -> None:
    try:
        plan_service.delete_plan(plan_id)
    except LookupError as e:
        raise HTTPException(404, detail=str(e))


@router.post("/{plan_id}/promote-to-semester")
def promote_plan_to_semester(plan_id: int) -> dict:
    """Materialize the plan as a real semester in the GPA Calculator.
    Returns the new (or matched) semester id, counts, per-course skip
    reasons, and the refreshed semesters summary.
    """
    try:
        return plan_service.promote_plan_to_semester(plan_id)
    except LookupError as e:
        raise HTTPException(404, detail=str(e))
