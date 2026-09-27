import { useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Popconfirm, Radio, Row, Segmented, Space, Table, Tag, Typography, message } from 'antd'
import type { Orchard } from '@/types'
import FlowerWindowBar from '@/components/common/FlowerWindowBar'
import RouteMap from '@/components/common/RouteMap'
import StatusTag from '@/components/common/StatusTag'
import { usePersistentStore, db } from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { colonyStore } from '@/stores/colonyStore'
import { droppointStore } from '@/stores/droppointStore'
import { routeStore } from '@/stores/routeStore'
import { bloomDays } from '@/utils/geo'
import {
  buildConflicts,
  buildFixPlan,
  buildPlacements,
  conflictKey,
  MIN_REPLACEMENT_FRAMES,
  type ConflictItem,
  type Placement,
  type ResolvedFix,
  type SideOption
} from '@/utils/schedule'
import { suggestColonyBoxes } from '@/types'

interface ScheduleRow {
  key: string
  orchard: Orchard
  days: number
  suggest: number
  placedCodes: string[]
  dropCodes: string[]
  conflicted: boolean
}

/** 季内授粉安排总表：日期条带展示花期与已投放群体，冲突处标红并给出替补修正方案 */
export default function SchedulePage(): JSX.Element {
  const orchards = usePersistentStore(orchardStore, (state) => state.rows)
  const colonies = usePersistentStore(colonyStore, (state) => state.rows)
  const dropPoints = usePersistentStore(droppointStore, (state) => state.rows)
  const routes = usePersistentStore(routeStore, (state) => state.rows)
  const [scope, setScope] = useState<'all' | 'conflict'>('all')
  /** 每处冲突选择在哪一侧投放点安排替补 */
  const [pickMap, setPickMap] = useState<Record<string, 'a' | 'b'>>({})
  /** 技术员手工改选的替补群号 */
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [applying, setApplying] = useState(false)

  /** 由投放点的群号安排 + 蜂群当前所在地块，汇总出「某群在某地块」的时间占用 */
  const placements = useMemo<Placement[]>(
    () => buildPlacements(dropPoints, colonies, orchards),
    [dropPoints, colonies, orchards]
  )

  /** 同一蜂群同一天被排入两个地块 → 冲突列表 */
  const conflicts = useMemo<ConflictItem[]>(() => buildConflicts(placements), [placements])

  /** 修正方案：按状态/群势/重叠占用/花期覆盖/箱位筛选替补，就近优先 */
  const plan = useMemo(
    () => buildFixPlan(conflicts, pickMap, overrides, { orchards, colonies, dropPoints, placements }),
    [conflicts, pickMap, overrides, orchards, colonies, dropPoints, placements]
  )

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

  function resetPlan(): void {
    setPickMap({})
    setOverrides({})
  }

  /** 一次确认全部替换：投放点群号、替补蜂群所在地与状态同事务写回；原安排仅在全部可替换时变更 */
  async function applyPlan(): Promise<void> {
    if (!plan.allResolved) return
    const colonyMap = new Map(colonies.map((item) => [item.id, item]))
    setApplying(true)
    try {
      await db.transaction('rw', db.dropPoints, db.colonies, async () => {
        await Promise.all(plan.pointUpdates.map((point) => db.dropPoints.put(point)))
        await Promise.all(
          plan.colonyPatches.map((patch) => {
            const origin = colonyMap.get(patch.id)
            if (!origin) return undefined
            return db.colonies.put({
              ...origin,
              currentOrchardId: patch.currentOrchardId,
              status: patch.status
            })
          })
        )
      })
      await Promise.all([droppointStore.getState().hydrate(), colonyStore.getState().hydrate()])
      message.success(`已一次性完成 ${plan.fixes.length} 处替换，总表冲突已全部消除`)
      resetPlan()
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">季内授粉安排总表</h2>
          <p className="page-sub">
            按日期条带展示各地块盛花期与已投放群体；花期重叠冲突可在本页直接生成替补修正方案，全部可替换时一次确认落位。
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
                <li key={conflictKey(item)}>
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
        <FixPlanCard
          plan={plan}
          orchardName={orchardName}
          pickMap={pickMap}
          overrides={overrides}
          applying={applying}
          onPickSide={(key, side) => setPickMap((prev) => ({ ...prev, [key]: side }))}
          onPickReplacement={(key, code) => setOverrides((prev) => ({ ...prev, [key]: code }))}
          onReset={resetPlan}
          onApply={() => void applyPlan()}
        />
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

interface FixPlanCardProps {
  plan: ReturnType<typeof buildFixPlan>
  orchardName: (id: string) => string
  pickMap: Record<string, 'a' | 'b'>
  overrides: Record<string, string>
  applying: boolean
  onPickSide: (key: string, side: 'a' | 'b') => void
  onPickReplacement: (key: string, code: string) => void
  onReset: () => void
  onApply: () => void
}

/** 冲突修正方案：逐处选择被替换的投放点与替补蜂群，全部可替换后才允许一次确认 */
function FixPlanCard(props: FixPlanCardProps): JSX.Element {
  const { plan, orchardName, onPickSide, onPickReplacement, onReset, onApply, applying } = props
  const unresolved = plan.fixes.filter((item) => !item.resolved)

  return (
    <Card
      size="small"
      title={
        <Space wrap>
          <span>花期重叠修正方案</span>
          <Tag color="purple">替补须「待投放 / 回场」且群势 ≥ {MIN_REPLACEMENT_FRAMES} 足框</Tag>
          <Tag color="geekblue">目标投放窗须覆盖完整花期</Tag>
          <Tag color="cyan">剩余箱位足够、距离近者优先</Tag>
        </Space>
      }
      extra={
        <Space>
          <Button size="small" onClick={onReset}>
            恢复自动匹配
          </Button>
          <Popconfirm
            title={`确认一次性替换全部 ${plan.fixes.length} 处冲突？`}
            description="投放点群号、替补蜂群所在地与状态将同时更新，冲突群保留在另一侧安排。"
            okText="确认替换"
            cancelText="取消"
            disabled={!plan.allResolved || applying}
            onConfirm={onApply}
          >
            <Button type="primary" size="small" loading={applying} disabled={!plan.allResolved}>
              一次确认全部替换（{plan.fixes.length - unresolved.length}/{plan.fixes.length} 可替换）
            </Button>
          </Popconfirm>
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {plan.allResolved ? (
          <Alert
            type="success"
            showIcon
            message={`${plan.fixes.length} 处冲突均已匹配到合适替补，可一次确认；确认前原安排保持不变`}
          />
        ) : (
          <Alert
            type="error"
            showIcon
            message={`有 ${unresolved.length} 处冲突暂无合适替补，不能确认，原安排不动`}
            description={
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {unresolved.map((fix) => (
                  <li key={fix.key}>
                    蜂群 <b>{fix.conflict.colonyCode}</b> 在「{sideLabel(fix.chosenOption, orchardName)}」：{fix.reason}
                  </li>
                ))}
              </ul>
            }
          />
        )}

        {plan.fixes.map((fix, index) => (
          <FixItem key={fix.key} index={index + 1} fix={fix} orchardName={orchardName} onPickSide={onPickSide} onPickReplacement={onPickReplacement} />
        ))}
      </Space>
    </Card>
  )
}

function sideLabel(option: SideOption, orchardName: (id: string) => string): string {
  const name = option.orchard ? orchardName(option.orchard.id) : '未知地块'
  return `${name} · ${option.placement.dropCode}`
}

interface FixItemProps {
  index: number
  fix: ResolvedFix
  orchardName: (id: string) => string
  onPickSide: (key: string, side: 'a' | 'b') => void
  onPickReplacement: (key: string, code: string) => void
}

/** 单处冲突：选择撤出侧投放点、查看硬性条件、改选就近替补 */
function FixItem({ index, fix, orchardName, onPickSide, onPickReplacement }: FixItemProps): JSX.Element {
  const { conflict, options, chosenSide, chosenOption } = fix

  const sideRadio = (side: 'a' | 'b', option: SideOption): JSX.Element => {
    const placement = option.placement
    const eligibleCount = option.candidates.filter((item) => item.eligible).length
    return (
      <Space direction="vertical" size={2}>
        <Space wrap size={4}>
          <Radio value={side}>
            <b>{sideLabel(option, orchardName)}</b>
          </Radio>
          {option.feasible ? <Tag color="green">可替换 · {eligibleCount} 群可选</Tag> : <Tag color="red">不可替换</Tag>}
          {!option.dropPoint ? <Tag color="red">无投放点</Tag> : null}
        </Space>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          冲突群 {conflict.colonyCode} 占用窗：{placement.start} ~ {placement.end}
        </Typography.Text>
      </Space>
    )
  }

  return (
    <div
      style={{
        border: `1px solid ${fix.resolved ? '#b7eb8f' : '#ffccc7'}`,
        background: fix.resolved ? '#f6ffed' : '#fff2f0',
        borderRadius: 8,
        padding: 12
      }}
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Space wrap>
          <Tag color={fix.resolved ? 'green' : 'red'}>冲突 {index}</Tag>
          <Typography.Text strong>蜂群 {conflict.colonyCode}</Typography.Text>
          <Typography.Text type="secondary">
            两侧花期/投放窗重叠 {conflict.days} 天（{conflict.range}），选择从哪一侧撤出：
          </Typography.Text>
        </Space>

        <Radio.Group value={chosenSide} onChange={(event) => onPickSide(fix.key, event.target.value as 'a' | 'b')}>
          <Space direction="vertical" size={6}>
            {sideRadio('a', options.a)}
            {sideRadio('b', options.b)}
          </Space>
        </Radio.Group>

        <SideConditions fix={fix} />

        {fix.resolved ? (
          <div style={{ background: '#fff', border: '1px dashed #95de64', borderRadius: 8, padding: 10 }}>
            <Space wrap style={{ marginBottom: 8 }}>
              <Typography.Text strong>替补蜂群（就近优先）：</Typography.Text>
              {fix.chosenCode !== fix.autoCode ? <Tag color="orange">已手工改选，系统首选 {fix.autoCode ?? '—'}</Tag> : <Tag color="blue">系统就近首选</Tag>}
            </Space>
            <Radio.Group
              value={fix.chosenCode ?? ''}
              onChange={(event) => onPickReplacement(fix.key, event.target.value as string)}
              style={{ width: '100%' }}
            >
              <Space direction="vertical" size={6} style={{ width: '100%' }}>
                {chosenOption.candidates.map((candidate) => (
                  <Radio key={candidate.colony.id} value={candidate.colony.code} disabled={!candidate.eligible} style={{ alignItems: 'flex-start' }}>
                    <Space wrap size={6}>
                      <b>{candidate.colony.code}</b>
                      <Tag>{candidate.colony.species}</Tag>
                      <Tag color={candidate.colony.strengthFrames >= MIN_REPLACEMENT_FRAMES ? 'green' : 'default'}>
                        {candidate.colony.strengthFrames} 足框
                      </Tag>
                      <StatusTag status={candidate.colony.status} hint={candidate.colony.currentOrchardId ? orchardName(candidate.colony.currentOrchardId) : '蜂场'} />
                      {candidate.distance === null ? (
                        <Tag>直线距离未知（所在地未登记地块）</Tag>
                      ) : (
                        <Tag color="cyan">距投放点 {candidate.distance.toFixed(2)} km</Tag>
                      )}
                      {!candidate.eligible ? <Tag color="red">{candidate.busyText}</Tag> : null}
                    </Space>
                  </Radio>
                ))}
              </Space>
            </Radio.Group>
          </div>
        ) : (
          <Alert type="error" showIcon message={`无法替换：${fix.reason}`} />
        )}

        {fix.resolved && fix.replacement ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            确认后：{chosenOption.dropPoint?.code ?? ''} 的 {conflict.colonyCode} 撤出、{fix.replacement.code} 进场；
            {conflict.colonyCode} 保留在「{orchardName((chosenSide === 'a' ? conflict.b : conflict.a).orchardId)}」，
            {fix.replacement.code} 所在地更新为「{orchardName(chosenOption.placement.orchardId)}」，两群状态均记为在园。
          </Typography.Text>
        ) : null}
      </Space>
    </div>
  )
}

/** 目标投放点硬性条件：花期覆盖与剩余箱位 */
function SideConditions({ fix }: { fix: ResolvedFix }): JSX.Element {
  const option = fix.chosenOption
  if (!option.dropPoint || !option.orchard) {
    return (
      <Space wrap size={4}>
        <Tag color="red">该侧无实际投放点，无法安排替补</Tag>
      </Space>
    )
  }
  return (
    <Space wrap size={6}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        目标投放点 {option.dropPoint.code}：
      </Typography.Text>
      <Tag color={option.bloomCovered ? 'green' : 'red'}>
        {option.bloomCovered ? '投放窗覆盖完整花期' : '投放窗未覆盖完整花期'}（花期 {option.orchard.bloomStart}~{option.orchard.bloomEnd}，窗 {option.dropPoint.dropWindow}~{option.dropPoint.withdrawTime}）
      </Tag>
      <Tag color={option.freeSlots >= 1 ? 'green' : 'red'}>
        容量 {option.capacity} 箱 · 撤出 {fix.conflict.colonyCode} 后已占 {option.usedExcludingOutgoing} 箱 · 剩余 {option.freeSlots} 箱位
      </Tag>
    </Space>
  )
}
