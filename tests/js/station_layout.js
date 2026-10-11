// Компоновка станций в контейнере (app/web/js/features/station-layout.js, station-draw.js): разбор габаритов и цвета,
// расстановка с проходами обслуживания, подбор контейнера, отпечаток, габаритный чертёж и 3D-вид.
// Запуск из корня репозитория: node tests/js/station_layout.js — код выхода 0, если всё прошло (tests/test_station_layout.py).
'use strict';
const vm=require('vm'), fs=require('fs'), path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');
for (const f of ['logistics-calc.js', 'station-layout.js', 'station-draw.js']){
  const p=path.join(ROOT, 'app', 'web', 'js', 'features', f); vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename:p }); }

class Check {
  static n=0;
  static run(name, fn){ try{ fn(); Check.n++; } catch(e){ console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; } }

  /** расстановка без нарушений: всё внутри, ничего не пересекается, проход не меньше нормы, тамбур свободен */
  static plan(p, label){
    assert.ok(['ok', 'warn', 'error', 'none'].includes(p.level), label+': уровень '+p.level);
    if (p.level==='none' || p.level==='error'){ if (p.level==='error') assert.ok(p.issues.some(i=>i.level==='error'), label+': у ошибки нет текста'); return; }
    const [L, W, H]=p.int, x0=p.geo.x0||0, aMin=p.aisleRule[1], I=p.items;
    assert.ok(I.length>0, label+': ничего не расставлено');
    for (const it of I){
      for (const k of ['x', 'y', 'lx', 'ly', 'h']) assert.ok(Number.isFinite(it[k]), `${label}: поз. ${it.pos}: ${k}=${it[k]}`);
      assert.ok(it.x>=x0-1 && it.x+it.lx<=L+1, `${label}: поз. ${it.pos} вне контейнера по длине (${it.x}…${it.x+it.lx} из ${x0}…${L})`);
      assert.ok(it.y>=-1 && it.y+it.ly<=W+1, `${label}: поз. ${it.pos} вне контейнера по ширине (${it.y}…${it.y+it.ly} из ${W})`);
      assert.ok(it.h<=H, `${label}: поз. ${it.pos} выше потолка (${it.h} > ${H})`);
    }
    for (let i=0; i<I.length; i++) for (let j=i+1; j<I.length; j++){
      const a=I[i], b=I[j], ox=Math.min(a.x+a.lx, b.x+b.lx)-Math.max(a.x, b.x), oy=Math.min(a.y+a.ly, b.y+b.ly)-Math.max(a.y, b.y);
      assert.ok(!(ox>1 && oy>1), `${label}: поз. ${a.pos} и ${b.pos} пересекаются`);
    }
    const floor=I.filter(i=>!i.pipe);
    if (p.door==='service'){   // без прохода: перед каждым — сервисная дверь, до неё не меньше зазора
      assert.ok(Array.isArray(p.doors) && p.doors.length, label+': нет сервисных дверей');
      for (const it of floor){
        assert.ok(it.y>=StationLayout.DOOR_GAP[1]-1, `${label}: поз. ${it.pos} ближе ${StationLayout.DOOR_GAP[1]} мм к двери`);
        assert.ok(p.doors.some(d=>d.x0<it.x+it.lx && d.x1>it.x), `${label}: перед поз. ${it.pos} нет двери`); }
      for (const d of p.doors) assert.ok(d.x0>=0 && d.x1<=L && d.leaves>=1 && d.h>0, label+': дверь вне стены');
    } else if (p.rows===2){
      const A=floor.filter(i=>i.row===1), B=floor.filter(i=>i.row===0), gap=Math.min(...B.map(i=>i.y))-Math.max(...A.map(i=>i.y+i.ly));
      assert.ok(gap>=aMin-1, `${label}: проход между рядами ${gap} < ${aMin}`);
    } else for (const it of floor){ const need=it.kind==='dgu' ? Math.min(aMin, 600) : aMin;
      assert.ok(it.y>=need-1, `${label}: проход перед поз. ${it.pos} ${it.y} < ${need}`); }
  }

