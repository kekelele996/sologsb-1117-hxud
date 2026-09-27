import type { BeeColony, ColonyStatus, DropPoint, Orchard } from '@/types'
import { distanceKm, flowerWindowOverlap, toDateValue } from '@/utils/geo'

/** 一条「某群在某地块、某时间窗内被占用」的安排 */
export interface Placement {
  colonyCode: string
  orchardId: string
  dropCode: string
  /** 实际投放点 id；来自蜂群当前所在地块的兜底占用为空串 */
  dropPointId: string
  start: string
  end: string
}

/** 花期重叠冲突 */
export interface ConflictItem {
  colonyCode: string
  a: Placement
  b: Placement
  days: number
  range: string
}

/** 稳定的冲突标识 */
export function conflictKey(item: ConflictItem): string {
  const side = (p: Placement): string => p.dropPointId || `cur:${p.orchardId}`
  return `${item.colonyCode}|${side(item.a)}|${side(item.b)}`
}

/** 由投放点群号安排 + 蜂群当前所在地块，汇总蜂群时间占用 */
export function buildPlacements(dropPoints: DropPoint[], colonies: BeeColony[], orchards: Orchard[]): Placement[] {
  const list: Placement[] = []
  dropPoints.forEach((point) => {
    point.colonyCodes.forEach((code) => {
      list.push({
        colonyCode: code,
        orchardId: point.orchardId,
        dropCode: point.code,
        dropPointId: point.id,
        start: point.dropWindow,
        end: point.withdrawTime
      })
    })
  })
  colonies.forEach((colony) => {
    if (!colony.currentOrchardId) return
    const orchard = orchards.find((item) => item.id === colony.currentOrchardId)
    if (!orchard) return
    const already = list.some((item) => item.colonyCode === colony.code && item.orchardId === colony.currentOrchardId)
    if (already) return
    list.push({
      colonyCode: colony.code,
      orchardId: colony.currentOrchardId,
      dropCode: '（当前所在）',
      dropPointId: '',
      start: orchard.bloomStart,
      end: orchard.bloomEnd
    })
  })
  return list
}

/** 同一蜂群在重叠时间窗内被排入两个地块 → 冲突 */
export function buildConflicts(placements: Placement[]): ConflictItem[] {
  const result: ConflictItem[] = []
  const codes = Array.from(new Set(placements.map((item) => item.colonyCode)))
  codes.forEach((code) => {
    const list = placements.filter((item) => item.colonyCode === code)
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        if (list[i].orchardId === list[j].orchardId) continue
        const overlap = flowerWindowOverlap(list[i].start, list[i].end, list[j].start, list[j].end)
        if (overlap.overlap) {
          result.push({ colonyCode: code, a: list[i], b: list[j], days: overlap.days, range: overlap.range })
        }
      }
    }
  })
  return result
}

/** 可作替补的蜂群状态 */
const REPLACEMENT_STATUSES: ColonyStatus[] = ['待投放', '回场']
/** 替补最低群势（足框） */
export const MIN_REPLACEMENT_FRAMES = 4

export interface Candidate {
  colony: BeeColony
  /** 到目标投放点的直线距离（km）；蜂群所在地块未登记时为 null */
  distance: number | null
  /** 在目标投放窗内是否有重叠占用 */
  busy: boolean
  /** 不可选原因说明 */
  busyText: string
  eligible: boolean
}

export interface SideOption {
  placement: Placement
  dropPoint: DropPoint | null
  orchard: Orchard | null
  /** 投放窗是否覆盖完整花期 */
  bloomCovered: boolean
  capacity: number
  /** 剔除冲突群后该点的占用箱数 */
  usedExcludingOutgoing: number
  /** 替补进场后剩余箱位 */
  freeSlots: number
  /** 满足状态与群势门槛的候选群 */
  candidates: Candidate[]
  poolSize: number
  feasible: boolean
  infeasibleReason: string
}

