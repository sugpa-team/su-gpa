from pydantic import BaseModel
from pydantic import Field


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
    ects_credits: float | None = None
    grade: str | None = None
    grade_points: float | None = None
    is_overload: bool = False


class SemesterRecord(BaseModel):
    id: int
    name: str
    total_su_credits: float
    gpa: float
    courses: list[SemesterCourseRecord]
    eligible_course_codes: list[str] = Field(default_factory=list)
    overload_course_count: int = 0
    notes: list[str] = Field(default_factory=list)


class SemestersSummaryResponse(BaseModel):
    semesters: list[SemesterRecord]
    cumulative_gpa: float
    max_semester_su_credits: float
    semester_gpa: dict[int, float]
    cgpa: float
    total_planned_su_credits: float
    total_planned_ects_credits: float
    program_required_su_credits: float | None = None
    program_required_ects_credits: float | None = None


class GpaResponse(BaseModel):
    semester_gpa: dict[int, float]
    cgpa: float
    semesters: list[SemesterRecord]
    cumulative_gpa: float
    max_semester_su_credits: float
    total_planned_su_credits: float
    total_planned_ects_credits: float
    program_required_su_credits: float | None = None
    program_required_ects_credits: float | None = None


class GraduationCategoryProgress(BaseModel):
    category: str
    required_su: float | None = None
    required_ects: float | None = None
    required_courses: int | None = None
    completed_su: float | None = None
    completed_ects: float | None = None
    completed_courses: int | None = None
    remaining_su: float | None = None
    remaining_ects: float | None = None
    remaining_courses: int | None = None
    progress_percent: float | None = None


class GraduationRequirementsProgressResponse(BaseModel):
    categories: list[GraduationCategoryProgress]


class BannerwebAnalyzeRequest(BaseModel):
    raw_text: str


class CalculateGpaResponse(BaseModel):
    gpa: float
    cumulative_gpa: float
    semester_gpas: list[float]
    semester_su_credits: list[float]
    max_semester_su_credits: float
