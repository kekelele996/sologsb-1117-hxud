import { Tag } from 'antd'
import type { ColonyStatus } from '@/types'

const COLORS: Record<ColonyStatus, string> = {
  待投放: 'default',
  在园: 'green',
  转场中: 'gold',
  回场: 'blue'
}

export interface StatusTagProps {
  status: ColonyStatus
  /** 附加说明（如当前所在地块） */
  hint?: string
}

/** 蜂群状态标签：4 种状态各自配色 */
export default function StatusTag({ status, hint }: StatusTagProps): JSX.Element {
  return (
    <Tag color={COLORS[status]} data-testid="status-tag">
      {status}
      {hint ? ` · ${hint}` : ''}
    </Tag>
  )
}
