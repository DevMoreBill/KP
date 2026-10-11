// Лист по ЕСКД для чертежей станции в контейнере: формат А4 (ГОСТ 2.301), рамка, основная надпись по форме 1 и
// дополнительные графы (ГОСТ Р 2.104-2023 — как форма 1 ГОСТ 2.104-2006), масштабы (ГОСТ 2.302), линии (ГОСТ 2.303),
// шрифт (ГОСТ 2.304: наклонный, высота прописных 2,5…7 мм), сечения (ГОСТ 2.306), размеры (ГОСТ 2.307), номера позиций
// на полках линий-выносок (ГОСТ Р 2.109-2023), текстовая часть над основной надписью (ГОСТ 2.316).
// EquipIcon — узнаваемые упрощённые рисунки оборудования для габаритного чертежа (схематически сходные с изделием, не
// условные знаки); PneuSymbol — условные графические обозначения
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
    main:[0.5], thin:[0.25], fine:[0.18], frame:[0.6], bold:[0.35], pipe:[0.7],   // fine — ламели, рёбра, штрихи светотени
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
  /** группа с преобразованием SVG (поворот изображения) */
  group(tr, fn){ this.out.push(`<g transform="${tr}">`); fn(); this.out.push('</g>'); }
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

// ---------------------------------------------------------------- изображения оборудования
// Оборудование на габаритном чертеже — не условными обозначениями, а упрощёнными рисунками, схематически сходными с
// изделием: характерные части в пропорциях изделия (размеры деталей — в мм изделия, но не мельче читаемого на листе).
// Компрессор винтовой — кожух на раме с проёмами под вилы погрузчика, съёмные панели с замками, пульт с дисплеем и
// аварийной кнопкой, жалюзи забора воздуха; сзади — решётка охладителя; на ресивере — кожух на горизонтальном ресивере.
// Поршневой — горизонтальный ресивер на опорах, на нём двигатель, кожух ремённой передачи и головка с оребрёнными
// цилиндрами. Ресивер — обечайка с эллиптическими днищами на опорах, люк, табличка, предохранительный клапан и манометр
// сверху, кран слива снизу. Осушитель рефрижераторный — корпус с панелью (индикатор точки росы, дисплей), перфорированной
// решёткой конденсатора и вентилятором, патрубки «вход» и «выход» сверху; адсорбционный — две колонны на раме, верхний и
// нижний коллекторы с клапанами, глушители продувки, блок управления, манометры. Фильтр — головка с индикатором перепада
// давления, стакан с окном уровня, автоматический слив. Шкаф — дверь на петлях, ручка, панель оператора, лампы, вводной
// выключатель, решётка, кабельные вводы. ДГУ — рама, генератор с клеммной коробкой и пультом, двигатель (клапанная крышка,
// турбокомпрессор, воздушный фильтр, поддон), вентилятор и радиатор. Насосный агрегат — двигатель с рёбрами, кожухом
// вентилятора и клеммной коробкой, кожух муфты, насос со спиральным корпусом и патрубками. Бак — горловина с крышкой,
// дыхательный клапан, люк, указатель уровня, кран слива.
class EquipIcon {
  static DARK = '#2b2f33';       // дисплей, окно уровня

  /** вид спереди (разрез А–А): x0…x1, y0 (верх)…y1 (низ), мм листа; сзади — если оборудование обращено к задней стене,
   *  сбоку — повёрнутое поперёк или шкаф на торцевой стене */
  static front(sh, it, x0, y0, x1, y1){
    const c=this.ctx(sh, it, x0, y0, x1, y1); if (!c) return;
    const k=it.kind, a=it.air||{}, look=it.look||'';
    c.side=!!it.rot || Math.abs(it.face)===2; c.rear=!c.side && it.face>0;
    if (it.mount==='pipe') return this.filter(c);
    if (k==='receiver' || it.shape==='hcyl' || it.shape==='vcyl')
      return it.shape==='hcyl' ? this.hreceiver(c, k==='receiver') : it.shape==='vcyl' ? this.vreceiver(c, k==='receiver' ? 'receiver' : 'housing') : this.box(c);
    if (k==='compressor') return look==='piston' ? this.piston(c) : a.recv ? this.tankMounted(c) : this.screw(c);
    if (k==='dryer') return a.type==='ads' || a.type==='gen' ? this.twin(c) : this.refrig(c);
    if (k==='filter') return a.grade==='cond' ? this.separator(c) : this.box(c);
    if (k==='cabinet') return this.cabinet(c, it.mount==='floor' || it.mount==='frame');
    if (k==='dgu') return this.dgu(c);
    if (k==='pump') return c.h>c.w*1.2 ? this.vpump(c) : this.pump(c);
    if (k==='tank') return this.tank(c);
    this.box(c);
  }
  /** вид сверху (разрез Б–Б): лицевая сторона — к проходу (вниз), к задней стене (вверх) или вдоль торца */
  static plan(sh, it, x0, y0, x1, y1){
    if (it.rot && it.mount!=='pipe' && it.shape==='box'){   // повёрнуто поперёк: рисунок вдоль длины изделия, повёрнутый на 90°
      const cx=(x0+x1)/2, cy=(y0+y1)/2, hw=(y1-y0)/2, hh=(x1-x0)/2, f=EskdSheet.f;
      return sh.group(`rotate(90 ${f(cx)} ${f(cy)})`, ()=>this.plan(sh, Object.assign({}, it, { rot:false, lx:it.ly, ly:it.lx, face:-1 }), cx-hw, cy-hh, cx+hw, cy+hh)); }
    const c=this.ctx(sh, it, x0, y0, x1, y1); if (!c) return;
    const k=it.kind, a=it.air||{}, look=it.look||'', f=it.face;
    c.front=f===2 ? 'r' : f===-2 ? 'l' : f>0 ? 't' : 'b';
    if (it.mount==='pipe') return this.filterTop(c);
    if (it.shape==='vcyl') return this.vesselTop(c, k==='receiver');
    if (it.shape==='hcyl') return this.hvesselTop(c);
    if (k==='compressor') return look==='piston' ? this.pistonTop(c) : this.screwTop(c);
    if (k==='dryer') return a.type==='ads' || a.type==='gen' ? this.twinTop(c) : this.refrigTop(c);
    if (k==='cabinet') return this.cabinetTop(c);
    if (k==='dgu') return this.dguTop(c);
    if (k==='pump') return it.h>it.lx*1.2 ? this.vpumpTop(c) : this.pumpTop(c);
    if (k==='tank') return this.tankTop(c);
    c.sh.rect(c.x0, c.y0, c.w, c.h, 'main', '#fff');
  }

