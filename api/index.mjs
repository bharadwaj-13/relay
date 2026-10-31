import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {createApp} from '../server.mjs';
import {stateDatabase} from '../lib/postgres-state.mjs';
import {sendSms} from '../lib/messaging.mjs';

export const config={api:{bodyParser:false}};
let database;
class BufferedResponse extends EventEmitter {
  constructor(){super();this.headers={};this.statusCode=200;this.parts=[];this.headersSent=false;}
  setHeader(k,v){this.headers[k]=v;}
  writeHead(status,headers={}){this.statusCode=status;Object.assign(this.headers,headers);this.headersSent=true;return this;}
  write(data){this.parts.push(Buffer.from(data));return true;}
  end(data){if(data)this.write(data);this.finished=true;}
}

export async function drainSms(db,env) {
  // Claim durably BEFORE sending. A crash leaves 'sending', never an automatic
  // resend. That deliberately prefers coordinator review over duplicate SMS.
  for(let i=0;i<3;i++) {
    const item=await db.transaction(store=>{
      const pending=store.list('smsOutbox').find(n=>n.status==='pending');
      if(pending)store.put('smsOutbox',{...pending,status:'sending',attemptedAt:Date.now()});
      return pending;
    });
    if(!item)break;
    const result=await sendSms({...env,enqueueSms:undefined},item.phone,item.message);
    await db.transaction(store=>{
      store.put('smsOutbox',{id:item.id,...result,completedAt:Date.now()});
      for(const link of store.list('locationLinks').filter(l=>l.delivery?.queueId===item.id))store.put('locationLinks',{...link,delivery:result});
      for(const n of store.list('notifications').filter(n=>n.queueId===item.id))store.put('notifications',{...n,...result});
    });
  }
}

export default async function handler(req,res) {
  const path=new URL(req.url,'http://relay.local').pathname;
  // SSE is intentionally replaced by short polling across serverless instances.
  if(['/api/events','/api/members/events'].includes(path)){res.writeHead(410,{'Content-Type':'application/json'});res.end('{"polling":true}');return;}
  try {
    database ||= stateDatabase();
    const response=await database.transaction(async store=>{
      const env={...process.env,SERVERLESS:'true',SEED_DEMO_DATA:'false'};
      env.enqueueSms=(phone,message)=>{
        const id=randomUUID();store.put('smsOutbox',{id,phone,message,status:'pending',createdAt:Date.now()});
        return {status:'queued',queueId:id};
      };
      const app=createApp(env,store),buffer=new BufferedResponse();
      try {
        app.dispatcher.tick();
        await app.server.listeners('request')[0](req,buffer);
        await app.dispatcher.flushNotifications();
        return buffer;
      } finally {app.server.removeAllListeners();}
    });
    // The request is committed before a provider can observe any queued SMS.
    await drainSms(database,process.env).catch(()=>{});
    res.writeHead(response.statusCode,response.headers);
    res.end(Buffer.concat(response.parts));
  } catch {res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":"Database temporarily unavailable. No action is confirmed; retry with the same action ID."}');}
}
