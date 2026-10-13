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
  { id:'block', name:'Блок-контейнер утеплённый', short:'блок-контейнере', size:'по оборудованию (длина 2–12 м, ширина 1,5–2,55 м)',
    desc:'Каркас из гнутого стального профиля, стены и кровля — сэндвич-панели с минераловатным утеплителем, пол — рифлёный стальной лист по утеплённому основанию. Размеры подбираются под оборудование; двери и проёмы — по проекту.' },
  { id:'welded', name:'Блок-контейнер цельносварной', short:'цельносварном блок-контейнере', size:'по проекту, например 5000 × 2400 × 2500 мм',
    desc:'Цельносварной стальной каркас и корпус: наружная обшивка — стальной лист от 1,5 мм с антикоррозионной обработкой, утепление стен, крыши и пола минеральной ватой, пол — рифлёный стальной лист, крыша — профилированный лист. Закладные под оборудование, проушины для погрузки, дверь и утеплённые ворота — по проекту.' },
  { id:'sea10', name:'Морской контейнер 10 футов', short:'контейнере 10 футов', size:'2991 × 2438 × 2591 мм',
    desc:'Стандартный морской контейнер ISO 10 футов, переоборудованный под оборудование: утепление и внутренняя обшивка, дверь обслуживания, вентиляционные проёмы, кабельные и трубные вводы.' },
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
const CONTAINER_INS = ['50 мм', '80 мм', '100 мм', '150 мм', '200 мм'];
// системы контейнера (как в спецификациях производителей контейнеров и в ТЗ заказчиков): включённая — строка в характеристиках
const CONT_SYSTEMS = [
  ['power', 'Электрооборудование', 'Щит собственных нужд, сальниковые кабельные вводы, проводка в кабель-каналах, розетки, заземление'],
  ['light', 'Освещение', 'Основное — светодиодные светильники; аварийное — светильник с аккумулятором'],
  ['heat', 'Отопление', 'Электрические конвекторы с терморегулятором'],
  ['vent', 'Вентиляция', 'Приточно-вытяжная: воздушные клапаны с электроприводом, управление по термодатчику, антивандальные решётки'],
  ['ops', 'Охранно-пожарная сигнализация', 'Щит ОПС у входа (прибор приёмно-контрольный с резервным питанием), дымовые извещатели (у ДГУ — тепловые), ручной извещатель и оповещатель у выхода, датчик открытия двери, вывод сигналов «сухими контактами»'],
  ['fire', 'Автоматическое пожаротушение', 'Порошковое: самосрабатывающие модули типа «Буран-2,5» на потолке (число — по расчёту), пуск — от теплового замка и от щита ОПС; табло «Порошок! Уходи!», «Порошок! Не входи!», «Автоматика отключена»'],
  ['noise', 'Шумоизоляция', 'Внутренняя обшивка шумопоглощающим материалом, камеры шумоглушения на приточных и вытяжных жалюзи'],
  ['rec', 'Рециркуляция тепла', 'Зимой тёплый воздух от охлаждения оборудования возвращается в помещение заслонкой рециркуляции с термостатом — при работе отопление не требуется'],
  ['snow', 'Маркизы на приточных жалюзи (снегозащита)', 'Откидные козырьки из оцинкованной стали на петлях над приточными жалюзи: открытые — с раскрывающимися боковыми створками-ограничителями, воздух проходит только снизу (снег и дождь не задуваются), угол открытия — по расчёту (скорость на входе не более 1,5 м/с); закрытые — закрывают проём как защитный щит (перевозка, простой, непогода)'],
  ['snowout', 'Маркизы на жалюзи выброса горячего воздуха', 'По требованию: такие же откидные козырьки над жалюзи выброса — открытые направляют горячий воздух вниз (выход не меньше живого сечения жалюзи), закрытые — защитный щит на проёме'],
  ['boost', 'Вентилятор в воздуховоде выброса', 'Компактные жалюзи: канальный вентилятор в воздуховоде горячего воздуха компрессора помогает его штатному вентилятору — выброс до 6 м/с, приток до 4 м/с по рамке (жалюзи примерно на треть меньше); с термостатом и защитой двигателя'],
  ['exfan', 'Вытяжные вентиляторы', 'Принудительный выброс горячего воздуха: осевые вентиляторы вверху стены напротив притока с гравитационными жалюзи, включаются автоматически по датчику температуры (в том числе при остановленных компрессорах); воздуховоды компрессоров подведены к ним — проёмы выброса и приточные жалюзи меньше (выброс 6 м/с, приток до 4 м/с по рамке)'],
  ['hrv', 'Рекуператор (по требованию)', 'По требованию заказчика: рекуператор тепла вытяжного воздуха (по умолчанию — с промежуточным теплоносителем: приток и выброс на разных стенах), с байпасом и предподогревом от обмерзания; КПД и экономия — в «Расчёте станции»'],
  ['gate', 'Ворота', 'Утеплённые распашные ворота для монтажа и обслуживания оборудования'],
];
const CONT_SYS_DEF = { power:true, light:true, heat:true, vent:true, rec:true };
// прежние тексты систем по умолчанию: в характеристиках контейнера заменяются новыми (свои правки менеджера не трогаются)
const CONT_SYS_OLD = { snow:['Откидные защитные козырьки перед приточными жалюзи — от снега и дождя; открываются для обслуживания и очистки', 'Маркизы из оцинкованной стали перед приточными жалюзи: вход воздуха снизу через сетку — снег и дождь не задуваются; вылет — по расчёту (скорость на входе не более 1,5 м/с); откидные на петлях — для обслуживания и чистки, на время перевозки снимаются'], ops:['Прибор приёмно-контрольный, дымовые датчики, датчик открытия двери, сирена, вывод сигналов «сухими контактами»'],
  fire:['Аэрозольное: модули пожаротушения, табло «Аэрозоль уходи» / «Аэрозоль не входи»'] };
