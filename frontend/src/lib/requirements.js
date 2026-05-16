import {
  courseCatalog,
  gradeToPoints,
  normalizeCourseCode,
  rowEctsCredits,
  rowSuCredits,
  suCreditsByCourseCode,
  weightedGpaFromRows,
} from './gpa'
import { loadFacultyCourses, loadRequirements } from './staticData'

const FREE_ELECTIVE_FACULTIES = new Set(['FASS', 'SBS', 'FENS'])
const BANNERWEB_PRIMARY_CATEGORIES = {
  'UNIVERSITY COURSES': 'University Courses',
  'REQUIRED COURSES': 'Required Courses',
  'CORE ELECTIVES': 'Core Electives',
  'AREA ELECTIVES': 'Area Electives',
  'FREE ELECTIVES': 'Free Electives',
}
const CATEGORIES_WITH_REMAINING = new Set(['Core Electives', 'Area Electives'])
export const MIN_GRADUATION_GPA = 2.0

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function safeProgressPct(completed, required) {
  if (!required || required <= 0) return null
  return round(Math.min(100, (completed / required) * 100), 1)
}

export function extractCourseCodes(value) {
  const codes = new Set()
  const walk = node => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      const raw = node.course
      if (raw) codes.add(normalizeCourseCode(raw))
      for (const v of Object.values(node)) walk(v)
    } else if (Array.isArray(node)) {
      for (const item of node) walk(item)
    }
  }
  walk(value)
  return codes
}

function minSuPerCategory(categoryRequirements) {
  const out = {}
  for (const item of categoryRequirements) {
    if (!item || typeof item !== 'object') continue
    if (!item.category || item.min_su == null) continue
    out[item.category] = Number(item.min_su)
  }
  return out
}

export async function getCategoryMembership() {
  const requirements = await loadRequirements()
  const categoryDefinitions = requirements?.categories || {}
  const facultyCourses = await loadFacultyCourses()
  const membership = {}

  const add = (code, category) => {
    if (!code) return
    if (!membership[code]) membership[code] = []
    if (!membership[code].includes(category)) membership[code].push(category)
  }

  for (const name of ['University Courses', 'Required Courses', 'Core Electives', 'Area Electives']) {
    for (const code of extractCourseCodes(categoryDefinitions[name] || [])) {
      add(code, name)
    }
  }
  for (const item of facultyCourses) {
    if (item && typeof item === 'object') {
      add(normalizeCourseCode(item.code || ''), 'Faculty Courses')
    }
  }
  return membership
}

function buildCategoryCodeSets(latestAttemptRows, categoryRequirements, categoryDefinitions, facultyCodes, suCredits) {
  const universityCodes = extractCourseCodes(categoryDefinitions['University Courses'] || {})
  const requiredCodes = extractCourseCodes(categoryDefinitions['Required Courses'] || [])
  const coreCodes = extractCourseCodes(categoryDefinitions['Core Electives'] || [])
  const areaCodes = extractCourseCodes(categoryDefinitions['Area Electives'] || [])
  const fixedCodes = new Set([...universityCodes, ...requiredCodes])

  const orderedLatestCodes = latestAttemptRows.map(r => normalizeCourseCode(r.course_code))
  const latestRowsByCode = new Map(orderedLatestCodes.map((code, i) => [code, latestAttemptRows[i]]))

  const bannerwebAllocated = {}
  for (const name of Object.values(BANNERWEB_PRIMARY_CATEGORIES)) bannerwebAllocated[name] = new Set()
  for (const row of latestAttemptRows) {
    const cat = (row.bannerweb_category || '').trim()
    if (bannerwebAllocated[cat]) bannerwebAllocated[cat].add(normalizeCourseCode(row.course_code))
  }

  const bannerwebAssigned = new Set()
  for (const set of Object.values(bannerwebAllocated)) {
    for (const code of set) bannerwebAssigned.add(code)
  }

  const assigned = new Set(bannerwebAssigned)
  for (const code of orderedLatestCodes) {
    if (fixedCodes.has(code) && !bannerwebAssigned.has(code)) assigned.add(code)
  }

  const minimumSu = minSuPerCategory(categoryRequirements)

  function allocateUntilSatisfied(candidates, requiredSu) {
    const allocated = new Set()
    let completedSu = 0.0
    for (const code of candidates) {
      if (assigned.has(code)) continue
      if (requiredSu != null && completedSu >= requiredSu) break
      allocated.add(code)
      assigned.add(code)
      const row = latestRowsByCode.get(code)
      if (row) {
        try {
          completedSu += rowSuCredits(row, suCredits)
        } catch {
          // ignore
        }
      }
    }
    return allocated
  }

  const coreAllocated = new Set(bannerwebAllocated['Core Electives'])
  for (const code of allocateUntilSatisfied(
    orderedLatestCodes.filter(c => coreCodes.has(c) && !fixedCodes.has(c)),
    minimumSu['Core Electives'],
  )) coreAllocated.add(code)

  const areaAllocated = new Set(bannerwebAllocated['Area Electives'])
  const areaOrCore = new Set([...areaCodes, ...coreCodes])
  for (const code of allocateUntilSatisfied(
    orderedLatestCodes.filter(c => areaOrCore.has(c) && !fixedCodes.has(c)),
    minimumSu['Area Electives'],
  )) areaAllocated.add(code)

  const freeAllocated = new Set()
  for (const code of orderedLatestCodes) {
    if (assigned.has(code)) continue
    if (fixedCodes.has(code)) continue
    const row = latestRowsByCode.get(code)
    const codeKey = code
    const faculty = (latestRowsByCode.get(codeKey)?.faculty || '').toUpperCase()
    if (FREE_ELECTIVE_FACULTIES.has(faculty)) freeAllocated.add(code)
    void row
  }
  for (const code of bannerwebAllocated['Free Electives']) freeAllocated.add(code)

  return {
    'University Courses': new Set([...universityCodes, ...bannerwebAllocated['University Courses']]),
    'Required Courses': new Set([...requiredCodes, ...bannerwebAllocated['Required Courses']]),
    'Core Electives': coreAllocated,
    'Area Electives': areaAllocated,
    'Free Electives': freeAllocated,
    'Faculty Courses': facultyCodes,
    '_Core Electives Eligible': coreCodes,
    '_Area Electives Eligible': areaCodes,
  }
}

