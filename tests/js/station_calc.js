// Расчёт станции (app/web/js/features/station-calc.js) по файлу инженерных правил: каждая формула — с примером,
// посчитанным вручную (значения ниже — не из программы): стандартная атмосфера, давление насыщенного пара, перевод
// нормальных м³ в FAD, ресивер, поправки осушителя и фильтра (таблицы Dalgakiran и типовые), продувка, электрика, топливо
// ДГУ; затем расчёт целых станций: ошибки, предупреждения, «требует подтверждения», допущения, вопросы, приложение к КП.
// Запуск из корня репозитория: node tests/js/station_calc.js — код выхода 0, если всё прошло (tests/test_station_rules.py).
'use strict';
const vm=require('vm'), fs=require('fs'), path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');

global.document={ addEventListener(){} };
global.uid=(()=>{ let n=0; return ()=>'p'+(++n); })();
global.attrsOf=d=>Object.assign({}, d.attrs||{});
const TYPES={ st_comp:{ station:{ main:['comp_screw'] } }, st_dgu:{ station:{ main:['dgu'] } } };
global.typeById=id=>TYPES[id]||{};
global.catCache=[]; global.DEF=()=>null; global.FEAT={ on:()=>true };
global.esc=s=>String(s??'').replace(/[&<>"]/g, c=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
for (const f of ['logistics-calc.js', 'station-rules.js', 'station-layout.js', 'station-systems.js', 'kit.js', 'kit-view.js', 'station-calc.js', 'station-ui.js', 'tz-import.js']){
  const p=path.join(ROOT, 'app', 'web', 'js', 'features', f); vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename:p }); }
StationRules.use(JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'web', 'rules', 'stations.json'), 'utf8')));
global.isKit=x=>!!(x && x.kit);

const near=(a, b, tol, msg)=>assert.ok(Math.abs(a-b)<=tol, `${msg}: ${a} ≠ ${b} (±${tol})`);
const part=(name, attrs, qty=1, rows=[])=>Object.assign(kitNewPart({ name }), { attrs, qty, rows });
let sid=0;
const station=(cat, req, parts, air)=>({ id:'s'+(++sid), name:'', attrs:{ cat }, req, stLayout:air ? { air } : {}, kit:{ parts:[kitNewContainer('block'), ...parts] } });

class Check {
  static n=0;
  static fail(name, e){ console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; }
  static run(name, fn){ try{ const r=fn(); if (r && r.then) return r.then(()=>{ Check.n++; }, e=>Check.fail(name, e)); Check.n++; } catch(e){ Check.fail(name, e); } }
}

// ---------------------------------------------------------------- формулы
Check.run('стандартная атмосфера (ГОСТ 4401-81)', ()=>{
  // p = 101,325 · (1 − 2,25577·10⁻⁵ · H)^5,25588: 1000 м → 101,325 · 0,9774423^5,25588 = 89,875 кПа; 0 м — 101,325
  near(AirDemand.baro(1000), 89.875, 0.01, '1000 м');
  near(AirDemand.baro(500), 95.461, 0.01, '500 м');
  near(AirDemand.baro(0), 101.325, 1e-9, '0 м');
  near(AirDemand.baro(-50), 101.325, 1e-9, 'ниже уровня моря — как на уровне');
});

Check.run('давление насыщенного пара (Магнус, WMO-No. 8)', ()=>{
  // 0,6112 · exp(17,62 · 20 / (243,12 + 20)) = 0,6112 · exp(1,33931) = 2,3326 кПа (таблицы: 2,339)
  near(AirDemand.psat(20), 2.3326, 0.001, '20 °C');
  near(AirDemand.psat(35), 5.6128, 0.001, '35 °C');
  near(AirDemand.psat(0), 0.6112, 1e-9, '0 °C');
});

Check.run('нормальные м³ → FAD (ISO 1217, ГОСТ 2939-63)', ()=>{
  // сухой воздух на уровне моря при 20 °C: 10 · 101,325/101,325 · 293,15/273,15 = 10,732
  near(AirDemand.fad(10, 0, 20, 0), 10.7322, 0.0005, 'сухой, 0 м, 20 °C');
  // 500 м, 35 °C, 100 %: 10 · 101,325 / (95,461 − 5,613) · 308,15/273,15 = 10 · 1,12775 · 1,12813 = 12,722
  near(AirDemand.fad(10, 500, 35, 100), 12.722, 0.003, '500 м, 35 °C, 100 %');
});

