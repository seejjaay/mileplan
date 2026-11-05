import { postUpdate } from './updates'
import { removeObjects, uploadTo } from './storage'

const insert = vi.fn()

vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({ insert: (row: unknown) => insert(row) }) } }))
vi.mock('./storage', () => ({ uploadTo: vi.fn(), removeObjects: vi.fn() }))

const png = new File(['x'], 'a.png', { type: 'image/png' })

beforeEach(() => {
  vi.mocked(uploadTo).mockResolvedValue({ path: 'p1/uuid-a.png', name: 'a.png', size: 1, mime: 'image/png' })
})
afterEach(() => vi.clearAllMocks())

describe('postUpdate', () => {
  it('uploads attachments first, then inserts the row with their descriptors', async () => {
    insert.mockResolvedValue({ error: null })
    await postUpdate({ projectId: 'p1', authorId: 'u1', body: ' Hello ', milestoneId: 'm1', files: [png] })
    expect(uploadTo).toHaveBeenCalledWith('attachments', 'p1', png)
    expect(insert).toHaveBeenCalledWith({
      project_id: 'p1',
      author_id: 'u1',
      body: 'Hello',
      milestone_id: 'm1',
      attachments: [{ path: 'p1/uuid-a.png', name: 'a.png', size: 1, mime: 'image/png' }],
    })
  })

  it('removes the uploaded files when the insert fails', async () => {
    insert.mockResolvedValue({ error: { message: 'boom' } })
    await expect(postUpdate({ projectId: 'p1', authorId: 'u1', body: 'x', files: [png] })).rejects.toMatchObject({ message: 'boom' })
    expect(removeObjects).toHaveBeenCalledWith('attachments', ['p1/uuid-a.png'])
  })

  it('removes files already uploaded when a later upload fails', async () => {
    insert.mockResolvedValue({ error: null })
    vi.mocked(uploadTo)
      .mockResolvedValueOnce({ path: 'p1/one.png', name: 'one.png', size: 1, mime: 'image/png' })
      .mockRejectedValueOnce(new Error('too big'))
    await expect(postUpdate({ projectId: 'p1', authorId: 'u1', body: 'x', files: [png, png] })).rejects.toThrow('too big')
    expect(removeObjects).toHaveBeenCalledWith('attachments', ['p1/one.png'])
    expect(insert).not.toHaveBeenCalled()
  })
})
