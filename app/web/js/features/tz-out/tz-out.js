import { EskdFont } from '../eskd/eskd-font.js';
import { PhotoTint } from '../view/photo-tint.js';
import { StationDrawing } from '../draw/station-drawing.js';
import { StationPaint } from '../layout/station-paint.js';
import { StationRender } from '../view/station-render.js';
import { StationView3D } from '../draw/station-view3d.js';
import { TzText } from './tz-text.js';

/** ТЗ на сборку станции для сборщика — документ Word с чертежом, схемой и 3D-видом в приложениях. */
export class TzOut {
  static NAME = s =>
    String(s || '')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);

  /** Скачать ТЗ на сборку станции (позиция i). */
  static async download(i) {
    const x = S.items[i];
    if (!x || !stationOf(x) || !isKit(x)) {
      toast('ТЗ на сборку — для станции в контейнере с составом');
      return;
    }
    toast('Готовлю ТЗ на сборку…');
    try {
      await this._save(x);
    } catch (e) {
      toast(`Не удалось подготовить ТЗ на сборку: ${e?.message || e}`);
    }
  }

  static async _save(x) {
    const b = await this.make(x);
    const nm = `${this.NAME(x.name) || 'станция'}${S.number ? ` — КП ${this.NAME(S.number)}` : ''}`;
    saveFileA(`ТЗ на сборку — ${nm}.docx`, b);
    const c = kitContainer(x) || {};
    const f = StationPaint.book(c) && c.paintFile; // буклет окраски в PDF — вторым файлом рядом с ТЗ
    if (f && f.pdf) saveFileA(`Буклет окраски — ${nm}.pdf`, await (await fetch(f.src)).blob());
  }

  /** Документ .docx (Blob). */
  static async make(x) {
    await EskdFont.load();
    if (typeof DrawPic !== 'undefined') await DrawPic.load(x);
    await PhotoTint.load(x);
    const plan = StationUi.plan(x);
    const meta = StationUi.meta(x, plan);
    const org = StationUi.org();
    const d = new DocxWriter({
      title: `ТЗ на сборку: ${x.name || ''}`,
      author: org,
      footer: `ТЗ на сборку — ${x.name || 'станция'}`,
    });
    TzText.write(d, x, plan, org);
    const app = { d, n: 0 };
    const ok = plan.level !== 'error' && plan.geo && plan.geo.ext;
    if (ok) await this._sheets(app, plan, meta);
    await this._paint(app, x, ok);
    return d.pack('blob');
  }

  /** Приложение с картинкой и подписью «Приложение N. …». */
  static _add(app, im, cap, maxH, page) {
    if (im && im.src) app.d.image(im.src, im.w, im.h, app.d.width, `Приложение ${++app.n}. ${cap}`, maxH, page);
  }

  /** Приложения: габаритный чертёж, схема, 3D-разрез и виды снаружи. */
  static async _sheets(app, plan, meta) {
    const sch = StationUi.scheme(plan);
    app.d.h1('Приложения', true);
    const L = StationDrawing.sheets(plan, meta);
    for (const [k, sheet] of L.entries())
      this._add(
        app,
        await StationImages.raster(sheet, 'image/png'),
        L.length > 1 ? `Габаритный чертёж, лист ${k + 1}` : 'Габаритный чертёж',
        225,
        k > 0,
      );
    if (sch) this._add(app, await StationImages.raster(sch.cls.svg(plan, meta), 'image/png'), sch.name, 240, true);
    const gl = await StationRender.image(plan, meta);
    const v3 = gl || (await StationImages.raster(StationView3D.svg(plan, meta), 'image/jpeg'));
    this._add(app, v3, 'Разрез (3D-вид, стены со стороны зрителя срезаны)', 200, true);
    for (const [, az, cap] of StationImages.VIEWS)
      this._add(
        app,
        await StationRender.image(plan, meta, 'out', az),
        `${cap} снаружи: двери, ворота, жалюзи, светильники, знаки`,
        200,
        true,
      );
  }

  /** Окраска заказчика: буклет-картинка и макеты рисунков на стенах (PDF буклета — отдельным файлом). */
  static async _paint(app, x, ok) {
    const c = kitContainer(x) || {};
    const bk = StationPaint.book(c) && c.paintFile;
    const arts = StationPaint.arts(c);
    if (!bk && !arts.length) return;
    if (!ok) app.d.h1('Приложения', true);
    const put = async (src, cap, page) => {
      const im = await this.pic(src);
      if (im) app.d.image(im.src, im.w, im.h, app.d.width, `Приложение ${++app.n}. ${cap}`, 200, page);
    };
    if (bk && !bk.pdf) await put(bk.src, 'Буклет цветовых решений заказчика', true);
    for (const [k, a] of arts.entries())
      await put(a.src, `Изображение заказчика ${k + 1}: ${StationPaint.where(a)}`, k === 0 || !!bk);
  }

  /** Картинка по адресу → {src: data:image/png, w, h}; не загрузилась — null. */
  static async pic(src) {
    try {
      const im = await readImg(src);
      const c = document.createElement('canvas');
      c.width = im.naturalWidth || im.width;
      c.height = im.naturalHeight || im.height;
      const g = c.getContext('2d');
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(im, 0, 0);
      return { src: c.toDataURL('image/png'), w: c.width, h: c.height };
    } catch {
      return null;
    }
  }
}
