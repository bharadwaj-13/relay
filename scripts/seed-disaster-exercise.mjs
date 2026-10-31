import {randomUUID} from 'node:crypto';
import {stateDatabase} from '../lib/postgres-state.mjs';
import {ReliefService} from '../lib/domain.mjs';
import {AutoDispatch} from '../lib/automation.mjs';
const db=stateDatabase();
try{console.log(JSON.stringify(await db.transaction(store=>{
 if(store.meta('workspace_mode')!=='demo')throw new Error('Exercise data cannot be added to a live workspace.');
 if(store.meta('disaster_exercise_v1'))return {alreadySeeded:true};
 const s=new ReliefService(store);new AutoDispatch(s,{});
 const actor='EXERCISE controller — synthetic data';
 const requests=[
  ['Water collection group','water',20,'litres',8,'normal','Demo Garden Shelter',12.971,77.625,'Accessible ground-floor handover; sealed drinking water requested.'],
  ['Community meal group','food',18,'meals',18,'high','Demo Hill Community Hall',12.988,77.629,'Vegetarian meal request. Confirm dietary requirements; no guaranteed delivery time.'],
  ['Medical assistance report','medical',1,'assessment',1,'urgent','Demo South Clinic Gate',12.965,77.614,'Synthetic caller reports needing medical assistance. Human review only; no diagnosis, prescription or automatic dispatch.'],
  ['Accessible transport group','transport',4,'seats',4,'urgent','Demo Library Entrance',12.992,77.616,'Wheelchair-accessible transport requested for older residents. Human coordinator must check access and vehicle suitability.'],
  ['Shelter placement group','shelter',6,'beds',6,'high','Demo Riverside Assembly Point',12.982,77.635,'Step-free shelter and family placement requested. Capacity and admission must be confirmed.'],
  ['Hygiene supplies group','other',12,'kits',12,'normal','Demo West Community Desk',12.976,77.604,'Hygiene kits and menstrual products requested; discreet handover. Human matching required.'],
  ['Infant essentials group','other',3,'packs',3,'high','Demo North Family Center',12.998,77.626,'Diapers and infant essentials requested. Feeding/medical requirements must be reviewed by a qualified person.'],
  ['Charging assistance group','other',5,'slots',5,'normal','Demo East Information Desk',12.970,77.639,'Phone charging requested. No claim that electricity or communications remain available.']
 ];
 for(let i=0;i<requests.length;i++){
  const[name,category,quantity,unit,people,priority,location,lat,lng,notes]=requests[i];
  s.run('create_request',{action_id:`disaster-exercise-v1-request-${i}`,name:`EXERCISE · ${name}`,phone:`+155555501${80+i}`,category,quantity,unit,people,priority,location,lat,lng,notes:`SYNTHETIC DEMO ONLY. ${notes}`,caller_confirmed:true},actor);
 }
 const stock=[['First-aid kits','medical',50,'kits','Demo Medical Store',12.967,77.612],['Accessible transport places','transport',8,'seats','Demo Transport Staging',12.990,77.619],['Hygiene kits','other',120,'kits','Demo Essentials Depot',12.977,77.606],['Diaper packs','other',80,'packs','Demo Family Supplies',12.995,77.624],['Blankets','other',100,'units','Demo Shelter Stores',12.984,77.632],['Charging places','other',20,'slots','Demo Power Hub',12.971,77.636]];
 for(const[name,category,quantity,unit,location,lat,lng]of stock)s.run('add_resource',{name:`EXERCISE · ${name}`,category,quantity,unit,location,lat,lng,provider:'Fictional disaster response supplier'},actor);
 const unverified=s.run('add_resource',{name:'EXERCISE · donation awaiting verification',category:'food',quantity:100,unit:'meals',location:'Demo Donor Pickup',provider:'Fictional donor',lat:12.981,lng:77.628},actor).resource;
 store.put('resources',{...unverified,verification:'reported'});
 for(const[name,capacity,occupied,accessible,lat,lng]of [['Demo Central Shelter',120,64,true,12.983,77.623],['Demo Sports Hall',90,90,true,12.973,77.608],['Demo North Community Center',60,12,false,12.999,77.622]])s.run('save_shelter',{name:`EXERCISE · ${name}`,location:name,capacity,occupied,accessible,lat,lng,contact:'Fictional shelter desk — no real contact',source:'SYNTHETIC disaster exercise; not a real shelter listing'},actor);
 const expiresAt=new Date(Date.now()+4*3600000).toISOString();
 for(const[title,body,location,severity]of [
  ['Underpass access restriction','Synthetic exercise: underpass access is reported blocked. Do not treat straight-line matching as a safe road route. Coordinator must verify access.','Demo Eastbank','warning'],
  ['Drinking water handover point','Synthetic exercise: drinking water stock is staged at the demo depot. A stock listing is not a resident delivery promise.','Demo Central Depot','info'],
  ['Shelter near capacity','Synthetic exercise: the demo sports hall has no reported vacancies. Check the capacity and accessibility of alternatives before promising a bed.','Demo Sports Hall','warning'],
  ['Medical reports require review','Synthetic exercise: medical and urgent requests must be reviewed by a human. Relay does not replace emergency services.','Exercise area','urgent'],
  ['Communications fallback','Synthetic exercise: phone/data coverage may be interrupted. Keep offline request notes and reconcile them with the coordinator when connectivity returns.','Exercise area','info']
 ])s.run('add_advisory',{title:`EXERCISE · ${title}`,body,location,severity,source:'Fictional exercise control bulletin',expiresAt},actor);
 store.put('calls',{id:`CB-EXERCISE-${randomUUID().slice(0,8)}`,name:'EXERCISE · access check callback',phone:'+15555550199',summary:'SYNTHETIC: coordinator callback requested to check accessible pickup access. No call placed.',status:'callback_requested',source:'exercise_seed',createdAt:new Date().toISOString(),transcript:[],consent:true});
 store.meta('disaster_exercise_v1',new Date().toISOString());
 store.audit('SYNTHETIC disaster scenario added: needs, reviewed stock, unverified donation, shelters, access advisories and a callback queue item. No real SMS, calls or completed deliveries fabricated.',null,actor,'warning');
 return {addedRequests:8,addedResources:7,addedShelters:3,addedAdvisories:5,addedCallbacks:1,automaticOffers:store.list('assignments').filter(a=>a.automatic&&a.status==='offered').length};
})));}catch(e){console.error('Exercise seed failed:',e.message);process.exitCode=1;}finally{await db.close();}
