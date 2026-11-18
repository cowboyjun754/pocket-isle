import { DEFAULT_LOCALE, getMessages } from '../../../shared/i18n'
import type { AiFileReadReceipt, AppLocale, DecorationId, DockItem } from '../../../shared/types'

export type Tab = 'dock' | 'focus' | 'build' | 'settings'

export interface PreviewState {
  item: DockItem
  src?: string
  text?: string
  truncated?: boolean
}

export interface JointCardState {
  title: string
  markdown: string
  files: string[]
  receipts?: AiFileReadReceipt[]
}

const DECO_IDS: DecorationId[] = ['flowers', 'bench', 'lamp', 'tree', 'cabin', 'windmill']
const DECO_ICONS: Record<DecorationId, string> = {
  flowers: '🌷',
  bench: '🪑',
  lamp: '🏮',
  tree: '🌳',
  cabin: '🏡',
  windmill: '🎐'
}

export function getDecoMeta(
  locale: AppLocale = DEFAULT_LOCALE
): Array<{ id: DecorationId; name: string; icon: string; desc: string }> {
  const meta = getMessages(locale).panel.build.decoMeta
  return DECO_IDS.map((id) => ({
    id,
    icon: DECO_ICONS[id],
    name: meta[id].name,
    desc: meta[id].desc
  }))
}

export const DECO_META = getDecoMeta(DEFAULT_LOCALE)

export function playFocusChime(): void {
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
    /* Silent no-op when audio output is unavailable */
  }
}

export function formatMb(mb: number): string {
  if (mb >= 1024 && mb % 1024 === 0) return `${mb / 1024} GB`
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`
  return `${mb} MB`
}

export { formatDurationMmSs as formatClock } from '../util'

export function renderInlineBold(text: string): Array<string | JSX.Element> {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') && p.length > 4 ? (
      <strong key={i}>{p.slice(2, -2)}</strong>
    ) : (
      p
    )
  )
}

export function renderMarkdownLite(md: string): JSX.Element[] {
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

export function SparkleIcon(): JSX.Element {
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
