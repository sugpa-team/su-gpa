import * as db from './db'
import { loadCourses, loadRequirements, loadFacultyCourses } from './staticData'
import {
  MAX_SEMESTER_SU_CREDITS,
  gradeToPoints,
  latestAttemptsByCourse,
  normalizeCourseCode,
  normalizeLetterGrade,
  safeProgressPercent,
  weightedGpa,
} from './gpa'

const MAX_OVERLOAD_COURSES_PER_SEMESTER = 2
const MIN_GRADUATION_GPA = 2.0

let courseCatalogCache = null
async function getCourseCatalog() {
  if (courseCatalogCache) return courseCatalogCache
  const list = await loadCourses()
  const map = new Map()
  for (const c of list) {
    if (!c.Course) continue
    map.set(normalizeCourseCode(c.Course), c)
  }
  courseCatalogCache = map
  return map
}

function courseSuCredits(courseCode, catalog) {
  const code = normalizeCourseCode(courseCode)
  const entry = catalog.get(code)
  if (!entry) {
    const err = new Error(`Course not found: ${code}`)
    err.statusCode = 404
    throw err
  }
  const su = entry['SU Credits']
  if (su === null || su === undefined) {
    throw new Error(`Course has no SU credits: ${code}`)
  }
  return Number(su)
}

function courseEctsCredits(courseCode, catalog) {
  const code = normalizeCourseCode(courseCode)
  const entry = catalog.get(code)
  if (!entry) {
    const err = new Error(`Course not found: ${code}`)
    err.statusCode = 404
    throw err
  }
  const ects = entry['ECTS Credits']
  return ects === null || ects === undefined ? null : Number(ects)
}

function toApiCourse(c) {
  return {
    course: c.Course,
    name: c.Name,
    ects_credits: c['ECTS Credits'] === undefined || c['ECTS Credits'] === null ? null : Number(c['ECTS Credits']),
    su_credits: c['SU Credits'] === undefined || c['SU Credits'] === null ? null : Number(c['SU Credits']),
    faculty: c.Faculty || null,
  }
}

export async function getCourses() {
  const list = await loadCourses()
  return list.filter(c => c.Course).map(toApiCourse)
}

export async function getRequirementsCourseCatalog() {
  const requirements = await loadRequirements()
  const facultyCourses = await loadFacultyCourses()
  const categories = requirements?.categories || {}
  if (typeof categories !== 'object' || categories === null) {
    return { categories: {} }
  }

  function extractCourses(value) {
    const collected = []
    if (Array.isArray(value)) {
      for (const item of value) collected.push(...extractCourses(item))
    } else if (value && typeof value === 'object') {
      if (value.course) {
        collected.push({ course: normalizeCourseCode(value.course), name: value.name })
      }
      for (const nested of Object.values(value)) {
        collected.push(...extractCourses(nested))
      }
    }
    return collected
  }

  const response = {}
  for (const [name, value] of Object.entries(categories)) {
    const dedup = new Map()
    for (const item of extractCourses(value)) {
      dedup.set(item.course, item)
    }
    if (name === 'Faculty Courses') {
      for (const item of facultyCourses?.courses || []) {
        if (!item || typeof item !== 'object') continue
        const code = normalizeCourseCode(item.code || '')
        if (!code) continue
        dedup.set(code, { course: code, name: item.name })
      }
    }
    response[name] = [...dedup.values()].sort((a, b) => a.course.localeCompare(b.course))
  }
  return { categories: response }
}

async function programRequiredTotals() {
  const r = await loadRequirements()
  const totals = r?.requirement_summary?.total || {}
  const minSu = totals.min_su
  const minEcts = totals.min_ects
  return {
    su: minSu === null || minSu === undefined ? null : Number(minSu),
    ects: minEcts === null || minEcts === undefined ? null : Number(minEcts),
  }
}

function extractCourseCodesFromCategory(value) {
  const codes = new Set()
  function collect(v) {
    if (Array.isArray(v)) {
      for (const item of v) collect(item)
    } else if (v && typeof v === 'object') {
      if (v.course) codes.add(normalizeCourseCode(v.course))
      for (const nested of Object.values(v)) collect(nested)
    }
  }
  collect(value)
  return codes
}

