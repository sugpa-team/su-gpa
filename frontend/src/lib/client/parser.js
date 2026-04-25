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

let defaultMinimumsCache = null

async function getDefaultMinimumsBySection() {
  if (defaultMinimumsCache) return defaultMinimumsCache
  try {
    const requirements = await loadRequirements()
    const categories = requirements?.requirement_summary?.categories
    if (!Array.isArray(categories)) {
      defaultMinimumsCache = {}
      return defaultMinimumsCache
    }
    const defaults = {}
    for (const item of categories) {
      if (!item || typeof item !== 'object') continue
      const categoryName = item.category
      const sectionName = Object.entries(SECTION_TO_REQUIREMENTS_CATEGORY)
        .find(([, mapped]) => mapped === categoryName)?.[0]
      if (!sectionName) continue
      defaults[sectionName] = {
        ects_credits: toFloat(item.min_ects),
        su_credits: toFloat(item.min_su),
        courses: toInt(item.min_courses),
      }
    }
    defaultMinimumsCache = defaults
  } catch {
    defaultMinimumsCache = {}
  }
  return defaultMinimumsCache
}

function toFloat(value) {
  if (value === null || value === undefined) return null
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function toInt(value) {
  if (value === null || value === undefined) return null
  const num = Number(value)
  return Number.isFinite(num) ? Math.trunc(num) : null
}

function normalizeLines(rawText) {
  return rawText
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => line.length > 0)
}

function extractMetadata(lines) {
  const text = lines.join('\n')
  const extract = pattern => {
    const match = text.match(pattern)
    return match ? match[1].trim() : null
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
  const minMatch = text.match(/Minimum Required\s*:\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/)
  const compMatch = text.match(/Completed\s*:\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)/)
  return {
    minimum_required: {
      ects_credits: minMatch ? toFloat(minMatch[1]) : null,
      su_credits: minMatch ? toFloat(minMatch[2]) : null,
      program_gpa: minMatch ? toFloat(minMatch[3]) : null,
      cumulative_gpa: minMatch ? toFloat(minMatch[4]) : null,
    },
    completed: {
      ects_credits: compMatch ? toFloat(compMatch[1]) : null,
      su_credits: compMatch ? toFloat(compMatch[2]) : null,
      program_gpa: compMatch ? toFloat(compMatch[3]) : null,
      cumulative_gpa: compMatch ? toFloat(compMatch[4]) : null,
    },
  }
}

function findSectionRanges(lines) {
  const starts = []
  lines.forEach((line, idx) => {
    if (SECTION_NAMES.includes(line)) starts.push([line, idx])
  })
  return starts.map(([name, startIdx], i) => {
    const endIdx = i + 1 < starts.length ? starts[i + 1][1] : lines.length
    return [name, startIdx + 1, endIdx]
  })
}

const COURSE_LINE_WITH_SU = /^([A-Z]{2,6}\s+\d{3,5}[A-Z]?)\s+([A-Z][A-Z.\-+]*)\s+([0-9.]+)\s+([0-9.]+)\s+(\d{6})$/
const COURSE_LINE_NO_SU = /^([A-Z]{2,6}\s+\d{3,5}[A-Z]?)\s+([A-Z][A-Z.\-+]*)\s+([0-9.]+)\s+(\d{6})$/

function parseCourseLine(line, hasSuColumn) {
  if (hasSuColumn) {
    const m = line.match(COURSE_LINE_WITH_SU)
    if (!m) return null
    return {
      course: m[1],
      grade: m[2],
      ects_credits: toFloat(m[3]),
      su_credits: toFloat(m[4]),
      term: m[5],
    }
  }
  const m = line.match(COURSE_LINE_NO_SU)
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
  const tail = line.slice(key.length).trim()
  const values = tail.split(' ').filter(Boolean)
  if (values.length === 0) return null
  if (values.length >= 3) {
    return {
      ects_credits: values[0] === '-' ? null : toFloat(values[0]),
      su_credits: values[1] === '-' ? null : toFloat(values[1]),
      courses: values[2] === '-' ? null : toInt(values[2]),
    }
  }
  if (values.length === 2) {
    return {
      ects_credits: values[0] === '-' ? null : toFloat(values[0]),
      courses: values[1] === '-' ? null : toInt(values[1]),
    }
  }
  return null
}

export async function parseBannerwebDegreeEvaluation(rawText) {
  const lines = normalizeLines(rawText)
  const general = extractGeneralRequirements(lines)
  const sections = {}
  let totalCoursesParsed = 0
  const defaults = await getDefaultMinimumsBySection()

  for (const [sectionName, startIdx, endIdx] of findSectionRanges(lines)) {
    const sectionLines = lines.slice(startIdx, endIdx)
    const hasSuColumn = sectionName !== 'ENGINEERING' && sectionName !== 'BASIC SCIENCE'

    const courses = []
    let minimumRequired = null
    let completed = null
    for (const line of sectionLines) {
      const parsedMinimum = parseSummaryLine(line, 'Minimum Required')
      if (parsedMinimum) { minimumRequired = parsedMinimum; continue }
      const parsedCompleted = parseSummaryLine(line, 'Completed')
      if (parsedCompleted) { completed = parsedCompleted; continue }
      const course = parseCourseLine(line, hasSuColumn)
      if (course) courses.push(course)
    }

    totalCoursesParsed += courses.length
    sections[sectionName] = {
      courses,
      minimum_required: minimumRequired || defaults[sectionName] || null,
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
