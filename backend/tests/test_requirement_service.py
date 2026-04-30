"""Tests for requirement_service.match_requirements().

Two real BSCS transcript scenarios:
  - Scenario A: mid-degree student (semesters 1-4 done)
  - Scenario B: near-graduation student (all major requirements met)

Plus focused unit tests for priority allocation, overflow, and edge cases.
All tests are pure — no database, no monkeypatching required.
"""
import json
from pathlib import Path

import pytest

from app.models.requirements import CompletedCourse
from app.services.requirement_service import match_requirements

DATA_DIR = Path(__file__).resolve().parents[1] / "app" / "data"


@pytest.fixture(scope="module")
def bscs_reqs() -> dict:
    return json.loads((DATA_DIR / "cs_bscs_requirements_v1.json").read_text())


@pytest.fixture(scope="module")
def faculty_courses() -> list[dict]:
    data = json.loads((DATA_DIR / "faculty_courses_SU.json").read_text())
    return data.get("courses", [])


def _by_name(result):
    """Index MatchResult categories by name for easy assertion access."""
    return {cat.name: cat for cat in result.categories}


# ── Course-list helpers ───────────────────────────────────────────────────────

def _university_courses() -> list[CompletedCourse]:
    """All 16 required university courses — 41 SU total."""
    return [
        CompletedCourse(code="IF 100",   su_credits=3, faculty="FENS", grade="A",  basic_science_ects=5.0),
        CompletedCourse(code="MATH 101", su_credits=3, faculty="FENS", grade="A",  basic_science_ects=6.0),
        CompletedCourse(code="CIP 101N", su_credits=0, faculty="FASS", grade="S"),
        CompletedCourse(code="NS 101",   su_credits=4, faculty="FENS", grade="B+", basic_science_ects=6.0),
        CompletedCourse(code="SPS 101",  su_credits=3, faculty="FASS", grade="A-"),
        CompletedCourse(code="TLL 101",  su_credits=2, faculty="SL",   grade="S"),
        CompletedCourse(code="AL 102",   su_credits=3, faculty="SL",   grade="B"),
        CompletedCourse(code="MATH 102", su_credits=3, faculty="FENS", grade="B+", basic_science_ects=6.0),
        CompletedCourse(code="NS 102",   su_credits=4, faculty="FENS", grade="B",  basic_science_ects=6.0),
        CompletedCourse(code="SPS 102",  su_credits=3, faculty="FASS", grade="A-"),
        CompletedCourse(code="TLL 102",  su_credits=2, faculty="SL",   grade="S"),
        CompletedCourse(code="HIST 191", su_credits=2, faculty="FASS", grade="A"),
        CompletedCourse(code="HIST 192", su_credits=2, faculty="FASS", grade="A"),
        CompletedCourse(code="PROJ 201", su_credits=1, faculty="FENS", grade="S"),
        CompletedCourse(code="SPS 303",  su_credits=3, faculty="FASS", grade="A"),
        CompletedCourse(code="HUM 201",  su_credits=3, faculty="FASS", grade="A"),
    ]


def _partial_required_courses() -> list[CompletedCourse]:
    """6 of 11 required courses — 18 SU.
    Missing: CS 301, CS 303, CS 395, ENS 491, ENS 492.
    """
    return [
        CompletedCourse(code="CS 201",   su_credits=3, faculty="FENS", grade="A",  engineering_ects=6.0),
        CompletedCourse(code="CS 204",   su_credits=3, faculty="FENS", grade="A",  engineering_ects=6.0),
        CompletedCourse(code="CS 300",   su_credits=3, faculty="FENS", grade="B+", engineering_ects=6.0, basic_science_ects=6.0),
        CompletedCourse(code="MATH 201", su_credits=3, faculty="FENS", grade="A",  basic_science_ects=6.0),
        CompletedCourse(code="MATH 203", su_credits=3, faculty="FENS", grade="B+", basic_science_ects=6.0),
        CompletedCourse(code="MATH 204", su_credits=3, faculty="FENS", grade="B",  basic_science_ects=6.0),
    ]