  // ---- общее
  /** рамка рисунка: k — мм листа на мм изделия; S(v, min) — размер детали в мм изделия на листе, не меньше min */
  static ctx(sh, it, x0, y0, x1, y1){
    const w=x1-x0, h=y1-y0; if (!(w>0.3 && h>0.3)) return null;
    const k=it.lx>0 ? w/it.lx : 0.02, S=(v, min=0)=>Math.max(min, v*k);
    return { sh, it, k, S, x0, y0, x1, y1, w, h, cx:(x0+x1)/2, cy:(y0+y1)/2, m:Math.min(w, h) };
  }
  static box(c){ c.sh.rect(c.x0, c.y0, c.w, c.h, 'main', '#fff'); if (c.m>3) c.sh.rect(c.x0+c.w*0.1, c.y0+c.h*0.1, c.w*0.8, c.h*0.8, 'thin'); }
  /** решётка — ламели с шагом step (не чаще 0,6 мм листа) */
  static louver(sh, x0, y0, x1, y1, step, frame=true){
    if (x1-x0<1 || y1-y0<1) return; if (frame) sh.rect(x0, y0, x1-x0, y1-y0, 'thin');
    const s=Math.max(0.6, step); for (let y=y0+s*0.7; y<y1-s*0.3; y+=s) sh.line(x0+0.25, y, x1-0.25, y, 'fine');
  }
  /** перфорированная панель — точки сеткой */
  static perforated(sh, x0, y0, x1, y1, step){
    if (x1-x0<1 || y1-y0<1) return; sh.rect(x0, y0, x1-x0, y1-y0, 'thin');
    const s=Math.max(0.75, step), nx=Math.floor((x1-x0)/s), ny=Math.floor((y1-y0)/s), ox=x0+((x1-x0)-(nx-1)*s)/2, oy=y0+((y1-y0)-(ny-1)*s)/2;
    if (nx*ny>1600) return;
    for (let i=0; i<nx; i++) for (let j=0; j<ny; j++) sh.dot(ox+i*s, oy+j*s, Math.min(0.14, s*0.16));
  }
  /** решётка вентилятора: кольца, спицы, ступица */
  static fan(sh, cx, cy, r){
    if (r<0.8) return; sh.circle(cx, cy, r, 'thin', '#fff'); sh.circle(cx, cy, r*0.66, 'fine'); if (r>1.8) sh.circle(cx, cy, r*0.36, 'fine');
    for (let i=0; i<4; i++){ const t=Math.PI/4+i*Math.PI/2; sh.line(cx+Math.cos(t)*r*0.16, cy+Math.sin(t)*r*0.16, cx+Math.cos(t)*r, cy+Math.sin(t)*r, 'fine'); }
    sh.circle(cx, cy, r*0.16, 'thin', '#fff');
  }
  /** круглый прибор: манометр, индикатор */
  static gauge(sh, cx, cy, r){ sh.circle(cx, cy, r, 'thin', '#fff'); if (r>0.5) sh.line(cx, cy, cx+r*0.55, cy-r*0.55, 'thin'); }
  /** рёбра охлаждения: линии вдоль оси */
  static fins(sh, x0, y0, x1, y1, step, vertical){
    const s=Math.max(0.55, step);
    if (vertical) for (let x=x0+s*0.6; x<x1-s*0.3; x+=s) sh.line(x, y0, x, y1, 'fine');
    else for (let y=y0+s*0.6; y<y1-s*0.3; y+=s) sh.line(x0, y, x1, y, 'fine');
  }
  /** штрихи светотени на цилиндре (вдоль оси): у левой кромки — два, у правой — один */
  static shade(sh, x0, y0, x1, y1, vertical=true){
    if (vertical){ const w=x1-x0; if (w<2.5 || y1-y0<1) return; for (const f of [0.09, 0.17, 0.9]) sh.line(x0+w*f, y0, x0+w*f, y1, 'fine'); }
    else { const h=y1-y0; if (h<2.5 || x1-x0<1) return; for (const f of [0.1, 0.19, 0.88]) sh.line(x0, y0+h*f, x1, y0+h*f, 'fine'); }
  }
  /** обечайка с эллиптическими днищами (2:1), вертикальная: x0…x1, y0…y1; швы — тонкие */
  static shell(sh, x0, y0, x1, y1, seams=true){
    const w=x1-x0, h=y1-y0, rx=w/2, ry=Math.min(w/4, h/4), f=EskdSheet.f;
    sh.path(`M${f(x0)},${f(y0+ry)} A${f(rx)},${f(ry)} 0 0 1 ${f(x1)},${f(y0+ry)} L${f(x1)},${f(y1-ry)} A${f(rx)},${f(ry)} 0 0 1 ${f(x0)},${f(y1-ry)} Z`, 'main', '#fff');
    if (seams && h>4*ry){ sh.line(x0, y0+ry, x1, y0+ry, 'thin'); sh.line(x0, y1-ry, x1, y1-ry, 'thin'); }
    return ry;
  }
  /** горизонтальная обечайка с днищами */
  static hshell(sh, x0, y0, x1, y1, seams=true){
    const w=x1-x0, h=y1-y0, ry=h/2, rx=Math.min(h/4, w/4), f=EskdSheet.f;
    sh.path(`M${f(x0+rx)},${f(y0)} L${f(x1-rx)},${f(y0)} A${f(rx)},${f(ry)} 0 0 1 ${f(x1-rx)},${f(y1)} L${f(x0+rx)},${f(y1)} A${f(rx)},${f(ry)} 0 0 1 ${f(x0+rx)},${f(y0)} Z`, 'main', '#fff');
    if (seams && w>4*rx){ sh.line(x0+rx, y0, x0+rx, y1, 'thin'); sh.line(x1-rx, y0, x1-rx, y1, 'thin'); }
    return rx;
  }
  /** предохранительный клапан (корпус, пружинный колпак, рычаг) — вверх от (x, y) */
  static safety(sh, x, y, s){
    const b=Math.max(0.5, s);
    sh.rect(x-b*0.35, y-b*0.8, b*0.7, b*0.8, 'thin', '#fff'); sh.rect(x-b*0.22, y-b*1.9, b*0.44, b*1.1, 'thin', '#fff');
    sh.line(x+b*0.22, y-b*1.6, x+b*0.75, y-b*1.95, 'thin'); sh.rect(x+b*0.35, y-b*0.6, b*0.45, b*0.35, 'thin', '#fff');
  }
  /** шаровой кран с рукояткой: корпус в (x, y) на вертикальной трубе */
  static ball(sh, x, y, s, horizontal){
    const b=Math.max(0.45, s);
    if (horizontal){ sh.rect(x-b*0.55, y-b*0.4, b*1.1, b*0.8, 'thin', '#fff'); sh.line(x, y-b*0.4, x+b*1.1, y-b*0.9, 'thin'); }
    else { sh.rect(x-b*0.4, y-b*0.55, b*0.8, b*1.1, 'thin', '#fff'); sh.line(x+b*0.4, y, x+b*1.2, y+b*0.3, 'thin'); }
  }
  /** рама с проёмами под вилы погрузчика */
  static skid(sh, x0, x1, y0, y1, S){
    const w=x1-x0, hb=y1-y0; sh.rect(x0, y0, w, hb, 'main', '#fff');
    if (w>6 && hb>0.6) for (const f of [0.24, 0.76]){ const pw=Math.max(1, Math.min(S(220), w*0.18)); sh.rect(x0+w*f-pw/2, y0+hb*0.25, pw, hb*0.5, 'thin'); }
  }

  // ---- компрессоры
  /** винтовой (спиральный) компрессор в шумозащитном кожухе */
  static screw(c, tankH=0){
    const { sh, S, x0, x1, w }=c, y0=c.y0, y1=c.y1-tankH, h=y1-y0;
    if (Math.min(w, h)<3){ sh.rect(x0, y0, w, h, 'main', '#fff'); return; }
    const hb=Math.min(S(110, 0.7), h*0.12), yb=y1-hb, top=y0, H=yb-top;
    if (!tankH) this.skid(sh, x0, x1, yb, y1, S); else sh.rect(x0, yb, w, hb, 'main', '#fff');
    sh.rect(x0, top, w, H, 'main', '#fff');
    sh.line(x0, top+S(45, 0.35), x1, top+S(45, 0.35), 'thin');                                        // кромка крыши
    const n=w<6 ? 1 : c.it.lx>=1700 ? 3 : 2, pw=w/n;
    for (let i=1; i<n; i++) sh.line(x0+pw*i, top+S(45, 0.35), x0+pw*i, yb, 'thin');                      // стыки панелей
    if (c.rear || c.side){
      // сзади и сбоку — решётка охладителя (рёбра) и жалюзи забора воздуха
      const gx0=x0+w*0.12, gx1=x1-w*0.12, gy0=top+H*0.12, gy1=top+H*(c.side ? 0.5 : 0.62);
      sh.rect(gx0, gy0, gx1-gx0, gy1-gy0, 'thin', '#fff'); this.fins(sh, gx0, gy0, gx1, gy1, S(28), true);
      this.louver(sh, gx0, top+H*0.68, gx1, yb-H*0.08, S(45));
      return; }
    // спереди: замки панелей, пульт (дисплей, кнопки, аварийная кнопка), жалюзи
    if (h>8) for (let i=0; i<n; i++) for (const fy of [0.2, 0.8]){ const lx=x0+pw*(i+1)-S(70, 0.6); if (i<n-1 || n===1) sh.rect(lx-S(15, 0.15), top+H*fy-S(35, 0.35), S(30, 0.3), S(70, 0.7), 'thin'); }
    const cw=Math.min(S(430, 2.4), pw*0.72), ch=Math.min(S(300, 1.8), H*0.26), cx0=x1-pw/2-cw/2, cy0=top+Math.max(S(140, 0.9), H*0.08);
    sh.rect(cx0, cy0, cw, ch, 'thin', '#fff', S(20));
    sh.rect(cx0+cw*0.1, cy0+ch*0.14, cw*0.48, ch*0.42, 'thin', this.DARK);                             // дисплей
    for (const fx of [0.16, 0.32, 0.48]) sh.circle(cx0+cw*fx, cy0+ch*0.78, Math.min(ch*0.09, S(18, 0.18)), 'thin');   // кнопки
    const er=Math.min(ch*0.2, S(40, 0.3)); sh.circle(cx0+cw*0.8, cy0+ch*0.42, er, 'thin', '#fff'); sh.circle(cx0+cw*0.8, cy0+ch*0.42, er*0.55, 'thin');   // аварийная
    // жалюзи забора воздуха: под пультом и на соседней панели
    const step=S(45);
    this.louver(sh, x1-pw+pw*0.12, cy0+ch+H*0.1, x1-pw*0.12, yb-H*0.1, step);
    if (n>1) this.louver(sh, x0+pw*0.12, top+H*0.32, x0+pw*0.88, yb-H*0.1, step);
    if (n>2) this.louver(sh, x0+pw*1.12, top+H*0.32, x0+pw*1.88, yb-H*0.1, step);
  }
  /** компрессор на горизонтальном ресивере: внизу — ресивер на опорах, на нём кожух */
  static tankMounted(c){
    const th=Math.min(c.h*0.42, c.S(650)), y=c.y1-th;
    this.htank(c, c.x0, y, c.x1, c.y1);
    this.screw(Object.assign({}, c, { y1:c.y1 }), th);
  }
  /** горизонтальный ресивер под компрессором: обечайка на опорах, кран слива */
  static htank(c, x0, y0, x1, y1){
    const { sh, S }=c, w=x1-x0, hl=Math.min((y1-y0)*0.22, S(140, 0.6)), yb=y1-hl;
    for (const f of [0.18, 0.82]){ const lw=Math.max(0.6, S(70)); sh.rect(x0+w*f-lw/2, yb-0.4, lw, hl+0.4, 'thin', '#fff'); sh.rect(x0+w*f-lw*1.1, y1-Math.max(0.25, S(15)), lw*2.2, Math.max(0.25, S(15)), 'thin', '#fff'); }
    this.hshell(sh, x0+w*0.02, y0, x1-w*0.02, yb);
    this.shade(sh, x0+w*0.12, y0, x1-w*0.12, yb, false);
    this.ball(sh, x0+w*0.5, yb+Math.max(0.5, S(45)), S(40), true);
  }
  /** поршневой компрессор на ресивере: двигатель, кожух ремня, головка с оребрёнными цилиндрами */
  static piston(c){
    const { sh, S, x0, x1, w, h }=c, th=Math.min(h*0.45, S(560, 3)), ty=c.y1-th;
    this.htank(c, x0, ty, x1, c.y1);
    if (h-th<2.5) return;
    const pl=ty+Math.max(0.3, S(20)), top=c.y0, H=pl-top;                                              // площадка на ресивере
    sh.rect(x0+w*0.08, pl-Math.max(0.35, S(30)), w*0.84, Math.max(0.35, S(30)), 'thin', '#fff');
    const p0=pl-Math.max(0.35, S(30));
    // кожух ремённой передачи — слева, во всю высоту
    const gw=Math.max(1.2, w*0.16); sh.rect(x0+w*0.06, top+H*0.05, gw, p0-top-H*0.05, 'main', '#fff', gw*0.35);
    for (let y=top+H*0.18; y<p0-H*0.1; y+=Math.max(0.6, S(40))) sh.line(x0+w*0.06+gw*0.2, y, x0+w*0.06+gw*0.8, y, 'fine');
    // двигатель — справа от кожуха, низко; рёбра вдоль оси, клеммная коробка
    const mx0=x0+w*0.06+gw+w*0.02, mx1=x0+w*0.5, mh=Math.min(H*0.45, S(320, 1.5)), my0=p0-mh;
    sh.rect(mx0, my0, mx1-mx0, mh, 'main', '#fff', mh*0.2); this.fins(sh, mx0+mh*0.2, my0+mh*0.12, mx1-mh*0.2, p0-mh*0.12, S(30), false);
    sh.rect(mx0+(mx1-mx0)*0.35, my0-Math.max(0.5, S(70)), (mx1-mx0)*0.3, Math.max(0.5, S(70)), 'thin', '#fff');
    // головка: картер и два цилиндра V-образно с рёбрами, фильтры на всасывании
    const hx=x0+w*0.72, cw=Math.max(1, w*0.13), crank=Math.min(H*0.3, S(220, 1)), cy0=p0-crank;
    sh.rect(hx-cw*1.1, cy0, cw*2.2, crank, 'main', '#fff', cw*0.2);
    for (const s of [-1, 1]){
      const bx=hx+s*cw*0.55, by=cy0, L=Math.min(H*0.5, S(300, 1.6)), ang=s*0.45, ex=bx+Math.sin(ang)*L, ey=by-Math.cos(ang)*L, nx=Math.cos(ang)*cw*0.45, ny=Math.sin(ang)*cw*0.45;
      sh.poly([[bx-nx, by-ny], [bx+nx, by+ny], [ex+nx, ey+ny], [ex-nx, ey-ny]], 'main', '#fff');
      for (let t=0.25; t<0.95; t+=Math.max(0.12, 0.5/Math.max(1, L))) { const px=bx+(ex-bx)*t, py=by+(ey-by)*t; sh.line(px-nx*1.35, py-ny*1.35, px+nx*1.35, py+ny*1.35, 'fine'); }
      sh.circle(ex+Math.sin(ang)*cw*0.4, ey-Math.cos(ang)*cw*0.4, cw*0.42, 'thin', '#fff'); }
    // нагнетание в ресивер и реле давления с манометром
    const rx=x1-w*0.1; sh.path(`M${EskdSheet.f(hx+cw*1.1)},${EskdSheet.f(cy0+crank*0.4)} L${EskdSheet.f(rx)},${EskdSheet.f(cy0+crank*0.4)} L${EskdSheet.f(rx)},${EskdSheet.f(ty)}`, 'thin');
    this.gauge(sh, rx, cy0+crank*0.4-Math.max(0.6, S(60)), Math.max(0.45, S(45)));
  }