function latestAttemptsByCourse(rows) {
  const map = new Map()
  for (const row of rows) {
    const code = normalizeCourseCode(row.course_code)
    const current = map.get(code)
    if (!current) {
      map.set(code, row)
      continue
    }
    // Order key: (semester_order, course_order) — later wins
    const currKey = [current._semester_order ?? 0, current._course_order ?? 0]
    const newKey = [row._semester_order ?? 0, row._course_order ?? 0]
    if (newKey[0] > currKey[0] || (newKey[0] === currKey[0] && newKey[1] > currKey[1])) {
      map.set(code, row)
    }
  }
  return map
}

export async function flattenRows(semesters) {
  // Convert semester[] → flat row[] with order info, computed faculty for free elective eligibility.
  const catalog = await courseCatalog()
  const rows = []
  semesters.forEach((semester, semesterIdx) => {
    (semester.courses || []).forEach((c, courseIdx) => {
      const normalized = normalizeCourseCode(c.course_code)
      const catalogEntry = catalog[normalized] || {}
      rows.push({
        ...c,
        course_code: normalized,
        semester_id: semester.id,
        semester_name: semester.name,
        _semester_order: semesterIdx,
        _course_order: courseIdx,
        faculty: c.faculty || catalogEntry.Faculty || null,
        engineering_ects: c.engineering_ects ?? 0,
        basic_science_ects: c.basic_science_ects ?? 0,
      })
    })
  })
  return rows
}

