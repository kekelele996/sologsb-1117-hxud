import { useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { Alert, Tag } from 'antd'
import type { DropPoint, Orchard, TransitRoute } from '@/types'
import { useAmap } from '@/hooks/useAmap'
import { boundsOf, distanceKm, projectToGrid, routeLegs, unprojectFromGrid, type LngLat } from '@/utils/geo'

export interface RouteMapProps {
  orchards: Orchard[]
  dropPoints: DropPoint[]
  routes?: TransitRoute[]
  /** 转场顺序（投放点 id 列表），用于绘制折线与里程标注 */
  orderedDropIds?: string[]
  /** 点选模式：在图上点击拾取坐标 */
  onPick?: (point: LngLat) => void
  /** 当前高亮的地块 / 投放点 */
  highlightOrchardId?: string
  height?: number
  title?: string
}

const PADDING = 42

interface AMapOverlay {
  clear?: () => void
}
interface AMapInstance {
  add: (overlay: unknown) => void
  remove: (overlay: unknown) => void
  setFitView: () => void
  destroy: () => void
}
interface AMapNamespaceLike {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapInstance
  Marker: new (options: Record<string, unknown>) => AMapOverlay
  Polyline: new (options: Record<string, unknown>) => AMapOverlay
  Pixel: new (x: number, y: number) => unknown
}

/**
 * 地图容器：
 * 1) 配置了 VITE_AMAP_KEY 且脚本加载成功 → 使用高德地图 JS API 渲染地块 / 投放点 / 转场折线；
 * 2) 未配置 key 或加载失败 → 自动降级为本地 SVG 网格视图（经纬度线性映射），功能完全可用、不依赖网络。
 */
export default function RouteMap({
  orchards,
  dropPoints,
  routes = [],
  orderedDropIds = [],
  onPick,
  highlightOrchardId,
  height = 420,
  title = '授粉地图'
}: RouteMapProps): JSX.Element {
  const { available, loading, reason, getNamespace } = useAmap()
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<AMapInstance | null>(null)

  /** 所有参与投影的点 */
  const allPoints = useMemo<LngLat[]>(
    () => [
      ...orchards.map((item) => ({ longitude: item.longitude, latitude: item.latitude })),
      ...dropPoints.map((item) => ({ longitude: item.longitude, latitude: item.latitude }))
    ],
    [orchards, dropPoints]
  )

  const gridBounds = useMemo(() => boundsOf(allPoints, 880, height, PADDING), [allPoints, height])

  const orderedDrops = useMemo(
    () =>
      orderedDropIds
        .map((id) => dropPoints.find((item) => item.id === id))
        .filter((item): item is DropPoint => Boolean(item)),
    [orderedDropIds, dropPoints]
  )

  const legs = useMemo(() => routeLegs(orderedDrops.map((item) => ({ longitude: item.longitude, latitude: item.latitude }))), [orderedDrops])

  /* ---------- 高德地图渲染（仅在 key 可用时执行） ---------- */
  useEffect(() => {
    if (!available || !containerRef.current) return
    const ns = getNamespace() as unknown as AMapNamespaceLike | null
    if (!ns) return
    const center: [number, number] = allPoints.length > 0
      ? [allPoints[0].longitude, allPoints[0].latitude]
      : [107.41, 34.61]
    const map = new ns.Map(containerRef.current, {
      zoom: 11,
      center,
      mapStyle: 'amap://styles/whitesmoke'
    })
    mapRef.current = map
    const overlays: AMapOverlay[] = []
    orchards.forEach((orchard) => {
      overlays.push(
        new ns.Marker({
          position: [orchard.longitude, orchard.latitude],
          title: `${orchard.name}（${orchard.crop} ${orchard.areaMu} 亩）`,
          label: { content: `${orchard.name}`, direction: 'top' }
        })
      )
    })
    dropPoints.forEach((point) => {
      overlays.push(
        new ns.Marker({
          position: [point.longitude, point.latitude],
          title: `投放点 ${point.code}（可容纳 ${point.capacityBoxes} 箱）`,
          label: { content: point.code, direction: 'bottom' }
        })
      )
    })
    if (orderedDrops.length > 1) {
      overlays.push(
        new ns.Polyline({
          path: orderedDrops.map((item) => [item.longitude, item.latitude]),
          strokeColor: '#c98a1b',
          strokeWeight: 4,
          strokeStyle: 'solid'
        })
      )
    }
    overlays.forEach((overlay) => map.add(overlay))
    map.setFitView()
    return () => {
      map.destroy()
      mapRef.current = null
    }
  }, [available, orchards, dropPoints, orderedDrops, allPoints, getNamespace])

  /* ---------- SVG 网格交互 ---------- */
  function handleGridClick(event: ReactMouseEvent<SVGSVGElement>): void {
    if (!onPick) return
    const rect = event.currentTarget.getBoundingClientRect()
    const x = ((event.clientX - rect.left) / rect.width) * gridBounds.width
    const y = ((event.clientY - rect.top) / rect.height) * gridBounds.height
    onPick(unprojectFromGrid({ x, y }, gridBounds))
  }

  const gridLines = useMemo(() => {
    const step = 40
    const xs: number[] = []
    const ys: number[] = []
    for (let x = 0; x <= gridBounds.width; x += step) xs.push(x)
    for (let y = 0; y <= gridBounds.height; y += step) ys.push(y)
    return { xs, ys }
  }, [gridBounds])

  return (
    <div className="route-map" data-testid="route-map">
      <div className="map-head">
        <span className="map-title">{title}</span>
        <span className="map-source">
          {available ? (
            <Tag color="green">数据源：高德地图 JS API</Tag>
          ) : (
            <Tag color="gold" data-testid="map-fallback-tag">
              数据源：本地 SVG 网格视图
            </Tag>
          )}
          {loading ? <Tag>地图脚本加载中…</Tag> : null}
          <span className="map-hint">
            地块 {orchards.length} · 投放点 {dropPoints.length} · 转场段 {routes.length || Math.max(0, orderedDrops.length - 1)}
            {legs.total > 0 ? ` · 累计 ${legs.total} km` : ''}
          </span>
        </span>
      </div>

      {!available && reason ? (
        <Alert
          type="warning"
          showIcon
          banner
          style={{ marginBottom: 8 }}
          message={reason}
          description="降级视图按经纬度线性映射渲染地块、投放点与转场折线，可正常完成规划与点选，功能不依赖网络。"
        />
      ) : null}

      {available ? (
        <div ref={containerRef} style={{ width: '100%', height }} className="amap-container" />
      ) : (
        <svg
          width="100%"
          viewBox={`0 0 ${gridBounds.width} ${gridBounds.height}`}
          height={height}
          className="grid-svg"
          onClick={handleGridClick}
          style={{ cursor: onPick ? 'crosshair' : 'default' }}
          role="img"
          aria-label="本地 SVG 网格地图"
        >
          <rect width={gridBounds.width} height={gridBounds.height} fill="#fbfaf6" stroke="#dfe7ee" />
          <g stroke="#eef2f6" strokeWidth={1}>
            {gridLines.xs.map((x) => (
              <line key={`gx${x}`} x1={x} y1={0} x2={x} y2={gridBounds.height} />
            ))}
            {gridLines.ys.map((y) => (
              <line key={`gy${y}`} x1={0} y1={y} x2={gridBounds.width} y2={y} />
            ))}
          </g>
          {/* 花果地块 */}
          {orchards.map((orchard) => {
            const point = projectToGrid(orchard, gridBounds)
            const active = highlightOrchardId === orchard.id
            return (
              <g key={orchard.id}>
                <rect
                  x={point.x - 14}
                  y={point.y - 14}
                  width={28}
                  height={28}
                  rx={5}
                  fill={active ? 'rgba(201,138,27,0.35)' : 'rgba(63,122,77,0.22)'}
                  stroke={active ? '#c98a1b' : '#3f7a4d'}
                  strokeWidth={1.6}
                />
                <text x={point.x} y={point.y + 4} fontSize={11} textAnchor="middle" fill="#2b3a2f">
                  {orchard.crop.slice(0, 1)}
                </text>
                <text x={point.x + 18} y={point.y - 6} fontSize={11} fill="#3c4b57">
                  {orchard.name}
                </text>
                <text x={point.x + 18} y={point.y + 8} fontSize={10} fill="#7f8d82">
                  {orchard.bloomStart.slice(5)} ~ {orchard.bloomEnd.slice(5)} · {orchard.areaMu} 亩
                </text>
              </g>
            )
          })}
          {/* 投放点 */}
          {dropPoints.map((point) => {
            const grid = projectToGrid(point, gridBounds)
            const index = orderedDropIds.indexOf(point.id)
            return (
              <g key={point.id}>
                <circle
                  cx={grid.x}
                  cy={grid.y}
                  r={index >= 0 ? 8 : 6}
                  fill={index >= 0 ? '#c98a1b' : '#2f6f8f'}
                  stroke="#fff"
                  strokeWidth={1.5}
                />
                {index >= 0 ? (
                  <text x={grid.x} y={grid.y + 3.5} fontSize={9} textAnchor="middle" fill="#fff">
                    {index + 1}
                  </text>
                ) : null}
                <text x={grid.x + 11} y={grid.y + 4} fontSize={11} fill="#2f6f8f">
                  {point.code}
                </text>
              </g>
            )
          })}
          {/* 转场折线 */}
          {orderedDrops.length > 1 ? (
            <g>
              <polyline
                points={orderedDrops.map((item) => {
                  const grid = projectToGrid(item, gridBounds)
                  return `${grid.x},${grid.y}`
                }).join(' ')}
                fill="none"
                stroke="#c98a1b"
                strokeWidth={3}
                strokeLinejoin="round"
                strokeDasharray="8 4"
              />
              {orderedDrops.slice(1).map((item, index) => {
                const from = projectToGrid(orderedDrops[index], gridBounds)
                const to = projectToGrid(item, gridBounds)
                return (
                  <text
                    key={`leg-${item.id}`}
                    x={(from.x + to.x) / 2}
                    y={(from.y + to.y) / 2 - 6}
                    fontSize={10}
                    textAnchor="middle"
                    fill="#a4640f"
                  >
                    {distanceKm(orderedDrops[index], item)} km
                  </text>
                )
              })}
            </g>
          ) : null}
          {/* 已保存路线的虚线参考 */}
          {orderedDrops.length === 0 && routes.length > 0
            ? routes.map((route) => {
                const from = dropPoints.find((item) => item.id === route.fromDropId)
                const to = dropPoints.find((item) => item.id === route.toDropId)
                if (!from || !to) return null
                const a = projectToGrid(from, gridBounds)
                const b = projectToGrid(to, gridBounds)
                return (
                  <line
                    key={route.id}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="#8e6bbf"
                    strokeWidth={2}
                    strokeDasharray="4 3"
                  />
                )
              })
            : null}
          {allPoints.length === 0 ? (
            <text x={gridBounds.width / 2 - 90} y={gridBounds.height / 2} fontSize={13} fill="#8a97a3">
              暂无地块与投放点数据
            </text>
          ) : null}
        </svg>
      )}
      <style>{`
        .map-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
        .map-title { font-size: 14px; font-weight: 600; color: #2b3a2f; }
        .map-source { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .map-hint { font-size: 12px; color: #7f8d82; }
        .amap-container { border-radius: 10px; overflow: hidden; border: 1px solid #e6ecf1; }
        .grid-svg { border-radius: 10px; border: 1px solid #e6ecf1; background: #fbfaf6; }
      `}</style>
    </div>
  )
}
