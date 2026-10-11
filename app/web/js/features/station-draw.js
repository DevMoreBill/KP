// Габаритный чертёж и 3D-вид станции в контейнере — строки SVG по результату StationLayout (station-layout.js).
// Без DOM: в картинки для КП их переводит station-ui.js (StationImages), node-тест проверяет, что SVG собирается.
// Чертёж — по ЕСКД (первый угол): главный вид со стороны прохода, под ним вид сверху (план), справа — вид с торца у
// двери; размеры, позиции, проход обслуживания, экспликация, примечания. 3D-вид — разрез: крыша и стенки со стороны
// зрителя срезаны, видно расставленное оборудование; цвета — из характеристик контейнера и оборудования.
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

// ---------------------------------------------------------------- габаритный чертёж
// Лист — на ширину страницы КП (около 16,5 см): 1 px листа ≈ 0,09 мм, шрифт 20–22 px ≈ 5,5–6 pt на бумаге.
class StationDrawing {
  static W = 1800;
  static HMIN = 760;         // высота листа — по содержимому (длинный контейнер — ниже лист, без пустого поля)
  static HMAX = 1700;
  static INK = '#1d2733';
  static DIM = '#24508f';
  static MUTED = '#5b6776';
  // шрифт, px листа
  static FS = { cap:17, title:34, sub:20, view:22, dim:22, chain:19, pos:20, item:18, aisle:20, leg:20, legHead:16, note:20 };
  static RW = 646;           // правая колонка: вид слева и экспликация; графы экспликации:
  static COLS = [46, 250, 46, 220, 84];

