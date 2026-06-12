import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import fs from 'node:fs'

const REQUIREMENTS_PATH = 'data/test_requirements.json'

const fixtureCourses = [
  { Course: 'UNI 101', Name: 'University Course I', 'ECTS Credits': 5, 'SU Credits': 3, Faculty: 'FASS' },
  { Course: 'REQ 101', Name: 'Required Course I', 'ECTS Credits': 5, 'SU Credits': 3, Faculty: 'FENS' },
  { Course: 'CORE 101', Name: 'Core Elective I', 'ECTS Credits': 5, 'SU Credits': 3, Faculty: 'FENS' },
  { Course: 'CORE 102', Name: 'Core Elective II', 'ECTS Credits': 5, 'SU Credits': 3, Faculty: 'FENS' },
  { Course: 'CORE 103', Name: 'Core Elective III', 'ECTS Credits': 5, 'SU Credits': 3, Faculty: 'FENS' },
  { Course: 'AREA 101', Name: 'Area Elective I', 'ECTS Credits': 5, 'SU Credits': 3, Faculty: 'FENS' },
  { Course: 'FREE 101', Name: 'Free Elective I', 'ECTS Credits': 5, 'SU Credits': 3, Faculty: 'FASS' },
  { Course: 'FREE 102', Name: 'Free Elective II', 'ECTS Credits': 5, 'SU Credits': 3, Faculty: 'SBS' },
  { Course: 'CS 204', Name: 'Advanced Programming', 'ECTS Credits': 6, 'SU Credits': 3, Faculty: 'FENS' },
  { Course: 'DSA 210', Name: 'Introduction to Data Science', 'ECTS Credits': 6, 'SU Credits': 3, Faculty: 'FENS' },
  { Course: 'CS 445', Name: 'Natural Language Processing', 'ECTS Credits': 6, 'SU Credits': 3, Faculty: 'FENS' },
]

const fixtureRequirements = {
  requirement_summary: {
    total: { min_ects: 40, min_su: 18 },
    categories: [
      { category: 'University Courses', min_su: 3, min_courses: 1 },
      { category: 'Required Courses', min_su: 3, min_courses: 1 },
      { category: 'Core Electives', min_su: 6 },
      { category: 'Area Electives', min_su: 3 },
      { category: 'Free Electives', min_su: 3 },
      { category: 'Engineering', min_ects: 6 },
      { category: 'Basic Science', min_ects: 4 },
    ],
  },
  categories: {
    'University Courses': [
      { course: 'UNI 101', name: 'University Course I' },
    ],
    'Required Courses': [
      { course: 'REQ 101', name: 'Required Course I' },
    ],
    'Core Electives': [
      { course: 'CORE 101', name: 'Core Elective I' },
      { course: 'CORE 102', name: 'Core Elective II' },
      { course: 'CORE 103', name: 'Core Elective III' },
    ],
    'Area Electives': [
      { course: 'AREA 101', name: 'Area Elective I' },
    ],
    'Free Electives': {
      definition: 'All eligible courses not counted in higher-priority categories.',
    },
    Engineering: {
      min_ects_credits: 6,
    },
    'Basic Science': {
      min_ects_credits: 4,
    },
  },
  prerequisites: {
    courses: [
      {
        code: 'CS 445',
        name: 'Natural Language Processing',
        prerequisites: ['CS 204', 'DSA 210 / CS 210'],
        prerequisite_type: 'multiple',
      },
    ],
  },
}

const fixturePrograms = {
  programs: [
    {
      id: 1,
      faculty: 'FENS',
      department: 'TEST',
      program_name: 'Test Engineering Program',
      requirements_file: REQUIREMENTS_PATH,
    },
  ],
}

const fixtureFacultyCourses = { courses: [] }

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function mockJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return clone(payload)
    },
  }
}

function installBrowserMocks() {
  const store = new Map()
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }

  globalThis.fetch = async rawUrl => {
    const path = String(rawUrl).replace(/^\/+/, '')
    const payloads = {
      'data/courses_SU.json': fixtureCourses,
      'data/programs.json': fixturePrograms,
      'data/faculty_courses_SU.json': fixtureFacultyCourses,
      'data/schedule_data/202502.min.json': {
        courses: [
          {
            code: 'CORE 101',
            name: 'Core Elective I',
            classes: [
              {
                type: '',
                sections: [
                  {
                    crn: '10001',
                    group: 'A',
                    instructors: 0,
                    schedule: [],
                  },
                ],
              },
            ],
          },
        ],
        instructors: ['Instructor'],
        places: [],
      },
      [REQUIREMENTS_PATH]: fixtureRequirements,
    }
    if (!(path in payloads)) return mockJsonResponse({ error: `Missing fixture: ${path}` }, 404)
    return mockJsonResponse(payloads[path])
  }
}

