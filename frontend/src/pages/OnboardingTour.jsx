import { useState } from 'react'
import './OnboardingTour.css'

const STEPS = [
  {
    icon: '🎓',
    tag: 'GPA Calculator',
    title: 'Enter your courses, know your GPA',
    body: 'Add all your courses and grades in the GPA Calculator tab. Your weighted GPA, SU credits, and ECTS credits are calculated automatically in real time — no manual math needed.',
    highlight: '#e8a030',
  },
  {
    icon: '📅',
    tag: 'Planner',
    title: 'Plan your next semester',
    body: 'Pick courses and sections for the upcoming term in the Planner tab. Your weekly schedule is built on the fly and any time conflicts are flagged instantly.',
    highlight: '#a78bfa',
    sub: {
      icon: '⬆️',
      label: 'Import Banner Web',
      text: 'Use the "Import Banner Web" button at the top of the page to import all your previously taken courses in one click. Your transcript is pulled in automatically.',
    },
  },
  {
    icon: '✨',
    tag: 'Recommendations',
    title: 'Courses picked just for you',
    body: 'The "Recommended for You" section in the Planner shows courses you are eligible to take based on your transcript and curriculum. Each suggestion includes the requirement category, workload rating, and peer reviews.',
    highlight: '#3dd68c',
  },
  {
    icon: null,
    tag: 'Credits',
    title: 'Meet the team',
    body: null,
    highlight: '#8aaaf8',
    isCredits: true,
  },
]

const MAKERS = [
  { handle: '@zynpdgc',      color: '#e8a030' },
  { handle: '@durunef',      color: '#a78bfa' },
  { handle: '@mehmeterseker', color: '#3dd68c' },
]

const STORAGE_KEY = 'su-gpa-tour-v1'

export function useOnboardingTour() {
  const [visible, setVisible] = useState(() => {
    try { return !localStorage.getItem(STORAGE_KEY) }
    catch { return true }
  })

  function dismiss() {
    try { localStorage.setItem(STORAGE_KEY, '1') } catch {}
    setVisible(false)
  }

  return { visible, dismiss }
}

export default function OnboardingTour({ onDone }) {
  const [step, setStep] = useState(0)
  const current = STEPS[step]
  const isLast  = step === STEPS.length - 1

  function next()  { isLast ? onDone() : setStep(s => s + 1) }
  function prev()  { setStep(s => s - 1) }

  return (
    <div className="ot-overlay" role="dialog" aria-modal="true" aria-label="Welcome tour">
      <div className="ot-modal">

        {/* Progress dots */}
        <div className="ot-dots" role="list" aria-label="Steps">
          {STEPS.map((_, i) => (
            <span
              key={i}
              role="listitem"
              className={['ot-dot', i === step ? 'ot-dot--active' : i < step ? 'ot-dot--done' : ''].join(' ').trim()}
              style={i === step ? { background: current.highlight } : {}}
            />
          ))}
        </div>

        {/* Tag */}
        <span className="ot-tag" style={{ color: current.highlight, borderColor: current.highlight }}>
          {current.tag}
        </span>

        {/* Icon */}
        {current.icon && (
          <div className="ot-icon" style={{ '--ot-glow': current.highlight }}>
            {current.icon}
          </div>
        )}

        {/* Credits step */}
        {current.isCredits ? (
          <div className="ot-credits">
            <p className="ot-credits-lead">SU GPA is built by Sabancı University students, for Sabancı University students.</p>
            <div className="ot-makers">
              {MAKERS.map(m => (
                <div key={m.handle} className="ot-maker" style={{ '--maker-color': m.color }}>
                  <div className="ot-maker-avatar">{m.handle[1].toUpperCase()}</div>
                  <span className="ot-maker-handle">{m.handle}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            <h2 className="ot-title">{current.title}</h2>
            <p className="ot-body">{current.body}</p>

            {current.sub && (
              <div className="ot-sub-card" style={{ '--ot-sub-color': current.highlight }}>
                <span className="ot-sub-icon">{current.sub.icon}</span>
                <div>
                  <strong className="ot-sub-label">{current.sub.label}</strong>
                  <p className="ot-sub-text">{current.sub.text}</p>
                </div>
              </div>
            )}
          </>
        )}

        {/* Actions */}
        <div className="ot-actions">
          {step > 0 ? (
            <button type="button" className="ot-btn ot-btn--ghost" onClick={prev}>
              ← Back
            </button>
          ) : (
            <button type="button" className="ot-btn ot-btn--ghost" onClick={onDone}>
              Skip
            </button>
          )}

          <button
            type="button"
            className="ot-btn ot-btn--primary"
            style={{ background: current.highlight }}
            onClick={next}
          >
            {isLast ? "Let's go!" : 'Next →'}
          </button>
        </div>

        {/* Step counter */}
        <p className="ot-step-count">{step + 1} / {STEPS.length}</p>
      </div>
    </div>
  )
}
