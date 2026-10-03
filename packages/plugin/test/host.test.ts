/**
 * Host behavior test: fake Host context driving `apply()` end to end.
 * Ports the tokspeed 14-assertion contract, plus cost/tool/session coverage.
 */
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { apply, ROUTE_CONFIG, ROUTE_CSV, ROUTE_SAMPLES, ROUTE_SUMMARY } from '../src/host.js'
import type { DshPluginContext, DshResponse, DshSession } from '../src/harness.js'

interface FakeRoute {
  handler: (req: FakeRequest, res: DshResponse) => void | Promise<void>
}

interface FakeRequest extends AsyncIterable<string> {
  method?: string
  body?: string
  [Symbol.asyncIterator](): AsyncIterator<string>
}

const fakeReq = (method: string, body?: string): FakeRequest => ({
  method,
  body,
  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    if (body !== undefined) yield body
  },
})

const fakeRes = (): DshResponse & { code: number; body: string } => {
  const res = {
    code: 0,
    headers: {} as Record<string, string>,
    body: '',
    writeHead(code: number, headers: Record<string, string>): void {
      res.code = code
      res.headers = headers
    },
    end(body: string): void {
      res.body = body
    },
  }
  return res
}

interface Fixture {
  ctx: DshPluginContext
  emitSessionEvent: (session: DshSession, event: unknown) => void
  emitDisposed: (session: DshSession) => void
  emitCreated: (session: DshSession) => void
  emitToolResult: (exec: unknown, result: unknown) => void
  call: (path: string, method?: string, body?: string) => Promise<{ code: number; body: string }>
  errors: string[]
  warnings: string[]
  dir: string
}

async function makeFixture(overrides: Record<string, unknown> = {}): Promise<Fixture> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-stats-host-'))
  const listeners = new Map<string, ((...args: never[]) => void)[]>()
  const routes = new Map<string, FakeRoute>()
  type EffectFn = () => unknown
  const effects: EffectFn[] = []
  const errors: string[] = []
  const warnings: string[] = []
  const ctx: DshPluginContext = {
    on: (event: string, fn: (...args: never[]) => void): (() => void) => {
      const list = listeners.get(event) ?? []
      list.push(fn)
      listeners.set(event, list)
      return () => undefined
    },
    effect: (fn) => {
      effects.push(fn)
    },
    get: (key: string): unknown => {
      if (key !== 'webServer') return undefined
      return {
        register: (route: { kind: 'exact'; path: string; handler: FakeRoute['handler'] }): (() => void) => {
          routes.set(route.path, { handler: route.handler })
          return () => {
            routes.delete(route.path)
          }
        },
      }
    },
    logger: {
      warn: (message: string) => {
        warnings.push(message)
      },
      error: (message: string, error?: unknown) => {
        errors.push(`${message}: ${String((error as Error)?.message ?? error)}`)
      },
    },
  }
  apply(ctx, { dataDir: dir, ...overrides })
  for (const effect of effects) {
    await effect()
  }
  // Let the async init effect settle.
  await new Promise((resolve) => setTimeout(resolve, 50))
  const fire = (event: string, ...args: never[]): void => {
    for (const fn of listeners.get(event) ?? []) fn(...args)
  }
  return {
    ctx,
    emitSessionEvent: (session, event) => {
      fire('session/event', session as never, event as never)
    },
    emitDisposed: (session) => {
      fire('session/disposed', session as never)
    },
    emitCreated: (session) => {
      fire('session/created', session as never)
    },
    emitToolResult: (exec, result) => {
      fire('tools/result', exec as never, result as never)
    },
    call: async (path, method = 'GET', body?: string) => {
      const route = routes.get(path)
      if (route === undefined) throw new Error(`no route: ${path}`)
      const res = fakeRes()
      await route.handler(fakeReq(method, body), res)
      return { code: res.code, body: res.body }
    },
    errors,
    warnings,
    dir,
  }
}

const assistantEvent = (
  time: number,
  model: string,
  outputTokens: number,
  gapMs = 1000,
): Record<string, unknown> => ({
  type: 'assistant/message',
  time,
  data: {
    turn: 1,
    step: 1,
    stream: [
      { type: 'text-chunks', time0: time, dt: [gapMs], texts: ['a', 'b', 'c'] },
      { type: 'chunk', time: time + gapMs, chunk: { type: 'finish', reason: { kind: 'completed' } } },
    ],
    usage: { inputTokens: 10, outputTokens },
    message: { source: { kind: 'model', provider: 'test-provider', model } },
  },
})

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

let fixtures: Fixture[] = []
beforeEach(() => {
  fixtures = []
})
afterEach(async () => {
  for (const fixture of fixtures) await rm(fixture.dir, { recursive: true, force: true })
})
const track = async (overrides?: Record<string, unknown>): Promise<Fixture> => {
  const fixture = await makeFixture(overrides)
  fixtures.push(fixture)
  return fixture
}

