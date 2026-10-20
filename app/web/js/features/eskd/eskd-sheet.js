import { EskdFrame } from './eskd-frame.js';

/** Лист ЕСКД А4 в SVG (мм листа): линии (ГОСТ 2.303), шрифт (2.304), сечения (2.306), размеры (2.307), позиции на полках
 *  (ГОСТ Р 2.109), текстовая часть (2.316), рамка и основная надпись (EskdFrame). */
export class EskdSheet {
  static DOTS_PER_MM = 8; // точек растра на 1 мм листа
  static FMT = { A4: [210, 297] };
  // установлен (КОМПАС, AutoCAD), иначе Arial курсивом
  static FONT_DATA = '';
  /** Шрифт листа: osifont, если встроен, иначе запасной. */
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
  static ARROW = [2.8, 0.5]; // стрелка размерной линии

  constructor(fmt) {
    this.fmt = EskdSheet.FMT[fmt] ? fmt : 'A4';
    [this.W, this.H] = EskdSheet.FMT[this.fmt];
    this.out = [];
    this.hatch = false;
  }

  /** Число для SVG — с точностью до 0,01 мм. */
  static fmt(value) {
    return Math.round(value * 100) / 100;
  }
  static _esc(text) {
    return String(text ?? '').replace(
      /[&<>"]/g,
      char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char],
    );
  }
  static _stroke(type, fill) {
    const [width, dash] = this.LINE[type] || this.LINE.thin;
    return `fill="${fill || 'none'}" stroke="#000" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}"` : ' stroke-linecap="round"'}`;
  }
  /** Подсветка на экране («Показать на чертеже»): красная полупрозрачная рамка — только в окне программы, не в КП. */
  mark(x, y, width, height) {
    if (!(width > 0 && height > 0)) return;
    const fmt = EskdSheet.fmt;
    this.out.push(
      `<rect class="hl" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}" rx="1" fill="rgba(229,57,53,0.14)" stroke="#e53935" stroke-width="0.7" stroke-dasharray="1.6 0.8"/>`,
    );
  }
  /** Отрезок линией типа type (ГОСТ 2.303). */
  line(x1, y1, x2, y2, type = 'thin') {
    const fmt = EskdSheet.fmt;
    this.out.push(`<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" ${EskdSheet._stroke(type)}/>`);
  }
  /** Контур по строке пути SVG. */
  path(path, type = 'thin', fill) {
    this.out.push(`<path d="${path}" ${EskdSheet._stroke(type, fill)} stroke-linejoin="round"/>`);
  }
  /** Прямоугольник [x, y, ширина, высота], при cornerR — со скруглением. */
  rect([x, y, width, height], type = 'thin', fill, cornerR) {
    if (!(width > 0 && height > 0)) return;
    const fmt = EskdSheet.fmt;
    this.out.push(
      `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}"${cornerR ? ` rx="${fmt(Math.min(cornerR, width / 2, height / 2))}"` : ''} ${EskdSheet._stroke(type, fill)} stroke-linejoin="round"/>`,
    );
  }
  /** Окружность с центром и радиусом. */
  circle(centerX, centerY, radius, type = 'thin', fill) {
    if (radius > 0) {
      const fmt = EskdSheet.fmt;
      this.out.push(
        `<circle cx="${fmt(centerX)}" cy="${fmt(centerY)}" r="${fmt(radius)}" ${EskdSheet._stroke(type, fill)}/>`,
      );
    }
  }
  /** Ломаная или многоугольник по точкам. */
  poly(points, type = 'thin', fill, open) {
    const fmt = EskdSheet.fmt;
    this.out.push(
      `<${open ? 'polyline' : 'polygon'} points="${points.map(point => `${fmt(point[0])},${fmt(point[1])}`).join(' ')}" ${EskdSheet._stroke(type, fill)} stroke-linejoin="round"/>`,
    );
  }
  /** Растровый рисунок (data:image/…) в прямоугольник. */
  image([x, y, width, height], href, par = 'xMidYMid') {
    if (!(width > 0 && height > 0) || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(String(href || '')))
      return false;
    const fmt = EskdSheet.fmt;
    this.out.push(
      `<image x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}" preserveAspectRatio="${par} meet" href="${href}"/>`,
    );
    return true;
  }
  /** Группа с преобразованием SVG (поворот изображения). */
  group(transform, draw) {
    this.out.push(`<g transform="${transform}">`);
    draw();
    this.out.push('</g>');
  }
  /** Точка (залитый кружок). */
  dot(x, y, radius = 0.45) {
    const fmt = EskdSheet.fmt;
    this.out.push(`<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(radius)}" fill="#000"/>`);
  }
  /** Текст: h — высота прописных, мм (ГОСТ 2.304); o.a — start | middle | end; o.rot — поворот, °. */
  text(x, y, text, height = 3.5, opts = {}) {
    const fmt = EskdSheet.fmt;
    const str = String(text ?? '');
    if (!str) return;
    this.out.push(
      `<text x="${fmt(x)}" y="${fmt(y)}" font-size="${fmt(height * EskdSheet.CAP)}"${opts.a && opts.a !== 'start' ? ` text-anchor="${opts.a}"` : ''}${opts.rot ? ` transform="rotate(${opts.rot} ${fmt(x)} ${fmt(y)})"` : ''}${opts.b ? ' font-weight="700"' : ''}>${EskdSheet._esc(str)}</text>`,
    );
  }
  /** Текст по центру (cx, cy) снизу вверх (поворот на −90°). */
  vtext(centerX, centerY, text, height = 2.5) {
    this.text(centerX + height / 2, centerY, text, height, { a: 'middle', rot: -90 });
  }
  /** Примерная ширина строки, мм. */
  static textWidth(text, height) {
    const str = String(text ?? '');
    const cache = this.FONT_DATA ? this.twO : this.twA;
    let width = cache.get(str);
    if (width === undefined) {
      width = this.twAdd(0, str);
      if (cache.size > 20000) cache.clear();
      cache.set(str, width);
    }
    return width * height;
  }
  static twA = new Map();
  static twO = new Map();
  /** Ширина w (в долях высоты) с дописанной строкой t — по знакам подряд, как у tw (перенос — без пересчёта строки с начала). */
  static twAdd(width, text) {
    const base = this.cw || (this.cw = this.widths());
    const osi = this.FONT_DATA ? this.ow || (this.ow = this.osiWidths()) : null;
    const k = osi ? 1.352 / 1.4 : 1;
    for (const char of text) width += (osi && osi[char]) ?? (base[char] ?? (/[A-Z]/.test(char) ? 0.97 : 0.8)) * k;
    return width;
  }
  /** Ширина знаков osifont Italic в долях высоты прописных (по таблице шрифта; с запасом 3 %, вверх до 0,05; «Э», «Ё», «ё» — по исправленным знакам, .github/scripts/osifont_fix.py). */
  static osiWidths() {
    const widths = {};
    const put = (chars, value) => {
      for (const char of chars) widths[char] = value;
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
    return widths;
  }
  /** Ширина знаков в долях высоты прописных (кегль 1,4 h). */
  static widths() {
    const widths = {};
    const put = (chars, value) => {
      for (const char of chars) widths[char] = value;
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
    return widths;
  }
  /** Перенос по словам на ширину w, мм (по обычным пробелам: неразрывный держит «№ 9» вместе; разряды числа и число с единицей — «1 100 мм», «−40 °C» — не разрываются). */
  static wrap(text, width, height) {
    const out = [];
    let cur = '';
    let curW = 0;
    // cw — ширина cur в долях высоты
    for (const word of this._glue(text)
      .trim()
      .split(/[ \t\n]+/)
      .filter(Boolean)) {
      if (!cur) {
        cur = word;
        curW = this.twAdd(0, word);
        continue;
      }
      const trialW = this.twAdd(curW, ` ${word}`);
      if (trialW * height > width) {
        out.push(cur);
        cur = word;
        curW = this.twAdd(0, word);
      } else {
        cur += ` ${word}`;
        curW = trialW;
      }
    }
    if (cur) out.push(cur);
    return out.map(line => line.replace(/\u00a0/g, ' '));
  }
  static _glue(text) {
    return String(text || '')
      .replace(/(\d) (?=\d{3}(?!\d))/g, '$1\u00a0')
      .replace(/(\d) (?=(?:мм|м²|м³|м\/с|м|°C|кВт|кг|бар|дБА|МПа|В|А)(?![А-Яа-яЁёA-Za-z]))/g, '$1\u00a0');
  }
  /** Строка в ширину w: шрифт меньше, до hMin; не влезает — с многоточием. [строка, высота]. */
  static fit(text, width, height, hMin) {
    const str = String(text || '');
    const minH = hMin || height;
    let size = height;
    while (this.textWidth(str, size) > width && size > minH) size = Math.max(minH, size - 0.25);
    if (this.textWidth(str, size) <= width) return [str, size];
    let shown = str;
    while (shown.length > 1 && this.textWidth(`${shown}…`, size) > width) shown = shown.slice(0, -1);
    return [`${shown.replace(/[\s,.;:–-]+$/, '')}…`, size];
  }
  /** Сечение (ГОСТ 2.306): уже 2 мм — зачернено, шире — штриховка под 45°. */
  section(x, y, width, height) {
    if (!(width > 0 && height > 0)) return;
    if (Math.min(width, height) < 2) this.rect([x, y, width, height], 'thin', '#000');
    else {
      this.hatch = true;
      this.rect([x, y, width, height], 'main', 'url(#eskd-h)');
    }
  }

  /** Стрелка: острие (x, y), направление (ux, uy) — куда смотрит острие. */
  arrow(x, y, dirX, dirY) {
    const [arrowL, arrowW] = EskdSheet.ARROW;
    const pointX = -dirY;
    const pointY = dirX;
    this.poly(
      [
        [x, y],
        [x - dirX * arrowL + pointX * arrowW, y - dirY * arrowL + pointY * arrowW],
        [x - dirX * arrowL - pointX * arrowW, y - dirY * arrowL - pointY * arrowW],
      ],
      'thin',
      '#000',
    );
  }
  /** Горизонтальный размер от x1 до x2 на уровне y; e1, e2 — y точек контура (выносные линии; null — без них); o.lift — число выше на столько строк (тесная цепочка размеров), o.tx — его середина; o.tick — засечки вместо стрелок; o.h — высота цифр; o.out ('r' | 'l') — число, которое не помещается, — на продолжении размерной линии справа или слева. */
  dimH([x1, x2], y, label, [ext1, ext2], opts = {}) {
    const textH = opts.h || 3.5;
    const str = String(label);
    const labelW = EskdSheet.textWidth(str, textH);
    const out = opts.out && labelW + 1 > x2 - x1 && !opts.force ? opts.out : '';
    this.extH([x1, ext1], y);
    this.extH([x2, ext2], y);
    this.dimLineH([x1, x2], y, opts.tick, [out === 'l' ? x1 - labelW - 3 : x1, out === 'r' ? x2 + labelW + 3 : x2]);
    if (out) this.text(out === 'r' ? x2 + 2 + labelW / 2 : x1 - 2 - labelW / 2, y - 0.8, str, textH, { a: 'middle' });
    else this.dimTextH([x1, x2], y, str, opts);
  }

  /** Выносная линия от точки контура (x, e) за размерную на 2 мм; e — null: без неё. */
  extH([x, ext], y) {
    if (ext != null) this.line(x, ext, x, ext > y ? y - 2 : y + 2);
  }

  /** Размерная линия: засечки под 45° (tick), стрелки внутри или — тесно — снаружи; xa…xb — с выносом под число. */
  dimLineH([x1, x2], y, tick, [innerA, innerB]) {
    const arrowL = EskdSheet.ARROW[0];
    if (tick) {
      this.line(x1 - 1.5, y, x2 + 1.5, y);
      for (const x of [x1, x2]) this.line(x - 1, y + 1, x + 1, y - 1, 'main');
    } else if (x2 - x1 >= 2 * arrowL + 1.5) {
      this.line(innerA, y, innerB, y);
      this.arrow(x1, y, -1, 0);
      this.arrow(x2, y, 1, 0);
    } else {
      this.line(Math.min(innerA, x1 - arrowL - 2.5), y, Math.max(innerB, x2 + arrowL + 2.5), y);
      this.arrow(x1, y, 1, 0);
      this.arrow(x2, y, -1, 0);
    }
  }

  /** Число над размерной линией; не помещается — выше на o.lift строк с линией-выноской к o.tx. */
  dimTextH([x1, x2], y, str, opts) {
    const textH = opts.h || 3.5;
    const mid = (x1 + x2) / 2;
    const lift = opts.lift ?? (EskdSheet.textWidth(str, textH) + 1 > x2 - x1 && !opts.force ? 1 : 0);
    if (!lift) {
      this.text(mid, y - 0.8, str, textH, { a: 'middle' });
      return;
    }
    const textY = y - 0.8 - lift * (textH + 1.6);
    const textX = opts.tx ?? mid;
    this.line(mid, y, textX, textY + 0.6);
    this.text(textX, textY, str, textH, { a: 'middle' });
  }
  /** Вертикальный размер от y1 (верх) до y2 (низ) на x; e1, e2 — x точек контура; число — слева от линии, снизу вверх; o.out — число, которое не помещается между выносными линиями, — над верхней из них, на продолжении размерной линии. */
  dimV([y1, y2], x, label, [ext1, ext2], opts = {}) {
    const arrowL = EskdSheet.ARROW[0];
    const textH = opts.h || 3.5;
    const str = String(label);
    const span = y2 - y1;
    const labelW = EskdSheet.textWidth(str, textH);
    const out = opts.out && labelW + 2 > span;
    for (const [y, ext] of [
      [y1, ext1],
      [y2, ext2],
    ])
      if (ext != null) this.line(ext, y, ext > x ? x - 2 : x + 2, y);
    if (span >= 2 * arrowL + 1.5) {
      this.line(x, out ? y1 - labelW - 3 : y1, x, y2);
      this.arrow(x, y1, 0, -1);
      this.arrow(x, y2, 0, 1);
    } else {
      this.line(x, y1 - (out ? labelW + 3 : arrowL + 2.5), x, y2 + arrowL + 2.5);
      this.arrow(x, y1, 0, 1);
      this.arrow(x, y2, 0, -1);
    }
    this.text(x - 0.8, out ? y1 - 2 - labelW / 2 : (y1 + y2) / 2, str, textH, { a: 'middle', rot: -90 });
  }

  /** Выноска номера позиции: точка, линия и полка с номером. */
  pos([pointX, pointY], [shelfX, shelfY], num, dir = 1) {
    const textH = 5;
    const boxW = EskdSheet.textWidth(String(num), textH) + 1.6;
    this.dot(pointX, pointY, 0.5);
    this.line(pointX, pointY, shelfX, shelfY);
    this.line(shelfX, shelfY, shelfX + dir * boxW, shelfY);
    this.text(shelfX + (dir * boxW) / 2, shelfY - 0.9, String(num), textH, { a: 'middle' });
  }
  /** Полки номеров позиций в строку (axis 'x') или колонку ('y'). */
  static shelves(base, axis, [low, high], [shelfAt, at2 = null], gap) {
    if (!base.length) return [];
    const k = axis === 'x' ? 'x' : 'y';
    const sorted = [...base].sort((mark, second) => mark[k] - second[k]);
    if (at2 != null && base.length > 1 && (high - low) / (base.length - 1) < this.shelfMin(base))
      return [
        ...this.shelves(
          sorted.filter((mark, i) => i % 2 === 0),
          axis,
          [low, high],
          [shelfAt],
          gap,
        ),
        ...this.shelves(
          sorted.filter((mark, i) => i % 2 === 1),
          axis,
          [low, high],
          [at2],
          gap,
        ),
      ];
    const gapWant = axis === 'x' ? Math.max(gap, this.shelfMin(base)) : gap; // в строку — не теснее ширины полки номера
    const count = sorted.length;
    const gapUsed = Math.min(gapWant, count > 1 ? Math.max(0, high - low) / (count - 1) : gapWant);
    const coords = EskdSheet.spread(
      sorted.map(mark => Math.max(low, Math.min(high, mark[k]))),
      gapUsed,
      high,
    );
    const placed = sorted.map((mark, i) => ({
      px: mark.x,
      py: mark.y,
      n: mark.n,
      sx: k === 'x' ? coords[i] : shelfAt,
      sy: k === 'x' ? shelfAt : coords[i],
    }));
    EskdSheet.uncross(placed, k === 'x' ? 'sx' : 'sy');
    return placed;
  }

  /** Места полок по возрастанию с шагом не меньше g, последняя — не дальше hi. */
  static spread(coords, gap, high) {
    const count = coords.length;
    for (let i = 1; i < count; i++) coords[i] = Math.max(coords[i], coords[i - 1] + gap);
    if (coords[count - 1] > high) {
      coords[count - 1] = high;
      for (let i = count - 2; i >= 0; i--) coords[i] = Math.min(coords[i], coords[i + 1] - gap);
    }
    return coords;
  }

  /** Выноски p и q пересекаются. */
  static cross(first, second) {
    const orient = ([startX, startY], [midX, midY], [centerX, centerY]) =>
      (midX - startX) * (centerY - startY) - (midY - startY) * (centerX - startX);
    const [firstStart, firstEnd, secondStart, secondEnd] = [
      [first.px, first.py],
      [first.sx, first.sy],
      [second.px, second.py],
      [second.sx, second.sy],
    ];
    return (
      orient(firstStart, firstEnd, secondStart) * orient(firstStart, firstEnd, secondEnd) < 0 &&
      orient(secondStart, secondEnd, firstStart) * orient(secondStart, secondEnd, firstEnd) < 0
    );
  }

  /** Пересекающиеся выноски меняются полками (t — 'sx' или 'sy'), пока пересечения есть (не больше 60 проходов). */
  static uncross(list, axis) {
    for (let pass = 0; pass < 60 && EskdSheet.swapPass(list, axis); pass++);
  }

  /** Один проход: каждая пересекающаяся пара меняется полками; true — было что менять. */
  static swapPass(list, axis) {
    let changed = false;
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++)
        if (EskdSheet.cross(list[i], list[j])) {
          [list[i][axis], list[j][axis]] = [list[j][axis], list[i][axis]];
          changed = true;
        }
    return changed;
  }

  /** Наименьший шаг полок, при котором номера не налезают: полка самого длинного номера + зазор. */
  static shelfMin(base) {
    return Math.max(...base.map(mark => this.textWidth(String(mark.n), 5))) + 1.6 + 0.6;
  }

  /** Пункты с номерами (ГОСТ 2.316): перенос с отступом; рисовать — draw; возвращает высоту, мм. */
  paras([x, y, width], items, height = 2.5, draw = true) {
    const lineH = height * 1.55;
    const ind = EskdSheet.textWidth('10. ', height);
    let lineY = y;
    items.forEach((para, i) => {
      const lines = EskdSheet.wrap(para, width - ind, height);
      const num = items.length > 1 ? `${i + 1}. ` : '';
      lines.forEach((line, k) => {
        lineY += lineH;
        if (draw) {
          if (!k && num) this.text(x, lineY, num, height);
          this.text(x + (num ? ind : 0), lineY, line, height);
        }
      });
    });
    return lineY - y + height * 0.5;
  }
  /** Таблица: левый верх, ширины колонок, заголовки, строки ([текст | [текст, 'c']]); возвращает высоту. */
  table([x, y], cols, head, rows, [rowH = 5, headH = 6, textH = 2.5] = []) {
    const totalW = cols.reduce((sum, width) => sum + width, 0);
    const totalH = headH + rows.length * rowH;
    this.rect([x, y, totalW, totalH], 'main');
    this.line(x, y + headH, x + totalW, y + headH, 'main');
    let cellX = x;
    cols.forEach((colW, i) => {
      if (i) this.line(cellX, y, cellX, y + totalH, 'main');
      this.text(cellX + colW / 2, y + headH / 2 + textH * 0.5, head[i], textH, { a: 'middle' });
      cellX += colW;
    });
    rows.forEach((row, j) => {
      const rowY = y + headH + j * rowH;
      if (j) this.line(x, rowY, x + totalW, rowY, 'thin');
      let colX = x;
      cols.forEach((colW, i) => {
        const cell = row[i];
        const [text, align] = Array.isArray(cell) ? cell : [cell, i ? 'l' : 'c'];
        const [fitted, fittedH] = EskdSheet.fit(text, colW - 2.4, textH, 2.3);
        this.text(align === 'c' ? colX + colW / 2 : colX + 0.8, rowY + rowH / 2 + fittedH * 0.5, fitted, fittedH, {
          a: align === 'c' ? 'middle' : 'start',
        });
        colX += colW;
      });
    });
    return totalH;
  }

  /** Рамка и основная надпись (EskdFrame). */
  frame(titleBlock) {
    EskdFrame.draw(this, titleBlock);
  }

  /** Документ SVG: лист в мм, растр — K точек на мм. */
  svg() {
    const dots = EskdSheet.DOTS_PER_MM;
    const font = EskdSheet.FONT_DATA
      ? `<style>@font-face{font-family:osifont;font-style:italic;src:url(data:font/ttf;base64,${EskdSheet.FONT_DATA}) format('truetype')}</style>`
      : '';
    const defs =
      font +
      (this.hatch
        ? '<pattern id="eskd-h" width="1.4" height="1.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="1.4" stroke="#000" stroke-width="0.18"/></pattern>'
        : '');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.W * dots}" height="${this.H * dots}" viewBox="0 0 ${this.W} ${this.H}" font-family="${EskdSheet.FONT}" font-style="italic" style="font-synthesis:none"><defs>${defs}</defs><rect width="${this.W}" height="${this.H}" fill="#ffffff"/>${this.out.join('')}</svg>`;
  }
  /** Масштаб для основной надписи: 1:50. */
  static scale(ratio) {
    return `1:${String(ratio).replace('.', ',')}`;
  }
  /** Дата для основной надписи: 2026-10-11 → 11.10.26. */
  static date(iso) {
    const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[3]}.${match[2]}.${match[1].slice(2)}` : '';
  }
  /** Обозначение документа. */
  static code(org, hash, kind) {
    const letters =
      String(org || '')
        .toUpperCase()
        .replace(/[^А-ЯЁ]/g, '')
        .replace(/^(ООО|АО|ПАО|ЗАО|ИП)/, '')
        .slice(0, 4) || 'КПСТ';
    const hashText = String(hash || '0');
    const num = parseInt(hashText.slice(0, 8), 16);
    const digits = String(
      (Number.isFinite(num) ? num : [...hashText].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 7)) %
        1000000,
    ).padStart(6, '0');
    return `${letters}.${digits}.001 ${kind}`;
  }
}