def _remaining_required_courses() -> list[CompletedCourse]:
    """The 5 required courses absent from _partial_required_courses."""
    return [
        CompletedCourse(code="CS 301",  su_credits=3, faculty="FENS", grade="A",  engineering_ects=6.0),
        CompletedCourse(code="CS 303",  su_credits=4, faculty="FENS", grade="A",  engineering_ects=7.0, basic_science_ects=7.0),
        CompletedCourse(code="CS 395",  su_credits=0, faculty="FENS", grade="S"),
        CompletedCourse(code="ENS 491", su_credits=1, faculty="FENS", grade="A"),
        CompletedCourse(code="ENS 492", su_credits=3, faculty="FENS", grade="A"),
    ]


def _core_courses_overflow() -> list[CompletedCourse]:
    """11 core courses — 34 SU total.

    The first 10 (31 SU) satisfy Core Electives exactly. The 11th (CS 412,
    3 SU) cannot fit in Core and overflows to Area Electives.
    """
    return [
        CompletedCourse(code="CS 302", su_credits=3, faculty="FENS", grade="A",  engineering_ects=6.0),
        CompletedCourse(code="CS 305", su_credits=3, faculty="FENS", grade="A",  engineering_ects=6.0),
        CompletedCourse(code="CS 306", su_credits=3, faculty="FENS", grade="B+", engineering_ects=6.0),
        CompletedCourse(code="CS 307", su_credits=3, faculty="FENS", grade="A",  engineering_ects=6.0),
        CompletedCourse(code="CS 308", su_credits=4, faculty="FENS", grade="A-", engineering_ects=7.0),
        CompletedCourse(code="CS 400", su_credits=3, faculty="FENS", grade="B+", engineering_ects=6.0),
        CompletedCourse(code="CS 404", su_credits=3, faculty="FENS", grade="A",  engineering_ects=6.0),
        CompletedCourse(code="CS 405", su_credits=3, faculty="FENS", grade="A",  engineering_ects=6.0),
        CompletedCourse(code="CS 406", su_credits=3, faculty="FENS", grade="B",  engineering_ects=6.0),
        CompletedCourse(code="CS 407", su_credits=3, faculty="FENS", grade="A",  engineering_ects=6.0),
        CompletedCourse(code="CS 412", su_credits=3, faculty="FENS", grade="A"),  # overflows to Area
    ]


def _area_fill_courses() -> list[CompletedCourse]:
    """Two area elective courses that (together with the CS 412 overflow)
    exactly satisfy the 9 SU Area Elective requirement."""
    return [
        CompletedCourse(code="CS 414", su_credits=3, faculty="FENS", grade="A"),
        CompletedCourse(code="CS 415", su_credits=3, faculty="FENS", grade="A"),
    ]


def _free_elective_courses() -> list[CompletedCourse]:
    """5 FASS area-pool courses placed after area is satisfied.

    Because area is already full when the allocator reaches these, they
    overflow to Free Electives (15 SU total).
    """
    return [
        CompletedCourse(code="VA 310",   su_credits=3, faculty="FASS", grade="A"),
        CompletedCourse(code="VA 325",   su_credits=3, faculty="FASS", grade="A"),
        CompletedCourse(code="VA 345",   su_credits=3, faculty="FASS", grade="A"),
        CompletedCourse(code="VA 455",   su_credits=3, faculty="FASS", grade="A"),
        CompletedCourse(code="ECON 201", su_credits=3, faculty="FASS", grade="A"),
    ]


# ── Scenario A: mid-degree student ───────────────────────────────────────────

def test_scenario_a_university_courses_satisfied(bscs_reqs, faculty_courses):
    """After completing all 16 university courses, the category is SATISFIED."""
    courses = _university_courses() + _partial_required_courses()
    result = match_requirements(courses, bscs_reqs, faculty_courses)
    cats = _by_name(result)

    univ = cats["University Courses"]
    assert univ.status == "SATISFIED"
    assert univ.courses_completed == 16
    assert univ.credits_completed == 41.0
    assert univ.progress_pct == 100.0


def test_scenario_a_required_courses_in_progress(bscs_reqs, faculty_courses):
    """6 of 11 required courses places Required Courses in IN_PROGRESS."""
    courses = _university_courses() + _partial_required_courses()
    result = match_requirements(courses, bscs_reqs, faculty_courses)
    cats = _by_name(result)

    req = cats["Required Courses"]
    assert req.status == "IN_PROGRESS"
    assert req.courses_completed == 6
    assert req.credits_completed == 18.0
    # progress is bottlenecked by course count: 6/11 ≈ 54.5 %
    assert req.progress_pct == pytest.approx(54.5, abs=0.2)


