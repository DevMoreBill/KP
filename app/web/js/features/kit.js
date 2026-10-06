// Сборка: одно изделие КП из нескольких элементов (например, ДГУ + насос + контейнер + шасси + глушитель).
// Позиция КП хранит состав в x.kit.parts: [{id, name, qty, cost (коп., за ед.), costCur, sup (поставщик), desc, rows:[{k,v}],
//   photo, catId, attrs:{cat, maker, model}}]. Элемент — из каталога (копия описания, характеристик, фото, закупки) или свой
//   (контейнер под требования заказчика и т. п.).
// • Закупка изделия (x.cost, ₽) — сумма закупок элементов по курсам КП; цена для заказчика — одна, как у обычной позиции.
// • Документ КП: шаблон, умеющий сборки (features 'kit'), получает состав как есть (kitDocData) и выводит таблицу состава
//   и карточки элементов; любой другой — элементы блоками описания с фото и своими таблицами характеристик (kitDocItem).
// • Экономика сделки: каждый элемент — отдельная строка закупки со своим поставщиком (kitLines): разные сроки и условия оплаты.
'use strict';

const KIT_PRESETS = ['Шасси (прицеп)', 'Глушитель', 'Шкаф АВР', 'Топливный бак', 'Система подогрева', 'Монтажный комплект'];

// Комплектуем только станции в контейнере: насосные, компрессорные, дизель-генераторные (категории с полем station
// в equipment_types.json: main — категории основного оборудования, parts — типовые элементы). Контейнер — особый элемент
// (role 'container'): тип, утепление, климатическое исполнение; основное оборудование — role 'main'.
const CONTAINER_TYPES = [
  { id:'block', name:'Блок-контейнер утеплённый', short:'блок-контейнере', size:'по проекту (длина 3–12 м, ширина 2,4–3 м)',
    desc:'Каркас из гнутого стального профиля, стены и кровля — сэндвич-панели с минераловатным утеплителем, пол — рифлёный стальной лист по утеплённому основанию. Размеры подбираются под оборудование; двери и проёмы — по проекту.' },
  { id:'welded', name:'Блок-контейнер цельносварной', short:'цельносварном блок-контейнере', size:'по проекту, например 5000 × 2400 × 2500 мм',
    desc:'Цельносварной стальной каркас и корпус: наружная обшивка — стальной лист от 1,5 мм с антикоррозионной обработкой, утепление стен, крыши и пола минеральной ватой, пол — рифлёный стальной лист, крыша — профилированный лист. Закладные под оборудование, проушины для погрузки, дверь и утеплённые ворота — по проекту.' },
  { id:'sea20', name:'Морской контейнер 20 футов', short:'контейнере 20 футов', size:'6058 × 2438 × 2591 мм',
    desc:'Стандартный морской контейнер ISO 20 футов, переоборудованный под оборудование: утепление и внутренняя обшивка, дверь обслуживания, вентиляционные проёмы, кабельные и трубные вводы.' },
  { id:'sea40', name:'Морской контейнер 40 футов', short:'контейнере 40 футов', size:'12192 × 2438 × 2591 мм',
    desc:'Стандартный морской контейнер ISO 40 футов, переоборудованный под оборудование: утепление и внутренняя обшивка, дверь обслуживания, вентиляционные проёмы, кабельные и трубные вводы.' },
  { id:'sea20hc', name:'Морской контейнер 20 футов HC', short:'контейнере 20 футов HC', size:'6058 × 2438 × 2896 мм',
    desc:'Морской контейнер ISO 20 футов увеличенной высоты (High Cube), переоборудованный под оборудование: утепление, внутренняя обшивка, дверь обслуживания, вентиляционные проёмы.' },
  { id:'sea40hc', name:'Морской контейнер 40 футов HC', short:'контейнере 40 футов HC', size:'12192 × 2438 × 2896 мм',
    desc:'Морской контейнер ISO 40 футов увеличенной высоты (High Cube), переоборудованный под оборудование: утепление, внутренняя обшивка, дверь обслуживания, вентиляционные проёмы.' },
  { id:'north', name:'Блок-контейнер «Север»', short:'блок-контейнере «Север»', size:'по проекту', ins:'150 мм', climate:'ХЛ1',
    desc:'Арктическое исполнение для работы при температуре до −60 °C: усиленное утепление, тамбур, автоматический электрообогрев, утеплённые жалюзи вентиляции, подогрев оборудования.' },
];
const CONTAINER_INS = ['50 мм', '100 мм', '150 мм', '200 мм'];
// системы контейнера (как в спецификациях производителей контейнеров и в ТЗ заказчиков): включённая — строка в характеристиках
const CONT_SYSTEMS = [
  ['power', 'Электрооборудование', 'Щит собственных нужд, сальниковые кабельные вводы, проводка в кабель-каналах, розетки, заземление'],
  ['light', 'Освещение', 'Основное — светодиодные светильники; аварийное — светильник с аккумулятором'],
  ['heat', 'Отопление', 'Электрические конвекторы с терморегулятором'],
  ['vent', 'Вентиляция', 'Приточно-вытяжная: воздушные клапаны с электроприводом, управление по термодатчику, антивандальные решётки'],
  ['ops', 'Охранно-пожарная сигнализация', 'Прибор приёмно-контрольный, дымовые датчики, датчик открытия двери, сирена, вывод сигналов «сухими контактами»'],
  ['fire', 'Автоматическое пожаротушение', 'Аэрозольное: модули пожаротушения, табло «Аэрозоль уходи» / «Аэрозоль не входи»'],
  ['noise', 'Шумоизоляция', 'Внутренняя обшивка шумопоглощающим материалом, камеры шумоглушения на приточных и вытяжных жалюзи'],
  ['gate', 'Ворота', 'Утеплённые распашные ворота для монтажа и обслуживания оборудования'],
];
const CONT_SYS_DEF = { power:true, light:true, heat:true, vent:true };
const CLIMATES = [['У1','умеренный климат, до −45 °C', -45], ['УХЛ1','умеренно-холодный климат, до −60 °C', -60], ['ХЛ1','холодный климат, до −60 °C', -60]];
const ctypeOf = id => CONTAINER_TYPES.find(c=>c.id===id) || CONTAINER_TYPES[0];

