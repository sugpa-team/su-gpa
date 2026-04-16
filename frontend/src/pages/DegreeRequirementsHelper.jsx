import { useMemo, useState } from 'react'
import { apiRequest } from '../lib/api'

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

function DegreeRequirementsHelper() {
  const [pastedText, setPastedText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [activeResultTab, setActiveResultTab] = useState(RESULT_TAB.OVERVIEW)
  const [requirementsCatalog, setRequirementsCatalog] = useState({})
  const [allCourses, setAllCourses] = useState([])
  const [simulatedSemesters, setSimulatedSemesters] = useState([])
  const [categoryAdds, setCategoryAdds] = useState([])
  const [draftBySemester, setDraftBySemester] = useState({})
  const [categoryDrafts, setCategoryDrafts] = useState({})

  const sectionEntries = useMemo(() => Object.entries(analysis?.sections || {}), [analysis])
  const courseByCode = useMemo(() => {
    const map = new Map()
    allCourses.forEach(course => map.set(String(course.course || '').toUpperCase(), course))
    return map
  }, [allCourses])
  const courseCategoryMap = useMemo(() => {
    const map = new Map()
    const priority = [
      'University Courses',
      'Required Courses',
      'Core Electives',
      'Area Electives',
      'Free Electives',
    ]
    priority.forEach(category => {
      ;(requirementsCatalog[category] || []).forEach(item => {
        const courseCode = String(item.course || '').toUpperCase()
        if (courseCode && !map.has(courseCode)) {
          map.set(courseCode, category)
        }
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
    const semesterAttempts = simulatedSemesters.flatMap((semester, semesterIndex) =>
      (semester.courses || []).map((course, courseIndex) => ({ ...course, source_order: 1000 + semesterIndex * 100 + courseIndex, term: String(990000 + semesterIndex) })),
    )
    const categoryAttempts = categoryAdds.map((course, idx) => ({ ...course, source_order: 900000 + idx, term: String(999000 + idx) }))
    return [...semesterAttempts, ...categoryAttempts]
  }, [simulatedSemesters, categoryAdds])

  const takenCourseCodes = useMemo(() => {
    const set = new Set()
    ;[...importedAttempts, ...simulatedAttempts].forEach(item => {
      const code = String(item.course || '').toUpperCase()
      if (code) {
        set.add(code)
      }
    })
    return set
  }, [importedAttempts, simulatedAttempts])

  const gpaStats = useMemo(() => {
    const latestByCourse = new Map()
    ;[...importedAttempts, ...simulatedAttempts].forEach(item => {
      const code = String(item.course || '').toUpperCase()
      const current = latestByCourse.get(code)
      if (!current || String(item.term) > String(current.term) || item.source_order > current.source_order) latestByCourse.set(code, item)
    })
    let weighted = 0
    let total = 0
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
    () =>
      sectionEntries.map(([sectionName, section]) => {
        const min = section.minimum_required || {}
        const completed = section.completed || {}
        const added = simulatedAttempts.filter(item => item.category === sectionName)
        const completedSu = Number(completed.su_credits || 0) + added.reduce((sum, item) => sum + Number(item.su_credits || 0), 0)
        const completedEcts = Number(completed.ects_credits || 0)
        const completedCourses = Number(completed.courses || 0) + added.length
        const minSu = min.su_credits !== null && min.su_credits !== undefined ? Number(min.su_credits) : null
        const minEcts = min.ects_credits !== null && min.ects_credits !== undefined ? Number(min.ects_credits) : null
        const minCourses = min.courses !== null && min.courses !== undefined ? Number(min.courses) : null
        const remainingSu = minSu !== null ? Math.max(0, minSu - completedSu) : null
        const remainingEcts = minEcts !== null ? Math.max(0, minEcts - completedEcts) : null
        const remainingCourses = minCourses !== null ? Math.max(0, minCourses - completedCourses) : null
        const progressCandidates = []
        if (minSu && minSu > 0) {
          progressCandidates.push(Math.min(100, (completedSu / minSu) * 100))
        }
        if (minEcts && minEcts > 0) {
          progressCandidates.push(Math.min(100, (completedEcts / minEcts) * 100))
        }
        if (minCourses && minCourses > 0) {
          progressCandidates.push(Math.min(100, (completedCourses / minCourses) * 100))
        }
        const progressPercent = progressCandidates.length > 0 ? Math.min(...progressCandidates) : null
        return { sectionName, completedSu, completedEcts, minSu, minEcts, completedCourses, minCourses, remainingSu, remainingEcts, remainingCourses, progressPercent }
      }),
    [sectionEntries, simulatedAttempts],
  )

  async function handleAnalyze() {
    if (!pastedText.trim()) return setError('Please paste the Bannerweb Degree Evaluation text first.')
    setLoading(true)
    setError(null)
    try {
      const [result, catalogResponse, coursesResponse] = await Promise.all([
        apiRequest('/api/bannerweb/analyze', { method: 'POST', body: JSON.stringify({ raw_text: pastedText }) }),
        apiRequest('/api/graduation-requirements/catalog'),
        apiRequest('/courses'),
      ])
      setAnalysis(result)
      setRequirementsCatalog(catalogResponse.categories || {})
      setAllCourses(coursesResponse || [])
      setSimulatedSemesters([])
      setCategoryAdds([])
      setDraftBySemester({})
      setCategoryDrafts({})
      setActiveResultTab(RESULT_TAB.OVERVIEW)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setLoading(false)
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
    if (!inferredCategory) {
      setError('Course category could not be inferred from requirement mapping.')
      return
    }
    const catalogCourse = courseByCode.get(normalizedCourseCode)
    setSimulatedSemesters(current =>
      current.map(semester =>
        semester.id !== semesterId
          ? semester
          : {
              ...semester,
              courses: [
                ...semester.courses,
                {
                  course: draft.course,
                  grade: draft.grade,
                  category: inferredCategory,
                  su_credits: Number(catalogCourse?.su_credits || 0),
                },
              ],
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

  return (
    <section className="requirements-container" aria-labelledby="degree-requirements-helper-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Bannerweb</p>
          <h2 id="degree-requirements-helper-title">Degree Requirements Helper</h2>
          <p className="status">This helper imports your current degree progress from Bannerweb so you can plan future semesters and run GPA simulation on top of your existing record.</p>
        </div>
      </div>
      <article className="helper-instructions" aria-label="How to copy data from Bannerweb">
        <h3>How to Use</h3>
        <p>In Bannerweb, go to <strong>Student</strong> - <strong>Degree Audit and Graduation</strong> - <strong>Degree Evaluation (Summary)</strong> - <strong>Generate New Request</strong>.</p>
        <p>Copy the entire opened page using <strong>Ctrl/Command + A</strong>, then paste it here. This site will help you plan your next semester and simulate GPA with your imported course history.</p>
        <p className="status">Paste and analyze to load your baseline transcript into this helper.</p>
      </article>
      <section className="helper-input-panel" aria-label="Paste Bannerweb degree evaluation text">
        <label htmlFor="bannerweb-paste-input">Paste Bannerweb output</label>
        <textarea id="bannerweb-paste-input" value={pastedText} onChange={event => setPastedText(event.target.value)} placeholder="Paste the full Degree Evaluation text here..." rows={14} />
        <div className="helper-input-actions"><button type="button" onClick={handleAnalyze} disabled={loading}>{loading ? 'Analyzing...' : 'Analyze'}</button></div>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
      {analysis && (
        <section className="helper-analysis" aria-label="Bannerweb parse analysis">
          <h3>Analysis Result</h3>
          <p className="status">Parsed {analysis.analysis?.total_courses_parsed ?? 0} courses across {analysis.analysis?.total_sections_parsed ?? 0} sections.</p>
          <div className="tabs-shell helper-inner-tabs" aria-label="Helper analysis tabs">
            <button type="button" className={`tab-button ${activeResultTab === RESULT_TAB.OVERVIEW ? 'active' : ''}`} onClick={() => setActiveResultTab(RESULT_TAB.OVERVIEW)} aria-pressed={activeResultTab === RESULT_TAB.OVERVIEW}>Overall Progress</button>
            <button type="button" className={`tab-button ${activeResultTab === RESULT_TAB.DETAILS ? 'active' : ''}`} onClick={() => setActiveResultTab(RESULT_TAB.DETAILS)} aria-pressed={activeResultTab === RESULT_TAB.DETAILS}>Category Courses & Grades</button>
          </div>
          {activeResultTab === RESULT_TAB.OVERVIEW && (
            <>
              <div className="requirements-overview">
                <article className="requirements-overview-card"><span>Simulated CGPA</span><strong>{gpaStats.cgpa.toFixed(2)}</strong></article>
                <article className="requirements-overview-card"><span>Unique Courses Counted</span><strong>{gpaStats.countedCourses}</strong></article>
              </div>
              <div className="requirements-grid">
                {overviewRows.map(item => (
                  <article key={item.sectionName} className="requirement-card">
                    <div className="requirement-card-header"><h3>{item.sectionName}</h3><strong>{item.progressPercent !== null ? `${item.progressPercent.toFixed(1)}%` : '-'}</strong></div>
                    <div className="credit-meter" aria-hidden="true"><span style={{ width: `${item.progressPercent || 0}%` }} /></div>
                    <p>SU Credits: {item.completedSu.toFixed(2)} / {item.minSu ?? '-'}</p>
                    <p>ECTS Credits: {item.completedEcts.toFixed(2)} / {item.minEcts ?? '-'}</p>
                    <p>Courses: {item.completedCourses} / {item.minCourses ?? '-'}</p>
                    <p>Remaining: {item.remainingSu ?? '-'} SU / {item.remainingEcts ?? '-'} ECTS / {item.remainingCourses ?? '-'} courses</p>
                  </article>
                ))}
              </div>
              <p className="status">
                Engineering, Faculty Courses, and Basic Science progress currently uses parsed Bannerweb summary values.
              </p>
              <section className="helper-input-panel">
                <div className="helper-input-actions"><button type="button" onClick={handleAddSemester}>Add Semester</button></div>
                {simulatedSemesters.map(semester => (
                  <article key={semester.id} className="requirement-card">
                    <div className="requirement-card-header"><h3>{semester.name}</h3><strong>{semester.courses.length} courses</strong></div>
                    {(semester.courses || []).map(course => <p key={`${course.course}-${course.grade}`}>{course.course} ({course.category}) - {course.grade}</p>)}
                    <div className="helper-semester-form">
                      <select value={draftBySemester[semester.id]?.course || ''} onChange={event => setDraftBySemester(current => ({ ...current, [semester.id]: { ...current[semester.id], course: event.target.value } }))}><option value="">Select course</option>{allCourses.map(course => <option key={course.course} value={course.course}>{course.course} - {course.name}</option>)}</select>
                      <select value={draftBySemester[semester.id]?.grade || ''} onChange={event => setDraftBySemester(current => ({ ...current, [semester.id]: { ...current[semester.id], grade: event.target.value } }))}><option value="">Grade</option>{Object.keys(LETTER_POINTS).map(grade => <option key={grade} value={grade}>{grade}</option>)}</select>
                      <button type="button" onClick={() => handleAddCourseToSemester(semester.id)}>Add Course</button>
                    </div>
                  </article>
                ))}
              </section>
            </>
          )}
          {activeResultTab === RESULT_TAB.DETAILS && (
            <>
              <p className="status">Simulated CGPA: {gpaStats.cgpa.toFixed(2)}</p>
              <div className="requirements-grid">
                {sectionEntries.map(([sectionName, section]) => {
                  const requirementsCategoryName =
                    SECTION_TO_REQUIREMENTS_CATEGORY[sectionName] || sectionName
                  const simulatedInCategory = simulatedAttempts.filter(item => item.category === sectionName)
                  return (
                    <article key={sectionName} className="requirement-card">
                      <div className="requirement-card-header"><h3>{sectionName}</h3><strong>{(section.courses || []).length + simulatedInCategory.length} courses</strong></div>
                      {(section.courses || []).map(course => <p key={`${sectionName}-${course.course}-${course.term}`}>{course.course} - {course.grade} ({course.term})</p>)}
                      {simulatedInCategory.map((course, idx) => <p key={`${sectionName}-sim-${course.course}-${idx}`}>{course.course} - {course.grade} (simulated)</p>)}
                      <div className="helper-semester-form">
                        <select value={categoryDrafts[sectionName]?.course || ''} onChange={event => setCategoryDrafts(current => ({ ...current, [sectionName]: { ...current[sectionName], course: event.target.value } }))}><option value="">Select {sectionName} course</option>{(requirementsCatalog[requirementsCategoryName] || []).filter(item => !takenCourseCodes.has(String(item.course || '').toUpperCase())).map(item => <option key={item.course} value={item.course}>{item.course}</option>)}</select>
                        <select value={categoryDrafts[sectionName]?.grade || ''} onChange={event => setCategoryDrafts(current => ({ ...current, [sectionName]: { ...current[sectionName], grade: event.target.value } }))}><option value="">Grade</option>{Object.keys(LETTER_POINTS).map(grade => <option key={grade} value={grade}>{grade}</option>)}</select>
                        <button type="button" onClick={() => handleAddCourseToCategory(sectionName)}>Add to Category</button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </>
          )}
        </section>
      )}
    </section>
  )
}

export default DegreeRequirementsHelper
