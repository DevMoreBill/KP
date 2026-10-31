// Расчёт станции (app/web/js/features/calc/) по файлу инженерных правил: каждая формула — с примером,
// посчитанным вручную (значения ниже — не из программы): стандартная атмосфера, давление насыщенного пара, перевод
// нормальных м³ в FAD, ресивер, поправки осушителя и фильтра (таблицы Dalgakiran и типовые), продувка, электрика, топливо
// ДГУ; затем расчёт целых станций: ошибки, предупреждения, «требует подтверждения», допущения, вопросы, приложение к КП.
// Запуск из корня репозитория: node tests/js/station_calc.js — код выхода 0, если всё прошло (tests/test_station_rules.py).
'use strict';
const vm=require('vm'), fs=require('fs'), path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..'), WebScripts=require('./web.js');

global.document={ addEventListener(){} };
const TYPES={ st_comp:{ item:'Компрессорная станция', station:{ main:['comp_screw'] } }, st_dgu:{ item:'Дизельная электростанция', station:{ main:['dgu'] } } };
for (const f of ['deal/index.js', 'rules/index.js', 'layout/index.js', 'calc/index.js', 'kit/index.js', 'req/index.js', 'tz/index.js', 'station/index.js']){
  WebScripts.load(path.join(ROOT, 'app', 'web', 'js', 'features', f)); }
// окружение расчёта: номера позиций по порядку, разбор — только поля карточки, свои типы оборудования, без «Значений программы»
{ let n=0; Uid.next=()=>'p'+(++n); }
Attrs.of=d=>Object.assign({}, d.attrs||{});
ItemSpec.mainLine=x=>{ const a=x.attrs||{}; return [a.flow!=null ? a.flow+' м³/мин' : '', a.pressure!=null ? a.pressure+' бар' : ''].filter(Boolean).join(' · '); };
EquipTypes.byId=id=>TYPES[id]||{};
Catalog.cache=[]; DefRegistry.value=()=>null; FEAT.on=()=>true;
StationRules.use(JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'web', 'rules', 'stations.json'), 'utf8')));
const GOLDEN=process.env.KP_GOLDEN ? require('./golden.js') : null;   // слепок для station_golden.js
if (GOLDEN){ Spoiler.attr=k=>` data-sp="${k}"`;   // заглушка, как при записи слепка (настоящий Spoiler — в station/index.js)
  const run0=StationCalc.run; let inHtml=false;   // расчётная записка на экране — по каждому расчёту
  StationCalc.run=function(x, ...rest){ const out=run0.call(this, x, ...rest); if (!inHtml){ inHtml=true;
    try{ GOLDEN.put('StationCalc.html', StationCalc.html(x)); } catch(e){ GOLDEN.put('StationCalc.html', 'ошибка: '+e.message); } finally{ inHtml=false; } } return out; };
  GOLDEN.wrap(StationCalc, ['run', 'docGroups']); process.on('exit', ()=>GOLDEN.save(process.env.KP_GOLDEN)); }

const near=(a, b, tol, msg)=>assert.ok(Math.abs(a-b)<=tol, `${msg}: ${a} ≠ ${b} (±${tol})`);
const part=(name, attrs, qty=1, rows=[])=>Object.assign(Kit.newPart({ name }), { attrs, qty, rows });
let sid=0;
const station=(cat, req, parts, air)=>({ id:'s'+(++sid), name:'', attrs:{ cat }, req, stLayout:air ? { air, calc:true } : { calc:true }, kit:{ parts:[ContainerPart.create('block'), ...parts] } });   // приложение «Расчётная записка» — с галочкой (в ТКП по умолчанию его нет)

