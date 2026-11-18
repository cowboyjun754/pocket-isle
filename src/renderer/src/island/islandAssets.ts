import type { DecorationId, OtterAction } from '../../../shared/types'
import decoBenchUrl from '../assets/deco-bench.png'
import decoCabinUrl from '../assets/deco-cabin.png'
import decoFlowersUrl from '../assets/deco-flowers.png'
import decoLampUrl from '../assets/deco-lamp.png'
import decoTreeUrl from '../assets/deco-tree.png'
import decoWindmillBladesUrl from '../assets/deco-windmill-blades.png'
import decoWindmillUrl from '../assets/deco-windmill.png'
import islandHorizUrl from '../assets/island-horiz.png'
import otterIdleUrl from '../assets/otter-idle.png'
import otterReadUrl from '../assets/otter-read.png'
import otterReceiveUrl from '../assets/otter-receive.png'
import otterRestUrl from '../assets/otter-rest.png'
import otterWaveUrl from '../assets/otter-wave.png'
import paperBoatUrl from '../assets/paper-boat.png'
import parcelBoxUrl from '../assets/parcel-box.png'
import parcelEnvelopeUrl from '../assets/parcel-envelope.png'
import parcelScrollUrl from '../assets/parcel-scroll.png'

export const ISLAND_HORIZ_URL = islandHorizUrl
export const PAPER_BOAT_URL = paperBoatUrl
export const DECO_WINDMILL_BLADES_URL = decoWindmillBladesUrl

export const PARCEL_SPRITES: Record<'envelope' | 'box' | 'scroll', { src: string; w: number; h: number }> =
  {
    envelope: { src: parcelEnvelopeUrl, w: 34, h: 22 },
    box: { src: parcelBoxUrl, w: 30, h: 28 },
    scroll: { src: parcelScrollUrl, w: 30, h: 26 }
  }

export const OTTER_SPRITES: Record<OtterAction, string> = {
  idle: otterIdleUrl,
  receive: otterReceiveUrl,
  read: otterReadUrl,
  wave: otterWaveUrl,
  rest: otterRestUrl
}

export const DECO_LAYERS: Array<{ id: DecorationId; src: string; className: string }> = [
  { id: 'flowers', src: decoFlowersUrl, className: 'deco-layer deco-flowers' },
  { id: 'bench', src: decoBenchUrl, className: 'deco-layer deco-bench' },
  { id: 'lamp', src: decoLampUrl, className: 'deco-layer deco-lamp' },
  { id: 'tree', src: decoTreeUrl, className: 'deco-layer deco-tree' },
  { id: 'cabin', src: decoCabinUrl, className: 'deco-layer deco-cabin' },
  { id: 'windmill', src: decoWindmillUrl, className: 'deco-layer deco-windmill' }
]

export const PRELOAD_ASSET_URLS: string[] = [
  islandHorizUrl,
  paperBoatUrl,
  parcelEnvelopeUrl,
  parcelBoxUrl,
  parcelScrollUrl,
  decoWindmillBladesUrl,
  ...Object.values(OTTER_SPRITES),
  ...DECO_LAYERS.map((d) => d.src)
]