  /** plan — StationLayout.solve(...); meta: {title — название станции, cont — подпись контейнера, colorText, deck — высота шасси} */
  static svg(plan, meta={}){
    const S=StSvg, F=this.FS, g=plan.geo, [Le, We, He]=g.ext, [Li, Wi, Hi]=plan.int, ox=(Le-Li)/2, oy=(We-Wi)/2, zf=StationGeo.zFloor(g.type, g.t);
    const dz=plan.chassis ? (meta.deck||1150) : 0, INK=this.INK, W=this.W, RX=W-40-this.RW;
    // на крыше — глушитель (выше контейнера), трубопроводы, сервисные двери (створки наружу — место под планом и над ним)
    const rf=plan.roof||[], up=rf.length ? Math.max(...rf.map(m=>m.gap+m.d+m.outlet)) : 0, pipes=plan.piping||[], sd=plan.door==='service' ? plan.doors||[] : [];
    const sdF=sd.filter(d=>d.wall!=='back'), sdB=sd.filter(d=>d.wall==='back'), leaf=D=>D.length ? Math.max(...D.map(d=>d.w/d.leaves)) : 0;
    const swing=plan.door==='side' ? 900 : leaf(sdF), swingB=leaf(sdB), LX0=124, LW=RX-78-(dz ? 54 : 0)-(up ? 54 : 0)-LX0;
    const s=Math.min(LW/Le, 980/(He+up+dz+We+swing+swingB), (this.RW-90)/We);
    const yTop=146, X0=LX0+(LW-Le*s)/2, Yb=yTop+76+(He+up+dz)*s, yDimF=Yb+(dz ? 24 : 0)+48, yPlanT=yDimF+72, Y0p=yPlanT+60+(swingB+We)*s;
    const XS=RX+(this.RW-We*s-70)/2;
    const X=x=>X0+x*s, Z=z=>Yb-(dz+z)*s, YP=y=>Y0p-y*s, XL=y=>XS+(We-y)*s;
    const items=plan.items.slice(), body=[], defs=`<pattern id="hw" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#eef1f4"/><line x1="0" y1="0" x2="0" y2="8" stroke="#9aa5b1" stroke-width="1.5"/></pattern>`;
    const tint=c=>RalColor.mix(c, '#ffffff', 0.55), edge=c=>RalColor.light(c)<0.35 ? RalColor.shade(c, 0.9) : INK;
    // шапка: что за чертёж, название станции, контейнер и его размеры
    body.push(S.text(40, 50, 'ГАБАРИТНЫЙ ЧЕРТЁЖ · СХЕМА РАССТАНОВКИ ОБОРУДОВАНИЯ', { anchor:'start', size:F.cap, fill:this.DIM, weight:700, extra:' letter-spacing="1.4"' }));
    body.push(S.text(40, 92, this.cut(meta.title||'Станция в контейнере', 84), { anchor:'start', size:F.title, weight:700 }));
    const sub=[meta.colorText, g.t ? `утепление ${S.n(g.t)} мм` : '', `внутри ${S.n(Li)} × ${S.n(Wi)} × ${S.n(Hi)} мм`].filter(Boolean).join(' · ');
    body.push(S.spans(40, 128, [[`${meta.cont||'Контейнер'} · ${S.n(Le)} × ${S.n(We)} × ${S.n(He)} мм`, { weight:700 }], [sub ? ' · '+sub : '', { fill:this.MUTED }]], { anchor:'start', size:F.sub }));
    body.push(S.line(16, yTop, W-16, yTop, INK, 1.4));

    // ---- главный вид — со стороны прохода (стенка условно не показана)
    body.push(S.text(X(0), yTop+50, 'Главный вид — со стороны прохода (стенка условно не показана)', { anchor:'start', size:F.view, weight:700 }));
    if (dz) body.push(...this.chassisSide(X(0), X(Le), Z, Yb, Le, s));
    body.push(S.rect(X(0), Z(He), Le*s, He*s, '#fbfcfd', INK, 2.6));
    body.push(S.line(X(ox), Z(zf), X(ox+Li), Z(zf), INK, 1.2), S.line(X(ox), Z(zf+Hi), X(ox+Li), Z(zf+Hi), INK, 1, ' stroke-dasharray="9 5"'));
    body.push(S.line(X(ox), Z(zf), X(ox), Z(zf+Hi), INK, 1, ' stroke-dasharray="9 5"'), S.line(X(ox+Li), Z(zf), X(ox+Li), Z(zf+Hi), INK, 1, ' stroke-dasharray="9 5"'));
    if (g.x0) body.push(S.line(X(ox+g.x0), Z(zf), X(ox+g.x0), Z(zf+Hi), INK, 1.4), S.text(X(ox+g.x0/2)+6, Z(zf+Hi/2), 'тамбур', { size:F.item, fill:this.MUTED, rot:-90 }));
    // оборудование — от дальнего к ближнему; трубопровод — за ближним (линия между рядами — перед дальним рядом); шкафы на
    // стене прохода (стена условно не показана) — штрихом поверх; настенное и подвесное — на своей высоте
    const onFront=i=>i.mount==='wall' && i.wall==='front', py=pipes.length ? Math.max(...pipes.flatMap(pp=>pp.lines.map(l=>l.y))) : -Infinity;
    const elev=it=>{ const x1=X(ox+it.x), x2=X(ox+it.x+it.lx), zt=Z(zf+it.z+it.h), zb=Z(zf+it.z), col=it.row===1 ? tint(it.color) : RalColor.mix(tint(it.color), '#ffffff', it.row===0 && plan.rows===2 ? 0.35 : 0);
      if (it.mount==='frame'){ const pw=Math.max(3, 50*s); for (const xx of [x1+(x2-x1)*0.12, x2-(x2-x1)*0.12-pw]) body.push(S.rect(xx, zb, pw, Z(zf)-zb, '#3a3f45')); }   // рама до пола
      if (it.mount==='pipe') body.push(S.rect(x1, zt, x2-x1, zb-zt, col, edge(it.color), 1.6, ` rx="${S.f(Math.min(8, (x2-x1)/3))}"`), S.rect(x1-2, zt, x2-x1+4, Math.min(zb-zt, Math.max(6, 0.16*(zb-zt))), RalColor.shade(it.color, 0.8), edge(it.color), 1.2));
      else if (it.shape==='vcyl') body.push(this.dome(x1, x2, zt, zb, col, edge(it.color), 1.6));
      else body.push(S.rect(x1, zt, x2-x1, zb-zt, col, edge(it.color), 1.6, it.shape==='hcyl' ? ` rx="${S.f(Math.min(16, (zb-zt)/2))}"` : '')); };
    const shown=items.filter(i=>!onFront(i)).sort((a, b)=>b.y-a.y), labs=[];
    for (const it of shown.filter(i=>i.y>py)) elev(it);
    for (const pp of pipes) for (const l of pp.lines){ const z=Z(zf+l.z);
      for (const b of l.branches) if (b.z1<l.z) body.push(S.line(X(ox+b.x), z, X(ox+b.x), Z(zf+b.z1), pp.color, 4));   // спуск к оборудованию
      body.push(S.line(X(ox+l.x0), z, X(ox+l.x1), z, pp.color, 5, ' stroke-linecap="round"'));
      if (l.label){ body.push(this.arrow(X(ox+l.x1), z, X(Le)+14, pp.color)); labs.push([X(ox+l.x1)-10, z-10, l.label]); } }
    for (const it of shown.filter(i=>i.y<=py)) elev(it);
    for (const it of items.filter(onFront)) body.push(S.rect(X(ox+it.x), Z(zf+it.z+it.h), it.lx*s, it.h*s, 'none', this.MUTED, 1.4, ' stroke-dasharray="8 5"'));
    const bub=[];
    for (const it of items){ let x=X(ox+it.x+it.lx/2), y=Z(zf+it.z+it.h)-24;
      for (let k=0; k<6 && bub.some(([bx, by])=>Math.hypot(bx-x, by-y)<36); k++) if (k<3) x+=37; else { x-=111; y-=37; }
      bub.push([x, y]); }
    for (const [k, it] of items.entries()) this.pos(body, bub[k][0], bub[k][1], it.pos);
    // глушитель на крыше: опоры, корпус, вывод выхлопа с колпаком; выхлопная труба — от ДГУ сквозь крышу
    for (const m of rf){ const x1=X(ox+m.x), x2=X(ox+m.x+m.lx), zb=Z(He+m.gap), zt=Z(He+m.gap+m.d), w=Math.max(4, 120*s), xo=x1+(x2-x1)*0.86, zo=Z(He+m.gap+m.d+m.outlet);
      if (m.exhaust){ const xe=X(ox+m.exhaust.x), pw=Math.max(3, 130*s); body.push(S.rect(xe-pw/2, zb, pw, Z(zf+m.exhaust.z)-zb, '#9aa1a8', INK, 1)); }
      for (const f of [0.18, 0.82]) body.push(S.line(x1+(x2-x1)*f, Z(He), x1+(x2-x1)*f, zb, INK, 1.8));
      body.push(S.rect(xo-w/2, zo, w, zt-zo, '#8a9097', INK, 1.2), S.rect(xo-w*1.7, zo-4, w*3.4, 5, INK));
      body.push(S.rect(x1, zt, x2-x1, zb-zt, tint(m.color), edge(m.color), 1.6, ` rx="${S.f(Math.min(14, (zb-zt)/2))}"`));
      this.pos(body, x1+Math.min(40, (x2-x1)/4), zt-24, m.pos); bub.push([x1+Math.min(40, (x2-x1)/4), zt-24]); }
    // подпись линии у выхода — если не на номере позиции и не на фильтре у торца (иначе — только стрелка; на плане подписано)
    const hang=items.filter(i=>i.mount==='pipe').map(i=>[X(ox+i.x)-4, Z(zf+i.z+i.h)-4, X(ox+i.x+i.lx)+4, Z(zf+i.z)+4]);
    for (const [x, y, t] of labs){ const b=[x-S.tw(t, F.item), y-F.item, x, y+4];
      if (bub.some(([bx, by])=>bx>b[0]-18 && bx<b[2]+18 && by>b[1]-18 && by<b[3]+18) || hang.some(r=>r[0]<b[2] && r[2]>b[0] && r[1]<b[3] && r[3]>b[1])) continue;
      body.push(S.text(x, y, t, { anchor:'end', size:F.item, fill:this.MUTED })); }
    // сервисные двери в стене прохода (стена условно не показана); в задней стене — на плане
    sdF.forEach((d, k)=>{ const xa=X(ox+d.x0), xb=X(ox+d.x1), zt=Z(zf+d.h);
      body.push(S.rect(xa, zt, xb-xa, Z(zf)-zt, 'none', this.MUTED, 1.2, ' stroke-dasharray="7 5"'));
      for (let i=1; i<d.leaves; i++) body.push(S.line(xa+(xb-xa)*i/d.leaves, zt, xa+(xb-xa)*i/d.leaves, Z(zf), this.MUTED, 1, ' stroke-dasharray="4 4"'));
      const lt='сервисная дверь', lx=(xa+xb)/2, lw=S.tw(lt, F.item)/2+6;
      if (!k && lw*2<xb-xa+80 && !bub.some(([bx, by])=>Math.abs(bx-lx)<lw+18 && Math.abs(by-(zt-14))<30)) body.push(S.text(lx, zt-8, lt, { size:F.item, fill:this.MUTED })); });
    if (plan.door==='side'){ const d0=ox+(g.x0 ? g.x0+300 : 300), lx=X(d0+450), ly=Z(zf+2000)-8, lw=S.tw('дверь', F.item)/2+6;
      body.push(S.rect(X(d0), Z(zf+2000), 900*s, 2000*s, 'none', this.MUTED, 1.2, ' stroke-dasharray="7 5"'));
      if (!bub.some(([bx, by])=>Math.abs(bx-lx)<lw+18 && Math.abs(by-(ly-6))<30)) body.push(S.text(lx, ly, 'дверь', { size:F.item, fill:this.MUTED })); }
    this.dimH(body, X(0), X(Le), yDimF, S.n(Le), Z(0));
    this.dimV(body, X(Le)+52, Z(He), Z(0), S.n(He));
    if (dz) this.dimV(body, X(Le)+106, Z(He), Yb, S.n(He+dz)+' (на шасси)');
    if (up) this.dimV(body, X(Le)+(dz ? 160 : 106), Z(He+up), Yb, S.n(He+up+dz)+' (с глушителем)');
    this.dimV(body, X(0)-44, Z(zf+Hi), Z(zf), S.n(Hi), { left:true });

    // ---- вид сверху (план)
    body.push(S.text(X(0), yPlanT, 'Вид сверху (план)', { anchor:'start', size:F.view, weight:700 }));
    body.push(S.rect(X(0), YP(We), Le*s, We*s, 'url(#hw)', INK, 2.6), S.rect(X(ox), YP(oy+Wi), Li*s, Wi*s, '#ffffff', INK, 1.4));
    if (g.x0) body.push(S.rect(X(ox+g.x0)-3, YP(oy+Wi), 6, (Wi-1000)*s, INK), S.text(X(ox+g.x0/2)+6, YP(oy+Wi/2), 'тамбур', { size:F.item, fill:this.MUTED, rot:-90 }));
    const ai=sd.length ? null : this.aisle(plan, Wi);
    if (ai){ const xa=X(ox+(g.x0||0)), xb=X(ox+Li);
      body.push(S.rect(xa, YP(oy+ai.y1), xb-xa, (ai.y1-ai.y0)*s, '#e6f0fb', '#6f9fd8', 1.4, ' stroke-dasharray="11 6"'));
      // подпись — посередине свободной части прохода, не на размерной линии его ширины
      const lab=`Проход обслуживания ${S.n(ai.w)} мм${ai.dgu ? ' (вдоль ДГУ)' : ''}`, lw=S.tw(lab, F.aisle), xm=X(ox+ai.xm);
      const free=[[xa+10, xm-44], [xm+18, xb-10]].filter(([a, b])=>b-a>lw+16).sort((p, q)=>(q[1]-q[0])-(p[1]-p[0]))[0];
      if (free && (ai.y1-ai.y0)*s>30) body.push(S.text((free[0]+free[1])/2, YP(oy+(ai.y0+ai.y1)/2)+7, lab, { size:F.aisle, fill:'#2c5d99' })); }
    this.doors(body, plan, X, YP, ox, oy, Li, Wi, s);
    // подпись дверей — под размером длины (не на нём)
    const yDimP=YP(0)+swing*s+46, yDoorL=sd.length ? yDimP+30 : yDimP;
    if (sd.length) body.push(S.text(X(0)+2, yDoorL, sdB.length && sdF.length ? 'сервисные двери в обеих стенах — створки наружу' : 'сервисные двери — створки наружу', { anchor:'start', size:F.item, fill:this.MUTED }));
    // номера позиций (pb) — после трубопровода, поверх него: линия не перечёркивает цифры (фильтры стоят на трубе)
    const pb=[];
    for (const it of items){ const x1=X(ox+it.x), y1=YP(oy+it.y+it.ly), w=it.lx*s, h=it.ly*s, col=tint(it.color), dash=it.mount==='wall' || it.mount==='pipe' ? ' stroke-dasharray="7 4"' : '';   // над полом — штрихом
      if (it.shape==='vcyl') body.push(S.circle(x1+w/2, y1+h/2, Math.min(w, h)/2, col, edge(it.color), 1.6, dash));
      else body.push(S.rect(x1, y1, w, h, col, edge(it.color), 1.6, (it.shape==='hcyl' ? ` rx="${S.f(h/2)}"` : '')+dash));
      if (it.kind==='dgu') body.push(S.line(x1+w*0.86, y1+3, x1+w*0.86, y1+h-3, edge(it.color), 1, ' stroke-dasharray="6 4"'));
      const lab=it.short; if (h>=86 && S.tw(lab, F.item)<w-10) body.push(S.text(x1+w/2, y1+h/2+36, lab, { size:F.item, fill:this.MUTED }));
      pb.push([x1+w/2, y1+h/2, it.pos]);
    }
    // глушитель на крыше — штрихом над оборудованием
    for (const m of rf){ const x1=X(ox+m.x), y1=YP(oy+m.y+m.ly), w=m.lx*s, h=m.ly*s;
      body.push(S.rect(x1, y1, w, h, 'none', edge(m.color), 1.6, ` stroke-dasharray="9 5" rx="${S.f(h/2)}"`));
      const tl=S.tw('глушитель на крыше', F.item)/2, tx=x1+w/2-10, ty=y1+h/2+6;   // подпись — если не ложится на номера и подписи под ним
      if (tl*2<w-60 && !pb.some(([bx, by])=>Math.abs(bx-tx)<tl+20 && Math.abs(by-ty)<52)) body.push(S.text(tx, ty, 'глушитель на крыше', { size:F.item, fill:this.MUTED }));
      pb.push([x1+w-22, y1+h/2, m.pos]); }
    // трубопровод (вид сверху): магистраль у задней стены, отводы к оборудованию, выход через дальний торец
    for (const pp of pipes){ let lab=null;
      for (const l of pp.lines){ const y=YP(oy+l.y), xa=X(ox+l.x0), xb=X(ox+l.x1);
        for (const b of l.branches) body.push(S.line(X(ox+b.x), YP(oy+b.y0), X(ox+b.x), YP(oy+b.y1), pp.color, 3));
        body.push(S.line(xa, y, xb, y, pp.color, 4.5, ' stroke-linecap="round"'));
        if (l.label){ body.push(this.arrow(xb, y, X(Le)+16, pp.color), S.text(X(Le)+20, y+6, l.label, { anchor:'start', size:F.item, fill:this.MUTED })); }
        for (let x=xb-24; !lab && x>xa+12; x-=12) if (pb.every(([bx, by])=>Math.hypot(bx-x, by-y)>=40)) lab=[x, y]; }
      if (lab && pp.pos!=null) pb.push([lab[0], lab[1], pp.pos]); }
    for (const [x, y, n] of pb) this.pos(body, x, y, n);
    this.chain(body, plan, X, YP(We)-18-swingB*s, ox, Li, g.x0||0, YP(oy+Wi));
    this.dimH(body, X(0), X(Le), yDimP, S.n(Le), YP(0));
    this.dimV(body, X(0)-44, YP(We), YP(0), S.n(We), { left:true });
    if (ai) this.dimV(body, X(ox+ai.xm), YP(oy+ai.y1), YP(oy+ai.y0), S.n(ai.w), { inside:true });

    // ---- вид слева — с торца у двери
    body.push(S.text(XS, yTop+50, 'Вид слева — с торца у двери', { anchor:'start', size:F.view, weight:700 }));
    if (dz) body.push(...this.chassisEnd(XL(We), XL(0), Z, Yb, s));
    body.push(S.rect(XL(We), Z(He), We*s, He*s, '#fbfcfd', INK, 2.6), S.rect(XL(oy+Wi), Z(zf+Hi), Wi*s, Hi*s, 'none', INK, 1, ' stroke-dasharray="9 5"'));
    for (const it of [...items].sort((a, b)=>b.x-a.x)){ const xa=XL(oy+it.y+it.ly), xb=XL(oy+it.y), col=tint(it.color), zt=Z(zf+it.z+it.h), zb=Z(zf+it.z);
      if (it.mount==='frame'){ const pw=Math.max(3, 50*s); body.push(S.rect(xa+(xb-xa)*0.3, zb, pw, Z(zf)-zb, '#3a3f45')); }
      if (it.shape==='vcyl' && it.mount!=='pipe') body.push(this.dome(xa, xb, zt, zb, col, edge(it.color), 1.4));
      else body.push(S.rect(xa, zt, xb-xa, zb-zt, col, edge(it.color), 1.4, it.mount==='pipe' ? ` rx="${S.f(Math.min(8, (xb-xa)/3))}"` : '')); }
    if (g.sea) body.push(S.rect(XL(oy+Wi), Z(zf+(g.door ? g.door[1] : 2280)), Wi*s, (g.door ? g.door[1] : 2280)*s, 'none', this.MUTED, 1.2, ' stroke-dasharray="7 5"'));
    for (const pp of pipes) for (const l of pp.lines) body.push(S.circle(XL(oy+l.y), Z(zf+l.z), 5, pp.color, INK, 1));
    for (const m of rf){ const xc=XL(oy+m.y+m.d/2); body.push(S.line(xc, Z(He), xc, Z(He+m.gap), INK, 1.8), S.circle(xc, Z(He+m.gap+m.d/2), m.d/2*s, tint(m.color), edge(m.color), 1.4),
      S.rect(xc-Math.max(2, 60*s), Z(He+m.gap+m.d+m.outlet), Math.max(4, 120*s), m.outlet*s, '#8a9097', INK, 1)); }
    this.dimH(body, XL(We), XL(0), yDimF, S.n(We), Z(0));
    this.dimV(body, XL(0)+52, Z(He), Z(0), S.n(He));

    // ---- экспликация и примечания; лист — по высоте содержимого
    const yLeg=this.legend(body, plan, RX, yPlanT, this.RW, this.HMAX-yPlanT-190);
    const yN=Math.max(yDoorL+34, yLeg+16)+48, nN=this.notes(body, plan, 40, yN, W-80);
    const H=Math.round(Math.max(this.HMIN, Math.min(this.HMAX, yN+30+27*(nN-1)+44)));
    body.unshift(S.rect(0, 0, W, H, '#ffffff'), S.rect(16, 16, W-32, H-32, 'none', INK, 2.2));
    return S.doc(W, H, body.join(''), defs);
  }

