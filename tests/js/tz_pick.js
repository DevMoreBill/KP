// Подбор оборудования по ТЗ заказчика (app/web/js/features/tz-import.js — TzPick) и проверки требований станции
// (kit-view.js — StationReq.checks) на вымышленном каталоге в памяти: число рабочих агрегатов из ТЗ, запас давления
// компрессора на потери в осушителе и фильтрах, продувка адсорбционного осушителя, бак ДГУ под время работы, насосы
// без лишнего напора.
// Запуск из корня репозитория: node tests/js/tz_pick.js — код выхода 0, если всё прошло (tests/test_tz_parse.py).
'use strict';
const vm=require('vm'), fs=require('fs'), path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');

// окружение страницы — только то, что нужно подбору и проверкам
global.document={ addEventListener(){} };
global.uid=(()=>{ let n=0; return ()=>'p'+(++n); })();
global.attrsOf=d=>Object.assign({}, d.attrs||{});
const TYPES={ st_comp:{ station:{ main:['comp_screw', 'comp_piston'] }, fields:[] }, st_pump:{ station:{ main:['pump'] }, fields:[] }, st_dgu:{ station:{ main:['dgu'] }, fields:[] } };
global.typeById=id=>TYPES[id]||{};
global.catCache=[];
global.DEF=()=>null;   // умолчания администратора — нет
global.numOf=v=>{ if (typeof v==='number') return v; const m=String(v??'').replace(/\s/g, '').replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; };   // как в core/util.js
global.FEAT={ on:()=>false };   // компоновка выключена: размер контейнера по оборудованию здесь не подбирается
global.mainLine=()=>''; global.groupsFromAttrs=()=>[];   // характеристики станции для КП — здесь не проверяются
global.esc=v=>String(v??'').replace(/[&<>"']/g, c=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
global.api=async u=>{ const c=global.catCache.find(z=>u.endsWith('/'+encodeURIComponent(z.id))); if (!c) throw new Error('нет '+u); return c; };
for (const f of ['logistics-calc.js', 'station-rules.js', 'station-layout.js', 'station-systems.js', 'kit.js', 'kit-view.js', 'station-calc.js', 'station-ui.js', 'tz-import.js', 'station-quick.js']){
  const p=path.join(ROOT, 'app', 'web', 'js', 'features', f); vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename:p }); }
StationRules.use(JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'web', 'rules', 'stations.json'), 'utf8')));   // файл инженерных правил

class Cat {
  static n=0;
  static item(name, attrs){ return { id:'c'+(++Cat.n), name, attrs:Object.assign({ maker:'Пример' }, attrs) }; }
  static station(cat, parts, req){ return { id:'st'+(++Cat.n), name:'', attrs:{ cat }, req:req||{}, kit:{ parts:[kitNewContainer('block'), ...parts] } }; }
  static kinds(x){ return kitParts(x).map(p=>[StationEquip.kindOf(p), p.qty, (p.attrs||{}).cat||'']); }
}

class Check {
  static n=0;
  static async run(name, fn){ try{ await fn(); Check.n++; } catch(e){ console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; } }
}

