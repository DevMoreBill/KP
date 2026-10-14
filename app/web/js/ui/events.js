// Общие обработчики событий: ввод в поля, кнопки действий (data-a), перетаскивание файлов.
'use strict';

document.addEventListener('input', e=>{
  const t=e.target;
  if (t.dataset.p){
    let v=t.value; if (t.dataset.p.endsWith('.qty')) { v=v.replace(/\D/g,''); t.value=v; v = v===''?'':+v; t.classList.toggle('bad', !(v>=1)); }
    setP(t.dataset.p, v);
    if (t.dataset.p==='cover.title'||t.dataset.p.startsWith('cover.')) S.cover.touched=true;
    if (t.dataset.p.startsWith('tender.')){
      if (t.dataset.p==='tender.url' && !String(S.tender.number||'').trim()){ const n=tenderNoFromUrl(v); if (n){ S.tender.number=n; const ni=document.querySelector('[data-p="tender.number"]'); if (ni) ni.value=n; } }
      if (t.dataset.p==='tender.url') t.classList.toggle('bad', !!String(v).trim() && !tenderUrl());
      document.querySelector('[data-p="tender.number"]')?.classList.toggle('bad', !String(S.tender.number||'').trim());
      const nt=$('#kkNote'); if (nt) nt.innerHTML=kkNote(); const fn=document.querySelector('#side .fname'); if (fn && S.kpId) fn.textContent=savedFileName(); }
    updateLive();
  } else if (t.dataset.oprice!=null){
    const [i,j]=t.dataset.oprice.split('.').map(Number), o=S.items[i].options[j], k=parsePrice(t.value);
    o._priceText=t.value; o.price=Number.isNaN(k)?0:k; t.classList.toggle('bad',Number.isNaN(k)); updateLive();
  } else if (t.dataset.price!=null){
    const i=+t.dataset.price, k=parsePrice(t.value);
    S.items[i]._priceText=t.value; S.items[i].price = Number.isNaN(k)?0:k; S.items[i].priceManual=true;
    t.classList.toggle('bad', Number.isNaN(k)||!k); updateLive(); liveMargin(i);
  } else if (t.dataset.disc!=null){
    const i=+t.dataset.disc, x=S.items[i];
    x._discText=t.value; x._discBad=!setDisc(x, t.value); t.classList.toggle('bad', x._discBad); updateLive(); liveMargin(i);
  } else if (t.dataset.rate!=null){
    S.pricing.rates[t.dataset.rate]=t.value; S.pricing.rateSrc='вручную'; const sh=document.querySelector(`[data-rshow="${t.dataset.rate}"]`); if(sh) sh.textContent=t.value||'—'; updateLive();
  }
});

document.addEventListener('change', e=>{
  const t=e.target;
  if (/^items\.(\d+)\.attrs\.maker$/.test(t.dataset.p||'')){ const x=S.items[+RegExp.$1]; loadLogos().then(()=>{ if (autoLogo(x)){ renderForm(); persist(); toast('Логотип производителя подставлен из каталога'); } }); }
  if (t.dataset.gon!=null){ const g=S.items[+t.dataset.gon].gallery[+t.dataset.j]; g.on=t.checked; t.closest('.gcard')?.classList.toggle('off',!t.checked); persist(); return; }
  if (/^items\.\d+\.gallery\.\d+\.wide$/.test(t.dataset.p||'')){ renderForm(); persist(); return; }
  if (t.dataset.retype!=null){ renderForm(); persist(); return; }
  if (t.dataset.aikeep!=null){ S.items[+t.dataset.aikeep]._aiKeep=t.checked; persist(); return; }
  if (t.dataset.pr){ const k=t.dataset.pr;
    if (k==='cur'){ kpSetCur(t.value); return; }
    S.pricing[k] = t.type==='checkbox' ? t.checked : t.value;
    renderForm(); persist(); return; }
});

