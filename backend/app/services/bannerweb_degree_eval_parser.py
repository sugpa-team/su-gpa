import re


SECTION_NAMES = [
    "UNIVERSITY COURSES",
    "REQUIRED COURSES",
    "CORE ELECTIVES",
    "AREA ELECTIVES",
    "FREE ELECTIVES",
    "FACULTY COURSES",
    "ENGINEERING",
    "BASIC SCIENCE",
]


def _to_float(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _to_int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        return int(float(value))
    except ValueError:
        return None


def _normalize_lines(raw_text: str) -> list[str]:
    return [re.sub(r"\s+", " ", line).strip() for line in raw_text.splitlines() if line.strip()]


def _extract_metadata(lines: list[str]) -> dict:
    text = "\n".join(lines)

    def extract(pattern: str) -> str | None:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        return match.group(1).strip() if match else None

    return {
        "student": extract(r"Student\s*:\s*(.+?)\s+Program Requirements Term"),
        "program_requirements_term": extract(r"Program Requirements Term.*?:\s*(.+?)\s+Program\s*:"),
        "program": extract(r"Program\s*:\s*(.+?)\s+Evaluation Term"),
        "evaluation_term": extract(r"Evaluation Term\s*:\s*(.+?)\s+Class\s*:"),
        "class": extract(r"Class\s*:\s*(.+?)\s+Status\s*:"),
        "status": extract(r"Status\s*:\s*(.+?)\s+Result"),
    }


def _extract_general_requirements(lines: list[str]) -> dict:
    text = "\n".join(lines)
    minimum_match = re.search(
        r"Minimum Required\s*:\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)",
        text,
    )
    completed_match = re.search(
        r"Completed\s*:\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)",
        text,
    )
    return {
        "minimum_required": {
            "ects_credits": _to_float(minimum_match.group(1)) if minimum_match else None,
            "su_credits": _to_float(minimum_match.group(2)) if minimum_match else None,
            "program_gpa": _to_float(minimum_match.group(3)) if minimum_match else None,
            "cumulative_gpa": _to_float(minimum_match.group(4)) if minimum_match else None,
        },
        "completed": {
            "ects_credits": _to_float(completed_match.group(1)) if completed_match else None,
            "su_credits": _to_float(completed_match.group(2)) if completed_match else None,
            "program_gpa": _to_float(completed_match.group(3)) if completed_match else None,
            "cumulative_gpa": _to_float(completed_match.group(4)) if completed_match else None,
        },
    }


def _find_section_ranges(lines: list[str]) -> list[tuple[str, int, int]]:
    section_starts: list[tuple[str, int]] = []
    for idx, line in enumerate(lines):
        for section_name in SECTION_NAMES:
            if line == section_name:
                section_starts.append((section_name, idx))
    ranges = []
    for i, (name, start_idx) in enumerate(section_starts):
        end_idx = section_starts[i + 1][1] if i + 1 < len(section_starts) else len(lines)
        ranges.append((name, start_idx + 1, end_idx))
    return ranges


def _parse_course_line(line: str, has_su_column: bool) -> dict | None:
    if has_su_column:
        pattern = r"^([A-Z]{2,6}\s+\d{3,5}[A-Z]?)\s+([A-Z][A-Z\.\-\+]*)\s+([0-9.]+)\s+([0-9.]+)\s+(\d{6})$"
        match = re.match(pattern, line)
        if not match:
            return None
        return {
            "course": match.group(1),
            "grade": match.group(2),
            "ects_credits": _to_float(match.group(3)),
            "su_credits": _to_float(match.group(4)),
            "term": match.group(5),
        }

    pattern = r"^([A-Z]{2,6}\s+\d{3,5}[A-Z]?)\s+([A-Z][A-Z\.\-\+]*)\s+([0-9.]+)\s+(\d{6})$"
    match = re.match(pattern, line)
    if not match:
        return None
    return {
        "course": match.group(1),
        "grade": match.group(2),
        "ects_credits": _to_float(match.group(3)),
        "term": match.group(4),
    }


def _parse_summary_line(line: str, key: str) -> dict | None:
    if not line.startswith(key):
        return None
    values = re.sub(r"^" + re.escape(key), "", line).strip().split(" ")
    values = [value for value in values if value]
    if not values:
        return None

    if len(values) >= 3:
        return {
            "ects_credits": _to_float(values[0]) if values[0] != "-" else None,
            "su_credits": _to_float(values[1]) if values[1] != "-" else None,
            "courses": _to_int(values[2]) if values[2] != "-" else None,
        }
    if len(values) == 2:
        return {
            "ects_credits": _to_float(values[0]) if values[0] != "-" else None,
            "courses": _to_int(values[1]) if values[1] != "-" else None,
        }
    return None


def parse_bannerweb_degree_evaluation(raw_text: str) -> dict:
    lines = _normalize_lines(raw_text)
    general = _extract_general_requirements(lines)
    sections = {}
    total_courses_parsed = 0

    for section_name, start_idx, end_idx in _find_section_ranges(lines):
        section_lines = lines[start_idx:end_idx]
        has_su_column = section_name not in {"ENGINEERING", "BASIC SCIENCE"}

        courses = []
        minimum_required = None
        completed = None
        for line in section_lines:
            parsed_minimum = _parse_summary_line(line, "Minimum Required")
            if parsed_minimum:
                minimum_required = parsed_minimum
                continue

            parsed_completed = _parse_summary_line(line, "Completed")
            if parsed_completed:
                completed = parsed_completed
                continue

            course = _parse_course_line(line, has_su_column=has_su_column)
            if course:
                courses.append(course)

        total_courses_parsed += len(courses)
        sections[section_name] = {
            "courses": courses,
            "minimum_required": minimum_required,
            "completed": completed,
        }

    return {
        "metadata": _extract_metadata(lines),
        "general_program_requirements": general,
        "sections": sections,
        "analysis": {
            "total_sections_parsed": len(sections),
            "total_courses_parsed": total_courses_parsed,
        },
    }
