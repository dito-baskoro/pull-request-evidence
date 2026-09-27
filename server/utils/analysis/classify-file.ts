// Deterministic file classification (plan section 9; Milestone 4).
//
// Classifies a path into one of the plan section 9 categories using explainable
// heuristics (extensions and path segments). Every result carries a short human
// reason so exclusion decisions can be surfaced in the UI.
//
// The slice focuses on JavaScript/TypeScript, but the classifier also
// recognizes lockfiles, migrations, docs, configuration, dependency manifests,
// generated output, and binary/unsupported files so the change map can exclude
// them with a visible reason.
//
// Pure function, no I/O; independent of AI and persistence.

import type { FileClass } from '~/types/analysis'

export interface FileClassification {
  category: FileClass
  /** Short explainable reason, safe to show to a reviewer. */
  reason: string
}

const LOCKFILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'npm-shrinkwrap.json',
  'bun.lockb',
])

const DEPENDENCY_MANIFESTS = new Set([
  'package.json',
])

// Common documentation extensions.
const DOC_EXTENSIONS = new Set(['md', 'mdx', 'markdown', 'rst', 'txt', 'adoc'])

// Common binary / unsupported extensions.
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'svg', 'bmp', 'tiff',
  'pdf', 'zip', 'gz', 'tar', 'tgz', 'br', 'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp4', 'mov', 'webm', 'mp3', 'wav', 'jar', 'wasm', 'lockb',
])

// Configuration extensions and well-known config filenames.
const CONFIG_EXTENSIONS = new Set(['json', 'yaml', 'yml', 'toml', 'ini', 'env'])
const CONFIG_FILENAMES = new Set([
  'tsconfig.json',
  'nuxt.config.ts',
  'vite.config.ts',
  'vitest.config.ts',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.cjs',
  '.prettierrc',
  '.gitignore',
  'dockerfile',
])

const JS_TS_EXTENSIONS = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts', 'vue'])

/** Return the lowercased final extension of a path, or '' when none. */
function extensionOf(path: string): string {
  const base = basenameOf(path)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1).toLowerCase()
}

function basenameOf(path: string): string {
  const clean = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const slash = clean.lastIndexOf('/')
  return slash === -1 ? clean : clean.slice(slash + 1)
}

function segmentsOf(path: string): string[] {
  return path.replace(/\\/g, '/').split('/').filter(Boolean)
}

/** True when the path looks like a JS/TS test file by name or directory. */
export function isTestPath(path: string): boolean {
  const base = basenameOf(path).toLowerCase()
  const segments = segmentsOf(path).map((s) => s.toLowerCase())
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(base)) return true
  if (segments.includes('__tests__')) return true
  if (segments.includes('__mocks__')) return true
  // A top-level `test`/`tests`/`spec` directory containing JS/TS.
  if ((segments.includes('test') || segments.includes('tests') || segments.includes('spec'))
    && JS_TS_EXTENSIONS.has(extensionOf(path))) {
    return true
  }
  return false
}

/**
 * Classify a repository path. The order of checks matters: more specific
 * signals (lockfile, test, migration, generated) win over broader ones
 * (configuration, production source).
 */
export function classifyFile(path: string): FileClassification {
  const base = basenameOf(path)
  const lowerBase = base.toLowerCase()
  const ext = extensionOf(path)
  const segments = segmentsOf(path)
  const lowerSegments = segments.map((s) => s.toLowerCase())

  // Lockfiles: summarized, never sent to the model.
  if (LOCKFILES.has(lowerBase)) {
    return { category: 'lockfile', reason: `Dependency lockfile (${base})` }
  }

  // Minified or explicitly generated output.
  if (/\.min\.[cm]?[jt]sx?$/.test(lowerBase) || lowerBase.endsWith('.min.css')) {
    return { category: 'generated', reason: 'Minified asset (.min.*)' }
  }
  if (lowerSegments.includes('dist') || lowerSegments.includes('build')
    || lowerSegments.includes('.nuxt') || lowerSegments.includes('.output')
    || lowerSegments.includes('coverage')) {
    return { category: 'generated', reason: `Generated/build output directory (${firstMatch(lowerSegments, ['dist', 'build', '.nuxt', '.output', 'coverage'])})` }
  }
  if (lowerBase.endsWith('.d.ts')) {
    return { category: 'generated', reason: 'Generated type declarations (.d.ts)' }
  }

  // Test files.
  if (isTestPath(path)) {
    return { category: 'test', reason: 'Matches a test naming/location heuristic' }
  }

  // Database migrations.
  if (lowerSegments.includes('migrations') || lowerSegments.includes('migration')) {
    return { category: 'migration', reason: 'Located under a migrations directory' }
  }

  // Dependency manifests.
  if (DEPENDENCY_MANIFESTS.has(lowerBase)) {
    return { category: 'dependency_manifest', reason: `Dependency manifest (${base})` }
  }

  // Documentation.
  if (DOC_EXTENSIONS.has(ext) || lowerBase === 'license' || lowerBase === 'notice') {
    return { category: 'documentation', reason: `Documentation file (.${ext || 'text'})` }
  }

  // Binary / unsupported.
  if (BINARY_EXTENSIONS.has(ext)) {
    return { category: 'binary_unsupported', reason: `Binary or unsupported type (.${ext})` }
  }

  // Configuration (well-known filenames or config extensions).
  if (CONFIG_FILENAMES.has(lowerBase) || CONFIG_EXTENSIONS.has(ext)) {
    return { category: 'configuration', reason: `Configuration file (${base})` }
  }

  // Production source: JS/TS (and .vue) not otherwise classified.
  if (JS_TS_EXTENSIONS.has(ext)) {
    return { category: 'production_source', reason: `Production JavaScript/TypeScript source (.${ext})` }
  }

  // Anything else is treated as unsupported for the JS/TS-focused slice.
  return { category: 'binary_unsupported', reason: `Unsupported file type for this slice (.${ext || 'none'})` }
}

function firstMatch(haystack: string[], needles: string[]): string {
  for (const n of needles) {
    if (haystack.includes(n)) return n
  }
  return needles[0]
}
