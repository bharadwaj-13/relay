import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../lib/store.mjs';
import { ReliefService } from '../lib/domain.mjs';
import { invokeTool } from '../lib/tools.mjs';
import { demoStep } from '../lib/demo.mjs';
import { ingestWebhook } from '../lib/vaani.mjs';

function fixture(t, quantity = 100) {
  const store = new Store(); t.after(()=>store.close()); const service = new ReliefService(store);
  const request = service.run('create_request',{name:'Resident',phone:'+10000000010',location:'Test school',category:'water',quantity:30,people:5}).request;
  service.run('update_request',{request_id:request.id,verification:'verified'});
  const resource = service.run('add_resource',{name:'Water',category:'water',unit:'litres',quantity,location:'Depot',provider:'Test provider'}).resource;
  const volunteer = service.run('register_volunteer',{name:'Volunteer',phone:'+10000000011',location:'Depot'}).volunteer;
  const proposal = () => service.run('propose_assignment',{request_id:request.id,resource_id:resource.id,volunteer_id:volunteer.id}).assignment;
  return { store, service, request, resource, volunteer, proposal };
}
test('assignment reserves once; transitions require actual receipt; stock is consumed only once',t=>{
  const f=fixture(t), a=f.proposal();
  f.service.run('transition_assignment',{assignment_id:a.id,status:'approved',action_id:'approve-once'});
  f.service.run('transition_assignment',{assignment_id:a.id,status:'approved',action_id:'approve-once'});
  assert.equal(f.store.get('resources',f.resource.id).quantity,70);
  assert.throws(()=>f.service.run('transition_assignment',{assignment_id:a.id,status:'delivered',confirmation:'yes'}),/Cannot move/);
  f.service.run('transition_assignment',{assignment_id:a.id,status:'in_progress'});
  invokeTool(f.service,'report_assignment',{assignment_id:a.id,status:'awaiting_confirmation',action_id:'report-delivery'});
  assert.equal(f.store.get('requests',f.request.id).status,'awaiting_confirmation');
  assert.throws(()=>f.service.run('transition_assignment',{assignment_id:a.id,status:'delivered',confirmation:'yes'},'Vaani agent'),/Coordinator/);
  assert.throws(()=>f.service.run('transition_assignment',{assignment_id:a.id,status:'delivered'}),/confirmation/);
  f.service.run('transition_assignment',{assignment_id:a.id,status:'delivered',confirmation:'Resident confirmed 30 litres received.'});
  assert.equal(f.store.get('requests',f.request.id).status,'delivered');
  assert.equal(f.store.get('resources',f.resource.id).quantity,70);
  assert.equal(f.store.get('volunteers',f.volunteer.id).status,'available');
});
test('cancellation releases stock; paused volunteers remain paused; repeats cannot mint inventory',t=>{
  const f=fixture(t), a=f.proposal();
  f.service.run('transition_assignment',{assignment_id:a.id,status:'approved'});
  f.service.run('update_volunteer',{volunteer_id:f.volunteer.id,status:'paused',reason:'Access blocked'});
  assert.equal(f.store.get('requests',f.request.id).status,'needs_review');
  f.service.run('transition_assignment',{assignment_id:a.id,status:'cancelled',reason:'Access blocked',action_id:'cancel-once'});
  f.service.run('transition_assignment',{assignment_id:a.id,status:'cancelled',reason:'Access blocked',action_id:'cancel-once'});
  assert.equal(f.store.get('resources',f.resource.id).quantity,100);
  assert.equal(f.store.get('volunteers',f.volunteer.id).status,'paused');
  assert.throws(()=>f.service.run('transition_assignment',{assignment_id:a.id,status:'cancelled',reason:'again'}),/Cannot move/);
});
test('approval rechecks stock after a competing request reserves inventory',t=>{
  const f=fixture(t,50), a=f.proposal();
  const r2=f.service.run('create_request',{name:'Other resident',location:'Other school',category:'water',quantity:30,people:5}).request;
  f.service.run('update_request',{request_id:r2.id,verification:'verified'});
  const v2=f.service.run('register_volunteer',{name:'Other volunteer',phone:'+10000000012',location:'Depot'}).volunteer;
  const a2=f.service.run('propose_assignment',{request_id:r2.id,resource_id:f.resource.id,volunteer_id:v2.id}).assignment;
  f.service.run('transition_assignment',{assignment_id:a.id,status:'approved'});
  assert.throws(()=>f.service.run('transition_assignment',{assignment_id:a2.id,status:'approved'}),/Insufficient/);
  assert.equal(f.store.get('resources',f.resource.id).quantity,20);
  assert.equal(f.store.get('assignments',a2.id).status,'proposed');
});
test('agent cannot verify a caller, approve help, or add undocumented tool fields',t=>{
  const f=fixture(t),a=f.proposal();
  assert.throws(()=>f.service.run('transition_assignment',{assignment_id:a.id,status:'approved'},'Vaani agent'),/Coordinator/);
  assert.throws(()=>f.service.run('update_request',{request_id:f.request.id,verification:'verified'},'Vaani agent'),/coordinator/);
  assert.throws(()=>invokeTool(f.service,'update_request',{request_id:f.request.id,verification:'verified',action_id:'bad'}),/Unexpected field/);
  assert.throws(()=>invokeTool(f.service,'find_requests',{}),/exact name/);
  assert.throws(()=>invokeTool(f.service,'find_requests',{name:'Resident',phone:''}),/exact name/);
  const lookedUp=invokeTool(f.service,'find_requests',{name:'Resident',phone:'+10000000010'});
  assert.equal(lookedUp.requests.length,1);assert.equal(lookedUp.requests[0].phone,undefined);
});
test('idempotency preserves one record and rejects conflicting payload reuse',t=>{
  const f=fixture(t); const input={name:'A',location:'X',category:'food',quantity:2,people:2,action_id:'unique'};
  const a=f.service.run('create_request',input);const b=f.service.run('create_request',{...input});
  assert.equal(a.request.id,b.request.id);
  assert.throws(()=>f.service.run('create_request',{...input,quantity:3}),/already used/);
  assert.equal(f.store.list('requests').length,2);
});
test('possible duplicates are flagged without automatically merging separate groups',t=>{
  const f=fixture(t);const second=f.service.run('create_request',{name:'Different family',location:'Test school',category:'water',quantity:10,people:2});
  assert.equal(second.request.status,'needs_review');assert.deepEqual(second.request.duplicateCandidates,[f.request.id]);
  assert.equal(f.store.list('requests').length,2);
});
test('assigned requests cannot change the amount or destination; stale edits fail',t=>{
  const f=fixture(t),a=f.proposal();f.service.run('transition_assignment',{assignment_id:a.id,status:'approved'});
  assert.throws(()=>f.service.run('update_request',{request_id:f.request.id,quantity:40}),/Cancel the active/);
  assert.throws(()=>f.service.run('update_request',{request_id:f.request.id,location:'New address'}),/Cancel the active/);
  assert.throws(()=>f.service.run('update_request',{request_id:f.request.id,version:1,notes:'stale'}),/Refresh/);
});
test('matching enforces units and verified supply; stale proposals cannot dispatch',t=>{
  const f=fixture(t),a=f.proposal();
  f.service.run('update_request',{request_id:f.request.id,quantity:35});
  assert.throws(()=>f.service.run('transition_assignment',{assignment_id:a.id,status:'approved'}),/quantity changed/);
  f.service.run('update_request',{request_id:f.request.id,unit:'bottles'});
  assert.equal(f.service.matches(f.request.id).matches.length,0);
});
test('expired advisories do not reach the agent; shelter reports validate capacity',t=>{
  const f=fixture(t);
  f.store.put('advisories',{id:'expired',location:'Test',expiresAt:new Date(Date.now()-1000).toISOString()});
  assert.equal(invokeTool(f.service,'get_advisories',{}).advisories.length,0);
  assert.throws(()=>f.service.run('save_shelter',{name:'X',location:'X',capacity:10,occupied:11,accessible:true,source:'X',contact:'X'}),/exceed/);
});
test('demo corrections persist the corrected group size and enforce sequencing',t=>{
  const f=fixture(t);let result;
  for(let step=0;step<5;step++)result=demoStep(f.service,{scenario:'water',step,...(result?{call_id:result.call.id}:{})});
  assert.equal(f.store.get('requests',result.call.requestId).people,8);
  assert.equal(result.call.source,'simulation');
  assert.throws(()=>demoStep(f.service,{scenario:'water',step:4,call_id:result.call.id}),/sequence/);
});
test('postprocessing is idempotent, milliseconds are normalized, and late start cannot reopen call',t=>{
  const f=fixture(t);const payload={event:'call_postprocessing',call_id:'test-call',data:{room_name:'test-call',call_duration:42000,summary:'Finished',transcript:'Hello'}};
  ingestWebhook(f.store,payload);const again=ingestWebhook(f.store,payload);
  assert.equal(again.duplicate,true);assert.equal(f.store.get('calls','test-call').durationSeconds,42);
  ingestWebhook(f.store,{event:'call_started',room_name:'test-call'});
  assert.equal(f.store.get('calls','test-call').status,'completed');
});
test('voice supply offers stay out of matching until a coordinator verifies availability',t=>{
  const f=fixture(t,10);
  const offer=invokeTool(f.service,'offer_supplies',{action_id:'supply-offer',name:'Donated water',category:'water',quantity:80,unit:'litres',location:'School depot',provider:'Neighbor'});
  assert.equal(offer.resource.verification,'reported');assert.equal(f.service.matches(f.request.id).matches.length,0);
  f.service.run('verify_resource',{resource_id:offer.resource.id});
  assert.equal(f.service.matches(f.request.id).matches.length,1);
});
test('caller corrections invalidate earlier review and require a coordinator to review again',t=>{
  const f=fixture(t);
  invokeTool(f.service,'update_request',{action_id:'correction',request_id:f.request.id,people:8});
  assert.equal(f.store.get('requests',f.request.id).verification,'reported');
  const a=f.proposal();
  assert.throws(()=>f.service.run('transition_assignment',{assignment_id:a.id,status:'approved'}),/Review and verify/);
});
