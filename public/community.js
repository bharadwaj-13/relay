import { captureGps } from './gps.js';
const root = document.querySelector('#community');
const portalRole=location.pathname.startsWith('/supplier')?'supplier':'volunteer';
const portalBase=`/${portalRole}`;
document.title=`Relay — ${portalRole==='supplier'?'Supplier':'Volunteer'} portal`;
document.querySelector('.community-header .brand').href='/';
document.querySelector('.community-header .exercise-badge').textContent=`${portalRole==='supplier'?'Supplier':'Volunteer'} portal`;
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let me, config, mode=location.pathname.endsWith('/sign-in')?'login':'signup', challenge, geo=null, busy=false, memberEvents, updateTimer;
async function api(path,data) { const r=await fetch(`/api/${path}`,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{},...(data?{body:JSON.stringify(data)}:{})});const result=await r.json();if(!r.ok)throw Object.assign(new Error(result.error),{status:r.status});return result; }
function notify(text,error=false) { const el=document.createElement('div');el.className=`toast ${error?'error-toast':''}`;el.textContent=text;document.querySelector('#toasts').append(el);setTimeout(()=>el.remove(),6500); }
const field=(name,title,type='text',value='',extra='')=>`<div class="field"><label for="m-${name}">${title}</label><input id="m-${name}" name="${name}" type="${type}" value="${esc(value)}" required ${extra}></div>`;
const select=(name,title,options,value='')=>`<div class="field"><label for="m-${name}">${title}</label><select id="m-${name}" name="${name}">${options.map(([v,l])=>`<option value="${esc(v)}" ${v===value?'selected':''}>${esc(l)}</option>`).join('')}</select></div>`;
function renderCommunityLanding() {
  root.innerHTML=`<div class="join-layout"><section class="join-story"><p class="eyebrow">The Relay community</p><h1>Be the person<br>who shows up.</h1><p>Deliver a little water. Share a few meals. Put the supplies you have into the hands that need them.</p><div class="join-step"><span>01</span><div><h3>Join in your own way</h3><p>Volunteer, supply essentials, or do both.</p></div></div><div class="join-step"><span>02</span><div><h3>Tell us where you can help</h3><p>Share your location with permission and choose your limits.</p></div></div><div class="join-step"><span>03</span><div><h3>Accept a task. Make a difference.</h3><p>Your own account, your offers, and clear pickup and delivery details.</p></div></div><div class="note">Residents do not need an account. Request help and track it over the same phone line.</div>${config?.exercise?'<span class="exercise-badge">Exercise workspace · no real relief dispatched</span>':''}</section><section class="panel join-card"><div class="segmented"><button data-mode="signup" class="${mode==='signup'?'active':''}">Join the network</button><button data-mode="login" class="${mode==='login'?'active':''}">Sign in</button></div><h2>${mode==='login'?'Welcome back.':'A helping hand starts here.'}</h2><p class="subtitle">${mode==='login'?'Your profile, offers and supplies in one place.':'One account for volunteers and suppliers.'}</p><form data-form="${mode}" class="community-form">${mode==='signup'?field('name','Your name')+select('role','How would you like to help?',[['volunteer','Volunteer — deliver supplies'],['supplier','Supplier — offer supplies'],['both','Both — supply and deliver']]):''}${field('phone','Phone number','tel','','placeholder="+919876543210" autocomplete="tel"')}${field('password','Password','password','','minlength="10" maxlength="128" autocomplete="'+(mode==='login'?'current-password':'new-password')+'"')}${mode==='signup'?'<label class="check-field"><input name="consent" type="checkbox" required><span>I want to join and receive a verification code. Delivery offers require a separate opt-in.</span></label>':''}<div class="inline-error" role="alert"></div><button class="btn primary wide" type="submit">${mode==='login'?'Sign in':'Create my account'} →</button></form><p class="fine-print">Passwords are hashed. Live accounts require phone verification. Account recovery is handled by the relief coordinator.</p></section></div>`;
}
function landing() {
  renderCommunityLanding();
  const supplier=portalRole==='supplier';
  root.querySelector('.join-story h1').textContent=supplier?'What you have can go further.':'Be the person who shows up.';
  root.querySelector('.join-story>p:not(.eyebrow)').textContent=supplier?'Share essentials from your pickup point. Keep your inventory clear, let coordinators verify it, and connect supplies with the people who need them.':'Deliver essentials where they are needed. Set your limits, review your matched route, and accept before you travel.';
  const titles=supplier?['Create your supplier account','Confirm your pickup point','Offer supplies for verification']:['Create your volunteer account','Set your location and limits','Accept a matched route'];
  const details=supplier?['Supplier-only sign-in and inventory.','Share a location only with permission.','Reported stock is verified before matching.']:['Volunteer-only sign-in and task inbox.','Choose capacity and travel distance, not a depot.','Review pickup and drop-off before travelling.'];
  root.querySelectorAll('.join-step').forEach((step,i)=>{step.querySelector('h3').textContent=titles[i];step.querySelector('p').textContent=details[i];});
  root.querySelector('.join-card>h2').textContent=mode==='login'?`Welcome back, ${portalRole}.`:`Join as a ${portalRole}.`;
  root.querySelector('.join-card>.subtitle').textContent=supplier?'Your pickup points and supplies, in one place.':'Your availability and delivery offers, in one place.';
  const roles=root.querySelector('[name="role"]');
  if(roles)roles.innerHTML=`<option value="${portalRole}">${supplier?'Supplier — offer supplies':'Volunteer — deliver supplies'}</option><option value="both">Both — separate volunteer and supplier sign-ins</option>`;
}
function verification() {
  root.innerHTML=`<section class="panel verify-card"><p class="eyebrow">One quick check</p><h1>Verify your phone.</h1><p class="subtitle">Enter your six-digit signup code. It expires in 10 minutes.</p>${challenge.developmentCode?`<div class="note">Exercise-only verification code: <strong>${esc(challenge.developmentCode)}</strong>. No SMS was sent.</div>`:`<div class="note">SMS status: ${esc(challenge.verification)}. ${challenge.verification==='configuration_required'?'Messaging is not configured; verification cannot complete until your deployment supports it.':'Only enter a code you actually received.'}</div>`}<form data-form="verify" class="community-form">${field('code','Verification code','text','','inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code"')}<div class="inline-error" role="alert"></div><button class="btn primary wide" type="submit">Verify phone →</button></form><button class="text-link" data-mode="login" style="margin-top:20px">Back to sign in</button></section>`;
}

