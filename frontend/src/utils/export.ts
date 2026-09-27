/** 触发浏览器下载文本文件 */
export function downloadText(filename: string, content: string, mime = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/** 导出 JSON */
export function downloadJson(filename: string, data: unknown): void {
  downloadText(filename, JSON.stringify(data, null, 2), 'application/json;charset=utf-8')
}

/** 数组转 CSV */
export function toCsv<T extends Record<string, unknown>>(
  rows: T[],
  headers: { key: keyof T; label: string }[]
): string {
  const head = headers.map((item) => item.label).join(',')
  const body = rows
    .map((row) =>
      headers
        .map((item) => {
          const raw = row[item.key]
          const text = raw === null || raw === undefined ? '' : String(raw)
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
        })
        .join(',')
    )
    .join('\n')
  return `${head}\n${body}\n`
}

/** 导出 CSV */
export function downloadCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  headers: { key: keyof T; label: string }[]
): void {
  downloadText(filename, toCsv(rows, headers), 'text/csv;charset=utf-8')
}
