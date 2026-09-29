// Типы оборудования: справочник, определение типа позиции, параметры для фильтров и титула.
'use strict';

let TYPES_BUILTIN = null;   // встроенный справочник (app/equipment_types.json) — загружается с сервера

let TYPES = (TYPES_BUILTIN && TYPES_BUILTIN.types) ? TYPES_BUILTIN.types.slice() : [];

const LEGACY_TYPE = {'ДГУ':'dgu','Осветительная мачта':'light','Шкаф АВР':'ats','Прочее':'other','Опция':'ats'};

function mergeTypes(base, user){
  const out=(base||[]).map(t=>({...t})); const ix=new Map(out.map((t,i)=>[t.id,i]));
  for (const t of (user||[])){ if(!t||!t.id) continue; if (ix.has(t.id)) out[ix.get(t.id)]={...out[ix.get(t.id)],...t}; else { ix.set(t.id,out.length); out.push(t); } }
  return out.filter(t=>!t.hidden);
}

function typeById(id){ return TYPES.find(t=>t.id===id) || TYPES.find(t=>t.id==='other') || {id:'other',group:'Прочее',name:'Прочее оборудование',item:'Оборудование',coverTitle:'Оборудование',role:'equipment',main:'kw',fields:[],options:[]}; }

function detectCat(d, a){
  if (d && d.attrs && d.attrs.cat && TYPES.some(t=>t.id===d.attrs.cat)) return d.attrs.cat;
  if (d && d.kind==='option') return 'ats';
  if (d && d.attrs && LEGACY_TYPE[d.attrs.type]) return LEGACY_TYPE[d.attrs.type];
  const text=[d&&d.name,d&&d.pageTitle,d&&d.hint&&d.hint.title].join(' ');
  for (const t of TYPES){ if (t.id==='dgu'||!t.match) continue; try{ if (new RegExp(t.match,'i').test(text)) return t.id; }catch(e){} }
  const dg=TYPES.find(t=>t.id==='dgu'); try{ if (dg && new RegExp(dg.match,'i').test(text)) return 'dgu'; }catch(e){}
  return 'other';
}

function fmtField(f, v){ if (v==null || v==='') return ''; const s=(f.num&&typeof v==='number')?fnum(v):String(v); return f.unit && !s.includes(f.unit) ? s+' '+f.unit : s; }

async function loadTypes(){
  try{ const r=await api('/api/types'); if (r && Array.isArray(r.types)) TYPES=r.types; }catch(e){}
  try{ if (!TYPES_BUILTIN) TYPES_BUILTIN=await api('/api/types?builtin=1'); }catch(e){}
}

function typeOptionsHtml(sel){
  const groups=[...new Set(TYPES.map(t=>t.group||'Прочее'))];
  return groups.map(g=>`<optgroup label="${esc(g)}">${TYPES.filter(t=>(t.group||'Прочее')===g).map(t=>`<option value="${esc(t.id)}"${t.id===sel?' selected':''}>${esc(t.name)}</option>`).join('')}</optgroup>`).join('');
}

function mainLine(x, max=3){
  const a=attrsOf(x), t=typeById(a.cat);
  const parts=t.fields.filter(f=>f.kpi && a[f.key]!=null && a[f.key]!=='').slice(0,max).map(f=>fmtField(f,a[f.key]));
  return parts.join(' · ');
}

function autoHint(x){
  const a=attrsOf(x), t=typeById(a.cat);
  const kp=t.fields.filter(f=>f.kpi && a[f.key]!=null && a[f.key]!=='').slice(0,4).map(f=>({num:fnum(a[f.key]).replace(/\s*[^\d,.\/-].*$/,''),unit:f.unit||'',cap:f.label.toLowerCase()}));
  return { title:t.coverTitle||t.name, model:[a.maker,a.model].filter(Boolean).join(' ')||x.name, desc:'', kpis:kp };
}

function groupsFromAttrs(x){
  const a=attrsOf(x), t=typeById(a.cat), G=new Map();
  const add=(g,k,v,hl)=>{ if(!v) return; if(!G.has(g)) G.set(g,[]); G.get(g).push({k,v,hl:!!hl}); };
  add('Основные','Производитель',a.maker); add('Основные','Модель',a.model);
  for (const f of t.fields){ const v=fmtField(f,a[f.key]); add(f.group||'Основные', f.label, v, f.kpi); }
  return [...G.entries()].map(([name,rows])=>({name,rows}));
}

function allPresets(){ return TYPES.flatMap(t=>(t.options||[]).map(o=>Array.isArray(o)?{name:o[0],short:o[1]||o[0],unit:o[2]||'шт.'}:o)); }

