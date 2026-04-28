import { useEffect, useState } from 'react'

import CourseCatalog from './CourseCatalog'
import DegreeRequirementsHelper from './DegreeRequirementsHelper'
import GpaCalculator from './GpaCalculator'
import GraduationRequirements from './GraduationRequirements'
import Planner from './Planner'
import { apiRequest } from '../lib/api'

function MainPage({ profile, onProfileUpdated, programs }) {
  const [activeTab, setActiveTab] = useState('gpa-calculator')
  const [courses, setCourses] = useState([])
  const [coursesLoading, setCoursesLoading] = useState(true)
  const [coursesError, setCoursesError] = useState(null)
  const [dataVersion, setDataVersion] = useState(0)
  const handleDataChanged = () => setDataVersion(value => value + 1)

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
  }, [dataVersion])

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
        <button
          type="button"
          className={`tab-button ${activeTab === 'graduation-requirements' ? 'active' : ''}`}
          onClick={() => setActiveTab('graduation-requirements')}
          aria-pressed={activeTab === 'graduation-requirements'}
        >
          Graduation Requirements
        </button>
        <button
          type="button"
          className={`tab-button ${activeTab === 'bannerweb-degree-requirements-helper' ? 'active' : ''}`}
          onClick={() => setActiveTab('bannerweb-degree-requirements-helper')}
          aria-pressed={activeTab === 'bannerweb-degree-requirements-helper'}
        >
          Bannerweb Degree Requirements Helper
        </button>
        <button
          type="button"
          className={`tab-button ${activeTab === 'planner' ? 'active' : ''}`}
          onClick={() => setActiveTab('planner')}
          aria-pressed={activeTab === 'planner'}
        >
          Next Semester Planner
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
          dataVersion={dataVersion}
        />
      )}

      {activeTab === 'course-catalog' && <CourseCatalog courses={courses} loading={coursesLoading} />}
      {activeTab === 'graduation-requirements' && <GraduationRequirements />}
      {activeTab === 'bannerweb-degree-requirements-helper' && <DegreeRequirementsHelper />}
      {activeTab === 'planner' && <Planner />}
    </main>
  )
}

export default MainPage