def test_scenario_a_core_electives_not_started(bscs_reqs, faculty_courses):
    """Without any core elective courses the category is NOT_STARTED."""
    courses = _university_courses() + _partial_required_courses()
    result = match_requirements(courses, bscs_reqs, faculty_courses)
    cats = _by_name(result)

    assert cats["Core Electives"].status == "NOT_STARTED"
    assert cats["Core Electives"].credits_completed == 0.0


def test_scenario_a_faculty_courses_satisfied(bscs_reqs, faculty_courses):
    """CS 201, CS 204, MATH 201/203/204 are all faculty courses — satisfies
    the 5-course minimum without any additional electives."""
    courses = _university_courses() + _partial_required_courses()
    result = match_requirements(courses, bscs_reqs, faculty_courses)
    cats = _by_name(result)

    fac = cats["Faculty Courses"]
    assert fac.status == "SATISFIED"
    assert fac.courses_completed >= 5


def test_scenario_a_overall_completion_below_half(bscs_reqs, faculty_courses):
    """A mid-degree student should have well under 50 % overall completion."""
    courses = _university_courses() + _partial_required_courses()
    result = match_requirements(courses, bscs_reqs, faculty_courses)

    assert result.overall_completion_pct < 50.0
    assert result.total_credits_completed == pytest.approx(41.0 + 18.0, abs=0.1)


def test_scenario_a_cgpa_above_average(bscs_reqs, faculty_courses):
    """With mostly A/B+ grades the cumulative GPA exceeds 3.0."""
    courses = _university_courses() + _partial_required_courses()
    result = match_requirements(courses, bscs_reqs, faculty_courses)

    assert result.cgpa > 3.0
    assert result.meets_minimum_gpa is True


# ── Scenario B: near-graduation student ──────────────────────────────────────

def _make_near_graduation_courses() -> list[CompletedCourse]:
    return (
        _university_courses()
        + _partial_required_courses()
        + _remaining_required_courses()
        + _core_courses_overflow()
        + _area_fill_courses()
        + _free_elective_courses()
    )


def test_scenario_b_all_credit_categories_satisfied(bscs_reqs, faculty_courses):
    """A near-graduation student with all credit requirements met shows
    SATISFIED across every credit-bearing category."""
    courses = _make_near_graduation_courses()
    result = match_requirements(courses, bscs_reqs, faculty_courses)
    cats = _by_name(result)

    for name in ("University Courses", "Required Courses",
                 "Core Electives", "Area Electives", "Free Electives",
                 "Faculty Courses"):
        assert cats[name].status == "SATISFIED", (
            f"{name}: status={cats[name].status}, "
            f"done={cats[name].credits_completed}/{cats[name].credits_required}"
        )


def test_scenario_b_required_courses_all_counted(bscs_reqs, faculty_courses):
    """All 11 required courses (29 SU) are accounted for, including
    the zero-credit CS 395 internship."""
    courses = _make_near_graduation_courses()
    result = match_requirements(courses, bscs_reqs, faculty_courses)
    cats = _by_name(result)

    req = cats["Required Courses"]
    assert req.courses_completed == 11
    assert req.credits_completed == 29.0
    assert req.progress_pct == 100.0


def test_scenario_b_engineering_satisfied_via_ects(bscs_reqs, faculty_courses):
    """Engineering (≥90 ECTS) is satisfied through per-course ECTS
    attributions on the required and core elective courses."""
    courses = _make_near_graduation_courses()
    result = match_requirements(courses, bscs_reqs, faculty_courses)
    cats = _by_name(result)

    eng = cats["Engineering"]
    assert eng.credits_completed >= 90.0
    assert eng.status == "SATISFIED"


def test_scenario_b_basic_science_satisfied_via_ects(bscs_reqs, faculty_courses):
    """Basic Science (≥60 ECTS) is satisfied through per-course ECTS
    attributions on math and natural science courses."""
    courses = _make_near_graduation_courses()
    result = match_requirements(courses, bscs_reqs, faculty_courses)
    cats = _by_name(result)

    bs = cats["Basic Science"]
    assert bs.credits_completed >= 60.0
    assert bs.status == "SATISFIED"


