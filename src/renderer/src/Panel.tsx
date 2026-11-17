import { useEffect, useRef, useState } from 'react'
import { chooseDropEffect, extractPathsFromDataTransfer } from '../../shared/dropPaths'
import { getParcelKindForExt } from '../../shared/parcelKind'
import type {
  AiConfig,
  AmbienceMode,
  AppEnv,
  DecorationId,
  DecorationState,
  DockItem,
  FocusState,
  FocusStep,
  Settings,
  SettingsPatch
} from '../../shared/types'
import './panel.css'
import { IMAGE_EXTS, TEXT_PREVIEW_EXTS, describeResult, formatSize } from './util'

function playFocusChime(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    const notes = [523.25, 659.25, 783.99]
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(freq, now + i * 0.14)
      gain.gain.setValueAtTime(0.0001, now + i * 0.14)
      gain.gain.exponentialRampToValueAtTime(0.08, now + i * 0.14 + 0.03)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.14 + 0.55)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + i * 0.14)
      osc.stop(now + i * 0.14 + 0.6)
    })
    window.setTimeout(() => void ctx.close().catch(() => {}), 1400)
  } catch {
    /* 无可用音频设备时静默 */
  }
}

type Tab = 'dock' | 'focus' | 'build' | 'settings'

const DECO_META: Array<{ id: DecorationId; name: string; icon: string; desc: string }> = [
  { id: 'flowers', name: '野花丛', icon: '🌷', desc: '岸边轻摇的暖色小花' },
  { id: 'bench', name: '木长椅', icon: '🪑', desc: '面朝海面的发呆座位' },
  { id: 'lamp', name: '小路灯', icon: '🏮', desc: '夜晚亮起温暖鹅黄光晕' },
  { id: 'tree', name: '圆冠树', icon: '🌳', desc: '随海风轻微摆动的绿荫' },
  { id: 'cabin', name: '小木屋', icon: '🏡', desc: '水獭的温馨木头小屋' },
  { id: 'windmill', name: '小风车', icon: '🎐', desc: '山坡上的木叶风车' }
]

const AI_PRESETS: Array<{ label: string; baseUrl: string; model: string }> = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  {
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus'
  },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'Ollama (本地)', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
  { label: 'LM Studio (本地)', baseUrl: 'http://127.0.0.1:1234/v1', model: 'local-model' }
]

