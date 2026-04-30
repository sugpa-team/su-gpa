from __future__ import annotations

from app.models.requirements import CategoryMatchResult, CompletedCourse, MatchResult
from app.services.gpa_service import grade_to_points

_MIN_GRADUATION_GPA = 2.0
_FREE_ELECTIVE_FACULTIES = frozenset({"FASS", "SBS", "FENS"})
_BANNERWEB_CATEGORY_NAMES = frozenset({
    "University Courses", "Required Courses", "Core Electives",
    "Area Electives", "Free Electives",
})
# Categories where the eligible pool is larger than what's already assigned
# (student picks N credits from a pool, so "remaining" = pool minus taken)
_POOL_CATEGORIES = frozenset({"Core Electives", "Area Electives"})
# Categories with a fixed required list (remaining = required minus taken)
_FIXED_LIST_CATEGORIES = frozenset({"University Courses", "Required Courses", "Faculty Courses"})


def _normalize_code(code: str) -> str:
    normalized = " ".join(code.upper().split())
    alias_map = {
        "CS 210": "DSA 210 / CS 210",
        "DSA 210": "DSA 210 / CS 210",
    }
    return alias_map.get(normalized, normalized)


def _extract_codes(value: object) -> set[str]:
    codes: set[str] = set()
    if isinstance(value, dict):
        raw = value.get("course")
        if raw:
            codes.add(_normalize_code(str(raw)))
        for v in value.values():
            codes.update(_extract_codes(v))
    elif isinstance(value, list):
        for item in value:
            codes.update(_extract_codes(item))
    return codes


def _min_su_per_category(category_requirements: list[dict]) -> dict[str, float]:
    return {
        item["category"]: float(item["min_su"])
        for item in category_requirements
        if isinstance(item, dict)
        and item.get("category")
        and item.get("min_su") is not None
    }


def _safe_progress_pct(completed: float, required: float) -> float | None:
    if required <= 0:
        return None
    return round(min(100.0, (completed / required) * 100.0), 1)


def _compute_cgpa(courses: list[CompletedCourse]) -> float:
    total_credits = 0.0
    total_points = 0.0
    for c in courses:
        points = grade_to_points(c.grade)
        if points is None:
            continue
        total_credits += c.su_credits
        total_points += c.su_credits * points
    if total_credits == 0:
        return 0.0
    return round(total_points / total_credits, 3)