export interface ResolvedFix {
  key: string
  conflict: ConflictItem
  options: { a: SideOption; b: SideOption }
  chosenSide: 'a' | 'b'
  chosenOption: SideOption
  /** 系统就近选出的替补群号 */
  autoCode: string | null
  /** 最终生效的替补群号（可能是手工改选） */
  chosenCode: string | null
  replacement: BeeColony | null
  resolved: boolean
  /** 未解决时写明原因 */
  reason: string
}

export interface ColonyPatch {
  id: string
  currentOrchardId: string
  status: ColonyStatus
}

export interface FixPlan {
  fixes: ResolvedFix[]
  /** 确认后需要写回的投放点（群号已更新） */
  pointUpdates: DropPoint[]
  /** 确认后需要写回的蜂群（所在地、状态） */
  colonyPatches: ColonyPatch[]
  allResolved: boolean
}

interface FixContext {
  orchards: Orchard[]
  colonies: BeeColony[]
  dropPoints: DropPoint[]
  placements: Placement[]
}

function orchardLabel(orchard: Orchard | null, point: DropPoint | null): string {
  const name = orchard?.name ?? '未知地块'
  return point ? `${name} · ${point.code}` : `${name} · 当前所在（无投放点）`
}

/**
 * 生成修正方案：逐处冲突在指定侧投放点挑替补。
 * 处理顺序即冲突列表顺序；前一处替换会立即占用箱位与蜂群时间窗，保证同一方案内部不再制造新冲突。
 */
