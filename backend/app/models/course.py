from pydantic import BaseModel, ConfigDict, Field


class Course(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    course: str = Field(alias="Course")
    name: str = Field(alias="Name")
    ects_credits: float | None = Field(alias="ECTS Credits", default=None)
    su_credits: float | None = Field(alias="SU Credits", default=None)
    faculty: str | None = Field(alias="Faculty", default=None)
