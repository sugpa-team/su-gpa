import {
  courseCatalog,
  gradeToPoints,
  MAX_SEMESTER_SU_CREDITS,
  normalizeCourseCode,
  normalizeLetterGrade,
  rowEctsCredits,
  rowSuCredits,
  suCreditsByCourseCode,
  weightedGpaFromRows,
} from './gpa'
import { loadRequirements } from './staticData'
import { getSemesters, newId, setSemesters } from './storage'

const MAX_OVERLOAD_COURSES_PER_SEMESTER = 2
const PROJ_201_CODE = 'PROJ 201'
const ENS_491_CODE = 'ENS 491'
const ENS_492_CODE = 'ENS 492'
const MIN_SU_FOR_ENS_491 = 80
const PROJ_201_AUTO_ADD_NOTE =
  'PROJ 201 was automatically added because it was not taken in the first three semesters.'
const BANNERWEB_PRIMARY_SECTION_CATEGORIES = {
  'UNIVERSITY COURSES': 'University Courses',
  'REQUIRED COURSES': 'Required Courses',
  'CORE ELECTIVES': 'Core Electives',
  'AREA ELECTIVES': 'Area Electives',
  'FREE ELECTIVES': 'Free Electives',
}

function isBannerwebImportedCourse(course) {
  if (!course || typeof course !== 'object') return false
  if (course.source === 'bannerweb') return true
  return (
    Object.prototype.hasOwnProperty.call(course, 'bannerweb_category') ||
    Object.prototype.hasOwnProperty.call(course, 'bannerweb_su_credits') ||
    Object.prototype.hasOwnProperty.call(course, 'bannerweb_ects_credits')
  )
}

function hasBannerwebImportedCourses(semesters) {
  return semesters.some(semester =>
    (semester.courses || []).some(course => isBannerwebImportedCourse(course)),
  )
}

function regularTermIndex(name) {
  const t = String(name || '').trim()
  if (!/^\d{6}$/.test(t)) return null
  const year = parseInt(t.slice(0, 4), 10)
  const suffix = t.slice(4)
  if (suffix === '01') return year * 2
  if (suffix === '02') return year * 2 + 1
  return null
}

function countsForRetakeWindow(name) {
  const t = String(name || '').trim()
  return !/^\d{4}03$/.test(t)
}

let prereqMapCache = null

async function prerequisitesByCourse() {
  if (prereqMapCache) return prereqMapCache
  const requirements = await loadRequirements()
  const courses = requirements?.prerequisites?.courses
  const mapping = new Map()
  if (Array.isArray(courses)) {
    for (const item of courses) {
      if (!item || typeof item !== 'object') continue
      const code = normalizeCourseCode(item.code || '')
      if (!code) continue
      const prereqs = Array.isArray(item.prerequisites) ? item.prerequisites : []
      mapping.set(
        code,
        new Set(prereqs.map(p => normalizeCourseCode(p)).filter(Boolean)),
      )
    }
  }
  prereqMapCache = mapping
  return mapping
}

function previousSemesterCourseCodes(semesters, idx) {
  const codes = new Set()
  for (let i = 0; i < idx; i++) {
    for (const c of semesters[i].courses || []) {
      codes.add(normalizeCourseCode(c.course_code))
    }
  }
  return codes
}

function previousSemesterTotalSuCredits(semesters, idx, suCredits) {
  let total = 0
  for (let i = 0; i < idx; i++) {
    for (const c of semesters[i].courses || []) {
      try {
        total += rowSuCredits(c, suCredits)
      } catch {
        // ignore catalog miss
      }
    }
  }
  return total
}

function countedSemestersBefore(semesters, idx) {
  let count = 0
  for (let i = 0; i < idx; i++) {
    if (countsForRetakeWindow(semesters[i].name)) count++
  }
  return count
}

function findSemesterIdxForCourse(semesters, courseCode) {
  const code = normalizeCourseCode(courseCode)
  for (let i = 0; i < semesters.length; i++) {
    if ((semesters[i].courses || []).some(c => normalizeCourseCode(c.course_code) === code)) {
      return i
    }
  }
  return -1
}

