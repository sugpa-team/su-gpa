// Client-only mode flag.
//
// Activated by:
//   1. URL param `?mode=client`  (sticky — written to localStorage)
//   2. Existing localStorage value `sugpa.mode === "client"`
//
// Deactivated by `?mode=server`.

const STORAGE_KEY = 'sugpa.mode'

function readUrlMode() {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const value = params.get('mode')
  if (value === 'client' || value === 'server') return value
  return null
}

function readStoredMode() {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredMode(mode) {
  if (typeof window === 'undefined') return
  try {
    if (mode) window.localStorage.setItem(STORAGE_KEY, mode)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

let cached = null

export function getMode() {
  if (cached !== null) return cached
  const fromUrl = readUrlMode()
  if (fromUrl) {
    writeStoredMode(fromUrl)
    cached = fromUrl
    return cached
  }
  cached = readStoredMode() === 'client' ? 'client' : 'server'
  return cached
}

export function isClientMode() {
  return getMode() === 'client'
}

export function setMode(mode) {
  cached = mode === 'client' ? 'client' : 'server'
  writeStoredMode(cached)
}
