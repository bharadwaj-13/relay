import {randomBytes,randomUUID,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {AppError} from './domain.mjs';
const digest=v=>createHash('sha256').update(v).digest('hex');
const text=(v,n=150)=>{if(typeof v!=='string'||!v.trim()||v.length>n)throw new AppError('Complete all required details.');return v.trim();};
const email=v=>{const x=text(v,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x))throw new AppError('Enter a valid email.');return x;};
const safeUser=({id,name,email,emailVerified,provider})=>({id,name,email,emailVerified:!!emailVerified,provider});
const publicOrg=o=>({id:o.id,name:o.name,slug:o.slug,area:o.area,verified:false});
export class PlatformService {
 constructor(store,env={}){this.store=store;this.env=env;}
 signup(input){
  const address=email(input.email),name=text(input.name,100),password=input.password;
  if(typeof password!=='string'||password.length<12||password.length>128)throw new AppError('Use a personal password of 12–128 characters.');
  if(input.consent!==true)throw new AppError('Confirm account creation.');
  if(this.store.list('platformAccounts').some(a=>a.email===address))throw new AppError('This email already has an account. Sign in.',409);
  const salt=randomBytes(16).toString('hex');
  const a={id:randomUUID(),name,email:address,emailVerified:false,provider:'password',passwordSalt:salt,passwordHash:scryptSync(password,salt,64).toString('hex'),createdAt:new Date().toISOString()};
  this.store.put('platformAccounts',a);return this.session(a);
 }
 login(input){
  const address=email(input.email),a=this.store.list('platformAccounts').find(a=>a.email===address),p=typeof input.password==='string'&&input.password.length<=128?input.password:'';
  const hash=scryptSync(p,a?.passwordSalt||'invalid-account',64);
  if(!a?.passwordHash||!timingSafeEqual(hash,Buffer.from(a.passwordHash,'hex')))throw new AppError('Incorrect email or password.',401);
  return this.session(a);
 }
 session(a){const token=randomBytes(32).toString('hex');this.store.put('platformSessions',{id:digest(token),accountId:a.id,expiresAt:Date.now()+12*3600000});return {token,account:safeUser(a)};}
 user(token){const s=typeof token==='string'?this.store.get('platformSessions',digest(token)):null,a=s?.expiresAt>Date.now()?this.store.get('platformAccounts',s.accountId):null;if(!a)throw new AppError('Sign in to your account.',401);return safeUser(a);}
 logout(token){if(token)this.store.put('platformSessions',{id:digest(token),expiresAt:0});}
 organizations(){return this.store.list('organizations').filter(o=>o.listed).map(publicOrg);}
 organization(slug){return this.store.list('organizations').find(o=>o.slug===slug)||null;}
 mine(token){const a=this.user(token);return {account:a,organizations:this.store.list('organizations').filter(o=>o.members.some(m=>m.accountId===a.id)).map(o=>({...publicOrg(o),membership:o.members.find(m=>m.accountId===a.id)}))};}
 create(token,input){
  const a=this.user(token),name=text(input.name,150),area=text(input.area,150),slug=text(input.slug,60).toLowerCase();
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length<3)throw new AppError('Use a workspace address with 3–60 lowercase letters, numbers or hyphens.');
  if(this.organization(slug))throw new AppError('That workspace address is already used.',409);
  if(this.store.list('organizations').filter(o=>o.members.some(m=>m.accountId===a.id&&m.role==='owner')).length>=5)throw new AppError('You can own up to five workspaces.');
  const org={id:randomUUID(),name,area,slug,listed:input.listed===true,members:[{accountId:a.id,role:'owner',status:'active'}],toolKey:randomBytes(32).toString('hex'),webhookSecret:randomBytes(32).toString('hex'),snapshot:{records:[],actions:[],metadata:[{key:'workspace_mode',value:'live'}]},createdAt:new Date().toISOString()};
  this.store.put('organizations',org);return {organization:publicOrg(org)};
 }
 apply(token,slug){const a=this.user(token),o=this.organization(slug);if(!o)throw new AppError('Workspace not found.',404);if(!o.members.some(m=>m.accountId===a.id)){o.members.push({accountId:a.id,role:'coordinator',status:'pending'});this.store.put('organizations',o);}return {pending:true};}
 actor(token,slug){const a=this.user(token),o=this.organization(slug),m=o?.members.find(m=>m.accountId===a.id&&m.status==='active');if(!m)throw new AppError('This workspace requires owner-approved coordinator access.',403);return {...a,role:m.role,organization:o.name,organizationId:o.id};}
 owner(token,slug){const a=this.actor(token,slug);if(a.role!=='owner')throw new AppError('Only this workspace owner can manage coordinators.',403);return a;}
 team(token,slug){this.owner(token,slug);return this.organization(slug).members.map(m=>({...m,...safeUser(this.store.get('platformAccounts',m.accountId))}));}
 review(token,slug,input){this.owner(token,slug);const o=this.organization(slug),m=o.members.find(m=>m.accountId===input.accountId);if(!m||m.role==='owner')throw new AppError('Choose a coordinator application.');if(!['active','rejected','suspended'].includes(input.status))throw new AppError('Invalid review decision.');if(input.status==='active'&&input.identityChecked!==true)throw new AppError('Check identity and authority before approving access.');m.status=input.status;this.store.put('organizations',o);return {updated:true};}
 voice(token,slug){this.owner(token,slug);const o=this.organization(slug);return {endpoint:`${this.env.PUBLIC_BASE_URL}/api/voice/action?org=${encodeURIComponent(slug)}`,toolKey:o.toolKey,webhook:`${this.env.PUBLIC_BASE_URL}/api/webhooks/vaani?org=${encodeURIComponent(slug)}`,webhookSecret:o.webhookSecret,configured:false};}
 setVoice(token,slug,input){
  this.owner(token,slug);const o=this.organization(slug);
  if(input.disconnect===true){delete o.voiceAgentId;delete o.vaaniApiKey;}
  else{if(typeof input.agentId!=='string'||!/^[a-f0-9-]{36}$/i.test(input.agentId))throw new AppError('Enter the agent ID from your own Vaani account.');o.voiceAgentId=input.agentId;if(input.apiKey){if(typeof input.apiKey!=='string'||input.apiKey.length<12||input.apiKey.length>512)throw new AppError('Enter a valid Vaani API key.');o.vaaniApiKey=input.apiKey;}}
  this.store.put('organizations',o);return {saved:true,agentConfigured:!!o.voiceAgentId,apiConfigured:!!o.vaaniApiKey,message:'Settings saved. This does not provision a number or verify provider activation.'};
 }
 async google(input){
  if(this.env.GOOGLE_AUTH_ENABLED!=='true'||!this.env.SUPABASE_ANON_KEY||!this.env.SUPABASE_URL)throw new AppError('Google sign-in is not configured. Use email and password.',503);
  if(typeof input.accessToken!=='string'||input.accessToken.length>10000)throw new AppError('Missing sign-in token.');
  const r=await fetch(`${this.env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:this.env.SUPABASE_ANON_KEY,Authorization:`Bearer ${input.accessToken}`},signal:AbortSignal.timeout(8000)});
  if(!r.ok)throw new AppError('Google sign-in could not be verified.',401);
  const u=await r.json();if(!u.email_confirmed_at||!u.identities?.some(i=>i.provider==='google'))throw new AppError('Verified Google identity required.',403);
  const address=email(u.email);let a=this.store.list('platformAccounts').find(a=>a.googleId===u.id);
  if(!a&&this.store.list('platformAccounts').some(a=>a.email===address))throw new AppError('This email already uses password sign-in. Use that sign-in; account linking requires review.',409);
  if(!a){a={id:randomUUID(),googleId:u.id,name:String(u.user_metadata?.full_name||address).slice(0,100),email:address,emailVerified:true,provider:'google',createdAt:new Date().toISOString()};this.store.put('platformAccounts',a);}return this.session(a);
 }
}