document.addEventListener('change', async e=>{
  const mo=/^items\.(\d+)\.options\.(\d+)\.name$/.exec(e.target.dataset.p||'');
  if (mo){ const o=S.items[+mo[1]].options[+mo[2]]; const x=CatFind.name(o.name); const pz=allPresets().find(q=>norm(q.name)===norm(o.name));
    if (pz){ o.short=pz.short; o.unit=pz.unit; } if (x && !o.price){ o.price=x.price||0; o.catId=x.id; o.short=o.short||attrsOf(x).model||''; } renderForm(); persist(); return; }
  const m=/^items\.(\d+)\.name$/.exec(e.target.dataset.p||''); if(!m || CATED) return;
  const it=S.items[+m[1]]; let x=CatFind.name(it.name);
  if (x && !it.price && !it.photo){ x=await fullDoc(x); fillFromCat(it,x); renderForm(); persist(); toast('Позиция подставлена из каталога'); }
});

document.addEventListener('focusout', e=>{
  const t=e.target;
  if (t.dataset.oprice!=null){ const [i,j]=t.dataset.oprice.split('.').map(Number), o=S.items[i].options[j], k=parsePrice(t.value); if(!Number.isNaN(k)){ delete o._priceText; t.value=k?money(k):''; } persist(); }
  if (t.dataset.price!=null){ const i=+t.dataset.price, k=parsePrice(t.value); if(!Number.isNaN(k)&&k){ delete S.items[i]._priceText; t.value=fmtPrice(k);} persist(); renderForm(); }
  // без перерисовки формы: иначе следующий щелчок (например, по «% / руб.») попадёт в уже заменённую кнопку
  if (t.dataset.disc!=null){ const x=S.items[+t.dataset.disc]; if (!x._discBad){ delete x._discText; t.value=discText(x); } persist(); }
});

