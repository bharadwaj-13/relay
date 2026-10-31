// Credentials travel to the Vercel CLI on stdin, never in argv or logs.
import {spawn} from 'node:child_process';
const cli=process.argv[2];if(!cli)throw new Error('Pass the installed Vercel CLI path.');
const values={
  DATABASE_URL:process.env.DATABASE_URL,ADMIN_PASSWORD:process.env.ADMIN_PASSWORD,
  TOOL_API_KEY:process.env.TOOL_API_KEY,WEBHOOK_SECRET:process.env.WEBHOOK_SECRET,
  PUBLIC_BASE_URL:'https://relay.tinkeringspaces.com',RESIDENT_PUBLIC_BASE_URL:'https://relay.tinkeringspaces.com',
  DEMO_MODE:'true',SEED_DEMO_DATA:'false',SERVERLESS:'true',ENABLE_EXERCISE_SMS:'false',
  VAANI_AGENT_ID:process.env.VAANI_AGENT_ID,VAANI_WEBHOOK_AUTH:'shared-token'
};
for(const k of ['VAANI_API_KEY','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM_NUMBER','GOOGLE_MAPS_API_KEY'])if(process.env[k])values[k]=process.env[k];
if(Object.values(values).some(v=>!v))throw new Error('Required deployment configuration is missing.');
await Promise.all(Object.entries(values).map(([key,value])=>new Promise((resolve,reject)=>{
  const secret=['DATABASE_URL','ADMIN_PASSWORD','TOOL_API_KEY','WEBHOOK_SECRET','VAANI_API_KEY','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_FROM_NUMBER','GOOGLE_MAPS_API_KEY'].includes(key);
  const p=spawn(cli,['env','add',key,'--environment','production','--force','--yes','--type',secret?'secret':'config'],{stdio:['pipe','pipe','pipe']});
  p.stdout.resume();p.stderr.resume();p.stdin.end(value);
  p.on('error',reject);p.on('exit',code=>code===0?(console.log(`${key}: configured`),resolve()):reject(new Error(`${key}: CLI failed (${code})`)));
})));
