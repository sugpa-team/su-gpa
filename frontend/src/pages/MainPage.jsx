import { useEffect, useState } from 'react'

function MainPage() {
  const [courses, setCourses] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedFaculty, setSelectedFaculty] = useState('all')

  useEffect(() => {
    fetch('http://localhost:8000/courses')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`)
        return res.json()
      })
      .then(data => {
        setCourses(data)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  // Get unique faculties
  const faculties = ['all', ...new Set(courses.map(c => c.faculty).filter(Boolean))]

  // Filter courses based on selected faculty
  const filteredCourses = selectedFaculty === 'all' 
    ? courses 
    : courses.filter(c => c.faculty === selectedFaculty)

  return (
    <main className="main-page">
      <h1>Welcome to SU-GPA</h1>
      <div className="courses-container">
        {loading && <p className="status">Loading courses...</p>}
        {error && <p className="error">Error: {error}</p>}
        {!loading && !error && courses.length === 0 && <p className="status">No courses found</p>}
        
        {!loading && !error && courses.length > 0 && (
          <>
            <div className="filters-section">
              <label htmlFor="faculty-dropdown" className="dropdown-label">
                Display Course List:
              </label>
              <select 
                id="faculty-dropdown"
                className="faculty-dropdown"
                value={selectedFaculty}
                onChange={(e) => setSelectedFaculty(e.target.value)}
              >
                {faculties.map((faculty) => (
                  <option key={faculty} value={faculty}>
                    {faculty === 'all' ? 'All Faculties' : faculty}
                  </option>
                ))}
              </select>
              <span className="course-count">Displaying: {filteredCourses.length} courses</span>
            </div>

            <table className="courses-table">
              <thead>
                <tr>
                  <th>Course Code</th>
                  <th>Name</th>
                  <th>Faculty</th>
                  <th>SU Credits</th>
                  <th>ECTS Credits</th>
                </tr>
              </thead>
              <tbody>
                {filteredCourses.length > 0 ? (
                  filteredCourses.map((course) => (
                    <tr key={course.course}>
                      <td className="course-code">{course.course}</td>
                      <td className="course-name">{course.name}</td>
                      <td>{course.faculty || '-'}</td>
                      <td className="credits">{course.su_credits || '-'}</td>
                      <td className="credits">{course.ects_credits || '-'}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="no-results">No courses found for this faculty</td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </main>
  )
}

export default MainPage
