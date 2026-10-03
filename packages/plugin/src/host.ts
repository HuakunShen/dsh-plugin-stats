/**
 * Host half of dsh-plugin-stats.
 *
 * Subscribes to the process-wide `session/event` feed (steps + lifecycle),
 * observes `tools/result` (tool calls), prices every step sample against the
 * bundled models.dev snapshot, and serves read-only data routes plus the
 * live settings route. All registrations ride the plugin fiber.
 *
 * Settings precedence: schema defaults <- entry `config:` block <- user
 * config.json (the panel writes the file). `dataDir` still requires a reload.
 */
import {
  ConfigSchema,
  createFileStore,
  parseSampleLine,
  summarize,
  toCsvRow,
  type Sample,
  type StatsConfig,
} from '@dsh-stats/core'
import { loadSnapshot } from '@dsh-stats/pricing'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { collectSessionEvent, collectTool } from './collectors.js'
import {
  type DshPluginContext,
  type DshRequest,
  type DshResponse,
  type DshSession,
  type DshWebServer,
} from './harness.js'
import { createLoaderConfig } from './loader-config.js'

/** Wait for the webServer service before apply, so routes register regardless of activation order. */
export const inject = ['webServer']

export const ROUTE_SAMPLES = '/dsh-stats/samples.jsonl'
export const ROUTE_CSV = '/dsh-stats/samples.csv'
export const ROUTE_SUMMARY = '/dsh-stats/summary.json'
export const ROUTE_CONFIG = '/dsh-stats/config'

export { ConfigSchema }
export type { StatsConfig }

/**
 * Loader-facing config schema.
 *
 * The Harness Loader resolves entry configs through the schema's own calling
 * convention plus its prototype surface (schemastery schemas are callable
 * functions; standard zod schemas are plain objects with `.parse`). A plain
 * zod schema — or a hand-written wrapper function — fails activation, so the
 * exported `Config` is a genuine `@deepseek-ai/schemastery` schema with a
 * field-for-field mirror of the core zod `ConfigSchema` (defaults,
 * minimums, and the `customPricing` dict included).
 *
 * Everything past the Loader boundary runs through the zod `ConfigSchema`
 * (`apply` re-parses the Loader's output), and `config-schema.test.ts` locks
 * the two definitions together: same defaults, same rejections.
 */
export const Config = createLoaderConfig()

/** Resolve the sample file location: explicit dataDir verbatim, else DSH home. */
export function samplesFile(effective: Pick<StatsConfig, 'dataDir'>): string {
  if (effective.dataDir !== '') return join(effective.dataDir, 'samples.jsonl')
  const base = process.env['DSH_PROFILE_DIR'] || join(homedir(), '.dsh')
  return join(base, 'stats', 'samples.jsonl')
}

/** Load the user's config.json, if any; malformed files fall back to {} with a warning. */
async function readUserConfig(
  path: string,
  logger: DshPluginContext['logger'],
): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      logger.warn(`stats: config.json unreadable (${String((error as Error)?.message ?? error)}); using defaults`)
    }
    return {}
  }
}

function json(res: DshResponse, code: number, payload: string, type = 'application/json'): void {
  res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' })
  res.end(payload)
}

function notAllowed(res: DshResponse): void {
  res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('method not allowed')
}

async function readBody(req: DshRequest): Promise<string> {
  let chunks = ''
  const decoder = new TextDecoder()
  for await (const chunk of req) {
    chunks += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
  }
  chunks += decoder.decode()
  return chunks
}

/**
 * Bundle entry: start the collectors, retention, the read-only data routes,
 * the settings route, and the index injection.
 */
