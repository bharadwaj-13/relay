import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {databaseSsl} from '../lib/postgres-state.mjs';
const client=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:databaseSsl,connectionTimeoutMillis:10000});
try {
  await client.connect();
  await client.query(await readFile(new URL('../migrations/001_workspace.sql',import.meta.url),'utf8'));
  console.log('Relay private workspace schema is ready. Existing data was preserved.');
} catch(error) {console.error('Migration failed:',error.code||error.name);process.exitCode=1;}
finally {await client.end();}