function presetsFor(x){ const t=typeById(attrsOf(x).cat); const L=(t.options&&t.options.length)?t.options:[['Доставка до объекта','доставка','усл.'],['Пусконаладочные работы','ПНР','усл.']]; return L.map(o=>Array.isArray(o)?{name:o[0],short:o[1]||o[0],unit:o[2]||'шт.'}:o); }

function newOpt(it, p){ return { id:uid(), name:p?.name||'', short:p?.short||'', unit:p?.unit||'шт.', qty: (p?.unit==='усл.') ? 1 : (+it.qty||1), price:p?.price||0, catId:p?.catId }; }

const EXEC = ['Открытое','В кожухе','Блок-контейнер','На шасси','Кожух на шасси','Контейнер на шасси'];

function kwIn(s){ const m=String(s||'').replace(/\u00A0/g,' ').match(/(\d+(?:[.,]\d+)?)\s*кВт/i); return m?+m[1].replace(',','.'):null; }

function kvaIn(s){ const m=String(s||'').replace(/\u00A0/g,' ').match(/(\d+(?:[.,]\d+)?)\s*кВА/i); return m?+m[1].replace(',','.'):null; }

const brand = s => String(s||'').split(/[\/,;(]| - | — /)[0].trim().split(/\s+/)[0] || '';

function extractAttrs(d){
  const rows=(d.groups||[]).flatMap(g=>(g.rows||[]).map(r=>({g:norm(g.name),k:norm(r.k),v:String(r.v||'').trim()})));
  const find=(re,gre)=>rows.find(r=>re.test(r.k)&&(!gre||gre.test(r.g)));
  const feat=re=>(d.features||[]).find(f=>re.test(norm(f.label)));
  const text=[d.name,d.spec,d.pageTitle,d.photoCaption,...(d.features||[]).map(f=>f.label+' '+f.text)].join(' ');
  const a={};
  a.type = d.kind==='option' ? 'Опция' : /(^|\s)авр|автоматическ\S* ввод/i.test(d.name||'') ? 'Шкаф АВР' : /генератор|дгу|электростанц|дэс/i.test(text) ? 'ДГУ' : 'Прочее';
  const mk=((d.hint&&d.hint.model)||d.name||'').match(/\b([A-Z]{3,})\b/); a.maker = mk?mk[1]:'';
  const md=(d.name||'').match(/\b(HG\s*\d+\s*[A-ZА-Яа-я_]{0,4})/i); a.model = md?md[1].replace(/\s+/g,' ').trim():'';
  const sr=a.model.match(/\d+\s*([A-ZА-Я_]+)/i); a.series = sr?sr[1].toUpperCase().replace(/В/g,'B').replace(/С/g,'C').replace(/А/g,'A').replace(/_A$/,''):'';
  let e = find(/марка|модель|производител/, /двигател/) || find(/двигател/); let ev = e?e.v:(feat(/двигател/)?.text||'');
  a.engine = brand(ev); a.engineModel = e&&/\//.test(e.v) ? e.v.split('/')[1].trim() : '';
  let al = find(/марка|модель|производител/, /альтернатор|генератор перем/) || find(/альтернатор/); let av = al?al.v:(feat(/альтернатор/)?.text||'');
  a.alternator = brand(av);
  const c = find(/панель|контроллер/) ; a.controller = c ? c.v.split(/[,;(]/)[0].trim() : (feat(/панель|контроллер/)?.text||'').split(/[—,.]/)[0].trim();
  const pr = find(/номинальн|основн|prime|длительн/); const sb = find(/максимальн|резервн|standby|аварийн/);
  a.kw = kwIn(pr&&pr.v) ?? kwIn(d.spec) ?? kwIn(d.name) ?? null;
  a.kwMax = kwIn(sb&&sb.v) ?? null;
  a.kva = kvaIn(pr&&pr.v) ?? kvaIn(d.spec) ?? null;
  const t=norm(text);
  a.execution = /контейнер/.test(t)&&/шасси|прицеп/.test(t) ? 'Контейнер на шасси' : /кожух/.test(t)&&/шасси|прицеп/.test(t) ? 'Кожух на шасси' : /контейнер/.test(t) ? 'Блок-контейнер' : /шасси|прицеп/.test(t) ? 'На шасси' : /кожух/.test(t) ? 'В кожухе' : /открыт|на раме/.test(t) ? 'Открытое' : '';
  const v=find(/напряжен/); a.voltage = v?v.v:'';
  if (a.type!=='ДГУ'){ const amp=(d.name||'').match(/(\d+)\s*А\b/); if(amp) a.amps=+amp[1]; }
  return a;
}

function attrsOf(d){ const a=extractAttrs(d); const o=d.attrs||{}; for(const k in o){ if(o[k]!==''&&o[k]!=null) a[k]=o[k]; } a.cat=detectCat(d,a); a.type=typeById(a.cat).name; return a; }
