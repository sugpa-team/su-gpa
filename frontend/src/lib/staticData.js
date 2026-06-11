import { getProfile } from './storage'

const cache = new Map()

const DEFAULT_REQUIREMENTS_PATH = 'data/cs_bscs_requirements_v1.json'
const AUGMENTED_COURSES_CACHE_KEY = '__courses_with_requirement_entries__'
const TERM_SUFFIX_BY_SEASON = {
  fall: '01',
  spring: '02',
  summer: '03',
}

function normalizeCourseCode(code) {
  return String(code || '').trim().toUpperCase().replace(/\s+/g, ' ')
}

function collectRequirementCourses(value, out = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectRequirementCourses(item, out)
  } else if (value && typeof value === 'object') {
    if (value.course) {
      out.push({
        Course: normalizeCourseCode(value.course),
        Name: value.name ?? null,
        'ECTS Credits': value.ects_credits ?? null,
        'SU Credits': value.su_credits ?? null,
        Faculty: value.faculty ?? null,
      })
    }
    for (const item of Object.values(value)) collectRequirementCourses(item, out)
  }
  return out
}

function entryTermCode(entryTerm) {
  const text = String(entryTerm || '').trim()
  const match = text.match(/^(\d{4})-\d{4}\s+(Fall|Spring|Summer)$/i)
  if (!match) return null
  const suffix = TERM_SUFFIX_BY_SEASON[match[2].toLowerCase()]
  return suffix ? `${match[1]}${suffix}` : null
}

function requirementsFilesForProgram(program) {
  const files = []
  if (program?.requirements_file) files.push(program.requirements_file)
  if (Array.isArray(program?.curricula)) {
    for (const curriculum of program.curricula) {
      if (curriculum?.requirements_file) files.push(curriculum.requirements_file)
    }
  }
  return [...new Set(files)]
}

export function requirementsFileForProgram(program, entryTerm) {
  const fallback = program?.requirements_file || DEFAULT_REQUIREMENTS_PATH
  const termCode = entryTermCode(entryTerm)
  const curricula = Array.isArray(program?.curricula) ? program.curricula : []
  if (!termCode || curricula.length === 0) return fallback

  const matched = curricula
    .filter(curriculum => {
      const from = String(curriculum?.effective_from || '').trim()
      const to = String(curriculum?.effective_to || '').trim()
      if (!from || from > termCode) return false
      if (to && to < termCode) return false
      return Boolean(curriculum?.requirements_file)
    })
    .sort((a, b) => String(b.effective_from).localeCompare(String(a.effective_from)))[0]

  return matched?.requirements_file || fallback
}

function dataUrl(path) {
  // import.meta.env.BASE_URL respects vite's base config, so this works both
  // locally (BASE_URL = '/') and on GitHub Pages (BASE_URL = '/su-gpa/').
  const base = import.meta.env?.BASE_URL || '/'
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
  if (cache.has(AUGMENTED_COURSES_CACHE_KEY)) return cache.get(AUGMENTED_COURSES_CACHE_KEY)

  const baseCourses = await fetchJSON('data/courses_SU.json')
  const courses = Array.isArray(baseCourses) ? [...baseCourses] : []
  const seen = new Set(courses.map(course => normalizeCourseCode(course?.Course)).filter(Boolean))

  try {
    const programs = await loadProgramRegistry()
    const derivedCourses = []
    await Promise.all(
      programs.map(async program => {
        await Promise.all(
          requirementsFilesForProgram(program).map(async requirementsFile => {
            const requirements = await fetchJSON(requirementsFile)
            collectRequirementCourses(requirements?.categories || {}, derivedCourses)
          }),
        )
      }),
    )

    const missingRequirementCourses = derivedCourses
      .filter(course => course.Course && !seen.has(course.Course) && course['SU Credits'] != null)
      .sort((a, b) => a.Course.localeCompare(b.Course))

    for (const course of missingRequirementCourses) {
      if (seen.has(course.Course)) continue
      seen.add(course.Course)
      courses.push(course)
    }
  } catch {
    // The base course catalog is still useful if a program file is unavailable.
  }

  cache.set(AUGMENTED_COURSES_CACHE_KEY, courses)
  return courses
}

export async function loadProgramRegistry() {
  const payload = await fetchJSON('data/programs.json')
  return Array.isArray(payload?.programs) ? payload.programs : []
}

export async function loadRequirements() {
  let path = DEFAULT_REQUIREMENTS_PATH
  const profile = getProfile()
  const programId = profile.program_id
  if (programId != null) {
    try {
      const programs = await loadProgramRegistry()
      const program = programs.find(p => p.id === Number(programId))
      path = requirementsFileForProgram(program, profile.entry_term)
    } catch {
      // Registry unavailable — fall back to the default requirements file.
    }
  }
  return fetchJSON(path)
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
