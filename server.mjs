import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join, extname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { Store } from './lib/store.mjs';
import { ReliefService, AppError } from './lib/domain.mjs';
import { seed } from './lib/seed.mjs';
import { toolDefinitions, invokeTool, invokeVoiceAction } from './lib/tools.mjs';
import { equalSecret, dispatchCall, verifyWebhook, ingestWebhook } from './lib/vaani.mjs';
import { demoStep, scenarios } from './lib/demo.mjs';
import { AutoDispatch } from './lib/automation.mjs';
import { MemberService } from './lib/members.mjs';
import { ResidentService } from './lib/residents.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
export function createApp(env = process.env, suppliedStore = null) {
  const demo = env.DEMO_MODE !== 'false';
  const host = env.HOST || '127.0.0.1';
  if ((!demo || env.PUBLIC_BASE_URL || !['127.0.0.1','localhost','::1'].includes(host)) && (!env.ADMIN_PASSWORD || !env.TOOL_API_KEY || !env.WEBHOOK_SECRET)) throw new Error('Live, public-URL, or non-loopback hosting requires ADMIN_PASSWORD, TOOL_API_KEY, and WEBHOOK_SECRET.');
  const store = suppliedStore || new Store(env.DATABASE_PATH || join(root, 'data', demo ? 'relay-demo.sqlite' : 'relay-live.sqlite'));
  const service = new ReliefService(store);
  const workspaceMode = demo ? 'demo' : 'live';
  if (store.meta('workspace_mode') && store.meta('workspace_mode') !== workspaceMode) { store.close(); throw new Error('This database belongs to another mode. Set a different DATABASE_PATH; demo and live data must stay separate.'); }
  store.meta('workspace_mode', workspaceMode);
  if (demo && env.SEED_DEMO_DATA === 'true') seed(service);
  const dispatcher = new AutoDispatch(service, env);
  const members = new MemberService(service, dispatcher, env);
  const residents = new ResidentService(service, env);
  const sessions = new Map(), rates = new Map();
  const coordinatorPassword = env.ADMIN_PASSWORD || 'relay-demo-coordinator';
  const sessionId = token => createHash('sha256').update(token).digest('hex');
  const config = () => ({ demo, authRequired: true, agentConfigured: !!env.VAANI_AGENT_ID, apiConfigured: !!env.VAANI_API_KEY, toolsConfigured: !!env.TOOL_API_KEY, webhookConfigured: !!env.WEBHOOK_SECRET, agentId: env.VAANI_AGENT_ID || null, publicBaseUrl: env.PUBLIC_BASE_URL || '', platformUrl: 'https://platform.vaani.dev/', incident: { name: demo ? 'Bengaluru flood response' : 'Relief operations', subtitle: demo ? 'Exercise area · illustrative locations' : 'Live coordination workspace', status: demo ? 'Exercise mode' : 'Live workspace' } });
  const authenticated = req => {
    const token = /(?:^|;\s*)relay_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
    if (token && (env.SERVERLESS === 'true' ? store.get('coordinatorSessions',sessionId(token))?.expiresAt : sessions.get(token)) > Date.now()) return true;
    if (token) sessions.delete(token);
    return false;
  };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.vaanivoice.ai; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.vaanivoice.ai wss://*.vaanivoice.ai https://*.livekit.cloud wss://*.livekit.cloud; img-src 'self' data:; font-src 'self'; media-src 'self' blob:; frame-src https://*.vaani.dev https://*.vaanivoice.ai; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      if (path.startsWith('/api/')) {
        const authPath = path === '/api/login' || ['/api/members/signup','/api/members/login','/api/members/verify'].includes(path);
        const key = `${env.SERVERLESS === 'true' ? req.headers['x-real-ip'] || req.socket?.remoteAddress : req.socket.remoteAddress}:${authPath ? 'login' : 'api'}`;
        const rate = (env.SERVERLESS === 'true' ? store.get('rateLimits',key) : rates.get(key)) || { count: 0, until: Date.now() + 60000 };
        if (rate.until < Date.now()) { rate.count = 0; rate.until = Date.now() + 60000; }
        rate.count++; rates.set(key, rate);
        if(env.SERVERLESS === 'true')store.put('rateLimits',{id:key,...rate});
        if (rate.count > (authPath ? 12 : 600)) throw new AppError('Too many requests. Please retry shortly.', 429);
        let raw = Buffer.alloc(0), input = {};
        if (['POST','PATCH','PUT'].includes(req.method)) {
          for await (const chunk of req) { raw = Buffer.concat([raw, chunk]); if (raw.length > 512000) throw new AppError('Request body too large.', 413); }
          try { input = raw.length ? JSON.parse(raw.toString()) : {}; } catch { throw new AppError('Invalid JSON.'); }
          if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Expected a JSON object.');
        }
        if (path === '/api/health') return json(200, { ok: true, mode: workspaceMode });
        if (path.startsWith('/api/webhooks/vaani') && req.method === 'POST') { verifyWebhook(req, raw, env); return json(200, ingestWebhook(store, input)); }
        if (path.startsWith('/api/tools/') && req.method === 'POST') {
          if (!env.TOOL_API_KEY || !equalSecret(req.headers.authorization, `Bearer ${env.TOOL_API_KEY}`)) throw new AppError('Invalid tool authorization.', 401);
          return json(200, await invokeTool(service, path.split('/').at(-1), input));
        }
        if (path === '/api/voice/action' && req.method === 'POST') {
          if (!env.TOOL_API_KEY || !equalSecret(req.headers.authorization, `Bearer ${env.TOOL_API_KEY}`)) throw new AppError('Invalid tool authorization.', 401);
          return json(200, await invokeVoiceAction(service, input));
        }
        if (!['GET','HEAD'].includes(req.method)) {
          const expectedOrigin = env.PUBLIC_BASE_URL ? new URL(env.PUBLIC_BASE_URL).origin : `http://${req.headers.host}`;
          if (req.headers.origin && req.headers.origin !== expectedOrigin) throw new AppError('Cross-origin action rejected.', 403);
        }
        const memberToken = /(?:^|;\s*)relay_member=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
        const bearer = String(req.headers.authorization || '').replace(/^Bearer /, '');
        if (path === '/api/coordinator/access' && req.method === 'GET') return json(200, { demo, demoLogin: demo && !env.ADMIN_PASSWORD ? 'relay-demo-coordinator' : null });
        if (path === '/api/public/config' && req.method === 'GET') return json(200, { exercise: demo, smsConfigured: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER), reverseGeocoding: !!env.GOOGLE_MAPS_API_KEY });
        if (path === '/api/members/signup' && req.method === 'POST') return json(200, await members.signup(input));
        if (path === '/api/members/verify' && req.method === 'POST') return json(200, members.verify(input));
        if (path === '/api/members/login' && req.method === 'POST') {
          const { token } = members.login(input);
          res.setHeader('Set-Cookie', `relay_member=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${env.PUBLIC_BASE_URL?.startsWith('https:') ? '; Secure' : ''}`);
          return json(200, { signedIn: true });
        }
        if (path === '/api/members/logout' && req.method === 'POST') { members.logout(memberToken); res.setHeader('Set-Cookie','relay_member=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(200, { signedOut: true }); }
        if (path === '/api/members/me' && req.method === 'GET') return json(200, members.me(memberToken));
        if (path === '/api/members/events' && req.method === 'GET') {
          members.account(memberToken);
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); res.write('event: connected\ndata: {}\n\n');
          const notify = () => { try { members.account(memberToken); if (!res.destroyed) res.write('event: change\ndata: {}\n\n'); } catch { res.end(); } };
          store.listeners.add(notify); const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
          req.on('close', () => { store.listeners.delete(notify); clearInterval(heartbeat); }); return;
        }
        if (path === '/api/members/profile' && req.method === 'POST') return json(200, members.profile(memberToken, input));
        if (path === '/api/members/enroll' && req.method === 'POST') return json(200, members.enroll(memberToken, input));
        if (path === '/api/members/availability' && req.method === 'POST') return json(200, members.availability(memberToken, input));
        if (path === '/api/members/supplies' && req.method === 'POST') return json(200, members.addSupply(memberToken, input));
        if (path === '/api/members/reverse' && req.method === 'POST') { members.account(memberToken); return json(200, await residents.reverse(input)); }
        if (path === '/api/location/info' && req.method === 'GET') return json(200, residents.locationInfo(bearer));
        if (path === '/api/location/save' && req.method === 'POST') return json(200, residents.capture(bearer, input));
        if (path === '/api/location/reverse' && req.method === 'POST') { residents.link(bearer); return json(200, await residents.reverse(input)); }
        if (path === '/api/login' && req.method === 'POST') {
          if (!equalSecret(input.password, coordinatorPassword)) throw new AppError('Incorrect password.', 401);
          const token = randomBytes(32).toString('hex'); sessions.set(token, Date.now() + 12 * 3600000);
          if(env.SERVERLESS === 'true')store.put('coordinatorSessions',{id:sessionId(token),expiresAt:Date.now()+12*3600000});
          res.setHeader('Set-Cookie', `relay_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${env.PUBLIC_BASE_URL?.startsWith('https:') ? '; Secure' : ''}`);
          return json(200, { ok: true });
        }
        if (path === '/api/volunteer/task' && req.method === 'GET') return json(200, dispatcher.task(String(req.headers.authorization || '').replace(/^Bearer /, '')));
        if (path === '/api/volunteer/respond' && req.method === 'POST') return json(200, dispatcher.respond(String(req.headers.authorization || '').replace(/^Bearer /, ''), input.decision));
        if (!authenticated(req)) throw new AppError('Sign in to the coordinator workspace.', 401);
        if (path === '/api/dispatch/policy' && req.method === 'POST') return json(200, dispatcher.setPolicy(input));
        if (path === '/api/dispatch/enroll' && req.method === 'POST') return json(200, dispatcher.enroll(input));
        if (path === '/api/dispatch/run' && req.method === 'POST') { dispatcher.tick(); return json(200, { ok: true }); }
        if (path === '/api/logout' && req.method === 'POST') {
          const token = /(?:^|;\s*)relay_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1]; sessions.delete(token);
          if(env.SERVERLESS === 'true' && token)store.put('coordinatorSessions',{id:sessionId(token),expiresAt:0});
          res.setHeader('Set-Cookie', 'relay_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return json(200, { ok: true });
        }
        if (path === '/api/config' && req.method === 'GET') return json(200, config());
        if (path === '/api/state' && req.method === 'GET') return json(200, service.snapshot());
        if (path === '/api/tool-definitions' && req.method === 'GET') return json(200, toolDefinitions);
        if (path === '/api/agent-prompt' && req.method === 'GET') return json(200, { prompt: await readFile(join(root, 'vaani/agent-prompt.md'), 'utf8') });
        if (path === '/api/events' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.write('event: connected\ndata: {}\n\n');
          const notify = () => { if (!res.destroyed) res.write(`event: change\ndata: {"at":${Date.now()}}\n\n`); };
          store.listeners.add(notify);
          const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
          req.on('close', () => { store.listeners.delete(notify); clearInterval(heartbeat); });
          return;
        }
        if (path === '/api/action' && req.method === 'POST') return json(200, service.run(input.operation, input.data || {}));
        if (path === '/api/matches' && req.method === 'GET') return json(200, service.matches(url.searchParams.get('request_id')));
        if (path === '/api/calls/dispatch' && req.method === 'POST') return json(200, await dispatchCall(store, input, env));
        if (path === '/api/demo/scenarios' && req.method === 'GET') return json(200, { scenarios });
        if (path === '/api/demo/step' && req.method === 'POST') {
          if (!demo) throw new AppError('Demo scenarios are disabled in live mode.', 403);
          return json(200, demoStep(service, input));
        }
        if (path === '/api/export' && req.method === 'GET') { res.setHeader('Content-Disposition', 'attachment; filename="relay-operations.json"'); return json(200, { exportedAt: new Date().toISOString(), mode: workspaceMode, ...service.snapshot() }); }
        throw new AppError('Endpoint not found.', 404);
      }
      if (!['GET','HEAD'].includes(req.method)) throw new AppError('Method not allowed.', 405);
      if (path === '/') { res.writeHead(302, { Location: '/coordinator/' }); res.end(); return; }
      const aliases = { '/coordinator/': 'index.html', '/coordinator': 'index.html', '/coordinator/sign-in': 'index.html', '/volunteer/': 'join.html', '/volunteer': 'join.html', '/volunteer/sign-in': 'join.html', '/volunteer/sign-up': 'join.html' };
      const filename = aliases[path] || decodeURIComponent(path).slice(1);
      const publicRoot = join(root, 'public');
      const file = resolve(publicRoot, filename);
      if (!file.startsWith(publicRoot + '/')) throw new AppError('Not found.', 404);
      const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
      const content = await readFile(file).catch(() => { throw new AppError('Not found.', 404); });
      res.writeHead(200, { 'Content-Type': `${types[extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) { if (!res.headersSent) json(error.status || 500, { error: error.status ? error.message : 'Unexpected server error. No action is confirmed; refresh the workspace.' }); else res.end(); }
  });
  const cleanup = env.SERVERLESS === 'true' ? null : setInterval(() => { for (const [k, v] of sessions) if (v < Date.now()) sessions.delete(k); for (const [k, v] of rates) if (v.until < Date.now()) rates.delete(k); }, 60000); cleanup?.unref();
  const dispatchWorker = env.SERVERLESS === 'true' ? null : setInterval(() => { try { dispatcher.tick(); dispatcher.flushNotifications().catch(()=>{}); } catch { /* retry evaluation on next tick, never repeat an uncertain SMS */ } }, 5000); dispatchWorker?.unref();
  server.on('close', () => { clearInterval(cleanup); clearInterval(dispatchWorker); store.close(); });
  return { server, service, store, config, dispatcher, members, residents };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createApp();
  const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 3000);
  server.listen(port, host, () => console.log(`Relay is ready at http://${host}:${port} · ${process.env.DEMO_MODE === 'false' ? 'live workspace' : 'exercise mode'}`));
}
