import { create } from 'zustand'
import type { BeeColony, ColonyStatus } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'

export interface ColonyState {
  rows: BeeColony[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: BeeColony) => Promise<void>
  remove: (id: string) => Promise<void>
  bulkSetStatus: (ids: string[], status: ColonyStatus) => Promise<void>
  bulkSetHealthNote: (ids: string[], note: string, checkDate: string) => Promise<void>
}

export const colonyStore = create<ColonyState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<BeeColony>(db.colonies)
    rows.sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    await putRow<BeeColony>(db.colonies, row)
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<BeeColony>(db.colonies, id)
    await get().hydrate()
  },
  bulkSetStatus: async (ids, status) => {
    const targets = get().rows.filter((row) => ids.includes(row.id))
    await Promise.all(targets.map((row) => putRow<BeeColony>(db.colonies, { ...row, status })))
    await get().hydrate()
  },
  bulkSetHealthNote: async (ids, note, checkDate) => {
    const targets = get().rows.filter((row) => ids.includes(row.id))
    await Promise.all(targets.map((row) => putRow<BeeColony>(db.colonies, { ...row, healthNote: note, lastCheckDate: checkDate })))
    await get().hydrate()
  }
}))
