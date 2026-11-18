import type { MutableRefObject, RefObject } from 'react'
import { getMessages } from '../../../shared/i18n'
import type { AppLocale, DockItem, DockUndoState } from '../../../shared/types'
import { IMAGE_EXTS, TEXT_PREVIEW_EXTS, formatSize } from '../util'
import { renderMarkdownLite, type JointCardState } from './panelShared'

interface DockTabProps {
  locale: AppLocale
  items: DockItem[]
  filteredItems: DockItem[]
  groupedSections: Array<[string, DockItem[]]>
  selected: Set<string>
  setSelected: (next: Set<string>) => void
  thumbs: Record<string, string>
  usage: { used: number; limit: number }
  copyCount: number
  unavailableIds: string[]
  providerLabel: string
  organizeScope: {
    targetIds: string[] | undefined
    count: number
    mode: 'selected' | 'filtered' | 'all'
  }
  dockQuery: string
  setDockQuery: (val: string) => void
  dockSearchRef: RefObject<HTMLInputElement>
  jointFocusPrompt: string
  setJointFocusPrompt: (val: string) => void
  jointCard: JointCardState | null
  setJointCard: (card: JointCardState | null) => void
  expandedSummaryId: string | null
  setExpandedSummaryId: (id: string | null) => void
  editingGroupId: string | null
  setEditingGroupId: (id: string | null) => void
  groupDraft: string
  setGroupDraft: (val: string) => void
  cancelingGroupEdit: MutableRefObject<boolean>
  confirmingClear: boolean
  setConfirmingClear: (v: boolean) => void
  dockUndo: DockUndoState | null
  onDismissUndo: () => void
  onUndoRemove: () => void
  aiOrganizing: boolean
  aiJointLoading: boolean
  aiProgressText: string
  onAiOrganize: () => void
  onAiJointSummary: () => void
  onCancelAi: () => void
  onRowClick: (id: string, e: React.MouseEvent) => void
  onRowDragStart: (it: DockItem, e: React.DragEvent) => void
  onOpen: (it: DockItem) => void
  onPreview: (it: DockItem) => void
  onCopyItem: (it: DockItem) => void
  onNotice: (msg: string) => void
}

