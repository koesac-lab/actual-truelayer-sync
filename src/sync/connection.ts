import { refreshToken } from '../truelayer/truelayer'
import { syncAccount } from './account'
import { fetchAccountMap } from './accounts'
import { currentDate } from '../utils/date'
import { log, logError } from '../utils/logger'
import type { Account, Connection, Config } from '../config/schema'
import type { TrueLayerAccount, TrueLayerCard } from '../truelayer/types'

export async function syncConnection(
  connection: Connection,
  config: Config,
  dryRun = false,
): Promise<Connection | undefined> {
  const startedAt = Date.now()
  const prefix = [connection.name]
  log(prefix, 'Starting sync, authenticating with TrueLayer...')

  let accessToken: string
  let newRefreshToken: string
  try {
    const { access_token, refresh_token } = await refreshToken(
      config.env.TRUELAYER_CLIENT_ID,
      config.env.TRUELAYER_CLIENT_SECRET,
      connection.refreshToken,
    )
    accessToken = access_token
    newRefreshToken = refresh_token
  } catch (err) {
    logError(prefix, 'Authentication failed:', err)
    return undefined
  }

  const tokenChanged = newRefreshToken !== connection.refreshToken
  log(prefix, `└ Refresh token ${tokenChanged ? 'CHANGED' : 'unchanged'}.`)

  let trueLayerAccountsById: Map<string, TrueLayerAccount | TrueLayerCard>
  try {
    trueLayerAccountsById = await fetchAccountMap(connection, accessToken)
  } catch (err) {
    logError(prefix, 'Sync failed:', err)
    return { ...connection, refreshToken: newRefreshToken }
  }

  const updatedAccounts: Account[] = []
  for (const configAccount of connection.accounts) {
    const hadTransactions = await syncAccount({
      configAccount,
      connection,
      accessToken,
      trueLayerAccountsById,
      includeCategoryInNotes: config.includeCategoryInNotes,
      lookbackDays: config.lookbackDays,
      dryRun,
    })
    updatedAccounts.push(hadTransactions ? { ...configAccount, lastSyncDate: currentDate() } : configAccount)
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  log(prefix, `Done in ${elapsed}s.`)

  return { ...connection, refreshToken: newRefreshToken, accounts: updatedAccounts }
}
