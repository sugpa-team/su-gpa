const cache = new Map()

function dataUrl(path) {
  // import.meta.env.BASE_URL respects vite's base config, so this works both
  // locally (BASE_URL = '/') and on GitHub Pages (BASE_URL = '/su-gpa/').
  const base = import.meta.env.BASE_URL || '/'
  const trimmedBase = base.endsWith('/') ? base : `${base}/`
  const trimmedPath = path.startsWith('/') ? path.slice(1) : path
  return `${trimmedBase}${trimmedPath}`
}

async function fetchJSON(path) {
  if (cache.has(path)) return cache.get(path)
  const response = await fetch(dataUrl(path))
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: ${response.status}`)
  }
  const data = await response.json()
  cache.set(path, data)
  return data
}

export async function loadCourses() {
  return fetchJSON('data/courses_SU.json')
}

export async function loadRequirements() {
  return fetchJSON('data/cs_bscs_requirements_v1.json')
}

export async function loadFacultyCourses() {
  const payload = await fetchJSON('data/faculty_courses_SU.json')
  return Array.isArray(payload?.courses) ? payload.courses : []
}

export async function loadTerms() {
  const payload = await fetchJSON('data/terms.json')
  return Array.isArray(payload?.terms) ? [...payload.terms].sort() : []
}

export async function loadScheduleTerm(term) {
  return fetchJSON(`data/schedule_data/${term}.min.json`)
}

export function clearCache() {
  cache.clear()
}
