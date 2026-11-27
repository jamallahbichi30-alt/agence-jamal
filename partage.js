/* Immo-Gest — envoi de fichiers en bloc, réception depuis les autres applications (Android)
   et dossier de présentation d'un bien. Tout est disponible en français, anglais et arabe.
   À charger APRÈS le script principal :  <script src="partage.js"></script>  (juste avant </body>) */
(()=>{
if(typeof upFile!=='function'||typeof shrink!=='function'||typeof api2!=='function'||typeof hd!=='function'||typeof toB64!=='function'){
  console.warn('partage.js : fonctions Immo-Gest introuvables, module désactivé.');return}

/* ---------- Langues : T(français, anglais, arabe) suit la langue de l'application ---------- */
const T=(fr,en,ar)=>lang==='en'?en:lang==='ar'?ar:fr;
try{
  Object.assign(LANGS.en,{'📎 Fichiers':'📎 Files','Dossier':'Brochure'});
  Object.assign(LANGS.ar,{'📎 Fichiers':'📎 الملفات','Dossier':'ملف العقار'});
}catch(e){}

const MAX=25e6;                       // limite par fichier (25 Mo), comme dans l'application
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const mb=s=>(s/1048576).toFixed(1)+' '+T('Mo','MB','ميغابايت');
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
    setProgress(T(`Préparation de ${batch.total} fichier(s)…`,`Preparing ${batch.total} file(s)…`,`تحضير ${batch.total} ملف(ات)…`),0);
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
  setProgress(bad
    ?T(`${b.ok}/${b.total} ajoutés — ${bad} en échec`,`${b.ok}/${b.total} added — ${bad} failed`,`${b.ok}/${b.total} تمت إضافتها — فشل ${bad}`)
    :T(`${b.ok}/${b.total} ajoutés ✓`,`${b.ok}/${b.total} added ✓`,`${b.ok}/${b.total} تمت إضافتها ✓`),100);
  status(T(`${b.ok} fichier(s) ajouté(s)`,`${b.ok} file(s) added`,`تمت إضافة ${b.ok} ملف(ات)`)+(bad?T(`, ${bad} en échec`,`, ${bad} failed`,`، فشل ${bad}`):''));
  if(bad)alert(T(`${b.ok} fichier(s) ajouté(s), ${bad} en échec :`,`${b.ok} file(s) added, ${bad} failed:`,`تمت إضافة ${b.ok} ملف(ات)، وفشل ${bad}:`)+'\n- '+b.fail.join('\n- '));
}

const why={
  big:s=>T(`trop lourd (${mb(s)}, max 25 Mo) — compressez la vidéo`,`too large (${mb(s)}, max 25 MB) — compress the video`,`حجمه كبير (${mb(s)}، الحد الأقصى 25 ميغابايت) — اضغط الفيديو`),
  denied:c=>T(`accès GitHub refusé (${c}) — vérifiez le jeton`,`GitHub access denied (${c}) — check the token`,`تم رفض الوصول إلى GitHub (${c}) — تحقق من الرمز`),
  gh:c=>T(`erreur GitHub ${c}`,`GitHub error ${c}`,`خطأ GitHub ${c}`),
  net:()=>T('connexion interrompue','connection lost','انقطع الاتصال'),
  unk:()=>T('erreur inconnue','unknown error','خطأ غير معروف')
};

/* Remplace upFile : mêmes règles que l'original, mais avec progression, 3 essais par fichier
   et un seul message récapitulatif à la fin (au lieu d'une alerte par fichier). */
window.upFile=async function(r,f){
  if(!C.token||!C.repo){alert(T("Configurez d'abord la Synchronisation.",'Configure Sync first.','قم بإعداد المزامنة أولاً.'));return false}
  if(!batch)batch={total:1,done:0,ok:0,fail:[]};
  const b0=batch,n=b0.done+1;
  setProgress(T(`Fichier ${n}/${b0.total} : ${f.name}`,`File ${n}/${b0.total}: ${f.name}`,`الملف ${n}/${b0.total}: ${f.name}`),b0.done/b0.total*100);
  let ok=false,reason='';
  try{
    let b=f;
    if((f.type||'').startsWith('image/'))b=await shrink(f);
    if(b.size>MAX){
      reason=why.big(b.size);
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
            reason=why.denied(res.status);break;
          }else{
            reason=why.gh(res.status);await sleep(1500*a);
          }
        }catch(e){reason=why.net();await sleep(1500*a)}
      }
    }
  }catch(e){reason=e.message||why.unk()}
  b0.done++;
  if(ok)b0.ok++;else b0.fail.push(`${f.name} — ${reason}`);
  setProgress(T(`${b0.done}/${b0.total} traités`,`${b0.done}/${b0.total} processed`,`${b0.done}/${b0.total} تمت معالجتها`),b0.done/b0.total*100);
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
  d.setAttribute('data-no-i18n','');
  const group=(kind,label)=>D[kind]&&D[kind].length
    ?`<optgroup label="${label}">`+D[kind].map(x=>`<option value="${kind}:${esc(x.id)}">${esc(E[kind].lab(x)||T('(sans titre)','(untitled)','(بدون عنوان)'))}${x.ville?' — '+esc(x.ville):''}</option>`).join('')+'</optgroup>':'';
  d.innerHTML=`<h2 style="margin:0">${picker?T('Envoyer des fichiers','Send files','إرسال الملفات'):T('Fichiers reçus','Files received','الملفات المستلمة')+' ('+files.length+')'}</h2>
  <label>${T('Ajouter à','Add to','إضافة إلى')}</label>
  <select id="shT"><option value="">${T('— Choisir un bien ou un client —','— Choose a property or a client —','— اختر عقاراً أو عميلاً —')}</option>${group('biens',T('Biens','Properties','العقارات'))}${group('clients',T('Clients','Clients','العملاء'))}</select>
  ${picker?`<label>${T('Fichiers (photos, vidéos, documents)','Files (photos, videos, documents)','الملفات (صور، فيديوهات، مستندات)')}</label><input type="file" id="shF" multiple accept="${ACCEPT}"><p class="note">${T("Sélectionnez plusieurs fichiers d'un coup. Sur ordinateur, vous pouvez aussi les glisser ici.",'Select several files at once. On a computer, you can also drag them here.','حدد عدة ملفات دفعة واحدة. على الحاسوب يمكنك أيضاً سحبها وإفلاتها هنا.')}</p>`:''}
  <div id="shL" class="note"></div>
  ${progHtml}
  <div class="row"><button type="button" class="btn sec" id="shX">${T('Annuler','Cancel','إلغاء')}</button><button type="button" class="btn" id="shOk">${T('Envoyer','Send','إرسال')}</button></div>`;
  const list=()=>{
    const big=chosen.filter(f=>f.size>MAX).length,total=chosen.reduce((s,f)=>s+f.size,0);
    d.querySelector('#shL').innerHTML=chosen.length
      ?chosen.slice(0,8).map(f=>esc(f.name)+' ('+mb(f.size)+')').join('<br>')
        +(chosen.length>8?'<br>'+T(`… et ${chosen.length-8} autres`,`… and ${chosen.length-8} more`,`… و${chosen.length-8} أخرى`):'')
        +`<br><b>${T(`${chosen.length} fichier(s) — ${mb(total)}`,`${chosen.length} file(s) — ${mb(total)}`,`${chosen.length} ملف(ات) — ${mb(total)}`)}</b>`
        +(big?`<br><span style="color:var(--rd)">${T(`${big} fichier(s) dépassent 25 Mo et seront ignorés (compressez la vidéo).`,`${big} file(s) exceed 25 MB and will be skipped (compress the video).`,`${big} ملف(ات) يتجاوز 25 ميغابايت وسيتم تجاهله (اضغط الفيديو).`)}</span>`:'')
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
    if(!v){alert(T('Choisissez un bien ou un client.','Choose a property or a client.','اختر عقاراً أو عميلاً.'));return}
    if(!chosen.length){alert(T('Choisissez au moins un fichier.','Choose at least one file.','اختر ملفاً واحداً على الأقل.'));return}
    if(!C.token||!C.repo){alert(T("Configurez d'abord la Synchronisation.",'Configure Sync first.','قم بإعداد المزامنة أولاً.'));return}
    const [kind,id]=v.split(':'),rec=D[kind].find(x=>x.id===id);
    if(!rec){alert(T('Fiche introuvable.','Record not found.','السجل غير موجود.'));return}
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

/* Bouton « 📎 Fichiers » dans l'en-tête (traduit par le dictionnaire de l'application) */
(()=>{
  const sync=document.getElementById('bSync');
  if(!sync||document.getElementById('bFiles'))return;
  const b=document.createElement('button');
  b.type='button';b.className='btn sec';b.id='bFiles';b.textContent='📎 Fichiers';
  b.onclick=()=>openDialog(null);
  sync.before(b);
  if(typeof localize==='function')localize(b);
})();

/* Arrivée d'un partage (Android) */
(async()=>{
  const q=new URLSearchParams(location.search);
  if(!q.has('share'))return;
  try{history.replaceState(null,'',location.pathname)}catch(e){}
  if(!Number(q.get('share'))){
    alert(T("Aucun fichier reçu. Partagez des photos, vidéos ou documents depuis la galerie ou WhatsApp.",'No file received. Share photos, videos or documents from your gallery or WhatsApp.','لم يتم استلام أي ملف. شارك صوراً أو فيديوهات أو مستندات من المعرض أو واتساب.'));return}
  await sleep(1200);                  // laisse la synchronisation de démarrage se terminer
  try{
    const files=await readShared();
    if(!files.length){alert(T("Les fichiers partagés n'ont pas été retrouvés. Refaites le partage.",'The shared files could not be found. Please share them again.','تعذر العثور على الملفات المشاركة. أعد المشاركة.'));return}
    openDialog(files);
  }catch(e){alert(T('Réception impossible : ','Could not receive the files: ','تعذر الاستلام: ')+e.message)}
})();

/* =====================================================================
   DOSSIER DE PRÉSENTATION d'un bien — bouton « Dossier » dans la fiche d'un bien
   Le dossier peut être produit en français, anglais ou arabe (choix dans la fenêtre).
   ===================================================================== */
const NLOC={fr:'fr-FR',en:'en-GB',ar:'fr-FR'},DLOC={fr:'fr-FR',en:'en-GB',ar:'ar-MA-u-nu-latn'};
const N=(n,dl)=>Number(n).toLocaleString(NLOC[dl||'fr'],{maximumFractionDigits:0});
const HA=(s,dl)=>(s/1e4).toLocaleString(NLOC[dl||'fr'],{maximumFractionDigits:2});

const DOC={
 fr:{dir:'ltr',unit:{mad:'MAD',m2:'m²',madm2:'MAD/m²',mmad:'M MAD',ha:'ha',month:' / mois'},
  tagline:'Intermédiation & Conseil Immobilier',title:'DOSSIER DE PRÉSENTATION',defTitle:'Bien immobilier',forSale:'À vendre',forRent:'À louer',
  preparedFor:'Préparé pour :',price:'Prix',rent:'Loyer mensuel',area:'Surface',perM2:'Prix au m²',avail:'Disponibilité',asHa:h=>'soit '+h+' ha',
  secPres:'Présentation du bien',secPts:'Points forts',secDet:'Caractéristiques',secLoc:'Localisation',secDocs:'Documents et situation juridique',secTerms:'Conditions',secSteps:'Déroulement de la transaction',secContact:'Votre contact',
  type:'Type',subtype:'Sous-type',trans:'Transaction',city:'Ville',addr:'Adresse / quartier',mandate:'Mandat',viewMap:'Voir sur la carte :',
  salePrice:'Prix de vente',priceOnly:'Prix',perM2For:(p,s)=>`soit ${p} pour ${s}`,fee:(t,tot)=>`Honoraires d'agence : <b>${t} %</b> du prix de vente${tot?` (soit environ ${tot})`:''}.`,
  stepsSale:['Visite du bien et échange sur vos critères','Vérification des documents (titre foncier, situation juridique, urbanisme)',"Offre d'achat et négociation du prix","Promesse ou compromis de vente, avec versement d'un acompte",'Acte définitif chez le notaire, paiement du solde et des frais','Inscription du transfert de propriété (conservation foncière, selon le cas)'],
  stepsRent:['Visite du bien',"Remise du dossier du locataire (pièce d'identité, justificatifs)",'Validation et signature du contrat de bail','Versement du dépôt de garantie et du premier loyer',"État des lieux et remise des clés"],
  stepsNote:'Déroulement habituel, donné à titre indicatif.',tel:'Tél. :',mail:'E-mail :',
  disclaimer:"Document établi à titre informatif et non contractuel. Les informations proviennent des éléments communiqués par le propriétaire et doivent être vérifiées avant toute décision. Prix et disponibilité susceptibles d'évoluer sans préavis.",
  hello:n=>'Bonjour'+(n?' '+n:'')+',',summary:'Voici le résumé du bien :',sendPdf:'Je vous envoie le dossier complet en PDF.',regards:'Cordialement,'},
 en:{dir:'ltr',unit:{mad:'MAD',m2:'m²',madm2:'MAD/m²',mmad:'M MAD',ha:'ha',month:' / month'},
  tagline:'Real Estate Brokerage & Consulting',title:'PROPERTY BROCHURE',defTitle:'Property',forSale:'For sale',forRent:'For rent',
  preparedFor:'Prepared for:',price:'Price',rent:'Monthly rent',area:'Area',perM2:'Price per m²',avail:'Availability',asHa:h=>'i.e. '+h+' ha',
  secPres:'Property overview',secPts:'Key features',secDet:'Details',secLoc:'Location',secDocs:'Documents and legal status',secTerms:'Terms',secSteps:'How the transaction works',secContact:'Your contact',
  type:'Type',subtype:'Subtype',trans:'Transaction',city:'City',addr:'Address / area',mandate:'Mandate',viewMap:'View on map:',
  salePrice:'Sale price',priceOnly:'Price',perM2For:(p,s)=>`i.e. ${p} for ${s}`,fee:(t,tot)=>`Agency fee: <b>${t}%</b> of the sale price${tot?` (approx. ${tot})`:''}.`,
  stepsSale:['Property viewing and discussion of your criteria','Document checks (land title, legal status, urban planning)','Purchase offer and price negotiation','Promise or preliminary sale agreement, with a deposit','Final deed at the notary, payment of the balance and fees','Registration of the transfer of ownership (land registry, where applicable)'],
  stepsRent:['Property viewing',"Submission of the tenant's file (ID, supporting documents)",'Approval and signature of the lease','Payment of the security deposit and first rent','Inventory check and handover of keys'],
  stepsNote:'Usual process, given for information only.',tel:'Tel.:',mail:'E-mail:',
  disclaimer:'This document is provided for information only and is not contractual. The information comes from details supplied by the owner and must be verified before any decision. Price and availability may change without notice.',
  hello:n=>'Hello'+(n?' '+n:'')+',',summary:'Here is a summary of the property:',sendPdf:"I'm sending you the full brochure as a PDF.",regards:'Kind regards,'},
 ar:{dir:'rtl',unit:{mad:'درهم',m2:'م²',madm2:'درهم/م²',mmad:'مليون درهم',ha:'هكتار',month:' / شهر'},
  tagline:'وساطة واستشارات عقارية',title:'ملف تقديم العقار',defTitle:'عقار',forSale:'للبيع',forRent:'للإيجار',
  preparedFor:'أُعدّ لفائدة:',price:'السعر',rent:'الإيجار الشهري',area:'المساحة',perM2:'السعر للمتر المربع',avail:'الحالة',asHa:h=>'أي '+h+' هكتار',
  secPres:'نبذة عن العقار',secPts:'نقاط القوة',secDet:'المواصفات',secLoc:'الموقع',secDocs:'الوثائق والوضعية القانونية',secTerms:'الشروط',secSteps:'مراحل المعاملة',secContact:'للتواصل',
  type:'النوع',subtype:'النوع الفرعي',trans:'المعاملة',city:'المدينة',addr:'العنوان / الحي',mandate:'التفويض',viewMap:'عرض على الخريطة:',
  salePrice:'ثمن البيع',priceOnly:'السعر',perM2For:(p,s)=>`أي ${p} لمساحة ${s}`,fee:(t,tot)=>`أتعاب الوكالة: <b>${t} %</b> من ثمن البيع${tot?` (أي حوالي ${tot})`:''}.`,
  stepsSale:['معاينة العقار والحديث عن معاييركم','التحقق من الوثائق (الرسم العقاري، الوضعية القانونية، التعمير)','تقديم عرض الشراء والتفاوض على السعر','وعد بالبيع أو عقد ابتدائي مع دفع عربون','العقد النهائي لدى الموثق، وأداء الباقي والمصاريف','تسجيل نقل الملكية (المحافظة العقارية، حسب الحالة)'],
  stepsRent:['معاينة العقار','تسليم ملف المكتري (بطاقة الهوية، الوثائق المثبتة)','الموافقة وتوقيع عقد الكراء','أداء ضمانة الكراء وأول شهر','المعاينة الوصفية للعقار وتسليم المفاتيح'],
  stepsNote:'مراحل معتادة، على سبيل الإرشاد فقط.',tel:'الهاتف:',mail:'البريد الإلكتروني:',
  disclaimer:'هذه الوثيقة للإخبار فقط وليس لها قيمة تعاقدية. المعلومات مستمدة مما قدّمه المالك ويجب التحقق منها قبل أي قرار. قد يتغير السعر والتوفر دون إشعار مسبق.',
  hello:n=>'السلام عليكم'+(n?' '+n:'')+'،',summary:'إليكم ملخص العقار:',sendPdf:'سأرسل لكم الملف الكامل بصيغة PDF.',regards:'مع التحية،'}
};
const money=(n,dl)=>{const u=DOC[dl].unit;return n>=1e6?`${(n/1e6).toLocaleString(NLOC[dl],{maximumFractionDigits:2})} ${u.mmad}`:`${N(n,dl)} ${u.mad}`};

const VAL={
 en:{Appartement:'Apartment',Maison:'House',Local:'Commercial unit',Terrain:'Land',Bureau:'Office',Immeuble:'Building','Entrepôt':'Warehouse',Riad:'Riad',Ferme:'Farm',Disponible:'Available','Sous offre':'Under offer','Vendu / loué':'Sold / rented',Vente:'Sale',Location:'Rental',Simple:'Non-exclusive',Exclusif:'Exclusive'},
 ar:{Appartement:'شقة',Maison:'منزل',Local:'محل تجاري',Terrain:'أرض',Bureau:'مكتب',Immeuble:'عمارة','Entrepôt':'مستودع',Riad:'رياض',Ferme:'مزرعة',Disponible:'متاح','Sous offre':'قيد العرض','Vendu / loué':'تم البيع / التأجير',Vente:'بيع',Location:'إيجار',Simple:'عادي',Exclusif:'حصري'}
};
const normTxt=t=>String(t||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
function tv(v,dl){
  if(!v||dl==='fr')return v||'';
  if(VAL[dl][v])return VAL[dl][v];
  if(/^zone industr/.test(normTxt(v)))return dl==='en'?'Industrial zone':'منطقة صناعية';
  return v;
}
function joinPlace(adr,ville){
  adr=String(adr||'').trim();ville=String(ville||'').trim();
  if(!adr)return ville;if(!ville)return adr;
  const a=normTxt(adr),v=normTxt(ville);
  if(a.includes(v))return adr;if(v.includes(a))return ville;
  return adr+', '+ville;
}

const NOEMOJI=/[\p{Extended_Pictographic}\uFE0F\u200D]/gu;
const BULLET=/^[-•*▪✔✅]\s*/u;
const PHONE=/(\+?212|\b0)[\s.\-]?[5-7][\d\s.\-]{7,}/;
const CTA=/(pour (plus d['’]informations?|toute information|organiser une visite)|contactez|nous contacter|visite priv)/i;
const rawLines=t=>String(t||'').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'').split(/\r?\n/).map(s=>s.trim());

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
  const flushP=()=>{if(p.length){out.push(`<p dir="auto" style="margin:0 0 8px">${p.map(esc).join('<br>')}</p>`);p=[]}};
  const flushU=()=>{if(ul){out.push(`<ul dir="auto" style="margin:0 0 8px;padding-inline-start:20px">${ul.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`);ul=null}};
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
  const dl=DOC[o.lang]?o.lang:'fr',X=DOC[dl],U=X.unit,rtl=X.dir==='rtl';
  const NAVY='#10243F',GOLD='#C9A45C',RUST='#B5553A';
  const Q=D.profil||{},P=(typeof prof==='function'?prof():{})||{};
  const c=D.clients.find(x=>x.id===o.client),isLoc=r.trans==='Location',p=prixInfo(r,o.mode),surf=Number(r.surf)||0;
  const date=new Date().toLocaleDateString(DLOC[dl],{day:'numeric',month:'long',year:'numeric'});
  const kind=[tv(r.type,dl),tv(r.sous_type,dl)].filter(Boolean).join(' — '),place=joinPlace(r.adr,r.ville);
  const agent=P.nom||Q.nom||'',tel=P.tel||Q.tel||'';
  const sec=(t,b)=>b?`<div style="margin-top:18px;page-break-inside:avoid"><div style="font-size:13pt;font-weight:800;color:${NAVY};border-bottom:2px solid ${GOLD};padding-bottom:3px;margin-bottom:8px">${esc(t)}</div>${b}</div>`:'';
  const mo=isLoc?U.month:'';

  /* chiffres clés */
  const figs=[];
  if(p.total)figs.push([isLoc?X.rent:X.price,money(p.total,dl)+mo,p.total>=1e6?N(p.total,dl)+' '+U.mad:'']);
  else if(p.perm2)figs.push([X.price,N(p.perm2,dl)+' '+U.madm2,'']);
  if(surf)figs.push([X.area,N(surf,dl)+' '+U.m2,surf>=1e4?X.asHa(HA(surf,dl)):'']);
  if(p.perm2&&p.total&&!isLoc)figs.push([X.perM2,N(p.perm2,dl)+' '+U.madm2,'']);
  if(r.statut)figs.push([X.avail,tv(r.statut,dl),'']);
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
  const rows=[[X.type,tv(r.type,dl)],[X.subtype,tv(r.sous_type,dl)],[X.trans,tv(r.trans,dl)],
    [X.area,surf?N(surf,dl)+' '+U.m2+(surf>=1e4?' ('+HA(surf,dl)+' '+U.ha+')':''):''],
    [isLoc?X.rent:X.price,p.total?N(p.total,dl)+' '+U.mad+mo:(p.perm2?N(p.perm2,dl)+' '+U.madm2:'')],
    [X.perM2,(!isLoc&&p.total&&p.perm2)?N(p.perm2,dl)+' '+U.madm2:''],
    [X.city,r.ville],[X.addr,r.adr],[X.avail,tv(r.statut,dl)],
    [X.mandate,r.mandat&&r.mandat!=='Aucun'?tv(r.mandat,dl)+' — Immo-Gest':'']].filter(x=>x[1]);
  const table=rows.length?`<table style="width:100%;border-collapse:collapse">${rows.map((x,i)=>`<tr style="background:${i%2?'#FBF7EA':'#fff'};-webkit-print-color-adjust:exact;print-color-adjust:exact"><td style="padding:6px 10px;width:38%;color:#6b7280;border-bottom:1px solid #eee">${esc(x[0])}</td><td style="padding:6px 10px;font-weight:600;border-bottom:1px solid #eee">${esc(x[1])}</td></tr>`).join('')}</table>`:'';

  /* points forts */
  const pts=String(o.pts||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const ptsHtml=pts.length?`<ul dir="auto" style="list-style:none;margin:0;padding:0">${pts.map(x=>`<li style="margin:0 0 5px;padding-inline-start:20px;position:relative"><span style="position:absolute;inset-inline-start:0;color:${GOLD};font-weight:800">✓</span>${esc(x)}</li>`).join('')}</ul>`:'';

  /* localisation */
  const maps=place?`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`:'';
  const locHtml=place?`<p dir="auto" style="margin:0 0 6px"><b>${esc(place)}</b></p><p style="margin:0;font-size:9.5pt;color:#6b7280">${esc(X.viewMap)} <a href="${maps}" style="color:${RUST}">Google Maps</a></p>`:'';

  /* conditions */
  const cond=[];
  if(p.total)cond.push(`<p style="margin:0 0 6px">${esc(isLoc?X.rent:X.salePrice)} : <b>${N(p.total,dl)} ${U.mad}</b>${(!isLoc&&p.perm2&&surf)?' ('+esc(X.perM2For(N(p.perm2,dl)+' '+U.madm2,N(surf,dl)+' '+U.m2))+')':''}${isLoc?esc(U.month):''}.</p>`);
  else if(p.perm2)cond.push(`<p style="margin:0 0 6px">${esc(X.priceOnly)} : <b>${N(p.perm2,dl)} ${U.madm2}</b>.</p>`);
  if(o.com&&r.taux&&!isLoc)cond.push(`<p style="margin:0 0 6px">${X.fee(esc(r.taux),p.total?'~ '+N(Math.round(p.total*Number(r.taux)/100),dl)+' '+U.mad:'')}</p>`);
  if(String(o.cond||'').trim())cond.push(rich(o.cond));

  /* déroulement */
  const steps=isLoc?X.stepsRent:X.stepsSale;
  const stepsHtml=`<ol style="margin:0;padding-inline-start:22px">${steps.map(s=>`<li style="margin:0 0 4px">${esc(s)}</li>`).join('')}</ol><p style="margin:6px 0 0;font-size:9pt;color:#6b7280">${esc(X.stepsNote)}</p>`;

  /* contact */
  const addrQ=[Q.adr,Q.ville].filter(Boolean).join(', ');
  const contact=[agent&&`<b>${esc(agent)}</b>`,'Immo-Gest — '+esc(X.tagline),tel&&esc(X.tel)+' <span dir="ltr">'+esc(tel)+'</span>',Q.mail&&esc(X.mail)+' <span dir="ltr">'+esc(Q.mail)+'</span>',addrQ&&esc(addrQ)].filter(Boolean).join('<br>');
  const leg=[Q.statut,Q.ice&&'ICE : '+Q.ice,Q.if&&'IF : '+Q.if,Q.tp&&'TP : '+Q.tp].filter(Boolean).map(esc).join(' • ');

  const logo=(typeof LOGO!=='undefined')?`<img src="${LOGO}" style="height:60px;width:auto">`:'';
  return `<div dir="${X.dir}" lang="${dl}" style="font-family:system-ui,-apple-system,'Segoe UI',Tahoma,'Noto Naskh Arabic',Arial,sans-serif;text-align:start;font-size:10.5pt;line-height:1.5;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact">
<div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid ${GOLD};padding-bottom:10px"><div style="display:flex;gap:12px;align-items:center">${logo}<div><div style="font-size:22pt;font-weight:800;color:${NAVY}">Immo-Gest</div><div style="font-size:9pt;color:${RUST};font-weight:600">${esc(X.tagline)}</div></div></div><div style="text-align:end"><div style="font-size:13pt;font-weight:800;color:${NAVY}">${esc(X.title)}</div><div style="font-size:9.5pt;color:#6b7280">${esc(date)}</div></div></div>
<h1 style="margin:18px 0 2px;font-size:21pt;color:${NAVY}">${esc(r.titre||X.defTitle)}</h1>
<div style="font-size:11.5pt;color:${RUST};font-weight:600">${esc(kind)}${kind?' · ':''}${esc(isLoc?X.forRent:X.forSale)}${r.ville?' · '+esc(r.ville):''}</div>
${c&&c.nom?`<div style="margin-top:6px;font-size:10pt;color:#6b7280">${esc(X.preparedFor)} <b style="color:#1a1a1a">${esc(c.nom)}</b></div>`:''}
${figHtml}${photoHtml}
${sec(X.secPres,rich(o.txt))}
${sec(X.secPts,ptsHtml)}
${sec(X.secDet,table)}
${sec(X.secLoc,locHtml)}
${sec(X.secDocs,String(o.jur||'').trim()?rich(o.jur):'')}
${sec(X.secTerms,cond.join(''))}
${sec(X.secSteps,stepsHtml)}
${sec(X.secContact,`<p style="margin:0">${contact}</p>`)}
<div style="margin-top:22px;border-top:1px solid ${GOLD};padding-top:8px;text-align:center;font-size:8.5pt;color:#6b7280">${esc(X.disclaimer)}${leg?'<br>'+leg:''}</div>
</div>`;
}

function dossierWa(r,o){
  const dl=DOC[o.lang]?o.lang:'fr',X=DOC[dl],U=X.unit;
  const c=D.clients.find(x=>x.id===o.client)||{},p=prixInfo(r,o.mode),isLoc=r.trans==='Location',surf=Number(r.surf)||0;
  const L=[X.hello(c.nom),'',X.summary,r.titre||X.defTitle];
  const kind=[tv(r.type,dl),tv(r.sous_type,dl)].filter(Boolean).join(' — ');
  if(kind)L.push(kind+' — '+(isLoc?X.forRent:X.forSale));
  const loc=joinPlace(r.adr,r.ville);if(loc)L.push('📍 '+loc);
  if(surf)L.push('📐 '+N(surf,dl)+' '+U.m2+(surf>=1e4?' ('+HA(surf,dl)+' '+U.ha+')':''));
  if(p.total)L.push('💰 '+money(p.total,dl)+(isLoc?U.month:'')+((p.perm2&&!isLoc)?' ('+N(p.perm2,dl)+' '+U.madm2+')':''));
  else if(p.perm2)L.push('💰 '+N(p.perm2,dl)+' '+U.madm2);
  const P=(typeof prof==='function'?prof():{})||{};
  L.push('',X.sendPdf,'',X.regards+'\n'+(P.nom?P.nom+' — ':'')+'Immo-Gest');
  return L.join('\n');
}

function openDossier(id){
  const r=D.biens.find(x=>x.id===id);if(!r)return;
  const sv=r.dossier||{},isLoc=r.trans==='Location',sp=splitDesc(r.desc),defMode=sv.mode||(r.type==='Terrain'?'m2':'total');
  let photos=[];
  let d=document.getElementById('dDoss');
  if(!d){d=document.createElement('dialog');d.id='dDoss';d.style.width='min(820px,96vw)';document.body.append(d)}
  d.setAttribute('data-no-i18n','');
  const ta=(i,l,rows,val,ph)=>`<label>${l}</label><textarea id="${i}" rows="${rows}" placeholder="${esc(ph||'')}">${esc(val??'')}</textarea>`;
  const curLang=DOC[sv.lang]?sv.lang:(DOC[lang]?lang:'fr');
  d.innerHTML=`<h2 style="margin:0">${T('Dossier de présentation','Property brochure','ملف تقديم العقار')}</h2>
  <p class="note">${esc(r.titre||'')}${r.ville?' — '+esc(r.ville):''}</p>
  <label>${T('Langue du dossier','Brochure language','لغة الملف')}</label>
  <select id="dsL"><option value="fr" ${curLang==='fr'?'selected':''}>Français</option><option value="en" ${curLang==='en'?'selected':''}>English</option><option value="ar" ${curLang==='ar'?'selected':''}>العربية</option></select>
  <p id="dsN" class="note" style="display:none">${T("Les textes ci-dessous (présentation, points forts…) restent dans la langue de l'annonce : traduisez-les ici avant d'envoyer le dossier.",'The texts below (overview, key features…) stay in the language of the listing: translate them here before sending the brochure.','تبقى النصوص أدناه (النبذة، نقاط القوة…) بلغة الإعلان الأصلية: ترجمها هنا قبل إرسال الملف.')}</p>
  <label>${T('Préparé pour (facultatif)','Prepared for (optional)','أُعدّ لفائدة (اختياري)')}</label>
  <select id="dsC"><option value="">${T('— Aucun —','— None —','— لا أحد —')}</option>${D.clients.map(c=>`<option value="${esc(c.id)}" ${sv.client===c.id?'selected':''}>${esc(c.nom||T('(sans nom)','(no name)','(بدون اسم)'))}</option>`).join('')}</select>
  ${isLoc?'':`<label>${T('Le prix saisi dans la fiche est…','The price entered in the record is…','السعر المدخل في السجل هو…')}</label><select id="dsM"><option value="m2" ${defMode==='m2'?'selected':''}>${T('un prix par m² (DH/m²)','a price per m² (MAD/m²)','سعر المتر المربع (درهم/م²)')}</option><option value="total" ${defMode==='total'?'selected':''}>${T('le prix total (DH)','the total price (MAD)','الثمن الإجمالي (درهم)')}</option></select>
  <label class="role-option" style="margin-top:10px"><input type="checkbox" id="dsK" ${sv.com?'checked':''}> ${T("Afficher les honoraires d'agence",'Show the agency fee','إظهار أتعاب الوكالة')}${r.taux?' ('+esc(r.taux)+' %)':''}</label>`}
  ${ta('dsT',T('Présentation du bien (modifiable)','Property overview (editable)','نبذة عن العقار (قابلة للتعديل)'),8,sv.txt??sp.text)}
  ${ta('dsF',T('Points forts (un par ligne)','Key features (one per line)','نقاط القوة (واحدة في كل سطر)'),4,sv.pts??sp.pts.join('\n'))}
  ${ta('dsJ',T('Documents et situation juridique','Documents and legal status','الوثائق والوضعية القانونية'),3,sv.jur??'',T('Ex. : titre foncier, plan topographique, certificat de propriété…','E.g. land title, topographic plan, ownership certificate…','مثال: الرسم العقاري، التصميم الطبوغرافي، شهادة الملكية…'))}
  ${ta('dsR',T('Conditions et remarques','Terms and remarks','الشروط والملاحظات'),3,sv.cond??'',T('Ex. : modalités de paiement, délai, visite sur rendez-vous…','E.g. payment terms, timeline, viewings by appointment…','مثال: طريقة الأداء، الأجل، المعاينة بموعد…'))}
  <p id="dsA" class="note" style="color:var(--am);display:none"></p>
  <h3>${T('Aperçu','Preview','معاينة')}</h3>
  <div id="dsP" style="background:#fff;color:#000;padding:18px;border:1px solid var(--bd);overflow-x:auto"></div>
  <div class="row"><button type="button" class="btn sec" id="dsX">${T('Fermer','Close','إغلاق')}</button><button type="button" class="btn sec" id="dsW">${T('Résumé WhatsApp','WhatsApp summary','ملخص واتساب')}</button><button type="button" class="btn" id="dsPr">${T('Imprimer / PDF','Print / PDF','طباعة / PDF')}</button></div>`;
  const q=s=>d.querySelector(s);
  const get=()=>({lang:q('#dsL').value,client:q('#dsC').value,mode:isLoc?'total':q('#dsM').value,com:isLoc?false:q('#dsK').checked,txt:q('#dsT').value,pts:q('#dsF').value,jur:q('#dsJ').value,cond:q('#dsR').value});
  const warn=()=>{
    const o=get(),p=prixInfo(r,o.mode),a=q('#dsA');let m='';
    if(!isLoc&&Number(r.prix)>0){
      if(p.total&&p.total<50000)m=T(`Le prix affiché est très bas (${N(p.total)} MAD). Vérifiez le prix saisi dans la fiche, ou changez l'option « Le prix saisi dans la fiche est… ».`,`The price shown is very low (${N(p.total)} MAD). Check the price entered in the record, or change the “The price entered in the record is…” option.`,`السعر المعروض منخفض جداً (${N(p.total)} درهم). تحقق من السعر المدخل في السجل أو غيّر الخيار «السعر المدخل في السجل هو…».`);
      else if(!p.total&&p.perm2)m=T("La surface n'est pas renseignée : le prix total ne peut pas être calculé.",'The area is missing: the total price cannot be calculated.','المساحة غير مدخلة: لا يمكن احتساب الثمن الإجمالي.');
    }
    a.textContent=m;a.style.display=m?'block':'none';
    q('#dsN').style.display=o.lang!=='fr'?'block':'none';
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
    status(T('Chargement des photos…','Loading photos…','جارٍ تحميل الصور…'));
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
          if(typeof localize==='function')localize(b);
        }
      }
    }catch(e){console.warn('partage.js : bouton Dossier',e)}
    return res;
  };
}
window.immoDossier={build:buildDossier,split:splitDesc,price:prixInfo,wa:dossierWa};
})();
