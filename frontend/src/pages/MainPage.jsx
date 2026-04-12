import { useEffect, useMemo, useState } from 'react'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
const EMPTY_SUMMARY = {
  semesters: [],
  cumulative_gpa: 0,
  cgpa: 0,
  semester_gpa: {},
  max_semester_su_credits: 20,
}
const GRADE_OPTIONS = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F']

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  })

  if (response.status === 204) {
    return null
  }

  const data = await response.json()
  if (!response.ok) {
    const message = Array.isArray(data.detail)
      ? data.detail.map(item => item.msg).join(', ')
      : data.detail || 'Request failed'
    throw new Error(message)
  }

  return data
}

function formatNumber(value) {
  return Number(value || 0).toFixed(2)
}

function formatCredit(value) {
  return value === null || value === undefined ? '-' : Number(value).toFixed(2)
}

function MainPage() {
  const [courses, setCourses] = useState([])
  const [summary, setSummary] = useState(EMPTY_SUMMARY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [semesterName, setSemesterName] = useState('')
  const [courseSearch, setCourseSearch] = useState('')
  const [selectedFaculty, setSelectedFaculty] = useState('all')
  const [selectedCourses, setSelectedCourses] = useState({})

  useEffect(() => {
    let ignore = false

    async function loadInitialData() {
      try {
        const [coursesData, summaryData] = await Promise.all([
          apiRequest('/courses'),
          apiRequest('/api/gpa'),
        ])

        if (!ignore) {
          setCourses(coursesData)
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

    loadInitialData()

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
        !search ||
        course.course.toLowerCase().includes(search) ||
        course.name.toLowerCase().includes(search)

      return matchesFaculty && matchesSearch
    })
  }, [courseSearch, courses, selectedFaculty])

  const totalPlannedCredits = useMemo(
    () => summary.semesters.reduce((total, semester) => total + semester.total_su_credits, 0),
    [summary.semesters],
  )
  const cgpa = summary.cgpa ?? summary.cumulative_gpa

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

  async function handleCreateSemester(event) {
    event.preventDefault()

    await runAction(async () => {
      const nextSummary = await apiRequest('/taken-courses/semesters', {
        method: 'POST',
        body: JSON.stringify({ name: semesterName }),
      })
      setSemesterName('')
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
    const courseCode = selectedCourses[semesterId]
    if (!courseCode) {
      setError('Select a course before adding it.')
      return
    }

    await runAction(async () => {
      const nextSummary = await apiRequest('/api/courses', {
        method: 'POST',
        body: JSON.stringify({ semester_id: semesterId, course_code: courseCode }),
      })
      setSelectedCourses(current => ({ ...current, [semesterId]: '' }))
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

  function courseOptionsForSemester(semester) {
    const usedCourseCodes = new Set(semester.courses.map(course => course.course_code))
    const remainingCredits = summary.max_semester_su_credits - semester.total_su_credits

    return courses.filter(course => {
      if (course.su_credits === null || course.su_credits === undefined) {
        return false
      }

      const credits = Number(course.su_credits || 0)
      return !usedCourseCodes.has(course.course) && credits <= remainingCredits
    })
  }

  return (
    <main className="main-page">
      <section className="planner-shell" aria-labelledby="planner-title">
        <div className="planner-header">
          <div>
            <p className="eyebrow">Sabanci University</p>
            <h1 id="planner-title">GPA Planner</h1>
          </div>
          <div className="gpa-score" aria-live="polite">
            <span>Overall GPA</span>
            <strong>{formatNumber(cgpa)}</strong>
          </div>
        </div>

        <div className="summary-strip">
          <div>
            <span>Semesters</span>
            <strong>{summary.semesters.length}</strong>
          </div>
          <div>
            <span>Planned SU Credits</span>
            <strong>{formatNumber(totalPlannedCredits)}</strong>
          </div>
          <div>
            <span>Semester Limit</span>
            <strong>{formatNumber(summary.max_semester_su_credits)}</strong>
          </div>
        </div>

        <form className="semester-form" onSubmit={handleCreateSemester}>
          <label htmlFor="semester-name">New Semester</label>
          <div className="semester-form-controls">
            <input
              id="semester-name"
              type="text"
              value={semesterName}
              onChange={event => setSemesterName(event.target.value)}
              placeholder="Fall 2026"
              disabled={saving}
            />
            <button type="submit" disabled={saving || !semesterName.trim()}>
              Create Semester
            </button>
          </div>
        </form>

        {loading && <p className="status">Loading planner...</p>}
        {error && <p className="error" role="alert">{error}</p>}

        {!loading && summary.semesters.length === 0 && (
          <p className="empty-state">Create a semester to start planning courses and grades.</p>
        )}

        <div className="semesters-grid">
          {summary.semesters.map(semester => {
            const options = courseOptionsForSemester(semester)
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
                      {formatNumber(semester.total_su_credits)} /{' '}
                      {formatNumber(summary.max_semester_su_credits)} SU Credits
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

                <div className="add-course-row">
                  <select
                    value={selectedCourses[semester.id] || ''}
                    onChange={event =>
                      setSelectedCourses(current => ({
                        ...current,
                        [semester.id]: event.target.value,
                      }))
                    }
                    disabled={saving || options.length === 0}
                    aria-label={`Course for ${semester.name}`}
                  >
                    <option value="">
                      {options.length === 0 ? 'No course fits remaining credits' : 'Select course'}
                    </option>
                    {options.map(course => (
                      <option key={course.course} value={course.course}>
                        {course.course} - {course.name} ({formatNumber(course.su_credits)} SU)
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => handleAddCourse(semester.id)} disabled={saving}>
                    Add Course
                  </button>
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
                          value={course.grade || ''}
                          onChange={event =>
                            handleGradeChange(course.id, event.target.value)
                          }
                          disabled={saving}
                          aria-label={`Grade for ${course.course_code}`}
                        >
                          <option value="">Grade</option>
                          {GRADE_OPTIONS.map(grade => (
                            <option key={grade} value={grade}>{grade}</option>
                          ))}
                        </select>
                        <button
                          className="ghost-button"
                          type="button"
                          onClick={() => handleRemoveCourse(course.id)}
                          disabled={saving}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
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
                </tr>
              </thead>
              <tbody>
                {filteredCourses.length > 0 ? (
                  filteredCourses.map(course => (
                    <tr key={course.course}>
                      <td className="course-code">{course.course}</td>
                      <td className="course-name">{course.name}</td>
                      <td>{course.faculty || '-'}</td>
                      <td className="credits">{formatCredit(course.su_credits)}</td>
                      <td className="credits">{formatCredit(course.ects_credits)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="no-results">No courses found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}

export default MainPage
