import { courseCatalog, normalizeCourseCode } from './gpa'
import { loadRequirements, loadScheduleTerm, loadTerms } from './staticData'
import { getCategoryMembership } from './requirements'
import { getSemesters } from './storage'

function normalizeForUserInput(code) {
  return String(code || '').toUpperCase().split(/\s+/).join('')
}

function toFloat(value) {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function resolveMeeting(meeting, places) {
  const placeIdx = meeting?.place
  const place = typeof placeIdx === 'number' && placeIdx >= 0 && placeIdx < places.length
    ? places[placeIdx]
    : null
  return {
    day: meeting?.day,
    start: meeting?.start,
    duration: meeting?.duration,
    place,
  }
}

function resolveSection(section, instructors, places) {
  const instIdx = section?.instructors
  const instructor = typeof instIdx === 'number' && instIdx >= 0 && instIdx < instructors.length
    ? instructors[instIdx]
    : null
  return {
    crn: section?.crn,
    group: section?.group,
    instructor,
    schedule: (section?.schedule || []).map(m => resolveMeeting(m, places)),
  }
}

function resolveClass(cls, instructors, places) {
  return {
    type: cls?.type || '',
    sections: (cls?.sections || []).map(s => resolveSection(s, instructors, places)),
  }
}

export async function listAvailableTerms() {
  return loadTerms()
}

export async function getTermSchedule(term) {
  const payload = await loadScheduleTerm(term)
  return {
    term,
    courses: payload?.courses || [],
    instructors: payload?.instructors || [],
    places: payload?.places || [],
  }
}

export async function getCourseSchedule(term, courseCode) {
  const payload = await loadScheduleTerm(term)
  const instructors = payload?.instructors || []
  const places = payload?.places || []
  const target = normalizeForUserInput(courseCode)
  const course = (payload?.courses || []).find(c => normalizeForUserInput(c?.code || '') === target)
  if (!course) throw new Error(`Course ${courseCode} not in schedule for term ${term}`)
  return {
    term,
    code: course.code,
    name: course.name,
    classes: (course.classes || []).map(cls => resolveClass(cls, instructors, places)),
  }
}

function regularTermIndex(term) {
  const t = String(term || '').trim()
  if (t.length !== 6 || !/^\d{6}$/.test(t)) return null
  const year = parseInt(t.slice(0, 4), 10)
  const suffix = t.slice(4)
  if (suffix === '01') return year * 2
  if (suffix === '02') return year * 2 + 1
  return null
}

function regularTermDistance(fromTerm, toTerm) {
  const a = regularTermIndex(fromTerm)
  const b = regularTermIndex(toTerm)
  if (a == null || b == null) return null
  return b - a
}

function getRetakeEligibility(semesters, targetTerm) {
  const latestByCourse = new Map()
  for (const semester of semesters) {
    const term = String(semester.name || '').trim()
    const termIdx = regularTermIndex(term)
    if (termIdx == null) continue
    for (const c of semester.courses || []) {
      const code = normalizeCourseCode(c.course_code)
      const current = latestByCourse.get(code)
      if (!current || termIdx > current.idx) latestByCourse.set(code, { term, idx: termIdx })
    }
  }

  const out = {}
  for (const [code, { term }] of latestByCourse.entries()) {
    const distance = regularTermDistance(term, targetTerm)
    const canRetake = distance == null || (distance >= 0 && distance <= 3)
    out[code] = {
      course_code: code,
      last_taken_term: term,
      target_term: String(targetTerm).trim(),
      regular_terms_since_last_taken: distance,
      can_retake: canRetake,
      reason: canRetake
        ? null
        : `${code} was last taken in ${term}; retakes are only allowed within three regular semesters.`,
    }
  }
  return out
}

function getTakenCourseCodes(semesters) {
  const codes = new Set()
  for (const semester of semesters) {
    for (const c of semester.courses || []) {
      codes.add(normalizeCourseCode(c.course_code))
    }
  }
  return codes
}

function prerequisitesByCourse(requirements) {
  const courses = requirements?.prerequisites?.courses
  const mapping = {}
  if (!Array.isArray(courses)) return mapping
  for (const item of courses) {
    if (!item || typeof item !== 'object') continue
    const code = normalizeCourseCode(item.code || '')
    if (!code) continue
    const prereqs = Array.isArray(item.prerequisites) ? item.prerequisites : []
    mapping[code] = prereqs
      .map(p => normalizeCourseCode(p))
      .filter(Boolean)
  }
  return mapping
}

export async function getPlannerCourses(term) {
  const [payload, catalog, requirements, membership] = await Promise.all([
    loadScheduleTerm(term),
    courseCatalog(),
    loadRequirements(),
    getCategoryMembership(),
  ])
  const instructors = payload?.instructors || []
  const places = payload?.places || []
  const prereqMap = prerequisitesByCourse(requirements)

  const out = []
  for (const course of payload?.courses || []) {
    const code = course?.code || ''
    const lookupKey = String(code).toUpperCase().split(/\s+/).filter(Boolean).join(' ')
    const catalogEntry = catalog[lookupKey] || {}
    out.push({
      code,
      name: course?.name || catalogEntry.Name || null,
      su_credits: toFloat(catalogEntry['SU Credits']),
      ects_credits: toFloat(catalogEntry['ECTS Credits']),
      faculty: catalogEntry.Faculty || null,
      prerequisites: [...(prereqMap[lookupKey] || [])].sort(),
      requirement_categories: membership[lookupKey] || [],
      classes: (course?.classes || []).map(cls => resolveClass(cls, instructors, places)),
    })
  }
  return out
}

export async function getPlannerView(term) {
  const courses = await getPlannerCourses(term)
  const semesters = getSemesters()
  const retake = getRetakeEligibility(semesters, term)
  for (const course of courses) {
    const key = String(course.code || '').toUpperCase().split(/\s+/).filter(Boolean).join(' ')
    const status = retake[key]
    if (status) {
      course.retake_allowed = status.can_retake
      course.retake_reason = status.reason
      course.last_taken_term = status.last_taken_term
    }
  }
  return {
    term,
    taken_course_codes: [...getTakenCourseCodes(semesters)].sort(),
    courses,
  }
}
