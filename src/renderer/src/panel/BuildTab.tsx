import type { AmbienceMode, DecorationId, DecorationState } from '../../../shared/types'
import { DECO_META, SparkleIcon } from './panelShared'

interface BuildTabProps {
  decor: DecorationState
  decorMood: string
  setDecorMood: (val: string) => void
  aiDecorating: boolean
  onApplyPreset: (ambience: AmbienceMode, onList: DecorationId[], label: string) => void
  onAiDecor: () => void
  onCancelAi: () => void
}

export function BuildTab({
  decor,
  decorMood,
  setDecorMood,
  aiDecorating,
  onApplyPreset,
  onAiDecor,
  onCancelAi
}: BuildTabProps): JSX.Element {
  return (
    <div className="tab-body">
      <div className="ambience-bar">
        <div>
          <div className="section-label">小岛氛围与预设方案</div>
          <div className="preset-btns">
            <button
              className={decor.ambience === 'day' ? 'active' : ''}
              onClick={() => window.isle.setDecorations({ ambience: 'day' })}
            >
              ☀ 白天日光
            </button>
            <button
              className={decor.ambience === 'night' ? 'active' : ''}
              onClick={() => window.isle.setDecorations({ ambience: 'night' })}
            >
              🌙 夜晚暖光
            </button>
            <button
              className={decor.ambience === 'rain' ? 'active' : ''}
              onClick={() => window.isle.setDecorations({ ambience: 'rain' })}
            >
              🌧 细雨听海
            </button>
            <button onClick={() => onApplyPreset('day', ['flowers', 'bench', 'tree'], '清爽办公')}>
              清爽办公
            </button>
            <button
              onClick={() =>
                onApplyPreset(
                  'day',
                  ['flowers', 'bench', 'lamp', 'tree', 'cabin', 'windmill'],
                  '田园满岛'
                )
              }
            >
              田园满岛
            </button>
            <button
              onClick={() => onApplyPreset('night', ['bench', 'lamp', 'tree', 'cabin'], '静谧夜读')}
            >
              静谧夜读
            </button>
            <button
              onClick={() => onApplyPreset('rain', ['bench', 'lamp', 'tree', 'cabin'], '细雨听书')}
            >
              细雨听书
            </button>
          </div>
        </div>
      </div>

      <div className="deco-grid">
        {DECO_META.map((d) => {
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
              <div className={`deco-switch ${on ? 'on' : ''}`}>{on ? '显示中' : '已收起'}</div>
            </div>
          )
        })}
      </div>

      <div className="ai-decor-box">
        <input
          value={decorMood}
          placeholder="输入心情让水獭推荐搭配（如：适合深夜安静写代码）"
          onChange={(e) => setDecorMood(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onAiDecor()
          }}
        />
        <button className="btn-ai-pill" disabled={aiDecorating} onClick={onAiDecor}>
          <SparkleIcon />
          <span>{aiDecorating ? '搭配中...' : 'AI 推荐布置'}</span>
        </button>
        {aiDecorating && (
          <button className="btn-cancel-ai" onClick={onCancelAi}>
            取消
          </button>
        )}
      </div>

      <div className="relax-tips-card">
        <strong>🌊 岛上丰富互动（展开小岛时直接点景物即可触发）：</strong>
        <span>
          · 点<strong>草地任意处</strong>：长出小雏菊并召唤水獭跑过去 · 点<strong>木长椅</strong>：水獭去坐下吹风
          <br />· 点<strong>圆冠树</strong>：摇落绿叶 · 点<strong>野花丛</strong>：飞出蝴蝶 · 点<strong>小木屋</strong>：炊烟与暖窗
          <br />· 点<strong>野餐茶席</strong>：水獭喝茶吃点心 · 点<strong>海水 / 小纸船</strong>：泛起涟漪与放漂纸船
        </span>
      </div>
    </div>
  )
}
