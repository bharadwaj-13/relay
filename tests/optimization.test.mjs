import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../lib/store.mjs';
import {ReliefService} from '../lib/domain.mjs';
import {AutoDispatch} from '../lib/automation.mjs';

function setup(t){
  const store=new Store();t.after(()=>store.close());store.meta('workspace_mode','demo');
  const service=new ReliefService(store),dispatcher=new AutoDispatch(service);
  const source=(name,lng,extra={})=>service.run('add_resource',{name,category:'water',unit:'litres',quantity:100,location:name,provider:'Test supplier',lat:12,lng,...extra}).resource;
  const volunteer=(name,lng=77)=>service.run('register_volunteer',{name,phone:'+15555550100',location:name,lat:12,lng}).volunteer;
  const request=(name,lng,extra={})=>service.run('create_request',{name,phone:'+15555550101',category:'water',unit:'litres',quantity:20,people:2,location:name,lat:12,lng,caller_confirmed:true,...extra}).request;
  const enroll=(v,extra={})=>dispatcher.enroll({volunteer_id:v.id,enabled:true,consent:true,waterCapacity:30,foodCapacity:10,maxDistanceKm:20,channel:'in_app',...extra});
  const enable=()=>dispatcher.setPolicy({enabled:true,acceptConfirmedReports:true,radiusKm:20,offerSeconds:300});
  return {store,service,dispatcher,source,volunteer,request,enroll,enable};
}
test('volunteers enroll by capacity without choosing or requiring any pickup stock',t=>{
  const f=setup(t),v=f.volunteer('Helper');f.enroll(v);
  const d=f.store.get('volunteers',v.id).dispatch;assert.equal(d.resourceId,undefined);assert.equal(d.capacities.water.maxQuantity,30);
  assert.throws(()=>f.enroll(v,{waterCapacity:0,foodCapacity:0}),/at least one/);
});
test('optimizer chooses shortest complete pickup-delivery trip, not merely closest pickup',t=>{
  const f=setup(t),v=f.volunteer('Helper'),closestPickup=f.source('Behind volunteer',76.999),better=f.source('On the way',77.01),r=f.request('Resident',77.02);
  f.enroll(v);f.enable();const a=f.store.list('assignments')[0];
  assert.equal(a.resourceId,better.id);assert.notEqual(a.resourceId,closestPickup.id);assert.equal(a.requestId,r.id);
  assert.equal(a.matchingStrategy,'nearest_feasible_trip');assert.equal(a.distanceKm,a.pickupDistanceKm+a.deliveryDistanceKm);
});
test('optimizer considers nearby drop-offs across waiting requests rather than a fixed oldest-first route',t=>{
  const f=setup(t),v=f.volunteer('Helper');f.source('Nearby stock',77.001);
  const far=f.request('Older far resident',77.04),near=f.request('Nearby resident',77.002);
  f.enroll(v);f.enable();assert.equal(f.store.list('assignments')[0].requestId,near.id);assert.equal(f.store.get('requests',far.id).status,'new');
});
test('nearest stock must have enough verified inventory in the exact unit and category',t=>{
  const f=setup(t),v=f.volunteer('Helper');
  f.source('Too little',77.001,{quantity:10});f.source('Wrong unit',77.0011,{unit:'bottles'});f.source('Wrong category',77.0012,{category:'food'});
  const unverified=f.service.run('add_resource',{name:'Unverified',category:'water',quantity:100,unit:'litres',location:'Unverified',provider:'Caller',lat:12,lng:77.0013},'Vaani agent').resource;
  assert.equal(unverified.verification,'reported');
  const valid=f.source('Usable stock',77.003);f.request('Resident',77.004);f.enroll(v);f.enable();
  assert.equal(f.store.list('assignments')[0].resourceId,valid.id);
});
test('global candidate ranking reserves stock once and assigns at most one active job per volunteer',t=>{
  const f=setup(t),a=f.volunteer('Helper A'),b=f.volunteer('Helper B',77.001),stock=f.source('Shared stock',77.002,{quantity:30});
  f.request('Resident A',77.003);f.request('Resident B',77.004);f.enroll(a);f.enroll(b);f.enable();
  assert.equal(f.store.list('assignments').length,1);assert.equal(f.store.get('resources',stock.id).quantity,10);
  f.dispatcher.tick();assert.equal(f.store.list('assignments').length,1);
});
test('existing legacy enrollment is not pinned to its old universal depot',t=>{
  const f=setup(t),v=f.volunteer('Legacy helper'),old=f.source('Old far depot',77.05),near=f.source('New nearby supplier',77.001);
  f.store.put('volunteers',{...v,dispatch:{resourceId:old.id,maxQuantity:30,maxDistanceKm:20,channel:'in_app'}});
  f.request('Resident',77.002);f.enable();assert.equal(f.store.list('assignments')[0].resourceId,near.id);
});
test('category-specific limits reject oversized requests and imprecise pickup locations',t=>{
  const f=setup(t),v=f.volunteer('Helper'),stock=f.source('Bad GPS',77.001);
  f.store.put('resources',{...stock,locationAccuracy:300});f.request('Resident',77.002);f.enroll(v);f.enable();assert.equal(f.store.list('assignments').length,0);
  f.store.put('resources',{...stock,locationAccuracy:10});f.enroll(v,{waterCapacity:10,foodCapacity:100});assert.equal(f.store.list('assignments').length,0);
});