def test_scenario_b_overall_completion_at_least_90_percent(bscs_reqs, faculty_courses):
    courses = _make_near_graduation_courses()
    result = match_requirements(courses, bscs_reqs, faculty_courses)

    assert result.overall_completion_pct >= 90.0


# ── Priority and overflow ─────────────────────────────────────────────────────

def test_excess_core_overflows_to_area(bscs_reqs, faculty_courses):
    """The 11th core course cannot fit in Core (which needs exactly 31 SU)
    and is automatically allocated to Area Electives instead."""
    courses = _core_courses_overflow()
    result = match_requirements(courses, bscs_reqs, faculty_courses)
    cats = _by_name(result)

    assert cats["Core Electives"].credits_completed == 31.0
    assert cats["Core Electives"].status == "SATISFIED"
    # CS 412 (3 SU) overflowed
    assert cats["Area Electives"].credits_completed == 3.0


def test_excess_area_overflows_to_free(bscs_reqs, faculty_courses):
    """FASS area-pool courses placed after area is exactly satisfied flow
    into Free Electives rather than inflating Area Electives.

    CS 438 is area-only (not in core_codes), so it fills area without being
    pulled into core first. VA/ECON courses come after area is full.
    """
    courses = [
        # Exactly fill area (9 SU) with pure area-pool courses
        CompletedCourse(code="CS 414", su_credits=3, faculty="FENS", grade="A"),
        CompletedCourse(code="CS 415", su_credits=3, faculty="FENS", grade="A"),
        CompletedCourse(code="CS 438", su_credits=3, faculty="FENS", grade="A"),
        # FASS area-pool courses placed after area is full → overflow to free
        CompletedCourse(code="VA 310",   su_credits=3, faculty="FASS", grade="A"),
        CompletedCourse(code="VA 325",   su_credits=3, faculty="FASS", grade="A"),
        CompletedCourse(code="VA 345",   su_credits=3, faculty="FASS", grade="A"),
        CompletedCourse(code="VA 455",   su_credits=3, faculty="FASS", grade="A"),
        CompletedCourse(code="ECON 201", su_credits=3, faculty="FASS", grade="A"),
    ]
    result = match_requirements(courses, bscs_reqs, faculty_courses)
    cats = _by_name(result)

    assert cats["Area Electives"].credits_completed == 9.0
    assert cats["Area Electives"].status == "SATISFIED"
    assert cats["Free Electives"].credits_completed == 15.0
    assert cats["Free Electives"].status == "SATISFIED"


def test_required_course_not_reassigned_to_core(bscs_reqs, faculty_courses):
    """A course in both Required and Core pools (e.g. CS 201) is locked to
    Required first and never double-counted in Core."""
    courses = [CompletedCourse(code="CS 201", su_credits=3, faculty="FENS", grade="A")]
    result = match_requirements(courses, bscs_reqs, faculty_courses)
    cats = _by_name(result)

    assert cats["Required Courses"].credits_completed == 3.0
    assert cats["Core Electives"].credits_completed == 0.0


# ── Remaining courses ─────────────────────────────────────────────────────────

def test_remaining_required_lists_missing_courses(bscs_reqs, faculty_courses):
    """remaining_course_codes for Required Courses names the courses still
    needed after partial completion."""
    courses = _partial_required_courses()
    result = match_requirements(courses, bscs_reqs, faculty_courses)
    remaining = set(_by_name(result)["Required Courses"].remaining_course_codes)

    assert "CS 301" in remaining
    assert "CS 303" in remaining
    assert "ENS 491" in remaining
    assert "ENS 492" in remaining
    assert "CS 201" not in remaining
    assert "CS 204" not in remaining


def test_remaining_core_lists_full_eligible_pool(bscs_reqs, faculty_courses):
    """With no core courses taken, remaining_course_codes shows the entire
    Core Electives pool."""
    result = match_requirements([], bscs_reqs, faculty_courses)
    remaining = _by_name(result)["Core Electives"].remaining_course_codes

    assert len(remaining) > 0
    assert "CS 302" in remaining
    assert "CS 404" in remaining
    assert "CS 412" in remaining