installBrowserMocks()

const [{ apiRequest }, { clearCache }, storage, semesterApi] = await Promise.all([
  import('./api.js'),
  import('./staticData.js'),
  import('./storage.js'),
  import('./semesters.js'),
])

const { importBannerwebParseResult, resetPrereqCache } = semesterApi

beforeEach(() => {
  storage.resetAll()
  clearCache()
  resetPrereqCache()
  storage.setProfile({
    faculty: 'FENS',
    department: 'TEST',
    program_id: 1,
    program_name: 'Test Engineering Program',
    entry_term: '2024-2025 Fall',
  })
})

function bannerwebCourse(course, term) {
  return {
    course,
    grade: 'A',
    su_credits: 3,
    ects_credits: 5,
    term,
  }
}

async function progressByCategory() {
  const progress = await apiRequest('/api/graduation-requirements')
  return Object.fromEntries(progress.categories.map(item => [item.category, item]))
}

function detailCodes(category) {
  return (category.completed_course_details || []).map(course => course.course_code)
}

function findSummaryCourse(summary, courseCode) {
  for (const semester of summary.semesters) {
    const found = semester.courses.find(course => course.course_code === courseCode)
    if (found) return found
  }
  return null
}

test('recomputes imported core overflow after a manual GPA-page deletion', async () => {
  const imported = await importBannerwebParseResult({
    sections: {
      'CORE ELECTIVES': {
        courses: [
          bannerwebCourse('CORE 101', '202301'),
          bannerwebCourse('CORE 102', '202302'),
        ],
      },
      'AREA ELECTIVES': {
        courses: [
          bannerwebCourse('CORE 103', '202303'),
        ],
      },
    },
  })

  let categories = await progressByCategory()
  assert.equal(categories['Core Electives'].completed_su, 6)
  assert.equal(categories['Area Electives'].completed_su, 3)

  const removedCourse = findSummaryCourse(imported.summary, 'CORE 101')
  assert.ok(removedCourse)
  await apiRequest(`/api/courses/${removedCourse.id}`, { method: 'DELETE' })

  categories = await progressByCategory()
  assert.equal(categories['Core Electives'].completed_su, 6)
  assert.equal(categories['Core Electives'].completed_courses, 2)
  assert.deepEqual(detailCodes(categories['Core Electives']), ['CORE 102', 'CORE 103'])
  assert.equal(categories['Area Electives'].completed_su, 0)
  assert.deepEqual(detailCodes(categories['Area Electives']), [])
})

test('reports counted course details for fixed requirement categories', async () => {
  await importBannerwebParseResult({
    sections: {
      'UNIVERSITY COURSES': {
        courses: [
          bannerwebCourse('UNI 101', '202301'),
        ],
      },
      'REQUIRED COURSES': {
        courses: [
          bannerwebCourse('REQ 101', '202302'),
        ],
      },
    },
  })

  const categories = await progressByCategory()

  assert.deepEqual(detailCodes(categories['University Courses']), ['UNI 101'])
  assert.deepEqual(detailCodes(categories['Required Courses']), ['REQ 101'])
  assert.equal(categories['University Courses'].completed_course_details[0].course_name, 'University Course I')
  assert.equal(categories['Required Courses'].completed_course_details[0].counted_su, 3)
})

test('uses Bannerweb elective sections as hints for catalog-missing courses', async () => {
  await importBannerwebParseResult({
    sections: {
      'CORE ELECTIVES': {
        courses: [
          bannerwebCourse('CORE 100', '202301'),
        ],
      },
      'AREA ELECTIVES': {
        courses: [
          bannerwebCourse('AREA 100', '202302'),
        ],
      },
      'FREE ELECTIVES': {
        courses: [
          bannerwebCourse('FREE 100', '202303'),
        ],
      },
    },
  })

  const categories = await progressByCategory()

  assert.deepEqual(detailCodes(categories['Core Electives']), ['CORE 100'])
  assert.deepEqual(detailCodes(categories['Area Electives']), ['AREA 100'])
  assert.deepEqual(detailCodes(categories['Free Electives']), ['FREE 100'])
  assert.equal(categories['Free Electives'].completed_su, 3)
})

