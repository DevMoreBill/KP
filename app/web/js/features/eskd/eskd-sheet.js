import { EskdFrame } from './eskd-frame.js';

/** Лист ЕСКД А4 в SVG (мм листа): линии (ГОСТ 2.303), шрифт (2.304), сечения (2.306), размеры (2.307), позиции на полках
 *  (ГОСТ Р 2.109), текстовая часть (2.316), рамка и основная надпись (EskdFrame). */
export class EskdSheet {
  static K = 8; // точек растра на 1 мм листа
  static FMT = { A4: [210, 297] };
  // установлен (КОМПАС, AutoCAD), иначе Arial курсивом
  static FONT_DATA = '';
  static get FONT() {
    return this.FONT_DATA
      ? 'osifont, Arial, Helvetica, sans-serif'
      : "'GOST type B', 'GOST Type BU', ISOCPEUR, Arial, Helvetica, sans-serif";
  }
  /** Кегль = высота прописных × CAP: у osifont прописная — 0,74 кегля, у Arial — 0,72. */
  static get CAP() {
    return this.FONT_DATA ? 1.352 : 1.4;
  }
  // линии (ГОСТ 2.303)
  static LINE = {
    main: [0.5],
    thin: [0.25],
    fine: [0.18],
    frame: [0.6],
    bold: [0.35],
    pipe: [0.7], // fine — ламели, рёбра, штрихи светотени
    dash: [0.25, '2.4 1.2'], // штриховая — невидимый контур
    axis: [0.25, '7 1.4 0.6 1.4'],
    phantom: [0.25, '7 1.4 0.6 1 0.6 1.4'],
    cut: [0.8], // разомкнутая — линия сечения
    drain: [0.3, '2 1'], // схема: отвод конденсата
  };
  static SCALES = [1, 2, 2.5, 4, 5, 10, 15, 20, 25, 40, 50, 75, 100, 200, 400, 500, 800, 1000]; // уменьшения (ГОСТ 2.302)
  static AR = [2.8, 0.5]; // стрелка размерной линии

  constructor(fmt) {
    this.fmt = EskdSheet.FMT[fmt] ? fmt : 'A4';
    [this.W, this.H] = EskdSheet.FMT[this.fmt];
    this.out = [];
    this.hatch = false;
  }

