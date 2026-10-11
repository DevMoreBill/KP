// Лист по ЕСКД для чертежей станции в контейнере: формат А4 (ГОСТ 2.301), рамка, основная надпись по форме 1 и
// дополнительные графы (ГОСТ Р 2.104-2023 — как форма 1 ГОСТ 2.104-2006), масштабы (ГОСТ 2.302), линии (ГОСТ 2.303),
// шрифт (ГОСТ 2.304: наклонный, высота прописных 2,5…7 мм), сечения (ГОСТ 2.306), размеры (ГОСТ 2.307), номера позиций
// на полках линий-выносок (ГОСТ Р 2.109-2023), текстовая часть над основной надписью (ГОСТ 2.316).
// EquipIcon — упрощённые изображения оборудования для габаритного чертежа; PneuSymbol — условные графические обозначения
// пневмосхем (ГОСТ 2.780-96, 2.781-96, 2.782-96 — по ISO 1219-1; арматура — ГОСТ 2.785-70); StationScheme — схема
// пневматическая принципиальная компрессорной станции (ГОСТ 2.701, 2.704). Габаритный чертёж — station-draw.js.
// Без DOM: строки SVG в миллиметрах листа (viewBox), растр — 8 точек на мм; проверяется node-тестом.
'use strict';

// ---------------------------------------------------------------- лист ЕСКД
class EskdSheet {
  static K = 8;                  // точек растра на 1 мм листа: А4 — 1680 × 2376
  static FMT = { A4:[210, 297] };
  // шрифт типа Б (ГОСТ 2.304) — если установлен (КОМПАС, AutoCAD); иначе Arial курсивом
  static FONT = "'GOST type B', 'GOST Type BU', ISOCPEUR, Arial, Helvetica, sans-serif";
  static CAP = 1.4;              // кегль = высота прописных × 1,4 (у Arial прописная — 0,72 кегля)
  // линии (ГОСТ 2.303): толщина, мм, и штрихи; сплошная основная s = 0,5 мм, тонкие — s/2
  static LINE = {
    main:[0.5], thin:[0.25], frame:[0.6], bold:[0.35], pipe:[0.7],
    dash:[0.25, '2.4 1.2'],                   // штриховая — невидимый контур
    axis:[0.25, '7 1.4 0.6 1.4'],             // штрихпунктирная тонкая — оси, центровые, границы сборочной единицы
    phantom:[0.25, '7 1.4 0.6 1 0.6 1.4'],    // штрихпунктирная с двумя точками — крайние положения подвижных частей
    cut:[0.8],                                // разомкнутая — линия сечения
    drain:[0.3, '2 1'],                       // схема: отвод конденсата
  };
  static SCALES = [1, 2, 2.5, 4, 5, 10, 15, 20, 25, 40, 50, 75, 100, 200, 400, 500, 800, 1000];   // уменьшения (ГОСТ 2.302)
  static AR = [2.8, 0.5];        // стрелка размерной линии: длина и полуширина, мм

  constructor(fmt){ this.fmt=EskdSheet.FMT[fmt] ? fmt : 'A4'; [this.W, this.H]=EskdSheet.FMT[this.fmt]; this.out=[]; this.hatch=false; }