document.addEventListener('click', async e=>{
  const sb=e.target.closest('[data-step]'); if(sb){ return goStep(sb.dataset.step); }
  const go=e.target.closest('[data-go]'); if(go){ const tg=go.dataset.go; const stp=stepOfTarget(tg, go.textContent||'');
    if (stp && stp!==STEP) return goStep(stp, tg);
    const el=document.getElementById(tg); el?.scrollIntoView({behavior:'smooth',block:'center'}); const inp=el?.querySelector('input.bad, input:placeholder-shown, input'); inp?.focus({preventScroll:true}); return; }
  const dz=e.target.closest('[data-drop]'); if (dz && !e.target.closest('[data-a]')) return pickImage(dz.dataset.drop, +dz.dataset.i);
  const b=e.target.closest('[data-a]'); if(!b) return;
  const a=b.dataset.a, i=+b.dataset.i, j=+b.dataset.j, k=+b.dataset.k, it=S.items[i];
  switch(a){
    case 'addItem': return newEquip('kp', b.dataset.cat||'');
    case 'addStation': return newEquip('kp', b.dataset.cat||'station');
    case 'delItem': S.items.splice(i,1); break;
    case 'up': [S.items[i-1],S.items[i]]=[S.items[i],S.items[i-1]]; break;
    case 'down': [S.items[i+1],S.items[i]]=[S.items[i],S.items[i+1]]; break;
    case 'qty': { const old=+it.qty||0; it.qty=Math.max(1,old+(+b.dataset.d)); (it.options||[]).forEach(o=>{ if(o.unit!=='усл.' && +o.qty===old) o.qty=it.qty; }); break; }
    case 'addOpt': (it.options=it.options||[]).push(newOpt(it)); break;
    case 'delOpt': it.options.splice(j,1); break;
    case 'optPreset': { it.options=it.options||[]; const pz=presetsFor(it)[k]; const ix=it.options.findIndex(o=>norm(o.name)===norm(pz.name)); if(ix>=0) it.options.splice(ix,1); else { const c=CatFind.name(pz.name); it.options.push(newOpt(it,{...pz, price:c?.price||0, catId:c?.id})); } break; }
    case 'attrsToGroups': { const g=groupsFromAttrs(it); const keep=(it.groups||[]).filter(x=>!g.some(y=>y.name===x.name)); it.groups=[...g,...keep]; if(!it.hint) it.hint=CoverHint.of(it); it.page=true; toast('Таблица характеристик сформирована'); break; }
    case 'galAdd': return pickGallery(i, b.dataset.slot||'');
    case 'galPage': return galFromPage(i, e.shiftKey);
    case 'kitAdd': case 'kitCat': case 'kitMain': case 'kitCont': case 'kitSys': case 'kitPreset': case 'kitDel': case 'kitMv': case 'kitRowAdd': case 'kitRowDel': case 'kitPhoto': case 'kitPhotoDel': { if (kitAction(a, i, b)==='async') return; break; }
    case 'kitOpen': case 'kitBy': case 'reqPickX': case 'reqReset': case 'kitNeed': case 'kitNeedAll': case 'kitSwap': { const r=KitView.act(a, i, b); if (r==='async' || !r) return; break; }
    case 'drawPick': return DrawPic.pick(i, j, b.dataset.v);
    case 'tzOut': return TzOut.download(i);
    case 'stSpot': return IssueSpot.open(i, j);
    case 'xFix': case 'xFixAll': return ExpertFix.act(a, i, b);
    case 'tzLoad': return TzImport.pick(i);
    case 'stParAdd': case 'stParDel': if (!StationParams.act(a, i, b)) return; break;
    case 'drawDel': DrawPic.del(i, j, b.dataset.v); break;
    case 'galDel': StationImages.drop(it, j); break;
    case 'stPhoto': { const p=kitParts(it)[j]; if (!p || !p.photo || !p.photo.src) return; StationImages.chosen(it); it.photo={...p.photo}; delete it.photoFrom; toast('Главное фото станции — фото «'+(p.name||'элемента')+'»'); break; }
    case 'galMain': { if (!(it.gallery||[])[j]) return; const was3d=StationImages.chosen(it); if (!edSetMain(it, j)) return;
      toast(was3d ? 'Главное фото заменено — 3D-вид вернуть можно на вкладке «Компоновка»' : 'Главное фото заменено — прежнее перенесено в изображения'); break; }
    case 'edit': return openEditor(i, b.dataset.tab);
    case 'catOf': { const c=b.dataset.cat; if (typeById(c).station || !catCache.some(x=>attrsOf(x).cat===c)) return newEquip('kp', c); return openCatalog({cat:c}); }
    case 'dupItem': { const cp=JSON.parse(JSON.stringify(it)); cp.id=uid(); (cp.features||[]).forEach(f=>{ const old=f.id; f.id=uid(); (cp.gallery||[]).forEach(g=>{ if(g.at==='feat:'+old) g.at='feat:'+f.id; }); });
      (cp.options||[]).forEach(o=>o.id=uid()); S.items.splice(i+1,0,cp); toast('Позиция скопирована'); break; }
    case 'addFeatL': { it.features=it.features||[]; const f={id:uid(),label:b.dataset.l||'',text:''}; it.features.push(f); it.page=true; break; }
    case 'featMv': if (!edMoveFeat(it, j, j+(+b.dataset.d))) return; break;
    case 'galMv': { const free=edFreeGal(it), n=free.indexOf(j)+(+b.dataset.d); if (n<0 || n>=free.length || !edMoveGal(it, j, free[n])) return; break; }
    case 'autoAttrs': { const cat=attrsOf(it).cat, t=typeById(cat), keep=new Set(['maker','series','model',...t.fields.map(f=>f.key)]);
      it.attrs=Object.fromEntries(Object.entries({...extractAttrs(it), ...attrsFromSpec(it,t), ...Object.fromEntries(Object.entries(it.attrs||{}).filter(([,v])=>v!==''&&v!=null)), cat})
        .filter(([k,v])=>v!==''&&v!=null&&(k==='cat'||keep.has(k)))); toast('Параметры определены по характеристикам — проверьте'); break; }
    case 'specTpl': { const n=applySpecTemplate(it); it.page=true; toast(n?`Добавлено строк по шаблону категории: ${n} — заполните значения`:'Все строки шаблона категории уже есть'); break; }
    case 'togglePage': it.page=!it.page; if(it.page && !it.features.length && !it.groups.length){ it.features=[{label:'',text:''}]; } break;
    case 'delFeat': { const f=it.features[j]; if (f&&f.id) it.gallery=(it.gallery||[]).filter(g=>g.at!=='feat:'+f.id); it.features.splice(j,1); break; }
    case 'addGrp': it.groups.push({name:'',rows:[{k:'',v:''}]}); break;
    case 'delGrp': it.groups.splice(j,1); break;
    case 'addRow': it.groups[j].rows.push({k:'',v:''}); break;
    case 'delRow': it.groups[j].rows.splice(k,1); break;
    case 'star': it.groups[j].rows[k].hl=!it.groups[j].rows[k].hl; break;
    case 'rmImg': if (b.dataset.k==='photo' && it.photo && it.photo.gen==='st3d') StationImages.forget(it, 'photo'); it[b.dataset.k]=null; break;
    case 'stlFix': case 'stlAuto': case 'stlRec': if (!StationUi.act(a, i, b)) return; break;
    case 'pickImg': return pickImage(b.dataset.k, i);
    case 'clients': S.showClients=!S.showClients; break;
    case 'coverFrom': S.cover.touched=false; S.cover._src=''; coverSync(); toast('Заголовок и параметры — по оборудованию КП'); break;
    case 'paste': return openPaste(i);
    case 'aiCopy': return AiFill.copy(i, b.dataset.url||'');
    case 'aiMore': return AiFill.more(i);
    case 'aiFetch': return aiFetch(i);
    case 'aiAuto': return AiFill.auto(i);
    case 'aiProps': return aiProps(i);
    case 'aiPart': return aiPartDialog(i, j);
    case 'aiPartCopy': return aiPartCopy(i, j, b.dataset.url||'');
    case 'aiApply': return AiFill.apply(i);
    case 'openCatalog': return openCatalog({});
    case 'toPrice': return goStep('price');
    case 'priceHist': return PriceHist.open(i);
    case 'saveCat': return saveCatalog(i);
    case 'download': { const r=await download(); if (isMob()) $('#dlmsg')?.scrollIntoView({block:'center'}); return r; }
    case 'partyFind': return partyFind();
    case 'clientEdit': S._clEdit=!S._clEdit; break;
    case 'clientManual': S._clManual=true; break;
    case 'clientChange': Object.assign(S,{client:'',clientId:'',clientInn:'',clientKpp:'',clientOgrn:'',clientFull:'',clientAddr:'',clientDir:'',clientDirPost:'',clientStatus:'',clientSrc:'',check:null,_clEdit:false,_clManual:false,_lastInn:''});
      S.contact={name:'',post:'',phone:'',email:''}; S.object={purpose:'',address:''}; renderForm(); persist(); setTimeout(()=>$('#clFind')?.focus(),30); return;
    case 'checkRun': return PartyCheck.run(b.dataset.force==='1');
    case 'integrations': return openSettings('keys');
    case 'settings': return openSettings();
    case 'uitexts': document.querySelector('details.topmenu')?.removeAttribute('open'); return uitToggle();
    case 'help': return openHelp();
    case 'versions': return openHelp('versions');
    case 'kpKind': { const on=b.dataset.v==='tender', was=tenderOn(); S.tender=Object.assign({on:false,number:'',url:''}, S.tender||{}, {on});
      // тендерное КП — в шаблоне «Тендерный»; обратно — прежний шаблон
      const tt=TEMPLATES.find(t=>t.id==='tender' && !t.error);
      if (on && !was && tt && S.template!=='tender'){ S._tplPrev=S.template; S.template='tender'; toast('Шаблон КП: '+tt.name); }
      else if (!on && was && S.template==='tender'){ const pv=TEMPLATES.find(t=>t.id===(S._tplPrev||'pnevmotekh') && !t.error); if (pv){ S.template=pv.id; toast('Шаблон КП: '+pv.name); } delete S._tplPrev; }
      break; }
    case 'pickObject': { const o=(curClient()?.objects||[])[k]; if(o) S.object={...S.object,...o}; break; }
    case 'pickContact': { const o=(curClient()?.contacts||[])[k]; if(o) S.contact={...S.contact,...o}; break; }
    case 'dmode': { const inp=document.querySelector(`[data-disc="${i}"]`); it.discType=b.dataset.v; if (it.disc) it.disc.type=b.dataset.v;
      const txt=inp?inp.value:''; it._discText=txt; it._discBad=!setDisc(it, txt); if (!it._discBad) delete it._discText; renderForm(); persist(); return; }
    case 'toSave': { const L=StepList.visible(); if (isMob() && STEP!==L[L.length-1].id){ goStep(L[L.length-1].id); }
      const sd=$('#side'); sd.scrollIntoView({behavior:isMob()?'auto':'smooth'}); sd.classList.add('pulse'); setTimeout(()=>sd.classList.remove('pulse'),1600); return; }
    case 'cbr': return loadCBR();
    case 'journal': return openJournal();
    case 'myDay': return MyDay.open();
    case 'myPrefs': return MyPrefs.open();
    case 'deal': return openDeal();
    case 'docsFolder': return api('/api/folder?dir='+encodeURIComponent(managerFolder()),{method:'POST'}).then(remoteResult).catch(()=>{}); 
    case 'mailKp': return MailDlg.open(b.dataset.id, S.number);
    case 'clPrev': return openJournal().then(()=>{ const q=$('#jQ'); if (q){ q.value=S.clientInn||S.client; q.dispatchEvent(new Event('input')); } });
    case 'openDoc': return api(`/api/kp/${b.dataset.id}/open`,{method:'POST'}).then(remoteResult).catch(()=>toast('Файл не найден'));
    case 'showDoc': return api(`/api/kp/${b.dataset.id}/folder`,{method:'POST'}).then(remoteResult).catch(()=>toast('Файл не найден'));
    default: return;
  }
  renderForm(); persist();
});

