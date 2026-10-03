import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['./src/host.ts'],
    format: ['esm'],
    dts: true,
    outDir: 'dist',
    clean: true,
    external: ['@dsh-stats/core', '@dsh-stats/pricing', 'node:fs/promises', 'node:os', 'node:path'],
  },
  {
    entry: ['./src/cli.ts'],
    format: ['esm'],
    dts: false,
    outDir: 'dist',
    external: ['@dsh-stats/core', '@dsh-stats/pricing'],
  },
  {
    entry: ['./src/client.ts'],
    format: ['esm'],
    dts: false,
    outDir: 'dist',
    external: [],
    noExternal: ['@dsh-stats/core', 'zod'],
  },
])