test('restores imported Basic Science attribution when a deleted course is manually re-added', async () => {
  const imported = await importBannerwebParseResult({
    sections: {
      'CORE ELECTIVES': {
        courses: [
          bannerwebCourse('CORE 101', '202301'),
        ],
      },
      ENGINEERING: {
        courses: [
          { course: 'CORE 101', grade: 'A', ects_credits: 6, term: '202301' },
        ],
      },
      'BASIC SCIENCE': {
        courses: [
          { course: 'CORE 101', grade: 'A', ects_credits: 4, term: '202301' },
        ],
      },
    },
  })

  let categories = await progressByCategory()
  assert.equal(categories['Basic Science'].completed_ects, 4)

  const removedCourse = findSummaryCourse(imported.summary, 'CORE 101')
  assert.ok(removedCourse)
  await apiRequest(`/api/courses/${removedCourse.id}`, { method: 'DELETE' })

  categories = await progressByCategory()
  assert.equal(categories['Basic Science'].completed_ects, 0)

  await apiRequest('/api/courses', {
    method: 'POST',
    body: JSON.stringify({
      semester_id: removedCourse.semester_id,
      course_code: 'CORE 101',
      grade: 'A',
    }),
  })

  categories = await progressByCategory()
  assert.equal(categories['Engineering'].completed_ects, 6)
  assert.equal(categories['Basic Science'].completed_ects, 4)
  assert.deepEqual(detailCodes(categories['Basic Science']), ['CORE 101'])
})

test('sends core overflow to free electives when core and area are already full', async () => {
  await importBannerwebParseResult({
    sections: {
      'CORE ELECTIVES': {
        courses: [
          bannerwebCourse('CORE 101', '202301'),
          bannerwebCourse('CORE 102', '202302'),
        ],
      },
      'AREA ELECTIVES': {
        courses: [
          bannerwebCourse('AREA 101', '202303'),
          bannerwebCourse('CORE 103', '202304'),
        ],
      },
    },
  })

  const categories = await progressByCategory()
  assert.equal(categories['Core Electives'].completed_su, 6)
  assert.equal(categories['Area Electives'].completed_su, 3)
  assert.equal(categories['Free Electives'].completed_su, 3)
  assert.deepEqual(detailCodes(categories['Free Electives']), ['CORE 103'])
})

test('reports raw total SU progress in requirements and GPA summaries', async () => {
  await importBannerwebParseResult({
    sections: {
      'CORE ELECTIVES': {
        courses: [
          bannerwebCourse('CORE 101', '202301'),
          bannerwebCourse('CORE 102', '202302'),
        ],
      },
      'AREA ELECTIVES': {
        courses: [
          bannerwebCourse('AREA 101', '202303'),
        ],
      },
      'FREE ELECTIVES': {
        courses: [
          bannerwebCourse('FREE 101', '202304'),
          bannerwebCourse('FREE 102', '202305'),
        ],
      },
    },
  })

  const progress = await apiRequest('/api/graduation-requirements')
  const gpaSummary = await apiRequest('/api/gpa')

  assert.equal(progress.total_credits_completed, 15)
  assert.equal(gpaSummary.total_planned_su_credits, 15)
})

test('allows manual course add with missing prerequisites and reports warning', async () => {
  const semesterSummary = await apiRequest('/taken-courses/semesters', {
    method: 'POST',
    body: JSON.stringify({ name: '202301' }),
  })
  const semesterId = semesterSummary.semesters[0].id
  assert.ok(semesterSummary.semesters[0].eligible_course_codes.includes('CS 445'))

  await apiRequest('/api/courses', {
    method: 'POST',
    body: JSON.stringify({
      semester_id: semesterId,
      course_code: 'CS 445',
      grade: 'A',
    }),
  })

  const gpaSummary = await apiRequest('/api/gpa')
  const course = findSummaryCourse(gpaSummary, 'CS 445')
  assert.ok(course)
  assert.deepEqual(course.missing_prerequisites, ['CS 204', 'DSA 210 / CS 210'])
  assert.equal(course.prerequisite_warning, 'Missing prerequisites: CS 204, DSA 210 / CS 210.')
})

test('planner retake window ignores summer and deleted regular semesters', async () => {
  let summary = await apiRequest('/taken-courses/semesters', {
    method: 'POST',
    body: JSON.stringify({ name: '202301' }),
  })
  const firstSemesterId = summary.semesters[0].id

  await apiRequest('/api/courses', {
    method: 'POST',
    body: JSON.stringify({
      semester_id: firstSemesterId,
      course_code: 'CORE 101',
      grade: 'F',
    }),
  })

  await apiRequest('/taken-courses/semesters', {
    method: 'POST',
    body: JSON.stringify({ name: '202303' }),
  })
  await apiRequest('/taken-courses/semesters', {
    method: 'POST',
    body: JSON.stringify({ name: '202401' }),
  })
  summary = await apiRequest('/taken-courses/semesters', {
    method: 'POST',
    body: JSON.stringify({ name: '202402' }),
  })

  const planner = await apiRequest('/api/schedule/202502/planner')
  const course = planner.courses.find(item => item.code === 'CORE 101')

  assert.equal(summary.semesters.length, 4)
  assert.ok(course)
  assert.notEqual(course.retake_allowed, false)
  assert.equal(course.retake_reason ?? null, null)
})

