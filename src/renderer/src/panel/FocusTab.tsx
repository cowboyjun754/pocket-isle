import { useState } from 'react'
import { getMessages } from '../../../shared/i18n'
import type { AppLocale, DockItem, FocusState, FocusStep } from '../../../shared/types'
import { SparkleIcon, formatClock } from './panelShared'

interface FocusTabProps {
  locale: AppLocale
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
    locale,
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

  const fm = getMessages(locale).panel.focus
  const [newStepText, setNewStepText] = useState('')
  const draftFocusMins =
    Number.isFinite(Number(focusMinDraft)) &&
    Number(focusMinDraft) >= 1 &&
    Number(focusMinDraft) <= 180
      ? Math.round(Number(focusMinDraft))
      : focusMins

  return (
    <div className="tab-body">
      <div className="focus-timer-card">
        <div className="timer-phase-badge">
          {focus.phase === 'focus'
            ? fm.phaseFocus
            : focus.phase === 'focus_done'
              ? fm.phaseDone
              : focus.phase === 'rest'
                ? fm.phaseRest
                : fm.phaseIdle(focusMins, restMins)}
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
                  {fm.presetMinSuffix(m)}
                </button>
              ))}
            </div>
            <div className="focus-custom-inputs">
              <label title={fm.customFocusTitle}>
                <span>{fm.customFocusLabel}</span>
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
                <span>{fm.minUnit}</span>
              </label>
              <label title={fm.customRestTitle}>
                <span>{fm.customRestLabel}</span>
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
                <span>{fm.minUnit}</span>
              </label>
            </div>
          </div>
        )}
        <div className="timer-controls">
          {focus.phase === 'idle' && (
            <button
              className="btn-primary"
              onClick={async () => {
                if (draftFocusMins !== focusMins) {
                  await onApplyFocusDurations(draftFocusMins)
                }
                window.isle.focusControl('start_focus', draftFocusMins)
              }}
            >
              {fm.startFocusBtn(draftFocusMins)}
            </button>
          )}
          {(focus.phase === 'focus' || focus.phase === 'rest') && (
            <>
              {focus.running ? (
                <button onClick={() => window.isle.focusControl('pause')}>{fm.pauseBtn}</button>
              ) : (
                <button
                  className="btn-primary"
                  onClick={() => window.isle.focusControl('resume')}
                >
                  {fm.resumeBtn}
                </button>
              )}
              {focus.phase === 'focus' && (
                <button onClick={() => window.isle.focusControl('start_rest', restMins)}>
                  {fm.switchRestBtn(restMins)}
                </button>
              )}
              <button onClick={() => window.isle.focusControl('reset')}>{fm.resetBtn}</button>
            </>
          )}
          {focus.phase === 'focus_done' && (
            <>
              <button
                className="btn-primary"
                onClick={() => window.isle.focusControl('start_rest', restMins)}
              >
                {fm.startRestBtn(restMins)}
              </button>
              <button onClick={() => window.isle.focusControl('reset')}>{fm.restLaterBtn}</button>
            </>
          )}
        </div>
      </div>

      <div className="focus-plan-box">
        <div className="plan-header-row">
          <div>
            <div className="section-label">{fm.planTitle}</div>
            <div className="section-sub">{fm.planSub(providerLabel, focusDocIds.size)}</div>
          </div>
          <div className="plan-ai-actions">
            <button
              className="btn-ai-pill"
              disabled={aiBreakingDown}
              onClick={onAiBreakdown}
              title={fm.breakdownTitle(providerLabel, focusMins, focusDocIds.size)}
            >
              <SparkleIcon />
              <span>{aiBreakingDown ? fm.breakingBtn : fm.breakdownBtn}</span>
            </button>
            {aiBreakingDown && (
              <button className="btn-cancel-ai" onClick={onCancelAi}>
                {fm.cancelBtn}
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
            placeholder={fm.goalPlaceholder(focusMins)}
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
              <span className="picker-label">{fm.pickerLabel(focusDocIds.size)}</span>
              <div className="picker-quick-actions">
                {focusDocIds.size === 0 ? (
                  <button
                    className="picker-quick-btn"
                    onClick={() => setFocusDocIds(new Set(items.slice(-5).map((i) => i.id)))}
                    title={fm.pickRecentTitle}
                  >
                    {fm.pickRecentBtn(Math.min(5, items.length))}
                  </button>
                ) : (
                  <button
                    className="picker-quick-btn"
                    onClick={() => setFocusDocIds(new Set())}
                  >
                    {fm.clearPickedBtn}
                  </button>
                )}
              </div>
              {items.length > 6 && (
                <input
                  className="picker-filter-input"
                  value={focusDocQuery}
                  placeholder={fm.filterPlaceholder}
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
                title={fm.delStepTitle}
              >
                ✕
              </button>
            </div>
          ))}

          <div className="step-add-row">
            <input
              value={newStepText}
              placeholder={fm.addStepPlaceholder}
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
