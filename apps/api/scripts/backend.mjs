import { existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = join(apiRoot, '.env.backend');
const command = process.argv[2];

function environment() {
  if (!existsSync(config)) throw new Error('请先执行 backend.mjs init');
  if ((statSync(config).mode & 0o077) !== 0) throw new Error('.env.backend 权限须为600');
  const env = { ...process.env };
  const seen = new Set();
  for (const line of readFileSync(config, 'utf8').split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const entry = line.match(/^(BACKEND_[A-Z0-9_]+)=(.*)$/);
    if (!entry || seen.has(entry[1])) throw new Error('.env.backend 配置格式或重复字段错误');
    seen.add(entry[1]);
    env[entry[1]] ??= entry[2];
  }
  const sesConfig = join(homedir(), '.config/qanda/tencent-ses.env');
  if (existsSync(sesConfig)) {
    if ((statSync(sesConfig).mode & 0o077) !== 0) throw new Error('SES私有配置权限须为600');
    for (const line of readFileSync(sesConfig, 'utf8').split('\n')) {
      if (!line.trim() || line.trimStart().startsWith('#')) continue;
      const entry = line.match(/^(TENCENT_[A-Z0-9_]+)=(.*)$/);
      if (!entry) throw new Error('SES私有配置格式错误');
      if (entry[2]) env[entry[1]] ??= entry[2];
    }
  }
  env.JAVA_HOME ??= '/opt/homebrew/opt/openjdk@21';
  if (!existsSync(join(env.JAVA_HOME, 'bin/java'))) throw new Error('请用JAVA_HOME指定已安装的JDK21');
  const socket = join(homedir(), '.colima/default/docker.sock');
  if (!env.DOCKER_HOST && !env.DOCKER_CONTEXT && existsSync(socket)) env.DOCKER_HOST = `unix://${socket}`;
  if (env.DOCKER_HOST?.includes('/.colima/')) env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE ??= '/var/run/docker.sock';
  return env;
}

function run(program, args) {
  return new Promise((accept, reject) => {
    const child = spawn(program, args, { cwd: apiRoot, env: environment(), stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`执行失败：${signal ?? code}`)));
  });
}

try {
  if (command === 'init') {
    if (existsSync(config)) throw new Error('.env.backend 已存在，保留现有配置');
    let values = readFileSync(join(apiRoot, '.env.backend.example'), 'utf8')
      .replace('BACKEND_DB_PASSWORD=\n', `BACKEND_DB_PASSWORD=${randomBytes(32).toString('base64url')}\n`);
    for (const name of ['COMMAND_DIGEST', 'IDENTITY_MAC', 'MAIL_ENCRYPTION']) {
      values = values.replace(`BACKEND_${name}_KEYS=\n`, `BACKEND_${name}_KEYS=1:${randomBytes(32).toString('base64')}\n`);
    }
    values = values.replace('BACKEND_IDENTITY_RATE_KEY=\n', `BACKEND_IDENTITY_RATE_KEY=${randomBytes(32).toString('base64')}\n`);
    writeFileSync(config, values, { mode: 0o600, flag: 'wx' });
    console.log('已生成独立后端私有配置，权限600');
  } else if (command === 'deps' || command === 'stop-deps') {
    await run('docker', ['compose', '-p', 'qanda-backend', '--env-file', '.env.backend', '-f', 'compose.backend.yml', ...(command === 'deps' ? ['up', '-d', '--wait'] : ['stop'])]);
  } else if (command === 'capture') {
    await run('docker', ['compose', '-p', 'qanda-backend', '--env-file', '.env.backend', '-f', 'compose.backend.yml', '--profile', 'local-capture', 'up', '-d', 'mailpit']);
  } else if (['build', 'test', 'postgresTest', 'compileKotlin', 'bootJar', 'platformAcceptanceTest', 'platformMailTest', 'platformFileTest', 'platformBoundaryTest', 'platformRateLimitTest', 'platformResponseCacheTest'].includes(command)) {
    await run('./gradlew', ['--gradle-user-home', join(apiRoot, '.gradle-user-home'), '--no-daemon', command, ...process.argv.slice(3)]);
  } else if (command === 'start' || command === 'bootstrap') {
    await run(join(environment().JAVA_HOME, 'bin/java'), ['-Xmx512m', '-jar', 'build/libs/qanda-backend-0.1.0.jar', ...(command === 'bootstrap' ? ['bootstrap'] : [])]);
  } else throw new Error('命令：init deps stop-deps build test postgresTest platformMailTest platformFileTest start bootstrap');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