test('ME 425 prerequisite data uses ENS alternatives', () => {
  const files = [
    'cs_bscs_requirements_v1.json',
    'mat_bsmat_requirements_v1.json',
    'me_bsme_requirements_v1.json',
    'me_bsme_requirements_2027.json',
  ]

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(`public/data/${file}`, 'utf8'))
    const course = data.prerequisites?.courses?.find(item => item.code === 'ME 425')
    assert.ok(course, `${file} should include ME 425 prerequisite data`)
    assert.deepEqual(course.prerequisites, ['ENS 206 / ENS 211'])
    assert.equal(course.prerequisite_type, 'single')
  }
})

test('MATH 306 prerequisite data is consistent across requirement files', () => {
  const files = [
    'bio_bsbio_requirements_v1.json',
    'cs_bscs_requirements_v1.json',
    'ee_bsee_requirements_v1.json',
    'ee_bsee_requirements_2027.json',
    'ie_bsie_requirements_v1.json',
    'mat_bsmat_requirements_v1.json',
    'me_bsme_requirements_v1.json',
    'me_bsme_requirements_2027.json',
  ]

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(`public/data/${file}`, 'utf8'))
    const course = data.prerequisites?.courses?.find(item => item.code === 'MATH 306')
    assert.ok(course, `${file} should include MATH 306 prerequisite data`)
    assert.deepEqual(course.prerequisites, ['MATH 203'])
    assert.equal(course.prerequisite_type, 'single')
  }
})

test('CS 455 prerequisite data uses CS 415 or CS 412 alternatives', () => {
  const files = [
    'cs_bscs_requirements_v1.json',
    'ee_bsee_requirements_v1.json',
    'ee_bsee_requirements_2027.json',
    'ie_bsie_requirements_v1.json',
    'mat_bsmat_requirements_v1.json',
    'me_bsme_requirements_v1.json',
    'me_bsme_requirements_2027.json',
  ]

  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(`public/data/${file}`, 'utf8'))
    const course = data.prerequisites?.courses?.find(item => item.code === 'CS 455')
    assert.ok(course, `${file} should include CS 455 prerequisite data`)
    assert.deepEqual(course.prerequisites, ['CS 415 / CS 412'])
    assert.equal(course.prerequisite_type, 'single')
  }
})

test('marks GPA summary when Bannerweb courses have been imported', async () => {
  const emptySummary = await apiRequest('/api/gpa')
  assert.equal(emptySummary.has_bannerweb_imported_courses, false)

  await importBannerwebParseResult({
    sections: {
      'UNIVERSITY COURSES': {
        courses: [
          bannerwebCourse('UNI 101', '202301'),
        ],
      },
    },
  })

  const importedSummary = await apiRequest('/api/gpa')
  assert.equal(importedSummary.has_bannerweb_imported_courses, true)
})

test('Bannerweb import replaces existing GPA calculator courses', async () => {
  const manualSummary = await apiRequest('/taken-courses/semesters', {
    method: 'POST',
    body: JSON.stringify({ name: 'Manual Semester' }),
  })
  const manualSemesterId = manualSummary.semesters[0].id

  await apiRequest('/api/courses', {
    method: 'POST',
    body: JSON.stringify({
      semester_id: manualSemesterId,
      course_code: 'CORE 101',
      grade: 'B',
    }),
  })

  let gpaSummary = await apiRequest('/api/gpa')
  assert.ok(findSummaryCourse(gpaSummary, 'CORE 101'))

  const imported = await importBannerwebParseResult({
    sections: {
      'UNIVERSITY COURSES': {
        courses: [
          bannerwebCourse('UNI 101', '202301'),
        ],
      },
    },
  })

  assert.equal(imported.replaced_existing_data, true)
  gpaSummary = await apiRequest('/api/gpa')
  assert.deepEqual(gpaSummary.semesters.map(semester => semester.name), ['202301'])
  assert.deepEqual(
    gpaSummary.semesters.flatMap(semester => semester.courses.map(course => course.course_code)),
    ['UNI 101'],
  )
  assert.equal(findSummaryCourse(gpaSummary, 'CORE 101'), null)
})
