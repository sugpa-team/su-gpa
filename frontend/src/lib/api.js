import { loadCourses, loadRequirements } from './staticData'
import { getProfile, setProfile, getSemesters } from './storage'
import {
  addCourseToSemester,
  createSemester,
  deleteCourseFromSemester,
  deleteCourseRecord,
  deleteSemester,
  getSemestersSummary,
  importBannerwebParseResult,
  resetTrackingData,
  updateCourseRecord,
  updateSemesterCourseGrade,
} from './semesters'
import {
  getGraduationRequirementsProgress,
  getProgressSummary,
  getRequirementsCourseCatalog,
} from './requirements'
import { getPlannerView, getTermSchedule, getCourseSchedule, listAvailableTerms } from './planner'
import {
  createPlan,
  deletePlan,
  getPlan,
  listPlans,
  promotePlanToSemester,
  updatePlan,
} from './plans'
import { parseBannerwebDegreeEvaluation } from './bannerwebParser'
import { getRecommendations } from './recommendations'

class NotFound extends Error {
  constructor(message) {
    super(message)
    this.name = 'NotFound'
  }
}

function splitPathAndQuery(path) {
  const [rawPath, rawQuery = ''] = path.split('?')
  const params = new URLSearchParams(rawQuery)
  return { path: rawPath, params }
}

function parseBody(options) {
  if (!options || options.body == null) return {}
  if (typeof options.body === 'string') {
    try {
      return JSON.parse(options.body)
    } catch {
      return {}
    }
  }
  return options.body
}

async function programsFromRequirements() {
  const requirements = await loadRequirements()
  const program = requirements?.program
  if (!program) return []
  const programId = 1
  return [
    {
      id: programId,
      faculty: program.faculty_name,
      department: program.department_name,
      program_name: program.program_name,
    },
  ]
}

async function profilePayload() {
  const profile = getProfile()
  const programs = await programsFromRequirements()
  const program = programs.find(p => p.id === profile.program_id)
  return {
    faculty: profile.faculty,
    program_id: profile.program_id,
    program_name: program ? program.program_name : profile.program_name,
    entry_term: profile.entry_term,
  }
}

async function updateProfile(body) {
  const faculty = String(body?.faculty || '').trim()
  const programId = body?.program_id != null ? Number(body.program_id) : null
  const entryTerm = String(body?.entry_term || '').trim()
  if (!faculty) throw new Error('Faculty is required.')
  if (!entryTerm) throw new Error('Entry term is required.')

  const programs = await programsFromRequirements()
  const matched = programs.find(p => p.id === programId)
  if (!matched) throw new NotFound(`Program not found: ${programId}`)
  if (matched.faculty !== faculty) throw new Error('Selected faculty does not match program.')

  const previous = getProfile()
  const trackingReset = previous.program_id != null && previous.program_id !== programId
  setProfile({
    faculty,
    department: matched.department,
    program_id: programId,
    program_name: matched.program_name,
    entry_term: entryTerm,
  })
  if (trackingReset) await resetTrackingData()

  return {
    profile: await profilePayload(),
    tracking_reset: trackingReset,
  }
}

async function coursesAsList() {
  const raw = await loadCourses()
  return raw.map(c => ({
    course: c?.Course ?? null,
    name: c?.Name ?? null,
    ects_credits: c?.['ECTS Credits'] ?? null,
    su_credits: c?.['SU Credits'] ?? null,
    faculty: c?.Faculty ?? null,
  }))
}

function emptyFeedbackResponse(path) {
  if (path === '/api/course-feedback/summary') return { summaries: {} }
  if (path === '/api/course-feedback') return { feedback: [] }
  if (path.startsWith('/api/course-feedback/recommendations')) return { recommendations: [] }
  if (path.startsWith('/api/course-feedback/')) return { feedback: null }
  return null
}

