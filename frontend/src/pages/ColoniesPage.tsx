import { useMemo, useState } from 'react'
import { Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Row, Select, Slider, Space, Table, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import type { BeeColony, ColonyStatus } from '@/types'
import { BEE_SPECIES, BOX_TYPES, COLONY_STATUSES } from '@/types'
import StatusTag from '@/components/common/StatusTag'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { colonyStore } from '@/stores/colonyStore'
import { orchardStore } from '@/stores/orchardStore'
import { uid } from '@/utils/id'

/** 蜂群台账：按群势与状态筛选，支持批量改状态与记录检查备注 */
export default function ColoniesPage(): JSX.Element {
  const colonies = usePersistentStore(colonyStore, (state) => state.rows)
  const orchards = usePersistentStore(orchardStore, (state) => state.rows)

  const [statusFilter, setStatusFilter] = useState<ColonyStatus | ''>('')
  const [minFrames, setMinFrames] = useState(0)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [batchStatus, setBatchStatus] = useState<ColonyStatus>('在园')
  const [checkNote, setCheckNote] = useState('')
  const [checkDate, setCheckDate] = useState(dayjs())
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<BeeColony | null>(null)
  const [form] = Form.useForm<{
    code: string
    species: BeeColony['species']
    strengthFrames: number
    boxType: BeeColony['boxType']
    currentOrchardId: string
    status: ColonyStatus
    lastCheckDate: dayjs.Dayjs
    healthNote: string
  }>()

  const filtered = useMemo(
    () =>
      colonies.filter((item) => {
        if (statusFilter && item.status !== statusFilter) return false
        if (item.strengthFrames < minFrames) return false
        return true
      }),
    [colonies, statusFilter, minFrames]
  )

  function orchardName(id: string): string {
    return orchards.find((item) => item.id === id)?.name ?? '未分配地块'
  }

  function openCreate(): void {
    setEditing(null)
    form.setFieldsValue({
      code: `Q-${String(colonies.length + 1).padStart(2, '0')}`,
      species: '意蜂',
      strengthFrames: 6,
      boxType: '标准继箱',
      currentOrchardId: orchards[0]?.id ?? '',
      status: '待投放',
      lastCheckDate: dayjs(),
      healthNote: ''
    })
    setModalOpen(true)
  }

  function openEdit(colony: BeeColony): void {
    setEditing(colony)
    form.setFieldsValue({
      code: colony.code,
      species: colony.species,
      strengthFrames: colony.strengthFrames,
      boxType: colony.boxType,
      currentOrchardId: colony.currentOrchardId,
      status: colony.status,
      lastCheckDate: dayjs(colony.lastCheckDate),
      healthNote: colony.healthNote
    })
    setModalOpen(true)
  }

  async function submit(): Promise<void> {
    const values = await form.validateFields()
    if (colonies.some((item) => item.code === values.code.trim() && item.id !== editing?.id)) {
      message.error(`群号 ${values.code} 已存在`)
      return
    }
    const row: BeeColony = {
      id: editing?.id ?? uid('col'),
      code: values.code.trim(),
      species: values.species,
      strengthFrames: Number(values.strengthFrames) || 0,
      boxType: values.boxType,
      currentOrchardId: values.currentOrchardId ?? '',
      status: values.status,
      lastCheckDate: values.lastCheckDate.format('YYYY-MM-DD'),
      healthNote: values.healthNote?.trim() ?? ''
    }
    await colonyStore.getState().save(row)
    message.success(`蜂群 ${row.code} 已保存`)
    setModalOpen(false)
  }

  async function applyBatchStatus(): Promise<void> {
    if (selectedKeys.length === 0) {
      message.warning('请先勾选蜂群')
      return
    }
    await colonyStore.getState().bulkSetStatus(selectedKeys, batchStatus)
    message.success(`已把 ${selectedKeys.length} 群状态改为「${batchStatus}」`)
    setSelectedKeys([])
  }

  async function applyCheckNote(): Promise<void> {
    if (selectedKeys.length === 0) {
      message.warning('请先勾选蜂群')
      return
    }
    if (!checkNote.trim()) {
      message.warning('请填写检查备注')
      return
    }
    await colonyStore.getState().bulkSetHealthNote(selectedKeys, checkNote.trim(), checkDate.format('YYYY-MM-DD'))
    message.success(`已为 ${selectedKeys.length} 群记录检查备注`)
    setCheckNote('')
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">蜂群台账</h2>
          <p className="page-sub">
            按群势与状态筛选蜂群；支持多选批量改状态与统一记录检查备注（会同步最近检查日期）。
          </p>
        </div>
        <Button type="primary" onClick={openCreate}>
          新增蜂群
        </Button>
      </div>

      <Card size="small">
        <Row gutter={[16, 12]} align="bottom">
          <Col xs={24} md={6}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              状态筛选
            </Typography.Text>
            <Select
              style={{ width: '100%' }}
              value={statusFilter}
              onChange={(value) => setStatusFilter(value)}
              options={[{ value: '', label: '全部状态' }, ...COLONY_STATUSES.map((item) => ({ value: item, label: item }))]}
            />
          </Col>
          <Col xs={24} md={8}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              最小群势：{minFrames} 足框
            </Typography.Text>
            <Slider min={0} max={12} value={minFrames} onChange={setMinFrames} />
          </Col>
          <Col xs={24} md={10}>
            <Space wrap>
              <Select
                style={{ width: 140 }}
                value={batchStatus}
                onChange={(value) => setBatchStatus(value)}
                options={COLONY_STATUSES.map((item) => ({ value: item, label: `改为 ${item}` }))}
              />
              <Button onClick={() => void applyBatchStatus()}>批量改状态</Button>
              <Input
                style={{ width: 200 }}
                placeholder="检查备注"
                value={checkNote}
                onChange={(event) => setCheckNote(event.target.value)}
              />
              <DatePicker value={checkDate} onChange={(value) => setCheckDate(value ?? dayjs())} />
              <Button onClick={() => void applyCheckNote()}>批量记录检查</Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Card size="small" title={`蜂群清单（命中 ${filtered.length} / ${colonies.length}）`}>
        <Table<BeeColony>
          dataSource={filtered}
          rowKey="id"
          pagination={false}
          rowSelection={{ selectedRowKeys: selectedKeys, onChange: (keys) => setSelectedKeys(keys as string[]) }}
          columns={[
            { title: '群号', dataIndex: 'code', key: 'code', width: 90 },
            { title: '蜂种', dataIndex: 'species', key: 'species', width: 80 },
            {
              title: '群势',
              dataIndex: 'strengthFrames',
              key: 'frames',
              width: 110,
              sorter: (a: BeeColony, b: BeeColony) => a.strengthFrames - b.strengthFrames,
              render: (value: number) => `${value} 足框`
            },
            { title: '箱型', dataIndex: 'boxType', key: 'box', width: 110 },
            {
              title: '当前所在地块',
              key: 'orchard',
              render: (_, record: BeeColony) => (record.currentOrchardId ? orchardName(record.currentOrchardId) : '—')
            },
            {
              title: '状态',
              key: 'status',
              width: 180,
              render: (_, record: BeeColony) => <StatusTag status={record.status} hint={record.currentOrchardId ? orchardName(record.currentOrchardId) : undefined} />
            },
            { title: '最近检查', dataIndex: 'lastCheckDate', key: 'check', width: 120 },
            { title: '健康备注', dataIndex: 'healthNote', key: 'note', render: (value: string) => value || '—' },
            {
              title: '操作',
              key: 'action',
              width: 140,
              render: (_, record: BeeColony) => (
                <Space>
                  <Button size="small" type="link" onClick={() => openEdit(record)}>
                    编辑
                  </Button>
                  <Button size="small" type="link" danger onClick={() => void colonyStore.getState().remove(record.id)}>
                    删除
                  </Button>
                </Space>
              )
            }
          ]}
        />
      </Card>

      <Card size="small" title="状态分布">
        <Space wrap>
          {COLONY_STATUSES.map((status) => (
            <Tag key={status} color="default">
              {status}：{colonies.filter((item) => item.status === status).length} 群
            </Tag>
          ))}
          <Tag color="blue">平均群势：{(colonies.reduce((sum, item) => sum + item.strengthFrames, 0) / Math.max(1, colonies.length)).toFixed(1)} 足框</Tag>
        </Space>
      </Card>

      <Modal title={editing ? '编辑蜂群' : '新增蜂群'} open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void submit()} okText="保存" width={680}>
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="code" label="群号" rules={[{ required: true, message: '请填写群号' }]}>
                <Input placeholder="如 Q-04" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="species" label="蜂种" rules={[{ required: true }]}>
                <Select options={BEE_SPECIES.map((item) => ({ value: item, label: item }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="strengthFrames" label="群势（足框）" rules={[{ required: true }]}>
                <InputNumber min={0} max={20} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="boxType" label="箱型" rules={[{ required: true }]}>
                <Select options={BOX_TYPES.map((item) => ({ value: item, label: item }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="status" label="状态" rules={[{ required: true }]}>
                <Select options={COLONY_STATUSES.map((item) => ({ value: item, label: item }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="lastCheckDate" label="最近检查日期" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="currentOrchardId" label="当前所在地块">
                <Select
                  allowClear
                  options={orchards.map((item) => ({ value: item.id, label: `${item.name}（${item.crop}）` }))}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="healthNote" label="蜂群健康备注">
                <Input.TextArea rows={2} placeholder="如 轻微螨害，转场后需治螨" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  )
}
