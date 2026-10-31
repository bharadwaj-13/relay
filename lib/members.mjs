import { randomBytes, randomInt, randomUUID, scryptSync, createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from './domain.mjs';
import { sendSms } from './messaging.mjs';
const digest = x => createHash('sha256').update(x).digest('hex');
const now = () => new Date().toISOString();
const clean = (v, max = 150) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw new AppError('Please complete the required fields.'); return v.trim(); };
export const phoneNumber = value => { const phone = String(value ?? '').replace(/[\s()-]/g, ''); if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new AppError('Enter a phone number with + and country code.'); return phone; };
export function locationFields(input) {
  if (input.lat == null && input.lng == null) return { lat: null, lng: null };
  if (![input.lat, input.lng].every(Number.isFinite) || Math.abs(input.lat) > 90 || Math.abs(input.lng) > 180) throw new AppError('Provide valid coordinates together.');
  if (input.locationConsent !== true) throw new AppError('Confirm permission to save this location.');
  const accuracy = input.accuracy == null ? null : Number(input.accuracy);
  if (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100000)) throw new AppError('Invalid GPS accuracy.');
  return { lat: input.lat, lng: input.lng, locationAccuracy: accuracy, locationCapturedAt: now() };
}
export class MemberService {
  constructor(service, dispatcher, env) { this.service = service; this.store = service.store; this.dispatcher = dispatcher; this.env = env; this.demo = this.store.meta('workspace_mode') === 'demo'; }
  async signup(input) {
    const name = clean(input.name, 100), phone = phoneNumber(input.phone), password = input.password;
    if (typeof password !== 'string' || password.length < 10 || password.length > 128 || !password.trim()) throw new AppError('Use a password of 10–128 characters.');
    if (!['volunteer', 'supplier', 'both'].includes(input.role)) throw new AppError('Choose volunteer, supplier, or both.');
    if(input.portal && (!['volunteer','supplier'].includes(input.portal)||![input.portal,'both'].includes(input.role)))throw new AppError('Choose a role supported by this portal.');
    if (input.consent !== true) throw new AppError('Confirm that you want to join and receive account verification.');
    if (this.store.list('accounts').some(a => a.phone === phone)) throw new AppError('An account already exists for this number. Sign in or contact the coordinator for account recovery.', 409);
    const salt = randomBytes(16).toString('hex');
    const account = { id: randomUUID(), name, phone, role: input.role, passwordSalt: salt, passwordHash: scryptSync(password, salt, 64).toString('hex'), phoneVerified: false, createdAt: now(), volunteerId: null };
    const code = String(randomInt(100000, 1000000));
    this.store.atomic(() => {
      this.store.put('accounts', account);
      this.store.put('verification', { id: `verify:${account.id}`, codeHash: digest(code), attempts: 0, expiresAt: Date.now() + 10 * 60000 });
      this.store.audit(`${name} joined as ${input.role} · phone verification pending`, account.id, 'Public signup');
    });
    const delivery = this.demo ? { status: 'demo_code' } : await sendSms(this.env, phone, `Your Relay signup verification code is ${code}. It expires in 10 minutes. Do not share it.`);
    return { accountId: account.id, verification: delivery.status, ...(this.demo ? { developmentCode: code } : {}), message: this.demo ? 'Exercise mode: use the displayed test code. No SMS was sent.' : 'Enter the code if received. A submitted SMS is not proof of handset delivery.' };
  }
  verify(input) {
    const account = this.store.get('accounts', input.accountId), challenge = this.store.get('verification', `verify:${input.accountId}`);
    if (!account || !challenge || account.phoneVerified || challenge.expiresAt < Date.now() || challenge.attempts >= 5) throw new AppError('Verification expired or unavailable. Contact the coordinator if you cannot verify.', 400);
    const valid = typeof input.code === 'string' && timingSafeEqual(Buffer.from(challenge.codeHash, 'hex'), Buffer.from(digest(input.code), 'hex'));
    this.store.atomic(() => { challenge.attempts++; this.store.put('verification', challenge); });
    if (!valid) throw new AppError('Incorrect verification code.');
    this.store.atomic(() => {
      account.phoneVerified = true;
      if (account.role !== 'supplier') {
        let volunteer = this.store.list('volunteers').find(v => v.phone === account.phone);
        if (volunteer && volunteer.accountId && volunteer.accountId !== account.id) throw new AppError('This volunteer profile belongs to another account.', 409);
        if (!volunteer) volunteer = this.service.registerVolunteer({ name: account.name, phone: account.phone, location: 'Location not yet shared', vehicle: 'Not specified' }, 'Public signup').volunteer;
        volunteer.accountId = account.id;
        this.store.put('volunteers', volunteer); account.volunteerId = volunteer.id;
      }
      this.store.put('accounts', account); this.store.audit(`${account.name} · phone verified`, account.id, 'Public signup');
    });
    return { verified: true, message: 'Account verified. You can sign in now.' };
  }
  login(input) {
    const phone = phoneNumber(input.phone), account = this.store.list('accounts').find(a => a.phone === phone);
    const candidate = typeof input.password === 'string' && input.password.length <= 128 ? input.password : '';
    const hash = scryptSync(candidate, account?.passwordSalt || 'unavailable-account', 64);
    if (!account || !timingSafeEqual(hash, Buffer.from(account.passwordHash, 'hex'))) throw new AppError('Incorrect phone number or password.', 401);
    if (!account.phoneVerified) throw new AppError('Verify your phone before signing in.', 403);
    if(input.portal && (!['volunteer','supplier'].includes(input.portal)||![input.portal,'both'].includes(account.role)))throw new AppError(`Use the sign-in for your ${account.role} account.`,403);
    const token = randomBytes(32).toString('hex');
    this.store.atomic(() => this.store.put('memberSessions', { id: digest(token), accountId: account.id, portal:input.portal||null, expiresAt: Date.now() + 12 * 3600000 }));
    return { token };
  }
  account(token) {
    const session = typeof token === 'string' ? this.store.get('memberSessions', digest(token)) : null;
    if (!session || session.expiresAt < Date.now()) throw new AppError('Sign in to your volunteer or supplier account.', 401);
    const account = this.store.get('accounts', session.accountId);
    if (!account?.phoneVerified) throw new AppError('Account unavailable.', 401);
    return account;
  }
  logout(token) { if (token) this.store.atomic(() => { const session = this.store.get('memberSessions', digest(token)); if (session) this.store.put('memberSessions', { ...session, expiresAt: 0 }); }); }
  requirePortal(token,portal) {
    const a=this.account(token),session=this.store.get('memberSessions',digest(token));
    if(!['volunteer','supplier'].includes(portal)||![portal,'both'].includes(a.role)||(session.portal&&session.portal!==portal))throw new AppError(`Sign in through the ${portal} portal to use this workspace.`,403);
    return a;
  }
  me(token,portal) {
    const session=typeof token==='string'?this.store.get('memberSessions',digest(token)):null;
    portal ||= session?.portal;
    const a = portal?this.requirePortal(token,portal):this.account(token), volunteer = portal!=='supplier'&&a.volunteerId ? this.store.get('volunteers', a.volunteerId) : null;
    const offers = this.store.list('notifications').filter(n => volunteer && n.volunteerId === volunteer.id).map(n => { const task=this.dispatcher.task(n.token); return { id: n.id, status: n.status, taskUrl: this.dispatcher.linkFor(n), assignment: task.assignment, pickup: task.pickup, delivery: task.request }; });
    const capacities=volunteer?this.dispatcher.capacities(volunteer):{};
    return { account: { id: a.id, name: a.name, phone: a.phone, role: a.role }, portal:portal||null, profile: { location: a.location || volunteer?.location || '', lat: a.lat ?? volunteer?.lat, lng: a.lng ?? volunteer?.lng, accuracy: a.locationAccuracy ?? volunteer?.locationAccuracy, vehicle: volunteer?.vehicle || '', organization: a.organization || '' }, volunteer, deliveryLimits: { water: capacities.water?.unit==='litres'?capacities.water.maxQuantity:0, food: capacities.food?.unit==='meals'?capacities.food.maxQuantity:0 }, offers, supplies: portal==='volunteer'?[]:this.store.list('resources').filter(r => r.ownerAccountId === a.id), exercise: this.demo };
  }
  profile(token, input) {
    if (input.locationConsent !== true) throw new AppError('Confirm permission to save this location.');
    const a = this.account(token), location = clean(input.location, 250), geo = locationFields(input);
    return this.store.atomic(() => {
      Object.assign(a, { location, ...geo, organization: typeof input.organization === 'string' ? input.organization.trim().slice(0, 100) : '' });
      this.store.put('accounts', a);
      if (a.volunteerId) {
        const v = this.service.required('volunteers', a.volunteerId);
        if (this.store.list('assignments').some(x => x.volunteerId === v.id && ['offered','approved','in_progress','awaiting_confirmation'].includes(x.status))) throw new AppError('Complete or resolve your active task before changing your dispatch location.', 409);
        Object.assign(v, { location, ...geo, vehicle: clean(input.vehicle || 'On foot', 100) });
        // A changed location requires explicit enrollment again, not silent carry-over.
        v.dispatch = null; this.store.put('volunteers', v);
      }
      this.store.audit(`${a.name} updated their profile`, a.id, 'Self-service'); return { saved: true };
    });
  }
  enroll(token, input) {
    const a = this.requirePortal(token,'volunteer');
    if (!a.volunteerId) throw new AppError('This is a supplier-only account.', 403);
    if (input.resource_id !== undefined) throw new AppError('Pickup sources are selected automatically, not by the volunteer.');
    const result = this.dispatcher.enroll({ ...input, volunteer_id: a.volunteerId });
    this.store.atomic(() => {
      const v = this.service.required('volunteers', a.volunteerId);
      if (v.dispatch) { v.dispatch.enrollmentSource = 'self-service'; delete v.dispatch.reviewedAt; this.store.put('volunteers', v); }
    });
    return { enrolled: !!result.volunteer.dispatch };
  }
  availability(token, input) {
    const a = this.requirePortal(token,'volunteer'); if (!a.volunteerId) throw new AppError('Volunteer access required.', 403);
    return this.service.run('update_volunteer', { volunteer_id: a.volunteerId, status: input.status, reason: String(input.reason || '').slice(0, 500) }, 'Self-service volunteer');
  }
  addSupply(token, input) {
    const a = this.requirePortal(token,'supplier');
    const geo = locationFields(input);
    return this.store.atomic(() => {
      const resource = this.service.addResource({ name: input.name, category: input.category, quantity: input.quantity, unit: input.unit, location: input.location || a.location, provider: a.organization || a.name, ...geo }, 'Self-service supplier').resource;
      Object.assign(resource, geo, { ownerAccountId: a.id, verification: 'reported' }); this.store.put('resources', resource);
      return { resource, message: 'Supply offer published for verification. It is not yet available for dispatch.' };
    });
  }
}
