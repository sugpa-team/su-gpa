from fastapi import APIRouter

from app.models.taken_course import TakenCourse
from app.services.gpa_service import calculate_gpa

router = APIRouter()


@router.post("/gpa")
def gpa_from_taken_courses(taken_courses: list[TakenCourse]) -> dict[str, float]:
    return {"gpa": calculate_gpa(taken_courses)}
