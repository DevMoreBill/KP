import { AdminApi, AdminDialog } from './admin-core.js';
import { Logos } from '../catalog/image-slots.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';
import { UiKit } from '../../core/ui-kit.js';

/** «Логотипы производителей» во вкладке фидов: логотип марки ставится на всё её оборудование и закрепляется за ней. */
export class MakerLogoPanel {
  static items = null;
  static query = '';
  static expanded = false;
  static ACCEPT = 'image/png,image/jpeg,image/webp';
  static IMAGE = /^image\/(png|jpeg|webp)$/;
  static MAX_BYTES = 2 * 1024 * 1024;
  static SHOWN = 300;

  /**
   * Блок в окне фидов: свёрнут, пока не нужен.
   * @returns {string}
   */
  static html() {
    return `<details class="st-card ml-box" id="mlBox"${this.expanded ? ' open' : ''}><summary class="sub" style="margin:0;cursor:pointer">Логотипы производителей${UiKit.tip('<p>Логотип марки ставится на всё её оборудование в каталоге (все написания: «Remeza», «REMEZA», «Ремеза») и закрепляется за ней: загрузка фидов его не меняет, новые позиции этой марки получают его.</p><p>«Открепить» — логотип на оборудовании останется, но фиды снова смогут ставить свой.</p><p>Картинка — PNG, JPEG или WebP до 2 МБ; лучше на прозрачном или белом фоне.</p>')}</summary>
      <div id="mlBody">${this.items ? this.body() : '<p class="muted">Загружаю…</p>'}</div></details>`;
  }

  static _row(entry) {
    return `<div class="st-row ml-row"><div class="ml-pic">${entry.logo ? `<img src="${esc(entry.logo.src)}" alt="">` : '<span class="muted">нет</span>'}</div>
        <div class="ml-t"><b>${esc(entry.maker)}</b><span class="muted">${entry.n} ${KPGen.plural(entry.n, 'позиция', 'позиции', 'позиций')}${entry.pinned ? ' · <span class="ok-t">закреплён</span>' : ''}</span></div>
        <div class="acts"><label class="btn">${entry.logo ? 'Заменить…' : 'Поставить…'}<input type="file" accept="${this.ACCEPT}" data-ml="file" data-maker="${esc(entry.maker)}" hidden></label>
          ${entry.pinned ? `<button class="btn" type="button" data-ml="unpin" data-maker="${esc(entry.maker)}">Открепить</button>` : ''}</div></div>`;
  }

  /**
   * Список производителей.
   * @returns {string}
   */
  static body() {
    const query = this.query.trim().toLowerCase();
    const items = this.items || [];
    const list = items.filter(entry => !query || entry.maker.toLowerCase().includes(query));
    const pinned = items.filter(entry => entry.pinned).length;
    return `<div class="row" style="gap:8px;margin:6px 0"><input type="search" data-ml="q" value="${esc(this.query)}" placeholder="Найти производителя" style="flex:1 1 auto">
        <span class="muted">${items.length} ${KPGen.plural(items.length, 'производитель', 'производителя', 'производителей')}${pinned ? `, закреплено ${pinned}` : ''}</span></div>
      <div class="st-list ml-list">${
        list
          .slice(0, this.SHOWN)
          .map(entry => this._row(entry))
          .join('') || '<p class="muted">Не найдено.</p>'
      }</div>`;
  }

  /**
   * Обработчики в окне фидов.
   * @param {HTMLElement} main содержимое вкладки
   */
  static bind(main) {
    const box = main.querySelector('#mlBox');
    if (!box) return;
    box.addEventListener('toggle', () => {
      this.expanded = box.open;
      if (box.open && !this.items) this.load(main);
    });
    if (box.open && !this.items) this.load(main);
    box.addEventListener('input', event => {
      if (event.target.dataset.ml !== 'q') return;
      this.query = event.target.value;
      this._list(main);
    });
    box.addEventListener('change', event => {
      const input = event.target;
      if (input.dataset.ml === 'file' && input.files && input.files[0])
        this.put(main, input.dataset.maker, input.files[0]);
    });
    box.addEventListener('click', event => {
      const button = event.target.closest('[data-ml="unpin"]');
      if (button) this.unpin(main, button.dataset.maker);
    });
  }

  /**
   * Загрузить список.
   * @param {HTMLElement} main
   */
  static async load(main) {
    try {
      this.items = (await AdminApi.get('logos')).items || [];
    } catch (error) {
      this.items = [];
      Toast.show(error.message || String(error));
    }
    const body = main.querySelector('#mlBody');
    if (body) body.innerHTML = this.body();
  }

  static _list(main) {
    const list = main.querySelector('.ml-list');
    const holder = document.createElement('div');
    if (!list) return;
    holder.innerHTML = this.body();
    list.replaceWith(holder.querySelector('.ml-list'));
  }

  static _read(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  /**
   * Поставить логотип марки.
   * @param {HTMLElement} main
   * @param {string} maker
   * @param {File} file
   */
  static async put(main, maker, file) {
    if (!this.IMAGE.test(file.type)) {
      Toast.show('Нужна картинка PNG, JPEG или WebP');
      return;
    }
    if (file.size > this.MAX_BYTES) {
      Toast.show('Картинка больше 2 МБ — уменьшите её');
      return;
    }
    const text =
      'Встанет на всё оборудование этого производителя в каталоге и закрепится за ним: фиды его не поменяют, новые позиции получат его.';
    if (!(await AdminDialog.confirm(`Логотип «${maker}»?`, text, 'Поставить'))) return;
    try {
      const reply = await AdminApi.post('logos', { maker, image: await this._read(file) });
      Toast.show(
        `Логотип «${reply.maker}» закреплён${reply.items ? ` — обновлено ${reply.items} ${KPGen.plural(reply.items, 'позиция', 'позиции', 'позиций')}` : ''}`,
      );
      await this._reload(main);
    } catch (error) {
      Toast.show(error.message || String(error));
    }
  }

  static async _reload(main) {
    Logos.reload();
    this.items = null;
    await this.load(main);
  }

  /**
   * Открепить логотип марки.
   * @param {HTMLElement} main
   * @param {string} maker
   */
  static async unpin(main, maker) {
    if (
      !(await AdminDialog.confirm(
        `Открепить логотип «${maker}»?`,
        'На оборудовании он останется; фиды снова смогут ставить свой логотип.',
        'Открепить',
      ))
    )
      return;
    try {
      await AdminApi.post('logos', { maker, unpin: true });
      Toast.show('Логотип откреплён');
      await this._reload(main);
    } catch (error) {
      Toast.show(error.message || String(error));
    }
  }
}