(async ()=>{
  await Check.run('рабочие агрегаты и запас давления', ()=>{
    const pool=[{ v:6.5, p:9.7 }, { v:13, p:13 }, { v:12.6, p:8 }], pen=o=>TzPick.barPen(o.p, 8);
    let u=TzPick.units(pool, 12.5, 0, pen);
    assert.deepStrictEqual([u.n, u.o.v], [2, 6.5], 'два по 6,5 м³/мин при 9,7 бар — лучше одного на 13 бар или впритык по давлению');
    u=TzPick.units(pool, 12.5, 1, pen);
    assert.deepStrictEqual([u.n, u.o.v], [1, 13], 'один рабочий — как в ТЗ');
    assert.strictEqual(TzPick.barPen(8, 8), 0.5, 'без запаса на потери в подготовке воздуха — штраф');
    assert.ok(TzPick.barPen(10, 8)<TzPick.barPen(13, 8), 'лишнее давление — штраф больше');
    assert.strictEqual(TzPick.units(pool, 50, 1), null, 'подходящего нет');
  });

  await Check.run('компрессорная: адсорбционный осушитель, продувка, фильтры и ресивер по расчёту', async ()=>{
    global.catCache=[
      Cat.item('Компрессор винтовой К-65', { cat:'comp_screw', flow:6.5, pressure:9.7, kw:37 }),
      Cat.item('Компрессор винтовой К-130', { cat:'comp_screw', flow:13, pressure:10, kw:75 }),
      Cat.item('Осушитель рефрижераторный ОР-20', { cat:'dryer_refrig', flow:20 }),
      Cat.item('Осушитель адсорбционный ОА-16', { cat:'dryer_ads', flow:16, dewPoint:'−40' }),   // 16 · 0,81 (типовые поправки DA: 7,1 бар, вход 40 °C) = 13,0 — мало на 13
      Cat.item('Осушитель адсорбционный ОА-20', { cat:'dryer_ads', flow:20, dewPoint:'−40' }),
      Cat.item('Фильтр ФС-20', { cat:'filter', stage:'Сверхтонкая (микрофильтр)', flow:20 }),
      Cat.item('Фильтр ФТ-20', { cat:'filter', stage:'Тонкая', flow:20 }),
      Cat.item('Фильтр ФП-20', { cat:'filter', stage:'Предварительная', flow:20 }),
      Cat.item('Ресивер РВ-1000', { cat:'receiver', volume:1000, pressure:11 }),
      Cat.item('Ресивер РВ-2000', { cat:'receiver', volume:2000, pressure:11 }),
    ];
    const x=Cat.station('st_comp', [kitNewPart({ name:'Трубопроводная обвязка и запорная арматура' })], { reserve:'1' });
    x.stLayout={ air:'2.2.2' };
    const note=await TzPick.run(x, { kind:'comp', flow:10, pressure:7, air:'2.2.2', reserve:'1', work:0 });
    const K=Cat.kinds(x), comp=K.find(k=>k[0]==='compressor');
    assert.deepStrictEqual(comp.slice(0, 2), ['compressor', 2], '1 рабочий + 1 резервный: '+JSON.stringify(K));
    assert.strictEqual(kitParts(x).find(p=>StationEquip.kindOf(p)==='compressor').name, 'Компрессор винтовой К-130', '10 м³/мин + продувка 15 % — один на 13 м³/мин');
    assert.ok(K.some(k=>k[0]==='dryer' && k[2]==='dryer_ads'), 'класс воды 2 (−40 °C) — адсорбционный осушитель');
    assert.ok(K.filter(k=>k[0]==='filter').length>=2, 'фильтры до и после адсорбционного осушителя: '+JSON.stringify(K));
    const rv=kitParts(x).find(p=>StationEquip.kindOf(p)==='receiver');
    assert.deepStrictEqual([rv.name, rv.qty], ['Ресивер РВ-1000', 2], 'около 2000 л: вертикальный на 2000 л (2,9 м) не проходит по высоте блок-контейнера — два по 1000 л');
    assert.ok(/ресиверы 2 × Ресивер РВ-1000 \(2 по 1 000 л/.test(note), note);
    const y=Cat.station('st_comp', [], {});
    await TzPick.run(y, { kind:'comp', flow:10, pressure:7, air:'2.2.2', reserve:'0', work:0, recvOut:true });
    const ro=kitParts(y).find(p=>StationEquip.kindOf(p)==='receiver');
    assert.deepStrictEqual([ro.name, ro.qty], ['Ресивер РВ-1000', 2], 'снаружи высота не ограничена, но один на 2000 л при 7 бар — на учёт в Ростехнадзоре (p·V 1,4): два по 1000 л, каждый без учёта');
    const z=Cat.station('st_comp', [], {});
    await TzPick.run(z, { kind:'comp', flow:10, pressure:7, air:'2.4.2', reserve:'0', work:0, recv:'both' });
    assert.deepStrictEqual(kitParts(z).filter(p=>StationEquip.kindOf(p)==='receiver').map(p=>[p.name, p.qty]), [['Ресивер РВ-1000', 1], ['Ресивер РВ-1000', 1]], 'до и после осушителя — два ресивера');
    assert.ok(/продувку адсорбционного осушителя/.test(note), note);
    assert.strictEqual(K[K.length-1][0], 'piping', 'прочий состав — после подобранного');
    // требования: за вычетом продувки, давление на выходе — с потерями в подготовке воздуха
    x.req={ flow:'10', pressure:'7', reserve:'1' };
    const ck=StationReq.checks(x);
    assert.ok(ck[0].ok && /за вычетом продувки осушителя 11,05 м³\/мин \+ 11,05 в резерве — не меньше 10/.test(ck[0].text), ck[0].text);
    assert.ok(ck[1].ok && /на выходе ≈ 9,\d бар/.test(ck[1].text), ck[1].text);
    x.req.pressure='9.8';
    assert.ok(!StationReq.checks(x)[1].ok, 'компрессор 10 бар минус потери — меньше 9,8');
  });

  await Check.run('компрессорная: два рабочих по ТЗ, рефрижераторный осушитель', async ()=>{
    const x=Cat.station('st_comp', [], {});
    const note=await TzPick.run(x, { kind:'comp', flow:12.5, pressure:8, air:'2.4.2', reserve:'1', work:2 });
    const p=kitParts(x).find(z=>StationEquip.kindOf(z)==='compressor');
    assert.deepStrictEqual([p.name, p.qty], ['Компрессор винтовой К-65', 3], '2 рабочих + 1 резервный по 6,5 м³/мин');
    assert.ok(kitParts(x).some(z=>(z.attrs||{}).cat==='dryer_refrig'), 'класс воды 4 — рефрижераторный');
    assert.ok(!/продувк/.test(note), note);
  });

  await Check.run('добор количеством: компрессоры, осушители и фильтры параллельно', async ()=>{
    global.catCache=[
      Cat.item('Компрессор винтовой К-130', { cat:'comp_screw', flow:13, pressure:10, kw:75 }),
      Cat.item('Осушитель рефрижераторный ОР-20', { cat:'dryer_refrig', flow:20 }),
      Cat.item('Фильтр ФС-20', { cat:'filter', stage:'Сверхтонкая (микрофильтр)', flow:20 }),
      Cat.item('Фильтр ФТ-20', { cat:'filter', stage:'Тонкая', flow:20 }),
      Cat.item('Фильтр ФП-20', { cat:'filter', stage:'Предварительная', flow:20 }),
      Cat.item('Ресивер РВ-1000', { cat:'receiver', volume:1000, pressure:11 }),
    ];
    const x=Cat.station('st_comp', [], {});
    const note=await TzPick.run(x, { kind:'comp', flow:36, pressure:7, air:'2.4.2', reserve:'0', work:0 });
    const one=k=>kitParts(x).filter(p=>StationEquip.kindOf(p)===k), c=one('compressor')[0], d=one('dryer')[0], Qc=13*c.qty;
    assert.ok(c && c.qty>=3 && c.qty<=TzPick.MAX && Qc>=36, 'компрессоров — сколько нужно (до четырёх): '+JSON.stringify(c && c.qty));
    assert.ok(d && d.name==='Осушитель рефрижераторный ОР-20' && d.qty>=2, 'один осушитель мал — несколько одинаковых параллельно: '+note);
    const plan=StationLayout.solve(StationUi.input(x)), F=one('filter');
    assert.ok(F.length>=1 && F.every(f=>f.qty>=2), 'фильтры — тоже параллельно: '+JSON.stringify(F.map(f=>[f.name, f.qty])));
    assert.ok(/осушители \d × Осушитель рефрижераторный ОР-20 параллельно/.test(note) && /фильтры \d × Фильтр .* параллельно/.test(note) && !/В каталоге нет/.test(note), note);
    assert.ok(TzPick.many([{ cap:5 }, { cap:9 }], 20).n===3 && TzPick.many([{ cap:5 }, { cap:9 }], 20).o.cap===9, 'наименьшее число одинаковых, затем запас');
    assert.strictEqual(TzPick.many([{ cap:1 }], 20), null, 'больше четырёх — нет');
    assert.ok(['ok', 'warn', 'error'].includes(plan.level), 'расстановка считается');
  });

  await Check.run('фильтры без поля «Ступень очистки» — по названию', async ()=>{
    global.catCache=[
      Cat.item('Компрессор винтовой К-130', { cat:'comp_screw', flow:13, pressure:10, kw:75 }),
      Cat.item('Осушитель адсорбционный ОА-16', { cat:'dryer_ads', flow:16, dewPoint:'−40' }),   // 16 · 0,81 (типовые поправки DA: 7,1 бар, вход 40 °C) = 13,0 — мало на 13
      Cat.item('Осушитель адсорбционный ОА-20', { cat:'dryer_ads', flow:20, dewPoint:'−40' }),
      Cat.item('Фильтр магистральный PD 44, 0,01 мкм', { cat:'filter', flow:20 }),
      Cat.item('Фильтр магистральный DDp 44 пылевой', { cat:'filter', flow:20 }),
      Cat.item('Фильтр магистральный QD 44 угольный', { cat:'filter', flow:20 }),
    ];
    const x=Cat.station('st_comp', [], {});
    const note=await TzPick.run(x, { kind:'comp', flow:10, pressure:7, air:'2.2.2', reserve:'0', work:0 });
    const F=kitParts(x).filter(p=>StationEquip.kindOf(p)==='filter').map(p=>p.name).sort();
    assert.deepStrictEqual(F, ['Фильтр магистральный DDp 44 пылевой', 'Фильтр магистральный PD 44, 0,01 мкм'], note);
    assert.ok(!/В каталоге нет: .*фильтр/.test(note), note);
  });

  await Check.run('особые требования: безмасляный, частотное регулирование, АВР, АСУ ТП', async ()=>{
    global.catCache=[
      Cat.item('Компрессор винтовой К-130', { cat:'comp_screw', flow:13, pressure:10, kw:75 }),
      Cat.item('Компрессор винтовой К-130 VSD', { cat:'comp_screw', flow:13, pressure:10, kw:75 }),
      Cat.item('Компрессор безмасляный БК-140', { cat:'comp_screw', flow:14, pressure:10, kw:90 }),
    ];
    const main=x=>kitParts(x).find(p=>StationEquip.kindOf(p)==='compressor');
    let x=Cat.station('st_comp', [], {});
    await TzPick.run(x, { kind:'comp', flow:10, pressure:7, reserve:'0', work:0, oilFree:true });
    assert.strictEqual(main(x).name, 'Компрессор безмасляный БК-140', 'класс 0 по маслу — только безмасляный');
    x=Cat.station('st_comp', [], {});
    await TzPick.run(x, { kind:'comp', flow:10, pressure:7, reserve:'0', work:0, vsd:true });
    assert.strictEqual(main(x).name, 'Компрессор винтовой К-130 VSD', 'частотное регулирование — в приоритете');
    global.catCache=global.catCache.filter(c=>!/безмасл/i.test(c.name));
    x=Cat.station('st_comp', [], {});
    const note=await TzPick.run(x, { kind:'comp', flow:10, pressure:7, reserve:'0', work:0, oilFree:true });
    assert.ok(!main(x) && /В каталоге нет: безмасляный компрессор на/.test(note), note);
    // АВР и АСУ ТП: нет шкафов — замечания, добавляются один раз
    x=Cat.station('st_comp', [], { ats:true, scada:true });
    const warn=()=>StationReq.checks(x).filter(c=>!c.ok).map(c=>c.text);
    assert.deepStrictEqual(warn(), ['нет шкафа АВР — по ТЗ два ввода питания', 'нет шкафа АСУ ТП — по ТЗ диспетчеризация']);
    assert.deepStrictEqual(StationReq.ensureParts(x), ['Шкаф АВР (автоматический ввод резерва)', 'Шкаф АСУ ТП (автоматизация и диспетчеризация)']);
    assert.deepStrictEqual(StationReq.ensureParts(x), [], 'второй раз — ничего');
    assert.deepStrictEqual(warn(), []);
    assert.ok(kitParts(x).filter(p=>/^Шкаф/.test(p.name)).every(p=>KitScope.of(p)==='asm' && p.desc), 'шкафы — у сборщика, с описанием');
  });

  await Check.run('ДГУ: резерв и бак под время работы', async ()=>{
    global.catCache=[Cat.item('ДГУ АД-120', { cat:'dgu', kw:120 }), Cat.item('ДГУ АД-250', { cat:'dgu', kw:250 }), Cat.item('ДГУ АД-500', { cat:'dgu', kw:500 })];
    const x=Cat.station('st_dgu', [], { reserve:'1', hours:'24', kw:'200' });
    StationDefaults.add(x, 'st_dgu');
    const note=await TzPick.run(x, { kind:'dgu', kw:200, hours:24, reserve:'1', work:0 });
    const d=kitParts(x).find(z=>StationEquip.kindOf(z)==='dgu'), t=kitParts(x).find(z=>StationDefaults.FUEL.test(z.name));
    assert.deepStrictEqual([d.name, d.qty], ['ДГУ АД-250', 2], 'ДГУ 250 кВт: рабочая + резервная');
    // как в расчётной записке: нагрузка 200/250 = 80 %; расхода в паспорте нет — 0,25 л/кВт·ч · 0,8 · 250 = 50 л/ч;
    // 50 · 24 ч · 1,1 (запас) = 1320 л, бака у ДГУ нет → ближайший типовой 1500 л
    assert.strictEqual(t.rows.find(r=>r.k==='Объём').v, '1500 л', '1320 л → 1500 л');
    assert.ok(/бак 1500 л — на 24 ч при нагрузке 80 % с запасом 10 %/.test(note), note);
    const ck=StationReq.checks(x);
    // 1500 / (50 · 1,1) = 27,3 ч
    assert.ok(ck.some(c=>c.ok && /работа от баков ≈ 27 ч при нагрузке 80 % \(с запасом\) — не меньше 24/.test(c.text)), JSON.stringify(ck));
    x.req.hours='48';
    assert.ok(StationReq.checks(x).some(c=>!c.ok && /меньше 48: нужно топлива 2640 л, в баках 1500/.test(c.text)), JSON.stringify(StationReq.checks(x)));
  });

  await Check.run('насосная: два рабочих, напор без большого избытка', async ()=>{
    global.catCache=[Cat.item('Насос Н-50/35', { cat:'pump', flow:50, head:35 }), Cat.item('Насос Н-100/35', { cat:'pump', flow:100, head:35 }), Cat.item('Насос Н-50/60', { cat:'pump', flow:50, head:60 })];
    const x=Cat.station('st_pump', [], { reserve:'1' });
    await TzPick.run(x, { kind:'pump', q:90, head:30.6, reserve:'1', work:2 });
    const p=kitParts(x).find(z=>StationEquip.kindOf(z)==='pump');
    assert.deepStrictEqual([p.name, p.qty], ['Насос Н-50/35', 3], '2 рабочих по 50 м³/ч с напором 35 м + резервный');
    x.req={ q:'90', head:'30.6', reserve:'1' };
    assert.ok(StationReq.checks(x).every(c=>c.ok), JSON.stringify(StationReq.checks(x)));
    const y=Cat.station('st_pump', [], {});
    const note=await TzPick.run(y, { kind:'pump', q:500, head:30, reserve:'0', work:0 });
    assert.ok(/В каталоге нет: насос на 500 м³\/ч и 30 м/.test(note), note);
  });

  // состав компрессорной «вручную» (KitNeed, kit-view.js): к выбранному компрессору программа сама называет, чего не хватает,
  // окно каталога открывается с фильтрами по нужному, «Подобрать всё недостающее» добавляет то же, что подобрал бы TzPick
  await Check.run('состав компрессорной: чего не хватает, фильтры подбора, «Подобрать всё недостающее»', async ()=>{
    global.catCache=[
      Cat.item('Компрессор винтовой К-65', { cat:'comp_screw', flow:6.5, pressure:9.7, kw:37 }),
      Cat.item('Компрессор винтовой К-130', { cat:'comp_screw', flow:13, pressure:10, kw:75 }),
      Cat.item('Осушитель рефрижераторный ОР-5', { cat:'dryer_refrig', flow:5 }),
      Cat.item('Осушитель рефрижераторный ОР-20', { cat:'dryer_refrig', flow:20, pressure:'13' }),
      Cat.item('Осушитель рефрижераторный ОР-25 (8 бар)', { cat:'dryer_refrig', flow:25, pressure:'8' }),
      Cat.item('Фильтр ФС-20', { cat:'filter', stage:'Сверхтонкая (микрофильтр)', flow:20 }),
      Cat.item('Фильтр ФП-20', { cat:'filter', stage:'Предварительная', flow:20 }),
      Cat.item('Ресивер РВ-1000', { cat:'receiver', volume:1000, pressure:11 }),
    ];
    const toasts=[]; global.toast=t=>toasts.push(t); global.persist=()=>{}; global.renderEditor=()=>{}; global.renderForm=()=>{};
    const comp=await TzPick.part(global.catCache[1], 1, 'main'), x=Cat.station('st_comp', [comp], {}); global.S={ items:[x] };
    let R=KitNeed.recs(x);
    assert.deepStrictEqual(R.map(r=>r.key).sort(), ['dryer-refrig', 'receiver'], 'к компрессору: осушитель и ресивер — '+JSON.stringify(R.map(r=>r.key)));
    const P=KitNeed.preset(x, R.find(r=>r.key==='dryer-refrig'));
    assert.deepStrictEqual(P.min, { pressure:10 }, 'давление — не ниже компрессорного');
    assert.ok(P.r.flow && +P.r.flow[0].replace(',', '.')>13, 'производительность — с запасом и поправкой на давление: '+P.r.flow);
    assert.ok(/^Нужно: рефрижераторный осушитель не менее .* — к компрессорам 13 м³\/мин, 10 бар\. Показаны подходящие: производительность от .* м³\/мин, давление от 10 бар\.$/.test(P.need), P.need);
    assert.strictEqual(P.best && global.catCache.find(c=>c.id===P.best.id).name, 'Осушитель рефрижераторный ОР-20', 'рекомендуемый — самый маленький подходящий, на давление компрессора (8 бар — нет)');
    // окно каталога: подходящие — без маленького и без низкого давления; давление без данных не отсекается
    const F=KitNeed.filters(x, R.find(r=>r.key==='dryer-refrig')), L=pfList(F, ['dryer_refrig']).list.map(c=>c.name);
    assert.deepStrictEqual(L, ['Осушитель рефрижераторный ОР-20'], 'подходящие: '+JSON.stringify(L));
    assert.strictEqual(KitNeed.fits(global.catCache[2], P), false, 'ОР-5 — «мало»');
    assert.strictEqual(KitNeed.top('7,5 / 10 / 13 бар'), 13, 'давление «7,5 / 10 / 13» — до 13 бар');
    const rows=KitNeed.rows(x, 0);
    assert.ok(/Нужно: рефрижераторный осушитель/.test(rows) && /data-a="kitNeed" data-i="0" data-k="receiver"/.test(rows), 'строки «Нужно: …» с кнопкой «Подобрать»');
    assert.ok(/Подобрать всё недостающее \(2\)/.test(KitNeed.allBtn(x, 0)), 'одна кнопка на всё');
    // одной кнопкой: осушитель, затем фильтры до и после него, ресивер; ничего не нужно — строк нет
    await KitNeed.fillAll(0);
    const K=Cat.kinds(x).map(k=>k[0]);
    assert.ok(K.includes('dryer') && K.filter(k=>k==='filter').length===2 && K.includes('receiver'), 'добавлено: '+JSON.stringify(K)+' — '+toasts.join(' | '));
    assert.deepStrictEqual(KitNeed.recs(x).map(r=>r.key), [], 'всё на месте');
    const tt=toasts.pop();   // 13 м³/мин → около 1625 л; один при 10 бар — на учёт в Ростехнадзоре (p·V 1,6): два по 1000 л
    assert.ok(/^Добавлено: Осушитель рефрижераторный ОР-20; 2 × Ресивер РВ-1000; Фильтр ФП-20; Фильтр ФС-20$/.test(tt), tt);
    // осушитель меньше нужного — «Заменить», старый уходит из состава
    const y=Cat.station('st_comp', [await TzPick.part(global.catCache[1], 1, 'main'), await TzPick.part(global.catCache[2], 1)], {}); global.S={ items:[y] };
    const sw=KitNeed.recs(y).find(r=>r.key==='dryer-refrig');
    assert.ok(sw && sw.swap && sw.replace.length===1, 'мало — замена: '+JSON.stringify(sw));
    await KitNeed.fillAll(0);
    assert.deepStrictEqual(kitParts(y).filter(p=>StationEquip.kindOf(p)==='dryer').map(p=>p.name), ['Осушитель рефрижераторный ОР-20'], 'ОР-5 заменён');
    // компрессор по требованиям «Подбора станции»: показаны подходящие, рекомендуемый — как у «Подобрать оборудование»
    const z=Cat.station('st_comp', [], { flow:'10', pressure:'7', reserve:'1' }), M=KitNeed.mainPreset(z);
    assert.strictEqual(global.catCache.find(c=>c.id===M.best.id).name, 'Компрессор винтовой К-130', 'один на 13 м³/мин');
    assert.deepStrictEqual([M.best.n, M.qty], [2, 2], 'рабочий + резервный');
    assert.deepStrictEqual(global.catCache.filter(c=>/^comp_/.test(c.attrs.cat) && M.test(c)).map(c=>c.name), ['Компрессор винтовой К-130'], 'К-65 — мал для одного');
    assert.ok(/^Нужно 10 м³\/мин при 7 бар у потребителя \+ 1 в резерве\. Показаны компрессоры от 10 м³\/мин, давление от 7 бар\.$/.test(M.need), M.need);
    assert.strictEqual(KitNeed.mainPreset(Cat.station('st_comp', [], {})), null, 'требований нет — обычный каталог');
  });

  // ресиверы компрессорной по умолчанию — по 900 л, АСО первым (receiver.base, решение ПНЕВМОТЕХ 12.10)
  await Check.run('ресиверы: по 900 л, приоритет АСО', async ()=>{
    global.catCache=[
      Cat.item('Компрессор винтовой К-130', { cat:'comp_screw', flow:13, pressure:10, kw:75 }),
      Cat.item('Компрессор винтовой К-130/13', { cat:'comp_screw', flow:13, pressure:13, kw:75 }),
      Cat.item('Ресивер Dalgakiran РВ 900.10', { cat:'receiver', maker:'Dalgakiran', volume:900, pressure:10, size:'1000 × 1000 × 2200' }),
      Cat.item('Воздушный ресивер АСО РВ 900/11', { cat:'receiver', maker:'АСО', volume:900, pressure:11, size:'930 × 940 × 2040' }),
      Cat.item('Воздушный ресивер АСО РВ 900/10', { cat:'receiver', maker:'АСО', volume:900, pressure:10, size:'900 × 820 × 2220' }),
      Cat.item('Ресивер РВ-1000/11', { cat:'receiver', volume:1000, pressure:11 }),
      Cat.item('Ресивер РВ-2000/11', { cat:'receiver', volume:2000, pressure:11 }),
      Cat.item('Ресивер РВ-500/16', { cat:'receiver', volume:500, pressure:16 }),
    ];
    // 13 м³/мин · 125 л = 1625 л → 2 × 900 л; АСО — первым, из АСО — на наименьшее достаточное давление (10 бар)
    let R=TzPick.receivers(1625, 10, 2890);
    assert.deepStrictEqual([R.o.c.name, R.n, R.base], ['Воздушный ресивер АСО РВ 900/10', 2, true], JSON.stringify(R && [R.o.c.name, R.n]));
    R=TzPick.receivers(300, 10, 2890); assert.deepStrictEqual([R.o.c.name, R.n], ['Воздушный ресивер АСО РВ 900/10', 1], 'мало нужно — всё равно 900 л');
    R=TzPick.receivers(1625, 10, 2400); assert.strictEqual(R.o.c.name, 'Воздушный ресивер АСО РВ 900/11', 'низкий контейнер: 2220 + 300 мм не проходит — АСО пониже');
    R=TzPick.receivers(1625, 13, 2890); assert.deepStrictEqual([R.o.c.name, R.n, !!R.base], ['Ресивер РВ-500/16', 4, false], '13 бар: 900 л на учёте и не на это давление — прежний подбор без учёта');
    // состав: «Нужно: воздушные ресиверы 2 × 900 л» → АСО
    const x=Cat.station('st_comp', [await TzPick.part(global.catCache[0], 1, 'main')], {}); global.S={ items:[x] };
    const r=KitNeed.recs(x).find(z=>z.key==='receiver');
    assert.ok(r && /^Воздушные ресиверы 2 × 900 л$/.test(r.title) && /нужно около 1 625 л/.test(r.why), JSON.stringify(r));
    const P=KitNeed.preset(x, r); assert.deepStrictEqual([global.catCache.find(c=>c.id===P.best.id).name, P.best.n, P.r.volume], ['Воздушный ресивер АСО РВ 900/10', 2, ['900', '900']]);
    // подбор станции целиком — тоже по 900 л
    const y=Cat.station('st_comp', [], {});
    const note=await TzPick.run(y, { kind:'comp', flow:12, pressure:7, air:'', reserve:'0', work:0 });
    const rv=kitParts(y).filter(p=>StationEquip.kindOf(p)==='receiver').map(p=>[p.name, p.qty]);
    assert.deepStrictEqual(rv, [['Воздушный ресивер АСО РВ 900/10', 2]], JSON.stringify(rv)+' — '+note);
    assert.ok(/ресиверы 2 × Воздушный ресивер АСО РВ 900\/10 \(2 по 900 л — нужно около 1 625 л\)/.test(note), note);
  });

  // основное оборудование против требований «Подбора станции» — для всех станций; бак ДГУ под время работы
  await Check.run('«Нужно…» по требованиям: рабочие и резерв, «Заменить», бак ДГУ, подсказка', async ()=>{
    global.catCache=[
      Cat.item('Компрессор винтовой К-20', { cat:'comp_screw', flow:2, pressure:10 }),
      Cat.item('Компрессор винтовой К-65', { cat:'comp_screw', flow:6.5, pressure:10 }),
      Cat.item('Компрессор винтовой К-65/8', { cat:'comp_screw', flow:6.5, pressure:8 }),
      Cat.item('Компрессор винтовой К-130', { cat:'comp_screw', flow:13, pressure:10 }),
      Cat.item('ДГУ АД-120', { cat:'dgu', kw:120 }), Cat.item('ДГУ АД-250', { cat:'dgu', kw:250 }),
      Cat.item('Насос Н-50/35', { cat:'pump', flow:50, head:35 }), Cat.item('Насос Н-50/60', { cat:'pump', flow:50, head:60 }),
    ];
    const C=global.catCache, keys=x=>KitNeed.recs(x).map(r=>r.key);
    // компрессорная: 12 м³/мин, резерв 1 — К-65 × 1 → ещё 2 (2 рабочих + 1 резервный)
    const x=Cat.station('st_comp', [await TzPick.part(C[1], 1, 'main')], { flow:'12', reserve:'1' }); global.S={ items:[x] };
    let r=KitNeed.recs(x)[0];
    assert.deepStrictEqual([r.key, r.qty, KitNeed.head(r)], ['main-qty', 3, 'Нужно: ещё 2 × Компрессор винтовой К-65'], JSON.stringify(r));
    assert.ok(/всего 3: 2 рабоч\. \+ 1 резерв\. на 12 м³\/мин/.test(r.why), r.why);
    assert.ok(/data-k="main-qty">Добавить</.test(KitNeed.rows(x, 0)), 'кнопка «Добавить»');
    KitNeed.apply(x, r); assert.strictEqual(kitParts(x).find(p=>p.role==='main').qty, 3);
    assert.ok(!keys(x).includes('main-qty') && StationReq.checks(x).every(c=>c.ok), 'хватает: '+JSON.stringify(StationReq.checks(x)));
    // давление: компрессор 8 бар, у потребителя нужно 8,5 — «Заменить», каталог по требованиям
    const y=Cat.station('st_comp', [await TzPick.part(C[2], 2, 'main'), await TzPick.part(C[1], 1)], { flow:'6', pressure:'8,5' });
    assert.deepStrictEqual(keys(y).filter(k=>/^main/.test(k)), [], 'две модели — собрано вручную, решают проверки');
    y.kit.parts=y.kit.parts.filter(p=>p.role==='main' || p.role==='container'); r=KitNeed.recs(y)[0];
    assert.ok(r.main && r.swap && /^Заменить: компрессор — давление 8 бар меньше 8,5 бар у потребителя$/.test(KitNeed.head(r)), KitNeed.head(r));
    assert.ok(!KitNeed.fillable(y).includes(r), 'замену основного выбирает менеджер — не в «Подобрать всё»');
    const M=KitNeed.mainPreset(y); assert.ok(M.min.pressure===8.5 && M.test(C[1]) && !M.test(C[0]), 'подходящие: производительность и давление');
    // больше четырёх рабочих — мал
    const z=Cat.station('st_comp', [await TzPick.part(C[0], 1, 'main')], { flow:'12' });
    assert.ok(/^Заменить: компрессор — слишком мал: нужно 12 м³\/мин, у одного 2 \(больше 4 рабочих\)$/.test(KitNeed.head(KitNeed.recs(z)[0])), KitNeed.head(KitNeed.recs(z)[0]));
    // ДГУ: 200 кВт, резерв 1, 24 ч — ещё 2 × АД-120, затем бак (в группе сборщика)
    const g=Cat.station('st_dgu', [await TzPick.part(C[4], 1, 'main')], { kw:'200', reserve:'1', hours:'24' }); global.S={ items:[g] };
    assert.deepStrictEqual(KitNeed.recs(g).map(r=>[r.key, r.by||'our']), [['main-qty', 'our']], 'рабочих нет (1 = резерв) — бак считать не по чему');
    assert.strictEqual(KitNeed.head(KitNeed.recs(g)[0]), 'Нужно: ещё 2 × ДГУ АД-120');
    KitNeed.apply(g, KitNeed.recs(g)[0]); const t=KitNeed.recs(g)[0];
    assert.ok(t.key==='tank' && /^Нужно: топливный бак \d[\d\s]* л$/.test(KitNeed.head(t)) && /работа без дозаправки 24 ч/.test(t.why), JSON.stringify(t));
    assert.ok(/data-k="tank">Добавить</.test(KitNeed.rows(g, 0, 'asm')) && !KitNeed.rows(g, 0, 'our'), 'бак — в группе сборщика');
    assert.ok(/^топливный бак/.test(KitNeed.apply(g, t)) && !KitNeed.recs(g).length, 'бак добавлен: '+JSON.stringify(KitNeed.recs(g)));
    assert.ok(StationReq.checks(g).every(c=>c.ok), JSON.stringify(StationReq.checks(g)));
    g.req.hours='72'; const t2=KitNeed.recs(g)[0];
    assert.ok(t2 && t2.swap && /^Заменить: топливный бак .* — нужен .* л$/.test(KitNeed.head(t2)), 'мал — заменить: '+JSON.stringify(t2));
    const D=KitNeed.mainPreset(Cat.station('st_dgu', [], { kw:'200' }));
    assert.deepStrictEqual([C.find(c=>c.id===D.best.id).name, D.test(C[4]), D.test(C[5])], ['ДГУ АД-250', false, true]);
    // насосная: напор 35 м меньше 40 — «Заменить»; по требованиям — два Н-50/60
    const pz=Cat.station('st_pump', [await TzPick.part(C[6], 2, 'main')], { q:'90', head:'40' });
    assert.ok(/^Заменить: насос — напор 35 м меньше нужного 40 м$/.test(KitNeed.head(KitNeed.recs(pz)[0])), KitNeed.head(KitNeed.recs(pz)[0]));
    const Pm=KitNeed.mainPreset(pz); assert.deepStrictEqual([C.find(c=>c.id===Pm.best.id).name, Pm.best.n, Pm.test(C[6]), Pm.test(C[7])], ['Насос Н-50/60', 2, false, true]);
    // главное требование не указано, оборудование выбрано — спокойная подсказка вместо «не хватает данных»
    const q=Cat.station('st_comp', [await TzPick.part(C[1], 1, 'main')], {});
    assert.strictEqual(StationQuick.ask(q), 'Укажите производительность по ТЗ — проверим, хватает ли компрессоров');
    assert.strictEqual(StationQuick.ask(x), '', 'указано — подсказки нет');
    assert.strictEqual(StationQuick.ask(Cat.station('st_dgu', [await TzPick.part(C[4], 1, 'main')], {})), 'Укажите мощность нагрузки по ТЗ — проверим, хватает ли мощности ДГУ');
  });

  // пищевая и медицинская промышленность — компрессоры только безмасляные; масляный — по требованию заказчика
  await Check.run('отрасль: пищевая — только безмасляные, масляный по требованию', async ()=>{
    global.catCache=[
      Cat.item('Компрессор винтовой К-130', { cat:'comp_screw', flow:13, pressure:10 }),
      Cat.item('Компрессор винтовой безмасляный КБ-130', { cat:'comp_screw', flow:13, pressure:10 }),
    ];
    const C=global.catCache, x=Cat.station('st_comp', [await TzPick.part(C[0], 1, 'main')], { flow:'10', industry:'food' });
    assert.strictEqual(StationReq.oilFree(x), true, 'пищевая — безмасляный');
    const r=KitNeed.recs(x).find(z=>z.key==='main');
    assert.ok(r && /^Заменить: компрессор — масляный, а для пищевой промышленности нужен безмасляный \(класс 0 по маслу\)$/.test(KitNeed.head(r)), JSON.stringify(r));
    const M=KitNeed.mainPreset(x); assert.ok(!M.test(C[0]) && M.test(C[1]) && C.find(c=>c.id===M.best.id)===C[1] && /безмасляные \(для пищевой промышленности\)/.test(M.need), M.need);
    assert.ok(StationReq.checks(x).some(c=>!c.ok && /компрессор не безмасляный — для пищевой промышленности нужен класс 0 по маслу/.test(c.text)), JSON.stringify(StationReq.checks(x)));
    assert.ok(/пищевая отрасль · безмасляный/.test(StationReq.line(x)), StationReq.line(x));
    assert.strictEqual(StationQuick.query(x).oilFree, true, 'подбор станции — только безмасляные');
    x.req.oilOk=true;   // заказчик разрешил масляный
    assert.ok(!StationReq.oilFree(x) && !KitNeed.recs(x).some(z=>z.key==='main') && StationReq.checks(x).every(c=>!/безмасл/.test(c.text)), 'масляный по требованию — без замены');
    assert.ok(/масляный — по требованию заказчика/.test(StationReq.line(x)), StationReq.line(x));
    x.req.oilOk=false; x.req.industry='med'; assert.ok(StationReq.oilFree(x) && /медицинской и фармацевтической/.test(StationReq.oilWhy(x)));
    x.req.industry=''; assert.ok(!StationReq.oilFree(x), 'общепромышленная — без ограничения');
  });

  console.log(process.exitCode ? 'есть ошибки' : `подбор по ТЗ: проверок пройдено — ${Check.n}`);
})();
