import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {databaseSsl} from '../lib/postgres-state.mjs';
const db=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:databaseSsl,connectionTimeoutMillis:10000});
try{
 await db.connect();await db.query('BEGIN');
 const {rows}=await db.query('SELECT snapshot FROM relay_private.workspace WHERE id=1 FOR UPDATE');
 if(!rows.length)throw Error('Workspace not found.');const snapshot=rows[0].snapshot;
 const mode=snapshot.metadata?.find(m=>m.key==='workspace_mode')?.value;
 const counts=Object.fromEntries([...new Set(snapshot.records.map(r=>r.kind))].map(kind=>[kind,snapshot.records.filter(r=>r.kind===kind).length]));
 if(mode!=='demo'){await db.query('ROLLBACK');console.log(JSON.stringify({alreadyClean:mode==='live',counts}));}
 else if(!process.argv.includes('--apply')){await db.query('ROLLBACK');console.log(JSON.stringify({dryRun:true,mode,counts}));}
 else{
  await db.query('CREATE TABLE IF NOT EXISTS relay_private.workspace_archive(id uuid PRIMARY KEY,snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),reason text NOT NULL)');
  await db.query('ALTER TABLE relay_private.workspace_archive ENABLE ROW LEVEL SECURITY');
  await db.query('REVOKE ALL ON relay_private.workspace_archive FROM PUBLIC,anon,authenticated');
  const id=randomUUID();await db.query('INSERT INTO relay_private.workspace_archive(id,snapshot,reason) VALUES($1,$2::jsonb,$3)',[id,JSON.stringify(snapshot),'User-requested post-hackathon exercise cleanup; recoverable private archive']);
  // Preserve any genuine platform signup racing with the release cutover.
  const keep=snapshot.records.filter(r=>['organizations','platformAccounts','platformSessions'].includes(r.kind));
  const clean={records:keep,actions:[],metadata:[{key:'workspace_mode',value:'live'},{key:'organization_mode',value:'true'}]};
  await db.query('UPDATE relay_private.workspace SET snapshot=$1::jsonb,updated_at=now() WHERE id=1',[JSON.stringify(clean)]);
  await db.query('COMMIT');console.log(JSON.stringify({archived:true,archiveId:id,previousCounts:counts,preservedNewPlatformRecords:keep.length,activeLegacyRecords:0}));
 }
}catch(e){await db.query('ROLLBACK').catch(()=>{});console.error('Archive/cleanup failed:',e.message);process.exitCode=1;}finally{await db.end();}
