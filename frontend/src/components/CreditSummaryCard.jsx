function statusMod(pct) {
  if (pct === null || pct === undefined) return null
  if (pct >= 100) return { mod: 'done',     label: 'Satisfied'   }
  if (pct >= 50)  return { mod: 'progress', label: 'In progress' }
  return              { mod: 'behind',    label: 'Behind'      }
}

function CreditSummaryCard({ totalCompleted, totalRequired, categories }) {
  const totalPct =
    totalRequired > 0 ? Math.min(100, (totalCompleted / totalRequired) * 100) : null

  const rows = (categories || []).filter(cat => cat.required_su != null)

  return (
    <div className="credit-summary-card">
      <p className="eyebrow">Credit Progress</p>

      <div className="credit-summary-total-row">
        <span className="credit-summary-total-label">Total Credits</span>
        <span className="credit-summary-total-value">
          {totalCompleted ?? 0} / {totalRequired ?? '—'}
          {totalPct !== null && (
            <span className="credit-summary-pct"> ({totalPct.toFixed(0)}%)</span>
          )}
        </span>
      </div>

      {totalPct !== null && (
        <div className="credit-meter" aria-label={`${totalPct.toFixed(0)}% of total credits completed`}>
          <div className="credit-meter-fill" style={{ width: `${totalPct}%` }} />
        </div>
      )}

      {rows.length > 0 && (
        <ul className="credit-summary-rows">
          {rows.map((cat, i) => {
            const isLast = i === rows.length - 1
            const status = statusMod(cat.progress_percent)
            return (
              <li key={cat.category} className="credit-summary-row">
                <span className="credit-summary-connector" aria-hidden="true">
                  {isLast ? '└' : '├'}
                </span>
                <span className="credit-summary-cat">{cat.category}</span>
                <span className="credit-summary-fraction">
                  {cat.completed_su ?? 0} / {cat.required_su ?? '—'}
                  {cat.progress_percent != null && (
                    <span className="credit-summary-pct"> ({cat.progress_percent?.toFixed(0)}%)</span>
                  )}
                </span>
                {status && (
                  <span
                    className={`credit-summary-status credit-summary-status--${status.mod}`}
                    aria-label={status.label}
                    role="img"
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default CreditSummaryCard
