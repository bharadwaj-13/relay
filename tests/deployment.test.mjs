import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../lib/store.mjs';
import {sendSms} from '../lib/messaging.mjs';
import {stateDatabase} from '../lib/postgres-state.mjs';
import {ReliefService} from '../lib/domain.mjs';
import {ResidentService} from '../lib/residents.mjs';

test('deployment snapshots preserve records, metadata and retry receipts without sharing a local database',()=>{
  const a=new Store(),b=new Store();
  try {
    a.put('requests',{id:'probe',quantity:4});a.meta('workspace_mode','demo');
    a.db.prepare('INSERT INTO actions VALUES(?,?,?,?)').run('retry','create_request','fingerprint','{"ok":true}');
    b.restore(JSON.parse(JSON.stringify(a.dump())));
    assert.deepEqual(b.dump(),a.dump());
    b.put('requests',{id:'probe',quantity:5});
    assert.equal(a.get('requests','probe').quantity,4);
  }finally{a.close();b.close();}
});
test('serverless SMS queues before contacting any external provider',async()=>{
  let queued=false;
  const result=await sendSms({TWILIO_ACCOUNT_SID:'configured',TWILIO_AUTH_TOKEN:'configured',TWILIO_FROM_NUMBER:'configured',enqueueSms:(phone,message)=>{queued=true;assert.equal(phone,'+15555550100');assert.equal(message,'synthetic');return {status:'queued',queueId:'test'};}},'+15555550100','synthetic');
  assert.equal(result.status,'queued');assert.ok(queued);
});
test('minimal intake preserves unknown group size and returns a canonical location link without fake SMS success',async()=>{
  const store=new Store();
  try {
    store.meta('workspace_mode','demo');
    const service=new ReliefService(store),resident=new ResidentService(service,{PUBLIC_BASE_URL:'https://relay.tinkeringspaces.com'});
    const input={action_id:'synthetic-short-intake',phone:'+15555550100',name:'Synthetic Resident',category:'water',quantity:4,unit:'litres',confirmed:true,consent:true};
    const first=await resident.requestHelp(input),second=await resident.requestHelp(input);
    assert.equal(first.request_id,second.request_id);
    assert.equal(store.list('requests').length,1);
    assert.equal(store.list('requests')[0].people,null);
    assert.equal(store.list('requests')[0].locationPending,true);
    assert.equal(first.locationLinkStatus,'demo_link');
    assert.ok(first.exerciseUrl.startsWith('https://relay.tinkeringspaces.com/location.html#'));
    assert.ok(!first.say.includes(first.request_id));
    assert.match(first.say,/not sent a real text/);
  } finally {store.close();}
});
test('spoken final location is saved without SMS or fabricated GPS and retries stay idempotent',async()=>{
 const store=new Store();try{
  store.meta('workspace_mode','demo');const resident=new ResidentService(new ReliefService(store),{});
  const input={action_id:'spoken-intake',phone:'+15555550199',name:'Exercise Resident',category:'water',quantity:4,unit:'litres',confirmed:true,consent:true,location_method:'spoken',location:'Blue gate beside the community hall'};
  const a=await resident.requestHelp(input),b=await resident.requestHelp(input);
  assert.equal(a.request_id,b.request_id);assert.equal(a.locationSaved,true);assert.equal(a.coordinatesKnown,false);
  assert.equal(store.list('requests').length,1);assert.equal(store.list('locationLinks').length,0);
  assert.equal(store.list('requests')[0].locationPending,false);assert.equal(store.list('requests')[0].locationSource,'caller_spoken_landmark');
  assert.equal(store.list('requests')[0].lat,null);
  await assert.rejects(resident.requestHelp({...input,location:''}),/address or landmark/);
 }finally{store.close();}
});
test('fictional video landmarks resolve only in exercise mode and only on exact names',()=>{
 const store=new Store();try{
  const service=new ReliefService(store);store.meta('workspace_mode','demo');store.meta('exercise_landmarks',JSON.stringify([{name:'Relay Demo School',lat:12.975,lng:77.618}]));
  const input={name:'Synthetic Resident',phone:'',location:'Relay Demo School',category:'water',quantity:4,unit:'litres',people:1,priority:'normal'};
  assert.equal(service.run('create_request',input).request.lat,12.975);
  assert.equal(service.run('create_request',{...input,location:'Another school'}).request.lat,null);
  store.meta('workspace_mode','live');assert.equal(service.run('create_request',input).request.lat,null);
 }finally{store.close();}
});
test('Supabase transaction rolls back partial mutations and serializes independent writers',{skip:!process.env.RUN_DATABASE_TESTS},async()=>{
  const db=stateDatabase();
  try {
    const key='deployment_probe';
    await assert.rejects(db.transaction(store=>{store.meta(key,'bad');throw new Error('intentional rollback');}));
    assert.equal(await db.transaction(store=>store.meta(key)),undefined);
    await Promise.all(Array.from({length:4},()=>db.transaction(async store=>{const n=Number(store.meta(key)||0);await new Promise(r=>setTimeout(r,10));store.meta(key,n+1);})));
    assert.equal(await db.transaction(store=>Number(store.meta(key))),4);
    await db.transaction(store=>store.db.prepare('DELETE FROM metadata WHERE key=?').run(key));
  }finally{await db.close();}
});