function ensurePrerequisitesMet(semesters, idx, courseCode, prereqMap) {
  const required = prereqMap.get(courseCode) || new Set()
  if (required.size === 0) return
  const completed = previousSemesterCourseCodes(semesters, idx)
  const missing = [...required].filter(p => !completed.has(p)).sort()
  if (missing.length > 0) {
    throw new Error(
      `${courseCode} cannot be added before completing prerequisites: ${missing.join(', ')}.`,
    )
  }
}

function ensureGraduationProjectRules(semesters, idx, courseCode, suCredits) {
  const code = normalizeCourseCode(courseCode)

  if (code === PROJ_201_CODE) {
    if (countedSemestersBefore(semesters, idx) >= 4) {
      throw new Error('PROJ 201 cannot be added after the fourth regular semester.')
    }
    return
  }

  if (code !== ENS_491_CODE && code !== ENS_492_CODE) return

  if (code === ENS_491_CODE) {
    const completedSu = previousSemesterTotalSuCredits(semesters, idx, suCredits)
    if (completedSu < MIN_SU_FOR_ENS_491) {
      throw new Error(
        `ENS 491 cannot be added before completing at least ${MIN_SU_FOR_ENS_491} SU credits in previous semesters.`,
      )
    }
    const ens492Idx = findSemesterIdxForCourse(semesters, ENS_492_CODE)
    if (ens492Idx !== -1 && ens492Idx !== idx + 1) {
      throw new Error('ENS 491 and ENS 492 must be taken in consecutive semesters.')
    }
  }

  if (code === ENS_492_CODE) {
    if (idx === 0) {
      throw new Error(
        'ENS 492 cannot be added to the first semester. ENS 491 and ENS 492 must be taken in consecutive semesters.',
      )
    }
    const prevSem = semesters[idx - 1]
    const hasEns491 = (prevSem.courses || []).some(
      c => normalizeCourseCode(c.course_code) === ENS_491_CODE,
    )
    if (!hasEns491) {
      throw new Error(
        'ENS 492 can only be added if ENS 491 is taken in the immediately previous semester.',
      )
    }
  }
}

function canRetakeInSemester(semesters, idx, courseCode) {
  const code = normalizeCourseCode(courseCode)
  const target = semesters[idx]
  if (!target) return [false, `Semester not found: ${idx}`]
  if (!countsForRetakeWindow(target.name)) return [true, null]

  const targetTermIdx = regularTermIndex(target.name)
  const countedIndices = []
  semesters.forEach((s, i) => {
    if (countsForRetakeWindow(s.name)) countedIndices.push(i)
  })
  if (!countedIndices.includes(idx)) return [true, null]
  const targetPosition = countedIndices.indexOf(idx)

  let latestDistance = null
  let latestTerm = ''
  for (let i = 0; i < semesters.length; i++) {
    if (i === idx) continue
    if (!countsForRetakeWindow(semesters[i].name)) continue
    if (!(semesters[i].courses || []).some(c => normalizeCourseCode(c.course_code) === code)) continue

    const attemptTermIdx = regularTermIndex(semesters[i].name)
    let distance =
      targetTermIdx != null && attemptTermIdx != null
        ? targetTermIdx - attemptTermIdx
        : null
    if (distance == null) {
      if (!countedIndices.includes(i)) continue
      distance = targetPosition - countedIndices.indexOf(i)
    }
    if (distance < 0) continue
    if (latestDistance == null || distance < latestDistance) {
      latestDistance = distance
      latestTerm = semesters[i].name
    }
  }

  if (latestDistance == null || latestDistance <= 3) return [true, null]
  return [
    false,
    `${code} was last taken in ${latestTerm}; retakes are only allowed within three regular semesters.`,
  ]
}

