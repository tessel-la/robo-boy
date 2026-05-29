import { describe, it, expect } from 'vitest'
import { generateUniqueId } from './helpers'

describe('generateUniqueId', () => {
  it('should generate a unique ID with default prefix', () => {
    const id = generateUniqueId()
    expect(id).toMatch(/^id-[a-z0-9]+-\d+$/)
  })

  it('should generate a unique ID with custom prefix', () => {
    const id = generateUniqueId('custom')
    expect(id).toMatch(/^custom-[a-z0-9]+-\d+$/)
  })

  it('should generate different IDs on each call', () => {
    const id1 = generateUniqueId()
    const id2 = generateUniqueId()
    expect(id1).not.toBe(id2)
  })
})

