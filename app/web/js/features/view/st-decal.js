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
  static AR = {
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

  static makers(plan, all) {
    const logos = {};
    const makers = {};
    const keys = Object.keys(all)
      .filter(k => k.length >= 3)
      .sort((a, b) => b.length - a.length);
    const words = s =>
      ` ${String(s)
        .toLowerCase()
        .replace(/[^a-zа-яё0-9]+/g, ' ')} `;
    for (const it of [...(plan.items || []), ...(plan.outside || [])]) {
      const own = String(it.maker || '').trim();
      const k = own
        ? null
        : keys.find(q => words(it.name || '').includes(` ${q.replace(/[^a-zа-яё0-9]+/g, ' ').trim()} `));
      if (k) makers[it.id] = String(all[k].maker || k);
      const mk = k ? makers[it.id] : own;
      StDecal.logoShape(logos, mk);
    }
    return { logos, makers };
  }

  /** Пропорции таблички логотипа производителя (по картинке логотипа). */
  static logoShape(logos, mk) {
    const lg = mk && typeof logoFor === 'function' ? logoFor(mk) : null;
    if (lg && lg.w > 0 && lg.h > 0) logos[mk.toLowerCase()] = Math.max(1.2, Math.min(8, (lg.w / lg.h + 0.36) / 1.36));
  }

  /** Логотип организации: части надписи с цветами из шаблона КП; «ПНЕВМОТЕХ» — фирменные синие всегда. */
  static brandParts() {
    const pk = typeof TPL_CACHE !== 'undefined' && typeof S !== 'undefined' ? TPL_CACHE[S.template] : null;
    const st = (pk && pk.settings) || {};
    const col = st.colors || {};
    const parts = (st.brandParts || [])
      .map(p => [
        String((p && p[0]) || '').trim(),
        `#${String(col[p && p[1]] || (p && p[1]) || '0B45A0').replace(/^#/, '')}`,
      ])
      .filter(p => p[0] && /^#[0-9a-f]{6}$/i.test(p[1]));
    return !parts.length || /^пневмотех$/i.test(parts.map(p => p[0]).join('')) ? StOutfit.BRAND : parts;
  }

  /** Загрузить картинки логотипов и рисунков заказчика, нужные сцене. */
  static async prepare(scene) {
    for (const d of scene.decals.values()) {
      const src = StDecal.srcOf(d);
      if (!src || StDecal.imgs.has(src)) continue;
      try {
        StDecal.imgs.set(src, await readImg(src));
      } catch {
        StDecal.imgs.set(src, null);
      }
    }
  }

  static srcOf(d) {
    if (d.type === 'art') return d.src;
    return d.type === 'logo' && typeof logoFor === 'function' ? (logoFor(d.maker) || {}).src : null;
  }

  /** Холст наклейки: ширина до 1024 точек, высота — по пропорции. */
  static canvas(d) {
    const ar = Math.max(0.2, Math.min(12, d.ar || StDecal.AR[d.id] || 1));
    const W = ar >= 1 ? 1024 : Math.round(1024 * ar);
    const H = Math.max(16, Math.round(W / ar));
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    const draw = { brand: StDecal.brand, art: StDecal.art, logo: StDecal.logo }[d.type];
    if (draw) draw(g, W, H, d);
    else StDecal.sign(g, W, H, d.id, d);
    return c;
  }

  /** Рисунок заказчика во весь холст; не загрузился — пустая рамка. */
  static art(g, W, H, d) {
    const im = StDecal.imgs.get(d.src);
    if (im) {
      g.drawImage(im, 0, 0, W, H);
      return;
    }
    g.strokeStyle = 'rgba(0,0,0,.35)';
    g.lineWidth = Math.max(4, W / 120);
    g.setLineDash([W / 40, W / 60]);
    g.strokeRect(g.lineWidth, g.lineWidth, W - 2 * g.lineWidth, H - 2 * g.lineWidth);
  }

  static rr(g, [x, y, w, h], r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /** Строки текста по центру: [текст, доля высоты, цвет] — каждая вписана в ширину, промежутки поровну. */
  static rows(g, W, H, R) {
    const gap = (1 - R.reduce((s, r) => s + r[1], 0)) / (R.length + 1);
    let y = gap * H;
    for (const [t, k, c] of R) {
      StDecal.text(g, t, { x: W / 2, y: y + k * H * 0.53, w: W * 0.88, size: k * H * 1.25, color: c });
      y += (k + gap) * H;
    }
  }

  /** Текст по центру, вписанный в ширину w (шрифт уменьшается). */
  static text(g, s, { x, y, w, size, weight = 900, color, font = 'Arial, sans-serif' }) {
    g.font = `${weight} ${size}px ${font}`;
    const k = Math.min(1, w / Math.max(1, g.measureText(s).width));
    g.font = `${weight} ${Math.floor(size * k)}px ${font}`;
    g.fillStyle = color;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(s, x, y);
  }

  /** Логотип организации: части своих цветов (на тёмной стене — белыми); «О» — глобус; внизу «группа компаний» вразрядку. */
  static brand(g, W, H, d) {
    const parts = d.parts && d.parts.length ? d.parts : StOutfit.BRAND;
    const tag = d.tag || '';
    const pad = H * 0.02;
    const ink = c => (d.light ? '#ffffff' : c);
    const mainH = (H - 2 * pad) * (tag ? 0.7 : 0.92);
    const seg = parts.flatMap(([t, c], i) =>
      d.globe && i === 0 && /О$/i.test(t)
        ? [
            { t: t.slice(0, -1), c },
            { globe: true, c },
          ]
        : [{ t, c }],
    );
    let size = mainH * 1.25;
    const font = s => `900 ${s}px ${FONT}`;
    const R = () => size * 0.4;
    const width = () => {
      g.font = font(size);
      return seg.reduce((s, q) => s + (q.globe ? 2 * R() + size * 0.06 : g.measureText(q.t).width), 0);
    };
    const maxW = W - 2 * pad - H * 0.04;
    if (width() > maxW) size *= maxW / width();
    const total = width();
    const y = pad + mainH * 0.5 + (tag ? 0 : (H - 2 * pad - mainH) / 2);
    let x = (W - total) / 2;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = font(size);
    for (const q of seg) {
      if (q.globe) {
        const r = R();
        StDecal.globe(
          g,
          { cx: x + size * 0.03 + r, cy: y + size * 0.02, r },
          d.parts && d.parts[1] ? d.parts[1][1] : '#3DA0EE',
          q.c,
        );
        x += 2 * r + size * 0.06;
      } else {
        g.fillStyle = ink(q.c);
        g.fillText(q.t, x, y + size * 0.04);
        x += g.measureText(q.t).width;
      }
    }
    if (tag) StDecal.tag(g, { W, H, pad, total, tag, color: ink(parts[0][1]) });
  }

  static tag(g, { W, H, pad, total, tag, color }) {
    const th = (H - 2 * pad) * 0.17;
    const ty = H - pad - th * 0.75;
    const letters = [...tag];
    const step = total / letters.length;
    g.font = `600 ${th}px Arial, sans-serif`;
    g.fillStyle = color;
    g.textAlign = 'center';
    letters.forEach((ch, k) => g.fillText(ch, (W - total) / 2 + step * (k + 0.5), ty));
  }

  /** Глобус: шар с переходом цвета и белыми изогнутыми полосами. */
  static globe(g, { cx, cy, r }, light, dark) {
    const gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    gr.addColorStop(0, light);
    gr.addColorStop(1, dark);
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = gr;
    g.fill();
    g.clip();
    g.strokeStyle = '#ffffff';
    g.lineCap = 'round';
    for (const [dy, w, k] of [
      [-0.42, 0.11, 0.55],
      [-0.05, 0.13, 0.4],
      [0.34, 0.11, 0.3],
    ]) {
      g.lineWidth = r * w;
      g.beginPath();
      g.moveTo(cx - r * 1.1, cy + r * (dy + k * 0.5));
      g.quadraticCurveTo(cx, cy + r * (dy - k * 0.6), cx + r * 1.1, cy + r * (dy + k * 0.2));
      g.stroke();
    }
    g.restore();
  }

  /** Логотип производителя: картинка на светлой табличке или название цветом, контрастным корпусу. */
  static logo(g, W, H, d) {
    const lg = typeof logoFor === 'function' ? logoFor(d.maker) : null;
    const im = lg && StDecal.imgs.get(lg.src);
    if (im) {
      g.fillStyle = '#ffffff';
      StDecal.rr(g, [0, 0, W, H], H * 0.14);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.18)';
      g.lineWidth = H * 0.03;
      StDecal.rr(g, [H * 0.02, H * 0.02, W - H * 0.04, H - H * 0.04], H * 0.12);
      g.stroke();
      const iw = im.naturalWidth || im.width;
      const ih = im.naturalHeight || im.height;
      const k = Math.min((W - H * 0.36) / iw, (H * 0.72) / ih);
      g.drawImage(im, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
      return;
    }
    const rgb = RalColor.rgb(d.bg || '#cccccc');
    const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
    StDecal.text(g, String(d.maker || '').toUpperCase(), {
      x: W / 2,
      y: H / 2,
      w: W * 0.96,
      size: H * 0.82,
      color: lum > 0.55 ? '#1d2733' : '#ffffff',
      font: FONT,
    });
  }

  /** Знаки безопасности, таблички и табло; d — описание наклейки. */
  static sign(g, W, H, id, d = {}) {
    const s = Math.min(W, H);
    const draw = StDecal.SIGNS[id];
    if (draw) {
      draw(g, { W, H, s, d, id });
      return;
    }
    const T = BOARDS[id];
    if (T) StDecal.board(g, { W, H, s }, T);
  }

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
  static f04(g, { W, H, s }) {
    g.fillStyle = RED;
    StDecal.rr(g, [0, 0, W, H], s * 0.06);
    g.fill();
    g.fillStyle = '#ffffff';
    StDecal.rr(g, [W * 0.22, H * 0.36, W * 0.24, H * 0.52], s * 0.08);
    g.fill();
    g.fillRect(W * 0.29, H * 0.26, W * 0.1, H * 0.12);
    g.fillRect(W * 0.22, H * 0.22, W * 0.3, H * 0.05);
    g.lineWidth = s * 0.05;
    g.strokeStyle = '#ffffff';
    g.beginPath();
    g.moveTo(W * 0.39, H * 0.3);
    g.quadraticCurveTo(W * 0.62, H * 0.26, W * 0.6, H * 0.5);
    g.stroke();
    StDecal.flame(g, W * 0.72, H * 0.62, s * 0.3, '#ffffff');
  }

  /** W01 «Пожароопасно», W08 «Электрический ток»: жёлтый треугольник с чёрной каймой. */
  static warning(g, { W, H, s, id }) {
    const p = s * 0.04;
    const q = s * 0.13;
    g.fillStyle = '#000000';
    StDecal.poly(g, [
      [W / 2, p],
      [W - p, H - p],
      [p, H - p],
    ]);
    g.lineJoin = 'round';
    g.fill();
    g.fillStyle = '#f9a800';
    StDecal.poly(g, [
      [W / 2, p + q * 1.6],
      [W - p - q * 1.15, H - p - q * 0.62],
      [p + q * 1.15, H - p - q * 0.62],
    ]);
    g.fill();
    g.fillStyle = '#000000';
    if (id === 'W01') {
      StDecal.flame(g, W / 2, H * 0.66, s * 0.34, '#000000');
      return;
    }
    StDecal.poly(
      g,
      [
        [0.54, 0.36],
        [0.42, 0.62],
        [0.52, 0.6],
        [0.44, 0.84],
        [0.6, 0.55],
        [0.5, 0.57],
        [0.6, 0.36],
      ].map(([a, b]) => [W * a, H * b]),
    );
    g.fill();
  }

  static poly(g, pts) {
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
  }

  /** Белый круг запрещающего знака. */
  static disc(g, { W, H, s }) {
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(W / 2, H / 2, s * 0.48, 0, Math.PI * 2);
    g.fill();
  }

  /** Красный круг с косой чертой. */
  static prohibit(g, { W, H, s }) {
    g.strokeStyle = RED;
    g.lineWidth = s * 0.09;
    g.beginPath();
    g.arc(W / 2, H / 2, s * 0.43, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.moveTo(W / 2 - s * 0.3, H / 2 - s * 0.3);
    g.lineTo(W / 2 + s * 0.3, H / 2 + s * 0.3);
    g.stroke();
  }

  /** P02 «Запрещается пользоваться открытым огнём и курить». */
  static p02(g, o) {
    const { W, H, s } = o;
    StDecal.disc(g, o);
    StDecal.flame(g, W / 2, H * 0.62, s * 0.34, '#000000');
    g.fillStyle = '#000000';
    g.fillRect(W * 0.47, H * 0.62, W * 0.06, H * 0.14);
    StDecal.prohibit(g, o);
  }

  /** P06 «Доступ посторонним запрещён»: человек с поднятой рукой под запрещающим знаком. */
  static p06(g, o) {
    const { W, H, s } = o;
    StDecal.disc(g, o);
    g.fillStyle = '#000000';
    g.beginPath();
    g.arc(W * 0.5, H * 0.27, s * 0.075, 0, Math.PI * 2);
    g.fill();
    g.fillRect(W * 0.44, H * 0.36, W * 0.12, H * 0.3);
    g.fillRect(W * 0.44, H * 0.64, W * 0.05, H * 0.17);
    g.fillRect(W * 0.51, H * 0.64, W * 0.05, H * 0.17);
    g.save();
    g.translate(W * 0.56, H * 0.38);
    g.rotate(-0.9);
    g.fillRect(0, -s * 0.025, s * 0.2, s * 0.05);
    g.restore();
    StDecal.prohibit(g, o);
  }

  static cargoSign(g, { W, H, id, d }) {
    StDecal.cargo(g, W, H, id, d);
  }

  /** Стрелка потока на трубе: острие — по ходу среды (FLOW: 1 — вправо, −1 — влево; FLOWV: 1 — вверх, −1 — вниз). */
  static flow(g, { W, H, id, d }) {
    const v = id === 'FLOWV';
    const F = d.dir < 0;
    const P = (a, c) => (v ? [W * c, F ? H * a : H - H * a] : [F ? W - W * a : W * a, H * c]);
    g.fillStyle = d.ink || '#ffffff';
    StDecal.poly(
      g,
      [
        [0.04, 0.36],
        [0.62, 0.36],
        [0.62, 0.08],
        [0.97, 0.5],
        [0.62, 0.92],
        [0.62, 0.64],
        [0.04, 0.64],
      ].map(([a, c]) => P(a, c)),
    );
    g.fill();
  }

  /** Табличка на двери: категория помещения по пожарной опасности, класс зоны по ПУЭ. */
  static cat(g, { W, H, s, d }) {
    g.fillStyle = '#ffffff';
    StDecal.rr(g, [0, 0, W, H], s * 0.05);
    g.fill();
    g.strokeStyle = '#111111';
    g.lineWidth = s * 0.035;
    StDecal.rr(g, [s * 0.04, s * 0.04, W - s * 0.08, H - s * 0.08], s * 0.03);
    g.stroke();
    StDecal.rows(g, W, H, [
      ['КАТЕГОРИЯ', 0.14, '#111111'],
      [String(d.cat || ''), 0.4, RED],
      [d.zone ? `КЛАСС ЗОНЫ ${d.zone}` : 'ПО ПОЖАРНОЙ ОПАСНОСТИ', 0.13, '#111111'],
    ]);
  }

  static board(g, { W, H, s }, [lines, bg, ink]) {
    g.fillStyle = bg;
    StDecal.rr(g, [0, 0, W, H], s * 0.08);
    g.fill();
    if (bg === '#ffffff') {
      g.strokeStyle = 'rgba(0,0,0,0.25)';
      g.lineWidth = s * 0.04;
      StDecal.rr(g, [s * 0.03, s * 0.03, W - s * 0.06, H - s * 0.06], s * 0.06);
      g.stroke();
    }
    StDecal.rows(g, W, H, lines.length > 1 ? lines.map(t => [t, 0.36, ink]) : [[lines[0], 0.62, ink]]);
  }

  /** Маркировка груза (ГОСТ 14192-96) на стене без фона: № 9 — цепь, № 12 — крест и круг из четырёх дуг, «Масса брутто». */
  static cargo(g, W, H, id, d) {
    const ink = d.light ? '#ffffff' : '#111111';
    g.fillStyle = ink;
    g.strokeStyle = ink;
    if (id === 'SLING') StDecal.chain(g, W, H);
    else if (id === 'COG') StDecal.cog(g, W, H);
    else {
      StDecal.rows(g, W, H, [
        ['МАССА БРУТТО', 0.34, ink],
        [`${Mm.text(d.kg || 0)} кг`, 0.42, ink],
      ]);
    }
  }

  /** № 9 «Место строповки»: разомкнутое звено сверху, два звена, звенья ребром. */
  static chain(g, W, H) {
    const lw = W * 0.66;
    const t = W * 0.11;
    const uh = H * 0.22;
    const oh = H * 0.3;
    const x0 = W / 2 - lw / 2 + t / 2;
    const w = lw - t;
    g.lineWidth = t;
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(x0, 0);
    g.lineTo(x0, uh - w / 2);
    g.arc(W / 2, uh - w / 2, w / 2, Math.PI, 0, true);
    g.lineTo(x0 + w, 0);
    g.stroke();
    for (const y of [H * 0.26, H * 0.62]) {
      StDecal.rr(g, [x0, y + t / 2, w, oh - t], w / 2);
      g.stroke();
    }
    g.fillRect(W / 2 - t * 0.6, H * 0.08, t * 1.2, H * 0.9);
  }

  /** № 12 «Центр тяжести»: толстый крест и круг из четырёх дуг. */
  static cog(g, W, H) {
    const s = Math.min(W, H);
    const cx = W / 2;
    const cy = H / 2;
    const a = s * 0.1;
    const R = s * 0.31;
    const r = R - s * 0.09;
    const gap = Math.asin(Math.min(0.9, (a / 2 + s * 0.05) / r));
    g.fillRect(cx - s / 2, cy - a / 2, s, a);
    g.fillRect(cx - a / 2, cy - s / 2, a, s);
    for (let k = 0; k < 4; k++) {
      const t0 = (k * Math.PI) / 2 + gap;
      const t1 = ((k + 1) * Math.PI) / 2 - gap;
      g.beginPath();
      g.arc(cx, cy, R, t0, t1);
      g.arc(cx, cy, r, t1, t0, true);
      g.closePath();
      g.fill();
    }
  }

  /** Пламя (условное): капля с языком. */
  static flame(g, x, y, s, color) {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(x, y + s * 0.5);
    g.bezierCurveTo(x - s * 0.55, y + s * 0.45, x - s * 0.5, y - s * 0.1, x - s * 0.12, y - s * 0.55);
    g.bezierCurveTo(x - s * 0.05, y - s * 0.2, x + s * 0.1, y - s * 0.25, x + s * 0.12, y - s * 0.45);
    g.bezierCurveTo(x + s * 0.5, y - s * 0.05, x + s * 0.55, y + s * 0.45, x, y + s * 0.5);
    g.closePath();
    g.fill();
  }
}