function retakeBlockedCourseCodes(semesters, idx) {
  const target = semesters[idx]
  if (!target) return new Set()
  if (!countsForRetakeWindow(target.name)) return new Set()

  const targetTermIdx = regularTermIndex(target.name)
  const countedIndices = []
  semesters.forEach((s, i) => {
    if (countsForRetakeWindow(s.name)) countedIndices.push(i)
  })
  if (!countedIndices.includes(idx)) return new Set()
  const targetPosition = countedIndices.indexOf(idx)

  const latestDistanceByCourse = new Map()
  for (let i = 0; i < semesters.length; i++) {
    if (i === idx) continue
    if (!countsForRetakeWindow(semesters[i].name)) continue
    for (const c of semesters[i].courses || []) {
      const code = normalizeCourseCode(c.course_code)
      const attemptTermIdx = regularTermIndex(semesters[i].name)
      let distance =
        targetTermIdx != null && attemptTermIdx != null
          ? targetTermIdx - attemptTermIdx
          : null
      if (distance == null) {
        if (!countedIndices.includes(i)) continue
        distance = targetPosition - countedIndices.indexOf(i)
      }
      if (distance < 0) continue
      const current = latestDistanceByCourse.get(code)
      if (current == null || distance < current) {
        latestDistanceByCourse.set(code, distance)
      }
    }
  }

  const blocked = new Set()
  for (const [code, dist] of latestDistanceByCourse) {
    if (dist > 3) blocked.add(code)
  }
  return blocked
}

function eligibleCourseCodesForSemester(semesters, idx, allCodes, prereqMap, suCredits) {
  const completedBefore = previousSemesterCourseCodes(semesters, idx)
  const retakeBlocked = retakeBlockedCourseCodes(semesters, idx)
  const eligible = []
  for (const code of allCodes) {
    if (retakeBlocked.has(code)) continue
    const required = prereqMap.get(code) || new Set()
    let allMet = true
    for (const p of required) {
      if (!completedBefore.has(p)) { allMet = false; break }
    }
    if (!allMet) continue
    try {
      ensureGraduationProjectRules(semesters, idx, code, suCredits)
    } catch {
      continue
    }
    eligible.push(code)
  }
  return eligible
}

