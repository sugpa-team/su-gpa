from fastapi import APIRouter, HTTPException

from app.models.profile import (
    ProfileUpdateRequest,
    ProfileUpdateResponse,
    ProgramsResponse,
    UserProfileRecord,
)
from app.services.profile_service import get_profile, get_programs, update_profile

router = APIRouter()


def _raise_http_error(error: Exception) -> None:
    if isinstance(error, LookupError):
        raise HTTPException(status_code=404, detail=str(error)) from error
    raise HTTPException(status_code=400, detail=str(error)) from error


@router.get("/programs", response_model=ProgramsResponse)
def list_programs() -> dict:
    return {"programs": get_programs()}


@router.get("/profile", response_model=UserProfileRecord)
def get_user_profile() -> dict:
    return get_profile()


@router.patch("/profile", response_model=ProfileUpdateResponse)
def patch_user_profile(payload: ProfileUpdateRequest) -> dict:
    try:
        return update_profile(payload.faculty, payload.program_id, payload.entry_term)
    except (LookupError, ValueError) as error:
        _raise_http_error(error)
