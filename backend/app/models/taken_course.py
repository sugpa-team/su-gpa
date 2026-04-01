from pydantic import BaseModel


class TakenCourse(BaseModel):
    code: str
    credits: int
    grade: float


class TakenCourseCreateRequest(BaseModel):
    course_code: str
    grade: str


class CourseGrade(BaseModel):
    course: str
    grade: str


class CalculateGpaRequest(BaseModel):
    grades: list[list[CourseGrade]]


class TakenCourseRecord(BaseModel):
    id: int
    course_code: str
    grade: str
