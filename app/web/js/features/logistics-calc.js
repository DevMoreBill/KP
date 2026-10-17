// Логистика по России: расчёт стоимости доставки со склада поставщика до объекта заказчика (без внешних сервисов).
// Груз — масса и габариты позиций из характеристик каталога; транспорт — классы машин из тарифов (правит администратор);
// расстояние — по дорогам (OSRM, карты OpenStreetMap: между точными адресами или центрами городов), пока маршрут не
// посчитан — по прямой × коэффициент дорог; негабарит и тяжеловес — по правилам РФ (ПП РФ от 21.12.2020 № 2200:
// ширина 2,55 м, высота 4 м, длина автопоезда 20 м; ПП РФ от 21.12.2020 № 2060: автомобиль прикрытия — шире 3,5 м,
// патрульный автомобиль ГИБДД — шире 4 м). Тариф машины — в два участка: подача + ставка до 1 000 км + ставка дальше
// (дальний рейс дешевле за км), не меньше минимального заказа; ставки сверяются с фактическими счетами (Freight.calibrate).
// Чистые функции и класс Freight: их проверяет node-тест, интерфейс — в logistics.js (вкладка «Логистика» сделки и «Настройки»).
'use strict';

// ---------------------------------------------------------------- груз: масса и габариты из характеристик
const lgNum = s => { const v=parseFloat(String(s).replace(/\s+/g,'').replace(',','.')); return Number.isFinite(v)?v:null; };

// «3197 × 1840 × 2450/2200 мм», «2 250 × 1 000 × 1 540», «120 x 65 x 135» (см) → [3.197, 1.84, 2.45] м
function lgTriple(v, unitHint){
  const s=String(v||'').replace(/(\d)\s+(?=\d{3}\b)/g,'$1').replace(/[хxХX*]/g,'×');
  const m=s.match(/(\d+(?:[.,]\d+)?)(?:\/\d+(?:[.,]\d+)?)?\s*×\s*(\d+(?:[.,]\d+)?)(?:\/\d+(?:[.,]\d+)?)?\s*×\s*(\d+(?:[.,]\d+)?)(?:\/(\d+(?:[.,]\d+)?))?/);
  if (!m) return null;
  let a=[lgNum(m[1]), lgNum(m[2]), Math.max(lgNum(m[3]), m[4]?lgNum(m[4]):0)];
  const u=(s+' '+(unitHint||'')).toLowerCase();
  const unit = /мм/.test(u) ? 'мм' : /см/.test(u) ? 'см' : /(^|[^а-я])м([^а-я]|$)/.test(u) ? 'м' : Math.max(...a)>40 ? 'мм' : 'м';
  a=a.map(x=>x*(unit==='м' ? 1 : unit==='см' ? 0.01 : 0.001));
  return a.every(x=>x>0 && x<40) ? a : null;
}
function lgLen(v, unitHint){
  const s=String(v||''), x=lgNum((s.match(/\d[\d\s]*(?:[.,]\d+)?/)||[''])[0]); if (x==null) return null;
  const u=(s+' '+(unitHint||'')).toLowerCase();
  const m = /мм/.test(u) ? x/1000 : /см/.test(u) ? x/100 : /(^|[^а-я])м([^а-я]|$)/.test(u) ? x : x>50 ? x/1000 : x;
  return m>0 && m<40 ? m : null;
}
const LG_DIM_SKIP=/радиатор|рабоч|помещени|мачт|рамы|присоедин|всасыв|над уровн|упаковк[аи]? (?:не|без)|кабин|экран|дисплей|фланц|патрубк|колес|колёс/i;

function lgCargoOf(groups){
  const rows=[]; for (const g of groups||[]) for (const r of (g&&g.rows)||[]) if (r && (r.k||r.v)) rows.push({k:String(r.k||''), v:String(r.v||''), ref:r});
  let dims=null, dimSrc='', mass=null, massSrc='', prio=-1, mprio=-1, dimRef=null, massRef=null;
  for (const r of rows){
    const k=r.k.toLowerCase();
    if (/габарит|размер|д\s*[×xх*]\s*ш|длина\s*[×xх*]/i.test(k) && !LG_DIM_SKIP.test(k)){
      const t=lgTriple(r.v, k); if (!t) continue;
      const order=/ш\s*[×xх*]\s*д/i.test(k) || /ширина\s*[×xх*]\s*длина/i.test(r.v) ? 'wlh' : 'lwh';
      const p=/транспорт/i.test(k)?3:/упаков/i.test(k)?2:1;
      if (p>prio){ prio=p; const [a,b,c]=t; dims= order==='wlh' ? {l:b,w:a,h:c} : {l:a,w:b,h:c}; dimSrc=r.k+': '+r.v; dimRef={row:r.ref, order}; }
    }
  }
  if (!dims){   // отдельные строки «Длина», «Ширина», «Высота»
    const one=re=>{ const r=rows.find(x=>re.test(x.k) && !LG_DIM_SKIP.test(x.k) && !/открыт/i.test(x.k)) || rows.find(x=>re.test(x.k) && !LG_DIM_SKIP.test(x.k)); return r?lgLen(r.v, r.k):null; };
    const l=one(/^длина/i), w=one(/^ширина/i), h=one(/^высота(?!\s*(рамы|мачты|всас|над))/i);
    if (l && w && h){ dims={l,w,h}; dimSrc='Длина, ширина, высота'; dimRef={sep:true}; }
  }
  for (const r of rows){
    const k=r.k.toLowerCase();
    if (!/масса|вес/.test(k) || /фреон|двигател|сух|масла|топлив|заправ|рабочий вес|вес\s*\(открыт/.test(k)) continue;
    const m=String(r.v).match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(т|тонн|кг)?/i); if (!m) continue;
    let x=lgNum(m[1]); if (x==null) continue;
    const unit=(m[2]||'').toLowerCase() || (/,\s*т\b|\(т\)/.test(k)?'т':'кг');
    if (unit.startsWith('т')) x*=1000;
    const p=/брутто|транспорт|в упаковке/.test(k)?3:/^масса|^вес$/.test(k)?2:1;
    if (x>0 && x<200000 && p>mprio){ mprio=p; mass=x/1000; massSrc=r.k+': '+r.v; massRef=r.ref; }
  }
  // длина — наибольший размер в плане (груз ставят вдоль площадки)
  if (dims && dims.w>dims.l){ const t=dims.l; dims.l=dims.w; dims.w=t; }
  return { dims, dimSrc, mass, massSrc, dimRef, massRef };
}

