const V='agence-v14',SHARE='immo-share',ASSETS=['./','./index.html','./manifest.json','./partage.js','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>Promise.allSettled(ASSETS.map(a=>c.add(a)))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V&&x!==SHARE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});

// Réception des fichiers partagés depuis une autre application (galerie, WhatsApp, Fichiers…)
// Les fichiers sont gardés dans un cache temporaire, puis l'application les récupère (partage.js).
async function recevoirPartage(req){
 const retour=n=>Response.redirect(new URL('./?share='+n,self.registration.scope).href,303);
 try{
  const fd=await req.formData();
  const fichiers=fd.getAll('fichiers').filter(f=>f&&typeof f!=='string');
  const c=await caches.open(SHARE);
  for(const k of await c.keys())await c.delete(k);
  let i=0;
  for(const f of fichiers){
   await c.put(new Request(new URL('./shared/'+String(i++).padStart(3,'0'),self.registration.scope).href),
    new Response(f,{headers:{'Content-Type':f.type||'application/octet-stream','X-Name':encodeURIComponent(f.name||'fichier')}}));
  }
  return retour(fichiers.length);
 }catch(_){return retour(0)}
}

// Priorité au réseau : la nouvelle version s'affiche dès qu'il y a internet ; sans internet, la copie enregistrée prend le relais.
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);
if(e.request.method==='POST'&&u.origin===location.origin&&u.pathname.endsWith('/share-target')){e.respondWith(recevoirPartage(e.request));return}
if(e.request.method!=='GET'||u.origin!==location.origin)return;
e.respondWith((async()=>{const c=await caches.open(V);
try{const r=await Promise.race([fetch(e.request,{cache:'no-cache'}),new Promise((_,no)=>setTimeout(()=>no(new Error('lent')),4000))]);if(r&&r.ok)c.put(e.request,r.clone());return r}
catch(_){const hit=await c.match(e.request,{ignoreSearch:true});return hit||Response.error()}})())});