def _allocate_categories(
    courses: list[CompletedCourse],
    category_definitions: dict,
    faculty_course_codes: set[str],
    min_su: dict[str, float],
) -> dict[str, set[str]]:
    """Assign each completed course to exactly one graduation category.

    Priority order: University/Required (fixed lists) → Core Electives →
    Area Electives → Free Electives. BannerWeb-imported categories are
    trusted and skip re-assignment. A course is removed from the pool once
    assigned so it can never be counted twice.
    """
    university_codes = _extract_codes(category_definitions.get("University Courses", {}))
    required_codes = _extract_codes(category_definitions.get("Required Courses", []))
    core_codes = _extract_codes(category_definitions.get("Core Electives", []))
    area_codes = _extract_codes(category_definitions.get("Area Electives", []))
    fixed_codes = university_codes | required_codes

    faculty_by_code: dict[str, str] = {_normalize_code(c.code): c.faculty.upper() for c in courses}
    su_by_code: dict[str, float] = {_normalize_code(c.code): c.su_credits for c in courses}
    ordered_codes: list[str] = [_normalize_code(c.code) for c in courses]

    # BannerWeb-assigned categories take precedence over computed ones
    bannerweb_allocated: dict[str, set[str]] = {cat: set() for cat in _BANNERWEB_CATEGORY_NAMES}
    for c in courses:
        if c.bannerweb_category in bannerweb_allocated:
            bannerweb_allocated[c.bannerweb_category].add(_normalize_code(c.code))
    bannerweb_assigned: set[str] = set().union(*bannerweb_allocated.values())

    assigned: set[str] = set(bannerweb_assigned)
    assigned.update(
        code for code in ordered_codes
        if code in fixed_codes and code not in bannerweb_assigned
    )

    def allocate_until_satisfied(candidates: list[str], required_su: float | None) -> set[str]:
        allocated: set[str] = set()
        completed_su = 0.0
        for code in candidates:
            if code in assigned:
                continue
            if required_su is not None and completed_su >= required_su:
                break
            allocated.add(code)
            assigned.add(code)
            completed_su += su_by_code.get(code, 0.0)
        return allocated

    core_allocated = set(bannerweb_allocated["Core Electives"])
    core_allocated.update(allocate_until_satisfied(
        [c for c in ordered_codes if c in core_codes and c not in fixed_codes],
        min_su.get("Core Electives"),
    ))

    area_allocated = set(bannerweb_allocated["Area Electives"])
    area_allocated.update(allocate_until_satisfied(
        [c for c in ordered_codes if c in (area_codes | core_codes) and c not in fixed_codes],
        min_su.get("Area Electives"),
    ))

    free_allocated: set[str] = {
        code for code in ordered_codes
        if code not in assigned
        and code not in fixed_codes
        and faculty_by_code.get(code, "") in _FREE_ELECTIVE_FACULTIES
    }
    free_allocated.update(bannerweb_allocated["Free Electives"])

    return {
        "University Courses": university_codes | bannerweb_allocated["University Courses"],
        "Required Courses": required_codes | bannerweb_allocated["Required Courses"],
        "Core Electives": core_allocated,
        "Area Electives": area_allocated,
        "Free Electives": free_allocated,
        "Faculty Courses": faculty_course_codes,
        # Full eligible pools (used to compute remaining_course_codes)
        "_Core Electives Eligible": core_codes,
        "_Area Electives Eligible": area_codes,
    }


