import { openDB } from 'idb'

const DB_NAME = 'sugpa'
const DB_VERSION = 1

let dbPromise = null

export function getDb() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('semesters')) {
          db.createObjectStore('semesters', { keyPath: 'id', autoIncrement: true })
        }
        if (!db.objectStoreNames.contains('semester_courses')) {
          const store = db.createObjectStore('semester_courses', { keyPath: 'id', autoIncrement: true })
          store.createIndex('semester_id', 'semester_id', { unique: false })
          store.createIndex('semester_course', ['semester_id', 'course_code'], { unique: true })
        }
        if (!db.objectStoreNames.contains('plans')) {
          const store = db.createObjectStore('plans', { keyPath: 'id', autoIncrement: true })
          store.createIndex('term', 'term', { unique: false })
        }
        if (!db.objectStoreNames.contains('profile')) {
          db.createObjectStore('profile', { keyPath: 'id' })
        }
      },
    })
  }
  return dbPromise
}

export async function getAllSemesters() {
  const db = await getDb()
  const all = await db.getAll('semesters')
  return all.sort((a, b) => a.id - b.id)
}

export async function getSemester(id) {
  const db = await getDb()
  return db.get('semesters', Number(id))
}

export async function createSemesterRow(name) {
  const db = await getDb()
  const id = await db.add('semesters', { name, created_at: new Date().toISOString() })
  return { id: Number(id), name }
}

export async function deleteSemesterRow(semesterId) {
  const db = await getDb()
  const tx = db.transaction(['semesters', 'semester_courses'], 'readwrite')
  await tx.objectStore('semesters').delete(Number(semesterId))
  const courses = await tx.objectStore('semester_courses').index('semester_id').getAllKeys(IDBKeyRange.only(Number(semesterId)))
  await Promise.all(courses.map(key => tx.objectStore('semester_courses').delete(key)))
  await tx.done
}

export async function getAllSemesterCourses() {
  const db = await getDb()
  return db.getAll('semester_courses')
}

export async function getSemesterCoursesBySemester(semesterId) {
  const db = await getDb()
  return db.getAllFromIndex('semester_courses', 'semester_id', Number(semesterId))
}

export async function getSemesterCourse(courseId) {
  const db = await getDb()
  return db.get('semester_courses', Number(courseId))
}

export async function findSemesterCourse(semesterId, courseCode) {
  const db = await getDb()
  return db.getFromIndex('semester_courses', 'semester_course', [Number(semesterId), courseCode])
}

export async function insertSemesterCourse(row) {
  const db = await getDb()
  const id = await db.add('semester_courses', {
    ...row,
    created_at: new Date().toISOString(),
  })
  return Number(id)
}

export async function updateSemesterCourseGrade(courseId, grade) {
  const db = await getDb()
  const row = await db.get('semester_courses', Number(courseId))
  if (!row) throw new Error(`Course not found: ${courseId}`)
  row.grade = grade
  await db.put('semester_courses', row)
  return row
}

export async function deleteSemesterCourse(courseId) {
  const db = await getDb()
  await db.delete('semester_courses', Number(courseId))
}

export async function deleteSemesterCourseByCode(semesterId, courseCode) {
  const db = await getDb()
  const row = await db.getFromIndex('semester_courses', 'semester_course', [Number(semesterId), courseCode])
  if (row) await db.delete('semester_courses', row.id)
  return Boolean(row)
}

export async function getProfile() {
  const db = await getDb()
  const row = await db.get('profile', 'me')
  return row || { id: 'me', faculty: null, program_id: null, program_name: null, entry_term: null }
}

export async function setProfile(profile) {
  const db = await getDb()
  await db.put('profile', { id: 'me', ...profile })
}

export async function getAllPlans(term) {
  const db = await getDb()
  if (term) {
    const rows = await db.getAllFromIndex('plans', 'term', term)
    return rows.sort((a, b) => b.id - a.id)
  }
  const rows = await db.getAll('plans')
  return rows.sort((a, b) => b.id - a.id)
}

export async function getPlan(id) {
  const db = await getDb()
  return db.get('plans', Number(id))
}

export async function createPlanRow(plan) {
  const db = await getDb()
  const now = new Date().toISOString()
  const id = await db.add('plans', { ...plan, created_at: now, updated_at: now })
  return { ...plan, id: Number(id), created_at: now, updated_at: now }
}

export async function updatePlanRow(id, patch) {
  const db = await getDb()
  const existing = await db.get('plans', Number(id))
  if (!existing) throw new Error(`Plan not found: ${id}`)
  const updated = { ...existing, ...patch, updated_at: new Date().toISOString() }
  await db.put('plans', updated)
  return updated
}

export async function deletePlanRow(id) {
  const db = await getDb()
  await db.delete('plans', Number(id))
}

export async function resetAll() {
  const db = await getDb()
  const tx = db.transaction(['semesters', 'semester_courses', 'plans'], 'readwrite')
  await Promise.all([
    tx.objectStore('semesters').clear(),
    tx.objectStore('semester_courses').clear(),
    tx.objectStore('plans').clear(),
  ])
  await tx.done
}

export async function exportAll() {
  const db = await getDb()
  const [semesters, semester_courses, plans, profile] = await Promise.all([
    db.getAll('semesters'),
    db.getAll('semester_courses'),
    db.getAll('plans'),
    db.get('profile', 'me'),
  ])
  return { semesters, semester_courses, plans, profile: profile || null }
}

export async function importAll(data) {
  await resetAll()
  const db = await getDb()
  const tx = db.transaction(['semesters', 'semester_courses', 'plans', 'profile'], 'readwrite')
  for (const s of data.semesters || []) await tx.objectStore('semesters').put(s)
  for (const c of data.semester_courses || []) await tx.objectStore('semester_courses').put(c)
  for (const p of data.plans || []) await tx.objectStore('plans').put(p)
  if (data.profile) await tx.objectStore('profile').put({ id: 'me', ...data.profile })
  await tx.done
}
