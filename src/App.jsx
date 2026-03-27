import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const STORAGE_KEY = 'runwalk-buddy-settings'

const DEFAULT_SETTINGS = {
  runSeconds: 30,
  walkSeconds: 120,
  cycles: 6,
  warmupMinutes: 5,
  cooldownMinutes: 5,
}

const STATUS = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETE: 'complete',
}

const PHASE_KIND = {
  WALK: 'walk',
  RUN: 'run',
}

/*
  Training plans live in one structured object so the UI and session engine can
  read the same source of truth. Each week can be defined as simple repeated
  intervals or as an explicit list of interval blocks for more complex sessions.
*/
const plans = {
  preBeginner: {
    name: 'Pre-Beginner Plan',
    weeks: [
      {
        label: 'Week 1',
        config: { warmupSeconds: 300, runSeconds: 20, walkSeconds: 180, cycles: 6, cooldownSeconds: 300 },
      },
      {
        label: 'Week 2',
        config: { warmupSeconds: 300, runSeconds: 25, walkSeconds: 150, cycles: 7, cooldownSeconds: 300 },
      },
      {
        label: 'Week 3',
        config: { warmupSeconds: 300, runSeconds: 30, walkSeconds: 120, cycles: 8, cooldownSeconds: 300 },
      },
    ],
  },
  couchTo5k: {
    name: 'Couch to 5K Plan',
    weeks: [
      {
        label: 'Week 1',
        config: { warmupSeconds: 300, runSeconds: 60, walkSeconds: 90, cycles: 8, cooldownSeconds: 300 },
      },
      {
        label: 'Week 2',
        config: { warmupSeconds: 300, runSeconds: 90, walkSeconds: 120, cycles: 6, cooldownSeconds: 300 },
      },
      {
        label: 'Week 3',
        config: {
          warmupSeconds: 300,
          cooldownSeconds: 300,
          intervals: [
            { runSeconds: 90, walkSeconds: 90, repeat: 2 },
            { runSeconds: 180, walkSeconds: 180, repeat: 2 },
          ],
        },
      },
      {
        label: 'Week 4',
        config: {
          warmupSeconds: 300,
          cooldownSeconds: 300,
          intervals: [
            { runSeconds: 180, walkSeconds: 90 },
            { runSeconds: 300, walkSeconds: 150 },
            { runSeconds: 180, walkSeconds: 90 },
            { runSeconds: 300, walkSeconds: 150 },
          ],
        },
      },
      {
        label: 'Week 5',
        config: {
          warmupSeconds: 300,
          cooldownSeconds: 300,
          intervals: [
            { runSeconds: 300, walkSeconds: 180 },
            { runSeconds: 480 },
          ],
        },
      },
      {
        label: 'Week 6',
        config: {
          warmupSeconds: 300,
          cooldownSeconds: 300,
          intervals: [
            { runSeconds: 300, walkSeconds: 180 },
            { runSeconds: 600 },
          ],
        },
      },
      {
        label: 'Week 7',
        config: {
          warmupSeconds: 300,
          cooldownSeconds: 300,
          continuousRunSeconds: 1500,
        },
      },
      {
        label: 'Week 8',
        config: {
          warmupSeconds: 300,
          cooldownSeconds: 300,
          continuousRunSeconds: 1680,
        },
      },
      {
        label: 'Week 9',
        config: {
          warmupSeconds: 300,
          cooldownSeconds: 300,
          continuousRunSeconds: 1800,
        },
      },
    ],
  },
}

function supportsSpeech() {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    'SpeechSynthesisUtterance' in window
  )
}

function settingsToDraft(settings) {
  return {
    runSeconds: String(settings.runSeconds),
    walkSeconds: String(settings.walkSeconds),
    cycles: String(settings.cycles),
    warmupMinutes: String(settings.warmupMinutes),
    cooldownMinutes: String(settings.cooldownMinutes),
  }
}

