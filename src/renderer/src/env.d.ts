import type { IsleApi } from '../../shared/types'

declare global {
  interface Window {
    isle: IsleApi
  }
}

declare module '*.png' {
  const src: string
  export default src
}

export {}
