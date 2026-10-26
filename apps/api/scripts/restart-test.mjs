import { spawn } from 'node:child_process';
import { openSync, closeSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { environment, apiRoot } from './dev.mjs';
import { Simulator, sleep } from '../client/simulator.mjs';
const env=environment();Object.assign(process.env,env);
const token=new Map(env.QANDA_TEST_TOKENS.split(',').map(p=>p.split(':'))).get('user-1');
let child, closed;
const log=resolve(apiRoot,'.runtime/restart-test.log');
async function start(paused, crashPoint='') {
  const fd=openSync(log,'a',0o600);
  child=spawn(resolve(env.JAVA_HOME,'bin/java'),['-Xmx512m','-jar','build/libs/qanda-sync-api-0.1.0.jar','--spring.profiles.active=test',`--qanda.dispatch-enabled=${!paused}`,`--spring.rabbitmq.listener.simple.auto-startup=${!paused}`,`--qanda.test-crash-point=${crashPoint}`],{cwd:apiRoot,env:{...env,API_PORT:'8082'},stdio:['ignore',fd,fd]});
  closeSync(fd);closed=new Promise(resolve=>child.once('exit',resolve));
  const until=Date.now()+60000;
  while(Date.now()<until) {
    if(child.exitCode!==null){if(crashPoint)return;throw new Error(`后端退出，请查看 ${log}`);}
    try { const r=await fetch('http://127.0.0.1:8082/api/v1/practice/sessions/00000000-0000-4000-8000-000000000000',{signal:AbortSignal.timeout(1000)});if(r.status===401)return; } catch {}
    await sleep(250);
  }
  throw new Error(`后端启动超时，请查看 ${log}`);
}
async function stop() { if(child && child.exitCode===null){child.kill('SIGTERM');await closed;} }
try {
  await start(true);
  const a=new Simulator({user:'user-1',device:`restart-${Date.now()}`,token,baseUrl:'http://127.0.0.1:8082/api/v1'});
  await a.start();for(const item of a.state.package.items.slice(0,5))a.answer(item.itemId,item.answer);
  const before=await a.sync();assert.equal(before.acceptedThroughSeq,5);assert.equal(before.appliedThroughSeq,0);
  await stop();await start(false);
  const restored=new Simulator({user:a.user,device:a.device,token,baseUrl:a.baseUrl});
  await restored.waitApplied();const result=await restored.finish();assert.equal(result.result.summary.correct,5);
  await stop();
  const checks=['持久接收后重启，恢复投递、消费和本地客户端'];
  for(const [point,code,applied] of [['before-commit',91,0],['after-commit',92,5]]) {
    await start(true);
    const c=new Simulator({user:'user-1',device:`${point}-${Date.now()}`,token,baseUrl:a.baseUrl});
    await c.start();for(const item of c.state.package.items.slice(0,5))c.answer(item.itemId,item.answer);
    await c.sync();await stop();await start(false,point);
    let timer;
    const exit=await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Worker 故障点未触发')),30000);})]).finally(()=>clearTimeout(timer));
    assert.equal(exit,code);
    await start(true);
    const recovered=new Simulator({user:c.user,device:c.device,token,baseUrl:c.baseUrl});
    assert.equal((await recovered.status()).appliedThroughSeq,applied);
    await stop();await start(false);
    await recovered.waitApplied();assert.equal((await recovered.finish()).result.summary.correct,5);
    checks.push(`${point}: 强制退出后重启，正确恢复且未重复应用`);await stop();
  }
  const report={passed:true,checks};
  writeFileSync(resolve(apiRoot,'.runtime/restart-result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally { await stop(); }
