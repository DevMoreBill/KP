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

// ---------------------------------------------------------------- окраска контейнера (решение владельца 19.10: «на один цвет —
// одно окно»): каркас, стены, крыша, пол, двери и ворота — каждое своим полем (RAL или словами); крыша пустая — в цвет каркаса,
// двери и ворота — в цвет стен, пол — по материалу (сталь чёрная / алюминий без окраски). Прежнее поле «Цвет» (p.ral:
// «RAL 7035 / RAL 5005» — стены / каркас) читается, пока менеджер не изменит окраску. «Окраска по буклету заказчика» —
// галочка и файл (PDF или картинка, p.paintFile). Рисунки заказчика (p.art) — картинка, стена, место и ширина.
class StationPaint {
  static PARTS = [['frame', 'Цвет каркаса', 'RAL 5005'], ['wall', 'Цвет стен', 'RAL 7035'], ['roof', 'Цвет крыши', 'как каркас'], ['floor', 'Цвет пола', 'по материалу'], ['door', 'Цвет дверей и ворот', 'как стены']];
  static WALLS = { front:'Передняя стена', back:'Задняя стена', left:'Левый торец', right:'Правый торец' };
  static ALONG = [[0.15, 'у левого края'], [0.3, 'левее центра'], [0.5, 'по центру'], [0.7, 'правее центра'], [0.85, 'у правого края']];
  static HIGH = [[0.75, 'вверху'], [0.5, 'посередине'], [0.3, 'внизу']];
  static ART_MAX = 6;

  /** окраска частей: {frame, wall, roof, floor, door} — строки, как вписал менеджер (пустая — по умолчанию) */
  static of(c){
    c=c||{}; const p=c.paint && typeof c.paint==='object' ? c.paint : null, o={};
    if (p){ for (const [k] of this.PARTS) o[k]=String(p[k]||'').trim(); return o; }
    const r=RalColor.codes(c.ral), txt=String(c.ral||'').trim();   // прежнее «Цвет»: первый RAL — стены, второй — каркас
    for (const [k] of this.PARTS) o[k]='';
    if (r.length){ o.wall=r[0].code; o.frame=r[1] ? r[1].code : ''; } else o.wall=txt;
    return o;
  }
  /** поле окраски изменено менеджером: окраска — отдельными полями, прежнее «Цвет» больше не читается */
  static set(c, key, value){
    if (!this.PARTS.some(([k])=>k===key)) return;
    c.paint={ ...this.of(c), [key]:String(value||'').trim().slice(0, 60) }; delete c.ral;
  }
  /** цвет части: RAL → hex; «синий», «серый» → условный; null — не задан */
  static hex(text){ const r=RalColor.codes(text); return r[0] ? r[0].hex : RalColor.named(text); }
  /** «RAL 7035» — как в документе: код RAL, иначе текст менеджера */
  static code(text){ const r=RalColor.codes(text); return r[0] ? r[0].code : String(text||'').trim(); }
  /** цвета для 3D и видов: стены, каркас (не заданы — RAL 7035 / RAL 5005 условно), крыша, двери, пол (null — по материалу) */
  static colors(c){
    const o=this.of(c), w=this.hex(o.wall), f=this.hex(o.frame);
    const wall=w || '#CBD0CC', frame=f || (w ? RalColor.shade(wall, 0.72) : '#154889');
    return { wall, frame, roof:this.hex(o.roof) || frame, door:this.hex(o.door) || wall, floor:this.hex(o.floor), known:!!(w || f) };
  }
  static book(c){ return !!(c && c.paintBook); }
  /** строка «Окраска» в характеристиках КП: «каркас RAL 5005, стены RAL 7035, крыша RAL 5005, пол — сталь рифлёная, чёрная»;
   *  по буклету — «по буклету цветовых решений заказчика»; ничего не задано — '' (строки нет) */
  static kp(c){
    if (this.book(c)) return 'по буклету цветовых решений заказчика';
    const o=this.of(c); if (!Object.values(o).some(Boolean)) return '';
    const fl=StationGeo.FLOORS[StationGeo.floor(c)], cd=t=>this.code(t), out=[];
    if (o.frame) out.push('каркас '+cd(o.frame));
    if (o.wall) out.push('стены '+cd(o.wall));
    const roof=o.roof || o.frame; if (roof && !StationGeo.SEA[c.ctype]) out.push('крыша '+cd(roof));
    if (o.door && cd(o.door)!==cd(o.wall)) out.push('двери и ворота '+cd(o.door));
    out.push(o.floor ? 'пол '+cd(o.floor) : 'пол — '+fl.short);
    return out.join(', ');
  }
  /** коротко — подпись на чертеже и в заголовке блока: «RAL 7035 / RAL 5005», по буклету — «по буклету заказчика» */
  static short(c){
    if (this.book(c)) return 'по буклету заказчика';
    const o=this.of(c); return [o.wall, o.frame].filter(Boolean).map(t=>this.code(t)).join(' / ');
  }
  /** ТЗ на сборку: каждая часть отдельно и откуда цвет */
  static tz(c){
    const o=this.of(c), fl=StationGeo.FLOORS[StationGeo.floor(c)], cd=t=>this.code(t), sea=StationGeo.SEA[c.ctype];
    const parts=[`каркас — ${o.frame ? cd(o.frame) : 'по согласованию'}`, `стены — ${o.wall ? cd(o.wall) : 'по согласованию'}`,
      sea ? '' : `крыша — ${o.roof ? cd(o.roof) : (o.frame ? cd(o.frame)+', ' : '')+'в цвет каркаса'}`,
      `двери и ворота — ${o.door ? cd(o.door) : (o.wall ? cd(o.wall)+', ' : '')+'в цвет стен'}`, `пол — ${o.floor ? 'окраска '+cd(o.floor) : fl.name}`].filter(Boolean);
    return (this.book(c) ? 'по буклету цветовых решений заказчика (приложение к ТЗ); для ориентира: ' : '')+parts.join('; ');
  }

  /** рисунки заказчика: [{src, name, wall, x, z, w, ar}] — x, z — середина рисунка в долях стены (слева направо при взгляде
   *  снаружи, снизу вверх), w — ширина, мм; ar — ширина / высота картинки */
  static arts(c){
    return ((c && Array.isArray(c.art)) ? c.art : []).filter(a=>a && a.src && this.WALLS[a.wall]).slice(0, this.ART_MAX)
      .map(a=>({ src:String(a.src), name:String(a.name||''), wall:a.wall, x:this.frac(a.x, 0.5), z:this.frac(a.z, 0.5), w:Math.max(100, Math.min(12000, +a.w||1500)), ar:Math.max(0.1, Math.min(10, +a.ar||1)) }));
  }
  static frac(v, d){ v=+v; return v>=0 && v<=1 ? v : d; }
  /** где рисунок — словами: «Передняя стена, по центру, посередине, ширина 1 500 мм» */
  static where(a){
    const near=(L, v)=>L.reduce((b, q)=>Math.abs(q[0]-v)<Math.abs(b[0]-v) ? q : b)[1];
    return `${this.WALLS[a.wall]}, ${near(this.ALONG, a.x)}, ${near(this.HIGH, a.z)}, ширина ${StationLayout.n(a.w)} мм`;
  }
  /** отпечаток окраски — в отпечаток станции (картинки пересобираются при правке цвета, рисунка, буклета) */
  static stamp(c){ return JSON.stringify([this.of(c), !!this.book(c), this.arts(c).map(a=>[a.src.length>200 ? a.src.length+a.src.slice(-40) : a.src, a.wall, a.x, a.z, a.w])]); }
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
  // числа конструкции — матрица расстановки, раздел shell («Настройки → Инженерные правила станций → Конструкция контейнера»)
  static get LINING(){ return StationMatrix.grp('shell').seaLining; }     // обшивка морского контейнера поверх утеплителя, мм
  static get SEA_FLOOR(){ return StationMatrix.grp('shell').seaFloor; }  // утеплённый пол поверх штатного, мм
  // блок-контейнеры «по проекту»: к утеплителю стены — обшивка и каркас, пол и кровля — строительная высота, мм;
  // «Север» — с тамбуром у двери (перегородка с дверью: в тамбуре оборудование не ставится)
  static get FLEX(){ return StationMatrix.derive('flex', ()=>{ const s=StationMatrix.grp('shell');
    return { block:{ wall:s.blockWall, floor:s.blockFloor, roof:s.blockRoof }, welded:{ wall:s.weldWall, floor:s.weldFloor, roof:s.weldRoof }, north:{ wall:s.northWall, floor:s.northFloor, roof:s.northRoof, tambour:s.tambour } }; }); }
  // блок-контейнер — по необходимому месту, без запаса: размеры с шагом 100 мм; не меньше 2000 × 1500 × 2000; внутри с
  // проходом обслуживания — не ниже 2100 (проход в полный рост); шире 2550 — негабарит при перевозке (ПП РФ от
  // 21.12.2020 № 2200), до 3500
  // (значения — матрица расстановки, раздел fit: правятся в «Настройках»)
  static get STEP(){ return StationMatrix.fit().step; }
  static get BLOCK(){ const f=StationMatrix.fit(); return { minL:f.minL, minW:f.minW, minH:f.minH, hWalk:f.hWalk, maxW:f.maxW, maxH:f.maxH }; }
  static get ROAD_W(){ return StationMatrix.fit().roadW; }   // шире — негабарит при перевозке
  /** вверх до шага (размеры блок-контейнера) */
  static up(v){ return Math.ceil(v/this.STEP-1e-9)*this.STEP; }

  /** «6000 × 2400 × 2500 мм», «6 × 2,4 × 2,5 м», «6000x2400x2500» → [6000, 2400, 2500]; иначе null */
  static mm(text){ const a=StationEquip.sizes(text, StationEquip.DIM3); return a && a.every(v=>v>=500 && v<=30000) ? a : null; }
  /** заданная длина блок-контейнера, мм: «10000», «10 000 мм», «10 м», «10,5» → число в пределах длины блок-контейнера; иначе null */
  static len(text){
    const s=String(text??'').trim().replace(/(\d)\s+(?=\d{3}\b)/g, '$1'), m=s.match(/^(\d+(?:[.,]\d+)?)\s*(мм|м)?$/i); if (!m) return null;
    let v=parseFloat(m[1].replace(',', '.')); if (/^м$/i.test(m[2]||'') || v<40) v*=1000;
    v=Math.round(v); const f=StationMatrix.fit(); return v>=f.minL && v<=f.maxL ? v : null;
  }
  /** утеплитель, мм: из карточки контейнера; не указан — по умолчанию (раздел shell матрицы, 100 мм) */
  static ins(text){ const n=parseFloat(String(text||'').replace(',', '.')); return n>0 && n<400 ? n : StationMatrix.grp('shell').ins; }
  // крыша блок-контейнера: плоская или скатная — двускатная (конёк вдоль контейнера) или односкатная (выше у задней стены);
  // уклон, ° — подъём над стенами (у морского контейнера крыша штатная, плоская)
  static get ROOFS(){ return StationMatrix.derive('roofs', ()=>{ const s=StationMatrix.grp('shell');
    return { flat:{ name:'плоская', deg:0 }, gable:{ name:'двускатная', deg:s.gable }, mono:{ name:'односкатная', deg:s.mono }, arch:{ name:'арочная (покатая)', deg:0, k:0.075 } }; }); }
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

  /** c — элемент «контейнер» состава: {ctype, size, sizeAuto, ins}. auto — размер подбирается (блок-контейнер без своего размера) */
  static of(c){
    const type=c.ctype || 'block', t=this.ins(c.ins), sea=this.SEA[type], own=!c.sizeAuto ? this.mm(c.size) : null, f=this.flex(type);
    // станция из модулей (только блок-контейнеры): размер в составе — одного модуля, помещение — все модули вместе
    const M=sea ? null : StationMods.of(c), mod=own && M ? own : null;
    const ext=mod ? [mod[0]*M.a, mod[1]*M.b, mod[2]] : own || (sea ? sea.ext.slice() : null);
    const fixL0=!ext && !sea ? this.len(c.lenFix) : null, fixL=fixL0 && M ? fixL0*M.a : fixL0;   // длина задана (у модулей — модуля), ширина и высота — по оборудованию
    return { type, t, sea:!!sea, own:!!own, auto:!ext, fixL, ext, int:ext ? this.inner(type, ext, t) : null, x0:(f && f.tambour) || 0,
      door: sea ? sea.door : null, roof:this.roof(c), floor:this.floor(c), mods:M ? { ...M, ...(mod ? { Lm:mod[0], Wm:mod[1] } : {}) } : null };
  }
  /** высота пола внутри над низом контейнера, мм (морской: штатный пол + утеплённый, блок-контейнер — основание) */
  static zFloor(type){ const sea=this.SEA[type]; return sea ? (sea.ext[2]-sea.int[2]-40)+this.SEA_FLOOR : this.flex(type).floor; }
}

// ---------------------------------------------------------------- станция из нескольких модулей
// Аккуратная компоновка (решение владельца 19.10, «делай всё предложенное», 8 пунктов): ряды — по одной лицевой линии,
// одинаковые агрегаты — с равным шагом, проёмы — по общим линиям, магистраль — на одной высоте, конвекторы — с равным шагом,
// модули — по группам оборудования и ровнее по массе, из равных по площади вариантов — аккуратнейший; числа — правило
// layout.matrix, раздел look («Настройки → Правила компоновки → Аккуратность»)
class StationTidy {
  static get M(){ return StationMatrix.grp('look'); }
  /** п. 2: одинаковые соседи в ряду (вид, длина, глубина, поворот) — с равными промежутками (сумма не меняется, не меньше
   *  самого малого); items — из place(): {o, ri, x, lx, d} */
  static even(items){
    if (!this.M.even) return;
    const same=(a, b)=>a.ri===b.ri && a.o.e.kind===b.o.e.kind && a.lx===b.lx && a.d===b.d && !!a.o.rot===!!b.o.rot && !a.o.pair && !b.o.pair && !a.o.end && !b.o.end;
    for (const ri of [...new Set(items.map(i=>i.ri))]){ const R=items.filter(i=>i.ri===ri).sort((p, q)=>p.x-q.x);
      for (let a=0; a<R.length;){ let b=a; while (b+1<R.length && same(R[b], R[b+1])) b++;
        if (b-a>=2){ const g=[]; for (let k=a; k<b; k++) g.push(R[k+1].x-R[k].x-R[k].lx); const avg=Math.floor(g.reduce((s, v)=>s+v, 0)/g.length);
          for (let k=a+1; k<=b; k++) R[k].x=R[k-1].x+R[k-1].lx+avg; }
        a=b+1; } }
  }
  /** п. 7: оценка аккуратности 0…100 и пояснения: {score, good:[…], bad:[…]}. r — расстановка (items, doors, rows) или
   *  готовый план (с жалюзи и трубопроводом); geo — геометрия (модули) */
  static score(r, geo){
    const n=StationLayout.n, good=[], bad=[]; let pen=0;
    const fl=(r.items||[]).filter(i=>i.mount==='floor' && !i.cross && !i.pair && !i.tank && i.kind!=='dgu');
    // лицевые линии рядов
    const rows=new Map(); for (const i of fl){ const k=i.row; if (!rows.has(k)) rows.set(k, new Set()); rows.get(k).add(Math.round((i.face===1 ? i.y+i.ly : i.y)/10)); }
    const lines=[...rows.values()].reduce((s, S)=>s+S.size-1, 0);
    if (fl.length>1){ if (lines) { pen+=Math.min(30, lines*8); bad.push(`лицевых линий в ряду — ${lines+rows.size} (агрегаты разной глубины у стены)`); } else good.push('ряды — по одной лицевой линии'); }
    // шаг одинаковых
    let uneven=0, runs=0; for (const k of rows.keys()){ const R=fl.filter(i=>i.row===k).sort((a, b)=>a.x-b.x);
      for (let a=0; a<R.length;){ let b=a; while (b+1<R.length && R[b+1].kind===R[a].kind && R[b+1].lx===R[a].lx && R[b+1].ly===R[a].ly) b++;
        if (b-a>=2){ runs++; const g=[]; for (let q=a; q<b; q++) g.push(R[q+1].x-R[q].x-R[q].lx); if (Math.max(...g)-Math.min(...g)>10) uneven++; }
        a=b+1; } }
    if (runs){ if (uneven){ pen+=uneven*6; bad.push('промежутки между одинаковыми агрегатами разные'); } else good.push('одинаковые агрегаты — с равным шагом'); }
    // ворота одной высоты
    for (const w of ['front', 'back']){ const H=new Set((r.doors||[]).filter(d=>d.kind!=='entry' && d.wall===w).map(d=>d.h)); if (H.size>1){ pen+=5*(H.size-1); bad.push('сервисные ворота на одной стене — разной высоты'); } }
    // жалюзи по линиям (готовый план)
    const L=(r.vent && r.vent.louvers)||[];
    if (L.length){ let off=0; for (const w of ['front', 'back', 'left', 'right']) for (const [kind, key] of [['out', 'z1'], ['in', 'z0']]){ const S=new Set(L.filter(q=>q.wall===w && q.kind===kind && !q.leaf && !q.door).map(q=>q[key])); if (S.size>1) off+=S.size-1; }
      if (off){ pen+=off*4; bad.push('жалюзи на стене — не по одной линии (мешают ворота, двери или шкафы)'); } else good.push('жалюзи — по общим линиям'); }
    // магистраль на одной высоте
    const air=(r.lines||[]).filter(l=>l.medium==='air' && !l.header && !l.par);
    if (air.length) good.push(`магистраль — на одной высоте ${n(air[0].z)} мм`);
    // модули: группы и масса
    const md=geo && geo.mods; if (md && md.Lm){ const plan={ geo, items:r.items, int:geo.int||r.int }, C=StationMods.content(plan), kindOf=new Map((r.items||[]).map(i=>[i.pos, i.kind]));
      const grp=k=>k==='compressor' || k==='dgu' || k==='pump' ? 'a' : k==='dryer' || k==='filter' || k==='receiver' ? 'b' : '';
      const mixed=[...C.values()].filter(Lq=>new Set(Lq.map(q=>grp(kindOf.get(q.pos))).filter(Boolean)).size>1).length;
      if (mixed){ pen+=mixed*5; bad.push(`модулей с агрегатами и подготовкой воздуха вместе — ${mixed}`); } else if (C.size>1) good.push('стыки — между группами оборудования');
      const ox=(geo.ext[0]-geo.int[0])/2, oy=(geo.ext[1]-geo.int[1])/2, M=md.cells.map(([i, j])=>(r.items||[]).filter(q=>q.mass>0 && Math.floor((ox+q.x+q.lx/2)/md.Lm)===i && Math.floor((oy+q.y+q.ly/2)/md.Wm)===j).reduce((s, q)=>s+q.mass, 0));
      const Mn=M.filter(v=>v>0), hi=Math.max(0, ...Mn), lo=Mn.length ? Math.min(...Mn) : 0; if (hi>0 && Mn.length>1){ const k=lo>0 ? hi/lo : 3; if (k>2){ pen+=Math.min(15, Math.round((k-2)*5)); bad.push(`масса модулей неравная (самый тяжёлый — в ${k>=3 ? 'три и более' : String(Math.round(k*10)/10).replace('.', ',')} раза тяжелее лёгкого)`); } } }
    return { score:Math.max(0, 100-pen), good, bad };
  }
  /** п. 7: строка в «Компоновке»: «Аккуратность 92 из 100» и пояснение */
  static line(plan){
    const t=plan && plan.tidy; if (!t) return '';
    return ` · аккуратность ${t.score} из 100`;
  }
  /** п. 3: сервисные ворота на одной стене — одной высоты (по самым высоким) */
  static doors(D){
    if (!this.M.lines || !D) return;
    for (const w of ['front', 'back']){ const S=D.filter(d=>d.kind!=='entry' && d.wall===w); if (S.length<2) continue; const h=Math.max(...S.map(d=>d.h)); for (const d of S) d.h=h; }
  }
  /** п. 3: жалюзи на стене — по общим линиям: выброс — по верху самого высокого, приток — по низу самого низкого (если место
   *  свободно); W — занятость стен (StWalls), L — жалюзи; поставленные в створки и двери-жалюзи — как есть */
  static louvers(L, W, H, gap){
    if (!this.M.lines) return;
    const own=q=>[q.u0-90-gap, q.u1+260+gap, q.z0-90, q.z1+90], drop=(w, b)=>{ const B=W.B[w], i=B.findIndex(x=>x.every((v, k)=>v===b[k])); if (i>=0) B.splice(i, 1); return i>=0; };
    for (const w of ['front', 'back', 'left', 'right']) for (const [kind, top] of [['out', true], ['in', false]]){
      const S=L.filter(q=>q.wall===w && q.kind===kind && !q.leaf && !q.door); if (S.length<2) continue;   // с воздуховодом компрессора — опора линии, не двигаются
      const t=top ? Math.max(...S.map(q=>q.z1)) : Math.min(...S.map(q=>q.z0));
      for (const q of S.filter(q=>!q.duct)){ const dz=top ? t-q.z1 : t-q.z0; if (!dz || q.z1+dz>H-100 || q.z0+dz<0) continue;
        const b=own(q), had=drop(w, b), n=[b[0], b[1], b[2]+dz, b[3]+dz];
        if (W.free(w, q.u0-90, q.u1+90, q.z0+dz-90, q.z1+dz+90, false)){ q.z0+=dz; q.z1+=dz; W.B[w].push(n); } else if (had) W.B[w].push(b); } }
  }
  /** п. 1: лицевая линия ряда (сторона прохода) — общая, где это ничего не ухудшает: к стене агрегат отходит, пока сзади
   *  остаётся рекомендуемый отступ; к проходу выдвигается, только если проход остаётся не уже рекомендуемого aRec (или на
   *  ≤ 50 мм); сдвиг — не больше look.align. Линия — та из лицевых линий агрегатов, на которую встаёт больше всего */
  static facade(items, W, rows, aRec){
    const lim=this.M.align; if (!(lim>0)) return;
    const eq=items.filter(i=>!i.o.e.slot && !i.o.e.cross && !i.o.end && !i.o.pair && i.o.e.kind!=='dgu');
    for (const ri of [...new Set(eq.map(i=>i.ri))]){ const R=eq.filter(i=>i.ri===ri); if (R.length<2) continue;
      const front=R[0].face===1, F=it=>front ? it.y+it.d : it.y;   // передний ряд (два ряда): лицом к проходу — y + глубина
      // может ли агрегат встать лицом на линию t: к стене — до рекомендуемого отступа сзади, к проходу — проход не уже aRec
      const can=(it, t)=>{ const dv=t-F(it), toWall=front ? dv<0 : dv>0; if (Math.abs(dv)>lim) return false; if (!dv) return true;
        if (toWall) return (front ? t-it.d : W-t-it.d)>=it.o.e.c.back[0];
        return Math.abs(dv)<=50 || rows===2 || (front ? true : t>=aRec); };
      let best=null; for (const t of [...new Set(R.map(F))]){ const n=R.filter(it=>can(it, t)).length; if (!best || n>best.n) best={ t, n }; }
      if (!best || best.n<2) continue;
      for (const it of R) if (can(it, best.t)){ if (front){ it.y=best.t-it.d; it.back=it.y; } else { it.y=best.t; it.back=W-best.t-it.d; if (rows!==2) it.aisle=best.t; } } }
  }
}

// Решение владельца 19.10: крупное оборудование — в станции из нескольких блок-модулей (до mods.max, больше — по запросу),
// модули стыкуются на объекте бок о бок и торец к торцу в одно помещение (стыковые стены не ставятся — временные щиты на
// перевозку); раскладка — на сетке, выбирает менеджер (кнопка «Модули…» в «Компоновке», всегда с подтверждением). Модули
// одного размера; раскладка — прямоугольник a × b (a — вдоль длины, b — по ширине). В составе — контейнер × n и строка
// «Стыковка модулей на объекте» (стыков — по сетке).
class StationMods {
  static get M(){ return StationMatrix.grp('mods'); }
  static get MAX(){ return Math.max(2, this.M.max||9); }
  /** ширины модуля, мм (решение владельца 19.10: все модули одной ширины, от wMin до wMax, не шире габарита перевозки):
   *  wMin, затем кратные 100 и wMax */
  static widths(){ const a=Math.min(this.M.wMin||2448, StationGeo.ROAD_W), b=Math.max(a, Math.min(this.M.wMax||2550, StationGeo.ROAD_W)), out=[a];
    for (let w=Math.ceil((a+1)/100)*100; w<b; w+=100) out.push(w); if (b>a) out.push(b); return out; }
  /** раскладка элемента «контейнер» или null: {n, a, b, cells:[[x, y]…]} — только прямоугольник из 2 и больше модулей */
  static of(c){ const r=c && c.mods && this.rect(c.mods.cells); return r && r.ok && r.n>1 ? r : null; }
  /** клетки сетки → {ok, n, a, b, cells} (сдвинуты к началу); ok — без повторов, прямоугольник целиком, не больше max */
  static rect(cells){
    const C=(Array.isArray(cells) ? cells : []).filter(q=>Array.isArray(q) && q.length===2 && q.every(Number.isInteger)), n=C.length; if (!n) return null;
    const x0=Math.min(...C.map(q=>q[0])), y0=Math.min(...C.map(q=>q[1])), N=C.map(([x, y])=>[x-x0, y-y0]);
    const a=Math.max(...N.map(q=>q[0]))+1, b=Math.max(...N.map(q=>q[1]))+1, uniq=new Set(N.map(q=>q.join(','))).size===n;
    return { ok:uniq && a*b===n && n<=this.MAX, n, a, b, cells:N };
  }
  /** раскладка a × b клетками */
  static cells(a, b){ const out=[]; for (let y=0; y<b; y++) for (let x=0; x<a; x++) out.push([x, y]); return out; }
  /** все прямоугольные раскладки из n модулей: [[a, b]…] (сначала вдоль, затем бок о бок) */
  static shapes(n){ const out=[]; for (let a=n; a>=1; a--) if (n%a===0) out.push([a, n/a]); return out; }
  /** стыков между модулями: по длине (a − 1)·b и по ширине a·(b − 1) */
  static joints(m){ return m ? (m.a-1)*m.b+m.a*(m.b-1) : 0; }
  /** «2 модуля бок о бок», «3 модуля торец к торцу», «4 модуля: 2 × 2» */
  static shape(m){ const w=v=>`${v} ${v%10===1 && v%100!==11 ? 'модуль' : [2, 3, 4].includes(v%10) && ![12, 13, 14].includes(v%100) ? 'модуля' : 'модулей'}`;
    return m.b===1 ? `${w(m.n)} торец к торцу` : m.a===1 ? `${w(m.n)} бок о бок` : `${w(m.n)}: ${m.a} по длине × ${m.b} по ширине`; }
  /** стойки каркаса внутри помещения — на пересечениях стыков (раскладки с a и b от 2): [{x, y}] мм внутри */
  static posts(geo){ const m=geo && geo.mods; if (!m || !m.Lm || m.a<2 || m.b<2) return [];
    const [L, W]=geo.int, ox=(geo.ext[0]-L)/2, oy=(geo.ext[1]-W)/2, out=[];
    for (let i=1; i<m.a; i++) for (let j=1; j<m.b; j++) out.push({ x:i*m.Lm-ox, y:j*m.Wm-oy });
    return out; }
  /** оборудование на полу, стоящее на стойке стыка (с отступом в полстойки): [элементы] */
  static hits(items, geo){ const P=this.posts(geo), s=this.M.post/2; if (!P.length) return [];
    return (items||[]).filter(i=>i.mount!=='wall' && i.mount!=='pipe' && P.some(p=>i.x<p.x+s && i.x+i.lx>p.x-s && i.y<p.y+s && i.y+i.ly>p.y-s)); }
  /** оборудование на стыке модулей (решение владельца 19.10: модуль везут с оборудованием внутри — на стыке его быть не
   *  должно): элементы, заходящие за линию стыка ближе полустойки каркаса; трубопровод не считается — его расстыковывают */
  static cross(items, geo){ const J=this.lines(geo), s=this.M.post/2; if (!J.x.length && !J.y.length) return [];
    return (items||[]).filter(i=>i.mount!=='pipe' && (J.x.some(x=>i.x<x+s && i.x+i.lx>x-s) || J.y.some(y=>i.y<y+s && i.y+i.ly>y-s))); }
  /** что в каком модуле: Map 'i,j' → [{pos, name}] — оборудование на полу и шкафы на стене по центру (трубопровод и фильтры на
   *  нём не считаются), по позиции один раз */
  static content(plan){
    const g=plan && plan.geo, m=g && g.mods, out=new Map(); if (!m || !m.Lm || !plan.items) return out;
    const ox=(g.ext[0]-g.int[0])/2, oy=(g.ext[1]-g.int[1])/2;
    for (const it of plan.items){ if (it.mount==='pipe') continue;
      const i=Math.min(m.a-1, Math.max(0, Math.floor((ox+it.x+it.lx/2)/m.Lm))), j=Math.min(m.b-1, Math.max(0, Math.floor((oy+it.y+it.ly/2)/m.Wm))), k=i+','+j;
      if (!out.has(k)) out.set(k, []); const L=out.get(k); if (!L.some(q=>q.pos===it.pos)) L.push({ pos:it.pos, name:it.short||it.name||'' }); }
    for (const L of out.values()) L.sort((p, q)=>p.pos-q.pos);
    return out; }
  /** линии стыков внутри помещения, мм: {x:[…] — поперёк, y:[…] — вдоль} */
  static lines(geo){ const m=geo && geo.mods; if (!m || !m.Lm) return { x:[], y:[] };
    const [L, W]=geo.int, ox=(geo.ext[0]-L)/2, oy=(geo.ext[1]-W)/2;
    return { x:Array.from({ length:m.a-1 }, (_, i)=>(i+1)*m.Lm-ox), y:Array.from({ length:m.b-1 }, (_, j)=>(j+1)*m.Wm-oy) }; }
}

// ---------------------------------------------------------------- отступы
// [рекомендуется, не менее], мм. Внутри контейнера шириной около 2,1 м нормы машинных залов (1–1,5 м со всех сторон)
// невыполнимы, поэтому два уровня: «рекомендуется» — цель, «не менее» — меньше нельзя (иначе — другой контейнер).
// Источники:
// • проход обслуживания 1000 / 800 — руководства производителей винтовых компрессоров (не менее 1 м для обслуживания);
//   ПУЭ, п. 4.1.23 — проход обслуживания в свету не менее 0,8 м (правило norm.aisle);
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
  static get PUMP_SMALL(){ return StationMatrix.derive('pumps', ()=>{ const p=StationMatrix.grp('pumps'); return { back:[p.back, p.backMin], side:[p.side, p.sideMin], top:[p.top, p.topMin] }; }); }
  /** отступы для оборудования: вид и (для насосов) мощность и размер (матрица, раздел pumps) */
  static of(kind, e){
    if (kind==='pump' && e){ const p=StationMatrix.grp('pumps'); if (!(e.kw>p.kw) && Math.max(e.l||0, e.w||0)<=p.len) return this.PUMP_SMALL; }
    return this.KIND[kind] || this.KIND.other;
  }
  /** проход обслуживания [рекомендуется, не менее] — правило norm.aisle («Настройки → Инженерные правила станций →
   *  Правила компоновки») */
  static aisle(){
    const A=StationRules.raw('norm.aisle'), rec=Math.max(600, Math.min(3000, +A[0]||1000)), min=Math.max(600, Math.min(rec, +A[1]||800));
    return [rec, min];
  }
}

// ---------------------------------------------------------------- матрица расстановки
// Значения и формулы расстановки — правило layout.matrix файла инженерных правил (правится в «Настройках → Инженерные
// правила станций», таблица «Матрица расстановки»); в своей версии файла администратора правила может не быть — тогда
// значения по умолчанию (те же, что в файле поставки). Решение ПНЕВМОТЕХ: полезные размеры = внутренние − 2·G;
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
    // s — обслуживаемые стороны; door:false — без сервисных ворот (монтаж и демонтаж — через ворота в торце, решение
    // ПНЕВМОТЕХ: осушители и ресиверы); tilt — при выносе можно наклонить (сосуд, фильтр, шкаф, бак; остальное — стоя)
    sides:{ rows:[{ kind:'compressor', s:'ФЗЛП' }, { kind:'dryer', s:'Ф', door:false }, { kind:'receiver', s:'Ф', door:false, tilt:true }, { kind:'pump', s:'ФЛП' }, { kind:'dgu', s:'ФЛП' },
      { kind:'cabinet', s:'Ф', tilt:true }, { kind:'other', s:'Ф' }, { kind:'tank', s:'Ф', tilt:true }, { kind:'filter', s:'Ф', tilt:true }] },
    rotate:{ rows:[{ kind:'compressor', on:true }, { kind:'dryer', on:true }, { kind:'receiver', on:true }, { kind:'pump', on:true }, { kind:'other', on:true },
      { kind:'dgu', on:false }, { kind:'cabinet', on:false }] },
    gate:{ addW:200, addH:200, full:0.75, twoAt:8000, minW:1500, minH:2100, top:100 },
    service:{ addW:200, addH:200, minH:1500, min:800, max:2400, leaf:1200, step:100, wall:1 },
    door:{ w:900, h:2000, gap:300, edge:300, pad:100 },
    aisle:{ service:600 },
    exits:{ dist:5000, far:7000 },
    exhaust:{ louvre:300, over:300 },
    // подбор размера блок-контейнера (решение ПНЕВМОТЕХ: по умолчанию — самая плотная компоновка в габарите перевозки;
    // негабарит — только в исключительном случае, последним)
    fit:{ dense:1, roadW:2550, wide:1, maxL:12000, minL:2000, minW:1500, minH:2000, hWalk:2100, maxW:3500, maxH:3200, step:100, two:25, ends:10, recv2:1000, growVent:3000, growHeat:500 },
    // исключения компрессорной — только если иначе станция не в габарите перевозки (по порядку: без продольного прохода,
    // проход «в крайнем случае», агрегат поперёк)
    modes:{ ends:1, tight:1, cross:1, next:1000 },
    recv:{ pairSide:300, outGap:1000, outStep:600, pad:100, upright:1, close:1, pairWall:100 },
    cab:{ top:1900, low:300 },
    move:{ pass:25 },
    tank:{ pad:300, gap:300, back:100, aisle:600, part:100, door:800, fill:1000, max:4500, gates:1, h1:1000, h2:1500, big:2000, w1:800, w2:1000, step:50, wall:4, top:300, wMax:3000 },
    conv:{ z:150, gap:100, edge:100, front:150 },
    // ДГУ в контейнере (решение владельца 19.10): радиатор — вплотную к жалюзи; поворот на 90° — когда компоновка лучше; две ДГУ
    // без бака — по одной у каждого торца радиаторами наружу; от across штук (и две с баком) — поперёк, радиаторами к задней стене;
    // конвекторы у ДГУ — плотнее
    dgu:{ rad:50, rot:1, two:1, across:3, pass:400, convGap:50, convEdge:50, convFront:100 },
    muffler:{ gap:200, outlet:300 },
    // станция из модулей (решение владельца 19.10): не больше max модулей (больше — по запросу), стойка каркаса на стыке, мм
    mods:{ max:9, post:200, wMin:2448, wMax:2550, lMin:7000 },
    look:{ align:600, even:1, lines:1, modStep:2, tidy:1 },
    // ниже — прочие числа станции: все значения и умолчания правятся в «Настройках» (решение ПНЕВМОТЕХ)
    shell:{ ins:100, seaLining:15, seaFloor:50, blockWall:20, blockFloor:150, blockRoof:60, weldWall:10, weldFloor:160, weldRoof:60, northWall:20, northFloor:200, northRoof:80, tambour:1200, gable:8, mono:5 },
    pick:{ max:4, over:30, recvFit:300, dryerFit:100, recvFree:6, recvAny:4, oneSup:10 },
    pipe:{ airY:150, pad:60, outGap:150, outEdge:300, flange:150 },
    pumps:{ kw:22, len:1200, back:300, backMin:100, side:700, sideMin:250, top:300, topMin:100 },
    grille:{ step:50, gap:200, near:450, inZ:200, inHmin:300, inHmax:1200, inWmin:400, inWmax:1500, whole:2400, maxn:4, outTop:420, outHmin:300, outHmax:800, outWmin:400, outWmax:1500,
      piece:600, lift:750, fanMin:500, roofHood:420, hoodSide:80, hoodLap:50, hoodAng0:30, hoodAng1:75, hoodLow:100, hoodGap:300, radV:7.5 },
    mass:{ frame:110, pBlock:22, pNorth:27, pWelded:38, lining:12, floor:45, otherK:0.05, otherKg:100, angle:45, lugL:90, lugW:60, beamL:6500, beamZ:2000, beamTop:1500,
      sprZ:1500, sprD:1500, sprTop:2000, tare10:1300, tare20:2250, tare20hc:2350, tare40:3750, tare40hc:3900 },
    light:{ plane:800, lampW:36, lampLm:3600, lampLen:1200, small:15, flood:30, exit:3, fuelPump:2.4 },
    fire:{ modArea:7, modVolA:18, modVolB:16, modSide:2640, modZ0:2500, modZ1:3500, k1:1, k3:1, k4:1, shadeH:600, shadeGap:150, ext:1500 },
    power:{ dryerK:0.2, dryerMin:0.3, dryerAds:0.1, dguHeat:2, dguHeatBig:3, dguHeatKw:250, charger:0.1, fuelPumpKw:0.37, s230:3.5, s230k:0.3, s380:11, s380k:0.2, ytp:0.25, ytpK:0.5,
      valves:0.05, ops:0.05, asu:0.3, sockStep:4000, sockMin:2, sock380:1, sockZ:1000 },
  };
  /** матрица: из правил (недостающее — по умолчанию); пересобирается, только когда сменились правила */
  static get M(){ const v=typeof StationRules!=='undefined' && StationRules.ok() ? StationRules.opt('layout.matrix') : null, D=this.DEF;
    if (!v || typeof v!=='object') return D;
    if (this._v===v) return this._m;
    const o={}; for (const k of Object.keys(D)) o[k]=v[k] && typeof v[k]==='object' ? { ...D[k], ...v[k] } : D[k];
    this._v=v; this._m=o; return o; }
  /** числа раздела g по умолчанию программы, заменённые значениями правил (каждое — в пределах LayoutParams) */
  static grp(g){ const C=this.memo().g; let o=C.get(g);
    if (!o){ const D=this.DEF[g], v=this.M[g]; o={};
      for (const k of Object.keys(D)){ const f=LayoutParams.field(g, k), x=this.num(v[k], D[k]); o[k]=f ? Math.max(f.lo, Math.min(f.hi, x)) : x; }
      C.set(g, Object.freeze(o)); }
    return o; }
  /** разобранное из матрицы — один раз на матрицу (расстановка спрашивает одно и то же тысячи раз; только для чтения):
   *  g — разделы, s — обслуживаемые стороны вида, p — строки пар соседей */
  static memo(){ const M=this.M; if (this._mm!==M){ this._mm=M; this._mc={ g:new Map(), s:new Map(), p:new Map(), d:new Map() }; } return this._mc; }
  static num(v, d){ const n=+v; return Number.isFinite(n) ? n : d; }
  static gap(){ return Math.max(0, Math.min(150, this.num(this.M.gap.v, 50))); }
  /** размер «of» для пары: 'receiver.w' — ширина (диаметр) ресивера из пары (больший), '' — нет */
  static dim(of, a, b){ const [k, f]=String(of||'').split('.'); if (!k) return 0;
    const v=e=>e && e.kind===k ? +(f==='l' ? e.l : f==='h' ? e.h : e.pairD || e.w)||0 : 0; return Math.max(0, v(a), v(b)); }
  /** между соседями a и b по длине: [рекомендуется, не менее, крайний случай (вплотную — только где допускается)] или
   *  null — правила для этой пары нет */
  static pair(a, b){
    const C=this.memo().p, ck=a.kind+'|'+b.kind; let r=C.get(ck);
    if (r===undefined){ r=(this.M.pair.rows||[]).find(q=>(q.a===a.kind && q.b===b.kind) || (q.a===b.kind && q.b===a.kind)) || null; C.set(ck, r); }
    if (!r) return null;
    const rec=Math.round(Math.max(this.num(r.base, 0), this.num(r.k, 0)*this.dim(r.of, a, b))), mn=Math.min(rec, Math.max(0, this.num(r.min, rec)));
    return [rec, mn, r.close ? 0 : mn];
  }
  /** от стены за агрегатом e: [рекомендуется, «плотно»] или null — правила для вида нет */
  static wall(e){ const r=(this.M.wall.rows||[]).find(q=>q.kind===e.kind) || (e.kind==='pump' || e.kind==='compressor' || e.kind==='dryer' || e.kind==='receiver' ? null : (this.M.wall.rows||[]).find(q=>q.kind==='other'));
    if (!r) return null; const rec=Math.round(Math.max(this.num(r.base, 0), this.num(r.k, 0)*(+e.w||0))); return [rec, Math.min(rec, Math.max(0, this.num(r.tight, rec)))]; }
  static access(){ const a=this.M.access; return { back:this.num(a.back, 500), side:this.num(a.side, 600) }; }
  /** обслуживаемые стороны вида: {F, B, L, R} (фронт, зад, бока по длине) */
  static sides(kind){ const C=this.memo().s; let o=C.get(kind);
    if (!o){ const r=(this.M.sides.rows||[]).find(q=>q.kind===kind) || (this.M.sides.rows||[]).find(q=>q.kind==='other'), s=String((r && r.s) || 'Ф').toUpperCase();
      o=Object.freeze({ F:/Ф/.test(s), B:/З/.test(s), L:/Л/.test(s), R:/П/.test(s) }); C.set(kind, o); }
    return o; }
  static rot(kind){ const r=(this.M.rotate.rows||[]).find(q=>q.kind===kind); return r ? r.on!==false : !/^(dgu|cabinet)$/.test(kind); }
  static gate(){ return this.grp('gate'); }
  static service(){ return this.grp('service'); }
  static door(){ return this.grp('door'); }
  static aisle(){ return this.grp('aisle'); }
  static exits(){ return this.grp('exits'); }
  static louvre(){ return this.grp('exhaust').louvre; }
  static fit(){ return this.grp('fit'); }
  static modes(){ return this.grp('modes'); }
  static recv(){ return this.grp('recv'); }
  static cab(){ return this.grp('cab'); }
  static move(){ return this.grp('move'); }
  static tank(){ return this.grp('tank'); }
  static conv(){ return this.grp('conv'); }
  static muffler(){ return this.grp('muffler'); }
  /** объект, собранный из чисел матрицы (fn), — один на матрицу: сравнение по ссылке и частые обращения без лишних копий */
  static derive(k, fn){ const C=this.memo(); let o=C.d.get(k); if (!o){ o=fn(); C.d.set(k, o); } return o; }
  static NO_DOOR = /^(dryer|receiver)$/;
  /** вид без сервисных ворот — монтаж и демонтаж через ворота в торце: по отметке таблицы «Стороны» (door: true / false);
   *  без отметки — осушителям и ресиверам нет (решение ПНЕВМОТЕХ; правила, сохранённые раньше без отметки, ворот им не
   *  дают), остальным — можно */
  static noDoor(kind){ const r=(this.M.sides.rows||[]).find(q=>q.kind===kind); return r && typeof r.door==='boolean' ? !r.door : this.NO_DOOR.test(kind); }
  /** при выносе можно наклонить */
  static tilt(kind){ const r=(this.M.sides.rows||[]).find(q=>q.kind===kind); return r ? !!r.tilt : /^(receiver|filter|cabinet|tank)$/.test(kind); }
}

