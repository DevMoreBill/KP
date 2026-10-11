// Компоновка станций в контейнере (app/web/js/features/station-layout.js, station-eskd.js, station-draw.js): разбор габаритов
// и цвета, расстановка с проходами обслуживания, подбор контейнера, отпечаток, габаритный чертёж и схема пневматическая
// принципиальная на листе А4 по ЕСКД, 3D-вид.
// Запуск из корня репозитория: node tests/js/station_layout.js — код выхода 0, если всё прошло (tests/test_station_layout.py).
'use strict';
const vm=require('vm'), fs=require('fs'), path=require('path'), assert=require('assert');
const ROOT=path.resolve(__dirname, '..', '..');
for (const f of ['logistics-calc.js', 'station-layout.js', 'station-systems.js', 'station-eskd.js', 'station-draw.js', 'station-outfit.js', 'station-render.js', 'station-decal.js']){
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
      if (it.tank){ assert.ok(p.fuel && it.x>=-1 && it.x+it.lx<=p.fuel.x1+1, `${label}: бак поз. ${it.pos} — вне своего отсека`); }   // бак ДГУ — в отсеке у торца
      else assert.ok(it.x>=x0-1 && it.x+it.lx<=L+1, `${label}: поз. ${it.pos} вне контейнера по длине (${it.x}…${it.x+it.lx} из ${x0}…${L})`);
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
    // бак ДГУ — в своём отсеке у торца: за перегородкой (оборудование — после неё), проход перед баком, дверь отсека в его пределах
    const tanks=I.filter(i=>i.tank);
    if (tanks.length){ const f=p.fuel; assert.ok(f && (p.geo.x0||0)>=f.x1+f.part-1, `${label}: оборудование — за перегородкой отсека бака`);
      assert.ok(f.door.x0>=0 && f.door.x1<=f.x1 && f.door.x1-f.door.x0>=StationLayout.DOOR_MIN, `${label}: дверь отсека бака`);
      for (const t of tanks) assert.ok(t.y>=StationLayout.TANK.aisle-1, `${label}: проход перед баком ${t.y} мм`); }
    const floor=I.filter(i=>(i.mount==='floor' || i.mount==='frame') && !i.tank);
    if (p.door==='service'){   // без прохода: перед каждым (кроме небольших — ресивер, фильтр, рефрижераторный осушитель) — сервисная дверь в его стене
      assert.ok(Array.isArray(p.doors) && (p.doors.length || floor.every(StationLayout.minor)), label+': нет сервисных дверей');
      for (const it of floor.filter(i=>!StationLayout.minor(i))){ const fr=it.face<=0, bk=it.face>=0;
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
  /** схема: подписи не пересекают линии связи, переносы строк и отвод конденсата (отрезки толще 0,3 мм и штриховые 2 1) */
  static crossing(s, label){
    const L=[], re=/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)" fill="none" stroke="#000" stroke-width="([\d.]+)"(?: stroke-dasharray="([^"]+)")?/g; let m;
    while ((m=re.exec(s))) if (+m[5]>=0.3 || m[6]==='2 1') L.push([+m[1], +m[2], +m[3], +m[4]]);
    for (const q of Check.texts(s).filter(t=>t.rot!==180 && t.b[1]<200)){ const [x0, y0, x1, y1]=q.b;
      const hit=L.find(([a, b, c, d])=>Math.max(a, c)>x0+0.3 && Math.min(a, c)<x1-0.3 && Math.max(b, d)>y0+0.3 && Math.min(b, d)<y1-0.3);
      assert.ok(!hit, `${label}: линия через «${q.t}»`); }
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
  if (StationScheme.ok(p)){ const s=StationScheme.svg(p, meta(p)); Check.sheet(s, label+' (схема)'); Check.crossing(s, label+' (схема)'); }
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
  const cb=p.items.find(i=>i.kind==='cabinet'), en=p.entry;
  assert.ok(p.door==='side' && en && en.wall==='front' && en.w===900 && p.gates && p.gates.sea && p.gates.wall==='left', 'морской: дверь оператора одностворчатая в боковой стене, штатные двери в торце — для демонтажа');
  assert.ok(cb.mount==='wall' && cb.wall==='front' && (cb.x>=en.x1+100 || cb.x+cb.lx<=en.x0-100), 'шкаф — на стене прохода, не на двери оператора');
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
  const a=solve(C('sea20'), [dgu, ats]); Check.plan(a, 'ДГУ, АВР на стене');
  assert.ok(a.level!=='error' && a.door!=='service', 'АВР на стене — ДГУ с проходом помещается в 20 футов');
  const t=solve(C('sea20'), [dgu, ats, tank]); Check.plan(t, 'ДГУ, бак в отсеке, 20 футов');
  assert.ok(t.fuel && t.door==='service' && t.suggest && t.suggest.aisle, 'с отсеком бака в 20 футах — без прохода, подсказка контейнера с проходом: '+JSON.stringify(t.suggest));
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
  // небольшим аппаратам сервисная дверь не нужна (рефрижераторный осушитель проходит в дверь оператора), компрессору — нужна
  const dr=auto.items.find(i=>i.kind==='dryer'), cp=auto.items.find(i=>i.kind==='compressor');
  assert.ok(StationLayout.minor(dr) && !auto.doors.some(d=>d.x0<dr.x+dr.lx && d.x1>dr.x && !(d.x0<cp.x+cp.lx && d.x1>cp.x)) && auto.doors.some(d=>d.x0<cp.x+cp.lx && d.x1>cp.x), 'двери — только там, где они нужны: '+JSON.stringify(auto.doors));
  // соседние проёмы — со стойкой между ними, не сливаются в один
  const pair=solve(C('block'), [Object.assign({}, deep, { qty:2 })]);
  Check.plan(pair, 'два компрессора без прохода'); assert.ok(pair.door==='service' && pair.doors.length>=2, 'отдельные проёмы: '+JSON.stringify(pair.doors));
});

Check.run('шкафы на стене, фильтры на трубопроводе', ()=>{
  const pipe=P('Трубопроводная обвязка', {}, { pipeMat:'steel' });
  const p=solve(C('sea20'), [comp, dryer, rec, flt, cab, ats, pipe]);
  Check.plan(p, 'шкафы и фильтры');
  const cabs=p.items.filter(i=>i.kind==='cabinet');
  assert.ok(cabs.length===2 && cabs.every(c=>c.mount==='wall') && cabs.some(c=>c.wall==='front'), 'шкафы без габаритов — настенные: на стене прохода (мимо сервисной двери) и на торце');
  assert.ok(p.door==='side' && !p.doors.length && p.gates.sea && p.gates.pos.includes(1) && !p.gates.pos.includes(2) && cabs.every(c=>c.wall!=='left' && (c.wall!=='front' || c.x+c.lx<=p.entry.x0-100 || c.x>=p.entry.x1+100)),
    'компрессор — через штатные двери в торце (в дверь оператора не проходит), осушитель — через дверь оператора; шкафы — не на дверях');
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
  // ресивер до осушителя («мокрый») — по требованию станции; по умолчанию — после подготовки воздуха (проверка ниже)
  const ks=StationLayout.solve({ cont:C('block'), parts:[c62, dr6, rc, two, P('Трубопровод', {}, { pipeMat:'steel' })], recv:'before' }); Check.plan(ks, 'КС цепочка'); draw(ks, 'КС цепочка');
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

Check.run('двери: оператора — одностворчатая наружу; ворота для демонтажа — в торце; сервисные — где нет отступов', ()=>{
  // отступы выдержаны (проход внутри): дверь оператора одностворчатая, не уже 600 мм; компрессор в неё не проходит — распашные
  // ворота в торце (по возможности в дальнем), сервисных дверей в боковых стенах нет
  const ks=solve(C('block', { sizeAuto:true }), [comp, dryer, rec, cab]); Check.plan(ks, 'ворота');
  assert.ok(ks.door==='side' && ks.entry && ks.entry.wall==='front' && ks.entry.w>=StationLayout.DOOR_MIN && ks.entry.w===StationLayout.ENTRY[1]-StationLayout.ENTRY[0], 'дверь оператора — одностворчатая в стене прохода');
  const G=ks.gates; assert.ok(G && G.wall==='right' && G.leaves===2 && G.pos.includes(1) && !ks.doors.length, 'компрессор — через распашные ворота в дальнем торце: '+JSON.stringify(G));
  const cp=ks.items.find(i=>i.kind==='compressor'); assert.ok(G.w>=Math.min(cp.l, cp.w)+2*StationLayout.PASS && G.h>=cp.h+StationLayout.PASS, 'ворота — шире и выше компрессора');
  assert.ok(!G.pos.includes(ks.items.find(i=>i.kind==='dryer').pos) && !G.pos.includes(ks.items.find(i=>i.kind==='receiver').pos), 'ресивер и рефрижераторный осушитель — через дверь оператора');
  assert.ok(ks.issues.some(i=>/Распашные ворота .* в дальнем торце/.test(i.text) && /одностворчатая/.test(i.text)), 'сведения о воротах и двери оператора');
  assert.ok(!ks.items.some(i=>i.mount==='wall' && i.wall==='right'), 'на торце с воротами шкафов нет');
  // небольшие аппараты — ворота не нужны
  const small=solve(C('block', { sizeAuto:true }), [P('Компрессор поршневой', { cat:'comp_piston', size:'700 × 500 × 800' }, { role:'main' }), dryer, rec]); Check.plan(small, 'без ворот');
  assert.ok(!small.gates && !small.doors.length, 'всё проходит в дверь оператора — ни ворот, ни сервисных дверей');
  // крупный адсорбционный осушитель — ворота (или, если к торцу не провезти, сервисные ворота в боковой стене)
  const ads=P('Адсорбционный осушитель крупный', { cat:'dryer_ads', size:'1300 × 1000 × 2000' });
  const a=solve(C('block', { sizeAuto:true }), [comp, ads, rec]), ap=a.items.find(i=>i.kind==='dryer').pos; Check.plan(a, 'адсорбционный');
  assert.ok((a.gates && a.gates.pos.includes(ap)) || a.doors.some(d=>d.pos.includes(ap)), 'крупному адсорбционному — ворота');
  // морской: дверь оператора — в боковой стене, ворота — его штатные двери в торце
  const sea=solve(C('sea20'), [comp, dryer, rec]); Check.plan(sea, 'морской');
  assert.ok(sea.door==='side' && sea.entry.w===900 && sea.gates && sea.gates.sea && sea.gates.wall==='left' && sea.gates.pos.includes(1), 'морской: ворота — штатные двери');
  // ДГУ: в дальнем торце — дверь-жалюзи; ворота — не там
  const dg=solve(C('block', { sizeAuto:true }), [dgu, ats]); Check.plan(dg, 'ДГУ');
  assert.ok(dg.dguDoor && (!dg.gates || dg.gates.wall==='left'), 'у ДГУ дальний торец — дверь-жалюзи');
  // чертёж, ТЗ: ворота и дверь оператора
  const T=StationDrawing.lift ? StationDrawing.svg(ks, meta(ks)) : ''; assert.ok(/Распашные ворота/.test(T) && /Дверь оператора — одностворчатая/.test(T), 'на чертеже — ворота и дверь оператора');
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
  const sv=StationDrawing.svg(solve(C('block'), [comp]), meta(p)); assert.ok(/Дверь оператора — одностворчатая 900 мм \(не менее 600 мм в свету\), открывается наружу/.test(sv), 'на чертеже — дверь оператора');
});

Check.run('морской контейнер с запасом — подсказка меньшего', ()=>{
  const p=solve(C('sea40'), [dgu, ats]);
  assert.ok(p.suggest && p.suggest.smaller && p.suggest.ctype==='sea20', 'ДГУ в 40 футах — достаточно 20: '+JSON.stringify(p.suggest));
  assert.ok(!solve(C('sea40'), [dgu, ats, tank]).suggest, 'с отсеком бака 20 футов — только без прохода: меньший не предлагается');
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
  assert.ok(t.tank && t.x+t.lx<=p.fuel.x1 && g.x>=p.geo.x0 && p.geo.x0>=p.fuel.x1+p.fuel.part, 'бак — в отсеке у торца, ДГУ — за перегородкой');
  assert.ok(m && Math.abs(m.x+m.lx/2-(g.x+g.lx/2))<=1 && Math.abs(m.y+m.d/2-(g.y+g.ly/2))<=1, 'глушитель — прямо над ДГУ, по центру');
  assert.ok(m.exhaust && m.exhaust.z===g.h && m.exhaust.x>m.x && m.exhaust.x<m.x+m.lx && Math.abs(m.exhaust.y-(m.y+m.d/2))<=1, 'выхлоп от двигателя — вертикально в глушитель');
  assert.ok(p.issues.some(i=>i.text.includes('высота станции с глушителем '+StationLayout.n(3791-500)) && /снимают/.test(i.text) && /горизонтально в сторону/.test(i.text)), 'высота с глушителем (выхлоп — вбок) и пометка о перевозке');
  const pp=p.piping[0]; assert.strictEqual(pp.mat, 'steel'); assert.strictEqual(pp.lines.length, 1, 'топливо: от бака к ДГУ');
  assert.ok(pp.lines[0].x0<=t.x+t.lx && pp.lines[0].x1>=g.x, 'линия от бака до ДГУ');
  const svg=StationDrawing.svg(p, meta(p)); Check.sheet(svg, 'ДГУ+ чертёж');
  assert.ok(svg.includes('Глушитель на крыше') && svg.includes('Топливопровод'), 'глушитель и трубопровод — в перечне');
  assert.ok(/Глушитель поз\. \d+ — на крыше над ДГУ, выхлоп — горизонтально в сторону; съёмный/.test(svg), 'глушитель — в технических требованиях');
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
  const sv=StationDrawing.sheets(ks, {})[1], sec=sv.slice(sv.indexOf('>Б–Б'));
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

Check.run('чертёж: листы А4 по ЕСКД', ()=>{
  const p=solve(C('sea40'), [dgu, ats, tank]), L=StationDrawing.sheets(p, meta(p, 'Название <b>с разметкой</b> & амперсандом')), d=L[0], d2=L[1];
  const sz=Check.sheet(d, 'чертёж');
  // три листа: 1 — разрез А–А и текстовая часть (только на первом листе), 2 — план и виды с торцов, 3 — схема строповки
  assert.strictEqual(L.length, 3, 'три листа'); L.slice(1).forEach((x, i)=>Check.sheet(x, 'чертёж, лист '+(i+2)));
  const T2=Check.texts(d2).map(q=>q.t), T3=Check.texts(L[2]).map(q=>q.t);
  assert.ok(T2.includes('Лист') && T2.includes('2') && !T2.includes('Разраб.') && !T2.some(t=>t==='Технические требования'), 'лист 2: основная надпись формы 2а, без текстовой части');
  assert.ok(T2.some(t=>/^Б–Б/.test(t)) && T2.some(t=>/^В( \(|$)/.test(t)) && T2.some(t=>/^Г( \(|$)/.test(t)), 'лист 2: план и виды с торцов В и Г');
  assert.ok(T3.some(t=>/^Схема строповки/.test(t)) && T3.includes('ЦТ') && T3.some(t=>/«Место строповки»/.test(t)) && T3.some(t=>/«Центр тяжести»/.test(t)), 'лист 3: схема строповки, центр тяжести, знаки № 9 и № 12');
  assert.ok(Check.texts(d).some(q=>q.t==='Листов') && d.includes('>3<'), 'листов — 3');
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
  for (const t of ['А–А', 'Поз.', 'Наименование', 'Кол.', 'Масса, кг', 'Техническая характеристика', 'Технические требования'])
    assert.ok(T.includes(t), 'на листе нет «'+t+'»');
  assert.ok(T2.includes('Проход обслуживания'), 'на плане — проход обслуживания');
  assert.ok(T.some(t=>/^\d\. Внутри — [\d ]+ × [\d ]+ × [\d ]+ мм$/.test(t)), 'внутренние размеры — в технической характеристике');
  // позиции: номер на полке у каждой позиции перечня — ровно один раз
  const pos=[...d2.matchAll(/<text x="[\d.-]+" y="[\d.-]+" font-size="7"[^>]*>(\d+)<\/text>/g)].map(m=>+m[1]).sort((a, b)=>a-b);
  const want=[...new Set([...p.items, ...(p.roof||[])].map(i=>i.pos))].sort((a, b)=>a-b);
  assert.deepStrictEqual(pos, want, 'номера позиций на чертеже');
  // установочные размеры морского контейнера — между фитингами (ISO 1161)
  assert.ok(T2.includes(StationLayout.n(StationDrawing.FIT[p.geo.ext[0]])) && T2.includes(StationLayout.n(StationDrawing.FIT_W)), 'размеры между фитингами');
  // дата и разработчик — не обязательны; обозначение без организации — по умолчанию
  const bare=StationDrawing.svg(p, {}); Check.sheet(bare, 'чертёж без сведений');
  assert.ok(Check.texts(bare).some(q=>/^КПСТ\.\d{6}\.001 ГЧ$/.test(q.t)), 'обозначение без организации');
  assert.strictEqual(EskdSheet.date('2026-10-11'), '11.10.26'); assert.strictEqual(EskdSheet.scale(2.5), '1:2,5');
});

Check.run('рисунки оборудования: узнаваемые, во всех видах', ()=>{
  const L=[['compressor', 'box', [1400, 900, 1500]], ['compressor', 'box', [1900, 700, 1700], { air:{ recv:true } }], ['compressor', 'box', [1900, 600, 1300], { look:'piston' }],
    ['receiver', 'vcyl', [650, 650, 2000]], ['receiver', 'hcyl', [2000, 750, 900]], ['dryer', 'box', [900, 600, 1100], { air:{ type:'refrig' } }], ['dryer', 'box', [1000, 700, 1800], { air:{ type:'ads' } }],
    ['filter', 'vcyl', [140, 140, 610], { mount:'pipe' }], ['filter', 'vcyl', [400, 400, 1200]], ['filter', 'box', [500, 300, 600], { air:{ grade:'cond' } }], ['cabinet', 'box', [600, 250, 800], { mount:'wall' }],
    ['cabinet', 'box', [800, 600, 2000]], ['dgu', 'box', [3200, 1150, 1900]], ['pump', 'box', [2600, 1100, 1300]], ['pump', 'box', [400, 400, 1200]], ['tank', 'box', [1500, 800, 1100]], ['other', 'box', [800, 600, 900]]];
  for (const N of [20, 75, 200]) for (const [kind, shape, [lx, ly, h], o] of L) for (const v of [{ face:-1 }, { face:1 }, { face:-2 }, { face:-1, rot:true }]){
    const it=Object.assign({ kind, shape, lx, ly, h, mount:'floor', air:{}, look:'' }, o||{}, v), sh=new EskdSheet('A4'), k=1/N;
    EquipIcon.front(sh, it, 30, 40, 30+lx*k, 40+h*k); EquipIcon.plan(sh, it, 30, 150, 30+lx*k, 150+ly*k);
    const s=sh.svg(); Check.svg(s, `${kind} ${shape} 1:${N} ${JSON.stringify(v)}`);
    assert.ok((s.match(/<(rect|path|circle|polygon|line)/g)||[]).length>(N<100 ? 3 : 1), `${kind} 1:${N}: рисунок пустой`); }
  const draw=(it, N=20)=>{ const sh=new EskdSheet('A4'), k=1/N; EquipIcon.front(sh, it, 30, 40, 30+it.lx*k, 40+it.h*k); return sh.svg(); };
  const base={ shape:'box', ly:900, mount:'floor', face:-1, air:{} };
  assert.ok(draw(Object.assign({ kind:'compressor', lx:1400, h:1500 }, base)).includes(`fill="${EquipIcon.DARK}"`), 'компрессор спереди: пульт с дисплеем');
  assert.ok(!draw(Object.assign({ kind:'compressor', lx:1400, h:1500 }, base, { face:1 })).includes(`fill="${EquipIcon.DARK}"`), 'сзади пульта нет — решётка охладителя');
  assert.ok(draw(Object.assign({ kind:'compressor', lx:1900, h:1300, look:'piston' }, base)).includes('<polygon'), 'поршневой: цилиндры');
  const sh=new EskdSheet('A4'); EquipIcon.plan(sh, Object.assign({ kind:'compressor', lx:900, ly:1400, h:1500 }, base, { rot:true }), 30, 40, 48, 68);
  assert.ok(sh.svg().includes('<g transform="rotate(90'), 'повёрнутое поперёк — рисунок на плане повёрнут');
  // вид изделия: поршневой — по категории или названию
  assert.strictEqual(StationEquip.look({ name:'Компрессор', attrs:{ cat:'comp_piston' } }, 'compressor'), 'piston');
  assert.strictEqual(StationEquip.look({ name:'Поршневой компрессор Remeza СБ4', attrs:{} }, 'compressor'), 'piston');
  assert.strictEqual(StationEquip.look({ name:'Винтовой компрессор', attrs:{ cat:'comp_screw' } }, 'compressor'), '');
  const pp=solve(C('block'), [P('Поршневой компрессор', { cat:'comp_piston', size:'1900 × 600 × 1300' }, { role:'main' })]);
  assert.strictEqual(pp.items.find(i=>i.kind==='compressor').look, 'piston', 'вид — в элементе расстановки');
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
  // длинная цепочка — строками змейкой, выход к потребителю — по ходу последней строки или на следующей; подписи не на линиях
  const lng=solve(C('block'), [Object.assign({}, c62, { qty:2 }), Object.assign({}, rc, { qty:2 }), P('Фильтр предварительной очистки', { cat:'filter', stage:'Предварительная', size:'610*140' }, { qty:3 }),
    Object.assign({}, dr, { qty:2 }), P('Фильтр сверхтонкой очистки', { cat:'filter', stage:'Сверхтонкая (микрофильтр)', size:'610*140' }, { qty:3 }), P('Угольный фильтр', { cat:'filter', size:'610*140' }),
    P('Ресивер сухой', { cat:'receiver', volume:500, size:'650 × 650 × 1800' })]);
  const s2=StationScheme.svg(lng, meta(lng)); Check.sheet(s2, 'схема — две строки'); Check.crossing(s2, 'схема — две строки');
  const four=solve(C('block'), [P('Компрессор со встроенным осушителем', { cat:'comp_screw', flow:4, size:'1400 × 900 × 1500' }, { role:'main', qty:4 }),
    P('Фильтр', { cat:'filter', size:'610*140' }, { qty:3 }), P('Генератор азота', { cat:'gen_n2', size:'800 × 600 × 1500' }, { qty:3 }), P('Ресивер', { cat:'receiver', volume:500, size:'650 × 650 × 1900' }, { qty:2 })]);
  const s4=StationScheme.svg(four, meta(four)); Check.sheet(s4, 'схема — 4 компрессора'); Check.crossing(s4, 'схема — 4 компрессора');
  for (const g of [StationScheme.layout(4, [8, 5, 5, 5, 6, 6, 6, 5, 5, 5, 8], true, 26, 30, 150), StationScheme.layout(1, [5, 6, 5, 8], false, 26, 30, 170)])
    assert.ok(g.m>=0.7 && g.m<=1.6 && g.per>=1 && g.rows>=1 && 30+g.h<=170, 'раскладка схемы '+JSON.stringify(g));
  // не компрессорная — схемы нет
  assert.ok(!StationScheme.ok(solve(C('block'), [pumpS, cab])) && !StationScheme.ok(null), 'насосная — схемы нет');
});

Check.run('ресивер: после подготовки воздуха, до и после, снаружи; учёт в Ростехнадзоре', ()=>{
  const comp=()=>P('Винтовой компрессор', { cat:'comp_screw', model:'K 37', kw:37, flow:6.2, pressure:8, size:'1400 × 900 × 1500' }, { role:'main' });
  const dry=()=>P('Рефрижераторный осушитель', { cat:'dryer_refrig', model:'R 70', flow:7.5, size:'900 × 600 × 1100' });
  const rc=(v, bar, extra)=>P('Воздушный ресивер', { cat:'receiver', model:'РВ '+v, volume:v, pressure:bar||11, size:v>=1500 ? '1000 × 1000 × 2400' : '750 × 750 × 1900' }, extra);
  const flt=()=>P('Магистральный фильтр FA 110', { cat:'filter', model:'FA 110', flow:8, size:'610*140' }, { qty:2 });
  const run=(parts, o)=>StationLayout.solve(Object.assign({ cont:C('block', { sizeAuto:true }), parts:[...parts, P('Трубопровод', {}, { pipeMat:'steel' })] }, o||{}));
  // по умолчанию — после осушителя и фильтров («сухой»), последний по ходу воздуха
  const a=run([comp(), dry(), rc(900), flt()]); Check.plan(a, 'ресивер после'); draw(a, 'ресивер после');
  assert.deepStrictEqual(a.air.chain.map(c=>c.kind), ['compressor', 'filter', 'dryer', 'filter', 'receiver'], 'по умолчанию ресивер — после подготовки');
  assert.ok(/«сухой» ресивер/.test(a.air.chain.at(-1).text));
  const ra=a.items.find(i=>i.kind==='receiver'), dr=a.items.find(i=>i.kind==='dryer'); assert.ok(ra.x>dr.x, 'в ряду ресивер — после осушителя');
  // без осушителя — после фильтров, без слова «сухой»
  const nd=run([comp(), rc(900), flt()]); assert.strictEqual(nd.air.chain.at(-1).kind, 'receiver'); assert.ok(!/сухой/.test(nd.air.chain.at(-1).text));
  // до и после: первый — до осушителя, второй — после
  const b=run([comp(), rc(500, 11, { name:'Воздушный ресивер 500' }), dry(), rc(900), flt()], { recv:'both' });
  assert.deepStrictEqual(b.air.chain.map(c=>c.kind), ['compressor', 'receiver', 'filter', 'dryer', 'filter', 'receiver'], 'до и после осушителя');
  // явная роль в названии сильнее требования
  const w=run([comp(), dry(), P('Ресивер мокрый 500 л', { cat:'receiver', volume:500, size:'650 × 650 × 1600' }), flt()]);
  assert.strictEqual(w.air.chain[1].kind, 'receiver', '«мокрый» в названии — до осушителя');
  // снаружи: не в контейнере, за дальним торцом на площадке; по ходу воздуха — последний; на чертеже, в ТТ и в 3D
  const o=run([comp(), dry(), rc(2000), flt()], { recvOut:true }); Check.plan(o, 'ресивер снаружи'); draw(o, 'ресивер снаружи');
  assert.ok(!o.items.some(i=>i.kind==='receiver') && o.outside.length===1, 'ресивер — снаружи');
  const [Le, We]=o.geo.ext, [Li, Wi]=o.int, ox=(Le-Li)/2, oy=(We-Wi)/2, r=o.outside[0], zf=StationGeo.zFloor(o.geo.type, o.geo.t);
  assert.ok(ox+r.x>=Le+StationLayout.OUT_GAP-1 && r.y>=-oy-1 && r.y+r.ly<=Wi+oy+1, 'за торцом, в ширину контейнера');
  assert.strictEqual(r.z, -zf+StationLayout.PAD, 'на площадке на земле');
  assert.strictEqual(o.air.chain.at(-1).kind, 'receiver'); assert.ok(/снаружи/.test(o.air.chain.at(-1).text));
  assert.notStrictEqual(StationLayout.hash({ cont:C('block'), parts:[comp(), rc(900)] }), StationLayout.hash({ cont:C('block'), parts:[comp(), rc(900)], recvOut:true }), 'отпечаток: снаружи');
  assert.ok(o.issues.some(i=>/снаружи, на бетонной площадке/.test(i.text)) && o.issues.some(i=>/рефрижераторного осушителя .* конденсат/.test(i.text)), 'замечания: площадка, конденсат зимой');
  const sv=StationDrawing.svg(o, meta(o)); Check.sheet(sv, 'ресивер снаружи');
  assert.ok(/снаружи на бетонной площадке/.test(sv) && /подлежит учёту в Ростехнадзоре/.test(sv), 'ТТ: снаружи и учёт');
  const sc=new StScene(o, {}).build(), bb=sc.bounds(); assert.ok(bb.hi[0]>Le/1000+StationLayout.OUT_GAP/1000, '3D: ресивер в кадре');
  for (const { mesh } of sc.groups.values()) assert.ok(mesh.p.every(Number.isFinite), '3D без NaN');
  // два ресивера снаружи не помещаются по ширине — второй ряд дальше от стены
  const o2=run([comp(), dry(), rc(2000, 11, { qty:2 }), flt()], { recvOut:true }); Check.plan(o2, 'два снаружи'); draw(o2, 'два снаружи');
  assert.ok(o2.outside.length===2 && o2.outside[1].x>o2.outside[0].x+o2.outside[0].lx, 'второй ряд');
  Check.sheet(StationDrawing.svg(o2, meta(o2)), 'два снаружи');
  // «снаружи» и ресивер до осушителя — остаётся внутри
  const ob=run([comp(), dry(), rc(900), flt()], { recv:'before', recvOut:true }); assert.ok(!(ob.outside||[]).length && ob.items.some(i=>i.kind==='receiver'));
  // без осушителя снаружи — предупреждение про конденсат
  const on=run([comp(), rc(900), flt()], { recvOut:true }); assert.ok(on.issues.some(i=>i.level==='warn' && /без осушителя/.test(i.text)));
  // учёт: 0,8 МПа × 2 м³ = 1,6 — подлежит; 0,8 × 0,9 = 0,72 — нет; давление ресивера ниже компрессора — предупреждение
  assert.ok(o.vessels[0].reg && Math.abs(o.vessels[0].pv-1.6)<1e-9 && o.issues.some(i=>/Подлежат учёту в Ростехнадзоре/.test(i.text)));
  assert.ok(a.vessels[0].reg===false && a.issues.some(i=>/Учёту в Ростехнадзоре не подлежат/.test(i.text)) && /не подлежит/.test(StationDrawing.svg(a, meta(a))));
  const lo=run([comp(), dry(), rc(900, 6), flt()]); assert.ok(lo.issues.some(i=>i.level==='warn' && /рассчитан на 6 бар — меньше давления компрессоров 8 бар/.test(i.text)));
  assert.strictEqual(PressureVessel.list([{ kind:'receiver', pos:1, qty:1, air:{ vol:null, bar:10 } }], 8)[0].reg, null, 'без объёма — не оценить');
});

Check.run('чертёжный шрифт osifont: встраивается в лист, строки по его ширинам без наложений', ()=>{
  const ttf=fs.readFileSync(path.join(ROOT, 'app', 'web', 'fonts', 'osifont-italic.ttf'));
  assert.ok(ttf.length>50000 && ttf.readUInt32BE(0)===0x00010000, 'TTF на месте');
  assert.ok(fs.existsSync(path.join(ROOT, 'app', 'web', 'fonts', 'osifont-NOTICE.txt')), 'при шрифте — лицензия');
  const before=EskdSheet.tw('Технические требования', 3.5);
  EskdSheet.FONT_DATA=ttf.toString('base64');
  try{
    assert.strictEqual(EskdSheet.CAP, 1.352); assert.ok(EskdSheet.tw('Технические требования', 3.5)<before*0.85, 'osifont уже Arial');
    assert.ok(EskdSheet.tw('→', 3.5)>0 && EskdSheet.tw('₽', 3.5)>0, 'знаков нет в шрифте — по Arial');
    const C2=(ctype, o)=>Object.assign(C(ctype), { sys:{ power:true, light:true, heat:true, vent:true } }, o||{});
    const cases=[[C2('block', { sizeAuto:true }), [comp, dryer, rec, flt, cab, P('Трубопровод', {}, { pipeMat:'steel' })]],
      [C2('sea20'), [P('Компрессор', { cat:'comp_screw', flow:6, pressure:8, size:'1300 × 800 × 1500' }, { role:'main', qty:2 }), P('Ресивер 900 л', { cat:'receiver', volume:900, size:'750 × 750 × 1900' }), P('Осушитель адсорбционный', { cat:'dryer_ads', flow:11, size:'1000 × 700 × 1800' }), P('Фильтр', { cat:'filter', size:'610*140' }, { qty:2 })]],
      [C2('sea20'), [P('ДГУ', { cat:'dgu', kw:176, size:'3200 × 1150 × 1900' }, { role:'main' }), P('Шкаф АВР', { cat:'ats' }), P('Глушитель на крыше', {}), P('Дополнительный топливный бак', {}, { rows:[{ k:'Объём', v:'1000 л' }] })]],
      [C2('block', { sizeAuto:true }), [P('Насосный агрегат CR 45', { cat:'pump', kw:15, size:'700 × 500 × 1400' }, { role:'main', qty:6 }), P('Гидробак мембранный 300 л', {}, { rows:[{ k:'Габариты', v:'650 × 650 × 1200' }] }), P('Трубопроводная обвязка', {}, { pipeMat:'inox' })]]];
    for (const [k, [cont, parts]] of cases.entries()){ const p=solve(cont, parts); Check.plan(p, 'шрифт '+k);
      const sv=StationDrawing.svg(p, meta(p)); Check.sheet(sv, 'шрифт '+k+' (чертёж)');
      assert.ok(/@font-face\{font-family:osifont;font-style:italic;src:url\(data:font\/ttf;base64,AAEAAA/.test(sv) && /font-family="osifont, Arial/.test(sv), 'шрифт встроен в лист');
      for (const S of [StationScheme, HydroScheme]) if (S.ok(p)){ const sc=S.svg(p, meta(p)); Check.sheet(sc, 'шрифт '+k+' (схема)'); Check.crossing(sc, 'шрифт '+k+' (схема)'); } }
  } finally { EskdSheet.FONT_DATA=''; }
  assert.ok(!/@font-face/.test(StationDrawing.svg(solve(C('block'), [comp]), meta({}))), 'без шрифта — без @font-face');
});

Check.run('свой рисунок модели: вид спереди и сверху вместо рисунка программы', ()=>{
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const c2=P('Компрессор с рисунком', { cat:'comp_screw', flow:6, pressure:8, size:'1400 × 900 × 1500' }, { role:'main', draw:{ front:{ src:png, w:1, h:1 }, top:{ src:png, w:1, h:1 } } });
  const p=solve(C('block', { sizeAuto:true }), [c2, dryer, P('Трубопровод', {}, { pipeMat:'steel' })]); Check.plan(p, 'рисунок');
  const it=p.items.find(i=>i.kind==='compressor'); assert.ok(it.pic && it.pic.front===png && it.pic.top===png, 'рисунок у элемента расстановки');
  const [sv, sv2]=StationDrawing.sheets(p, meta(p)); Check.sheet(sv, 'рисунок');
  assert.strictEqual((sv.match(/<image /g)||[]).length+(sv2.match(/<image /g)||[]).length, 2, 'спереди (А–А) и сверху (Б–Б)');
  assert.ok(sv.includes('preserveAspectRatio="xMidYMax meet" href="'+png+'"'), 'спереди — вписан по низу');
  const bare=solve(C('block', { sizeAuto:true }), [P('Компрессор с рисунком', { cat:'comp_screw', flow:6, pressure:8, size:'1400 × 900 × 1500' }, { role:'main' }), dryer, P('Трубопровод', {}, { pipeMat:'steel' })]);
  assert.notStrictEqual(bare.hash||StationLayout.hash({ cont:C('block'), parts:[c2] }), StationLayout.hash({ cont:C('block'), parts:[Object.assign({}, c2, { draw:null })] }), 'отпечаток: рисунок');
  assert.ok(!/<image /.test(StationDrawing.svg(bare, meta(bare))), 'без рисунка — рисунок программы');
  // адрес не data: (не загружен) и не картинка — не попадают в лист
  const bad=solve(C('block', { sizeAuto:true }), [P('Компрессор', { cat:'comp_screw', size:'1400 × 900 × 1500' }, { role:'main', draw:{ front:{ src:'/img/x.png' }, top:{ src:'data:image/svg+xml;base64,PHN2Zz4=' } } })]);
  assert.ok(!/<image /.test(StationDrawing.svg(bad, meta(bad))), 'внешний адрес и SVG — нет');
  const sh=new EskdSheet('A4'); assert.strictEqual(sh.image(0, 0, 10, 10, 'javascript:alert(1)'), false); assert.strictEqual(sh.image(0, 0, 10, 10, png+'"/><script>'), false);
});

Check.run('схема гидравлическая принципиальная: насосы параллельно, арматура, гидробак', ()=>{
  for (const n of [1, 2, 3, 4, 6, 8]) for (const withTank of [false, true]){
    const parts=[P('Насосный агрегат CR '+n, { cat:'pump', model:'CR 32', kw:11, size:'600 × 450 × 1300' }, { role:'main', qty:n }), P('Шкаф управления насосами', {}), P('Трубопроводная обвязка', {}, { pipeMat:'steel' })];
    if (withTank) parts.push(P('Гидробак мембранный 300 л', {}, { rows:[{ k:'Габариты', v:'650 × 650 × 1200' }] }));
    const p=StationLayout.solve({ cont:C('block', { sizeAuto:true }), parts, req:{ kind:'pump', q:120, head:45, reserve:1 } }), label=`насосы ${n}${withTank ? ' + бак' : ''}`;
    if (p.level==='error') continue;
    assert.ok(HydroScheme.ok(p) && !StationScheme.ok(p), label+': гидравлическая, не пневматическая');
    const sv=HydroScheme.svg(p, meta(p)); Check.sheet(sv, label); Check.crossing(sv, label);
    assert.ok(sv.includes('Схема гидравлическая') && sv.includes('принципиальная') && /\.\d{3} Г3</.test(sv), label+': название и код Г3');
    assert.strictEqual((sv.match(/fill="#000"/g)||[]).length>=Math.min(n, 6)*2, true, label+': насосы и обратные клапаны — зачернённые треугольники');
    if (withTank) assert.ok(sv.includes('на напорном коллекторе'), label+': гидробак в перечне');
    if (n>6) assert.ok(sv.includes('Показаны 6 насосов из '+n), label+': больше шести — примечание');
    if (n>1) assert.ok(sv.includes(`${n-1} рабочих, 1 резервн.`), label+': резерв');
  }
  assert.ok(!HydroScheme.ok(solve(C('block'), [comp, dryer])), 'у компрессорной — нет');
});

Check.run('крыша: плоская, двускатная, односкатная', ()=>{
  assert.strictEqual(StationGeo.roof(C('block', { roof:'gable' })), 'gable');
  assert.strictEqual(StationGeo.roof(C('sea20', { roof:'gable' })), 'flat', 'морской — штатная плоская');
  assert.strictEqual(StationGeo.roof(C('block', { roof:'<x>' })), 'flat', 'неизвестное — плоская');
  assert.strictEqual(StationGeo.rise('gable', 2440), Math.round(1220*Math.tan(8*Math.PI/180)));
  assert.strictEqual(StationGeo.rise('mono', 2440), Math.round(2440*Math.tan(5*Math.PI/180)));
  assert.strictEqual(StationGeo.rise('flat', 2440), 0);
  for (const rf of ['flat', 'gable', 'mono']){
    const p=solve(C('block', { roof:rf, sizeAuto:true }), [comp, dryer, rec]); Check.plan(p, 'крыша '+rf);
    assert.strictEqual(p.geo.roof, rf); assert.strictEqual(p.geo.rise>0, rf!=='flat', rf+': подъём');
    const sv=StationDrawing.svg(p, meta(p)); Check.sheet(sv, 'крыша '+rf);
    assert.strictEqual(sv.includes('Крыша — '), rf!=='flat', rf+': в технических требованиях');
    const sc=new StScene(p, {}).build(); assert.ok(sc.bounds().hi[2]>=sc.top+p.geo.rise/1000-1e-6, rf+': крыша в 3D');
    for (const { mesh } of sc.groups.values()) assert.ok(mesh.p.every(Number.isFinite), rf+': NaN в 3D');
  }
  assert.notStrictEqual(StationLayout.hash({ cont:C('block', { roof:'gable' }), parts:[comp] }), StationLayout.hash({ cont:C('block'), parts:[comp] }), 'отпечаток: крыша');
});

Check.run('отопление: теплопотери, тепло оборудования, рекуперация, конвекторы у стен', ()=>{
  const cont=(o)=>C('block', Object.assign({ sizeAuto:true, sys:{ light:true, heat:true, vent:true } }, o||{}));
  const at=(t, o, parts)=>StationLayout.solve({ cont:cont(o), parts:parts||[comp, dryer, rec, cab], req:{ tmin:t } });
  const p=at(-40); Check.plan(p, 'отопление'); const h=p.heat;
  assert.ok(h && h.on && h.tout===-40 && h.tin===StationNorms.INSIDE, 'расчёт есть, температура снаружи — из требований');
  assert.ok(h.qStop>0 && Math.abs(h.qStop-(h.qEnv+h.qInf))<=1, 'потери = ограждения + воздух');
  assert.ok(StationHeat.UNITS.some(([kw])=>kw===h.kw) && h.n>=1 && h.heaters.length===h.n, 'конвекторы из ряда мощностей, мест — по числу');
  assert.ok(h.short || h.n*h.kw>=h.need-1e-9, 'мощности хватает (с запасом 10 %)');
  assert.ok(Math.abs(h.need-Math.max(h.qStop, h.qRun||0)*StationHeat.RESERVE/1000)<0.01, 'нужно — наибольшее из «стоит» и «работает»');
  // места: у стен, внутри, не перед оборудованием, не под шкафом, не в двери
  const [L, W]=p.int, fl=p.items.filter(i=>i.mount==='floor'), cabs=p.items.filter(i=>i.mount==='wall');
  for (const q of h.heaters){
    assert.ok(q.x>=(p.geo.x0||0)-1 && q.x+q.lx<=L+1 && q.y>=-1 && q.y+q.ly<=W+1 && q.z===StationHeat.CONV.z, 'конвектор внутри, у пола');
    assert.ok(Math.abs(q.y)<=1 || Math.abs(q.y+q.ly-W)<=1 || Math.abs(q.x-(p.geo.x0||0))<=1 || Math.abs(q.x+q.lx-L)<=1, 'конвектор — у стены');
    for (const i of fl){ const ox=Math.min(q.x+q.lx, i.x+i.lx)-Math.max(q.x, i.x), oy=Math.min(q.y+q.ly, i.y+i.ly)-Math.max(q.y, i.y); assert.ok(!(ox>0 && oy>0), 'конвектор не под оборудованием'); }
    for (const c of cabs.filter(c=>c.wall===q.wall)){ const a=q.wall==='front' || q.wall==='back' ? [q.x, q.x+q.lx, c.x, c.x+c.lx] : [q.y, q.y+q.ly, c.y, c.y+c.ly];
      assert.ok(Math.min(a[1], a[3])-Math.max(a[0], a[2])<=0, 'конвектор не под настенным шкафом'); }
    if (p.door==='side') assert.ok(!(q.wall==='front' && q.x<(p.geo.x0||0)+StationLayout.ENTRY[1] && q.x+q.lx>(p.geo.x0||0)+StationLayout.ENTRY[0]), 'не в двери');
  }
  // холоднее — больше; теплее — меньше; рекуперация уменьшает нужное при работе
  assert.ok(at(-55).heat.need>h.need && at(-15).heat.need<h.need, 'мощность растёт с морозом');
  const off=at(-40, { sys:{ light:true, heat:true, vent:true, rec:false } }).heat;
  assert.ok(off.rec===false && h.rec===true && off.qRun>h.qRun, 'без рециркуляции подогрев забираемого воздуха больше');
  assert.ok(p.issues.some(i=>/^Отопление: теплопотери при −40 °C/.test(i.text) && /Конвекторы: \d+ × /.test(i.text)), 'сведения в окне «Компоновка»');
  // утепление толще — потери меньше; цельносварной (мостики холода) — больше
  assert.ok(at(-40, { ins:'150 мм' }).heat.qEnv<at(-40, { ins:'50 мм' }).heat.qEnv, 'утепление');
  assert.ok(StationLayout.solve({ cont:C('welded', { sizeAuto:true }), parts:[comp, dryer], req:{ tmin:-40 } }).heat.U>StationLayout.solve({ cont:C('block', { sizeAuto:true }), parts:[comp, dryer], req:{ tmin:-40 } }).heat.U, 'мостики холода цельносварного');
  // отопление не нужно — конвекторов нет
  const no=at(-40, { sys:{ light:true, heat:false, vent:true } }).heat; assert.ok(!no.on && no.n===0 && no.heaters.length===0, 'без отопления — без конвекторов');
  // чертёж и 3D: конвекторы показаны, в ТТ — число и мощность
  const sv=StationDrawing.svg(p, meta(p)); Check.sheet(sv, 'отопление: чертёж');
  assert.ok(sv.includes(`Электроконвекторы ${h.n} × ${StationHeat.kw(h.kw)} кВт`), 'конвекторы — в технических требованиях');
  const sc=new StScene(p, {}); sc.build(); assert.ok(sc.groups.size>0, '3D');
  // насосная: мало тепла от насосов — конвекторы нужны и при работе
  const ns=StationLayout.solve({ cont:C('block', { sizeAuto:true, sys:{ heat:true, rec:false } }), parts:[pumpS, cab], req:{ tmin:-40 } }).heat;
  assert.ok(ns.base && ns.base.kind==='pump' && ns.qRun>0, 'насосы почти не греют');
  // лето: вентиляция по теплу оборудования
  assert.ok(h.vent && h.vent.m3h>0 && h.vent.cool>0 && h.vent.area>0, 'вентиляция летом');
  const dg=StationLayout.solve({ cont:C('sea40'), parts:[dgu, ats], req:{ tmin:-40 } }).heat; assert.ok(dg.vent.rad>0, 'ДГУ: воздух радиатора');
});

Check.run('ДГУ: отсек топливного бака — перегородка, своя дверь, горловина снаружи', ()=>{
  const fuel=P('Дополнительный топливный бак', {}, { rows:[{ k:'Объём', v:'1000 л' }] });
  for (const ct of ['sea20', 'sea40', 'block', 'welded', 'north']){
    const p=solve(C(ct, { sizeAuto:ct==='block' || ct==='welded' || ct==='north' }), [dgu, ats, fuel]); const label='отсек бака '+ct; Check.plan(p, label);
    if (p.level==='error') continue;
    const f=p.fuel, t=p.items.find(i=>i.tank); assert.ok(f && t, label+': отсек есть');
    assert.ok(f.part>=StationLayout.TANK.part && f.x1>=t.x+t.lx, label+': бак за перегородкой');
    assert.ok(f.fill && ['left', 'back'].includes(f.fill.wall) && f.fill.z>0 && f.fill.z<p.int[2], label+': горловина снаружи');
    assert.ok(!(p.doors||[]).some(d=>d.x0<f.x1+f.part && d.x1>0 && d.wall==='front' && !(d.x0===f.door.x0 && d.x1===f.door.x1)), label+': в отсек — только своя дверь');
    const sv=StationDrawing.svg(p, meta(p)); Check.sheet(sv, label+': чертёж');
    assert.ok(/Бак поз\. \d+ — в отсеке за противопожарной перегородкой \(EI 45\)/.test(sv), label+': требование в ТТ');
    assert.ok(p.issues.some(i=>/отсек/i.test(i.text)), label+': сведения об отсеке');
    const sc=new StScene(p, {}).build(); for (const { mesh } of sc.groups.values()) assert.ok(mesh.p.every(Number.isFinite), label+': NaN в 3D');
  }
  const no=solve(C('sea40'), [dgu, ats]); assert.ok(!no.fuel && !no.items.some(i=>i.tank), 'без бака — без отсека');
});

Check.run('3D-вид (WebGL): сцена, камера, свет', ()=>{
  const muf=P('Глушитель на крыше', {}), fuel=P('Дополнительный топливный бак', {}, { rows:[{ k:'Объём', v:'1000 л' }] }), fl=P('Топливопровод и запорная арматура', {}, { pipeMat:'steel' });
  const deep=P('Компрессор глубокий', { cat:'comp_screw', model:'D 90', kw:90, size:'2000 × 1500 × 1800' }, { role:'main' });
  const compS=P('Винтовой компрессор DVK 22', { cat:'comp_screw', maker:'Dalgakiran', model:'DVK 22', kw:22, size:'1100 × 750 × 1300', mass:420 }, { role:'main' });
  const plans={ 'КС': solve(C('block', { sys:{ light:true, heat:true, vent:true, ops:true } }), [compS, dryer, rec, flt, cab, P('Трубопровод', {}, { pipeMat:'inox' })]),
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
    if (p.roof && p.roof.length){ const m=p.roof[0]; assert.ok(b.hi[2]>=sc.top+(m.gap+m.d)/1000-1e-6 && b.hi[0]>=sc.ox+(m.x+m.lx+m.outlet)/1000, `${label}: глушитель с выхлопом вбок — в кадре`); }
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

Check.run('3D: оснащение — пожарная безопасность, свет, двери с доводчиками, знаки, логотипы', ()=>{
  const all={ power:true, light:true, heat:true, vent:true, ops:true, fire:true };
  const ks=StationLayout.solve({ cont:C('block', { sizeAuto:true, sys:all, roof:'gable' }), parts:[comp, dryer, rec, flt, cab, P('Трубопровод', {}, { pipeMat:'steel' })], req:{ kind:'comp', fire:'В4' } }); Check.plan(ks, 'оснащение');
  // расчёт пожарной безопасности (СП 485.1311500.2020, прил. И; паспорт «Буран-2,5»): по площади и объёму, по геометрии
  // распыла (квадрат 2,64 × 2,64 м), над затенёнными зонами за агрегатами; огнетушители (ППР в РФ), выход
  const F=ks.fire, q=F.rooms[0], Wf=ks.int[1];
  assert.ok(F.auto && F.ops && F.cls==='B' && F.cat==='В4' && !F.zone, 'пожаротушение и сигнализация, класс пожара B (масло), категория без класса зоны');
  assert.ok(Math.abs(q.nS-q.area/7)<1e-9 && Math.abs(q.nV-q.vol/16)<1e-9 && q.calc===Math.ceil(Math.max(q.nS, q.nV)-1e-6), 'модули: N = S/7 и V/16 (k1 = k3 = k4 = 1,0 по паспорту), большее');
  assert.ok(q.n>=q.calc && q.n===q.mods.length && q.grid===Math.ceil(Wf/2640)*Math.ceil((q.x1-q.x0)/2640) && q.shade>=1 && q.n===q.grid+q.shade, 'модули: сетка по квадрату распыла и над затенёнными зонами');
  let cover=true; for (let x=q.x0; x<=q.x1; x+=100) for (let y=0; y<=Wf; y+=100) if (!q.mods.some(m=>Math.abs(m.x-x)<=1320 && Math.abs(m.y-y)<=1320)) cover=false;
  assert.ok(cover, 'весь пол помещения — в квадратах распыла модулей');
  assert.ok(q.mods.filter(m=>m.shade).every(m=>m.y>Wf/2) && q.mods.every(m=>m.x>q.x0 && m.x<q.x1 && m.y>0 && m.y<Wf), 'над затенёнными зонами — у задней стены за агрегатами, все — над помещением');
  assert.ok(F.ext===1 && q.need===1 && q.rank==='3А, 70В, С, Е' && F.exit && F.exit.wall==='front' && F.exit.top===StationLayout.DOOR.h, 'огнетушитель у выхода — один (до него не более 30 м), ранг для категории В4; выход — входная дверь');
  const Fd=StationFire.calc(Object.assign({}, ks, { req:{ kind:'comp', fire:'Д' } })).rooms[0];
  assert.ok(Fd.need===0 && Fd.ext===1 && Fd.rank==='2А, 55В, С, Е', 'категория Д до 100 м²: по ППР (п. 401) можно без огнетушителя — один рекомендуется, ранг 2А, 55В');
  assert.ok(/квадрат 2,64 × 2,64 м/.test(StationFire.autoText(F)) && /100 %/.test(StationFire.autoText(F)), 'в тексте — геометрия распыла и запас модулей');
  assert.ok(StationFire.tt(ks).length===4 && /Буран-2,5/.test(StationFire.autoText(F)), 'тексты ТЗ');
  for (const view of ['in', 'out']){
    const sc=new StScene(ks, { view }).build(), D=[...sc.decals.values()];
    for (const { mat, mesh } of sc.groups.values()){
      if (mat.k===3) assert.ok(mesh.t.length===mesh.count*2 && sc.decals.has(mat.tex), view+': у наклейки — координаты текстуры и картинка');
      else assert.strictEqual(mesh.t.length, 0, view+': координаты текстуры — только у наклеек');
      assert.ok(mesh.p.every(Number.isFinite) && mesh.t.every(v=>v>=0 && v<=1), view+': геометрия'); }
    assert.ok(D.some(d=>d.type==='brand' && d.globe && d.parts.map(p=>p[0]).join('')==='ПНЕВМОТЕХ' && d.tag), view+': логотип ПНЕВМОТЕХ на контейнере');
    if (view==='in'){
      assert.ok(sc.cut && D.some(d=>d.type==='logo' && d.maker==='Dalgakiran' && d.ar>1), 'логотип производителя на оборудовании');
      const ext=sc.outfit.log.filter(q=>q.kind==='ext'); assert.ok(ext.length>=1 && ext.every(q=>q.top<=StOutfit.EXT), 'огнетушители: верх не выше 1,5 м');
      for (const id of ['F04', 'EXIT', 'POW_OUT', 'OPS']) assert.ok(D.some(d=>d.id===id), 'знак '+id);
      assert.strictEqual(sc.outfit.log.filter(q=>q.kind==='buran').length, F.mods, 'модули «Буран-2,5» на потолке — по расчёту');
      const ex=sc.outfit.log.find(q=>q.kind==='board' && q.id==='EXIT');
      assert.ok(ex && ex.wall==='front' && Math.abs(ex.u-F.exit.u)<=250 && ex.z0>=F.exit.top, 'табло «Выход» — над входной дверью');
      const op=sc.outfit.log.find(q=>q.kind==='ops'), en=ks.entry, near=op && en && en.wall==='front' && (op.wall==='left' ? Math.hypot(en.x1-(ks.geo.x0||0), op.u)<2500 : op.wall==='front' && Math.abs(op.u-(en.x0+en.x1)/2)<2500);
      assert.ok(op && (op.seen || near), 'щит ОПС — на видном месте или у входа: '+JSON.stringify(op));
      assert.ok(ext.length===1 && ext.every(q=>q.at[1]>sc.oy+0.05), 'огнетушитель виден: не на срезанной стене');
      const hs=ks.heat.heaters.filter(h=>h.wall!=='front'); assert.strictEqual(sc.outfit.log.filter(q=>q.kind==='heater').length, hs.length, 'конвекторы — на местах из расчёта');
    } else {
      assert.ok(!sc.cut && sc.closed && sc.openF.some(o=>o.kind==='entry'), 'снаружи: стена с входной дверью');
      for (const id of ['W08', 'P06', 'POW_NO', 'AUTO_OFF']) assert.ok(D.some(d=>d.id===id), 'снаружи — '+id);
      assert.ok(D.some(d=>d.id==='CAT' && d.cat==='В4' && !d.zone), 'снаружи — табличка категории на входной двери');
      assert.ok(sc.tris()<new StScene(ks, {}).build().tris(), 'снаружи внутреннее не строится'); }
    const b=sc.bounds(); assert.ok(b.hi[2]>=sc.top+sc.rise-1e-9, view+': крыша в кадре');
  }
  // ДГУ с отсеком бака: снаружи — дверь отсека (решётка внизу, доводчик), «Пожароопасно», «Открытый огонь запрещён», «ДТ»
  const dgm=Object.assign({}, dgu, { attrs:{ ...dgu.attrs, maker:'AKSA' } }), dg=solve(C('block', { sizeAuto:true }), [dgm, ats, P('Глушитель на крыше', {}), P('Дополнительный топливный бак', {}, { rows:[{ k:'Объём', v:'1000 л' }] })]);
  const so=new StScene(dg, { view:'out' }).build(), Do=[...so.decals.values()];
  assert.ok(so.openF.some(o=>o.kind==='tank') && ['W01', 'P02', 'DT'].every(id=>Do.some(d=>d.id===id)), 'отсек бака снаружи: дверь и знаки');
  assert.ok(Do.some(d=>d.id==='CAT' && d.cat==='В1' && d.zone==='П-I'), 'отсек бака: табличка «Категория В1, класс зоны П-I»');
  assert.ok(dg.fire.rooms.length===2 && dg.fire.ext===2 && !dg.fire.auto && dg.fire.mods===0, 'ДГУ с отсеком: огнетушители в двух помещениях, без пожаротушения — модулей нет');
  const si=new StScene(dg, {}).build(); assert.ok(dg.fire.ext===2 && si.outfit.log.filter(q=>q.kind==='ext').length===2, 'огнетушители: у входа и в отсеке бака');
  const fp=si.outfit.log.find(q=>q.kind==='fuelpump');
  assert.ok(fp && fp.x<dg.fuel.x1 && dg.power.list.some(q=>/Насос перекачки топлива/.test(q.name)) && dg.pipe && dg.pipe.medium==='fuel', 'насос перекачки топлива — в отсеке бака, в нагрузках, топливопровод по расчёту');
  assert.ok([...si.decals.values()].some(d=>d.type==='logo' && d.maker==='AKSA'), 'логотип ДГУ — на радиаторе');
  const byName=new StScene(solve(C('block', { sizeAuto:true }), [dgu, ats]), { makers:{ [dgu.id]:'AKSA' } }).build();   // производитель из названия (в браузере — по каталогу логотипов)
  assert.ok([...byName.decals.values()].some(d=>d.type==='logo' && d.maker==='AKSA'), 'производитель по названию');
  // морской: логотип на дверях в торце, исполнение без скатной крыши
  const sea=new StScene(solve(C('sea20'), [comp, dryer]), {}).build(); assert.ok(sea.rise===0 && [...sea.decals.values()].some(d=>d.type==='brand'), 'морской');
  // тёмная стена — логотип белыми буквами
  const dark=new StScene(solve(C('block', { sizeAuto:true, ral:'RAL 5010' }), [comp]), {}).build(); assert.ok([...dark.decals.values()].find(d=>d.type==='brand').light, 'на тёмной стене — белыми');
  // морской (в торце — его двери): горловина бака — в задней стене за баком, не на двери отсека
  const sf=solve(C('sea40'), [dgu, ats, P('Дополнительный топливный бак', {}, { rows:[{ k:'Объём', v:'1000 л' }] })]).fuel;
  assert.ok(sf.fill.wall==='back' && sf.fill.x>0 && sf.fill.x<sf.x1, 'горловина морского — в задней стене отсека');
});

Check.run('системы: освещение, розетки, нагрузки и вводной автомат', ()=>{
  const ks=StationLayout.solve({ cont:C('block', { sizeAuto:true, sys:{ power:true, light:true, heat:true, vent:true, ops:true } }), parts:[comp, dryer, rec, cab], req:{ kind:'comp', fire:'В4' } });
  const Lt=ks.light; assert.ok(Lt.on && Lt.n>=2 && Lt.E>=StationLight.LUX && Lt.em===Math.ceil(Lt.n/2), 'освещение: не ниже нормы, аварийное — половина светильников');
  assert.ok(Lt.n>=Math.ceil(StationLight.LUX*Lt.area*StationLight.KZ/(StationLight.LAMP.lm*Lt.eta)-1e-9), 'число светильников — методом коэффициента использования');
  assert.ok(StationLight.eta(1)===0.51 && StationLight.eta(0.1)===0.34 && StationLight.eta(9)===0.76 && Math.abs(StationLight.eta(0.9)-0.485)<1e-9, 'коэффициент использования — по индексу помещения');
  const K=ks.sockets; assert.ok(K.n230>=2 && K.n380===1 && K.ytp===1 && K.z===1000, 'сервисные розетки');
  const W=ks.power; assert.ok(W.inst>=37 && W.kw>=37 && W.kw<=W.inst && W.mode==='run', 'расчётная мощность — при работе компрессора');
  assert.ok(Math.abs(W.amp-W.kw*1000/(Math.sqrt(3)*400*0.85))<0.06 && W.breaker>=W.amp*1.25 && StationPower.BREAKERS.includes(W.breaker), 'ток и вводной автомат');
  const two=StationLayout.solve({ cont:C('block', { sizeAuto:true }), parts:[Object.assign({}, comp, { qty:2 })], req:{ kind:'comp', res:1 } }).power;
  assert.ok(two.list.some(q=>/резервный/.test(q.name) && q.kc===0) && two.run<2*37, 'резервный компрессор — без нагрузки');
  const dg=StationLayout.solve({ cont:C('block', { sizeAuto:true }), parts:[dgu, ats] }).power;
  assert.ok(dg.dgu && dg.list.some(q=>/Подогреватель/.test(q.name) && q.idle && !q.run) && !dg.list.some(q=>/Компрессор/.test(q.name)), 'ДГУ — собственные нужды, подогреватель в простое');
  assert.ok(StationPower.lines(W).length===2 && /вводной автомат — \d+ А/.test(StationPower.lines(W)[1]), 'строки итога');
  assert.ok(/около \d+ лк/.test(StationLight.text(Lt)) && /светильника|светильников/.test(StationLight.text(Lt)) && /ЯТП-0,25/.test(StationSockets.text(K)), 'тексты ТЗ');
  for (const [n, w] of [[21, '21 модуль'], [12, '12 модулей'], [3, '3 модуля'], [5, '5 модулей']]) assert.strictEqual(StationFire.pl(n, ['модуль', 'модуля', 'модулей']), w);
  const sc=new StScene(ks, {}).build(); assert.ok(sc.outfit.log.some(q=>q.kind==='socket'), '3D: розетки на стенах');
});

Check.run('сжатый воздух: байпас осушителя, диаметр трубы по расчёту, ресиверы без учёта, осушитель', ()=>{
  const pipe=P('Трубопровод', {}, { pipeMat:'steel', dn:'DN 25' });
  const ks=StationLayout.solve({ cont:C('block', { sizeAuto:true }), parts:[Object.assign({}, comp, { attrs:{ ...comp.attrs, flow:6, pressure:8 } }), Object.assign({}, dryer, { attrs:{ ...dryer.attrs, flow:7 } }), rec, pipe], req:{ kind:'comp' } });
  const ln=ks.lines.find(l=>l.medium==='air' && !l.header), bp=(ln.bypass||[])[0], dr=ks.items.find(i=>i.kind==='dryer');
  assert.ok(bp && bp.pos===dr.pos && bp.x1>bp.x0 && ln.gaps.some(([a, b])=>a===bp.x0 && b===bp.x1), 'байпас — между входом и выходом осушителя');
  const sc=new StScene(ks, {}).build(); assert.ok(sc.tris()>0, '3D с байпасом');
  const sch=StationScheme.svg(ks, meta(ks)); assert.ok(/fill="#000"/.test(sch) && /байпас/.test(sch), 'схема: байпас с нормально закрытым краном и примечание');
  Check.sheet(sch, 'схема с байпасом'); Check.crossing(sch, 'схема с байпасом');
  // диаметр: 6 м³/мин при 8 бар → 0,67 м³/мин в трубе, не более 8 м/с → внутри не менее 42 мм → DN 50; в составе DN 25 — мало
  const Q=ks.pipe; assert.ok(Q && Q.medium==='air' && Q.dn===50 && Q.set===25 && Q.small && Math.abs(Q.lines[0].d-42.3)<0.6, 'DN по расчёту: '+JSON.stringify(Q));
  assert.ok(ks.issues.some(t=>t.level==='warn' && /DN 25 меньше расчётного DN 50/.test(t.text)), 'замечание: DN в составе мал');
  assert.ok(/DN 50/.test(StationPipe.text(Q)) && /принять DN 50/.test(StationPipe.text(Q)), 'текст ТЗ');
  assert.ok(StationPipe.dn(42.3)===50 && StationPipe.dn(52.5)===50 && StationPipe.dn(52.6)===65 && StationPipe.dn(10)===15, 'ряд DN');
  // ресиверы: 2000 л при 8 бар — p·V 1,6: без учёта — 2 × 1000 л; 900 л — без учёта и так
  assert.deepStrictEqual(AirChain.split(2000, 8), { n:2, v:1000 }); assert.strictEqual(AirChain.split(900, 8), null); assert.deepStrictEqual(AirChain.split(1500, 13), { n:3, v:500 });
  const big=P('Воздушный ресивер РВ 2000', { cat:'receiver', model:'РВ 2000/11', volume:2000, size:'1000 × 1000 × 2600', mass:400 });
  const kr=StationLayout.solve({ cont:C('block', { sizeAuto:true }), parts:[Object.assign({}, comp, { attrs:{ ...comp.attrs, flow:6, pressure:8 } }), dryer, big], req:{ kind:'comp' } });
  const rs=kr.air.recs.find(r=>r.key==='recv-split'); assert.ok(rs && rs.qty===2 && rs.replace.includes(big.id) && /2 × 1 000 л/.test(rs.title), 'замена ресивера на учёте: '+JSON.stringify(rs));
  // осушителя нет — рекомендация рефрижераторного с байпасом
  const nd=StationLayout.solve({ cont:C('block', { sizeAuto:true }), parts:[Object.assign({}, comp, { attrs:{ ...comp.attrs, flow:6, pressure:8 } }), rec], req:{ kind:'comp' } });
  assert.ok(nd.air.recs.some(r=>r.key==='dryer-refrig' && r.cat==='dryer_refrig') && nd.issues.some(t=>/Осушителя в составе нет/.test(t.text)), 'рекомендация рефрижераторного осушителя');
  // насосная: DN по подаче рабочих насосов (без резервного)
  const pm=P('Насос CR 32', { cat:'pump', flow:32, head:50, kw:7.5, size:'600 × 400 × 1000' }, { role:'main', qty:2 });
  const kp=StationLayout.solve({ cont:C('block', { sizeAuto:true }), parts:[pm, P('Трубопровод', {}, { pipeMat:'inox' })], req:{ kind:'pump', res:1 } }).pipe;
  assert.ok(kp && kp.medium==='water' && kp.lines.length===2 && kp.lines[0].dn===80 && kp.lines[1].dn===100, 'насосная: напорный DN 80, всасывающий DN 100 при 32 м³/ч: '+JSON.stringify(kp));
});

Check.run('масса и центр тяжести, строповка; знаки № 9 и № 12 (ГОСТ 14192-96) на 3D-виде', ()=>{
  const ks=solve(C('block', { sizeAuto:true }), [comp, dryer, rec, flt, cab]), M=ks.mass, [Le, We, He]=ks.geo.ext;
  assert.ok(M && M.cont>0 && M.eq===650+120+180 && Math.abs(M.mass-(M.cont+M.eq+M.other))<=10, 'масса: контейнер, оборудование с паспортной массой, трубы и системы');
  assert.ok(M.cg.x>0 && M.cg.x<Le && M.cg.y>0 && M.cg.y<We && M.cg.z>0 && M.cg.z<He, 'центр тяжести — внутри контейнера');
  assert.ok(M.missing.length && /без поз\. /.test(StationMass.text(M)), 'позиции без массы — названы');
  const S=M.sling; assert.ok(!S.beam && !S.frame && S.legs.length===4 && S.legs.every(q=>q.deg<=StationMass.ANGLE && q.len%100===0), 'короткий блок-контейнер: четыре ветви к крюку над ЦТ, угол с вертикалью не более 45°');
  const lg=solve(C('block', { size:'9000 × 2400 × 2600' }), [comp, dryer, rec, cab]).mass.sling;
  assert.ok(lg.beam && !lg.frame && lg.legs.every(q=>q.deg<=StationMass.ANGLE), 'длинный блок-контейнер — с траверсой');
  // морской: только рамной траверсой — ветви к верхним фитингам вертикальны (ISO 3874: наклонными стропами груз не поднимают)
  const sp=solve(C('sea40'), [dgu, ats]), F=sp.mass.sling.frame;
  assert.ok(F && sp.mass.sling.legs.every(q=>q.deg===0) && F.deg<=StationMass.ANGLE && F.lugs[0]<sp.mass.cg.x && F.lugs[1]>sp.mass.cg.x, 'морской: рамная траверса над ЦТ, ветви вертикальны');
  assert.ok(StationDrawing.lift(sp).some(t=>/рамной траверсой/.test(t) && /ISO 3874/.test(t)) && StationDrawing.lift(ks).some(t=>/не более 45°/.test(t)), 'ТТ: строповка по схеме');
  const T3=Check.texts(StationDrawing.sheets(sp, meta(sp))[2]).map(q=>q.t);
  assert.ok(T3.includes('рамная траверса') && T3.some(t=>/вертикально/.test(t)), 'лист 3: рамная траверса');
  // 3D снаружи: № 9 — у каждого из четырёх верхних углов (на длинной стене или на торце), № 12 — не меньше чем на двух стенах,
  // в проекции ЦТ; «Масса брутто»; на тёмной стене — светлые (п. 5.10)
  for (const [p, label] of [[ks, 'блок'], [sp, 'морской 40'], [solve(C('sea20', { ral:'RAL 5010' }), [comp, dryer, rec, cab]), 'морской 20, тёмный']]){
    const sc=new StScene(p, { view:'out' }).build(), L=sc.outfit.log, D=[...sc.decals.values()], ox=sc.ox*1000, oy=sc.oy*1000, Lx=sc.Le*1000, Wy=sc.We*1000;
    const sl=L.filter(q=>q.kind==='SLING'), cg=L.filter(q=>q.kind==='COG');
    assert.strictEqual(sl.length, 4, label+': четыре знака № 9');
    assert.ok(sl.every(q=>q.wall==='front' || q.wall==='back' ? Math.min(q.u+ox, Lx-q.u-ox)<=400 : Math.min(q.u+oy, Wy-q.u-oy)<=400), label+': № 9 — у углов');
    assert.ok(new Set(cg.map(q=>q.wall)).size>=2 && cg.every(q=>{ const c=sc.outfit.cogOn(q.wall); return Math.abs(c.u-q.u)<1 && Math.abs(c.z-q.z)<1; }), label+': № 12 — на двух стенах и больше, в проекции ЦТ');
    assert.ok(L.filter(q=>q.kind==='MASS').length===1 && D.some(d=>d.id==='MASS' && d.kg===p.mass.mass), label+': надпись «Масса брутто»');
    const dark=label.includes('тёмный'); assert.ok(D.filter(d=>['SLING', 'COG', 'MASS'].includes(d.id)).every(d=>!!d.light===dark), label+': цвет знаков по стене');
    for (const w of ['front', 'back', 'left', 'right']){ const R=sc.outfit.O[w].slice(-40), Q=L.filter(q=>q.wall===w && ['SLING', 'COG', 'MASS'].includes(q.kind));
      assert.ok(Q.length<=R.length, label+': знаки учтены как занятые места'); } }
});

Check.run('цвет по фото: фон убирается, главный цвет корпуса', ()=>{
  const img=(w, h, f)=>{ const d=new Uint8ClampedArray(w*h*4); for (let y=0; y<h; y++) for (let x=0; x<w; x++){ const c=f(x, y); d.set(c.length===4 ? c : [...c, 255], (y*w+x)*4); } return d; };
  const near=(hex, c, tol=28)=>{ const v=[1, 3, 5].map(k=>parseInt(hex.slice(k, k+2), 16)); return /^#[0-9a-f]{6}$/.test(hex) && v.every((x, k)=>Math.abs(x-c[k])<=tol); };
  const W=[255, 255, 255], blue=[30, 80, 160], gray=[205, 208, 212];
  assert.ok(near(PhotoTint.pick(img(60, 40, (x, y)=>x>12 && x<48 && y>6 && y<36 ? (x%6===0 ? [20, 20, 20] : blue) : W), 60, 40), blue), 'синий корпус на белом с тёмными решётками');
  assert.ok(near(PhotoTint.pick(img(40, 40, (x, y)=>Math.hypot(x-20, y-20)<14 ? [200, 120, 30] : [0, 0, 0, 0]), 40, 40), [200, 120, 30]), 'прозрачный фон (PNG)');
  assert.ok(near(PhotoTint.pick(img(80, 60, (x, y)=>x>10 && x<70 && y>5 && y<55 ? (x>50 && y<20 ? blue : gray) : W), 80, 60), gray), 'серый корпус с синей панелью — серый');
  assert.ok(near(PhotoTint.pick(img(60, 40, (x, y)=>x>8 && x<52 && y>4 && y<36 ? [235, 236, 238] : [120, 124, 128]), 60, 40), [235, 236, 238]), 'светлый корпус на сером фоне');
  assert.strictEqual(PhotoTint.pick(img(40, 40, (x, y)=>x===20 && y===20 ? [255, 0, 0] : W), 40, 40), '', 'почти всё — фон: цвет не определить');
  // цвет из фото — в расстановке и в отпечатке (3D обновится), подпись RAL — из характеристик
  const ph=P('Компрессор с фото', { cat:'comp_screw', size:'1400 × 900 × 1500' }, { role:'main', photo:{ src:'/img/test-tint.jpg' }, rows:[{ k:'Цвет', v:'RAL 7035' }] });
  const h0=StationLayout.hash({ cont:C('block'), parts:[ph] }); PhotoTint.cache.set('/img/test-tint.jpg', '#1e50a0');
  const it=solve(C('block', { sizeAuto:true }), [ph]).items.find(i=>i.kind==='compressor');
  assert.ok(it.color==='#1e50a0' && StationLayout.hash({ cont:C('block'), parts:[ph] })!==h0, 'цвет корпуса — по фото, отпечаток изменился');
  assert.strictEqual(StationEquip.color(ph, 'compressor').text, 'RAL 7035', 'подпись цвета — из характеристик');
  PhotoTint.cache.delete('/img/test-tint.jpg');
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