async function buildSemestersSummary() {
  const catalog = await getCourseCatalog()
  const semesters = await db.getAllSemesters()
  const allCourses = await db.getAllSemesterCourses()
  const totals = await programRequiredTotals()

  const coursesBySemester = new Map()
  for (const row of allCourses) {
    if (!coursesBySemester.has(row.semester_id)) coursesBySemester.set(row.semester_id, [])
    coursesBySemester.get(row.semester_id).push(row)
  }

  const semesterRecords = []
  for (const semester of semesters) {
    const rows = (coursesBySemester.get(semester.id) || []).sort((a, b) => a.id - b.id)
    let totalSu = 0
    const courseRecords = []
    for (const row of rows) {
      const code = normalizeCourseCode(row.course_code)
      const entry = catalog.get(code) || {}
      const su = courseSuCredits(code, catalog)
      const ects = courseEctsCredits(code, catalog)
      totalSu += su
      courseRecords.push({
        id: row.id,
        semester_id: row.semester_id,
        course_code: code,
        course_name: entry.Name || null,
        su_credits: su,
        ects_credits: ects,
        grade: row.grade || null,
        grade_points: gradeToPoints(row.grade),
        is_overload: Boolean(row.is_overload),
      })
    }
    const semesterGpa = weightedGpa(rows, code => {
      try { return courseSuCredits(code, catalog) } catch { return null }
    })
    const overloadCount = rows.filter(r => r.is_overload).length
    semesterRecords.push({
      id: semester.id,
      name: semester.name,
      total_su_credits: Math.round(totalSu * 100) / 100,
      gpa: semesterGpa,
      courses: courseRecords,
      eligible_course_codes: [],
      overload_course_count: overloadCount,
      notes: [],
    })
  }

  // Cumulative GPA from latest attempts only
  const latestMap = latestAttemptsByCourse(allCourses)
  const latestRows = [...latestMap.values()]
  const cumulativeGpa = weightedGpa(latestRows, code => {
    try { return courseSuCredits(code, catalog) } catch { return null }
  })

  let totalPlannedSu = 0
  let totalPlannedEcts = 0
  for (const row of latestRows) {
    try {
      totalPlannedSu += courseSuCredits(row.course_code, catalog)
      const ects = courseEctsCredits(row.course_code, catalog)
      if (ects !== null) totalPlannedEcts += ects
    } catch { /* skip uncatalogued */ }
  }

  const semesterGpaMap = {}
  for (const s of semesterRecords) semesterGpaMap[s.id] = s.gpa

  return {
    semesters: semesterRecords,
    cumulative_gpa: cumulativeGpa,
    max_semester_su_credits: MAX_SEMESTER_SU_CREDITS,
    total_planned_su_credits: Math.round(totalPlannedSu * 100) / 100,
    total_planned_ects_credits: Math.round(totalPlannedEcts * 100) / 100,
    program_required_su_credits: totals.su,
    program_required_ects_credits: totals.ects,
    semester_gpa: semesterGpaMap,
    cgpa: cumulativeGpa,
  }
}

export async function getSemestersSummary() {
  return buildSemestersSummary()
}

export async function createSemester(name) {
  const trimmed = String(name || '').trim()
  if (!trimmed) throw new Error('Semester name cannot be empty')
  await db.createSemesterRow(trimmed)
  return buildSemestersSummary()
}

export async function deleteSemester(semesterId) {
  await db.deleteSemesterRow(semesterId)
  return buildSemestersSummary()
}

