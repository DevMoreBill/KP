import { $, Uid } from '../../core/util.js';
import { FormView } from '../../ui/form-view.js';
import { KpState, S } from '../../core/state.js';
import { Toast } from '../../core/toast.js';
import { DefRegistry } from '../../core/defaults.js';
/** Подготовка картинок, которые менеджер добавляет сам: уменьшение, сжатие JPEG, обрезка белых полей. */
export class ImgPrep {
  static DEFAULTS = [
    [
      [
        'photo',
        'Фото и картинки, добавленные вручную',
        'cat',
        'Файл, вставка из буфера обмена или перетаскивание: главное фото позиции, логотип, схемы и фото галереи. Программа уменьшает большие картинки и сжимает их, чтобы КП и база не разрастались.',
      ],
    ],
    [
      [
        'cat.photoMax',
        'photo',
        'Главное фото и логотип — не больше',
        'num',
        '1600',
        {
          unit: 'px',
          req: true,
          min: 600,
          max: 4000,
          hint: 'Наибольшая сторона главного фото и логотипа после загрузки (в точках). Больше — чётче при печати, но тяжелее файл КП и черновик. Для листа А4 обычно хватает 1200–1600.',
        },
      ],
      [
        'cat.galMax',
        'photo',
        'Фото галереи и схемы — не больше',
        'num',
        '2000',
        {
          unit: 'px',
          req: true,
          min: 800,
          max: 5000,
          hint: 'Наибольшая сторона картинок галереи позиции (схемы, чертежи, дополнительные фото). Схемам с мелкими надписями нужно больше точек, чем фото: 2000–3000.',
        },
      ],
      [
        'cat.jpegQ',
        'photo',
        'Качество сжатия фото (JPEG)',
        'num',
        '90',
        {
          unit: '%',
          req: true,
          min: 50,
          max: 100,
          hint: '100 % — без потерь качества, но файлы крупнее; 80–90 % — разница на глаз почти незаметна, а файл в 2–3 раза меньше. Логотипы и картинки PNG (с прозрачностью) не сжимаются.',
        },
      ],
      [
        'cat.photoCrop',
        'photo',
        'Обрезать белые поля вокруг фото',
        'bool',
        true,
        {
          hint: 'Включено — программа сама убирает пустые белые (и прозрачные) края вокруг оборудования, оставляя небольшой отступ: фото в КП крупнее и ровнее. Выключите, если обрезка «съедает» светлые детали оборудования.',
        },
      ],
    ],
  ];
  static MIN_Q = 0.5;
  static PERCENT = 100;

  /**
   * Сжатие JPEG (0,5…1) — из «Значений программы».
   * @returns {number}
   */
  static quality() {
    return Math.min(1, Math.max(this.MIN_Q, DefRegistry.num('cat.jpegQ', 90) / this.PERCENT));
  }

  /**
   * Обрезать белые поля.
   * @returns {boolean}
   */
  static crop() {
    return DefRegistry.value('cat.photoCrop') !== false;
  }
}

/** Рамка содержимого картинки (без белых и прозрачных полей) и обрезка по ней. */
class ImageCrop {
  static RGBA = 4;