  static f(v) {
    return Math.round(v * 100) / 100;
  }
  static esc(s) {
    return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  }
  static st(type, fill) {
    const [w, d] = this.LINE[type] || this.LINE.thin;
    return `fill="${fill || 'none'}" stroke="#000" stroke-width="${w}"${d ? ` stroke-dasharray="${d}"` : ' stroke-linecap="round"'}`;
  }
  /** Подсветка на экране («Показать на чертеже»): красная полупрозрачная рамка — только в окне программы, не в КП. */
  mark(x, y, w, h) {
    if (!(w > 0 && h > 0)) return;
    const f = EskdSheet.f;
    this.out.push(
      `<rect class="hl" x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="1" fill="rgba(229,57,53,0.14)" stroke="#e53935" stroke-width="0.7" stroke-dasharray="1.6 0.8"/>`,
    );
  }
  line(x1, y1, x2, y2, type = 'thin') {
    const f = EskdSheet.f;
    this.out.push(`<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" ${EskdSheet.st(type)}/>`);
  }
  path(d, type = 'thin', fill) {
    this.out.push(`<path d="${d}" ${EskdSheet.st(type, fill)} stroke-linejoin="round"/>`);
  }
  rect([x, y, w, h], type = 'thin', fill, rx) {
    if (!(w > 0 && h > 0)) return;
    const f = EskdSheet.f;
    this.out.push(
      `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}"${rx ? ` rx="${f(Math.min(rx, w / 2, h / 2))}"` : ''} ${EskdSheet.st(type, fill)} stroke-linejoin="round"/>`,
    );
  }
  circle(cx, cy, r, type = 'thin', fill) {
    if (r > 0) {
      const f = EskdSheet.f;
      this.out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" ${EskdSheet.st(type, fill)}/>`);
    }
  }
  poly(P, type = 'thin', fill, open) {
    const f = EskdSheet.f;
    this.out.push(
      `<${open ? 'polyline' : 'polygon'} points="${P.map(p => `${f(p[0])},${f(p[1])}`).join(' ')}" ${EskdSheet.st(type, fill)} stroke-linejoin="round"/>`,
    );
  }
  /** Растровый рисунок (data:image/…) в прямоугольник. */
  image([x, y, w, h], href, par = 'xMidYMid') {
    if (!(w > 0 && h > 0) || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(String(href || '')))
      return false;
    const f = EskdSheet.f;
    this.out.push(
      `<image x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" preserveAspectRatio="${par} meet" href="${href}"/>`,
    );
    return true;
  }
  /** Группа с преобразованием SVG (поворот изображения). */
  group(tr, fn) {
    this.out.push(`<g transform="${tr}">`);
    fn();
    this.out.push('</g>');
  }
  dot(x, y, r = 0.45) {
    const f = EskdSheet.f;
    this.out.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="#000"/>`);
  }
  /** Текст: h — высота прописных, мм (ГОСТ 2.304); o.a — start | middle | end; o.rot — поворот, °. */
  text(x, y, s, h = 3.5, o = {}) {
    const f = EskdSheet.f;
    const t = String(s ?? '');
    if (!t) return;
    this.out.push(
      `<text x="${f(x)}" y="${f(y)}" font-size="${f(h * EskdSheet.CAP)}"${o.a && o.a !== 'start' ? ` text-anchor="${o.a}"` : ''}${o.rot ? ` transform="rotate(${o.rot} ${f(x)} ${f(y)})"` : ''}${o.b ? ' font-weight="700"' : ''}>${EskdSheet.esc(t)}</text>`,
    );
  }
  /** Текст по центру (cx, cy) снизу вверх (поворот на −90°). */
  vtext(cx, cy, s, h = 2.5) {
    this.text(cx + h / 2, cy, s, h, { a: 'middle', rot: -90 });
  }
  /** Примерная ширина строки, мм. */
  static tw(s, h) {
    const t = String(s ?? '');
    const M = this.FONT_DATA ? this.twO : this.twA;
    let w = M.get(t);
    if (w === undefined) {
      w = this.twAdd(0, t);
      if (M.size > 20000) M.clear();
      M.set(t, w);
    }
    return w * h;
  }
  static twA = new Map();
  static twO = new Map();
  /** Ширина w (в долях высоты) с дописанной строкой t — по знакам подряд, как у tw (перенос — без пересчёта строки с начала). */
  static twAdd(w, t) {
    const A = this.cw || (this.cw = this.widths());
    const O = this.FONT_DATA ? this.ow || (this.ow = this.osiWidths()) : null;
    const k = O ? 1.352 / 1.4 : 1;
    for (const c of t) w += (O && O[c]) ?? (A[c] ?? (/[A-Z]/.test(c) ? 0.97 : 0.8)) * k;
    return w;
  }
  /** Ширина знаков osifont Italic в долях высоты прописных (по таблице шрифта; с запасом 3 %, вверх до 0,05; «Э», «Ё», «ё» — по исправленным знакам, .github/scripts/osifont_fix.py). */
  static osiWidths() {
    const W = {};
    const put = (chars, v) => {
      for (const c of chars) W[c] = v;
    };
    put("ijI.,:!|'", 0.3);
    put('l;()[]', 0.35);
    put('сt1³²{}`', 0.45);
    put('зухcr', 0.5);
    put('бгеоэяУfJ"°^', 0.55);
    put('авкртчъёСaksvxyz \u00a0-=+*<>±?$_~\\', 0.6);
    put('лнпьЕЁЗТЧЬЭbdeghnopquCEFL0235679/–×', 0.65);
    put('джцГКХЯSTZ48«»', 0.7);
    put('имфшБВОРwBGKPR#&', 0.75);
    put('йщыюАДИЙНПmADHNOQUVXY', 0.8);
    put('ЛЦ—', 0.85);
    put('МФM', 0.9);
    put('Ъ', 0.95);
    put('ЫЮW%', 1);
    put('ЖШ@', 1.05);
    put('Щ', 1.1);
    put('№', 1.2);
    put('’', 0.3);
    put('·', 0.3);
    return W;
  }
  /** Ширина знаков в долях высоты прописных (кегль 1,4 h). */
  static widths() {
    const W = {};
    const put = (chars, v) => {
      for (const c of chars) W[c] = v;
    };
    put('абдеёийлнопрц', 0.79);
    put('вья', 0.75);
    put('гсухчэ', 0.71);
    put('зк', 0.67);
    put('ъ', 0.87);
    put('жмыю', 1.05);
    put('тфшщ', 1.19);
    put('АБВЕЁРХЯЬ', 0.94);
    put('ГТКУЗ', 0.88);
    put('ДИЙНПСЦЧЭЛ', 1.02);
    put('ОФЪ', 1.13);
    put('МЫ', 1.24);
    put('ЖШЩ', 1.3);
    put('Ю', 1.44);
    put('abcdeghnopqu', 0.78);
    put('kvxyzs', 0.71);
    put('ilj', 0.32);
    put('ft', 0.4);
    put('r', 0.47);
    put('mw', 1.17);
    put('IJ', 0.7);
    put('W', 1.33);
    put('M', 1.17);
    put('0123456789', 0.78);
    put(' \u00a0.,:;/', 0.39);
    put("()-³²'", 0.47);
    put('"', 0.5);
    put('«»–×', 0.8);
    put('—→…№', 1.46);
    return W;
  }
  /** Перенос по словам на ширину w, мм (по обычным пробелам: неразрывный держит «№ 9» вместе; разряды числа и число с единицей — «1 100 мм», «−40 °C» — не разрываются). */
  static wrap(s, w, h) {
    const out = [];
    let cur = '';
    let cw = 0;
    // cw — ширина cur в долях высоты
    for (const word of this.glue(s)
      .trim()
      .split(/[ \t\n]+/)
      .filter(Boolean)) {
      if (!cur) {
        cur = word;
        cw = this.twAdd(0, word);
        continue;
      }
      const tw = this.twAdd(cw, ` ${word}`);
      if (tw * h > w) {
        out.push(cur);
        cur = word;
        cw = this.twAdd(0, word);
      } else {
        cur += ` ${word}`;
        cw = tw;
      }
    }
    if (cur) out.push(cur);
    return out.map(t => t.replace(/\u00a0/g, ' '));
  }
  static glue(s) {
    return String(s || '')
      .replace(/(\d) (?=\d{3}(?!\d))/g, '$1\u00a0')
      .replace(/(\d) (?=(?:мм|м²|м³|м\/с|м|°C|кВт|кг|бар|дБА|МПа|В|А)(?![А-Яа-яЁёA-Za-z]))/g, '$1\u00a0');
  }
  /** Строка в ширину w: шрифт меньше, до hMin; не влезает — с многоточием. [строка, высота]. */
  static fit(s, w, h, hMin) {
    const str = String(s || '');
    const lo = hMin || h;
    let hh = h;
    while (this.tw(str, hh) > w && hh > lo) hh = Math.max(lo, hh - 0.25);
    if (this.tw(str, hh) <= w) return [str, hh];
    let t = str;
    while (t.length > 1 && this.tw(`${t}…`, hh) > w) t = t.slice(0, -1);
    return [`${t.replace(/[\s,.;:–-]+$/, '')}…`, hh];
  }
  /** Сечение (ГОСТ 2.306): уже 2 мм — зачернено, шире — штриховка под 45°. */
  section(x, y, w, h) {
    if (!(w > 0 && h > 0)) return;
    if (Math.min(w, h) < 2) this.rect([x, y, w, h], 'thin', '#000');
    else {
      this.hatch = true;
      this.rect([x, y, w, h], 'main', 'url(#eskd-h)');
    }
  }

