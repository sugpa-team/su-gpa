from pydantic import BaseModel, ConfigDict, Field


class Course(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    course: str = Field(alias="Course")
    name: str = Field(alias="Name")
    ects_credits: float = Field(alias="ECTS Credits")
    su_credits: float = Field(alias="SU Credits")
    faculty: str = Field(alias="Faculty")
