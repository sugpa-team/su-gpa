import { useMemo, useState } from 'react'

function formatCredit(value) {
  return value === null || value === undefined ? '-' : Number(value).toFixed(2)
}

function CourseCatalog({ courses, loading }) {
  const [courseSearch, setCourseSearch] = useState('')
  const [selectedFaculty, setSelectedFaculty] = useState('all')

  const faculties = useMemo(
    () => ['all', ...new Set(courses.map(course => course.faculty).filter(Boolean))],
    [courses],
  )

  const filteredCourses = useMemo(() => {
    const search = courseSearch.trim().toLowerCase()

    return courses.filter(course => {
      const matchesFaculty = selectedFaculty === 'all' || course.faculty === selectedFaculty
      const matchesSearch =
        !search || course.course.toLowerCase().includes(search) || course.name.toLowerCase().includes(search)

      return matchesFaculty && matchesSearch
    })
  }, [courseSearch, courses, selectedFaculty])

  return (
    <section className="courses-container" aria-labelledby="course-list-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Course Catalog</p>
          <h2 id="course-list-title">Find Courses</h2>
        </div>
        <span className="course-count">{filteredCourses.length} courses</span>
      </div>

      <div className="filters-section">
        <label htmlFor="faculty-dropdown">Faculty</label>
        <select
          id="faculty-dropdown"
          className="faculty-dropdown"
          value={selectedFaculty}
          onChange={event => setSelectedFaculty(event.target.value)}
        >
          {faculties.map(faculty => (
            <option key={faculty} value={faculty}>
              {faculty === 'all' ? 'All Faculties' : faculty}
            </option>
          ))}
        </select>

        <label htmlFor="course-search">Search</label>
        <input
          id="course-search"
          type="search"
          value={courseSearch}
          onChange={event => setCourseSearch(event.target.value)}
          placeholder="CS 201 or accounting"
        />
      </div>

      {loading && <p className="status">Loading courses...</p>}

      {!loading && courses.length > 0 && (
        <div className="table-wrap">
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
                filteredCourses.map(course => (
                  <tr key={course.course}>
                    <td className="course-code">{course.course}</td>
                    <td className="course-name">{course.name}</td>
                    <td>{course.faculty || '-'}</td>
                    <td className="credits">{formatCredit(course.su_credits)}</td>
                    <td className="credits">{formatCredit(course.ects_credits)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="5" className="no-results">
                    No courses found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default CourseCatalog

