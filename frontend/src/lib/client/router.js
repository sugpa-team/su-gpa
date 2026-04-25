import * as courses from './coursesService'
import * as profile from './profileService'
import * as plans from './planService'
import * as schedule from './scheduleService'
import { parseBannerwebDegreeEvaluation } from './parser'
import * as db from './db'

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function ok(data) {
  return data ?? null
}

const routes = [
  // Courses catalog
  { method: 'GET', match: /^\/courses\/?$/, handler: () => courses.getCourses() },
  { method: 'GET', match: /^\/api\/courses\/?$/, handler: () => courses.getCourses() },

  // GPA / progress / graduation requirements
  { method: 'GET', match: /^\/api\/gpa$/, handler: () => courses.getSemestersSummary() },
  { method: 'GET', match: /^\/api\/progress$/, handler: () => courses.getProgressSummary() },
  { method: 'GET', match: /^\/api\/graduation-requirements$/, handler: () => courses.getGraduationRequirementsProgress() },
  { method: 'GET', match: /^\/api\/graduation-requirements\/catalog$/, handler: () => courses.getRequirementsCourseCatalog() },

  // Bannerweb
  { method: 'POST', match: /^\/api\/bannerweb\/analyze$/, handler: async (_, body) => {
    const raw = String(body?.raw_text || '').trim()
    if (!raw) throw new HttpError(400, 'Pasted text is empty.')
    return parseBannerwebDegreeEvaluation(raw)
  } },
  { method: 'POST', match: /^\/api\/bannerweb\/import$/, handler: async (_, body) => {
    const raw = String(body?.raw_text || '').trim()
    if (!raw) throw new HttpError(400, 'Pasted text is empty.')
    const parsed = await parseBannerwebDegreeEvaluation(raw)
    return courses.importBannerwebParseResult(parsed)
  } },

  // Reset (PR #2)
  { method: 'POST', match: /^\/api\/reset$/, handler: async () => {
    await courses.resetTrackingData()
    return courses.getSemestersSummary()
  } },

  // Course CRUD via /api/courses (semester-scoped)
  { method: 'POST', match: /^\/api\/courses$/, handler: (_, body) =>
    courses.addCourseToSemester(body.semester_id, body.course_code, body.grade) },
  { method: 'PATCH', match: /^\/api\/courses\/(\d+)$/, handler: (params, body) =>
    courses.updateCourseRecord(Number(params[1]), body?.grade ?? null) },
  { method: 'DELETE', match: /^\/api\/courses\/(\d+)$/, handler: (params) =>
    courses.deleteCourseRecord(Number(params[1])) },

  // Taken courses / semester management
  { method: 'GET', match: /^\/taken-courses\/?$/, handler: async () => [] },
  { method: 'GET', match: /^\/taken-courses\/semesters$/, handler: () => courses.getSemestersSummary() },
  { method: 'POST', match: /^\/taken-courses\/semesters$/, handler: (_, body) =>
    courses.createSemester(body.name) },
  { method: 'DELETE', match: /^\/taken-courses\/semesters\/(\d+)$/, handler: async (params) => {
    await db.deleteSemesterRow(Number(params[1]))
    return null
  } },
  { method: 'POST', match: /^\/taken-courses\/semesters\/(\d+)\/courses$/, handler: (params, body) =>
    courses.addCourseToSemester(Number(params[1]), body.course_code, body.grade) },
  { method: 'PATCH', match: /^\/taken-courses\/semesters\/(\d+)\/courses\/([^/]+)\/grade$/, handler: (params, body) =>
    courses.updateSemesterCourseGrade(Number(params[1]), decodeURIComponent(params[2]), body?.grade ?? null) },
  { method: 'DELETE', match: /^\/taken-courses\/semesters\/(\d+)\/courses\/([^/]+)$/, handler: (params) =>
    courses.deleteCourseFromSemester(Number(params[1]), decodeURIComponent(params[2])) },

  // Profile
  { method: 'GET', match: /^\/api\/programs$/, handler: () => profile.getPrograms() },
  { method: 'GET', match: /^\/api\/profile$/, handler: () => profile.getProfile() },
  { method: 'PATCH', match: /^\/api\/profile$/, handler: (_, body) => profile.updateProfile(body) },

  // Schedule
  { method: 'GET', match: /^\/api\/schedule\/terms$/, handler: () => schedule.listTerms() },
  { method: 'GET', match: /^\/api\/schedule\/([^/]+)\/planner$/, handler: (params) => schedule.getPlannerCourses(decodeURIComponent(params[1])) },
  { method: 'GET', match: /^\/api\/schedule\/([^/]+)\/courses\/([^/]+)$/, handler: (params) =>
    schedule.getCourseSchedule(decodeURIComponent(params[1]), decodeURIComponent(params[2])) },
  { method: 'GET', match: /^\/api\/schedule\/([^/]+)$/, handler: (params) => schedule.getTermSchedule(decodeURIComponent(params[1])) },

  // Plans
  { method: 'GET', match: /^\/api\/plans\/?$/, handler: (_, __, query) => plans.listPlans(query.term) },
  { method: 'GET', match: /^\/api\/plans\/(\d+)$/, handler: (params) => plans.getPlan(Number(params[1])) },
  { method: 'POST', match: /^\/api\/plans\/?$/, handler: (_, body) => plans.createPlan(body) },
  { method: 'PATCH', match: /^\/api\/plans\/(\d+)$/, handler: (params, body) => plans.updatePlan(Number(params[1]), body) },
  { method: 'DELETE', match: /^\/api\/plans\/(\d+)$/, handler: async (params) => { await plans.deletePlan(Number(params[1])); return null } },
  { method: 'POST', match: /^\/api\/plans\/(\d+)\/promote-to-semester$/, handler: (params) => plans.promotePlanToSemester(Number(params[1])) },

  // Hello (sanity check)
  { method: 'GET', match: /^\/hello$/, handler: () => ({ message: 'welcome to sugpa (client mode)' }) },
]

export async function clientRequest(method, path, body) {
  const upper = (method || 'GET').toUpperCase()
  const [pathOnly, queryString = ''] = path.split('?')
  const query = Object.fromEntries(new URLSearchParams(queryString).entries())

  for (const route of routes) {
    if (route.method !== upper) continue
    const params = pathOnly.match(route.match)
    if (!params) continue
    try {
      const result = await route.handler(params, body, query)
      return ok(result)
    } catch (err) {
      const status = err.statusCode || (err instanceof HttpError ? err.status : null)
      if (status === 404) {
        const e = new Error(err.message || 'Not found')
        e.status = 404
        throw e
      }
      const e = new Error(err.message || 'Request failed')
      e.status = status || 400
      throw e
    }
  }
  const err = new Error(`No client handler for ${upper} ${pathOnly}`)
  err.status = 404
  throw err
}
