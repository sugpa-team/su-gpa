import { useMemo, useState } from 'react'

import { apiRequest } from '../lib/api'

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b))
}

function buildEntryTermOptions(yearCount = 12) {
  const currentYear = new Date().getFullYear()
  const options = []

  for (let endYear = currentYear; endYear > currentYear - yearCount; endYear -= 1) {
    const startYear = endYear - 1
    options.push(`${startYear}-${endYear} Fall`)
    options.push(`${startYear}-${endYear} Spring`)
    options.push(`${startYear}-${endYear} Summer`)
  }

  return options
}

function SearchableDropdown({
  id,
  label,
  value,
  placeholder,
  options,
  disabled,
  onInputChange,
  onOptionSelect,
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="searchable-dropdown">
      <label htmlFor={id}>{label}</label>
      <div className={`searchable-dropdown-shell ${open ? 'open' : ''}`}>
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            setTimeout(() => setOpen(false), 120)
          }}
          onChange={event => {
            onInputChange(event.target.value)
            setOpen(true)
          }}
        />
        <span className="searchable-dropdown-arrow" aria-hidden="true" />
      </div>
      {open && !disabled && (
        <div className="searchable-dropdown-menu" role="listbox">
          {options.length > 0 ? (
            options.map(option => (
              <button
                key={option.value}
                type="button"
                className="searchable-dropdown-option"
                onMouseDown={event => event.preventDefault()}
                onClick={() => {
                  onOptionSelect(option)
                  setOpen(false)
                }}
              >
                {option.label}
              </button>
            ))
          ) : (
            <p className="searchable-dropdown-empty">No matching option</p>
          )}
        </div>
      )}
    </div>
  )
}

function OnboardingPage({ programs, profile, onProfileSaved }) {
  const [faculty, setFaculty] = useState('')
  const [facultyInput, setFacultyInput] = useState('')
  const [programId, setProgramId] = useState(profile.program_id ? String(profile.program_id) : '')
  const [programInput, setProgramInput] = useState(profile.program_name || '')
  const [entryTerm, setEntryTerm] = useState(profile.entry_term || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const faculties = useMemo(
    () => uniqueSorted(programs.map(program => program.faculty).filter(Boolean)),
    [programs],
  )
  const filteredFaculties = useMemo(() => {
    const query = facultyInput.trim().toLowerCase()
    return faculties.filter(item => !query || item.toLowerCase().includes(query))
  }, [faculties, facultyInput])
  const entryTermOptions = useMemo(() => buildEntryTermOptions(), [])
  const filteredPrograms = useMemo(() => {
    const query = programInput.trim().toLowerCase()
    return programs.filter(program => {
      if (program.faculty !== faculty) {
        return false
      }
      if (!query) {
        return true
      }
      return `${program.program_name} ${program.department}`.toLowerCase().includes(query)
    })
  }, [faculty, programInput, programs])
  const filteredEntryTerms = useMemo(() => {
    const query = entryTerm.trim().toLowerCase()
    return entryTermOptions.filter(option => !query || option.toLowerCase().includes(query))
  }, [entryTerm, entryTermOptions])
  const programDropdownOptions = useMemo(
    () =>
      filteredPrograms.map(program => ({
        value: String(program.id),
        label: program.program_name,
      })),
    [filteredPrograms],
  )
  const entryTermDropdownOptions = useMemo(
    () =>
      filteredEntryTerms.map(option => ({
        value: option,
        label: option,
      })),
    [filteredEntryTerms],
  )
  const facultyDropdownOptions = useMemo(
    () =>
      filteredFaculties.map(item => ({
        value: item,
        label: item,
      })),
    [filteredFaculties],
  )

  async function handleSubmit(event) {
    event.preventDefault()
    if (!faculty || !programId || !entryTerm) {
      setError('Please complete faculty, program, and entry term selection.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const result = await apiRequest('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          faculty,
          program_id: Number(programId),
          entry_term: entryTerm,
        }),
      })
      onProfileSaved(result.profile)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="onboarding-page">
      <section className="onboarding-card">
        <p className="eyebrow">SUGpa Onboarding</p>
        <h1>Select Your Program</h1>
        <p className="status">
          We use this to load the graduation requirement set for your account.
        </p>

        {programs.length === 0 && (
          <p className="error" role="alert">
            Program list could not be loaded from the database yet.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <form className="onboarding-form" onSubmit={handleSubmit}>
          <SearchableDropdown
            id="onboarding-faculty"
            label="Faculty"
            value={facultyInput}
            placeholder="Type to search and pick faculty"
            options={facultyDropdownOptions}
            disabled={saving || programs.length === 0}
            onInputChange={nextValue => {
              setFacultyInput(nextValue)
              const matchedFaculty = faculties.find(
                item => item.toLowerCase() === nextValue.trim().toLowerCase(),
              )
              if (!matchedFaculty) {
                setFaculty('')
                setProgramInput('')
                setProgramId('')
                return
              }
              if (matchedFaculty !== faculty) {
                setFaculty(matchedFaculty)
                setProgramInput('')
                setProgramId('')
              }
            }}
            onOptionSelect={option => {
              setFacultyInput(option.value)
              if (option.value !== faculty) {
                setFaculty(option.value)
                setProgramInput('')
                setProgramId('')
              }
            }}
          />

          <SearchableDropdown
            id="onboarding-program"
            label="Program"
            value={programInput}
            placeholder="Type to search and pick program"
            options={programDropdownOptions}
            disabled={saving || !faculty}
            onInputChange={nextValue => {
              setProgramInput(nextValue)
              const matchedProgram = filteredPrograms.find(
                program => program.program_name.toLowerCase() === nextValue.trim().toLowerCase(),
              )
              setProgramId(matchedProgram ? String(matchedProgram.id) : '')
            }}
            onOptionSelect={option => {
              setProgramInput(option.label)
              setProgramId(option.value)
            }}
          />

          <SearchableDropdown
            id="entry-term"
            label="Entry Term"
            value={entryTerm}
            placeholder="Type to search and pick entry term"
            options={entryTermDropdownOptions}
            disabled={saving}
            onInputChange={setEntryTerm}
            onOptionSelect={option => setEntryTerm(option.value)}
          />

          <button
            type="submit"
            disabled={
              saving ||
              !faculty ||
              !programId ||
              !entryTermOptions.includes(entryTerm)
            }
          >
            {saving ? 'Saving...' : 'Continue'}
          </button>
        </form>
      </section>
    </main>
  )
}

export default OnboardingPage
