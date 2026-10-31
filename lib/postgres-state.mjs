import pg from 'pg';
import { Store } from './store.mjs';
import {readFileSync} from 'node:fs';
export const databaseSsl={rejectUnauthorized:true,ca:readFileSync(new URL('../certs/supabase-ca.crt',import.meta.url),'utf8')};

// The existing synchronous domain engine runs against a request-scoped working
// copy. A PostgreSQL row lock serializes the entire read/validate/write cycle
// across Vercel instances. SQLite is never the durable production database.
export function stateDatabase(env = process.env) {
  if(!env.DATABASE_URL)throw new Error('DATABASE_URL is required.');
  const pool = new pg.Pool({connectionString:env.DATABASE_URL,max:3,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,ssl:databaseSsl});
  pool.on('error',()=>{});
  async function transaction(fn) {
    const client=await pool.connect();
    const store=new Store();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='12s'");
      await client.query("SET LOCAL statement_timeout='25s'");
      const result=await client.query("SELECT snapshot FROM relay_private.workspace WHERE id=1 FOR UPDATE");
      if(!result.rows.length)throw new Error('Run the Relay database migration first.');
      store.restore(result.rows[0].snapshot);
      const before=JSON.stringify(store.dump());
      const value=await fn(store);
      const after=JSON.stringify(store.dump());
      if(before!==after)await client.query('UPDATE relay_private.workspace SET snapshot=$1::jsonb, updated_at=now() WHERE id=1',[after]);
      await client.query('COMMIT');
      return value;
    } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally {store.close();client.release();}
  }
  return {transaction,close:()=>pool.end()};
}
