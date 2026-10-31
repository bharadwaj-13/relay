import { randomUUID, randomBytes } from 'node:crypto';
import { AppError } from './domain.mjs';
import { sendSms } from './messaging.mjs';

const timestamp = () => new Date().toISOString();
const active = ['offered','approved','in_progress','awaiting_confirmation'];
export function distanceKm(a,b) {
  if (![a.lat,a.lng,b.lat,b.lng].every(Number.isFinite)) return Infinity;
  const rad=n=>n*Math.PI/180, dlat=rad(b.lat-a.lat), dlng=rad(b.lng-a.lng);
  return 6371*2*Math.asin(Math.sqrt(Math.sin(dlat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dlng/2)**2));
}
export class AutoDispatch {
  constructor(service, env={}) { this.service=service; this.store=service.store; this.env=env; this.flushing=false; service.automation=this; }
  policy() { return JSON.parse(this.store.meta('dispatch_policy') || '{"enabled":false,"acceptConfirmedReports":false,"radiusKm":8,"offerSeconds":300}'); }
  setPolicy(input) {
    if(typeof input.enabled!=='boolean'||typeof input.acceptConfirmedReports!=='boolean')throw new AppError('Policy switches must be booleans.');
    if(!Number.isFinite(input.radiusKm)||input.radiusKm<0.1||input.radiusKm>50)throw new AppError('Dispatch radius must be between 0.1 and 50 km.');
    if(!Number.isInteger(input.offerSeconds)||input.offerSeconds<30||input.offerSeconds>3600)throw new AppError('Offer timeout must be 30–3600 seconds.');
    return this.store.atomic(()=>{this.store.meta('dispatch_policy',JSON.stringify(input));this.store.audit(`Automatic dispatch ${input.enabled?'enabled':'paused'}`,null);this.reconcile();return this.policy();});
  }
  enroll(input) {
    const volunteer=this.service.required('volunteers',input.volunteer_id);
    if(typeof input.enabled!=='boolean')throw new AppError('Enrollment must be true or false.');
    if(!input.enabled)return this.store.atomic(()=>{volunteer.dispatch=null;this.store.put('volunteers',volunteer);this.store.audit(`${volunteer.name} removed from automatic dispatch`,volunteer.id);return {volunteer};});
    if(input.consent!==true)throw new AppError('Record volunteer consent for dispatch offers and notifications.');
    if(![volunteer.lat,volunteer.lng].every(Number.isFinite))throw new AppError('Volunteer coordinates are required before enabling offers.');
    if(volunteer.locationAccuracy>150)throw new AppError('Location is too imprecise. Recapture GPS or have the location reviewed.');
    let capacities;
    if(input.waterCapacity!==undefined||input.foodCapacity!==undefined) {
      const water=input.waterCapacity??0,food=input.foodCapacity??0;
      if(![water,food].every(n=>Number.isInteger(n)&&n>=0&&n<=100000)||water+food===0)throw new AppError('Set at least one positive carrying limit: litres of water or meals of food.');
      capacities={water:{maxQuantity:water,unit:'litres'},food:{maxQuantity:food,unit:'meals'}};
    } else {
      // Compatibility with old enrollments: use only the category/unit capacity,
      // never pin the volunteer to this resource or pickup location.
      const resource=this.service.required('resources',input.resource_id);
      if(!['water','food'].includes(resource.category)||resource.verification!=='verified')throw new AppError('Only verified food/water capacity can be migrated.');
      if(!Number.isInteger(input.maxQuantity)||input.maxQuantity<1||input.maxQuantity>100000)throw new AppError('Provide a positive carrying limit.');
      capacities={[resource.category]:{maxQuantity:input.maxQuantity,unit:resource.unit}};
    }
    if(!Number.isFinite(input.maxDistanceKm)||input.maxDistanceKm<.1||input.maxDistanceKm>50)throw new AppError('Volunteer radius must be 0.1–50 km.');
    if(!['in_app','sms'].includes(input.channel))throw new AppError('Choose in_app or sms.');
    if(input.channel==='sms'&&!/^\+[1-9]\d{7,14}$/.test(volunteer.phone))throw new AppError('SMS requires an E.164 contact number.');
    volunteer.dispatch={mode:'automatic',capacities,maxDistanceKm:input.maxDistanceKm,channel:input.channel,consentedAt:timestamp(),reviewedAt:timestamp()};
    return this.store.atomic(()=>{this.store.put('volunteers',volunteer);this.store.audit(`${volunteer.name} enabled nearest feasible pickup and delivery offers`,volunteer.id);this.reconcile();return {volunteer};});
  }
  capacities(volunteer) {
    if(volunteer.dispatch?.capacities)return volunteer.dispatch.capacities;
    const legacy=volunteer.dispatch,resource=legacy?.resourceId?this.store.get('resources',legacy.resourceId):null;
    return resource?{[resource.category]:{maxQuantity:legacy.maxQuantity,unit:resource.unit}}:{};
  }
  eligible(request,policy) {
    return request.status==='new' && ['water','food'].includes(request.category) && !request.urgentReview && request.priority!=='urgent' && !request.duplicateCandidates?.length && !(request.locationAccuracy>150) && (request.verification==='verified'||(policy.acceptConfirmedReports&&request.callerConfirmed===true)) && [request.lat,request.lng].every(Number.isFinite);
  }
  reconcile() {
    const policy=this.policy();if(!policy.enabled)return;
    // Private exercise configuration only; never overrides live routing or eligibility.
    const exerciseVolunteerId=this.store.meta('workspace_mode')==='demo'?this.store.meta('exercise_dispatch_volunteer_id'):null;
    const assignments=this.store.list('assignments');
    const resources=this.store.list('resources').filter(r=>r.verification==='verified'&&r.quantity>0&&!(r.locationAccuracy>150)&&[r.lat,r.lng].every(Number.isFinite));
    const volunteers=this.store.list('volunteers').filter(v=>(!exerciseVolunteerId||v.id===exerciseVolunteerId)&&v.status==='available'&&v.dispatch&&!(v.locationAccuracy>150)&&!assignments.some(a=>a.volunteerId===v.id&&active.includes(a.status)));
    const requests=this.store.list('requests').filter(r=>this.eligible(r,policy)&&!assignments.some(a=>a.requestId===r.id&&active.includes(a.status)));
    const candidates=[];
    for(const request of requests) {
      const tried=new Set(assignments.filter(a=>a.requestId===request.id&&a.automatic).map(a=>a.volunteerId));
      for(const volunteer of volunteers) {
        if(tried.has(volunteer.id))continue;
        const capacity=this.capacities(volunteer)[request.category];
        if(!capacity||capacity.maxQuantity<request.quantity||capacity.unit.toLowerCase()!==request.unit.toLowerCase())continue;
        for(const resource of resources) {
          if(resource.category!==request.category||resource.unit.toLowerCase()!==request.unit.toLowerCase()||resource.quantity<request.quantity)continue;
          const leg1=distanceKm(volunteer,resource),leg2=distanceKm(resource,request),km=leg1+leg2;
          if(km<=Math.min(policy.radiusKm,volunteer.dispatch.maxDistanceKm))candidates.push({request,volunteer,resource,leg1,leg2,km});
        }
      }
    }
    // Deterministic greedy shortest feasible trip across all waiting requests.
    // It is not a global vehicle-routing optimum or a road-safety calculation.
    candidates.sort((a,b)=>a.km-b.km||a.request.createdAt.localeCompare(b.request.createdAt)||a.request.id.localeCompare(b.request.id)||a.volunteer.id.localeCompare(b.volunteer.id)||a.resource.id.localeCompare(b.resource.id));
    const allocatedRequests=new Set(),allocatedVolunteers=new Set();
    for(const {resource,volunteer,request,leg1,leg2,km} of candidates) {
      if(allocatedRequests.has(request.id)||allocatedVolunteers.has(volunteer.id)||resource.quantity<request.quantity)continue;
      allocatedRequests.add(request.id);allocatedVolunteers.add(volunteer.id);
      const assignment={id:`ASN-${randomUUID().slice(0,8).toUpperCase()}`,requestId:request.id,resourceId:resource.id,volunteerId:volunteer.id,quantity:request.quantity,status:'offered',automatic:true,matchingStrategy:'nearest_feasible_trip',pickupDistanceKm:leg1,deliveryDistanceKm:leg2,distanceKm:km,createdAt:timestamp(),updatedAt:timestamp(),expiresAt:new Date(Date.now()+policy.offerSeconds*1000).toISOString()};
      resource.quantity-=request.quantity;volunteer.status='reserved';request.status='awaiting_volunteer';request.version++;request.updatedAt=timestamp();
      this.store.put('resources',resource);this.store.put('volunteers',volunteer);this.store.put('requests',request);this.store.put('assignments',assignment);
      const notification={id:randomUUID(),assignmentId:assignment.id,volunteerId:volunteer.id,token:randomBytes(32).toString('hex'),channel:volunteer.dispatch.channel,status:volunteer.dispatch.channel==='sms'?'pending':'in_app',createdAt:timestamp()};
      this.store.put('notifications',notification);
      this.store.audit(`${request.id} · automatically offered to ${volunteer.name} · awaiting acceptance`,request.id,'Auto-dispatch');
    }
  }
  tick() {
    if (!this.policy().enabled && !this.store.list('assignments').some(a=>a.automatic&&a.status==='offered')) return;
    const expired=this.store.list('assignments').filter(a=>a.automatic&&a.status==='offered'&&Date.parse(a.expiresAt)<=Date.now());
    if(!expired.length) {
      if (!this.store.list('requests').some(r=>this.eligible(r,this.policy()))) return;
      return this.store.atomic(()=>this.reconcile());
    }
    return this.store.atomic(()=>{
      for(const a of expired)this.releaseOffer(a,'Offer expired without acceptance');
      this.reconcile();
    });
  }
  releaseOffer(assignment,reason) {
    this.service.transitionAssignment({assignment_id:assignment.id,status:'cancelled',reason},'Auto-dispatch');
    const request=this.service.required('requests',assignment.requestId);
    if(!request.urgentReview&&request.verification==='verified')request.status='new';
    else if(!request.urgentReview&&request.callerConfirmed&&!request.duplicateCandidates?.length)request.status='new';
    this.store.put('requests',request);
    for(const n of this.store.list('notifications').filter(n=>n.assignmentId===assignment.id))this.store.put('notifications',{...n,status:'closed',closedAt:timestamp()});
  }
  task(token) {
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))throw new AppError('Invalid task link.',401);
    const notification=this.store.list('notifications').find(n=>n.token===token);
    if(!notification)throw new AppError('Task link not found.',401);
    const assignment=this.service.required('assignments',notification.assignmentId);
    const request=this.service.required('requests',assignment.requestId),resource=this.service.required('resources',assignment.resourceId),volunteer=this.service.required('volunteers',assignment.volunteerId);
    // Reveal only this task and necessary logistics, never another person's phone or notes.
    return {notification:{id:notification.id,status:notification.status},assignment,volunteer:{name:volunteer.name},request:{id:request.id,location:request.location,lat:request.lat,lng:request.lng,quantity:request.quantity,unit:request.unit,people:request.people},pickup:{location:resource.location,lat:resource.lat,lng:resource.lng},exercise:this.store.meta('workspace_mode')==='demo'};
  }
  respond(token,decision) {
    const {assignment}=this.task(token);
    if(decision==='decline') {
      if(assignment.status!=='offered')throw new AppError('Only a pending offer can be declined.',409);
      return this.store.atomic(()=>{this.releaseOffer(assignment,'Volunteer declined');this.reconcile();return {status:'declined'};});
    }
    const targets={accept:'approved',pickup:'in_progress',delivered:'awaiting_confirmation'};
    if(!Object.hasOwn(targets,decision))throw new AppError('Unknown volunteer action.');
    if(assignment.status===targets[decision])return {status:assignment.status};
    return this.service.run('transition_assignment',{assignment_id:assignment.id,status:targets[decision],action_id:`volunteer:${assignment.id}:${decision}`},'Volunteer');
  }
  linkFor(notification) {
    return `${(this.env.PUBLIC_BASE_URL||`http://127.0.0.1:${this.env.PORT||3000}`).replace(/\/$/,'')}/volunteer.html${this.env.WORKSPACE_SLUG?`?org=${encodeURIComponent(this.env.WORKSPACE_SLUG)}`:''}#${notification.token}`;
  }
  async flushNotifications() {
    if(this.flushing)return;this.flushing=true;
    try {
      for(const notification of this.store.list('notifications').filter(n=>n.channel==='sms'&&['pending','configuration_required'].includes(n.status))) {
        const assignment=this.store.get('assignments',notification.assignmentId);
        if(!assignment||assignment.status!=='offered')continue;
        const configured=this.env.TWILIO_ACCOUNT_SID&&this.env.TWILIO_AUTH_TOKEN&&this.env.TWILIO_FROM_NUMBER&&this.env.PUBLIC_BASE_URL?.startsWith('https://');
        if(!configured) {if(notification.status==='configuration_required')continue;this.store.atomic(()=>{this.store.put('notifications',{...notification,status:'configuration_required'});this.store.audit('SMS offer needs messaging credentials; in-app task remains available',assignment.requestId,'Notification worker','warning');});continue;}
        const volunteer=this.store.get('volunteers',assignment.volunteerId);
        // Mark before sending: a timeout must never trigger duplicate SMS automatically.
        this.store.atomic(()=>this.store.put('notifications',{...notification,status:'sending'}));
        try {
          const result=await sendSms(this.env,volunteer.phone,`${this.store.meta('workspace_mode')==='demo'?'EXERCISE — ':''}Relay: a food/water delivery offer is waiting. Review and accept before travelling: ${this.linkFor(notification)}`);
          if(!['submitted','queued'].includes(result.status))throw new Error('Provider rejected the send or returned no message reference.');
          this.store.atomic(()=>{const current=this.store.get('notifications',notification.id);if(current.status==='sending')this.store.put('notifications',{...current,...result,submittedAt:timestamp()});this.store.audit('Volunteer SMS queued/submitted; handset delivery is not yet verified',assignment.requestId,'Notification worker');});
        } catch {
          this.store.atomic(()=>{const current=this.store.get('notifications',notification.id);if(current.status==='sending')this.store.put('notifications',{...current,status:'send_uncertain'});this.store.audit('SMS send failed or is uncertain; no automatic retry',assignment.requestId,'Notification worker','warning');});
        }
      }
    } finally {this.flushing=false;}
  }
}
