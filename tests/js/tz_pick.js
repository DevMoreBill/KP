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
const TYPES={ st_comp:{ station:{ main:['comp_screw', 'comp_piston'] } }, st_pump:{ station:{ main:['pump'] } }, st_dgu:{ station:{ main:['dgu'] } } };
global.typeById=id=>TYPES[id]||{};
global.catCache=[];
global.DEF=()=>null;   // умолчания администратора — нет
global.api=async u=>{ const c=global.catCache.find(z=>u.endsWith('/'+encodeURIComponent(z.id))); if (!c) throw new Error('нет '+u); return c; };
for (const f of ['logistics-calc.js', 'station-layout.js', 'kit.js', 'kit-view.js', 'station-ui.js', 'tz-import.js']){
  const p=path.join(ROOT, 'app', 'web', 'js', 'features', f); vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename:p }); }

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
      Cat.item('Осушитель адсорбционный ОА-16', { cat:'dryer_ads', flow:16, dewPoint:'−40' }),
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
    assert.deepStrictEqual([ro.name, ro.qty], ['Ресивер РВ-2000', 1], 'снаружи высота не ограничена — один на 2000 л');
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

  await Check.run('фильтры без поля «Ступень очистки» — по названию', async ()=>{
    global.catCache=[
      Cat.item('Компрессор винтовой К-130', { cat:'comp_screw', flow:13, pressure:10, kw:75 }),
      Cat.item('Осушитель адсорбционный ОА-16', { cat:'dryer_ads', flow:16, dewPoint:'−40' }),
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
    assert.strictEqual(t.rows.find(r=>r.k==='Объём').v, '1500 л', '250 кВт × 0,75 × 0,25 л/кВт·ч × 24 ч ≈ 1125 л → 1500 л');
    assert.ok(/бак 1500 л — на 24 ч/.test(note), note);
    const ck=StationReq.checks(x);
    assert.ok(ck.some(c=>c.ok && /работа от бака ≈ 32 ч при нагрузке 75 % — не меньше 24/.test(c.text)), JSON.stringify(ck));
    x.req.hours='48';
    assert.ok(StationReq.checks(x).some(c=>!c.ok && /меньше 48: нужен бак около 3000 л/.test(c.text)), JSON.stringify(StationReq.checks(x)));
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

  console.log(process.exitCode ? 'есть ошибки' : `подбор по ТЗ: проверок пройдено — ${Check.n}`);
})();