def test_remaining_core_shrinks_as_courses_are_completed(bscs_reqs, faculty_courses):
    courses = [CompletedCourse(code="CS 302", su_credits=3, faculty="FENS", grade="A")]
    result = match_requirements(courses, bscs_reqs, faculty_courses)
    remaining = _by_name(result)["Core Electives"].remaining_course_codes

    assert "CS 302" not in remaining
    assert "CS 404" in remaining


# ── BannerWeb category override ───────────────────────────────────────────────

def test_bannerweb_category_pins_course_to_assigned_category(bscs_reqs, faculty_courses):
    """A course imported from BannerWeb with bannerweb_category set keeps that
    assignment even when the computed priority would put it elsewhere."""
    # CS 414 is in Area Electives pool, but BannerWeb marked it as Core
    courses = [
        CompletedCourse(
            code="CS 414", su_credits=3, faculty="FENS", grade="A",
            bannerweb_category="Core Electives",
        ),
    ]
    result = match_requirements(courses, bscs_reqs, faculty_courses)
    cats = _by_name(result)

    assert cats["Core Electives"].credits_completed == 3.0
    assert cats["Area Electives"].credits_completed == 0.0


# ── Edge cases ────────────────────────────────────────────────────────────────

def test_empty_transcript_all_not_started(bscs_reqs, faculty_courses):
    result = match_requirements([], bscs_reqs, faculty_courses)

    assert result.overall_completion_pct == 0.0
    assert result.total_credits_completed == 0.0
    assert result.cgpa == 0.0
    assert result.meets_minimum_gpa is False
    for cat in result.categories:
        assert cat.status == "NOT_STARTED"
        assert cat.credits_completed == 0.0
        assert cat.courses_completed == 0


def test_sl_faculty_courses_excluded_from_free_electives(bscs_reqs, faculty_courses):
    """SL-faculty courses (language instruction) do not count toward Free
    Electives even when they are not otherwise assigned."""
    courses = [
        CompletedCourse(code="SL 999", su_credits=3, faculty="SL", grade="A"),
    ]
    result = match_requirements(courses, bscs_reqs, faculty_courses)
    cats = _by_name(result)

    assert cats["Free Electives"].credits_completed == 0.0


def test_non_gpa_grades_count_toward_credit_requirements(bscs_reqs, faculty_courses):
    """S/U/TR grades do not contribute to CGPA but the course still counts
    toward credit and course-count requirements."""
    courses = [
        CompletedCourse(code="CS 201", su_credits=3, faculty="FENS", grade="S"),
    ]
    result = match_requirements(courses, bscs_reqs, faculty_courses)
    cats = _by_name(result)

    assert cats["Required Courses"].credits_completed == 3.0
    assert cats["Required Courses"].courses_completed == 1
    assert result.cgpa == 0.0  # S grade excluded from GPA


def test_cgpa_computed_from_graded_courses_only(bscs_reqs, faculty_courses):
    # A (4.0) + F (0.0) over equal credits → CGPA exactly 2.0, which meets the 2.0 minimum
    courses = [
        CompletedCourse(code="CS 201", su_credits=3, faculty="FENS", grade="A"),
        CompletedCourse(code="CS 204", su_credits=3, faculty="FENS", grade="F"),
    ]
    result = match_requirements(courses, bscs_reqs, faculty_courses)

    assert result.cgpa == pytest.approx(2.0)
    assert result.meets_minimum_gpa is True  # 2.0 >= 2.0

    # Drop below 2.0 with all F grades
    failing = [CompletedCourse(code="CS 201", su_credits=3, faculty="FENS", grade="F")]
    result2 = match_requirements(failing, bscs_reqs, faculty_courses)
    assert result2.cgpa == 0.0
    assert result2.meets_minimum_gpa is False


def test_dict_input_accepted_same_as_model_input(bscs_reqs, faculty_courses):
    """match_requirements() accepts raw dicts in addition to CompletedCourse
    instances so callers do not need to construct models manually."""
    as_model = [CompletedCourse(code="CS 201", su_credits=3, faculty="FENS", grade="A")]
    as_dict  = [{"code": "CS 201", "su_credits": 3, "faculty": "FENS", "grade": "A"}]

    r1 = match_requirements(as_model, bscs_reqs, faculty_courses)
    r2 = match_requirements(as_dict,  bscs_reqs, faculty_courses)

    assert r1.categories == r2.categories
    assert r1.cgpa == r2.cgpa


