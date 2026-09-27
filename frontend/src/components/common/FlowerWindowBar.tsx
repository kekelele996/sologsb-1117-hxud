import type { Orchard } from '@/types'
import { bloomDays, flowerWindowOverlap, toDateValue } from '@/utils/geo'

export interface FlowerWindowBarProps {
  /** 主地块 */
  orchard: Orchard
  /** 用于重叠判定的其他地块 */
  others?: Orchard[]
  /** 条带总宽度（像素） */
  width?: number
  /** 是否显示重叠提示文字 */
  showOverlapText?: boolean
}

const DAY = 86400000

/** 花期时间条带：渲染盛花期区间与重叠提示 */
export default function FlowerWindowBar({
  orchard,
  others = [],
  width = 420,
  showOverlapText = true
}: FlowerWindowBarProps): JSX.Element {
  const start = toDateValue(orchard.bloomStart)
  const end = toDateValue(orchard.bloomEnd)
  const days = Math.max(1, bloomDays(orchard))

  const overlaps = others
    .map((other) => ({ other, result: flowerWindowOverlap(orchard.bloomStart, orchard.bloomEnd, other.bloomStart, other.bloomEnd) }))
    .filter((item) => item.result.overlap)

  const dayWidth = width / days
  const marks = Array.from({ length: days + 1 }, (_, index) => index * dayWidth)

  return (
    <div className="flower-bar" data-testid="flower-window-bar">
      <div className="flower-head">
        <span className="flower-name">
          {orchard.name} · {orchard.crop} · {orchard.areaMu} 亩
        </span>
        <span className="flower-range">
          {orchard.bloomStart} ~ {orchard.bloomEnd}（{days} 天）
        </span>
      </div>
      <svg width={width} height={34} role="img" aria-label={`${orchard.name} 花期条带`}>
        <rect x={0} y={8} width={width} height={18} rx={4} fill="#eef2f6" />
        <rect
          x={0}
          y={8}
          width={width}
          height={18}
          rx={4}
          fill={overlaps.length > 0 ? 'url(#overlapGradient)' : '#8fd3c7'}
        />
        <defs>
          <linearGradient id="overlapGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#f2c14e" />
            <stop offset="100%" stopColor="#e08a3c" />
          </linearGradient>
        </defs>
        <g stroke="#cfd9e2" strokeWidth={1}>
          {marks.map((x) => (
            <line key={x} x1={x} y1={8} x2={x} y2={26} />
          ))}
        </g>
        {overlaps.map((item) => {
          const oStart = Math.max(start, toDateValue(item.other.bloomStart))
          const oEnd = Math.min(end, toDateValue(item.other.bloomEnd))
          const x = ((oStart - start) / DAY) * dayWidth
          const w = Math.max(2, ((oEnd - oStart) / DAY + 1) * dayWidth)
          return <rect key={item.other.id} x={x} y={8} width={w} height={18} rx={3} fill="#c0392b" opacity={0.35} />
        })}
      </svg>
      {showOverlapText ? (
        overlaps.length > 0 ? (
          <ul className="overlap-list">
            {overlaps.map((item) => (
              <li key={item.other.id}>
                与「{item.other.name}」花期重叠 {item.result.days} 天（{item.result.range}）→ 蜂群排程需错峰
              </li>
            ))}
          </ul>
        ) : (
          <p className="no-overlap">与当前地块无花期重叠</p>
        )
      ) : null}
    </div>
  )
}
