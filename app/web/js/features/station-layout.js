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
    sea20:   { ext:[6058, 2438, 2591],  int:[5898, 2352, 2393],  door:[2340, 2280] },
    sea20hc: { ext:[6058, 2438, 2896],  int:[5898, 2352, 2698],  door:[2340, 2585] },
    sea40:   { ext:[12192, 2438, 2591], int:[12032, 2352, 2393], door:[2340, 2280] },
    sea40hc: { ext:[12192, 2438, 2896], int:[12032, 2352, 2698], door:[2340, 2585] },
  };
  static SEA_ORDER = ['sea20', 'sea20hc', 'sea40', 'sea40hc'];
  static LINING = 15;        // обшивка морского контейнера поверх утеплителя, мм
  static SEA_FLOOR = 50;     // утеплённый пол поверх штатного, мм
  // блок-контейнеры «по проекту»: к утеплителю стены — обшивка и каркас, пол и кровля — строительная высота, мм;
  // «Север» — с тамбуром у двери (перегородка с дверью: в тамбуре оборудование не ставится)
  static FLEX = { block:{ wall:20, floor:150, roof:60 }, welded:{ wall:10, floor:160, roof:60 }, north:{ wall:20, floor:200, roof:80, tambour:1200 } };
  // ряд наружных размеров блок-контейнера, мм: длина — шаг 500 мм до 12 м (длиннее — два модуля), ширина 2400 и 2500
  // (без спецразрешения на перевозку — до 2550 мм, ПП РФ от 21.12.2020 № 2200) и 3000, высота 2500, 2800, 3000
  static SERIES = { L:[3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000, 10500, 11000, 11500, 12000],
    W:[2400, 2500, 3000], H:[2500, 2800, 3000] };
  static ROAD_W = 2550;      // шире — негабарит при перевозке

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
  /** длина блок-контейнера из ряда (null — длиннее 12 м) */
  static seriesL(L){ return this.SERIES.L.find(v=>v>=L) || null; }
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
// • магистральные фильтры и сепараторы — на трубопроводе у задней стены, в промежутках между оборудованием;
// • шкафы управления: спереди — проход обслуживания (ПУЭ, п. 4.1.23), сзади и сбоку можно вплотную.
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
    return { dryer:[900, 600, 1100], filter:[300, 300, 900], pump:[800, 500, 700], cabinet:[800, 400, 1800] }[kind] || [800, 600, 1000];
  }
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
      const k=kind||'other', c=this.color(p, k);
      return { id:p.id, pos:++pos, name, brief:this.brief(p, k, name), short:this.short(p, k), kind:k, qty, l:d.l, w:d.w, h:d.h, known:d.known, src:d.src, mass:this.mass(p), kw:this.num((p.attrs||{}).kw),
        color:c.hex, colorKnown:c.known, colorText:c.text, shape:this.shape(p, k, d), place:true, pipe:k==='filter' && Math.max(d.l, d.w)<=700 };
    });
    const dgu=out.find(e=>e.kind==='dgu');
    for (const e of out) if (e.kind==='muffler' && !e.known){ const g=this.guessMuffler(dgu ? dgu.kw : null); e.l=g[0]; e.w=g[1]; e.h=g[2]; }
    return out;
  }
}

