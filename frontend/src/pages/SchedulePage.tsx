import { useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Popconfirm, Row, Segmented, Space, Table, Tag, Typography, message } from 'antd'
import type { BeeColony, DropPoint, Orchard } from '@/types'
import FlowerWindowBar from '@/components/common/FlowerWindowBar'
import RouteMap from '@/components/common/RouteMap'
import StatusTag from '@/components/common/StatusTag'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { colonyStore } from '@/stores/colonyStore'
import { droppointStore } from '@/stores/droppointStore'
import { routeStore } from '@/stores/routeStore'
import { distanceKm, bloomDays, flowerWindowOverlap } from '@/utils/geo'
import { suggestColonyBoxes } from '@/types'

interface Placement {
  colonyCode: string
  orchardId: string
  /** 投放点 id；空串表示「当前所在」占用（来自蜂群所在地而非投放点安排） */
  dropPointId: string
  dropCode: string
  start: string
  end: string
}

interface ConflictItem {
  colonyCode: string
  a: Placement
  b: Placement
  days: number
  range: string
}

interface ScheduleRow {
  key: string
  orchard: Orchard
  days: number
  suggest: number
  placedCodes: string[]
  dropCodes: string[]
  conflicted: boolean
}

/** 单条冲突的修正方案：替补蜂群 + 目标投放点；找不到合适替补时给出原因 */
interface FixEntry {
  key: string
  conflict: ConflictItem
  /** 冲突群保留的安排 */
  keep: Placement
  /** 冲突群被移出的安排（总是投放点安排） */
  replace: Placement
  substitute: BeeColony | null
  targetDrop: DropPoint | null
  /** 替补蜂群现所在地到目标投放点的距离（公里）；无所在地时为 null，排最后 */
  distance: number | null
  /** 目标投放点在本次安排前的剩余箱位 */
  remaining: number
  reason: string
}

interface FixCandidate {
  substitute: BeeColony
  targetDrop: DropPoint
  distance: number | null
  remaining: number
}

/** 替补蜂群门槛：待投放/回场、群势至少 4 足框 */
const MIN_SUBSTITUTE_FRAMES = 4

