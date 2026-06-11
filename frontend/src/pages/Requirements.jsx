import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../lib/api'
import CreditSummaryCard from '../components/CreditSummaryCard'
import './Requirements.css'

function formatValue(value) {
  if (value === null || value === undefined) return '-'
  return Number(value).toFixed(2)
}

function getSafePercent(completed, required) {
  const safeCompleted = Number(completed || 0)
  const safeRequired  = Number(required  || 0)
  if (!safeRequired) return 0
  return Math.min(100, (safeCompleted / safeRequired) * 100)
}

function categoryDomId(category) {
  const slug = String(category || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return slug || 'category'
}

function countedCreditLabel(course, category) {
  if (category.required_su != null && course.counted_su != null) {
    return `${formatValue(course.counted_su)} SU`
  }
  if (category.required_ects != null && course.counted_ects != null) {
    return `${formatValue(course.counted_ects)} ECTS`
  }
  if (course.counted_su != null) return `${formatValue(course.counted_su)} SU`
  if (course.counted_ects != null) return `${formatValue(course.counted_ects)} ECTS`
  return '-'
}

function Requirements({ dataVersion = 0, onDataChanged }) {
  const [importOpen, setImportOpen] = useState(false)

  // GR state
  const [grLoading, setGrLoading] = useState(true)
  const [grError, setGrError] = useState(null)
  const [categories, setCategories] = useState([])
  const [creditTotals, setCreditTotals] = useState({ completed: 0, required: null })
  const [expandedCategory, setExpandedCategory] = useState(null)

  // DRH state
  const [pastedText, setPastedText] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState(null)
  const [importMessage, setImportMessage] = useState(null)

  // GR computed
  const overview = useMemo(() => {
    const safeCategories = categories || []
    const progressValues = safeCategories
      .map(item => item.progress_percent)
      .filter(value => value !== null && value !== undefined)
    const overallPercent =
      progressValues.length > 0
        ? progressValues.reduce((sum, value) => sum + Number(value), 0) / progressValues.length
        : 0
    return {
      overallPercent,
      completedCount: safeCategories.filter(item => Number(item.progress_percent || 0) >= 100).length,
      totalCount: safeCategories.length,
    }
  }, [categories])

  // GR fetch — re-runs whenever dataVersion changes (e.g. after import)
  useEffect(() => {
    let ignore = false
    setGrLoading(true)

    async function loadProgress() {
      try {
        const res = await apiRequest('/api/graduation-requirements')
        if (!ignore) {
          setCategories(res.categories || [])
          setCreditTotals({
            completed: Number(res.total_credits_completed || 0),
            required: res.total_credits_required != null ? Number(res.total_credits_required) : null,
          })
          setGrError(null)
        }
      } catch (err) {
        if (!ignore) setGrError(err.message)
      } finally {
        if (!ignore) setGrLoading(false)
      }
    }

    loadProgress()
    return () => { ignore = true }
  }, [dataVersion])

  useEffect(() => {
    if (!expandedCategory) return
    if (!categories.some(item => item.category === expandedCategory)) {
      setExpandedCategory(null)
    }
  }, [categories, expandedCategory])

  async function handleImport() {
    if (!pastedText.trim()) return setError('Please paste the Bannerweb Degree Evaluation text first.')
    setImporting(true); setError(null); setImportMessage(null)
    try {
      const result = await apiRequest('/api/bannerweb/import', { method: 'POST', body: JSON.stringify({ raw_text: pastedText }) })
      const imported = result.imported_courses ?? 0
      const semesters = result.created_semesters ?? 0
      const skippedCount = (result.skipped || []).length
      let message = `Imported ${imported} course${imported === 1 ? '' : 's'} into ${semesters} semester${semesters === 1 ? '' : 's'}.`
      if (result.replaced_existing_data) message += ' Existing GPA Calculator data was replaced.'
      if (skippedCount > 0) message += ` Skipped ${skippedCount} (already present or not in catalog).`
      setImportMessage(message)
      setImportOpen(false)
      if (onDataChanged) onDataChanged()
    } catch (err) {
      setError(err.message)
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
      setImportMessage('All semesters and courses cleared.')
      if (onDataChanged) onDataChanged()
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  function toggleCategory(categoryName) {
    setExpandedCategory(current => current === categoryName ? null : categoryName)
  }

  function handleCategoryKeyDown(event, categoryName) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    toggleCategory(categoryName)
  }

  const busy = importing

  return (
    <section className="gr-root drh-root" aria-labelledby="requirements-title">

      {/* Header with import toggle */}
      <header className="gr-header">
        <div>
          <p className="gr-eyebrow">Graduation Progress</p>
          <h2 id="requirements-title" className="gr-title">Graduation Requirements</h2>
        </div>
        <button
          type="button"
          className="drh-btn drh-btn--secondary gr-header-action"
          onClick={() => setImportOpen(open => !open)}
        >
          {importOpen ? 'Hide Import' : 'Import from Bannerweb'}
        </button>
      </header>

      {/* Bannerweb import panel */}
      {importOpen && (
        <div className="gr-import-panel">

          <article className="drh-instructions" aria-label="How to copy data from Bannerweb">
            <h3 className="drh-instructions-title">How to use</h3>
            <ol className="drh-steps-list">
              <li>In Bannerweb, go to <strong>Student → Degree Audit and Graduation → Degree Evaluation (Summary) → Generate New Request</strong>.</li>
              <li>Select all page content with <kbd>Ctrl/⌘ A</kbd>, then copy with <kbd>Ctrl/⌘ C</kbd>.</li>
              <li>Paste into the field below and click <strong>Import to Profile</strong>.</li>
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
              rows={10}
              disabled={busy}
            />
            <div className="drh-paste-actions">
              <button className="drh-btn drh-btn--primary" type="button" onClick={handleImport} disabled={busy}>
                {importing ? 'Importing…' : 'Import to Profile'}
              </button>
              <button className="drh-btn drh-btn--danger" type="button" onClick={handleClearAll} disabled={busy}>
                Clear All Data
              </button>
            </div>
            {importMessage && <p className="drh-feedback drh-feedback--info" role="status">{importMessage}</p>}
            {error        && <p className="drh-feedback drh-feedback--error" role="alert">{error}</p>}
          </div>

          {/*
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
                            onChange={e => setDraftBySemester(cur => ({ ...cur, [semester.id]: { ...cur[semester.id], course: e.target.value } }))}
                          >
                            <option value="">Select course…</option>
                            {allCourses.map(c => (
                              <option key={c.course} value={c.course}>{c.course} – {c.name}</option>
                            ))}
                          </select>
                          <select
                            className="drh-select drh-select--narrow"
                            value={draftBySemester[semester.id]?.grade || ''}
                            onChange={e => setDraftBySemester(cur => ({ ...cur, [semester.id]: { ...cur[semester.id], grade: e.target.value } }))}
                          >
                            <option value="">Grade</option>
                            {Object.keys(LETTER_POINTS).map(g => (
                              <option key={g} value={g}>{g}</option>
                            ))}
                          </select>
                          <button className="drh-btn drh-btn--primary" type="button" onClick={() => handleAddCourseToSemester(semester.id)}>
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
                      const reqCategoryName = SECTION_TO_REQUIREMENTS_CATEGORY[sectionName] || sectionName
                      const simulatedInCategory = simulatedAllocation.get(sectionName) || []
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
                                  <span className="drh-detail-course-term">
                                    {course.category !== sectionName ? 'simulated · overflow' : 'simulated'}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}

                          <div className="drh-sim-form">
                            <select
                              className="drh-select"
                              value={categoryDrafts[sectionName]?.course || ''}
                              onChange={e => setCategoryDrafts(cur => ({ ...cur, [sectionName]: { ...cur[sectionName], course: e.target.value } }))}
                            >
                              <option value="">Select {sectionName} course…</option>
                              {(requirementsCatalog[reqCategoryName] || [])
                                .filter(item => !takenCourseCodes.has(String(item.course || '').toUpperCase()))
                                .map(item => (
                                  <option key={item.course} value={item.course}>{item.course}</option>
                                ))}
                            </select>
                            <select
                              className="drh-select drh-select--narrow"
                              value={categoryDrafts[sectionName]?.grade || ''}
                              onChange={e => setCategoryDrafts(cur => ({ ...cur, [sectionName]: { ...cur[sectionName], grade: e.target.value } }))}
                            >
                              <option value="">Grade</option>
                              {Object.keys(LETTER_POINTS).map(g => (
                                <option key={g} value={g}>{g}</option>
                              ))}
                            </select>
                            <button className="drh-btn drh-btn--primary" type="button" onClick={() => handleAddCourseToCategory(sectionName)}>
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
          */}
        </div>
      )}

      {/* Graduation progress */}
      {grLoading && <p className="gr-status">Loading requirement progress…</p>}
      {grError   && <p className="gr-feedback gr-feedback--error" role="alert">{grError}</p>}

      {!grLoading && !grError && (
        <>
          <div className="gr-overview" aria-label="Overall graduation progress">
            <article className="gr-overview-card">
              <span className="gr-overview-label">Overall Completion</span>
              <strong className="gr-overview-value">
                {overview.overallPercent.toFixed(1)}
                <em>%</em>
              </strong>
              <div className="gr-meter" aria-hidden="true">
                <div className="gr-meter-fill" style={{ width: `${Math.min(100, overview.overallPercent)}%` }} />
              </div>
            </article>

            <article className="gr-overview-card">
              <span className="gr-overview-label">Completed Categories</span>
              <strong className="gr-overview-value">
                {overview.completedCount}
                <em>/{overview.totalCount}</em>
              </strong>
              <div className="gr-category-dots" aria-hidden="true">
                {Array.from({ length: overview.totalCount }).map((_, i) => (
                  <span
                    key={i}
                    className={['gr-dot', i < overview.completedCount ? 'gr-dot--done' : ''].join(' ').trim()}
                  />
                ))}
              </div>
            </article>
          </div>

          <CreditSummaryCard
            totalCompleted={creditTotals.completed}
            totalRequired={creditTotals.required}
            categories={categories}
          />

          <div className="gr-grid">
            {categories.map(item => {
              const progressPercent = Number(item.progress_percent || 0)
              const isDone = progressPercent >= 100
              const isExpanded = expandedCategory === item.category
              const detailsId = `gr-card-details-${categoryDomId(item.category)}`
              const countedCourses = item.completed_course_details || []
              return (
                <article
                  key={item.category}
                  className={['gr-card', isDone ? 'gr-card--done' : '', isExpanded ? 'gr-card--expanded' : ''].join(' ').trim()}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isExpanded}
                  aria-controls={detailsId}
                  onClick={() => toggleCategory(item.category)}
                  onKeyDown={event => handleCategoryKeyDown(event, item.category)}
                >
                  <div className="gr-card-head">
                    <h3 className="gr-card-title">{item.category}</h3>
                    <div className="gr-card-head-actions">
                      <span className={['gr-pct-badge', isDone ? 'gr-pct-badge--done' : ''].join(' ').trim()}>
                      {item.progress_percent !== null ? `${progressPercent.toFixed(1)}%` : '—'}
                      </span>
                      <span className="gr-card-toggle" aria-hidden="true">
                        {isExpanded ? 'Hide' : 'Courses'}
                      </span>
                    </div>
                  </div>

                  <div className="gr-meter" aria-hidden="true">
                    <div
                      className={['gr-meter-fill', isDone ? 'gr-meter-fill--done' : ''].join(' ').trim()}
                      style={{ width: `${Math.min(100, progressPercent)}%` }}
                    />
                  </div>

                  <div className="gr-meta">
                    <div className="gr-meta-row">
                      <div className="gr-meta-labels">
                        <span className="gr-meta-label">SU Credits</span>
                        <strong className="gr-meta-value">
                          {formatValue(item.completed_su)}
                          <em> / {formatValue(item.required_su)}</em>
                        </strong>
                      </div>
                      <div className="gr-mini-meter" aria-hidden="true">
                        <div className="gr-mini-fill gr-mini-fill--su" style={{ width: `${getSafePercent(item.completed_su, item.required_su)}%` }} />
                      </div>
                    </div>

                    <div className="gr-meta-row">
                      <div className="gr-meta-labels">
                        <span className="gr-meta-label">ECTS Credits</span>
                        <strong className="gr-meta-value">
                          {formatValue(item.completed_ects)}
                          <em> / {formatValue(item.required_ects)}</em>
                        </strong>
                      </div>
                      <div className="gr-mini-meter" aria-hidden="true">
                        <div className="gr-mini-fill gr-mini-fill--ects" style={{ width: `${getSafePercent(item.completed_ects, item.required_ects)}%` }} />
                      </div>
                    </div>

                    <div className="gr-meta-footer">
                      <span className="gr-meta-label">Courses</span>
                      <strong className="gr-meta-value">
                        {item.completed_courses ?? '—'} / {item.required_courses ?? '—'}
                      </strong>
                      <span className="gr-remaining">
                        {item.remaining_courses ?? '—'} left
                      </span>
                    </div>
                  </div>

                  {isExpanded && (
                    <div id={detailsId} className="gr-counted-panel">
                      {countedCourses.length > 0 ? (
                        <ul className="gr-counted-course-list">
                          {countedCourses.map(course => (
                            <li
                              className="gr-counted-course"
                              key={`${item.category}-${course.course_code}-${course.semester_name || ''}`}
                            >
                              <div className="gr-counted-course-main">
                                <strong className="gr-counted-course-code">{course.course_code}</strong>
                                <span className="gr-counted-course-name">{course.course_name || 'Course'}</span>
                              </div>
                              <span className="gr-counted-course-credit">{countedCreditLabel(course, item)}</span>
                              <span className="gr-counted-course-grade">{course.grade || '-'}</span>
                              <span className="gr-counted-course-term">{course.semester_name || '-'}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="gr-counted-empty">No counted courses.</p>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

export default Requirements
