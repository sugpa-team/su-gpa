from pydantic import BaseModel


class TakenCourse(BaseModel):
    code: str
    credits: int
    grade: float
