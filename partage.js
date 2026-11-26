/* Immo-Gest — envoi de fichiers en bloc + réception depuis les autres applications (Android)
   À charger APRÈS le script principal :  <script src="partage.js"></script>  (juste avant </body>) */
(()=>{
if(typeof upFile!=='function'||typeof shrink!=='function'||typeof api2!=='function'||typeof hd!=='function'||typeof toB64!=='function'){
  console.warn('partage.js : fonctions Immo-Gest introuvables, module désactivé.');return}

const MAX=25e6;                       // limite par fichier (25 Mo), comme dans l'application
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const mb=s=>(s/1048576).toFixed(1)+' Mo';
const SHARE='immo-share';
let batch=null,lastBatch=null;

/* ---------- Barre de progression ---------- */
const progHtml='<div class="up-prog" hidden style="margin-top:10px"><div style="height:8px;border-radius:99px;background:var(--bd);overflow:hidden"><div class="up-bar" style="height:100%;width:0;background:var(--ac);transition:width .2s"></div></div><div class="note up-txt" style="margin-top:4px"></div></div>';
function setProgress(txt,pct){
  document.querySelectorAll('.up-prog').forEach(p=>{
    p.hidden=false;
    p.querySelector('.up-bar').style.width=Math.max(0,Math.min(100,pct))+'%';
    p.querySelector('.up-txt').textContent=txt;
  });
}
function ensureFicheProgress(){
  const fup=document.getElementById('fup');
  if(fup&&!fup.parentElement.querySelector('.up-prog'))fup.insertAdjacentHTML('afterend',progHtml);
}

/* ---------- Envoi en bloc depuis la fiche (champ « Fichiers ») ---------- */
document.addEventListener('change',ev=>{
  const t=ev.target;
  if(t&&t.id==='fup'&&t.files&&t.files.length){
    batch={total:t.files.length,done:0,ok:0,fail:[]};
    ensureFicheProgress();
    setProgress('Préparation de '+batch.total+' fichier(s)…',0);
  }
},true);

/* Glisser-déposer sur ordinateur : on dépose les fichiers dans la fiche ouverte */
document.addEventListener('dragover',ev=>{
  if(document.getElementById('fup')&&ev.target.closest&&ev.target.closest('#dlg'))ev.preventDefault();
});
document.addEventListener('drop',ev=>{
  const fup=document.getElementById('fup');
  if(!fup||!ev.target.closest||!ev.target.closest('#dlg')||!ev.dataTransfer||!ev.dataTransfer.files.length)return;
  ev.preventDefault();
  fup.files=ev.dataTransfer.files;
  fup.dispatchEvent(new Event('change',{bubbles:true}));
});

function finish(b){
  lastBatch=b;
  const bad=b.fail.length;
  setProgress(bad?`${b.ok}/${b.total} ajoutés — ${bad} en échec`:`${b.ok}/${b.total} ajoutés ✓`,100);
  status(bad?`${b.ok} fichier(s) ajouté(s), ${bad} en échec`:`${b.ok} fichier(s) ajouté(s)`);
  if(bad)alert(`${b.ok} fichier(s) ajouté(s), ${bad} en échec :\n- `+b.fail.join('\n- '));
}

/* Remplace upFile : mêmes règles que l'original, mais avec progression, 3 essais par fichier
   et un seul message récapitulatif à la fin (au lieu d'une alerte par fichier). */
window.upFile=async function(r,f){
  if(!C.token||!C.repo){alert("Configurez d'abord la Synchronisation.");return false}
  if(!batch)batch={total:1,done:0,ok:0,fail:[]};
  const b0=batch,n=b0.done+1;
  setProgress(`Fichier ${n}/${b0.total} : ${f.name}`,b0.done/b0.total*100);
  let ok=false,reason='';
  try{
    let b=f;
    if((f.type||'').startsWith('image/'))b=await shrink(f);
    if(b.size>MAX){
      reason=`trop lourd (${mb(b.size)}, max 25 Mo) — compressez la vidéo`;
    }else{
      const nm=f.name.replace(/[^\w.\-]+/g,'_'),p=`fichiers/${r.id}/${Date.now()}-${b0.done}-${nm}`;
      const body=JSON.stringify({message:'Fichier '+nm,content:toB64(await b.arrayBuffer())});
      for(let a=1;a<=3&&!ok;a++){
        try{
          const res=await fetch(api2(p),{method:'PUT',headers:hd(),body});
          if(res.ok){
            (r.files=r.files||[]).push({n:f.name,p,t:b.type||f.type||''});
            save();ok=true;
          }else if([401,403,404].includes(res.status)){
            reason=`accès GitHub refusé (${res.status}) — vérifiez le jeton`;break;
          }else{
            reason='erreur GitHub '+res.status;await sleep(1500*a);
          }
        }catch(e){reason='connexion interrompue';await sleep(1500*a)}
      }
    }
  }catch(e){reason=e.message||'erreur inconnue'}
  b0.done++;
  if(ok)b0.ok++;else b0.fail.push(`${f.name} — ${reason}`);
  setProgress(`${b0.done}/${b0.total} traités`,b0.done/b0.total*100);
  if(b0.done>=b0.total){finish(b0);batch=null}
  return ok;
};

/* ---------- Réception des fichiers partagés depuis une autre application ---------- */
async function readShared(){
  const c=await caches.open(SHARE);
  const keys=(await c.keys()).sort((a,b)=>a.url<b.url?-1:1),out=[];
  for(const k of keys){
    const rs=await c.match(k),blob=await rs.blob();
    out.push(new File([blob],decodeURIComponent(rs.headers.get('X-Name')||'fichier'),{type:rs.headers.get('Content-Type')||blob.type||''}));
  }
  return out;
}
async function clearShared(){
  try{const c=await caches.open(SHARE);for(const k of await c.keys())await c.delete(k)}catch(e){}
}

function openShare(files){
  let d=document.getElementById('dShare');
  if(!d){d=document.createElement('dialog');d.id='dShare';document.body.append(d)}
  const group=(kind,label)=>D[kind]&&D[kind].length
    ?`<optgroup label="${label}">`+D[kind].map(x=>`<option data-no-i18n value="${kind}:${esc(x.id)}">${esc(E[kind].lab(x)||'(sans titre)')}${x.ville?' — '+esc(x.ville):''}</option>`).join('')+'</optgroup>':'';
  const big=files.filter(f=>f.size>MAX).length;
  const total=files.reduce((s,f)=>s+f.size,0);
  d.innerHTML=`<h2 style="margin:0">Fichiers reçus (${files.length})</h2>
  <p class="note" data-no-i18n>${files.slice(0,8).map(f=>esc(f.name)+' ('+mb(f.size)+')').join('<br>')}${files.length>8?'<br>… et '+(files.length-8)+' autres':''}<br><b>Total : ${mb(total)}</b></p>
  ${big?`<p class="note" style="color:var(--rd)">${big} fichier(s) dépassent 25 Mo et seront ignorés (compressez la vidéo).</p>`:''}
  <label>Ajouter à</label>
  <select id="shT"><option value="">— Choisir un bien ou un client —</option>${group('biens','Biens')}${group('clients','Clients')}</select>
  ${progHtml}
  <div class="row"><button type="button" class="btn sec" id="shX">Annuler</button><button type="button" class="btn" id="shOk">Envoyer</button></div>`;
  let busy=false;
  d.oncancel=ev=>{if(busy)ev.preventDefault()};
  d.querySelector('#shX').onclick=async()=>{if(busy)return;await clearShared();d.close()};
  d.querySelector('#shOk').onclick=async()=>{
    const v=d.querySelector('#shT').value;
    if(!v){alert('Choisissez un bien ou un client.');return}
    if(!C.token||!C.repo){alert("Configurez d'abord la Synchronisation.");return}
    const [kind,id]=v.split(':'),rec=D[kind].find(x=>x.id===id);
    if(!rec){alert('Fiche introuvable.');return}
    busy=true;
    d.querySelector('#shOk').disabled=true;d.querySelector('#shX').disabled=true;
    batch={total:files.length,done:0,ok:0,fail:[]};
    for(const f of files)await window.upFile(rec,f);
    await clearShared();
    busy=false;d.close();
    tab=kind;
    try{F={q:'',a:'',b:'',city:'',type:'',pmin:'',pmax:''}}catch(e){}
    render();edit(rec.id);
  };
  d.showModal();
}

(async()=>{
  const q=new URLSearchParams(location.search);
  if(!q.has('share'))return;
  try{history.replaceState(null,'',location.pathname)}catch(e){}
  if(!Number(q.get('share'))){
    alert("Aucun fichier reçu. Partagez des photos, vidéos ou documents depuis la galerie ou WhatsApp.");return}
  await sleep(1200);                  // laisse la synchronisation de démarrage se terminer
  try{
    const files=await readShared();
    if(!files.length){alert("Les fichiers partagés n'ont pas été retrouvés. Refaites le partage.");return}
    openShare(files);
  }catch(e){alert('Réception impossible : '+e.message)}
})();
})();
