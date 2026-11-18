import { STAGE } from '../../../shared/shape'
import type { AmbienceMode, IslandPose, IslandSprout } from '../../../shared/types'
import { type FloatingParticle, RAIN_STREAKS, type WaterRipple } from './islandMath'

interface ForegroundDecorSvgProps {
  sprouts: IslandSprout[]
  picnicSteaming: boolean
  starfishHop: boolean
}

/** 渲染全展开岛屿前景色饰物：草坪手绘小花苗、野餐茶席、沙滩海星与贝壳。 */
export function ForegroundDecorSvg({
  sprouts,
  picnicSteaming,
  starfishHop
}: ForegroundDecorSvgProps): JSX.Element {
  return (
    <svg className="layer-foreground-svg" viewBox={`0 0 ${STAGE.w} ${STAGE.h}`} aria-hidden>
      <defs>
        <linearGradient id="picnicClothGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fdf1d6" />
          <stop offset="100%" stopColor="#eedbb6" />
        </linearGradient>
        <linearGradient id="starfishGrad" x1="15%" y1="10%" x2="85%" y2="90%">
          <stop offset="0%" stopColor="#f7ad8e" />
          <stop offset="100%" stopColor="#de7d5f" />
        </linearGradient>
        <linearGradient id="shellGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#fdf0e8" />
          <stop offset="100%" stopColor="#ebd0c2" />
        </linearGradient>
      </defs>

      {sprouts.map((sp) => (
        <g key={sp.id} className="grass-sprout" transform={`translate(${sp.x}, ${sp.y})`}>
          <ellipse cx="0" cy="0.5" rx="4.5" ry="1.8" fill="rgba(58, 72, 42, 0.16)" />
          <path
            d="M0,0 Q-3,-7 -6,-9 M0,0 Q3,-8 6,-9 M0,0 Q-0.5,-5 0.5,-7"
            stroke="#5b7a48"
            strokeWidth="1.3"
            fill="none"
            strokeLinecap="round"
          />
          {sp.kind === 0 && (
            <>
              <circle cx="-6" cy="-10" r="3.1" fill="#fff9ea" stroke="#6b5640" strokeWidth="0.95" />
              <circle cx="-6" cy="-10" r="1.2" fill="#f3b64c" />
            </>
          )}
          {sp.kind === 1 && (
            <>
              <circle cx="6" cy="-10" r="3.1" fill="#f8b79e" stroke="#6b5640" strokeWidth="0.95" />
              <circle cx="6" cy="-10" r="1.15" fill="#fff6e0" />
            </>
          )}
          {sp.kind === 2 && (
            <circle cx="0" cy="-9" r="2.9" fill="#ffe38a" stroke="#6b5640" strokeWidth="0.95" />
          )}
        </g>
      ))}

      <g className="picnic-mat-group" transform="translate(232, 142)">
        <polygon points="-21,5 6,-5 27,7 -1,17" fill="rgba(52, 64, 38, 0.16)" />
        <polygon
          points="-22,4 6,-6 26,6 -2,16"
          fill="url(#picnicClothGrad)"
          stroke="#6b5238"
          strokeWidth="1.25"
          strokeLinejoin="round"
        />
        <polygon
          points="-17,4 5,-4 21,5 -1,13"
          fill="none"
          stroke="#d98a6c"
          strokeWidth="0.95"
          strokeDasharray="3 2"
        />
        <ellipse cx="-5" cy="5.5" rx="7" ry="3.8" fill="rgba(78, 56, 36, 0.14)" />
        <ellipse cx="-5" cy="5" rx="7" ry="4" fill="#e5c494" stroke="#5e452b" strokeWidth="1.15" />
        <circle cx="-6" cy="4" r="2.3" fill="#d9654c" stroke="#5e452b" strokeWidth="0.85" />
        <circle cx="-2.5" cy="5" r="2" fill="#e67e5f" stroke="#5e452b" strokeWidth="0.85" />
        <circle cx="-6.6" cy="3.3" r="0.6" fill="rgba(255,248,238,0.8)" />
        <ellipse cx="9" cy="6.6" rx="4.2" ry="1.8" fill="rgba(78, 56, 36, 0.16)" />
        <path
          d="M5,2 L5.8,6.5 C6,8 12,8 12.2,6.5 L13,2"
          fill="#fdf4e0"
          stroke="#5e452b"
          strokeWidth="1.1"
        />
        <ellipse cx="9" cy="2" rx="4.5" ry="2.6" fill="#fffaf0" stroke="#5e452b" strokeWidth="1.1" />
        <ellipse cx="9" cy="2.2" rx="3.2" ry="1.4" fill="#8b9e6b" />
        {picnicSteaming && (
          <path
            className="tea-steam"
            d="M8,-1 Q6,-6 9,-9 M11,0 Q13,-5 10,-8"
            fill="none"
            stroke="#fffdf6"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        )}
      </g>

      <g className={`shore-starfish ${starfishHop ? 'is-hopping' : ''}`} transform="translate(184, 168)">
        <ellipse cx="0.5" cy="4.2" rx="5.5" ry="2.2" fill="rgba(96, 68, 42, 0.18)" />
        <polygon
          points="0,-6 1.8,-2 6,-1.5 2.6,1.4 3.6,5.5 0,3.2 -3.6,5.5 -2.6,1.4 -6,-1.5 -1.8,-2"
          fill="url(#starfishGrad)"
          stroke="#6b4432"
          strokeWidth="1.1"
          strokeLinejoin="round"
        />
        <circle cx="0" cy="0" r="1" fill="#fff3e0" />
      </g>
      <g className="shore-shell" transform="translate(264, 158)">
        <ellipse cx="0" cy="3.6" rx="4.8" ry="1.8" fill="rgba(96, 68, 42, 0.16)" />
        <path
          d="M-5,2 C-5,-4 5,-4 5,2 L2,4 L-2,4 Z"
          fill="url(#shellGrad)"
          stroke="#6b5238"
          strokeWidth="1.1"
        />
        <line x1="-2" y1="-1" x2="-1" y2="3.5" stroke="#8a6c50" strokeWidth="0.85" />
        <line x1="2" y1="-1" x2="1" y2="3.5" stroke="#8a6c50" strokeWidth="0.85" />
      </g>
    </svg>
  )
}

