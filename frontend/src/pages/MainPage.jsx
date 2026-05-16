import { useEffect, useState } from 'react'

import CourseCatalog from './CourseCatalog'
import DegreeRequirementsHelper from './DegreeRequirementsHelper'
import GpaCalculator from './GpaCalculator'
import GraduationRequirements from './GraduationRequirements'
import Planner from './Planner'
import Settings from './Settings'
import { apiRequest } from '../lib/api'
import './MainPage.css'

const TABS = [
  { id: 'gpa-calculator',                        label: 'GPA Calculator' },
  { id: 'course-catalog',                         label: 'Course Catalog' },
  { id: 'graduation-requirements',               label: 'Graduation' },
  { id: 'bannerweb-degree-requirements-helper',  label: 'Bannerweb Helper' },
  { id: 'planner',                               label: 'Planner' },
  { id: 'settings',                              label: 'Settings' },
]

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

    return () => { ignore = true }
  }, [dataVersion])

  return (
    <main className="mp-root">

      
      <nav className="mp-nav" aria-label="Main sections">
        <div className="mp-nav-inner">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              className={['mp-tab', activeTab === tab.id ? 'mp-tab--active' : ''].join(' ').trim()}
              onClick={() => setActiveTab(tab.id)}
              aria-pressed={activeTab === tab.id}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>

      
      
      {coursesError && (
        <p className="mp-error" role="alert">{coursesError}</p>
      )}

      
      <div className="mp-panel">
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

        {activeTab === 'course-catalog' && (
          <CourseCatalog courses={courses} loading={coursesLoading} />
        )}

        {activeTab === 'graduation-requirements' && (
          <GraduationRequirements dataVersion={dataVersion} />
        )}

        {activeTab === 'bannerweb-degree-requirements-helper' && (
          <DegreeRequirementsHelper onDataChanged={handleDataChanged} />
        )}

        {activeTab === 'planner' && (
          <Planner />
        )}

        {activeTab === 'settings' && (
          <Settings />
        )}
      </div>
    </main>
  )
}

export default MainPage
