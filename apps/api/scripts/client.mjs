import { environment, run } from './dev.mjs';
const env=environment();
const user=env.SIM_USER ?? 'user-1';
env.SIM_TOKEN ??= new Map((env.QANDA_TEST_TOKENS ?? '').split(',').map(p=>p.split(':'))).get(user) ?? '';
try { await run(process.execPath,['client/simulator.mjs',...process.argv.slice(2)],env); }
catch(e){console.error(e.message);process.exitCode=1;}
