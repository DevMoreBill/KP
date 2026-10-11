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
  static svg(plan, meta={}){ return new StationDrawing(plan, meta).draw(); }

  constructor(plan, meta){
    const g=plan.geo; this.p=plan; this.m=meta||{}; this.g=g;
    [this.Le, this.We, this.He]=g.ext; [this.Li, this.Wi, this.Hi]=plan.int;
    this.ox=(this.Le-this.Li)/2; this.oy=(this.We-this.Wi)/2; this.zf=StationGeo.zFloor(g.type, g.t);
    this.dz=plan.chassis ? (this.m.deck||1150) : 0;
    this.rf=plan.roof||[]; this.up=this.rf.length ? Math.max(...this.rf.map(m=>m.gap+m.d+m.outlet)) : 0;
    this.pipes=plan.piping||[]; this.lines=this.pipes.length ? this.pipes[0].lines : [];
    const sd=plan.door==='service' ? plan.doors||[] : [], leaf=D=>D.length ? Math.max(...D.map(d=>d.w/d.leaves)) : 0;
    this.sdF=sd.filter(d=>d.wall!=='back'); this.sdB=sd.filter(d=>d.wall==='back');
    this.swing=plan.door==='side' ? StationLayout.ENTRY[1]-StationLayout.ENTRY[0] : leaf(this.sdF); this.swingB=leaf(this.sdB);
    this.ai=sd.length ? null : StationDrawing.aisle(plan, this.Wi);
    this.hidden=plan.items.filter(i=>i.mount==='wall' && i.wall==='front');           // на стене прохода — на разрезе А–А не видны
    this.outs=this.lines.filter(l=>l.label && l.x1>=this.Li-1).map(l=>({ y:l.y, z:l.z })).sort((a, b)=>a.z-b.z);
    this.fit=g.sea && StationDrawing.FIT[this.Le] ? [StationDrawing.FIT[this.Le], StationDrawing.FIT_W] : null;
    // номера позиций — на плане (виден весь состав, глушитель на крыше — штриховой), каждый номер один раз
    const first=new Map(); for (const it of [...plan.items].sort((a, b)=>a.x-b.x)) if (!first.has(it.pos)) first.set(it.pos, it);
    this.posPlan=[...first.values()];
    this.posRoof=this.rf.filter((m, k, A)=>A.findIndex(q=>q.pos===m.pos)===k && !first.has(m.pos));
    this.pipePos=this.pipes.find(q=>q.pos!=null && !first.has(q.pos)) || null;
    this.nPos=this.posPlan.length+this.posRoof.length+(this.pipePos ? 1 : 0);
  }

  // ---- текстовая часть
  /** перечень составных частей: позиция, наименование, количество, масса */
  rows(){
    const by=new Map();
    for (const it of [...this.p.items, ...this.rf]){ const e=by.get(it.pos); if (e) e.n++; else by.set(it.pos, { pos:it.pos, name:it.brief||it.name, n:1, mass:it.mass }); }
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
    const all=[...I, ...this.rf], mass=all.every(i=>i.mass>0) ? all.reduce((s, i)=>s+i.mass, 0) : 0;
    if (mass) out.push(`Масса оборудования — ${n(mass)} кг`);
    out.push(`Внутри — ${n(this.Li)} × ${n(this.Wi)} × ${n(this.Hi)} мм`);
    if (this.g.t) out.push(`Утепление стен — ${n(this.g.t)} мм`);
    const col=String(this.m.colorText||'').replace(/^цвет\s+/i, ''); if (col) out.push(`Окраска — ${col}`);
    return out;
  }
  /** технические требования: коротко, номерами пунктов */
  reqs(){
    const p=this.p, n=StationLayout.n, [aRec, aMin]=p.aisleRule||[1000, 800], dgu=p.items.some(i=>i.kind==='dgu');
    const P=f=>[...new Set(p.items.filter(f).map(i=>i.pos))].sort((a, b)=>a-b), list=a=>'поз. '+a.join(', ');
    const wall=P(i=>i.mount==='wall'), frame=P(i=>i.mount==='frame'), hang=P(i=>i.mount==='pipe');
    const zw=p.items.filter(i=>i.mount==='wall').map(i=>i.z), z0=zw.length ? Math.min(...zw) : 0, two=this.sdB.length && this.sdF.length;
    const sys=(p.extra||[]).filter(e=>e.kind==='skip' && !e.nodims).map(e=>String(e.name||'').trim().replace(/^./, c=>c.toLowerCase())).filter(Boolean);
    const chain=p.air && p.air.chain.length>1 ? p.air.chain.map(c=>c.pos).filter((v, i, A)=>!i || A[i-1]!==v) : [];
    return [
      'Размеры, привязки и трассы уточняются рабочим проектом.',
      p.door==='service' ? `Прохода внутри нет — обслуживание снаружи через сервисные двери${two ? ' в обеих стенах' : ''}; у дверей — свободная зона не менее 1,5 м.`
        : `Проход обслуживания — не менее ${n(aMin)} мм в свету (ПУЭ, п. 4.1.23), рекомендуется ${n(aRec)} мм${dgu ? '; вдоль ДГУ — не менее 600 мм' : ''}.`,
      wall.length ? `${wall.length>1 ? 'Шкафы' : 'Шкаф'} ${list(wall)} — на стене, низ на высоте ${n(z0)} мм; проход перед ${wall.length>1 ? 'ними' : 'ним'} — не менее ${n(aMin)} мм.` : '',
      frame.length ? `${frame.length>1 ? 'Шкафы' : 'Шкаф'} ${list(frame)} — на раме за сервисной дверью.` : '',
      chain.length ? `Сжатый воздух — последовательно: поз. ${chain.join(' → ')} → к потребителю${hang.length ? `; фильтры ${list(hang)} — на трубопроводе` : ''}.` : hang.length ? `Фильтры ${list(hang)} — на трубопроводе.` : '',
      p.door==='side' ? `Входная дверь ${n(StationLayout.ENTRY[1]-StationLayout.ENTRY[0])} мм (не менее ${n(StationLayout.DOOR_MIN)} мм в свету) открывается наружу.` : '',
      this.up ? `Глушитель ${list([...new Set(this.rf.map(m=>m.pos))])} — на крыше над ДГУ; при перевозке снимается.` : '',
      sys.length ? `Не показаны: ${StationDrawing.cut(sys.join(', '), 150)}.` : '',
    ].filter(Boolean);
  }
  static cut(s, n){ s=String(s||''); return s.length>n ? s.slice(0, n-1).replace(/\s+\S*$/, '')+'…' : s; }

  // ---- компоновка листа
  /** размеры блоков видов при масштабе k (мм листа на мм) — для выбора масштаба; end — с видом слева, col — номера
   *  позиций колонкой справа от плана (иначе строкой под ним) */
  box(k, end, col){
    const nOut=this.outs.length, nDim=nOut+1+(this.up ? 1 : 0)+(this.dz ? 1 : 0), dimsR=16+7*(nDim-1)+2, endW=end ? 10+this.We*k : 0;
    const nY=new Set(this.outs.map(o=>o.y)).size, left=19+(this.fit ? 7 : 0), outR=(nY ? 14+7*(nY-1)+2 : 8)+(col ? 17 : 0);
    const top=this.chainTop(k), mainH=this.head()+(this.He+this.up+this.dz)*k;
    const planH=6+top+this.swingB*k+this.We*k+this.swing*k+(col ? 0 : 11)+10+(this.fit ? 7 : 0);
    return { w:left+this.Le*k+Math.max(dimsR+endW, outR), h:mainH+4+planH, left, dimsR, top };
  }

  /** высота заголовка разреза А–А: обозначение и надпись «Шкаф поз. … не показан» */
  head(){ return 8+(this.hidden.length ? 4 : 0); }

  draw(){
    const sh=new EskdSheet('A4'), C=StationDrawing, T=this.p;
    // текст над основной надписью — снизу вверх: технические требования, характеристика, перечень
    const tt=this.reqs(), tc=this.tech(), rows=this.rows(), hTT=sh.paras(0, 0, 175, tt, 2.5, false);
    const twoCol=tc.every(t=>EskdSheet.tw(t, 2.5)<=86), nTC=twoCol ? Math.ceil(tc.length/2) : tc.length, hTC=tc.length ? 5+nTC*3.8+0.8 : 0;
    const half=Math.ceil(rows.length/2), hTab=rows.length ? 5+half*4 : 0;
    const yTT=C.TB-2.5-hTT, yTTh=yTT-(tc.length ? 4.6 : 0), yTC=yTTh-hTC, yTab=yTC-(hTab ? hTab+3 : 0);
    // масштаб: наибольший, при котором виды помещаются по ширине и над перечнем
    const room=yTab-3-C.TOP, fits=(N, end, col)=>{ const k=1/N, b=this.box(k, end, col);
      if (col && this.nPos*7>b.top+this.swingB*k+this.We*k+this.swing*k+4) return null;
      return b.w<=C.L1-C.L0 && b.h<=room ? { N, k, end, col, b } : null; };
    let pick=null;
    for (const N of EskdSheet.SCALES.filter(v=>v>=10)){
      for (const [end, col] of [[true, false], [true, true], [false, false], [false, true]]) if ((pick=fits(N, end, col))) break;
      if (pick) break; }
    if (!pick){ const N=EskdSheet.SCALES[EskdSheet.SCALES.length-1]; pick={ N, k:1/N, end:false, col:false, b:this.box(1/N, false, false) }; }
    const { k, end, col, b }=pick;
    this.k=k; this.xL=C.L0+b.left; this.xR=this.xL+this.Le*k;
    // разрез А–А, справа — вид слева; под ними — разрез Б–Б (план)
    const yA=C.TOP; this.Yg=yA+this.head()+(this.He+this.up+this.dz)*k;
    this.main(sh, yA, b);
    if (end) this.end(sh, this.xR+b.dimsR+10);
    const yB=this.Yg+4; this.yPT=yB+6+b.top+this.swingB*k;
    this.plan(sh, yB, col);
    // перечень составных частей (две половины), техническая характеристика, технические требования
    if (rows.length){ const H=rows.slice(0, half), R=rows.slice(half), cols=[8, 56.5, 8, 20], head=['Поз.', 'Наименование', 'Кол.', 'Масса, кг'];
      const cell=r=>r ? [[String(r.pos), 'c'], r.name, [String(r.n), 'c'], [r.mass>0 ? StationLayout.n(r.mass) : '—', 'c']] : ['', '', '', ''];
      sh.table(20, yTab, cols, head, H.map(cell), 4, 5, 2.5);
      if (R.length) sh.table(112.5, yTab, cols, head, H.map((x, i)=>cell(R[i])), 4, 5, 2.5); }
    if (tc.length){ sh.text(112.5, yTC+3.9, 'Техническая характеристика', 3.5, { a:'middle' });
      tc.forEach((t, i)=>{ const r=twoCol ? Math.floor(i/2) : i, c=twoCol ? i%2 : 0; sh.text(25+c*90, yTC+5+(r+1)*3.8-0.6, `${i+1}. ${t}`, 2.5); });
      sh.text(112.5, yTTh+3.9, 'Технические требования', 3.5, { a:'middle' }); }
    sh.paras(25, yTT, 175, tt, 2.5);
    // рамка и основная надпись: литера «П» — техническое предложение; масштаб; один лист
    sh.frame({ name:this.m.title||'Станция в контейнере', doc:'Габаритный чертёж', code:EskdSheet.code(this.m.org, T.hash, 'ГЧ'), lit:'П', scale:EskdSheet.scale(pick.N), sheets:1, org:this.m.org, dev:this.m.dev, date:this.m.date });
    return sh.svg();
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
    if (this.g.x0) sh.line(X(ox+this.g.x0), Z(zf), X(ox+this.g.x0), Z(zf+Hi), 'main');
    const fz=i=>Z(zf+i.z), py=this.lines.length ? Math.max(...this.lines.map(l=>l.y)) : -Infinity;
    const shown=this.p.items.filter(i=>!this.hidden.includes(i)).sort((a, c)=>c.y-a.y);
    const one=it=>{ const x1=X(ox+it.x), x2=X(ox+it.x+it.lx);
      if (it.mount==='frame') for (const xx of [x1+(x2-x1)*0.12, x2-(x2-x1)*0.12]) sh.line(xx, fz(it), xx, Z(zf), 'main');   // рама до пола
      EquipIcon.front(sh, it, x1, Z(zf+it.z+it.h), x2, fz(it)); };
    for (const it of shown.filter(i=>i.y>py)) one(it);
    this.pipesMain(sh);
    for (const it of shown.filter(i=>i.y<=py)) one(it);
    // глушитель на крыше: опоры, корпус, вывод выхлопа с колпаком; выхлопная труба от ДГУ сквозь крышу
    for (const m of this.rf){ const x1=X(ox+m.x), x2=X(ox+m.x+m.lx), zb=Z(He+m.gap), zt=Z(He+m.gap+m.d), xo=x1+(x2-x1)*0.86, w=Math.max(0.8, 120*k), zo=Z(He+m.gap+m.d+m.outlet);
      if (m.exhaust){ const xe=X(ox+m.exhaust.x), pw=Math.max(0.8, 130*k); sh.rect(xe-pw/2, zb, pw, Z(zf+m.exhaust.z)-zb, 'thin', '#fff'); }
      for (const f of [0.18, 0.82]) sh.line(x1+(x2-x1)*f, Z(He), x1+(x2-x1)*f, zb, 'main');
      sh.rect(xo-w/2, zo, w, zt-zo, 'thin', '#fff'); sh.line(xo-w*1.8, zo-0.4, xo+w*1.8, zo-0.4, 'main');
      EquipIcon.hvessel(sh, x1, zt, x2, zb, false); }
    // выход трубопровода через дальний торец; линия сечения Б–Б — под потолком, взгляд вниз
    for (const o of this.outs){ sh.line(xR, Z(zf+o.z), xR+5, Z(zf+o.z), 'pipe'); sh.arrow(xR+7.6, Z(zf+o.z), 1, 0); }
    const zc=Z(zf+Hi-Math.min(120, Hi*0.05));
    this.cutMark(sh, xL-1.5, zc, -1, 'Б'); this.cutMark(sh, xR+1.5, zc, 1, 'Б');
    // размеры справа: присоединительные (высота выхода), габаритная высота, с глушителем, на шасси
    let xd=xR+16;   // правее штриха и буквы линии сечения Б–Б
    for (const o of this.outs){ sh.dimV(Z(zf+o.z), Z(0), xd, n(zf+o.z), xR+7.6, xR); xd+=7; }
    sh.dimV(Z(He), Z(0), xd, n(He), xR, xR); xd+=7;
    if (this.up){ const m=this.rf[0]; sh.dimV(Z(He+this.up), Z(0), xd, n(He+this.up), X(ox+m.x+m.lx*0.86), xR); xd+=7; }
    if (this.dz) sh.dimV(Z(He+this.up), this.Yg, xd, n(He+this.up+this.dz), null, xR);
  }
  /** трубопровод на разрезе А–А: магистрали (по ходу воздуха — стрелки), спуски к оборудованию */
  pipesMain(sh){
    const X=v=>this.X(v), Z=v=>this.Z(v), { ox, zf }=this;
    for (const l of this.lines){ const z=Z(zf+l.z);
      for (const br of l.branches) if (br.z1<l.z) sh.line(X(ox+br.x), z, X(ox+br.x), Z(zf+br.z1), 'main');
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
    const cw=Math.max(0.6, 160*k), chh=Math.max(0.6, 120*k);   // угловые фитинги / стойки
    for (const [x, y] of [[XL(We), Z(He)], [XL(0)-cw, Z(He)], [XL(We), Z(0)-chh], [XL(0)-cw, Z(0)-chh]]) sh.rect(x, y, cw, chh, 'thin');
    if (this.p.door==='end'){   // двери (ворота) в торце: две створки, запорные штанги
      const xm=(XL(We)+XL(0))/2, y1=Z(He)+chh, y2=Z(0)-chh; sh.line(xm, y1, xm, y2, 'main');
      for (const f of [0.18, 0.36, 0.64, 0.82]){ const x=XL(We)+We*k*f; sh.line(x, y1+0.6, x, y2-0.6, 'thin'); }
    } else if (!g.sea){ sh.line(XL(We)+cw*0.5, Z(He)+chh, XL(We)+cw*0.5, Z(0)-chh, 'thin'); sh.line(XL(0)-cw*0.5, Z(He)+chh, XL(0)-cw*0.5, Z(0)-chh, 'thin'); }
    for (const m of this.rf){ const xc=XL(this.oy+m.y+m.d/2), r=m.d/2*k;
      sh.line(xc, Z(He), xc, Z(He+m.gap), 'main'); sh.circle(xc, Z(He+m.gap+m.d/2), r, 'main', '#fff');
      const w=Math.max(0.8, 120*k), zo=Z(He+m.gap+m.d+m.outlet); sh.rect(xc-w/2, zo, w, m.outlet*k, 'thin', '#fff'); sh.line(xc-w*1.8, zo-0.4, xc+w*1.8, zo-0.4, 'main'); }
  }

  // ---- разрез Б–Б: план под потолком
  plan(sh, yB, col){
    const k=this.k, { ox, oy, Le, We, Li, Wi }=this, X=v=>this.X(v), yT=this.yPT, YP=y=>yT+(We-y)*k, xL=this.xL, xR=this.xR, n=StationLayout.n, g=this.g;
    sh.text((xL+xR)/2, yB+4.6, 'Б–Б', 5, { a:'middle' });
    // стены в сечении; проёмы дверей
    sh.section(xL, YP(oy), Le*k, oy*k); sh.section(xL, YP(We), Le*k, oy*k);
    sh.section(xL, YP(We-oy), ox*k, Wi*k); sh.section(X(Le-ox), YP(We-oy), ox*k, Wi*k);
    sh.rect(xL, YP(We), Le*k, We*k, 'main'); sh.rect(X(ox), YP(oy+Wi), Li*k, Wi*k, 'thin');
    if (g.x0) sh.rect(X(ox+g.x0)-Math.max(0.5, 30*k), YP(oy+Wi), Math.max(1, 60*k), (Wi-1000)*k, 'thin', '#000');
    this.doorsPlan(sh, YP);
    const ai=this.ai;
    // оборудование — по высоте: выше стоящее (шкафы, фильтры на трубе) — поверх
    const items=[...this.p.items].sort((a, c)=>(a.z+a.h)-(c.z+c.h));
    for (const it of items) EquipIcon.plan(sh, it, X(ox+it.x), YP(oy+it.y+it.ly), X(ox+it.x+it.lx), YP(oy+it.y));
    // трубопровод
    for (const l of this.lines){ const y=YP(oy+l.y);
      for (const br of l.branches) sh.line(X(ox+br.x), YP(oy+br.y0), X(ox+br.x), YP(oy+br.y1), 'main');
      for (const [a, c] of StationLayout.runs(l)){ sh.line(X(ox+a), y, X(ox+c), y, 'pipe'); if (l.medium==='air' && !l.header && (c-a)*k>9) PneuSymbol.flow(sh, X(ox+(a+c)/2), y, 1); } }
    for (const o of this.outs){ const y=YP(oy+o.y); sh.line(xR, y, xR+5, y, 'pipe'); sh.arrow(xR+7.6, y, 1, 0); }
    // глушитель на крыше — над секущей плоскостью: штриховой
    for (const m of this.rf) sh.rect(X(ox+m.x), YP(oy+m.y+m.ly), m.lx*k, m.ly*k, 'dash', 'none', m.ly*k/2);
    // угловые фитинги морского контейнера
    if (this.fit){ const [fl, fw]=this.fit, ex=(Le-fl)/2, ey=(We-fw)/2, s=Math.max(0.8, 170*k);
      for (const [x, y] of [[ex, ey], [Le-ex, ey], [ex, We-ey], [Le-ex, We-ey]]) sh.rect(X(x)-s/2, YP(y)-s/2, s, s, 'thin'); }
    // линия сечения А–А — у стены прохода, взгляд к задней стене
    const ya=YP(oy+Math.min(60, Wi*0.03));
    this.cutMarkV(sh, xL-1.5, ya, -1, 'А'); this.cutMarkV(sh, xR+1.5, ya, 1, 'А');
    // цепочка размеров у задней стены (установочные размеры оборудования)
    this.chain(sh, YP(We)-this.swingB*k-8, YP(oy+Wi));
    // габаритные, установочные (фитинги) и присоединительные (выход трубопровода) размеры
    const yb=YP(0)+this.swing*k+(col ? 0 : 11);
    let yd=yb+8; sh.dimH(xL, xR, yd, n(Le), YP(0), YP(0));
    if (this.fit){ const [fl, fw]=this.fit, ex=(Le-fl)/2, ey=(We-fw)/2; yd+=7; sh.dimH(X(ex), X(Le-ex), yd, n(fl), YP(ey), YP(ey)); }
    let xd=xL-14; sh.dimV(YP(We), YP(0), xd, n(We), xL, xL);
    if (this.fit){ const [fl, fw]=this.fit, ey=(We-fw)/2, ex=(Le-fl)/2; xd-=7; sh.dimV(YP(We-ey), YP(ey), xd, n(fw), X(ex), X(ex)); }
    if (ai) sh.dimV(YP(oy+ai.y1), YP(oy+ai.y0), X(ox+ai.xm), n(ai.w), null, null);
    const ys=[...new Set(this.outs.map(o=>o.y))].sort((a, c)=>c-a); let xo=xR+14;
    for (const y of ys){ sh.dimV(YP(We), YP(oy+y), xo, n(We-oy-y), xR, xR+7.6); xo+=7; }
    // номера позиций: строкой под планом или колонкой справа (выноски не пересекаются)
    const A=this.posPlan.map(it=>({ x:X(ox+it.x+it.lx/2), y:YP(oy+it.y+it.ly/2), n:it.pos }))
      .concat(this.posRoof.map(m=>({ x:X(ox+m.x+m.lx*0.25), y:YP(oy+m.y+m.ly/2), n:m.pos })));
    if (this.pipePos){ const l=this.lines.find(q=>!q.header) || this.lines[0], r=l ? [...StationLayout.runs(l)].sort((a, c)=>(c[1]-c[0])-(a[1]-a[0]))[0] : null;
      if (r) A.push({ x:X(ox+(r[0]+r[1])/2), y:YP(oy+l.y), n:this.pipePos.pos }); }
    const xc=(ys.length ? xo-7+5 : xR+10)+2;
    const L=col ? EskdSheet.shelves(A, 'y', yB+8, YP(0)+this.swing*k+4, xc, 7) : EskdSheet.shelves(A, 'x', StationDrawing.L0+2, StationDrawing.L1-8, YP(0)+this.swing*k+8, 9);
    for (const q of L) sh.pos(q.px, q.py, q.sx, q.sy, q.n, 1);
    // проход: надпись в свободной от выносок части
    if (ai && (ai.y1-ai.y0)*k>3.5){ const lab='Проход обслуживания', lw=EskdSheet.tw(lab, 2.5), yc=YP(oy+(ai.y0+ai.y1)/2)+1.2, xm=X(ox+ai.xm), x0=X(ox+(g.x0||0))+2, x1=xR-2;
      const hit=(a, c)=>L.some(q=>{ const t0=(yc-3-q.py)/(q.sy-q.py), t1=(yc+0.6-q.py)/(q.sy-q.py), xa=q.px+(q.sx-q.px)*Math.max(0, Math.min(1, t0)), xb=q.px+(q.sx-q.px)*Math.max(0, Math.min(1, t1));
        return Math.max(xa, xb)>a && Math.min(xa, xb)<c && Math.max(q.py, q.sy)>yc-3 && Math.min(q.py, q.sy)<yc+0.6; }) || (xm>a-4 && xm<c+4);
      for (let a=x0; a+lw<=x1; a+=1) if (!hit(a, a+lw)){ sh.text(a+lw/2, yc, lab, 2.5, { a:'middle' }); break; } }
  }
  /** двери на плане: входная в стене прохода и сервисные — проём, створка в открытом положении и дуга (крайнее положение —
   *  штрихпунктирной с двумя точками); двери (ворота) в торце — створки в проёме */
  doorsPlan(sh, YP){
    const k=this.k, X=v=>this.X(v), { ox, oy, We, Wi }=this, g=this.g, p=this.p;
    const leafSwing=(xh, xf, yw, dir)=>{ const r=Math.abs(xf-xh), ye=yw+dir*r, f=EskdSheet.f;
      sh.line(xh, yw, xh, ye, 'phantom');
      sh.path(`M${f(xh)},${f(ye)} A${f(r)},${f(r)} 0 0 ${(xf>xh)===(dir>0) ? 0 : 1} ${f(xf)},${f(yw)}`, 'phantom'); };
    const gap=(x0, x1, back)=>{ const y0=back ? YP(We) : YP(oy), h=oy*k; sh.rect(X(x0), y0, (x1-x0)*k, h, 'thin', '#fff'); sh.line(X(x0), y0, X(x0), y0+h, 'main'); sh.line(X(x1), y0, X(x1), y0+h, 'main'); };
    if (p.door==='side'){ const d0=ox+(g.x0 ? g.x0+300 : StationLayout.ENTRY[0]), d1=d0+(StationLayout.ENTRY[1]-StationLayout.ENTRY[0]);
      gap(d0, d1, false); leafSwing(X(d0), X(d1), YP(0), 1); }
    else if (p.door==='service') for (const d of p.doors||[]){ const back=d.wall==='back', lw=d.w/d.leaves;
      gap(ox+d.x0, ox+d.x1, back);
      for (let i=0; i<d.leaves; i++){ const a=ox+d.x0+i*lw, b=a+lw, left=i%2===0; leafSwing(X(left ? a : b), X(left ? b : a), back ? YP(We) : YP(0), back ? -1 : 1); } }
    else if (p.door==='end'){ const w=g.sea && g.door ? Math.min(g.door[0], Wi) : Math.min(1800, Wi-200), y0=oy+(Wi-w)/2;
      sh.rect(this.xL, YP(y0+w), ox*k, w*k, 'thin', '#fff');
      for (const [a, c] of [[y0, y0+w/2], [y0+w/2, y0+w]]) sh.rect(this.xL+ox*k*0.25, YP(c), Math.max(0.4, ox*k*0.5), (c-a)*k, 'main', '#fff'); }
  }
  /** цепочка размеров вдоль задней стены по заднему ряду: отрезки; тесным числам — место выше (до трёх строк) со сдвигом
   *  вбок, без наложений; x — середина числа от внутренней левой грани, мм листа */
  chainPlan(k){
    const x0=this.g.x0||0, row=this.p.items.filter(i=>i.row===0 && i.mount!=='pipe').sort((a, c)=>a.x-c.x); if (!row.length) return { segs:[], lift:0, tick:false };
    const pts=[x0]; for (const it of row) pts.push(it.x, it.x+it.lx); pts.push(this.Li);
    const xs=[...new Set(pts.map(v=>Math.round(v)))].filter(v=>v>=x0 && v<=this.Li).sort((a, c)=>a-c), busy=[[], [], [], []], segs=[];
    const free=(lv, x, w)=>!busy[lv].some(([p, q])=>x-w/2-1<q && x+w/2+1>p);
    for (let i=1; i<xs.length; i++){ const a=xs[i-1]*k, c=xs[i]*k, t=StationLayout.n(xs[i]-xs[i-1]), w=EskdSheet.tw(t, 3.5), m=(a+c)/2;
      let lift=0, x=m;
      if (w+1>c-a){ lift=3; const steps=[0, -1, 1, -2, 2, -3, 3, -4, 4];
        found: for (const lv of [1, 2, 3]) for (const s of steps){ const xx=m+s*(w/2+1.2); if (free(lv, xx, w)){ lift=lv; x=xx; break found; } } }
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
    const it=plan.items.filter(i=>i.mount==='floor' || i.mount==='frame'); if (!it.length || plan.door==='service') return null;
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
    const rf=plan.roof||[], up=rf.length ? Math.max(...rf.map(m=>m.gap+m.d+m.outlet)) : 0;
    const az=this.AZ*Math.PI/180, el=this.EL*Math.PI/180, cs=Math.cos(az), sn=Math.sin(az), ce=Math.cos(el), se=Math.sin(el);
    const P0=(x, y, z)=>[x*cs-y*sn, -((x*sn+y*cs)*se+z*ce)];
    // масштаб — по габаритам контейнера (с шасси и дышлом)
    const ext=[]; for (const x of [0, Le]) for (const y of [0, We]) for (const z of [0, top+up]) ext.push(P0(x, y, z));
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
    out.push(V.face([[0, oy+Wi, top], [Le, oy+Wi, top], [Le, We, top], [0, We, top]], RalColor.shade(wall, 1.08), 1));
    out.push(V.face([[ox+Li, 0, top], [Le, 0, top], [Le, We, top], [ox+Li, We, top]], RalColor.shade(wall, 1.08), 1));
    if (!g.sea) for (let x=ox+1150; x<ox+Li-100; x+=1150) out.push(V.line([x, oy+Wi-1, base], [x, oy+Wi-1, top], RalColor.shade(lining, 0.86), 1.2));
    if (g.sea) for (let x=ox+300; x<ox+Li-100; x+=560) out.push(V.face([[x, oy+Wi-1, base], [x+280, oy+Wi-1, base], [x+280, oy+Wi-1, top], [x, oy+Wi-1, top]], RalColor.shade(lining, 0.96), 0));
    out.push(...V.box(0, We-150, dz, 150, We, top, frame), ...V.box(Le-150, We-150, dz, Le, We, top, frame));
    // пол
    out.push(V.face([[ox, oy, base], [ox+Li, oy, base], [ox+Li, oy+Wi, base], [ox, oy+Wi, base]], '#b3b9bf', 1));
    for (let x=ox+1250; x<ox+Li; x+=1250) out.push(V.line([x, oy, base], [x, oy+Wi, base], '#9aa1a8', 1.2));
    // вентиляция: жалюзи в дальнем торце (у ДГУ — напротив радиатора) и воздуховоды компрессоров
    // шкафы на стене прохода — на срезанной стене: не показываются
    const items=plan.items.filter(it=>!(it.mount==='wall' && it.wall==='front')).map(it=>Object.assign({}, it, { X0:ox+it.x, Y0:oy+it.y, X1:ox+it.x+it.lx, Y1:oy+it.y+it.ly }));
    const dgu=items.find(i=>i.kind==='dgu');
    if (dgu) out.push(V.louver([ox+Li-2, dgu.Y0+dgu.ly*0.1, base+dgu.h*0.15], [ox+Li-2, dgu.Y1-dgu.ly*0.1, base+dgu.h*0.92], 'x'));
    else if (items.some(i=>i.kind==='compressor') || (plan.sys && plan.sys.vent)) out.push(V.louver([ox+Li-2, oy+Wi*0.3, base+250], [ox+Li-2, oy+Wi*0.7, base+850], 'x'));
    // трубопровод вдоль задней стены: магистраль и отводы (трубой — тёмный контур и светлый блик)
    const tube=(a, b, c, w)=>V.line(a, b, RalColor.shade(c, 0.62), w+2)+V.line(a, b, c, w)+V.line(a, b, RalColor.shade(c, 1.35), Math.max(1, w*0.3));
    // отвод со спуском на верх оборудования — сразу после этого оборудования: стоящее ближе к зрителю его закроет
    const over=new Map();
    for (const pp of plan.piping||[]){ const w=Math.max(4, 90*k);
      for (const l of pp.lines){ const y=oy+l.y, z=base+l.z;
        for (const [a, b] of StationLayout.runs(l)) out.push(tube([ox+a, y, z], [ox+b, y, z], pp.color, w));
        for (const b of l.branches){ const t=tube([ox+b.x, oy+b.y0, z], [ox+b.x, oy+b.y1, z], pp.color, w*0.8), to=items.find(i=>i.id+'#'+i.unit===b.to);
          if (b.z1<l.z) over.set(b.to, (over.get(b.to)||'')+t+tube([ox+b.x, oy+b.y1, z], [ox+b.x, oy+b.y1, base+(to ? Math.min(b.z1, this.top(to)) : b.z1)], pp.color, w*0.8));
          else out.push(t); } } }
    // оборудование: тени, затем по глубине (дальнее — раньше)
    for (const it of items.filter(i=>i.mount==='floor' || i.mount==='frame')) out.push(V.face([[it.X0+60, it.Y0+40, base+1], [it.X1+160, it.Y0+40, base+1], [it.X1+160, it.Y1+120, base+1], [it.X0+60, it.Y1+120, base+1]], '#000000', 0, ' opacity="0.16" filter="url(#blur6)"'));
    for (const it of V.order(items)){ out.push(...this.equip(V, it, base, ceil, oy+Wi)); const t=over.get(it.id+'#'+it.unit); if (t) out.push(t); }
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
      const xo=x0+m.lx*0.86; out.push(V.vcyl(xo, cy, 60, cz+r*0.7, cz+r+m.outlet, steel, false), ...V.box(xo-110, cy-110, cz+r+m.outlet, xo+110, cy+110, cz+r+m.outlet+30, '#3a3f45')); }
    const defs=`<filter id="blur6" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter><filter id="blur18" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="18"/></filter>${V.defs.join('')}`;
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
    if (plan.door==='end'){   // торцевые двери: запорные штанги
      const w=g.sea && g.door ? Math.min(g.door[0], Wi) : Math.min(1800, Wi-200), y0=oy+(Wi-w)/2;
      for (const f of [0.12, 0.38, 0.62, 0.88]) out.push(V.line([-6, y0+w*f, dz+40], [-6, y0+w*f, dz+band], '#3b4148', 2.6));
      out.push(V.line([-6, y0+w/2, dz], [-6, y0+w/2, dz+band], RalColor.shade(wall, 0.55), 1.6));
    } else if (plan.door==='service'){
      const zf=StationGeo.zFloor(g.type, g.t), dk=RalColor.shade(wall, 0.7);
      for (const d of plan.doors||[]){ const x0=ox+d.x0, x1=ox+d.x1, lw=(x1-x0)/d.leaves, zt=dz+zf+d.h;
        out.push(V.face([[x0, -3, dz+60], [x1, -3, dz+60], [x1, -3, dz+band], [x0, -3, dz+band]], RalColor.shade(wall, 0.94), 1.2));
        for (let i=0; i<d.leaves; i++){ const a=x0+lw*i;
          if (i) out.push(V.line([a, -4, dz+60], [a, -4, dz+band], dk, 1.6));
          for (let z=dz+band*0.35; z<dz+band-40; z+=70) out.push(V.line([a+lw*0.2, -4, z], [a+lw*0.8, -4, z], dk, 1.4));
          out.push(V.line([a+lw*(i%2 ? 0.12 : 0.88), -5, dz+band*0.55], [a+lw*(i%2 ? 0.12 : 0.88), -5, dz+band*0.8], '#2d3238', 3)); }
        out.push(...V.box(x0-45, -3, dz+band, x0, 60, zt, frame), ...V.box(x1, -3, dz+band, x1+45, 60, zt, frame), ...V.box(x0-45, -3, zt, x1+45, 60, zt+50, frame)); }
    } else {
      const d0=ox+(g.x0 ? g.x0+300 : 300);
      out.push(V.face([[d0, -3, dz+60], [d0+900, -3, dz+60], [d0+900, -3, dz+band], [d0, -3, dz+band]], RalColor.shade(wall, 0.93), 1.2));
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
