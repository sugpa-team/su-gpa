const KEYS = {
  profile: 'sugpa:profile',
  semesters: 'sugpa:semesters',
  plans: 'sugpa:plans',
  feedback: 'sugpa:feedback',
}

const DEFAULT_PROFILE = {
  faculty: null,
  department: null,
  program_id: null,
  program_name: null,
  entry_term: null,
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    const parsed = JSON.parse(raw)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value))
}

export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function getProfile() {
  return { ...DEFAULT_PROFILE, ...readJSON(KEYS.profile, {}) }
}

export function setProfile(profile) {
  writeJSON(KEYS.profile, { ...DEFAULT_PROFILE, ...profile })
}

export function getSemesters() {
  const raw = readJSON(KEYS.semesters, [])
  return Array.isArray(raw) ? raw : []
}

export function setSemesters(semesters) {
  writeJSON(KEYS.semesters, semesters)
}

export function getPlans() {
  const raw = readJSON(KEYS.plans, [])
  return Array.isArray(raw) ? raw : []
}

export function setPlans(plans) {
  writeJSON(KEYS.plans, plans)
}

export function getFeedback() {
  const raw = readJSON(KEYS.feedback, [])
  return Array.isArray(raw) ? raw : []
}

export function setFeedback(feedback) {
  writeJSON(KEYS.feedback, feedback)
}

export function resetTracking() {
  writeJSON(KEYS.semesters, [])
  writeJSON(KEYS.plans, [])
}

export function resetAll() {
  for (const key of Object.values(KEYS)) {
    localStorage.removeItem(key)
  }
}

export function exportAll() {
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    profile: getProfile(),
    semesters: getSemesters(),
    plans: getPlans(),
    feedback: getFeedback(),
  }
}

export function importAll(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid backup payload.')
  }
  if (payload.profile && typeof payload.profile === 'object') {
    setProfile(payload.profile)
  }
  if (Array.isArray(payload.semesters)) {
    setSemesters(payload.semesters)
  }
  if (Array.isArray(payload.plans)) {
    setPlans(payload.plans)
  }
  if (Array.isArray(payload.feedback)) {
    setFeedback(payload.feedback)
  }
}