Check.run('ресивер «нагрузка — холостой ход» (Atlas Copco)', ()=>{
  // V = 0,25 · qc · p1 · T0 / (fmax · Δp · T1): qc = 1000/60 л/с на 1 м³/мин, fmax = 1/30 с⁻¹, Δp = 1 бар → 0,25 · 16,667 · 30 = 125 л
  near(AirChain.RECV, 125, 1e-9, 'л на 1 м³/мин');
  assert.strictEqual(StationRules.raw('receiver.vsd'), 40);
});

Check.run('осушитель Dalgakiran DK: поправки производителя', ()=>{
  const p={ name:'Осушитель рефрижераторный Dalgakiran DK 1450', attrs:{ maker:'Dalgakiran', model:'DK 1450' } };
  // 8 бар → 1,04; вход 45 °C → 0,78; помещение 30 °C → 0,98: F = 1,04 · 0,78 · 0,98 = 0,79498
  let o=DryerSizing.factor(p, 8, { tin:45, amb:30 });
  assert.ok(o.s && /DK/.test(o.s.title), 'серия найдена');
  near(o.F, 0.79498, 1e-5, 'табличные точки');
  // интерполяция: 9 бар → 1,04 + (1,11 − 1,04)/2 = 1,075; вход 37,5 °C → (1 + 0,92)/2 = 0,96; 25 °C → 1: F = 1,032
  o=DryerSizing.factor(p, 9, { tin:37.5, amb:25 });
  near(o.F, 1.032, 1e-6, 'интерполяция');
  // вне таблицы: 60 °C на входе — крайнее значение 0,45 и отметка «вне таблицы» не ставится (60 есть в таблице); 65 °C — ставится
  o=DryerSizing.factor(p, 7, { tin:65, amb:25 });
  near(o.F, 0.45, 1e-9, 'за краем — крайнее значение'); assert.deepStrictEqual(o.out, ['температура входа']);
  // DK HPN — своя серия (опорное давление 40 бар), не DK
  const h=StationRules.series({ name:'Осушитель DK 50 HPN', attrs:{ maker:'Dalgakiran' } }, 'dryer');
  assert.ok(h && /HPN/.test(h.title), 'DK HPN: '+(h && h.title));
});

Check.run('осушитель без данных производителя: типовые поправки серии (требует подтверждения)', ()=>{
  const p={ name:'Осушитель ОР-20', attrs:{ maker:'Пример' } };
  // рефрижераторный — по таблице DK: 9 бар → 1,075; вход 45 °C → 0,78; помещение 30 °C → 0,98: F = 0,821730
  let o=DryerSizing.factor(p, 9, { tin:45, amb:30 }, 'refrig');
  assert.ok(o.generic && /DK/.test(o.s.title), 'типовая серия DK');
  near(o.F, 1.075*0.78*0.98, 1e-9, 'рефрижераторный');
  // адсорбционный — по таблице DA (без поправки на окружающую): 7 бар → 1; вход 40 °C → 0,8
  o=DryerSizing.factor(p, 7, { tin:40, amb:30 }, 'ads');
  assert.ok(o.generic && /DA/.test(o.s.title)); near(o.F, 0.8, 1e-9, 'адсорбционный');
  assert.strictEqual(StationRules.status('dryer.generic'), 'unconfirmed');
  // без файла типовых серий — прежняя таблица Kp ÷ запас: Kp(9) = 1,085; F = 1,085 / 1,15
  const keep=StationRules.raw('dryer.generic'); StationRules.rule('dryer.generic').value={};
  try{ o=DryerSizing.factor(p, 9, { tin:45, amb:30 }, 'refrig'); assert.strictEqual(o.s, null); near(o.F, 1.085/1.15, 1e-9, 'Kp ÷ запас'); }
  finally{ StationRules.rule('dryer.generic').value=keep; }
});