// ---------------------------------------------------------------- расстановка
// Оборудование стоит рядами вдоль длинных стен, лицевой стороной к проходу обслуживания: один ряд у задней стены
// (проход — вдоль стены с дверью) или, если не хватает длины и позволяет ширина, два ряда с проходом посередине.
// Шкафы — у двери, ДГУ — в дальнем торце радиатором к жалюзи, дополнительный топливный бак — рядом с ДГУ, фильтры —
// на трубопроводе в промежутках у задней стены. Прохода внутри не получается (не хватает ширины) — оборудование стоит
// лицом к стене с сервисными дверями и обслуживается снаружи. Глушитель ДГУ — на крыше, трубопровод — вдоль задней стены.
// Отступы: сначала «не менее» (помещается ли), затем свободное место раздаётся до рекомендуемых; остаток длины — у
// двери (после шкафов). Не хватает длины — оборудование поворачивается поперёк, если позволяет ширина. Блок-контейнер
// без своего размера получает наименьший размер из ряда (сначала ширина, которую везут без спецразрешения); заданный
// контейнер, в который не помещается, — ошибка и подсказка, какой подойдёт.
class StationLayout {
  static VER = 2;           // версия правил и рисунков: изменилась — картинки станций в КП пересобираются
  static MAX_L = 12000;
  static PIPE_PAD = 60;      // зазор вокруг фильтра на трубопроводе, мм
  static PIPE_WALL = 100;    // фильтр — на трубопроводе в 100 мм от задней стены
  static DOOR_GAP = [300, 100];   // обслуживание снаружи: от оборудования до сервисной двери [рекомендуется, не менее], мм
  // сервисные двери: проём шире оборудования на 200 мм (от 800 до 2400), створка до 1200, высота 2000, от углов — 100
  static DOOR = { min:800, max:2400, leaf:1200, h:2000, pad:100 };
  static ROOF_GAP = 200;     // глушитель на опорах над крышей, мм
  static OUTLET = 500;       // вывод выхлопа над глушителем (с дождевым колпаком), мм
  static ROAD_H = 4000;      // наибольшая высота при перевозке (с платформой), мм

  static solve(input){ return new StationLayout(input).run(); }

  /** отпечаток всего, от чего зависит компоновка: изменился — чертёж и 3D-вид пора обновить */
  static hash(input){
    const c=input.cont||{}, pick=a=>a ? {cat:a.cat, size:a.size, mass:a.mass, model:a.model, maker:a.maker, orient:a.orient, kw:a.kw, volume:a.volume, color:a.color} : null;
    const s=JSON.stringify([this.VER, StationClear.aisle(), [c.ctype, c.size, c.sizeAuto, c.ins, c.ral, c.sys||null], input.chassisH||null,
      (input.parts||[]).filter(p=>p && p.role!=='container').map(p=>[p.name, p.qty, p.role||'', p.pipeMat||'', p.dn||'', pick(p.attrs), (p.rows||[]).filter(r=>r && /габарит|размер|масса|вес|цвет|окраск|покрыт|длина|ширина|высота|объ[её]м|RAL/i.test(String(r.k||'')+' '+String(r.v||''))).map(r=>[r.k, r.v])])]);
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
    if (plan.level!=='error' && plan.items && plan.items.length){ plan.roof=this.roof(plan); plan.piping=this.route(plan); }
    // «не помещается» точно, если не помещается и без оборудования с условными габаритами; иначе — лишь оценка (assumed)
    if (plan.level==='error' && units.some(e=>!e.known)){ const k=units.filter(e=>e.known);
      plan.assumed=!k.length || (geo.auto ? this.autoSize(k, geo) : this.fit(k, geo)).level!=='error'; }
    plan=Object.assign(base, plan, { issues:plan.issues||[] }, this.colors());
    this.notes(plan);
    if (plan.level==='ok' && plan.issues.some(i=>i.level==='warn')) plan.level='warn';
    return plan;
  }

  /** единицы оборудования в порядке расстановки от двери: шкафы, остальное по составу, топливный бак, ДГУ — в дальнем торце */
  units(placed){
    const u=[]; for (const e of placed) for (let k=0; k<e.qty; k++) u.push(Object.assign({}, e, { unit:k, c:StationClear.of(e.kind, e) }));
    const dgu=placed.some(e=>e.kind==='dgu'), rank=e=>e.kind==='cabinet' ? 0 : e.kind==='dgu' ? 2 : e.kind==='tank' && dgu ? 1.5 : 1;
    return u.map((e, i)=>[e, i]).sort((a, b)=>rank(a[0])-rank(b[0]) || a[1]-b[1]).map(([e])=>e);
  }

  /** перед оборудованием [рекомендуется, не менее]: проход обслуживания (вдоль ДГУ «не менее» — своё) или, при обслуживании
   *  снаружи, зазор до сервисной двери */
  front(e){
    if (this.mode==='doors') return StationLayout.DOOR_GAP;
    return [this.aisle[0], e.c.front!=null ? Math.min(this.aisle[1], e.c.front) : this.aisle[1]];
  }

