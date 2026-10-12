// Компоновка станции в контейнере (состав станции — kit.js): расстановка оборудования вдоль стен с проходом обслуживания,
// проверка длины, ширины и высоты, подбор размера блок-контейнера или другого контейнера, цвета и габариты из
// характеристик. Без DOM — проверяется node-тестом (tests/js/station_layout.js); системы контейнера (пожарная безопасность,
// освещение, розетки, нагрузки) — station-systems.js, чертёж и 3D-вид — station-draw.js, вкладка «Компоновка» и картинки для
// КП — station-ui.js.
//
// Координаты — внутри контейнера, мм: x — вдоль контейнера от торца с дверью (0) к дальнему торцу, y — поперёк: от стены
// прохода (0; вдоль неё проход обслуживания, в ней дверь) к задней стене, z — от пола вверх.
'use strict';

// ---------------------------------------------------------------- цвет: RAL и названия цветов
class RalColor {
  // RAL Classic → RGB (215 цветов; значения — по открытому списку ral-colors, лицензия MIT)
  static T = {
    1000:'CDBA88',1001:'D0B084',1002:'D2AA6D',1003:'F9A800',1004:'E49E00',1005:'CB8E00',1006:'E29000',1007:'E88C00',1011:'AF804F',1012:'DDAF27',1013:'E3D9C6',1014:'DDC49A',
    1015:'E6D2B5',1016:'F1DD38',1017:'F6A950',1018:'FACA30',1019:'A48F7A',1020:'A08F65',1021:'F6B600',1023:'F7B500',1024:'BA8F4C',1026:'FFFF00',1027:'A77F0E',1028:'FF9B00',
    1032:'E2A300',1033:'F99A1C',1034:'EB9C52',1035:'908370',1036:'80643F',1037:'F09200',2000:'DD7907',2001:'BE4E20',2002:'C63927',2003:'FA842B',2004:'E75B12',2005:'FF2300',
    2007:'FFA421',2008:'F3752C',2009:'E15501',2010:'D4652F',2011:'EC7C25',2012:'DB6A50',2013:'954527',2017:'FA4402',3000:'AB2524',3001:'A02128',3002:'A1232B',3003:'8D1D2C',
    3004:'701F29',3005:'5E2028',3007:'402225',3009:'703731',3011:'7E292C',3012:'CB8D73',3013:'9C322E',3014:'D47479',3015:'E1A6AD',3016:'AC4034',3017:'D3545F',3018:'D14152',
    3020:'C1121C',3022:'D56D56',3024:'F70000',3026:'FF0000',3027:'B42041',3028:'E72512',3031:'AC323B',3032:'711521',3033:'B24C43',4001:'8A5A83',4002:'933D50',4003:'D15B8F',
    4004:'691639',4005:'83639D',4006:'992572',4007:'4A203B',4008:'904684',4009:'A38995',4010:'C63678',4011:'8773A1',4012:'6B6880',5000:'384C70',5001:'1F4764',5002:'2B2C7C',
    5003:'2A3756',5004:'1D1F2A',5005:'154889',5007:'41678D',5008:'313C48',5009:'2E5978',5010:'13447C',5011:'232C3F',5012:'3481B8',5013:'232D53',5014:'6C7C98',5015:'2874B2',
    5017:'0E518D',5018:'21888F',5019:'1A5784',5020:'0B4151',5021:'07737A',5022:'2F2A5A',5023:'4D668E',5024:'6A93B0',5025:'296478',5026:'102C54',6000:'327662',6001:'28713E',
    6002:'276235',6003:'4B573E',6004:'0E4243',6005:'0F4336',6006:'40433B',6007:'283424',6008:'35382E',6009:'26392F',6010:'3E753B',6011:'68825B',6012:'31403D',6013:'797C5A',
    6014:'444337',6015:'3D403A',6016:'026A52',6017:'468641',6018:'48A43F',6019:'B7D9B1',6020:'354733',6021:'86A47C',6022:'3E3C32',6024:'008754',6025:'53753C',6026:'005D52',
    6027:'81C0BB',6028:'2D5546',6029:'007243',6032:'0F8558',6033:'478A84',6034:'7FB0B2',6035:'1B542C',6036:'005D4C',6037:'25E712',6038:'00F700',7000:'7E8B92',7001:'8F999F',
    7002:'817F68',7003:'7A7B6D',7004:'9EA0A1',7005:'6B716F',7006:'756F61',7008:'746643',7009:'5B6259',7010:'575D57',7011:'555D61',7012:'596163',7013:'555548',7015:'51565C',
    7016:'373F43',7021:'2E3234',7022:'4B4D46',7023:'818479',7024:'474A50',7026:'374447',7030:'939388',7031:'5D6970',7032:'B9B9A8',7033:'818979',7034:'939176',7035:'CBD0CC',
    7036:'9A9697',7037:'7C7F7E',7038:'B4B8B0',7039:'6B695F',7040:'9DA3A6',7042:'8F9695',7043:'4E5451',7044:'BDBDB2',7045:'91969A',7046:'82898E',7047:'CFD0CF',7048:'888175',
    8000:'887142',8001:'9C6B30',8002:'7B5141',8003:'80542F',8004:'8F4E35',8007:'6F4A2F',8008:'6F4F28',8011:'5A3A29',8012:'673831',8014:'49392D',8015:'633A34',8016:'4C2F26',
    8017:'44322D',8019:'3F3A3A',8022:'211F20',8023:'A65E2F',8024:'79553C',8025:'755C49',8028:'4E3B2B',8029:'773C27',9001:'EFEBDC',9002:'DDDED4',9003:'F4F8F4',9004:'2E3032',
    9005:'0A0A0D',9006:'A5A8A6',9007:'8F8F8C',9010:'F7F9EF',9011:'292C2F',9012:'FFFDE6',9016:'F7FBF5',9017:'2A2D2F',9018:'CFD3CD',9022:'9C9C9C',9023:'7E8182'
  };
  static NAMED = [[/красн/, '#B3261E'], [/оранж/, '#E2711D'], [/ж[её]лт/, '#E8B21A'], [/з[её]л[её]н/, '#2E7D4F'], [/голуб/, '#4A90C8'],
    [/син/, '#1E4D8C'], [/фиолет/, '#5B3E8C'], [/коричн/, '#6B4A2F'], [/ч[её]рн/, '#2A2D30'], [/бел/, '#F1F2F0'],
    [/серебр|алюмин|нерж|оцинк|металлик/, '#B9BEC3'], [/графит|антрацит/, '#3B4045'], [/сер/, '#8E959C'], [/беж/, '#D8C8A8']];

