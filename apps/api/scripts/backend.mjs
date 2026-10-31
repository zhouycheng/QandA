import { existsSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
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
  if (['build', 'test', 'verify', 'postgresTest', 'start', 'bootstrap', 'db-init', 'db-reset'].includes(command) && !existsSync(join(env.JAVA_HOME, 'bin/java'))) throw new Error('请用JAVA_HOME指定已安装的JDK21');
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

function mavenSettings() {
  const runtime = join(apiRoot, '.backend-runtime');
  mkdirSync(runtime, { recursive: true });
  const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
  const configured = process.env.HTTPS_PROXY || process.env.https_proxy;
  const proxy = configured ? new URL(configured) : null;
  if (proxy && !['http:', 'https:'].includes(proxy.protocol)) throw new Error('Maven代理须使用HTTP或HTTPS URL');
  const proxies = proxy ? ['http', 'https'].map((protocol) => `<proxy><id>session-${protocol}</id><active>true</active><protocol>${protocol}</protocol><host>${escape(proxy.hostname)}</host><port>${escape(proxy.port || (proxy.protocol === 'https:' ? '443' : '80'))}</port><nonProxyHosts>localhost|127.*|[::1]</nonProxyHosts>${proxy.username ? `<username>${escape(decodeURIComponent(proxy.username))}</username><password>${escape(decodeURIComponent(proxy.password))}</password>` : ''}</proxy>`).join('') : '';
  const path = join(runtime, 'maven-settings.xml');
  writeFileSync(path, `<settings><proxies>${proxies}</proxies></settings>`, { mode: 0o600 });
  return path;
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
    await run('docker', ['compose', '-p', 'qanda-backend', '--env-file', '.env.backend', '-f', 'compose.backend.yml', ...(command === 'deps' ? ['up', '-d', '--wait', 'postgres'] : ['stop', 'postgres', 'mailpit'])]);
  } else if (command === 'capture') {
    await run('docker', ['compose', '-p', 'qanda-backend', '--env-file', '.env.backend', '-f', 'compose.backend.yml', 'up', '-d', 'mailpit']);
  } else if (command === 'docker-build') {
    if (!existsSync(join(apiRoot, 'target/qanda-backend-1.0.0.jar'))) throw new Error('请先执行 build 或 scripts/rebuild.mjs');
    await run('docker', ['compose', '-p', 'qanda-backend', '--env-file', '.env.backend', '-f', 'compose.backend.yml', 'build', '--no-cache', 'api']);
    await run('docker', ['image', 'prune', '--force', '--filter', 'label=qanda.backend=true']);
  } else if (['docker-up', 'docker-stop', 'docker-logs', 'docker-bootstrap'].includes(command)) {
    const args = { 'docker-up': ['up', '-d', '--wait'], 'docker-stop': ['stop', 'api'], 'docker-logs': ['logs', '--tail', '100', '-f', 'api'], 'docker-bootstrap': ['run', '--rm', '--no-deps', '-it', 'api', 'bootstrap'] }[command];
    await run('docker', ['compose', '-p', 'qanda-backend', '--env-file', '.env.backend', '-f', 'compose.backend.yml', ...args]);
  } else if (['build', 'test', 'verify', 'postgresTest'].includes(command)) {
    const goal = { build: 'package', test: 'test', verify: 'verify', postgresTest: 'verify' }[command];
    await run('./mvnw', ['-s', mavenSettings(), goal, ...process.argv.slice(3)]);
  } else if (['start', 'bootstrap', 'db-init', 'db-reset'].includes(command)) {
    await run(join(environment().JAVA_HOME, 'bin/java'), ['-Xmx512m', '-jar', 'target/qanda-backend-1.0.0.jar', ...(command === 'start' ? [] : [command])]);
  } else throw new Error('命令：init deps stop-deps capture build test verify start bootstrap db-init db-reset docker-build docker-up docker-stop docker-logs docker-bootstrap');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
