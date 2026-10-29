// Сборное изделие без компоновки (features/kit/asm-item.js, 3.225.0): контейнер и оборудование из каталога → одна позиция
// КП категории станции; название, назначение, сводная таблица, параметры, фото, цена и закупка — только из карточек частей
// (чего нет — не выдумывается); станционные расчёты, компоновка и автозаполнение станции такую позицию не трогают;
// в документе — состав блоками, в экономике — закупка каждой части у своего поставщика.
// Запуск из корня репозитория: node tests/js/asm_item.js — код выхода 0, если всё прошло (tests/test_asm_item.py).
'use strict';
const path=require('path'), fs=require('fs'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');
global.document={ addEventListener(){} };
require('./web.js').load(path.join(ROOT, 'app', 'web', 'js', 'features', 'kit', 'index.js'));
EquipTypes.list=JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'equipment_types.json'), 'utf8')).types;

let n=0;
const check=(name, fn)=>{ try{ FEAT.vals={}; KpState.replace({ pricing:{ cur:'RUB', rates:{ USD:'90' } }, items:[] }); fn(); n++; } catch(e){ console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; } };

const card=(id, cat, fields)=>({ id, name:fields.name, price:fields.price || 0, priceCur:fields.priceCur || 'RUB', cost:fields.cost || 0, costCur:fields.costCur || 'RUB',
  attrs:{ cat, ...fields.attrs }, photo:fields.photo ? { src:fields.photo, w:800, h:600 } : null, gallery:fields.gallery || [],
  features:[{ label:'Назначение', text:fields.desc || '' }], groups:[{ name:'Основные', rows:fields.rows || [] }] });
const CONT=card('c1', 'other', { name:'Блок-контейнер БК-6', price:150000000, cost:120000000, photo:'/img/c1.jpg', desc:'Утеплённый блок-контейнер.',
  attrs:{ maker:'КонтСтрой', size:'6000 × 2500 × 2600', mass:2400 }, rows:[{ k:'Утепление', v:'100 мм' }],
  gallery:[{ src:'/img/c1-in.jpg', w:800, h:600, caption:'Внутри' }, { src:'/img/c1-off.jpg', on:false }] });
const PUMP=card('p1', 'pump', { name:'Насос Grundfos CR 32-4', price:50000000, cost:40000000, photo:'/img/p1.jpg', desc:'Вертикальный многоступенчатый насос.',
  attrs:{ maker:'Grundfos', model:'CR 32-4', flow:32, head:60, kw:7.5, mass:120 }, rows:[{ k:'Подача', v:'32 м³/ч' }] });
const DGU=card('g1', 'dgu', { name:'ДГУ ТСС АД-30', price:1000000, priceCur:'USD', cost:800000, costCur:'USD', photo:'/img/g1.jpg',
  attrs:{ maker:'ТСС', model:'АД-30', kw:30, mass:900 } });
const PISTON=card('k1', 'comp_piston', { name:'Компрессор поршневой К-1000', price:30000000, photo:'/img/k1.jpg', attrs:{ maker:'Завод', model:'К-1000', flow:1000, pressure:10, kw:7.5 } });

function pumpInput(){
  const parts=[AsmItem.part(CONT, 'container'), AsmItem.part(PUMP, 'main'), AsmItem.part(DGU, '')];
  parts[1].qty=2;
  return { cat:'st_pump', parts, name:'', price:0, photo:'', work:{ name:'', price:5000000, cost:3000000 } };
}

check('элемент из карточки: цена продажи, валюта и картинки галереи (без выключенных)', ()=>{
  const part=AsmItem.part(CONT, 'container');
  assert.strictEqual(part.role, 'container');
  assert.strictEqual(part.price, 150000000);
  assert.strictEqual(part.cost, 120000000);
  assert.deepStrictEqual(part.pics.map(pic=>pic.src), ['/img/c1-in.jpg']);
  assert.strictEqual(part.attrs.size, '6000 × 2500 × 2600');
});

