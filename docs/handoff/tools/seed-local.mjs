// 로컬 검수용 데이터: tests/helpers.mjs bootstrap() 과 같은 계정(시험용 값)
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync(process.argv[2], 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const BASE = 'http://localhost:3000';
class C { constructor(){this.ck={}} async req(m,p,b){const r=await fetch(BASE+p,{method:m,headers:{'content-type':'application/json',origin:BASE,cookie:Object.entries(this.ck).map(([k,v])=>k+'='+v).join('; ')},body:b?JSON.stringify(b):undefined,redirect:'manual'});for(const s of r.headers.getSetCookie()){const [kv]=s.split(';');const i=kv.indexOf('=');this.ck[kv.slice(0,i)]=kv.slice(i+1)}const t=await r.text();if(!r.ok)throw new Error(m+' '+p+' '+r.status+' '+t);return t?JSON.parse(t):null} }
const o = new C();
await o.req('POST','/api/setup',{secret:env.SETUP_SECRET,email:'ceo@dagym.test',name:'김대표',password:'owner-pass-1234'});
const hq='00000000-0000-0000-0000-000000000001';
const a=(await o.req('POST','/api/admin/org-units',{name:'다짐 강남점',type:'branch',parentId:hq,brandId:'dagym'})).id;
const b=(await o.req('POST','/api/admin/org-units',{name:'하이링크 판교 위탁현장',type:'site',parentId:hq,brandId:'hilink'})).id;
for (const [k,n,r,u] of [['staffA','이직원','staff',a],['staffB','박직원','staff',b],['managerA','최매니저','site_manager',a]]) {
  const inv=await o.req('POST','/api/admin/users',{email:`${k}@dagym.test`,name:n,role:r,orgUnitIds:[u]});
  await new C().req('POST',`/api/invitations/${inv.path.split('/').pop()}/accept`,{password:`${k}-pass-1234`});
}
console.log('seeded', a, b);
