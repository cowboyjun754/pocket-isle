import { useEffect, useRef, useState } from 'react'
import { DEFAULT_LOCALE, getMessages } from '../../../shared/i18n'
import type { AiTaskKind, AppLocale } from '../../../shared/types'

export interface ActiveAiTask {
  seq: number
  taskId: string
  kind: AiTaskKind
  stageText: string
}

/**
 * Centralized panel AI task state machine synced with main-process progress updates:
 * - Shows at most one active task at a time; launching a new task invalidates previous sequence IDs;
 * - Stale completions, cancellations, or errors are dropped cleanly without leaving orphan UI state.
 */
export function useAiTask(
  onNotice: (msg: string) => void,
  locale: AppLocale = DEFAULT_LOCALE
): {
  activeTask: ActiveAiTask | null
  aiOrganizing: boolean
  aiJointLoading: boolean
  aiBreakingDown: boolean
  aiDecorating: boolean
  aiProgressText: string
  isCurrentSeq: (seq: number) => boolean
  beginAiTask: (kind: AiTaskKind, initialStage: string) => { seq: number; taskId: string }
  finishAiTask: (seq: number) => void
  cancelActiveAi: () => void
} {
  const [activeTask, setActiveTask] = useState<ActiveAiTask | null>(null)
  const reqSeqRef = useRef(0)
  const activeTaskRef = useRef(activeTask)
  activeTaskRef.current = activeTask

  useEffect(() => {
    return window.isle.onAiProgress((p) => {
      if (activeTaskRef.current?.taskId === p.taskId) {
        setActiveTask((cur) => (cur && cur.taskId === p.taskId ? { ...cur, stageText: p.stage } : cur))
      }
    })
  }, [])

  const beginAiTask = (
    kind: AiTaskKind,
    initialStage: string
  ): { seq: number; taskId: string } => {
    const seq = ++reqSeqRef.current
    const taskId = `${kind}-${Date.now()}-${seq}`
    setActiveTask({ seq, taskId, kind, stageText: initialStage })
    return { seq, taskId }
  }

  const finishAiTask = (seq: number): void => {
    if (reqSeqRef.current === seq) {
      setActiveTask(null)
    }
  }

  const cancelActiveAi = (): void => {
    ++reqSeqRef.current
    window.isle.cancelAi()
    setActiveTask(null)
    onNotice(getMessages(locale).ai.progress.cancelNotice)
  }

  const isCurrentSeq = (seq: number): boolean => reqSeqRef.current === seq

  return {
    activeTask,
    aiOrganizing: activeTask?.kind === 'organize',
    aiJointLoading: activeTask?.kind === 'joint',
    aiBreakingDown: activeTask?.kind === 'breakdown',
    aiDecorating: activeTask?.kind === 'decor',
    aiProgressText: activeTask?.stageText ?? '',
    isCurrentSeq,
    beginAiTask,
    finishAiTask,
    cancelActiveAi
  }
}