check('насосная с ДГУ: название, параметры, сводная таблица, назначение, фото, работы', ()=>{
  const item=KpState.newItem();
  const input=pumpInput();
  input.price=AsmItem.sums(input.parts).sale;
  AsmItem.fill(item, input);
  assert.strictEqual(item.name, 'Модульная насосная станция Grundfos CR 32-4 с ДГУ в контейнере');
  assert.ok(Kit.simple(item) && Kit.has(item));
  assert.strictEqual(item.attrs.cat, 'st_pump');
  assert.strictEqual(item.attrs.maker, 'Grundfos');
  assert.strictEqual(item.attrs.flow, 32, 'подача одного агрегата, без умножения');
  assert.strictEqual(item.attrs.head, 60);
  assert.strictEqual(item.attrs.kw, 15, 'установленная — насосы × 2, ДГУ автономности не потребитель');
  assert.strictEqual(item.attrs.size, '6000 × 2500 × 2600');
  assert.strictEqual(item.attrs.mass, 2400+120*2+900, 'масса — сумма, известна у всех частей');
  const rows=Object.fromEntries(item.groups[0].rows.map(row=>[row.k, row.v]));
  assert.strictEqual(item.groups[0].name, AsmItem.SUMMARY);
  assert.strictEqual(rows['Насосный агрегат'], 'Насос Grundfos CR 32-4 × 2');
  assert.strictEqual(rows['Подача (одного агрегата)'], '32 м³/ч');
  assert.strictEqual(rows['Установленная мощность оборудования'], '15 кВт');
  assert.strictEqual(rows['Автономное электроснабжение'], 'ДГУ ТСС АД-30');
  assert.strictEqual(rows['Габариты контейнера (Д × Ш × В)'], '6000 × 2500 × 2600 мм');
  assert.strictEqual(rows['Масса изделия (сумма составных частей)'], '3540 кг');
  const purpose=item.features.find(feat=>feat.id===AsmItem.PURPOSE_ID);
  assert.match(purpose.text, /готовое изделие для перекачки/);
  assert.match(purpose.text, /Автономное электроснабжение — ДГУ ТСС АД-30/);
  assert.strictEqual(item.photo.src, '/img/c1.jpg', 'главное фото по умолчанию — контейнер');
  assert.deepStrictEqual(item.gallery.map(pic=>pic.src), ['/img/c1-in.jpg']);
  assert.strictEqual(item.price, 150000000+50000000*2+1000000*90, 'цена — сумма частей в валюте КП');
  assert.strictEqual(item.cost, 120000000+40000000*2+800000*90, 'закупка — сумма частей в рублях');
  const work=item.options.find(option=>option.id===AsmItem.WORK_ID);
  assert.deepStrictEqual([work.name, work.price, work.cost], [AsmItem.WORK_NAME, 5000000, 3000000]);
  assert.match(item.spec, /32 м³\/ч/);
});

check('масса не у всех частей — суммы нет; неизвестное не выдумывается', ()=>{
  const item=KpState.newItem();
  const input=pumpInput();
  delete input.parts[2].attrs.mass;
  input.parts[1].attrs.kw='';
  AsmItem.fill(item, input);
  assert.strictEqual(item.attrs.mass, undefined);
  assert.strictEqual(item.attrs.kw, undefined, 'мощность известна не у всех насосов — установленной нет');
  assert.ok(!item.groups[0].rows.some(row=>/Масса изделия|Установленная/.test(row.k)));
  assert.ok(item.groups[0].rows.some(row=>row.k==='Масса контейнера'), 'масса контейнера — из его карточки');
});

check('компрессорная: поршневой в л/мин → производительность станции в м³/мин', ()=>{
  const item=KpState.newItem();
  AsmItem.fill(item, { cat:'st_comp', parts:[AsmItem.part(CONT, 'container'), AsmItem.part(PISTON, '')], name:'', price:0, photo:'', work:null });
  assert.strictEqual(AsmItem.main('st_comp', Kit.parts(item)).name, PISTON.name, 'основное — по категориям станции');
  assert.strictEqual(item.attrs.flow, 1);
  assert.strictEqual(item.attrs.pressure, 10);
  assert.ok(!item.options.some(option=>option.id===AsmItem.WORK_ID));
});

check('станционные механизмы позицию не трогают', ()=>{
  const item=KpState.newItem();
  AsmItem.fill(item, pumpInput());
  const before=JSON.stringify(item);
  StationAuto.fill(item);
  StationName.apply(item);
  assert.strictEqual(JSON.stringify(item), before, 'автозаполнение станции — без изменений');
  assert.strictEqual(Kit.station(item), null);
  assert.strictEqual(StationUi.enabled(item), false, 'нет компоновки');
  assert.strictEqual(StationPurpose.feature(item), null);
  assert.deepStrictEqual(StationCalc.docGroups(item), []);
});

