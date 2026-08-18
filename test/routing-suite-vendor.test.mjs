import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../vendor/dsh-routing-suite/', import.meta.url))
// The vendored routing suite is kept private and only present in the full
// development tree, not in the public Eclipse Dshbooster release. When vendor/
// is absent (e.g. a fresh clone of the public repo), these provenance checks
// cannot run and are skipped rather than failing the suite.
const hasVendor = existsSync(join(root, 'UPSTREAM.json'))
const skip = { skip: !hasVendor }

test('vendored routing suite records all three fixed upstream components', skip, () => {
  const manifest = JSON.parse(readFileSync(join(root, 'UPSTREAM.json'), 'utf8'))
  assert.equal(manifest.upstreamCommit, 'a09eb0ade28e6ec3b8e5eb22985a14f6bfa1fbe5')
  assert.deepEqual(Object.keys(manifest.components).sort(), ['injector', 'mode-boost', 'preset'])
  for (const component of Object.values(manifest.components)) assert.match(component.commit, /^[0-9a-f]{40}$/)
})

test('super-injector companion retains its complete entry and patch contract', skip, () => {
  const packageJson = JSON.parse(readFileSync(join(root, 'injector/package.json'), 'utf8'))
  const patch = readFileSync(join(root, 'injector/cordis.patch.yml'), 'utf8')
  const source = readFileSync(join(root, 'injector/src/index.ts'), 'utf8')
  assert.equal(packageJson.name, '@dsh-external/dsh-super-injector')
  for (const tool of ['dev_inject_plugin', 'dev_install_package', 'dev_reload_package', 'dev_plugin_status', 'dev_injected_list', 'dev_scaffold_plugin']) assert.match(source, new RegExp(`name: '${tool}'`))
  assert.match(source, /自动轮询 watch/)
  assert.match(patch, /@dsh-external\/dsh-super-injector/)
})

test('router release artifact is expanded into executable standard and spec presets', skip, () => {
  for (const mode of ['router-standard', 'router-spec', 'router-pro']) {
    const bootstrap = readFileSync(join(root, `preset/preset/${mode}/router-bootstrap.mjs`), 'utf8')
    const core = readFileSync(join(root, `preset/preset/${mode}/router-core.mjs`), 'utf8')
    assert.match(bootstrap, /system-prompt\/assemble/)
    assert.match(core, /classifyTask/)
  }
})
