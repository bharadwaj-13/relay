import { createHmac, timingSafeEqual, createHash, randomUUID } from 'node:crypto';
import { AppError } from './domain.mjs';

export function equalSecret(a, b) {
  return typeof a === 'string' && typeof b === 'string' && !!b && timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
export async function vaaniRequest(path, body, method = 'POST', env = process.env) {
  if (!env.VAANI_API_KEY) throw new AppError('Add VAANI_API_KEY to .env and restart the server.', 503);
  const base = env.VAANI_BASE_URL || 'https://api.vaanivoice.ai';
  const url = new URL(path, base);
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new AppError('VAANI_BASE_URL must use HTTPS.', 503);
  let response;
  try {
    response = await fetch(url, { method, headers: { 'X-API-Key': env.VAANI_API_KEY, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  } catch { throw new AppError('Vaani could not be reached. No call completion is confirmed. Check call history before retrying a dispatch.', 502); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.success === false) throw new AppError(`Vaani returned ${response.status}. Check the agent, telephony setup, and account API reference.`, 502);
  return result;
}
export async function dispatchCall(store, input, env = process.env) {
  if (!env.VAANI_AGENT_ID) throw new AppError('Configure VAANI_AGENT_ID before placing calls.', 503);
  if (!/^\+[1-9]\d{7,14}$/.test(input.phone || '')) throw new AppError('Use an E.164 phone number, including + and country code.');
  if (!input.consent) throw new AppError('Confirm that this person consented to the test or coordination call.');
  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 100) : '';
  if (!name) throw new AppError('Contact name is required.');
  const result = await vaaniRequest('/api/trigger-call/', {
    agent_id: env.VAANI_AGENT_ID, medium: 'telephony', name, contact_number: input.phone,
    metadata: { request_id: input.request_id || '', purpose: 'Consented relief coordination callback' },
    ...(env.VAANI_OUTBOUND_NUMBER ? { outbound_number: env.VAANI_OUTBOUND_NUMBER } : {})
  }, 'POST', env);
  const callId = result.output?.call_id || result.call_id;
  if (!callId) throw new AppError('Vaani accepted the request without a call reference. Check Vaani call history before retrying.', 502);
  store.atomic(() => {
    const prior = store.get('calls', callId);
    store.put('calls', { ...prior, id: callId, name, phone: input.phone, source: 'vaani', status: prior?.status || 'dispatched', createdAt: prior?.createdAt || new Date().toISOString(), requestId: input.request_id || null, transcript: prior?.transcript || [], summary: prior?.summary || '', providerRoom: prior?.providerRoom || callId });
    store.audit('Vaani callback dispatched · answer not yet confirmed', callId);
  });
  return { call_id: callId, message: 'Dispatched to Vaani. This does not mean answered or completed.' };
}
export function verifyWebhook(req, raw, env = process.env) {
  if (!env.WEBHOOK_SECRET) throw new AppError('Webhook authentication is not configured.', 503);
  const mode = env.VAANI_WEBHOOK_AUTH || 'shared-token';
  if (mode === 'shared-token') {
    if (!equalSecret(req.headers.authorization, `Bearer ${env.WEBHOOK_SECRET}`)) throw new AppError('Invalid webhook authorization.', 401);
  } else if (mode === 'secret-path') {
    const candidate = new URL(req.url, 'http://localhost').pathname.split('/').at(-1);
    if (!equalSecret(candidate, env.WEBHOOK_SECRET)) throw new AppError('Invalid webhook authorization.', 401);
  } else if (mode === 'hmac-sha256') {
    const signature = String(req.headers[env.VAANI_SIGNATURE_HEADER || 'x-vaani-signature'] || '').replace(/^sha256=/, '');
    const expected = createHmac('sha256', env.WEBHOOK_SECRET).update(raw).digest('hex');
    if (!equalSecret(signature, expected)) throw new AppError('Invalid webhook signature.', 401);
  } else throw new AppError('Unsupported webhook authentication mode.', 503);
}
export function ingestWebhook(store, payload) {
  if (!payload || typeof payload !== 'object') throw new AppError('Invalid webhook JSON.');
  const data = payload.data && typeof payload.data === 'object' ? payload.data : payload;
  const callId = String(payload.call_id || data.call_id || data.room_name || payload.room_name || '').slice(0, 180);
  const event = payload.event || payload.type;
  const statuses = { call_started: 'dialing', call_ringing: 'ringing', user_picked_up_at: 'active', call_ended: 'ended', call_postprocessing: 'completed', call_failed: 'failed', call_no_answer: 'no_answer', call_rejected: 'rejected', human_transfer_initiated: 'transfer_pending', human_transfer_successful: 'transferred', human_transfer_failed: 'transfer_failed' };
  if (!callId || !Object.hasOwn(statuses, event)) throw new AppError('Webhook requires a recognized event and call_id or room_name.');
  const fingerprint = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return store.atomic(() => {
    if (store.meta(`webhook:${fingerprint}`)) return { received: true, duplicate: true };
    const prior = store.get('calls', callId) || { id: callId, source: 'vaani', name: 'Vaani caller', transcript: [], createdAt: new Date().toISOString() };
    const terminal = ['completed','ended','failed','no_answer','rejected'];
    const next = statuses[event];
    const status = prior.status === 'completed' || (terminal.includes(prior.status) && !terminal.includes(next)) ? prior.status : next;
    const call = { ...prior, status, providerRoom: data.room_name || payload.room_name || prior.providerRoom, updatedAt: new Date().toISOString() };
    if (data.phone_number) call.phone = String(data.phone_number).slice(0, 60);
    if (event === 'call_postprocessing') {
      call.summary = String(data.summary || '').slice(0, 12000);
      call.transcript = typeof data.transcript === 'string' ? data.transcript.slice(0, 100000) : Array.isArray(data.transcript) ? data.transcript.slice(0, 1000) : [];
      call.durationSeconds = Number.isFinite(Number(data.call_duration)) ? Number(data.call_duration) / 1000 : null;
    } else if (event === 'call_ended' && Number.isFinite(Number(data.call_duration))) call.durationSeconds = Number(data.call_duration);
    store.put('calls', call); store.meta(`webhook:${fingerprint}`, '1');
    store.audit(`Vaani call · ${event.replaceAll('_', ' ')}`, callId, 'Vaani webhook', event === 'call_failed' ? 'warning' : 'info');
    return { received: true, call_id: callId };
  });
}
