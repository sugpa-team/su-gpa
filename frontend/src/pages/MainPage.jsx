import { useEffect, useState } from 'react'

import CourseCatalog from './CourseCatalog'
import GpaCalculator from './GpaCalculator'
import { apiRequest } from '../lib/api'

function MainPage({ profile, onProfileUpdated, programs }) {
  const [activeTab, setActiveTab] = useState('gpa-calculator')
  const [courses, setCourses] = useState([])
  const [coursesLoading, setCoursesLoading] = useState(true)
  const [coursesError, setCoursesError] = useState(null)

  useEffect(() => {
    let ignore = false

    async function loadCourses() {
      try {
        const coursesData = await apiRequest('/courses')
        if (!ignore) {
          setCourses(coursesData)
          setCoursesError(null)
        }
      } catch (requestError) {
        if (!ignore) {
          setCoursesError(requestError.message)
        }
      } finally {
        if (!ignore) {
          setCoursesLoading(false)
        }
      }
    }

    loadCourses()

    return () => {
      ignore = true
    }
  }, [])

  return (
    <main className="main-page">
      <section className="tabs-shell" aria-label="Main sections">
        <button
          type="button"
          className={`tab-button ${activeTab === 'gpa-calculator' ? 'active' : ''}`}
          onClick={() => setActiveTab('gpa-calculator')}
          aria-pressed={activeTab === 'gpa-calculator'}
        >
          GPA Calculator
        </button>
        <button
          type="button"
          className={`tab-button ${activeTab === 'course-catalog' ? 'active' : ''}`}
          onClick={() => setActiveTab('course-catalog')}
          aria-pressed={activeTab === 'course-catalog'}
        >
          Course Catalog
        </button>
      </section>

      {coursesError && <p className="error" role="alert">{coursesError}</p>}

      {activeTab === 'gpa-calculator' && (
        <GpaCalculator
          profile={profile}
          onProfileUpdated={onProfileUpdated}
          programs={programs}
          courses={courses}
          coursesLoading={coursesLoading}
        />
      )}

      {activeTab === 'course-catalog' && <CourseCatalog courses={courses} loading={coursesLoading} />}
    </main>
  )
}

export default MainPage
