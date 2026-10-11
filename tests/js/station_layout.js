// Компоновка станций в контейнере (app/web/js/features/station-layout.js, station-eskd.js, station-draw.js): разбор габаритов
// и цвета, расстановка с проходами обслуживания, подбор контейнера, отпечаток, габаритный чертёж и схема пневматическая
// принципиальная на листе А4 по ЕСКД, 3D-вид.
// Запуск из корня репозитория: node tests/js/station_layout.js — код выхода 0, если всё прошло (tests/test_station_layout.py).
'use strict';
const vm=require('vm'), fs=require('fs'), path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');
for (const f of ['logistics-calc.js', 'station-layout.js', 'station-eskd.js', 'station-draw.js', 'station-render.js']){
  const p=path.join(ROOT, 'app', 'web', 'js', 'features', f); vm.runInThisContext(fs.readFileSync(p, 'utf8'), { filename:p }); }

class Check {
  static n=0;
  static run(name, fn){ try{ fn(); Check.n++; } catch(e){ console.error('ОШИБКА — '+name+':\n'+(e && e.stack || e)); process.exitCode=1; } }

  /** расстановка без нарушений: всё внутри (и по высоте), ничего не пересекается, проход не меньше нормы — и перед настенным
   *  шкафом (шкаф его не сужает), фильтры — на трубопроводе, у аппаратов цепочки сжатого воздуха — один вход и один выход,
   *  без прохода — у каждого агрегата сервисная дверь в стене, к которой он обращён */
  static plan(p, label){
    assert.ok(['ok', 'warn', 'error', 'none'].includes(p.level), label+': уровень '+p.level);
    if (p.level==='none' || p.level==='error'){ if (p.level==='error') assert.ok(p.issues.some(i=>i.level==='error'), label+': у ошибки нет текста'); return; }
    const [L, W, H]=p.int, x0=p.geo.x0||0, aMin=p.aisleRule[1], I=p.items, G=StationLayout.DOOR_GAP;
    assert.ok(I.length>0, label+': ничего не расставлено');
    for (const it of I){
      for (const k of ['x', 'y', 'z', 'lx', 'ly', 'h']) assert.ok(Number.isFinite(it[k]), `${label}: поз. ${it.pos}: ${k}=${it[k]}`);
      assert.ok(['floor', 'wall', 'frame', 'pipe'].includes(it.mount), `${label}: поз. ${it.pos}: крепление ${it.mount}`);
      assert.ok(it.x>=x0-1 && it.x+it.lx<=L+1, `${label}: поз. ${it.pos} вне контейнера по длине (${it.x}…${it.x+it.lx} из ${x0}…${L})`);
      assert.ok(it.y>=-1 && it.y+it.ly<=W+1, `${label}: поз. ${it.pos} вне контейнера по ширине (${it.y}…${it.y+it.ly} из ${W})`);
      assert.ok(it.z>=-1 && it.z+it.h<=H+1, `${label}: поз. ${it.pos} вне контейнера по высоте (${it.z}…${it.z+it.h} из ${H})`);
      if (it.mount==='floor') assert.strictEqual(it.z, 0, `${label}: поз. ${it.pos} на полу`);
      if (it.mount==='wall'){ assert.ok(Math.abs(it.y)<=1 || Math.abs(it.y+it.ly-W)<=1 || Math.abs(it.x-x0)<=1 || Math.abs(it.x+it.lx-L)<=1, `${label}: настенный шкаф поз. ${it.pos} не на стене`);
        assert.ok(it.z>=StationLayout.CAB_LOW-1, `${label}: настенный шкаф поз. ${it.pos} ниже ${StationLayout.CAB_LOW} мм`); }
      if (it.mount==='frame') assert.strictEqual(p.door, 'service', `${label}: шкаф на раме — только без прохода`);
      if (it.mount==='pipe'){ const xc=it.x+it.lx/2;
        assert.ok((p.lines||[]).some(l=>l.y>=it.y-1 && l.y<=it.y+it.ly+1 && StationLayout.runs(l).some(([a, b])=>xc>=a-1 && xc<=b+1) && l.z>=it.z && l.z<=it.z+it.h), `${label}: фильтр поз. ${it.pos} не на трубопроводе`);
        assert.ok(it.z>=149, `${label}: фильтр поз. ${it.pos} ниже 150 мм от пола`); }
    }
    for (let i=0; i<I.length; i++) for (let j=i+1; j<I.length; j++){
      const a=I[i], b=I[j], ox=Math.min(a.x+a.lx, b.x+b.lx)-Math.max(a.x, b.x), oy=Math.min(a.y+a.ly, b.y+b.ly)-Math.max(a.y, b.y), oz=Math.min(a.z+a.h, b.z+b.h)-Math.max(a.z, b.z);
      assert.ok(!(ox>1 && oy>1 && oz>1), `${label}: поз. ${a.pos} и ${b.pos} пересекаются`);
    }
    const floor=I.filter(i=>i.mount==='floor' || i.mount==='frame');
    if (p.door==='service'){   // без прохода: перед каждым — сервисная дверь в его стене, до неё не меньше зазора
      assert.ok(Array.isArray(p.doors) && p.doors.length, label+': нет сервисных дверей');
      for (const it of floor){ const fr=it.face<=0, bk=it.face>=0;
        if (fr){ assert.ok(it.y>=G[1]-1, `${label}: поз. ${it.pos} ближе ${G[1]} мм к двери`); assert.ok(p.doors.some(d=>d.wall==='front' && d.x0<it.x+it.lx && d.x1>it.x), `${label}: перед поз. ${it.pos} нет двери`); }
        if (bk){ assert.ok(W-it.y-it.ly>=G[1]-1, `${label}: поз. ${it.pos} ближе ${G[1]} мм к двери в задней стене`); assert.ok(p.doors.some(d=>d.wall==='back' && d.x0<it.x+it.lx && d.x1>it.x), `${label}: за поз. ${it.pos} нет двери`); } }
      for (const d of p.doors) assert.ok(['front', 'back'].includes(d.wall) && d.x0>=0 && d.x1<=L && d.leaves>=1 && d.h>0, label+': дверь вне стены');
      for (const d of p.doors) assert.ok(d.w>=StationLayout.DOOR_MIN, `${label}: проём ${d.w} мм уже ${StationLayout.DOOR_MIN} мм`);
      for (const w of ['front', 'back']){ const D=p.doors.filter(d=>d.wall===w).sort((a, b)=>a.x0-b.x0);
        for (let k=1; k<D.length; k++) assert.ok(D[k].x0>=D[k-1].x1+99, `${label}: проёмы в стене ${w} без простенка`); }
    } else if (p.rows===2){
      const A=floor.filter(i=>i.row===1), B=floor.filter(i=>i.row===0), gap=Math.min(...B.map(i=>i.y))-Math.max(...A.map(i=>i.y+i.ly));
      assert.ok(gap>=aMin-1, `${label}: проход между рядами ${gap} < ${aMin}`);
    } else for (const it of floor){ const need=it.kind==='dgu' ? Math.min(aMin, 600) : aMin;
      assert.ok(it.y>=need-1, `${label}: проход перед поз. ${it.pos} ${it.y} < ${need}`);
      for (const c of I.filter(i=>i.mount==='wall' && i.wall==='front' && i.x<it.x+it.lx && i.x+i.lx>it.x))   // шкаф не сужает проход
        assert.ok(it.y-c.y-c.ly>=aMin-1, `${label}: перед шкафом поз. ${c.pos} проход ${it.y-c.y-c.ly} < ${aMin}`); }
    for (const c of I.filter(i=>i.mount==='wall' && (i.wall==='left' || i.wall==='right'))){   // на торце: перед ним вдоль контейнера — проход
      const z0=c.wall==='left' ? c.x : c.x-aMin, z1=c.wall==='left' ? c.x+c.lx+aMin : c.x+c.lx;
      assert.ok(Math.abs(c.face)===2 && (c.wall==='left' ? c.x<=1+(p.geo.x0||0) : c.x+c.lx>=L-1), `${label}: шкаф поз. ${c.pos} не на торце`);
      assert.ok(!floor.some(i=>i.x<z1 && i.x+i.lx>z0 && i.y<c.y+c.ly && i.y+i.ly>c.y), `${label}: перед шкафом на торце поз. ${c.pos} нет прохода`); }
    // сжатый воздух: у аппарата цепочки — один вход и один выход, магистраль внутри него прервана, по ходу — слева направо
    for (const l of (p.lines||[]).filter(x=>x.medium==='air')) for (const it of floor.filter(StationLayout.series)){
      const B=l.branches.filter(b=>b.to===it.id+'#'+it.unit); if (!B.length) continue;
      const pin=B.filter(b=>b.role==='in'), pout=B.filter(b=>b.role==='out');
      assert.ok(pin.length<=1 && pout.length<=1 && B.length===pin.length+pout.length, `${label}: у поз. ${it.pos} не один вход и один выход`);
      if (pin.length && pout.length){ assert.ok(pin[0].x<pout[0].x, `${label}: поз. ${it.pos} — вход после выхода`);
        assert.ok(!StationLayout.runs(l).some(([a, b])=>a<pout[0].x-1 && b>pin[0].x+1), `${label}: магистраль идёт мимо поз. ${it.pos}, а не через неё`); } }
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

  /** лист ЕСКД: А4 (210 × 297 мм, растр — EskdSheet.K точек на мм), надписи — внутри листа и не наезжают друг на друга
   *  (ширина — по EskdSheet.tw; обозначение в графе 26 повёрнуто на 180° — не проверяется) */
  static sheet(s, label){
    const sz=Check.svg(s, label), K=EskdSheet.K, [W, H]=EskdSheet.FMT.A4;
    assert.ok(sz.w===W*K && sz.h===H*K && s.includes(`viewBox="0 0 ${W} ${H}"`), `${label}: лист ${sz.w}×${sz.h}`);
    const T=Check.texts(s);
    assert.strictEqual(T.length, (s.match(/<text /g)||[]).length, label+': надпись не в формате листа');
    const V=T.filter(q=>q.rot!==180);
    for (const q of V){ const [x0, y0, x1, y1]=q.b; assert.ok(x0>=7.8 && x1<=W-4.7 && y0>=4.8 && y1<=H, `${label}: «${q.t}» вне листа (${q.b.map(v=>v.toFixed(1))})`); }
    for (let i=0; i<V.length; i++) for (let j=i+1; j<V.length; j++){ const a=V[i].b, b=V[j].b, ox=Math.min(a[2], b[2])-Math.max(a[0], b[0]), oy=Math.min(a[3], b[3])-Math.max(a[1], b[1]);
      assert.ok(!(ox>0.4 && oy>0.4), `${label}: «${V[i].t}» наезжает на «${V[j].t}»`); }
    return sz;
  }
  /** надписи листа: текст, поворот и границы [x0, y0, x1, y1], мм */
  static texts(s){
    const out=[], re=/<text x="([\d.-]+)" y="([\d.-]+)" font-size="([\d.]+)"(?: text-anchor="(\w+)")?(?: transform="rotate\(([-\d.]+)[^"]*\)")?[^>]*>([^<]*)<\/text>/g; let m;
    while ((m=re.exec(s))){
      const x=+m[1], y=+m[2], h=+m[3]/EskdSheet.CAP, a=m[4]||'start', rot=+(m[5]||0), t=m[6].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'), w=EskdSheet.tw(t, h);
      let b; if (!rot){ const x0=a==='middle' ? x-w/2 : a==='end' ? x-w : x; b=[x0, y-h, x0+w, y+0.25*h]; }
      else { const y0=a==='middle' ? y-w/2 : a==='end' ? y : y-w; b=[x-h, y0, x+0.25*h, y0+w]; }
      out.push({ t, rot, b }); }
    return out;
  }
}

