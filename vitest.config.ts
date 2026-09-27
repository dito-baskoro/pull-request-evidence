import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Vitest configuration.
//
// The deterministic modules under server/utils (patch parser, evidence
// registry, citation validator, file classifier) are written as pure
// functions so they can be unit-tested without the Nuxt/Nitro runtime.
// The `~/server` alias lets tests import them the same way server routes do.
export default defineConfig({
  resolve: {
    alias: {
      '~/server': fileURLToPath(new URL('./server', import.meta.url)),
      '~/types': fileURLToPath(new URL('./types', import.meta.url)),
      '~': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    // Most deterministic modules are pure Node code. Component tests that need
    // a DOM can opt into happy-dom per file via a `// @vitest-environment` tag.
    environment: 'node',
    globals: true,
    include: ['test/**/*.{test,spec}.ts', 'server/**/*.{test,spec}.ts'],
  },
})
