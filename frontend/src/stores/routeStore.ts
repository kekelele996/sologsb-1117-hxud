import { create } from 'zustand'
import type { TransitRoute } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'
import { distanceKm, estimateDurationH } from '@/utils/geo'

export interface RouteState {
  rows: TransitRoute[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: TransitRoute) => Promise<void>
  remove: (id: string) => Promise<void>
  /** 按选点顺序重排并重算里程 / 耗时，生成连续转场段 */
  rebuildFromOrder: (
    orderedDropIds: string[],
    meta: { vehicleType: TransitRoute['vehicleType']; departAt: string; riskNote: string }
  ) => Promise<void>
}

export const routeStore = create<RouteState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<TransitRoute>(db.routes)
    rows.sort((a, b) => a.departAt.localeCompare(b.departAt))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    await putRow<TransitRoute>(db.routes, row)
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<TransitRoute>(db.routes, id)
    await get().hydrate()
  },
  rebuildFromOrder: async (orderedDropIds, meta) => {
    const existing = await loadAll<TransitRoute>(db.routes)
    await Promise.all(existing.map((row) => deleteRow<TransitRoute>(db.routes, row.id)))
    const points = await loadAll<{ id: string; longitude: number; latitude: number }>(db.dropPoints)
    const lookup = new Map(points.map((item) => [item.id, item]))
    for (let i = 1; i < orderedDropIds.length; i += 1) {
      const from = lookup.get(orderedDropIds[i - 1])
      const to = lookup.get(orderedDropIds[i])
      if (!from || !to) continue
      const km = distanceKm(from, to)
      await putRow<TransitRoute>(db.routes, {
        id: `rt_${Date.now().toString(36)}_${i}`,
        fromDropId: from.id,
        toDropId: to.id,
        distanceKm: km,
        durationH: estimateDurationH(km),
        vehicleType: meta.vehicleType,
        departAt: meta.departAt,
        riskNote: meta.riskNote,
        actualNote: '待执行'
      })
    }
    await get().hydrate()
  }
}))
