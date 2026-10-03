// Render repro: load the built client IIFE against real React in happy-dom.
import { Window } from 'happy-dom'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const React = require('react')
const { createRoot } = require('react-dom/client')
const { act } = React

const win = new Window({ url: 'http://localhost/' })
globalThis.window = win
globalThis.document = win.document
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const samples = readFileSync(process.env.HOME + '/.dsh/stats/samples.jsonl', 'utf8')
const realSummary = readFileSync('/tmp/real-summary.json', 'utf8')
globalThis.fetch = async (url) => {
  const u = String(url)
  if (u.includes('summary')) return { ok: true, status: 200, json: async () => JSON.parse(realSummary), text: async () => realSummary }
  if (u.includes('config')) return { ok: true, status: 200, json: async () => ({ maxPlausibleTps: 500 }), text: async () => '{}' }
  return { ok: true, status: 200, text: async () => samples, json: async () => JSON.parse(samples) }
}

const errors = []
const origError = console.error
console.error = (...a) => { errors.push(a.map(String).join(' ').slice(0, 400)); }

const mods = []
globalThis.__ModuleLoader__ = { load: (m) => mods.push(m) }
globalThis.__DSH_STATS__ = { url: '/dsh-stats/samples.jsonl', summaryUrl: '/dsh-stats/summary.json', configUrl: '/dsh-stats/config' }
new Function(readFileSync(new URL('../dist/client.js', import.meta.url), 'utf8'))()

const factory = mods[0].factory((id) => (id === 'react' ? React : undefined))
let Panel = null
factory.apply({
  locale: { register: () => {}, bind: () => (k) => k },
  slots: {
    inject: (_s, f) => f(),
    register: (s, c) => { if (s.name === 'main') Panel = c },
  },
})

const host = document.createElement('div')
document.body.appendChild(host)
const root = createRoot(host)
try {
  await act(async () => { root.render(React.createElement(Panel, {})) })
  await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
} catch (e) {
  errors.push('THROWN: ' + String(e && e.stack || e).slice(0, 600))
}
console.error = origError
console.log('html length:', host.innerHTML.length)
console.log('html head:', host.innerHTML.slice(0, 300))
console.log('errors:', errors.length)
for (const e of errors.slice(0, 4)) console.log(' -', e)
process.exit(0)
