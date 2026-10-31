import {createServer} from 'node:http';
import {createApp} from '../server.mjs';
if(process.env.DATABASE_URL&&process.env.ORGANIZATION_MODE==='true'){
 process.env.PUBLIC_BASE_URL=`http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||3000}`;
 process.env.RESIDENT_PUBLIC_BASE_URL=process.env.PUBLIC_BASE_URL;
 const {default:handler}=await import('../api/index.mjs');
 const server=createServer(handler);server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`Relay: http://${process.env.HOST||'127.0.0.1'}:${process.env.PORT||3000} · hosted Supabase platform`));
}else{
 const {server}=createApp();server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>console.log(`Relay: http://127.0.0.1:${process.env.PORT||3000} · local workspace`));
}
