import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
console.log('清理后端编译缓存、测试报告及旧 JAR');
rmSync(join(apiRoot, 'target'), { recursive: true, force: true });

for (const command of ['build', 'docker-build']) {
  await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [join(apiRoot, 'scripts/backend.mjs'), command], { cwd: apiRoot, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`重建失败：${signal ?? code}`)));
  });
}
console.log('后端镜像 qanda-backend:dev 已构建，可执行 backend.mjs docker-up 启动');