  // ---- ресиверы и сосуды
  /** вертикальный сосуд на опорах. receiver — люк, табличка, предохранительный клапан и манометр сверху, кран слива;
   *  housing — корпус фильтра/сепаратора: фланцевая крышка, индикатор перепада */
  static vreceiver(c, kind){
    const { sh, S, x0, x1, w, h, cx }=c, rec=kind==='receiver';
    const hl=Math.min(h*0.14, S(Math.min(320, Math.max(140, c.it.h*0.1)), 0.8)), sb=c.y1-hl;
    const fit=rec && w>2.5 ? Math.min(h*0.12, S(260, 1.6)) : Math.min(h*0.06, S(80, 0.5)), top=c.y0+fit;
    // опоры с плитами
    for (const f of [0.14, 0.86]){ const lx=x0+w*f, lw=Math.max(0.5, Math.min(w*0.08, S(60))); sh.rect(lx-lw/2, sb-Math.min(hl, w*0.18), lw, c.y1-sb+Math.min(hl, w*0.18), 'thin', '#fff');
      sh.rect(lx-lw*1.2, c.y1-Math.max(0.25, S(14)), lw*2.4, Math.max(0.25, S(14)), 'thin', '#fff'); }
    const ry=this.shell(sh, x0, top, x1, sb, true);
    this.shade(sh, x0, top+ry, x1, sb-ry);
    sh.line(cx, c.y0-1.6, cx, c.y1+1.2, 'axis');
    if (w<2.5) return;
    if (rec){
      const L=sb-top-2*ry;
      if (w>4) sh.rect(cx-w*0.32, top+ry+L*0.16, Math.min(w*0.22, S(150)), Math.min(L*0.08, S(100)), 'thin', '#fff');   // табличка
      const mr=Math.min(w*0.17, S(120, 0.6)), my=sb-ry-L*0.22;                                                             // люк
      if (L>4*mr){ sh.circle(cx, my, mr, 'thin', '#fff'); sh.circle(cx, my, mr*0.7, 'thin');
        if (mr>1.4) for (let i=0; i<8; i++){ const t=i*Math.PI/4; sh.dot(cx+Math.cos(t)*mr*0.85, my+Math.sin(t)*mr*0.85, 0.1); } }
      // сверху: штуцер, тройник — предохранительный клапан и манометр
      const st=Math.max(0.5, S(70)), b=Math.max(0.45, Math.min(S(55), w*0.12));
      sh.line(cx, top, cx, top-st, 'thin'); sh.line(cx-b*1.6, top-st, cx+b*1.6, top-st, 'thin');
      this.safety(sh, cx+b*1.6, top-st, b); this.gauge(sh, cx-b*1.6, top-st-b*0.9, b*0.85);
      // снизу: кран слива
      const dy=sb+Math.min(hl*0.45, Math.max(0.6, S(60))); sh.line(cx, sb, cx, dy+b*0.5, 'thin'); this.ball(sh, cx, dy, b*0.8);
      return; }
    // корпус фильтра: фланцевая крышка, индикатор перепада, слив
    const fl=Math.max(0.4, S(40)); sh.rect(x0-fl*0.6, top+ry*0.9, w+fl*1.2, fl, 'thin', '#fff');
    this.gauge(sh, cx+w*0.22, top-Math.max(0.4, S(30)), Math.max(0.4, Math.min(S(40), w*0.1)));
    sh.line(cx, sb, cx, sb+Math.min(hl*0.6, S(80, 0.5)), 'thin');
  }
  /** горизонтальный сосуд на седловых опорах; receiver — с арматурой сверху и сливом */
  static hreceiver(c, rec){
    const { sh, S, x0, x1, w, h }=c, hs=Math.min(h*0.2, S(220, 0.8)), yb=c.y1-hs, fit=rec && h>3 ? Math.min(h*0.18, S(240, 1.4)) : 0, top=c.y0+fit;
    for (const f of [0.2, 0.8]){ const sx=x0+w*f, sw=Math.max(0.8, w*0.08); sh.poly([[sx-sw, c.y1], [sx+sw, c.y1], [sx+sw*0.7, yb-0.4], [sx-sw*0.7, yb-0.4]], 'thin', '#fff'); }
    const rx=this.hshell(sh, x0, top, x1, yb, true);
    this.shade(sh, x0+rx, top, x1-rx, yb, false);
    sh.line(x0-1.6, (top+yb)/2, x1+1.6, (top+yb)/2, 'axis');
    if (!rec || h<3) return;
    const b=Math.max(0.45, Math.min(S(55), h*0.1)), st=Math.max(0.4, S(60)), xa=x0+w*0.42;
    sh.line(xa, top, xa, top-st, 'thin'); sh.line(xa-b*1.6, top-st, xa+b*1.6, top-st, 'thin');
    this.safety(sh, xa+b*1.6, top-st, b); this.gauge(sh, xa-b*1.6, top-st-b*0.9, b*0.85);
    if (w>8) sh.rect(x0+w*0.62, top+(yb-top)*0.3, Math.min(w*0.1, S(150)), Math.min((yb-top)*0.2, S(100)), 'thin', '#fff');   // табличка
    this.ball(sh, x0+w*0.5, yb+Math.min(hs*0.5, Math.max(0.6, S(60))), b*0.8, true);
  }

