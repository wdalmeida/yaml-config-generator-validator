import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readPersistedState, writePersistedState } from './persisted-state'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('writePersistedState', () => {
  it('writes under the namespaced key and reads back through readPersistedState', () => {
    expect(writePersistedState('thing', { a: 1 })).toBe(true)

    expect(localStorage.getItem('yaml-config-generator:thing')).toBe('{"a":1}')
    expect(readPersistedState('thing', { a: 0 })).toEqual({ a: 1 })
  })

  it('returns false rather than throwing when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(writePersistedState('thing', { a: 1 })).toBe(false)
  })
})
