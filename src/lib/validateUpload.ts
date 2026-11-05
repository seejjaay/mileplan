const MAX_BYTES = 10 * 1024 * 1024

// Raster images, PDF and ZIP only (SVG is excluded on purpose: it can carry script).
const MIME_BY_EXT: Record<string, string[]> = {
  png: ['image/png'],
  jpg: ['image/jpeg'],
  jpeg: ['image/jpeg'],
  webp: ['image/webp'],
  gif: ['image/gif'],
  pdf: ['application/pdf'],
  zip: ['application/zip', 'application/x-zip-compressed'], // Windows reports the second for .zip
}

export const ACCEPT_ATTR = Object.keys(MIME_BY_EXT).map((e) => `.${e}`).join(',')

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** The content type we send to storage: derived from the (validated) extension, so a ZIP is always application/zip. */
export function canonicalMime(file: File): string {
  return MIME_BY_EXT[extOf(file.name)]?.[0] ?? file.type
}

/** Error text, or null when the file may be uploaded. Both the extension and the reported type must agree. */
export function validateUpload(file: File): string | null {
  if (file.size === 0) return `${file.name} is empty`
  if (file.size > MAX_BYTES) return `${file.name} is over 10 MB`
  const allowed = MIME_BY_EXT[extOf(file.name)]
  if (!allowed) return `${file.name}: only images (PNG, JPG, WebP, GIF), PDF and ZIP files can be uploaded`
  if (!allowed.includes(file.type)) return `${file.name} doesn’t match its file type, so it can’t be uploaded`
  return null
}
