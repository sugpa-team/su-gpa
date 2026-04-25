import { listAvailableTerms, loadTermSchedule, loadCourses, loadRequirements, loadFacultyCourses } from './staticData'
import { normalizeCourseCode } from './gpa'
import * as db from './db'

function looseNormalize(code) {
  return String(code || '').toUpperCase().replace(/\s+/g, '')
}

function resolveMeeting(meeting, places) {
  const placeIdx = meeting.place
  const place = Number.isInteger(placeIdx) && placeIdx >= 0 && placeIdx < places.length ? places[placeIdx] : null
  return {
    day: meeting.day,
    start: meeting.start,
    duration: meeting.duration,
    place,
  }
}

function resolveSection(section, instructors, places) {
  const idx = section.instructors
  const instructor = Number.isInteger(idx) && idx >= 0 && idx < instructors.length ? instructors[idx] : null
  return {
    crn: section.crn,
    group: section.group,
    instructor,
    schedule: (section.schedule || []).map(m => resolveMeeting(m, places)),
  }
}

function resolveClass(cls, instructors, places) {
  return {
    type: cls.type || '',
    sections: (cls.sections || []).map(s => resolveSection(s, instructors, places)),
  }
}

export async function listTerms() {
  return { terms: await listAvailableTerms() }
}

export async function getTermSchedule(term) {
  const payload = await loadTermSchedule(term)
  return {
    term,
    courses: payload.courses || [],
    instructors: payload.instructors || [],
    places: payload.places || [],
  }
}

export async function getCourseSchedule(term, courseCode) {
  const payload = await loadTermSchedule(term)
  const target = looseNormalize(courseCode)
  const course = (payload.courses || []).find(c => looseNormalize(c.code) === target)
  if (!course) {
    const err = new Error(`Course ${courseCode} not in schedule for term ${term}`)
    err.statusCode = 404
    throw err
  }
  return {
    term,
    code: course.code,
    name: course.name,
    classes: (course.classes || []).map(c => resolveClass(c, payload.instructors || [], payload.places || [])),
  }
}

async function buildCategoryMembership() {
  const requirements = await loadRequirements()
  const facultyCourses = await loadFacultyCourses()
  const categories = requirements?.categories || {}
  const result = new Map()
  function add(name, code) {
    const normalized = normalizeCourseCode(code)
    if (!normalized) return
    if (!result.has(normalized)) result.set(normalized, [])
    if (!result.get(normalized).includes(name)) result.get(normalized).push(name)
  }
  function walk(name, value) {
    if (Array.isArray(value)) value.forEach(item => walk(name, item))
    else if (value && typeof value === 'object') {
      if (value.course) add(name, value.course)
      Object.values(value).forEach(v => walk(name, v))
    }
  }
  for (const [name, value] of Object.entries(categories)) walk(name, value)
  for (const item of facultyCourses?.courses || []) {
    if (item?.code) add('Faculty Courses', item.code)
  }
  return result
}

async function buildPrerequisites() {
  const requirements = await loadRequirements()
  const courses = requirements?.prerequisites?.courses
  const map = new Map()
  if (!Array.isArray(courses)) return map
  for (const item of courses) {
    if (!item || typeof item !== 'object') continue
    const code = normalizeCourseCode(item.code || '')
    if (!code) continue
    const prereqs = Array.isArray(item.prerequisites) ? item.prerequisites : []
    map.set(code, prereqs.map(p => normalizeCourseCode(p)).filter(Boolean))
  }
  return map
}

export async function getPlannerCourses(term) {
  const payload = await loadTermSchedule(term)
  const catalog = await loadCourses()
  const catalogByCode = new Map()
  for (const c of catalog) {
    if (c.Course) catalogByCode.set(normalizeCourseCode(c.Course), c)
  }
  const prereqs = await buildPrerequisites()
  const membership = await buildCategoryMembership()

  const allCourses = await db.getAllSemesterCourses()
  const takenCodes = [...new Set(allCourses.map(c => normalizeCourseCode(c.course_code)))]

  const out = []
  for (const course of payload.courses || []) {
    const lookupKey = normalizeCourseCode(course.code || '')
    const catalogEntry = catalogByCode.get(lookupKey) || {}
    out.push({
      code: course.code,
      name: course.name || catalogEntry.Name || null,
      su_credits: catalogEntry['SU Credits'] === undefined ? null : Number(catalogEntry['SU Credits']),
      ects_credits: catalogEntry['ECTS Credits'] === undefined ? null : Number(catalogEntry['ECTS Credits']),
      faculty: catalogEntry.Faculty || null,
      prerequisites: (prereqs.get(lookupKey) || []).slice().sort(),
      requirement_categories: membership.get(lookupKey) || [],
      classes: (course.classes || []).map(cls => resolveClass(cls, payload.instructors || [], payload.places || [])),
    })
  }
  return {
    term,
    taken_course_codes: takenCodes,
    courses: out,
  }
}
