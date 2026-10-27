import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { environment, apiRoot } from '../scripts/dev.mjs';
import { Simulator, sleep, ApiError } from './simulator.mjs';
Object.assign(process.env, environment());
const tokens = new Map(process.env.QANDA_TEST_TOKENS.split(',').map(pair => pair.split(':')));
const runId = randomUUID(), root = resolve(apiRoot, 'client/.state', runId);
mkdirSync(root, { recursive: true });
function client(user, device) {
  assert(tokens.has(user), `缺少 ${user} 的测试身份`);
  return new Simulator({ user, device, token: tokens.get(user), root });
}
const report = { runId, startedAt: new Date().toISOString(), checks: [], clients: 0 };
async function acceptance() {
  const a = client('user-1','a'); await a.start(); a.setOffline(true);
  for (const item of a.state.package.items.slice(0, 5)) a.answer(item.itemId, item.answer);
  a.flag('item-001'); a.position('item-006');
  const restored = client('user-1','a'); assert.equal(Object.keys(restored.state.answers).length, 5);
  assert.equal(readFileSync(restored.store.path, 'utf8').includes('同步验收'), false);
  restored.setOffline(false); restored.buildBatch();
  const payload = structuredClone(restored.state.pending[0].payload);
  const endpoint = `/practice/sessions/${restored.state.sessionId}/sync-batches`;
  await restored.request(endpoint, 'POST', payload); await restored.request(endpoint, 'POST', payload);
  await restored.waitApplied();
  let cloud = await restored.request(`/practice/sessions/${restored.state.sessionId}`);
  assert.equal(Object.keys(cloud.snapshot.answers).length, 5); assert.equal(cloud.snapshot.flags['item-001'], true);
  assert.equal(cloud.snapshot.currentItemId, 'item-006'); report.checks.push('加密保存、客户端重启、断网补传、重复批次、标记与位置');
  const stranger = client('user-2','stranger');
  await assert.rejects(stranger.request(`/practice/sessions/${restored.state.sessionId}`), e => e instanceof ApiError && e.status === 404);
  const b = client('user-1','b'); await b.takeover(restored.state.sessionId);
  restored.answer('item-006', restored.item('item-006').answer);
  await assert.rejects(restored.sync(), e => e.code === 'WRITER_CHANGED');
  for (const item of b.state.package.items.slice(5)) b.answer(item.itemId, item.answer);
  const result = await b.finish(); assert.equal(result.result.summary.correct, 20); assert.equal(result.source, 'CLIENT_REPORTED');
  cloud=await b.request(`/practice/sessions/${b.state.sessionId}`);
  for(const [id,local] of Object.entries(b.state.answers)) {
    assert.deepEqual(cloud.snapshot.answers[id].answer,local.answer);
    assert.equal(cloud.snapshot.answers[id].evaluation,local.evaluation);
    assert.equal(cloud.snapshot.answers[id].awardedScore,local.awardedScore);
  }
  assert.deepEqual(cloud.snapshot.flags,b.state.flags);assert.equal(cloud.snapshot.currentItemId,b.state.currentItemId);
  const again = await b.finish(); assert.deepEqual(again, result); report.checks.push('身份隔离、接管、旧端隔离、20题结果、完成重试');
  const t = client('user-2','test'); await t.start('TEST', 1); t.setOffline(true);
  const first = t.state.package.items[0]; t.answer(first.itemId, first.answer);
  await sleep(1100); await t.tick(); assert.equal(t.state.frozen, true);
  const delayed = client('user-2','test'); delayed.setOffline(false);
  const late = await delayed.finish(); assert.equal(late.result.summary.correct, 1); report.checks.push('本地到时冻结、完成意图恢复、到时后补传');
  const bad = client('user-2','bad-summary'); await bad.start(); bad.answer('item-001', bad.item('item-001').answer); await bad.waitApplied();
  const invalid = bad.freeze().result; invalid.summary.correct = 2;
  await assert.rejects(bad.request(`/practice/sessions/${bad.state.sessionId}/finish`, 'POST', { requestId: randomUUID(), writerId: bad.device, writerEpoch: bad.state.writerEpoch, finalSeq: bad.state.nextSeq-1, result: invalid }), e => e.code === 'INCONSISTENT_SUMMARY');
  report.checks.push('错误汇总拒绝');
  invalid.summary.correct=1;invalid.items[0].answer={optionKeys:['opt_2']};
  const rejected=await bad.request(`/practice/sessions/${bad.state.sessionId}/finish`,'POST',{requestId:randomUUID(),writerId:bad.device,writerEpoch:bad.state.writerEpoch,finalSeq:bad.state.nextSeq-1,result:invalid});
  assert.equal(rejected.status,'FINISH_REJECTED');
  invalid.items[0].answer=bad.state.answers['item-001'].answer;
  assert.equal((await bad.finish()).status,'COMPLETED');report.checks.push('逐题快照不一致拒绝，修正后重新完成');
  report.clients = 6;
}
async function load(count) {
  assert(Number.isInteger(count) && count >= 1 && count <= 100, '并发客户端数必须为1到100');
  const clients = Array.from({ length: count }, (_,i) => client(`user-${i+1}`, `load-${i}`));
  const start = performance.now();
  await Promise.all(clients.map(async c => {
    await c.start();
    for (const [i,item] of c.state.package.items.entries()) { c.answer(item.itemId,item.answer); if ((i+1)%10 === 0) await c.sync(); }
  }));
  const finishStart = performance.now();
  const results = await Promise.all(clients.map(c => c.finish(120000)));
  results.forEach(r => { assert.equal(r.status,'COMPLETED'); assert.equal(r.result.summary.correct,20); });
  await Promise.all(clients.map(async c => {
    const cloud = await c.request(`/practice/sessions/${c.state.sessionId}`);
    assert.equal(cloud.acceptedThroughSeq,20);assert.equal(cloud.appliedThroughSeq,20);assert.equal(Object.keys(cloud.snapshot.answers).length,20);
  }));
  const times = clients.flatMap(c => c.metrics.latenciesMs).sort((a,b)=>a-b);
  report.clients=count; report.questions=count*20;report.requests=clients.reduce((a,c)=>a+c.metrics.requests,0);
  report.sessionIds=clients.map(c=>c.state.sessionId);
  report.uploadRequests=clients.reduce((a,c)=>a+c.metrics.uploadRequests,0);
  report.totalMs=Math.round(performance.now()-start);report.concentratedFinishMs=Math.round(performance.now()-finishStart);
  report.httpP95Ms=Math.round(times[Math.floor(times.length*0.95)]);
  report.checks.push('所有场次完成，全部操作序号已应用，答案数一致，积压排空');
}
try {
  const command = process.argv[2] ?? 'acceptance';
  if (command === 'acceptance') await acceptance();
  else if (command === 'load') await load(Number(process.argv[3] ?? 100));
  else throw new Error('命令: acceptance 或 load [1-100]');
  report.passed=true;
} catch(e) { report.passed=false;report.error=e.message;process.exitCode=1; }
report.finishedAt=new Date().toISOString();
const dir=resolve(apiRoot,'client/reports');mkdirSync(dir,{recursive:true});
writeFileSync(resolve(dir,`${runId}.json`),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