  /** цвета RAL в тексте: «RAL 7004 / RAL 5005», «RAL7004/5005» → [{code:'RAL 7004', hex}, {code:'RAL 5005', hex}] */
  static codes(text){
    const s=String(text||''), i=s.search(/RAL/i); if (i<0) return [];
    return [...s.slice(i).matchAll(/(?:^|\D)(\d{4})(?!\d)/g)].map(m=>m[1]).filter(c=>this.T[c]).map(c=>({code:'RAL '+c, hex:'#'+this.T[c]}));
  }
  static named(text){ const s=String(text||'').toLowerCase(), m=this.NAMED.find(([re])=>re.test(s)); return m ? m[1] : null; }
  static rgb(hex){ const n=parseInt(String(hex).replace('#',''), 16); return [n>>16&255, n>>8&255, n&255]; }
  static hex(r, g, b){ return '#'+[r, g, b].map(v=>Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
  /** k < 1 — темнее, k > 1 — светлее (к белому) */
  static shade(hex, k){ const c=this.rgb(hex); return k<=1 ? this.hex(...c.map(v=>v*k)) : this.hex(...c.map(v=>v+(255-v)*Math.min(1, k-1))); }
  static mix(a, b, t){ const x=this.rgb(a), y=this.rgb(b); return this.hex(...x.map((v, i)=>v+(y[i]-v)*t)); }
  /** яркость 0…1 — подпись на цвете: тёмная или светлая */
  static light(hex){ const [r, g, b]=this.rgb(hex); return (0.299*r+0.587*g+0.114*b)/255; }
}

// ---------------------------------------------------------------- контейнер: наружные и внутренние размеры, двери
class StationGeo {
  // морские контейнеры ISO 668: наружные размеры; внутренние и проём дверей — типовые у производителей, мм
  static SEA = {
    sea10:   { ext:[2991, 2438, 2591],  int:[2831, 2352, 2393],  door:[2340, 2280], label:'10 футов' },
    sea20:   { ext:[6058, 2438, 2591],  int:[5898, 2352, 2393],  door:[2340, 2280], label:'20 футов' },
    sea20hc: { ext:[6058, 2438, 2896],  int:[5898, 2352, 2698],  door:[2340, 2585], label:'20 футов HC' },
    sea40:   { ext:[12192, 2438, 2591], int:[12032, 2352, 2393], door:[2340, 2280], label:'40 футов' },
    sea40hc: { ext:[12192, 2438, 2896], int:[12032, 2352, 2698], door:[2340, 2585], label:'40 футов HC' },
  };
  static SEA_ORDER = ['sea10', 'sea20', 'sea20hc', 'sea40', 'sea40hc'];
  static LINING = 15;        // обшивка морского контейнера поверх утеплителя, мм
  static SEA_FLOOR = 50;     // утеплённый пол поверх штатного, мм
  // блок-контейнеры «по проекту»: к утеплителю стены — обшивка и каркас, пол и кровля — строительная высота, мм;
  // «Север» — с тамбуром у двери (перегородка с дверью: в тамбуре оборудование не ставится)
  static FLEX = { block:{ wall:20, floor:150, roof:60 }, welded:{ wall:10, floor:160, roof:60 }, north:{ wall:20, floor:200, roof:80, tambour:1200 } };
  // блок-контейнер — по необходимому месту, без запаса: размеры с шагом 100 мм; не меньше 2000 × 1500 × 2000; внутри с
  // проходом обслуживания — не ниже 2100 (проход в полный рост); шире 2550 — негабарит при перевозке (ПП РФ от
  // 21.12.2020 № 2200), до 3500
  static STEP = 100;
  static BLOCK = { minL:2000, minW:1500, minH:2000, hWalk:2100, maxW:3500, maxH:3200 };
  static ROAD_W = 2550;      // шире — негабарит при перевозке
  /** вверх до шага (размеры блок-контейнера) */
  static up(v){ return Math.ceil(v/this.STEP-1e-9)*this.STEP; }

  /** «6000 × 2400 × 2500 мм», «6 × 2,4 × 2,5 м», «6000x2400x2500» → [6000, 2400, 2500]; иначе null */
  static mm(text){
    const s=String(text||'').replace(/(\d)\s+(?=\d{3}\b)/g, '$1').replace(/[хxХX*]/g, '×');
    const m=s.match(/(\d+(?:[.,]\d+)?)\s*×\s*(\d+(?:[.,]\d+)?)\s*×\s*(\d+(?:[.,]\d+)?)/); if (!m) return null;
    let a=[m[1], m[2], m[3]].map(v=>parseFloat(v.replace(',', '.')));
    if (Math.max(...a)<40) a=a.map(v=>v*1000); else if (/см/.test(s)) a=a.map(v=>v*10);
    a=a.map(Math.round);
    return a.every(v=>v>=500 && v<=30000) ? a : null;
  }
  static ins(text){ const n=parseFloat(String(text||'').replace(',', '.')); return n>0 && n<400 ? n : 100; }
  // крыша блок-контейнера: плоская или скатная — двускатная (конёк вдоль контейнера) или односкатная (выше у задней стены);
  // уклон, ° — подъём над стенами (у морского контейнера крыша штатная, плоская)
  static ROOFS = { flat:{ name:'плоская', deg:0 }, gable:{ name:'двускатная', deg:8 }, mono:{ name:'односкатная', deg:5 }, arch:{ name:'арочная (покатая)', deg:0, k:0.075 } };
  static roof(c){ const r=String((c && c.roof) || ''); return c && this.SEA[c.ctype] ? 'flat' : this.ROOFS[r] ? r : 'flat'; }
  /** подъём крыши над стенами, мм: двускатная — до конька посередине, односкатная — у стены с дверью, арочная — дуга */
  static rise(roof, W){ const R=this.ROOFS[roof]||this.ROOFS.flat, d=R.deg*Math.PI/180;
    return Math.round(roof==='gable' ? W/2*Math.tan(d) : roof==='mono' ? W*Math.tan(d) : roof==='arch' ? W*R.k : 0); }
  // пол: рифлёный стальной лист (окраска чёрная) или рифлёный алюминиевый лист без окраски; в характеристиках — строка «Пол»
  static FLOORS = { steel:{ name:'рифлёный стальной лист, окраска чёрная', short:'сталь рифлёная, чёрная', color:'#26292c', m:0.25, r:0.55 },
    alu:{ name:'рифлёный алюминиевый лист без окраски', short:'алюминий рифлёный', color:'#c9cdd2', m:1, r:0.3 } };
  static floor(c){ const f=String((c && c.floor) || ''); if (this.FLOORS[f]) return f;
    const r=((c && c.rows) || []).find(q=>q && /^пол(?![а-яё])/i.test(String(q.k||'').trim())); return r && /алюмин/i.test(String(r.v||'')) ? 'alu' : 'steel'; }
  static flex(type){ return this.FLEX[type] || (this.SEA[type] ? null : this.FLEX.block); }

  /** внутренние размеры по наружным: морской — штатные стенки + утепление, блок-контейнер — стены, пол и кровля */
  static inner(type, ext, t){
    const sea=this.SEA[type];
    if (sea){ const d=sea.ext.map((v, i)=>v-sea.int[i]), k=t+this.LINING;
      return [ext[0]-d[0]-2*k, ext[1]-d[1]-2*k, ext[2]-d[2]-k-this.SEA_FLOOR]; }
    const f=this.flex(type);
    return [ext[0]-2*(t+f.wall), ext[1]-2*(t+f.wall), ext[2]-f.floor-(t+f.roof)];
  }
  /** наружные размеры по внутренним (подбор блок-контейнера) */
  static outer(type, int, t){ const f=this.flex(type); return [int[0]+2*(t+f.wall), int[1]+2*(t+f.wall), int[2]+f.floor+t+f.roof]; }

  /** c — элемент «контейнер» состава: {ctype, size, sizeAuto, ins}. auto — размер подбирается (блок-контейнер без своего размера) */
  static of(c){
    const type=c.ctype || 'block', t=this.ins(c.ins), sea=this.SEA[type], own=!c.sizeAuto ? this.mm(c.size) : null, f=this.flex(type);
    const ext=own || (sea ? sea.ext.slice() : null);
    return { type, t, sea:!!sea, own:!!own, auto:!ext, ext, int:ext ? this.inner(type, ext, t) : null, x0:(f && f.tambour) || 0,
      door: sea ? sea.door : null, roof:this.roof(c), floor:this.floor(c) };
  }
  /** высота пола внутри над низом контейнера, мм (морской: штатный пол + утеплённый, блок-контейнер — основание) */
  static zFloor(type, t){ const sea=this.SEA[type]; return sea ? (sea.ext[2]-sea.int[2]-40)+this.SEA_FLOOR : this.flex(type).floor; }
}

// ---------------------------------------------------------------- отступы
// [рекомендуется, не менее], мм. Внутри контейнера шириной около 2,1 м нормы машинных залов (1–1,5 м со всех сторон)
// невыполнимы, поэтому два уровня: «рекомендуется» — цель, «не менее» — меньше нельзя (иначе — другой контейнер).
// Источники:
// • проход обслуживания 1000 / 800 — руководства производителей винтовых компрессоров (не менее 1 м для обслуживания);
//   ПУЭ, п. 4.1.23 — проход обслуживания в свету не менее 0,8 м (настраивается: «Умолчания → Станции в контейнере»);
// • между агрегатами 700 — СП 30.13330.2020, п. 13.22, и СНиП 2.04.02-84: между неподвижными выступающими частями 0,7 м;
//   не менее 300 (≈ 1 фут) — для осмотра и подхода с инструментом;
// • компрессор: сзади 600 (≈ 2 фута: руководства по компрессорным помещениям) / 300; над ним в помещении — 1 м до
//   потолка (руководства производителей), в контейнере горячий воздух отводят воздуховодом — не менее 300;
// • осушитель: около 500 вокруг (руководства производителей; Hankison — 950 спереди и сзади, 650 сверху) / 150 сзади;
// • ресивер: 300 от стен и препятствий (12 дюймов — 522 CMR 7.03, Массачусетс), доступ к крану слива и люку;
// • насосы: 1000 между агрегатами / 250 — для агрегатов с патрубком до DN 100 на общей раме (СП 30.13330.2020, п. 13.22);
// • ДГУ: со стороны генератора 1000 / 800 (Cummins — не менее 3 футов вокруг), радиатор — к жалюзи в торце 300 / 150;
//   проход вдоль ДГУ — не менее 600 (ПУЭ, п. 4.1.23: сужение прохода до 0,6 м; в контейнере ДГУ занимает почти всю ширину);
// • магистральные фильтры и сепараторы — на трубопроводе: висят на линии сжатого воздуха после осушителя (места на полу
//   не занимают);
// • шкафы управления: спереди — проход обслуживания (ПУЭ, п. 4.1.23), сзади и сбоку можно вплотную; настенные — на стене
//   прохода напротив оборудования, проход перед ними — не уже 0,6 м (там же: сужение выступающими частями).
class StationClear {
  static get KIND(){ return StationRules.raw('clear.kind'); }   // из файла инженерных правил (группа «Компоновка»)
  // насосы — СП 31.13330.2021, п. 10.15: между агрегатами 1 м; малые (до 1000 В, нагнетательный патрубок до DN 100 —
  // здесь: до 22 кВт и до 1,2 м длиной) можно ставить у стены и по два на общей раме без прохода, вокруг — 0,7 м
  static PUMP_SMALL = { back:[300, 100], side:[700, 250], top:[300, 100] };
  /** отступы для оборудования: вид и (для насосов) мощность и размер */
  static of(kind, e){
    if (kind==='pump' && e && !(e.kw>22) && Math.max(e.l||0, e.w||0)<=1200) return this.PUMP_SMALL;
    return this.KIND[kind] || this.KIND.other;
  }
  /** проход обслуживания [рекомендуется, не менее] — из «Умолчаний» администратора */
  static aisle(){
    const D=(k, fb)=>typeof DEFN==='function' ? DEFN(k, fb) : fb;
    const A=StationRules.raw('norm.aisle'), rec=Math.max(500, Math.min(3000, D('st.aisle', A[0]))), min=Math.max(500, Math.min(rec, D('st.aisleMin', A[1])));
    return [rec, min];
  }
}

// ---------------------------------------------------------------- матрица расстановки
// Значения и формулы расстановки — правило layout.matrix файла инженерных правил (правится в «Настройках → Инженерные
// правила станций», таблица «Матрица расстановки»); в своей версии файла администратора правила может не быть — тогда
// значения по умолчанию (те же, что в файле поставки). Решение ПНЕВМОТЕХ 12.10: полезные размеры = внутренние − 2·G;
// между агрегатами и от стены — max(база, коэф · размер); вплотную друг к другу — только ресиверы и фильтры; доступ к
// сторонам агрегата; торцевые и сервисные ворота, дверь оператора, выходы.
class StationMatrix {
  static DEF = {
    gap:{ v:50 },
    pair:{ rows:[
      { a:'compressor', b:'compressor', base:1000, k:0.3, of:'compressor.w', min:700 },
      { a:'compressor', b:'dryer', base:800, k:0.5, of:'dryer.w', min:600 },
      { a:'dryer', b:'receiver', base:700, k:0.5, of:'receiver.w', min:500 },
      { a:'compressor', b:'receiver', base:700, k:0.5, of:'receiver.w', min:500 },
      { a:'receiver', b:'receiver', base:300, k:0.4, of:'receiver.w', min:300, close:true },
      { a:'filter', b:'filter', base:300, k:0, of:'', min:150, close:true },
      { a:'dryer', b:'dryer', base:800, k:0.5, of:'dryer.w', min:600 }] },
    wall:{ rows:[
      { kind:'compressor', base:500, k:0.4, tight:100 }, { kind:'dryer', base:300, k:0.4, tight:150 }, { kind:'receiver', base:300, k:0, tight:300 },
      { kind:'pump', base:300, k:0.4, tight:100 }, { kind:'other', base:300, k:0.4, tight:100 }] },
    access:{ back:500, side:600 },
    sides:{ rows:[{ kind:'compressor', s:'ФЗЛП' }, { kind:'dryer', s:'Ф' }, { kind:'receiver', s:'Ф' }, { kind:'pump', s:'ФЛП' }, { kind:'dgu', s:'ФЛП' },
      { kind:'cabinet', s:'Ф' }, { kind:'other', s:'Ф' }, { kind:'tank', s:'Ф' }] },
    rotate:{ rows:[{ kind:'compressor', on:true }, { kind:'dryer', on:true }, { kind:'receiver', on:true }, { kind:'pump', on:true }, { kind:'other', on:true },
      { kind:'dgu', on:false }, { kind:'cabinet', on:false }] },
    gate:{ addW:200, addH:200, full:0.75, twoAt:8000, minW:1500 },
    service:{ addW:200, addH:200 },
    door:{ w:900, h:2000 },
    aisle:{ service:600, mountAdd:200 },
    exits:{ n:2, dist:5000 },
    exhaust:{ louvre:300 },
  };
  /** матрица: из правил (недостающее — по умолчанию) */
  static get M(){ const v=typeof StationRules!=='undefined' && StationRules.ok() ? StationRules.opt('layout.matrix') : null, D=this.DEF;
    if (!v || typeof v!=='object') return D;
    const o={}; for (const k of Object.keys(D)) o[k]=v[k] && typeof v[k]==='object' ? { ...D[k], ...v[k] } : D[k];
    return o; }
  static num(v, d){ const n=+v; return Number.isFinite(n) ? n : d; }
  static gap(){ return Math.max(0, Math.min(150, this.num(this.M.gap.v, 50))); }
  /** размер «of» для пары: 'receiver.w' — ширина (диаметр) ресивера из пары (больший), '' — нет */
  static dim(of, a, b){ const [k, f]=String(of||'').split('.'); if (!k) return 0;
    return Math.max(0, ...[a, b].filter(e=>e && e.kind===k).map(e=>+(f==='l' ? e.l : f==='h' ? e.h : e.pairD || e.w)||0)); }
  /** между соседями a и b по длине: [рекомендуется, не менее, крайний случай (вплотную — только где допускается)] или
   *  null — правила для этой пары нет */
  static pair(a, b){
    const r=(this.M.pair.rows||[]).find(q=>(q.a===a.kind && q.b===b.kind) || (q.a===b.kind && q.b===a.kind)); if (!r) return null;
    const rec=Math.round(Math.max(this.num(r.base, 0), this.num(r.k, 0)*this.dim(r.of, a, b))), mn=Math.min(rec, Math.max(0, this.num(r.min, rec)));
    return [rec, mn, r.close ? 0 : mn];
  }
  /** от стены за агрегатом e: [рекомендуется, «плотно»] или null — правила для вида нет */
  static wall(e){ const r=(this.M.wall.rows||[]).find(q=>q.kind===e.kind) || (e.kind==='pump' || e.kind==='compressor' || e.kind==='dryer' || e.kind==='receiver' ? null : (this.M.wall.rows||[]).find(q=>q.kind==='other'));
    if (!r) return null; const rec=Math.round(Math.max(this.num(r.base, 0), this.num(r.k, 0)*(+e.w||0))); return [rec, Math.min(rec, Math.max(0, this.num(r.tight, rec)))]; }
  static access(){ const a=this.M.access; return { back:this.num(a.back, 500), side:this.num(a.side, 600) }; }
  /** обслуживаемые стороны вида: {F, B, L, R} (фронт, зад, бока по длине) */
  static sides(kind){ const r=(this.M.sides.rows||[]).find(q=>q.kind===kind) || (this.M.sides.rows||[]).find(q=>q.kind==='other'), s=String((r && r.s) || 'Ф').toUpperCase();
    return { F:/Ф/.test(s), B:/З/.test(s), L:/Л/.test(s), R:/П/.test(s) }; }
  static rot(kind){ const r=(this.M.rotate.rows||[]).find(q=>q.kind===kind); return r ? r.on!==false : !/^(dgu|cabinet)$/.test(kind); }
  static gate(){ const g=this.M.gate; return { addW:this.num(g.addW, 200), addH:this.num(g.addH, 200), full:this.num(g.full, 0.75), twoAt:this.num(g.twoAt, 8000), minW:this.num(g.minW, 1500) }; }
  static service(){ const g=this.M.service; return { addW:this.num(g.addW, 200), addH:this.num(g.addH, 200) }; }
  static door(){ const d=this.M.door; return { w:Math.max(900, this.num(d.w, 900)), h:Math.max(2000, this.num(d.h, 2000)) }; }
  static aisle(){ const a=this.M.aisle; return { service:this.num(a.service, 600), mountAdd:this.num(a.mountAdd, 200) }; }
  static exits(){ const x=this.M.exits; return { n:Math.max(1, this.num(x.n, 2)), dist:this.num(x.dist, 5000) }; }
  static louvre(){ return Math.max(200, this.num(this.M.exhaust.louvre, 300)); }
}

// ---------------------------------------------------------------- материал трубопровода
// Трубопроводная обвязка станции: сталь, нержавеющая сталь или полипропилен — поле «Материал» в составе (KitPipe)
// или слова в характеристиках и названии; цвет — для чертежа и 3D-вида.
class PipeMaterial {
  static LIST = [
    { id:'steel', name:'Сталь', row:'сталь (трубы стальные по ГОСТ 10704, окраска)', color:'#59636e' },
    { id:'inox', name:'Нержавеющая сталь', row:'нержавеющая сталь AISI 304 (08Х18Н10)', color:'#b3bdc7' },
    { id:'pp', name:'Полипропилен', row:'полипропилен PP-R (ГОСТ 32415)', color:'#5d9c6b' },
  ];
  static ROW = 'Материал трубопровода';
  static DN_ROW = 'Условный проход';
  // опознавательная окраска (ГОСТ 14202-69, табл. 1): воздух — синий, вода — зелёный, горючие жидкости (топливо) —
  // коричневый; по умолчанию трубы сжатого воздуха — синие, со стрелками направления потока
  static ID = { air:'#1f5aa6', in:'#3b7d3d', out:'#3b7d3d', fuel:'#6e4426' };
  /** цвет трубы среды medium: опознавательный, иначе — цвет материала fallback */
  static idColor(medium, fallback){ return this.ID[medium] || fallback; }
  /** направление потока по линии: 1 — к концу x1 (выход через дальний торец, топливо — от бака к ДГУ), -1 — к началу
   *  (вход насосов — с улицы); у коллектора компрессоров — к входу первого аппарата (to) */
  static flow(l, x){ if (l.header && l.to!=null) return x<l.to ? 1 : -1; return l.medium==='in' ? -1 : 1; }
  static get(id){ return this.LIST.find(m=>m.id===id) || null; }
  /** материал элемента: выбранный в составе, иначе по строкам «Материал…» и названию; не понятно — null */
  static of(p){
    if (!p) return null;
    if (this.get(p.pipeMat)) return this.get(p.pipeMat);
    const t=[...(p.rows||[]).filter(r=>r && /материал|исполнен|труб/i.test(String(r.k||''))).map(r=>r.v), p.name, p.desc].map(v=>String(v||'')).join(' ').toLowerCase();
    if (/нерж|aisi|08х18|12х18/.test(t)) return this.get('inox');
    if (/полипроп|pp-?r|ппр/.test(t)) return this.get('pp');
    if (/стал|гост 10704|гост 3262|ст\.?\s?20/.test(t)) return this.get('steel');
    return null;
  }
  /** условный проход: поле DN или строка «Условный проход» / «Диаметр» */
  static dn(p){
    const v=String((p && p.dn) || ((p && p.rows) || []).filter(r=>r && /условн\S* проход|диаметр|\bDN\b|(?:^|[^а-яё])Ду(?![а-яё])/i.test(String(r.k||''))).map(r=>r.v)[0] || '').trim();
    const m=v.match(/\d{2,4}/); return m ? 'DN '+m[0] : '';
  }
}

// ---------------------------------------------------------------- оборудование из состава
class StationEquip {
  // вид оборудования: по категории каталога, иначе по названию элемента
  static KINDS = [
    ['compressor', /^(comp_|blower$)/, /компрессор|воздуходувк/i],
    ['dryer', /^(dryer_|gen_n2$|gen_o2$)/, /осушител|генератор азота|генератор кислорода/i],
    ['receiver', /^receiver$/, /ресивер|воздухосборник/i],
    ['filter', /^(filter|oil_sep)$/, /фильтр|сепаратор|циклон/i],
    ['dgu', /^dgu$/, /дизель-?генератор|(?:^|[^а-яё])(?:ДГУ|ДЭС)(?![а-яё])|генераторн\S* установ/i],
    ['pump', /^pump$/, /насос|мотопомп/i],
    ['cabinet', /^ats$/, /шкаф|щит|(?:^|[^а-яё])АВР(?![а-яё])|пульт/i],
    ['tank', null, /бак|[её]мкост/i],
  ];
  static CABINET = /шкаф|щит|(?:^|[^а-яё])АВР(?![а-яё])|пульт/i;   // кириллица: \b в JavaScript её не видит
  static CAB_FLOOR = /напольн/i;
  static CAB_WALL = /настенн|навесн|на стене/i;
  static CHASSIS = /шасси|прицеп/i;
  static MUFFLER = /глушител/i;
  static PIPING = /трубопровод|топливопровод|обвязк/i;
  // системы и работы — не стоят на полу: в чертёж не попадают (перечисляются в примечании)
  static SKIP = /систем|освещ|электроснабж|сигнализац|пожар|обвязк|арматур|трубопровод|монтаж|вентиляц|отоплен|подогрев|кабел|комплект|ЗИП|документац|доставк|наладк|проект/i;
  static LABEL = { compressor:'Компрессор', dryer:'Осушитель', receiver:'Ресивер', filter:'Фильтр', dgu:'ДГУ', pump:'Насосный агрегат', cabinet:'Шкаф', tank:'Бак', muffler:'Глушитель', piping:'Трубопровод', other:'Оборудование' };
  // цвет, если в характеристиках его нет (условный — подписывается в окне «Компоновка»)
  static COLOR = { compressor:'#D5DADF', dryer:'#E9ECEF', receiver:'#AEB7C1', filter:'#B7BEC6', dgu:'#C9CED3', pump:'#3A6EA5', cabinet:'#CBD0CC', tank:'#9AA3AC', muffler:'#6b7178', other:'#C9CED4' };

  static kindOf(p){
    const cat=String((p.attrs&&p.attrs.cat)||p.cat||''), nm=String(p.name||'');
    if (p.role==='container') return 'container';
    if (cat) for (const [k, re] of this.KINDS) if (re && re.test(cat)) return k;
    if (this.CHASSIS.test(nm)) return 'chassis';
    if (this.MUFFLER.test(nm)) return 'muffler';
    if (p.role!=='main' && this.PIPING.test(nm)) return 'piping';
    if (this.CABINET.test(nm)) return 'cabinet';
    if (p.role!=='main' && this.SKIP.test(nm)) return 'skip';
    for (const [k, , re] of this.KINDS) if (re.test(nm)) return k;
    return p.role==='main' ? 'other' : '';
  }

  static num(v){ const n=parseFloat(String(v??'').replace(/\s+/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; }
  /** расход воздуха из паспорта, м³/ч: cool — на охлаждение (компрессор — охладитель, ДГУ — радиатор), comb — на горение;
   *  нет строки — null (расчёт по мощности) */
  static airRows(p){
    const out={ cool:null, comb:null, heat:null };
    for (const r of p.rows||[]){ if (!r) continue; const k=String(r.k||''), t=k+' '+String(r.v||'');
      // тепловыделение по паспорту, кВт (рекуперируемая доля — не всё тепло, не берётся)
      if (/тепловыделен|теплоотдач|тепловой поток|тепловая мощность/i.test(k) && !/рекупер|возврат/i.test(k)){ const h=String(r.v||'').match(/(\d+(?:[.,]\d+)?)\s*(квт|kw)/i); if (h && !out.heat) out.heat=this.num(h[1]); continue; }
      if (!/воздух/i.test(k) || !/расход|поток|производительн/i.test(k)) continue;
      const m=String(r.v||'').replace(/(\d)\s+(?=\d{3}(?!\d))/g, '$1').match(/(\d+(?:[.,]\d+)?)\s*(м³|м3|m³|m3)\s*\/\s*(ч|час|h|мин|min|с|сек|s)(?![А-Яа-яЁёA-Za-z])/i); if (!m) continue;
      const v=this.num(m[1]), u=m[3].toLowerCase(), q=Math.round(v*(/^(мин|min)$/.test(u) ? 60 : /^(с|сек|s)$/.test(u) ? 3600 : 1));
      if (!(q>0)) continue;
      if (/горени|сгорани|двигател/i.test(t) && !/охлажд|радиатор/i.test(k)) out.comb=out.comb||q;
      else if (/охлажд|радиатор|вентилятор/i.test(k)) out.cool=out.cool||q; }
    return out;
  }
  /** «1090 × 790 × 870», «1150*430», «109 х 79 х 87 см» → числа в мм (2 или 3) */
  static nums(text){
    const s=String(text||'').replace(/(\d)\s+(?=\d{3}\b)/g, '$1').replace(/[хxХX*]/g, '×');
    const m=s.match(/(\d+(?:[.,]\d+)?)\s*×\s*(\d+(?:[.,]\d+)?)(?:\s*×\s*(\d+(?:[.,]\d+)?))?/); if (!m) return null;
    let a=[m[1], m[2], m[3]].filter(Boolean).map(v=>parseFloat(v.replace(',', '.')));
    if (Math.max(...a)<40) a=a.map(v=>v*1000); else if (/см/.test(s)) a=a.map(v=>v*10);
    a=a.map(Math.round);
    return a.every(v=>v>=50 && v<=20000) ? a : null;
  }
  /** габариты, мм: {l ≥ w, h, known, src}; не указаны — условные по виду оборудования */
  static dims(p, kind){
    const a=p.attrs||{};
    let n=this.nums(a.size), src=n ? 'Габариты' : '';
    if (!n || n.length<3){
      // не размеры частей: упаковки, патрубков, радиатора ДГУ («Габариты радиатора (раст. от пола, В, Ш)»), проёмов
      const rows=(p.rows||[]).filter(r=>r && /габарит|размер|д\s*[×xх*]\s*ш/i.test(String(r.k||'')) && !/упаков|присоедин|фланц|патрубк|радиатор|про[её]м|отверсти/i.test(String(r.k||'')));
      for (const r of rows){ const t=this.nums(r.v); if (t && (!n || t.length>n.length)){ n=t; src=String(r.k); if (t.length===3) break; } }
    }
    if ((!n || n.length<3) && typeof lgCargoOf==='function'){
      const c=lgCargoOf([{rows:p.rows||[]}]); if (c && c.dims){ n=[c.dims.l, c.dims.w, c.dims.h].map(v=>Math.round(v*1000)); src=c.dimSrc||'Габариты'; } }
    if (n && n.length===2){   // «1150 × 430» — у фильтров и ресиверов: высота × диаметр; у глушителя — длина × диаметр
      const [p1, p2]=n, lo=Math.min(p1, p2), hi=Math.max(p1, p2);
      n=kind==='muffler' ? [hi, lo, lo] : ['filter', 'receiver', 'dryer', 'tank'].includes(kind) ? [lo, lo, hi] : [p1, p2, this.guess(p, kind)[2]]; }
    if (n && n.length===3){ const [l, w]=n[0]>=n[1] ? [n[0], n[1]] : [n[1], n[0]]; return { l, w, h:n[2], known:true, src }; }
    const g=this.guess(p, kind); return { l:g[0], w:g[1], h:g[2], known:false, src:'' };
  }
  /** условные габариты, мм — по мощности, объёму или виду оборудования */
  static guess(p, kind){
    const a=p.attrs||{}, kw=this.num(a.kw), vr=(p.rows||[]).find(r=>r && /^объ[её]м/i.test(String(r.k||'')) && /л\b|литр/i.test(String(r.v||'')+String(r.k||'')));
    const vol=this.num(a.volume) ?? (vr ? this.num(String(vr.v).match(/\d[\d\s]*(?:[.,]\d+)?/)?.[0]) : null);
    if (kind==='compressor') return kw==null||kw<=15 ? [1000, 700, 1100] : kw<=37 ? [1400, 900, 1500] : kw<=90 ? [2000, 1100, 1800] : [2700, 1500, 2000];
    if (kind==='dgu') return kw==null||kw<=30 ? [1800, 800, 1300] : kw<=100 ? [2500, 1000, 1600] : kw<=250 ? [3200, 1200, 1900] : kw<=500 ? [4000, 1600, 2200] : [5200, 2000, 2400];
    if (kind==='receiver'){ const v=vol||500, d=v<=300 ? 550 : v<=600 ? 650 : v<=1100 ? 800 : v<=2200 ? 1000 : 1200, h=v<=300 ? 1600 : v<=600 ? 2000 : v<=1100 ? 2300 : v<=2200 ? 2900 : 3100; return [d, d, h]; }
    if (kind==='tank'){ const v=this.num(a.tank)||vol||1000, l=Math.round(Math.max(800, Math.min(3000, v/0.8))/50)*50; return [l, 800, 1000]; }
    if (kind==='muffler') return this.guessMuffler(kw);
    if (kind==='cabinet') return this.cabWord(p)==='floor' ? [800, 400, 1800] : [600, 250, 800];   // настенный — по умолчанию
    return { dryer:[900, 600, 1100], filter:[300, 300, 900], pump:[800, 500, 700] }[kind] || [800, 600, 1000];
  }
  /** шкаф: выбрано в составе («на стене» / «на полу») или сказано в названии и характеристиках; иначе null */
  static cabWord(p){
    if (p.mount==='wall' || p.mount==='floor') return p.mount;
    const t=[p.name, ...(p.rows||[]).map(r=>r ? String(r.k||'')+' '+String(r.v||'') : '')].join(' ');
    return this.CAB_FLOOR.test(t) ? 'floor' : this.CAB_WALL.test(t) ? 'wall' : null;
  }
  /** шкафы чаще висят на стене: настенный — если так выбрано, если габариты не указаны или он невысокий и неглубокий
   *  (до 1400 мм высотой и 450 мм глубиной — как настенные корпуса); иначе напольный */
  static mount(p, d){ return this.cabWord(p) || (!d.known || (d.h<=1400 && d.w<=450) ? 'wall' : 'floor'); }
  /** глушитель ДГУ без размеров: длина × диаметр × диаметр, мм — по мощности ДГУ, кВт (промышленные и резидентные глушители) */
  static guessMuffler(kw){ const k=kw==null ? 200 : kw; return k<=60 ? [1000, 300, 300] : k<=150 ? [1400, 400, 400] : k<=400 ? [1800, 500, 500] : k<=800 ? [2400, 650, 650] : [3000, 800, 800]; }
  static mass(p){
    const a=p.attrs||{}, m=this.num(a.mass); if (m>0) return m;
    if (typeof lgCargoOf==='function'){ const c=lgCargoOf([{rows:p.rows||[]}]); if (c && c.mass>0) return Math.round(c.mass*1000); }
    return null;
  }
  /** цвет: главный цвет фото элемента (PhotoTint, если уже определён); иначе из характеристик — строка «Цвет…»,
   *  «Окраска…», «…покрытие» или любой код RAL; иначе — условный по виду. Подпись (код RAL) — из характеристик */
  static color(p, kind){
    const c=this.colorRows(p, kind), t=this.tint(p);
    return t ? { hex:t, known:true, text:c.text, photo:true } : c;
  }
  /** главный цвет фото элемента (определяется в браузере заранее) или '' */
  static tint(p){ const s=p && p.photo && p.photo.src; return s && typeof PhotoTint!=='undefined' ? PhotoTint.get(String(s))||'' : ''; }
  static colorRows(p, kind){
    const a=p.attrs||{}, rows=(p.rows||[]).filter(r=>r && (/^(цвет|окраск|покрыт|ral)/i.test(String(r.k||'').trim()) || /RAL\s*-?\s*\d{4}/i.test(String(r.v||''))));
    const cand=[a.color, a.ral, ...rows.map(r=>r.v)].filter(v=>v!=null && String(v).trim());
    for (const v of cand){ const c=RalColor.codes(v)[0]; if (c) return { hex:c.hex, known:true, text:c.code }; }
    for (const v of rows.filter(r=>/^(цвет|окраск)/i.test(String(r.k||'').trim())).map(r=>r.v)){ const h=RalColor.named(v); if (h) return { hex:h, known:true, text:String(v).trim().slice(0, 40) }; }
    return { hex:this.COLOR[kind]||this.COLOR.other, known:false, text:'' };
  }
  /** форма для 3D-вида: box — короб, vcyl — вертикальный цилиндр (ресивер, корпус фильтра), hcyl — горизонтальный */
  static shape(p, kind, d){
    const o=String((p.attrs&&p.attrs.orient)||'').toLowerCase();
    if (kind==='receiver'){ if (/гориз/.test(o) || (!/верт/.test(o) && d.l>=1.6*Math.max(d.w, d.h))) return 'hcyl'; if (/верт/.test(o) || (d.h>=1.3*d.l && d.l<=1.25*d.w)) return 'vcyl'; }
    if (kind==='filter' && d.l<=1.3*d.w && d.h>=1.2*d.l) return 'vcyl';
    return 'box';
  }
  /** тип компрессора для расчёта тепла (vent.k_heat): screw / piston / centrifugal / scroll */
  static ctype(p){ const cat=String((p.attrs&&p.attrs.cat)||p.cat||''), n=String(p.name||'');
    return cat==='comp_piston' || /поршнев/i.test(n) ? 'piston' : cat==='comp_centrifugal' || /центробеж|турбокомпрес/i.test(n) ? 'centrifugal' : cat==='comp_scroll' || /спиральн/i.test(n) ? 'scroll' : 'screw'; }
  /** вид изделия для рисунка на чертеже: поршневой компрессор (на ресивере) — 'piston', иначе '' */
  static look(p, kind){
    const cat=String((p.attrs&&p.attrs.cat)||p.cat||'');
    return kind==='compressor' && (cat==='comp_piston' || /поршнев/i.test(String(p.name||''))) ? 'piston' : '';
  }
  /** короткая подпись на чертеже: модель или первые слова названия */
  /** свой рисунок модели для чертежа: {front, top} — адреса изображений (или null) */
  static pic(p){ const d=p.draw||{}, s=v=>String((d[v] && d[v].src)||''); return s('front') || s('top') ? { front:s('front'), top:s('top') } : null; }
  static short(p, kind){
    const a=p.attrs||{}, m=String(a.model||'').trim();
    if (m) return m.length>22 ? m.slice(0, 21)+'…' : m;
    const n=String(p.name||'').trim() || this.LABEL[kind] || 'Элемент'; return n.length>22 ? n.slice(0, 21).replace(/\s+\S*$/, '')+'…' : n;
  }

  /** коротко для экспликации, если полное название длинное: «Компрессор Remeza ВК60-2,5 ВС» (вид, производитель, модель) */
  static brief(p, kind, name){
    const a=p.attrs||{}, m=String(a.model||'').trim(), mk=String(a.maker||'').trim();
    if (name.length<=56 || !m || kind==='other') return name;
    return [this.LABEL[kind], mk && !m.toLowerCase().includes(mk.toLowerCase()) ? mk : '', m].filter(Boolean).join(' ');
  }

  /** состав → оборудование: [{id, pos, name, brief, short, kind, qty, l, w, h, known, mass, color, shape, place}] (pos — номер на чертеже) */
  /** o: {recv — где ресивер без своей роли ('after' | 'before' | 'both'), recvOut — ресиверы после подготовки снаружи} */
  static list(parts, o={}){
    let pos=0;
    const out=(parts||[]).filter(p=>p && p.role!=='container').map(p=>{
      const kind=this.kindOf(p), name=String(p.name||'').trim() || this.LABEL[kind] || 'Элемент', qty=Math.max(1, Math.min(20, Math.round(this.num(p.qty)||1)));
      if (kind==='skip' || kind==='chassis') return { id:p.id, name, kind, qty, place:false };
      if (kind==='piping'){ const m=PipeMaterial.of(p); return { id:p.id, pos:++pos, name, brief:this.brief(p, kind, name), short:'Трубопровод', kind, qty, place:false, mat:m ? m.id : '', dn:PipeMaterial.dn(p) }; }
      if (kind==='muffler'){   // глушитель ДГУ — на крыше («…внутри…» — не рисуется); без размеров — по мощности ДГУ
        const d=this.dims(p, kind); return { id:p.id, pos:++pos, name, brief:this.brief(p, kind, name), short:this.short(p, kind), kind, qty, place:false, roof:!/внутр/i.test(name),
          l:d.l, w:d.w, h:d.h, known:d.known, src:d.src, mass:this.mass(p), color:this.color(p, kind).hex }; }
      const d=this.dims(p, kind);
      if (!kind && !d.known) return { id:p.id, name, kind:'skip', qty, place:false, nodims:true };
      const k=kind||'other', c=this.color(p, k), air=/^(compressor|dryer|receiver|filter)$/.test(k) ? AirChain.info(p, k) : null;
      const pipe=k==='filter' && air.grade!=='cond' && Math.max(d.l, d.w)<=700;   // магистральный фильтр — висит на трубопроводе
      return { id:p.id, pos:++pos, name, brief:this.brief(p, k, name), short:this.short(p, k), kind:k, qty, l:d.l, w:d.w, h:d.h, known:d.known, src:d.src, mass:this.mass(p), kw:this.num((p.attrs||{}).kw), maker:String((p.attrs||{}).maker||'').trim(),
        color:c.hex, colorKnown:c.known, colorText:c.text, shape:this.shape(p, k, d), look:this.look(p, k), place:true, pipe, mount:k==='cabinet' ? this.mount(p, d) : pipe ? 'pipe' : 'floor', air, noise:StationNorms.dba(p), pic:this.pic(p),
        flow:k==='pump' ? this.num((p.attrs||{}).flow) : null, ...(k==='compressor' || k==='dgu' ? this.airRows(p) : {}), ...(k==='compressor' ? { ctype:this.ctype(p) } : {}) };
    });
    AirChain.assign(out, o.recv);
    // ресиверы после подготовки воздуха — снаружи, на площадке у дальнего торца (ФНП ОРПД, п. 65): в ряду внутри их нет,
    // по ходу воздуха — последние
    if (o.recvOut) for (const e of out) if (e.kind==='receiver' && e.air && e.air.role==='dry'){ e.place=false; e.outside=true; e.air.stage=80; e.air.out=true; }
    const dgu=out.find(e=>e.kind==='dgu');
    for (const e of out) if (e.kind==='muffler' && !e.known){ const g=this.guessMuffler(dgu ? dgu.kw : null); e.l=g[0]; e.w=g[1]; e.h=g[2]; }
    return out;
  }
}

// ---------------------------------------------------------------- подготовка сжатого воздуха
// По ходу воздуха: компрессоры → (влагоотделитель) → «мокрый» ресивер → фильтры до осушителя → осушитель → фильтры после
// осушителя → угольный → «сухой» ресивер → генератор азота (кислорода) → потребителю. У осушителя, ресивера и фильтра —
// один вход и один выход: воздух проходит через них последовательно. Перед адсорбционным осушителем — всегда фильтр
// очистки от масла (масло выводит адсорбент из строя), после него — пылевой (пыль адсорбента). У рефрижераторного фильтры
// часто встроены; компрессор бывает со встроенным осушителем и (или) фильтрами. Подбор: осушитель и фильтры — не меньше
// суммы производительности компрессоров с поправкой на давление (номинал — при 7 бар, +35 °C на входе, +25 °C вокруг,
// ISO 7183); ресивер — по частоте циклов компрессора; класс чистоты по ISO 8573-1 — какие ступени нужны.
class AirChain {
  // ступени фильтров: name — для подсказок и нового элемента, stage — «Ступень очистки» в каталоге
  static GRADES = {
    sep:{ name:'Влагоотделитель (циклонный сепаратор)', short:'влагоотделитель', stage:'Влагоотделитель (циклон)' },
    pre:{ name:'Фильтр предварительной очистки (3–5 мкм)', short:'предварительной очистки', stage:'Предварительная' },
    fine:{ name:'Фильтр тонкой очистки (1 мкм, масло до 0,1 мг/м³)', short:'тонкой очистки', stage:'Тонкая' },
    micro:{ name:'Фильтр сверхтонкой очистки от масла (0,01 мкм, 0,01 мг/м³)', short:'сверхтонкой очистки от масла', stage:'Сверхтонкая (микрофильтр)' },
    dust:{ name:'Пылевой фильтр после адсорбционного осушителя (сухой фильтр частиц)', short:'пылевой', stage:'Пылевой (после адсорбционного осушителя)' },
    carbon:{ name:'Угольный фильтр (пары масла и запах, 0,003 мг/м³)', short:'угольный', stage:'Угольный (от паров масла)' },
  };
  // числа — из файла инженерных правил (StationRules): поправка осушителя на давление, запас осушителя, продувка
  // адсорбционного, ресивер (формула «нагрузка — холостой ход» и частотный), ряд объёмов, классы ISO 8573-1
  static get KP(){ return StationRules.raw('dryer.kp'); }                 // бар → множитель (номинал — 7 бар)
  static get MARGIN(){ return StationRules.raw('dryer.margin'); }         // запас осушителя на лето
  static get PURGE(){ return StationRules.raw('flow.purge').default; }   // адсорбционный без нагрева: продувка — доля воздуха
  /** продувка адсорбционного осушителя по типу регенерации (поле «regen» каталога) — доля производительности */
  static purge(regen){ const P=StationRules.raw('flow.purge'); return P[String(regen||'')]!=null ? P[String(regen||'')] : P.default; }
  /** ресивер, л на 1 м³/мин компрессора «нагрузка — холостой ход»: V = k · qc · p1 · T0 / (fmax · Δp · T1), qc = 1000/60 л/с */
  static get RECV(){ const f=StationRules.raw('receiver.formula'); return f.k*(1000/60)*f.p1*f.T0*f.cycle/(f.dp*f.T1); }
  static get RECV_VSD(){ return StationRules.raw('receiver.vsd'); }
  static get RECV_SIZES(){ return StationRules.raw('receiver.sizes'); }
  /** ресивер по умолчанию (receiver.base, решение ПНЕВМОТЕХ): {volume — л, maker — производитель в приоритете} или null */
  static get BASE(){ const b=StationRules.opt('receiver.base'); return b && b.volume>0 ? b : null; }
  // класс чистоты по ISO 8573-1 (частицы.вода.масло) и где применяют
  static get CLASSES(){ return StationRules.raw('air.classes'); }
  static get PDP(){ return StationRules.raw('air.pdp'); }   // точка росы под давлением по классу воды, °C
  /** пункты выбора класса: [значение, подпись]; класс не из списка (из ТЗ) — добавляется в конец */
  static options(cur){ const L=this.CLASSES.map(([v, t])=>[v, v+' — '+t]); return cur && !this.CLASSES.some(c=>c[0]===cur) ? [...L, [cur, cur+' — по ТЗ']] : L; }

  /** текст элемента для распознавания: название, модель, ступень, тонкость, характеристики */
  static text(p){ const a=p.attrs||{}; return [p.name, a.model, a.stage, a.fineness, a.isoClass, a.series, ...(p.rows||[]).map(r=>r ? String(r.k||'')+': '+String(r.v||'') : '')].filter(Boolean).join(' · '); }
  /** число из строки характеристики */
  static first(v){ const m=String(v??'').match(/\d[\d\s]*(?:[.,]\d+)?/); return m ? StationEquip.num(m[0]) : null; }
  /** производительность, м³/мин: поле каталога или строка «Производительность / Пропускная способность» (л/мин, м³/ч, л/с) */
  static flow(p){
    const n=StationEquip.num((p.attrs||{}).flow); if (n>0) return n;
    for (const r of p.rows||[]){ if (!r || !/производительн|пропускн|расход воздух/i.test(String(r.k||''))) continue;
      const t=String(r.k||'')+' '+String(r.v||''), v=this.first(r.v); if (!(v>0)) continue;
      if (/л\s*\/\s*мин/i.test(t)) return v/1000; if (/м[³3]\s*\/\s*ч/i.test(t)) return v/60; if (/л\s*\/\s*с/i.test(t)) return v*0.06;
      return v; }
    return null;
  }
  /** рабочее давление, бар */
  static bar(p){
    const n=StationEquip.num((p.attrs||{}).pressure); if (n>0) return n;
    const r=(p.rows||[]).find(x=>x && /давлени/i.test(String(x.k||''))); if (!r) return null;
    const v=this.first(r.v); return v>0 ? (/мпа/i.test(String(r.k||'')+String(r.v||'')) ? v*10 : v) : null;
  }
  /** объём, л */
  static volume(p){
    const n=StationEquip.num((p.attrs||{}).volume); if (n>0) return n;
    const r=(p.rows||[]).find(x=>x && /^объ[её]м/i.test(String(x.k||'').trim())); if (!r) return null;
    const v=this.first(r.v); return v>0 ? (/м[³3]/i.test(String(r.k||'')+String(r.v||'')) && v<100 ? v*1000 : v) : null;
  }
  /** ступень фильтра: поле «Ступень очистки», иначе по названию и характеристикам; cond — сепаратор конденсата (не на линии) */
  static grade(p, cat, t){
    if (cat==='oil_sep' || /конденсат|масловод|водомасл|масляного тумана/i.test(t)) return 'cond';
    const a=p.attrs||{}, sr=(p.rows||[]).find(r=>r && /^ступень очистки/i.test(String(r.k||'').trim())), st=String(a.stage||(sr && sr.v)||'');
    if (/циклон|влагоотдел|водоотдел/i.test(String(p.name||'')+' '+st)) return 'sep';    // циклонный сепаратор — не фильтр, даже со ступенью «Предварительная»
    if (/пылев/i.test(st)) return 'dust';
    if (/предвар/i.test(st)) return 'pre'; if (/сверхтонк|микро/i.test(st)) return 'micro'; if (/уголь/i.test(st)) return 'carbon'; if (/тонк/i.test(st)) return 'fine';
    if (/угол|угольн|активированн|пар\S*\s+масл|запах|(?:^|[^a-z])(?:QD|ACS)\s?\d/i.test(t)) return 'carbon';
    const um=this.micron(p);                       // тонкость по частицам (поле «Тонкость» или строка «…частиц / пыли, мкм»)
    const G=StationRules.raw('air.grade.micron'); if (um>=G.pre) return 'pre'; if (um!=null && um<=G.micro && !/пылев/i.test(t)) return 'micro';
    if (/пылев|после адсорбц|пыл\S*\s+адсорбент|(?:^|[^a-z])(?:DDp|PDp)\s?\d/i.test(t)) return 'dust';
    if (/сверхтонк|микрофильтр|0[.,]01\s*мкм|(?:^|[^a-z])(?:PD|AA)\s?\d/i.test(t)) return 'micro';
    if (/тонк\S*\s+(?:очистк|фильтр)|(?:^|\D)1\s*мкм|0[.,]1\s*мг|от масла|маслоотдел|коалесц|(?:^|[^a-z])(?:DD|AO)\s?\d/i.test(t)) return 'fine';
    if (/предварит|грубой|общей очистк|общего назначени|(?:^|\D)[35]\s*мкм|механическ/i.test(t)) return 'pre';
    if (/циклон|влагоотдел|сепаратор\S*\s+(?:влаг|вод)|водоотдел/i.test(t)) return 'sep';
    return '';
  }
  /** тонкость фильтрации по частицам, мкм (опечатка поставщика «Мкн» — тоже); нет — null */
  static micron(p){
    const a=p.attrs||{}, rx=/(\d+(?:[.,]\d+)?)\s*мк[мн]/i, m=String(a.fineness||'').match(rx); if (m) return StationEquip.num(m[1]);
    for (const r of p.rows||[]){ if (!r || !/частиц|пыл|тонкост|степень (?:очистки|фильтрац)/i.test(String(r.k||'')) || /масл|вод/i.test(String(r.k||''))) continue;
      const x=String(r.v||'').match(rx) || (/мк[мн]/i.test(String(r.k||'')) ? String(r.v||'').match(/(\d+(?:[.,]\d+)?)/) : null); if (x) return StationEquip.num(x[1]); }
    return null;
  }
  /** остаточное содержание масла после фильтра, мг/м³ (строка «…масл…» в мг/м³); нет — null */
  static oil(p){
    for (const r of p.rows||[]){ if (!r || !/масл/i.test(String(r.k||''))) continue;
      const t=String(r.k||'')+' '+String(r.v||''); if (!/мг/i.test(t)) continue; const v=this.first(r.v); if (v!=null && v>0) return v; }
    return null;
  }
  /** сведения для цепочки: компрессор — встроенные осушитель и фильтр, частотное регулирование; осушитель — вид и встроенные
   *  фильтры; ресивер — «мокрый» (до осушителя) или «сухой» (после); фильтр — ступень; у всех — производительность и давление */
  static info(p, kind){
    const a=p.attrs||{}, cat=String(a.cat||p.cat||''), t=this.text(p), nm=String(p.name||''), o={ flow:this.flow(p), bar:this.bar(p) };
    const yes=v=>/^(да|есть|встроен)/i.test(String(v??'').trim()), set=v=>v!=null && String(v).trim()!=='';
    // фильтры в комплекте аппарата: строка «…фильтры в комплекте / в составе / встроенные: MX+MY» (не «нет»)
    const kitF=()=>(p.rows||[]).some(r=>r && /фильтр/i.test(String(r.k||'')) && /встроен|в\s+комплект|в\s+составе/i.test(String(r.k||'')+' '+String(r.v||'')) && !/^\s*(нет|-|—)\s*$/i.test(String(r.v||'')));
    if (kind==='compressor'){
      o.dryer=set(a.dryer) ? yes(a.dryer) : /(?:^|\s)со?\s+(?:встроенн\S*\s+)?(?:рефрижераторн\S*\s+)?осушител|встроенн\S*\s+(?:\S+\s+)?осушител|осушител\S*\s+встроен|(?:^|[^a-z])FF(?:[^a-z]|$)/i.test(nm)
        || (p.rows||[]).some(r=>r && /осушител/i.test(String(r.k||'')) && yes(r.v));
      // встроенные магистральные фильтры: поле каталога «filters», иначе — по названию и характеристикам («4 в 1»: с осушителем и фильтрами)
      o.filter=set(a.filters) ? yes(a.filters) : /встроенн\S*\s+(?:\S+\s+){0,2}фильтр|(?:^|\s)с\s+(?:\S+\s+){0,3}фильтр/i.test(nm) || kitF()
        || (p.rows||[]).some(r=>r && /осушител\S*\s+и\s+(?:магистральн\S*\s+)?фильтр/i.test(String(r.v||'')));
      o.vsd=set(a.vsd) ? yes(a.vsd) : /частотн|инвертор|(?:^|[^a-z])VSD(?:[^a-z]|$)|(?:^|\s)ПЧ(?:\s|$)|переменн\S*\s+скорост/i.test(t);
      o.recv=StationEquip.num(a.receiver)>0 || /на ресивере/i.test(t); }
    else if (kind==='dryer'){
      o.type=/^gen_/.test(cat) || /генератор/i.test(nm) ? 'gen' : cat==='dryer_ads' || /адсорбц|десикант|мембран/i.test(t) ? 'ads' : 'refrig';
      o.filters=set(a.filters) ? yes(a.filters) : /встроенн\S*\s+(?:\S+\s+){0,2}фильтр|фильтр\S*\s+(?:\S+\s+)?встроен|(?:^|\s)с\s+(?:\S+\s+)?фильтрам|интегрированн\S*\s+(?:\S+\s+)?фильтр/i.test(t) || kitF();
      o.pdp=this.first(String(a.dewPoint||'').replace('−', '-')); if (o.pdp!=null && /[−-]/.test(String(a.dewPoint))) o.pdp=-Math.abs(o.pdp); }
    else if (kind==='receiver'){ o.role=/сух/i.test(nm) || /после осушител/i.test(t) ? 'dry' : /мокр|влажн/i.test(nm) ? 'wet' : ''; o.vol=this.volume(p); }
    else if (kind==='filter'){ const g=String(p.airGrade||'');   // ступень, под которую фильтр подобран («Нужно: пылевой…») — главнее каталожной
      o.grade=this.GRADES[g] ? g : this.grade(p, cat, t); o.pinned=!!this.GRADES[g]; o.oil=this.oil(p); o.um=this.micron(p); }
    return o;
  }

  /** порядок по ходу воздуха (e.air.stage, меньше — раньше), роли ресиверов и ступени фильтров без указания; recv — где
   *  ресивер без своей роли: 'after' (по умолчанию) — после осушителя и фильтров («сухой»: так чаще — потребитель получает
   *  подготовленный воздух, в ресивере нет конденсата), 'before' — до осушителя («мокрый»: собирает конденсат, гасит
   *  пульсации), 'both' — первый до осушителя, остальные после */
  static assign(eq, recv){
    const A=eq.filter(e=>e.air), D=A.filter(e=>e.kind==='dryer' && e.air.type!=='gen'), ads=D.some(e=>e.air.type==='ads'), refrig=D.some(e=>e.air.type==='refrig');
    const R=A.filter(e=>e.kind==='receiver'), mode=recv==='before' || recv==='both' ? recv : 'after';
    let wet=R.some(e=>e.air.role==='wet');
    for (const e of R.filter(x=>!x.air.role)){ e.air.role=mode==='before' || (mode==='both' && !wet) ? 'wet' : 'dry'; if (e.air.role==='wet') wet=true; }
    // фильтры без указанной ступени — чего не хватает по виду осушителя (адсорбционный: от масла до, пылевой после)
    // (несколько одинаковых фильтров одной строкой состава — каждому своя ступень)
    // сухой фильтр частиц («пылевой») без адсорбционного осушителя — предварительный (перед осушителем и тонкими фильтрами)
    if (!ads) for (const e of A) if (e.kind==='filter' && e.air.grade==='dust' && !e.air.pinned) e.air.grade='pre';
    const F=A.filter(e=>e.kind==='filter' && e.air.grade!=='cond'), have=new Set(F.map(e=>e.air.grade).filter(Boolean)), built=D.some(e=>e.air.filters);
    const want=ads ? ['micro', 'dust', 'carbon'] : refrig ? (built ? ['micro', 'carbon'] : ['pre', 'micro', 'carbon']) : ['pre', 'fine', 'micro', 'carbon'];
    for (const e of F.filter(x=>!x.air.grade)){ const gs=[];
      for (let k=0; k<e.qty; k++){ const g=want.find(w=>!have.has(w)) || 'fine'; have.add(g); gs.push(g); }
      e.air.grade=gs[0]; e.air.guess=true; if (gs.some(g=>g!==gs[0])) e.air.grades=gs; }
    const st=(e, gr)=>{ const k=e.kind, a=e.air;
      if (k==='compressor') return 10;
      if (k==='receiver') return a.role==='dry' ? 60 : 20;
      if (k==='dryer') return a.type==='gen' ? 70 : a.type==='ads' ? 45 : 40;
      if (k!=='filter' || gr==='cond') return null;
      const base=!D.length ? { sep:15, pre:31, fine:32, micro:33, dust:34, carbon:35 }[gr] : { sep:15, pre:31, fine:32, micro:ads ? 43 : 51, dust:52, carbon:55 }[gr];
      // разные фильтры одной ступени (3 и 1 мкм — оба «предварительные») — по ходу воздуха от грубого к тонкому: тоньше
      // фильтрация по частицам (а при равной — меньше масла после фильтра) — дальше; одинаковые — одна ступень (параллельно)
      const fine=v=>v>0 ? -Math.log10(v) : null, f=fine(a.um)??fine(a.oil);
      if (base==null || f==null || (e.air.grades && e.air.grades.length>1)) return base;
      return base+Math.round(Math.min(0.9, Math.max(0.05, 0.5+0.1*f+(a.um>0 && a.oil>0 ? 0.01*fine(a.oil) : 0)))*100)/1000; };
    for (const e of A){ e.air.stage=st(e, e.air.grade); if (e.air.grades) e.air.stages=e.air.grades.map(g=>st(e, g)); }
  }
  /** единица k строки состава — её ступень (одинаковые фильтры одной строкой — разные ступени) */
  static unit(air, k){ return air && air.grades ? Object.assign({}, air, { grade:air.grades[k], stage:air.stages[k] }) : air; }
  /** по единицам: строка состава с разными ступенями — отдельными записями (qty 1) */
  static expand(A){ return A.flatMap(e=>e.air && e.air.grades ? e.air.grades.map((g, k)=>Object.assign({}, e, { qty:1, air:this.unit(e.air, k) })) : [e]); }
  /** одинаковые аппараты подряд по ходу воздуха — параллельно: осушители (генераторы) и фильтры одного вида и ступени —
   *  одной группой, производительность складывается; ресиверы — последовательно. list — по ходу воздуха: [[…], …] */
  static groups(list){
    const out=[];
    for (const e of list){ const g=out[out.length-1], a=g && g[0];
      if (a && (e.kind==='dryer' || e.kind==='filter') && a.kind===e.kind && e.air && a.air && a.air.stage===e.air.stage) g.push(e); else out.push([e]); }
    return out;
  }
  /** указание о параллельных группах для схемы и ТЗ (units — plan.air.units, по ходу воздуха) или '' */
  static parText(units){
    const qn=G=>G.reduce((s, u)=>s+(u.qty||1), 0), P=this.groups((units||[]).filter(u=>u.kind!=='compressor')).filter(G=>G[0].kind!=='receiver' && qn(G)>1);
    if (!P.length) return '';
    const what=G=>`${G[0].kind==='filter' ? 'фильтры' : (G[0].air||{}).type==='gen' ? 'генераторы' : 'осушители'} поз. ${[...new Set(G.map(u=>u.pos))].join(', ')} (${qn(G)} шт.)`;
    return `Одинаковые ${P.map(what).join('; ')} включены параллельно: производительность складывается; на входе и выходе каждого — кран, аппарат отключают на обслуживание, не останавливая остальные.`;
  }
  /** поправка осушителя на давление */
  static kp(bar){ return bar>0 ? StationRules.interp(this.KP, bar) : 1; }
  /** поправка магистрального фильтра на давление (правило filter.kp: пропорционально абсолютному давлению к номиналу) */
  static kf(bar){ const f=StationRules.raw('filter.kp'); return bar>0 ? Math.min(f.cap, (bar+1)/(f.ref+1)) : 1; }
  static m3(v){ return (Math.round(v*10)/10).toString().replace('.', ','); }
  /** ресиверы по умолчанию на объём V, л, при давлении bar: {n, v} — одинаковые по BASE.volume (900 л), сколько нужно без
   *  недобора; null — правила нет или такой ресивер при этом давлении подлежит учёту в Ростехнадзоре (p·V больше 1,0) */
  static base(V, bar){
    const b=this.BASE; if (!b || !(V>0)) return null; const v=b.volume;
    if (bar>0 && bar/10*v/1000>PressureVessel.LIMIT+1e-9) return null;
    return { n:Math.max(1, Math.ceil(Math.round(V)/v-1e-9)), v };   // объём — до литра (как в расчётной записке)
  }
  /** ресиверы без учёта в Ростехнадзоре на объём V, л, при давлении bar: {n, v} — наименьшее число одинаковых из ряда объёмов,
   *  у каждого p·V не больше 1,0 МПа·м³; один и так без учёта (или давление неизвестно) — null */
  static split(V, bar){
    if (!(V>0) || !(bar>0) || bar/10*V/1000<=PressureVessel.LIMIT+1e-9) return null;
    const v=this.RECV_SIZES.filter(x=>bar/10*x/1000<=PressureVessel.LIMIT+1e-9).pop(); if (!v) return null;
    return { n:Math.ceil(V/v-1e-9), v };
  }

  /** проверка и подбор: {chain — по ходу воздуха, q — сумма компрессоров, м³/мин, issues, recs — чего не хватает (для подбора
   *  в каталоге)}; cls — класс чистоты по ISO 8573-1 («1.4.1») или '' */
  static check(eq, cls){
    const A=this.expand(eq.filter(e=>e.air && e.air.stage!=null && (e.place!==false || e.outside))), C=A.filter(e=>e.kind==='compressor');
    if (!C.length) return null;
    const m3=v=>this.m3(v), nm=e=>`поз. ${e.pos}`, iss=[], recs=[], key=new Set();
    const D=A.filter(e=>e.kind==='dryer' && e.air.type!=='gen'), ads=D.filter(e=>e.air.type==='ads'), refrig=D.filter(e=>e.air.type==='refrig');
    const F=A.filter(e=>e.kind==='filter'), R=A.filter(e=>e.kind==='receiver'), g=x=>F.filter(e=>e.air.grade===x);
    const known=C.filter(e=>e.air.flow>0), q=known.reduce((s, e)=>s+e.air.flow*e.qty, 0), bar=Math.max(0, ...C.map(e=>e.air.bar||0)) || 8;
    const builtDryer=C.some(e=>e.air.dryer), builtFilter=C.some(e=>e.air.filter) || D.some(e=>e.air.filters);
    const rec=(k, o)=>{ if (key.has(k)) return; key.add(k); recs.push(Object.assign({ key:k }, o)); };
    const need=(v, u)=>({ k:u==='л' ? 'Объём' : 'Производительность', v:`не менее ${u==='л' ? StationLayout.n(v) : m3(v)} ${u}` });
    const fRec=(grade, why)=>rec(grade, { title:this.GRADES[grade].name, why, cat:'filter', name:this.GRADES[grade].name, f:this.GRADES[grade].stage ? { stage:this.GRADES[grade].stage } : {}, r:q ? { flow:[m3(q/this.kf(bar)), ''] } : {},
      attrs:{ cat:'filter', stage:this.GRADES[grade].stage||undefined }, rows:[...(this.GRADES[grade].stage ? [{ k:'Ступень очистки', v:this.GRADES[grade].stage }] : []), ...(q ? [need(q/this.kf(bar), 'м³/мин')] : [])] });
    // ступени очистки по виду осушителя
    if (ads.length){
      const before=F.filter(e=>(e.air.grade==='micro' || e.air.grade==='fine') && e.air.stage<45);
      if (!before.length && !ads.every(e=>e.air.filters)){
        iss.push({ level:'warn', air:true, text:`Перед адсорбционным осушителем (${ads.map(nm).join(', ')}) нужен фильтр очистки от масла (коалесцентный, 0,01 мкм): масло выводит адсорбент из строя. Добавьте фильтр в состав.` });
        fRec('micro', 'перед адсорбционным осушителем — всегда: масло выводит адсорбент из строя'); }
      if (!g('dust').length && !ads.every(e=>e.air.filters)){
        iss.push({ level:'info', air:true, text:`После адсорбционного осушителя рекомендуется пылевой фильтр (1 мкм) — задерживает пыль адсорбента.` });
        fRec('dust', 'после адсорбционного осушителя — задерживает пыль адсорбента'); } }
    if (ads.length && q>0)
      iss.push({ level:'info', air:true, text:`Адсорбционный осушитель (${ads.map(nm).join(', ')}) без нагрева расходует на продувку ${Math.round(this.PURGE*100)}–20 % сжатого воздуха: потребителю останется около ${m3(q*(1-this.PURGE))} м³/мин из ${m3(q)}. Учитывайте при подборе компрессоров; осушитель с нагревом или с управлением по точке росы расходует меньше.` });
    if (refrig.length && !F.length && !builtFilter){
      iss.push({ level:'info', air:true, text:`Фильтров в составе нет: перед рефрижераторным осушителем рекомендуется фильтр предварительной очистки (защищает теплообменник), после — тонкой очистки от масла (0,01 мкм), если в осушителе их нет.` });
      fRec('pre', 'перед рефрижераторным осушителем — защищает теплообменник'); fRec('micro', 'после рефрижераторного осушителя — масляный аэрозоль'); }
    if (g('carbon').length && !g('micro').length && !g('fine').length)
      iss.push({ level:'info', air:true, text:`Угольный фильтр (${g('carbon').map(nm).join(', ')}) ставят после фильтра тонкой очистки от масла — иначе уголь быстро насыщается.` });
    // производительность: осушитель и фильтры — не меньше суммы компрессоров с поправкой на давление
    if (q>0){
      const kp=this.kp(bar);
      const groups=[['refrig', refrig], ['ads', ads]].filter(([, L])=>L.length);
      for (const [type, L] of groups){ if (L.some(e=>!(e.air.flow>0))) continue;
        const cap=L.reduce((s, e)=>s+e.air.flow*e.qty, 0)*kp, ids=L.map(nm).join(', ');
        if (cap<q*0.98){ iss.push({ level:'warn', air:true, text:`Осушитель (${ids}): ${m3(cap)} м³/мин при ${m3(bar)} бар — меньше производительности компрессоров ${m3(q)} м³/мин. Нужен не менее ${m3(q*this.MARGIN/kp)} м³/мин (номинал при 7 бар).` });
          rec('dryer-'+type, { title:(type==='ads' ? 'Адсорбционный' : 'Рефрижераторный')+` осушитель не менее ${m3(q*this.MARGIN/kp)} м³/мин`, why:'производительность — с запасом на лето и давление', cat:type==='ads' ? 'dryer_ads' : 'dryer_refrig', name:(type==='ads' ? 'Адсорбционный' : 'Рефрижераторный')+' осушитель', f:{}, r:{ flow:[m3(q*this.MARGIN/kp), ''] },
            attrs:{ cat:type==='ads' ? 'dryer_ads' : 'dryer_refrig' }, rows:[need(q*this.MARGIN/kp, 'м³/мин')] }); }
        else if (cap<q*this.MARGIN) iss.push({ level:'info', air:true, text:`Осушитель (${ids}) почти без запаса: ${m3(cap)} м³/мин при ${m3(bar)} бар на ${m3(q)} м³/мин компрессоров. Летом при +40 °C на входе производительность осушителя падает примерно на 20 % — рекомендуется запас ${Math.round((this.MARGIN-1)*100)} % и больше.` }); }
      // фильтры одной ступени — параллельно (groups): пропускная способность складывается
      const kf=this.kf(bar);
      for (const G of this.groups([...F].sort((a, b)=>a.air.stage-b.air.stage)).filter(L=>L[0].air.grade!=='cond' && L[0].air.grade!=='sep' && L.every(e=>e.air.flow>0))){
        const cap=G.reduce((s, e)=>s+e.air.flow*e.qty, 0)*kf, e=G[0], n=G.reduce((s, x)=>s+x.qty, 0);
        if (cap<q*0.98) iss.push({ level:'warn', air:true, text:`${n>1 ? `Фильтры ${[...new Set(G.map(nm))].join(', ')} (${n} шт. параллельно)` : `Фильтр ${nm(e)}`} «${e.short}»: ${m3(cap)} м³/мин при ${m3(bar)} бар — меньше производительности компрессоров ${m3(q)} м³/мин: перепад давления растёт, фильтр не держит класс очистки. Нужно не менее ${m3(q/kf)} м³/мин.` }); }
      // ресивер: по самому производительному компрессору «нагрузка — холостой ход» (частотный — меньше); по умолчанию —
      // одинаковые по 900 л (receiver.base), если каждый без учёта в Ростехнадзоре, иначе — из ряда объёмов
      const big=known.reduce((m, e)=>e.air.flow>m.air.flow ? e : m, known[0]), vn=big ? big.air.flow*(big.air.vsd ? this.RECV_VSD : this.RECV) : 0;
      const vr=big ? this.RECV_SIZES.find(v=>v>=vn-1e-6) || this.RECV_SIZES[this.RECV_SIZES.length-1] : 0, bs=this.base(vn, bar);
      const vol=R.reduce((s, e)=>s+(e.air.vol||0)*e.qty, 0), onRecv=C.some(e=>e.air.recv), sp=vr && !bs ? this.split(vr, bar) : null, N=StationLayout.n;
      if (vr && !R.length && !onRecv){
        const what=bs ? `${bs.n>1 ? bs.n+' ресивера по' : 'ресивер'} ${N(bs.v)} л${bs.n>1 || Math.round(vn)<bs.v ? ` (нужно около ${N(Math.round(vn))} л)` : ''}` : `около ${N(vr)} л`;
        iss.push({ level:'info', air:true, text:`Ресивера в составе нет — рекомендуется ${what}: сглаживает пульсации и пики потребления, собирает конденсат, компрессор реже переключается${bs ? `; ${N(bs.v)} л при ${m3(bar)} бар — без учёта в Ростехнадзоре` : sp ? `; один на ${N(vr)} л при ${m3(bar)} бар подлежит учёту в Ростехнадзоре (p·V больше 1,0 МПа·м³) — без учёта: ${sp.n} по ${N(sp.v)} л` : ''}.` });
        const one=bs || sp;
        rec('receiver', { title:bs ? (bs.n>1 ? `Воздушные ресиверы ${bs.n} × ${N(bs.v)} л` : `Воздушный ресивер ${N(bs.v)} л`) : sp ? `Воздушные ресиверы ${sp.n} × ${N(sp.v)} л — без учёта в Ростехнадзоре` : `Воздушный ресивер около ${N(vr)} л`,
          why:bs ? `нужно около ${N(Math.round(vn))} л${bs.n>1 ? `, вместе ${N(bs.n*bs.v)} л` : ''}; p·V каждого — ${m3(bar/10*bs.v/1000)} МПа·м³: без учёта в Ростехнадзоре` : sp ? `вместе ${N(sp.n*sp.v)} л; p·V каждого — ${m3(bar/10*sp.v/1000)} МПа·м³, не больше 1,0` : 'буфер и сбор конденсата — компрессор реже переключается',
          cat:'receiver', name:'Воздушный ресивер', f:{}, r:{ volume:bs ? [String(bs.v), String(bs.v)] : sp ? [String(Math.round(sp.v*0.8)), String(sp.v)] : [String(Math.round(vr*0.8)), ''] }, total:bs ? Math.round(vn) : vr, qty:one ? one.n : 1,
          attrs:{ cat:'receiver' }, rows:[{ k:'Объём', v:one ? `${N(one.v)} л` : `около ${N(vr)} л` }] }); }
      else if (vr && R.length && R.every(e=>e.air.vol>0) && vol<vr*0.6)
        iss.push({ level:'info', air:true, text:`Ресиверы ${N(vol)} л — для компрессора ${m3(big.air.flow)} м³/мин${big.air.vsd ? ' с частотным регулированием' : ' с регулированием «нагрузка — холостой ход»'} рекомендуется около ${N(vr)} л (не чаще одного цикла в 30 с при перепаде 1 бар).` });
    }
    // ресиверы на учёте в Ростехнадзоре (p·V больше 1,0 МПа·м³): несколько меньших — каждый без учёта (замена из каталога)
    const regR=R.filter(e=>e.air.vol>0 && bar/10*e.air.vol/1000>PressureVessel.LIMIT+1e-9), tot=regR.reduce((s, e)=>s+e.air.vol*e.qty, 0), rs=tot ? this.base(tot, bar) || this.split(tot, bar) : null;
    if (rs){ iss.push({ level:'info', air:true, text:`Ресивер ${[...new Set(regR.map(nm))].join(', ')}: p·V больше 1,0 МПа·м³ — подлежит учёту в Ростехнадзоре. Без учёта — ${rs.n} ресивера по ${StationLayout.n(rs.v)} л (p·V каждого — ${m3(bar/10*rs.v/1000)} МПа·м³): замена — на вкладке «Компоновка».` });
      rec('recv-split', { title:`Ресиверы ${rs.n} × ${StationLayout.n(rs.v)} л вместо ${[...new Set(regR.map(nm))].join(', ')} — без учёта в Ростехнадзоре`, why:`вместе ${StationLayout.n(rs.n*rs.v)} л; p·V каждого не больше 1,0 МПа·м³`, cat:'receiver', name:'Воздушный ресивер', f:{},
        r:{ volume:[String(Math.round(rs.v*0.8)), String(rs.v)] }, qty:rs.n, replace:[...new Set(regR.map(e=>e.id))], attrs:{ cat:'receiver' }, rows:[{ k:'Объём', v:`${StationLayout.n(rs.v)} л` }] }); }
    // осушителя нет (и не задан класс чистоты): влага в сжатом воздухе — обычно ставят рефрижераторный с байпасом
    if (!D.length && !builtDryer && !String(cls||'').trim()){
      const need=q ? q*this.MARGIN/this.kp(bar) : 0;
      iss.push({ level:'info', air:true, text:`Осушителя в составе нет: влага остаётся в сжатом воздухе — конденсат в трубах и у потребителей, зимой замерзает. Обычно ставят рефрижераторный осушитель (точка росы +3 °C)${need ? ` не менее ${m3(need)} м³/мин` : ''} с байпасом — подбор на вкладке «Компоновка».` });
      rec('dryer-refrig', { title:`Рефрижераторный осушитель${need ? ` не менее ${m3(need)} м³/мин` : ''}`, why:'точка росы +3 °C: без конденсата в трубах; ставится с байпасом', cat:'dryer_refrig', name:'Рефрижераторный осушитель', f:{}, r:need ? { flow:[m3(need), ''] } : {},
        attrs:{ cat:'dryer_refrig' }, rows:need ? [{ k:'Производительность', v:`не менее ${m3(need)} м³/мин` }] : [] }); }
    // ресивер — на давление не ниже компрессорного: иначе срабатывает его предохранительный клапан (или сосуд перегружен)
    const cb=Math.max(0, ...C.map(e=>e.air.bar||0));
    for (const e of R.filter(x=>x.air.bar>0 && cb>x.air.bar+0.05))
      iss.push({ level:'warn', air:true, text:`Ресивер ${nm(e)} рассчитан на ${m3(e.air.bar)} бар — меньше давления компрессоров ${m3(cb)} бар: нужен ресивер не ниже ${m3(cb)} бар.` });
    // класс чистоты по ISO 8573-1: какой осушитель и какие ступени фильтров нужны
    const cl=String(cls||'').match(/^([1-6])\.([1-6])\.([1-4])$/), before=recs.length;
    if (cl){ const [pc, wc, oc]=cl.slice(1).map(Number), pdp=this.PDP[wc], hasDry=D.length || builtDryer, dp=(pdp>0 ? '+' : '−')+Math.abs(pdp)+' °C';
      const want=(grades, why)=>{ if (!grades.some(x=>g(x).length) && !(builtFilter && grades.some(x=>x==='pre' || x==='fine'))) fRec(grades[0], why); };
      if (wc<=3 && !ads.some(e=>e.air.pdp==null || e.air.pdp<=pdp)){
        iss.push({ level:'warn', air:true, text:`Класс ${cls}: точка росы ${dp} — нужен адсорбционный осушитель${refrig.length || builtDryer ? ' (рефрижераторный даёт +3 °C)' : ''}.` });
        rec('dryer-ads', { title:`Адсорбционный осушитель (точка росы ${dp})${q ? `, не менее ${m3(q*this.MARGIN/this.kp(bar))} м³/мин` : ''}`, why:`класс воды ${wc} по ISO 8573-1`, cat:'dryer_ads', name:'Адсорбционный осушитель', f:{ dewPoint:pdp<=-70 ? '−70' : pdp<=-40 ? '−40' : '−20' }, r:q ? { flow:[m3(q*this.MARGIN/this.kp(bar)), ''] } : {},
          attrs:{ cat:'dryer_ads' }, rows:[{ k:'Точка росы', v:dp }, ...(q ? [need(q*this.MARGIN/this.kp(bar), 'м³/мин')] : [])] });
        if (!g('micro').length) fRec('micro', 'перед адсорбционным осушителем — всегда'); }
      else if (wc<=6 && !hasDry){
        iss.push({ level:'warn', air:true, text:`Класс ${cls}: точка росы ${dp} — нужен осушитель (рефрижераторный).` });
        rec('dryer-refrig', { title:`Рефрижераторный осушитель${q ? ` не менее ${m3(q*this.MARGIN/this.kp(bar))} м³/мин` : ''}`, why:`класс воды ${wc} по ISO 8573-1 — точка росы до ${dp}`, cat:'dryer_refrig', name:'Рефрижераторный осушитель', f:{}, r:q ? { flow:[m3(q*this.MARGIN/this.kp(bar)), ''] } : {},
          attrs:{ cat:'dryer_refrig' }, rows:q ? [need(q*this.MARGIN/this.kp(bar), 'м³/мин')] : [] }); }
      if (pc===1 || oc===1) want(['micro'], `класс ${cls}: частицы и масло — до 0,01 мкм и 0,01 мг/м³`);
      else if (pc===2 || oc===2) want(['fine', 'micro'], `класс ${cls}: частицы до 1 мкм, масло до 0,1 мг/м³`);
      else if (pc<=3 || oc<=3) want(['pre', 'fine', 'micro'], `класс ${cls}: частицы до 5 мкм, масло до 1 мг/м³`);
      if (oc===1 && !g('carbon').length) fRec('carbon', `класс масла 1 — с парами масла (0,003 мг/м³)`);
      if (recs.length>before) iss.push({ level:'info', air:true, text:`Для класса ${cls} в составе не хватает: ${recs.slice(before).map(x=>x.title.replace(/\s*\(.*?\)/g, '').replace(/,.*$/, '').toLowerCase()).join(', ')} — подбор на вкладке «Компоновка».` });
    }
    // цепочка по ходу воздуха
    const order=[...A].filter(e=>e.kind!=='filter' || e.air.grade!=='cond').sort((a, b)=>a.air.stage-b.air.stage);
    const word=e=>e.kind==='compressor' ? 'компрессор'+(e.air.dryer ? ' со встроенным осушителем' : '') : e.kind==='receiver' ? (e.air.role==='dry' && D.length ? '«сухой» ресивер' : e.air.role==='dry' && F.length ? 'ресивер после фильтров' : 'ресивер')+(e.air.out ? ' снаружи' : '') : e.kind==='dryer' ? (e.air.type==='ads' ? 'адсорбционный осушитель' : e.air.type==='gen' ? 'генератор' : 'рефрижераторный осушитель')+(e.air.filters ? ' (встроенные фильтры)' : '') : 'фильтр '+this.GRADES[e.air.grade].short;
    const chain=order.map(e=>({ pos:e.pos, kind:e.kind, text:word(e), guess:!!e.air.guess }));
    // для схемы пневматической: единицы по ходу воздуха и очистка конденсата (масловодоотделитель — не на линии)
    const units=order.map(e=>({ pos:e.pos, kind:e.kind, qty:e.qty||1, name:e.name, brief:e.brief, short:e.short, air:e.air }));
    const cond=eq.filter(e=>e.kind==='filter' && e.air && e.air.grade==='cond' && e.place!==false).map(e=>({ pos:e.pos, qty:e.qty||1, name:e.name, brief:e.brief }));
    return { chain, q, bar, issues:iss, recs, cls:cl ? String(cls) : '', units, cond };
  }
}

// ---------------------------------------------------------------- сосуды под давлением
// Воздушный ресивер — сосуд под давлением (ФНП ОРПД — приказ Ростехнадзора от 15.12.2020 № 536; ТР ТС 032/2013). На учёт
// в Ростехнадзоре ставят, если произведение давления, МПа, на вместимость, м³, больше 1,0 (воздух — рабочая среда 2-й группы,
// до 200 °C); давление — наибольшее рабочее на станции (компрессор), без него — расчётное ресивера. Размещают сосуды на
// открытых площадках или в отдельных зданиях, в помещении — когда иначе нельзя (п. 65), с доступом для осмотра.
class PressureVessel {
  static get LIMIT(){ return StationRules.raw('vessel.pv'); }   // МПа·м³: больше — на учёт (ФНП ОРПД)
  /** ресиверы состава: [{pos, qty, vol — л, mpa, pv — МПа·м³, reg — подлежит учёту (null — не оценить), out — снаружи}];
   *  bar — рабочее давление станции, бар (0 — неизвестно) */
  static list(eq, bar){
    return eq.filter(e=>e.kind==='receiver' && e.air && (e.place!==false || e.outside)).map(e=>{
      const vol=e.air.vol>0 ? e.air.vol : null, b=bar>0 ? bar : e.air.bar>0 ? e.air.bar : null, mpa=b ? b/10 : null;
      const pv=vol && mpa ? Math.round(mpa*vol/1000*1000)/1000 : null;
      return { pos:e.pos, qty:e.qty||1, vol, mpa, pv, reg:pv==null ? null : pv>this.LIMIT, out:!!e.outside };
    });
  }
  /** 0,8 МПа × 1,0 м³ = 0,8 */
  static text(v){ const f=x=>String(Math.round(x*100)/100).replace('.', ','); return `${f(v.mpa)} МПа × ${f(v.vol/1000)} м³ = ${f(v.pv)}`; }
}

// ---------------------------------------------------------------- нормы: проверки и технические требования
// Пожарная безопасность: категория помещения по взрывопожарной и пожарной опасности (СП 12.13130.2009) — табличка на
// двери (ППР в РФ), огнетушитель у выхода (по ППР — один на помещение) — верх корпуса не выше 1,5 м, сигнализация и пожаротушение — по
// СП 486.1311500.2020 (расчёт модулей и огнетушителей — StationFire, station-systems.js). Электрика: щит (шкафы в ряд)
// длиннее 7 м — проход с двумя выходами (ПУЭ, п. 4.1.23), двери электропомещений открываются наружу (п. 4.2.94),
// заземление и уравнивание потенциалов — гл. 1.7. Шум на рабочем месте —
// не более 80 дБА (СанПиН 1.2.3685-21). Климат: исполнение контейнера по ГОСТ 15150-69 — по наружной температуре,
// оборудование внутри — как в отапливаемом помещении. Трубопроводы — опознавательная окраска по ГОСТ Р 71918-2024, знаки
// безопасности — ГОСТ 12.4.026-2015.
class StationNorms {
  static get NOISE(){ return StationRules.raw('norm.noise'); }      // дБА на рабочем месте
  static get COLD(){ return StationRules.raw('norm.cold'); }        // нижняя рабочая температура исполнения, °C
  static get INSIDE(){ return StationRules.raw('heat.inside'); }    // внутри при работе — не ниже, °C
  static get SHIELD(){ return StationRules.raw('norm.shield'); }    // щит длиннее — два выхода, мм
  static PIPE = { air:'сжатый воздух — синий', water:'вода — зелёный', fuel:'топливо — коричневый' };
  /** уровень звука по паспорту, дБА: поле «noise» или строка «Уровень шума (звука)» */
  static dba(p){
    const n=StationEquip.num((p.attrs||{}).noise); if (n>20 && n<160) return n;
    const r=(p.rows||[]).find(x=>x && /шум|звук/i.test(String(x.k||'')) && /д\s*б/i.test(String(x.k||'')+' '+String(x.v||'')));
    const v=r ? AirChain.first(r.v) : null; return v>20 && v<160 ? v : null;
  }
  /** уровень звука нескольких источников: 10·lg Σ 10^(L/10) */
  static sum(L){ return L.length ? 10*Math.log10(L.reduce((s, v)=>s+Math.pow(10, v/10), 0)) : 0; }
  /** требования станции (из окна): {kind, fire, fireAuto, noise, tmin, tmax} */
  static req(plan){ return plan.req || {}; }

  /** замечания по нормам — в plan.issues */
  static check(plan, eq){
    const iss=plan.issues, r=this.req(plan), sys=plan.sys||{}, n=StationLayout.n, has=k=>eq.some(e=>e.place && e.kind===k);
    const lim=r.noise>0 ? r.noise : this.NOISE, tmin=Number.isFinite(r.tmin) ? r.tmin : null, tmax=Number.isFinite(r.tmax) ? r.tmax : null;
    // шум: паспортные уровни (на 1 м) складываются
    const L=eq.filter(e=>e.place && e.noise>0).flatMap(e=>Array.from({ length:e.qty }, ()=>e.noise)), tot=this.sum(L);
    if (L.length && tot>lim+0.5) iss.push({ level:'warn', text:`Шум: оборудование по паспортам — около ${Math.round(tot)} дБА, больше ${lim} дБА на рабочем месте (СанПиН 1.2.3685-21). Внутри при работе — средства защиты слуха и знак об этом на двери${sys.noise ? '' : '; снаружи — шумоизоляция контейнера (системы контейнера)'}.` });
    // климат: исполнение контейнера по наружной температуре; внутри — отопление и вентиляция
    const cl=plan.climate, lo=this.COLD[cl];
    if (tmin!=null && lo!=null && tmin<lo) iss.push({ level:'warn', text:`Наружный воздух до ${this.deg(tmin)}, а исполнение контейнера ${cl} — до ${this.deg(lo)} (ГОСТ 15150-69): нужно ${tmin<-60 ? 'особое (по согласованию)' : 'УХЛ1 или ХЛ1'}.` });
    const warm=['compressor', 'dryer', 'pump'].filter(has);
    if (warm.length && sys.heat===false && (tmin==null || tmin<this.INSIDE))
      iss.push({ level:'warn', text:`Без отопления зимой внутри ниже +${this.INSIDE} °C: ${warm.map(k=>({ compressor:'компрессоры', dryer:'осушитель', pump:'насосы' })[k]).join(', ')} работают в отапливаемом помещении — включите «Отопление» в системах контейнера.` });
    if (has('dgu') && sys.heat===false && (tmin==null || tmin<this.INSIDE)) iss.push({ level:'info', text:`ДГУ при морозе: для пуска — отопление контейнера и подогреватель двигателя.` });
    if ((has('compressor') || has('dgu')) && sys.vent===false) iss.push({ level:'warn', text:`${has('dgu') ? 'ДГУ и компрессоры выделяют' : 'Компрессоры выделяют'} тепло: без вентиляции контейнер перегревается — включите «Вентиляцию» в системах контейнера.` });
    if (tmax!=null && tmax>40 && has('compressor')) iss.push({ level:'info', text:`Летом до ${this.deg(tmax)}: компрессоры и осушитель работают обычно до +40…+45 °C — вентиляция с запасом, осушитель — с запасом производительности.` });
    // электрика: шкафы в ряд длиннее 7 м — два выхода
    const cab=(plan.items||[]).filter(i=>i.kind==='cabinet'), len=cab.reduce((s, i)=>s+Math.max(i.lx, i.ly), 0);
    if (len>this.SHIELD) iss.push({ level:'warn', text:`Шкафы вместе — ${n(len)} мм, длиннее 7 м: проход обслуживания у щита — с двумя выходами (ПУЭ, п. 4.1.23).` });
    // пожарная безопасность: категория; А и Б — взрывоопасные
    if (/^[АБ]$/.test(r.fire||'')) iss.push({ level:'warn', text:`Категория ${r.fire} — взрывопожароопасное помещение: электрооборудование во взрывозащищённом исполнении (ПУЭ, гл. 7.3), легкосбрасываемые конструкции — по проекту.` });
    if (plan.geo && plan.sys && !sys.ops && !sys.fire){ const [L0, W0]=plan.int||[0, 0];
      iss.push({ level:'info', text:`Пожарная сигнализация и пожаротушение в системах контейнера не выбраны: нужны ли — по СП 486.1311500.2020 (категория ${r.fire||'—'}, площадь ${String(Math.round(L0*W0/1e5)/10).replace('.', ',')} м²).` }); }
  }
  static deg(t){ return (t>0 ? '+' : t<0 ? '−' : '')+Math.abs(t)+' °C'; }

  /** строки технической характеристики: категория и климатическое исполнение */
  static tech(plan){
    const r=this.req(plan);
    return [r.fire ? `Категория помещения — ${r.fire}${r.fireAuto ? ' (ориентир.)' : ''}` : '', plan.climate ? `Климатическое исполнение — ${plan.climate}` : ''].filter(Boolean);
  }
  /** пункты технических требований: пожарная безопасность, электрика и окраска, шум */
  static tt(plan){
    const r=this.req(plan), med=(plan.piping||[]).some(p=>(p.lines||[]).some(l=>l.medium==='fuel')) ? 'fuel' : r.kind==='pump' ? 'water' : r.kind==='comp' ? 'air' : '';
    const dgu=(plan.items||[]).some(i=>i.kind==='dgu'), F=plan.fire;
    return [
      `Категория помещения по пожарной опасности${r.fire ? ' '+r.fire : ''} (СП 12.13130.2009${r.fireAuto ? ', уточняется расчётом' : ''}) — табличка на двери снаружи; огнетушители${F ? ' '+F.ext+' шт.' : ''} — у выхода, верх не выше 1,5 м (ППР в РФ)${F && F.auto ? `; пожаротушение — модули «Буран-2,5» на потолке, ${F.mods} шт.` : ''}; знаки безопасности — по ГОСТ 12.4.026-2015${dgu && !plan.fuel ? '; топливный бак — с поддоном, вместимость и размещение — по СП 4.13130.2013' : ''}.`,
      `Заземление и уравнивание потенциалов — по ПУЭ, гл. 1.7; трубопроводы — опознавательная окраска по ГОСТ Р 71918-2024 (ГОСТ 14202-69)${med ? ` (${this.PIPE[med]})` : ''} со стрелками направления потока; уровень звука на рабочем месте — не более ${r.noise>0 ? r.noise : this.NOISE} дБА (СанПиН 1.2.3685-21).`,
    ];
  }
}

// ---------------------------------------------------------------- отопление и вентиляция контейнера
// Теплопотери: ограждения — утеплитель (минеральная вата, λ = 0,045 Вт/(м·°C)) с поправкой на мостики холода каркаса
// (сэндвич-панели — 1,15, «Север» — 1,1, цельносварной — 1,3, морской — 1,4), двери и жалюзи с закрытыми клапанами,
// инфильтрация — 0,5 объёма в час; наружный воздух — из требований («от»), иначе — по климатическому исполнению; внутри —
// не ниже +5 °C; отсек топливного бака не отапливается (перегородка к нему — с половиной перепада). Два режима:
// оборудование остановлено — конвекторы держат +5 °C; работает самый малый агрегат — его тепло остаётся в помещении (с
// рециркуляцией тёплого воздуха — рекуперацией: компрессор — около 90 % мощности двигателя, ДГУ — радиатор и корпус около
// 58 %; без неё — только корпус, 8 %), а воздух на сжатие и горение забирается из помещения (его подогрев — потери).
// Конвекторы — по большему из режимов с запасом 10 %: число и мощность — из ряда 0,5…2,5 кВт, места — свободные участки
// стен у пола (низ 150 мм), первый — у входа, остальные — равномерно. Лето: тепло корпусов, осушителей, насосов и солнца
// отводит вентиляция с перегревом не более 5 °C; воздух охлаждения компрессоров и радиатора ДГУ — через жалюзи.
class StationHeat {
  // числа — из файла инженерных правил (StationRules, группа «Тепло и вентиляция»)
  static get LAMBDA(){ return StationRules.raw('heat.lambda'); }     // утеплитель в конструкции, Вт/(м·°C)
  static get R_SURF(){ return StationRules.raw('heat.rsurf'); }      // теплообмен у поверхностей, м²·°C/Вт
  static get BRIDGE(){ return StationRules.raw('heat.bridge'); }
  static get U_DOOR(){ return StationRules.raw('heat.u_door'); }     // утеплённая стальная дверь, Вт/(м²·°C)
  static get U_LOUVER(){ return StationRules.raw('heat.u_louver'); } // жалюзи с закрытым утеплённым клапаном
  static get ACH(){ return StationRules.raw('heat.ach'); }           // инфильтрация, объёмов в час
  static get AIR(){ return StationRules.raw('heat.air'); }           // теплоёмкость воздуха, Вт·ч/(м³·°C)
  static get RESERVE(){ return StationRules.raw('heat.reserve'); }   // запас мощности конвекторов
  static get CASE(){ return StationRules.raw('heat.case'); }         // тепло корпуса в помещение — доля мощности
  static get REC(){ return StationRules.raw('heat.rec'); }           // с рециркуляцией — доля мощности в тепло помещения
  static get LOSS(){ return StationRules.raw('heat.loss'); }         // насос — потери двигателя, осушитель — тепло конденсатора
  static get COMB(){ return StationRules.raw('heat.comb'); }         // ДГУ: воздух на горение, м³/ч на 1 кВт
  static get SUN(){ return StationRules.raw('heat.sun'); }           // солнце на крышу летом, кВт/м²
  // конвектор: [кВт, длина, мм]; высота 400, глубина 90, низ — 150 мм от пола
  static UNITS = [[0.5, 460], [1, 640], [1.5, 800], [2, 960], [2.5, 1120]];
  static CONV = { h:400, d:90, z:150, gap:300, edge:150, front:400 };

  /** расчёт по расстановке: теплопотери, режим работы, конвекторы (heaters — места), вентиляция летом */
  static calc(plan){
    const g=plan.geo, [Le, We, He]=g.ext, [Li, Wi, Hi]=plan.int, sys=plan.sys||{}, r=plan.req||{}, m=v=>v/1000, I=plan.items||[], fuel=plan.fuel;
    const rec=sys.rec!==false, cold=StationNorms.COLD[plan.climate], tout=Number.isFinite(r.tmin) ? r.tmin : cold!=null ? cold : -40;
    const tin=StationNorms.INSIDE, dT=Math.max(0, tin-tout), Lt=fuel ? fuel.x1+fuel.part : 0;
    const kind=g.sea ? 'sea' : this.BRIDGE[g.type] ? g.type : 'block', U=this.BRIDGE[kind]/(this.R_SURF+m(g.t)/this.LAMBDA);
    // ограждения отапливаемой части; перегородка к холодному отсеку бака — с половиной перепада
    const L=m(Le-Lt), W=m(We), H=m(He), A=2*(L*W+L*H+W*H)-(fuel ? W*H : 0), Apart=fuel ? m(Wi)*m(Hi) : 0;
    const doors=[], en=plan.entry, G=plan.gates; if (en && !en.sea) doors.push(m(en.w)*m(en.h));
    if (g.sea && g.door) doors.push(m(g.door[0])*m(g.door[1])); else if (G) doors.push(m(G.w)*m(G.h));   // ворота в торце (у морского — его двери)
    for (const d of plan.doors||[]) doors.push(m(d.w)*m(d.h));
    if (plan.exit) doors.push(m(plan.exit.w)*m(plan.exit.h));   // вторая дверь оператора в торце
    const dgu=I.find(i=>i.kind==='dgu'), Ad=doors.reduce((s, v)=>s+v, 0), Al=(sys.vent!==false ? 0.8 : 0)+(dgu ? m(dgu.ly)*m(dgu.h)*0.75 : 0);
    const qEnv=(U*Math.max(0, A-Ad-Al)+this.U_DOOR*Ad+this.U_LOUVER*Al)*dT+U*Apart*dT/2;
    const qInf=this.ACH*m(Li-Lt)*m(Wi)*m(Hi)*this.AIR*dT, qStop=qEnv+qInf;
    // работа: самый «холодный» режим — один агрегат (тепло в помещение минус подогрев забираемого им воздуха)
    const units=I.filter(i=>!i.tank && i.mount!=='wall' && /^(compressor|dgu|pump)$/.test(i.kind) && i.kw>0), ex=r.vent||{}, VW=[];
    // тепло в помещение при работе: компрессор с рециркуляцией — всё его тепло (паспорт или N·k, VentCalc), без неё — корпус
    const heat=i=>i.kind==='compressor' && rec ? (i.heat>0 ? i.heat : i.kw*VentCalc.k(i.ctype, ex, []))*1000 : i.kw*1000*(this.LOSS[i.kind] || (rec ? this.REC[i.kind] : 0) || this.CASE);
    const air=i=>i.kind==='compressor' ? (i.air && i.air.flow>0 ? i.air.flow*60 : i.kw*0.16*60) : i.kind==='dgu' ? (i.comb>0 ? i.comb : i.kw*this.COMB) : 0;   // м³/ч, ДГУ — по паспорту
    const run=units.map(i=>({ i, q:heat(i), a:air(i) })), net=o=>o.q-o.a*this.AIR*dT;
    const base=run.length ? run.reduce((a, b)=>net(a)<=net(b) ? a : b) : null, qRun=base ? qStop-net(base) : null;
    const need=Math.max(qStop, qRun||0)*this.RESERVE/1000, on=sys.heat!==false;
    const pick=on ? this.pick(plan, need) : { n:0, kw:0, len:0, heaters:[], short:false };
    // лето: рабочие агрегаты (без резерва)
    const tmax=Number.isFinite(r.tmax) ? r.tmax : 35, work=this.working(units, Math.max(0, r.res||0));
    const qSum=work.reduce((s, i)=>s+i.kw*1000*(this.LOSS[i.kind]||this.CASE), 0)+this.SUN*1000*m(Le)*m(We)+I.filter(i=>i.kind==='dryer').reduce((s, i)=>s+(i.kw||0)*1000, 0);
    // лето (VentCalc): охлаждение компрессоров — по паспорту, иначе Q = N·k при Δt = t_вн − t_нар; помещение — тем же Δt;
    // не меньше 3 объёмов в час; радиатор ДГУ — по паспорту, иначе по мощности (нагрев на 10 °C)
    const rad=Math.round(work.filter(i=>i.kind==='dgu').reduce((s, i)=>s+(i.cool>0 ? i.cool : i.kw*1000*0.5/(this.AIR*10)), 0));
    const V=m(Li-Lt)*m(Wi)*m(Hi), comp=work.filter(i=>i.kind==='compressor');
    const vc={ units:comp.map(i=>({ key:StationLayout.key(i), pos:i.pos, type:i.ctype, kw:i.kw, heat:i.heat, cool:i.cool })), qRoom:qSum/1000, use:work.reduce((s, i)=>s+air(i), 0), V, tSum:tmax, tWin:tout, tInMin:tin, ex };
    const S=VentCalc.summer(vc, VW);
    // зима: потери ограждений (U по утеплителю) и минимального воздухообмена против тепла работающего (самый холодный режим)
    const Wn=VentCalc.winter({ ...vc, env:{ U, A, qEnv }, Qrun:base ? base.q/1000 : 0, useRun:base ? base.a : 0 }, S, VW), Rc=VentCalc.recup(!!sys.hrv, Wn, vc, VW);
    return { tout, tin, dT, rec, on, U:Math.round(U*1000)/1000, A:Math.round(A*10)/10, qEnv:Math.round(qEnv), qInf:Math.round(qInf), qStop:Math.round(qStop),
      base:base ? { pos:base.i.pos, kind:base.i.kind, q:Math.round(base.q), a:Math.round(base.a) } : null, qRun:qRun==null ? null : Math.round(qRun),
      need:Math.round(need*100)/100, n:pick.n, kw:pick.kw, total:Math.round(pick.n*pick.kw*10)/10, short:pick.short, heaters:pick.heaters,
      vent:{ tmax, m3h:S.Lroom+S.use, use:S.use, cool:S.Lcool, rad, sum:S, win:Wn, rec:Rc, warn:VW, ex } };
  }
  /** воздух охлаждения компрессора i, м³/ч — из летнего расчёта (VentCalc) */
  static coolOf(i, plan){ const S=plan && plan.heat && plan.heat.vent && plan.heat.vent.sum, u=S && S.units.find(q=>q.key===StationLayout.key(i)); return u ? u.cool : (i.cool>0 ? i.cool : 0); }
  /** рабочие агрегаты: без res самых мощных каждого вида (резерв) */
  static working(units, res){
    const out=[]; for (const k of ['compressor', 'pump', 'dgu']){ const L=units.filter(i=>i.kind===k).sort((a, b)=>b.kw-a.kw); out.push(...(L.length>res ? L.slice(res) : L.slice(-1))); }
    return out;
  }
  /** число и мощность конвекторов: наименьший избыток, лишний конвектор — штраф; мест на стенах не хватает — сколько есть */
  static pick(plan, need){
    if (!(need>0)) return { n:0, kw:0, len:0, heaters:[], short:false };
    let best=null;
    const nMin=Math.max(need>1.2 ? 2 : 1, Math.ceil((plan.int[0]-(plan.geo.x0||0))/4500));   // равномерно: конвектор на 4,5 м длины
    for (const [kw, len] of this.UNITS){ const S=this.spots(plan, len), n=Math.max(nMin, Math.ceil(need/kw-1e-9));
      if (n>S.length) continue; const score=(n*kw-need)/need+0.15*n; if (!best || score<best.score) best={ n, kw, len, score, S }; }
    if (!best) for (const [kw, len] of this.UNITS){   // мест на все не хватает — сколько поместится, с наибольшей мощностью
      const S=this.spots(plan, len), n=Math.min(S.length, Math.ceil(need/kw-1e-9));
      if (!best || n*kw>best.n*best.kw+1e-9) best={ n, kw, len, S }; }
    return { n:best.n, kw:best.kw, len:best.len, short:best.n*best.kw<need-1e-9, heaters:this.spread(best.S, best.n, plan, best.kw) };
  }
  /** свободные места конвектора длиной len у пола: участки стен без оборудования перед ними (не ближе 400 мм), шкафов,
   *  дверей, жалюзи радиатора ДГУ и тамбура; в стене прохода — только где проход остаётся не уже допустимого */
  static spots(plan, len){
    const [L, W]=plan.int, C=this.CONV, x0=plan.geo.x0||0, I=(plan.items||[]).filter(i=>!i.tank), aMin=(plan.aisleRule||[1000, 800])[1], out=[];
    const fl=I.filter(i=>i.mount==='floor' || i.mount==='frame'), B={ front:[], back:[], left:[], right:[] };
    for (const i of fl){
      if (i.y<C.d+C.front || (i.y<W/2 && i.y-C.d<aMin)) B.front.push([i.x, i.x+i.lx]);
      if (i.y+i.ly>W-C.d-C.front) B.back.push([i.x, i.x+i.lx]);
      if (i.x<x0+C.d+C.front) B.left.push([i.y, i.y+i.ly]);
      if (i.x+i.lx>L-C.d-C.front) B.right.push([i.y, i.y+i.ly]); }
    for (const i of I.filter(i=>i.mount==='wall' && B[i.wall])) B[i.wall].push(i.wall==='front' || i.wall==='back' ? [i.x, i.x+i.lx] : [i.y, i.y+i.ly]);   // не под шкафом
    const en=plan.entry, G=plan.gates; if (en) B[en.wall].push(en.wall==='front' ? [en.x0, en.x1] : [en.y0, en.y1]);
    if (G) B[G.wall].push([G.y0, G.y1]);
    for (const d of plan.doors||[]) B[d.wall==='back' ? 'back' : 'front'].push([d.x0, d.x1]);
    if (plan.exit) B[plan.exit.wall].push([plan.exit.y0, plan.exit.y1]);
    const dgu=fl.find(i=>i.kind==='dgu'); if (dgu) B.right.push([dgu.y-200, dgu.y+dgu.ly+200]);
    if (plan.geo.type==='north' && x0>0) B.left.push([W-1100, W]);   // дверь тамбура «Севера» — у задней стены
    for (const [w, a0, b0] of [['front', x0, L], ['back', x0, L], ['left', 0, W], ['right', 0, W]]){
      const bl=B[w].map(([a, b])=>[a-100, b+100]).sort((p, q)=>p[0]-q[0]), free=[]; let a=a0+C.edge;
      for (const [p, q] of bl){ if (p>a) free.push([a, Math.min(p, b0-C.edge)]); a=Math.max(a, q); }
      if (b0-C.edge>a) free.push([a, b0-C.edge]);
      for (const [p, q] of free){ const k=Math.floor((q-p+C.gap)/(len+C.gap)); if (k<1) continue;
        const step=(q-p-k*len)/(k+1);
        for (let j=0; j<k; j++){ const u=Math.round(p+step*(j+1)+j*len);
          out.push(w==='front' ? { wall:w, x:u, y:0, lx:len, ly:C.d } : w==='back' ? { wall:w, x:u, y:W-C.d, lx:len, ly:C.d }
            : w==='left' ? { wall:w, x:x0, y:u, lx:C.d, ly:len } : { wall:w, x:L-C.d, y:u, lx:C.d, ly:len }); } } }
    return out.map(o=>Object.assign(o, { z:C.z, h:C.h, cx:o.x+o.lx/2, cy:o.y+o.ly/2 }));
  }
  /** n мест из свободных: первое — ближе ко входу (холодный воздух), следующие — дальше всего от уже выбранных */
  static spread(S, n, plan, kw){
    if (!n || !S.length) return [];
    if ((plan.items||[]).some(i=>i.kind==='dgu') && S.filter(s=>s.wall!=='left').length>=n) S=S.filter(s=>s.wall!=='left');   // у ДГУ торец у входа — под приток
    const x0=plan.geo.x0||0, W=plan.int[1], D=(plan.doors||[])[0];
    const en=plan.entry, E=en ? (en.wall==='front' ? [(en.x0+en.x1)/2, 0] : [x0, (en.y0+en.y1)/2]) : D ? [(D.x0+D.x1)/2, D.wall==='back' ? W : 0] : [x0, W/2];
    const d=s=>Math.hypot(s.cx-E[0], s.cy-E[1]), got=[S.reduce((a, b)=>d(a)<=d(b) ? a : b)];
    while (got.length<n){ let best=null, bd=-1;
      for (const s of S){ if (got.includes(s)) continue; const q=Math.min(...got.map(t=>Math.hypot(s.cx-t.cx, s.cy-t.cy))); if (q>bd){ bd=q; best=s; } }
      if (!best) break; got.push(best); }
    return got.map(s=>({ kind:'heater', wall:s.wall, x:s.x, y:s.y, z:s.z, lx:s.lx, ly:s.ly, h:s.h, kw }));
  }
  static kw(v){ return String(Math.round(v*10)/10).replace('.', ','); }
  /** сведения для окна «Компоновка» и требований */
  static notes(plan){
    const h=plan.heat; if (!h) return;
    const iss=plan.issues, k=v=>this.kw(v/1000), t=StationNorms.deg(h.tout), nm={ compressor:'компрессор', dgu:'ДГУ', pump:'насос' };
    if (h.on){
      const run=h.base ? (h.qRun<=0 ? ` При работе ${nm[h.base.kind]||'агрегат'} поз. ${h.base.pos} даёт ${k(h.base.q)} кВт тепла${h.rec && h.base.kind!=='pump' ? ' (рециркуляция тёплого воздуха — рекуперация)' : ''} — потери покрыты, конвекторы отключаются терморегуляторами.`
        : ` При работе поз. ${h.base.pos}: ${k(h.base.q)} кВт тепла, подогрев забираемого воздуха ${k(h.base.a*this.AIR*h.dT)} кВт — конвекторы нужны и при работе (${k(h.qRun)} кВт).`) : '';
      iss.push({ level:'info', text:`Отопление: теплопотери при ${t} снаружи — ${k(h.qStop)} кВт (ограждения ${k(h.qEnv)}, воздух ${k(h.qInf)}; внутри +${h.tin} °C).${run} Конвекторы: ${h.n} × ${this.kw(h.kw)} кВт = ${this.kw(h.total)} кВт (запас 10 %) — у стен, места на чертеже и 3D-виде.` });
      if (h.short) iss.push({ level:'warn', text:`Отопление: нужно ${this.kw(h.need)} кВт, а свободных мест на стенах — для ${this.kw(h.total)} кВт: добавьте мощность иначе (тепловентилятор, обогрев пола) или освободите стену.` });
      if (!h.rec && h.qRun>h.qStop) iss.push({ level:'info', text:`Без рециркуляции тёплого воздуха при работе отопление больше: подогрев воздуха на сжатие или горение. С рекуперацией (заслонка с термостатом на выбросе тёплого воздуха) — тепло оборудования остаётся в помещении.` });
    }
    StationVent.notes(plan);   // вентиляция летом: расходы, сечения, размеры и места жалюзи
  }
}

// ---------------------------------------------------------------- расстановка
// Оборудование на полу стоит рядами вдоль длинных стен лицевой стороной к проходу обслуживания: один ряд у задней стены
// (проход — вдоль стены с дверью) или, если не хватает длины и позволяет ширина, два ряда с проходом посередине. ДГУ — в
// дальнем торце радиатором к жалюзи, дополнительный топливный бак — рядом с ДГУ. Настенные шкафы — на стене прохода
// напротив оборудования (проход перед ними — не уже 600 мм), магистральные фильтры — на трубопроводе (висят на линии после
// осушителя); не нашлось места — своё место в ряду. Прохода внутри не получается — оборудование обслуживается снаружи
// через сервисные двери с любой стороны: один ряд лицом к стене с дверями или два ряда спиной друг к другу (двери в обеих
// стенах), ДГУ — посередине, двери с обеих сторон. Глушитель ДГУ — на крыше прямо над ДГУ. Отступы: сначала «не менее»
// (помещается ли), затем свободное место раздаётся до рекомендуемых; остаток длины — у двери. Блок-контейнер без своего
// размера — по необходимому месту (шаг 100 мм, наименьшая площадь пола); заданный контейнер, в который не помещается, —
// ошибка и подсказка, какой подойдёт; контейнер с большим запасом — подсказка, какой меньший подойдёт.
class StationLayout {
  static VER = 16;          // версия правил и рисунков: изменилась — картинки станций в КП пересобираются
  static MAX_L = 12000;
  static PIPE_PAD = 60;      // зазор вокруг фильтра на трубопроводе, мм
  static AIR_Y = 150;        // линия сжатого воздуха: ось — в 150 мм от задней стены (или посередине между рядами)
  // сервисные двери: проём шире оборудования на 200 мм (от 800 до 2400), створка до 1200, высота 2000, от углов — 100
  static DOOR = { min:800, max:2400, leaf:1200, h:2000, pad:100 };
  // входная дверь оператора в стене прохода блок-контейнера: проём от торца (за тамбуром), мм — дверь в свету (матрица:
  // 900–1000 × 2000–2100) и коробка 50 мм с каждой стороны
  static get ENTRY(){ const d=StationMatrix.door(); return [300, 300+d.w+100]; }
  static get DOOR_MIN(){ return StationMatrix.door().w; }   // дверь оператора — не уже 900 мм в свету
  static PASS = 25;          // вынос агрегата через проём и по проходу (на роликах): зазор с каждой стороны, мм
  static TILT = /^(receiver|filter|cabinet|tank)$/;   // при выносе можно наклонить (сосуд, фильтр, шкаф, бак); остальное — стоя (масло, хладагент)
  static REAR_H = 1500;      // сервисные ворота за агрегатом — не проход, а проём обслуживания: по высоте агрегата (матрица), не ниже 1500 мм
  static GATE = { min:1500, add:400, h:2000 };   // распашные ворота для демонтажа в торце: не уже 1500 мм и шире агрегата на 400 мм, не ниже 2000 мм
  static CAB_TOP = 1900;     // настенный шкаф: верх — на 1,9 м от пола (рукоятки и панель оператора — на уровне глаз),
  static CAB_LOW = 300;      // низ — не ниже 300 мм
  static ROOF_GAP = 200;     // глушитель на опорах над крышей, мм
  static OUTLET = 300;       // вывод выхлопа — горизонтально в сторону радиатора (от входа и воздухозаборов), мм
  static ROAD_H = 4000;      // наибольшая высота при перевозке (с платформой), мм
  static OUT_GAP = 1000;     // ресивер снаружи: от торцевой стены — проход для осмотра и обслуживания, мм
  static OUT_STEP = 600;     // между ресиверами снаружи, мм
  static PAD = 100;          // бетонная площадка под ресивером снаружи: высота над землёй, мм; выступ за ресивер — 200 мм

  static solve(input){ return new StationLayout(input).run(); }

  /** отпечаток всего, от чего зависит компоновка: изменился — чертёж и 3D-вид пора обновить */
  static hash(input){
    const c=input.cont||{}, pick=a=>a ? {cat:a.cat, size:a.size, mass:a.mass, model:a.model, maker:a.maker, orient:a.orient, kw:a.kw, volume:a.volume, color:a.color, flow:a.flow, pressure:a.pressure, stage:a.stage, dryer:a.dryer, vsd:a.vsd, dewPoint:a.dewPoint, receiver:a.receiver} : null;
    const s=JSON.stringify([this.VER, StationClear.aisle(), [c.ctype, c.size, c.sizeAuto, c.ins, c.ral, c.sys||null, c.climate||'', c.roof||'', StationGeo.floor(c)], input.chassisH||null, input.recv||'', !!input.recvOut, input.req||null,
      (input.parts||[]).filter(p=>p && p.role!=='container').map(p=>[p.name, p.qty, p.role||'', p.pipeMat||'', p.dn||'', p.mount||'', pick(p.attrs), StationEquip.tint(p), (p.rows||[]).filter(r=>r && /габарит|размер|масса|вес|цвет|окраск|покрыт|длина|ширина|высота|объ[её]м|RAL|установк|исполнен|производительн|пропускн|давлени|ступен|очистк|фильтр|осушител|регулирован|точк\S* росы|воздух|теплов|охлажд/i.test(String(r.k||'')+' '+String(r.v||''))).map(r=>[r.k, r.v]), StationEquip.pic(p)])]);
    return this.fnv(s);
  }
  /** FNV-1a, 8 шестнадцатеричных знаков */
  static fnv(s){
    let h=0x811c9dc5; for (let i=0; i<s.length; i++){ h^=s.charCodeAt(i); h=Math.imul(h, 0x01000193)>>>0; }
    return h.toString(16).padStart(8, '0');
  }

  constructor(input){
    this.in=input||{}; this.cont=this.in.cont||null;
    this.eq=StationEquip.list(this.in.parts||[], { recv:this.in.recv, recvOut:this.in.recvOut });
    this.aisle0=StationClear.aisle(); this.aisle=this.aisle0; this.mode={};
    // зазор на коммуникации у стен (по длине и ширине — с обеих сторон) и под потолком: полезные размеры компрессорной
    // = внутренние − 2·G (по высоте — G под потолком: у пола коммуникаций нет); ДГУ и насосные — по своим нормам
    this.comp=this.eq.some(e=>e.kind==='compressor') && !this.eq.some(e=>e.kind==='dgu');
    this.G=this.comp ? StationMatrix.gap() : 0;
  }

  // ---- исключения, чтобы станция прошла по габариту перевозки (решение ПНЕВМОТЕХ, компрессорная): проход оператора — до
  // 500 мм (norm.aisle_tight); без сквозного прохода — агрегат поперёк станции и вторая дверь оператора (доступ ко всему
  // оборудованию — с разных сторон). Сначала — как обычно; исключения — только если иначе не помещается (негабарит — после них)
  static get TIGHT(){ return Math.max(600, StationRules.opt('norm.aisle_tight') || 600); }
  /** режимы по порядку: обычный, проход до 500 мм, без сквозного прохода, оба */
  modes(){ return this.comp ? [{}, { tight:true }, { cross:true }, { cross:true, tight:true }] : [{}]; }
  /** выполнить fn в режиме m (проход «не менее» — 500 мм; агрегат поперёк) */
  withMode(m, fn){
    const a=this.aisle, md=this.mode; this.mode=m||{};
    this.aisle=this.mode.tight ? [this.aisle0[0], Math.min(this.aisle0[1], StationLayout.TIGHT)] : this.aisle0;
    try{ return fn(); } finally{ this.aisle=a; this.mode=md; }
  }
  /** замечания режима-исключения: что сделано и почему (согласовать с заказчиком) */
  modeNotes(r, m, geo){
    const n=StationLayout.n, why=geo.auto || geo.road ? `станция прошла по габариту перевозки без спецразрешения (ширина до ${n(StationGeo.ROAD_W)} мм)` : 'оборудование поместилось в заданный контейнер';
    if (m.tight){ const w=r.aisle && r.aisle.w; r.aisleRule=[this.aisle0[0], Math.min(this.aisle0[1], StationLayout.TIGHT)];
      if (w<this.aisle0[1]) r.issues.push({ level:'warn', text:`Проход оператора сужен до ${n(w)} мм (норма — не менее ${n(this.aisle0[1])} мм, ПУЭ, п. 4.1.23): исключение, чтобы ${why}. Согласуйте с заказчиком.` }); }
    if (m.cross && r.cross) r.issues.push({ level:'warn', text:`Сквозного прохода нет: поз. ${r.cross.pos} стоит поперёк станции лицом к входу — к нему спереди и к оборудованию до него подходят от двери оператора, к нему сзади и к оборудованию за ним — через вторую дверь оператора. Доступ ко всему оборудованию остаётся с разных сторон. Исключение, чтобы ${why}.` });
    r.mode=m;
  }

  run(){
    const placed=this.eq.filter(e=>e.place), extra=this.eq.filter(e=>!e.place);
    const base={ items:[], extra, chassis:extra.some(e=>e.kind==='chassis'), muffler:extra.some(e=>e.kind==='muffler'), aisleRule:this.aisle, issues:[] };
    if (!this.cont) return Object.assign(base, { level:'none', text:'Выберите контейнер в составе станции.' });
    if (!placed.length) return Object.assign(base, { level:'none', text:'Добавьте в состав оборудование — компрессор, насос, ДГУ и т. п.' });
    let units=this.units(placed);
    const g0=StationGeo.of(this.cont), Wi=g0.int ? g0.int[1] : StationGeo.inner(g0.type, [10000, StationGeo.ROAD_W, 2600], g0.t)[1];
    this.tank=this.tankRoom(units, Wi);        // ДГУ с дополнительным баком — бак в отдельном отсеке у ближнего торца
    if (this.tank) units=units.filter(e=>e.kind!=='tank');
    const geo=this.geoOf(this.cont);
    let plan=geo.auto ? this.autoSize(units, geo) : this.fit(units, geo);
    if (plan.level==='error' && !geo.auto) plan.suggest=this.suggest(units, geo);   // какой контейнер нужен (с проходом)
    else if (plan.level!=='error' && !geo.auto) this.excess(units, geo, plan);
    if (plan.level!=='error' && plan.items && plan.items.length){ plan.roof=this.roof(plan); plan.piping=this.route(plan); plan.outside=this.outside(plan, extra.some(e=>e.kind==='chassis')); }
    // «не помещается» точно, если не помещается и без оборудования с условными габаритами; иначе — лишь оценка (assumed)
    if (plan.level==='error' && units.some(e=>!e.known)){ const k=units.filter(e=>e.known);
      plan.assumed=!k.length || (geo.auto ? this.autoSize(k, geo) : this.fit(k, geo)).level!=='error'; }
    plan=Object.assign(base, plan, { issues:plan.issues||[] }, this.colors());
    const air=AirChain.check(this.eq, this.in.air);
    if (air && plan.level!=='error'){ plan.air=air; plan.issues.push(...air.issues); }
    plan.vessels=PressureVessel.list(this.eq, Math.max(0, ...this.eq.filter(e=>e.kind==='compressor' && e.air).map(e=>e.air.bar||0)));
    plan.req=this.in.req||null; plan.climate=(this.cont && this.cont.climate)||'';
    if (plan.geo && plan.geo.ext) plan.geo.rise=StationGeo.rise(plan.geo.roof, plan.geo.ext[1]);
    if (plan.level!=='error' && plan.geo && plan.geo.ext && plan.int){ plan.heat=StationHeat.calc(plan); plan.fire=StationFire.calc(plan);
      plan.light=StationLight.calc(plan); plan.sockets=StationSockets.calc(plan); plan.power=StationPower.calc(plan); plan.pipe=StationPipe.calc(plan); plan.mass=StationMass.calc(plan);
      plan.vent=StationVent.calc(plan);   // жалюзи: размеры по расходу воздуха, места — мимо дверей, шкафов, конвекторов и знаков
      if (plan.fire.low) plan.issues.push({ level:'info', text:`Высота помещения ${StationLayout.n(plan.int[2])} мм — ниже паспортной высоты установки модулей «Буран-2,5» (2,5–3,5 м): зона тушения — по диаграмме распыла изготовителя при этой высоте (согласовать с проектировщиком пожаротушения).` });
      const pq=plan.pipe; if (pq && pq.small) plan.issues.push({ level:'warn', text:`Трубопровод DN ${pq.set} меньше расчётного DN ${pq.dn} (${pq.why}): скорость больше ${String(pq.lines[0].v).replace('.', ',')} м/с — потери давления и шум. Укажите DN ${pq.dn} в составе станции.` }); }
    if (plan.level!=='error') StationNorms.check(plan, this.eq);
    this.notes(plan);
    if (plan.level==='ok' && plan.issues.some(i=>i.level==='warn')) plan.level='warn';
    return plan;
  }

  /** единицы оборудования в порядке расстановки от двери: шкафы, остальное по составу (сжатый воздух — по ходу воздуха:
   *  компрессоры, ресивер, фильтры, осушитель…), топливный бак, ДГУ — в дальнем торце */
  units(placed){
    const u=[]; for (const e of placed) for (let k=0; k<e.qty; k++) u.push(Object.assign({}, e, { unit:k, c:this.clear(e), air:AirChain.unit(e.air, k) }));
    const dgu=placed.some(e=>e.kind==='dgu'), air=placed.some(e=>e.kind==='compressor');
    const rank=e=>e.kind==='cabinet' ? 0 : e.kind==='dgu' ? 2 : e.kind==='tank' && dgu ? 1.5 : air && e.air && e.air.stage!=null ? 1+e.air.stage/100 : air ? 1.8 : 1;
    return u.map((e, i)=>[e, i]).sort((a, b)=>rank(a[0])-rank(b[0]) || a[1]-b[1]).map(([e])=>e);
  }
  /** отступы агрегата: нормы вида (StationClear) и матрица расстановки — от стены за ним max(база, коэф · D); «плотно» —
   *  только виду, который обслуживают сзади через сервисные ворота (компрессор, …); у остальных — не меньше нормы вида */
  clear(e){
    const c=StationClear.of(e.kind, e), w=StationMatrix.wall(e); if (!w || e.kind==='dgu' || e.kind==='cabinet' || e.kind==='tank') return c;
    return { ...c, back:[w[0], StationLayout.gated(e.kind) ? w[1] : Math.max(w[1], Math.min(w[0], c.back[1]))] };
  }
  /** вид обслуживают сзади (матрица: сторона «З») и ему допускаются сервисные ворота за ним (ДГУ — своя дверь-жалюзи) */
  static gated(kind){ return kind!=='dgu' && kind!=='cabinet' && kind!=='tank' && StationMatrix.sides(kind).B; }
  // ДГУ с дополнительным топливным баком: бак — в отдельном отсеке у ближнего торца. Отсек отделён противопожарной
  // перегородкой 1-го типа (EI 45, без проёмов; топливопровод — через гильзу с уплотнением), вход — своя дверь снаружи,
  // заливная горловина — снаружи в запираемом ящике, дыхательный клапан с огнепреградителем — над крышей, бак — в поддоне
  // на полный объём, в отсеке — естественная вентиляция (жалюзи внизу и вверху)
  static TANK = { pad:300, gap:300, back:100, aisle:600, part:100, door:800, fill:1000 };
  /** отсек бака: {units — [{e, lx — вдоль контейнера, ly — поперёк}], room — длина отсека внутри, len — с перегородкой};
   *  бак — поперёк, если перед ним остаётся проход (отсек короче); нет ДГУ или бака — null. Wi — ширина внутри */
  tankRoom(units, Wi){
    const T=units.filter(e=>e.kind==='tank'); if (!T.length || !units.some(e=>e.kind==='dgu')) return null;
    const C=StationLayout.TANK, U=T.map(e=>{ const a=Math.max(e.l, e.w), b=Math.min(e.l, e.w); return Wi-C.back-a>=C.aisle ? { e, lx:b, ly:a } : { e, lx:a, ly:b }; });
    const body=U.reduce((s, u)=>s+u.lx, 0)+C.gap*(U.length-1), room=Math.max(body+2*C.pad, C.door+2*C.pad);
    return { units:U, room, len:room+C.part };
  }
  /** геометрия контейнера: оборудование — после отсека бака (и тамбура «Севера») */
  geoOf(c){ const g=StationGeo.of(c); if (this.tank) g.x0=(g.x0||0)+this.tank.len; return g; }
  /** баки — в отсеке вдоль задней стены (в поддоне); дверь отсека — в стене прохода посередине отсека; горловина — снаружи
   *  в торце напротив бака (у морского контейнера в торце — его двери: горловина в задней стене за баком) */
  tankPlace(r, geo){
    const [, W, H]=geo.int, C=StationLayout.TANK, t=this.tank, n=StationLayout.n; let x=C.pad;
    for (const { e, lx, ly } of t.units){ const y=Math.max(0, W-C.back-ly);
      r.items.push(this.unitItem(e, { x, y, z:0, lx, ly, rot:lx<e.l, mount:'floor', face:-1, row:0, back:C.back, aisle:y, tank:true })); x+=lx+C.gap; }
    const T=r.items.filter(i=>i.tank), d0=Math.round((t.room-C.door)/2), f=T[0];
    r.fuel={ x1:t.room, part:C.part, door:{ x0:d0, x1:d0+C.door }, fill:geo.sea ? { wall:'back', x:Math.round(f.x+f.lx/2), z:C.fill } : { wall:'left', y:Math.round(f.y+f.ly/2), z:C.fill } };
    const iss=r.issues=r.issues||[], aisle=Math.min(...T.map(i=>i.y));
    if (aisle<C.aisle) iss.push({ level:'warn', text:`Отсек топливного бака: проход перед баком ${n(aisle)} мм — меньше ${n(C.aisle)} мм.` });
    for (const i of T) if (i.h+200>H){ r.bad=true; iss.push({ level:'error', text:`Топливный бак поз. ${i.pos} не проходит по высоте отсека: ${n(i.h)} мм, внутри ${n(H)} мм.` }); }
  }
  /** в два ряда — в задний ряд: ДГУ; аппараты цепочки сжатого воздуха (если есть компрессоры) — подряд по ходу воздуха;
   *  ресиверы — в любом ряду (решение ПНЕВМОТЕХ: ресиверы можно ставить в два ряда) */
  backRow(e, units){ return e.kind==='dgu' || (units.some(u=>u.kind==='compressor') && ((StationLayout.series(e) && e.kind!=='receiver') || (e.slot && e.kind==='filter'))); }
  /** аппарат на линии сжатого воздуха с одним входом и одним выходом (ресивер, осушитель, фильтр на полу) */
  static series(e){ return !!e.air && e.air.stage!=null && e.kind!=='compressor' && e.mount!=='pipe' && !e.pipe; }
  static key(e){ return e.id+'#'+e.unit; }

  /** перед оборудованием [рекомендуется, не менее]: проход обслуживания (вдоль ДГУ «не менее» — своё) */
  front(e){
    return [this.aisle[0], e.c.front!=null ? Math.min(this.aisle[1], e.c.front) : this.aisle[1]];
  }

  // ---- высота: оборудование + место над ним; настенный шкаф — от 300 мм над полом; фильтры висят на трубе
  heights(units, H){
    const iss=[], n=StationLayout.n; let bad=false;
    for (const e of units){ if (e.unit || e.pipe) continue;
      if (e.mount==='wall'){ if (e.h+StationLayout.CAB_LOW>H-50){ bad=true; iss.push({ level:'error', text:`Поз. ${e.pos} «${e.short}» не помещается на стене по высоте: ${n(e.h)} мм и не ниже ${n(StationLayout.CAB_LOW)} мм от пола, а высота внутри — ${n(H)} мм.` }); } continue; }
      const top=e.c.top, room=H-e.h;
      if (room<top[1]){ bad=true; iss.push({ level:'error', text:`Поз. ${e.pos} «${e.short}» не проходит по высоте: ${n(e.h)} мм и не менее ${n(top[1])} мм над ним, а высота внутри — ${n(H)} мм.${e.kind==='receiver' ? ` Замените на горизонтальный ресивер или несколько меньших${e.air && e.air.vol>0 ? ` (например, 2 × ${n(Math.ceil(e.air.vol/2/100)*100)} л)` : ''}, либо ресивер — снаружи (ФНП ОРПД, п. 65).` : ''}` }); }
      else if (room<top[0]){
        if (e.kind==='compressor') iss.push({ level:'info', text:`Над компрессором (поз. ${e.pos}) ${n(room)} мм до потолка — горячий воздух отводится воздуховодом (в помещении рекомендуется 1 м).` });
        else iss.push({ level:'warn', text:`Над поз. ${e.pos} «${e.short}» ${n(room)} мм до потолка — рекомендуется ${n(top[0])} мм.` }); }
    }
    return { bad, iss };
  }

  // ---- один ряд: у задней стены лицом к проходу
  row1(units, Lu, W, noRotate){
    const U=units.map(e=>({ e, rot:false }));
    const depth=o=>o.rot ? o.e.l : o.e.w, lenX=o=>o.rot ? o.e.w : o.e.l;
    const canRot=o=>!noRotate && StationMatrix.rot(o.e.kind) && o.e.shape==='box' && o.e.l>o.e.w+50;   // шкаф — дверцами к проходу
    const need=o=>depth(o)+o.e.c.back[1]+this.front(o.e)[1], wide=o=>need(o)<=W;
    for (const o of U) if (!wide(o) && canRot(o)){ o.rot=true; if (!wide(o)) o.rot=false; }
    const narrow=U.filter(o=>!wide(o));
    if (narrow.length) return { ok:false, why:'width', bad:narrow.map(o=>o.e), needW:Math.max(...narrow.map(need)) };
    const len=lvl=>this.chain(U.map(o=>o.e), lvl).sum+U.reduce((s, o)=>s+lenX(o), 0);
    if (len(1)>Lu){   // не хватает длины — поворачиваем поперёк то, что позволяет ширина (сначала дающее больше длины)
      for (const o of U.filter(canRot).sort((a, b)=>(b.e.l-b.e.w)-(a.e.l-a.e.w))){ o.rot=true; if (!wide(o)){ o.rot=false; continue; } if (len(1)<=Lu) break; } }
    const lv=this.squeeze(U, len, Lu, wide, noRotate);
    if (len(lv)>Lu) return { ok:false, why:'length', needL:len(1), needL0:len(0) };
    return this.place([U], Lu, W, depth, lenX, lv);
  }
  /** не хватает длины (после поворотов): крайний случай — ресиверы и фильтры вплотную в линию (только в заданном
   *  контейнере: подобранный по размеру просто длиннее), затем ресиверы парой — один за другим поперёк. Уровень промежутков
   *  «не менее»: 1 или 2 (вплотную) */
  squeeze(U, len, Lu, wide, noRotate){
    if (len(1)<=Lu) return 1;
    if (this.closeOk && len(2)<=Lu) return 2;
    if (!noRotate) this.pairs(U, wide, ()=>len(1)<=Lu || (this.closeOk && len(2)<=Lu));   // ресиверы — парой (один за другим)
    // самый крайний случай — без прохода к боку агрегата у торца (замечание в «Доступ к оборудованию»)
    return len(1)<=Lu || !this.closeOk ? 1 : len(2)<=Lu ? 2 : 3;
  }

  // ---- ресиверы в два ряда: соседние — парой, один за другим (задний — ближе к стене); осмотр заднего — сбоку, через
  // промежутки между ресиверами; пара — как один агрегат в ряду (глубина — два ресивера и промежуток между ними)
  pairs(U, wide, done){
    for (let k=0; k<U.length-1 && !done(); k++){ const a=U[k], b=U[k+1];
      if (a.pair || b.pair || a.rot || b.rot || a.e.kind!=='receiver' || b.e.kind!=='receiver' || a.e.slot || b.e.slot) continue;
      const gap=Math.max(a.e.c.side[1], b.e.c.side[1]), e=Object.assign({}, a.e, { l:Math.max(a.e.l, b.e.l), w:a.e.w+gap+b.e.w, h:Math.max(a.e.h, b.e.h), pairD:Math.max(a.e.w, b.e.w) });
      const o={ e, rot:false, pair:[a.e, b.e], gap }; if (!wide(o)) continue;
      U.splice(k, 2, o); }
  }
  /** пара ресиверов → два места: передний — у прохода, задний — за ним */
  unpair(it, geo){
    const [f, b]=it.o.pair, g=it.o.gap, mk=(e, y, d, back, aisle)=>this.item({ o:{ e, rot:false }, ri:it.ri, x:it.x+Math.round((it.lx-e.l)/2), lx:e.l, d, y, face:it.face, back, aisle }, geo);
    return [Object.assign(mk(f, it.y, f.w, it.back+g+b.w, it.aisle), { pair:true }), Object.assign(mk(b, it.y+f.w+g, b.w, it.back, it.aisle+f.w+g), { pair:true })];
  }

  // ---- два ряда у длинных стен, проход посередине
  row2(units, Lu, W, noRotate){
    const A=[], B=[], dep=o=>o.rot ? o.e.l : o.e.w, lx=o=>o.rot ? o.e.w : o.e.l, lenOf=(R, lvl)=>this.chain(R.map(o=>o.e), lvl).sum+R.reduce((s, o)=>s+lx(o), 0);
    let rr=null;   // ресиверы — подряд в одном ряду (друг за другом)
    for (const e of units){ const o={ e, rot:false };
      if (this.backRow(e, units)) B.push(o); else if (e.kind==='receiver' && rr) rr.push(o); else { const R=lenOf(A, 1)<=lenOf(B, 1) ? A : B; R.push(o); if (e.kind==='receiver') rr=R; } }
    if (!A.length || !B.length) return { ok:false, why:'rows' };
    const dmax=R=>Math.max(...R.map(o=>dep(o)+o.e.c.back[1])), aMin=Math.max(...[...A, ...B].map(o=>this.front(o.e)[1])), fits=()=>W-dmax(A)-dmax(B)>=aMin;
    if (!fits()) return { ok:false, why:'width2' };
    let lv=1; const L=()=>Math.max(lenOf(A, lv), lenOf(B, lv)), L0=Math.max(lenOf(A, 0), lenOf(B, 0));
    if (L()>Lu && !noRotate)   // не хватает длины — боком (поперёк) то, что позволяет ширина прохода между рядами
      for (const o of [...A, ...B].filter(o=>StationMatrix.rot(o.e.kind) && o.e.shape==='box' && o.e.l>o.e.w+50).sort((a, b)=>(b.e.l-b.e.w)-(a.e.l-a.e.w))){ o.rot=true; if (!fits()){ o.rot=false; continue; } if (L()<=Lu) break; }
    if (L()>Lu && this.closeOk){ lv=2; if (L()>Lu){ lv=3; if (L()>Lu) lv=1; } }   // крайний случай — ресиверы и фильтры вплотную, затем без прохода у торца
    if (L()>Lu) return { ok:false, why:'length2', needL:L(), needL0:L0 };
    return this.place([B, A], Lu, W, dep, lx, lv);
  }

  // ---- без сквозного прохода (исключение, компрессорная): один ряд у задней стены, а агрегат, который с проходом не встаёт
  // по ширине, — поперёк станции лицом к входу (по середине ширины). Перед ним — проход обслуживания от двери оператора, за
  // ним — отступ сзади и вторая часть станции со своей дверью оператора: к нему сзади и к оборудованию за ним
  rowX(units, Lu, W, noRotate){
    const U=units.map(e=>({ e, rot:false })), depth=o=>o.e.cross ? o.e.l : o.rot ? o.e.l : o.e.w, lenX=o=>o.e.cross ? o.e.w : o.rot ? o.e.w : o.e.l;
    const canRot=o=>!noRotate && StationMatrix.rot(o.e.kind) && o.e.shape==='box' && o.e.l>o.e.w+50;
    const need=o=>depth(o)+o.e.c.back[1]+this.front(o.e)[1], wide=o=>o.e.cross || need(o)<=W;
    for (const o of U) if (!wide(o) && canRot(o)){ o.rot=true; if (!wide(o)) o.rot=false; }
    const narrow=U.filter(o=>!wide(o));
    if (narrow.length!==1) return { ok:false, why:'width', bad:narrow.map(o=>o.e), needW:narrow.length ? Math.max(...narrow.map(need)) : W+1 };
    const X=narrow[0]; if (/^(dgu|cabinet|pump)$/.test(X.e.kind) || X.e.slot || X.e.l>W) return { ok:false, why:'width', bad:[X.e], needW:need(X) };
    X.rot=false; X.e=Object.assign({}, X.e, { cross:true });
    const len=lvl=>this.chain(U.map(o=>o.e), lvl).sum+U.reduce((s, o)=>s+lenX(o), 0);
    if (len(1)>Lu){ for (const o of U.filter(o=>!o.e.cross && canRot(o)).sort((a, b)=>(b.e.l-b.e.w)-(a.e.l-a.e.w))){ o.rot=true; if (!wide(o)){ o.rot=false; continue; } if (len(1)<=Lu) break; }
    }
    const lv=this.squeeze(U, len, Lu, wide, noRotate);
    if (len(lv)>Lu) return { ok:false, why:'length', needL:len(1), needL0:len(0) };
    return this.place([U], Lu, W, depth, lenX, lv);
  }

  /** промежутки по длине ряда: у двери, между соседними, в дальнем торце (lvl 0 — рекомендуемые, 1 — не менее) */
  chain(E, lvl){
    const g=[]; if (!E.length) return { gaps:g, sum:0 };
    // агрегат поперёк (cross): перед ним — проход обслуживания (лицом к входу), за ним — отступ сзади и проход второй части;
    // соседи — по матрице расстановки (lvl 2 — крайний случай: ресиверы и фильтры вплотную), иначе — по нормам вида
    const l1=Math.min(1, lvl), fr=e=>this.front(e)[l1], bk=e=>Math.max(e.c.back[l1], this.aisle[1]);
    const nb=(a, b)=>{ const p=StationMatrix.pair(a, b); return p ? p[Math.min(lvl, 2)] : Math.max(a.c.side[l1], b.c.side[l1]); };
    // у торца — проход к боку агрегата, который обслуживают сбоку (матрица: стороны Л/П); самый крайний случай (lvl 3) — по нормам
    const end=e=>Math.max(e.c.side[l1], lvl<3 && (StationMatrix.sides(e.kind).L || StationMatrix.sides(e.kind).R) ? StationMatrix.access().side : 0);
    g.push(E[0].cross ? fr(E[0]) : end(E[0]));
    for (let i=1; i<E.length; i++) g.push(E[i].cross ? Math.max(E[i-1].c.side[l1], fr(E[i])) : E[i-1].cross ? Math.max(bk(E[i-1]), E[i].c.side[l1]) : nb(E[i-1], E[i]));
    const last=E[E.length-1]; g.push(last.cross ? bk(last) : last.c.far ? last.c.far[l1] : end(last));
    return { gaps:g, sum:g.reduce((s, v)=>s+v, 0) };
  }

  /** места в рядах: R[0] — у задней стены, R[1] — у стены с дверью; отступы — от «не менее» к рекомендуемым */
  place(R, Lu, W, depth, lenX, lv=1){
    const n=StationLayout.n, aRec=this.aisle[0], items=[], iss=[], rows=R.filter(r=>r.length).length;
    let gapsShort=false, minGap=Infinity;
    R.forEach((row, ri)=>{ if (!row.length) return;
      const E=row.map(o=>o.e), rec=this.chain(E, 0), mn=this.chain(E, lv), body=row.reduce((s, o)=>s+lenX(o), 0);
      const k=rec.sum>mn.sum ? Math.max(0, Math.min(1, (Lu-body-mn.sum)/(rec.sum-mn.sum))) : 1;
      const gaps=mn.gaps.map((v, i)=>Math.round(v+(rec.gaps[i]-v)*k));
      for (let over=body+gaps.reduce((s, v)=>s+v, 0)-Lu, i=gaps.length-1; over>0 && i>=0; i--){ const d=Math.min(over, gaps[i]); gaps[i]-=d; over-=d; }   // округление — не длиннее ряда
      const free=Lu-body-gaps.reduce((s, v)=>s+v, 0);
      if (k<1) gapsShort=true;
      const lead=E.findIndex(e=>e.kind!=='cabinet');      // свободная длина — у двери, после шкафов
      let x=gaps[0];
      row.forEach((o, i)=>{ if (i===Math.max(0, lead) && free>0) x+=free;
        items.push({ o, ri, x, lx:lenX(o), d:depth(o) }); if (i>0) minGap=Math.min(minGap, gaps[i]);
        x+=lenX(o)+gaps[i+1]; });
    });
    // поперёк: задний отступ и проход — сначала проход до рекомендуемого, затем задний
    const back=it=>it.o.e.c.back;
    if (rows===1){
      for (const it of items){ const b=back(it), budget=W-it.d, fr=this.front(it.o.e)[0];
        if (it.o.e.cross){ it.y=Math.round(budget/2); it.back=it.y; it.aisle=0; it.face=-2; continue; }   // поперёк: по середине ширины, лицом к входу
        it.back = budget-b[0]>=fr ? b[0] : budget-fr>=b[1] ? budget-fr : b[1];
        it.aisle=budget-it.back; it.y=W-it.back-it.d; it.face=-1; }
    } else {
      const A=items.filter(i=>i.ri===1), B=items.filter(i=>i.ri===0), dm=(S, f)=>S.length ? Math.max(...S.map(f)) : 0;
      const recOk=W-dm(A, i=>i.d+back(i)[0])-dm(B, i=>i.d+back(i)[0])>=aRec;
      for (const it of items) it.back=recOk ? back(it)[0] : back(it)[1];
      if (!recOk){   // сзади «не менее», а проход шире рекомендуемого — излишек поровну рядам назад (к обслуживанию сзади)
        const per=Math.max(0, W-dm(A, i=>i.d+i.back)-dm(B, i=>i.d+i.back)-aRec)/((A.length ? 1 : 0)+(B.length ? 1 : 0));
        for (const it of items) it.back=Math.floor(Math.min(back(it)[0], back(it)[1]+per)); }
      const free=W-dm(A, i=>i.d+i.back)-dm(B, i=>i.d+i.back);
      for (const it of B){ it.y=W-it.back-it.d; it.face=-1; it.aisle=free; }
      for (const it of A){ it.y=it.back; it.face=1; it.aisle=free; }
    }
    const eq=items.filter(i=>!i.o.e.slot && !i.o.e.cross), aisleW=eq.length ? Math.min(...eq.map(i=>i.aisle)) : W, dgu=eq.find(i=>i.o.e.kind==='dgu'), other=eq.filter(i=>i.o.e.kind!=='dgu');
    const aisleO=other.length ? Math.min(...other.map(i=>i.aisle)) : Infinity;
    if (aisleO<aRec) iss.push({ level:'warn', text:`Проход обслуживания ${n(aisleO)} мм — меньше рекомендуемых ${n(aRec)} мм (допустимо от ${n(this.aisle[1])} мм).` });
    if (dgu && dgu.aisle<aRec) iss.push({ level:'warn', text:`Проход вдоль ДГУ ${n(dgu.aisle)} мм — меньше рекомендуемых ${n(aRec)} мм (допустимо от ${n(this.front(dgu.o.e)[1])} мм).` });
    if (gapsShort && Number.isFinite(minGap)) iss.push({ level:'warn', text:`Промежутки между оборудованием уменьшены до ${n(minGap)} мм — по длине не хватает места для рекомендуемых.` });
    else if (gapsShort) iss.push({ level:'warn', text:'Отступы от торцов уменьшены — по длине не хватает места для рекомендуемых.' });
    for (const it of eq) if (it.back<back(it)[0] && back(it)[0]>150 && !it.o.e.unit) iss.push({ level:'warn', tight:it.o.e.pos, text:`Поз. ${it.o.e.pos} «${it.o.e.short}» стоит в ${n(it.back+this.G)} мм от стены — рекомендуется ${n(back(it)[0]+this.G)} мм.` });
    return { ok:true, rows, aisleW, items, iss };
  }

  /** заданный контейнер: сначала как обычно, не помещается — исключения (компрессорная: проход до 500 мм, без сквозного
   *  прохода); modes — только эти режимы (автоподбор размера и подсказки задают их сами). Не помещается ни в одном —
   *  ответ обычного режима (его замечания понятнее) */
  fit(units, geo, modes){
    const M=modes || this.modes(); let first=null;
    for (const m of M){ const r=this.withMode(m, ()=>this.fit0(units, geo));
      if (r.level!=='error'){ this.modeNotes(r, m, geo); if (m.tight || m.cross) r.level=r.issues.some(i=>i.level==='warn') ? 'warn' : r.level; return r; }
      first=first||r; }
    return first;
  }
  /** оборудование на полу — рядами; настенные шкафы — на стене прохода, фильтры — на трубопроводе; не нашлось им места —
   *  своё место в ряду (шкаф — на стене за ним, фильтр — на трубе) */
  fit0(units, geo){
    let wall=units.filter(e=>e.mount==='wall'), hang=units.filter(e=>e.pipe), floor=units.filter(e=>!e.pipe && e.mount!=='wall');
    if (!floor.length){ floor=units.map(e=>Object.assign({}, e, { slot:true })); wall=[]; hang=[]; }
    const pass=avoid=>{ const q=this.fitRow(floor, geo, units); if (q.level==='error') return { q, left:[] };
      if (this.tank) this.tankPlace(q, geo); this.exits(q, geo, avoid); return { q, left:this.attach(q, wall, hang, geo) }; };
    let { q:r, left }=pass([]);
    if (r.level==='error') return r;
    // ворота заняли торец, и шкафам на стене не хватило места — шкафы важнее (иначе нет прохода): ворота в другом торце,
    // нет места и там — демонтаж через сервисную дверь в боковой стене
    for (const avoid of [r.gates && !r.gates.sea ? [r.gates.wall] : null, ['left', 'right']]){ if (!left.length || !avoid || !(r.gates && !r.gates.sea)) break;
      const t=pass(avoid); if (t.left.length<left.length){ r=t.q; left=t.left; } }
    // не нашлось места на стене или трубе — своё место в ряду; после перестановки трубопровод короче, и места может не
    // хватить следующему фильтру — тогда и ему (ничего не теряется: не поместилось в ряд — контейнер мал)
    for (let slots=left; left.length; slots=[...slots, ...left]){
      const ids=new Set(slots.map(StationLayout.key)), rest=e=>!ids.has(StationLayout.key(e));
      const r2=this.fitRow([...floor, ...slots.map(e=>Object.assign({}, e, { slot:true }))], geo, units);
      if (r2.level==='error') return r2;
      if (this.tank) this.tankPlace(r2, geo);
      this.exits(r2, geo);
      left=this.attach(r2, wall.filter(rest), hang.filter(rest), geo);
      r=r2;
    }
    this.finish(r, geo);
    return r;
  }

  /** ряды в заданном контейнере: высота, затем один ряд, при нехватке — два ряда. Внутри всегда проход для оператора и
   *  обслуживания: не помещается с ним — контейнер мал (станций «только с сервисными дверями» нет) */
  fitRow(units, geo, all){
    const g=this.G, [L, Wi, H]=geo.int, Lu=L-geo.x0-2*g, W=Wi-2*g, hh=this.heights(all, H), n=StationLayout.n;   // полезные размеры (под потолком зазор G — внутри отступа сверху)
    this.closeOk=!geo.auto && !geo.road;   // вплотную (ресиверы, фильтры) — только в заданном контейнере
    let r=this.row1(units, Lu, W);
    if (!r.ok || r.iss.some(i=>i.level==='warn')){ const r2=this.row2(units, Lu, W); if (r2.ok && (!r.ok || !r2.iss.some(i=>i.level==='warn'))) r=r2; }
    if (!r.ok && this.mode.cross){ const r3=this.rowX(units, Lu, W); if (r3.ok) r=r3; }   // исключение: агрегат поперёк, две двери
    const res={ geo, ext:geo.ext, int:geo.int };
    if (!r.ok){
      const iss=[...hh.iss];
      if (r.why==='width') iss.unshift({ level:'error', text:`Не проходит по ширине: ${r.bad.filter(e=>!e.unit).slice(0, 3).map(e=>`поз. ${e.pos} «${e.short}» (${n(e.w)} мм)`).join(', ')} — вместе с проходом для оператора и обслуживания, отступом от стены и зазором на коммуникации нужно ${n(r.needW+2*g)} мм, а ширина внутри — ${n(Wi)} мм.` });
      else iss.unshift({ level:'error', text:`Не помещается по длине: нужно ${n(r.needL+2*g)} мм, а внутри контейнера ${n(Lu+2*g)} мм — не хватает ${n(r.needL-Lu)} мм.` });
      return Object.assign(res, { level:'error', issues:iss, need:{ L:r.needL||null, W:r.needW||null } });
    }
    const items=r.items.flatMap(it=>it.o.pair ? this.unpair(it, geo) : [this.item(it, geo)]), iss=[...hh.iss, ...r.iss];
    const X=items.find(i=>i.cross), cross=X ? { pos:X.pos, x0:X.x, x1:X.x+X.lx } : null;
    const P=[...new Set(items.filter(i=>i.pair).map(i=>i.pos))];
    if (P.length) iss.push({ level:'info', text:`Ресиверы поз. ${P.join(', ')} — в два ряда (один за другим): осмотр и обслуживание заднего — сбоку, через промежутки между ресиверами.` });
    // дверь оператора: агрегат поперёк — в стене прохода перед ним, если места хватает, иначе — в ближнем торце
    const door=cross ? (cross.x0-geo.x0>=StationLayout.ENTRY[1]+100 ? 'side' : 'end') : !this.tank && r.rows===2 ? 'end' : 'side';
    return Object.assign(res, { level:hh.bad ? 'error' : 'ok', bad:hh.bad, items, rows:r.rows, door, cross,
      doors:null, aisle:{ w:r.aisleW, rows:r.rows }, issues:iss });
  }

  /** двери и итог: уровень, занятая длина. Внутри — проход: дверь оператора (entry) и для агрегатов, которые через неё не
   *  вынести, — распашные ворота в торце (exits; у морского — его штатные двери в торце), сервисные двери — только для
   *  демонтажа, где к воротам не провезти; ДГУ — дверь-жалюзи в торце (dguDoor) */
  finish(r, geo){
    const n=StationLayout.n;
    r.doors=r.doors||[]; this.recheck(r, geo);
    { const E=this.entryOpen(geo, r.door), G=r.gates, two=r.doors.some(d=>d.kind==='entry') || r.exit || (G && G.wicket) || (r.gates2 && r.gates2.wicket) || r.secondDgu;
      const who=`дверь оператора — ${r.door==='end' && geo.sea ? 'штатные двери в торце' : `одностворчатая, ${n(E.w)} × ${n(E.h)} мм в свету, открывается наружу, с доводчиком`}`;
      for (const q of [G, r.gates2]) if (q && (q.pos.length || !q.sea)) r.issues.push({ level:'info', text:q.sea ? `Монтаж и демонтаж поз. ${q.pos.join(', ')} — через штатные двери контейнера в торце (${n(q.w)} × ${n(q.h)} мм): ${q.why.join('; ')}.`
        : `Распашные монтажные ворота ${q.full ? 'во весь торец ' : ''}${n(q.w)} × ${n(q.h)} мм в ${q.wall==='left' ? 'торце у входа' : 'дальнем торце'}, открываются наружу (это и выход)${q.pos.length ? ` — для монтажа и демонтажа поз. ${q.pos.join(', ')}` : ' — для монтажа и демонтажа оборудования'}${q.why.length ? ': '+q.why.join('; ') : ''}.` });
      // одинаковые ворота (несколько одинаковых агрегатов) — одной строкой с числом
      const sv=new Map(); for (const d of r.doors.filter(d=>d.kind!=='entry')){
        const t=`${d.leaves>1 ? 'Сервисные распашные ворота' : 'Сервисная распашная дверь'} ${n(d.w)} × ${n(d.h)} мм в ${d.wall==='back' ? 'задней' : 'боковой'} стене${d.rear ? ' за оборудованием' : ''}`;
        const k=t+'|'+d.pos.join(','); if (!sv.has(k)) sv.set(k, { t, d, n:0 }); sv.get(k).n++; }
      for (const { t, d, n:c } of sv.values()) r.issues.push({ level:'info', text:`${t}${c>1 ? ` (${c} шт.)` : ''} — для ${d.rear ? 'обслуживания, ' : ''}монтажа и демонтажа поз. ${d.pos.join(', ')}: ${d.why.join('; ')}${d.rear && !(G && G.pos.length) ? '; ворота в торце не нужны' : ''}.` });
      const tight=new Set(r.doors.filter(d=>d.rear).flatMap(d=>d.pos));   // плотно к стене, но с воротами за ним — не замечание
      r.issues=r.issues.filter(i=>!(i.tight!=null && tight.has(i.tight)));
      r.issues.push({ level:'info', text:`Вход: ${who}${two ? `; вторая дверь оператора — ${r.exit ? 'в дальнем торце по оси прохода' : G && G.wicket ? `калитка ${n(G.wicket.w)} × ${n(G.wicket.h)} мм в створке ворот в дальнем торце` : r.secondDgu ? 'выход через дверь-жалюзи ДГУ в дальнем торце' : 'в стене прохода у дальнего торца'} (${r.second})` : ''}.` }); }
    r.entry=this.entry(r, geo);
    r.dguDoor=this.dguDoor(r, geo);
    if (r.dguDoor){ const d=r.dguDoor; r.issues.push({ level:'info', text:`ДГУ поз. ${d.pos}: в торце — двустворчатая дверь-жалюзи ${n(d.w)} × ${n(d.h)} мм — выброс горячего воздуха радиатора и проём для монтажа и демонтажа ДГУ (отдельная сервисная дверь не нужна).${d.fits ? '' : ' ДГУ шире проёма — демонтаж со снятием торцевой панели.'}` }); }
    r.access=this.access(r, geo);
    for (const q of r.access) if (q.miss.length) r.issues.push({ level:'warn', text:`Поз. ${q.pos}: к ${q.miss.map(k=>StationLayout.SIDE[k][1]).join(' и ')} не подойти для обслуживания (${q.miss.map(k=>q.s[k].t).join('; ')}) — нужен проход или сервисные ворота; увеличьте контейнер или поменяйте порядок в составе.` });
    r.level=r.bad ? 'error' : r.issues.some(i=>i.level==='warn') ? 'warn' : 'ok';
    r.used=this.used(r.items, geo);
    delete r.segs;
  }
  static SIDE = { F:['спереди', 'лицевой стороне'], B:['сзади', 'задней стороне'], L:['слева', 'левому боку'], R:['справа', 'правому боку'] };
  /** матрица доступа: у каждого агрегата на полу — 4 стороны (Ф, З, Л, П) и чем к ним подойти: проход, зазор, сервисные
   *  ворота, ворота торца, дверь; сторона, которую обслуживать не нужно (StationMatrix.sides), — «не требуется».
   *  miss — обслуживаемые стороны без доступа (замечание) */
  access(r, geo){
    const [L, W]=geo.int, n=StationLayout.n, A=StationMatrix.access(), sv=StationMatrix.aisle().service, out=[];
    const fl=r.items.filter(i=>i.mount==='floor' && !i.tank && i.kind!=='cabinet');
    const ov=(a0, a1, b0, b1)=>Math.min(a1, b1)-Math.max(a0, b0)>50;
    // свободно от агрегата в направлении: -y (к стене прохода), +y (к задней стене), -x (к торцу у входа), +x (к дальнему торцу)
    const gap=(i, d)=>{ const O=r.items.filter(o=>o!==i && (o.mount==='floor' || o.tank));
      if (d==='-y'){ const b=O.filter(o=>ov(o.x, o.x+o.lx, i.x, i.x+i.lx) && o.y+o.ly<=i.y+1); return [b.length ? i.y-Math.max(...b.map(o=>o.y+o.ly)) : i.y, !b.length]; }
      if (d==='+y'){ const b=O.filter(o=>ov(o.x, o.x+o.lx, i.x, i.x+i.lx) && o.y>=i.y+i.ly-1); return [b.length ? Math.min(...b.map(o=>o.y))-i.y-i.ly : W-i.y-i.ly, !b.length]; }
      if (d==='-x'){ const b=O.filter(o=>ov(o.y, o.y+o.ly, i.y, i.y+i.ly) && o.x+o.lx<=i.x+1); return [b.length ? i.x-Math.max(...b.map(o=>o.x+o.lx)) : i.x-(geo.x0||0), !b.length]; }
      const b=O.filter(o=>ov(o.y, o.y+o.ly, i.y, i.y+i.ly) && o.x>=i.x+i.lx-1); return [b.length ? Math.min(...b.map(o=>o.x))-i.x-i.lx : L-i.x-i.lx, !b.length]; };
    // проём в стене напротив агрегата
    const hole=(i, d)=>{ const G=[r.gates, r.gates2].filter(Boolean);
      if (d==='-x' || d==='+x'){ const s=d==='-x' ? 'left' : 'right', g=G.find(q=>q.wall===s && ov(q.y0, q.y1, i.y, i.y+i.ly));
        return g ? (g.sea ? 'штатные двери торца' : 'ворота торца') : d==='+x' && r.dguDoor && r.dguDoor.pos===i.pos ? 'дверь-жалюзи ДГУ' : null; }
      const s=d==='+y' ? 'back' : 'front', dd=(r.doors||[]).find(q=>q.wall===s && ov(q.x0, q.x1, i.x, i.x+i.lx));
      return dd ? (dd.kind==='entry' ? 'дверь оператора' : 'сервисные ворота') : null; };
    // стороны агрегата → направления: лицом к проходу (face -1 — к стене прохода, 1 — к задней, ±2 — к торцам)
    const dirs=f=>f===1 ? { F:'+y', B:'-y', L:'+x', R:'-x' } : f===2 ? { F:'+x', B:'-x', L:'-y', R:'+y' } : f===-2 ? { F:'-x', B:'+x', L:'+y', R:'-y' } : { F:'-y', B:'+y', L:'-x', R:'+x' };
    const cnt=new Map(), all=new Map(); for (const i of fl) all.set(i.pos, (all.get(i.pos)||0)+1);
    for (const i of fl){
      const k1=(cnt.get(i.pos)||0)+1; cnt.set(i.pos, k1);
      const need=StationMatrix.sides(i.kind), D=dirs(i.face), s={}, miss=[];
      for (const k of ['F', 'B', 'L', 'R']){
        const d=D[k], [g, wall]=gap(i, d), min=k==='F' ? sv : k==='B' ? A.back : A.side, h=wall ? hole(i, d) : null;
        if (!need[k]){ s[k]={ ok:true, t:'не требуется', g }; continue; }
        if (g>=min) s[k]={ ok:true, t:`${k==='F' ? 'проход' : 'зазор'} ${n(Math.round(g))} мм`, g };
        else if (h) s[k]={ ok:true, t:h, g };
        else { s[k]={ ok:false, t:`${n(Math.max(0, Math.round(g)))} мм${wall ? ' до стены' : ' до соседнего'}, нужно ${n(min)}`, g }; miss.push(k); } }
      // класс по ширине: узкое — с основным проходом и рекомендуемым отступом; широкое — только с проходом «в крайнем случае»
      // и плотно к стене (сервисные ворота); сверхширокое — не проходит и так (поперёк, негабарит)
      const nw=Math.min(i.l||i.lx, i.w||i.ly), wr=StationMatrix.wall(i)||[0, 0], Wu=W-2*this.G;
      const cls=nw+StationClear.aisle()[0]+wr[0]<=Wu ? 'узкое' : nw+StationLayout.TIGHT+wr[1]<=Wu ? 'широкое' : 'сверхширокое';
      out.push({ cls, pos:all.get(i.pos)>1 ? `${i.pos} (${k1})` : String(i.pos), kind:i.kind, name:i.short||i.name, s, miss }); }
    return out;
  }

  /** на стены и трубы: трубопровод (геометрия), места в ряду для шкафов и фильтров, настенные шкафы, фильтры на линии.
   *  Возвращает то, чему места не нашлось */
  attach(r, cabs, hang, geo){
    const left=[], dh=Math.max(0, ...[...hang, ...r.items.filter(i=>i.slot && i.kind==='filter')].map(e=>Math.max(e.l, e.w))), st=e=>e.air && e.air.stage!=null ? e.air.stage : 50;
    r.lines=this.lines(r, geo, dh);
    for (const it of r.items.filter(i=>i.slot)) this.mountSlot(it, r, geo);
    for (const e of cabs){ const it=this.wallSpot(e, r, geo); if (it) r.items.push(it); else left.push(e); }
    // фильтры на трубе — у осушителя: перед ним — справа налево от его входа, после — слева направо от выхода (по ходу воздуха)
    const groups=new Map(); for (const e of hang){ const g=this.segOf(r, e); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(e); }
    // одинаковые (одна ступень) — параллельно: первый — на магистрали, следующие — на обводных петлях рядом с ним (loop)
    for (const [g, E] of groups){ const back=!!g && g.s1>=40 && g.s1<50, base=new Map(), cnt=new Map();
      E.sort((a, b)=>back ? st(b)-st(a) : st(a)-st(b)); for (const e of E) cnt.set(st(e), (cnt.get(st(e))||0)+1);
      for (const e of E){ const b=base.get(st(e)), it=(b && this.loop(e, b, r, geo)) || this.pipeSpot(e, r, geo, g, back, !b && cnt.get(st(e))>1);
        if (!it){ left.push(e); continue; }
        r.items.push(it); if (!b) base.set(st(e), { it, n:0 }); } }
    return left;
  }
  /** фильтр e параллельно фильтру b.it на магистрали: на своей обводной петле рядом (нет места — над или под магистралью):
   *  петля — линия вдоль фильтра с двумя перемычками к магистрали по краям (tee; место под них оставлено — pipeSpot wide),
   *  фильтр на ней — напротив первого. Места нет — null (тогда — на магистрали подряд) */
  loop(e, b, r, geo){
    const [, W, H]=geo.int, f=b.it, ln=(r.lines||[])[f.on]; if (!ln || ln.loop) return null;
    const d=f.lx, xa=f.x-100, xb=f.x+d+100, s=b.n+1, dy=s*(d+100), dz=s*(e.h-Math.max(60, e.h*0.12)+90);   // над магистралью — низ корпуса в 90 мм над её осью
    const stub=(y, z)=>({ x:xa-30, y:Math.min(y, ln.y)-30, z:Math.min(z, ln.z)-30, lx:xb-xa+60, ly:Math.abs(y-ln.y)+60, h:Math.abs(z-ln.z)+60 });
    for (const [y, z] of [[ln.y-dy, ln.z], [ln.y+dy, ln.z], [ln.y, ln.z+dz], [ln.y, ln.z-dz]]){
      if (y<40 || y>W-40 || z>H-120) continue;   // у стены — как на магистрали: корпус сдвинут в помещение, труба — в его габарите
      const it=this.unitItem(e, { x:f.x, y:Math.round(Math.max(20, Math.min(W-d-20, y-d/2))), z:Math.round(z+Math.max(60, e.h*0.12)-e.h), mount:'pipe', lx:d, ly:d, line:ln.medium, on:-1 });
      if (it.z<150 || it.z+e.h>H-50) continue;
      if (r.items.some(i=>this.hit(it, i, 0) || (i!==f && i.mount!=='pipe' && this.hit(stub(y, z), i, 0)))) continue;
      r.lines.push({ x0:xa, x1:xb, y:Math.round(y), z:Math.round(z), label:'', medium:ln.medium, branches:[xa, xb].map(x=>({ x, y0:Math.round(y), y1:ln.y, z1:ln.z, tee:true })), gaps:[], par:[f.pos, e.pos], loop:true });
      b.n=s; return it; }
    return null;
  }

  /** трубопровод (геометрия): магистрали за оборудованием — у задней стены или между рядами, спиной друг к другу, с
   *  отводами к оборудованию и выходом через дальний торец: насосы — всас и напор, компрессорная — сжатый воздух через
   *  осушители и ресиверы, ДГУ — топливо от бака. dh — наибольший фильтр на линии: ось — дальше от стены на его половину */
  lines(r, geo, dh){
    const [L, W, H]=geo.int, fl=r.items.filter(i=>i.mount==='floor'), has=k=>fl.some(i=>i.kind===k), out=[];
    r.segs=[];
    if (!fl.length) return out;
    const zTop=Math.max(600, Math.min(H-400, 1500)), over=r.rows===2, room={ fuel:50, air:100, in:140, out:140, gen:100 }, hang=(dh||0)/2+40;
    // ось линии: conn — что соединяет; off — от стены, мм (part — доля полосы, если полоса уже); z — высота оси; x0…x1 — путь
    const place=(conn, off, part, z, medium, x0, x1)=>{
      // полоса — за этим оборудованием до стены
      const back=conn.filter(i=>i.row!==1), lo=back.length ? Math.max(...back.map(i=>i.y+i.ly)) : 0, hi=W, bw=hi-lo;
      const y=Math.round(Math.min(W-40, hi-Math.min(off, bw*part)));
      // нет места под трубу за оборудованием или ряды напротив (через проход) — над оборудованием
      if (bw<room[medium] || over) z=Math.min(H-150, Math.max(z, ...conn.map(i=>i.h+(medium==='out' ? 450 : 200))));
      // сервисные ворота в стене за линией — линия над ними
      const dd=(r.doors||[]).filter(d=>d.wall===(y>W/2 ? 'back' : 'front') && d.x0<x1+100 && d.x1>x0-100 && (y>W/2 ? W-y : y)<600);
      if (dd.length) z=Math.min(H-120, Math.max(z, ...dd.map(d=>d.h+150)));
      // линия не проходит сквозь оборудование: на её пути выше неё — над ним
      const hit=fl.filter(i=>i.x<x1 && i.x+i.lx>x0 && i.y<y+60 && i.y+i.ly>y-60 && i.h>z-60);
      if (hit.length) z=Math.min(H-120, Math.max(z, ...hit.map(i=>i.h+150)));
      return { y, z:Math.round(z), lo, hi }; };
    const line=(conn, off, part, z, label, medium, toEnd)=>{ if (!conn.length) return;
      const g=place(conn, off, part, z, medium, Math.min(...conn.map(i=>i.x+i.lx/2)), toEnd ? L : Math.max(...conn.map(i=>i.x+i.lx/2)));
      const br=conn.map(i=>this.branch(i, g.y, g.z)).filter(Boolean), xs=[...br.map(b=>b.x), ...conn.filter(i=>!br.some(b=>b.to===StationLayout.key(i))).map(i=>Math.round(i.x+i.lx/2))];
      out.push({ x0:Math.min(...xs), x1:toEnd ? L : Math.max(...xs), y:g.y, z:g.z, label, medium, branches:br }); };
    if (has('pump')){ const P=fl.filter(i=>i.kind==='pump'); line(P, 110, 0.3, 450, 'вход', 'in', true); line(P, 240, 0.7, Math.min(zTop, 1300), 'выход', 'out', true); }
    else if (has('compressor')){ const a=this.airLines(fl, place, L, H, Math.max(StationLayout.AIR_Y, hang), zTop); out.push(...a.lines); r.segs=a.segs; }
    else if (has('dgu')){ if (has('tank')) line(fl.filter(i=>i.kind==='tank' || i.kind==='dgu'), 120, 0.5, 300, '', 'fuel', false); }
    else line(fl.filter(i=>i.kind!=='cabinet'), Math.max(150, hang), 0.5, Math.min(zTop, 1200), 'выход', 'gen', true);
    return out;
  }
  /** байпас осушителя: обводная линия с краном (нормально закрыт) между входом и выходом — осушитель обслуживают и меняют
   *  без остановки подачи воздуха; на входе и выходе осушителя — свои краны: {x0, x1, pos} или null */
  bypass(i, p){ return i.kind==='dryer' && i.air && i.air.type!=='gen' && p[1].x-p[0].x>=150 ? { x0:p[0].x, x1:p[1].x, pos:i.pos } : null; }
  /** сжатый воздух — по ходу воздуха: компрессоры → коллектор → аппараты (ресивер, фильтр на полу, осушитель: у каждого один
   *  вход и один выход — магистраль на нём прерывается, gaps) → выход через дальний торец. Компрессоры не все до первого
   *  аппарата (два ряда) — коллектор отдельной трубой выше магистрали. Одинаковые аппараты подряд (AirChain.groups) —
   *  параллельно: выходы — в магистраль, входы — от своего коллектора на другой высоте (подъём от магистрали — tee), у
   *  каждого краны на входе и выходе, без байпаса. segs — участки между аппаратами: на них висят фильтры по своей ступени
   *  (s0 < ступень < s1) */
  airLines(fl, place, L, H, off, z0){
    const src=fl.filter(i=>i.kind==='compressor'), ser=fl.filter(i=>StationLayout.series(i)).sort((a, b)=>a.air.stage-b.air.stage || a.x-b.x), conn=[...src, ...ser];
    if (!conn.length) return { lines:[], segs:[] };
    const g=place(conn, off, 0.5, z0, 'air', Math.min(...conn.map(i=>i.x)), L), y=g.y, z=g.z;
    const zh=z+220<=H-120 ? z+220 : z-220, yh=Math.max(g.lo+40, Math.min(g.hi-40, y-110));
    const out=(i, yy, zz)=>Object.assign(this.branch(i, yy, zz) || { x:Math.round(i.x+i.lx/2), y0:yy, y1:yy, z1:zz, to:StationLayout.key(i) }, { role:'out' });
    const steps=AirChain.groups(ser).map(G=>({ G, st:G[0].air.stage, P:G.map(i=>this.ports(i, y, z)) }));
    const sb=src.map(i=>out(i, y, z)), firstIn=steps.length ? steps[0].P[0][0].x : L, lines=[], segs=[], heads=[];
    const tr={ x0:0, x1:L, y, z, label:'выход', medium:'air', branches:[], gaps:[], bypass:[] };
    let head=null, a, s0=10, k0=0;
    if (sb.every(b=>b.x<firstIn-60)){ tr.x0=Math.min(...sb.map(b=>b.x), firstIn); tr.branches.push(...sb); a=sb.length ? Math.max(...sb.map(b=>b.x)) : tr.x0; }   // компрессоры — до первого аппарата: одна магистраль
    else {   // коллектор компрессоров — выше (или ниже) магистрали и чуть в стороне на плане: к входу первого аппарата (группы)
      const s=steps[0], hb=src.map(i=>out(i, yh, zh)), hin=s.G.map(i=>this.ports(i, yh, zh)[0]), hx=[...hb.map(b=>b.x), ...hin.map(b=>b.x)], x=hin[0].x;
      head={ x0:Math.min(...hx), x1:Math.max(...hx), y:yh, z:zh, label:'', medium:'air', branches:[...hb, ...hin], gaps:[], header:true, to:Math.round((x+hin[hin.length-1].x)/2) };
      if (hin.length>1) head.par=s.G.map(i=>i.pos);
      // до первого аппарата фильтр — на участке коллектора, по которому идёт весь воздух (компрессоры с одной стороны)
      const lw=hb.filter(b=>b.x<x).map(b=>b.x), rw=hb.filter(b=>b.x>x).map(b=>b.x), a0=lw.length ? Math.max(...lw) : null, b0=rw.length ? Math.min(...rw) : null;
      segs.push(a0!=null && (b0==null || x-a0>=b0-x) ? { a:a0, b:x, s0:10, s1:s.st, line:head } : { a:x, b:b0, s0:10, s1:s.st, line:head });
      const po=s.P.map(p=>p[1]); tr.x0=Math.min(...po.map(b=>b.x)); tr.branches.push(...po); a=Math.max(...po.map(b=>b.x)); s0=s.st; k0=1; }
    for (const s of steps.slice(k0)){
      const fi=s.P[0][0].x;
      if (s.G.length===1){ const [pi, po]=s.P[0], bp=this.bypass(s.G[0], s.P[0]);
        segs.push({ a, b:pi.x, s0, s1:s.st, line:tr }); tr.branches.push(pi, po); tr.gaps.push([pi.x, po.x]); if (bp) tr.bypass.push(bp); a=po.x; }
      else {   // параллельно: магистраль прервана от подъёма (xs) до первого выхода; коллектор входов — на другой высоте
        const xs=Math.round(Math.min(fi-40, Math.max((a+fi)/2, fi-150))), po=s.P.map(p=>p[1]);
        let yg=yh, zg=zh;
        if (head && head.x1>xs-100){ const zm=2*z-zh; if (zm>=300 && zm<=H-120) zg=zm; else yg=Math.max(g.lo+40, yh-110); }   // мимо коллектора компрессоров
        const pin=s.G.map(i=>this.ports(i, yg, zg)[0]);
        segs.push({ a, b:xs, s0, s1:s.st, line:tr }); tr.branches.push(...po); tr.gaps.push([xs, po[0].x]);
        heads.push({ x0:xs, x1:Math.max(...pin.map(b=>b.x)), y:yg, z:zg, label:'', medium:'air', branches:[{ x:xs, y0:yg, y1:y, z1:z, tee:true }, ...pin], gaps:[], par:s.G.map(i=>i.pos) });
        a=Math.max(...po.map(b=>b.x)); }
      s0=s.st; }
    segs.push({ a, b:L, s0, s1:Infinity, line:tr });
    lines.push(...(head ? [head] : []), tr, ...heads);
    return { lines, segs };
  }
  /** вход и выход аппарата на магистрали (по ходу воздуха — слева направо): патрубки сверху у задней стороны (магистраль
   *  ниже верха — в заднюю стенку); у вертикального ресивера вход — внизу сбоку, выход — вверху */
  ports(i, y, z){
    const to=StationLayout.key(i), u=i.shape==='hcyl' ? [0.15, 0.85] : i.shape==='vcyl' ? [0.3, 0.7] : [0.25, 0.75];
    const behind=i.y+i.ly<y-20, front=i.y>y+20, back=behind ? i.y+i.ly : front ? i.y : null, sg=behind ? -1 : 1, dz=Math.min(150, i.ly/4), top=z>i.h+50;
    const low=i.shape==='vcyl' && i.h>=900 ? Math.round(Math.max(250, i.h*0.22)) : 0;
    const at=(uu, role, lo)=>{ const x=Math.round(i.x+i.lx*uu);
      if (back==null) return { x, y0:y, y1:y, z1:Math.round(top ? i.h : z), to, role };
      if (lo) return { x, y0:y, y1:back, z1:lo, to, role };
      return top ? { x, y0:y, y1:Math.round(back+sg*dz), z1:Math.round(i.h), to, role } : { x, y0:y, y1:back, z1:Math.round(z), to, role }; };
    return [at(u[0], 'in', low), at(u[1], 'out', 0)];
  }
  /** участки линии без разрывов (внутри аппарата магистраль прервана): [[x0, x1], …] */
  static runs(l){
    const g=(l.gaps||[]).filter(([a, b])=>b>a).sort((p, q)=>p[0]-q[0]), out=[]; let x=l.x0;
    for (const [a, b] of g){ if (a>x) out.push([x, Math.min(a, l.x1)]); x=Math.max(x, b); }
    if (l.x1>x) out.push([x, l.x1]);
    return out;
  }
  /** участок для фильтра на трубе по его ступени; без цепочки воздуха — самая высокая линия, где он висит не ниже 150 мм */
  segOf(r, e){
    const S=r.segs||[], s=e.air && e.air.stage!=null ? e.air.stage : 50;
    if (S.length) return S.find(g=>s>g.s0 && s<g.s1) || S[S.length-1];
    const ln=this.airLine(r, e.h); return ln ? { a:ln.x0-100, b:ln.x1+100, s0:-Infinity, s1:Infinity, line:ln } : null;
  }
  /** отвод от магистрали (y, z) к оборудованию: к его задней стороне; магистраль выше оборудования — заходит на верх и
   *  спускается к нему (z1), ближе к дальнему краю: посередине на виде — номер позиции */
  branch(i, y, z){
    const down=z>i.h+50, x=Math.round(i.x+i.lx*(down ? 0.8 : 0.5)), to=StationLayout.key(i), dz=Math.min(150, i.ly/4);
    if (i.y+i.ly<y-20) return { x, y0:y, y1:Math.round(down ? i.y+i.ly-dz : i.y+i.ly), z1:Math.round(down ? i.h : z), to };
    if (i.y>y+20) return { x, y0:y, y1:Math.round(down ? i.y+dz : i.y), z1:Math.round(down ? i.h : z), to };
    return down ? { x, y0:y, y1:y, z1:Math.round(i.h), to } : null;
  }
  /** линия для фильтров: сжатый воздух; иначе — самая высокая, на которой фильтр высотой h висит не ниже 150 мм от пола */
  airLine(r, h){
    const L=(r.lines||[]).filter(l=>l.z+Math.max(60, h*0.12)-h>=150);
    return L.find(l=>l.medium==='air') || L.sort((a, b)=>b.z-a.z)[0] || null;
  }
  /** фильтр висит на линии: голова — на оси трубы, корпус — вниз; у стены не помещается по оси — сдвинут в помещение
   *  (подключение отводами), труба проходит через его габарит */
  hangOn(it, ln, W){ it.y=Math.round(Math.max(20, Math.min(W-it.ly-20, ln.y-it.ly/2))); it.z=Math.round(ln.z+Math.max(60, it.h*0.12)-it.h); it.line=ln.medium; }

  /** свои места в ряду: шкаф — на стене за местом, фильтр — на трубе над местом */
  mountSlot(it, r, geo){
    const [, W, H]=geo.int;
    if (it.kind==='cabinet'){
      it.z=Math.max(StationLayout.CAB_LOW, Math.min(StationLayout.CAB_TOP, H-150)-it.h);
      it.mount='wall'; if (it.row===1){ it.y=0; it.wall='front'; } else { it.y=W-it.ly; it.wall='back'; }
      return;
    }
    const g=this.segOf(r, it), ln=g && g.line; if (!ln || ln.z+Math.max(60, it.h*0.12)-it.h<150 || ln.z+Math.max(60, it.h*0.12)>H-50){ it.mount='floor'; it.z=0; return; }
    const was={ x:it.x, y:it.y, z:it.z };
    it.mount='pipe'; this.hangOn(it, ln, W);
    // не заходит в соседнее оборудование (труба между рядами): сдвиг поперёк трубы — труба остаётся внутри его габарита
    const fl=r.items.filter(i=>i!==it && i.mount!=='pipe' && i.mount!=='wall'), y0=it.y;
    if (fl.some(i=>this.hit(it, i, 0))) found: for (let d=10; d<=it.ly; d+=10) for (const sg of [1, -1]){ const y=y0+sg*d;
      if (ln.y<y+20 || ln.y>y+it.ly-20 || y<20 || y+it.ly>W-20) continue;
      if (!fl.some(i=>this.hit(Object.assign({}, it, { y }), i, 0))){ it.y=y; break found; } }
    // на трубе это место уже занято другим фильтром (несколько фильтров на своих местах у конца трубы) — стоит на своём
    // месте в ряду, на полу
    if (r.items.some(i=>i!==it && i.mount==='pipe' && this.hit(it, i, 0))){ Object.assign(it, was, { mount:'floor', z:0 }); return; }
    ln.x0=Math.min(ln.x0, Math.round(it.x+it.lx/2)); ln.x1=Math.max(ln.x1, Math.round(it.x+it.lx/2));
  }

  /** настенный шкаф не мешает проходу оператора: проход перед ним — не уже прохода обслуживания (ПУЭ, п. 4.1.23: у щитов —
   *  не менее 0,8 м в свету; сужение до 0,6 м — только строительными конструкциями). Места по порядку: на стене прохода у
   *  двери, где перед шкафом остаётся рекомендуемый проход (напротив промежутка между оборудованием или неглубокого); на торце
   *  у двери; на дальнем торце (не у ДГУ — там жалюзи радиатора); на стене прохода с проходом «не менее». При двух рядах
   *  или места нет — null (своё место в ряду) */
  wallSpot(e, r, geo){
    if (r.rows!==1) return null;
    const [L, W, H]=geo.int, x0=geo.x0||0, w=e.l, d=e.w, z=Math.max(StationLayout.CAB_LOW, Math.min(StationLayout.CAB_TOP, H-150)-e.h);
    if (z+e.h>H-50) return null;
    const fl=r.items.filter(i=>i.mount!=='wall' && i.mount!=='pipe'), cabs=r.items.filter(i=>i.mount==='wall');
    // на стене прохода — не на пути к воротам в торце: то, что выносят через них, проходит мимо шкафа
    const G=r.gates && r.gates.pos.length ? r.gates : null, P=StationLayout.PASS, out=G ? this.bulky(r, geo).filter(b=>G.pos.includes(b.it.pos)) : [];
    const clear=x=>{ if (!out.length) return true;
      const u=fl.filter(i=>i.x<x+w && i.x+i.lx>x), room=(u.length ? Math.min(...u.map(i=>i.y)) : W)-d;
      return out.every(b=>(G.wall==='right' ? b.it.x>=x+w : b.it.x+b.it.lx<=x) || b.narrow+2*P<=room); };
    const front=need=>{
      const busy=cabs.filter(i=>i.wall==='front').map(i=>[i.x-100, i.x+i.lx+100]);
      if (r.door==='side') busy.push([x0+StationLayout.ENTRY[0]-150, x0+StationLayout.ENTRY[1]+150]);
      for (const dd of (r.doors||[]).filter(dd=>dd.wall==='front')) busy.push([dd.x0-150, dd.x1+150]);   // не на сервисной двери
      const ok=x=>!busy.some(([a, b])=>x<b && x+w>a) && fl.every(i=>i.x>=x+w || i.x+i.lx<=x || i.y-d>=need) && clear(x) && !r.items.some(i=>this.hit({ x, y:0, z, lx:w, ly:d, h:e.h }, i, 0));
      for (let x=x0+150; x+w<=L-150; x+=50) if (ok(x)) return this.unitItem(e, { x, y:0, z, mount:'wall', wall:'front', face:1 });
      return null; };
    // торец: шкаф вдоль торцевой стены в зоне прохода — перед ним (вдоль контейнера) проход «не менее» свободен
    const end=side=>{
      if (side==='left' && (r.door==='end' || (x0>0 && geo.type==='north'))) return null;   // вход оператора в торце; у «Севера» — тамбур (перегородка отсека бака — сплошная: можно)
      if (r.gates && r.gates.wall===side) return null;   // ворота для демонтажа (у морского — его двери)
      if (side==='right' && fl.some(i=>i.kind==='dgu')) return null;
      const xa=side==='left' ? x0 : L-d, zone=[side==='left' ? x0 : L-d-this.aisle[1], side==='left' ? x0+d+this.aisle[1] : L];
      const taken=cabs.filter(i=>i.wall===side).map(i=>[i.y-100, i.y+i.ly+100]);
      for (let y=100; y+w<=W-100; y+=50){
        if (taken.some(([a, b])=>y<b && y+w>a)) continue;
        if (fl.some(i=>i.x<zone[1] && i.x+i.lx>zone[0] && i.y<y+w && i.y+i.ly>y)) continue;
        if (r.items.some(i=>this.hit({ x:xa, y, z, lx:d, ly:w, h:e.h }, i, 0))) continue;   // и не на фильтре на трубе
        return this.unitItem(e, { x:xa, y, z, lx:d, ly:w, mount:'wall', wall:side, face:side==='left' ? 2 : -2 }); }
      return null; };
    if (fl.some(i=>i.kind==='dgu')) return front(this.aisle[0]) || front(this.aisle[1]) || end('left');   // у ДГУ торец у входа — под приток воздуха
    return front(this.aisle[0]) || end('left') || end('right') || front(this.aisle[1]);
  }

  /** фильтр на трубопроводе — на своём участке по ходу воздуха (до осушителя или после — по ступени), по порядку ступеней;
   *  где под ним нет оборудования, сначала — где к нему подойти из прохода (колба и элемент снимаются вниз); wide — первый
   *  из одинаковых: по краям — место под перемычки обводных петель (loop) */
  pipeSpot(e, r, geo, g, back, wide){
    const ln=g && g.line; if (!ln || ln.z+Math.max(60, e.h*0.12)-e.h<150 || ln.z+Math.max(60, e.h*0.12)>geo.int[2]-50) return null;   // под потолком не висит
    const d=Math.max(e.l, e.w), ex=wide ? 100 : 0, pad=StationLayout.PIPE_PAD+ex, it=this.unitItem(e, { x:0, y:0, z:0, mount:'pipe', lx:d, ly:d, on:(r.lines||[]).indexOf(ln) }); this.hangOn(it, ln, geo.int[1]);
    const lo=Math.ceil(Math.max(g.a+80+ex, (g.next ?? -Infinity)+ex, ln.x0-d/2)/10)*10, hi=Math.floor((Math.min(g.b-80-ex, (g.lim ?? Infinity)-ex, ln.x1+d/2, geo.int[0]-100)-d)/10)*10;
    const open=x=>r.rows!==1 || !r.items.some(i=>i.mount==='floor' && i.x<x+d && i.x+i.lx>x && i.y<it.y);
    const free=(x, o)=>!ln.branches.some(b=>b.x>x-80-ex && b.x<x+d+80+ex) && !r.items.some(i=>this.hit({ x, y:it.y, z:it.z, lx:d, ly:d, h:it.h }, i, pad)) && (!o || open(x));
    for (const o of [true, false]){
      if (back){ for (let x=hi; x>=lo; x-=20) if (free(x, o)){ it.x=x; g.lim=x-pad; return it; } }
      else for (let x=lo; x<=hi; x+=20) if (free(x, o)){ it.x=x; g.next=x+d+pad; return it; } }
    return null;
  }
  /** пересекаются ли a и b (короба x, y, z, lx, ly, h) с зазором pad по длине */
  hit(a, b, pad){
    const az=a.z||0, bz=b.z||0;
    return a.x<b.x+b.lx+pad && a.x+a.lx+pad>b.x && a.y<b.y+b.ly && a.y+a.ly>b.y && az<bz+b.h && az+a.h>bz;
  }

  /** дверь оператора: проём в свету {w, h}, мм — одностворчатая 900 × 2000 (у морского в два ряда — его двери в торце) */
  entryOpen(geo, door){
    const W=geo.int[1], P=StationLayout.PASS;
    if (door==='end' && geo.sea && geo.door) return { w:Math.min(geo.door[0], W)-2*P, h:geo.door[1]-P };
    const d=StationMatrix.door(); return { w:d.w, h:d.h };
  }
  /** дверь оператора: одностворчатая, наружу, с доводчиком — в стене прохода у торца ('side') или в торце по оси прохода
   *  (два ряда, 'end'; у морского — его двери в торце): {wall, x0, x1 | y0, y1, w, h}; без прохода — null */
  entry(r, geo){
    const x0=geo.x0||0, E=StationLayout.ENTRY, D={ h:StationMatrix.door().h+100, pad:StationLayout.DOOR.pad }, w=E[1]-E[0], W=geo.int[1];
    if (r.door==='side') return { wall:'front', x0:x0+E[0], x1:x0+E[1], w, h:D.h };
    if (r.door!=='end') return null;
    if (geo.sea && geo.door){ const dw=Math.min(geo.door[0], W); return { wall:'left', y0:Math.round((W-dw)/2), y1:Math.round((W+dw)/2), w:dw, h:geo.door[1], sea:true }; }
    const y0=Math.round(Math.max(D.pad, Math.min(W-D.pad-w, this.aisleMid(r, W)-w/2)));
    return { wall:'left', y0, y1:y0+w, w, h:D.h };
  }
  /** середина прохода поперёк контейнера, мм: один ряд — между стеной прохода и оборудованием, два ряда — между рядами */
  aisleMid(r, W){
    const fl=r.items.filter(i=>(i.mount==='floor' || i.mount==='frame') && !i.tank && !i.cross); if (!fl.length) return W/2;
    if (r.rows!==2) return Math.min(...fl.map(i=>i.y))/2;
    const A=fl.filter(i=>i.row===1), B=fl.filter(i=>i.row!==1), lo=A.length ? Math.max(...A.map(i=>i.y+i.ly)) : 0, hi=B.length ? Math.min(...B.map(i=>i.y)) : W;
    return (lo+hi)/2;
  }
  /** что не вынести через дверь оператора (ДГУ — через дверь-жалюзи в торце): не проходит в проём — компрессор, осушитель,
   *  насос стоя (меньший размер в плане и высота), ресивер, фильтр, шкаф, бак — и наклонив (двумя меньшими размерами);
   *  ресиверам и рефрижераторным осушителям ворота обычно не нужны, крупному адсорбционному — нужны. [{it, narrow, why}] */
  bulky(r, geo){
    const E=this.entryOpen(geo, r.door), P=StationLayout.PASS, n=StationLayout.n, out=[];
    for (const it of r.items.filter(i=>(i.mount==='floor' || i.mount==='frame') && !i.tank && i.kind!=='dgu')){
      const tilt=StationLayout.TILT.test(it.kind), [a, b]=[it.l, it.w, it.h].sort((p, q)=>p-q), narrow=tilt ? a : Math.min(it.l, it.w);
      const fits=tilt ? (a+2*P<=E.w && b+P<=E.h) || (b+2*P<=E.w && a+P<=E.h) : narrow+2*P<=E.w && it.h+P<=E.h;
      if (!fits) out.push({ it, narrow, why:`поз. ${it.pos} ${tilt ? 'и наклонённым ' : ''}не проходит в дверь оператора (${n(it.l)} × ${n(it.w)} × ${n(it.h)} мм)` }); }
    return out;
  }
  /** стоит плотно к стене: сзади меньше рекомендуемого отступа — обслуживание сзади, монтаж и демонтаж — через сервисные
   *  распашные ворота в стене за агрегатом (компрессор, осушитель, насос и прочее; ресивер, фильтр, шкаф, ДГУ — нет);
   *  недобор до 100 мм — не в счёт (за агрегат подойти можно) */
  tight(it){ return StationLayout.gated(it.kind) && (it.mount==='floor' || it.mount==='frame') && !it.tank && !it.slot && !it.cross && it.back<StationMatrix.access().back; }
  /** что монтируют и демонтируют через ворота в торце: компрессоры (к ним есть доступ для обслуживания — ворота в торце
   *  всегда) и всё, что не проходит в дверь оператора; кроме стоящего плотно к стене — у него свои ворота сзади */
  mounts(r, geo){
    const big=this.bulky(r, geo).filter(b=>!this.tight(b.it)), n=StationLayout.n;
    for (const it of r.items.filter(i=>i.kind==='compressor' && i.mount==='floor' && !this.tight(i) && !big.some(b=>b.it===i)))
      big.push({ it, narrow:Math.min(it.l, it.w), why:`поз. ${it.pos} — компрессор (${n(it.l)} × ${n(it.w)} × ${n(it.h)} мм): к нему есть доступ для обслуживания, монтаж и демонтаж — через ворота в торце` });
    return big;
  }
  /** ширина пути к торцу side для агрегата it — по проходу мимо соседей и шкафов на стене ниже его верха, мм */
  pathTo(it, side, r, geo){
    const [L, W]=geo.int, x0=geo.x0||0, lo=side==='left' ? x0 : it.x, hi=side==='left' ? it.x+it.lx : L;
    const fl=r.items.filter(o=>o!==it && (o.mount==='floor' || o.mount==='frame') && !o.tank && o.x<hi && o.x+o.lx>lo);
    let w=r.rows===2 ? Infinity : Math.min(...fl.map(o=>o.aisle), Infinity);
    if (r.rows===2){ const mid=this.aisleMid(r, W), A=fl.filter(o=>o.y+o.ly<=mid), B=fl.filter(o=>o.y>=mid);
      w=(B.length ? Math.min(...B.map(o=>o.y)) : W)-(A.length ? Math.max(...A.map(o=>o.y+o.ly)) : 0); }
    for (const c of r.items.filter(c=>c.mount==='wall' && c.wall==='front' && c.x<hi && c.x+c.lx>lo && c.z<it.h+50)){
      const u=fl.filter(o=>o.x<c.x+c.lx && o.x+o.lx>c.x); w=Math.min(w, (u.length ? Math.min(...u.map(o=>o.y)) : W)-c.ly); }
    return w;
  }
  /** двери и ворота (с проходом): дверь оператора — всегда (entry), проход длиннее 7 м — вторая в дальнем конце (second);
   *  компрессоры и то, что не пройдёт в дверь оператора, — через распашные ворота в торце: дальнем, если к нему по проходу
   *  можно довезти, иначе у входа; у морского — его штатные двери в торце. Стоящее плотно к стене — через сервисные
   *  распашные ворота в стене за ним (тогда ему ворота в торце не нужны). Торец занят (отсек бака, тамбур, вход оператора,
   *  дверь-жалюзи ДГУ) или пути нет — сервисные ворота в боковой стене напротив агрегата. r.gates — {wall, y0, y1, w, h,
   *  leaves:2, pos, why[, sea, wicket]} | null, r.doors — [{wall, x0, x1, w, leaves, h, kind:'service'|'entry', pos, why[, rear]}],
   *  r.exit — вторая дверь оператора в дальнем торце {wall:'right', y0, y1, w, h} | null */
  exits(r, geo, avoid=[]){
    r.gates=null; r.gates2=null; r.doors=[]; r.exit=null;
    const [L, W, H]=geo.int, x0=geo.x0||0, D=StationLayout.DOOR, P=StationLayout.PASS, n=StationLayout.n, T=geo.t||0, GM=StationMatrix.gate();
    for (const it of r.items) it.tight=this.tight(it);
    const rear=r.items.filter(i=>i.tight).map(it=>({ it, rear:true, why:`поз. ${it.pos} стоит в ${n(it.back)} мм от стены (для обслуживания сзади нужно не меньше ${n(StationMatrix.access().back)} мм) — обслуживание сзади, монтаж и демонтаж через них` }));
    if (geo.sea && geo.door && r.door!=='end'){ const dw=Math.min(geo.door[0], W);   // штатные двери морского — в торце у входа
      r.gates={ wall:'left', y0:Math.round((W-dw)/2), y1:Math.round((W+dw)/2), w:dw, h:geo.door[1], leaves:2, pos:[], why:[], sea:true }; }
    const big=this.mounts(r, geo), dgu=r.items.some(i=>i.kind==='dgu' && !i.tank && L-(i.x+i.lx)<=600);
    const fl=r.items.filter(i=>(i.mount==='floor' || i.mount==='frame') && !i.tank);
    // монтажные ворота в торце — у компрессорной и насосной всегда (решение ПНЕВМОТЕХ 12.10): по возможности в дальнем
    // торце (у входа — дверь оператора, логотип и приток воздуха)
    const always=!dgu && fl.some(i=>i.kind==='compressor' || i.kind==='pump');
    const free=s=>!avoid.includes(s) && (s==='left' ? x0===0 && r.door!=='end' : !dgu);
    const sides=r.gates ? ['left'] : ['right', 'left'].filter(free);
    const reach=(b, s)=>b.narrow+2*P<=this.pathTo(b.it, s, r, geo);
    let best=null;
    for (const s of sides){ const ok=big.filter(b=>reach(b, s)); if (ok.length && (!best || ok.length>best.ok.length)) best={ s, ok }; }
    if (!best && always && sides.length && !r.gates) best={ s:sides[0], ok:[] };
    // размер: Ш = max W агрегатов + addW + 2·T, В = max H + addH + T (не меньше прохода в рост); шире доли торца — во весь торец
    const mk=(s, list)=>{ const U=list.length ? list.map(b=>b.it) : fl.filter(i=>i.kind==='compressor' || i.kind==='pump');
      const nw=Math.max(0, ...U.map(i=>Math.min(i.l, i.w))), hh=Math.max(0, ...U.map(i=>i.h));
      let w=Math.max(GM.minW, Math.ceil((nw+GM.addW+2*T)/100)*100); const full=w>=GM.full*W || w>W-2*D.pad;
      if (full) w=W-2*D.pad;
      const y0=full ? D.pad : Math.round(Math.max(D.pad, Math.min(W-D.pad-w, this.aisleMid(r, W)-w/2)));
      return { wall:s, y0, y1:y0+w, w, h:Math.min(H-100, Math.max(D.h+100, Math.ceil((hh+GM.addH+T)/50)*50)), leaves:2, pos:[], why:[], full }; };
    if (best){ const ok=best.ok;
      if (!r.gates) r.gates=mk(best.s, ok);
      for (const b of ok) if (!r.gates.pos.includes(b.it.pos)){ r.gates.pos.push(b.it.pos); r.gates.why.push(b.why); } }
    // до ворот не провезти — ворота и во втором торце (если он свободен); цепочка длиннее twoAt — ворота с обоих торцов
    let far=big.filter(b=>!best || !best.ok.includes(b));
    const other=r.gates ? (r.gates.wall==='left' ? 'right' : 'left') : null, used=fl.length ? Math.max(...fl.map(i=>i.x+i.lx))-Math.min(...fl.map(i=>i.x)) : 0;
    if (other && free(other) && !(r.gates.sea && other==='left')){
      const ok2=far.filter(b=>reach(b, other)), long=used>GM.twoAt;
      if (ok2.length || long){ r.gates2=mk(other, ok2.length ? ok2 : best ? best.ok : []);
        for (const b of ok2){ r.gates2.pos.push(b.it.pos); r.gates2.why.push(b.why.replace(/ через ворота в торце$/, ' через ворота во втором торце')); }
        if (long && !ok2.length) r.gates2.why.push(`оборудование стоит на ${n(used)} мм — длиннее ${n(GM.twoAt)} мм: ворота с обоих торцов`);
        far=far.filter(b=>!ok2.includes(b)); } }
    far=far.map(b=>{ const w=Math.max(0, ...sides.map(s=>this.pathTo(b.it, s, r, geo)).filter(Number.isFinite));
      return Object.assign({}, b, { why:b.why.replace(/, монтаж и демонтаж — через ворота в торце$/, '')+(sides.length ? `, по проходу к торцу не провезти (${w ? `проход ${n(w)} мм, ` : ''}агрегат — ${n(b.narrow)} мм)` : avoid.length ? ', торцы заняты шкафами на стене' : ', торцы заняты (отсек бака, дверь-жалюзи ДГУ, вход оператора)') }); });
    r.side=[...rear, ...far]; r.doors=this.sideDoors(r.side, r, geo);
    this.second(r, geo);
  }
  /** со шкафами на стене: проход до ворот ещё есть; нет — тому агрегату сервисные ворота в боковой стене */
  recheck(r, geo){
    const G=r.gates, side=r.side||[]; delete r.side; if (!G || !G.pos.length) return;
    const P=StationLayout.PASS, lost=this.mounts(r, geo).filter(b=>G.pos.includes(b.it.pos) && !side.some(q=>q.it===b.it) && b.narrow+2*P>this.pathTo(b.it, G.wall, r, geo)); if (!lost.length) return;
    for (const b of lost){ const k=G.pos.indexOf(b.it.pos); if (k<0) continue; G.pos.splice(k, 1); G.why=G.why.filter(t=>!t.startsWith(`поз. ${b.it.pos} `)); }
    if (!G.pos.length && !G.sea){ if (G.wicket && !r.exit) r.exit=this.endExit(r, geo, 'right'); r.gates=null; }
    const keep=r.doors.filter(d=>d.kind==='entry');
    r.doors=[...this.sideDoors([...side, ...lost.map(b=>Object.assign({}, b, { why:b.why.replace(/, монтаж и демонтаж — через ворота в торце$/, '')+', до ворот в торце не провезти мимо шкафов на стене' }))], r, geo), ...keep];
  }
  /** сервисные распашные ворота (уже 1200 мм — дверь): стоящему плотно к стене (rear) — в стене за ним, остальным — в
   *  боковой стене напротив (два ряда — в стене за ним); шире агрегата на 200 мм (800…2400), выше на 100 мм (не ниже 2000),
   *  мимо двери оператора; соседние — одними воротами, пока не шире 2400 мм, иначе — рядом через стойку 200 мм */
  sideDoors(list, r, geo){
    const [L, , H]=geo.int, x0=geo.x0||0, D=StationLayout.DOOR, ex=r.door==='side' ? [x0+StationLayout.ENTRY[0], x0+StationLayout.ENTRY[1]] : null, out=[], T=geo.t||0, SM=StationMatrix.service();
    for (const { it, why, rear } of list){
      const wall=rear ? (r.rows===2 && it.row===1 ? 'front' : 'back') : r.rows===2 && it.row!==1 ? 'back' : 'front';
      // Ш = сторона агрегата + addW + 2·T, В = высота агрегата + addH + T (матрица расстановки)
      const w=Math.max(D.min, Math.min(D.max, Math.ceil((it.lx+SM.addW+2*T)/100)*100)), c=it.x+it.lx/2;
      let d0=Math.max(x0+D.pad, Math.min(L-D.pad-w, c-w/2));
      if (wall==='front' && ex && d0<ex[1]+100 && d0+w>ex[0]-100) d0=Math.min(L-D.pad-w, ex[1]+100);   // мимо двери оператора
      out.push({ wall, x0:Math.round(d0), x1:Math.round(d0+w), h:Math.min(H-100, Math.max(rear ? StationLayout.REAR_H : D.h, Math.ceil((it.h+SM.addH+T)/50)*50)), kind:'service', pos:[it.pos], why:[why], rear:!!rear }); }
    const got=[]; for (const d of out.sort((p, q)=>p.wall.localeCompare(q.wall) || p.x0-q.x0)){ const last=got[got.length-1];
      if (last && last.wall===d.wall && d.x0<last.x1+300){
        if (Math.max(last.x1, d.x1)-last.x0<=D.max){ last.x1=Math.max(last.x1, d.x1); last.h=Math.max(last.h, d.h); last.rear=last.rear || d.rear;
          for (const v of d.pos) if (!last.pos.includes(v)) last.pos.push(v); for (const t of d.why) if (!last.why.includes(t)) last.why.push(t); continue; }
        const w=d.x1-d.x0; d.x0=last.x1+200; d.x1=Math.min(L-D.pad, d.x0+w); if (d.x1-d.x0<D.min) continue; }   // некуда — агрегат обслуживают через соседние ворота
      got.push(d); }
    for (const d of got){ d.x1=Math.min(L-D.pad, d.x1); d.w=d.x1-d.x0; d.leaves=Math.max(1, Math.ceil(d.w/D.leaf)); }
    return got;
  }
  /** вторая дверь оператора: проход от двери оператора до дальнего конца длиннее 7 м или шкафы вдоль прохода длиннее 7 м
   *  (ПУЭ, п. 4.1.23) — в дальнем конце прохода: один ряд — в стене прохода у дальнего торца (в r.doors, kind:'entry'), два
   *  ряда — в дальнем торце по оси прохода (r.exit); там ворота — калитка в створке ворот (gates.wicket), дверь-жалюзи ДГУ —
   *  выход через неё */
  second(r, geo){
    const L=geo.int[0], x0=geo.x0||0, E=StationLayout.ENTRY, eh=StationMatrix.door().h+100, n=StationLayout.n, X=StationMatrix.exits();
    if (r.cross){   // без сквозного прохода: вторая дверь оператора — во второй части (за агрегатом поперёк)
      const C=r.cross, w=E[1]-E[0]; r.second=`сквозного прохода нет — поз. ${C.pos} стоит поперёк станции: к нему сзади и к оборудованию за ним`;
      let a=L-E[0]-w; for (const d of r.doors.filter(d=>d.wall==='front').sort((p, q)=>q.x0-p.x0)) if (a<d.x1+200 && a+w>d.x0-200) a=d.x0-200-w;
      if (a>=C.x1+100){ r.doors.push({ wall:'front', x0:Math.round(a), x1:Math.round(a+w), w, h:eh, leaves:1, kind:'entry', pos:[], why:[r.second] }); return; }
      const G=r.gates2 && r.gates2.wall==='right' ? r.gates2 : r.gates; if (G && G.wall==='right' && !G.sea && G.w/2>=StationLayout.DOOR_MIN+150){ G.wicket={ w:Math.min(StationLayout.DOOR_MIN, G.w/2-150), h:Math.min(StationMatrix.door().h, G.h-150) }; return; }
      r.exit=this.endExit(r, geo, 'right'); return; }
    // выходы: дверь оператора и монтажные ворота в торце (открываются наружу); нужно не меньше X.n, между крайними — не
    // меньше X.dist (короче станция — на противоположных концах); шкафы вдоль прохода длиннее 7 м — второй выход (ПУЭ 4.1.23)
    const at=[], en=r.door==='side' ? x0+(E[0]+E[1])/2 : x0;
    at.push(en); for (const G of [r.gates, r.gates2]) if (G) at.push(G.wall==='left' ? 0 : L);
    if (r.items.some(i=>i.kind==='dgu' && !i.tank && L-(i.x+i.lx)<=600)) at.push(L);   // дверь-жалюзи ДГУ — выход
    const span=at.length>1 ? Math.max(...at)-Math.min(...at) : 0, need=Math.min(X.dist, Math.max(0, L-x0-1500));
    const cab=this.eq.filter(e=>e.kind==='cabinet').reduce((s, e)=>s+e.l*(e.qty||1), 0);
    const why=at.length<X.n ? `выходов должно быть не меньше ${X.n}` : span<need ? `выходы на ${n(span)} мм друг от друга — нужно не меньше ${n(need)} мм (на противоположных концах)`
      : cab>StationNorms.SHIELD ? `шкафы вдоль прохода — ${n(cab)} мм, длиннее 7 м (ПУЭ, п. 4.1.23)` : ''; if (!why) return;
    r.second=why;
    if (r.door==='side'){ const w=E[1]-E[0];
      let a=L-E[0]-w; for (const d of r.doors.filter(d=>d.wall==='front').sort((p, q)=>q.x0-p.x0)) if (a<d.x1+200 && a+w>d.x0-200) a=d.x0-200-w;
      if (a>=x0+E[1]+1000){ r.doors.push({ wall:'front', x0:Math.round(a), x1:Math.round(a+w), w, h:eh, leaves:1, kind:'entry', pos:[], why:[why] }); return; } }
    const G=[r.gates, r.gates2].find(g=>g && g.wall==='right' && !g.sea);
    if (G && !(r.gates && r.gates2)){ const lw=G.w/2; if (lw>=StationLayout.DOOR_MIN+150){ G.wicket={ w:Math.min(StationLayout.DOOR_MIN, lw-150), h:Math.min(StationMatrix.door().h, G.h-150) }; return; } }
    if (r.items.some(i=>i.kind==='dgu' && !i.tank && L-(i.x+i.lx)<=600)){ r.secondDgu=true; return; }   // выход — через дверь-жалюзи ДГУ
    if (!G) r.exit=this.endExit(r, geo, 'right');
  }
  /** дверь оператора в торце по оси прохода: одностворчатая, наружу, с доводчиком */
  endExit(r, geo, wall){
    const W=geo.int[1], E=StationLayout.ENTRY, D={ h:StationMatrix.door().h+100, pad:StationLayout.DOOR.pad }, w=E[1]-E[0];
    if (r.cross && !r.items.some(i=>(i.mount==='floor' || i.mount==='frame') && !i.cross && i.x>=r.cross.x1)){ const y0=Math.round((W-w)/2); return { wall, y0, y1:y0+w, w, h:D.h }; }
    const y0=Math.round(Math.max(D.pad, Math.min(W-D.pad-w, this.aisleMid(r, W)-w/2)));
    return { wall, y0, y1:y0+w, w, h:D.h };
  }
  /** ДГУ в дальнем торце: напротив радиатора — двустворчатая дверь-жалюзи: выброс горячего воздуха и проём для монтажа и
   *  демонтажа ДГУ (шире его на 200 мм, выше на 150 мм); {wall:'right', y0, y1, w, h, leaves:2, pos, fits} или null */
  dguDoor(r, geo){
    const [L, W, H]=geo.int, D=StationLayout.DOOR, g=r.items.find(i=>i.kind==='dgu' && !i.tank); if (!g || L-(g.x+g.lx)>600) return null;
    const w=Math.min(W-2*D.pad, Math.max(D.min, Math.ceil((g.ly+200)/100)*100)), y0=Math.round(Math.max(D.pad, Math.min(W-D.pad-w, g.y+g.ly/2-w/2)));
    return { wall:'right', y0, y1:y0+w, w, h:Math.min(H-100, Math.max(D.h, g.h+150)), leaves:2, pos:g.pos, fits:w>=g.ly+2*StationLayout.PASS };
  }

  /** на крыше: глушитель ДГУ — прямо над ДГУ (по центру его длины и ширины), на опорах, вывод выхлопа вверх; выхлопная
   *  труба — от двигателя вертикально сквозь крышу в глушитель */
  /** ресиверы снаружи (ФНП ОРПД, п. 65) — на бетонной площадке за дальним торцом, где выходит трубопровод: первый — по оси
   *  выхода, следующие — к стене прохода через 600 мм; не помещаются по ширине контейнера — следующий ряд дальше от стены.
   *  Координаты — как у оборудования внутри (от внутренних стен и пола): x за торцом, z — от площадки на земле */
  outside(plan, chassis){
    const E=this.eq.filter(e=>e.outside); if (!E.length) return [];
    const [L, W]=plan.int, ext=plan.geo.ext, ox=(ext[0]-L)/2, oy=(ext[1]-W)/2, zf=StationGeo.zFloor(plan.geo.type, plan.geo.t), C=StationLayout;
    const air=(plan.piping||[]).flatMap(p=>p.lines||[]).filter(l=>l.medium==='air' && !l.header && l.x1>=L-1), yc=air.length ? air[0].y : W-C.AIR_Y;
    const lo=-oy, hi=W+oy, first=ly=>Math.round(Math.min(hi-ly, Math.max(lo, yc-ly/2))), out=[];
    let x=L+ox+C.OUT_GAP, top=null, col=0;
    for (const e of E) for (let k=0; k<e.qty; k++){
      const lx=e.l, ly=e.w; let y=top==null ? first(ly) : top-C.OUT_STEP-ly;
      if (top!=null && y<lo){ x+=col+C.OUT_STEP; col=0; y=first(ly); }
      top=y; col=Math.max(col, lx);
      out.push(this.unitItem(e, { unit:k, x:Math.round(x), y, z:-(zf+(chassis ? 1150 : 0))+C.PAD, mount:'out', face:-2, air:AirChain.unit(e.air, k) })); }
    return out;
  }

  roof(plan){
    const ms=this.eq.filter(e=>e.kind==='muffler' && e.roof); if (!ms.length) return [];
    const [L, W]=plan.int, ow=plan.geo && plan.geo.ext ? (plan.geo.ext[1]-W)/2 : 100, dg=plan.items.filter(i=>i.kind==='dgu').sort((a, b)=>a.x-b.x), out=[];
    let k=0, next=Math.max(100, L/2-ms[0].l/2);
    for (const m of ms) for (let u=0; u<m.qty; u++, k++){
      const d=m.w, l=Math.min(m.l, L-200), g=dg[k], cx=g ? g.x+g.lx/2 : next+l/2;
      const x=Math.round(Math.max(100, Math.min(L-100-l, cx-l/2))), y=Math.round(g ? Math.max(-ow+40, Math.min(W+ow-40-d, g.y+g.ly/2-d/2)) : W/2-d/2);
      const ex=g ? Math.round(Math.max(x+120, Math.min(x+l-120, g.x+g.lx*0.62))) : null;   // выхлоп двигателя — входит в глушитель снизу
      out.push({ pos:m.pos, unit:u, name:m.name, brief:m.brief, short:m.short, kind:'muffler', x, y, lx:l, ly:d, h:d, d, known:m.known, mass:m.mass, color:m.color,
        gap:StationLayout.ROOF_GAP, outlet:StationLayout.OUTLET, exhaust:g ? { x:ex, y:Math.round(g.y+g.ly/2), z:g.h } : null });
      next=x+l+300; }
    return out;
  }

  /** трубопровод в составе → линии с материалом и цветом; в составе нет, а фильтры висят на трубе — линия условно (без
   *  номера позиции) */
  route(plan){
    const ps=this.eq.filter(e=>e.kind==='piping'), lines=plan.lines||[]; if (!lines.length) return [];
    if (!ps.length) return plan.items.some(i=>i.mount==='pipe') ? [{ pos:null, implicit:true, name:'Трубопровод', kind:'piping', qty:1, mat:'', matText:'', color:PipeMaterial.get('steel').color, dn:'', lines }] : [];
    return ps.map(p=>{ const m=PipeMaterial.get(p.mat);
      return { pos:p.pos, name:p.name, brief:p.brief, kind:'piping', qty:p.qty, mat:p.mat, matText:m ? m.name.toLowerCase() : '', color:m ? m.color : PipeMaterial.get('steel').color, dn:p.dn, lines }; });
  }

  item(it, geo){
    const e=it.o.e;
    return { id:e.id, pos:e.pos, unit:e.unit, name:e.name, brief:e.brief, short:e.short, kind:e.kind, shape:e.shape, look:e.look||'', color:e.color, colorKnown:e.colorKnown, maker:e.maker||'',
      known:e.known, mass:e.mass, kw:e.kw, x:geo.x0+this.G+it.x, y:it.y+this.G, z:0, lx:it.lx, ly:it.d, h:e.h, rot:!!it.o.rot || !!e.cross, face:it.face, back:it.back+this.G, backRec:e.cross ? 0 : e.c.back[0]+this.G, aisle:it.aisle+this.G, cross:!!e.cross,
      l:e.l, w:e.w, row:it.ri, mount:e.slot ? e.mount : 'floor', slot:!!e.slot, pipe:!!e.pipe, air:e.air||null, pic:e.pic||null, flow:e.flow||null, cool:e.cool||null, comb:e.comb||null, heat:e.heat||null, ctype:e.ctype||'' };
  }
  /** шкаф на стене или фильтр на трубе — не из ряда */
  unitItem(e, o){
    return Object.assign({ id:e.id, pos:e.pos, unit:e.unit, name:e.name, brief:e.brief, short:e.short, kind:e.kind, shape:e.shape, look:e.look||'', color:e.color, colorKnown:e.colorKnown, maker:e.maker||'',
      known:e.known, mass:e.mass, kw:e.kw, lx:e.l, ly:e.w, h:e.h, rot:false, face:-1, back:0, aisle:0, l:e.l, w:e.w, row:-1, slot:false, pipe:!!e.pipe, air:e.air||null, pic:e.pic||null }, o);
  }
  used(items, geo){ const fl=items.filter(i=>i.mount!=='wall' && i.mount!=='pipe' && !i.tank), I=fl.length ? fl : items;
    const x0=Math.min(...I.map(i=>i.x)), x1=Math.max(...I.map(i=>i.x+i.lx)); return { x0, x1, free:Math.max(0, geo.int[0]-(x1-x0)-geo.x0) }; }

  /** длина ряда(ов) при ширине Wi, мм: row1 — один ряд, row2 — два ряда с проходом;
   *  lvl 0 — с рекомендуемыми промежутками (без поворотов), 1 — с «не менее» (поперёк — что помещается по ширине);
   *  null — не проходит по ширине */
  need(units, Wi, arr, lvl){
    if (!units.length) return 0;
    const r=arr==='row1' ? this.row1(units, 0, Wi, !lvl) : arr==='rowX' ? this.rowX(units, 0, Wi, !lvl) : this.row2(units, 0, Wi, !lvl);
    if (r.ok) return 0;
    if (!/^length/.test(r.why)) return null;
    return lvl ? r.needL : r.needL0;
  }

  /** высота внутри, мм, нужная над сервисными воротами за агрегатами: ворота + трубопровод над ними + жалюзи выброса
   *  (короб-воздухоотвод) + зазор под потолком; ворот нет — 0 */
  overGate(r){ const D=(r.doors||[]).filter(d=>d.rear); return D.length ? Math.max(...D.map(d=>d.h))+StationLayout.OVER_GATE+StationMatrix.louvre()+this.G : 0; }
  static OVER_GATE = 300;    // над сервисными воротами: перемычка и трубопровод до низа жалюзи выброса, мм
  /** блок-контейнер «по проекту» — по необходимому месту, без запаса (шаг 100 мм), всегда с проходом для оператора и
   *  обслуживания. Варианты по порядку: проход и все отступы рекомендуемые; проход и отступ от стены «не менее», промежутки
   *  рекомендуемые; всё «не менее» — в ширине, которую везут без спецразрешения; затем шире. В варианте — наименьшая площадь пола
   *  (длина × ширина); два ряда — только если заметно меньше одного (на четверть: один ряд удобнее в обслуживании и обвязке) */
  autoSize(units, geo){
    const G=StationGeo, B=G.BLOCK, t=geo.t, f=G.flex(geo.type), n=StationLayout.n, x0=geo.x0||0, wallX=2*(t+f.wall), hOf=f.floor+t+f.roof;
    const floor=units.filter(e=>!e.pipe && e.mount!=='wall'), probe=floor.length ? floor : units.map(e=>Object.assign({}, e, { slot:true }));
    const g2=2*this.G, needH=lvl=>Math.max(B.hWalk, ...units.filter(e=>!e.pipe).map(e=>e.mount==='wall' ? e.h+StationLayout.CAB_LOW+150 : e.h+Math.max(this.G, e.kind==='compressor' ? e.c.top[1] : e.c.top[lvl])));
    // в габарите перевозки: как обычно, затем исключения компрессорной (проход до 500 мм, без сквозного прохода); негабарит — последним
    const tiers=[];
    for (const [lw, ll] of [[0, 0], [1, 0], [1, 1]]) tiers.push([lw, ll, false, {}]);
    for (const m of this.modes().slice(1)) tiers.push([1, 1, false, m]);
    for (const [lw, ll] of [[0, 0], [1, 0], [1, 1]]) tiers.push([lw, ll, true, {}]);
    let tall=null;
    for (const [lw, ll, wide, m] of tiers){ const got=this.withMode(m, ()=>{
        const Hx=Math.max(B.minH, G.up(needH(lw)+hOf)); if (Hx>B.maxH){ tall=tall||Hx; return null; }
        const cand=[];
        const Ws=[]; for (let Wx=G.up(wide ? G.ROAD_W+1 : B.minW); Wx<=(wide ? B.maxW : G.ROAD_W); Wx+=G.STEP) Ws.push(Wx);
        if (!wide && Ws[Ws.length-1]<G.ROAD_W) Ws.push(G.ROAD_W);   // наибольшая ширина без спецразрешения — 2 550 мм (не кратна 100)
        for (const Wx of Ws){
          const Wi=G.inner(geo.type, [10000, Wx, Hx], t)[1];
          for (const arr of ['row1', 'row2', ...(m.cross ? ['rowX'] : [])]){
            const L=this.need(probe, Wi-g2, arr, ll); if (L==null) continue;
            const Lx=Math.max(B.minL, G.up(L+g2+x0+wallX)); if (Lx<=StationLayout.MAX_L) cand.push({ Lx, Wx, two:arr==='row2', a:Lx*Wx/(arr==='row2' ? 0.75 : 1) });
          } }
        cand.sort((p, q)=>p.a-q.a || p.Lx-q.Lx);
        const seen=new Set();
        const done=(r, g2, Wx)=>{ r.geo=g2; r.picked=true;
          if (wide) r.issues.push({ level:'info', text:`Ширина ${n(Wx)} мм — при перевозке негабарит (без разрешения — до ${n(G.ROAD_W)} мм).` });
          return r; };
        // шкафы заняли торцы, и демонтаж — через сервисные ворота в боковой стене (дорого): сначала — длиннее или шире (площадь —
        // до 1,2 от первого варианта), чтобы шкафы встали на стену прохода, а ворота — в торец; не вышло — первый вариант
        let alt=null;
        for (const c of cand){ if (alt && c.a>alt.a*1.2) break; if (seen.has(c.Lx+'×'+c.Wx)) continue; seen.add(c.Lx+'×'+c.Wx);
          for (let Lx=c.Lx; Lx<=Math.min(StationLayout.MAX_L, c.Lx+1500); Lx+=G.STEP){   // шкафам и фильтрам может понадобиться место в ряду
            let g2=Object.assign({}, geo, { auto:false, road:true, ext:[Lx, c.Wx, Hx] }); g2.int=G.inner(geo.type, g2.ext, t);
            let r=this.fit(units, g2, [m]); if (r.level==='error') continue;
            // сервисные ворота за агрегатом: над ними — трубопровод и выброс горячего воздуха коробом (решение ПНЕВМОТЕХ) —
            // контейнер выше, если места над воротами мало
            const up=this.overGate(r); if (up>g2.int[2]){ const H2=G.up(up+hOf);
              if (H2<=B.maxH){ const g3=Object.assign({}, g2, { ext:[Lx, c.Wx, H2] }); g3.int=G.inner(geo.type, g3.ext, t); const r3=this.fit(units, g3, [m]); if (r3.level!=='error'){ r=r3; g2=g3; } } }
            if (c.two && r.rows===1) break;                                          // вышел один ряд — его место среди однорядных
            const w=r.issues.filter(i=>i.level==='warn').map(i=>i.text);
            if (lw===0 && (w.some(x=>/^Проход|стоит в/.test(x)) || r.items.some(i=>i.tight))) break;   // рекомендуемые проход и отступ сзади не вышли — другая ширина
            if (ll===0 && w.some(x=>/^Промежутки|^Отступы/.test(x))) continue;      // промежутки — длиннее (место шкафу или фильтру в ряду)
            if ((r.doors||[]).some(d=>(d.why||[]).some(x=>/торцы заняты шкафами/.test(x)))){ alt=alt || { r, g2, Wx:c.Wx, a:c.a }; continue; }
            return done(r, g2, c.Wx);
          } }
        return alt ? done(alt.r, alt.g2, alt.Wx) : null; });
      if (got) return got; }
    const Wi=G.inner(geo.type, [10000, B.maxW, B.maxH], t)[1];
    const wideOk=this.need(probe, Wi-g2, 'row1', 1)!=null;
    const text=tall && !wideOk ? `Оборудование не помещается в блок-контейнер высотой до ${n(B.maxH)} мм — нужен контейнер нестандартной высоты (укажите размер вручную).`
      : !wideOk ? `Оборудование с проходом для оператора и обслуживания не проходит по ширине даже в блок-контейнере шириной ${n(B.maxW)} мм.`
      : `Оборудование не помещается в один блок-контейнер длиной до ${n(StationLayout.MAX_L)} мм — разделите станцию на два модуля или уменьшите состав.`;
    return { level:'error', geo, ext:null, int:null, issues:[{ level:'error', text }] };
  }

  /** контейнер, в который всё поместится с проходом: морской — следующий по размеру, иначе блок-контейнер с подобранным
   *  размером */
  suggest(units, geo){
    {
      if (geo.sea && !geo.own){
        let warnFit=null; const cur=StationGeo.SEA[geo.type];
        for (const M of [[{}], this.modes()]){   // сначала как обычно, затем — с исключениями (проход до 500 мм, без сквозного прохода)
          for (const t of StationGeo.SEA_ORDER){ const s=StationGeo.SEA[t]; if (t===geo.type || (s.ext[0]<=cur.ext[0] && s.ext[2]<=cur.ext[2])) continue;   // не больше — не поможет
            const r=this.fit(units, this.geoOf({ ctype:t, ins:geo.t+' мм' }), M);
            if (r.level==='ok') return { ctype:t, level:'ok' }; if (r.level==='warn' && !warnFit) warnFit={ ctype:t, level:'warn' }; }
          if (warnFit) return warnFit; }
      }
      const type=StationGeo.FLEX[geo.type] ? geo.type : 'block', r=this.autoSize(units, this.geoOf({ ctype:type, ins:geo.t+' мм', sizeAuto:true }));
      return r.level==='error' ? null : { ctype:type, size:r.geo.ext, level:r.level };
    }
  }

  /** контейнер с большим запасом: морской — меньший морской, в который всё помещается не хуже; блок-контейнер со своим
   *  размером — размер по оборудованию. Подсказка и кнопка «заменить» */
  excess(units, geo, plan){
    const n=StationLayout.n, rank={ ok:0, warn:1 }, lv=plan.issues.some(i=>i.level==='warn') ? 1 : 0;
    if (geo.sea && !geo.own){
      const cur=StationGeo.SEA[geo.type];
      for (const t of StationGeo.SEA_ORDER){ const s=StationGeo.SEA[t];
        if (t===geo.type || s.ext[0]>cur.ext[0] || s.ext[2]>cur.ext[2] || (s.ext[0]===cur.ext[0] && s.ext[2]===cur.ext[2])) continue;
        const r=this.fit(units, this.geoOf({ ctype:t, ins:geo.t+' мм' }), [{}]);   // меньший — только без исключений
        if (r.level==='error' || rank[r.level]>lv) continue;
        plan.suggest={ ctype:t, level:r.level, smaller:true };
        plan.issues.push({ level:'warn', big:true, text:`Контейнер с запасом: всё помещается в морской контейнер ${s.label} — меньше по размеру, массе и цене.` });
        return; }
    } else if (geo.own && StationGeo.FLEX[geo.type]){
      const r=this.autoSize(units, this.geoOf({ ctype:geo.type, ins:geo.t+' мм', sizeAuto:true }));
      if (r.level==='error' || !r.geo || !r.geo.ext || rank[r.level]>lv) return;
      const e=r.geo.ext; if (geo.ext[0]-e[0]<500 && geo.ext[1]-e[1]<300 && geo.ext[2]-e[2]<300) return;
      plan.suggest={ ctype:geo.type, size:e, level:r.level, smaller:true };
      plan.issues.push({ level:'info', big:true, text:`Размер задан с запасом: по оборудованию достаточно ${n(e[0])} × ${n(e[1])} × ${n(e[2])} мм.` });
    }
  }

  /** цвет контейнера из поля «Цвет» (первый RAL — стены, второй — рама); не указан — RAL 7035 / RAL 5005 условно */
  colors(){
    const c=this.cont||{}, r=RalColor.codes(c.ral), nm=RalColor.named(c.ral);
    const wall=r[0] ? r[0].hex : nm || '#CBD0CC', frame=r[1] ? r[1].hex : r[0] || nm ? RalColor.shade(wall, 0.72) : '#154889';
    return { wallColor:wall, frameColor:frame, colorKnown:!!(r[0] || nm), colorText:r.length ? r.map(x=>x.code).join(' / ') : String(c.ral||'').trim(), sys:c.sys||null };
  }

  /** сведения: условные габариты, что не попало на чертёж */
  notes(plan){
    const iss=plan.issues, nm=e=>`поз. ${e.pos} «${e.short}»`, n=StationLayout.n;
    const g=this.eq.filter(e=>e.place && !e.known); if (g.length) iss.push({ level:'info', text:`Габариты не указаны в характеристиках — взяты условные: ${g.map(e=>`${nm(e)} ${n(e.l)} × ${n(e.w)} × ${n(e.h)} мм`).join('; ')}. Укажите размеры в составе станции (характеристики элемента).` });
    const nd=this.eq.filter(e=>e.nodims); if (nd.length) iss.push({ level:'info', text:`Не размещены — нет габаритов: ${nd.map(e=>'«'+e.name+'»').join(', ')}.` });
    // ресиверы снаружи: площадка, подключение; при морозе — конденсат, если воздух не осушен адсорбционным осушителем
    const out=plan.outside||[];
    if (out.length){ const P=[...new Set(out.map(i=>i.pos))].join(', '), D=this.eq.filter(e=>e.kind==='dryer' && e.air && e.air.type!=='gen');
      iss.push({ level:'info', text:`${out.length>1 ? 'Ресиверы' : 'Ресивер'} поз. ${P} — снаружи, на бетонной площадке в ${n(StationLayout.OUT_GAP)} мм от дальнего торца (ФНП ОРПД, п. 65): трубопровод — через стену с запорной арматурой, на ресивере — предохранительный клапан и манометр, площадка — с ограждением от наезда.` });
      if (!D.length) iss.push({ level:'warn', text:`Ресивер снаружи без осушителя: зимой конденсат в ресивере и отводе замерзает — нужен обогреваемый отвод конденсата (греющий кабель, теплоизоляция) или осушитель перед ресивером.` });
      else if (!D.some(e=>e.air.type==='ads')) iss.push({ level:'info', text:`Ресивер снаружи после рефрижераторного осушителя (точка росы +3 °C): при морозе в нём выпадает и замерзает конденсат — нужен обогреваемый отвод конденсата или адсорбционный осушитель (точка росы −40 °C).` });
      if (plan.chassis) iss.push({ level:'info', text:`Станция на шасси: ресивер снаружи перевозится отдельно и ставится на площадку на объекте.` }); }
    if (plan.fuel){ const P=[...new Set((plan.items||[]).filter(i=>i.tank).map(i=>i.pos))].join(', ');
      iss.push({ level:'info', text:`Топливный бак поз. ${P} — в отдельном отсеке у торца: противопожарная перегородка 1-го типа (EI 45) без проёмов, топливопровод — через гильзу с уплотнением; вход в отсек — своя дверь снаружи; заливная горловина — снаружи в запираемом ящике; дыхательный клапан с огнепреградителем — над крышей; бак — в поддоне на полный объём; в отсеке — естественная вентиляция.` }); }
    StationHeat.notes(plan);
    // учёт в Ростехнадзоре — по произведению давления на вместимость
    const V=(plan.vessels||[]).filter(v=>v.pv!=null), reg=V.filter(v=>v.reg), free=V.filter(v=>!v.reg);
    if (reg.length) iss.push({ level:'info', text:`Подлежат учёту в Ростехнадзоре (ФНП ОРПД, п. 223: p·V больше 1,0 МПа·м³): ${reg.map(v=>`поз. ${v.pos} — ${PressureVessel.text(v)}`).join('; ')}. Регистрация, техническое освидетельствование и ответственные за исправное состояние — у эксплуатирующей организации${reg.some(v=>!v.out) ? '; размещают на открытой площадке или в отдельном здании, в помещении — когда иначе нельзя (п. 65): «Ресивер снаружи» — в требованиях заказчика на вкладке «Состав станции»' : ''}.` });
    if (free.length) iss.push({ level:'info', text:`Учёту в Ростехнадзоре не подлежат (p·V не больше 1,0 МПа·м³): ${free.map(v=>`поз. ${v.pos} — ${PressureVessel.text(v)}`).join('; ')}.` });
    const rf=plan.roof||[]; if (rf.length && plan.geo && plan.geo.ext){
      const top=Math.max(...rf.map(m=>m.gap+m.d)), h=plan.geo.ext[2]+Math.max(top, plan.geo.rise||0), ch=plan.chassis ? 1150 : 0;
      iss.push({ level:'info', text:`Глушитель на крыше над ДГУ, выхлоп — горизонтально в сторону (не вверх): высота станции с глушителем ${n(h)} мм${ch ? ` (на шасси — ${n(h+ch)} мм)` : ''}. Глушитель съёмный: при перевозке его снимают и ставят на объекте — высота с платформой не более ${n(StationLayout.ROAD_H)} мм.` });
      if (rf.some(m=>!m.known)) iss.push({ level:'info', text:`Размер глушителя не указан — взят условный по мощности ДГУ: ${rf.filter(m=>!m.known).map(m=>`поз. ${m.pos} — ${n(m.lx)} × Ø${n(m.d)} мм`).join('; ')}.` }); }
    const hang=(plan.items||[]).filter(i=>i.mount==='pipe' && !i.unit);
    for (const pp of plan.piping||[]){
      if (pp.implicit){ iss.push({ level:'info', text:`Фильтры (${hang.map(i=>'поз. '+i.pos).join(', ')}) висят на трубопроводе, а трубопроводной обвязки в составе нет — добавьте элемент «Трубопроводная обвязка и запорная арматура».` }); continue; }
      if (!pp.mat) iss.push({ level:'info', text:`Материал трубопровода (поз. ${pp.pos}) не выбран — на чертеже сталь. Выберите в «Составе станции»: сталь, нержавеющая сталь или полипропилен.` });
      else if (pp.mat==='pp' && this.eq.some(e=>e.kind==='dgu')) iss.push({ level:'warn', text:`Топливопровод (поз. ${pp.pos}) из полипропилена не применяют — выберите сталь или нержавеющую сталь.` });
      else if (pp.mat==='pp' && this.eq.some(e=>e.kind==='compressor')) iss.push({ level:'info', text:`Полипропилен для сжатого воздуха (поз. ${pp.pos}) — только в пределах давления труб при рабочей температуре (PP-R PN20 — 20 бар при 20 °C, при нагреве меньше); участок сразу после компрессора — металлом.` });
    }
  }

  /** 12345 → «12 345» */
  static n(v){ return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  static plural(n, a, b, c){ const m=n%10, h=n%100; return m===1 && h!==11 ? a : m>=2 && m<=4 && (h<12 || h>14) ? b : c; }
}
