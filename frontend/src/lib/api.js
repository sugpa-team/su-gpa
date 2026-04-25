import { isClientMode } from './clientMode'
import { clientRequest } from './client/router'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export async function apiRequest(path, options = {}) {
  // Client-only mode: route through the in-browser handlers (IndexedDB).
  if (isClientMode()) {
    const method = (options.method || 'GET').toUpperCase()
    let body = null
    if (options.body) {
      try { body = JSON.parse(options.body) } catch { body = options.body }
    }
    try {
      return await clientRequest(method, path, body)
    } catch (err) {
      const wrapped = new Error(err.message || 'Request failed')
      wrapped.status = err.status
      throw wrapped
    }
  }

  // Default: hit the FastAPI backend.
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  })

  if (response.status === 204) {
    return null
  }

  const data = await response.json()
  if (!response.ok) {
    const message = Array.isArray(data.detail)
      ? data.detail.map(item => item.msg).join(', ')
      : data.detail || 'Request failed'
    throw new Error(message)
  }

  return data
}
