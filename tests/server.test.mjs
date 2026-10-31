import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { createApp } from '../server.mjs';
import { createServer } from 'node:http';

async function app(t, extra={}) {
  const instance=createApp({HOST:'127.0.0.1',DEMO_MODE:'false',DATABASE_PATH:':memory:',ADMIN_PASSWORD:'test-admin',TOOL_API_KEY:'test-tool',WEBHOOK_SECRET:'test-webhook',...extra});
  instance.server.listen(0,'127.0.0.1');await once(instance.server,'listening');
  t.after(async()=>{instance.server.closeAllConnections();await new Promise(r=>instance.server.close(r));});
  const base=`http://127.0.0.1:${instance.server.address().port}`;
  return {...instance,base,fetch:(path,init={})=>fetch(base+path,init)};
}
test('live workspace starts empty and coordinator routes require a session',async t=>{
  const a=await app(t);
  assert.equal((await a.fetch('/api/state')).status,401);
  const loggedIn=await a.fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'test-admin'})});
  assert.equal(loggedIn.status,200);const cookie=loggedIn.headers.get('set-cookie').split(';')[0];
  const state=await (await a.fetch('/api/state',{headers:{Cookie:cookie}})).json();assert.equal(state.requests.length,0);
  const config=await (await a.fetch('/api/config',{headers:{Cookie:cookie}})).json();assert.equal(JSON.stringify(config).includes('test-admin'),false);
  const cross=await a.fetch('/api/action',{method:'POST',headers:{Cookie:cookie,Origin:'https://bad.example','Content-Type':'application/json'},body:'{}'});assert.equal(cross.status,403);
});
test('tool authentication is independent of admin sessions; errors do not create records',async t=>{
  const a=await app(t); const body={name:'Resident',location:'School',category:'water',quantity:4,unit:'litres',people:2,priority:'normal',action_id:'live-action'};
  assert.equal((await a.fetch('/api/tools/create_request',{method:'POST',body:JSON.stringify(body)})).status,401);
  const headers={'Authorization':'Bearer test-tool','Content-Type':'application/json'};
  const response=await a.fetch('/api/tools/create_request',{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.request.status,'new');
  const retry=await (await a.fetch('/api/tools/create_request',{method:'POST',headers,body:JSON.stringify(body)})).json();assert.equal(retry.request.id,result.request.id);
  const missing=await a.fetch('/api/tools/create_request',{method:'POST',headers,body:JSON.stringify({...body,quantity:-1,action_id:'invalid'})});assert.equal(missing.status,400);
  assert.equal(a.store.list('requests').length,1);
});
test('webhooks require authentication and persist real provider postprocessing format',async t=>{
  const a=await app(t);const payload=JSON.stringify({event:'call_postprocessing',call_id:'provider-test',data:{call_duration:5000,transcript:'Caller: Need water',summary:'Needs water'}});
  assert.equal((await a.fetch('/api/webhooks/vaani',{method:'POST',body:payload})).status,401);
  assert.equal((await a.fetch('/api/webhooks/vaani',{method:'POST',headers:{Authorization:'Bearer test-webhook'},body:payload})).status,200);
  assert.equal(a.store.get('calls','provider-test').durationSeconds,5);
});
test('optional HMAC authenticates exact bytes, not parsed JSON',async t=>{
  const a=await app(t,{VAANI_WEBHOOK_AUTH:'hmac-sha256'});const raw='{ "event": "call_started", "room_name": "signed-call" }';
  const signature=createHmac('sha256','test-webhook').update(raw).digest('hex');
  assert.equal((await a.fetch('/api/webhooks/vaani',{method:'POST',headers:{'x-vaani-signature':signature},body:raw})).status,200);
  assert.equal((await a.fetch('/api/webhooks/vaani',{method:'POST',headers:{'x-vaani-signature':signature},body:raw+' '})).status,401);
});
test('live mode rejects authored demo mutations',async t=>{
  const a=await app(t);const login=await a.fetch('/api/login',{method:'POST',body:JSON.stringify({password:'test-admin'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.equal((await a.fetch('/api/demo/step',{method:'POST',headers:{Cookie:cookie},body:JSON.stringify({scenario:'water',step:0})})).status,403);
});
test('unsafe public startup is rejected rather than exposing an unauthenticated workspace',()=>{
  assert.throws(()=>createApp({HOST:'0.0.0.0',DEMO_MODE:'true'}),/requires/);
  assert.throws(()=>createApp({HOST:'127.0.0.1',DEMO_MODE:'true',PUBLIC_BASE_URL:'https://example.com'}),/requires/);
});
test('public member cookies never authorize coordinator routes and logout revokes member access',async t=>{
  const a=await app(t,{DEMO_MODE:'true'}),post=(path,data,headers={})=>a.fetch(path,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  assert.equal((await a.fetch('/join.html')).status,200);assert.equal((await a.fetch('/api/members/me')).status,401);
  assert.equal((await a.fetch('/volunteer/sign-in')).status,200);assert.equal((await a.fetch('/volunteer/sign-up')).status,200);assert.equal((await a.fetch('/coordinator/sign-in')).status,200);
  assert.equal((await (await a.fetch('/volunteer/sign-in')).text()).includes('Coordinator workspace'),false);
  const input={name:'Test helper',phone:'+15555550180',password:'test-member-password',role:'both',consent:true};
  const signup=await (await post('/api/members/signup',input)).json();
  assert.equal((await post('/api/members/verify',{accountId:signup.accountId,code:signup.developmentCode})).status,200);
  const login=await post('/api/members/login',input);assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie');assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);
  const headers={Cookie:cookie.split(';')[0]};assert.equal((await a.fetch('/api/members/me',{headers})).status,200);
  assert.equal((await a.fetch('/api/state',{headers})).status,401);
  assert.equal((await post('/api/dispatch/policy',{enabled:true},headers)).status,401);
  assert.equal((await post('/api/members/profile',{location:'Depot',locationConsent:true},{...headers,Origin:'https://bad.example'})).status,403);
  await post('/api/members/logout',{},headers);assert.equal((await a.fetch('/api/members/me',{headers})).status,401);
});
test('loopback demo coordinator still requires a separate coordinator sign-in',async t=>{
  const a=await app(t,{DEMO_MODE:'true',ADMIN_PASSWORD:''});
  assert.equal((await a.fetch('/api/state')).status,401);
  const publicAccess=await (await a.fetch('/api/coordinator/access')).json();assert.equal(publicAccess.demoLogin,'relay-demo-coordinator');
  const login=await a.fetch('/api/login',{method:'POST',body:JSON.stringify({password:publicAccess.demoLogin})});
  const headers={Cookie:login.headers.get('set-cookie').split(';')[0]};
  assert.equal((await a.fetch('/api/state',{headers})).status,200);assert.equal((await a.fetch('/api/members/me',{headers})).status,401);
  assert.equal((await a.fetch('/api/dispatch/link?id=unused',{headers})).status,404);
});
test('real callback adapter uses documented Vaani fields and records dispatch, not completion',async t=>{
  let received;
  const provider=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    received={url:req.url,key:req.headers['x-api-key'],body:JSON.parse(raw)};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:true,output:{call_id:'provider-dispatched'}}));
  });
  provider.listen(0,'127.0.0.1');await once(provider,'listening');
  t.after(async()=>{provider.closeAllConnections();await new Promise(r=>provider.close(r));});
  const a=await app(t,{VAANI_API_KEY:'provider-key',VAANI_AGENT_ID:'agent-test',VAANI_BASE_URL:`http://127.0.0.1:${provider.address().port}`});
  const login=await a.fetch('/api/login',{method:'POST',body:JSON.stringify({password:'test-admin'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const result=await a.fetch('/api/calls/dispatch',{method:'POST',headers:{Cookie:cookie},body:JSON.stringify({name:'Consented caller',phone:'+10000000099',consent:true})});
  assert.equal(result.status,200);assert.equal(received.url,'/api/trigger-call/');
  assert.equal(received.body.contact_number,'+10000000099');assert.equal(received.body.name,'Consented caller');assert.equal(received.key,'provider-key');
  assert.equal(a.store.get('calls','provider-dispatched').status,'dispatched');
  assert.equal(received.body.dnd_check_skipped,undefined);
});
