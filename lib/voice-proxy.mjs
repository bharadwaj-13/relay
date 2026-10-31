import {createServer} from 'node:http';
import {toolDefinitions} from './tools.mjs';
import {equalSecret,verifyWebhook} from './vaani.mjs';

export function createVoiceProxy(env=process.env) {
  if (env.DEMO_MODE !== 'true' || !env.TOOL_API_KEY || !env.WEBHOOK_SECRET) throw new Error('The temporary voice proxy requires explicit exercise mode and both secrets.');
  const upstream=new URL(env.RELAY_LOCAL_ORIGIN||'http://127.0.0.1:3000');
  if(upstream.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(upstream.hostname)||upstream.username||upstream.password||upstream.pathname!=='/'||upstream.search||upstream.hash)throw new Error('Voice proxy upstream must be a loopback HTTP origin.');
  const paths=new Set(['/api/voice/action',...toolDefinitions.map(t=>`/api/tools/${t.name}`)]);
  const locationFiles=new Set(['/location.html','/location.js','/gps.js','/styles.css','/community.css','/favicon.svg']);
  return createServer(async(req,res)=>{
    const reply=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try {
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&url.pathname==='/api/health'&&!url.search)return reply(200,{ok:true,scope:'exercise-voice-endpoints-only'});
      const locationStatic=env.ENABLE_PUBLIC_LOCATION==='true'&&req.method==='GET'&&locationFiles.has(url.pathname);
      const locationApi=env.ENABLE_PUBLIC_LOCATION==='true'&&((req.method==='GET'&&url.pathname==='/api/location/info')||(req.method==='POST'&&['/api/location/save','/api/location/reverse'].includes(url.pathname)));
      const webhook=req.method==='POST'&&(url.pathname==='/api/webhooks/vaani'||(env.VAANI_WEBHOOK_AUTH==='secret-path'&&url.pathname===`/api/webhooks/vaani/${env.WEBHOOK_SECRET}`));
      const tool=req.method==='POST'&&paths.has(url.pathname);
      if(url.search||(!locationStatic&&!locationApi&&!webhook&&!tool))return reply(404,{error:'Dashboards, account routes, volunteer task links and coordinator APIs remain private.'});
      if(tool&&!equalSecret(req.headers.authorization,`Bearer ${env.TOOL_API_KEY}`))return reply(401,{error:'Tool authorization required.'});
      if(locationApi&&!/^Bearer [a-f0-9]{64}$/.test(req.headers.authorization||''))return reply(401,{error:'A private location-link token is required.'});
      // Webhook verification is performed by Relay using its selected contract.
      let bytes=0;const chunks=[];
      for await(const chunk of req){bytes+=chunk.length;if(bytes>512000)return reply(413,{error:'Request too large.'});chunks.push(chunk);}
      if(webhook)verifyWebhook(req,Buffer.concat(chunks),env);
      const headers={...(req.method==='POST'?{'Content-Type':'application/json'}:{})};
      for(const key of ['authorization',(env.VAANI_SIGNATURE_HEADER||'x-vaani-signature').toLowerCase()])if(typeof req.headers[key]==='string')headers[key]=req.headers[key];
      const response=await fetch(new URL(url.pathname,upstream),{method:req.method,headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{}),redirect:'error',signal:AbortSignal.timeout(25000)});
      const data=await response.text();
      const responseHeaders={'Content-Type':response.headers.get('content-type')||'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
      if(response.headers.get('content-security-policy'))responseHeaders['Content-Security-Policy']=response.headers.get('content-security-policy');
      res.writeHead(response.status,responseHeaders);res.end(data);
    }catch(error) {if(!res.headersSent)reply(error.status||502,{error:error.status?error.message:'Local Relay backend is unavailable. No action is confirmed.'});else res.end();}
  });
}
