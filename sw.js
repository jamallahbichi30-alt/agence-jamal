const V='agence-v8',ASSETS=['./','./index.html','./manifest.json','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
// Priorité au réseau : la nouvelle version s'affiche dès qu'il y a internet ; sans internet, la copie enregistrée prend le relais.
self.addEventListener('fetch',e=>{const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
e.respondWith((async()=>{const c=await caches.open(V);
try{const r=await Promise.race([fetch(e.request,{cache:'no-cache'}),new Promise((_,no)=>setTimeout(()=>no(new Error('lent')),4000))]);if(r&&r.ok)c.put(e.request,r.clone());return r}
catch(_){const hit=await c.match(e.request,{ignoreSearch:true});return hit||Response.error()}})())});
