import { useMemo, useState } from 'react'

import { apiRequest } from '../lib/api'
import './OnboardingPage.css'

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

function SearchableDropdown({ id, label, value, placeholder, options, disabled, onInputChange, onOptionSelect }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="ob-dropdown">
      <label className="ob-field-label" htmlFor={id}>{label}</label>
      <div className={['ob-dropdown-shell', open ? 'ob-dropdown-shell--open' : ''].join(' ').trim()}>
        <input
          id={id}
          className="ob-dropdown-input"
          type="text"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onBlur={() => { setTimeout(() => setOpen(false), 120) }}
          onChange={event => { onInputChange(event.target.value); setOpen(true) }}
        />
        <span className="ob-dropdown-chevron" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>

      {open && !disabled && (
        <div className="ob-dropdown-menu" role="listbox">
          {options.length > 0 ? (
            options.map(option => (
              <button
                key={option.value}
                type="button"
                className="ob-dropdown-option"
                onMouseDown={event => event.preventDefault()}
                onClick={() => { onOptionSelect(option); setOpen(false) }}
                role="option"
              >
                {option.label}
              </button>
            ))
          ) : (
            <p className="ob-dropdown-empty">No matching option</p>
          )}
        </div>
      )}
    </div>
  )
}

function OnboardingPage({ programs, profile, onProfileSaved }) {
  const csPrograms = useMemo(
    () => programs.filter(
      program =>
        program.faculty === 'Faculty of Engineering and Natural Sciences' &&
        program.department === 'Computer Science and Engineering',
    ),
    [programs],
  )

  const [faculty, setFaculty]           = useState('')
  const [facultyInput, setFacultyInput] = useState('')
  const [programId, setProgramId]       = useState(profile.program_id ? String(profile.program_id) : '')
  const [programInput, setProgramInput] = useState(profile.program_name || '')
  const [entryTerm, setEntryTerm]       = useState(profile.entry_term || '')
  const [saving, setSaving]             = useState(false)
  const [error, setError]               = useState(null)

  const faculties = useMemo(
    () => uniqueSorted(csPrograms.map(program => program.faculty).filter(Boolean)),
    [csPrograms],
  )
  const filteredFaculties = useMemo(() => {
    const query = facultyInput.trim().toLowerCase()
    return faculties.filter(item => !query || item.toLowerCase().includes(query))
  }, [faculties, facultyInput])

  const entryTermOptions = useMemo(() => buildEntryTermOptions(), [])
  const filteredPrograms = useMemo(() => {
    const query = programInput.trim().toLowerCase()
    return csPrograms.filter(program => {
      if (program.faculty !== faculty) return false
      if (!query) return true
      return `${program.program_name} ${program.department}`.toLowerCase().includes(query)
    })
  }, [csPrograms, faculty, programInput])

  const filteredEntryTerms = useMemo(() => {
    const query = entryTerm.trim().toLowerCase()
    return entryTermOptions.filter(option => !query || option.toLowerCase().includes(query))
  }, [entryTerm, entryTermOptions])

  const programDropdownOptions = useMemo(
    () => filteredPrograms.map(program => ({ value: String(program.id), label: program.program_name })),
    [filteredPrograms],
  )
  const entryTermDropdownOptions = useMemo(
    () => filteredEntryTerms.map(option => ({ value: option, label: option })),
    [filteredEntryTerms],
  )
  const facultyDropdownOptions = useMemo(
    () => filteredFaculties.map(item => ({ value: item, label: item })),
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
        body: JSON.stringify({ faculty, program_id: Number(programId), entry_term: entryTerm }),
      })
      onProfileSaved(result.profile)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setSaving(false)
    }
  }
  const step = !faculty ? 1 : !programId ? 2 : 3

  return (
    <main className="ob-root">
      <div className="ob-shell">

        
        <div className="ob-brand">
          <p className="ob-eyebrow">Sabancı University</p>
          <h1 className="ob-logo">SUGpa</h1>
        </div>

        
        <section className="ob-card" aria-labelledby="ob-title">
          <div className="ob-card-head">
            <h2 id="ob-title" className="ob-card-title">Set up your program</h2>
            <p className="ob-card-sub">
              We use this to load the graduation requirements for your account.
            </p>
          </div>

          
          <div className="ob-steps" aria-hidden="true">
            {['Faculty', 'Program', 'Entry Term'].map((label, i) => {
              const num = i + 1
              const done    = num < step
              const current = num === step
              return (
                <div key={label} className={[
                  'ob-step',
                  done    ? 'ob-step--done'    : '',
                  current ? 'ob-step--current' : '',
                ].join(' ').trim()}>
                  <span className="ob-step-dot">
                    {done ? (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : num}
                  </span>
                  <span className="ob-step-label">{label}</span>
                  {i < 2 && <span className="ob-step-line" />}
                </div>
              )
            })}
          </div>

          
          {programs.length === 0 && (
            <p className="ob-feedback ob-feedback--error" role="alert">
              Program list could not be loaded from the database yet.
            </p>
          )}
          {error && (
            <p className="ob-feedback ob-feedback--error" role="alert">{error}</p>
          )}

          
          <form className="ob-form" onSubmit={handleSubmit} noValidate>
            <SearchableDropdown
              id="onboarding-faculty"
              label="Faculty"
              value={facultyInput}
              placeholder="Search and select your faculty…"
              options={facultyDropdownOptions}
              disabled={saving || programs.length === 0}
              onInputChange={nextValue => {
                setFacultyInput(nextValue)
                const matchedFaculty = faculties.find(
                  item => item.toLowerCase() === nextValue.trim().toLowerCase(),
                )
                if (!matchedFaculty) { setFaculty(''); setProgramInput(''); setProgramId(''); return }
                if (matchedFaculty !== faculty) { setFaculty(matchedFaculty); setProgramInput(''); setProgramId('') }
              }}
              onOptionSelect={option => {
                setFacultyInput(option.value)
                if (option.value !== faculty) { setFaculty(option.value); setProgramInput(''); setProgramId('') }
              }}
            />

            <SearchableDropdown
              id="onboarding-program"
              label="Program"
              value={programInput}
              placeholder={faculty ? 'Search and select your program…' : 'Select a faculty first'}
              options={programDropdownOptions}
              disabled={saving || !faculty}
              onInputChange={nextValue => {
                setProgramInput(nextValue)
                const matchedProgram = filteredPrograms.find(
                  program => program.program_name.toLowerCase() === nextValue.trim().toLowerCase(),
                )
                setProgramId(matchedProgram ? String(matchedProgram.id) : '')
              }}
              onOptionSelect={option => { setProgramInput(option.label); setProgramId(option.value) }}
            />

            <SearchableDropdown
              id="entry-term"
              label="Entry Term"
              value={entryTerm}
              placeholder="Search and select your entry term…"
              options={entryTermDropdownOptions}
              disabled={saving}
              onInputChange={setEntryTerm}
              onOptionSelect={option => setEntryTerm(option.value)}
            />

            <button
              className="ob-submit"
              type="submit"
              disabled={saving || !faculty || !programId || !entryTermOptions.includes(entryTerm)}
            >
              {saving ? 'Saving…' : 'Continue →'}
            </button>
          </form>
        </section>
      </div>
    </main>
  )
}

export default OnboardingPage
