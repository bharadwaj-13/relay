import { randomBytes, randomUUID } from 'node:crypto';
import { AppError } from './domain.mjs';
import { phoneNumber, locationFields } from './members.mjs';
import { sendSms } from './messaging.mjs';
const normalized = v => String(v || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export const phoneMenu = [
  { key: '1', intent: 'new_request', label: 'Request help' }, { key: '2', intent: 'track', label: 'Track my request' },
  { key: '3', intent: 'update', label: 'Correct or cancel a request' }, { key: '4', intent: 'offer_help', label: 'Volunteer or offer supplies' },
  { key: '5', intent: 'confirm_receipt', label: 'Confirm supplies received' }, { key: '9', intent: 'coordinator', label: 'Ask for a coordinator callback' }
];
const spokenStatus = { new: 'Your request is recorded and waiting for a match.', needs_review: 'Your request needs a coordinator to review it.', awaiting_volunteer: 'A volunteer has been offered your task. They have not accepted yet.', assigned: 'A volunteer has accepted your task. Pickup is not yet confirmed.', in_progress: 'The volunteer has reported picking up the supplies. Delivery is not yet confirmed.', awaiting_confirmation: 'The volunteer reported delivery. We are waiting for you to confirm receipt.', delivered: 'Receipt has been confirmed and the request is complete.', cancelled: 'This request has been cancelled.' };
export class ResidentService {
  constructor(service, env) { this.service = service; this.store = service.store; this.env = env; service.residents = this; }
  phone(input) {
    const call = input.call_id ? this.store.get('calls', input.call_id) : null;
    const fromCall = call?.source === 'vaani' && call.phone ? call.phone : null;
    return { phone: phoneNumber(fromCall || input.phone), source: fromCall ? 'authenticated_call_event' : 'caller_supplied' };
  }
  context(input) {
    const { phone, source } = this.phone(input);
    const returning = this.store.list('requests').some(r => normalized(r.phone) === normalized(phone));
    return { returningCaller: returning, numberSource: source, menu: phoneMenu, opening: returning ? 'Welcome back to Relay. Say 1 to request help, 2 to track your request, or tell me what you need.' : 'Welcome to Relay. Say 1 to request help, 2 to track a request, or tell me what you need.', identityNote: 'Number recognition is not proof of identity. Confirm the name before reading request status.', keypadSupport: 'Speech works. Physical keypad/DTMF needs verified carrier/Vaani support.' };
  }
  ownRequests(input) {
    const { phone } = this.phone(input);
    if (typeof input.name !== 'string' || !input.name.trim()) throw new AppError('Ask the caller for the name used on the request.');
    return this.store.list('requests').filter(r => normalized(r.phone) === normalized(phone) && normalized(r.name) === normalized(input.name) && (!input.request_id || r.id === input.request_id));
  }
  track(input) {
    return { requests: this.ownRequests(input).map(r => ({ reference: r.id, category: r.category, quantity: r.quantity, unit: r.unit, status: r.status, explanation: r.locationPending ? 'Your request is saved. We still need your delivery location.' : spokenStatus[r.status] || 'A coordinator is reviewing this request.', updatedAt: r.updatedAt })), note: 'References are internal: do not read them aloud unless the caller asks. If several requests match, ask which supply type they mean. No invented ETA or private details.' };
  }
  async requestHelp(input) {
    if (input.confirmed !== true || input.consent !== true) throw new AppError('Briefly confirm the need and permission to save the delivery location or send its link.');
    const spoken=input.location_method==='spoken';
    if(spoken&&!input.location?.trim())throw new AppError('Ask for the delivery address or landmark at the end of the call.');
    const {phone}=this.phone(input);
    if(typeof input.action_id!=='string'||!input.action_id.trim())throw new AppError('Use one stable action_id for this confirmed request.');
    const saved=this.service.run('create_request',{action_id:input.action_id,name:input.name,phone,category:input.category,quantity:input.quantity,unit:input.unit,people:input.people??null,location:input.location?.trim()||'Awaiting resident location',location_pending:!input.location?.trim(),priority:input.priority||'normal',notes:input.notes||'',caller_confirmed:true},'Vaani agent');
    if(spoken){
      const request=this.store.get('requests',saved.request.id);
      request.locationSource='caller_spoken_landmark';this.store.put('requests',request);
      return {request_id:request.id,status:request.status,requestSaved:true,locationSaved:true,location:request.location,coordinatesKnown:Number.isFinite(request.lat)&&Number.isFinite(request.lng),say:'Your request and delivery location are saved. Thank you.',speechNote:'Stop here. Do not read references or claim GPS, SMS, acceptance or delivery.'};
    }
    const link=await this.locationLink({phone,name:saved.request.name,request_id:saved.request.id,consent:true});
    return {request_id:saved.request.id,status:this.store.get('requests',saved.request.id).status,requestSaved:true,locationLinkStatus:link.status,...(link.exerciseUrl?{exerciseUrl:link.exerciseUrl}:{}),say:link.status==='submitted'?'Your request is saved. Check your texts for the location link.':link.status==='queued'?'Your request is saved. Your location text is queued.':link.status==='send_uncertain'?'Your request is saved, but the location text may not have gone through.':link.status==='demo_link'?'Your request is saved. This test has not sent a real text.':'Your request is saved. Texting is not connected yet.',speechNote:'Do not read the reference, action ID, URL, or tool arguments aloud. End after this one short status sentence.'};
  }
  confirmReceipt(input) {
    if (input.confirmed !== true || !input.request_id) throw new AppError('Read back the exact request and ask whether the supplies were received.');
    const request = this.ownRequests(input).find(r => r.id === input.request_id);
    if (!request) throw new AppError('No matching request for this name and number.', 404);
    if (request.status === 'delivered') return { confirmed: true, request_id: request.id };
    const assignment = this.store.list('assignments').find(a => a.requestId === request.id && a.status === 'awaiting_confirmation');
    if (!assignment) throw new AppError('No reported delivery is awaiting receipt confirmation.', 409);
    this.service.run('transition_assignment', { assignment_id: assignment.id, status: 'delivered', confirmation: `Resident ${request.name} explicitly confirmed receipt by phone.`, action_id: `resident-receipt:${assignment.id}` }, 'Resident confirmation');
    return { confirmed: true, request_id: request.id, message: 'Receipt recorded. Thank you for confirming.' };
  }
  cancel(input) {
    if (input.confirmed !== true) throw new AppError('Ask the resident to confirm cancellation of this exact request.');
    const request = this.ownRequests(input).find(r => r.id === input.request_id);
    if (!request) throw new AppError('No matching request for this name and number.', 404);
    if (request.status === 'cancelled') return { cancelled: true, reference: request.id };
    return this.service.run('update_request', { request_id: request.id, status: 'cancelled', action_id: `resident-cancel:${request.id}` }, 'Resident phone request');
  }
  callback(input) {
    const { phone } = this.phone(input);
    if (input.consent !== true || !input.name?.trim() || !input.reason?.trim() || input.name.length > 100 || input.reason.length > 1000) throw new AppError('Confirm the name, callback number, reason and permission to call back.');
    const existing = this.store.list('calls').find(c => c.status === 'callback_requested' && c.phone === phone);
    if (existing) return { reference: existing.id, status: existing.status, message: 'Callback already requested. No response time is guaranteed.' };
    return this.store.atomic(() => {
      const call = { id: `CB-${randomUUID().slice(0,8)}`, name: input.name.trim(), phone, summary: input.reason.trim(), status: 'callback_requested', source: 'resident_request', createdAt: new Date().toISOString(), transcript: [], consent: true };
      this.store.put('calls', call); this.store.audit(`${call.id} · resident requested a coordinator callback`, call.id, 'Resident phone request');
      return { reference: call.id, status: call.status, message: 'Callback request recorded in the Voice center. No response time is guaranteed. This does not contact emergency services.' };
    });
  }
  async locationLink(input) {
    if (input.consent !== true) throw new AppError('Ask permission to send a location-sharing text.');
    const request = this.ownRequests(input).find(r => r.id === input.request_id);
    if (!request) throw new AppError('Request not found for that caller.', 404);
    if (['delivered','cancelled'].includes(request.status)) throw new AppError('This request is closed.', 409);
    let link = this.store.list('locationLinks').find(l => l.requestId === request.id && l.expiresAt > Date.now() && !l.usedAt);
    const base = (this.env.RESIDENT_PUBLIC_BASE_URL || this.env.PUBLIC_BASE_URL || `http://127.0.0.1:${this.env.PORT || 3000}`).replace(/\/$/, '');
    const scopedUrl=token=>`${base}/location.html${this.env.WORKSPACE_SLUG?`?org=${encodeURIComponent(this.env.WORKSPACE_SLUG)}`:''}#${token}`;
    if (link) return { status: link.delivery?.status || 'pending', ...(this.store.meta('workspace_mode') === 'demo' ? { exerciseUrl:scopedUrl(link.token) } : {}), message: 'An unexpired location link already exists. Do not claim it was delivered.' };
    link = { id: randomUUID(), requestId: request.id, token: randomBytes(32).toString('hex'), expiresAt: Date.now() + 30 * 60000, usedAt: null };
    this.store.atomic(() => this.store.put('locationLinks', link));
    const url = scopedUrl(link.token);
    const demo=this.store.meta('workspace_mode') === 'demo',realSms=!demo||this.env.ENABLE_EXERCISE_SMS==='true';
    let delivery;
    if(!realSms)delivery={status:'demo_link'};
    else if(!base.startsWith('https://'))delivery={status:'configuration_required',reason:'A public HTTPS location origin is required.'};
    else delivery=await sendSms(this.env,phoneNumber(request.phone),`${demo?'Relay test:':'Relay:'} Share your delivery location: ${url} . Tap the link, allow location access, and confirm the delivery point. Expires in 30 minutes.`);
    this.store.atomic(() => this.store.put('locationLinks', { ...link, delivery }));
    return { status: delivery.status, ...(this.store.meta('workspace_mode') === 'demo' ? { exerciseUrl: url } : {}), message: 'Link prepared. Browser permission is required. An ordinary phone call does not expose GPS. Offer spoken landmark fallback if SMS or data is unavailable.' };
  }
  link(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new AppError('Invalid location link.', 401);
    const link = this.store.list('locationLinks').find(l => l.token === token);
    if (!link || link.expiresAt < Date.now()) throw new AppError('Location link expired or unavailable.', 401);
    return link;
  }
  locationInfo(token) {
    const link = this.link(token), request = this.service.required('requests', link.requestId);
    return { request_id: request.id, landmark: request.locationPending?'':request.location, saved: !!link.usedAt, exercise: this.store.meta('workspace_mode') === 'demo', reverseGeocoding: !!this.env.GOOGLE_MAPS_API_KEY };
  }
  capture(token, input) {
    const link = this.link(token); if (link.usedAt) return { saved: true, message: 'Location already saved.' };
    if (input.locationConsent !== true) throw new AppError('Confirm permission to save this delivery location.');
    const geo = locationFields(input);
    if (input.landmark != null && (typeof input.landmark !== 'string' || input.landmark.length > 250)) throw new AppError('Use a short landmark or entrance.');
    const landmark=input.landmark?.trim()||'';
    if(!landmark&&geo.lat==null)throw new AppError('Share your GPS point or enter a landmark.');
    return this.store.atomic(() => {
      const request = this.service.required('requests', link.requestId);
      if (['delivered','cancelled'].includes(request.status)) throw new AppError('Request is closed.', 409);
      if (this.store.list('assignments').some(a => a.requestId === request.id && ['offered','approved','in_progress','awaiting_confirmation'].includes(a.status))) throw new AppError('A delivery is already assigned. Ask the coordinator to review a destination change.', 409);
      Object.assign(request, geo, { location: landmark||'Resident-shared GPS point', locationPending:false, version: request.version + 1, updatedAt: new Date().toISOString(), locationSource: geo.lat == null ? 'resident_landmark' : 'resident_browser_gps' });
      const duplicates = this.store.list('requests').filter(r => r.id !== request.id && !r.locationPending && !['delivered','cancelled'].includes(r.status) && r.category === request.category && ((landmark&&normalized(r.location) === normalized(request.location))||(geo.lat!=null&&r.lat!=null&&Math.abs(r.lat-geo.lat)<0.00005&&Math.abs(r.lng-geo.lng)<0.00005)));
      if (duplicates.length) { request.duplicateCandidates = duplicates.map(r => r.id); request.status = 'needs_review'; request.verification = 'reported'; }
      if (geo.locationAccuracy > 150) { request.status = 'needs_review'; request.verification = 'reported'; }
      this.store.put('requests', request); this.store.put('locationLinks', { ...link, usedAt: Date.now() });
      this.store.audit(`${request.id} · resident confirmed delivery location`, request.id, 'Resident location share');
      this.service.automation?.reconcile();
      return { saved: true, message: geo.lat == null ? 'Landmark saved. Precise coordinates remain unknown.' : 'Location and landmark saved. The volunteer can navigate to this confirmed point.' };
    });
  }
  async reverse(input) {
    const geo = locationFields(input);
    if (geo.lat == null) throw new AppError('Capture GPS coordinates first.');
    if (!this.env.GOOGLE_MAPS_API_KEY) return { address: null, source: 'manual', message: 'GPS captured. Enter a recognizable landmark; automatic address lookup is not configured.' };
    try {
      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json'); url.searchParams.set('latlng', `${geo.lat},${geo.lng}`); url.searchParams.set('key', this.env.GOOGLE_MAPS_API_KEY);
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) }); const data = await response.json();
      return { address: response.ok && data.status === 'OK' ? data.results?.[0]?.formatted_address || null : null, source: 'Google Geocoding', message: 'Suggested address only. Confirm or correct the landmark before saving.' };
    } catch { return { address: null, source: 'manual', message: 'Address lookup unavailable. Enter a landmark manually.' }; }
  }
}
