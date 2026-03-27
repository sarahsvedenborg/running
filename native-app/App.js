import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AppState,
  Alert,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Picker } from '@react-native-picker/picker'
import { Audio } from 'expo-av'
import * as Haptics from 'expo-haptics'
import * as Notifications from 'expo-notifications'
import * as Speech from 'expo-speech'

const STORAGE_KEY = 'runwalk-buddy-native-settings'
const PROGRESS_STORAGE_KEY = 'runwalk-buddy-native-progress'
const SESSION_STATE_KEY = 'runwalk-buddy-native-session'
const SHOW_DEV_TEST_WEEK = __DEV__

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
  The plan data mirrors the web version so all training content survives the move
  to React Native without simplification.
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

const devTestWeek = {
  week: 'test',
  runs: [
    {
      warmup: 30,
      intervals: Array.from({ length: 3 }, () => ({ run: 20, walk: 20 })),
      cooldown: 30,
    },
  ],
}

function clampNumber(value, min, max, fallback, integer = false) {
  const parsed = integer ? parseInt(value, 10) : parseFloat(value)
  if (Number.isNaN(parsed)) return fallback
  const safeValue = Math.min(max, Math.max(min, parsed))
  return integer ? Math.round(safeValue) : safeValue
}

function sanitizeSettings(settings) {
  return {
    runSeconds: clampNumber(settings.runSeconds, 5, 1800, DEFAULT_SETTINGS.runSeconds),
    walkSeconds: clampNumber(settings.walkSeconds, 10, 1800, DEFAULT_SETTINGS.walkSeconds),
    cycles: clampNumber(settings.cycles, 1, 20, DEFAULT_SETTINGS.cycles, true),
    warmupMinutes: clampNumber(settings.warmupMinutes, 0, 30, DEFAULT_SETTINGS.warmupMinutes),
    cooldownMinutes: clampNumber(settings.cooldownMinutes, 0, 30, DEFAULT_SETTINGS.cooldownMinutes),
  }
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

function formatClock(totalSeconds) {
  const safeSeconds = Math.max(0, Math.ceil(totalSeconds))
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function formatDuration(seconds) {
  if (seconds % 60 === 0) return `${seconds / 60} min`
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
  if (!cycleIndex || !totalCycles) return phaseSummaryLabel(kind)
  return `${phaseSummaryLabel(kind)} ${cycleIndex} av ${totalCycles}`
}

function addPhase(
  phases,
  { key, kind, durationSeconds, label, detail, announceHalfway = false, cycleIndex = null, totalCycles = null },
) {
  if (!durationSeconds || durationSeconds <= 0) return

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
  A run becomes one flat list of phases. The same timer engine can then handle
  warm-up, repeat intervals, mixed intervals, and long continuous runs.
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
    walkSeconds: runDefinition.intervals?.find((interval) => interval.walk)?.walk ?? DEFAULT_SETTINGS.walkSeconds,
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
    ...(SHOW_DEV_TEST_WEEK
      ? [
          {
            value: 'test:test',
            planKey: 'test',
            week: devTestWeek,
            planName: 'Test',
            label: 'Test',
          },
        ]
      : []),
  ]
}

function flattenRunOptions() {
  return [
    ...Object.entries(plans).flatMap(([planKey, plan]) =>
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
    ),
    ...(SHOW_DEV_TEST_WEEK
      ? [
          {
            runId: getRunId('test', 'test', 0),
            weekOptionValue: 'test:test',
            planKey: 'test',
            planName: 'Test',
            weekNumber: 'test',
            weekLabel: 'Test',
            runIndex: 0,
            runLabel: 'Run 1',
            run: devTestWeek.runs[0],
          },
        ]
      : []),
  ]
}

const weekOptionsData = flattenWeekOptions()
const runOptionsData = flattenRunOptions()

function getRecommendedRunOption(progress) {
  const nextRun = runOptionsData.find((option) => !progress[option.runId] && option.planKey !== 'test')
  return nextRun ?? runOptionsData.find((option) => option.planKey !== 'test') ?? runOptionsData[0]
}

function isWeekCompleted(progress, planKey, weekNumber) {
  const weekRuns = runOptionsData.filter(
    (option) => option.planKey === planKey && option.weekNumber === weekNumber,
  )
  return weekRuns.length > 0 && weekRuns.every((option) => progress[option.runId])
}

async function loadJsonValue(key, fallback) {
  try {
    const raw = await AsyncStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

async function saveJsonValue(key, value) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Best effort local persistence.
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

export default function App() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [draftSettings, setDraftSettings] = useState(settingsToDraft(DEFAULT_SETTINGS))
  const [progress, setProgress] = useState({})
  const [selectedWeekOptionValue, setSelectedWeekOptionValue] = useState('')
  const [selectedRunValue, setSelectedRunValue] = useState('')
  const [status, setStatus] = useState(STATUS.IDLE)
  const [session, setSession] = useState([])
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(0)
  const [remainingMs, setRemainingMs] = useState(0)
  const [sessionTitle, setSessionTitle] = useState('Nybegynnerøkt')
  const [activeRunMeta, setActiveRunMeta] = useState(null)
  const [isReady, setIsReady] = useState(false)

  const appStateRef = useRef(AppState.currentState)
  const intervalRef = useRef(null)
  const statusRef = useRef(STATUS.IDLE)
  const sessionRef = useRef([])
  const phaseIndexRef = useRef(0)
  const phaseEndRef = useRef(0)
  const pausedRemainingRef = useRef(0)
  const lastCountdownCueRef = useRef('')
  const lastHalfwayCueRef = useRef('')
  const activeRunMetaRef = useRef(null)

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    activeRunMetaRef.current = activeRunMeta
  }, [activeRunMeta])

  useEffect(() => {
    ;(async () => {
      await Audio.setAudioModeAsync({
        staysActiveInBackground: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false,
        interruptionModeIOS: 1,
        interruptionModeAndroid: 1,
        playThroughEarpieceAndroid: false,
      })

      const storedSettings = sanitizeSettings(await loadJsonValue(STORAGE_KEY, DEFAULT_SETTINGS))
      const storedProgress = await loadJsonValue(PROGRESS_STORAGE_KEY, {})
      const restoredSession = await loadJsonValue(SESSION_STATE_KEY, null)
      const recommendedRun = getRecommendedRunOption(storedProgress)

      setSettings(storedSettings)
      setDraftSettings(settingsToDraft(storedSettings))
      setProgress(storedProgress)

      if (restoredSession?.active) {
        restoreActiveSession(restoredSession)
      } else if (recommendedRun) {
        setSelectedWeekOptionValue(recommendedRun.weekOptionValue)
        setSelectedRunValue(String(recommendedRun.runIndex))
        const recommendedSettings = settingsFromRun(recommendedRun.run)
        setSettings(recommendedSettings)
        setDraftSettings(settingsToDraft(recommendedSettings))
      }

      setIsReady(true)
    })()
  }, [])

  useEffect(() => {
    if (!isReady) return
    saveJsonValue(STORAGE_KEY, settings)
  }, [isReady, settings])

  useEffect(() => {
    if (!isReady) return
    saveJsonValue(PROGRESS_STORAGE_KEY, progress)
  }, [isReady, progress])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      appStateRef.current = nextState
      if (nextState === 'active') {
        syncTimer()
      }
    })

    return () => {
      subscription.remove()
      clearTicker()
      Speech.stop()
    }
  })

  const weekOptions = useMemo(() => weekOptionsData, [])
  const runOptions = useMemo(() => runOptionsData, [])
  const selectedWeekOption = useMemo(
    () => weekOptions.find((option) => option.value === selectedWeekOptionValue) ?? null,
    [selectedWeekOptionValue, weekOptions],
  )
  const selectedPlan = selectedWeekOption
    ? plans[selectedWeekOption.planKey] ?? { name: selectedWeekOption.planName }
    : null
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
    if (isCustomSelection) return { custom: true }
    if (selectedWeek && selectedRunValue !== '') return selectedWeek.runs[Number(selectedRunValue)] ?? null
    return null
  }, [isCustomSelection, selectedRunValue, selectedWeek])

  const completedRunsCount = useMemo(
    () => runOptions.filter((option) => progress[option.runId] && option.planKey !== 'test').length,
    [progress, runOptions],
  )
  const totalRunsCount = useMemo(
    () => runOptions.filter((option) => option.planKey !== 'test').length,
    [runOptions],
  )
  const trainingProgressPercent = totalRunsCount
    ? Math.round((completedRunsCount / totalRunsCount) * 100)
    : 0

  const customSessionSummary = useMemo(() => buildSessionFromSettings(settings), [settings])
  const customTotalDurationSeconds = useMemo(
    () => Math.round(customSessionSummary.reduce((sum, phase) => sum + phase.durationMs, 0) / 1000),
    [customSessionSummary],
  )
  const selectedRunSessionSummary = useMemo(
    () => (selectedRun && !isCustomSelection ? buildSessionFromRun(selectedRun) : []),
    [isCustomSelection, selectedRun],
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
  const progressPercent = session.length ? Math.min(100, Math.round((completedPhases / session.length) * 100)) : 0

  const clearTicker = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  /*
    Background audio: Expo Speech uses the native TTS engines and Expo AV keeps the
    audio session active in the background. We also schedule local notifications as
    a backup prompt when the device is locked for longer periods.
  */
  const speak = useCallback(async (text) => {
    try {
      await Speech.stop()
      Speech.speak(text, {
        language: 'nb-NO',
        pitch: 1,
        rate: 0.95,
      })
    } catch {
      // Keep the timer running even if speech fails.
    }
  }, [])

  const pulseTransition = useCallback(async () => {
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch {
      // Haptics are optional.
    }
  }, [])

  const persistActiveSession = useCallback(async () => {
    if (!sessionRef.current.length || statusRef.current === STATUS.IDLE) {
      await saveJsonValue(SESSION_STATE_KEY, null)
      return
    }

    await saveJsonValue(SESSION_STATE_KEY, {
      active: true,
      session: sessionRef.current,
      phaseIndex: phaseIndexRef.current,
      phaseEnd: phaseEndRef.current,
      status: statusRef.current,
      remainingMs: Math.max(0, phaseEndRef.current - Date.now()),
      sessionTitle,
      activeRunMeta: activeRunMetaRef.current,
    })
  }, [sessionTitle])

  const scheduleBackgroundNotifications = useCallback(async (phases, startTime) => {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync()

      let runningAt = startTime
      for (let index = 0; index < phases.length; index += 1) {
        const phase = phases[index]
        const secondsUntil = Math.max(1, Math.round((runningAt - Date.now()) / 1000))

        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'RunWalk Buddy',
            body: phase.prompt,
            sound: false,
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
            seconds: secondsUntil,
          },
        })

        runningAt += phase.durationMs
      }

      const completeSeconds = Math.max(1, Math.round((runningAt - Date.now()) / 1000))
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'RunWalk Buddy',
          body: 'Økten er ferdig',
          sound: false,
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: completeSeconds,
        },
      })
    } catch {
      // Notifications are backup cues only.
    }
  }, [])

  const finishSession = useCallback(async () => {
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

    await Notifications.cancelAllScheduledNotificationsAsync()
    await saveJsonValue(SESSION_STATE_KEY, null)
    await pulseTransition()
    await speak('Økten er ferdig')
  }, [clearTicker, pulseTransition, speak])

  const syncTimer = useCallback(async () => {
    if (statusRef.current !== STATUS.RUNNING || !sessionRef.current.length) {
      return
    }

    const now = Date.now()
    let phaseIndex = phaseIndexRef.current
    let phaseEnd = phaseEndRef.current

    while (phaseIndex < sessionRef.current.length && now >= phaseEnd) {
      phaseIndex += 1

      if (phaseIndex >= sessionRef.current.length) {
        await finishSession()
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
      await pulseTransition()
      await speak(sessionRef.current[phaseIndex].prompt)
      await persistActiveSession()
    }

    const currentPhase = sessionRef.current[phaseIndexRef.current]
    const remainingSeconds = Math.max(0, Math.ceil((phaseEndRef.current - now) / 1000))
    const elapsedMs = currentPhase.durationMs - Math.max(0, phaseEndRef.current - now)
    const hasUpcomingPhase = phaseIndexRef.current < sessionRef.current.length - 1

    if (currentPhase.halfwayPrompt && elapsedMs >= currentPhase.durationMs / 2) {
      const halfwayKey = currentPhase.key
      if (lastHalfwayCueRef.current !== halfwayKey) {
        lastHalfwayCueRef.current = halfwayKey
        await speak(currentPhase.halfwayPrompt)
      }
    }

    if (hasUpcomingPhase && remainingSeconds > 0 && remainingSeconds <= 3) {
      const cueKey = `${phaseIndexRef.current}-${remainingSeconds}`
      if (lastCountdownCueRef.current !== cueKey) {
        lastCountdownCueRef.current = cueKey
        await speak(countdownPrompt(remainingSeconds))
      }
    }

    setRemainingMs(Math.max(0, phaseEndRef.current - now))
  }, [finishSession, persistActiveSession, pulseTransition, speak])

  const startTicker = useCallback(() => {
    clearTicker()
    intervalRef.current = setInterval(() => {
      syncTimer()
    }, 250)
  }, [clearTicker, syncTimer])

  function restoreActiveSession(restoredSession) {
    sessionRef.current = restoredSession.session
    phaseIndexRef.current = restoredSession.phaseIndex
    phaseEndRef.current = restoredSession.phaseEnd
    statusRef.current = restoredSession.status
    pausedRemainingRef.current = restoredSession.remainingMs
    setSession(restoredSession.session)
    setCurrentPhaseIndex(restoredSession.phaseIndex)
    setRemainingMs(restoredSession.remainingMs)
    setStatus(restoredSession.status)
    setSessionTitle(restoredSession.sessionTitle || 'Nybegynnerøkt')
    activeRunMetaRef.current = restoredSession.activeRunMeta ?? null
    setActiveRunMeta(restoredSession.activeRunMeta ?? null)

    if (restoredSession.status === STATUS.RUNNING) {
      startTicker()
      syncTimer()
    }
  }

  async function resetSessionState(nextStatus = STATUS.IDLE) {
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
    await Notifications.cancelAllScheduledNotificationsAsync()
    await saveJsonValue(SESSION_STATE_KEY, null)
    Speech.stop()
  }

  function commitDraftSettings() {
    const nextSettings = sanitizeSettings(draftSettings)
    setSettings(nextSettings)
    return nextSettings
  }

  async function beginSession(nextSession, title, runMeta = null) {
    if (!nextSession.length) return

    const startTime = Date.now()

    clearTicker()
    sessionRef.current = nextSession
    phaseIndexRef.current = 0
    pausedRemainingRef.current = 0
    lastCountdownCueRef.current = ''
    lastHalfwayCueRef.current = ''
    phaseEndRef.current = startTime + nextSession[0].durationMs
    statusRef.current = STATUS.RUNNING
    activeRunMetaRef.current = runMeta

    setSession(nextSession)
    setSessionTitle(title)
    setActiveRunMeta(runMeta)
    setCurrentPhaseIndex(0)
    setRemainingMs(nextSession[0].durationMs)
    setStatus(STATUS.RUNNING)

    await scheduleBackgroundNotifications(nextSession, startTime)
    await saveJsonValue(SESSION_STATE_KEY, {
      active: true,
      session: nextSession,
      phaseIndex: 0,
      phaseEnd: startTime + nextSession[0].durationMs,
      status: STATUS.RUNNING,
      remainingMs: nextSession[0].durationMs,
      sessionTitle: title,
      activeRunMeta: runMeta,
    })

    await pulseTransition()
    await speak(nextSession[0].prompt)
    startTicker()
  }

  async function startCustomSession() {
    const nextSettings = commitDraftSettings()
    await beginSession(buildSessionFromSettings(nextSettings), 'Nybegynnerøkt')
  }

  async function startSelectedRun() {
    if (isCustomSelection) {
      await startCustomSession()
      return
    }

    if (!selectedPlan || !selectedWeek || !selectedRun) return

    const runNumber = Number(selectedRunValue) + 1
    await beginSession(
      buildSessionFromRun(selectedRun),
      `${selectedPlan.name} - ${selectedWeekOption.label} Løp ${runNumber}`,
      {
        planKey: selectedWeekOption.planKey,
        weekNumber: selectedWeek.week,
        runIndex: Number(selectedRunValue),
      },
    )
  }

  async function pauseSession() {
    if (statusRef.current !== STATUS.RUNNING) return

    clearTicker()
    pausedRemainingRef.current = Math.max(0, phaseEndRef.current - Date.now())
    statusRef.current = STATUS.PAUSED
    setRemainingMs(pausedRemainingRef.current)
    setStatus(STATUS.PAUSED)
    Speech.stop()
    await saveJsonValue(SESSION_STATE_KEY, {
      active: true,
      session: sessionRef.current,
      phaseIndex: phaseIndexRef.current,
      phaseEnd: phaseEndRef.current,
      status: STATUS.PAUSED,
      remainingMs: pausedRemainingRef.current,
      sessionTitle,
      activeRunMeta: activeRunMetaRef.current,
    })
  }

  async function resumeSession() {
    if (statusRef.current !== STATUS.PAUSED || !sessionRef.current.length) return

    phaseEndRef.current = Date.now() + pausedRemainingRef.current
    statusRef.current = STATUS.RUNNING
    setStatus(STATUS.RUNNING)
    await persistActiveSession()
    startTicker()
    syncTimer()
  }

  async function stopSession() {
    setSessionTitle('Nybegynnerøkt')
    await resetSessionState(STATUS.IDLE)
  }

  function handleSettingChange(key, value) {
    setDraftSettings((current) => ({ ...current, [key]: value }))
  }

  function handleSettingBlur() {
    commitDraftSettings()
  }

  async function handleWeekOptionChange(nextWeekValue) {
    setSelectedWeekOptionValue(nextWeekValue)

    if (nextWeekValue === 'custom:custom') {
      setSelectedRunValue('0')
      setSessionTitle('Nybegynnerøkt')
      await resetSessionState(STATUS.IDLE)
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
    await resetSessionState(STATUS.IDLE)
  }

  async function handleRunChange(nextRunValue) {
    setSelectedRunValue(nextRunValue)

    if (isCustomSelection) {
      setSessionTitle('Nybegynnerøkt')
      await resetSessionState(STATUS.IDLE)
      return
    }

    if (selectedWeek && nextRunValue !== '') {
      const nextRun = selectedWeek.runs[Number(nextRunValue)]
      const nextSettings = settingsFromRun(nextRun)
      setSettings(nextSettings)
      setDraftSettings(settingsToDraft(nextSettings))
    }

    setSessionTitle('Nybegynnerøkt')
    await resetSessionState(STATUS.IDLE)
  }

  async function disconnectPlanSelection() {
    const recommendedRun = getRecommendedRunOption(progress)
    setSelectedWeekOptionValue(recommendedRun?.weekOptionValue ?? 'preBeginner:1')
    setSelectedRunValue(recommendedRun ? String(recommendedRun.runIndex) : '0')

    if (recommendedRun) {
      const nextSettings = settingsFromRun(recommendedRun.run)
      setSettings(nextSettings)
      setDraftSettings(settingsToDraft(nextSettings))
    }

    setSessionTitle('Nybegynnerøkt')
    await resetSessionState(STATUS.IDLE)
  }

  const readOnlySettings = Boolean(selectedRun) && !isCustomSelection

  if (!isReady) {
    return (
      <SafeAreaView style={styles.loadingShell}>
        <StatusBar barStyle="dark-content" />
        <Text style={styles.loadingText}>Laster RunWalk Buddy...</Text>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.appShell}>
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>RunWalk Buddy</Text>
          <Text style={styles.title}>Gåing og løping</Text>
          <Text style={styles.intro}>Velg uke og løp. Legg bort mobilen og følg stemmen.</Text>

          <View style={styles.planCard}>
            <Text style={styles.sectionTitle}>Treningsplan</Text>
            <View style={styles.planProgressBlock}>
              <View style={styles.planProgressCopy}>
                <Text style={styles.progressCaption}>Fremdrift</Text>
                <Text style={styles.progressStrong}>{completedRunsCount} av {totalRunsCount} løp fullført</Text>
              </View>
              <View style={styles.planProgressBar}>
                <View style={[styles.planProgressFill, { width: `${trainingProgressPercent}%` }]} />
              </View>
            </View>

            <View style={styles.planGrid}>
              <View style={styles.inputGroupHalf}>
                <Text style={styles.inputLabel}>Uke</Text>
                <View style={styles.pickerShell}>
                  <Picker selectedValue={selectedWeekOptionValue} onValueChange={handleWeekOptionChange}>
                    <Picker.Item label="Velg uke" value="" />
                    {weekOptions.map((option) => (
                      <Picker.Item key={option.value} label={option.label} value={option.value} />
                    ))}
                  </Picker>
                </View>
              </View>

              <View style={styles.inputGroupHalf}>
                <Text style={styles.inputLabel}>Løp</Text>
                <View style={[styles.pickerShell, !selectedWeek && styles.disabledShell]}>
                  <Picker
                    enabled={Boolean(selectedWeek)}
                    selectedValue={selectedRunValue}
                    onValueChange={handleRunChange}
                  >
                    {currentWeekRunOptions.map((option) => (
                      <Picker.Item
                        key={option.runId}
                        label={`${option.runLabel}${!isCustomSelection && progress[option.runId] ? ' ✓' : ''}`}
                        value={String(option.runIndex)}
                      />
                    ))}
                  </Picker>
                </View>
              </View>
            </View>

            {selectedRun && (
              <Text style={styles.planSummary}>
                {isCustomSelection
                  ? 'Custom - Run 1'
                  : `${selectedPlan?.name} - ${selectedWeekOption?.label} Run ${Number(selectedRunValue) + 1}`}
                {!isCustomSelection && selectedWeekOption && isWeekCompleted(progress, selectedWeekOption.planKey, selectedWeek.week)
                  ? ' - Uken er fullført'
                  : ''}
              </Text>
            )}
          </View>

          <View style={styles.statusPanel}>
            <Text style={styles.statusLabel}>
              {status === STATUS.IDLE && 'Klar til start'}
              {status === STATUS.RUNNING && (activePhase?.statusName ?? activePhase?.name)}
              {status === STATUS.PAUSED && `Pauset under ${activePhase?.statusName ?? activePhase?.name ?? 'økt'}`}
              {status === STATUS.COMPLETE && 'Økten er ferdig'}
            </Text>

            <Text style={styles.sessionTitle}>{status === STATUS.IDLE ? idlePreviewTitle : sessionTitle}</Text>
            <Text style={styles.countdown}>
              {status === STATUS.IDLE
                ? formatClock(idlePreviewTotalDurationSeconds)
                : formatClock(remainingMs / 1000)}
            </Text>
            <Text style={styles.phaseDetail}>
              {status === STATUS.IDLE
                ? `${selectedRun ? 'Valgt løp' : 'Standardøkt'} varer i ${formatDuration(idlePreviewTotalDurationSeconds)}`
                : activePhase?.detail}
            </Text>

            <View style={styles.progressRow}>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
              </View>
              <Text style={styles.progressPercent}>{progressPercent}%</Text>
            </View>

            {nextPhase && status !== STATUS.IDLE && status !== STATUS.COMPLETE && (
              <Text style={styles.nextUp}>Neste: {nextPhase.statusName ?? phaseSummaryLabel(nextPhase.kind)}</Text>
            )}
          </View>

          <View style={styles.primaryActions}>
            <Pressable
              onPress={selectedRun ? startSelectedRun : startCustomSession}
              disabled={status === STATUS.RUNNING || (selectedWeekOptionValue !== '' && !selectedRun)}
              style={({ pressed }) => [
                styles.button,
                styles.buttonPrimary,
                (status === STATUS.RUNNING || (selectedWeekOptionValue !== '' && !selectedRun)) && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
            >
              <Text style={styles.buttonPrimaryText}>
                {selectedRun ? (isCustomSelection ? 'Start custom' : 'Start valgt løp') : 'Start nybegynnerøkt'}
              </Text>
            </Pressable>

            <View style={styles.controlRow}>
              <SmallButton label="Pause" onPress={pauseSession} disabled={status !== STATUS.RUNNING} />
              <SmallButton label="Fortsett" onPress={resumeSession} disabled={status !== STATUS.PAUSED} />
              <SmallButton label="Stopp" onPress={stopSession} disabled={status === STATUS.IDLE} />
            </View>
          </View>

          <Text style={styles.speechNote}>
            Lydkjeder bruker Expo Speech. Bakgrunnslyd er konfigurert for iOS og Android med lokalvarsler som sikkerhetsnett.
          </Text>
        </View>

        <View style={[styles.settingsCard, readOnlySettings && styles.settingsCardPlanned]}>
          <Text style={styles.sectionTitle}>Egne innstillinger</Text>
          <Text style={styles.settingsCopy}>Endre tidene før du starter en økt.</Text>

          {selectedRun && !isCustomSelection && (
            <View style={styles.settingsPlanRow}>
              <Text style={styles.settingsPlanNote}>
                Synkronisert fra {selectedPlan?.name} - {selectedWeekOption?.label} Run {Number(selectedRunValue) + 1}
              </Text>
              <Pressable onPress={disconnectPlanSelection} style={({ pressed }) => [styles.buttonChip, pressed && styles.buttonPressed]}>
                <Text style={styles.buttonChipText}>Koble fra plan</Text>
              </Pressable>
            </View>
          )}

          <View style={styles.settingsGrid}>
            <Field
              label="Løpetid i sekunder"
              value={draftSettings.runSeconds}
              editable={!readOnlySettings}
              onChangeText={(value) => handleSettingChange('runSeconds', value)}
              onBlur={handleSettingBlur}
            />
            <Field
              label="Gåtid i sekunder"
              value={draftSettings.walkSeconds}
              editable={!readOnlySettings}
              onChangeText={(value) => handleSettingChange('walkSeconds', value)}
              onBlur={handleSettingBlur}
            />
            <Field
              label="Antall runder"
              value={draftSettings.cycles}
              editable={!readOnlySettings}
              onChangeText={(value) => handleSettingChange('cycles', value)}
              onBlur={handleSettingBlur}
            />
            <Field
              label="Oppvarming i minutter"
              value={draftSettings.warmupMinutes}
              editable={!readOnlySettings}
              onChangeText={(value) => handleSettingChange('warmupMinutes', value)}
              onBlur={handleSettingBlur}
            />
            <Field
              label="Nedtrapping i minutter"
              value={draftSettings.cooldownMinutes}
              editable={!readOnlySettings}
              onChangeText={(value) => handleSettingChange('cooldownMinutes', value)}
              onBlur={handleSettingBlur}
            />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function Field({ label, value, editable, onChangeText, onBlur }) {
  return (
    <View style={styles.inputGroup}>
      <Text style={styles.inputLabel}>{label}</Text>
      <TextInput
        value={value}
        editable={editable}
        keyboardType="numeric"
        onChangeText={onChangeText}
        onBlur={onBlur}
        style={[styles.textInput, !editable && styles.textInputDisabled]}
      />
    </View>
  )
}

function SmallButton({ label, onPress, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, styles.buttonSecondary, disabled && styles.buttonDisabled, pressed && styles.buttonPressed]}
    >
      <Text style={styles.buttonSecondaryText}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#fff8fb',
  },
  loadingShell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff8fb',
  },
  loadingText: {
    fontSize: 18,
    color: '#6f5a71',
  },
  appShell: {
    padding: 16,
    gap: 16,
  },
  heroCard: {
    backgroundColor: 'rgba(255,250,253,0.96)',
    borderRadius: 28,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(179,79,125,0.14)',
  },
  eyebrow: {
    color: '#b34f7d',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    fontSize: 34,
    lineHeight: 36,
    color: '#4a2d45',
    fontWeight: '700',
  },
  intro: {
    marginTop: 12,
    fontSize: 16,
    lineHeight: 24,
    color: '#7a6176',
  },
  planCard: {
    marginTop: 18,
    padding: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(255,244,249,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(179,79,125,0.12)',
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#4a2d45',
  },
  planProgressBlock: {
    marginTop: 12,
  },
  planProgressCopy: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  progressCaption: {
    fontSize: 14,
    color: '#7a6176',
  },
  progressStrong: {
    fontSize: 14,
    color: '#8d6adf',
    fontWeight: '700',
  },
  planProgressBar: {
    marginTop: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(214,186,255,0.22)',
    overflow: 'hidden',
  },
  planProgressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#c08cff',
  },
  planGrid: {
    marginTop: 16,
    flexDirection: 'row',
    gap: 12,
  },
  inputGroupHalf: {
    flex: 1,
  },
  pickerShell: {
    marginTop: 8,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(179,79,125,0.16)',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  disabledShell: {
    opacity: 0.55,
  },
  planSummary: {
    marginTop: 12,
    fontSize: 15,
    color: '#7a6176',
  },
  statusPanel: {
    marginTop: 18,
    padding: 18,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(179,79,125,0.12)',
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#b34f7d',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  sessionTitle: {
    marginTop: 8,
    fontSize: 17,
    color: '#8d6adf',
    fontWeight: '700',
  },
  countdown: {
    marginTop: 10,
    fontSize: 76,
    lineHeight: 80,
    color: '#4a2d45',
    fontWeight: '700',
  },
  phaseDetail: {
    marginTop: 8,
    fontSize: 16,
    lineHeight: 24,
    color: '#7a6176',
  },
  progressRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  progressBar: {
    flex: 1,
    height: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(214,186,255,0.24)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#ff9aba',
  },
  progressPercent: {
    fontSize: 15,
    color: '#b34f7d',
    fontWeight: '700',
  },
  nextUp: {
    marginTop: 12,
    fontSize: 15,
    color: '#7a6176',
  },
  primaryActions: {
    marginTop: 18,
    gap: 12,
  },
  button: {
    minHeight: 56,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonPrimary: {
    backgroundColor: '#c985ff',
  },
  buttonPrimaryText: {
    color: '#fff8fd',
    fontSize: 17,
    fontWeight: '700',
  },
  buttonSecondary: {
    flex: 1,
    backgroundColor: '#fffdf9',
    borderWidth: 1,
    borderColor: 'rgba(179,79,125,0.16)',
  },
  buttonSecondaryText: {
    color: '#4a2d45',
    fontSize: 15,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  controlRow: {
    flexDirection: 'row',
    gap: 10,
  },
  speechNote: {
    marginTop: 16,
    fontSize: 14,
    lineHeight: 22,
    color: '#7a6176',
  },
  settingsCard: {
    backgroundColor: 'rgba(255,245,249,0.95)',
    borderRadius: 28,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(179,79,125,0.12)',
  },
  settingsCardPlanned: {
    borderColor: 'rgba(141,106,223,0.26)',
  },
  settingsCopy: {
    marginTop: 12,
    fontSize: 15,
    lineHeight: 22,
    color: '#7a6176',
  },
  settingsPlanRow: {
    marginTop: 10,
    gap: 10,
  },
  settingsPlanNote: {
    fontSize: 15,
    color: '#8d6adf',
    fontWeight: '700',
  },
  buttonChip: {
    alignSelf: 'flex-start',
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: 'rgba(179,79,125,0.16)',
  },
  buttonChipText: {
    color: '#b34f7d',
    fontWeight: '700',
  },
  settingsGrid: {
    marginTop: 16,
    gap: 12,
  },
  inputGroup: {
    gap: 8,
  },
  inputLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#4a2d45',
  },
  textInput: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(179,79,125,0.16)',
    paddingHorizontal: 14,
    fontSize: 16,
    color: '#4a2d45',
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  textInputDisabled: {
    backgroundColor: 'rgba(255,247,251,0.92)',
    color: 'rgba(74,45,69,0.72)',
  },
})
