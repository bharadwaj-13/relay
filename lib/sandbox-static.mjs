import {readFile} from 'node:fs/promises';
const files=new Map([['/sandbox',['sandbox.html','text/html']],['/sandbox/',['sandbox.html','text/html']],['/sandbox.html',['sandbox.html','text/html']],['/sandbox.js',['sandbox.js','text/javascript']],['/sandbox-model.js',['sandbox-model.js','text/javascript']],['/sandbox-voice.js',['sandbox-voice.js','text/javascript']],['/sandbox-intake.js',['sandbox-intake.js','text/javascript']],['/sandbox.css',['sandbox.css','text/css']],['/favicon.svg',['favicon.svg','image/svg+xml']]]);
export const sandboxPolicy="default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'self' data:; font-src 'self'; media-src blob:; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
export async function serveSandbox(req,res){
 const route=files.get(new URL(req.url,'http://relay.local').pathname);if(!route)return false;
 const headers={'Content-Type':`${route[1]}; charset=utf-8`,'Content-Security-Policy':sandboxPolicy,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-cache'};
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{...headers,Allow:'GET, HEAD'});res.end('Sandbox pages are read-only on the server.');return true;}
 const content=await readFile(new URL(`../public/${route[0]}`,import.meta.url));res.writeHead(200,headers);res.end(req.method==='HEAD'?undefined:content);return true;
}
