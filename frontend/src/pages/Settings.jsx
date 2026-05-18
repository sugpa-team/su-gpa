import { useRef, useState } from 'react'

import { exportAll, importAll, resetAll } from '../lib/storage'
import { clearCache } from '../lib/staticData'

function downloadJson(filename, payload) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function Settings() {
  const fileInput = useRef(null)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)

  function handleExport() {
    setError(null)
    const payload = exportAll()
    const date = new Date().toISOString().slice(0, 10)
    downloadJson(`sugpa-backup-${date}.json`, payload)
    setMessage('Backup downloaded.')
  }

  function handleImportClick() {
    setError(null); setMessage(null)
    fileInput.current?.click()
  }

  async function handleFileSelected(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const payload = JSON.parse(text)
      importAll(payload)
      clearCache()
      setMessage('Backup restored. Reloading…')
      setTimeout(() => window.location.reload(), 600)
    } catch (err) {
      setError(`Import failed: ${err.message}`)
    }
  }

  function handleReset() {
    if (!window.confirm('Erase every semester, plan, and profile field stored in this browser? This cannot be undone.')) return
    resetAll()
    clearCache()
    setMessage('All local data cleared. Reloading…')
    setTimeout(() => window.location.reload(), 600)
  }

  return (
    <section className="cc-root" aria-labelledby="settings-title">
      <header className="cc-header">
        <div className="cc-header-left">
          <p className="cc-eyebrow">Settings</p>
          <h2 id="settings-title" className="cc-title">Data &amp; Backup</h2>
        </div>
      </header>

      <div style={{ maxWidth: 720, lineHeight: 1.6 }}>
        <p>
          SUGpa now runs entirely in your browser — every semester, plan, and profile
          you enter is stored in <code>localStorage</code>. There is no server backing
          this data up. If you clear browser data, switch browsers, or move to another
          device, your records will not come with you unless you export them.
        </p>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 24 }}>
          <button className="cc-btn cc-btn--primary" type="button" onClick={handleExport}>
            Export backup (JSON)
          </button>
          <button className="cc-btn cc-btn--ghost" type="button" onClick={handleImportClick}>
            Import backup…
          </button>
          <button className="cc-btn cc-btn--ghost" type="button" onClick={handleReset}>
            Reset all data
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleFileSelected}
          />
        </div>

        {message && (
          <p className="cc-feedback cc-feedback--info" role="status" style={{ marginTop: 16 }}>
            {message}
          </p>
        )}
        {error && (
          <p className="cc-feedback cc-feedback--error" role="alert" style={{ marginTop: 16 }}>
            {error}
          </p>
        )}
      </div>
    </section>
  )
}

export default Settings