  /** стрелка трубопровода через стену: от x1 до x2 на высоте y */
  static arrow(x1, y, x2, color){
    const S=StSvg, d=x2>x1 ? 1 : -1;
    return S.line(x1, y, x2-d*10, y, color, 4)+S.poly([[x2, y], [x2-d*14, y-7], [x2-d*14, y+7]], color);
  }
  static cut(s, n){ s=String(s||''); return s.length>n ? s.slice(0, n-1).replace(/\s+\S*$/, '')+'…' : s; }
  static pos(body, x, y, n){ body.push(StSvg.circle(x, y, 17, '#ffffff', this.INK, 1.6), StSvg.text(x, y+7, n, { size:this.FS.pos, weight:700 })); }
  /** вертикальный цилиндр сбоку: прямоугольник со скруглённым верхом (днище) */
  static dome(x1, x2, zt, zb, fill, stroke, sw){
    const S=StSvg, r=Math.min((x2-x1)/2, 14);
    return `<path d="M${S.f(x1)},${S.f(zb)} L${S.f(x1)},${S.f(zt+r)} Q${S.f(x1)},${S.f(zt)} ${S.f(x1+r)},${S.f(zt)} L${S.f(x2-r)},${S.f(zt)} Q${S.f(x2)},${S.f(zt)} ${S.f(x2)},${S.f(zt+r)} L${S.f(x2)},${S.f(zb)} Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
  }

  /** проход: [y0, y1] поперёк контейнера, ширина в самом узком месте и где мерить */
  static aisle(plan, Wi){
    const it=plan.items.filter(i=>i.mount==='floor' || i.mount==='frame'); if (!it.length || plan.door==='service') return null;
    if (plan.rows===2){ const A=it.filter(i=>i.row===1), B=it.filter(i=>i.row===0); if (!A.length || !B.length) return null;
      const y0=Math.max(...A.map(i=>i.y+i.ly)), y1=Math.min(...B.map(i=>i.y)); const m=B.find(i=>i.y===y1); return { y0, y1, w:y1-y0, xm:m.x+m.lx/2 }; }
    const y1=Math.min(...it.map(i=>i.y)), m=it.find(i=>i.y===y1); return { y0:0, y1, w:y1, xm:m.x+m.lx/2, dgu:m.kind==='dgu' };
  }

  /** двери на плане: распашные торцевые (морской контейнер) или дверь в стене прохода */
  static doors(body, plan, X, YP, ox, oy, Li, Wi, s){
    const S=StSvg, g=plan.geo, INK=this.INK, We=Wi+2*oy;
    if (plan.door==='end'){
      const w=g.sea && g.door ? Math.min(g.door[0], Wi) : Math.min(1800, Wi-200), y0=oy+(Wi-w)/2, y1=y0+w;
      body.push(S.rect(X(0)-1, YP(y1), ox*s+2, w*s, '#ffffff'));
      body.push(S.rect(X(0)+1, YP(y1), Math.max(3, ox*s*0.45), (w/2)*s-1.5, '#dfe5ec', INK, 1.4), S.rect(X(0)+1, YP(y0+w/2)+1.5, Math.max(3, ox*s*0.45), (w/2)*s-1.5, '#dfe5ec', INK, 1.4));
      body.push(S.text(X(0)-12, YP(oy+Wi/2), `${g.sea ? 'двери' : 'ворота'} ${S.n(w)}`, { size:this.FS.item, fill:this.MUTED, rot:-90 }));
    } else if (plan.door==='service'){   // в стене прохода — створки вниз, в задней стене — вверх (наружу)
      for (const d of plan.doors||[]){ const lw=d.w/d.leaves, back=d.wall==='back', yw=back ? YP(We) : YP(0), k=back ? -1 : 1;
        body.push(S.rect(X(ox+d.x0), back ? YP(We)-1 : YP(oy)-1, d.w*s, oy*s+2, '#ffffff'));
        for (let i=0; i<d.leaves; i++){ const a=ox+d.x0+i*lw, b=a+lw, left=i%2===0, hx=left ? a : b, fx=left ? b : a, ye=yw+k*lw*s;
          body.push(S.line(X(hx), yw, X(hx), ye, INK, 2), `<path d="M${S.f(X(hx))},${S.f(ye)} A${S.f(lw*s)},${S.f(lw*s)} 0 0 ${(left ? 0 : 1)^(back ? 1 : 0)} ${S.f(X(fx))},${S.f(yw)}" fill="none" stroke="${INK}" stroke-width="1" stroke-dasharray="6 5"/>`); } }
    } else {
      const d0=ox+(g.x0 ? g.x0+300 : 300), d1=d0+900;
      body.push(S.rect(X(d0), YP(oy)-1, (d1-d0)*s, oy*s+2, '#ffffff'));
      body.push(S.line(X(d0), YP(0), X(d0), YP(0)+900*s, INK, 2.2), `<path d="M${S.f(X(d0))},${S.f(YP(0)+900*s)} A${S.f(900*s)},${S.f(900*s)} 0 0 0 ${S.f(X(d1))},${S.f(YP(0))}" fill="none" stroke="${INK}" stroke-width="1" stroke-dasharray="6 5"/>`);
    }
  }

  /** цепочка размеров вдоль задней стены: промежутки и длины оборудования */
  static chain(body, plan, X, y, ox, Li, x0, from){
    const S=StSvg, row=plan.items.filter(i=>i.row===0 && i.mount!=='pipe').sort((a, b)=>a.x-b.x); if (!row.length) return;
    const pts=[x0]; for (const it of row) pts.push(it.x, it.x+it.lx); pts.push(Li);
    const xs=[...new Set(pts.map(v=>Math.round(v)))].sort((a, b)=>a-b);
    body.push(S.line(X(ox+xs[0]), y, X(ox+xs[xs.length-1]), y, this.DIM, 1.2));
    xs.forEach(v=>body.push(S.line(X(ox+v)-5, y+5, X(ox+v)+5, y-5, this.DIM, 2), S.line(X(ox+v), y-12, X(ox+v), from!=null ? from : y+8, this.DIM, 0.8, ' stroke-dasharray="3 4"')));
    for (let i=1; i<xs.length; i++){ const a=X(ox+xs[i-1]), b=X(ox+xs[i]), t=S.n(xs[i]-xs[i-1]);
      if (S.tw(t, this.FS.chain)<b-a-6) body.push(S.text((a+b)/2, y-8, t, { size:this.FS.chain, fill:this.DIM })); }
  }

  static dimH(body, x1, x2, y, t, from){
    const S=StSvg, C=this.DIM;
    if (from!=null) body.push(S.line(x1, from, x1, y+8, C, 1), S.line(x2, from, x2, y+8, C, 1));
    body.push(S.line(x1, y, x2, y, C, 1.3), S.poly([[x1, y], [x1+16, y-5], [x1+16, y+5]], C), S.poly([[x2, y], [x2-16, y-5], [x2-16, y+5]], C));
    body.push(S.text((x1+x2)/2, y-9, t, { size:this.FS.dim, fill:C, weight:600 }));
  }
  static dimV(body, x, y1, y2, t, o={}){
    const S=StSvg, C=this.DIM, top=Math.min(y1, y2), bot=Math.max(y1, y2), fs=this.FS.dim-1;
    body.push(S.line(x, top, x, bot, C, 1.3), S.poly([[x, top], [x-5, top+16], [x+5, top+16]], C), S.poly([[x, bot], [x-5, bot-16], [x+5, bot-16]], C));
    if (bot-top>S.tw(t, fs)+18 || !o.inside) body.push(S.text(x+(o.left || o.inside ? -9 : 25), (top+bot)/2, t, { size:fs, fill:C, weight:600, rot:-90 }));
  }

  static chassisSide(xa, xb, Z, Yb, Le, s){
    const S=StSvg, out=[], frame=Z(0)+0, beam=200*s;
    out.push(S.rect(xa+40*s, frame, (xb-xa)-80*s, beam, '#3a3f45'));
    const ax=Le<=7000 ? [0.62, 0.78] : [0.66, 0.76, 0.86], r=420*s;
    for (const k of ax) out.push(S.circle(xa+(xb-xa)*k, Yb-r, r, '#2a2d30', '#111', 1), S.circle(xa+(xb-xa)*k, Yb-r, r*0.45, '#8a9097'));
    out.push(S.rect(xa+(xb-xa)*0.16, frame+beam, 60*s, Yb-frame-beam, '#3a3f45'), S.line(xa-50, Yb, xb+50, Yb, this.INK, 2));
    return out;
  }
  static chassisEnd(xa, xb, Z, Yb, s){
    const S=StSvg, out=[], r=420*s, w=300*s;
    out.push(S.rect(xa+40*s, Z(0), (xb-xa)-80*s, 200*s, '#3a3f45'));
    for (const x of [xa+60*s, xb-60*s-w]) out.push(S.rect(x, Yb-2*r, w, 2*r, '#2a2d30'));
    out.push(S.line(xa-34, Yb, xb+34, Yb, this.INK, 2));
    return out;
  }

  /** экспликация: позиция, наименование, количество, габариты, масса; итог массы. Возвращает низ (y) */
  static legend(body, plan, x, y, w, hMax){
    const S=StSvg, INK=this.INK, F=this.FS, cols=this.COLS, fs=F.leg, lh=25, wrapN=Math.floor((cols[1]-16)/(fs*0.56));
    const byPos=new Map(); for (const it of [...plan.items, ...(plan.roof||[])]){ const e=byPos.get(it.pos); if (e) e.n++; else byPos.set(it.pos, { it, n:1 }); }
    for (const p of (plan.piping||[]).filter(q=>q.pos!=null)) byPos.set(p.pos, { it:{ pos:p.pos, kind:'piping', name:p.name, mat:[{ steel:'сталь', inox:'нерж. сталь', pp:'полипропилен' }[p.mat]||'', p.dn].filter(Boolean).join(', ') || '—', known:true, mass:null }, n:p.qty||1 });
    const rows=[...byPos.values()].sort((a, b)=>a.it.pos-b.it.pos);
    body.push(S.text(x, y, 'Экспликация оборудования', { anchor:'start', size:F.view, weight:700 }));
    let yy=y+16; const head=['Поз.', 'Наименование', 'Кол.', 'Д × Ш × В, мм', 'Масса, кг'];
    const cell=(cx, i, t, o={})=>S.text(i===1 ? cx+8 : cx+cols[i]/2, yy+(o.dy||0), t, { size:o.size||fs, anchor:i===1 ? 'start' : 'middle', weight:o.weight, fill:o.fill });
    body.push(S.rect(x, yy, w, 36, '#eef2f7', INK, 1.2));
    let cx=x; head.forEach((t, i)=>{ body.push(cell(cx, i, t, { dy:24, weight:700, size:F.legHead })); cx+=cols[i]; });
    yy+=36; let assumed=false, total=0, allMass=true, cutRows=0;
    for (const { it, n } of rows){
      const lines=this.lines(it.kind==='piping' ? it.name : it.brief||it.name, wrapN, 3), h=lines.length*lh+14;
      if (yy+h>y+hMax-80){ cutRows++; continue; }
      body.push(S.rect(x, yy, w, h, '#ffffff', INK, 1));
      cx=x; const dims=it.kind==='piping' ? it.mat : it.kind==='muffler' ? `${S.n(it.lx)} × Ø${S.n(it.d)}${it.known ? '' : '*'}` : `${S.n(it.l)} × ${S.n(it.w)} × ${S.n(it.h)}${it.known ? '' : '*'}`;
      if (!it.known) assumed=true; if (it.kind!=='piping'){ if (it.mass>0) total+=it.mass*n; else allMass=false; }
      [String(it.pos), lines, String(n), dims, it.mass>0 ? S.n(it.mass) : '—'].forEach((t, i)=>{
        if (Array.isArray(t)) t.forEach((ln, k)=>body.push(cell(cx, i, ln, { dy:24+k*lh }))); else body.push(cell(cx, i, t, { dy:24, weight:i===0 ? 700 : 400 }));
        cx+=cols[i]; });
      yy+=h;
    }
    cx=x; for (let i=0; i<cols.length-1; i++){ cx+=cols[i]; body.push(S.line(cx, y+16, cx, yy, INK, 1)); }
    const foot=(t, o={})=>{ yy+=o.gap||27; body.push(S.text(x, yy, t, { anchor:'start', size:o.size||fs-1, fill:o.fill })); };
    yy+=5;
    if (cutRows) foot(`… и ещё позиций: ${cutRows} — полный состав в описании станции`, { fill:this.MUTED });
    if (allMass && total>0) foot(`Масса оборудования: ${S.n(total)} кг (без контейнера)`);
    if (assumed) foot('* габариты условные — нет в характеристиках', { fill:this.MUTED, size:fs-2 });
    return yy;
  }
  /** строки по словам, не больше n строк (последняя — с многоточием, если не влезло) */
  static lines(s, max, n){
    const L=StSvg.wrap(String(s||'').replace(/(^|\s)([A-Za-zА-ЯЁа-яё]{1,4}) (?=\d)/g, '$1$2\u00a0'), max); if (L.length<=n) return L;
    const out=L.slice(0, n); out[n-1]=this.cut(out[n-1]+' '+L[n], max); return out;
  }

  /** примечания: строки по ширине листа; возвращает число строк */
  static notes(body, plan, x, y, w){
    const S=StSvg, F=this.FS, [aRec, aMin]=plan.aisleRule||[1000, 800], sys=(plan.extra||[]).filter(e=>e.kind==='skip' && !e.nodims).map(e=>e.name), dgu=plan.items.some(i=>i.kind==='dgu');
    const rf=plan.roof||[], up=rf.length ? Math.max(...rf.map(m=>m.gap+m.d+m.outlet)) : 0, two=(plan.doors||[]).some(d=>d.wall==='back') && (plan.doors||[]).some(d=>d.wall!=='back');
    const P=f=>[...new Set(plan.items.filter(f).map(i=>i.pos))].sort((a, b)=>a-b), list=a=>(a.length>1 ? 'поз. ' : 'поз. ')+a.join(', ');
    const wall=P(i=>i.mount==='wall'), frame=P(i=>i.mount==='frame'), hang=P(i=>i.mount==='pipe');
    const zw=plan.items.filter(i=>i.mount==='wall').map(i=>i.z), z0=zw.length ? Math.min(...zw) : 0;
    const L=[
      'Схема расстановки для коммерческого предложения: размеры, привязки и трассы уточняются рабочим проектом.',
      plan.door==='service' ? `Прохода обслуживания внутри нет — обслуживание снаружи через сервисные двери${two ? ' в обеих боковых стенах' : ''} (створки открываются наружу); у дверей на площадке — свободная зона не менее 1,5 м.`
        : `Проход обслуживания — не менее ${S.n(aMin)} мм (ПУЭ, п. 4.1.23), рекомендуется ${S.n(aRec)} мм${dgu ? '; вдоль ДГУ — не менее 600 мм (сужение прохода, там же)' : ''}; между оборудованием — 700 мм (СП 30.13330.2020, п. 13.22).`,
      wall.length ? `Шкафы (${list(wall)}) — настенные, на стене ${plan.items.some(i=>i.mount==='wall' && i.wall==='front') ? 'прохода напротив оборудования' : 'за своим местом в ряду'}, низ на высоте ${S.n(z0)} мм от пола; проход перед ними — не уже 600 мм (ПУЭ, п. 4.1.23).` : '',
      frame.length ? `Шкафы (${list(frame)}) — на раме за сервисной дверью.` : '',
      hang.length ? `Магистральные фильтры (${list(hang)}) — на трубопроводе (подвесные), после осушителя по ходу воздуха.` : '',
      up ? `Глушитель — на крыше прямо над ДГУ, на опорах; высота с глушителем ${S.n(plan.geo.ext[2]+up)} мм — при перевозке глушитель снимается.` : '',
      sys.length ? `Также в составе (на схеме не показаны): ${this.cut(sys.join(', '), 200)}.` : '',
    ].filter(Boolean).map((t, i)=>`${i+1}. ${t}`);
    const max=Math.floor((w-26)/(F.note*0.56)), out=L.flatMap(t=>S.wrap(t, max).map((ln, k)=>[ln, k>0]));
    body.push(S.text(x, y, 'Примечания', { anchor:'start', size:F.note, weight:700 }));
    out.forEach(([t, ind], i)=>body.push(S.text(x+(ind ? 26 : 0), y+30+i*27, t, { anchor:'start', size:F.note, fill:this.MUTED })));
    return out.length;
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
        out.push(tube([ox+l.x0, y, z], [ox+l.x1, y, z], pp.color, w));
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