  // ---- высота: оборудование + место над ним
  heights(units, H){
    const iss=[], n=StationLayout.n; let bad=false;
    for (const e of units){ if (e.unit) continue;
      const top=e.c.top, room=H-e.h;
      if (room<top[1]){ bad=true; iss.push({ level:'error', text:`Поз. ${e.pos} «${e.short}» не проходит по высоте: ${n(e.h)} мм и не менее ${n(top[1])} мм над ним, а высота внутри — ${n(H)} мм.` }); }
      else if (room<top[0]){
        if (e.kind==='compressor') iss.push({ level:'info', text:`Над компрессором (поз. ${e.pos}) ${n(room)} мм до потолка — горячий воздух отводится воздуховодом (в помещении рекомендуется 1 м).` });
        else iss.push({ level:'warn', text:`Над поз. ${e.pos} «${e.short}» ${n(room)} мм до потолка — рекомендуется ${n(top[0])} мм.` }); }
    }
    return { bad, iss };
  }

  // ---- один ряд у задней стены, проход — вдоль стены с дверью
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
    if (len(1)>Lu) return { ok:false, why:'length', needL:len(1) };
    return this.place([U], Lu, W, depth, lenX);
  }

  // ---- два ряда у длинных стен, проход посередине
  row2(units, Lu, W){
    const A=[], B=[], lenOf=R=>this.chain(R.map(o=>o.e), 1).sum+R.reduce((s, o)=>s+o.e.l, 0);
    for (const e of units){ const o={ e, rot:false }; if (e.kind==='dgu') B.push(o); else (lenOf(A)<=lenOf(B) ? A : B).push(o); }
    if (!A.length || !B.length) return { ok:false, why:'rows' };
    const dmax=R=>Math.max(...R.map(o=>o.e.w+o.e.c.back[1])), aMin=Math.max(...[...A, ...B].map(o=>this.front(o.e)[1]));
    if (W-dmax(A)-dmax(B)<aMin) return { ok:false, why:'width2' };
    const L1=Math.max(lenOf(A), lenOf(B)); if (L1>Lu) return { ok:false, why:'length2', needL:L1 };
    return this.place([B, A], Lu, W, o=>o.e.w, o=>o.e.l);
  }

  /** промежутки по длине ряда: у двери, между соседними, в дальнем торце (lvl 0 — рекомендуемые, 1 — не менее) */
  chain(E, lvl){
    const g=[]; if (!E.length) return { gaps:g, sum:0 };
    g.push(E[0].c.side[lvl]);
    for (let i=1; i<E.length; i++) g.push(Math.max(E[i-1].c.side[lvl], E[i].c.side[lvl]));
    const last=E[E.length-1]; g.push(last.c.far ? last.c.far[lvl] : last.c.side[lvl]);
    return { gaps:g, sum:g.reduce((s, v)=>s+v, 0) };
  }

  /** места в рядах: R[0] — у задней стены (лицом к проходу), R[1] — у стены с дверью; отступы — от «не менее» к рекомендуемым */
  place(R, Lu, W, depth, lenX){
    const n=StationLayout.n, aRec=this.aisle[0], items=[], iss=[], rows=R.filter(r=>r.length).length;
    let gapsShort=false, minGap=Infinity;
    R.forEach((row, ri)=>{ if (!row.length) return;
      const E=row.map(o=>o.e), rec=this.chain(E, 0), mn=this.chain(E, 1), body=row.reduce((s, o)=>s+lenX(o), 0);
      const k=rec.sum>mn.sum ? Math.max(0, Math.min(1, (Lu-body-mn.sum)/(rec.sum-mn.sum))) : 1;
      const gaps=mn.gaps.map((v, i)=>Math.round(v+(rec.gaps[i]-v)*k)), free=Lu-body-gaps.reduce((s, v)=>s+v, 0);
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
      for (const it of items){ const b=back(it), budget=W-it.d, fr=this.front(it.o.e), f=Math.max(fr[1], Math.min(fr[0], budget-b[1]));
        it.back=budget-f; it.aisle=f; it.y=f; it.face=-1; }
    } else if (rows===1){
      for (const it of items){ const b=back(it), budget=W-it.d, fr=this.front(it.o.e)[0];
        it.back = budget-b[0]>=fr ? b[0] : budget-fr>=b[1] ? budget-fr : b[1];
        it.aisle=budget-it.back; it.y=W-it.back-it.d; it.face=-1; }
    } else {
      const A=items.filter(i=>i.ri===1), B=items.filter(i=>i.ri===0), dm=(S, f)=>S.length ? Math.max(...S.map(f)) : 0;
      const recOk=W-dm(A, i=>i.d+back(i)[0])-dm(B, i=>i.d+back(i)[0])>=aRec;
      for (const it of items) it.back=recOk ? back(it)[0] : back(it)[1];
      const free=W-dm(A, i=>i.d+i.back)-dm(B, i=>i.d+i.back);
      for (const it of B){ it.y=W-it.back-it.d; it.face=-1; it.aisle=free; }
      for (const it of A){ it.y=it.back; it.face=1; it.aisle=free; }
    }
    const aisleW=Math.min(...items.map(i=>i.aisle)), dgu=items.find(i=>i.o.e.kind==='dgu'), other=items.filter(i=>i.o.e.kind!=='dgu');
    const aisleO=this.mode==='doors' ? Infinity : other.length ? Math.min(...other.map(i=>i.aisle)) : Infinity;
    if (aisleO<aRec) iss.push({ level:'warn', text:`Проход обслуживания ${n(aisleO)} мм — меньше рекомендуемых ${n(aRec)} мм (допустимо от ${n(this.aisle[1])} мм).` });
    if (dgu && dgu.aisle<aRec && this.mode!=='doors') iss.push({ level:'warn', text:`Проход вдоль ДГУ ${n(dgu.aisle)} мм — меньше рекомендуемых ${n(aRec)} мм (допустимо от ${n(this.front(dgu.o.e)[1])} мм).` });
    if (gapsShort && Number.isFinite(minGap)) iss.push({ level:'warn', text:`Промежутки между оборудованием уменьшены до ${n(minGap)} мм — по длине не хватает места для рекомендуемых.` });
    else if (gapsShort) iss.push({ level:'warn', text:'Отступы от торцов уменьшены — по длине не хватает места для рекомендуемых.' });
    for (const it of items) if (it.back<back(it)[0] && back(it)[0]>150 && !it.o.e.unit) iss.push({ level:'warn', text:`Поз. ${it.o.e.pos} «${it.o.e.short}» стоит в ${n(it.back)} мм от стены — рекомендуется ${n(back(it)[0])} мм.` });
    return { ok:true, rows, aisleW, items, iss };
  }

  /** заданный контейнер: фильтры — в промежутки у задней стены; не нашлось места — ставятся в ряд */
  fit(units, geo){
    const pipes=units.filter(e=>e.pipe), floor=units.filter(e=>!e.pipe);
    let r=this.fitRow(floor, geo, units);
    if (r.level==='error' || !pipes.length) return r;
    const left=this.pipes(r, pipes, geo);
    if (!left.length) return r;
    const ids=new Set(left);
    const r2=this.fitRow(units.filter(e=>!e.pipe || ids.has(e)).map(e=>ids.has(e) ? Object.assign({}, e, { pipe:false }) : e), geo, units);
    if (r2.level!=='error') this.pipes(r2, pipes.filter(e=>!ids.has(e)), geo);
    return r2;
  }

  /** ряды в заданном контейнере: высота, затем один ряд, при нехватке — два ряда */
  fitRow(units, geo, all){
    const [L, W, H]=geo.int, Lu=L-geo.x0, hh=this.heights(all, H), n=StationLayout.n;
    const doorsOnly=this.mode==='doors';
    let r=this.row1(units, Lu, W);
    if (!doorsOnly && (!r.ok || r.iss.some(i=>i.level==='warn'))){ const r2=this.row2(units, Lu, W); if (r2.ok && (!r.ok || !r2.iss.some(i=>i.level==='warn'))) r=r2; }
    let need=null;
    if (doorsOnly && r.ok) r.doors=true;
    else if (!doorsOnly && !r.ok && r.why==='width' && this.allowDoors){   // прохода не получается — обслуживание снаружи
      need=r.needW; this.mode='doors'; const rd=this.row1(units, Lu, W); this.mode='aisle';
      if (rd.ok){ rd.doors=true; r=rd; } else if (rd.why==='length') r=rd; }
    const res={ geo, ext:geo.ext, int:geo.int };
    if (!r.ok){
      const iss=[...hh.iss];
      if (r.why==='width') iss.unshift({ level:'error', text:`Не проходит по ширине: ${r.bad.filter(e=>!e.unit).slice(0, 3).map(e=>`поз. ${e.pos} «${e.short}» (${n(e.w)} мм)`).join(', ')} — вместе с проходом обслуживания и отступом от стены нужно ${n(r.needW)} мм, а ширина внутри — ${n(W)} мм.` });
      else iss.unshift({ level:'error', text:`Не помещается по длине: нужно ${n(r.needL)} мм, а внутри контейнера ${n(Lu)} мм — не хватает ${n(r.needL-Lu)} мм.` });
      return Object.assign(res, { level:'error', issues:iss, need:{ L:r.needL||null, W:r.needW||null } });
    }
    const items=r.items.map(it=>this.item(it, geo)), iss=[...hh.iss, ...r.iss];
    let doors=null;
    if (r.doors){ doors=this.serviceDoors(items, geo);
      iss.unshift({ level:'warn', text:`Прохода обслуживания внутри нет${need ? ` — по ширине нужно ${n(need)} мм, внутри ${n(W)} мм` : ''}: оборудование обслуживается снаружи через сервисные двери в боковой стене (${doors.length} ${StationLayout.plural(doors.length, 'проём', 'проёма', 'проёмов')}). У дверей на площадке — свободная зона не менее 1,5 м.` }); }
    const level=hh.bad ? 'error' : iss.some(i=>i.level==='warn') ? 'warn' : 'ok';
    return Object.assign(res, { level, items, rows:r.rows, door:r.doors ? 'service' : r.rows===2 || geo.sea ? 'end' : 'side', doors, aisle:{ w:r.doors ? 0 : r.aisleW, rows:r.rows, service:!!r.doors },
      issues:iss, used:this.used(items, geo) });
  }

  /** сервисные двери в стене прохода — напротив оборудования; соседние проёмы сливаются: [{x0, x1, w, leaves, h}] (мм внутри) */
  serviceDoors(items, geo){
    const [L, , H]=geo.int, D=StationLayout.DOOR, x0=geo.x0||0, iv=[];
    for (const it of items.filter(i=>!i.pipe)){ const w=Math.max(D.min, Math.min(D.max, Math.ceil((it.lx+200)/100)*100)), c=it.x+it.lx/2;
      iv.push([Math.max(x0+D.pad, c-w/2), Math.min(L-D.pad, c+w/2)]); }
    iv.sort((a, b)=>a[0]-b[0]);
    const out=[];
    for (const [a, b] of iv){ const last=out[out.length-1]; if (last && a<=last.x1+200) last.x1=Math.max(last.x1, b); else out.push({ x0:a, x1:b }); }
    for (const d of out){ d.x0=Math.round(d.x0); d.x1=Math.round(d.x1); d.w=d.x1-d.x0; d.leaves=Math.max(1, Math.ceil(d.w/D.leaf)); d.h=Math.min(D.h, H-100); }
    return out;
  }

  /** на крыше: глушитель ДГУ — вдоль контейнера над ДГУ, на опорах, вывод выхлопа вверх; выхлопная труба — от ДГУ сквозь крышу */
  roof(plan){
    const ms=this.eq.filter(e=>e.kind==='muffler' && e.roof); if (!ms.length) return [];
    const [L, W]=plan.int, ow=plan.geo && plan.geo.ext ? (plan.geo.ext[1]-W)/2 : 100, dg=plan.items.filter(i=>i.kind==='dgu').sort((a, b)=>a.x-b.x), out=[];
    let k=0, next=Math.max(100, L/2-ms[0].l/2);
    for (const m of ms) for (let u=0; u<m.qty; u++, k++){
      const d=m.w, l=Math.min(m.l, L-200), g=dg[k], cx=g ? g.x+g.lx*0.62 : next+l/2;   // выхлоп — над двигателем ДГУ
      // над задней стеной (опоры — на стене), второй — над стеной прохода
      const x=Math.round(Math.max(100, Math.min(L-100-l, cx-l/2))), y=Math.round(k%2 ? -ow/2-d/2 : W+ow/2-d/2);
      out.push({ pos:m.pos, unit:u, name:m.name, brief:m.brief, short:m.short, kind:'muffler', x, y, lx:l, ly:d, h:d, d, known:m.known, mass:m.mass, color:m.color,
        gap:StationLayout.ROOF_GAP, outlet:StationLayout.OUTLET, exhaust:g ? { x:Math.round(cx), y:Math.round(g.y+g.ly/2), z:g.h } : null });
      next=x+l+300; }
    return out;
  }

  /** трубопровод вдоль задней стены: магистраль с отводами к оборудованию и выходом через дальний торец (насосы — всас и
   *  напор, компрессоры — сжатый воздух через осушители, фильтры и ресиверы, ДГУ — топливо от бака) */
  route(plan){
    const ps=this.eq.filter(e=>e.kind==='piping'); if (!ps.length) return [];
    const [L, W, H]=plan.int, floor=plan.items.filter(i=>!i.pipe), pf=plan.items.filter(i=>i.pipe), has=k=>floor.some(i=>i.kind===k);
    const cx=i=>Math.round(i.x+i.lx/2), zTop=Math.max(600, Math.min(H-400, 1500)), lines=[];
    const line=(conn, y, z, label, toEnd)=>{ if (!conn.length) return;
      const xs=conn.map(cx), x0=Math.min(...xs), x1=toEnd ? L : Math.max(...xs);
      lines.push({ x0, x1, y:Math.round(y), z:Math.round(z), label, branches:conn.filter(i=>i.y+i.ly<y-20).map(i=>({ x:cx(i), y0:Math.round(y), y1:Math.round(i.y+i.ly) })) }); };
    if (has('pump')){ const P=floor.filter(i=>i.kind==='pump'); line(P, W-110, 450, 'вход', true); line(P, W-240, Math.min(zTop, 1300), 'выход', true); }
    else if (has('compressor')){ const yf=pf.length ? pf[0].y+pf[0].ly/2 : W-150;
      line(floor.filter(i=>/compressor|dryer|receiver|filter|other/.test(i.kind)), yf, zTop, 'выход', true); }
    else if (has('dgu')){ if (has('tank')) line(floor.filter(i=>i.kind==='tank' || i.kind==='dgu'), W-120, 300, '', false); }
    else line(floor.filter(i=>i.kind!=='cabinet'), W-150, Math.min(zTop, 1200), 'выход', true);
    return ps.map(p=>{ const m=PipeMaterial.get(p.mat);
      return { pos:p.pos, name:p.name, brief:p.brief, kind:'piping', qty:p.qty, mat:p.mat, matText:m ? m.name.toLowerCase() : '', color:m ? m.color : PipeMaterial.get('steel').color, dn:p.dn, lines }; });
  }

  /** фильтры на трубопроводе: в промежутки у задней стены (сначала рядом с осушителем и ресивером); возвращает не поместившиеся */
  pipes(r, P, geo){
    const [L, W]=geo.int, pad=StationLayout.PIPE_PAD, wall=r.items.filter(i=>i.row===0).sort((a, b)=>a.x-b.x), segs=[];
    let x=geo.x0;
    wall.forEach((it, k)=>{ segs.push({ x0:x, x1:it.x, near:[wall[k-1], it] }); x=it.x+it.lx; });
    segs.push({ x0:x, x1:L, near:[wall[wall.length-1]] });
    for (const s of segs){ s.free=s.x1-s.x0; s.list=[]; s.pref=s.near.some(i=>i && /dryer|receiver/.test(i.kind)) ? 1 : 0; }
    const left=[];
    for (const e of P){ const d=Math.max(e.l, e.w), need=d+pad;
      const s=segs.filter(z=>z.free>=need+pad*(z.list.length ? 0 : 1)).sort((a, b)=>b.pref-a.pref || b.free-a.free)[0];
      if (!s){ left.push(e); continue; }
      s.list.push(e); s.free-=need+(s.list.length===1 ? pad : 0); }
    for (const s of segs){ if (!s.list.length) continue;
      const w=s.list.reduce((t, e)=>t+Math.max(e.l, e.w), 0)+pad*(s.list.length-1); let cx=s.x0+((s.x1-s.x0)-w)/2;
      for (const e of s.list){ const d=Math.max(e.l, e.w);
        r.items.push({ id:e.id, pos:e.pos, unit:e.unit, name:e.name, brief:e.brief, short:e.short, kind:e.kind, shape:e.shape, color:e.color, colorKnown:e.colorKnown,
          known:e.known, mass:e.mass, x:Math.round(cx), y:W-StationLayout.PIPE_WALL-d, lx:d, ly:d, h:e.h, rot:false, face:-1, back:StationLayout.PIPE_WALL,
          aisle:W-StationLayout.PIPE_WALL-d, l:e.l, w:e.w, row:0, pipe:true });
        cx+=d+pad; } }
    if (r.items.length) r.used=this.used(r.items, geo);
    return left;
  }

  item(it, geo){
    const e=it.o.e;
    return { id:e.id, pos:e.pos, unit:e.unit, name:e.name, brief:e.brief, short:e.short, kind:e.kind, shape:e.shape, color:e.color, colorKnown:e.colorKnown,
      known:e.known, mass:e.mass, x:geo.x0+it.x, y:it.y, lx:it.lx, ly:it.d, h:e.h, rot:!!it.o.rot, face:it.face, back:it.back, aisle:it.aisle,
      l:e.l, w:e.w, row:it.ri };
  }
  used(items, geo){ const x0=Math.min(...items.map(i=>i.x)), x1=Math.max(...items.map(i=>i.x+i.lx)); return { x0, x1, free:Math.max(0, geo.int[0]-(x1-x0)-geo.x0) }; }

  /** блок-контейнер «по проекту»: наименьший размер из ряда — ширина без спецразрешения на перевозку, затем шире;
   *  сначала с рекомендуемыми отступами, затем с «не менее» */
  autoSize(units, geo){
    const S=StationGeo.SERIES, t=geo.t, f=StationGeo.flex(geo.type), n=StationLayout.n, inH=Hx=>StationGeo.inner(geo.type, [10000, 2400, Hx], t)[2];
    const needH=lvl=>Math.max(...units.map(e=>e.h+(e.kind==='compressor' ? e.c.top[1] : e.c.top[lvl])));
    const Hx=S.H.find(h=>inH(h)>=needH(0)) || S.H.find(h=>inH(h)>=needH(1));
    if (!Hx){ const top=Math.max(...units.map(e=>e.h)); return { level:'error', geo, ext:null, int:null,
      issues:[{ level:'error', text:`Оборудование высотой ${n(top)} мм не помещается в блок-контейнер высотой до ${n(S.H[S.H.length-1])} мм — нужен контейнер нестандартной высоты (укажите размер вручную).` }] }; }
    const floor=units.filter(e=>!e.pipe), road=S.W.filter(w=>w<=StationGeo.ROAD_W), wide=S.W.filter(w=>w>StationGeo.ROAD_W);
    // ширина без спецразрешения: проход с рекомендуемыми, с «не менее», без прохода (сервисные двери); затем шире
    const tries=[...road.map(w=>[w, 0, 'aisle']), ...road.map(w=>[w, 1, 'aisle']), ...road.map(w=>[w, 1, 'doors']),
      ...wide.map(w=>[w, 0, 'aisle']), ...wide.map(w=>[w, 1, 'aisle']), ...wide.map(w=>[w, 1, 'doors'])];
    try{ for (const [Wx, lvl, mode] of tries){
      this.mode=mode; this.allowDoors=false;
      const Wi=StationGeo.inner(geo.type, [10000, Wx, Hx], t)[1], probe=this.row1(floor, 1e6, Wi, true);
      if (!probe.ok) continue;
      if (lvl===0 && probe.iss.some(i=>i.level==='warn' && !/^Промежутки|^Отступы/.test(i.text))) continue;
      const L0=this.chain(floor, lvl).sum+floor.reduce((s, e)=>s+e.l, 0)+(f.tambour||0)+2*(t+f.wall);
      for (const Lx of S.L.filter(v=>v>=L0)){
        const g2=Object.assign({}, geo, { auto:false, ext:[Lx, Wx, Hx] }); g2.int=StationGeo.inner(geo.type, g2.ext, t);
        const r=this.fit(units, g2); if (r.level==='error') continue;
        r.geo=g2; r.picked=true;
        if (Wx>StationGeo.ROAD_W) r.issues.push({ level:'info', text:`Ширина ${n(Wx)} мм — при перевозке негабарит (без разрешения — до ${n(StationGeo.ROAD_W)} мм).` });
        return r;
      }
    } } finally { this.mode='aisle'; this.allowDoors=true; }
    const Wi=StationGeo.inner(geo.type, [10000, S.W[S.W.length-1], Hx], t)[1], probe=this.row1(floor, 1e6, Wi, true);
    const text=!probe.ok ? `Оборудование не проходит по ширине даже в блок-контейнере шириной ${n(S.W[S.W.length-1])} мм.`
      : `Оборудование не помещается в один блок-контейнер длиной до ${n(StationLayout.MAX_L)} мм — разделите станцию на два модуля или уменьшите состав.`;
    return { level:'error', geo, ext:null, int:null, issues:[{ level:'error', text }] };
  }

  /** контейнер, в который всё поместится: морской — следующий по размеру, иначе блок-контейнер с подобранным размером */
  suggest(units, geo){
    if (geo.sea && !geo.own){
      let warnFit=null;
      for (const t of StationGeo.SEA_ORDER){ if (t===geo.type) continue;
        const g=StationGeo.of({ ctype:t, ins:geo.t+' мм' }), r=this.fit(units, g);
        if (r.level==='ok') return { ctype:t, level:'ok' }; if (r.level==='warn' && !warnFit) warnFit={ ctype:t, level:'warn' }; }
      if (warnFit) return warnFit;
    }
    const type=StationGeo.FLEX[geo.type] ? geo.type : 'block', r=this.autoSize(units, StationGeo.of({ ctype:type, ins:geo.t+' мм', sizeAuto:true }));
    return r.level==='error' ? null : { ctype:type, size:r.geo.ext, level:r.level };
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
      iss.push({ level:'info', text:`Глушитель на крыше: высота станции с глушителем ${n(h)} мм${ch ? ` (на шасси — ${n(h+ch)} мм)` : ''}. При перевозке глушитель снимают и ставят на объекте: высота с платформой — не более ${n(StationLayout.ROAD_H)} мм.` });
      if (rf.some(m=>!m.known)) iss.push({ level:'info', text:`Размер глушителя не указан — взят условный по мощности ДГУ: ${rf.filter(m=>!m.known).map(m=>`поз. ${m.pos} — ${n(m.lx)} × Ø${n(m.d)} мм`).join('; ')}.` }); }
    for (const pp of plan.piping||[]){
      if (!pp.mat) iss.push({ level:'info', text:`Материал трубопровода (поз. ${pp.pos}) не выбран — на чертеже сталь. Выберите в «Составе станции»: сталь, нержавеющая сталь или полипропилен.` });
      else if (pp.mat==='pp' && this.eq.some(e=>e.kind==='dgu')) iss.push({ level:'warn', text:`Топливопровод (поз. ${pp.pos}) из полипропилена не применяют — выберите сталь или нержавеющую сталь.` });
      else if (pp.mat==='pp' && this.eq.some(e=>e.kind==='compressor')) iss.push({ level:'info', text:`Полипропилен для сжатого воздуха (поз. ${pp.pos}) — только в пределах давления труб при рабочей температуре (PP-R PN20 — 20 бар при 20 °C, при нагреве меньше); участок сразу после компрессора — металлом.` });
    }
  }

  /** 12345 → «12 345» */
  static n(v){ return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  static plural(n, a, b, c){ const m=n%10, h=n%100; return m===1 && h!==11 ? a : m>=2 && m<=4 && (h<12 || h>14) ? b : c; }
}