Check.run('фильтры: GON и типовая формула', ()=>{
  const s=StationRules.series({ name:'Фильтр GON 1550 MY', attrs:{ maker:'Dalgakiran', series:'GON' } }, 'filter');
  assert.ok(s, 'GON найдена');
  near(StationRules.interp(s.f.p, 9), 1.12, 1e-9, 'GON 9 бар'); near(StationRules.interp(s.f.p, 6), 0.935, 1e-9, 'GON 6 бар: (0,87 + 1)/2');
  // типовая: Kp = (p + 1)/(7 + 1), не больше 1,3: 9 бар → 1,25; 15 бар → 1,3
  near(AirChain.kf(9), 1.25, 1e-9, 'типовая 9 бар'); near(AirChain.kf(15), 1.3, 1e-9, 'типовая — потолок');
});

Check.run('продувка адсорбционного осушителя по типу регенерации', ()=>{
  assert.strictEqual(AirChain.purge('Холодная (без нагрева)'), 0.15);
  assert.strictEqual(AirChain.purge('Горячая (с нагревом)'), 0.08);
  assert.strictEqual(AirChain.purge('С воздуходувкой'), 0.02);
  assert.strictEqual(AirChain.purge(''), 0.15, 'не указан — наибольшая');
});

Check.run('электрика: ток и пуск', ()=>{
  // Iном = 75 000 / (√3 · 400 · 0,85 · 0,93) = 136,94 А; прямой пуск ×7 = 958,6 А
  const x=station('st_comp', { flow:'10', pressure:'7' }, [part('Компрессор К-75', { cat:'comp_screw', flow:12, pressure:10, kw:75 }, 1, [{ k:'Тип запуска', v:'прямой' }])]);
  const N=new CalcNote(), q=CalcInput.of(x), E=ElectricLoad.run(N, q, { power:{ inst:80, kw:80, mode:'run', amp:150, breaker:200 } });
  near(E.In, 136.94, 0.01, 'Iном'); near(E.Ist, 958.6, 0.1, 'Iпуск'); assert.strictEqual(E.how, 'direct');
  near(E.peak, 150-136.94+958.6, 0.2, 'пик: ток станции − Iном + Iпуск');
  assert.strictEqual(ElectricLoad.start({ rows:[{ k:'Способ пуска', v:'Частотный (плавный пуск через преобразователь частоты)' }], info:{} }), 'vsd', 'частотный — не «плавный»');
  assert.strictEqual(ElectricLoad.start({ rows:[{ k:'Тип запуска', v:'«Звезда–треугольник» (Y/Δ)' }], info:{} }), 'stardelta');
  assert.strictEqual(ElectricLoad.start({ rows:[{ k:'Пуск', v:'в холостом режиме' }], info:{} }), '', 'не способ пуска');
});

Check.run('ДГУ: расход топлива по строкам паспорта, бак', ()=>{
  const u={ rows:[{ k:'При нагрузке 50 %', v:'10,85 л/ч' }, { k:'При нагрузке 75 %', v:'16,28 л/ч' }, { k:'При нагрузке 100 %', v:'21,7 л/ч' }, { k:'Топливный бак', v:'230 л' }], attrs:{} };
  // 60 %: 10,85 + (16,28 − 10,85) · 0,4 = 13,022 л/ч
  near(GensetSizing.fuel(u, 0.6), 13.022, 1e-9, 'интерполяция');
  near(GensetSizing.fuel(u, 1.1), 21.7, 1e-9, 'за краем — крайнее');
  assert.strictEqual(GensetSizing.fuel({ rows:[{ k:'При нагрузке 75 %', v:'16 л/ч' }] }, 0.6), null, 'одна точка — не на нагрузке: нет данных');
  assert.strictEqual(GensetSizing.tank(u), 230);
  assert.strictEqual(GensetSizing.tank({ rows:[{ k:'Объём топливного бака', v:'1000 л' }], attrs:{} }), 1000);
});

