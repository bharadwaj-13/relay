// Deterministic, editable suggestions: never invent a missing quantity or address.
const words={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20,thirty:30,forty:40,fifty:50,sixty:60,seventy:70,eighty:80,ninety:90,hundred:100};
export function extractIntake(message){
 const raw=String(message||'').trim().slice(0,4000),text=raw.replace(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[- ](?:one|two|three|four|five|six|seven|eight|nine))?\b/gi,v=>String(v.toLowerCase().split(/[- ]/).reduce((n,w)=>n+words[w],0)));
 const category=/\b(medic(?:al|ine|ines)|injur\w*|bleed\w*|ambulance|insulin|chest pain|breath\w*|unconscious)\b/i.test(raw)?'medical':/\bwater\b/i.test(raw)?'water':/\b(food|meals?|rice|pizza|bread)\b/i.test(raw)?'food':'';
 const need=category==='water'?text.match(/(\d+)\s*(?:lit(?:re|er)s?\s*(?:of\s*)?(?:water)?|(?:bottles?\s*(?:of\s*)?)?water)/i):category==='food'?text.match(/(\d+)\s*(?:meals?|(?:food\s*)?(?:packets?|packs?|portions?)|(?:packets?\s*of\s*)?food)/i):null;
 const name=raw.match(/\b(?:my name is|this is|I am|I'm|I’m)\s+(.+?)(?=[,.!?]|\s+(?:and|I need|we need|we are|at|near)\b|$)/i)?.[1]?.trim().slice(0,60)||'';
 const deliveryAddress=raw.match(/\b(?:deliver(?:y)?(?:\s+(?:it|them))?\s+(?:to|at)|located at|my address is|we are at|I'm at|I am at|at|near)\s+(.+?)(?=\s+(?:and\s+)?(?:I|we)\s+need\b|[.!?]|$)/i)?.[1]?.trim().slice(0,240)||'';
 const quantity=need?Number(need[1]):category==='medical'?1:'';
 const unit=category==='water'&&/\bbottles?\b/i.test(need?.[0]||'')?'bottles':category==='water'?'litres':category==='food'?'meals':'assessment';
 const urgent=category==='medical'||/\b(urgent|emergency|trapped|fire|drowning|cannot breathe|can't breathe)\b/i.test(raw);
 return {name,category,quantity,unit,deliveryAddress,transcript:raw,urgent};
}
export function mapsLink(destination,{pickup}={}){
 const point=typeof destination==='string'?destination:Number.isFinite(destination?.lat)&&Number.isFinite(destination?.lng)?`${destination.lat},${destination.lng}`:destination?.deliveryAddress;
 if(!point?.trim())return null;
 const u=new URL('https://www.google.com/maps/dir/');u.searchParams.set('api','1');u.searchParams.set('destination',point);u.searchParams.set('travelmode','driving');
 if(pickup)u.searchParams.set('waypoints',pickup);return u.href;
}
