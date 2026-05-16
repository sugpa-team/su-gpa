import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../lib/api'
import CreditSummaryCard from '../components/CreditSummaryCard'
import './GraduationRequirements.css'

function formatValue(value, suffix = '') {
  if (value === null || value === undefined) return '-'
  return `${Number(value).toFixed(2)}${suffix}`
}

function getSafePercent(completed, required) {
  const safeCompleted = Number(completed || 0)
  const safeRequired  = Number(required  || 0)
  if (!safeRequired) return 0
  return Math.min(100, (safeCompleted / safeRequired) * 100)
}

function GraduationRequirements({ dataVersion = 0 }) {
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [categories, setCategories]   = useState([])
  const [creditTotals, setCreditTotals] = useState({ completed: 0, required: null })

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

  useEffect(() => {
    let ignore = false

    async function loadProgress() {
      try {
        const requirementsResponse = await apiRequest('/api/graduation-requirements')
        if (!ignore) {
          setCategories(requirementsResponse.categories || [])
          setCreditTotals({
            completed: Number(requirementsResponse.total_credits_completed || 0),
            required: requirementsResponse.total_credits_required != null
              ? Number(requirementsResponse.total_credits_required)
              : null,
          })
          setError(null)
        }
      } catch (requestError) {
        if (!ignore) setError(requestError.message)
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    loadProgress()
    return () => { ignore = true }
  }, [dataVersion])

  return (
    <section className="gr-root" aria-labelledby="requirements-title">

      
      <header className="gr-header">
        <p className="gr-eyebrow">Graduation Progress</p>
        <h2 id="requirements-title" className="gr-title">Graduation Requirements</h2>
      </header>

      
      {loading && <p className="gr-status">Loading requirement progress…</p>}
      {error   && <p className="gr-feedback gr-feedback--error" role="alert">{error}</p>}

      {!loading && !error && (
        <>
          
          <div className="gr-overview" aria-label="Overall graduation progress">

            <article className="gr-overview-card">
              <span className="gr-overview-label">Overall Completion</span>
              <strong className="gr-overview-value">
                {overview.overallPercent.toFixed(1)}
                <em>%</em>
              </strong>
              <div className="gr-meter" aria-hidden="true">
                <div
                  className="gr-meter-fill"
                  style={{ width: `${Math.min(100, overview.overallPercent)}%` }}
                />
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

              return (
                <article
                  key={item.category}
                  className={['gr-card', isDone ? 'gr-card--done' : ''].join(' ').trim()}
                >
                  
                  <div className="gr-card-head">
                    <h3 className="gr-card-title">{item.category}</h3>
                    <span className={['gr-pct-badge', isDone ? 'gr-pct-badge--done' : ''].join(' ').trim()}>
                      {item.progress_percent !== null ? `${progressPercent.toFixed(1)}%` : '—'}
                    </span>
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
                        <div
                          className="gr-mini-fill gr-mini-fill--su"
                          style={{ width: `${getSafePercent(item.completed_su, item.required_su)}%` }}
                        />
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
                        <div
                          className="gr-mini-fill gr-mini-fill--ects"
                          style={{ width: `${getSafePercent(item.completed_ects, item.required_ects)}%` }}
                        />
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
                </article>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

export default GraduationRequirements
