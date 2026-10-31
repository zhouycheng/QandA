import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = mkdtempSync(join(tmpdir(), 'qanda-rebuild-check-'));
try {
  for (const dir of ['scripts', 'target', '.backend-runtime', 'fake-java/bin', 'fake-bin']) mkdirSync(join(root, dir), { recursive: true });
  for (const file of ['backend.mjs', 'rebuild.mjs']) copyFileSync(join(source, 'scripts', file), join(root, 'scripts', file));
  const config = 'BACKEND_MODE=local\nBACKEND_DB_PASSWORD=fixture-only\n';
  writeFileSync(join(root, '.env.backend'), config, { mode: 0o600 });
  writeFileSync(join(root, '.backend-runtime', 'preserved.json'), '{"keep":true}');
  writeFileSync(join(root, 'fake-java/bin/java'), '', { mode: 0o700 });
  writeFileSync(join(root, 'target/old.jar'), 'old build');
  const log = join(root, 'commands.jsonl');
  const fixture = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const root = process.env.QANDA_REBUILD_TEST_ROOT;
const args = process.argv.slice(2);
const maven = path.basename(process.argv[1]) === 'mvnw';
if (maven) {
  if (fs.existsSync(path.join(root, 'target/old.jar'))) process.exit(9);
  fs.mkdirSync(path.join(root, 'target'), { recursive: true });
  fs.writeFileSync(path.join(root, 'target/qanda-backend-1.0.0.jar'), 'fixture build');
}
fs.appendFileSync(path.join(root, 'commands.jsonl'), JSON.stringify({ program: maven ? 'maven' : 'docker', args }) + '\\n');
if (!maven && process.env.QANDA_REBUILD_TEST_FAIL === '1') process.exit(3);
`;
  for (const file of ['mvnw', 'fake-bin/docker']) writeFileSync(join(root, file), fixture, { mode: 0o700 });
  const env = { ...process.env, QANDA_REBUILD_TEST_ROOT: root, JAVA_HOME: join(root, 'fake-java'), PATH: `${join(root, 'fake-bin')}:${process.env.PATH}` };
  const run = (extra = {}) => spawnSync(process.execPath, [join(root, 'scripts/rebuild.mjs')], { env: { ...env, ...extra }, encoding: 'utf8' });
  let result = run();
  assert.equal(result.status, 0, result.stderr);
  let commands = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(commands.length, 3);
  assert.equal(commands[0].program, 'maven');
  assert.equal(commands[0].args.at(-1), 'package');
  assert.deepEqual(commands[1].args.slice(-3), ['build', '--no-cache', 'api']);
  assert.deepEqual(commands[2].args, ['image', 'prune', '--force', '--filter', 'label=qanda.backend=true']);
  assert.equal(readFileSync(join(root, '.env.backend'), 'utf8'), config);
  assert.equal(readFileSync(join(root, '.backend-runtime/preserved.json'), 'utf8'), '{"keep":true}');
  assert.ok(!existsSync(join(root, 'target/old.jar')));
  writeFileSync(log, '');
  result = run({ QANDA_REBUILD_TEST_FAIL: '1' });
  assert.notEqual(result.status, 0);
  commands = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(commands.length, 2, 'failed image build must stop before cleanup');
  console.log('重建脚本检查通过：清理范围、构建顺序、镜像清理及失败停止');
} finally {
  rmSync(root, { recursive: true, force: true });
}