  /**
   * Границы не-белых точек.
   * @param {Uint8ClampedArray} data
   * @param {{w: number, h: number, step: number, test: function}} grid
   * @returns {{x0: number, y0: number, x1: number, y1: number}}
   */
  static bounds(data, { w, h, step, test }) {
    const box = { x0: w, y0: h, x1: -1, y1: -1 };
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        if (!test(data, (y * w + x) * this.RGBA)) continue;
        box.x0 = Math.min(box.x0, x);
        box.x1 = Math.max(box.x1, x);
        box.y0 = Math.min(box.y0, y);
        box.y1 = Math.max(box.y1, y);
      }
    }
    return box;
  }

  /**
   * Вырезать рамку с отступом (на белом фоне, кроме логотипа).
   * @param {HTMLCanvasElement} canvas
   * @param {{x0: number, y0: number, x1: number, y1: number}} box
   * @param {{pad: number, extra: number, white: boolean}} opts extra — добавка к правому и нижнему краю
   * @returns {HTMLCanvasElement}
   */
  static cut(canvas, box, { pad, extra, white }) {
    const { width, height } = canvas;
    const x0 = Math.max(0, box.x0 - pad);
    const y0 = Math.max(0, box.y0 - pad);
    const x1 = Math.min(width - 1, box.x1 + pad + extra);
    const y1 = Math.min(height - 1, box.y1 + pad + extra);
    const out = document.createElement('canvas');
    out.width = x1 - x0 + 1;
    out.height = y1 - y0 + 1;
    const ctx = out.getContext('2d');
    if (white) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, out.width, out.height);
    }
    ctx.drawImage(canvas, -x0, -y0);
    return out;
  }

  /**
   * Обрезать поля (если включено в «Значениях программы»).
   * @param {HTMLCanvasElement} canvas
   * @param {object} box границы содержимого
   * @param {{pad: number, extra: number, white: boolean}} opts
   * @returns {HTMLCanvasElement}
   */
  static apply(canvas, box, opts) {
    const crop = ImgPrep.crop();
    const { width, height } = canvas;
    const area = crop ? box : { x0: 0, y0: 0, x1: width - 1, y1: height - 1 }; // без обрезки — картинка целиком (на белом фоне)
    if (!(area.x1 > area.x0 && area.y1 > area.y0)) return canvas;
    return this.cut(canvas, area, crop ? opts : { ...opts, pad: 0 });
  }
}

/** Картинки позиции: файл → картинка, плитка для страницы оборудования, галерея. */
export class ImageFiles {
  static WIDE_RX = /схем|чертёж|чертеж|характеристик|диаграм|график/i;
  static WIDE_RATIO = 2.6;
  static PHOTO_PAD = 0.015;
  static GAL_PAD = 0.01;
  static ALPHA_MIN = 20;
  static WHITE = 240;
  static GAL_WHITE = 242;
  static GAL_STEP = 2;
  static TILE = { w: 1300, h: 860, padW: 180, padH: 160, border: 3, round: 28, inner: 26 };
  static PNG = ['image/png', 'image/gif', 'image/bmp'];

  /**
   * Картинка по адресу.
   * @param {string} src
   * @returns {Promise<HTMLImageElement>}
   */
  static read(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  /**
   * Файл → data:-адрес.
   * @param {File} file
   * @returns {Promise<string>}
   */
  static toUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  static _canvas(img, max, fill) {
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const width = Math.round(img.width * scale);
    const height = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (fill) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0, width, height);
    return { canvas, ctx, w: width, h: height };
  }

  static _photoInk(data, pos) {
    const white = ImageFiles.WHITE;
    return (
      data[pos + 3] > ImageFiles.ALPHA_MIN && (data[pos] < white || data[pos + 1] < white || data[pos + 2] < white)
    );
  }

  static _galInk(data, pos) {
    const white = ImageFiles.GAL_WHITE;
    return data[pos] < white || data[pos + 1] < white || data[pos + 2] < white;
  }

  /**
   * Главное фото или логотип: уменьшить, обрезать поля, сжать (логотип — PNG с прозрачностью).
   * @param {string} src
   * @param {string} kind photo | logo
   * @returns {Promise<{src: string, w: number, h: number}>}
   */
  static async prep(src, kind) {
    const img = await this.read(src);
    const { canvas, ctx, w, h } = this._canvas(img, DefRegistry.num('cat.photoMax', 1600), false);
    const box = ImageCrop.bounds(ctx.getImageData(0, 0, w, h).data, { w, h, step: 1, test: this._photoInk });
    const pad = Math.round(Math.max(w, h) * this.PHOTO_PAD);
    const out = ImageCrop.apply(canvas, box, { pad, extra: 0, white: kind !== 'logo' });
    const type = kind === 'logo' ? 'image/png' : 'image/jpeg';
    return { src: out.toDataURL(type, ImgPrep.quality()), w: out.width, h: out.height };
  }

  /**
   * Главное фото или логотип позиции — файлом.
   * @param {File} file
   * @param {string} kind photo | logo
   * @param {number} i позиция КП
   */
  static async load(file, kind, i) {
    if (!file.type.startsWith('image/')) {
      Toast.show('Нужен файл изображения: JPG, PNG или WEBP');
      return;
    }
    const item = S.items[i];
    try {
      const img = await this.prep(await this.toUrl(file), kind);
      item[kind] = img;
      FormView.render();
      KpState.persist();
    } catch {
      Toast.show('Не удалось открыть изображение');
    }
  }

