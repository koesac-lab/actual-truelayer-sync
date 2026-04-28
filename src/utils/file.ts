import fs from 'fs/promises'

export async function readJSON<T extends any>(file: string): Promise<T> {
  let rawFile: string
  try {
    rawFile = await fs.readFile(file, 'utf-8')
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      throw new Error(`File not found at ${file}.\nMake sure the directory is volume-mounted and the file exists.`)
    }
    throw new Error(`Failed to read file at ${file}: ${String(err)}`)
  }

  try {
    return JSON.parse(rawFile) as T
  } catch (err) {
    throw new Error(`Failed to parse JSON in file at ${file}: ${String(err)}`)
  }
}

export async function writeJSON<T extends any>(file: string, data: T) {
  const tmpPath = `${file}.tmp`
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  await fs.rename(tmpPath, file)
}
