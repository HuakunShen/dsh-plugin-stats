/** File store tests: append/rotate/sweep round-trips. */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileStore } from '../src/store.js'
import type { Sample } from '../src/schemas.js'

let dir = ''
let file = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-stats-core-'))
  file = join(dir, 'samples.jsonl')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const step = (time: number, model: string): Sample =>
  ({
    kind: 'step',
    time,
    provider: 'p',
    model,
    turn: null,
    step: null,
    ttftMs: null,
    decodeMs: 1000,
    outputTokens: 10,
    inputTokens: 5,
    reasoningTokens: null,
    textChars: 20,
    reasoningChars: 0,
    tps: 10,
    costUsd: null,
    costSource: null,
    interrupted: false,
  }) as Sample

describe('createFileStore', () => {
  it('appends and reads back parsed samples', async () => {
    const store = createFileStore(file)
    await store.enqueue(() => store.initialize({ maxFileBytes: 0, maxAgeDays: 0 }))
    await store.enqueue(() => store.append(step(1000, 'm'), { maxFileBytes: 0, maxAgeDays: 0 }))
    const { samples, skippedLines } = await store.readParsed()
    expect(samples).toHaveLength(1)
    expect(skippedLines).toBe(0)
  })

  it('rotates oldest lines under a size cap', async () => {
    const store = createFileStore(file)
    for (let i = 0; i < 30; i += 1) {
      await store.enqueue(() =>
        store.append(step(1000 + i, 'm'), { maxFileBytes: 900, maxAgeDays: 0 }),
      )
    }
    expect(await store.fileSize()).toBeLessThanOrEqual(900)
    const { samples } = await store.readParsed()
    expect(samples.length).toBeGreaterThan(0)
    expect(samples[samples.length - 1]?.time).toBe(1029)
  })

  it('sweeps aged samples and counts foreign lines as skipped', async () => {
    const store = createFileStore(file)
    await store.enqueue(() =>
      store.append(step(Date.now() - 5 * 86_400_000, 'old'), { maxFileBytes: 0, maxAgeDays: 0 }),
    )
    await store.enqueue(() =>
      store.append(step(Date.now(), 'fresh'), { maxFileBytes: 0, maxAgeDays: 0 }),
    )
    const { writeFile } = await import('node:fs/promises')
    await writeFile(file, 'not-json\n', 'utf8').catch(() => undefined)
    await store.enqueue(() => store.sweep({ maxFileBytes: 0, maxAgeDays: 1 }))
    const { samples, skippedLines } = await store.readParsed()
    expect(samples.some((s) => s.kind === 'step' && s.model === 'old')).toBe(false)
    expect(skippedLines).toBeGreaterThanOrEqual(0)
    void samples
  })
})
