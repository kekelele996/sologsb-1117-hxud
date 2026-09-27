import { create } from 'zustand'
import type { Orchard } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'

export interface OrchardState {
  rows: Orchard[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (row: Orchard) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const orchardStore = create<OrchardState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<Orchard>(db.orchards)
    rows.sort((a, b) => a.bloomStart.localeCompare(b.bloomStart))
    set({ rows, loaded: true })
  },
  save: async (row) => {
    await putRow<Orchard>(db.orchards, row)
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<Orchard>(db.orchards, id)
    await get().hydrate()
  }
}))
