import { CatalogWindow } from './catalog-window.js';
import { $, esc } from '../../core/util.js';
/** Разовое сообщение после обновления каталога (app/catalog_migrate.py) и раскладки изображений по папкам (app/images.py). */
export class MigrationNotice {
  static KEY = 'kp.migSeen';
  static CATALOG = 'catalog-structure-2026-10';
  static IMAGES = 'images-ascii-2026-10';
  static NO_PHOTO_SHOWN = 5;

  /**
   * Показать сообщение, если оно ещё не показано.
   * @param {object[]} list записи миграций с сервера
   * @returns {boolean} показано
   */
  static show(list) {
    const done = (list || []).filter(row => row && row.report && !row.report.empty);
    if (!done.length) return false;
    const key = done.map(row => `${row.id}@${row.at}`).join('|');
    try {
      if (localStorage.getItem(this.KEY) === key) return false;
    } catch {
      // браузер не хранит — покажем
    }
    const dialog = $('#dlg');
    dialog.classList.remove('wide');
    dialog.innerHTML = this._html(done);
    const seen = () => {
      try {
        localStorage.setItem(this.KEY, key);
      } catch {
        // не запомнилось — покажется ещё раз
      }
    };
    dialog.showModal();
    dialog.querySelectorAll('[data-close]').forEach(button => {
      button.onclick = () => {
        seen();
        dialog.close();
      };
    });
    dialog.querySelector('[data-mig]').onclick = () => {
      seen();
      dialog.close();
      CatalogWindow.open({});
    };
    return true;
  }

  static _report(done, id) {
    return (done.find(row => row.id === id) || {}).report;
  }

  static _html(done) {
    const catalog = this._report(done, this.CATALOG);
    const images = this._report(done, this.IMAGES);
    const backup = done.map(row => row.backup).filter(Boolean)[0];
    return `<div class="dlg-h"><h3>Каталог обновлён</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
   <div class="dlg-b">${catalog ? this._catalog(catalog) : ''}
   ${images ? this._images(images) : ''}
   <p class="muted">Перед обновлением сделана копия базы${backup ? `: ${esc(backup)}` : ''}.</p>
   <div class="row" style="justify-content:flex-end"><button class="btn" type="button" data-close>Понятно</button><button class="btn primary" type="button" data-mig="cat">Открыть каталог</button></div></div>`;
  }

  static _catalog(report) {
    const moved = Object.entries(report.moved || {});
    const movedHtml = moved.length
      ? `<p class="sub">Перенесено по категориям</p><ul class="mig">${moved.map(([cat, count]) => `<li>${esc(cat)} — <b>${count}</b></li>`).join('')}</ul>`
      : '';
    const shown = this.NO_PHOTO_SHOWN;
    const noPhoto = report.noPhotoCount
      ? `<li>Без фото (нет похожей модели того же производителя): <b>${report.noPhotoCount}</b> — ${esc((report.noPhoto || []).slice(0, shown).join('; '))}${report.noPhotoCount > shown ? '…' : ''}</li>`
      : '';
    return `<p style="margin-top:0">Новые категории: дизельные и спиральные компрессоры, осушители рефрижераторные и адсорбционные, магистральные фильтры, ресиверы, запасные части и ЗИП. У каждой категории — свои параметры, фильтры и шаблон характеристик.</p>
   ${movedHtml}
   <ul class="mig"><li>Параметров заполнено из таблиц характеристик: <b>${report.attrsFilled || 0}</b></li>
     <li>Фото от похожей модели того же производителя: <b>${report.photos || 0}</b>${report.logos ? `, логотипов: <b>${report.logos}</b>` : ''}</li>
     ${noPhoto}</ul>`;
  }

  static _images(report) {
    return `<p class="sub">Изображения разложены по папкам</p><ul class="mig"><li>Папка data\\img: раздел / категория / производитель латиницей (например, compressors\\screw-compressors\\dalgakiran), логотипы — logos; папок: <b>${report.folders}</b>, файлов: <b>${report.files}</b>${report.unused ? `, без ссылок: <b>${report.unused}</b> (папка unused)` : ''}</li></ul>`;
  }
}
