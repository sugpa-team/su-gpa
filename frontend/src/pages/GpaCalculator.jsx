import { useEffect, useMemo, useState } from 'react'

import SearchableDropdown from '../components/SearchableDropdown'
import { apiRequest } from '../lib/api'

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
        if (!courseCode) {
          continue
        }
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
      if (semesterIds.length < 2) {
        continue
      }
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
    if (nextSummary) {
      setSummary(nextSummary)
    }
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
    if (!programDraftId) {
      return
    }
    if (Number(programDraftId) === profile.program_id) {
      return
    }

    const confirmed = window.confirm('This will reset your graduation tracking. Continue?')
    if (!confirmed) {
      return
    }

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
      if (course.su_credits === null || course.su_credits === undefined) {
        return false
      }
      if (eligibleCourseCodes.size > 0 && !eligibleCourseCodes.has(course.course)) {
        return false
      }

      const credits = Number(course.su_credits || 0)
      if (usedCourseCodes.has(course.course)) {
        return false
      }
      if (credits <= remainingCredits) {
        return true
      }
      return overloadSlotsRemaining > 0
    })
  }

  function courseLabel(course) {
    const credits =
      course.su_credits === null || course.su_credits === undefined ? '-' : formatNumber(course.su_credits)
    return `${course.course} — ${course.name} (${credits} SU)`
  }

  function normalizeCourseCode(value) {
    return String(value || '')
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ')
  }

  function resolveCourseCode(desiredCode) {
    const normalizedDesired = normalizeCourseCode(desiredCode).replace(/\s/g, '')
    const exact = courses.find(course => normalizeCourseCode(course.course) === normalizeCourseCode(desiredCode))
    if (exact) {
      return exact.course
    }
    const relaxed = courses.find(
      course => normalizeCourseCode(course.course).replace(/\s/g, '') === normalizedDesired,
    )
    return relaxed ? relaxed.course : null
  }

  async function ensureAtLeastTwoSemesters() {
    let current = summary
    while (current.semesters.length < 2) {
      const name = `Semester ${current.semesters.length + 1}`
      // eslint-disable-next-line no-await-in-loop
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
          if (!resolved) {
            continue
          }
          if (existing.has(normalizeCourseCode(resolved))) {
            continue
          }
          // eslint-disable-next-line no-await-in-loop
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
    <section className="planner-shell" aria-labelledby="planner-title">
      <div className="planner-header">
        <div>
          <p className="eyebrow">Sabanci University</p>
          <h1 id="planner-title">SUGpa</h1>
          <p className="program-context">
            {currentProgram
              ? `${currentProgram.faculty} / ${currentProgram.program_name} / ${profile.entry_term || '-'}`
              : 'Program not selected'}
          </p>
        </div>
        <div className="gpa-score" aria-live="polite">
          <span>Overall GPA</span>
          <strong>{formatNumber(cgpa)}</strong>
        </div>
      </div>

      <form className="program-update-form" onSubmit={handleProgramUpdate}>
        <label htmlFor="program-update">Selected Program</label>
        <div className="program-update-controls">
          <select
            id="program-update"
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
            type="submit"
            disabled={saving || !programDraftId || Number(programDraftId) === profile.program_id}
          >
            Update Program
          </button>
        </div>
      </form>

      <div className="summary-strip">
        <div>
          <span>Total Semesters</span>
          <strong>{summary.semesters.length}</strong>
        </div>
        <div>
          <span>SU Credits</span>
          <strong>{formatNumber(totalPlannedSuCredits)}/{formatNumber(summary.program_required_su_credits ?? 0)}</strong>
        </div>
        <div>
          <span>ECTS Credits</span>
          <strong>{formatNumber(totalPlannedEctsCredits)}/{formatNumber(summary.program_required_ects_credits ?? 0)}</strong>
        </div>
      </div>

      <div className="semester-form">
        <button type="button" onClick={handleCreateSemester} disabled={saving}>
          Add Semester
        </button>
        <button
          type="button"
          className="ghost-button"
          onClick={handleAddFirstYearCourses}
          disabled={saving || loading || coursesLoading || courses.length === 0}
        >
          Add 1st year courses (Sem 1-2)
        </button>
      </div>

      {loading && <p className="status">Loading planner...</p>}
      {error && <p className="error" role="alert">{error}</p>}

      {!loading && summary.semesters.length === 0 && (
        <p className="empty-state">Create a semester to start planning courses and grades.</p>
      )}

      <div className="semesters-grid">
        {summary.semesters.map(semester => {
          const options = courseOptionsForSemester(semester)
          const selectedCode = selectedCourses[semester.id]
          const selectedCourse = options.find(course => course.course === selectedCode)
          const willExceedLimitWithSelection =
            selectedCourse &&
            semester.total_su_credits + Number(selectedCourse.su_credits || 0) >
              summary.max_semester_su_credits
          const isAlreadyOverLimit = semester.total_su_credits > summary.max_semester_su_credits
          const creditPercent = Math.min(
            100,
            (semester.total_su_credits / summary.max_semester_su_credits) * 100,
          )

          return (
            <article className="semester-panel" key={semester.id}>
              <div className="semester-panel-header">
                <div>
                  <h2>{semester.name}</h2>
                  <p>
                    {formatNumber(semester.total_su_credits)} / {formatNumber(summary.max_semester_su_credits)} SU
                    Credits
                  </p>
                </div>
                <div className="semester-gpa">
                  <span>GPA</span>
                  <strong>{formatNumber(summary.semester_gpa[semester.id] ?? semester.gpa)}</strong>
                </div>
              </div>

              <div className="credit-meter" aria-hidden="true">
                <span style={{ width: `${creditPercent}%` }} />
              </div>

              {semester.courses.length === 0 ? (
                <p className="semester-empty">No courses added yet.</p>
              ) : (
                <div className="semester-course-list">
                  {semester.courses.map(course => (
                    <div className="semester-course" key={course.id}>
                      <div>
                        <strong>{course.course_code}</strong>
                        <span>{course.course_name || 'Course'}</span>
                        <small>{formatNumber(course.su_credits)} SU Credits</small>
                      </div>
                      <select
                        className="grade-select"
                        value={course.grade || ''}
                        onChange={event => handleGradeChange(course.id, event.target.value)}
                        disabled={saving}
                        aria-label={`Grade for ${course.course_code}`}
                      >
                        <option value="">Grade</option>
                        {GRADE_OPTIONS.map(grade => (
                          <option key={grade} value={grade}>
                            {grade}
                          </option>
                        ))}
                      </select>
                      <button
                        className="remove-course-button"
                        type="button"
                        onClick={() => handleRemoveCourse(course.id)}
                        disabled={saving}
                        aria-label={`Remove ${course.course_code}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="add-course-row add-course-row-bottom">
                <SearchableDropdown
                  id={`semester-${semester.id}-course`}
                  label="Add course"
                  hideLabel
                  value={selectedCourseInputs[semester.id] || ''}
                  placeholder={options.length === 0 ? 'No course fits remaining credits' : 'Type to search course'}
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
                  type="button"
                  onClick={() => handleAddCourse(semester.id)}
                  disabled={saving || !selectedCourses[semester.id]}
                >
                  Add
                </button>
              </div>
              {(isAlreadyOverLimit || willExceedLimitWithSelection) && (
                <p className="error" role="status">
                  This semester has exceeded the 20 SU credit limit. You must request an overload.
                </p>
              )}
              {semester.notes?.map(note => (
                <p key={note} className="status" role="status">
                  {note}
                </p>
              ))}
              {semesterHasLatestRetake[semester.id] && (
                <p className="status" role="status">
                  Retaken courses are counted by latest attempt in overall GPA.
                </p>
              )}

              <button
                className="delete-semester-button"
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