export async function getGraduationRequirementsProgress(semesters) {
  const requirements = await loadRequirements()
  const categoryRequirements = Array.isArray(requirements?.requirement_summary?.categories)
    ? requirements.requirement_summary.categories
    : []
  const categoryDefinitions = (requirements?.categories && typeof requirements.categories === 'object')
    ? requirements.categories
    : {}

  const allRows = await flattenRows(semesters)
  const latest = latestAttemptsByCourse(allRows)
  const latestRows = [...latest.values()]

  const suCredits = await suCreditsByCourseCode()
  const catalog = await courseCatalog()
  const facultyCourses = await loadFacultyCourses()
  const facultyCodes = new Set(
    facultyCourses
      .filter(item => item && typeof item === 'object' && item.code)
      .map(item => normalizeCourseCode(item.code)),
  )

  const engineeringEcts = round(latestRows.reduce((s, r) => s + Number(r.engineering_ects || 0), 0), 2)
  const basicScienceEcts = round(latestRows.reduce((s, r) => s + Number(r.basic_science_ects || 0), 0), 2)
  const engineeringCourses = latestRows.filter(r => Number(r.engineering_ects || 0) > 0).length
  const basicScienceCourses = latestRows.filter(r => Number(r.basic_science_ects || 0) > 0).length

  const categorySets = buildCategoryCodeSets(latestRows, categoryRequirements, categoryDefinitions, facultyCodes, suCredits)

  const latestAttemptCodes = new Set(latestRows.map(r => normalizeCourseCode(r.course_code)))
  const latestRowsByCode = new Map(latestRows.map(r => [normalizeCourseCode(r.course_code), r]))

  const attributionMetrics = {
    Engineering: [0.0, engineeringEcts, engineeringCourses],
    'Basic Science': [0.0, basicScienceEcts, basicScienceCourses],
  }

  const computeMetrics = courseCodes => {
    let completedSu = 0.0
    let completedEcts = 0.0
    let completedCourses = 0
    for (const code of courseCodes) {
      if (!latestAttemptCodes.has(code)) continue
      completedCourses += 1
      const row = latestRowsByCode.get(code)
      completedSu += rowSuCredits(row, suCredits)
      const ects = rowEctsCredits(row, catalog)
      if (ects != null) completedEcts += ects
    }
    return [round(completedSu, 2), round(completedEcts, 2), completedCourses]
  }

  const categoryProgress = []
  for (const item of categoryRequirements) {
    if (!item || typeof item !== 'object') continue
    const categoryName = item.category
    if (!categoryName) continue

    const requiredSu = item.min_su
    const requiredEcts = item.min_ects
    const requiredCourses = item.min_courses

    let completedSu, completedEcts, completedCourses
    if (attributionMetrics[categoryName]) {
      [completedSu, completedEcts, completedCourses] = attributionMetrics[categoryName]
    } else {
      const courseCodes = categorySets[categoryName] || new Set()
      ;[completedSu, completedEcts, completedCourses] = computeMetrics(courseCodes)
    }

    const remainingSu = requiredSu != null ? round(Math.max(0, Number(requiredSu) - completedSu), 2) : null
    const remainingEcts = requiredEcts != null ? round(Math.max(0, Number(requiredEcts) - completedEcts), 2) : null
    const remainingCourses = requiredCourses != null ? Math.max(0, Math.floor(Number(requiredCourses)) - completedCourses) : null

    const progressCandidates = []
    if (requiredSu != null) {
      const v = safeProgressPct(completedSu, Number(requiredSu))
      if (v != null) progressCandidates.push(v)
    }
    if (requiredEcts != null) {
      const v = safeProgressPct(completedEcts, Number(requiredEcts))
      if (v != null) progressCandidates.push(v)
    }
    if (requiredCourses != null && Number(requiredCourses) > 0) {
      progressCandidates.push(round(Math.min(100, (completedCourses / Number(requiredCourses)) * 100), 1))
    }
    const progressPercent = progressCandidates.length ? Math.min(...progressCandidates) : null

    categoryProgress.push({
      category: categoryName,
      required_su: requiredSu != null ? Number(requiredSu) : null,
      required_ects: requiredEcts != null ? Number(requiredEcts) : null,
      required_courses: requiredCourses != null ? Math.floor(Number(requiredCourses)) : null,
      completed_su: completedSu,
      completed_ects: completedEcts,
      completed_courses: completedCourses,
      remaining_su: remainingSu,
      remaining_ects: remainingEcts,
      remaining_courses: remainingCourses,
      progress_percent: progressPercent,
    })
  }

  let totalCreditsCompleted = 0.0
  let totalEctsCompleted = 0.0
  for (const row of latestRows) {
    totalCreditsCompleted += rowSuCredits(row, suCredits)
    const ects = rowEctsCredits(row, catalog)
    if (ects != null) totalEctsCompleted += ects
  }
  totalCreditsCompleted = round(totalCreditsCompleted, 2)
  totalEctsCompleted = round(totalEctsCompleted, 2)

  const programTotals = requirements?.requirement_summary?.total || {}
  const programRequiredSu = programTotals.min_su != null ? Number(programTotals.min_su) : null
  const programRequiredEcts = programTotals.min_ects != null ? Number(programTotals.min_ects) : null

  return {
    categories: categoryProgress,
    total_credits_completed: totalCreditsCompleted,
    total_credits_required: programRequiredSu,
    total_ects_completed: totalEctsCompleted,
    total_ects_required: programRequiredEcts,
  }
}

