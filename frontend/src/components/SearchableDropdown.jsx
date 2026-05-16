import { useMemo, useState } from 'react'

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function SearchableDropdown({
  id,
  label,
  value,
  placeholder,
  options = [],
  disabled,
  onInputChange,
  onOptionSelect,
  hideLabel = false,
}) {
  const [open, setOpen] = useState(false)

  const filteredOptions = useMemo(() => {
    const query = normalizeText(value)
    if (!query) return options
    return options.filter(option => normalizeText(option.label).includes(query))
  }, [options, value])

  return (
    <div className="searchable-dropdown">
      <label htmlFor={id} className={hideLabel ? 'visually-hidden' : undefined}>
        {label}
      </label>

      <div className={['searchable-dropdown-shell', open ? 'open' : ''].join(' ').trim()}>
        <input
          id={id}
          type="text"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => setOpen(true)}
          onBlur={() => { setTimeout(() => setOpen(false), 120) }}
          onChange={event => { onInputChange(event.target.value); setOpen(true) }}
        />
        <span className="searchable-dropdown-arrow" aria-hidden="true" />
      </div>

      {open && !disabled && (
        <div className="searchable-dropdown-menu" role="listbox">
          {filteredOptions.length > 0 ? (
            filteredOptions.map(option => (
              <button
                key={option.value}
                type="button"
                className="searchable-dropdown-option"
                role="option"
                onMouseDown={event => event.preventDefault()}
                onClick={() => { onOptionSelect(option); setOpen(false) }}
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

export default SearchableDropdown