let seq=0;
const P=(name, attrs, extra)=>Object.assign({ id:'p'+(++seq), name, qty:1, attrs:attrs||{}, rows:[] }, extra||{});
const C=(ctype, o)=>Object.assign({ role:'container', ctype, ins:'100 мм', size:'', sizeAuto:false, ral:'RAL 7035 / RAL 5005' }, o||{});
const solve=(cont, parts)=>StationLayout.solve({ cont, parts });
const meta=(p, title)=>({ title:title||'Станция <проверка> & «кавычки»', cont:'Контейнер', colorText:p.colorText ? 'цвет '+p.colorText : '', org:'ООО «ПНЕВМОТЕХ»', dev:'Иванов И. И.', date:'2026-10-11' });
const draw=(p, label)=>{ Check.svg(StationView3D.svg(p, meta(p)), label+' (3D)');
  if (StationScheme.ok(p)) Check.sheet(StationScheme.svg(p, meta(p)), label+' (схема)');
  return Check.sheet(StationDrawing.svg(p, meta(p)), label+' (чертёж)'); };

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
  assert.strictEqual(p.items.filter(i=>i.kind==='filter' && i.mount==='pipe').length, 2, 'фильтры — на трубопроводе');
  const cb=p.items.find(i=>i.kind==='cabinet'); assert.ok(cb.mount==='wall' && cb.wall==='front' && cb.x<=300, 'шкаф — на стене прохода у двери');
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
  const d=solve(C('sea20'), [dgu, Object.assign({}, ats, { mount:'floor' }), tank]);
  Check.plan(d, 'ДГУ с напольным АВР в 20 футах');
  assert.strictEqual(d.door, 'service', 'ДГУ с напольным АВР в 20 футах — без прохода, двери с обеих сторон');
  assert.ok(d.suggest && d.suggest.aisle && d.suggest.ctype==='sea40', 'с проходом внутри — 40 футов: '+JSON.stringify(d.suggest));
  const a=solve(C('sea20'), [dgu, ats, tank]); Check.plan(a, 'ДГУ, АВР на стене');
  assert.ok(a.level!=='error' && a.door!=='service', 'АВР на стене — ДГУ с проходом помещается в 20 футов');
});

