import { objectPath, uploadTo } from './storage'

const upload = vi.fn()
vi.mock('../lib/supabase', () => ({ supabase: { storage: { from: () => ({ upload: (...args: unknown[]) => upload(...args) }) } } }))
afterEach(() => vi.clearAllMocks())

const file = (name: string) => new File(['x'], name, { type: 'image/png' })

describe('objectPath', () => {
  it('is {projectId}/{uuid}-{name}', () => {
    expect(objectPath('11111111-1111-1111-1111-111111111111', file('logo.png'))).toMatch(
      /^11111111-1111-1111-1111-111111111111\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-logo\.png$/,
    )
  })

  it('strips path separators and traversal from the file name', () => {
    const path = objectPath('p1', file('../../etc/pass wd.png'))
    expect(path.split('/')).toHaveLength(2)
    expect(path).not.toContain('..')
    expect(path).toMatch(/^p1\/[0-9a-f-]{36}-.*\.png$/)
  })

  it('is different for the same file uploaded twice', () => {
    expect(objectPath('p1', file('a.png'))).not.toBe(objectPath('p1', file('a.png')))
  })
})

describe('uploadTo', () => {
  it('refuses a disallowed file before any network call', async () => {
    await expect(uploadTo('attachments', 'p1', new File(['<html>'], 'invoice.html', { type: 'text/html' }))).rejects.toThrow(/invoice\.html/)
    expect(upload).not.toHaveBeenCalled()
  })

  it('sends the canonical content type and returns the descriptor', async () => {
    upload.mockResolvedValue({ error: null })
    const result = await uploadTo('documents', 'p1', new File(['PK'], 'bundle.zip', { type: 'application/x-zip-compressed' }))
    expect(upload).toHaveBeenCalledWith(expect.stringMatching(/^p1\/.+-bundle\.zip$/), expect.any(File), { contentType: 'application/zip', upsert: false })
    expect(result).toMatchObject({ name: 'bundle.zip', size: 2, mime: 'application/zip' })
  })

  it('throws the storage error', async () => {
    upload.mockResolvedValue({ error: new Error('quota') })
    await expect(uploadTo('documents', 'p1', new File(['x'], 'a.png', { type: 'image/png' }))).rejects.toThrow('quota')
  })
})
