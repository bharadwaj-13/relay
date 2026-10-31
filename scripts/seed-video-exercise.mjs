import {stateDatabase} from '../lib/postgres-state.mjs';
import {ReliefService} from '../lib/domain.mjs';
import {AutoDispatch} from '../lib/automation.mjs';
import {MemberService} from '../lib/members.mjs';
const db=stateDatabase();
try {
 const result=await db.transaction(async store=>{
  if(store.meta('workspace_mode')!=='demo')throw new Error('Refusing to seed a live workspace.');
  if(store.meta('video_exercise_seeded'))return {alreadySeeded:true};
  const service=new ReliefService(store),dispatch=new AutoDispatch(service,{}),members=new MemberService(service,dispatch,{});
  const password='RelayDemo2026!';
  const volunteers=[['Aisha · EXERCISE','+15555550101',12.974,77.616,'Cargo van'],['Rohan · EXERCISE','+15555550102',12.980,77.623,'Cargo bike'],['Nadia · EXERCISE','+15555550103',12.986,77.627,'Car'],['Vikram · EXERCISE','+15555550104',12.967,77.631,'Pickup truck']];
  for(const[name,phone,lat,lng,vehicle]of volunteers){
   const joined=await members.signup({name,phone,password,role:'volunteer',consent:true});members.verify({accountId:joined.accountId,code:joined.developmentCode});
   const {token}=members.login({phone,password});
   members.profile(token,{location:'Fictional Bengaluru exercise staging point',lat,lng,accuracy:10,locationConsent:true,vehicle});
   members.enroll(token,{enabled:true,consent:true,waterCapacity:200,foodCapacity:200,maxDistanceKm:25,channel:'in_app'});members.logout(token);
  }
  const vendors=[['Demo Water Depot · EXERCISE','+15555550111','water',1000,'litres',12.976,77.619],['Demo Community Kitchen · EXERCISE','+15555550112','food',1000,'meals',12.982,77.621],['Demo East Relief Store · EXERCISE','+15555550113','water',800,'litres',12.969,77.634]];
  for(const[name,phone,category,quantity,unit,lat,lng]of vendors){
   const joined=await members.signup({name,phone,password,role:'supplier',consent:true});members.verify({accountId:joined.accountId,code:joined.developmentCode});
   const {token}=members.login({phone,password});
   members.profile(token,{location:name,organization:name,lat,lng,accuracy:10,locationConsent:true});
   const {resource}=members.addSupply(token,{name:`${category==='water'?'Bottled water':'Meal boxes'} · EXERCISE ONLY`,category,quantity,unit,location:name,lat,lng,accuracy:10,locationConsent:true});
   service.run('verify_resource',{resource_id:resource.id},'Exercise controller — synthetic stock');members.logout(token);
  }
  store.meta('exercise_landmarks',JSON.stringify([{name:'Relay Demo School',lat:12.975,lng:77.618},{name:'Relay Demo Hall',lat:12.984,lng:77.624}]));
  dispatch.setPolicy({enabled:true,acceptConfirmedReports:true,radiusKm:25,offerSeconds:1800});
  store.meta('video_exercise_seeded',new Date().toISOString());
  store.audit('VIDEO EXERCISE: fictional accounts, stock and landmarks added. No real SMS or relief dispatch. No deliveries fabricated.',null,'Exercise controller','warning');
  return {volunteers:4,suppliers:3,resources:3,automaticOffers:true};
 });console.log(JSON.stringify(result));
}catch(error){console.error('Exercise seed failed:',error.message);process.exitCode=1;}
finally{await db.close();}
