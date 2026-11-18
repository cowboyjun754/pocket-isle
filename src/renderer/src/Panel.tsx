import { useEffect, useRef, useState } from 'react'
import {
  DEFAULT_AI_BASE_URL,
  DEFAULT_AI_MODEL,
  describeAiProvider
} from '../../shared/aiProvider'
import { chooseDropEffect, extractPathsFromDataTransfer } from '../../shared/dropPaths'
import { DEFAULT_LOCALE, getMessages, resolveLocale } from '../../shared/i18n'
import { getParcelKindForExt } from '../../shared/parcelKind'
import type {
  AiConfig,
  AiKeyStatus,
  AmbienceMode,
  AppEnv,
  AppLocale,
  DecorationId,
  DecorationState,
  DockItem,
  DockUndoState,
  FocusState,
  FocusStep,
  Settings,
  SettingsPatch
} from '../../shared/types'
import { BuildTab } from './panel/BuildTab'
import { DockTab } from './panel/DockTab'
import { FocusTab } from './panel/FocusTab'
import { PreviewModal } from './panel/PreviewModal'
import { SettingsTab } from './panel/SettingsTab'
import {
  DECO_META,
  formatMb,
  playFocusChime,
  type JointCardState,
  type PreviewState,
  type Tab
} from './panel/panelShared'
import { useAiTask } from './panel/useAiTask'
import './panel.css'
import {
  IMAGE_EXTS,
  TEXT_PREVIEW_EXTS,
  describeResult,
  resolveBreakdownDocIds,
  resolveOrganizeScope
} from './util'

