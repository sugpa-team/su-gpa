import { useMemo, useState } from 'react'
import { apiRequest } from '../lib/api'
import './DegreeRequirementsHelper.css'

const LETTER_POINTS = { A: 4.0, 'A-': 3.7, 'B+': 3.3, B: 3.0, 'B-': 2.7, 'C+': 2.3, C: 2.0, 'C-': 1.7, 'D+': 1.3, D: 1.0, F: 0.0 }
const RESULT_TAB = { OVERVIEW: 'overview', DETAILS: 'details' }
const SECTION_TO_REQUIREMENTS_CATEGORY = {
  'UNIVERSITY COURSES': 'University Courses',
  'REQUIRED COURSES': 'Required Courses',
  'CORE ELECTIVES': 'Core Electives',
  'AREA ELECTIVES': 'Area Electives',
  'FREE ELECTIVES': 'Free Electives',
  'FACULTY COURSES': 'Faculty Courses',
  ENGINEERING: 'Engineering',
  'BASIC SCIENCE': 'Basic Science',
}

function DegreeRequirementsHelper({ onDataChanged }) {
  const [pastedText, setPastedText]             = useState('')
  const [loading, setLoading]                   = useState(false)
  const [importing, setImporting]               = useState(false)
  const [error, setError]                       = useState(null)
  const [importMessage, setImportMessage]       = useState(null)
  const [analysis, setAnalysis]                 = useState(null)
  const [activeResultTab, setActiveResultTab]   = useState(RESULT_TAB.OVERVIEW)
  const [requirementsCatalog, setRequirementsCatalog] = useState({})
  const [allCourses, setAllCourses]             = useState([])
  const [simulatedSemesters, setSimulatedSemesters] = useState([])
  const [categoryAdds, setCategoryAdds]         = useState([])
  const [draftBySemester, setDraftBySemester]   = useState({})
  const [categoryDrafts, setCategoryDrafts]     = useState({})

  const sectionEntries = useMemo(() => Object.entries(analysis?.sections || {}), [analysis])

  const courseByCode = useMemo(() => {
    const map = new Map()
    allCourses.forEach(course => map.set(String(course.course || '').toUpperCase(), course))
    return map
  }, [allCourses])

  const courseCategoryMap = useMemo(() => {
    const map = new Map()
    const priority = ['University Courses', 'Required Courses', 'Core Electives', 'Area Electives', 'Free Electives']
    priority.forEach(category => {
      ;(requirementsCatalog[category] || []).forEach(item => {
        const courseCode = String(item.course || '').toUpperCase()
        if (courseCode && !map.has(courseCode)) map.set(courseCode, category)
      })
    })
    return map
  }, [requirementsCatalog])

  const importedAttempts = useMemo(() => {
    if (!analysis?.sections) return []
    const records = []
    Object.entries(analysis.sections).forEach(([category, section]) => {
      ;(section.courses || []).forEach(course => {
        const su = course.su_credits ?? courseByCode.get(String(course.course).toUpperCase())?.su_credits
        records.push({ category, course: course.course, grade: course.grade, term: String(course.term || ''), su_credits: Number(su || 0), source_order: 0 })
      })
    })
    return records
  }, [analysis, courseByCode])

  const simulatedAttempts = useMemo(() => {
    const semesterAttempts = simulatedSemesters.flatMap((semester, si) =>
      (semester.courses || []).map((course, ci) => ({ ...course, source_order: 1000 + si * 100 + ci, term: String(990000 + si) })),
    )
    const categoryAttempts = categoryAdds.map((course, idx) => ({ ...course, source_order: 900000 + idx, term: String(999000 + idx) }))
    return [...semesterAttempts, ...categoryAttempts]
  }, [simulatedSemesters, categoryAdds])

  const takenCourseCodes = useMemo(() => {
    const set = new Set()
    ;[...importedAttempts, ...simulatedAttempts].forEach(item => {
      const code = String(item.course || '').toUpperCase()
      if (code) set.add(code)
    })
    return set
  }, [importedAttempts, simulatedAttempts])

  const gpaStats = useMemo(() => {
    const latestByCourse = new Map()
    ;[...importedAttempts, ...simulatedAttempts].forEach(item => {
      const code = String(item.course || '').toUpperCase()
      const current = latestByCourse.get(code)
      if (!current || String(item.term) > String(current.term) || item.source_order > current.source_order)
        latestByCourse.set(code, item)
    })
    let weighted = 0, total = 0
    latestByCourse.forEach(item => {
      const points = LETTER_POINTS[String(item.grade || '').toUpperCase()]
      if (points === undefined) return
      const credits = Number(item.su_credits || 0)
      weighted += points * credits
      total += credits
    })
    return { cgpa: total > 0 ? weighted / total : 0, countedCourses: latestByCourse.size }
  }, [importedAttempts, simulatedAttempts])

  const overviewRows = useMemo(
    () => sectionEntries.map(([sectionName, section]) => {
      const min = section.minimum_required || {}
      const completed = section.completed || {}
      const added = simulatedAttempts.filter(item => item.category === sectionName)
      const completedSu      = Number(completed.su_credits || 0) + added.reduce((sum, item) => sum + Number(item.su_credits || 0), 0)
      const completedEcts    = Number(completed.ects_credits || 0)
      const completedCourses = Number(completed.courses || 0) + added.length
      const minSu      = min.su_credits      != null ? Number(min.su_credits)      : null
      const minEcts    = min.ects_credits    != null ? Number(min.ects_credits)    : null
      const minCourses = min.courses         != null ? Number(min.courses)         : null
      const remainingSu      = minSu      !== null ? Math.max(0, minSu - completedSu)           : null
      const remainingEcts    = minEcts    !== null ? Math.max(0, minEcts - completedEcts)       : null
      const remainingCourses = minCourses !== null ? Math.max(0, minCourses - completedCourses) : null
      const progressCandidates = []
      if (minSu      && minSu      > 0) progressCandidates.push(Math.min(100, (completedSu      / minSu)      * 100))
      if (minEcts    && minEcts    > 0) progressCandidates.push(Math.min(100, (completedEcts    / minEcts)    * 100))
      if (minCourses && minCourses > 0) progressCandidates.push(Math.min(100, (completedCourses / minCourses) * 100))
      const progressPercent = progressCandidates.length > 0 ? Math.min(...progressCandidates) : null
      return { sectionName, completedSu, completedEcts, minSu, minEcts, completedCourses, minCourses, remainingSu, remainingEcts, remainingCourses, progressPercent }
    }),
    [sectionEntries, simulatedAttempts],
  )

  async function handleAnalyze() {
    if (!pastedText.trim()) return setError('Please paste the Bannerweb Degree Evaluation text first.')
    setLoading(true); setError(null); setImportMessage(null)
    try {
      const [result, catalogResponse, coursesResponse] = await Promise.all([
        apiRequest('/api/bannerweb/analyze', { method: 'POST', body: JSON.stringify({ raw_text: pastedText }) }),
        apiRequest('/api/graduation-requirements/catalog'),
        apiRequest('/courses'),
      ])
      setAnalysis(result)
      setRequirementsCatalog(catalogResponse.categories || {})
      setAllCourses(coursesResponse || [])
      setSimulatedSemesters([]); setCategoryAdds([]); setDraftBySemester({}); setCategoryDrafts({})
      setActiveResultTab(RESULT_TAB.OVERVIEW)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleImport() {
    if (!pastedText.trim()) return setError('Please paste the Bannerweb Degree Evaluation text first.')
    setImporting(true); setError(null); setImportMessage(null)
    try {
      const result = await apiRequest('/api/bannerweb/import', { method: 'POST', body: JSON.stringify({ raw_text: pastedText }) })
      const imported = result.imported_courses ?? 0
      const semesters = result.created_semesters ?? 0
      const skippedCount = (result.skipped || []).length
      let message = `Imported ${imported} course${imported === 1 ? '' : 's'} into ${semesters} new semester${semesters === 1 ? '' : 's'}.`
      if (skippedCount > 0) message += ` Skipped ${skippedCount} (already present or not in catalog).`
      setImportMessage(message)
      if (onDataChanged) onDataChanged()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setImporting(false)
    }
  }

  async function handleClearAll() {
    const confirmed = window.confirm('This will permanently delete all your semesters and courses (imported or manually added). Continue?')
    if (!confirmed) return
    setImporting(true); setError(null); setImportMessage(null)
    try {
      await apiRequest('/api/reset', { method: 'POST' })
      setAnalysis(null)
      setImportMessage('All semesters and courses cleared.')
      if (onDataChanged) onDataChanged()
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setImporting(false)
    }
  }

  function handleAddSemester() {
    setSimulatedSemesters(current => [...current, { id: crypto.randomUUID(), name: `Semester ${current.length + 1}`, courses: [] }])
  }

  function handleAddCourseToSemester(semesterId) {
    const draft = draftBySemester[semesterId] || {}
    if (!draft.course || !draft.grade) return
    const normalizedCourseCode = String(draft.course).toUpperCase()
    const inferredCategory = courseCategoryMap.get(normalizedCourseCode)
    if (!inferredCategory) { setError('Course category could not be inferred from requirement mapping.'); return }
    const catalogCourse = courseByCode.get(normalizedCourseCode)
    setSimulatedSemesters(current =>
      current.map(semester =>
        semester.id !== semesterId ? semester : {
          ...semester,
          courses: [...semester.courses, { course: draft.course, grade: draft.grade, category: inferredCategory, su_credits: Number(catalogCourse?.su_credits || 0) }],
        },
      ),
    )
    setDraftBySemester(current => ({ ...current, [semesterId]: {} }))
  }

  function handleAddCourseToCategory(categoryName) {
    const draft = categoryDrafts[categoryName] || {}
    if (!draft.course || !draft.grade) return
    const catalogCourse = courseByCode.get(String(draft.course).toUpperCase())
    setCategoryAdds(current => [...current, { category: categoryName, course: draft.course, grade: draft.grade, su_credits: Number(catalogCourse?.su_credits || 0) }])
    setCategoryDrafts(current => ({ ...current, [categoryName]: {} }))
  }

  const busy = loading || importing

  return (
    <section className="drh-root" aria-labelledby="drh-title">

      
      <header className="drh-header">
        <p className="drh-eyebrow">Bannerweb</p>
        <h2 id="drh-title" className="drh-title">Degree Requirements Helper</h2>
        <p className="drh-subtitle">
          Import your degree progress from Bannerweb, then plan future semesters and run GPA simulations on top of your existing record.
        </p>
      </header>

      
      <article className="drh-instructions" aria-label="How to copy data from Bannerweb">
        <h3 className="drh-instructions-title">How to use</h3>
        <ol className="drh-steps-list">
          <li>In Bannerweb, go to <strong>Student → Degree Audit and Graduation → Degree Evaluation (Summary) → Generate New Request</strong>.</li>
          <li>Select all page content with <kbd>Ctrl/⌘ A</kbd>, then copy with <kbd>Ctrl/⌘ C</kbd>.</li>
          <li>Paste into the field below and click <strong>Analyze</strong>.</li>
        </ol>
      </article>

      
      <div className="drh-paste-panel">
        <label className="drh-field-label" htmlFor="bannerweb-paste-input">Bannerweb output</label>
        <textarea
          id="bannerweb-paste-input"
          className="drh-textarea"
          value={pastedText}
          onChange={event => setPastedText(event.target.value)}
          placeholder="Paste the full Degree Evaluation text here…"
          rows={12}
          disabled={busy}
        />

        <div className="drh-paste-actions">
          <button className="drh-btn drh-btn--primary" type="button" onClick={handleAnalyze} disabled={busy}>
            {loading ? 'Analyzing…' : 'Analyze'}
          </button>
          {analysis && (
            <button className="drh-btn drh-btn--secondary" type="button" onClick={handleImport} disabled={busy}>
              {importing ? 'Importing…' : 'Import to Profile'}
            </button>
          )}
          <button className="drh-btn drh-btn--danger" type="button" onClick={handleClearAll} disabled={busy}>
            Clear All Data
          </button>
        </div>

        {importMessage && <p className="drh-feedback drh-feedback--info" role="status">{importMessage}</p>}
        {error        && <p className="drh-feedback drh-feedback--error" role="alert">{error}</p>}
      </div>

      
      {analysis && (
        <div className="drh-analysis">

          
          <div className="drh-analysis-meta">
            <p className="drh-analysis-summary">
              Parsed <strong>{analysis.analysis?.total_courses_parsed ?? 0}</strong> courses across <strong>{analysis.analysis?.total_sections_parsed ?? 0}</strong> sections.
            </p>
          </div>

          
          <nav className="drh-tabs" aria-label="Analysis views">
            {[
              { id: RESULT_TAB.OVERVIEW, label: 'Overall Progress' },
              { id: RESULT_TAB.DETAILS,  label: 'Category Courses & Grades' },
            ].map(tab => (
              <button
                key={tab.id}
                type="button"
                className={['drh-tab', activeResultTab === tab.id ? 'drh-tab--active' : ''].join(' ').trim()}
                onClick={() => setActiveResultTab(tab.id)}
                aria-pressed={activeResultTab === tab.id}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          
          {activeResultTab === RESULT_TAB.OVERVIEW && (
            <div className="drh-overview">

              
              <div className="drh-gpa-strip">
                <article className="drh-stat-card">
                  <span className="drh-stat-label">Simulated CGPA</span>
                  <strong className="drh-stat-value">{gpaStats.cgpa.toFixed(2)}</strong>
                </article>
                <article className="drh-stat-card">
                  <span className="drh-stat-label">Unique Courses Counted</span>
                  <strong className="drh-stat-value">{gpaStats.countedCourses}</strong>
                </article>
              </div>

              
              <div className="drh-cards-grid">
                {overviewRows.map(item => {
                  const isDone = item.progressPercent !== null && item.progressPercent >= 100
                  return (
                    <article
                      key={item.sectionName}
                      className={['drh-req-card', isDone ? 'drh-req-card--done' : ''].join(' ').trim()}
                    >
                      <div className="drh-req-card-head">
                        <h3 className="drh-req-card-title">{item.sectionName}</h3>
                        <span className={['drh-pct-badge', isDone ? 'drh-pct-badge--done' : ''].join(' ').trim()}>
                          {item.progressPercent !== null ? `${item.progressPercent.toFixed(1)}%` : '—'}
                        </span>
                      </div>

                      <div className="drh-meter" aria-hidden="true">
                        <div
                          className={['drh-meter-fill', isDone ? 'drh-meter-fill--done' : ''].join(' ').trim()}
                          style={{ width: `${item.progressPercent || 0}%` }}
                        />
                      </div>

                      <dl className="drh-req-meta">
                        <div className="drh-req-meta-row">
                          <dt>SU Credits</dt>
                          <dd>{item.completedSu.toFixed(2)} <em>/ {item.minSu ?? '—'}</em></dd>
                        </div>
                        <div className="drh-req-meta-row">
                          <dt>ECTS Credits</dt>
                          <dd>{item.completedEcts.toFixed(2)} <em>/ {item.minEcts ?? '—'}</em></dd>
                        </div>
                        <div className="drh-req-meta-row">
                          <dt>Courses</dt>
                          <dd>{item.completedCourses} <em>/ {item.minCourses ?? '—'}</em></dd>
                        </div>
                        <div className="drh-req-meta-row drh-req-meta-row--remaining">
                          <dt>Remaining</dt>
                          <dd>{item.remainingSu ?? '—'} SU · {item.remainingEcts ?? '—'} ECTS · {item.remainingCourses ?? '—'} courses</dd>
                        </div>
                      </dl>
                    </article>
                  )
                })}
              </div>

              <p className="drh-note">
                Engineering, Faculty Courses, and Basic Science progress currently uses parsed Bannerweb summary values.
              </p>

              
              <div className="drh-sim-section">
                <div className="drh-sim-header">
                  <h3 className="drh-sim-title">Simulate Future Semesters</h3>
                  <button className="drh-btn drh-btn--secondary" type="button" onClick={handleAddSemester}>
                    + Add Semester
                  </button>
                </div>

                {simulatedSemesters.map(semester => (
                  <article key={semester.id} className="drh-sim-semester">
                    <div className="drh-sim-semester-head">
                      <h4 className="drh-sim-semester-title">{semester.name}</h4>
                      <span className="drh-sim-course-count">{semester.courses.length} courses</span>
                    </div>

                    {semester.courses.length > 0 && (
                      <ul className="drh-sim-course-list">
                        {semester.courses.map(course => (
                          <li key={`${course.course}-${course.grade}`} className="drh-sim-course-item">
                            <span className="drh-sim-course-code">{course.course}</span>
                            <span className="drh-sim-course-cat">{course.category}</span>
                            <span className="drh-sim-course-grade">{course.grade}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="drh-sim-form">
                      <select
                        className="drh-select"
                        value={draftBySemester[semester.id]?.course || ''}
                        onChange={event => setDraftBySemester(current => ({ ...current, [semester.id]: { ...current[semester.id], course: event.target.value } }))}
                      >
                        <option value="">Select course…</option>
                        {allCourses.map(course => (
                          <option key={course.course} value={course.course}>{course.course} – {course.name}</option>
                        ))}
                      </select>
                      <select
                        className="drh-select drh-select--narrow"
                        value={draftBySemester[semester.id]?.grade || ''}
                        onChange={event => setDraftBySemester(current => ({ ...current, [semester.id]: { ...current[semester.id], grade: event.target.value } }))}
                      >
                        <option value="">Grade</option>
                        {Object.keys(LETTER_POINTS).map(grade => (
                          <option key={grade} value={grade}>{grade}</option>
                        ))}
                      </select>
                      <button
                        className="drh-btn drh-btn--primary"
                        type="button"
                        onClick={() => handleAddCourseToSemester(semester.id)}
                      >
                        Add
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}

          
          {activeResultTab === RESULT_TAB.DETAILS && (
            <div className="drh-details">
              <p className="drh-analysis-summary">
                Simulated CGPA: <strong>{gpaStats.cgpa.toFixed(2)}</strong>
              </p>

              <div className="drh-cards-grid">
                {sectionEntries.map(([sectionName, section]) => {
                  const requirementsCategoryName = SECTION_TO_REQUIREMENTS_CATEGORY[sectionName] || sectionName
                  const simulatedInCategory = simulatedAttempts.filter(item => item.category === sectionName)
                  const allCoursesInSection = [...(section.courses || []), ...simulatedInCategory]

                  return (
                    <article key={sectionName} className="drh-req-card">
                      <div className="drh-req-card-head">
                        <h3 className="drh-req-card-title">{sectionName}</h3>
                        <span className="drh-pct-badge">{allCoursesInSection.length} courses</span>
                      </div>

                      {allCoursesInSection.length > 0 && (
                        <ul className="drh-detail-course-list">
                          {(section.courses || []).map(course => (
                            <li key={`${sectionName}-${course.course}-${course.term}`} className="drh-detail-course">
                              <span className="drh-detail-course-code">{course.course}</span>
                              <span className="drh-detail-course-grade">{course.grade}</span>
                              <span className="drh-detail-course-term">{course.term}</span>
                            </li>
                          ))}
                          {simulatedInCategory.map((course, idx) => (
                            <li key={`${sectionName}-sim-${course.course}-${idx}`} className="drh-detail-course drh-detail-course--sim">
                              <span className="drh-detail-course-code">{course.course}</span>
                              <span className="drh-detail-course-grade">{course.grade}</span>
                              <span className="drh-detail-course-term">simulated</span>
                            </li>
                          ))}
                        </ul>
                      )}

                      <div className="drh-sim-form">
                        <select
                          className="drh-select"
                          value={categoryDrafts[sectionName]?.course || ''}
                          onChange={event => setCategoryDrafts(current => ({ ...current, [sectionName]: { ...current[sectionName], course: event.target.value } }))}
                        >
                          <option value="">Select {sectionName} course…</option>
                          {(requirementsCatalog[requirementsCategoryName] || [])
                            .filter(item => !takenCourseCodes.has(String(item.course || '').toUpperCase()))
                            .map(item => (
                              <option key={item.course} value={item.course}>{item.course}</option>
                            ))}
                        </select>
                        <select
                          className="drh-select drh-select--narrow"
                          value={categoryDrafts[sectionName]?.grade || ''}
                          onChange={event => setCategoryDrafts(current => ({ ...current, [sectionName]: { ...current[sectionName], grade: event.target.value } }))}
                        >
                          <option value="">Grade</option>
                          {Object.keys(LETTER_POINTS).map(grade => (
                            <option key={grade} value={grade}>{grade}</option>
                          ))}
                        </select>
                        <button
                          className="drh-btn drh-btn--primary"
                          type="button"
                          onClick={() => handleAddCourseToCategory(sectionName)}
                        >
                          Add
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default DegreeRequirementsHelper