function deliveryPreferences(v) {
  const water=v.dispatch?me.deliveryLimits.water:20,food=v.dispatch?me.deliveryLimits.food:20;
  return `<h2>Automatic assignment settings</h2><p>The system chooses the nearest feasible pickup and drop-off together. You only set what you can carry and how far you can travel.</p><div class="note">Your location → verified nearby supplies → resident. No fixed depot and no pickup-source selection.</div><form data-form="enroll" class="community-form">${field('waterCapacity','Water carrying limit (litres)','number',water,'min="0" max="100000"')}${field('foodCapacity','Food carrying limit (meals)','number',food,'min="0" max="100000"')}${field('maxDistanceKm','Maximum total trip proximity (km)','number',v.dispatch?.maxDistanceKm||8,'min=".1" max="50" step=".1"')}${select('channel','Offer notifications',[['in_app','My task inbox'],['sms','SMS + task inbox']],v.dispatch?.channel||'in_app')}<label class="check-field"><input name="consent" type="checkbox" required><span>I opt in to automatically matched deliveries within these limits. I will check and accept each route before travelling.</span></label><div class="inline-error" role="alert"></div><button class="btn primary" type="submit">${v.dispatch?'Update my limits':'Enable automatic offers'}</button></form><div class="detail-actions"><span id="volunteer-availability-status" class="pill ${esc(v.status)}">${esc(v.status)}</span><button class="btn small" id="volunteer-availability-button" data-action="availability" data-status="${v.status==='paused'?'available':'paused'}">${v.status==='paused'?'Make me available':'Pause availability'}</button>${v.dispatch?'<button class="btn small" data-action="unenroll">Stop future offers</button>':''}</div><p class="fine-print">Set a category to zero if you cannot carry it. Distances are straight-line estimates, not road safety or travel times. Profile changes require enrollment again. Accepting one task prevents additional offers until it is resolved.</p>`;
}
function renderOffers() {
  return me.offers.map(o=>{
    const km=o.assignment?.distanceKm,closed=['delivered','cancelled'].includes(o.assignment?.status);
    return `<article class="assigned-route"><div class="badge-pair"><strong>${esc(o.assignment?.id)}</strong><span class="pill ${esc(o.assignment?.status)}">${esc(o.assignment?.status.replaceAll('_',' '))}</span></div><h3>${o.delivery.quantity} ${esc(o.delivery.unit)}</h3><div class="route-stops"><div><small>01 / PICKUP · SYSTEM SELECTED</small><strong>${esc(o.pickup.location)}</strong></div><span aria-hidden="true">↓</span><div><small>02 / DROP-OFF</small><strong>${esc(o.delivery.location)}</strong></div></div><p class="fine-print">${Number.isFinite(km)?`${km.toFixed(1)} km total estimated proximity · `:''}notification ${esc(o.status)}. ${closed?'Task closed.':'Check local access before accepting. No safe-route guarantee.'}</p><a class="btn ${closed?'':'primary'}" href="${esc(new URL(o.taskUrl).pathname+new URL(o.taskUrl).hash)}">${closed?'View task':'Review my assigned route'} →</a></article>`;
  }).join('')||'<div class="empty">No assigned route yet. Once enabled and available, the system matches nearby verified stock and waiting requests automatically.</div>';
}

