// Browser recording and transcription only. No Relay backend or provider credentials.
export function createVoiceRecorder({platform=globalThis,onText=()=>{},onStatus=()=>{},onDone=()=>{}}={}){
 let recorder,recognition,stream,timer,starting=false,stopping=false,chunks=[],text='',interim='',recognitionError='',generation=0;
 const cleanup=()=>{clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());stream=null;};
 function stop(){if(stopping)return;stopping=true;clearTimeout(timer);try{recognition?.stop();}catch{}if(recorder?.state==='recording'){recorder.stop();onStatus('Finishing recording…');}else{cleanup();starting=false;onDone({blob:new Blob([]),transcript:'',error:'Recording cancelled before the microphone was ready.'});}}
 return {
  get active(){return starting||recorder?.state==='recording';},
  async start(lang='en-IN'){
   if(starting||recorder?.state==='recording')return;const run=++generation;starting=true;stopping=false;recorder=null;recognition=null;chunks=[];text='';interim='';recognitionError='';
   try{
    if(!platform.navigator?.mediaDevices?.getUserMedia||!platform.MediaRecorder)throw Error('Recording is unavailable here. Open this HTTPS page in Chrome or Edge, or type your message below.');
    const acquired=await platform.navigator.mediaDevices.getUserMedia({audio:true});
    if(run!==generation||stopping){acquired.getTracks().forEach(t=>t.stop());if(run===generation)starting=false;return;}
    stream=acquired;
    recorder=new platform.MediaRecorder(stream);
    recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
    recorder.onstop=()=>{
     cleanup();starting=false;
     // Let a final speech result arrive after Stop before publishing the draft.
     setTimeout(()=>{if(run===generation)onDone({blob:new Blob(chunks,{type:recorder.mimeType||'audio/webm'}),transcript:(text+' '+interim).trim(),error:recognitionError});},350);
    };
    recorder.onerror=()=>{recognitionError='Recording failed. Please retry or type your message.';stop();};
    const Recognition=platform.SpeechRecognition||platform.webkitSpeechRecognition;
    if(Recognition){
     recognition=new Recognition();recognition.lang=lang;recognition.continuous=true;recognition.interimResults=true;
     recognition.onresult=e=>{interim='';for(let i=e.resultIndex;i<e.results.length;i++){const result=e.results[i];if(result.isFinal)text+=result[0].transcript+' ';else interim+=result[0].transcript;}onText((text+' '+interim).trim());};
     recognition.onerror=e=>{recognitionError=e.error==='no-speech'?'No speech detected. You can retry or type the transcript.':e.error==='not-allowed'?'Speech transcription permission was denied. Your audio can still be reviewed; type the transcript.':'Browser transcription is unavailable. Your recording is kept; type or correct the transcript.';onStatus(recognitionError);};
     recognition.onend=()=>{if(!stopping&&recorder?.state==='recording')onStatus('Transcription stopped. Finish recording, then check or type the transcript.');};
     try{recognition.start();}catch{recognitionError='Automatic transcription could not start. Type the transcript after recording.';}
    }else recognitionError='This browser cannot transcribe speech. Your recording works; type the transcript or use Chrome/Edge.';
    recorder.start(500);starting=false;timer=setTimeout(stop,60000);onStatus(recognitionError||'Recording · speak naturally. Stops automatically after 60 seconds.');
   }catch(error){if(run!==generation)return;cleanup();starting=false;throw Error(error.name==='NotAllowedError'?'Microphone access was denied. Allow it in your browser, retry, or type your message.':error.message);}
  },stop,
  cancel(){generation++;stopping=true;try{recognition?.abort();}catch{}if(recorder){recorder.onstop=null;if(recorder.state==='recording')recorder.stop();}cleanup();starting=false;}
 };
}

// Recordings are stored only in this browser's dedicated demo database.
let database;
async function db(){return database ||= new Promise((resolve,reject)=>{const req=indexedDB.open('relay_voice_sandbox_v2',1);req.onupgradeneeded=()=>req.result.createObjectStore('recordings');req.onsuccess=()=>resolve(req.result);req.onerror=()=>{database=null;reject(Error('This browser could not save audio locally.'));};});}
export async function audioStore(action,id,value){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('recordings',action==='get'?'readonly':'readwrite'),s=tx.objectStore('recordings');const req=action==='get'?s.get(id):action==='clear'?s.clear():s.put(value,id);let result;req.onsuccess=()=>{result=req.result;};tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(Error('Could not save the recording in this browser.'));tx.onabort=()=>reject(Error('Audio storage was interrupted.'));});}
