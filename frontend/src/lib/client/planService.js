import * as db from './db'
import { loadCourses } from './staticData'
import { normalizeCourseCode } from './gpa'
import { getSemestersSummary } from './coursesService'

function validateSections(sections) {
  if (!Array.isArray(sections)) {
    throw new Error('`sections` must be a list of objects.')
  }
  return sections.map(item => {
    if (!item || typeof item !== 'object') {
      throw new Error('Each section entry must be an object.')
    }
    const courseCode = String(item.course_code || '').trim()
    const crn = String(item.crn || '').trim()
    if (!courseCode || !crn) {
      throw new Error('Each section entry needs course_code and crn.')
    }
    return {
      course_code: courseCode,
      crn,
      class_index: Number(item.class_index || 0),
    }
  })
}

export async function listPlans(term) {
  const plans = await db.getAllPlans(term)
  return { plans }
}

export async function getPlan(planId) {
  const plan = await db.getPlan(planId)
  if (!plan) {
    const err = new Error(`Plan not found: ${planId}`)
    err.statusCode = 404
    throw err
  }
  return plan
}

export async function createPlan({ term, name, sections }) {
  if (!String(term || '').trim()) throw new Error('Term is required.')
  if (!String(name || '').trim()) throw new Error('Plan name is required.')
  const cleaned = validateSections(sections)
  return db.createPlanRow({
    term: String(term).trim(),
    name: String(name).trim(),
    sections: cleaned,
  })
}

export async function updatePlan(planId, { name, sections } = {}) {
  const existing = await db.getPlan(planId)
  if (!existing) {
    const err = new Error(`Plan not found: ${planId}`)
    err.statusCode = 404
    throw err
  }
  const patch = {}
  if (name !== undefined && name !== null) {
    if (!String(name).trim()) throw new Error('Plan name cannot be empty.')
    patch.name = String(name).trim()
  }
  if (sections !== undefined && sections !== null) {
    patch.sections = validateSections(sections)
  }
  if (Object.keys(patch).length === 0) return existing
  return db.updatePlanRow(planId, patch)
}

export async function deletePlan(planId) {
  const existing = await db.getPlan(planId)
  if (!existing) {
    const err = new Error(`Plan not found: ${planId}`)
    err.statusCode = 404
    throw err
  }
  await db.deletePlanRow(planId)
}

export async function promotePlanToSemester(planId) {
  const plan = await getPlan(planId)
  const term = plan.term
  const sections = plan.sections || []

  const catalogList = await loadCourses()
  const catalog = new Map()
  for (const c of catalogList) {
    if (c.Course) catalog.set(normalizeCourseCode(c.Course), c)
  }

  let semester = (await db.getAllSemesters()).find(s => s.name === term)
  let createdSemester = false
  if (!semester) {
    semester = await db.createSemesterRow(term)
    createdSemester = true
  }

  let imported = 0
  const skipped = []
  for (const entry of sections) {
    const rawCode = entry.course_code
    const normalized = normalizeCourseCode(rawCode)
    if (!catalog.has(normalized)) {
      skipped.push({ course_code: rawCode, reason: 'Course not in catalog' })
      continue
    }
    const dup = await db.findSemesterCourse(semester.id, normalized)
    if (dup) {
      skipped.push({ course_code: rawCode, reason: 'Already in semester' })
      continue
    }
    try {
      await db.insertSemesterCourse({
        semester_id: semester.id,
        course_code: normalized,
        grade: null,
        is_overload: 0,
        engineering_ects: 0,
        basic_science_ects: 0,
      })
      imported += 1
    } catch (err) {
      skipped.push({ course_code: rawCode, reason: String(err.message || err) })
    }
  }

  return {
    plan_id: planId,
    semester_id: semester.id,
    semester_name: term,
    created_semester: createdSemester,
    imported_courses: imported,
    skipped,
    summary: await getSemestersSummary(),
  }
}
