import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {freshSandbox,parseSandbox,submitRequest,taskAction,updateStock,verifyStock,addStock,setAvailability} from '../public/sandbox-model.js';
import handler from '../api/index.mjs';
import {serveSandbox} from '../lib/sandbox-static.mjs';
const input={name:'Test resident',category:'water',quantity:10,place:'school',confirmed:true};
test('sandbox supports request, matching, pickup, handover and independent receipt without double reservation',()=>{
 const initial=freshSandbox(),s=submitRequest(initial,input),a=s.assignments[0];
 assert.ok(a);assert.equal(s.requests[0].status,'awaiting_volunteer');assert.equal(s.resources.find(r=>r.id===a.resourceId).quantity,110);
 assert.equal(initial.resources[0].quantity,120);assert.equal(initial.assignments.length,0);
 assert.throws(()=>taskAction(s,a.id,'receipt'),/preceding step/);
 const accepted=taskAction(s,a.id,'accept');assert.equal(accepted.resources[0].quantity,110);
 const pickup=taskAction(accepted,a.id,'pickup'),handover=taskAction(pickup,a.id,'handover');
 assert.equal(handover.requests[0].status,'awaiting_receipt');assert.equal(handover.assignments[0].status,'handover_reported');
 const complete=taskAction(handover,a.id,'receipt');assert.equal(complete.requests[0].status,'complete');assert.equal(complete.resources[0].quantity,110);
 assert.throws(()=>taskAction(complete,a.id,'receipt'),/preceding step/);
});
test('sandbox urgent and duplicate requests stay out of automatic assignment',()=>{
 const medical=submitRequest(freshSandbox(),{...input,category:'medical'});assert.equal(medical.requests[0].status,'needs_review');assert.equal(medical.assignments.length,0);
 const first=submitRequest(freshSandbox(),input),duplicate=submitRequest(first,input);assert.equal(duplicate.requests[0].status,'needs_review');assert.equal(duplicate.assignments.length,1);
});
test('sandbox capacity, unavailable volunteers and insufficient verified stock constrain offers',()=>{
 assert.equal(submitRequest(freshSandbox(),{...input,quantity:100}).assignments.length,0);
 let s=setAvailability(setAvailability(freshSandbox(),'V1',false),'V2',false);s=submitRequest(s,input);assert.equal(s.assignments.length,0);s=setAvailability(s,'V1',true);assert.equal(s.assignments.length,1);
 let low=updateStock(freshSandbox(),'S1',5);low=verifyStock(low,'S1');low=submitRequest(low,input);assert.equal(low.assignments.length,0);
 low=verifyStock(low,'S3');assert.equal(low.assignments.length,1);assert.equal(low.assignments[0].resourceId,'S3');
});
test('sandbox supplier edits require verification and cannot change active reserved stock',()=>{
 const s=submitRequest(freshSandbox(),input),a=s.assignments[0];assert.throws(()=>updateStock(s,a.resourceId,500),/reserved/);assert.throws(()=>setAvailability(s,a.volunteerId,false),/active task/);
 const changed=updateStock(freshSandbox(),'S1',50);assert.equal(changed.resources[0].verification,'reported');assert.equal(submitRequest(changed,input).assignments.length,0);
 const added=addStock(freshSandbox(),{name:'Demo meals',category:'food',quantity:12});assert.equal(added.resources[0].verification,'reported');assert.equal(added.resources[0].unit,'meals');
});
test('sandbox sessions restore valid demo state and reset malformed or oversized content',()=>{
 const s=submitRequest(freshSandbox(),input);assert.deepEqual(parseSandbox(JSON.stringify(s)),s);assert.deepEqual(parseSandbox('bad json'),freshSandbox());assert.deepEqual(parseSandbox(JSON.stringify({version:1})),freshSandbox());assert.deepEqual(parseSandbox('x'.repeat(250001)),freshSandbox());
 assert.throws(()=>submitRequest(freshSandbox(),{...input,confirmed:false}),/Confirm/);assert.throws(()=>submitRequest(freshSandbox(),{...input,quantity:-5}),/quantity/);
});
function response(){return {status:0,headers:{},body:'',writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body?.toString()||'';}};}
test('production sandbox routes work without DATABASE_URL and reject server mutations',async()=>{
 const old=process.env.DATABASE_URL;delete process.env.DATABASE_URL;
 try{
  for(const path of ['/sandbox','/sandbox?org=real-private-workspace','/sandbox.html','/sandbox.js','/sandbox-model.js','/sandbox-voice.js','/sandbox-intake.js','/sandbox.css','/favicon.svg']){const res=response();await handler({url:path,method:'GET'},res);assert.equal(res.status,200,path);assert.match(res.headers['Content-Security-Policy'],/connect-src 'none'/);assert.match(res.headers['Content-Security-Policy'],/media-src blob:/);assert.ok(res.body.length);assert.equal(res.headers['Set-Cookie'],undefined);}
  const post=response();await handler({url:'/sandbox',method:'POST'},post);assert.equal(post.status,405);
  const head=response();await handler({url:'/sandbox',method:'HEAD'},head);assert.equal(head.status,200);assert.equal(head.body,'');
  assert.equal(await serveSandbox({url:'/.env',method:'GET'},response()),false);
 }finally{if(old!==undefined)process.env.DATABASE_URL=old;}
});
test('sandbox frontend has no production client imports, API calls or provider connections',async()=>{
 for(const file of ['sandbox.js','sandbox-model.js','sandbox-voice.js','sandbox-intake.js']){const source=await readFile(new URL(`../public/${file}`,import.meta.url),'utf8');assert.doesNotMatch(source,/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/);assert.doesNotMatch(source,/from ['"].*(?:platform|members|community|app|postgres-state|vaani)\./);}
 const source=await readFile(new URL('../public/sandbox.js',import.meta.url),'utf8');assert.match(source,/relay_voice_sandbox_v2/);assert.match(source,/addEventListener\('storage'/);assert.doesNotMatch(source,/(localStorage\.clear|sessionStorage\.clear)/);
 const html=await readFile(new URL('../public/sandbox.html',import.meta.url),'utf8');assert.match(html,/connect-src 'none'/);assert.match(html,/Real recording/);assert.match(html,/no real calls/);
});
