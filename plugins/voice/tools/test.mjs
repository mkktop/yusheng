// Node 22+；esbuild 只移除 TS 并打包测试，不需要 dsh 或云端凭据。
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const tmp = mkdtempSync(join(tmpdir(), 'yusheng-tests-'))
try {
  const outfile = join(tmp, 'protocol.test.cjs')
  await build({
    entryPoints: ['test/protocol.test.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    logLevel: 'warning',
  })
  const result = spawnSync(process.execPath, ['--test', outfile], { stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  rmSync(tmp, { recursive: true, force: true })
}
