import { Mm } from '../layout/mm.js';
import { RalColor } from '../layout/ral-color.js';

const FONT = '"Arial Black", "Segoe UI Black", "Helvetica Neue", Arial, sans-serif';
const RED = '#c8102e';

/** Табло и надписи: строки, фон, цвет текста; табло — в две строки (читается издалека). */
const BOARDS = {
  EXIT: [['ВЫХОД'], '#00843d', '#ffffff'],
  POW_OUT: [['ПОРОШОК!', 'УХОДИ!'], '#ffffff', '#d0021b'],
  POW_NO: [['ПОРОШОК!', 'НЕ ВХОДИ!'], '#ffffff', '#d0021b'],
  AUTO_OFF: [['АВТОМАТИКА', 'ОТКЛЮЧЕНА'], '#ffffff', '#0b6b22'],
  DT: [['ДТ'], '#f9a800', '#000000'],
  OPS: [['ОПС'], '#ffffff', RED],
};

/**
 * Наклейки 3D-вида станции на холсте: логотип организации (фирменные цвета шаблона КП, «О» у ПНЕВМОТЕХ — глобус),
 * логотипы производителей, знаки безопасности ГОСТ 12.4.026-2015, таблички и табло, маркировка груза ГОСТ 14192-96,
 * стрелки направления потока на трубах, рисунки заказчика.
 */
export class StDecal {
  static imgs = new Map();
  static FONT = FONT;
  static ASPECT = {
    F04: 1,
    W01: 1.15,
    W08: 1.15,
    P02: 1,
    P06: 1,
    EXIT: 2.77,
    POW_OUT: 2.77,
    POW_NO: 2.77,
    AUTO_OFF: 2.77,
    DT: 1.85,
    CAT: 1.5,
    OPS: 2.68,
    SLING: 0.6,
    COG: 1,
    MASS: 2.65,
    FLOW: 3.2,
    FLOWV: 0.3125,
  };

  /** Производитель без поля «Производитель» — по названию (есть в каталоге логотипов), пропорции табличек, логотип организации. */
  static async meta(plan, meta) {
    let all = {};
    if (typeof loadLogos === 'function') {
      try {
        all = (await loadLogos()) || {};
      } catch {
        all = {};
      }
    }
    const { logos, makers } = StDecal.makers(plan, all);
    return { ...meta, logos, makers, brand: StDecal.brandParts() };
  }

  /** Производители позиций станции по каталогу. */
  static makers(plan, all) {
    const logos = {};
    const makers = {};
    const keys = Object.keys(all)
      .filter(k => k.length >= 3)
      .sort((left, right) => right.length - left.length);
    const words = text =>
      ` ${String(text)
        .toLowerCase()
        .replace(/[^a-zа-яё0-9]+/g, ' ')} `;
    for (const item of [...(plan.items || []), ...(plan.outside || [])]) {
      const own = String(item.maker || '').trim();
      const k = own
        ? null
        : keys.find(key => words(item.name || '').includes(` ${key.replace(/[^a-zа-яё0-9]+/g, ' ').trim()} `));
      if (k) makers[item.id] = String(all[k].maker || k);
      const maker = k ? makers[item.id] : own;
      StDecal.logoShape(logos, maker);
    }
    return { logos, makers };
  }

  /** Пропорции таблички логотипа производителя (по картинке логотипа). */
  static logoShape(logos, maker) {
    const logo = maker && typeof logoFor === 'function' ? logoFor(maker) : null;
    if (logo && logo.w > 0 && logo.h > 0)
      logos[maker.toLowerCase()] = Math.max(1.2, Math.min(8, (logo.w / logo.h + 0.36) / 1.36));
  }

