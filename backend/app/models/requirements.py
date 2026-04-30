from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class CompletedCourse(BaseModel):
    code: str
    su_credits: float
    ects_credits: float | None = None
    grade: str | None = None
    faculty: str = ""
    bannerweb_category: str | None = None
    engineering_ects: float = 0.0
    basic_science_ects: float = 0.0


class CategoryMatchResult(BaseModel):
    id: str
    name: str
    status: Literal["SATISFIED", "IN_PROGRESS", "NOT_STARTED"]
    credits_completed: float
    credits_required: float | None
    courses_completed: int
    courses_required: int | None
    completed_course_codes: list[str]
    remaining_course_codes: list[str]
    progress_pct: float | None


class MatchResult(BaseModel):
    categories: list[CategoryMatchResult]
    overall_completion_pct: float
    total_credits_completed: float
    total_credits_required: float | None
    cgpa: float
    meets_minimum_gpa: bool
