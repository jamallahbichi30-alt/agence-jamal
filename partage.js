/* Immo-Gest — envoi de fichiers en bloc (iPhone, Mac, PC, Android)
   + réception depuis les autres applications (Android/Chrome uniquement)
   À charger APRÈS le script principal :  <script src="partage.js"></script>  (juste avant </body>) */
(()=>{
if(typeof upFile!=='function'||typeof shrink!=='function'||typeof api2!=='function'||typeof hd!=='function'||typeof toB64!=='function'){
  console.warn('partage.js : fonctions Immo-Gest introuvables, module désactivé.');return}

const MAX=25e6;                       // limite par fichier (25 Mo), comme dans l'application
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const mb=s=>(s/1048576).toFixed(1)+' Mo';
const SHARE='immo-share';
const ACCEPT='image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx';
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

/* ---------- Réception des fichiers partagés (Android / Chrome) ---------- */
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

/* ---------- Fenêtre d'envoi : fichiers reçus (files) OU choisis dans l'appli (files=null) ---------- */
function openDialog(files){
  const picker=!files;
  let chosen=files||[],busy=false;
  let d=document.getElementById('dShare');
  if(!d){d=document.createElement('dialog');d.id='dShare';document.body.append(d)}
  const group=(kind,label)=>D[kind]&&D[kind].length
    ?`<optgroup label="${label}">`+D[kind].map(x=>`<option data-no-i18n value="${kind}:${esc(x.id)}">${esc(E[kind].lab(x)||'(sans titre)')}${x.ville?' — '+esc(x.ville):''}</option>`).join('')+'</optgroup>':'';
  d.innerHTML=`<h2 style="margin:0">${picker?'Envoyer des fichiers':'Fichiers reçus ('+files.length+')'}</h2>
  <label>Ajouter à</label>
  <select id="shT"><option value="">— Choisir un bien ou un client —</option>${group('biens','Biens')}${group('clients','Clients')}</select>
  ${picker?`<label>Fichiers (photos, vidéos, documents)</label><input type="file" id="shF" multiple accept="${ACCEPT}"><p class="note">Sélectionnez plusieurs fichiers d'un coup. Sur ordinateur, vous pouvez aussi les glisser ici.</p>`:''}
  <div id="shL" class="note" data-no-i18n></div>
  ${progHtml}
  <div class="row"><button type="button" class="btn sec" id="shX">Annuler</button><button type="button" class="btn" id="shOk">Envoyer</button></div>`;
  const list=()=>{
    const big=chosen.filter(f=>f.size>MAX).length,total=chosen.reduce((s,f)=>s+f.size,0);
    d.querySelector('#shL').innerHTML=chosen.length
      ?chosen.slice(0,8).map(f=>esc(f.name)+' ('+mb(f.size)+')').join('<br>')+(chosen.length>8?'<br>… et '+(chosen.length-8)+' autres':'')+`<br><b>${chosen.length} fichier(s) — ${mb(total)}</b>`+(big?`<br><span style="color:var(--rd)">${big} fichier(s) dépassent 25 Mo et seront ignorés (compressez la vidéo).</span>`:'')
      :'';
  };
  list();
  if(picker){
    d.querySelector('#shF').onchange=ev=>{chosen=[...ev.target.files];list()};
    d.ondragover=ev=>ev.preventDefault();
    d.ondrop=ev=>{ev.preventDefault();if(ev.dataTransfer&&ev.dataTransfer.files.length){chosen=[...ev.dataTransfer.files];list()}};
  }
  d.oncancel=ev=>{if(busy)ev.preventDefault()};
  d.querySelector('#shX').onclick=async()=>{if(busy)return;if(!picker)await clearShared();d.close()};
  d.querySelector('#shOk').onclick=async()=>{
    const v=d.querySelector('#shT').value;
    if(!v){alert('Choisissez un bien ou un client.');return}
    if(!chosen.length){alert('Choisissez au moins un fichier.');return}
    if(!C.token||!C.repo){alert("Configurez d'abord la Synchronisation.");return}
    const [kind,id]=v.split(':'),rec=D[kind].find(x=>x.id===id);
    if(!rec){alert('Fiche introuvable.');return}
    busy=true;
    d.querySelector('#shOk').disabled=true;d.querySelector('#shX').disabled=true;
    batch={total:chosen.length,done:0,ok:0,fail:[]};
    for(const f of chosen)await window.upFile(rec,f);
    if(!picker)await clearShared();
    busy=false;d.close();
    tab=kind;
    try{F={q:'',a:'',b:'',city:'',type:'',pmin:'',pmax:''}}catch(e){}
    render();edit(rec.id);
  };
  d.showModal();
}

/* Bouton « 📎 Fichiers » dans l'en-tête */
(()=>{
  const sync=document.getElementById('bSync');
  if(!sync||document.getElementById('bFiles'))return;
  const b=document.createElement('button');
  b.type='button';b.className='btn sec';b.id='bFiles';b.textContent='📎 Fichiers';
  b.onclick=()=>openDialog(null);
  sync.before(b);
})();

/* Arrivée d'un partage (Android) */
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
    openDialog(files);
  }catch(e){alert('Réception impossible : '+e.message)}
})();

/* =====================================================================
   DOSSIER DE PRÉSENTATION d'un bien — bouton « Dossier » dans la fiche d'un bien
   ===================================================================== */
const N=n=>Number(n).toLocaleString('fr-FR',{maximumFractionDigits:0});
const HA=s=>(s/1e4).toLocaleString('fr-FR',{maximumFractionDigits:2});
const money=n=>n>=1e6?`${(n/1e6).toLocaleString('fr-FR',{maximumFractionDigits:2})} M MAD`:`${N(n)} MAD`;
const NOEMOJI=/[\p{Extended_Pictographic}\uFE0F\u200D]/gu;
const BULLET=/^[-•*▪✔✅]\s*/u;
const PHONE=/(\+?212|\b0)[\s.\-]?[5-7][\d\s.\-]{7,}/;
const CTA=/(pour (plus d['’]informations?|toute information|organiser une visite)|contactez|nous contacter|visite priv)/i;
const rawLines=t=>String(t||'').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'').split(/\r?\n/).map(s=>s.trim());

const normTxt=t=>String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function joinPlace(adr,ville){
  adr=String(adr||'').trim();ville=String(ville||'').trim();
  if(!adr)return ville;if(!ville)return adr;
  const a=normTxt(adr),v=normTxt(ville);
  if(a.includes(v))return adr;if(v.includes(a))return ville;
  return adr+', '+ville;
}

/* Sépare l'annonce en texte de présentation + points forts (listes introduites par « atouts », « avantages »…) */
function splitDesc(t){
  const L=rawLines(t),text=[],pts=[];
  for(let i=0;i<L.length;i++){
    const l=L[i];
    if(!l){text.push('');continue}
    if(PHONE.test(l)||CTA.test(l))continue;
    if(/:\s*$/.test(l)&&/atout|avantage|point/i.test(l)&&BULLET.test(L.slice(i+1).find(x=>x)||'')){
      let j=i+1;
      while(j<L.length&&(!L[j]||BULLET.test(L[j]))){
        if(L[j]){const v=L[j].replace(BULLET,'').replace(NOEMOJI,'').trim();if(v)pts.push(v)}
        j++;
      }
      i=j-1;continue;
    }
    if(BULLET.test(l)){const v=l.replace(BULLET,'').replace(NOEMOJI,'').trim();if(v)text.push('- '+v);continue}
    const c=l.replace(NOEMOJI,'').replace(/\s{2,}/g,' ').trim();
    if(c)text.push(c);
  }
  return{text:text.join('\n').replace(/\n{3,}/g,'\n\n').trim(),pts:pts.slice(0,10)};
}

/* Texte simple (paragraphes + listes « - ») → HTML */
function rich(txt){
  const out=[];let ul=null,p=[];
  const flushP=()=>{if(p.length){out.push(`<p style="margin:0 0 8px">${p.map(esc).join('<br>')}</p>`);p=[]}};
  const flushU=()=>{if(ul){out.push(`<ul style="margin:0 0 8px 18px;padding:0">${ul.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`);ul=null}};
  for(const raw of String(txt||'').split(/\r?\n/)){
    const l=raw.trim();
    if(!l){flushP();flushU();continue}
    if(/^[-•*]\s+/.test(l)){flushP();(ul=ul||[]).push(l.replace(/^[-•*]\s+/,''));continue}
    flushU();p.push(l);
  }
  flushP();flushU();return out.join('');
}

/* Le champ « prix » de la fiche est tantôt un prix au m² (terrains), tantôt un prix total :
   l'utilisateur choisit, avec un choix par défaut selon le type de bien. */
function prixInfo(r,mode){
  const p=Number(r.prix),s=Number(r.surf),out={total:null,perm2:null};
  if(!isFinite(p)||p<=0)return out;
  if(r.trans==='Location'){out.total=p;return out}
  if(mode==='m2'){out.perm2=p;out.total=s>0?p*s:null}
  else{out.total=p;out.perm2=s>0?Math.round(p/s):null}
  return out;
}

async function loadPhotos(r){
  const out=[];
  if(typeof ghGet!=='function'||!C.token||!C.repo)return out;
  for(const f of (r.files||[]).filter(f=>(f.t||'').startsWith('image/')).slice(0,6)){
    try{const x=await ghGet(f.p,1);if(x.ok)out.push(URL.createObjectURL(await x.blob()))}catch(e){}
  }
  return out;
}

function buildDossier(r,o,photos){
  const NAVY='#10243F',GOLD='#C9A45C',RUST='#B5553A';
  const Q=D.profil||{},P=(typeof prof==='function'?prof():{})||{};
  const c=D.clients.find(x=>x.id===o.client),isLoc=r.trans==='Location',p=prixInfo(r,o.mode),surf=Number(r.surf)||0;
  const date=new Date().toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'});
  const kind=[r.type,r.sous_type].filter(Boolean).join(' — '),place=joinPlace(r.adr,r.ville);
  const agent=P.nom||Q.nom||'',tel=P.tel||Q.tel||'';
  const sec=(t,b)=>b?`<div style="margin-top:18px;page-break-inside:avoid"><div style="font-size:13pt;font-weight:800;color:${NAVY};border-bottom:2px solid ${GOLD};padding-bottom:3px;margin-bottom:8px">${t}</div>${b}</div>`:'';

  /* chiffres clés */
  const figs=[];
  if(p.total)figs.push([isLoc?'Loyer mensuel':'Prix',money(p.total)+(isLoc?' / mois':''),p.total>=1e6?N(p.total)+' MAD':'']);
  else if(p.perm2)figs.push(['Prix',N(p.perm2)+' MAD/m²','']);
  if(surf)figs.push(['Surface',N(surf)+' m²',surf>=1e4?'soit '+HA(surf)+' ha':'']);
  if(p.perm2&&p.total&&!isLoc)figs.push(['Prix au m²',N(p.perm2)+' MAD/m²','']);
  if(r.statut)figs.push(['Disponibilité',r.statut,'']);
  const figHtml=figs.length?`<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:16px">${figs.map(f=>`<div style="flex:1 1 140px;border:1px solid ${GOLD};border-radius:8px;padding:10px 12px;background:#FBF7EA;-webkit-print-color-adjust:exact;print-color-adjust:exact;page-break-inside:avoid"><div style="font-size:9pt;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">${esc(f[0])}</div><div style="font-size:15pt;font-weight:800;color:${NAVY}">${esc(f[1])}</div>${f[2]?`<div style="font-size:9pt;color:#6b7280">${esc(f[2])}</div>`:''}</div>`).join('')}</div>`:'';

  /* photos */
  let photoHtml='';
  if(photos&&photos.length){
    photoHtml=photos.length===1
      ?`<img src="${photos[0]}" style="width:100%;max-height:300px;object-fit:cover;border-radius:8px">`
      :`<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${photos.map((u,i)=>`<img src="${u}" style="width:100%;height:${i===0&&photos.length%2?'220':'150'}px;object-fit:cover;border-radius:6px;${i===0&&photos.length%2?'grid-column:1 / -1':''}">`).join('')}</div>`;
    photoHtml=`<div style="margin-top:16px;page-break-inside:avoid">${photoHtml}</div>`;
  }

  /* caractéristiques */
  const rows=[['Type',r.type],['Sous-type',r.sous_type],['Transaction',r.trans],
    ['Surface',surf?N(surf)+' m²'+(surf>=1e4?' ('+HA(surf)+' ha)':''):''],
    [isLoc?'Loyer mensuel':'Prix',p.total?N(p.total)+' MAD'+(isLoc?' / mois':''):(p.perm2?N(p.perm2)+' MAD/m²':'')],
    ['Prix au m²',(!isLoc&&p.total&&p.perm2)?N(p.perm2)+' MAD/m²':''],
    ['Ville',r.ville],['Adresse / quartier',r.adr],['Disponibilité',r.statut],
    ['Mandat',r.mandat&&r.mandat!=='Aucun'?r.mandat+' — Immo-Gest':'']].filter(x=>x[1]);
  const table=rows.length?`<table style="width:100%;border-collapse:collapse">${rows.map((x,i)=>`<tr style="background:${i%2?'#FBF7EA':'#fff'};-webkit-print-color-adjust:exact;print-color-adjust:exact"><td style="padding:6px 10px;width:38%;color:#6b7280;border-bottom:1px solid #eee">${esc(x[0])}</td><td style="padding:6px 10px;font-weight:600;border-bottom:1px solid #eee">${esc(x[1])}</td></tr>`).join('')}</table>`:'';

  /* points forts */
  const pts=String(o.pts||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const ptsHtml=pts.length?`<ul style="list-style:none;margin:0;padding:0">${pts.map(x=>`<li style="margin:0 0 5px;padding-left:20px;position:relative"><span style="position:absolute;left:0;color:${GOLD};font-weight:800">✓</span>${esc(x)}</li>`).join('')}</ul>`:'';

  /* localisation */
  const maps=place?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`:'';
  const locHtml=place?`<p style="margin:0 0 6px"><b>${esc(place)}</b></p><p style="margin:0;font-size:9.5pt;color:#6b7280">Voir sur la carte : <a href="${maps}" style="color:${RUST}">${esc(maps.length>70?'Google Maps':maps)}</a></p>`:'';

  /* conditions */
  const cond=[];
  if(p.total)cond.push(`<p style="margin:0 0 6px">${isLoc?'Loyer mensuel':'Prix de vente'} : <b>${N(p.total)} MAD</b>${(!isLoc&&p.perm2&&surf)?` (soit ${N(p.perm2)} MAD/m² pour ${N(surf)} m²)`:''}.</p>`);
  else if(p.perm2)cond.push(`<p style="margin:0 0 6px">Prix : <b>${N(p.perm2)} MAD/m²</b>.</p>`);
  if(o.com&&r.taux&&!isLoc)cond.push(`<p style="margin:0 0 6px">Honoraires d'agence : <b>${esc(r.taux)} %</b> du prix de vente${p.total?` (soit environ ${N(Math.round(p.total*Number(r.taux)/100))} MAD)`:''}.</p>`);
  if(String(o.cond||'').trim())cond.push(rich(o.cond));

  /* déroulement */
  const steps=isLoc
    ?['Visite du bien','Remise du dossier du locataire (pièce d\'identité, justificatifs)','Validation et signature du contrat de bail','Versement du dépôt de garantie et du premier loyer','État des lieux et remise des clés']
    :['Visite du bien et échange sur vos critères','Vérification des documents (titre foncier, situation juridique, urbanisme)','Offre d\'achat et négociation du prix','Promesse ou compromis de vente, avec versement d\'un acompte','Acte définitif chez le notaire, paiement du solde et des frais','Inscription du transfert de propriété (conservation foncière, selon le cas)'];
  const stepsHtml=`<ol style="margin:0 0 0 20px;padding:0">${steps.map(s=>`<li style="margin:0 0 4px">${esc(s)}</li>`).join('')}</ol><p style="margin:6px 0 0;font-size:9pt;color:#6b7280">Déroulement habituel, donné à titre indicatif.</p>`;

  /* contact */
  const contact=[agent&&`<b>${esc(agent)}</b>`,'Immo-Gest — Intermédiation &amp; Conseil Immobilier',tel&&'Tél. : '+esc(tel),Q.mail&&'E-mail : '+esc(Q.mail),[Q.adr,Q.ville].filter(Boolean).length&&esc([Q.adr,Q.ville].filter(Boolean).join(', '))].filter(Boolean).join('<br>');
  const leg=[Q.statut,Q.ice&&'ICE : '+Q.ice,Q.if&&'IF : '+Q.if,Q.tp&&'TP : '+Q.tp].filter(Boolean).map(esc).join(' • ');

  const logo=(typeof LOGO!=='undefined')?`<img src="${LOGO}" style="height:60px;width:auto">`:'';
  return `<div style="font-size:10.5pt;line-height:1.45;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact">
<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid ${GOLD};padding-bottom:10px"><div style="display:flex;gap:12px;align-items:center">${logo}<div><div style="font-size:22pt;font-weight:800;color:${NAVY}">Immo-Gest</div><div style="font-size:9pt;color:${RUST};font-weight:600">Intermédiation &amp; Conseil Immobilier</div></div></div><div style="text-align:right"><div style="font-size:13pt;font-weight:800;color:${NAVY}">DOSSIER DE PRÉSENTATION</div><div style="font-size:9.5pt;color:#6b7280">${esc(date)}</div></div></div>
<h1 style="margin:18px 0 2px;font-size:21pt;color:${NAVY}">${esc(r.titre||'Bien immobilier')}</h1>
<div style="font-size:11.5pt;color:${RUST};font-weight:600">${esc(kind)}${kind?' · ':''}${isLoc?'À louer':'À vendre'}${r.ville?' · '+esc(r.ville):''}</div>
${c&&c.nom?`<div style="margin-top:6px;font-size:10pt;color:#6b7280">Préparé pour : <b style="color:#1a1a1a">${esc(c.nom)}</b></div>`:''}
${figHtml}${photoHtml}
${sec('Présentation du bien',rich(o.txt))}
${sec('Points forts',ptsHtml)}
${sec('Caractéristiques',table)}
${sec('Localisation',locHtml)}
${sec('Documents et situation juridique',String(o.jur||'').trim()?rich(o.jur):'')}
${sec('Conditions',cond.join(''))}
${sec('Déroulement de la transaction',stepsHtml)}
${sec('Votre contact',`<p style="margin:0">${contact}</p>`)}
<div style="margin-top:22px;border-top:1px solid ${GOLD};padding-top:8px;text-align:center;font-size:8.5pt;color:#6b7280">Document établi à titre informatif et non contractuel. Les informations proviennent des éléments communiqués par le propriétaire et doivent être vérifiées avant toute décision. Prix et disponibilité susceptibles d'évoluer sans préavis.${leg?'<br>'+leg:''}</div>
</div>`;
}

function dossierWa(r,o){
  const c=D.clients.find(x=>x.id===o.client)||{},p=prixInfo(r,o.mode),isLoc=r.trans==='Location',surf=Number(r.surf)||0;
  const L=['Bonjour'+(c.nom?' '+c.nom:'')+',','','Voici le résumé du bien :',r.titre||'Bien'];
  const kind=[r.type,r.sous_type].filter(Boolean).join(' — ');
  if(kind)L.push(kind+' — '+(isLoc?'à louer':'à vendre'));
  const loc=joinPlace(r.adr,r.ville);if(loc)L.push('📍 '+loc);
  if(surf)L.push('📐 '+N(surf)+' m²'+(surf>=1e4?' ('+HA(surf)+' ha)':''));
  if(p.total)L.push('💰 '+money(p.total)+(isLoc?' / mois':'')+((p.perm2&&!isLoc)?' ('+N(p.perm2)+' MAD/m²)':''));
  else if(p.perm2)L.push('💰 '+N(p.perm2)+' MAD/m²');
  L.push('','Je vous envoie le dossier complet en PDF.','',typeof sign==='function'?sign():'Immo-Gest');
  return L.join('\n');
}

function openDossier(id){
  const r=D.biens.find(x=>x.id===id);if(!r)return;
  const sv=r.dossier||{},isLoc=r.trans==='Location',sp=splitDesc(r.desc),defMode=sv.mode||(r.type==='Terrain'?'m2':'total');
  let photos=[];
  let d=document.getElementById('dDoss');
  if(!d){d=document.createElement('dialog');d.id='dDoss';d.style.width='min(820px,96vw)';document.body.append(d)}
  const ta=(i,l,rows,val,ph)=>`<label>${l}</label><textarea id="${i}" rows="${rows}" placeholder="${esc(ph||'')}">${esc(val??'')}</textarea>`;
  d.innerHTML=`<h2 style="margin:0">Dossier de présentation</h2>
  <p class="note" data-no-i18n>${esc(r.titre||'')}${r.ville?' — '+esc(r.ville):''}</p>
  <label>Préparé pour (facultatif)</label>
  <select id="dsC"><option value="">— Aucun —</option>${D.clients.map(c=>`<option data-no-i18n value="${esc(c.id)}" ${sv.client===c.id?'selected':''}>${esc(c.nom||'(sans nom)')}</option>`).join('')}</select>
  ${isLoc?'':`<label>Le prix saisi dans la fiche est…</label><select id="dsM"><option value="m2" ${defMode==='m2'?'selected':''}>un prix par m² (DH/m²)</option><option value="total" ${defMode==='total'?'selected':''}>le prix total (DH)</option></select>
  <label class="role-option" style="margin-top:10px"><input type="checkbox" id="dsK" ${sv.com?'checked':''}> Afficher les honoraires d'agence${r.taux?' ('+esc(r.taux)+' %)':''}</label>`}
  ${ta('dsT','Présentation du bien (modifiable)',8,sv.txt??sp.text)}
  ${ta('dsF','Points forts (un par ligne)',4,sv.pts??sp.pts.join('\n'))}
  ${ta('dsJ','Documents et situation juridique',3,sv.jur??'','Ex. : titre foncier, plan topographique, certificat de propriété…')}
  ${ta('dsR','Conditions et remarques',3,sv.cond??'','Ex. : modalités de paiement, délai, visite sur rendez-vous…')}
  <p id="dsA" class="note" style="color:var(--am);display:none" data-no-i18n></p>
  <h3>Aperçu</h3>
  <div id="dsP" data-no-i18n style="background:#fff;color:#000;padding:18px;border:1px solid var(--bd);overflow-x:auto"></div>
  <div class="row"><button type="button" class="btn sec" id="dsX">Fermer</button><button type="button" class="btn sec" id="dsW">Résumé WhatsApp</button><button type="button" class="btn" id="dsPr">Imprimer / PDF</button></div>`;
  const q=s=>d.querySelector(s);
  const get=()=>({client:q('#dsC').value,mode:isLoc?'total':q('#dsM').value,com:isLoc?false:q('#dsK').checked,txt:q('#dsT').value,pts:q('#dsF').value,jur:q('#dsJ').value,cond:q('#dsR').value});
  const warn=()=>{
    const o=get(),p=prixInfo(r,o.mode),a=q('#dsA');let m='';
    if(!isLoc&&Number(r.prix)>0){
      if(p.total&&p.total<50000)m=`Le prix affiché est très bas (${N(p.total)} MAD). Vérifiez le prix saisi dans la fiche, ou changez l'option « Le prix saisi dans la fiche est… ».`;
      else if(!p.total&&p.perm2)m='La surface n\'est pas renseignée : le prix total ne peut pas être calculé.';
    }
    a.textContent=m;a.style.display=m?'block':'none';
  };
  const paint=()=>{q('#dsP').innerHTML=buildDossier(r,get(),photos);warn()};
  const persist=()=>{r.dossier=get();save()};
  d.oninput=paint;d.onchange=paint;
  d.onclose=persist;
  q('#dsX').onclick=()=>d.close();
  q('#dsW').onclick=()=>{const o=get(),c=D.clients.find(x=>x.id===o.client)||{};wa(c.tel||'',dossierWa(r,o))};
  q('#dsPr').onclick=()=>{persist();document.getElementById('prt').innerHTML=q('#dsP').innerHTML;window.print()};
  paint();d.showModal();
  if(r.files&&r.files.length&&C.token&&C.repo){
    status('Chargement des photos…');
    loadPhotos(r).then(ph=>{photos=ph;status('');if(d.open)paint()});
  }
}

/* Ajoute le bouton « Dossier » dans la fiche d'un bien déjà enregistré */
if(typeof edit==='function'){
  const _edit=window.edit;
  window.edit=function(id){
    const res=_edit.apply(this,arguments);
    try{
      if(tab==='biens'&&id){
        const bf=document.getElementById('bf');
        if(bf&&!document.getElementById('bdos')){
          const b=document.createElement('button');
          b.type='button';b.className='btn sec';b.id='bdos';b.textContent='Dossier';
          b.onclick=()=>{
            const rec=D.biens.find(x=>x.id===id);if(!rec)return;
            const fd=new FormData(document.getElementById('frm'));
            E.biens.f.forEach(([k])=>{if(fd.has(k))rec[k]=fd.get(k)});
            save();document.getElementById('dlg').close();render();openDossier(id);
          };
          bf.after(b);
        }
      }
    }catch(e){console.warn('partage.js : bouton Dossier',e)}
    return res;
  };
}
window.immoDossier={build:buildDossier,split:splitDesc,price:prixInfo,wa:dossierWa};
})();