  /** Логотип организации: части надписи с цветами из шаблона КП; «ПНЕВМОТЕХ» — фирменные синие всегда. */
  static brandParts() {
    const pack = typeof TPL_CACHE !== 'undefined' && typeof S !== 'undefined' ? TPL_CACHE[S.template] : null;
    const settings = (pack && pack.settings) || {};
    const col = settings.colors || {};
    const parts = (settings.brandParts || [])
      .map(part => [
        String((part && part[0]) || '').trim(),
        `#${String(col[part && part[1]] || (part && part[1]) || '0B45A0').replace(/^#/, '')}`,
      ])
      .filter(part => part[0] && /^#[0-9a-f]{6}$/i.test(part[1]));
    return !parts.length || /^пневмотех$/i.test(parts.map(part => part[0]).join('')) ? StOutfit.BRAND : parts;
  }

  /** Загрузить картинки логотипов и рисунков заказчика, нужные сцене. */
  static async prepare(scene) {
    for (const decal of scene.decals.values()) {
      const src = StDecal.srcOf(decal);
      if (!src || StDecal.imgs.has(src)) continue;
      try {
        StDecal.imgs.set(src, await readImg(src));
      } catch {
        StDecal.imgs.set(src, null);
      }
    }
  }

  /** Адрес картинки наклейки. */
  static srcOf(decal) {
    if (decal.type === 'art') return decal.src;
    return decal.type === 'logo' && typeof logoFor === 'function' ? (logoFor(decal.maker) || {}).src : null;
  }

  /** Холст наклейки: ширина до 1024 точек, высота — по пропорции. */
  static canvas(decal) {
    const ratio = Math.max(0.2, Math.min(12, decal.ar || StDecal.ASPECT[decal.id] || 1));
    const width = ratio >= 1 ? 1024 : Math.round(1024 * ratio);
    const height = Math.max(16, Math.round(width / ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const draw = { brand: StDecal.brand, art: StDecal.art, logo: StDecal.logo }[decal.type];
    if (draw) draw(ctx, width, height, decal);
    else StDecal.sign(ctx, width, height, decal.id, decal);
    return canvas;
  }

  /** Рисунок заказчика во весь холст; не загрузился — пустая рамка. */
  static art(ctx, width, height, decal) {
    const image = StDecal.imgs.get(decal.src);
    if (image) {
      ctx.drawImage(image, 0, 0, width, height);
      return;
    }
    ctx.strokeStyle = 'rgba(0,0,0,.35)';
    ctx.lineWidth = Math.max(4, width / 120);
    ctx.setLineDash([width / 40, width / 60]);
    ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, width - 2 * ctx.lineWidth, height - 2 * ctx.lineWidth);
  }

  /** Скруглённый прямоугольник. */
  static roundRect(ctx, [x, y, width, height], radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }

  /** Строки текста по центру: [текст, доля высоты, цвет] — каждая вписана в ширину, промежутки поровну. */
  static rows(ctx, width, height, rows) {
    const gap = (1 - rows.reduce((sum, row) => sum + row[1], 0)) / (rows.length + 1);
    let y = gap * height;
    for (const [text, k, color] of rows) {
      StDecal.text(ctx, text, {
        x: width / 2,
        y: y + k * height * 0.53,
        w: width * 0.88,
        size: k * height * 1.25,
        color,
      });
      y += (k + gap) * height;
    }
  }

  /** Текст по центру, вписанный в ширину w (шрифт уменьшается). */
  static text(ctx, text, { x, y, w: maxW, size, weight = 900, color, font = 'Arial, sans-serif' }) {
    ctx.font = `${weight} ${size}px ${font}`;
    const k = Math.min(1, maxW / Math.max(1, ctx.measureText(text).width));
    ctx.font = `${weight} ${Math.floor(size * k)}px ${font}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  /** Логотип организации: части своих цветов (на тёмной стене — белыми); «О» — глобус; внизу «группа компаний» вразрядку. */
  static brand(ctx, width, height, decal) {
    const parts = decal.parts && decal.parts.length ? decal.parts : StOutfit.BRAND;
    const tag = decal.tag || '';
    const pad = height * 0.02;
    const ink = color => (decal.light ? '#ffffff' : color);
    const mainH = (height - 2 * pad) * (tag ? 0.7 : 0.92);
    const segs = parts.flatMap(([text, color], i) =>
      decal.globe && i === 0 && /О$/i.test(text)
        ? [
            { t: text.slice(0, -1), c: color },
            { globe: true, c: color },
          ]
        : [{ t: text, c: color }],
    );
    let size = mainH * 1.25;
    const font = sizePx => `900 ${sizePx}px ${FONT}`;
    const globeR = () => size * 0.4;
    const textW = () => {
      ctx.font = font(size);
      return segs.reduce(
        (sum, seg) => sum + (seg.globe ? 2 * globeR() + size * 0.06 : ctx.measureText(seg.t).width),
        0,
      );
    };
    const maxW = width - 2 * pad - height * 0.04;
    if (textW() > maxW) size *= maxW / textW();
    const total = textW();
    const y = pad + mainH * 0.5 + (tag ? 0 : (height - 2 * pad - mainH) / 2);
    let x = (width - total) / 2;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = font(size);
    for (const seg of segs) {
      if (seg.globe) {
        const radius = globeR();
        StDecal.globe(
          ctx,
          { cx: x + size * 0.03 + radius, cy: y + size * 0.02, r: radius },
          decal.parts && decal.parts[1] ? decal.parts[1][1] : '#3DA0EE',
          seg.c,
        );
        x += 2 * radius + size * 0.06;
      } else {
        ctx.fillStyle = ink(seg.c);
        ctx.fillText(seg.t, x, y + size * 0.04);
        x += ctx.measureText(seg.t).width;
      }
    }
    if (tag) StDecal.tag(ctx, { width, height, pad, total, tag, color: ink(parts[0][1]) });
  }

  /** Подпись под логотипом. */
  static tag(ctx, { width, height, pad, total, tag, color }) {
    const textH = (height - 2 * pad) * 0.17;
    const textY = height - pad - textH * 0.75;
    const letters = [...tag];
    const step = total / letters.length;
    ctx.font = `600 ${textH}px Arial, sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    letters.forEach((letter, k) => ctx.fillText(letter, (width - total) / 2 + step * (k + 0.5), textY));
  }

  /** Глобус: шар с переходом цвета и белыми изогнутыми полосами. */
  static globe(ctx, { cx: midX, cy: midY, r: radius }, light, dark) {
    const grad = ctx.createRadialGradient(midX - radius * 0.35, midY - radius * 0.4, radius * 0.1, midX, midY, radius);
    grad.addColorStop(0, light);
    grad.addColorStop(1, dark);
    ctx.save();
    ctx.beginPath();
    ctx.arc(midX, midY, radius, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.clip();
    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';
    for (const [dy, lineK, k] of [
      [-0.42, 0.11, 0.55],
      [-0.05, 0.13, 0.4],
      [0.34, 0.11, 0.3],
    ]) {
      ctx.lineWidth = radius * lineK;
      ctx.beginPath();
      ctx.moveTo(midX - radius * 1.1, midY + radius * (dy + k * 0.5));
      ctx.quadraticCurveTo(midX, midY + radius * (dy - k * 0.6), midX + radius * 1.1, midY + radius * (dy + k * 0.2));
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Логотип производителя: картинка на светлой табличке или название цветом, контрастным корпусу. */
  static logo(ctx, width, height, decal) {
    const logo = typeof logoFor === 'function' ? logoFor(decal.maker) : null;
    const image = logo && StDecal.imgs.get(logo.src);
    if (image) {
      ctx.fillStyle = '#ffffff';
      StDecal.roundRect(ctx, [0, 0, width, height], height * 0.14);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = height * 0.03;
      StDecal.roundRect(
        ctx,
        [height * 0.02, height * 0.02, width - height * 0.04, height - height * 0.04],
        height * 0.12,
      );
      ctx.stroke();
      const imgW = image.naturalWidth || image.width;
      const imgH = image.naturalHeight || image.height;
      const k = Math.min((width - height * 0.36) / imgW, (height * 0.72) / imgH);
      ctx.drawImage(image, (width - imgW * k) / 2, (height - imgH * k) / 2, imgW * k, imgH * k);
      return;
    }
    const rgb = RalColor.rgb(decal.bg || '#cccccc');
    const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    StDecal.text(ctx, String(decal.maker || '').toUpperCase(), {
      x: width / 2,
      y: height / 2,
      w: width * 0.96,
      size: height * 0.82,
      color: lum > 0.55 ? '#1d2733' : '#ffffff',
      font: FONT,
    });
  }

  /** Знаки безопасности, таблички и табло; d — описание наклейки. */
  static sign(ctx, width, height, id, decal = {}) {
    const side = Math.min(width, height);
    const draw = StDecal.SIGNS[id];
    if (draw) {
      draw(ctx, { width, height, side, decal, id });
      return;
    }
    const board = BOARDS[id];
    if (board) StDecal.board(ctx, { width, height, side }, board);
  }

  /** Рисунки знаков по номеру. */
  static get SIGNS() {
    return {
      F04: StDecal.f04,
      W01: StDecal.warning,
      W08: StDecal.warning,
      P02: StDecal.p02,
      P06: StDecal.p06,
      SLING: StDecal.cargoSign,
      COG: StDecal.cargoSign,
      MASS: StDecal.cargoSign,
      FLOW: StDecal.flow,
      FLOWV: StDecal.flow,
      CAT: StDecal.cat,
    };
  }

  /** F04 «Огнетушитель»: корпус, головка, рукоятка, шланг; справа — пламя. */
  static f04(ctx, { width, height, side }) {
    ctx.fillStyle = RED;
    StDecal.roundRect(ctx, [0, 0, width, height], side * 0.06);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    StDecal.roundRect(ctx, [width * 0.22, height * 0.36, width * 0.24, height * 0.52], side * 0.08);
    ctx.fill();
    ctx.fillRect(width * 0.29, height * 0.26, width * 0.1, height * 0.12);
    ctx.fillRect(width * 0.22, height * 0.22, width * 0.3, height * 0.05);
    ctx.lineWidth = side * 0.05;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(width * 0.39, height * 0.3);
    ctx.quadraticCurveTo(width * 0.62, height * 0.26, width * 0.6, height * 0.5);
    ctx.stroke();
    StDecal.flame(ctx, width * 0.72, height * 0.62, side * 0.3, '#ffffff');
  }

  /** W01 «Пожароопасно», W08 «Электрический ток»: жёлтый треугольник с чёрной каймой. */
  static warning(ctx, { width, height, side, id }) {
    const pad = side * 0.04;
    const inner = side * 0.13;
    ctx.fillStyle = '#000000';
    StDecal.poly(ctx, [
      [width / 2, pad],
      [width - pad, height - pad],
      [pad, height - pad],
    ]);
    ctx.lineJoin = 'round';
    ctx.fill();
    ctx.fillStyle = '#f9a800';
    StDecal.poly(ctx, [
      [width / 2, pad + inner * 1.6],
      [width - pad - inner * 1.15, height - pad - inner * 0.62],
      [pad + inner * 1.15, height - pad - inner * 0.62],
    ]);
    ctx.fill();
    ctx.fillStyle = '#000000';
    if (id === 'W01') {
      StDecal.flame(ctx, width / 2, height * 0.66, side * 0.34, '#000000');
      return;
    }
    StDecal.poly(
      ctx,
      [
        [0.54, 0.36],
        [0.42, 0.62],
        [0.52, 0.6],
        [0.44, 0.84],
        [0.6, 0.55],
        [0.5, 0.57],
        [0.6, 0.36],
      ].map(([fracX, fracY]) => [width * fracX, height * fracY]),
    );
    ctx.fill();
  }

  /** Многоугольник. */
  static poly(ctx, pts) {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
  }

  /** Белый круг запрещающего знака. */
  static disc(ctx, { width, height, side }) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, side * 0.48, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Красный круг с косой чертой. */
  static prohibit(ctx, { width, height, side }) {
    ctx.strokeStyle = RED;
    ctx.lineWidth = side * 0.09;
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, side * 0.43, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(width / 2 - side * 0.3, height / 2 - side * 0.3);
    ctx.lineTo(width / 2 + side * 0.3, height / 2 + side * 0.3);
    ctx.stroke();
  }

  /** P02 «Запрещается пользоваться открытым огнём и курить». */
  static p02(ctx, opts) {
    const { width, height, side } = opts;
    StDecal.disc(ctx, opts);
    StDecal.flame(ctx, width / 2, height * 0.62, side * 0.34, '#000000');
    ctx.fillStyle = '#000000';
    ctx.fillRect(width * 0.47, height * 0.62, width * 0.06, height * 0.14);
    StDecal.prohibit(ctx, opts);
  }

  /** P06 «Доступ посторонним запрещён»: человек с поднятой рукой под запрещающим знаком. */
  static p06(ctx, opts) {
    const { width, height, side } = opts;
    StDecal.disc(ctx, opts);
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(width * 0.5, height * 0.27, side * 0.075, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(width * 0.44, height * 0.36, width * 0.12, height * 0.3);
    ctx.fillRect(width * 0.44, height * 0.64, width * 0.05, height * 0.17);
    ctx.fillRect(width * 0.51, height * 0.64, width * 0.05, height * 0.17);
    ctx.save();
    ctx.translate(width * 0.56, height * 0.38);
    ctx.rotate(-0.9);
    ctx.fillRect(0, -side * 0.025, side * 0.2, side * 0.05);
    ctx.restore();
    StDecal.prohibit(ctx, opts);
  }

  /** Знак маркировки груза. */
  static cargoSign(ctx, { width, height, id, decal }) {
    StDecal.cargo(ctx, width, height, id, decal);
  }

  /** Стрелка потока на трубе: острие — по ходу среды (FLOW: 1 — вправо, −1 — влево; FLOWV: 1 — вверх, −1 — вниз). */
  static flow(ctx, { width, height, id, decal }) {
    const v = id === 'FLOWV';
    const flip = decal.dir < 0;
    const toPx = (along, across) =>
      v
        ? [width * across, flip ? height * along : height - height * along]
        : [flip ? width - width * along : width * along, height * across];
    ctx.fillStyle = decal.ink || '#ffffff';
    StDecal.poly(
      ctx,
      [
        [0.04, 0.36],
        [0.62, 0.36],
        [0.62, 0.08],
        [0.97, 0.5],
        [0.62, 0.92],
        [0.62, 0.64],
        [0.04, 0.64],
      ].map(([along, across]) => toPx(along, across)),
    );
    ctx.fill();
  }

  /** Табличка на двери: категория помещения по пожарной опасности, класс зоны по ПУЭ. */
  static cat(ctx, { width, height, side, decal }) {
    ctx.fillStyle = '#ffffff';
    StDecal.roundRect(ctx, [0, 0, width, height], side * 0.05);
    ctx.fill();
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = side * 0.035;
    StDecal.roundRect(ctx, [side * 0.04, side * 0.04, width - side * 0.08, height - side * 0.08], side * 0.03);
    ctx.stroke();
    StDecal.rows(ctx, width, height, [
      ['КАТЕГОРИЯ', 0.14, '#111111'],
      [String(decal.cat || ''), 0.4, RED],
      [decal.zone ? `КЛАСС ЗОНЫ ${decal.zone}` : 'ПО ПОЖАРНОЙ ОПАСНОСТИ', 0.13, '#111111'],
    ]);
  }

  /** Табличка с надписью. */
  static board(ctx, { width, height, side }, [lines, background, ink]) {
    ctx.fillStyle = background;
    StDecal.roundRect(ctx, [0, 0, width, height], side * 0.08);
    ctx.fill();
    if (background === '#ffffff') {
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = side * 0.04;
      StDecal.roundRect(ctx, [side * 0.03, side * 0.03, width - side * 0.06, height - side * 0.06], side * 0.06);
      ctx.stroke();
    }
    StDecal.rows(ctx, width, height, lines.length > 1 ? lines.map(line => [line, 0.36, ink]) : [[lines[0], 0.62, ink]]);
  }

  /** Маркировка груза (ГОСТ 14192-96) на стене без фона: № 9 — цепь, № 12 — крест и круг из четырёх дуг, «Масса брутто». */
  static cargo(ctx, width, height, id, decal) {
    const ink = decal.light ? '#ffffff' : '#111111';
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    if (id === 'SLING') StDecal.chain(ctx, width, height);
    else if (id === 'COG') StDecal.cog(ctx, width, height);
    else {
      StDecal.rows(ctx, width, height, [
        ['МАССА БРУТТО', 0.34, ink],
        [`${Mm.text(decal.kg || 0)} кг`, 0.42, ink],
      ]);
    }
  }

  /** № 9 «Место строповки»: разомкнутое звено сверху, два звена, звенья ребром. */
  static chain(ctx, width, height) {
    const loopW = width * 0.66;
    const thick = width * 0.11;
    const loopH = height * 0.22;
    const hookH = height * 0.3;
    const x0 = width / 2 - loopW / 2 + thick / 2;
    const innerW = loopW - thick;
    ctx.lineWidth = thick;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(x0, 0);
    ctx.lineTo(x0, loopH - innerW / 2);
    ctx.arc(width / 2, loopH - innerW / 2, innerW / 2, Math.PI, 0, true);
    ctx.lineTo(x0 + innerW, 0);
    ctx.stroke();
    for (const y of [height * 0.26, height * 0.62]) {
      StDecal.roundRect(ctx, [x0, y + thick / 2, innerW, hookH - thick], innerW / 2);
      ctx.stroke();
    }
    ctx.fillRect(width / 2 - thick * 0.6, height * 0.08, thick * 1.2, height * 0.9);
  }

  /** № 12 «Центр тяжести»: толстый крест и круг из четырёх дуг. */
  static cog(ctx, width, height) {
    const side = Math.min(width, height);
    const midX = width / 2;
    const midY = height / 2;
    const bar = side * 0.1;
    const outer = side * 0.31;
    const inner = outer - side * 0.09;
    const gap = Math.asin(Math.min(0.9, (bar / 2 + side * 0.05) / inner));
    ctx.fillRect(midX - side / 2, midY - bar / 2, side, bar);
    ctx.fillRect(midX - bar / 2, midY - side / 2, bar, side);
    for (let k = 0; k < 4; k++) {
      const from = (k * Math.PI) / 2 + gap;
      const till = ((k + 1) * Math.PI) / 2 - gap;
      ctx.beginPath();
      ctx.arc(midX, midY, outer, from, till);
      ctx.arc(midX, midY, inner, till, from, true);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** Пламя (условное): капля с языком. */
  static flame(ctx, x, y, size, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.5);
    ctx.bezierCurveTo(
      x - size * 0.55,
      y + size * 0.45,
      x - size * 0.5,
      y - size * 0.1,
      x - size * 0.12,
      y - size * 0.55,
    );
    ctx.bezierCurveTo(
      x - size * 0.05,
      y - size * 0.2,
      x + size * 0.1,
      y - size * 0.25,
      x + size * 0.12,
      y - size * 0.45,
    );
    ctx.bezierCurveTo(x + size * 0.5, y - size * 0.05, x + size * 0.55, y + size * 0.45, x, y + size * 0.5);
    ctx.closePath();
    ctx.fill();
  }
}