export async function addCourseToSemester(semesterId, courseCode, grade) {
  const code = normalizeCourseCode(courseCode)
  if (!code) throw new Error('Course code cannot be empty')
  const normalizedGrade = normalizeLetterGrade(grade)

  const semester = await db.getSemester(semesterId)
  if (!semester) {
    const err = new Error(`Semester not found: ${semesterId}`)
    err.statusCode = 404
    throw err
  }

  const catalog = await getCourseCatalog()
  const newCredits = courseSuCredits(code, catalog)

  const existing = await db.findSemesterCourse(semesterId, code)
  if (existing) {
    throw new Error(`${code} already exists in semester ${semesterId}`)
  }

  const semesterCourses = await db.getSemesterCoursesBySemester(semesterId)
  const semesterTotal = semesterCourses.reduce((sum, r) => {
    try { return sum + courseSuCredits(r.course_code, catalog) } catch { return sum }
  }, 0)
  const next = semesterTotal + newCredits
  const isOverload = next > MAX_SEMESTER_SU_CREDITS
  if (isOverload) {
    const overloadCount = semesterCourses.filter(c => c.is_overload).length
    if (overloadCount >= MAX_OVERLOAD_COURSES_PER_SEMESTER) {
      throw new Error(
        `${code} cannot be added. Semester SU credits would be ${next}, exceeding the limit of ${MAX_SEMESTER_SU_CREDITS}. ` +
          `You must submit an overload request (maximum ${MAX_OVERLOAD_COURSES_PER_SEMESTER} overload courses).`,
      )
    }
  }

  await db.insertSemesterCourse({
    semester_id: Number(semesterId),
    course_code: code,
    grade: normalizedGrade,
    is_overload: isOverload ? 1 : 0,
    engineering_ects: 0,
    basic_science_ects: 0,
  })

  return buildSemestersSummary()
}

export async function updateCourseRecord(courseId, grade) {
  const normalizedGrade = normalizeLetterGrade(grade)
  const existing = await db.getSemesterCourse(courseId)
  if (!existing) {
    const err = new Error(`Course not found: ${courseId}`)
    err.statusCode = 404
    throw err
  }
  await db.updateSemesterCourseGrade(courseId, normalizedGrade)
  return buildSemestersSummary()
}

export async function deleteCourseRecord(courseId) {
  const existing = await db.getSemesterCourse(courseId)
  if (!existing) {
    const err = new Error(`Course not found: ${courseId}`)
    err.statusCode = 404
    throw err
  }
  await db.deleteSemesterCourse(courseId)
  return buildSemestersSummary()
}

export async function deleteCourseFromSemester(semesterId, courseCode) {
  const code = normalizeCourseCode(courseCode)
  const removed = await db.deleteSemesterCourseByCode(semesterId, code)
  if (!removed) {
    const err = new Error(`Course not found in semester ${semesterId}: ${code}`)
    err.statusCode = 404
    throw err
  }
  return buildSemestersSummary()
}

export async function updateSemesterCourseGrade(semesterId, courseCode, grade) {
  const code = normalizeCourseCode(courseCode)
  const existing = await db.findSemesterCourse(semesterId, code)
  if (!existing) {
    const err = new Error(`Course not found in semester ${semesterId}: ${code}`)
    err.statusCode = 404
    throw err
  }
  await db.updateSemesterCourseGrade(existing.id, normalizeLetterGrade(grade))
  return buildSemestersSummary()
}

export async function resetTrackingData() {
  await db.resetAll()
}

