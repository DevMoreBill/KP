import { AdminApi, AdminDialog, AdminState } from './admin-core.js';
import { DirEditor } from './dir-editor.js';
import { SettingsWindow } from './settings-window.js';
import { StDirty } from './settings-tools.js';
import { XlsImport } from '../catalog/excel-import.js';
import { CatalogWindow } from '../catalog/catalog-window.js';
import { KpState, S } from '../../core/state.js';
import { CatalogEditor } from '../catalog/catalog-edit.js';
import { Api } from '../../core/net.js';
import { Managers } from '../kp/managers.js';
import { Catalog } from '../catalog/catalog-store.js';
import { Toast } from '../../core/toast.js';
import { KpFilesPanel } from '../kp/kp-files.js';
import { ClientsImport } from '../kp/clients-import.js';
import { Debounce } from '../../core/debounce.js';
import { $, esc } from '../../core/util.js';
import { DefRegistry } from '../../core/defaults.js';
import { KpTabs } from '../kp/kp-tabs.js';
import { KpForm } from '../../core/kp-form.js';

/**
 * Записи базы: КП, товары, клиенты, поставщики, контакты менеджеров — поиск, правка, удаление в корзину (вкладка на каждый
 * вид; повторные вызовы без вида остаются на том же).
 */
export class RecordsTab {
  static TYPES = [
    ['kp', 'КП из журнала'],
    ['catalog', 'Товары каталога'],
    ['manager', 'Контакты менеджеров'],
    ['client', 'Клиенты'],
    ['supplier', 'Поставщики'],
  ];
  static LINK = { supplier: ['feeds', 'Фиды поставщиков →'] };
  static HOW = {
    kp: 'КП откроется в конструкторе для правки',
    catalog: 'карточка товара в редакторе каталога',
    manager: 'контакты менеджера — прямо в списке',
    client: 'реквизиты и контакт клиента — прямо в списке',
    supplier:
      'условия, реквизиты, склады (адрес отгрузки), режим работы, контакты и оборудование поставщика — прямо в списке',
  };
  static SEARCH_WAIT = 250;
  static TRASH_DAYS = 30;

  /**
   * Вкладка.
   * @param {HTMLElement} main
   * @param {string} [type] вид записей
   */
  static async render(main, type) {
    const del = AdminState.del;
    if (type && type !== del.type) {
      del.type = type;
      del.sel.clear();
      del.q = '';
      AdminState.editing = null;
    }
    const reply = await AdminApi.get(`list/${del.type}?q=${encodeURIComponent(del.q)}`);
    const edit = AdminState.editing && AdminState.editing.type === del.type ? AdminState.editing : null;
    const rows = reply.items.map(row => this._row(row, edit)).join('') || '<p class="muted">Ничего не найдено.</p>';
    main.innerHTML = `${this._bar(reply)}
    ${edit && !edit.id ? '<div class="st-ed"></div>' : ''}
    <div class="st-list">${rows}</div>
    ${this._note()}`;
    this._editor(main);
    this._bind(main);
  }

  static _trashDays() {
    return DefRegistry.num('srv.trashDays', this.TRASH_DAYS);
  }

  static _bar(reply) {
    const del = AdminState.del;
    const link = this.LINK[del.type];
    const found =
      reply.total > reply.items.length
        ? `показано ${reply.items.length} из ${reply.total} — уточните поиск`
        : `найдено: ${reply.total}`;
    const importBtn =
      del.type === 'client'
        ? '<button class="btn" type="button" data-dimp title="Список ИНН — реквизиты подтянутся сами">Загрузить списком ИНН…</button>'
        : '';
    const newBtn = DirEditor.NEW[del.type]
      ? `<button class="btn primary" type="button" data-dnew>+ ${esc(DirEditor.NEW[del.type])}</button>`
      : '';
    return `<div class="row st-dbar"><input type="search" id="dQ" placeholder="Поиск" value="${esc(del.q)}" autocomplete="off"><span class="muted">${found}</span>
      <span class="sp"></span>${importBtn}${newBtn}<button class="btn danger" type="button" data-del ${del.sel.size ? '' : 'disabled'}>Удалить${del.sel.size ? ` (${del.sel.size})` : ''}</button>${link ? `<button class="btn ghost" type="button" data-sttab="${link[0]}">${link[1]}</button>` : ''}</div>`;
  }

  static _row(row, edit) {
    const del = AdminState.del;
    const files =
      del.type === 'kp' && row.files
        ? `<button class="btn" type="button" data-dfiles="${esc(row.id)}" data-dt="${esc(row.title)}" title="Справочные документы КП: посмотреть, удалить">📎 ${esc(String(row.files))}</button>`
        : '';
    const open = edit && edit.id === row.id;
    return `<label class="st-row ck-row${open ? ' on' : ''}"><input type="checkbox" data-did="${esc(row.id)}" ${del.sel.has(row.id) ? 'checked' : ''}><div><b>${esc(row.title)}</b><span class="muted">${esc(row.sub)}</span></div><div class="acts">${files}<button class="btn" type="button" data-dedit="${esc(row.id)}">${del.type === 'kp' ? 'Открыть' : 'Изменить'}</button></div></label>${open ? '<div class="st-ed"></div>' : ''}`;
  }

  static _note() {
    const type = AdminState.del.type;
    const files =
      type === 'kp'
        ? ' «📎» — справочные документы КП: скачать или удалить ошибочный файл; у КП в корзине документы сохраняются.'
        : '';
    return `<p class="muted">«${type === 'kp' ? 'Открыть' : 'Изменить'}» — ${this.HOW[type]}. Удалённое попадает в корзину и хранится ${this._trashDays()} дн. — его можно восстановить. Файлы готовых КП (.docx, .pdf) в папке КП не удаляются.${files}</p>`;
  }

