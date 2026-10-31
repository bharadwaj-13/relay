import { randomUUID, createHash } from 'node:crypto';

export class AppError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const now = () => new Date().toISOString();
const id = prefix => `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
export const categories = ['water', 'food', 'shelter', 'transport', 'medical', 'other'];
const priorities = ['urgent', 'high', 'normal', 'low'];
const text = (v, name, max = 500, required = true) => {
  if (v === undefined && !required) return '';
  if (typeof v !== 'string' || (required && !v.trim()) || v.length > max) throw new AppError(`${name} must be ${required ? 'a non-empty' : 'a'} string, up to ${max} characters.`);
  return v.trim();
};
const integer = (v, name, min = 1, max = 100000) => { if (!Number.isSafeInteger(v) || v < min || v > max) throw new AppError(`${name} must be an integer from ${min} to ${max}.`); return v; };
const choose = (v, values, name) => { if (!values.includes(v)) throw new AppError(`Invalid ${name}. Choose ${values.join(', ')}.`); return v; };
const coords = input => {
  if (input.lat == null && input.lng == null) return { lat: null, lng: null };
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lng) || Math.abs(input.lat) > 90 || Math.abs(input.lng) > 180) throw new AppError('Provide valid latitude and longitude together.');
  return { lat: input.lat, lng: input.lng };
};
const norm = value => String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
const distance = (a, b) => {
  if (a.lat == null || b.lat == null) return null;
  const rad = n => n * Math.PI / 180;
  const dlat = rad(b.lat - a.lat), dlng = rad(b.lng - a.lng);
  return 6371 * 2 * Math.asin(Math.sqrt(Math.sin(dlat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlng / 2) ** 2));
};
const transitions = {
  offered: ['approved', 'cancelled'],
  proposed: ['approved', 'cancelled'], approved: ['in_progress', 'cancelled'],
  in_progress: ['awaiting_confirmation', 'cancelled'], awaiting_confirmation: ['delivered', 'cancelled'],
  delivered: [], cancelled: []
};

export class ReliefService {
  constructor(store) { this.store = store; }
  required(kind, key) { const item = this.store.get(kind, key); if (!item) throw new AppError(`${kind} record not found.`, 404); return item; }
  run(operation, input, actor = 'Coordinator') {
    const actionId = input.action_id;
    if (actionId !== undefined) text(actionId, 'action_id', 200);
    // Stable field order makes retries independent of JSON key ordering.
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
    const fingerprint = createHash('sha256').update(JSON.stringify(canonical({ ...input, action_id: undefined }))).digest('hex');
    return this.store.atomic(() => {
      if (actionId) {
        const previous = this.store.db.prepare('SELECT * FROM actions WHERE id=?').get(actionId);
        if (previous) {
          if (previous.operation !== operation || previous.fingerprint !== fingerprint) throw new AppError('This action_id was already used for a different operation or payload.', 409);
          return JSON.parse(previous.result);
        }
      }
      let result;
      switch (operation) {
        case 'create_request': result = this.createRequest(input, actor); break;
        case 'update_request': result = this.updateRequest(input, actor); break;
        case 'register_volunteer': result = this.registerVolunteer(input, actor); break;
        case 'add_resource': result = this.addResource(input, actor); break;
        case 'update_volunteer': result = this.updateVolunteer(input, actor); break;
        case 'propose_assignment': result = this.proposeAssignment(input, actor); break;
        case 'transition_assignment': result = this.transitionAssignment(input, actor); break;
        case 'add_advisory': result = this.addAdvisory(input, actor); break;
        case 'save_shelter': result = this.saveShelter(input, actor); break;
        case 'verify_resource': result = this.verifyResource(input, actor); break;
        default: throw new AppError('Unknown operation.', 404);
      }
      this.automation?.reconcile();
      if (result.request) {
        result.request = this.store.get('requests', result.request.id);
        if (result.request.status === 'awaiting_volunteer') result.message = 'Request recorded. A volunteer has been offered the job; acceptance is pending.';
      }
      if (actionId) this.store.db.prepare('INSERT INTO actions VALUES(?,?,?,?)').run(actionId, operation, fingerprint, JSON.stringify(result));
      return result;
    });
  }
  findRequests({ query = '', request_id } = {}) {
    if (request_id) return [this.required('requests', request_id)];
    const q = norm(text(query, 'query', 200, false));
    return this.store.list('requests').filter(r => !q || [r.id, r.location, r.name, r.phone].some(x => norm(x).includes(q)));
  }
  createRequest(input, actor) {
    // Exact preconfigured fictional landmarks only, never inferred resident GPS.
    if(this.store.meta('workspace_mode')==='demo' && input.lat==null && !input.location_pending){
      const point=JSON.parse(this.store.meta('exercise_landmarks')||'[]').find(p=>norm(p.name)===norm(input.location));
      if(point)input={...input,lat:point.lat,lng:point.lng,notes:`${input.notes||''} [EXERCISE: fictional landmark coordinates, not captured GPS.]`.trim()};
    }
    const request = {
      id: id('REQ'), name: text(input.name, 'Name', 100), phone: text(input.phone, 'Contact', 60, false),
      location: text(input.location, 'Location', 250), category: choose(input.category, categories, 'category'),
      quantity: integer(input.quantity, 'Quantity'), people: input.people === null ? null : integer(input.people ?? 1, 'People', 1, 10000),
      unit: text(input.unit ?? ({ water: 'litres', food: 'meals', shelter: 'beds', transport: 'seats' }[input.category] || 'units'), 'Unit', 40),
      priority: choose(input.priority ?? 'normal', priorities, 'priority'), notes: text(input.notes ?? '', 'Notes', 2000, false),
      ...coords(input), status: 'new', verification: 'reported', source: actor === 'Vaani agent' ? 'voice' : 'coordinator',
      createdAt: now(), updatedAt: now(), version: 1, urgentReview: input.priority === 'urgent' || input.category === 'medical', callerConfirmed: input.caller_confirmed === true, locationPending: input.location_pending === true
    };
    const duplicates = request.locationPending ? [] : this.store.list('requests').filter(r => !r.locationPending && !['delivered', 'cancelled'].includes(r.status) && r.category === request.category && norm(r.location) === norm(request.location));
    request.duplicateCandidates = duplicates.map(r => r.id);
    if (duplicates.length || request.urgentReview) request.status = 'needs_review';
    this.store.put('requests', request);
    this.store.audit(`${request.id} · ${request.quantity} ${request.unit} requested at ${request.location}${duplicates.length ? ' · possible duplicate' : ''}`, request.id, actor, request.urgentReview ? 'urgent' : 'info');
    return { request, duplicateCandidates: duplicates, message: 'Request recorded. Assistance has not been dispatched.', requiresCoordinator: request.urgentReview || !!duplicates.length };
  }
  updateRequest(input, actor) {
    const request = this.required('requests', input.request_id);
    if (input.version != null && input.version !== request.version) throw new AppError('Request changed. Refresh before saving.', 409);
    if (['delivered', 'cancelled'].includes(request.status)) throw new AppError('Closed requests cannot be edited.', 409);
    const active = this.store.list('assignments').some(a => a.requestId === request.id && ['offered', 'approved', 'in_progress', 'awaiting_confirmation'].includes(a.status));
    if (active && ['quantity', 'category', 'unit', 'location', 'lat', 'lng'].some(key => input[key] !== undefined && input[key] !== request[key])) throw new AppError('Cancel the active assignment before changing its quantity, category, unit, or destination.', 409);
    for (const key of ['name', 'location', 'phone', 'notes', 'unit']) if (input[key] !== undefined) request[key] = text(input[key], key, key === 'notes' ? 2000 : 250, !['phone', 'notes'].includes(key));
    if (input.category !== undefined) request.category = choose(input.category, categories, 'category');
    if (input.quantity !== undefined) request.quantity = integer(input.quantity, 'Quantity');
    if (input.people !== undefined) request.people = integer(input.people, 'People', 1, 10000);
    if (input.priority !== undefined) request.priority = choose(input.priority, priorities, 'priority');
    if (input.lat !== undefined || input.lng !== undefined) Object.assign(request, coords(input));
    if (input.verification !== undefined) {
      if (actor === 'Vaani agent') throw new AppError('Only a coordinator can verify a report.', 403);
      request.verification = choose(input.verification, ['reported', 'verified'], 'verification');
      if (request.verification === 'verified' && request.status === 'needs_review' && !active) { request.status = 'new'; request.duplicateCandidates = []; }
    }
    if (input.status === 'cancelled') {
      if (active) throw new AppError('Cancel the active assignment first.', 409);
      request.status = 'cancelled';
      for (const a of this.store.list('assignments').filter(a => a.requestId === request.id && a.status === 'proposed')) this.store.put('assignments', { ...a, status: 'cancelled', updatedAt: now() });
    } else if (input.status !== undefined) throw new AppError('Request status follows the assignment workflow.');
    request.urgentReview = request.priority === 'urgent' || request.category === 'medical';
    if (actor === 'Vaani agent' && !active && input.status !== 'cancelled') {
      request.verification = 'reported'; request.status = 'needs_review'; request.callerConfirmed = false;
    }
    if (request.urgentReview && input.verification !== 'verified' && !['delivered','cancelled'].includes(request.status)) request.status = 'needs_review';
    request.version++; request.updatedAt = now(); this.store.put('requests', request);
    this.store.audit(`${request.id} · request updated${input.verification === 'verified' ? ' and reviewed' : ''}`, request.id, actor);
    return { request };
  }
  registerVolunteer(input, actor) {
    const phone = text(input.phone, 'Phone', 60);
    const existing = this.store.list('volunteers').find(v => norm(v.phone) === norm(phone));
    if (existing) return { volunteer: existing, existing: true, message: 'Volunteer already registered. Use update_volunteer to change availability.' };
    const volunteer = { id: id('VOL'), name: text(input.name, 'Name', 100), phone, location: text(input.location, 'Location', 250), ...coords(input), vehicle: text(input.vehicle ?? 'On foot', 'Vehicle', 80), skills: Array.isArray(input.skills) ? input.skills.slice(0, 10).map(s => text(s, 'Skill', 60)) : [], status: 'available', createdAt: now() };
    this.store.put('volunteers', volunteer); this.store.audit(`${volunteer.name} joined the volunteer network`, volunteer.id, actor);
    return { volunteer };
  }
  updateVolunteer(input, actor) {
    const volunteer = this.required('volunteers', input.volunteer_id);
    volunteer.status = choose(input.status, ['available', 'paused'], 'status');
    const assignment = this.store.list('assignments').find(a => a.volunteerId === volunteer.id && ['offered', 'approved', 'in_progress', 'awaiting_confirmation'].includes(a.status));
    if (assignment && volunteer.status === 'available') throw new AppError('Volunteer has an active assignment.', 409);
    if (input.reason !== undefined) volunteer.reason = text(input.reason, 'Reason', 500, false);
    if (assignment) { const request = this.required('requests', assignment.requestId); request.status = 'needs_review'; request.version++; request.updatedAt = now(); this.store.put('requests', request); }
    this.store.put('volunteers', volunteer); this.store.audit(`${volunteer.name} · ${volunteer.status}${volunteer.reason ? ': ' + volunteer.reason : ''}`, volunteer.id, actor, assignment ? 'urgent' : 'info');
    return { volunteer, affectedAssignment: assignment ?? null, message: assignment ? 'Assignment requires coordinator review. Supplies remain reserved until cancelled.' : 'Availability updated.' };
  }
  addResource(input, actor) {
    const resource = { id: id('RES'), name: text(input.name, 'Resource name', 120), category: choose(input.category, categories, 'category'), quantity: integer(input.quantity, 'Quantity'), unit: text(input.unit, 'Unit', 40), location: text(input.location, 'Location', 250), ...coords(input), provider: text(input.provider, 'Provider', 100), verification: actor === 'Vaani agent' ? 'reported' : 'verified', createdAt: now() };
    this.store.put('resources', resource); this.store.audit(`${resource.quantity} ${resource.unit} added · ${resource.provider}`, resource.id, actor); return { resource };
  }
  verifyResource(input, actor) {
    if (actor === 'Vaani agent') throw new AppError('Only coordinators can verify offered supplies.', 403);
    const resource = this.required('resources', input.resource_id);
    resource.verification = 'verified'; resource.verifiedAt = now();
    this.store.put('resources', resource); this.store.audit(`Supply offer verified · ${resource.name}`, resource.id, actor);
    return { resource };
  }
  matches(requestId) {
    const request = this.required('requests', requestId);
    const resources = this.store.list('resources').filter(r => r.category === request.category && r.unit.toLowerCase() === request.unit.toLowerCase() && r.quantity >= request.quantity && r.verification === 'verified');
    const volunteers = this.store.list('volunteers').filter(v => v.status === 'available');
    return { requestId, matches: resources.flatMap(resource => volunteers.map(volunteer => ({ resource, volunteer, distanceKm: distance(volunteer, request), resourceDistanceKm: distance(resource, request), note: 'Straight-line proximity only. Coordinator must verify access, transport capacity, and route safety.' }))).sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9)).slice(0, 12) };
  }
  proposeAssignment(input, actor) {
    const request = this.required('requests', input.request_id);
    if (!['new', 'needs_review'].includes(request.status)) throw new AppError('Request is closed or already assigned.', 409);
    const resource = this.required('resources', input.resource_id), volunteer = this.required('volunteers', input.volunteer_id);
    this.assertMatch(request, resource, volunteer);
    const existing = this.store.list('assignments').find(a => a.requestId === request.id && a.resourceId === resource.id && a.volunteerId === volunteer.id && a.status === 'proposed');
    if (existing) return { assignment: existing, message: 'This proposal already awaits coordinator approval.' };
    const assignment = { id: id('ASN'), requestId: request.id, resourceId: resource.id, volunteerId: volunteer.id, quantity: request.quantity, status: 'proposed', createdAt: now(), updatedAt: now(), notes: text(input.notes ?? '', 'Notes', 1000, false) };
    this.store.put('assignments', assignment); this.store.audit(`${request.id} · match proposed with ${volunteer.name}`, request.id, actor);
    return { assignment, message: 'Proposed only. No supplies reserved and no volunteer dispatched until coordinator approval.' };
  }
  assertMatch(request, resource, volunteer) {
    if (resource.category !== request.category || resource.unit.toLowerCase() !== request.unit.toLowerCase()) throw new AppError('Resource category and unit must match the request.', 409);
    if (resource.verification !== 'verified') throw new AppError('Resource must be verified by a coordinator before assignment.', 409);
    if (resource.quantity < request.quantity) throw new AppError('Insufficient available stock. Refresh matching.', 409);
    if (volunteer.status !== 'available') throw new AppError('Volunteer is no longer available.', 409);
  }
  transitionAssignment(input, actor) {
    const assignment = this.required('assignments', input.assignment_id);
    const target = choose(input.status, Object.keys(transitions), 'assignment status');
    if (!transitions[assignment.status].includes(target)) throw new AppError(`Cannot move ${assignment.status} to ${target}.`, 409);
    if (actor === 'Vaani agent' && ['approved', 'delivered'].includes(target)) throw new AppError('Coordinator approval or delivery verification is required.', 403);
    const request = this.required('requests', assignment.requestId), resource = this.required('resources', assignment.resourceId), volunteer = this.required('volunteers', assignment.volunteerId);
    if (target === 'approved') {
      if (assignment.automatic) {
        if (assignment.status !== 'offered' || volunteer.status !== 'reserved' || request.status !== 'awaiting_volunteer') throw new AppError('This offer is no longer available.', 409);
        if (Date.parse(assignment.expiresAt) <= Date.now()) throw new AppError('Offer has expired.', 409);
        if (actor !== 'Volunteer') throw new AppError('The volunteer must accept this offer from their secure task link.', 403);
        if (request.urgentReview || request.duplicateCandidates?.length) throw new AppError('Request now requires coordinator review.', 409);
      } else {
      if (!['new', 'needs_review'].includes(request.status)) throw new AppError('Request is no longer available for assignment.', 409);
      if (request.verification !== 'verified') throw new AppError('Review and verify the request before approving an assignment.', 409);
      this.assertMatch(request, resource, volunteer);
      if (assignment.quantity !== request.quantity) throw new AppError('Request quantity changed; cancel this proposal and create another.', 409);
      resource.quantity -= assignment.quantity;
      }
      volunteer.status = 'busy'; request.status = 'assigned';
      assignment.approvedBy = actor; assignment.approvedAt = now();
      for (const other of this.store.list('assignments').filter(a => a.id !== assignment.id && a.requestId === request.id && a.status === 'proposed')) this.store.put('assignments', { ...other, status: 'cancelled', updatedAt: now() });
    }
    if (target === 'in_progress') {
      if (volunteer.status !== 'busy') throw new AppError('Volunteer unavailable. Coordinator must review the assignment.', 409);
      request.status = 'in_progress';
    }
    if (target === 'awaiting_confirmation') {
      if (volunteer.status !== 'busy') throw new AppError('Paused volunteer requires coordinator review.', 409);
      request.status = 'awaiting_confirmation';
    }
    if (target === 'delivered') {
      assignment.confirmation = text(input.confirmation, 'Delivery confirmation / recipient reference', 500);
      request.status = 'delivered'; volunteer.status = volunteer.status === 'paused' ? 'paused' : 'available';
    }
    if (target === 'cancelled') {
      assignment.cancellationReason = text(input.reason, 'Cancellation reason', 500);
      if (assignment.status !== 'proposed') {
        resource.quantity += assignment.quantity;
        volunteer.status = volunteer.status === 'paused' ? 'paused' : 'available';
        request.status = 'needs_review';
      }
    }
    assignment.status = target; assignment.updatedAt = now(); request.updatedAt = now(); request.version++;
    this.store.put('assignments', assignment); this.store.put('requests', request); this.store.put('resources', resource); this.store.put('volunteers', volunteer);
    this.store.audit(`${request.id} · ${target.replaceAll('_', ' ')}${target === 'cancelled' ? ' · stock released' : ''}`, request.id, actor, target === 'cancelled' ? 'warning' : 'info');
    return { assignment, request };
  }
  addAdvisory(input, actor) {
    if (actor === 'Vaani agent') throw new AppError('Only coordinators can publish verified advisories.', 403);
    const expiresAt = text(input.expiresAt, 'Expiry', 100);
    if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) throw new AppError('Advisory expiry must be in the future.');
    const advisory = { id: id('ADV'), title: text(input.title, 'Title', 150), body: text(input.body, 'Details', 2000), source: text(input.source, 'Source', 250), location: text(input.location, 'Area', 150), severity: choose(input.severity ?? 'info', ['info', 'warning', 'urgent'], 'severity'), expiresAt, updatedAt: now(), verification: 'coordinator-reviewed' };
    this.store.put('advisories', advisory); this.store.audit(`Advisory published · ${advisory.title}`, advisory.id, actor); return { advisory };
  }
  saveShelter(input, actor) {
    if (actor === 'Vaani agent') throw new AppError('Only coordinators can update verified shelter reports.', 403);
    const capacity = integer(input.capacity, 'Capacity', 0), occupied = integer(input.occupied, 'Occupied spaces', 0);
    if (occupied > capacity) throw new AppError('Occupied spaces cannot exceed capacity.');
    if (typeof input.accessible !== 'boolean') throw new AppError('Accessibility must be true or false.');
    if (input.shelter_id) this.required('shelters', input.shelter_id);
    const shelter = { id: input.shelter_id || id('SHL'), name: text(input.name, 'Shelter name', 150), location: text(input.location, 'Location', 250), capacity, occupied, accessible: input.accessible, contact: text(input.contact, 'Contact', 150), source: text(input.source, 'Source', 250), ...coords(input), updatedAt: now() };
    this.store.put('shelters', shelter); this.store.audit(`Shelter report updated · ${shelter.name}`, shelter.id, actor);
    return { shelter };
  }
  snapshot() {
    const data = Object.fromEntries(['requests', 'volunteers', 'resources', 'assignments', 'shelters', 'advisories', 'calls', 'events', 'notifications'].map(kind => [kind, this.store.list(kind).slice(0, kind === 'events' ? 150 : 1000)]));
    data.notifications = data.notifications.map(({ token, ...n }) => n);
    data.dispatchPolicy = this.automation?.policy() || { enabled: false, acceptConfirmedReports: false, radiusKm: 8, offerSeconds: 300 };
    return data;
  }
}
