import { useEffect, useState } from 'react'

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

  useEffect(() => {
    let ignore = false

    async function loadProgress() {
      try {
        const response = await apiRequest('/api/graduation-requirements')
        if (!ignore) {
          setCategories(response.categories || [])
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
                SU: {formatValue(item.completed_su)} / {formatValue(item.required_su)}
                {' | '}
                Remaining: {formatValue(item.remaining_su)}
              </p>
              <p>
                ECTS: {formatValue(item.completed_ects)} / {formatValue(item.required_ects)}
                {' | '}
                Remaining: {formatValue(item.remaining_ects)}
              </p>
              <p>
                Courses: {item.completed_courses ?? '-'} / {item.required_courses ?? '-'}
                {' | '}
                Remaining: {item.remaining_courses ?? '-'}
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export default GraduationRequirements