export function apply(ctx: DshPluginContext, entryConfig: unknown): void {
  // Precedence: schema defaults <- deployment entry config <- user config.json.
  // The Loader already applied the schemastery Config; re-parse through zod
  // so the interior always runs on the canonical StatsConfig type.
  const effective = ConfigSchema.parse(entryConfig ?? {})
  const dataDir =
    effective.dataDir !== ''
      ? effective.dataDir
      : join(process.env['DSH_PROFILE_DIR'] || join(homedir(), '.dsh'), 'stats')
  const file = join(dataDir, 'samples.jsonl')
  const configPath = join(dataDir, 'config.json')
  const store = createFileStore(file)
  const snapshot = loadSnapshot()
  const stepStarts = new Map<string, number>()
  let lastRecordedAt = 0
  let sweepTimer: ReturnType<typeof setInterval> | undefined
  let rearmSweep: () => void = () => undefined

  ctx.effect(() => {
    void (async () => {
      try {
        await mkdir(dataDir, { recursive: true })
        const user = await readUserConfig(configPath, ctx.logger)
        // dataDir cannot come from the file: the file lives inside it.
        const { dataDir: _ignored, ...rest } = user
        void _ignored
        Object.assign(effective, ConfigSchema.parse({ ...effective, ...rest }), {
          dataDir: effective.dataDir,
        })
        await store.initialize(effective)
      } catch (error) {
        ctx.logger.error('stats: initialize failed', error)
      }
    })()
    return () => undefined
  }, 'stats: data directory')

  ctx.on('session/event', (session: DshSession, event: unknown) => {
    const outcome = collectSessionEvent(
      session.id,
      event,
      stepStarts.get(session.id),
      lastRecordedAt,
      { config: effective, snapshot },
    )
    if (outcome.kind === 'step-start') {
      stepStarts.set(session.id, outcome.time)
      return
    }
    if (outcome.kind !== 'step') return
    lastRecordedAt = outcome.outcome.sample.time
    const sample: Sample = outcome.outcome.sample
    void store
      .enqueue(() => store.append(sample, effective))
      .catch((error: unknown) => {
        ctx.logger.error('stats: sample append failed', error)
      })
  })

  ctx.on('session/created', (session: DshSession) => {
    if (!effective.includeSessionIds) return
    const sample: Sample = { kind: 'session-join', time: Date.now(), sessionId: session.id }
    void store.enqueue(() => store.append(sample, effective)).catch((error: unknown) => {
      ctx.logger.error('stats: lifecycle append failed', error)
    })
  })

  ctx.on('session/disposed', (session: DshSession) => {
    stepStarts.delete(session.id)
    if (!effective.includeSessionIds) return
    const sample: Sample = { kind: 'session-leave', time: Date.now(), sessionId: session.id }
    void store.enqueue(() => store.append(sample, effective)).catch((error: unknown) => {
      ctx.logger.error('stats: lifecycle append failed', error)
    })
  })

  ctx.on('tools/result', (exec: unknown, result: unknown) => {
    const startedAt = Date.now()
    const sample = collectTool(startedAt, undefined, exec, result, effective.includeSessionIds)
    if (sample === null) return
    void store.enqueue(() => store.append(sample, effective)).catch((error: unknown) => {
      ctx.logger.error('stats: tool append failed', error)
    })
  })

  ctx.effect(() => {
    const arm = (): void => {
      if (sweepTimer !== undefined) clearInterval(sweepTimer)
      sweepTimer = setInterval(() => {
        void store
          .enqueue(() => store.sweep(effective))
          .catch((error: unknown) => {
            ctx.logger.error('stats: sweep failed', error)
          })
      }, effective.sweepIntervalMinutes * 60_000)
    }
    arm()
    rearmSweep = arm
    return () => {
      clearInterval(sweepTimer)
    }
  }, 'stats: retention sweep')

  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'global',
      name: '__DSH_STATS__',
      value: { url: ROUTE_SAMPLES, summaryUrl: ROUTE_SUMMARY, configUrl: ROUTE_CONFIG },
    })
  })

  const webServer = ctx.get('webServer')
  if (typeof (webServer as DshWebServer | undefined)?.register !== 'function') {
    ctx.logger.warn('stats: no webServer service; recording continues but the Web panel has no data route')
    return
  }
  const server = webServer as DshWebServer

  ctx.effect(() => {
    const disposers = [
      server.register({
        kind: 'exact',
        path: ROUTE_SAMPLES,
        async handler(req, res) {
          if (req.method !== 'GET') return notAllowed(res)
          const body = await store.readAll()
          json(res, 200, body, 'text/plain')
        },
      }),
      server.register({
        kind: 'exact',
        path: ROUTE_CSV,
        async handler(req, res) {
          if (req.method !== 'GET') return notAllowed(res)
          const body = await store.readAll()
          const rows = body.split('\n').filter((line) => line.trim() !== '')
          const csv = [
            'time_iso,kind,model,provider,turn,step,ttft_ms,decode_ms,output_tokens,input_tokens,reasoning_tokens,text_chars,reasoning_chars,tps,cost_usd,interrupted,session_id',
            ...rows
              .map((line) => {
                const sample = parseSampleLine(line)
                if (sample === null || sample.kind !== 'step') return null
                try {
                  return toCsvRow(sample)
                } catch {
                  return null
                }
              })
              .filter((row): row is string => row !== null),
          ].join('\n')
          json(res, 200, `${csv}\n`, 'text/csv')
        },
      }),
      server.register({
        kind: 'exact',
        path: ROUTE_SUMMARY,
        async handler(req, res) {
          if (req.method !== 'GET') return notAllowed(res)
          const { samples, skippedLines } = await store.readParsed()
          json(
            res,
            200,
            JSON.stringify(
              summarize(samples, {
                maxPlausibleTps: effective.maxPlausibleTps,
                pricingSource: snapshot.source,
                pricingVersion: snapshot.version,
                pricingUpdatedAt: snapshot.updatedAt,
                retention: {
                  maxFileBytes: effective.maxFileBytes,
                  maxAgeDays: effective.maxAgeDays,
                  sampleMinIntervalMs: effective.sampleMinIntervalMs,
                  maxPlausibleTps: effective.maxPlausibleTps,
                },
                fileBytes: await store.fileSize(),
                skippedLines,
              }),
            ),
          )
        },
      }),
      server.register({
        kind: 'exact',
        path: ROUTE_CONFIG,
        async handler(req, res) {
          if (req.method === 'GET') {
            json(res, 200, JSON.stringify(effective))
            return
          }
          if (req.method !== 'POST') return notAllowed(res)
          const chunks = await readBody(req)
          let patch: unknown
          try {
            patch = JSON.parse(chunks || '{}') as unknown
          } catch {
            json(res, 400, JSON.stringify({ error: 'body must be JSON' }))
            return
          }
          if (typeof patch !== 'object' || patch === null) {
            json(res, 400, JSON.stringify({ error: 'body must be a JSON object' }))
            return
          }
          // Moving the data location live would strand the store; reload to change it.
          const { dataDir: _dropped, ...rest } = patch as Record<string, unknown>
          void _dropped
          let next: StatsConfig
          try {
            next = ConfigSchema.parse({ ...effective, ...rest })
          } catch (error) {
            json(res, 400, JSON.stringify({ error: String((error as Error)?.message ?? error) }))
            return
          }
          Object.assign(effective, next)
          try {
            const user = await readUserConfig(configPath, ctx.logger)
            await writeFile(
              configPath,
              `${JSON.stringify({ ...user, ...rest }, null, 2)}\n`,
              'utf8',
            )
          } catch (error) {
            ctx.logger.error('stats: config write failed', error)
            json(res, 500, JSON.stringify({ error: 'failed to persist config' }))
            return
          }
          // Ensure the config file exists even when the data dir write raced.
          await appendFile(configPath, '', 'utf8').catch(() => undefined)
          rearmSweep()
          json(res, 200, JSON.stringify(effective))
        },
      }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'stats: data routes')
}
