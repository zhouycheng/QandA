import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
export const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function environment() {
  const env = { ...process.env };
  const file = resolve(apiRoot, '.env');
  if (existsSync(file)) for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (match && env[match[1]] === undefined) env[match[1]] = match[2];
  }
  env.JAVA_HOME ??= '/opt/homebrew/opt/openjdk@21';
  const socket = join(homedir(), '.colima/default/docker.sock');
  if (!env.DOCKER_HOST && !env.DOCKER_CONTEXT && existsSync(socket)) env.DOCKER_HOST = `unix://${socket}`;
  if (env.DOCKER_HOST?.includes('/.colima/')) env.TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE ??= '/var/run/docker.sock';
  env.TESTCONTAINERS_RYUK_DISABLED ??= 'true';
  const proxy = env.HTTPS_PROXY ?? env.https_proxy;
  if (proxy) {
    const url = new URL(proxy);
    env.GRADLE_OPTS = `${env.GRADLE_OPTS ?? ''} -Dhttps.proxyHost=${url.hostname} -Dhttps.proxyPort=${url.port || 80} -Dhttp.proxyHost=${url.hostname} -Dhttp.proxyPort=${url.port || 80} -Dhttp.nonProxyHosts=localhost|127.*`;
  }
  return env;
}
export function run(command, args, env = environment()) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: apiRoot, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} 退出码 ${code}`)));
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  try {
    if (command === 'deps') await run('docker', ['compose', '-f', 'compose.yml', 'up', '-d', '--wait']);
    else if (command === 'stop-deps') await run('docker', ['compose', '-f', 'compose.yml', 'stop']);
    else if (command === 'test' || command === 'build') await run('./gradlew', ['--gradle-user-home', resolve(apiRoot,'.gradle-user-home'), '--no-daemon', command === 'test' ? 'test' : 'build']);
    else if (command === 'start') await run(resolve(environment().JAVA_HOME,'bin/java'), ['-Xmx512m','-jar','build/libs/qanda-sync-api-0.1.0.jar','--spring.profiles.active=dev']);
    else throw new Error('命令: deps stop-deps test build start');
  } catch(e) { console.error(e.message); process.exitCode = 1; }
}