const kitParts = x => (x && x.kit && Array.isArray(x.kit.parts)) ? x.kit.parts : [];
const isKit = x => kitParts(x).length > 0;
const stationOf = x => typeById(attrsOf(x).cat).station || null;
const canKit = x => !!stationOf(x) || isKit(x);
const kitContainer = x => kitParts(x).find(p=>p.role==='container');
const kitMainPart = x => kitParts(x).find(p=>p.role==='main');

// элемент «контейнер»: тип, утепление, климат → название, описание и строки характеристик (свои правки строк не теряются)
function contApply(p, o={}){
  Object.assign(p, o); const c=ctypeOf(p.ctype); p.role='container';
  const prevAuto=p._autoDesc; p.name=(!p.name || CONTAINER_TYPES.some(z=>z.name===p.name)) ? c.name : p.name;
  if (!p.desc || p.desc===prevAuto) p.desc=c.desc; p._autoDesc=c.desc;
  const cl=CLIMATES.find(z=>z[0]===p.climate);
  const set={ 'Тип': c.name, 'Габариты (Д × Ш × В)': String(p.size||'').trim() ? String(p.size).trim()+(/мм|м\b/.test(p.size)?'':' мм') : c.size,
    'Утепление': p.ins?'минеральная вата '+p.ins:'', 'Климатическое исполнение': cl?`${cl[0]} (${cl[1]})`:'', 'Цвет': String(p.ral||'').trim() };
  p.rows=p.rows||[]; if (!p.sys) p.sys={...CONT_SYS_DEF};
  for (const [k,v] of Object.entries(set)){ const r=p.rows.find(z=>z.k===k); if (r){ if (v) r.v=v; else if (k==='Цвет') p.rows.splice(p.rows.indexOf(r),1); } else if (v) p.rows.push({k, v}); }
  for (const [id, k, v] of CONT_SYSTEMS){ const ix=p.rows.findIndex(z=>z.k===k);
    if (p.sys[id] && ix<0) p.rows.push({k, v}); else if (!p.sys[id] && ix>=0) p.rows.splice(ix,1); }
  return p;
}
// название станции подставляется, пока менеджер его не менял сам
function stationAutoName(x){ if (!stationOf(x)) return; if (!String(x.name||'').trim() || x.name===x._autoNameV){ x.name=stationName(x); x._autoNameV=x.name; } }
function kitNewContainer(ctype){ const c=ctypeOf(ctype); return contApply(kitNewPart({qty:1}), {ctype:c.id, ins:c.ins||'100 мм', climate:c.climate||'УХЛ1'}); }