Check.run('блок-контейнер: размер по необходимому месту', ()=>{
  const worse=(p, parts, e)=>{ const q=solve(C('block', { size:e.join(' × ') }), parts), w=x=>x.issues.filter(i=>i.level==='warn' && !i.big).length;
    return q.level==='error' || (q.door==='service' && p.door!=='service') || w(q)>w(p); };
  for (const [label, parts] of [['КС', [comp, dryer, rec, flt, cab]], ['НС малые', [pumpS, cab]], ['НС большие', [pumpL]], ['ДГУ', [dgu, ats, tank]]]){
    const p=solve(C('block'), parts);
    Check.plan(p, 'блок '+label);
    assert.notStrictEqual(p.level, 'error', label+': '+p.issues.map(i=>i.text).join(' | '));
    const [L, W, H]=p.geo.ext;
    assert.ok([L, W, H].every(v=>v%StationGeo.STEP===0), label+': размер не кратен 100 мм '+p.geo.ext);
    assert.ok(W<=StationGeo.ROAD_W, label+': ширина без спецразрешения');
    assert.ok(worse(p, parts, [L-100, W, H]), label+': на 100 мм короче — тоже годится: размер с запасом '+p.geo.ext);
    assert.ok(W-100<StationGeo.BLOCK.minW || worse(p, parts, [L, W-100, H]), label+': на 100 мм уже — тоже годится '+p.geo.ext);
    draw(p, 'блок '+label);
  }
  assert.deepStrictEqual(solve(C('block'), [pumpS]).geo.ext, [4300, 1900, 2500], 'два малых насоса — 4,3 × 1,9 м (было 4,5 × 2,4)');
  const big2=solve(C('block'), [pumpL]), [a, b]=big2.items.slice().sort((x, y)=>x.x-y.x);
  assert.ok(b.x-(a.x+a.lx)>=1000-1, 'между большими насосами не менее 1 м (СП 31.13330, п. 10.15)');
  const own=solve(C('block', { size:'3000 × 2400 × 2500' }), [comp, dryer, rec, flt, cab]);
  assert.strictEqual(own.level, 'error', 'свой размер не меняется — ошибка');
  assert.ok(own.suggest && own.suggest.ctype==='block' && own.suggest.size[0]>3000);
  const roomy=solve(C('block', { size:'9000 × 2500 × 3000' }), [pumpS, cab]);
  assert.ok(roomy.suggest && roomy.suggest.smaller && roomy.suggest.size[0]<9000, 'свой размер с большим запасом — подсказка «достаточно»');
  assert.ok(roomy.issues.some(i=>i.big && /с запасом/.test(i.text)));
});

Check.run('ошибка по условным габаритам — не точная', ()=>{
  const sure=solve(C('sea20'), [Object.assign({}, big, { qty:3 }), cab]);
  assert.strictEqual(sure.level, 'error'); assert.ok(!sure.assumed, 'шкаф без габаритов не делает ошибку неточной');
  const guess=solve(C('sea20'), [P('Компрессор 250 кВт', { cat:'comp_screw', kw:250 }, { role:'main' }), cab]);
  assert.strictEqual(guess.level, 'error'); assert.ok(guess.assumed, 'не помещается только по условным габаритам');
});

Check.run('нет места для прохода — сервисные двери с любой стороны', ()=>{
  const deep=P('Компрессор глубокий', { cat:'comp_screw', model:'D 90', kw:90, size:'2000 × 1500 × 1800' }, { role:'main' });
  const p=solve(C('sea20'), [deep, dryer]);
  Check.plan(p, 'двери 20');
  assert.strictEqual(p.door, 'service'); assert.strictEqual(p.level, 'warn');
  assert.ok(p.issues[0].level==='warn' && /сервисные двери/.test(p.issues[0].text), p.issues[0].text);
  assert.ok(p.items.filter(i=>i.mount==='floor').every(i=>i.y<=StationLayout.DOOR_GAP[0]+1), 'оборудование — у стены с дверями');
  assert.ok(p.suggest && p.suggest.aisle, 'подсказка: какой контейнер нужен с проходом внутри');
  const d=draw(p, 'двери 20'); assert.ok(d.w===StationDrawing.W);
  assert.ok(StationDrawing.svg(p, meta(p)).includes('сервисн'), 'на чертеже — сервисные двери');
  const auto=solve(C('block'), [deep, dryer]);
  Check.plan(auto, 'двери блок'); assert.strictEqual(auto.door, 'service');
  assert.ok(auto.geo.ext[1]<=StationGeo.ROAD_W, 'сервисные двери раньше негабаритной ширины');
  const ok=solve(C('sea20'), [comp, dryer]); assert.notStrictEqual(ok.door, 'service', 'проход помещается — двери не нужны');
  // в один ряд не помещается по длине — два ряда спиной друг к другу, двери в обеих стенах
  const unit=P('Осушитель адсорбционный', { cat:'dryer_ads', model:'A 13', size:'800 × 800 × 1200' }, { qty:5 });
  const two=solve(C('sea20'), [unit]);
  Check.plan(two, 'два ряда без прохода'); assert.strictEqual(two.door, 'service'); assert.strictEqual(two.rows, 2);
  assert.ok(two.doors.some(x=>x.wall==='front') && two.doors.some(x=>x.wall==='back'), 'двери — в обеих длинных стенах');
  assert.ok(/обеих боковых стенах/.test(two.issues[0].text), two.issues[0].text);
  draw(two, 'два ряда без прохода');
  // ДГУ во всю ширину — посередине, двери с обеих сторон
  const wide=P('ДГУ 500 кВт', { cat:'dgu', model:'G 500', kw:500, size:'4000 × 1700 × 1800' }, { role:'main' });
  const g=solve(C('sea40'), [wide]);
  Check.plan(g, 'ДГУ без прохода'); const gi=g.items.find(i=>i.kind==='dgu');
  assert.strictEqual(g.door, 'service'); assert.strictEqual(gi.face, 0, 'ДГУ — посередине');
  assert.ok(g.doors.some(x=>x.wall==='front') && g.doors.some(x=>x.wall==='back'), 'у ДГУ — двери с обеих сторон');
  // соседние проёмы — со стойкой между ними, не сливаются в один
  assert.ok(auto.doors.length>=2, 'отдельные проёмы: '+JSON.stringify(auto.doors));
});

