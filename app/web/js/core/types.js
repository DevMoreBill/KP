// Типы оборудования: справочник, определение типа позиции, параметры для фильтров и титула.
'use strict';

let TYPES_BUILTIN = null;   // встроенный справочник (app/equipment_types.json) — загружается с сервера

let TYPES = [];   // встроенные + свои типы — загружаются с сервера (loadTypes)

const LEGACY_TYPE = {'ДГУ':'dgu','Осветительная мачта':'light','Шкаф АВР':'ats','Прочее':'other','Опция':'ats'};

// свои типы отдела: новые и изменённые относительно встроенного справочника (сохраняются в базе)
function userTypesList(){ const base=new Map(((TYPES_BUILTIN&&TYPES_BUILTIN.types)||[]).map(t=>[t.id,JSON.stringify(t)])); return TYPES.filter(t=>base.get(t.id)!==JSON.stringify(t)); }

function typeById(id){ return TYPES.find(t=>t.id===id) || TYPES.find(t=>t.id==='other') || {id:'other',group:'Прочее',name:'Прочее оборудование',item:'Оборудование',coverTitle:'Оборудование',role:'equipment',main:'kw',fields:[],options:[]}; }

// категория по названию: сначала наименование и заголовок страницы, затем заголовок титула; ДГУ — последней
// (так же определяет app/catalog_migrate.py при обновлении каталога)
function detectCat(d, a){
  if (d && d.attrs && d.attrs.cat && TYPES.some(t=>t.id===d.attrs.cat)) return d.attrs.cat;
  if (d && d.kind==='option') return 'ats';
  if (d && d.attrs && LEGACY_TYPE[d.attrs.type]) return LEGACY_TYPE[d.attrs.type];
  const dg=TYPES.find(t=>t.id==='dgu');
  for (const text of [[d&&d.name,d&&d.pageTitle].join(' '), String(d&&d.hint&&d.hint.title||'')]){
    for (const t of TYPES){ if (t.id==='dgu'||!t.match) continue; try{ if (new RegExp(t.match,'i').test(text)) return t.id; }catch(e){} }
    try{ if (dg && new RegExp(dg.match,'i').test(text)) return 'dgu'; }catch(e){}
  }
  return 'other';
}