function dashboard() {
  const a={...me.account,role:portalRole},v=portalRole==='volunteer'?me.volunteer:null,p=me.profile;
  geo=Number.isFinite(p.lat)&&Number.isFinite(p.lng)?{lat:p.lat,lng:p.lng,accuracy:p.accuracy,locationConsent:true}:null;
  root.innerHTML=`<div class="community-workspace"><div class="page-heading"><div><p class="eyebrow">Your place in the response</p><h1>Hello, ${esc(a.name.split(' ')[0])}.</h1><p class="subtitle">${esc(a.role==='both'?'Volunteer & supplier':a.role)} · verified phone ${esc(a.phone)}</p></div><button class="btn" data-action="logout">Sign out</button></div>${me.exercise?'<div class="exercise-badge" style="margin-bottom:22px">Exercise workspace · no real delivery requested</div>':''}<div class="integration-grid"><section class="panel integration-card"><h2>Your profile & location</h2><p>Confirm a recognizable landmark. GPS is requested only when you tap the capture button. ${config.reverseGeocoding?'With permission, coordinates go to Google to suggest an address.':'Without address lookup, enter the landmark yourself.'}</p><form data-form="profile" class="community-form">${field('location','Landmark / area','text',p.location)}${field('organization',a.role==='volunteer'?'Group / team (optional)':'Organization / supplier name (optional)','text',p.organization,'')}${v?field('vehicle','Vehicle / carrying arrangements','text',p.vehicle||'On foot'):''}<button class="btn" data-action="gps" type="button">◎ Capture my current location</button><p id="gps-status" class="subtitle">${geo?'Saved coordinates available.':'No precise location saved yet.'}</p><label class="check-field"><input name="locationConsent" type="checkbox" ${geo?'checked':''}><span>Save this confirmed location for relief pickup and delivery matching.</span></label><div class="inline-error" role="alert"></div><button class="btn primary" type="submit">Save my profile</button></form></section>${v?`<section class="panel integration-card">${deliveryPreferences(v)}</section>`:`<section class="panel integration-card"><h2>Your supplies, connected.</h2><p>Publish what you can offer from your confirmed pickup location. Your stock remains reported until its availability is verified. Volunteers handle delivery; you do not need to drive.</p><div class="note">One universal signup supports supplier-only accounts and people who both supply and deliver. Public signup does not grant coordinator access.</div></section>`}</div>${v?`<div class="section-heading"><h2>Your assigned routes</h2><button class="btn small" data-action="refresh">Refresh offers</button></div><section class="panel">${renderOffers()}</section>`:''}${a.role!=='volunteer'?`<div class="section-heading"><h2>Offer supplies</h2></div><div class="integration-grid"><section class="panel integration-card"><form data-form="supply" class="community-form">${field('name','Supply description')}${select('category','Category',[['water','Drinking water'],['food','Prepared food'],['medical','Medical supplies — human review'],['other','Other essentials']])}${field('quantity','Available quantity','number',30,'min="1" max="100000"')}${field('unit','Unit (litres, meals, units)','text','litres')}<label class="check-field"><input name="locationConsent" type="checkbox" required><span>Use my saved, confirmed pickup location for this offer.</span></label><div class="inline-error" role="alert"></div><button class="btn primary" type="submit">Publish supply offer</button></form></section><section class="panel integration-card"><h2>Your inventory</h2>${me.supplies.map(s=>`<div class="detail-section"><h3>${esc(s.name)}</h3><p>${s.quantity} ${esc(s.unit)} · ${esc(s.location)}</p><span class="pill ${esc(s.verification)}">${esc(s.verification)}</span></div>`).join('')||'<p>No published supplies yet.</p>'}</section></div>`:''}<footer class="page-footer"><span>Community access · only your own profile, tasks and inventory</span><span>relay / relief operations</span></footer></div>`;
  const org=document.querySelector('[name="organization"]');if(org)org.required=false;
  if(portalRole==='supplier')for(const note of root.querySelectorAll('.note'))if(note.textContent.startsWith('One universal signup'))note.textContent='Supplier workspace: manage your own pickup point and inventory. Supplier sign-in never grants coordinator access.';
  const inboxTitle=[...root.querySelectorAll('h2')].find(el=>el.textContent==='Your assigned routes');
  if(inboxTitle)inboxTitle.parentElement.nextElementSibling.id='community-task-inbox';
}
function updateInbox(){
  const inbox=document.querySelector('#community-task-inbox');if(!inbox)return;
  inbox.innerHTML=renderOffers();
  const v=me.volunteer,status=document.querySelector('#volunteer-availability-status'),toggle=document.querySelector('#volunteer-availability-button');
  if(v&&status){status.textContent=v.status;status.className=`pill ${v.status}`;}
  if(v&&toggle){toggle.dataset.status=v.status==='paused'?'available':'paused';toggle.textContent=v.status==='paused'?'Make me available':'Pause availability';}
}
async function refresh() {
  me=await api(`members/me?portal=${portalRole}`);dashboard();
  if(!memberEvents){const timer=setInterval(async()=>{if(document.hidden)return;try{me=await api(`members/me?portal=${portalRole}`);updateInbox();}catch{}},5000);memberEvents={close:()=>clearInterval(timer)};}
}
document.addEventListener('click',async e=>{
  const modeButton=e.target.closest('[data-mode]');if(modeButton){mode=modeButton.dataset.mode;history.replaceState(null,'',`${portalBase}/${mode==='login'?'sign-in':'sign-up'}`);landing();return;}
  const b=e.target.closest('[data-action]');if(!b||busy)return;
  try {
    if(b.dataset.action==='logout'){await api('members/logout',{});memberEvents?.close();memberEvents=null;me=null;mode='login';landing();}
    if(b.dataset.action==='refresh')await refresh();
    if(b.dataset.action==='availability'){await api('members/availability',{status:b.dataset.status});await refresh();}
    if(b.dataset.action==='unenroll'){await api('members/enroll',{enabled:false});await refresh();}
    if(b.dataset.action==='gps'){
      busy=true;b.disabled=true;b.textContent='Finding your location…';
      geo=await captureGps();const suggestion=await api('members/reverse',geo);
      if(suggestion.address)document.querySelector('[name="location"]').value=suggestion.address;
      document.querySelector('#gps-status').textContent=`GPS captured · approximately ±${Math.round(geo.accuracy)} m. Confirm the landmark and save.`;
      document.querySelector('[name="locationConsent"]').checked=true;
    }
  }catch(error){notify(error.message,true);}finally{busy=false;if(b.isConnected){b.disabled=false;if(b.dataset.action==='gps')b.textContent='◎ Capture my current location';}}
});
document.addEventListener('submit',async e=>{
  const f=e.target;if(!f.matches('[data-form]'))return;e.preventDefault();const b=f.querySelector('[type="submit"]');b.disabled=true;
  const d=Object.fromEntries(new FormData(f));
  try {
    const type=f.dataset.form;
    if(type==='signup'){challenge=await api('members/signup',{...d,portal:portalRole,consent:!!d.consent});verification();}
    if(type==='verify'){await api('members/verify',{accountId:challenge.accountId,code:d.code});mode='login';landing();notify('Phone verified. Sign in to your account.');}
    if(type==='login'){await api('members/login',{...d,portal:portalRole});history.replaceState(null,'',portalBase);await refresh();}
    if(type==='profile'){await api('members/profile',{...d,...(geo||{}),locationConsent:!!d.locationConsent});await refresh();notify('Profile saved. Confirm delivery enrollment again if you changed your location.');}
    if(type==='enroll'){await api('members/enroll',{...d,enabled:true,consent:!!d.consent,waterCapacity:Number(d.waterCapacity),foodCapacity:Number(d.foodCapacity),maxDistanceKm:Number(d.maxDistanceKm)});await refresh();notify('You are enrolled for eligible offers.');}
    if(type==='supply'){await api('members/supplies',{...d,...(geo||{}),quantity:Number(d.quantity),location:me.profile.location,locationConsent:!!d.locationConsent});await refresh();notify('Supply offer published for verification.');}
  }catch(error){const box=f.querySelector('.inline-error');if(box){box.className='inline-error error';box.textContent=error.message;}else notify(error.message,true);}finally{b.disabled=false;}
});
async function boot(){config=await api('public/config');try{await refresh();}catch(error){if([401,403].includes(error.status))landing();else throw error;}}
boot().catch(error=>{root.innerHTML=`<div class="verify-card panel"><div class="dialog-body"><h2>Unable to open Relay</h2><p>${esc(error.message)}</p></div></div>`;});
