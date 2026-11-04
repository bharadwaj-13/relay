// Browser-only portfolio simulation. No production imports, credentials or I/O.
export const SANDBOX_VERSION=2;
const active=['offered','accepted','picked_up','handover_reported'];
export const places={school:{name:'Riverside School · fictional',x:76,y:60},hall:{name:'Community Hall · fictional',x:62,y:32},clinic:{name:'North Clinic Gate · fictional',x:48,y:16}};
const clone=v=>JSON.parse(JSON.stringify(v));
function event(s,message){s.events.unshift({id:`E${s.nextEvent++}`,message});s.events=s.events.slice(0,40);}
export function freshSandbox(){return {version:SANDBOX_VERSION,nextRequest:1,nextAssignment:1,nextEvent:2,latestRequestId:null,
 requests:[],
 resources:[{id:'S1',name:'Drinking water',category:'water',unit:'litres',quantity:120,verification:'verified',supplier:'Demo Community Supplies',location:'Blue Door Depot · fictional',x:45,y:58},{id:'S2',name:'Prepared meals',category:'food',unit:'meals',quantity:80,verification:'verified',supplier:'Demo Community Supplies',location:'Community Kitchen · fictional',x:35,y:30},{id:'S3',name:'Additional water donation',category:'water',unit:'litres',quantity:40,verification:'reported',supplier:'Demo Community Supplies',location:'Blue Door Depot · fictional',x:45,y:58}],
 volunteers:[{id:'V1',name:'Mira · demo volunteer',available:true,water:20,food:20,x:41,y:55},{id:'V2',name:'Arun · demo volunteer',available:true,water:40,food:30,x:17,y:24}],
 assignments:[],events:[{id:'E1',message:'Fresh sandbox. All people, supplies and places are fictional.'}]};}
