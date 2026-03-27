import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const STORAGE_KEY = 'runwalk-buddy-settings'

/* const DEFAULT_SETTINGS = {
  runSeconds: 30,
  walkSeconds: 120,
  cycles: 6,
  warmupMinutes: 5,
  cooldownMinutes: 5,
} */

const DEFAULT_SETTINGS = {
  runSeconds: 30,
  walkSeconds: 30,
  cycles: 6,
  warmupMinutes: 1,
  cooldownMinutes: 5,
}

const STATUS = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETE: 'complete',
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

function buildSession(settings) {
  const phases = []
  const warmupSeconds = Math.round(settings.warmupMinutes * 60)
  const cooldownSeconds = Math.round(settings.cooldownMinutes * 60)

  if (warmupSeconds > 0) {
    phases.push({
      key: 'warmup',
      name: 'Oppvarming',
      statusName: 'Oppvarming - Gå',
      prompt: 'Begynn å gå',
      detail: `Gå i ${formatDuration(warmupSeconds)}`,
      durationMs: warmupSeconds * 1000,
    })
  }

  for (let cycle = 1; cycle <= settings.cycles; cycle += 1) {
    phases.push({
      key: `run-${cycle}`,
      name: `Løp ${cycle} av ${settings.cycles}`,
      statusName: `Runde ${cycle} av ${settings.cycles} - Løp`,
      prompt: 'Begynn å løpe',
      detail: `Løp i ${formatDuration(settings.runSeconds)}`,
      durationMs: settings.runSeconds * 1000,
    })

    phases.push({
      key: `walk-${cycle}`,
      name: `Gå ${cycle} av ${settings.cycles}`,
      statusName: `Runde ${cycle} av ${settings.cycles} - Gå`,
      prompt: 'Begynn å gå',
      detail: `Gå i ${formatDuration(settings.walkSeconds)}`,
      durationMs: settings.walkSeconds * 1000,
    })
  }

  if (cooldownSeconds > 0) {
    phases.push({
      key: 'cooldown',
      name: 'Nedtrapping',
      statusName: 'Nedtrapping - Gå',
      prompt: 'Begynn å gå',
      detail: `Gå i ${formatDuration(cooldownSeconds)}`,
      durationMs: cooldownSeconds * 1000,
    })
  }

  return phases
}

function App() {
  const [settings, setSettings] = useState(readSavedSettings)
  const [draftSettings, setDraftSettings] = useState(() => settingsToDraft(readSavedSettings()))
  const [status, setStatus] = useState(STATUS.IDLE)
  const [session, setSession] = useState([])
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0)
  const [remainingMs, setRemainingMs] = useState(0)
  const [speechEnabled] = useState(supportsSpeech)

  const intervalRef = useRef(null)
  const statusRef = useRef(STATUS.IDLE)
  const speechEnabledRef = useRef(false)
  const sessionRef = useRef([])
  const phaseIndexRef = useRef(0)
  const phaseEndRef = useRef(0)
  const pausedRemainingRef = useRef(0)
  const lastCountdownCueRef = useRef('')

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

  const sessionSummary = useMemo(() => buildSession(settings), [settings])
  const totalDurationSeconds = useMemo(
    () => Math.round(sessionSummary.reduce((sum, phase) => sum + phase.durationMs, 0) / 1000),
    [sessionSummary],
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

    // Advance through any phases that elapsed while the page was backgrounded.
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
      setCurrentPhaseIndex(phaseIndex)
      speak(sessionRef.current[phaseIndex].prompt)
    }

    const remainingSeconds = Math.max(0, Math.ceil((phaseEndRef.current - now) / 1000))
    const hasUpcomingPhase = phaseIndexRef.current < sessionRef.current.length - 1

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
    // Recalculate immediately when the page becomes active again so the timer stays accurate.
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

  function commitDraftSettings() {
    const nextSettings = sanitizeSettings(draftSettings)
    setSettings(nextSettings)
    return nextSettings
  }

  function startSession() {
    const nextSettings = commitDraftSettings()
    const nextSession = buildSession(nextSettings)

    if (!nextSession.length) {
      return
    }

    clearTicker()
    sessionRef.current = nextSession
    phaseIndexRef.current = 0
    pausedRemainingRef.current = 0
    lastCountdownCueRef.current = ''
    phaseEndRef.current = Date.now() + nextSession[0].durationMs
    statusRef.current = STATUS.RUNNING

    setSession(nextSession)
    setCurrentPhaseIndex(0)
    setRemainingMs(nextSession[0].durationMs)
    setStatus(STATUS.RUNNING)
    speak(nextSession[0].prompt)
    startTicker()
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
    clearTicker()
    statusRef.current = STATUS.IDLE
    sessionRef.current = []
    phaseIndexRef.current = 0
    phaseEndRef.current = 0
    pausedRemainingRef.current = 0
    lastCountdownCueRef.current = ''
    setSession([])
    setCurrentPhaseIndex(0)
    setRemainingMs(0)
    setStatus(STATUS.IDLE)

    if (speechEnabled) {
      window.speechSynthesis.cancel()
    }
  }

  function handleSettingChange(key, value) {
    setDraftSettings((current) => ({ ...current, [key]: value }))
  }

  function handleSettingBlur() {
    commitDraftSettings()
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">RunWalk Buddy</p>
        <h1>Gåing og løping</h1>
        <p className="intro">
          Trykk start, legg bort mobilen og følg stemmebeskjedene.
        </p>

        <div className="status-panel" aria-live="polite">
          <p className="status-label">
            {status === STATUS.IDLE && 'Klar til start'}
            {status === STATUS.RUNNING && (activePhase?.statusName ?? activePhase?.name)}
            {status === STATUS.PAUSED && `Pauset under ${activePhase?.statusName ?? activePhase?.name ?? 'økt'}`}
            {status === STATUS.COMPLETE && 'Økten er ferdig'}
          </p>

          <p className="countdown">
            {status === STATUS.IDLE ? formatClock(totalDurationSeconds) : formatClock(remainingMs / 1000)}
          </p>

          <p className="phase-detail">
            {status === STATUS.IDLE && `Nybegynnerøkten varer i ${formatDuration(totalDurationSeconds)}`}
            {status !== STATUS.IDLE && activePhase?.detail}
          </p>

          <div className="progress-row" aria-hidden="true">
            <div className="progress-bar">
              <span style={{ width: `${progressPercent}%` }}></span>
            </div>
            <span>{progressPercent}%</span>
          </div>

          {nextPhase && status !== STATUS.IDLE && status !== STATUS.COMPLETE && (
            <p className="next-up">Neste: {nextPhase.name}</p>
          )}
        </div>

        <div className="primary-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={startSession}
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
