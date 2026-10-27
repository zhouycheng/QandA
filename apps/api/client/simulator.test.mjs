import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Store, Simulator, grade } from './simulator.mjs';

const root = resolve(import.meta.dirname, '.state', 'unit');
mkdirSync(root, { recursive: true });
process.env.SIM_KEY = randomBytes(32).toString('hex');
function isolated() { return mkdtempSync(resolve(root, 'test-')); }
const item = { itemId: 'i', type: 'SINGLE_CHOICE', maxScore: '1.00', answer: { optionKeys: ['a'] }, options: [{ key: 'a' }, { key: 'b' }] };
function state() { return { package: { items: [item] }, mode: 'PRACTICE', sessionId: 's', writerEpoch: 1, answers: {}, flags: {}, changes: [], pending: [], nextSeq: 1, acceptedThroughSeq: 0, appliedThroughSeq: 0, offline: true, frozen: false, lastSyncAt: Date.now() }; }

test('encrypted atomic persistence restores state and detects tampering', () => {
  const dir = isolated();
  try {
    const store = new Store('u', 'd', dir); store.write({ secret: 'private-answer' });
    assert.equal(readFileSync(store.path, 'utf8').includes('private-answer'), false);
    assert.deepEqual(new Store('u', 'd', dir).read(), { secret: 'private-answer' });
    assert.equal(new Store('other-user', 'd', dir).read(), null);
    const original = process.env.SIM_KEY; process.env.SIM_KEY = randomBytes(32).toString('hex');
    assert.throws(() => new Store('u', 'd', dir).read()); process.env.SIM_KEY = original;
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('offline confirmed answer survives client restart and remains immutable', async () => {
  const dir = isolated();
  try {
    const client = new Simulator({ user: 'u', device: 'd', token: '', root: dir }); client.state = state(); client.persist();
    assert.equal(client.answer('i', { optionKeys: ['b'] }).evaluation, 'WRONG');
    assert.throws(() => client.answer('i', { optionKeys: ['a'] }), /锁定/);
    const restarted = new Simulator({ user: 'u', device: 'd', token: '', root: dir });
    assert.equal(restarted.state.answers.i.evaluation, 'WRONG'); assert.equal(restarted.state.changes.length, 1);
    const result = await restarted.finish(); assert.equal(result.status, 'LOCAL_COMPLETED');
    assert.equal(result.result.summary.score, '0.00'); assert.equal(result.result.summary.wrong, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('request failure keeps exactly the same pending batch for retry', async () => {
  const dir = isolated();
  try {
    const c = new Simulator({ user: 'u', device: 'd', token: '', root: dir }); c.state = state();
    c.answer('i', { optionKeys: ['a'] }); c.setOffline(false);
    let first;
    c.request = async (_,method,body) => { first ??= structuredClone(body); throw new Error('network failure'); };
    await assert.rejects(c.sync()); await assert.rejects(c.sync());
    assert.equal(c.state.pending.length, 1); assert.deepEqual(c.state.pending[0].payload, first);
    const restarted = new Simulator({ user: 'u', device: 'd', token: '', root: dir }); assert.deepEqual(restarted.state.pending[0].payload, first);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('test mode hides feedback, freezes at local deadline and supports offline finish', async () => {
  const dir = isolated();
  try {
    const c = new Simulator({ user: 'u', device: 'd', token: '', root: dir }); c.state = { ...state(), mode: 'TEST', deadlineAt: Date.now()+10000 };
    assert.deepEqual(c.answer('i', { optionKeys: ['a'] }), { saved: 'LOCAL' });
    c.state.deadlineAt = Date.now()-1; await c.tick();
    assert.equal(c.state.frozen, true); assert.throws(() => c.answer('i', { optionKeys: ['b'] }));
    assert.throws(() => c.flag('i')); assert.throws(() => c.position('i'));
    assert.equal((await c.finish()).result.summary.correct, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('takeover retains the first practice verdict and blocks replacing pending completion', async () => {
  const dir=isolated();
  try {
    const c=new Simulator({user:'u',device:'d',token:'',root:dir});
    c.request=async()=>({package:{items:[item]},mode:'PRACTICE',writerEpoch:2,acceptedThroughSeq:1,appliedThroughSeq:1,createdAt:new Date().toISOString(),snapshot:{answers:{i:{answer:{optionKeys:['b']},evaluation:'CORRECT',awardedScore:'1.00'}},flags:{},currentItemId:'i'}});
    await c.takeover('s');assert.equal(c.state.answers.i.evaluation,'CORRECT');
    c.freeze();await assert.rejects(c.start(),/完成意图/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('objective grading handles unordered multiple choice and booleans', () => {
  assert.equal(grade({ type: 'MULTIPLE_CHOICE', answer: { optionKeys: ['a','b'] }, maxScore: '2.00' }, { optionKeys: ['b','a'] }).awardedScore, '2.00');
  assert.equal(grade({ type: 'TRUE_FALSE', answer: { value: true }, maxScore: '1.00' }, { value: false }).evaluation, 'WRONG');
});
test('time and quantity trigger batching while unchanged state sends no requests',async()=>{
  const dir=isolated();
  try {
    const c=new Simulator({user:'u',device:'d',token:'',root:dir});c.state=state();c.state.offline=false;
    let requests=0,uploads=0,seq=0;
    c.request=async(_,method,body)=>{requests++;if(method==='POST'){uploads++;seq=body.lastSeq;}return {writerEpoch:1,acceptedThroughSeq:seq,appliedThroughSeq:seq};};
    c.answer('i',{optionKeys:['a']});await c.tick();assert.equal(uploads,0);
    c.state.lastSyncAt=Date.now()-30001;await c.tick();assert.equal(uploads,1);
    const previous=requests;await c.tick();assert.equal(requests,previous);
    c.state.package.items=Array.from({length:10},(_,i)=>({...item,itemId:`next-${i}`}));
    for(const next of c.state.package.items){c.answer(next.itemId,next.answer);await c.tick();}
    assert.equal(uploads,2);assert.equal(seq,11);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
