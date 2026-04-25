// Loads JSON shipped under /data/. Cached in module scope after first fetch.

let coursesPromise = null
let requirementsPromise = null
let facultyCoursesPromise = null

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')

function url(path) {
  return `${BASE}${path}`
}

export function loadCourses() {
  if (!coursesPromise) {
    coursesPromise = fetch(url('/data/courses_SU.json')).then(r => r.json())
  }
  return coursesPromise
}

export function loadRequirements() {
  if (!requirementsPromise) {
    requirementsPromise = fetch(url('/data/cs_bscs_requirements_v1.json')).then(r => r.json())
  }
  return requirementsPromise
}

export function loadFacultyCourses() {
  if (!facultyCoursesPromise) {
    facultyCoursesPromise = fetch(url('/data/faculty_courses_SU.json')).then(r => r.json())
  }
  return facultyCoursesPromise
}

const termPromiseCache = new Map()

export function loadTermSchedule(term) {
  if (!termPromiseCache.has(term)) {
    termPromiseCache.set(term, fetch(url(`/data/schedule_data/${term}.min.json`)).then(r => {
      if (!r.ok) throw new Error(`Schedule not available for term ${term}`)
      return r.json()
    }))
  }
  return termPromiseCache.get(term)
}

export async function listAvailableTerms() {
  // Static manifest — terms are baked into the bundle. If your team adds
  // terms to public/data/schedule_data/, append them here.
  return ['202502']
}