export function Panel(): JSX.Element {
  const [tab, setTab] = useState<Tab>('dock')
  const [items, setItems] = useState<DockItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expandedSummaryId, setExpandedSummaryId] = useState<string | null>(null)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [groupDraft, setGroupDraft] = useState('')
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<{
    item: DockItem
    src?: string
    text?: string
    truncated?: boolean
  } | null>(null)
  const [usage, setUsage] = useState<{ used: number; limit: number }>({ used: 0, limit: 0 })
  const [notice, setNotice] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [dockQuery, setDockQuery] = useState('')
  const [jointFocusPrompt, setJointFocusPrompt] = useState('')
  const [focusDocQuery, setFocusDocQuery] = useState('')
  const [jointCard, setJointCard] = useState<{
    title: string
    markdown: string
    files: string[]
  } | null>(null)

  // AI 加载态
  const [aiOrganizing, setAiOrganizing] = useState(false)
  const [aiJointLoading, setAiJointLoading] = useState(false)
  const [aiBreakingDown, setAiBreakingDown] = useState(false)
  const [aiDecorating, setAiDecorating] = useState(false)
  const [aiProgressText, setAiProgressText] = useState('')
  const [testingAi, setTestingAi] = useState(false)

  // 专注计时与拆解
  const [focus, setFocus] = useState<FocusState>({
    phase: 'idle',
    running: false,
    remainingMs: 25 * 60 * 1000,
    totalMs: 25 * 60 * 1000,
    goal: '',
    steps: []
  })
  const [focusDocIds, setFocusDocIds] = useState<Set<string>>(new Set())
  const [newStepText, setNewStepText] = useState('')

  // 自由桌搭
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
  const aiReqSeqRef = useRef(0)
  const dockSearchRef = useRef<HTMLInputElement>(null)

  // 通用与 AI 配置
  const [settings, setSettings] = useState<Settings>({
    alwaysOnTop: true,
    openAtLogin: false,
    copyLimitMB: 2048,
    focusMinutes: 25,
    restMinutes: 5,
    focusNotify: true,
    ai: {
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: '',
      model: 'deepseek-chat',
      enableVision: false
    }
  })
  const [copyLimitDraft, setCopyLimitDraft] = useState('2048')
  const [focusMinDraft, setFocusMinDraft] = useState('25')
  const [restMinDraft, setRestMinDraft] = useState('5')
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const [appEnv, setAppEnv] = useState<AppEnv>({ isPackaged: false, shortcut: 'Control+Alt+Space' })
  const [aiCfg, setAiCfg] = useState<AiConfig>({
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    enableVision: false
  })

  const refreshDock = async (): Promise<void> => {
    const [list, u] = await Promise.all([window.isle.listDock(), window.isle.copyUsage()])
    setItems(list)
    setUsage(u)
    const validIds = new Set(list.map((i) => i.id))
    setSelected((prev) => new Set([...prev].filter((id) => validIds.has(id))))
    setFocusDocIds((prev) => new Set([...prev].filter((id) => validIds.has(id))))
    setThumbs((prev) => {
      const next: Record<string, string> = {}
      for (const [k, v] of Object.entries(prev)) {
        if (validIds.has(k)) next[k] = v
      }
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

  // 按分组归类展示（未分组排在最后）
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
      return a[0].localeCompare(b[0], 'zh-CN')
    })
  })()

  const visualIdsRef = useRef<string[]>([])
  visualIdsRef.current = groupedSections.flatMap(([, g]) => g.map((i) => i.id))

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
      }
    })
    window.isle.getAppEnv().then(setAppEnv)
    window.isle.getPanelPinned().then(setPinned)

    const off1 = window.isle.onDockChanged(refreshDock)
    const off2 = window.isle.onReceived((r) => setNotice(describeResult(r)))
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
      }
    })
    const off6 = window.isle.onPanelPinnedChanged(setPinned)
    const off7 = window.isle.onFocusFinished((finishedPhase) => {
      if (settingsRef.current.focusNotify !== false) {
        playFocusChime()
      }
      setNotice(finishedPhase === 'focus' ? '本轮专注结束，记得站起来歇会儿~' : '休息结束啦，随时开始下一轮！')
    })

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
          const msg = describeResult(res)
          if (msg) setNotice(msg)
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      off1()
      off2()
      off3()
      off4()
      off5()
      off6()
      off7()
      window.removeEventListener('keydown', onKey)
      if (planSyncTimerRef.current) {
        window.clearTimeout(planSyncTimerRef.current)
      }
      flushPendingPlan()
    }
  }, [])

  useEffect(() => {
    for (const it of items) {
      if (thumbs[it.id] || loadingThumbs.current.has(it.id) || it.available === false) continue
      loadingThumbs.current.add(it.id)
      window.isle
        .thumb(it.id, 96)
        .then((url) => {
          if (url) setThumbs((m) => ({ ...m, [it.id]: url }))
        })
        .finally(() => {
          loadingThumbs.current.delete(it.id)
        })
    }
  }, [items])

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
      setNotice('文件不可用，原文件可能已被移动或删除')
      return
    }
    const err = await window.isle.open(it.id)
    if (err) setNotice(`无法打开：${err}`)
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
      else setNotice(res.message || '无法预览文件内容')
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
      setNotice('未识别到本地文件路径，请从文件列表或资源管理器拖入')
    }
  }

  // ---------- AI 动作 ----------

  const startAiProgress = (seq: number, initial: string, nextStep: string): number => {
    setAiProgressText(initial)
    return window.setTimeout(() => {
      if (aiReqSeqRef.current === seq) setAiProgressText(nextStep)
    }, 1100)
  }

  const cancelActiveAi = (): void => {
    ++aiReqSeqRef.current
    window.isle.cancelAi()
    setAiOrganizing(false)
    setAiJointLoading(false)
    setAiBreakingDown(false)
    setAiDecorating(false)
    setAiProgressText('')
    setNotice('正在取消 AI 请求...')
  }

  const handleAiOrganize = async (): Promise<void> => {
    if (aiOrganizing || aiJointLoading) return
    const seq = ++aiReqSeqRef.current
    setAiOrganizing(true)
    const stageTimer = startAiProgress(seq, '正在读取文件正文与属性…', '水獭正在归纳分组与要点…')
    try {
      const targetIds = selected.size > 0 ? [...selected] : undefined
      const res = await window.isle.aiOrganizeDock(targetIds)
      if (aiReqSeqRef.current !== seq && res.cancelled) return
      setNotice(res.message)
      if (!res.ok && !res.cancelled && res.message.includes('设置')) {
        setTab('settings')
      }
    } finally {
      window.clearTimeout(stageTimer)
      if (aiReqSeqRef.current === seq) {
        setAiOrganizing(false)
        setAiProgressText('')
      }
    }
  }

  const handleAiJointSummary = async (): Promise<void> => {
    if (aiJointLoading || aiOrganizing) return
    if (selected.size < 2) {
      setNotice('请至少选中 2 份文件后再发起联合速览')
      return
    }
    const targetIds = [...selected].slice(0, 6)
    const names = items.filter((i) => targetIds.includes(i.id)).map((i) => i.name)
    if (selected.size > 6) {
      setNotice('联合速览一次最多串读前 6 份选中文件')
    }
    const seq = ++aiReqSeqRef.current
    setAiJointLoading(true)
    const stageTimer = startAiProgress(seq, '正在提取选中文件文本…', '水獭正在对比整理联合速览…')
    try {
      const res = await window.isle.aiJointSummary(
        targetIds,
        jointFocusPrompt.trim() || undefined
      )
      if (aiReqSeqRef.current !== seq && res.cancelled) return
      setNotice(res.message)
      if (!res.ok && !res.cancelled && res.message.includes('设置')) {
        setTab('settings')
        return
      }
      if (res.ok && res.markdown) {
        setJointCard({
          title: res.title || '联合速览卡片',
          markdown: res.markdown,
          files: names
        })
      }
    } finally {
      window.clearTimeout(stageTimer)
      if (aiReqSeqRef.current === seq) {
        setAiJointLoading(false)
        setAiProgressText('')
      }
    }
  }

  const handleAiBreakdown = async (): Promise<void> => {
    if (aiBreakingDown) return
    flushPendingPlan()
    const seq = ++aiReqSeqRef.current
    const focusMins = settings.focusMinutes ?? 25
    setAiBreakingDown(true)
    const stageTimer = startAiProgress(seq, '正在读取关联资料…', `水獭正在拆解 ${focusMins} 分钟步骤…`)
    try {
      const docIds = focusDocIds.size > 0 ? [...focusDocIds] : items.slice(-5).map((i) => i.id)
      const res = await window.isle.aiBreakdownGoal(focus.goal, docIds, focusMins)
      if (aiReqSeqRef.current !== seq && res.cancelled) return
      setNotice(res.message)
      if (!res.ok && !res.cancelled && res.message.includes('设置')) {
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
      window.clearTimeout(stageTimer)
      if (aiReqSeqRef.current === seq) {
        setAiBreakingDown(false)
        setAiProgressText('')
      }
    }
  }

  const handleAiDecor = async (): Promise<void> => {
    if (aiDecorating) return
    const seq = ++aiReqSeqRef.current
    setAiDecorating(true)
    try {
      const res = await window.isle.aiRecommendDecor(decorMood)
      if (aiReqSeqRef.current !== seq && res.cancelled) return
      setNotice(res.message)
      if (!res.ok && !res.cancelled && res.message.includes('设置')) setTab('settings')
    } finally {
      if (aiReqSeqRef.current === seq) setAiDecorating(false)
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
    setNotice(`已切换为「${label}」桌搭方案`)
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
    const patch: SettingsPatch = {}
    if (typeof nextFocus === 'number') {
      if (!Number.isFinite(nextFocus) || nextFocus < 1 || nextFocus > 180) {
        setFocusMinDraft(String(settings.focusMinutes ?? 25))
        setNotice('专注时长请输入 1 ~ 180 分钟')
        return
      }
      patch.focusMinutes = Math.round(nextFocus)
    }
    if (typeof nextRest === 'number') {
      if (!Number.isFinite(nextRest) || nextRest < 1 || nextRest > 60) {
        setRestMinDraft(String(settings.restMinutes ?? 5))
        setNotice('休息时长请输入 1 ~ 60 分钟')
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
      setNotice('请输入 64 ~ 20480 MB 之间的容量上限')
      return
    }
    const clean = Math.round(mb)
    await applySettingsPatch({ copyLimitMB: clean }, `已将副本容量上限设为 ${formatMb(clean)}`)
  }

  const copyCount = items.filter((i) => i.isCopy).length
  const unavailableIds = items.filter((i) => i.available === false).map((i) => i.id)
  const focusMins = settings.focusMinutes ?? 25
  const restMins = settings.restMinutes ?? 5

  return (
    <div
      className={`panel-shell ${dragOver ? 'is-dragover' : ''}`}
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
            码头 ({items.length})
          </button>
          <button className={tab === 'focus' ? 'active' : ''} onClick={() => setTab('focus')}>
            专注 {focus.phase !== 'idle' ? '●' : ''}
          </button>
          <button className={tab === 'build' ? 'active' : ''} onClick={() => setTab('build')}>
            桌搭
          </button>
        </div>
        <div className="header-right">
          <button
            className={`icon-btn pin-btn ${pinned ? 'is-pinned' : ''}`}
            onClick={async () => {
              const next = await window.isle.setPanelPinned(!pinned)
              setPinned(next)
              setNotice(next ? '已钉住面板（切到其他窗口不会自动收起）' : '已取消钉住面板')
            }}
            title={pinned ? '取消钉住（点击面板外自动收起）' : '钉住面板（切换其他窗口时保持显示）'}
          >
            📌
          </button>
          <button
            className={`icon-btn ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab(tab === 'settings' ? 'dock' : 'settings')}
            title="AI 与应用设置"
          >
            ⚙
          </button>
          <button className="close-btn" onClick={() => window.isle.hidePanel()} title="关闭 (Esc)">
            ✕
          </button>
        </div>
      </header>

      {/* ==================== 1. 码头（文件中转 + AI 分组 + 联合速览 + 查找） ==================== */}
      {tab === 'dock' && (
        <>
          <div className="dock-toolbar">
            <span className="toolbar-hint">
              {selected.size > 0
                ? `已选 ${selected.size} 项 · Ctrl+多选可联合速览`
                : '拖入文件或 Ctrl+V 粘贴截图/文本暂存'}
            </span>
            <div className="toolbar-actions">
              {items.length > 0 && !confirmingClear && (
                <button
                  className="btn-ai"
                  disabled={aiOrganizing || aiJointLoading}
                  onClick={handleAiOrganize}
                  title="读取文件内容，自动按主题分组并生成每份文件的要点速览（不改动原文件）"
                >
                  {aiOrganizing
                    ? '整理中...'
                    : selected.size > 0
                      ? `✦ AI 整理 (${selected.size})`
                      : '✦ AI 整理'}
                </button>
              )}
              {selected.size >= 2 && !confirmingClear && (
                <button
                  className="btn-ai-secondary"
                  disabled={aiJointLoading || aiOrganizing}
                  onClick={handleAiJointSummary}
                  title="联合串读/对比选中的 2～6 份文件，生成可复制的 Markdown 汇总卡"
                >
                  {aiJointLoading ? '串读中...' : '✦ 联合速览'}
                </button>
              )}
              {(aiOrganizing || aiJointLoading) && (
                <button
                  className="btn-cancel-ai"
                  onClick={cancelActiveAi}
                  title="立即中止正在等待的 AI 请求"
                >
                  取消
                </button>
              )}
              {selected.size > 0 && !confirmingClear && !(aiOrganizing || aiJointLoading) && (
                <button onClick={() => window.isle.remove([...selected])}>移除所选</button>
              )}
              {unavailableIds.length > 0 &&
                !confirmingClear &&
                !(aiOrganizing || aiJointLoading) && (
                  <button
                    className="btn-warn-lite"
                    title="移除所有原文件已不存在的失效条目（不删除磁盘文件）"
                    onClick={() => {
                      window.isle.remove(unavailableIds)
                      setNotice(`已清理 ${unavailableIds.length} 个失效条目`)
                    }}
                  >
                    清理失效 ({unavailableIds.length})
                  </button>
                )}
              {items.length > 0 && !confirmingClear && !(aiOrganizing || aiJointLoading) && (
                <button
                  onClick={() => {
                    if (items.length <= 1) window.isle.clear()
                    else setConfirmingClear(true)
                  }}
                >
                  清空
                </button>
              )}
              {confirmingClear && (
                <div className="clear-confirm-inline">
                  <span>清空全部 {items.length} 项？（不删原文件）</span>
                  <button
                    className="btn-danger"
                    onClick={() => {
                      setConfirmingClear(false)
                      window.isle.clear()
                    }}
                  >
                    确认清空
                  </button>
                  <button onClick={() => setConfirmingClear(false)}>取消</button>
                </div>
              )}
            </div>
          </div>

          {items.length > 0 && (
            <div className="dock-search-bar">
              <input
                ref={dockSearchRef}
                value={dockQuery}
                placeholder="🔍 搜索文件名、扩展名、分组或 AI 摘要… (Ctrl+F)"
                onChange={(e) => setDockQuery(e.target.value)}
              />
              {dockQuery && (
                <button
                  className="search-clear-btn"
                  onClick={() => setDockQuery('')}
                  title="清空搜索"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          {selected.size >= 2 && !confirmingClear && (
            <div className="joint-focus-bar">
              <span className="joint-focus-label">✦ 对比侧重：</span>
              <input
                value={jointFocusPrompt}
                placeholder="可选，如：对比报价差异 / 提取共同待办…"
                onChange={(e) => setJointFocusPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !aiJointLoading && !aiOrganizing) handleAiJointSummary()
                }}
              />
            </div>
          )}

          {aiProgressText && (aiOrganizing || aiJointLoading) && (
            <div className="ai-stage-banner">{aiProgressText}</div>
          )}

          <div
            className="dock-list"
            onClick={(e) => {
              if (e.target === e.currentTarget && selected.size > 0) {
                setSelected(new Set())
              }
            }}
          >
            {jointCard && (
              <div className="joint-summary-card">
                <div className="joint-card-head">
                  <div className="joint-card-title-wrap">
                    <div className="joint-card-title">✦ {jointCard.title}</div>
                    <div className="joint-card-files">关联：{jointCard.files.join(' · ')}</div>
                  </div>
                  <div className="joint-card-actions">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(jointCard.markdown)
                        setNotice('已复制 Markdown 汇总内容到剪贴板')
                      }}
                    >
                      复制 MD
                    </button>
                    <button onClick={() => setJointCard(null)} title="收起联合速览卡">
                      ✕
                    </button>
                  </div>
                </div>
                <div className="joint-card-body">{renderMarkdownLite(jointCard.markdown)}</div>
              </div>
            )}

            {items.length === 0 ? (
              <div className="dock-empty">
                <div className="empty-title">码头还是空的</div>
                <div className="empty-sub">
                  把文件从资源管理器或微信拖到小岛或这里暂存，或按 <strong>Ctrl+V</strong> 直接粘贴截图与文本；
                  <br />
                  支持 .docx / .pptx / .xlsx / 文字版 .pdf 与截图识别，选中 2 份以上还可发起「联合速览」。
                </div>
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="dock-empty">
                <div className="empty-title">没有匹配的文件</div>
                <div className="empty-sub">
                  没有找到包含「{dockQuery.trim()}」的暂存条目，点上方 ✕ 可恢复全部列表。
                </div>
              </div>
            ) : (
              groupedSections.map(([groupName, groupItems]) => (
                <div key={groupName || '__ungrouped'} className="dock-group-section">
                  {(groupedSections.length > 1 || groupName) && (
                    <div className="group-header">
                      <span className="group-badge">
                        {groupName ? `📂 ${groupName}` : '未分组'} ({groupItems.length})
                      </span>
                      {groupName && (
                        <button
                          className="group-clear-btn"
                          onClick={() =>
                            window.isle.setItemGroup(
                              groupItems.map((i) => i.id),
                              undefined
                            )
                          }
                          title="取消该分组标签（不删除文件）"
                        >
                          取消分组
                        </button>
                      )}
                    </div>
                  )}

                  {groupItems.map((it) => {
                    const isImg = IMAGE_EXTS.has(it.ext)
                    const isText = !it.isDir && TEXT_PREVIEW_EXTS.has(it.ext)
                    const canPreview = isImg || isText
                    const unavailable = it.available === false
                    const showSummary = expandedSummaryId === it.id
                    return (
                      <div key={it.id} className="dock-item-wrap">
                        <div
                          className={`dock-row ${selected.has(it.id) ? 'selected' : ''} ${
                            unavailable ? 'unavailable' : ''
                          }`}
                          draggable={!unavailable}
                          onClick={(e) => onRowClick(it.id, e)}
                          onDoubleClick={() => onOpen(it)}
                          onDragStart={(e) => onRowDragStart(it, e)}
                        >
                          <div
                            className={`row-thumb ${canPreview && !unavailable ? 'clickable' : ''}`}
                            onClick={(e) => {
                              if (canPreview && !unavailable) {
                                e.stopPropagation()
                                onPreview(it)
                              }
                            }}
                            title={
                              canPreview && !unavailable
                                ? isImg
                                  ? '点击放大预览'
                                  : '点击快速预览文本内容'
                                : undefined
                            }
                          >
                            {thumbs[it.id] ? (
                              <img src={thumbs[it.id]} alt="" draggable={false} />
                            ) : (
                              <span>
                                {it.isDir ? 'DIR' : (it.ext || '文件').slice(0, 4).toUpperCase()}
                              </span>
                            )}
                          </div>

                          <div className="row-main">
                            <div className="row-name" title={it.sourcePath}>
                              {it.name}
                            </div>
                            <div className="row-meta">
                              <span>{it.isDir ? '文件夹' : (it.ext || '文件').toUpperCase()}</span>
                              {!it.isDir && (
                                <>
                                  <span>·</span>
                                  <span>{formatSize(it.size)}</span>
                                </>
                              )}
                              {it.isDir && <span className="tag-dir">快捷引用</span>}
                              {it.isCopy && (
                                <span
                                  className="tag-copy"
                                  title="来自临时/缓存目录，已自动复制一份到码头"
                                >
                                  副本
                                </span>
                              )}
                              {unavailable && <span className="tag-bad">文件不可用</span>}
                              {editingGroupId === it.id ? (
                                <span
                                  className="group-edit-inline"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    value={groupDraft}
                                    placeholder="输入分组名"
                                    autoFocus
                                    onChange={(e) => setGroupDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.currentTarget.blur()
                                      } else if (e.key === 'Escape') {
                                        cancelingGroupEdit.current = true
                                        setEditingGroupId(null)
                                      }
                                    }}
                                    onBlur={() => {
                                      if (cancelingGroupEdit.current) {
                                        cancelingGroupEdit.current = false
                                        return
                                      }
                                      window.isle.setItemGroup([it.id], groupDraft)
                                      setEditingGroupId(null)
                                    }}
                                  />
                                </span>
                              ) : (
                                <button
                                  className="tag-group-btn"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setGroupDraft(it.group ?? '')
                                    setEditingGroupId(it.id)
                                  }}
                                  title="点击修改分组标签"
                                >
                                  {it.group ? `#${it.group}` : '+分组'}
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                            {it.summary && (
                              <button
                                className={showSummary ? 'btn-active' : ''}
                                onClick={() =>
                                  setExpandedSummaryId(showSummary ? null : it.id)
                                }
                                title="查看 AI 文件速览"
                              >
                                速览
                              </button>
                            )}
                            {isText && !unavailable && (
                              <button
                                title="在面板中快速预览文本前段"
                                onClick={() => onPreview(it)}
                              >
                                预览
                              </button>
                            )}
                            {!unavailable && (
                              <button
                                title={
                                  isImg
                                    ? '复制图片到剪贴板'
                                    : isText
                                      ? '复制文本内容到剪贴板'
                                      : '复制文件/文件夹路径'
                                }
                                onClick={() => onCopyItem(it)}
                              >
                                复制
                              </button>
                            )}
                            {!unavailable && (
                              <button
                                title="在资源管理器中定位"
                                onClick={() => window.isle.reveal(it.id)}
                              >
                                定位
                              </button>
                            )}
                            <button
                              title={
                                it.isCopy ? '移除并删除码头副本' : '从码头移除（不删除原文件）'
                              }
                              onClick={() => window.isle.remove([it.id])}
                            >
                              移除
                            </button>
                          </div>
                        </div>

                        {/* AI 文件速览展开卡 */}
                        {showSummary && it.summary && (
                          <div className="summary-card">
                            <div className="summary-head">
                              <span className="summary-read-tag">
                                {it.summary.readStatus === 'full'
                                  ? '✓ 已读全文'
                                  : it.summary.readStatus === 'partial'
                                    ? '◐ 已读取前段正文'
                                    : '○ 仅凭文件名与属性识别（未读取正文）'}
                              </span>
                            </div>
                            <div className="summary-brief">{it.summary.brief}</div>
                            {it.summary.bullets.length > 0 && (
                              <ul className="summary-bullets">
                                {it.summary.bullets.map((b, idx) => (
                                  <li key={idx}>{b}</li>
                                ))}
                              </ul>
                            )}
                            {it.summary.attention && (
                              <div className="summary-attention">
                                <strong>需关注：</strong>
                                {it.summary.attention}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          <footer className="panel-footer">
            <span>
              分组与移除均不改原文件
              {copyCount > 0 && ` · 副本 ${copyCount} 项（${formatSize(usage.used)}）`}
            </span>
            <span>点击文件名旁 +分组 可随时调整</span>
          </footer>
        </>
      )}

      {/* ==================== 2. 专注（独立计时器 + AI 目标拆解） ==================== */}
      {tab === 'focus' && (
        <div className="tab-body">
          <div className="focus-timer-card">
            <div className="timer-phase-badge">
              {focus.phase === 'focus'
                ? '📖 专注陪伴中（水獭保持安静）'
                : focus.phase === 'focus_done'
                  ? '🎉 本轮专注已完成！休息一下吧'
                  : focus.phase === 'rest'
                    ? '☕ 休息放松中'
                    : `⏱ 准备开始新的一轮（${focusMins} 分钟专注 + ${restMins} 分钟休息）`}
            </div>
            <div className="timer-digits">{formatClock(focus.remainingMs)}</div>
            {focus.phase === 'idle' && (
              <div className="focus-duration-bar">
                <div className="focus-presets">
                  {[15, 25, 45, 60].map((m) => (
                    <button
                      key={m}
                      className={focusMins === m ? 'active' : ''}
                      onClick={() => applyFocusDurations(m)}
                    >
                      {m}分
                    </button>
                  ))}
                </div>
                <div className="focus-custom-inputs">
                  <label title="自定义专注时长（1～180 分钟）">
                    <span>专注</span>
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={focusMinDraft}
                      onChange={(e) => setFocusMinDraft(e.target.value)}
                      onBlur={() => applyFocusDurations(Number(focusMinDraft))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') applyFocusDurations(Number(focusMinDraft))
                      }}
                    />
                    <span>分</span>
                  </label>
                  <label title="自定义休息时长（1～60 分钟）">
                    <span>休息</span>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={restMinDraft}
                      onChange={(e) => setRestMinDraft(e.target.value)}
                      onBlur={() => applyFocusDurations(undefined, Number(restMinDraft))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') applyFocusDurations(undefined, Number(restMinDraft))
                      }}
                    />
                    <span>分</span>
                  </label>
                </div>
              </div>
            )}
            <div className="timer-controls">
              {focus.phase === 'idle' && (
                <button
                  className="btn-primary"
                  onClick={async () => {
                    const n = Number(focusMinDraft)
                    const useMins =
                      Number.isFinite(n) && n >= 1 && n <= 180 ? Math.round(n) : focusMins
                    if (useMins !== focusMins) {
                      await applyFocusDurations(useMins)
                    }
                    window.isle.focusControl('start_focus', useMins)
                  }}
                >
                  开始 {Number.isFinite(Number(focusMinDraft)) && Number(focusMinDraft) >= 1 && Number(focusMinDraft) <= 180 ? Math.round(Number(focusMinDraft)) : focusMins} 分钟专注
                </button>
              )}
              {(focus.phase === 'focus' || focus.phase === 'rest') && (
                <>
                  {focus.running ? (
                    <button onClick={() => window.isle.focusControl('pause')}>暂停</button>
                  ) : (
                    <button
                      className="btn-primary"
                      onClick={() => window.isle.focusControl('resume')}
                    >
                      继续
                    </button>
                  )}
                  {focus.phase === 'focus' && (
                    <button onClick={() => window.isle.focusControl('start_rest', restMins)}>
                      转入 {restMins} 分钟休息
                    </button>
                  )}
                  <button onClick={() => window.isle.focusControl('reset')}>结束本轮</button>
                </>
              )}
              {focus.phase === 'focus_done' && (
                <>
                  <button
                    className="btn-primary"
                    onClick={() => window.isle.focusControl('start_rest', restMins)}
                  >
                    开始 {restMins} 分钟休息
                  </button>
                  <button onClick={() => window.isle.focusControl('reset')}>稍后休息</button>
                </>
              )}
            </div>
          </div>

          <div className="focus-plan-box">
            <div className="plan-header-row">
              <div>
                <div className="section-label">本轮小目标与微步骤</div>
                <div className="section-sub">输入想法后可让水獭拆成 3 个小步骤，随时可点字修改</div>
              </div>
              <div className="plan-ai-actions">
                <button
                  className="btn-ai-pill"
                  disabled={aiBreakingDown}
                  onClick={handleAiBreakdown}
                  title={`结合当前目标和勾选的码头文件，生成适合 ${focusMins} 分钟完成的小步骤`}
                >
                  <SparkleIcon />
                  <span>{aiBreakingDown ? '正在拆解...' : 'AI 帮我拆解'}</span>
                </button>
                {aiBreakingDown && (
                  <button className="btn-cancel-ai" onClick={cancelActiveAi}>
                    取消
                  </button>
                )}
              </div>
            </div>

            {aiProgressText && aiBreakingDown && (
              <div className="ai-stage-banner">{aiProgressText}</div>
            )}

            <div className="goal-input-row">
              <input
                value={focus.goal}
                placeholder={`这 ${focusMins} 分钟想推进什么？（例如：读完需求文档并列出 3 个问题）`}
                onChange={(e) => commitFocusPlan(e.target.value, focus.steps)}
                onBlur={flushPendingPlan}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && focus.goal.trim() && focus.steps.length === 0) {
                    handleAiBreakdown()
                  }
                }}
              />
            </div>

            {items.length > 0 && (
              <div className="doc-picker-bar">
                <div className="doc-picker-top">
                  <span className="picker-label">
                    关联资料{focusDocIds.size > 0 ? `（已选 ${focusDocIds.size}）` : ''}：
                  </span>
                  {items.length > 6 && (
                    <input
                      className="picker-filter-input"
                      value={focusDocQuery}
                      placeholder="筛选文件名..."
                      onChange={(e) => setFocusDocQuery(e.target.value)}
                    />
                  )}
                </div>
                <div className="picker-chips">
                  {[...items]
                    .reverse()
                    .filter((it) => {
                      const q = focusDocQuery.trim().toLowerCase()
                      if (!q || focusDocIds.has(it.id)) return true
                      return `${it.name} ${it.group ?? ''}`.toLowerCase().includes(q)
                    })
                    .sort((a, b) => Number(focusDocIds.has(b.id)) - Number(focusDocIds.has(a.id)))
                    .map((it) => {
                      const active = focusDocIds.has(it.id)
                      return (
                        <button
                          key={it.id}
                          className={`doc-chip ${active ? 'active' : ''}`}
                          title={it.name}
                          onClick={() =>
                            setFocusDocIds((prev) => {
                              const next = new Set(prev)
                              if (next.has(it.id)) next.delete(it.id)
                              else next.add(it.id)
                              return next
                            })
                          }
                        >
                          {it.name}
                        </button>
                      )
                    })}
                </div>
              </div>
            )}

            <div className="steps-list">
              {focus.steps.map((st, idx) => (
                <div key={st.id} className={`step-row ${st.done ? 'done' : ''}`}>
                  <input
                    type="checkbox"
                    checked={st.done}
                    onChange={(e) => {
                      const next = focus.steps.map((s, i) =>
                        i === idx ? { ...s, done: e.target.checked } : s
                      )
                      commitFocusPlan(focus.goal, next, true)
                    }}
                  />
                  <input
                    className="step-text-input"
                    value={st.text}
                    onChange={(e) => {
                      const next = focus.steps.map((s, i) =>
                        i === idx ? { ...s, text: e.target.value } : s
                      )
                      commitFocusPlan(focus.goal, next)
                    }}
                    onBlur={flushPendingPlan}
                  />
                  <button
                    className="step-del-btn"
                    onClick={() => {
                      const next = focus.steps.filter((_, i) => i !== idx)
                      commitFocusPlan(focus.goal, next, true)
                    }}
                    title="删除步骤"
                  >
                    ✕
                  </button>
                </div>
              ))}

              <div className="step-add-row">
                <input
                  value={newStepText}
                  placeholder="+ 手动添加一条微步骤，按回车保存"
                  onChange={(e) => setNewStepText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newStepText.trim()) {
                      commitFocusPlan(
                        focus.goal,
                        [
                          ...focus.steps,
                          { id: `${Date.now()}`, text: newStepText.trim(), done: false }
                        ],
                        true
                      )
                      setNewStepText('')
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== 3. 桌搭（自由装饰 + 日夜氛围 + 减压说明） ==================== */}
      {tab === 'build' && (
        <div className="tab-body">
          <div className="ambience-bar">
            <div>
              <div className="section-label">小岛氛围与预设方案</div>
              <div className="preset-btns">
                <button
                  className={decor.ambience === 'day' ? 'active' : ''}
                  onClick={() => window.isle.setDecorations({ ambience: 'day' })}
                >
                  ☀ 白天日光
                </button>
                <button
                  className={decor.ambience === 'night' ? 'active' : ''}
                  onClick={() => window.isle.setDecorations({ ambience: 'night' })}
                >
                  🌙 夜晚暖光
                </button>
                <button
                  className={decor.ambience === 'rain' ? 'active' : ''}
                  onClick={() => window.isle.setDecorations({ ambience: 'rain' })}
                >
                  🌧 细雨听海
                </button>
                <button
                  onClick={() =>
                    applyDecorPreset('day', ['flowers', 'bench', 'tree'], '清爽办公')
                  }
                >
                  清爽办公
                </button>
                <button
                  onClick={() =>
                    applyDecorPreset(
                      'day',
                      ['flowers', 'bench', 'lamp', 'tree', 'cabin', 'windmill'],
                      '田园满岛'
                    )
                  }
                >
                  田园满岛
                </button>
                <button
                  onClick={() =>
                    applyDecorPreset('night', ['bench', 'lamp', 'tree', 'cabin'], '静谧夜读')
                  }
                >
                  静谧夜读
                </button>
                <button
                  onClick={() =>
                    applyDecorPreset('rain', ['bench', 'lamp', 'tree', 'cabin'], '细雨听书')
                  }
                >
                  细雨听书
                </button>
              </div>
            </div>
          </div>

          <div className="deco-grid">
            {DECO_META.map((d) => {
              const on = decor.enabled[d.id]
              return (
                <div
                  key={d.id}
                  className={`deco-card ${on ? 'is-on' : ''}`}
                  onClick={() =>
                    window.isle.setDecorations({
                      enabled: { ...decor.enabled, [d.id]: !on }
                    })
                  }
                >
                  <div className="deco-icon">{d.icon}</div>
                  <div className="deco-info">
                    <div className="deco-name">{d.name}</div>
                    <div className="deco-desc">{d.desc}</div>
                  </div>
                  <div className={`deco-switch ${on ? 'on' : ''}`}>{on ? '显示中' : '已收起'}</div>
                </div>
              )
            })}
          </div>

          <div className="ai-decor-box">
            <input
              value={decorMood}
              placeholder="输入心情让水獭推荐搭配（如：适合深夜安静写代码）"
              onChange={(e) => setDecorMood(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAiDecor()
              }}
            />
            <button className="btn-ai-pill" disabled={aiDecorating} onClick={handleAiDecor}>
              <SparkleIcon />
              <span>{aiDecorating ? '搭配中...' : 'AI 推荐布置'}</span>
            </button>
            {aiDecorating && (
              <button className="btn-cancel-ai" onClick={cancelActiveAi}>
                取消
              </button>
            )}
          </div>

          <div className="relax-tips-card">
            <strong>🌊 岛上丰富互动（展开小岛时直接点景物即可触发）：</strong>
            <span>
              · 点<strong>草地任意处</strong>：长出小雏菊并召唤水獭跑过去 · 点<strong>木长椅</strong>：水獭去坐下吹风
              <br />· 点<strong>圆冠树</strong>：摇落绿叶 · 点<strong>野花丛</strong>：飞出蝴蝶 · 点<strong>小木屋</strong>：炊烟与暖窗
              <br />· 点<strong>野餐茶席</strong>：水獭喝茶吃点心 · 点<strong>海水 / 小纸船</strong>：泛起涟漪与放漂纸船
            </span>
          </div>
        </div>
      )}

      {/* ==================== 4. 设置（通用停靠、存储上限与 AI 配置） ==================== */}
      {tab === 'settings' && (
        <div className="tab-body">
          <div className="settings-card">
            <div className="section-label">通用与停靠设置</div>

            <label className="toggle-row">
              <div>
                <div className="toggle-title">窗口始终置顶</div>
                <div className="toggle-desc">让小岛浮窗保持在其他桌面应用前方（同步系统托盘）</div>
              </div>
              <input
                type="checkbox"
                checked={settings.alwaysOnTop}
                onChange={(e) =>
                  applySettingsPatch(
                    { alwaysOnTop: e.target.checked },
                    e.target.checked ? '已开启小岛置顶' : '已取消小岛置顶'
                  )
                }
              />
            </label>

            <label className={`toggle-row ${!appEnv.isPackaged ? 'is-disabled' : ''}`}>
              <div>
                <div className="toggle-title">
                  开机自动启动 {!appEnv.isPackaged && <span className="pill-muted">打包后可用</span>}
                </div>
                <div className="toggle-desc">登录 Windows 时自动在后台启动停靠岛</div>
              </div>
              <input
                type="checkbox"
                disabled={!appEnv.isPackaged}
                checked={settings.openAtLogin}
                onChange={(e) =>
                  applySettingsPatch(
                    { openAtLogin: e.target.checked },
                    e.target.checked ? '已开启开机自启' : '已关闭开机自启'
                  )
                }
              />
            </label>

            <label className="toggle-row">
              <div>
                <div className="toggle-title">专注与休息结束轻柔提醒</div>
                <div className="toggle-desc">计时结束时播送轻柔三音铃声并弹出系统桌面通知</div>
              </div>
              <input
                type="checkbox"
                checked={settings.focusNotify !== false}
                onChange={(e) =>
                  applySettingsPatch(
                    { focusNotify: e.target.checked },
                    e.target.checked ? '已开启专注结束轻柔提醒' : '已静音专注结束提醒'
                  )
                }
              />
            </label>

            <div className="copy-limit-box">
              <div className="copy-limit-head">
                <span className="toggle-title">临时目录副本容量上限</span>
                <span className="copy-usage-text">
                  已用 {formatSize(usage.used)} / {formatMb(settings.copyLimitMB)}
                </span>
              </div>
              <div className="usage-bar-track">
                <div
                  className="usage-bar-fill"
                  style={{
                    width: `${
                      usage.limit > 0
                        ? Math.min(100, Math.round((usage.used / usage.limit) * 100))
                        : 0
                    }%`
                  }}
                />
              </div>
              <div className="preset-btns">
                {[512, 1024, 2048, 4096].map((mb) => (
                  <button
                    key={mb}
                    className={settings.copyLimitMB === mb ? 'active' : ''}
                    onClick={() => applyCopyLimitMB(mb)}
                  >
                    {formatMb(mb)}
                  </button>
                ))}
                <div className="limit-custom-inline">
                  <input
                    type="number"
                    min={64}
                    max={20480}
                    value={copyLimitDraft}
                    onChange={(e) => setCopyLimitDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyCopyLimitMB(Number(copyLimitDraft))
                    }}
                  />
                  <span>MB</span>
                  <button onClick={() => applyCopyLimitMB(Number(copyLimitDraft))}>应用</button>
                </div>
              </div>
            </div>

            <div className="settings-quick-row">
              <button
                onClick={() => {
                  window.isle.resetPosition('left')
                  setNotice('小岛已停靠至屏幕左边缘')
                }}
              >
                停靠左边缘
              </button>
              <button
                onClick={() => {
                  window.isle.resetPosition('right')
                  setNotice('小岛已停靠至屏幕右边缘')
                }}
              >
                停靠右边缘
              </button>
              <button onClick={() => window.isle.openDataDir()}>打开数据目录</button>
              <span className="shortcut-hint" title="全局显隐快捷键">
                快捷键：{appEnv.shortcut.replace('Control+', 'Ctrl+')}
              </span>
            </div>
          </div>

          <div className="settings-card">
            <div className="section-label">AI 水獭搭档接口配置（保存在本地，不写入日志）</div>
            <div className="preset-btns">
              <span>快速填入模板：</span>
              {AI_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => {
                    aiDirtyRef.current = true
                    setAiCfg((prev) => ({ ...prev, baseUrl: p.baseUrl, model: p.model }))
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <label className="field-label">
              <span>接口地址 (Base URL，兼容 OpenAI `/v1/chat/completions`)</span>
              <input
                value={aiCfg.baseUrl}
                placeholder="https://api.deepseek.com/v1"
                onChange={(e) => {
                  aiDirtyRef.current = true
                  setAiCfg({ ...aiCfg, baseUrl: e.target.value })
                }}
              />
            </label>

            <label className="field-label">
              <span>模型名称 (Model)</span>
              <input
                value={aiCfg.model}
                placeholder="deepseek-chat / qwen-plus / gpt-4o-mini"
                onChange={(e) => {
                  aiDirtyRef.current = true
                  setAiCfg({ ...aiCfg, model: e.target.value })
                }}
              />
            </label>

            <label className="field-label">
              <span>API 密钥 (API Key，Ollama / LM Studio 本地模型可留空)</span>
              <input
                type="password"
                value={aiCfg.apiKey}
                placeholder="sk-...（本地模型可留空）"
                onChange={(e) => {
                  aiDirtyRef.current = true
                  setAiCfg({ ...aiCfg, apiKey: e.target.value })
                }}
              />
            </label>

            <label className="toggle-row">
              <div>
                <div className="toggle-title">启用截图 / 图片识别（Vision 多模态）</div>
                <div className="toggle-desc">
                  开启后整理或联合速览时将图片压缩后发给模型读图（需模型支持视觉，如 gpt-4o-mini / qwen-vl）
                </div>
              </div>
              <input
                type="checkbox"
                checked={!!aiCfg.enableVision}
                onChange={(e) => {
                  aiDirtyRef.current = true
                  setAiCfg({ ...aiCfg, enableVision: e.target.checked })
                }}
              />
            </label>

            <div className="settings-actions">
              <button
                className="btn-primary"
                onClick={async () => {
                  await window.isle.saveAiConfig(aiCfg)
                  aiDirtyRef.current = false
                  setNotice('已保存 AI 配置')
                }}
              >
                保存配置
              </button>
              <button
                disabled={testingAi}
                onClick={async () => {
                  setTestingAi(true)
                  try {
                    await window.isle.saveAiConfig(aiCfg)
                    aiDirtyRef.current = false
                    const res = await window.isle.testAiConnection(aiCfg)
                    setNotice(res.message)
                  } finally {
                    setTestingAi(false)
                  }
                }}
              >
                {testingAi ? '测试中...' : '测试连接'}
              </button>
            </div>
            <div className="settings-note">
              未配置密钥或网络异常时，文件中转、自由桌搭、减压互动与专注计时仍可正常离线使用。
            </div>
          </div>
        </div>
      )}

      {notice && <div className="panel-notice">{notice}</div>}

      {preview && (
        <div className="preview-mask" onClick={() => setPreview(null)}>
          <div className="preview-box" onClick={(e) => e.stopPropagation()}>
            {preview.src && <img src={preview.src} alt={preview.item.name} draggable={false} />}
            {preview.text !== undefined && (
              <div className="preview-text-wrap">
                {preview.truncated && (
                  <div className="preview-truncated-tag">内容较长，仅预览前 64 KB</div>
                )}
                <pre className="preview-text-pre">{preview.text || '（空文件）'}</pre>
              </div>
            )}
            <div className="preview-bar">
              <span>{preview.item.name}</span>
              <div className="preview-bar-actions">
                <button onClick={() => onCopyItem(preview.item)}>复制</button>
                <button onClick={() => onOpen(preview.item)}>用默认程序打开</button>
                <button onClick={() => setPreview(null)}>关闭</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function formatMb(mb: number): string {
  if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024} GB`
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

function formatClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function renderInlineBold(text: string): Array<string | JSX.Element> {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') && p.length > 4 ? (
      <strong key={i}>{p.slice(2, -2)}</strong>
    ) : (
      p
    )
  )
}

function renderMarkdownLite(md: string): JSX.Element[] {
  return md.split(/\r?\n/).map((raw, idx) => {
    const line = raw.trim()
    if (!line) return <div key={idx} className="md-gap" />
    if (line.startsWith('### ')) {
      return (
        <h4 key={idx} className="md-h">
          {renderInlineBold(line.slice(4))}
        </h4>
      )
    }
    if (line.startsWith('## ') || line.startsWith('# ')) {
      return (
        <h3 key={idx} className="md-h">
          {renderInlineBold(line.replace(/^#+\s*/, ''))}
        </h3>
      )
    }
    if (/^[-*•]\s+/.test(line)) {
      return (
        <div key={idx} className="md-li">
          <span className="md-dot">•</span>
          <span>{renderInlineBold(line.replace(/^[-*•]\s+/, ''))}</span>
        </div>
      )
    }
    return (
      <p key={idx} className="md-p">
        {renderInlineBold(line)}
      </p>
    )
  })
}

function SparkleIcon(): JSX.Element {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 1.5 C8.6 5.2 10.8 7.4 14.5 8 C10.8 8.6 8.6 10.8 8 14.5 C7.4 10.8 5.2 8.6 1.5 8 C5.2 7.4 7.4 5.2 8 1.5 Z"
        fill="#527a43"
        stroke="#36562c"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
    </svg>
  )
}
