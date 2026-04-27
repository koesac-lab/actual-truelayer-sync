import { describe, it, expect } from 'vitest'
import { AccountSchema, ConnectionSchema, EnvSchema, FileConfigSchema } from './schema'

describe('AccountSchema', () => {
  const validAccount = {
    trueLayerId: 'tl-acc-1',
    actualId: 'actual-acc-1',
    friendlyName: 'My Account',
  }

  it('accepts a minimal valid account', () => {
    expect(AccountSchema.safeParse(validAccount).success).toBe(true)
  })

  it('accepts optional isCard, flip, and lastSyncDate', () => {
    const result = AccountSchema.safeParse({
      ...validAccount,
      isCard: true,
      flip: false,
      lastSyncDate: '2026-04-24',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing trueLayerId', () => {
    const { trueLayerId: _, ...rest } = validAccount
    expect(AccountSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects empty trueLayerId', () => {
    expect(AccountSchema.safeParse({ ...validAccount, trueLayerId: '' }).success).toBe(false)
  })

  it('rejects missing actualId', () => {
    const { actualId: _, ...rest } = validAccount
    expect(AccountSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects missing friendlyName', () => {
    const { friendlyName: _, ...rest } = validAccount
    expect(AccountSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects an invalid lastSyncDate format', () => {
    expect(AccountSchema.safeParse({ ...validAccount, lastSyncDate: '24-04-2026' }).success).toBe(false)
  })

  it('rejects a non-boolean flip', () => {
    expect(AccountSchema.safeParse({ ...validAccount, flip: 'yes' }).success).toBe(false)
  })
})

describe('ConnectionSchema', () => {
  const validConnection = {
    name: 'My Bank',
    refreshToken: 'token-abc',
    accounts: [],
  }

  it('accepts a valid connection with empty accounts', () => {
    expect(ConnectionSchema.safeParse(validConnection).success).toBe(true)
  })

  it('accepts isCard at connection level', () => {
    expect(ConnectionSchema.safeParse({ ...validConnection, isCard: true }).success).toBe(true)
  })

  it('accepts a connection with accounts', () => {
    const result = ConnectionSchema.safeParse({
      ...validConnection,
      accounts: [{ trueLayerId: 'tl-1', actualId: 'a-1', friendlyName: 'Acc' }],
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing name', () => {
    const { name: _, ...rest } = validConnection
    expect(ConnectionSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects missing refreshToken', () => {
    const { refreshToken: _, ...rest } = validConnection
    expect(ConnectionSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects empty refreshToken', () => {
    expect(ConnectionSchema.safeParse({ ...validConnection, refreshToken: '' }).success).toBe(false)
  })
})

describe('FileConfigSchema', () => {
  const validFileConfig = {
    version: 1,
    connections: [{ name: 'My Bank', refreshToken: 'token', accounts: [] }],
  }

  it('accepts a valid file config', () => {
    expect(FileConfigSchema.safeParse(validFileConfig).success).toBe(true)
  })

  it('defaults includeCategoryInNotes to false', () => {
    const result = FileConfigSchema.safeParse(validFileConfig)
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.includeCategoryInNotes).toBe(false)
  })

  it('accepts includeCategoryInNotes: true', () => {
    const result = FileConfigSchema.safeParse({ ...validFileConfig, includeCategoryInNotes: true })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.includeCategoryInNotes).toBe(true)
  })

  it('rejects empty connections array', () => {
    expect(FileConfigSchema.safeParse({ connections: [] }).success).toBe(false)
  })

  it('rejects missing connections', () => {
    expect(FileConfigSchema.safeParse({}).success).toBe(false)
  })
})

describe('EnvSchema', () => {
  const validEnv = {
    TRUELAYER_CLIENT_ID: 'client-id',
    TRUELAYER_CLIENT_SECRET: 'client-secret',
    ACTUAL_SERVER_URL: 'http://localhost:5006',
    ACTUAL_SERVER_PASSWORD: 'password',
    ACTUAL_SYNC_ID: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  }

  it('accepts valid minimal env', () => {
    expect(EnvSchema.safeParse(validEnv).success).toBe(true)
  })

  it('accepts optional CRON_SCHEDULE, DEBUG, and TZ', () => {
    const result = EnvSchema.safeParse({
      ...validEnv,
      CRON_SCHEDULE: '0 */4 * * *',
      DEBUG: 'true',
      TZ: 'Europe/London',
    })
    expect(result.success).toBe(true)
  })

  it('rejects an invalid ACTUAL_SERVER_URL', () => {
    expect(EnvSchema.safeParse({ ...validEnv, ACTUAL_SERVER_URL: 'not-a-url' }).success).toBe(false)
  })

  it('rejects an invalid ACTUAL_SYNC_ID', () => {
    expect(EnvSchema.safeParse({ ...validEnv, ACTUAL_SYNC_ID: 'not-a-uuid' }).success).toBe(false)
  })

  it('rejects an invalid CRON_SCHEDULE', () => {
    expect(EnvSchema.safeParse({ ...validEnv, CRON_SCHEDULE: 'not-a-cron' }).success).toBe(false)
  })

  it('rejects missing TRUELAYER_CLIENT_ID', () => {
    const { TRUELAYER_CLIENT_ID: _, ...rest } = validEnv
    expect(EnvSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects missing TRUELAYER_CLIENT_SECRET', () => {
    const { TRUELAYER_CLIENT_SECRET: _, ...rest } = validEnv
    expect(EnvSchema.safeParse(rest).success).toBe(false)
  })

  it('rejects missing ACTUAL_SERVER_PASSWORD', () => {
    const { ACTUAL_SERVER_PASSWORD: _, ...rest } = validEnv
    expect(EnvSchema.safeParse(rest).success).toBe(false)
  })
})
