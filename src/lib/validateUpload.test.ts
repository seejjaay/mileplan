import { canonicalMime, validateUpload } from './validateUpload'

const MB = 1024 * 1024
const file = (name: string, type: string, bytes = 10) => new File([new Uint8Array(bytes)], name, { type })

describe('validateUpload', () => {
  it('rejects a file one byte over 10 MB', () => {
    expect(validateUpload(file('big.pdf', 'application/pdf', 10 * MB + 1))).toMatch(/10 MB/)
  })

  it('accepts a file of exactly 10 MB', () => {
    expect(validateUpload(file('edge.pdf', 'application/pdf', 10 * MB))).toBeNull()
  })

  it('rejects invoice.pdf whose type is text/html (renamed HTML)', () => {
    expect(validateUpload(file('invoice.pdf', 'text/html'))).not.toBeNull()
  })

  it('rejects invoice.html even when the type claims application/pdf', () => {
    expect(validateUpload(file('invoice.html', 'application/pdf'))).not.toBeNull()
  })

  it('rejects SVG (can carry script)', () => {
    expect(validateUpload(file('logo.svg', 'image/svg+xml'))).not.toBeNull()
  })

  it('rejects a file with no extension and an empty file', () => {
    expect(validateUpload(file('README', 'application/pdf'))).not.toBeNull()
    expect(validateUpload(file('empty.pdf', 'application/pdf', 0))).not.toBeNull()
  })

  it('accepts a 2 MB PDF, upper-case extensions and the usual image types', () => {
    expect(validateUpload(file('contract.pdf', 'application/pdf', 2 * MB))).toBeNull()
    expect(validateUpload(file('SCAN.PDF', 'application/pdf'))).toBeNull()
    expect(validateUpload(file('a.png', 'image/png'))).toBeNull()
    expect(validateUpload(file('a.jpg', 'image/jpeg'))).toBeNull()
    expect(validateUpload(file('a.jpeg', 'image/jpeg'))).toBeNull()
    expect(validateUpload(file('a.webp', 'image/webp'))).toBeNull()
    expect(validateUpload(file('a.gif', 'image/gif'))).toBeNull()
  })

  it('accepts a ZIP whichever type the OS reports, and sends the canonical type', () => {
    expect(validateUpload(file('bundle.zip', 'application/zip'))).toBeNull()
    expect(validateUpload(file('bundle.zip', 'application/x-zip-compressed'))).toBeNull()
    expect(canonicalMime(file('bundle.zip', 'application/x-zip-compressed'))).toBe('application/zip')
  })
})
