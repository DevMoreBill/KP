// Габаритный чертёж и 3D-вид станции в контейнере — строки SVG по результату StationLayout (station-layout.js).
// Без DOM: в картинки для КП их переводит station-ui.js (StationImages), node-тест проверяет, что SVG собирается.
// Чертёж — лист А4 по ЕСКД (лист, рамка, основная надпись, линии, размеры — station-eskd.js): разрезы А–А и Б–Б, вид слева,
// упрощённые изображения оборудования, полки позиций, перечень составных частей, техническая характеристика и требования.
// 3D-вид — разрез: крыша и стенки со стороны зрителя срезаны, видно расставленное оборудование; цвета — из характеристик.
'use strict';

// ---------------------------------------------------------------- SVG: примитивы
class StSvg {
  static esc(s){ return String(s??'').replace(/[&<>"]/g, c=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c])); }
  static f(v){ return Math.round(v*10)/10; }
  static pts(P){ return P.map(p=>this.f(p[0])+','+this.f(p[1])).join(' '); }
  static poly(P, fill, stroke, sw=1, extra=''){ return `<polygon points="${this.pts(P)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"` : ''}${extra}/>`; }
  static line(x1, y1, x2, y2, stroke, sw=1, extra=''){ return `<line x1="${this.f(x1)}" y1="${this.f(y1)}" x2="${this.f(x2)}" y2="${this.f(y2)}" stroke="${stroke}" stroke-width="${sw}"${extra}/>`; }
  static rect(x, y, w, h, fill, stroke, sw=1, extra=''){
    return `<rect x="${this.f(x)}" y="${this.f(y)}" width="${this.f(Math.max(0, w))}" height="${this.f(Math.max(0, h))}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ''}${extra}/>`; }
  static circle(x, y, r, fill, stroke, sw=1, extra=''){ return `<circle cx="${this.f(x)}" cy="${this.f(y)}" r="${this.f(r)}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ''}${extra}/>`; }
  static text(x, y, s, o={}){
    return `<text x="${this.f(x)}" y="${this.f(y)}" font-size="${o.size||18}"${o.weight ? ` font-weight="${o.weight}"` : ''} fill="${o.fill||'#1d2733'}" text-anchor="${o.anchor||'middle'}"${o.rot ? ` transform="rotate(${o.rot} ${this.f(x)} ${this.f(y)})"` : ''}${o.extra||''}>${this.esc(s)}</text>`; }
  /** примерная ширина строки, px (Arial, кириллица) */
  static tw(s, size){ return String(s).length*size*0.56; }
  /** перенос по обычным пробелам (неразрывный пробел держит «РВ 500/11» в одной строке) */
  static wrap(s, max){ const out=[]; let cur=''; for (const w of String(s).trim().split(/[ \t\n]+/)){ if (cur && (cur+' '+w).length>max){ out.push(cur); cur=w; } else cur=(cur ? cur+' ' : '')+w; } if (cur) out.push(cur); return out; }
  /** строка из частей разного начертания: [[текст, {weight, fill}], …] */
  static spans(x, y, parts, o={}){
    const t=parts.filter(q=>q[0]).map(([v, q={}])=>`<tspan${q.weight ? ` font-weight="${q.weight}"` : ''}${q.fill ? ` fill="${q.fill}"` : ''}>${this.esc(v)}</tspan>`).join('');
    return `<text x="${this.f(x)}" y="${this.f(y)}" font-size="${o.size||18}" fill="${o.fill||'#1d2733'}" text-anchor="${o.anchor||'middle'}">${t}</text>`;
  }
  static doc(W, H, body, defs=''){
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Arial, Helvetica, sans-serif"><defs>${defs}</defs>${body}</svg>`; }
  /** 12345 → «12 345» */
  static n(v){ return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
}

// ---------------------------------------------------------------- габаритный чертёж (ЕСКД)
// Лист А4 (EskdSheet, station-eskd.js): разрез А–А — вдоль контейнера у стены прохода (видно всё оборудование; шкафы на
// этой стене — на плане), под ним в проекционной связи разрез Б–Б — план под потолком, справа от разреза А–А — вид слева
// (торец снаружи), если помещается. Масштаб — наибольший из ГОСТ 2.302, при котором виды с размерами и полками позиций
// помещаются над перечнем составных частей, технической характеристикой и техническими требованиями. Размеры:
// габаритные, установочные (цепочка оборудования у задней стены, фитинги морского контейнера), присоединительные (выход
// трубопровода через торец: высота и привязка). Позиции — номера на полках линий-выносок, каждая один раз.
class StationDrawing {
  static get W(){ return EskdSheet.FMT.A4[0]*EskdSheet.K; }
  static get H(){ return EskdSheet.FMT.A4[1]*EskdSheet.K; }
  static TB = 237;               // верх основной надписи, мм листа
  static L0 = 25;                // поле изображений по ширине: 25…200 мм (рамка 20…205)
  static L1 = 200;
  static TOP = 22;               // ниже графы 26
  // морские контейнеры: расстояние между центрами фитингов (ISO 1161), мм — установочные размеры
  static FIT = { 2991:2787, 6058:5853, 9125:8918, 12192:11985 };
  static FIT_W = 2259;

  /** plan — StationLayout.solve(...); meta: {title, cont, colorText, deck, org, dev, date} */
  static svg(plan, meta={}){ return new StationDrawing(plan, meta).sheets()[0]; }
  /** все листы чертежа — массив SVG */
  static sheets(plan, meta={}){ return new StationDrawing(plan, meta).sheets(); }

  constructor(plan, meta){
    const g=plan.geo; this.p=plan; this.m=meta||{}; this.g=g;
    [this.Le, this.We, this.He]=g.ext; [this.Li, this.Wi, this.Hi]=plan.int;
    this.ox=(this.Le-this.Li)/2; this.oy=(this.We-this.Wi)/2; this.zf=StationGeo.zFloor(g.type, g.t);
    this.dz=plan.chassis ? (this.m.deck||1150) : 0;
    this.rf=plan.roof||[]; this.up=this.rf.length ? Math.max(...this.rf.map(m=>m.gap+m.d)) : 0;   // выхлоп глушителя — горизонтально
    this.rise=g.rise||0; this.fuel=plan.fuel||null; this.heaters=(plan.heat && plan.heat.heaters)||[];   // скатная крыша, отсек бака ДГУ, конвекторы
    this.pipes=plan.piping||[]; this.lines=this.pipes.length ? this.pipes[0].lines : [];
    // двери: оператора — одностворчатая в стене прохода или в торце (entry), ворота для демонтажа в торце (gates; у морского —
    // его двери), сервисные — для демонтажа там, где к торцу не провезти; у ДГУ — дверь-жалюзи в торце; на плане — створки и
    // дуги открывания
    const sd=plan.doors||[], leaf=D=>D.length ? Math.max(...D.map(d=>d.w/d.leaves)) : 0; this.dg=plan.dguDoor||null;
    this.en=plan.entry||null; this.gt=plan.gates||null;
    this.sdF=sd.filter(d=>d.wall!=='back'); this.sdB=sd.filter(d=>d.wall==='back');
    this.swing=Math.max(this.en && this.en.wall==='front' ? this.en.w : 0, leaf(this.sdF), this.fuel ? this.fuel.door.x1-this.fuel.door.x0 : 0); this.swingB=leaf(this.sdB);
    this.swingR=this.dg ? this.dg.w/2 : 0;
    this.ai=StationDrawing.aisle(plan, this.Wi);
    this.ms=plan.mass||null;
    // ресиверы снаружи — на площадке за дальним торцом: сколько добавляют к длине (с площадкой) и над крышей
    this.ext=plan.outside||[];
    this.outL=this.ext.length ? Math.max(...this.ext.map(i=>this.ox+i.x+i.lx+200))-this.Le : 0;
    this.hood=plan.vent && (plan.vent.roof||[]).length ? StationVent.HOOD : 0;   // колпаки выброса на крыше
    this.hTop=Math.max(this.up, this.hood, this.rise, ...this.ext.map(i=>this.zf+i.z+i.h-this.He));
    this.hidden=plan.items.filter(i=>i.mount==='wall' && i.wall==='front');           // на стене прохода — на разрезе А–А не видны
    this.outs=this.lines.filter(l=>l.label && l.x1>=this.Li-1).map(l=>({ y:l.y, z:l.z })).sort((a, b)=>a.z-b.z);
    this.fit=g.sea && StationDrawing.FIT[this.Le] ? [StationDrawing.FIT[this.Le], StationDrawing.FIT_W] : null;
    // номера позиций — на плане (виден весь состав, глушитель на крыше — штриховой), каждый номер один раз
    const first=new Map(); for (const it of [...plan.items, ...this.ext].sort((a, b)=>a.x-b.x)) if (!first.has(it.pos)) first.set(it.pos, it);
    this.posPlan=[...first.values()];
    this.posRoof=this.rf.filter((m, k, A)=>A.findIndex(q=>q.pos===m.pos)===k && !first.has(m.pos));
    this.pipePos=this.pipes.find(q=>q.pos!=null && !first.has(q.pos)) || null;
    this.nPos=this.posPlan.length+this.posRoof.length+(this.pipePos ? 1 : 0);
  }

  // ---- текстовая часть
  /** перечень составных частей: позиция, наименование, количество, масса */
  rows(){
    const by=new Map();
    for (const it of [...this.p.items, ...this.ext, ...this.rf]){ const e=by.get(it.pos); if (e) e.n++; else by.set(it.pos, { pos:it.pos, name:it.brief||it.name, n:1, mass:it.mass }); }
    for (const pp of this.pipes.filter(q=>q.pos!=null)) by.set(pp.pos, { pos:pp.pos, name:pp.brief||pp.name, n:pp.qty||1, mass:null });
    return [...by.values()].sort((a, b)=>a.pos-b.pos);
  }
  /** техническая характеристика (ГОСТ 2.316): что известно о станции */
  tech(){
    const n=StationLayout.n, a=this.p.air, I=this.p.items, out=[];
    if (a && a.q>0) out.push(`Производительность — ${AirChain.m3(a.q)} м³/мин при ${AirChain.m3(a.bar)} бар`);
    if (a && a.cls) out.push(`Класс воздуха по ISO 8573-1 — ${a.cls}`);
    const kw=k=>{ const L=I.filter(i=>i.kind===k); return L.length && L.every(i=>i.kw>0) ? L.reduce((s, i)=>s+i.kw, 0) : 0; };
    const em=kw('compressor')+kw('pump'), dg=kw('dgu');
    if (em) out.push(`Мощность электродвигателей — ${n(em)} кВт`);
    if (dg) out.push(`Мощность ДГУ — ${n(dg)} кВт`);
    const all=[...I, ...this.ext, ...this.rf], mass=all.every(i=>i.mass>0) ? all.reduce((s, i)=>s+i.mass, 0) : 0;
    if (mass) out.push(`Масса оборудования — ${n(mass)} кг`);
    if (this.ms) out.push(StationMass.text(this.ms));
    out.push(`Внутри — ${n(this.Li)} × ${n(this.Wi)} × ${n(this.Hi)} мм`);
    if (this.g.t) out.push(`Утепление стен — ${n(this.g.t)} мм`);
    if (this.rise){ const R=StationGeo.ROOFS[this.g.roof]; out.push(`Крыша — ${R.name}${R.deg ? `, уклон ${R.deg}°` : ''}`); }
    const col=String(this.m.colorText||'').replace(/^цвет\s+/i, ''); if (col) out.push(`Окраска — ${col}`);
    out.push(...StationNorms.tech(this.p));
    return out;
  }
  /** технические требования: коротко, номерами пунктов */
  reqs(){
    const p=this.p, n=StationLayout.n, [aRec, aMin]=p.aisleRule||[1000, 800], dgu=p.items.some(i=>i.kind==='dgu');
    const P=f=>[...new Set(p.items.filter(f).map(i=>i.pos))].sort((a, b)=>a-b), list=a=>'поз. '+a.join(', ');
    const wall=P(i=>i.mount==='wall'), hang=P(i=>i.mount==='pipe');
    const zw=p.items.filter(i=>i.mount==='wall').map(i=>i.z), z0=zw.length ? Math.min(...zw) : 0;
    const sys=(p.extra||[]).filter(e=>e.kind==='skip' && !e.nodims).map(e=>String(e.name||'').trim().replace(/^./, c=>c.toLowerCase())).filter(Boolean);
    // цепочка по ходу воздуха: компрессоры — в коллектор, одинаковые осушители и фильтры подряд — параллельно (AirChain.groups)
    const U=p.air && p.air.chain.length>1 ? p.air.units||[] : [], qn=G=>G.reduce((s, u)=>s+(u.qty||1), 0), C=U.filter(u=>u.kind==='compressor');
    const step=(G, par)=>{ const k=qn(G), ps=[...new Set(G.map(u=>u.pos))].join(', '); return k>1 ? `${ps} (${k} шт. ${par ? 'параллельно' : 'последовательно'})` : ps; };
    const chain=U.length ? [...(C.length ? [step(C, true)] : []), ...AirChain.groups(U.filter(u=>u.kind!=='compressor')).map(G=>step(G, G[0].kind!=='receiver'))] : [];
    return [
      'Размеры, привязки и трассы уточняются рабочим проектом.',
      `Проход для оператора и обслуживания — не менее ${n(aMin)} мм в свету (ПУЭ, п. 4.1.23), рекомендуется ${n(aRec)} мм${dgu ? '; вдоль ДГУ — не менее 600 мм' : ''}.`,
      wall.length ? `${wall.length>1 ? 'Шкафы' : 'Шкаф'} ${list(wall)} — на стене, низ на высоте ${n(z0)} мм; проход перед ${wall.length>1 ? 'ними' : 'ним'} — не менее ${n(aMin)} мм.` : '',
      chain.length ? `Сжатый воздух — последовательно: поз. ${chain.join(' → ')} → к потребителю${hang.length ? `; фильтры ${list(hang)} — на трубопроводе` : ''}.` : hang.length ? `Фильтры ${list(hang)} — на трубопроводе.` : '',
      this.en && !this.en.sea ? `Дверь оператора — одностворчатая ${n(this.en.w)} мм (не менее ${n(StationLayout.DOOR_MIN)} мм в свету)${this.en.wall==='left' ? ' в торце' : ''}, открывается наружу, с доводчиком; рядом — знаки и огнетушители.` : '',
      p.second ? `Вторая дверь оператора — ${p.exit ? `одностворчатая ${n(p.exit.w)} мм в дальнем торце` : this.gt && this.gt.wicket ? `калитка ${n(this.gt.wicket.w)} × ${n(this.gt.wicket.h)} мм в створке ворот` : p.secondDgu ? 'выход через дверь-жалюзи ДГУ' : 'одностворчатая в стене прохода у дальнего торца'} (${p.second}); открывается наружу, с доводчиком.` : '',
      this.gt && this.gt.pos.length ? (this.gt.sea ? `Монтаж и демонтаж ${list(this.gt.pos)} — через штатные двери контейнера в торце.`
        : `Распашные ворота ${n(this.gt.w)} × ${n(this.gt.h)} мм в ${this.gt.wall==='left' ? 'торце у входа' : 'дальнем торце'} — для монтажа и демонтажа ${list(this.gt.pos)}; утеплённые, с запорными штангами.`) : '',
      ...[[true, 'в стене за оборудованием (стоит плотно к стене) — для обслуживания, монтажа и демонтажа'], [false, 'в боковой стене — для монтажа и демонтажа (к торцу не провезти)']].map(([rear, t])=>{
        const D=(p.doors||[]).filter(d=>d.kind!=='entry' && !!d.rear===rear); if (!D.length) return '';
        return `Сервисные распашные ${D.some(d=>d.leaves>1) ? 'ворота' : 'двери'} ${t}: ${D.map(d=>`${n(d.w)} × ${n(d.h)} мм — поз. ${d.pos.join(', ')}`).join('; ')}; утеплённые, с запорными штангами.`; }),
      this.dg ? `ДГУ поз. ${this.dg.pos}: в торце — двустворчатая дверь-жалюзи ${n(this.dg.w)} × ${n(this.dg.h)} мм (выброс воздуха радиатора, монтаж и демонтаж ДГУ).` : '',
      this.up ? `Глушитель ${list([...new Set(this.rf.map(m=>m.pos))])} — на крыше над ДГУ, выхлоп — горизонтально в сторону; съёмный (при перевозке снимается).` : '',
      this.ext.length ? `${this.ext.length>1 ? 'Ресиверы' : 'Ресивер'} ${list([...new Set(this.ext.map(i=>i.pos))])} — снаружи на бетонной площадке (ФНП ОРПД, п. 65); подключение через стену — с запорной арматурой${p.air && !p.air.units.some(u=>u.kind==='dryer' && u.air && u.air.type==='ads') ? ', отвод конденсата — с обогревом' : ''}.` : '',
      this.fuel ? `Бак ${list(P(i=>i.tank))} — в отсеке за противопожарной перегородкой (EI 45), вход — своя дверь снаружи, горловина — снаружи в запираемом ящике, бак — в поддоне.` : '',
      ...StationDrawing.heat(p),
      ...StationDrawing.vessels(p),
      ...StationNorms.tt(p),
      ...StationDrawing.lift(p),
      sys.length ? `Не показаны: ${StationDrawing.cut(sys.join(', '), 150)}.` : '',
    ].filter(Boolean);
  }
  static cut(s, n){ s=String(s||''); return s.length>n ? s.slice(0, n-1).replace(/\s+\S*$/, '')+'…' : s; }
  /** пункты ТТ о строповке и знаках: схема — лист 3; знаки по ГОСТ 14192-96 */
  static lift(p){
    const M=p.mass; if (!M) return [];
    const n=StationLayout.n, S=M.sling, L=S.legs.map(q=>q.len), a=Math.min(...L), b=Math.max(...L);
    const at=p.geo.sea ? 'верхние угловые фитинги' : 'петли в верхних углах', L4=a===b ? n(a) : n(a)+'–'+n(b), F=S.frame, go=' Перевозить с закреплённым оборудованием, без топлива и воды.';
    return [F ? `Строповка — по схеме (лист 3): рамной траверсой (спредером) за четыре ${at} — ветви вертикальны, ${n(a)} мм; рама — на двухветвевом стропе ${n(F.len)} мм от проушин над центром тяжести (угол с вертикалью ${F.deg}°). Наклонными стропами за верхние фитинги контейнер с оборудованием не поднимать (ISO 3874).${go}`
      : S.beam ? `Строповка — по схеме (лист 3): длина больше 6,5 м — с траверсой: четыре ветви ${L4} мм за ${at} к траверсе над контейнером, траверса подвешена над центром тяжести.${go}`
      : `Строповка — по схеме (лист 3): четырёхветвевым стропом за ${at}, крюк — над центром тяжести, ветви ${L4} мм, угол ветви с вертикалью — не более ${StationMass.ANGLE}°.${go}`,
      `Знаки по ГОСТ 14192-96: №\u00a09 «Место строповки» — у каждой точки строповки с двух сторон, №\u00a012 «Центр тяжести» — на боковой и торцовой стенах в проекции центра тяжести; надпись «Масса брутто ${n(M.mass)} кг».`];
  }
  /** пункт ТТ об отоплении: конвекторы по расчёту (на плане — у стен) */
  static heat(p){
    const h=p.heat, V=p.vent, out=[];
    if (h && h.on && h.n) out.push(`Электроконвекторы ${h.n} × ${StationHeat.kw(h.kw)} кВт с терморегуляторами — у стен (на плане): не ниже +${h.tin} °C при ${StationNorms.deg(h.tout)} снаружи.`);
    if (V){ const n=StationLayout.n, f=v=>String(v).replace('.', ','), t=[];
      const wh=StationVent.where(V), rf=StationVent.roofList(V), ow=V.louvers.some(q=>q.kind==='out') ? StationVent.list(V, 'out') : '';
      if (V.size.in) t.push(`приточные ${StationVent.list(V, 'in')} внизу${wh.in ? ' '+wh.in : ''} (${n(V.q.in)} м³/ч, живое сечение не менее ${f(V.need.in.free)} м²)`);
      if (V.need.out) t.push(`выброс горячего воздуха ${[ow ? `— жалюзи ${ow} вверху` : '', rf ? `через крышу — колпаки ${rf}` : ''].filter(Boolean).join(', ')} (${n(V.q.out)} м³/ч, не менее ${f(V.need.out.free)} м²); приток и выброс — на разных стенах`);
      if (Object.keys(V.ducts||{}).length) t.push(`компрессоры — воздуховодами с клапанами рециркуляции (зимой тёплый воздух — в помещение)`);
      if (V.rad) t.push(`радиатора ДГУ — ${V.rad.door ? 'дверь-жалюзи' : 'жалюзи'} ${n(V.rad.w)} × ${n(V.rad.h)} мм`);
      if (t.length) out.push(`Жалюзи (размер по рамке) с утеплёнными клапанами и электроприводами: ${t.join('; ')}.`); }
    return out;
  }
  /** пункт ТТ об учёте сосудов под давлением в Ростехнадзоре (ФНП ОРПД): p·V больше 1,0 МПа·м³ — подлежит */
  static vessels(p){
    const V=(p.vessels||[]).filter(v=>v.pv!=null), reg=V.filter(v=>v.reg), free=V.filter(v=>!v.reg), pos=L=>'поз. '+[...new Set(L.map(v=>v.pos))].join(', ');
    const many=L=>L.reduce((s, v)=>s+(v.qty||1), 0)>1;
    return [reg.length ? `${many(reg) ? 'Ресиверы' : 'Ресивер'} ${pos(reg)} подлеж${many(reg) ? 'а' : 'и'}т учёту в Ростехнадзоре (ФНП ОРПД: p·V более 1,0 МПа·м³).` : '',
      free.length ? `${many(free) ? 'Ресиверы' : 'Ресивер'} ${pos(free)} учёту в Ростехнадзоре не подлеж${many(free) ? 'а' : 'и'}т (p·V не более 1,0 МПа·м³).` : ''].filter(Boolean);
  }

  // ---- компоновка листов: на каждом — наибольший масштаб (ГОСТ 2.302), при котором его изображения с размерами помещаются
  static TB2 = 277;              // верх основной надписи формы 2а (последующие листы), мм листа
  /** разрез А–А с размерами справа: {w, h, left} при масштабе k (мм листа на мм) */
  mainBox(k){
    const nOut=this.outs.length, nDim=nOut+1+(this.up || this.hood ? 1 : 0)+(this.rise ? 1 : 0)+(this.dz ? 1 : 0), dimsR=16+7*(nDim-1)+2, left=14;
    return { w:left+(this.Le+this.outL)*k+dimsR, h:this.head()+(this.He+this.hTop+this.dz)*k+3, left, dimsR };
  }
  /** разрез Б–Б (план) с размерами и номерами позиций (col — колонкой справа, иначе строкой под планом) */
  planBox(k, col){
    const nY=this.ext.length ? 0 : new Set(this.outs.map(o=>o.y)).size, left=19+(this.fit ? 7 : 0), outR=Math.max((nY ? 16+7*(nY-1)+2 : 8)+(col ? 17 : 0), this.swingR*k+12);
    const top=this.chainTop(k), h=6+top+this.swingB*k+this.We*k+this.swing*k+(col ? 0 : 11)+10+(this.fit ? 7 : 0);
    return { w:left+(this.Le+this.outL)*k+outR, h, left, top };
  }
  /** виды с торцов В и Г рядом: размеры слева (высоты) и снизу (ширина) */
  endsBox(k){
    const one=this.We*k, hv=(this.He+this.hTop+this.dz)*k, wl=13+(this.rise ? 7 : 0), wr=this.dg ? 13 : 3;
    return { w:wl+one+16+wl+one+wr, h:9+hv+(this.dg ? 23 : 16), one, hv, wl };
  }
  /** схема строповки: вид сбоку и с торца рядом (или друг под другом), подписи и знаки */
  slingBox(k, stack){
    const S=this.ms.sling, hv=(this.He+Math.max(this.hTop, S.hook)+this.dz)*k+8+23, ws=this.Le*k+23, we=this.We*k+8;
    return stack ? { w:Math.max(ws, we), h:2*hv+6, ws, we, hv } : { w:ws+we+10, h:hv, ws, we, hv };
  }
  /** высота заголовка разреза А–А: обозначение и надпись «Шкаф поз. … не показан» */
  head(){ return 8+(this.hidden.length ? 4 : 0); }

  /** листы чертежа (SVG): 1 — разрез А–А и текстовая часть (на чертеже из нескольких листов — только на первом, ГОСТ Р 2.316),
   *  2 — разрез Б–Б и виды с торцов, 3 — схема строповки с центром тяжести (если масса посчитана) */
  sheets(){
    const n=this.ms ? 3 : 2, out=[this.sheet1(n), this.sheet2(n)];
    if (this.ms) out.push(this.sheet3(n));
    return out;
  }
  /** основная надпись: первый лист — форма 1 (масштаб — главного изображения), следующие — форма 2а */
  tb(sheet, sheets, N){
    const T=this.p, code=EskdSheet.code(this.m.org, T.hash, 'ГЧ');
    return sheet===1 ? { name:this.m.title||'Станция в контейнере', doc:'Габаритный чертёж', code, lit:'П', scale:EskdSheet.scale(N), sheet:1, sheets, org:this.m.org, dev:this.m.dev, date:this.m.date }
      : { code, sheet, sheets, next:true };
  }
  /** наибольший масштаб из ряда, при котором ok(k) */
  static scaleFor(ok){
    for (const N of EskdSheet.SCALES.filter(v=>v>=10)){ const r=ok(1/N); if (r) return Object.assign({ N, k:1/N }, r); }
    const N=EskdSheet.SCALES[EskdSheet.SCALES.length-1]; return Object.assign({ N, k:1/N }, ok(1/N, true) || {});
  }
  /** подпись изображения с масштабом, если он не тот, что в основной надписи (ГОСТ Р 2.316, п. 4.19) */
  label(t, N){ return N===this.N1 ? t : `${t} (${EskdSheet.scale(N)})`; }

  /** лист 1: разрез А–А крупно, над основной надписью — перечень составных частей, техническая характеристика, ТТ */
  sheet1(total){
    const sh=new EskdSheet('A4'), C=StationDrawing;
    const tt=this.reqs(), tc=this.tech(), rows=this.rows(), hTT=sh.paras(0, 0, 175, tt, 2.5, false);
    const twoCol=tc.every(t=>EskdSheet.tw(t, 2.5)<=86), nTC=twoCol ? Math.ceil(tc.length/2) : tc.length, hTC=tc.length ? 5+nTC*3.8+0.8 : 0;
    const half=Math.ceil(rows.length/2), hTab=rows.length ? 5+half*4 : 0;
    const yTT=C.TB-2.5-hTT, yTTh=yTT-(tc.length ? 4.6 : 0), yTC=yTTh-hTC, yTab=yTC-(hTab ? hTab+3 : 0);
    const room=yTab-3-C.TOP, pick=C.scaleFor((k, last)=>{ const b=this.mainBox(k); return b.w<=C.L1-C.L0 && b.h<=room || last ? { b } : null; });
    const { k, b }=pick; this.N1=pick.N;
    this.k=k; this.xL=C.L0+b.left+Math.max(0, (C.L1-C.L0-b.w)/2); this.xR=this.xL+this.Le*k; this.xE=this.xR+this.outL*k;
    const yA=C.TOP; this.Yg=yA+this.head()+(this.He+this.hTop+this.dz)*k;
    this.main(sh, yA, b);
    if (rows.length){ const H=rows.slice(0, half), R=rows.slice(half), cols=[8, 56.5, 8, 20], head=['Поз.', 'Наименование', 'Кол.', 'Масса, кг'];
      const cell=r=>r ? [[String(r.pos), 'c'], r.name, [String(r.n), 'c'], [r.mass>0 ? StationLayout.n(r.mass) : '—', 'c']] : ['', '', '', ''];
      sh.table(20, yTab, cols, head, H.map(cell), 4, 5, 2.5);
      if (R.length) sh.table(112.5, yTab, cols, head, H.map((x, i)=>cell(R[i])), 4, 5, 2.5); }
    if (tc.length){ sh.text(112.5, yTC+3.9, 'Техническая характеристика', 3.5, { a:'middle' });
      tc.forEach((t, i)=>{ const r=twoCol ? Math.floor(i/2) : i, c=twoCol ? i%2 : 0; sh.text(25+c*90, yTC+5+(r+1)*3.8-0.6, `${i+1}. ${t}`, 2.5); });
      sh.text(112.5, yTTh+3.9, 'Технические требования', 3.5, { a:'middle' }); }
    sh.paras(25, yTT, 175, tt, 2.5);
    sh.frame(this.tb(1, total, pick.N));
    return sh.svg();
  }
  /** лист 2: разрез Б–Б (план) с дверями, размерами и номерами позиций; под ним — виды с торцов В (у входа) и Г (дальний) */
  sheet2(total){
    const sh=new EskdSheet('A4'), C=StationDrawing, room=C.TB2-3-C.TOP, W=C.L1-C.L0, minE=this.endsBox(1/100).h;
    // план — наибольший масштаб, при котором под ним остаётся место видам с торцов; виды с торцов — свой масштаб (крупнее)
    const pick=C.scaleFor((k, last)=>{ for (const col of [false, true]){ const P=this.planBox(k, col);
        if (col && this.nPos*7>P.top+this.swingB*k+this.We*k+this.swing*k+4) continue;
        if ((P.w<=W && P.h+8+minE<=room) || last) return { P, col }; }
      return null; });
    const { k, P, col }=pick;
    this.k=k; this.xL=C.L0+P.left+Math.max(0, (W-P.w)/2); this.xR=this.xL+this.Le*k; this.xE=this.xR+this.outL*k;
    const yB=C.TOP; this.yPT=yB+6+P.top+this.swingB*k;
    this.plan(sh, yB, col, pick.N);
    // виды с торцов: под планом, по центру листа, в наибольшем масштабе, который помещается (не крупнее 1:20)
    const yE=yB+P.h+8, pe=C.scaleFor((ke, last)=>{ const E=this.endsBox(ke); return (1/ke>=20 && E.w<=W && yE+E.h<=C.TB2-3) || last ? { E } : null; }), E=pe.E;
    this.k=pe.k; const x0=(C.L0+C.L1)/2-E.w/2+E.wl; this.Yg=yE+9+E.hv;
    sh.text(x0+E.one/2, yE+5, this.label('В', pe.N), 5, { a:'middle' }); this.end(sh, x0); this.endDims(sh, x0, true);
    const x1=x0+E.one+16+E.wl; sh.text(x1+E.one/2, yE+5, this.label('Г', pe.N), 5, { a:'middle' }); this.endR(sh, x1); this.endDims(sh, x1, false);
    sh.frame(this.tb(2, total));
    return sh.svg();
  }
  /** лист 3: схема строповки — вид сбоку и с торца: точки строповки, ветви стропа, крюк над центром тяжести, знаки № 9 и
   *  № 12 по ГОСТ 14192-96, координаты центра тяжести и масса */
  sheet3(total){
    const sh=new EskdSheet('A4'), C=StationDrawing, W=C.L1-C.L0, mid=(C.L0+C.L1)/2, room=C.TB2-3-C.TOP-8-this.legendH(sh);
    const pick=C.scaleFor((k, last)=>{ for (const stack of [false, true]){ const B=this.slingBox(k, stack); if ((B.w<=W && B.h<=room) || (last && stack)) return { B, stack }; } return null; });
    const { k, B, stack }=pick, y0=C.TOP+8;
    // друг под другом — вид с торца в своём масштабе, крупнее, если помещается (не крупнее 1:20)
    const pe=stack ? C.scaleFor((ke, last)=>{ const E=this.slingBox(ke, true); return (1/ke>=20 && ke>=k && E.we<=W && B.hv+6+E.hv<=room) || last ? { E } : null; }) : null;
    const E=pe && pe.k>k ? pe.E : B, Ne=pe && pe.k>k ? pe.N : pick.N, two=Ne!==pick.N;
    sh.text(mid, C.TOP+2, two ? 'Схема строповки' : this.label('Схема строповки', pick.N), 5, { a:'middle' });
    const xs=stack ? mid-B.ws/2+19 : mid-B.w/2+19, side='вид со стороны входа', end='вид с торца у входа';
    this.k=k; this.slingSide(sh, xs, y0, B.hv, two ? `${side} (${EskdSheet.scale(pick.N)})` : side);
    const xe=stack ? mid-E.we/2+4 : xs-19+B.ws+10+4, ye=stack ? y0+B.hv+6 : y0;
    this.k=1/Ne; this.slingEnd(sh, xe, ye, E.hv, two ? `${end} (${EskdSheet.scale(Ne)})` : end);
    this.signsLegend(sh, C.L0+4, (stack ? ye+E.hv : y0+B.hv)+6);
    sh.frame(this.tb(3, total));
    return sh.svg();
  }

  // ---- схема строповки (лист 3)
  /** знак № 12 «Центр тяжести» (ГОСТ 14192-96): толстый крест за пределы круга, круг — четыре дуги с просветами у креста;
   *  B — размер, мм */
  static signCog(sh, cx, cy, B){
    const f=EskdSheet.f, a=B*0.1, R=B*0.31, r=R-B*0.09, g=Math.asin(Math.min(0.9, (a/2+B*0.05)/r)), P=(rr, t)=>`${f(cx+rr*Math.cos(t))},${f(cy+rr*Math.sin(t))}`;
    sh.rect(cx-B/2, cy-a/2, B, a, 'thin', '#000'); sh.rect(cx-a/2, cy-B/2, a, B, 'thin', '#000');
    for (let k=0; k<4; k++){ const t0=k*Math.PI/2+g, t1=(k+1)*Math.PI/2-g;
      sh.path(`M${P(R, t0)} A${f(R)},${f(R)} 0 0 1 ${P(R, t1)} L${P(r, t1)} A${f(r)},${f(r)} 0 0 0 ${P(r, t0)} Z`, 'thin', '#000'); }
  }
  /** знак № 9 «Место строповки» (ГОСТ 14192-96): цепь — разомкнутое звено сверху, два звена и звенья ребром (стержень);
   *  H — высота, мм */
  static signSling(sh, cx, cy, H){
    const f=EskdSheet.f, lw=H*0.42, y0=cy-H/2, uh=H*0.22, oh=H*0.3, t=Math.max(0.3, H*0.07);
    sh.path(`M${f(cx-lw/2)},${f(y0)} V${f(y0+uh-lw/2)} A${f(lw/2)},${f(lw/2)} 0 0 0 ${f(cx+lw/2)},${f(y0+uh-lw/2)} V${f(y0)}`, 'main');
    for (const y of [y0+H*0.26, y0+H*0.62]) sh.rect(cx-lw/2, y, lw, oh, 'main', 'none', lw/2);
    sh.rect(cx-t/2, y0+H*0.08, t, H*0.9, 'thin', '#000');
  }
  /** крюк над центром тяжести: кольцо стропа и крюк */
  static hook(sh, x, y){ sh.circle(x, y, 1.1, 'main'); sh.path(`M${EskdSheet.f(x)},${EskdSheet.f(y-1.1)} V${EskdSheet.f(y-5)}`, 'main'); sh.circle(x, y-6.2, 1.2, 'main'); }
  /** схема строповки — вид со стороны лицевой стены: контур, точки строповки в верхних углах, ветви к крюку над центром
   *  тяжести, знаки № 9 у точек строповки и № 12 в проекции центра тяжести; размеры: длина, X и Z центра тяжести, высота крюка */
  slingSide(sh, x0, y0, hv, cap){
    const k=this.k, M=this.ms, S=M.sling, n=StationLayout.n, { Le, He }=this, yg=y0+hv-23, X=x=>x0+x*k, Z=z=>yg-(this.dz+z)*k, cg=M.cg;
    sh.text(X(Le/2), yg+21.5, cap, 2.5, { a:'middle' });
    if (this.dz) sh.rect(X(40), Z(0), (Le-80)*k, 200*k, 'thin', '#fff');
    sh.rect(X(0), Z(He), Le*k, He*k, 'main', '#fff'); if (this.rise) sh.rect(X(0), Z(He+this.rise), Le*k, this.rise*k, 'main', '#fff');
    for (const m of this.rf) sh.rect(X(this.ox+m.x), Z(He+m.gap+m.d), m.lx*k, m.d*k, 'thin', '#fff');
    sh.line(X(0)-4, yg, X(Le)+4, yg, 'thin');
    const top=He+this.rise, hz=He+S.hook, hx=X(cg.x), B=S.beam, F=S.frame, ring=x=>sh.circle(X(x), Z(He), 0.9, 'main', '#fff');
    let zt=Z(hz);   // откуда ось к центру тяжести
    if (F){   // рамная траверса: ветви к фитингам вертикальны, рама — на двухветвевом стропе от проушин над центром тяжести
      const zf=Z(He+F.z); sh.rect(X(F.x0)-1, zf-1.2, (F.x1-F.x0)*k+2, 1.2, 'main', '#000');
      for (const x of [F.x0, F.x1]){ sh.line(X(x), Z(He), X(x), zf, 'main'); ring(x); }
      for (const x of F.lugs) sh.line(X(x), zf-1.2, hx, Z(hz)+1.1, 'main');
      const lx=X(Math.min(...F.lugs));
      sh.text(X(F.x0)+2, (Z(He)+zf)/2+1, `ветви ${n(S.legs[0].len)} — вертикально`, 2.5); sh.text(X(F.x0)+2, zf-2.4, 'рамная траверса', 2.5);
      sh.text((lx+hx)/2-2, (zf+Z(hz))/2, `${n(F.len)} (${F.deg}°)`, 2.5, { a:'end' }); zt=zf;
    } else if (B){   // траверса: ветви от точек строповки к ней (на виде сбоку — вертикально), траверса подвешена над центром тяжести
      const zb=Z(He+B.z); sh.rect(X(B.x0)-1, zb-1.2, (B.x1-B.x0)*k+2, 1.2, 'main', '#000'); sh.line(hx, zb-1.2, hx, Z(hz)+1.1, 'main');
      for (const q of S.legs.filter(q=>q.y<this.We/2)){ sh.line(X(q.x), Z(He), X(q.x), zb, 'main'); ring(q.x); }
      sh.text(X(B.x0)+2, (Z(He)+zb)/2, `ветви ${n(Math.max(...S.legs.map(q=>q.len)))} (${Math.max(...S.legs.map(q=>q.deg))}°)`, 2.5); sh.text((X(B.x0)+hx)/2, zb-2.4, 'траверса', 2.5, { a:'middle' });
      zt=zb;
    } else for (const q of S.legs.filter(q=>q.y<this.We/2)){ sh.line(X(q.x), Z(He), hx, Z(hz), 'main'); ring(q.x);
      const t=0.35, x=X(q.x)+(hx-X(q.x))*t, y=Z(He)+(Z(hz)-Z(He))*t;
      sh.text(x+(q.x<cg.x ? -2 : 2), y, `${n(q.len)} (${q.deg}°)`, 2.5, { a:q.x<cg.x ? 'end' : 'start' }); }
    StationDrawing.hook(sh, hx, Z(hz)); sh.line(hx, zt, hx, Z(cg.z)-4, 'axis');
    StationDrawing.signCog(sh, hx, Z(cg.z), 8); sh.text(hx+5, Z(cg.z)-2.5, 'ЦТ', 3.5);
    for (const x of [X(450), X(Le-450)]) StationDrawing.signSling(sh, x, Z(He-450), 7);
    // размеры (ГОСТ 2.307): меньший — ближе к изображению
    sh.dimH(X(0), hx, yg+8, n(cg.x), Z(0), Z(cg.z), { out:'r' }); sh.dimH(X(0), X(Le), yg+15, n(Le), Z(0), Z(0));
    sh.dimV(Z(cg.z), Z(0), X(0)-7, n(cg.z), hx, X(0), { out:true }); sh.dimV(Z(hz), Z(top), X(0)-14, n(S.hook-this.rise), hx, X(0), { out:true });
  }
  /** схема строповки — вид с торца у входа (лицевая стена справа): ветви к крюку (траверсе), знак № 12; размеры: Y центра
   *  тяжести от лицевой стены и ширина */
  slingEnd(sh, x0, y0, hv, cap){
    const k=this.k, M=this.ms, S=M.sling, n=StationLayout.n, { We, He }=this, yg=y0+hv-23, XL=y=>x0+(We-y)*k, Z=z=>yg-(this.dz+z)*k, cg=M.cg;
    sh.text(XL(We/2), yg+21.5, cap, 2.5, { a:'middle' });
    sh.rect(XL(We), Z(He), We*k, He*k, 'main', '#fff');
    const rz=this.rise, roof=this.g.roof;
    if (rz && roof==='gable') sh.poly([[XL(We), Z(He)], [XL(We/2), Z(He+rz)], [XL(0), Z(He)]], 'main', '#fff');
    else if (rz && roof==='arch'){ const rc=(We*We/4+rz*rz)/(2*rz), P=[]; for (let j=0; j<=16; j++){ const y=We*j/16; P.push([XL(y), Z(He+rz-rc+Math.sqrt(Math.max(0, rc*rc-(y-We/2)*(y-We/2))))]); } sh.poly(P, 'main', '#fff'); }
    else if (rz) sh.poly([[XL(We), Z(He)], [XL(0), Z(He+rz)], [XL(0), Z(He)]], 'main', '#fff');
    sh.line(XL(We)-4, yg, XL(0)+4, yg, 'thin');
    const hz=He+S.hook, hx=XL(cg.y), F=S.frame, ring=y=>sh.circle(XL(y), Z(He), 0.9, 'main', '#fff');
    let zt;
    if (F){ const zf=Z(He+F.z); sh.rect(XL(F.y1)-1, zf-1.2, (F.y1-F.y0)*k+2, 1.2, 'main', '#000');
      for (const y of [F.y0, F.y1]){ sh.line(XL(y), Z(He), XL(y), zf, 'main'); ring(y); }
      sh.line(hx, zf-1.2, hx, Z(hz)+1.1, 'main'); zt=zf; }
    else { const zj=S.beam ? He+S.beam.z : hz;   // с траверсой ветви сходятся к ней
      for (const y of [StationMass.LUG[1], We-StationMass.LUG[1]]){ sh.line(XL(y), Z(He), hx, Z(zj), 'main'); ring(y); }
      if (S.beam){ sh.circle(hx, Z(zj), 1.3, 'main', '#000'); sh.line(hx, Z(zj), hx, Z(hz)+1.1, 'main'); }
      zt=Z(zj)+1.3; }
    StationDrawing.hook(sh, hx, Z(hz)); sh.line(hx, zt, hx, Z(cg.z)-4, 'axis');
    StationDrawing.signCog(sh, hx, Z(cg.z), 8);
    sh.dimH(hx, XL(0), yg+8, n(cg.y), Z(cg.z), Z(0), { out:'r' }); sh.dimH(XL(We), XL(0), yg+15, n(We), Z(0), Z(0));
  }
  /** подписи под схемой: знаки (что о них сказано в ГОСТ 14192-96), масса и центр тяжести */
  legendItems(){ const M=this.ms, n=StationLayout.n, c=M.cg;
    return ['№ 9 «Место строповки» — у каждой точки строповки, с двух сторон (ГОСТ 14192-96, п. 5.5.1).',
      '№ 12 «Центр тяжести» — на боковой и торцовой стенах в проекции центра тяжести (ГОСТ 14192-96, п. 5.5.2).',
      `Масса станции — около ${n(M.mass)} кг; центр тяжести (ЦТ): X = ${n(c.x)}, Y = ${n(c.y)}, Z = ${n(c.z)} мм — от торца у входа, от лицевой стены, от низа${M.missing.length ? `; без поз. ${M.missing.join(', ')} (масса не указана) — уточняется` : ''}.`]; }
  /** высота подписей под схемой, мм: строка знака — не ниже самого знака */
  legendH(sh){ return this.legendItems().reduce((h, t, i)=>h+Math.max(i<2 ? 10 : 0, sh.paras(0, 0, 160, [t], 2.5, false)+1.5), 0); }
  /** под схемой: знаки № 9 и № 12 с пояснениями, масса и центр тяжести */
  signsLegend(sh, x, y){
    let yy=y;
    this.legendItems().forEach((t, i)=>{
      if (i===0) StationDrawing.signSling(sh, x+4, yy+5, 8); else if (i===1) StationDrawing.signCog(sh, x+4, yy+5, 8);
      yy+=Math.max(i<2 ? 10 : 0, sh.paras(x+11, yy, 160, [t], 2.5)+1.5); });
  }

  // ---- разрез А–А: вдоль контейнера у стены прохода, взгляд на заднюю стену
  X(x){ return this.xL+x*this.k; }
  Z(z){ return this.Yg-(this.dz+z)*this.k; }
  main(sh, yA){
    const k=this.k, X=v=>this.X(v), Z=v=>this.Z(v), { ox, zf, Le, He, Hi, Li }=this, xL=this.xL, xR=this.xR, n=StationLayout.n;
    sh.text((xL+xR)/2, yA+5, 'А–А', 5, { a:'middle' });
    if (this.hidden.length){ const H=[...new Set(this.hidden.map(i=>i.pos))];   // снятое для наглядности — надписью над изображением (ГОСТ Р 2.109)
      sh.text((xL+xR)/2, yA+9.4, `${H.length>1 ? 'Шкафы' : 'Шкаф'} поз. ${H.join(', ')} не ${H.length>1 ? 'показаны' : 'показан'}`, 2.5, { a:'middle' }); }
    if (this.dz) this.chassisSide(sh);
    // стенки, пол и кровля в сечении; внутри — оборудование
    const roof=He-zf-Hi;
    sh.section(xL, Z(He), ox*k, He*k); sh.section(X(Le-ox), Z(He), ox*k, He*k);
    sh.section(X(ox), Z(zf), Li*k, zf*k); sh.section(X(ox), Z(He), Li*k, roof*k);
    sh.rect(xL, Z(He), Le*k, He*k, 'main');
    if (this.rise) sh.rect(xL, Z(He+this.rise), Le*k, this.rise*k, 'main');   // скатная крыша: конёк (верх ската) — за секущей плоскостью
    if (!this.g.sea){ const lw=Math.max(0.8, 160*k), lh=Math.max(0.6, 120*k);   // строповочные петли в верхних углах
      for (const x of [xL+30*k, xL+(Le-190)*k]){ sh.rect(x, Z(He)-lh, lw, lh, 'main', '#fff'); sh.circle(x+lw/2, Z(He)-lh*0.45, Math.max(0.2, lh*0.25), 'thin', '#fff'); } }
    const fu=this.fuel, tamb=this.g.x0-(fu ? fu.x1+fu.part : 0);
    if (tamb>0) sh.line(X(ox+this.g.x0), Z(zf), X(ox+this.g.x0), Z(zf+Hi), 'main');
    if (fu){ sh.section(X(ox+fu.x1), Z(zf+Hi), fu.part*k, Hi*k);   // противопожарная перегородка отсека бака
      if (fu.fill.wall==='left'){ const t=this.p.items.find(i=>i.tank), zb=Z(zf+fu.fill.z), b=Math.max(1.2, 220*k);
        sh.rect(xL-b, zb-b/2, b, b, 'main', '#fff');   // ящик заливной горловины снаружи
        if (t) sh.path(`M${EskdSheet.f(xL)},${EskdSheet.f(zb)} H${EskdSheet.f(X(ox+t.x+Math.min(150, t.lx/3)))} V${EskdSheet.f(Z(zf+t.h))}`, 'main'); } }
    for (const h of this.heaters.filter(q=>q.wall==='back')) sh.rect(X(ox+h.x), Z(zf+h.z+h.h), h.lx*k, h.h*k, 'thin', '#fff');
    for (const v of this.vents('back')) this.louverEnd(sh, X(ox+v.u0), X(ox+v.u1), Z(zf+v.z1), Z(zf+v.z0));   // жалюзи на задней стене
    for (const d of this.sdB){ const xa=X(ox+d.x0), xb=X(ox+d.x1), za=Z(zf+d.h), zb=Z(zf);   // сервисные ворота в задней стене: проём, створки
      sh.rect(xa, za, xb-xa, zb-za, 'main', '#fff'); for (let i=1; i<d.leaves; i++) sh.line(xa+(xb-xa)*i/d.leaves, za, xa+(xb-xa)*i/d.leaves, zb, 'thin'); }
    for (const v of this.vents('back', true)) this.louverEnd(sh, X(ox+v.u0), X(ox+v.u1), Z(zf+v.z1), Z(zf+v.z0));   // приток в створках ворот
    for (const R of this.hoods()){ const hz=Math.max(1, StationVent.HOOD*k); sh.rect(X(ox+R.x0), Z(He)-hz, (R.x1-R.x0)*k, hz, 'main', '#fff'); sh.line(X(ox+R.x0)-0.6, Z(He)-hz, X(ox+R.x1)+0.6, Z(He)-hz, 'main'); }   // колпаки выброса на крыше
    const fz=i=>Z(zf+i.z), py=this.lines.length ? Math.max(...this.lines.map(l=>l.y)) : -Infinity;
    const shown=this.p.items.filter(i=>!this.hidden.includes(i)).sort((a, c)=>c.y-a.y);
    const one=it=>{ const x1=X(ox+it.x), x2=X(ox+it.x+it.lx);
      if (it.mount==='frame') for (const xx of [x1+(x2-x1)*0.12, x2-(x2-x1)*0.12]) sh.line(xx, fz(it), xx, Z(zf), 'main');   // рама до пола
      EquipIcon.front(sh, it, x1, Z(zf+it.z+it.h), x2, fz(it)); };
    for (const it of shown.filter(i=>i.y>py)) one(it);
    this.pipesMain(sh);
    for (const it of shown.filter(i=>i.y<=py)) one(it);
    // глушитель на крыше: опоры, корпус, вывод выхлопа с колпаком; выхлопная труба от ДГУ сквозь крышу
    for (const m of this.rf){ const x1=X(ox+m.x), x2=X(ox+m.x+m.lx), zb=Z(He+m.gap), zt=Z(He+m.gap+m.d), w=Math.max(0.8, 120*k), zm=(zb+zt)/2, xo=X(ox+m.x+m.lx+m.outlet);
      if (m.exhaust){ const xe=X(ox+m.exhaust.x), pw=Math.max(0.8, 130*k); sh.rect(xe-pw/2, zb, pw, Z(zf+m.exhaust.z)-zb, 'thin', '#fff'); }
      for (const f of [0.18, 0.82]) sh.line(x1+(x2-x1)*f, Z(He), x1+(x2-x1)*f, zb, 'main');
      sh.rect(x2, zm-w/2, xo-x2, w, 'thin', '#fff'); sh.line(xo, zm-w*0.9, xo, zm+w*0.9, 'main');   // вывод выхлопа — горизонтально в сторону
      EquipIcon.muffler(sh, x1, zt, x2, zb); }
    // выход трубопровода через дальний торец (ресиверы снаружи — к ним); линия сечения Б–Б — под потолком, взгляд вниз
    const xE=this.xE, ro=this.ext.length ? this.outMain(sh) : null;
    if (!ro) for (const o of this.outs){ sh.line(xR, Z(zf+o.z), xR+5, Z(zf+o.z), 'pipe'); sh.arrow(xR+7.6, Z(zf+o.z), 1, 0); }
    const zc=Z(zf+Hi-Math.min(120, Hi*0.05));
    this.cutMark(sh, xL-1.5, zc, -1, 'Б'); this.cutMark(sh, xE+1.5, zc, 1, 'Б');
    // размеры справа: присоединительные (высота выхода; с ресивером снаружи — его выхода), габаритная высота, с глушителем,
    // на шасси
    let xd=xE+16;   // правее штриха и буквы линии сечения Б–Б
    if (ro){ sh.dimV(ro.y, Z(-this.dz), xd, n(ro.z+this.dz), ro.x, xE); xd+=7; }
    else for (const o of this.outs){ sh.dimV(Z(zf+o.z), Z(0), xd, n(zf+o.z), xR+7.6, xR); xd+=7; }
    sh.dimV(Z(He), Z(0), xd, n(He), xR, xR); xd+=7;
    if (this.rise){ sh.dimV(Z(He+this.rise), Z(0), xd, n(He+this.rise), xR, xR); xd+=7; }
    if (this.up){ const m=this.rf[0]; sh.dimV(Z(He+this.up), Z(0), xd, n(He+this.up), X(ox+m.x+m.lx*0.86), xR); xd+=7; }
    else if (this.hoods().length){ const R=this.hoods()[this.hoods().length-1]; sh.dimV(Z(He+StationVent.HOOD), Z(0), xd, n(He+StationVent.HOOD), X(ox+R.x1), xR); xd+=7; }   // с колпаком выброса
    if (this.dz){ const u=Math.max(this.up, this.hood); sh.dimV(Z(He+u), this.Yg, xd, n(He+u+this.dz), null, xR); }
  }
  /** ресиверы снаружи на разрезе А–А: площадка, ресивер (дальние — раньше: ближние их закрывают). Трубопровод — по ходу
   *  воздуха от выхода через торец: ряды ресиверов (от стены) последовательно — вход сбоку внизу, выход сверху; от последнего
   *  — к потребителю. Возвращает конец выхода {x, y — лист, z — мм от низа контейнера} для присоединительного размера */
  outMain(sh){
    const k=this.k, X=v=>this.X(v), Z=v=>this.Z(v), { ox, zf, xR }=this, P=StationLayout.PAD, f=EskdSheet.f;
    for (const it of [...this.ext].sort((a, c)=>c.y-a.y)){ sh.rect(X(ox+it.x-200), Z(zf+it.z), (it.lx+400)*k, P*k, 'main', '#fff');
      EquipIcon.front(sh, it, X(ox+it.x), Z(zf+it.z+it.h), X(ox+it.x+it.lx), Z(zf+it.z)); }
    const o=this.outs[0]; if (!o) return null;
    // ряды по удалению от стены; в ряду виден ближний к зрителю
    const cols=[]; for (const it of [...this.ext].sort((a, c)=>a.x-c.x || a.y-c.y)){ const c=cols.find(q=>Math.abs(q.x-it.x)<1); if (!c) cols.push(it); }
    const zin=r=>zf+r.z+(r.shape==='vcyl' && r.h>=900 ? Math.max(250, r.h*0.22) : r.h/2), zout=r=>zf+r.z+r.h+Math.min(250, r.h*0.08);
    let x0=xR, z0=zf+o.z, d=`M${f(xR)},${f(Z(z0))}`;
    cols.forEach((r, n)=>{ const xa=X(ox+r.x), xm=(x0+xa)/2;
      d+=` H${f(xm)} V${f(Z(zin(r)))} H${f(xa)}`;
      if (!n) PneuSymbol.flow(sh, (xR+xm)/2, Z(z0), 1);
      sh.path(d, 'pipe'); const xc=X(ox+r.x+r.lx/2); x0=X(ox+r.x+r.lx); z0=zout(r); d=`M${f(xc)},${f(Z(zf+r.z+r.h))} V${f(Z(z0))}`; });
    const xe=x0+4; sh.path(d+` H${f(xe)}`, 'pipe'); sh.arrow(xe+2.6, Z(z0), 1, 0);
    return { x:xe+2.6, y:Z(z0), z:z0 };
  }
  /** трубопровод на разрезе А–А: магистрали (по ходу воздуха — стрелки), спуски к оборудованию */
  pipesMain(sh){
    const X=v=>this.X(v), Z=v=>this.Z(v), { ox, zf }=this;
    for (const l of this.lines){ const z=Z(zf+l.z);
      for (const br of l.branches) if (br.z1<l.z || br.tee) sh.line(X(ox+br.x), z, X(ox+br.x), Z(zf+br.z1), br.tee ? 'pipe' : 'main');
      for (const [a, c] of StationLayout.runs(l)){ sh.line(X(ox+a), z, X(ox+c), z, 'pipe');
        if (l.medium==='air' && !l.header && (c-a)*this.k>9) PneuSymbol.flow(sh, X(ox+(a+c)/2), z, 1); } }
  }
  /** линия сечения (ГОСТ 2.305): штрих разомкнутой линии наружу от контура, стрелка взгляда вниз — в 1,6 мм от конца
   *  штриха, буква — у стрелки снаружи */
  cutMark(sh, x, y, dir, ch){
    const xe=x+dir*5, xa=xe-dir*1.6; sh.line(x, y, xe, y, 'cut');
    sh.line(xa, y, xa, y+4, 'thin'); sh.arrow(xa, y+4.4, 0, 1);
    sh.text(xe+dir*0.8, y+5.6, ch, 5, { a:dir>0 ? 'start' : 'end' });
  }
  /** то же на плане: стрелки к задней стене (вверх) */
  cutMarkV(sh, x, y, dir, ch){
    const xe=x+dir*5, xa=xe-dir*1.6; sh.line(x, y, xe, y, 'cut');
    sh.line(xa, y, xa, y-4, 'thin'); sh.arrow(xa, y-4.4, 0, -1);
    sh.text(xe+dir*0.8, y-1.2, ch, 5, { a:dir>0 ? 'start' : 'end' });
  }
  chassisSide(sh){
    const k=this.k, xL=this.xL, xR=this.xR, Le=this.Le, Z=v=>this.Z(v), r=420*k;
    sh.rect(xL+40*k, Z(0), Le*k-80*k, 200*k, 'main', '#fff');
    for (const f of (Le<=7000 ? [0.62, 0.78] : [0.66, 0.76, 0.86])){ const cx=xL+Le*k*f; sh.circle(cx, this.Yg-r, r, 'main', '#fff'); sh.circle(cx, this.Yg-r, r*0.45, 'thin'); }
    sh.rect(xL+Le*k*0.16, Z(0)+200*k, 60*k, this.Yg-Z(0)-200*k, 'thin', '#fff');
    sh.line(xL-4, this.Yg, xR+4, this.Yg, 'thin');
  }

  // ---- вид слева: торец у двери снаружи
  end(sh, x0){
    const k=this.k, We=this.We, He=this.He, Z=v=>this.Z(v), XL=y=>x0+(We-y)*k, g=this.g;
    if (this.dz){ const r=420*k, w=300*k; sh.rect(XL(We)+40*k, Z(0), We*k-80*k, 200*k, 'main', '#fff');
      for (const x of [XL(We)+60*k, XL(0)-60*k-w]) sh.rect(x, this.Yg-2*r, w, 2*r, 'main', '#fff'); sh.line(XL(We)-3, this.Yg, XL(0)+3, this.Yg, 'thin'); }
    sh.rect(XL(We), Z(He), We*k, He*k, 'main', '#fff');
    const rz=this.rise, roof=g.roof;
    if (rz && roof==='gable') sh.poly([[XL(We), Z(He)], [XL(We/2), Z(He+rz)], [XL(0), Z(He)]], 'main', '#fff');
    else if (rz && roof==='arch'){ const rc=(We*We/4+rz*rz)/(2*rz), P=[]; for (let j=0; j<=16; j++){ const y=We*j/16; P.push([XL(y), Z(He+rz-rc+Math.sqrt(Math.max(0, rc*rc-(y-We/2)*(y-We/2))))]); }
      sh.poly(P, 'main', '#fff'); }   // арочная — дуга
    else if (rz) sh.poly([[XL(We), Z(He)], [XL(0), Z(He+rz)], [XL(0), Z(He)]], 'main', '#fff');   // односкатная — выше у стены с дверью, скат к задней
    if (this.fuel && this.fuel.fill.wall==='left'){ const b=Math.max(1.2, 220*k), yc=XL(this.oy+this.fuel.fill.y), zc=Z(this.zf+this.fuel.fill.z);
      sh.rect(yc-b/2, zc-b/2, b, b, 'main', '#fff'); sh.line(yc-b/2, zc-b/2+0.5, yc+b/2, zc-b/2+0.5, 'thin'); }
    const cw=Math.max(0.6, 160*k), chh=Math.max(0.6, 120*k);   // угловые фитинги / стойки
    for (const [x, y] of [[XL(We), Z(He)], [XL(0)-cw, Z(He)], [XL(We), Z(0)-chh], [XL(0)-cw, Z(0)-chh]]) sh.rect(x, y, cw, chh, 'thin');
    if (g.sea){   // штатные двери морского контейнера: две створки, запорные штанги
      const xm=(XL(We)+XL(0))/2, y1=Z(He)+chh, y2=Z(0)-chh; sh.line(xm, y1, xm, y2, 'main');
      for (const f of [0.18, 0.36, 0.64, 0.82]){ const x=XL(We)+We*k*f; sh.line(x, y1+0.6, x, y2-0.6, 'thin'); }
    } else { sh.line(XL(We)+cw*0.5, Z(He)+chh, XL(We)+cw*0.5, Z(0)-chh, 'thin'); sh.line(XL(0)-cw*0.5, Z(He)+chh, XL(0)-cw*0.5, Z(0)-chh, 'thin');
      if (this.gt && this.gt.wall==='left') this.gateEnd(sh, XL, this.gt);
      if (this.en && this.en.wall==='left') this.doorEnd(sh, XL, this.en); }
    for (const v of this.vents('left', true)) this.louverEnd(sh, XL(this.oy+v.u1), XL(this.oy+v.u0), Z(this.zf+v.z1), Z(this.zf+v.z0));   // приток в створках
    for (const R of this.hoods()){ const hz=Math.max(1, StationVent.HOOD*k); sh.rect(Math.min(XL(this.oy+R.y0), XL(this.oy+R.y1)), Z(He)-hz, (R.y1-R.y0)*k, hz, 'main', '#fff'); }
    for (const v of this.vents('left')) this.louverEnd(sh, XL(this.oy+v.u1), XL(this.oy+v.u0), Z(this.zf+v.z1), Z(this.zf+v.z0));   // жалюзи по расчёту
    for (const m of this.rf){ const xc=XL(this.oy+m.y+m.d/2), r=m.d/2*k;
      sh.line(xc, Z(He), xc, Z(He+m.gap), 'main'); sh.circle(xc, Z(He+m.gap+m.d/2), r, 'main', '#fff'); }
  }

  /** жалюзи вентиляции по расчёту (StationVent) на стене w: [{u0, u1, z0, z1, kind, w, h}] (мм внутри); дверь-жалюзи ДГУ —
   *  отдельно (this.dg) */
  vents(w, leaf=false){ return ((this.p.vent && this.p.vent.louvers)||[]).filter(L=>L.wall===w && !L.door && !!L.leaf===leaf); }
  /** выброс через крышу (колпаки) */
  hoods(){ return (this.p.vent && this.p.vent.roof)||[]; }
  /** распашные ворота на виде с торца: проём y0…y1 (мм внутри), две створки, запорные штанги; X — y → x на листе */
  gateEnd(sh, X, d){
    const Z=v=>this.Z(v), xa=X(this.oy+d.y0), xb=X(this.oy+d.y1), za=Z(this.zf+d.h), zb=Z(this.zf), xm=(xa+xb)/2, a=Math.min(xa, xb), w=Math.abs(xb-xa);
    sh.rect(a, za, w, zb-za, 'main', '#fff'); sh.line(xm, za, xm, zb, 'main');
    for (const dx of [-0.7, 0.7]) sh.line(xm+dx, za+0.6, xm+dx, zb-0.6, 'thin');
    if (d.wicket){ const ya=d.y0+80, wa=X(this.oy+ya), wb=X(this.oy+ya+d.wicket.w), zt=Z(this.zf+60+d.wicket.h), z0=Z(this.zf+60);   // калитка в створке
      sh.rect(Math.min(wa, wb), zt, Math.abs(wb-wa), z0-zt, 'main'); }
  }
  /** одностворчатая дверь оператора на виде с торца: полотно, ручка */
  doorEnd(sh, X, d){
    const Z=v=>this.Z(v), xa=X(this.oy+d.y0), xb=X(this.oy+d.y1), za=Z(this.zf+d.h), zb=Z(this.zf), a=Math.min(xa, xb), w=Math.abs(xb-xa);
    sh.rect(a, za, w, zb-za, 'main', '#fff'); const hx=a+w*0.85, zh=Z(this.zf+1000); sh.line(hx, zh-0.8, hx, zh+0.8, 'main');
  }
  /** жалюзи на виде с торца: рамка и ламели */
  louverEnd(sh, xa, xb, za, zb){ const k=this.k; sh.rect(Math.min(xa, xb), za, Math.abs(xb-xa), zb-za, 'main', '#fff'); for (let z=za+Math.max(0.8, 70*k); z<zb-0.4; z+=Math.max(0.8, 70*k)) sh.line(Math.min(xa, xb)+0.4, z, Math.max(xa, xb)-0.4, z, 'fine'); }
  // ---- вид Г: дальний торец снаружи (взгляд от торца к входу — лицевая стена слева): дверь-жалюзи ДГУ, вытяжные жалюзи,
  // выходы трубопровода, глушитель с выхлопом в сторону зрителя, ресиверы снаружи перед торцом
  endR(sh, x0){
    const k=this.k, We=this.We, He=this.He, Z=v=>this.Z(v), XR=y=>x0+y*k, g=this.g, { oy, zf }=this;
    if (this.dz){ const r=420*k, w=300*k; sh.rect(XR(0)+40*k, Z(0), We*k-80*k, 200*k, 'main', '#fff');
      for (const x of [XR(0)+60*k, XR(We)-60*k-w]) sh.rect(x, this.Yg-2*r, w, 2*r, 'main', '#fff'); sh.line(XR(0)-3, this.Yg, XR(We)+3, this.Yg, 'thin'); }
    sh.rect(XR(0), Z(He), We*k, He*k, 'main', '#fff');
    const rz=this.rise, roof=g.roof;
    if (rz && roof==='gable') sh.poly([[XR(0), Z(He)], [XR(We/2), Z(He+rz)], [XR(We), Z(He)]], 'main', '#fff');
    else if (rz && roof==='arch'){ const rc=(We*We/4+rz*rz)/(2*rz), P=[]; for (let j=0; j<=16; j++){ const y=We*j/16; P.push([XR(y), Z(He+rz-rc+Math.sqrt(Math.max(0, rc*rc-(y-We/2)*(y-We/2))))]); } sh.poly(P, 'main', '#fff'); }
    else if (rz) sh.poly([[XR(0), Z(He)], [XR(0), Z(He+rz)], [XR(We), Z(He)]], 'main', '#fff');   // односкатная — выше у лицевой стены
    const cw=Math.max(0.6, 160*k), chh=Math.max(0.6, 120*k);
    for (const [x, y] of [[XR(0), Z(He)], [XR(We)-cw, Z(He)], [XR(0), Z(0)-chh], [XR(We)-cw, Z(0)-chh]]) sh.rect(x, y, cw, chh, 'thin');
    const d=this.dg;
    if (d){   // дверь-жалюзи ДГУ: две створки, ламели, петли по краям, запорные штанги посередине
      const xa=XR(oy+d.y0), xb=XR(oy+d.y1), za=Z(zf+d.h), zb=Z(zf), xm=(xa+xb)/2;
      this.louverEnd(sh, xa, xm, za, zb); this.louverEnd(sh, xm, xb, za, zb); sh.rect(xa, za, xb-xa, zb-za, 'main');
      for (const f of [0.15, 0.5, 0.85]){ const z=za+(zb-za)*f, hl=Math.max(0.8, 120*k); sh.rect(xa-0.5, z, 0.8, hl, 'thin', '#000'); sh.rect(xb-0.3, z, 0.8, hl, 'thin', '#000'); }
      for (const dx of [-0.7, 0.7]) sh.line(xm+dx, za+0.6, xm+dx, zb-0.6, 'thin');
    }
    for (const v of this.vents('right')) this.louverEnd(sh, XR(oy+v.u0), XR(oy+v.u1), Z(zf+v.z1), Z(zf+v.z0));
    if (this.gt && this.gt.wall==='right' && !this.gt.sea) this.gateEnd(sh, XR, this.gt);
    if (this.p.exit) this.doorEnd(sh, XR, this.p.exit);   // вторая дверь оператора
    for (const v of this.vents('right', true)) this.louverEnd(sh, XR(oy+v.u0), XR(oy+v.u1), Z(zf+v.z1), Z(zf+v.z0));   // приток в створках ворот
    for (const R of this.hoods()){ const hz=Math.max(1, StationVent.HOOD*k); sh.rect(XR(oy+R.y0), Z(He)-hz, (R.y1-R.y0)*k, hz, 'main', '#fff'); }
    for (const o of this.outs){ const x=XR(oy+o.y), z=Z(zf+o.z), r=Math.max(0.9, 60*k); sh.circle(x, z, r, 'main', '#fff'); EquipIcon.axes(sh, x, z, r*1.6); }   // выходы трубопровода
    for (const m of this.rf){ const xc=XR(oy+m.y+m.d/2), r=m.d/2*k;
      sh.line(xc, Z(He), xc, Z(He+m.gap), 'main'); sh.circle(xc, Z(He+m.gap+m.d/2), r, 'main', '#fff'); sh.circle(xc, Z(He+m.gap+m.d/2), Math.max(0.6, 60*k), 'main', '#fff'); }
    for (const it of [...this.ext].sort((a, c)=>c.x-a.x)) EquipIcon.front(sh, it, XR(oy+it.y), Z(zf+it.z+it.h), XR(oy+it.y+it.ly), Z(zf+it.z));   // ресиверы снаружи — перед торцом
  }
  /** размеры видов с торцов: ширина — снизу, высота (и с крышей) — слева; у двери-жалюзи ДГУ — её размеры */
  endDims(sh, x0, left){
    const k=this.k, We=this.We, He=this.He, Z=v=>this.Z(v), n=StationLayout.n, X=y=>left ? x0+(We-y)*k : x0+y*k, xa=Math.min(X(0), X(We)), xb=Math.max(X(0), X(We));
    sh.dimH(xa, xb, this.Yg+8, n(We), this.Yg, this.Yg);
    let xd=xa-8; sh.dimV(Z(He), Z(0), xd, n(He), xa, xa);
    if (this.rise){ xd-=7; sh.dimV(Z(He+this.rise), Z(0), xd, n(He+this.rise), (xa+xb)/2, xa); }
    const d=this.dg;
    if (!left && d){ const x1=X(this.oy+d.y0), x2=X(this.oy+d.y1); sh.dimH(x1, x2, this.Yg+15, n(d.w), Z(this.zf), Z(this.zf)); sh.dimV(Z(this.zf+d.h), Z(this.zf), xb+6, n(d.h), x2, x2); }
  }
  /** стрелка направления взгляда с буквой (ГОСТ 2.305): острие у контура, dir — куда смотрит (±1 по x) */
  viewArrow(sh, x, y, dir, ch){
    const L=7; sh.line(x-dir*L, y, x-dir*EskdSheet.AR[0], y, 'thin'); sh.arrow(x, y, dir, 0);
    sh.text(x-dir*L/2, y-1.6, ch, 5, { a:'middle' });
  }

  // ---- разрез Б–Б: план под потолком
  plan(sh, yB, col, N){
    const k=this.k, { ox, oy, Le, We, Li, Wi }=this, X=v=>this.X(v), yT=this.yPT, YP=y=>yT+(We-y)*k, xL=this.xL, xR=this.xR, n=StationLayout.n, g=this.g;
    sh.text((xL+xR)/2, yB+4.6, this.label('Б–Б', N), 5, { a:'middle' });
    // направления взгляда на торцы: В — на торец у входа, Г — на дальний (виды ниже)
    this.viewArrow(sh, xL-3, YP(We*0.72), 1, 'В'); this.viewArrow(sh, this.xE+3+this.swingR*k, YP(We*0.72), -1, 'Г');
    // стены в сечении; проёмы дверей
    sh.section(xL, YP(oy), Le*k, oy*k); sh.section(xL, YP(We), Le*k, oy*k);
    sh.section(xL, YP(We-oy), ox*k, Wi*k); sh.section(X(Le-ox), YP(We-oy), ox*k, Wi*k);
    sh.rect(xL, YP(We), Le*k, We*k, 'main'); sh.rect(X(ox), YP(oy+Wi), Li*k, Wi*k, 'thin');
    const fu=this.fuel, tamb=(g.x0||0)-(fu ? fu.x1+fu.part : 0);
    if (tamb>0) sh.rect(X(ox+g.x0)-Math.max(0.5, 30*k), YP(oy+Wi), Math.max(1, 60*k), (Wi-1000)*k, 'thin', '#000');
    if (fu){ sh.section(X(ox+fu.x1), YP(oy+Wi), fu.part*k, Wi*k);   // перегородка отсека бака — сплошная
      const b=Math.max(1.2, 220*k);
      if (fu.fill.wall==='left') sh.rect(xL-b*0.7, YP(oy+fu.fill.y)-b/2, b*0.7, b, 'main', '#fff');
      else if (fu.fill.wall==='back') sh.rect(X(ox+fu.fill.x)-b/2, YP(We)-b*0.7, b, b*0.7, 'main', '#fff');
      else sh.rect(X(ox+fu.fill.x)-b/2, YP(0), b, b*0.7, 'main', '#fff'); }
    for (const h of this.heaters) sh.rect(X(ox+h.x), YP(oy+h.y+h.ly), h.lx*k, h.ly*k, 'main', '#fff');
    this.doorsPlan(sh, YP);
    const ai=this.ai;
    // оборудование — по высоте: выше стоящее (шкафы, фильтры на трубе) — поверх
    const items=[...this.p.items].sort((a, c)=>(a.z+a.h)-(c.z+c.h));
    for (const it of items) EquipIcon.plan(sh, it, X(ox+it.x), YP(oy+it.y+it.ly), X(ox+it.x+it.lx), YP(oy+it.y));
    // трубопровод
    for (const l of this.lines){ const y=YP(oy+l.y);
      for (const br of l.branches) sh.line(X(ox+br.x), YP(oy+br.y0), X(ox+br.x), YP(oy+br.y1), br.tee ? 'pipe' : 'main');
      for (const [a, c] of StationLayout.runs(l)){ sh.line(X(ox+a), y, X(ox+c), y, 'pipe'); if (l.medium==='air' && !l.header && (c-a)*k>9) PneuSymbol.flow(sh, X(ox+(a+c)/2), y, 1); } }
    if (this.ext.length) this.outPlan(sh, YP);
    else for (const o of this.outs){ const y=YP(oy+o.y); sh.line(xR, y, xR+5, y, 'pipe'); sh.arrow(xR+7.6, y, 1, 0); }
    // глушитель на крыше — над секущей плоскостью: штриховой
    for (const m of this.rf) sh.rect(X(ox+m.x), YP(oy+m.y+m.ly), m.lx*k, m.ly*k, 'dash', 'none', m.ly*k/2);
    // угловые фитинги морского контейнера
    if (this.fit){ const [fl, fw]=this.fit, ex=(Le-fl)/2, ey=(We-fw)/2, s=Math.max(0.8, 170*k);
      for (const [x, y] of [[ex, ey], [Le-ex, ey], [ex, We-ey], [Le-ex, We-ey]]) sh.rect(X(x)-s/2, YP(y)-s/2, s, s, 'thin'); }
    // линия сечения А–А — у стены прохода, взгляд к задней стене
    const ya=YP(oy+Math.min(60, Wi*0.03)), xE=this.xE;
    this.cutMarkV(sh, xL-1.5, ya, -1, 'А'); this.cutMarkV(sh, xE+1.5, ya, 1, 'А');
    // цепочка размеров у задней стены (установочные размеры оборудования)
    this.chain(sh, YP(We)-this.swingB*k-8, YP(oy+Wi));
    // габаритные, установочные (фитинги) и присоединительные (выход трубопровода) размеры
    const yb=YP(0)+this.swing*k+(col ? 0 : 11);
    let yd=yb+8; sh.dimH(xL, xR, yd, n(Le), YP(0), YP(0));
    if (this.ext.length){ const r=this.ext.reduce((a, c)=>c.x<a.x ? c : a), xr=X(ox+r.x);   // ресивер снаружи — от торца
      sh.dimH(xR, xr, yd, n(ox+r.x-Le), null, YP(oy+r.y)); }
    if (this.fit){ const [fl, fw]=this.fit, ex=(Le-fl)/2, ey=(We-fw)/2; yd+=7; sh.dimH(X(ex), X(Le-ex), yd, n(fl), YP(ey), YP(ey)); }
    let xd=xL-14; sh.dimV(YP(We), YP(0), xd, n(We), xL, xL);
    if (this.fit){ const [fl, fw]=this.fit, ey=(We-fw)/2, ex=(Le-fl)/2; xd-=7; sh.dimV(YP(We-ey), YP(ey), xd, n(fw), X(ex), X(ex)); }
    if (ai) sh.dimV(YP(oy+ai.y1), YP(oy+ai.y0), X(ox+ai.xm), n(ai.w), null, null);
    const ys=this.ext.length ? [] : [...new Set(this.outs.map(o=>o.y))].sort((a, c)=>c-a); let xo=xE+16;   // правее буквы линии сечения А–А
    for (const y of ys){ sh.dimV(YP(We), YP(oy+y), xo, n(We-oy-y), xR, xR+7.6); xo+=7; }
    // номера позиций: строкой под планом или колонкой справа (выноски не пересекаются)
    const A=this.posPlan.map(it=>({ x:X(ox+it.x+it.lx/2), y:YP(oy+it.y+it.ly/2), n:it.pos }))
      .concat(this.posRoof.map(m=>({ x:X(ox+m.x+m.lx*0.25), y:YP(oy+m.y+m.ly/2), n:m.pos })));
    if (this.pipePos){ const l=this.lines.find(q=>!q.header) || this.lines[0], r=l ? [...StationLayout.runs(l)].sort((a, c)=>(c[1]-c[0])-(a[1]-a[0]))[0] : null;
      if (r) A.push({ x:X(ox+(r[0]+r[1])/2), y:YP(oy+l.y), n:this.pipePos.pos }); }
    const xc=(ys.length ? xo-7+5 : xE+10)+2;
    const L=col ? EskdSheet.shelves(A, 'y', yB+8, YP(0)+this.swing*k+4, xc, 7) : EskdSheet.shelves(A, 'x', StationDrawing.L0+2, StationDrawing.L1-8, YP(0)+this.swing*k+8, 9);
    for (const q of L) sh.pos(q.px, q.py, q.sx, q.sy, q.n, 1);
    // проход: надпись в свободной от выносок части
    if (ai && (ai.y1-ai.y0)*k>3.5){ const lab='Проход обслуживания', lw=EskdSheet.tw(lab, 2.5), yc=YP(oy+(ai.y0+ai.y1)/2)+1.2, xm=X(ox+ai.xm), x0=X(ox+(g.x0||0))+2, x1=xR-2;
      const wallIt=this.p.items.filter(i=>i.mount==='wall' && i.wall==='front' && YP(oy+i.y+i.ly)<yc+1);   // шкафы на стене прохода — не под надписью
      const hit=(a, c)=>L.some(q=>{ const t0=(yc-3-q.py)/(q.sy-q.py), t1=(yc+0.6-q.py)/(q.sy-q.py), xa=q.px+(q.sx-q.px)*Math.max(0, Math.min(1, t0)), xb=q.px+(q.sx-q.px)*Math.max(0, Math.min(1, t1));
        return Math.max(xa, xb)>a && Math.min(xa, xb)<c && Math.max(q.py, q.sy)>yc-3 && Math.min(q.py, q.sy)<yc+0.6; }) || (xm>a-4 && xm<c+4)
        || wallIt.some(i=>X(ox+i.x)-1<c && X(ox+i.x+i.lx)+1>a);
      for (let a=x0; a+lw<=x1; a+=1) if (!hit(a, a+lw)){ sh.text(a+lw/2, yc, lab, 2.5, { a:'middle' }); break; } }
  }
  /** ресиверы снаружи на плане: площадка, ресивер; трубопровод от выхода через торец — коллектором ко всем ресиверам
   *  (параллельно), выход — от дальнего края к потребителю */
  outPlan(sh, YP){
    const k=this.k, X=v=>this.X(v), { ox, oy, xR }=this, E=this.ext, o=this.outs[0], f=EskdSheet.f;
    for (const it of E){ sh.rect(X(ox+it.x-200), YP(oy+it.y+it.ly+200), (it.lx+400)*k, (it.ly+400)*k, 'thin', '#fff');
      EquipIcon.plan(sh, it, X(ox+it.x), YP(oy+it.y+it.ly), X(ox+it.x+it.lx), YP(oy+it.y)); }
    if (!o) return;
    const x0=Math.min(...E.map(i=>i.x)), xm=(xR+X(ox+x0))/2, yo=YP(oy+o.y), yc=E.map(i=>YP(oy+i.y+i.ly/2));
    sh.line(xR, yo, xm, yo, 'pipe'); PneuSymbol.flow(sh, (xR+xm)/2, yo, 1);
    const lo=Math.min(yo, ...yc), hi=Math.max(yo, ...yc); if (hi-lo>0.2) sh.line(xm, lo, xm, hi, 'pipe');
    for (const it of E){ const y=YP(oy+it.y+it.ly/2); sh.line(xm, y, X(ox+it.x), y, 'pipe'); }
    const far=E.reduce((a, c)=>c.x+c.lx>a.x+a.lx ? c : a), ye=YP(oy+far.y+far.ly/2), xe=X(ox+far.x+far.lx)+4;
    sh.path(`M${f(X(ox+far.x+far.lx/2))},${f(ye)} H${f(xe)}`, 'pipe'); sh.arrow(xe+2.6, ye, 1, 0);
  }
  /** двери на плане: входная в стене прохода и сервисные — проём, створка в открытом положении и дуга (крайнее положение —
   *  штрихпунктирной с двумя точками); двери (ворота) в торце — створки в проёме */
  doorsPlan(sh, YP){
    const k=this.k, X=v=>this.X(v), { ox, oy, We }=this, p=this.p;
    const leafSwing=(xh, xf, yw, dir)=>{ const r=Math.abs(xf-xh), ye=yw+dir*r, f=EskdSheet.f;
      sh.line(xh, yw, xh, ye, 'phantom');
      sh.path(`M${f(xh)},${f(ye)} A${f(r)},${f(r)} 0 0 ${(xf>xh)===(dir>0) ? 0 : 1} ${f(xf)},${f(yw)}`, 'phantom'); };
    const gap=(x0, x1, back)=>{ const y0=back ? YP(We) : YP(oy), h=oy*k; sh.rect(X(x0), y0, (x1-x0)*k, h, 'thin', '#fff'); sh.line(X(x0), y0, X(x0), y0+h, 'main'); sh.line(X(x1), y0, X(x1), y0+h, 'main'); };
    if (p.fuel){ const d0=ox+p.fuel.door.x0, d1=ox+p.fuel.door.x1; gap(d0, d1, false); leafSwing(X(d0), X(d1), YP(0), 1); }   // вход в отсек бака
    const en=this.en; if (en && en.wall==='front'){ const d0=ox+en.x0, d1=ox+en.x1; gap(d0, d1, false); leafSwing(X(d0), X(d1), YP(0), 1); }
    for (const d of p.doors||[]){ const back=d.wall==='back', lw=d.w/d.leaves;   // сервисные: без прохода — у каждого агрегата, с проходом — для демонтажа
      gap(ox+d.x0, ox+d.x1, back);
      for (let i=0; i<d.leaves; i++){ const a=ox+d.x0+i*lw, b=a+lw, left=i%2===0; leafSwing(X(left ? a : b), X(left ? b : a), back ? YP(We) : YP(0), back ? -1 : 1); } }
    if (this.dg){ const d=this.dg, ya=YP(oy+d.y0), yb=YP(oy+d.y1), x0=X(this.Le-ox), x1=X(this.Le), r=(ya-yb)/2, f=EskdSheet.f;   // дверь-жалюзи ДГУ в торце
      sh.rect(x0, yb, x1-x0, ya-yb, 'thin', '#fff'); sh.line(x0, ya, x1, ya, 'main'); sh.line(x0, yb, x1, yb, 'main');
      for (const [yh, s] of [[ya, -1], [yb, 1]]){ const ye=yh+s*r; sh.line(x1, yh, x1+r, yh, 'phantom'); sh.path(`M${f(x1+r)},${f(yh)} A${f(r)},${f(r)} 0 0 ${s>0 ? 1 : 0} ${f(x1)},${f(ye)}`, 'phantom'); } }
    // в торцах: ворота (у морского — штатные двери) и дверь оператора — створки в проёме
    const inEnd=(d, left, n)=>{ const xw=left ? this.xL : X(this.Le-ox), y0=oy+d.y0, w=d.y1-d.y0, lw=w/n; sh.rect(xw, YP(y0+w), ox*k, w*k, 'thin', '#fff');
      for (let i=0; i<n; i++) sh.rect(xw+ox*k*0.25, YP(y0+lw*(i+1)), Math.max(0.4, ox*k*0.5), lw*k, 'main', '#fff'); };
    if (this.gt) inEnd(this.gt, this.gt.wall==='left', 2);
    if (p.exit) inEnd(p.exit, p.exit.wall==='left', 1);   // вторая дверь оператора в дальнем торце
    if (en && en.wall==='left' && !en.sea) inEnd(en, true, 1);
  }
  /** цепочка размеров вдоль задней стены по заднему ряду: отрезки; тесным числам — место выше (до трёх строк) со сдвигом
   *  вбок, без наложений; x — середина числа от внутренней левой грани, мм листа */
  chainPlan(k){
    const x0=this.g.x0||0, row=this.p.items.filter(i=>i.row===0 && i.mount!=='pipe').sort((a, c)=>a.x-c.x); if (!row.length) return { segs:[], lift:0, tick:false };
    const pts=[x0]; for (const it of row) pts.push(it.x, it.x+it.lx); pts.push(this.Li);
    const xs=[...new Set(pts.map(v=>Math.round(v)))].filter(v=>v>=x0 && v<=this.Li).sort((a, c)=>a-c), busy=[[], [], [], [], [], []], segs=[];
    const free=(lv, x, w)=>!busy[lv].some(([p, q])=>x-w/2-1<q && x+w/2+1>p);
    for (let i=1; i<xs.length; i++){ const a=xs[i-1]*k, c=xs[i]*k, t=StationLayout.n(xs[i]-xs[i-1]), w=EskdSheet.tw(t, 3.5), m=(a+c)/2;
      let lift=0, x=m;
      if (w+1>c-a){ lift=-1; const steps=[0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, -6, 6];
        found: for (const lv of [1, 2, 3, 4, 5]) for (const s of steps){ const xx=m+s*(w/2+1.2); if (free(lv, xx, w)){ lift=lv; x=xx; break found; } } }
      if (lift<0) continue;   // мелкий шаг в тесной цепочке — без размера (числа не наезжают друг на друга)
      busy[lift].push([x-w/2, x+w/2]); segs.push({ a:xs[i-1], c:xs[i], t, lift, x }); }
    return { segs, lift:Math.max(0, ...segs.map(q=>q.lift)), tick:segs.some(q=>(q.c-q.a)*k<2*EskdSheet.AR[0]+1.5) };
  }
  /** запас над планом под цепочку размеров, мм */
  chainTop(k){ const c=this.chainPlan(k); return c.segs.length ? 8+4.6+c.lift*5.1 : 4; }
  chain(sh, y, from){
    const X=v=>this.X(v), ox=this.ox, c=this.chainPlan(this.k), base=X(ox);
    c.segs.forEach((q, i)=>sh.dimH(X(ox+q.a), X(ox+q.c), y, q.t, i ? null : from, from, { lift:q.lift, tick:c.tick, tx:base+q.x }));
  }
  /** проход: [y0, y1] поперёк контейнера, ширина в самом узком месте и где мерить */
  static aisle(plan, Wi){
    const it=plan.items.filter(i=>i.mount==='floor' || i.mount==='frame'); if (!it.length) return null;
    if (plan.rows===2){ const A=it.filter(i=>i.row===1), B=it.filter(i=>i.row===0); if (!A.length || !B.length) return null;
      const y0=Math.max(...A.map(i=>i.y+i.ly)), y1=Math.min(...B.map(i=>i.y)); const m=B.find(i=>i.y===y1); return { y0, y1, w:y1-y0, xm:m.x+m.lx/2 }; }
    const y1=Math.min(...it.map(i=>i.y)), m=it.find(i=>i.y===y1); return { y0:0, y1, w:y1, xm:m.x+m.lx/2, dgu:m.kind==='dgu' };
  }
  /** где висят настенные шкафы — для примечаний */
  static cabWhere(plan){
    const W=new Set(plan.items.filter(i=>i.mount==='wall').map(i=>i.wall)), t=[];
    if (W.has('front')) t.push('на стене прохода у двери'); if (W.has('left') || W.has('right')) t.push(W.has('left') && W.has('right') ? 'на торцевых стенах' : W.has('left') ? 'на торцевой стене у двери' : 'на дальней торцевой стене');
    if (W.has('back')) t.push('за своим местом в ряду');
    return t.join(', ');
  }
}

// ---------------------------------------------------------------- 3D-вид (аксонометрия с одного ракурса)
class StationView3D {
  static W = 1600;
  static H = 1100;
  static AZ = 30;            // поворот вокруг вертикали, °
  static EL = 24;            // наклон взгляда сверху, °

  /** plan — StationLayout.solve(...); meta: {deck — высота шасси, мм} */
  static svg(plan, meta={}){
    const S=StSvg, g=plan.geo, [Le, We, He]=g.ext, [Li, Wi, Hi]=plan.int, ox=(Le-Li)/2, oy=(We-Wi)/2;
    const dz=plan.chassis ? (meta.deck||1150) : 0, base=dz+StationGeo.zFloor(g.type, g.t), ceil=base+Hi, top=dz+He;
    const rf=plan.roof||[], up=rf.length ? Math.max(...rf.map(m=>m.gap+m.d)) : 0;
    const az=this.AZ*Math.PI/180, el=this.EL*Math.PI/180, cs=Math.cos(az), sn=Math.sin(az), ce=Math.cos(el), se=Math.sin(el);
    const P0=(x, y, z)=>[x*cs-y*sn, -((x*sn+y*cs)*se+z*ce)];
    // масштаб — по габаритам контейнера (с шасси и дышлом)
    const O=(plan.outside||[]).map(it=>Object.assign({}, it, { X0:ox+it.x, Y0:oy+it.y, X1:ox+it.x+it.lx, Y1:oy+it.y+it.ly })), xe=Math.max(Le, ...O.map(i=>i.X1+400));
    const ext=[]; for (const x of [0, xe]) for (const y of [0, We]) for (const z of [0, Math.max(top+up, ...O.map(i=>base+i.z+i.h))]) ext.push(P0(x, y, z));
    const minX=Math.min(...ext.map(p=>p[0])), maxX=Math.max(...ext.map(p=>p[0])), minY=Math.min(...ext.map(p=>p[1])), maxY=Math.max(...ext.map(p=>p[1]));
    const H=Math.round(Math.max(760, Math.min(this.H, this.W*0.9*(maxY-minY)/(maxX-minX)/0.84)));
    const k=Math.min(this.W*0.9/(maxX-minX), H*0.84/(maxY-minY)), tx=(this.W-(maxX-minX)*k)/2-minX*k, ty=(H-(maxY-minY)*k)/2-minY*k+H*0.02;
    const P=(x, y, z)=>{ const p=P0(x, y, z); return [p[0]*k+tx, p[1]*k+ty]; };
    const V=new StView(P, k, se, S);
    const wall=(plan.wallColor||'#CBD0CC'), frame=(plan.frameColor||RalColor.shade(wall, 0.7)), lining=RalColor.mix('#eef1f4', wall, 0.1);
    const band=Math.max(650, Math.min(900, He*0.3)), out=[];
    // земля и тень контейнера
    const sh=[P(-300, -250, 0), P(Le+500, -250, 0), P(Le+500, We+450, 0), P(-300, We+450, 0)];
    out.push(S.poly(sh, '#000000', '', 0, ' opacity="0.10" filter="url(#blur18)"'));
    if (dz) out.push(...V.chassis(Le, We, dz));
    // задняя стена и дальний торец — изнутри; верх стен, стойки и балки сзади
    out.push(V.face([[ox, oy+Wi, base], [ox+Li, oy+Wi, base], [ox+Li, oy+Wi, top], [ox, oy+Wi, top]], lining, 1));
    out.push(V.face([[ox+Li, oy, base], [ox+Li, oy+Wi, base], [ox+Li, oy+Wi, top], [ox+Li, oy, top]], RalColor.shade(lining, 0.9), 1));
    out.push(V.face([[0, oy+Wi, top], [Le, oy+Wi, top], [Le, We, top], [0, We, top]], RalColor.shade(frame, 1.08), 1));   // крыша в разрезе — в цвет каркаса
    out.push(V.face([[ox+Li, 0, top], [Le, 0, top], [Le, We, top], [ox+Li, We, top]], RalColor.shade(frame, 1.08), 1));
    if (!g.sea) for (let x=ox+1150; x<ox+Li-100; x+=1150) out.push(V.line([x, oy+Wi-1, base], [x, oy+Wi-1, top], RalColor.shade(lining, 0.86), 1.2));
    if (g.sea) for (let x=ox+300; x<ox+Li-100; x+=560) out.push(V.face([[x, oy+Wi-1, base], [x+280, oy+Wi-1, base], [x+280, oy+Wi-1, top], [x, oy+Wi-1, top]], RalColor.shade(lining, 0.96), 0));
    out.push(...V.box(0, We-150, dz, 150, We, top, frame), ...V.box(Le-150, We-150, dz, Le, We, top, frame));
    // пол
    out.push(V.face([[ox, oy, base], [ox+Li, oy, base], [ox+Li, oy+Wi, base], [ox, oy+Wi, base]], '#b3b9bf', 1));
    for (let x=ox+1250; x<ox+Li; x+=1250) out.push(V.line([x, oy, base], [x, oy+Wi, base], '#9aa1a8', 1.2));
    // вентиляция: жалюзи по расчёту (StationVent) на задней стене и в дальнем торце — изнутри, с подписью размера
    // шкафы на стене прохода — на срезанной стене: не показываются
    const items=plan.items.filter(it=>!(it.mount==='wall' && it.wall==='front')).map(it=>Object.assign({}, it, { X0:ox+it.x, Y0:oy+it.y, X1:ox+it.x+it.lx, Y1:oy+it.y+it.ly }));
    const tags=[], seen=new Set(), nm={ in:'Приток', out:'Вытяжка', rad:'Радиатор ДГУ' };
    for (const L of ((plan.vent && plan.vent.louvers)||[]).filter(q=>q.wall==='back' || q.wall==='right')){
      const a=L.wall==='back' ? [ox+L.u0, oy+Wi-2, base+L.z0] : [ox+Li-2, oy+L.u0, base+L.z0], b=L.wall==='back' ? [ox+L.u1, oy+Wi-2, base+L.z1] : [ox+Li-2, oy+L.u1, base+L.z1];
      out.push(V.louver(a, b, L.wall==='back' ? 'y' : 'x'));
      const key=L.kind+L.wall; if (seen.has(key)) continue; seen.add(key);
      const c=P((a[0]+b[0])/2, (a[1]+b[1])/2, (a[2]+b[2])/2);
      tags.push([c, `${nm[L.kind]}: ${L.door ? `${StationLayout.n(L.w)} × ${StationLayout.n(L.h)} мм` : StationVent.list(plan.vent, L.kind, L.wall)}`]); }
    // трубопровод вдоль задней стены: магистраль и отводы (трубой — тёмный контур и светлый блик)
    const tube=(a, b, c, w)=>V.line(a, b, RalColor.shade(c, 0.62), w+2)+V.line(a, b, c, w)+V.line(a, b, RalColor.shade(c, 1.35), Math.max(1, w*0.3));
    // отвод со спуском на верх оборудования — сразу после этого оборудования: стоящее ближе к зрителю его закроет
    const over=new Map();
    for (const pp of plan.piping||[]){ const w=Math.max(4, 90*k);
      for (const l of pp.lines){ const y=oy+l.y, z=base+l.z;
        const c=PipeMaterial.idColor(l.medium, pp.color);   // опознавательная окраска (ГОСТ 14202-69)
        for (const [a, b] of StationLayout.runs(l)) out.push(tube([ox+a, y, z], [ox+b, y, z], c, w));
        for (const b of l.branches){ const t=tube([ox+b.x, oy+b.y0, z], [ox+b.x, oy+b.y1, z], c, w*0.8), to=items.find(i=>i.id+'#'+i.unit===b.to);
          if (b.tee) out.push(tube([ox+b.x, oy+b.y0, z], [ox+b.x, oy+b.y1, z], c, w)+tube([ox+b.x, oy+b.y1, z], [ox+b.x, oy+b.y1, base+b.z1], c, w));   // подъём к коллектору входов
          else if (b.z1<l.z) over.set(b.to, (over.get(b.to)||'')+t+tube([ox+b.x, oy+b.y1, z], [ox+b.x, oy+b.y1, base+(to ? Math.min(b.z1, this.top(to)) : b.z1)], c, w*0.8));
          else out.push(t); } } }
    // оборудование: тени, затем по глубине (дальнее — раньше)
    for (const it of items.filter(i=>i.mount==='floor' || i.mount==='frame')) out.push(V.face([[it.X0+60, it.Y0+40, base+1], [it.X1+160, it.Y0+40, base+1], [it.X1+160, it.Y1+120, base+1], [it.X0+60, it.Y1+120, base+1]], '#000000', 0, ' opacity="0.16" filter="url(#blur6)"'));
    for (const it of V.order(items)){ out.push(...this.equip(V, it, base, ceil, oy+Wi)); const t=over.get(it.id+'#'+it.unit); if (t) out.push(t); }
    // ресиверы снаружи — за дальним торцом на площадке; трубопровод от торца к ним
    if (O.length){ const l=(plan.piping||[]).flatMap(q=>q.lines).find(q=>q.medium==='air' && !q.header && q.x1>=Li-1), c=PipeMaterial.idColor('air', '#8d949b'), w=Math.max(4, 90*k);
      for (const it of O) out.push(V.face([[it.X0-200, it.Y0-200, base+it.z], [it.X1+200, it.Y0-200, base+it.z], [it.X1+200, it.Y1+200, base+it.z], [it.X0-200, it.Y1+200, base+it.z]], '#b9b6ae', 1));
      if (l){ const xm=(Le+Math.min(...O.map(i=>i.X0)))/2, y=oy+l.y, z=base+l.z;
        out.push(tube([Le, y, z], [xm, y, z], c, w)); for (const it of O){ const yc=(it.Y0+it.Y1)/2, zi=base+it.z+Math.max(250, it.h*0.22);
          out.push(tube([xm, y, z], [xm, yc, z], c, w), tube([xm, yc, z], [xm, yc, zi], c, w), tube([xm, yc, zi], [it.X0, yc, zi], c, w)); } }
      for (const it of V.order(O)) out.push(...this.equip(V, it, base, ceil, oy+Wi)); }
    // срезанные стенки со стороны зрителя: торец у двери и стена прохода — до высоты пояса
    out.push(...this.band(V, plan, wall, frame, Le, We, dz, band, ox, oy, Wi));
    // рама: передние стойки и верхние балки
    out.push(...V.box(0, 0, dz, 150, 150, top, frame), ...V.box(Le-150, 0, dz, Le, 150, top, frame));
    out.push(...V.box(0, 0, top-110, Le, 110, top, frame), ...V.box(0, 0, top-110, 110, We, top, frame));
    // глушитель на крыше: выхлопная труба от ДГУ сквозь крышу, опоры, корпус, вывод выхлопа с колпаком
    for (const m of rf){ const x0=ox+m.x, x1=x0+m.lx, cy=oy+m.y+m.d/2, r=m.d/2, cz=top+m.gap+r, steel='#8d949b';
      if (m.exhaust){ const ex=ox+m.exhaust.x, ey=oy+m.exhaust.y; out.push(V.vcyl(ex, ey, 65, base+m.exhaust.z, cz, steel, false), V.line([ex, ey, cz], [ex, cy, cz], RalColor.shade(steel, 0.7), Math.max(3, 130*k))); }
      for (const f of [0.18, 0.82]) out.push(...V.box(x0+m.lx*f-40, cy-r*0.7, top, x0+m.lx*f+40, cy+r*0.7, cz-r*0.6, '#3a3f45'));
      out.push(V.hcyl(x0, x1, cy, cz, r, m.color));
      out.push(V.hcyl(x1, x1+m.outlet, cy, cz, 60, steel)); }   // выхлоп — горизонтально в сторону
    const defs=`<filter id="blur6" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter><filter id="blur18" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>${V.defs.join('')}`;
    // подписи жалюзи: выноска вверх, текст в рамке
    for (const [[x, y], t] of tags){ const w=S.tw(t, 18)+20, bx=Math.max(8, Math.min(this.W-w-8, x-w/2)), by=Math.max(8, y-100);
      out.push(S.line(x, y, Math.max(bx+8, Math.min(bx+w-8, x)), by+30, '#1f2a36', 2), S.circle(x, y, 4, '#1f2a36'), S.rect(bx, by, w, 30, '#ffffff', '#1f2a36', 2, ' fill-opacity="0.94"'), S.text(bx+10, by+21, t, { size:18, anchor:'start', weight:600 })); }
    return S.doc(this.W, H, S.rect(0, 0, this.W, H, '#ffffff')+out.join(''), defs);
  }

  /** нижний пояс срезанных стенок: торец у двери (с дверями) и стена прохода (с дверью); гофр морского контейнера */
  static band(V, plan, wall, frame, Le, We, dz, band, ox, oy, Wi){
    const out=[], g=plan.geo, cut=RalColor.mix('#dfe3e7', wall, 0.15);
    out.push(V.face([[0, 0, dz], [0, We, dz], [0, We, dz+band], [0, 0, dz+band]], RalColor.shade(wall, 0.82), 1));
    out.push(V.face([[0, 0, dz+band], [ox, 0, dz+band], [ox, We, dz+band], [0, We, dz+band]], cut, 1));
    out.push(V.face([[0, 0, dz], [Le, 0, dz], [Le, 0, dz+band], [0, 0, dz+band]], wall, 1));
    out.push(V.face([[0, 0, dz+band], [Le, 0, dz+band], [Le, oy, dz+band], [0, oy, dz+band]], cut, 1));
    const rib=g.sea ? 280 : 1150, dark=RalColor.shade(wall, g.sea ? 0.9 : 0.8);
    for (let x=rib; x<Le-100; x+=rib*(g.sea ? 2 : 1)) out.push(g.sea ? V.face([[x, -1, dz], [x+rib*0.6, -1, dz], [x+rib*0.6, -1, dz+band], [x, -1, dz+band]], dark, 0) : V.line([x, -1, dz], [x, -1, dz+band], dark, 1.4));
    for (let y=rib; y<We-100; y+=rib*(g.sea ? 2 : 1)) out.push(g.sea ? V.face([[-1, y, dz], [-1, y+rib*0.6, dz], [-1, y+rib*0.6, dz+band], [-1, y, dz+band]], RalColor.shade(dark, 0.86), 0) : V.line([-1, y, dz], [-1, y, dz+band], RalColor.shade(dark, 0.85), 1.4));
    const G=plan.gates && plan.gates.wall==='left' ? plan.gates : null, en=plan.entry;
    if (G){   // в торце у входа — ворота (у морского — его двери): запорные штанги
      const w=G.y1-G.y0, y0=oy+G.y0;
      for (const f of [0.12, 0.38, 0.62, 0.88]) out.push(V.line([-6, y0+w*f, dz+40], [-6, y0+w*f, dz+band], '#3b4148', 2.6));
      out.push(V.line([-6, y0+w/2, dz], [-6, y0+w/2, dz+band], RalColor.shade(wall, 0.55), 1.6)); }
    if (en && en.wall==='left' && !en.sea) out.push(V.face([[-3, oy+en.y0, dz+60], [-3, oy+en.y1, dz+60], [-3, oy+en.y1, dz+band], [-3, oy+en.y0, dz+band]], RalColor.shade(wall, 0.93), 1.2));
    if (en && en.wall==='front'){
      const d0=ox+en.x0, d1=ox+en.x1;
      out.push(V.face([[d0, -3, dz+60], [d1, -3, dz+60], [d1, -3, dz+band], [d0, -3, dz+band]], RalColor.shade(wall, 0.93), 1.2));
    }
    void frame;
    return out;
  }

  /** верх оборудования, каким оно нарисовано (насос — корпус ниже габарита, горизонтальная ёмкость — на опорах): сюда приходит
   *  спуск трубопровода */
  static top(it){ return it.kind==='pump' ? it.h*0.85 : it.shape==='hcyl' ? it.h*0.55+Math.min(it.ly, it.h)/2*0.95 : it.h; }
  /** оборудование: короба, цилиндры; у компрессора — воздуховод к задней стене, у ДГУ — рама, генератор, двигатель, радиатор */
  static equip(V, it, base, ceil, yWall){
    const c=it.color, out=[], x0=it.X0, x1=it.X1, y0=it.Y0, y1=it.Y1, z0=base+(it.z||0), z1=z0+it.h, L=x1-x0, W=y1-y0;
    if (it.mount==='frame') for (const f of [0.12, 0.82]) out.push(...V.box(x0+L*f, y0+W*0.3, base, x0+L*f+40, y0+W*0.3+40, z0, '#3a3f45'));   // рама шкафа
    if (it.mount==='pipe'){   // фильтр на трубе: головка и корпус вниз
      out.push(V.vcyl((x0+x1)/2, (y0+y1)/2, Math.min(L, W)/2*0.8, z0, z1-it.h*0.14, c, false), ...V.box(x0, y0+W*0.2, z1-it.h*0.14, x1, y1-W*0.2, z1, RalColor.shade(c, 0.85)));
      return out; }
    if (it.shape==='vcyl'){
      const leg=it.kind==='receiver' ? Math.min(220, it.h*0.1) : 0;
      if (leg) for (const [dx, dy] of [[0.25, 0.3], [0.75, 0.3], [0.5, 0.85]]) out.push(...V.box(x0+L*dx-25, y0+W*dy-25, z0, x0+L*dx+25, y0+W*dy+25, z0+leg+20, '#3a3f45'));
      out.push(V.vcyl((x0+x1)/2, (y0+y1)/2, Math.min(L, W)/2, z0+leg, z1, c, it.kind==='receiver'));
      return out;
    }
    if (it.shape==='hcyl'){ out.push(...V.box(x0+L*0.15, y0+W*0.2, z0, x0+L*0.22, y1-W*0.2, z0+it.h*0.35, '#3a3f45'), ...V.box(x0+L*0.78, y0+W*0.2, z0, x0+L*0.85, y1-W*0.2, z0+it.h*0.35, '#3a3f45'));
      out.push(V.hcyl(x0, x1, (y0+y1)/2, z0+it.h*0.55, Math.min(W, it.h)/2*0.95, c)); return out; }
    if (it.kind==='dgu'){
      const fb=z0+it.h*0.12;
      out.push(...V.box(x0, y0, z0, x1, y1, fb, '#3a3f45'));
      out.push(...V.box(x0+L*0.86, y0+W*0.04, fb, x1, y1-W*0.04, z1, RalColor.shade(c, 0.75), (f, F)=>F==='front' ? V.grille(f, 0.12, 0.88, 0.1, 0.9, 7, '#2d3238') : ''));
      out.push(...V.box(x0+L*0.36, y0+W*0.1, fb, x0+L*0.86, y1-W*0.1, z0+it.h*0.82, c, (f, F)=>F==='front' ? V.rectOn(f, 0.08, 0.2, 0.5, 0.75, RalColor.shade(c, 0.8)) : ''));
      out.push(...V.box(x0+L*0.04, y0+W*0.14, fb, x0+L*0.36, y1-W*0.14, z0+it.h*0.66, RalColor.shade(c, 0.82), (f, F)=>F==='front' ? V.grille(f, 0.15, 0.85, 0.25, 0.7, 5, RalColor.shade(c, 0.55)) : ''));
      return out;
    }
    if (it.kind==='pump'){
      const fb=z0+Math.min(120, it.h*0.15);
      out.push(...V.box(x0, y0, z0, x1, y1, fb, '#3a3f45'));
      out.push(...V.box(x0+L*0.42, y0+W*0.18, fb, x1-L*0.04, y1-W*0.18, z0+it.h*0.85, c, (f, F)=>F==='front' ? V.grille(f, 0.1, 0.9, 0.2, 0.8, 6, RalColor.shade(c, 0.7)) : ''));
      out.push(...V.box(x0+L*0.04, y0+W*0.12, fb, x0+L*0.42, y1-W*0.12, z0+it.h*0.75, '#6b7886'));
      return out;
    }
    const deco=(f, F)=>this.deco(V, it, f, F);
    out.push(...V.box(x0, y0, z0, x1, y1, z0+Math.min(80, it.h*0.06), RalColor.shade(c, 0.6)));
    out.push(...V.box(x0, y0, z0+Math.min(80, it.h*0.06), x1, y1, z1, c, deco));
    if (it.kind==='compressor'){   // воздуховод отвода горячего воздуха — к задней стене под потолком
      const dh=Math.min(380, ceil-90-z1-60), dw=Math.min(L*0.45, 900), dd=Math.min(W*0.45, 650), cx=(x0+x1)/2, cy=(y0+y1)/2;
      if (dh>=180){ const zt=ceil-90, zd=zt-dh, gal='#c3c9cf';
        out.unshift(V.louver([cx-dw/2-70, yWall-2, zd-70], [cx+dw/2+70, yWall-2, Math.min(ceil, zt+70)], 'y'));
        out.push(...V.box(cx-dw/2, cy-dd/2, z1, cx+dw/2, cy+dd/2, zd, gal));
        out.push(...V.box(cx-dw/2, cy-dd/2, zd, cx+dw/2, yWall, zt, gal)); }
    }
    if (it.kind==='tank') out.push(V.vcyl(x0+L*0.2, y0+W*0.5, Math.min(90, W*0.15), z1, z1+90, '#5a6168', false));
    return out;
  }

  /** детали лицевой стороны: пульт, решётки, двери шкафа */
  static deco(V, it, f, F){
    const c=it.color, dk=RalColor.shade(c, 0.62);
    if (F!=='front') return F==='left' && /compressor|dryer/.test(it.kind) ? V.grille(f, 0.25, 0.75, 0.3, 0.7, 6, dk) : '';
    if (it.kind==='compressor') return V.rectOn(f, 0.06, 0.24, 0.62, 0.86, '#2b3440')+V.rectOn(f, 0.085, 0.215, 0.69, 0.81, '#7fb8e3')+V.grille(f, 0.52, 0.92, 0.22, 0.72, 8, dk);
    if (it.kind==='dryer') return V.rectOn(f, 0.08, 0.3, 0.68, 0.84, '#2b3440')+V.grille(f, 0.1, 0.9, 0.12, 0.48, 6, dk);
    if (it.kind==='cabinet') return V.lineOn(f, 0.5, 0.04, 0.5, 0.96, dk, 1.4)+V.rectOn(f, 0.43, 0.47, 0.46, 0.56, '#3b4148')+V.rectOn(f, 0.53, 0.57, 0.46, 0.56, '#3b4148')+V.rectOn(f, 0.12, 0.38, 0.8, 0.9, RalColor.shade(c, 0.85));
    if (it.kind==='filter') return V.rectOn(f, 0.1, 0.9, 0.82, 0.92, dk);
    return V.rectOn(f, 0.1, 0.3, 0.7, 0.85, RalColor.shade(c, 0.8));
  }
}

// ---------------------------------------------------------------- 3D: грани, цилиндры, порядок отрисовки
class StView {
  constructor(P, k, se, S){ this.P=P; this.k=k; this.se=se; this.S=S; this.defs=[]; this.gid=0; }
  face(Q, fill, sw=1, extra=''){ return this.S.poly(Q.map(q=>this.P(...q)), fill, sw ? RalColor.shade(fill.startsWith('#') ? fill : '#888888', 0.62) : '', sw, extra); }
  line(a, b, stroke, sw){ const p=this.P(...a), q=this.P(...b); return this.S.line(p[0], p[1], q[0], q[1], stroke, sw, ' stroke-linecap="round"'); }
  /** короб: видны торец x0, сторона y0 (лицевая) и верх; deco(f, грань) — детали на грани в её координатах u, v ∈ [0, 1] */
  box(x0, y0, z0, x1, y1, z1, c, deco){
    if (x1-x0<1 || y1-y0<1 || z1-z0<1) return [];
    const top=RalColor.light(c)<0.3 ? 1.25 : 1.1, out=[
      this.face([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], RalColor.shade(c, 0.8), 1),
      this.face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], c, 1),
      this.face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], RalColor.shade(c, top), 1)];
    if (deco){
      const fr=(u, v)=>[x0+(x1-x0)*u, y0-1, z0+(z1-z0)*v], lf=(u, v)=>[x0-1, y1-(y1-y0)*u, z0+(z1-z0)*v];
      const a=deco(fr, 'front'), b=deco(lf, 'left'); if (a) out.push(a); if (b) out.push(b); }
    return out;
  }
  rectOn(f, u0, u1, v0, v1, fill){ return this.face([f(u0, v0), f(u1, v0), f(u1, v1), f(u0, v1)], fill, 0); }
  lineOn(f, u0, v0, u1, v1, stroke, sw){ return this.line(f(u0, v0), f(u1, v1), stroke, sw); }
  grille(f, u0, u1, v0, v1, n, stroke){ let s=''; for (let i=0; i<n; i++){ const v=v0+(v1-v0)*(i+0.5)/n; s+=this.line(f(u0, v), f(u1, v), stroke, 1.6); } return s; }
  /** жалюзи на стене: углы a и b (x — на торце, y — на задней стене) */
  louver(a, b, axis){
    const [x0, y0, z0]=a, [x1, y1, z1]=b, Q=axis==='x' ? [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]] : [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
    let s=this.face(Q, '#8d959d', 1.2);
    for (let i=1; i<8; i++){ const z=z0+(z1-z0)*i/8; s+=axis==='x' ? this.line([x0, y0, z], [x0, y1, z], '#4d555d', 1.6) : this.line([x0, y0, z], [x1, y0, z], '#4d555d', 1.6); }
    return s;
  }
  /** вертикальный цилиндр (ресивер — с выпуклым днищем сверху), заливка — градиент «объёма» */
  vcyl(cx, cy, r, z0, z1, c, dome){
    const S=this.S, b=this.P(cx, cy, z0), t=this.P(cx, cy, z1), rx=r*this.k, ry=r*this.k*this.se, id='g'+(++this.gid);
    this.defs.push(`<linearGradient id="${id}" x1="${S.f(b[0]-rx)}" y1="0" x2="${S.f(b[0]+rx)}" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${RalColor.shade(c, 0.78)}"/><stop offset="0.35" stop-color="${RalColor.shade(c, 1.12)}"/><stop offset="1" stop-color="${RalColor.shade(c, 0.62)}"/></linearGradient>`);
    const edge=RalColor.shade(c, 0.55), f=S.f;
    let s=`<path d="M${f(t[0]-rx)},${f(t[1])} L${f(b[0]-rx)},${f(b[1])} A${f(rx)},${f(ry)} 0 0 0 ${f(b[0]+rx)},${f(b[1])} L${f(t[0]+rx)},${f(t[1])} Z" fill="url(#${id})" stroke="${edge}" stroke-width="1"/>`;
    if (dome) s+=`<path d="M${f(t[0]-rx)},${f(t[1])} A${f(rx)},${f(Math.max(ry, rx*0.42))} 0 0 1 ${f(t[0]+rx)},${f(t[1])} A${f(rx)},${f(ry)} 0 0 1 ${f(t[0]-rx)},${f(t[1])} Z" fill="url(#${id})" stroke="${edge}" stroke-width="1"/>`;
    else s+=`<ellipse cx="${f(t[0])}" cy="${f(t[1])}" rx="${f(rx)}" ry="${f(ry)}" fill="${RalColor.shade(c, 1.1)}" stroke="${edge}" stroke-width="1"/>`;
    return s;
  }
  /** горизонтальный цилиндр вдоль x */
  hcyl(x0, x1, cy, cz, r, c){
    const S=this.S, ring=x=>{ const a=[]; for (let i=0; i<40; i++){ const t=i/40*Math.PI*2; a.push(this.P(x, cy+r*Math.cos(t), cz+r*Math.sin(t))); } return a; };
    const A=ring(x0), B=ring(x1), hull=StView.hull([...A, ...B]), id='g'+(++this.gid), p=this.P(x0, cy, cz+r), q=this.P(x0, cy, cz-r);
    this.defs.push(`<linearGradient id="${id}" x1="${S.f(p[0])}" y1="${S.f(p[1])}" x2="${S.f(q[0])}" y2="${S.f(q[1])}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${RalColor.shade(c, 1.12)}"/><stop offset="1" stop-color="${RalColor.shade(c, 0.62)}"/></linearGradient>`);
    return S.poly(hull, `url(#${id})`, RalColor.shade(c, 0.55), 1)+S.poly(A, RalColor.shade(c, 0.85), RalColor.shade(c, 0.55), 1);
  }
  static hull(P){
    const p=P.slice().sort((a, b)=>a[0]-b[0] || a[1]-b[1]), cr=(o, a, b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]), lo=[], up=[];
    for (const q of p){ while (lo.length>=2 && cr(lo[lo.length-2], lo[lo.length-1], q)<=0) lo.pop(); lo.push(q); }
    for (const q of p.reverse()){ while (up.length>=2 && cr(up[up.length-2], up[up.length-1], q)<=0) up.pop(); up.push(q); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  /** шасси: рама, оси с колёсами, дышло */
  chassis(Le, We, dz){
    const out=[], dark='#33383e', axes=Le<=7000 ? [0.62, 0.78] : [0.66, 0.76, 0.86];
    out.push(...this.box(150, We*0.15, dz-260, Le-150, We*0.3, dz, dark), ...this.box(150, We*0.7, dz-260, Le-150, We*0.85, dz, dark));
    for (const k of axes){ const x=Le*k;
      for (const y of [We-260, 40]){ const id='w'+(++this.gid), c=this.P(x, y, 430), rr=430*this.k;
        this.defs.push(`<radialGradient id="${id}"><stop offset="0.5" stop-color="#8c9298"/><stop offset="0.56" stop-color="#202326"/><stop offset="1" stop-color="#2b2e31"/></radialGradient>`);
        out.push(`<ellipse cx="${this.S.f(c[0])}" cy="${this.S.f(c[1])}" rx="${this.S.f(rr*0.62)}" ry="${this.S.f(rr)}" fill="url(#${id})" transform="rotate(${this.S.f(-12)} ${this.S.f(c[0])} ${this.S.f(c[1])})"/>`); } }
    out.push(...this.box(Le*0.2, We*0.18, 0, Le*0.2+120, We*0.18+120, dz-260, dark), ...this.box(Le*0.2, We*0.7, 0, Le*0.2+120, We*0.7+120, dz-260, dark));
    return out;
  }
  /** порядок отрисовки: из пары разнесённых только по одной оси сначала дальняя (больше y или x) */
  order(items){
    const n=items.length, nxt=items.map(()=>[]), indeg=new Array(n).fill(0), dep=i=>(items[i].X0+items[i].X1)/2*0.5+(items[i].Y0+items[i].Y1)/2*0.866;
    for (let i=0; i<n; i++) for (let j=i+1; j<n; j++){ const A=items[i], B=items[j];
      const sx=A.X1<=B.X0+1 || B.X1<=A.X0+1, sy=A.Y1<=B.Y0+1 || B.Y1<=A.Y0+1; let far=-1;
      if (sy && !sx) far=A.Y0>=B.Y1-1 ? i : j; else if (sx && !sy) far=A.X0>=B.X1-1 ? i : j; else if (!sx && !sy) far=dep(i)>=dep(j) ? i : j;
      if (far<0) continue; const near=far===i ? j : i; nxt[far].push(near); indeg[near]++; }
    const out=[], ready=[...Array(n).keys()].filter(i=>!indeg[i]);
    while (ready.length){ ready.sort((a, b)=>dep(b)-dep(a)); const i=ready.shift(); out.push(items[i]); for (const j of nxt[i]) if (!--indeg[j]) ready.push(j); }
    if (out.length<n) for (const it of items) if (!out.includes(it)) out.push(it);
    return out;
  }
}
