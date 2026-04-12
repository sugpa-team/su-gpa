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


class SemesterCreateRequest(BaseModel):
    name: str


class SemesterCourseCreateRequest(BaseModel):
    course_code: str
    grade: str | None = None


class CourseCreateRequest(SemesterCourseCreateRequest):
    semester_id: int


class SemesterCourseGradeUpdateRequest(BaseModel):
    grade: str | None = None


class SemesterCourseRecord(BaseModel):
    id: int
    semester_id: int
    course_code: str
    course_name: str | None = None
    su_credits: float
    grade: str | None = None
    grade_points: float | None = None


class SemesterRecord(BaseModel):
    id: int
    name: str
    total_su_credits: float
    gpa: float
    courses: list[SemesterCourseRecord]


class SemestersSummaryResponse(BaseModel):
    semesters: list[SemesterRecord]
    cumulative_gpa: float
    max_semester_su_credits: float
    semester_gpa: dict[int, float]
    cgpa: float


class GpaResponse(BaseModel):
    semester_gpa: dict[int, float]
    cgpa: float
    semesters: list[SemesterRecord]
    cumulative_gpa: float
    max_semester_su_credits: float


class CalculateGpaResponse(BaseModel):
    gpa: float
    cumulative_gpa: float
    semester_gpas: list[float]
    semester_su_credits: list[float]
    max_semester_su_credits: float