  /** Стрелка: острие (x, y), направление (ux, uy) — куда смотрит острие. */
  arrow(x, y, ux, uy) {
    const [L, b] = EskdSheet.AR;
    const px = -uy;
    const py = ux;
    this.poly(
      [
        [x, y],
        [x - ux * L + px * b, y - uy * L + py * b],
        [x - ux * L - px * b, y - uy * L - py * b],
      ],
      'thin',
      '#000',
    );
  }
  /** Горизонтальный размер от x1 до x2 на уровне y; e1, e2 — y точек контура (выносные линии; null — без них); o.lift — число выше на столько строк (тесная цепочка размеров), o.tx — его середина; o.tick — засечки вместо стрелок; o.h — высота цифр; o.out ('r' | 'l') — число, которое не помещается, — на продолжении размерной линии справа или слева. */
  dimH([x1, x2], y, t, [e1, e2], o = {}) {
    const h = o.h || 3.5;
    const s = String(t);
    const tw = EskdSheet.tw(s, h);
    const out = o.out && tw + 1 > x2 - x1 && !o.force ? o.out : '';
    this.extH([x1, e1], y);
    this.extH([x2, e2], y);
    this.dimLineH([x1, x2], y, o.tick, [out === 'l' ? x1 - tw - 3 : x1, out === 'r' ? x2 + tw + 3 : x2]);
    if (out) this.text(out === 'r' ? x2 + 2 + tw / 2 : x1 - 2 - tw / 2, y - 0.8, s, h, { a: 'middle' });
    else this.dimTextH([x1, x2], y, s, o);
  }

