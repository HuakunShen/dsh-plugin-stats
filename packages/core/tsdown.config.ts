import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts', './src/schemas.ts', './src/sampling.ts', './src/aggregate.ts', './src/csv.ts'],
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  clean: true,
})
