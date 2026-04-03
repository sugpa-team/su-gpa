import { useEffect, useState } from 'react'

function MainPage() {
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch('http://localhost:8000/hello')
      .then(res => res.json())
      .then(data => {
        setMessage(data.message)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  return (
    <main className="main-page">
      <h1>welcome to sugpa</h1>
      <p>{loading ? 'Connecting to backend...' : error ? `Error: ${error}` : `Backend says: ${message}`}</p>
    </main>
  )
}

export default MainPage
