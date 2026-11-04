import {test} from 'node:test';
import assert from 'node:assert/strict';
import {extractIntake,mapsLink} from '../public/sandbox-intake.js';
import {createVoiceRecorder} from '../public/sandbox-voice.js';
import {freshSandbox,submitRequest,parseSandbox,taskAction} from '../public/sandbox-model.js';
test('spoken request extraction keeps missing essentials missing and units distinct',()=>{
 const r=extractIntake('My name is Alex. I need ten litres of water at Cubbon Park Metro Station, Bengaluru.');
 assert.equal(r.name,'Alex');assert.equal(r.category,'water');assert.equal(r.quantity,10);assert.equal(r.deliveryAddress,'Cubbon Park Metro Station, Bengaluru');assert.equal(r.unit,'litres');
 assert.equal(extractIntake('We need water').quantity,'');assert.equal(extractIntake('We need water').deliveryAddress,'');assert.equal(extractIntake('I need twenty-five meals near City Hall, Paris').quantity,25);
 assert.equal(extractIntake('I need 5 bottles of water at City Hall').unit,'bottles');assert.equal(extractIntake('urgent water at city hall').urgent,true);
});
test('voice evidence and GPS survive assignment and receipt, urgent text is never auto-dispatched',()=>{
 const input={...extractIntake('My name is Alex. I need ten litres of water at Cubbon Park Metro Station, Bengaluru.'),source:'voice',audioId:'local-clip',pickupAddress:'Vidhana Soudha Metro Station, Bengaluru',place:'school',lat:12.98,lng:77.59,accuracy:25,confirmed:true};
 let s=submitRequest(freshSandbox(),input);assert.equal(s.assignments.length,1);assert.equal(s.requests[0].audioId,'local-clip');assert.equal(s.requests[0].lat,12.98);assert.deepEqual(parseSandbox(JSON.stringify(s)),s);
 for(const step of ['accept','pickup','handover','receipt'])s=taskAction(s,s.assignments[0].id,step);
 assert.equal(s.requests[0].status,'complete');assert.equal(s.resources[0].quantity,110);
 const urgent=submitRequest(freshSandbox(),{...input,urgent:true});assert.equal(urgent.assignments.length,0);assert.equal(urgent.requests[0].status,'needs_review');
 const bottles=submitRequest(freshSandbox(),{...input,unit:'bottles'});assert.equal(bottles.assignments.length,0,'do not allocate litres for a bottle request');
 assert.throws(()=>submitRequest(freshSandbox(),{...input,deliveryAddress:''}),/address/);
});
test('Maps uses confirmed GPS, encodes landmarks, and includes pickup without inventing an origin',()=>{
 const u=new URL(mapsLink({lat:12.98,lng:77.59,deliveryAddress:'Ignored address'},{pickup:'Town Hall & depot, Bengaluru'}));assert.equal(u.origin,'https://www.google.com');assert.equal(u.searchParams.get('api'),'1');assert.equal(u.searchParams.get('destination'),'12.98,77.59');assert.equal(u.searchParams.get('waypoints'),'Town Hall & depot, Bengaluru');assert.equal(u.searchParams.get('origin'),null);
 assert.equal(new URL(mapsLink('City Hall, Paris')).searchParams.get('destination'),'City Hall, Paris');assert.equal(mapsLink({}),null);
});
function fakePlatform({speech=true,denied=false}={}){
 let stopped=0,rec,asr;class Recorder{constructor(){rec=this;this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['recorded audio'])});this.onstop?.();}}
 class Recognition{constructor(){asr=this;}start(){}stop(){this.onend?.();}abort(){}}
 return {platform:{MediaRecorder:Recorder,...(speech?{SpeechRecognition:Recognition}:{}),navigator:{mediaDevices:{getUserMedia:async()=>{if(denied)throw Object.assign(Error(),{name:'NotAllowedError'});return {getTracks:()=>[{stop:()=>stopped++}]};}}}},get recorder(){return rec;},get speech(){return asr;},get stopped(){return stopped;}};
}
test('recording emits an actual blob, final transcript and stops microphone tracks',async()=>{
 const f=fakePlatform();let finish;const done=new Promise(resolve=>finish=resolve),v=createVoiceRecorder({platform:f.platform,onDone:finish});await v.start();assert.equal(v.active,true);
 f.speech.onresult({resultIndex:0,results:[Object.assign([{transcript:'I need ten litres of water'}],{isFinal:true})]});v.stop();const result=await done;assert.ok(result.blob.size>0);assert.equal(result.transcript,'I need ten litres of water');assert.equal(f.stopped,1);assert.equal(v.active,false);
});
test('speech failure preserves the recording with a manual-transcript fallback',async()=>{
 const f=fakePlatform({speech:false});let finish;const done=new Promise(resolve=>finish=resolve),v=createVoiceRecorder({platform:f.platform,onDone:finish});await v.start();v.stop();const result=await done;assert.ok(result.blob.size);assert.match(result.error,/cannot transcribe/);assert.equal(f.stopped,1);
 const denied=fakePlatform({denied:true}),d=createVoiceRecorder({platform:denied.platform});await assert.rejects(()=>d.start(),/Microphone access was denied/);assert.equal(d.active,false);
});
test('cancelling recording releases the microphone without submitting a clip',async()=>{
 const f=fakePlatform();let submitted=false;const v=createVoiceRecorder({platform:f.platform,onDone:()=>submitted=true});await v.start();v.cancel();assert.equal(f.stopped,1);assert.equal(v.active,false);assert.equal(submitted,false);
});
test('stopping while microphone permission is pending releases a late-granted stream',async()=>{
 let resolvePermission,stopped=0,done;
 const pending=new Promise(resolve=>resolvePermission=resolve),f=fakePlatform();f.platform.navigator.mediaDevices.getUserMedia=()=>pending;
 const v=createVoiceRecorder({platform:f.platform,onDone:r=>{done=r;}}),starting=v.start();v.stop();assert.equal(done.blob.size,0);
 resolvePermission({getTracks:()=>[{stop:()=>stopped++}]});await starting;assert.equal(stopped,1);assert.equal(v.active,false);
});
test('different spoken delivery addresses are not mistaken for duplicates of the same fictional place',()=>{
 const base={source:'text',name:'Alex',category:'water',quantity:10,unit:'litres',place:'school',pickupAddress:'Demo pickup, Bengaluru',transcript:'Need ten litres of water',confirmed:true};
 let s=submitRequest(freshSandbox(),{...base,deliveryAddress:'Metro A, Bengaluru'});s=submitRequest(s,{...base,deliveryAddress:'Metro B, Bengaluru'});assert.equal(s.assignments.length,2);assert.equal(s.requests[0].status,'awaiting_volunteer');
 const duplicate=submitRequest(s,{...base,deliveryAddress:'  METRO A,  Bengaluru  '});assert.equal(duplicate.requests[0].status,'needs_review');
});