Check.run('шкафы на стене, фильтры на трубопроводе', ()=>{
  const pipe=P('Трубопроводная обвязка', {}, { pipeMat:'steel' });
  const p=solve(C('sea20'), [comp, dryer, rec, flt, cab, ats, pipe]);
  Check.plan(p, 'шкафы и фильтры');
  const cabs=p.items.filter(i=>i.kind==='cabinet');
  assert.ok(cabs.length===2 && cabs.every(c=>c.mount==='wall' && c.wall==='front'), 'шкафы без габаритов — настенные, на стене прохода');
  assert.ok(cabs.every(c=>c.z+c.h<=StationLayout.CAB_TOP+1), 'верх шкафа — не выше 1,9 м');
  const F=p.items.filter(i=>i.kind==='filter');
  assert.ok(F.length===2 && F.every(f=>f.mount==='pipe' && f.z>0), 'фильтры висят на трубе');
  const dr=p.items.find(i=>i.kind==='dryer'); assert.ok(F.some(f=>f.x>=dr.x), 'фильтры — после осушителя по ходу воздуха');
  assert.strictEqual(p.used.x0, p.items.filter(i=>i.mount==='floor').reduce((m, i)=>Math.min(m, i.x), Infinity), 'шкафы и фильтры не занимают пол');
  // напольный: выбран в составе, назван так или большой по габаритам
  const fl1=solve(C('sea20'), [comp, Object.assign({}, cab, { mount:'floor' })]), fl2=solve(C('sea20'), [comp, P('Шкаф управления напольный', {})]);
  const fl3=solve(C('sea20'), [comp, P('Шкаф АВР', { cat:'ats', size:'800 × 600 × 2000' })]);
  for (const [q, l] of [[fl1, 'выбран'], [fl2, 'назван'], [fl3, 'габариты']]){ Check.plan(q, 'напольный '+l); assert.strictEqual(q.items.find(i=>i.kind==='cabinet').mount, 'floor', 'напольный: '+l); }
  assert.strictEqual(StationEquip.mount(P('Шкаф', { size:'600 × 300 × 1000' }), StationEquip.dims(P('Шкаф', { size:'600 × 300 × 1000' }), 'cabinet')), 'wall', 'невысокий и неглубокий — на стене');
  // без прохода — шкаф на раме за своей сервисной дверью
  const deep=P('Компрессор глубокий', { cat:'comp_screw', model:'D 90', kw:90, size:'2000 × 1500 × 1800' }, { role:'main' });
  const d=solve(C('sea20'), [deep, cab]); Check.plan(d, 'шкаф без прохода');
  assert.strictEqual(d.items.find(i=>i.kind==='cabinet').mount, 'frame');
  // трубопровода в составе нет — фильтры всё равно на линии, подсказка добавить обвязку
  const np=solve(C('sea20'), [comp, dryer, flt]); Check.plan(np, 'фильтры без обвязки');
  assert.ok(np.piping.length===1 && np.piping[0].implicit && np.piping[0].pos==null, 'линия условно, без номера позиции');
  assert.ok(np.issues.some(i=>/трубопроводной обвязки в составе нет/.test(i.text)));
  const svg=StationDrawing.svg(p, meta(p)); Check.svg(svg, 'шкафы и фильтры');
  assert.ok(/на стене/.test(svg) && /на трубопроводе/.test(svg), 'на чертеже — примечание: шкафы на стене, фильтры на трубопроводе');
  draw(np, 'фильтры без обвязки');
});

