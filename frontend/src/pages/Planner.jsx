import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../lib/api'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']
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
const GRADE_POINTS = {
  A: 4,
  'A-': 3.7,
  'B+': 3.3,
  B: 3,
  'B-': 2.7,
  'C+': 2.3,
  C: 2,
  'C-': 1.7,
  'D+': 1.3,
  D: 1,
  F: 0,
}
const FEEDBACK_LABELS = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  low: 'Low',
  high: 'High',
  'exam-heavy': 'Exam-heavy',
  'project-heavy': 'Project-heavy',
  mixed: 'Mixed',
  yes: 'Recommended',
  maybe: 'Maybe',
  no: 'Not recommended',
}

function labelForFeedback(value) {
  return FEEDBACK_LABELS[value] || value || '-'
}

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
  const [terms, setTerms] = useState([])
  const [activeTerm, setActiveTerm] = useState(null)
  const [planner, setPlanner] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [enabledCategories, setEnabledCategories] = useState({})
  const [expandedCourses, setExpandedCourses] = useState({})
  // Map<sectionKey, { courseCode, courseName, classIndex, section, suCredits, ectsCredits, prereqs }>
  const [selectedSections, setSelectedSections] = useState(new Map())
  const [copiedAt, setCopiedAt] = useState(null)
  // Plan persistence
  const [savedPlans, setSavedPlans] = useState([])
  const [activePlanId, setActivePlanId] = useState(null)
  const [planNameDraft, setPlanNameDraft] = useState('')
  const [planMessage, setPlanMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [feedbackSummaries, setFeedbackSummaries] = useState({})
  const [recommendations, setRecommendations] = useState([])
  const [recommendationsLoading, setRecommendationsLoading] = useState(false)
  const [recommendationsError, setRecommendationsError] = useState(null)

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
      .then(data => {
        if (!ignore) {
          setFeedbackSummaries(data.summaries || {})
        }
      })
      .catch(() => {})
    return () => { ignore = true }
  }, [])

  useEffect(() => {
    if (!activeTerm) return
    let ignore = false
    setLoading(true)
    setPlanner(null)
    setSelectedSections(new Map())
    setActivePlanId(null)
    setPlanNameDraft('')
    setPlanMessage(null)
    Promise.all([
      apiRequest(`/api/schedule/${activeTerm}/planner`),
      apiRequest(`/api/plans?term=${activeTerm}`),
    ])
      .then(([plannerData, plansData]) => {
        if (ignore) return
        setPlanner(plannerData)
        setSavedPlans(plansData.plans || [])
        setError(null)
      })
      .catch(err => !ignore && setError(err.message))
      .finally(() => !ignore && setLoading(false))
    return () => { ignore = true }
  }, [activeTerm])

  useEffect(() => {
    if (!activeTerm) return
    let ignore = false
    setRecommendationsLoading(true)
    setRecommendationsError(null)
    apiRequest(`/api/course-feedback/recommendations?term=${encodeURIComponent(activeTerm)}&limit=6`)
      .then(data => {
        if (!ignore) {
          setRecommendations(data.recommendations || [])
        }
      })
      .catch(err => {
        if (!ignore) {
          setRecommendations([])
          setRecommendationsError(err.message)
        }
      })
      .finally(() => {
        if (!ignore) {
          setRecommendationsLoading(false)
        }
      })
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
        if (selectedItem.courseCode === course.code && selectedItem.classIndex === classIndex) {
          next.delete(selectedKey)
        }
      }
      next.set(sectionKey(course.code, classIndex, section), {
        courseCode: course.code,
        courseName: course.name,
        classIndex,
        classType: classComponentLabel(course, classIndex),
        expectedGrade: entry.expected_grade || '',
        section,
        suCredits: course.su_credits,
        ectsCredits: course.ects_credits,
        prereqs: course.prerequisites || [],
      })
    })
    return next
  }

  function selectionToSectionList() {
    return [...selectedSections.values()].map(item => ({
      course_code: item.courseCode,
      crn: item.section.crn,
      class_index: item.classIndex,
      expected_grade: item.expectedGrade,
    }))
  }

  function handleLoadPlan(planId) {
    const plan = savedPlans.find(p => p.id === Number(planId))
    if (!plan) return
    setActivePlanId(plan.id)
    setPlanNameDraft(plan.name)
    setSelectedSections(rebuildSelectionFromPlan(plan, planner))
    setPlanMessage(`Loaded "${plan.name}".`)
  }

  async function handleSavePlan() {
    if (!planNameDraft.trim()) {
      setPlanMessage('Give the plan a name first.')
      return
    }
    if (selectedSections.size === 0) {
      setPlanMessage('Select at least one section before saving.')
      return
    }
    if (missingExpectedGrades.length > 0) {
      setPlanMessage('Choose an expected grade for each planned course before saving.')
      return
    }
    if (missingClassComponents.length > 0) {
      setPlanMessage('Complete each selected course before saving.')
      return
    }
    setBusy(true)
    try {
      const payload = { sections: selectionToSectionList() }
      let saved
      if (activePlanId) {
        payload.name = planNameDraft.trim()
        saved = await apiRequest(`/api/plans/${activePlanId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      } else {
        payload.term = activeTerm
        payload.name = planNameDraft.trim()
        saved = await apiRequest('/api/plans', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        setActivePlanId(saved.id)
      }
      // Refresh saved plans list
      const plans = await apiRequest(`/api/plans?term=${activeTerm}`)
      setSavedPlans(plans.plans || [])
      setPlanMessage(`Saved "${saved.name}".`)
    } catch (e) {
      setPlanMessage(`Save failed: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeletePlan() {
    if (!activePlanId) return
    if (!window.confirm('Delete this saved plan?')) return
    setBusy(true)
    try {
      await apiRequest(`/api/plans/${activePlanId}`, { method: 'DELETE' })
      const plans = await apiRequest(`/api/plans?term=${activeTerm}`)
      setSavedPlans(plans.plans || [])
      setActivePlanId(null)
      setPlanNameDraft('')
      setPlanMessage('Plan deleted.')
    } catch (e) {
      setPlanMessage(`Delete failed: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function handlePromoteToSemester() {
    if (!activePlanId) {
      setPlanMessage('Save the plan first, then promote it.')
      return
    }
    if (missingClassComponents.length > 0) {
      setPlanMessage('Complete each selected course before promoting it.')
      return
    }
    if (missingExpectedGrades.length > 0) {
      setPlanMessage('Choose an expected grade for each planned course before promoting it.')
      return
    }
    if (!window.confirm(
      `This will create a semester named "${activeTerm}" in your GPA Calculator (or add to the existing one) and add ${totals.courseCount} courses (without grades). Continue?`,
    )) return
    setBusy(true)
    try {
      const result = await apiRequest(`/api/plans/${activePlanId}/promote-to-semester`, {
        method: 'POST',
      })
      const skippedNote = result.skipped.length > 0
        ? ` Skipped ${result.skipped.length}: ${result.skipped.map(s => `${s.course_code} (${s.reason})`).join('; ')}`
        : ''
      setPlanMessage(
        `Promoted to GPA Calculator: ${result.imported_courses} added to semester "${result.semester_name}".${skippedNote}`,
      )
    } catch (e) {
      setPlanMessage(`Promote failed: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  function handleNewPlan() {
    setActivePlanId(null)
    setPlanNameDraft('')
    setSelectedSections(new Map())
    setPlanMessage(null)
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
    const query = search.trim().toUpperCase()
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
      su += Number(item.suCredits || 0)
      ects += Number(item.ectsCredits || 0)
    })
    return { su, ects, courseCount: seenCourses.size }
  }, [selectedSections])

  const plannedCourses = useMemo(() => {
    const byCode = new Map()
    selectedSections.forEach(item => {
      if (!byCode.has(item.courseCode)) {
        byCode.set(item.courseCode, {
          courseCode: item.courseCode,
          courseName: item.courseName,
          suCredits: item.suCredits,
          ectsCredits: item.ectsCredits,
          expectedGrade: item.expectedGrade || '',
          components: [],
        })
      }
      const course = byCode.get(item.courseCode)
      if (!course.expectedGrade && item.expectedGrade) course.expectedGrade = item.expectedGrade
      course.components.push(item.classType)
    })
    return [...byCode.values()].sort((a, b) => a.courseCode.localeCompare(b.courseCode))
  }, [selectedSections])

  const missingExpectedGrades = useMemo(
    () => plannedCourses.filter(course => !course.expectedGrade),
    [plannedCourses],
  )

  const projectedSemesterGpa = useMemo(() => {
    if (plannedCourses.length === 0 || plannedCourses.some(course => !course.expectedGrade)) {
      return null
    }
    let totalCredits = 0
    let weightedPoints = 0
    plannedCourses.forEach(course => {
      const points = GRADE_POINTS[course.expectedGrade]
      if (points == null) return
      const credits = Number(course.suCredits || 0)
      totalCredits += credits
      weightedPoints += credits * points
    })
    return totalCredits > 0 ? weightedPoints / totalCredits : null
  }, [plannedCourses])

  const conflicts = useMemo(() => {
    // Build per-cell occupancy: cellOccupants[day][slot] = [sectionKey, ...]
    const cells = Array.from({ length: 5 }, () => Array.from({ length: SLOT_COUNT }, () => []))
    selectedSections.forEach((item, key) => {
      ;(item.section.schedule || []).forEach(meeting => {
        const day = meeting.day
        const start = meeting.start
        const duration = meeting.duration || 1
        if (day < 0 || day > 4 || start < 0) return
        for (let i = 0; i < duration; i += 1) {
          const slot = start + i
          if (slot >= SLOT_COUNT) break
          cells[day][slot].push(key)
        }
      })
    })
    const conflictKeys = new Set()
    cells.forEach(day => day.forEach(slot => {
      if (slot.length > 1) slot.forEach(k => conflictKeys.add(k))
    }))
    return { cells, conflictKeys }
  }, [selectedSections])

  const prereqWarnings = useMemo(() => {
    const warnings = []
    const selectedCodes = new Set([...selectedSections.values()].map(s => s.courseCode))
    selectedSections.forEach(item => {
      const missing = (item.prereqs || []).filter(p => !takenCodes.has(p.toUpperCase()) && !selectedCodes.has(p))
      if (missing.length > 0) warnings.push({ course: item.courseCode, missing })
    })
    // Dedup by course
    const seen = new Set()
    return warnings.filter(w => {
      if (seen.has(w.course)) return false
      seen.add(w.course)
      return true
    })
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

  function toggleCategory(cat) {
    setEnabledCategories(curr => ({ ...curr, [cat]: !curr[cat] }))
  }

  function toggleCourseExpanded(code) {
    setExpandedCourses(curr => ({ ...curr, [code]: !curr[code] }))
  }

  function setExpectedGrade(courseCode, grade) {
    setSelectedSections(curr => {
      const next = new Map(curr)
      next.forEach((item, key) => {
        if (item.courseCode === courseCode) {
          next.set(key, { ...item, expectedGrade: grade })
        }
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
          if (selectedItem.courseCode === course.code && selectedItem.classIndex === classIndex) {
            next.delete(selectedKey)
          }
        }
        const existingCourseItem = [...next.values()].find(item => item.courseCode === course.code)
        next.set(key, {
          courseCode: course.code,
          courseName: course.name,
          classIndex,
          classType: classComponentLabel(course, classIndex),
          expectedGrade: existingCourseItem?.expectedGrade || '',
          section,
          suCredits: course.su_credits,
          ectsCredits: course.ects_credits,
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

  if (error) return <p className="error" role="alert">{error}</p>
  if (loading || !planner) return <p className="status">Loading planner...</p>

  return (
    <section className="planner-page" aria-labelledby="planner-page-title">
      <header className="planner-page-header">
        <div>
          <p className="eyebrow">Next Semester Planner</p>
          <h2 id="planner-page-title">Plan your schedule</h2>
        </div>
        <div className="planner-page-controls">
          <label htmlFor="planner-term">Term</label>
          <select
            id="planner-term"
            value={activeTerm || ''}
            onChange={e => setActiveTerm(e.target.value)}
          >
            {terms.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </header>

      <div className="planner-totals">
        <span><strong>{totals.courseCount}</strong> course{totals.courseCount === 1 ? '' : 's'}</span>
        <span><strong>{totals.su.toFixed(1)}</strong> SU</span>
        <span><strong>{totals.ects.toFixed(1)}</strong> ECTS</span>
        <span><strong>{projectedSemesterGpa == null ? '-' : projectedSemesterGpa.toFixed(2)}</strong> projected GPA</span>
        <span className={conflicts.conflictKeys.size > 0 ? 'planner-conflict-bad' : 'planner-conflict-ok'}>
          {conflicts.conflictKeys.size === 0 ? 'No conflicts' : `${conflicts.conflictKeys.size} conflicting selections`}
        </span>
        <button type="button" onClick={copyCrns} disabled={selectedSections.size === 0}>
          {copiedAt ? 'Copied!' : 'Copy CRNs'}
        </button>
      </div>

      <div className="planner-plans-bar">
        <label htmlFor="planner-plan-name">Plan name</label>
        <input
          id="planner-plan-name"
          type="text"
          placeholder={activePlanId ? '' : 'e.g. Fall 2026 - balanced'}
          value={planNameDraft}
          onChange={e => setPlanNameDraft(e.target.value)}
        />
        <button type="button" onClick={handleSavePlan} disabled={busy}>
          {activePlanId ? 'Update plan' : 'Save plan'}
        </button>
        {activePlanId && (
          <button type="button" onClick={handleDeletePlan} disabled={busy}>
            Delete
          </button>
        )}
        <button type="button" onClick={handleNewPlan} disabled={busy || (!activePlanId && selectedSections.size === 0)}>
          New empty plan
        </button>
        {savedPlans.length > 0 && (
          <>
            <label htmlFor="planner-plan-load">Load saved</label>
            <select
              id="planner-plan-load"
              value={activePlanId || ''}
              onChange={e => handleLoadPlan(e.target.value)}
            >
              <option value="">— pick a plan —</option>
              {savedPlans.map(p => (
                <option key={p.id} value={p.id}>{p.name} ({p.sections.length} sections)</option>
              ))}
            </select>
          </>
        )}
        <button
          type="button"
          onClick={handlePromoteToSemester}
          disabled={busy || !activePlanId || missingClassComponents.length > 0 || missingExpectedGrades.length > 0}
          title={!activePlanId
            ? 'Save the plan first'
            : missingExpectedGrades.length > 0
              ? 'Choose expected grades first'
              : missingClassComponents.length > 0
                ? 'Complete lecture/recitation selections first'
                : `Add ${totals.courseCount} courses to a "${activeTerm}" semester in the GPA Calculator`}
        >
          Promote to GPA Calculator
        </button>
      </div>
      {planMessage && <p className="status" role="status">{planMessage}</p>}

      <section className="planner-recommendations" aria-label="Course recommendations">
        <div className="planned-course-panel-header">
          <strong>Recommended courses</strong>
          <span>{recommendationsLoading ? 'Loading...' : `${recommendations.length} suggestions`}</span>
        </div>
        {recommendationsError && <p className="status">{recommendationsError}</p>}
        {!recommendationsLoading && !recommendationsError && recommendations.length === 0 && (
          <p className="status">No eligible recommendations for this term yet.</p>
        )}
        {recommendations.length > 0 && (
          <div className="planner-recommendation-list">
            {recommendations.map(item => (
              <article className="planner-recommendation-card" key={item.course_code}>
                <div>
                  <strong>{item.course_code}</strong>
                  <span>{item.course_name || 'Course'}</span>
                  {item.feedback && (
                    <small>
                      {labelForFeedback(item.feedback.recommendation)} | {labelForFeedback(item.feedback.workload)} workload
                    </small>
                  )}
                </div>
                <ul>
                  {(item.reasons || []).slice(0, 3).map(reason => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <button type="button" className="ghost-button" onClick={() => focusCourse(item.course_code)}>
                  View
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      {prereqWarnings.length > 0 && (
        <ul className="planner-warnings" role="alert">
          {prereqWarnings.map(w => (
            <li key={w.course}>
              <strong>{w.course}</strong> requires {w.missing.join(', ')} which you have not taken.
            </li>
          ))}
        </ul>
      )}

      {missingClassComponents.length > 0 && (
        <ul className="planner-warnings" role="alert">
          {missingClassComponents.map(w => (
            <li key={w.course}>
              <strong>{w.course}</strong> also needs {w.missing.join(', ')}.
            </li>
          ))}
        </ul>
      )}

      {plannedCourses.length > 0 && (
        <section className="planned-course-panel" aria-label="Planned courses">
          <div className="planned-course-panel-header">
            <strong>Planned courses</strong>
            <span>{projectedSemesterGpa == null ? 'Expected grades required' : `Projected GPA ${projectedSemesterGpa.toFixed(2)}`}</span>
          </div>
          <div className="planned-course-list">
            {plannedCourses.map(course => (
              <article className="planned-course-card" key={course.courseCode}>
                <div>
                  <strong>{course.courseCode}</strong>
                  <span>{course.courseName || 'Course'}</span>
                  <small>
                    {Number(course.suCredits || 0).toFixed(1)} SU
                    {course.components.length > 0 ? ` · ${course.components.join(' + ')}` : ''}
                  </small>
                </div>
                <label>
                  Expected grade
                  <select
                    value={course.expectedGrade}
                    onChange={event => setExpectedGrade(course.courseCode, event.target.value)}
                    aria-label={`Expected grade for ${course.courseCode}`}
                  >
                    <option value="">Select</option>
                    {GRADE_OPTIONS.map(grade => (
                      <option key={grade} value={grade}>{grade}</option>
                    ))}
                  </select>
                </label>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="planner-layout">
        <aside className="planner-sidebar" aria-label="Course picker">
          <input
            type="search"
            placeholder="Search by code or name (e.g. CS 201)"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {allCategories.length > 0 && (
            <div className="planner-filters">
              {allCategories.map(cat => (
                <label key={cat}>
                  <input
                    type="checkbox"
                    checked={!!enabledCategories[cat]}
                    onChange={() => toggleCategory(cat)}
                  />
                  {cat}
                </label>
              ))}
            </div>
          )}
          <p className="status">{filteredCourses.length} of {planner.courses.length} courses</p>
          <ol className="planner-course-list">
            {filteredCourses.slice(0, 200).map(course => {
              const expanded = !!expandedCourses[course.code]
              const sectionsTotal = course.classes.reduce((sum, cls) => sum + cls.sections.length, 0)
              const retakeBlocked = course.retake_allowed === false
              const feedback = feedbackSummaries[course.code]
              return (
                <li key={course.code} className={`planner-course-row ${retakeBlocked ? 'retake-blocked' : ''}`}>
                  <button
                    type="button"
                    className="planner-course-toggle"
                    onClick={() => toggleCourseExpanded(course.code)}
                  >
                    <strong>{course.code}</strong> {course.name || ''}
                    <span className="planner-course-meta">
                      {retakeBlocked ? `${course.retake_reason || 'Retake window expired'} | ` : ''}
                      {course.su_credits != null ? `${course.su_credits} SU | ` : ''}
                      {sectionsTotal} section{sectionsTotal === 1 ? '' : 's'}
                      {course.requirement_categories.length > 0 ? ` | ${course.requirement_categories.join(', ')}` : ''}
                      {feedback ? ` | ${labelForFeedback(feedback.recommendation)} | ${labelForFeedback(feedback.workload)} workload` : ''}
                    </span>
                  </button>
                  {expanded && (
                    <ul className="planner-section-list">
                      {course.classes.map((cls, classIndex) => cls.sections.map(section => {
                        const key = sectionKey(course.code, classIndex, section)
                        const selected = selectedSections.has(key)
                        return (
                          <li key={key}>
                            <button
                              type="button"
                              className={`planner-section-button ${selected ? 'selected' : ''}`}
                              disabled={retakeBlocked}
                              onClick={() => toggleSection(course, classIndex, section)}
                            >
                              <span>
                                {cls.type ? `[${cls.type}] ` : ''}
                                CRN {section.crn} · §{section.group} · {section.instructor || 'TBA'}
                              </span>
                              <span className="planner-section-times">
                                {section.schedule.map((m, i) => (
                                  <span key={i}>
                                    {DAY_LABELS[m.day]} {TIME_LABELS[m.start]} ({m.duration}h) @ {m.place || 'TBA'}
                                  </span>
                                ))}
                              </span>
                            </button>
                          </li>
                        )
                      }))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ol>
        </aside>

        <div className="planner-grid-wrap" aria-label="Schedule grid">
          <table className="planner-grid">
            <thead>
              <tr>
                <th></th>
                {DAY_LABELS.map(d => <th key={d}>{d}</th>)}
              </tr>
            </thead>
            <tbody>
              {TIME_LABELS.map((label, slot) => (
                <tr key={label}>
                  <th>{label}</th>
                  {DAY_LABELS.map((_, day) => {
                    const occupants = conflicts.cells[day][slot]
                    if (occupants.length === 0) return <td key={day} className="planner-grid-cell empty"></td>
                    const conflict = occupants.length > 1
                    return (
                      <td
                        key={day}
                        className={`planner-grid-cell ${conflict ? 'conflict' : 'occupied'}`}
                        style={{ background: conflict ? '#fecaca' : colorFor(selectedSections.get(occupants[0])?.courseCode || '') }}
                      >
                        {occupants.map(k => {
                          const item = selectedSections.get(k)
                          return item ? (
                            <div className="planner-grid-event" key={k}>
                              <span>{scheduleGridLabel(item)}</span>
                              <button
                                type="button"
                                className="planner-grid-remove"
                                onClick={() => removeCourseFromCalendar(item.courseCode)}
                                aria-label={`Remove ${item.courseCode} from calendar`}
                                title={`Remove ${item.courseCode}`}
                              >
                                x
                              </button>
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
