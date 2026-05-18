import { normalizeCourseCode, normalizeLetterGrade } from './gpa'
import { courseCatalog } from './gpa'
import { addCourseToSemester, buildSemestersSummary } from './semesters'
import { getPlans, getSemesters, newId, setPlans, setSemesters } from './storage'

function nowIso() {
  return new Date().toISOString()
}

function validateSections(sections) {
  if (!Array.isArray(sections)) throw new Error('`sections` must be a list of objects.')
  return sections.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Each section entry must be an object.')
    const courseCode = String(item.course_code || '').trim()
    const crn = String(item.crn || '').trim()
    const expectedGrade = normalizeLetterGrade(item.expected_grade)
    if (!courseCode || !crn) throw new Error('Each section entry needs course_code and crn.')
    if (expectedGrade == null) throw new Error('Each section entry needs expected_grade.')
    return {
      course_code: courseCode,
      crn,
      class_index: Number.isFinite(Number(item.class_index)) ? Math.trunc(Number(item.class_index)) : 0,
      expected_grade: expectedGrade,
    }
  })
}

export function listPlans(term) {
  const plans = getPlans()
  const filtered = term ? plans.filter(p => p.term === term) : plans
  return [...filtered].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
}

export function getPlan(planId) {
  const plan = getPlans().find(p => String(p.id) === String(planId))
  if (!plan) throw new Error(`Plan not found: ${planId}`)
  return plan
}

export function createPlan({ term, name, sections }) {
  const trimmedTerm = String(term || '').trim()
  const trimmedName = String(name || '').trim()
  if (!trimmedTerm) throw new Error('Term is required.')
  if (!trimmedName) throw new Error('Plan name is required.')
  const cleaned = validateSections(sections)

  const plans = getPlans()
  const now = nowIso()
  const plan = {
    id: newId(),
    term: trimmedTerm,
    name: trimmedName,
    sections: cleaned,
    created_at: now,
    updated_at: now,
  }
  plans.push(plan)
  setPlans(plans)
  return plan
}

export function updatePlan(planId, { name, sections } = {}) {
  const plans = getPlans()
  const plan = plans.find(p => String(p.id) === String(planId))
  if (!plan) throw new Error(`Plan not found: ${planId}`)
  if (name !== undefined) {
    const trimmed = String(name).trim()
    if (!trimmed) throw new Error('Plan name cannot be empty.')
    plan.name = trimmed
  }
  if (sections !== undefined) {
    plan.sections = validateSections(sections)
  }
  plan.updated_at = nowIso()
  setPlans(plans)
  return plan
}

export function deletePlan(planId) {
  const plans = getPlans()
  const idx = plans.findIndex(p => String(p.id) === String(planId))
  if (idx === -1) throw new Error(`Plan not found: ${planId}`)
  plans.splice(idx, 1)
  setPlans(plans)
}

export async function promotePlanToSemester(planId) {
  const plan = getPlan(planId)
  const term = plan.term
  const sections = plan.sections

  const catalog = await courseCatalog()
  const semesters = getSemesters()
  let semester = semesters.find(s => s.name === term)
  let createdSemester = false
  if (!semester) {
    semester = { id: newId(), name: term, courses: [] }
    semesters.push(semester)
    createdSemester = true
    setSemesters(semesters)
  }

  let imported = 0
  const skipped = []
  const seen = new Set()

  for (const entry of sections) {
    const rawCode = entry.course_code
    const expected = normalizeLetterGrade(entry.expected_grade)
    if (expected == null) {
      skipped.push({ course_code: rawCode, reason: 'Expected grade is required' })
      continue
    }
    const normalized = normalizeCourseCode(rawCode)
    if (seen.has(normalized)) continue
    seen.add(normalized)

    if (!(normalized in catalog)) {
      skipped.push({ course_code: rawCode, reason: 'Course not in catalog' })
      continue
    }

    try {
      await addCourseToSemester(semester.id, normalized, expected, { skipValidation: true })
      imported += 1
    } catch (err) {
      skipped.push({ course_code: rawCode, reason: err.message })
    }
  }

  return {
    plan_id: planId,
    semester_id: semester.id,
    semester_name: term,
    created_semester: createdSemester,
    imported_courses: imported,
    skipped,
    summary: await buildSemestersSummary(),
  }
}
