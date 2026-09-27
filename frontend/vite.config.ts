import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// 纯前端 SPA：构建产物交给 nginx:alpine 托管。
// 高德 key 通过 VITE_AMAP_KEY 注入；未配置时 RouteMap 自动降级为本地 SVG 网格视图，构建与运行都不依赖该 key。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    host: true,
    port: 21817
  },
  preview: {
    host: true,
    port: 21817
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1800
  }
})