function readSavedSettings() {
  if (typeof window === 'undefined') {
    return DEFAULT_SETTINGS
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)

    if (!raw) {
      return DEFAULT_SETTINGS
    }

    return sanitizeSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_SETTINGS
  }
}

function sanitizeSettings(settings) {
  return {
    runSeconds: clampNumber(settings.runSeconds, 5, 600, DEFAULT_SETTINGS.runSeconds),
    walkSeconds: clampNumber(settings.walkSeconds, 10, 1800, DEFAULT_SETTINGS.walkSeconds),
    cycles: clampNumber(settings.cycles, 1, 20, DEFAULT_SETTINGS.cycles, true),
    warmupMinutes: clampNumber(
      settings.warmupMinutes,
      0,
      30,
      DEFAULT_SETTINGS.warmupMinutes,
    ),
    cooldownMinutes: clampNumber(
      settings.cooldownMinutes,
      0,
      30,
      DEFAULT_SETTINGS.cooldownMinutes,
    ),
  }
}

function clampNumber(value, min, max, fallback, integer = false) {
  const parsed = integer ? parseInt(value, 10) : parseFloat(value)

  if (Number.isNaN(parsed)) {
    return fallback
  }

  const safeValue = Math.min(max, Math.max(min, parsed))
  return integer ? Math.round(safeValue) : safeValue
}

function formatClock(totalSeconds) {
  const safeSeconds = Math.max(0, Math.ceil(totalSeconds))
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatDuration(seconds) {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60
    return `${minutes} min`
  }

  if (seconds > 60) {
    const minutes = Math.floor(seconds / 60)
    const remainder = seconds % 60
    return `${minutes} min ${remainder} sek`
  }

  return `${seconds} sek`
}

function countdownPrompt(seconds) {
  if (seconds === 3) {
    return 'Tre'
  }

  if (seconds === 2) {
    return 'To'
  }

  return 'En'
}

function phasePrompt(kind) {
  return kind === PHASE_KIND.RUN ? 'Begynn å løpe' : 'Begynn å gå'
}

function phaseSummaryLabel(kind) {
  return kind === PHASE_KIND.RUN ? 'Løp' : 'Gå'
}

function addPhase(phases, { key, kind, durationSeconds, label, statusName, detail, announceHalfway = false }) {
  if (!durationSeconds || durationSeconds <= 0) {
    return
  }

  phases.push({
    key,
    kind,
    name: label,
    statusName,
    prompt: phasePrompt(kind),
    detail,
    durationMs: durationSeconds * 1000,
    halfwayPrompt: announceHalfway && durationSeconds >= 480 ? 'Halvveis' : null,
  })
}

