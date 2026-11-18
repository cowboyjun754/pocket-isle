import { getMessages } from '../../../shared/i18n'
import type { AppLocale, DockItem } from '../../../shared/types'
import type { PreviewState } from './panelShared'

interface PreviewModalProps {
  locale: AppLocale
  preview: PreviewState
  onClose: () => void
  onCopy: (item: DockItem) => void
  onOpen: (item: DockItem) => void
}

export function PreviewModal({
  locale,
  preview,
  onClose,
  onCopy,
  onOpen
}: PreviewModalProps): JSX.Element {
  const pm = getMessages(locale).panel.preview
  return (
    <div className="preview-mask" onClick={onClose}>
      <div className="preview-box" onClick={(e) => e.stopPropagation()}>
        {preview.src && <img src={preview.src} alt={preview.item.name} draggable={false} />}
        {preview.text !== undefined && (
          <div className="preview-text-wrap">
            {preview.truncated && (
              <div className="preview-truncated-tag">{pm.truncatedBanner}</div>
            )}
            <pre className="preview-text-pre">{preview.text || pm.emptyFile}</pre>
          </div>
        )}
        <div className="preview-bar">
          <span>{preview.item.name}</span>
          <div className="preview-bar-actions">
            <button onClick={() => onCopy(preview.item)}>{pm.copyBtn}</button>
            <button onClick={() => onOpen(preview.item)}>{pm.openBtn}</button>
            <button onClick={onClose}>{pm.closeBtn}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