// параметры станции из её элементов: контейнер, климат, мощность / подача / давление основного оборудования — если пусто
function stationFill(x){
  const t=typeById(attrsOf(x).cat); if (!t.station) return;
  x.attrs=x.attrs||{}; const c=kitContainer(x), m=kitMainPart(x), cl=c&&CLIMATES.find(z=>z[0]===c.climate);
  if (c){ x.attrs.container=ctypeOf(c.ctype).name; if (c.climate) x.attrs.climate=c.climate; if (cl && x.attrs.tmin==null) x.attrs.tmin=cl[2]; }
  if (m && m.attrs) for (const f of t.fields) if ((x.attrs[f.key]==null || x.attrs[f.key]==='') && m.attrs[f.key]!=null && m.attrs[f.key]!=='' && !['size','mass','container','climate'].includes(f.key))
    x.attrs[f.key]=f.num ? (numOf(m.attrs[f.key]) ?? m.attrs[f.key]) * (f.key==='kw'||f.key==='flow'?(+m.qty||1):1) : m.attrs[f.key];
}
// название станции по умолчанию: «Модульная насосная станция Grundfos CR 32 в блок-контейнере»
function stationName(x){
  const t=typeById(attrsOf(x).cat), c=kitContainer(x), m=kitMainPart(x), a=(m&&m.attrs)||{};
  // модель — из параметров, иначе латиница и цифры из наименования («Дизель-генераторная установка CU44D5A …» → «CU44D5A»)
  const fromName=m ? (String(m.name||'').match(/[A-Za-z0-9][A-Za-z0-9\-\/.,]*[A-Za-z0-9]|[A-Za-z0-9]/g)||[]).filter(w=>/\d/.test(w)||/[A-Z]{2,}/.test(w)).slice(0,3).join(' ') : '';
  const mm=[a.maker, a.model].filter(Boolean).join(' ') || fromName;
  return [t.item, mm, c?'в '+ctypeOf(c.ctype).short:''].filter(Boolean).join(' ');
}

function kitNewPart(o={}){ return { id:uid(), name:'', qty:1, cost:0, costCur:'RUB', sup:'', desc:'', rows:[], ...o }; }

// закупка изделия за единицу, коп. ₽; NaN — нет курса валюты элемента
function kitCost(x){
  let s=0; for (const p of kitParts(x)){ if (!p.cost) continue; const c=p.costCur||'RUB', r=c==='RUB'?1:rateOf(c); if (!(r>0)) return NaN; s+=p.cost*(+p.qty||0)*r; }
  return Math.round(s);
}
function kitSync(x){ if (!isKit(x)) return false; const c=kitCost(x); if (!Number.isFinite(c)) return false;
  const ch=x.cost!==c || (x.costCur||'RUB')!=='RUB'; x.cost=c; x.costCur='RUB'; return ch; }

// элемент из позиции каталога: название, закупка, поставщик (производитель), суть описания, основные характеристики, фото
function kitFromCat(doc){
  const a=attrsOf(doc), feats=(doc.features||[]).filter(f=>f.text);
  const desc=feats.map(f=>(f.label&&!/^(описание|о серии|назначение)$/i.test(f.label)?f.label+': ':'')+f.text.trim()).join(' ').slice(0,700);
  const rows=(doc.groups||[]).flatMap(g=>(g.rows||[]).filter(r=>r.k&&r.v)).slice(0,14).map(r=>({k:r.k, v:r.v}));
  return kitNewPart({ name:doc.name||'', catId:doc.id, cost:doc.cost||0, costCur:doc.costCur||'RUB', sup:a.maker||'', desc, rows,
    photo:doc.photo&&doc.photo.src?{src:doc.photo.src, w:doc.photo.w, h:doc.photo.h}:null,
    attrs:Object.fromEntries(Object.entries(a).filter(([k,v])=>k!=='type' && v!=='' && v!=null && typeof v!=='object')) });
}

// позиция для документа: состав — блоками описания (с фото) и таблицами характеристик элементов
function kitDocItem(x){
  if (!isKit(x)) return x;
  const parts=kitParts(x).filter(p=>String(p.name||'').trim());
  const q=p=>(+p.qty||1)>1?` × ${p.qty}`:'';
  const list={id:'kit_all', label:'Состав изделия', text:parts.map(p=>`${p.name.trim()}${q(p)}`).join('; ')+'.'};
  const feats=parts.map(p=>{ const rowTxt=(p.rows||[]).filter(r=>r.k&&r.v).slice(0,5).map(r=>`${r.k} — ${r.v}`).join('; ');
    return {id:'kit_'+p.id, label:p.name.trim()+q(p), text:String(p.desc||'').trim() || (rowTxt?rowTxt+'.':'')}; }).filter(f=>f.text);
  const groups=parts.filter(p=>(p.rows||[]).some(r=>r.k&&r.v)).map(p=>({name:p.name.trim(), rows:p.rows.filter(r=>r.k&&r.v).map(r=>({k:r.k, v:r.v, hl:false}))}));
  const gal=parts.filter(p=>p.photo&&p.photo.src&&feats.some(f=>f.id==='kit_'+p.id)).map(p=>({id:'kitg_'+p.id, src:p.photo.src, w:p.photo.w, h:p.photo.h, caption:p.name.trim(), slot:'', at:'feat:kit_'+p.id, on:true}));
  return { ...x, page:true, spec:x.spec||('В составе: '+parts.map(p=>p.name.trim()).join(', ')).slice(0,200),
    features:[...(x.features||[]).filter(f=>f.label||f.text), list, ...feats], groups:[...(x.groups||[]), ...groups], gallery:[...(x.gallery||[]), ...gal] };
}