  static _editor(main) {
    const box = main.querySelector('.st-ed');
    if (!box) return;
    DirEditor.draw(box);
    DirEditor.bind(box, () => this.render(main));
    box.scrollIntoView({ block: 'nearest' });
    box.querySelector('[data-ef]')?.focus({ preventScroll: true });
  }

  static _bind(main) {
    const del = AdminState.del;
    const search = new Debounce(this.SEARCH_WAIT);
    $('#dQ').oninput = event => {
      del.q = event.target.value;
      search.run(() =>
        this.render(main).then(() => {
          const input = $('#dQ');
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        }),
      );
    };
    main.onchange = event => this._check(main, event);
    main.onclick = event => this._click(main, event);
  }

  static _check(main, event) {
    const del = AdminState.del;
    const box = event.target.closest('[data-did]');
    if (!box) return;
    if (box.checked) del.sel.add(box.dataset.did);
    else del.sel.delete(box.dataset.did);
    const button = main.querySelector('[data-del]');
    button.disabled = !del.sel.size;
    button.textContent = `Удалить${del.sel.size ? ` (${del.sel.size})` : ''}`;
  }

  static async _click(main, event) {
    if (event.target.closest('.st-ed')) return;
    if (event.target.closest('[data-dimp]')) {
      ClientsImport.open();
      return;
    }
    const files = event.target.closest('[data-dfiles]');
    if (files) {
      event.preventDefault();
      KpFilesPanel.open(files.dataset.dfiles, files.dataset.dt.replace(/^№\s*/, ''), {
        admin: true,
        onClose: () => this.render(main),
      });
      return;
    }
    if (event.target.closest('[data-dnew]')) {
      await this._open(main, null);
      return;
    }
    const edit = event.target.closest('[data-dedit]');
    if (edit) {
      event.preventDefault();
      await this._edit(main, edit.dataset.dedit);
      return;
    }
    if (event.target.closest('[data-del]')) await this._delete(main);
  }

  // открытая карточка с правками — сначала спросить
  static async _open(main, id) {
    if (AdminState.editing && !(await StDirty.leave())) return;
    try {
      await DirEditor.open(AdminState.del.type, id);
    } catch (error) {
      Toast.show(error.message || String(error));
      return;
    }
    this.render(main);
  }

  static async _edit(main, id) {
    const type = AdminState.del.type;
    if (!DirEditor.NEW[type]) {
      try {
        await RecordEdit.open(type, id, () => this.render(main));
      } catch (error) {
        Toast.show(error.message || String(error));
      }
      return;
    }
    if (AdminState.editing && AdminState.editing.id === id) {
      if (!(await StDirty.leave())) return;
      AdminState.editing = null;
      this.render(main);
      return;
    }
    await this._open(main, id);
  }

  static async _delete(main) {
    const del = AdminState.del;
    const count = del.sel.size;
    const label = (this.TYPES.find(row => row[0] === del.type) || [])[1];
    const text = `Записи будут в корзине ${this._trashDays()} дн. (их можно восстановить), затем удалятся окончательно.`;
    if (!(await AdminDialog.confirm(`Удалить? ${label}: ${count}`, text, 'Удалить'))) return;
    let reply = null;
    try {
      reply = await AdminApi.post('delete', { type: del.type, ids: [...del.sel] });
    } catch (error) {
      Toast.show(`Не удалено: ${error.message || error}`);
      return;
    }
    del.sel.clear();
    Toast.show(`Удалено: ${reply.deleted}`);
    if (del.type === 'catalog') Catalog.refresh();
    if (del.type === 'manager') Managers.load().then(() => KpForm.render());
    this.render(main);
  }
}

/** Правка записи из «Настроек»: КП — в конструкторе, товар — в редакторе каталога. */
export class RecordEdit {
  /**
   * Открыть запись для правки.
   * @param {string} type kp | catalog
   * @param {string} id
   * @param {Function} after после сохранения товара
   */
  static async open(type, id, after) {
    if (type === 'kp') {
      await this._kp(id);
      return;
    }
    if (type !== 'catalog') return;
    const doc = await Api.request(`/api/catalog/${encodeURIComponent(id)}`);
    CatalogEditor.open(doc, () => {
      Catalog.refresh();
      after();
    });
  }

  static async _kp(id) {
    const state = await Api.request(`/api/kp/${encodeURIComponent(id)}/state`);
    if (!(await KpTabs.prepare({ kpId: id }))) return;
    KpState.replace(Object.assign(KpState.fresh(), state));
    SettingsWindow.dialog().close();
    KpForm.render();
    KpState.persist();
    window.scrollTo({ top: 0 });
    Toast.show(`КП № ${S.number || ''} открыто для редактирования`);
  }
}

/** Каталог из «Настроек»: импорт из Excel, загрузка и выгрузка файла каталога (те же действия, что в «Ещё» окна каталога). */
export class CatalogTool {
  /**
   * Действие.
   * @param {string} action exp | xls | open | (загрузить файл)
   * @returns {*}
   */
  static run(action) {
    if (action === 'exp') return CatalogWindow.win.exportFile();
    if (action === 'xls') return XlsImport.open('');
    if (action === 'open') {
      SettingsWindow.dialog().close();
      return CatalogWindow.open({});
    }
    this._load();
    return undefined;
  }

  static _load() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.hidden = true;
    document.body.appendChild(input);
    input.onchange = async () => {
      const file = input.files[0];
      input.remove();
      if (!file) return;
      SettingsWindow.dialog().close();
      await CatalogWindow.open({});
      CatalogWindow.win.importFile(file);
    };
    input.click();
  }
}