async function handle(method, fullPath, options) {
  const { path, params } = splitPathAndQuery(fullPath)
  const body = parseBody(options)

  // ----- Profile / programs -----
  if (path === '/api/programs' && method === 'GET') {
    return { programs: await programsFromRequirements() }
  }
  if (path === '/api/profile' && method === 'GET') {
    return profilePayload()
  }
  if (path === '/api/profile' && method === 'PATCH') {
    return updateProfile(body)
  }

  // ----- Courses catalog -----
  if ((path === '/courses' || path === '/courses/') && method === 'GET') {
    return coursesAsList()
  }

  // ----- GPA / semester summary -----
  if (path === '/api/gpa' && method === 'GET') {
    return getSemestersSummary()
  }
  if (path === '/api/progress' && method === 'GET') {
    return getProgressSummary(getSemesters())
  }
  if (path === '/api/graduation-requirements' && method === 'GET') {
    return getGraduationRequirementsProgress(getSemesters())
  }
  if (path === '/api/graduation-requirements/catalog' && method === 'GET') {
    return getRequirementsCourseCatalog()
  }

  // ----- Semester CRUD -----
  if (path === '/taken-courses/semesters' && method === 'GET') {
    return getSemestersSummary()
  }
  if (path === '/taken-courses/semesters' && method === 'POST') {
    return createSemester(body?.name)
  }
  const semesterDeleteMatch = path.match(/^\/taken-courses\/semesters\/([^/]+)$/)
  if (semesterDeleteMatch && method === 'DELETE') {
    await deleteSemester(semesterDeleteMatch[1])
    return null
  }
  const semesterCourseAddMatch = path.match(/^\/taken-courses\/semesters\/([^/]+)\/courses$/)
  if (semesterCourseAddMatch && method === 'POST') {
    return addCourseToSemester(semesterCourseAddMatch[1], body?.course_code, body?.grade ?? null)
  }
  const semesterCourseGradeMatch = path.match(/^\/taken-courses\/semesters\/([^/]+)\/courses\/([^/]+)\/grade$/)
  if (semesterCourseGradeMatch && method === 'PATCH') {
    return updateSemesterCourseGrade(semesterCourseGradeMatch[1], decodeURIComponent(semesterCourseGradeMatch[2]), body?.grade ?? null)
  }
  const semesterCourseDeleteMatch = path.match(/^\/taken-courses\/semesters\/([^/]+)\/courses\/([^/]+)$/)
  if (semesterCourseDeleteMatch && method === 'DELETE') {
    return deleteCourseFromSemester(semesterCourseDeleteMatch[1], decodeURIComponent(semesterCourseDeleteMatch[2]))
  }

  // ----- Course CRUD (by id) -----
  if (path === '/api/courses' && method === 'POST') {
    return addCourseToSemester(body?.semester_id, body?.course_code, body?.grade ?? null)
  }
  const courseByIdMatch = path.match(/^\/api\/courses\/([^/]+)$/)
  if (courseByIdMatch && method === 'PATCH') {
    return updateCourseRecord(courseByIdMatch[1], body?.grade ?? null)
  }
  if (courseByIdMatch && method === 'DELETE') {
    return deleteCourseRecord(courseByIdMatch[1])
  }

  // ----- Bannerweb -----
  if (path === '/api/bannerweb/analyze' && method === 'POST') {
    const rawText = String(body?.raw_text || '').trim()
    if (!rawText) throw new Error('Pasted text is empty.')
    return parseBannerwebDegreeEvaluation(rawText)
  }
  if (path === '/api/bannerweb/import' && method === 'POST') {
    const rawText = String(body?.raw_text || '').trim()
    if (!rawText) throw new Error('Pasted text is empty.')
    const parsed = await parseBannerwebDegreeEvaluation(rawText)
    return importBannerwebParseResult(parsed)
  }

  // ----- Reset -----
  if (path === '/api/reset' && method === 'POST') {
    await resetTrackingData()
    return getSemestersSummary()
  }

  // ----- Schedule -----
  if (path === '/api/schedule/terms' && method === 'GET') {
    return { terms: await listAvailableTerms() }
  }
  const plannerMatch = path.match(/^\/api\/schedule\/([^/]+)\/planner$/)
  if (plannerMatch && method === 'GET') {
    return getPlannerView(plannerMatch[1])
  }
  const courseInTermMatch = path.match(/^\/api\/schedule\/([^/]+)\/courses\/([^/]+)$/)
  if (courseInTermMatch && method === 'GET') {
    return getCourseSchedule(courseInTermMatch[1], decodeURIComponent(courseInTermMatch[2]))
  }
  const termMatch = path.match(/^\/api\/schedule\/([^/]+)$/)
  if (termMatch && method === 'GET') {
    return getTermSchedule(termMatch[1])
  }

  // ----- Plans -----
  if (path === '/api/plans' && method === 'GET') {
    return { plans: listPlans(params.get('term') || null) }
  }
  if (path === '/api/plans' && method === 'POST') {
    return createPlan(body || {})
  }
  const planByIdMatch = path.match(/^\/api\/plans\/([^/]+)$/)
  if (planByIdMatch && method === 'GET') {
    return getPlan(planByIdMatch[1])
  }
  if (planByIdMatch && method === 'PATCH') {
    return updatePlan(planByIdMatch[1], body || {})
  }
  if (planByIdMatch && method === 'DELETE') {
    deletePlan(planByIdMatch[1])
    return null
  }
  const planPromoteMatch = path.match(/^\/api\/plans\/([^/]+)\/promote-to-semester$/)
  if (planPromoteMatch && method === 'POST') {
    return promotePlanToSemester(planPromoteMatch[1])
  }

  // ----- Recommendations (heuristic, no feedback required) -----
  if (path.startsWith('/api/course-feedback/recommendations') && method === 'GET') {
    const term = params.get('term')
    const limit = params.get('limit')
    if (!term) return { recommendations: [] }
    return getRecommendations(term, limit)
  }

  // ----- Feedback (disabled — return inert shapes) -----
  if (path.startsWith('/api/course-feedback')) {
    if (method === 'GET') return emptyFeedbackResponse(path)
    return null
  }

  throw new NotFound(`No handler for ${method} ${path}`)
}

export async function apiRequest(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  try {
    const result = await handle(method, path, options)
    return result ?? null
  } catch (err) {
    if (err instanceof NotFound) {
      throw new Error(err.message)
    }
    throw err instanceof Error ? err : new Error(String(err))
  }
}
