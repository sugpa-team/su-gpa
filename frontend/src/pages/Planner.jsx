import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../lib/api'
import './Planner.css'

const DAY_LABELS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
const TIME_LABELS = [
  '8:40', '9:40', '10:40', '11:40', '12:40',
  '13:40', '14:40', '15:40', '16:40', '17:40', '18:40',
]
const SLOT_COUNT = TIME_LABELS.length
const SECTION_COLORS = [
  '#fde68a', '#bfdbfe', '#bbf7d0', '#fbcfe8', '#ddd6fe',
  '#fed7aa', '#a7f3d0', '#fecaca', '#c7d2fe', '#fef3c7',
]
const GRADE_OPTIONS = ['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F']
const GRADE_POINTS  = { A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, F: 0 }
const FEEDBACK_LABELS = {
  easy: 'Easy', medium: 'Medium', hard: 'Hard',
  low: 'Low', high: 'High',
  'exam-heavy': 'Exam-heavy', 'project-heavy': 'Project-heavy', mixed: 'Mixed',
  yes: 'Recommended', maybe: 'Maybe', no: 'Not recommended',
}

function labelForFeedback(value) { return FEEDBACK_LABELS[value] || value || '-' }

function colorFor(courseCode) {
  let hash = 0
  for (const ch of courseCode) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff
  return SECTION_COLORS[Math.abs(hash) % SECTION_COLORS.length]
}

function sectionKey(courseCode, classIndex, section) {
  return `${courseCode}|${classIndex}|${section.crn}`
}

function classComponentLabel(course, classIndex) {
  return course.classes[classIndex]?.type || `Class ${classIndex + 1}`
}

function requiredClassIndexes(course) {
  return course.classes
    .map((cls, classIndex) => ({ cls, classIndex }))
    .filter(({ cls }) => (cls.sections || []).length > 0)
    .map(({ classIndex }) => classIndex)
}

function scheduleGridLabel(item) {
  const courseCode = item.courseCode.replace(/\s+/g, '')
  const group = String(item.section.group || '').trim() || (item.classIndex === 0 ? '0' : item.classType)
  return `${courseCode} - ${group}`
}