export function Panel(): JSX.Element {
  const [tab, setTab] = useState<Tab>('dock')
  const [items, setItems] = useState<DockItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expandedSummaryId, setExpandedSummaryId] = useState<string | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [groupDraft, setGroupDraft] = useState('')
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const thumbMtimesRef = useRef<Record<string, number>>({})
  const [panelVisible, setPanelVisible] = useState(!document.hidden)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [usage, setUsage] = useState<{ used: number; limit: number }>({ used: 0, limit: 0 })
  const [notice, setNotice] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [dockUndo, setDockUndo] = useState<DockUndoState | null>(null)
  const [pinned, setPinned] = useState(false)
  const [dockQuery, setDockQuery] = useState('')
  const [jointFocusPrompt, setJointFocusPrompt] = useState('')
  const [focusDocQuery, setFocusDocQuery] = useState('')
  const [jointCard, setJointCard] = useState<JointCardState | null>(null)

  // General & AI settings
  const [settings, setSettings] = useState<Settings>({
    locale: DEFAULT_LOCALE,
    alwaysOnTop: true,
    openAtLogin: false,
    copyLimitMB: 2048,
    focusMinutes: 25,
    restMinutes: 5,
    focusNotify: true,
    ai: {
      baseUrl: DEFAULT_AI_BASE_URL,
      model: DEFAULT_AI_MODEL,
      enableVision: false,
      hasApiKey: false,
      requiresKey: true
    }
  })
  const locale = resolveLocale(settings.locale)
  const localeRef = useRef<AppLocale>(locale)
  localeRef.current = locale
  const m = getMessages(locale)
  const pm = m.panel

  const {
    aiOrganizing,
    aiJointLoading,
    aiBreakingDown,
    aiDecorating,
    aiProgressText,
    isCurrentSeq,
    beginAiTask,
    finishAiTask,
    cancelActiveAi
  } = useAiTask(setNotice, locale)
  const [testingAi, setTestingAi] = useState(false)

  // Focus timer and goal breakdown
  const [focus, setFocus] = useState<FocusState>({
    phase: 'idle',
    running: false,
    remainingMs: 25 * 60 * 1000,
    totalMs: 25 * 60 * 1000,
    goal: '',
    steps: []
  })
  const [focusDocIds, setFocusDocIds] = useState<Set<string>>(new Set())

  // Island decorations & ambience
  const [decor, setDecor] = useState<DecorationState>({
    ambience: 'day',
    enabled: {
      flowers: true,
      bench: true,
      lamp: true,
      tree: true,
      cabin: true,
      windmill: true
    }
  })
  const [decorMood, setDecorMood] = useState('')
  const cancelingGroupEdit = useRef(false)
  const loadingThumbs = useRef<Set<string>>(new Set())
  const previewOpenRef = useRef(false)
  previewOpenRef.current = preview !== null
  const editingGroupRef = useRef(false)
  editingGroupRef.current = editingGroupId !== null
  const tabRef = useRef<Tab>('dock')
  tabRef.current = tab
  const pendingPlanRef = useRef<{ goal: string; steps: FocusStep[] } | null>(null)
  const planSyncTimerRef = useRef<number | null>(null)
  const pendingPlanSeqRef = useRef(0)
  const aiDirtyRef = useRef(false)
  const keyQuerySeqRef = useRef(0)
  const lastValidOriginRef = useRef('https://api.deepseek.com')
  const dockSearchRef = useRef<HTMLInputElement>(null)

  const [copyLimitDraft, setCopyLimitDraft] = useState('2048')
  const [focusMinDraft, setFocusMinDraft] = useState('25')
  const [restMinDraft, setRestMinDraft] = useState('5')
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const [appEnv, setAppEnv] = useState<AppEnv>({ isPackaged: false, shortcut: 'Control+Alt+Space' })
  const [aiCfg, setAiCfg] = useState<AiConfig>({
    baseUrl: DEFAULT_AI_BASE_URL,
    model: DEFAULT_AI_MODEL,
    enableVision: false
  })
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [clearSavedKey, setClearSavedKey] = useState(false)
  const [originKeyStatus, setOriginKeyStatus] = useState<AiKeyStatus>({
    origin: 'https://api.deepseek.com',
    hasApiKey: false,
    requiresKey: true,
    valid: true
  })

  useEffect(() => {
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'
    document.title = getMessages(locale).appName
  }, [locale])

  const syncOriginKeyStatus = (baseUrl: string): void => {
    const qSeq = ++keyQuerySeqRef.current
    window.isle.getAiKeyStatus(baseUrl).then((st) => {
      if (keyQuerySeqRef.current !== qSeq) return
      if (st.valid && st.origin !== lastValidOriginRef.current) {
        lastValidOriginRef.current = st.origin
        setApiKeyDraft('')
        setClearSavedKey(false)
      }
      setOriginKeyStatus(st)
    })
  }

  const refreshDock = async (): Promise<void> => {
    const [list, u] = await Promise.all([window.isle.listDock(), window.isle.copyUsage()])
    setItems(list)
    setUsage(u)
    const validMap = new Map(list.map((i) => [i.id, i]))
    setSelected((prev) => new Set([...prev].filter((id) => validMap.has(id))))
    setFocusDocIds((prev) => new Set([...prev].filter((id) => validMap.has(id))))
    setThumbs((prev) => {
      const next: Record<string, string> = {}
      const nextMtimes: Record<string, number> = {}
      for (const [k, v] of Object.entries(prev)) {
        const it = validMap.get(k)
        if (it && thumbMtimesRef.current[k] === it.mtimeMs) {
          next[k] = v
          nextMtimes[k] = it.mtimeMs
        }
      }
      thumbMtimesRef.current = nextMtimes
      return next
    })
  }

  const commitFocusPlan = (nextGoal: string, nextSteps: FocusStep[], immediate = false): void => {
    const seq = ++pendingPlanSeqRef.current
    pendingPlanRef.current = { goal: nextGoal, steps: nextSteps }
    setFocus((prev) => ({ ...prev, goal: nextGoal, steps: nextSteps }))
    if (planSyncTimerRef.current) {
      window.clearTimeout(planSyncTimerRef.current)
      planSyncTimerRef.current = null
    }
    const flush = (): void => {
      window.isle.updateFocusPlan(nextGoal, nextSteps).then(() => {
        if (pendingPlanSeqRef.current === seq) {
          pendingPlanRef.current = null
        }
      })
    }
    if (immediate) {
      flush()
    } else {
      planSyncTimerRef.current = window.setTimeout(() => {
        planSyncTimerRef.current = null
        flush()
      }, 180)
    }
  }

  const flushPendingPlan = (): void => {
    if (pendingPlanRef.current) {
      commitFocusPlan(pendingPlanRef.current.goal, pendingPlanRef.current.steps, true)
    }
  }

  const trimmedDockQuery = dockQuery.trim().toLowerCase()
  const filteredItems = trimmedDockQuery
    ? items.filter((it) => {
        const hay = `${it.name} ${it.ext} ${it.group ?? ''} ${it.summary?.brief ?? ''}`.toLowerCase()
        return hay.includes(trimmedDockQuery)
      })
    : items

  const groupedSections = (() => {
    const map = new Map<string, DockItem[]>()
    for (const it of filteredItems) {
      const key = it.group?.trim() || ''
      const arr = map.get(key) ?? []
      arr.push(it)
      map.set(key, arr)
    }
    return [...map.entries()].sort((a, b) => {
      if (!a[0]) return 1
      if (!b[0]) return -1
      return a[0].localeCompare(b[0], locale === 'en' ? 'en' : 'zh-CN')
    })
  })()

  const visualIdsRef = useRef<string[]>([])
  visualIdsRef.current = groupedSections.flatMap(([, g]) => g.map((i) => i.id))
  const organizeScope = resolveOrganizeScope({
    items,
    filteredItems,
    selected,
    query: dockQuery
  })
  const providerLabel = describeAiProvider(settings.ai.baseUrl, locale)

  useEffect(() => {
    refreshDock()
    window.isle.getDecorations().then(setDecor)
    window.isle.getFocus().then((f) => {
      if (pendingPlanRef.current) {
        setFocus({ ...f, goal: pendingPlanRef.current.goal, steps: pendingPlanRef.current.steps })
      } else {
        setFocus(f)
      }
    })
    window.isle.getSettings().then((s) => {
      setSettings(s)
      setCopyLimitDraft(String(s.copyLimitMB))
      setFocusMinDraft(String(s.focusMinutes ?? 25))
      setRestMinDraft(String(s.restMinutes ?? 5))
      if (!aiDirtyRef.current) {
        setAiCfg(s.ai)
        syncOriginKeyStatus(s.ai.baseUrl)
      }
    })
    window.isle.getAppEnv().then(setAppEnv)
    window.isle.getPanelPinned().then(setPinned)

    const off1 = window.isle.onDockChanged(refreshDock)
    const off2 = window.isle.onReceived((r) => setNotice(describeResult(r, localeRef.current)))
    const off3 = window.isle.onDecorChanged(setDecor)
    const off4 = window.isle.onFocusChanged((nextFocus) => {
      if (pendingPlanRef.current) {
        setFocus({
          ...nextFocus,
          goal: pendingPlanRef.current.goal,
          steps: pendingPlanRef.current.steps
        })
      } else {
        setFocus(nextFocus)
      }
    })
    const off5 = window.isle.onSettingsChanged((s) => {
      setSettings(s)
      setCopyLimitDraft(String(s.copyLimitMB))
      setFocusMinDraft(String(s.focusMinutes ?? 25))
      setRestMinDraft(String(s.restMinutes ?? 5))
      if (!aiDirtyRef.current) {
        setAiCfg(s.ai)
        syncOriginKeyStatus(s.ai.baseUrl)
      }
    })
    const off6 = window.isle.onPanelPinnedChanged(setPinned)
    const off7 = window.isle.onFocusFinished((finishedPhase) => {
      if (settingsRef.current.focusNotify !== false) {
        playFocusChime()
      }
      const nm = getMessages(localeRef.current).notifications
      setNotice(finishedPhase === 'focus' ? nm.focusDonePanel : nm.restDonePanel)
    })
    const off8 = window.isle.onDockUndoChanged(setDockUndo)

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (editingGroupRef.current) return
        if (document.activeElement === dockSearchRef.current && dockSearchRef.current?.value) {
          setDockQuery('')
          return
        }
        if (previewOpenRef.current) setPreview(null)
        else window.isle.hidePanel()
        return
      }
      const activeEl = document.activeElement as HTMLElement | null
      const inEditable =
        activeEl?.tagName === 'INPUT' ||
        activeEl?.tagName === 'TEXTAREA' ||
        !!activeEl?.isContentEditable
      if (inEditable) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && tabRef.current === 'dock') {
        e.preventDefault()
        dockSearchRef.current?.focus()
        dockSearchRef.current?.select()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && tabRef.current === 'dock') {
        e.preventDefault()
        setSelected(new Set(visualIdsRef.current))
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        window.isle.pasteFromClipboard().then((res) => {
          const msg = describeResult(res, localeRef.current)
          if (msg) setNotice(msg)
        })
      }
    }
    const syncVisibility = (): void => setPanelVisible(!document.hidden)
    document.addEventListener('visibilitychange', syncVisibility)
    window.addEventListener('focus', syncVisibility)
    window.addEventListener('keydown', onKey)
    return () => {
      off1()
      off2()
      off3()
      off4()
      off5()
      off6()
      off7()
      off8()
      document.removeEventListener('visibilitychange', syncVisibility)
      window.removeEventListener('focus', syncVisibility)
      window.removeEventListener('keydown', onKey)
      if (planSyncTimerRef.current) {
        window.clearTimeout(planSyncTimerRef.current)
      }
      flushPendingPlan()
    }
  }, [])

  useEffect(() => {
    if (!panelVisible || tab !== 'dock') return
    for (const it of items) {
      if (thumbs[it.id] || loadingThumbs.current.has(it.id) || it.available === false) continue
      loadingThumbs.current.add(it.id)
      const thumbMtime = it.mtimeMs
      window.isle
        .thumb(it.id, 96)
        .then((url) => {
          if (url) {
            thumbMtimesRef.current[it.id] = thumbMtime
            setThumbs((m) => ({ ...m, [it.id]: url }))
          }
        })
        .finally(() => {
          loadingThumbs.current.delete(it.id)
        })
    }
  }, [items, panelVisible, tab])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(t)
  }, [notice])

  useEffect(() => {
    if (!confirmingClear) return
    const t = window.setTimeout(() => setConfirmingClear(false), 3800)
    return () => window.clearTimeout(t)
  }, [confirmingClear])

  const onRowClick = (id: string, e: React.MouseEvent): void => {
    if (e.ctrlKey || e.metaKey) {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    } else if (e.shiftKey && selected.size > 0) {
      const ids = visualIdsRef.current
      const last = [...selected].pop()!
      const [i1, i2] = [ids.indexOf(last), ids.indexOf(id)]
      if (i1 >= 0 && i2 >= 0) {
        const [a, b] = [i1, i2].sort((x, y) => x - y)
        setSelected(new Set(ids.slice(a, b + 1)))
      } else {
        setSelected(new Set([id]))
      }
    } else {
      setSelected(new Set([id]))
    }
  }

  const onRowDragStart = (it: DockItem, e: React.DragEvent): void => {
    e.preventDefault()
    if (it.available === false) return
    const ids = selected.has(it.id) ? [...selected] : [it.id]
    if (!selected.has(it.id)) setSelected(new Set([it.id]))
    window.isle.startDrag(ids, getParcelKindForExt(it.ext))
  }

  const onOpen = async (it: DockItem): Promise<void> => {
    if (it.available === false) {
      setNotice(pm.notices.fileUnavailable)
      return
    }
    const err = await window.isle.open(it.id)
    if (err) setNotice(pm.notices.cannotOpen(err))
  }

  const onPreview = async (it: DockItem): Promise<void> => {
    if (it.available === false || it.isDir) return
    if (IMAGE_EXTS.has(it.ext)) {
      const src = (await window.isle.thumb(it.id, 720)) ?? thumbs[it.id]
      if (src) setPreview({ item: it, src })
      return
    }
    if (TEXT_PREVIEW_EXTS.has(it.ext)) {
      const res = await window.isle.readTextPreview(it.id)
      if (res.ok) setPreview({ item: it, text: res.content ?? '', truncated: res.truncated })
      else setNotice(res.message || pm.notices.cannotPreview)
    }
  }

  const onCopyItem = async (it: DockItem): Promise<void> => {
    const res = await window.isle.copyItemToClipboard(it.id)
    setNotice(res.message)
  }

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragOver(false)
    const paths = extractPathsFromDataTransfer(e.dataTransfer, (f) => window.isle.getPathForFile(f))
    if (paths.length) {
      await window.isle.addPaths(paths)
    } else {
      setNotice(pm.notices.dropUnknown)
    }
  }

  const handleUndoRemove = async (): Promise<void> => {
    const res = await window.isle.undoRemove(dockUndo?.token)
    setNotice(res.message)
  }

  const handleAiOrganize = async (): Promise<void> => {
    if (aiOrganizing || aiJointLoading) return
    if (organizeScope.count === 0) {
      setNotice(pm.notices.emptyOrganizeFilter)
      return
    }
    const { seq, taskId } = beginAiTask('organize', pm.notices.prepOrganize)
    try {
      const res = await window.isle.aiOrganizeDock(organizeScope.targetIds, taskId)
      if (!isCurrentSeq(seq)) return
      setNotice(res.message)
      if (!res.ok && !res.cancelled && res.needsSetup) {
        setTab('settings')
      }
    } finally {
      finishAiTask(seq)
    }
  }

  const handleAiJointSummary = async (): Promise<void> => {
    if (aiJointLoading || aiOrganizing) return
    if (selected.size < 2) {
      setNotice(pm.notices.needTwoJoint)
      return
    }
    const targetIds = [...selected].slice(0, 6)
    const names = items.filter((i) => targetIds.includes(i.id)).map((i) => i.name)
    if (selected.size > 6) {
      setNotice(pm.notices.jointMaxSix)
    }
    const { seq, taskId } = beginAiTask('joint', pm.notices.prepJoint)
    try {
      const res = await window.isle.aiJointSummary(
        targetIds,
        jointFocusPrompt.trim() || undefined,
        taskId
      )
      if (!isCurrentSeq(seq)) return
      setNotice(res.message)
      if (!res.ok && !res.cancelled && res.needsSetup) {
        setTab('settings')
        return
      }
      if (res.ok && res.markdown) {
        setJointCard({
          title: res.title || pm.notices.jointFallbackTitle,
          markdown: res.markdown,
          files: names,
          receipts: res.files
        })
      }
    } finally {
      finishAiTask(seq)
    }
  }

  const handleAiBreakdown = async (): Promise<void> => {
    if (aiBreakingDown) return
    flushPendingPlan()
    const focusMins = settings.focusMinutes ?? 25
    const docIds = resolveBreakdownDocIds(focusDocIds)
    const { seq, taskId } = beginAiTask(
      'breakdown',
      docIds.length > 0 ? pm.notices.prepBreakdownDocs : pm.notices.prepBreakdownGoal(focusMins)
    )
    try {
      const res = await window.isle.aiBreakdownGoal(focus.goal, docIds, focusMins, taskId)
      if (!isCurrentSeq(seq)) return
      setNotice(res.message)
      if (!res.ok && !res.cancelled && res.needsSetup) {
        setTab('settings')
        return
      }
      if (res.ok) {
        const nextGoal = res.refinedGoal || focus.goal
        const nextSteps: FocusStep[] = (res.steps ?? []).map((t, i) => ({
          id: `${Date.now()}-${i}`,
          text: t,
          done: false
        }))
        commitFocusPlan(nextGoal, nextSteps, true)
      }
    } finally {
      finishAiTask(seq)
    }
  }

  const handleAiDecor = async (): Promise<void> => {
    if (aiDecorating) return
    const { seq, taskId } = beginAiTask('decor', pm.notices.prepDecor)
    try {
      const res = await window.isle.aiRecommendDecor(decorMood, taskId)
      if (!isCurrentSeq(seq)) return
      setNotice(res.message)
      if (!res.ok && !res.cancelled && res.needsSetup) setTab('settings')
    } finally {
      finishAiTask(seq)
    }
  }

  const applyDecorPreset = (
    ambience: AmbienceMode,
    onList: DecorationId[],
    label: string
  ): void => {
    const set = new Set(onList)
    const enabled = Object.fromEntries(DECO_META.map((d) => [d.id, set.has(d.id)])) as Record<
      DecorationId,
      boolean
    >
    window.isle.setDecorations({ ambience, enabled })
    setNotice(pm.notices.appliedPreset(label))
  }

  const applySettingsPatch = async (patch: SettingsPatch, msg?: string): Promise<void> => {
    const next = await window.isle.updateSettings(patch)
    setSettings(next)
    setCopyLimitDraft(String(next.copyLimitMB))
    setFocusMinDraft(String(next.focusMinutes ?? 25))
    setRestMinDraft(String(next.restMinutes ?? 5))
    if (typeof patch.copyLimitMB === 'number') {
      const u = await window.isle.copyUsage()
      setUsage(u)
    }
    if (msg) setNotice(msg)
  }

  const applyFocusDurations = async (nextFocus?: number, nextRest?: number): Promise<void> => {
    const curNotices = getMessages(localeRef.current).panel.notices
    const patch: SettingsPatch = {}
    if (typeof nextFocus === 'number') {
      if (!Number.isFinite(nextFocus) || nextFocus < 1 || nextFocus > 180) {
        setFocusMinDraft(String(settings.focusMinutes ?? 25))
        setNotice(curNotices.invalidFocusMins)
        return
      }
      patch.focusMinutes = Math.round(nextFocus)
    }
    if (typeof nextRest === 'number') {
      if (!Number.isFinite(nextRest) || nextRest < 1 || nextRest > 60) {
        setRestMinDraft(String(settings.restMinutes ?? 5))
        setNotice(curNotices.invalidRestMins)
        return
      }
      patch.restMinutes = Math.round(nextRest)
    }
    if (Object.keys(patch).length > 0) {
      await applySettingsPatch(patch)
    }
  }

  const applyCopyLimitMB = async (mb: number): Promise<void> => {
    if (!Number.isFinite(mb) || mb < 64 || mb > 20480) {
      setNotice(pm.notices.invalidCopyLimit)
      return
    }
    const clean = Math.round(mb)
    await applySettingsPatch(
      { copyLimitMB: clean },
      pm.notices.appliedCopyLimit(formatMb(clean))
    )
  }

  const copyCount = items.filter((i) => i.isCopy).length
  const unavailableIds = items.filter((i) => i.available === false).map((i) => i.id)
  const focusMins = settings.focusMinutes ?? 25
  const restMins = settings.restMinutes ?? 5

  return (
    <div
      className={`panel-shell ${dragOver ? 'is-dragover' : ''} ${
        tab === 'dock' && dockUndo ? 'has-dock-undo' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = chooseDropEffect(e.dataTransfer.effectAllowed)
        if (!dragOver) setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDragOver(false)
        }
      }}
      onDrop={onDrop}
    >
      <header className="panel-header">
        <div className="panel-tabs">
          <button className={tab === 'dock' ? 'active' : ''} onClick={() => setTab('dock')}>
            {pm.tabs.dock(items.length)}
          </button>
          <button className={tab === 'focus' ? 'active' : ''} onClick={() => setTab('focus')}>
            {pm.tabs.focus} {focus.phase !== 'idle' ? '●' : ''}
          </button>
          <button className={tab === 'build' ? 'active' : ''} onClick={() => setTab('build')}>
            {pm.tabs.build}
          </button>
        </div>
        <div className="header-right">
          <button
            className={`icon-btn pin-btn ${pinned ? 'is-pinned' : ''}`}
            onClick={async () => {
              const next = await window.isle.setPanelPinned(!pinned)
              setPinned(next)
              setNotice(next ? pm.header.pinnedMsg : pm.header.unpinnedMsg)
            }}
            title={pinned ? pm.header.pinnedTitle : pm.header.unpinnedTitle}
          >
            📌
          </button>
          <button
            className={`icon-btn ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab(tab === 'settings' ? 'dock' : 'settings')}
            title={pm.header.settingsTitle}
          >
            ⚙
          </button>
          <button
            className="close-btn"
            onClick={() => window.isle.hidePanel()}
            title={pm.header.closeTitle}
          >
            ✕
          </button>
        </div>
      </header>

      {tab === 'dock' && (
        <DockTab
          locale={locale}
          items={items}
          filteredItems={filteredItems}
          groupedSections={groupedSections}
          selected={selected}
          setSelected={setSelected}
          thumbs={thumbs}
          usage={usage}
          copyCount={copyCount}
          unavailableIds={unavailableIds}
          providerLabel={providerLabel}
          organizeScope={organizeScope}
          dockQuery={dockQuery}
          setDockQuery={setDockQuery}
          dockSearchRef={dockSearchRef}
          jointFocusPrompt={jointFocusPrompt}
          setJointFocusPrompt={setJointFocusPrompt}
          jointCard={jointCard}
          setJointCard={setJointCard}
          expandedSummaryId={expandedSummaryId}
          setExpandedSummaryId={setExpandedSummaryId}
          editingGroupId={editingGroupId}
          setEditingGroupId={setEditingGroupId}
          groupDraft={groupDraft}
          setGroupDraft={setGroupDraft}
          cancelingGroupEdit={cancelingGroupEdit}
          confirmingClear={confirmingClear}
          setConfirmingClear={setConfirmingClear}
          dockUndo={dockUndo}
          onDismissUndo={() => setDockUndo(null)}
          onUndoRemove={handleUndoRemove}
          aiOrganizing={aiOrganizing}
          aiJointLoading={aiJointLoading}
          aiProgressText={aiProgressText}
          onAiOrganize={handleAiOrganize}
          onAiJointSummary={handleAiJointSummary}
          onCancelAi={cancelActiveAi}
          onRowClick={onRowClick}
          onRowDragStart={onRowDragStart}
          onOpen={onOpen}
          onPreview={onPreview}
          onCopyItem={onCopyItem}
          onNotice={setNotice}
        />
      )}

      {tab === 'focus' && (
        <FocusTab
          locale={locale}
          focus={focus}
          items={items}
          focusMins={focusMins}
          restMins={restMins}
          focusMinDraft={focusMinDraft}
          setFocusMinDraft={setFocusMinDraft}
          restMinDraft={restMinDraft}
          setRestMinDraft={setRestMinDraft}
          focusDocIds={focusDocIds}
          setFocusDocIds={setFocusDocIds}
          focusDocQuery={focusDocQuery}
          setFocusDocQuery={setFocusDocQuery}
          providerLabel={providerLabel}
          aiBreakingDown={aiBreakingDown}
          aiProgressText={aiProgressText}
          onApplyFocusDurations={applyFocusDurations}
          onCommitFocusPlan={commitFocusPlan}
          onFlushPendingPlan={flushPendingPlan}
          onAiBreakdown={handleAiBreakdown}
          onCancelAi={cancelActiveAi}
        />
      )}

      {tab === 'build' && (
        <BuildTab
          locale={locale}
          decor={decor}
          decorMood={decorMood}
          setDecorMood={setDecorMood}
          aiDecorating={aiDecorating}
          onApplyPreset={applyDecorPreset}
          onAiDecor={handleAiDecor}
          onCancelAi={cancelActiveAi}
        />
      )}

      {tab === 'settings' && (
        <SettingsTab
          locale={locale}
          settings={settings}
          appEnv={appEnv}
          usage={usage}
          copyLimitDraft={copyLimitDraft}
          setCopyLimitDraft={setCopyLimitDraft}
          aiCfg={aiCfg}
          setAiCfg={setAiCfg}
          apiKeyDraft={apiKeyDraft}
          setApiKeyDraft={setApiKeyDraft}
          clearSavedKey={clearSavedKey}
          setClearSavedKey={setClearSavedKey}
          originKeyStatus={originKeyStatus}
          testingAi={testingAi}
          setTestingAi={setTestingAi}
          aiDirtyRef={aiDirtyRef}
          onSyncOriginKeyStatus={syncOriginKeyStatus}
          onApplySettingsPatch={applySettingsPatch}
          onApplyCopyLimitMB={applyCopyLimitMB}
          onNotice={setNotice}
        />
      )}

      {notice && <div className="panel-notice">{notice}</div>}

      {preview && (
        <PreviewModal
          locale={locale}
          preview={preview}
          onClose={() => setPreview(null)}
          onCopy={onCopyItem}
          onOpen={onOpen}
        />
      )}
    </div>
  )
}