// ---------------------------------------------------------------- параметры компоновки: подписи, единицы, пределы
// Все числа матрицы расстановки, кроме таблиц, — по разделам: подпись, единица, пределы (сервер проверяет те же —
// app/station_rules.py, LayoutValues.SCALAR), пояснение. По ним строится форма «Настройки → Инженерные правила станций →
// Правила компоновки» и свод «как программа компонует». Значения по умолчанию — StationMatrix.DEF: самая плотная
// компоновка в габарите перевозки (решение ПНЕВМОТЕХ).
class LayoutParams {
  static ON = [[1, 'да'], [0, 'нет']];
  static SECTIONS = [
    { id:'fit', title:'Размер контейнера и габарит перевозки', t:'Блок-контейнер подбирается по оборудованию — наименьшая площадь пола, шаг размеров; цель — пройти по габариту перевозки без спецразрешения.', f:[
      { g:'fit', k:'dense', t:'Как подбирать размер', opt:[[1, 'плотно (станция меньше)'], [0, 'просторно (рекомендуемые)']], h:'Плотно — по допустимым отступам и проходу (решение ПНЕВМОТЕХ: базовые значения — максимально плотная компоновка); свободное место программа сама раздаёт до рекомендуемых. Просторно — сначала рекомендуемые отступы, затем допустимые.' },
      { g:'fit', k:'roadW', t:'Ширина без спецразрешения (габарит перевозки)', u:'мм', lo:2000, hi:3500, h:'ПП РФ от 21.12.2020 № 2200: 2,55 м. Шире — негабарит.' },
      { g:'fit', k:'wide', t:'Негабарит (шире перевозки)', opt:[[1, 'последним, если иначе никак'], [0, 'не предлагать']], h:'Негабарит — исключение: сначала плотно, ресиверы парами, без продольного прохода, проход «в крайнем случае», агрегат поперёк; затем — шире, с предупреждением. «Не предлагать» — ошибка «разделите станцию на два модуля».' },
      { g:'fit', k:'maxL', t:'Длина блок-контейнера — не больше', u:'мм', lo:3000, hi:20000 },
      { g:'fit', k:'minL', t:'Длина — не меньше', u:'мм', lo:1000, hi:6000 },
      { g:'fit', k:'minW', t:'Ширина — не меньше', u:'мм', lo:1000, hi:2550 },
      { g:'fit', k:'maxW', t:'Ширина негабарита — не больше', u:'мм', lo:2550, hi:5000 },
      { g:'fit', k:'minH', t:'Высота снаружи — не меньше', u:'мм', lo:1500, hi:3000 },
      { g:'fit', k:'hWalk', t:'Высота внутри — не меньше (проход в полный рост)', u:'мм', lo:1900, hi:3000 },
      { g:'fit', k:'maxH', t:'Высота снаружи — не больше', u:'мм', lo:2400, hi:4000 },
      { g:'fit', k:'step', t:'Шаг размеров', u:'мм', lo:10, hi:500 },
      { g:'fit', k:'two', t:'Два ряда оборудования — если площадь меньше одного ряда хотя бы на', u:'%', lo:0, hi:60, h:'Один ряд удобнее в обслуживании и обвязке.' },
      { g:'fit', k:'recv2', t:'Ресиверы парами поперёк в конце ряда — если станция короче хотя бы на', u:'мм', lo:0, hi:5000 },
      { g:'fit', k:'ends', t:'Без продольного прохода — если площадь меньше хотя бы на', u:'%', lo:0, hi:60, h:'Две пары сервисных ворот и ворота в обоих торцах — дороже, поэтому только при заметном выигрыше. По умолчанию 10 %: при плотном подборе, например, станция 90 кВт с 4 ресиверами по 900 л так получается короче на 1,3 м.' },
      { g:'fit', k:'growVent', t:'Жалюзи притока и выброса не встают на стены — удлинить контейнер не больше чем на', u:'мм', lo:0, hi:6000, h:'Программа пробует длиннее (шагами по 500 мм, затем точнее по 100 мм), чтобы жалюзи встали на стены; не вышло — замечание «примите воздуховодом».' },
      { g:'fit', k:'growHeat', t:'Конвекторам отопления нет места — удлинить контейнер не больше чем на', u:'мм', lo:0, hi:3000, h:'Плотная компоновка важнее: дальше — замечание «добавьте мощность иначе».' }] },
    { id:'modes', title:'Исключения ради габарита перевозки (компрессорная)', t:'Только если иначе станция не проходит по ширине перевозки или в заданный контейнер; в замечаниях — «исключение». Порядок: без продольного прохода → проход «в крайнем случае» → агрегат поперёк → негабарит.', f:[
      { g:'modes', k:'ends', t:'Без продольного прохода: компрессор у торца, сервисные ворота с двух сторон, ворота в торцах', opt:null, h:'Решение ПНЕВМОТЕХ 13.10. Дверь оператора — между компрессором и осушителем, к ресиверам — ворота в дальнем торце, ресиверы — парами плотнее. Несколько компрессоров — рядом в ряд от торца.' },
      { g:'modes', k:'tight', t:'Проход оператора «в крайнем случае» (ширина — ниже, в «Проходах»)', opt:null },
      { g:'modes', k:'cross', t:'Агрегат поперёк лицом к входу — без сквозного прохода, вторая дверь оператора за ним', opt:null },
      { g:'modes', k:'next', t:'Без продольного прохода: между компрессорами и за последним — не меньше', u:'мм', lo:600, hi:3000, h:'Решение ПНЕВМОТЕХ 13.10: компрессоры — рядом в ряд от торца (так короче трубопровод), к каждому следующему — доступ со всех сторон с отступом в метр.' }] },
    { id:'door', title:'Дверь оператора и проёмы', f:[
      { g:'door', k:'w', t:'Дверь оператора: ширина в свету', u:'мм', lo:900, hi:1000, h:'Решение ПНЕВМОТЕХ 12.10: 900–1 000 мм.' },
      { g:'door', k:'h', t:'Дверь оператора: высота в свету', u:'мм', lo:2000, hi:2100 },
      { g:'door', k:'gap', t:'Между дверями и воротами на одной стене — не меньше', u:'мм', lo:0, hi:2000, h:'Решение ПНЕВМОТЕХ 13.10, 300 мм подтверждено владельцем 13.10.' },
      { g:'door', k:'edge', t:'От края (угла) станции до двери или ворот — не меньше', u:'мм', lo:0, hi:2000, h:'Снаружи: козырёк над дверью и угловая стойка; 300 мм подтверждено владельцем 13.10.' },
      { g:'door', k:'pad', t:'От угла внутри — не ближе', u:'мм', lo:0, hi:1000 },
      { g:'exits', k:'far', t:'Вторая дверь оператора — если от дальней точки помещения до выхода больше', u:'мм', lo:2000, hi:30000, h:'Решение владельца 19.10: «достаточно одной двери оператора» — вторая только если до выхода далеко или ряд шкафов длиннее 7 м (ПУЭ, п. 4.1.23). Выходы — дверь оператора, ворота в торце (если перед ними не ресиверы парой) и дверь-жалюзи ДГУ.' },
      { g:'exits', k:'dist', t:'Между выходами — не меньше (где позволяет длина)', u:'мм', lo:0, hi:20000 }] },
    { id:'gate', title:'Ворота в торце (монтаж и демонтаж)', t:'Всегда в торце; по оси торца; высота — по самому высокому оборудованию станции, в обоих торцах одинаковая.', f:[
      { g:'gate', k:'addW', t:'Ширина = ширина агрегата + …', u:'мм', lo:0, hi:1000 },
      { g:'gate', k:'minW', t:'Ширина — не меньше', u:'мм', lo:800, hi:3000 },
      { g:'gate', k:'full', t:'Во весь торец, если ворота занимают не меньше доли ширины', u:'доля', lo:0.3, hi:1, h:'0,75 — три четверти ширины торца.' },
      { g:'gate', k:'addH', t:'Высота = самое высокое оборудование + …', u:'мм', lo:0, hi:1000, h:'Решение ПНЕВМОТЕХ 13.10: «по высоте самого высокого оборудования плюс запас».' },
      { g:'gate', k:'minH', t:'Высота — не меньше', u:'мм', lo:1500, hi:3000, h:'«Минимум — здравый смысл»: проём двери оператора 2 100 мм — подтверждено владельцем 13.10.' },
      { g:'gate', k:'top', t:'Ниже потолка — не меньше', u:'мм', lo:0, hi:500 },
      { g:'gate', k:'twoAt', t:'Ворота в обоих торцах, если цепочка оборудования длиннее', u:'мм', lo:2000, hi:20000 }] },
    { id:'service', title:'Сервисные ворота (за агрегатом, в боковой стене)', t:'Только если агрегат стоит плотно к стене и иначе его не обслужить; осушителям и ресиверам — никогда (отметка в таблице «Стороны»). Решение ПНЕВМОТЕХ 12.10 и 13.10.', f:[
      { g:'access', k:'back', t:'Нужны, если сзади свободно меньше', u:'мм', lo:0, hi:2000 },
      { g:'access', k:'side', t:'Проход к боку агрегата у торца — не меньше', u:'мм', lo:300, hi:2000 },
      { g:'service', k:'addW', t:'Ширина = длина агрегата + …', u:'мм', lo:0, hi:1000 },
      { g:'service', k:'min', t:'Ширина — не меньше', u:'мм', lo:300, hi:2000 },
      { g:'service', k:'max', t:'Ширина — не больше', u:'мм', lo:1000, hi:6000 },
      { g:'service', k:'leaf', t:'Створка — не шире', u:'мм', lo:300, hi:2000 },
      { g:'service', k:'addH', t:'Высота = высота агрегата + …', u:'мм', lo:0, hi:1000 },
      { g:'service', k:'minH', t:'Высота — не меньше', u:'мм', lo:300, hi:2500 },
      { g:'service', k:'step', t:'Ширину округлять до', u:'мм', lo:10, hi:500, h:'Решение ПНЕВМОТЕХ 13.10: «тонкая настройка — чтобы сделать в размер оборудования». В размер оборудования: «+ …» = 0, округление 10, без толщины стенки, «не меньше» — небольшие.' },
      { g:'service', k:'wall', t:'Прибавлять толщину стенки (проём в каркасе)', opt:null }] },
    { id:'aisle', title:'Проходы и зазоры', f:[
      { g:'aisle', k:'service', t:'Проход обслуживания (крайний, к стороне агрегата)', u:'мм', lo:300, hi:2000 },
      { g:'gap', k:'v', t:'Зазор на коммуникации у стен и под потолком (компрессорная), G', u:'мм', lo:0, hi:150, h:'Полезные размеры = внутренние − 2·G (решение ПНЕВМОТЕХ: 50–100 мм).' },
      { g:'move', k:'pass', t:'Вынос агрегата через проём и по проходу: зазор с каждой стороны', u:'мм', lo:0, hi:300 }] },
    { id:'recv', title:'Ресиверы', f:[
      { g:'recv', k:'pairSide', t:'Ресиверы парой: осмотр заднего сбоку — через промежуток не меньше', u:'мм', lo:0, hi:1000 },
      { g:'recv', k:'outGap', t:'Снаружи: от торцевой стены', u:'мм', lo:300, hi:5000 },
      { g:'recv', k:'outStep', t:'Снаружи: между ресиверами', u:'мм', lo:0, hi:3000 },
      { g:'recv', k:'pad', t:'Снаружи: площадка над землёй', u:'мм', lo:0, hi:500 },
      { g:'recv', k:'pairWall', t:'Пара ресиверов поперёк у торца: от стен — не меньше', u:'мм', lo:0, hi:600, h:'Решение владельца 19.10: часть ресиверов — в два ряда ради длины станции (как 13.10 в режиме без продольного прохода — 100 мм от стен). Пара берётся, если станция короче хотя бы на «Ресиверы парами: короче на».' },
      { g:'recv', k:'close', t:'Ресиверы и фильтры вплотную — последним приёмом, если иначе станция не в габарите перевозки (до выноса ресиверов наружу)', opt:[[1, 'да'], [0, 'нет — сразу наружу или длиннее']], h:'Решение ПНЕВМОТЕХ 12.10: вплотную друг к другу — только ресиверы и фильтры и только если иначе станция не в габарите; 14.10: «постараться разместить ресиверы внутри». С замечанием «исключение».' },
      { g:'recv', k:'upright', t:'Исполнение не указано, габариты «высота × Ø × Ø» — ресивер вертикальный (стоит)', opt:[[1, 'да — стоит'], [0, 'нет — как записаны габариты']], h:'Решение ПНЕВМОТЕХ 14.10: Dalgakiran РВ 900.16 «2200 × 1000 × 1000» без поля «Исполнение» ложился на бок. Горизонтальный — укажите в карточке «Исполнение: горизонтальный».' }] },
    { id:'vent', title:'Выброс горячего воздуха над воротами', t:'Над сервисными воротами → вверху стены над компрессором → торец у компрессора без ворот → иначе все компрессоры через крышу. В створки ворот — никогда.', f:[
      { g:'exhaust', k:'louvre', t:'Жалюзи выброса над воротами: высота', u:'мм', lo:200, hi:1500 },
      { g:'exhaust', k:'over', t:'Между воротами и жалюзи (перемычка, трубопровод)', u:'мм', lo:0, hi:1000 }] },
    { id:'cab', title:'Шкафы на стене', f:[
      { g:'cab', k:'top', t:'Верх шкафа — от пола (рукоятки на уровне глаз)', u:'мм', lo:1200, hi:2500 },
      { g:'cab', k:'low', t:'Низ шкафа — не ниже', u:'мм', lo:0, hi:1200 }] },
    { id:'tank', title:'Отсек топливного бака ДГУ', f:[
      { g:'tank', k:'pad', t:'От перегородки и торца до бака', u:'мм', lo:0, hi:1500 },
      { g:'tank', k:'gap', t:'Между баками', u:'мм', lo:0, hi:1500 },
      { g:'tank', k:'back', t:'От задней стены', u:'мм', lo:0, hi:1000 },
      { g:'tank', k:'aisle', t:'Проход перед баком — не меньше', u:'мм', lo:300, hi:2000 },
      { g:'tank', k:'part', t:'Перегородка отсека: толщина', u:'мм', lo:50, hi:500 },
      { g:'tank', k:'door', t:'Дверь отсека: ширина', u:'мм', lo:600, hi:1500 },
      { g:'tank', k:'fill', t:'Заливная горловина: высота от пола', u:'мм', lo:300, hi:2000 },
      { g:'tank', k:'gates', t:'Вход в отсек бака', opt:[[1, 'торцевые ворота'], [0, 'дверь в стене с дверью оператора']], h:'Решение ПНЕВМОТЕХ (19.10): зачастую в отсек бака — двустворчатые ворота в торце (монтаж и замена бака); дверь — шириной «Дверь отсека».' },
      { g:'tank', k:'h1', t:'Бак по объёму: высота до «большого» объёма', u:'мм', lo:500, hi:2500, h:'Габариты бака без размеров в составе — по расчётному объёму: высота и ширина — по объёму, длина — по объёму (шаг ниже), стенка — толщина листа (решение ПНЕВМОТЕХ 19.10; требует подтверждения изготовителем бака).' },
      { g:'tank', k:'h2', t:'Бак по объёму: высота больше «большого» объёма', u:'мм', lo:500, hi:2500 },
      { g:'tank', k:'big', t:'Бак по объёму: «большой» объём — больше', u:'л', lo:200, hi:20000 },
      { g:'tank', k:'w1', t:'Бак по объёму: ширина до «большого» объёма', u:'мм', lo:300, hi:2000 },
      { g:'tank', k:'w2', t:'Бак по объёму: ширина больше «большого» объёма', u:'мм', lo:300, hi:2000 },
      { g:'tank', k:'step', t:'Бак по объёму: длина — с шагом', u:'мм', lo:10, hi:500 },
      { g:'tank', k:'wall', t:'Бак по объёму: толщина стенки', u:'мм', lo:1, hi:20 },
      { g:'tank', k:'top', t:'Бак по объёму: от верха бака до потолка — не меньше', u:'мм', lo:100, hi:1500, h:'Решение владельца (19.10): бак не вытягивать в длину — выше, почти под потолок (над баком — дыхательный клапан и заливная труба), затем глубже.' },
      { g:'tank', k:'wMax', t:'Бак по объёму: глубина — не больше', u:'мм', lo:500, hi:3500, h:'С воротами в торце — до всей ширины контейнера (от стен — «От задней стены»), с дверью в стене прохода — не больше, чем оставляет проход перед баком (решение владельца 19.10).' },
      { g:'tank', k:'max', t:'Дополнительный бак в отсеке — не больше (больше — предупреждение: два бака или ёмкость вне контейнера)', u:'л', lo:500, hi:20000, h:'4 500 л — бак 3 000 × 1 000 × 1 500 мм, больше в отсек блок-контейнера не встаёт.' }] },
    { id:'dgu', title:'ДГУ в контейнере', t:'Решения ПНЕВМОТЕХ (19.10): радиатор — вплотную к жалюзи в торце, у каждой ДГУ — свой выброс горячего воздуха и свой выхлоп.', f:[
      { g:'dgu', k:'rad', t:'От радиатора до жалюзи (дверь-жалюзи)', u:'мм', lo:0, hi:1000 },
      { g:'dgu', k:'rot', t:'Поворот ДГУ на 90° (радиатор — к задней стене)', opt:[[1, 'когда компоновка лучше'], [0, 'нет']] },
      { g:'dgu', k:'two', t:'Две ДГУ без бака', opt:[[1, 'по одной у каждого торца, радиаторами наружу'], [0, 'как остальные']] },
      { g:'dgu', k:'across', t:'Поперёк (радиаторами к задней стене) — от', u:'шт.', lo:2, hi:10, h:'Столько ДГУ и больше (и две с дополнительным баком) — поперёк контейнера, у каждой — жалюзи в задней стене.' },
      { g:'dgu', k:'pass', t:'ДГУ вдоль — посередине ширины: проход с каждой стороны не меньше', u:'мм', lo:200, hi:1500, h:'Решение владельца (19.10): ДГУ — посередине, отступы уменьшены. ПУЭ, п. 4.1.23: проход у щитов — не менее 0,8 м (0,6 м — сужение конструкциями); у ДГУ — по решению ПНЕВМОТЕХ.' },
      { g:'dgu', k:'convGap', t:'Конвекторы у ДГУ: между ними', u:'мм', lo:0, hi:2000 },
      { g:'dgu', k:'convEdge', t:'Конвекторы у ДГУ: от угла стены', u:'мм', lo:0, hi:1000 },
      { g:'dgu', k:'convFront', t:'Конвекторы у ДГУ: свободно перед ними', u:'мм', lo:0, hi:2000 }] },
    { id:'conv', title:'Конвекторы отопления', f:[
      { g:'conv', k:'z', t:'Низ конвектора от пола', u:'мм', lo:0, hi:1000 },
      { g:'conv', k:'gap', t:'Между конвекторами', u:'мм', lo:0, hi:2000 },
      { g:'conv', k:'edge', t:'От угла стены', u:'мм', lo:0, hi:1000 },
      { g:'conv', k:'front', t:'Свободно перед конвектором (оборудование не ближе)', u:'мм', lo:0, hi:2000 }] },
    { id:'pick', title:'Подбор оборудования в станцию', t:'Как программа подбирает компрессоры, осушители, фильтры и ресиверы из каталога («Подобрать станцию», «Решить автоматически»).', f:[
      { g:'pick', k:'max', t:'Одинаковых рабочих агрегатов или аппаратов параллельно — не больше', u:'шт.', lo:1, hi:8, h:'Одного не хватает по производительности или он не помещается — несколько одинаковых (решение ПНЕВМОТЕХ). Больше — подсказка разделить станцию.' },
      { g:'pick', k:'over', t:'Подбор «чтобы поместилось»: запас производительности — не больше', u:'%', lo:0, hi:100, h:'Когда станция из одного большого агрегата не встаёт и программа берёт несколько меньших — их сумма не больше нужной + этот запас (иначе берётся слишком мощное).' },
      { g:'pick', k:'recvFit', t:'Ресивер внутри: над ним на арматуру (клапан, манометр, отвод) — не меньше', u:'мм', lo:0, hi:1000, h:'Высота ресивера + это значение — не выше помещения; иначе берётся ниже ресивер или 500 л.' },
      { g:'pick', k:'dryerFit', t:'Осушитель: над ним на подключение — не меньше', u:'мм', lo:0, hi:1000 },
      { g:'pick', k:'recvFree', t:'Ресиверов без учёта в Ростехнадзоре (p·V ≤ 1,0) вместо одного — не больше', u:'шт.', lo:1, hi:20, h:'Подбор «на объём», когда нет ресиверов базового объёма: сначала несколько без учёта, затем любые.' },
      { g:'pick', k:'recvAny', t:'Ресиверов любых (с учётом) на нужный объём — не больше', u:'шт.', lo:1, hi:20 },
      { g:'pick', k:'oneSup', t:'Один поставщик: допуск по запасу производительности', u:'%', lo:0, hi:50, h:'При равных условиях — оборудование того же поставщика, что и компрессоры (решение 17.10): подходит без недобора, столько же штук, запас больше лучшего не больше чем на это значение. Компрессоры — того, у кого есть и осушитель, и фильтры. Ресиверы — по-прежнему сначала АСО. 0 — без приоритета поставщика.' }] },
    { id:'shell', title:'Конструкция контейнера', t:'Толщины стен, пола и кровли сверх утеплителя: из них — внутренние размеры по наружным и наоборот. Утеплитель — в карточке контейнера.', f:[
      { g:'shell', k:'ins', t:'Утеплитель стен и кровли, если в карточке контейнера не указан', u:'мм', lo:0, hi:300 },
      { g:'shell', k:'blockWall', t:'Блок-контейнер: стена сверх утеплителя (обшивка, каркас)', u:'мм', lo:0, hi:200 },
      { g:'shell', k:'blockFloor', t:'Блок-контейнер: пол (рама, лаги, лист)', u:'мм', lo:50, hi:500 },
      { g:'shell', k:'blockRoof', t:'Блок-контейнер: кровля сверх утеплителя', u:'мм', lo:0, hi:300 },
      { g:'shell', k:'weldWall', t:'Цельносварной: стена сверх утеплителя', u:'мм', lo:0, hi:200 },
      { g:'shell', k:'weldFloor', t:'Цельносварной: пол', u:'мм', lo:50, hi:500 },
      { g:'shell', k:'weldRoof', t:'Цельносварной: кровля сверх утеплителя', u:'мм', lo:0, hi:300 },
      { g:'shell', k:'northWall', t:'«Север»: стена сверх утеплителя', u:'мм', lo:0, hi:200 },
      { g:'shell', k:'northFloor', t:'«Север»: пол', u:'мм', lo:50, hi:500 },
      { g:'shell', k:'northRoof', t:'«Север»: кровля сверх утеплителя', u:'мм', lo:0, hi:300 },
      { g:'shell', k:'tambour', t:'«Север»: тамбур у двери (оборудование там не ставится)', u:'мм', lo:0, hi:3000 },
      { g:'shell', k:'seaLining', t:'Морской контейнер: обшивка поверх утеплителя', u:'мм', lo:0, hi:100 },
      { g:'shell', k:'seaFloor', t:'Морской контейнер: утеплённый пол поверх штатного', u:'мм', lo:0, hi:300 },
      { g:'shell', k:'gable', t:'Двускатная крыша: уклон', u:'°', lo:0, hi:30 },
      { g:'shell', k:'mono', t:'Односкатная крыша: уклон', u:'°', lo:0, hi:30 }] },
    { id:'pipe', title:'Трубопровод и малые насосы', f:[
      { g:'pipe', k:'airY', t:'Линия сжатого воздуха: ось — от задней стены', u:'мм', lo:50, hi:600 },
      { g:'pipe', k:'pad', t:'Фильтр на трубопроводе: зазор вокруг', u:'мм', lo:0, hi:300 },
      { g:'pipe', k:'outGap', t:'Выход трубопровода: от проёма (ворота, двери, шкаф) — не ближе', u:'мм', lo:0, hi:1000, h:'Решение владельца 19.10: выход в дальнем торце попадает в ворота или дверь — переносится на ближайшую свободную стену.' },
      { g:'pipe', k:'outEdge', t:'Выход трубопровода на стене: от торца — не ближе', u:'мм', lo:100, hi:2000 },
      { g:'pipe', k:'flange', t:'Патрубок с фланцем снаружи: выступ от стены', u:'мм', lo:50, hi:500 },
      { g:'pumps', k:'kw', t:'Малый насос (у стены, по два на раме): мощность — не больше', u:'кВт', lo:0, hi:200, h:'СП 31.13330.2021, п. 10.15: малые насосы (до 1000 В, нагнетательный патрубок до DN 100) — у стены и по два на общей раме без прохода, вокруг — 0,7 м.' },
      { g:'pumps', k:'len', t:'Малый насос: длина — не больше', u:'мм', lo:300, hi:3000 },
      { g:'pumps', k:'back', t:'Малый насос: сзади — рекомендуется', u:'мм', lo:0, hi:2000 },
      { g:'pumps', k:'backMin', t:'Малый насос: сзади — допустимо', u:'мм', lo:0, hi:2000 },
      { g:'pumps', k:'side', t:'Малый насос: сбоку — рекомендуется', u:'мм', lo:0, hi:2000 },
      { g:'pumps', k:'sideMin', t:'Малый насос: сбоку — допустимо', u:'мм', lo:0, hi:2000 },
      { g:'pumps', k:'top', t:'Малый насос: сверху — рекомендуется', u:'мм', lo:0, hi:2000 },
      { g:'pumps', k:'topMin', t:'Малый насос: сверху — допустимо', u:'мм', lo:0, hi:2000 }] },
    { id:'grille', title:'Жалюзи притока и выброса, маркизы', t:'Размеры и места жалюзи на стенах: размер — по расчёту вентиляции (правила vent.*), здесь — пределы, шаг и отступы.', f:[
      { g:'grille', k:'step', t:'Размеры жалюзи — кратно', u:'мм', lo:10, hi:200 },
      { g:'grille', k:'gap', t:'Между жалюзи на стене — не меньше', u:'мм', lo:0, hi:1000 },
      { g:'grille', k:'near', t:'Оборудование ближе к стене — место на стене перед ним занято', u:'мм', lo:0, hi:2000 },
      { g:'grille', k:'inZ', t:'Приток: низ жалюзи от пола', u:'мм', lo:0, hi:1500 },
      { g:'grille', k:'inHmin', t:'Приток: высота — не меньше', u:'мм', lo:100, hi:2000 },
      { g:'grille', k:'inHmax', t:'Приток: высота — не больше', u:'мм', lo:200, hi:2500 },
      { g:'grille', k:'inWmin', t:'Приток: ширина — не меньше', u:'мм', lo:100, hi:2000 },
      { g:'grille', k:'inWmax', t:'Приток: ширина — не больше', u:'мм', lo:200, hi:3000 },
      { g:'grille', k:'lift', t:'Приток над конвектором (внизу места нет): низ от пола', u:'мм', lo:0, hi:2000 },
      { g:'grille', k:'outTop', t:'Вытяжка: верх ниже потолка (под кабельным лотком)', u:'мм', lo:0, hi:1000 },
      { g:'grille', k:'outHmin', t:'Вытяжка: высота — не меньше', u:'мм', lo:100, hi:2000 },
      { g:'grille', k:'outHmax', t:'Вытяжка: высота — не больше', u:'мм', lo:200, hi:2500 },
      { g:'grille', k:'outWmin', t:'Вытяжка: ширина — не меньше', u:'мм', lo:100, hi:2000 },
      { g:'grille', k:'outWmax', t:'Вытяжка: ширина — не больше', u:'мм', lo:200, hi:3000 },
      { g:'grille', k:'whole', t:'Одним проёмом — до ширины (больше — несколько одинаковых)', u:'мм', lo:500, hi:6000 },
      { g:'grille', k:'maxn', t:'Одинаковых проёмов на поток — не больше', u:'шт.', lo:1, hi:12 },
      { g:'grille', k:'piece', t:'Добавочные жалюзи (остаток сечения) — не уже', u:'мм', lo:100, hi:2000 },
      { g:'grille', k:'fanMin', t:'Проём вытяжного вентилятора — не меньше', u:'мм', lo:200, hi:1500, h:'Осевой вентилятор — от Ø 400 мм.' },
      { g:'grille', k:'roofHood', t:'Колпак выброса на крыше: высота над крышей', u:'мм', lo:100, hi:1500 },
      { g:'grille', k:'hoodSide', t:'Маркиза шире жалюзи с каждой стороны на', u:'мм', lo:0, hi:500 },
      { g:'grille', k:'hoodLap', t:'Закрытая маркиза перекрывает рамку сверху и снизу на', u:'мм', lo:0, hi:300 },
      { g:'grille', k:'hoodAng0', t:'Маркиза: угол открытия от стены — не меньше', u:'°', lo:5, hi:60 },
      { g:'grille', k:'hoodAng1', t:'Маркиза: угол открытия от стены — не больше', u:'°', lo:30, hi:90 },
      { g:'grille', k:'hoodLow', t:'Маркиза: закрытая — не ниже от пола', u:'мм', lo:0, hi:1000 },
      { g:'grille', k:'hoodGap', t:'Маркиза: от проёма двери или ворот — не ближе (сверх обычного)', u:'мм', lo:0, hi:1500 },
      { g:'grille', k:'radV', t:'Жалюзи радиатора ДГУ: скорость воздуха больше — предупреждение', u:'м/с', lo:2, hi:20, h:'Выше — проверить по паспорту ДГУ (расход воздуха радиатора, допустимое сопротивление).' }] },
    { id:'mass', title:'Масса станции и строповка', t:'Масса контейнера — оценка (у морского — тара по ISO 668); оборудование — по паспорту. Строповка — по ТОИ Р-66-18-93, ISO 3874.', f:[
      { g:'mass', k:'frame', t:'Рама блок-контейнера', u:'кг/м', lo:0, hi:1000 },
      { g:'mass', k:'pBlock', t:'Стены и кровля блок-контейнера (сэндвич-панели 100 мм)', u:'кг/м²', lo:0, hi:200 },
      { g:'mass', k:'pNorth', t:'Стены и кровля «Север»', u:'кг/м²', lo:0, hi:200 },
      { g:'mass', k:'pWelded', t:'Стены и кровля цельносварного (профлист с каркасом)', u:'кг/м²', lo:0, hi:200 },
      { g:'mass', k:'lining', t:'Утепление и обшивка морского контейнера изнутри', u:'кг/м²', lo:0, hi:100 },
      { g:'mass', k:'floor', t:'Пол: рифлёный лист на лагах', u:'кг/м²', lo:0, hi:300 },
      { g:'mass', k:'otherK', t:'Трубопровод, кабели, системы: доля массы оборудования', u:'доля', lo:0, hi:0.5 },
      { g:'mass', k:'otherKg', t:'Трубопровод, кабели, системы: постоянная часть', u:'кг', lo:0, hi:2000 },
      { g:'mass', k:'tare10', t:'Тара морского 10 футов', u:'кг', lo:500, hi:5000 },
      { g:'mass', k:'tare20', t:'Тара морского 20 футов', u:'кг', lo:1000, hi:6000 },
      { g:'mass', k:'tare20hc', t:'Тара морского 20 футов HC', u:'кг', lo:1000, hi:6000 },
      { g:'mass', k:'tare40', t:'Тара морского 40 футов', u:'кг', lo:2000, hi:8000 },
      { g:'mass', k:'tare40hc', t:'Тара морского 40 футов HC', u:'кг', lo:2000, hi:8000 },
      { g:'mass', k:'angle', t:'Угол ветви стропа с вертикалью — не больше', u:'°', lo:10, hi:60, h:'ТОИ Р-66-18-93: между ветвями — не более 90°.' },
      { g:'mass', k:'lugL', t:'Точка строповки от торца', u:'мм', lo:0, hi:1000 },
      { g:'mass', k:'lugW', t:'Точка строповки от боковой стены', u:'мм', lo:0, hi:1000 },
      { g:'mass', k:'beamL', t:'Блок-контейнер длиннее — строповка с траверсой', u:'мм', lo:2000, hi:20000 },
      { g:'mass', k:'beamZ', t:'Траверса: ветви от точек строповки до неё', u:'мм', lo:500, hi:6000 },
      { g:'mass', k:'beamTop', t:'Траверса: от неё до крюка', u:'мм', lo:500, hi:6000 },
      { g:'mass', k:'sprZ', t:'Морской — рамная траверса: высота рамы над крышей', u:'мм', lo:500, hi:6000 },
      { g:'mass', k:'sprD', t:'Рамная траверса: проушины от центра тяжести', u:'мм', lo:0, hi:6000 },
      { g:'mass', k:'sprTop', t:'Рамная траверса: от неё до крюка', u:'мм', lo:500, hi:6000 }] },
    { id:'light', title:'Освещение, электрика, топливо', t:'Освещённость и запас — правило norm.lux; здесь — светильники и прочие потребители.', f:[
      { g:'light', k:'plane', t:'Рабочая плоскость над полом', u:'мм', lo:0, hi:1500 },
      { g:'light', k:'lampW', t:'Светильник помещения: мощность', u:'Вт', lo:1, hi:500 },
      { g:'light', k:'lampLm', t:'Светильник помещения: световой поток', u:'лм', lo:100, hi:50000 },
      { g:'light', k:'lampLen', t:'Светильник помещения: длина', u:'мм', lo:100, hi:3000 },
      { g:'light', k:'small', t:'Светильник в отсеке бака и тамбуре (IP65)', u:'Вт', lo:1, hi:200 },
      { g:'light', k:'flood', t:'Прожектор над дверью снаружи', u:'Вт', lo:1, hi:500 },
      { g:'light', k:'exit', t:'Табло «Выход» с аккумулятором', u:'Вт', lo:0, hi:50 },
      { g:'light', k:'fuelPump', t:'Насос перекачки топлива ДГУ: подача (для диаметра топливопровода)', u:'м³/ч', lo:0.1, hi:50 }] },
    { id:'power', title:'Электрические нагрузки и розетки', t:'Мощности потребителей станции, если в составе их нет (по паспорту — важнее), коэффициенты спроса розеток, число и высота розеток. Ток и вводной автомат — правила el.*.', f:[
      { g:'power', k:'dryerK', t:'Рефрижераторный осушитель без паспортной мощности: кВт на 1 м³/мин', u:'кВт', lo:0, hi:2 },
      { g:'power', k:'dryerMin', t:'Рефрижераторный осушитель без паспортной мощности — не меньше', u:'кВт', lo:0, hi:20 },
      { g:'power', k:'dryerAds', t:'Адсорбционный осушитель без паспортной мощности (управление, клапаны)', u:'кВт', lo:0, hi:20 },
      { g:'power', k:'dguHeat', t:'Подогреватель двигателя ДГУ', u:'кВт', lo:0, hi:20 },
      { g:'power', k:'dguHeatBig', t:'Подогреватель двигателя ДГУ большой мощности', u:'кВт', lo:0, hi:30 },
      { g:'power', k:'dguHeatKw', t:'ДГУ большой мощности — больше', u:'кВт', lo:10, hi:5000 },
      { g:'power', k:'charger', t:'Зарядное устройство АКБ ДГУ', u:'кВт', lo:0, hi:5 },
      { g:'power', k:'fuelPumpKw', t:'Насос перекачки топлива', u:'кВт', lo:0, hi:10 },
      { g:'power', k:'s230', t:'Розетки 230 В (группа 16 А): мощность', u:'кВт', lo:0, hi:20 },
      { g:'power', k:'s230k', t:'Розетки 230 В: коэффициент спроса', u:'доля', lo:0, hi:1 },
      { g:'power', k:'s380', t:'Розетка 380 В 16 А: мощность', u:'кВт', lo:0, hi:50 },
      { g:'power', k:'s380k', t:'Розетка 380 В: коэффициент спроса', u:'доля', lo:0, hi:1 },
      { g:'power', k:'ytp', t:'Ящик ЯТП-0,25 (36 В): мощность', u:'кВт', lo:0, hi:5 },
      { g:'power', k:'ytpK', t:'Ящик ЯТП-0,25: коэффициент спроса', u:'доля', lo:0, hi:1 },
      { g:'power', k:'valves', t:'Клапаны вентиляции с электроприводами', u:'кВт', lo:0, hi:5 },
      { g:'power', k:'ops', t:'Щит ОПС и пожаротушения', u:'кВт', lo:0, hi:5 },
      { g:'power', k:'asu', t:'Шкаф АСУ ТП', u:'кВт', lo:0, hi:10 },
      { g:'power', k:'sockStep', t:'Розетки 230 В: по одной на каждые … длины помещения', u:'мм', lo:1000, hi:20000 },
      { g:'power', k:'sockMin', t:'Розетки 230 В — не меньше', u:'шт.', lo:1, hi:10 },
      { g:'power', k:'sock380', t:'Розетки 380 В у основного оборудования', u:'шт.', lo:0, hi:10 },
      { g:'power', k:'sockZ', t:'Розетки: высота от пола', u:'мм', lo:300, hi:2000 }] },
    { id:'fire', title:'Пожаротушение и огнетушители', t:'Модуль порошкового пожаротушения «Буран-2,5» — по паспорту (СП 485.1311500.2020): защищаемая площадь и объём, высота установки, коэффициенты.', f:[
      { g:'fire', k:'modArea', t:'Модуль: защищаемая площадь', u:'м²', lo:1, hi:100 },
      { g:'fire', k:'modVolA', t:'Модуль: защищаемый объём, пожар класса A', u:'м³', lo:1, hi:200 },
      { g:'fire', k:'modVolB', t:'Модуль: защищаемый объём, пожар класса B', u:'м³', lo:1, hi:200 },
      { g:'fire', k:'modSide', t:'Модуль: сторона квадрата распыла (шаг модулей)', u:'мм', lo:500, hi:10000 },
      { g:'fire', k:'modZ0', t:'Модуль: высота установки — не ниже (ниже — замечание)', u:'мм', lo:1000, hi:6000 },
      { g:'fire', k:'modZ1', t:'Модуль: высота установки — не выше', u:'мм', lo:1000, hi:10000 },
      { g:'fire', k:'k1', t:'k1 — неравномерность распыла', u:'доля', lo:0.5, hi:3 },
      { g:'fire', k:'k3', t:'k3 — по огнетушащей способности для горючего', u:'доля', lo:0.5, hi:3, h:'СП 485, табл. И.1: дизельное топливо — 0,9, масло — 0,8; 1,0 — с запасом.' },
      { g:'fire', k:'k4', t:'k4 — по способу тушения', u:'доля', lo:0.5, hi:3 },
      { g:'fire', k:'shadeH', t:'Затеняет распыл агрегат выше', u:'мм', lo:0, hi:3000 },
      { g:'fire', k:'shadeGap', t:'Затенённая зона за агрегатом — если до стены не меньше', u:'мм', lo:0, hi:2000 },
      { g:'fire', k:'ext', t:'Огнетушитель: верх — не выше от пола', u:'мм', lo:500, hi:2500, h:'Правила противопожарного режима в РФ: не выше 1,5 м.' }] },
    { id:'mods', title:'Станция из нескольких модулей', t:'Решение владельца (19.10): модули стыкуются на объекте бок о бок и торец к торцу в одно помещение; раскладку выбирает менеджер (кнопка «Модули…» в «Компоновке»).', f:[
      { g:'mods', k:'max', t:'Модулей в станции — не больше (больше — по запросу)', u:'шт.', lo:2, hi:30 },
      { g:'mods', k:'post', t:'Стойка каркаса на пересечении стыков внутри помещения', u:'мм', lo:0, hi:600, h:'Только у раскладок в два и больше ряда по длине и ширине: оборудование её обходит.' },
      { g:'mods', k:'wMin', t:'Ширина модуля — не меньше', u:'мм', lo:1500, hi:2550, h:'Решение владельца 19.10: модули одинаковой ширины от 2 448 до 2 550 мм (не шире габарита перевозки); длина модуля — до наибольшей длины перевозки.' },
      { g:'mods', k:'wMax', t:'Ширина модуля — не больше', u:'мм', lo:1500, hi:2550 },
      { g:'mods', k:'lMin', t:'Длина модуля — не меньше', u:'мм', lo:2000, hi:12000, h:'Решение владельца 19.10: в станции из нескольких модулей модуль — не короче 7 м (короткие модули нежизнеспособны).' }] },
    { id:'look', title:'Аккуратность компоновки', t:'Решение владельца (19.10): ряды — по одной лицевой линии, одинаковые агрегаты — с равным шагом, проёмы — по общим линиям, из равных по площади вариантов — аккуратнейший.', f:[
      { g:'look', k:'align', t:'Лицевая линия ряда: агрегат отступает от стены дальше — не больше', u:'мм', lo:0, hi:1500, h:'Агрегаты ряда встают лицом к проходу по одной линии, если для этого отступить от стены не больше этого числа (0 — не выравнивать).' },
      { g:'look', k:'even', t:'Одинаковые агрегаты подряд', opt:[[1, 'с равными промежутками'], [0, 'как вышло']] },
      { g:'look', k:'lines', t:'Проёмы на стене', opt:[[1, 'по общим линиям (верх выброса, низ притока, ворота одной высоты)'], [0, 'как вышло']] },
      { g:'look', k:'modStep', t:'Станция из модулей: модуль длиннее ради стыка между группами оборудования — не больше', u:'шагов по 100 мм', lo:0, hi:5, h:'Стык — между компрессорами и подготовкой воздуха, массы модулей ближе; 0 — модуль наименьшей длины.' },
      { g:'look', k:'tidy', t:'Из вариантов равной площади', opt:[[1, 'брать аккуратнейший'], [0, 'первый найденный']] }] },
    { id:'muffler', title:'Глушитель ДГУ на крыше', t:'Над ДГУ; выхлоп — в сторону, не вверх; съёмный для перевозки.', f:[
      { g:'muffler', k:'gap', t:'Опоры: от крыши до глушителя', u:'мм', lo:0, hi:1000 },
      { g:'muffler', k:'outlet', t:'Вывод выхлопа вбок', u:'мм', lo:0, hi:1500 }] },
  ];
  // готовые наборы: меняют только стратегию подбора — как подбирать размер и пороги
  // вариантов; нормы отступов и проходов (рекомендуемые и допустимые) не трогают
  static PRESETS = [
    { id:'max', title:'Максимально плотно', t:'Самая маленькая станция: два ряда, ресиверы поперёк и без продольного прохода — при любом выигрыше по площади или длине.',
      v:{ 'fit.dense':1, 'fit.two':0, 'fit.recv2':0, 'fit.ends':0, 'modes.ends':1, 'modes.tight':1, 'modes.cross':1 } },
    { id:'def', title:'Плотно — по умолчанию', t:'Допустимые отступы и проход; два ряда — при выигрыше 25 %, без продольного прохода — 10 %, ресиверы поперёк — если короче на 1 м.',
      v:null },
    { id:'wide', title:'Просторно', t:'Сначала рекомендуемые отступы и проход 1 000 мм; два ряда и без продольного прохода — только при большом выигрыше (40 % и 30 %).',
      v:{ 'fit.dense':0, 'fit.two':40, 'fit.recv2':2000, 'fit.ends':30, 'modes.ends':1, 'modes.tight':1, 'modes.cross':1 } }];
  /** значения набора: «g.k» → число (по умолчанию — из StationMatrix.DEF) */
  static preset(id){ const P=this.PRESETS.find(p=>p.id===id); if (!P) return null; const keys=Object.keys((this.PRESETS[0]||{}).v||{}), D=StationMatrix.DEF;
    return Object.fromEntries(keys.map(k=>{ const [g, f]=k.split('.'); return [k, P.v ? P.v[k] : D[g][f]]; })); }
  /** какой набор совпадает с матрицей M (или null — свои значения) */
  static which(M){ for (const P of this.PRESETS){ const v=this.preset(P.id); if (Object.entries(v).every(([k, x])=>{ const [g, f]=k.split('.'); return +M[g][f]===+x; })) return P; } return null; }
  static _f = null;
  /** все поля: «g.k» → поле (флажки «да/нет» — пределы 0…1) */
  static all(){
    if (!this._f){ this._f=new Map(); for (const s of this.SECTIONS) for (const f of s.f){ if (f.opt===null) f.opt=this.ON; if (f.opt){ f.lo=0; f.hi=1; } this._f.set(f.g+'.'+f.k, f); } }
    return this._f;
  }
  static field(g, k){ return this.all().get(g+'.'+k) || null; }
  /** значение для показа: «2 550 мм», «да», «0,75» */
  static show(f, v){ if (f.opt) return ((f.opt.find(o=>o[0]===+v) || [0, String(v)])[1]); return String(v).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ')+(f.u && f.u!=='доля' ? ' '+f.u : ''); }
}

// ---------------------------------------------------------------- свод правил компоновки (действующие значения)
// Один текст «как программа компонует станцию» — из действующих правил (матрица расстановки, проходы, отступы): в
// «Настройках» над формой правил, во вкладке «Компоновка» станции («Как расставляется оборудование») и в документе
// «Инженерные правила и источники». Решения ПНЕВМОТЕХ — .claude/rules/60-stations.md, раздел «Свод правил компоновки».
class LayoutDigest {
  static n(v){ return StationLayout.n(v); }
  /** [{h — раздел, items — пункты текстом}] */
  static sections(){
    const n=v=>this.n(v), F=StationMatrix.fit(), M=StationMatrix.modes(), D=StationMatrix.door(), Gt=StationMatrix.gate(), Sv=StationMatrix.service(), A=StationMatrix.access();
    const X=StationMatrix.exits(), R=StationMatrix.recv(), [aRec, aMin]=StationClear.aisle(), L=k=>(StationEquip.LABEL[k]||k).toLowerCase();
    const no=(StationMatrix.M.sides.rows||[]).filter(r=>r.door===false).map(r=>L(r.kind));
    const OF={ compressor:'ширина компрессора', dryer:'ширина осушителя', receiver:'Ø ресивера', pump:'ширина насоса', filter:'ширина фильтра' };
    const pr=(StationMatrix.M.pair.rows||[]).map(r=>`${L(r.a)} ↔ ${L(r.b)} — ${r.k ? `max(${n(r.base)}; ${String(r.k).replace('.', ',')} × ${OF[String(r.of||'').split('.')[0]]||'размер'})` : n(r.base)}, плотно — ${n(r.min)} мм${r.close ? ', вплотную — последним приёмом (исключение)' : ''}`);
    const wl=(StationMatrix.M.wall.rows||[]).map(r=>`${L(r.kind)} — ${r.k ? `max(${n(r.base)}; ${String(r.k).replace('.', ',')} × глубина)` : n(r.base)}, плотно — ${n(r.tight)} мм`);
    const order=['без сервисных ворот и дверей, с доступом ко всем сторонам агрегатов (отступ сзади важнее прохода шире допустимого)',
      `с сервисными воротами за агрегатом${M.ends ? ` или без продольного прохода (если площадь меньше хотя бы на ${n(F.ends)} %)` : ''} — что меньше`,
      ...(M.tight ? [`проход оператора «в крайнем случае» — ${n(StationLayout.TIGHT)} мм`] : []),
      ...(M.cross ? ['агрегат поперёк лицом к входу, вторая дверь оператора за ним'] : []),
      F.wide ? `негабарит — шире ${n(F.roadW)} мм (до ${n(F.maxW)} мм), с предупреждением` : `негабарит отключён — ошибка «разделите станцию на два модуля»`];
    const T=StationMatrix.grp('look'), Md=StationMods.M, Dg=StationMatrix.grp('dgu'), Tk=StationMatrix.grp('tank'), Cv=StationMatrix.grp('conv'), Pp=StationMatrix.grp('pipe'), Cb=StationMatrix.grp('cab');
    const ws=StationMods.widths();
    return [
      { h:'1. Цель и порядок подбора', items:[
        `Цель — станция в габарите перевозки без спецразрешения: ширина до ${n(F.roadW)} мм, длина до ${n(F.maxL)} мм. Негабарит — только исключение, последним.`,
        `Блок-контейнер — по оборудованию, без запаса: шаг ${n(F.step)} мм, наименьшая площадь пола; ${F.dense ? 'плотно — по допустимым отступам и проходу, свободное место раздаётся до рекомендуемых' : 'сначала рекомендуемые отступы, затем допустимые'}.`,
        `Варианты по порядку (в ширине перевозки): ${order.map((t, i)=>`${i+1}) ${t}`).join('; ')}.`,
        `Приёмы уплотнения по порядку: допустимые отступы → поворот агрегата на 90° (где разрешён) → ресиверы в два ряда → ресиверы и фильтры вплотную (последним, ${R.close ? 'с замечанием «исключение»' : 'выключено'}) → без прохода у торца.`,
        `Два ряда оборудования — если площадь меньше одного ряда хотя бы на ${n(F.two)} %; ресиверы парами поперёк у торца — если станция короче хотя бы на ${n(F.recv2)} мм.`,
        `Из вариантов равной площади — ${T.tidy ? 'аккуратнейший (оценка в «Компоновке»)' : 'первый найденный'}. Высота внутри — не ниже ${n(F.hWalk)} мм; жалюзи не встают — длиннее до ${n(F.growVent)} мм, конвекторам нет места — до ${n(F.growHeat)} мм.`] },
      { h:'2. Проход и отступы', items:[
        `Проход оператора внутри — всегда (станций «только с сервисными дверями» нет): рекомендуется ${n(aRec)} мм, допустимо ${n(aMin)} мм${M.tight ? `, в крайнем случае ${n(StationLayout.TIGHT)} мм` : ''}.`,
        `Между соседями по длине: ${pr.join('; ')}.`,
        `От стены за агрегатом: ${wl.join('; ')}.`,
        `К боку агрегата у торца — проход не меньше ${n(A.side)} мм; сзади меньше ${n(A.back)} мм — обслуживание через сервисные ворота.`,
        `Зазор на коммуникации у стен и под потолком — ${n(StationMatrix.gap())} мм.`] },
      { h:'3. Аккуратность', items:[
        `Ряд — по одной лицевой линии, где это ничего не ухудшает: к стене агрегат отходит до рекомендуемого отступа сзади, к проходу — только если проход не уже рекомендуемого; сдвиг до ${n(T.align)} мм.`,
        `${T.even ? 'Одинаковые агрегаты подряд — с равными промежутками.' : 'Промежутки одинаковых — как вышло.'} ${T.lines ? 'Сервисные ворота на стене — одной высоты; жалюзи выброса — по общему верху, притока — по общему низу; конвекторы на участке стены — с равным шагом.' : ''}`,
        'Магистраль — на одной высоте; выходы одинаковых аппаратов — на одной высоте; шкафы на стене — по одной линии верха.'] },
      { h:'4. Двери и выходы', items:[
        `Дверь оператора — всегда, одностворчатая ${n(D.w)} × ${n(D.h)} мм в свету, наружу, с доводчиком внутри; над ней — козырёк и прожектор, над выходом — табло «Выход».`,
        `Дверь оператора — одна; вторая — если от дальней точки помещения до выхода больше ${n(X.far)} мм или ряд шкафов длиннее 7 м (ПУЭ, п. 4.1.23). Выходы — дверь оператора, ворота в торце (если перед ними не ресиверы парой) и дверь-жалюзи ДГУ.`,
        `Между проёмами на одной стене — не меньше ${n(D.gap)} мм, от края станции — не меньше ${n(D.edge)} мм; две двери — не ближе ${n(X.dist)} мм друг к другу, где позволяет длина.`] },
      { h:'5. Ворота в торце', items:[
        `Монтажные распашные ворота — всегда в торце (у компрессорной и насосной), по оси торца: ширина = агрегат + ${n(Gt.addW)} мм (не уже ${n(Gt.minW)} мм; во весь торец, если занимают ${String(Gt.full).replace('.', ',')} его ширины).`,
        `Высота — по самому высокому оборудованию + ${n(Gt.addH)} мм, в обоих торцах одинаковая, не ниже ${n(Gt.minH)} мм; ворота в обоих торцах — если цепочка длиннее ${n(Gt.twoAt)} мм или агрегат иначе не провезти.`] },
      { h:'6. Сервисные ворота', items:[
        `Только если агрегат стоит плотно к стене (сзади меньше ${n(A.back)} мм) и иначе его не обслужить: ширина = агрегат + ${n(Sv.addW)} мм (${n(Sv.min)}–${n(Sv.max)} мм), высота = агрегат + ${n(Sv.addH)} мм (не ниже ${n(Sv.minH)} мм); на одной стене — одной высоты.`,
        no.length ? `Не делаются: ${no.join(', ')} — монтаж и демонтаж через ворота в торце.` : 'Делаются любому виду, стоящему плотно к стене.'] },
      ...(M.ends ? [{ h:'7. Без продольного прохода (компрессорная)', items:[
        'Компрессор у торца по середине ширины: сервисные ворота спереди и сзади, ворота в этом торце; несколько — рядом в ряд от торца, между ними и за последним — не меньше '+n(M.next)+' мм, дверь оператора — между компрессорами и за последним.',
        `Ресиверы — парами поперёк у дальнего торца с воротами там; приток — допускается в створках торцевых ворот. Так — только если с проходом не встаёт в габарит (площадь меньше хотя бы на ${n(F.ends)} %).`] }] : []),
      { h:'8. Ресиверы, осушители, фильтры', items:[
        `Ресиверы — внутри станции, число — наименьшее допустимое по методике: 900 л → по 500 л (без учёта в Ростехнадзоре) → вплотную; наружу (площадка у торца, ФНП ОРПД, п. 65) — только если внутри не встают.`,
        `Два ряда: пара один за другим или парами поперёк у торца — от стен не меньше ${n(R.pairWall)} мм, промежуток в паре — по «Ресивер ↔ ресивер», осмотр заднего — через промежуток не меньше ${n(R.pairSide)} мм.`,
        R.upright ? 'Ресивер без указанного исполнения с габаритами «высота × Ø × Ø» — вертикальный.' : 'Ресивер без указанного исполнения — как записаны габариты.',
        'Осушитель не проходит по высоте или в плане — два меньших параллельно; фильтры — на трубопроводе по ступеням (до и после осушителя), у осушителя — байпас.'] },
      { h:'9. Трубопровод', items:[
        `Магистраль — вдоль задней стены (ось в ${n(Pp.airY)} мм), по ходу воздуха: компрессоры → аппараты (один вход, один выход) → выход; одинаковые аппараты — параллельно.`,
        `Выход — через дальний торец; в торце на высоте трубы ворота, дверь или дверь-жалюзи ДГУ — на ближайшую свободную стену (от проёма не ближе ${n(Pp.outGap)} мм, от торца ${n(Pp.outEdge)} мм) или над проёмом; снаружи — патрубок ${n(Pp.flange)} мм с фланцем.`] },
      { h:'10. Вентиляция', items:[
        'Выброс горячего воздуха: над сервисными воротами → вверху стены над компрессором → торец у компрессора без ворот → иначе все компрессоры через крышу каналами одного размера. Решётки компрессоров — одного размера у всех; общая вытяжка — у осушителя, своего размера.',
        'Приток — никогда на стене выброса и никогда в створках ворот выброса; одним проёмом, иначе наименьшим числом одинаковых; допускается в створках торцевых и сервисных ворот; не встаёт — приточные вентиляторы, при выбросе на стене — выброс через крышу (исключение).'] },
      { h:'11. Шкафы и отопление', items:[
        `Шкафы — на стене прохода (верх ${n(Cb.top)} мм, низ не ниже ${n(Cb.low)} мм), перед ними — проход обслуживания; не на стыках модулей.`,
        `Конвекторы — у пола на свободных участках стен: между ними ${n(Cv.gap)} мм, от угла ${n(Cv.edge)} мм, свободно перед ${n(Cv.front)} мм (у ДГУ — ${n(Dg.convGap)} / ${n(Dg.convEdge)} / ${n(Dg.convFront)} мм).`] },
      { h:'12. ДГУ', items:[
        `Одна ДГУ — вдоль, посередине ширины (проход с каждой стороны не меньше ${n(Dg.pass)} мм), радиатор — к двери-жалюзи в торце (${n(Dg.rad)} мм); ${Dg.two ? 'две без бака — у торцов радиаторами наружу (выходы через двери-жалюзи, вторая дверь оператора не нужна)' : 'две — как три'}; от ${n(Dg.across)} (и две с баком) — поперёк, радиаторами к задней стене.`,
        'Выхлоп — у каждой ДГУ свой: глушитель на крыше, если он есть в составе (хоть у одной на крыше — у всех), иначе — через стену; приток — у каждой ДГУ напротив, одинаковый.',
        `Дополнительный бак — в отсеке у торца за перегородкой, прямоугольный по объёму (высота ${n(Tk.h1)} / ${n(Tk.h2)} мм, сначала выше, затем глубже — до ширины помещения); вход — ${Tk.gates ? 'ворота в торце' : `дверь ${n(Tk.door)} мм`}, горловина — в нише, топливопровод — по полу.`] },
      { h:'13. Насосная', items:[
        'Насосы — в ряд у задней стены, между агрегатами — по СП 31.13330.2021, п. 10.15; малые — по два на общей раме; всасывающий и напорный коллекторы — вдоль стены, вход и выход — через торец (в воротах — на свободную стену).'] },
      { h:'14. Станция из модулей', items:[
        `Только кнопкой «Модули…» и с вопросом; до ${n(Md.max)} модулей (больше — по запросу); раскладка — прямоугольник, внутри — одно помещение.`,
        `Модули одной ширины ${n(ws[0])}–${n(ws[ws.length-1])} мм, длина модуля — от ${n(Md.lMin)} до ${n(F.maxL)} мм; крупные агрегаты — сначала в один ряд модулей (торец к торцу), два ряда — только если иначе не встаёт.`,
        'Оборудование — целиком в своём модуле (на стыках ничего нет): на производстве собрано и проверено, на перевозку — расстыковка трубопровода и кабелей, на объекте — быстрая стыковка; в ТЗ — разъёмные соединения каждого стыка с маркировкой.'] },
    ];
  }
  /** HTML: разделы со списками */
  static html(){ return this.sections().map(s=>`<p class="ld-h"><b>${esc(s.h)}</b></p><ul class="ld-l">${s.items.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>`).join(''); }
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

// ---------------------------------------------------------------- дополнительный топливный бак: габариты по объёму
// Решение владельца 19.10: бак прямоугольный, внутренний объём — расчётный; начальные высота и ширина — по объёму (до
// «большого» — tank.h1 × tank.w1, больше — tank.h2 × tank.w2); бак не вытягивается в длину (уточнено 19.10): длиннее своей
// глубины — сначала выше (почти под потолок: tank.top под потолком), затем глубже (до tank.wMax и прохода перед баком);
// длина — по объёму с шагом tank.step, стенка tank.wall. Числа — в «Настройках» (требуют подтверждения изготовителем бака).
// Свои габариты бака в составе важнее.
class TankSize {
  /** {l, w, h} мм снаружи для объёма v, л (внутри — не меньше v) или null; lim — {h, w}: наибольшие высота и глубина в
   *  отсеке (без контейнера — по «Настройкам»: высота блок-контейнера без tank.top, глубина tank.wMax) */
  static of(v, lim){
    v=+v; if (!(v>0)) return null; const T=StationMatrix.tank(), big=v>T.big, t=T.wall, st=T.step||50, V=v*1e6, up=x=>Math.ceil(x/st)*st;
    let w=big ? T.w2 : T.w1, h=big ? T.h2 : T.h1;
    const Hm=Math.max(h, Math.floor(((lim && lim.h) || this.H-T.top)/st)*st), Wm=Math.max(w, Math.floor(Math.min(T.wMax, (lim && lim.w) || T.wMax)/st)*st);
    const len=(a, b)=>up(V/((a-2*t)*(b-2*t))+2*t);
    if (len(w, h)>w) h=Math.min(Hm, Math.max(h, up(V/((w-2*t)*(w-2*t))+2*t)));   // выше — до длины не больше глубины
    if (len(w, h)>w) w=Math.min(Wm, Math.max(w, up(Math.sqrt(V/(h-2*t))+2*t)));    // затем глубже — почти куб
    return { l:Math.max(w, len(w, h)), w, h };
  }
  static H = 2290;   // высота внутри блок-контейнера, мм — для габаритов бака без контейнера (в отсеке — своя)
  static LITRE = /(?:^|[^а-яё])л(?![а-яё])|литр/i;   // «л» отдельным словом (\b у кириллицы не работает)
  /** «2 600 × 800 × 1 000 мм» */
  static text(d){ const n=StationLayout.n; return d ? `${n(d.l)} × ${n(d.w)} × ${n(d.h)} мм` : ''; }
  /** объём бака из состава, л: поле volume / tank или строка «Объём … л» */
  static vol(p){ const a=(p && p.attrs)||{}, vr=((p && p.rows)||[]).find(r=>r && /^объ[её]м/i.test(String(r.k||'')) && TankSize.LITRE.test(String(r.v||'')+' '+String(r.k||'')));
    return StationEquip.num(a.tank) || StationEquip.num(a.volume) || (vr ? StationEquip.num(String(vr.v).match(/\d[\d\s]*(?:[.,]\d+)?/)?.[0]) : null); }
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
  /** число из поля каталога; диапазон или «до 40» — по верхней границе: {v, range} (null — нет числа) */
  static top(v){ const n=this.num(v); if (n!=null && /^\s*[\d.,\s]+\s*$/.test(String(v))) return { v:n, range:false };
    const L=(String(v??'').match(/\d[\d\s]*(?:[.,]\d+)?/g)||[]).map(t=>this.num(t)).filter(x=>x!=null); return L.length ? { v:Math.max(...L), range:true } : null; }
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
  static nums(text){ const a=this.sizes(text, this.DIM2); return a && a.every(v=>v>=50 && v<=20000) ? a : null; }
  // размеры «A × B × C» (DIM3) или «A × B [× C]» (DIM2): числа — с запятой или точкой
  static DIM2 = /(\d+(?:[.,]\d+)?)\s*×\s*(\d+(?:[.,]\d+)?)(?:\s*×\s*(\d+(?:[.,]\d+)?))?/;
  static DIM3 = /(\d+(?:[.,]\d+)?)\s*×\s*(\d+(?:[.,]\d+)?)\s*×\s*(\d+(?:[.,]\d+)?)/;
  /** размеры из текста по образцу re (DIM2 | DIM3), мм: метры и сантиметры пересчитываются, пределы не проверяются; нет — null */
  static sizes(text, re){
    const s=String(text||'').replace(/(\d)\s+(?=\d{3}\b)/g, '$1').replace(/[хxХX*]/g, '×'), m=s.match(re); if (!m) return null;
    let a=[m[1], m[2], m[3]].filter(Boolean).map(v=>parseFloat(v.replace(',', '.')));
    if (Math.max(...a)<40) a=a.map(v=>v*1000); else if (/см/.test(s)) a=a.map(v=>v*10);
    return a.map(Math.round);
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
    // вертикальный ресивер (поле «Исполнение» или название) с габаритами «высота × Ø × Ø» — стоит: наибольший размер — высота.
    // Исполнение не указано, а две меньшие стороны равны (Dalgakiran РВ 900.16 «2200 × 1000 × 1000») — тоже стоит
    // (отметка recv.upright в «Настройках»)
    if (n && n.length===3 && kind==='receiver' && !/гориз/i.test(String(a.orient||'')+' '+String(p.name||'')) && Math.max(...n)>n[2] && (/верт/i.test(String(a.orient||'')+' '+String(p.name||'')) || this.upright(n))){
      const s=[...n].sort((x, y)=>y-x); n=[s[1], s[2], s[0]]; }
    if (n && n.length===3){ const [l, w]=n[0]>=n[1] ? [n[0], n[1]] : [n[1], n[0]]; return { l, w, h:n[2], known:true, src }; }
    const g=this.guess(p, kind); return { l:g[0], w:g[1], h:g[2], known:false, src:'' };
  }
  /** ресивер без указанного исполнения: «высота × Ø × Ø» — две меньшие стороны равны (до 5 %), большая — заметно больше
   *  (в 1,3 раза): вертикальный, если так отмечено в правилах (recv.upright, по умолчанию — да) */
  static upright(n){ const s=[...n].sort((x, y)=>y-x); return !!StationMatrix.recv().upright && s[1]<=s[2]*1.05 && s[0]>=1.3*s[1]; }
  /** условные габариты, мм — по мощности, объёму или виду оборудования */
  static guess(p, kind){
    const a=p.attrs||{}, kw=this.num(a.kw), vr=(p.rows||[]).find(r=>r && /^объ[её]м/i.test(String(r.k||'')) && TankSize.LITRE.test(String(r.v||'')+' '+String(r.k||'')));
    const vol=this.num(a.volume) ?? (vr ? this.num(String(vr.v).match(/\d[\d\s]*(?:[.,]\d+)?/)?.[0]) : null);
    if (kind==='compressor') return kw==null||kw<=15 ? [1000, 700, 1100] : kw<=37 ? [1400, 900, 1500] : kw<=90 ? [2000, 1100, 1800] : [2700, 1500, 2000];
    if (kind==='dgu') return kw==null||kw<=30 ? [1800, 800, 1300] : kw<=100 ? [2500, 1000, 1600] : kw<=250 ? [3200, 1200, 1900] : kw<=500 ? [4000, 1600, 2200] : [5200, 2000, 2400];
    if (kind==='receiver'){ const v=vol||500, d=v<=300 ? 550 : v<=600 ? 650 : v<=1100 ? 800 : v<=2200 ? 1000 : 1200, h=v<=300 ? 1600 : v<=600 ? 2000 : v<=1100 ? 2300 : v<=2200 ? 2900 : 3100; return [d, d, h]; }
    // бак: прямоугольный по расчётному объёму (TankSize, решение владельца 19.10)
    if (kind==='tank'){ const d=TankSize.of(this.num(a.tank)||vol||1000); return [d.l, d.w, d.h]; }
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
    return t ? { hex:t, known:true, text:c.text, photo:true, tones:this.tones(p) } : c;
  }
  /** зоны других цветов по фото (как окрашены части изделия в карточке): [{ u0, u1, v0, v1, hex }] или null */
  static tones(p){ const s=p && p.photo && p.photo.src, z=s && typeof PhotoTint!=='undefined' ? PhotoTint.tones(String(s)) : []; return z.length ? z : null; }
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
  /** свой рисунок модели для чертежа: {front, top} — адреса изображений (или null) */
  static pic(p){ const d=p.draw||{}, s=v=>String((d[v] && d[v].src)||''); return s('front') || s('top') ? { front:s('front'), top:s('top') } : null; }
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

