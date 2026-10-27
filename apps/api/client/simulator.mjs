import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const here = dirname(fileURLToPath(import.meta.url));
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export class ApiError extends Error {
  constructor(status, data) { super(`${status}: ${data.message ?? data.code}`); this.status = status; this.code = data.code; }
}
function keyFromEnv() {
  if (!/^[0-9a-fA-F]{64}$/.test(process.env.SIM_KEY ?? '')) throw new Error('SIM_KEY 必须是环境变量中的64位十六进制密钥');
  return Buffer.from(process.env.SIM_KEY, 'hex');
}
export class Store {
  constructor(user, device, root = resolve(here, '.state')) {
    this.key = keyFromEnv();
    this.path = resolve(root, `${createHash('sha256').update(`${user}\0${device}`).digest('hex')}.json`);
    mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  read() {
    if (!existsSync(this.path)) return null;
    const { version, iv, tag, ciphertext } = JSON.parse(readFileSync(this.path, 'utf8'));
    if (version !== 1) throw new Error('本地数据版本不支持，原文件已保留');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8'));
  }
  write(state) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
    const temp = `${this.path}.${randomUUID()}.tmp`;
    const fd = openSync(temp, 'wx', 0o600);
    try {
      writeFileSync(fd, JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }));
      fsyncSync(fd);
    } finally { closeSync(fd); }
    renameSync(temp, this.path);
    const dir = openSync(dirname(this.path), 'r');
    try { fsyncSync(dir); } finally { closeSync(dir); }
  }
}
export function grade(item, answer) {
  const equal = item.type === 'TRUE_FALSE' ? answer.value === item.answer.value
    : JSON.stringify([...answer.optionKeys].sort()) === JSON.stringify([...item.answer.optionKeys].sort());
  return { evaluation: equal ? 'CORRECT' : 'WRONG', awardedScore: equal ? item.maxScore : '0.00' };
}
export class Simulator {
  constructor({ user, token, device, baseUrl = process.env.API_URL ?? 'http://127.0.0.1:8081/api/v1', root }) {
    this.user = user; this.token = token; this.device = device; this.baseUrl = baseUrl;
    this.store = new Store(user, device, root); this.state = this.store.read(); this.metrics = { requests: 0, uploadRequests: 0, latenciesMs: [] };
    this.flight = null;
  }
  persist() { this.store.write(this.state); }
  requireState() { if (!this.state) throw new Error('请先开始或接管场次'); }
  requireOpen() {
    this.requireState();
    if (this.state.deadlineAt && Date.now() >= this.state.deadlineAt && !this.state.frozen) this.freeze();
    if (this.state.frozen) throw new Error('本地场次已冻结');
  }
  async request(path, method = 'GET', body) {
    if (this.state?.offline) throw new Error('当前模拟断网，变化已保存在本机');
    const started = performance.now(); this.metrics.requests++;
    if (path.endsWith('/sync-batches')) this.metrics.uploadRequests++;
    const response = await fetch(this.baseUrl + path, { method, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    this.metrics.latenciesMs.push(performance.now() - started);
    const data = await response.json();
    if (!response.ok) throw new ApiError(response.status, data);
    return data;
  }
  async start(mode = 'PRACTICE', timeLimitSeconds = 1800) {
    if (this.state && (this.state.changes.length || this.state.pending.length)) throw new Error('当前场次有未同步内容，请先同步或使用另一设备目录');
    if (this.state?.finishIntent && !this.state.completed) throw new Error('当前场次的完成意图尚未同步，请先完成同步');
    const data = await this.request('/practice/sessions', 'POST', { writerId: this.device, mode, ...(mode === 'TEST' ? { timeLimitSeconds } : {}) });
    this.state = { schemaVersion: 1, sessionId: data.sessionId, package: data.package, mode, writerEpoch: data.writerEpoch, answers: {}, flags: {}, currentItemId: data.snapshot.currentItemId, changes: [], pending: [], nextSeq: 1, acceptedThroughSeq: 0, appliedThroughSeq: 0, offline: false, frozen: false, lastSyncAt: Date.now(), startedAt: Date.now(), deadlineAt: mode === 'TEST' ? Date.now() + timeLimitSeconds * 1000 : null, finishIntent: null };
    this.persist(); return data;
  }
  item(id) { this.requireState(); const item = this.state.package.items.find(i => i.itemId === id); if (!item) throw new Error('题目不存在'); return item; }
  add(change) { this.state.changes.push(change); this.persist(); }
  answer(itemId, answer) {
    this.requireOpen();
    const item = this.item(itemId);
    if (item.type === 'TRUE_FALSE') { if (typeof answer.value !== 'boolean') throw new Error('判断答案必须为布尔值'); }
    else {
      const allowed = new Set(item.options.map(o => o.key)), keys = answer.optionKeys;
      if (!Array.isArray(keys) || !keys.length || keys.some(k => !allowed.has(k)) || new Set(keys).size !== keys.length || (item.type === 'SINGLE_CHOICE' && keys.length !== 1)) throw new Error('选择答案无效');
    }
    if (this.state.mode === 'PRACTICE' && this.state.answers[itemId]) throw new Error('首次确认答案已锁定');
    const verdict = grade(item, answer);
    this.state.answers[itemId] = { answer, ...verdict };
    this.add({ type: this.state.mode === 'TEST' ? 'ANSWER_DRAFT' : 'ANSWER_CONFIRM', itemId, answer, ...(this.state.mode === 'PRACTICE' ? verdict : {}) });
    return this.state.mode === 'TEST' ? { saved: 'LOCAL' } : verdict;
  }
  flag(itemId, flagged = true) { this.requireOpen(); this.item(itemId); this.state.flags[itemId] = flagged; this.add({ type: 'SET_FLAG', itemId, flagged }); }
  position(itemId) { this.requireOpen(); this.item(itemId); this.state.currentItemId = itemId; this.add({ type: 'SET_POSITION', itemId }); }
  setOffline(value) { this.requireState(); this.state.offline = value; this.persist(); }
  buildBatch() {
    if (!this.state.changes.length) return;
    const changes = this.state.changes.slice(0, 100).map((c,i) => ({ ...c, seq: this.state.nextSeq+i }));
    const payload = { batchId: randomUUID(), writerId: this.device, writerEpoch: this.state.writerEpoch, firstSeq: changes[0].seq, lastSeq: changes.at(-1).seq, changes };
    if (Buffer.byteLength(JSON.stringify(payload)) > 262144) throw new Error('批次过大');
    this.state.changes.splice(0, changes.length); this.state.nextSeq += changes.length;
    this.state.pending.push({ payload, accepted: false }); this.persist();
  }
  async sync() {
    this.requireState();
    if (this.flight) return this.flight;
    this.flight = this.syncOnce();
    try {
      const result = await this.flight; this.state.retryAttempts = 0; this.state.nextRetryAt = 0; this.state.autoSyncBlocked = false; this.persist(); return result;
    } catch(e) {
      this.state.retryAttempts = (this.state.retryAttempts ?? 0) + 1;
      const delays = [2000,5000,10000,30000,60000];
      this.state.nextRetryAt = Date.now() + delays[Math.min(this.state.retryAttempts-1,delays.length-1)] + Math.floor(Math.random()*500);
      this.state.autoSyncBlocked = e instanceof ApiError && e.status >= 400 && e.status < 500;
      this.persist(); throw e;
    } finally { this.flight = null; }
  }
  async syncOnce() {
    if (this.state.offline) return { saved: 'LOCAL', offline: true };
    while (this.state.changes.length) this.buildBatch();
    for (const batch of this.state.pending) {
      if (!batch.accepted) {
        const receipt = await this.request(`/practice/sessions/${this.state.sessionId}/sync-batches`, 'POST', batch.payload);
        batch.accepted = true; this.state.acceptedThroughSeq = receipt.acceptedThroughSeq; this.persist();
      }
    }
    const status = await this.status(); this.state.lastSyncAt = Date.now(); this.persist(); return status;
  }
  async status() {
    this.requireState();
    const status = await this.request(`/practice/sessions/${this.state.sessionId}/sync-status`);
    if (status.writerEpoch !== this.state.writerEpoch) throw new ApiError(409, { code: 'WRITER_CHANGED', message: '当前场次已由另一设备接管，本地记录已保留' });
    this.state.acceptedThroughSeq = status.acceptedThroughSeq; this.state.appliedThroughSeq = status.appliedThroughSeq;
    this.state.pending = this.state.pending.filter(b => b.payload.lastSeq > status.appliedThroughSeq); this.persist();
    if (status.blocked) throw new Error('云端批次处理阻塞，需要查看后台错误');
    return { ...status, localChanges: this.state.changes.length, pendingBatches: this.state.pending.length, saved: this.state.changes.length || this.state.pending.length ? 'SYNCING' : 'SYNCED' };
  }
  async waitApplied(timeoutMs = 60000) {
    await this.sync(); const target = this.state.nextSeq - 1, until = Date.now() + timeoutMs;
    while (Date.now() < until) { const status = await this.status(); if (status.appliedThroughSeq >= target) return status; await sleep(250); }
    throw new Error('云端同步超时，本机记录已保留');
  }
  async takeover(sessionId) {
    if (this.state && (this.state.changes.length || this.state.pending.length)) throw new Error('本设备有未同步数据，不能直接覆盖');
    const requestId = randomUUID();
    let data = await this.request(`/practice/sessions/${sessionId}/takeover`, 'POST', { requestId, writerId: this.device });
    const until = Date.now() + 60000;
    while (data.ingressState === 'HANDOVER') {
      if (Date.now() > until) throw new Error('接管仍在等待同步，请查询场次状态');
      await sleep(250); data = await this.request(`/practice/sessions/${sessionId}/takeover`, 'POST', { requestId, writerId: this.device });
    }
    this.state = { schemaVersion: 1, sessionId, package: data.package, mode: data.mode, writerEpoch: data.writerEpoch, answers: Object.fromEntries(Object.entries(data.snapshot.answers).map(([k,v]) => [k, { answer: v.answer, ...(data.mode === 'PRACTICE' ? { evaluation: v.evaluation, awardedScore: v.awardedScore } : grade(data.package.items.find(i => i.itemId === k), v.answer)) }])), flags: data.snapshot.flags, currentItemId: data.snapshot.currentItemId, changes: [], pending: [], nextSeq: data.acceptedThroughSeq + 1, acceptedThroughSeq: data.acceptedThroughSeq, appliedThroughSeq: data.appliedThroughSeq, offline: false, frozen: false, lastSyncAt: Date.now(), startedAt: Date.parse(data.createdAt), deadlineAt: data.mode === 'TEST' ? Date.parse(data.createdAt) + data.timeLimitSeconds * 1000 : null, finishIntent: null };
    this.persist(); return data;
  }
  makeResult() {
    const items = this.state.package.items.map(item => ({ itemId: item.itemId, ...(this.state.answers[item.itemId] ?? { answer: null, evaluation: 'UNANSWERED', awardedScore: '0.00' }) }));
    const correct = items.filter(i => i.evaluation === 'CORRECT').length, wrong = items.filter(i => i.evaluation === 'WRONG').length;
    return { items, completedAt: new Date(this.state.deadlineAt && Date.now() >= this.state.deadlineAt ? this.state.deadlineAt : Date.now()).toISOString(), summary: { total: items.length, answered: correct + wrong, correct, wrong, unanswered: items.length - correct - wrong, score: (items.reduce((a,i) => a + Math.round(Number(i.awardedScore)*100),0)/100).toFixed(2), maxScore: this.state.package.items.reduce((a,i) => a + Number(i.maxScore),0).toFixed(2) } };
  }
  freeze() { this.requireState(); if (!this.state.finishIntent) { this.state.frozen = true; this.state.finishIntent = { requestId: randomUUID(), result: this.makeResult() }; this.persist(); } return this.state.finishIntent; }
  async finish(timeoutMs = 60000) {
    this.freeze();
    if (this.state.offline) return { status: 'LOCAL_COMPLETED', result: this.state.finishIntent.result };
    await this.sync();
    const intent = this.state.finishIntent;
    intent.finalSeq ??= this.state.nextSeq - 1; this.persist();
    await this.request(`/practice/sessions/${this.state.sessionId}/finish`, 'POST', { ...intent, writerId: this.device, writerEpoch: this.state.writerEpoch });
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const result = await this.request(`/practice/sessions/${this.state.sessionId}/result`);
      if (result.status === 'FINISH_REJECTED') throw new Error('最终结果与云端作答不一致');
      if (result.status === 'COMPLETED') { await this.status(); this.state.completed = true; this.persist(); return result; }
      await sleep(250);
    }
    throw new Error('结果处理超时，完成意图已保存在本机');
  }
  async tick() {
    if (this.state?.deadlineAt && Date.now() >= this.state.deadlineAt && !this.state.frozen) this.freeze();
    if (this.state?.autoSyncBlocked || (this.state?.nextRetryAt && Date.now() < this.state.nextRetryAt)) return;
    if (this.state?.finishIntent && !this.state.completed && !this.state.offline) return this.finish();
    const count = this.state?.changes.filter(c => c.type.startsWith('ANSWER')).length ?? 0;
    if (this.state && (count >= 10 || (this.state.changes.length && Date.now() - this.state.lastSyncAt >= 30000) || this.state.pending.some(b => !b.accepted))) return this.sync();
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const client = new Simulator({ user: process.env.SIM_USER ?? 'user-1', token: process.env.SIM_TOKEN ?? '', device: process.env.SIM_DEVICE ?? 'device-1' });
  let out;
  switch (command) {
    case 'start': out = await client.start(args[0] ?? 'PRACTICE', Number(args[1] ?? 1800)); break;
    case 'answer': out = client.answer(args[0], client.item(args[0]).type === 'TRUE_FALSE' ? { value: args[1] === 'true' } : { optionKeys: args[1].split(',') }); await client.tick(); break;
    case 'flag': client.flag(args[0], args[1] !== 'false'); out = { saved: 'LOCAL' }; break;
    case 'position': client.position(args[0]); out = { saved: 'LOCAL' }; break;
    case 'offline': client.setOffline(true); out = { offline: true }; break;
    case 'online': client.setOffline(false); out = client.state.finishIntent ? await client.finish() : await client.sync(); break;
    case 'sync': case 'pause': out = await client.sync(); break;
    case 'status': out = await client.status(); break;
    case 'restore': client.requireState(); out = { saved: 'LOCAL', sessionId: client.state.sessionId, answered: Object.keys(client.state.answers).length, pending: client.state.pending.length }; break;
    case 'takeover': out = await client.takeover(args[0]); break;
    case 'finish': out = await client.finish(); break;
    case 'watch': {
      client.requireState();
      console.log('交互模式：answer <itemId> <opt_1,opt_2|true|false> / flag <itemId> / position <itemId> / offline / online / sync / finish / exit');
      const lines = createInterface({ input: process.stdin, output: process.stdout });
      let chain = Promise.resolve();
      const interval = setInterval(() => {
        chain = chain.then(() => client.tick()).catch(e => console.error(e.message));
      }, 1000);
      try {
        for await (const line of lines) {
          const [cmd, id, value] = line.trim().split(/\s+/);
          if (cmd === 'exit') break;
          chain = chain.then(async () => {
            if (cmd === 'answer') { console.log(client.answer(id, client.item(id).type === 'TRUE_FALSE' ? { value: value === 'true' } : { optionKeys: value.split(',') })); await client.tick(); }
            else if (cmd === 'flag') client.flag(id);
            else if (cmd === 'position') client.position(id);
            else if (cmd === 'offline') client.setOffline(true);
            else if (cmd === 'online') { client.setOffline(false); console.log(await client.tick() ?? await client.sync()); }
            else if (cmd === 'sync') console.log(await client.sync());
            else if (cmd === 'finish') console.log(await client.finish());
            else console.log('不支持的交互命令');
          }).catch(e => console.error(e.message));
          await chain;
        }
      } finally { clearInterval(interval); lines.close(); await chain; try { await client.sync(); } catch(e) { console.error(e.message); } }
      out = { saved: 'LOCAL' }; break;
    }
    default: throw new Error('命令: start answer flag position offline online sync pause status restore takeover finish watch');
  }
  console.log(JSON.stringify(out, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const user = process.env.SIM_USER ?? 'user-1', device = process.env.SIM_DEVICE ?? 'device-1';
  const lockStore = new Store(user, device), lock = `${lockStore.path}.lock`;
  let fd;
  try {
    if (existsSync(lock)) {
      const pid = Number(readFileSync(lock,'utf8'));
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('本地锁文件无效，请检查后移除');
      try { process.kill(pid,0); throw new Error('该模拟设备已由另一进程使用'); }
      catch(e) { if (e.code === 'ESRCH') unlinkSync(lock); else throw e; }
    }
    fd = openSync(lock, 'wx', 0o600); writeFileSync(fd,String(process.pid)); await main();
  }
  catch(e) { console.error(e.message); process.exitCode = 1; }
  finally { if (fd !== undefined) { closeSync(fd); unlinkSync(lock); } }
}
