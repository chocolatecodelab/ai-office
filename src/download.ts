/** Saves text to the viewer's computer as a file, without a server round trip. */
export function downloadText(fileName: string, content: string, type = 'text/plain;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

/** A file's size as staff read it. */
export function sizeLabel(bytes: number): string {
  if(bytes>=1024**3)return `${(bytes/1024**3).toFixed(1)} GB`
  if(bytes>=1024**2)return `${(bytes/1024**2).toFixed(1)} MB`
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}