  /** SVG собран: без NaN/undefined, теги закрыты, текст экранирован */
  static svg(s, label){
    assert.ok(typeof s==='string' && s.startsWith('<svg') && s.endsWith('</svg>'), label+': не SVG');
    assert.ok(!/NaN|undefined|Infinity|\[object/.test(s), label+': '+(s.match(/.{0,60}(NaN|undefined|Infinity|\[object).{0,30}/)||[''])[0]);
    assert.ok(!/&(?!amp;|lt;|gt;|quot;|#)/.test(s), label+': неэкранированный &');
    const st=[], re=/<(\/?)([a-zA-Z][\w:-]*)[^>]*?(\/?)>/g; let m;
    while ((m=re.exec(s))){ if (m[3]) continue; if (m[1]) assert.strictEqual(st.pop(), m[2], label+': тег </'+m[2]+'> не на месте'); else st.push(m[2]); }
    assert.strictEqual(st.length, 0, label+': не закрыты теги '+st.join(','));
    const w=+(s.match(/^<svg[^>]* width="([\d.]+)"/)||[])[1], h=+(s.match(/^<svg[^>]* height="([\d.]+)"/)||[])[1];
    assert.ok(w>0 && h>0, label+': размер листа');
    return { w, h };
  }
}

let seq=0;
const P=(name, attrs, extra)=>Object.assign({ id:'p'+(++seq), name, qty:1, attrs:attrs||{}, rows:[] }, extra||{});
const C=(ctype, o)=>Object.assign({ role:'container', ctype, ins:'100 мм', size:'', sizeAuto:false, ral:'RAL 7035 / RAL 5005' }, o||{});
const solve=(cont, parts)=>StationLayout.solve({ cont, parts });
const meta=(p, title)=>({ title:title||'Станция <проверка> & «кавычки»', cont:'Контейнер', colorText:p.colorText ? 'цвет '+p.colorText : '' });
const draw=(p, label)=>{ Check.svg(StationView3D.svg(p, meta(p)), label+' (3D)'); return Check.svg(StationDrawing.svg(p, meta(p)), label+' (чертёж)'); };

const comp=P('Винтовой компрессор Dalgakiran DVK 37', { cat:'comp_screw', maker:'Dalgakiran', model:'DVK 37', kw:37, size:'1400 × 900 × 1500', mass:650 }, { role:'main' });
const dryer=P('Рефрижераторный осушитель DK 60', { cat:'dryer_refrig', model:'DK 60', size:'900 × 600 × 1100', mass:120 });
const rec=P('Воздушный ресивер РВ 500', { cat:'receiver', model:'РВ 500/11', size:'650 × 650 × 2000', mass:180 }, { rows:[{ k:'Наружное покрытие', v:'краска RAL 5010' }] });
const flt=P('Магистральный фильтр FA 33', { cat:'filter', model:'FA 33', size:'1150*430' }, { qty:2 });
const cab=P('Шкаф управления', {});
const heat=P('Система отопления и вентиляции', {});
const big=P('Винтовой компрессор DVK 75', { cat:'comp_screw', model:'DVK 75', kw:75, size:'2000 × 1100 × 1800', mass:1300 }, { role:'main', qty:2 });
const dgu=P('ДГУ AKSA AC 220', { cat:'dgu', model:'AC 220', kw:176 }, { role:'main', rows:[{ k:'Габариты Д × Ш × В', v:'3200 × 1150 × 1900 мм' }, { k:'Масса', v:'2100 кг' }, { k:'Цвет', v:'RAL7004/5005' }] });
const ats=P('Шкаф АВР', { cat:'ats' });
const tank=P('Топливный бак', {}, { rows:[{ k:'Объём', v:'1000 л' }] });
const pumpS=P('Насосный агрегат АХЕ 40-25-160', { cat:'pump', model:'АХЕ 40-25-160', kw:3, size:'965 × 305 × 392' }, { role:'main', qty:2 });
const pumpL=P('Насосный агрегат Д 630-90', { cat:'pump', model:'Д 630-90', kw:250, size:'2600 × 1100 × 1300' }, { role:'main', qty:2 });

Check.run('габариты из текста', ()=>{
  const N=t=>StationEquip.nums(t);
  assert.deepStrictEqual(N('1090 × 790 × 870'), [1090, 790, 870]);
  assert.deepStrictEqual(N('109 х 79 х 87 см'), [1090, 790, 870]);
  assert.deepStrictEqual(N('1,2×0,8×1,5'), [1200, 800, 1500]);
  assert.deepStrictEqual(N('1 260 × 780 × 1 590 мм'), [1260, 780, 1590]);
  assert.deepStrictEqual(N('610*140'), [610, 140]);
  assert.strictEqual(N('без размеров'), null);
  const f=StationEquip.dims(P('Фильтр', { cat:'filter', size:'610*140' }), 'filter');
  assert.deepStrictEqual([f.l, f.w, f.h, f.known], [140, 140, 610, true], 'два числа у фильтра: диаметр и высота');
  const r=StationEquip.dims(P('Ресивер', { cat:'receiver' }, { rows:[{ k:'Габариты (Д×Ш×В)', v:'1005 × 960 × 2175 мм' }] }), 'receiver');
  assert.deepStrictEqual([r.l, r.w, r.h, r.known], [1005, 960, 2175, true], 'габариты из строки характеристик');
  const g=StationEquip.dims(P('ДГУ 200 кВт', { cat:'dgu', kw:200 }), 'dgu');
  assert.ok(!g.known && g.l>=2500 && g.h>=1500, 'нет габаритов — условные по мощности');
});

Check.run('вид оборудования и цвет', ()=>{
  const K=(name, attrs)=>StationEquip.kindOf(P(name, attrs));
  assert.strictEqual(K('Шкаф АВР', { cat:'ats' }), 'cabinet');
  assert.strictEqual(K('Винтовой компрессор', { cat:'comp_screw' }), 'compressor');
  assert.strictEqual(K('Система отопления и вентиляции', {}), 'skip');
  assert.strictEqual(K('Шасси (прицеп)', {}), 'chassis');
  assert.deepStrictEqual(RalColor.codes('RAL7004/5005').map(x=>x.code), ['RAL 7004', 'RAL 5005']);
  assert.deepStrictEqual(RalColor.codes('цвет RAL 5010').map(x=>x.code), ['RAL 5010']);
  assert.ok(/^#[0-9A-F]{6}$/i.test(RalColor.codes('RAL 5010')[0].hex), 'RAL 5010 → цвет');
  const p=solve(C('sea20', { ral:'RAL 5010' }), [comp]);
  assert.strictEqual(p.colorText, 'RAL 5010'); assert.ok(p.colorKnown);
});

Check.run('КС в контейнере 20 футов', ()=>{
  const p=solve(C('sea20'), [C('sea20'), comp, dryer, rec, flt, cab, heat]);
  Check.plan(p, 'КС 20');
  assert.ok(['ok', 'warn'].includes(p.level), p.issues.map(i=>i.text).join(' | '));
  assert.strictEqual(p.items.filter(i=>i.kind==='filter' && i.pipe).length, 2, 'фильтры — на трубопроводе');
  assert.strictEqual(p.items.find(i=>i.kind==='cabinet').x, 0, 'шкаф — у двери');
  assert.ok(p.extra.some(e=>e.kind==='skip' && /отоплен/.test(e.name)), 'системы — в примечании, не на полу');
  draw(p, 'КС 20');
});

Check.run('не помещается в морской — ошибка и подсказка', ()=>{
  const p=solve(C('sea20'), [big, dryer, rec, cab]);
  assert.strictEqual(p.level, 'error');
  assert.ok(p.issues.some(i=>i.level==='error' && /длине|ширине/.test(i.text)));
  assert.ok(p.suggest && (p.suggest.ctype==='block' ? Array.isArray(p.suggest.size) : StationGeo.SEA[p.suggest.ctype]), JSON.stringify(p.suggest));
  const q=solve(C(p.suggest.ctype, { size:p.suggest.size ? p.suggest.size.join(' × ') : '' }), [big, dryer, rec, cab]);
  assert.notStrictEqual(q.level, 'error', 'предложенный размер подходит');
  Check.plan(q, 'подсказка');
  const d=solve(C('sea20'), [dgu, ats, tank]);
  assert.strictEqual(d.level, 'error'); assert.strictEqual(d.suggest && d.suggest.ctype, 'sea40', 'ДГУ: 40 футов вместо 20');
});

Check.run('блок-контейнер: размер по оборудованию', ()=>{
  const S=StationGeo.SERIES;
  for (const [label, parts] of [['КС', [comp, dryer, rec, flt, cab]], ['НС малые', [pumpS, cab]], ['НС большие', [pumpL]], ['ДГУ', [dgu, ats, tank]]]){
    const p=solve(C('block'), parts);
    Check.plan(p, 'блок '+label);
    assert.notStrictEqual(p.level, 'error', label+': '+p.issues.map(i=>i.text).join(' | '));
    const [L, W, H]=p.geo.ext;
    assert.ok(S.L.includes(L) && S.W.includes(W) && S.H.includes(H), label+': размер не из ряда '+p.geo.ext);
    assert.ok(W<=StationGeo.ROAD_W, label+': ширина без спецразрешения');
    draw(p, 'блок '+label);
  }
  assert.deepStrictEqual(solve(C('block'), [pumpS]).geo.ext, [4500, 2400, 2500], 'два малых насоса — 4,5 м');
  const big2=solve(C('block'), [pumpL]), [a, b]=big2.items.slice().sort((x, y)=>x.x-y.x);
  assert.ok(b.x-(a.x+a.lx)>=1000-1, 'между большими насосами не менее 1 м (СП 31.13330, п. 10.15)');
  const own=solve(C('block', { size:'3000 × 2400 × 2500' }), [comp, dryer, rec, flt, cab]);
  assert.strictEqual(own.level, 'error', 'свой размер не меняется — ошибка');
  assert.ok(own.suggest && own.suggest.ctype==='block' && own.suggest.size[0]>3000);
});

Check.run('ошибка по условным габаритам — не точная', ()=>{
  const sure=solve(C('sea20'), [Object.assign({}, big, { qty:3 }), cab]);
  assert.strictEqual(sure.level, 'error'); assert.ok(!sure.assumed, 'шкаф без габаритов не делает ошибку неточной');
  const guess=solve(C('sea20'), [P('Компрессор 250 кВт', { cat:'comp_screw', kw:250 }, { role:'main' }), cab]);
  assert.strictEqual(guess.level, 'error'); assert.ok(guess.assumed, 'не помещается только по условным габаритам');
});

Check.run('нет места для прохода — сервисные двери', ()=>{
  const deep=P('Компрессор глубокий', { cat:'comp_screw', model:'D 90', kw:90, size:'2000 × 1500 × 1800' }, { role:'main' });
  const p=solve(C('sea20'), [deep, dryer]);
  Check.plan(p, 'двери 20');
  assert.strictEqual(p.door, 'service'); assert.strictEqual(p.level, 'warn');
  assert.ok(p.issues[0].level==='warn' && /сервисные двери/.test(p.issues[0].text), p.issues[0].text);
  assert.ok(p.items.every(i=>i.y<=StationLayout.DOOR_GAP[0]+1), 'оборудование — у стены с дверями');
  const d=draw(p, 'двери 20'); assert.ok(d.w===StationDrawing.W);
  assert.ok(StationDrawing.svg(p, meta(p)).includes('сервисн'), 'на чертеже — сервисные двери');
  const auto=solve(C('block'), [deep, dryer]);
  Check.plan(auto, 'двери блок'); assert.strictEqual(auto.door, 'service');
  assert.ok(auto.geo.ext[1]<=StationGeo.ROAD_W, 'сервисные двери раньше негабаритной ширины');
  const ok=solve(C('sea20'), [comp, dryer]); assert.notStrictEqual(ok.door, 'service', 'проход помещается — двери не нужны');
});

Check.run('ДГУ: глушитель на крыше, бак рядом, топливопровод', ()=>{
  const muf=P('Глушитель на крыше', {}), fuel=P('Дополнительный топливный бак', {}, { rows:[{ k:'Объём', v:'1000 л' }] }), fl=P('Топливопровод и запорная арматура', {}, { pipeMat:'steel' });
  const p=solve(C('sea40'), [dgu, ats, muf, fuel, fl]);
  Check.plan(p, 'ДГУ+');
  const g=p.items.find(i=>i.kind==='dgu'), t=p.items.find(i=>i.kind==='tank'), m=p.roof[0];
  assert.ok(t.x+t.lx<=g.x, 'бак — перед ДГУ'); assert.ok(!p.items.some(i=>i.x>t.x && i.x<g.x), 'между баком и ДГУ ничего');
  assert.ok(m && m.x>=g.x-1 && m.x+m.lx<=p.int[0], 'глушитель — над ДГУ'); assert.ok(m.exhaust && m.exhaust.z===g.h, 'выхлоп от ДГУ');
  assert.ok(p.issues.some(i=>i.text.includes('высота станции с глушителем '+StationLayout.n(3791)) && /снимают/.test(i.text)), 'высота с глушителем и пометка о перевозке');
  const pp=p.piping[0]; assert.strictEqual(pp.mat, 'steel'); assert.strictEqual(pp.lines.length, 1, 'топливо: от бака к ДГУ');
  assert.ok(pp.lines[0].x0<=t.x+t.lx && pp.lines[0].x1>=g.x, 'линия от бака до ДГУ');
  const svg=StationDrawing.svg(p, meta(p)); Check.svg(svg, 'ДГУ+ чертёж');
  assert.ok(svg.includes('Глушитель на крыше') && svg.includes('Топливопровод'), 'глушитель и трубопровод — в экспликации');
  const sz=Check.svg(StationView3D.svg(p, meta(p)), 'ДГУ+ 3D'); assert.ok(sz.h>0);
  const bad=solve(C('sea40'), [dgu, fuel, Object.assign({}, fl, { pipeMat:'pp' })]);
  assert.ok(bad.issues.some(i=>i.level==='warn' && /полипропилена не применяют/.test(i.text)), 'топливо в полипропилене — предупреждение');
  assert.strictEqual(bad.level, 'warn');
  const inside=solve(C('sea40'), [dgu, P('Глушитель внутри контейнера', {})]); assert.strictEqual((inside.roof||[]).length, 0, '«внутри» — не на крыше');
});

Check.run('трубопровод: материал, трасса, отпечаток', ()=>{
  assert.strictEqual(PipeMaterial.of({ name:'Обвязка', rows:[{ k:'Материал', v:'нержавеющая сталь AISI 304' }] }).id, 'inox');
  assert.strictEqual(PipeMaterial.of({ name:'Трубопровод из полипропилена PP-R' }).id, 'pp');
  assert.strictEqual(PipeMaterial.of({ name:'Трубопровод', rows:[{ k:'Материал трубопровода', v:'сталь' }] }).id, 'steel');
  assert.strictEqual(PipeMaterial.of({ name:'Трубопровод' }), null);
  assert.strictEqual(PipeMaterial.dn({ rows:[{ k:'Условный проход', v:'Ду 50' }] }), 'DN 50');
  const ns=solve(C('block'), [pumpS, cab, P('Трубопроводная обвязка и запорная арматура', {}, { pipeMat:'inox' })]);
  Check.plan(ns, 'НС трубы'); const L=ns.piping[0].lines;
  assert.strictEqual(L.length, 2, 'насосы: всас и напор'); assert.deepStrictEqual(L.map(l=>l.label), ['вход', 'выход']);
  assert.ok(L.every(l=>l.x1===ns.int[0] && l.branches.length===2), 'выход через торец, отводы к обоим насосам');
  assert.strictEqual(ns.piping[0].matText, 'нержавеющая сталь');
  const ks=solve(C('sea20'), [comp, dryer, rec, flt, P('Трубопровод', {})]);
  Check.plan(ks, 'КС трубы'); assert.strictEqual(ks.piping[0].lines.length, 1);
  assert.ok(ks.issues.some(i=>/Материал трубопровода .* не выбран/.test(i.text)), 'материал не выбран — подсказка');
  for (const p of [ns, ks]){ draw(p, 'трубы'); }
  // магистраль выше оборудования — отвод заходит на его верх и спускается к нему; ниже верха — в заднюю стенку
  for (const p of [ns, ks]) for (const l of p.piping[0].lines) for (const b of l.branches){
    const it=p.items.find(i=>i.id+'#'+i.unit===b.to); assert.ok(it, 'отвод — к оборудованию станции');
    if (l.z>it.h+50) assert.ok(b.z1===Math.round(it.h) && b.x>it.x && b.x<it.x+it.lx && b.y1>it.y && b.y1<it.y+it.ly, `спуск на верх: ${it.kind}`);
    else assert.ok(b.z1===l.z && b.y1===Math.round(it.y+it.ly), `отвод в заднюю стенку: ${it.kind}`); }
  assert.ok(ns.piping[0].lines.some(l=>l.branches.some(b=>b.z1<l.z)), 'напор над насосами — со спусками');
  // номера позиций на плане — поверх трубопровода: фильтры стоят на трубе, линия не должна перечёркивать цифры
  const sv=StationDrawing.svg(ks, {}), sec=sv.slice(sv.indexOf('Вид сверху (план)'), sv.indexOf('Вид слева'));
  assert.ok(sec.indexOf('r="17"')>sec.lastIndexOf(`stroke="${ks.piping[0].color}" stroke-width="4.5"`), 'номера на плане — после трубопровода');
  const inp=m=>({ cont:C('sea20'), parts:[comp, P('Трубопровод', {}, { id:'tp', pipeMat:m })] });
  assert.notStrictEqual(StationLayout.hash(inp('steel')), StationLayout.hash(inp('pp')), 'материал — в отпечатке');
});

Check.run('ДГУ в 40 футах, «Север», шасси', ()=>{
  const p=solve(C('sea40'), [dgu, ats, tank]);
  Check.plan(p, 'ДГУ 40');
  const d=p.items.find(i=>i.kind==='dgu');
  assert.ok(d.x+d.lx>=p.int[0]-300-1, 'ДГУ — в дальнем торце');
  const n=solve(C('north', { ins:'150 мм' }), [comp, dryer, rec, cab]);
  Check.plan(n, 'Север');
  assert.strictEqual(n.geo.x0, 1200, 'тамбур 1200 мм');
  const ch=solve(C('block'), [pumpS, cab, P('Шасси (прицеп)', {})]);
  assert.ok(ch.chassis, 'шасси — на чертеже');
  draw(ch, 'шасси');
});

Check.run('нечего расставлять', ()=>{
  assert.strictEqual(solve(null, [comp]).level, 'none');
  assert.strictEqual(solve(C('sea20'), [heat, P('Освещение и электроснабжение', {})]).level, 'none');
  const p=solve(C('sea20'), [comp, P('Что-то без габаритов', {})]);
  assert.ok(p.extra.some(e=>e.nodims), 'неизвестное без габаритов — не на чертеже, в сведениях');
  assert.ok(p.issues.some(i=>i.level==='info' && /нет габаритов/.test(i.text)));
});

Check.run('отпечаток расстановки', ()=>{
  const inp=()=>({ cont:C('sea20'), parts:[comp, dryer, rec] }), h0=StationLayout.hash(inp());
  assert.strictEqual(StationLayout.hash(inp()), h0, 'одинаковый состав — одинаковый отпечаток');
  const withPhoto=inp(); withPhoto.parts=withPhoto.parts.map(p=>Object.assign({}, p, { photo:{ src:'/img/x.jpg' }, cost:12345 }));
  assert.strictEqual(StationLayout.hash(withPhoto), h0, 'фото и цена на расстановку не влияют');
  const qty=inp(); qty.parts=[Object.assign({}, comp, { qty:2 }), dryer, rec];
  assert.notStrictEqual(StationLayout.hash(qty), h0, 'количество — влияет');
  const size=inp(); size.parts=[Object.assign({}, comp, { attrs:Object.assign({}, comp.attrs, { size:'1500 × 900 × 1500' }) }), dryer, rec];
  assert.notStrictEqual(StationLayout.hash(size), h0, 'габариты — влияют');
  const ral=inp(); ral.cont=C('sea20', { ral:'RAL 3000' });
  assert.notStrictEqual(StationLayout.hash(ral), h0, 'цвет контейнера — влияет');
});

Check.run('чертёж: лист и надписи', ()=>{
  const p=solve(C('sea40'), [dgu, ats, tank]), d=StationDrawing.svg(p, meta(p, 'Название <b>с разметкой</b> & амперсандом'));
  const sz=Check.svg(d, 'чертёж');
  assert.strictEqual(sz.w, StationDrawing.W);
  assert.ok(sz.h>=StationDrawing.HMIN && sz.h<=StationDrawing.HMAX, 'высота листа '+sz.h);
  assert.ok(!d.includes('<b>') && d.includes('&lt;b&gt;'), 'название экранировано');
  assert.ok(d.includes('Экспликация оборудования') && d.includes('Проход обслуживания'), 'экспликация и проход на листе');
});

Check.run('случайные составы: без сбоев и нарушений', ()=>{
  let seed=20261011; const rnd=()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648), pick=a=>a[Math.floor(rnd()*a.length)];
  const kinds=[['comp_screw', 'Компрессор'], ['dryer_refrig', 'Осушитель'], ['receiver', 'Ресивер'], ['filter', 'Фильтр'], ['pump', 'Насос'], ['dgu', 'ДГУ'], ['ats', 'Шкаф'], ['', 'Бак топливный'], ['', 'Агрегат'],
    ['', 'Глушитель на крыше'], ['', 'Трубопроводная обвязка'], ['', 'Шкаф АСУ ТП']];
  const types=['sea20', 'sea20hc', 'sea40', 'sea40hc', 'block', 'welded', 'north'], levels={};
  for (let k=0; k<400; k++){
    const parts=[]; const m=1+Math.floor(rnd()*6);
    for (let j=0; j<m; j++){ const [cat, nm]=pick(kinds), dims=rnd()<0.8;
      const sz=dims ? [200+Math.floor(rnd()*2800), 200+Math.floor(rnd()*1400), 200+Math.floor(rnd()*2200)].join(' × ') : '';
      parts.push(P(nm+' '+k+'-'+j, { cat, size:sz, kw:Math.floor(rnd()*300), model:'M'+j }, { qty:1+Math.floor(rnd()*3), role:j ? '' : 'main', pipeMat:pick(['', 'steel', 'inox', 'pp']) })); }
    const own=rnd()<0.3 ? [3000+500*Math.floor(rnd()*19), pick([2400, 2500, 3000]), pick([2500, 2800, 3000])].join(' × ') : '';
    const cont=C(pick(types), { size:own, ins:pick(['50 мм', '100 мм', '150 мм']), ral:pick(['', 'RAL 7035', 'RAL 5010 / RAL 9003', 'синий']) });
    let p; try{ p=solve(cont, parts); } catch(e){ throw new Error(`состав ${k} (${cont.ctype} ${own}): ${e.message}`); }
    levels[p.level]=(levels[p.level]||0)+1;
    Check.plan(p, `состав ${k} (${cont.ctype} ${own})`);
    if (p.level==='ok' || p.level==='warn') draw(p, `состав ${k}`);
  }
  assert.ok(levels.ok && levels.warn && levels.error, 'в прогоне есть все исходы: '+JSON.stringify(levels));
});

console.log(process.exitCode ? 'Компоновка станций: есть ошибки' : `Компоновка станций: проверок пройдено ${Check.n}`);