// ---------------------------------------------------------------- станции целиком
const DK=(model, flow)=>part('Осушитель рефрижераторный Dalgakiran '+model, { cat:'dryer_refrig', maker:'Dalgakiran', model, flow, pressure:16, dewPoint:'+3' });
const GON=(model, flow, stage)=>part('Фильтр Dalgakiran '+model, { cat:'filter', maker:'Dalgakiran', model, series:'GON', flow, pressure:16, stage });

Check.run('компрессорная: всё проходит, приложение к КП', ()=>{
  const x=station('st_comp', { flow:'10', pressure:'7', basis:'fad', tmax:'+30', reserve:'1', margin:'0', alt:'0' },
    [part('Компрессор винтовой К-130', { cat:'comp_screw', maker:'Пример', flow:13, pressure:10, kw:75 }, 2, [{ k:'Тип запуска', v:'звезда-треугольник' }]),
      DK('DK 1450', 24), GON('GON 1550 MX', 25.8, 'Тонкая'), GON('GON 1550 MY', 25.8, 'Сверхтонкая (микрофильтр)'),
      part('Ресивер РВ-1000', { cat:'receiver', maker:'Пример', volume:1000, pressure:11 }), part('Ресивер РВ-900', { cat:'receiver', maker:'Пример', volume:900, pressure:11 })], '2.4.2');
  const R=StationCalc.run(x);
  assert.deepStrictEqual(R.errors, [], JSON.stringify(R.errors));
  const step=(sec, re)=>R.sections.find(s=>s.id===sec).steps.find(o=>re.test(o.what));
  // рабочий — 1 × 13 (второй — резерв) против 10: запас 30 %
  assert.strictEqual(step('air', /рабочие против/).margin, 30);
  // осушитель: p = 7 + 0,1 = 7,1 бар → 1,004; помещение 30 + 5 = 35 °C → 0,93; вход 45 °C → 0,78: 24 · 0,7283 = 17,48 м³/мин
  const d=step('dryer', /DK 1450/); assert.strictEqual(d.ok, true); assert.ok(/17,48/.test(d.result), d.result);
  // ресиверы: 13 · 125 = 1625 л, в составе 1900 л
  assert.ok(/1625 л; в составе 1900 л/.test(step('recv', /Объём ресивера/).result), step('recv', /Объём ресивера/).result);
  assert.ok(R.weak.some(w=>/Потери давления/.test(w.title)), 'потери по правилу — требует подтверждения');
  const G=StationCalc.docGroups(x);
  assert.strictEqual(G[0].name, 'Приложение. Расчётная записка и состав станции');
  assert.ok(G[0].rows.some(r=>/Компрессор винтовой К-130/.test(r.k) && r.v==='2 шт.'), 'состав станции');
  assert.ok(G.some(g=>g.name==='Расчётная записка: осушители'));
  assert.ok(kitDocItem(x).groups.some(g=>g.name==='Расчётная записка: производительность'), 'в документе КП');
  x.stLayout.calc=false; assert.deepStrictEqual(StationCalc.docGroups(x), [], 'выключено — не в КП');
});

Check.run('компрессорная: ошибки — мало производительности, осушитель, класс по маслу; согласование', ()=>{
  const x=station('st_comp', { flow:'12', pressure:'7.5', basis:'normal', alt:'900', rh:'80', tmax:'35', margin:'10', reserve:'1' },
    [part('Компрессор винтовой К-130', { cat:'comp_screw', maker:'Пример', flow:13, pressure:8, kw:75 }, 2), DK('DK 1450', 24), GON('GON 1550 MY', 25.8, 'Сверхтонкая (микрофильтр)')], '1.4.1');
  const R=StationCalc.run(x), txt=R.errors.map(e=>e.text).join(' | ');
  // 12 н. м³/мин → FAD: 900 м — 90,970 кПа; 35 °C, 80 % — 0,8 · 5,613 = 4,490 кПа: 12 · 101,325/86,480 · 1,12813 = 15,861; +10 % = 17,45 > 13
  assert.ok(/Производительность рабочих компрессоров 13 м³\/мин меньше требуемой 17,45/.test(txt), txt);
  // давление: 7,5 + 0,1 (фильтр) + 0,2 (осушитель) + 0,1 (трубы) = 7,9 ≤ 8 — не ошибка; в нижней точке 8 − 1 = 7 < 7,9 — предупреждение
  assert.ok(!/не обеспечит/.test(txt), txt);
  assert.ok(R.warnings.some(w=>/нижней точке регулирования \(7 бар\) давление ниже требуемого 7,9/.test(w.text)), R.warnings.map(w=>w.text).join(' | '));
  assert.ok(/угольный/.test(txt), 'класс 1 по маслу — угольный фильтр');
  assert.ok(StationCalc.errors(x).length>0);
  x.req.accept=true;
  assert.deepStrictEqual(StationCalc.errors(x), [], 'отклонения согласованы — КП сохраняется');
  const G=StationCalc.docGroups(x).map(g=>g.name);
  assert.ok(G.includes('Отклонения, согласованные с заказчиком'), G.join(' | '));
  // заказчику — без внутренних списков программы
  assert.ok(!G.some(n=>/Требует подтверждения|Вопросы|замечания/.test(n)), G.join(' | '));
});

