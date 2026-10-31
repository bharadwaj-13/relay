import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createApp} from '../server.mjs';
import {createVoiceProxy} from '../lib/voice-proxy.mjs';

async function start(t,server){server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});return `http://127.0.0.1:${server.address().port}`;}
test('voice proxy never exposes dashboards, accounts, exports, task links or arbitrary tools',async t=>{
  const env={DEMO_MODE:'true',TOOL_API_KEY:'proxy-test-tool',WEBHOOK_SECRET:'proxy-test-hook'};
  const app=createApp({...env,ADMIN_PASSWORD:'admin-test',DATABASE_PATH:':memory:'}),upstream=await start(t,app.server);
  const base=await start(t,createVoiceProxy({...env,RELAY_LOCAL_ORIGIN:upstream}));
  for(const path of ['/','/coordinator/','/volunteer/','/api/state','/api/export','/api/login','/api/members/me','/api/volunteer/task','/api/tools/verify_resource'])assert.equal((await fetch(base+path)).status,404);
  assert.equal((await fetch(base+'/api/tools/verify_resource',{method:'POST',headers:{Authorization:'Bearer proxy-test-tool'},body:'{}'})).status,404);
  assert.equal((await fetch(base+'/api/health')).status,200);
  assert.equal((await fetch(base+'/api/voice/action',{method:'POST',body:'{}'})).status,401);
  assert.equal((await fetch(base+'/api/webhooks/vaani',{method:'POST',body:'{}'})).status,401);
});
test('authenticated gateway preserves operation validation and idempotent request writes',async t=>{
  const env={DEMO_MODE:'true',TOOL_API_KEY:'proxy-test-tool',WEBHOOK_SECRET:'proxy-test-hook'};
  const app=createApp({...env,ADMIN_PASSWORD:'admin-test',DATABASE_PATH:':memory:'}),upstream=await start(t,app.server);
  const base=await start(t,createVoiceProxy({...env,RELAY_LOCAL_ORIGIN:upstream}));
  const call=(operation,args)=>fetch(base+'/api/voice/action',{method:'POST',headers:{Authorization:'Bearer proxy-test-tool','Content-Type':'application/json'},body:JSON.stringify({operation,arguments_json:typeof args==='string'?args:JSON.stringify(args)})});
  const args={action_id:'proxy-create',name:'Exercise gateway resident',phone:'+15555550189',location:'Exercise gateway school',category:'water',quantity:12,unit:'litres',people:4,priority:'normal',caller_confirmed:true};
  const created=await call('create_request',args);assert.equal(created.status,200);const request=(await created.json()).request;
  const repeated=await (await call('create_request',args)).json();assert.equal(repeated.request.id,request.id);
  const tracked=await (await call('track_my_requests',{name:args.name,phone:args.phone})).json();assert.equal(tracked.requests[0].reference,request.id);
  assert.equal((await call('verify_resource',{})).status,404);assert.equal((await call('get_call_menu','bad json')).status,400);
  assert.equal((await call('get_call_menu',{phone:args.phone,unexpected:true})).status,400);
});
test('temporary proxy refuses live mode or non-loopback upstreams',()=>{
  const env={DEMO_MODE:'true',TOOL_API_KEY:'a',WEBHOOK_SECRET:'b'};
  assert.throws(()=>createVoiceProxy({...env,DEMO_MODE:'false'}),/exercise/);
  assert.throws(()=>createVoiceProxy({...env,RELAY_LOCAL_ORIGIN:'https://external.example'}),/loopback/);
});