// прежние названия систем: строка характеристик контейнера с таким названием переименовывается (без второй строки)
const CONT_SYS_RENAMED = { snow:['Снегозащита воздухозаборов'] };
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
  const rf=StationGeo.roof(p), roof=rf!=='flat' ? StationGeo.ROOFS[rf] : null, fl=StationGeo.floor(p); p.floor=fl;
  const set={ 'Тип': c.name, 'Габариты (Д × Ш × В)': String(p.size||'').trim() ? String(p.size).trim()+(/мм|м\b/.test(p.size)?'':' мм') : c.size,
    'Утепление': p.ins?'минеральная вата '+p.ins:'', 'Климатическое исполнение': cl?`${cl[0]} (${cl[1]})`:'', 'Крыша': roof ? (roof.deg ? `${roof.name}, уклон ${roof.deg}°` : roof.name) : '',
    'Пол': StationGeo.FLOORS[fl].name[0].toUpperCase()+StationGeo.FLOORS[fl].name.slice(1), 'Цвет': String(p.ral||'').trim() };
  p.rows=p.rows||[]; if (!p.sys) p.sys={...CONT_SYS_DEF};
  for (const [k,v] of Object.entries(set)){ const r=p.rows.find(z=>z.k===k); if (r){ if (v) r.v=v; else if (k==='Цвет' || k==='Крыша') p.rows.splice(p.rows.indexOf(r),1); } else if (v) p.rows.push({k, v}); }
  for (const [id, k, v] of CONT_SYSTEMS){ for (const r of p.rows) if ((CONT_SYS_RENAMED[id]||[]).includes(r.k)) r.k=k;
    const ix=p.rows.findIndex(z=>z.k===k);
    if (p.sys[id] && ix<0) p.rows.push({k, v}); else if (!p.sys[id] && ix>=0) p.rows.splice(ix,1);
    else if (ix>=0 && (CONT_SYS_OLD[id]||[]).includes(p.rows[ix].v)) p.rows[ix].v=v; }
  return p;
}
// название станции подставляется, пока менеджер его не менял сам
function stationAutoName(x){ if (!stationOf(x)) return; if (!String(x.name||'').trim() || x.name===x._autoNameV){ x.name=stationName(x); x._autoNameV=x.name; } }
function kitNewContainer(ctype){ const c=ctypeOf(ctype); return contApply(kitNewPart({qty:1}), {ctype:c.id, ins:c.ins||DEF('st.ins')||'100 мм', climate:c.climate||DEF('st.climate')||'УХЛ1'}); }

// параметры станции из её элементов — пересчитываются при любом изменении состава (замена, удаление, количество):
// контейнер, климат, габариты — из контейнера; установленная мощность — сумма элементов; подача, давление, мощность ДГУ —
// у основного оборудования; остальные (точка росы, бак…) — у первого элемента, где они есть; масса — сумма, если известна у всех.
// x._sa — что подставлено автоматически: вписанное менеджером (значение не совпадает) не трогается.
const STATION_MAIN_KEYS = ['flow', 'head', 'pressure', 'kw', 'kva', 'voltage', 'drive', 'automation'];
function stationAuto(x){
  const t=typeById(attrsOf(x).cat); if (!t.station) return {};
  const P=kitParts(x), c=kitContainer(x), m=kitMainPart(x), cl=c&&CLIMATES.find(z=>z[0]===c.climate), out={};
  const pa=p=>p.attrs||{}, q=p=>+p.qty||1;
  if (c){ out.container=ctypeOf(c.ctype).name; if (c.climate) out.climate=c.climate; if (cl) out.tmin=cl[2];
    const dm=String((c.rows||[]).find(r=>/^Габариты/.test(r.k))?.v||''); if (/\d{3,}\s*[×xх*]\s*\d{3,}/.test(dm)) out.size=dm.replace(/\s*мм\s*$/,''); }
  const ms=P.map(p=>{ const v=numOf(pa(p).mass) ?? (typeof lgCargoOf==='function' ? (lgCargoOf([{rows:p.rows||[]}]).mass||0)*1000 : 0); return v>0 ? v*q(p) : null; });
  if (P.length && ms.every(v=>v>0)) out.mass=Math.round(ms.reduce((a,b)=>a+b,0));
  for (const f of t.fields){ if (['container','climate','tmin','size','mass'].includes(f.key)) continue;
    if (f.key==='kw' && /установленн/i.test(f.label)){ const s=P.reduce((a,p)=>{ const n=numOf(pa(p).kw); return n>0 ? a+n*q(p) : a; },0); if (s>0) out.kw=Math.round(s*10)/10; continue; }
    if (m && pa(m)[f.key]!=null && pa(m)[f.key]!==''){ const v=pa(m)[f.key]; out[f.key]=f.num ? StationAutoVal.of(v, f.key==='flow' ? q(m) : 1) : v; continue; }
    if (STATION_MAIN_KEYS.includes(f.key)) continue;      // подача, давление, напор, мощность ДГУ — только основного оборудования
    const o=P.find(p=>p!==m && pa(p)[f.key]!=null && pa(p)[f.key]!==''); if (o) out[f.key]=f.num ? StationAutoVal.of(pa(o)[f.key]) : pa(o)[f.key]; }
  return out;
}
function stationFill(x){
  const t=typeById(attrsOf(x).cat); if (!t.station) return;
  x.attrs=x.attrs||{}; const old=x._sa||{}, now=stationAuto(x), same=(a,b)=>String(a??'')===String(b??'');
  for (const k of new Set([...Object.keys(old), ...Object.keys(now)])){
    const cur=x.attrs[k], mine = cur!=null && cur!=='' && !same(cur, old[k]);
    if (mine) continue;
    if (now[k]!=null && now[k]!=='') x.attrs[k]=now[k]; else delete x.attrs[k]; }
  x._sa=now;
  // строка под названием и таблица характеристик станции — тоже автоматически, пока их не правили
  const spec=[mainLine(x,3), kitContainer(x)?ctypeOf(kitContainer(x).ctype).name.toLowerCase():''].filter(Boolean).join(' · ');
  if (!String(x.spec||'').trim() || x.spec===x._saSpec){ x.spec=spec; x._saSpec=spec; }
  const g=StationSpec.groups(x, groupsFromAttrs(x).filter(z=>z.rows.length)), gs=JSON.stringify(x.groups||[]);
  if (!(x.groups||[]).some(z=>(z.rows||[]).some(r=>r.k||r.v)) || gs===x._saG){ x.groups=g; x._saG=JSON.stringify(g); }
  else if (x._saG){ x.groups=StationAutoVal.merge(x.groups, JSON.parse(x._saG), g); x._saG=JSON.stringify(g); }   // правили вручную — автоматические строки обновить, свои оставить
}
/** связный текст «Назначение и состав» станции — только из её данных (вид, основное оборудование, параметры, состав,
 *  контейнер и исполнение), без выдуманных значений; в КП — если менеджер не написал свой блок «Назначение…» */
