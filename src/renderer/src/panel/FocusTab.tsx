import { useState } from 'react'
import type { DockItem, FocusState, FocusStep } from '../../../shared/types'
import { SparkleIcon, formatClock } from './panelShared'

interface FocusTabProps {
  focus: FocusState
  items: DockItem[]
  focusMins: number
  restMins: number
  focusMinDraft: string
  setFocusMinDraft: (val: string) => void
  restMinDraft: string
  setRestMinDraft: (val: string) => void
  focusDocIds: Set<string>
  setFocusDocIds: React.Dispatch<React.SetStateAction<Set<string>>>
  focusDocQuery: string
  setFocusDocQuery: (val: string) => void
  providerLabel: string
  aiBreakingDown: boolean
  aiProgressText: string
  onApplyFocusDurations: (nextFocus?: number, nextRest?: number) => Promise<void>
  onCommitFocusPlan: (goal: string, steps: FocusStep[], immediate?: boolean) => void
  onFlushPendingPlan: () => void
  onAiBreakdown: () => void
  onCancelAi: () => void
}

export function FocusTab(props: FocusTabProps): JSX.Element {
  const {
    focus,
    items,
    focusMins,
    restMins,
    focusMinDraft,
    setFocusMinDraft,
    restMinDraft,
    setRestMinDraft,
    focusDocIds,
    setFocusDocIds,
    focusDocQuery,
    setFocusDocQuery,
    providerLabel,
    aiBreakingDown,
    aiProgressText,
    onApplyFocusDurations,
    onCommitFocusPlan,
    onFlushPendingPlan,
    onAiBreakdown,
    onCancelAi
  } = props

  const [newStepText, setNewStepText] = useState('')

  return (
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
                  onClick={() => onApplyFocusDurations(m)}
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
                  onBlur={() => onApplyFocusDurations(Number(focusMinDraft))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onApplyFocusDurations(Number(focusMinDraft))
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
                  onBlur={() => onApplyFocusDurations(undefined, Number(restMinDraft))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onApplyFocusDurations(undefined, Number(restMinDraft))
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
                  await onApplyFocusDurations(useMins)
                }
                window.isle.focusControl('start_focus', useMins)
              }}
            >
              开始{' '}
              {Number.isFinite(Number(focusMinDraft)) &&
              Number(focusMinDraft) >= 1 &&
              Number(focusMinDraft) <= 180
                ? Math.round(Number(focusMinDraft))
                : focusMins}{' '}
              分钟专注
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
            <div className="section-sub">
              发送至 {providerLabel} ·{' '}
              {focusDocIds.size > 0
                ? `目标 + 已选 ${focusDocIds.size} 份资料`
                : '仅发送目标文本（不自动附带文件）'}
            </div>
          </div>
          <div className="plan-ai-actions">
            <button
              className="btn-ai-pill"
              disabled={aiBreakingDown}
              onClick={onAiBreakdown}
              title={`使用 ${providerLabel} 拆解为 ${focusMins} 分钟步骤（${
                focusDocIds.size > 0
                  ? `附带已选的 ${focusDocIds.size} 份资料`
                  : '仅发送目标，不附带文件'
              }）`}
            >
              <SparkleIcon />
              <span>{aiBreakingDown ? '正在拆解...' : 'AI 帮我拆解'}</span>
            </button>
            {aiBreakingDown && (
              <button className="btn-cancel-ai" onClick={onCancelAi}>
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
            onChange={(e) => onCommitFocusPlan(e.target.value, focus.steps)}
            onBlur={onFlushPendingPlan}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && focus.goal.trim() && focus.steps.length === 0) {
                onAiBreakdown()
              }
            }}
          />
        </div>

        {items.length > 0 && (
          <div className="doc-picker-bar">
            <div className="doc-picker-top">
              <span className="picker-label">
                关联资料
                {focusDocIds.size > 0 ? `（已选 ${focusDocIds.size}）` : '（未选，仅发送目标）'}：
              </span>
              <div className="picker-quick-actions">
                {focusDocIds.size === 0 ? (
                  <button
                    className="picker-quick-btn"
                    onClick={() => setFocusDocIds(new Set(items.slice(-5).map((i) => i.id)))}
                    title="主动勾选码头最近加入的最多 5 份文件"
                  >
                    + 选入最近 {Math.min(5, items.length)} 份
                  </button>
                ) : (
                  <button
                    className="picker-quick-btn"
                    onClick={() => setFocusDocIds(new Set())}
                  >
                    清空已选
                  </button>
                )}
              </div>
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
                  onCommitFocusPlan(focus.goal, next, true)
                }}
              />
              <input
                className="step-text-input"
                value={st.text}
                onChange={(e) => {
                  const next = focus.steps.map((s, i) =>
                    i === idx ? { ...s, text: e.target.value } : s
                  )
                  onCommitFocusPlan(focus.goal, next)
                }}
                onBlur={onFlushPendingPlan}
              />
              <button
                className="step-del-btn"
                onClick={() => {
                  const next = focus.steps.filter((_, i) => i !== idx)
                  onCommitFocusPlan(focus.goal, next, true)
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
                  onCommitFocusPlan(
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
  )
}
