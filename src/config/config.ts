import fs from 'fs/promises'
import path from 'path'
import { log, logError } from '../utils/logger'
import { Config, EnvSchema, FileConfigSchema, StateSchema } from './schema'

const CONFIG_PATH = path.resolve(__dirname, '..', '..', 'data', 'config.json')
const STATE_PATH = path.resolve(__dirname, '..', '..', 'data', 'state.json')
const CURRENT_CONFIG_VERSION = 2

export async function loadConfig(): Promise<Config> {
  // Validate environment variables
  const envResult = EnvSchema.safeParse(process.env)
  if (!envResult.success) {
    const issues = envResult.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Missing or invalid environment variables:\n${issues}`)
  }

  // TODO: Generic readJson helper
  // Load and validate config file
  let rawConfig: unknown
  try {
    rawConfig = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'))
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

  const fileResult = FileConfigSchema.safeParse(rawConfig)
  if (!fileResult.success) {
    const issues = fileResult.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid config file:\n${issues}\n\nSee config.example.json for the expected format.`)
  }

  if (fileResult.data.version !== CURRENT_CONFIG_VERSION) {
    throw new Error(
      `Config version mismatch: found v${fileResult.data.version}, expected v${CURRENT_CONFIG_VERSION}.\n` +
        `See MIGRATION.md for upgrade instructions.`,
    )
  }

  // Load and validate state file
  let rawState: unknown
  try {
    rawState = JSON.parse(await fs.readFile(STATE_PATH, 'utf-8'))
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      throw new Error(
        `State file not found at ${STATE_PATH}.\n` +
          `Create state.json with your TrueLayer refresh tokens.\n` +
          `See state.example.json for the expected format.`,
      )
    }
    throw new Error(`Failed to read state at ${STATE_PATH}: ${String(err)}`)
  }

  const stateResult = StateSchema.safeParse(rawState)
  if (!stateResult.success) {
    const issues = stateResult.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Invalid state file:\n${issues}\n\nSee state.example.json for the expected format.`)
  }

  // Warn about connections with no state entry
  for (const connection of fileResult.data.connections) {
    if (!stateResult.data.connections[connection.name]) {
      logError(['Config'], `No state entry for connection "${connection.name}" — it will be skipped during sync.`)
    }
  }

  return { ...fileResult.data, env: envResult.data, state: stateResult.data }
}

// TODO: Generic writeJson helper
export async function writeState(config: Config): Promise<void> {
  const tmpPath = `${STATE_PATH}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(config.state, null, 2), 'utf-8')
  await fs.rename(tmpPath, STATE_PATH)
  log(['Config'], 'State saved.')
}
