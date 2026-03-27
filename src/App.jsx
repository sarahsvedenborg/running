import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const STORAGE_KEY = 'runwalk-buddy-settings'
const PROGRESS_STORAGE_KEY = 'runwalk-buddy-progress'

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

function repeatedRuns(count, runBuilder) {
  return Array.from({ length: count }, (_, index) => runBuilder(index + 1))
}

function getRunId(planKey, weekNumber, runIndex) {
  return `${planKey}:${weekNumber}:${runIndex}`
}

/*
  Plans are stored as plan -> weeks -> runs so the selectors can stay simple and
  the timer can start any exact run in the training program.
*/
const plans = {
  preBeginner: {
    name: 'Pre-Beginner Plan',
    weeks: [
      {
        week: 1,
        runs: repeatedRuns(3, () => ({
          warmup: 300,
          intervals: Array.from({ length: 6 }, () => ({ run: 20, walk: 180 })),
          cooldown: 300,
        })),
      },
      {
        week: 2,
        runs: repeatedRuns(3, () => ({
          warmup: 300,
          intervals: Array.from({ length: 7 }, () => ({ run: 25, walk: 150 })),
          cooldown: 300,
        })),
      },
      {
        week: 3,
        runs: repeatedRuns(3, () => ({
          warmup: 300,
          intervals: Array.from({ length: 8 }, () => ({ run: 30, walk: 120 })),
          cooldown: 300,
        })),
      },
    ],
  },
  couchTo5k: {
    name: 'Couch to 5K',
    weeks: [
      {
        week: 1,
        runs: repeatedRuns(3, () => ({
          warmup: 300,
          intervals: Array.from({ length: 8 }, () => ({ run: 60, walk: 90 })),
          cooldown: 300,
        })),
      },
      {
        week: 2,
        runs: repeatedRuns(3, () => ({
          warmup: 300,
          intervals: Array.from({ length: 6 }, () => ({ run: 90, walk: 120 })),
          cooldown: 300,
        })),
      },
      {
        week: 3,
        runs: repeatedRuns(3, () => ({
          warmup: 300,
          intervals: [
            { run: 90, walk: 90 },
            { run: 90, walk: 90 },
            { run: 180, walk: 180 },
            { run: 180, walk: 180 },
          ],
          cooldown: 300,
        })),
      },
      {
        week: 4,
        runs: repeatedRuns(3, () => ({
          warmup: 300,
          intervals: [
            { run: 180, walk: 90 },
            { run: 300, walk: 150 },
            { run: 180, walk: 90 },
            { run: 300, walk: 150 },
          ],
          cooldown: 300,
        })),
      },
      {
        week: 5,
        runs: [
          {
            warmup: 300,
            intervals: [
              { run: 300, walk: 180 },
              { run: 300, walk: 180 },
              { run: 300 },
            ],
            cooldown: 300,
          },
          {
            warmup: 300,
            intervals: [
              { run: 480, walk: 300 },
              { run: 480 },
            ],
            cooldown: 300,
          },
          {
            warmup: 300,
            continuousRun: 1200,
            cooldown: 300,
          },
        ],
      },
      {
        week: 6,
        runs: [
          {
            warmup: 300,
            intervals: [
              { run: 300, walk: 180 },
              { run: 300, walk: 180 },
            ],
            cooldown: 300,
          },
          {
            warmup: 300,
            intervals: [
              { run: 600, walk: 180 },
              { run: 600 },
            ],
            cooldown: 300,
          },
          {
            warmup: 300,
            continuousRun: 1500,
            cooldown: 300,
          },
        ],
      },
      {
        week: 7,
        runs: repeatedRuns(3, () => ({
          warmup: 300,
          continuousRun: 1500,
          cooldown: 300,
        })),
      },
      {
        week: 8,
        runs: repeatedRuns(3, () => ({
          warmup: 300,
          continuousRun: 1680,
          cooldown: 300,
        })),
      },
      {
        week: 9,
        runs: repeatedRuns(3, () => ({
          warmup: 300,
          continuousRun: 1800,
          cooldown: 300,
        })),
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

function readSavedProgress() {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(PROGRESS_STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function sanitizeSettings(settings) {
  return {
    runSeconds: clampNumber(settings.runSeconds, 5, 1800, DEFAULT_SETTINGS.runSeconds),
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
    return `${seconds / 60} min`
  }

  if (seconds > 60) {
    const minutes = Math.floor(seconds / 60)
    const remainder = seconds % 60
    return `${minutes} min ${remainder} sek`
  }

  return `${seconds} sek`
}

function countdownPrompt(seconds) {
  if (seconds === 3) return 'Tre'
  if (seconds === 2) return 'To'
  return 'En'
}

function phasePrompt(kind) {
  return kind === PHASE_KIND.RUN ? 'Begynn å løpe' : 'Begynn å gå'
}

function phaseSummaryLabel(kind) {
  return kind === PHASE_KIND.RUN ? 'Løping' : 'Gåing'
}

function describePhase(kind, cycleIndex, totalCycles) {
  if (!cycleIndex || !totalCycles) {
    return phaseSummaryLabel(kind)
  }

  return `${phaseSummaryLabel(kind)} ${cycleIndex} av ${totalCycles}`
}

function addPhase(
  phases,
  { key, kind, durationSeconds, label, detail, announceHalfway = false, cycleIndex = null, totalCycles = null },
) {
  if (!durationSeconds || durationSeconds <= 0) {
    return
  }

  phases.push({
    key,
    kind,
    name: label,
    statusName: describePhase(kind, cycleIndex, totalCycles),
    prompt: phasePrompt(kind),
    detail,
    durationMs: durationSeconds * 1000,
    halfwayPrompt: announceHalfway && durationSeconds > 600 ? 'Du er halvveis' : null,
  })
}

/*
  The session engine flattens any run definition into timed phases. It handles
  interval arrays, intervals where the last run has no walk, and continuous runs
  using the same timer and audio flow.
*/
function buildSessionFromRun(runDefinition) {
  const phases = []
  const totalCycles = runDefinition.intervals?.filter((interval) => interval.run).length ?? null

  addPhase(phases, {
    key: 'warmup',
    kind: PHASE_KIND.WALK,
    durationSeconds: runDefinition.warmup,
    label: 'Oppvarming',
    detail: `Gå i ${formatDuration(runDefinition.warmup)}`,
  })

  if (runDefinition.continuousRun) {
    addPhase(phases, {
      key: 'continuous-run',
      kind: PHASE_KIND.RUN,
      durationSeconds: runDefinition.continuousRun,
      label: 'Løping',
      detail: `Løp i ${formatDuration(runDefinition.continuousRun)}`,
      announceHalfway: true,
    })
  }

  if (runDefinition.intervals?.length) {
    runDefinition.intervals.forEach((interval, index) => {
      addPhase(phases, {
        key: `run-${index + 1}`,
        kind: PHASE_KIND.RUN,
        durationSeconds: interval.run,
        label: `Løp ${index + 1}`,
        detail: `Løp i ${formatDuration(interval.run)}`,
        announceHalfway: true,
        cycleIndex: index + 1,
        totalCycles,
      })

      addPhase(phases, {
        key: `walk-${index + 1}`,
        kind: PHASE_KIND.WALK,
        durationSeconds: interval.walk,
        label: `Gå ${index + 1}`,
        detail: `Gå i ${formatDuration(interval.walk)}`,
        cycleIndex: interval.walk ? index + 1 : null,
        totalCycles,
      })
    })
  }

  addPhase(phases, {
    key: 'cooldown',
    kind: PHASE_KIND.WALK,
    durationSeconds: runDefinition.cooldown,
    label: 'Nedtrapping',
    detail: `Gå i ${formatDuration(runDefinition.cooldown)}`,
  })

  return phases
}

function buildSessionFromSettings(settings) {
  return buildSessionFromRun({
    warmup: Math.round(settings.warmupMinutes * 60),
    intervals: Array.from({ length: settings.cycles }, () => ({
      run: settings.runSeconds,
      walk: settings.walkSeconds,
    })),
    cooldown: Math.round(settings.cooldownMinutes * 60),
  })
}

function settingsFromRun(runDefinition) {
  const firstInterval = runDefinition.intervals?.[0]
  const intervalCount = runDefinition.intervals?.filter((interval) => interval.run).length ?? 0

  return sanitizeSettings({
    runSeconds: runDefinition.continuousRun ?? firstInterval?.run ?? DEFAULT_SETTINGS.runSeconds,
    walkSeconds:
      runDefinition.intervals?.find((interval) => interval.walk)?.walk ?? DEFAULT_SETTINGS.walkSeconds,
    cycles: intervalCount || 1,
    warmupMinutes: (runDefinition.warmup ?? 0) / 60,
    cooldownMinutes: (runDefinition.cooldown ?? 0) / 60,
  })
}

function flattenWeekOptions() {
  return [
    {
      value: 'custom:custom',
      planKey: 'custom',
      week: { week: 'custom', runs: [{ custom: true }] },
      planName: 'Custom',
      label: 'Custom',
    },
    ...Object.entries(plans).flatMap(([planKey, plan]) =>
      plan.weeks.map((week) => ({
        value: `${planKey}:${week.week}`,
        planKey,
        week,
        planName: plan.name,
        label: planKey === 'preBeginner' ? `Pre-week ${week.week}` : `Week ${week.week}`,
      })),
    ),
  ]
}

function flattenRunOptions() {
  return Object.entries(plans).flatMap(([planKey, plan]) =>
    plan.weeks.flatMap((week) =>
      week.runs.map((run, runIndex) => ({
        runId: getRunId(planKey, week.week, runIndex),
        weekOptionValue: `${planKey}:${week.week}`,
        planKey,
        planName: plan.name,
        weekNumber: week.week,
        weekLabel: planKey === 'preBeginner' ? `Pre-week ${week.week}` : `Week ${week.week}`,
        runIndex,
        runLabel: `Run ${runIndex + 1}`,
        run,
      })),
    ),
  )
}

const weekOptionsData = flattenWeekOptions()
const runOptionsData = flattenRunOptions()

function getRecommendedRunOption(progress) {
  const nextRun = runOptionsData.find((option) => !progress[option.runId])
  return nextRun ?? runOptionsData[runOptionsData.length - 1]
}

function isWeekCompleted(progress, planKey, weekNumber) {
  const weekRuns = runOptionsData.filter(
    (option) => option.planKey === planKey && option.weekNumber === weekNumber,
  )

  return weekRuns.length > 0 && weekRuns.every((option) => progress[option.runId])
}

function getEventStartTime() {
  return Date.now()
}

function App() {
  const [settings, setSettings] = useState(readSavedSettings)
  const [draftSettings, setDraftSettings] = useState(() => settingsToDraft(readSavedSettings()))
  const [progress, setProgress] = useState(readSavedProgress)
  const [selectedWeekOptionValue, setSelectedWeekOptionValue] = useState('')
  const [selectedRunValue, setSelectedRunValue] = useState('')
  const [status, setStatus] = useState(STATUS.IDLE)
  const [session, setSession] = useState([])
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0)
  const [remainingMs, setRemainingMs] = useState(0)
  const [speechEnabled] = useState(supportsSpeech)
  const [sessionTitle, setSessionTitle] = useState('Nybegynnerøkt')
  const [activeRunMeta, setActiveRunMeta] = useState(null)
  const [installPromptEvent, setInstallPromptEvent] = useState(null)
  const [isInstalled, setIsInstalled] = useState(false)

  const intervalRef = useRef(null)
  const statusRef = useRef(STATUS.IDLE)
  const speechEnabledRef = useRef(false)
  const activeRunMetaRef = useRef(null)
  const speechTimeoutRef = useRef(null)
  const voicesRef = useRef([])
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
    if (!speechEnabled) {
      return undefined
    }

    const updateVoices = () => {
      voicesRef.current = window.speechSynthesis.getVoices()
    }

    updateVoices()
    window.speechSynthesis.addEventListener('voiceschanged', updateVoices)

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', updateVoices)
    }
  }, [speechEnabled])

  useEffect(() => {
    activeRunMetaRef.current = activeRunMeta
  }, [activeRunMeta])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    }
  }, [settings])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress))
    }
  }, [progress])

  useEffect(() => {
    setDraftSettings(settingsToDraft(settings))
  }, [settings])

  useEffect(() => {
    const standaloneMatch = window.matchMedia('(display-mode: standalone)')
    const handleInstalled = () => {
      setIsInstalled(true)
      setInstallPromptEvent(null)
    }
    const handleBeforeInstall = (event) => {
      event.preventDefault()
      setInstallPromptEvent(event)
    }

    setIsInstalled(standaloneMatch.matches || window.navigator.standalone === true)
    standaloneMatch.addEventListener('change', handleInstalled)
    window.addEventListener('beforeinstallprompt', handleBeforeInstall)
    window.addEventListener('appinstalled', handleInstalled)

    return () => {
      standaloneMatch.removeEventListener('change', handleInstalled)
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  useEffect(() => {
    if (selectedWeekOptionValue && selectedRunValue !== '') {
      return
    }

    const recommendedRun = getRecommendedRunOption(progress)

    if (!recommendedRun) {
      return
    }

    setSelectedWeekOptionValue(recommendedRun.weekOptionValue)
    setSelectedRunValue(String(recommendedRun.runIndex))

    const recommendedSettings = settingsFromRun(recommendedRun.run)
    setSettings(recommendedSettings)
    setDraftSettings(settingsToDraft(recommendedSettings))
  }, [progress, selectedRunValue, selectedWeekOptionValue])

  const weekOptions = useMemo(() => weekOptionsData, [])
  const runOptions = useMemo(() => runOptionsData, [])
  const selectedWeekOption = useMemo(
    () => weekOptions.find((option) => option.value === selectedWeekOptionValue) ?? null,
    [selectedWeekOptionValue, weekOptions],
  )
  const selectedPlan = selectedWeekOption ? plans[selectedWeekOption.planKey] : null
  const selectedWeek = selectedWeekOption?.week ?? null
  const isCustomSelection = selectedWeekOption?.planKey === 'custom'
  const currentWeekRunOptions = useMemo(
    () =>
      isCustomSelection
        ? [
            {
              runId: 'custom:custom:0',
              weekOptionValue: 'custom:custom',
              planKey: 'custom',
              planName: 'Custom',
              weekNumber: 'custom',
              weekLabel: 'Custom',
              runIndex: 0,
              runLabel: 'Custom',
              run: null,
            },
          ]
        : runOptions.filter((option) => option.weekOptionValue === selectedWeekOptionValue),
    [isCustomSelection, runOptions, selectedWeekOptionValue],
  )
  const selectedRun = useMemo(() => {
    if (isCustomSelection) {
      return { custom: true }
    }

    if (selectedWeek && selectedRunValue !== '') {
      return selectedWeek.runs[Number(selectedRunValue)] ?? null
    }

    return null
  }, [isCustomSelection, selectedRunValue, selectedWeek])
  const completedRunsCount = useMemo(
    () => runOptions.filter((option) => progress[option.runId]).length,
    [progress, runOptions],
  )
  const totalRunsCount = runOptions.length
  const trainingProgressPercent = totalRunsCount
    ? Math.round((completedRunsCount / totalRunsCount) * 100)
    : 0

  const customSessionSummary = useMemo(() => buildSessionFromSettings(settings), [settings])
  const customTotalDurationSeconds = useMemo(
    () => Math.round(customSessionSummary.reduce((sum, phase) => sum + phase.durationMs, 0) / 1000),
    [customSessionSummary],
  )
  const selectedRunSessionSummary = useMemo(
    () => (selectedRun ? buildSessionFromRun(selectedRun) : []),
    [selectedRun],
  )
  const selectedRunTotalDurationSeconds = useMemo(
    () => Math.round(selectedRunSessionSummary.reduce((sum, phase) => sum + phase.durationMs, 0) / 1000),
    [selectedRunSessionSummary],
  )
  const idlePreviewTotalDurationSeconds = selectedRun
    ? isCustomSelection
      ? customTotalDurationSeconds
      : selectedRunTotalDurationSeconds
    : customTotalDurationSeconds
  const idlePreviewTitle = selectedRun
    ? isCustomSelection
      ? 'Custom'
      : `${selectedWeekOption?.label} Run ${Number(selectedRunValue) + 1}`
    : 'Nybegynnerøkt'

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

    if (speechTimeoutRef.current) {
      window.clearTimeout(speechTimeoutRef.current)
      speechTimeoutRef.current = null
    }

    const utterance = new window.SpeechSynthesisUtterance(text)
    utterance.rate = 1
    utterance.pitch = 1
    utterance.volume = 1
    utterance.lang = 'nb-NO'

    const norwegianVoice = voicesRef.current.find(
      (voice) => voice.lang === 'nb-NO' || voice.lang === 'nn-NO' || voice.lang.startsWith('no'),
    )

    if (norwegianVoice) {
      utterance.voice = norwegianVoice
    }

    const speakNow = () => {
      window.speechSynthesis.resume()
      window.speechSynthesis.speak(utterance)
    }

    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel()
      speechTimeoutRef.current = window.setTimeout(() => {
        speakNow()
        speechTimeoutRef.current = null
      }, 60)
      return
    }

    speakNow()
  }, [])

  const finishSession = useCallback(() => {
    clearTicker()
    setStatus(STATUS.COMPLETE)
    statusRef.current = STATUS.COMPLETE
    setRemainingMs(0)
    pausedRemainingRef.current = 0

    if (activeRunMetaRef.current) {
      setProgress((current) => ({
        ...current,
        [getRunId(
          activeRunMetaRef.current.planKey,
          activeRunMetaRef.current.weekNumber,
          activeRunMetaRef.current.runIndex,
        )]: true,
      }))
    }

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

      if (speechTimeoutRef.current) {
        window.clearTimeout(speechTimeoutRef.current)
        speechTimeoutRef.current = null
      }

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
    activeRunMetaRef.current = null
    setActiveRunMeta(null)
    setStatus(nextStatus)

    if (speechEnabled) {
      if (speechTimeoutRef.current) {
        window.clearTimeout(speechTimeoutRef.current)
        speechTimeoutRef.current = null
      }

      window.speechSynthesis.cancel()
    }
  }

  function commitDraftSettings() {
    const nextSettings = sanitizeSettings(draftSettings)
    setSettings(nextSettings)
    return nextSettings
  }

  function beginSession(nextSession, title, startTime, runMeta = null) {
    if (!nextSession.length) {
      return
    }

    clearTicker()
    sessionRef.current = nextSession
    phaseIndexRef.current = 0
    pausedRemainingRef.current = 0
    lastCountdownCueRef.current = ''
    lastHalfwayCueRef.current = ''
    phaseEndRef.current = startTime + nextSession[0].durationMs
    statusRef.current = STATUS.RUNNING

    setSession(nextSession)
    setSessionTitle(title)
    activeRunMetaRef.current = runMeta
    setActiveRunMeta(runMeta)
    setCurrentPhaseIndex(0)
    setRemainingMs(nextSession[0].durationMs)
    setStatus(STATUS.RUNNING)
    speak(nextSession[0].prompt)
    startTicker()
  }

  function startCustomSession(event) {
    const nextSettings = commitDraftSettings()
    beginSession(buildSessionFromSettings(nextSettings), 'Nybegynnerøkt', getEventStartTime(event))
  }

  function startSelectedRun(event) {
    if (isCustomSelection) {
      startCustomSession(event)
      return
    }

    if (!selectedPlan || !selectedWeek || !selectedRun) {
      return
    }

    const runNumber = Number(selectedRunValue) + 1
    beginSession(
      buildSessionFromRun(selectedRun),
      `${selectedPlan.name} - ${selectedWeekOption.label} Løp ${runNumber}`,
      getEventStartTime(event),
      {
        planKey: selectedWeekOption.planKey,
        weekNumber: selectedWeek.week,
        runIndex: Number(selectedRunValue),
      },
    )
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
      if (speechTimeoutRef.current) {
        window.clearTimeout(speechTimeoutRef.current)
        speechTimeoutRef.current = null
      }

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

  function handleWeekOptionChange(event) {
    const nextWeekValue = event.target.value
    setSelectedWeekOptionValue(nextWeekValue)

    if (nextWeekValue === 'custom:custom') {
      setSelectedRunValue('0')
      setSessionTitle('Nybegynnerøkt')
      resetSessionState(STATUS.IDLE)
      return
    }

    const nextWeekRuns = runOptions.filter((option) => option.weekOptionValue === nextWeekValue)
    const recommendedRun = nextWeekRuns.find((option) => !progress[option.runId]) ?? nextWeekRuns[0]

    if (recommendedRun) {
      setSelectedRunValue(String(recommendedRun.runIndex))
      const nextSettings = settingsFromRun(recommendedRun.run)
      setSettings(nextSettings)
      setDraftSettings(settingsToDraft(nextSettings))
    } else {
      setSelectedRunValue('0')
    }

    setSessionTitle('Nybegynnerøkt')
    resetSessionState(STATUS.IDLE)
  }

  function handleRunChange(event) {
    const nextRunValue = event.target.value
    setSelectedRunValue(nextRunValue)

    if (isCustomSelection) {
      setSessionTitle('Nybegynnerøkt')
      resetSessionState(STATUS.IDLE)
      return
    }

    if (selectedWeek && nextRunValue !== '') {
      const nextRun = selectedWeek.runs[Number(nextRunValue)]
      const nextSettings = settingsFromRun(nextRun)
      setSettings(nextSettings)
      setDraftSettings(settingsToDraft(nextSettings))
    }

    setSessionTitle('Nybegynnerøkt')
    resetSessionState(STATUS.IDLE)
  }

  function disconnectPlanSelection() {
    const recommendedRun = getRecommendedRunOption(progress)
    setSelectedWeekOptionValue(recommendedRun?.weekOptionValue ?? 'preBeginner:1')
    setSelectedRunValue(recommendedRun ? String(recommendedRun.runIndex) : '0')

    if (recommendedRun) {
      const nextSettings = settingsFromRun(recommendedRun.run)
      setSettings(nextSettings)
      setDraftSettings(settingsToDraft(nextSettings))
    }

    setSessionTitle('Nybegynnerøkt')
    resetSessionState(STATUS.IDLE)
  }

  async function handleInstallApp() {
    if (!installPromptEvent) {
      return
    }

    await installPromptEvent.prompt()
    await installPromptEvent.userChoice
    setInstallPromptEvent(null)
  }

  return (
    <main className="app-shell">
      {!isInstalled && installPromptEvent && (
        <div className="install-banner">
          <button type="button" className="button button-install" onClick={handleInstallApp}>
            Installer app
          </button>
        </div>
      )}

      <section className="hero-card">
        <p className="eyebrow">RunWalk Buddy</p>
        <h1>Gåing og løping</h1>
        <p className="intro">Velg uke og løp. Legg så bort mobilen og følg stemmen.</p>

        <section className="plan-card">
          <h2>Treningsplan</h2>
          <div className="plan-progress-block" aria-hidden="true">
            <div className="plan-progress-copy">
              <span>Fremdrift</span>
              <strong>
                {completedRunsCount} av {totalRunsCount} løp fullført
              </strong>
            </div>
            <div className="plan-progress-bar">
              <span style={{ width: `${trainingProgressPercent}%` }}></span>
            </div>
          </div>

          <div className="plan-grid">
            <label>
              <span>Uke</span>
              <select value={selectedWeekOptionValue} onChange={handleWeekOptionChange}>
                <option value="">Velg uke</option>
                {weekOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Løp</span>
              <select value={selectedRunValue} onChange={handleRunChange} disabled={!selectedWeek}>
                {currentWeekRunOptions.map((option) => (
                  <option key={option.runId} value={String(option.runIndex)}>
                    {option.runLabel}
                    {!isCustomSelection && progress[option.runId] ? ' ✓' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {selectedRun && (
            <p className="plan-summary">
              {isCustomSelection
                ? 'Custom - Run 1'
                : `${selectedPlan?.name} - ${selectedWeekOption?.label} Run ${Number(selectedRunValue) + 1}`}
              {!isCustomSelection && selectedWeekOption && isWeekCompleted(progress, selectedWeekOption.planKey, selectedWeek.week)
                ? ' - Uken er fullført'
                : ''}
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

          <p className="session-title">{status === STATUS.IDLE ? idlePreviewTitle : sessionTitle}</p>

          <p className="countdown">
            {status === STATUS.IDLE
              ? formatClock(idlePreviewTotalDurationSeconds)
              : formatClock(remainingMs / 1000)}
          </p>

          <p className="phase-detail">
            {status === STATUS.IDLE &&
              `${selectedRun ? 'Valgt løp' : 'Standardøkt'} varer i ${formatDuration(idlePreviewTotalDurationSeconds)}`}
            {status !== STATUS.IDLE && activePhase?.detail}
          </p>

          <div className="progress-row" aria-hidden="true">
            <div className="progress-bar">
              <span style={{ width: `${progressPercent}%` }}></span>
            </div>
            <span>{progressPercent}%</span>
          </div>

          {nextPhase && status !== STATUS.IDLE && status !== STATUS.COMPLETE && (
            <p className="next-up">Neste: {nextPhase.statusName ?? phaseSummaryLabel(nextPhase.kind)}</p>
          )}
        </div>

        <div className="primary-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={selectedRun ? startSelectedRun : startCustomSession}
            disabled={status === STATUS.RUNNING || (selectedWeekOptionValue !== '' && !selectedRun)}
          >
            {selectedRun ? (isCustomSelection ? 'Start custom' : 'Start valgt løp') : 'Start nybegynnerøkt'}
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

      <details className={`settings-card${selectedRun && !isCustomSelection ? ' settings-card-planned' : ''}`}>
        <summary>Egne innstillinger</summary>
        <p className="settings-copy">Endre tidene før du starter en økt.</p>
        {selectedRun && !isCustomSelection && (
          <div className="settings-plan-row">
            <p className="settings-plan-note">
              Synkronisert fra {selectedPlan?.name} - {selectedWeekOption?.label}{' '}
              Run {Number(selectedRunValue) + 1}
            </p>
            <button
              type="button"
              className="button button-chip"
              onClick={disconnectPlanSelection}
            >
              Koble fra plan
            </button>
          </div>
        )}

        <div className="settings-grid">
          <label>
            <span>Løpetid i sekunder</span>
            <input
              type="number"
              min="5"
              max="1800"
              step="5"
              value={draftSettings.runSeconds}
              readOnly={Boolean(selectedRun) && !isCustomSelection}
              disabled={Boolean(selectedRun) && !isCustomSelection}
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
              readOnly={Boolean(selectedRun) && !isCustomSelection}
              disabled={Boolean(selectedRun) && !isCustomSelection}
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
              readOnly={Boolean(selectedRun) && !isCustomSelection}
              disabled={Boolean(selectedRun) && !isCustomSelection}
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
              readOnly={Boolean(selectedRun) && !isCustomSelection}
              disabled={Boolean(selectedRun) && !isCustomSelection}
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
              readOnly={Boolean(selectedRun) && !isCustomSelection}
              disabled={Boolean(selectedRun) && !isCustomSelection}
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
