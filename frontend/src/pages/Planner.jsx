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

function colorFor(courseCode) {
  let hash = 0
  for (const ch of courseCode) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff
  return SECTION_COLORS[Math.abs(hash) % SECTION_COLORS.length]
}

function sectionKey(courseCode, classIndex, section) {
  return `${courseCode}|${classIndex}|${section.crn}`
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
    if (!activeTerm) return
    let ignore = false
    setLoading(true)
    setPlanner(null)
    setSelectedSections(new Map())
    apiRequest(`/api/schedule/${activeTerm}/planner`)
      .then(data => {
        if (ignore) return
        setPlanner(data)
        setError(null)
      })
      .catch(err => !ignore && setError(err.message))
      .finally(() => !ignore && setLoading(false))
    return () => { ignore = true }
  }, [activeTerm])

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

  function toggleCategory(cat) {
    setEnabledCategories(curr => ({ ...curr, [cat]: !curr[cat] }))
  }

  function toggleCourseExpanded(code) {
    setExpandedCourses(curr => ({ ...curr, [code]: !curr[code] }))
  }

  function toggleSection(course, classIndex, section) {
    const key = sectionKey(course.code, classIndex, section)
    setSelectedSections(curr => {
      const next = new Map(curr)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.set(key, {
          courseCode: course.code,
          courseName: course.name,
          classIndex,
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
        <span className={conflicts.conflictKeys.size > 0 ? 'planner-conflict-bad' : 'planner-conflict-ok'}>
          {conflicts.conflictKeys.size === 0 ? 'No conflicts' : `${conflicts.conflictKeys.size} conflicting selections`}
        </span>
        <button type="button" onClick={copyCrns} disabled={selectedSections.size === 0}>
          {copiedAt ? 'Copied!' : 'Copy CRNs'}
        </button>
      </div>

      {prereqWarnings.length > 0 && (
        <ul className="planner-warnings" role="alert">
          {prereqWarnings.map(w => (
            <li key={w.course}>
              <strong>{w.course}</strong> requires {w.missing.join(', ')} which you have not taken.
            </li>
          ))}
        </ul>
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
              return (
                <li key={course.code} className="planner-course-row">
                  <button
                    type="button"
                    className="planner-course-toggle"
                    onClick={() => toggleCourseExpanded(course.code)}
                  >
                    <strong>{course.code}</strong> {course.name || ''}
                    <span className="planner-course-meta">
                      {course.su_credits != null ? `${course.su_credits} SU · ` : ''}
                      {sectionsTotal} section{sectionsTotal === 1 ? '' : 's'}
                      {course.requirement_categories.length > 0 ? ` · ${course.requirement_categories.join(', ')}` : ''}
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
                          return item ? <div key={k}>{item.courseCode}</div> : null
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