Check.run('справка «Как расставляется оборудование» собирается (без удалённых констант)', ()=>{
  const t=StationUi.how(); assert.ok(/проход для оператора и обслуживания/.test(t) && /Вентиляция/.test(t) && !/undefined|NaN/.test(t), t.slice(0, 300));
});

Check.run('погрешность данных (calc.tolerance): недобор до 2 % — не ошибка, больше — ошибка', ()=>{
  assert.strictEqual(StationRules.raw('calc.tolerance'), 0.02);
  const mk=flow=>station('st_comp', { flow:'10', pressure:'7', basis:'fad', tmax:'30', margin:'0', reserve:'0', alt:'0' },
    [part('Компрессор винтовой К', { cat:'comp_screw', maker:'Пример', flow, pressure:10, kw:55 })]);
  // 9,85 против 10: недобор 1,5 % — выполняется, «на пределе», в КП — «в пределах погрешности данных»
  let x=mk(9.85), R=StationCalc.run(x), st=R.sections.find(s=>s.id==='air').steps.find(o=>/рабочие против/.test(o.what));
  assert.ok(!R.errors.some(e=>/Производительность/.test(e.text)), R.errors.map(e=>e.text).join(' | '));
  assert.strictEqual(st.ok, true); assert.strictEqual(st.margin, -1.5); assert.ok(/погрешности данных/.test(st.note), st.note);
  assert.ok(st.rules.includes('calc.tolerance'));
  const row=StationCalc.docGroups(x).find(g=>/производительность/.test(g.name)).rows.find(r=>/рабочие против/.test(r.k));
  assert.ok(/выполняется \(в пределах погрешности данных\)/.test(row.v), row.v);
  // 9,7 против 10: недобор 3 % — ошибка
  x=mk(9.7); R=StationCalc.run(x);
  assert.ok(R.errors.some(e=>/Производительность рабочих компрессоров 9,7/.test(e.text)), R.errors.map(e=>e.text).join(' | '));
});

Check.run('компрессорная без данных: вопросы и допущения, без ошибок', ()=>{
  const x=station('st_comp', {}, [part('Компрессор К', { cat:'comp_screw', maker:'Пример', flow:5, pressure:8 })]);
  const R=StationCalc.run(x);
  assert.deepStrictEqual(R.errors, []);
  assert.ok(R.questions.some(q=>/производительность станции/.test(q)), R.questions.join(' | '));
  assert.ok(R.questions.some(q=>/рабочее давление/.test(q)), 'давление — обязательный вопрос');
  // остальное — не дёргаем заказчика: значения по умолчанию, вопрос «можно уточнить позже»
  const y=station('st_comp', { flow:'10', pressure:'7' }, [part('Компрессор К', { cat:'comp_screw', maker:'Пример', flow:12, pressure:10 })]), Q=StationCalc.run(y);
  assert.deepStrictEqual(Q.questions, [], Q.questions.join(' | '));
  assert.ok(Q.later.some(q=>/Высота площадки/.test(q)) && Q.later.some(q=>/резервный компрессор/.test(q)), Q.later.join(' | '));
  assert.ok(Q.assumptions.some(a=>/принято 0 м/.test(a)));
  assert.ok(R.issues.some(i=>i.level==='info'));
});