function Planner() {
  const [terms, setTerms]                             = useState([])
  const [activeTerm, setActiveTerm]                   = useState(null)
  const [planner, setPlanner]                         = useState(null)
  const [loading, setLoading]                         = useState(true)
  const [error, setError]                             = useState(null)
  const [search, setSearch]                           = useState('')
  const [enabledCategories, setEnabledCategories]     = useState({})
  const [expandedCourses, setExpandedCourses]         = useState({})
  const [selectedSections, setSelectedSections]       = useState(new Map())
  const [copiedAt, setCopiedAt]                       = useState(null)
  const [savedPlans, setSavedPlans]                   = useState([])
  const [activePlanId, setActivePlanId]               = useState(null)
  const [planNameDraft, setPlanNameDraft]             = useState('')
  const [planMessage, setPlanMessage]                 = useState(null)
  const [busy, setBusy]                               = useState(false)
  const [feedbackSummaries, setFeedbackSummaries]     = useState({})
  const [recommendations, setRecommendations]         = useState([])
  const [recommendationsLoading, setRecommendationsLoading] = useState(false)
  const [recommendationsError, setRecommendationsError]     = useState(null)

  useEffect(() => {
    let ignore = false
    apiRequest('/api/schedule/terms')
      .then(data => {
        if (ignore) return
        const list = data.terms || []
        setTerms(list)
        setActiveTerm(list[list.length - 1] || null)
      })
      .catch(err => !ignore && setError(err.message))
    return () => { ignore = true }
  }, [])

  useEffect(() => {
    let ignore = false
    apiRequest('/api/course-feedback/summary')
      .then(data => { if (!ignore) setFeedbackSummaries(data.summaries || {}) })
      .catch(() => {})
    return () => { ignore = true }
  }, [])

  useEffect(() => {
    if (!activeTerm) return
    let ignore = false
    setLoading(true); setPlanner(null); setSelectedSections(new Map())
    setActivePlanId(null); setPlanNameDraft(''); setPlanMessage(null)
    Promise.all([
      apiRequest(`/api/schedule/${activeTerm}/planner`),
      apiRequest(`/api/plans?term=${activeTerm}`),
    ])
      .then(([plannerData, plansData]) => {
        if (ignore) return
        setPlanner(plannerData); setSavedPlans(plansData.plans || []); setError(null)
      })
      .catch(err => !ignore && setError(err.message))
      .finally(() => !ignore && setLoading(false))
    return () => { ignore = true }
  }, [activeTerm])

  useEffect(() => {
    if (!activeTerm) return
    let ignore = false
    setRecommendationsLoading(true); setRecommendationsError(null)
    apiRequest(`/api/course-feedback/recommendations?term=${encodeURIComponent(activeTerm)}&limit=4`)
      .then(data => { if (!ignore) setRecommendations(data.recommendations || []) })
      .catch(err => { if (!ignore) { setRecommendations([]); setRecommendationsError(err.message) } })
      .finally(() => { if (!ignore) setRecommendationsLoading(false) })
    return () => { ignore = true }
  }, [activeTerm])

  function rebuildSelectionFromPlan(plan, plannerData) {
    if (!plan || !plannerData) return new Map()
    const next = new Map()
    plan.sections.forEach(entry => {
      const course = plannerData.courses.find(c => c.code === entry.course_code)
      if (!course) return
      const classIndex = entry.class_index || 0
      const section = course.classes[classIndex]?.sections.find(s => String(s.crn) === String(entry.crn))
      if (!section) return
      for (const [selectedKey, selectedItem] of next.entries()) {
        if (selectedItem.courseCode === course.code && selectedItem.classIndex === classIndex) next.delete(selectedKey)
      }
      next.set(sectionKey(course.code, classIndex, section), {
        courseCode: course.code, courseName: course.name, classIndex,
        classType: classComponentLabel(course, classIndex),
        expectedGrade: entry.expected_grade || '', section,
        suCredits: course.su_credits, ectsCredits: course.ects_credits,
        prereqs: course.prerequisites || [],
      })
    })
    return next
  }

  function selectionToSectionList() {
    return [...selectedSections.values()].map(item => ({
      course_code: item.courseCode, crn: item.section.crn,
      class_index: item.classIndex, expected_grade: item.expectedGrade,
    }))
  }

  function handleLoadPlan(planId) {
    const plan = savedPlans.find(p => p.id === Number(planId))
    if (!plan) return
    setActivePlanId(plan.id); setPlanNameDraft(plan.name)
    setSelectedSections(rebuildSelectionFromPlan(plan, planner))
    setPlanMessage(`Loaded "${plan.name}".`)
  }

  async function handleSavePlan() {
    if (!planNameDraft.trim())            { setPlanMessage('Give the plan a name first.'); return }
    if (selectedSections.size === 0)      { setPlanMessage('Select at least one section before saving.'); return }
    if (missingExpectedGrades.length > 0) { setPlanMessage('Choose an expected grade for each planned course before saving.'); return }
    if (missingClassComponents.length > 0){ setPlanMessage('Complete each selected course before saving.'); return }
    setBusy(true)
    try {
      const payload = { sections: selectionToSectionList() }
      let saved
      if (activePlanId) {
        payload.name = planNameDraft.trim()
        saved = await apiRequest(`/api/plans/${activePlanId}`, { method: 'PATCH', body: JSON.stringify(payload) })
      } else {
        payload.term = activeTerm; payload.name = planNameDraft.trim()
        saved = await apiRequest('/api/plans', { method: 'POST', body: JSON.stringify(payload) })
        setActivePlanId(saved.id)
      }
      const plans = await apiRequest(`/api/plans?term=${activeTerm}`)
      setSavedPlans(plans.plans || []); setPlanMessage(`Saved "${saved.name}".`)
    } catch (e) { setPlanMessage(`Save failed: ${e.message}`) } finally { setBusy(false) }
  }

  async function handleDeletePlan() {
    if (!activePlanId) return
    if (!window.confirm('Delete this saved plan?')) return
    setBusy(true)
    try {
      await apiRequest(`/api/plans/${activePlanId}`, { method: 'DELETE' })
      const plans = await apiRequest(`/api/plans?term=${activeTerm}`)
      setSavedPlans(plans.plans || []); setActivePlanId(null); setPlanNameDraft(''); setPlanMessage('Plan deleted.')
    } catch (e) { setPlanMessage(`Delete failed: ${e.message}`) } finally { setBusy(false) }
  }

  async function handlePromoteToSemester() {
    if (!activePlanId)                    { setPlanMessage('Save the plan first, then promote it.'); return }
    if (missingClassComponents.length > 0){ setPlanMessage('Complete each selected course before promoting it.'); return }
    if (missingExpectedGrades.length > 0) { setPlanMessage('Choose an expected grade for each planned course before promoting it.'); return }
    if (!window.confirm(`This will create a semester named "${activeTerm}" in your GPA Calculator (or add to the existing one) and add ${totals.courseCount} courses (without grades). Continue?`)) return
    setBusy(true)
    try {
      const result = await apiRequest(`/api/plans/${activePlanId}/promote-to-semester`, { method: 'POST' })
      const skippedNote = result.skipped.length > 0
        ? ` Skipped ${result.skipped.length}: ${result.skipped.map(s => `${s.course_code} (${s.reason})`).join('; ')}`
        : ''
      setPlanMessage(`Promoted to GPA Calculator: ${result.imported_courses} added to semester "${result.semester_name}".${skippedNote}`)
    } catch (e) { setPlanMessage(`Promote failed: ${e.message}`) } finally { setBusy(false) }
  }

  function handleNewPlan() {
    setActivePlanId(null); setPlanNameDraft(''); setSelectedSections(new Map()); setPlanMessage(null)
  }

  function focusCourse(courseCode) {
    setSearch(courseCode)
    setExpandedCourses(current => ({ ...current, [courseCode]: true }))
  }

  const allCategories = useMemo(() => {
    if (!planner) return []
    const set = new Set()
    planner.courses.forEach(c => (c.requirement_categories || []).forEach(cat => set.add(cat)))
    return [...set].sort()
  }, [planner])

  const takenCodes = useMemo(
    () => new Set((planner?.taken_course_codes || []).map(c => c.toUpperCase())),
    [planner],
  )

  const filteredCourses = useMemo(() => {
    if (!planner) return []
    const query   = search.trim().toUpperCase()
    const enabled = Object.keys(enabledCategories).filter(k => enabledCategories[k])
    return planner.courses.filter(c => {
      if (query && !`${c.code} ${c.name || ''}`.toUpperCase().includes(query)) return false
      if (enabled.length > 0 && !enabled.some(cat => (c.requirement_categories || []).includes(cat))) return false
      return true
    })
  }, [planner, search, enabledCategories])

  const totals = useMemo(() => {
    let su = 0, ects = 0
    const seenCourses = new Set()
    selectedSections.forEach(item => {
      if (seenCourses.has(item.courseCode)) return
      seenCourses.add(item.courseCode)
      su += Number(item.suCredits || 0); ects += Number(item.ectsCredits || 0)
    })
    return { su, ects, courseCount: seenCourses.size }
  }, [selectedSections])

  const plannedCourses = useMemo(() => {
    const byCode = new Map()
    selectedSections.forEach(item => {
      if (!byCode.has(item.courseCode)) {
        byCode.set(item.courseCode, {
          courseCode: item.courseCode, courseName: item.courseName,
          suCredits: item.suCredits, ectsCredits: item.ectsCredits,
          expectedGrade: item.expectedGrade || '', components: [],
        })
      }
      const course = byCode.get(item.courseCode)
      if (!course.expectedGrade && item.expectedGrade) course.expectedGrade = item.expectedGrade
      course.components.push(item.classType)
    })
    return [...byCode.values()].sort((a, b) => a.courseCode.localeCompare(b.courseCode))
  }, [selectedSections])

  const missingExpectedGrades  = useMemo(() => plannedCourses.filter(c => !c.expectedGrade), [plannedCourses])

  const projectedSemesterGpa = useMemo(() => {
    if (plannedCourses.length === 0 || plannedCourses.some(c => !c.expectedGrade)) return null
    let totalCredits = 0, weightedPoints = 0
    plannedCourses.forEach(course => {
      const points  = GRADE_POINTS[course.expectedGrade]
      if (points == null) return
      const credits = Number(course.suCredits || 0)
      totalCredits += credits; weightedPoints += credits * points
    })
    return totalCredits > 0 ? weightedPoints / totalCredits : null
  }, [plannedCourses])

  const conflicts = useMemo(() => {
    const cells = Array.from({ length: 5 }, () => Array.from({ length: SLOT_COUNT }, () => []))
    selectedSections.forEach((item, key) => {
      ;(item.section.schedule || []).forEach(meeting => {
        const { day, start, duration = 1 } = meeting
        if (day < 0 || day > 4 || start < 0) return
        for (let i = 0; i < duration; i++) {
          const slot = start + i
          if (slot >= SLOT_COUNT) break
          cells[day][slot].push(key)
        }
      })
    })
    const conflictKeys = new Set()
    cells.forEach(day => day.forEach(slot => { if (slot.length > 1) slot.forEach(k => conflictKeys.add(k)) }))
    return { cells, conflictKeys }
  }, [selectedSections])

  const prereqWarnings = useMemo(() => {
    const warnings = []
    const selectedCodes = new Set([...selectedSections.values()].map(s => s.courseCode))
    selectedSections.forEach(item => {
      const missing = (item.prereqs || []).filter(p => !takenCodes.has(p.toUpperCase()) && !selectedCodes.has(p))
      if (missing.length > 0) warnings.push({ course: item.courseCode, missing })
    })
    const seen = new Set()
    return warnings.filter(w => { if (seen.has(w.course)) return false; seen.add(w.course); return true })
  }, [selectedSections, takenCodes])

  const missingClassComponents = useMemo(() => {
    if (!planner) return []
    const selectedByCourse = new Map()
    selectedSections.forEach(item => {
      if (!selectedByCourse.has(item.courseCode)) selectedByCourse.set(item.courseCode, new Set())
      selectedByCourse.get(item.courseCode).add(item.classIndex)
    })
    const missing = []
    selectedByCourse.forEach((selectedIndexes, courseCode) => {
      const course = planner.courses.find(c => c.code === courseCode)
      if (!course) return
      const missingLabels = requiredClassIndexes(course)
        .filter(classIndex => !selectedIndexes.has(classIndex))
        .map(classIndex => classComponentLabel(course, classIndex))
      if (missingLabels.length > 0) missing.push({ course: courseCode, missing: missingLabels })
    })
    return missing
  }, [planner, selectedSections])

  function toggleCategory(cat) { setEnabledCategories(curr => ({ ...curr, [cat]: !curr[cat] })) }
  function toggleCourseExpanded(code) { setExpandedCourses(curr => ({ ...curr, [code]: !curr[code] })) }

  function setExpectedGrade(courseCode, grade) {
    setSelectedSections(curr => {
      const next = new Map(curr)
      next.forEach((item, key) => {
        if (item.courseCode === courseCode) next.set(key, { ...item, expectedGrade: grade })
      })
      return next
    })
  }

  function removeCourseFromCalendar(courseCode) {
    setSelectedSections(curr => {
      const next = new Map(curr)
      for (const [key, item] of next.entries()) {
        if (item.courseCode === courseCode) next.delete(key)
      }
      return next
    })
  }

  function toggleSection(course, classIndex, section) {
    if (course.retake_allowed === false) return
    const key = sectionKey(course.code, classIndex, section)
    setSelectedSections(curr => {
      const next = new Map(curr)
      if (next.has(key)) {
        next.delete(key)
      } else {
        for (const [selectedKey, selectedItem] of next.entries()) {
          if (selectedItem.courseCode === course.code && selectedItem.classIndex === classIndex) next.delete(selectedKey)
        }
        const existingCourseItem = [...next.values()].find(item => item.courseCode === course.code)
        next.set(key, {
          courseCode: course.code, courseName: course.name, classIndex,
          classType: classComponentLabel(course, classIndex),
          expectedGrade: existingCourseItem?.expectedGrade || '',
          section, suCredits: course.su_credits, ectsCredits: course.ects_credits,
          prereqs: course.prerequisites || [],
        })
      }
      return next
    })
  }

  async function copyCrns() {
    const crns = [...selectedSections.values()].map(s => s.section.crn).join(',')
    if (!crns) return
    try {
      await navigator.clipboard.writeText(crns)
      setCopiedAt(Date.now())
      setTimeout(() => setCopiedAt(curr => (Date.now() - curr > 2500 ? null : curr)), 2700)
    } catch {
      window.prompt('Copy these CRNs:', crns)
    }
  }
  if (error)               return <p className="pl-feedback pl-feedback--error" role="alert">{error}</p>
  if (loading || !planner) return <p className="pl-status">Loading planner…</p>

  const hasConflicts = conflicts.conflictKeys.size > 0
  return (
    <section className="pl-root" aria-labelledby="pl-title">

      
      <header className="pl-header">
        <div>
          <p className="pl-eyebrow">Next Semester</p>
          <h2 id="pl-title" className="pl-title">Schedule Planner</h2>
        </div>
        <div className="pl-term-picker">
          <label className="pl-field-label" htmlFor="planner-term">Term</label>
          <select id="planner-term" className="pl-select" value={activeTerm || ''} onChange={e => setActiveTerm(e.target.value)}>
            {terms.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </header>

      
      <div className="pl-totals">
        {[
          { label: 'Courses',    value: totals.courseCount },
          { label: 'SU Credits', value: totals.su.toFixed(1) },
          { label: 'ECTS',       value: totals.ects.toFixed(1) },
          { label: 'Proj. GPA',  value: projectedSemesterGpa == null ? '—' : projectedSemesterGpa.toFixed(2) },
        ].map(({ label, value }) => (
          <div key={label} className="pl-stat">
            <span className="pl-stat-label">{label}</span>
            <strong className="pl-stat-value">{value}</strong>
          </div>
        ))}
        <div className={['pl-stat', hasConflicts ? 'pl-stat--bad' : 'pl-stat--ok'].join(' ')}>
          <span className="pl-stat-label">Conflicts</span>
          <strong className="pl-stat-value">{hasConflicts ? conflicts.conflictKeys.size : '✓'}</strong>
        </div>
        <button className="pl-btn pl-btn--ghost" type="button" onClick={copyCrns} disabled={selectedSections.size === 0}>
          {copiedAt ? '✓ Copied!' : 'Copy CRNs'}
        </button>
      </div>

      
      <div className="pl-plans-bar">
        <div className="pl-plans-fields">
          <div className="pl-field-group">
            <label className="pl-field-label" htmlFor="planner-plan-name">Plan name</label>
            <input
              id="planner-plan-name" className="pl-input" type="text"
              placeholder={activePlanId ? '' : 'e.g. Fall 2026 – balanced'}
              value={planNameDraft} onChange={e => setPlanNameDraft(e.target.value)}
            />
          </div>
          {savedPlans.length > 0 && (
            <div className="pl-field-group">
              <label className="pl-field-label" htmlFor="planner-plan-load">Load saved</label>
              <select id="planner-plan-load" className="pl-select" value={activePlanId || ''} onChange={e => handleLoadPlan(e.target.value)}>
                <option value="">— pick a plan —</option>
                {savedPlans.map(p => <option key={p.id} value={p.id}>{p.name} ({p.sections.length} sections)</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="pl-plans-actions">
          <button className="pl-btn pl-btn--primary" type="button" onClick={handleSavePlan} disabled={busy}>
            {activePlanId ? 'Update' : 'Save'}
          </button>
          {activePlanId && (
            <button className="pl-btn pl-btn--danger" type="button" onClick={handleDeletePlan} disabled={busy}>Delete</button>
          )}
          <button className="pl-btn pl-btn--ghost" type="button" onClick={handleNewPlan}
            disabled={busy || (!activePlanId && selectedSections.size === 0)}>
            New
          </button>
          <button
            className="pl-btn pl-btn--promote" type="button" onClick={handlePromoteToSemester}
            disabled={busy || !activePlanId || missingClassComponents.length > 0 || missingExpectedGrades.length > 0}
            title={!activePlanId ? 'Save the plan first' : missingExpectedGrades.length > 0 ? 'Choose expected grades first' : missingClassComponents.length > 0 ? 'Complete lecture/recitation selections first' : `Add ${totals.courseCount} courses to "${activeTerm}" semester`}
          >
            → GPA Calc
          </button>
        </div>
      </div>
      {planMessage && <p className="pl-feedback pl-feedback--info" role="status">{planMessage}</p>}

      
      {(prereqWarnings.length > 0 || missingClassComponents.length > 0) && (
        <div className="pl-warnings" role="alert">
          {prereqWarnings.map(w => (
            <p key={w.course} className="pl-warning-row">
              <strong>{w.course}</strong> requires {w.missing.join(', ')} which you have not taken.
            </p>
          ))}
          {missingClassComponents.map(w => (
            <p key={w.course} className="pl-warning-row">
              <strong>{w.course}</strong> also needs {w.missing.join(', ')}.
            </p>
          ))}
        </div>
      )}

      
      {plannedCourses.length > 0 && (
        <section className="pl-planned" aria-label="Planned courses">
          <div className="pl-panel-head">
            <strong className="pl-panel-title">Planned Courses</strong>
            <span className="pl-panel-meta">
              {projectedSemesterGpa == null ? 'Add expected grades to see projected GPA' : `Projected GPA: ${projectedSemesterGpa.toFixed(2)}`}
            </span>
          </div>
          <div className="pl-planned-list">
            {plannedCourses.map(course => (
              <article className="pl-planned-card" key={course.courseCode}>
                <div className="pl-planned-stripe" style={{ background: colorFor(course.courseCode) }} />
                <div className="pl-planned-info">
                  <strong className="pl-planned-code">{course.courseCode}</strong>
                  <span className="pl-planned-name">{course.courseName || 'Course'}</span>
                  <span className="pl-planned-meta">
                    {Number(course.suCredits || 0).toFixed(1)} SU
                    {course.components.length > 0 ? ` · ${course.components.join(' + ')}` : ''}
                  </span>
                </div>
                <div className="pl-grade-wrap">
                  <label className="pl-field-label" htmlFor={`grade-${course.courseCode}`}>Grade</label>
                  <select
                    id={`grade-${course.courseCode}`}
                    className="pl-select pl-grade-select"
                    value={course.expectedGrade}
                    onChange={e => setExpectedGrade(course.courseCode, e.target.value)}
                    aria-label={`Expected grade for ${course.courseCode}`}
                  >
                    <option value="">—</option>
                    {GRADE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      
      <section className="pl-recs" aria-label="Course recommendations">
        <div className="pl-panel-head">
          <strong className="pl-panel-title">Recommended for You</strong>
          <span className="pl-panel-meta">
            {recommendationsLoading ? 'Loading…' : `${recommendations.length} suggestions`}
          </span>
        </div>
        {recommendationsError && <p className="pl-feedback pl-feedback--error">{recommendationsError}</p>}
        {!recommendationsLoading && !recommendationsError && recommendations.length === 0 && (
          <p className="pl-status">No eligible recommendations for this term yet.</p>
        )}
        {recommendations.length > 0 && (
          <div className="pl-recs-list">
            {recommendations.map(item => (
              <article className="pl-rec-card" key={item.course_code}>
                <div className="pl-rec-main">
                  <strong className="pl-rec-code">{item.course_code}</strong>
                  <span className="pl-rec-name">{item.course_name || 'Course'}</span>
                  {item.feedback && (
                    <span className="pl-rec-feedback">
                      {labelForFeedback(item.feedback.recommendation)} · {labelForFeedback(item.feedback.workload)} workload
                    </span>
                  )}
                </div>
                {(item.reasons || []).length > 0 && (
                  <ul className="pl-rec-reasons">
                    {item.reasons.slice(0, 3).map(r => <li key={r}>{r}</li>)}
                  </ul>
                )}
                <button className="pl-btn pl-btn--ghost pl-btn--sm" type="button" onClick={() => focusCourse(item.course_code)}>
                  View
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      
      <div className="pl-layout">

        
        <aside className="pl-sidebar" aria-label="Course picker">
          <input
            className="pl-input pl-search"
            type="search"
            placeholder="Search code or name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          {allCategories.length > 0 && (
            <div className="pl-category-filters">
              {allCategories.map(cat => (
                <label key={cat} className="pl-cat-chip">
                  <input type="checkbox" checked={!!enabledCategories[cat]} onChange={() => toggleCategory(cat)} />
                  <span>{cat}</span>
                </label>
              ))}
            </div>
          )}

          <p className="pl-course-count">{filteredCourses.length} of {planner.courses.length} courses</p>

          <ol className="pl-course-list">
            {filteredCourses.length === 0 && (
              <li className="pl-course-empty">
                No courses match the current search or filters.
              </li>
            )}
            {filteredCourses.map(course => {
              const expanded      = !!expandedCourses[course.code]
              const sectionsTotal = course.classes.reduce((sum, cls) => sum + cls.sections.length, 0)
              const retakeBlocked = course.retake_allowed === false
              const feedback      = feedbackSummaries[course.code]

              return (
                <li key={course.code} className={['pl-course-item', retakeBlocked ? 'pl-course-item--blocked' : ''].join(' ').trim()}>
                  <button type="button" className="pl-course-toggle" onClick={() => toggleCourseExpanded(course.code)}>
                    <div className="pl-course-top">
                      <span className="pl-course-code">{course.code}</span>
                      <span className="pl-course-chevron">{expanded ? '▲' : '▼'}</span>
                    </div>
                    <span className="pl-course-name">{course.name || ''}</span>
                    <div className="pl-course-tags">
                      {retakeBlocked && <span className="pl-tag pl-tag--blocked">{course.retake_reason || 'Retake expired'}</span>}
                      {course.su_credits != null && <span className="pl-tag">{course.su_credits} SU</span>}
                      <span className="pl-tag">{sectionsTotal}§</span>
                      {(course.requirement_categories || []).map(cat => (
                        <span key={cat} className="pl-tag pl-tag--cat">{cat}</span>
                      ))}
                      {feedback && <span className="pl-tag pl-tag--feedback">{labelForFeedback(feedback.recommendation)}</span>}
                    </div>
                  </button>

                  {expanded && (
                    <ul className="pl-section-list">
                      {course.classes.map((cls, classIndex) =>
                        cls.sections.map(section => {
                          const key      = sectionKey(course.code, classIndex, section)
                          const selected = selectedSections.has(key)
                          return (
                            <li key={key}>
                              <button
                                type="button"
                                className={['pl-section-btn', selected ? 'pl-section-btn--on' : ''].join(' ').trim()}
                                disabled={retakeBlocked}
                                onClick={() => toggleSection(course, classIndex, section)}
                              >
                                <div className="pl-section-head">
                                  {cls.type && <span className="pl-section-type">{cls.type}</span>}
                                  <span className="pl-section-crn">CRN {section.crn}</span>
                                  <span className="pl-section-group">§{section.group}</span>
                                  <span className="pl-section-instructor">{section.instructor || 'TBA'}</span>
                                </div>
                                <div className="pl-section-times">
                                  {section.schedule.map((m, i) => (
                                    <span key={i} className="pl-meeting">
                                      {DAY_LABELS[m.day]} {TIME_LABELS[m.start]} ({m.duration}h) @ {m.place || 'TBA'}
                                    </span>
                                  ))}
                                </div>
                              </button>
                            </li>
                          )
                        })
                      )}
                    </ul>
                  )}
                </li>
              )
            })}
          </ol>
        </aside>

        
        <div className="pl-grid-wrap" aria-label="Schedule grid">
          <table className="pl-grid">
            <thead>
              <tr>
                <th className="pl-grid-time-col" />
                {DAY_LABELS.map(d => <th key={d} className="pl-grid-day">{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {TIME_LABELS.map((label, slot) => (
                <tr key={label}>
                  <th className="pl-grid-time">{label}</th>
                  {DAY_LABELS.map((_, day) => {
                    const occupants = conflicts.cells[day][slot]
                    if (occupants.length === 0) return <td key={day} className="pl-cell" />
                    const conflict = occupants.length > 1
                    return (
                      <td
                        key={day}
                        className={['pl-cell pl-cell--on', conflict ? 'pl-cell--conflict' : ''].join(' ').trim()}
                        style={{ background: conflict ? 'rgba(239 68 68 / 0.22)' : colorFor(selectedSections.get(occupants[0])?.courseCode || '') }}
                      >
                        {occupants.map(k => {
                          const item = selectedSections.get(k)
                          return item ? (
                            <div className="pl-event" key={k}>
                              <span className="pl-event-label">{scheduleGridLabel(item)}</span>
                              <button
                                type="button" className="pl-event-remove"
                                onClick={() => removeCourseFromCalendar(item.courseCode)}
                                aria-label={`Remove ${item.courseCode}`}
                              >×</button>
                            </div>
                          ) : null
                        })}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

export default Planner