Check.run('сжатый воздух: последовательно, фильтры по назначению, подбор', ()=>{
  const G=(name, attrs, rows)=>AirChain.grade({ name, attrs:attrs||{}, rows:rows||[] }, (attrs||{}).cat||'filter', AirChain.text({ name, attrs:attrs||{}, rows:rows||[] }));
  assert.strictEqual(G('Фильтр', { stage:'Предварительная' }), 'pre'); assert.strictEqual(G('Фильтр', { stage:'Сверхтонкая (микрофильтр)' }), 'micro');
  assert.strictEqual(G('Фильтр угольный FD'), 'carbon'); assert.strictEqual(G('Фильтр коалесцентный 0,01 мкм'), 'micro'); assert.strictEqual(G('Фильтр тонкой очистки 1 мкм'), 'fine');
  assert.strictEqual(G('Пылевой фильтр'), 'dust'); assert.strictEqual(G('Фильтр предварительной очистки 3 мкм'), 'pre'); assert.strictEqual(G('Atlas Copco PD 32+'), 'micro');
  assert.strictEqual(G('Сепаратор конденсата', { cat:'oil_sep' }), 'cond'); assert.strictEqual(G('Циклонный влагоотделитель'), 'sep'); assert.strictEqual(G('Магистральный фильтр FA 110'), '');
  const I=(name, attrs, kind, rows)=>AirChain.info({ name, attrs:attrs||{}, rows:rows||[] }, kind);
  assert.ok(I('Компрессор Remeza ВК15 со встроенным осушителем', {}, 'compressor').dryer && I('Компрессор', { dryer:'Да' }, 'compressor').dryer && !I('Компрессор', { dryer:'Нет' }, 'compressor').dryer);
  assert.ok(I('Компрессор GA 37 VSD', {}, 'compressor').vsd && I('Компрессор с осушителем и фильтрами', {}, 'compressor').filter);
  assert.ok(I('Осушитель DK 60 со встроенными фильтрами', {}, 'dryer').filters && I('Осушитель CD 50', { cat:'dryer_ads' }, 'dryer').type==='ads');
  assert.strictEqual(I('Ресивер сухой 500 л', {}, 'receiver').role, 'dry'); assert.ok(Math.abs(AirChain.flow({ attrs:{}, rows:[{ k:'Производительность', v:'6 200 л/мин' }] })-6.2)<1e-9);
  assert.ok(Math.abs(AirChain.kp(7)-1)<1e-9 && AirChain.kp(10)>1.1 && AirChain.kp(5)<0.9, 'поправка на давление');
  // КС: компрессор → ресивер → фильтр до осушителя → осушитель → фильтр после; у осушителя и ресивера — вход и выход
  const c62=P('Винтовой компрессор', { cat:'comp_screw', model:'K 37', kw:37, flow:6.2, pressure:8, size:'1400 × 900 × 1500' }, { role:'main' });
  const dr6=P('Рефрижераторный осушитель', { cat:'dryer_refrig', model:'R 70', flow:7.5, size:'900 × 600 × 1100' });
  const rc=P('Ресивер', { cat:'receiver', model:'РВ 900', volume:900, size:'750 × 750 × 2100' });
  const two=P('Магистральный фильтр FA 110', { cat:'filter', model:'FA 110', flow:8, size:'610*140' }, { qty:2 });
  const ks=solve(C('block'), [c62, dr6, rc, two, P('Трубопровод', {}, { pipeMat:'steel' })]); Check.plan(ks, 'КС цепочка'); draw(ks, 'КС цепочка');
  assert.deepStrictEqual(ks.air.chain.map(c=>c.kind), ['compressor', 'receiver', 'filter', 'dryer', 'filter'], 'по ходу воздуха');
  const it=k=>ks.items.find(i=>i.kind===k), air=ks.lines.find(l=>l.medium==='air'), port=(k, r)=>air.branches.find(b=>b.to===it(k).id+'#0' && b.role===r);
  assert.ok(it('compressor').x<it('receiver').x && it('receiver').x<it('dryer').x, 'ряд — по ходу воздуха');
  const F=ks.items.filter(i=>i.kind==='filter').sort((a, b)=>a.x-b.x);
  assert.ok(F[0].air.grade==='pre' && F[0].x+F[0].lx<=port('dryer', 'in').x && F[0].x>port('receiver', 'out').x, 'фильтр предварительной очистки — между ресивером и входом осушителя');
  assert.ok(F[1].air.grade==='micro' && F[1].x>=port('dryer', 'out').x, 'тонкой очистки — после выхода осушителя');
  assert.ok(port('receiver', 'in').z1<port('receiver', 'out').z1, 'ресивер: вход внизу, выход вверху');
  assert.ok(!ks.issues.some(i=>i.air && i.level==='warn'), 'по составу замечаний нет: '+ks.issues.filter(i=>i.air).map(i=>i.text).join(' | '));
  const sv=StationDrawing.svg(ks, meta(ks)); assert.ok(/Сжатый воздух — последовательно: поз\. [\d → ]+ → к потребителю/.test(sv), 'на чертеже — цепочка');
  assert.ok(StationScheme.svg(ks, meta(ks)).includes('один вход и один выход'), 'на схеме — один вход и один выход');
  // адсорбционный: перед ним — фильтр от масла (нет — предупреждение и подбор), после — пылевой
  const ad=P('Адсорбционный осушитель', { cat:'dryer_ads', model:'A 60', flow:7, size:'900 × 700 × 1700' });
  const a0=solve(C('block'), [c62, ad, rc]); Check.plan(a0, 'адсорбционный без фильтров');
  assert.ok(a0.issues.some(i=>i.level==='warn' && /Перед адсорбционным осушителем .* фильтр очистки от масла/.test(i.text)), 'нет фильтра от масла — предупреждение');
  assert.ok(a0.air.recs.some(r=>r.key==='micro' && r.cat==='filter' && r.f.stage) && a0.air.recs.some(r=>r.key==='dust'), 'подбор: от масла и пылевой');
  const a1=solve(C('block'), [c62, ad, rc, P('Магистральный фильтр', { cat:'filter', model:'X 1', size:'610*140' })]); Check.plan(a1, 'адсорбционный + фильтр');
  const f1=a1.items.find(i=>i.kind==='filter'), adIt=a1.items.find(i=>i.kind==='dryer'), aIn=a1.lines.find(l=>l.medium==='air').branches.find(b=>b.to===adIt.id+'#0' && b.role==='in');
  assert.ok(f1.air.grade==='micro' && f1.x+f1.lx<=aIn.x, 'фильтр без ступени — от масла перед адсорбционным');
  assert.ok(!a1.issues.some(i=>/Перед адсорбционным/.test(i.text)));
  // встроенные: фильтры в осушителе — без подсказки; осушитель в компрессоре — осушитель для класса не нужен
  const bi=solve(C('block'), [c62, P('Осушитель DK 80 со встроенными фильтрами', { cat:'dryer_refrig', flow:8, size:'900 × 600 × 1100' }), rc]);
  assert.ok(!bi.issues.some(i=>/Фильтров в составе нет/.test(i.text)), 'встроенные фильтры осушителя');
  const ff=solve(C('block'), [P('Компрессор GA 37 FF со встроенным осушителем', { cat:'comp_screw', flow:6, size:'1800 × 900 × 1600' }, { role:'main' }), rc]);
  assert.ok(ff.air.chain[0].text.includes('встроенным осушителем'));
  const ffc=StationLayout.solve({ cont:C('block'), parts:[ff.items.find(i=>i.kind==='compressor') && P('Компрессор GA 37 FF со встроенным осушителем', { cat:'comp_screw', flow:6, size:'1800 × 900 × 1600' }, { role:'main' }), rc], air:'2.4.2' });
  assert.ok(!ffc.air.recs.some(r=>/^dryer/.test(r.key)), 'класс 2.4.2: встроенного осушителя достаточно');
  // производительность: осушитель и фильтр меньше компрессоров — предупреждение и подбор
  const small=solve(C('block'), [c62, P('Осушитель', { cat:'dryer_refrig', flow:3, size:'700 × 500 × 900' }), rc, P('Фильтр тонкой очистки', { cat:'filter', flow:2, size:'500*120' })]);
  assert.ok(small.issues.some(i=>i.level==='warn' && /Осушитель .* меньше производительности компрессоров/.test(i.text)), 'осушитель мал');
  assert.ok(small.issues.some(i=>i.level==='warn' && /Фильтр .* меньше производительности/.test(i.text)), 'фильтр мал');
  assert.ok(small.air.recs.some(r=>r.key==='dryer-refrig' && +String(r.r.flow[0]).replace(',', '.')>=6.2), 'подбор осушителя с запасом');
  // ресивер: нет — рекомендуемый объём; частотный компрессор — меньше
  const nr=solve(C('block'), [c62, dr6]); const rr=nr.air.recs.find(r=>r.key==='receiver');
  assert.ok(rr && nr.issues.some(i=>/Ресивера в составе нет/.test(i.text)), 'ресивер рекомендован');
  const vs=solve(C('block'), [P('Компрессор VSD', { cat:'comp_screw', flow:6.2, vsd:'Да', size:'1400 × 900 × 1500' }, { role:'main' }), dr6]);
  assert.ok(+vs.air.recs.find(r=>r.key==='receiver').r.volume[0]<+rr.r.volume[0], 'с частотным — ресивер меньше');
  // класс чистоты: вода класса 2 — адсорбционный (−40 °C)
  const cl=StationLayout.solve({ cont:C('block'), parts:[c62, dr6, rc, two], air:'1.2.1' });
  assert.ok(cl.issues.some(i=>i.level==='warn' && /нужен адсорбционный осушитель/.test(i.text)));
  const ra=cl.air.recs.find(r=>r.key==='dryer-ads'); assert.ok(ra && ra.f.dewPoint==='−40' && ra.cat==='dryer_ads', 'подбор адсорбционного −40 °C');
  assert.ok(cl.air.recs.some(r=>r.key==='carbon'), 'масло класса 1 — угольный');
  assert.strictEqual(StationLayout.hash({ cont:C('block'), parts:[c62] }), StationLayout.hash({ cont:C('block'), parts:[c62], air:'1.2.1' }), 'класс не меняет картинки');
  // два ряда, компрессоры по обе стороны от входа ресивера — коллектор отдельной трубой
  const tw=solve(C('sea20'), [P('Компрессор', { cat:'comp_screw', flow:5, size:'1200 × 800 × 1500' }, { role:'main', qty:3 }), P('Осушитель', { cat:'dryer_refrig', flow:16, size:'900 × 700 × 1200' }),
    P('Ресивер', { cat:'receiver', volume:900, size:'750 × 750 × 1900' }), P('Шкаф управления', {})]);
  assert.strictEqual(tw.rows, 2, 'два ряда');
  Check.plan(tw, 'два ряда цепочка'); draw(tw, 'два ряда цепочка');
  const AL=tw.lines.filter(l=>l.medium==='air'); for (const c of tw.items.filter(i=>i.kind==='compressor')) assert.ok(AL.some(l=>l.branches.some(b=>b.to===c.id+'#'+c.unit && b.role==='out')), 'каждый компрессор — в коллектор');
  if (AL.length>1) assert.ok(AL.some(l=>l.header) && new Set(AL.map(l=>l.z)).size===2, 'коллектор — на другой высоте');
});