def match_requirements(
    completed_courses: list[CompletedCourse] | list[dict],
    program_requirements: dict,
    faculty_courses: list[dict] | None = None,
) -> MatchResult:
    """Categorize completed courses against program requirements and return
    per-category match status together with an overall completion summary.

    This is a pure function: it performs no I/O and has no side effects.
    All inputs must be supplied by the caller.

    Args:
        completed_courses: One entry per distinct course the student has
            attempted (latest attempt only for retaken courses).
        program_requirements: Parsed cs_bscs_requirements_v1.json (or
            equivalent structure for other programs).
        faculty_courses: Rows from faculty_courses_SU.json used to populate
            the Faculty Courses category. Pass None to skip that category.
    """
    courses: list[CompletedCourse] = [
        CompletedCourse.model_validate(c) if isinstance(c, dict) else c
        for c in completed_courses
    ]

    category_requirements: list[dict] = (
        program_requirements.get("requirement_summary", {}).get("categories", []) or []
    )
    category_definitions: dict = program_requirements.get("categories", {}) or {}

    faculty_course_codes: set[str] = {
        _normalize_code(item.get("code", ""))
        for item in (faculty_courses or [])
        if isinstance(item, dict) and item.get("code")
    }

    min_su = _min_su_per_category(category_requirements)
    cgpa = _compute_cgpa(courses)
    total_credits_completed = round(sum(c.su_credits for c in courses), 2)

    raw_min_su = program_requirements.get("requirement_summary", {}).get("total", {}).get("min_su")
    total_credits_required: float | None = float(raw_min_su) if raw_min_su is not None else None

    completed_codes_set: set[str] = {_normalize_code(c.code) for c in courses}
    engineering_ects = round(sum(c.engineering_ects for c in courses), 2)
    basic_science_ects = round(sum(c.basic_science_ects for c in courses), 2)
    su_by_code: dict[str, float] = {_normalize_code(c.code): c.su_credits for c in courses}

    category_sets = _allocate_categories(
        courses, category_definitions, faculty_course_codes, min_su
    )

    result_categories: list[CategoryMatchResult] = []
    progress_pcts: list[float] = []

    for item in category_requirements:
        if not isinstance(item, dict):
            continue
        category_name: str = item.get("category", "")
        if not category_name:
            continue

        required_su: float | None = float(item["min_su"]) if item.get("min_su") is not None else None
        required_ects: float | None = float(item["min_ects"]) if item.get("min_ects") is not None else None
        required_courses_count: int | None = int(item["min_courses"]) if item.get("min_courses") is not None else None

        if category_name == "Engineering":
            credits_done = engineering_ects
            credits_req = required_ects
            courses_done = sum(1 for c in courses if c.engineering_ects > 0)
            completed_list = sorted(_normalize_code(c.code) for c in courses if c.engineering_ects > 0)
            remaining_list: list[str] = []
            progress_candidates: list[float] = []
            if required_ects is not None:
                v = _safe_progress_pct(engineering_ects, required_ects)
                if v is not None:
                    progress_candidates.append(v)

        elif category_name == "Basic Science":
            credits_done = basic_science_ects
            credits_req = required_ects
            courses_done = sum(1 for c in courses if c.basic_science_ects > 0)
            completed_list = sorted(_normalize_code(c.code) for c in courses if c.basic_science_ects > 0)
            remaining_list = []
            progress_candidates = []
            if required_ects is not None:
                v = _safe_progress_pct(basic_science_ects, required_ects)
                if v is not None:
                    progress_candidates.append(v)

        else:
            eligible_codes = category_sets.get(category_name, set())
            completed_list = sorted(code for code in eligible_codes if code in completed_codes_set)
            credits_done = round(sum(su_by_code.get(code, 0.0) for code in completed_list), 2)
            credits_req = required_su
            courses_done = len(completed_list)

            if category_name in _POOL_CATEGORIES:
                pool = category_sets.get(f"_{category_name} Eligible", eligible_codes)
                remaining_list = sorted(pool - completed_codes_set)
            elif category_name in _FIXED_LIST_CATEGORIES:
                remaining_list = sorted(eligible_codes - completed_codes_set)
            else:
                remaining_list = []

            progress_candidates = []
            if required_su is not None:
                v = _safe_progress_pct(credits_done, required_su)
                if v is not None:
                    progress_candidates.append(v)
            if required_ects is not None:
                v = _safe_progress_pct(credits_done, required_ects)
                if v is not None:
                    progress_candidates.append(v)
            if required_courses_count is not None and required_courses_count > 0:
                progress_candidates.append(
                    round(min(100.0, (courses_done / required_courses_count) * 100.0), 1)
                )

        progress_pct = min(progress_candidates) if progress_candidates else None
        if progress_pct is not None:
            progress_pcts.append(progress_pct)

        if progress_pct is not None and progress_pct >= 100.0:
            status: str = "SATISFIED"
        elif courses_done > 0 or credits_done > 0:
            status = "IN_PROGRESS"
        else:
            status = "NOT_STARTED"

        result_categories.append(
            CategoryMatchResult(
                id=category_name.lower().replace(" ", "_"),
                name=category_name,
                status=status,
                credits_completed=credits_done,
                credits_required=credits_req,
                courses_completed=courses_done,
                courses_required=required_courses_count,
                completed_course_codes=completed_list,
                remaining_course_codes=remaining_list,
                progress_pct=progress_pct,
            )
        )

    overall_completion_pct = (
        round(sum(progress_pcts) / len(progress_pcts), 1) if progress_pcts else 0.0
    )

    return MatchResult(
        categories=result_categories,
        overall_completion_pct=overall_completion_pct,
        total_credits_completed=total_credits_completed,
        total_credits_required=total_credits_required,
        cgpa=cgpa,
        meets_minimum_gpa=cgpa >= _MIN_GRADUATION_GPA,
    )