interface StageFxSvgProps {
  effectiveMode: IslandPose['mode']
  ambience: AmbienceMode
  cabinEnabled: boolean
  dragOver: boolean
  ripples: WaterRipple[]
  particles: FloatingParticle[]
}

/** 渲染舞台动效层：栈桥暖黄发光、海面微光、木屋炊烟、萤火虫、细雨、水波与互动粒子。 */
export function StageFxSvg({
  effectiveMode,
  ambience,
  cabinEnabled,
  dragOver,
  ripples,
  particles
}: StageFxSvgProps): JSX.Element {
  return (
    <svg className="layer-fx-svg" viewBox={`0 0 ${STAGE.w} ${STAGE.h}`} aria-hidden>
      <defs>
        <radialGradient id="glowGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffe27a" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ffe27a" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse
        className={`dock-glow ${dragOver ? 'active' : ''}`}
        cx={62}
        cy={132}
        rx={64}
        ry={38}
        fill="url(#glowGrad)"
      />

      <g className={`water-shimmers is-${ambience}`}>
        <ellipse className="water-glint glint-1" cx={112} cy={182} rx={9} ry={1.7} />
        <ellipse className="water-glint glint-2" cx={170} cy={192} rx={12} ry={2} />
        <ellipse className="water-glint glint-3" cx={242} cy={176} rx={8} ry={1.6} />
      </g>

      {effectiveMode === 'full' && cabinEnabled && (
        <g className="cabin-ambient-smoke" transform="translate(229, 34)">
          <circle className="smoke-puff puff-1" cx={0} cy={0} r={2.3} />
          <circle className="smoke-puff puff-2" cx={2} cy={-4} r={3} />
        </g>
      )}

      {effectiveMode === 'full' && ambience === 'night' && (
        <g className="night-fireflies">
          <circle className="firefly ff-1" cx={126} cy={74} r={2.1} />
          <circle className="firefly ff-2" cx={164} cy={56} r={1.8} />
          <circle className="firefly ff-3" cx={208} cy={82} r={2} />
          <circle className="firefly ff-4" cx={248} cy={68} r={1.7} />
        </g>
      )}

      {effectiveMode === 'full' && ambience === 'rain' && (
        <g className="rain-curtain">
          {RAIN_STREAKS.map((r, i) => (
            <line
              key={i}
              className="rain-drop"
              x1={r.x}
              y1={r.y}
              x2={r.x - 4}
              y2={r.y + r.len}
              style={{ animationDelay: r.delay, animationDuration: r.dur }}
            />
          ))}
          <ellipse className="rain-ring rr-1" cx={136} cy={182} rx={4} ry={1.8} />
          <ellipse className="rain-ring rr-2" cx={226} cy={190} rx={5} ry={2.1} />
        </g>
      )}

      {ripples.map((r) => (
        <g key={r.id} transform={`translate(${r.x}, ${r.y})`}>
          <ellipse className="water-ripple-ring ring-1" cx={0} cy={0} rx={4} ry={2.2} />
          <ellipse className="water-ripple-ring ring-2" cx={0} cy={0} rx={2} ry={1.2} />
        </g>
      ))}

      {particles.map((p) => (
        <g key={p.id} transform={`translate(${p.x}, ${p.y})`}>
          <g className={`fx-particle fx-${p.kind}`}>
            {p.kind === 'leaf' && (
              <path
                d="M0,0 C4,-4 9,-2 7,3 C4,6 0,4 0,0 Z"
                fill="#8ab068"
                stroke="#4e6836"
                strokeWidth="1"
              />
            )}
            {p.kind === 'butterfly' && (
              <g>
                <ellipse cx="-3" cy="-1" rx="3.2" ry="2.2" fill="#ffd972" stroke="#6b4f2c" strokeWidth="0.9" />
                <ellipse cx="3" cy="-1" rx="3.2" ry="2.2" fill="#ffd972" stroke="#6b4f2c" strokeWidth="0.9" />
              </g>
            )}
            {p.kind === 'smoke' && (
              <circle
                cx="0"
                cy="0"
                r="5"
                fill="rgba(255, 252, 245, 0.82)"
                stroke="rgba(140,120,100,0.35)"
                strokeWidth="1"
              />
            )}
            {p.kind === 'dandelion' && (
              <g>
                <circle cx="0" cy="0" r="2.2" fill="#fffdf6" />
                <line x1="-3" y1="-3" x2="3" y2="3" stroke="#fffdf6" strokeWidth="1" />
                <line x1="3" y1="-3" x2="-3" y2="3" stroke="#fffdf6" strokeWidth="1" />
              </g>
            )}
            {p.kind === 'heart' && (
              <path
                d="M0,2 C-2,0 -5,0 -5,-3 C-5,-5 -2,-6 0,-3.5 C2,-6 5,-5 5,-3 C5,0 2,0 0,2 Z"
                fill="#e57368"
              />
            )}
            {p.kind === 'note' && (
              <circle cx="0" cy="0" r="3" fill="#ffcf6b" stroke="#6b4f2c" strokeWidth="1" />
            )}
            {p.kind === 'splash' && (
              <path
                d="M0,-4 C2.5,-1 3,2 0,3.5 C-3,2 -2.5,-1 0,-4 Z"
                fill="#d8eef8"
                stroke="#6f9fbd"
                strokeWidth="1"
              />
            )}
          </g>
        </g>
      ))}
    </svg>
  )
}
