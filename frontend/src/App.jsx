import './App.css'

import { useProfileContext } from './hooks/useProfileContext'
import MainPage from './pages/MainPage'
import OnboardingPage from './pages/OnboardingPage'

function App() {
  const { loading, error, programs, profile, setProfile } = useProfileContext()

  const hasSelectedProgram = Boolean(profile.program_id && profile.entry_term)

  if (loading) {
    return <p className="app-loading" role="status">Loading…</p>
  }

  if (error) {
    return (
      <div className="app-error-shell">
        <div className="app-error-card">
          <p className="app-error-message" role="alert">{error}</p>
        </div>
      </div>
    )
  }

  if (!hasSelectedProgram) {
    return (
      <OnboardingPage
        programs={programs}
        profile={profile}
        onProfileSaved={nextProfile => setProfile(nextProfile)}
      />
    )
  }

  return <MainPage profile={profile} onProfileUpdated={setProfile} programs={programs} />
}

export default App