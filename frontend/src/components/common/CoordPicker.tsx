import { useState } from 'react'
import { Button, InputNumber, Space, Typography } from 'antd'
import type { DropPoint, Orchard } from '@/types'
import RouteMap from './RouteMap'
import type { LngLat } from '@/utils/geo'

export interface CoordPickerProps {
  value: LngLat
  onChange: (value: LngLat) => void
  /** 地图点选时需要展示的参考要素 */
  orchards?: Orchard[]
  dropPoints?: DropPoint[]
  label?: string
}

/** 经纬度拾取输入：手输与地图点选双向同步，含范围校验 */
export default function CoordPicker({
  value,
  onChange,
  orchards = [],
  dropPoints = [],
  label = '经纬度'
}: CoordPickerProps): JSX.Element {
  const [picking, setPicking] = useState(false)

  const invalid =
    !Number.isFinite(value.longitude) ||
    !Number.isFinite(value.latitude) ||
    value.longitude < -180 ||
    value.longitude > 180 ||
    value.latitude < -90 ||
    value.latitude > 90

  function patch(next: Partial<LngLat>): void {
    onChange({ ...value, ...next })
  }

  return (
    <div className="coord-picker" data-testid="coord-picker">
      <Space direction="vertical" size={6} style={{ width: '100%' }}>
        <Space wrap>
          <span className="coord-label">{label}</span>
          <InputNumber
            addonBefore="经度"
            value={value.longitude}
            step={0.0001}
            precision={4}
            style={{ width: 210 }}
            onChange={(next) => patch({ longitude: Number(next ?? 0) })}
            status={invalid ? 'error' : undefined}
          />
          <InputNumber
            addonBefore="纬度"
            value={value.latitude}
            step={0.0001}
            precision={4}
            style={{ width: 210 }}
            onChange={(next) => patch({ latitude: Number(next ?? 0) })}
            status={invalid ? 'error' : undefined}
          />
          <Button onClick={() => setPicking((prev) => !prev)}>{picking ? '收起地图点选' : '地图点选'}</Button>
        </Space>
        {invalid ? (
          <Typography.Text type="danger">经纬度超出范围：经度 -180~180，纬度 -90~90</Typography.Text>
        ) : (
          <Typography.Text type="secondary">
            当前坐标：{value.longitude.toFixed(4)}, {value.latitude.toFixed(4)}
          </Typography.Text>
        )}
        {picking ? (
          <RouteMap
            orchards={orchards}
            dropPoints={dropPoints}
            height={260}
            title="点击网格选择坐标"
            onPick={(point) => onChange(point)}
          />
        ) : null}
      </Space>
      <style>{`
        .coord-label { font-size: 12px; color: #6b7b8c; }
        .coord-picker { width: 100%; }
      `}</style>
    </div>
  )
}
