import type { State, ConnectionState } from './schema'

export function getConnectionState(state: State, connectionName: string): ConnectionState | undefined {
  return state.connections[connectionName]
}

export function getAccountLastSyncDate(state: State, connectionName: string, trueLayerId: string): string | undefined {
  return state.connections[connectionName]?.accounts[trueLayerId]?.lastSyncDate
}
