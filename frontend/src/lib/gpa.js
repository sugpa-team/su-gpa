import { loadCourses } from './staticData'

export const MAX_SEMESTER_SU_CREDITS = 20.0
const UNGRADED_VALUES = new Set(['', 'Select', null, undefined])

export const LETTER_GRADE_POINTS = {
  A: 4.0,
  'A-': 3.7,
  'B+': 3.3,
  B: 3.0,
  'B-': 2.7,
  'C+': 2.3,
  C: 2.0,
  'C-': 1.7,
  'D+': 1.3,
  D: 1.0,
  F: 0.0,
}

export const NON_GPA_GRADES = new Set([
  'S', 'U', 'P', 'NP', 'W', 'I', 'R', 'TR', 'AU', 'EX', 'I.P.',
])

export const COURSE_CODE_ALIASES = {
  'CS 210': 'DSA 210 / CS 210',
  'DSA 210': 'DSA 210 / CS 210',
}

export function normalizeCourseCode(code) {
  if (!code) return ''
  const upper = String(code).toUpperCase().split(/\s+/).filter(Boolean).join(' ')
  return COURSE_CODE_ALIASES[upper] || upper
}

export function normalizeLetterGrade(grade) {
  if (UNGRADED_VALUES.has(grade)) return null
  const trimmed = grade == null ? '' : String(grade).trim()
  if (!trimmed || trimmed.toLowerCase() === 'select') return null
  const upper = trimmed.toUpperCase()
  if (upper in LETTER_GRADE_POINTS) return upper
  if (NON_GPA_GRADES.has(upper)) return upper
  throw new Error(`Invalid letter grade: ${grade}`)
}

export function gradeToPoints(grade) {
  const normalized = normalizeLetterGrade(grade)
  if (normalized == null) return null
  if (normalized in LETTER_GRADE_POINTS) return LETTER_GRADE_POINTS[normalized]
  return null
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function weightedGpa(weightedCourses) {
  const totalCredits = weightedCourses.reduce((sum, [credits]) => sum + credits, 0)
  if (totalCredits === 0) return 0.0
  const totalGradePoints = weightedCourses.reduce(
    (sum, [credits, points]) => sum + credits * points,
    0,
  )
  return round(totalGradePoints / totalCredits, 3)
}

let suCreditsCache = null

export async function suCreditsByCourseCode() {
  if (suCreditsCache) return suCreditsCache
  const courses = await loadCourses()
  const out = {}
  for (const course of courses) {
    const code = course?.Course
    const credits = course?.['SU Credits']
    if (!code || credits == null) continue
    const normalized = normalizeCourseCode(code)
    out[normalized] = Number(credits)
  }
  suCreditsCache = out
  return out
}

let courseCatalogCache = null

export async function courseCatalog() {
  if (courseCatalogCache) return courseCatalogCache
  const courses = await loadCourses()
  const catalog = {}
  for (const course of courses) {
    const raw = course?.Course
    if (!raw) continue
    const rawCode = String(raw).toUpperCase().split(/\s+/).filter(Boolean).join(' ')
    catalog[rawCode] = course
    catalog[normalizeCourseCode(rawCode)] = course
  }
  courseCatalogCache = catalog
  return catalog
}

export function calculateGpa(takenCourses) {
  const totalCredits = takenCourses.reduce((s, c) => s + (c.credits || 0), 0)
  if (totalCredits === 0) return 0.0
  const weighted = takenCourses.reduce((s, c) => s + (c.grade || 0) * (c.credits || 0), 0)
  return round(weighted / totalCredits, 2)
}

export async function calculateGpaSummaryFromLetterGrades(grades) {
  const suCredits = await suCreditsByCourseCode()
  const semesterGpas = []
  const semesterSuCredits = []
  const latestWeightedByCourse = new Map()

  for (const semester of grades) {
    const semesterCodes = new Set()
    let semesterCredits = 0.0
    const semesterWeighted = []

    for (const course of semester) {
      const courseCode = normalizeCourseCode(course.course)
      if (!courseCode) continue
      if (semesterCodes.has(courseCode)) {
        throw new Error(`Course already exists in this semester: ${courseCode}`)
      }
      semesterCodes.add(courseCode)

      const credits = suCredits[courseCode]
      if (credits == null) {
        throw new Error(`Unknown course or missing SU credits: ${courseCode}`)
      }

      semesterCredits += credits
      if (semesterCredits > MAX_SEMESTER_SU_CREDITS) {
        throw new Error(
          `${courseCode} cannot be added. Semester SU credits would be ${semesterCredits}, ` +
            `exceeding the limit of ${MAX_SEMESTER_SU_CREDITS}.`,
        )
      }

      const points = gradeToPoints(course.grade)
      if (points == null) continue
      const weighted = [credits, points]
      semesterWeighted.push(weighted)
      latestWeightedByCourse.set(courseCode, weighted)
    }

    semesterSuCredits.push(round(semesterCredits, 2))
    semesterGpas.push(weightedGpa(semesterWeighted))
  }

  const cumulativeGpa = weightedGpa([...latestWeightedByCourse.values()])
  return {
    gpa: cumulativeGpa,
    cumulative_gpa: cumulativeGpa,
    semester_gpas: semesterGpas,
    semester_su_credits: semesterSuCredits,
    max_semester_su_credits: MAX_SEMESTER_SU_CREDITS,
  }
}

export function weightedGpaFromRows(rows, suCreditsByCode) {
  let totalCredits = 0.0
  let totalPoints = 0.0
  for (const row of rows) {
    const points = gradeToPoints(row.grade)
    if (points == null) continue
    const credits = rowSuCredits(row, suCreditsByCode)
    totalCredits += credits
    totalPoints += credits * points
  }
  if (totalCredits === 0) return 0.0
  return round(totalPoints / totalCredits, 3)
}

export function rowSuCredits(row, suCreditsByCode) {
  if (row.bannerweb_su_credits != null) return Number(row.bannerweb_su_credits)
  const code = normalizeCourseCode(row.course_code)
  const credits = suCreditsByCode[code]
  if (credits == null) {
    throw new Error(`Course not found or missing SU credits: ${code}`)
  }
  return credits
}

export function rowEctsCredits(row, courseCatalog) {
  if (row.bannerweb_ects_credits != null) return Number(row.bannerweb_ects_credits)
  const code = normalizeCourseCode(row.course_code)
  const course = courseCatalog[code]
  if (!course) return null
  const ects = course['ECTS Credits']
  return ects == null ? null : Number(ects)
}

export const _internals = { round, weightedGpa }