/*
  The session engine builds one flat phase list no matter where the workout came
  from. That lets the timer support repeating intervals, custom complex blocks,
  and continuous runs with the same playback logic.
*/
function buildSessionFromPlanConfig(config) {
  const phases = []
  const warmupSeconds = Math.round((config.warmupSeconds ?? 0))
  const cooldownSeconds = Math.round((config.cooldownSeconds ?? 0))

  addPhase(phases, {
    key: 'warmup',
    kind: PHASE_KIND.WALK,
    durationSeconds: warmupSeconds,
    label: 'Oppvarming',
    statusName: 'Gåing',
    detail: `Gå i ${formatDuration(warmupSeconds)}`,
  })

  if (config.continuousRunSeconds) {
    addPhase(phases, {
      key: 'continuous-run',
      kind: PHASE_KIND.RUN,
      durationSeconds: config.continuousRunSeconds,
      label: 'Løping',
      statusName: 'Løping',
      detail: `Løp i ${formatDuration(config.continuousRunSeconds)}`,
      announceHalfway: true,
    })
  } else if (config.intervals?.length) {
    let runCount = 0
    let walkCount = 0

    config.intervals.forEach((block, blockIndex) => {
      const repeat = block.repeat ?? 1

      for (let repeatIndex = 0; repeatIndex < repeat; repeatIndex += 1) {
        if (block.runSeconds) {
          runCount += 1
          addPhase(phases, {
            key: `run-${blockIndex + 1}-${repeatIndex + 1}`,
            kind: PHASE_KIND.RUN,
            durationSeconds: block.runSeconds,
            label: `Løp ${runCount}`,
            statusName: 'Løping',
            detail: `Løp i ${formatDuration(block.runSeconds)}`,
            announceHalfway: true,
          })
        }

        if (block.walkSeconds) {
          walkCount += 1
          addPhase(phases, {
            key: `walk-${blockIndex + 1}-${repeatIndex + 1}`,
            kind: PHASE_KIND.WALK,
            durationSeconds: block.walkSeconds,
            label: `Gå ${walkCount}`,
            statusName: 'Gåing',
            detail: `Gå i ${formatDuration(block.walkSeconds)}`,
          })
        }
      }
    })
  } else {
    for (let cycle = 1; cycle <= config.cycles; cycle += 1) {
      addPhase(phases, {
        key: `run-${cycle}`,
        kind: PHASE_KIND.RUN,
        durationSeconds: config.runSeconds,
        label: `Løp ${cycle} av ${config.cycles}`,
        statusName: 'Løping',
        detail: `Løp i ${formatDuration(config.runSeconds)}`,
      })

      addPhase(phases, {
        key: `walk-${cycle}`,
        kind: PHASE_KIND.WALK,
        durationSeconds: config.walkSeconds,
        label: `Gå ${cycle} av ${config.cycles}`,
        statusName: 'Gåing',
        detail: `Gå i ${formatDuration(config.walkSeconds)}`,
      })
    }
  }

  addPhase(phases, {
    key: 'cooldown',
    kind: PHASE_KIND.WALK,
    durationSeconds: cooldownSeconds,
    label: 'Nedtrapping',
    statusName: 'Gåing',
    detail: `Gå i ${formatDuration(cooldownSeconds)}`,
  })

  return phases
}

function buildSessionFromSettings(settings) {
  return buildSessionFromPlanConfig({
    warmupSeconds: Math.round(settings.warmupMinutes * 60),
    runSeconds: settings.runSeconds,
    walkSeconds: settings.walkSeconds,
    cycles: settings.cycles,
    cooldownSeconds: Math.round(settings.cooldownMinutes * 60),
  })
}

