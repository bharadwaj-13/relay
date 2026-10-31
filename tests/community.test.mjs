import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../lib/store.mjs';
import { ReliefService } from '../lib/domain.mjs';
import { AutoDispatch } from '../lib/automation.mjs';
import { MemberService } from '../lib/members.mjs';
import { ResidentService } from '../lib/residents.mjs';

function fixture(t, mode='demo') {
  const store=new Store();t.after(()=>store.close());store.meta('workspace_mode',mode);
  const service=new ReliefService(store), dispatcher=new AutoDispatch(service), members=new MemberService(service,dispatcher,{}), residents=new ResidentService(service,{});
  const create=(extra={})=>service.run('create_request',{name:'Amina',phone:'+971500000001',location:'School gate',category:'water',quantity:5,people:2,caller_confirmed:true,...extra}).request;
  const join=async (role='both',phone='+971500000010')=>{const credentials={name:'Demo helper',phone,password:'a-long-test-password',role,consent:true};const signup=await members.signup(credentials);members.verify({accountId:signup.accountId,code:signup.developmentCode});return {...credentials,token:members.login(credentials).token};};
  return {store,service,dispatcher,members,residents,create,join};
}
test('public signup verifies phone and creates an isolated self-service volunteer account',async t=>{
  const f=fixture(t),user=await f.join();const own=f.members.me(user.token);
  assert.equal(own.account.role,'both');assert.ok(own.volunteer);assert.equal(own.account.passwordHash,undefined);
  assert.equal(f.store.list('accounts').length,1);assert.equal(f.store.list('verification').length,1);
  assert.notEqual(f.store.list('accounts')[0].passwordHash,user.password);
  assert.throws(()=>f.members.login({...user,password:'incorrect'}),/Incorrect/);
  const other=await f.join('supplier','+971500000011');assert.equal(f.members.me(other.token).volunteer,null);
  assert.notEqual(f.members.me(other.token).account.id,own.account.id);
  f.members.logout(user.token);assert.throws(()=>f.members.me(user.token),/Sign in/);
});
test('separate portal sign-ins reject the wrong role and scope dual-role sessions',async t=>{
 const f=fixture(t),volunteer=await f.join('volunteer','+15555550101'),supplier=await f.join('supplier','+15555550111'),both=await f.join('both','+15555550122');
 assert.throws(()=>f.members.login({...volunteer,portal:'supplier'}),/sign-in/);
 assert.throws(()=>f.members.login({...supplier,portal:'volunteer'}),/sign-in/);
 const v=f.members.login({...both,portal:'volunteer'}).token;
 assert.equal(f.members.me(v,'volunteer').portal,'volunteer');
 assert.throws(()=>f.members.me(v,'supplier'),/supplier portal/);
 assert.throws(()=>f.members.addSupply(v,{}),/supplier portal/);
 const s=f.members.login({...both,portal:'supplier'}).token;
 assert.equal(f.members.me(s,'supplier').volunteer,null);
 assert.deepEqual(f.members.me(s,'supplier').offers,[]);
 assert.throws(()=>f.members.enroll(s,{}),/volunteer portal/);
});
test('unverified accounts cannot sign in and incorrect codes are rate-limited',async t=>{
  const f=fixture(t),input={name:'Test',phone:'+971500000012',password:'test-password-long',role:'volunteer',consent:true};
  const signup=await f.members.signup(input);assert.throws(()=>f.members.login(input),/Verify/);
  for(let i=0;i<5;i++)assert.throws(()=>f.members.verify({accountId:signup.accountId,code:'wrong'}),/Incorrect/);
  assert.throws(()=>f.members.verify({accountId:signup.accountId,code:signup.developmentCode}),/expired/);
});
test('live signup does not expose a development verification code when SMS is absent',async t=>{
  const f=fixture(t,'live');const signup=await f.members.signup({name:'Test',phone:'+971500000013',password:'test-password-long',role:'supplier',consent:true});
  assert.equal(signup.developmentCode,undefined);assert.equal(signup.verification,'configuration_required');
});
test('self-service location needs consent and supplier offers cannot self-verify',async t=>{
  const f=fixture(t),u=await f.join();
  assert.throws(()=>f.members.profile(u.token,{location:'Depot',lat:12.98,lng:77.62}),/permission/);
  f.members.profile(u.token,{location:'Depot',lat:12.98,lng:77.62,accuracy:10,locationConsent:true});
  const offer=f.members.addSupply(u.token,{name:'Water',category:'water',quantity:40,unit:'litres',location:'Depot',lat:12.98,lng:77.62,locationConsent:true});
  assert.equal(offer.resource.verification,'reported');assert.equal(f.members.me(u.token).catalog,undefined);
  const other=await f.join('supplier','+971500000014');assert.equal(f.members.me(other.token).supplies.length,0);
});
test('repeat caller menu and name-based status lookup do not expose private request details',t=>{
  const f=fixture(t);assert.equal(f.residents.context({phone:'+971500000001'}).returningCaller,false);
  const r=f.create();f.create({name:'Different resident',location:'Elsewhere'});
  assert.equal(f.residents.context({phone:'+971500000001'}).returningCaller,true);
  const tracked=f.residents.track({phone:'+971500000001',name:'amina'});assert.equal(tracked.requests.length,1);assert.equal(tracked.requests[0].reference,r.id);
  assert.equal(tracked.requests[0].location,undefined);assert.equal(tracked.requests[0].phone,undefined);
  assert.equal(f.residents.track({phone:'+971500000002',name:'Amina'}).requests.length,0);
  f.store.put('calls',{id:'trusted-call',source:'vaani',phone:'+971500000001'});
  assert.equal(f.residents.track({call_id:'trusted-call',phone:'+971500000002',name:'Amina'}).requests.length,1);
});
test('resident identity matching preserves non-Latin names',t=>{
  const f=fixture(t);f.create({name:'أمينة'});f.create({name:'سارة',location:'Other school'});
  assert.equal(f.residents.track({phone:'+971500000001',name:'أمينة'}).requests.length,1);
  assert.equal(f.residents.track({phone:'+971500000001',name:'अन्य'}).requests.length,0);
});
test('resident location links are consented, private, single-use and support manual landmarks',async t=>{
  const f=fixture(t),r=f.create(),identity={phone:r.phone,name:r.name,request_id:r.id};
  await assert.rejects(f.residents.locationLink(identity),/permission/);
  const result=await f.residents.locationLink({...identity,consent:true}),token=new URL(result.exerciseUrl).hash.slice(1);
  assert.throws(()=>f.residents.capture(token,{landmark:'Blue gate'}),/permission/);
  const saved=f.residents.capture(token,{landmark:'Blue gate',locationConsent:true});assert.equal(saved.saved,true);
  assert.equal(f.store.get('requests',r.id).lat,null);assert.equal(f.store.get('requests',r.id).location,'Blue gate');
  f.residents.capture(token,{landmark:'Wrong gate',locationConsent:true});assert.equal(f.store.get('requests',r.id).location,'Blue gate');
  assert.equal(f.service.snapshot().locationLinks,undefined);assert.throws(()=>f.residents.locationInfo('wrong'),/Invalid/);
});
test('poor GPS accuracy blocks automatic matching; configured-free reverse lookup asks for a landmark',async t=>{
  const f=fixture(t),r=f.create(),link=await f.residents.locationLink({phone:r.phone,name:r.name,request_id:r.id,consent:true});
  f.residents.capture(new URL(link.exerciseUrl).hash.slice(1),{landmark:'School',lat:12.98,lng:77.62,accuracy:300,locationConsent:true});
  assert.equal(f.store.get('requests',r.id).status,'needs_review');
  assert.equal((await f.residents.reverse({lat:12.98,lng:77.62,locationConsent:true})).address,null);
});
test('resident cancels only their own unassigned request and callbacks are queued without duplicate promises',t=>{
  const f=fixture(t),r=f.create();assert.throws(()=>f.residents.cancel({phone:'+971500000002',name:r.name,request_id:r.id,confirmed:true}),/No matching/);
  f.residents.cancel({phone:r.phone,name:r.name,request_id:r.id,confirmed:true});assert.equal(f.store.get('requests',r.id).status,'cancelled');
  const input={phone:r.phone,name:r.name,reason:'Please help correct my address',consent:true};
  const cb=f.residents.callback(input);assert.equal(f.residents.callback(input).reference,cb.reference);assert.equal(f.service.snapshot().calls[0].status,'callback_requested');
});
test('resident phone receipt closes a delivery only after reported handover',async t=>{
  const f=fixture(t),u=await f.join('volunteer');f.members.profile(u.token,{location:'Depot',lat:12.98,lng:77.62,locationConsent:true});
  const stock=f.service.run('add_resource',{name:'Water',category:'water',quantity:50,unit:'litres',location:'Depot',provider:'Community',lat:12.98,lng:77.62}).resource;
  assert.throws(()=>f.members.enroll(u.token,{enabled:true,resource_id:stock.id}),/automatically/);
  f.members.enroll(u.token,{enabled:true,consent:true,waterCapacity:30,foodCapacity:0,maxDistanceKm:8,channel:'in_app'});
  f.dispatcher.setPolicy({enabled:true,acceptConfirmedReports:true,radiusKm:8,offerSeconds:300});
  const r=f.create({lat:12.981,lng:77.621}),identity={phone:r.phone,name:r.name,request_id:r.id,confirmed:true};
  assert.throws(()=>f.residents.confirmReceipt(identity),/No reported delivery/);
  const n=f.store.list('notifications')[0];f.dispatcher.respond(n.token,'accept');f.dispatcher.respond(n.token,'pickup');f.dispatcher.respond(n.token,'delivered');
  f.residents.confirmReceipt(identity);f.residents.confirmReceipt(identity);assert.equal(f.store.get('requests',r.id).status,'delivered');
  assert.equal(f.store.get('resources',stock.id).quantity,45);
});
