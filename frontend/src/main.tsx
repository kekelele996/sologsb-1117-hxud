import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { AppRoutes } from '@/router'
import { seedDemoData, stampDbVersion } from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { colonyStore } from '@/stores/colonyStore'
import { droppointStore } from '@/stores/droppointStore'
import { routeStore } from '@/stores/routeStore'
import '@/styles/index.css'

/** 启动：写入示例数据（仅首次）→ 记录 schemaVersion → 从 IndexedDB 水合全部 store */
async function bootstrap(): Promise<void> {
  await seedDemoData()
  await stampDbVersion()
  await orchardStore.getState().hydrate()
  await colonyStore.getState().hydrate()
  await droppointStore.getState().hydrate()
  await routeStore.getState().hydrate()
}

void bootstrap()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider locale={zhCN}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>
)
