import {createVoiceProxy} from '../lib/voice-proxy.mjs';
const port=Number(process.env.VOICE_PROXY_PORT||3002);
const server=createVoiceProxy();
server.listen(port,'127.0.0.1',()=>console.log(`Restricted exercise voice proxy: http://127.0.0.1:${port} · dashboards and account routes are not exposed`));
