// Adapta o front-end à API do servidor (mesma interface usada no app: sample, db, user).
(()=>{const J=(u,o={})=>fetch(u,{credentials:"same-origin",headers:{"content-type":"application/json"},...o}).then(async r=>{const j=await r.json().catch(()=>({}));if(r.status==401){location="/login.html";throw{code:"auth",message:j.erro}}if(!r.ok)throw{code:r.status==429?"rate_limited":"erro",message:j.erro||"Falha na requisição."};return j});
const b64=f=>new Promise(res=>{const r=new FileReader();r.onload=()=>res({type:f.type,data:r.result.split(",")[1]});r.readAsDataURL(f)});
const sample=async(input,o={})=>{const messages=typeof input=="string"?[{role:"user",content:input}]:input,images=await Promise.all([].concat(o.images||[]).map(b64)),r=await J("/api/ai",{method:"POST",body:JSON.stringify({messages,images})});o.onText&&o.onText({text:r.text});return{text:r.text}};
sample.json=async i=>{const m=(await sample(i)).text.match(/\{[\s\S]*\}/);if(!m)throw{message:"A IA não retornou um JSON válido."};return JSON.parse(m[0])};
sample.limits=async()=>({images:true});
const db={collection:()=>({doc:id=>({set:d=>J("/api/inv/"+id,{method:"PUT",body:JSON.stringify(d)}),delete:()=>J("/api/inv/"+id,{method:"DELETE"})}),onSnapshot:(n,e)=>{J("/api/inv").then(a=>n({docs:a.map(d=>({id:d.id,data:()=>d}))})).catch(e)}})};
window.claude={use:async n=>({user:{id:async()=>"me"},db,sample})[n]||null};})();