Check.run('шкафы не сужают проход, торец; двери не уже 600 мм', ()=>{
  // компрессор напротив почти всей стены прохода: шкаф там сузил бы проход — шкафы на торцах (у двери и дальнем)
  const long=P('Компрессор', { cat:'comp_screw', size:'2500 × 900 × 1500' }, { role:'main' });
  const p=solve(C('block', { size:'3600 × 2300 × 2600' }), [long, P('Шкаф управления', {}), P('Шкаф АСУ ТП', {})]); Check.plan(p, 'шкафы — торец');
  const cabs=p.items.filter(i=>i.kind==='cabinet');
  assert.deepStrictEqual(cabs.map(c=>c.wall).sort(), ['left', 'right'], 'шкафы — на торцах: '+cabs.map(c=>c.wall).join(','));
  assert.ok(cabs.every(c=>c.mount==='wall' && Math.abs(c.face)===2 && c.lx===250 && c.ly===600), 'на торце — вдоль стены, дверцей в помещение');
  draw(p, 'шкафы — торец');
  const dg=solve(C('sea20'), [dgu, cab]); assert.ok(!dg.items.some(i=>i.wall==='left' || i.wall==='right'), 'у морского — в торце двери, у ДГУ — жалюзи: не на торцах');
  const aMin=p.aisleRule[1];
  for (const c of cabs.filter(x=>x.wall==='front')) for (const i of p.items.filter(x=>x.mount==='floor' && x.x<c.x+c.lx && x.x+x.lx>c.x)) assert.ok(i.y-c.ly>=aMin-1, 'шкаф не сужает проход');
  assert.ok(/на стене, низ на высоте [\d ]+ мм; проход перед ними — не менее/.test(StationDrawing.svg(p, meta(p))), 'шкафы не сужают проход — в технических требованиях');
  assert.strictEqual(StationLayout.DOOR_MIN, 600);
  assert.ok(StationLayout.ENTRY[1]-StationLayout.ENTRY[0]>=StationLayout.DOOR_MIN, 'входная дверь — не уже 600 мм');
  const sv=StationDrawing.svg(solve(C('block'), [comp]), meta(p)); assert.ok(/Входная дверь 900 мм \(не менее 600 мм в свету\) открывается наружу/.test(sv), 'на чертеже — дверь оператора');
});

Check.run('морской контейнер с запасом — подсказка меньшего', ()=>{
  const p=solve(C('sea40'), [dgu, ats, tank]);
  assert.ok(p.suggest && p.suggest.smaller && p.suggest.ctype==='sea20', 'ДГУ в 40 футах — достаточно 20: '+JSON.stringify(p.suggest));
  assert.ok(p.issues.some(i=>i.big && /20 футов/.test(i.text)));
  const q=solve(C('sea20'), [comp, dryer, rec]); assert.ok(!(q.suggest && q.suggest.smaller), 'в меньший с проходом не помещается — подсказки нет');
  const t=solve(C('sea20'), [P('Компрессор малый', { cat:'comp_screw', kw:7, size:'800 × 600 × 900' }, { role:'main' })]);
  assert.ok(t.suggest && t.suggest.ctype==='sea10', 'один малый компрессор — контейнер 10 футов: '+JSON.stringify(t.suggest));
  Check.plan(solve(C('sea10'), [P('Компрессор малый', { cat:'comp_screw', kw:7, size:'800 × 600 × 900' }, { role:'main' })]), '10 футов');
});