export function parseSandbox(raw){
 if(!raw||raw.length>250000)return freshSandbox();
 try{const s=JSON.parse(raw);if(s.version!==SANDBOX_VERSION||!Array.isArray(s.requests)||s.requests.length>30||!Array.isArray(s.resources)||s.resources.length>15||!Array.isArray(s.volunteers)||s.volunteers.length!==2||!Array.isArray(s.assignments)||s.assignments.length>30||!Array.isArray(s.events)||s.events.length>40||![s.nextRequest,s.nextAssignment,s.nextEvent].every(Number.isSafeInteger))return freshSandbox();
  if(s.requests.some(r=>!places[r.place]||typeof r.id!=='string'||typeof r.name!=='string')||s.resources.some(r=>!Number.isInteger(r.quantity)||r.quantity<0))return freshSandbox();return s;
 }catch{return freshSandbox();}
}
export function busy(s,id){return s.assignments.some(a=>a.volunteerId===id&&active.includes(a.status));}
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
export function reconcile(s){
 const candidates=[];
 for(const r of s.requests.filter(r=>r.status==='waiting_match'&&['water','food'].includes(r.category)&&r.priority!=='urgent')){
  for(const v of s.volunteers.filter(v=>v.available&&!busy(s,v.id))){if(v[r.category]<r.quantity)continue;
   for(const resource of s.resources.filter(x=>x.category===r.category&&x.unit===r.unit&&x.verification==='verified'&&x.quantity>=r.quantity)){
    const cost=distance(v,resource)+distance(resource,places[r.place]);if(cost<=100)candidates.push({r,v,resource,cost});
   }
  }
 }
 candidates.sort((a,b)=>a.cost-b.cost||a.r.id.localeCompare(b.r.id));
 for(const {r,v,resource,cost}of candidates){if(r.status!=='waiting_match'||busy(s,v.id)||resource.quantity<r.quantity)continue;
  resource.quantity-=r.quantity;r.status='awaiting_volunteer';
  s.assignments.push({id:`TASK-${s.nextAssignment++}`,requestId:r.id,volunteerId:v.id,resourceId:resource.id,quantity:r.quantity,status:'offered',routeScore:Math.round(cost)});
  event(s,`${r.id}: ${r.quantity} ${r.unit} reserved; offer sent to ${v.name} in this simulation.`);
 }
}
export function submitRequest(state,input){
 const s=clone(state);if(s.requests.length>=30)throw Error('Sandbox limit reached. Reset the demo to start fresh.');
 const name=String(input.name||'Demo resident').trim(),quantity=Number(input.quantity),category=input.category,place=input.place;
 if(!name||name.length>60||!['water','food','medical'].includes(category)||!Number.isInteger(quantity)||quantity<1||quantity>100||!places[place])throw Error('Use a fictional name, a known demo place and a quantity from 1 to 100.');
 if(input.confirmed!==true)throw Error('Confirm the example request before saving.');
 const addressKey=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
 const duplicate=s.requests.some(r=>r.category===category&&(input.deliveryAddress?addressKey(r.deliveryAddress)===addressKey(input.deliveryAddress):r.place===place&&!r.deliveryAddress)&&!['complete','cancelled'].includes(r.status));
 const r={id:`DEMO-${String(s.nextRequest++).padStart(3,'0')}`,name,category,quantity,unit:category==='water'?'litres':category==='food'?'meals':'assessment',people:null,place,priority:category==='medical'?'urgent':'normal',status:category==='medical'||duplicate?'needs_review':'waiting_match',reviewReason:category==='medical'?'Medical request: qualified human review required.':duplicate?'Possible overlap: check that these are separate needs.':''};
 if(input.source==='voice'||input.source==='text'){
  const address=String(input.deliveryAddress||'').trim(),pickup=String(input.pickupAddress||'').trim();
  if(!address||address.length>240||!pickup||pickup.length>240)throw Error('Confirm the delivery address and demo pickup landmark first.');
  if(!String(input.transcript||'').trim()||String(input.transcript).length>4000)throw Error('Add a transcript or typed message, up to 4,000 characters.');
  r.deliveryAddress=address;r.pickupAddress=pickup;r.transcript=String(input.transcript).trim();r.source=input.source;r.audioId=typeof input.audioId==='string'?input.audioId.slice(0,80):null;r.createdAt=new Date().toISOString();
  if(input.unit==='bottles'&&category==='water')r.unit='bottles';
  if(input.lat!==null&&input.lat!==undefined&&Number.isFinite(input.lat)&&Math.abs(input.lat)<=90&&Number.isFinite(input.lng)&&Math.abs(input.lng)<=180){r.lat=input.lat;r.lng=input.lng;r.accuracy=input.accuracy;}
  // Keep urgency from the original message even if the category is edited.
  if(input.urgent===true){r.priority='urgent';r.status='needs_review';r.reviewReason='Urgent voice message: qualified human review required.';}
 }
 s.requests.unshift(r);s.latestRequestId=r.id;event(s,`${r.id}: ${input.source==='voice'?'voice recording':input.source==='text'?'typed message':'simulated call'} saved: ${quantity} ${r.unit} at ${r.deliveryAddress||places[place].name}.`);reconcile(s);return s;
}
export function taskAction(state,id,decision){
 const s=clone(state),a=s.assignments.find(a=>a.id===id);if(!a)throw Error('Demo task not found.');
 const targets={accept:['offered','accepted'],pickup:['accepted','picked_up'],handover:['picked_up','handover_reported'],receipt:['handover_reported','complete']};
 const target=targets[decision];if(!target||a.status!==target[0])throw Error('Complete the preceding step first. A handover is not confirmed receipt.');
 a.status=target[1];const r=s.requests.find(r=>r.id===a.requestId);r.status={accepted:'accepted',picked_up:'in_transit',handover_reported:'awaiting_receipt',complete:'complete'}[a.status];
 event(s,`${r.id}: ${decision==='receipt'?'resident receipt confirmed':decision==='handover'?'volunteer reported handover; resident receipt still pending':decision==='pickup'?'volunteer confirmed pickup':'volunteer accepted the offer'} (simulation).`);reconcile(s);return s;
}
export function setAvailability(state,id,available){const s=clone(state),v=s.volunteers.find(v=>v.id===id);if(!v)throw Error('Demo volunteer not found.');if(busy(s,id))throw Error('Resolve the active task before changing availability.');v.available=!!available;event(s,`${v.name}: ${available?'available':'paused'} (simulation).`);reconcile(s);return s;}
export function updateStock(state,id,quantity){const s=clone(state),r=s.resources.find(r=>r.id===id);if(!r)throw Error('Demo supply not found.');if(!Number.isInteger(quantity)||quantity<0||quantity>500)throw Error('Use a stock quantity from 0 to 500.');if(s.assignments.some(a=>a.resourceId===id&&active.includes(a.status)))throw Error('This stock is reserved. Complete the delivery before editing.');r.quantity=quantity;r.verification='reported';event(s,`${r.name}: supplier updated stock to ${quantity}; coordinator verification required.`);return s;}
export function verifyStock(state,id){const s=clone(state),r=s.resources.find(r=>r.id===id);if(!r)throw Error('Demo supply not found.');r.verification='verified';event(s,`${r.name}: coordinator verified the example stock.`);reconcile(s);return s;}
export function addStock(state,input){const s=clone(state);if(s.resources.length>=15)throw Error('Reset the sandbox before adding more stock.');const quantity=Number(input.quantity),name=String(input.name||'Demo supplies').trim();if(!['water','food'].includes(input.category)||!Number.isInteger(quantity)||quantity<1||quantity>500||!name||name.length>60)throw Error('Choose food or water, a short name and a quantity from 1 to 500.');s.resources.unshift({id:`S${s.resources.length+1}`,name,category:input.category,unit:input.category==='water'?'litres':'meals',quantity,verification:'reported',supplier:'Demo Community Supplies',location:'Blue Door Depot · fictional',x:45,y:58});event(s,'Supplier added fictional stock; it is not dispatchable until verified.');return s;}
