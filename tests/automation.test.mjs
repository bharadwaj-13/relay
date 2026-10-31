import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../lib/store.mjs';
import { ReliefService } from '../lib/domain.mjs';
import { AutoDispatch } from '../lib/automation.mjs';

function setup(t,amount=100) {
  const store=new Store();t.after(()=>store.close());const service=new ReliefService(store);store.meta('workspace_mode','demo');
  const dispatcher=new AutoDispatch(service);
  const resource=service.run('add_resource',{name:'Water stock',category:'water',quantity:amount,unit:'litres',location:'Depot',provider:'Community',lat:12.98,lng:77.62}).resource;
  const volunteers=[1,2].map(i=>service.run('register_volunteer',{name:`Volunteer ${i}`,phone:`+1000000000${i}`,location:'Depot',lat:12.98+i*.001,lng:77.62}).volunteer);
  for(const v of volunteers)dispatcher.enroll({volunteer_id:v.id,resource_id:resource.id,enabled:true,consent:true,maxQuantity:50,maxDistanceKm:8,channel:'in_app'});
  dispatcher.setPolicy({enabled:true,acceptConfirmedReports:true,radiusKm:8,offerSeconds:300});
  const create=(extra={})=>service.run('create_request',{name:'Resident',location:'School',category:'water',quantity:30,people:5,lat:12.985,lng:77.62,caller_confirmed:true,...extra}).request;
  return {store,service,dispatcher,resource,volunteers,create};
}
test('automatic offer reserves stock once; volunteer acceptance does not reserve again',t=>{
  const f=setup(t);const request=f.create();assert.equal(request.status,'awaiting_volunteer');
  const assignment=f.store.list('assignments')[0],notice=f.store.list('notifications')[0];
  assert.equal(f.store.get('resources',f.resource.id).quantity,70);
  f.dispatcher.tick();assert.equal(f.store.list('assignments').length,1);
  f.dispatcher.respond(notice.token,'accept');f.dispatcher.respond(notice.token,'accept');
  assert.equal(f.store.get('resources',f.resource.id).quantity,70);
  assert.equal(f.store.get('requests',request.id).status,'assigned');
  f.dispatcher.respond(notice.token,'pickup');f.dispatcher.respond(notice.token,'delivered');
  assert.equal(f.store.get('requests',request.id).status,'awaiting_confirmation');
  assert.equal(f.store.get('assignments',assignment.id).status,'awaiting_confirmation');
});
test('decline releases stock and offers the job to a different opted-in volunteer',t=>{
  const f=setup(t);f.create();const old=f.store.list('assignments')[0],n=f.store.list('notifications')[0];
  f.dispatcher.respond(n.token,'decline');
  const next=f.store.list('assignments').find(a=>a.status==='offered');
  assert.notEqual(next.volunteerId,old.volunteerId);assert.equal(f.store.get('resources',f.resource.id).quantity,70);
  assert.equal(f.store.get('assignments',old.id).status,'cancelled');
  assert.throws(()=>f.dispatcher.respond(n.token,'accept'),/Cannot move/);
});
test('offer expiry is enforced at acceptance and worker reassignment preserves stock',t=>{
  const f=setup(t);f.create();const old=f.store.list('assignments')[0],n=f.store.list('notifications')[0];
  f.store.put('assignments',{...old,expiresAt:new Date(Date.now()-1000).toISOString()});
  assert.throws(()=>f.dispatcher.respond(n.token,'accept'),/expired/);
  f.dispatcher.tick();assert.equal(f.store.list('assignments').filter(a=>a.status==='offered').length,1);
  assert.equal(f.store.get('resources',f.resource.id).quantity,70);
});
test('medical, urgent, unconfirmed and unlocated reports never receive automatic offers',t=>{
  const f=setup(t);
  for(const extra of [{category:'medical'},{priority:'urgent'},{caller_confirmed:false},{lat:null,lng:null}])f.create({...extra,location:`Place ${JSON.stringify(extra)}`});
  assert.equal(f.store.list('assignments').length,0);
  const a=f.create();f.create({location:'School'});
  assert.equal(f.store.list('assignments').length,1);
  assert.equal(f.store.list('requests').find(r=>r.id!==a.id&&r.location==='School').status,'needs_review');
});
test('carrying limits, distance limits and remaining inventory constrain automatic offers',t=>{
  const f=setup(t,40);f.create({quantity:51,location:'Too much'});f.create({lat:14,location:'Far away'});
  assert.equal(f.store.list('assignments').length,0);
  f.create({location:'First'});f.create({location:'Second'});
  assert.equal(f.store.list('assignments').length,1);assert.equal(f.store.get('resources',f.resource.id).quantity,10);
});
test('task capability shows one job without caller phone; workspace snapshots redact tokens',t=>{
  const f=setup(t);f.create({phone:'+10000000099'});const n=f.store.list('notifications')[0];
  const task=f.dispatcher.task(n.token);assert.equal(task.request.phone,undefined);
  assert.equal(f.service.snapshot().notifications[0].token,undefined);
  assert.throws(()=>f.dispatcher.task('wrong'),/Invalid/);
});
test('SMS is honestly configuration_required when credentials are absent',async t=>{
  const f=setup(t);for(const v of f.volunteers)f.dispatcher.enroll({volunteer_id:v.id,resource_id:f.resource.id,enabled:true,consent:true,maxQuantity:50,maxDistanceKm:8,channel:'sms'});
  f.create();await f.dispatcher.flushNotifications();
  assert.equal(f.store.list('notifications')[0].status,'configuration_required');
});
test('agent cannot accept its own offer or mutate its reserved amount',t=>{
  const f=setup(t);const r=f.create(),a=f.store.list('assignments')[0];
  assert.throws(()=>f.service.run('transition_assignment',{assignment_id:a.id,status:'approved'},'Vaani agent'),/Coordinator/);
  assert.throws(()=>f.service.run('transition_assignment',{assignment_id:a.id,status:'approved'}),/volunteer must accept/);
  assert.throws(()=>f.service.run('update_request',{request_id:r.id,quantity:12}),/Cancel the active/);
});
test('private exercise routing targets one volunteer, queues while busy and retains safety checks',t=>{
 const f=setup(t,500),target=f.volunteers[1];
 f.store.meta('exercise_dispatch_volunteer_id',target.id);
 const first=f.create({location:'First demo drop'});
 f.create({location:'Second demo drop'});
 f.create({location:'Urgent demo drop',priority:'urgent'});
 const offers=f.store.list('assignments');
 assert.equal(offers.length,1);assert.equal(offers[0].volunteerId,target.id);assert.equal(offers[0].requestId,first.id);
 assert.equal(f.store.list('requests').find(r=>r.location==='Second demo drop').status,'new');
 f.dispatcher.releaseOffer(offers[0],'Exercise test cancellation');f.dispatcher.reconcile();
 const next=f.store.list('assignments').filter(a=>a.status==='offered');
 assert.equal(next.length,1);assert.equal(next[0].volunteerId,target.id);
 assert.equal(f.store.get('requests',next[0].requestId).location,'Second demo drop');
 assert.equal(f.store.list('requests').find(r=>r.location==='Urgent demo drop').status,'needs_review');
});
test('exercise routing configuration cannot affect a live workspace',t=>{
 const f=setup(t);f.store.meta('workspace_mode','live');f.store.meta('exercise_dispatch_volunteer_id','missing-demo-volunteer');
 f.create();assert.equal(f.store.list('assignments').length,1);
});