  // ---- подготовка воздуха
  /** рефрижераторный осушитель: панель с индикатором точки росы, решётка конденсатора с вентилятором, патрубки */
  static refrig(c){
    const { sh, S, x0, x1, w, h }=c;
    if (c.m<3){ sh.rect(x0, c.y0, w, h, 'main', '#fff'); return; }
    const hb=Math.min(S(60, 0.5), h*0.08), yb=c.y1-hb, st=Math.min(S(110, 0.8), h*0.12), top=c.y0+st, H=yb-top;
    for (const f of [0.25, 0.75]){ const pw=Math.max(0.6, S(55)); sh.rect(x0+w*f-pw/2, c.y0, pw, st, 'thin', '#fff'); sh.rect(x0+w*f-pw*0.85, c.y0, pw*1.7, Math.max(0.25, S(18)), 'thin', '#fff'); }   // вход, выход
    for (const f of [0.1, 0.9]) sh.rect(x0+w*f-Math.max(0.4, S(40)), yb, Math.max(0.8, S(80)), hb, 'thin', '#fff');   // опоры
    sh.rect(x0, top, w, H, 'main', '#fff', S(20));
    if (c.rear || c.side){ this.perforated(sh, x0+w*0.1, top+H*0.1, x1-w*0.1, yb-H*0.1, S(32)); this.fan(sh, (x0+x1)/2, top+H/2, Math.min(w, H)*0.3); return; }
    // панель управления сверху: индикатор точки росы, дисплей, выключатель
    const ph=Math.min(H*0.24, S(200, 1.6)); sh.rect(x0+w*0.06, top+H*0.05, w*0.88, ph, 'thin', '#fff');
    const gr=Math.min(ph*0.36, S(55, 0.5)); this.gauge(sh, x0+w*0.2, top+H*0.05+ph/2, gr); sh.circle(x0+w*0.2, top+H*0.05+ph/2, gr*0.7, 'fine');
    sh.rect(x0+w*0.36, top+H*0.05+ph*0.3, w*0.26, ph*0.4, 'thin', this.DARK);
    sh.rect(x0+w*0.74, top+H*0.05+ph*0.3, Math.max(0.5, w*0.08), ph*0.4, 'thin');
    // решётка конденсатора (перфорация) и вентилятор
    const gy0=top+H*0.05+ph+H*0.06, gy1=yb-H*0.07; this.perforated(sh, x0+w*0.08, gy0, x1-w*0.08, gy1, S(32));
    this.fan(sh, (x0+x1)/2, (gy0+gy1)/2, Math.min(w*0.84, gy1-gy0)*0.4);
  }
  /** адсорбционный осушитель (генератор): две колонны, коллекторы, клапаны, глушители, блок управления, манометры */
  static twin(c){
    const { sh, S, x0, x1, w, h }=c;
    if (c.m<3){ sh.rect(x0, c.y0, w, h, 'main', '#fff'); return; }
    const hb=Math.min(S(90, 0.6), h*0.07), yb=c.y1-hb;
    sh.rect(x0, yb, w, hb, 'main', '#fff');                                                            // рама
    const cw=Math.min(w*0.3, S(420, 1.5)), xa=x0+w*0.24, xb=x1-w*0.24, mt=Math.min(h*0.08, S(130, 0.9)), mb=Math.min(h*0.2, S(380, 1.8));
    const ct=c.y0+mt, cb=yb-mb;
    for (const xc of [xa, xb]){ this.shell(sh, xc-cw/2, ct, xc+cw/2, cb, false); this.shade(sh, xc-cw/2, ct+cw/4, xc+cw/2, cb-cw/4); }
    // верхний коллектор с выходом и обратными клапанами, манометры
    const uh=Math.max(0.6, Math.min(S(90), mt*0.55)), uy=c.y0+mt*0.1;
    for (const xc of [xa, xb]) sh.rect(xc-cw*0.12, uy+uh, cw*0.24, ct-uy-uh+cw*0.05, 'thin', '#fff');   // стояки
    sh.rect(xa-cw*0.25, uy, xb-xa+cw*0.5, uh, 'main', '#fff');
    sh.rect(xb+cw*0.25, uy+uh*0.2, Math.max(0.6, S(80)), uh*0.6, 'thin', '#fff');                     // выход
    for (const xc of [xa, xb]) this.gauge(sh, xc+(xc<(xa+xb)/2 ? cw*0.62 : -cw*0.62), ct+cw*0.5+Math.max(0.5, S(50)), Math.max(0.45, Math.min(S(50), cw*0.2)));
    // нижний коллектор: входные клапаны, глушители продувки
    const lh=Math.max(0.7, Math.min(S(120), mb*0.35)), ly=cb+Math.max(0.2, S(25));
    for (const xc of [xa, xb]) sh.rect(xc-cw*0.12, cb-cw*0.05, cw*0.24, ly-cb+cw*0.05, 'thin', '#fff');
    sh.rect(xa-cw*0.3, ly, xb-xa+cw*0.6, lh, 'main', '#fff');
    sh.rect(xa-cw*0.3-Math.max(0.6, S(80)), ly+lh*0.2, Math.max(0.6, S(80)), lh*0.6, 'thin', '#fff');  // вход
    for (const xc of [xa+(xb-xa)*0.3, xa+(xb-xa)*0.7]){ const vw=Math.max(0.6, Math.min(S(80), lh*0.9)); sh.rect(xc-vw/2, ly+lh*0.1, vw, lh*0.8, 'thin', '#fff'); sh.line(xc, ly+lh*0.1, xc, ly-vw*0.5, 'thin'); sh.line(xc-vw*0.4, ly-vw*0.5, xc+vw*0.4, ly-vw*0.5, 'thin'); }   // клапаны
    for (const xc of [xa+(xb-xa)*0.4, xa+(xb-xa)*0.6]){ const gw=Math.max(0.6, S(70)), gh=yb-(ly+lh)-Math.max(0.2, S(20));   // глушители продувки
      if (gh>0.6){ sh.rect(xc-gw/2, ly+lh, gw, gh, 'thin', '#fff', gw*0.3); this.fins(sh, xc-gw/2+0.1, ly+lh, xc+gw/2-0.1, ly+lh+gh, S(22), false); } }
    // блок управления между колоннами
    const gap=(xb-xa)-cw, bw=Math.min(gap*0.8, S(300, 1.4)), bh=Math.min((cb-ct)*0.28, S(380, 1.6)), bx=(xa+xb)/2-bw/2, by=ct+(cb-ct)*0.25;
    if (gap>1.2){ sh.rect(bx, by, bw, bh, 'main', '#fff'); sh.rect(bx+bw*0.15, by+bh*0.15, bw*0.7, bh*0.3, 'thin', this.DARK);
      for (const f of [0.3, 0.5, 0.7]) sh.circle(bx+bw*f, by+bh*0.7, Math.min(bw*0.07, S(15, 0.15)), 'thin'); }
  }
  /** магистральный фильтр на трубе: головка с патрубками и индикатором перепада, стакан с окном уровня, слив */
  static filter(c){
    const { sh, S, x0, x1, w, h, cx }=c, hh=Math.max(0.6, Math.min(h*0.22, S(120))), y0=c.y0;
    const port=Math.max(0.35, S(35)); sh.rect(x0-port, y0+hh*0.25, w+2*port, hh*0.5, 'thin', '#fff');  // патрубки
    sh.rect(x0, y0, w, hh, 'main', '#fff', Math.min(w, hh)*0.15);
    const gr=Math.max(0.3, Math.min(S(35), w*0.22)); sh.line(cx, y0, cx, y0-gr*0.6, 'thin'); this.gauge(sh, cx, y0-gr*1.6, gr);   // индикатор перепада
    const dr=Math.max(0.4, Math.min(h*0.1, S(60))), bx0=x0+w*0.12, bx1=x1-w*0.12, by1=c.y1-dr;
    sh.rect(bx0, y0+hh, bx1-bx0, by1-y0-hh, 'main', '#fff', (bx1-bx0)*0.35);                          // стакан
    if (by1-y0-hh>3 && w>1.2) sh.rect(cx-Math.max(0.12, w*0.05), y0+hh+(by1-y0-hh)*0.3, Math.max(0.24, w*0.1), (by1-y0-hh)*0.4, 'fine', this.DARK);   // окно уровня
    sh.rect(cx-Math.max(0.25, w*0.12), by1, Math.max(0.5, w*0.24), dr*0.6, 'thin', '#fff');            // автоматический слив
    sh.line(cx, by1+dr*0.6, cx, c.y1+Math.max(0.3, S(40)), 'thin');
  }
  /** сепаратор конденсата (водомасляный): ёмкость, колонны с картриджами, ввод конденсата */
  static separator(c){
    const { sh, S, x0, x1, w, h }=c, th=h*0.55, ty=c.y1-th;
    sh.rect(x0, ty, w, th, 'main', '#fff', S(30));
    for (const f of [0.3, 0.7]){ const cw=Math.max(0.8, w*0.2); sh.rect(x0+w*f-cw/2, c.y0+h*0.08, cw, ty-c.y0-h*0.08, 'main', '#fff', cw*0.2); sh.rect(x0+w*f-cw*0.6, c.y0+h*0.05, cw*1.2, Math.max(0.4, S(40)), 'thin', '#fff'); }
    sh.line(x0+w*0.12, ty+th*0.25, x1-w*0.12, ty+th*0.25, 'thin');
    sh.rect(x1-w*0.12, ty+th*0.55, Math.max(0.5, S(60)), Math.max(0.4, S(40)), 'thin', '#fff');        // выход очищенной воды
  }

