import { useMemo, useState } from 'react'

import './CourseCatalog.css'

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
      const matchesSearch  = !search || course.course.toLowerCase().includes(search) || course.name.toLowerCase().includes(search)
      return matchesFaculty && matchesSearch
    })
  }, [courseSearch, courses, selectedFaculty])

  return (
    <section className="cc-root" aria-labelledby="course-list-title">


      <header className="cc-header">
        <div className="cc-header-left">
          <p className="cc-eyebrow">Course Catalog</p>
          <h2 id="course-list-title" className="cc-title">Find Courses</h2>
        </div>
        <span className="cc-count">{filteredCourses.length} courses</span>
      </header>


      <div className="cc-filters" role="search">
        <div className="cc-filter-group">
          <label className="cc-field-label" htmlFor="faculty-dropdown">Faculty</label>
          <select
            id="faculty-dropdown"
            className="cc-select"
            value={selectedFaculty}
            onChange={event => setSelectedFaculty(event.target.value)}
          >
            {faculties.map(faculty => (
              <option key={faculty} value={faculty}>
                {faculty === 'all' ? 'All Faculties' : faculty}
              </option>
            ))}
          </select>
        </div>

        <div className="cc-filter-group cc-filter-group--grow">
          <label className="cc-field-label" htmlFor="course-search">Search</label>
          <input
            id="course-search"
            className="cc-input"
            type="search"
            value={courseSearch}
            onChange={event => setCourseSearch(event.target.value)}
            placeholder="CS 201 or accounting…"
          />
        </div>
      </div>


      {loading && <p className="cc-status">Loading courses…</p>}


      {!loading && courses.length > 0 && (
        <div className="cc-table-wrap">
          <table className="cc-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Faculty</th>
                <th className="cc-th--num">SU</th>
                <th className="cc-th--num">ECTS</th>
              </tr>
            </thead>
            <tbody>
              {filteredCourses.length > 0 ? (
                filteredCourses.map(course => (
                  <tr key={course.course} className="cc-row">
                    <td className="cc-td-code">{course.course}</td>
                    <td className="cc-td-name">{course.name}</td>
                    <td className="cc-td-faculty">{course.faculty || '—'}</td>
                    <td className="cc-td-num">{formatCredit(course.su_credits)}</td>
                    <td className="cc-td-num">{formatCredit(course.ects_credits)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="cc-empty-row" colSpan="5">No courses match your search.</td>
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
