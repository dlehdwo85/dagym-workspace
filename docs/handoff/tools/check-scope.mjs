const BASE='http://localhost:3000';
class C{constructor(){this.ck={}}async req(m,p,b){const r=await fetch(BASE+p,{method:m,headers:{'content-type':'application/json',origin:BASE,cookie:Object.entries(this.ck).map(([k,v])=>k+'='+v).join('; ')},body:b?JSON.stringify(b):undefined,redirect:'manual'});for(const s of r.headers.getSetCookie()){const [kv]=s.split(';');const i=kv.indexOf('=');this.ck[kv.slice(0,i)]=kv.slice(i+1)}const t=await r.text();let j;try{j=JSON.parse(t)}catch{j=t};return {status:r.status,j}}}
const task=process.argv[2];
for (const k of ['staffA','staffB','managerA']) {
  const c=new C(); const l=await c.req('POST','/api/auth/login',{email:`${k}@dagym.test`,password:`${k}-pass-1234`});
  const t=await c.req('GET',`/api/tasks/${task}`);
  const n=await c.req('GET','/api/notifications');
  const list=(n.j.items??n.j.notifications??n.j)||[];
  console.log(k,'login',l.status,'task',t.status, 'notifs', Array.isArray(list)?list.map(x=>x.type+':'+x.title).join(' | '):JSON.stringify(n.j).slice(0,200));
}
