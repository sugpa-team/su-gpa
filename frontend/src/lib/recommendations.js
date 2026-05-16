import { normalizeCourseCode } from './gpa'
import { getPlannerView } from './planner'
import { getGraduationRequirementsProgress } from './requirements'
import { getSemesters } from './storage'

const FREE_ELECTIVE_FACULTIES = new Set(['FASS', 'SBS', 'FENS'])
const FIXED_LIST_CATEGORIES = new Set(['University Courses', 'Required Courses'])

function round(value, digits) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export async function getRecommendations(term, limit = 4) {
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 4))
  const [view, progress] = await Promise.all([
    getPlannerView(term),
    getGraduationRequirementsProgress(getSemesters()),
  ])

  const taken = new Set((view.taken_course_codes || []).map(normalizeCourseCode))

  const categoryRemaining = {}
  for (const cat of progress.categories || []) {
    const remSu = Number(cat.remaining_su || 0)
    const remEcts = Number(cat.remaining_ects || 0)
    const remCourses = Number(cat.remaining_courses || 0)
    if (remSu > 0 || remEcts > 0 || remCourses > 0) {
      categoryRemaining[cat.category] = { su: remSu, ects: remEcts, courses: remCourses }
    }
  }

  const scored = []
  for (const course of view.courses || []) {
    const normalized = normalizeCourseCode(course.code)
    if (taken.has(normalized)) continue
    if (course.retake_allowed === false) continue

    const prereqs = (course.prerequisites || []).map(p => normalizeCourseCode(p))
    const missingPrereqs = prereqs.filter(p => !taken.has(p))
    if (missingPrereqs.length > 0) continue

    const credits = Number(course.su_credits || 0)
    const cats = course.requirement_categories || []
    const reasons = []
    let score = 0

    for (const cat of cats) {
      const remaining = categoryRemaining[cat]
      if (!remaining) continue
      if (remaining.su > 0) {
        const filled = Math.min(credits, remaining.su)
        score += filled * (FIXED_LIST_CATEGORIES.has(cat) ? 3 : 2)
        reasons.push(`Fills ${cat} (${round(remaining.su, 1)} SU left)`)
      } else if (remaining.courses > 0) {
        score += credits * 2
        reasons.push(`Fills ${cat} (${remaining.courses} courses left)`)
      } else if (remaining.ects > 0) {
        score += credits * 0.5
        reasons.push(`Fills ${cat}`)
      }
    }

    const feRemaining = categoryRemaining['Free Electives']
    const facultyUpper = (course.faculty || '').toUpperCase()
    if (
      feRemaining &&
      feRemaining.su > 0 &&
      !cats.includes('Free Electives') &&
      FREE_ELECTIVE_FACULTIES.has(facultyUpper)
    ) {
      const filled = Math.min(credits, feRemaining.su)
      score += filled * 1.2
      reasons.push(`Counts toward Free Electives (${round(feRemaining.su, 1)} SU left)`)
    }

    if (credits > 0 && score === 0) {
      score = credits * 0.1
      reasons.push('Available this term')
    }

    if (reasons.length === 0) continue

    scored.push({
      course_code: course.code,
      course_name: course.name,
      su_credits: course.su_credits,
      score,
      reasons: reasons.slice(0, 3),
      feedback: null,
    })
  }

  scored.sort((a, b) => b.score - a.score)
  return { recommendations: scored.slice(0, safeLimit) }
}
