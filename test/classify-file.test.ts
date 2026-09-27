import { describe, expect, it } from 'vitest'
import { classifyFile, isTestPath } from '~/server/utils/analysis/classify-file'

describe('classifyFile', () => {
  const cases: Array<[string, string]> = [
    ['src/services/user.ts', 'production_source'],
    ['components/Foo.vue', 'production_source'],
    ['src/services/user.test.ts', 'test'],
    ['src/services/user.spec.tsx', 'test'],
    ['test/user.test.ts', 'test'],
    ['__tests__/user.ts', 'test'],
    ['supabase/migrations/0001_init.sql', 'migration'],
    ['package.json', 'dependency_manifest'],
    ['package-lock.json', 'lockfile'],
    ['pnpm-lock.yaml', 'lockfile'],
    ['yarn.lock', 'lockfile'],
    ['README.md', 'documentation'],
    ['docs/guide.mdx', 'documentation'],
    ['dist/index.js', 'generated'],
    ['build/app.js', 'generated'],
    ['src/vendor.min.js', 'generated'],
    ['types/foo.d.ts', 'generated'],
    ['assets/logo.png', 'binary_unsupported'],
    ['tsconfig.json', 'configuration'],
    ['config/app.yaml', 'configuration'],
  ]

  for (const [path, expected] of cases) {
    it(`classifies ${path} as ${expected}`, () => {
      const result = classifyFile(path)
      expect(result.category).toBe(expected)
      expect(result.reason).toBeTruthy()
    })
  }

  it('prefers lockfile over configuration for package-lock.json', () => {
    expect(classifyFile('package-lock.json').category).toBe('lockfile')
  })

  it('prefers test over production source for a .test.ts file', () => {
    expect(classifyFile('src/foo.test.ts').category).toBe('test')
  })
})

describe('isTestPath', () => {
  it('detects .test/.spec suffixes', () => {
    expect(isTestPath('a/b/foo.test.ts')).toBe(true)
    expect(isTestPath('a/b/foo.spec.js')).toBe(true)
  })
  it('detects __tests__ directories', () => {
    expect(isTestPath('a/__tests__/foo.ts')).toBe(true)
  })
  it('rejects plain source files', () => {
    expect(isTestPath('src/foo.ts')).toBe(false)
  })
})