// значение параметра из таблицы характеристик по полю find типа (единицы как в app/catalog_migrate.py)
const UNIT_RX={'м³/мин':'м[³3]\\s*/\\s*мин','л/мин':'л\\s*/\\s*мин','кВт':'квт','бар':'(бар|атм|кгс)','л':'л(?![а-я])','кг':'кг','дБ(А)':'дб','мм':'мм','%':'%','л/ч':'л\\s*/\\s*ч','моточасов':'(моточас|ч(?![а-я]))','м³/ч':'м[³3]\\s*/\\s*ч(?:ас)?(?![а-я])'};
const CONVERT={'м³/мин':[['л/мин',0.001],['м³/ч',1/60]],'л/мин':[['м³/мин',1000],['м³/ч',1000/60]],'м³/ч':[['м³/мин',60],['л/мин',0.06]]};
const NUM_RX='(\\d+(?:[ \\u00a0]\\d{3})*(?:[.,]\\d+)?)';
const num_=s=>+String(s).replace(/[ \u00a0]/g,'').replace(',','.');
const round_=v=>Math.round(v*1000)/1000;
function parseNumUnit(text, unit){
  const t=String(text||'').toLowerCase(); let m;
  if (unit && UNIT_RX[unit] && (m=t.match(new RegExp(NUM_RX+'\\s*'+UNIT_RX[unit])))) return round_(num_(m[1]));
  for (const [src,k] of (CONVERT[unit]||[])) if ((m=t.match(new RegExp(NUM_RX+'\\s*'+UNIT_RX[src])))) return round_(num_(m[1])*k);
  m=t.match(new RegExp(NUM_RX)); return m?round_(num_(m[1])):null;
}
function parseTextVal(text, f){
  let v=String(text||'').replace(/\s+/g,' ').trim();
  if (f.key==='voltage'){ const m=v.toLowerCase().match(/(\d{3})\s*в(?![а-я])/); return m?m[1]:''; }
  if (f.key==='oilFree' && String(f.values)==='Да,Нет') return /безмасл|oil[- ]?free|класс 0/i.test(v)?'Да':/масл/i.test(v)?'Нет':'';
  const canon=x=>String(x).toLowerCase().replace(/[−–]/g,'-').replace(/[\s°c]/g,'');
  const hit=(f.values||[]).find(x=>typeof x==='string' && canon(x) && canon(x)===canon(v)); if (hit) return hit;
  if (f.key==='refrigerant'){ const m=v.match(/\bR-?\d{2,4}[A-Za-z]?\b/); return m?m[0].replace('-',''):v; }
  if (f.unit && v.toLowerCase().endsWith(f.unit.toLowerCase())) v=v.slice(0,-f.unit.length).trim();
  return v.slice(0,120);
}
function attrsFromSpec(d, t){
  const out={}, rows=(d.groups||[]).flatMap(g=>(g.rows||[]).filter(r=>r.k&&r.v));
  for (const f of (t.fields||[])){ if (!f.find) continue; let rx; try{ rx=new RegExp(f.find,'i'); }catch(e){ continue; }
    // сначала строки в единицах поля, затем остальные — с пересчётом; «снижение шума на 8 дБ» — не значение
    const ur=f.num&&UNIT_RX[f.unit]?new RegExp('\\d\\s*'+UNIT_RX[f.unit]):null;
    const cand=rows.filter(r=>rx.test(String(r.k).trim()) && !(f.num && /снижени|уменьшени/i.test(r.v)));
    cand.sort((a,b)=>(ur&&ur.test(String(b.v).toLowerCase())?1:0)-(ur&&ur.test(String(a.v).toLowerCase())?1:0));
    for (const r of cand){ const v=f.num?parseNumUnit(r.v,f.unit):parseTextVal(r.v,f); if (v!==null&&v!==''){ out[f.key]=v; break; } } }
  return out;
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

// шаблон таблицы характеристик категории: группы и строки по параметрам типа (значения — из параметров позиции);
// добавляются только недостающие строки, заполненное не меняется
function applySpecTemplate(x){
  const a=attrsOf(x), t=typeById(a.cat); x.groups=x.groups||[]; let n=0;
  const key=s=>norm(String(s).replace(/,\s*[^,]*$/,''));
  const rowsOf=[['Основные',{key:'maker',label:'Производитель'}],['Основные',{key:'model',label:'Модель'}],...t.fields.map(f=>[f.group||'Основные',f])];
  for (const [gname,f] of rowsOf){
    let g=x.groups.find(g=>norm(g.name)===norm(gname)); if (!g){ g={name:gname,rows:[]}; x.groups.push(g); }
    if (x.groups.some(gg=>(gg.rows||[]).some(r=>key(r.k)===norm(f.label)||norm(r.k)===norm(f.label)))) continue;
    g.rows.push({k:f.label+(f.unit?', '+f.unit:''), v:a[f.key]!=null&&a[f.key]!==''?String(f.num&&typeof a[f.key]==='number'?fnum(a[f.key]):a[f.key]):'', hl:!!f.kpi}); n++;
  }
  x.groups=x.groups.filter(g=>g.rows.length);
  return n;
}

// что за изображение: по этим данным сервер выбирает папку data/img/<раздел>/<категория>/<производитель> (app/images.py)
function imgPlace(x, kind, g){
  const a=attrsOf(x);
  return { cat:a.cat, maker:a.maker||'', model:a.model||'', name:x.name||'', kind, caption:(g&&(g.caption||g.slot))||'' };
}

function allPresets(){ return TYPES.flatMap(t=>(t.options||[]).map(o=>Array.isArray(o)?{name:o[0],short:o[1]||o[0],unit:o[2]||'шт.'}:o)); }

function presetsFor(x){ const t=typeById(attrsOf(x).cat); const L=(t.options&&t.options.length)?t.options:[['Доставка до объекта','доставка','усл.'],['Пусконаладочные работы','ПНР','усл.']]; return L.map(o=>Array.isArray(o)?{name:o[0],short:o[1]||o[0],unit:o[2]||'шт.'}:o); }

function newOpt(it, p){ return { id:uid(), name:p?.name||'', short:p?.short||'', unit:p?.unit||'шт.', qty: (p?.unit==='усл.') ? 1 : (+it.qty||1), price:p?.price||0, catId:p?.catId }; }


function kwIn(s){ const m=String(s||'').replace(/\u00A0/g,' ').match(/(\d+(?:[.,]\d+)?)\s*кВт/i); return m?+m[1].replace(',','.'):null; }

function kvaIn(s){ const m=String(s||'').replace(/\u00A0/g,' ').match(/(\d+(?:[.,]\d+)?)\s*кВА/i); return m?+m[1].replace(',','.'):null; }

const brand = s => String(s||'').split(/[\/,;(]| - | — /)[0].trim().split(/\s+/)[0] || '';

function extractAttrs(d){
  const rows=(d.groups||[]).flatMap(g=>(g.rows||[]).map(r=>({g:norm(g.name),k:norm(r.k),v:String(r.v||'').trim()})));
  const find=(re,gre)=>rows.find(r=>re.test(r.k)&&(!gre||gre.test(r.g)));
  const feat=re=>(d.features||[]).find(f=>re.test(norm(f.label)));
  const text=[d.name,d.spec,d.pageTitle,d.photoCaption,...(d.features||[]).map(f=>f.label+' '+f.text)].join(' ');
  const a={};
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

function attrsOf(d){ const a=extractAttrs(d); const o=d.attrs||{}; for(const k in o){ if(o[k]!==''&&o[k]!=null) a[k]=o[k]; } a.cat=detectCat(d,a);
  const t=typeById(a.cat); if ((d.groups||[]).length){ const s=attrsFromSpec(d,t); for (const k in s) if (o[k]===''||o[k]==null) a[k]=s[k]; }
  a.type=t.name; return a; }
