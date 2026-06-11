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

function safeInt(value) {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.floor(n) : null
}

function getFacultyCourseRules(categoryDefinitions) {
  const definition = categoryDefinitions?.['Faculty Courses']
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return {}
  return {
    minMathCodedCourses: safeInt(definition.min_math_coded_courses),
    minFensFacultyCourses: safeInt(definition.min_fens_faculty_courses),
  }
}

function applyFacultyCourseRules(completedCodes, requiredCourses, categoryDefinitions) {
  const required = safeInt(requiredCourses)
  const completed = completedCodes.length
  if (required === null) return { completedCourses: completed, remainingCourses: null }

  const rules = getFacultyCourseRules(categoryDefinitions)
  const mathCompleted = completedCodes.filter(code => code.startsWith('MATH ')).length
  const fensFacultyCompleted = completed
  const deficits = [Math.max(0, required - completed)]

  if (rules.minMathCodedCourses !== null && rules.minMathCodedCourses !== undefined) {
    deficits.push(Math.max(0, rules.minMathCodedCourses - mathCompleted))
  }
  if (rules.minFensFacultyCourses !== null && rules.minFensFacultyCourses !== undefined) {
    deficits.push(Math.max(0, rules.minFensFacultyCourses - fensFacultyCompleted))
  }

  const remainingCourses = Math.max(...deficits)
  return {
    completedCourses: Math.max(0, required - remainingCourses),
    remainingCourses,
  }
}

function getCategoryChoiceRules(requirements, categoryName) {
  const rules = requirements?.category_choice_rules?.[categoryName]
  return Array.isArray(rules) ? rules : []
}

function getCourseDefinitionMap(value) {
  const out = new Map()
  const walk = node => {
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      if (node.course) out.set(normalizeCourseCode(node.course), node)
      for (const item of Object.values(node)) walk(item)
    } else if (Array.isArray(node)) {
      for (const item of node) walk(item)
    }
  }
  walk(value)
  return out
}

function buildChoiceOptionSets(categoryDefinition, choiceRules) {
  if (!choiceRules.length) return []

  const categoryCodes = extractCourseCodes(categoryDefinition || [])
  const allChoiceCodes = new Set()
  const pathGroups = []

  for (const rule of choiceRules) {
    const paths = Array.isArray(rule?.paths) ? rule.paths : []
    const normalizedPaths = paths
      .map(path => Array.isArray(path) ? path.map(normalizeCourseCode).filter(Boolean) : [])
      .filter(path => path.length > 0)
    if (normalizedPaths.length === 0) continue
    for (const path of normalizedPaths) {
      for (const code of path) allChoiceCodes.add(code)
    }
    pathGroups.push(normalizedPaths)
  }
  if (pathGroups.length === 0) return []

  const fixedCodes = [...categoryCodes].filter(code => !allChoiceCodes.has(code))
  let variants = [[]]
  for (const paths of pathGroups) {
    variants = variants.flatMap(existing => paths.map(path => [...existing, ...path]))
  }

  return variants.map(path => new Set([...fixedCodes, ...path]))
}

function optionRequirements(optionCodes, definitionMap, fallbackSu, fallbackCourses) {
  let requiredSu = 0
  let hasAllSu = true
  for (const code of optionCodes) {
    const su = definitionMap.get(code)?.su_credits
    if (su == null) {
      hasAllSu = false
      continue
    }
    requiredSu += Number(su)
  }
  return {
    requiredSu: hasAllSu ? round(requiredSu, 2) : fallbackSu,
    requiredCourses: optionCodes.size || fallbackCourses,
  }
}

function categoryProgressPercent(completedSu, completedEcts, completedCourses, requiredSu, requiredEcts, requiredCourses) {
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
  return progressCandidates.length ? Math.min(...progressCandidates) : null
}

