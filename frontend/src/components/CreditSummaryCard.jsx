function statusIcon(pct) {
  if (pct === null || pct === undefined) return null
  if (pct >= 100) return { symbol: '✅', label: 'Satisfied' }
  if (pct >= 50) return { symbol: '🔶', label: 'In progress' }
  return { symbol: '🔴', label: 'Behind' }
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
          <span style={{ width: `${totalPct}%` }} />
        </div>
      )}

      {rows.length > 0 && (
        <ul className="credit-summary-rows">
          {rows.map((cat, i) => {
            const isLast = i === rows.length - 1
            const pct = cat.progress_percent
            const icon = statusIcon(pct)
            return (
              <li key={cat.category} className="credit-summary-row">
                <span className="credit-summary-connector" aria-hidden="true">
                  {isLast ? '└' : '├'}
                </span>
                <span className="credit-summary-cat">{cat.category}</span>
                <span className="credit-summary-fraction">
                  {cat.completed_su ?? 0} / {cat.required_su ?? '—'}
                  {pct !== null && (
                    <span className="credit-summary-pct"> ({pct.toFixed(0)}%)</span>
                  )}
                </span>
                {icon && (
                  <span aria-label={icon.label} role="img">
                    {icon.symbol}
                  </span>
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
