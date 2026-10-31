import { DocxWriter } from '../doc/docx-writer.js';
import { EskdFont } from '../eskd/eskd-font.js';
import { PhotoTint } from '../view/photo-tint.js';
import { StationDrawing } from '../draw/station-drawing.js';
import { StationPaint } from '../layout/station-paint.js';
import { StationRender } from '../view/station-render.js';
import { StationView3D } from '../draw/station-view3d.js';
import { TzText } from './tz-text.js';
import { ImageFiles } from '../catalog/images.js';
import { StationImages } from '../station/station-images.js';
import { StationUi } from '../station/station-ui.js';
import { DrawPic } from '../kit/draw-pic.js';
import { FileSave } from '../../core/files.js';
import { Toast } from '../../core/toast.js';
import { S } from '../../core/state.js';
import { Kit } from '../../core/kit.js';
import { StationPlan } from '../req/station-plan.js';

/** ТЗ на сборку станции для сборщика — документ Word с чертежом, схемой и 3D-видом в приложениях. */
export class TzOut {
  /** Имя файла без запрещённых знаков, до 80 символов. */
  static NAME = text =>
    String(text || '')
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);

  /** Скачать ТЗ на сборку станции (позиция i). */
  static async download(i) {
    const x = S.items[i];
    if (!x || !Kit.station(x) || !Kit.has(x)) {
      Toast.show('ТЗ на сборку — для станции в контейнере с составом');
      return;
    }
    Toast.show('Готовлю ТЗ на сборку…');
    try {
      await this._save(x);
    } catch (err) {
      Toast.show(`Не удалось подготовить ТЗ на сборку: ${err?.message || err}`);
    }
  }

  static async _save(x) {
    const blob = await this.make(x);
    const name = `${this.NAME(x.name) || 'станция'}${S.number ? ` — КП ${this.NAME(S.number)}` : ''}`;
    FileSave.download(`ТЗ на сборку — ${name}.docx`, blob);
    const container = Kit.container(x) || {};
    const booklet = StationPaint.book(container) && container.paintFile; // буклет окраски в PDF — вторым файлом рядом с ТЗ
    if (booklet && booklet.pdf)
      FileSave.download(`Буклет окраски — ${name}.pdf`, await (await fetch(booklet.src)).blob());
  }

  /** Документ .docx (Blob). */
  static async make(x) {
    await EskdFont.load();
    await DrawPic.load(x);
    await PhotoTint.load(x);
    const plan = StationPlan.plan(x);
    const meta = StationUi.meta(x, plan);
    const org = StationUi.org();
    const doc = new DocxWriter({
      title: `ТЗ на сборку: ${x.name || ''}`,
      author: org,
      footer: `ТЗ на сборку — ${x.name || 'станция'}`,
    });
    TzText.write(doc, x, plan, org);
    const app = { d: doc, n: 0 };
    const ok = plan.level !== 'error' && plan.geo && plan.geo.ext;
    if (ok) await this._sheets(app, plan, meta);
    await this._paint(app, x, ok);
    return doc.pack('blob');
  }

  /** Приложение с картинкой и подписью «Приложение N. …». */
  static _add(app, image, cap, maxH, page) {
    if (image && image.src)
      app.d.image(image.src, {
        px: image.w,
        py: image.h,
        width: app.d.width,
        caption: `Приложение ${++app.n}. ${cap}`,
        maxH,
        page,
      });
  }

  /** Приложения: габаритный чертёж, схема, 3D-разрез и виды снаружи. */
  static async _sheets(app, plan, meta) {
    const sch = StationUi.scheme(plan);
    app.d.heading('Приложения', { page: true });
    const sheets = StationDrawing.sheets(plan, meta);
    for (const [k, sheet] of sheets.entries())
      this._add(
        app,
        await StationImages.raster(sheet, 'image/png'),
        sheets.length > 1 ? `Габаритный чертёж, лист ${k + 1}` : 'Габаритный чертёж',
        225,
        k > 0,
      );
    if (sch) this._add(app, await StationImages.raster(sch.cls.svg(plan, meta), 'image/png'), sch.name, 240, true);
    const webgl = await StationRender.image(plan, meta);
    const view3d = webgl || (await StationImages.raster(StationView3D.svg(plan, meta), 'image/jpeg'));
    this._add(app, view3d, 'Разрез (3D-вид, стены со стороны зрителя срезаны)', 200, true);
    for (const [, azimuth, cap] of StationPlan.VIEWS)
      this._add(
        app,
        await StationRender.image(plan, meta, 'out', azimuth),
        `${cap} снаружи: двери, ворота, жалюзи, светильники, знаки`,
        200,
        true,
      );
  }

  /** Окраска заказчика: буклет-картинка и макеты рисунков на стенах (PDF буклета — отдельным файлом). */
  static async _paint(app, x, ok) {
    const container = Kit.container(x) || {};
    const booklet = StationPaint.book(container) && container.paintFile;
    const arts = StationPaint.arts(container);
    if (!booklet && !arts.length) return;
    if (!ok) app.d.heading('Приложения', { page: true });
    const put = async (src, cap, page) => {
      const image = await this.pic(src);
      if (image) {
        app.d.image(image.src, {
          px: image.w,
          py: image.h,
          width: app.d.width,
          caption: `Приложение ${++app.n}. ${cap}`,
          maxH: 200,
          page,
        });
      }
    };
    if (booklet && !booklet.pdf) await put(booklet.src, 'Буклет цветовых решений заказчика', true);
    for (const [k, art] of arts.entries())
      await put(art.src, `Изображение заказчика ${k + 1}: ${StationPaint.where(art)}`, k === 0 || !!booklet);
  }

  /** Картинка по адресу → {src: data:image/png, w, h}; не загрузилась — null. */
  static async pic(src) {
    try {
      const image = await ImageFiles.read(src);
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const paint = canvas.getContext('2d');
      paint.fillStyle = '#fff';
      paint.fillRect(0, 0, canvas.width, canvas.height);
      paint.drawImage(image, 0, 0);
      return { src: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height };
    } catch {
      return null;
    }
  }
}
