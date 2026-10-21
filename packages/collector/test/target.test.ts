import { TARGET_MAX } from '@claude-office/shared'
import { describe, expect, it } from 'vitest'
import { baseName, firstCommandToken, shortPattern, toolTarget, truncate } from '../src/target'

describe('toolTarget', () => {
  it.each([
    ['Read', { file_path: '/Users/a/proj/src/app.ts' }, 'app.ts'],
    ['Edit', { file_path: '/Users/a/proj/README.md', old_string: 'x' }, 'README.md'],
    ['Write', { file_path: 'C:\\Users\\a\\x\\note.txt' }, 'note.txt'],
    ['NotebookEdit', { notebook_path: '/u/n/analysis.ipynb' }, 'analysis.ipynb'],
    ['LS', { path: '/Users/a/proj/src/' }, 'src'],
    ['Bash', { command: 'npm test -- --watch' }, 'npm'],
    ['Bash', { command: 'cd /Users/a/proj && pnpm build' }, 'cd'],
    ['Bash', { command: 'FOO=1 BAR=2 ./scripts/run.sh arg' }, 'run.sh'],
    ['Bash', { command: '/usr/local/bin/node x.js' }, 'node'],
    ['Bash', { command: 'git log | head' }, 'git'],
    ['Bash', { command: '"git" status' }, 'git'],
    ['Bash', { command: '(cd x; make)' }, 'cd'],
    ['Grep', { pattern: 'TODO\\(\\w+\\)', path: '/Users/a' }, 'TODO\\(\\w+\\)'],
    ['Glob', { pattern: '/Users/alice/proj/**/*.ts' }, '*.ts'],
    ['Glob', { pattern: '**/*.test.ts' }, '**/*.test.ts'],
    ['WebFetch', { url: 'https://example.com/a/b?q=secret' }, 'example.com'],
    ['Agent', { subagent_type: 'Explore', prompt: 'secret' }, 'Explore'],
    ['Task', { subagent_type: 'Plan' }, 'Plan'],
    ['mcp__slack__post', { text: 'secret' }, 'slack'],
  ])('%s %j → %s', (name, input, expected) => {
    expect(toolTarget(name, input)).toBe(expected)
  })

  it.each([
    ['WebSearch', { query: 'secret question' }],
    ['TodoWrite', { todos: [{ content: 'secret' }] }],
    ['Bash', { command: '   ' }],
    ['Bash', {}],
    ['Read', null],
    ['Read', 'string'],
  ])('%s %j → undefined', (name, input) => {
    expect(toolTarget(name, input)).toBeUndefined()
  })

  it(`항상 ${TARGET_MAX}자 이하`, () => {
    expect(toolTarget('Read', { file_path: `/x/${'a'.repeat(200)}.ts` })?.length).toBe(TARGET_MAX)
    expect(toolTarget('Bash', { command: `${'b'.repeat(200)} x` })?.length).toBe(TARGET_MAX)
    expect(toolTarget('Grep', { pattern: 'c'.repeat(200) })?.length).toBe(30)
  })
})

describe('helpers', () => {
  it('truncate 는 서로게이트 쌍을 반으로 자르지 않는다', () => {
    const s = `${'a'.repeat(59)}😀`
    const t = truncate(s, 60)
    expect(t).toBe('a'.repeat(59))
  })
  it('baseName', () => {
    expect(baseName('/a/b/')).toBe('b')
    expect(baseName('')).toBe('')
  })
  it('firstCommandToken: 대입만 있으면 undefined', () => {
    expect(firstCommandToken('A=1')).toBeUndefined()
  })
  it('shortPattern: 중간의 홈 디렉터리 이름을 가린다', () => {
    expect(shortPattern('foo|/home/bob/x')).toBe('foo|~/x')
  })
})
