export const workspace=new URLSearchParams(location.search).get('org')||'';
export const workspaceHeaders=()=>workspace?{'X-Relay-Workspace':workspace}:{};
export const inWorkspace=path=>{const u=new URL(path,location.origin);if(workspace)u.searchParams.set('org',workspace);return u.pathname+u.search+u.hash;};
export const mapsUrl=point=>`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(Number.isFinite(point.lat)&&Number.isFinite(point.lng)?`${point.lat},${point.lng}`:point.location||'')}`;
export async function chooseWorkspace(root,role){
 const r=await fetch('/api/organizations'),data=await r.json();
 root.replaceChildren();const h=document.createElement('h1');h.textContent='Choose your response team';root.append(h);
 const p=document.createElement('p');p.textContent='Join the organisation coordinating help in your area. Each workspace is independent and not government-verified by Relay.';root.append(p);
 for(const org of data.organizations||[]){const a=document.createElement('a');a.className='btn';a.textContent=`${org.name} · ${org.area}`;a.href=`/${role}/sign-in?org=${encodeURIComponent(org.slug)}`;root.append(a);}
 const form=document.createElement('form');form.className='community-form';const label=document.createElement('label');label.textContent='Have a private workspace code?';const input=document.createElement('input');input.required=true;input.pattern='[a-z0-9-]{3,60}';input.placeholder='team-workspace';const b=document.createElement('button');b.className='btn primary';b.textContent='Open workspace';form.append(label,input,b);form.onsubmit=e=>{e.preventDefault();location.href=`/${role}/sign-in?org=${encodeURIComponent(input.value)}`;};root.append(form);
 const link=document.createElement('a');link.href='/workspace';link.textContent='Coordinate a response →';root.append(link);
}