// состав для шаблона, умеющего сборки (feature 'kit'): элементы как есть (без закупки и поставщика) и описание изделия
// без разложенного состава — его шаблон показывает сам
function kitDocData(x){
  const parts=kitParts(x).filter(p=>String(p.name||'').trim()).map(p=>({id:p.id, name:p.name.trim(), qty:+p.qty||1, desc:String(p.desc||'').trim(),
    rows:(p.rows||[]).filter(r=>r.k&&r.v).map(r=>({k:r.k, v:r.v})), maker:(p.attrs&&p.attrs.maker)||'', model:(p.attrs&&p.attrs.model)||''}));
  return { parts, base:{ page:true, spec:x.spec||'', features:(x.features||[]).filter(f=>f.label||f.text), groups:x.groups||[], gallery:x.gallery||[] } };
}

// строки закупки для экономики сделки: элемент сборки — своя строка (своя валюта и поставщик); обычная позиция — как есть
function kitLines(st=S){
  const out=[];
  (st.items||[]).forEach((x,i)=>{ if (!String(x.name||'').trim() && !x.cost) return;
    if (!isKit(x)){ out.push({id:x.id, i, name:x.name, qty:+x.qty||0, cost:x.cost||0, costCur:x.costCur||'RUB', maker:attrsOf(x).maker||'', item:x}); return; }
    kitParts(x).forEach((p,j)=>{ if (!String(p.name||'').trim() && !p.cost) return;
      out.push({id:x.id+'~'+p.id, i, j, part:p, name:p.name||'Элемент', of:x.name, qty:(+x.qty||0)*(+p.qty||0), cost:p.cost||0, costCur:p.costCur||'RUB',
        maker:p.sup||(p.attrs&&p.attrs.maker)||'', item:{id:x.id+'~'+p.id, catId:p.catId||'', name:p.name, attrs:{...(p.attrs||{}), cat:(p.attrs&&p.attrs.cat)||attrsOf(x).cat}}}); }); });
  return out;
}

// груз для логистики: обычная позиция — как есть; сборка — элементами (каждый едет от своего поставщика).
// Характеристики элемента — его таблица (та же ссылка: габариты и масса, вписанные в логистике, сохраняются в элементе)
function kitCargo(st=S){
  return (st.items||[]).flatMap(x=>!isKit(x) ? [x] : kitParts(x).map(p=>{ p.rows=p.rows||[];
    return {id:x.id+'~'+p.id, name:`${p.name||'Элемент'} (${x.name})`, qty:(+x.qty||0)*(+p.qty||0), groups:[{name:p.name, rows:p.rows}], cost:p.cost, costCur:p.costCur||'RUB', price:0, catId:p.catId||''}; }));
}

