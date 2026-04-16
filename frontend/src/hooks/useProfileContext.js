import { useEffect, useState } from 'react'

import { apiRequest } from '../lib/api'

const EMPTY_PROFILE = {
  faculty: null,
  program_id: null,
  program_name: null,
  entry_term: null,
}

export function useProfileContext() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [programs, setPrograms] = useState([])
  const [profile, setProfile] = useState(EMPTY_PROFILE)

  useEffect(() => {
    let ignore = false

    async function loadProfileContext() {
      try {
        const [programData, profileData] = await Promise.all([
          apiRequest('/api/programs'),
          apiRequest('/api/profile'),
        ])
        if (!ignore) {
          setPrograms(programData.programs || [])
          setProfile(profileData)
          setError(null)
        }
      } catch (requestError) {
        if (!ignore) {
          setError(requestError.message)
        }
      } finally {
        if (!ignore) {
          setLoading(false)
        }
      }
    }

    loadProfileContext()
    return () => {
      ignore = true
    }
  }, [])

  return {
    loading,
    error,
    programs,
    profile,
    setProfile,
  }
}