function App() {
  const [settings, setSettings] = useState(readSavedSettings)
  const [draftSettings, setDraftSettings] = useState(() => settingsToDraft(readSavedSettings()))
  const [selectedPlanKey, setSelectedPlanKey] = useState('')
  const [selectedWeekIndex, setSelectedWeekIndex] = useState('')
  const [status, setStatus] = useState(STATUS.IDLE)
  const [session, setSession] = useState([])
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0)
  const [remainingMs, setRemainingMs] = useState(0)
  const [speechEnabled] = useState(supportsSpeech)
  const [sessionTitle, setSessionTitle] = useState('Nybegynnerøkt')

  const intervalRef = useRef(null)
  const statusRef = useRef(STATUS.IDLE)
  const speechEnabledRef = useRef(false)
  const sessionRef = useRef([])
  const phaseIndexRef = useRef(0)
  const phaseEndRef = useRef(0)
  const pausedRemainingRef = useRef(0)
  const lastCountdownCueRef = useRef('')
  const lastHalfwayCueRef = useRef('')

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    speechEnabledRef.current = speechEnabled
  }, [speechEnabled])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    }
  }, [settings])

  useEffect(() => {
    setDraftSettings(settingsToDraft(settings))
  }, [settings])

  const selectedPlan = selectedPlanKey ? plans[selectedPlanKey] : null
  const selectedWeek =
    selectedPlan && selectedWeekIndex !== '' ? selectedPlan.weeks[Number(selectedWeekIndex)] : null

  const customSessionSummary = useMemo(() => buildSessionFromSettings(settings), [settings])
  const customTotalDurationSeconds = useMemo(
    () => Math.round(customSessionSummary.reduce((sum, phase) => sum + phase.durationMs, 0) / 1000),
    [customSessionSummary],
  )

  const activePhase = session[currentPhaseIndex] ?? null
  const nextPhase = session[currentPhaseIndex + 1] ?? null
  const completedPhases = status === STATUS.COMPLETE ? session.length : currentPhaseIndex
  const progressPercent = session.length
    ? Math.min(100, Math.round((completedPhases / session.length) * 100))
    : 0

  const clearTicker = useCallback(() => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const speak = useCallback((text) => {
    if (!speechEnabledRef.current) {
      return
    }

    const utterance = new window.SpeechSynthesisUtterance(text)
    utterance.rate = 1
    utterance.pitch = 1
    utterance.volume = 1
    utterance.lang = 'nb-NO'

    window.speechSynthesis.cancel()
    window.speechSynthesis.resume()
    window.speechSynthesis.speak(utterance)
  }, [])

  const finishSession = useCallback(() => {
    clearTicker()
    setStatus(STATUS.COMPLETE)
    statusRef.current = STATUS.COMPLETE
    setRemainingMs(0)
    pausedRemainingRef.current = 0
    speak('Økten er ferdig')
  }, [clearTicker, speak])

  const syncTimer = useCallback(() => {
    if (statusRef.current !== STATUS.RUNNING || !sessionRef.current.length) {
      return
    }

    const now = Date.now()
    let phaseIndex = phaseIndexRef.current
    let phaseEnd = phaseEndRef.current

    while (phaseIndex < sessionRef.current.length && now >= phaseEnd) {
      phaseIndex += 1

      if (phaseIndex >= sessionRef.current.length) {
        finishSession()
        return
      }

      phaseEnd += sessionRef.current[phaseIndex].durationMs
    }

    if (phaseIndex !== phaseIndexRef.current) {
      phaseIndexRef.current = phaseIndex
      phaseEndRef.current = phaseEnd
      lastCountdownCueRef.current = ''
      lastHalfwayCueRef.current = ''
      setCurrentPhaseIndex(phaseIndex)
      speak(sessionRef.current[phaseIndex].prompt)
    }

    const currentPhase = sessionRef.current[phaseIndexRef.current]
    const remainingSeconds = Math.max(0, Math.ceil((phaseEndRef.current - now) / 1000))
    const elapsedMs = currentPhase.durationMs - Math.max(0, phaseEndRef.current - now)
    const hasUpcomingPhase = phaseIndexRef.current < sessionRef.current.length - 1

    if (currentPhase.halfwayPrompt && elapsedMs >= currentPhase.durationMs / 2) {
      const halfwayKey = currentPhase.key

      if (lastHalfwayCueRef.current !== halfwayKey) {
        lastHalfwayCueRef.current = halfwayKey
        speak(currentPhase.halfwayPrompt)
      }
    }

    if (hasUpcomingPhase && remainingSeconds > 0 && remainingSeconds <= 3) {
      const cueKey = `${phaseIndexRef.current}-${remainingSeconds}`

      if (lastCountdownCueRef.current !== cueKey) {
        lastCountdownCueRef.current = cueKey
        speak(countdownPrompt(remainingSeconds))
      }
    }

    setRemainingMs(Math.max(0, phaseEndRef.current - now))
  }, [finishSession, speak])

  const startTicker = useCallback(() => {
    clearTicker()
    intervalRef.current = window.setInterval(syncTimer, 250)
  }, [clearTicker, syncTimer])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncTimer()
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pageshow', syncTimer)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pageshow', syncTimer)
      clearTicker()

      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel()
      }
    }
  }, [clearTicker, syncTimer])

  function resetSessionState(nextStatus = STATUS.IDLE) {
    clearTicker()
    statusRef.current = nextStatus
    sessionRef.current = []
    phaseIndexRef.current = 0
    phaseEndRef.current = 0
    pausedRemainingRef.current = 0
    lastCountdownCueRef.current = ''
    lastHalfwayCueRef.current = ''
    setSession([])
    setCurrentPhaseIndex(0)
    setRemainingMs(0)
    setStatus(nextStatus)

    if (speechEnabled) {
      window.speechSynthesis.cancel()
    }
  }

  function commitDraftSettings() {
    const nextSettings = sanitizeSettings(draftSettings)
    setSettings(nextSettings)
    return nextSettings
  }

  function beginSession(nextSession, title) {
    if (!nextSession.length) {
      return
    }

    clearTicker()
    sessionRef.current = nextSession
    phaseIndexRef.current = 0
    pausedRemainingRef.current = 0
    lastCountdownCueRef.current = ''
    lastHalfwayCueRef.current = ''
    phaseEndRef.current = Date.now() + nextSession[0].durationMs
    statusRef.current = STATUS.RUNNING

    setSession(nextSession)
    setSessionTitle(title)
    setCurrentPhaseIndex(0)
    setRemainingMs(nextSession[0].durationMs)
    setStatus(STATUS.RUNNING)
    speak(nextSession[0].prompt)
    startTicker()
  }

  function startCustomSession() {
    const nextSettings = commitDraftSettings()
    beginSession(buildSessionFromSettings(nextSettings), 'Nybegynnerøkt')
  }

  function startSelectedWeek() {
    if (!selectedPlan || !selectedWeek) {
      return
    }

    const title = `${selectedPlan.name} - ${selectedWeek.label}`
    beginSession(buildSessionFromPlanConfig(selectedWeek.config), title)
  }

  function pauseSession() {
    if (statusRef.current !== STATUS.RUNNING) {
      return
    }

    clearTicker()
    pausedRemainingRef.current = Math.max(0, phaseEndRef.current - Date.now())
    statusRef.current = STATUS.PAUSED
    setRemainingMs(pausedRemainingRef.current)
    setStatus(STATUS.PAUSED)

    if (speechEnabled) {
      window.speechSynthesis.cancel()
    }
  }

  function resumeSession() {
    if (statusRef.current !== STATUS.PAUSED || !sessionRef.current.length) {
      return
    }

    phaseEndRef.current = Date.now() + pausedRemainingRef.current
    statusRef.current = STATUS.RUNNING
    setStatus(STATUS.RUNNING)
    startTicker()
    syncTimer()
  }

  function stopSession() {
    setSessionTitle('Nybegynnerøkt')
    resetSessionState(STATUS.IDLE)
  }

  function handleSettingChange(key, value) {
    setDraftSettings((current) => ({ ...current, [key]: value }))
  }

  function handleSettingBlur() {
    commitDraftSettings()
  }

  function handlePlanChange(event) {
    setSelectedPlanKey(event.target.value)
    setSelectedWeekIndex('')
    setSessionTitle('Nybegynnerøkt')
    resetSessionState(STATUS.IDLE)
  }

  function handleWeekChange(event) {
    setSelectedWeekIndex(event.target.value)
    setSessionTitle('Nybegynnerøkt')
    resetSessionState(STATUS.IDLE)
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">RunWalk Buddy</p>
        <h1>Gåing og løping</h1>
        <p className="intro">Velg en plan eller start en enkel økt og følg stemmebeskjedene.</p>

        <section className="plan-card">
          <h2>Treningsplan</h2>
          <div className="plan-grid">
            <label>
              <span>Plan</span>
              <select value={selectedPlanKey} onChange={handlePlanChange}>
                <option value="">Velg plan</option>
                {Object.entries(plans).map(([planKey, plan]) => (
                  <option key={planKey} value={planKey}>
                    {plan.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Uke</span>
              <select value={selectedWeekIndex} onChange={handleWeekChange} disabled={!selectedPlan}>
                <option value="">Velg uke</option>
                {selectedPlan?.weeks.map((week, index) => (
                  <option key={week.label} value={index}>
                    {week.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            type="button"
            className="button button-primary"
            onClick={startSelectedWeek}
            disabled={!selectedPlan || selectedWeekIndex === '' || status === STATUS.RUNNING}
          >
            Start valgt uke
          </button>

          {selectedWeek && (
            <p className="plan-summary">
              {selectedPlan.name} - {selectedWeek.label}
            </p>
          )}
        </section>

        <div className="status-panel" aria-live="polite">
          <p className="status-label">
            {status === STATUS.IDLE && 'Klar til start'}
            {status === STATUS.RUNNING && (activePhase?.statusName ?? activePhase?.name)}
            {status === STATUS.PAUSED && `Pauset under ${activePhase?.statusName ?? activePhase?.name ?? 'økt'}`}
            {status === STATUS.COMPLETE && 'Økten er ferdig'}
          </p>

          <p className="session-title">{status === STATUS.IDLE ? 'Nybegynnerøkt' : sessionTitle}</p>

          <p className="countdown">
            {status === STATUS.IDLE ? formatClock(customTotalDurationSeconds) : formatClock(remainingMs / 1000)}
          </p>

          <p className="phase-detail">
            {status === STATUS.IDLE && `Standardøkt varer i ${formatDuration(customTotalDurationSeconds)}`}
            {status !== STATUS.IDLE && activePhase?.detail}
          </p>

          <div className="progress-row" aria-hidden="true">
            <div className="progress-bar">
              <span style={{ width: `${progressPercent}%` }}></span>
            </div>
            <span>{progressPercent}%</span>
          </div>

          {nextPhase && status !== STATUS.IDLE && status !== STATUS.COMPLETE && (
            <p className="next-up">Neste: {phaseSummaryLabel(nextPhase.kind)}</p>
          )}
        </div>

        <div className="primary-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={startCustomSession}
            disabled={status === STATUS.RUNNING}
          >
            Start nybegynnerøkt
          </button>

          <div className="control-row">
            <button
              type="button"
              className="button button-secondary"
              onClick={pauseSession}
              disabled={status !== STATUS.RUNNING}
            >
              Pause
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={resumeSession}
              disabled={status !== STATUS.PAUSED}
            >
              Fortsett
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={stopSession}
              disabled={status === STATUS.IDLE}
            >
              Stopp
            </button>
          </div>
        </div>

        <p className="speech-note">
          {speechEnabled
            ? 'Stemmebeskjeder bruker enhetens talesyntese.'
            : 'Talesyntese er ikke tilgjengelig i denne nettleseren.'}
        </p>
      </section>

      <details className="settings-card">
        <summary>Egne innstillinger</summary>
        <p className="settings-copy">Endre tidene før du starter en økt.</p>

        <div className="settings-grid">
          <label>
            <span>Løpetid i sekunder</span>
            <input
              type="number"
              min="5"
              max="600"
              step="5"
              value={draftSettings.runSeconds}
              onChange={(event) => handleSettingChange('runSeconds', event.target.value)}
              onBlur={handleSettingBlur}
            />
          </label>

          <label>
            <span>Gåtid i sekunder</span>
            <input
              type="number"
              min="10"
              max="1800"
              step="10"
              value={draftSettings.walkSeconds}
              onChange={(event) => handleSettingChange('walkSeconds', event.target.value)}
              onBlur={handleSettingBlur}
            />
          </label>

          <label>
            <span>Antall runder</span>
            <input
              type="number"
              min="1"
              max="20"
              step="1"
              value={draftSettings.cycles}
              onChange={(event) => handleSettingChange('cycles', event.target.value)}
              onBlur={handleSettingBlur}
            />
          </label>

          <label>
            <span>Oppvarming i minutter</span>
            <input
              type="number"
              min="0"
              max="30"
              step="0.5"
              value={draftSettings.warmupMinutes}
              onChange={(event) => handleSettingChange('warmupMinutes', event.target.value)}
              onBlur={handleSettingBlur}
            />
          </label>

          <label>
            <span>Nedtrapping i minutter</span>
            <input
              type="number"
              min="0"
              max="30"
              step="0.5"
              value={draftSettings.cooldownMinutes}
              onChange={(event) => handleSettingChange('cooldownMinutes', event.target.value)}
              onBlur={handleSettingBlur}
            />
          </label>
        </div>
      </details>
    </main>
  )
}

export default App