describe('host behavior', () => {
  it('registers all four routes', async () => {
    const f = await track()
    for (const path of [ROUTE_SAMPLES, ROUTE_CSV, ROUTE_SUMMARY, ROUTE_CONFIG]) {
      const res = await f.call(path)
      expect(res.code).toBe(200)
    }
  })

  it('rate-limits step samples by interval', async () => {
    const f = await track({ sampleMinIntervalMs: 100 })
    f.emitSessionEvent({ id: 's1' }, assistantEvent(1_000_000, 'model-a', 50))
    f.emitSessionEvent({ id: 's1' }, assistantEvent(1_000_050, 'model-a', 60))
    f.emitSessionEvent({ id: 's2' }, assistantEvent(1_000_200, 'model-b', 70))
    await sleep(120)
    const body = (await f.call(ROUTE_SAMPLES)).body.trim()
    expect(body.split('\n')).toHaveLength(2)
  })

  it('derives tps math and keeps sessionId', async () => {
    const f = await track()
    f.emitSessionEvent({ id: 's1' }, assistantEvent(1_000_000, 'model-a', 50))
    await sleep(120)
    const lines = (await f.call(ROUTE_SAMPLES)).body.trim().split('\n')
    const first = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>
    expect(first['tps']).toBe(50)
    expect(first['decodeMs']).toBe(1000)
    expect(first['sessionId']).toBe('s1')
  })

  it('records verbosity fields', async () => {
    const f = await track()
    f.emitSessionEvent({ id: 's1' }, {
      type: 'assistant/message',
      time: 1_000_300,
      data: {
        turn: 1,
        step: 2,
        stream: [
          { type: 'reasoning-chunks', time0: 1_000_300, dt: [10], texts: ['thinking…'] },
          { type: 'text-chunks', time0: 1_000_350, dt: [10, 10], texts: ['hello ', 'world'] },
        ],
        usage: { inputTokens: 100, outputTokens: 25, reasoningTokens: 15 },
        message: { source: { kind: 'model', provider: 'test-provider', model: 'model-a' } },
      },
    })
    await sleep(120)
    const lines = (await f.call(ROUTE_SAMPLES)).body.trim().split('\n')
    const last = JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, unknown>
    expect(last['reasoningTokens']).toBe(15)
    expect(last['textChars']).toBe(11)
    expect(last['reasoningChars']).toBe(9)
  })

  it('rotates under a size cap', async () => {
    const f = await track({ maxFileBytes: 900 })
    for (let i = 0; i < 30; i += 1) {
      f.emitSessionEvent({ id: 's1' }, assistantEvent(1_100_000 + i * 500, 'model-a', 40))
    }
    await sleep(400)
    expect((await stat(join(f.dir, 'samples.jsonl'))).size).toBeLessThanOrEqual(900)
  })

  it('serves CSV with header + rows', async () => {
    const f = await track()
    f.emitSessionEvent({ id: 's1' }, assistantEvent(1_000_000, 'model-a', 50))
    await sleep(120)
    const csv = await f.call(ROUTE_CSV)
    expect(csv.body.startsWith('time_iso,kind,model,provider,')).toBe(true)
    expect(csv.body.trim().split('\n').length - 1).toBe(1)
  })

  it('serves summary with models/retention/pricing', async () => {
    const f = await track()
    f.emitSessionEvent({ id: 's1' }, assistantEvent(1_000_000, 'model-a', 50))
    await sleep(120)
    const summary = JSON.parse((await f.call(ROUTE_SUMMARY)).body) as Record<string, unknown>
    expect(summary['samples']).toBe(1)
    expect(summary['measurable']).toBe(1)
    expect((summary['models'] as { model: string }[]).map((m) => m.model)).toContain('model-a')
    expect((summary['pricing'] as { source: string }).source).toBe('models.dev')
  })

  it('sweeps aged samples, keeps fresh ones', async () => {
    const f = await track({ maxAgeDays: 1 })
    const ancientRow = {
      kind: 'step',
      time: Date.now() - 5 * 86_400_000,
      provider: 'p',
      model: 'old',
      turn: null,
      step: null,
      ttftMs: null,
      decodeMs: 1000,
      outputTokens: 10,
      inputTokens: 5,
      reasoningTokens: null,
      textChars: 1,
      reasoningChars: 0,
      tps: 10,
      costUsd: null,
      costSource: null,
      interrupted: false,
    }
    const freshRow = { ...ancientRow, time: Date.now(), model: 'fresh-model' }
    await writeFile(
      join(f.dir, 'samples.jsonl'),
      `${JSON.stringify(ancientRow)}\n${JSON.stringify(freshRow)}\n`,
    )
    // A new apply on the same dir runs initialize, which sweeps aged rows.
    const f2 = await makeFixture({ dataDir: f.dir, maxAgeDays: 1 })
    fixtures.push(f2)
    const swept = (await f2.call(ROUTE_SAMPLES)).body
    expect(swept.includes('"old"')).toBe(false)
    expect(swept.includes('fresh-model')).toBe(true)
  })

  it('omits sessionId when disabled and marks bursts unmeasurable', async () => {
    const f = await track({ includeSessionIds: false })
    f.emitSessionEvent({ id: 'secret' }, {
      type: 'assistant/message',
      time: 5_000_000,
      data: {
        turn: 1,
        step: 1,
        stream: [{ type: 'text-chunks', time0: 5_000_000, dt: [5], texts: ['x'] }],
        usage: { inputTokens: 1, outputTokens: 10 },
        message: { source: { kind: 'model', provider: 'p', model: 'm' } },
      },
    })
    await sleep(120)
    const body = await readFile(join(f.dir, 'samples.jsonl'), 'utf8')
    expect(body.includes('secret')).toBe(false)
    const burst = JSON.parse(body.trim()) as Record<string, unknown>
    expect(burst['tps']).toBeNull()
    expect(burst['unmeasurable']).toBe(true)
  })

  it('marks over-ceiling bursts unmeasurable but keeps timing', async () => {
    const f = await track()
    f.emitSessionEvent({ id: 's' }, {
      type: 'assistant/message',
      time: 6_000_000,
      data: {
        turn: 1,
        step: 2,
        stream: [
          { type: 'text-chunks', time0: 6_000_000, dt: [1000], texts: ['a'] },
          { type: 'chunk', time: 6_001_000 },
        ],
        usage: { inputTokens: 5, outputTokens: 900 },
        message: { source: { kind: 'model', provider: 'p', model: 'm' } },
      },
    })
    await sleep(120)
    const rows = (await f.call(ROUTE_SAMPLES)).body.trim().split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const last = rows[rows.length - 1] ?? {}
    expect(last['tps']).toBeNull()
    expect(last['unmeasurable']).toBe(true)
    expect(last['decodeMs']).toBe(1000)
    expect(last['outputTokens']).toBe(900)
  })

  it('prices steps with a custom override', async () => {
    const f = await track({ customPricing: { 'model-a': 10 } })
    f.emitSessionEvent({ id: 's1' }, assistantEvent(1_000_000, 'model-a', 1_000_000))
    await sleep(120)
    const summary = JSON.parse((await f.call(ROUTE_SUMMARY)).body) as {
      models: { model: string; costUsd: number }[]
    }
    const entry = summary.models.find((m) => m.model === 'model-a')
    expect(entry?.costUsd).toBe(10)
  })

  it('records tool results and session lifecycle', async () => {
    const f = await track()
    f.emitCreated({ id: 'sess-1' })
    f.emitToolResult(
      { tool: 'bash', durationMs: 120 },
      { ok: true },
    )
    f.emitToolResult(
      { tool: 'bash', startedAt: 1000, endedAt: 1300 },
      { error: 'boom' },
    )
    f.emitDisposed({ id: 'sess-1' })
    await sleep(150)
    const summaryRes = await f.call(ROUTE_SUMMARY)
    const summary = JSON.parse(summaryRes.body) as {
      tools: { tool: string; calls: number; ok: number; err: number }[]
      activity: { sessions: number; toolCalls: number }
    }
    expect(summary.tools[0]).toMatchObject({ tool: 'bash', calls: 2, ok: 1, err: 1 })
    expect(summary.activity.toolCalls).toBe(2)
    expect(summary.activity.sessions).toBe(1)
  })

  it('serves config GET/POST with validation and persistence', async () => {
    const f = await track({ maxAgeDays: 1 })
    const getRes = await f.call(ROUTE_CONFIG)
    const get = JSON.parse(getRes.body) as Record<string, unknown>
    expect(get['maxAgeDays']).toBe(1)
    const empty = await f.call(ROUTE_CONFIG, 'POST', undefined)
    expect(empty.code).toBe(200)
    const bad = await f.call(ROUTE_CONFIG, 'POST', 'not json')
    expect(bad.code).toBe(400)
    const patched = await f.call(ROUTE_CONFIG, 'POST', JSON.stringify({ maxAgeDays: 3 }))
    expect(patched.code).toBe(200)
    const persisted = JSON.parse(await readFile(join(f.dir, 'config.json'), 'utf8')) as Record<string, unknown>
    expect(persisted['maxAgeDays']).toBe(3)
    const live = JSON.parse((await f.call(ROUTE_CONFIG)).body) as Record<string, unknown>
    expect(live['maxAgeDays']).toBe(3)
    const dataDirAttempt = await f.call(ROUTE_CONFIG, 'POST', JSON.stringify({ dataDir: '/elsewhere' }))
    expect((JSON.parse(dataDirAttempt.body) as Record<string, unknown>)['dataDir']).toBe(f.dir)
  })
})