  /**
   * Выбрать файл главного фото или логотипа.
   * @param {string} kind
   * @param {number} i
   */
  static pick(kind, i) {
    const input = $('#filePick');
    input.value = '';
    input.onchange = () => input.files[0] && this.load(input.files[0], kind, i);
    input.click();
  }

  static _round(ctx, { x, y, w, h, r }) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /**
   * Скруглённая плитка для страницы оборудования.
   * @param {{src: string}} pic
   * @returns {Promise<{url: string, w: number, h: number}>}
   */
  static tile(pic) {
    return this.read(pic.src).then(img => {
      const { w: tileW, h: tileH, padW, padH, border, round, inner } = this.TILE;
      const canvas = document.createElement('canvas');
      canvas.width = tileW;
      canvas.height = tileH;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#CFE0F2';
      this._round(ctx, { x: 0, y: 0, w: tileW, h: tileH, r: round });
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      this._round(ctx, { x: border, y: border, w: tileW - 2 * border, h: tileH - 2 * border, r: inner });
      ctx.fill();
      const scale = Math.min((tileW - padW) / img.width, (tileH - padH) / img.height);
      const drawW = img.width * scale;
      const drawH = img.height * scale;
      ctx.drawImage(img, (tileW - drawW) / 2, (tileH - drawH) / 2, drawW, drawH);
      return { url: canvas.toDataURL('image/png'), w: tileW, h: tileH };
    });
  }

  /**
   * Изображение на всю ширину страницы КП: задано вручную, иначе схема, чертёж или широкая картинка.
   * @param {object} pic
   * @returns {boolean}
   */
  static wide(pic) {
    if (pic.wide === 'full') return true;
    if (pic.wide === 'half') return false;
    return this.WIDE_RX.test(pic.caption || pic.slot || '') || pic.w / pic.h > this.WIDE_RATIO;
  }

  /**
   * Картинка галереи: уменьшить, обрезать белые поля, сжать (PNG, GIF, BMP — без потерь).
   * @param {File} file
   * @returns {Promise<{src: string, w: number, h: number}>}
   */
  static async gallery(file) {
    const img = await this.read(await this.toUrl(file));
    const { canvas, ctx, w, h } = this._canvas(img, DefRegistry.num('cat.galMax', 2000), true);
    const box = ImageCrop.bounds(ctx.getImageData(0, 0, w, h).data, { w, h, step: this.GAL_STEP, test: this._galInk });
    const pad = Math.round(Math.max(w, h) * this.GAL_PAD);
    const out = ImageCrop.apply(canvas, box, { pad, extra: 1, white: true });
    const png = this.PNG.includes(file.type);
    return { src: out.toDataURL(png ? 'image/png' : 'image/jpeg', ImgPrep.quality()), w: out.width, h: out.height };
  }

  /**
   * Добавить изображения в галерею позиции.
   * @param {number} i
   * @param {File[]} files
   * @param {string} slot подпись первого изображения
   */
  static async addGallery(i, files, slot) {
    const item = S.items[i];
    item.gallery = item.gallery || [];
    let added = 0;
    let caption = slot;
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const pic = await this.gallery(file);
        item.gallery.push({ id: Uid.next(), ...pic, caption: caption || '', slot: caption || '', at: '', on: true });
        added++;
        caption = '';
      } catch {
        // не картинка — пропускается
      }
    }
    if (!added) {
      Toast.show('Нужен файл изображения: JPG, PNG, WEBP');
      return;
    }
    item.page = true;
    item._open = true;
    FormView.render();
    KpState.persist();
    Toast.show(added > 1 ? `Добавлено изображений: ${added}` : 'Изображение добавлено');
  }

  /**
   * Выбрать файлы галереи (с подписью — один файл).
   * @param {number} i
   * @param {string} slot
   */
  static pickGallery(i, slot) {
    const input = $('#filePick');
    input.value = '';
    input.multiple = !slot;
    input.onchange = () => {
      const files = [...input.files];
      input.multiple = false;
      if (files.length) this.addGallery(i, files, slot);
    };
    input.click();
  }
}
