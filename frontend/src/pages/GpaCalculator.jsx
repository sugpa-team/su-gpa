import { useEffect, useMemo, useState } from 'react'

import SearchableDropdown from '../components/SearchableDropdown'
import { apiRequest } from '../lib/api'
import './GpaCalculator.css'

const EMPTY_SUMMARY = {
  semesters: [],
  cumulative_gpa: 0,
  cgpa: 0,
  semester_gpa: {},
  max_semester_su_credits: 20,
  total_planned_su_credits: 0,
  total_planned_ects_credits: 0,
  program_required_su_credits: null,
  program_required_ects_credits: null,
}

const GRADE_OPTIONS = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F']

function formatNumber(value) {
  return Number(value || 0).toFixed(2)
}

const TERM_SUFFIX = { '01': 'Fall', '02': 'Spring', '03': 'Summer' }

function parseSemesterName(name) {
  const str = String(name || '').trim()
  const match = str.match(/^(\d{4})(01|02|03)$/)
  if (!match) return { year: str, season: null }
  return { year: match[1], season: TERM_SUFFIX[match[2]] }
}

function GpaCalculator({ profile, onProfileUpdated, programs, courses, coursesLoading, dataVersion = 0 }) {
  const [summary, setSummary] = useState(EMPTY_SUMMARY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [selectedCourses, setSelectedCourses] = useState({})
  const [selectedCourseInputs, setSelectedCourseInputs] = useState({})
  const [programDraftId, setProgramDraftId] = useState(profile.program_id ? String(profile.program_id) : '')

  useEffect(() => {
    setProgramDraftId(profile.program_id ? String(profile.program_id) : '')
  }, [profile.program_id])

  useEffect(() => {
    let ignore = false

    async function loadSummary() {
      try {
        const summaryData = await apiRequest('/api/gpa')
        if (!ignore) {
          setSummary(summaryData)
          setError(null)
        }
      } catch (requestError) {
        if (!ignore) {
          setError(requestError.message)
        }
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    }

    loadSummary()

    return () => {
      ignore = true
    }
  }, [dataVersion])

  const cgpa = summary.cgpa ?? summary.cumulative_gpa
  const totalPlannedSuCredits = summary.total_planned_su_credits ?? 0
  const totalPlannedEctsCredits = summary.total_planned_ects_credits ?? 0
  const semesterHasLatestRetake = useMemo(() => {
    const attemptsByCourse = new Map()
    for (const semester of summary.semesters) {
      for (const course of semester.courses) {
        const courseCode = String(course.course_code || '').trim().toUpperCase()
        if (!courseCode) continue
        if (!attemptsByCourse.has(courseCode)) {
          attemptsByCourse.set(courseCode, [])
        }
        attemptsByCourse.get(courseCode).push(semester.id)
      }
    }

    const result = {}
    for (const semester of summary.semesters) {
      result[semester.id] = false
    }

    for (const semesterIds of attemptsByCourse.values()) {
      if (semesterIds.length < 2) continue
      const latestSemesterId = semesterIds[semesterIds.length - 1]
      result[latestSemesterId] = true
    }

    return result
  }, [summary.semesters])

  const currentProgram = useMemo(
    () => programs.find(program => program.id === profile.program_id),
    [profile.program_id, programs],
  )

  async function runAction(action) {
    setSaving(true)
    setError(null)
    try {
      await action()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  function updateSummary(nextSummary) {
    if (nextSummary) setSummary(nextSummary)
  }

  function getNextSemesterNameFrom(semesters) {
    const usedNumbers = semesters
      .map(semester => {
        const match = String(semester.name || '').match(/semester\s+(\d+)/i)
        return match ? Number(match[1]) : null
      })
      .filter(value => Number.isFinite(value))

    const nextNumber = usedNumbers.length > 0 ? Math.max(...usedNumbers) + 1 : semesters.length + 1
    return `Semester ${nextNumber}`
  }

  function getNextSemesterName() {
    return getNextSemesterNameFrom(summary.semesters)
  }

  async function handleCreateSemester() {
    await runAction(async () => {
      const name = getNextSemesterName()
      const nextSummary = await apiRequest('/taken-courses/semesters', {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      updateSummary(nextSummary)
    })
  }

  async function handleDeleteSemester(semesterId) {
    await runAction(async () => {
      await apiRequest(`/taken-courses/semesters/${semesterId}`, { method: 'DELETE' })
      const nextSummary = await apiRequest('/api/gpa')
      updateSummary(nextSummary)
    })
  }

  async function handleAddCourse(semesterId) {
    const semester = summary.semesters.find(item => item.id === semesterId)
    const courseCode = selectedCourses[semesterId]
    if (!courseCode || !semester) {
      setError('Select a course before adding it.')
      return
    }

    await runAction(async () => {
      const nextSummary = await apiRequest('/api/courses', {
        method: 'POST',
        body: JSON.stringify({ semester_id: semesterId, course_code: courseCode }),
      })
      setSelectedCourses(current => ({ ...current, [semesterId]: '' }))
      setSelectedCourseInputs(current => ({ ...current, [semesterId]: '' }))
      updateSummary(nextSummary)
    })
  }

  async function handleGradeChange(courseId, grade) {
    await runAction(async () => {
      const nextSummary = await apiRequest(`/api/courses/${courseId}`, {
        method: 'PATCH',
        body: JSON.stringify({ grade: grade || null }),
      })
      updateSummary(nextSummary)
    })
  }

  async function handleRemoveCourse(courseId) {
    await runAction(async () => {
      const nextSummary = await apiRequest(`/api/courses/${courseId}`, { method: 'DELETE' })
      updateSummary(nextSummary)
    })
  }

  async function handleProgramUpdate(event) {
    event.preventDefault()
    if (!programDraftId) return
    if (Number(programDraftId) === profile.program_id) return

    const confirmed = window.confirm('This will reset your graduation tracking. Continue?')
    if (!confirmed) return

    const selectedProgram = programs.find(program => program.id === Number(programDraftId))
    if (!selectedProgram) {
      setError('Selected program was not found.')
      return
    }

    await runAction(async () => {
      const result = await apiRequest('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          faculty: selectedProgram.faculty,
          program_id: selectedProgram.id,
          entry_term: profile.entry_term,
        }),
      })
      onProfileUpdated(result.profile)
      const nextSummary = await apiRequest('/api/gpa')
      updateSummary(nextSummary)
    })
  }

  function courseOptionsForSemester(semester) {
    const usedCourseCodes = new Set(semester.courses.map(course => course.course_code))
    const eligibleCourseCodes = new Set(semester.eligible_course_codes || [])
    const remainingCredits = summary.max_semester_su_credits - semester.total_su_credits
    const overloadSlotsRemaining = Math.max(0, 2 - (semester.overload_course_count || 0))

    return courses.filter(course => {
      if (course.su_credits === null || course.su_credits === undefined) return false
      if (eligibleCourseCodes.size > 0 && !eligibleCourseCodes.has(course.course)) return false
      const credits = Number(course.su_credits || 0)
      if (usedCourseCodes.has(course.course)) return false
      if (credits <= remainingCredits) return true
      return overloadSlotsRemaining > 0
    })
  }

  function courseLabel(course) {
    const credits =
      course.su_credits === null || course.su_credits === undefined ? '-' : formatNumber(course.su_credits)
    return `${course.course} — ${course.name} (${credits} SU)`
  }

  function normalizeCourseCode(value) {
    return String(value || '').trim().toUpperCase().replace(/\s+/g, ' ')
  }

  function resolveCourseCode(desiredCode) {
    const normalizedDesired = normalizeCourseCode(desiredCode).replace(/\s/g, '')
    const exact = courses.find(course => normalizeCourseCode(course.course) === normalizeCourseCode(desiredCode))
    if (exact) return exact.course
    const relaxed = courses.find(
      course => normalizeCourseCode(course.course).replace(/\s/g, '') === normalizedDesired,
    )
    return relaxed ? relaxed.course : null
  }

  async function ensureAtLeastTwoSemesters() {
    let current = summary
    while (current.semesters.length < 2) {
      const name = `Semester ${current.semesters.length + 1}`
      const nextSummary = await apiRequest('/taken-courses/semesters', {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      current = nextSummary
      updateSummary(nextSummary)
    }
    return current
  }

  async function handleAddFirstYearCourses() {
    const term1 = ['MATH 101', 'TLL 101', 'SPS 101', 'NS 101', 'HIST 191', 'IF 100', 'CIP 101']
    const term2 = ['MATH 102', 'TLL 102', 'SPS 102', 'NS 102', 'HIST 192', 'AL 102']

    await runAction(async () => {
      const seededSummary = await ensureAtLeastTwoSemesters()
      const [semester1, semester2] = seededSummary.semesters

      const termMappings = [
        { semester: semester1, desired: term1 },
        { semester: semester2, desired: term2 },
      ]

      for (const mapping of termMappings) {
        const existing = new Set(
          (mapping.semester.courses || []).map(course => normalizeCourseCode(course.course_code)),
        )
        for (const desiredCode of mapping.desired) {
          const resolved = resolveCourseCode(desiredCode)
          if (!resolved) continue
          if (existing.has(normalizeCourseCode(resolved))) continue
          await apiRequest('/api/courses', {
            method: 'POST',
            body: JSON.stringify({ semester_id: mapping.semester.id, course_code: resolved }),
          })
        }
      }

      const refreshed = await apiRequest('/api/gpa')
      updateSummary(refreshed)
    })
  }

  return (
    <section className="gc-root" aria-labelledby="planner-title">

      
      <header className="gc-header">
        <div className="gc-header-left">
          <p className="gc-eyebrow">Sabancı University</p>
          <h1 id="planner-title" className="gc-brand">SUGpa</h1>
          <p className="gc-program-label">
            {currentProgram
              ? `${currentProgram.faculty} · ${currentProgram.program_name} · ${profile.entry_term || '—'}`
              : 'No program selected'}
          </p>
        </div>
        <div className="gc-gpa-badge" aria-live="polite">
          <span className="gc-gpa-label">Overall GPA</span>
          <strong className="gc-gpa-value">{formatNumber(cgpa)}</strong>
          <span className="gc-gpa-denom">/4.00</span>
        </div>
      </header>

      
      <form className="gc-program-form" onSubmit={handleProgramUpdate}>
        <label className="gc-field-label" htmlFor="program-update">Program</label>
        <div className="gc-program-row">
          <select
            id="program-update"
            className="gc-select"
            value={programDraftId}
            onChange={event => setProgramDraftId(event.target.value)}
            disabled={saving}
          >
            {programs.map(program => (
              <option key={program.id} value={program.id}>
                {program.faculty} / {program.program_name}
              </option>
            ))}
          </select>
          <button
            className="gc-btn gc-btn--primary"
            type="submit"
            disabled={saving || !programDraftId || Number(programDraftId) === profile.program_id}
          >
            Update
          </button>
        </div>
      </form>

      
      <div className="gc-stats">
        <div className="gc-stat">
          <span className="gc-stat-label">Semesters</span>
          <strong className="gc-stat-value">{summary.semesters.length}</strong>
        </div>
        <div className="gc-stat">
          <span className="gc-stat-label">SU Credits</span>
          <strong className="gc-stat-value">
            {formatNumber(totalPlannedSuCredits)}
            <em>/{formatNumber(summary.program_required_su_credits ?? 0)}</em>
          </strong>
        </div>
        <div className="gc-stat">
          <span className="gc-stat-label">ECTS Credits</span>
          <strong className="gc-stat-value">
            {formatNumber(totalPlannedEctsCredits)}
            <em>/{formatNumber(summary.program_required_ects_credits ?? 0)}</em>
          </strong>
        </div>
      </div>

      
      <div className="gc-toolbar">
        <button className="gc-btn gc-btn--primary" type="button" onClick={handleCreateSemester} disabled={saving}>
          <span className="gc-btn-icon">+</span> Add Semester
        </button>
        <button
          className="gc-btn gc-btn--ghost"
          type="button"
          onClick={handleAddFirstYearCourses}
          disabled={saving || loading || coursesLoading || courses.length === 0}
        >
          Seed 1st Year Courses
        </button>
      </div>

      
      {loading && <p className="gc-feedback gc-feedback--info">Loading planner…</p>}
      {error && <p className="gc-feedback gc-feedback--error" role="alert">{error}</p>}

      {!loading && summary.semesters.length === 0 && (
        <div className="gc-empty">
          <div className="gc-empty-icon">📋</div>
          <p>Add a semester to start planning your courses and grades.</p>
        </div>
      )}

      
      <div className="gc-grid">
        {summary.semesters.map(semester => {
          const options = courseOptionsForSemester(semester)
          const selectedCode = selectedCourses[semester.id]
          const selectedCourse = options.find(course => course.course === selectedCode)
          const willExceedLimitWithSelection =
            selectedCourse &&
            semester.total_su_credits + Number(selectedCourse.su_credits || 0) > summary.max_semester_su_credits
          const isAlreadyOverLimit = semester.total_su_credits > summary.max_semester_su_credits
          const creditPercent = Math.min(
            100,
            (semester.total_su_credits / summary.max_semester_su_credits) * 100,
          )

          return (
            <article className="gc-semester" key={semester.id}>

              
              <div className="gc-semester-head">
                <div className="gc-semester-title-group">
                  <h2 className="gc-semester-title">
                    {(() => {
                      const { year, season } = parseSemesterName(semester.name)
                      return season
                        ? <>{year} <span className={`gc-season gc-season--${season.toLowerCase()}`}>{season}</span></>
                        : year
                    })()}
                  </h2>
                  <p className="gc-semester-credits">
                    {formatNumber(semester.total_su_credits)}<span className="gc-credits-sep"> / </span>{formatNumber(summary.max_semester_su_credits)} SU
                  </p>
                </div>
                <div className="gc-semester-gpa">
                  <span className="gc-semester-gpa-label">GPA</span>
                  <strong className="gc-semester-gpa-value">
                    {formatNumber(summary.semester_gpa[semester.id] ?? semester.gpa)}
                  </strong>
                </div>
              </div>

              
              <div className="gc-meter" aria-hidden="true">
                <div
                  className={['gc-meter-fill', isAlreadyOverLimit ? 'gc-meter-fill--over' : ''].join(' ').trim()}
                  style={{ width: `${creditPercent}%` }}
                />
              </div>

              
              {semester.courses.length === 0 ? (
                <p className="gc-no-courses">No courses added yet.</p>
              ) : (
                <ul className="gc-course-list">
                  {semester.courses.map(course => (
                    <li className="gc-course" key={course.id}>
                      <div className="gc-course-info">
                        <strong className="gc-course-code">{course.course_code}</strong>
                        <span className="gc-course-name">{course.course_name || 'Course'}</span>
                        <span className="gc-course-credits">{formatNumber(course.su_credits)} SU</span>
                      </div>
                      <select
                        className="gc-grade-select"
                        value={course.grade || ''}
                        onChange={event => handleGradeChange(course.id, event.target.value)}
                        disabled={saving}
                        aria-label={`Grade for ${course.course_code}`}
                      >
                        <option value="">—</option>
                        {GRADE_OPTIONS.map(grade => (
                          <option key={grade} value={grade}>{grade}</option>
                        ))}
                      </select>
                      <button
                        className="gc-remove-btn"
                        type="button"
                        onClick={() => handleRemoveCourse(course.id)}
                        disabled={saving}
                        aria-label={`Remove ${course.course_code}`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              
              <div className="gc-add-row">
                <SearchableDropdown
                  id={`semester-${semester.id}-course`}
                  label="Add course"
                  hideLabel
                  value={selectedCourseInputs[semester.id] || ''}
                  placeholder={options.length === 0 ? 'No courses fit remaining credits' : 'Search course…'}
                  options={options.map(course => ({
                    value: course.course,
                    label: courseLabel(course),
                  }))}
                  disabled={saving || options.length === 0}
                  onInputChange={nextValue => {
                    setSelectedCourseInputs(current => ({ ...current, [semester.id]: nextValue }))
                    const matched = options.find(
                      course => course.course.toLowerCase() === nextValue.trim().toLowerCase(),
                    )
                    setSelectedCourses(current => ({
                      ...current,
                      [semester.id]: matched ? matched.course : '',
                    }))
                  }}
                  onOptionSelect={option => {
                    setSelectedCourseInputs(current => ({ ...current, [semester.id]: option.label }))
                    setSelectedCourses(current => ({ ...current, [semester.id]: option.value }))
                  }}
                />
                <button
                  className="gc-btn gc-btn--primary"
                  type="button"
                  onClick={() => handleAddCourse(semester.id)}
                  disabled={saving || !selectedCourses[semester.id]}
                >
                  Add
                </button>
              </div>

              
              {(isAlreadyOverLimit || willExceedLimitWithSelection) && (
                <p className="gc-feedback gc-feedback--warning" role="status">
                  Exceeded 20 SU credit limit — an overload request is required.
                </p>
              )}
              {semester.notes?.map(note => (
                <p key={note} className="gc-feedback gc-feedback--info" role="status">{note}</p>
              ))}
              {semesterHasLatestRetake[semester.id] && (
                <p className="gc-feedback gc-feedback--info" role="status">
                  Retaken courses counted by latest attempt in overall GPA.
                </p>
              )}

              <button
                className="gc-delete-btn"
                type="button"
                onClick={() => handleDeleteSemester(semester.id)}
                disabled={saving}
              >
                Delete Semester
              </button>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export default GpaCalculator
