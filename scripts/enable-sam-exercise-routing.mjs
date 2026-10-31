import {stateDatabase} from '../lib/postgres-state.mjs';
import {ReliefService} from '../lib/domain.mjs';
import {AutoDispatch} from '../lib/automation.mjs';
const db=stateDatabase();
try {
 const result=await db.transaction(store=>{
  if(store.meta('workspace_mode')!=='demo')throw new Error('Exercise routing is not allowed in a live workspace.');
  const account=store.list('accounts').find(a=>a.phone==='+15555550120');
  const volunteer=account?.volunteerId&&store.get('volunteers',account.volunteerId);
  if(!volunteer?.dispatch||!account.phoneVerified)throw new Error('Verified, enrolled Sam Demo account required.');
  store.meta('exercise_dispatch_volunteer_id',volunteer.id);
  store.audit('EXERCISE ONLY: eligible automatic offers restricted to Sam Demo; existing assignments, safety review, capacity, inventory and single-task limits unchanged.',volunteer.id,'Exercise controller');
  const dispatcher=new AutoDispatch(new ReliefService(store));dispatcher.tick();
  return {enabled:true,volunteer:volunteer.name,activeOffers:store.list('assignments').filter(a=>a.volunteerId===volunteer.id&&a.status==='offered').length};
 });console.log(JSON.stringify(result));
}catch(error){console.error(error.message);process.exitCode=1;}
finally{await db.close();}
