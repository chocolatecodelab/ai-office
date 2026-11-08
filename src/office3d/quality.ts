export type OfficeQuality = 'auto' | 'low' | 'high'
export function renderQuality(mode: OfficeQuality, constrained: boolean, slow: boolean) {
  const low=mode==='low' || (mode==='auto' && (constrained || slow))
  return {low, dpr:low ? 1 : 1.5, shadows:!low}
}