/** 季内授粉安排总表：日期条带展示花期与已投放群体，冲突处标红并生成修正方案 */
export default function SchedulePage(): JSX.Element {
  const orchards = usePersistentStore(orchardStore, (state) => state.rows)
  const colonies = usePersistentStore(colonyStore, (state) => state.rows)
  const dropPoints = usePersistentStore(droppointStore, (state) => state.rows)
  const routes = usePersistentStore(routeStore, (state) => state.rows)
  const [scope, setScope] = useState<'all' | 'conflict'>('all')
  const [applying, setApplying] = useState(false)

  /** 由投放点的群号安排 + 蜂群当前所在地块，汇总出「某群在某地块」的时间占用 */
  const placements = useMemo<Placement[]>(() => {
    const list: Placement[] = []
    dropPoints.forEach((point: DropPoint) => {
      point.colonyCodes.forEach((code) => {
        list.push({
          colonyCode: code,
          orchardId: point.orchardId,
          dropPointId: point.id,
          dropCode: point.code,
          start: point.dropWindow,
          end: point.withdrawTime
        })
      })
    })
    colonies.forEach((colony: BeeColony) => {
      if (!colony.currentOrchardId) return
      const orchard = orchards.find((item) => item.id === colony.currentOrchardId)
      if (!orchard) return
      const already = list.some((item) => item.colonyCode === colony.code && item.orchardId === colony.currentOrchardId)
      if (already) return
      list.push({
        colonyCode: colony.code,
        orchardId: colony.currentOrchardId,
        dropPointId: '',
        dropCode: '（当前所在）',
        start: orchard.bloomStart,
        end: orchard.bloomEnd
      })
    })
    return list
  }, [dropPoints, colonies, orchards])

  /** 同一蜂群同一天被排入两个地块 → 冲突列表 */
  const conflicts = useMemo<ConflictItem[]>(() => {
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
  }, [placements])

  /** 为每处冲突挑选替补蜂群与目标投放点；任一冲突无合适替补则整体不可确认 */
  const fixPlan = useMemo<FixEntry[]>(() => {
    if (conflicts.length === 0) return []

    /** 每个蜂群现有占用（用于替补的重叠占用检查） */
    const occupancy = new Map<string, Placement[]>()
    placements.forEach((item) => {
      const list = occupancy.get(item.colonyCode) ?? []
      list.push(item)
      occupancy.set(item.colonyCode, list)
    })
    const conflictedCodes = new Set(conflicts.map((item) => item.colonyCode))
    /** 方案内已用掉的替补（一个替补只顶一处） */
    const usedSubstitutes = new Set<string>()
    /** 替补在方案内新增的占用窗口 */
    const pendingWindows = new Map<string, { start: string; end: string }[]>()
    /** 方案内将从投放点移出的群（dropPointId:code，去重） */
    const removals = new Set<string>()
    /** 方案内向投放点新增的占用数 */
    const additions = new Map<string, number>()

    function freeCapacity(point: DropPoint, extraRemoval: boolean): number {
      let freed = 0
      removals.forEach((key) => {
        if (key.startsWith(`${point.id}:`)) freed += 1
      })
      return point.capacityBoxes - point.colonyCodes.length + freed + (extraRemoval ? 1 : 0) - (additions.get(point.id) ?? 0)
    }

    function hasOverlap(code: string, start: string, end: string): boolean {
      const existing = occupancy.get(code) ?? []
      const pending = pendingWindows.get(code) ?? []
      return [...existing, ...pending].some((item) => flowerWindowOverlap(item.start, item.end, start, end).overlap)
    }

    function colonyDistance(colony: BeeColony, point: DropPoint): number | null {
      const home = orchards.find((item) => item.id === colony.currentOrchardId)
      if (!home) return null
      return distanceKm(home, point)
    }

    /** 为「移出 replace 侧」寻找替补与目标投放点 */
    function findFix(conflict: ConflictItem, replace: Placement): { fix: FixCandidate | null; reason: string } {
      const orchard = orchards.find((item) => item.id === replace.orchardId)
      if (!orchard) return { fix: null, reason: '目标地块不存在' }
      if (!replace.dropPointId) return { fix: null, reason: '冲突发生在蜂群当前所在地块，请先在蜂群台账调整所在地' }

      // 目标投放点：同地块、覆盖完整花期、剩余箱位足够（本冲突移出的那箱也算空位）
      const drops = dropPoints.filter(
        (point) =>
          point.orchardId === orchard.id &&
          point.dropWindow <= orchard.bloomStart &&
          point.withdrawTime >= orchard.bloomEnd &&
          freeCapacity(point, point.id === replace.dropPointId) >= 1
      )
      // 替补蜂群：待投放/回场、群势达标、自身不在冲突中、本方案未占用
      const pool = colonies.filter(
        (item) =>
          (item.status === '待投放' || item.status === '回场') &&
          item.strengthFrames >= MIN_SUBSTITUTE_FRAMES &&
          item.code !== conflict.colonyCode &&
          !conflictedCodes.has(item.code) &&
          !usedSubstitutes.has(item.code)
      )

      if (pool.length === 0) {
        return { fix: null, reason: `没有可用替补蜂群（需待投放/回场、群势 ≥ ${MIN_SUBSTITUTE_FRAMES} 足框且自身无冲突）` }
      }
      if (drops.length === 0) {
        return {
          fix: null,
          reason: `「${orchard.name}」没有覆盖完整花期（${orchard.bloomStart}~${orchard.bloomEnd}）且有空余箱位的投放点`
        }
      }

      const candidates: FixCandidate[] = []
      pool.forEach((colony) => {
        drops.forEach((point) => {
          if (hasOverlap(colony.code, point.dropWindow, point.withdrawTime)) return
          candidates.push({
            substitute: colony,
            targetDrop: point,
            distance: colonyDistance(colony, point),
            remaining: freeCapacity(point, point.id === replace.dropPointId)
          })
        })
      })
      if (candidates.length === 0) {
        return { fix: null, reason: '候选蜂群在可覆盖花期的投放时段内均有重叠占用' }
      }
      // 距离近的优先（无所在地的排最后）；并列时优先留在原投放点，再按编号稳定排序
      candidates.sort((x, y) => {
        const dx = x.distance ?? Number.POSITIVE_INFINITY
        const dy = y.distance ?? Number.POSITIVE_INFINITY
        if (dx !== dy) return dx - dy
        const sameX = x.targetDrop.id === replace.dropPointId ? 0 : 1
        const sameY = y.targetDrop.id === replace.dropPointId ? 0 : 1
        if (sameX !== sameY) return sameX - sameY
        return x.substitute.code.localeCompare(y.substitute.code) || x.targetDrop.code.localeCompare(y.targetDrop.code)
      })
      return { fix: candidates[0], reason: '' }
    }

    /** 保留一侧的选取：蜂群当前所在地块优先保留，否则保留时间窗更早的一侧 */
    function pickSides(conflict: ConflictItem): { keep: Placement; replace: Placement } {
      const aCurrent = conflict.a.dropPointId === ''
      const bCurrent = conflict.b.dropPointId === ''
      if (aCurrent && !bCurrent) return { keep: conflict.a, replace: conflict.b }
      if (bCurrent && !aCurrent) return { keep: conflict.b, replace: conflict.a }
      const cmp =
        conflict.a.start.localeCompare(conflict.b.start) ||
        conflict.a.end.localeCompare(conflict.b.end) ||
        conflict.a.dropCode.localeCompare(conflict.b.dropCode)
      return cmp <= 0 ? { keep: conflict.a, replace: conflict.b } : { keep: conflict.b, replace: conflict.a }
    }

    return conflicts.map((conflict, index) => {
      const key = `${conflict.colonyCode}-${conflict.a.dropCode}-${conflict.b.dropCode}-${index}`
      let sides = pickSides(conflict)
      let result = findFix(conflict, sides.replace)
      // 首选侧没有合适替补时，若另一侧也是投放点安排，尝试改派另一侧
      if (!result.fix && sides.keep.dropPointId !== '') {
        const swapped = { keep: sides.replace, replace: sides.keep }
        const retry = findFix(conflict, swapped.replace)
        if (retry.fix) {
          sides = swapped
          result = retry
        }
      }
      const entry: FixEntry = {
        key,
        conflict,
        keep: sides.keep,
        replace: sides.replace,
        substitute: result.fix?.substitute ?? null,
        targetDrop: result.fix?.targetDrop ?? null,
        distance: result.fix?.distance ?? null,
        remaining: result.fix?.remaining ?? 0,
        reason: result.reason
      }
      if (result.fix) {
        usedSubstitutes.add(result.fix.substitute.code)
        const pending = pendingWindows.get(result.fix.substitute.code) ?? []
        pending.push({ start: result.fix.targetDrop.dropWindow, end: result.fix.targetDrop.withdrawTime })
        pendingWindows.set(result.fix.substitute.code, pending)
        removals.add(`${sides.replace.dropPointId}:${conflict.colonyCode}`)
        additions.set(result.fix.targetDrop.id, (additions.get(result.fix.targetDrop.id) ?? 0) + 1)
      }
      return entry
    })
  }, [conflicts, placements, colonies, dropPoints, orchards])

  const allFixable = fixPlan.length > 0 && fixPlan.every((entry) => entry.substitute !== null && entry.targetDrop !== null)

  /** 一次确认：投放点安排、替补蜂群所在地与状态一起更新 */
  async function applyFixPlan(): Promise<void> {
    if (!allFixable) return
    setApplying(true)
    try {
      const touchedDrops = new Map<string, DropPoint>()
      const mutateDrop = (id: string, fn: (point: DropPoint) => DropPoint): void => {
        const base = touchedDrops.get(id) ?? dropPoints.find((point) => point.id === id)
        if (!base) return
        touchedDrops.set(id, fn(base))
      }
      const colonyUpdates = new Map<string, BeeColony>()

      fixPlan.forEach((entry) => {
        const substitute = entry.substitute
        const target = entry.targetDrop
        if (!substitute || !target) return
        // 投放点：移出冲突群、加入替补群
        mutateDrop(entry.replace.dropPointId, (point) => ({
          ...point,
          colonyCodes: point.colonyCodes.filter((code) => code !== entry.conflict.colonyCode)
        }))
        mutateDrop(target.id, (point) =>
          point.colonyCodes.includes(substitute.code) ? point : { ...point, colonyCodes: [...point.colonyCodes, substitute.code] }
        )
        // 替补蜂群：所在地改到目标地块，状态转为在园
        const current = colonyUpdates.get(substitute.id) ?? colonies.find((item) => item.id === substitute.id)
        if (current) {
          colonyUpdates.set(substitute.id, { ...current, currentOrchardId: entry.replace.orchardId, status: '在园' })
        }
        // 冲突群若登记所在地正是被移出的地块，改到保留侧地块，避免「当前所在」占用再次撞期
        const conflicted = colonies.find((item) => item.code === entry.conflict.colonyCode)
        if (conflicted && conflicted.currentOrchardId === entry.replace.orchardId) {
          const prev = colonyUpdates.get(conflicted.id) ?? conflicted
          colonyUpdates.set(conflicted.id, { ...prev, currentOrchardId: entry.keep.orchardId })
        }
      })

      for (const row of touchedDrops.values()) {
        await droppointStore.getState().save(row)
      }
      for (const row of colonyUpdates.values()) {
        await colonyStore.getState().save(row)
      }
      message.success(`修正方案已执行：${fixPlan.length} 处冲突全部替换完成`)
    } finally {
      setApplying(false)
    }
  }

  const rows = useMemo<ScheduleRow[]>(
    () =>
      orchards.map((orchard) => {
        const related = placements.filter((item) => item.orchardId === orchard.id)
        return {
          key: orchard.id,
          orchard,
          days: bloomDays(orchard),
          suggest: suggestColonyBoxes(orchard),
          placedCodes: Array.from(new Set(related.map((item) => item.colonyCode))),
          dropCodes: Array.from(new Set(related.map((item) => item.dropCode))),
          conflicted: conflicts.some((item) => item.a.orchardId === orchard.id || item.b.orchardId === orchard.id)
        }
      }),
    [orchards, placements, conflicts]
  )

  const visibleRows = scope === 'conflict' ? rows.filter((row) => row.conflicted) : rows
  const totalSuggest = rows.reduce((sum, row) => sum + row.suggest, 0)

  function orchardName(id: string): string {
    return orchards.find((item) => item.id === id)?.name ?? '未知地块'
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">季内授粉安排总表</h2>
          <p className="page-sub">
            按日期条带展示各地块盛花期与已投放群体；同一蜂群在同一天被排入花期重叠的两个地块时进入冲突列表并标红，可据此生成修正方案。
          </p>
        </div>
        <Segmented
          value={scope}
          onChange={(value) => setScope(value as 'all' | 'conflict')}
          options={[
            { label: `全部地块（${rows.length}）`, value: 'all' },
            { label: `仅冲突地块（${rows.filter((row) => row.conflicted).length}）`, value: 'conflict' }
          ]}
        />
      </div>

      {conflicts.length > 0 ? (
        <Alert
          type="error"
          showIcon
          message={`发现 ${conflicts.length} 处蜂群排程冲突：同一群体被排入花期重叠的不同地块`}
          description={
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {conflicts.map((item) => (
                <li key={`${item.colonyCode}-${item.a.dropCode}-${item.b.dropCode}`}>
                  蜂群 <b>{item.colonyCode}</b>：{orchardName(item.a.orchardId)}（{item.a.dropCode} {item.a.start}~{item.a.end}）与{' '}
                  {orchardName(item.b.orchardId)}（{item.b.dropCode} {item.b.start}~{item.b.end}）重叠 {item.days} 天（{item.range}）
                </li>
              ))}
            </ul>
          }
        />
      ) : (
        <Alert type="success" showIcon message="当前排程无蜂群冲突" />
      )}

      {conflicts.length > 0 ? (
        <Card
          size="small"
          title={`冲突修正方案（替补需待投放/回场、群势 ≥ ${MIN_SUBSTITUTE_FRAMES} 足框且无重叠占用；目标投放点覆盖完整花期且箱位足够，距离近的优先）`}
          extra={
            <Space>
              {allFixable ? null : <Typography.Text type="danger">存在无法自动替换的冲突，原安排保持不变</Typography.Text>}
              <Popconfirm
                title="确认执行修正方案？"
                description="将一次性更新投放点安排、蜂群所在地与状态"
                okText="确认执行"
                cancelText="取消"
                disabled={!allFixable}
                onConfirm={() => void applyFixPlan()}
              >
                <Button type="primary" size="small" disabled={!allFixable} loading={applying}>
                  确认修正方案
                </Button>
              </Popconfirm>
            </Space>
          }
        >
          <Table<FixEntry>
            dataSource={fixPlan}
            rowKey="key"
            pagination={false}
            size="small"
            columns={[
              {
                title: '冲突蜂群',
                key: 'colony',
                width: 150,
                render: (_, entry) => (
                  <Space direction="vertical" size={2}>
                    <Tag color="red">{entry.conflict.colonyCode}</Tag>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      重叠 {entry.conflict.days} 天
                    </Typography.Text>
                  </Space>
                )
              },
              {
                title: '保留安排',
                key: 'keep',
                render: (_, entry) => `${orchardName(entry.keep.orchardId)}（${entry.keep.dropCode} ${entry.keep.start}~${entry.keep.end}）`
              },
              {
                title: '移出安排',
                key: 'replace',
                render: (_, entry) => `${orchardName(entry.replace.orchardId)}（${entry.replace.dropCode} ${entry.replace.start}~${entry.replace.end}）`
              },
              {
                title: '替补蜂群',
                key: 'substitute',
                render: (_, entry) =>
                  entry.substitute ? (
                    <Space size={4} wrap>
                      <Tag color="cyan">{entry.substitute.code}</Tag>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {entry.substitute.species} · {entry.substitute.strengthFrames} 足框 · {entry.substitute.status}
                      </Typography.Text>
                    </Space>
                  ) : (
                    '—'
                  )
              },
              {
                title: '目标投放点',
                key: 'target',
                render: (_, entry) =>
                  entry.targetDrop ? (
                    <Space size={4} wrap>
                      <Tag color="blue">{entry.targetDrop.code}</Tag>
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        {entry.targetDrop.dropWindow}~{entry.targetDrop.withdrawTime} · 剩余 {entry.remaining} 箱
                      </Typography.Text>
                    </Space>
                  ) : (
                    '—'
                  )
              },
              {
                title: '距离',
                key: 'distance',
                width: 90,
                render: (_, entry) => (entry.distance !== null ? `${entry.distance} km` : '—')
              },
              {
                title: '结论',
                key: 'result',
                width: 260,
                render: (_, entry) =>
                  entry.substitute ? (
                    <Tag color="green">可替换</Tag>
                  ) : (
                    <Typography.Text type="danger" style={{ fontSize: 12 }}>
                      {entry.reason}
                    </Typography.Text>
                  )
              }
            ]}
          />
        </Card>
      ) : null}

      <Row gutter={16}>
        <Col xs={24} xl={14}>
          <Card size="small" title="花期条带与已投放群体" styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12 } }}>
            {visibleRows.map((row) => (
              <div key={row.key} className={row.conflicted ? 'conflict-row' : ''} style={{ padding: 8, borderRadius: 8 }}>
                <FlowerWindowBar orchard={row.orchard} others={orchards.filter((item) => item.id !== row.orchard.id)} width={420} />
                <Space wrap size={4} style={{ marginTop: 6 }}>
                  <Tag>建议 {row.suggest} 箱</Tag>
                  <Tag color="blue">花期 {row.days} 天</Tag>
                  <Tag color={row.orchard.accessibility === '大车可达' ? 'green' : row.orchard.accessibility === '仅小车' ? 'gold' : 'red'}>
                    {row.orchard.accessibility}
                  </Tag>
                  {row.placedCodes.length > 0 ? (
                    row.placedCodes.map((code) => <Tag key={code} color="cyan">已投放 {code}</Tag>)
                  ) : (
                    <Tag>尚未安排群体</Tag>
                  )}
                  {row.conflicted ? <Tag color="red">存在冲突</Tag> : null}
                </Space>
              </div>
            ))}
            {visibleRows.length === 0 ? <Typography.Text type="secondary">没有符合条件的地块</Typography.Text> : null}
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card size="small" title="地图总览（地块 / 投放点 / 转场折线）">
            <RouteMap orchards={orchards} dropPoints={dropPoints} routes={routes} height={360} title="季内投放分布" />
          </Card>
        </Col>
      </Row>

      <Card size="small" title={`各地块排程明细（建议箱数合计 ${totalSuggest} 箱）`}>
        <Table<ScheduleRow>
          dataSource={rows}
          rowKey="key"
          pagination={false}
          rowClassName={(record) => (record.conflicted ? 'conflict-row' : '')}
          columns={[
            { title: '地块', dataIndex: ['orchard', 'name'], key: 'name' },
            { title: '作物', dataIndex: ['orchard', 'crop'], key: 'crop', width: 90 },
            { title: '面积（亩）', dataIndex: ['orchard', 'areaMu'], key: 'area', width: 100 },
            {
              title: '盛花期',
              key: 'bloom',
              render: (_, record: ScheduleRow) => `${record.orchard.bloomStart} ~ ${record.orchard.bloomEnd}`
            },
            { title: '花期天数', dataIndex: 'days', key: 'days', width: 100 },
            { title: '建议箱数', dataIndex: 'suggest', key: 'suggest', width: 100 },
            {
              title: '投放点',
              key: 'drops',
              render: (_, record: ScheduleRow) => (record.dropCodes.length > 0 ? record.dropCodes.join('、') : '—')
            },
            {
              title: '已投放群体',
              key: 'colonies',
              render: (_, record: ScheduleRow) => (
                <Space wrap size={4}>
                  {record.placedCodes.length > 0 ? record.placedCodes.map((code) => <Tag key={code}>{code}</Tag>) : <span>—</span>}
                </Space>
              )
            },
            {
              title: '状态',
              key: 'status',
              width: 120,
              render: (_, record: ScheduleRow) =>
                record.conflicted ? <Tag color="red">冲突</Tag> : <Tag color="green">正常</Tag>
            }
          ]}
        />
      </Card>

      <Card size="small" title="蜂群当前状态">
        <Space wrap>
          {colonies.map((colony) => (
            <StatusTag
              key={colony.id}
              status={colony.status}
              hint={colony.currentOrchardId ? orchardName(colony.currentOrchardId) : '未分配地块'}
            />
          ))}
        </Space>
      </Card>
    </div>
  )
}