check('документ: назначение, состав блоками с фото, сводная и таблицы частей; экономика — строки частей', ()=>{
  const item=KpState.newItem();
  AsmItem.fill(item, pumpInput());
  const doc=KitDoc.item(item);
  assert.strictEqual(doc.features[0].id, AsmItem.PURPOSE_ID);
  assert.ok(doc.features.some(feat=>feat.label==='Насос Grundfos CR 32-4 × 2' && /многоступенчатый/.test(feat.text)));
  assert.deepStrictEqual(doc.groups.map(group=>group.name), [AsmItem.SUMMARY, 'Блок-контейнер БК-6', 'Насос Grundfos CR 32-4']);
  assert.ok(doc.gallery.some(pic=>pic.src==='/img/p1.jpg'));
  const data=KitDoc.data(item);
  assert.strictEqual(data.parts.length, 3);
  assert.strictEqual(data.base.groups[0].name, AsmItem.SUMMARY);
  S.items=[item];
  const lines=KitDoc.lines(S).map(line=>[line.name, line.qty, line.cost, line.costCur, line.maker]);
  assert.deepStrictEqual(lines.slice(0, 3), [
    ['Блок-контейнер БК-6', 1, 120000000, 'RUB', 'КонтСтрой'],
    ['Насос Grundfos CR 32-4', 2, 40000000, 'RUB', 'Grundfos'],
    ['ДГУ ТСС АД-30', 1, 800000, 'USD', 'ТСС'],
  ]);
  assert.ok(KitDoc.lines(S).some(line=>line.name===AsmItem.WORK_NAME), 'работы — своей строкой закупки');
});

check('правка состава: свои блоки менеджера остаются, назначение и сводная — заново', ()=>{
  const item=KpState.newItem();
  AsmItem.fill(item, pumpInput());
  item.features.push({ id:'own', label:'Гарантия', text:'24 месяца' });
  item.groups.push({ name:'Своя таблица', rows:[{ k:'Цвет', v:'RAL 7035' }] });
  item.attrs.purpose='Водоснабжение';
  const input=pumpInput();
  input.parts.splice(2, 1);
  input.name='Насосная станция для заказчика';
  AsmItem.fill(item, input);
  assert.strictEqual(item.name, 'Насосная станция для заказчика');
  assert.strictEqual(item.features.filter(feat=>feat.id===AsmItem.PURPOSE_ID).length, 1);
  assert.ok(item.features.some(feat=>feat.id==='own'));
  assert.deepStrictEqual(item.groups.map(group=>group.name), [AsmItem.SUMMARY, 'Своя таблица']);
  assert.ok(!/ДГУ/.test(item.features[0].text), 'ДГУ убрали — в назначении её нет');
  assert.strictEqual(item.attrs.purpose, 'Водоснабжение', 'своё значение параметра остаётся');
});

check('каталог: состав с признаком сборного изделия', ()=>{
  const item=KpState.newItem();
  AsmItem.fill(item, pumpInput());
  item.kit.parts[0]._costText='1';
  const stored=Kit.store(item);
  assert.strictEqual(stored.simple, true);
  assert.strictEqual(stored.parts.length, 3);
  assert.ok(!('_costText' in stored.parts[0]));
  assert.ok(!('simple' in Kit.store({ kit:{ parts:[{ id:'x', name:'x' }] } })), 'у станции — как раньше');
});

check('без курса валюты — часть без цены в сумме и списком', ()=>{
  S.pricing.rates={};
  const sums=AsmItem.sums(pumpInput().parts);
  assert.deepStrictEqual(sums.noRate, ['ДГУ ТСС АД-30']);
  assert.strictEqual(sums.sale, 150000000+50000000*2);
});


check('проверка ИИ по данным: чужие числа, производитель и модель не проходят', ()=>{
  const known=AsmFacts.known(['Подача 32 м³/ч, напор 64 м; масса 2 600 кг; габариты 6000 × 2500 × 2700']);
  assert.ok(AsmFacts.ok('2600 кг', known), 'тысячи с пробелом — то же число');
  assert.ok(AsmFacts.ok('32 м³/ч, 2 агрегата', known), 'небольшие целые — количество');
  assert.ok(!AsmFacts.ok('40 м³/ч', known));
  assert.strictEqual(AsmFacts.keep('Подача 32 м³/ч. Запас 15 %. Напор 64 м.', known), 'Подача 32 м³/ч. Напор 64 м.');
  assert.strictEqual(AsmFacts.word('Grundfos', 'насос grundfos cr'), 'Grundfos');
  assert.strictEqual(AsmFacts.word('Wilo', 'насос grundfos cr'), '');
});

