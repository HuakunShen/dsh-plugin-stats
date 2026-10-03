/**
 * @dsh-stats/core — portable stats engine.
 *
 * Zero DSH dependencies. The plugin bundle (`dsh-plugin-stats`) and any
 * future consumer share these schemas, sampling math, aggregation folds,
 * the JSONL store, and the CSV projection.
 */
export * from './schemas.js'
export * from './sampling.js'
export * from './aggregate.js'
export * from './store.js'
export * from './csv.js'
