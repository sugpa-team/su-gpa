import './App.css'

import ClientModeBanner from './components/ClientModeBanner'
import { useProfileContext } from './hooks/useProfileContext'
import MainPage from './pages/MainPage'
import OnboardingPage from './pages/OnboardingPage'

function App() {
  const { loading, error, programs, profile, setProfile } = useProfileContext()

  const hasSelectedProgram = Boolean(profile.program_id && profile.entry_term)

  if (loading) {
    return (
      <>
        <ClientModeBanner />
        <p className="status app-state">Loading...</p>
      </>
    )
  }

  if (error) {
    return (
      <>
        <ClientModeBanner />
        <main className="onboarding-page">
          <section className="onboarding-card">
            <p className="error" role="alert">
              {error}
            </p>
          </section>
        </main>
      </>
    )
  }

  if (!hasSelectedProgram) {
    return (
      <>
        <ClientModeBanner />
        <OnboardingPage
          programs={programs}
          profile={profile}
          onProfileSaved={nextProfile => setProfile(nextProfile)}
        />
      </>
    )
  }

  return (
    <>
      <ClientModeBanner />
      <MainPage profile={profile} onProfileUpdated={setProfile} programs={programs} />
    </>
  )
}

export default App
