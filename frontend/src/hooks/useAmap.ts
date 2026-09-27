import { useEffect, useRef, useState } from 'react'

/** 高德地图 JS API 的最小类型声明（避免引入额外类型包） */
interface AMapMap {
  add: (overlay: unknown) => void
  remove: (overlay: unknown) => void
  setFitView: () => void
  destroy: () => void
}

interface AMapNamespace {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => AMapMap
  Marker: new (options: Record<string, unknown>) => unknown
  Polyline: new (options: Record<string, unknown>) => unknown
  Pixel: new (x: number, y: number) => unknown
  plugin: (names: string | string[], callback: () => void) => void
}

declare global {
  interface Window {
    AMap?: AMapNamespace
    _AMapSecurityConfig?: { securityJsCode?: string }
  }
}

export interface AmapState {
  /** 高德实例是否可用（key 缺失或加载失败时为 false → 组件降级为 SVG 网格） */
  available: boolean
  loading: boolean
  /** 降级原因，用于界面提示 */
  reason: string
  key: string
  /** 获取（或在需要时注入）AMap 命名空间 */
  getNamespace: () => AMapNamespace | null
}

const SCRIPT_ID = 'amap-js-api'

/**
 * 按需注入高德 JS API：
 * - 未配置 VITE_AMAP_KEY 时**不注入脚本**（避免无谓的网络请求与报错），直接降级；
 * - 配置了 key 但脚本加载失败时同样降级，功能不依赖网络。
 */
export function useAmap(): AmapState {
  const key = ((import.meta.env.VITE_AMAP_KEY as string | undefined) ?? '').trim()
  const [available, setAvailable] = useState(false)
  const [loading, setLoading] = useState(false)
  const [reason, setReason] = useState(key ? '' : '未配置 VITE_AMAP_KEY，已使用本地 SVG 网格视图')
  const namespaceRef = useRef<AMapNamespace | null>(null)

  useEffect(() => {
    if (!key) {
      setAvailable(false)
      setLoading(false)
      namespaceRef.current = null
      return
    }
    if (typeof window === 'undefined') return
    if (window.AMap) {
      namespaceRef.current = window.AMap
      setAvailable(true)
      setLoading(false)
      setReason('')
      return
    }
    setLoading(true)
    let cancelled = false
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    const script = existing ?? document.createElement('script')
    const handleLoad = (): void => {
      if (cancelled) return
      if (window.AMap) {
        namespaceRef.current = window.AMap
        setAvailable(true)
        setReason('')
      } else {
        setAvailable(false)
        setReason('高德地图脚本已加载但未就绪，已降级为本地 SVG 网格视图')
      }
      setLoading(false)
    }
    const handleError = (): void => {
      if (cancelled) return
      setAvailable(false)
      setLoading(false)
      setReason('高德地图脚本加载失败，已降级为本地 SVG 网格视图')
    }
    script.addEventListener('load', handleLoad)
    script.addEventListener('error', handleError)
    if (!existing) {
      script.id = SCRIPT_ID
      script.async = true
      script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}`
      document.head.appendChild(script)
    }
    return () => {
      cancelled = true
      script.removeEventListener('load', handleLoad)
      script.removeEventListener('error', handleError)
    }
  }, [key])

  return {
    available,
    loading,
    reason,
    key,
    getNamespace: () => namespaceRef.current ?? (typeof window !== 'undefined' ? window.AMap ?? null : null)
  }
}