  /** Выносная линия от точки контура (x, e) за размерную на 2 мм; e — null: без неё. */
  extH([x, e], y) {
    if (e != null) this.line(x, e, x, e > y ? y - 2 : y + 2);
  }

  /** Размерная линия: засечки под 45° (tick), стрелки внутри или — тесно — снаружи; xa…xb — с выносом под число. */
  dimLineH([x1, x2], y, tick, [xa, xb]) {
    const L = EskdSheet.AR[0];
    if (tick) {
      this.line(x1 - 1.5, y, x2 + 1.5, y);
      for (const x of [x1, x2]) this.line(x - 1, y + 1, x + 1, y - 1, 'main');
    } else if (x2 - x1 >= 2 * L + 1.5) {
      this.line(xa, y, xb, y);
      this.arrow(x1, y, -1, 0);
      this.arrow(x2, y, 1, 0);
    } else {
      this.line(Math.min(xa, x1 - L - 2.5), y, Math.max(xb, x2 + L + 2.5), y);
      this.arrow(x1, y, 1, 0);
      this.arrow(x2, y, -1, 0);
    }
  }

  /** Число над размерной линией; не помещается — выше на o.lift строк с линией-выноской к o.tx. */
  dimTextH([x1, x2], y, s, o) {
    const h = o.h || 3.5;
    const mid = (x1 + x2) / 2;
    const lift = o.lift ?? (EskdSheet.tw(s, h) + 1 > x2 - x1 && !o.force ? 1 : 0);
    if (!lift) {
      this.text(mid, y - 0.8, s, h, { a: 'middle' });
      return;
    }
    const yt = y - 0.8 - lift * (h + 1.6);
    const tx = o.tx ?? mid;
    this.line(mid, y, tx, yt + 0.6);
    this.text(tx, yt, s, h, { a: 'middle' });
  }
  /** Вертикальный размер от y1 (верх) до y2 (низ) на x; e1, e2 — x точек контура; число — слева от линии, снизу вверх; o.out — число, которое не помещается между выносными линиями, — над верхней из них, на продолжении размерной линии. */
  dimV([y1, y2], x, t, [e1, e2], o = {}) {
    const L = EskdSheet.AR[0];
    const h = o.h || 3.5;
    const s = String(t);
    const span = y2 - y1;
    const tw = EskdSheet.tw(s, h);
    const out = o.out && tw + 2 > span;
    for (const [y, e] of [
      [y1, e1],
      [y2, e2],
    ])
      if (e != null) this.line(e, y, e > x ? x - 2 : x + 2, y);
    if (span >= 2 * L + 1.5) {
      this.line(x, out ? y1 - tw - 3 : y1, x, y2);
      this.arrow(x, y1, 0, -1);
      this.arrow(x, y2, 0, 1);
    } else {
      this.line(x, y1 - (out ? tw + 3 : L + 2.5), x, y2 + L + 2.5);
      this.arrow(x, y1, 0, 1);
      this.arrow(x, y2, 0, -1);
    }
    this.text(x - 0.8, out ? y1 - 2 - tw / 2 : (y1 + y2) / 2, s, h, { a: 'middle', rot: -90 });
  }

