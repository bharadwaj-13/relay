import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../lib/store.mjs';
import {sendSms} from '../lib/messaging.mjs';
import {stateDatabase} from '../lib/postgres-state.mjs';

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