export function DockTab(props: DockTabProps): JSX.Element {
  const {
    locale,
    items,
    filteredItems,
    groupedSections,
    selected,
    setSelected,
    thumbs,
    usage,
    copyCount,
    unavailableIds,
    providerLabel,
    organizeScope,
    dockQuery,
    setDockQuery,
    dockSearchRef,
    jointFocusPrompt,
    setJointFocusPrompt,
    jointCard,
    setJointCard,
    expandedSummaryId,
    setExpandedSummaryId,
    editingGroupId,
    setEditingGroupId,
    groupDraft,
    setGroupDraft,
    cancelingGroupEdit,
    confirmingClear,
    setConfirmingClear,
    dockUndo,
    onDismissUndo,
    onUndoRemove,
    aiOrganizing,
    aiJointLoading,
    aiProgressText,
    onAiOrganize,
    onAiJointSummary,
    onCancelAi,
    onRowClick,
    onRowDragStart,
    onOpen,
    onPreview,
    onCopyItem,
    onNotice
  } = props

  const dm = getMessages(locale).panel.dock

  return (
    <>
      <div className="dock-toolbar">
        <span className="toolbar-hint">
          {selected.size > 0 ? dm.selectedHint(selected.size) : dm.defaultHint}
        </span>
        <div className="toolbar-actions">
          {items.length > 0 && !confirmingClear && (
            <button
              className="btn-ai"
              disabled={aiOrganizing || aiJointLoading || organizeScope.count === 0}
              onClick={onAiOrganize}
              title={dm.organizeTitle(providerLabel, organizeScope.mode, organizeScope.count)}
            >
              {aiOrganizing
                ? dm.organizingBtn
                : organizeScope.mode === 'selected'
                  ? dm.organizeSelected(organizeScope.count)
                  : organizeScope.mode === 'filtered'
                    ? dm.organizeFiltered(organizeScope.count)
                    : dm.organizeAll(organizeScope.count)}
            </button>
          )}
          {selected.size >= 2 && !confirmingClear && (
            <button
              className="btn-ai-secondary"
              disabled={aiJointLoading || aiOrganizing}
              onClick={onAiJointSummary}
              title={dm.jointTitle(providerLabel, Math.min(selected.size, 6))}
            >
              {aiJointLoading ? dm.jointLoadingBtn : dm.jointBtn(Math.min(selected.size, 6))}
            </button>
          )}
          {(aiOrganizing || aiJointLoading) && (
            <button className="btn-cancel-ai" onClick={onCancelAi} title={dm.cancelAiTitle}>
              {dm.cancelBtn}
            </button>
          )}
          {selected.size > 0 && !confirmingClear && !(aiOrganizing || aiJointLoading) && (
            <button onClick={() => window.isle.remove([...selected])}>{dm.removeSelected}</button>
          )}
          {unavailableIds.length > 0 &&
            !confirmingClear &&
            !(aiOrganizing || aiJointLoading) && (
              <button
                className="btn-warn-lite"
                title={dm.cleanInvalidTitle}
                onClick={() => {
                  window.isle.remove(unavailableIds)
                  onNotice(dm.cleanedInvalidMsg(unavailableIds.length))
                }}
              >
                {dm.cleanInvalidBtn(unavailableIds.length)}
              </button>
            )}
          {items.length > 0 && !confirmingClear && !(aiOrganizing || aiJointLoading) && (
            <button
              onClick={() => {
                if (items.length <= 1 && copyCount === 0) window.isle.clear()
                else setConfirmingClear(true)
              }}
            >
              {dm.clearBtn}
            </button>
          )}
          {confirmingClear && (
            <div className="clear-confirm-inline">
              <span>
                {copyCount > 0
                  ? dm.clearConfirmCopies(items.length, copyCount)
                  : dm.clearConfirmRefs(items.length)}
              </span>
              <button
                className="btn-danger"
                onClick={() => {
                  setConfirmingClear(false)
                  window.isle.clear()
                }}
              >
                {dm.confirmClearBtn}
              </button>
              <button onClick={() => setConfirmingClear(false)}>{dm.cancelBtn}</button>
            </div>
          )}
        </div>
      </div>

      {items.length > 0 && (
        <div className="dock-search-bar">
          <input
            ref={dockSearchRef}
            value={dockQuery}
            placeholder={dm.searchPlaceholder}
            onChange={(e) => setDockQuery(e.target.value)}
          />
          {dockQuery && (
            <button
              className="search-clear-btn"
              onClick={() => setDockQuery('')}
              title={dm.clearSearchTitle}
            >
              ✕
            </button>
          )}
        </div>
      )}

      {selected.size >= 2 && !confirmingClear && (
        <div className="joint-focus-bar">
          <span className="joint-focus-label">{dm.jointFocusLabel}</span>
          <input
            value={jointFocusPrompt}
            placeholder={dm.jointFocusPlaceholder}
            onChange={(e) => setJointFocusPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !aiJointLoading && !aiOrganizing) onAiJointSummary()
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
                <div className="joint-card-files">
                  {jointCard.receipts?.length
                    ? jointCard.receipts
                        .map((f) => {
                          if (f.imageAttached === true) return dm.receiptImgAttached(f.name)
                          if (f.imageAttached === false) return dm.receiptImgUnattached(f.name)
                          if (f.readStatus === 'full') return dm.receiptFull(f.name)
                          if (f.readStatus === 'partial') {
                            return dm.receiptPartial(f.name, f.readNote)
                          }
                          return dm.receiptMeta(f.name)
                        })
                        .join(' · ')
                    : dm.receiptRelated(jointCard.files.join(' · '))}
                </div>
              </div>
              <div className="joint-card-actions">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(jointCard.markdown)
                    onNotice(dm.copiedMdMsg)
                  }}
                >
                  {dm.copyMdBtn}
                </button>
                <button onClick={() => setJointCard(null)} title={dm.closeJointTitle}>
                  ✕
                </button>
              </div>
            </div>
            <div className="joint-card-body">{renderMarkdownLite(jointCard.markdown)}</div>
          </div>
        )}

        {items.length === 0 ? (
          <div className="dock-empty">
            <div className="empty-title">{dm.emptyTitle}</div>
            <div className="empty-sub">
              {dm.emptySubLine1Before}
              <strong>Ctrl+V</strong>
              {dm.emptySubLine1After}
              <br />
              {dm.emptySubLine2}
            </div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="dock-empty">
            <div className="empty-title">{dm.noMatchTitle}</div>
            <div className="empty-sub">{dm.noMatchSub(dockQuery.trim())}</div>
          </div>
        ) : (
          groupedSections.map(([groupName, groupItems]) => (
            <div key={groupName || '__ungrouped'} className="dock-group-section">
              {(groupedSections.length > 1 || groupName) && (
                <div className="group-header">
                  <span className="group-badge">
                    {groupName ? `📂 ${groupName}` : dm.ungrouped} ({groupItems.length})
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
                      title={dm.ungroupTitle}
                    >
                      {dm.ungroupBtn}
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
                              ? dm.thumbImgTitle
                              : dm.thumbTextTitle
                            : undefined
                        }
                      >
                        {thumbs[it.id] ? (
                          <img src={thumbs[it.id]} alt="" draggable={false} />
                        ) : (
                          <span>
                            {it.isDir
                              ? 'DIR'
                              : (it.ext || dm.extFileFallback).slice(0, 4).toUpperCase()}
                          </span>
                        )}
                      </div>

                      <div className="row-main">
                        <div className="row-name" title={it.sourcePath}>
                          {it.name}
                        </div>
                        <div className="row-meta">
                          <span>
                            {it.isDir ? dm.dirLabel : (it.ext || dm.extFileFallback).toUpperCase()}
                          </span>
                          {!it.isDir && (
                            <>
                              <span>·</span>
                              <span>{formatSize(it.size)}</span>
                            </>
                          )}
                          {it.isDir && <span className="tag-dir">{dm.dirTag}</span>}
                          {it.isCopy && (
                            <span className="tag-copy" title={dm.copyTagTitle}>
                              {dm.copyTag}
                            </span>
                          )}
                          {unavailable && <span className="tag-bad">{dm.unavailableTag}</span>}
                          {editingGroupId === it.id ? (
                            <span
                              className="group-edit-inline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                value={groupDraft}
                                placeholder={dm.groupPlaceholder}
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
                              title={dm.groupBtnTitle}
                            >
                              {it.group ? `#${it.group}` : dm.addGroupBtn}
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
                            title={dm.summaryBtnTitle}
                          >
                            {dm.summaryBtn}
                          </button>
                        )}
                        {isText && !unavailable && (
                          <button title={dm.previewBtnTitle} onClick={() => onPreview(it)}>
                            {dm.previewBtn}
                          </button>
                        )}
                        {!unavailable && (
                          <button
                            title={
                              isImg
                                ? dm.copyImgTitle
                                : isText
                                  ? dm.copyTextTitle
                                  : dm.copyPathTitle
                            }
                            onClick={() => onCopyItem(it)}
                          >
                            {dm.copyBtn}
                          </button>
                        )}
                        {!unavailable && (
                          <button title={dm.revealTitle} onClick={() => window.isle.reveal(it.id)}>
                            {dm.revealBtn}
                          </button>
                        )}
                        <button
                          title={it.isCopy ? dm.removeCopyTitle : dm.removeRefTitle}
                          onClick={() => window.isle.remove([it.id])}
                        >
                          {dm.removeBtn}
                        </button>
                      </div>
                    </div>

                    {/* Expandable AI file summary card */}
                    {showSummary && it.summary && (
                      <div className="summary-card">
                        <div className="summary-head">
                          <span className="summary-read-tag">
                            {it.summary.readStatus === 'full'
                              ? dm.readFullTag
                              : it.summary.readStatus === 'partial'
                                ? `◐ ${it.summary.readNote || dm.readPartialDefault}`
                                : `○ ${it.summary.readNote || dm.readMetaDefault}`}
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
                            <strong>{dm.attentionPrefix}</strong>
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

      {dockUndo && (
        <div className="dock-undo-banner">
          <span className="dock-undo-text">{dm.undoText(dockUndo.label, dockUndo.copyCount)}</span>
          <div className="dock-undo-actions">
            <button className="btn-undo-pill" onClick={onUndoRemove}>
              {dm.undoBtn}
            </button>
            <button className="undo-close-btn" onClick={onDismissUndo} title={dm.dismissUndoTitle}>
              ✕
            </button>
          </div>
        </div>
      )}

      <footer className="panel-footer">
        <span>
          {dm.footerNote}
          {copyCount > 0 && dm.footerCopyUsage(copyCount, formatSize(usage.used))}
        </span>
        <span>{dm.footerTip}</span>
      </footer>
    </>
  )
}