$('#btnExit').addEventListener('click', async ()=>{ if(!confirm('Закрыть программу? Несохранённый черновик останется в браузере.')) return; try{ await api('/api/shutdown',{method:'POST'}); }catch(e){} document.body.innerHTML='<p style="padding:40px;font:18px Onest,Arial">Программа закрыта. Эту вкладку можно закрыть.</p>'; });

$('#btnNew').addEventListener('click', ()=>NewKp.open());     // пустое КП, по заготовке или продолжить черновик (features/kp-drafts.js)

document.addEventListener('toggle', e=>{ const d=e.target; if (d.dataset && d.dataset.more!=null && S.items[+d.dataset.more]) S.items[+d.dataset.more]._open=d.open; }, true);

document.addEventListener('keydown', e=>{ const dz=e.target.closest?.('[data-drop]'); if(dz && (e.key==='Enter'||e.key===' ')){ e.preventDefault(); pickImage(dz.dataset.drop,+dz.dataset.i);} });

// перетаскивание и вставка картинок — js/features/images.js (общие для всех мест с картинками)

// горячие клавиши (когда не открыто окно): Ctrl+S — сохранить КП, Ctrl+K — каталог
document.addEventListener('keydown', e=>{
  if (!(e.ctrlKey || e.metaKey) || e.altKey || !FEAT.on('hotkeys') || document.querySelector('dialog[open]')) return;
  const k=e.key.toLowerCase();
  if (k==='s' || k==='ы'){ e.preventDefault(); const pr=problems();
    if (pr.length){ toast('Сначала заполните: '+pr[0][0]+(pr.length>1?` (и ещё ${pr.length-1})`:'')); return; }
    document.querySelector('#side [data-a="download"]')?.click(); return; }
  if (k==='k' || k==='л'){ e.preventDefault(); openCatalog({}); }
});