  pos([px, py], [sx, sy], n, dir = 1) {
    const h = 5;
    const w = EskdSheet.tw(String(n), h) + 1.6;
    this.dot(px, py, 0.5);
    this.line(px, py, sx, sy);
    this.line(sx, sy, sx + dir * w, sy);
    this.text(sx + (dir * w) / 2, sy - 0.9, String(n), h, { a: 'middle' });
  }
  /** Полки номеров позиций в строку (axis 'x') или колонку ('y'). */
  static shelves(A, axis, [lo, hi], [at, at2 = null], gap) {
    if (!A.length) return [];
    const k = axis === 'x' ? 'x' : 'y';
    const S = [...A].sort((a, b) => a[k] - b[k]);
    if (at2 != null && A.length > 1 && (hi - lo) / (A.length - 1) < this.shelfMin(A))
      return [
        ...this.shelves(
          S.filter((a, i) => i % 2 === 0),
          axis,
          [lo, hi],
          [at],
          gap,
        ),
        ...this.shelves(
          S.filter((a, i) => i % 2 === 1),
          axis,
          [lo, hi],
          [at2],
          gap,
        ),
      ];
    const g0 = axis === 'x' ? Math.max(gap, this.shelfMin(A)) : gap; // в строку — не теснее ширины полки номера
    const n = S.length;
    const g = Math.min(g0, n > 1 ? Math.max(0, hi - lo) / (n - 1) : g0);
    const c = EskdSheet.spread(
      S.map(a => Math.max(lo, Math.min(hi, a[k]))),
      g,
      hi,
    );
    const L = S.map((a, i) => ({ px: a.x, py: a.y, n: a.n, sx: k === 'x' ? c[i] : at, sy: k === 'x' ? at : c[i] }));
    EskdSheet.uncross(L, k === 'x' ? 'sx' : 'sy');
    return L;
  }

  /** Места полок по возрастанию с шагом не меньше g, последняя — не дальше hi. */
  static spread(c, g, hi) {
    const n = c.length;
    for (let i = 1; i < n; i++) c[i] = Math.max(c[i], c[i - 1] + g);
    if (c[n - 1] > hi) {
      c[n - 1] = hi;
      for (let i = n - 2; i >= 0; i--) c[i] = Math.min(c[i], c[i + 1] - g);
    }
    return c;
  }

  /** Выноски p и q пересекаются. */
  static cross(p, q) {
    const d = ([ax, ay], [bx, by], [cx, cy]) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const [P0, P1, Q0, Q1] = [
      [p.px, p.py],
      [p.sx, p.sy],
      [q.px, q.py],
      [q.sx, q.sy],
    ];
    return d(P0, P1, Q0) * d(P0, P1, Q1) < 0 && d(Q0, Q1, P0) * d(Q0, Q1, P1) < 0;
  }

  /** Пересекающиеся выноски меняются полками (t — 'sx' или 'sy'), пока пересечения есть (не больше 60 проходов). */
  static uncross(L, t) {
    for (let it = 0; it < 60 && EskdSheet.swapPass(L, t); it++);
  }

  /** Один проход: каждая пересекающаяся пара меняется полками; true — было что менять. */
  static swapPass(L, t) {
    let ch = false;
    for (let i = 0; i < L.length; i++)
      for (let j = i + 1; j < L.length; j++)
        if (EskdSheet.cross(L[i], L[j])) {
          [L[i][t], L[j][t]] = [L[j][t], L[i][t]];
          ch = true;
        }
    return ch;
  }

  /** Наименьший шаг полок, при котором номера не налезают: полка самого длинного номера + зазор. */
  static shelfMin(A) {
    return Math.max(...A.map(a => this.tw(String(a.n), 5))) + 1.6 + 0.6;
  }