  /** состав → оборудование: [{id, pos, name, brief, short, kind, qty, l, w, h, known, mass, color, shape, place}] (pos — номер
   *  на чертеже); o: {recv — где ресивер без своей роли ('after' | 'before' | 'both'), recvOut — ресиверы после подготовки
   *  снаружи} */
  static list(parts, o={}){
    let pos=0;
    const out=(parts||[]).filter(p=>p && p.role!=='container').map(p=>{
      const kind=this.kindOf(p), name=String(p.name||'').trim() || this.LABEL[kind] || 'Элемент', qty=Math.max(1, Math.min(20, Math.round(this.num(p.qty)||1)));
      if (kind==='skip' || kind==='chassis') return { id:p.id, name, kind, qty, place:false };
      if (kind==='receiver' && p.recvRole==='local') return { id:p.id, name, kind:'skip', qty, place:false, local:true, vol:AirChain.volume(p) };   // у потребителя — не в контейнере
      if (kind==='piping'){ const m=PipeMaterial.of(p); return { id:p.id, pos:++pos, name, brief:this.brief(p, kind, name), short:'Трубопровод', kind, qty, place:false, mat:m ? m.id : '', dn:PipeMaterial.dn(p) }; }
      if (kind==='muffler'){   // глушитель ДГУ — на крыше («…внутри…» — не рисуется); без размеров — по мощности ДГУ
        const d=this.dims(p, kind); return { id:p.id, pos:++pos, name, brief:this.brief(p, kind, name), short:this.short(p, kind), kind, qty, place:false, roof:!/внутр/i.test(name),
          l:d.l, w:d.w, h:d.h, known:d.known, src:d.src, mass:this.mass(p), color:this.color(p, kind).hex }; }
      const d=this.dims(p, kind);
      if (!kind && !d.known) return { id:p.id, name, kind:'skip', qty, place:false, nodims:true };
      const k=kind||'other', c=this.color(p, k), air=/^(compressor|dryer|receiver|filter)$/.test(k) ? AirChain.info(p, k) : null;
      const pipe=k==='filter' && air.grade!=='cond' && Math.max(d.l, d.w)<=700;   // магистральный фильтр — висит на трубопроводе
      return { id:p.id, pos:++pos, name, brief:this.brief(p, k, name), short:this.short(p, k), kind:k, qty, l:d.l, w:d.w, h:d.h, known:d.known, src:d.src, mass:this.mass(p), kw:this.num((p.attrs||{}).kw), maker:String((p.attrs||{}).maker||'').trim(),
        color:c.hex, colorKnown:c.known, colorText:c.text, tones:c.tones||null, shape:this.shape(p, k, d), look:this.look(p, k), place:true, pipe, mount:k==='cabinet' ? this.mount(p, d) : pipe ? 'pipe' : 'floor', air, noise:StationNorms.dba(p), pic:this.pic(p),
        flow:k==='pump' ? this.num((p.attrs||{}).flow) : null, ...(k==='tank' ? { vol:TankSize.vol(p) } : {}), ...(k==='compressor' || k==='dgu' ? this.airRows(p) : {}), ...(k==='compressor' ? { ctype:this.ctype(p) } : {}) };
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
    else if (kind==='receiver'){ o.role=p.recvRole==='wet' || p.recvRole==='dry' ? p.recvRole : /сух/i.test(nm) || /после осушител/i.test(t) ? 'dry' : /мокр|влажн/i.test(nm) ? 'wet' : ''; o.vol=this.volume(p); }
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
    const R=A.filter(e=>e.kind==='receiver');
    for (const e of R.filter(x=>!x.air.role)) e.air.role=recv==='before' ? 'wet' : 'dry';   // без своей роли: «только до осушителя» — мокрый, иначе сухой
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
  static check(eq, cls, rq){
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
      // ресиверы — по методике ПНЕВМОТЕХ (ReceiverPlan): основной (сухой) — n × 900 л (500 л — крайняя
      // необходимость), мокрый — до осушителя (30–50 % основного), локальный — у потребителя (пик точки больше 50 % компрессора)
      const RP=ReceiverPlan.from(eq, rq||{}), N=StationLayout.n;
      if (RP){ const dryR=R.filter(e=>e.air.role!=='wet'), wetR=R.filter(e=>e.air.role==='wet'), onRecv=C.some(e=>e.air.recv);
        const add=(k, x, role, title, why, need)=>rec(k, { title, why, cat:'receiver', name:'Воздушный ресивер', f:{}, r:{ volume:[String(x.size), String(x.size)] }, total:x.total, qty:x.n, role, need,
          attrs:{ cat:'receiver' }, rows:[{ k:'Объём', v:`${N(x.size)} л` }] });
        if (RP.main && !dryR.length && !onRecv){
          iss.push({ level:'info', air:true, text:`Ресивера в составе нет — по расчёту (приоритет ${RP.prio}) нужно ${N(RP.theor)} л: ${ReceiverPlan.text(RP)}. Ресивер сглаживает пульсации и пики потребления, собирает конденсат, компрессор реже включается.` });
          add('receiver', RP.main, RP.mode==='before' ? 'wet' : 'dry', `Воздушные ресиверы ${RP.main.n>1 ? RP.main.n+' × ' : ''}${N(RP.main.size)} л${RP.mode==='before' ? ' (до осушителя)' : D.length || builtDryer ? ' (после осушителя)' : ''}`,
            `нужно ${N(RP.theor)} л (приоритет ${RP.prio}); ${RP.main.why}`, RP.theor); }
        if (RP.wet && !wetR.length) add('receiver-wet', RP.wet, 'wet', `Мокрый ресивер ${N(RP.wet.size)} л (до осушителя)`, `30–50 % основного; ${RP.wet.why}`, RP.main.total*ReceiverPlan.M.wet[0]);
        // ресиверы есть, но меньше расчёта (например, после ввода циклограммы) — добрать по 900 л
        const U=ReceiverPlan.UNIT, more=(L, x, k, role, what)=>{ const v=L.reduce((t, e)=>t+(e.air.vol||0)*e.qty, 0), n=x ? Math.ceil((x.total-v)/U-1e-9) : 0;
          if (L.length && x && x.size===U && L.every(e=>e.air.vol===U) && n>0) add(k, { size:U, n, total:n*U }, role, `Ещё ${n} × ${N(U)} л (${what})`, `в составе ${N(v)} л, по расчёту — ${N(x.total)} л`, x.total-v); };
        more(RP.mode==='before' ? [] : dryR, RP.main, 'receiver-more', RP.mode==='before' ? 'wet' : 'dry', 'основной ресивер');
        if (RP.wet) more(wetR, RP.wet, 'receiver-wet-more', 'wet', 'мокрый ресивер');
        if (RP.local && !eq.some(e=>e.local)) add('receiver-local', RP.local, 'local', `Локальный ресивер ${N(RP.local.size)} л у потребителя`, `пик точки больше 50 % производительности компрессора; ${RP.local.why}`); }
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

// ---------------------------------------------------------------- ресиверы: расчёт и подбор по методике ПНЕВМОТЕХ
// Типоразмер: объём одного ресивера — кратно 900 л; 500 л — только при крайней необходимости (900 л дал бы запас больше
// 200 %, нет места, ограничение по массе); суммарный объём — вверх по ряду 500 → 900 → 1800 → 2700 → … Расчёт по
// приоритетам: 1 — цикл «нагрузка — разгрузка» (не более 10–15 циклов в час): V = Q / (8 · ΔP); 2 — пиковый разбор по
// циклограмме: V = T · (C − S) · Pa / (P1 − P2); 3 — базовый буфер без циклограммы: винтовой 0,25 · Q, поршневой 1 · Q
// (Q в л/мин). Все три — нижние границы: нужный объём — наибольший из применимых, «сработавший» приоритет — тот, что его
// дал. Основной (сухой) ресивер — после осушителя; мокрый — до осушителя, 30–50 % основного; локальный — у потребителя,
// если пик точки больше 50 % производительности наибольшего компрессора. Коэффициенты — правило receiver.method.
class ReceiverPlan {
  static get M(){ return StationRules.raw('receiver.method'); }
  /** ряд типоразмеров: [500, 900] — один ресивер 500 л или n × 900 л */
  static get UNIT(){ return this.M.unit; }
  static get SMALL(){ return this.M.small; }
  static l(v){ return StationLayout.n(Math.round(v)); }
  static f(v, d=2){ return String(Math.round(v*10**d)/10**d).replace('.', ','); }
  /** типоразмер на объём V, л: {size — 500 | 900, n, total, why}; force — '500' | '900' (выбор менеджера), reason — 'space' |
   *  'mass' (обоснование 500 л), space — 900 л не помещается (по высоте), не задано — по правилу ряда */
  static size(V, o={}){
    const U=this.UNIT, Sm=this.SMALL, ex=this.M.excess; if (!(V>0)) return null;
    // число — наименьшее допустимое (решение ПНЕВМОТЕХ): не меньше o.min (по методике — 80 %
    // нужного объёма и 15 % минутной производительности), а не всегда вверх до полного нужного объёма
    const Vn=o.min>0 ? o.min : V, short=Vn<V-1e-9;
    const by900=()=>{ const n=Math.max(1, Math.ceil(Vn/U-1e-9)); return { size:U, n, total:n*U }; };
    if (o.force==='900') return { ...by900(), why:`${this.l(U)} л — выбор вручную` };
    // 500 л — по выбору (нехватка места, масса) или 900 л не помещается по высоте; нужно больше 500 л — несколько по 500 л
    // (решение ПНЕВМОТЕХ: ресиверы 900 л не помещаются — меньшие без учёта в Ростехнадзоре, лишь бы внутри станции)
    if (o.force==='500' || o.space){ const n=Math.max(1, Math.ceil(Vn/Sm-1e-9));
      return { size:Sm, n, total:n*Sm, why:`${n>1 ? `${n} × ` : ''}${this.l(Sm)} л — ${o.space ? 'ресивер 900 л не помещается по высоте' : o.auto ? 'нехватка места: с ресиверами 900 л станция не помещается в габарит перевозки' : o.reason==='space' ? 'нехватка места (вручную)' : o.reason==='mass' ? 'ограничение по массе (вручную)' : 'выбор вручную'}`, forced:true, reason:o.space ? 'space' : o.reason||'' }; }
    if (V<=Sm && U>ex*V) return { size:Sm, n:1, total:Sm, why:`${this.l(Sm)} л — ресивер ${this.l(U)} л дал бы запас ${Math.round(U/V*100)} % (больше ${Math.round(ex*100)} %)`, reason:'excess' };
    const b=by900(); return { ...b, why:`кратно ${this.l(U)} л: ${b.n} × ${this.l(U)} = ${this.l(b.total)} л${short && b.total<V-1e-9 ? ` — наименьшее допустимое по методике (${Math.round(b.total/V*100)} % нужного, не меньше ${Math.round(this.M.low*100)} %)` : ''}${V<=Sm ? ` (${this.l(Sm)} л не применён: ${this.l(U)} л даёт запас не больше ${Math.round(ex*100)} %)` : ''}` };
  }
  /** расчёт: o — {Q — наибольший компрессор, м³/мин, piston — он поршневой, S — подача рабочих компрессоров, м³/мин,
   *  dp — ΔP нагрузка/разгрузка, бар (не задан — правило pressure.band), cyc — {T, C, drop} | null, point — пик точки, м³/мин,
   *  tz — объём по ТЗ, л, dryer — есть осушитель, dryerCap — его производительность с поправками, м³/мин, mode — '' (по
   *  методике) | 'after' | 'before', force, reason, space, bar — наибольшее давление компрессоров, valve — уставка
   *  предохранительного клапана, бар, have — ресиверы состава [{vol, qty, bar, role: 'dry' | 'wet' | 'local'}]}
   *  → {prio, V:{p1, p2, p3, tz}, theor, main, wet, local, checks:[{level, text}], data — для записки} | null (нет Q) */
  static calc(o){
    const M=this.M, Q=o.Q>0 ? o.Q : 0; if (!Q) return null;
    const dp=o.dp>0 ? o.dp : StationRules.raw('pressure.band'), dpSrc=o.dp>0 ? 'задан' : 'по правилу pressure.band';
    const V={ p1:Q/(M.cycles*dp)*1000 }, cyc=o.cyc && o.cyc.T>0 && o.cyc.C>0 && o.cyc.drop>0 ? o.cyc : null;
    // по приоритетам: винтовой — цикл нагрузки/разгрузки (1), с циклограммой — и
    // пиковый разбор (2); базовый буфер (3) — у поршневого (пуск-останов) без циклограммы; объём по ТЗ — нижняя граница
    if (cyc) V.p2=Math.max(0, cyc.T*(cyc.C-(o.S||Q))*M.pa/cyc.drop*1000);
    else if (o.piston) V.p3=M.base.piston*Q*1000;
    if (o.tz>0) V.tz=o.tz;
    const cand=[['p1', 1], ['p2', 2], ['p3', 3], ['tz', 'ТЗ']].filter(([k])=>V[k]!=null), gov=cand.reduce((m, c)=>V[c[0]]>V[m[0]]+1e-9 ? c : m, cand[0]);
    // основной — наименьшее допустимое число; мокрый — если задан («основной + мокрый») или по методике при риске проскока
    // влаги (пик по циклограмме или у точки больше производительности осушителя), иначе не нужен
    const theor=Math.round(V[gov[0]]), main=this.size(theor, { ...o, min:gov[0]==='tz' ? theor : Math.max(M.low*theor, M.ratio[0]*Q*1000) });   // объём по ТЗ — полностью
    const peak=Math.max(cyc ? cyc.C : 0, o.point||0), risk=o.dryerCap>0 && peak>o.dryerCap;
    const wetOn=o.dryer && (o.mode==='both' || (!o.mode && risk)), wv=main ? main.total*M.wet[0] : 0;
    const wet=wetOn && main ? this.size(wv, { min:wv }) : null;
    const local=o.point>M.local*Q ? this.size(M.base.screw*o.point*1000) : null;
    const R={ prio:gov[1], V, theor, main, wet, local, dp, dpSrc, cyc, Q, S:o.S||Q, piston:!!o.piston, mode:o.mode||'', risk, dryer:!!o.dryer, checks:[] };
    R.checks=this.checks(R, o);
    return R;
  }
  /** проверки «на здравый смысл» — по составу (если ресиверы в нём есть), иначе по рекомендации */
  static checks(R, o){
    const M=this.M, out=[], l=v=>this.l(v), f=v=>this.f(v), Q=R.Q, have=o.have||[];
    const dry=have.filter(h=>h.role!=='wet' && h.role!=='local'), wets=have.filter(h=>h.role==='wet');
    const sum=L=>L.reduce((s, h)=>s+(h.vol||0)*(h.qty||1), 0), main=dry.length && dry.every(h=>h.vol>0) ? sum(dry) : R.main ? R.main.total : 0;
    const all=main+(wets.length ? sum(wets) : R.wet ? R.wet.total : 0);
    // 1. избыточность и недобор
    if (main>M.excess*R.theor) out.push({ level:'warn', text:`Запас превышает 200% (${l(main)} л на ${l(R.theor)} л). Рассмотреть переход на 500 л или пересмотр количества ресиверов.` });
    if (main<M.low*R.theor) out.push({ level:'error', text:`Объём ниже минимально допустимого (${l(main)} л при нужных ${l(R.theor)} л). Расчёт некорректен.` });
    // 2. к минутной производительности наибольшего компрессора
    if (main<M.ratio[0]*Q*1000) out.push({ level:'warn', text:`Объём менее 15% минутной производительности (${l(main)} л при ${f(Q)} м³/мин) — риск частых циклов и пульсаций.` });
    if (main>M.ratio[1]*Q*1000) out.push({ level:'warn', text:`Объём более 5-кратной минутной производительности (${l(main)} л при ${f(Q)} м³/мин) — неоправданно велик, если нет задачи длительного буфера.` });
    // 3. давление: номинал ресивера — с запасом над наибольшим давлением компрессоров; уставка клапана — не выше номинала
    const rb=have.filter(h=>h.bar>0), pmin=rb.length ? Math.min(...rb.map(h=>h.bar)) : 0;
    if (pmin>0 && o.bar>0 && pmin<o.bar+M.margin-1e-9) out.push({ level:'error', text:`Ресивер должен иметь запас по давлению минимум 1–2 бар относительно максимального давления компрессора (ресивер ${f(pmin)} бар, компрессор ${f(o.bar)} бар).` });
    if (o.valve>0 && pmin>0 && o.valve>pmin+1e-9) out.push({ level:'error', text:`Уставка предохранительного клапана превышает номинал ресивера (${f(o.valve)} бар > ${f(pmin)} бар).` });
    // 4. «мёртвый объём» — к пиковому разбору за цикл (по циклограмме)
    if (R.V.p2>0 && all>M.dead*R.V.p2) out.push({ level:'warn', text:`Система имеет избыточную аккумулирующую способность (${l(all)} л при пиковом разборе ${l(R.V.p2)} л за цикл). Возможно снижение энергоэффективности из-за длительного нахождения воздуха в ресивере (конденсат, потери тепла).` });
    // 5. ряд 900/500
    const bad=have.filter(h=>h.vol>0 && h.role!=='local' && h.vol!==this.SMALL && Math.abs(h.vol/this.UNIT-Math.round(h.vol/this.UNIT))>1e-6);
    const all500=dry.length && dry.every(h=>h.vol===this.SMALL);   // несколько по 500 л (нехватка места) — тоже по ряду
    if (bad.length || (dry.length && main>0 && main!==this.SMALL && !all500 && Math.abs(main/this.UNIT-Math.round(main/this.UNIT))>1e-6))
      out.push({ level:'error', text:`Нарушено правило типоразмерного ряда (${[...new Set(bad.map(h=>l(h.vol)+' л'))].join(', ') || l(main)+' л'}: объём — кратно ${l(this.UNIT)} л или ${l(this.SMALL)} л). Пересчитать.` });
    const small=dry.length ? dry.some(h=>h.vol===this.SMALL) : R.main && R.main.size===this.SMALL;
    if (small && !(this.UNIT>M.excess*R.theor) && !(o.space || o.reason==='space' || o.reason==='mass'))
      out.push({ level:'warn', text:'500 л применён без достаточного обоснования. Проверить необходимость использования 900 л.' });
    // 6. осушитель при резком падении давления (пик по циклограмме или у точки): без мокрого ресивера — проскок влаги
    const peak=Math.max(R.cyc ? R.cyc.C : 0, o.point||0);
    if (o.dryer && o.dryerCap>0 && peak>o.dryerCap && !wets.length && !(R.wet && !have.length))
      out.push({ level:'warn', text:`Возможен проскок влаги через осушитель при резком падении давления (пик ${f(peak)} м³/мин больше производительности осушителя ${f(o.dryerCap)} м³/мин). Рассмотреть установку мокрого ресивера.` });
    return out;
  }
  /** рекомендация одной строкой: «основной 900 л × 3 = 2 700 л (после осушителя); мокрый 500 л × 1 (до осушителя)» */
  static text(R){
    const u=(x, w)=>x ? `${w} ${this.l(x.size)} л × ${x.n}${x.n>1 ? ` = ${this.l(x.total)} л` : ''}` : '';
    const where=R.mode==='before' ? ' (до осушителя)' : R.wet || R.dryer || R.mode==='after' ? ' (после осушителя)' : '';
    return [u(R.main, 'основной')+where, R.wet ? u(R.wet, 'мокрый')+' (до осушителя)' : '', R.local ? u(R.local, 'у потребителя') : ''].filter(Boolean).join('; ');
  }
  /** расчёт по составу станции: eq — StationEquip.list (компрессоры, осушители, ресиверы с air), rq — StationReq.recvIn */
  static from(eq, rq={}){
    const C=(eq||[]).filter(e=>e.kind==='compressor' && e.air && e.air.flow>0); if (!C.length) return null;
    const big=C.reduce((m, e)=>e.air.flow>m.air.flow ? e : m, C[0]), tot=C.reduce((s, e)=>s+e.air.flow*(e.qty||1), 0);
    const S=Math.max(big.air.flow, tot-Math.max(0, rq.reserve||0)*big.air.flow), bar=Math.max(0, ...C.map(e=>e.air.bar||0));
    const D=eq.filter(e=>e.kind==='dryer' && e.air && e.air.type!=='gen'), dryer=D.length>0 || C.some(e=>e.air.dryer);
    const dryerCap=D.length && D.every(e=>e.air.flow>0) ? D.reduce((s, e)=>s+e.air.flow*(e.qty||1), 0)*AirChain.kp(bar) : 0;
    const have=eq.filter(e=>e.kind==='receiver' && e.air).map(e=>({ vol:e.air.vol||0, qty:e.qty||1, bar:e.air.bar||0, role:e.air.role==='wet' ? 'wet' : 'dry', pos:e.pos }))
      .concat(eq.filter(e=>e.local).map(e=>({ vol:e.vol||0, qty:e.qty||1, bar:0, role:'local' })));
    const R=this.calc({ Q:big.air.flow, piston:big.ctype==='piston', S, dp:rq.dp, cyc:rq.cyc, point:rq.point, tz:rq.tz, dryer, dryerCap, mode:rq.mode,
      force:rq.force, reason:rq.reason, auto:rq.auto, space:rq.space, bar, valve:rq.valve, have });
    if (R){ R.big=big; R.have=have; R.bar=bar; R.dryerCap=dryerCap; } return R;
  }
  static PRIO = { 1:'1 — цикл нагрузки/разгрузки', 2:'2 — пиковый разбор по циклограмме', 3:'3 — базовый буфер', 'ТЗ':'объём по ТЗ заказчика' };
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
  /** объёмная теплоёмкость воздуха при температуре t, Вт·ч/(м³·°C): c · ρ(t) / 3,6 (air.cp) — зимой воздух плотнее, чем при +20 °C
   *  (heat.air 0,335 — при +20 °C: инфильтрация и подогрев воздуха на сжатие при −40 °C выходили заниженными на четверть) */
  static airAt(t){ const a=StationRules.raw('air.cp'); return a && a.c>0 && a.rhoK>0 ? a.c*a.rhoK/(273+t)/3.6 : this.AIR; }
  static get SUN(){ return StationRules.raw('heat.sun'); }           // солнце на крышу летом, кВт/м²
  // конвектор: [кВт, длина, мм]; высота 400, глубина 90, низ — 150 мм от пола
  static get UNITS(){ return StationRules.raw('heat.conv_units'); }   // типоразмеры конвекторов: [кВт, длина, мм] — правило файла
  static get CONV(){ return { h:400, d:90, ...StationMatrix.conv() }; }

  /** наружная температура для отопления: из требований; нет — heat.t_default (−40 °C, решение 17.10), но не холоднее
   *  нижней температуры исполнения контейнера (ГОСТ 15150) */
  static tOut(r, climate){
    if (Number.isFinite(r.tmin)) return r.tmin;
    const d=StationRules.opt('heat.t_default'), def=Number.isFinite(d) ? d : -40, cold=StationNorms.COLD[climate];
    return cold!=null ? Math.max(cold, def) : def;
  }
  /** расчёт по расстановке: теплопотери, режим работы, конвекторы (heaters — места), вентиляция летом */
  static calc(plan){
    const g=plan.geo, [Le, We, He]=g.ext, [Li, Wi, Hi]=plan.int, sys=plan.sys||{}, r=plan.req||{}, m=v=>v/1000, I=plan.items||[], fuel=plan.fuel;
    const rec=sys.rec!==false, tout=this.tOut(r, plan.climate);
    const tin=StationNorms.INSIDE, dT=Math.max(0, tin-tout), Lt=fuel ? fuel.x1+fuel.part : 0;
    const kind=g.sea ? 'sea' : this.BRIDGE[g.type] ? g.type : 'block', U=this.BRIDGE[kind]/(this.R_SURF+m(g.t)/this.LAMBDA);
    // ограждения отапливаемой части; перегородка к холодному отсеку бака — с половиной перепада
    const L=m(Le-Lt), W=m(We), H=m(He), A=2*(L*W+L*H+W*H)-(fuel ? W*H : 0), Apart=fuel ? m(Wi)*m(Hi) : 0;
    const doors=[], en=plan.entry, G=plan.gates; if (en && !en.sea) doors.push(m(en.w)*m(en.h));
    if (g.sea && g.door) doors.push(m(g.door[0])*m(g.door[1])); else if (G) doors.push(m(G.w)*m(G.h));   // ворота в торце (у морского — его двери)
    for (const d of plan.doors||[]) doors.push(m(d.w)*m(d.h));
    if (plan.exit) doors.push(m(plan.exit.w)*m(plan.exit.h));   // вторая дверь оператора в торце
    // жалюзи радиатора — у каждой ДГУ свои (сечение — сторона напротив радиатора × высота)
    const DG=I.filter(i=>i.kind==='dgu' && !i.tank), Ad=doors.reduce((s, v)=>s+v, 0), LL=StationRules.raw('heat.louver_leak'), Al=(sys.vent!==false ? LL.vent : 0)+DG.reduce((s, g)=>s+m(g.rad==='back' ? g.lx : g.ly)*m(g.h)*LL.dguK, 0);
    const qEnv=(U*Math.max(0, A-Ad-Al)+this.U_DOOR*Ad+this.U_LOUVER*Al)*dT+U*Apart*dT/2;
    const cW=this.airAt(tout), qInf=this.ACH*m(Li-Lt)*m(Wi)*m(Hi)*cW*dT, qStop=qEnv+qInf;
    // работа: самый «холодный» режим — один агрегат (тепло в помещение минус подогрев забираемого им воздуха)
    const units=I.filter(i=>!i.tank && i.mount!=='wall' && /^(compressor|dgu|pump)$/.test(i.kind) && i.kw>0), ex=r.vent||{}, VW=[];
    // тепло в помещение при работе: компрессор с рециркуляцией — всё его тепло (паспорт или N·k, VentCalc), без неё — корпус
    const heat=i=>i.kind==='compressor' && rec ? (i.heat>0 ? i.heat : i.kw*VentCalc.k(i.ctype, ex, []))*1000 : i.kw*1000*(this.LOSS[i.kind] || (rec ? this.REC[i.kind] : 0) || this.CASE);
    const air=i=>i.kind==='compressor' ? (i.air && i.air.flow>0 ? i.air.flow*60 : i.kw*StationRules.raw('heat.comp_air')*60) : i.kind==='dgu' ? (i.comb>0 ? i.comb : i.kw*this.COMB) : 0;   // м³/ч, ДГУ — по паспорту
    const run=units.map(i=>({ i, q:heat(i), a:air(i) })), net=o=>o.q-o.a*cW*dT;
    const base=run.length ? run.reduce((a, b)=>net(a)<=net(b) ? a : b) : null, qRun=base ? qStop-net(base) : null;
    const need=Math.max(qStop, qRun||0)*this.RESERVE/1000, on=sys.heat!==false;
    const pick=on ? this.pick(plan, need) : { n:0, kw:0, len:0, heaters:[], short:false };
    // лето: рабочие агрегаты (без резерва)
    const tmax=Number.isFinite(r.tmax) ? r.tmax : 35, work=this.working(units, Math.max(0, r.res||0));
    const qSum=work.reduce((s, i)=>s+i.kw*1000*(this.LOSS[i.kind]||this.CASE), 0)+this.SUN*1000*m(Le)*m(We)+I.filter(i=>i.kind==='dryer').reduce((s, i)=>s+(i.kw||0)*1000, 0);
    // лето (VentCalc): охлаждение компрессоров — по паспорту, иначе Q = N·k при нагреве воздуха в компрессоре heat.cool_dt;
    // помещение — перепадом t_вн − t_нар, один поток с охлаждением; не меньше 3 объёмов в час; при остановке — вентилятор с
    // термостатом; радиатор ДГУ — по паспорту, иначе по мощности (нагрев на 10 °C)
    const rad=Math.round(work.filter(i=>i.kind==='dgu').reduce((s, i)=>s+(i.cool>0 ? i.cool : i.kw*1000*StationRules.raw('heat.dgu_rad').share/(this.AIR*StationRules.raw('heat.dgu_rad').dt)), 0));
    const V=m(Li-Lt)*m(Wi)*m(Hi), comp=work.filter(i=>i.kind==='compressor');
    const vc={ units:comp.map(i=>({ key:StationLayout.key(i), pos:i.pos, type:i.ctype, kw:i.kw, heat:i.heat, cool:i.cool })), qRoom:qSum/1000, qSun:this.SUN*m(Le)*m(We), use:work.reduce((s, i)=>s+air(i), 0), V, tSum:tmax, tWin:tout, tInMin:tin, boost:!!sys.boost, exfan:!!sys.exfan, ex };
    const S=VentCalc.summer(vc, VW);
    // зима: потери ограждений (U по утеплителю) и минимального воздухообмена против тепла работающего (самый холодный режим)
    const Wn=VentCalc.winter({ ...vc, env:{ U, A, qEnv }, Qrun:base ? base.q/1000 : 0, useRun:base ? base.a : 0 }, S, VW), Rc=VentCalc.recup(!!sys.hrv, Wn, vc, VW);
    return { tout, tin, dT, rec, on, U:Math.round(U*1000)/1000, A:Math.round(A*10)/10, qEnv:Math.round(qEnv), qInf:Math.round(qInf), qStop:Math.round(qStop),
      base:base ? { pos:base.i.pos, kind:base.i.kind, q:Math.round(base.q), a:Math.round(base.a) } : null, qRun:qRun==null ? null : Math.round(qRun),
      need:Math.round(need*100)/100, n:pick.n, kw:pick.kw, total:Math.round(pick.n*pick.kw*10)/10, short:pick.short, heaters:pick.heaters,
      vent:{ tmax, m3h:S.Lgen+S.use, use:S.use, cool:S.Lcool, rad, sum:S, win:Wn, rec:Rc, warn:VW, ex } };
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
    const [L, W]=plan.int, x0=plan.geo.x0||0, I=(plan.items||[]).filter(i=>!i.tank), out=[];
    // у ДГУ — плотнее (решение владельца 19.10): меньше отступы (dgu.convGap, convEdge, convFront), вдоль ДГУ — до прохода 600 мм
    const dg=I.some(i=>i.kind==='dgu' && !i.tank), M=dg ? StationMatrix.grp('dgu') : null, C=dg ? { ...this.CONV, gap:M.convGap, edge:M.convEdge, front:M.convFront } : this.CONV;
    const aMin=dg ? Math.min(600, (plan.aisleRule||[1000, 800])[1]) : (plan.aisleRule||[1000, 800])[1];
    const fl=I.filter(i=>i.mount==='floor' || i.mount==='frame'), B={ front:[], back:[], left:[], right:[] };
    for (const i of fl){
      if (i.y<C.d+C.front || (i.y<W/2 && i.y-C.d<aMin)) B.front.push([i.x, i.x+i.lx]);
      if (i.y+i.ly>W-C.d-C.front) B.back.push([i.x, i.x+i.lx]);
      if (i.x<x0+C.d+C.front) B.left.push([i.y, i.y+i.ly]);
      if (i.x+i.lx>L-C.d-C.front) B.right.push([i.y, i.y+i.ly]); }
    for (const i of I.filter(i=>i.mount==='wall' && B[i.wall])) B[i.wall].push(i.wall==='front' || i.wall==='back' ? [i.x, i.x+i.lx] : [i.y, i.y+i.ly]);   // не под шкафом
    const en=plan.entry; if (en) B[en.wall].push(en.wall==='front' ? [en.x0, en.x1] : [en.y0, en.y1]);
    for (const G of [plan.gates, plan.gates2]) if (G) B[G.wall].push([G.y0, G.y1]);
    for (const d of plan.doors||[]) B[d.wall==='back' ? 'back' : 'front'].push([d.x0, d.x1]);
    if (plan.exit) B[plan.exit.wall].push([plan.exit.y0, plan.exit.y1]);
    // радиатор каждой ДГУ и его дверь-жалюзи — без конвекторов; напротив ДГУ на стене прохода — место её приточных жалюзи
    for (const g of fl.filter(i=>i.kind==='dgu')){ const w=g.rad || 'right', c=g.x+g.lx/2, r=Math.min(g.lx, 1200)/2;
      B[w].push(w==='back' ? [g.x-200, g.x+g.lx+200] : [g.y-200, g.y+g.ly+200]); B.front.push([c-r, c+r]); }
    for (const d of plan.dguDoors||[]) B[d.wall].push(d.wall==='back' ? [d.x0, d.x1] : [d.y0, d.y1]);
    { const J=StationMods.lines(plan.geo); for (const x of J.x){ B.front.push([x-150, x+150]); B.back.push([x-150, x+150]); } for (const y of J.y){ B.left.push([y-150, y+150]); B.right.push([y-150, y+150]); } }   // стыки модулей
    for (const e of (plan.exhausts||[]).filter(e=>e.how==='wall')) B[e.wall].push([e.u-200, e.u+200]);   // под выводом выхлопа
    if (plan.geo.type==='north' && x0>0) B.left.push([W-1100, W]);   // дверь тамбура «Севера» — у задней стены
    for (const [w, a0, b0] of [['front', x0, L], ['back', x0, L], ['left', 0, W], ['right', 0, W]]){
      const mg=dg ? C.gap : 100, bl=B[w].map(([a, b])=>[a-mg, b+mg]).sort((p, q)=>p[0]-q[0]), free=[]; let a=a0+C.edge;
      for (const [p, q] of bl){ if (p>a) free.push([a, Math.min(p, b0-C.edge)]); a=Math.max(a, q); }
      if (b0-C.edge>a) free.push([a, b0-C.edge]);
      for (const [p, q] of free){ const k=Math.floor((q-p+C.gap)/(len+C.gap)); if (k<1) continue;
        const step=(q-p-k*len)/(k+1);
        for (let j=0; j<k; j++){ const u=Math.round(p+step*(j+1)+j*len), seg={ seg:w+':'+p, p, q };
          out.push(Object.assign(w==='front' ? { wall:w, x:u, y:0, lx:len, ly:C.d } : w==='back' ? { wall:w, x:u, y:W-C.d, lx:len, ly:C.d }
            : w==='left' ? { wall:w, x:x0, y:u, lx:C.d, ly:len } : { wall:w, x:L-C.d, y:u, lx:C.d, ly:len }, seg)); } } }
    return out.map(o=>Object.assign(o, { z:C.z, h:C.h, cx:o.x+o.lx/2, cy:o.y+o.ly/2 }));
  }
  /** n мест из свободных: первое — ближе ко входу (холодный воздух), следующие — дальше всего от уже выбранных */
  static spread(S, n, plan, kw){
    if (!n || !S.length) return [];
    // у ДГУ торец у входа — под приток (с отсеком бака там перегородка — конвекторы можно)
    if ((plan.items||[]).some(i=>i.kind==='dgu') && !plan.fuel && S.filter(s=>s.wall!=='left').length>=n) S=S.filter(s=>s.wall!=='left');
    const x0=plan.geo.x0||0, W=plan.int[1], D=(plan.doors||[])[0];
    const en=plan.entry, E=en ? (en.wall==='front' ? [(en.x0+en.x1)/2, 0] : [x0, (en.y0+en.y1)/2]) : D ? [(D.x0+D.x1)/2, D.wall==='back' ? W : 0] : [x0, W/2];
    const d=s=>Math.hypot(s.cx-E[0], s.cy-E[1]), got=[S.reduce((a, b)=>d(a)<=d(b) ? a : b)];
    while (got.length<n){ let best=null, bd=-1;
      for (const s of S){ if (got.includes(s)) continue; const q=Math.min(...got.map(t=>Math.hypot(s.cx-t.cx, s.cy-t.cy))); if (q>bd){ bd=q; best=s; } }
      if (!best) break; got.push(best); }
    const H=got.map(s=>({ kind:'heater', wall:s.wall, x:s.x, y:s.y, z:s.z, lx:s.lx, ly:s.ly, h:s.h, kw, seg:s.seg, p:s.p, q:s.q }));
    // аккуратность (п. 5): несколько конвекторов на одном свободном участке стены — с равным шагом по всему участку
    if (StationTidy.M.lines && !(plan.items||[]).some(i=>i.kind==='dgu')) for (const g of new Set(H.map(h=>h.seg))){   // у ДГУ — места под приток напротив каждой
 const G=H.filter(h=>h.seg===g); if (G.length<2 || !G[0].seg) continue;
      const along=G[0].wall==='front' || G[0].wall==='back', len=along ? G[0].lx : G[0].ly, k=G.length, st=(G[0].q-G[0].p-k*len)/(k+1);
      G.sort((a, b)=>(along ? a.x-b.x : a.y-b.y)).forEach((h, j)=>{ const u=Math.round(G[0].p+st*(j+1)+j*len); if (along) h.x=u; else h.y=u; }); }
    for (const h of H){ delete h.seg; delete h.p; delete h.q; }
    return H;
  }
  static kw(v){ return String(Math.round(v*10)/10).replace('.', ','); }
  /** сведения для окна «Компоновка» и требований */
  static notes(plan){
    const h=plan.heat; if (!h) return;
    const iss=plan.issues, k=v=>this.kw(v/1000), t=StationNorms.deg(h.tout), nm={ compressor:'компрессор', dgu:'ДГУ', pump:'насос' };
    if (h.on){
      const run=h.base ? (h.qRun<=0 ? ` При работе ${nm[h.base.kind]||'агрегат'} поз. ${h.base.pos} даёт ${k(h.base.q)} кВт тепла${h.rec && h.base.kind!=='pump' ? ' (рециркуляция тёплого воздуха — рекуперация)' : ''} — потери покрыты, конвекторы отключаются терморегуляторами.`
        : ` При работе поз. ${h.base.pos}: ${k(h.base.q)} кВт тепла, подогрев забираемого воздуха ${k(h.base.a*this.AIR*h.dT)} кВт — конвекторы нужны и при работе (${k(h.qRun)} кВт).`) : '';
      if (!Number.isFinite((plan.req||{}).tmin)) iss.push({ level:'info', text:`Отопление посчитано до ${t} снаружи: зимней температуры в требованиях нет — уточните у заказчика и впишите в требованиях станции «Наружный воздух от, °C».` });
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
// осушителя); не нашлось места — своё место в ряду. Проход внутри есть всегда (станций «только с сервисными дверями» нет —
// решение ПНЕВМОТЕХ). Глушитель ДГУ — на крыше прямо над ДГУ. Отступы: сначала «не менее»
// (помещается ли), затем свободное место раздаётся до рекомендуемых; остаток длины — у двери. Блок-контейнер без своего
// размера — по необходимому месту (шаг 100 мм, наименьшая площадь пола); заданный контейнер, в который не помещается, —
// ошибка и подсказка, какой подойдёт; контейнер с большим запасом — подсказка, какой меньший подойдёт.
class StationLayout {
  static VER = 25;          // версия правил и рисунков: изменилась — картинки станций в КП пересобираются (ещё — версия программы в отпечатке)
  static get MAX_L(){ return StationMatrix.fit().maxL; }
  static get PIPE_PAD(){ return StationMatrix.grp('pipe').pad; }    // зазор вокруг фильтра на трубопроводе, мм
  static get AIR_Y(){ return StationMatrix.grp('pipe').airY; }       // линия сжатого воздуха: ось — в 150 мм от задней стены (или посередине между рядами)
  // сервисные двери и ворота: проём шире оборудования на service.addW (от service.min до service.max), створка до
  // service.leaf, высота не ниже двери оператора, от углов внутри — door.pad (матрица расстановки)
  static get DOOR(){ const s=StationMatrix.service(), d=StationMatrix.door(); return { min:s.min, max:s.max, leaf:s.leaf, h:d.h, pad:d.pad }; }
  // входная дверь оператора в стене прохода блок-контейнера: проём от торца (за тамбуром), мм — дверь в свету (матрица:
  // 900–1000 × 2000–2100) и коробка 50 мм с каждой стороны
  static get ENTRY(){ const d=StationMatrix.door(); return [300, 300+d.w+100]; }
  static get DOOR_MIN(){ return StationMatrix.door().w; }   // дверь оператора — не уже 900 мм в свету
  /** начало проёма шириной w на стене длиной W: по месту v, но не ближе pad к краям; стена уже — по середине */
  static inWall(v, w, W, pad){ return Math.round(W-2*pad<w ? (W-w)/2 : Math.max(pad, Math.min(W-pad-w, v))); }
  /** проёмы дверей и ворот (решение ПНЕВМОТЕХ): на одной стене между ними — не меньше door.gap, от края станции
   *  (наружного угла) — не меньше door.edge (матрица расстановки): {gap, eL — от торца по длине внутри, eW — от боковой стены
   *  по ширине внутри}, мм */
  static gaps(geo){ const d=StationMatrix.door(), e=geo && geo.ext, i=geo && geo.int, tL=e && i ? (e[0]-i[0])/2 : 0, tW=e && i ? (e[1]-i[1])/2 : 0;
    return { gap:d.gap, eL:Math.max(this.DOOR.pad, Math.ceil(d.edge-tL)), eW:Math.max(this.DOOR.pad, Math.ceil(d.edge-tW)) }; }
  static get PASS(){ return StationMatrix.move().pass; }   // вынос агрегата через проём и по проходу (на роликах): зазор с каждой стороны, мм
  /** сервисные ворота по размеру агрегата: ширина = сторона + service.addW (+ 2·T стенки), с округлением service.step, от
   *  service.min до service.max; высота = высота + service.addH (+ T), не ниже service.minH (не у стоящего плотно к стене — не
   *  ниже двери оператора) и под потолком на 100 мм */
  static svcW(len, T=0){ const s=StationMatrix.service(), st=s.step||100; return Math.max(s.min, Math.min(s.max, Math.ceil((len+s.addW+(s.wall===0 ? 0 : 2*T))/st)*st)); }
  static svcH(h, T, rear, H){ const s=StationMatrix.service(), st=Math.min(50, s.step||50); return Math.min(H-100, Math.max(rear ? s.minH : StationMatrix.door().h, Math.ceil((h+s.addH+(s.wall===0 ? 0 : T))/st)*st)); }   // сервисные ворота за агрегатом — проём обслуживания: по высоте агрегата, не ниже
  static get CAB_TOP(){ return StationMatrix.cab().top; }       // настенный шкаф: верх — на уровне глаз (рукоятки и панель оператора),
  static get CAB_LOW(){ return StationMatrix.cab().low; }       // низ — не ниже
  static get OUT_GAP(){ return StationMatrix.recv().outGap; }   // ресивер снаружи: от торцевой стены — проход для осмотра и обслуживания, мм
  static get OUT_STEP(){ return StationMatrix.recv().outStep; } // между ресиверами снаружи, мм
  static get PAD(){ return StationMatrix.recv().pad; }          // бетонная площадка под ресивером снаружи: высота над землёй, мм
  static get ROOF_GAP(){ return StationMatrix.muffler().gap; }  // глушитель ДГУ на опорах над крышей, мм
  static get OUTLET(){ return StationMatrix.muffler().outlet; } // вывод выхлопа — горизонтально в сторону радиатора, мм
  static ROAD_H = 4000;                                          // наибольшая высота при перевозке (с платформой), мм
  static CHASSIS_H = 1150;                                       // высота платформы шасси, мм

  static solve(input){ return new StationLayout(input).run(); }
  /** положение ворот в торце одной фразой: по оси торца, или смещены — на сколько и почему (вручную — с причиной менеджера) */
  static gateAxis(q){ if (!q || q.sea) return ''; if (q.full) return 'Ворота во весь торец — по оси торца.';
    return q.off ? `Ворота смещены от оси торца на ${this.n(Math.abs(q.off))} мм${q.offWhy ? ` — ${q.manual ? 'причина: ' : ''}${q.offWhy.replace(/^смещены на \S+ мм от оси торца /, '')}` : ' — причина не указана'}.` : 'Ворота — по оси торца.'; }

  /** отпечаток всего, от чего зависит компоновка: изменился — чертёж и 3D-вид пора обновить */
  static hash(input){
    const c=input.cont||{}, pick=a=>a ? {cat:a.cat, size:a.size, mass:a.mass, model:a.model, maker:a.maker, orient:a.orient, kw:a.kw, volume:a.volume, color:a.color, flow:a.flow, pressure:a.pressure, stage:a.stage, dryer:a.dryer, vsd:a.vsd, dewPoint:a.dewPoint, receiver:a.receiver} : null;
    // версия программы — в отпечатке: новая программа всегда пересобирает картинки, даже при своих сохранённых правилах
    const s=JSON.stringify([this.VER, typeof APP_VERSION!=='undefined' ? APP_VERSION : '', typeof StationRules!=='undefined' && StationRules.ok() ? StationRules.version()+'.'+StationRules.stamp() : '', StationClear.aisle(), [c.ctype, c.size, c.sizeAuto, c.lenFix||null, c.ins, StationPaint.stamp(c), c.mods ? JSON.stringify(StationMods.rect(c.mods.cells)) : null, c.sys||null, c.climate||'', c.roof||'', StationGeo.floor(c)], input.chassisH||null, input.recv||'', !!input.recvOut, input.req||null,
      (input.parts||[]).filter(p=>p && p.role!=='container').map(p=>[p.name, p.qty, p.role||'', p.pipeMat||'', p.dn||'', p.mount||'', pick(p.attrs), StationEquip.tint(p), StationEquip.tones(p), (p.rows||[]).filter(r=>r && /габарит|размер|масса|вес|цвет|окраск|покрыт|длина|ширина|высота|объ[её]м|RAL|установк|исполнен|производительн|пропускн|давлени|ступен|очистк|фильтр|осушител|регулирован|точк\S* росы|воздух|теплов|охлажд/i.test(String(r.k||'')+' '+String(r.v||''))).map(r=>[r.k, r.v]), StationEquip.pic(p)])]);
    return StationRules.fnv(s);
  }

  constructor(input){
    this.in=input||{}; this.cont=this.in.cont||null;
    this.eq=StationEquip.list(this.in.parts||[], { recv:this.in.recv, recvOut:this.in.recvOut });
    this.aisle0=StationClear.aisle(); this.aisle=this.aisle0; this.mode={};
    // зазор на коммуникации у стен (по длине и ширине — с обеих сторон) и под потолком: полезные размеры компрессорной
    // = внутренние − 2·G (по высоте — G под потолком: у пола коммуникаций нет); ДГУ и насосные — по своим нормам
    this.comp=this.eq.some(e=>e.kind==='compressor') && !this.eq.some(e=>e.kind==='dgu');
    this.G=this.comp ? StationMatrix.gap() : 0;
    this.dguSt=this.eq.some(e=>e.kind==='dgu' && e.place) && !this.eq.some(e=>e.place && (e.kind==='compressor' || e.kind==='pump'));   // ДГУ-станция — своя расстановка (rowD)
  }

  // ---- исключения, чтобы станция прошла по габариту перевозки (решение ПНЕВМОТЕХ, компрессорная): без продольного прохода
  // (компрессор у торца); проход оператора «в крайнем случае» — не меньше 600 мм (norm.aisle_tight; уже 600 мм — нельзя);
  // без сквозного прохода — агрегат поперёк станции и вторая дверь оператора (доступ ко всему
  // оборудованию — с разных сторон). Сначала — как обычно; исключения — только если иначе не помещается (негабарит — после них)
  static get TIGHT(){ return Math.max(600, StationRules.opt('norm.aisle_tight') || 600); }
  /** режимы по порядку: обычный, без продольного прохода (компрессор у торца — доступ через ворота), проход «в крайнем
   *  случае», без сквозного прохода, оба */
  modes(){ if (!this.comp) return [{}]; const M=StationMatrix.modes();
    return [{}, ...(M.ends ? [{ ends:true }] : []), ...(M.tight ? [{ tight:true }] : []), ...(M.cross ? [{ cross:true }] : []), ...(M.cross && M.tight ? [{ cross:true, tight:true }] : [])]; }
  /** выполнить fn в режиме m (проход «в крайнем случае»; агрегат поперёк; без продольного прохода) */
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
    if (m.ends && r.ends && r.ends.n>1){ const E=r.ends; r.issues.push({ level:'info', text:`Без продольного прохода: компрессоры поз. ${E.all.join(', ')} (${E.n} шт.) — рядом в ряд от торца по середине ширины, обслуживание спереди и сзади — через сервисные ворота с обеих сторон, сбоку — через ворота в торце и промежутки не меньше ${StationLayout.n(StationMatrix.modes().next)} мм между компрессорами и за последним; дверь оператора — между последним компрессором и ${E.next ? `поз. ${E.next}` : 'остальным оборудованием'}${E.recv.length ? `; ресиверы поз. ${E.recv.join(', ')} — в два ряда у дальнего торца, доступ — через ворота там` : ''}. Так ${why}.` }); }
    else if (m.ends && r.ends){ const E=r.ends; r.issues.push({ level:'info', text:`Без продольного прохода: поз. ${E.pos} (компрессор) — у торца по середине ширины, обслуживание спереди и сзади — через сервисные ворота с обеих сторон, сбоку — через ворота в торце; дверь оператора — между компрессором и ${E.next ? `поз. ${E.next}` : 'остальным оборудованием'}${E.recv.length ? `; ресиверы поз. ${E.recv.join(', ')} — в два ряда у дальнего торца, доступ — через ворота там` : ''}. Так ${why}.` }); }
    if (m.cross && r.cross) r.issues.push({ level:'warn', text:`Сквозного прохода нет: поз. ${r.cross.pos} стоит поперёк станции лицом к входу — к нему спереди и к оборудованию до него подходят от двери оператора, к нему сзади и к оборудованию за ним — через вторую дверь оператора. Доступ ко всему оборудованию остаётся с разных сторон. Исключение, чтобы ${why}.` });
    r.mode=m;
  }

  run(){
    const placed=this.eq.filter(e=>e.place), extra=this.eq.filter(e=>!e.place);
    const base={ items:[], extra, chassis:extra.some(e=>e.kind==='chassis'), muffler:extra.some(e=>e.kind==='muffler'), aisleRule:this.aisle, issues:[] };
    if (!this.cont) return Object.assign(base, { level:'none', text:'Выберите контейнер в составе станции.' });
    if (!placed.length) return Object.assign(base, { level:'none', text:'Добавьте в состав оборудование — компрессор, насос, ДГУ и т. п.' });
    let units=this.units(placed);
    const g0=StationGeo.of(this.cont), in0=g0.int || StationGeo.inner(g0.type, [10000, StationGeo.ROAD_W, 2600], g0.t), Wi=in0[1];
    // размер по оборудованию — бак по ширине обычного блок-контейнера (2 300 мм): станция шире ради бака не делается
    const We=g0.int ? g0.ext[1] : Math.min(StationGeo.ROAD_W, 2300), Wt=g0.int ? Wi : StationGeo.inner(g0.type, [10000, We, 2600], g0.t)[1];
    this.tank=this.tankRoom(units, Wt, in0[2], !!g0.sea, Wt-2*StationLayout.gaps({ ext:[0, We, 0], int:[0, Wt, 0] }).eW);        // ДГУ с дополнительным баком — бак в отдельном отсеке у ближнего торца
    if (this.tank) units=units.filter(e=>e.kind!=='tank');
    const geo=this.geoOf(this.cont); this.T=geo.t||0;
    let plan=geo.auto ? this.autoSize(units, geo) : this.in._mode ? this.fit(units, geo, [this.in._mode]) : this.fit(units, geo);   // удлинение (grow) — в том же режиме
    if (plan.level==='error' && !geo.auto) plan.suggest=this.suggest(units, geo);   // какой контейнер нужен (с проходом)
    else if (plan.level!=='error' && !geo.auto && !this.in._grow) this.excess(units, geo, plan);
    if (plan.level!=='error' && plan.items && plan.items.length){ plan.roof=this.roof(plan); plan.exhausts=this.exhausts(plan); this.outlet(plan); plan.piping=this.route(plan); plan.outside=this.outside(plan, extra.some(e=>e.kind==='chassis')); this.modsNotes(plan); }
    // «не помещается» точно, если не помещается и без оборудования с условными габаритами; иначе — лишь оценка (assumed)
    if (plan.level==='error' && units.some(e=>!e.known)){ const k=units.filter(e=>e.known);
      plan.assumed=!k.length || (geo.auto ? this.autoSize(k, geo) : this.fit(k, geo)).level!=='error'; }
    plan=Object.assign(base, plan, { issues:plan.issues||[] }, this.colors());
    const air=AirChain.check(this.eq, this.in.air, this.in.req && this.in.req.recvIn);
    if (air && plan.level!=='error'){ plan.air=air; plan.issues.push(...air.issues); }
    plan.vessels=PressureVessel.list(this.eq, Math.max(0, ...this.eq.filter(e=>e.kind==='compressor' && e.air).map(e=>e.air.bar||0)));
    plan.req=this.in.req||null; plan.climate=(this.cont && this.cont.climate)||'';
    if (plan.geo && plan.geo.ext) plan.geo.rise=StationGeo.rise(plan.geo.roof, plan.geo.ext[1]);
    if (plan.level!=='error' && plan.geo && plan.geo.ext && plan.int){ plan.heat=StationHeat.calc(plan); plan.fire=StationFire.calc(plan);
      plan.light=StationLight.calc(plan); plan.sockets=StationSockets.calc(plan); plan.power=StationPower.calc(plan); plan.pipe=StationPipe.calc(plan); plan.mass=StationMass.calc(plan); plan.issues.push(...StationMass.issues(plan.mass));
      plan.vent=StationVent.calc(plan);   // жалюзи: размеры по расходу воздуха, места — мимо дверей, шкафов, конвекторов и знаков
      plan.tidy=StationTidy.score(plan, plan.geo);   // аккуратность компоновки (оценка и пояснения)
      if (plan.fire.low) plan.issues.push({ level:'info', text:`Высота помещения ${StationLayout.n(plan.int[2])} мм — ниже паспортной высоты установки модулей «Буран-2,5» (2,5–3,5 м): зона тушения — по диаграмме распыла изготовителя при этой высоте (согласовать с проектировщиком пожаротушения).` });
      const pq=plan.pipe; if (pq && pq.small) plan.issues.push({ level:'warn', text:`Трубопровод DN ${pq.set} меньше расчётного DN ${pq.dn} (${pq.why}): скорость больше ${String(pq.lines[0].v).replace('.', ',')} м/с — потери давления и шум. Укажите DN ${pq.dn} в составе станции.` }); }
    if (plan.level!=='error') StationNorms.check(plan, this.eq);
    this.notes(plan);
    if (plan.level==='ok' && plan.issues.some(i=>i.level==='warn')) plan.level='warn';
    return this.grow(plan, geo);
  }
  /** плотность компоновки подобранного размера (названия — как у готовых наборов правил): просторно — рекомендуемые
   *  отступы и проход; плотно — допустимые; максимально плотно — исключения (без продольного прохода, проход 600 мм,
   *  агрегат поперёк) */
  static density(lw, m, r, wide){
    const md={ ...(m||{}), ...(r.mode||{}) }, ex=[md.ends && 'без продольного прохода', md.tight && 'проход в крайнем случае', md.cross && 'агрегат поперёк'].filter(Boolean);
    const roomy=lw===0 || !(r.issues||[]).some(i=>/рекоменд/i.test(i.text));   // всё рекомендуемое вышло и на уровне «плотно» (длина задана с запасом)
    const d=ex.length ? { id:'max', title:'Максимально плотно', text:ex.join(', ') } : roomy ? { id:'roomy', title:'Просторно', text:'рекомендуемые отступы и проход' } : { id:'dense', title:'Плотно', text:'допустимые отступы и проход' };
    if (wide) d.text+=', негабарит по ширине'; return d;
  }
  /** размер подобран плотно (решение ПНЕВМОТЕХ): отступы и проход меньше рекомендуемых, но не меньше допустимых — так
   *  задумано, а не недочёт: сведения, а не предупреждения */
  static soft(r){
    if (!StationMatrix.fit().dense) return r;
    for (const i of r.issues||[]) if (i.level==='warn' && !i.wide && /рекоменд/.test(i.text) && !/исключение/i.test(i.text)) i.level='info';
    if (r.level==='warn' && !r.issues.some(i=>i.level==='warn')) r.level='ok';
    return r;
  }
  /** размер «по оборудованию»: жалюзи притока или выброса не поместились на стенах — контейнер длиннее (поиск шагами по
   *  500 мм, затем наименьшая длина с шагом 100 мм; до +3 000 мм и не длиннее наибольшего); не вышло — как есть (с замечанием) */
  grow(plan, geo){
    const hs=p=>!!(p.heat && p.heat.short), vs=p=>!!(p.vent && (p.vent.short.in>0 || p.vent.short.out>0));
    if (!geo.auto || geo.fixL || this.in._grow || plan.level==='error' || !plan.vent || !(vs(plan) || hs(plan)) || !plan.geo || !plan.geo.ext) return plan;
    // жалюзи не встают — длиннее до 3 000 мм; конвекторам нет места — длиннее не больше чем на 500 мм (иначе — замечание:
    // мощность другим способом; плотная компоновка важнее)
    // из модулей — длиннее каждый модуль (размер в составе — модуля)
    const [L0, W, H]=plan.geo.ext, MD=plan.geo.mods, ka=MD ? MD.a : 1, S=StationGeo.STEP*ka, V=vs(plan), bad=p=>V ? vs(p) : hs(p), MAXL=StationLayout.MAX_L*ka;
    const at=Lx=>{ const p=new StationLayout({ ...this.in, _grow:true, _mode:plan.mode||{}, cont:{ ...this.cont, size:MD ? `${Lx/ka} × ${W/MD.b} × ${H}` : `${Lx} × ${W} × ${H}`, sizeAuto:false } }).run();
      return p.level==='error' || !p.vent || bad(p) ? null : p; };
    const ok=(p, Lx)=>{ p.geo.auto=true; p.picked=true; p.density=plan.density; StationLayout.soft(p);
      const wd=plan.issues.filter(i=>i.wide); if (wd.length){ p.issues.unshift(...wd); if (p.level==='ok') p.level='warn'; }   // негабарит — и в удлинённом
      p.issues.push({ level:'info', text:`Длина контейнера ${StationLayout.n(Lx)} мм (по оборудованию — ${StationLayout.n(L0)} мм): так помещаются ${V ? 'жалюзи притока и выброса' : 'конвекторы отопления'}.` });
      return p; };
    const F=StationMatrix.fit();   // насколько можно удлинить: жалюзи — fit.growVent (3 000 мм), конвекторы — fit.growHeat (500 мм)
    if (!V){ for (let Lx=L0+S; Lx<=Math.min(MAXL, L0+F.growHeat*ka); Lx+=S){ const p=at(Lx); if (p) return ok(p, Lx); } return plan; }
    for (let Lx=L0+5*S; Lx<=Math.min(MAXL, L0+F.growVent*ka); Lx+=5*S){
      let p=at(Lx); if (!p) continue;
      for (let L2=Lx-4*S; L2<Lx; L2+=S){ const q=L2>L0 ? at(L2) : null; if (q){ p=q; Lx=L2; break; } }   // наименьшая длина — с шагом 100 мм
      return ok(p, Lx);
    }
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
    const c=StationClear.of(e.kind, e), w=StationMatrix.wall(e);
    if (e.kind==='dgu'){ const R=StationMatrix.grp('dgu').rad; return { ...c, far:[R, R] }; }   // радиатор — вплотную к жалюзи (решение владельца 19.10)
    if (!w || e.kind==='cabinet' || e.kind==='tank') return c;
    return { ...c, back:[w[0], StationLayout.gated(e.kind) ? w[1] : Math.max(w[1], Math.min(w[0], c.back[1]))] };
  }
  /** вид обслуживают сзади (матрица: сторона «З») и ему допускаются сервисные ворота за ним (ДГУ — своя дверь-жалюзи) */
  static gated(kind){ return kind!=='dgu' && kind!=='cabinet' && kind!=='tank' && !StationMatrix.noDoor(kind) && StationMatrix.sides(kind).B; }
  // ДГУ с дополнительным топливным баком: бак — в отдельном отсеке у ближнего торца. Отсек отделён противопожарной
  // перегородкой 1-го типа (EI 45, без проёмов; топливопровод — через гильзу с уплотнением), вход — ворота в торце (tank.gates)
  // или своя дверь снаружи, заливная горловина — в нише стены с лючком заподлицо, дыхательный клапан с огнепреградителем — над крышей, бак — в поддоне
  // на полный объём, в отсеке — естественная вентиляция (жалюзи внизу и вверху)
  static get TANK(){ return StationMatrix.tank(); }
  /** отсек бака: {units — [{e, lx — вдоль контейнера, ly — поперёк}], room — длина отсека внутри, len — с перегородкой};
   *  бак — поперёк, если перед ним остаётся проход (отсек короче); нет ДГУ или бака — null. Wi — ширина внутри */
  tankRoom(units, Wi, Hi, sea, gMax=Wi){
    const T=units.filter(e=>e.kind==='tank'); if (!T.length || !units.some(e=>e.kind==='dgu')) return null;
    const C=StationLayout.TANK, open=C.gates && !sea;
    // бак без своих габаритов — по объёму под этот отсек: выше — почти под потолок, глубже — с воротами в торце на всю ширину
    // контейнера (решение владельца 19.10; проход перед баком не нужен — к нему через ворота), иначе — не уже прохода перед ним
    // с воротами — не шире их наибольшего проёма (бак меняют через ворота: зазор move.pass с каждой стороны)
    const deep=open ? Math.min(Wi-2*C.back, gMax-2*StationLayout.PASS) : Wi-C.back-C.aisle;
    for (const e of T) if (!e.known){ const d=TankSize.of(e.vol||1000, { h:(Hi||TankSize.H)-C.top, w:deep }); e.l=d.l; e.w=d.w; e.h=d.h; }
    const U=T.map(e=>{ const a=Math.max(e.l, e.w), b=Math.min(e.l, e.w); return a<=deep ? { e, lx:b, ly:a } : { e, lx:a, ly:b }; });
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
    // вход в отсек — двустворчатые ворота в торце (tank.gates, решение владельца 19.10: монтаж и замена бака), у морского — его
    // двери; горловина — в нише заподлицо с лючком: в торце рядом с воротами, не встала — в стене с дверью оператора
    if (C.gates && !geo.sea){ const Q=StationLayout.gaps(geo), Ts=T.reduce((a, i)=>[Math.min(a[0], i.y), Math.max(a[1], i.y+i.ly)], [W, 0]);
      const w=Math.min(W-2*Q.eW, StationLayout.dguDoorW(Ts[1]-Ts[0])), y0=Math.round(Math.max(Q.eW, Math.min(W-Q.eW-w, (Ts[0]+Ts[1])/2-w/2))), h=Math.min(H-100, Math.max(StationLayout.DOOR.h, Math.max(...T.map(i=>i.h))+150));
      r.fuel.door=null; r.fuel.gate={ wall:'left', y0, y1:y0+w, w, h, leaves:2 };
      const fy=y0-Q.gap-150; r.fuel.fill=fy-150>=Q.eW ? { wall:'left', y:Math.round(fy), z:C.fill } : { wall:'front', x:Math.round(t.room/2), z:C.fill }; }
    r.fuel.fill.niche=true;   // горловина утоплена в стену, лючок заподлицо — габарит не меняется
    const iss=r.issues=r.issues||[], aisle=Math.min(...T.map(i=>i.y));
    if (aisle<C.aisle && !r.fuel.gate) iss.push({ level:'warn', text:`Отсек топливного бака: проход перед баком ${n(aisle)} мм — меньше ${n(C.aisle)} мм.` });
    for (const i of T) if (i.h+200>H){ r.bad=true; iss.push({ level:'error', text:`Топливный бак поз. ${i.pos} не проходит по высоте отсека: ${n(i.h)} мм, внутри ${n(H)} мм.` }); }
  }
  /** в два ряда — в задний ряд: ДГУ; аппараты цепочки сжатого воздуха (если есть компрессоры) — подряд по ходу воздуха;
   *  ресиверы — в любом ряду (решение ПНЕВМОТЕХ: ресиверы можно ставить в два ряда) */
  backRow(e, units){ return e.kind==='dgu' || (units.some(u=>u.kind==='compressor') && ((StationLayout.series(e) && e.kind!=='receiver') || (e.slot && e.kind==='filter'))); }
  /** аппарат на линии сжатого воздуха с одним входом и одним выходом (ресивер, осушитель, фильтр на полу) */
  static series(e){ return !!e.air && e.air.stage!=null && e.kind!=='compressor' && e.mount!=='pipe' && !e.pipe; }
  static key(e){ return e.id+'#'+e.unit; }
  /** осушитель рисуется двумя колоннами: адсорбционный или генератор (вид — из цепочки сжатого воздуха: категория каталога,
   *  название, характеристики), а не по одному названию */
  static twinDryer(it){ const t=it && it.air && it.air.type; return t ? t==='ads' || t==='gen' : /адсорбц|десикант|adsorp|desicc/i.test(String((it && it.name)||'')); }

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
    const canRot=o=>!noRotate && StationLayout.turnable(o.e);   // шкаф — дверцами к проходу
    const pw=o=>Math.min(o.e.c.back[1], StationMatrix.recv().pairWall);   // пара у торца — от стен до recv.pairWall
    const need=o=>depth(o)+(o.end ? 2*pw(o) : o.e.c.back[1]+this.front(o.e)[1]), wide=o=>need(o)<=W;
    for (const o of U) if (!wide(o) && canRot(o)){ o.rot=true; if (!wide(o)) o.rot=false; }
    const narrow=U.filter(o=>!wide(o));
    if (narrow.length) return { ok:false, why:'width', bad:narrow.map(o=>o.e), needW:Math.max(...narrow.map(need)) };
    const len=lvl=>this.chain(U.map(o=>o.e), lvl).sum+U.reduce((s, o)=>s+lenX(o), 0);
    if (this.recv2) this.endPairs(U, wide, ()=>false);   // подбор размера: вариант с ресиверами в два ряда в конце ряда
    if (len(1)>Lu){   // не хватает длины — поворачиваем поперёк то, что позволяет ширина (сначала дающее больше длины): сначала —
      // только если и после поворота сзади остаётся рекомендуемый отступ (иначе агрегат «плотно к стене» — сервисные ворота), затем любые
      const roomy=o=>depth(o)+o.e.c.back[0]+this.front(o.e)[1]<=W;
      for (const ok of [roomy, wide]){ if (len(1)<=Lu) break; StationLayout.turn(U.filter(o=>canRot(o) && !o.rot), ok, ()=>len(1)<=Lu); } }
    const lv=this.squeeze(U, len, Lu, wide, noRotate);
    if (len(lv)>Lu) return { ok:false, why:'length', needL:len(1), needL0:len(0), needLc:len(2) };
    return this.place([U], Lu, W, depth, lenX, lv);
  }
  /** агрегат «пара ресиверов один за другим» (передний a, задний b, промежуток gap между ними): глубина — оба и промежуток */
  static pairUnit(a, b, gap){ return Object.assign({}, a, { l:Math.max(a.l, b.l), w:a.w+gap+b.w, h:Math.max(a.h, b.h), pairD:Math.max(a.w, b.w) }); }
  /** можно повернуть боком (поперёк): разрешено матрицей, короб и заметно длиннее, чем глубже */
  static turnable(e){ return StationMatrix.rot(e.kind) && e.shape==='box' && e.l>e.w+50; }
  /** не хватает длины — поворачиваем боком (сначала дающее больше длины), пока ok(o) после поворота и ряд не уложится (fits) */
  static turn(list, ok, fits){
    for (const o of list.sort((a, b)=>(b.e.l-b.e.w)-(a.e.l-a.e.w))){ o.rot=true; if (!ok(o)){ o.rot=false; continue; } if (fits()) break; }
  }
  /** не хватает длины (после поворотов): крайний случай — ресиверы и фильтры вплотную в линию (только в заданном
   *  контейнере: подобранный по размеру просто длиннее), затем ресиверы парой — один за другим поперёк. Уровень промежутков
   *  «не менее»: 1 или 2 (вплотную) */
  squeeze(U, len, Lu, wide, noRotate){
    if (len(1)<=Lu) return 1;
    // сначала ресиверы в два ряда с обычными промежутками, «вплотную» — последним приёмом (решения владельца 12.10, 14.10, 19.10)
    const done1=()=>len(1)<=Lu;
    if (!noRotate) this.pairs(U, wide, done1);   // ресиверы — парой (один за другим)
    if (!noRotate && !done1()) this.endPairs(U, wide, done1);   // ресиверы в конце ряда — парами поперёк, во всю ширину
    if (len(1)<=Lu) return 1;
    if (this.closeOk && len(2)<=Lu) return 2;
    // самый крайний случай — без прохода к боку агрегата у торца (замечание в «Доступ к оборудованию»)
    return len(1)<=Lu || !this.closeOk ? 1 : len(2)<=Lu ? 2 : 3;
  }

  // ---- ресиверы в два ряда: соседние — парой, один за другим (задний — ближе к стене); осмотр заднего — сбоку, через
  // промежутки между ресиверами; пара — как один агрегат в ряду (глубина — два ресивера и промежуток между ними)
  pairs(U, wide, done){
    for (let k=0; k<U.length-1 && !done(); k++){ const a=U[k], b=U[k+1];
      if (a.pair || b.pair || a.rot || b.rot || a.e.kind!=='receiver' || b.e.kind!=='receiver' || a.e.slot || b.e.slot) continue;
      const gap=Math.max(a.e.c.side[1], b.e.c.side[1]), o={ e:StationLayout.pairUnit(a.e, b.e, gap), rot:false, pair:[a.e, b.e], gap }; if (!wide(o)) continue;
      U.splice(k, 2, o); }
  }
  /** ресиверы в два ряда в конце ряда — поперёк контейнера, чтобы станция была короче (решение ПНЕВМОТЕХ): хвост
   *  цепочки из ресиверов — парами один за другим во всю ширину (передний — не ближе 300 мм к стене прохода); проход доходит
   *  до пары сбоку, осмотр заднего — сбоку через промежутки; друг к другу вплотную — только в заданном контейнере */
  endPairs(U, wide, done){
    const solo=o=>!o.pair && !o.rot && o.e.kind==='receiver' && !o.e.slot && !o.e.cross;
    let k=U.length; while (k>0 && solo(U[k-1])) k--;
    for (let j=U.length-2; j>=k && !done(); j-=2){ const a=U[j], b=U[j+1];
      let o=null; for (const g of this.closeOk ? [Math.max(a.e.c.side[1], b.e.c.side[1]), 0] : [Math.max(a.e.c.side[1], b.e.c.side[1])]){
        const t={ e:StationLayout.pairUnit(a.e, b.e, g), rot:false, pair:[a.e, b.e], gap:g, end:true }; if (wide(t)){ o=t; break; } }
      if (!o) break; U.splice(j, 2, o); }
  }
  /** пара ресиверов → два места: передний — у прохода, задний — за ним */
  unpair(it, geo){
    const [f, b]=it.o.pair, g=it.o.gap, mk=(e, y, d, back, aisle)=>this.item({ o:{ e, rot:false }, ri:it.ri, x:it.x+Math.round((it.lx-e.l)/2), lx:e.l, d, y, face:it.face, back, aisle }, geo);
    const E=it.o.end ? { pairEnd:true } : {};
    return [Object.assign(mk(f, it.y, f.w, it.back+g+b.w, it.aisle), { pair:true }, E), Object.assign(mk(b, it.y+f.w+g, b.w, it.back, it.aisle+f.w+g), { pair:true }, E)];
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
      StationLayout.turn([...A, ...B].filter(o=>StationLayout.turnable(o.e)), fits, ()=>L()<=Lu);
    if (L()>Lu && this.closeOk){ lv=2; if (L()>Lu){ lv=3; if (L()>Lu) lv=1; } }   // крайний случай — ресиверы и фильтры вплотную, затем без прохода у торца
    if (L()>Lu) return { ok:false, why:'length2', needL:L(), needL0:L0, needLc:Math.max(lenOf(A, 2), lenOf(B, 2)) };
    return this.place([B, A], Lu, W, dep, lx, lv);
  }

  // ---- без сквозного прохода (исключение, компрессорная): один ряд у задней стены, а агрегат, который с проходом не встаёт
  // по ширине, — поперёк станции лицом к входу (по середине ширины). Перед ним — проход обслуживания от двери оператора, за
  // ним — отступ сзади и вторая часть станции со своей дверью оператора: к нему сзади и к оборудованию за ним
  rowX(units, Lu, W, noRotate){
    const U=units.map(e=>({ e, rot:false })), depth=o=>o.e.cross ? o.e.l : o.rot ? o.e.l : o.e.w, lenX=o=>o.e.cross ? o.e.w : o.rot ? o.e.w : o.e.l;
    const canRot=o=>!noRotate && StationLayout.turnable(o.e);
    const need=o=>depth(o)+o.e.c.back[1]+this.front(o.e)[1], wide=o=>o.e.cross || need(o)<=W;
    for (const o of U) if (!wide(o) && canRot(o)){ o.rot=true; if (!wide(o)) o.rot=false; }
    const narrow=U.filter(o=>!wide(o));
    if (narrow.length!==1) return { ok:false, why:'width', bad:narrow.map(o=>o.e), needW:narrow.length ? Math.max(...narrow.map(need)) : W+1 };
    const X=narrow[0]; if (/^(dgu|cabinet|pump)$/.test(X.e.kind) || X.e.slot || X.e.l>W) return { ok:false, why:'width', bad:[X.e], needW:need(X) };
    X.rot=false; X.e=Object.assign({}, X.e, { cross:true });
    const len=lvl=>this.chain(U.map(o=>o.e), lvl).sum+U.reduce((s, o)=>s+lenX(o), 0);
    if (len(1)>Lu) StationLayout.turn(U.filter(o=>!o.e.cross && canRot(o)), wide, ()=>len(1)<=Lu);
    const lv=this.squeeze(U, len, Lu, wide, noRotate);
    if (len(lv)>Lu) return { ok:false, why:'length', needL:len(1), needL0:len(0), needLc:len(2) };
    return this.place([U], Lu, W, depth, lenX, lv);
  }

  // ---- без продольного прохода (исключение, компрессорная; решение ПНЕВМОТЕХ): компрессор — у торца по середине
  // ширины, обслуживание спереди и сзади — через сервисные ворота с обеих сторон, сбоку — через ворота в торце; за ним —
  // дверь оператора (между компрессором и осушителем), дальше — осушители и прочее с проходом перед ними; ресиверы — в два
  // ряда у дальнего торца, доступ — через ворота там, при необходимости плотнее (в паре — до вплотную, от стен — как
  // «плотно» у компрессора). Контейнер уже — в габарит перевозки.
  // Несколько компрессоров — рядом в ряд от торца (так короче трубопровод), каждый по середине ширины с сервисными воротами
  // спереди и сзади; между компрессорами и за последним — не меньше modes.next (1 000 мм) для обслуживания сбоку; дверь
  // оператора — за последним компрессором
  rowE(units, Lu, W, T=0, pe=StationMatrix.door().edge){
    const C=units.filter(e=>e.kind==='compressor' && !e.slot);
    if (!C.length || units.some(e=>/^(dgu|pump|tank)$/.test(e.kind))) return { ok:false, why:'mode' };
    const c=C[0], nc=C.length, n=StationLayout.n, aRec=this.aisle[0], twOf=e=>{ const wt=StationMatrix.wall(e); return wt ? wt[1] : e.c.back[1]; }, tw=twOf(c);
    const wide=C.filter(e=>e.w+2*twOf(e)>W); if (wide.length) return { ok:false, why:'width', bad:wide, needW:Math.max(...wide.map(e=>e.w+2*twOf(e))) };
    // шкафы и фильтры, которым места на стене и трубе не нашлось, — перед ресиверами (ресиверы — у дальнего торца)
    const isR=e=>e.kind==='receiver' && !e.slot, rest=units.filter(e=>!C.includes(e)); let t=rest.length; while (t>0 && (isR(rest[t-1]) || rest[t-1].slot)) t--;
    const U=[...C.map(e=>({ e, rot:false, ends:true })), ...[...rest.slice(0, t), ...rest.slice(t).filter(e=>!isR(e)), ...rest.slice(t).filter(isR)].map(e=>({ e, rot:false }))];
    // ресиверы в конце — парами поперёк (решение ПНЕВМОТЕХ: «плотнее для сохранения 2-рядной компоновки»): сначала от
    // стен — до 100 мм («плотно» компрессора), промежуток в паре — по правилу «ресивер — ресивер»: рекомендуемый, при нехватке
    // ширины — сколько есть, но не меньше «не менее»; меньше (до вплотную) — только при отметке «вплотную можно»; иначе
    // ресиверы — в ряд
    let k=U.length; while (k>1 && U[k-1].e.kind==='receiver' && !U[k-1].e.slot) k--;
    const cw=(StationMatrix.wall({ kind:'compressor', w:0 })||[0, 100])[1];   // от стен — до «плотно» компрессора (100 мм)
    for (let j=U.length-2; j>=k; j-=2){ const a=U[j].e, b=U[j+1].e, pr=StationMatrix.pair(a, b), rw=Math.min(Math.max(a.c.back[1], b.c.back[1]), cw);
      const lo=pr ? (pr[2]===0 ? 0 : pr[1]) : 300, g=Math.min(pr ? pr[0] : 300, W-a.w-b.w-2*rw); if (g<lo || W-a.w-b.w-g<2*tw) break;
      U.splice(j, 2, { e:StationLayout.pairUnit(a, b, g), rot:false, pair:[a, b], gap:g, end:true }); }
    const need=o=>o.e.w+o.e.c.back[1]+this.front(o.e)[1], bad=U.filter(o=>!o.ends && !o.end && need(o)>W);
    if (bad.length) return { ok:false, why:'width', bad:bad.map(o=>o.e), needW:Math.max(...bad.map(need)) };
    // промежуток за компрессором: дверь оператора (с коробкой) мимо его сервисных ворот (шире его на addW, с шагом 100 мм) —
    // через door.gap; от края станции — не ближе door.edge (pe — внутри от торца)
    const D=StationLayout.DOOR, Ew=StationLayout.ENTRY[1]-StationLayout.ENTRY[0], dg=StationMatrix.door().gap;
    const ovOf=e=>Math.max(0, (StationLayout.svcW(e.l, T)-e.l)/2), ov=ovOf(c), cl=C[nc-1], dn=Math.ceil(ovOf(cl)+dg+Ew+D.pad), nx=StationMatrix.modes().next;
    // от торца — «плотно», но его сервисные ворота (шире его) не упираются в угол; между компрессорами — не меньше modes.next
    // и чтобы их сервисные ворота стояли через door.gap; за последним — дверь оператора, не меньше modes.next
    const E=U.map(o=>o.e), gapsOf=lvl=>{ const g=this.chain(E, lvl).gaps; g[0]=Math.max(tw, Math.ceil(ov+Math.max(D.pad, pe)-this.G));
      for (let i=1; i<nc; i++) g[i]=Math.max(g[i], nx, Math.ceil(ovOf(C[i-1])+ovOf(C[i])+2*dg+Ew));   // и дверь оператора между ними
      g[nc]=Math.max(g[nc], dn, nx); return g; };
    const body=U.reduce((s, o)=>s+o.e.l, 0), rec=gapsOf(0), mn=gapsOf(this.closeOk ? 2 : 1), sum=a=>a.reduce((s, v)=>s+v, 0);   // вплотную — ресиверы и фильтры (крайний случай)
    if (body+sum(mn)>Lu) return { ok:false, why:'length', needL:body+sum(mn), needL0:body+sum(rec) };
    const q=sum(rec)>sum(mn) ? Math.max(0, Math.min(1, (Lu-body-sum(mn))/(sum(rec)-sum(mn)))) : 1;
    const gaps=mn.map((v, i)=>Math.floor(v+(rec[i]-v)*q)); gaps[nc]+=Lu-body-sum(gaps);   // свободная длина — у двери оператора
    const items=[], iss=[]; let x=gaps[0];
    U.forEach((o, i)=>{ const d=o.e.w, budget=W-d, it={ o, ri:0, x, lx:o.e.l, d, face:-1 };
      if (o.ends || o.end){ it.back=Math.round(budget/2); it.aisle=budget-it.back; }
      else { const b=o.e.c.back, fr=this.front(o.e)[0]; it.back=budget-b[0]>=fr ? b[0] : budget-fr>=b[1] ? budget-fr : b[1]; it.aisle=budget-it.back; }
      it.y=W-it.back-d; items.push(it); x+=o.e.l+gaps[i+1]; });
    const ce=items[nc-1].x+cl.l, entry=[Math.round(Math.max(ce+ovOf(cl)+dg, ce+(gaps[nc]-Ew)/2)), 0]; entry[1]=entry[0]+Ew;
    const eq=items.filter(i=>!i.o.ends && !i.o.end && !i.o.e.slot), aisleW=eq.length ? Math.min(...eq.map(i=>i.aisle)) : W-c.w;
    if (eq.length && aisleW<aRec) iss.push({ level:'warn', text:`Проход обслуживания ${n(aisleW)} мм — меньше рекомендуемых ${n(aRec)} мм (допустимо от ${n(this.aisle[1])} мм).` });
    if (q<1 && gaps.length>2) iss.push({ level:'warn', text:`Промежутки между оборудованием уменьшены до ${n(Math.min(...gaps.slice(1, -1)))} мм — по длине не хватает места для рекомендуемых.` });
    return { ok:true, rows:1, aisleW, items, iss, entry };
  }

  // ---- ДГУ-станция (решение владельца 19.10): радиатор каждой ДГУ — вплотную к своим жалюзи (dgu.rad), у каждой — свой выброс
  // горячего воздуха и свой выхлоп. Одна ДГУ — вдоль, радиатором к дальнему торцу; две без бака — по одной у каждого торца
  // радиаторами наружу, между ними — проход и дверь оператора; от dgu.across штук (и две с баком — левый торец занят отсеком) —
  // поперёк, радиаторами к задней стене, генератором к проходу. Поворот на 90° — и одной или двум, если так короче (dgu.rot).
  /** варианты для этих ДГУ: line — вдоль (одна), ends — к двум торцам, across — поперёк */
  dguWays(D){
    const M=StationMatrix.grp('dgu'), n=D.length, w=[];
    if (n===1 || this.inMods) w.push('line'); else if (n===2 && M.two && !this.tank) w.push('ends');   // из модулей — и в линию вдоль (каждая в своём модуле)
    if (n===2 && M.two && !this.tank && this.inMods) w.push('ends');
    if (n>=M.across || (n>=2 && (this.tank || !M.two)) || M.rot) w.push('across');
    return w.length ? w : ['across'];
  }
  /** ряд ДГУ-станции: лучший из вариантов — помещается и короче (поровну — по порядку: вдоль, к торцам, поперёк) */
  rowD(units, Lu, W){
    const D=units.filter(e=>e.kind==='dgu'), O=units.filter(e=>e.kind!=='dgu');
    let best=null, fail=null;
    for (const way of this.dguWays(D)){
      let r=way==='line' ? this.dLine(units, Lu, W) : way==='ends' ? this.dEnds(D, O, Lu, W) : this.dAcross(D, O, Lu, W);
      if (r.ok && this.jGeo && Lu>0) r=this.joints(r, this.jGeo, Lu, W);   // из модулей: каждая ДГУ — в своём модуле
      if (r.ok){ if (!best || r.used<best.used) best=r; }
      else if (!fail || (fail.why==='width' && r.why!=='width') || (r.why===fail.why && (r.needL||r.needW||0)<(fail.needL||fail.needW||0))) fail=r; }
    return best || fail;
  }
  /** одна ДГУ вдоль: прежний ряд, радиатор — к дальнему торцу (отступ — clear far = dgu.rad) */
  dLine(units, Lu, W){
    const r=this.row1(units, Lu, W, true); if (!r.ok) return r;
    for (const it of r.items) if (it.o.e.kind==='dgu'){ it.o.rad='right'; Object.assign(it, this.dMid(it.o.e, it.d, W)); }
    r.aisleW=Math.min(...r.items.map(i=>i.aisle)); r.iss=(r.iss||[]).filter(i=>!/^Проход обслуживания/.test(i.text)); this.dPass(r.items, r.iss);
    r.used=Math.max(...r.items.map(i=>i.x+i.lx)); r.way='line'; return r;
  }
  /** ДГУ вдоль — посередине ширины контейнера (решение владельца 19.10, отступы уменьшены: проход с каждой стороны — не
   *  меньше dgu.pass, иначе замечание) */
  dMid(e, d, W){ const y=Math.round((W-d)/2); return { back:W-d-y, aisle:y, y }; }
  /** замечание: проход вдоль ДГУ посередине уже dgu.pass */
  dPass(items, iss){ const P=StationMatrix.grp('dgu').pass, n=StationLayout.n, a=Math.min(...items.filter(i=>i.o.e.kind==='dgu').map(i=>i.aisle));
    if (a<P) iss.push({ level:'warn', text:`ДГУ посередине ширины: проход с каждой стороны ${n(a)} мм — меньше ${n(P)} мм («Настройки → Правила компоновки → ДГУ в контейнере»); нужен контейнер шире.` }); }
  /** задний отступ и проход у агрегата глубиной d (один ряд): сзади — рекомендуемый, если проход остаётся не уже допустимого */
  dBack(e, d, W){ const b=e.c.back, budget=W-d, fm=this.front(e)[1]; const back=budget-b[0]>=fm ? b[0] : budget-fm>=b[1] ? budget-fm : b[1]; return { back, aisle:budget-back, y:W-back-d }; }
  /** две ДГУ — у торцов радиаторами наружу; между генераторами — проход обслуживания (сторона генератора — clear side) и дверь
   *  оператора в стене прохода (с промежутками door.gap); прочее на полу — между ними */
  dEnds(D, O, Lu, W){
    const R=StationMatrix.grp('dgu').rad, [A, B]=D, dg=StationMatrix.door().gap, Ew=StationLayout.ENTRY[1]-StationLayout.ENTRY[0];
    const need=e=>e.w+e.c.back[1]+this.front(e)[1], bad=D.filter(e=>need(e)>W);
    if (bad.length) return { ok:false, why:'width', bad, needW:Math.max(...bad.map(need)) };
    // прочее — сразу за ДГУ у входа; дверь оператора — в промежутке между прочим и второй ДГУ (не уже двери с промежутками)
    const mid=lvl=>{ const l1=Math.min(1, lvl), s=Math.max(A.c.side[l1], B.c.side[l1]);
      if (!O.length) return Math.max(s, Ew+2*dg);
      let m=Math.max(A.c.side[l1], O[0].c.side[l1]); for (let i=1; i<O.length; i++) m+=Math.max(O[i-1].c.side[l1], O[i].c.side[l1]);
      return m+Math.max(O[O.length-1].c.side[l1], B.c.side[l1], Ew+2*dg)+O.reduce((s2, e)=>s2+e.l, 0); };
    const body=A.l+B.l+2*R, needL=body+mid(1), needL0=body+mid(0);
    if (needL>Lu) return { ok:false, why:'length', needL, needL0, needLc:needL };
    const items=[], iss=[], put=(e, x, rad)=>{ const o={ e, rot:false, rad }, q=this.dMid(e, e.w, W); items.push({ o, ri:0, x, lx:e.l, d:e.w, face:-1, ...q }); };
    put(A, R, 'left'); put(B, Lu-R-B.l, 'right');
    const x1=R+A.l, x2=Lu-R-B.l;
    if (O.length){ const s0=Math.max(A.c.side[1], O[0].c.side[1]); let x=x1+s0;
      for (let i=0; i<O.length; i++){ const e=O[i], q=this.dBack(e, e.w, W); items.push({ o:{ e, rot:false }, ri:0, x, lx:e.l, d:e.w, face:-1, ...q }); x+=e.l+(i<O.length-1 ? Math.max(e.c.side[1], O[i+1].c.side[1]) : 0); } }
    // дверь оператора — по середине самого широкого промежутка между генераторами и прочим
    const occ=items.map(i=>[i.x, i.x+i.lx]).sort((a, b)=>a[0]-b[0]), gaps=[];
    for (let i=1; i<occ.length; i++) gaps.push([occ[i-1][1], occ[i][0]]);
    const g=gaps.filter(([a, b])=>a>=x1 && b<=x2).sort((p, q)=>(q[1]-q[0])-(p[1]-p[0]))[0] || [x1, x2], e0=Math.round((g[0]+g[1]-Ew)/2);
    const aisleW=Math.min(...items.map(i=>i.aisle)); this.dPass(items, iss);
    return { ok:true, rows:1, aisleW, items, iss, entry:[e0, e0+Ew], used:Lu, way:'ends' };
  }
  /** ДГУ поперёк: повёрнуты на 90°, радиатор — к задней стене (dgu.rad), генератор — к проходу у передней стены (не уже
   *  clear side «не менее» и прохода оператора); между ДГУ — проход к длинным сторонам (от aisle.service), у торцов — clear back */
  dAcross(D, O, Lu, W){
    const R=StationMatrix.grp('dgu').rad, n=StationLayout.n, sv=StationMatrix.grp('aisle').service, E=[...O, ...D];
    const fr=(e, l)=>Math.max(this.aisle[l], e.c.side[l]), need=e=>e.l+R+fr(e, 1), bad=D.filter(e=>need(e)>W);
    if (bad.length) return { ok:false, why:'width', bad, needW:Math.max(...bad.map(need)) };
    const lenX=e=>e.kind==='dgu' ? e.w : e.l, as=StationMatrix.access().side, Dm=StationMatrix.door(), edge=Math.max(StationLayout.DOOR.pad, Dm.edge-(this.T||0));
    // дверь-жалюзи шире ДГУ (StationLayout.dguDoorW): её выступ — до края станции не меньше door.edge, до соседней — door.gap
    const over=e=>e.kind==='dgu' ? (StationLayout.dguDoorW(e.w)-e.w)/2 : 0;
    // длинный бок ДГУ поперёк — к торцу или соседу: не меньше отступа сзади и доступа к боку (access.side)
    const lb=(e, l)=>e.kind==='dgu' ? Math.max(e.c.back[l], as, over(e)+edge) : e.c.side[l];
    const gapsOf=lvl=>{ const l=Math.min(1, lvl), g=[], s=(a, b)=>a.kind==='dgu' && b.kind==='dgu' ? Math.max(sv, l ? Math.max(sv, a.c.back[1]) : Math.max(a.c.side[0], sv), over(a)+over(b)+Dm.gap) : Math.max(lb(a, l), lb(b, l));
      g.push(lb(E[0], l)); for (let i=1; i<E.length; i++) g.push(s(E[i-1], E[i])); g.push(lb(E[E.length-1], l)); return g; };
    const body=E.reduce((s, e)=>s+lenX(e), 0), sum=a=>a.reduce((s, v)=>s+v, 0), mn=gapsOf(1), rec=gapsOf(0);
    const needL=body+sum(mn), needL0=body+sum(rec);
    if (needL>Lu) return { ok:false, why:'length', needL, needL0, needLc:needL };
    const q=sum(rec)>sum(mn) ? Math.max(0, Math.min(1, (Lu-needL)/(sum(rec)-sum(mn)))) : 1, gaps=mn.map((v, i)=>Math.floor(v+(rec[i]-v)*q));
    const items=[], iss=[]; let x=gaps[0]+Math.max(0, Lu-body-sum(gaps));   // свободная длина — у двери
    E.forEach((e, i)=>{ if (e.kind==='dgu'){ const d=e.l, y=W-R-d; items.push({ o:{ e, rot:true, rad:'back' }, ri:0, x, lx:e.w, d, face:-1, back:R, aisle:y, y }); }
      else { const q2=this.dBack(e, e.w, W); items.push({ o:{ e, rot:false }, ri:0, x, lx:e.l, d:e.w, face:-1, ...q2 }); }
      x+=lenX(e)+gaps[i+1]; });
    const aisleW=Math.min(...items.map(i=>i.aisle)), aRec=this.aisle[0];
    if (aisleW<aRec) iss.push({ level:'warn', text:`Проход перед ДГУ ${n(aisleW)} мм — меньше рекомендуемых ${n(aRec)} мм (допустимо от ${n(this.aisle[1])} мм).` });
    return { ok:true, rows:1, aisleW, items, iss, used:Math.max(...items.map(i=>i.x+i.lx))+gaps[gaps.length-1], way:'across' };
  }

  /** промежутки по длине ряда: у двери, между соседними, в дальнем торце (lvl 0 — рекомендуемые, 1 — не менее) */
  chain(E, lvl){
    const g=[]; if (!E.length) return { gaps:g, sum:0 };
    // агрегат поперёк (cross): перед ним — проход обслуживания (лицом к входу), за ним — отступ сзади и проход второй части;
    // соседи — по матрице расстановки (lvl 2 — крайний случай: ресиверы и фильтры вплотную), иначе — по нормам вида
    const l1=Math.min(1, lvl), fr=e=>this.front(e)[l1], bk=e=>Math.max(e.c.back[l1], this.aisle[1]);
    // вплотную (lvl 2) — только одиночные ресиверы и фильтры: у пары (один за другим) задний осматривают сбоку — промежуток
    // не меньше recv.pairSide и «вплотную» его не уменьшает
    const nb=(a, b)=>{ const p=StationMatrix.pair(a, b); if (!p) return Math.max(a.c.side[l1], b.c.side[l1]);
      return lvl>=2 && (a.pairD || b.pairD) ? Math.max(p[2], Math.min(p[1], StationLayout.PAIR_SIDE)) : p[Math.min(lvl, 2)]; };
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
    StationTidy.even(items);
    // поперёк: задний отступ и проход. Сначала задний отступ до рекомендуемого (иначе агрегат «плотно к стене» —
    // дорогие сервисные ворота), если проход при этом не уже допустимого; затем проход до рекомендуемого
    const back=it=>it.o.e.c.back;
    if (rows===1){
      for (const it of items){ const b=back(it), budget=W-it.d, fr=this.front(it.o.e)[0], fm=this.front(it.o.e)[1];
        if (it.o.e.cross){ it.y=Math.round(budget/2); it.back=it.y; it.aisle=0; it.face=-2; continue; }   // поперёк: по середине ширины, лицом к входу
        if (it.o.end){ const bw=Math.min(b[1], StationMatrix.recv().pairWall); it.back=Math.max(bw, Math.round((budget)/2)); it.back=Math.min(it.back, budget-bw); it.aisle=budget-it.back; it.y=W-it.back-it.d; it.face=-1; continue; }   // пара во всю ширину: отступы от стен поровну, не меньше recv.pairWall
        it.back = budget-b[0]>=fm ? b[0] : budget-fm>=b[1] ? budget-fm : b[1];
        if (budget-it.back>fr && it.back<b[0]) it.back=Math.min(b[0], budget-fr);
        it.aisle=budget-it.back; it.y=W-it.back-it.d; it.face=-1; }
    } else {
      const A=items.filter(i=>i.ri===1), B=items.filter(i=>i.ri===0), dm=(S, f)=>S.length ? Math.max(...S.map(f)) : 0;
      const recOk=W-dm(A, i=>i.d+back(i)[0])-dm(B, i=>i.d+back(i)[0])>=this.aisle[1];   // проход не уже допустимого — сзади рекомендуемый
      for (const it of items) it.back=recOk ? back(it)[0] : back(it)[1];
      if (!recOk){   // сзади «не менее», а проход шире рекомендуемого — излишек поровну рядам назад (к обслуживанию сзади)
        const per=Math.max(0, W-dm(A, i=>i.d+i.back)-dm(B, i=>i.d+i.back)-aRec)/((A.length ? 1 : 0)+(B.length ? 1 : 0));
        for (const it of items) it.back=Math.floor(Math.min(back(it)[0], back(it)[1]+per)); }
      const free=W-dm(A, i=>i.d+i.back)-dm(B, i=>i.d+i.back);
      for (const it of B){ it.y=W-it.back-it.d; it.face=-1; it.aisle=free; }
      for (const it of A){ it.y=it.back; it.face=1; it.aisle=free; }
    }
    StationTidy.facade(items, W, rows, aRec);
    const eq=items.filter(i=>!i.o.e.slot && !i.o.e.cross && !i.o.end), aisleW=eq.length ? Math.min(...eq.map(i=>i.aisle)) : W, dgu=eq.find(i=>i.o.e.kind==='dgu'), other=eq.filter(i=>i.o.e.kind!=='dgu');
    const aisleO=other.length ? Math.min(...other.map(i=>i.aisle)) : Infinity;
    if (aisleO<aRec) iss.push({ level:'warn', text:`Проход обслуживания ${n(aisleO)} мм — меньше рекомендуемых ${n(aRec)} мм (допустимо от ${n(this.aisle[1])} мм).` });
    if (dgu && dgu.aisle<aRec) iss.push({ level:'warn', text:`Проход вдоль ДГУ ${n(dgu.aisle)} мм — меньше рекомендуемых ${n(aRec)} мм (допустимо от ${n(this.front(dgu.o.e)[1])} мм).` });
    if (gapsShort && Number.isFinite(minGap)) iss.push({ level:'warn', text:`Промежутки между оборудованием уменьшены до ${n(minGap)} мм — по длине не хватает места для рекомендуемых.` });
    else if (gapsShort) iss.push({ level:'warn', text:'Отступы от торцов уменьшены — по длине не хватает места для рекомендуемых.' });
    for (const it of eq) if (it.back<back(it)[0] && back(it)[0]>150 && !it.o.e.unit) iss.push({ level:'warn', tight:it.o.e.pos, text:`Поз. ${it.o.e.pos} «${it.o.e.short}» стоит в ${n(it.back+this.G)} мм от стены — рекомендуется ${n(back(it)[0]+this.G)} мм.` });
    return { ok:true, rows, aisleW, items, iss };
  }

  /** станция из модулей (решение владельца 19.10): модуль везут с оборудованием внутри — каждый агрегат целиком в своём
   *  модуле, от линии стыка не ближе полустойки каркаса. Поперёк — агрегат в ближайшую полосу модуля, где он помещается
   *  (ДГУ вдоль — посередине своей полосы), с отступом от стены и проходом не меньше допустимых; по длине — за стык, следующие
   *  в ряду сдвигаются (не хватает длины — станция длиннее). Координаты — полезные (без зазора G) */
  joints(r, geo, Lu, W){
    const J=StationMods.lines(geo), s=StationMods.M.post/2, g=this.G, X=J.x.map(v=>v-geo.x0-g), Y=J.y.map(v=>v-g);
    const zones=[]; for (let k=0; k<=Y.length; k++) zones.push([k ? Y[k-1]+s : 0, k<Y.length ? Y[k]-s : W]);
    const bad=[], moved=[];
    for (const it of r.items){ const d=it.d, e=it.o.e;
      if (!Y.some(y=>it.y<y+s && it.y+d>y-s)) continue;
      // у задней стены (лицом к проходу) — в полосе у этой стены, у передней — у передней; посередине (ДГУ) — в ближайшей
      const c=it.y+d/2, mid=e.kind==='dgu' && !it.o.rot, Z=zones.filter(([a, b])=>b-a>=d).sort((p, q)=>!mid && it.face===-1 ? q[1]-p[1] : !mid && it.face===1 ? p[0]-q[0] : Math.abs((p[0]+p[1])/2-c)-Math.abs((q[0]+q[1])/2-c));
      const z=Z[0]; if (!z || it.o.e.cross || it.o.end){ bad.push(e); continue; }
      it.y=e.kind==='dgu' && !it.o.rot ? Math.round(z[0]+(z[1]-z[0]-d)/2) : Math.min(Math.max(it.y, z[0]), z[1]-d);
      if (it.face===1) it.back=it.y; else { it.back=W-it.y-d; it.aisle=it.y; }
      if (it.back<(e.kind==='dgu' && !it.o.rot ? StationMatrix.grp('dgu').pass : Math.min(...e.c.back))) bad.push(e);
      moved.push(it); }
    if (moved.length && r.rows===2){ const A=r.items.filter(i=>i.ri===1), B=r.items.filter(i=>i.ri===0);
      const free=(B.length ? Math.min(...B.map(i=>i.y)) : W)-(A.length ? Math.max(...A.map(i=>i.y+i.d)) : 0); for (const it of r.items) it.aisle=free; }
    for (const it of moved) if (it.aisle<(it.o.e.kind==='dgu' && !it.o.rot ? StationMatrix.grp('dgu').pass : Math.min(this.aisle[1], this.front(it.o.e)[1]))) bad.push(it.o.e);
    if (bad.length) return { ok:false, why:'joint', bad:[...new Set(bad)] };
    // по длине: ряд за рядом слева направо — агрегат на стыке отодвигается за стык в ближнюю сторону, если промежуток к соседу
    // остаётся не меньше прежнего (и не меньше 700 мм — между агрегатами, СП 30.13330); иначе — за стык вместе со следующими
    if (X.length) for (const ri of [...new Set(r.items.map(i=>i.ri))]){
      const row=r.items.filter(i=>i.ri===ri).sort((p, q)=>p.x-q.x);
      for (let k=0; k<row.length; k++){ const it=row[k], x=X.find(v=>it.x<v+s && it.x+it.lx>v-s); if (x==null) continue;
        const pv=row[k-1], nx=row[k+1], g0=pv ? it.x-pv.x-pv.lx : it.x, g1=nx ? nx.x-it.x-it.lx : Lu-it.x-it.lx;
        const xl=Math.round(x-s-it.lx), xr=Math.round(x+s), okL=xl-(pv ? pv.x+pv.lx : 0)>=Math.min(g0, 700), okR=(nx ? nx.x : Lu)-xr-it.lx>=Math.min(g1, 700);
        const opt=[okL && xl, okR && xr].filter(v=>v!==false).sort((p, q)=>Math.abs(p-it.x)-Math.abs(q-it.x));
        if (opt.length){ it.x=opt[0]; continue; }
        // вместе с соседями: следующие — за стык (вправо), если не упираются в торец; иначе предыдущие — до стыка (влево) за счёт
        // свободной длины у двери
        const dx=Math.round(x+s-it.x), dl=Math.round(it.x+it.lx-(x-s)), last=row[row.length-1];
        if (last.x+last.lx+dx>Lu && row[0].x-dl>=Math.min(row[0].x, 600)){ for (let m=0; m<=k; m++) row[m].x-=dl; continue; }
        for (let m=k; m<row.length; m++) row[m].x+=dx; } }
    const end=Math.max(...r.items.map(i=>i.x+i.lx));
    if (end>Lu) return { ok:false, why:'length', needL:end+100, needL0:end+100 };
    r.aisleW=Math.min(...r.items.map(i=>i.aisle));
    if (r.entry && X.some(v=>r.entry[0]<v+s && r.entry[1]>v-s)){ const v=X.find(q=>r.entry[0]<q+s && r.entry[1]>q-s), w=r.entry[1]-r.entry[0]; r.entry=[v+s, v+s+w]; }
    return r;
  }

  /** заданный контейнер: сначала как обычно, не помещается — исключения (компрессорная: без продольного прохода,
   *  проход «в крайнем случае», без сквозного прохода); modes — только эти режимы (автоподбор размера и подсказки задают их сами). Не помещается ни в одном —
   *  ответ обычного режима (его замечания понятнее) */
  fit(units, geo, modes){
    const M=modes || this.modes(); let first=null;
    for (const m of M){ const r=this.withMode(m, ()=>this.fit0(units, geo));
      if (r.level!=='error'){ this.modeNotes(r, m, geo); if (m.tight || m.cross || m.ends) r.level=r.issues.some(i=>i.level==='warn') ? 'warn' : r.level; return r; }
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
      // своё место в ряду — в конце; не помещается — перед ресиверами в конце ряда (по ходу воздуха фильтры — до «сухого»
      // ресивера; ресиверы остаются в конце и могут встать парами поперёк у торца)
      const sl=slots.map(e=>Object.assign({}, e, { slot:true }));
      let r2=this.fitRow([...floor, ...sl], geo, units), k=floor.length; while (k>0 && floor[k-1].kind==='receiver') k--;
      if (r2.level==='error' && k<floor.length){ const r3=this.fitRow([...floor.slice(0, k), ...sl, ...floor.slice(k)], geo, units); if (r3.level!=='error') r2=r3; }
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
    this.inMods=!!(geo.mods && geo.mods.Lm); this.jGeo=this.inMods ? geo : null;
    this.closeOk=!!this.closeAll || (!geo.auto && !geo.road);   // вплотную (ресиверы, фильтры) — в заданном контейнере; при подборе размера — последним приёмом перед выносом ресиверов наружу (closeAll)
    let r=this.dguSt ? this.rowD(units, Lu, W) : this.mode.ends ? (geo.x0 ? { ok:false, why:'mode' } : this.rowE(units, Lu, W, geo.t||0, StationLayout.gaps(geo).eL)) : this.row1(units, Lu, W);
    if (!this.dguSt && !this.mode.ends && (!r.ok || r.iss.some(i=>i.level==='warn'))){ const r2=this.row2(units, Lu, W); if (r2.ok && (!r.ok || !r2.iss.some(i=>i.level==='warn'))) r=r2; }
    if (!r.ok && this.mode.cross && !this.dguSt){ const r3=this.rowX(units, Lu, W); if (r3.ok) r=r3; }   // исключение: агрегат поперёк, две двери
    if (this.jGeo && !this.dguSt && !this.mode.ends){   // из модулей: бок о бок — сначала два ряда (ряд в своей полосе модулей), на стыке — другой вариант
      const V=(geo.mods.b>1 ? ['row2', 'row1'] : ['row1', 'row2']).map(k=>k==='row2' ? this.row2(units, Lu, W) : this.row1(units, Lu, W)).filter(q=>q.ok);
      let first=null; r=null;
      for (const q of V){ const j=this.joints(q, geo, Lu, W); if (j.ok && (!r || (r.iss.some(i=>i.level==='warn') && !j.iss.some(i=>i.level==='warn')))) r=j; first=first||j; if (r && !r.iss.some(i=>i.level==='warn')) break; }
      r=r || first || this.row1(units, Lu, W); }
    else if (r.ok && this.jGeo && !this.dguSt) r=this.joints(r, geo, Lu, W);
    const res={ geo, ext:geo.ext, int:geo.int };
    if (!r.ok){
      const iss=[...hh.iss];
      if (r.why==='joint') iss.unshift({ level:'error', text:`Поз. ${r.bad.map(e=>e.pos).join(', ')} — на стыке модулей: каждый агрегат должен быть целиком в своём модуле (модуль везут с оборудованием внутри).` });
      else if (r.why==='mode') iss.unshift({ level:'error', text:'Без продольного прохода — только компрессорная (без ДГУ и насосов).' });
      else if (r.why==='width') iss.unshift({ level:'error', text:`Не проходит по ширине: ${r.bad.filter(e=>!e.unit).slice(0, 3).map(e=>`поз. ${e.pos} «${e.short}» (${n(e.w)} мм)`).join(', ')} — вместе с проходом для оператора и обслуживания, отступом от стены и зазором на коммуникации нужно ${n(r.needW+2*g)} мм, а ширина внутри — ${n(Wi)} мм.` });
      else iss.unshift({ level:'error', text:`Не помещается по длине: нужно ${n(r.needL+2*g)} мм, а внутри контейнера ${n(Lu+2*g)} мм — не хватает ${n(r.needL-Lu)} мм.` });
      return Object.assign(res, { level:'error', issues:iss, need:{ L:r.needL||null, W:r.needW||null } });
    }
    const items=r.items.flatMap(it=>it.o.pair ? this.unpair(it, geo) : [Object.assign(this.item(it, geo), it.o.ends ? { ends:true } : {})]), iss=[...hh.iss, ...r.iss];
    const X=items.find(i=>i.cross), cross=X ? { pos:X.pos, x0:X.x, x1:X.x+X.lx } : null;
    const P=[...new Set(items.filter(i=>i.pair).map(i=>i.pos))];
    if (P.length) iss.push({ level:'info', text:`Ресиверы поз. ${P.join(', ')} — в два ряда (один за другим${items.some(i=>i.pairEnd) ? ', в конце ряда поперёк контейнера — станция короче' : ''}): осмотр и обслуживание заднего — сбоку, через промежутки между ресиверами.` });
    // дверь оператора: агрегат поперёк — в стене прохода перед ним, если места хватает, иначе — в ближнем торце
    const door=cross ? (cross.x0-geo.x0>=StationLayout.ENTRY[1]+100 ? 'side' : 'end') : !this.tank && r.rows===2 ? 'end' : 'side';
    const CE=items.filter(i=>i.ends).sort((a, b)=>a.x-b.x), C=CE[0], CZ=CE[CE.length-1], ends=C ? { pos:C.pos, x0:C.x, x1:CZ.x+CZ.lx, n:CE.length, all:[...new Set(CE.map(i=>i.pos))],
      next:(items.filter(i=>i.mount==='floor' && !i.ends && i.x>=CZ.x+CZ.lx).sort((a, b)=>a.x-b.x)[0]||{}).pos||null, recv:[...new Set(items.filter(i=>i.pairEnd).map(i=>i.pos))] } : null;
    const entryX=r.entry ? r.entry.map(v=>Math.round(geo.x0+this.G+v)) : null;
    return Object.assign(res, { level:hh.bad ? 'error' : 'ok', bad:hh.bad, items, rows:r.rows, door, cross, ends, entryX,
      doors:null, aisle:{ w:r.aisleW, rows:r.rows }, issues:iss });
  }

  /** двери и итог: уровень, занятая длина. Внутри — проход: дверь оператора (entry) и для агрегатов, которые через неё не
   *  вынести, — распашные ворота в торце (exits; у морского — его штатные двери в торце), сервисные двери — только для
   *  демонтажа, где к воротам не провезти; ДГУ — дверь-жалюзи напротив радиатора (dguDoors) */
  finish(r, geo){
    const n=StationLayout.n;
    r.doors=r.doors||[]; this.recheck(r, geo);
    { const E=this.entryOpen(geo, r.door), G=r.gates, two=r.doors.some(d=>d.kind==='entry') || r.exit || (G && G.wicket) || (r.gates2 && r.gates2.wicket) || r.secondDgu;
      const who=`дверь оператора — ${r.door==='end' && geo.sea ? 'штатные двери в торце' : `одностворчатая, ${n(E.w)} × ${n(E.h)} мм в свету, открывается наружу, с доводчиком`}`;
      for (const q of [G, r.gates2]) if (q && (q.pos.length || !q.sea)) r.issues.push({ level:'info', text:q.sea ? `Монтаж и демонтаж поз. ${q.pos.join(', ')} — через штатные двери контейнера в торце (${n(q.w)} × ${n(q.h)} мм): ${q.why.join('; ')}.`
        : `Распашные монтажные ворота ${q.full ? 'во весь торец ' : ''}${n(q.w)} × ${n(q.h)} мм в ${q.wall==='left' ? 'торце у входа' : 'дальнем торце'}, открываются наружу (${q.wall==='right' && r.items.some(i=>i.pairEnd) ? 'перед ними ресиверы в два ряда — это не выход' : 'это и выход'})${q.pos.length ? ` — для монтажа и демонтажа поз. ${q.pos.join(', ')}` : ' — для монтажа и демонтажа оборудования'}${q.why.length ? ': '+q.why.join('; ') : ''}. ${StationLayout.gateAxis(q)} Проём в торцевой раме — с усилением (ригель над проёмом, стойки по краям) по расчёту изготовителя контейнера.` });
      // одинаковые ворота (несколько одинаковых агрегатов) — одной строкой с числом
      const sv=new Map(); for (const d of r.doors.filter(d=>d.kind!=='entry')){
        const t=`${d.leaves>1 ? 'Сервисные распашные ворота' : 'Сервисная распашная дверь'} ${n(d.w)} × ${n(d.h)} мм в ${d.wall==='back' ? 'задней' : 'боковой'} стене${d.both ? (d.wall==='back' ? ' за компрессором' : ' перед компрессором') : d.rear ? ' за оборудованием' : ''}`;
        const k=t+'|'+d.pos.join(','); if (!sv.has(k)) sv.set(k, { t, d, n:0 }); sv.get(k).n++; }
      for (const { t, d, n:c } of sv.values()) r.issues.push({ level:'info', text:`${t}${c>1 ? ` (${c} шт.)` : ''} — для ${d.rear ? 'обслуживания, ' : ''}монтажа и демонтажа поз. ${d.pos.join(', ')}: ${d.why.join('; ')}${d.rear && !d.both && !(G && G.pos.length) ? '; ворота в торце не нужны' : ''}.` });
      const tight=new Set(r.doors.filter(d=>d.rear).flatMap(d=>d.pos));   // плотно к стене, но с воротами за ним — не замечание
      r.issues=r.issues.filter(i=>!(i.tight!=null && tight.has(i.tight)));
      r.issues.push({ level:'info', text:`Вход: ${who}${two ? `; вторая дверь оператора — ${r.exit ? 'в дальнем торце по оси прохода' : G && G.wicket ? `калитка ${n(G.wicket.w)} × ${n(G.wicket.h)} мм в створке ворот в дальнем торце` : r.secondDgu ? 'выход через дверь-жалюзи ДГУ в дальнем торце' : 'в стене прохода у дальнего торца'} (${r.second})` : ''}.` }); }
    r.entry=this.entry(r, geo);
    r.dguDoors=this.dguDoors(r, geo); r.dguDoor=r.dguDoors[0]||null;
    for (const t of this.openings(r, geo)) r.issues.push({ level:'warn', gap:true, text:t });
    const dgG=new Map(); for (const d of r.dguDoors){ const k=[d.pos, d.wall, d.w, d.h, d.fits].join('|'); if (!dgG.has(k)) dgG.set(k, []); dgG.get(k).push(d); }
    for (const [d, q] of [...dgG.values()].map(L=>[L[0], L.length])){ const wh={ right:'в дальнем торце', left:'в торце у входа', back:'в задней стене' }[d.wall]; r.issues.push({ level:'info', text:`ДГУ поз. ${d.pos}${q>1 ? ` (${q} шт.): у каждой` : ':'} ${wh} — двустворчатая дверь-жалюзи ${n(d.w)} × ${n(d.h)} мм — выброс горячего воздуха радиатора и проём для монтажа и демонтажа ДГУ (отдельная сервисная дверь не нужна).${d.fits ? '' : ' ДГУ шире проёма — демонтаж со снятием панели стены.'}` }); }
    r.access=this.access(r, geo);
    for (const q of r.access) if (q.miss.length) r.issues.push({ level:'warn', text:`Поз. ${q.pos}: к ${q.miss.map(k=>StationLayout.SIDE[k][1]).join(' и ')} не подойти для обслуживания (${q.miss.map(k=>q.s[k].t).join('; ')}) — нужен проход или сервисные ворота; увеличьте контейнер или поменяйте порядок в составе.` });
    r.level=r.bad ? 'error' : r.issues.some(i=>i.level==='warn') ? 'warn' : 'ok';
    r.used=this.used(r.items, geo);
    delete r.segs;
  }
  /** проёмы дверей и ворот по стенам: ближе door.edge к краю станции или ближе door.gap друг к другу (не уместились) —
   *  тексты замечаний */
  openings(r, geo){
    const [L, W]=geo.int, Q=StationLayout.gaps(geo), n=StationLayout.n, O={ front:[], back:[], left:[], right:[] }, out=[];
    const name={ front:'боковой стене (вход)', back:'задней стене', left:'торце у входа', right:'дальнем торце' }, put=(w, a, b, t)=>O[w] && O[w].push([a, b, t]);
    for (const d of r.doors||[]) put(d.wall, d.x0, d.x1, d.kind==='entry' ? 'дверь оператора' : 'сервисные ворота');
    const e=r.entry; if (e && !e.sea) e.wall==='front' ? put('front', e.x0, e.x1, 'дверь оператора') : put(e.wall, e.y0, e.y1, 'дверь оператора');
    for (const g of [r.gates, r.gates2]) if (g && !g.sea) put(g.wall, g.y0, g.y1, 'ворота');
    if (r.exit) put(r.exit.wall, r.exit.y0, r.exit.y1, 'дверь оператора'); for (const d of r.dguDoors||[]) d.wall==='back' ? put('back', d.x0, d.x1, 'дверь-жалюзи ДГУ') : put(d.wall, d.y0, d.y1, 'дверь-жалюзи ДГУ');
    if (r.fuel && r.fuel.door) put('front', r.fuel.door.x0, r.fuel.door.x1, 'дверь отсека бака');
    if (r.fuel && r.fuel.gate) put('left', r.fuel.gate.y0, r.fuel.gate.y1, 'ворота отсека бака');
    for (const [w, list] of Object.entries(O)){ const lim=w==='front' || w==='back' ? [Q.eL, L-Q.eL] : [Q.eW, W-Q.eW]; list.sort((a, b)=>a[0]-b[0]);
      for (const [a, b, t] of list) if (a<lim[0]-1 || b>lim[1]+1) out.push(`${t[0].toUpperCase()+t.slice(1)} в ${name[w]} — ближе ${n(StationMatrix.door().edge)} мм к краю станции: стена мала для проёма с отступами — проверьте у изготовителя или увеличьте контейнер.`);
      for (let k=1; k<list.length; k++) if (list[k][0]-list[k-1][1]<Q.gap-1) out.push(`В ${name[w]}: между проёмами (${list[k-1][2]} и ${list[k][2]}) ${n(Math.max(0, list[k][0]-list[k-1][1]))} мм — меньше ${n(Q.gap)} мм.`); }
    return [...new Set(out)];
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
      if ((r.dguDoors||[]).some(q=>q.pos===i.pos && q.wall==={ '+x':'right', '-x':'left', '+y':'back' }[d])) return 'дверь-жалюзи ДГУ';
      if (d==='-x' || d==='+x'){ const s=d==='-x' ? 'left' : 'right', g=G.find(q=>q.wall===s && ov(q.y0, q.y1, i.y, i.y+i.ly));
        return g ? (g.sea ? 'штатные двери торца' : 'ворота торца') : null; }
      const s=d==='+y' ? 'back' : 'front', dd=(r.doors||[]).find(q=>q.wall===s && ov(q.x0, q.x1, i.x, i.x+i.lx));
      return dd ? (dd.kind==='entry' ? 'дверь оператора' : 'сервисные ворота') : null; };
    // стороны агрегата → направления: лицом к проходу (face -1 — к стене прохода, 1 — к задней, ±2 — к торцам)
    const dirs=f=>f===1 ? { F:'+y', B:'-y', L:'+x', R:'-x' } : f===2 ? { F:'+x', B:'-x', L:'-y', R:'+y' } : f===-2 ? { F:'-x', B:'+x', L:'+y', R:'-y' } : { F:'-y', B:'+y', L:'-x', R:'+x' };
    const cnt=new Map(), all=new Map(); for (const i of fl) all.set(i.pos, (all.get(i.pos)||0)+1);
    for (const i of fl){
      const k1=(cnt.get(i.pos)||0)+1; cnt.set(i.pos, k1);
      // малые насосы (СП 31.13330.2021, п. 10.15) — можно по два на общей раме без прохода: сбоку достаточно их отступа
      const need=StationMatrix.sides(i.kind), D=dirs(i.face), s={}, miss=[], side=i.kind==='pump' && StationClear.of('pump', i)===StationClear.PUMP_SMALL ? StationClear.PUMP_SMALL.side[1] : A.side;
      for (const k of ['F', 'B', 'L', 'R']){
        const d=D[k], [g, wall]=gap(i, d), mid=i.kind==='dgu' && !i.rot && (k==='F' || k==='B'), min=mid ? Math.min(StationMatrix.grp('dgu').pass, k==='F' ? sv : A.back) : k==='F' ? sv : k==='B' ? A.back : side, h=wall ? hole(i, d) : null;
        if (!need[k]){ s[k]={ ok:true, t:'не требуется', g }; continue; }
        if (g>=min) s[k]={ ok:true, t:`${k==='F' ? 'проход' : 'зазор'} ${n(Math.round(g))} мм`, g };
        else if (h) s[k]={ ok:true, t:h, g };
        else if (k==='F' && i.pair && Math.max(gap(i, D.L)[0], gap(i, D.R)[0])>=StationLayout.PAIR_SIDE) s[k]={ ok:true, t:`сбоку, через промежуток ${n(Math.round(Math.max(gap(i, D.L)[0], gap(i, D.R)[0])))} мм (ресиверы в два ряда)`, g };
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
    else if (has('dgu')){ if (has('tank')) out.push(...this.fuelLine(fl.filter(i=>i.kind==='tank' || i.kind==='dgu'), W)); }
    else line(fl.filter(i=>i.kind!=='cabinet'), Math.max(150, hang), 0.5, Math.min(zTop, 1200), 'выход', 'gen', true);
    return out;
  }
  /** топливопровод от бака к ДГУ — по полу (решение владельца 19.10): в лотке с крышкой из рифлёного листа, ось на высоте
   *  fuelZ; вдоль задней стены за ДГУ, если там есть место (не меньше 200 мм), иначе (ДГУ поперёк — радиаторами к задней
   *  стене) — вдоль стены с дверью оператора; к баку и каждой ДГУ — отвод по полу */
  fuelLine(conn, W){
    const Z=StationLayout.FUEL_Z, D=conn.filter(i=>i.kind==='dgu'), back=D.every(i=>!i.rad || i.rad!=='back') && D.every(i=>W-(i.y+i.ly)>=200);
    const y=back ? W-120 : 120, br=conn.map(i=>this.branch(i, y, Z)).filter(Boolean), xs=[...br.map(b=>b.x), ...conn.map(i=>Math.round(i.x+i.lx/2))];
    return [{ x0:Math.min(...xs), x1:Math.max(...xs), y, z:Z, label:'', medium:'fuel', floor:true, branches:br }];
  }
  static FUEL_Z = 60;   // топливопровод по полу: ось трубы от пола, мм (в лотке)
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
    // станция из модулей: не на стыке (модуль везут со шкафом на стене)
    const JL=StationMods.lines(geo), js=StationMods.M.post/2, jX=JL.x.map(v=>[v-js, v+js]), jY=JL.y.map(v=>[v-js, v+js]);
    // на стене прохода — не на пути к воротам в торце: то, что выносят через них, проходит мимо шкафа
    const G=r.gates && r.gates.pos.length ? r.gates : null, P=StationLayout.PASS, out=G ? this.bulky(r, geo).filter(b=>G.pos.includes(b.it.pos)) : [];
    const clear=x=>{ if (!out.length) return true;
      const u=fl.filter(i=>i.x<x+w && i.x+i.lx>x), room=(u.length ? Math.min(...u.map(i=>i.y)) : W)-d;
      return out.every(b=>(G.wall==='right' ? b.it.x>=x+w : b.it.x+b.it.lx<=x) || b.narrow+2*P<=room); };
    const front=need=>{
      const busy=[...cabs.filter(i=>i.wall==='front').map(i=>[i.x-100, i.x+i.lx+100]), ...jX];
      if (r.door==='side'){ const ex=this.entrySpan(r, geo); busy.push([ex[0]-150, ex[1]+150]); }
      for (const dd of (r.doors||[]).filter(dd=>dd.wall==='front')) busy.push([dd.x0-150, dd.x1+150]);   // не на сервисной двери
      const ok=x=>!busy.some(([a, b])=>x<b && x+w>a) && fl.every(i=>i.x>=x+w || i.x+i.lx<=x || i.y-d>=need) && clear(x) && !r.items.some(i=>this.hit({ x, y:0, z, lx:w, ly:d, h:e.h }, i, 0));
      for (let x=x0+150; x+w<=L-150; x+=50) if (ok(x)) return this.unitItem(e, { x, y:0, z, mount:'wall', wall:'front', face:1 });
      return null; };
    // торец: шкаф вдоль торцевой стены в зоне прохода — перед ним (вдоль контейнера) проход «не менее» свободен
    const end=side=>{
      if (side==='left' && (r.door==='end' || (x0>0 && geo.type==='north'))) return null;   // вход оператора в торце; у «Севера» — тамбур (перегородка отсека бака — сплошная: можно)
      if ([r.gates, r.gates2].some(g=>g && g.wall===side)) return null;   // ворота для демонтажа (у морского — его двери)
      if (side==='right' && fl.some(i=>i.kind==='dgu')) return null;
      const xa=side==='left' ? x0 : L-d, zone=[side==='left' ? x0 : L-d-this.aisle[1], side==='left' ? x0+d+this.aisle[1] : L];
      const taken=[...cabs.filter(i=>i.wall===side).map(i=>[i.y-100, i.y+i.ly+100]), ...jY];
      for (let y=100; y+w<=W-100; y+=50){
        if (taken.some(([a, b])=>y<b && y+w>a)) continue;
        if (fl.some(i=>i.x<zone[1] && i.x+i.lx>zone[0] && i.y<y+w && i.y+i.ly>y)) continue;
        if (r.items.some(i=>this.hit({ x:xa, y, z, lx:d, ly:w, h:e.h }, i, 0))) continue;   // и не на фильтре на трубе
        return this.unitItem(e, { x:xa, y, z, lx:d, ly:w, mount:'wall', wall:side, face:side==='left' ? 2 : -2 }); }
      return null; };
    // без продольного прохода: на задней стене напротив двери оператора (между компрессором и следующим оборудованием)
    const back=need=>{ if (!r.ends) return null;
      const busy=[...cabs.filter(i=>i.wall==='back').map(i=>[i.x-100, i.x+i.lx+100]), ...jX, ...(r.doors||[]).filter(dd=>dd.wall==='back').map(dd=>[dd.x0-150, dd.x1+150])];
      const ok=x=>!busy.some(([a, b])=>x<b && x+w>a) && fl.every(i=>i.x>=x+w || i.x+i.lx<=x || W-d-(i.y+i.ly)>=need) && !r.items.some(i=>this.hit({ x, y:W-d, z, lx:w, ly:d, h:e.h }, i, 0));
      for (let x=x0+150; x+w<=L-150; x+=50) if (ok(x)) return this.unitItem(e, { x, y:W-d, z, mount:'wall', wall:'back', face:-1 });
      return null; };
    if (fl.some(i=>i.kind==='dgu')) return front(this.aisle[0]) || front(this.aisle[1]) || end('left');   // у ДГУ торец у входа — под приток воздуха
    return front(this.aisle[0]) || back(this.aisle[0]) || end('left') || end('right') || front(this.aisle[1]) || back(this.aisle[1]);
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
    const E=StationLayout.ENTRY, D={ h:StationMatrix.door().h+100, pad:StationLayout.gaps(geo).eW }, w=E[1]-E[0], W=geo.int[1];
    if (r.door==='side'){ const ex=this.entrySpan(r, geo); return { wall:'front', x0:ex[0], x1:ex[1], w, h:D.h }; }
    if (r.door!=='end') return null;
    if (geo.sea && geo.door){ const dw=Math.min(geo.door[0], W); return { wall:'left', y0:Math.round((W-dw)/2), y1:Math.round((W+dw)/2), w:dw, h:geo.door[1], sea:true }; }
    const y0=StationLayout.inWall(this.aisleMid(r, W)-w/2, w, W, D.pad);
    return { wall:'left', y0, y1:y0+w, w, h:D.h };
  }
  /** дверь оператора в стене прохода: [от, до] по длине, мм — у торца (за тамбуром) или, без продольного прохода, между
   *  компрессором и следующим оборудованием (r.entryX) */
  entrySpan(r, geo){ const x0=geo.x0||0, E=StationLayout.ENTRY, a=Math.max(x0+E[0], StationLayout.gaps(geo).eL); return r.entryX || [a, a+E[1]-E[0]]; }
  /** полоса прохода поперёк контейнера [от, до], мм: один ряд — от передней стены до оборудования, два — между рядами */
  aisleBand(r, W){
    const fl=r.items.filter(i=>(i.mount==='floor' || i.mount==='frame') && !i.tank && !i.cross); if (!fl.length) return [0, W];
    if (r.rows!==2) return [0, Math.min(...fl.map(i=>i.y))];
    const A=fl.filter(i=>i.row===1), B=fl.filter(i=>i.row!==1); return [A.length ? Math.max(...A.map(i=>i.y+i.ly)) : 0, B.length ? Math.min(...B.map(i=>i.y)) : W];
  }
  /** середина прохода поперёк контейнера, мм */
  aisleMid(r, W){ const [lo, hi]=this.aisleBand(r, W); return (lo+hi)/2; }
  /** что не вынести через дверь оператора (ДГУ — через дверь-жалюзи в торце): не проходит в проём — компрессор, осушитель,
   *  насос стоя (меньший размер в плане и высота), ресивер, фильтр, шкаф, бак — и наклонив (двумя меньшими размерами);
   *  ресиверам и рефрижераторным осушителям ворота обычно не нужны, крупному адсорбционному — нужны. [{it, narrow, why}] */
  bulky(r, geo){
    const E=this.entryOpen(geo, r.door), P=StationLayout.PASS, n=StationLayout.n, out=[];
    for (const it of r.items.filter(i=>(i.mount==='floor' || i.mount==='frame') && !i.tank && i.kind!=='dgu')){
      const tilt=StationMatrix.tilt(it.kind), [a, b]=[it.l, it.w, it.h].sort((p, q)=>p-q), narrow=tilt ? a : Math.min(it.l, it.w);
      const fits=tilt ? (a+2*P<=E.w && b+P<=E.h) || (b+2*P<=E.w && a+P<=E.h) : narrow+2*P<=E.w && it.h+P<=E.h;
      if (!fits) out.push({ it, narrow, why:`поз. ${it.pos} ${tilt ? 'и наклонённым ' : ''}не проходит в дверь оператора (${n(it.l)} × ${n(it.w)} × ${n(it.h)} мм)` }); }
    return out;
  }
  /** стоит плотно к стене: сзади свободно меньше access.back (матрица, 500 мм) — обслуживание сзади, монтаж и демонтаж —
   *  через сервисные распашные ворота в стене за агрегатом (компрессор, насос и прочее; осушитель, ресивер, фильтр, шкаф,
   *  ДГУ — нет) */
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
    const L=geo.int[0], x0=geo.x0||0, P=StationLayout.PASS, n=StationLayout.n, GM=StationMatrix.gate();
    for (const it of r.items) it.tight=this.tight(it);
    if (r.ends) return this.endsExits(r, geo);
    const rear=r.items.filter(i=>i.tight).map(it=>({ it, rear:true, why:`поз. ${it.pos} стоит в ${n(it.back)} мм от стены (для обслуживания сзади нужно не меньше ${n(StationMatrix.access().back)} мм) — обслуживание сзади, монтаж и демонтаж через них` }));
    if (geo.sea && geo.door && r.door!=='end') r.gates=this.seaDoors(geo);
    const big=this.mounts(r, geo), dgu=r.items.some(i=>i.kind==='dgu' && !i.tank && L-(i.x+i.lx)<=600);
    const fl=r.items.filter(i=>(i.mount==='floor' || i.mount==='frame') && !i.tank);
    // монтажные ворота в торце — у компрессорной и насосной всегда (решение ПНЕВМОТЕХ): по возможности в дальнем
    // торце (у входа — дверь оператора, логотип и приток воздуха)
    const always=!dgu && fl.some(i=>i.kind==='compressor' || i.kind==='pump');
    const free=s=>!avoid.includes(s) && (s==='left' ? x0===0 && r.door!=='end' : !dgu);
    const sides=r.gates ? ['left'] : ['right', 'left'].filter(free);
    const reach=(b, s)=>b.narrow+2*P<=this.pathTo(b.it, s, r, geo);
    let best=null;
    for (const s of sides){ const ok=big.filter(b=>reach(b, s)); if (ok.length && (!best || ok.length>best.ok.length)) best={ s, ok }; }
    if (!best && always && sides.length && !r.gates) best={ s:sides[0], ok:[] };
    const mk=(s, list)=>this.gateFor(r, geo, s, list.length ? list.map(b=>b.it) : fl.filter(i=>i.kind==='compressor' || i.kind==='pump'));
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
    far=far.filter(b=>!this.toGate(r, geo, b, sides));
    far=far.map(b=>{ const w=Math.max(0, ...sides.map(s=>this.pathTo(b.it, s, r, geo)).filter(Number.isFinite));
      return Object.assign({}, b, { why:b.why.replace(/, монтаж и демонтаж — через ворота в торце$/, '')+(sides.length ? `, по проходу к торцу не провезти (${w ? `проход ${n(w)} мм, ` : ''}агрегат — ${n(b.narrow)} мм)` : avoid.length ? ', торцы заняты шкафами на стене' : ', торцы заняты (отсек бака, дверь-жалюзи ДГУ, вход оператора)') }); });
    r.side=[...rear, ...far]; r.doors=this.sideDoors(r.side, r, geo); StationTidy.doors(r.doors);
    this.regate(r, geo);
    this.second(r, geo);
  }
  /** осушитель или ресивер, которого к воротам по проходу не провезти: сервисных дверей им не делают (решение ПНЕВМОТЕХ)
   *  — монтаж и демонтаж через ближние ворота в торце (нет ворот — новые в ближнем свободном торце), при демонтаже
   *  соседнее оборудование переставляют. true — отнесён к воротам; false — не осушитель и не ресивер или торцы заняты */
  toGate(r, geo, b, sides){
    if (!StationMatrix.noDoor(b.it.kind)) return false;
    const L=geo.int[0], x0=geo.x0||0, far=s=>s==='left' ? b.it.x-x0 : L-b.it.x-b.it.lx, near=a=>a.sort((p, q)=>far(p)-far(q))[0];
    let G=[r.gates, r.gates2].filter(Boolean).sort((p, q)=>far(p.wall)-far(q.wall))[0];
    if (!G){ const s=near(sides.slice()); if (!s) return false; G=r.gates=this.gateFor(r, geo, s, [b.it]); }
    if (!G.pos.includes(b.it.pos)){ G.pos.push(b.it.pos);
      G.why.push(`${b.why.replace(/, монтаж и демонтаж — через ворота в торце$/, '')}: сервисных дверей осушителям и ресиверам не делают — монтаж и демонтаж через ворота в торце, при демонтаже соседнее оборудование переставляют`); }
    return true;
  }
  /** штатные двери морского контейнера в торце у входа — как ворота в торце */
  seaDoors(geo){ const W=geo.int[1], dw=Math.min(geo.door[0], W); return { wall:'left', y0:Math.round((W-dw)/2), y1:Math.round((W+dw)/2), w:dw, h:geo.door[1], leaves:2, pos:[], why:[], sea:true }; }
  /** ворота в торце по итогу: ширина — по агрегатам, которые через них монтируют, высота — по самому высокому оборудованию
   *  станции (gateFor); положение, вручную смещённое, — как задано */
  regate(r, geo){
    for (const G of [r.gates, r.gates2]){ if (!G || G.sea) continue;
      const U=r.items.filter(i=>G.pos.includes(i.pos) && (i.mount==='floor' || i.mount==='frame') && !i.tank), q=this.gateFor(r, geo, G.wall, U);
      for (const k of ['y0', 'y1', 'w', 'h', 'full', 'off', 'offWhy', 'manual']) G[k]=q[k]; }
  }
  /** без продольного прохода (r.ends): компрессору — сервисные ворота с обеих сторон (спереди и сзади) и ворота в торце у
   *  него (у морского — его штатные двери); ресиверам в два ряда у дальнего торца — ворота там; остальному, что не пройдёт в
   *  дверь оператора, — ворота в торце, если к ним по проходу провезти, иначе сервисные ворота напротив */
  endsExits(r, geo){
    const P=StationLayout.PASS, C=r.items.filter(i=>i.ends), T=r.items.filter(i=>i.pairEnd), side=[], uniq=a=>[...new Set(a)];
    for (const it of C) it.tight=false;
    r.gates=geo.sea && geo.door ? this.seaDoors(geo) : this.gateFor(r, geo, 'left', C);
    const pc=uniq(C.map(i=>i.pos)); r.gates.pos.push(...pc); r.gates.why.push(`поз. ${pc.join(', ')} — ${C.length>1 ? 'компрессоры в ряд от торца' : 'компрессор у торца'} без продольного прохода: обслуживание сбоку, монтаж и демонтаж — через ворота в торце${C.length>1 ? ' и сервисные ворота' : ''}`);
    if (T.length){ const pr=uniq(T.map(i=>i.pos)); r.gates2=this.gateFor(r, geo, 'right', T); r.gates2.pos.push(...pr);
      r.gates2.why.push(`поз. ${pr.join(', ')} — ресиверы в два ряда у дальнего торца: осмотр, обслуживание, монтаж и демонтаж — через ворота в торце`); }
    for (const it of C) for (const wall of ['front', 'back'])
      side.push({ it, wall, both:true, rear:true, why:`поз. ${it.pos} — без продольного прохода: обслуживание ${wall==='front' ? 'спереди' : 'сзади'}` });
    // между компрессорами — своя дверь оператора в стене прохода (решение ПНЕВМОТЕХ: «для доступа в пространство между
    // компрессорами нужно организовать дверь оператора»; напротив неё — место конвектору)
    const E=StationLayout.ENTRY, ew=E[1]-E[0], eh=StationMatrix.door().h+100, CS=C.slice().sort((a, b)=>a.x-b.x), mid=[];
    for (let i=1; i<CS.length; i++){ const a=CS[i-1].x+CS[i-1].lx, b=CS[i].x, x0=Math.round((a+b-ew)/2);
      mid.push({ wall:'front', x0, x1:x0+ew, w:ew, h:eh, leaves:1, kind:'entry', between:true, pos:[], why:[`между компрессорами поз. ${CS[i-1].pos} и ${CS[i].pos} — доступ к ним сбоку`] }); }
    for (const b of this.bulky(r, geo).filter(b=>!C.includes(b.it) && !T.includes(b.it))){
      const G=[r.gates, r.gates2].find(g=>g && b.narrow+2*P<=this.pathTo(b.it, g.wall, r, geo));
      if (G){ if (!G.pos.includes(b.it.pos)){ G.pos.push(b.it.pos); G.why.push(`${b.why}, монтаж и демонтаж — через ворота в торце`); } }
      else if (!this.toGate(r, geo, b, [])) side.push(Object.assign({}, b, { why:`${b.why}, к воротам в торце не провезти` })); }
    r.side=side; r.doors=mid;   // сервисные ворота — мимо дверей оператора между компрессорами
    r.doors=[...this.sideDoors(side, r, geo), ...mid];
    this.regate(r, geo);
    this.second(r, geo);
  }
  /** распашные монтажные ворота в торце s для агрегатов U: Ш = max W агрегатов + addW + 2·T, В = самое высокое оборудование
   *  станции + addH + T (решение ПНЕВМОТЕХ: ворота в обоих торцах одной высоты), не ниже проёма двери оператора (ворота —
   *  и выход) и не выше помещения; шире доли торца — во весь торец */
  gateFor(r, geo, s, U){
    const [, W, H]=geo.int, D={ ...StationLayout.DOOR, pad:StationLayout.gaps(geo).eW }, n=StationLayout.n, T=geo.t||0, GM=StationMatrix.gate();
    const nw=Math.max(0, ...U.map(i=>Math.min(i.l, i.w))), hh=Math.max(0, ...r.items.filter(i=>(i.mount==='floor' || i.mount==='frame') && !i.tank).map(i=>i.h));
    let w=Math.max(GM.minW, Math.ceil((nw+GM.addW+2*T)/100)*100); const full=w>=GM.full*W || w>W-2*D.pad;
    if (full) w=W-2*D.pad;
    // по оси торца (решение ПНЕВМОТЕХ); смещение — только если агрегат по проходу у стены к центральным воротам не
    // провезти (проём над проходом уже агрегата с зазорами) — на наименьшее нужное, с причиной; вручную — «эксперт» (gate.off)
    const yc=Math.round((W-w)/2), band=this.aisleBand(r, W), needW=nw+2*StationLayout.PASS, lap=y=>Math.min(y+w, band[1])-Math.max(y, band[0]);
    let y0=full ? D.pad : yc, off=0, why='';
    if (!full && U.length && needW<=band[1]-band[0]+1e-9 && lap(yc)<needW-1e-9){ const y=band[1]<=W/2 ? Math.min(yc, band[1]-needW) : Math.max(yc, band[0]+needW-w);
      y0=Math.round(Math.max(D.pad, Math.min(W-D.pad-w, y))); off=y0-yc;
      if (off) why=`смещены на ${n(Math.abs(off))} мм от оси торца к проходу у ${band[1]<=W/2 ? 'передней' : 'задней'} стены: агрегат шириной ${n(nw)} мм провозят по проходу ${n(Math.round(band[1]-band[0]))} мм, по оси торца проём над проходом уже агрегата`; }
    const G0=(this.in.req && this.in.req.gate)||{};
    if (!full && Number.isFinite(G0.off) && G0.off){ y0=Math.round(Math.max(D.pad, Math.min(W-D.pad-w, yc+G0.off))); off=y0-yc; why=String(G0.why||'').trim(); }
    return { wall:s, y0, y1:y0+w, w, h:Math.min(H-GM.top, Math.max(GM.minH, Math.ceil((hh+GM.addH+T)/50)*50)), leaves:2, pos:[], why:[], full, off, offWhy:why, manual:!!(Number.isFinite(G0.off) && G0.off) };
  }
  /** со шкафами на стене: проход до ворот ещё есть; нет — тому агрегату сервисные ворота в боковой стене */
  recheck(r, geo){
    const G=r.gates, side=r.side||[]; delete r.side; if (!G || !G.pos.length) return;
    const P=StationLayout.PASS, lost=this.mounts(r, geo).filter(b=>G.pos.includes(b.it.pos) && !StationMatrix.noDoor(b.it.kind) && !side.some(q=>q.it===b.it) && b.narrow+2*P>this.pathTo(b.it, G.wall, r, geo)); if (!lost.length) return;
    for (const b of lost){ const k=G.pos.indexOf(b.it.pos); if (k<0) continue; G.pos.splice(k, 1); G.why=G.why.filter(t=>!t.startsWith(`поз. ${b.it.pos} `)); }
    if (!G.pos.length && !G.sea){ if (G.wicket && !r.exit) r.exit=this.endExit(r, geo, 'right'); r.gates=null; }
    const keep=r.doors.filter(d=>d.kind==='entry');
    r.doors=[...this.sideDoors([...side, ...lost.map(b=>Object.assign({}, b, { why:b.why.replace(/, монтаж и демонтаж — через ворота в торце$/, '')+', до ворот в торце не провезти мимо шкафов на стене' }))], r, geo), ...keep];
  }
  /** сервисные распашные ворота (уже 1200 мм — дверь): стоящему плотно к стене (rear) — в стене за ним, остальным — в
   *  боковой стене напротив (два ряда — в стене за ним); шире агрегата на service.addW (service.min…service.max), выше на service.addH (не ниже service.minH / двери),
   *  мимо двери оператора; соседние — одними воротами, пока не шире 2400 мм, иначе — рядом через стойку 200 мм */
  sideDoors(list, r, geo){
    const [L, , H]=geo.int, x0=geo.x0||0, D=StationLayout.DOOR, ex=r.door==='side' ? this.entrySpan(r, geo) : null, out=[], T=geo.t||0;
    const { gap, eL }=StationLayout.gaps(geo), lo=Math.max(x0+D.pad, eL), hi=L-eL;   // от края станции и между проёмами
    const keep=(r.doors||[]).filter(d=>d.kind==='entry');   // вторая дверь оператора (сервисные ворота пересчитываются после неё)
    for (const { it, why, rear, wall:w0, both } of list){
      const wall=w0 || (rear ? (r.rows===2 && it.row===1 ? 'front' : 'back') : r.rows===2 && it.row!==1 ? 'back' : 'front');
      // Ш = сторона агрегата + addW + 2·T, В = высота агрегата + addH + T (матрица расстановки)
      const w=StationLayout.svcW(it.lx, T), c=it.x+it.lx/2;
      let d0=Math.max(lo, Math.min(hi-w, c-w/2));
      if (wall==='front' && ex && d0<ex[1]+gap && d0+w>ex[0]-gap) d0=d0+w/2<(ex[0]+ex[1])/2 && ex[0]-gap-w>=lo ? ex[0]-gap-w : Math.min(hi-w, ex[1]+gap);   // мимо двери оператора
      for (const q of keep) if (wall===q.wall && d0<q.x1+gap && d0+w>q.x0-gap) d0=q.x0-gap-w>=lo ? q.x0-gap-w : Math.min(hi-w, q.x1+gap);   // мимо второй двери
      out.push({ wall, x0:Math.round(d0), x1:Math.round(d0+w), h:StationLayout.svcH(it.h, T, rear, H), kind:'service', pos:[it.pos], why:[why], rear:!!rear, both:!!both }); }
    const got=[]; for (const d of out.sort((p, q)=>p.wall.localeCompare(q.wall) || p.x0-q.x0)){ const last=got[got.length-1];
      if (last && last.wall===d.wall && d.x0<last.x1+gap){
        if (Math.max(last.x1, d.x1)-last.x0<=D.max){ last.x1=Math.max(last.x1, d.x1); last.h=Math.max(last.h, d.h); last.rear=last.rear || d.rear;
          for (const v of d.pos) if (!last.pos.includes(v)) last.pos.push(v); for (const t of d.why) if (!last.why.includes(t)) last.why.push(t); continue; }
        const w=d.x1-d.x0; d.x0=last.x1+gap; d.x1=Math.min(hi, d.x0+w); if (d.x1-d.x0<D.min) continue; }   // некуда — агрегат обслуживают через соседние ворота
      got.push(d); }
    // итог по стене: мимо двери оператора и друг от друга — не ближе gap, в пределах стены; не уместилась — агрегат
    // обслуживают через соседние ворота
    const res=[];
    for (const wall of ['front', 'back']){ let prev=null;
      for (const d of got.filter(q=>q.wall===wall).sort((p, q)=>p.x0-q.x0)){ const w=d.x1-d.x0;
        if (prev && d.x0<prev.x1+gap){ d.x0=prev.x1+gap; d.x1=d.x0+w; }
        if (wall==='front' && ex && d.x0<ex[1]+gap && d.x1>ex[0]-gap){ d.x0=ex[1]+gap; d.x1=d.x0+w; }
        for (const q of keep) if (q.wall===wall && d.x0<q.x1+gap && d.x1>q.x0-gap){ d.x0=q.x1+gap; d.x1=d.x0+w; }
        d.x1=Math.min(hi, d.x1); if (d.x1-d.x0<D.min) continue;
        d.w=d.x1-d.x0; d.leaves=Math.max(1, Math.ceil(d.w/D.leaf)); res.push(d); prev=d; } }
    return res;
  }
  /** вторая дверь оператора: проход от двери оператора до дальнего конца длиннее 7 м или шкафы вдоль прохода длиннее 7 м
   *  (ПУЭ, п. 4.1.23) — в дальнем конце прохода: один ряд — в стене прохода у дальнего торца (в r.doors, kind:'entry'), два
   *  ряда — в дальнем торце по оси прохода (r.exit); там ворота — калитка в створке ворот (gates.wicket), дверь-жалюзи ДГУ —
   *  выход через неё */
  second(r, geo){
    const L=geo.int[0], x0=geo.x0||0, E=StationLayout.ENTRY, eh=StationMatrix.door().h+100, n=StationLayout.n, X=StationMatrix.exits(), { gap, eL }=StationLayout.gaps(geo), aR=Math.max(E[0], eL);
    if (r.cross){   // без сквозного прохода: вторая дверь оператора — во второй части (за агрегатом поперёк)
      const C=r.cross, w=E[1]-E[0]; r.second=`сквозного прохода нет — поз. ${C.pos} стоит поперёк станции: к нему сзади и к оборудованию за ним`;
      let a=L-aR-w; for (const d of r.doors.filter(d=>d.wall==='front').sort((p, q)=>q.x0-p.x0)) if (a<d.x1+gap && a+w>d.x0-gap) a=d.x0-gap-w;
      if (a>=C.x1+100){ r.doors.push({ wall:'front', x0:Math.round(a), x1:Math.round(a+w), w, h:eh, leaves:1, kind:'entry', pos:[], why:[r.second] }); return; }
      const G=r.gates2 && r.gates2.wall==='right' ? r.gates2 : r.gates; if (G && G.wall==='right' && !G.sea && G.w/2>=StationLayout.DOOR_MIN+150){ G.wicket={ w:Math.min(StationLayout.DOOR_MIN, G.w/2-150), h:Math.min(StationMatrix.door().h, G.h-150) }; return; }
      r.exit=this.endExit(r, geo, 'right'); return; }
    // выходы: дверь оператора, монтажные ворота в торце (открываются наружу) и дверь-жалюзи ДГУ
    // ресиверы в два ряда поперёк в конце ряда — к дальнему торцу не пройти: ворота там — не выход, вторая дверь — до них
    const pe=r.items.filter(i=>i.pairEnd), lim=pe.length ? Math.min(...pe.map(i=>i.x))-200 : L;
    const es=this.entrySpan(r, geo), at=[], en=r.door==='side' ? (es[0]+es[1])/2 : x0;
    at.push(en); for (const G of [r.gates, r.gates2]) if (G && !(pe.length && G.wall==='right')) at.push(G.wall==='left' ? 0 : L);
    if (r.items.some(i=>i.kind==='dgu' && !i.tank && L-(i.x+i.lx)<=600)) at.push(L);   // дверь-жалюзи ДГУ — выход
    if (r.items.some(i=>i.kind==='dgu' && !i.tank && i.x-x0<=600 && i.rad==='left')) at.push(x0);   // и у ближнего торца (две ДГУ у торцов — решение владельца 19.10: вторая дверь оператора лишняя)
    // вторая дверь оператора — только если до выхода далеко (exits.far) или ряд шкафов длиннее 7 м (ПУЭ, п. 4.1.23); «выходов не
    // меньше 2» и «между выходами 5 м» её больше не требуют (решение владельца 19.10: «тут лишняя дверь оператора, достаточно одной»)
    const far=Math.round(Math.max(Math.min(...at.map(a=>Math.abs(a-x0))), Math.min(...at.map(a=>Math.abs(L-a)))));
    const cab=this.eq.filter(e=>e.kind==='cabinet').reduce((s, e)=>s+e.l*(e.qty||1), 0);
    const why=far>X.far ? `от дальней точки помещения до выхода — ${n(far)} мм, больше ${n(X.far)} мм`
      : cab>StationNorms.SHIELD ? `шкафы вдоль прохода — ${n(cab)} мм, длиннее 7 м (ПУЭ, п. 4.1.23)` : ''; if (!why) return;
    r.second=why;
    if (r.door==='side'){ const w=E[1]-E[0];
      let a=Math.min(L-aR-w, lim-w); for (const d of r.doors.filter(d=>d.wall==='front').sort((p, q)=>q.x0-p.x0)) if (a<d.x1+gap && a+w>d.x0-gap) a=d.x0-gap-w;
      if (a>=es[1]+Math.max(1000, gap)){ r.doors.push({ wall:'front', x0:Math.round(a), x1:Math.round(a+w), w, h:eh, leaves:1, kind:'entry', pos:[], why:[why] }); return; } }
    if (pe.length){   // дальний торец закрыт ресиверами — калитка и дверь там не выход; второй выход — ворота у входа
      if (r.gates && r.gates.wall==='left' && r.issues) r.issues.push({ level:'info', text:`Выходы — дверь оператора и ворота в торце у входа: дальний торец закрыт ресиверами в два ряда, второй двери оператора до них места нет (${why}).` });
      delete r.second; return; }
    const G=[r.gates, r.gates2].find(g=>g && g.wall==='right' && !g.sea);
    if (G && !(r.gates && r.gates2)){ const lw=G.w/2; if (lw>=StationLayout.DOOR_MIN+150){ G.wicket={ w:Math.min(StationLayout.DOOR_MIN, lw-150), h:Math.min(StationMatrix.door().h, G.h-150) }; return; } }
    if (r.items.some(i=>i.kind==='dgu' && !i.tank && L-(i.x+i.lx)<=600)){ r.secondDgu=true; return; }   // выход — через дверь-жалюзи ДГУ
    if (!G) r.exit=this.endExit(r, geo, 'right');
  }
  /** дверь оператора в торце по оси прохода: одностворчатая, наружу, с доводчиком */
  endExit(r, geo, wall){
    const W=geo.int[1], E=StationLayout.ENTRY, D={ h:StationMatrix.door().h+100, pad:StationLayout.gaps(geo).eW }, w=E[1]-E[0];
    if (r.cross && !r.items.some(i=>(i.mount==='floor' || i.mount==='frame') && !i.cross && i.x>=r.cross.x1)){ const y0=Math.round((W-w)/2); return { wall, y0, y1:y0+w, w, h:D.h }; }
    const y0=StationLayout.inWall(this.aisleMid(r, W)-w/2, w, W, D.pad);
    return { wall, y0, y1:y0+w, w, h:D.h };
  }
  /** у каждой ДГУ напротив радиатора — двустворчатая дверь-жалюзи: выброс горячего воздуха и проём для монтажа и демонтажа ДГУ
   *  (шире её на 200 мм, выше на 150 мм): в дальнем торце (rad right), в торце у входа (left) или в задней стене (поперёк, back).
   *  [{wall, y0, y1 (торец) | x0, x1 (задняя стена), w, h, leaves:2, pos, unit, fits}] — радиатор дальше 600 мм от стены — нет */
  /** ширина двери-жалюзи ДГУ по её стороне напротив радиатора, мм: +200 мм, шаг 100, не уже сервисной двери */
  static dguDoorW(len){ return Math.max(StationLayout.DOOR.min, Math.ceil((len+200)/100)*100); }
  dguDoors(r, geo){
    const [L, W, H]=geo.int, x0=geo.x0||0, out=[], hD=g=>Math.min(H-100, Math.max(StationLayout.DOOR.h, g.h+150));
    for (const g of r.items.filter(i=>i.kind==='dgu' && !i.tank && i.mount==='floor')){
      const rad=g.rad || 'right';
      if (rad==='back'){ if (W-(g.y+g.ly)>600) continue; const pad=StationLayout.gaps(geo).eL, w=Math.min(L-x0-2*pad, StationLayout.dguDoorW(g.lx)), a=Math.round(Math.max(x0+pad, Math.min(L-pad-w, g.x+g.lx/2-w/2)));
        out.push({ wall:'back', x0:a, x1:a+w, w, h:hD(g), leaves:2, pos:g.pos, unit:g.unit, fits:w>=g.lx+2*StationLayout.PASS }); continue; }
      if (rad==='right' ? L-(g.x+g.lx)>600 : g.x-x0>600) continue;
      const pad=StationLayout.gaps(geo).eW, w=Math.min(W-2*pad, StationLayout.dguDoorW(g.ly)), y0=Math.round(Math.max(pad, Math.min(W-pad-w, g.y+g.ly/2-w/2)));
      out.push({ wall:rad==='left' ? 'left' : 'right', y0, y1:y0+w, w, h:hD(g), leaves:2, pos:g.pos, unit:g.unit, fits:w>=g.ly+2*StationLayout.PASS }); }
    return out;
  }

  /** ресиверы снаружи (ФНП ОРПД, п. 65) — на бетонной площадке за дальним торцом, где выходит трубопровод: первый — по оси
   *  выхода, следующие — к стене прохода через 600 мм; не помещаются по ширине контейнера — следующий ряд дальше от стены.
   *  Координаты — как у оборудования внутри (от внутренних стен и пола): x за торцом, z — от площадки на земле */
  outside(plan, chassis){
    const E=this.eq.filter(e=>e.outside); if (!E.length) return [];
    const [L, W]=plan.int, ext=plan.geo.ext, ox=(ext[0]-L)/2, oy=(ext[1]-W)/2, zf=StationGeo.zFloor(plan.geo.type), C=StationLayout;
    const air=(plan.piping||[]).flatMap(p=>p.lines||[]).filter(l=>l.medium==='air' && !l.header && l.x1>=L-1), yc=air.length ? air[0].y : W-C.AIR_Y;
    const lo=-oy, hi=W+oy, first=ly=>Math.round(Math.min(hi-ly, Math.max(lo, yc-ly/2))), out=[];
    let x=L+ox+C.OUT_GAP, top=null, col=0;
    for (const e of E) for (let k=0; k<e.qty; k++){
      const lx=e.l, ly=e.w; let y=top==null ? first(ly) : top-C.OUT_STEP-ly;
      if (top!=null && y<lo){ x+=col+C.OUT_STEP; col=0; y=first(ly); }
      top=y; col=Math.max(col, lx);
      out.push(this.unitItem(e, { unit:k, x:Math.round(x), y, z:-(zf+(chassis ? C.CHASSIS_H : 0))+C.PAD, mount:'out', face:-2, air:AirChain.unit(e.air, k) })); }
    return out;
  }

  /** на крыше: глушитель ДГУ — прямо над ДГУ (по центру его длины и ширины), на опорах, вывод выхлопа — вбок; выхлопная
   *  труба — от двигателя вертикально сквозь крышу в глушитель */
  roof(plan){
    const ms=this.eq.filter(e=>e.kind==='muffler' && e.roof); if (!ms.length) return [];
    const [L, W]=plan.int, ow=plan.geo && plan.geo.ext ? (plan.geo.ext[1]-W)/2 : 100, dg=plan.items.filter(i=>i.kind==='dgu' && !i.tank).sort((a, b)=>a.x-b.x), out=[];
    // хоть у одной ДГУ глушитель на крыше — на крыше у всех (решение владельца 19.10): недостающие — как последний в составе
    const all=[]; for (const m of ms) for (let u=0; u<m.qty; u++) all.push([m, u]);
    for (let u=all.length; u<dg.length; u++){ const m=all[all.length-1][0]; all.push([m, u-all.filter(q=>q[0]!==m).length]); }
    let k=0, next=Math.max(100, L/2-ms[0].l/2);
    for (const [m, u] of all){ k++; const kk=k-1;
      const d=m.w, g=dg[kk], rad=(g && g.rad) || 'right', R={ pos:m.pos, unit:u, name:m.name, brief:m.brief, short:m.short, kind:'muffler', h:d, d, known:m.known, mass:m.mass, color:m.color,
        gap:StationLayout.ROOF_GAP, outlet:StationLayout.OUTLET, dgu:g ? { pos:g.pos, unit:g.unit } : null };
      // ДГУ поперёк — глушитель вдоль неё (по ширине станции), выхлоп — к задней стене (над радиатором)
      if (rad==='back'){ const l=Math.min(m.l, W+2*ow-80), y=Math.round(Math.max(-ow+40, Math.min(W+ow-40-l, g.y+g.ly/2-l/2))), x=Math.round(Math.max(100, Math.min(L-100-d, g.x+g.lx/2-d/2)));
        out.push({ ...R, x, y, lx:d, ly:l, dir:'y+', exhaust:{ x:Math.round(g.x+g.lx/2), y:Math.round(Math.max(y+120, Math.min(y+l-120, g.y+g.ly*0.62))), z:g.h } }); continue; }
      const l=Math.min(m.l, L-200), cx=g ? g.x+g.lx/2 : next+l/2;
      const x=Math.round(Math.max(100, Math.min(L-100-l, cx-l/2))), y=Math.round(g ? Math.max(-ow+40, Math.min(W+ow-40-d, g.y+g.ly/2-d/2)) : W/2-d/2);
      const ex=g ? Math.round(Math.max(x+120, Math.min(x+l-120, g.x+g.lx*(rad==='left' ? 0.38 : 0.62)))) : null;   // выхлоп двигателя — входит в глушитель снизу
      out.push({ ...R, x, y, lx:l, ly:d, dir:rad==='left' ? 'x-' : 'x+', exhaust:g ? { x:ex, y:Math.round(g.y+g.ly/2), z:g.h } : null });
      next=x+l+300; }
    return out;
  }
  /** станция из модулей: сведения (раскладка, размер модуля, стыковка); оборудование на стыке — ошибка (модуль везут с
   *  оборудованием внутри); стойки каркаса на пересечениях стыков — в проходе, замечание */
  modsNotes(plan){
    const g=plan.geo, m=g && g.mods; if (!m || !m.Lm) return;
    const n=StationLayout.n, iss=plan.issues=plan.issues||[], [L, W, H]=plan.int, P=StationMods.posts(g), ps=StationMods.M.post/2;
    const fl=(plan.items||[]).filter(i=>i.mount!=='wall' && i.mount!=='pipe');
    iss.push({ level:'info', mods:true, text:`Станция из модулей: ${StationMods.shape(m)} — модуль ${n(m.Lm)} × ${n(m.Wm)} × ${n(g.ext[2])} мм (в габарите перевозки, каждый везётся отдельно), вместе ${n(g.ext[0])} × ${n(g.ext[1])} мм, внутри — одно помещение ${n(L)} × ${n(W)} × ${n(H)} мм. Каждый агрегат — целиком в своём модуле. На производстве станцию собирают и стыкуют, обвязывают, запускают и проверяют; на перевозку — расстыковка трубопровода, кабелей и коммуникаций на стыках (разъёмные соединения), стыковые проёмы — временными щитами; модули везут с оборудованием внутри. На объекте — быстрая стыковка: соединение каркасов, уплотнение, нащельники на стенах и кровле, пол без порога, подключение сетей через стык; стыков — ${StationMods.joints(m)}.` });
    const ws=StationMods.widths(), wl=ws[0], wh=ws[ws.length-1];
    if (m.Wm<wl || m.Wm>wh) iss.push({ level:'warn', mods:true, text:`Ширина модуля ${n(m.Wm)} мм — вне ${n(wl)}…${n(wh)} мм (модули — одной ширины, не шире габарита перевозки): уберите размер — он подберётся по оборудованию.` });
    if (m.Lm<StationMods.M.lMin) iss.push({ level:'warn', mods:true, text:`Длина модуля ${n(m.Lm)} мм — меньше ${n(StationMods.M.lMin)} мм (модуль станции из нескольких модулей — не короче; «Настройки → Правила компоновки → Станция из нескольких модулей»): уберите размер — он подберётся по оборудованию, или соберите станцию из меньшего числа модулей.` });
    if (m.Lm>StationLayout.MAX_L) iss.push({ level:'warn', mods:true, text:`Длина модуля ${n(m.Lm)} мм — больше наибольшей длины перевозки ${n(StationLayout.MAX_L)} мм.` });
    const on=StationMods.cross(plan.items, g);
    if (on.length){ plan.level='error'; iss.push({ level:'error', mods:true, text:`Поз. ${[...new Set(on.map(i=>i.pos))].join(', ')} — на стыке модулей: модуль везут с оборудованием внутри, каждый агрегат должен быть целиком в своём модуле. Выберите другую раскладку или размер модуля по оборудованию («Модули…»).` }); }
    for (const p of P){ const hit=StationMods.hits(fl, g).filter(i=>i.x<p.x+ps && i.x+i.lx>p.x-ps && i.y<p.y+ps && i.y+i.ly>p.y-ps);
      if (hit.length){ plan.level='error'; iss.push({ level:'error', mods:true, text:`Поз. ${[...new Set(hit.map(i=>i.pos))].join(', ')} — на стойке каркаса стыка модулей (${n(p.x)}, ${n(p.y)} мм): выберите другую раскладку модулей или измените состав.` }); }
      else iss.push({ level:'info', mods:true, text:`Стойка каркаса на пересечении стыков модулей — ${n(2*ps)} × ${n(2*ps)} мм (${n(p.x)}, ${n(p.y)} мм от угла помещения): в проходе её обходят.` }); }
  }
  /** выхлоп каждой ДГУ (решение владельца 19.10): глушитель на крыше — если он в составе для неё, иначе — вывод через стену
   *  (глушитель встроен в ДГУ, у небольших ДГУ — штатно): у ДГУ вдоль — в задней стене над двигателем, поперёк — в задней
   *  стене рядом с дверью-жалюзи; высота — над ДГУ (не выше 200 мм под потолком). [{pos, unit, how:'roof'|'wall', wall, u, z}] */
  exhausts(plan){
    const [, W, H]=plan.int, dg=(plan.items||[]).filter(i=>i.kind==='dgu' && !i.tank && i.mount==='floor'), roof=plan.roof||[];
    return dg.map(g=>{ const r=roof.find(m=>m.dgu && m.dgu.pos===g.pos && m.dgu.unit===g.unit), o={ pos:g.pos, unit:g.unit, x:Math.round(g.x+g.lx/2), y:Math.round(g.y+g.ly/2) };
      if (r) return { ...o, how:'roof' };
      const rad=g.rad || 'right', z=Math.round(Math.min(H-200, g.h+250)), d=(plan.dguDoors||[]).find(q=>q.pos===g.pos && q.unit===g.unit);
      // над турбиной двигателя (у радиатора, как рисует 3D-вид); поперёк — рядом с дверью-жалюзи
      const u=rad==='back' ? Math.round(d ? d.x1+200 : g.x+g.lx/2) : Math.round(rad==='left' ? g.x+g.lx*0.16+300 : g.x+g.lx*0.84-300);
      return { ...o, how:'wall', wall:'back', u, z, gap:Math.max(0, W-g.y-g.ly) }; });
  }

  /** выход трубопровода из станции (решение владельца 19.10): магистраль выходит через дальний торец; если там ворота, дверь
   *  или дверь-жалюзи ДГУ (проём на высоте трубы с запасом pipe.outGap) — выход переносится на ближайшую свободную стену:
   *  сначала стена, вдоль которой идёт линия (задняя — у компрессорной), ближе к торцу и не дальше последнего отвода; затем
   *  противоположная; затем над проёмом в том же торце (если под потолком хватает места). На выходе снаружи — патрубок с
   *  фланцем (l.out.flange, мм выступа). l.out — {wall:'right'|'back'|'front', x, y, z, moved, why}; x1 линии — до выхода */
  outlet(plan){
    const [L, W, H]=plan.int, P=StationMatrix.grp('pipe'), gap=P.outGap, edge=P.outEdge, n=StationLayout.n, iss=plan.issues=plan.issues||[];
    const ext=!!this.eq.some(e=>e.outside), taken=[];
    const endOpen=[...[plan.gates, plan.gates2].filter(g=>g && g.wall==='right').map(g=>({ y0:g.sea ? 0 : g.y0, y1:g.sea ? W : g.y1, h:g.sea ? H : g.h, t:g.sea ? 'штатные двери' : 'ворота' })),
      ...(plan.exit && plan.exit.wall==='right' ? [{ y0:plan.exit.y0, y1:plan.exit.y1, h:plan.exit.h, t:'вторая дверь оператора' }] : []),
      ...(plan.dguDoors||[]).filter(d=>d.wall==='right').map(d=>({ y0:d.y0, y1:d.y1, h:d.h, t:'дверь-жалюзи ДГУ' }))];
    const wallOpen=w=>[...(plan.doors||[]).filter(d=>d.wall===w).map(d=>({ x0:d.x0, x1:d.x1, t:d.kind==='entry' ? 'дверь оператора' : 'сервисные ворота' })),
      ...(plan.entry && plan.entry.wall===w ? [{ x0:plan.entry.x0, x1:plan.entry.x1, t:'дверь оператора' }] : []),
      ...(plan.dguDoors||[]).filter(d=>d.wall===w).map(d=>({ x0:d.x0, x1:d.x1, t:'дверь-жалюзи ДГУ' })),
      ...plan.items.filter(i=>i.mount==='wall' && i.wall===w).map(i=>({ x0:i.x, x1:i.x+i.lx, t:'шкаф' })),
      ...StationMods.lines(plan.geo).x.map(x=>({ x0:x-StationMods.M.post/2, x1:x+StationMods.M.post/2, t:'стык модулей' }))];
    for (const l of (plan.lines||[]).filter(q=>q.label && !q.header && q.x1>=L-1)){
      const blk=endOpen.find(o=>l.y>o.y0-gap && l.y<o.y1+gap && l.z<o.h+gap);
      if (!blk || ext){ l.out={ wall:'right', x:L, y:l.y, z:l.z, moved:false, flange:P.flange };
        if (blk) iss.push({ level:'warn', text:`Выход трубопровода через торец — в проёме (${blk.t}): ресиверы снаружи стоят за торцом. Перенесите их или ворота в другой торец.` });
        continue; }
      const bx=Math.max(0, ...(l.branches||[]).map(b=>b.x), ...plan.items.filter(i=>i.mount==='pipe' && Math.abs(i.y+i.ly/2-l.y)<i.ly).map(i=>i.x+i.lx)), lo=bx+100, why=blk.t;   // после последнего отвода и фильтров на трубе
      const side=w=>{ const wy=w==='back' ? W : 0, O=wallOpen(w).filter(o=>o.x1>lo-gap);
        for (let x=Math.round(L-edge); x>=lo; x-=50){
          if (O.some(o=>x>o.x0-gap && x<o.x1+gap) || taken.some(t=>t.wall===w && Math.abs(t.x-x)<300)) continue;
          if (plan.items.some(i=>i.mount!=='pipe' && i.mount!=='wall' && x>i.x-60 && x<i.x+i.lx+60 && i.y<Math.max(l.y, wy)+60 && i.y+i.ly>Math.min(l.y, wy)-60 && i.h>l.z-120)) continue;   // отвод к стене — мимо оборудования
          return { wall:w, x, y:wy, z:l.z, moved:true, why, flange:P.flange }; }
        return null; };
      const near=l.y>W/2 ? 'back' : 'front', far=near==='back' ? 'front' : 'back';
      let o=side(near) || side(far);
      if (!o){ const z=Math.max(...endOpen.filter(q=>l.y>q.y0-gap && l.y<q.y1+gap).map(q=>q.h))+Math.min(gap, 100);   // над проёмом в торце
        if (z<=H-100) o={ wall:'right', x:L, y:l.y, z, rise:true, moved:true, why, flange:P.flange }; }
      if (!o){ l.out={ wall:'right', x:L, y:l.y, z:l.z, moved:false, flange:P.flange };
        iss.push({ level:'warn', text:`Выход трубопровода в дальнем торце — в проёме (${why}), а на стенах рядом места нет: перенесите ворота или укажите место выхода сборщику.` }); continue; }
      if (o.wall!=='right') l.x1=o.x; else if (o.rise) l.x1=Math.round(L-150);   // над проёмом: подъём у торца
      l.out=o; taken.push(o);
      iss.push({ level:'info', text:`Выход трубопровода${l.medium==='air' ? ' сжатого воздуха' : ''} перенесён: в дальнем торце — ${why}. ${o.wall==='right' ? `Выход — над проёмом в торце, на высоте ${n(o.z)} мм от пола` : `Выход — через ${o.wall==='back' ? 'заднюю стену' : 'стену прохода'} в ${n(L-o.x)} мм от дальнего торца (внутри), на высоте ${n(o.z)} мм от пола`}; снаружи — патрубок с фланцем.` }); }
  }
  /** путь выхода от конца магистрали до внутренней поверхности стены: {pts:[[x, y, z]…] (внутри, мм), dir:[dx, dy] — наружу} */
  static outPath(l, W){
    const o=l.out; if (!o) return null;
    if (o.wall==='back' || o.wall==='front'){ const wy=o.wall==='back' ? W : 0; return { pts:[[o.x, l.y, l.z], [o.x, wy, l.z]], dir:[0, o.wall==='back' ? 1 : -1] }; }
    return o.rise ? { pts:[[l.x1, l.y, l.z], [l.x1, l.y, o.z], [o.x, l.y, o.z]], dir:[1, 0] } : { pts:[[o.x, l.y, l.z]], dir:[1, 0] };
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
    return { id:e.id, pos:e.pos, unit:e.unit, name:e.name, brief:e.brief, short:e.short, kind:e.kind, shape:e.shape, look:e.look||'', color:e.color, colorKnown:e.colorKnown, tones:e.tones||null, maker:e.maker||'',
      known:e.known, mass:e.mass, kw:e.kw, x:geo.x0+this.G+it.x, y:it.y+this.G, z:0, lx:it.lx, ly:it.d, h:e.h, rot:!!it.o.rot || !!e.cross, face:it.face, back:it.back+this.G, backRec:e.cross ? 0 : e.c.back[0]+this.G, aisle:it.aisle+this.G, cross:!!e.cross,
      l:e.l, w:e.w, row:it.ri, rad:it.o.rad||null, mount:e.slot ? e.mount : 'floor', slot:!!e.slot, pipe:!!e.pipe, air:e.air||null, pic:e.pic||null, flow:e.flow||null, cool:e.cool||null, comb:e.comb||null, heat:e.heat||null, ctype:e.ctype||'' };
  }
  /** шкаф на стене или фильтр на трубе — не из ряда */
  unitItem(e, o){
    return Object.assign({ id:e.id, pos:e.pos, unit:e.unit, name:e.name, brief:e.brief, short:e.short, kind:e.kind, shape:e.shape, look:e.look||'', color:e.color, colorKnown:e.colorKnown, tones:e.tones||null, maker:e.maker||'',
      known:e.known, mass:e.mass, kw:e.kw, lx:e.l, ly:e.w, h:e.h, rot:false, face:-1, back:0, aisle:0, l:e.l, w:e.w, row:-1, slot:false, pipe:!!e.pipe, air:e.air||null, pic:e.pic||null }, o);
  }
  used(items, geo){ const fl=items.filter(i=>i.mount!=='wall' && i.mount!=='pipe' && !i.tank), I=fl.length ? fl : items;
    const x0=Math.min(...I.map(i=>i.x)), x1=Math.max(...I.map(i=>i.x+i.lx)); return { x0, x1, free:Math.max(0, geo.int[0]-(x1-x0)-geo.x0) }; }

  /** длина ряда(ов) при ширине Wi, мм: row1 — один ряд, row2 — два ряда с проходом;
   *  lvl 0 — с рекомендуемыми промежутками (без поворотов), 1 — с «не менее» (поперёк — что помещается по ширине);
   *  null — не проходит по ширине */
  need(units, Wi, arr, lvl){
    if (!units.length) return 0;
    if (this.dguSt && arr!=='row1') return null;    // ДГУ-станция — свои варианты (rowD)
    // ДГУ вдоль — посередине ширины: подбор контейнера сначала ищет ширину, где проход с обеих сторон не уже допустимого
    if (this.dguSt && this.midNeed){ const D=units.filter(e=>e.kind==='dgu'), M=StationMatrix.grp('dgu');
      if ((D.length===1 || (D.length===2 && M.two && !this.tank)) && D.some(e=>Wi<e.w+2*M.pass)) return null; }
    const r=this.dguSt ? this.rowD(units, 0, Wi) : arr==='row1' ? this.row1(units, 0, Wi, !lvl) : arr==='rowX' ? this.rowX(units, 0, Wi, !lvl) : arr==='rowE' ? this.rowE(units, 0, Wi, this.T) : this.row2(units, 0, Wi, !lvl);
    if (r.ok) return 0;
    if (!/^length/.test(r.why)) return null;
    return lvl ? (this.closeOk && r.needLc!=null ? r.needLc : r.needL) : r.needL0;
  }

  /** высота внутри, мм, нужная над сервисными воротами за агрегатами: ворота + трубопровод над ними + жалюзи выброса
   *  (короб-воздухоотвод) + зазор под потолком; ворот нет — 0 */
  overGate(r){ const D=(r.doors||[]).filter(d=>d.rear); return D.length ? Math.max(...D.map(d=>d.h))+StationLayout.OVER_GATE+StationMatrix.louvre()+this.G : 0; }
  // без продольного прохода (две пары сервисных ворот и ворота в обоих торцах — дороже) — если площадь пола меньше хотя бы
  // на fit.ends %; ресиверы парами поперёк — если станция короче хотя бы на fit.recv2 мм; два ряда — если площадь меньше
  // на fit.two % (матрица расстановки, «Настройки»)
  static get RECV2(){ return StationMatrix.fit().recv2; }
  static get ENDS_K(){ return 1-StationMatrix.fit().ends/100; }
  static get PAIR_SIDE(){ return StationMatrix.recv().pairSide; }   // ресиверы в два ряда: осмотр сбоку — через промежуток не меньше, мм
  static get OVER_GATE(){ return StationMatrix.grp('exhaust').over; }   // над сервисными воротами: перемычка и трубопровод до низа жалюзи выброса, мм
  /** блок-контейнер «по проекту» — по необходимому месту, без запаса (шаг 100 мм), всегда с проходом для оператора и
   *  обслуживания. Варианты по порядку: проход и все отступы рекомендуемые; проход и отступ от стены «не менее», промежутки
   *  рекомендуемые; всё «не менее» — в ширине, которую везут без спецразрешения; затем шире. В варианте — наименьшая площадь пола
   *  (длина × ширина); два ряда — только если заметно меньше одного (на четверть: один ряд удобнее в обслуживании и обвязке) */
  /** размер по оборудованию; ресиверы (от двух) — парами поперёк в конце ряда, если так станция короче хотя бы на fit.recv2
   *  при той же или меньшей ширине, даже с отступами «не менее» (решение владельца 19.10: «часть ресиверов — в 2 ряда для
   *  экономии длины»; раньше пары брались только в варианте с теми же отступами) */
  autoSize(units, geo){
    const r=this.autoSize0(units, geo);
    if (this.forcePairs || geo.fixL || !r.geo || !r.geo.ext || (r.items||[]).some(i=>i.pairEnd) || units.filter(e=>e.kind==='receiver' && !e.outside).length<2 || !(StationLayout.RECV2>0)) return r;
    let q=null; this.forcePairs=true; try{ q=this.autoSize0(units, geo); } finally{ this.forcePairs=false; }
    if (!q || q.level==='error' || !q.geo || !q.items.some(i=>i.pairEnd) || q.geo.ext[1]>r.geo.ext[1] || q.geo.ext[0]>r.geo.ext[0]-StationLayout.RECV2) return r;
    q.issues.push({ level:'info', text:`Ресиверы — частью в два ряда поперёк у торца: станция короче на ${StationLayout.n(r.geo.ext[0]-q.geo.ext[0])} мм (${StationLayout.n(q.geo.ext[0])} вместо ${StationLayout.n(r.geo.ext[0])} мм); отступы — допустимые («не менее»).` });
    return q;
  }
  autoSize0(units, geo){
    this.inMods=!!geo.mods; this.jGeo=null;
    const G=StationGeo, B=G.BLOCK, t=geo.t, f=G.flex(geo.type), n=StationLayout.n, x0=geo.x0||0, wallX=2*(t+f.wall), hOf=f.floor+t+f.roof;
    const floor=units.filter(e=>!e.pipe && e.mount!=='wall'), probe=floor.length ? floor : units.map(e=>Object.assign({}, e, { slot:true }));
    const g2=2*this.G, needH=lvl=>Math.max(B.hWalk, ...units.filter(e=>!e.pipe).map(e=>e.mount==='wall' ? e.h+StationLayout.CAB_LOW+150 : e.h+Math.max(this.G, e.kind==='compressor' ? e.c.top[1] : e.c.top[lvl])));
    // в габарите перевозки: как обычно (по умолчанию — сразу самая плотная компоновка: допустимые отступы и проход, решение
    // ПНЕВМОТЕХ; «просторно» — сначала рекомендуемые), затем исключения компрессорной; негабарит — последним и только
    // если он разрешён правилами (fit.wide)
    // уровень: [отступ сзади и проход, промежутки, что недопустимо в варианте]: 'rec' — всё рекомендуемое; 'gate' — без
    // сервисных ворот (они дороже: сначала шире или длиннее в пределах габарита) и с доступом ко всем сторонам; 'acc' — с
    // доступом ко всем сторонам (сервисные ворота или без продольного прохода — что меньше); '' — как вышло
    // длина задана (fixL): ширина и высота — по оборудованию, плотность — какая нужна в этой длине: сначала просторно,
    // затем плотно, затем исключения
    const F=StationMatrix.fit(), fixL=geo.fixL||0, lv=fixL ? [[0, 0, 'rec'], [1, 0, ''], [1, 1, 'gate'], [1, 1, 'acc'], [1, 1, '']] : F.dense ? [[1, 1, 'gate'], [1, 1, 'acc'], [1, 1, '']] : [[0, 0, 'rec'], [1, 0, ''], [1, 1, '']], tiers=[];
    for (const [lw, ll, st] of lv) tiers.push([lw, ll, false, {}, st]);
    for (const m of this.modes().slice(1).filter(m=>!m.ends)) tiers.push([1, 1, false, m, '']);
    // последний приём в габарите перевозки перед выносом ресиверов наружу и негабаритом (решение ПНЕВМОТЕХ: ресиверы и
    // фильтры вплотную — только если иначе станция не в габарите; отметка recv.close в «Настройках»)
    if (StationMatrix.recv().close && this.eq.some(e=>e.place && (e.kind==='receiver' || (e.kind==='filter' && !e.pipe)))) for (const m of this.modes().filter(m=>!m.ends)) tiers.push([1, 1, false, m, '', true]);
    if (F.wide) for (const [lw, ll, st] of lv) tiers.push([lw, ll, true, {}, st]);
    // расстановка в размере ext и режиме m — одна на весь подбор: уровни (tiers) и соседние варианты длины проверяют одни и те
    // же размеры (принятый вариант дописывается в done — после этого поиск заканчивается)
    const tried=new Map(), fitAt=(g, m)=>{ const k=g.ext.join('×')+JSON.stringify(m)+(this.closeAll ? 'c' : ''); let r=tried.get(k); if (!r){ r=this.fit(units, g, [m]); tried.set(k, r); } return r; };
    let tall=null;
    // ДГУ посередине ширины — только если так встаёт в габарите перевозки (иначе — ближе к задней стене, как выйдет)
    // из модулей: ширина — модуля (в габарите перевозки) × b, длина — модуля (до наибольшей) × a; негабарита нет
    const MD=geo.mods, ka=MD ? MD.a : 1, kb=MD ? MD.b : 1;
    const Wroad=G.inner(geo.type, [10000, G.ROAD_W*kb, B.maxH], t)[1]-g2, midOk=units.filter(e=>e.kind==='dgu').every(e=>e.w+2*StationMatrix.grp('dgu').pass<=Wroad);
    for (const [lw, ll, wide, m, st, close] of tiers){ if (MD && (wide || (m.ends && MD.b>1))) continue; if (this.forcePairs && (close || wide)) continue;   /* модули: без негабарита; без продольного прохода (сервисные ворота, двери оператора между компрессорами) — в один ряд модулей (решение владельца 19.10) */ this.closeAll=!!close; this.closeOk=!!close; this.midNeed=!wide && !!st && midOk; let got=null;
      try{ got=this.withMode(m, ()=>{
        const Hx=Math.max(B.minH, G.up(needH(lw)+hOf)); if (Hx>B.maxH){ tall=tall||Hx; return null; }
        const cand=[];
        const Ws=[]; if (MD) for (const Wm of StationMods.widths()) Ws.push(Wm*kb);   // модули — одинаковой ширины mods.wMin…wMax (решение владельца 19.10)
        else { for (let Wx=G.up(wide ? G.ROAD_W+1 : B.minW); Wx<=(wide ? B.maxW : G.ROAD_W); Wx+=G.STEP) Ws.push(Wx);
          if (!wide && Ws[Ws.length-1]<G.ROAD_W) Ws.push(G.ROAD_W); }   // наибольшая ширина без спецразрешения — 2 550 мм (не кратна 100)
        const LX=L=>ka*Math.max(B.minL, MD ? StationMods.M.lMin : 0, G.up((L+g2+x0+wallX)/ka));   // длина станции: у модулей — модуль с шагом 100 мм × a
        for (const Wx of Ws){
          const Wi=G.inner(geo.type, [10000, Wx, Hx], t)[1];
          // без продольного прохода — ради габарита перевозки: только если с проходом всё рекомендуемое не вышло, и в наибольшей
          // ширине без спецразрешения (уже — плотнее без нужды)
          for (const arr of ['row1', 'row2', ...(m.cross ? ['rowX'] : []), ...(this.comp && lw && !m.cross && !x0 && (!MD || MD.b===1) && Wx===G.ROAD_W*kb && StationMatrix.modes().ends ? ['rowE'] : [])]){
            const L=this.need(probe, Wi-g2, arr, ll); if (L==null) continue;
            const Lx=LX(L); if (fixL && Lx>fixL) continue;
            if (Lx<=StationLayout.MAX_L*ka && !this.forcePairs) cand.push({ Lx, Wx, two:arr==='row2', a:Lx*Wx/(arr==='row2' ? 1-F.two/100 : arr==='rowE' ? StationLayout.ENDS_K : 1), m:arr==='rowE' ? { ...m, ends:true } : m });
            // ресиверы в два ряда в конце ряда (поперёк) — если станция так заметно короче
            // (и если без них длиннее наибольшей длины — иначе станция не помещается вовсе)
            if (arr==='row1'){ this.recv2=true; let L2=null; try{ L2=this.need(probe, Wi-g2, arr, this.forcePairs ? 1 : ll); } finally{ this.recv2=false; }
              const Lx2=L2==null ? null : LX(L2); if (Lx2!=null && (this.forcePairs || Lx2<=Lx-StationLayout.RECV2 || Lx>StationLayout.MAX_L*ka) && !fixL) cand.push({ Lx:Lx2, Wx, two:false, a:Lx2*Wx, m }); }
          } }
        cand.sort((p, q)=>p.a-q.a || p.Lx-q.Lx);
        const seen=new Set();
        const done=(r, g2, Wx)=>{ r.geo=g2; r.picked=true;
          r.density=StationLayout.density(lw, m, r, wide);
          if (close) r.density={ id:'max', title:'Максимально плотно', text:[r.density.id==='max' ? r.density.text : '', 'ресиверы и фильтры вплотную'].filter(Boolean).join(', ') };
          if (fixL) r.issues.push({ level:'info', fixL:true, text:`Длина задана: ${n(fixL)} мм — компоновка «${r.density.title}» (${r.density.text}); ширина и высота — по оборудованию.` });
          StationLayout.soft(r);
          if (close) r.issues.push({ level:'warn', close:true, text:'Ресиверы и фильтры стоят вплотную друг к другу (промежутки — меньше «плотно» в правилах компоновки): исключение, чтобы станция прошла по габариту перевозки и ресиверы остались внутри (решение ПНЕВМОТЕХ: вплотную — только если иначе не в габарите). Осмотр — спереди и сбоку, через промежутки пар.' });
          if (wide) r.issues.push({ level:'warn', wide:true, text:`Негабарит: ширина ${n(Wx)} мм — шире габарита перевозки (без спецразрешения — до ${n(G.ROAD_W)} мм). Исключение: в ${n(G.ROAD_W)} мм не помещается даже плотно и без продольного прохода — перевозка со спецразрешением; иначе — две станции или меньше оборудования.` });
          return r; };
        // шкафы заняли торцы, и демонтаж — через сервисные ворота в боковой стене (дорого): сначала — длиннее или шире (площадь —
        // до 1,2 от первого варианта), чтобы шкафы встали на стену прохода, а ворота — в торец; не вышло — первый вариант
        let alt=null, pick=null;   // pick — аккуратнейший из равных по площади (у модулей — и чуть длиннее, look.modStep)
        const T=StationTidy.M, extra=MD ? T.modStep*G.STEP*ka : 0;
        const take=(r, g2, Wx, Lx)=>{ const sc=StationTidy.score(r, g2).score, area=Lx*Wx;
          if (!pick) pick={ r, g2, Wx, sc, area, Lx, lim:Lx+extra }; else if (sc>pick.sc+2 && area<=pick.area+extra*Wx) Object.assign(pick, { r, g2, Wx, sc, Lx }); };
        for (const c of cand){ if (alt && c.a>alt.a*1.2) break; if (pick && (!T.tidy || c.Lx*c.Wx>pick.area+extra*c.Wx)) break; const key=c.Lx+'×'+c.Wx+(c.m.ends ? 'E' : ''); if (seen.has(key)) continue; seen.add(key);
          for (let Lx=fixL || c.Lx; Lx<=(fixL || Math.min(StationLayout.MAX_L*ka, c.Lx+(MD ? 1500*ka+3000 : 1500))); Lx+=G.STEP*ka){   // у модулей — дальше: стойку стыка обойти   // шкафам и фильтрам может понадобиться место в ряду
            let g2=Object.assign({}, geo, { auto:false, road:true, ext:[Lx, c.Wx, Hx], ...(MD ? { mods:{ ...MD, Lm:Lx/ka, Wm:c.Wx/kb } } : {}) }); g2.int=G.inner(geo.type, g2.ext, t);
            let r=fitAt(g2, c.m); if (r.level==='error') continue;
            if (MD && StationMods.cross(r.items, g2).length) continue;   // на стыке модулей — длиннее или другая ширина (каждый агрегат — целиком в своём модуле)
            // сервисные ворота за агрегатом: над ними — трубопровод и выброс горячего воздуха коробом (решение ПНЕВМОТЕХ) —
            // контейнер выше, если места над воротами мало
            const up=this.overGate(r); if (up>g2.int[2]){ const H2=G.up(up+hOf);
              if (H2<=B.maxH){ const g3=Object.assign({}, g2, { ext:[Lx, c.Wx, H2] }); g3.int=G.inner(geo.type, g3.ext, t); const r3=fitAt(g3, c.m); if (r3.level!=='error'){ r=r3; g2=g3; } } }
            if (c.two && r.rows===1) break;                                          // вышел один ряд — его место среди однорядных
            if (this.forcePairs && !r.items.some(i=>i.pairEnd)) break;                // ресиверы парами: длиннее — уже не парами
            const w=r.issues.filter(i=>i.level==='warn').map(i=>i.text);
            if (st==='rec' && (w.some(x=>/^Проход|стоит в/.test(x)) || r.items.some(i=>i.tight))) break;   // рекомендуемые проход и отступ сзади не вышли — другая ширина
            if (st==='gate' && r.items.some(i=>i.ends)) break;   // без продольного прохода — не в этом уровне
            if (st==='gate' && (r.items.some(i=>i.tight) || (r.doors||[]).some(d=>d.kind!=='entry'))) continue;   // без сервисных ворот и дверей не вышло — длиннее (без поворота агрегата) или другая ширина
            // не ко всем сторонам есть доступ — длиннее (промежутки растут); сразу другая ширина давала станцию больше при
            // меньших отступах в правилах
            if ((st==='gate' || st==='acc' || close) && w.some(x=>/не подойти/.test(x))) continue;   // вплотную — только если к ресиверам и фильтрам остаётся подход
            if (ll===0 && w.some(x=>/^Промежутки|^Отступы/.test(x))) continue;      // промежутки — длиннее (место шкафу или фильтру в ряду)
            if ((r.doors||[]).some(d=>(d.why||[]).some(x=>/торцы заняты шкафами/.test(x)))){ alt=alt || { r, g2, Wx:c.Wx, a:c.a }; continue; }
            if (!T.tidy && !extra) return done(r, g2, c.Wx);
            take(r, g2, c.Wx, Lx);
            if (!extra || Lx>=pick.lim) break;   // у модулей — ещё до look.modStep шагов длиннее: стык между группами, массы ровнее
          } }
        if (pick) return done(pick.r, pick.g2, pick.Wx);
        return alt ? done(alt.r, alt.g2, alt.Wx) : null; }); }
      finally{ this.closeAll=false; this.midNeed=false; }
      if (got) return got; }
    if (fixL){ const r0=this.autoSize(units, { ...geo, fixL:null }), L0=r0.geo && r0.geo.ext ? r0.geo.ext[0] : null;
      return { level:'error', geo, ext:null, int:null, issues:[{ level:'error', text:L0 ? `В заданную длину ${n(fixL)} мм оборудование не помещается даже максимально плотно — в габарите перевозки нужно не меньше ${n(L0)} мм. Увеличьте длину или уберите её (размер — по оборудованию).` : `В заданную длину ${n(fixL)} мм оборудование не помещается. ${r0.issues && r0.issues[0] ? r0.issues[0].text : ''}` }] }; }
    if (MD) return { level:'error', geo, ext:null, int:null, issues:[{ level:'error', text:`В раскладке «${StationMods.shape(MD)}» оборудование не помещается (модуль — до ${n(G.ROAD_W)} мм по ширине и ${n(StationLayout.MAX_L)} мм по длине, высота — до ${n(B.maxH)} мм): выберите другую раскладку или больше модулей («Модули…»).` }] };
    const Wi=G.inner(geo.type, [10000, F.wide ? B.maxW : G.ROAD_W, B.maxH], t)[1];
    const wideOk=this.need(probe, Wi-g2, 'row1', 1)!=null;
    const text=!F.wide && !wideOk ? `Оборудование с проходом для оператора и обслуживания не проходит по ширине перевозки ${n(G.ROAD_W)} мм, а негабарит отключён в правилах компоновки («Настройки → Инженерные правила станций») — соберите станцию из нескольких модулей (кнопка «Модули…» в «Компоновке») или уменьшите состав.`
      : tall && !wideOk ? `Оборудование не помещается в блок-контейнер высотой до ${n(B.maxH)} мм — нужен контейнер нестандартной высоты (укажите размер вручную).`
      : !wideOk ? `Оборудование с проходом для оператора и обслуживания не проходит по ширине даже в блок-контейнере шириной ${n(B.maxW)} мм.`
      : `Оборудование не помещается в один блок-контейнер длиной до ${n(StationLayout.MAX_L)} мм — соберите станцию из нескольких модулей (кнопка «Модули…» в «Компоновке») или уменьшите состав.`;
    return { level:'error', geo, ext:null, int:null, issues:[{ level:'error', text }] };
  }

  /** контейнер, в который всё поместится с проходом: морской — следующий по размеру, иначе блок-контейнер с подобранным
   *  размером */
  suggest(units, geo){
    if (geo.sea && !geo.own){
      let warnFit=null; const cur=StationGeo.SEA[geo.type];
      for (const M of [[{}], this.modes()]){   // сначала как обычно, затем — с исключениями (без продольного прохода, проход «в крайнем случае», без сквозного прохода)
        for (const t of StationGeo.SEA_ORDER){ const s=StationGeo.SEA[t]; if (t===geo.type || (s.ext[0]<=cur.ext[0] && s.ext[2]<=cur.ext[2])) continue;   // не больше — не поможет
          const r=this.fit(units, this.geoOf({ ctype:t, ins:geo.t+' мм' }), M);
          if (r.level==='ok') return { ctype:t, level:'ok' }; if (r.level==='warn' && !warnFit) warnFit={ ctype:t, level:'warn' }; }
        if (warnFit) return warnFit; }
    }
    const type=StationGeo.FLEX[geo.type] ? geo.type : 'block', r=this.autoSize(units, this.geoOf({ ctype:type, ins:geo.t+' мм', sizeAuto:true }));
    return r.level==='error' ? null : { ctype:type, size:r.geo.ext, level:r.level };
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

  /** окраска контейнера (StationPaint): стены, каркас, крыша, двери и ворота, пол (null — по материалу); не указана —
   *  RAL 7035 / RAL 5005 условно; рисунки заказчика — на стенах снаружи */
  colors(){
    const c=this.cont||{}, k=StationPaint.colors(c);
    return { wallColor:k.wall, frameColor:k.frame, roofColor:k.roof, doorColor:k.door, floorColor:k.floor, colorKnown:k.known, colorText:StationPaint.short(c),
      arts:StationPaint.arts(c), sys:c.sys||null };
  }

  /** сведения: условные габариты, что не попало на чертёж */
  notes(plan){
    const iss=plan.issues, nm=e=>`поз. ${e.pos} «${e.short}»`, n=StationLayout.n;
    const tk=this.eq.filter(e=>e.place && !e.known && e.kind==='tank');
    if (tk.length) iss.push({ level:'info', text:`Габариты бака — по расчётному объёму (прямоугольный, стенка ${n(StationMatrix.tank().wall)} мм; требует подтверждения изготовителем бака): ${tk.map(e=>`${nm(e)} ${e.vol ? n(e.vol)+' л — ' : ''}${n(e.l)} × ${n(e.w)} × ${n(e.h)} мм`).join('; ')}. Свои размеры — строкой «Габариты» в составе станции.` });
    const g=this.eq.filter(e=>e.place && !e.known && e.kind!=='tank'); if (g.length) iss.push({ level:'info', text:`Габариты не указаны в характеристиках — взяты условные: ${g.map(e=>`${nm(e)} ${n(e.l)} × ${n(e.w)} × ${n(e.h)} мм`).join('; ')}. Укажите размеры в составе станции (характеристики элемента).` });
    const nd=this.eq.filter(e=>e.nodims); if (nd.length) iss.push({ level:'info', text:`Не размещены — нет габаритов: ${nd.map(e=>'«'+e.name+'»').join(', ')}.` });
    // ресиверы снаружи: площадка, подключение; при морозе — конденсат, если воздух не осушен адсорбционным осушителем
    const out=plan.outside||[];
    if (out.length){ const P=[...new Set(out.map(i=>i.pos))].join(', '), D=this.eq.filter(e=>e.kind==='dryer' && e.air && e.air.type!=='gen');
      iss.push({ level:'info', text:`${out.length>1 ? 'Ресиверы' : 'Ресивер'} поз. ${P} — снаружи, на бетонной площадке в ${n(StationLayout.OUT_GAP)} мм от дальнего торца (ФНП ОРПД, п. 65): трубопровод — через стену с запорной арматурой, на ресивере — предохранительный клапан и манометр, площадка — с ограждением от наезда.` });
      if (!D.length) iss.push({ level:'warn', text:`Ресивер снаружи без осушителя: зимой конденсат в ресивере и отводе замерзает — нужен обогреваемый отвод конденсата (греющий кабель, теплоизоляция) или осушитель перед ресивером.` });
      else if (!D.some(e=>e.air.type==='ads')) iss.push({ level:'info', text:`Ресивер снаружи после рефрижераторного осушителя (точка росы +3 °C): при морозе в нём выпадает и замерзает конденсат — нужен обогреваемый отвод конденсата или адсорбционный осушитель (точка росы −40 °C).` });
      if (plan.chassis) iss.push({ level:'info', text:`Станция на шасси: ресивер снаружи перевозится отдельно и ставится на площадку на объекте.` }); }
    if (plan.fuel){ const P=[...new Set((plan.items||[]).filter(i=>i.tank).map(i=>i.pos))].join(', ');
      const F=plan.fuel, G=F.gate, fw={ left:'в торце', front:'в стене с дверью оператора', back:'в задней стене' }[F.fill.wall];
      iss.push({ level:'info', text:`Топливный бак поз. ${P} — в отдельном отсеке у торца: противопожарная перегородка 1-го типа (EI 45) без проёмов, топливопровод — через гильзу с уплотнением; вход в отсек — ${G ? `двустворчатые ворота в торце ${n(G.w)} × ${n(G.h)} мм (монтаж и замена бака)` : plan.geo && plan.geo.sea ? 'штатные двери контейнера' : 'своя дверь снаружи'}; заливная горловина — ${fw}, утоплена в стену: ниша с лючком заподлицо под замок (ничего не выступает, габарит не меняется); дыхательный клапан с огнепреградителем — над крышей; бак — в поддоне на полный объём; в отсеке — естественная вентиляция.` }); }
    StationHeat.notes(plan);
    // учёт в Ростехнадзоре — по произведению давления на вместимость
    const V=(plan.vessels||[]).filter(v=>v.pv!=null), reg=V.filter(v=>v.reg), free=V.filter(v=>!v.reg);
    if (reg.length) iss.push({ level:'info', text:`Подлежат учёту в Ростехнадзоре (ФНП ОРПД, п. 223: p·V больше 1,0 МПа·м³): ${reg.map(v=>`поз. ${v.pos} — ${PressureVessel.text(v)}`).join('; ')}. Регистрация, техническое освидетельствование и ответственные за исправное состояние — у эксплуатирующей организации${reg.some(v=>!v.out) ? '; размещают на открытой площадке или в отдельном здании, в помещении — когда иначе нельзя (п. 65): «Ресивер снаружи» — в требованиях заказчика на вкладке «Состав станции»' : ''}.` });
    if (free.length) iss.push({ level:'info', text:`Учёту в Ростехнадзоре не подлежат (p·V не больше 1,0 МПа·м³): ${free.map(v=>`поз. ${v.pos} — ${PressureVessel.text(v)}`).join('; ')}.` });
    const rf=plan.roof||[]; if (rf.length && plan.geo && plan.geo.ext){
      const top=Math.max(...rf.map(m=>m.gap+m.d)), h=plan.geo.ext[2]+Math.max(top, plan.geo.rise||0), ch=plan.chassis ? StationLayout.CHASSIS_H : 0;
      iss.push({ level:'info', text:`Глушитель на крыше над ДГУ, выхлоп — горизонтально в сторону (не вверх): высота станции с глушителем ${n(h)} мм${ch ? ` (на шасси — ${n(h+ch)} мм)` : ''}. Глушитель съёмный: при перевозке его снимают и ставят на объекте — высота с платформой не более ${n(StationLayout.ROAD_H)} мм.` });
      const mq=this.eq.filter(e=>e.kind==='muffler' && e.roof).reduce((s, e)=>s+e.qty, 0);
      if (rf.length>mq) iss.push({ level:'warn', text:`Глушитель на крыше — у каждой ДГУ (если хоть у одной он на крыше): в составе ${mq} шт., нужно ${rf.length} — увеличьте количество «${rf[0].name}» до ${rf.length}.` });
      if (rf.some(m=>!m.known)) iss.push({ level:'info', text:`Размер глушителя не указан — взят условный по мощности ДГУ: ${[...new Set(rf.filter(m=>!m.known).map(m=>`поз. ${m.pos} — ${n(Math.max(m.lx, m.ly))} × Ø${n(m.d)} мм`))].join('; ')}.` }); }
    // выхлоп каждой ДГУ: без своего глушителя на крыше — через стену (глушитель встроен в ДГУ)
    const exW=(plan.exhausts||[]).filter(e=>e.how==='wall'), dgN=(plan.exhausts||[]).length;
    if (exW.length) iss.push({ level:'info', text:`Выхлоп ${exW.length===dgN ? (dgN>1 ? 'всех ДГУ' : 'ДГУ') : exW.length>1 ? `${exW.length} ДГУ` : 'одной ДГУ'} — через заднюю стену (у каждой — свой вывод, над ДГУ на высоте ${[...new Set(exW.map(e=>n(e.z)))].join(' / ')} мм): глушителя на крыше для ${exW.length>1 ? 'них' : 'неё'} в составе нет — глушитель встроен в ДГУ (у небольших ДГУ — штатно). Проходка — через гильзу с негорючей теплоизоляцией, снаружи — отвод вниз под 45° с дождевым колпаком; не напротив приточных жалюзи и дверей. Если встроенного глушителя нет — добавьте в состав «Глушитель на крыше» (по одному на ДГУ).` });
    const hang=(plan.items||[]).filter(i=>i.mount==='pipe' && !i.unit);
    for (const pp of plan.piping||[]){
      if (pp.implicit){ iss.push({ level:'info', text:`Фильтры (${hang.map(i=>'поз. '+i.pos).join(', ')}) висят на трубопроводе, а трубопроводной обвязки в составе нет — добавьте элемент «Трубопроводная обвязка и запорная арматура».` }); continue; }
      if (!pp.mat) iss.push({ level:'info', text:`Материал трубопровода (поз. ${pp.pos}) не выбран — на чертеже сталь. Выберите в «Составе станции»: сталь, нержавеющая сталь или полипропилен.` });
      else if (pp.mat==='pp' && this.eq.some(e=>e.kind==='dgu')) iss.push({ level:'warn', text:`Топливопровод (поз. ${pp.pos}) из полипропилена не применяют — выберите сталь или нержавеющую сталь.` });
      else if (pp.mat==='pp' && this.eq.some(e=>e.kind==='compressor')) iss.push({ level:'info', text:`Полипропилен для сжатого воздуха (поз. ${pp.pos}) — только в пределах давления труб при рабочей температуре (PP-R PN20 — 20 бар при 20 °C, при нагреве меньше); участок сразу после компрессора — металлом.` });
    }
  }

  /** 12345 → «12 345» */
  static n(v){ const s=String(Math.round(v)); return s.length<4 ? s : s.replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
}