// записать массу и габариты в характеристики (позиция КП или карточка каталога): строку, из которой их прочитали,
// иначе — в группу «Габариты и масса» (создаётся при необходимости). v — {l,w,h} в м, m в т; what — что записать.
function lgWriteCargo(obj, v, what){
  obj.groups=Array.isArray(obj.groups)?obj.groups:[];
  const cg=lgCargoOf(obj.groups), mm=x=>String(Math.round(x*1000));
  const grp=()=>{ let g=obj.groups.find(g=>/габарит|масс/i.test(g.name||''));
    if (!g){ g={name:'Габариты и масса', rows:[]}; obj.groups.push(g); } g.rows=g.rows||[]; return g; };
  let n=0;
  if (what.dims && v.l>0 && v.w>0 && v.h>0){
    const ref=cg.dimRef, txt=(ref&&ref.order==='wlh') ? `${mm(v.w)} × ${mm(v.l)} × ${mm(v.h)} мм` : `${mm(v.l)} × ${mm(v.w)} × ${mm(v.h)} мм`;
    if (ref && ref.row) ref.row.v=txt;
    else if (ref && ref.sep){ for (const g of obj.groups) for (const r of g.rows||[]){
        if (/^длина/i.test(r.k||'')) r.v=mm(v.l)+' мм'; else if (/^ширина/i.test(r.k||'')) r.v=mm(v.w)+' мм'; else if (/^высота(?!\s*(рамы|мачты|всас|над))/i.test(r.k||'')) r.v=mm(v.h)+' мм'; } }
    else grp().rows.push({k:'Габариты Д × Ш × В', v:txt});
    n++;
  }
  if (what.mass && v.m>0){
    const txt=Math.round(v.m*1000)+' кг';
    if (cg.massRef) cg.massRef.v=txt; else grp().rows.push({k:'Масса', v:txt});
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- города и расстояние
// [название, широта, долгота, без дороги круглый год (true — морем / авиа / зимник)]
const LG_CITIES = [
  ['Москва',55.756,37.617],['Санкт-Петербург',59.939,30.316],['Новосибирск',55.030,82.920],['Екатеринбург',56.838,60.597],['Казань',55.796,49.106],
  ['Нижний Новгород',56.327,44.006],['Челябинск',55.160,61.402],['Красноярск',56.010,92.852],['Самара',53.195,50.101],['Уфа',54.735,55.958],
  ['Ростов-на-Дону',47.222,39.720],['Омск',54.989,73.368],['Краснодар',45.035,38.975],['Воронеж',51.661,39.200],['Пермь',58.010,56.229],
  ['Волгоград',48.708,44.513],['Саратов',51.533,46.034],['Тюмень',57.153,65.534],['Тольятти',53.508,49.420],['Ижевск',56.852,53.205],
  ['Барнаул',53.348,83.780],['Ульяновск',54.314,48.403],['Иркутск',52.287,104.305],['Хабаровск',48.480,135.072],['Ярославль',57.626,39.894],
  ['Владивосток',43.115,131.886],['Махачкала',42.983,47.505],['Томск',56.484,84.948],['Оренбург',51.768,55.097],['Кемерово',55.355,86.087],
  ['Новокузнецк',53.757,87.136],['Рязань',54.629,39.736],['Набережные Челны',55.743,52.396],['Астрахань',46.348,48.033],['Пенза',53.195,45.018],
  ['Киров',58.603,49.668],['Липецк',52.608,39.599],['Чебоксары',56.146,47.251],['Балашиха',55.796,37.938],['Калининград',54.710,20.452],
  ['Тула',54.193,37.617],['Курск',51.730,36.193],['Ставрополь',45.044,41.969],['Сочи',43.585,39.723],['Улан-Удэ',51.834,107.584],
  ['Тверь',56.859,35.912],['Магнитогорск',53.407,58.980],['Иваново',57.000,40.974],['Брянск',53.243,34.364],['Белгород',50.596,36.588],
  ['Сургут',61.254,73.396],['Владимир',56.129,40.407],['Нижний Тагил',57.908,59.973],['Архангельск',64.540,40.516],['Чита',52.034,113.500],
  ['Калуга',54.514,36.262],['Смоленск',54.782,32.045],['Волжский',48.786,44.751],['Курган',55.441,65.341],['Череповец',59.122,37.903],
  ['Орёл',52.970,36.064],['Вологда',59.220,39.891],['Саранск',54.187,45.184],['Владикавказ',43.020,44.682],['Якутск',62.028,129.732,true],
  ['Мурманск',68.970,33.075],['Подольск',55.431,37.545],['Тамбов',52.721,41.452],['Стерлитамак',53.630,55.930],['Грозный',43.318,45.698],
  ['Кострома',57.768,40.927],['Петрозаводск',61.785,34.346],['Нижневартовск',60.939,76.570],['Йошкар-Ола',56.634,47.900],['Новороссийск',44.723,37.769],
  ['Таганрог',47.236,38.897],['Сыктывкар',61.668,50.836],['Нальчик',43.485,43.607],['Шахты',47.709,40.216],['Дзержинск',56.238,43.461],
  ['Орск',51.229,58.475],['Братск',56.152,101.634],['Благовещенск',50.290,127.527],['Энгельс',51.498,46.126],['Ангарск',52.544,103.888],
  ['Великий Новгород',58.522,31.270],['Псков',57.819,28.332],['Старый Оскол',51.297,37.835],['Королёв',55.922,37.854],['Химки',55.889,37.430],
  ['Мытищи',55.911,37.730],['Люберцы',55.676,37.893],['Петропавловск-Камчатский',53.024,158.644,true],['Южно-Сахалинск',46.959,142.738,true],
  ['Магадан',59.568,150.808,true],['Норильск',69.349,88.201,true],['Майкоп',44.609,40.106],['Черкесск',44.227,42.046],['Элиста',46.308,44.256],
  ['Абакан',53.721,91.442],['Кызыл',51.720,94.438],['Горно-Алтайск',51.958,85.960],['Биробиджан',48.795,132.924],['Анадырь',64.733,177.509,true],
  ['Салехард',66.530,66.603,true],['Ханты-Мансийск',61.003,69.019],['Нарьян-Мар',67.638,53.007,true],['Магас',43.171,44.811],['Назрань',43.226,44.765],
  ['Севастополь',44.616,33.525],['Симферополь',44.952,34.102],['Новый Уренгой',66.084,76.680],['Ноябрьск',63.199,75.451],['Нефтеюганск',61.090,72.616],
  ['Когалым',62.264,74.483],['Тобольск',58.198,68.254],['Ухта',63.567,53.684],['Воркута',67.497,64.061,true],['Северодвинск',64.562,39.818],
  ['Новочеркасск',47.411,40.104],['Армавир',44.999,41.129],['Пятигорск',44.040,43.071],['Кисловодск',43.906,42.716],['Волгодонск',47.516,42.198],
  ['Каменск-Уральский',56.415,61.918],['Первоуральск',56.905,59.943],['Златоуст',55.172,59.672],['Миасс',55.045,60.108],['Березники',59.408,56.804],
  ['Димитровград',54.217,49.626],['Сызрань',53.155,48.475],['Новомосковск',54.011,38.290],['Обнинск',55.112,36.597],['Серпухов',54.913,37.416],
  ['Коломна',55.079,38.778],['Электросталь',55.785,38.445],['Одинцово',55.678,37.278],['Домодедово',55.437,37.766],['Ногинск',55.854,38.441],
  ['Щёлково',55.926,37.972],['Красногорск',55.831,37.330],['Сергиев Посад',56.315,38.136],['Дмитров',56.344,37.520],['Чехов',55.143,37.455],
  ['Наро-Фоминск',55.386,36.734],['Клин',56.331,36.729],['Воскресенск',55.322,38.673],['Егорьевск',55.383,39.035],['Рыбинск',58.048,38.858],
  ['Муром',55.575,42.051],['Ковров',56.363,41.311],['Великие Луки',56.340,30.546],['Выборг',60.710,28.749],['Гатчина',59.565,30.128],
  ['Кириши',59.448,32.008],['Тихвин',59.645,33.529],['Кингисепп',59.374,28.611],['Усть-Илимск',58.000,102.661],['Нерюнгри',56.659,124.725],
  ['Находка',42.824,132.892],['Уссурийск',43.797,131.952],['Комсомольск-на-Амуре',50.550,137.008],['Бийск',52.539,85.214],['Рубцовск',51.514,81.207],
  ['Прокопьевск',53.884,86.750],['Междуреченск',53.687,88.070],['Ачинск',56.269,90.496],['Северск',56.603,84.881],['Альметьевск',54.901,52.297],
  ['Нижнекамск',55.636,51.820],['Октябрьский',54.481,53.471],['Салават',53.362,55.924],['Нефтекамск',56.088,54.248],['Новокуйбышевск',53.099,49.948],
  ['Балаково',52.018,47.820],['Камышин',50.084,45.408],['Невинномысск',44.633,41.944],['Ессентуки',44.044,42.860],['Анапа',44.894,37.316],
  ['Геленджик',44.561,38.077],['Туапсе',44.098,39.074],['Ейск',46.711,38.276],['Батайск',47.139,39.751],['Елец',52.624,38.503],
  ['Губкин',51.284,37.555],['Курчатов',51.660,35.657],['Соликамск',59.638,56.786],['Чайковский',56.768,54.115],['Глазов',58.140,52.658],
  ['Сарапул',56.476,53.799],['Воткинск',57.051,53.987],['Новочебоксарск',56.110,47.479],['Арзамас',55.394,43.840],['Кстово',56.150,44.207],
  ['Саров',54.935,43.324],['Ишим',56.112,69.490],['Усть-Луга',59.680,28.390],['Тосно',59.540,30.877],['Всеволожск',60.020,30.637],
];
const LG_ALIAS = { 'спб':'Санкт-Петербург', 'питер':'Санкт-Петербург', 'петербург':'Санкт-Петербург', 'ростов на дону':'Ростов-на-Дону', 'н новгород':'Нижний Новгород',
  'н.новгород':'Нижний Новгород', 'новгород великий':'Великий Новгород', 'наб челны':'Набережные Челны', 'петропавловск камчатский':'Петропавловск-Камчатский',
  'комсомольск на амуре':'Комсомольск-на-Амуре', 'южно сахалинск':'Южно-Сахалинск', 'орел':'Орёл', 'королев':'Королёв', 'щелково':'Щёлково' };
// регион → центр (если в адресе нет города из таблицы)
const LG_REGIONS = [
  ['московск','Москва'],['ленинградск','Санкт-Петербург'],['новосибирск','Новосибирск'],['свердловск','Екатеринбург'],['татарстан','Казань'],
  ['нижегородск','Нижний Новгород'],['челябинск','Челябинск'],['красноярск','Красноярск'],['самарск','Самара'],['башкортостан','Уфа'],['башкирия','Уфа'],
  ['ростовск','Ростов-на-Дону'],['омская','Омск'],['омской','Омск'],['краснодарск','Краснодар'],['кубань','Краснодар'],['воронежск','Воронеж'],['пермск','Пермь'],
  ['волгоградск','Волгоград'],['саратовск','Саратов'],['тюменск','Тюмень'],['удмурт','Ижевск'],['алтайский','Барнаул'],['республика алтай','Горно-Алтайск'],
  ['ульяновск','Ульяновск'],['иркутск','Иркутск'],['хабаровск','Хабаровск'],['ярославск','Ярославль'],['приморск','Владивосток'],['дагестан','Махачкала'],
  ['томская','Томск'],['томской','Томск'],['оренбургск','Оренбург'],['кемеровск','Кемерово'],['кузбасс','Кемерово'],['рязанск','Рязань'],['астраханск','Астрахань'],
  ['пензенск','Пенза'],['кировская','Киров'],['кировской','Киров'],['липецк','Липецк'],['чуваш','Чебоксары'],['калининградск','Калининград'],['тульская','Тула'],
  ['тульской','Тула'],['курская','Курск'],['курской','Курск'],['ставропольск','Ставрополь'],['бурят','Улан-Удэ'],['тверск','Тверь'],['ивановск','Иваново'],
  ['брянск','Брянск'],['белгородск','Белгород'],['ханты','Сургут'],['югра','Сургут'],['хмао','Сургут'],['владимирск','Владимир'],['архангельск','Архангельск'],
  ['забайкальск','Чита'],['калужск','Калуга'],['смоленск','Смоленск'],['курганск','Курган'],['орловск','Орёл'],['вологодск','Вологда'],['мордов','Саранск'],
  ['осетия','Владикавказ'],['алания','Владикавказ'],['якутия','Якутск'],['саха','Якутск'],['мурманск','Мурманск'],['тамбовск','Тамбов'],['чечен','Грозный'],
  ['костромск','Кострома'],['карелия','Петрозаводск'],['марий','Йошкар-Ола'],['республика коми','Сыктывкар'],['кабардин','Нальчик'],['амурск','Благовещенск'],
  ['новгородская','Великий Новгород'],['новгородской','Великий Новгород'],['псковск','Псков'],['камчат','Петропавловск-Камчатский'],['сахалин','Южно-Сахалинск'],
  ['магаданск','Магадан'],['адыге','Майкоп'],['карачаев','Черкесск'],['калмык','Элиста'],['хакас','Абакан'],['тыва','Кызыл'],['тува','Кызыл'],
  ['еврейск','Биробиджан'],['чукот','Анадырь'],['ямало','Новый Уренгой'],['янао','Новый Уренгой'],['ненецк','Нарьян-Мар'],['ингушет','Магас'],
  ['крым','Симферополь'],['севастопол','Севастополь'],
];
const lgN = s => String(s||'').toLowerCase().replace(/ё/g,'е').replace(/[«»"()]/g,' ').replace(/[-‐–—]/g,' ').replace(/\s+/g,' ').trim();
const LG_IDX = LG_CITIES.map(([name,lat,lon,noRoad])=>({name, lat, lon, noRoad:!!noRoad, n:lgN(name)})).sort((a,b)=>b.n.length-a.n.length);

function lgCityByName(name){ const n=lgN(name); const a=LG_ALIAS[n]; return LG_IDX.find(c=>c.n===(a?lgN(a):n)) || null; }

// город по адресу: «г Москва, ул …», «Свердловская обл, г Екатеринбург», «Казань»; нет города — центр региона
function lgCity(addr){
  const s=' '+lgN(addr).replace(/[.,;]/g,' ').replace(/\s+/g,' ')+' ';
  if (s.trim()==='') return null;
  const has = n => s.includes(' '+n+' ');
  for (const [a,name] of Object.entries(LG_ALIAS)) if (has(lgN(a))) return {...lgCityByName(name), how:'город'};
  // город с пометкой «г» — надёжнее (в адресе бывает и улица с названием города)
  const marked=LG_IDX.find(c=>s.includes(' г '+c.n+' ') || s.includes(' город '+c.n+' ') || s.includes(' '+c.n+' г '));
  if (marked) return {...marked, how:'город'};
  const any=LG_IDX.find(c=>has(c.n));
  if (any) return {...any, how:'город'};
  for (const [stem,name] of LG_REGIONS) if (s.includes(' '+stem)) { const c=lgCityByName(name); if (c) return {...c, how:'регион'}; }
  return null;
}

function lgHav(a,b){
  const R=6371, r=x=>x*Math.PI/180, dLat=r(b.lat-a.lat), dLon=r(b.lon-a.lon);
  const h=Math.sin(dLat/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}
function lgRoadKm(a, b, T){
  if (!a || !b) return null;
  if (a.exact && b.exact){ const d=lgHav(a,b); if (d<40) return Math.max(3, Math.round(d*1.4)); }   // точные адреса рядом — по городу
  else if (a.name===b.name) return T.localKm;
  const east=Math.max(a.lon, b.lon), k = east>105 ? T.roadKFE : east>59 ? T.roadKE : T.roadK;
  return Math.round(lgHav(a,b)*k/10)*10;
}

// ---------------------------------------------------------------- форматирование и точки маршрута
const lgM = v => (Math.round(v*100)/100).toString().replace('.',',');
const lgT = v => (Math.round(v*10)/10).toString().replace('.',',');
const lgRub = v => Number.isFinite(v) ? Math.round(v).toLocaleString('ru-RU')+' ₽' : '—';     // не посчитано (нет адресов, груза) — прочерк

function lgUnloadPick(maxUnit, T, want){
  if (want==='none') return null;
  if (want && want!=='auto') return T.unload.find(x=>x.id===want) || null;
  return T.unload.find(x=>maxUnit<=x.max) || T.unload[T.unload.length-1];
}

// точка маршрута: точный адрес с координатами (подсказка DaData / OpenStreetMap, координаты с карты) или город из адреса
function lgPoint(p){
  if (!p) return null;
  const g=p.geo;
  if (g && Number.isFinite(+g.lat) && Number.isFinite(+g.lon) && g.lat!==null && g.lon!==null){
    const base=(g.city&&(lgCityByName(g.city)||lgCity(g.city))) || lgCity(g.value||p.addr) || LG_IDX.reduce((m,c)=>{ const d=lgHav(c,{lat:+g.lat,lon:+g.lon}); return d<m.d?{c,d}:m; },{c:null,d:1e9}).c;
    return {name:g.city||(base&&base.name)||'точка на карте', lat:+g.lat, lon:+g.lon, how:g.cityOnly?'город':'адрес', exact:!g.cityOnly, noRoad:!!(base&&base.noRoad), near:base&&base.name};
  }
  return p.city ? lgCityByName(p.city) : lgCity(p.addr);
}

// ---------------------------------------------------------------- модель перевозки: тарифы, раскладка по машинам, расчёт, сверка
class Freight {
  // Тарифы по умолчанию — рынок РФ, осень 2026, с НДС 22 %, ставка перевозчика (агент — отдельной строкой в расчёте).
  // Рейс = подача (base) + ставка за км до far км (km) + ставка за км дальше (kmFar), не меньше минимального заказа (min):
  // подача покрывает подачу машины, простой на погрузке и выгрузке и платные въезды, дальний рейс дешевле за км.
  // Калибровка (сентябрь — октябрь 2026, тент 20 т): Москва → Санкт-Петербург ≈ 60–70 тыс. ₽, Москва → Новосибирск
  // ≈ 167–188 тыс. ₽, средняя по рынку ≈ 70 ₽/км у перевозчиков (ATI.SU, май 2026); остальные классы — по средним
  // заказам Москва → Санкт-Петербург (Газель ≈ 35 тыс. ₽, 5 т ≈ 52 тыс. ₽, 10 т ≈ 67 тыс. ₽). Ставки уточняются по
  // фактическим счетам («Сверка со счетами» в «Настройках») и автообновлением по ATI.SU.
  // L × W — грузовая площадка, м; h — высота груза без спецразрешения (4 м минус высота пола), hMax — со спецразрешением;
  // wMax — ширина груза со спецразрешением; t — грузоподъёмность, т; tLegal — без спецразрешения на тяжеловес
  // (автопоезд до 40–44 т); open — открытая площадка (груз до 2,55 м шириной — без спецразрешения); iso — только морские контейнеры.
  static DEFAULTS = {
    ver: 3,
    classes: [
      { id:'gazel',  name:'«Газель» тент 1,5 т (4,2 м, 17 м³)',      L:4.2,  W:2.0,  h:2.0, hMax:2.0, wMax:2.0,  t:1.5, open:false, km:43,  kmFar:30, base:5000,  min:6000 },
      { id:'t5',     name:'Грузовик 5 т (6,2 м, 36 м³)',            L:6.2,  W:2.45, h:2.4, hMax:2.4, wMax:2.45, t:5,   open:false, km:64,  kmFar:42, base:7000,  min:10000 },
      { id:'t10',    name:'Грузовик 10 т (7,5 м, 48 м³)',           L:7.5,  W:2.45, h:2.6, hMax:2.6, wMax:2.45, t:10,  open:false, km:80,  kmFar:48, base:10000, min:15000 },
      { id:'tent20', name:'Фура тент 20 т (13,6 м, 86 м³)',         L:13.6, W:2.45, h:2.6, hMax:2.6, wMax:2.45, t:20,  open:false, km:72,  kmFar:40, base:15000, min:20000 },
      { id:'cont',   name:'Контейнеровоз (контейнер 20 / 40 фут)',  L:12.2, W:2.5,  h:2.9, hMax:2.9, wMax:2.5,  t:28,  tLegal:28, open:true, iso:true, km:78, kmFar:44, base:16000, min:22000 },
      { id:'flat',   name:'Открытая площадка 20 т (13,6 м)',        L:13.6, W:2.5,  h:2.6, hMax:3.1, wMax:3.2,  t:20,  open:true,  km:82,  kmFar:47, base:18000, min:25000 },
      { id:'lowbed', name:'Трал низкорамный 40 т',                  L:13.0, W:2.55, h:3.1, hMax:3.6, wMax:3.5,  t:40,  tLegal:22, open:true, km:110, kmFar:90, base:20000, min:45000 },
    ],
    far: 1000,          // граница участков тарифа, км: дальше — ставка kmFar
    overK: 1.1,         // негабарит на площадке: надбавка к ставке (ставка трала уже рассчитана на негабарит)
    overKLowbed: 1,
    permit: 1600,       // госпошлина за спецразрешение (НК РФ, ст. 333.33, п. 1, пп. 111), ₽ за машину
    permitAgent: 0,     // оформление и проект маршрута через агента, ₽ (если пользуетесь)
    heavyFrom: 20,      // тяжеловес для своих классов без «грузоподъёмности без спецразрешения»: груз тяжелее, т
    heavyPermit: 1600,  // госпошлина за разрешение на тяжеловес, ₽
    harmKm: 74,         // вред дорогам: ПП РФ от 31.01.2020 № 67 — ориентир ≈ 7 365 ₽ на 100 км (точно — по осевым нагрузкам)
    escortW: 3.5,       // шире — автомобиль прикрытия (ПП РФ № 2060)
    escortKm: 50,       // прикрытие, ₽/км (ориентир — уточните у перевозчика)
    gibddW: 4.0,        // шире — сопровождение патрульным автомобилем ГИБДД (стоимость — по договору, в расчёт не входит)
    unload: [           // разгрузка на объекте: максимальная масса одного места, т — стоимость смены (7 + 1 ч), ₽
      { id:'manip',   name:'Манипулятор до 7 т',  max:7,  cost:15000 },
      { id:'crane25', name:'Автокран 25 т',       max:16, cost:22000 },
      { id:'crane50', name:'Автокран 50 т',       max:32, cost:40000 },
      { id:'crane100',name:'Автокран 100 т',      max:60, cost:100000 },
    ],
    agentPct: 15,       // агент-экспедитор: наценка к ставке перевозчика, % (рынок 5–15 %, в споте до 20–25 %)
    insPct: 0.15,       // страхование груза по России — обязательно, % от стоимости груза (рынок 0,06–0,7 %, чаще 0,15 %)
    insMin: 300,        // минимальная премия, ₽
    pack: 10,           // упаковка (поддон, обрешётка), % к массе — для мест легче packMax
    packMax: 3,         // тяжелее, т — оборудование на своей раме, без упаковки
    roadK: 1.13,        // пока маршрут по дорогам не посчитан: коэффициент дорог (по дороге / по прямой), европейская часть
    roadKE: 1.22,       // Урал и Сибирь (восточнее 59° в. д.)
    roadKFE: 1.4,       // восточнее Байкала (105° в. д.): дороги в обход
    localKm: 40,        // доставка в пределах города (адреса не уточнены)
    kmDay: 600,         // пробег в сутки, км (негабарит — kmDayOver)
    kmDayOver: 350,
    permitDays: 5,      // оформление спецразрешения, рабочих дней
    range: 15,          // разброс оценки, ± %
    hub: 'Москва',      // откуда везём импорт по умолчанию (СВХ / таможенный терминал)
    legal: { w:2.55, h:4.0 },
    sources: [
      'Ставки — с НДС 22 %, ставка перевозчика без агента; рейс = подача + км до 1 000 км × ставка + км дальше × «дальняя» ставка',
      'Москва → Санкт-Петербург, тент 20 т: 60 860 ₽ (калькулятор EastLines, 2026), от 70 000 ₽ (avtogost77.ru, июль 2026)',
      'Москва → Новосибирск, 20 т: 167 000 ₽ (фургон, EastLines), 188 104 ₽ (тент, базовый тариф «Русский Транзит 77»)',
      'Средние заказы Москва → Санкт-Петербург (maintransport.ru, 16.05.2026): Газель ≈ 35 000 ₽, 5 т ≈ 52 200 ₽, 10 т ≈ 66 700 ₽',
      'ATI.SU «Средние ставки», май 2026: фура — ≈ 58 ₽/км по рынку, ≈ 70 ₽/км средневзвешенно у перевозчиков; за 2025 год ставки выросли на 12,3 %',
      'Трал: до 30 т 80–120 ₽/км, 45–50 т 100–150 ₽/км, при 30 т ≈ 118 ₽/км; разрешение и сопровождение — отдельно (vityaz-tk.ru, rosperevozki.ru, 2026)',
      'Госпошлина за спецразрешение — 1 600 ₽ (НК РФ, ст. 333.33); вред дорогам — ПП РФ от 31.01.2020 № 67; сопровождение — ПП РФ от 21.12.2020 № 2060',
      'Автокран 25 т — 18–22 тыс. ₽ за смену, 50 т — 32–44 тыс. ₽ (Москва, 2026)',
      'Агент-экспедитор: наценка 5–15 % от ставки перевозчика в массовом сегменте, в споте до 20–25 % (portal-logistic.ru, roolz.net, 2026)',
      'Страхование груза автотранспортом: 0,06–0,7 % от стоимости, обычно 0,15 %, полис от 300 ₽ (inslog.ru, infullbroker.ru, 2026)',
    ],
  };
  static NUM = ['L','W','h','hMax','wMax','t','tLegal','km','kmFar','base','min','max','cost'];
  // прежние стандартные ставки и названия (одна ставка за км): сохранённые без изменений — заменяются новыми стандартными
  static OLD = { gazel:{name:'«Газель» тент 1,5 т', km:30, base:1500, min:5000}, t5:{name:'Грузовик 5 т', km:40, base:3000, min:8000},
    t10:{name:'Грузовик 10 т', km:45, base:4000, min:12000}, tent20:{name:'Фура тент 20 т (82 м³)', km:65, base:6000, min:20000},
    flat:{name:'Открытая площадка 20 т', km:75, base:8000, min:25000}, lowbed:{name:'Трал низкорамный 40 т', km:120, base:15000, min:40000} };
  // морской контейнер: 20 фут — 6,058 м, 40 фут — 12,192 м; ширина 2,438 м; высота 2,591 м (HC — 2,896 м)
  static ISO = { l:[6.058, 12.192], w:2.438, h:[2.591, 2.896], tol:0.04 };

  // тарифы: стандартные + сохранённые администратором + ставки автообновления (ATI.SU)
  static tariffs(saved){
    const t=JSON.parse(JSON.stringify(Freight.DEFAULTS));
    if (saved && typeof saved==='object'){
      for (const k of Object.keys(t)) if (!['classes','unload','legal','sources','ver'].includes(k) && saved[k]!=null && saved[k]!=='') t[k]=typeof t[k]==='number' ? +saved[k] : saved[k];
      const oldVer=!(+saved.ver>=3);
      for (const key of ['classes','unload']) if (Array.isArray(saved[key]) && saved[key].length){
        const def=t[key];
        t[key]=saved[key].map(x0=>{ const d=def.find(y=>y.id===x0.id)||{}, x={...x0}, od=key==='classes'&&oldVer&&Freight.OLD[x.id];
          // прежние стандартные значения, не изменённые администратором, — новые стандартные (ставки 2026 в два участка)
          if (od){ if (['km','base','min'].every(f=>+x[f]===od[f])){ delete x.km; delete x.base; delete x.min; delete x.kmFar; if (x.src && /стандартн/.test(x.src)) delete x.src; }
            if (x.name===od.name) delete x.name; }
          const o={...d,...x};
          for (const f of Freight.NUM) if (o[f]!=null && o[f]!=='') o[f]=+o[f];
          // своя ставка из прежних версий (без «дальней» ставки) — та же по всему маршруту, как считалось раньше
          if (key==='classes' && !(x.kmFar>0) && x.km>0) o.kmFar=+x.km;
          o.open=!!o.open; return o; });
        // новые стандартные классы (контейнеровоз) — в тарифы, сохранённые до их появления
        if (key==='classes' && oldVer) for (const d of def) if (!t[key].some(x=>x.id===d.id) && !Freight.OLD[d.id]) t[key].push({...d});
      }
    }
    // ставки из автообновления (ATI.SU) — у классов, где оно не выключено (auto:false — ставка закреплена вручную)
    const au=saved&&saved._auto, ac=(au&&au.classes)||{};
    for (const c of t.classes){
      if (c.auto!==false && ac[c.id] && ac[c.id].km>0){ Object.assign(c, Freight.fromAuto(c, ac[c.id], t)); c.src=ac[c.id].src; c.srcAt=au.at; c.srcAuto=true; }
      else if (!c.src) c.src = saved&&saved.updatedAt && Array.isArray(saved.classes) ? 'вручную в «Настройках»' : 'стандартная ставка (рынок 2026, см. источники)';
    }
    return t;
  }

  // ставки класса по автообновлению: по направлениям с длиной и ценой рейса — ставка до far км и дальше (верхняя граница),
  // иначе — общая ставка ₽/км, а дальняя — в той же пропорции, что у стандартного тарифа
  static fromAuto(C, a, T){
    const ratio=C.kmFar>0 && C.km>0 ? C.kmFar/C.km : 1, far=T.far>0?T.far:1000, base=C.base||0;
    const pts=(a.routes||[]).filter(r=>r.dist>0 && r.trip>0);
    if (!pts.length) return { km:+a.km, kmFar:Math.round(+a.km*ratio) };
    const near=pts.filter(p=>p.dist<=far), long=pts.filter(p=>p.dist>far);
    let km = near.length ? Math.max(...near.map(p=>(p.trip-base)/p.dist)) : Math.max(...long.map(p=>(p.trip-base)/(far+ratio*(p.dist-far))));
    km=Math.max(1, km);
    let kmFar = long.length ? Math.max(...long.map(p=>(p.trip-base-km*far)/(p.dist-far))) : km*ratio;
    if (!(kmFar>0)) kmFar=km*ratio;
    return { km:Math.round(km), kmFar:Math.round(Math.min(kmFar, km)) };
  }

  static isIso(u){ const I=Freight.ISO, near=(v, list)=>list.some(x=>Math.abs(v-x)<=I.tol);
    return near(Math.max(u.l,u.w), I.l) && Math.abs(Math.min(u.l,u.w)-I.w)<=I.tol && near(u.h, I.h); }

  // грузоподъёмность без спецразрешения на тяжеловес
  static legalT(C, T){ return C.tLegal>0 ? C.tLegal : (C.open && C.t>T.heavyFrom ? T.heavyFrom : C.t); }

  // раскладка мест по площадке; units — места груза {l, w, h, m, name}; ориентация в плане любая, кантовать нельзя
  static fit(units, C, T){
    let mass=0, overW=0, overH=0;
    const lay=[], legalW=(T.legal&&T.legal.w)||2.55;
    for (const u of units){
      if (C.iso && !Freight.isIso(u)) return { ok:false, why:'контейнеровоз возит только морские контейнеры 20 и 40 футов' };
      mass+=u.m;
      let l=u.l, w=u.w;
      if (w>C.W && l<=C.W && w<=C.L){ const t=l; l=w; w=t; }          // повернуть поперёк, если так помещается
      if (l>C.L+0.001) return { ok:false, why:`длина ${lgM(u.l)} м больше площадки ${lgM(C.L)} м` };
      if (u.h>C.hMax+0.001) return { ok:false, why:`высота ${lgM(u.h)} м больше допустимой ${lgM(C.hMax)} м` };
      if (w>C.wMax+0.001 || (!C.open && w>C.W+0.001)) return { ok:false, why:`ширина ${lgM(w)} м больше допустимой ${lgM(C.open?C.wMax:C.W)} м` };
      // открытая площадка: груз шире кузова, но не шире 2,55 м, — без спецразрешения; шире — негабарит
      if (w>legalW+0.001) overW=Math.max(overW, w);
      if (u.h>C.h+0.001) overH=Math.max(overH, u.h);
      lay.push({l,w,u});
    }
    if (mass>C.t+0.001) return { ok:false, why:`масса ${lgT(mass)} т больше грузоподъёмности ${lgT(C.t)} т` };
    // полки вдоль площадки: в полке места стоят рядом поперёк, глубина полки — самое длинное место
    lay.sort((a,b)=>b.l-a.l || b.w-a.w);
    const shelves=[]; let depth=0;
    for (const x of lay){
      const sh=shelves.find(s=>s.depth>=x.l-0.001 && s.used+x.w<=Math.max(C.W, x.w)+0.001 && !(s.wide||x.w>C.W));
      if (sh) sh.used+=x.w;
      else { shelves.push({depth:x.l, used:x.w, wide:x.w>C.W}); depth+=x.l+0.1; }
    }
    if (depth-0.1>C.L+0.001) return { ok:false, why:'не помещается по длине площадки' };
    return { ok:true, mass, overW, overH, depth:Math.max(0, depth-0.1) };
  }

  // рейс: подача + км до far × ставка + км дальше × «дальняя» ставка (× надбавка негабарита), не меньше минимального заказа
  static run(C, km, T, k=1){
    const far=T.far>0?T.far:Infinity, near=Math.min(km, far), rest=Math.max(0, km-far), kmFar=C.kmFar>0?C.kmFar:C.km;
    const raw=(C.base||0) + (C.km*near + kmFar*rest)*k;
    return { v:Math.max(C.min||0, raw), raw, near, rest, kmFar };
  }

  static vehicleCost(C, fit, km, T){
    const over=fit.overW>0 || fit.overH>0, heavy=fit.mass>Freight.legalT(C, T)+0.001, escort=fit.overW>T.escortW, gibdd=fit.overW>(T.gibddW||4);
    const k=over ? (C.id==='lowbed' ? T.overKLowbed : T.overK) : 1, r=Freight.run(C, km, T, k), n=x=>Math.round(x).toLocaleString('ru-RU');
    const seg = r.rest>0 ? `${n(r.near)} км × ${lgRub(C.km*k)} + ${n(r.rest)} км × ${lgRub(r.kmFar*k)}` : `${n(km)} км × ${lgRub(C.km*k)}`;
    const parts=[[`${C.name}: подача ${lgRub(C.base||0)} + ${seg}${r.raw<(C.min||0)?` (минимальный заказ ${lgRub(C.min)})`:''}`, r.v]];
    if (over) parts.push([`Негабарит (${[fit.overW?`ширина ${lgM(fit.overW)} м`:'', fit.overH?`высота груза ${lgM(fit.overH)} м`:''].filter(Boolean).join(', ')}): спецразрешение${T.permitAgent?' и оформление':''}`, T.permit+T.permitAgent]);
    if (heavy) parts.push([`Тяжеловес (${lgT(fit.mass)} т, без разрешения — до ${lgT(Freight.legalT(C, T))} т): ${over?'':'разрешение и '}вред дорогам ${n(km)} км × ${lgRub(T.harmKm)}`, (over?0:T.heavyPermit+T.permitAgent) + T.harmKm*km]);
    if (escort) parts.push([`Автомобиль прикрытия (шире ${lgM(T.escortW)} м): ${n(km)} км × ${lgRub(T.escortKm)}`, T.escortKm*km]);
    return { cost:parts.reduce((s,p)=>s+p[1],0), parts, over, heavy, escort, gibdd };
  }

  static bestClass(units, km, T){
    let best=null;
    for (const C of T.classes){ const f=Freight.fit(units, C, T); if (!f.ok) continue;
      const c=Freight.vehicleCost(C, f, km, T); if (!best || c.cost<best.cost) best={C, fit:f, ...c}; }
    return best;
  }

  // план перевозки: одна машина, если всё помещается; иначе — несколько (крупные места первыми)
  static plan(units, km, T){
    const one=Freight.bestClass(units, km, T);
    if (one) return { vehicles:[{...one, units}], unplaced:[] };
    const sorted=[...units].sort((a,b)=>(b.l*b.w)-(a.l*a.w) || b.m-a.m);
    const vs=[], unplaced=[];
    for (const u of sorted){
      let placed=false;
      for (const v of vs){ const b=Freight.bestClass(v.units.concat(u), km, T); if (b){ Object.assign(v, b, {units:v.units.concat(u)}); placed=true; break; } }
      if (placed) continue;
      const b=Freight.bestClass([u], km, T);
      if (b) vs.push({...b, units:[u]});
      else unplaced.push({u, why:T.classes.map(C=>Freight.fit([u], C, T).why).filter(Boolean).pop()||''});
    }
    return { vehicles:vs, unplaced };
  }

  // ключ маршрута по дорогам: обе точки с координатами — точные адреса или центры городов (один город без адресов — по городу)
  static routeKey(a, b){
    if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lon) || !Number.isFinite(b.lat) || !Number.isFinite(b.lon)) return '';
    if (!a.exact && !b.exact && a.name===b.name) return '';
    return `${a.lat.toFixed(4)},${a.lon.toFixed(4)}|${b.lat.toFixed(4)},${b.lon.toFixed(4)}`;
  }

  // расчёт целиком. inp: { from:{city|addr|geo}, to:{…}, km (своё расстояние или ''), route:{key, km, src} (по дорогам),
  // items:[{name, qty, l,w,h (м), m (т)}], unload:'auto'|'none'|id, value (стоимость груза для страхования) }
  static calc(inp, T){
    T=T||Freight.tariffs();
    const warn=[], missing=[];
    const A=lgPoint(inp.from), B=lgPoint(inp.to), rk=Freight.routeKey(A,B);
    let km=lgNum(inp.km), kmSrc='вручную';
    if (!(km>0) && rk && inp.route && inp.route.key===rk && inp.route.km>0){
      km=inp.route.km; kmSrc=(inp.route.src||'по дорогам')+(A.exact&&B.exact?'':A.exact||B.exact?', от центра города':', между центрами городов'); }
    if (!(km>0)){ km=lgRoadKm(A,B,T); kmSrc=!km?'':A.exact&&B.exact?(lgHav(A,B)<40?'по городу между адресами':'по прямой между адресами с поправкой на дороги'):(A.name===B.name?'в пределах города':'по прямой с поправкой на дороги'); }
    if (A&&A.noRoad || B&&B.noRoad) warn.push(`${(B&&B.noRoad?B:A).name}: нет круглогодичной дороги — доставка морем, по зимнику или авиа, нужен расчёт перевозчика`);
    if (A&&B&&(A.name==='Калининград')!==(B.name==='Калининград')) warn.push('Калининград: транзит через страны ЕС или паром — нужен расчёт перевозчика');
    const units=[];
    for (const it of inp.items||[]){
      const q=Math.max(0, Math.round(+it.qty||0)); if (!q) continue;
      const l=+it.l, w=+it.w, h=+it.h, m=+it.m;
      if (!(l>0&&w>0&&h>0) || !(m>0)){ missing.push(it.name||'позиция'); continue; }
      const mp = m<T.packMax ? m*(1+T.pack/100) : m;
      for (let i=0;i<Math.min(q,300);i++) units.push({name:it.name, l:Math.max(l,w), w:Math.min(l,w), h, m:mp});
      if (q>300) warn.push(`${it.name}: больше 300 мест — посчитаны первые 300`);
    }
    const res={ from:A, to:B, km, kmSrc, routeKey:rk, units:units.length, mass:units.reduce((s,u)=>s+u.m,0), missing, warn, vehicles:[], unplaced:[], unload:null, total:0, lo:0, hi:0, days:0, ok:false };
    if (!(km>0)){ res.need='Укажите, откуда и куда везём (город в адресе) или расстояние в км'; return res; }
    if (!units.length){ res.need=missing.length?'Укажите массу и габариты позиций':'В КП нет позиций этого поставщика'; return res; }
    const plan=Freight.plan(units, km, T);
    res.vehicles=plan.vehicles; res.unplaced=plan.unplaced;
    if (plan.unplaced.length) warn.push('Не помещается ни в одну машину из тарифов: '+[...new Set(plan.unplaced.map(x=>x.u.name))].join(', ')+' — нужен индивидуальный расчёт');
    if (res.vehicles.some(v=>v.gibdd)) warn.push(`Груз шире ${lgM(T.gibddW||4)} м — нужно сопровождение патрульным автомобилем ГИБДД: стоимость уточните у перевозчика (в расчёт не входит)`);
    const maxUnit=units.reduce((s,u)=>Math.max(s,u.m),0);
    res.unload=lgUnloadPick(maxUnit, T, inp.unload||LgValues.unload());
    if (res.unload && maxUnit>res.unload.max+0.001) warn.push(`Самое тяжёлое место ${lgT(maxUnit)} т — больше, чем поднимет «${res.unload.name}»`);
    res.transport=res.vehicles.reduce((s,v)=>s+v.cost,0);
    res.agent=Math.round((res.transport+(LgValues.agentUnload()&&res.unload?res.unload.cost:0))*T.agentPct/100);   // агент — на рейс, разрешения, прикрытие и разгрузку
    const val=+inp.value||0;
    res.ins=Math.round(Math.max(T.insMin, val*T.insPct/100)); res.insBase=val;
    const loc=Freight.plan(units, T.localKm, T);       // забор у отправителя и доставка получателю по городу (для «терминал — терминал»)
    res.localLeg=loc.unplaced.length?0:Math.round(loc.vehicles.reduce((s,v)=>s+v.cost,0));
    res.total=res.transport+res.agent+res.ins+(res.unload?res.unload.cost:0);
    res.lo=Math.round(res.total*(1-T.range/100)/100)*100; res.hi=Math.round(res.total*(1+T.range/100)/100)*100;
    const over=res.vehicles.some(v=>v.over||v.heavy);
    res.days=Math.ceil(km/(over?T.kmDayOver:T.kmDay))+1+(over?T.permitDays:0);
    res.over=over;
    res.ok=!plan.unplaced.length && !missing.length;
    return res;
  }

  // Сверка с фактическими счетами: facts — [{at, route, km, cls, sum (с НДС), note}]. Для каждой записи — цена рейса по
  // тарифу (без агента, страхования и разгрузки) и отклонение; для класса — поправка тарифа:
  //   при 3+ счетах на разных расстояниях — два множителя (взвешенный МНК по относительной ошибке): α к подаче и минимальному
  //   заказу, β к ставкам за км (доля «дальней» ставки сохраняется); иначе — один множитель (медиана «факт / тариф»).
  static calibrate(facts, T){
    const rows=(facts||[]).map(f=>{ const C=T.classes.find(c=>c.id===f.cls), km=+f.km, sum=+f.sum;
      if (!C || !(km>0) || !(sum>0)) return {...f, ok:false};
      const r=Freight.run(C, km, T); return {...f, ok:true, model:r.v, dev:sum/r.v-1}; });
    const out=[];
    for (const C of T.classes){
      const R=rows.filter(r=>r.ok && r.cls===C.id); if (!R.length) continue;
      const ratios=R.map(r=>1+r.dev).sort((a,b)=>a-b), n=R.length;
      const med=n%2 ? ratios[(n-1)/2] : (ratios[n/2-1]+ratios[n/2])/2;
      let a=med, b=med, how='один множитель — медиана по счетам';
      const kms=R.map(r=>+r.km);
      if (n>=3 && Math.max(...kms)>=2*Math.min(...kms) && (C.base||0)>0){
        // sum ≈ α·base + β·D, D — часть рейса за км; вес 1/sum² (относительная ошибка)
        let s11=0, s12=0, s22=0, t1=0, t2=0;
        for (const r of R){ const x=Freight.run(C, +r.km, T), D=x.raw-(C.base||0), B=C.base||0, w=1/(r.sum*r.sum);
          s11+=w*B*B; s12+=w*B*D; s22+=w*D*D; t1+=w*B*r.sum; t2+=w*D*r.sum; }
        const det=s11*s22-s12*s12;
        if (Math.abs(det)>1e-18){ const A=(t1*s22-t2*s12)/det, Bt=(s11*t2-s12*t1)/det;
          if (A>0.2 && A<5 && Bt>0.2 && Bt<5){ a=A; b=Bt; how='подача и ставки за км отдельно — по счетам на разных расстояниях'; } }
      }
      const fitted={...C, base:Math.round((C.base||0)*a/100)*100, min:Math.round((C.min||0)*a/100)*100, km:Math.round(C.km*b), kmFar:Math.round((C.kmFar>0?C.kmFar:C.km)*b)};
      const err=(cls)=>R.reduce((s,r)=>s+Math.abs(r.sum/Freight.run(cls, +r.km, T).v-1),0)/n*100;
      out.push({id:C.id, name:C.name, n, a, b, how, before:err(C), after:err(fitted), fitted});
    }
    return { rows, classes:out };
  }
}

// Значения логистики в «Настройки → Значения программы → Логистика» (реестр — js/core/defaults.js, DefRegistry).
// Ставки машин, страхование, агент, упаковка, коэффициенты дорог и разгрузка — в «Настройки → Тарифы доставки» (здесь не
// дублируются). Значения «Сборный груз» читает сервер (app/logistics_api.py, LtlLimits) — встроенные там те же.
class LgValues {
  static CURS = [['RUB','Рубли (₽)'], ['USD','Доллары США'], ['EUR','Евро'], ['CNY','Юани']];
  static def(k, fb){ const v=typeof DEF==='function' ? DEF(k) : null; return v==null ? fb : v; }
  /** разгрузка на объекте по умолчанию: none — не нужна (разгружает заказчик), auto — подобрать по
   *  самому тяжёлому месту, иначе — техника из «Тарифов доставки» (её id; удалённая из тарифов — «не нужна») */
  static unload(){ const v=String(this.def('log.unload', 'none'));
    return v==='auto' || v==='none' ? v : (this.techs().some(u=>u.id===v) ? v : 'none'); }
  /** техника разгрузки из «Тарифов доставки» (пока тарифы не загружены — пусто) */
  static techs(){ const T=typeof LG!=='undefined' && LG.tar ? LG.tar : typeof Freight!=='undefined' ? Freight.tariffs(typeof LG!=='undefined' && LG.saved || {}) : null;
    return T && Array.isArray(T.unload) ? T.unload : []; }
  /** срок в пути → «Доставка до заказчика» (галочка на вкладке) */
  static setDays(){ return this.def('log.setDays', true)!==false; }
  /** сумма доставки в сделку у нового расчёта: auto — по расчёту, manual — своя сумма */
  static mode(){ return this.def('log.mode', 'auto')==='manual' ? 'manual' : 'auto'; }
  /** валюта своей суммы доставки по умолчанию */
  static manCur(){ const v=this.def('log.manCur', 'RUB'); return this.CURS.some(c=>c[0]===v) ? v : 'RUB'; }
  /** «выброс»: предложение дороже середины (медианы) остальных во столько раз — не берётся в максимум; 0 — без защиты */
  /** агент-экспедитор начисляется и на разгрузку (манипулятор, автокран) — решение владельца 17.10 */
  static agentUnload(){ return this.def('log.agentUnload', true)!==false; }
  static outlierK(){ const v=+this.def('log.outlierK', 2); return v>0 ? Math.max(1.2, v) : 0; }
  static register(){
    if (typeof DefRegistry==='undefined') return;
    DefRegistry.add([
      ['logDef', 'Логистика: что подставляется на вкладке', 'log', 'Вкладка «Логистика» окна «Экономика сделки». Значения действуют для новых расчётов и поставщиков; менеджер может поменять их в каждой сделке. Ставки машин, страхование груза, агент, упаковка и разгрузка — в «Настройки → Тарифы доставки».'],
      ['logLtl', 'Сборный груз: что принимают транспортные компании', 'log', 'Цены ПЭК, Деловых Линий, КИТ, СДЭК, Возовоза и Энергии запрашиваются, только если груз проходит по этим пределам. Больше — эти перевозчики не считают, а ЖелДорЭкспедиция считает крупногабаритный груз сборной отправкой (до 20 000 кг) и программа считает отдельную машину (ATI.SU и тарифы). Встроенные пределы — ориентир программы: место до 3 000 кг и 6 000 × 2 400 × 2 500 мм, весь груз до 20 000 кг; если ваш перевозчик принимает больше или меньше — поправьте.'],
      ['logAti', 'Цены перевозчиков: отдельная машина', 'log', 'Цена отдельной машины (не сборного груза) по ATI.SU «Средние ставки» — нужен ключ ATI.SU в «Настройки → Ключи API».'],
    ], [
      ['log.unload', 'logDef', 'Разгрузка на объекте', 'select', 'none', {req:true, opts:()=>[['none','Не нужна — разгружает заказчик'],['auto','Подобрать по самому тяжёлому месту (манипулятор, автокран)'], ...this.techs().map(u=>[u.id, `${u.name} — ${Math.round(+u.cost||0).toLocaleString('ru-RU')} ₽`])],
        hint:'Что выбрано в поле «Разгрузка на объекте» у нового расчёта (по умолчанию — разгружает заказчик, разгрузка в цену доставки не входит). Можно выбрать конкретную технику из «Тарифов доставки» — тогда её цена сразу прибавляется к доставке. «Подобрать» — программа берёт технику по самому тяжёлому месту из «Тарифов доставки» (например, место 5 т → манипулятор до 7 т, 15 000 ₽) и прибавляет её к доставке. «Не нужна» — разгрузку в цену доставки не включаем (обычно, если у заказчика свой кран или погрузчик).'}],
      ['log.setDays', 'logDef', 'Срок в пути переносить в «Доставка до заказчика»', 'bool', true,
        {hint:'Галочка «срок в пути → «Доставка до заказчика»» на вкладке «Логистика». Включено — дни в пути из расчёта (например, 4 дня до Казани) сами ставятся в срок доставки на вкладке «Закупка» и в график платежей. Выключено — срок доставки менеджер пишет сам.'}],
      ['log.mode', 'logDef', 'Сумма доставки в расчёт сделки', 'select', 'auto', {req:true, opts:[['auto','По расчёту программы (максимальное предложение перевозчиков)'],['manual','Своя сумма — менеджер вписывает сам']],
        hint:'Как в новой сделке заполняется «Доставка по России»: по расчёту (тарифы и цены перевозчиков, по умолчанию — максимальное предложение) или своей суммой (например, по счёту перевозчика). В каждой сделке переключается кнопками «По расчёту» / «Своя сумма».'}],
      ['log.manCur', 'logDef', 'Валюта своей суммы доставки', 'select', 'RUB', {req:true, opts:this.CURS,
        hint:'Валюта, которая сразу выбрана рядом с полем «Своя сумма». Сумма в валюте переводится в рубли по курсу ЦБ РФ (тот же курс, что в «Цене КП»: кнопка «Обновить курс с cbr.ru»); в расчёт сделки и в Excel идут рубли, в Excel видна и сумма в валюте. Пример: 1 000 USD при курсе 92,50 ₽ → 92 500 ₽.'}],
      ['log.ltlKg', 'logLtl', 'Масса одного места — не больше', 'num', '3000', {unit:'кг', req:true, min:100, max:20000,
        hint:'Самое тяжёлое место груза, которое возьмут сборным грузом. Тяжелее — только отдельная машина. Пример: компрессор 3 200 кг при пределе 3 000 кг — сборным грузом не считается.'}],
      ['log.ltlL', 'logLtl', 'Длина места — не больше', 'num', '6000', {unit:'мм', req:true, min:1000, max:13600,
        hint:'Наибольшая сторона места в плане. Длиннее — сборным грузом не считаем, только отдельная машина.'}],
      ['log.ltlW', 'logLtl', 'Ширина места — не больше', 'num', '2400', {unit:'мм', req:true, min:500, max:2550,
        hint:'Меньшая сторона места в плане. Шире — только отдельная машина. Больше 2 550 мм — уже негабарит по ПП РФ № 2200.'}],
      ['log.ltlH', 'logLtl', 'Высота места — не больше', 'num', '2500', {unit:'мм', req:true, min:500, max:3000,
        hint:'Высота места с упаковкой. Выше — сборным грузом не считаем (высота кузова тентованной машины в «Тарифах доставки» — 2,4–2,6 м).'}],
      ['log.ltlTotal', 'logLtl', 'Общая масса груза — не больше', 'num', '20000', {unit:'кг', req:true, min:1000, max:40000,
        hint:'Весь груз поставщика вместе. Тяжелее — сборным грузом выгоднее не везти, программа считает отдельную машину (фура 20 т).'}],
      ['log.outlierK', 'logDef', 'Не брать в максимум цену дороже остальных в', 'num', '2', {unit:'раз', req:true, min:0, max:10, step:0.1,
        hint:'Защита «максимального предложения» от ошибочной цены перевозчика. Если цена в столько раз выше середины (медианы) остальных предложений, она помечается «выброс» и в максимум не идёт (её можно выбрать вручную). Пример: Энергия 403 840 ₽ при остальных 74–108 тыс. ₽ (середина ≈ 93 тыс.) — в 4,3 раза дороже, при пороге 2 — выброс. Считается, когда предложений не меньше трёх. 0 — без защиты.'}],
      ['log.agentUnload', 'logDef', 'Агент-экспедитор — и на разгрузку', 'bool', true,
        {hint:'Отдельная машина и расчёт по тарифам идут через агента-экспедитора: его процент («Тарифы доставки») начисляется на рейс вместе со спецразрешением, госпошлиной, платой за вред дорогам и автомобилем прикрытия. Включено — и на разгрузку на объекте (манипулятор, автокран). Страхование груза — без агентских. Пример: рейс 200 000 ₽ + разгрузка 20 000 ₽, агент 15 % — 33 000 ₽ (выключено — 30 000 ₽). У транспортной компании (сборный груз) агента нет.'}],
      ['log.atiDays', 'logAti', 'ATI.SU: средние ставки за последние', 'num', '30', {unit:'дн.', req:true, min:7, max:90,
        hint:'Цена отдельной машины по ATI.SU «Средние ставки» — верхняя граница ставок по направлению за этот период. Меньше дней — свежее, но меньше сделок в выборке; 30 дней — как на сайте ATI.SU.'}],
    ]);
  }
}
LgValues.register();

if (typeof module!=='undefined') module.exports={Freight, LgValues, lgCargoOf, lgWriteCargo, lgTriple, lgCity, lgCityByName, lgRoadKm, lgHav, lgPoint, LG_CITIES};