# ── Scenario C: Zeynep Dağcı — actual Spring 2025-2026 BannerWeb transcript ───
# Source: Degree Evaluation exported 29.04.2026 (student 00031061, BSCS, Senior).
# engineering_ects / basic_science_ects values are taken directly from the
# Engineering and Basic Science sections of that report.

def _zeynep_university_courses() -> list[CompletedCourse]:
    """16 University Courses — 41 SU. Matches BannerWeb University Courses section."""
    return [
        CompletedCourse(code="CIP 101N", su_credits=0,  faculty="FASS", grade="S"),
        CompletedCourse(code="HIST 191", su_credits=2,  faculty="FASS", grade="A"),
        CompletedCourse(code="HIST 192", su_credits=2,  faculty="FASS", grade="A"),
        CompletedCourse(code="MATH 102", su_credits=3,  faculty="FENS", grade="A",    basic_science_ects=6.0),
        CompletedCourse(code="NS 101",   su_credits=4,  faculty="FENS", grade="C+",   basic_science_ects=6.0),
        CompletedCourse(code="NS 102",   su_credits=4,  faculty="FENS", grade="B+",   basic_science_ects=6.0),
        CompletedCourse(code="SPS 101",  su_credits=3,  faculty="FASS", grade="A"),
        CompletedCourse(code="SPS 102",  su_credits=3,  faculty="FASS", grade="A"),
        CompletedCourse(code="SPS 303",  su_credits=3,  faculty="FASS", grade="C"),
        CompletedCourse(code="TLL 101",  su_credits=2,  faculty="SL",   grade="A"),
        CompletedCourse(code="TLL 102",  su_credits=2,  faculty="SL",   grade="A"),
        CompletedCourse(code="HUM 202",  su_credits=3,  faculty="FASS", grade="A-"),
        CompletedCourse(code="MATH 101", su_credits=3,  faculty="FENS", grade="B",    basic_science_ects=6.0),
        CompletedCourse(code="AL 102",   su_credits=3,  faculty="SL",   grade="A"),
        CompletedCourse(code="IF 100",   su_credits=3,  faculty="FENS", grade="B+",   engineering_ects=5.0),
        CompletedCourse(code="PROJ 201", su_credits=1,  faculty="FENS", grade="B+",   engineering_ects=1.0),
    ]


def _zeynep_required_courses() -> list[CompletedCourse]:
    """11 Required Courses — 29 SU. ENS 492 is I.P.; CS 395 is S-graded (0 SU)."""
    return [
        CompletedCourse(code="CS 201",   su_credits=3,  faculty="FENS", grade="B",    engineering_ects=6.0),
        CompletedCourse(code="CS 204",   su_credits=3,  faculty="FENS", grade="C",    engineering_ects=6.0),
        CompletedCourse(code="CS 300",   su_credits=3,  faculty="FENS", grade="C",    engineering_ects=5.0, basic_science_ects=1.0),
        CompletedCourse(code="CS 301",   su_credits=3,  faculty="FENS", grade="D",    engineering_ects=5.0, basic_science_ects=1.0),
        CompletedCourse(code="CS 303",   su_credits=4,  faculty="FENS", grade="C",    engineering_ects=6.0, basic_science_ects=1.0),
        CompletedCourse(code="CS 395",   su_credits=0,  faculty="FENS", grade="S",    engineering_ects=5.0),
        CompletedCourse(code="ENS 491",  su_credits=1,  faculty="FENS", grade="B",    engineering_ects=2.0),
        CompletedCourse(code="ENS 492",  su_credits=3,  faculty="FENS", grade="I.P.", engineering_ects=5.0),
        CompletedCourse(code="MATH 201", su_credits=3,  faculty="FENS", grade="B-",   basic_science_ects=6.0),
        CompletedCourse(code="MATH 203", su_credits=3,  faculty="FENS", grade="B+",   basic_science_ects=6.0),
        CompletedCourse(code="MATH 204", su_credits=3,  faculty="FENS", grade="B+",   basic_science_ects=6.0),
    ]