export function buildFixPlan(
  conflicts: ConflictItem[],
  pickMap: Record<string, 'a' | 'b'>,
  overrides: Record<string, string>,
  ctx: FixContext
): FixPlan {
  const { orchards, colonies, dropPoints, placements } = ctx
  const orchardMap = new Map(orchards.map((item) => [item.id, item]))
  const pointMap = new Map(dropPoints.map((item) => [item.id, item]))
  const colonyByCode = new Map(colonies.map((item) => [item.code, item]))
  /** 自身已卷入冲突的蜂群不能再去替补，否则会把冲突带到新点 */
  const conflictCodes = new Set(conflicts.map((item) => item.colonyCode))

  const removed = new Map<string, Set<string>>()
  const added = new Map<string, Set<string>>()
  /** 方案落位后各投放点的群号（独立副本，不污染原始数据） */
  const finalCodes = new Map<string, string[]>()
  /** 方案中发生变动的蜂群（冲突群撤出或替补进场） */
  const patchedColonyIds = new Set<string>()

  function remSet(id: string): Set<string> {
    let set = removed.get(id)
    if (!set) {
      set = new Set<string>()
      removed.set(id, set)
    }
    return set
  }

  function addSet(id: string): Set<string> {
    let set = added.get(id)
    if (!set) {
      set = new Set<string>()
      added.set(id, set)
    }
    return set
  }

  /** 当前方案状态下某投放点的群号（只读推演，不记录写回） */
  function plannedCodes(pointId: string): string[] {
    const point = pointMap.get(pointId)
    if (!point) return []
    const rem = removed.get(pointId)
    const add = added.get(pointId)
    const codes = point.colonyCodes.filter((code) => !rem?.has(code))
    add?.forEach((code) => {
      if (!codes.includes(code)) codes.push(code)
    })
    return Array.from(new Set(codes))
  }

  /** 提交一处替换后，固化该点的最终群号 */
  function commitCodes(pointId: string): string[] {
    const codes = plannedCodes(pointId)
    finalCodes.set(pointId, codes)
    return codes
  }

  /** 候选群在「已纳入本方案的替换」之后，于目标投放窗外的有效占用 */
  function effectivePlacementsOf(code: string): Placement[] {
    const result: Placement[] = placements.filter((item) => item.colonyCode === code)
      .filter((item) => !item.dropPointId || !removed.get(item.dropPointId)?.has(code))
    added.forEach((set, pid) => {
      if (!set.has(code)) return
      const point = pointMap.get(pid)
      if (!point) return
      result.push({
        colonyCode: code,
        orchardId: point.orchardId,
        dropCode: point.code,
        dropPointId: point.id,
        start: point.dropWindow,
        end: point.withdrawTime
      })
    })
    return result
  }

  function evaluateSide(conflict: ConflictItem, placement: Placement): SideOption {
    const point = placement.dropPointId ? pointMap.get(placement.dropPointId) ?? null : null
    const orchard = orchardMap.get(placement.orchardId) ?? null

    const bloomCovered = !!orchard && point
      ? point.dropWindow <= orchard.bloomStart && point.withdrawTime >= orchard.bloomEnd
      : false

    let usedExcludingOutgoing = 0
    let freeSlots = 0
    if (point) {
      const others = plannedCodes(point.id).filter((code) => code !== conflict.colonyCode)
      usedExcludingOutgoing = others.length
      freeSlots = point.capacityBoxes - usedExcludingOutgoing
    }

    // 候选池：待投放/回场、群势 ≥4 足框、自身未卷入任何冲突
    const pool = colonies.filter(
      (item) => !conflictCodes.has(item.code)
        && REPLACEMENT_STATUSES.includes(item.status)
        && item.strengthFrames >= MIN_REPLACEMENT_FRAMES
    )

    const candidates: Candidate[] = pool.map((colony) => {
      const busyHits = effectivePlacementsOf(colony.code)
        .filter((item) => item.orchardId !== placement.orchardId)
        .filter((item) => flowerWindowOverlap(point?.dropWindow ?? placement.start, point?.withdrawTime ?? placement.end, item.start, item.end).overlap)
      const busy = busyHits.length > 0
      const busyText = busyHits
        .map((item) => {
          const name = orchardMap.get(item.orchardId)?.name ?? '未知地块'
          return `与${name}（${item.dropCode} ${item.start}~${item.end}）占用重叠`
        })
        .join('；')

      let distance: number | null = null
      if (point && colony.currentOrchardId) {
        const from = orchardMap.get(colony.currentOrchardId)
        if (from) {
          distance = distanceKm(
            { longitude: from.longitude, latitude: from.latitude },
            { longitude: point.longitude, latitude: point.latitude }
          )
        }
      }

      return { colony, distance, busy, busyText, eligible: !busy }
    })

    candidates.sort((x, y) => {
      if (x.distance === null && y.distance !== null) return 1
      if (x.distance !== null && y.distance === null) return -1
      if (x.distance !== null && y.distance !== null && x.distance !== y.distance) return x.distance - y.distance
      if (x.colony.strengthFrames !== y.colony.strengthFrames) return y.colony.strengthFrames - x.colony.strengthFrames
      return x.colony.code.localeCompare(y.colony.code, 'zh-Hans-CN')
    })

    const eligibleCount = candidates.filter((item) => item.eligible).length
    let infeasibleReason = ''
    if (!point) {
      infeasibleReason = '该侧来自蜂群「当前所在地块」，没有可承接替补的投放点'
    } else if (!bloomCovered) {
      infeasibleReason = `投放窗 ${point.dropWindow}~${point.withdrawTime} 未覆盖完整花期（${orchard?.bloomStart ?? ''}~${orchard?.bloomEnd ?? ''}）`
    } else if (freeSlots < 1) {
      infeasibleReason = `剩余箱位不足：容量 ${point.capacityBoxes} 箱，剔除冲突群后仍占 ${usedExcludingOutgoing} 箱`
    } else if (pool.length === 0) {
      infeasibleReason = `没有「待投放/回场」且群势 ≥ ${MIN_REPLACEMENT_FRAMES} 足框的蜂群可作替补`
    } else if (eligibleCount === 0) {
      infeasibleReason = `满足状态与群势的 ${pool.length} 群均在投放窗 ${point.dropWindow}~${point.withdrawTime} 内有重叠占用`
    }

    return {
      placement,
      dropPoint: point,
      orchard,
      bloomCovered,
      capacity: point?.capacityBoxes ?? 0,
      usedExcludingOutgoing,
      freeSlots,
      candidates,
      poolSize: pool.length,
      feasible: !infeasibleReason,
      infeasibleReason
    }
  }

  const fixes: ResolvedFix[] = conflicts.map((conflict) => {
    const key = conflictKey(conflict)
    const options = { a: evaluateSide(conflict, conflict.a), b: evaluateSide(conflict, conflict.b) }
    const chosenSide = pickMap[key] === 'b' ? 'b' : 'a'
    const chosenOption = options[chosenSide]
    const eligible = chosenOption.candidates.filter((item) => item.eligible)
    const auto = eligible[0] ?? null
    const override = overrides[key]
    const picked = (override && eligible.find((item) => item.colony.code === override)) || auto

    let resolved = false
    let reason = ''

    if (!chosenOption.feasible) {
      reason = chosenOption.infeasibleReason
      const other = chosenSide === 'a' ? options.b : options.a
      if (other.feasible) {
        const otherEligible = other.candidates.filter((item) => item.eligible).length
        reason += `；可改选另一侧「${orchardLabel(other.orchard, other.dropPoint)}」（${otherEligible} 群替补可用）`
      }
    } else if (!picked) {
      reason = chosenOption.infeasibleReason
    } else {
      resolved = true
      const point = chosenOption.dropPoint as DropPoint
      const replacement = picked.colony
      // 落位：冲突群撤出，替补进场（只改独立的方案群号映射，原投放点对象不动）
      remSet(point.id).add(conflict.colonyCode)
      addSet(point.id).add(replacement.code)
      commitCodes(point.id)

      const outColony = colonyByCode.get(conflict.colonyCode)
      if (outColony) patchedColonyIds.add(outColony.id)
      patchedColonyIds.add(replacement.id)
    }

    return {
      key,
      conflict,
      options,
      chosenSide,
      chosenOption,
      autoCode: auto?.colony.code ?? null,
      chosenCode: picked?.colony.code ?? null,
      replacement: picked?.colony ?? null,
      resolved,
      reason
    }
  })

  // 方案确定后，统一生成投放点写回对象（仅包含群号发生变化的点）与变动蜂群补丁
  const pointUpdates: DropPoint[] = []
  const finalPoints = dropPoints.map((item) => {
    const codes = finalCodes.get(item.id)
    if (codes) {
      const updated = { ...item, colonyCodes: codes }
      pointUpdates.push(updated)
      return updated
    }
    return item
  })

  const colonyById = new Map(colonies.map((item) => [item.id, item]))

  // 依据落位后的全部投放点安排，推导变动蜂群的最终所在地（同群先后承接多个互斥窗口时，落在时间最后的点）
  const colonyPatches: ColonyPatch[] = []
  patchedColonyIds.forEach((id) => {
    const colony = colonyById.get(id)
    if (!colony) return
    const owns = finalPoints.filter((point) => point.colonyCodes.includes(colony.code))
    const last = owns
      .map((point) => ({ point, end: toDateValue(point.withdrawTime), start: toDateValue(point.dropWindow) }))
      .sort((x, y) => (x.end !== y.end ? x.end - y.end : x.start - y.start))
      .pop()
    colonyPatches.push({
      id,
      currentOrchardId: last ? last.point.orchardId : colony.currentOrchardId,
      status: '在园'
    })
  })
  colonyPatches.sort((x, y) => x.id.localeCompare(y.id))

  return {
    fixes,
    pointUpdates,
    colonyPatches,
    allResolved: fixes.length > 0 && fixes.every((item) => item.resolved)
  }
}
