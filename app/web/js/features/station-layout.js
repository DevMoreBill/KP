// Компоновка станции в контейнере (состав станции — kit.js): расстановка оборудования вдоль стен с проходом обслуживания,
// проверка длины, ширины и высоты, подбор размера блок-контейнера или другого контейнера, цвета и габариты из
// характеристик. Без DOM — проверяется node-тестом (tests/js/station_layout_test.js); чертёж и 3D-вид — station-draw.js,
// вкладка «Компоновка» и картинки для КП — station-ui.js.
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
      door: sea ? sea.door : null };
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
  static KIND = {
    compressor: { back:[600, 300], side:[700, 300], top:[1000, 300] },
    dryer:      { back:[500, 150], side:[500, 300], top:[650, 300] },
    filter:     { back:[150, 50],  side:[300, 150], top:[300, 150] },
    receiver:   { back:[300, 300], side:[300, 300], top:[300, 200] },
    pump:       { back:[300, 100], side:[1000, 1000], top:[300, 100] },
    dgu:        { back:[600, 300], side:[1000, 800], far:[300, 150], top:[500, 300], front:600 },
    cabinet:    { back:[0, 0],     side:[0, 0],     top:[0, 0] },
    tank:       { back:[100, 50],  side:[300, 100], top:[300, 100] },
    other:      { back:[300, 100], side:[500, 300], top:[300, 150] },
  };
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
    const rec=Math.max(500, Math.min(3000, D('st.aisle', 1000))), min=Math.max(500, Math.min(rec, D('st.aisleMin', 800)));
    return [rec, min];
  }
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
    const v=String((p && p.dn) || ((p && p.rows) || []).filter(r=>r && /условн\S* проход|диаметр|\bDN\b|\bДу\b/i.test(String(r.k||''))).map(r=>r.v)[0] || '').trim();
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
    ['dgu', /^dgu$/, /дизель-?генератор|\bДГУ\b|\bДЭС\b|генераторн\S* установ/i],
    ['pump', /^pump$/, /насос|мотопомп/i],
    ['cabinet', /^ats$/, /шкаф|щит|\bАВР\b|пульт/i],
    ['tank', null, /бак|[её]мкост/i],
  ];
  static CABINET = /шкаф|щит|\bАВР\b|пульт/i;
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
      const rows=(p.rows||[]).filter(r=>r && /габарит|размер|д\s*[×xх*]\s*ш/i.test(String(r.k||'')) && !/упаков|присоедин|фланц|патрубк/i.test(String(r.k||'')));
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
  /** цвет из характеристик: строка «Цвет…», «Окраска…», «…покрытие» или любой код RAL; иначе — условный по виду */
  static color(p, kind){
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
  /** вид изделия для рисунка на чертеже: поршневой компрессор (на ресивере) — 'piston', иначе '' */
  static look(p, kind){
    const cat=String((p.attrs&&p.attrs.cat)||p.cat||'');
    return kind==='compressor' && (cat==='comp_piston' || /поршнев/i.test(String(p.name||''))) ? 'piston' : '';
  }
  /** короткая подпись на чертеже: модель или первые слова названия */
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
  static list(parts){
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
      return { id:p.id, pos:++pos, name, brief:this.brief(p, k, name), short:this.short(p, k), kind:k, qty, l:d.l, w:d.w, h:d.h, known:d.known, src:d.src, mass:this.mass(p), kw:this.num((p.attrs||{}).kw),
        color:c.hex, colorKnown:c.known, colorText:c.text, shape:this.shape(p, k, d), look:this.look(p, k), place:true, pipe, mount:k==='cabinet' ? this.mount(p, d) : pipe ? 'pipe' : 'floor', air };
    });
    AirChain.assign(out);
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
    sep:{ name:'Влагоотделитель (циклонный сепаратор)', short:'влагоотделитель', stage:'' },
    pre:{ name:'Фильтр предварительной очистки (3–5 мкм)', short:'предварительной очистки', stage:'Предварительная' },
    fine:{ name:'Фильтр тонкой очистки (1 мкм, масло до 0,1 мг/м³)', short:'тонкой очистки', stage:'Тонкая' },
    micro:{ name:'Фильтр сверхтонкой очистки от масла (0,01 мкм, 0,01 мг/м³)', short:'сверхтонкой очистки от масла', stage:'Сверхтонкая (микрофильтр)' },
    dust:{ name:'Пылевой фильтр после адсорбционного осушителя (1 мкм)', short:'пылевой', stage:'Тонкая' },
    carbon:{ name:'Угольный фильтр (пары масла и запах, 0,003 мг/м³)', short:'угольный', stage:'Угольный (от паров масла)' },
  };
  // поправка производительности рефрижераторного осушителя на рабочее давление, бар → множитель (номинал — 7 бар)
  static KP = [[3, 0.64], [4, 0.75], [5, 0.84], [6, 0.92], [7, 1], [8, 1.05], [10, 1.12], [13, 1.22], [16, 1.27]];
  static MARGIN = 1.15;      // запас осушителя: летом в контейнере на входе +40 °C — производительность ×0,8
  static RECV = 125;         // ресивер, л на 1 м³/мин компрессора «нагрузка — холостой ход» (1 цикл в 30 с, перепад 1 бар)
  static RECV_VSD = 40;      // с частотным регулированием — меньше
  static RECV_SIZES = [100, 200, 270, 500, 900, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000, 10000];
  // класс чистоты по ISO 8573-1 (частицы.вода.масло) и где применяют
  static CLASSES = [
    ['3.4.3', 'пневмоинструмент, обдув — общепромышленный'],
    ['2.4.2', 'пневмоавтоматика, пневмоцилиндры'],
    ['1.4.1', 'окраска, упаковка, пищевая без контакта с продуктом'],
    ['2.2.2', 'КИПиА — приборный воздух, точка росы −40 °C'],
    ['1.2.1', 'пищевая с контактом с продуктом, фармацевтика, электроника'],
    ['1.1.1', 'медицина, лаборатории — точка росы −70 °C'],
  ];
  static PDP = [null, -70, -40, -20, 3, 7, 10];   // точка росы под давлением по классу воды, °C

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
    const st=String((p.attrs||{}).stage||'');
    if (/предвар/i.test(st)) return 'pre'; if (/сверхтонк|микро/i.test(st)) return 'micro'; if (/уголь/i.test(st)) return 'carbon'; if (/тонк/i.test(st)) return 'fine';
    if (/угол|угольн|активированн|пар\S*\s+масл|запах|(?:^|[^a-z])(?:QD|ACS)\s?\d/i.test(t)) return 'carbon';
    if (/пылев|после адсорбц|пыл\S*\s+адсорбент|(?:^|[^a-z])(?:DDp|PDp)\s?\d/i.test(t)) return 'dust';
    if (/сверхтонк|микрофильтр|0[.,]01\s*мкм|(?:^|[^a-z])(?:PD|AA)\s?\d/i.test(t)) return 'micro';
    if (/тонк\S*\s+(?:очистк|фильтр)|(?:^|\D)1\s*мкм|0[.,]1\s*мг|от масла|маслоотдел|коалесц|(?:^|[^a-z])(?:DD|AO)\s?\d/i.test(t)) return 'fine';
    if (/предварит|грубой|общей очистк|общего назначени|(?:^|\D)[35]\s*мкм|механическ/i.test(t)) return 'pre';
    if (/циклон|влагоотдел|сепаратор\S*\s+(?:влаг|вод)|водоотдел/i.test(t)) return 'sep';
    return '';
  }
  /** сведения для цепочки: компрессор — встроенные осушитель и фильтр, частотное регулирование; осушитель — вид и встроенные
   *  фильтры; ресивер — «мокрый» (до осушителя) или «сухой» (после); фильтр — ступень; у всех — производительность и давление */
  static info(p, kind){
    const a=p.attrs||{}, cat=String(a.cat||p.cat||''), t=this.text(p), nm=String(p.name||''), o={ flow:this.flow(p), bar:this.bar(p) };
    const yes=v=>/^(да|есть|встроен)/i.test(String(v??'').trim()), set=v=>v!=null && String(v).trim()!=='';
    if (kind==='compressor'){
      o.dryer=set(a.dryer) ? yes(a.dryer) : /(?:^|\s)со?\s+(?:встроенн\S*\s+)?(?:рефрижераторн\S*\s+)?осушител|встроенн\S*\s+(?:\S+\s+)?осушител|осушител\S*\s+встроен|(?:^|[^a-z])FF(?:[^a-z]|$)/i.test(nm)
        || (p.rows||[]).some(r=>r && /осушител/i.test(String(r.k||'')) && yes(r.v));
      o.filter=/встроенн\S*\s+(?:\S+\s+){0,2}фильтр|(?:^|\s)с\s+(?:\S+\s+){0,3}фильтр/i.test(nm) || (p.rows||[]).some(r=>r && /фильтр/i.test(String(r.k||'')) && /встроен/i.test(String(r.k||'')+' '+String(r.v||'')) && !/нет/i.test(String(r.v||'')));
      o.vsd=set(a.vsd) ? yes(a.vsd) : /частотн|инвертор|(?:^|[^a-z])VSD(?:[^a-z]|$)|(?:^|\s)ПЧ(?:\s|$)|переменн\S*\s+скорост/i.test(t);
      o.recv=StationEquip.num(a.receiver)>0 || /на ресивере/i.test(t); }
    else if (kind==='dryer'){
      o.type=/^gen_/.test(cat) || /генератор/i.test(nm) ? 'gen' : cat==='dryer_ads' || /адсорбц|десикант|мембран/i.test(t) ? 'ads' : 'refrig';
      o.filters=/встроенн\S*\s+(?:\S+\s+){0,2}фильтр|фильтр\S*\s+(?:\S+\s+)?встроен|(?:^|\s)с\s+(?:\S+\s+)?фильтрам|интегрированн\S*\s+(?:\S+\s+)?фильтр/i.test(t);
      o.pdp=this.first(String(a.dewPoint||'').replace('−', '-')); if (o.pdp!=null && /[−-]/.test(String(a.dewPoint))) o.pdp=-Math.abs(o.pdp); }
    else if (kind==='receiver'){ o.role=/сух/i.test(nm) || /после осушител/i.test(t) ? 'dry' : /мокр|влажн/i.test(nm) ? 'wet' : ''; o.vol=this.volume(p); }
    else if (kind==='filter') o.grade=this.grade(p, cat, t);
    return o;
  }

  /** порядок по ходу воздуха (e.air.stage, меньше — раньше), роли ресиверов и ступени фильтров без указания */
  static assign(eq){
    const A=eq.filter(e=>e.air), D=A.filter(e=>e.kind==='dryer' && e.air.type!=='gen'), ads=D.some(e=>e.air.type==='ads'), refrig=D.some(e=>e.air.type==='refrig');
    const R=A.filter(e=>e.kind==='receiver');
    if (!D.length) R.forEach(e=>{ if (!e.air.role) e.air.role='wet'; });
    else { const un=R.filter(e=>!e.air.role); let wet=R.some(e=>e.air.role==='wet'), dry=R.some(e=>e.air.role==='dry');
      un.forEach((e, k)=>{ e.air.role=!wet ? 'wet' : k===un.length-1 && !dry ? 'dry' : 'wet'; if (e.air.role==='wet') wet=true; else dry=true; }); }
    // фильтры без указанной ступени — чего не хватает по виду осушителя (адсорбционный: от масла до, пылевой после)
    // (несколько одинаковых фильтров одной строкой состава — каждому своя ступень)
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
      if (!D.length) return { sep:15, pre:31, fine:32, micro:33, dust:34, carbon:35 }[gr];
      return { sep:15, pre:31, fine:32, micro:ads ? 43 : 51, dust:52, carbon:55 }[gr]; };
    for (const e of A){ e.air.stage=st(e, e.air.grade); if (e.air.grades) e.air.stages=e.air.grades.map(g=>st(e, g)); }
  }
  /** единица k строки состава — её ступень (одинаковые фильтры одной строкой — разные ступени) */
  static unit(air, k){ return air && air.grades ? Object.assign({}, air, { grade:air.grades[k], stage:air.stages[k] }) : air; }
  /** по единицам: строка состава с разными ступенями — отдельными записями (qty 1) */
  static expand(A){ return A.flatMap(e=>e.air && e.air.grades ? e.air.grades.map((g, k)=>Object.assign({}, e, { qty:1, air:this.unit(e.air, k) })) : [e]); }
  /** поправка осушителя на давление */
  static kp(bar){
    const T=this.KP; if (!(bar>0)) return 1; if (bar<=T[0][0]) return T[0][1]; if (bar>=T[T.length-1][0]) return T[T.length-1][1];
    for (let i=1; i<T.length; i++) if (bar<=T[i][0]){ const [p0, k0]=T[i-1], [p1, k1]=T[i]; return k0+(k1-k0)*(bar-p0)/(p1-p0); }
    return 1;
  }
  /** поправка магистрального фильтра на давление (номинал — 7 бар): пропорционально абсолютному давлению, не больше 1,3 */
  static kf(bar){ return bar>0 ? Math.min(1.3, (bar+1)/8) : 1; }
  static m3(v){ return (Math.round(v*10)/10).toString().replace('.', ','); }

  /** проверка и подбор: {chain — по ходу воздуха, q — сумма компрессоров, м³/мин, issues, recs — чего не хватает (для подбора
   *  в каталоге)}; cls — класс чистоты по ISO 8573-1 («1.4.1») или '' */
  static check(eq, cls){
    const A=this.expand(eq.filter(e=>e.air && e.air.stage!=null && e.place!==false)), C=A.filter(e=>e.kind==='compressor');
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
      const kf=this.kf(bar);
      for (const e of F.filter(x=>x.air.flow>0 && x.air.grade!=='cond' && x.air.grade!=='sep')) if (e.air.flow*kf<q*0.98)
        iss.push({ level:'warn', air:true, text:`Фильтр ${nm(e)} «${e.short}»: ${m3(e.air.flow*kf)} м³/мин при ${m3(bar)} бар — меньше производительности компрессоров ${m3(q)} м³/мин: перепад давления растёт, фильтр не держит класс очистки. Нужен не менее ${m3(q/kf)} м³/мин.` });
      // ресивер: по самому производительному компрессору «нагрузка — холостой ход» (частотный — меньше)
      const big=known.reduce((m, e)=>e.air.flow>m.air.flow ? e : m, known[0]), vr=big ? this.RECV_SIZES.find(v=>v>=big.air.flow*(big.air.vsd ? this.RECV_VSD : this.RECV)) || this.RECV_SIZES[this.RECV_SIZES.length-1] : 0;
      const vol=R.reduce((s, e)=>s+(e.air.vol||0)*e.qty, 0), onRecv=C.some(e=>e.air.recv);
      if (vr && !R.length && !onRecv){
        iss.push({ level:'info', air:true, text:`Ресивера в составе нет — рекомендуется около ${StationLayout.n(vr)} л: сглаживает пульсации и пики потребления, собирает конденсат, компрессор реже переключается.` });
        rec('receiver', { title:`Воздушный ресивер около ${StationLayout.n(vr)} л`, why:'буфер и сбор конденсата — компрессор реже переключается', cat:'receiver', name:'Воздушный ресивер', f:{}, r:{ volume:[String(Math.round(vr*0.8)), ''] },
          attrs:{ cat:'receiver' }, rows:[{ k:'Объём', v:`около ${StationLayout.n(vr)} л` }] }); }
      else if (vr && R.length && R.every(e=>e.air.vol>0) && vol<vr*0.6)
        iss.push({ level:'info', air:true, text:`Ресиверы ${StationLayout.n(vol)} л — для компрессора ${m3(big.air.flow)} м³/мин${big.air.vsd ? ' с частотным регулированием' : ' с регулированием «нагрузка — холостой ход»'} рекомендуется около ${StationLayout.n(vr)} л (не чаще одного цикла в 30 с при перепаде 1 бар).` });
    }
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
    const word=e=>e.kind==='compressor' ? 'компрессор'+(e.air.dryer ? ' со встроенным осушителем' : '') : e.kind==='receiver' ? (e.air.role==='dry' ? '«сухой» ресивер' : 'ресивер') : e.kind==='dryer' ? (e.air.type==='ads' ? 'адсорбционный осушитель' : e.air.type==='gen' ? 'генератор' : 'рефрижераторный осушитель')+(e.air.filters ? ' (встроенные фильтры)' : '') : 'фильтр '+this.GRADES[e.air.grade].short;
    const chain=order.map(e=>({ pos:e.pos, kind:e.kind, text:word(e), guess:!!e.air.guess }));
    // для схемы пневматической: единицы по ходу воздуха и очистка конденсата (масловодоотделитель — не на линии)
    const units=order.map(e=>({ pos:e.pos, kind:e.kind, qty:e.qty||1, name:e.name, brief:e.brief, short:e.short, air:e.air }));
    const cond=eq.filter(e=>e.kind==='filter' && e.air && e.air.grade==='cond' && e.place!==false).map(e=>({ pos:e.pos, qty:e.qty||1, name:e.name, brief:e.brief }));
    return { chain, q, bar, issues:iss, recs, cls:cl ? String(cls) : '', units, cond };
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
  static VER = 6;           // версия правил и рисунков: изменилась — картинки станций в КП пересобираются
  static MAX_L = 12000;
  static PIPE_PAD = 60;      // зазор вокруг фильтра на трубопроводе, мм
  static AIR_Y = 150;        // линия сжатого воздуха: ось — в 150 мм от задней стены (или посередине между рядами)
  static DOOR_GAP = [300, 100];   // обслуживание снаружи: от оборудования до сервисной двери [рекомендуется, не менее], мм
  // сервисные двери: проём шире оборудования на 200 мм (от 800 до 2400), створка до 1200, высота 2000, от углов — 100
  static DOOR = { min:800, max:2400, leaf:1200, h:2000, pad:100 };
  static ENTRY = [300, 1200];     // дверь в стене прохода блок-контейнера: от торца (за тамбуром), мм
  static DOOR_MIN = 600;     // дверь оператора и сервисный проём — не уже 600 мм в свету
  static CAB_TOP = 1900;     // настенный шкаф: верх — на 1,9 м от пола (рукоятки и панель оператора — на уровне глаз),
  static CAB_LOW = 300;      // низ — не ниже 300 мм
  static ROOF_GAP = 200;     // глушитель на опорах над крышей, мм
  static OUTLET = 500;       // вывод выхлопа над глушителем (с дождевым колпаком), мм
  static ROAD_H = 4000;      // наибольшая высота при перевозке (с платформой), мм

  static solve(input){ return new StationLayout(input).run(); }

  /** отпечаток всего, от чего зависит компоновка: изменился — чертёж и 3D-вид пора обновить */
  static hash(input){
    const c=input.cont||{}, pick=a=>a ? {cat:a.cat, size:a.size, mass:a.mass, model:a.model, maker:a.maker, orient:a.orient, kw:a.kw, volume:a.volume, color:a.color, flow:a.flow, pressure:a.pressure, stage:a.stage, dryer:a.dryer, vsd:a.vsd, dewPoint:a.dewPoint, receiver:a.receiver} : null;
    const s=JSON.stringify([this.VER, StationClear.aisle(), [c.ctype, c.size, c.sizeAuto, c.ins, c.ral, c.sys||null], input.chassisH||null,
      (input.parts||[]).filter(p=>p && p.role!=='container').map(p=>[p.name, p.qty, p.role||'', p.pipeMat||'', p.dn||'', p.mount||'', pick(p.attrs), (p.rows||[]).filter(r=>r && /габарит|размер|масса|вес|цвет|окраск|покрыт|длина|ширина|высота|объ[её]м|RAL|установк|исполнен|производительн|пропускн|давлени|ступен|очистк|фильтр|осушител|регулирован|точк\S* росы/i.test(String(r.k||'')+' '+String(r.v||''))).map(r=>[r.k, r.v])])]);
    return this.fnv(s);
  }
  /** FNV-1a, 8 шестнадцатеричных знаков */
  static fnv(s){
    let h=0x811c9dc5; for (let i=0; i<s.length; i++){ h^=s.charCodeAt(i); h=Math.imul(h, 0x01000193)>>>0; }
    return h.toString(16).padStart(8, '0');
  }

  constructor(input){
    this.in=input||{}; this.cont=this.in.cont||null;
    this.eq=StationEquip.list(this.in.parts||[]);
    this.aisle=StationClear.aisle();
    this.mode='aisle';          // aisle — проход внутри, doors — обслуживание снаружи через сервисные двери
    this.allowDoors=true;       // заданный контейнер: нет места для прохода — сервисные двери
  }

  run(){
    const placed=this.eq.filter(e=>e.place), extra=this.eq.filter(e=>!e.place);
    const base={ items:[], extra, chassis:extra.some(e=>e.kind==='chassis'), muffler:extra.some(e=>e.kind==='muffler'), aisleRule:this.aisle, issues:[] };
    if (!this.cont) return Object.assign(base, { level:'none', text:'Выберите контейнер в составе станции.' });
    if (!placed.length) return Object.assign(base, { level:'none', text:'Добавьте в состав оборудование — компрессор, насос, ДГУ и т. п.' });
    const units=this.units(placed), geo=StationGeo.of(this.cont);
    let plan=geo.auto ? this.autoSize(units, geo) : this.fit(units, geo);
    if (plan.level==='error' && !geo.auto) plan.suggest=this.suggest(units, geo);
    else if (plan.level!=='error' && !geo.auto){
      if (plan.door==='service') plan.suggest=this.suggest(units, geo, true);   // с проходом внутри — какой контейнер нужен
      else this.excess(units, geo, plan); }
    if (plan.level!=='error' && plan.items && plan.items.length){ plan.roof=this.roof(plan); plan.piping=this.route(plan); }
    // «не помещается» точно, если не помещается и без оборудования с условными габаритами; иначе — лишь оценка (assumed)
    if (plan.level==='error' && units.some(e=>!e.known)){ const k=units.filter(e=>e.known);
      plan.assumed=!k.length || (geo.auto ? this.autoSize(k, geo) : this.fit(k, geo)).level!=='error'; }
    plan=Object.assign(base, plan, { issues:plan.issues||[] }, this.colors());
    const air=AirChain.check(this.eq, this.in.air);
    if (air && plan.level!=='error'){ plan.air=air; plan.issues.push(...air.issues); }
    this.notes(plan);
    if (plan.level==='ok' && plan.issues.some(i=>i.level==='warn')) plan.level='warn';
    return plan;
  }

  /** единицы оборудования в порядке расстановки от двери: шкафы, остальное по составу (сжатый воздух — по ходу воздуха:
   *  компрессоры, ресивер, фильтры, осушитель…), топливный бак, ДГУ — в дальнем торце */
  units(placed){
    const u=[]; for (const e of placed) for (let k=0; k<e.qty; k++) u.push(Object.assign({}, e, { unit:k, c:StationClear.of(e.kind, e), air:AirChain.unit(e.air, k) }));
    const dgu=placed.some(e=>e.kind==='dgu'), air=placed.some(e=>e.kind==='compressor');
    const rank=e=>e.kind==='cabinet' ? 0 : e.kind==='dgu' ? 2 : e.kind==='tank' && dgu ? 1.5 : air && e.air && e.air.stage!=null ? 1+e.air.stage/100 : air ? 1.8 : 1;
    return u.map((e, i)=>[e, i]).sort((a, b)=>rank(a[0])-rank(b[0]) || a[1]-b[1]).map(([e])=>e);
  }
  /** в два ряда — в задний ряд: ДГУ; аппараты цепочки сжатого воздуха (если есть компрессоры) — подряд по ходу воздуха */
  backRow(e, units){ return e.kind==='dgu' || (units.some(u=>u.kind==='compressor') && (StationLayout.series(e) || (e.slot && e.kind==='filter'))); }
  /** аппарат на линии сжатого воздуха с одним входом и одним выходом (ресивер, осушитель, фильтр на полу) */
  static series(e){ return !!e.air && e.air.stage!=null && e.kind!=='compressor' && e.mount!=='pipe' && !e.pipe; }
  static key(e){ return e.id+'#'+e.unit; }

  /** перед оборудованием [рекомендуется, не менее]: проход обслуживания (вдоль ДГУ «не менее» — своё) или, при обслуживании
   *  снаружи, зазор до сервисной двери */
  front(e){
    if (this.mode==='doors') return StationLayout.DOOR_GAP;
    return [this.aisle[0], e.c.front!=null ? Math.min(this.aisle[1], e.c.front) : this.aisle[1]];
  }

  // ---- высота: оборудование + место над ним; настенный шкаф — от 300 мм над полом; фильтры висят на трубе
  heights(units, H){
    const iss=[], n=StationLayout.n; let bad=false;
    for (const e of units){ if (e.unit || e.pipe) continue;
      if (e.mount==='wall'){ if (e.h+StationLayout.CAB_LOW>H-50){ bad=true; iss.push({ level:'error', text:`Поз. ${e.pos} «${e.short}» не помещается на стене по высоте: ${n(e.h)} мм и не ниже ${n(StationLayout.CAB_LOW)} мм от пола, а высота внутри — ${n(H)} мм.` }); } continue; }
      const top=e.c.top, room=H-e.h;
      if (room<top[1]){ bad=true; iss.push({ level:'error', text:`Поз. ${e.pos} «${e.short}» не проходит по высоте: ${n(e.h)} мм и не менее ${n(top[1])} мм над ним, а высота внутри — ${n(H)} мм.` }); }
      else if (room<top[0]){
        if (e.kind==='compressor') iss.push({ level:'info', text:`Над компрессором (поз. ${e.pos}) ${n(room)} мм до потолка — горячий воздух отводится воздуховодом (в помещении рекомендуется 1 м).` });
        else iss.push({ level:'warn', text:`Над поз. ${e.pos} «${e.short}» ${n(room)} мм до потолка — рекомендуется ${n(top[0])} мм.` }); }
    }
    return { bad, iss };
  }

  // ---- один ряд: у задней стены лицом к проходу (без прохода — у стены с дверями, лицом к ней)
  row1(units, Lu, W, noRotate){
    const U=units.map(e=>({ e, rot:false }));
    const depth=o=>o.rot ? o.e.l : o.e.w, lenX=o=>o.rot ? o.e.w : o.e.l;
    const canRot=o=>!noRotate && !/^(dgu|cabinet)$/.test(o.e.kind) && o.e.shape==='box' && o.e.l>o.e.w+50;   // шкаф — дверцами к проходу
    const need=o=>depth(o)+o.e.c.back[1]+this.front(o.e)[1], wide=o=>need(o)<=W;
    for (const o of U) if (!wide(o) && canRot(o)){ o.rot=true; if (!wide(o)) o.rot=false; }
    const narrow=U.filter(o=>!wide(o));
    if (narrow.length) return { ok:false, why:'width', bad:narrow.map(o=>o.e), needW:Math.max(...narrow.map(need)) };
    const len=lvl=>this.chain(U.map(o=>o.e), lvl).sum+U.reduce((s, o)=>s+lenX(o), 0);
    if (len(1)>Lu){   // не хватает длины — поворачиваем поперёк то, что позволяет ширина (сначала дающее больше длины)
      for (const o of U.filter(canRot).sort((a, b)=>(b.e.l-b.e.w)-(a.e.l-a.e.w))){ o.rot=true; if (!wide(o)){ o.rot=false; continue; } if (len(1)<=Lu) break; } }
    if (len(1)>Lu) return { ok:false, why:'length', needL:len(1), needL0:len(0) };
    return this.place([U], Lu, W, depth, lenX);
  }

  // ---- два ряда у длинных стен, проход посередине
  row2(units, Lu, W){
    const A=[], B=[], lenOf=(R, lvl)=>this.chain(R.map(o=>o.e), lvl).sum+R.reduce((s, o)=>s+o.e.l, 0);
    for (const e of units){ const o={ e, rot:false }; if (this.backRow(e, units)) B.push(o); else (lenOf(A, 1)<=lenOf(B, 1) ? A : B).push(o); }
    if (!A.length || !B.length) return { ok:false, why:'rows' };
    const dmax=R=>Math.max(...R.map(o=>o.e.w+o.e.c.back[1])), aMin=Math.max(...[...A, ...B].map(o=>this.front(o.e)[1]));
    if (W-dmax(A)-dmax(B)<aMin) return { ok:false, why:'width2' };
    const L1=Math.max(lenOf(A, 1), lenOf(B, 1)); if (L1>Lu) return { ok:false, why:'length2', needL:L1, needL0:Math.max(lenOf(A, 0), lenOf(B, 0)) };
    return this.place([B, A], Lu, W, o=>o.e.w, o=>o.e.l);
  }

  // ---- без прохода, два ряда спиной друг к другу: каждый — лицом к своей стене с сервисными дверями
  rowsBack(units, Lu, W){
    const A=[], B=[], lenOf=(R, lvl)=>this.chain(R.map(o=>o.e), lvl).sum+R.reduce((s, o)=>s+o.e.l, 0);
    for (const e of units){ const o={ e, rot:false }; if (this.backRow(e, units)) B.push(o); else (lenOf(A, 1)<=lenOf(B, 1) ? A : B).push(o); }
    if (!A.length || !B.length) return { ok:false, why:'rows' };
    const g=StationLayout.DOOR_GAP[1], dmax=R=>Math.max(...R.map(o=>o.e.w)), mid=Math.max(150, ...[...A, ...B].map(o=>o.e.c.back[1]));
    if (W-dmax(A)-dmax(B)-2*g-mid<0) return { ok:false, why:'width2' };
    const L1=Math.max(lenOf(A, 1), lenOf(B, 1)); if (L1>Lu) return { ok:false, why:'length2', needL:L1, needL0:Math.max(lenOf(A, 0), lenOf(B, 0)) };
    return this.place([B, A], Lu, W, o=>o.e.w, o=>o.e.l);
  }
  /** без прохода: один ряд лицом к стене с дверями; не хватает длины — два ряда спиной друг к другу */
  rowsDoors(units, Lu, W){
    const r=this.row1(units, Lu, W); if (r.ok || r.why!=='length') return r;
    const r2=this.rowsBack(units, Lu, W); if (r2.ok) return r2;
    return r2.why==='length2' && r2.needL<r.needL ? Object.assign(r2, { why:'length' }) : r;
  }

  /** промежутки по длине ряда: у двери, между соседними, в дальнем торце (lvl 0 — рекомендуемые, 1 — не менее) */
  chain(E, lvl){
    const g=[]; if (!E.length) return { gaps:g, sum:0 };
    g.push(E[0].c.side[lvl]);
    for (let i=1; i<E.length; i++) g.push(Math.max(E[i-1].c.side[lvl], E[i].c.side[lvl]));
    const last=E[E.length-1]; g.push(last.c.far ? last.c.far[lvl] : last.c.side[lvl]);
    return { gaps:g, sum:g.reduce((s, v)=>s+v, 0) };
  }

  /** места в рядах: R[0] — у задней стены, R[1] — у стены с дверью; отступы — от «не менее» к рекомендуемым */
  place(R, Lu, W, depth, lenX){
    const n=StationLayout.n, aRec=this.aisle[0], items=[], iss=[], rows=R.filter(r=>r.length).length, G=StationLayout.DOOR_GAP;
    let gapsShort=false, minGap=Infinity;
    R.forEach((row, ri)=>{ if (!row.length) return;
      const E=row.map(o=>o.e), rec=this.chain(E, 0), mn=this.chain(E, 1), body=row.reduce((s, o)=>s+lenX(o), 0);
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
    if (rows===1 && this.mode==='doors'){   // лицом к сервисным дверям, в зазоре до двери; свободное место — сзади
      for (const it of items){ const b=back(it), budget=W-it.d, fr=this.front(it.o.e);
        if (it.o.e.kind==='dgu' && budget/2>=fr[1]){ it.y=Math.round(budget/2); it.face=0; it.aisle=it.y; it.back=budget-it.y; continue; }   // ДГУ — посередине: двери с обеих сторон
        const f=Math.max(fr[1], Math.min(fr[0], budget-b[1])); it.back=budget-f; it.aisle=f; it.y=f; it.face=-1; }
    } else if (rows===1){
      for (const it of items){ const b=back(it), budget=W-it.d, fr=this.front(it.o.e)[0];
        it.back = budget-b[0]>=fr ? b[0] : budget-fr>=b[1] ? budget-fr : b[1];
        it.aisle=budget-it.back; it.y=W-it.back-it.d; it.face=-1; }
    } else if (this.mode==='doors'){   // спиной друг к другу: зазор до дверей — поровну из свободного, посередине — трубы
      const A=items.filter(i=>i.ri===1), B=items.filter(i=>i.ri===0), dm=(S, f)=>S.length ? Math.max(...S.map(f)) : 0;
      const mid=Math.max(150, dm(items, i=>back(i)[1])), f=Math.max(G[1], Math.min(G[0], (W-dm(A, i=>i.d)-dm(B, i=>i.d)-mid)/2));
      const midW=W-2*f-dm(A, i=>i.d)-dm(B, i=>i.d);
      for (const it of A){ it.y=Math.round(f); it.face=-1; it.aisle=f; it.back=midW; }
      for (const it of B){ it.y=Math.round(W-f-it.d); it.face=1; it.aisle=f; it.back=midW; }
    } else {
      const A=items.filter(i=>i.ri===1), B=items.filter(i=>i.ri===0), dm=(S, f)=>S.length ? Math.max(...S.map(f)) : 0;
      const recOk=W-dm(A, i=>i.d+back(i)[0])-dm(B, i=>i.d+back(i)[0])>=aRec;
      for (const it of items) it.back=recOk ? back(it)[0] : back(it)[1];
      const free=W-dm(A, i=>i.d+i.back)-dm(B, i=>i.d+i.back);
      for (const it of B){ it.y=W-it.back-it.d; it.face=-1; it.aisle=free; }
      for (const it of A){ it.y=it.back; it.face=1; it.aisle=free; }
    }
    const eq=items.filter(i=>!i.o.e.slot), aisleW=eq.length ? Math.min(...eq.map(i=>i.aisle)) : W, dgu=eq.find(i=>i.o.e.kind==='dgu'), other=eq.filter(i=>i.o.e.kind!=='dgu');
    const aisleO=this.mode==='doors' ? Infinity : other.length ? Math.min(...other.map(i=>i.aisle)) : Infinity;
    if (aisleO<aRec) iss.push({ level:'warn', text:`Проход обслуживания ${n(aisleO)} мм — меньше рекомендуемых ${n(aRec)} мм (допустимо от ${n(this.aisle[1])} мм).` });
    if (dgu && dgu.aisle<aRec && this.mode!=='doors') iss.push({ level:'warn', text:`Проход вдоль ДГУ ${n(dgu.aisle)} мм — меньше рекомендуемых ${n(aRec)} мм (допустимо от ${n(this.front(dgu.o.e)[1])} мм).` });
    if (gapsShort && Number.isFinite(minGap)) iss.push({ level:'warn', text:`Промежутки между оборудованием уменьшены до ${n(minGap)} мм — по длине не хватает места для рекомендуемых.` });
    else if (gapsShort) iss.push({ level:'warn', text:'Отступы от торцов уменьшены — по длине не хватает места для рекомендуемых.' });
    for (const it of eq) if (it.back<back(it)[0] && back(it)[0]>150 && !it.o.e.unit) iss.push({ level:'warn', text:`Поз. ${it.o.e.pos} «${it.o.e.short}» стоит в ${n(it.back)} мм ${rows===2 && this.mode==='doors' ? 'от оборудования напротив' : 'от стены'} — рекомендуется ${n(back(it)[0])} мм.` });
    return { ok:true, rows, aisleW, items, iss };
  }

  /** заданный контейнер: оборудование на полу — рядами; настенные шкафы — на стене прохода, фильтры — на трубопроводе;
   *  не нашлось им места — своё место в ряду (шкаф — на стене за ним или на раме за сервисной дверью, фильтр — на трубе) */
  fit(units, geo){
    let wall=units.filter(e=>e.mount==='wall'), hang=units.filter(e=>e.pipe), floor=units.filter(e=>!e.pipe && e.mount!=='wall');
    if (!floor.length){ floor=units.map(e=>Object.assign({}, e, { slot:true })); wall=[]; hang=[]; }
    let r=this.fitRow(floor, geo, units);
    if (r.level==='error') return r;
    const left=this.attach(r, wall, hang, geo);
    if (left.length){
      const ids=new Set(left.map(StationLayout.key)), rest=e=>!ids.has(StationLayout.key(e));
      const r2=this.fitRow([...floor, ...left.map(e=>Object.assign({}, e, { slot:true }))], geo, units);
      if (r2.level==='error') return r2;
      this.attach(r2, wall.filter(rest), hang.filter(rest), geo);
      r=r2;
    }
    this.finish(r, geo);
    return r;
  }

  /** ряды в заданном контейнере: высота, затем один ряд, при нехватке — два ряда; прохода не получается — сервисные двери */
  fitRow(units, geo, all){
    const [L, W, H]=geo.int, Lu=L-geo.x0, hh=this.heights(all, H), n=StationLayout.n;
    let r, need=null;
    if (this.mode==='doors') r=this.rowsDoors(units, Lu, W);
    else {
      r=this.row1(units, Lu, W);
      if (!r.ok || r.iss.some(i=>i.level==='warn')){ const r2=this.row2(units, Lu, W); if (r2.ok && (!r.ok || !r2.iss.some(i=>i.level==='warn'))) r=r2; }
      if (!r.ok && this.allowDoors){   // прохода не получается — обслуживание снаружи через сервисные двери
        if (r.why==='width') need=r.needW;
        this.mode='doors'; const rd=this.rowsDoors(units, Lu, W); this.mode='aisle';
        if (rd.ok){ rd.doors=true; r=rd; } else if (r.why==='width' && rd.why==='length') r=rd; }
    }
    if (r.ok && (this.mode==='doors' || r.doors)) r.doors=true;
    const res={ geo, ext:geo.ext, int:geo.int };
    if (!r.ok){
      const iss=[...hh.iss];
      if (r.why==='width') iss.unshift({ level:'error', text:`Не проходит по ширине: ${r.bad.filter(e=>!e.unit).slice(0, 3).map(e=>`поз. ${e.pos} «${e.short}» (${n(e.w)} мм)`).join(', ')} — вместе с проходом обслуживания и отступом от стены нужно ${n(r.needW)} мм, а ширина внутри — ${n(W)} мм.` });
      else iss.unshift({ level:'error', text:`Не помещается по длине: нужно ${n(r.needL)} мм, а внутри контейнера ${n(Lu)} мм — не хватает ${n(r.needL-Lu)} мм.` });
      return Object.assign(res, { level:'error', issues:iss, need:{ L:r.needL||null, W:r.needW||null } });
    }
    const items=r.items.map(it=>this.item(it, geo)), iss=[...hh.iss, ...r.iss];
    return Object.assign(res, { level:hh.bad ? 'error' : 'ok', bad:hh.bad, items, rows:r.rows, service:!!r.doors, needW:need, door:r.doors ? 'service' : r.rows===2 || geo.sea ? 'end' : 'side',
      doors:null, aisle:{ w:r.doors ? 0 : r.aisleW, rows:r.rows, service:!!r.doors }, issues:iss });
  }

  /** сервисные двери и итог: уровень, занятая длина */
  finish(r, geo){
    const n=StationLayout.n;
    if (r.service){ r.doors=this.serviceDoors(r.items, geo); const f=r.doors.filter(d=>d.wall==='front').length, b=r.doors.length-f, k=f+b;
      const where=b && f ? `в обеих боковых стенах (${k} ${StationLayout.plural(k, 'проём', 'проёма', 'проёмов')}: ${f} и ${b})` : `в боковой стене (${k} ${StationLayout.plural(k, 'проём', 'проёма', 'проёмов')})`;
      r.issues.unshift({ level:'warn', text:`Прохода обслуживания внутри нет${r.needW ? ` — по ширине нужно ${n(r.needW)} мм, внутри ${n(geo.int[1])} мм` : ''}: оборудование обслуживается снаружи через сервисные двери ${where}. У дверей на площадке — свободная зона не менее 1,5 м.` }); }
    r.level=r.bad ? 'error' : r.issues.some(i=>i.level==='warn') ? 'warn' : 'ok';
    r.used=this.used(r.items, geo);
    delete r.segs;
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
    for (const [g, E] of groups){ const back=!!g && g.s1>=40 && g.s1<50;
      E.sort((a, b)=>back ? st(b)-st(a) : st(a)-st(b));
      for (const e of E){ const it=this.pipeSpot(e, r, geo, g, back); if (it) r.items.push(it); else left.push(e); } }
    return left;
  }

  /** трубопровод (геометрия): магистрали за оборудованием — у задней стены или между рядами, спиной друг к другу, с
   *  отводами к оборудованию и выходом через дальний торец: насосы — всас и напор, компрессорная — сжатый воздух через
   *  осушители и ресиверы, ДГУ — топливо от бака. dh — наибольший фильтр на линии: ось — дальше от стены на его половину */
  lines(r, geo, dh){
    const [L, W, H]=geo.int, fl=r.items.filter(i=>i.mount==='floor'), has=k=>fl.some(i=>i.kind===k), out=[];
    r.segs=[];
    if (!fl.length) return out;
    const mid=r.service && r.rows===2, A=fl.filter(i=>i.row===1), B=fl.filter(i=>i.row!==1), zTop=Math.max(600, Math.min(H-400, 1500));
    const over=r.rows===2 && !r.service, room={ fuel:50, air:100, in:140, out:140, gen:100 }, hang=(dh||0)/2+40;
    // ось линии: conn — что соединяет; off — от стены, мм (part — доля полосы, если полоса уже); z — высота оси; x0…x1 — путь
    const place=(conn, off, part, z, medium, x0, x1)=>{
      // полоса: между рядами — от задних сторон одного ряда до другого; иначе — за этим оборудованием до стены
      const back=conn.filter(i=>i.row!==1), lo=mid ? Math.max(...A.map(i=>i.y+i.ly)) : back.length ? Math.max(...back.map(i=>i.y+i.ly)) : 0, hi=mid ? Math.min(...B.map(i=>i.y)) : W, bw=hi-lo;
      const y=Math.round(mid ? lo+bw*part : Math.min(W-40, hi-Math.min(off, bw*part)));
      // нет места под трубу за оборудованием или ряды напротив (через проход) — над оборудованием
      if (bw<room[medium] || over) z=Math.min(H-150, Math.max(z, ...conn.map(i=>i.h+(medium==='out' ? 450 : 200))));
      // линия не проходит сквозь оборудование: на её пути выше неё — над ним
      const hit=fl.filter(i=>i.x<x1 && i.x+i.lx>x0 && i.y<y+60 && i.y+i.ly>y-60 && i.h>z-60);
      if (hit.length) z=Math.min(H-120, Math.max(z, ...hit.map(i=>i.h+150)));
      return { y, z:Math.round(z), lo, hi }; };
    const line=(conn, off, part, z, label, medium, toEnd)=>{ if (!conn.length) return;
      const g=place(conn, off, part, z, medium, Math.min(...conn.map(i=>i.x+i.lx/2)), toEnd ? L : Math.max(...conn.map(i=>i.x+i.lx/2)));
      const br=conn.map(i=>this.branch(i, g.y, g.z)).filter(Boolean), xs=[...br.map(b=>b.x), ...conn.filter(i=>!br.some(b=>b.to===StationLayout.key(i))).map(i=>Math.round(i.x+i.lx/2))];
      out.push({ x0:Math.min(...xs), x1:toEnd ? L : Math.max(...xs), y:g.y, z:g.z, label, medium, branches:br }); };
    if (has('pump')){ const P=fl.filter(i=>i.kind==='pump'); line(P, 110, mid ? 0.33 : 0.3, 450, 'вход', 'in', true); line(P, 240, mid ? 0.67 : 0.7, Math.min(zTop, 1300), 'выход', 'out', true); }
    else if (has('compressor')){ const a=this.airLines(fl, place, L, H, Math.max(StationLayout.AIR_Y, hang), zTop); out.push(...a.lines); r.segs=a.segs; }
    else if (has('dgu')){ if (has('tank')) line(fl.filter(i=>i.kind==='tank' || i.kind==='dgu'), 120, 0.5, 300, '', 'fuel', false); }
    else line(fl.filter(i=>i.kind!=='cabinet'), Math.max(150, hang), 0.5, Math.min(zTop, 1200), 'выход', 'gen', true);
    return out;
  }
  /** сжатый воздух — последовательно по ходу воздуха: компрессоры → коллектор → аппараты (ресивер, фильтр на полу, осушитель:
   *  у каждого один вход и один выход — магистраль на нём прерывается, gaps) → выход через дальний торец. Компрессоры не все
   *  до первого аппарата (два ряда) — коллектор отдельной трубой выше магистрали. segs — участки между аппаратами: на них
   *  висят фильтры по своей ступени (s0 < ступень < s1) */
  airLines(fl, place, L, H, off, z0){
    const src=fl.filter(i=>i.kind==='compressor'), ser=fl.filter(i=>StationLayout.series(i)).sort((a, b)=>a.air.stage-b.air.stage || a.x-b.x), conn=[...src, ...ser];
    if (!conn.length) return { lines:[], segs:[] };
    const g=place(conn, off, 0.5, z0, 'air', Math.min(...conn.map(i=>i.x)), L), y=g.y, z=g.z;
    const out=(i, yy, zz)=>Object.assign(this.branch(i, yy, zz) || { x:Math.round(i.x+i.lx/2), y0:yy, y1:yy, z1:zz, to:StationLayout.key(i) }, { role:'out' });
    const P=ser.map(i=>this.ports(i, y, z)), sb=src.map(i=>out(i, y, z)), firstIn=P.length ? P[0][0].x : L, lines=[], segs=[], stOf=k=>ser[k].air.stage;
    if (sb.every(b=>b.x<firstIn-60)){   // компрессоры — до первого аппарата: одна магистраль
      const ln={ x0:Math.min(...sb.map(b=>b.x), firstIn), x1:L, y, z, label:'выход', medium:'air', branches:[...sb, ...P.flat()], gaps:P.map(([a, b])=>[a.x, b.x]) };
      lines.push(ln);
      let a=sb.length ? Math.max(...sb.map(b=>b.x)) : ln.x0, s0=10;
      ser.forEach((it, k)=>{ segs.push({ a, b:P[k][0].x, s0, s1:stOf(k), line:ln }); a=P[k][1].x; s0=stOf(k); });
      segs.push({ a, b:L, s0, s1:Infinity, line:ln });
      return { lines, segs };
    }
    // коллектор компрессоров — выше (или ниже) магистрали и чуть в стороне на плане: к входу первого аппарата
    const zh=z+220<=H-120 ? z+220 : z-220, yh=Math.max(g.lo+40, Math.min(g.hi-40, y-110));
    const hb=src.map(i=>out(i, yh, zh)), hin=this.ports(ser[0], yh, zh)[0], hx=[...hb.map(b=>b.x), hin.x];
    const head={ x0:Math.min(...hx), x1:Math.max(...hx), y:yh, z:zh, label:'', medium:'air', branches:[...hb, hin], gaps:[], header:true };
    const tr={ x0:P[0][1].x, x1:L, y, z, label:'выход', medium:'air', branches:[P[0][1], ...P.slice(1).flat()], gaps:P.slice(1).map(([a, b])=>[a.x, b.x]) };
    lines.push(head, tr);
    // до первого аппарата фильтр — на участке коллектора, по которому идёт весь воздух (компрессоры с одной стороны)
    const lw=hb.filter(b=>b.x<hin.x).map(b=>b.x), rw=hb.filter(b=>b.x>hin.x).map(b=>b.x);
    const a0=lw.length ? Math.max(...lw) : null, b0=rw.length ? Math.min(...rw) : null;
    segs.push(a0!=null && (b0==null || hin.x-a0>=b0-hin.x) ? { a:a0, b:hin.x, s0:10, s1:stOf(0), line:head } : { a:hin.x, b:b0, s0:10, s1:stOf(0), line:head });
    let a=P[0][1].x, s0=stOf(0);
    ser.slice(1).forEach((it, k)=>{ segs.push({ a, b:P[k+1][0].x, s0, s1:stOf(k+1), line:tr }); a=P[k+1][1].x; s0=stOf(k+1); });
    segs.push({ a, b:L, s0, s1:Infinity, line:tr });
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

  /** свои места в ряду: шкаф — на стене за местом (без прохода — на раме за сервисной дверью), фильтр — на трубе над местом */
  mountSlot(it, r, geo){
    const [, W, H]=geo.int;
    if (it.kind==='cabinet'){
      it.z=Math.max(StationLayout.CAB_LOW, Math.min(StationLayout.CAB_TOP, H-150)-it.h);
      if (r.service){ it.mount='frame'; return; }
      it.mount='wall'; if (it.row===1){ it.y=0; it.wall='front'; } else { it.y=W-it.ly; it.wall='back'; }
      return;
    }
    const g=this.segOf(r, it), ln=g && g.line; if (!ln || ln.z+Math.max(60, it.h*0.12)-it.h<150){ it.mount='floor'; it.z=0; return; }
    it.mount='pipe'; this.hangOn(it, ln, W);
    ln.x0=Math.min(ln.x0, Math.round(it.x+it.lx/2)); ln.x1=Math.max(ln.x1, Math.round(it.x+it.lx/2));
  }

  /** настенный шкаф не мешает проходу оператора: проход перед ним — не уже прохода обслуживания (ПУЭ, п. 4.1.23: у щитов —
   *  не менее 0,8 м в свету; сужение до 0,6 м — только строительными конструкциями). Места по порядку: на стене прохода у
   *  двери, где перед шкафом остаётся рекомендуемый проход (напротив промежутка между оборудованием или неглубокого); на торце
   *  у двери; на дальнем торце (не у ДГУ — там жалюзи радиатора); на стене прохода с проходом «не менее». Без прохода и при
   *  двух рядах, или места нет — null (своё место в ряду) */
  wallSpot(e, r, geo){
    if (r.service || r.rows!==1) return null;
    const [L, W, H]=geo.int, x0=geo.x0||0, w=e.l, d=e.w, z=Math.max(StationLayout.CAB_LOW, Math.min(StationLayout.CAB_TOP, H-150)-e.h);
    if (z+e.h>H-50) return null;
    const fl=r.items.filter(i=>i.mount!=='wall' && i.mount!=='pipe'), cabs=r.items.filter(i=>i.mount==='wall');
    const front=need=>{
      const busy=cabs.filter(i=>i.wall==='front').map(i=>[i.x-100, i.x+i.lx+100]);
      if (r.door==='side') busy.push([x0+StationLayout.ENTRY[0]-150, x0+StationLayout.ENTRY[1]+150]);
      const ok=x=>!busy.some(([a, b])=>x<b && x+w>a) && fl.every(i=>i.x>=x+w || i.x+i.lx<=x || i.y-d>=need);
      for (let x=x0+150; x+w<=L-150; x+=50) if (ok(x)) return this.unitItem(e, { x, y:0, z, mount:'wall', wall:'front', face:1 });
      return null; };
    // торец: шкаф вдоль торцевой стены в зоне прохода — перед ним (вдоль контейнера) проход «не менее» свободен
    const end=side=>{
      if (side==='left' && (r.door==='end' || x0>0)) return null;   // у морского — двери в торце, у «Севера» — тамбур
      if (side==='right' && fl.some(i=>i.kind==='dgu')) return null;
      const xa=side==='left' ? x0 : L-d, zone=[side==='left' ? x0 : L-d-this.aisle[1], side==='left' ? x0+d+this.aisle[1] : L];
      const taken=cabs.filter(i=>i.wall===side).map(i=>[i.y-100, i.y+i.ly+100]);
      for (let y=100; y+w<=W-100; y+=50){
        if (taken.some(([a, b])=>y<b && y+w>a)) continue;
        if (fl.some(i=>i.x<zone[1] && i.x+i.lx>zone[0] && i.y<y+w && i.y+i.ly>y)) continue;
        return this.unitItem(e, { x:xa, y, z, lx:d, ly:w, mount:'wall', wall:side, face:side==='left' ? 2 : -2 }); }
      return null; };
    return front(this.aisle[0]) || end('left') || end('right') || front(this.aisle[1]);
  }

  /** фильтр на трубопроводе — на своём участке по ходу воздуха (до осушителя или после — по ступени), по порядку ступеней;
   *  где под ним нет оборудования, сначала — где к нему подойти из прохода (колба и элемент снимаются вниз) */
  pipeSpot(e, r, geo, g, back){
    const ln=g && g.line; if (!ln || ln.z+Math.max(60, e.h*0.12)-e.h<150) return null;
    const d=Math.max(e.l, e.w), pad=StationLayout.PIPE_PAD, it=this.unitItem(e, { x:0, y:0, z:0, mount:'pipe', lx:d, ly:d }); this.hangOn(it, ln, geo.int[1]);
    const lo=Math.ceil(Math.max(g.a+80, g.next ?? -Infinity, ln.x0-d/2)/10)*10, hi=Math.floor((Math.min(g.b-80, g.lim ?? Infinity, ln.x1+d/2, geo.int[0]-100)-d)/10)*10;
    const open=x=>r.service || r.rows!==1 || !r.items.some(i=>i.mount==='floor' && i.x<x+d && i.x+i.lx>x && i.y<it.y);
    const free=(x, o)=>!ln.branches.some(b=>b.x>x-80 && b.x<x+d+80) && !r.items.some(i=>this.hit({ x, y:it.y, z:it.z, lx:d, ly:d, h:it.h }, i, pad)) && (!o || open(x));
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

  /** сервисные двери — напротив каждого агрегата в стене, к которой он обращён (ДГУ посередине — в обеих). Соседние проёмы
   *  делятся посередине промежутка — между ними стойка 100 мм; сливаются, только если проём вышел бы уже 600 мм (дверь
   *  оператора — не уже DOOR_MIN):
   *  [{wall:'front'|'back', x0, x1, w, leaves, h}] (мм внутри) */
  serviceDoors(items, geo){
    const [L, , H]=geo.int, D=StationLayout.DOOR, x0=geo.x0||0, iv={ front:[], back:[] };
    for (const it of items.filter(i=>i.mount==='floor' || i.mount==='frame')){ const w=Math.max(D.min, Math.min(D.max, Math.ceil((it.lx+200)/100)*100)), c=it.x+it.lx/2;
      const span=[Math.max(x0+D.pad, c-w/2), Math.min(L-D.pad, c+w/2), it.x, it.x+it.lx];
      if (it.face<=0) iv.front.push(span.slice()); if (it.face>=0) iv.back.push(span.slice()); }
    const out=[];
    for (const wall of ['front', 'back']){ const list=iv[wall].sort((a, b)=>a[0]-b[0]), got=[];
      for (const [a, b, u0, u1] of list){ const last=got[got.length-1];
        if (last && a<last.x1+100){ const m=(last.u1+u0)/2;
          if (m-50-last.x0>=StationLayout.DOOR_MIN && b-(m+50)>=StationLayout.DOOR_MIN){ last.x1=m-50; got.push({ wall, x0:m+50, x1:b, u1 }); continue; }
          last.x1=Math.max(last.x1, b); last.u1=Math.max(last.u1, u1); continue; }
        got.push({ wall, x0:a, x1:b, u1 }); }
      for (const d of got) delete d.u1;
      for (const d of got){ d.x0=Math.round(d.x0); d.x1=Math.round(d.x1); d.w=d.x1-d.x0; d.leaves=Math.max(1, Math.ceil(d.w/D.leaf)); d.h=Math.min(D.h, H-100); out.push(d); } }
    return out;
  }

  /** на крыше: глушитель ДГУ — прямо над ДГУ (по центру его длины и ширины), на опорах, вывод выхлопа вверх; выхлопная
   *  труба — от двигателя вертикально сквозь крышу в глушитель */
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
    return { id:e.id, pos:e.pos, unit:e.unit, name:e.name, brief:e.brief, short:e.short, kind:e.kind, shape:e.shape, look:e.look||'', color:e.color, colorKnown:e.colorKnown,
      known:e.known, mass:e.mass, kw:e.kw, x:geo.x0+it.x, y:it.y, z:0, lx:it.lx, ly:it.d, h:e.h, rot:!!it.o.rot, face:it.face, back:it.back, aisle:it.aisle,
      l:e.l, w:e.w, row:it.ri, mount:e.slot ? e.mount : 'floor', slot:!!e.slot, pipe:!!e.pipe, air:e.air||null };
  }
  /** шкаф на стене или фильтр на трубе — не из ряда */
  unitItem(e, o){
    return Object.assign({ id:e.id, pos:e.pos, unit:e.unit, name:e.name, brief:e.brief, short:e.short, kind:e.kind, shape:e.shape, look:e.look||'', color:e.color, colorKnown:e.colorKnown,
      known:e.known, mass:e.mass, kw:e.kw, lx:e.l, ly:e.w, h:e.h, rot:false, face:-1, back:0, aisle:0, l:e.l, w:e.w, row:-1, slot:false, pipe:!!e.pipe, air:e.air||null }, o);
  }
  used(items, geo){ const fl=items.filter(i=>i.mount!=='wall' && i.mount!=='pipe'), I=fl.length ? fl : items;
    const x0=Math.min(...I.map(i=>i.x)), x1=Math.max(...I.map(i=>i.x+i.lx)); return { x0, x1, free:Math.max(0, geo.int[0]-(x1-x0)-geo.x0) }; }

  /** длина ряда(ов) при ширине Wi, мм: row1 — один ряд, row2 — два ряда с проходом, rowsBack — два ряда без прохода;
   *  lvl 0 — с рекомендуемыми промежутками (без поворотов), 1 — с «не менее» (поперёк — что помещается по ширине);
   *  null — не проходит по ширине */
  need(units, Wi, arr, lvl){
    if (!units.length) return 0;
    const r=arr==='row1' ? this.row1(units, 0, Wi, !lvl) : arr==='row2' ? this.row2(units, 0, Wi) : this.rowsBack(units, 0, Wi);
    if (r.ok) return 0;
    if (!/^length/.test(r.why)) return null;
    return lvl ? r.needL : r.needL0;
  }

  /** блок-контейнер «по проекту» — по необходимому месту, без запаса (шаг 100 мм). Варианты по порядку: проход и все
   *  отступы рекомендуемые; проход и отступ от стены «не менее», промежутки рекомендуемые; всё «не менее»; без прохода
   *  (сервисные двери, промежутки «не менее») — в ширине, которую везут без спецразрешения; затем шире. В варианте — наименьшая площадь пола
   *  (длина × ширина); два ряда — только если заметно меньше одного (на четверть: один ряд удобнее в обслуживании и обвязке) */
  autoSize(units, geo, aisleOnly){
    const G=StationGeo, B=G.BLOCK, t=geo.t, f=G.flex(geo.type), n=StationLayout.n, x0=f.tambour||0, wallX=2*(t+f.wall), hOf=f.floor+t+f.roof;
    const floor=units.filter(e=>!e.pipe && e.mount!=='wall'), probe=floor.length ? floor : units.map(e=>Object.assign({}, e, { slot:true }));
    const needH=(lvl, walk)=>Math.max(walk ? B.hWalk : 0, ...units.filter(e=>!e.pipe).map(e=>e.mount==='wall' ? e.h+StationLayout.CAB_LOW+150 : e.h+(e.kind==='compressor' ? e.c.top[1] : e.c.top[lvl])));
    const tiers=[];
    // без прохода каждый агрегат обслуживается через свою дверь — промежутки между ними сразу «не менее»
    for (const wide of [false, true]) for (const [mode, lw, ll] of [['aisle', 0, 0], ['aisle', 1, 0], ['aisle', 1, 1], ['doors', 1, 1]]) if (!aisleOnly || mode==='aisle') tiers.push([mode, lw, ll, wide]);
    let tall=null;
    try{
      for (const [mode, lw, ll, wide] of tiers){
        this.mode=mode; this.allowDoors=false;
        const Hx=Math.max(B.minH, G.up(needH(lw, mode==='aisle')+hOf)); if (Hx>B.maxH){ tall=tall||Hx; continue; }
        const cand=[];
        for (let Wx=G.up(wide ? G.ROAD_W+1 : B.minW); Wx<=(wide ? B.maxW : G.ROAD_W); Wx+=G.STEP){
          const Wi=G.inner(geo.type, [10000, Wx, Hx], t)[1];
          for (const arr of mode==='aisle' ? ['row1', 'row2'] : ['row1', 'rowsBack']){
            const L=this.need(probe, Wi, arr, ll); if (L==null) continue;
            const Lx=Math.max(B.minL, G.up(L+x0+wallX)); if (Lx<=StationLayout.MAX_L) cand.push({ Lx, Wx, two:arr!=='row1', a:Lx*Wx/(arr==='row1' ? 1 : 0.75) });
          } }
        cand.sort((p, q)=>p.a-q.a || p.Lx-q.Lx);
        const seen=new Set();
        for (const c of cand){ if (seen.has(c.Lx+'×'+c.Wx)) continue; seen.add(c.Lx+'×'+c.Wx);
          for (let Lx=c.Lx; Lx<=Math.min(StationLayout.MAX_L, c.Lx+1500); Lx+=G.STEP){   // шкафам и фильтрам может понадобиться место в ряду
            const g2=Object.assign({}, geo, { auto:false, ext:[Lx, c.Wx, Hx] }); g2.int=G.inner(geo.type, g2.ext, t);
            const r=this.fit(units, g2); if (r.level==='error') continue;
            if (c.two && r.rows===1) break;                                          // вышел один ряд — его место среди однорядных
            const w=r.issues.filter(i=>i.level==='warn').map(i=>i.text);
            if (lw===0 && w.some(x=>/^Проход|стоит в/.test(x))) break;              // рекомендуемый проход не вышел — другая ширина
            if (ll===0 && w.some(x=>/^Промежутки|^Отступы/.test(x))) continue;      // промежутки — длиннее (место шкафу или фильтру в ряду)
            r.geo=g2; r.picked=true;
            if (wide) r.issues.push({ level:'info', text:`Ширина ${n(c.Wx)} мм — при перевозке негабарит (без разрешения — до ${n(G.ROAD_W)} мм).` });
            return r;
          } }
      }
    } finally { this.mode='aisle'; this.allowDoors=true; }
    const Wi=G.inner(geo.type, [10000, B.maxW, B.maxH], t)[1]; this.mode='aisle';
    const wideOk=this.need(probe, Wi, 'row1', 1)!=null;
    const text=tall && !wideOk ? `Оборудование не помещается в блок-контейнер высотой до ${n(B.maxH)} мм — нужен контейнер нестандартной высоты (укажите размер вручную).`
      : !wideOk ? `Оборудование не проходит по ширине даже в блок-контейнере шириной ${n(B.maxW)} мм.`
      : `Оборудование не помещается в один блок-контейнер длиной до ${n(StationLayout.MAX_L)} мм — разделите станцию на два модуля или уменьшите состав.`;
    return { level:'error', geo, ext:null, int:null, issues:[{ level:'error', text }] };
  }

  /** контейнер, в который всё поместится: морской — следующий по размеру, иначе блок-контейнер с подобранным размером;
   *  aisleOnly — с проходом обслуживания внутри (сейчас — только сервисные двери) */
  suggest(units, geo, aisleOnly){
    const keep=this.allowDoors; if (aisleOnly) this.allowDoors=false;
    try{
      if (geo.sea && !geo.own){
        let warnFit=null; const cur=StationGeo.SEA[geo.type];
        for (const t of StationGeo.SEA_ORDER){ const s=StationGeo.SEA[t]; if (t===geo.type || (s.ext[0]<=cur.ext[0] && s.ext[2]<=cur.ext[2])) continue;   // не больше — не поможет
          const r=this.fit(units, StationGeo.of({ ctype:t, ins:geo.t+' мм' })); if (aisleOnly && r.door==='service') continue;
          if (r.level==='ok') return { ctype:t, level:'ok', aisle:!!aisleOnly }; if (r.level==='warn' && !warnFit) warnFit={ ctype:t, level:'warn', aisle:!!aisleOnly }; }
        if (warnFit) return warnFit;
      }
      const type=StationGeo.FLEX[geo.type] ? geo.type : 'block', r=this.autoSize(units, StationGeo.of({ ctype:type, ins:geo.t+' мм', sizeAuto:true }), aisleOnly);
      return r.level==='error' ? null : { ctype:type, size:r.geo.ext, level:r.level, aisle:!!aisleOnly };
    } finally { this.allowDoors=keep; }
  }

  /** контейнер с большим запасом: морской — меньший морской, в который всё помещается не хуже; блок-контейнер со своим
   *  размером — размер по оборудованию. Подсказка и кнопка «заменить» */
  excess(units, geo, plan){
    const n=StationLayout.n, rank={ ok:0, warn:1 }, lv=plan.issues.some(i=>i.level==='warn') ? 1 : 0;
    if (geo.sea && !geo.own){
      const cur=StationGeo.SEA[geo.type];
      for (const t of StationGeo.SEA_ORDER){ const s=StationGeo.SEA[t];
        if (t===geo.type || s.ext[0]>cur.ext[0] || s.ext[2]>cur.ext[2] || (s.ext[0]===cur.ext[0] && s.ext[2]===cur.ext[2])) continue;
        const r=this.fit(units, StationGeo.of({ ctype:t, ins:geo.t+' мм' }));
        if (r.level==='error' || r.door==='service' || rank[r.level]>lv) continue;
        plan.suggest={ ctype:t, level:r.level, smaller:true };
        plan.issues.push({ level:'warn', big:true, text:`Контейнер с запасом: всё помещается в морской контейнер ${s.label} — меньше по размеру, массе и цене.` });
        return; }
    } else if (geo.own && StationGeo.FLEX[geo.type]){
      const r=this.autoSize(units, StationGeo.of({ ctype:geo.type, ins:geo.t+' мм', sizeAuto:true }));
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
    const rf=plan.roof||[]; if (rf.length && plan.geo && plan.geo.ext){
      const top=Math.max(...rf.map(m=>m.gap+m.d+m.outlet)), h=plan.geo.ext[2]+top, ch=plan.chassis ? 1150 : 0;
      iss.push({ level:'info', text:`Глушитель на крыше над ДГУ: высота станции с глушителем ${n(h)} мм${ch ? ` (на шасси — ${n(h+ch)} мм)` : ''}. При перевозке глушитель снимают и ставят на объекте: высота с платформой — не более ${n(StationLayout.ROAD_H)} мм.` });
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
