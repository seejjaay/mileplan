import { objectPath } from './storage'

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
