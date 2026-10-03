/**
 * @dsh-stats/core — serialized JSONL file store.
 *
 * Appends, rotations, and sweeps are chained through a promise queue so
 * concurrent async batches cannot interleave reads and writes. Retention is
 * bounded two ways, whichever hits first: file size (oldest lines dropped
 * down to 75% of the cap) and sample age (periodic sweep).
 */
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseSampleLine, type Sample } from './schemas.js'

/** After a size rotation, trim to this fraction of the cap so rewrites stay rare. */
export const ROTATE_TARGET_FRACTION = 0.75

export interface RetentionOptions {
  maxFileBytes: number
  maxAgeDays: number
}

export interface StoreStats {
  samples: number
  skippedLines: number
}

async function parseBody(body: string): Promise<{ lines: string[] }> {
  return { lines: body.split('\n').filter((line) => line.trim() !== '') }
}

function ageCutoff(maxAgeDays: number): number | null {
  if (maxAgeDays <= 0) return null
  return Date.now() - maxAgeDays * 86_400_000
}

function keepIfFresh(lines: string[], cutoff: number | null): string[] {
  if (cutoff === null) return lines
  return lines.filter((line) => {
    const sample = parseSampleLine(line)
    // Unparseable lines are kept: the store never destroys foreign content.
    if (sample === null) return true
    return sample.time >= cutoff
  })
}

export interface FileStore {
  enqueue<T>(operation: () => Promise<T>): Promise<T>
  initialize(options: RetentionOptions): Promise<void>
  append(sample: Sample, options: RetentionOptions): Promise<void>
  sweep(options: RetentionOptions): Promise<void>
  readAll(): Promise<string>
  readParsed(): Promise<{ samples: Sample[]; skippedLines: number }>
  fileSize(): Promise<number>
}

export function createFileStore(file: string): FileStore {
  let tail: Promise<unknown> = Promise.resolve()
  let currentBytes = 0

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = tail.then(operation, operation)
    tail = next.catch(() => undefined)
    return next
  }

  /** Rewrite the file keeping only `lines`, atomically, refreshing the counter. */
  const rewrite = async (lines: string[]): Promise<void> => {
    const body = lines.length > 0 ? `${lines.join('\n')}\n` : ''
    const temp = `${file}.tmp`
    await writeFile(temp, body, 'utf8')
    await rename(temp, file)
    currentBytes = Buffer.byteLength(body)
  }

  /** Load the file (if any) and drop samples older than the age cap. */
  const initialize = async (options: RetentionOptions): Promise<void> => {
    let body = ''
    try {
      body = await readFile(file, 'utf8')
    } catch {
      currentBytes = 0
      return
    }
    const { lines } = await parseBody(body)
    const kept = keepIfFresh(lines, ageCutoff(options.maxAgeDays))
    if (kept.length === lines.length) {
      currentBytes = Buffer.byteLength(body)
      return
    }
    await rewrite(kept)
  }

  /** Append one sample, rotating first when the size cap demands it. */
  const append = async (sample: Sample, options: RetentionOptions): Promise<void> => {
    const line = `${JSON.stringify(sample)}\n`
    const lineBytes = Buffer.byteLength(line)
    if (options.maxFileBytes > 0 && currentBytes + lineBytes > options.maxFileBytes) {
      const body = await readFile(file, 'utf8').catch(() => '')
      const { lines } = await parseBody(body)
      const target = Math.max(0, Math.floor(options.maxFileBytes * ROTATE_TARGET_FRACTION))
      const kept: string[] = []
      let keptBytes = 0
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const candidate = lines[index]
        if (candidate === undefined) continue
        const size = Buffer.byteLength(candidate) + 1
        if (keptBytes + size > target) break
        kept.unshift(candidate)
        keptBytes += size
      }
      await rewrite([...kept, line.trimEnd()])
      return
    }
    try {
      await appendFile(file, line, 'utf8')
    } catch (error) {
      // The data directory may have been removed at runtime; recreate once and retry.
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
      await mkdir(dirname(file), { recursive: true })
      await appendFile(file, line, 'utf8')
    }
    currentBytes += lineBytes
  }

  /** Sweep samples older than the age cap, then enforce the size cap. */
  const sweep = async (options: RetentionOptions): Promise<void> => {
    let body = ''
    try {
      body = await readFile(file, 'utf8')
    } catch {
      return
    }
    const { lines } = await parseBody(body)
    const before = lines.length
    let kept = keepIfFresh(lines, ageCutoff(options.maxAgeDays))
    if (options.maxFileBytes > 0) {
      let total = kept.reduce((acc, line) => acc + Buffer.byteLength(line) + 1, 0)
      const target = Math.floor(options.maxFileBytes * ROTATE_TARGET_FRACTION)
      while (total > target && kept.length > 0) {
        const dropped = kept.shift()
        if (dropped !== undefined) total -= Buffer.byteLength(dropped) + 1
      }
    }
    const expectedBytes = kept.reduce((acc, line) => acc + Buffer.byteLength(line) + 1, 0)
    if (kept.length !== before || Buffer.byteLength(body) !== expectedBytes) {
      await rewrite(kept)
    }
  }

  const readAll = async (): Promise<string> => readFile(file, 'utf8').catch(() => '')

  const readParsed = async (): Promise<{ samples: Sample[]; skippedLines: number }> => {
    const body = await readAll()
    const { lines } = await parseBody(body)
    const samples: Sample[] = []
    let skippedLines = 0
    for (const line of lines) {
      const sample = parseSampleLine(line)
      if (sample === null) skippedLines += 1
      else samples.push(sample)
    }
    return { samples, skippedLines }
  }

  const fileSize = async (): Promise<number> => {
    try {
      return (await stat(file)).size
    } catch {
      return 0
    }
  }

  return { enqueue, initialize, append, sweep, readAll, readParsed, fileSize }
}
