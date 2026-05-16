import { useEffect, useMemo, useState } from 'react'

import { apiRequest } from '../lib/api'
import './CourseCatalog.css'

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
    difficulty:      feedback?.difficulty    || EMPTY_FEEDBACK_DRAFT.difficulty,
    workload:        feedback?.workload      || EMPTY_FEEDBACK_DRAFT.workload,
    grading_style:   feedback?.grading_style || EMPTY_FEEDBACK_DRAFT.grading_style,
    recommendation:  feedback?.recommendation|| EMPTY_FEEDBACK_DRAFT.recommendation,
    note:            feedback?.note          || '',
  }
}
const RECOMMENDATION_MOD = { yes: 'pos', maybe: 'neu', no: 'neg' }
const DIFFICULTY_MOD      = { easy: 'pos', medium: 'neu', hard: 'neg' }
const WORKLOAD_MOD        = { low: 'pos', medium: 'neu', high: 'neg' }

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
        if (!ignore) setFeedbackError(error.message)
      })

    return () => { ignore = true }
  }, [])

  const faculties = useMemo(
    () => ['all', ...new Set(courses.map(course => course.faculty).filter(Boolean))],
    [courses],
  )

  const filteredCourses = useMemo(() => {
    const search = courseSearch.trim().toLowerCase()
    return courses.filter(course => {
      const matchesFaculty = selectedFaculty === 'all' || course.faculty === selectedFaculty
      const matchesSearch  = !search || course.course.toLowerCase().includes(search) || course.name.toLowerCase().includes(search)
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
    if (!activeFeedbackCourse) return
    setFeedbackSaving(true)
    setFeedbackError(null)
    try {
      const saved = await apiRequest(feedbackPath(activeFeedbackCourse.course), {
        method: 'PUT',
        body: JSON.stringify(feedbackDraft),
      })
      setFeedbackSummaries(current => ({ ...current, [saved.course_code]: saved }))
      setActiveFeedbackCourse({ ...activeFeedbackCourse, course: saved.course_code })
    } catch (error) {
      setFeedbackError(error.message)
    } finally {
      setFeedbackSaving(false)
    }
  }

  async function handleFeedbackDelete() {
    if (!activeFeedbackCourse) return
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
    <section className="cc-root" aria-labelledby="course-list-title">

      
      <header className="cc-header">
        <div className="cc-header-left">
          <p className="cc-eyebrow">Course Catalog</p>
          <h2 id="course-list-title" className="cc-title">Find Courses</h2>
        </div>
        <span className="cc-count">{filteredCourses.length} courses</span>
      </header>

      
      <div className="cc-filters" role="search">
        <div className="cc-filter-group">
          <label className="cc-field-label" htmlFor="faculty-dropdown">Faculty</label>
          <select
            id="faculty-dropdown"
            className="cc-select"
            value={selectedFaculty}
            onChange={event => setSelectedFaculty(event.target.value)}
          >
            {faculties.map(faculty => (
              <option key={faculty} value={faculty}>
                {faculty === 'all' ? 'All Faculties' : faculty}
              </option>
            ))}
          </select>
        </div>

        <div className="cc-filter-group cc-filter-group--grow">
          <label className="cc-field-label" htmlFor="course-search">Search</label>
          <input
            id="course-search"
            className="cc-input"
            type="search"
            value={courseSearch}
            onChange={event => setCourseSearch(event.target.value)}
            placeholder="CS 201 or accounting…"
          />
        </div>
      </div>

      
      {activeFeedbackCourse && (
        <form className="cc-feedback-panel" onSubmit={handleFeedbackSave} noValidate>
          <div className="cc-feedback-panel-head">
            <div>
              <p className="cc-eyebrow">Course Feedback</p>
              <h3 className="cc-feedback-course-code">{activeFeedbackCourse.course}</h3>
              <p className="cc-feedback-course-name">{activeFeedbackCourse.name}</p>
            </div>
            <button type="button" className="cc-btn cc-btn--ghost" onClick={closeFeedbackEditor}>
              Close
            </button>
          </div>

          <div className="cc-feedback-fields">
            {[
              { label: 'Difficulty', field: 'difficulty', options: [['easy','Easy'],['medium','Medium'],['hard','Hard']] },
              { label: 'Workload',   field: 'workload',   options: [['low','Low'],['medium','Medium'],['high','High']] },
              { label: 'Grading',    field: 'grading_style', options: [['exam-heavy','Exam-heavy'],['project-heavy','Project-heavy'],['mixed','Mixed']] },
              { label: 'Recommend',  field: 'recommendation', options: [['yes','Yes'],['maybe','Maybe'],['no','No']] },
            ].map(({ label, field, options }) => (
              <div key={field} className="cc-feedback-field">
                <label className="cc-field-label" htmlFor={`fb-${field}`}>{label}</label>
                <select
                  id={`fb-${field}`}
                  className="cc-select"
                  value={feedbackDraft[field]}
                  onChange={event => setFeedbackDraft(current => ({ ...current, [field]: event.target.value }))}
                  disabled={feedbackSaving}
                >
                  {options.map(([value, text]) => (
                    <option key={value} value={value}>{text}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="cc-feedback-note">
            <label className="cc-field-label" htmlFor="fb-note">Short note</label>
            <textarea
              id="fb-note"
              className="cc-textarea"
              value={feedbackDraft.note || ''}
              onChange={event => setFeedbackDraft(current => ({ ...current, note: event.target.value }))}
              maxLength={500}
              rows={3}
              disabled={feedbackSaving}
              placeholder="Optional personal note about pacing, grading, or fit."
            />
          </div>

          {feedbackError && (
            <p className="cc-feedback cc-feedback--error" role="alert">{feedbackError}</p>
          )}

          <div className="cc-feedback-actions">
            <button className="cc-btn cc-btn--primary" type="submit" disabled={feedbackSaving}>
              {feedbackSaving ? 'Saving…' : 'Save Feedback'}
            </button>
            {getFeedback(activeFeedbackCourse.course) && (
              <button
                className="cc-btn cc-btn--ghost"
                type="button"
                onClick={handleFeedbackDelete}
                disabled={feedbackSaving}
              >
                Delete
              </button>
            )}
          </div>
        </form>
      )}

      
      {feedbackError && !activeFeedbackCourse && (
        <p className="cc-feedback cc-feedback--error" role="alert">{feedbackError}</p>
      )}

      
      {loading && <p className="cc-status">Loading courses…</p>}

      
      {!loading && courses.length > 0 && (
        <div className="cc-table-wrap">
          <table className="cc-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Faculty</th>
                <th className="cc-th--num">SU</th>
                <th className="cc-th--num">ECTS</th>
                <th>Feedback</th>
              </tr>
            </thead>
            <tbody>
              {filteredCourses.length > 0 ? (
                filteredCourses.map(course => {
                  const feedback = getFeedback(course.course)
                  return (
                    <tr key={course.course} className="cc-row">
                      <td className="cc-td-code">{course.course}</td>
                      <td className="cc-td-name">{course.name}</td>
                      <td className="cc-td-faculty">{course.faculty || '—'}</td>
                      <td className="cc-td-num">{formatCredit(course.su_credits)}</td>
                      <td className="cc-td-num">{formatCredit(course.ects_credits)}</td>
                      <td className="cc-td-feedback">
                        {feedback ? (
                          <div className="cc-badges">
                            <span className={`cc-badge cc-badge--${RECOMMENDATION_MOD[feedback.recommendation]}`}>
                              {labelFor(feedback.recommendation)}
                            </span>
                            <span className={`cc-badge cc-badge--${DIFFICULTY_MOD[feedback.difficulty]}`}>
                              {labelFor(feedback.difficulty)}
                            </span>
                            <span className={`cc-badge cc-badge--${WORKLOAD_MOD[feedback.workload]}`}>
                              {labelFor(feedback.workload)} load
                            </span>
                            {feedback.note && (
                              <span className="cc-feedback-note-preview" title={feedback.note}>
                                {feedback.note}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="cc-no-feedback">—</span>
                        )}
                        <button
                          type="button"
                          className="cc-btn cc-btn--inline"
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
                  <td className="cc-empty-row" colSpan="6">No courses match your search.</td>
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