class StationPurpose {
  static LABEL='Назначение и состав';
  static WHAT={ comp:'выработки, подготовки (осушки и очистки) и подачи сжатого воздуха потребителям', dgu:'электроснабжения объекта',
    pump:'перекачки жидкости с заданными подачей и напором' };
  /** есть ли у станции свой блок назначения (вписан менеджером или ИИ) */
  static own(x){ return (x.features||[]).some(f=>/назначени/i.test(String(f.label||'')) && String(f.text||'').trim()); }
  /** list — перечислить остальной состав (в документе без раздела «Состав изделия» шаблона) */
  static text(x, list=true){
    const t=typeById(attrsOf(x).cat); if (!t.station) return '';
    const m=kitMainPart(x), c=kitContainer(x), nm=p=>String(p.name||'').trim(), qn=p=>((+p.qty||1)>1 ? ` — ${p.qty} шт.` : '');
    const rest=kitParts(x).filter(p=>p!==m && p.role!=='container' && nm(p)), kpi=mainLine(x, 4), out=[];
    out.push(`${t.item||t.name} предназначена для ${this.WHAT[StationReq.kind(x)]||'работы в составе объекта заказчика'}.`);
    if (m && nm(m)) out.push(`Основное оборудование — ${nm(m)}${qn(m)}.`);
    if (kpi) out.push(`Основные параметры: ${kpi}.`);
    if (list && rest.length) out.push(`В составе${m && nm(m) ? ' также' : ''}: ${rest.map(p=>nm(p)+qn(p)).join('; ')}.`);
    if (c){ const ct=ctypeOf(c.ctype), cl=[c.climate ? `климатическое исполнение ${c.climate}` : '', c.ins ? `утепление ${c.ins}` : ''].filter(Boolean).join(', ');
      out.push(`Оборудование размещено в контейнере: ${String(ct.name||'').toLowerCase()}${cl ? `; ${cl}` : ''}.`); }
    return out.join(' ');
  }
  /** блок описания для документа КП или null */
  static feature(x, list=true){ if (this.own(x)) return null; const text=this.text(x, list); return text ? { id:'st_purpose', label:this.LABEL, text } : null; }
}
/** значения, подставляемые в станцию из её оборудования */
class StationAutoVal {
  /** число поля × k (подача — на число агрегатов): без дробного «мусора»; диапазон «8–10» — диапазоном; текст без числа — как есть */
  static of(v, k=1){
    const s=String(v??'').trim(), R=s.replace(/\s/g, '').replace(/,/g, '.').match(/^(\d+(?:\.\d+)?)[–—-](\d+(?:\.\d+)?)$/);
    if (R) return k===1 ? s : `${this.r(R[1]*k)}–${this.r(R[2]*k)}`;
    const n=numOf(s); return n==null || !Number.isFinite(n) ? s : this.r(n*k);
  }
  static r(v){ return Math.round(v*1000)/1000; }
  /** таблица характеристик: новые автоматические строки + строки менеджера (новые или изменённые им — по разделу и названию);
   *  автоматическая строка, которую не трогали, — берётся новая (или пропадает вместе с оборудованием) */
  static merge(cur, old, now){
    const key=(g, r)=>`${g.name||''}\u0001${r.k||''}`, auto=new Map(); for (const g of old||[]) for (const r of g.rows||[]) auto.set(key(g, r), String(r.v??''));
    const out=now.map(g=>({ ...g, rows:g.rows.map(r=>({ ...r })) }));
    for (const g of cur||[]) for (const r of g.rows||[]){ if (!(r.k||r.v)) continue; const k=key(g, r);
      if (auto.has(k) && auto.get(k)===String(r.v??'')) continue;
      let G=out.find(z=>(z.name||'')===(g.name||'')); if (!G){ G={ ...g, rows:[] }; out.push(G); }
      const i=G.rows.findIndex(z=>(z.k||'')===(r.k||'')); if (i>=0 && r.k) G.rows[i]={ ...r }; else G.rows.push({ ...r }); }
    return out;
  }
}
// таблица характеристик станции: вместо «Производитель / Модель», угаданных по названию станции («EAGLE»), —
// строка основного оборудования «Компрессор: Dalgakiran EAGLE 315W»
class StationSpec {
  /** нагрузки станции по компоновке или null (нет контейнера, не помещается) */
  static power(x){
    if (typeof StationUi==='undefined' || !isKit(x)) return null;
    try{ const p=StationUi.plan(x); return p && p.level!=='error' && p.power || null; } catch(e){ return null; }
  }
  static groups(x, groups){
    const t=typeById(attrsOf(x).cat), m=kitMainPart(x), ma=(m&&m.attrs)||{};
    const main=[ma.maker, ma.model].filter(Boolean).join(' ') || (m&&m.name) || '';
    const out=groups.map(g=>({...g, rows:g.rows.filter(r=>!/^(Производитель|Модель)$/.test(r.k))})).filter(g=>g.rows.length);
    if (main && t.station){ const row={k:t.station.mainLabel||'Основное оборудование', v:main, hl:false};
      if (out.length) out[0].rows.unshift(row); else out.push({name:'Основные', rows:[row]}); }
    // расчётная мощность по компоновке (StationPower): сколько выделить станции (у ДГУ — собственные нужды)
    const W=t.station ? this.power(x) : null;
    if (W && W.kw>0){ const row={k:W.dgu ? 'Собственные нужды станции' : 'Потребляемая мощность (расчётная)', v:`${StationPower.f(W.kw)} кВт, 3 × 400 В${W.breaker ? `, вводной автомат ${W.breaker} А` : ''}`, hl:false};
      if (out.length) out[0].rows.push(row); else out.push({name:'Основные', rows:[row]}); }
    // свои параметры станции (ручной режим): после автоматических; совпадающая строка — заменяется своей
    const own=t.station && typeof StationParams!=='undefined' ? StationParams.rows(x) : [];
    if (own.length){ const has=new Set(own.map(r=>r.k.toLowerCase())); for (const g of out) g.rows=g.rows.filter(r=>!has.has(String(r.k||'').toLowerCase()));
      const rows=own.map(r=>({ k:r.k, v:r.v, hl:false })); if (out.length) out[0].rows.push(...rows); else out.push({ name:'Основные', rows }); }
    return out.filter(g=>g.rows.length);
  }
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

// блоки описания позиции каталога, которые уходят в КП: без «Опций по прайсу поставщика» (блок фида с ценами прайса —
// у прайса «наша закупка» это закупочные цены; менеджер видит его в каталоге, заказчику он не нужен)
class CatFeatures {
  static forKp(list){ return (list||[]).filter(f=>f && !f.feedOpts); }
}

// элемент сборки из позиции каталога: название, закупка, поставщик (производитель), суть описания, основные характеристики, фото
class KitPart {
  static MAX = 700;     // описание элемента — не длиннее (знаков); обрезается по концу предложения или пункта списка
  static fromCat(doc){
    const a={ ...attrsOf(doc) }, feats=CatFeatures.forKp(doc.features).filter(f=>f.text);   // копия: габариты дописываются
    // блоки описания — с новой строки (списки «• …» остаются списками и в карточке, и в документе КП)
    const desc=KitPart.cut(feats.map(f=>(f.label&&!/^(описание|о серии|назначение)$/i.test(f.label)?f.label+': ':'')+f.text.trim()).join('\n'));
    const all=(doc.groups||[]).flatMap(g=>(g.rows||[]).filter(r=>r.k&&r.v)), rows=all.slice(0,14).map(r=>({k:r.k, v:r.v}));
    KitPart.dimsOf(a, all);
    return kitNewPart({ name:doc.name||'', catId:doc.id, cost:doc.cost||0, costCur:doc.costCur||'RUB', sup:a.maker||'', desc, rows,
      photo:doc.photo&&doc.photo.src?{src:doc.photo.src, w:doc.photo.w, h:doc.photo.h}:null, ...(doc.draw&&typeof doc.draw==='object'?{draw:JSON.parse(JSON.stringify(doc.draw))}:{}),
      attrs:Object.fromEntries(Object.entries(a).filter(([k,v])=>k!=='type' && v!=='' && v!=null && typeof v!=='object')) });
  }
  /** габариты и масса для компоновки станции — из всех строк характеристик (в составе их только первые 14): «Габариты»
   *  или «Длина / Ширина / Высота», «Масса / Вес»; заполненные в каталоге не меняются */
  static dimsOf(a, all){
    const num=v=>{ const m=String(v??'').replace(/\s/g, '').replace(',', '.').match(/\d+(?:\.\d+)?/); return m ? +m[0] : null; };
    // «м» отдельным словом (не «мм»): \b в JavaScript не видит границ кириллических слов
    const mm=r=>{ const v=num(r.v); return v==null ? null : /(?:^|[^а-яё])м(?![а-яё])/i.test(String(r.k)+' '+String(r.v)) && v<30 ? Math.round(v*1000) : v; };
    const row=re=>all.find(r=>re.test(String(r.k).trim()) && !/упаков|присоедин|фланц|патрубк|бак|ресивер|сопл|радиатор|про[её]м|отверсти/i.test(String(r.k)));
    if (!a.size){ const g=row(/^габарит|^размеры?\b/i), L=row(/^длина/i), W=row(/^ширина/i), H=row(/^высота/i);
      if (g && /\d\s*[×xх*]\s*\d/i.test(String(g.v))) a.size=String(g.v).replace(/\s*мм\s*$/i, '').trim();
      else if (L && W && H && mm(L) && mm(W) && mm(H)) a.size=`${mm(L)} × ${mm(W)} × ${mm(H)}`; }
    if (!a.mass){ const m=row(/^(масса|вес)(?!\s*(брутто|в упаковке))/i), v=m ? num(m.v) : null; if (v>0) a.mass=v; }
    return a;
  }
  static cut(s){
    s=String(s||'').trim(); if (s.length<=KitPart.MAX) return s;
    const head=s.slice(0, KitPart.MAX), end=Math.max(head.lastIndexOf('. '), head.lastIndexOf('.\n'), head.lastIndexOf(';\n'), head.lastIndexOf('\n'));
    return end>KitPart.MAX*0.5 ? head.slice(0, end+1).trim() : head.replace(/\s+\S*$/, '')+'…';
  }
}

// трубопроводная обвязка станции: материал (сталь, нержавеющая сталь, полипропилен) и условный проход — поля в составе
// и строки характеристик элемента (в КП); на компоновке — цвет трассы (PipeMaterial, station-layout.js)
class KitPipe {
  static is(p){ return !!p && p.role!=='container' && p.role!=='main' && StationEquip.PIPING.test(String(p.name||'')); }
  static fields(p, i, j){
    if (!this.is(p)) return '';
    const cur=(PipeMaterial.of(p)||{}).id||'';
    return `<div class="kit-pp"><label class="f"><span>Материал трубопровода</span><select data-kitpp="${i}.${j}" data-fld="pipeMat"><option value=""${cur?'':' selected'}>— выберите —</option>${PipeMaterial.LIST.map(m=>`<option value="${m.id}"${m.id===cur?' selected':''}>${esc(m.name)}</option>`).join('')}</select></label>
      <label class="f"><span>Условный проход</span><input type="text" data-kitpp="${i}.${j}" data-fld="dn" value="${esc(p.dn||'')}" placeholder="например, DN 50" maxlength="20"></label></div>`;
  }
  /** поле в составе → элемент и строки «Материал трубопровода», «Условный проход» */
  static change(t){
    const [i, j]=t.dataset.kitpp.split('.').map(Number), it=S.items[i], p=kitParts(it)[j]; if (!p) return;
    if (t.dataset.fld==='pipeMat') p.pipeMat=PipeMaterial.get(t.value) ? t.value : '';
    else p.dn=String(t.value||'').trim().slice(0, 20);
    this.rows(p); renderForm(); persist();
  }
  static rows(p){
    p.rows=p.rows||[]; const m=PipeMaterial.get(p.pipeMat), dn=PipeMaterial.dn({ dn:p.dn });
    for (const [k, v] of [[PipeMaterial.ROW, m ? m.row : ''], [PipeMaterial.DN_ROW, dn]]){ const r=p.rows.find(z=>z.k===k);
      if (r){ if (v) r.v=v; else p.rows.splice(p.rows.indexOf(r), 1); } else if (v) p.rows.push({ k, v }); }
  }
}

// шкафы станции: на стене (чаще так — по умолчанию) или на полу — поле в составе и строка «Установка» характеристик
// элемента; на компоновке настенный висит на стене прохода, напольный стоит в ряду (StationEquip.mount, station-layout.js)
class KitCabinet {
  static ROW = 'Установка';
  static OPTS = [['wall', 'на стене', 'настенный'], ['floor', 'на полу', 'напольный']];
  static is(p){ return !!p && p.role!=='container' && p.role!=='main' && StationEquip.kindOf(p)==='cabinet'; }
  static fields(p, i, j){
    if (!this.is(p)) return '';
    const cur=StationEquip.mount(p, StationEquip.dims(p, 'cabinet'));
    return `<div class="kit-pp"><label class="f"><span>Установка шкафа</span><select data-kitcab="${i}.${j}">${this.OPTS.map(([v, l])=>`<option value="${v}"${v===cur?' selected':''}>${esc(l)}</option>`).join('')}</select></label></div>`;
  }
  /** поле в составе → элемент и строка «Установка» */
  static change(t){
    const [i, j]=t.dataset.kitcab.split('.').map(Number), it=S.items[i], p=kitParts(it)[j]; if (!p) return;
    p.mount=t.value==='floor' ? 'floor' : 'wall'; this.rows(p); renderForm(); persist();
  }
  static rows(p){
    p.rows=p.rows||[]; const o=this.OPTS.find(z=>z[0]===p.mount), r=p.rows.find(z=>z.k===this.ROW);
    if (r){ if (o) r.v=o[2]; else p.rows.splice(p.rows.indexOf(r), 1); } else if (o) p.rows.push({ k:this.ROW, v:o[2] });
  }
}

// элементы станции, без которых её не бывает: мастер кладёт их в состав сразу (ДГУ — глушитель на крыше, дополнительный
// топливный бак, топливопровод; насосная и компрессорная — трубопроводная обвязка), новый элемент с таким названием
// получает описание. Закупку, поставщика и подробности менеджер уточняет в составе.
class StationDefaults {
  static TANKS = [500, 1000, 1500, 2000, 3000];   // типовые объёмы дополнительного бака, л
  static FUEL = /топливн\S* бак|дополнительн\S* бак|бак топлив/i;   // топливный бак ДГУ (не бак для воды)
  static get LPH(){ return StationRules.ok() ? StationRules.raw('dgu.lph') : 0.25; }       // расход топлива, л на кВт·ч (файл правил)
  static get LOAD(){ return StationRules.ok() ? StationRules.raw('dgu.fuel_load') : 0.75; }  // нагрузка по умолчанию (файл правил)
  static TEXT = [
    [/глушител/i, 'Глушитель выхлопа на крыше контейнера, на опорах: сильфонный компенсатор, термоизоляция выхлопной трубы, дождевой колпак. На время перевозки снимается.', [['Установка', 'на крыше контейнера']]],
    [StationDefaults.FUEL, 'Дополнительный топливный бак для увеличения времени автономной работы ДГУ: датчик уровня, заливная горловина, дыхательный клапан, поддон, подключение к топливной системе ДГУ.', []],
    [/трубопровод|топливопровод|обвязк/i, 'Трубопроводная обвязка оборудования станции: магистраль, отводы к оборудованию, запорная арматура, крепления. Материал труб и условный проход — в составе станции.', []],
    [/асу ?тп/i, 'Шкаф АСУ ТП: контроллер, панель оператора, сбор сигналов и аварий оборудования станции, архив событий, передача данных в диспетчерскую.', [['Связь с диспетчерской', 'Modbus TCP / Ethernet или GSM — по проекту']]],
    [/(?:^|[^а-яё])АВР(?![а-яё])|ввод\S* резерв/i, 'Шкаф автоматического ввода резерва: переключение питания станции на резервный ввод при пропадании основного, индикация, ручной режим.', [['Вводы', 'основной и резервный']]],
  ];
  /** мастер станции: добавить обязательные элементы по виду станции */
  static add(it, typeId){
    const P=it.kit.parts;
    if (typeId==='st_dgu'){
      P.push(this.part(it, 'Глушитель на крыше'), this.part(it, 'Дополнительный топливный бак'));
      const fl=this.part(it, 'Топливопровод и запорная арматура'); fl.pipeMat='steel'; KitPipe.rows(fl); P.push(fl);   // топливо — по металлу
    } else if (typeId==='st_pump' || typeId==='st_comp') P.push(this.part(it, 'Трубопроводная обвязка и запорная арматура'));
    const c=P.find(p=>p.role==='container'); if (c && typeId==='st_pump'){ c.sys={ ...(c.sys||CONT_SYS_DEF), rec:false }; contApply(c); }   // насосы почти не греют — рекуперация не нужна
  }
  static part(it, name){ const p=kitNewPart({ name }); this.fill(p, it); return p; }
  /** новый элемент с узнаваемым названием — описание и строки характеристик (своё не перезаписывается) */
  static fill(p, it){
    const t=this.TEXT.find(([re])=>re.test(String(p.name||''))); if (!t) return p;
    if (!String(p.desc||'').trim()) p.desc=t[1];
    p.rows=p.rows||[]; for (const [k, v] of t[2]) if (!p.rows.some(r=>r.k===k)) p.rows.push({ k, v });
    if (this.FUEL.test(p.name) && !p.rows.some(r=>/объ[её]м/i.test(r.k))){ const kw=this.kw(it), v=this.tank(kw);
      p.rows.push({ k:'Объём', v:v+' л' }); if (kw) p.rows.push({ k:`Время работы ДГУ от бака при нагрузке ${Math.round(this.LOAD*100)} %`, v:'около '+Math.round(v/(kw*this.LOAD*this.LPH))+' ч' }); }
    return p;
  }
  static kw(it){ const d=kitParts(it).find(p=>StationEquip.kindOf(p)==='dgu'); return d ? StationEquip.num((d.attrs||{}).kw) : null; }
  /** объём бака, л: на hours ч работы при нагрузке 75 % (по умолчанию 16 ч, с баком ДГУ — около суток), ближайший типовой;
   *  больше типовых — с округлением до 500 л */
  static tank(kw, hours=16){ if (!(kw>0)) return 1000; const need=kw*this.LOAD*this.LPH*hours; return this.TANKS.find(v=>v>=need) || Math.ceil(need/500)*500; }
  /** бак станции — под время работы из требований (ТЗ): объём и строка «время работы». С расчётом станции (GensetSizing) —
   *  по расходу ДГУ на нагрузке из требований с запасом, за вычетом бака ДГУ (как в расчётной записке); без него — 75 %, 0,25 л/кВт·ч */
  static retank(it, hours){
    const p=kitParts(it).find(z=>this.FUEL.test(String(z.name||''))), t=p ? this.tankFor(it, hours) : null; if (!t) return null;
    p.rows=(p.rows||[]).filter(r=>!/^объ[её]м|^время работы/i.test(String(r.k||''))); p.rows.push(...t.rows);
    return t.v;
  }
  /** какой нужен бак на hours ч (без изменения состава): {v — л, rows — строки «Объём» и «Время работы»} или null */
  static tankFor(it, hours){
    const d=kitParts(it).filter(z=>StationEquip.kindOf(z)==='dgu' && z.role==='main');
    const res=Math.max(0, Math.round(StationReq.num(StationReq.of(it).reserve)||0)), kw=d.reduce((s, z)=>s+(StationEquip.num((z.attrs||{}).kw)||0)*Math.max(0, (+z.qty||1)-res), 0);
    if (!(kw>0) || !(hours>0)) return null;
    const fp=typeof GensetSizing!=='undefined' && StationRules.ok() ? GensetSizing.plan(it) : null;
    if (fp){ const L=Math.max(0, fp.need-fp.built), v=L>0 ? this.TANKS.find(t=>t>=L) || Math.ceil(L/500)*500 : this.TANKS[0];
      return { v, rows:[{ k:'Объём', v:v+' л' }, { k:`Время работы ДГУ от баков (с баком ДГУ) при нагрузке ${Math.round(fp.x*100)} %`, v:'около '+Math.floor((v+fp.built)/fp.c)+' ч' }] }; }
    const v=this.tank(kw, hours);
    return { v, rows:[{ k:'Объём', v:v+' л' }, { k:`Время работы ДГУ от бака при нагрузке ${Math.round(this.LOAD*100)} %`, v:'около '+Math.round(v/(kw*this.LOAD*this.LPH))+' ч' }] };
  }
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
  const docs=SupplyDocs.feature(x);   // станция: документы при поставке — последним блоком
  const calc=typeof StationCalc!=='undefined' ? StationCalc.docGroups(x) : [];   // приложение «Расчётная записка и состав станции»
  const pur=StationPurpose.feature(x);   // станция: связный текст назначения вместе с составом — вместо голого перечня
  return { ...x, page:true, spec:x.spec||('В составе: '+parts.map(p=>p.name.trim()).join(', ')).slice(0,200),
    features:[...(pur ? [pur] : []), ...(x.features||[]).filter(f=>f.label||f.text), ...(pur ? [] : [list]), ...feats, ...(docs ? [docs] : [])], groups:[...(x.groups||[]), ...groups, ...calc], gallery:[...(x.gallery||[]), ...gal] };
}

// состав для шаблона, умеющего сборки (feature 'kit'): элементы как есть (без закупки и поставщика) и описание изделия
// без разложенного состава — его шаблон показывает сам
function kitDocData(x){
  const parts=kitParts(x).filter(p=>String(p.name||'').trim()).map(p=>({id:p.id, name:p.name.trim(), qty:+p.qty||1, desc:String(p.desc||'').trim(),
    rows:(p.rows||[]).filter(r=>r.k&&r.v).map(r=>({k:r.k, v:r.v})), maker:(p.attrs&&p.attrs.maker)||'', model:(p.attrs&&p.attrs.model)||''}));
  const docs=SupplyDocs.feature(x);
  const calc=typeof StationCalc!=='undefined' ? StationCalc.docGroups(x) : [];   // приложение «Расчётная записка и состав станции»
  const pur=StationPurpose.feature(x, false);   // состав шаблон покажет сам
  return { parts, base:{ page:true, spec:x.spec||'', features:[...(pur ? [pur] : []), ...(x.features||[]).filter(f=>f.label||f.text), ...(docs ? [docs] : [])], groups:[...(x.groups||[]), ...calc], gallery:x.gallery||[] } };
}

// строки закупки для экономики сделки: элемент сборки — своя строка (своя валюта и поставщик); обычная позиция — как есть
function kitLines(st=S){
  const out=[];
  (st.items||[]).forEach((x,i)=>{ if (!String(x.name||'').trim() && !x.cost) return;
    if (!isKit(x)){ out.push({id:x.id, i, name:x.name, qty:+x.qty||0, cost:x.cost||0, costCur:x.costCur||'RUB', maker:attrsOf(x).maker||'', item:x}); return; }
    kitParts(x).forEach((p,j)=>{ if (!String(p.name||'').trim() && !p.cost) return;
      out.push({id:x.id+'~'+p.id, i, j, part:p, name:p.name||'Элемент', of:x.name, qty:(+x.qty||0)*(+p.qty||0), cost:p.cost||0, costCur:p.costCur||'RUB',
        maker:KitScope.sup(x, p)||(p.attrs&&p.attrs.maker)||'', item:{id:x.id+'~'+p.id, catId:p.catId||'', name:p.name, role:p.role||'', attrs:{...(p.attrs||{}), cat:(p.attrs&&p.attrs.cat)||attrsOf(x).cat}}}); }); });
  return out;
}

// груз для логистики: обычная позиция — как есть; сборка — элементами (каждый едет от своего поставщика).
// Характеристики элемента — его таблица (та же ссылка: габариты и масса, вписанные в логистике, сохраняются в элементе)
function kitCargo(st=S){
  return (st.items||[]).flatMap(x=>!isKit(x) ? [x] : kitParts(x).map(p=>{ p.rows=p.rows||[];
    return {id:x.id+'~'+p.id, name:`${p.name||'Элемент'} (${x.name})`, qty:(+x.qty||0)*(+p.qty||0), groups:[{name:p.name, rows:p.rows}], cost:p.cost, costCur:p.costCur||'RUB', price:0, catId:p.catId||''}; }));
}

// ---------- подбор по фильтрам категории: вид (если категорий несколько), производитель, списки и «от–до» по параметрам
// F = {cat, maker, q, f:{ключ: значение}, r:{ключ: [от, до]}, min:{ключ: не меньше}, test(x)}; cats — допустимые категории
// (null — все); min и test — подбор по нужному (KitNeed): давление не ниже компрессорного (без данных не отсекается)
const pfNew = cats => ({ cat:cats&&cats.length===1?cats[0]:'', maker:'', q:'', f:{}, r:{} });
// быстрый поиск в окне подбора: строка поиска карточки и ключ сортировки — один раз на карточку (каталог 7 500+ позиций
// перебирается на каждое нажатие), набор в поле поиска — с короткой задержкой, чтобы список не перерисовывался на каждую букву
class PickFind {
  static WAIT = 160;
  static hay(x, a){ if (x._pq!=null && CatAttrs.cards.has(x)) return x._pq;
    const h=norm([x.name, a.maker, a.model, a.series].join(' ')); if (CatAttrs.cards.has(x)) x._pq=h; return h; }
  static key(x){ const a=attrsOf(x); return numOf(a[typeById(a.cat).main||'kw'])??9e9; }
  static later(fn){ clearTimeout(this.t); this.t=setTimeout(fn, this.WAIT); }
}
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
  for (const [k,v] of Object.entries(F.min||{})){ const t=KitNeed.top(a[k]); if (t!=null && t<v-1e-9) return false; }
  if (F.test && !F.test(x)) return false;
  if (F.q.trim()){ const w=F._w && F._w.q===F.q ? F._w.w : (F._w={ q:F.q, w:norm(F.q).split(' ').filter(Boolean) }).w, hay=PickFind.hay(x, a); if (!w.every(v=>hay.includes(v))) return false; }
  return true;
}
function pfList(F, cats, lim=40){
  const res=pfPool(cats).filter(x=>pfMatch(x,F,cats)), K=new Map(res.map(x=>[x, PickFind.key(x)]));
  return { n:res.length, list:res.sort((p,q)=>K.get(p)-K.get(q)).slice(0,lim) };
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
const pfRow = (x, act, tag='', cls='') => `<button type="button" class="kit-pick${cls}" ${act}="${esc(x.id)}">${x.photo&&x.photo.src?`<img src="${esc(x.photo.src)}" alt="" loading="lazy" decoding="async">`:'<span class="kit-noimg"></span>'}<span>${tag}<b>${esc(x.name)}</b><small class="muted">${esc(typeById(attrsOf(x).cat).name)}${mainLine(x,3)?' · '+esc(mainLine(x,3)):''}${x.cost?' · закупка '+money(x.cost)+' '+(x.costCur||'RUB'):''}</small></span></button>`;

// выбор позиции каталога для элемента: cats — только эти категории (основное оборудование станции), role — роль элемента,
// preset — подбор по нужному (KitNeed, «Компоновка»): фильтры {f, r, min, test}, строка need («что нужно» — над списком, с
// кнопкой «Показать все»), рекомендуемый best {id, n} — первым; для нового элемента — строки характеристик rows и attrs
function kitPickCat(i, cats, role, name, preset, by){
  const d=$('#dlg'); d.classList.add('wide'); const F=pfNew(cats); if (name && !cats) F.q=name;
  const use=()=>{ if (!preset) return; Object.assign(F.f, preset.f||{}); for (const [k, v] of Object.entries(preset.r||{})) F.r[k]=[...v]; F.min={ ...(preset.min||{}) }; F.test=preset.test||null; };
  let all=false; use();
  const best=preset && preset.best ? catCache.find(x=>x.id===preset.best.id) : null;
  const newBtn=`<button class="btn" type="button" data-kitnew="1">+ Новый элемент${name?` «${esc(name)}»`:''}</button>`;
  const head=()=>preset && preset.need ? `<div class="pf-need${all ? ' all' : ''}"><span>${all ? 'Показаны все. Отметка «мало» — не подходит по нужному.' : '✓ '+esc(preset.need)}</span><button class="btn sm ghost" type="button" data-pfall>${all ? 'Только подходящие' : 'Показать все'}</button></div>` : '';
  // рекомендуемый — первым, даже если считан точнее фильтров (поправки производителя); поиск, вид и производитель — соблюдаем
  const top=()=>best && (all ? pfMatch(best, F, cats) : pfMatch(best, { ...F, f:{}, r:{}, min:{}, test:null }, cats));
  const list=()=>{ const r=pfList(F, cats, 60), L=top() ? [best, ...r.list.filter(x=>x.id!==best.id)] : r.list;
    const tag=x=>x===best ? `<span class="pf-best">★ Рекомендуем${preset.best.label ? ': '+esc(preset.best.label) : preset.best.n>1 ? `: ${preset.best.n} шт. параллельно` : ''}</span>` : all && preset && !KitNeed.fits(x, preset) ? '<span class="pf-low">мало</span>' : '';
    return `<p class="muted pf-n">Найдено: ${r.n}${r.n>60?' — показаны первые 60, уточните фильтры':''}</p>`+(L.map(x=>pfRow(x,'data-cid', tag(x), x===best ? ' best' : '')).join('')
    || `<div class="kit-none"><p>В каталоге нет подходящего${name?` для «${esc(name)}»`:''}.</p>${newBtn}<small class="muted">Элемент появится в составе — описание и характеристики заполните вручную или кнопкой «✨ ИИ».</small></div>`); };
  const draw=()=>{ $('#kitPN').innerHTML=head(); $('#kitPF').innerHTML=pfHtml(F, cats); $('#kitPL').innerHTML=list(); };
  d.innerHTML=`<div class="dlg-h"><h3>${role==='main'?esc(stationOf(S.items[i]).mainLabel)+' — подбор в каталоге':name?esc(name)+' — подбор в каталоге':'Элемент из каталога'}</h3>${newBtn}<button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
    <div class="dlg-b"><div id="kitPN"></div><div id="kitPF"></div><div class="kit-pl" id="kitPL"></div></div>`;
  d.showModal(); d.querySelector('[data-close]').onclick=()=>d.close(); draw();
  if (!preset) setTimeout(()=>d.querySelector('[data-pf="q"]')?.focus(), 30);
  const onF=e=>{ const el=e.target.closest('[data-pf]'); if (!el) return; const re=pfSet(F, el);
    if (re){ draw(); } else $('#kitPL').innerHTML=list(); };
  $('#kitPF').oninput=e=>{ if (e.target.tagName!=='INPUT') return; if (e.target.dataset.pf==='q') PickFind.later(()=>d.open && onF(e)); else onF(e); }; $('#kitPF').onchange=e=>{ if (e.target.tagName==='SELECT') onF(e); };
  d.querySelector('.dlg-h [data-kitnew]').onclick=()=>kitPickNew();
  // подбор по рекомендации: количество (рекомендуемый — сколько нужно параллельно, иначе preset.qty) и замена прежних
  // элементов (preset.replace — их id: осушитель меньше нужного, ресиверы на учёте → несколько меньших)
  const put=(it, p, id)=>{ const n=best && id===best.id ? preset.best.n : preset && preset.qty; if (n>1) p.qty=n;
    if (preset && preset.grade) p.airGrade=preset.grade;   // фильтр подобран под ступень («Нужно: пылевой…») — на своё место в цепочке
    if (preset && preset.role) p.recvRole=preset.role;   // ресивер: основной (сухой), мокрый или у потребителя — по методике
    if (preset && Array.isArray(preset.replace)) it.kit.parts=it.kit.parts.filter(z=>!preset.replace.includes(z.id)); };
  const kitPickNew=()=>{ const it=S.items[i]; it.kit=it.kit||{parts:[]}; const p=StationDefaults.fill(kitNewPart({name:name||(F.q||'').trim()}), it); if (role) p.role=role;
    if (preset){ if (preset.attrs) p.attrs=Object.fromEntries(Object.entries(preset.attrs).filter(([, v])=>v!=null && v!=='')); for (const r of preset.rows||[]) if (!p.rows.some(z=>z.k===r.k)) p.rows.push({ ...r }); }
    if (by && by!==KitScope.def(p)) p.by=by;
    put(it, p); it.kit.parts.push(p); it.page=true; d.close(); renderForm(); persist(); toast('Элемент добавлен — описание и характеристики: вручную или кнопкой «✨ ИИ»'); };
  // «Показать все» — без фильтров по нужному (неподходящие — с отметкой «мало»), «Только подходящие» — вернуть фильтры
  $('#kitPN').onclick=e=>{ if (!e.target.closest('[data-pfall]')) return; all=!all; if (all){ F.f={}; F.r={}; F.min={}; F.test=null; F.maker=''; } else use(); draw(); };
  $('#kitPL').onclick=async e=>{ if (e.target.closest('[data-kitnew]')) return kitPickNew(); const b=e.target.closest('[data-cid]'); if (!b) return; const lite=catCache.find(x=>x.id===b.dataset.cid);
    let doc=lite; try{ doc=await api('/api/catalog/'+encodeURIComponent(lite.id)); }catch(_){}
    const it=S.items[i]; it.kit=it.kit||{parts:[]}; const p=KitPart.fromCat(doc); if (role) p.role=role; if (by && by!==KitScope.def(p)) p.by=by;
    put(it, p, lite.id);
    if (role==='main'){ const ix=it.kit.parts.findIndex(z=>z.role==='container'); it.kit.parts.splice(ix>=0?ix:0, 0, p); } else it.kit.parts.push(p);
    kitSync(it); stationFill(it); stationAutoName(it); if (typeof StationUi!=='undefined') StationUi.cache.delete(it.id);
    d.close(); renderForm(); persist(); toast((preset && preset.replace ? 'Заменено: ' : 'Добавлено в состав: ')+(+p.qty>1 ? p.qty+' × ' : '')+doc.name); };
}

// действия вкладки «Состав» (вызываются из общего обработчика кнопок data-a)
function kitAction(a, i, b){
  const it=S.items[i]; if (!it) return false; it.kit=it.kit||{parts:[]}; const P=it.kit.parts, j=+b.dataset.j;
  if (a==='kitAdd'){ const p=kitNewPart({name:b.dataset.n||''}); if (b.dataset.role) p.role=b.dataset.role; const by=b.dataset.by; if (by && by!==KitScope.def(p)) p.by=by;
    P.push(p); KitView.open.add(p.id); it.page=true; return true; }
  if (a==='kitCat'){ kitPickCat(i, null, null, '', null, b.dataset.by); return 'async'; }
  if (a==='kitPreset'){ const c=b.dataset.cat; kitPickCat(i, c&&TYPES.some(t=>t.id===c)?[c]:null, null, b.dataset.n, c ? KitNeed.presetFor(it, c) : null, b.dataset.by); return 'async'; }
  if (a==='kitMain'){ kitPickCat(i, (stationOf(it)||{}).main, 'main', '', KitNeed.mainPreset(it)); return 'async'; }
  if (a==='kitSys'){ const p=P[j], id=b.dataset.sys; p.sys={...(p.sys||CONT_SYS_DEF)}; p.sys[id]=!KitView.sysOn(it, p, id); contApply(p); return true; }
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
  if (t.dataset.kitpp!=null){ KitPipe.change(t); return; }
  if (t.dataset.kitcab!=null){ KitCabinet.change(t); return; }
  if (t.dataset.kitct!=null){ const [i,j]=t.dataset.kitct.split('.').map(Number), it=S.items[i], p=kitParts(it)[j]; if (!p) return;
    const o={[t.dataset.fld]:t.value}; if (t.dataset.fld==='ctype'){ const c=ctypeOf(t.value); if (c.ins) o.ins=c.ins; if (c.climate) o.climate=c.climate; if (p.sizeAuto) o.size=''; }
    if (t.dataset.fld==='size') o.sizeAuto=!String(t.value).trim();     // вписан свой размер — подбор по оборудованию отключается
    contApply(p, o); StationSize.apply(it); stationFill(it); stationAutoName(it); renderForm(); persist(); return; }
  if (t.dataset.kitcur!=null){ const [i,j]=t.dataset.kitcur.split('.').map(Number), it=S.items[i], p=kitParts(it)[j]; if (!p) return;
    p.costCur=t.value; if (t.value!=='RUB' && !(rateOf(t.value)>0)) loadCBR(); kitSync(it); renderForm(); persist(); if (typeof dealRender==='function') dealRender(); return; }
  if (/^items\.\d+\.kit\.parts\.\d+\.qty$/.test(t.dataset.p||'')){ const it=S.items[+t.dataset.p.split('.')[1]]; kitSync(it); renderForm(); persist(); } });
