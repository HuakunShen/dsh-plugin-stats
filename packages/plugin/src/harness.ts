/**
 * Minimal typed adapter for the DeepSeek Harness Host plugin surface.
 *
 * There is no official plugin `@types` package: the Host hands the bundle an
 * untyped `ctx` object and untyped `session`/`event` payloads. Instead of
 * `any`, this module declares the smallest structural interfaces the plugin
 * actually touches, and every payload crossing the boundary is validated
 * with zod (`safeParse`) before use. Anything the Harness changes shape on
 * fails closed (event skipped, never thrown).
 *
 * References: `session/event` + `session/disposed` emit signatures and the
 * `webServer` + `webserver/index-inject` contracts from the Host inspect
 * catalog; `tools/result` emit observation.
 */
import { z } from 'zod'
import {
  MessageSourceSchema,
  StreamRecordSchema,
  UsageSchema,
} from '@dsh-stats/core'

/* ------------------------------------------------------------------ */
/* Context surface used by the plugin                                  */
/* ------------------------------------------------------------------ */

export interface DshLogger {
  warn(message: string): void
  error(message: string, error?: unknown): void
}

export interface DshRouteHandler {
  (req: DshRequest, res: DshResponse): void | Promise<void>
}

export interface DshRequest extends AsyncIterable<Uint8Array | string> {
  method?: string
}

export interface DshResponse {
  writeHead(code: number, headers: Record<string, string>): void
  end(body: string): void
}

export interface DshWebServer {
  register(route: { kind: 'exact'; path: string; handler: DshRouteHandler }): () => void
}

export interface DshPluginContext {
  on(event: 'session/event', fn: (session: DshSession, event: unknown) => void): () => void
  on(event: 'session/disposed', fn: (session: DshSession) => void): () => void
  on(event: 'session/created', fn: (session: DshSession) => void): () => void
  on(event: 'tools/result', fn: (exec: unknown, result: unknown) => void): () => void
  on(event: 'webserver/index-inject', fn: (table: IndexInjection[]) => void): () => void
  on(event: string, fn: (...args: never[]) => void): () => void
  effect(fn: () => void | (() => void) | Promise<void | (() => void)>, label?: string): void
  get(key: 'webServer'): DshWebServer | undefined
  get(key: string): unknown
  logger: DshLogger
}

export interface DshSession {
  id: string
}

export interface IndexInjection {
  kind: 'global'
  name: string
  value: Record<string, string>
}

/* ------------------------------------------------------------------ */
/* Boundary-validated event payloads                                   */
/* ------------------------------------------------------------------ */

/** `step/start` marker: only the wall time matters. */
const StepStartSchema = z.looseObject({
  type: z.literal('step/start'),
  time: z.number(),
})

/** `assistant/message` carrier: stream records + usage + model source. */
const AssistantMessageDataSchema = z.object({
  turn: z.number().nullable().optional(),
  step: z.number().nullable().optional(),
  interrupted: z.boolean().optional(),
  stream: z.array(z.unknown()).default([]),
  usage: z.unknown().optional(),
  message: z.object({ source: z.unknown().optional() }).optional(),
})

const AssistantMessageSchema = z.object({
  type: z.literal('assistant/message'),
  time: z.number(),
  data: AssistantMessageDataSchema,
})

export interface AssistantMessageView {
  eventTime: number
  turn: number | null
  step: number | null
  interrupted: boolean
  stream: z.infer<typeof StreamRecordSchema>[]
  usage: z.infer<typeof UsageSchema> | null
  source: z.infer<typeof MessageSourceSchema> | null
}

/**
 * Validate a raw `session/event` payload. Returns the step-start time, a
 * validated assistant-message view, or `null` for irrelevant/unparseable
 * events. Never throws.
 */
export function viewSessionEvent(
  event: unknown,
): { kind: 'step-start'; time: number } | { kind: 'assistant-message'; view: AssistantMessageView } | null {
  const start = StepStartSchema.safeParse(event)
  if (start.success) return { kind: 'step-start', time: start.data.time }
  const parsed = AssistantMessageSchema.safeParse(event)
  if (!parsed.success) return null
  const payload = parsed.data
  const stream: AssistantMessageView['stream'] = []
  for (const record of payload.data.stream) {
    const recordParsed = StreamRecordSchema.safeParse(record)
    if (recordParsed.success) stream.push(recordParsed.data)
  }
  const usageParsed = UsageSchema.safeParse(payload.data.usage ?? undefined)
  const sourceParsed = MessageSourceSchema.safeParse(payload.data.message?.source ?? undefined)
  return {
    kind: 'assistant-message',
    view: {
      eventTime: payload.time,
      turn: payload.data.turn ?? null,
      step: payload.data.step ?? null,
      interrupted: payload.data.interrupted === true,
      stream,
      usage: usageParsed.success ? usageParsed.data : null,
      source: sourceParsed.success ? sourceParsed.data : null,
    },
  }
}

/** `tools/result` observation: tool name, wall duration, ok/err tag. */
const ToolExecSchema = z.looseObject({
  tool: z.string().optional(),
  name: z.string().optional(),
  durationMs: z.number().optional(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
})

const ToolResultSchema = z.looseObject({
  ok: z.boolean().optional(),
  error: z.unknown().optional(),
  errorKind: z.string().optional(),
  kind: z.string().optional(),
})

export interface ToolObservation {
  tool: string
  durationMs: number
  ok: boolean
  errorKind: string | null
}

/**
 * Validate a raw `tools/result` emission. Duration prefers an explicit
 * `durationMs`, else `endedAt - startedAt`, else 0. Never throws.
 */
export function viewToolResult(exec: unknown, result: unknown): ToolObservation | null {
  const execParsed = ToolExecSchema.safeParse(exec)
  if (!execParsed.success) return null
  const tool = execParsed.data.tool ?? execParsed.data.name
  if (tool === undefined) return null
  let durationMs = execParsed.data.durationMs ?? 0
  if (
    (execParsed.data.durationMs === undefined ||
      !Number.isFinite(execParsed.data.durationMs)) &&
    execParsed.data.startedAt !== undefined &&
    execParsed.data.endedAt !== undefined
  ) {
    durationMs = Math.max(0, execParsed.data.endedAt - execParsed.data.startedAt)
  }
  const resultParsed = ToolResultSchema.safeParse(result)
  let ok = true
  let errorKind: string | null = null
  if (resultParsed.success) {
    if (typeof resultParsed.data.ok === 'boolean') {
      ok = resultParsed.data.ok
    } else if (resultParsed.data.error !== undefined) {
      ok = false
    }
    errorKind =
      resultParsed.data.errorKind ??
      resultParsed.data.kind ??
      (resultParsed.data.error === undefined ? null : 'error')
    if (ok) errorKind = null
  }
  return { tool, durationMs: Math.max(0, durationMs), ok, errorKind }
}
