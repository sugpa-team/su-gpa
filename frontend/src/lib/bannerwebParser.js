import { loadRequirements } from './staticData'

const SECTION_NAMES = [
  'UNIVERSITY COURSES',
  'REQUIRED COURSES',
  'CORE ELECTIVES',
  'AREA ELECTIVES',
  'FREE ELECTIVES',
  'FACULTY COURSES',
  'ENGINEERING',
  'BASIC SCIENCE',
]

const SECTION_TO_REQUIREMENTS_CATEGORY = {
  'UNIVERSITY COURSES': 'University Courses',
  'REQUIRED COURSES': 'Required Courses',
  'CORE ELECTIVES': 'Core Electives',
  'AREA ELECTIVES': 'Area Electives',
  'FREE ELECTIVES': 'Free Electives',
  'FACULTY COURSES': 'Faculty Courses',
  ENGINEERING: 'Engineering',
  'BASIC SCIENCE': 'Basic Science',
}

function toFloat(v) {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function toInt(v) {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

async function defaultMinimumsBySection() {
  const requirements = await loadRequirements()
  const categories = requirements?.requirement_summary?.categories
  const out = {}
  if (!Array.isArray(categories)) return out
  for (const item of categories) {
    if (!item || typeof item !== 'object') continue
    const sectionName = Object.entries(SECTION_TO_REQUIREMENTS_CATEGORY).find(
      ([, mappedCategory]) => mappedCategory === item.category,
    )?.[0]
    if (!sectionName) continue
    out[sectionName] = {
      ects_credits: toFloat(item.min_ects),
      su_credits: toFloat(item.min_su),
      courses: toInt(item.min_courses),
    }
  }
  return out
}

function normalizeLines(rawText) {
  return rawText
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function extractMetadata(lines) {
  const text = lines.join('\n')
  const extract = pattern => {
    const m = text.match(pattern)
    return m ? m[1].trim() : null
  }
  return {
    student: extract(/Student\s*:\s*(.+?)\s+Program Requirements Term/i),
    program_requirements_term: extract(/Program Requirements Term.*?:\s*(.+?)\s+Program\s*:/i),
    program: extract(/Program\s*:\s*(.+?)\s+Evaluation Term/i),
    evaluation_term: extract(/Evaluation Term\s*:\s*(.+?)\s+Class\s*:/i),
    class: extract(/Class\s*:\s*(.+?)\s+Status\s*:/i),
    status: extract(/Status\s*:\s*(.+?)\s+Result/i),
  }
}

function extractGeneralRequirements(lines) {
  const text = lines.join('\n')
  const minimumMatch = text.match(/Minimum Required\s*:\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/i)
  const completedMatch = text.match(/Completed\s*:\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/i)
  return {
    minimum_required: {
      ects_credits: minimumMatch ? toFloat(minimumMatch[1]) : null,
      su_credits: minimumMatch ? toFloat(minimumMatch[2]) : null,
      program_gpa: minimumMatch ? toFloat(minimumMatch[3]) : null,
      cumulative_gpa: minimumMatch ? toFloat(minimumMatch[4]) : null,
    },
    completed: {
      ects_credits: completedMatch ? toFloat(completedMatch[1]) : null,
      su_credits: completedMatch ? toFloat(completedMatch[2]) : null,
      program_gpa: completedMatch ? toFloat(completedMatch[3]) : null,
      cumulative_gpa: completedMatch ? toFloat(completedMatch[4]) : null,
    },
  }
}

function findSectionRanges(lines) {
  const sectionStarts = []
  for (let i = 0; i < lines.length; i++) {
    for (const name of SECTION_NAMES) {
      if (lines[i] === name) sectionStarts.push([name, i])
    }
  }
  const ranges = []
  for (let i = 0; i < sectionStarts.length; i++) {
    const [name, startIdx] = sectionStarts[i]
    const endIdx = i + 1 < sectionStarts.length ? sectionStarts[i + 1][1] : lines.length
    ranges.push([name, startIdx + 1, endIdx])
  }
  return ranges
}

function parseCourseLine(line, hasSuColumn) {
  if (hasSuColumn) {
    const m = line.match(/^([A-Z]{2,6}\s+\d{3,5}[A-Z]?)\s+([A-Z][A-Z.\-+]*)\s+([0-9.]+)\s+([0-9.]+)\s+(\d{6})$/)
    if (!m) return null
    return {
      course: m[1],
      grade: m[2],
      ects_credits: toFloat(m[3]),
      su_credits: toFloat(m[4]),
      term: m[5],
    }
  }
  const m = line.match(/^([A-Z]{2,6}\s+\d{3,5}[A-Z]?)\s+([A-Z][A-Z.\-+]*)\s+([0-9.]+)\s+(\d{6})$/)
  if (!m) return null
  return {
    course: m[1],
    grade: m[2],
    ects_credits: toFloat(m[3]),
    term: m[4],
  }
}

function parseSummaryLine(line, key) {
  if (!line.startsWith(key)) return null
  const stripped = line.slice(key.length).trim()
  const values = stripped.split(/\s+/).filter(Boolean)
  if (values.length === 0) return null
  if (values.length >= 3) {
    return {
      ects_credits: values[0] !== '-' ? toFloat(values[0]) : null,
      su_credits: values[1] !== '-' ? toFloat(values[1]) : null,
      courses: values[2] !== '-' ? toInt(values[2]) : null,
    }
  }
  if (values.length === 2) {
    return {
      ects_credits: values[0] !== '-' ? toFloat(values[0]) : null,
      courses: values[1] !== '-' ? toInt(values[1]) : null,
    }
  }
  return null
}

export async function parseBannerwebDegreeEvaluation(rawText) {
  const lines = normalizeLines(rawText)
  const general = extractGeneralRequirements(lines)
  const defaults = await defaultMinimumsBySection()
  const sections = {}
  let totalCoursesParsed = 0

  for (const [sectionName, startIdx, endIdx] of findSectionRanges(lines)) {
    const sectionLines = lines.slice(startIdx, endIdx)
    const hasSuColumn = sectionName !== 'ENGINEERING' && sectionName !== 'BASIC SCIENCE'
    const courses = []
    let minimumRequired = null
    let completed = null

    for (const line of sectionLines) {
      const parsedMin = parseSummaryLine(line, 'Minimum Required')
      if (parsedMin) {
        minimumRequired = parsedMin
        continue
      }
      const parsedDone = parseSummaryLine(line, 'Completed')
      if (parsedDone) {
        completed = parsedDone
        continue
      }
      const course = parseCourseLine(line, hasSuColumn)
      if (course) courses.push(course)
    }

    totalCoursesParsed += courses.length
    sections[sectionName] = {
      courses,
      minimum_required: minimumRequired ?? defaults[sectionName] ?? null,
      completed,
    }
  }

  return {
    metadata: extractMetadata(lines),
    general_program_requirements: general,
    sections,
    analysis: {
      total_sections_parsed: Object.keys(sections).length,
      total_courses_parsed: totalCoursesParsed,
    },
  }
}
