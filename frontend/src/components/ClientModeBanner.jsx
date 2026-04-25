import { useRef, useState } from 'react'
import { exportAll, importAll, resetAll } from '../lib/client/db'
import { getMode, setMode } from '../lib/clientMode'

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function ClientModeBanner({ onModeChange }) {
  const mode = getMode()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  function flash(text, isError = false) {
    if (isError) { setError(text); setMessage(null) } else { setMessage(text); setError(null) }
    setTimeout(() => { setMessage(null); setError(null) }, 4000)
  }

  async function handleExportClient() {
    setBusy(true)
    try {
      const data = await exportAll()
      downloadJson(`sugpa-data-${new Date().toISOString().split('T')[0]}.json`, data)
      flash('Exported to JSON.')
    } catch (err) {
      flash(err.message || 'Export failed.', true)
    } finally {
      setBusy(false)
    }
  }

  async function handleExportFromServer() {
    setBusy(true)
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
      const res = await fetch(`${apiBase}/api/export`)
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      const data = await res.json()
      downloadJson(`sugpa-server-export-${new Date().toISOString().split('T')[0]}.json`, data)
      flash('Downloaded server data. Switch to client mode and Import this file to migrate.')
    } catch (err) {
      flash(`Server export failed: ${err.message}. Is the backend running?`, true)
    } finally {
      setBusy(false)
    }
  }

  function handleImportClick() {
    fileRef.current?.click()
  }

  async function handleFileSelected(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!window.confirm(`Replace all existing local data with the contents of "${file.name}"?`)) return
    setBusy(true)
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      await importAll(data)
      flash('Imported. Refreshing...')
      setTimeout(() => window.location.reload(), 600)
    } catch (err) {
      flash(`Import failed: ${err.message}`, true)
    } finally {
      setBusy(false)
    }
  }

  async function handleClearLocal() {
    if (!window.confirm('Permanently delete all local browser data (semesters, courses, plans)?')) return
    setBusy(true)
    try {
      await resetAll()
      flash('Local data cleared. Refreshing...')
      setTimeout(() => window.location.reload(), 600)
    } catch (err) {
      flash(err.message || 'Clear failed.', true)
    } finally {
      setBusy(false)
    }
  }

  function toggleMode() {
    const next = mode === 'client' ? 'server' : 'client'
    setMode(next)
    if (onModeChange) onModeChange(next)
    window.location.reload()
  }

  const isClient = mode === 'client'

  return (
    <div
      className="client-mode-banner"
      style={{
        background: isClient ? '#0f4c4c' : '#3a3a3a',
        color: '#f4f4f4',
        padding: '8px 16px',
        display: 'flex',
        gap: 12,
        flexWrap: 'wrap',
        alignItems: 'center',
        fontSize: 13,
        borderBottom: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      <strong style={{ marginRight: 8 }}>
        {isClient ? '☁ Client mode (no server)' : '⛀ Server mode'}
      </strong>
      <button type="button" onClick={toggleMode} disabled={busy}>
        Switch to {isClient ? 'server' : 'client'} mode
      </button>
      <span style={{ flex: 1 }} />
      {isClient ? (
        <>
          <button type="button" onClick={handleExportClient} disabled={busy}>Export my data</button>
          <button type="button" onClick={handleImportClick} disabled={busy}>Import from file</button>
          <button type="button" onClick={handleClearLocal} disabled={busy}>Clear local data</button>
        </>
      ) : (
        <>
          <button type="button" onClick={handleExportFromServer} disabled={busy}>Download server data</button>
          <span style={{ opacity: 0.7 }}>(then switch to client mode and import)</span>
        </>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        style={{ display: 'none' }}
        onChange={handleFileSelected}
      />
      {message && <span style={{ marginLeft: 12, color: '#9aff9a' }}>{message}</span>}
      {error && <span style={{ marginLeft: 12, color: '#ff9a9a' }}>{error}</span>}
    </div>
  )
}
