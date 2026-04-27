import fs from 'fs/promises'
import path from 'path'
import { Config, EnvSchema, FileConfigSchema } from './schema'
import { log } from '../utils/logger'

const CONFIG_PATH = path.resolve(__dirname, '..', '..', 'data', 'config.json')
const CURRENT_CONFIG_VERSION = 1

export async function loadConfig(): Promise<Config> {
  // Validate environment variables
  const envResult = EnvSchema.safeParse(process.env)
  if (!envResult.success) {
    const issues = envResult.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Missing or invalid environment variables:\n${issues}`)
  }

  // Validate config file
  let raw: unknown
  try {
    const text = await fs.readFile(CONFIG_PATH, 'utf-8')
    raw = JSON.parse(text)
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      throw new Error(
        `Config file not found at ${CONFIG_PATH}.\n` +
          `Make sure the data directory is volume-mounted and config.json exists.\n` +
          `See config.example.json for the expected format.`,
      )
    }
    throw new Error(`Failed to read config at ${CONFIG_PATH}: ${String(err)}`)
  }

  const fileResult = FileConfigSchema.safeParse(raw)
  if (!fileResult.success) {
    const issues = fileResult.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(
      `Invalid config file:\n${issues}\n\nSee config.example.json for the expected format.`,
    )
  }

  if (fileResult.data.version !== CURRENT_CONFIG_VERSION) {
    throw new Error(
      `Config version mismatch: found v${fileResult.data.version}, expected v${CURRENT_CONFIG_VERSION}.\n` +
        `See MIGRATION.md for upgrade instructions.`,
    )
  }

  return { ...fileResult.data, env: envResult.data }
}

export async function writeConfig(config: Config): Promise<void> {
  const { env: _, ...fileConfig } = config
  const tmpPath = `${CONFIG_PATH}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(fileConfig, null, 2), 'utf-8')
  await fs.rename(tmpPath, CONFIG_PATH)
  log(['Config'], 'Saved.')
}
