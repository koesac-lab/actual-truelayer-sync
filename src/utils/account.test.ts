import { describe, it, expect } from 'vitest'
import { resolveIsCard } from './account'
import { Account, Connection } from '../config/schema'

const baseAccount: Account = {
  trueLayerId: 'tl-1',
  actualId: 'a-1',
  friendlyName: 'My Account',
}

const baseConnection: Connection = {
  name: 'My Bank',
  accounts: [],
}

describe('resolveIsCard', () => {
  it('returns false when neither account nor connection specifies isCard', () => {
    expect(resolveIsCard(baseAccount, baseConnection)).toBe(false)
  })

  it('returns true when connection has isCard: true', () => {
    expect(resolveIsCard(baseAccount, { ...baseConnection, isCard: true })).toBe(true)
  })

  it('account-level isCard: true overrides connection-level false', () => {
    expect(resolveIsCard({ ...baseAccount, isCard: true }, { ...baseConnection, isCard: false })).toBe(true)
  })

  it('account-level isCard: false overrides connection-level true', () => {
    expect(resolveIsCard({ ...baseAccount, isCard: false }, { ...baseConnection, isCard: true })).toBe(false)
  })

  it('account-level isCard takes precedence when connection has no isCard', () => {
    expect(resolveIsCard({ ...baseAccount, isCard: true }, baseConnection)).toBe(true)
  })
})