Check.run('ДЭС: мощность, 70 % PRP, топливо, пуск двигателя', ()=>{
  const dgu=part('ДГУ Energo 200', { cat:'dgu', maker:'Energo', kw:200, kwMax:220, kva:250 }, 1,
    [{ k:'При нагрузке 50 %', v:'25 л/ч' }, { k:'При нагрузке 75 %', v:'37 л/ч' }, { k:'При нагрузке 100 %', v:'49 л/ч' }, { k:'Топливный бак', v:'300 л' }]);
  const x=station('st_dgu', { kw:'180', load:'60', hours:'24', motor:'55', start:'direct', tmax:'30' }, [dgu, part('Топливный бак 1000 л', { cat:'tank', maker:'Пример', volume:1000 })]);
  const R=StationCalc.run(x), st=(re)=>R.sections.find(s=>s.id==='dgu').steps.find(o=>re.test(o.what));
  assert.strictEqual(st(/PRP против/).ok, true); assert.strictEqual(st(/PRP против/).margin, 11.1);
  // средняя 180 · 0,6 = 108 ≤ 0,7 · 200 = 140
  assert.strictEqual(st(/Средняя нагрузка/).ok, true);
  // топливо: нагрузка 108/200 = 0,54 → 25 + (37 − 25) · 0,16 = 26,92 л/ч · 24 ч · 1,1 = 710,7 л; в баках 300 + 1000
  assert.ok(/нужно 711 л; в баках 1300 л/.test(st(/Запас топлива/).result), st(/Запас топлива/).result);
  // пуск: 7 · 55 / (0,85 · 0,93) = 487 кВА — больше 250 кВА генератора → предупреждение
  assert.ok(/487/.test(st(/Пуск наибольшего двигателя от ДГУ/).result));
  assert.ok(R.warnings.some(w=>/Пусковая мощность/.test(w.text)));
  assert.deepStrictEqual(R.errors, []);
  x.req.hours='48';   // 1421 л > 1300 л
  assert.ok(StationCalc.run(x).errors.some(e=>/Топлива в баках/.test(e.text)));
  x.req={ kw:'210', mode:'standby' };   // резервный — по ESP 220
  assert.deepStrictEqual(StationCalc.run(x).errors, [], 'ESP 220 ≥ 210');
  x.req={ kw:'210' };
  assert.ok(StationCalc.run(x).errors.some(e=>/Мощность ДГУ 200/.test(e.text)), 'PRP 200 < 210');
});

Check.run('подбор осушителя по ТЗ — с поправками производителя', ()=>{
  global.catCache=[
    { id:'c1', name:'Компрессор К-130', attrs:{ cat:'comp_screw', maker:'Пример', flow:13, pressure:10, kw:75 } },
    { id:'c2', name:'Осушитель рефрижераторный Dalgakiran DK 1450', attrs:{ cat:'dryer_refrig', maker:'Dalgakiran', model:'DK 1450', flow:24, pressure:16 } },
    { id:'c3', name:'Осушитель рефрижераторный Dalgakiran DK 1000', attrs:{ cat:'dryer_refrig', maker:'Dalgakiran', model:'DK 1000', flow:16.7, pressure:16 } },
  ];
  global.api=async u=>global.catCache.find(z=>u.endsWith('/'+encodeURIComponent(z.id)));
  const x=station('st_comp', {}, []);
  return TzPick.run(x, { kind:'comp', flow:12, pressure:7, tmax:'35', air:'', reserve:'0', work:0 }).then(note=>{
    // 13 м³/мин через осушитель; 35 + 5 = 40 °C (0,84), вход 50 °C (0,65), 7 бар (1): DK 1000 — 16,7 · 0,546 = 9,1 мало, DK 1450 — 13,1
    assert.ok(kitParts(x).some(p=>/DK 1450/.test(p.name)), note);
    assert.ok(/с поправками 13,1/.test(note), note);
  });
});

process.on('beforeExit', ()=>{ if (!process.exitCode) console.log('расчёт станции: проверок пройдено — '+Check.n); });
