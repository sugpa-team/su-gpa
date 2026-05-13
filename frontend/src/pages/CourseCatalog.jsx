import { useEffect, useMemo, useState } from 'react'

import { apiRequest } from '../lib/api'

const EMPTY_FEEDBACK_DRAFT = {
  difficulty: 'medium',
  workload: 'medium',
  grading_style: 'mixed',
  recommendation: 'maybe',
  note: '',
}

const FIELD_LABELS = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  low: 'Low',
  high: 'High',
  'exam-heavy': 'Exam-heavy',
  'project-heavy': 'Project-heavy',
  mixed: 'Mixed',
  yes: 'Yes',
  maybe: 'Maybe',
  no: 'No',
}

function formatCredit(value) {
  return value === null || value === undefined ? '-' : Number(value).toFixed(2)
}

function labelFor(value) {
  return FIELD_LABELS[value] || value || '-'
}

function feedbackPath(courseCode) {
  return `/api/course-feedback/${encodeURIComponent(courseCode)}`
}

function feedbackToDraft(feedback) {
  return {
    difficulty: feedback?.difficulty || EMPTY_FEEDBACK_DRAFT.difficulty,
    workload: feedback?.workload || EMPTY_FEEDBACK_DRAFT.workload,
    grading_style: feedback?.grading_style || EMPTY_FEEDBACK_DRAFT.grading_style,
    recommendation: feedback?.recommendation || EMPTY_FEEDBACK_DRAFT.recommendation,
    note: feedback?.note || '',
  }
}

