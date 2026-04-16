from pydantic import BaseModel


class ProgramRecord(BaseModel):
    id: int
    faculty: str
    department: str
    program_name: str


class ProgramsResponse(BaseModel):
    programs: list[ProgramRecord]


class UserProfileRecord(BaseModel):
    faculty: str | None = None
    program_id: int | None = None
    program_name: str | None = None
    entry_term: str | None = None


class ProfileUpdateRequest(BaseModel):
    faculty: str
    program_id: int
    entry_term: str


class ProfileUpdateResponse(BaseModel):
    profile: UserProfileRecord
    tracking_reset: bool