check('описание и сводные ИИ: только известные блоки и строки с числами из данных', ()=>{
  const known=AsmFacts.known([AsmAi.source(pumpInput().parts)]);
  const out=AsmAi.clean({ blocks:[{ label:'Назначение', text:'Станция подаёт 32 м³/ч. Работает 50 лет.' }, { label:'Реклама', text:'Лучшая!' }],
    rows:[{ k:'Подача', v:'32 м³/ч' }, { k:'КПД', v:'78 %' }, { k:'', v:'1' }] }, known);
  assert.deepStrictEqual(out.blocks, [{ label:'Назначение', text:'Станция подаёт 32 м³/ч.' }]);
  assert.deepStrictEqual(out.rows, [{ k:'Подача', v:'32 м³/ч' }]);
  assert.throws(()=>AsmAi.json('не json'), /не данными/);
  assert.deepStrictEqual(AsmAi.json('```json\n{"a":1}\n```'), { a:1 });
});

check('ответ ИИ — в изделие, пока состав тот же', ()=>{
  const input=pumpInput();
  input.ai={ blocks:[{ label:'Назначение', text:'Изделие для водоснабжения.' }, { label:'Устройство', text:'Насосы в контейнере.' }],
    rows:[{ k:'Подача одного насоса', v:'32 м³/ч' }], sig:AsmItem.sig(input.parts) };
  const item=KpState.newItem();
  item.features=[{ id:'own', label:'Гарантия', text:'24 месяца' }];
  AsmItem.fill(item, input);
  assert.deepStrictEqual(item.features.map(feat=>feat.label), ['Назначение', 'Устройство', 'Гарантия']);
  assert.deepStrictEqual(item.groups[0].rows.map(row=>row.k), ['Подача одного насоса']);
  assert.ok(item.kit.ai, 'ответ хранится в изделии — для правки');
  const again=pumpInput(); again.parts[1].qty=3; again.ai=input.ai;
  AsmItem.fill(item, again);
  assert.strictEqual(item.features[0].id, AsmItem.PURPOSE_ID, 'состав изменился — назначение по правилам');
  assert.ok(!item.kit.ai);
  assert.deepStrictEqual(item.features.map(feat=>feat.label), ['Назначение', 'Гарантия'], 'блоки прежнего ответа убраны');
  assert.strictEqual(item.groups[0].rows[0].k, 'Насосный агрегат');
});

check('документ: у сборного изделия — признак «сначала изделие целиком»', ()=>{
  const item=KpState.newItem();
  AsmItem.fill(item, pumpInput());
  assert.strictEqual(KitDoc.data(item).base.asm, true);
  assert.ok(!('asm' in KitDoc.data({ kit:{ parts:[{ id:'x', name:'x' }] }, attrs:{} }).base), 'у прежних сборок — без изменений');
});

