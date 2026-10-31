import {stateDatabase} from '../lib/postgres-state.mjs';
import {ReliefService} from '../lib/domain.mjs';
import {AutoDispatch} from '../lib/automation.mjs';
import {MemberService} from '../lib/members.mjs';

const db=stateDatabase();
const phone='+15555550120';
const password='RelayVolunteer2026!';
try {
 const result=await db.transaction(async store=>{
  if(store.meta('workspace_mode')!=='demo')throw new Error('Refusing to create a synthetic volunteer in a live workspace.');
  const service=new ReliefService(store),dispatch=new AutoDispatch(service,{}),members=new MemberService(service,dispatch,{});
  let account=store.list('accounts').find(a=>a.phone===phone);
  const created=!account;
  if(!account){
   const joined=await members.signup({name:'Sam Demo · EXERCISE ONLY',phone,password,role:'volunteer',portal:'volunteer',consent:true});
   members.verify({accountId:joined.accountId,code:joined.developmentCode});
   account=store.get('accounts',joined.accountId);
  }
  const {token}=members.login({phone,password,portal:'volunteer'});
  if(created){
   members.profile(token,{location:'Fictional Relay central staging point — EXERCISE ONLY',lat:12.976,lng:77.619,accuracy:10,locationConsent:true,vehicle:'Synthetic relief truck — 2,000 litres / 2,000 meals'});
   members.enroll(token,{enabled:true,consent:true,waterCapacity:2000,foodCapacity:2000,maxDistanceKm:50,channel:'in_app'});
   store.audit('SYNTHETIC demo volunteer created with broad food/water capacity. Existing routing, human review and single-active-task safeguards preserved. No real SMS sent.',account.id,'Exercise controller');
  }
  const me=members.me(token,'volunteer');members.logout(token);
  return {created,name:me.account.name,phone,status:me.volunteer.status,limits:me.deliveryLimits,maxDistanceKm:me.volunteer.dispatch?.maxDistanceKm,offers:me.offers.length,workspaceRadiusKm:dispatch.policy().radiusKm};
 });
 console.log(JSON.stringify(result));
}catch(error){console.error(error.message);process.exitCode=1;}
finally{await db.close();}
