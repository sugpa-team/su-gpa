import { useEffect, useState } from 'react'

import GpaCalculator from './GpaCalculator'
import OnboardingTour from './OnboardingTour'
import { useOnboardingTour } from '../hooks/useOnboardingTour'
import Planner from './Planner'
import Settings from './Settings'
import Requirements from './Requirements'
import { apiRequest } from '../lib/api'
import './MainPage.css'

const TABS = [
  { id: 'gpa-calculator',        label: 'GPA Calculator' },
  { id: 'requirements',          label: 'Requirements' },
  { id: 'planner',               label: 'Planner' },
]

function MainPage({ profile, onProfileUpdated, programs }) {
  const [activeTab, setActiveTab] = useState('gpa-calculator')
  const { visible: tourVisible, dismiss: dismissTour } = useOnboardingTour()
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
      {tourVisible && <OnboardingTour onDone={dismissTour} />}

      
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

        {activeTab === 'requirements' && (
          <Requirements dataVersion={dataVersion} onDataChanged={handleDataChanged} />
        )}

        {activeTab === 'planner' && (
          <Planner courses={courses} coursesLoading={coursesLoading} />
        )}

        {activeTab === 'settings' && (
          <Settings />
        )}
      </div>
    </main>
  )
}

export default MainPage
