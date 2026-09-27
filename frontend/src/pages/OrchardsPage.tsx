import { useMemo, useState } from 'react'
import { Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import type { DropPoint, Orchard } from '@/types'
import { ACCESSIBILITIES, CROPS, suggestColonyBoxes } from '@/types'
import CoordPicker from '@/components/common/CoordPicker'
import FlowerWindowBar from '@/components/common/FlowerWindowBar'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { droppointStore } from '@/stores/droppointStore'
import { colonyStore } from '@/stores/colonyStore'
import { bloomDays } from '@/utils/geo'
import { uid } from '@/utils/id'

interface OrchardFormValues {
  name: string
  crop: Orchard['crop']
  areaMu: number
  colonyIntensity: number
  ownerContact: string
  accessibility: Orchard['accessibility']
  historyYears: string
  note: string
  bloom: [dayjs.Dayjs, dayjs.Dayjs]
}

interface DropFormValues {
  code: string
  capacityBoxes: number
  shade: string
  waterDistance: number
  dropWindow: dayjs.Dayjs
  withdrawTime: dayjs.Dayjs
  owner: string
  colonyCodes: string[]
}

/** 果园地块管理：录入面积与花期后自动给出建议箱数与可达性标记，并维护投放点 */
export default function OrchardsPage(): JSX.Element {
  const orchards = usePersistentStore(orchardStore, (state) => state.rows)
  const dropPoints = usePersistentStore(droppointStore, (state) => state.rows)
  const colonies = usePersistentStore(colonyStore, (state) => state.rows)

  const [orchardModal, setOrchardModal] = useState(false)
  const [editingOrchard, setEditingOrchard] = useState<Orchard | null>(null)
  const [coord, setCoord] = useState({ longitude: 107.41, latitude: 34.61 })
  const [orchardForm] = Form.useForm<OrchardFormValues>()

  const [dropModal, setDropModal] = useState(false)
  const [dropOwner, setDropOwner] = useState<Orchard | null>(null)
  const [dropCoord, setDropCoord] = useState({ longitude: 107.41, latitude: 34.61 })
  const [dropForm] = Form.useForm<DropFormValues>()

  const watchedArea = Form.useWatch('areaMu', orchardForm) ?? 0
  const watchedIntensity = Form.useWatch('colonyIntensity', orchardForm) ?? 0
  const suggestPreview = suggestColonyBoxes({
    areaMu: Number(watchedArea) || 0,
    colonyIntensity: Number(watchedIntensity) || 0
  })

  const dropsOf = useMemo(
    () => (orchardId: string): DropPoint[] => dropPoints.filter((item) => item.orchardId === orchardId),
    [dropPoints]
  )

  function openCreate(): void {
    setEditingOrchard(null)
    setCoord({ longitude: 107.41, latitude: 34.61 })
    orchardForm.setFieldsValue({
      name: '',
      crop: '苹果',
      areaMu: 100,
      colonyIntensity: 0.1,
      ownerContact: '',
      accessibility: '大车可达',
      historyYears: '2025',
      note: '',
      bloom: [dayjs().month(3).date(8), dayjs().month(3).date(18)]
    })
    setOrchardModal(true)
  }

  function openEdit(orchard: Orchard): void {
    setEditingOrchard(orchard)
    setCoord({ longitude: orchard.longitude, latitude: orchard.latitude })
    orchardForm.setFieldsValue({
      name: orchard.name,
      crop: orchard.crop,
      areaMu: orchard.areaMu,
      colonyIntensity: orchard.colonyIntensity,
      ownerContact: orchard.ownerContact,
      accessibility: orchard.accessibility,
      historyYears: orchard.historyYears.join('、'),
      note: orchard.note,
      bloom: [dayjs(orchard.bloomStart), dayjs(orchard.bloomEnd)]
    })
    setOrchardModal(true)
  }

  async function submitOrchard(): Promise<void> {
    const values = await orchardForm.validateFields()
    const row: Orchard = {
      id: editingOrchard?.id ?? uid('orc'),
      name: values.name.trim(),
      crop: values.crop,
      areaMu: Number(values.areaMu) || 0,
      longitude: coord.longitude,
      latitude: coord.latitude,
      bloomStart: values.bloom[0].format('YYYY-MM-DD'),
      bloomEnd: values.bloom[1].format('YYYY-MM-DD'),
      colonyIntensity: Number(values.colonyIntensity) || 0,
      ownerContact: values.ownerContact.trim(),
      accessibility: values.accessibility,
      historyYears: values.historyYears
        .split(/[、,，\s]+/)
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item) && item > 0),
      note: values.note?.trim() ?? ''
    }
    await orchardStore.getState().save(row)
    message.success(`地块「${row.name}」已保存，建议蜂群 ${suggestColonyBoxes(row)} 箱`)
    setOrchardModal(false)
  }

  async function removeOrchard(orchard: Orchard): Promise<void> {
    const drops = dropsOf(orchard.id)
    if (drops.length > 0) {
      message.error(`「${orchard.name}」下仍有 ${drops.length} 个投放点，请先清理投放点`)
      return
    }
    await orchardStore.getState().remove(orchard.id)
    message.success('地块已删除')
  }

  function openDrop(orchard: Orchard): void {
    setDropOwner(orchard)
    setDropCoord({ longitude: orchard.longitude, latitude: orchard.latitude })
    const index = dropPoints.filter((item) => item.orchardId === orchard.id).length + 1
    dropForm.setFieldsValue({
      code: `${orchard.crop.slice(0, 1)}-${String(index).padStart(2, '0')}`,
      capacityBoxes: suggestColonyBoxes(orchard),
      shade: '',
      waterDistance: 300,
      dropWindow: dayjs(orchard.bloomStart).subtract(1, 'day'),
      withdrawTime: dayjs(orchard.bloomEnd).add(1, 'day'),
      owner: '',
      colonyCodes: []
    })
    setDropModal(true)
  }

  async function submitDrop(): Promise<void> {
    if (!dropOwner) return
    const values = await dropForm.validateFields()
    const row: DropPoint = {
      id: uid('dp'),
      orchardId: dropOwner.id,
      longitude: dropCoord.longitude,
      latitude: dropCoord.latitude,
      code: values.code.trim(),
      capacityBoxes: Number(values.capacityBoxes) || 0,
      shade: values.shade?.trim() ?? '',
      waterDistance: Number(values.waterDistance) || 0,
      dropWindow: values.dropWindow.format('YYYY-MM-DD'),
      withdrawTime: values.withdrawTime.format('YYYY-MM-DD'),
      owner: values.owner?.trim() ?? '',
      colonyCodes: values.colonyCodes ?? []
    }
    await droppointStore.getState().save(row)
    message.success(`投放点 ${row.code} 已保存`)
    setDropModal(false)
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">果园地块管理</h2>
          <p className="page-sub">
            录入面积与需蜂强度后自动算出建议箱数；可达性以标签标记。每个地块可维护多个蜂群投放点（含可容纳箱数与时间窗）。
          </p>
        </div>
        <Button type="primary" onClick={openCreate}>
          新建地块
        </Button>
      </div>

      <Row gutter={[16, 16]}>
        {orchards.map((orchard) => (
          <Col key={orchard.id} xs={24} xl={12}>
            <Card
              size="small"
              title={
                <Space wrap>
                  <span>{orchard.name}</span>
                  <Tag color="blue">{orchard.crop}</Tag>
                  <Tag color={orchard.accessibility === '大车可达' ? 'green' : orchard.accessibility === '仅小车' ? 'gold' : 'red'}>
                    {orchard.accessibility}
                  </Tag>
                  <Tag color="orange">建议 {suggestColonyBoxes(orchard)} 箱</Tag>
                </Space>
              }
              extra={
                <Space>
                  <Button size="small" onClick={() => openEdit(orchard)}>
                    编辑
                  </Button>
                  <Button size="small" onClick={() => openDrop(orchard)}>
                    新增投放点
                  </Button>
                  <Button size="small" danger onClick={() => void removeOrchard(orchard)}>
                    删除
                  </Button>
                </Space>
              }
            >
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
                {orchard.areaMu} 亩 · 需蜂 {orchard.colonyIntensity} 箱/亩 · 园主 {orchard.ownerContact || '—'} · 历史授粉{' '}
                {orchard.historyYears.length > 0 ? orchard.historyYears.join('、') : '—'} 年 · 花期 {bloomDays(orchard)} 天
              </Typography.Paragraph>
              <FlowerWindowBar orchard={orchard} others={orchards.filter((item) => item.id !== orchard.id)} width={420} />
              <Table<DropPoint>
                style={{ marginTop: 10 }}
                size="small"
                pagination={false}
                dataSource={dropsOf(orchard.id)}
                rowKey="id"
                locale={{ emptyText: '暂无投放点' }}
                columns={[
                  { title: '编号', dataIndex: 'code', key: 'code', width: 80 },
                  { title: '可容纳', dataIndex: 'capacityBoxes', key: 'cap', width: 80, render: (value: number) => `${value} 箱` },
                  { title: '投放窗', dataIndex: 'dropWindow', key: 'win', width: 110 },
                  { title: '撤场', dataIndex: 'withdrawTime', key: 'with', width: 110 },
                  {
                    title: '安排群号',
                    key: 'codes',
                    render: (_, record: DropPoint) =>
                      record.colonyCodes.length > 0 ? record.colonyCodes.join('、') : '—'
                  },
                  {
                    title: '操作',
                    key: 'action',
                    width: 80,
                    render: (_, record: DropPoint) => (
                      <Button size="small" danger type="link" onClick={() => void droppointStore.getState().remove(record.id)}>
                        删除
                      </Button>
                    )
                  }
                ]}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Modal title={editingOrchard ? '编辑地块' : '新建地块'} open={orchardModal} onCancel={() => setOrchardModal(false)} onOk={() => void submitOrchard()} width={720} okText="保存">
        <Form form={orchardForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="name" label="地块名" rules={[{ required: true, message: '请填写地块名' }]}>
                <Input placeholder="如 北岭苹果园" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="crop" label="作物" rules={[{ required: true }]}>
                <Select options={CROPS.map((item) => ({ value: item, label: item }))} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="areaMu" label="面积（亩）" rules={[{ required: true }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="colonyIntensity" label="需蜂强度（箱/亩）" rules={[{ required: true }]}>
                <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="accessibility" label="道路可达性" rules={[{ required: true }]}>
                <Select options={ACCESSIBILITIES.map((item) => ({ value: item, label: item }))} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="ownerContact" label="园主联系方式">
                <Input placeholder="如 135****2043（周园主）" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="bloom" label="盛花期区间" rules={[{ required: true, message: '请选择盛花期区间' }]}>
                <DatePicker.RangePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="historyYears" label="历史授粉年份（顿号分隔）">
                <Input placeholder="如 2024、2025" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="note" label="备注">
                <Input placeholder="行距、坡向等" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="经纬度">
            <CoordPicker value={coord} onChange={setCoord} orchards={orchards} dropPoints={dropPoints} />
          </Form.Item>
          <OrchardSuggest suggest={suggestPreview} />
        </Form>
      </Modal>

      <Modal
        title={`新增投放点 · ${dropOwner?.name ?? ''}`}
        open={dropModal}
        onCancel={() => setDropModal(false)}
        onOk={() => void submitDrop()}
        width={720}
        okText="保存"
      >
        <Form form={dropForm} layout="vertical">
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="code" label="编号" rules={[{ required: true, message: '请填写投放点编号' }]}>
                <Input placeholder="如 A-03" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="capacityBoxes" label="可容纳箱数" rules={[{ required: true }]}>
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="waterDistance" label="水源距离（米）">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="dropWindow" label="投放时间窗" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="withdrawTime" label="撤场时间" rules={[{ required: true }]}>
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="owner" label="责任人">
                <Input />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="shade" label="遮阴条件">
                <Input placeholder="如 北侧有防风林，午后半阴" />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item name="colonyCodes" label="安排群号（同一群跨地块重叠即冲突）">
                <Select mode="multiple" options={colonies.map((item) => ({ value: item.code, label: `${item.code}（${item.species} ${item.strengthFrames} 足框）` }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="经纬度">
            <CoordPicker value={dropCoord} onChange={setDropCoord} orchards={orchards} dropPoints={dropPoints} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

/** 建议箱数提示条（面积 × 需蜂强度向上取整，最少 1 箱） */
function OrchardSuggest({ suggest }: { suggest: number }): JSX.Element {
  return (
    <Typography.Text type="secondary">
      系统建议投放 {suggest} 箱；按每个投放点 8 箱估算，约需 {Math.max(1, Math.ceil(suggest / 8))} 个投放点。
    </Typography.Text>
  )
}
