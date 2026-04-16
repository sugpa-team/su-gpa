import { useEffect, useMemo, useState } from 'react'

import { apiRequest } from '../lib/api'

function formatValue(value, suffix = '') {
  if (value === null || value === undefined) {
    return '-'
  }
  return `${Number(value).toFixed(2)}${suffix}`
}

function GraduationRequirements() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [categories, setCategories] = useState([])
  const [overallCredits, setOverallCredits] = useState({
    requiredSu: 0,
    requiredEcts: 0,
    completedSu: 0,
    completedEcts: 0,
  })

  const overview = useMemo(() => {
    const safeCategories = categories || []
    const progressValues = safeCategories
      .map(item => item.progress_percent)
      .filter(value => value !== null && value !== undefined)
    const overallPercent =
      progressValues.length > 0
        ? progressValues.reduce((sum, value) => sum + Number(value), 0) / progressValues.length
        : 0

    const remainingSu = Math.max(0, overallCredits.requiredSu - overallCredits.completedSu)
    const remainingEcts = Math.max(0, overallCredits.requiredEcts - overallCredits.completedEcts)
    const remainingCourses = safeCategories.reduce(
      (sum, item) => sum + Number(item.remaining_courses || 0),
      0,
    )

    return {
      overallPercent,
      remainingSu,
      remainingEcts,
      remainingCourses,
      completedCount: safeCategories.filter(item => Number(item.progress_percent || 0) >= 100).length,
      totalCount: safeCategories.length,
      requiredSu: overallCredits.requiredSu,
      requiredEcts: overallCredits.requiredEcts,
    }
  }, [categories, overallCredits])

  useEffect(() => {
    let ignore = false

    async function loadProgress() {
      try {
        const [requirementsResponse, gpaResponse] = await Promise.all([
          apiRequest('/api/graduation-requirements'),
          apiRequest('/api/gpa'),
        ])
        if (!ignore) {
          setCategories(requirementsResponse.categories || [])
          setOverallCredits({
            requiredSu: Number(gpaResponse.program_required_su_credits || 0),
            requiredEcts: Number(gpaResponse.program_required_ects_credits || 0),
            completedSu: Number(gpaResponse.total_planned_su_credits || 0),
            completedEcts: Number(gpaResponse.total_planned_ects_credits || 0),
          })
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

    loadProgress()
    return () => {
      ignore = true
    }
  }, [])

  return (
    <section className="requirements-container" aria-labelledby="requirements-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Graduation Progress</p>
          <h2 id="requirements-title">Graduation Requirements</h2>
        </div>
      </div>

      {loading && <p className="status">Loading requirement progress...</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && (
        <>
          <section className="requirements-overview" aria-label="Overall graduation progress">
            <article className="requirements-overview-card">
              <span>Overall Completion</span>
              <strong>{overview.overallPercent.toFixed(1)}%</strong>
              <div className="credit-meter" aria-hidden="true">
                <span style={{ width: `${Math.min(100, overview.overallPercent)}%` }} />
              </div>
            </article>
            <article className="requirements-overview-card">
              <span>Completed Categories</span>
              <strong>
                {overview.completedCount}/{overview.totalCount}
              </strong>
            </article>
            <article className="requirements-overview-card">
              <span>Remaining Totals</span>
              <strong>
                SU Credits {formatValue(overview.remainingSu)}/{formatValue(overview.requiredSu)}
              </strong>
              <small>
                ECTS Credits {formatValue(overview.remainingEcts)}/{formatValue(overview.requiredEcts)}
              </small>
            </article>
          </section>

          <div className="requirements-grid">
            {categories.map(item => (
              <article key={item.category} className="requirement-card">
                <div className="requirement-card-header">
                  <h3>{item.category}</h3>
                  <strong>{item.progress_percent !== null ? `${item.progress_percent.toFixed(1)}%` : '-'}</strong>
                </div>
                <div className="credit-meter" aria-hidden="true">
                  <span style={{ width: `${item.progress_percent ?? 0}%` }} />
                </div>
                <p>
                  SU: {formatValue(item.completed_su)} / {formatValue(item.required_su)} (Remaining:{' '}
                  {formatValue(item.remaining_su)})
                </p>
                <p>
                  ECTS: {formatValue(item.completed_ects)} / {formatValue(item.required_ects)} (Remaining:{' '}
                  {formatValue(item.remaining_ects)})
                </p>
                <p>
                  Courses: {item.completed_courses ?? '-'} / {item.required_courses ?? '-'} (Remaining:{' '}
                  {item.remaining_courses ?? '-'})
                </p>
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

export default GraduationRequirements
