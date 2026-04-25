import * as db from './db'
import { loadRequirements } from './staticData'
import { resetTrackingData } from './coursesService'

let programsCache = null

async function loadPrograms() {
  if (programsCache) return programsCache
  const requirements = await loadRequirements()
  const program = requirements?.program || {}
  const faculty = program.faculty_name
  const department = program.department_name
  const programName = program.program_name
  if (!faculty || !department || !programName) {
    programsCache = []
    return programsCache
  }
  programsCache = [{
    id: 1,
    faculty,
    department,
    program_name: programName,
  }]
  return programsCache
}

export async function getPrograms() {
  const programs = await loadPrograms()
  return { programs }
}

export async function getProfile() {
  const stored = await db.getProfile()
  return {
    faculty: stored.faculty || null,
    program_id: stored.program_id || null,
    program_name: stored.program_name || null,
    entry_term: stored.entry_term || null,
  }
}

export async function updateProfile({ faculty, program_id, entry_term }) {
  const trimmedFaculty = String(faculty || '').trim()
  const trimmedEntryTerm = String(entry_term || '').trim()
  if (!trimmedFaculty) throw new Error('Faculty is required.')
  if (!trimmedEntryTerm) throw new Error('Entry term is required.')

  const programs = await loadPrograms()
  const matched = programs.find(p => p.id === Number(program_id))
  if (!matched) {
    const err = new Error(`Program not found: ${program_id}`)
    err.statusCode = 404
    throw err
  }
  if (matched.faculty !== trimmedFaculty) {
    throw new Error('Selected faculty does not match program.')
  }

  const current = await db.getProfile()
  const currentProgramId = current.program_id

  await db.setProfile({
    faculty: trimmedFaculty,
    department: matched.department,
    program_id: Number(program_id),
    program_name: matched.program_name,
    entry_term: trimmedEntryTerm,
  })

  const trackingReset = currentProgramId !== null && currentProgramId !== undefined && currentProgramId !== Number(program_id)
  if (trackingReset) {
    await resetTrackingData()
  }

  return {
    profile: await getProfile(),
    tracking_reset: trackingReset,
  }
}
