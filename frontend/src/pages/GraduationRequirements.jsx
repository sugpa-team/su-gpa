import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../lib/api'
import CreditSummaryCard from '../components/CreditSummaryCard'

function formatValue(value, suffix = '') {
  if (value === null || value === undefined) {
    return '-'
  }
  return `${Number(value).toFixed(2)}${suffix}`
}

function getSafePercent(completed, required) {
  const safeCompleted = Number(completed || 0)
  const safeRequired = Number(required || 0)

  if (!safeRequired) {
    return 0
  }

  return Math.min(100, (safeCompleted / safeRequired) * 100)
}

function GraduationRequirements({ dataVersion = 0 }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [categories, setCategories] = useState([])
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
  }, [dataVersion])

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
          <section
            className="requirements-overview"
            style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}
            aria-label="Overall graduation progress"
          >
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
          </section>

          <CreditSummaryCard
            totalCompleted={creditTotals.completed}
            totalRequired={creditTotals.required}
            categories={categories}
          />

          <div className="requirements-grid" style={{ marginTop: '16px' }}>
            {categories.map(item => {
              const progressPercent = Number(item.progress_percent || 0)

              return (
                <article key={item.category} className="requirement-card">
                  <div className="requirement-card-header">
                    <h3>{item.category}</h3>
                    <strong>{item.progress_percent !== null ? `${progressPercent.toFixed(1)}%` : '-'}</strong>
                  </div>

                  <div className="credit-meter" aria-hidden="true">
                    <span style={{ width: `${Math.min(100, progressPercent)}%` }} />
                  </div>

                  <div className="requirement-meta">
                    <div className="requirement-meta-row">
                      <div className="requirement-meta-main">
                        <span className="meta-label">SU Credits</span>
                        <strong className="meta-value">
                          {formatValue(item.completed_su)} / {formatValue(item.required_su)}
                        </strong>
                      </div>

                      <div className="mini-meter" aria-hidden="true">
                        <span
                          style={{
                            width: `${getSafePercent(item.completed_su, item.required_su)}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div className="requirement-meta-row">
                      <div className="requirement-meta-main">
                        <span className="meta-label">ECTS Credits</span>
                        <strong className="meta-value">
                          {formatValue(item.completed_ects)} / {formatValue(item.required_ects)}
                        </strong>
                      </div>

                      <div className="mini-meter blue" aria-hidden="true">
                        <span
                          style={{
                            width: `${getSafePercent(item.completed_ects, item.required_ects)}%`,
                          }}
                        />
                      </div>
                    </div>

                    <div className="requirement-meta-row requirement-meta-footer">
                      <span className="meta-label">Courses</span>

                      <strong className="meta-value">
                        {item.completed_courses ?? '-'} / {item.required_courses ?? '-'}
                      </strong>

                      <span className="meta-remaining">
                        {item.remaining_courses ?? '-'} left
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