function CourseCatalog({ courses, loading }) {
  const [courseSearch, setCourseSearch] = useState('')
  const [selectedFaculty, setSelectedFaculty] = useState('all')
  const [feedbackSummaries, setFeedbackSummaries] = useState({})
  const [feedbackError, setFeedbackError] = useState(null)
  const [feedbackSaving, setFeedbackSaving] = useState(false)
  const [activeFeedbackCourse, setActiveFeedbackCourse] = useState(null)
  const [feedbackDraft, setFeedbackDraft] = useState(EMPTY_FEEDBACK_DRAFT)

  useEffect(() => {
    let ignore = false

    apiRequest('/api/course-feedback/summary')
      .then(data => {
        if (!ignore) {
          setFeedbackSummaries(data.summaries || {})
          setFeedbackError(null)
        }
      })
      .catch(error => {
        if (!ignore) {
          setFeedbackError(error.message)
        }
      })

    return () => {
      ignore = true
    }
  }, [])

  const faculties = useMemo(
    () => ['all', ...new Set(courses.map(course => course.faculty).filter(Boolean))],
    [courses],
  )

  const filteredCourses = useMemo(() => {
    const search = courseSearch.trim().toLowerCase()

    return courses.filter(course => {
      const matchesFaculty = selectedFaculty === 'all' || course.faculty === selectedFaculty
      const matchesSearch =
        !search || course.course.toLowerCase().includes(search) || course.name.toLowerCase().includes(search)

      return matchesFaculty && matchesSearch
    })
  }, [courseSearch, courses, selectedFaculty])

  function getFeedback(courseCode) {
    return feedbackSummaries[courseCode]
  }

  function openFeedbackEditor(course) {
    const existing = getFeedback(course.course)
    setActiveFeedbackCourse(course)
    setFeedbackDraft(feedbackToDraft(existing))
    setFeedbackError(null)
  }

  function closeFeedbackEditor() {
    setActiveFeedbackCourse(null)
    setFeedbackDraft(feedbackToDraft(null))
    setFeedbackError(null)
  }

  async function handleFeedbackSave(event) {
    event.preventDefault()
    if (!activeFeedbackCourse) {
      return
    }
    setFeedbackSaving(true)
    setFeedbackError(null)
    try {
      const saved = await apiRequest(feedbackPath(activeFeedbackCourse.course), {
        method: 'PUT',
        body: JSON.stringify(feedbackDraft),
      })
      setFeedbackSummaries(current => ({
        ...current,
        [saved.course_code]: saved,
      }))
      setActiveFeedbackCourse({ ...activeFeedbackCourse, course: saved.course_code })
    } catch (error) {
      setFeedbackError(error.message)
    } finally {
      setFeedbackSaving(false)
    }
  }

  async function handleFeedbackDelete() {
    if (!activeFeedbackCourse) {
      return
    }
    setFeedbackSaving(true)
    setFeedbackError(null)
    try {
      await apiRequest(feedbackPath(activeFeedbackCourse.course), { method: 'DELETE' })
      setFeedbackSummaries(current => {
        const next = { ...current }
        delete next[activeFeedbackCourse.course]
        return next
      })
      closeFeedbackEditor()
    } catch (error) {
      setFeedbackError(error.message)
    } finally {
      setFeedbackSaving(false)
    }
  }

  return (
    <section className="courses-container" aria-labelledby="course-list-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Course Catalog</p>
          <h2 id="course-list-title">Find Courses</h2>
        </div>
        <span className="course-count">{filteredCourses.length} courses</span>
      </div>

      <div className="filters-section">
        <label htmlFor="faculty-dropdown">Faculty</label>
        <select
          id="faculty-dropdown"
          className="faculty-dropdown"
          value={selectedFaculty}
          onChange={event => setSelectedFaculty(event.target.value)}
        >
          {faculties.map(faculty => (
            <option key={faculty} value={faculty}>
              {faculty === 'all' ? 'All Faculties' : faculty}
            </option>
          ))}
        </select>

        <label htmlFor="course-search">Search</label>
        <input
          id="course-search"
          type="search"
          value={courseSearch}
          onChange={event => setCourseSearch(event.target.value)}
          placeholder="CS 201 or accounting"
        />
      </div>

      {activeFeedbackCourse && (
        <form className="course-feedback-panel" onSubmit={handleFeedbackSave}>
          <div className="course-feedback-panel-header">
            <div>
              <span className="meta-label">Course Feedback</span>
              <h3>{activeFeedbackCourse.course}</h3>
              <p>{activeFeedbackCourse.name}</p>
            </div>
            <button type="button" className="ghost-button" onClick={closeFeedbackEditor}>
              Close
            </button>
          </div>

          <div className="course-feedback-fields">
            <label>
              Difficulty
              <select
                value={feedbackDraft.difficulty}
                onChange={event =>
                  setFeedbackDraft(current => ({ ...current, difficulty: event.target.value }))}
                disabled={feedbackSaving}
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </label>

            <label>
              Workload
              <select
                value={feedbackDraft.workload}
                onChange={event =>
                  setFeedbackDraft(current => ({ ...current, workload: event.target.value }))}
                disabled={feedbackSaving}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>

            <label>
              Grading
              <select
                value={feedbackDraft.grading_style}
                onChange={event =>
                  setFeedbackDraft(current => ({ ...current, grading_style: event.target.value }))}
                disabled={feedbackSaving}
              >
                <option value="exam-heavy">Exam-heavy</option>
                <option value="project-heavy">Project-heavy</option>
                <option value="mixed">Mixed</option>
              </select>
            </label>

            <label>
              Recommend
              <select
                value={feedbackDraft.recommendation}
                onChange={event =>
                  setFeedbackDraft(current => ({ ...current, recommendation: event.target.value }))}
                disabled={feedbackSaving}
              >
                <option value="yes">Yes</option>
                <option value="maybe">Maybe</option>
                <option value="no">No</option>
              </select>
            </label>
          </div>

          <label className="course-feedback-note-field">
            Short note
            <textarea
              value={feedbackDraft.note || ''}
              onChange={event =>
                setFeedbackDraft(current => ({ ...current, note: event.target.value }))}
              maxLength={500}
              rows={3}
              disabled={feedbackSaving}
              placeholder="Optional personal note about pacing, grading, or fit."
            />
          </label>

          <div className="helper-input-actions">
            <button type="submit" disabled={feedbackSaving}>
              {feedbackSaving ? 'Saving...' : 'Save Feedback'}
            </button>
            {getFeedback(activeFeedbackCourse.course) && (
              <button
                type="button"
                className="ghost-button"
                onClick={handleFeedbackDelete}
                disabled={feedbackSaving}
              >
                Delete Feedback
              </button>
            )}
          </div>
        </form>
      )}

      {feedbackError && <p className="error" role="alert">{feedbackError}</p>}

      {loading && <p className="status">Loading courses...</p>}

      {!loading && courses.length > 0 && (
        <div className="table-wrap">
          <table className="courses-table">
            <thead>
              <tr>
                <th>Course Code</th>
                <th>Name</th>
                <th>Faculty</th>
                <th>SU Credits</th>
                <th>ECTS Credits</th>
                <th>Feedback</th>
              </tr>
            </thead>
            <tbody>
              {filteredCourses.length > 0 ? (
                filteredCourses.map(course => {
                  const feedback = getFeedback(course.course)
                  return (
                    <tr key={course.course}>
                      <td className="course-code">{course.course}</td>
                      <td className="course-name">{course.name}</td>
                      <td>{course.faculty || '-'}</td>
                      <td className="credits">{formatCredit(course.su_credits)}</td>
                      <td className="credits">{formatCredit(course.ects_credits)}</td>
                      <td className="course-feedback-cell">
                        {feedback ? (
                          <div className="feedback-summary">
                            <span>{labelFor(feedback.recommendation)}</span>
                            <span>{labelFor(feedback.difficulty)}</span>
                            <span>{labelFor(feedback.workload)} workload</span>
                            {feedback.note && <small>{feedback.note}</small>}
                          </div>
                        ) : (
                          <span className="feedback-empty">No feedback</span>
                        )}
                        <button
                          type="button"
                          className="ghost-button course-feedback-button"
                          onClick={() => openFeedbackEditor(course)}
                        >
                          {feedback ? 'Edit' : 'Add'}
                        </button>
                      </td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan="6" className="no-results">
                    No courses found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default CourseCatalog

