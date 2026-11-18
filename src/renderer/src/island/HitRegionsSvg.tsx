import type React from 'react'
import { DOCK_POLY, STAGE, polyPoints } from '../../../shared/shape'
import type { DecorationId, DecorationState, IslandPose } from '../../../shared/types'

export type IslandSpotId = DecorationId | 'picnic' | 'starfish'

interface EllipseSpotDef {
  id: Exclude<IslandSpotId, 'starfish'>
  decoKey?: DecorationId
  cx: number
  cy: number
  rx: number
  ry: number
}

const ELLIPSE_SPOTS: EllipseSpotDef[] = [
  { id: 'flowers', decoKey: 'flowers', cx: 120, cy: 62, rx: 24, ry: 20 },
  { id: 'bench', decoKey: 'bench', cx: 153, cy: 54, rx: 16, ry: 15 },
  { id: 'lamp', decoKey: 'lamp', cx: 173, cy: 42, rx: 12, ry: 26 },
  { id: 'tree', decoKey: 'tree', cx: 198, cy: 40, rx: 20, ry: 26 },
  { id: 'cabin', decoKey: 'cabin', cx: 224, cy: 54, rx: 22, ry: 22 },
  { id: 'windmill', decoKey: 'windmill', cx: 258, cy: 59, rx: 20, ry: 27 },
  { id: 'picnic', cx: 232, cy: 144, rx: 24, ry: 14 }
]

interface HitRegionsSvgProps {
  effectiveMode: IslandPose['mode']
  decorEnabled: DecorationState['enabled']
  otterPos: { x: number; y: number }
  canActivateSpot: () => boolean
  onDockClick: (e: React.MouseEvent) => void
  onDockOpenPanel: (e: React.MouseEvent) => void
  onOtterClick: (e: React.MouseEvent) => void
  onSpotActivate: (spotId: IslandSpotId) => void
}

/** 渲染岛屿透明交互热区层：栈桥、全展开 8 处可互动景点与水獭角色。 */
export function HitRegionsSvg({
  effectiveMode,
  decorEnabled,
  otterPos,
  canActivateSpot,
  onDockClick,
  onDockOpenPanel,
  onOtterClick,
  onSpotActivate
}: HitRegionsSvgProps): JSX.Element {
  const handleSpotClick = (spotId: IslandSpotId) => (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (!canActivateSpot()) return
    onSpotActivate(spotId)
  }

  return (
    <svg className="layer-hits" viewBox={`0 0 ${STAGE.w} ${STAGE.h}`}>
      <polygon
        className="hit-dock"
        points={polyPoints(DOCK_POLY)}
        onClick={onDockClick}
        onDoubleClick={onDockOpenPanel}
        onContextMenu={onDockOpenPanel}
      />

      {effectiveMode === 'full' && (
        <>
          {ELLIPSE_SPOTS.map((spot) => {
            if (spot.decoKey && !decorEnabled[spot.decoKey]) return null
            return (
              <ellipse
                key={spot.id}
                className="hit-spot"
                cx={spot.cx}
                cy={spot.cy}
                rx={spot.rx}
                ry={spot.ry}
                onClick={handleSpotClick(spot.id)}
              />
            )
          })}

          <circle
            className="hit-spot"
            cx={184}
            cy={168}
            r={12}
            onClick={handleSpotClick('starfish')}
          />
        </>
      )}

      <ellipse
        className="hit-otter"
        cx={otterPos.x}
        cy={otterPos.y - 32}
        rx={28}
        ry={34}
        onClick={onOtterClick}
        onContextMenu={onDockOpenPanel}
      />
    </svg>
  )
}