function betterChoiceOption(current, candidate) {
  if (!current) return candidate
  const currentPct = current.progressPercent ?? -1
  const candidatePct = candidate.progressPercent ?? -1
  if (candidatePct !== currentPct) return candidatePct > currentPct ? candidate : current
  const currentRemaining = (current.remainingSu ?? 0) + (current.remainingCourses ?? 0)
  const candidateRemaining = (candidate.remainingSu ?? 0) + (candidate.remainingCourses ?? 0)
  return candidateRemaining < currentRemaining ? candidate : current
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
  const activeElectiveCodes = new Set([...coreCodes, ...areaCodes])

  const orderedLatestCodes = latestAttemptRows.map(r => normalizeCourseCode(r.course_code))
  const latestRowsByCode = new Map(orderedLatestCodes.map((code, i) => [code, latestAttemptRows[i]]))

  // Imported Bannerweb categories are snapshots. Fixed categories can be trusted
  // when they match the active curriculum, but elective pools must be recomputed
  // so overflow courses move up or down after manual edits.
  const bannerwebEligibility = {
    'University Courses': code => universityCodes.has(code),
    'Required Courses': code => requiredCodes.has(code),
  }
  const fixedBannerwebAllocated = {
    'University Courses': new Set(),
    'Required Courses': new Set(),
  }
  const bannerwebCoreHints = new Set()
  const bannerwebAreaHints = new Set()
  const bannerwebFreeEligible = new Set()
  for (const row of latestAttemptRows) {
    const cat = (row.bannerweb_category || '').trim()
    const code = normalizeCourseCode(row.course_code)
    if (fixedBannerwebAllocated[cat]) {
      if (bannerwebEligibility[cat](code)) fixedBannerwebAllocated[cat].add(code)
      continue
    }
    if (cat === 'Core Electives' || cat === 'Area Electives' || cat === 'Free Electives') {
      bannerwebFreeEligible.add(code)
    }
    if (fixedCodes.has(code) || activeElectiveCodes.has(code)) continue
    if (cat === 'Core Electives') bannerwebCoreHints.add(code)
    if (cat === 'Area Electives') bannerwebAreaHints.add(code)
  }

  const fixedBannerwebAssigned = new Set()
  for (const set of Object.values(fixedBannerwebAllocated)) {
    for (const code of set) fixedBannerwebAssigned.add(code)
  }

  const assigned = new Set(fixedBannerwebAssigned)
  for (const code of orderedLatestCodes) {
    if (fixedCodes.has(code) && !fixedBannerwebAssigned.has(code)) assigned.add(code)
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

  const coreEligibleCodes = new Set([...coreCodes, ...bannerwebCoreHints])
  const coreAllocated = allocateUntilSatisfied(
    orderedLatestCodes.filter(c => coreEligibleCodes.has(c) && !fixedCodes.has(c)),
    minimumSu['Core Electives'],
  )

  const areaEligibleCodes = new Set([...areaCodes, ...bannerwebAreaHints])
  const areaOrCore = new Set([...areaEligibleCodes, ...coreEligibleCodes])
  const areaAllocated = allocateUntilSatisfied(
    orderedLatestCodes.filter(c => areaOrCore.has(c) && !fixedCodes.has(c)),
    minimumSu['Area Electives'],
  )

  const freeAllocated = new Set()
  for (const code of orderedLatestCodes) {
    if (assigned.has(code)) continue
    if (fixedCodes.has(code)) continue
    const faculty = (latestRowsByCode.get(code)?.faculty || '').toUpperCase()
    if (FREE_ELECTIVE_FACULTIES.has(faculty) || bannerwebFreeEligible.has(code)) {
      freeAllocated.add(code)
    }
  }
  return {
    'University Courses': new Set([...universityCodes, ...fixedBannerwebAllocated['University Courses']]),
    'Required Courses': new Set([...requiredCodes, ...fixedBannerwebAllocated['Required Courses']]),
    'Core Electives': coreAllocated,
    'Area Electives': areaAllocated,
    'Free Electives': freeAllocated,
    'Faculty Courses': facultyCodes,
    '_Core Electives Eligible': coreEligibleCodes,
    '_Area Electives Eligible': areaEligibleCodes,
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
  const latestOrderByCode = new Map(latestRows.map((r, i) => [normalizeCourseCode(r.course_code), i]))

  const completedCodesFromSet = courseCodes => [...courseCodes]
    .filter(code => latestAttemptCodes.has(code))
    .sort((a, b) => (latestOrderByCode.get(a) ?? 0) - (latestOrderByCode.get(b) ?? 0))

  const courseDetailsFor = (codes, categoryName) => codes.map(code => {
    const row = latestRowsByCode.get(code)
    const course = catalog[code] || {}
    let su = null
    try {
      su = row ? round(rowSuCredits(row, suCredits), 2) : null
    } catch {
      su = null
    }
    const ects = row ? rowEctsCredits(row, catalog) : null
    const countedEcts = categoryName === 'Engineering'
      ? Number(row?.engineering_ects || 0)
      : categoryName === 'Basic Science'
        ? Number(row?.basic_science_ects || 0)
        : ects
    return {
      course_code: code,
      course_name: course.Name || null,
      semester_name: row?.semester_name || null,
      grade: row?.grade ?? null,
      su_credits: su,
      ects_credits: ects != null ? round(Number(ects), 2) : null,
      counted_su: categoryName === 'Engineering' || categoryName === 'Basic Science' ? null : su,
      counted_ects: countedEcts != null ? round(Number(countedEcts), 2) : null,
    }
  })

  const attributionCodeSets = {
    Engineering: new Set(
      latestRows
        .filter(row => Number(row.engineering_ects || 0) > 0)
        .map(row => normalizeCourseCode(row.course_code)),
    ),
    'Basic Science': new Set(
      latestRows
        .filter(row => Number(row.basic_science_ects || 0) > 0)
        .map(row => normalizeCourseCode(row.course_code)),
    ),
  }
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

    let requiredSu = item.min_su
    const requiredEcts = item.min_ects
    let requiredCourses = item.min_courses

    let completedSu, completedEcts, completedCourses
    let completedCourseCodes = []
    if (attributionMetrics[categoryName]) {
      [completedSu, completedEcts, completedCourses] = attributionMetrics[categoryName]
      completedCourseCodes = completedCodesFromSet(attributionCodeSets[categoryName] || new Set())
    } else {
      const courseCodes = categorySets[categoryName] || new Set()
      completedCourseCodes = completedCodesFromSet(courseCodes)
      ;[completedSu, completedEcts, completedCourses] = computeMetrics(courseCodes)
      const choiceRules = getCategoryChoiceRules(requirements, categoryName)
      const choiceOptions = buildChoiceOptionSets(categoryDefinitions[categoryName], choiceRules)
      if (choiceOptions.length > 0) {
        const definitionMap = getCourseDefinitionMap(categoryDefinitions[categoryName])
        let best = null
        for (const optionCodes of choiceOptions) {
          const [optionSu, optionEcts, optionCourses] = computeMetrics(optionCodes)
          const optionCompletedCodes = completedCodesFromSet(optionCodes)
          const optionReq = optionRequirements(
            optionCodes,
            definitionMap,
            requiredSu != null ? Number(requiredSu) : null,
            requiredCourses != null ? Math.floor(Number(requiredCourses)) : null,
          )
          const progressPercent = categoryProgressPercent(
            optionSu,
            optionEcts,
            optionCourses,
            optionReq.requiredSu,
            requiredEcts,
            optionReq.requiredCourses,
          )
          best = betterChoiceOption(best, {
            completedCodes: optionCompletedCodes,
            completedSu: optionSu,
            completedEcts: optionEcts,
            completedCourses: optionCourses,
            requiredSu: optionReq.requiredSu,
            requiredCourses: optionReq.requiredCourses,
            remainingSu: optionReq.requiredSu != null ? Math.max(0, optionReq.requiredSu - optionSu) : null,
            remainingCourses: optionReq.requiredCourses != null ? Math.max(0, optionReq.requiredCourses - optionCourses) : null,
            progressPercent,
          })
        }
        if (best) {
          completedSu = best.completedSu
          completedEcts = best.completedEcts
          completedCourses = best.completedCourses
          completedCourseCodes = best.completedCodes
          requiredSu = best.requiredSu
          requiredCourses = best.requiredCourses
        }
      }
      if (categoryName === 'Faculty Courses') {
        const completedCodes = completedCodesFromSet(courseCodes)
        completedCourseCodes = completedCodes
        completedCourses = applyFacultyCourseRules(
          completedCodes,
          requiredCourses,
          categoryDefinitions,
        ).completedCourses
      }
    }

    const remainingSu = requiredSu != null ? round(Math.max(0, Number(requiredSu) - completedSu), 2) : null
    const remainingEcts = requiredEcts != null ? round(Math.max(0, Number(requiredEcts) - completedEcts), 2) : null
    let remainingCourses = requiredCourses != null ? Math.max(0, Math.floor(Number(requiredCourses)) - completedCourses) : null
    if (categoryName === 'Faculty Courses') {
      const completedCodes = [...(categorySets[categoryName] || new Set())]
        .filter(code => latestAttemptCodes.has(code))
      const adjusted = applyFacultyCourseRules(completedCodes, requiredCourses, categoryDefinitions)
      remainingCourses = adjusted.remainingCourses
    }

    const progressPercent = categoryProgressPercent(
      completedSu,
      completedEcts,
      completedCourses,
      requiredSu,
      requiredEcts,
      requiredCourses,
    )

    categoryProgress.push({
      category: categoryName,
      required_su: requiredSu != null ? Number(requiredSu) : null,
      required_ects: requiredEcts != null ? Number(requiredEcts) : null,
      required_courses: requiredCourses != null ? Math.floor(Number(requiredCourses)) : null,
      completed_su: completedSu,
      completed_ects: completedEcts,
      completed_courses: completedCourses,
      completed_course_codes: completedCourseCodes,
      completed_course_details: courseDetailsFor(completedCourseCodes, categoryName),
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

  const programTotals = requirements?.requirement_summary?.total || {}
  const minSuTotal = programTotals.min_su != null ? Number(programTotals.min_su) : null

  const progressPercents = []
  const categoryItems = []

  for (const item of categoryRequirements) {
    if (!item || typeof item !== 'object') continue
    const categoryName = item.category
    if (!categoryName) continue

    let requiredSu = item.min_su
    const requiredEcts = item.min_ects
    let requiredCoursesCount = item.min_courses
    const courseCodes = categorySets[categoryName] || new Set()

    let completedCodes = [...courseCodes].filter(c => latestAttemptCodes.has(c)).sort()
    let completedCourseCount = categoryName === 'Faculty Courses'
      ? applyFacultyCourseRules(completedCodes, requiredCoursesCount, categoryDefinitions).completedCourses
      : completedCodes.length
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

    const choiceRules = getCategoryChoiceRules(requirements, categoryName)
    const choiceOptions = buildChoiceOptionSets(categoryDefinitions[categoryName], choiceRules)
    if (choiceOptions.length > 0) {
      const definitionMap = getCourseDefinitionMap(categoryDefinitions[categoryName])
      let best = null
      for (const optionCodes of choiceOptions) {
        const optionCompletedCodes = [...optionCodes].filter(code => latestAttemptCodes.has(code)).sort()
        let optionSu = 0.0
        let optionEcts = 0.0
        for (const code of optionCompletedCodes) {
          const row = latestRowsByCode.get(code)
          optionSu += rowSuCredits(row, suCredits)
          const ects = rowEctsCredits(row, catalog)
          if (ects != null) optionEcts += ects
        }
        optionSu = round(optionSu, 2)
        optionEcts = round(optionEcts, 2)
        const optionReq = optionRequirements(
          optionCodes,
          definitionMap,
          requiredSu != null ? Number(requiredSu) : null,
          requiredCoursesCount != null ? Math.floor(Number(requiredCoursesCount)) : null,
        )
        const progressPercent = categoryProgressPercent(
          optionSu,
          optionEcts,
          optionCompletedCodes.length,
          optionReq.requiredSu,
          requiredEcts,
          optionReq.requiredCourses,
        )
        best = betterChoiceOption(best, {
          completedCodes: optionCompletedCodes,
          completedSu: optionSu,
          completedEcts: optionEcts,
          completedCourses: optionCompletedCodes.length,
          requiredSu: optionReq.requiredSu,
          requiredCourses: optionReq.requiredCourses,
          remainingSu: optionReq.requiredSu != null ? Math.max(0, optionReq.requiredSu - optionSu) : null,
          remainingCourses: optionReq.requiredCourses != null ? Math.max(0, optionReq.requiredCourses - optionCompletedCodes.length) : null,
          progressPercent,
        })
      }
      if (best) {
        completedCodes = best.completedCodes
        completedSu = best.completedSu
        completedEcts = best.completedEcts
        completedCourseCount = best.completedCourses
        requiredSu = best.requiredSu
        requiredCoursesCount = best.requiredCourses
      }
    }

    const progressPercent = categoryProgressPercent(
      completedSu,
      completedEcts,
      completedCourseCount,
      requiredSu,
      requiredEcts,
      requiredCoursesCount,
    )
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
  let totalCreditsCompleted = 0.0
  for (const row of latestRows) totalCreditsCompleted += rowSuCredits(row, suCredits)
  totalCreditsCompleted = round(totalCreditsCompleted, 2)

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
        out.push({
          course: normalizeCourseCode(node.course),
          name: node.name,
          su_credits: node.su_credits ?? null,
          ects_credits: node.ects_credits ?? null,
        })
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
        dedup.set(code, {
          course: code,
          name: item.name,
          su_credits: item.su_credits ?? null,
          ects_credits: item.ects_credits ?? null,
        })
      }
    }
    response[name] = [...dedup.values()].sort((a, b) => a.course.localeCompare(b.course))
  }
  return { categories: response }
}
