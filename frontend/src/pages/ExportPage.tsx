import { useMemo, useState } from 'react'
import { Button, Card, Col, Radio, Row, Space, Table, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import type { BeeColony, DropPoint, Orchard, TransitRoute } from '@/types'
import { suggestColonyBoxes } from '@/types'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { colonyStore } from '@/stores/colonyStore'
import { droppointStore } from '@/stores/droppointStore'
import { routeStore } from '@/stores/routeStore'
import { downloadCsv, downloadJson } from '@/utils/export'
import { bloomDays } from '@/utils/geo'

interface ScheduleExportRow {
  orchard: string
  crop: string
  areaMu: number
  bloom: string
  days: number
  suggestBoxes: number
  dropCode: string
  colonyCode: string
  dropWindow: string
  withdrawTime: string
  owner: string
}

/** 导出授粉安排清单与转场路线表，并提供打印视图 */
export default function ExportPage(): JSX.Element {
  const orchards = usePersistentStore(orchardStore, (state) => state.rows)
  const colonies = usePersistentStore(colonyStore, (state) => state.rows)
  const dropPoints = usePersistentStore(droppointStore, (state) => state.rows)
  const routes = usePersistentStore(routeStore, (state) => state.rows)
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('landscape')

  const orchardName = (id: string): string => orchards.find((item) => item.id === id)?.name ?? '未知地块'

  /** 授粉安排清单：地块 × 投放点 × 群号 */
  const scheduleRows = useMemo<ScheduleExportRow[]>(() => {
    const rows: ScheduleExportRow[] = []
    orchards.forEach((orchard: Orchard) => {
      const points = dropPoints.filter((item) => item.orchardId === orchard.id)
      const base = {
        orchard: orchard.name,
        crop: orchard.crop,
        areaMu: orchard.areaMu,
        bloom: `${orchard.bloomStart} ~ ${orchard.bloomEnd}`,
        days: bloomDays(orchard),
        suggestBoxes: suggestColonyBoxes(orchard)
      }
      if (points.length === 0) {
        rows.push({ ...base, dropCode: '—', colonyCode: '—', dropWindow: '—', withdrawTime: '—', owner: '—' })
        return
      }
      points.forEach((point: DropPoint) => {
        if (point.colonyCodes.length === 0) {
          rows.push({
            ...base,
            dropCode: point.code,
            colonyCode: '待分配',
            dropWindow: point.dropWindow,
            withdrawTime: point.withdrawTime,
            owner: point.owner || '—'
          })
          return
        }
        point.colonyCodes.forEach((code) => {
          rows.push({
            ...base,
            dropCode: point.code,
            colonyCode: code,
            dropWindow: point.dropWindow,
            withdrawTime: point.withdrawTime,
            owner: point.owner || '—'
          })
        })
      })
    })
    return rows
  }, [orchards, dropPoints])

  const routeRows = useMemo(
    () =>
      routes.map((route: TransitRoute) => {
        const from = dropPoints.find((item) => item.id === route.fromDropId)
        const to = dropPoints.find((item) => item.id === route.toDropId)
        return {
          from: from ? `${from.code}（${orchardName(from.orchardId)}）` : '—',
          to: to ? `${to.code}（${orchardName(to.orchardId)}）` : '—',
          distanceKm: route.distanceKm,
          durationH: route.durationH,
          vehicleType: route.vehicleType,
          departAt: route.departAt,
          riskNote: route.riskNote || '—',
          actualNote: route.actualNote || '—'
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routes, dropPoints, orchards]
  )

  function exportSchedule(): void {
    downloadCsv('授粉安排清单.csv', scheduleRows as unknown as Record<string, unknown>[], [
      { key: 'orchard', label: '地块' },
      { key: 'crop', label: '作物' },
      { key: 'areaMu', label: '面积(亩)' },
      { key: 'bloom', label: '盛花期' },
      { key: 'days', label: '花期天数' },
      { key: 'suggestBoxes', label: '建议箱数' },
      { key: 'dropCode', label: '投放点' },
      { key: 'colonyCode', label: '群号' },
      { key: 'dropWindow', label: '投放时间窗' },
      { key: 'withdrawTime', label: '撤场时间' },
      { key: 'owner', label: '责任人' }
    ])
    message.success('授粉安排清单已导出')
  }

  function exportRoutes(): void {
    downloadCsv('转场路线表.csv', routeRows as unknown as Record<string, unknown>[], [
      { key: 'from', label: '出发投放点' },
      { key: 'to', label: '到达投放点' },
      { key: 'distanceKm', label: '里程(km)' },
      { key: 'durationH', label: '预计耗时(h)' },
      { key: 'vehicleType', label: '车辆' },
      { key: 'departAt', label: '出发时刻' },
      { key: 'riskNote', label: '途中风险' },
      { key: 'actualNote', label: '实际记录' }
    ])
    message.success('转场路线表已导出')
  }

  function exportBackup(): void {
    downloadJson('gbbeeroute-backup.json', {
      exportedAt: new Date().toISOString(),
      orchards,
      colonies,
      dropPoints,
      routes
    })
    message.success('全量数据已导出为 JSON 备份')
  }

  return (
    <div className="page">
      <style>{`@page { size: A4 ${orientation}; margin: 10mm; }`}</style>
      <div className="page-head">
        <div>
          <h2 className="page-title">导出与打印</h2>
          <p className="page-sub">
            导出授粉安排清单（地块、群号、投放点、时刻、里程）与转场路线表，或直接使用打印视图现场交底。
          </p>
        </div>
        <Space>
          <Radio.Group value={orientation} onChange={(event) => setOrientation(event.target.value)}>
            <Radio.Button value="portrait">纵向打印</Radio.Button>
            <Radio.Button value="landscape">横向打印</Radio.Button>
          </Radio.Group>
          <Button onClick={() => window.print()}>打印视图</Button>
        </Space>
      </div>

      <Card size="small">
        <Space wrap>
          <Button type="primary" onClick={exportSchedule}>
            导出授粉安排清单（CSV）
          </Button>
          <Button onClick={exportRoutes}>导出转场路线表（CSV）</Button>
          <Button onClick={exportBackup}>导出全量 JSON 备份</Button>
          <Tag>地块 {orchards.length}</Tag>
          <Tag>蜂群 {colonies.length}</Tag>
          <Tag>投放点 {dropPoints.length}</Tag>
          <Tag>路线 {routes.length}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            生成时间 {dayjs().format('YYYY-MM-DD HH:mm')}
          </Typography.Text>
        </Space>
      </Card>

      <div className={orientation === 'landscape' ? 'print-landscape' : 'print-portrait'}>
        <Card size="small" title={`授粉安排清单（${scheduleRows.length} 行）`} style={{ marginBottom: 16 }}>
          <Table<ScheduleExportRow>
            dataSource={scheduleRows}
            rowKey={(record, index) => `${record.orchard}-${record.dropCode}-${record.colonyCode}-${index ?? 0}`}
            size="small"
            pagination={false}
            columns={[
              { title: '地块', dataIndex: 'orchard', key: 'orchard' },
              { title: '作物', dataIndex: 'crop', key: 'crop', width: 80 },
              { title: '面积(亩)', dataIndex: 'areaMu', key: 'area', width: 90 },
              { title: '盛花期', dataIndex: 'bloom', key: 'bloom' },
              { title: '天数', dataIndex: 'days', key: 'days', width: 70 },
              { title: '建议箱数', dataIndex: 'suggestBoxes', key: 'suggest', width: 90 },
              { title: '投放点', dataIndex: 'dropCode', key: 'drop', width: 90 },
              { title: '群号', dataIndex: 'colonyCode', key: 'colony', width: 90 },
              { title: '投放时间窗', dataIndex: 'dropWindow', key: 'window' },
              { title: '撤场时间', dataIndex: 'withdrawTime', key: 'withdraw' },
              { title: '责任人', dataIndex: 'owner', key: 'owner' }
            ]}
          />
        </Card>

        <Card size="small" title={`转场路线表（${routeRows.length} 段）`}>
          <Table
            dataSource={routeRows}
            rowKey={(record, index) => `${record.from}-${record.to}-${index ?? 0}`}
            size="small"
            pagination={false}
            columns={[
              { title: '出发投放点', dataIndex: 'from', key: 'from' },
              { title: '到达投放点', dataIndex: 'to', key: 'to' },
              { title: '里程(km)', dataIndex: 'distanceKm', key: 'km', width: 100 },
              { title: '耗时(h)', dataIndex: 'durationH', key: 'hour', width: 90 },
              { title: '车辆', dataIndex: 'vehicleType', key: 'vehicle', width: 100 },
              { title: '出发时刻', dataIndex: 'departAt', key: 'depart' },
              { title: '途中风险', dataIndex: 'riskNote', key: 'risk' }
            ]}
          />
        </Card>
      </div>

      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Card size="small" title="蜂群投放一览（按群号）">
            <Space direction="vertical">
              {colonies.map((colony: BeeColony) => {
                const points = dropPoints.filter((item) => item.colonyCodes.includes(colony.code))
                return (
                  <Typography.Text key={colony.id}>
                    <Tag color="cyan">{colony.code}</Tag>
                    {colony.species} · {colony.strengthFrames} 足框 ·{' '}
                    {points.length > 0
                      ? points.map((item) => `${item.code}@${orchardName(item.orchardId)}`).join('、')
                      : '尚未安排投放点'}
                  </Typography.Text>
                )
              })}
            </Space>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card size="small" title="导出说明">
            <Typography.Paragraph style={{ fontSize: 13, marginBottom: 6 }}>
              1. 授粉安排清单按「地块 × 投放点 × 群号」展开，可直接给蜂场与园主核对；
            </Typography.Paragraph>
            <Typography.Paragraph style={{ fontSize: 13, marginBottom: 6 }}>
              2. 转场路线表包含里程、耗时、车辆与风险备注，实际执行情况可在“转场路线规划”页回填；
            </Typography.Paragraph>
            <Typography.Paragraph style={{ fontSize: 13, marginBottom: 0 }}>
              3. 点击「打印视图」后再选择打印机或另存 PDF；数据全部来自浏览器本地 IndexedDB。
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
