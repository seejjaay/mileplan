import { sha256Hex } from './sha256'

describe('sha256Hex', () => {
  it("hashes 'abc' to the standard SHA-256 digest", async () => {
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('hashes an empty blob', async () => {
    expect(await sha256Hex(new Blob([]))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('differs when a single byte differs', async () => {
    expect(await sha256Hex(new Blob(['abc']))).not.toBe(await sha256Hex(new Blob(['abd'])))
  })
})
