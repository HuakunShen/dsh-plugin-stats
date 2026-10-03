import { defineConfig } from 'tsdown'

const ALWAYS = ['@dsh-stats/core', '@dsh-stats/pricing', 'zod', '@deepseek-ai/schemastery'] as const

export default defineConfig([
  {
    // Host half (Node): single self-contained ESM file. All workspace deps
    // (@dsh-stats/core, @dsh-stats/pricing, zod, schemastery) and the pricing
    // snapshot are inlined — the installed bundle has zero runtime deps.
    // NOTE: no custom entryFileNames here — it breaks the dts plugin output.
    entry: ['./src/host.ts'],
    format: ['esm'],
    platform: 'node',
    dts: false,
    outDir: 'dist',
    clean: true,
    deps: {
      alwaysBundle: [...ALWAYS],
    },
  },
  {
    // Maintenance CLI (Node): same inlining, plus a shebang.
    entry: ['./src/cli.ts'],
    format: ['esm'],
    platform: 'node',
    dts: false,
    outDir: 'dist',
    deps: {
      alwaysBundle: [...ALWAYS],
    },
    outputOptions: {
      entryFileNames: 'cli.js',
    },
  },
  {
    // Client half (browser): single IIFE file, no imports/exports. The Web
    // plugin loader injects it as a classic script, so ESM would fail with
    // "Cannot use import statement outside a module".
    entry: ['./src/client.ts'],
    format: ['iife'],
    platform: 'browser',
    dts: false,
    outDir: 'dist',
    deps: {
      alwaysBundle: ['@dsh-stats/core', 'zod'],
    },
    outputOptions: {
      entryFileNames: 'client.js',
    },
  },
])