def _zeynep_core_courses() -> list[CompletedCourse]:
    """10 Core Electives — 31 SU total. BIO 310, CS 412, CS 445 are I.P.
    The 10 courses exactly fill the 31 SU core requirement."""
    return [
        CompletedCourse(code="CS 306",   su_credits=3,  faculty="FENS", grade="B-",   engineering_ects=6.0),
        CompletedCourse(code="CS 307",   su_credits=3,  faculty="FENS", grade="D+",   engineering_ects=6.0),
        CompletedCourse(code="CS 308",   su_credits=4,  faculty="FENS", grade="C+",   engineering_ects=7.0),
        CompletedCourse(code="CS 310",   su_credits=3,  faculty="FENS", grade="B",    engineering_ects=6.0),
        CompletedCourse(code="CS 408",   su_credits=3,  faculty="FENS", grade="B-",   engineering_ects=6.0),
        CompletedCourse(code="MATH 306", su_credits=3,  faculty="FENS", grade="D+",   basic_science_ects=6.0),
        CompletedCourse(code="DSA 210",  su_credits=3,  faculty="FENS", grade="C+",   engineering_ects=4.0, basic_science_ects=2.0),
        CompletedCourse(code="BIO 310",  su_credits=3,  faculty="FENS", grade="I.P.", basic_science_ects=6.0),
        CompletedCourse(code="CS 412",   su_credits=3,  faculty="FENS", grade="I.P.", engineering_ects=4.0, basic_science_ects=2.0),
        CompletedCourse(code="CS 445",   su_credits=3,  faculty="FENS", grade="I.P.", engineering_ects=6.0),
    ]


def _zeynep_area_courses() -> list[CompletedCourse]:
    """3 Area Electives — 9 SU. CS 48004 is I.P.
    These appear before OPIM 390 so area reaches 9 SU before OPIM 390 is processed."""
    return [
        CompletedCourse(code="ENS 208",  su_credits=3,  faculty="FENS", grade="B+",   engineering_ects=6.0),
        CompletedCourse(code="IE 405",   su_credits=3,  faculty="FENS", grade="B-",   engineering_ects=6.0),
        CompletedCourse(code="CS 48004", su_credits=3,  faculty="FENS", grade="I.P.", engineering_ects=6.0),
    ]


def _zeynep_free_courses() -> list[CompletedCourse]:
    """6 Free Electives — 17 SU (minimum is 15 SU).
    OPIM 390 is in the area pool but overflows to free because area is already full.
    IE 303 and ENS 205 are FENS courses not in any elective pool."""
    return [
        CompletedCourse(code="HART 292", su_credits=3,  faculty="FASS", grade="A"),
        CompletedCourse(code="MKTG 301", su_credits=3,  faculty="SBS",  grade="B"),
        CompletedCourse(code="OPIM 390", su_credits=3,  faculty="SBS",  grade="C"),
        CompletedCourse(code="FELM 101", su_credits=2,  faculty="FASS", grade="C"),
        CompletedCourse(code="IE 303",   su_credits=3,  faculty="FENS", grade="C+",   engineering_ects=6.0),
        CompletedCourse(code="ENS 205",  su_credits=3,  faculty="FENS", grade="C",    engineering_ects=4.0, basic_science_ects=2.0),
    ]


def _zeynep_full_transcript() -> list[CompletedCourse]:
    return (
        _zeynep_university_courses()
        + _zeynep_required_courses()
        + _zeynep_core_courses()
        + _zeynep_area_courses()
        + _zeynep_free_courses()
    )


def test_scenario_c_all_categories_satisfied(bscs_reqs, faculty_courses):
    """Every credit-bearing category in Zeynep's senior transcript is SATISFIED,
    matching the BannerWeb degree evaluation result."""
    result = match_requirements(_zeynep_full_transcript(), bscs_reqs, faculty_courses)
    cats = _by_name(result)

    for name in (
        "University Courses", "Required Courses", "Core Electives",
        "Area Electives", "Free Electives", "Faculty Courses",
        "Engineering", "Basic Science",
    ):
        assert cats[name].status == "SATISFIED", (
            f"{name}: status={cats[name].status}, "
            f"done={cats[name].credits_completed}/{cats[name].credits_required}"
        )


def test_scenario_c_university_courses_exact_counts(bscs_reqs, faculty_courses):
    """University Courses: exactly 16 courses and 41 SU — the BannerWeb minimum."""
    result = match_requirements(_zeynep_full_transcript(), bscs_reqs, faculty_courses)
    univ = _by_name(result)["University Courses"]

    assert univ.courses_completed == 16
    assert univ.credits_completed == 41.0
    assert univ.status == "SATISFIED"


