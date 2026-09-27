import type { Orchard } from '@/types'

export interface LngLat {
  longitude: number
  latitude: number
}

export interface GridPoint {
  x: number
  y: number
}

export interface GridBounds {
  minLng: number
  maxLng: number
  minLat: number
  maxLat: number
  width: number
  height: number
  padding: number
}

/** 计算坐标集合的包围盒（含最小跨度保护，避免单点时除零） */
export function boundsOf(points: LngLat[], width: number, height: number, padding = 40): GridBounds {
  const lngs = points.map((item) => item.longitude)
  const lats = points.map((item) => item.latitude)
  const minLng = lngs.length > 0 ? Math.min(...lngs) : 100
  const maxLng = lngs.length > 0 ? Math.max(...lngs) : 118
  const minLat = lats.length > 0 ? Math.min(...lats) : 20
  const maxLat = lats.length > 0 ? Math.max(...lats) : 45
  return {
    minLng,
    maxLng: maxLng - minLng < 0.01 ? minLng + 0.01 : maxLng,
    minLat,
    maxLat: maxLat - minLat < 0.01 ? minLat + 0.01 : maxLat,
    width,
    height,
    padding
  }
}

/** 经纬度 → SVG 网格坐标（线性映射，纬度向上增大） */
export function projectToGrid(point: LngLat, bounds: GridBounds): GridPoint {
  const innerW = bounds.width - bounds.padding * 2
  const innerH = bounds.height - bounds.padding * 2
  const x = bounds.padding + ((point.longitude - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * innerW
  const y = bounds.height - bounds.padding - ((point.latitude - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * innerH
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
}

/** SVG 网格坐标 → 经纬度（用于地图/网格点选反算） */
export function unprojectFromGrid(point: GridPoint, bounds: GridBounds): LngLat {
  const innerW = bounds.width - bounds.padding * 2
  const innerH = bounds.height - bounds.padding * 2
  const longitude = bounds.minLng + ((point.x - bounds.padding) / innerW) * (bounds.maxLng - bounds.minLng)
  const latitude = bounds.minLat + ((bounds.height - bounds.padding - point.y) / innerH) * (bounds.maxLat - bounds.minLat)
  return {
    longitude: Math.round(longitude * 10000) / 10000,
    latitude: Math.round(latitude * 10000) / 10000
  }
}

/** 两点球面距离（米，Haversine） */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const R = 6371000
  const toRad = (deg: number): number => (deg * Math.PI) / 180
  const dLat = toRad(b.latitude - a.latitude)
  const dLng = toRad(b.longitude - a.longitude)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 两点距离（公里，保留 2 位） */
export function distanceKm(a: LngLat, b: LngLat): number {
  return Math.round((haversineMeters(a, b) / 1000) * 100) / 100
}

/** 转场里程累计（按顺序累计，返回每段与总计） */
export function routeLegs(points: LngLat[]): { legs: number[]; total: number } {
  const legs: number[] = []
  for (let i = 1; i < points.length; i += 1) {
    legs.push(distanceKm(points[i - 1], points[i]))
  }
  const total = Math.round(legs.reduce((sum, item) => sum + item, 0) * 100) / 100
  return { legs, total }
}

/** 预计耗时：按平均 32 km/h 计算并叠加 0.25 h 装卸 */
export function estimateDurationH(km: number): number {
  return Math.round((km / 32 + 0.25) * 100) / 100
}

/** 解析 YYYY-MM-DD 为日期序号 */
export function toDateValue(date: string): number {
  const [year, month, day] = date.split('-').map((item) => Number(item))
  if (!year || !month || !day) return Number.NaN
  return Date.UTC(year, month - 1, day)
}

export interface OverlapResult {
  overlap: boolean
  /** 重叠天数（0 表示不重叠） */
  days: number
  /** 重叠区间文本 */
  range: string
}

/** 花期重叠判定 */
export function flowerWindowOverlap(startA: string, endA: string, startB: string, endB: string): OverlapResult {
  const a1 = toDateValue(startA)
  const a2 = toDateValue(endA)
  const b1 = toDateValue(startB)
  const b2 = toDateValue(endB)
  if ([a1, a2, b1, b2].some((value) => Number.isNaN(value))) {
    return { overlap: false, days: 0, range: '' }
  }
  const start = Math.max(a1, b1)
  const end = Math.min(a2, b2)
  if (start > end) return { overlap: false, days: 0, range: '' }
  const days = Math.round((end - start) / 86400000) + 1
  const fmt = (value: number): string => new Date(value).toISOString().slice(0, 10)
  return { overlap: true, days, range: `${fmt(start)} ~ ${fmt(end)}` }
}

/** 花期天数 */
export function bloomDays(orchard: Pick<Orchard, 'bloomStart' | 'bloomEnd'>): number {
  const start = toDateValue(orchard.bloomStart)
  const end = toDateValue(orchard.bloomEnd)
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.max(0, Math.round((end - start) / 86400000) + 1)
}
