import { z } from 'zod'
import cron from 'node-cron'

export const AccountSchema = z.object({
  trueLayerId: z.string().min(1),
  actualId: z.string().min(1),
  friendlyName: z.string().min(1),
  isCard: z.boolean().optional(),
  flip: z.boolean().optional(),
  lastSyncDate: z.string().date().optional(),
})

export const ConnectionSchema = z.object({
  name: z.string().min(1),
  refreshToken: z.string().min(1),
  isCard: z.boolean().optional(),
  accounts: z.array(AccountSchema),
})

export const FileConfigSchema = z.object({
    version: z.number().int(),
  includeCategoryInNotes: z.boolean().default(false),
  lookbackDays: z.number().int().positive().default(14),
  connections: z.array(ConnectionSchema).min(1),
})

export const EnvSchema = z.object({
  TRUELAYER_CLIENT_ID: z.string().min(1),
  TRUELAYER_CLIENT_SECRET: z.string().min(1),
  ACTUAL_SERVER_URL: z.string().url(),
  ACTUAL_SERVER_PASSWORD: z.string().min(1),
  ACTUAL_SYNC_ID: z.string().uuid(),
  CRON_SCHEDULE: z
    .string()
    .optional()
    .refine((val) => val === undefined || cron.validate(val), { message: 'Invalid cron expression' }),
  DEBUG: z.string().optional(),
  TZ: z.string().optional(),
  LOG_FORMAT: z.enum(['text', 'json']).default('json'),
})

export type Account = z.infer<typeof AccountSchema>
export type Connection = z.infer<typeof ConnectionSchema>
export type FileConfig = z.infer<typeof FileConfigSchema>
export type Config = z.infer<typeof FileConfigSchema> & {
  env: z.infer<typeof EnvSchema>
}
