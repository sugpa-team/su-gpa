import { normalizeCourseCode } from './gpa'
import { getPlannerView } from './planner'
import { getGraduationRequirementsProgress } from './requirements'
import { getSemesters } from './storage'

const FREE_ELECTIVE_FACULTIES = new Set(['FASS', 'SBS', 'FENS'])
const MANDATORY_CATEGORIES = ['University Courses', 'Required Courses']

// Approximate subject-prefix mapping for Engineering / Basic Science ECTS attribution.
// The official per-course split is not in the static data, so this is only used to
// order courses within a priority bucket — never to exclude a course.
const ENGINEERING_PREFIXES = new Set(['CS', 'DSA', 'EE', 'ENS', 'ENRG', 'IE', 'MAT', 'ME'])
const BASIC_SCIENCE_PREFIXES = new Set(['MATH', 'NS', 'PHYS', 'CHEM', 'BIO'])

const BUCKET_ORDER = ['mandatory', 'core', 'area', 'free']
const BUCKET_LABELS = {
  mandatory: 'Required',
  core: 'Core Electives',
  area: 'Area Electives',
  free: 'Free Electives',
}

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function subjectPrefix(code) {
  return String(code || '').trim().split(/\s+/)[0].toUpperCase()
}

function describeNeed(need) {
  if (!need) return null
  if (need.su > 0) return `${round(need.su, 1)} SU left`
  if (need.courses > 0) return `${need.courses} course${need.courses === 1 ? '' : 's'} left`
  if (need.ects > 0) return `${round(need.ects, 1)} ECTS left`
  return null
}

export async function getRecommendations(term, limit = 4) {
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 4))
  const [view, progress] = await Promise.all([
    getPlannerView(term),
    getGraduationRequirementsProgress(getSemesters()),
  ])

  const taken = new Set((view.taken_course_codes || []).map(normalizeCourseCode))

  const remaining = {}
  for (const cat of progress.categories || []) {
    remaining[cat.category] = {
      su: Number(cat.remaining_su || 0),
      ects: Number(cat.remaining_ects || 0),
      courses: Number(cat.remaining_courses || 0),
    }
  }
  const hasNeed = name => {
    const need = remaining[name]
    return !!need && (need.su > 0 || need.courses > 0 || need.ects > 0)
  }
  const engineeringLeft = remaining['Engineering']?.ects || 0
  const basicScienceLeft = remaining['Basic Science']?.ects || 0

  const buckets = { mandatory: [], core: [], area: [], free: [] }

  for (const course of view.courses || []) {
    const normalized = normalizeCourseCode(course.code)
    if (taken.has(normalized)) continue
    if (course.retake_allowed === false) continue

    const prereqs = (course.prerequisites || []).map(p => normalizeCourseCode(p))
    if (prereqs.some(p => !taken.has(p))) continue

    const cats = course.requirement_categories || []
    const faculty = (course.faculty || '').toUpperCase()
    const isMandatoryCourse = cats.some(c => MANDATORY_CATEGORIES.includes(c))

    // Strict priority: Required/University > Core > Area > Free.
    // Electives flow down once a pool's minimum is met (core fills area, area fills free).
    let bucket = null
    const reasons = []
    const mandatoryCat = cats.find(c => MANDATORY_CATEGORIES.includes(c) && hasNeed(c))
    if (mandatoryCat) {
      bucket = 'mandatory'
      const label = mandatoryCat === 'Required Courses' ? 'Required course' : 'University course'
      reasons.push(`${label} — ${describeNeed(remaining[mandatoryCat])} in ${mandatoryCat}`)
    } else if (cats.includes('Core Electives') && hasNeed('Core Electives')) {
      bucket = 'core'
      reasons.push(`Core elective (${describeNeed(remaining['Core Electives'])})`)
    } else if ((cats.includes('Area Electives') || cats.includes('Core Electives')) && hasNeed('Area Electives')) {
      bucket = 'area'
      reasons.push(`Counts toward Area Electives (${describeNeed(remaining['Area Electives'])})`)
    } else if (
      hasNeed('Free Electives') &&
      !isMandatoryCourse &&
      (FREE_ELECTIVE_FACULTIES.has(faculty) || cats.length > 0)
    ) {
      bucket = 'free'
      reasons.push(`Counts toward Free Electives (${describeNeed(remaining['Free Electives'])})`)
    }
    if (!bucket) continue

    // Secondary priority inside the bucket: Engineering / Basic Science ECTS needs.
    let boost = 0
    const prefix = subjectPrefix(course.code)
    if (engineeringLeft > 0 && ENGINEERING_PREFIXES.has(prefix)) {
      boost = 1
      reasons.push(`Counts toward Engineering ECTS (~${round(engineeringLeft, 0)} left)`)
    } else if (basicScienceLeft > 0 && BASIC_SCIENCE_PREFIXES.has(prefix)) {
      boost = 1
      reasons.push(`Counts toward Basic Science ECTS (~${round(basicScienceLeft, 0)} left)`)
    }

    buckets[bucket].push({
      course_code: course.code,
      course_name: course.name,
      su_credits: course.su_credits,
      category: BUCKET_LABELS[bucket],
      reasons: reasons.slice(0, 3),
      feedback: null,
      _boost: boost,
      _su: Number(course.su_credits || 0),
    })
  }

  const recommendations = []
  for (const bucketId of BUCKET_ORDER) {
    if (recommendations.length >= safeLimit) break
    const items = buckets[bucketId].sort((a, b) =>
      b._boost - a._boost ||
      b._su - a._su ||
      String(a.course_code).localeCompare(String(b.course_code)),
    )
    for (const item of items) {
      if (recommendations.length >= safeLimit) break
      delete item._boost
      delete item._su
      recommendations.push(item)
    }
  }

  return { recommendations }
}
