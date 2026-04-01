from fastapi import APIRouter

from app.services.course_service import get_courses

router = APIRouter()


@router.get("/")
def list_courses() -> list[dict]:
    return get_courses()
