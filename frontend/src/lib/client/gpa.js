export const MAX_SEMESTER_SU_CREDITS = 20.0
export const UNGRADED_VALUES = new Set(['', 'Select', null, undefined])

export const LETTER_GRADE_POINTS = {
  A: 4.0, 'A-': 3.7,
  'B+': 3.3, B: 3.0, 'B-': 2.7,
  'C+': 2.3, C: 2.0, 'C-': 1.7,
  'D+': 1.3, D: 1.0,
  F: 0.0,
}

export const NON_GPA_GRADES = new Set(['S', 'U', 'P', 'NP', 'W', 'I', 'R', 'TR', 'AU', 'EX'])

export const COURSE_CODE_ALIASES = {
  'CS 210': 'DSA 210 / CS 210',
  'DSA 210': 'DSA 210 / CS 210',
}

export function normalizeCourseCode(courseCode) {
  if (!courseCode) return ''
  const normalized = String(courseCode).toUpperCase().split(/\s+/).filter(Boolean).join(' ')
  return COURSE_CODE_ALIASES[normalized] || normalized
}

export function normalizeLetterGrade(grade) {
  if (UNGRADED_VALUES.has(grade)) return null
  const trimmed = String(grade || '').trim()
  if (!trimmed || trimmed.toLowerCase() === 'select') return null
  const upper = trimmed.toUpperCase()
  if (upper in LETTER_GRADE_POINTS || NON_GPA_GRADES.has(upper)) return upper
  throw new Error(`Invalid letter grade: ${grade}`)
}

export function gradeToPoints(grade) {
  const normalized = normalizeLetterGrade(grade)
  if (normalized === null) return null
  const points = LETTER_GRADE_POINTS[normalized]
  return points === undefined ? null : points
}

export function weightedGpa(rows, courseCreditLookup) {
  let totalCredits = 0
  let totalGradePoints = 0
  for (const row of rows) {
    const points = gradeToPoints(row.grade)
    if (points === null) continue
    const credits = courseCreditLookup(row.course_code)
    if (credits === null || credits === undefined) continue
    totalCredits += credits
    totalGradePoints += credits * points
  }
  if (totalCredits === 0) return 0
  return Math.round((totalGradePoints / totalCredits) * 1000) / 1000
}

// Keep the latest attempt per course (matching Python's _latest_attempts_by_course).
export function latestAttemptsByCourse(rows) {
  const latestByCourse = new Map()
  for (const row of rows) {
    const code = normalizeCourseCode(row.course_code)
    const current = latestByCourse.get(code)
    if (!current) {
      latestByCourse.set(code, row)
      continue
    }
    const currentKey = [current.semester_id, current.id]
    const candidateKey = [row.semester_id, row.id]
    if (
      candidateKey[0] > currentKey[0] ||
      (candidateKey[0] === currentKey[0] && candidateKey[1] > currentKey[1])
    ) {
      latestByCourse.set(code, row)
    }
  }
  return latestByCourse
}

export function safeProgressPercent(completed, required) {
  if (!required || required <= 0) return null
  return Math.round(Math.min(100, (completed / required) * 100) * 10) / 10
}
