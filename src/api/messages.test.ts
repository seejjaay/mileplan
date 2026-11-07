import { editMessage, listMessages, markRead, sendMessage, unreadCounts, type MessageRow } from './messages'
import { removeObjects, uploadTo } from './storage'

const calls: [string, unknown[]][] = []
let result: { data?: unknown; error?: unknown } = {}

function builder() {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'order', 'limit', 'or', 'insert', 'update']) {
    b[m] = (...args: unknown[]) => {
      calls.push([m, args])
      return b
    }
  }
  b.single = () => {
    calls.push(['single', []])
    return Promise.resolve(result)
  }
  b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject)
  return b
}

const rpc = vi.fn()
vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      calls.push(['from', [table]])
      return builder()
    },
    rpc: (...args: unknown[]) => rpc(...args),
  },
}))
vi.mock('./storage', () => ({ uploadTo: vi.fn(), removeObjects: vi.fn() }))

const call = (name: string) => calls.find(([n]) => n === name)?.[1]
const row: MessageRow = {
  id: 'm1',
  created_at: '2026-11-08T10:00:00+00:00',
  project_id: 'p1',
  sender_id: 'u1',
  body: 'Hello',
  attachments: [],
  edited_at: null,
}
const png = new File(['x'], 'a.png', { type: 'image/png' })

beforeEach(() => {
  calls.length = 0
  result = { data: [row], error: null }
  vi.mocked(uploadTo).mockResolvedValue({ path: 'p1/uuid-a.png', name: 'a.png', size: 1, mime: 'image/png' })
})
afterEach(() => vi.clearAllMocks())

describe('listMessages', () => {
  it('orders created_at desc, id desc and limits 50', async () => {
    expect(await listMessages('p1')).toEqual([row])
    expect(call('from')).toEqual(['messages'])
    expect(call('eq')).toEqual(['project_id', 'p1'])
    expect(calls.filter(([n]) => n === 'order').map(([, a]) => a)).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ])
    expect(call('limit')).toEqual([50])
    expect(call('or')).toBeUndefined()
  })

  it('filters by a quoted keyset cursor', async () => {
    const created_at = '2026-11-08T10:00:00.123456+00:00'
    await listMessages('p1', { created_at, id: 'm9' })
    expect(call('or')).toEqual([`created_at.lt."${created_at}",and(created_at.eq."${created_at}",id.lt.m9)`])
  })

  it('throws the supabase error', async () => {
    result = { data: null, error: { message: 'boom' } }
    await expect(listMessages('p1')).rejects.toMatchObject({ message: 'boom' })
  })
})

describe('sendMessage', () => {
  beforeEach(() => {
    result = { data: row, error: null }
  })

  it('trims the body, uploads each file, inserts with sender_id and returns the row', async () => {
    const out = await sendMessage({ projectId: 'p1', senderId: 'u1', body: ' Hello ', files: [png] })
    expect(uploadTo).toHaveBeenCalledWith('attachments', 'p1', png)
    expect(call('insert')).toEqual([
      {
        project_id: 'p1',
        sender_id: 'u1',
        body: 'Hello',
        attachments: [{ path: 'p1/uuid-a.png', name: 'a.png', size: 1, mime: 'image/png' }],
      },
    ])
    expect(out).toBe(row)
  })

  it('cuts a stored name to 200 characters and leaves the rest alone', async () => {
    const long = `${'a'.repeat(250)}.png`
    vi.mocked(uploadTo).mockResolvedValue({ path: 'p1/uuid-x.png', name: long, size: 1, mime: 'image/png' })
    await sendMessage({ projectId: 'p1', senderId: 'u1', body: 'x', files: [png] })
    const [{ attachments }] = call('insert') as [{ attachments: { path: string; name: string }[] }]
    expect(attachments[0].name).toBe(long.slice(0, 200))
    expect(attachments[0].name).toHaveLength(200)
    expect(attachments[0].path).toBe('p1/uuid-x.png')
  })

  it('removes the uploaded files and rethrows when the insert fails', async () => {
    result = { data: null, error: { message: 'boom' } }
    await expect(sendMessage({ projectId: 'p1', senderId: 'u1', body: 'x', files: [png] })).rejects.toMatchObject({ message: 'boom' })
    expect(removeObjects).toHaveBeenCalledWith('attachments', ['p1/uuid-a.png'])
  })

  it('removes files already uploaded when a later upload fails', async () => {
    vi.mocked(uploadTo)
      .mockResolvedValueOnce({ path: 'p1/one.png', name: 'one.png', size: 1, mime: 'image/png' })
      .mockRejectedValueOnce(new Error('too big'))
    await expect(sendMessage({ projectId: 'p1', senderId: 'u1', body: 'x', files: [png, png] })).rejects.toThrow('too big')
    expect(removeObjects).toHaveBeenCalledWith('attachments', ['p1/one.png'])
    expect(call('insert')).toBeUndefined()
  })
})

describe('editMessage', () => {
  it('updates only the body and returns the row', async () => {
    result = { data: { ...row, body: 'New' }, error: null }
    const out = await editMessage('m1', 'New')
    expect(call('update')).toEqual([{ body: 'New' }])
    expect(call('eq')).toEqual(['id', 'm1'])
    expect(call('single')).toEqual([])
    expect(out.body).toBe('New')
  })

  it('throws the PGRST116 error an RLS-refused edit produces', async () => {
    result = { data: null, error: { code: 'PGRST116', message: '0 rows' } }
    await expect(editMessage('m1', 'x')).rejects.toMatchObject({ code: 'PGRST116' })
  })
})

describe('markRead and unreadCounts', () => {
  it('calls mark_messages_read with the project id', async () => {
    rpc.mockResolvedValue({ error: null })
    await markRead('p1')
    expect(rpc).toHaveBeenCalledWith('mark_messages_read', { p_project_id: 'p1' })
  })

  it('throws when marking read fails', async () => {
    rpc.mockResolvedValue({ error: { message: 'nope' } })
    await expect(markRead('p1')).rejects.toMatchObject({ message: 'nope' })
  })

  it('maps rows to a project_id to unread record', async () => {
    rpc.mockResolvedValue({ data: [{ project_id: 'a', unread: 3 }, { project_id: 'b', unread: 1 }], error: null })
    expect(await unreadCounts()).toEqual({ a: 3, b: 1 })
    expect(rpc).toHaveBeenCalledWith('unread_message_counts')
  })
})
