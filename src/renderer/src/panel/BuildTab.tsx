import { getMessages } from '../../../shared/i18n'
import type { AmbienceMode, AppLocale, DecorationId, DecorationState } from '../../../shared/types'
import { SparkleIcon, getDecoMeta } from './panelShared'

interface BuildTabProps {
  locale: AppLocale
  decor: DecorationState
  decorMood: string
  setDecorMood: (val: string) => void
  aiDecorating: boolean
  onApplyPreset: (ambience: AmbienceMode, onList: DecorationId[], label: string) => void
  onAiDecor: () => void
  onCancelAi: () => void
}

export function BuildTab({
  locale,
  decor,
  decorMood,
  setDecorMood,
  aiDecorating,
  onApplyPreset,
  onAiDecor,
  onCancelAi
}: BuildTabProps): JSX.Element {
  const bm = getMessages(locale).panel.build
  const decoList = getDecoMeta(locale)
  return (
    <div className="tab-body">
      <div className="ambience-bar">
        <div>
          <div className="section-label">{bm.sectionTitle}</div>
          <div className="preset-btns">
            <button
              className={decor.ambience === 'day' ? 'active' : ''}
              onClick={() => window.isle.setDecorations({ ambience: 'day' })}
            >
              {bm.dayBtn}
            </button>
            <button
              className={decor.ambience === 'night' ? 'active' : ''}
              onClick={() => window.isle.setDecorations({ ambience: 'night' })}
            >
              {bm.nightBtn}
            </button>
            <button
              className={decor.ambience === 'rain' ? 'active' : ''}
              onClick={() => window.isle.setDecorations({ ambience: 'rain' })}
            >
              {bm.rainBtn}
            </button>
            <button
              onClick={() => onApplyPreset('day', ['flowers', 'bench', 'tree'], bm.presetFresh)}
            >
              {bm.presetFresh}
            </button>
            <button
              onClick={() =>
                onApplyPreset(
                  'day',
                  ['flowers', 'bench', 'lamp', 'tree', 'cabin', 'windmill'],
                  bm.presetPastoral
                )
              }
            >
              {bm.presetPastoral}
            </button>
            <button
              onClick={() =>
                onApplyPreset('night', ['bench', 'lamp', 'tree', 'cabin'], bm.presetNight)
              }
            >
              {bm.presetNight}
            </button>
            <button
              onClick={() =>
                onApplyPreset('rain', ['bench', 'lamp', 'tree', 'cabin'], bm.presetRain)
              }
            >
              {bm.presetRain}
            </button>
          </div>
        </div>
      </div>

      <div className="deco-grid">
        {decoList.map((d) => {
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
              <div className={`deco-switch ${on ? 'on' : ''}`}>
                {on ? bm.decoVisible : bm.decoHidden}
              </div>
            </div>
          )
        })}
      </div>

      <div className="ai-decor-box">
        <input
          value={decorMood}
          placeholder={bm.moodPlaceholder}
          onChange={(e) => setDecorMood(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onAiDecor()
          }}
        />
        <button className="btn-ai-pill" disabled={aiDecorating} onClick={onAiDecor}>
          <SparkleIcon />
          <span>{aiDecorating ? bm.decorLoadingBtn : bm.decorBtn}</span>
        </button>
        {aiDecorating && (
          <button className="btn-cancel-ai" onClick={onCancelAi}>
            {bm.cancelBtn}
          </button>
        )}
      </div>

      <div className="relax-tips-card">
        <strong>{bm.tipsTitle}</strong>
        <span>
          {bm.tipsLine1A}
          <strong>{bm.tipsGrass}</strong>
          {bm.tipsLine1B}
          <strong>{bm.tipsBench}</strong>
          {bm.tipsLine1C}
          <br />
          {bm.tipsLine2A}
          <strong>{bm.tipsTree}</strong>
          {bm.tipsLine2B}
          <strong>{bm.tipsFlowers}</strong>
          {bm.tipsLine2C}
          <strong>{bm.tipsCabin}</strong>
          {bm.tipsLine2D}
          <br />
          {bm.tipsLine3A}
          <strong>{bm.tipsPicnic}</strong>
          {bm.tipsLine3B}
          <strong>{bm.tipsSeaBoat}</strong>
          {bm.tipsLine3C}
        </span>
      </div>
    </div>
  )
}
