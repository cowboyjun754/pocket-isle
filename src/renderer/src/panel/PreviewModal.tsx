import type { DockItem } from '../../../shared/types'
import type { PreviewState } from './panelShared'

interface PreviewModalProps {
  preview: PreviewState
  onClose: () => void
  onCopy: (item: DockItem) => void
  onOpen: (item: DockItem) => void
}

export function PreviewModal({
  preview,
  onClose,
  onCopy,
  onOpen
}: PreviewModalProps): JSX.Element {
  return (
    <div className="preview-mask" onClick={onClose}>
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
            <button onClick={() => onCopy(preview.item)}>复制</button>
            <button onClick={() => onOpen(preview.item)}>用默认程序打开</button>
            <button onClick={onClose}>关闭</button>
          </div>
        </div>
      </div>
    </div>
  )
}
