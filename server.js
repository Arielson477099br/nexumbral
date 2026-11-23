// NEXUMBRAL — servidor: autenticação, persistência, IA (texto, visão, ferramentas) e imagens.
const express=require("express"),helmet=require("helmet"),rateLimit=require("express-rate-limit"),bcrypt=require("bcryptjs"),jwt=require("jsonwebtoken"),Database=require("better-sqlite3"),path=require("path");
const {SECRET,ANTHROPIC_API_KEY:KEY,MODEL="claude-sonnet-5-5",DAILY_LIMIT=100,PORT=3000,IMAGE_API_URL,IMAGE_API_KEY,IMAGE_MODEL}=process.env;
if(!SECRET||SECRET.length<32){console.error("Defina SECRET (32+ caracteres) no .env");process.exit(1)}
const db=new Database(process.env.DB_FILE||"nexumbral.db");db.pragma("journal_mode=WAL");
db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,hash TEXT NOT NULL,created INTEGER);
CREATE TABLE IF NOT EXISTS inv(id TEXT NOT NULL,user_id INTEGER NOT NULL,data TEXT NOT NULL,upd INTEGER,PRIMARY KEY(id,user_id));
CREATE TABLE IF NOT EXISTS usage(user_id INTEGER,day TEXT,n INTEGER,PRIMARY KEY(user_id,day));
CREATE TABLE IF NOT EXISTS img(id INTEGER PRIMARY KEY,user_id INTEGER,inv_id TEXT,prompt TEXT,b64 TEXT,created INTEGER);`);
const app=express();
app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'self'"],scriptSrc:["'self'","'unsafe-inline'"],styleSrc:["'self'","'unsafe-inline'","https://fonts.googleapis.com"],fontSrc:["https://fonts.gstatic.com"],imgSrc:["'self'","blob:","data:"],connectSrc:["'self'"]}}}));
app.use(express.json({limit:"25mb"}));
const ck=r=>Object.fromEntries((r.headers.cookie||"").split(";").map(s=>s.trim().split("=")).filter(a=>a[0]&&a[1]));
const auth=(q,s,n)=>{try{q.uid=jwt.verify(ck(q).nx,SECRET).uid;n()}catch{s.status(401).json({erro:"Sessão expirada. Entre novamente."})}};
const setCk=(s,uid)=>s.cookie("nx",jwt.sign({uid},SECRET,{expiresIn:"7d"}),{httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV=="production",maxAge:6048e5});
const lim=(m,w)=>rateLimit({windowMs:w*1000,limit:m,standardHeaders:true,legacyHeaders:false,message:{erro:"Muitas tentativas. Aguarde um instante."}});
// ---- contas
app.post("/api/register",lim(10,900),(q,s)=>{const{email,name,password}=q.body||{};
 if(!/^\S+@\S+\.\S+$/.test(email||"")||!name||String(name).length>60||String(password||"").length<8)return s.status(400).json({erro:"Informe nome, e-mail válido e senha com 8 ou mais caracteres."});
 try{const r=db.prepare("INSERT INTO users(email,name,hash,created) VALUES(?,?,?,?)").run(email.toLowerCase(),name.trim(),bcrypt.hashSync(password,12),Date.now());setCk(s,r.lastInsertRowid);s.json({name})}catch{s.status(409).json({erro:"Este e-mail já está cadastrado."})}});
app.post("/api/login",lim(10,900),(q,s)=>{const u=db.prepare("SELECT * FROM users WHERE email=?").get(String(q.body?.email||"").toLowerCase());
 if(!u||!bcrypt.compareSync(String(q.body.password||""),u.hash))return s.status(401).json({erro:"E-mail ou senha incorretos."});setCk(s,u.id);s.json({name:u.name})});
app.post("/api/logout",(q,s)=>{s.clearCookie("nx");s.json({})});
app.get("/api/me",auth,(q,s)=>s.json(db.prepare("SELECT name,email FROM users WHERE id=?").get(q.uid)));
// ---- investigações (sempre filtradas pelo usuário autenticado)
app.get("/api/inv",auth,(q,s)=>s.json(db.prepare("SELECT data FROM inv WHERE user_id=? ORDER BY upd DESC").all(q.uid).map(r=>JSON.parse(r.data))));
app.put("/api/inv/:id",auth,(q,s)=>{const d=q.body;if(!/^[\w-]{1,40}$/.test(q.params.id)||!d||JSON.stringify(d).length>3e5)return s.status(400).json({erro:"Dados inválidos."});
 db.prepare("INSERT INTO inv VALUES(?,?,?,?) ON CONFLICT(id,user_id) DO UPDATE SET data=excluded.data,upd=excluded.upd").run(q.params.id,q.uid,JSON.stringify(d),Date.now());s.json({})});
app.delete("/api/inv/:id",auth,(q,s)=>{db.prepare("DELETE FROM inv WHERE id=? AND user_id=?").run(q.params.id,q.uid);db.prepare("DELETE FROM img WHERE inv_id=? AND user_id=?").run(q.params.id,q.uid);s.json({})});
// ---- ferramentas de verificação (executadas no servidor, com lista branca de identificadores)
const OK=/^[\w\s+\-*\/%().,<>=!&|?:]+$/,ID=new Set(["Math","abs","min","max","floor","ceil","round","sqrt","pow","true","false"]);
const safe=(e,x=[])=>{if(!OK.test(e)||(e.match(/[A-Za-z_]\w*/g)||[]).some(i=>!ID.has(i)&&!x.includes(i)))throw new Error("Expressão não permitida")};
const RUN={
 calcular:({expressao})=>{safe(expressao);return String(Function('"use strict";return('+expressao+')')())},
 resolver_restricoes:({variaveis:V,restricoes:R})=>{const n=Object.keys(V);let t=1;n.forEach(k=>t*=V[k][1]-V[k][0]+1);if(t>1e6)throw new Error("Espaço de busca grande demais: "+t);
  R.forEach(r=>safe(r,n));const f=R.map(r=>Function(...n,'"use strict";return('+r+')')),v=n.map(k=>V[k][0]),S=[];let c=0;
  (function rec(i){if(i==n.length){if(f.every(g=>g(...v))){c++;if(S.length<10)S.push(Object.fromEntries(n.map((k,j)=>[k,v[j]])))}return}for(let x=V[n[i]][0];x<=V[n[i]][1];x++){v[i]=x;rec(i+1)}})(0);
  return JSON.stringify({combinacoes:t,solucoes:c,exemplos:S})}};
const TOOLS=[{name:"calcular",description:"Avalia uma expressão aritmética (JavaScript, com Math.*).",input_schema:{type:"object",properties:{expressao:{type:"string"}},required:["expressao"]}},
 {name:"resolver_restricoes",description:"Busca exaustiva sobre variáveis inteiras de domínio finito. variaveis: {nome:[min,max]}; restricoes: expressões JS booleanas. Até 1.000.000 combinações. Retorna nº de soluções e até 10 exemplos.",input_schema:{type:"object",properties:{variaveis:{type:"object"},restricoes:{type:"array",items:{type:"string"}}},required:["variaveis","restricoes"]}}];
async function claude(messages){for(let i=0;i<8;i++){
 const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":KEY,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({model:MODEL,max_tokens:4096,tools:TOOLS,messages})});
 const j=await r.json();if(!r.ok)throw new Error(j.error?.message||"Falha no serviço de IA");messages.push({role:"assistant",content:j.content});
 if(j.stop_reason!="tool_use")return j.content.filter(b=>b.type=="text").map(b=>b.text).join("\n");
 messages.push({role:"user",content:j.content.filter(b=>b.type=="tool_use").map(b=>{let c,e;try{c=RUN[b.name](b.input)}catch(x){c=x.message;e=true}return{type:"tool_result",tool_use_id:b.id,content:String(c),is_error:e}})})}
 throw new Error("Limite de etapas de raciocínio atingido.")}
app.post("/api/ai",auth,lim(20,60),async(q,s)=>{
 if(!KEY)return s.status(503).json({erro:"ANTHROPIC_API_KEY não configurada no servidor."});
 const u=db.prepare("INSERT INTO usage VALUES(?,?,1) ON CONFLICT(user_id,day) DO UPDATE SET n=n+1 RETURNING n").get(q.uid,new Date().toISOString().slice(0,10));
 if(u.n>DAILY_LIMIT)return s.status(429).json({erro:"Limite diário de consultas atingido."});
 try{const{messages,images=[]}=q.body;if(!Array.isArray(messages)||!messages.length||messages.at(-1).role!="user"||images.length>4)throw 0;
  const ms=messages.map(m=>({role:m.role=="user"?"user":"assistant",content:String(m.content)})),l=ms.at(-1);
  l.content=[...images.map(i=>{if(!/^image\/(png|jpeg|webp)$/.test(i.type)||i.data.length>7e6)throw 0;return{type:"image",source:{type:"base64",media_type:i.type,data:i.data}}}),{type:"text",text:l.content}];
  s.json({text:await claude(ms)})}catch(e){s.status(e?.message?502:400).json({erro:e?.message||"Solicitação inválida."})}});
// ---- geração de imagens: provedor compatível com a API de imagens da OpenAI, trocável por variáveis de ambiente
app.post("/api/image",auth,lim(5,60),async(q,s)=>{if(!IMAGE_API_URL||!IMAGE_API_KEY)return s.status(503).json({erro:"Serviço de imagens não configurado (IMAGE_API_URL e IMAGE_API_KEY)."});
 try{const p=String(q.body.prompt||"").slice(0,1500),r=await fetch(IMAGE_API_URL,{method:"POST",headers:{authorization:"Bearer "+IMAGE_API_KEY,"content-type":"application/json"},body:JSON.stringify({model:IMAGE_MODEL,prompt:p,size:q.body.size||"1024x1024",response_format:"b64_json"})}),j=await r.json(),b=j.data?.[0]?.b64_json;
  if(!b)throw new Error(j.error?.message||"A resposta não trouxe imagem");s.json({id:db.prepare("INSERT INTO img(user_id,inv_id,prompt,b64,created) VALUES(?,?,?,?,?)").run(q.uid,q.body.inv||null,p,b,Date.now()).lastInsertRowid,b64:b})}catch(e){s.status(502).json({erro:e.message})}});
// ---- páginas: o app exige sessão; o login é público
app.get("/",(q,s)=>{try{jwt.verify(ck(q).nx,SECRET);s.sendFile(path.join(__dirname,"views/app.html"))}catch{s.redirect("/login.html")}});
app.use(express.static(path.join(__dirname,"public")));
app.use((e,q,s,n)=>{console.error(e.message);s.status(e.status||500).json({erro:"Erro interno."})});
if(require.main===module)app.listen(PORT,()=>console.log("NEXUMBRAL em http://localhost:"+PORT));else module.exports={app,RUN};