check('части из техничек: категория, параметры, производитель и фото — только из файла', ()=>{
  const read=[
    { name:'bk.pdf', text:'Блок-контейнер БК-6000 «КонтСтрой». Габариты 6000 × 2500 × 2700 мм. Масса 2600 кг.', imgs:['data:image/png;base64,AAA'] },
    { name:'pump.docx', text:'Насос Grundfos CR 32-4: подача 32 м³/ч, напор 64 м, мощность 7,5 кВт. Цена 620 000 руб.', imgs:[] },
  ];
  const answer={ parts:[
    { role:'container', file:1, name:'Блок-контейнер БК-6000', maker:'КонтСтрой', model:'БК-6000', cat:'other', qty:1, cost:999, costCur:'XXX', attrs:{ kw:'15' }, rows:[{ k:'Масса', v:'2600 кг' }, { k:'Утепление', v:'150 мм' }], desc:'Утеплённый контейнер. Срок службы 25 лет.' },
    { role:'main', file:2, name:'Насос Grundfos CR 32-4', maker:'Grundfos', model:'CR 32-5', cat:'pump', qty:2, attrs:{ flow:'32', head:'64', kw:'7,5', medium:'вода' }, rows:[{ k:'Подача', v:'32 м³/ч' }], desc:'', cost:'620 000', costCur:'RUB' },
    { role:'power', file:2, name:'', cat:'dgu' },
    { role:'хлам', file:9, name:'Шкаф', cat:'нет такой', qty:99 },
  ] };
  const parts=AsmAi.parts(answer, read, 'st_pump');
  assert.strictEqual(parts.length, 3, 'без названия — не часть');
  const [cont, pump, other]=parts;
  assert.strictEqual(cont.role, 'container');
  assert.deepStrictEqual(cont.doc.attrs, { cat:'other', maker:'КонтСтрой', model:'БК-6000' }, 'чужое число параметра не ставится');
  assert.deepStrictEqual(cont.doc.groups[0].rows, [{ k:'Масса', v:'2600 кг' }]);
  assert.deepStrictEqual(cont.doc.features, [{ label:'Описание', text:'Утеплённый контейнер.' }]);
  assert.strictEqual(cont.doc.photo.src, 'data:image/png;base64,AAA', 'фото из своего файла');
  assert.strictEqual(pump.role, 'main');
  assert.strictEqual(pump.qty, 2);
  assert.strictEqual(pump.doc.attrs.model, undefined, 'модели CR 32-5 в файле нет');
  assert.strictEqual(pump.doc.attrs.flow, 32);
  assert.strictEqual(pump.doc.attrs.kw, 7.5);
  assert.strictEqual(pump.doc.photo, null);
  assert.deepStrictEqual([pump.doc.cost, pump.doc.costCur], [62000000, 'RUB'], 'закупка из КП поставщика');
  assert.strictEqual(cont.doc.cost, 0, 'цены нет в файле — закупки нет');
  assert.deepStrictEqual([other.role, other.doc.attrs.cat, other.qty, other.file], ['', 'other', AsmAi.QTY_MAX, 1]);
  assert.match(AsmAi.filesPrompt('st_pump', read), /ФАЙЛ 2: pump\.docx/);
  assert.match(AsmAi.describePrompt('st_pump', pumpInput().parts), /Установленная мощность оборудования — 15 кВт/);
});

check('выключатели: без нейросети кнопок ИИ нет', ()=>{
  AiDirect.state.enabled=false;
  assert.ok(!AsmAi.enabled() && !AsmAi.filesEnabled());
  AiDirect.state.enabled=true;
  assert.ok(AsmAi.enabled() && AsmAi.filesEnabled());
  FEAT.vals={ asmAi:false, asmFiles:false };
  assert.ok(!AsmAi.enabled() && !AsmAi.filesEnabled());
  AiDirect.state.enabled=false;
});


check('титул: сборное изделие — своим названием, станции и обычные позиции — как раньше', ()=>{
  const item=KpState.newItem();
  AsmItem.fill(item, pumpInput());
  const hint=CoverHint.of(item);
  assert.deepStrictEqual([hint.title, hint.model], ['Модульная насосная станция', 'Grundfos CR 32-4 с ДГУ в контейнере']);
  item.name='Насосная станция для водоканала';
  assert.strictEqual(CoverHint.of(item).model, 'Насосная станция для водоканала', 'название не с вида — целиком');
  const pump={ name:'Насос', attrs:{ cat:'pump', maker:'Grundfos', model:'CR 32-4' } };
  S.items=[item, pump];
  assert.deepStrictEqual(KpModels.list().map(row=>row.model), ['Насосная станция для водоканала', 'Grundfos CR 32-4']);
  assert.deepStrictEqual([CoverHint.of(pump).title, CoverHint.of(pump).model], ['Насосное оборудование', 'Grundfos CR 32-4']);
  const station={ name:'Станция', attrs:{ cat:'st_pump' }, kit:{ parts:[{ id:'m', name:'Насос', role:'main', attrs:{ cat:'pump', maker:'Grundfos', model:'CR 32-4' } }] } };
  assert.deepStrictEqual([CoverHint.of(station).title, CoverHint.of(station).model], ['Модульная насосная станция в блок-контейнере', 'Grundfos CR 32-4']);
});

check('способы создания станции — две карточки; «Сборное изделие» выключено — их нет', ()=>{
  const html=StationWays.html('st_pump', 'layout');
  assert.match(html, /nw-way on" aria-current="true"[^>]*><i[^>]*>⚙/);
  assert.match(html, /data-asmnew="st_pump"/);
  assert.ok(!/data-asmway/.test(html), 'открытый способ не нажимается');
  assert.match(StationWays.html('st_comp', 'asm'), /data-asmway="st_comp"/);
  FEAT.vals={ asmItem:false };
  assert.strictEqual(StationWays.html('st_pump', 'layout'), '');
});

if (!process.exitCode) console.log('Сборное изделие: проверок '+n+' — все прошли');