def test_scenario_c_required_courses_all_11_counted(bscs_reqs, faculty_courses):
    """All 11 required courses (29 SU) are accounted for, including
    the I.P. ENS 492 and the zero-credit S-graded CS 395."""
    result = match_requirements(_zeynep_full_transcript(), bscs_reqs, faculty_courses)
    req = _by_name(result)["Required Courses"]

    assert req.courses_completed == 11
    assert req.credits_completed == 29.0
    assert req.progress_pct == 100.0


def test_scenario_c_core_electives_satisfied_with_ip_courses(bscs_reqs, faculty_courses):
    """Core Electives reaches exactly 31 SU even though BIO 310, CS 412,
    and CS 445 are still I.P. — credits count before grades are finalised."""
    result = match_requirements(_zeynep_full_transcript(), bscs_reqs, faculty_courses)
    core = _by_name(result)["Core Electives"]

    assert core.credits_completed == 31.0
    assert core.courses_completed == 10
    assert core.status == "SATISFIED"


def test_scenario_c_area_electives_satisfied_opim_overflows_to_free(bscs_reqs, faculty_courses):
    """Area Electives is exactly satisfied at 9 SU (ENS 208 + IE 405 + CS 48004).
    OPIM 390, which is in the area pool, overflows to Free Electives because
    area is already full when it is processed."""
    result = match_requirements(_zeynep_full_transcript(), bscs_reqs, faculty_courses)
    cats = _by_name(result)

    assert cats["Area Electives"].credits_completed == 9.0
    assert cats["Area Electives"].status == "SATISFIED"
    # OPIM 390 (3 SU) lands in free, so free must be ≥ 15 SU
    assert cats["Free Electives"].credits_completed >= 15.0
    assert cats["Free Electives"].status == "SATISFIED"


def test_scenario_c_engineering_ects_matches_bannerweb(bscs_reqs, faculty_courses):
    """Engineering ECTS sum is 119, well above the 90 ECTS minimum."""
    result = match_requirements(_zeynep_full_transcript(), bscs_reqs, faculty_courses)
    eng = _by_name(result)["Engineering"]

    assert eng.credits_completed == pytest.approx(119.0, abs=0.1)
    assert eng.status == "SATISFIED"


def test_scenario_c_basic_science_ects_matches_bannerweb(bscs_reqs, faculty_courses):
    """Basic Science ECTS sum is 63, just above the 60 ECTS minimum."""
    result = match_requirements(_zeynep_full_transcript(), bscs_reqs, faculty_courses)
    bs = _by_name(result)["Basic Science"]

    assert bs.credits_completed == pytest.approx(63.0, abs=0.1)
    assert bs.status == "SATISFIED"


def test_scenario_c_total_su_credits_matches_bannerweb(bscs_reqs, faculty_courses):
    """Total SU credits including I.P. courses is 127, matching BannerWeb."""
    result = match_requirements(_zeynep_full_transcript(), bscs_reqs, faculty_courses)

    assert result.total_credits_completed == pytest.approx(127.0, abs=0.1)


def test_scenario_c_ip_courses_count_for_credits_but_not_gpa(bscs_reqs, faculty_courses):
    """I.P. grades (ENS 492, BIO 310, CS 412, CS 445, CS 48004 — 15 SU in total)
    contribute to category credit counts but are excluded from CGPA calculation."""
    result = match_requirements(_zeynep_full_transcript(), bscs_reqs, faculty_courses)

    # Total SU includes the 15 SU of I.P. courses
    assert result.total_credits_completed == pytest.approx(127.0, abs=0.1)
    # CGPA is computed only from the 112 graded SU; expected ≈ 2.82 (BannerWeb PGPA)
    assert result.cgpa == pytest.approx(2.82, abs=0.05)
    assert result.meets_minimum_gpa is True


def test_scenario_c_cgpa_close_to_bannerweb_pgpa(bscs_reqs, faculty_courses):
    """Service CGPA computed from graded courses only (112 SU) is ≈ 2.82,
    matching the BannerWeb Program GPA of 2.82."""
    result = match_requirements(_zeynep_full_transcript(), bscs_reqs, faculty_courses)

    assert 2.70 < result.cgpa < 3.00
    assert result.meets_minimum_gpa is True