function enforceProj201BySemesterFour(semesters, suCredits) {
  const countedIndices = []
  semesters.forEach((s, i) => {
    if (countsForRetakeWindow(s.name)) countedIndices.push(i)
  })
  if (countedIndices.length < 4) return null

  const fourthIdx = countedIndices[3]

  for (let i = 0; i < fourthIdx; i++) {
    if ((semesters[i].courses || []).some(c => normalizeCourseCode(c.course_code) === PROJ_201_CODE)) {
      return null
    }
  }

  if ((semesters[fourthIdx].courses || []).some(c => normalizeCourseCode(c.course_code) === PROJ_201_CODE)) {
    return fourthIdx
  }

  const projCredits = suCredits[PROJ_201_CODE]
  if (projCredits == null) return null

  const semesterCredits = semesterCreditTotal(semesters[fourthIdx], suCredits)
  const isOverload = semesterCredits + projCredits > MAX_SEMESTER_SU_CREDITS
  semesters[fourthIdx].courses = semesters[fourthIdx].courses || []
  semesters[fourthIdx].courses.push({
    id: newId(),
    course_code: PROJ_201_CODE,
    grade: null,
    is_overload: isOverload,
    _auto_added: true,
  })
  return fourthIdx
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function semesterCreditTotal(semester, suCredits) {
  let total = 0
  for (const c of semester.courses || []) {
    try {
      total += rowSuCredits(c, suCredits)
    } catch {
      // ignore catalog miss
    }
  }
  return total
}

function semesterOverloadCount(semester) {
  return (semester.courses || []).filter(c => c.is_overload).length
}

function latestAttemptsByCourse(semesters) {
  const map = new Map()
  semesters.forEach((semester, semIdx) => {
    (semester.courses || []).forEach((c, cIdx) => {
      const code = normalizeCourseCode(c.course_code)
      const entry = {
        ...c,
        course_code: code,
        semester_id: semester.id,
        semester_name: semester.name,
        _semester_order: semIdx,
        _course_order: cIdx,
      }
      const current = map.get(code)
      if (!current) {
        map.set(code, entry)
      } else if (
        semIdx > current._semester_order ||
        (semIdx === current._semester_order && cIdx > current._course_order)
      ) {
        map.set(code, entry)
      }
    })
  })
  return map
}

async function programRequiredTotals() {
  const requirements = await loadRequirements()
  const totals = requirements?.requirement_summary?.total || {}
  const minSu = totals.min_su != null ? Number(totals.min_su) : null
  const minEcts = totals.min_ects != null ? Number(totals.min_ects) : null
  return { minSu, minEcts }
}

export async function buildSemestersSummary() {
  const semesters = getSemesters()
  const catalog = await courseCatalog()
  const suCredits = await suCreditsByCourseCode()
  const prereqMap = await prerequisitesByCourse()

  const proj201ForcedIdx = hasBannerwebImportedCourses(semesters)
    ? null
    : enforceProj201BySemesterFour(semesters, suCredits)
  if (proj201ForcedIdx != null) {
    const inserted = (semesters[proj201ForcedIdx].courses || []).some(c => c._auto_added)
    if (inserted) {
      semesters[proj201ForcedIdx].courses.forEach(c => { delete c._auto_added })
      setSemesters(semesters)
    }
  }

  const allCourseCodes = Object.keys(suCredits).sort()

  const semesterPayloads = semesters.map((semester, idx) => {
    let totalSu = 0
    const courseRecords = (semester.courses || []).map(c => {
      const code = normalizeCourseCode(c.course_code)
      const course = catalog[code] || {}
      let su = 0
      try {
        su = rowSuCredits(c, suCredits)
      } catch {
        su = 0
      }
      const ects = rowEctsCredits(c, catalog)
      totalSu += su
      return {
        id: c.id,
        semester_id: semester.id,
        course_code: code,
        course_name: course.Name || null,
        su_credits: su,
        ects_credits: ects,
        grade: c.grade ?? null,
        grade_points: gradeToPoints(c.grade),
        is_overload: !!c.is_overload,
      }
    })

    const semesterGpa = weightedGpaFromRows(semester.courses || [], suCredits)
    const eligibleCodes = eligibleCourseCodesForSemester(
      semesters,
      idx,
      allCourseCodes,
      prereqMap,
      suCredits,
    )

    return {
      id: semester.id,
      name: semester.name,
      total_su_credits: round(totalSu, 2),
      gpa: semesterGpa,
      courses: courseRecords,
      eligible_course_codes: eligibleCodes,
      overload_course_count: semesterOverloadCount(semester),
      notes: idx === proj201ForcedIdx ? [PROJ_201_AUTO_ADD_NOTE] : [],
    }
  })

  const latest = latestAttemptsByCourse(semesters)
  const latestRows = [...latest.values()]
  const latestGraded = latestRows.filter(r => gradeToPoints(r.grade) != null)
  const cumulativeGpa = weightedGpaFromRows(latestGraded, suCredits)

  let totalPlannedSu = 0
  let totalPlannedEcts = 0
  for (const row of latestRows) {
    try {
      totalPlannedSu += rowSuCredits(row, suCredits)
    } catch { /* ignore */ }
    const ects = rowEctsCredits(row, catalog)
    if (ects != null) totalPlannedEcts += ects
  }

  const { minSu, minEcts } = await programRequiredTotals()
  const semesterGpaMap = {}
  for (const s of semesterPayloads) semesterGpaMap[s.id] = s.gpa

  return {
    semesters: semesterPayloads,
    cumulative_gpa: cumulativeGpa,
    max_semester_su_credits: MAX_SEMESTER_SU_CREDITS,
    total_planned_su_credits: round(totalPlannedSu, 2),
    total_planned_ects_credits: round(totalPlannedEcts, 2),
    program_required_su_credits: minSu,
    program_required_ects_credits: minEcts,
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
  const semesters = getSemesters()
  semesters.push({ id: newId(), name: trimmed, courses: [] })
  setSemesters(semesters)
  return buildSemestersSummary()
}

export async function deleteSemester(semesterId) {
  const semesters = getSemesters()
  const idx = semesters.findIndex(s => String(s.id) === String(semesterId))
  if (idx === -1) throw new Error(`Semester not found: ${semesterId}`)
  semesters.splice(idx, 1)
  setSemesters(semesters)
}

export async function addCourseToSemester(semesterId, courseCode, grade, options = {}) {
  const code = normalizeCourseCode(courseCode)
  if (!code) throw new Error('Course code cannot be empty')
  const normalizedGrade = normalizeLetterGrade(grade)

  const semesters = getSemesters()
  const idx = semesters.findIndex(s => String(s.id) === String(semesterId))
  if (idx === -1) throw new Error(`Semester not found: ${semesterId}`)
  const semester = semesters[idx]

  const suCredits = await suCreditsByCourseCode()
  const newCredits = suCredits[code]
  if (newCredits == null) throw new Error(`Course not found: ${code}`)

  const existing = (semester.courses || []).find(c => normalizeCourseCode(c.course_code) === code)
  if (existing) throw new Error(`${code} already exists in semester`)

  if (!options.skipValidation) {
    const prereqMap = await prerequisitesByCourse()
    ensurePrerequisitesMet(semesters, idx, code, prereqMap)
    ensureGraduationProjectRules(semesters, idx, code, suCredits)
    const [canRetake, retakeReason] = canRetakeInSemester(semesters, idx, code)
    if (!canRetake) throw new Error(retakeReason)
  }

  const currentCredits = semesterCreditTotal(semester, suCredits)
  const isOverload = currentCredits + newCredits > MAX_SEMESTER_SU_CREDITS
  if (isOverload) {
    const overloadCount = semesterOverloadCount(semester)
    if (overloadCount >= MAX_OVERLOAD_COURSES_PER_SEMESTER) {
      throw new Error(
        `${code} cannot be added. Semester SU credits would be ${currentCredits + newCredits}, ` +
          `exceeding the limit of ${MAX_SEMESTER_SU_CREDITS}. You must submit an overload ` +
          `request (maximum ${MAX_OVERLOAD_COURSES_PER_SEMESTER} overload courses).`,
      )
    }
  }

  semester.courses = semester.courses || []
  semester.courses.push({
    id: newId(),
    course_code: code,
    grade: normalizedGrade,
    is_overload: isOverload,
  })
  setSemesters(semesters)
  return buildSemestersSummary()
}

export async function updateSemesterCourseGrade(semesterId, courseCode, grade) {
  const code = normalizeCourseCode(courseCode)
  const normalizedGrade = normalizeLetterGrade(grade)
  const semesters = getSemesters()
  const semester = semesters.find(s => String(s.id) === String(semesterId))
  if (!semester) throw new Error(`Semester not found: ${semesterId}`)
  const course = (semester.courses || []).find(c => normalizeCourseCode(c.course_code) === code)
  if (!course) throw new Error(`Course not found in semester ${semesterId}: ${code}`)
  course.grade = normalizedGrade
  setSemesters(semesters)
  return buildSemestersSummary()
}

export async function updateCourseRecord(courseId, grade) {
  const normalizedGrade = normalizeLetterGrade(grade)
  const semesters = getSemesters()
  let found = false
  for (const semester of semesters) {
    for (const c of semester.courses || []) {
      if (String(c.id) === String(courseId)) {
        c.grade = normalizedGrade
        found = true
        break
      }
    }
    if (found) break
  }
  if (!found) throw new Error(`Course not found: ${courseId}`)
  setSemesters(semesters)
  return buildSemestersSummary()
}

export async function deleteCourseRecord(courseId) {
  const semesters = getSemesters()
  let found = false
  for (const semester of semesters) {
    const idx = (semester.courses || []).findIndex(c => String(c.id) === String(courseId))
    if (idx !== -1) {
      semester.courses.splice(idx, 1)
      found = true
      break
    }
  }
  if (!found) throw new Error(`Course not found: ${courseId}`)
  setSemesters(semesters)
  return buildSemestersSummary()
}

export async function deleteCourseFromSemester(semesterId, courseCode) {
  const code = normalizeCourseCode(courseCode)
  const semesters = getSemesters()
  const semester = semesters.find(s => String(s.id) === String(semesterId))
  if (!semester) throw new Error(`Semester not found: ${semesterId}`)
  const idx = (semester.courses || []).findIndex(c => normalizeCourseCode(c.course_code) === code)
  if (idx === -1) throw new Error(`Course not found in semester ${semesterId}: ${code}`)
  semester.courses.splice(idx, 1)
  setSemesters(semesters)
  return buildSemestersSummary()
}

export async function resetTrackingData() {
  setSemesters([])
}

export async function importBannerwebParseResult(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Parsed payload must be an object.')
  const sections = parsed.sections || {}

  function attributionLookup(sectionName) {
    const section = sections[sectionName] || {}
    const out = new Map()
    for (const course of section.courses || []) {
      if (!course || typeof course !== 'object') continue
      const term = String(course.term || '').trim()
      const rawCode = String(course.course || '').trim()
      const ects = course.ects_credits
      if (!term || !rawCode || ects == null) continue
      const n = Number(ects)
      if (Number.isFinite(n)) out.set(`${term}|${normalizeCourseCode(rawCode)}`, n)
    }
    return out
  }
  const engineeringLookup = attributionLookup('ENGINEERING')
  const basicScienceLookup = attributionLookup('BASIC SCIENCE')

  const coursesByTerm = {}
  for (const [sectionName, section] of Object.entries(sections)) {
    if (['FACULTY COURSES', 'ENGINEERING', 'BASIC SCIENCE'].includes(sectionName)) continue
    if (!section || typeof section !== 'object') continue
    for (const course of section.courses || []) {
      if (!course || typeof course !== 'object') continue
      const term = String(course.term || '').trim()
      const rawCode = String(course.course || '').trim()
      if (!term || !rawCode) continue
      coursesByTerm[term] = coursesByTerm[term] || []
      coursesByTerm[term].push({ ...course, _bannerweb_category: BANNERWEB_PRIMARY_SECTION_CATEGORIES[sectionName] })
    }
  }

  const semesters = getSemesters()
  const catalog = await courseCatalog()
  const suCredits = await suCreditsByCourseCode()
  const skipped = []
  let createdSemesters = 0
  let importedCourses = 0

  for (const term of Object.keys(coursesByTerm).sort()) {
    let semester = semesters.find(s => s.name === term)
    if (!semester) {
      semester = { id: newId(), name: term, courses: [] }
      semesters.push(semester)
      createdSemesters += 1
    }

    for (const course of coursesByTerm[term]) {
      const rawCode = String(course.course || '').trim()
      const normalized = normalizeCourseCode(rawCode)
      const grade = normalizeLetterGrade(course.grade)
      const bannerwebSu = course.su_credits
      const bannerwebEcts = course.ects_credits

      if (!(normalized in catalog) && bannerwebSu == null) {
        skipped.push({ course: rawCode, term, reason: 'Course not found in catalog' })
        continue
      }

      const dup = (semester.courses || []).some(c => normalizeCourseCode(c.course_code) === normalized)
      if (dup) {
        skipped.push({ course: rawCode, term, reason: 'Already exists in semester' })
        continue
      }

      let newCredits
      try {
        newCredits = bannerwebSu != null ? Number(bannerwebSu) : suCredits[normalized]
      } catch (err) {
        skipped.push({ course: rawCode, term, reason: err.message })
        continue
      }
      if (newCredits == null) {
        skipped.push({ course: rawCode, term, reason: 'No SU credits' })
        continue
      }

      const currentCredits = semesterCreditTotal(semester, suCredits)
      const isOverload = currentCredits + newCredits > MAX_SEMESTER_SU_CREDITS
      const key = `${term}|${normalized}`
      semester.courses.push({
        id: newId(),
        course_code: normalized,
        grade,
        source: 'bannerweb',
        is_overload: isOverload,
        engineering_ects: engineeringLookup.get(key) || 0,
        basic_science_ects: basicScienceLookup.get(key) || 0,
        bannerweb_category: course._bannerweb_category || null,
        bannerweb_su_credits: bannerwebSu != null ? Number(bannerwebSu) : null,
        bannerweb_ects_credits: bannerwebEcts != null ? Number(bannerwebEcts) : null,
      })
      importedCourses += 1
    }
  }

  setSemesters(semesters)
  const summary = await buildSemestersSummary()
  return {
    created_semesters: createdSemesters,
    imported_courses: importedCourses,
    skipped,
    summary,
  }
}