Check.run('ДГУ: глушитель на крыше, бак рядом, топливопровод', ()=>{
  const muf=P('Глушитель на крыше', {}), fuel=P('Дополнительный топливный бак', {}, { rows:[{ k:'Объём', v:'1000 л' }] }), fl=P('Топливопровод и запорная арматура', {}, { pipeMat:'steel' });
  const p=solve(C('sea40'), [dgu, ats, muf, fuel, fl]);
  Check.plan(p, 'ДГУ+');
  const g=p.items.find(i=>i.kind==='dgu'), t=p.items.find(i=>i.kind==='tank'), m=p.roof[0];
  assert.ok(t.x+t.lx<=g.x, 'бак — перед ДГУ'); assert.ok(!p.items.some(i=>i.x>t.x && i.x<g.x), 'между баком и ДГУ ничего');
  assert.ok(m && Math.abs(m.x+m.lx/2-(g.x+g.lx/2))<=1 && Math.abs(m.y+m.d/2-(g.y+g.ly/2))<=1, 'глушитель — прямо над ДГУ, по центру');
  assert.ok(m.exhaust && m.exhaust.z===g.h && m.exhaust.x>m.x && m.exhaust.x<m.x+m.lx && Math.abs(m.exhaust.y-(m.y+m.d/2))<=1, 'выхлоп от двигателя — вертикально в глушитель');
  assert.ok(p.issues.some(i=>i.text.includes('высота станции с глушителем '+StationLayout.n(3791)) && /снимают/.test(i.text)), 'высота с глушителем и пометка о перевозке');
  const pp=p.piping[0]; assert.strictEqual(pp.mat, 'steel'); assert.strictEqual(pp.lines.length, 1, 'топливо: от бака к ДГУ');
  assert.ok(pp.lines[0].x0<=t.x+t.lx && pp.lines[0].x1>=g.x, 'линия от бака до ДГУ');
  const svg=StationDrawing.svg(p, meta(p)); Check.sheet(svg, 'ДГУ+ чертёж');
  assert.ok(svg.includes('Глушитель на крыше') && svg.includes('Топливопровод'), 'глушитель и трубопровод — в перечне');
  assert.ok(/Глушитель поз\. \d+ — на крыше над ДГУ; при перевозке снимается/.test(svg), 'глушитель — в технических требованиях');
  assert.ok(!StationScheme.ok(p), 'ДГУ — схемы пневматической нет');
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
    const side=b.y1===Math.round(it.y+it.ly<l.y ? it.y+it.ly : it.y);   // в ближнюю стенку (вход ресивера — внизу)
    assert.ok(b.x>it.x && b.x<it.x+it.lx, `отвод в габарите: ${it.kind}`);
    if (b.role==='in' && it.shape==='vcyl' && it.h>=900) assert.ok(side && b.z1<l.z && b.z1<it.h/2, `вход ресивера — внизу сбоку: ${it.kind}`);
    else if (l.z>it.h+50) assert.ok(b.z1===Math.round(it.h) && b.y1>=it.y && b.y1<=it.y+it.ly, `спуск на верх: ${it.kind}`);
    else assert.ok(b.z1===l.z && side, `отвод в ближнюю стенку: ${it.kind}`); }
  assert.ok(ns.piping[0].lines.some(l=>l.branches.some(b=>b.z1<l.z)), 'напор над насосами — со спусками');
  // номера позиций на плане — поверх трубопровода: фильтры стоят на трубе, линия не должна перечёркивать цифры
  const sv=StationDrawing.svg(ks, {}), sec=sv.slice(sv.indexOf('>Б–Б<'));
  assert.ok(sec.includes('stroke-width="0.7"') && sec.indexOf('r="0.5" fill="#000"')>sec.lastIndexOf('stroke-width="0.7"'), 'номера на плане — после трубопровода');
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

Check.run('чертёж: лист А4 по ЕСКД', ()=>{
  const p=solve(C('sea40'), [dgu, ats, tank]), d=StationDrawing.svg(p, meta(p, 'Название <b>с разметкой</b> & амперсандом'));
  const sz=Check.sheet(d, 'чертёж');
  assert.ok(sz.w===StationDrawing.W && sz.h===StationDrawing.H, 'лист А4');
  assert.ok(!d.includes('<b>') && d.includes('&lt;b&gt;'), 'название экранировано');
  // основная надпись (форма 1) и дополнительные графы
  const T=Check.texts(d).map(q=>q.t);
  for (const t of ['Изм.', 'Лист', '№ докум.', 'Подп.', 'Дата', 'Разраб.', 'Пров.', 'Т.контр.', 'Н.контр.', 'Утв.', 'Лит.', 'Масса', 'Масштаб', 'Листов',
    'Инв. № подл.', 'Подп. и дата', 'Взам. инв. №', 'Инв. № дубл.', 'Перв. примен.', 'Справ. №', 'Копировал', 'Формат A4', 'Габаритный чертёж', 'Иванов И. И.', '11.10.26', 'П'])
    assert.ok(T.includes(t), 'в основной надписи нет «'+t+'»');
  const code=EskdSheet.code('ООО «ПНЕВМОТЕХ»', p.hash, 'ГЧ'); assert.ok(/^ПНЕВ\.\d{6}\.001 ГЧ$/.test(code), code);
  assert.strictEqual(T.filter(t=>t===code).length, 2, 'обозначение — в графе 2 и в графе 26');
  // масштаб — из ряда ГОСТ 2.302
  const sc=T.find(t=>/^1:[\d,]+$/.test(t)); assert.ok(sc && EskdSheet.SCALES.includes(+sc.slice(2).replace(',', '.')), 'масштаб '+sc);
  // разрезы, перечень, характеристика, требования
  for (const t of ['А–А', 'Б–Б', 'Поз.', 'Наименование', 'Кол.', 'Масса, кг', 'Техническая характеристика', 'Технические требования', 'Проход обслуживания'])
    assert.ok(T.includes(t), 'на листе нет «'+t+'»');
  assert.ok(T.some(t=>/^\d\. Внутри — [\d ]+ × [\d ]+ × [\d ]+ мм$/.test(t)), 'внутренние размеры — в технической характеристике');
  // позиции: номер на полке у каждой позиции перечня — ровно один раз
  const pos=[...d.matchAll(/<text x="[\d.-]+" y="[\d.-]+" font-size="7"[^>]*>(\d+)<\/text>/g)].map(m=>+m[1]).sort((a, b)=>a-b);
  const want=[...new Set([...p.items, ...(p.roof||[])].map(i=>i.pos))].sort((a, b)=>a-b);
  assert.deepStrictEqual(pos, want, 'номера позиций на чертеже');
  // установочные размеры морского контейнера — между фитингами (ISO 1161)
  assert.ok(T.includes(StationLayout.n(StationDrawing.FIT[p.geo.ext[0]])) && T.includes(StationLayout.n(StationDrawing.FIT_W)), 'размеры между фитингами');
  // дата и разработчик — не обязательны; обозначение без организации — по умолчанию
  const bare=StationDrawing.svg(p, {}); Check.sheet(bare, 'чертёж без сведений');
  assert.ok(Check.texts(bare).some(q=>/^КПСТ\.\d{6}\.001 ГЧ$/.test(q.t)), 'обозначение без организации');
  assert.strictEqual(EskdSheet.date('2026-10-11'), '11.10.26'); assert.strictEqual(EskdSheet.scale(2.5), '1:2,5');
});

Check.run('схема пневматическая принципиальная', ()=>{
  const c62=P('Винтовой компрессор', { cat:'comp_screw', model:'K 37', kw:37, flow:6.2, pressure:8, size:'1400 × 900 × 1500' }, { role:'main' });
  const dr=P('Рефрижераторный осушитель', { cat:'dryer_refrig', model:'R 70', flow:7.5, size:'900 × 600 × 1100' });
  const rc=P('Ресивер', { cat:'receiver', model:'РВ 900', volume:900, size:'750 × 750 × 2100' });
  const two=P('Магистральный фильтр FA 110', { cat:'filter', model:'FA 110', flow:8, size:'610*140' }, { qty:2 });
  const ks=StationLayout.solve({ cont:C('block'), parts:[c62, dr, rc, two, P('Трубопровод', {}, { pipeMat:'steel' })], air:'1.4.1' });
  assert.ok(StationScheme.ok(ks), 'компрессорная — схема есть');
  const s=StationScheme.svg(ks, meta(ks)); Check.sheet(s, 'схема КС');
  const T=Check.texts(s).map(q=>q.t);
  for (const t of ['Перечень элементов', 'Поз.', 'Наименование', 'Кол.', 'Примечание', 'К потребителю', 'класс 1.4.1'])
    assert.ok(T.includes(t), 'на схеме нет «'+t+'»');
  assert.ok(T.join(' ').includes('Схема пневматическая принципиальная'), 'наименование документа — в графе 1');
  const code=EskdSheet.code('ООО «ПНЕВМОТЕХ»', ks.hash, 'П3'); assert.strictEqual(T.filter(t=>t===code).length, 2, 'обозначение П3');
  assert.ok(s.includes('класс чистоты сжатого воздуха 1.4.1 по ISO 8573-1'), 'класс — в указаниях');
  // перечень элементов: все аппараты цепочки и обвязка, номера — как в составе станции
  for (const u of ks.air.units) assert.ok(T.includes(u.brief||u.name), 'в перечне нет '+u.name);
  assert.ok(T.includes('Трубопровод'), 'обвязка — в перечне');
  assert.ok(/stroke-dasharray/.test(s) && /M<\/text>/.test(s), 'двигатель компрессора и штриховой отвод конденсата');
  // встроенный осушитель — внутри штрихпунктирной границы компрессора
  const ff=solve(C('block'), [P('Компрессор GA 37 FF со встроенным осушителем', { cat:'comp_screw', flow:6, size:'1800 × 900 × 1600' }, { role:'main' }), rc]);
  const sf=StationScheme.svg(ff, meta(ff)); Check.sheet(sf, 'схема со встроенным');
  assert.ok(new RegExp(`stroke-dasharray="${EskdSheet.LINE.axis[1]}"`).test(sf), 'граница компрессорной установки — штрихпунктирная');
  assert.ok(sf.includes('встроенный осушитель'), 'примечание: встроенный осушитель');
  // несколько компрессоров и длинная цепочка — помещается на листе
  const many=solve(C('block'), [Object.assign({}, c62, { qty:4 }), Object.assign({}, dr, { qty:2 }), Object.assign({}, rc, { qty:2 }), Object.assign({}, two, { qty:3 })]);
  assert.ok(StationScheme.ok(many)); Check.sheet(StationScheme.svg(many, meta(many)), 'схема — много');
  // не компрессорная — схемы нет
  assert.ok(!StationScheme.ok(solve(C('block'), [pumpS, cab])) && !StationScheme.ok(null), 'насосная — схемы нет');
});

Check.run('3D-вид (WebGL): сцена, камера, свет', ()=>{
  const muf=P('Глушитель на крыше', {}), fuel=P('Дополнительный топливный бак', {}, { rows:[{ k:'Объём', v:'1000 л' }] }), fl=P('Топливопровод и запорная арматура', {}, { pipeMat:'steel' });
  const deep=P('Компрессор глубокий', { cat:'comp_screw', model:'D 90', kw:90, size:'2000 × 1500 × 1800' }, { role:'main' });
  const plans={ 'КС': solve(C('block', { sys:{ light:true, heat:true, vent:true, ops:true } }), [comp, dryer, rec, flt, cab, P('Трубопровод', {}, { pipeMat:'inox' })]),
    'ДГУ': solve(C('sea20'), [dgu, ats, muf, fuel, fl]), 'двери': solve(C('sea20'), [deep, dryer, cab]), 'НС': solve(C('block'), [pumpS, cab, P('Обвязка', {}, { pipeMat:'pp' })]),
    'шасси': solve(C('block'), [pumpS, cab, P('Шасси (прицеп)', {})]), 'Север': solve(C('north', { ins:'150 мм' }), [comp, dryer, rec]), '10 футов': solve(C('sea10'), [P('Компрессор', { cat:'comp_screw', kw:7, size:'800 × 600 × 900' }, { role:'main' })]) };
  for (const [label, p] of Object.entries(plans)){
    Check.plan(p, '3D '+label); assert.notStrictEqual(p.level, 'error', label);
    const sc=new StScene(p, {}).build(), b=sc.bounds(), n=sc.tris();
    assert.ok(n>500 && n<200000, `${label}: треугольников ${n}`);
    for (const { mat, mesh } of sc.groups.values()){
      assert.ok(/^#[0-9a-f]{6}$/i.test(mat.c) && mat.r>=0 && mat.r<=1 && (mat.m===0 || mat.m===1 || (mat.m>0 && mat.m<1)), `${label}: материал ${JSON.stringify(mat)}`);
      assert.ok(mesh.p.length===mesh.n.length && mesh.i.every(k=>k<mesh.count), `${label}: геометрия`);
      assert.ok([...mesh.p, ...mesh.n].every(Number.isFinite), `${label}: NaN в геометрии`);
      for (let k=0; k<mesh.n.length; k+=3) assert.ok(Math.abs(Math.hypot(mesh.n[k], mesh.n[k+1], mesh.n[k+2])-1)<1e-3, `${label}: нормаль не единичная`); }
    assert.ok(b.hi[0]>=sc.Le && b.hi[2]>=sc.top-1e-9, `${label}: габарит сцены меньше контейнера`);
    if (p.roof && p.roof.length){ const m=p.roof[0]; assert.ok(b.hi[2]>=sc.top+(m.gap+m.d+m.outlet)/1000-1e-6, `${label}: глушитель — в кадре`); }
    const cam=StCam.fit(b, 1.6), vp=StM4.mul(StM4.persp(cam.fov, 1.6, 0.1, cam.D*4), cam.view);
    for (const x of [b.lo[0], b.hi[0]]) for (const y of [b.lo[1], b.hi[1]]) for (const z of [b.lo[2], b.hi[2]]){ const q=StM4.apply(vp, [x, y, z]);
      assert.ok(Math.abs(q[0])<=0.93 && Math.abs(q[1])<=0.93, `${label}: угол сцены вне кадра ${q.map(v=>v.toFixed(2))}`); }
    const [w, h]=StationRender.size(sc); assert.ok(w===StationRender.W && h>=760 && h<=1100, `${label}: размер кадра ${w}×${h}`);
  }
  // шкафы на срезанной стене прохода — не рисуются (на чертеже есть); без прохода стена стоит, двери открыты
  const ks=plans['КС']; assert.ok(ks.items.some(i=>i.mount==='wall' && i.wall==='front'));
  const dr=new StScene(plans['двери'], {}); assert.ok(!dr.cut && dr.doorsF.length>0, 'без прохода — стена с дверями не срезана');
  assert.ok(new StScene(ks, {}).cut, 'с проходом — стена со стороны зрителя срезана');
  // свет: солнце и небо, сумма освещённости солнца — как задано, направления единичные
  const L=StSky.passes(64), sun=L.filter(q=>q.sun);
  assert.strictEqual(L.length, 64); assert.ok(sun.length>10 && L.length-sun.length>20, 'солнце и небо');
  assert.ok(L.every(q=>Math.abs(StV.len(q.dir)-1)<1e-6 && q.E.every(v=>v>=0 && Number.isFinite(v))), 'направления и яркость');
  assert.ok(Math.abs(sun.reduce((s, q)=>s+q.E[0], 0)-StSky.SUN_E[0])<1e-6, 'солнце: сумма по проходам');
  assert.ok(L.some(q=>!q.sun && q.dir[2]<0), 'снизу — свет, отражённый землёй');
  const c=[1, 2, 1.2], lp=StM4.apply(StM4.light(StSky.SUN, c, 8), c); assert.ok(Math.abs(lp[0])<1e-6 && Math.abs(lp[1])<1e-6, 'карта теней — по центру сцены');
});

Check.run('случайные составы: без сбоев и нарушений', ()=>{
  let seed=20261011; const rnd=()=>((seed=(seed*1103515245+12345)%2147483648)/2147483648), pick=a=>a[Math.floor(rnd()*a.length)];
  const kinds=[['comp_screw', 'Компрессор'], ['dryer_refrig', 'Осушитель'], ['receiver', 'Ресивер'], ['filter', 'Фильтр'], ['pump', 'Насос'], ['dgu', 'ДГУ'], ['ats', 'Шкаф'], ['', 'Бак топливный'], ['', 'Агрегат'],
    ['', 'Глушитель на крыше'], ['', 'Трубопроводная обвязка'], ['', 'Шкаф АСУ ТП']];
  const types=['sea10', 'sea20', 'sea20hc', 'sea40', 'sea40hc', 'block', 'welded', 'north'], levels={};
  for (let k=0; k<400; k++){
    const parts=[]; const m=1+Math.floor(rnd()*6);
    for (let j=0; j<m; j++){ const [cat, nm]=pick(kinds), dims=rnd()<0.8;
      const sz=dims ? [200+Math.floor(rnd()*2800), 200+Math.floor(rnd()*1400), 200+Math.floor(rnd()*2200)].join(' × ') : '';
      parts.push(P(nm+' '+k+'-'+j, { cat, size:sz, kw:Math.floor(rnd()*300), model:'M'+j }, { qty:1+Math.floor(rnd()*3), role:j ? '' : 'main', pipeMat:pick(['', 'steel', 'inox', 'pp']), mount:pick(['', '', 'wall', 'floor']) })); }
    const own=rnd()<0.3 ? [3000+500*Math.floor(rnd()*19), pick([2400, 2500, 3000]), pick([2500, 2800, 3000])].join(' × ') : '';
    const cont=C(pick(types), { size:own, ins:pick(['50 мм', '100 мм', '150 мм']), ral:pick(['', 'RAL 7035', 'RAL 5010 / RAL 9003', 'синий']) });
    let p; try{ p=solve(cont, parts); } catch(e){ throw new Error(`состав ${k} (${cont.ctype} ${own}): ${e.message}`); }
    levels[p.level]=(levels[p.level]||0)+1;
    Check.plan(p, `состав ${k} (${cont.ctype} ${own})`);
    if (p.level==='ok' || p.level==='warn'){ draw(p, `состав ${k}`);
      const sc=new StScene(p, {}).build(); for (const { mesh } of sc.groups.values()) if (!mesh.p.every(Number.isFinite)) throw new Error(`состав ${k}: NaN в 3D-сцене`); }
  }
  assert.ok(levels.ok && levels.warn && levels.error, 'в прогоне есть все исходы: '+JSON.stringify(levels));
});

console.log(process.exitCode ? 'Компоновка станций: есть ошибки' : `Компоновка станций: проверок пройдено ${Check.n}`);