// ---------- вкладка «Состав станции» в карточке позиции
function edKit(x,i){
  const P=`items.${i}.kit.parts`, parts=kitParts(x), cost=kitCost(x), st=stationOf(x), t=typeById(attrsOf(x).cat);
  const sel=(attr, j, list, cur)=>`<select data-kitct="${i}.${j}" data-fld="${attr}">${list.map(([v,l])=>`<option value="${esc(v)}"${v===cur?' selected':''}>${esc(l)}</option>`).join('')}</select>`;
  const card=(p,j)=>{ const ct=p._costText ?? (p.cost?String(p.cost/100).replace('.',','):'');
    const role=p.role==='container'?'<span class="kit-role">Контейнер</span>':p.role==='main'?`<span class="kit-role main">${esc(st?st.mainLabel:'Основное')}</span>`:'';
    return `<div class="kit-card${p.role?' r-'+p.role:''}" data-kitj="${j}">
    <div class="kit-h"><span class="kit-n">${j+1}</span>${role}
      <input type="text" data-p="${P}.${j}.name" value="${esc(p.name)}" placeholder="Название элемента" aria-label="Название элемента" class="kit-nm${p.name?'':' need'}">
      <button class="btn ghost sm" type="button" data-a="aiPart" data-i="${i}" data-j="${j}" title="Описание и характеристики элемента — с помощью любого ИИ">✨ ИИ</button>
      <button class="icon" type="button" data-a="kitMv" data-i="${i}" data-j="${j}" data-d="-1" ${j?'':'disabled'} aria-label="Выше">↑</button><button class="icon" type="button" data-a="kitMv" data-i="${i}" data-j="${j}" data-d="1" ${j<parts.length-1?'':'disabled'} aria-label="Ниже">↓</button>
      <button class="icon" type="button" data-a="kitDel" data-i="${i}" data-j="${j}" aria-label="Убрать элемент">✕</button></div>
    ${p.role==='container'?`<div class="kit-ct"><label class="f"><span>Тип контейнера</span>${sel('ctype', j, CONTAINER_TYPES.map(c=>[c.id, c.name+' — '+c.size]), p.ctype)}</label>
      <label class="f"><span>Утепление</span>${sel('ins', j, CONTAINER_INS.map(v=>[v,v]), p.ins)}</label>
      <label class="f"><span>Климатическое исполнение</span>${sel('climate', j, CLIMATES.map(c=>[c[0], c[0]+' — '+c[1]]), p.climate)}</label>
      <label class="f"><span>Размер Д × Ш × В, мм</span><input type="text" data-kitct="${i}.${j}" data-fld="size" value="${esc(p.size||'')}" placeholder="${esc(ctypeOf(p.ctype).size)}"></label>
      <label class="f"><span>Цвет</span><input type="text" data-kitct="${i}.${j}" data-fld="ral" value="${esc(p.ral||'')}" placeholder="например, RAL 7004 / RAL 5005"></label></div>
      <div class="kit-sys"><span class="muted">Системы контейнера:</span>${CONT_SYSTEMS.map(([id,k])=>`<button type="button" class="chip${(p.sys||CONT_SYS_DEF)[id]?' on':''}" data-a="kitSys" data-i="${i}" data-j="${j}" data-sys="${id}" aria-pressed="${!!(p.sys||CONT_SYS_DEF)[id]}">${esc(k)}</button>`).join('')}</div>`:''}
    <div class="kit-g">
      <label class="f"><span>Кол-во</span><input type="text" inputmode="numeric" data-p="${P}.${j}.qty" value="${esc(p.qty)}"></label>
      <label class="f"><span>Закупка за ед.</span><span class="kit-cost"><input type="text" inputmode="decimal" data-kitcost="${i}.${j}" value="${esc(ct)}" placeholder="цена из счёта"><select data-kitcur="${i}.${j}" aria-label="Валюта закупки">${DEAL_CURS.map(c=>`<option${(p.costCur||'RUB')===c?' selected':''}>${c}</option>`).join('')}</select></span></label>
      <label class="f kit-sup"><span>Поставщик${tip('У кого покупаем этот элемент. В «Экономике сделки» элементы с разными поставщиками попадут в разные карточки — со своими сроками и условиями оплаты.')}</span><input type="text" data-p="${P}.${j}.sup" value="${esc(p.sup)}" list="kitSupL" placeholder="Производитель или поставщик" autocomplete="off"></label>
    </div>
    <div class="kit-b">
      <div class="kit-ph">${p.photo&&p.photo.src?`<img src="${esc(p.photo.src)}" alt=""><button class="icon x" type="button" data-a="kitPhotoDel" data-i="${i}" data-j="${j}" aria-label="Убрать фото">✕</button>`:`<button type="button" class="kit-phb" data-a="kitPhoto" data-i="${i}" data-j="${j}">+ фото</button>`}</div>
      <label class="f kit-desc"><span>Техническое описание${p.catId?' <small class="muted">из каталога</small>':''}</span><textarea rows="3" data-p="${P}.${j}.desc" placeholder="Назначение, конструкция, комплектация элемента — попадёт в КП">${esc(p.desc||'')}</textarea></label></div>
    <details class="kit-rows"${(p.rows||[]).length&&(p.rows||[]).length<=6?' open':''}><summary>Характеристики элемента <span class="muted">${(p.rows||[]).length?(p.rows.length+' '+plural(p.rows.length,'строка','строки','строк')):'— таблица в КП'}</span></summary>
      ${(p.rows||[]).map((r,k)=>`<div class="kit-row"><input type="text" data-p="${P}.${j}.rows.${k}.k" value="${esc(r.k)}" placeholder="Параметр"><input type="text" data-p="${P}.${j}.rows.${k}.v" value="${esc(r.v)}" placeholder="Значение"><button class="icon" type="button" data-a="kitRowDel" data-i="${i}" data-j="${j}" data-k="${k}" aria-label="Убрать строку">✕</button></div>`).join('')}
      <button class="btn ghost" type="button" data-a="kitRowAdd" data-i="${i}" data-j="${j}">+ строка</button></details>
  </div>`; };
  const sups=[...new Set([...(typeof DL!=='undefined'&&DL.sups||[]).map(s=>s.name), ...catCache.map(c=>attrsOf(c).maker)].filter(Boolean))].slice(0,400);
  if (!st && !parts.length) return `<div class="ed-sec"><p class="muted">Состав есть только у станций в контейнере. Чтобы собрать станцию, выберите категорию «Насосные / Компрессорные / Дизель-генераторные станции в контейнере» на вкладке «Основное».</p></div>`;
  const cont=kitContainer(x), main=kitMainPart(x);
  const have=new Set(parts.map(p=>norm(p.name)));
  const presets=(st?st.parts:KIT_PRESETS).filter(n=>!have.has(norm(n)));
  // что ещё не выбрано — крупными шагами сверху
  const todo=st ? [
    cont?'':`<div class="kit-todo"><b>1. Контейнер</b><span class="muted">В чём поставляем станцию — дальше можно уточнить утепление и климатическое исполнение.</span>
      <div class="kit-cts">${CONTAINER_TYPES.map(c=>`<button type="button" class="kit-ctb" data-a="kitCont" data-i="${i}" data-ct="${c.id}"><b>${esc(c.name)}</b><small>${esc(c.size)}</small></button>`).join('')}</div></div>`,
    main?'':`<div class="kit-todo"><b>${cont?'1':'2'}. ${esc(st.mainLabel)}</b><span class="muted">Из каталога — с описанием, характеристиками, фото и закупкой; или своё.</span>
      <div class="row"><button class="btn primary" type="button" data-a="kitMain" data-i="${i}">Выбрать в каталоге</button><button class="btn ghost" type="button" data-a="kitAdd" data-i="${i}" data-n="${esc(st.mainLabel)}" data-role="main">+ Своё</button></div></div>`].join('') : '';
  return `<div class="ed-sec"><p class="sub">${st?`Состав: ${esc(t.item.toLowerCase())}`:'Состав изделия'}${tip('Станция в контейнере — одно изделие для заказчика: одна строка и одна цена в КП. Закупка, поставщик, описание и характеристики — у каждого элемента: в КП это таблица «Состав изделия» и карточки элементов, в «Экономике сделки» — свои поставщики и сроки.')}</p>
    ${todo}
    <div class="kit-l">${parts.map(card).join('')}</div>
    <datalist id="kitSupL">${sups.map(s=>`<option value="${esc(s)}">`).join('')}</datalist>
    <div class="kit-add"><span class="muted">Добавить в состав:</span>
      <span class="chips">${presets.map(n=>`<button class="chip" type="button" data-a="kitAdd" data-i="${i}" data-n="${esc(n)}">+ ${esc(n)}</button>`).join('')}</span>
      <span class="row"><button class="btn ghost" type="button" data-a="kitCat" data-i="${i}">+ Из каталога</button><button class="btn ghost" type="button" data-a="kitAdd" data-i="${i}">+ Свой элемент</button></span></div>
    ${parts.length?`<div class="kit-sum"><span>Закупка изделия${parts.some(p=>p.costCur&&p.costCur!=='RUB')?' (по курсам КП)':''}</span><b>${Number.isFinite(cost)?money(cost)+' ₽':'нет курса валюты — укажите в шаге «Цены»'}</b>
      ${parts.some(p=>!p.cost)?`<small class="warn-t">не указана закупка: ${parts.filter(p=>!p.cost).map(p=>esc(p.name||'без названия')).join(', ')}</small>`:''}</div>`:''}</div>`;
}