export async function getGraduationRequirementsProgress() {
  const requirements = await loadRequirements()
  const catalog = await getCourseCatalog()
  const facultyCoursesData = (await loadFacultyCourses())?.courses || []
  const categoryRequirements = Array.isArray(requirements?.requirement_summary?.categories)
    ? requirements.requirement_summary.categories
    : []
  const categoryDefinitions = requirements?.categories || {}

  const allRows = await db.getAllSemesterCourses()
  const latestMap = latestAttemptsByCourse(allRows)
  const latestRows = [...latestMap.values()]
  const latestCodes = new Set(latestRows.map(r => normalizeCourseCode(r.course_code)))

  const universityCodes = extractCourseCodesFromCategory(categoryDefinitions['University Courses'] || {})
  const requiredCodes = extractCourseCodesFromCategory(categoryDefinitions['Required Courses'] || [])
  const coreCodes = extractCourseCodesFromCategory(categoryDefinitions['Core Electives'] || [])
  const areaCodes = extractCourseCodesFromCategory(categoryDefinitions['Area Electives'] || [])
  const facultyCodes = new Set(
    facultyCoursesData
      .map(c => normalizeCourseCode(c?.code || ''))
      .filter(Boolean),
  )

  const explicit = new Set([...universityCodes, ...requiredCodes, ...coreCodes, ...areaCodes])
  const freeCodes = new Set()
  for (const code of latestCodes) {
    if (explicit.has(code)) continue
    const entry = catalog.get(code)
    if (!entry) continue
    const faculty = String(entry.Faculty || '').toUpperCase()
    if (['FASS', 'SBS', 'FENS'].includes(faculty)) freeCodes.add(code)
  }

  const codeSets = {
    'University Courses': universityCodes,
    'Required Courses': requiredCodes,
    'Core Electives': coreCodes,
    'Area Electives': areaCodes,
    'Free Electives': freeCodes,
    'Faculty Courses': facultyCodes,
  }

  // Engineering/Basic Science: per-row partial attributions (PR #2 schema).
  const engineeringEcts = latestRows.reduce((s, r) => s + Number(r.engineering_ects || 0), 0)
  const basicScienceEcts = latestRows.reduce((s, r) => s + Number(r.basic_science_ects || 0), 0)
  const engineeringCourses = latestRows.filter(r => Number(r.engineering_ects || 0) > 0).length
  const basicScienceCourses = latestRows.filter(r => Number(r.basic_science_ects || 0) > 0).length
  const attributionMetrics = {
    Engineering: [0, Math.round(engineeringEcts * 100) / 100, engineeringCourses],
    'Basic Science': [0, Math.round(basicScienceEcts * 100) / 100, basicScienceCourses],
  }

  function computeMetrics(courseCodes) {
    let completedSu = 0
    let completedEcts = 0
    let completedCourses = 0
    for (const code of courseCodes) {
      if (!latestCodes.has(code)) continue
      completedCourses += 1
      try { completedSu += courseSuCredits(code, catalog) } catch { /* skip */ }
      try {
        const ects = courseEctsCredits(code, catalog)
        if (ects !== null) completedEcts += ects
      } catch { /* skip */ }
    }
    return [Math.round(completedSu * 100) / 100, Math.round(completedEcts * 100) / 100, completedCourses]
  }

  const categoryProgress = []
  for (const item of categoryRequirements) {
    if (!item || typeof item !== 'object') continue
    const categoryName = item.category
    if (!categoryName) continue
    const requiredSu = item.min_su === null || item.min_su === undefined ? null : Number(item.min_su)
    const requiredEcts = item.min_ects === null || item.min_ects === undefined ? null : Number(item.min_ects)
    const requiredCourses = item.min_courses === null || item.min_courses === undefined ? null : Number(item.min_courses)
    const [completedSu, completedEcts, completedCourses] = attributionMetrics[categoryName] || computeMetrics(codeSets[categoryName] || new Set())

    const remainingSu = requiredSu === null ? null : Math.round(Math.max(0, requiredSu - completedSu) * 100) / 100
    const remainingEcts = requiredEcts === null ? null : Math.round(Math.max(0, requiredEcts - completedEcts) * 100) / 100
    const remainingCourses = requiredCourses === null ? null : Math.max(0, requiredCourses - completedCourses)

    const progressCandidates = []
    if (requiredSu !== null) {
      const v = safeProgressPercent(completedSu, requiredSu)
      if (v !== null) progressCandidates.push(v)
    }
    if (requiredEcts !== null) {
      const v = safeProgressPercent(completedEcts, requiredEcts)
      if (v !== null) progressCandidates.push(v)
    }
    if (requiredCourses !== null && requiredCourses > 0) {
      progressCandidates.push(Math.round(Math.min(100, (completedCourses / requiredCourses) * 100) * 10) / 10)
    }
    const progressPercent = progressCandidates.length ? Math.min(...progressCandidates) : null

    categoryProgress.push({
      category: categoryName,
      required_su: requiredSu,
      required_ects: requiredEcts,
      required_courses: requiredCourses,
      completed_su: completedSu,
      completed_ects: completedEcts,
      completed_courses: completedCourses,
      remaining_su: remainingSu,
      remaining_ects: remainingEcts,
      remaining_courses: remainingCourses,
      progress_percent: progressPercent,
    })
  }

  return { categories: categoryProgress }
}

