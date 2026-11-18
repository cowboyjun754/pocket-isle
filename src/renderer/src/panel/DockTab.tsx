import type { MutableRefObject, RefObject } from 'react'
import type { DockItem, DockUndoState } from '../../../shared/types'
import { IMAGE_EXTS, TEXT_PREVIEW_EXTS, formatSize } from '../util'
import { renderMarkdownLite, type JointCardState } from './panelShared'

interface DockTabProps {
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

  return (
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
              disabled={aiOrganizing || aiJointLoading || organizeScope.count === 0}
              onClick={onAiOrganize}
              title={`使用 ${providerLabel} 读取并整理${
                organizeScope.mode === 'selected'
                  ? `选中的 ${organizeScope.count} 份文件`
                  : organizeScope.mode === 'filtered'
                    ? `当前筛选出的 ${organizeScope.count} 份文件`
                    : `码头全部 ${organizeScope.count} 份文件`
              }（不改动原文件）`}
            >
              {aiOrganizing
                ? '整理中...'
                : organizeScope.mode === 'selected'
                  ? `✦ AI 整理 (${organizeScope.count})`
                  : organizeScope.mode === 'filtered'
                    ? `✦ AI 整理筛选 (${organizeScope.count})`
                    : `✦ AI 整理全部 (${organizeScope.count})`}
            </button>
          )}
          {selected.size >= 2 && !confirmingClear && (
            <button
              className="btn-ai-secondary"
              disabled={aiJointLoading || aiOrganizing}
              onClick={onAiJointSummary}
              title={`使用 ${providerLabel} 联合串读/对比选中的 ${Math.min(selected.size, 6)} 份文件，生成可复制的 Markdown 汇总卡`}
            >
              {aiJointLoading ? '串读中...' : `✦ 联合速览 (${Math.min(selected.size, 6)})`}
            </button>
          )}
          {(aiOrganizing || aiJointLoading) && (
            <button
              className="btn-cancel-ai"
              onClick={onCancelAi}
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
                  onNotice(`已清理 ${unavailableIds.length} 个失效条目`)
                }}
              >
                清理失效 ({unavailableIds.length})
              </button>
            )}
          {items.length > 0 && !confirmingClear && !(aiOrganizing || aiJointLoading) && (
            <button
              onClick={() => {
                if (items.length <= 1 && copyCount === 0) window.isle.clear()
                else setConfirmingClear(true)
              }}
            >
              清空
            </button>
          )}
          {confirmingClear && (
            <div className="clear-confirm-inline">
              <span>
                {copyCount > 0
                  ? `清空 ${items.length} 项（含 ${copyCount} 份岛内副本，清空后可短时撤销）？`
                  : `清空全部 ${items.length} 项？（不删原文件）`}
              </span>
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
                          if (f.imageAttached === true) return `${f.name}（已附图）`
                          if (f.imageAttached === false) return `${f.name}（未附图·仅文件名）`
                          if (f.readStatus === 'full') return `${f.name}（全文）`
                          if (f.readStatus === 'partial') {
                            return `${f.name}（${f.readNote || '部分读取'}）`
                          }
                          return `${f.name}（仅文件名）`
                        })
                        .join(' · ')
                    : `关联：${jointCard.files.join(' · ')}`}
                </div>
              </div>
              <div className="joint-card-actions">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(jointCard.markdown)
                    onNotice('已复制 Markdown 汇总内容到剪贴板')
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
                                ? `◐ ${it.summary.readNote || '已读取前段正文'}`
                                : `○ ${it.summary.readNote || '仅凭文件名与属性识别（未读取正文）'}`}
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

      {dockUndo && (
        <div className="dock-undo-banner">
          <span className="dock-undo-text">
            已移出「{dockUndo.label}」
            {dockUndo.copyCount > 0 ? `（保留 ${dockUndo.copyCount} 份岛内副本）` : ''}
          </span>
          <div className="dock-undo-actions">
            <button className="btn-undo-pill" onClick={onUndoRemove}>
              撤销
            </button>
            <button
              className="undo-close-btn"
              onClick={onDismissUndo}
              title="收起提示"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <footer className="panel-footer">
        <span>
          分组与移除均不改原文件
          {copyCount > 0 && ` · 副本 ${copyCount} 项（${formatSize(usage.used)}）`}
        </span>
        <span>点击文件名旁 +分组 可随时调整</span>
      </footer>
    </>
  )
}