  // ---- шкафы
  /** шкаф: дверь на петлях, ручка, панель оператора, лампы, вводной выключатель, решётка, кабельные вводы; сбоку — торец */
  static cabinet(c, floor){
    const { sh, S, x0, x1, w, h }=c, pl=floor ? Math.min(S(100, 0.6), h*0.08) : 0, yb=c.y1-pl;
    sh.rect(x0, c.y0, w, yb-c.y0, 'main', '#fff');
    if (pl) sh.rect(x0, yb, w, pl, 'thin', '#fff');
    if (c.m<2.5) return;
    if (c.side){ const e=Math.min(w*0.2, Math.max(0.3, S(25))); sh.line(x1-e, c.y0, x1-e, yb, 'thin'); sh.rect(x1-e*0.6, c.y0+(yb-c.y0)*0.45, e*1.2, (yb-c.y0)*0.1, 'thin'); return; }
    const i=Math.max(0.35, Math.min(S(30), w*0.06)), dx0=x0+i, dy0=c.y0+i, dw=w-2*i, dh=yb-c.y0-2*i;
    sh.rect(dx0, dy0, dw, dh, 'thin');                                                                 // дверь
    for (const f of [0.15, 0.85]) sh.rect(x0-Math.max(0.15, S(12)), dy0+dh*f-Math.max(0.3, S(40)), Math.max(0.3, S(24)), Math.max(0.6, S(80)), 'thin', '#fff');   // петли
    const hx=dx0+dw-Math.max(0.6, S(55)); sh.rect(hx-Math.max(0.2, S(15)), dy0+dh*0.42, Math.max(0.4, S(30)), Math.max(0.9, dh*0.16), 'thin', '#fff', 0.2);   // ручка
    if (dw>3 && dh>4){
      const pw=Math.min(dw*0.5, S(200)), ph=Math.min(dh*0.16, S(140)); sh.rect(dx0+dw*0.12, dy0+dh*0.08, pw, ph, 'thin', this.DARK);   // панель оператора
      for (let q=0; q<3; q++) sh.circle(dx0+dw*0.12+pw*(0.15+q*0.35), dy0+dh*0.08+ph+Math.max(0.6, S(50)), Math.min(dw*0.05, S(18, 0.2)), 'thin');   // лампы
      const sr=Math.min(dw*0.1, S(45, 0.35)); if (dw>4){ sh.circle(dx0+dw*0.78, dy0+dh*0.14, sr, 'thin', '#fff'); sh.line(dx0+dw*0.78-sr*0.8, dy0+dh*0.14+sr*0.8, dx0+dw*0.78+sr*0.8, dy0+dh*0.14-sr*0.8, 'thin'); }   // вводной выключатель
      this.louver(sh, dx0+dw*0.2, dy0+dh*0.78, dx0+dw*0.7, dy0+dh*0.94, S(30), false); }
    if (!floor) for (const f of [0.25, 0.5, 0.75]) sh.rect(x0+w*f-Math.max(0.2, S(15)), yb, Math.max(0.4, S(30)), Math.max(0.4, S(45)), 'thin', '#fff');   // кабельные вводы
  }

  // ---- ДГУ
  /** ДГУ: рама, генератор (слева) с клеммной коробкой и пультом, двигатель, вентилятор и радиатор (справа — к жалюзи) */
  static dgu(c){
    const { sh, S, x0, x1, w, h }=c, hb=Math.min(h*0.12, S(240, 0.8)), yb=c.y1-hb;
    sh.rect(x0, yb, w, hb, 'main', '#fff');
    if (c.m<4){ sh.rect(x0, c.y0, w, yb-c.y0, 'main', '#fff'); return; }
    for (const f of [0.04, 0.96]) sh.circle(x0+w*f, yb+hb/2, Math.min(hb*0.25, S(35, 0.25)), 'thin');  // проушины
    const top=c.y0, H=yb-top;
    // генератор: цилиндр с вентиляционными окнами, клеммная коробка, пульт сверху
    const gx0=x0+w*0.03, gx1=x0+w*0.33, gt=top+H*0.36, gbm=Math.max(0.4, S(60));
    sh.rect(gx0, gt, gx1-gx0, yb-gbm-gt, 'main', '#fff', (yb-gt)*0.12);
    for (const xx of [gx0+(gx1-gx0)*0.1, gx1-(gx1-gx0)*0.1]) this.fins(sh, xx-Math.max(0.5, S(40)), gt+(yb-gt)*0.2, xx+Math.max(0.5, S(40)), yb-gbm-(yb-gt)*0.2, S(35), true);
    sh.rect(gx0+(gx1-gx0)*0.45, gt-Math.max(0.6, H*0.08), (gx1-gx0)*0.3, Math.max(0.6, H*0.08), 'thin', '#fff');   // клеммная коробка
    const pw=(gx1-gx0)*0.62, ph=Math.min(H*0.24, S(450, 1.5)), px0=gx0+(gx1-gx0)*0.08, py0=top+H*0.02;
    sh.line(px0+pw*0.5, py0+ph, px0+pw*0.5, gt-Math.max(0.6, H*0.08), 'thin');
    sh.rect(px0, py0, pw, ph, 'main', '#fff'); sh.rect(px0+pw*0.12, py0+ph*0.15, pw*0.45, ph*0.35, 'thin', this.DARK);   // пульт
    for (const f of [0.75, 0.88]) sh.circle(px0+pw*f, py0+ph*0.32, Math.min(pw*0.05, S(20, 0.2)), 'thin');
    for (const f of [0.08, 0.92]) sh.rect(gx0+(gx1-gx0)*f-Math.max(0.4, S(40)), yb-gbm, Math.max(0.8, S(80)), gbm, 'thin', '#fff');   // виброопоры
    // картер маховика и двигатель: блок, клапанная крышка с рёбрами, поддон, турбокомпрессор, воздушный фильтр
    const ex0=x0+w*0.36, ex1=x0+w*0.76, et=top+H*0.28, eb=yb-H*0.16;
    sh.poly([[gx1, gt+(yb-gt)*0.12], [ex0, et+(eb-et)*0.05], [ex0, eb], [gx1, yb-gbm-(yb-gt)*0.12]], 'thin', '#fff');
    sh.rect(ex0, et, ex1-ex0, eb-et, 'main', '#fff');
    sh.rect(ex0+(ex1-ex0)*0.06, et-H*0.09, (ex1-ex0)*0.84, H*0.09, 'main', '#fff', H*0.02); this.fins(sh, ex0+(ex1-ex0)*0.08, et-H*0.08, ex0+(ex1-ex0)*0.88, et-H*0.01, S(60), true);
    sh.rect(ex0+(ex1-ex0)*0.15, eb, (ex1-ex0)*0.7, yb-gbm-eb, 'thin', '#fff');                     // поддон
    const tx=x0+w*0.62, ty=et+(eb-et)*0.28, tr=Math.min(H*0.08, S(130, 0.6)), ew=Math.max(0.6, Math.min(S(110), tr*1.1));
    sh.rect(tx-ew/2, top, ew, ty-top, 'thin', '#fff');                                                // выхлоп — вверх, к глушителю
    for (let y=top+H*0.05; y<top+H*0.14; y+=Math.max(0.35, S(25))) sh.line(tx-ew*0.65, y, tx+ew*0.65, y, 'fine');   // сильфон
    sh.circle(tx, ty, tr, 'thin', '#fff'); sh.circle(tx, ty, tr*0.45, 'thin');                         // турбокомпрессор
    const af=Math.min(H*0.1, S(170, 0.8)), ax0=ex0+(ex1-ex0)*0.04, ax1=ex0+(ex1-ex0)*0.5, ay=top+H*0.04;
    sh.rect((ax0+ax1)/2-af*0.25, ay+af, af*0.5, et-H*0.09-ay-af, 'thin', '#fff');                     // патрубок воздушного фильтра
    sh.rect(ax0, ay, ax1-ax0, af, 'main', '#fff', af*0.45);                                           // воздушный фильтр
    for (const f of [0.15, 0.85]) sh.rect(ex0+(ex1-ex0)*f-Math.max(0.4, S(40)), yb-gbm, Math.max(0.8, S(80)), gbm, 'thin', '#fff');
    // вентилятор (кожух) и радиатор с бачком
    const rx0=x1-w*0.16, rt=top+H*0.06;
    sh.rect(ex1, et+(eb-et)*0.1, rx0-ex1, (eb-et)*0.7, 'thin', '#fff');
    sh.rect(rx0, rt, x1-rx0-w*0.01, yb-rt, 'main', '#fff');
    this.fins(sh, rx0+(x1-rx0)*0.08, rt+H*0.06, x1-w*0.02, yb-H*0.04, S(35), true);
    sh.rect(rx0+(x1-rx0)*0.15, rt-Math.max(0.5, H*0.04), (x1-rx0)*0.5, Math.max(0.5, H*0.04), 'thin', '#fff');   // бачок с пробкой
  }