  // ---- примитивы (мм листа)
  static f(v){ return Math.round(v*100)/100; }
  static esc(s){ return String(s??'').replace(/[&<>"]/g, c=>({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c])); }
  static st(type, fill){
    const [w, d]=this.LINE[type]||this.LINE.thin;
    return `fill="${fill||'none'}" stroke="#000" stroke-width="${w}"${d ? ` stroke-dasharray="${d}"` : ' stroke-linecap="round"'}`;
  }
  line(x1, y1, x2, y2, type='thin'){ const f=EskdSheet.f; this.out.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" ${EskdSheet.st(type)}/>`); }
  path(d, type='thin', fill){ this.out.push(`<path d="${d}" ${EskdSheet.st(type, fill)} stroke-linejoin="round"/>`); }
  rect(x, y, w, h, type='thin', fill, rx){
    if (!(w>0 && h>0)) return; const f=EskdSheet.f;
    this.out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${rx ? ` rx="${f(Math.min(rx, w/2, h/2))}"` : ''} ${EskdSheet.st(type, fill)} stroke-linejoin="round"/>`); }
  circle(cx, cy, r, type='thin', fill){ if (r>0){ const f=EskdSheet.f; this.out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" ${EskdSheet.st(type, fill)}/>`); } }
  poly(P, type='thin', fill, open){ const f=EskdSheet.f; this.out.push(`<${open ? 'polyline' : 'polygon'} points="${P.map(p=>f(p[0])+','+f(p[1])).join(' ')}" ${EskdSheet.st(type, fill)} stroke-linejoin="round"/>`); }
  dot(x, y, r=0.45){ const f=EskdSheet.f; this.out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="#000"/>`); }
  /** текст: h — высота прописных, мм (ГОСТ 2.304: 2,5; 3,5; 5; 7); a — start | middle | end; rot — поворот вокруг (x, y), ° */
  text(x, y, s, h=3.5, o={}){
    const f=EskdSheet.f, t=String(s??''); if (!t) return;
    this.out.push(`<text x="${f(x)}" y="${f(y)}" font-size="${f(h*EskdSheet.CAP)}"${o.a && o.a!=='start' ? ` text-anchor="${o.a}"` : ''}${o.rot ? ` transform="rotate(${o.rot} ${f(x)} ${f(y)})"` : ''}${o.b ? ' font-weight="700"' : ''}>${EskdSheet.esc(t)}</text>`);
  }
  /** текст по центру (cx, cy) снизу вверх (поворот на −90°) */
  vtext(cx, cy, s, h=2.5){ this.text(cx+h/2, cy, s, h, { a:'middle', rot:-90 }); }
  /** примерная ширина строки, мм: по Arial курсивом (замерено; шрифт типа Б уже — с запасом) */
  static tw(s, h){
    const W=this.cw||(this.cw=this.widths()); let w=0;
    for (const c of String(s??'')) w+=W[c] ?? (/[A-Z]/.test(c) ? 0.97 : 0.8);
    return w*h;
  }
  /** ширина знаков в долях высоты прописных (кегль 1,4 h) */
  static widths(){
    const W={}, put=(chars, v)=>{ for (const c of chars) W[c]=v; };
    put('абдеёийлнопрц', 0.79); put('вья', 0.75); put('гсухчэ', 0.71); put('зк', 0.67); put('ъ', 0.87); put('жмыю', 1.05); put('тфшщ', 1.19);
    put('АБВЕЁРХЯЬ', 0.94); put('ГТКУЗ', 0.88); put('ДИЙНПСЦЧЭЛ', 1.02); put('ОФЪ', 1.13); put('МЫ', 1.24); put('ЖШЩ', 1.3); put('Ю', 1.44);
    put('abcdeghnopqu', 0.78); put('kvxyzs', 0.71); put('ilj', 0.32); put('ft', 0.4); put('r', 0.47); put('mw', 1.17);
    put('IJ', 0.7); put('W', 1.33); put('M', 1.17);
    put('0123456789', 0.78); put(' .,:;/', 0.39); put('()-³²\'', 0.47); put('"', 0.5); put('«»–×', 0.8); put('—→…№', 1.46);
    return W;
  }
  /** перенос по словам на ширину w, мм */
  static wrap(s, w, h){
    const out=[]; let cur='';
    for (const word of String(s||'').trim().split(/\s+/).filter(Boolean)){ const t=cur ? cur+' '+word : word; if (cur && this.tw(t, h)>w){ out.push(cur); cur=word; } else cur=t; }
    if (cur) out.push(cur); return out;
  }
  /** строка в ширину w: шрифт меньше, до hMin; не влезает — с многоточием. [строка, высота] */
  static fit(s, w, h, hMin){
    s=String(s||''); let hh=h; const lo=hMin||h;
    while (this.tw(s, hh)>w && hh>lo) hh=Math.max(lo, hh-0.25);
    if (this.tw(s, hh)<=w) return [s, hh];
    let t=s; while (t.length>1 && this.tw(t+'…', hh)>w) t=t.slice(0, -1);
    return [t.replace(/[\s,.;:–-]+$/, '')+'…', hh];
  }
  /** сечение (ГОСТ 2.306): уже 2 мм — зачернено, шире — штриховка под 45° */
  section(x, y, w, h){
    if (!(w>0 && h>0)) return;
    if (Math.min(w, h)<2) this.rect(x, y, w, h, 'thin', '#000'); else { this.hatch=true; this.rect(x, y, w, h, 'main', 'url(#eskd-h)'); }
  }

  // ---- размеры (ГОСТ 2.307): выносные линии — за размерную на 2 мм, стрелки 2,8 мм, числа 3,5 мм над размерной линией
  /** стрелка: острие (x, y), направление (ux, uy) — куда смотрит острие */
  arrow(x, y, ux, uy){ const [L, b]=EskdSheet.AR, px=-uy, py=ux; this.poly([[x, y], [x-ux*L+px*b, y-uy*L+py*b], [x-ux*L-px*b, y-uy*L-py*b]], 'thin', '#000'); }
  /** горизонтальный размер от x1 до x2 на уровне y; e1, e2 — y точек контура (выносные линии; null — без них);
   *  o.lift — число выше на столько строк (тесная цепочка размеров), o.tx — его середина; o.tick — засечки вместо стрелок;
   *  o.h — высота цифр */
  dimH(x1, x2, y, t, e1, e2, o={}){
    const L=EskdSheet.AR[0], h=o.h||3.5, s=String(t), span=x2-x1, mid=(x1+x2)/2, tw=EskdSheet.tw(s, h);
    for (const [x, e] of [[x1, e1], [x2, e2]]) if (e!=null) this.line(x, e, x, e>y ? y-2 : y+2);
    if (o.tick){ this.line(x1-1.5, y, x2+1.5, y); for (const x of [x1, x2]) this.line(x-1, y+1, x+1, y-1, 'main'); }   // засечки под 45°
    else if (span>=2*L+1.5){ this.line(x1, y, x2, y); this.arrow(x1, y, -1, 0); this.arrow(x2, y, 1, 0); }
    else { this.line(x1-L-2.5, y, x2+L+2.5, y); this.arrow(x1, y, 1, 0); this.arrow(x2, y, -1, 0); }
    const lift=o.lift??(tw+1>span && !o.force ? 1 : 0);
    if (!lift) return this.text(mid, y-0.8, s, h, { a:'middle' });
    const yt=y-0.8-lift*(h+1.6), tx=o.tx??mid; this.line(mid, y, tx, yt+0.6); this.text(tx, yt, s, h, { a:'middle' });
  }
  /** вертикальный размер от y1 (верх) до y2 (низ) на x; e1, e2 — x точек контура; число — слева от линии, снизу вверх */
  dimV(y1, y2, x, t, e1, e2, o={}){
    const L=EskdSheet.AR[0], h=o.h||3.5, s=String(t), span=y2-y1;
    for (const [y, e] of [[y1, e1], [y2, e2]]) if (e!=null) this.line(e, y, e>x ? x-2 : x+2, y);
    if (span>=2*L+1.5){ this.line(x, y1, x, y2); this.arrow(x, y1, 0, -1); this.arrow(x, y2, 0, 1); }
    else { this.line(x, y1-L-2.5, x, y2+L+2.5); this.arrow(x, y1, 0, 1); this.arrow(x, y2, 0, -1); }
    this.text(x-0.8, (y1+y2)/2, s, h, { a:'middle', rot:-90 });
  }

  // ---- номер позиции (ГОСТ Р 2.109): точка на изображении, линия-выноска, полка; номер на размер больше размерных чисел
  pos(px, py, sx, sy, n, dir=1){
    const h=5, w=EskdSheet.tw(String(n), h)+1.6;
    this.dot(px, py, 0.5); this.line(px, py, sx, sy); this.line(sx, sy, sx+dir*w, sy);
    this.text(sx+dir*w/2, sy-0.9, String(n), h, { a:'middle' });
  }
  /** полки номеров позиций в строку (axis 'x') или колонку ('y'): A — [{x, y, n}] — точки на изображениях; lo…hi — где
   *  можно ставить полки, at — их линия; шаг — не меньше gap; выноски не пересекаются. [{px, py, sx, sy, n}] */
  static shelves(A, axis, lo, hi, at, gap){
    if (!A.length) return [];
    const k=axis==='x' ? 'x' : 'y', S=[...A].sort((a, b)=>a[k]-b[k]), n=S.length, span=Math.max(0, hi-lo), g=Math.min(gap, n>1 ? span/(n-1) : gap);
    const c=S.map(a=>Math.max(lo, Math.min(hi, a[k])));
    for (let i=1; i<n; i++) c[i]=Math.max(c[i], c[i-1]+g);
    if (c[n-1]>hi){ c[n-1]=hi; for (let i=n-2; i>=0; i--) c[i]=Math.min(c[i], c[i+1]-g); }
    const L=S.map((a, i)=>({ px:a.x, py:a.y, n:a.n, sx:k==='x' ? c[i] : at, sy:k==='x' ? at : c[i] }));
    const cross=(p, q)=>{ const d=(ax, ay, bx, by, cx, cy)=>(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
      const d1=d(p.px, p.py, p.sx, p.sy, q.px, q.py), d2=d(p.px, p.py, p.sx, p.sy, q.sx, q.sy), d3=d(q.px, q.py, q.sx, q.sy, p.px, p.py), d4=d(q.px, q.py, q.sx, q.sy, p.sx, p.sy);
      return d1*d2<0 && d3*d4<0; };
    for (let it=0, ch=true; ch && it<60; it++){ ch=false;
      for (let i=0; i<n; i++) for (let j=i+1; j<n; j++) if (cross(L[i], L[j])){
        const a=L[i], b=L[j], t=k==='x' ? 'sx' : 'sy'; [a[t], b[t]]=[b[t], a[t]]; ch=true; } }
    return L;
  }

  // ---- текстовая часть
  /** пункты с номерами (ГОСТ 2.316): перенос с отступом; рисовать — draw; возвращает высоту, мм */
  paras(x, y, w, items, h=2.5, draw=true){
    const lh=h*1.55, ind=EskdSheet.tw('10. ', h); let yy=y;
    items.forEach((t, i)=>{ const L=EskdSheet.wrap(t, w-ind, h), num=items.length>1 ? `${i+1}. ` : '';
      L.forEach((ln, k)=>{ yy+=lh; if (draw){ if (!k && num) this.text(x, yy, num, h); this.text(x+(num ? ind : 0), yy, ln, h); } }); });
    return yy-y+h*0.5;
  }
  /** таблица: левый верх (x, y), cols — ширины, мм; head — заголовки; rows — строки ([текст | [текст, 'c']]);
   *  rh — высота строки; возвращает высоту */
  table(x, y, cols, head, rows, rh=5, hh=6, h=2.5){
    const W=cols.reduce((a, b)=>a+b, 0), Ht=hh+rows.length*rh;
    this.rect(x, y, W, Ht, 'main'); this.line(x, y+hh, x+W, y+hh, 'main');
    let cx=x; cols.forEach((c, i)=>{ if (i) this.line(cx, y, cx, y+Ht, 'main'); this.text(cx+c/2, y+hh/2+h*0.5, head[i], h, { a:'middle' }); cx+=c; });
    rows.forEach((r, j)=>{ const yy=y+hh+j*rh; if (j) this.line(x, yy, x+W, yy, 'thin'); let xx=x;
      cols.forEach((c, i)=>{ const v=r[i], [t, al]=Array.isArray(v) ? v : [v, i ? 'l' : 'c'], [s, hs]=EskdSheet.fit(t, c-2.4, h, 2.3);
        this.text(al==='c' ? xx+c/2 : xx+0.8, yy+rh/2+hs*0.5, s, hs, { a:al==='c' ? 'middle' : 'start' }); xx+=c; }); });
    return Ht;
  }

  // ---- рамка и основная надпись
  /** рамка (поля 20 мм слева, 5 мм — остальные), основная надпись формы 1 (185 × 55 мм) в правом нижнем углу, дополнительные
   *  графы 19–25 на поле подшивки, графа 26 — обозначение, повёрнутое на 180°, в левом верхнем углу (А4).
   *  tb — {name, doc, code, lit, mass, scale, sheet, sheets, org, dev, date} */
  frame(tb){
    const R=205, B=292, X=v=>R-v, Y=v=>B-v, h=2.5;
    this.rect(20, 5, 185, 287, 'frame');
    // основная надпись: координаты — от правого нижнего угла рамки, как в форме 1
    for (const [x, a, b, t] of [[185, 0, 55], [120, 0, 55], [130, 0, 55], [145, 0, 55], [168, 0, 55], [178, 30, 55], [50, 0, 40], [35, 20, 40], [18, 20, 40], [30, 15, 20],
      [45, 20, 35, 'thin'], [40, 20, 35, 'thin']]) this.line(X(x), Y(a), X(x), Y(b), t||'frame');
    for (const [y, a, b, t] of [[55, 185, 0], [35, 185, 120], [30, 185, 120], [40, 120, 0], [15, 120, 0], [35, 50, 0], [20, 50, 0],
      [40, 185, 120, 'thin'], [45, 185, 120, 'thin'], [50, 185, 120, 'thin'], [25, 185, 120, 'thin'], [20, 185, 120, 'thin'], [15, 185, 120, 'thin'], [10, 185, 120, 'thin'], [5, 185, 120, 'thin']])
      this.line(X(a), Y(y), X(b), Y(y), t||'frame');
    const cell=(x, y, s, o={})=>this.text(X(x), Y(y)+(o.h||h)/2, s, o.h||h, { a:o.a||'middle' });
    for (const [x, s] of [[181.5, 'Изм.'], [173, 'Лист'], [156.5, '№ докум.'], [137.5, 'Подп.'], [125, 'Дата']]) cell(x, 32.5, s);
    for (const [y, s] of [[27.5, 'Разраб.'], [22.5, 'Пров.'], [17.5, 'Т.контр.'], [7.5, 'Н.контр.'], [2.5, 'Утв.']]) cell(184.3, y, s, { a:'start' });
    if (tb.dev){ const [s, hs]=EskdSheet.fit(tb.dev, 21.5, h, 1.8); cell(167.3, 27.5, s, { a:'start', h:hs }); }
    const dt=EskdSheet.date(tb.date)||tb.date; if (dt) cell(125, 27.5, dt, { h:EskdSheet.fit(dt, 9.4, h, 1.6)[1] });
    for (const [x, s] of [[42, 'Лит.'], [26.5, 'Масса'], [9, 'Масштаб']]) cell(x, 37.5, s);
    if (tb.lit) cell(47.5, 27.5, tb.lit, { h:3.5 });
    if (tb.mass) cell(26.5, 27.5, tb.mass, { h:EskdSheet.fit(tb.mass, 16, 3.5, 2.5)[1] });
    if (tb.scale) cell(9, 27.5, tb.scale, { h:EskdSheet.fit(tb.scale, 17, 3.5, 2.5)[1] });
    cell(49, 17.5, 'Лист', { a:'start' }); cell(29, 17.5, 'Листов', { a:'start' });
    if (tb.sheet) cell(36, 17.5, String(tb.sheet)); if (tb.sheets) cell(8.5, 17.5, String(tb.sheets));
    // графа 1 — наименование изделия и документа; 2 — обозначение; 9 — организация
    for (const [hh, nmax] of [[3.5, 3], [3, 4], [2.5, 5]]){   // графа 1: 70 × 25 мм — наименование изделия и документа
      const dl=EskdSheet.wrap(tb.doc||'', 66, hh), nl=EskdSheet.wrap(tb.name||'', 66, hh), lh=hh*1.3, room=Math.floor((23.5-dl.length*lh)/lh);
      if (nl.length>Math.min(nmax, room) && hh>2.5) continue;
      const L=nl.slice(0, room); if (nl.length>room) L[room-1]=EskdSheet.fit(L[room-1]+' '+nl[room], 66, hh, hh)[0];
      const all=[...L, ...dl], y0=Y(27.5)-(all.length*lh)/2+hh*0.95;
      all.forEach((t, i)=>this.text(X(85), y0+i*lh, t, hh, { a:'middle' })); break; }
    if (tb.code){ const [t, hs]=EskdSheet.fit(tb.code, 116, 7, 3.5); cell(60, 47.5, t, { h:hs }); }
    if (tb.org){ const L=EskdSheet.wrap(tb.org, 47, 3.5).slice(0, 2); L.forEach((s, i)=>{ const [t, hs]=EskdSheet.fit(s, 47, 3.5, 2.5); this.text(X(25), Y(7.5)+hs/2+(i-(L.length-1)/2)*4.6, t, hs, { a:'middle' }); }); }
    // дополнительные графы на поле подшивки: 19–23 (внизу) и 24–25 (вверху)
    for (const y of [292, 267, 232, 207, 182, 147]) this.line(8, y, 20, y, 'frame');
    for (const y of [5, 65, 125]) this.line(8, y, 20, y, 'frame');
    for (const x of [8, 13]){ this.line(x, 147, x, 292, 'frame'); this.line(x, 5, x, 125, 'frame'); }
    for (const [y, s] of [[279.5, 'Инв. № подл.'], [249.5, 'Подп. и дата'], [219.5, 'Взам. инв. №'], [194.5, 'Инв. № дубл.'], [164.5, 'Подп. и дата'], [35, 'Перв. примен.'], [95, 'Справ. №']]) this.vtext(10.5, y, s, h);
    // графа 26 — обозначение документа, повёрнутое на 180°
    this.rect(20, 5, 70, 14, 'frame');
    if (tb.code){ const [t, hs]=EskdSheet.fit(tb.code, 66, 5, 2.5); this.text(55, 12-hs/2, t, hs, { a:'middle', rot:180 }); }
    // под рамкой: «Копировал», формат
    this.text(95, 296, 'Копировал', h); this.text(163, 296, 'Формат '+this.fmt, h);
  }

  /** документ SVG: лист в мм, растр — K точек на мм */
  svg(){
    const K=EskdSheet.K, defs=this.hatch ? '<pattern id="eskd-h" width="1.4" height="1.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.4" stroke="#000" stroke-width="0.18"/></pattern>' : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.W*K}" height="${this.H*K}" viewBox="0 0 ${this.W} ${this.H}" font-family="${EskdSheet.FONT}" font-style="italic" style="font-synthesis:none"><defs>${defs}</defs><rect width="${this.W}" height="${this.H}" fill="#ffffff"/>${this.out.join('')}</svg>`;
  }
  /** масштаб для основной надписи: 1:50 */
  static scale(n){ return '1:'+String(n).replace('.', ','); }
  /** дата для основной надписи: 2026-10-11 → 11.10.26 */
  static date(iso){ const m=String(iso||'').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : ''; }
  /** обозначение документа: код организации (4 буквы), 6 цифр по отпечатку расстановки, исполнение, код документа (ГЧ, П3) */
  static code(org, hash, kind){
    const L=String(org||'').toUpperCase().replace(/[^А-ЯЁ]/g, '').replace(/^(ООО|АО|ПАО|ЗАО|ИП)/, '').slice(0, 4) || 'КПСТ';
    const d=String(parseInt(String(hash||'0').slice(0, 8), 16) % 1000000).padStart(6, '0');
    return `${L}.${d}.001 ${kind}`;
  }
}

// ---------------------------------------------------------------- упрощённые изображения оборудования
// Габаритный чертёж допускает упрощения (ГОСТ Р 2.109): контур — сплошной основной, характерные детали — тонкими:
// у компрессора — пульт и решётка забора воздуха, у ресивера — эллиптические днища, опоры, люк, предохранительный клапан
// и манометр, ось; у адсорбционного осушителя — две колонны; у фильтра на трубе — головка и стакан со сливом; у шкафа —
// дверь, ручка, лампы; у ДГУ — рама, генератор, двигатель, радиатор; у насосного агрегата — двигатель, муфта, улитка.
class EquipIcon {
  /** вид спереди: x0…x1, y0 (верх)…y1 (низ), мм листа */
  static front(sh, it, x0, y0, x1, y1){
    const w=x1-x0, h=y1-y0; if (!(w>0.3 && h>0.3)) return;
    const k=it.kind, a=it.air||{};
    if (it.mount==='pipe') return this.lineFilter(sh, x0, y0, x1, y1);
    if (it.shape==='vcyl') return this.vessel(sh, x0, y0, x1, y1, k==='receiver');
    if (it.shape==='hcyl') return this.hvessel(sh, x0, y0, x1, y1);
    if (k==='compressor') return this.compressor(sh, x0, y0, x1, y1);
    if (k==='dryer') return a.type==='ads' || a.type==='gen' ? this.twin(sh, x0, y0, x1, y1) : this.dryer(sh, x0, y0, x1, y1);
    if (k==='cabinet') return this.cabinet(sh, x0, y0, x1, y1, it.mount==='floor' || it.mount==='frame');
    if (k==='dgu') return this.dgu(sh, x0, y0, x1, y1);
    if (k==='pump') return this.pump(sh, x0, y0, x1, y1);
    if (k==='tank') return this.tank(sh, x0, y0, x1, y1);
    sh.rect(x0, y0, w, h, 'main', '#fff');
  }
  /** вид сверху */
  static plan(sh, it, x0, y0, x1, y1){
    const w=x1-x0, h=y1-y0, m=Math.min(w, h), cx=(x0+x1)/2, cy=(y0+y1)/2, k=it.kind, a=it.air||{}; if (!(w>0.3 && h>0.3)) return;
    if (it.shape==='vcyl' && it.mount!=='pipe'){ sh.circle(cx, cy, m/2, 'main', '#fff'); this.axes(sh, cx, cy, m/2+1.6); return; }
    if (it.shape==='hcyl'){ sh.rect(x0, y0, w, h, 'main', '#fff', Math.min(w, h)/2); const hz=w>=h; sh.line(hz ? x0-1.6 : cx, hz ? cy : y0-1.6, hz ? x1+1.6 : cx, hz ? cy : y1+1.6, 'axis'); return; }
    if (it.mount==='pipe'){ sh.rect(x0, y0, w, h, 'main', '#fff'); if (m>1.6) sh.circle(cx, cy, m*0.32, 'thin'); return; }
    sh.rect(x0, y0, w, h, 'main', '#fff');
    if (m<3) return;
    if (k==='compressor'){ sh.circle(x0+w*0.62, cy, m*0.3, 'thin'); sh.circle(x0+w*0.62, cy, m*0.07, 'thin'); }
    else if (k==='dryer' && (a.type==='ads' || a.type==='gen')){ const r=Math.min(w/4.6, h/2.4); sh.circle(x0+w*0.26, cy, r, 'thin'); sh.circle(x1-w*0.26, cy, r, 'thin'); }
    else if (k==='dryer') sh.rect(x0+w*0.15, y0+h*0.2, w*0.7, h*0.25, 'thin');
    else if (k==='dgu'){ const rx=x1-w*0.13; sh.line(rx, y0, rx, y1, 'thin'); for (let x=rx+0.9; x<x1-0.3; x+=0.9) sh.line(x, y0+0.4, x, y1-0.4, 'thin'); sh.line(x0+w*0.35, y0, x0+w*0.35, y1, 'thin'); }
    else if (k==='pump'){ const r=Math.min(w*0.17, h*0.36); sh.circle(x1-w*0.2, cy, r, 'thin'); sh.rect(x0+w*0.06, y0+h*0.22, w*0.48, h*0.56, 'thin'); }
    else if (k==='tank') sh.circle(x1-Math.min(w*0.15, 3), y0+Math.min(h*0.3, 3), Math.min(m*0.12, 1.2), 'thin');
    else if (k==='cabinet'){   // дверь шкафа — со стороны обслуживания: face 1 — к задней стене (вверх на плане), −1 — к проходу, ±2 — вдоль торца
      const f=it.face; if (f===2) sh.line(x1-0.5, y0+0.4, x1-0.5, y1-0.4, 'thin'); else if (f===-2) sh.line(x0+0.5, y0+0.4, x0+0.5, y1-0.4, 'thin');
      else if (f>0) sh.line(x0+0.4, y0+0.5, x1-0.4, y0+0.5, 'thin'); else sh.line(x0+0.4, y1-0.5, x1-0.4, y1-0.5, 'thin'); }
  }
  /** центровые линии окружности: штрихпунктирные, за контур на r−… мм */
  static axes(sh, cx, cy, r){ sh.line(cx-r, cy, cx+r, cy, 'axis'); sh.line(cx, cy-r, cx, cy+r, 'axis'); }
  /** решётка — тонкие горизонтальные ламели */
  static grille(sh, x0, y0, x1, y1, step=0.9){ if (x1-x0<1 || y1-y0<1) return; sh.rect(x0, y0, x1-x0, y1-y0, 'thin'); for (let y=y0+step; y<y1-step*0.4; y+=step) sh.line(x0+0.3, y, x1-0.3, y, 'thin'); }

  static compressor(sh, x0, y0, x1, y1){
    const w=x1-x0, h=y1-y0; sh.rect(x0, y0, w, h, 'main', '#fff');
    if (Math.min(w, h)<4) return;
    sh.line(x0, y1-h*0.06, x1, y1-h*0.06, 'thin');                                                 // рама
    sh.rect(x0+w*0.08, y0+h*0.1, w*0.26, h*0.24, 'thin'); sh.rect(x0+w*0.12, y0+h*0.14, w*0.18, h*0.09, 'thin');   // пульт и дисплей
    sh.circle(x0+w*0.21, y0+h*0.28, Math.min(w, h)*0.025, 'thin');                                   // аварийная кнопка
    this.grille(sh, x0+w*0.46, y0+h*0.42, x1-w*0.08, y1-h*0.16);                                     // забор воздуха
  }
  static dryer(sh, x0, y0, x1, y1){
    const w=x1-x0, h=y1-y0; sh.rect(x0, y0, w, h, 'main', '#fff');
    if (Math.min(w, h)<4) return;
    sh.line(x0, y1-h*0.06, x1, y1-h*0.06, 'thin');
    this.grille(sh, x0+w*0.12, y0+h*0.1, x1-w*0.12, y0+h*0.44);
    sh.rect(x0+w*0.12, y0+h*0.54, w*0.3, h*0.14, 'thin');
  }
  /** две колонны адсорбционного осушителя (генератора) на раме, блок управления между ними */
  static twin(sh, x0, y0, x1, y1){
    const w=x1-x0, h=y1-y0, vw=w*0.32, base=y1-h*0.08;
    sh.rect(x0, base, w, y1-base, 'main', '#fff');
    for (const vx of [x0+w*0.06, x1-w*0.06-vw]) this.shell(sh, vx, y0+h*0.07, vx+vw, base, true);
    sh.rect(x0+w*0.06, y0, w*0.88, h*0.07, 'thin', '#fff');                                           // верхний блок клапанов
    sh.rect(x0+w*0.06+vw+w*0.03, y0+h*0.38, w*0.88-2*vw-w*0.06, h*0.2, 'main', '#fff');               // блок управления
  }
  /** обечайка с эллиптическими днищами (2:1): x0…x1, y0…y1; шов — тонкий */
  static shell(sh, x0, y0, x1, y1, seams){
    const w=x1-x0, h=y1-y0, rx=w/2, ry=Math.min(w/4, h/4), f=EskdSheet.f;
    sh.path(`M${f(x0)},${f(y0+ry)} A${f(rx)},${f(ry)} 0 0 1 ${f(x1)},${f(y0+ry)} L${f(x1)},${f(y1-ry)} A${f(rx)},${f(ry)} 0 0 1 ${f(x0)},${f(y1-ry)} Z`, 'main', '#fff');
    if (seams && h>4*ry){ sh.line(x0, y0+ry, x1, y0+ry, 'thin'); sh.line(x0, y1-ry, x1, y1-ry, 'thin'); }
    return ry;
  }
  /** вертикальный сосуд: опоры, обечайка, ось; у ресивера — люк, предохранительный клапан, манометр, слив */
  static vessel(sh, x0, y0, x1, y1, fit){
    const w=x1-x0, h=y1-y0, cx=(x0+x1)/2, hl=Math.min(h*0.14, Math.max(0.8, h*0.08)), sb=y1-hl;
    for (const lx of [x0+w*0.12, x1-w*0.12-w*0.08]) sh.rect(lx, sb-0.6, w*0.08, y1-sb+0.6, 'thin', '#fff');   // опоры
    const top=y0+(fit && w>4 ? Math.min(2.2, h*0.08) : 0), ry=this.shell(sh, x0, top, x1, sb, true);
    sh.line(cx, y0-1.6, cx, y1+1.2, 'axis');
    if (!fit || w<4) return;
    sh.circle(cx, sb-ry-(sb-top-2*ry)*0.3, Math.min(w*0.14, 2), 'thin');                               // люк
    sh.line(cx, top, cx, y0+0.5, 'thin'); sh.rect(cx-0.5, y0, 1, 0.9, 'thin', '#fff');                // предохранительный клапан
    sh.line(x0+w*0.3, top+ry*0.4, x0+w*0.3, top-0.6, 'thin'); sh.circle(x0+w*0.3, top-1.3, 0.75, 'thin', '#fff');   // манометр
    sh.line(cx, sb, cx, sb+hl*0.5, 'thin');                                                          // слив конденсата
  }
  /** горизонтальный сосуд на опорах-седлах (saddles=false — корпус без опор: глушитель на крыше) */
  static hvessel(sh, x0, y0, x1, y1, saddles=true){
    const w=x1-x0, h=y1-y0, hs=saddles ? Math.min(h*0.18, 3) : 0, sh0=y1-hs, f=EskdSheet.f, ry=(sh0-y0)/2, rx=Math.min(ry/2, w/4), cy=y0+ry;
    if (saddles) for (const sx of [x0+w*0.2, x1-w*0.2]) sh.poly([[sx-w*0.07, y1], [sx+w*0.07, y1], [sx+w*0.05, sh0-0.4], [sx-w*0.05, sh0-0.4]], 'thin', '#fff');
    sh.path(`M${f(x0+rx)},${f(y0)} L${f(x1-rx)},${f(y0)} A${f(rx)},${f(ry)} 0 0 1 ${f(x1-rx)},${f(sh0)} L${f(x0+rx)},${f(sh0)} A${f(rx)},${f(ry)} 0 0 1 ${f(x0+rx)},${f(y0)} Z`, 'main', '#fff');
    sh.line(x0+rx, y0, x0+rx, sh0, 'thin'); sh.line(x1-rx, y0, x1-rx, sh0, 'thin');
    sh.line(x0-1.6, cy, x1+1.6, cy, 'axis');
  }
  /** магистральный фильтр на трубе: головка, стакан, слив */
  static lineFilter(sh, x0, y0, x1, y1){
    const w=x1-x0, h=y1-y0, hh=Math.max(0.6, h*0.2), cx=(x0+x1)/2;
    sh.rect(x0, y0, w, hh, 'main', '#fff');
    sh.rect(x0+w*0.14, y0+hh, w*0.72, h-hh-Math.min(0.8, h*0.06), 'main', '#fff', w*0.3);
    sh.line(cx, y1-Math.min(0.8, h*0.06), cx, y1, 'thin');
  }
  static cabinet(sh, x0, y0, x1, y1, floor){
    const w=x1-x0, h=y1-y0, m=Math.min(w, h), i=Math.max(0.35, m*0.06);
    sh.rect(x0, y0, w, h, 'main', '#fff');
    if (m<2.5) return;
    sh.rect(x0+i, y0+i, w-2*i, h-2*i-(floor ? h*0.05 : 0), 'thin');                                   // дверь
    sh.line(x1-i-Math.max(0.6, w*0.08), y0+h*0.42, x1-i-Math.max(0.6, w*0.08), y0+h*0.58, 'main');     // ручка
    if (w>5) for (let k=0; k<3; k++) sh.circle(x0+w*(0.3+k*0.14), y0+i+Math.max(0.9, h*0.08), Math.min(0.55, w*0.04), 'thin');   // лампы
    if (floor) sh.line(x0, y1-h*0.05, x1, y1-h*0.05, 'thin');                                         // цоколь
  }
  /** ДГУ: рама, генератор (слева), двигатель, радиатор (справа — к жалюзи) */
  static dgu(sh, x0, y0, x1, y1){
    const w=x1-x0, h=y1-y0, base=y1-h*0.1;
    sh.rect(x0, base, w, y1-base, 'main', '#fff');
    if (Math.min(w, h)<4){ sh.rect(x0, y0, w, base-y0, 'main', '#fff'); return; }
    sh.rect(x0+w*0.04, y0+h*0.3, w*0.32, base-y0-h*0.3, 'main', '#fff', w*0.03);                      // генератор
    sh.rect(x0+w*0.08, y0+h*0.06, w*0.24, h*0.22, 'thin', '#fff');                                     // пульт
    sh.rect(x0+w*0.38, y0+h*0.2, w*0.44, base-y0-h*0.2, 'main', '#fff');                               // двигатель
    sh.rect(x0+w*0.42, y0+h*0.13, w*0.3, h*0.07, 'thin', '#fff');                                      // клапанная крышка
    this.grille(sh, x1-w*0.15, y0+h*0.04, x1, base, 0.8);                                             // радиатор
  }
  /** насосный агрегат: горизонтальный — двигатель, муфта, улитка на раме; вертикальный — насос, над ним двигатель */
  static pump(sh, x0, y0, x1, y1){
    const w=x1-x0, h=y1-y0;
    if (Math.min(w, h)<3){ sh.rect(x0, y0, w, h, 'main', '#fff'); return; }
    if (h>w*1.2){ const base=y1-h*0.08, cx=(x0+x1)/2;
      sh.rect(x0, base, w, y1-base, 'main', '#fff');
      sh.rect(x0+w*0.3, y0+h*0.45, w*0.4, base-y0-h*0.45, 'main', '#fff');
      sh.rect(x0, base-h*0.1, w*0.16, h*0.08, 'thin', '#fff'); sh.rect(x1-w*0.16, base-h*0.1, w*0.16, h*0.08, 'thin', '#fff');   // фланцы
      sh.rect(x0+w*0.16, y0, w*0.68, h*0.45, 'main', '#fff', w*0.08);                                  // двигатель
      for (let y=y0+h*0.08; y<y0+h*0.42; y+=0.9) sh.line(x0+w*0.2, y, x1-w*0.2, y, 'thin');
      sh.line(cx, y0-1.6, cx, y1+1.2, 'axis'); return; }
    const base=y1-h*0.12;
    sh.rect(x0, base, w, y1-base, 'main', '#fff');
    sh.rect(x0+w*0.04, y0+h*0.25, w*0.48, base-y0-h*0.25, 'main', '#fff', 0.4);                       // двигатель
    for (let x=x0+w*0.08; x<x0+w*0.5; x+=0.9) sh.line(x, y0+h*0.3, x, base-h*0.05, 'thin');
    sh.rect(x0+w*0.52, y0+h*0.5, w*0.1, base-y0-h*0.5, 'thin', '#fff');                                // муфта
    const r=Math.min(w*0.17, (base-y0)*0.32), vx=x1-w*0.2, vy=base-r-0.4;
    sh.circle(vx, vy, r, 'main', '#fff'); sh.rect(vx-r*0.35, vy-r-Math.min(1.6, r*0.5), r*0.7, Math.min(1.6, r*0.5), 'thin', '#fff');   // улитка, напорный патрубок
  }
  static tank(sh, x0, y0, x1, y1){
    const w=x1-x0, h=y1-y0, base=y1-Math.min(h*0.08, 1.2);
    sh.rect(x0, y0, w, base-y0, 'main', '#fff', Math.min(w, h)*0.12);
    sh.line(x0+w*0.08, base, x0+w*0.08, y1, 'thin'); sh.line(x1-w*0.08, base, x1-w*0.08, y1, 'thin'); sh.line(x0, y1, x1, y1, 'thin');
    if (w>4){ sh.rect(x1-w*0.2, y0-Math.min(1.2, h*0.1), w*0.1, Math.min(1.2, h*0.1), 'thin', '#fff'); sh.rect(x0+w*0.1, y0+h*0.2, Math.min(0.8, w*0.05), (base-y0)*0.6, 'thin'); }
  }
}

// ---------------------------------------------------------------- условные графические обозначения пневмосхем
// По ГОСТ 2.780-96 (кондиционеры рабочей среды, ёмкости), 2.781-96 (аппараты и приборы), 2.782-96 (машины) — соответствуют
// ISO 1219-1: ромб — кондиционер (фильтр — штриховая поперёк потока, «стакан» снизу — влагоотделение, V — автоматический
// отвод, две хорды — осушитель), окружность с незачернённым треугольником — компрессор, «капсула» — ресивер; запорная и
// предохранительная арматура — ГОСТ 2.785-70. Размеры обозначений стандарты не устанавливают — здесь модуль 5 мм.
class PneuSymbol {
  /** компрессор: окружность, незачернённый треугольник (пневматика) вершиной к выходу — вверх */
  static compressor(sh, cx, cy, r=5){
    sh.circle(cx, cy, r, 'bold', '#fff');
    const t=r*0.6; sh.poly([[cx, cy-r], [cx-t*0.62, cy-r+t], [cx+t*0.62, cy-r+t]], 'bold', '#fff');
    return { out:[cx, cy-r], inl:[cx, cy+r], shaft:[cx-r, cy] };
  }
  /** электродвигатель привода: окружность с буквой M, вал — двойная линия */
  static motor(sh, cx, cy, x2, r=3.4){
    sh.line(cx+r, cy-0.55, x2, cy-0.55, 'bold'); sh.line(cx+r, cy+0.55, x2, cy+0.55, 'bold');
    sh.circle(cx, cy, r, 'bold', '#fff'); sh.text(cx, cy+1.6, 'M', 3.5, { a:'middle' });
  }
  /** ресивер: горизонтальная «капсула», вход и выход по бокам, слив снизу */
  static receiver(sh, cx, cy, w=16, h=7){ sh.rect(cx-w/2, cy-h/2, w, h, 'bold', '#fff', h/2); return { inl:[cx-w/2, cy], out:[cx+w/2, cy], top:cy-h/2, bot:[cx, cy+h/2] }; }
  static diamond(sh, cx, cy, a){ sh.poly([[cx-a, cy], [cx, cy-a], [cx+a, cy], [cx, cy+a]], 'bold', '#fff'); }
  /** фильтр: drain — 'auto' (V — автоматический отвод конденсата) | 'manual' | '' (без отвода); element=false — влагоотделитель */
  static filter(sh, cx, cy, a=5, drain='auto', element=true){
    this.diamond(sh, cx, cy, a);
    const yc=cy+a*0.45, half=a*0.55;
    if (element) sh.line(cx, cy-a, cx, drain ? yc : cy+a, 'dash');
    if (drain){ sh.line(cx-half, yc, cx+half, yc, 'bold');
      if (drain==='auto') sh.poly([[cx-half*0.5, yc+0.35], [cx+half*0.5, yc+0.35], [cx, yc+half*0.55]], 'thin'); }
    return { inl:[cx-a, cy], out:[cx+a, cy], bot:[cx, cy+a] };
  }
  /** осушитель: ромб с двумя хордами у вершин */
  static dryer(sh, cx, cy, a=6){
    this.diamond(sh, cx, cy, a); const d=a*0.42;
    sh.line(cx-d, cy-a+d, cx+d, cy-a+d, 'bold'); sh.line(cx-d, cy+a-d, cx+d, cy+a-d, 'bold');
    return { inl:[cx-a, cy], out:[cx+a, cy], bot:[cx, cy+a] };
  }
  /** генератор азота (кислорода): прямоугольник с обозначением газа */
  static generator(sh, cx, cy, gas, m=1){ sh.rect(cx-6*m, cy-4.5*m, 12*m, 9*m, 'bold', '#fff'); sh.text(cx, cy+1.6, gas||'N₂', 3.5, { a:'middle' }); return { inl:[cx-6*m, cy], out:[cx+6*m, cy], bot:[cx, cy+4.5*m] }; }
  /** запорный кран (ГОСТ 2.785-70): два треугольника вершинами друг к другу; vertical — на вертикальной линии */
  static valve(sh, cx, cy, s=2, vertical){
    const P=vertical ? [[cx-s*0.6, cy-s], [cx+s*0.6, cy-s], [cx-s*0.6, cy+s], [cx+s*0.6, cy+s]] : [[cx-s, cy-s*0.6], [cx-s, cy+s*0.6], [cx+s, cy-s*0.6], [cx+s, cy+s*0.6]];
    sh.poly(P, 'bold', '#fff');
  }
  /** клапан предохранительный угловой (ГОСТ 2.785-70): вход снизу, выход вбок, пружина сверху; выход в атмосферу */
  static safety(sh, cx, cy, s=1.8){
    sh.poly([[cx, cy], [cx-s*0.6, cy+s], [cx+s*0.6, cy+s]], 'bold', '#fff');
    sh.poly([[cx, cy], [cx+s, cy-s*0.6], [cx+s, cy+s*0.6]], 'bold', '#fff');
    const z=[[cx, cy], [cx, cy-0.6]]; for (let i=0; i<4; i++) z.push([cx+(i%2 ? -0.8 : 0.8), cy-0.95-i*0.5]); z.push([cx, cy-3]);
    sh.poly(z, 'thin', 'none', true);
    sh.line(cx+s, cy, cx+s+1.2, cy, 'bold'); this.vent(sh, cx+s+1.2, cy);
  }
  /** выпуск в атмосферу (ISO 1219-1): незачернённый треугольник на конце линии */
  static vent(sh, x, y){ sh.poly([[x, y-0.9], [x, y+0.9], [x+1.4, y]], 'thin', '#fff'); }
  /** манометр (ГОСТ 2.781-96): окружность со стрелкой */
  static gauge(sh, cx, cy, r=1.8){
    sh.circle(cx, cy, r, 'bold', '#fff'); sh.line(cx+r*0.5, cy+r*0.5, cx-r*0.45, cy-r*0.45, 'thin');
    sh.poly([[cx-r*0.62, cy-r*0.62], [cx-r*0.62+0.85, cy-r*0.62+0.3], [cx-r*0.62+0.3, cy-r*0.62+0.85]], 'thin', '#000');
  }
  /** стрелка направления потока на линии */
  static flow(sh, x, y, dir=1){ sh.poly([[x+dir*1.1, y], [x-dir*0.9, y-0.8], [x-dir*0.9, y+0.8]], 'thin', '#000'); }
}

// ---------------------------------------------------------------- схема пневматическая принципиальная
// Компрессоры (с двигателями), коллектор, по ходу воздуха — ресиверы, фильтры, осушители (цепочка AirChain), выход к
// потребителю; арматура (краны, предохранительный клапан и манометр ресивера) — условно; отвод конденсата — штриховой
// линией; встроенные в компрессор осушитель и фильтры — внутри штрихпунктирной границы компрессора. Позиционные
// обозначения — номера позиций состава станции (как на габаритном чертеже), перечень элементов — над основной надписью.
class StationScheme {
  static STEP = 25;              // шаг аппаратов по линии, мм
  static ROW = 48;               // между строками схемы, мм
  /** есть ли что рисовать: в расстановке — компрессорная с цепочкой подготовки воздуха */
  static ok(plan){ return !!(plan && plan.air && (plan.air.units||[]).some(u=>u.kind==='compressor')); }

  static svg(plan, meta={}){
    const sh=new EskdSheet('A4'), a=plan.air, U=a.units||[], comps=U.filter(u=>u.kind==='compressor'), chain=U.filter(u=>u.kind!=='compressor');
    const pipe=(plan.piping||[]).find(p=>p.pos!=null), cond=a.cond||[];
    // ---- перечень элементов и указания — над основной надписью
    const rows=[...U.reduce((m, u)=>{ const r=m.get(u.pos); if (r) r.qty+=u.qty||1; else m.set(u.pos, { u, qty:u.qty||1 }); return m; }, new Map()).values()]
      .concat(cond.map(c=>({ u:{ pos:c.pos, kind:'cond', brief:c.brief, name:c.name }, qty:c.qty||1 })), pipe ? [{ u:{ pos:pipe.pos, kind:'piping', brief:pipe.name }, qty:1 }] : [])
      .sort((p, q)=>p.u.pos-q.u.pos);
    const note=u=>{ const r=u.air||{};
      if (u.kind==='compressor') return [r.dryer ? 'встроенный осушитель' : '', r.filter ? 'встроенные фильтры' : '', r.vsd ? 'частотное регулирование' : ''].filter(Boolean).join(', ');
      if (u.kind==='dryer') return (r.type==='ads' ? 'адсорбционный' : r.type==='gen' ? 'генератор' : 'рефрижераторный')+(r.filters ? ', встроенные фильтры' : '');
      if (u.kind==='receiver') return r.role==='dry' ? 'после осушителя' : 'до осушителя';
      if (u.kind==='filter') return AirChain.GRADES[r.grade] ? AirChain.GRADES[r.grade].short : '';
      if (u.kind==='cond') return 'очистка конденсата';
      if (u.kind==='piping') return 'краны, клапаны, манометры';
      return ''; };
    const TB=237, cols=[14, 95, 12, 64], rh=6, listH=6+rows.length*rh, yList=TB-12-listH;
    sh.table(20, yList, cols, ['Поз.', 'Наименование', 'Кол.', 'Примечание'], rows.map(({ u, qty })=>[[String(u.pos), 'c'], u.brief||u.name||'', [String(qty), 'c'], note(u)]), rh, 6, 2.5);
    sh.text(20+92.5, yList-2.5, 'Перечень элементов', 3.5, { a:'middle' });
    const notes=[
      `Арматура (запорные краны, предохранительный клапан, манометр, отвод конденсата) показана условно${pipe ? `; входит в обвязку поз. ${pipe.pos}` : ''}.`,
      'У ресивера, фильтров и осушителя — один вход и один выход: сжатый воздух проходит через них последовательно, по стрелкам; линии отвода конденсата — штриховые.',
      ...(a.cls ? [`На выходе — класс чистоты сжатого воздуха ${a.cls} по ISO 8573-1.`] : []),
    ];
    const nH=sh.paras(25, 0, 175, notes, 2.5, false), yN=yList-8-nH;
    sh.paras(25, yN, 175, notes, 2.5);
    // ---- схема: компрессоры слева столбцом, коллектор, аппараты по ходу воздуха строками (змейкой); модуль m — крупнее,
    // пока помещается над указаниями
    const comp=comps.flatMap(u=>Array.from({ length:Math.min(u.qty||1, 4) }, ()=>u)).slice(0, 6);
    const nodes=chain.flatMap(u=>Array.from({ length:Math.min(u.qty||1, 3) }, ()=>u));
    const built=u=>!!((u.air||{}).dryer || (u.air||{}).filter), wide=comp.some(built), top=30, bottom=yN-6;
    const geo=m=>{ const xCol=25+(wide ? 53 : 35)*m, xs0=xCol+14*m, xs1=196, S=this.STEP*m, per=Math.max(1, Math.floor((xs1-xs0)/S)+1), rows=Math.max(1, Math.ceil(nodes.length/per));
      const h=Math.max((comp.length-1)*24*m+14*m, (rows-1)*this.ROW*m+24*m)+12; return { m, xCol, xs0, xs1, S, per, rows, h }; };
    let G=geo(1);   // крупнее — пока помещается в столько же строк; не помещается и при 1 — мельче, до 0,7
    for (let m=1.6; m>1.001; m-=0.1){ const g=geo(m); if (g.rows<=G.rows && top+g.h<=bottom && g.xs0+g.S<=g.xs1){ G=g; break; } }
    for (let m=0.9; top+G.h>bottom && m>0.65; m-=0.1) G=geo(m);
    const { m, xCol, xs0, xs1, S, per }=G, xM=29+4*(m-1), xC=xM+13*m, dy=24*m, yT=top+12, yRow=r=>yT+r*this.ROW*m;
    comp.forEach((u, i)=>{ const cy=yT+8*m+i*dy, yo=yT+i*dy, r=u.air||{};
      PneuSymbol.motor(sh, xM, cy, xC-5*m, 3.4*m); PneuSymbol.compressor(sh, xC, cy, 5*m);
      sh.line(xC, cy-5*m, xC, yo, 'bold');
      if (built(u)){ const x0=xC+6*m;
        sh.line(xC, yo, xCol-10*m, yo, 'bold');
        if (r.dryer) PneuSymbol.dryer(sh, x0+5*m, yo, 4*m);
        if (r.filter) PneuSymbol.filter(sh, x0+(r.dryer ? 16 : 5)*m, yo, 3.4*m, 'auto');
        sh.rect(xM-5.5*m, yo-6.5*m, xCol-11*m-(xM-5.5*m), cy+7*m-(yo-6.5*m), 'axis');   // граница компрессорной установки
        sh.text(xM-5.5*m, yo-6.5*m-1.2, String(u.pos), 3.5); }
      else { sh.line(xC, yo, xCol, yo, 'bold'); sh.text(xM-3.4*m, cy-3.4*m-1.4, String(u.pos), 3.5, { a:'middle' }); }
      PneuSymbol.valve(sh, xCol-6*m, yo, 1.8*m);
      if (i || comp.length>1) sh.line(xCol-4.2*m, yo, xCol, yo, 'bold');
      if (comp.length>1) sh.dot(xCol, yo, 0.6); });
    if (comp.length>1) sh.line(xCol, yT, xCol, yT+(comp.length-1)*dy, 'bold');
    // аппараты: единицы по ходу воздуха (одинаковые — до трёх подряд)
    const P=[];
    nodes.forEach((u, i)=>{ const r=Math.floor(i/per), j=i%per, ltr=r%2===0; P.push({ u, r, x:ltr ? xs0+j*S : xs0+(per-1-j)*S, y:yRow(r), ltr, m }); });
    const end=P.length ? P[P.length-1] : { x:xCol, y:yT, r:0, ltr:true }, drains=[];
    let px=xCol, py=yT, pr=0;
    const seg=(x1, y1, x2, y2)=>{ sh.line(x1, y1, x2, y2, 'bold'); if (y1===y2 && Math.abs(x2-x1)>10*m) PneuSymbol.flow(sh, (x1+x2)/2, y1, x2>x1 ? 1 : -1); };
    for (const n of P){
      const w=this.half(n.u)*m, inX=n.ltr ? n.x-w : n.x+w;
      if (n.r!==pr){ const ex=pr%2===0 ? xs1 : xs0-9*m; seg(px, py, ex, py); sh.line(ex, py, ex, n.y, 'bold'); px=ex; py=n.y; pr=n.r; }
      seg(px, py, inX, n.y);
      const d=this.node(sh, n); if (d) drains.push({ x:d[0], y:d[1], r:n.r });
      px=n.ltr ? n.x+w : n.x-w; py=n.y; }
    // выход к потребителю: кран, стрелка, класс чистоты — подписи до конца стрелки, внутри рамки
    const dir=end.ltr ? 1 : -1, xv=px+dir*7*m, xo=px+dir*14*m, tip=xo+dir*2.6, down=!(tip>=27 && tip<=199), xDown=px+dir*3;
    if (!down){ seg(px, py, xv-dir*1.8*m, py); PneuSymbol.valve(sh, xv, py, 1.8*m); sh.line(xv+dir*1.8*m, py, xo, py, 'bold'); sh.arrow(tip, py, dir, 0);
      const lw=Math.max(EskdSheet.tw('К потребителю', 2.5), a.cls ? EskdSheet.tw(`класс ${a.cls}`, 2.5) : 0), out=dir>0 ? tip+1.2+lw<=199 : tip-1.2-lw>=26;
      const tx=out ? tip+dir*1.2 : tip, an=out===(dir>0) ? 'start' : 'end';   // за стрелкой, если есть место, иначе — над линией до стрелки
      sh.text(tx, out ? py+0.9 : py-3.4, 'К потребителю', 2.5, { a:an });
      if (a.cls) sh.text(tx, out ? py+4.8 : py+5.6, `класс ${a.cls}`, 2.5, { a:an }); }
    else { const xe=xDown, yv=py+7*m, yo=py+13*m;   // у края листа — выход вниз
      sh.line(px, py, xe, py, 'bold'); sh.line(xe, py, xe, yv-1.8*m, 'bold'); PneuSymbol.valve(sh, xe, yv, 1.8*m, true); sh.line(xe, yv+1.8*m, xe, yo, 'bold'); sh.arrow(xe, yo+2.6, 0, 1);
      sh.text(xe, yo+6.4, 'К потребителю', 2.5, { a:dir>0 ? 'end' : 'start' });
      if (a.cls) sh.text(xe, yo+10.2, `класс ${a.cls}`, 2.5, { a:dir>0 ? 'end' : 'start' }); }
    // отвод конденсата: от сливов вниз к линии сбора под строкой
    for (const r of [...new Set(drains.map(d=>d.r))]){ const D=drains.filter(d=>d.r===r), yd=yRow(r)+17*m, x0=Math.min(...D.map(d=>d.x)), x1=Math.max(...D.map(d=>d.x)), ltr=r%2===0;
      for (const d of D) sh.line(d.x, d.y, d.x, yd, 'drain');
      const lab=cond.length ? `конденсат — к поз. ${cond[0].pos}` : 'конденсат', lw=EskdSheet.tw(lab, 2.5), wrap=r<G.rows-1;   // у края — переход на следующую строку
      const lim=down && r===end.r ? (ltr ? xDown-EskdSheet.tw('К потребителю', 2.5)-3 : xDown+EskdSheet.tw('К потребителю', 2.5)+3) : null;   // не под надписью выхода
      let xe=ltr ? Math.min(x1+10, (wrap ? xs1-3 : 199)-lw-4) : Math.max(x0-10, (wrap ? xs0-9*m+3 : 26)+lw+4);
      if (lim!=null) xe=ltr ? Math.min(xe, lim-lw-4) : Math.max(xe, lim+lw+4);
      sh.line(ltr ? x0 : x1, yd, xe, yd, 'drain'); sh.arrow(xe+(ltr ? 2.6 : -2.6), yd, ltr ? 1 : -1, 0);
      sh.text(xe+(ltr ? 3.6 : -3.6), yd+1.2, lab, 2.5, { a:ltr ? 'start' : 'end' }); }
    const code=EskdSheet.code(meta.org, plan.hash, 'П3');
    sh.frame({ name:meta.title||'Станция компрессорная', doc:'Схема пневматическая принципиальная', code, lit:'П', sheets:1, org:meta.org, dev:meta.dev, date:meta.date });
    return sh.svg();
  }
  /** полуширина обозначения по линии (при модуле 1) */
  static half(u){ return u.kind==='receiver' ? 8 : u.kind==='dryer' ? 6 : 5; }
  /** аппарат на линии: обозначение, арматура, номер позиции; возвращает точку слива конденсата или null */
  static node(sh, n){
    const { u, x, y, m }=n, r=u.air||{};
    if (u.kind==='receiver'){
      const s=PneuSymbol.receiver(sh, x, y, 16*m, 7*m);
      sh.line(x+3.5*m, s.top, x+3.5*m, s.top-2.6*m, 'bold'); PneuSymbol.safety(sh, x+3.5*m, s.top-2.6*m, 1.8*m);
      sh.line(x-4*m, s.top, x-4*m, s.top-2.2*m, 'bold'); PneuSymbol.gauge(sh, x-4*m, s.top-2.2*m-1.8*m, 1.8*m);
      sh.line(x, y+3.5*m, x, y+6*m, 'bold'); PneuSymbol.valve(sh, x, y+7.8*m, 1.6*m, true);
      sh.text(x-8.5*m, y-4.5*m, String(u.pos), 3.5, { a:'end' });
      return [x, y+9.4*m]; }
    if (u.kind==='dryer' && r.type==='gen'){ PneuSymbol.generator(sh, x, y, /кислород|O2|О2/i.test(u.name||'') ? 'O₂' : 'N₂', m); sh.text(x+6.8*m, y-5.5*m, String(u.pos), 3.5); return null; }
    if (u.kind==='dryer'){ const s=PneuSymbol.dryer(sh, x, y, 6*m); sh.text(x+4*m, y-6.2*m, String(u.pos), 3.5); return r.type==='ads' ? null : s.bot; }
    const g=r.grade, drain=g==='carbon' || g==='dust' ? '' : 'auto', s=PneuSymbol.filter(sh, x, y, 5*m, drain, g!=='sep');
    sh.text(x+3.6*m, y-5.4*m, String(u.pos), 3.5);
    return drain ? s.bot : null;
  }
}

if (typeof module!=='undefined') module.exports={ EskdSheet, EquipIcon, PneuSymbol, StationScheme };