class Check {
  static n=0;
  static fail(name, e){ console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; }
  static run(name, fn){ if (GOLDEN) GOLDEN.label=name; try{ const r=fn(); if (r && r.then) return r.then(()=>{ Check.n++; }, e=>Check.fail(name, e)); Check.n++; } catch(e){ Check.fail(name, e); } }
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

Check.run('ресивер: правило методики ПНЕВМОТЕХ (receiver.method)', ()=>{
  // 10–15 циклов в час: V = Q / (8 · ΔP); буфер 0,25 · Q (винтовой), 1 · Q (поршневой); ряд 900 / 500 л
  const M=ReceiverPlan.METHOD; assert.deepStrictEqual([M.cycles, M.base.screw, M.base.piston, M.unit, M.small, M.excess, M.low], [8, 0.25, 1, 900, 500, 2, 0.8]);
  assert.strictEqual(StationRules.raw('pressure.band'), 1, 'ΔP по умолчанию — 1 бар');
});

Check.run('осушитель Dalgakiran DK: поправки производителя', ()=>{
  const p={ name:'Осушитель рефрижераторный Dalgakiran DK 1450', attrs:{ maker:'Dalgakiran', model:'DK 1450' } };
  // 8 бар → 1,04; вход 45 °C → 0,78; помещение 30 °C → 0,98: F = 1,04 · 0,78 · 0,98 = 0,79498
  let o=DryerDerate.factor(p, 8, { tin:45, amb:30 });
  assert.ok(o.s && /DK/.test(o.s.title), 'серия найдена');
  near(o.F, 0.79498, 1e-5, 'табличные точки');
  // интерполяция: 9 бар → 1,04 + (1,11 − 1,04)/2 = 1,075; вход 37,5 °C → (1 + 0,92)/2 = 0,96; 25 °C → 1: F = 1,032
  o=DryerDerate.factor(p, 9, { tin:37.5, amb:25 });
  near(o.F, 1.032, 1e-6, 'интерполяция');
  // вне таблицы: 60 °C на входе — крайнее значение 0,45 и отметка «вне таблицы» не ставится (60 есть в таблице); 65 °C — ставится
  o=DryerDerate.factor(p, 7, { tin:65, amb:25 });
  near(o.F, 0.45, 1e-9, 'за краем — крайнее значение'); assert.deepStrictEqual(o.out, ['температура входа']);
  // DK HPN — своя серия (опорное давление 40 бар), не DK
  const h=StationRules.series({ name:'Осушитель DK 50 HPN', attrs:{ maker:'Dalgakiran' } }, 'dryer');
  assert.ok(h && /HPN/.test(h.title), 'DK HPN: '+(h && h.title));
});

Check.run('осушитель EXELUTE XRD: номинал при точке росы +10 °C — поправка серии 0,70 на +3 °C', ()=>{
  // каталог EXELUTE 2026: 8 бар → 1,04; вход 40 °C → 0,96; помещение 30 °C → 1,06; F4 (+3 °C) = 0,70:
  // F = 1,04 · 0,96 · 1,06 · 0,70 = 0,7408128
  const p={ name:'Рефрижераторный осушитель EXELUTE XRD 100', attrs:{ maker:'EXELUTE', model:'XRD 100' } };
  const o=DryerDerate.factor(p, 8, { tin:40, amb:30 });
  assert.ok(o.s && /XRD 13–130/.test(o.s.title), 'серия XRD: '+(o.s && o.s.title));
  near(o.kc, 0.7, 1e-12, 'поправка серии'); near(o.F, 1.04*0.96*1.06*0.7, 1e-9, 'F с поправкой серии');
  // XRD P — своя серия (вход до 60 °C), XHD/XED — адсорбционные; у DK поправки серии нет (kc = 1)
  assert.ok(/XRD P/.test(StationRules.series({ name:'Осушитель EXELUTE XRD 460 P', attrs:{ maker:'EXELUTE' } }, 'dryer').title));
  assert.strictEqual(DryerDerate.factor({ name:'Осушитель Dalgakiran DK 100', attrs:{ maker:'Dalgakiran', model:'DK 100' } }, 7, { tin:35, amb:25 }).kc, 1);
});

Check.run('осушитель без данных производителя: типовые поправки серии (требует подтверждения)', ()=>{
  const p={ name:'Осушитель ОР-20', attrs:{ maker:'Пример' } };
  // рефрижераторный — по таблице DK: 9 бар → 1,075; вход 45 °C → 0,78; помещение 30 °C → 0,98: F = 0,821730
  let o=DryerDerate.factor(p, 9, { tin:45, amb:30 }, 'refrig');
  assert.ok(o.generic && /DK/.test(o.s.title), 'типовая серия DK');
  near(o.F, 1.075*0.78*0.98, 1e-9, 'рефрижераторный');
  // адсорбционный — по таблице DA (без поправки на окружающую): 7 бар → 1; вход 40 °C → 0,8
  o=DryerDerate.factor(p, 7, { tin:40, amb:30 }, 'ads');
  assert.ok(o.generic && /DA/.test(o.s.title)); near(o.F, 0.8, 1e-9, 'адсорбционный');
  assert.strictEqual(StationRules.status('dryer.generic'), 'unconfirmed');
  // без файла типовых серий — прежняя таблица Kp ÷ запас: Kp(9) = 1,085; F = 1,085 / 1,15
  const keep=StationRules.raw('dryer.generic'); StationRules.rule('dryer.generic').value={};
  try{ o=DryerDerate.factor(p, 9, { tin:45, amb:30 }, 'refrig'); assert.strictEqual(o.s, null); near(o.F, 1.085/1.15, 1e-9, 'Kp ÷ запас'); }
  finally{ StationRules.rule('dryer.generic').value=keep; }
});

Check.run('фильтры: GON и типовая формула', ()=>{
  const s=StationRules.series({ name:'Фильтр GON 1550 MY', attrs:{ maker:'Dalgakiran', series:'GON' } }, 'filter');
  assert.ok(s, 'GON найдена');
  near(StationRules.interp(s.f.p, 9), 1.12, 1e-9, 'GON 9 бар'); near(StationRules.interp(s.f.p, 6), 0.935, 1e-9, 'GON 6 бар: (0,87 + 1)/2');
  // типовая: Kp = (p + 1)/(7 + 1), не больше 1,3: 9 бар → 1,25; 15 бар → 1,3
  near(AirChain.filterK(9), 1.25, 1e-9, 'типовая 9 бар'); near(AirChain.filterK(15), 1.3, 1e-9, 'типовая — потолок');
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

// ---------------------------------------------------------------- вентиляция: пример «винтовой 75 кВт» (docs/vent-calc.md)
Check.run('вентиляция: пример — винтовой 75 кВт, 20-футовый контейнер 6,06 × 2,44 × 2,59, лето +30/+40, зима −25/+5', ()=>{
  const W=[], V=6.06*2.44*2.59, A=2*(6.06*2.44+6.06*2.59+2.44*2.59), U=StationRules.raw('heat.bridge').block/(StationRules.raw('heat.rsurf')+0.1/StationRules.raw('heat.lambda'));
  // U по утеплителю 100 мм (как в расчёте отопления): 1,15 / (0,17 + 0,1 / 0,045) = 0,481 Вт/(м²·°C)
  near(U, 0.4807, 0.0001, 'U'); near(V, 38.297, 0.001, 'объём, м³'); near(A, 73.603, 0.001, 'площадь ограждений, м²');
  const inp={ units:[{ key:'c1', pos:1, type:'screw', kw:75 }], qRoom:0, use:0, V, tSum:30, tWin:-25, tInMin:5, ex:{} };
  const S=VentCalc.summer(inp, W);
  // 1. Q = N·k = 75 · 1,05 = 78,75 → 78,8 кВт (k — vent.k_heat: Kaeser, КПД IE3; было 0,9); 2. Δt помещения = 40 − 30 = 10 °C;
  //    ρ(30) = 353 / 303 = 1,165 кг/м³
  assert.strictEqual(S.units[0].k, 1.05); assert.strictEqual(S.Qc, 78.8); assert.strictEqual(S.dt, 10); assert.strictEqual(S.rho, 1.165);
  // 3. воздух охлаждения — вентилятором компрессора, нагрев в нём Δt_к = 15 °C (heat.cool_dt; горячий — воздуховодом наружу):
  //    L = 78,75 · 3600 / (1,005 · 1,16502 · 15) = 283 500 / 17,5627 = 16 142 → 16 140 м³/ч; 16 140 / 1,69901 = 9 500 CFM
  assert.strictEqual(S.dtc, 15); assert.strictEqual(S.Lcool, 16140); assert.strictEqual(S.Lin, 16140); assert.strictEqual(S.cfmIn, 9500);
  // 4. кратность: 3V = 114,9 → 110 м³/ч, аварийная 8V = 306,4 → 310 м³/ч — расход охлаждения больше, не увеличивается
  assert.strictEqual(S.Lmin, 110); assert.strictEqual(S.Lemerg, 310); assert.strictEqual(S.raised, false);
  // 5. при остановке — вытяжной вентилятор с термостатом: max(солнце 0, 3V = 114,9) · 1,15 = 132 → не меньше 500 м³/ч;
  //    выброс = воздуховод 16 140 + общая вытяжка 500 = 16 640 м³/ч
  assert.strictEqual(S.stand.L, 500); assert.strictEqual(S.Lgen, 500); assert.strictEqual(S.Lout, 16640);
  // 6. выброс по рамке: 16 640 / (3600 · 4) = 1,156 → 1,16 м²; приток: 16 140 / (3600 · 3) · 1,1 = 1,644 → 1,64 м²
  assert.strictEqual(S.Sout, 1.16); assert.strictEqual(S.Sin, 1.64);
  // справочно: скорость в живом сечении (доля vent.free) — 4 / free
  near(S.vLiveOut, VentCalc.round1(4/S.free), 1e-9, 'живое сечение выброса');
  // лето +35 °C с теплом помещения 6,5 кВт и воздухом на сжатие 780 м³/ч: охлаждение 78,75 · 3600 / (1,005 · 1,1461 · 15) =
  // 16 410 м³/ч, помещение (Δt 5) — 4 060, один поток — 16 410 + 780 = 17 190 м³/ч; у входа компрессора
  // 35 + 6,5 · 3600 / (1,005 · 1,146 · 17 190) = 36,2 °C; приток 17 190 / 10 800 · 1,1 = 1,75 м², выброс (16 410 + 500) / 14 400 = 1,17 м²
  const S35=VentCalc.summer({ ...inp, tSum:35, qRoom:6.5, qSun:0.5, use:780 }, W);
  assert.strictEqual(S35.Lcool, 16410); assert.strictEqual(S35.Lin, 17190); assert.strictEqual(S35.tComp, 36.2); assert.strictEqual(S35.Sin, 1.75); assert.strictEqual(S35.Sout, 1.17);
  // «Вентилятор в воздуховоде выброса»: приток 4 м/с — 17 190 / 14 400 · 1,1 = 1,31 м², выброс 6 м/с — 16 910 / 21 600 = 0,78 м²;
  // вентилятор 16 410 м³/ч · 100 Па / (3600 · 1000 · 0,5) = 0,912 кВт
  const SB=VentCalc.summer({ ...inp, tSum:35, qRoom:6.5, qSun:0.5, use:780, boost:true }, W);
  assert.strictEqual(SB.Sin, 1.31); assert.strictEqual(SB.Sout, 0.78); assert.strictEqual(SB.boost.P, 0.912);
  // зима, Δt = 5 − (−25) = 30 °C: Q_огр = 0,481 · 73,6 · 30 = 1 062 Вт; L_зима = max(2V = 76,6) → 80 м³/ч;
  // Q_вент = 80 · 1,005 · (353/248 = 1,4234) · 30 / 3600 = 0,954 кВт; потери 2,02 кВт; тепло компрессора 78,8 — избыток
  const Wn=VentCalc.winter({ ...inp, env:{ U, A, qEnv:U*A*30 }, Qrun:78.8, useRun:0 }, S, W);
  assert.strictEqual(Wn.dt, 30); assert.strictEqual(Wn.Qenv, 1.06); assert.strictEqual(Wn.Lw, 80); assert.strictEqual(Wn.Qvent, 0.95);
  assert.strictEqual(Wn.Qloss, 2.02); assert.strictEqual(Wn.bal, 76.78); assert.strictEqual(Wn.heat, 0);
  // жалюзи зимой: 80 / 16 140 = 0,50 % — меньше наименьшего открытия клапана (20 %) → 20 %
  assert.strictEqual(Wn.ratio, 0.5); assert.strictEqual(Wn.open, 20);
  // рекуператор: по расчёту не нужен (2,02 < 0,3 · 78,8 = 23,64 кВт, подогрев не нужен)
  const R0=VentCalc.recup(false, Wn, inp, W); assert.strictEqual(R0.worth, false);
  // по требованию заказчика: с промежуточным теплоносителем, η = 0,5; t_после = −25 + 0,5 · (5 − (−25)) = −10 °C;
  // влажность 50 % ≤ 60 % — обмерзания нет; −25 < −15 — байпас и предподогрев до +5 °C;
  // Q_рекуп = 80 · 1,005 · 1,4234 · 15 / 3600 = 0,477 кВт; за год: 80 · 1,005 · (353/270,8) · 0,5 · 7,2 / 3600 = 0,1048 кВт × 205 сут × 24 ч = 516 кВт·ч
  const R=VentCalc.recup(true, Wn, inp, W);
  assert.strictEqual(R.type, 'glycol'); assert.strictEqual(R.eta, 0.5); assert.strictEqual(R.tAfter, -10); assert.strictEqual(R.frost, false);
  assert.strictEqual(R.bypass, true); assert.strictEqual(R.measures.length, 2); assert.strictEqual(R.Q, 0.48); assert.strictEqual(R.year, 516);
  assert.deepStrictEqual(W.map(w=>w.level), [], W.map(w=>w.text).join(' | '));
});

Check.run('вентиляция: предупреждения и режим «эксперт»', ()=>{
  const W=[], V=38.3, inp={ units:[{ key:'c1', pos:1, type:'piston', kw:75 }], qRoom:0, use:0, V, tSum:38, ex:{ k:1.3, vOut:6 } };
  const S=VentCalc.summer(inp, W);
  // Δt = 40 − 38 = 2 < 5 — предупреждение, расчёт при 5; k 1,3 вне 0,70…1,20 (поршневой) — взято 1,05; 6 м/с > 5 — предупреждение
  assert.strictEqual(S.dtRaw, 2); assert.strictEqual(S.dt, 5); assert.strictEqual(S.units[0].k, 1.05); assert.strictEqual(S.vOut, 6);
  assert.ok(W.some(w=>/Недостаточный перепад/.test(w.text)) && W.some(w=>/k для типа «поршневой» 1,3 — вне/.test(w.text)) && W.some(w=>/больше 5 м\/с/.test(w.text)), W.map(w=>w.text).join(' | '));
  // паспорт важнее формулы: тепловыделение 60 кВт и воздух охлаждения 18 000 м³/ч
  const P=VentCalc.summer({ ...inp, units:[{ key:'c1', type:'screw', kw:75, heat:60, cool:18000 }], ex:{} }, []);
  assert.strictEqual(P.units[0].Q, 60); assert.strictEqual(P.units[0].cool, 18000); assert.strictEqual(P.units[0].src, 'паспорт');
  // эксперт: k 0,8 для винтового (0,65…1,2) — принят; U 2,0 для неутеплённого — Q = 2 · 73,6 · 30 = 4,42 кВт
  const E=VentCalc.summer({ ...inp, tSum:30, units:[{ key:'c1', type:'screw', kw:75 }], ex:{ k:0.8, U:2 } }, []);
  assert.strictEqual(E.Qc, 60);
  const Wn=VentCalc.winter({ tWin:-25, tInMin:5, V, env:{ U:0.481, A:73.6, qEnv:1062 }, Qrun:60, useRun:0, ex:{ U:2 } }, E, []);
  assert.strictEqual(Wn.U, 2); assert.strictEqual(Wn.Qenv, 4.42);
  // естественная тяга: h = 2 м, +30 / +40 → (1,165 − 1,128) · 9,81 · 2 = 0,7 Па < 5 — вентилятор
  const D=VentCalc.draft(E, 2, 500, {}, []); assert.strictEqual(D.need, true); assert.strictEqual(D.fan.L, 580);
  // вентилятор стоянки заказчика 300 м³/ч меньше нужных 500 — предупреждение
  const Wf=[]; const F=VentCalc.summer({ ...inp, tSum:30, ex:{ fan:300 } }, Wf);
  assert.strictEqual(F.stand.user.ok, false); assert.ok(Wf.some(w=>/меньше нужного при остановленных компрессорах 500/.test(w.text)), Wf.map(w=>w.text).join(' | '));
});

// ---------------------------------------------------------------- станции целиком
const DK=(model, flow)=>part('Осушитель рефрижераторный Dalgakiran '+model, { cat:'dryer_refrig', maker:'Dalgakiran', model, flow, pressure:16, dewPoint:'+3' });
const GON=(model, flow, stage)=>part('Фильтр Dalgakiran '+model, { cat:'filter', maker:'Dalgakiran', model, series:'GON', flow, pressure:16, stage });

Check.run('компрессорная: всё проходит, приложение к КП', ()=>{
  const x=station('st_comp', { flow:'10', pressure:'7', basis:'fad', tmax:'+30', reserve:'1', margin:'0', alt:'0' },
    [part('Компрессор винтовой К-130', { cat:'comp_screw', maker:'Пример', flow:13, pressure:10, kw:75 }, 2, [{ k:'Тип запуска', v:'звезда-треугольник' }]),
      DK('DK 1450', 24), GON('GON 1550 MX', 25.8, 'Тонкая'), GON('GON 1550 MY', 25.8, 'Сверхтонкая (микрофильтр)'),
      part('Ресивер РВ-900', { cat:'receiver', maker:'Пример', volume:900, pressure:11 }, 3), part('Ресивер мокрый РВ-900', { cat:'receiver', maker:'Пример', volume:900, pressure:11 }, 2)], '2.4.2');
  const R=StationCalc.run(x);
  assert.deepStrictEqual(R.errors, [], JSON.stringify(R.errors));
  const step=(sec, re)=>R.sections.find(s=>s.id===sec).steps.find(o=>re.test(o.what));
  // рабочий — 1 × 13 (второй — резерв) против 10: запас 30 %
  assert.strictEqual(step('air', /рабочие против/).margin, 30);
  // осушитель: p = 7 + 0,1 = 7,1 бар → 1,004; помещение 30 + 5 = 35 °C → 0,93; вход 45 °C → 0,78: 24 · 0,7283 = 17,48 м³/мин
  const d=step('dryer', /DK 1450/); assert.strictEqual(d.ok, true); assert.ok(/17,48/.test(d.result), d.result);
  // ресиверы (методика ПНЕВМОТЕХ): винтовой — цикл 13 / (8 · 1) = 1 625 л (приоритет 1); число —
  // наименьшее допустимое: не меньше 80 % нужного (1 300) и 15 % минутной (1 950) → 3 × 900 = 2 700 л; мокрый — только при пиках
  assert.ok(/V = 1625 л/.test(step('recv', /^Приоритет 1/).result), step('recv', /^Приоритет 1/).result);
  assert.ok(!step('recv', /^Приоритет 3/), 'базовый буфер — только у поршневого');
  assert.ok(/V = 1625 л — сработал приоритет 1/.test(step('recv', /^Теоретически/).result), step('recv', /^Теоретически/).result);
  assert.strictEqual(step('recv', /^Рекомендация/).result, 'основной 900 л × 3 = 2 700 л (после осушителя)');
  assert.ok(step('recv', /^Проверки/).result==='Все проверки пройдены.' && step('recv', /^Проверки/).ok===true);
  assert.ok(R.weak.some(w=>/Потери давления/.test(w.title)), 'потери по правилу — требует подтверждения');
  delete x.stLayout.calc; assert.deepStrictEqual(StationCalc.docGroups(x), [], 'ТКП: без галочки расчётной записки в КП нет (решение 14.10)');
  x.stLayout.calc=true; const G=StationCalc.docGroups(x);
  assert.strictEqual(G[0].name, 'Приложение. Расчётная записка и состав станции');
  assert.ok(G[0].rows.some(r=>r.k==='Состав станции' && /в разделе «Состав изделия»/.test(r.v)), 'состав — ссылкой, без повтора');
  assert.ok(!G[0].rows.some(r=>/Компрессор винтовой К-130/.test(r.k)), 'состав в приложении не повторяется');
  x.req=Object.assign({}, x.req, { src:{ name:'ТЗ_Заказчик.pdf' } });
  assert.ok(!JSON.stringify(StationCalc.docGroups(x)).includes('ТЗ_Заказчик'), 'имя файла ТЗ — не в КП');
  assert.ok(G.some(g=>g.name==='Расчётная записка: осушители'));
  // «Назначение и состав» — из данных станции; свой блок менеджера — вместо него
  const D=KitDoc.item(x), pf=D.features[0];
  assert.strictEqual(pf.label, 'Назначение и состав'); assert.ok(/^Компрессорная станция предназначена для выработки/.test(pf.text), pf.text);
  assert.ok(/Компрессор винтовой К-130 — 2 шт\./.test(pf.text) && /В составе:/.test(pf.text), pf.text);
  assert.ok(!D.features.some(f=>f.id==='kit_all'), 'перечень состава не повторяется отдельным блоком');
  assert.ok(!/undefined|NaN|null/.test(pf.text), pf.text);
  const own=Object.assign({}, x, { features:[{ label:'Назначение', text:'Своё' }] });
  assert.ok(!KitDoc.item(own).features.some(f=>f.id==='st_purpose') && KitDoc.item(own).features.some(f=>f.id==='kit_all'), 'свой блок — без шаблона');
  assert.ok(!/В составе/.test(KitDoc.data(x).base.features[0].text), 'шаблон со своим составом — без перечня');
  assert.ok(KitDoc.item(x).groups.some(g=>g.name==='Расчётная записка: производительность'), 'в документе КП');
  x.stLayout.calc=false; assert.deepStrictEqual(StationCalc.docGroups(x), [], 'выключено — не в КП');
});

Check.run('компрессорная: ошибки — мало производительности, осушитель, класс по маслу; согласование', ()=>{
  const x=station('st_comp', { flow:'12', pressure:'7.5', basis:'normal', alt:'900', rh:'80', tmax:'35', margin:'10', reserve:'1' },
    [part('Компрессор винтовой К-130', { cat:'comp_screw', maker:'Пример', flow:13, pressure:8, kw:75 }, 2), DK('DK 1450', 24), GON('GON 1550 MY', 25.8, 'Сверхтонкая (микрофильтр)')], '1.4.1');
  const R=StationCalc.run(x), txt=R.errors.map(e=>e.text).join(' | ');
  // 12 н. м³/мин → FAD: 900 м — 90,970 кПа; воздух помещения 35 + 5 = 40 °C (heat.vent_dt), 80 % — 0,8 · 7,367 = 5,894 кПа:
  // 12 · 101,325/85,076 · 1,14644 = 16,385; +10 % = 18,02 > 13 (по наружному 35 °C было 17,45)
  assert.ok(/Производительность рабочих компрессоров 13 м³\/мин меньше требуемой 18,02/.test(txt), txt);
  // давление: 7,5 + 0,1 (фильтр) + 0,2 (осушитель) + 0,1 (трубы) = 7,9 ≤ 8 — не ошибка; в нижней точке 8 − 1 = 7 < 7,9 — предупреждение
  assert.ok(!/не обеспечит/.test(txt), txt);
  assert.ok(R.warnings.some(w=>/нижней точке регулирования \(7 бар\) давление ниже требуемого 7,9/.test(w.text)), R.warnings.map(w=>w.text).join(' | '));
  assert.ok(/угольный/.test(txt), 'класс 1 по маслу — угольный фильтр');
  assert.ok(StationCalc.errors(x).length>0);
  x.req.accept=true;
  assert.deepStrictEqual(StationCalc.errors(x), [], 'отклонения согласованы — КП сохраняется');
  delete x.stLayout.calc; assert.deepStrictEqual(StationCalc.docGroups(x).map(g=>g.name), ['Отклонения, согласованные с заказчиком'], 'отклонения — в КП и без расчётной записки');
  x.stLayout.calc=true; const G=StationCalc.docGroups(x).map(g=>g.name);
  assert.ok(G.includes('Отклонения, согласованные с заказчиком'), G.join(' | '));
  // заказчику — без внутренних списков программы
  assert.ok(!G.some(n=>/Требует подтверждения|Вопросы|замечания/.test(n)), G.join(' | '));
});

Check.run('справка «Как расставляется оборудование» собирается (без удалённых констант)', ()=>{
  const t=LayoutTab.how(); assert.ok(/Свод правил компоновки/.test(t) && /Проход оператора внутри — всегда/.test(t) && /габарите перевозки/.test(t) && /Вентиляция/.test(t) && !/undefined|NaN/.test(t), t.slice(0, 300));
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

Check.run('резерв по ТЗ, которого нет в составе, — ошибка (было: урезался молча, «проверки пройдены»)', ()=>{
  const comp=(qty)=>part('Компрессор винтовой К', { cat:'comp_screw', maker:'Пример', flow:10, pressure:10, kw:55 }, qty);
  const mk=(reserve, qty)=>station('st_comp', { flow:'8', pressure:'7', basis:'fad', tmax:'30', margin:'0', reserve, alt:'0' }, [comp(qty)]);
  let R=StationCalc.run(mk('1', 1));
  assert.ok(R.errors.some(e=>e.text==='Резерв по ТЗ не обеспечен: в составе 1 компрессор, а по ТЗ 1 резервный — нужно не меньше 2 компрессоров.'),
    R.errors.map(e=>e.text).join(' | '));
  R=StationCalc.run(mk('1', 2));
  assert.ok(!R.errors.some(e=>/Резерв по ТЗ/.test(e.text)), 'резерв есть — ошибки нет');
  R=StationCalc.run(mk('0', 1));
  assert.ok(!R.errors.some(e=>/Резерв по ТЗ/.test(e.text)), 'без резерва — как было');
  const dgu=part('ДГУ Energo 200', { cat:'dgu', maker:'Energo', kw:200, kwMax:220, kva:250 }, 1);
  R=StationCalc.run(station('st_dgu', { kw:'180', reserve:'1', tmax:'30' }, [dgu]));
  assert.ok(R.errors.some(e=>/^Резерв по ТЗ не обеспечен: в составе 1 ДГУ, а по ТЗ 1 резервная — нужно не меньше 2 ДГУ\./.test(e.text)), R.errors.map(e=>e.text).join(' | '));
  assert.strictEqual(ReserveCheck.of({ reserve:2 }, 2), 1, 'хотя бы один агрегат — рабочий');
  assert.strictEqual(ReserveCheck.of({}, 3), 0);
});

Check.run('лето без температуры в ТЗ — одно правило 35 °C (heat.t_summer): перевод в FAD, осушитель, вентиляция (было 20 / 25 / 35 °C)', ()=>{
  assert.strictEqual(StationRules.raw('heat.t_summer'), 35);
  assert.strictEqual(StationRules.status('heat.t_summer'), 'unconfirmed', 'требует подтверждения');
  const comp=()=>part('Компрессор винтовой К-130', { cat:'comp_screw', maker:'Пример', flow:13, pressure:10, kw:75 });
  const mk=extra=>station('st_comp', { flow:'10', pressure:'7', basis:'normal', alt:'0', rh:'100', margin:'0', reserve:'0', ...extra }, [comp()]);
  const fad=R=>R.sections.find(sec=>sec.id==='air').steps.find(st=>/FAD/.test(st.what)).result;
  const none=StationCalc.run(mk({})), hot=StationCalc.run(mk({ tmax:'35' })), cool=StationCalc.run(mk({ tmax:'20' }));
  // 10 н. м³/мин, 100 %: воздух помещения 35 + 5 = 40 °C — 7,367 кПа пара: 10 · 101,325 / (101,325 − 7,367) · 313,15 / 273,15 =
  // 12,36 (по наружному 35 °C было 11,94, при 20 °C — 10,99)
  assert.strictEqual(fad(none), fad(hot)); assert.ok(/12,36/.test(fad(none)), fad(none));
  assert.notStrictEqual(fad(none), fad(cool), 'было 20 °C — потребность занижена на 8 %');
  assert.ok(none.rules.includes('heat.t_summer') && none.weak.some(w=>w.id==='heat.t_summer'), 'правило — в «требует подтверждения»');
  assert.ok(!hot.rules.includes('heat.t_summer'), 'температура в ТЗ — правило не нужно');
  assert.deepStrictEqual(DryerDerate.temps({ tmax:null, tin:null }), DryerDerate.temps({ tmax:35, tin:null }), 'осушитель: было 25 °C');
  assert.strictEqual(StationPlan.plan(mk({})).heat.vent.tmax, 35, 'вентиляция');
  assert.strictEqual(StationPlan.plan(mk({ tmax:'28' })).heat.vent.tmax, 28);
});

Check.run('насосная: подача и напор диапазоном — крайние точки паспорта, между ними — «уточните рабочую точку» (было: обе верхние границы — «выполняется»)', ()=>{
  TYPES.st_pump={ item:'Насосная станция', station:{ main:['pump'] } };
  const pump=(flow, head)=>part('Насос Н', { cat:'pump', maker:'Пример', flow, head, kw:15 });
  const mk=(q, head, flow, pumpHead)=>StationCalc.run(station('st_pump', { q:String(q), head:String(head), reserve:'0' }, [pump(flow, pumpHead)]));
  const step=R=>R.sections.find(sec=>sec.id==='pump').steps.find(st=>/^Напор/.test(st.what));
  const texts=R=>R.issues.map(i=>i.text).join(' | ');
  // 35 м³/ч при 45 м: было Q 40 ≥ 35 и H 50 ≥ 45 — «выполняется», а при 40 м³/ч напор 20 м
  let R=mk(35, 45, '8–40', '50–20');
  assert.strictEqual(step(R).ok, null, 'между крайними точками — не «выполняется»');
  assert.ok(R.warnings.some(w=>/^Насос «Насос Н»: при 35 м³\/ч нужен напор 45 м — между крайними точками паспорта \(50–20 м при 8–40 м³\/ч\); уточните рабочую точку по кривой Q–H\.$/.test(w.text)), texts(R));
  assert.ok(!R.errors.some(e=>/Напор/.test(e.text)), 'не ошибка: кривой нет');
  assert.deepStrictEqual(step(mk(35, 45, '8–40', '20–50')).result, step(R).result, 'порядок границ напора не важен');
  assert.strictEqual(step(mk(35, 18, '8–40', '50–20')).ok, true, 'не выше наименьшего напора — при любой подаче');
  assert.strictEqual(step(mk(6, 48, '8–40', '50–20')).ok, true, 'подача меньше наименьшей — напор не меньше наибольшего');
  R=mk(35, 55, '8–40', '50–20');
  assert.ok(R.errors.some(e=>e.text==='Напор насоса «Насос Н» — не больше 50 м, меньше требуемого 55 м.'), texts(R));
  assert.strictEqual(step(mk(30, 38, 32, 40)).ok, true, 'числом — номинальная точка, как было');
  assert.strictEqual(PumpPoint.text({ flow:'до 40', head:'50–20' }, String), '50–20 м при подаче до 40 м³/ч');
  assert.strictEqual(PumpPoint.verdict({ flow:'до 40', head:'50–20' }, 35, 45, 0.02), PumpPoint.CHECK);
  assert.strictEqual(PumpPoint.verdict({ flow:'8–40', head:'50–20' }, 45, 30, 0.02), PumpPoint.OVER);
  // одна величина числом, другая диапазоном: рабочую точку не угадываем (было: «выполняется» с наибольшим напором)
  R=mk(40, 45, 40, '50–20');
  assert.strictEqual(step(R).ok, null, 'подача числом, напор диапазоном — «уточните»');
  assert.strictEqual(PumpPoint.verdict({ flow:40, head:'50–20' }, 40, 18, 0.02), PumpPoint.FITS, 'не выше наименьшего напора — да');
  assert.strictEqual(PumpPoint.verdict({ flow:'8–40', head:32 }, 20, 30, 0.02), PumpPoint.CHECK, 'подача диапазоном, напор числом');
  assert.strictEqual(PumpPoint.verdict({ flow:'до 40', head:32 }, 20, 30, 0.02), PumpPoint.CHECK, '«до 40»');
  assert.strictEqual(PumpPoint.verdict({ flow:'8–40', head:32 }, 8, 30, 0.02), PumpPoint.FITS, 'при наименьшей подаче — не меньше паспортного');
  assert.strictEqual(PumpPoint.verdict({ flow:40, head:'50–20' }, 45, 18, 0.02), PumpPoint.CHECK, 'за номинальной подачей — «уточните», не «не даст»');
  assert.strictEqual(step(mk(20, 30, '8–40', 32)).result, 'Hнас при 20 м³/ч — по кривой Q–H');
  assert.strictEqual(step(mk(35, 45, '8–40', 'до 50')).result, 'Hнас при 35 м³/ч — до 50 м: по кривой Q–H', 'без «от ?»');
  // подача на насос больше наибольшей по паспорту — ошибка (было: «выполняется» без замечания, КП сохранялось)
  const two=station('st_pump', { q:'120', head:'25', reserve:'0' }, [pump('8–40', '50–20'), part('Насос Б', { cat:'pump', maker:'Пример', flow:'20–100', head:'60–30', kw:30 })]);
  R=StationCalc.run(two);
  assert.ok(R.errors.some(e=>/^Насос «Насос Н»: подача на насос 60 м³\/ч больше наибольшей по паспорту 40 м³\/ч/.test(e.text)), texts(R));
  assert.ok(/подача на насос больше 40 м³\/ч — НЕ выполняется/.test(JSON.stringify(StationCalc.docGroups(two))), 'в КП — «НЕ выполняется»');
  // подача меньше наименьшей по паспорту — вне рабочей части кривой
  R=mk(6, 48, '8–40', '50–20');
  assert.ok(R.warnings.some(w=>/^Насос «Насос Н»: подача на насос 6 м³\/ч меньше наименьшей по паспорту 8 м³\/ч/.test(w.text)), texts(R));
  // числом: подача на насос больше номинальной — «уточните» (было: ✕ на экране без замечания)
  R=mk(36, 38, 32, 40);
  assert.ok(R.warnings.some(w=>/^Насос «Насос Н»: подача на насос 36 м³\/ч больше номинальной 32 м³\/ч/.test(w.text)), texts(R));
});

Check.run('осушитель без температуры в ТЗ: «Компоновка», «Нужно…», «Решить» и расчётная записка — одни поправки (было: в записке ошибка, «Решить» — нечем)', ()=>{
  const comp=part('Компрессор винтовой К-100', { cat:'comp_screw', maker:'Пример', flow:10, pressure:8, kw:55 });
  const card=(id, model, flow)=>({ id, name:'Осушитель Dalgakiran '+model, attrs:{ cat:'dryer_refrig', maker:'Dalgakiran', model, flow, pressure:16 } });
  const cards=[card('d120', 'DK 120', 12), card('d200', 'DK 200', 20)];
  const mk=c=>station('st_comp', { flow:'10', pressure:'7', basis:'fad', margin:'0', reserve:'0', alt:'0' }, [comp, part(c.name, { ...c.attrs }, 1)]);
  Catalog.cache=cards;
  try{
    for (const c of cards){
      const x=mk(c), bad=StationCalc.run(x).errors.some(e=>/^Осушитель .*: с поправками/.test(e.text));
      const rec=KitNeed.recs(x).find(r=>r.key==='dryer-refrig');
      assert.strictEqual(Boolean(rec && rec.swap), bad, `${c.attrs.model}: «Заменить» — тогда же, когда ошибка в записке`);
      if (!bad) continue;
      const item=ExpertFix.list(x).find(i=>/^Осушитель .*: с поправками/.test(i.text));
      assert.ok(item && item.fix && item.fix.id==='need:dryer-refrig', 'у ошибки — «Решить»: '+JSON.stringify(item));
      assert.strictEqual(NeedPick.best(x, rec).c.id, 'd200', 'подбор — с теми же поправками');
    }
  } finally { Catalog.cache=[]; }
});

Check.run('ресиверы: приоритет 1 — «не чаще 1 цикла за 30 с»; в КП — без проверок «на здравый смысл» и без «НЕ выполняется» там, где нет ошибки', ()=>{
  const x=station('st_comp', { flow:'3', pressure:'7', basis:'fad', tmax:'30', margin:'0', reserve:'0', alt:'0' },
    [part('Компрессор винтовой К-36', { cat:'comp_screw', maker:'Пример', flow:3.6, pressure:10, kw:22 }), part('Ресивер РВ-500', { cat:'receiver', maker:'Пример', volume:500, pressure:11 })]);
  const R=StationCalc.run(x), recv=R.sections.find(sec=>sec.id==='recv');
  // V = Q / (8 · ΔP): 3,6 / 8 = 0,45 м³ — до 2 циклов в минуту (Atlas Copco: fmax — 1 цикл за 30 с), а не 10–15 в час
  assert.ok(recv.steps.some(st=>st.what==='Приоритет 1. Цикл нагрузки/разгрузки (не чаще 1 цикла за 30 с, Atlas Copco)'), recv.steps.map(st=>st.what).join(' | '));
  const sanity=recv.steps.find(st=>/здравый смысл/.test(st.what));
  assert.ok(sanity && /сработало/.test(sanity.result), 'на экране — есть: '+JSON.stringify(sanity));
  assert.deepStrictEqual(R.errors.map(e=>e.text), [], 'без ошибок');
  const doc=JSON.stringify(StationCalc.docGroups(x));
  assert.ok(!/здравый смысл|предупреждение:|Проверить|Рассмотреть/.test(doc), 'указания менеджеру — не в КП');
  assert.ok(!/НЕ выполняется/.test(doc), 'нет ошибки — нет и «НЕ выполняется»');
  assert.ok(/выполняется/.test(doc), 'выполненные шаги — как были');
  // лето +38 °C: перепад помещения 2 °C меньше 5 — предупреждение (шаг ✕ на экране), в КП — без «НЕ выполняется»
  x.req.tmax='38'; StationCalc.cache.clear();
  const hot=StationCalc.run(x), dt=hot.sections.find(sec=>sec.id==='vent').steps.find(st=>/^Перепад температур/.test(st.what));
  assert.strictEqual(dt.ok, false, 'на экране — ✕');
  assert.ok(!hot.errors.some(e=>e.sec==='vent'), hot.errors.map(e=>e.text).join(' | '));
  assert.ok(!/Перепад температур помещения летом[^"]*НЕ выполняется/.test(JSON.stringify(StationCalc.docGroups(x))), 'в КП — без «НЕ выполняется»');
});

Check.run('отпечаток станции и кэш расчёта — от всего, что читает расчёт (было: ручной список — шум, роль ресивера, ступень, строки «NPSHr», «Способ пуска» не учитывались)', ()=>{
  const comp=part('Компрессор винтовой К-130', { cat:'comp_screw', maker:'Пример', flow:13, pressure:10, kw:75, noise:60 });
  const recv=part('Ресивер РВ-900', { cat:'receiver', maker:'Пример', volume:900, pressure:11 });
  const x=station('st_comp', { flow:'10', pressure:'7', basis:'fad', tmax:'30', margin:'0', reserve:'0', alt:'0' }, [comp, recv]);
  const hash=()=>StationLayout.hash(StationPlan.input(x));
  const changed=(what, edit)=>{ const before=hash(); edit(); assert.notStrictEqual(hash(), before, what); };
  changed('шум', ()=>{ comp.attrs.noise=98; });
  changed('строка характеристик', ()=>{ comp.rows=[{ k:'Уровень шума', v:'70 дБА' }]; });
  changed('мокрый ресивер', ()=>{ recv.recvRole='wet'; });
  changed('ступень', ()=>{ recv.airGrade='micro'; });
  const kept=hash(); comp.cost=123456; comp.costCur='EUR';
  assert.strictEqual(hash(), kept, 'закупка — картинки не пересобираются');
  comp._costText='12 34'; comp._at=3;
  assert.strictEqual(hash(), kept, 'служебные поля окна («_…», текст в поле закупки) — тоже (было: каждое нажатие — компоновка заново)');
  const first=StationCalc.run(x);
  assert.strictEqual(StationCalc.run(x), first, 'без правки — из кэша');
  comp.rows=[...comp.rows, { k:'Способ пуска', v:'Плавный пуск' }];
  assert.notStrictEqual(StationCalc.run(x), first, 'строка «Способ пуска» — расчёт заново');
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
  Catalog.cache=[
    { id:'c1', name:'Компрессор К-130', attrs:{ cat:'comp_screw', maker:'Пример', flow:13, pressure:10, kw:75 } },
    { id:'c2', name:'Осушитель рефрижераторный Dalgakiran DK 1450', attrs:{ cat:'dryer_refrig', maker:'Dalgakiran', model:'DK 1450', flow:24, pressure:16 } },
    { id:'c3', name:'Осушитель рефрижераторный Dalgakiran DK 1000', attrs:{ cat:'dryer_refrig', maker:'Dalgakiran', model:'DK 1000', flow:16.7, pressure:16 } },
  ];
  Api.request=async u=>Catalog.cache.find(z=>u.endsWith('/'+encodeURIComponent(z.id)));
  const x=station('st_comp', {}, []);
  return TzBuild.run(x, { kind:'comp', flow:12, pressure:7, tmax:'35', air:'', reserve:'0', work:0 }).then(note=>{
    // 13 м³/мин через осушитель; 35 + 5 = 40 °C (0,84), вход 50 °C (0,65), 7 бар (1): DK 1000 — 16,7 · 0,546 = 9,1 мало, DK 1450 — 13,1
    assert.ok(Kit.parts(x).some(p=>/DK 1450/.test(p.name)), note);
    assert.ok(/с поправками 13,1/.test(note), note);
  });
});

Check.run('характеристики станции: без NaN и дробного «мусора», ручные строки сохраняются', ()=>{
  assert.strictEqual(StationAutoVal.of('1,1', 3), 3.3, '1,1 × 3 = 3,3, а не 3,3000000000000003');
  assert.strictEqual(StationAutoVal.of('8–10', 2), '16–20', 'диапазон × 2');
  assert.strictEqual(StationAutoVal.of('8–10'), '8–10', 'диапазон — как есть');
  assert.strictEqual(StationAutoVal.of('нет данных', 2), 'нет данных', 'текст без числа — не NaN');
  const old=[{ name:'Основные', rows:[{ k:'Подача', v:'10' }, { k:'Давление', v:'8' }] }];
  const cur=[{ name:'Основные', rows:[{ k:'Подача', v:'10' }, { k:'Давление', v:'7,5' }, { k:'Своя строка', v:'x' }] }];
  const now=[{ name:'Основные', rows:[{ k:'Подача', v:'20' }, { k:'Давление', v:'10' }, { k:'Масса', v:'900' }] }];
  assert.deepStrictEqual(StationAutoVal.merge(cur, old, now)[0].rows.map(r=>r.k+'='+r.v), ['Подача=20', 'Давление=7,5', 'Масса=900', 'Своя строка=x'],
    'автоматические — новые, правленые и свои — менеджера');
});

Check.run('режим «эксперт»: отметка «вручную», сброс к правилам, журнал правок', ()=>{
  KpState.replace({ manager:{ name:'Иванов И. И.' } });
  const x=station('st_comp', { ventK:'0,8' }, []);
  ExpertLog.note(x); assert.deepStrictEqual(x.req.xlog, undefined, 'первый снимок — без записи в журнал');
  assert.ok(/вручную/.test(ExpertLog.mark(x, 0, 'ventK')) && ExpertLog.mark(x, 0, 'ventTin')==='', 'отметка только у заданного');
  x.req.ventTin='45'; ExpertLog.note(x);
  assert.deepStrictEqual(x.req.xlog.map(e=>[e.k, e.from, e.to, e.who]), [['ventTin', '', '45', 'Иванов И. И.']]);
  ExpertLog.reset(x, ['ventK', 'ventTin', 'notes']);
  assert.ok(x.req.ventK==null && x.req.ventTin==null, 'сброшено к правилам');
  assert.deepStrictEqual(x.req.xlog.slice(1).map(e=>[e.k, e.from, e.to]), [['ventK', '0,8', ''], ['ventTin', '45', '']]);
  assert.ok(/Журнал правок \(3\)/.test(ExpertLog.foot(x, 0, ExpertLog.VENT())), 'журнал в блоке');
  for (let n=0; n<60; n++){ x.req.gateOff=String(n); ExpertLog.note(x); }
  assert.strictEqual(x.req.xlog.length, ExpertLog.MAX, 'журнал ограничен');
  assert.ok(!('xlog' in StationReq.plan(x)) && !/xlog|_xs/.test(JSON.stringify(StationReq.plan(x))), 'журнал не влияет на компоновку');
});

Check.run('ресиверы — методика ПНЕВМОТЕХ: приоритеты, ряд 900/500, мокрый и локальный, проверки', ()=>{
  const S=(V, o)=>{ const r=ReceiverPlan.size(V, o||{}); return r && [r.size, r.n, r.total]; };
  // ряд: 500 — только если 900 л даёт запас больше 200 %; иначе кратно 900 л (вверх)
  assert.deepStrictEqual(S(300), [500, 1, 500], '300 л: 900 — запас 300 % → 500 л');
  assert.deepStrictEqual(S(460), [900, 1, 900], '460 л: 900 — запас 196 % → 900 л');
  assert.deepStrictEqual(S(1550), [900, 2, 1800]); assert.deepStrictEqual(S(3250), [900, 4, 3600]);
  // 500 л — только если и наименьшее допустимое в него помещается (аудит CALC-060): 3,5 м³/мин, ΔP 1 → нужно 438 л, не меньше 525 л (15 %)
  assert.deepStrictEqual(S(438, { min:525 }), [900, 1, 900], '438 л при допустимых ≥ 525 л — 900 л');
  assert.ok(/меньше наименьшего допустимого 525 л/.test(ReceiverPlan.size(438, { min:525 }).why), ReceiverPlan.size(438, { min:525 }).why);
  { const R0=ReceiverPlan.calc({ Q:3.5, S:3.5 }); assert.deepStrictEqual([R0.theor, R0.main.total], [438, 900], JSON.stringify(R0.main));
    assert.ok(!R0.checks.some(c=>/менее 15|Запас превышает/.test(c.text)), 'без «менее 15 %» и без совета перейти на 500 л: '+JSON.stringify(R0.checks)); }
  // 500 л вручную (нехватка места) — сколько нужно по 500 л (решение ПНЕВМОТЕХ: «13 × 500 л» вместо 900 л); до 500 л — один
  assert.deepStrictEqual(S(1550, { force:'500', reason:'space' }), [500, 4, 2000], 'вручную 500 л — несколько');
  assert.deepStrictEqual(S(450, { force:'500', reason:'space' }), [500, 1, 500], 'вручную 500 л — один');
  assert.ok(/вручную/.test(ReceiverPlan.size(1550, { force:'500', reason:'space' }).why) && /габарит перевозки/.test(ReceiverPlan.size(1550, { force:'500', reason:'space', auto:true }).why), 'обоснование: вручную / подбор');
  // приоритет 1 (винтовой): Q / (8 · ΔP); 3 — базовый буфер 1 · Q только у поршневого (уточнено ПНЕВМОТЕХ: «слишком много ресиверов»)
  let R=ReceiverPlan.calc({ Q:10, S:10 });
  assert.ok(Math.abs(R.V.p1-1250)<1e-6 && R.V.p3==null && R.prio===1 && R.theor===1250, JSON.stringify(R.V));
  // число — наименьшее допустимое: не меньше 80 % нужного (1 000) и 15 % минутной производительности (1 500) → 2 × 900
  assert.deepStrictEqual([R.main.size, R.main.n], [900, 2], JSON.stringify(R.main));
  R=ReceiverPlan.calc({ Q:10, S:10, dp:0.25 }); assert.ok(R.prio===1 && R.theor===5000 && R.main.n===5, 'ΔP 0,25 бар: 10 / 2 = 5 м³, не меньше 4 м³ → 5 × 900');
  R=ReceiverPlan.calc({ Q:1, piston:true }); assert.ok(R.prio===3 && R.theor===1000 && R.main.total===900, 'поршневой 1 м³/мин: 1 000 л, допустимо 800 л → 1 × 900');
  // приоритет 2 (циклограмма): T · (C − S) · Pa / (P1 − P2) = 2 · (15 − 10) · 1 / 1 = 10 м³; не меньше 8 м³ → 9 × 900
  R=ReceiverPlan.calc({ Q:10, S:10, cyc:{ T:2, C:15, drop:1 } });
  assert.ok(R.prio===2 && R.theor===10000 && R.V.p3==null && R.main.n===9, JSON.stringify([R.prio, R.theor, R.main]));
  // мокрый: по методике — только при риске проскока влаги (пик больше осушителя); «основной + мокрый» — всегда (0,3 основного)
  assert.strictEqual(ReceiverPlan.calc({ Q:10, S:10, dryer:true, dryerCap:12 }).wet, null, 'пиков нет — мокрый не нужен');
  R=ReceiverPlan.calc({ Q:10, S:10, dryer:true, mode:'both' }); assert.deepStrictEqual([R.wet.size, R.wet.n], [900, 1], '0,3 · 1 800 = 540 → 900');
  R=ReceiverPlan.calc({ Q:10, S:10, dryer:true, dryerCap:12, cyc:{ T:1, C:15, drop:1 } }); assert.ok(R.risk && R.wet, 'пик 15 > осушитель 12 — мокрый');
  assert.strictEqual(ReceiverPlan.calc({ Q:10, S:10, dryer:true, mode:'after', dryerCap:12, cyc:{ T:1, C:15, drop:1 } }).wet, null);
  // локальный: пик точки больше 50 % компрессора; 900 л избыточен → 500 л
  R=ReceiverPlan.calc({ Q:10, S:10, point:6 }); assert.deepStrictEqual([R.local.size, R.local.n], [900, 2], '0,25 · 6 000 = 1 500 л → 2 × 900');
  R=ReceiverPlan.calc({ Q:2, S:2, point:1.5 }); assert.deepStrictEqual([R.local.size, R.local.n], [500, 1], '0,25 · 1 500 = 375 л → 500 л');
  const T=o=>ReceiverPlan.calc(Object.assign({ Q:10, S:10, bar:10 }, o)).checks.map(c=>c.level+': '+c.text.slice(0, 40));
  assert.deepStrictEqual(T({ have:[{ vol:900, qty:2, bar:11, role:'dry' }] }), [], '1 800 на 1 250 л, 11 бар — всё пройдено');
  assert.ok(T({ have:[{ vol:900, qty:1, bar:11, role:'dry' }] }).some(t=>/^error: Объём ниже минимально/.test(t)), '900 < 0,8 · 1 250');
  assert.ok(T({ have:[{ vol:900, qty:6, bar:11, role:'dry' }] }).some(t=>/^warn: Запас превышает 200%/.test(t)), '5 400 > 2 · 2 500');
  assert.ok(T({ have:[{ vol:1000, qty:3, bar:11, role:'dry' }] }).some(t=>/^error: Нарушено правило типоразмерного ряда/.test(t)), '1 000 л — не из ряда');
  assert.ok(T({ have:[{ vol:900, qty:3, bar:10, role:'dry' }] }).some(t=>/^error: Ресивер должен иметь запас по давлению/.test(t)), 'ресивер 10 бар при компрессоре 10 бар');
  assert.ok(T({ valve:12, have:[{ vol:900, qty:3, bar:11, role:'dry' }] }).some(t=>/^error: Уставка предохранительного клапана/.test(t)), 'клапан 12 > 11 бар');
  assert.ok(T({ have:[{ vol:500, qty:1, bar:11, role:'dry' }] }).some(t=>/^warn: 500 л применён без достаточного/.test(t)), '500 л без обоснования');
  assert.ok(T({ have:[{ vol:500, qty:1, bar:11, role:'dry' }] }).some(t=>/^warn: Объём менее 15% минутной/.test(t)), '500 < 0,15 · 10 000');
  assert.ok(T({ Q:0.5, S:0.5, have:[{ vol:900, qty:3, bar:11, role:'dry' }] }).some(t=>/^warn: Объём более 5-кратной/.test(t)), '2 700 > 5 · 500');
  assert.ok(T({ cyc:{ T:1, C:10.5, drop:1 }, have:[{ vol:900, qty:2, bar:11, role:'dry' }] }).some(t=>/^warn: Система имеет избыточную аккумулирующую/.test(t)), '«мёртвый объём»: 1 800 > 3 · 500');
  assert.ok(T({ dryer:true, dryerCap:12, cyc:{ T:1, C:15, drop:1 }, have:[{ vol:900, qty:6, bar:11, role:'dry' }] }).some(t=>/^warn: Возможен проскок влаги/.test(t)), 'пик 15 > осушитель 12, мокрого нет');
  assert.ok(!T({ dryer:true, dryerCap:12, cyc:{ T:1, C:15, drop:1 }, have:[{ vol:900, qty:6, bar:11, role:'dry' }, { vol:900, qty:2, bar:11, role:'wet' }] }).some(t=>/проскок/.test(t)), 'с мокрым — без предупреждения');
});

Check.run('«на чертеже»: что подсветить по тексту замечания', ()=>{
  const plan={ items:[{ pos:1 }, { pos:2 }, { pos:3 }, { pos:5 }], gates:{ sea:false }, doors:[], vent:{ louvers:[{}] } };
  assert.deepStrictEqual(IssueSpot.of('Проход перед поз. 2 и 3 меньше нормы', plan), { pos:[2, 3], kinds:['aisle'] });
  assert.deepStrictEqual(IssueSpot.of('Поз. 1–3: ворота в торце узкие', plan), { pos:[1, 2, 3], kinds:['gate'] });
  assert.deepStrictEqual(IssueSpot.of('поз. 9 — нет на плане; жалюзи притока малы', plan), { pos:[], kinds:['vent'] });
  assert.strictEqual(IssueSpot.has('Масса станции около 7 т', plan), false, 'нечего показать — без кнопки');
});

// ---------------------------------------------------------------- проверка расчётов 19.10 (решение владельца «выполняй все»)
Check.run('ток станции: двигатель берёт из сети P / η (как в расчётной записке)', ()=>{
  // 75 кВт / 0,93 = 80,645 кВт; I = 80 645 / (√3 · 400 · 0,85) = 136,95 А; × 1,25 = 171,2 → автомат 200 А (без η было 127,4 → 160 А)
  const W=StationPower.calc({ items:[{ kind:'compressor', kw:75, name:'К' }], req:{} });
  near(W.amp, 137.0, 0.1, 'ток'); assert.strictEqual(W.breaker, 200);
  near(W.kw, 80.65, 0.15, 'расчётная мощность из сети (+ клапаны вентиляции)'); assert.ok(W.inst>=75 && W.inst<75.5, 'установленная — по паспорту');
});
Check.run('время работы ДГУ от бака: с запасом dgu.fuel_margin и вниз', ()=>{
  // 500 л / 1,1 / 18,75 л/ч = 24,24 → 24 ч (было «около 27 ч»: 500 / 18,75 = 26,7 с округлением вверх)
  assert.strictEqual(StationDefaults.hours(500, 18.75), 24);
  assert.strictEqual(StationDefaults.hours(1000, 0), 0);
});
Check.run('отопление: теплоёмкость воздуха при наружной температуре', ()=>{
  // c · 353 / (273 + t) / 3,6: −40 °C → 1,005 · 1,5150 / 3,6 = 0,4229 Вт·ч/(м³·°C); +20 °C → 0,3363 (heat.air 0,335 — только для +20)
  near(StationHeat.airAt(-40), 0.4229, 0.0005, '−40 °C'); near(StationHeat.airAt(20), 0.3363, 0.0005, '+20 °C');
  for (const id of ['heat.comp_air', 'heat.dgu_rad', 'heat.louver_leak']){ const r=StationRules.rule ? StationRules.rule(id) : null; assert.ok(StationRules.raw(id)!=null, id); if (r) assert.strictEqual(r.status, 'unconfirmed', id); }
});

// ---------------------------------------------------------------- мелкие расчётные находки аудита 30.10 (п. 19 отчёта)
Check.run('аудит п. 19: перегрузка ДГУ, точка росы, предел масла — из правил; бак ДГУ — одной формулой с запасом', ()=>{
  assert.strictEqual(GensetSizing.LOAD_MAX, StationRules.raw('dgu.overload').k, 'перегрузка PRP — правило dgu.overload');
  assert.strictEqual(AirChain.refrigDew(), '+3 °C');
  // бак без расчёта станции: P · нагрузка · расход · часы · запас — как GensetSizing (было: без запаса, «около N ч» < часов)
  for (const [kw, hours] of [[100, 10], [200, 16], [60, 24]]){
    const v=StationDefaults.tank(kw, hours);
    assert.ok(StationDefaults.hours(v, StationDefaults.perHour(kw))>=hours, `${kw} кВт, ${hours} ч: бак ${v} л`);
  }
  const x=station('st_comp', { flow:'5', pressure:'7', reserve:'0', tmax:'25' }, [part('Компрессор К', { cat:'comp_screw', flow:6, pressure:8, kw:37 }), part('Рефрижераторный осушитель Д', { cat:'dryer_refrig', flow:8, pressure:16 })], '1.4.1');
  const oil=StationCalc.run(x).sections.flatMap(sec=>sec.steps).filter(st=>/масло класса 1/.test(st.what));
  assert.ok(oil.length && oil.every(st=>st.rules.includes('air.oil') && /не более 0,01 мг\/м³/.test(JSON.stringify(st.data))), 'класс масла 1 — предел 0,01 мг/м³ (ГОСТ Р ИСО 8573-1, табл. 4)');
});
Check.run('аудит п. 19: насос без температуры жидкости — допущение 20 °C и вопрос «позже»', ()=>{
  TYPES.st_pump={ item:'Насосная станция', station:{ main:['pump'] } };
  const pump=part('Насос Н', { cat:'pump', maker:'Пример', flow:40, head:50, kw:15 }, 1, [{ k:'NPSHr', v:'3 м' }]);
  const R=StationCalc.run(station('st_pump', { q:'35', head:'45', reserve:'0', hsuct:'2' }, [pump]));
  assert.ok(R.sections.some(sec=>sec.steps.some(st=>/Кавитационный/.test(st.what))), 'кавитационный запас считается');
  assert.ok(R.assumptions.some(a=>/Температура жидкости в ТЗ не указана — .* принята 20 °C/.test(a)), R.assumptions.join(' | '));
  assert.ok(R.later.some(q=>/Температура перекачиваемой жидкости/.test(q)), R.later.join(' | '));
  const T=StationCalc.run(station('st_pump', { q:'35', head:'45', reserve:'0', hsuct:'2', tliq:'40' }, [pump]));
  assert.ok(!T.assumptions.some(a=>/Температура жидкости/.test(a)), 'температура задана — без допущения');
});
Check.run('аудит п. 19: ресивер — паспортное давление выше рабочего: условие «при уставке клапана», одно сравнение p·V', ()=>{
  assert.strictEqual(PressureVessel.ratedOnly(8, 16, 900), 16, '900 л: 8 бар — 0,72, 16 бар — 1,44');
  assert.strictEqual(PressureVessel.ratedOnly(8, 11, 900), null, '11 бар — 0,99: без учёта и по паспорту');
  assert.strictEqual(PressureVessel.registered(11, 909), false); assert.strictEqual(PressureVessel.registered(11, 910), true);
  const x=station('st_comp', { flow:'5', pressure:'6', reserve:'0', tmax:'25' }, [part('Компрессор К', { cat:'comp_screw', flow:6, pressure:8, kw:37 }), part('Ресивер Р', { cat:'receiver', volume:900, pressure:16 })]);
  const R=StationCalc.run(x);
  // учёт — по рабочему давлению (ФНП ОРПД, п. 223 а): условие — допущение расчёта, а не «требует подтверждения»
  assert.ok(R.assumptions.some(a=>/по рабочему давлению станции 8 бар \(ФНП ОРПД, п\. 223 а\): без учёта при уставке предохранительного клапана ресивера не выше 8 бар/.test(a)), JSON.stringify(R.assumptions));
  assert.ok(!R.weak.some(w=>/уставке/.test(w.title)), JSON.stringify(R.weak.map(w=>w.title)));
});

process.on('beforeExit', ()=>{ if (!process.exitCode) console.log('расчёт станции: проверок пройдено — '+Check.n); });

Check.run('ст. м³ (ГОСТ 2939, 20 °C) → FAD: меньше, чем из н. м³, в 293,15 / 273,15 раза (решение 17.10)', ()=>{
  const n=AirDemand.fad(12, 900, 35, 80, 'normal'), s=AirDemand.fad(12, 900, 35, 80, 'std');
  assert.ok(Math.abs(n/s-293.15/273.15)<1e-9, n+' / '+s);
  assert.ok(Math.abs(n-15.861)<0.01, 'н. м³ — как раньше: '+n);
  assert.strictEqual(StationRules.raw('flow.standard').t, 20);
  const x=station('st_comp', { flow:'12', pressure:'7', basis:'std', alt:'900', rh:'80', tmax:'35', margin:'0', reserve:'0' },
    [part('Компрессор винтовой К-200', { cat:'comp_screw', maker:'Пример', flow:20, pressure:10, kw:110 })]);
  const R=StationCalc.run(x), t=JSON.stringify(R);
  assert.ok(/стандартных м³ → FAD/.test(t) && /ст\. м³\/мин/.test(t), t.slice(0, 400));
});
