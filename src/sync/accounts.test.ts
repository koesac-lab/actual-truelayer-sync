import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'
import type { Connection } from '../config/schema'
import * as truelayer from '../truelayer/truelayer'
import type { TrueLayerAccount, TrueLayerCard } from '../truelayer/types'
import { fetchAccountMap } from './accounts'

vi.mock('axios')
vi.mock('../truelayer/truelayer')
vi.mock('../utils/logger')

const baseConnection: Connection = {
  name: 'My Bank',
  accounts: [{ trueLayerId: 'acc-1', actualId: 'a-1', friendlyName: 'Current Account' }],
}

const mockAccount: TrueLayerAccount = {
  account_id: 'acc-1',
  account_type: 'TRANSACTION',
  currency: 'GBP',
  display_name: 'Current Account',
  update_timestamp: '2026-04-24T00:00:00Z',
  account_number: {},
  provider: { provider_id: 'first-direct' },
}

const mockCard: TrueLayerCard = {
  account_id: 'card-1',
  card_network: 'VISA',
  card_type: 'CREDIT',
  currency: 'GBP',
  display_name: 'Credit Card',
  partial_card_number: '1234',
  name_on_card: 'Chris Sheppard',
  update_timestamp: '2026-04-24T00:00:00Z',
  provider: { provider_id: 'ms' },
}

describe('fetchAccountMap', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns a map of accounts by id', async () => {
    vi.mocked(truelayer.listAccounts).mockResolvedValueOnce([mockAccount])
    const result = await fetchAccountMap(baseConnection, 'token')
    expect(result.get('acc-1')).toEqual(mockAccount)
  })

  it('calls listCards when connection isCard is true', async () => {
    vi.mocked(truelayer.listCards).mockResolvedValueOnce([mockCard])
    await fetchAccountMap({ ...baseConnection, isCard: true }, 'token')
    expect(truelayer.listCards).toHaveBeenCalledWith('token')
    expect(truelayer.listAccounts).not.toHaveBeenCalled()
  })

  it('calls listAccounts when connection isCard is false', async () => {
    vi.mocked(truelayer.listAccounts).mockResolvedValueOnce([mockAccount])
    await fetchAccountMap(baseConnection, 'token')
    expect(truelayer.listAccounts).toHaveBeenCalledWith('token')
    expect(truelayer.listCards).not.toHaveBeenCalled()
  })

  it('returns empty map when endpoint_not_supported', async () => {
    const axiosError = Object.assign(new Error('Not supported'), {
      isAxiosError: true,
      response: { data: { error: 'endpoint_not_supported' } },
    })
    vi.mocked(truelayer.listAccounts).mockRejectedValueOnce(axiosError)
    vi.mocked(axios.isAxiosError).mockReturnValueOnce(true)
    const result = await fetchAccountMap(baseConnection, 'token')
    expect(result.size).toBe(0)
  })

  it('rethrows non-endpoint_not_supported errors', async () => {
    const axiosError = Object.assign(new Error('Server error'), {
      isAxiosError: true,
      response: { data: { error: 'internal_server_error' } },
    })
    vi.mocked(truelayer.listAccounts).mockRejectedValueOnce(axiosError)
    vi.mocked(axios.isAxiosError).mockReturnValueOnce(true)
    await expect(fetchAccountMap(baseConnection, 'token')).rejects.toThrow('Server error')
  })

  it('includes unmatched accounts (not in config) in the map', async () => {
    const unmatchedAccount: TrueLayerAccount = { ...mockAccount, account_id: 'acc-unmatched', display_name: 'Savings' }
    vi.mocked(truelayer.listAccounts).mockResolvedValueOnce([mockAccount, unmatchedAccount])
    const result = await fetchAccountMap(baseConnection, 'token')
    expect(result.size).toBe(2)
    expect(result.get('acc-unmatched')).toEqual(unmatchedAccount)
  })
})