  // ---- насосы
  /** горизонтальный насосный агрегат: двигатель с рёбрами и кожухом вентилятора, муфта под кожухом, насос, патрубки */
  static pump(c){
    const { sh, S, x0, x1, w, h }=c;
    if (c.m<3){ sh.rect(x0, c.y0, w, h, 'main', '#fff'); return; }
    const hb=Math.min(h*0.14, S(120, 0.6)), yb=c.y1-hb; sh.rect(x0, yb, w, hb, 'main', '#fff');
    const top=c.y0, H=yb-top, ax=yb-H*0.42, mr=Math.min(H*0.36, S(240, 1.2));                        // ось вала, радиус двигателя
    sh.line(x0-1, ax, x1+1, ax, 'axis');
    // двигатель
    const fc=Math.max(0.8, w*0.07), mx0=x0+w*0.03, mx1=x0+w*0.5;
    sh.rect(mx0, ax-mr*0.82, fc, mr*1.64, 'thin', '#fff', mr*0.3); this.fins(sh, mx0+fc*0.2, ax-mr*0.6, mx0+fc*0.8, ax+mr*0.6, S(20), false);   // кожух вентилятора
    sh.rect(mx0+fc, ax-mr, mx1-mx0-fc, mr*2, 'main', '#fff', mr*0.15); this.fins(sh, mx0+fc+mr*0.1, ax-mr*0.85, mx1-mr*0.1, ax+mr*0.85, S(28), false);
    sh.rect(mx0+fc+(mx1-mx0-fc)*0.4, ax-mr-Math.max(0.6, S(110)), (mx1-mx0-fc)*0.3, Math.max(0.6, S(110)), 'thin', '#fff');   // клеммная коробка
    for (const f of [0.25, 0.8]) sh.rect(mx0+fc+(mx1-mx0-fc)*f-Math.max(0.3, S(40)), ax+mr, Math.max(0.6, S(80)), yb-ax-mr, 'thin', '#fff');   // лапы
    // кожух муфты
    const gx1=x0+w*0.6; sh.poly([[mx1, ax-mr*0.55], [gx1, ax-mr*0.4], [gx1, ax+mr*0.4], [mx1, ax+mr*0.55]], 'thin', '#fff');
    // насос: опорный кронштейн, спиральный корпус, напорный патрубок вверх, всасывающий — по оси вправо
    const vr=Math.min(H*0.42, (x1-gx1)*0.36, S(300, 1.2)), vx=x1-w*0.04-Math.max(0.8, S(120))-vr;
    sh.rect(gx1, ax-mr*0.35, vx-vr*0.6-gx1, mr*0.7, 'thin', '#fff');
    sh.rect(vx-vr*0.5, ax+vr*0.6, vr, yb-ax-vr*0.6, 'thin', '#fff');                                // опора
    const dn=Math.max(0.6, vr*0.55), nl=Math.max(0.8, S(120)), fl=Math.max(0.25, S(20));
    sh.rect(vx-dn/2, ax-vr-nl, dn, nl+vr*0.3, 'main', '#fff');                                       // напорный патрубок
    sh.rect(vx-dn*0.8, ax-vr-nl-fl, dn*1.6, fl, 'thin', '#fff');
    sh.circle(vx, ax, vr, 'main', '#fff'); sh.circle(vx, ax, vr*0.38, 'thin');                         // спиральный корпус, глазок колеса
    sh.rect(vx+vr*0.9, ax-dn*0.6, nl+vr*0.1, dn*1.2, 'main', '#fff');                                   // всасывающий патрубок
    sh.rect(vx+vr+nl, ax-dn*0.85, fl, dn*1.7, 'thin', '#fff');
  }
  /** вертикальный насос: двигатель с кожухом вентилятора сверху, фонарь, ступени с тягами, основание с патрубками */
  static vpump(c){
    const { sh, S, x0, x1, w, h, cx }=c, hb=Math.min(h*0.06, S(60, 0.4)), yb=c.y1-hb, ch=Math.min(h*0.12, S(150, 0.9)), yc=yb-ch;
    sh.rect(x0+w*0.08, yb, w*0.84, hb, 'main', '#fff');                                                 // плита
    sh.rect(x0+w*0.16, yc, w*0.68, ch, 'main', '#fff');                                                 // камера с патрубками в линию
    for (const s of [-1, 1]){ const nx=s<0 ? x0 : x1-w*0.16, fl=Math.max(0.25, S(20));
      sh.rect(nx, yc+ch*0.2, w*0.16, ch*0.6, 'thin', '#fff'); sh.rect(s<0 ? x0 : x1-fl, yc+ch*0.05, fl, ch*0.9, 'thin', '#fff'); }
    const st=yc-h*0.36, sw=w*0.5; sh.rect(cx-sw/2, st, sw, yc-st, 'main', '#fff');
    sh.line(cx-sw*0.42, st, cx-sw*0.42, yc, 'thin'); sh.line(cx+sw*0.42, st, cx+sw*0.42, yc, 'thin');  // тяги
    const ln=st-h*0.12; sh.rect(cx-sw*0.4, ln, sw*0.8, st-ln, 'thin', '#fff'); sh.rect(cx-sw*0.18, ln+(st-ln)*0.25, sw*0.36, (st-ln)*0.5, 'thin');   // фонарь
    const mw=w*0.7, mt=c.y0+h*0.06; sh.rect(cx-mw/2, mt, mw, ln-mt, 'main', '#fff', mw*0.08); this.fins(sh, cx-mw*0.42, mt+h*0.04, cx+mw*0.42, ln-h*0.02, S(28), true);
    sh.rect(cx-mw*0.4, c.y0, mw*0.8, mt-c.y0, 'thin', '#fff', mw*0.1);                                // кожух вентилятора
    sh.rect(cx+mw/2, mt+(ln-mt)*0.3, Math.max(0.6, S(110)), (ln-mt)*0.25, 'thin', '#fff');            // клеммная коробка
    sh.line(cx, c.y0-1.6, cx, c.y1+1.2, 'axis');
  }

  // ---- бак
  static tank(c){
    const { sh, S, x0, x1, w, h }=c, hl=Math.min(h*0.1, S(100, 0.6)), yb=c.y1-hl;
    for (const f of [0.1, 0.9]) sh.rect(x0+w*f-Math.max(0.4, S(40)), yb-0.3, Math.max(0.8, S(80)), hl+0.3, 'thin', '#fff');
    sh.rect(x0, c.y0+Math.min(h*0.1, S(120, 0.6)), w, yb-c.y0-Math.min(h*0.1, S(120, 0.6)), 'main', '#fff', Math.min(w, h)*0.06);
    const top=c.y0+Math.min(h*0.1, S(120, 0.6)), H=yb-top;
    if (c.m<3) return;
    const nw=Math.max(0.8, S(120)); sh.rect(x0+w*0.2-nw/2, top-Math.min(h*0.08, S(100, 0.5)), nw, Math.min(h*0.08, S(100, 0.5)), 'thin', '#fff');   // горловина
    sh.rect(x0+w*0.2-nw*0.7, c.y0, nw*1.4, Math.max(0.3, top-c.y0-Math.min(h*0.08, S(100, 0.5))), 'thin', '#fff');   // крышка
    const bx=x1-w*0.15, f=EskdSheet.f, bh=Math.min(h*0.1, S(150, 0.8));                                // дыхательный клапан
    sh.path(`M${f(bx)},${f(top)} L${f(bx)},${f(top-bh)} A${f(bh*0.3)},${f(bh*0.3)} 0 0 1 ${f(bx+bh*0.6)},${f(top-bh)} L${f(bx+bh*0.6)},${f(top-bh*0.6)}`, 'thin');
    sh.rect(x0+w*0.45, top-Math.max(0.3, S(30)), w*0.2, Math.max(0.3, S(30)), 'thin', '#fff');        // люк
    const gx=x0+w*0.08, gt=top+H*0.15, gb=yb-H*0.15; sh.rect(gx, gt, Math.max(0.5, S(40)), gb-gt, 'thin'); sh.rect(gx+Math.max(0.1, S(10)), gt+(gb-gt)*0.45, Math.max(0.3, S(20)), (gb-gt)*0.5, 'fine', this.DARK);   // указатель уровня
    this.ball(sh, x0+w*0.3, yb+hl*0.3, Math.max(0.4, S(40)), true);                                  // кран слива
  }