// ---------- подбор по фильтрам категории: вид (если категорий несколько), производитель, списки и «от–до» по параметрам
// F = {cat, maker, q, f:{ключ: значение}, r:{ключ: [от, до]}}; cats — допустимые категории (null — все)
const pfNew = cats => ({ cat:cats&&cats.length===1?cats[0]:'', maker:'', q:'', f:{}, r:{} });
const pfNum = v => { const n=parseFloat(String(v??'').replace(/\s+/g,'').replace(',','.')); return Number.isFinite(n)?n:null; };
function pfPool(cats){ return catCache.filter(x=>!cats || cats.includes(attrsOf(x).cat)); }
function pfFields(F){ return F.cat ? typeById(F.cat).fields.filter(f=>f.facet || f.range).slice(0,8) : []; }
function pfHtml(F, cats){
  const pool=pfPool(cats).filter(x=>!F.cat || attrsOf(x).cat===F.cat);
  const opt=(v,l,on)=>`<option value="${esc(v)}"${on?' selected':''}>${esc(l)}</option>`;
  const catSel = !cats || cats.length>1 ? `<label class="f"><span>Вид</span><select data-pf="cat">${opt('','Все',!F.cat)}${(cats||TYPES.map(t=>t.id)).filter(c=>!typeById(c).station).map(c=>opt(c, typeById(c).name, F.cat===c)).join('')}</select></label>` : '';
  const makers=[...new Set(pool.map(x=>attrsOf(x).maker).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  const mk=`<label class="f"><span>Производитель</span><select data-pf="maker">${opt('','Все',!F.maker)}${makers.map(m=>opt(m,m,F.maker===m)).join('')}</select></label>`;
  const fl=pfFields(F).map(f=>{ const lab=esc(f.label)+(f.unit?', '+esc(f.unit):'');
    if (f.range){ const r=F.r[f.key]||[];
      return `<label class="f pf-r"><span>${lab}</span><span class="pf-rr"><input type="text" inputmode="decimal" data-pf="rmin:${f.key}" value="${esc(r[0]??'')}" placeholder="от"><input type="text" inputmode="decimal" data-pf="rmax:${f.key}" value="${esc(r[1]??'')}" placeholder="до"></span></label>`; }
    const vals=(f.values&&f.values.length?f.values:[...new Set(pool.map(x=>attrsOf(x)[f.key]).filter(v=>v!=null&&v!=='').map(String))].sort()).slice(0,40);
    return vals.length ? `<label class="f"><span>${lab}</span><select data-pf="f:${f.key}">${opt('','Все',!F.f[f.key])}${vals.map(v=>opt(v,v,F.f[f.key]===v)).join('')}</select></label>` : ''; }).join('');
  return `<div class="pf"><label class="f pf-q"><span>Модель или название</span><input type="search" data-pf="q" value="${esc(F.q)}" placeholder="например, CR 32 или Cummins" autocomplete="off"></label>${catSel}${mk}${fl}</div>`;
}
function pfMatch(x, F, cats){
  const a=attrsOf(x); if (cats && !cats.includes(a.cat)) return false; if (F.cat && a.cat!==F.cat) return false;
  if (F.maker && a.maker!==F.maker) return false;
  for (const [k,v] of Object.entries(F.f)) if (v && String(a[k]??'')!==v) return false;
  for (const [k,[lo,hi]] of Object.entries(F.r)){ const l=pfNum(lo), h=pfNum(hi); if (l==null && h==null) continue;
    const n=numOf(a[k]); if (n==null || (l!=null && n<l) || (h!=null && n>h)) return false; }
  if (F.q.trim()){ const w=norm(F.q).split(' ').filter(Boolean), hay=norm([x.name, a.maker, a.model, a.series].join(' ')); if (!w.every(v=>hay.includes(v))) return false; }
  return true;
}
function pfList(F, cats, lim=40){
  const res=pfPool(cats).filter(x=>pfMatch(x,F,cats));
  const mv=x=>numOf(attrsOf(x)[typeById(attrsOf(x).cat).main||'kw'])??9e9;
  return { n:res.length, list:res.sort((p,q)=>mv(p)-mv(q)).slice(0,lim) };
}
// изменение поля фильтра; true — поменялся набор полей (нужно перерисовать фильтры)
function pfSet(F, el){
  const k=el.dataset.pf, v=el.value;
  if (k==='cat'){ F.cat=v; F.f={}; F.r={}; return true; }
  if (k==='maker'){ F.maker=v; return false; }
  if (k==='q'){ F.q=v; return false; }
  const [t,key]=k.split(':');
  if (t==='f'){ F.f[key]=v; return false; }
  const r=F.r[key]=F.r[key]||['','']; r[t==='rmin'?0:1]=v; return false;
}
const pfRow = (x, act) => `<button type="button" class="kit-pick" ${act}="${esc(x.id)}">${x.photo&&x.photo.src?`<img src="${esc(x.photo.src)}" alt="">`:'<span class="kit-noimg"></span>'}<span><b>${esc(x.name)}</b><small class="muted">${esc(typeById(attrsOf(x).cat).name)}${mainLine(x,3)?' · '+esc(mainLine(x,3)):''}${x.cost?' · закупка '+money(x.cost)+' '+(x.costCur||'RUB'):''}</small></span></button>`;

// выбор позиции каталога для элемента: cats — только эти категории (основное оборудование станции), role — роль элемента
function kitPickCat(i, cats, role){
  const d=$('#dlg'); d.classList.add('wide'); const F=pfNew(cats);
  const list=()=>{ const r=pfList(F, cats, 60); return `<p class="muted pf-n">Найдено: ${r.n}${r.n>60?' — показаны первые 60, уточните фильтры':''}</p>`+(r.list.map(x=>pfRow(x,'data-cid')).join('') || '<p class="muted">Ничего не найдено — измените фильтры или добавьте свой элемент.</p>'); };
  const draw=()=>{ $('#kitPF').innerHTML=pfHtml(F, cats); $('#kitPL').innerHTML=list(); };
  d.innerHTML=`<div class="dlg-h"><h3>${role==='main'?esc(stationOf(S.items[i]).mainLabel)+' — подбор в каталоге':'Элемент из каталога'}</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
    <div class="dlg-b"><div id="kitPF"></div><div class="kit-pl" id="kitPL"></div></div>`;
  d.showModal(); d.querySelector('[data-close]').onclick=()=>d.close(); draw();
  setTimeout(()=>d.querySelector('[data-pf="q"]')?.focus(), 30);
  const onF=e=>{ const el=e.target.closest('[data-pf]'); if (!el) return; const re=pfSet(F, el);
    if (re){ draw(); } else $('#kitPL').innerHTML=list(); };
  $('#kitPF').oninput=e=>{ if (e.target.tagName==='INPUT') onF(e); }; $('#kitPF').onchange=e=>{ if (e.target.tagName==='SELECT') onF(e); };
  $('#kitPL').onclick=async e=>{ const b=e.target.closest('[data-cid]'); if (!b) return; const lite=catCache.find(x=>x.id===b.dataset.cid);
    let doc=lite; try{ doc=await api('/api/catalog/'+encodeURIComponent(lite.id)); }catch(_){}
    const it=S.items[i]; it.kit=it.kit||{parts:[]}; const p=kitFromCat(doc); if (role) p.role=role;
    if (role==='main'){ const ix=it.kit.parts.findIndex(z=>z.role==='container'); it.kit.parts.splice(ix>=0?ix:0, 0, p); } else it.kit.parts.push(p);
    kitSync(it); stationFill(it); stationAutoName(it);
    d.close(); renderForm(); persist(); toast('Добавлено в состав: '+doc.name); };
}

// действия вкладки «Состав» (вызываются из общего обработчика кнопок data-a)
function kitAction(a, i, b){
  const it=S.items[i]; if (!it) return false; it.kit=it.kit||{parts:[]}; const P=it.kit.parts, j=+b.dataset.j;
  if (a==='kitAdd'){ const p=kitNewPart({name:b.dataset.n||''}); if (b.dataset.role) p.role=b.dataset.role; P.push(p); it.page=true; return true; }
  if (a==='kitCat'){ kitPickCat(i); return 'async'; }
  if (a==='kitMain'){ kitPickCat(i, (stationOf(it)||{}).main, 'main'); return 'async'; }
  if (a==='kitSys'){ const p=P[j]; p.sys={...(p.sys||CONT_SYS_DEF)}; p.sys[b.dataset.sys]=!p.sys[b.dataset.sys]; contApply(p); return true; }
  if (a==='kitCont'){ P.push(kitNewContainer(b.dataset.ct)); it.page=true; stationFill(it); stationAutoName(it); return true; }
  if (a==='kitDel'){ if (!confirm(`Убрать из состава «${P[j].name||'элемент'}»?`)) return 'async'; P.splice(j,1); kitSync(it); return true; }
  if (a==='kitMv'){ const k=j+(+b.dataset.d); if (P[k]){ [P[j],P[k]]=[P[k],P[j]]; } return true; }
  if (a==='kitRowAdd'){ (P[j].rows=P[j].rows||[]).push({k:'',v:''}); return true; }
  if (a==='kitRowDel'){ P[j].rows.splice(+b.dataset.k,1); return true; }
  if (a==='kitPhotoDel'){ P[j].photo=null; return true; }
  if (a==='kitPhoto'){ const f=$('#filePick'); f.value=''; f.multiple=false;
    f.onchange=async()=>{ const fl=f.files[0]; if (!fl) return; try{ P[j].photo=await prepGallery(fl); renderForm(); persist(); }catch(e){ toast('Не удалось открыть изображение'); } }; f.click(); return 'async'; }
  return false;
}

document.addEventListener('input', e=>{ const t=e.target; if (t.dataset.kitcost==null) return;
  const [i,j]=t.dataset.kitcost.split('.').map(Number), it=S.items[i], p=kitParts(it)[j]; if (!p) return;
  const n=dNum(t.value); p._costText=t.value; t.classList.toggle('bad', Number.isNaN(n)); if (!Number.isNaN(n)) p.cost=n==null?0:Math.round(n*100);
  kitSync(it); updateLive(); persist(); if (typeof dealRender==='function') dealRender(); });
document.addEventListener('focusout', e=>{ const t=e.target; if (t.dataset.kitcost==null) return;
  const [i,j]=t.dataset.kitcost.split('.').map(Number), p=kitParts(S.items[i])[j]; if (p && !Number.isNaN(dNum(p._costText))) delete p._costText; renderForm(); if (typeof dealRender==='function') dealRender(); });
document.addEventListener('change', e=>{ const t=e.target;
  if (t.dataset.kitct!=null){ const [i,j]=t.dataset.kitct.split('.').map(Number), it=S.items[i], p=kitParts(it)[j]; if (!p) return;
    const o={[t.dataset.fld]:t.value}; if (t.dataset.fld==='ctype'){ const c=ctypeOf(t.value); if (c.ins) o.ins=c.ins; if (c.climate) o.climate=c.climate; }
    contApply(p, o); stationFill(it); stationAutoName(it); renderForm(); persist(); return; }
  if (t.dataset.kitcur!=null){ const [i,j]=t.dataset.kitcur.split('.').map(Number), it=S.items[i], p=kitParts(it)[j]; if (!p) return;
    p.costCur=t.value; if (t.value!=='RUB' && !(rateOf(t.value)>0)) loadCBR(); kitSync(it); renderForm(); persist(); if (typeof dealRender==='function') dealRender(); return; }
  if (/^items\.\d+\.kit\.parts\.\d+\.qty$/.test(t.dataset.p||'')){ const it=S.items[+t.dataset.p.split('.')[1]]; kitSync(it); renderForm(); persist(); } });