  /** Пункты с номерами (ГОСТ 2.316): перенос с отступом; рисовать — draw; возвращает высоту, мм. */
  paras([x, y, w], items, h = 2.5, draw = true) {
    const lh = h * 1.55;
    const ind = EskdSheet.tw('10. ', h);
    let yy = y;
    items.forEach((t, i) => {
      const L = EskdSheet.wrap(t, w - ind, h);
      const num = items.length > 1 ? `${i + 1}. ` : '';
      L.forEach((ln, k) => {
        yy += lh;
        if (draw) {
          if (!k && num) this.text(x, yy, num, h);
          this.text(x + (num ? ind : 0), yy, ln, h);
        }
      });
    });
    return yy - y + h * 0.5;
  }
  /** Таблица: левый верх, ширины колонок, заголовки, строки ([текст | [текст, 'c']]); возвращает высоту. */
  table([x, y], cols, head, rows, [rh = 5, hh = 6, h = 2.5] = []) {
    const W = cols.reduce((a, b) => a + b, 0);
    const Ht = hh + rows.length * rh;
    this.rect([x, y, W, Ht], 'main');
    this.line(x, y + hh, x + W, y + hh, 'main');
    let cx = x;
    cols.forEach((c, i) => {
      if (i) this.line(cx, y, cx, y + Ht, 'main');
      this.text(cx + c / 2, y + hh / 2 + h * 0.5, head[i], h, { a: 'middle' });
      cx += c;
    });
    rows.forEach((r, j) => {
      const yy = y + hh + j * rh;
      if (j) this.line(x, yy, x + W, yy, 'thin');
      let xx = x;
      cols.forEach((c, i) => {
        const v = r[i];
        const [t, al] = Array.isArray(v) ? v : [v, i ? 'l' : 'c'];
        const [s, hs] = EskdSheet.fit(t, c - 2.4, h, 2.3);
        this.text(al === 'c' ? xx + c / 2 : xx + 0.8, yy + rh / 2 + hs * 0.5, s, hs, {
          a: al === 'c' ? 'middle' : 'start',
        });
        xx += c;
      });
    });
    return Ht;
  }

  /** Рамка и основная надпись (EskdFrame). */
  frame(tb) {
    EskdFrame.draw(this, tb);
  }

  /** Документ SVG: лист в мм, растр — K точек на мм. */
  svg() {
    const K = EskdSheet.K;
    const font = EskdSheet.FONT_DATA
      ? `<style>@font-face{font-family:osifont;font-style:italic;src:url(data:font/ttf;base64,${EskdSheet.FONT_DATA}) format('truetype')}</style>`
      : '';
    const defs =
      font +
      (this.hatch
        ? '<pattern id="eskd-h" width="1.4" height="1.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.4" stroke="#000" stroke-width="0.18"/></pattern>'
        : '');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.W * K}" height="${this.H * K}" viewBox="0 0 ${this.W} ${this.H}" font-family="${EskdSheet.FONT}" font-style="italic" style="font-synthesis:none"><defs>${defs}</defs><rect width="${this.W}" height="${this.H}" fill="#ffffff"/>${this.out.join('')}</svg>`;
  }
  /** Масштаб для основной надписи: 1:50. */
  static scale(n) {
    return `1:${String(n).replace('.', ',')}`;
  }
  /** Дата для основной надписи: 2026-10-11 → 11.10.26. */
  static date(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : '';
  }
  /** Обозначение документа. */
  static code(org, hash, kind) {
    const L =
      String(org || '')
        .toUpperCase()
        .replace(/[^А-ЯЁ]/g, '')
        .replace(/^(ООО|АО|ПАО|ЗАО|ИП)/, '')
        .slice(0, 4) || 'КПСТ';
    const h = String(hash || '0');
    const v = parseInt(h.slice(0, 8), 16);
    const d = String(
      (Number.isFinite(v) ? v : [...h].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)) % 1000000,
    ).padStart(6, '0');
    return `${L}.${d}.001 ${kind}`;
  }
}