export async function getProgressSummary() {
  const reqs = await getGraduationRequirementsProgress()
  const summary = await buildSemestersSummary()
  const totals = await programRequiredTotals()
  const cgpa = summary.cumulative_gpa
  const totalCreditsCompleted = summary.total_planned_su_credits

  const progressPercents = reqs.categories
    .map(c => c.progress_percent)
    .filter(v => v !== null && v !== undefined)
  const overallPercent = progressPercents.length
    ? Math.round((progressPercents.reduce((a, b) => a + b, 0) / progressPercents.length) * 10) / 10
    : 0

  const items = reqs.categories.map(c => {
    const status = c.progress_percent !== null && c.progress_percent >= 100 ? 'SATISFIED'
      : c.completed_su > 0 || c.completed_courses > 0 ? 'IN_PROGRESS' : 'NOT_STARTED'
    return {
      id: c.category.toLowerCase().replace(/\s+/g, '_'),
      name: c.category,
      credits_completed: c.completed_su,
      credits_required: c.required_su,
      completion_pct: c.progress_percent,
      status,
      completed_courses: [],
      remaining_courses: [],
    }
  })

  return {
    overall_completion_pct: overallPercent,
    total_credits_completed: totalCreditsCompleted,
    total_credits_required: totals.su,
    cgpa,
    meets_minimum_gpa: cgpa >= MIN_GRADUATION_GPA,
    categories: items,
  }
}

export async function importBannerwebParseResult(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Parsed payload must be an object.')
  }
  const sections = parsed.sections || {}

  function attributionLookup(sectionName) {
    const out = new Map()
    const section = sections[sectionName]
    if (!section || !Array.isArray(section.courses)) return out
    for (const c of section.courses) {
      const term = String(c.term || '').trim()
      const raw = String(c.course || '').trim()
      const ects = c.ects_credits
      if (!term || !raw || ects === null || ects === undefined) continue
      out.set(`${term}::${normalizeCourseCode(raw)}`, Number(ects))
    }
    return out
  }
  const engineeringLookup = attributionLookup('ENGINEERING')
  const basicScienceLookup = attributionLookup('BASIC SCIENCE')

  const coursesByTerm = new Map()
  for (const [name, section] of Object.entries(sections)) {
    if (name === 'ENGINEERING' || name === 'BASIC SCIENCE') continue
    if (!section || !Array.isArray(section.courses)) continue
    for (const course of section.courses) {
      const term = String(course.term || '').trim()
      const raw = String(course.course || '').trim()
      if (!term || !raw) continue
      if (!coursesByTerm.has(term)) coursesByTerm.set(term, [])
      coursesByTerm.get(term).push(course)
    }
  }

  const catalog = await getCourseCatalog()
  const skipped = []
  let createdSemesters = 0
  let importedCourses = 0

  const sortedTerms = [...coursesByTerm.keys()].sort()
  for (const term of sortedTerms) {
    let semester = (await db.getAllSemesters()).find(s => s.name === term)
    if (!semester) {
      semester = await db.createSemesterRow(term)
      createdSemesters += 1
    }

    for (const course of coursesByTerm.get(term)) {
      const raw = String(course.course || '').trim()
      const code = normalizeCourseCode(raw)
      let grade = null
      try { grade = normalizeLetterGrade(course.grade) } catch { grade = null }

      if (!catalog.has(code)) {
        skipped.push({ course: raw, term, reason: 'Course not found in catalog' })
        continue
      }
      const existing = await db.findSemesterCourse(semester.id, code)
      if (existing) {
        skipped.push({ course: raw, term, reason: 'Already exists in semester' })
        continue
      }

      let newCredits = 0
      let semesterCredits = 0
      try {
        newCredits = courseSuCredits(code, catalog)
        const semesterCourses = await db.getSemesterCoursesBySemester(semester.id)
        semesterCredits = semesterCourses.reduce((s, r) => {
          try { return s + courseSuCredits(r.course_code, catalog) } catch { return s }
        }, 0)
      } catch (err) {
        skipped.push({ course: raw, term, reason: String(err.message || err) })
        continue
      }
      const isOverload = (semesterCredits + newCredits) > MAX_SEMESTER_SU_CREDITS

      const key = `${term}::${code}`
      const engineeringEcts = engineeringLookup.get(key) || 0
      const basicScienceEcts = basicScienceLookup.get(key) || 0

      await db.insertSemesterCourse({
        semester_id: semester.id,
        course_code: code,
        grade,
        is_overload: isOverload ? 1 : 0,
        engineering_ects: engineeringEcts,
        basic_science_ects: basicScienceEcts,
      })
      importedCourses += 1
    }
  }

  return {
    created_semesters: createdSemesters,
    imported_courses: importedCourses,
    skipped,
    summary: await buildSemestersSummary(),
  }
}
