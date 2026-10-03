/**
 * @dsh-stats/core — CSV projection of step samples.
 *
 * One header + one row per step sample for spreadsheets and notebooks.
 * Tool and lifecycle rows are out of scope for the CSV export (they have
 * their own shape; JSONL remains the complete source).
 */
import type { StepSample } from './schemas.js'

export const CSV_HEADER =
  'time_iso,kind,model,provider,turn,step,ttft_ms,decode_ms,output_tokens,input_tokens,reasoning_tokens,text_chars,reasoning_chars,tps,cost_usd,interrupted,session_id'

function cell(value: string): string {
  return value.includes(',') || value.includes('"') || value.includes('\n')
    ? `"${value.replaceAll('"', '""')}"`
    : value
}

export function toCsvRow(sample: StepSample): string {
  const cells = [
    new Date(sample.time).toISOString(),
    'step',
    sample.model ?? '',
    sample.provider ?? '',
    sample.turn === null ? '' : String(sample.turn),
    sample.step === null ? '' : String(sample.step),
    sample.ttftMs === null ? '' : String(Math.round(sample.ttftMs)),
    String(Math.round(sample.decodeMs)),
    sample.outputTokens === null ? '' : String(sample.outputTokens),
    sample.inputTokens === null ? '' : String(sample.inputTokens),
    sample.reasoningTokens === null ? '' : String(sample.reasoningTokens),
    String(sample.textChars),
    String(sample.reasoningChars),
    sample.tps === null ? '' : sample.tps.toFixed(2),
    sample.costUsd === null ? '' : String(sample.costUsd),
    sample.interrupted ? 'true' : 'false',
    sample.sessionId ?? '',
  ]
  return cells.map(cell).join(',')
}