  // ---- виды сверху
  static screwTop(c){
    const { sh, S, x0, y0, w, h }=c; sh.rect(x0, y0, w, h, 'main', '#fff'); if (c.m<3) return;
    const i=Math.max(0.3, S(45)); sh.rect(x0+i, y0+i, w-2*i, h-2*i, 'thin');                         // кромка крыши
    // выход охлаждающего воздуха — решётка и вентилятор; со стороны пульта — полоса панели
    const back=c.front==='t' ? 'b' : 't', gx0=x0+w*0.12, gx1=x0+w*0.62, gy0=back==='t' ? y0+h*0.12 : y0+h*0.35, gy1=back==='t' ? y0+h*0.65 : y0+h*0.88;
    sh.rect(gx0, gy0, gx1-gx0, gy1-gy0, 'thin', '#fff'); this.fins(sh, gx0, gy0, gx1, gy1, S(40), true);
    this.fan(sh, x0+w*0.8, y0+h/2, Math.min(w*0.14, h*0.3));
    const pf=Math.max(0.4, S(60)); if (c.front==='b') sh.line(x0+w*0.62, y0+h-pf, x0+w*0.97, y0+h-pf, 'thin'); else sh.line(x0+w*0.62, y0+pf, x0+w*0.97, y0+pf, 'thin');
  }
  static pistonTop(c){
    const { sh, S, x0, y0, x1, w, h, cy }=c;
    sh.rect(x0+w*0.03, y0+h*0.1, w*0.94, h*0.8, 'main', '#fff', h*0.4); if (c.m<3) return;             // ресивер
    sh.rect(x0+w*0.06, y0+h*0.15, w*0.16, h*0.7, 'main', '#fff', 0.3);                                 // кожух ремня
    sh.rect(x0+w*0.24, cy-h*0.22, w*0.26, h*0.44, 'main', '#fff', 0.3); this.fins(sh, x0+w*0.26, cy-h*0.18, x0+w*0.48, cy+h*0.18, S(30), true);
    for (const s of [-1, 1]) this.fan(sh, x0+w*0.72+s*w*0.08, cy, Math.min(w*0.08, h*0.22));          // цилиндры (фильтры на всасывании)
    this.gauge(sh, x1-w*0.1, cy, Math.max(0.45, S(45)));
  }
  static vesselTop(c, rec){
    const { sh, S, cx, cy, m }=c; sh.circle(cx, cy, m/2, 'main', '#fff'); this.axes(sh, cx, cy, m/2+1.6);
    if (!rec || m<3) return;
    const b=Math.max(0.4, Math.min(S(50), m*0.1)); sh.circle(cx-b*1.6, cy, b*0.85, 'thin', '#fff'); sh.rect(cx+b*1.6-b*0.35, cy-b*0.35, b*0.7, b*0.7, 'thin', '#fff');   // манометр, клапан
  }
  static hvesselTop(c){
    const { sh, x0, y0, w, h, cx, cy }=c, hz=w>=h; sh.rect(x0, y0, w, h, 'main', '#fff', Math.min(w, h)/2);
    sh.line(hz ? x0-1.6 : cx, hz ? cy : y0-1.6, hz ? c.x1+1.6 : cx, hz ? cy : c.y1+1.6, 'axis');
    if (hz && w>6){ sh.line(x0+h/4, y0, x0+h/4, c.y1, 'thin'); sh.line(c.x1-h/4, y0, c.x1-h/4, c.y1, 'thin'); }
  }
  static refrigTop(c){
    const { sh, S, x0, y0, w, h }=c; sh.rect(x0, y0, w, h, 'main', '#fff', S(20)); if (c.m<3) return;
    this.fan(sh, x0+w*0.5, y0+h*0.5, Math.min(w, h)*0.3);
    for (const f of [0.25, 0.75]) sh.circle(x0+w*f, c.front==='t' ? c.y1-h*0.2 : y0+h*0.2, Math.max(0.35, S(40)), 'thin', '#fff');   // вход, выход
  }
  static twinTop(c){
    const { sh, S, x0, y0, w, h, cy }=c; sh.rect(x0, y0, w, h, 'thin'); if (c.m<3) return;
    const r=Math.min(w*0.15, h*0.36, S(210)); for (const f of [0.24, 0.76]){ sh.circle(x0+w*f, cy, r, 'main', '#fff'); sh.circle(x0+w*f, cy, r*0.35, 'thin'); }
    sh.rect(x0+w*0.24, cy-Math.max(0.3, S(45)), w*0.52, Math.max(0.6, S(90)), 'thin', '#fff');        // верхний коллектор
  }
  static filterTop(c){
    const { sh, S, x0, y0, w, h, cx, cy, m }=c, port=Math.max(0.35, S(35));
    sh.rect(x0-port, cy-m*0.18, w+2*port, m*0.36, 'thin', '#fff'); sh.rect(x0, y0, w, h, 'main', '#fff', m*0.15);
    if (m>1.6) sh.circle(cx, cy, m*0.2, 'thin', '#fff');
  }
  static cabinetTop(c){
    const { sh, x0, y0, x1, y1, w, h }=c, f=c.front; sh.rect(x0, y0, w, h, 'main', '#fff');
    if (f==='r') sh.line(x1-0.5, y0+0.4, x1-0.5, y1-0.4, 'thin'); else if (f==='l') sh.line(x0+0.5, y0+0.4, x0+0.5, y1-0.4, 'thin');
    else if (f==='t') sh.line(x0+0.4, y0+0.5, x1-0.4, y0+0.5, 'thin'); else sh.line(x0+0.4, y1-0.5, x1-0.4, y1-0.5, 'thin');
  }
  static dguTop(c){
    const { sh, S, x0, y0, x1, w, h, cy }=c; sh.rect(x0, y0, w, h, 'main', '#fff'); if (c.m<4) return;
    sh.rect(x0+w*0.03, y0+h*0.18, w*0.3, h*0.64, 'main', '#fff', h*0.12);                                // генератор
    sh.rect(x0+w*0.13, y0+h*0.06, w*0.1, h*0.12, 'thin', '#fff');                                        // клеммная коробка
    const ex0=x0+w*0.36, ex1=x0+w*0.76; sh.rect(ex0, y0+h*0.22, ex1-ex0, h*0.56, 'main', '#fff');
    const n=6, r=Math.min((ex1-ex0)/(n*2.6), h*0.06); for (let i=0; i<n; i++) sh.circle(ex0+(ex1-ex0)*(i+0.5)/n, cy-h*0.08, r, 'thin');   // цилиндры
    sh.circle(ex0+(ex1-ex0)*0.3, cy+h*0.16, Math.min(h*0.08, S(130)), 'thin', '#fff');                     // выхлоп (турбокомпрессор)
    sh.rect(ex0+(ex1-ex0)*0.5, cy+h*0.1, (ex1-ex0)*0.42, h*0.12, 'thin', '#fff', h*0.05);                // воздушный фильтр
    const rx0=x1-w*0.16; sh.rect(rx0, y0+h*0.04, x1-rx0-w*0.01, h*0.92, 'main', '#fff'); this.fins(sh, rx0, y0+h*0.06, x1-w*0.02, c.y1-h*0.06, S(35), true);
  }
  static pumpTop(c){
    const { sh, S, x0, y0, x1, w, h, cy }=c; sh.rect(x0, y0, w, h, 'thin'); if (c.m<3) return;
    const mr=Math.min(h*0.34, S(240)); sh.rect(x0+w*0.03, cy-mr*0.8, w*0.07, mr*1.6, 'thin', '#fff', mr*0.3);
    sh.rect(x0+w*0.1, cy-mr, w*0.4, mr*2, 'main', '#fff', mr*0.15); this.fins(sh, x0+w*0.12, cy-mr*0.85, x0+w*0.48, cy+mr*0.85, S(28), false);
    sh.rect(x0+w*0.3, cy-mr-Math.max(0.5, S(80)), w*0.12, Math.max(0.5, S(80)), 'thin', '#fff');       // клеммная коробка
    sh.rect(x0+w*0.5, cy-mr*0.45, w*0.1, mr*0.9, 'thin', '#fff');
    const vr=Math.min(h*0.36, w*0.14); sh.rect(x1-w*0.04-vr*2.4, cy-vr, vr*2, vr*2, 'main', '#fff', vr*0.3); sh.circle(x1-w*0.04-vr*1.4, cy, vr*0.45, 'thin', '#fff');   // корпус, напорный
    sh.rect(x1-w*0.04-vr*0.4, cy-vr*0.5, vr*0.4+w*0.03, vr, 'thin', '#fff');                           // всасывающий
  }
  /** вертикальный насос сверху: кожух вентилятора двигателя, клеммная коробка, патрубки в линию */
  static vpumpTop(c){
    const { sh, S, x0, x1, w, cx, cy, m }=c, r=m*0.36;
    sh.rect(x0, cy-m*0.14, w, m*0.28, 'thin', '#fff'); for (const xx of [x0, x1-Math.max(0.25, S(20))]) sh.rect(xx, cy-m*0.22, Math.max(0.25, S(20)), m*0.44, 'thin', '#fff');
    sh.circle(cx, cy, r, 'main', '#fff'); this.fan(sh, cx, cy, r*0.8);
    sh.rect(cx+r*0.6, cy-r-Math.max(0.5, S(90)), r*0.7, Math.max(0.5, S(90)), 'thin', '#fff');
  }
  static tankTop(c){
    const { sh, S, x0, y0, w, h, m }=c; sh.rect(x0, y0, w, h, 'main', '#fff', m*0.06); if (m<3) return;
    sh.circle(x0+w*0.2, y0+h*0.5, Math.min(m*0.12, S(80, 0.4)), 'thin', '#fff'); sh.rect(x0+w*0.45, y0+h*0.3, w*0.2, h*0.4, 'thin');
    sh.circle(c.x1-w*0.15, y0+h*0.5, Math.min(m*0.06, S(40, 0.3)), 'thin');
  }
  /** глушитель ДГУ на крыше: корпус с коническими переходами и хомутами (опоры и вывод выхлопа рисует чертёж) */
  static muffler(sh, x0, y0, x1, y1){
    const w=x1-x0, h=y1-y0; if (!(w>0.3 && h>0.3)) return;
    const cone=Math.min(w*0.12, h*0.6), ym=(y0+y1)/2, p=h*0.22;
    sh.poly([[x0, ym-p], [x0+cone, y0], [x1-cone, y0], [x1, ym-p], [x1, ym+p], [x1-cone, y1], [x0+cone, y1], [x0, ym+p]], 'main', '#fff');
    sh.line(x0+cone, y0, x0+cone, y1, 'thin'); sh.line(x1-cone, y0, x1-cone, y1, 'thin');
    for (const t of [0.32, 0.68]) sh.line(x0+w*t, y0, x0+w*t, y1, 'thin');                             // хомуты
    this.shade(sh, x0+cone, y0, x1-cone, y1, false);
    sh.line(x0-1.6, ym, x1+1.6, ym, 'axis');
  }
  /** центровые линии окружности: штрихпунктирные, за контур */
  static axes(sh, cx, cy, r){ sh.line(cx-r, cy, cx+r, cy, 'axis'); sh.line(cx, cy-r, cx, cy+r, 'axis'); }
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
    const dryer=U.some(x=>x.kind==='dryer' && (x.air||{}).type!=='gen') || comps.some(x=>(x.air||{}).dryer), out=U.filter(u=>u.kind==='receiver' && (u.air||{}).out);
    const note=u=>{ const r=u.air||{};
      if (u.kind==='compressor') return [r.dryer ? 'встроенный осушитель' : '', r.filter ? 'встроенные фильтры' : '', r.vsd ? 'частотное регулирование' : ''].filter(Boolean).join(', ');
      if (u.kind==='dryer') return (r.type==='ads' ? 'адсорбционный' : r.type==='gen' ? 'генератор' : 'рефрижераторный')+(r.filters ? ', встроенные фильтры' : '');
      if (u.kind==='receiver') return [r.role==='dry' ? (dryer ? 'после осушителя' : U.some(x=>x.kind==='filter') ? 'после фильтров' : '') : dryer ? 'до осушителя' : '', r.out ? 'снаружи' : ''].filter(Boolean).join(', ');
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
      ...(out.length ? [`${out.length>1 || (out[0].qty||1)>1 ? 'Ресиверы' : 'Ресивер'} поз. ${[...new Set(out.map(u=>u.pos))].join(', ')} — снаружи контейнера, на площадке; подключение через стену — с запорной арматурой.`] : []),
    ];
    const nH=sh.paras(25, 0, 175, notes, 2.5, false), yN=yList-8-nH;
    sh.paras(25, yN, 175, notes, 2.5);
    // ---- схема: компрессоры слева столбцом, коллектор, аппараты по ходу воздуха строками (змейкой), выход к потребителю —
    // в конце последней строки (нет места — на следующей); модуль m — крупнее, пока помещается над указаниями
    const comp=comps.flatMap(u=>Array.from({ length:Math.min(u.qty||1, 4) }, ()=>u)).slice(0, 6);
    const nodes=chain.flatMap(u=>Array.from({ length:Math.min(u.qty||1, 3) }, ()=>u));
    const built=u=>!!((u.air||{}).dryer || (u.air||{}).filter), wide=comp.some(built), tw=t=>EskdSheet.tw(t, 2.5);
    const outW=Math.max(tw('К потребителю'), a.cls ? tw(`класс ${a.cls}`) : 0);
    const G=this.layout(comp.length, nodes.map(u=>this.half(u)), wide, outW, 30, yN-6);
    const { m, xCol, xs0, xR, xL, S, per, dy, yT, rows:nr, colBot }=G, xM=29+4*(m-1), xC=xM+13*m, yRow=r=>yT+r*this.ROW*m;
    comp.forEach((u, i)=>{ const yo=yT+i*dy, cy=yo+8*m, r=u.air||{};
      PneuSymbol.motor(sh, xM, cy, xC-5*m, 3.4*m); PneuSymbol.compressor(sh, xC, cy, 5*m);
      sh.line(xC, cy-5*m, xC, yo, 'bold'); sh.line(xC, yo, xCol-7.8*m, yo, 'bold');
      if (built(u)){   // встроенные осушитель и фильтры — внутри штрихпунктирной границы компрессорной установки
        if (r.dryer) PneuSymbol.dryer(sh, xC+11*m, yo, 4*m);
        if (r.filter) PneuSymbol.filter(sh, xC+(r.dryer ? 22 : 11)*m, yo, 3.4*m, 'auto');
        sh.rect(xM-5.5*m, yo-6.5*m, xCol-10*m-(xM-5.5*m), 21.5*m, 'axis');
        sh.text(xM-5.5*m, yo-6.5*m-1.2, String(u.pos), 3.5); }
      else sh.text(xM-3.4*m, cy-3.4*m-1.4, String(u.pos), 3.5, { a:'middle' });
      PneuSymbol.valve(sh, xCol-6*m, yo, 1.8*m); sh.line(xCol-4.2*m, yo, xCol, yo, 'bold');
      if (comp.length>1) sh.dot(xCol, yo, 0.6); });
    if (comp.length>1) sh.line(xCol, yT, xCol, yT+(comp.length-1)*dy, 'bold');
    // аппараты: единицы по ходу воздуха (одинаковые — до трёх подряд); перенос строки — у правого (xR) или левого (xL) края
    const P=nodes.map((u, i)=>{ const r=Math.floor(i/per), j=i%per, ltr=r%2===0; return { u, r, ltr, x:ltr ? xs0+j*S : xs0+(per-1-j)*S, y:yRow(r), m }; });
    const drains=[]; let px=xCol, py=yT, pr=0;
    const seg=(x1, y1, x2, y2)=>{ sh.line(x1, y1, x2, y2, 'bold'); if (y1===y2 && Math.abs(x2-x1)>10*m) PneuSymbol.flow(sh, (x1+x2)/2, y1, x2>x1 ? 1 : -1); };
    const wrap=r=>{ const ex=pr%2===0 ? xR : xL; seg(px, py, ex, py); sh.line(ex, py, ex, yRow(r), 'bold'); px=ex; py=yRow(r); pr=r; };
    for (const n of P){
      const w=this.half(n.u)*m;
      if (n.r!==pr) wrap(n.r);
      seg(px, py, n.ltr ? n.x-w : n.x+w, n.y);
      const d=this.node(sh, n); if (d) drains.push({ x:d[0], y:d[1], r:n.r });
      px=n.ltr ? n.x+w : n.x-w; py=n.y; }
    // выход к потребителю: кран, стрелка, класс чистоты — за стрелкой, по ходу строки
    if (nr-1>pr) wrap(nr-1);
    const dir=pr%2===0 ? 1 : -1, xv=px+dir*7*m, xo=px+dir*14*m, tip=xo+dir*2.6, an=dir>0 ? 'start' : 'end';
    seg(px, py, xv-dir*1.8*m, py); PneuSymbol.valve(sh, xv, py, 1.8*m); sh.line(xv+dir*1.8*m, py, xo, py, 'bold'); sh.arrow(tip, py, dir, 0);
    sh.text(tip+dir*1.2, py+0.9, 'К потребителю', 2.5, { a:an });
    if (a.cls) sh.text(tip+dir*1.2, py+4.8, `класс ${a.cls}`, 2.5, { a:an });
    // отвод конденсата: от сливов вниз к линии сбора под строкой; подпись — за стрелкой, где не мешают перенос строки и
    // компрессоры, иначе — под линией
    const lab=cond.length ? `конденсат — к поз. ${cond[0].pos}` : 'конденсат', lw=tw(lab);
    for (const r of [...new Set(drains.map(d=>d.r))]){
      const D=drains.filter(d=>d.r===r), yd=yRow(r)+17*m, x0=Math.min(...D.map(d=>d.x)), x1=Math.max(...D.map(d=>d.x)), ltr=r%2===0, next=r<nr-1;
      const hi=ltr && next ? xR-2 : 200, lo=!ltr && next ? xL+2 : colBot<yd-4 ? 26 : xCol+2;
      for (const d of D) sh.line(d.x, d.y, d.x, yd, 'drain');
      const o=(ltr ? [1, -1] : [-1, 1]).map(d=>({ d, xe:d>0 ? x1+6 : x0-6 })).find(q=>q.d>0 ? q.xe+3.6+lw<=hi : q.xe-3.6-lw>=lo);
      if (o){ sh.line(o.d>0 ? x0 : x1, yd, o.xe, yd, 'drain'); sh.arrow(o.xe+o.d*2.6, yd, o.d, 0); sh.text(o.xe+o.d*3.6, yd+1.2, lab, 2.5, { a:o.d>0 ? 'start' : 'end' }); continue; }
      const d=ltr ? 1 : -1, xe=d>0 ? x1+4 : x0-4; sh.line(d>0 ? x0 : x1, yd, xe, yd, 'drain'); sh.arrow(xe+d*2.6, yd, d, 0);
      if (d>0) sh.text(Math.max(lo+lw, Math.min(hi, xe+2.6)), yd+4.4, lab, 2.5, { a:'end' });
      else sh.text(Math.min(hi-lw, Math.max(lo, xe-2.6)), yd+4.4, lab, 2.5); }
    const code=EskdSheet.code(meta.org, plan.hash, 'П3');
    sh.frame({ name:meta.title||'Станция компрессорная', doc:'Схема пневматическая принципиальная', code, lit:'П', sheets:1, org:meta.org, dev:meta.dev, date:meta.date });
    return sh.svg();
  }
  /** раскладка схемы при модуле m: столбец компрессоров (nc), аппараты строками змейкой (halves — полуширины), выход к
   *  потребителю шириной outW после последнего аппарата — по ходу строки, а если не помещается — на следующей строке.
   *  Модуль 0,7…1,6: из помещающихся над указаниями — меньше строк, затем крупнее (не мельче 0,9, если можно) */
  static layout(nc, halves, wide, outW, top, bottom){
    const geo=m=>{
      const xCol=25+(wide ? 54 : 35)*m, xs0=xCol+14*m, xR=201-2*m, xL=xs0-9*m, S=this.STEP*m, per=Math.max(1, Math.floor((xR-9*m-xs0)/S)+1);
      const dy=wide ? 21.5*m+5.5 : 24*m, yT=top+12, colBot=yT+Math.max(0, nc-1)*dy+15*m, yRow=r=>yT+r*this.ROW*m, n=halves.length;
      const lr=n ? Math.floor((n-1)/per) : 0, ltr=lr%2===0, j=n ? (n-1)%per : 0;
      const px=n ? (ltr ? xs0+j*S+halves[n-1]*m : xs0+(per-1-j)*S-halves[n-1]*m) : xCol;
      const need=14*m+3.8+outW+1, lo=colBot<yRow(lr)-3 ? 26 : xCol+2, room=ltr ? 200-px : px-lo;
      const rows=lr+1+(room>=need ? 0 : 1), h=Math.max(colBot, yRow(rows-1)+17*m+6)-top;
      return { m, xCol, xs0, xR, xL, S, per, dy, yT, rows, colBot, h };
    };
    const C=[16, 15, 14, 13, 12, 11, 10, 9, 8, 7].map(v=>geo(v/10)), fit=C.filter(g=>top+g.h<=bottom), big=fit.filter(g=>g.m>=0.9);
    const pool=big.length ? big : fit.length ? fit : [C[C.length-1]];
    return pool.reduce((b, g)=>g.rows<b.rows || (g.rows===b.rows && g.m>b.m) ? g : b);
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