export async function getProgressSummary(semesters) {
  const requirements = await loadRequirements()
  const categoryRequirements = Array.isArray(requirements?.requirement_summary?.categories)
    ? requirements.requirement_summary.categories
    : []
  const categoryDefinitions = (requirements?.categories && typeof requirements.categories === 'object')
    ? requirements.categories
    : {}

  const allRows = await flattenRows(semesters)
  const latest = latestAttemptsByCourse(allRows)
  const latestRows = [...latest.values()]
  const latestGraded = latestRows.filter(r => gradeToPoints(r.grade) != null)

  const suCredits = await suCreditsByCourseCode()
  const facultyCourses = await loadFacultyCourses()
  const facultyCodes = new Set(
    facultyCourses
      .filter(item => item && typeof item === 'object' && item.code)
      .map(item => normalizeCourseCode(item.code)),
  )

  const cgpa = weightedGpaFromRows(latestGraded, suCredits)
  const latestAttemptCodes = new Set(latestRows.map(r => normalizeCourseCode(r.course_code)))
  const latestRowsByCode = new Map(latestRows.map(r => [normalizeCourseCode(r.course_code), r]))

  const categorySets = buildCategoryCodeSets(latestRows, categoryRequirements, categoryDefinitions, facultyCodes, suCredits)

  let totalCreditsCompleted = 0.0
  for (const row of latestRows) totalCreditsCompleted += rowSuCredits(row, suCredits)
  totalCreditsCompleted = round(totalCreditsCompleted, 2)

  const programTotals = requirements?.requirement_summary?.total || {}
  const minSuTotal = programTotals.min_su != null ? Number(programTotals.min_su) : null

  const progressPercents = []
  const categoryItems = []

  for (const item of categoryRequirements) {
    if (!item || typeof item !== 'object') continue
    const categoryName = item.category
    if (!categoryName) continue

    const requiredSu = item.min_su
    const requiredEcts = item.min_ects
    const requiredCoursesCount = item.min_courses
    const courseCodes = categorySets[categoryName] || new Set()

    const completedCodes = [...courseCodes].filter(c => latestAttemptCodes.has(c)).sort()
    let completedSu = 0.0
    let completedEcts = 0.0
    const catalog = await courseCatalog()
    for (const code of completedCodes) {
      const row = latestRowsByCode.get(code)
      completedSu += rowSuCredits(row, suCredits)
      const ects = rowEctsCredits(row, catalog)
      if (ects != null) completedEcts += ects
    }
    completedSu = round(completedSu, 2)
    completedEcts = round(completedEcts, 2)

    const progressCandidates = []
    if (requiredSu != null) {
      const v = safeProgressPct(completedSu, Number(requiredSu))
      if (v != null) progressCandidates.push(v)
    }
    if (requiredEcts != null) {
      const v = safeProgressPct(completedEcts, Number(requiredEcts))
      if (v != null) progressCandidates.push(v)
    }
    if (requiredCoursesCount != null && Number(requiredCoursesCount) > 0) {
      progressCandidates.push(
        round(Math.min(100, (completedCodes.length / Number(requiredCoursesCount)) * 100), 1),
      )
    }
    const progressPercent = progressCandidates.length ? Math.min(...progressCandidates) : null
    if (progressPercent != null) progressPercents.push(progressPercent)

    let status = 'NOT_STARTED'
    if (progressPercent != null && progressPercent >= 100) status = 'SATISFIED'
    else if (completedSu > 0 || completedCodes.length > 0) status = 'IN_PROGRESS'

    const remainingCodes = CATEGORIES_WITH_REMAINING.has(categoryName)
      ? [...(categorySets[`_${categoryName} Eligible`] || courseCodes)]
          .filter(c => !latestAttemptCodes.has(c))
          .sort()
      : []

    categoryItems.push({
      id: categoryName.toLowerCase().replace(/ /g, '_'),
      name: categoryName,
      credits_completed: completedSu,
      credits_required: requiredSu != null ? Number(requiredSu) : null,
      completion_pct: progressPercent,
      status,
      completed_courses: completedCodes,
      remaining_courses: remainingCodes,
    })
  }

  const overallCompletionPct = progressPercents.length
    ? round(progressPercents.reduce((a, b) => a + b, 0) / progressPercents.length, 1)
    : 0.0

  return {
    overall_completion_pct: overallCompletionPct,
    total_credits_completed: totalCreditsCompleted,
    total_credits_required: minSuTotal,
    cgpa,
    meets_minimum_gpa: cgpa >= MIN_GRADUATION_GPA,
    categories: categoryItems,
  }
}

export async function getRequirementsCourseCatalog() {
  const requirements = await loadRequirements()
  const categories = requirements?.categories || {}
  if (!categories || typeof categories !== 'object') return { categories: {} }

  const extractCourses = node => {
    const out = []
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      if (node.course) {
        out.push({ course: normalizeCourseCode(node.course), name: node.name })
      }
      for (const v of Object.values(node)) out.push(...extractCourses(v))
    } else if (Array.isArray(node)) {
      for (const item of node) out.push(...extractCourses(item))
    }
    return out
  }

  const facultyCourses = await loadFacultyCourses()
  const response = {}
  for (const [name, value] of Object.entries(categories)) {
    const dedup = new Map()
    for (const item of extractCourses(value)) {
      dedup.set(item.course, item)
    }
    if (name === 'Faculty Courses') {
      for (const item of facultyCourses) {
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
