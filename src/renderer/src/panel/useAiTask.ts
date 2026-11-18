import { useEffect, useRef, useState } from 'react'
import type { AiTaskKind } from '../../../shared/types'

export interface ActiveAiTask {
  seq: number
  taskId: string
  kind: AiTaskKind
  stageText: string
}

/**
 * 统一管理面板内的 AI 任务状态机与主进程实时阶段进度：
 * - 同时最多仅展示一个活动任务，切页发起新任务自动使旧任务序号失效；
 * - 过期任务无论成功、取消或异常均严格丢弃，避免残留旧加载态或错乱提示。
 */
export function useAiTask(onNotice: (msg: string) => void): {
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
    onNotice('正在取消 AI 请求...')
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
