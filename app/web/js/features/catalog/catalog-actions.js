import { CatalogCache } from './catalog-cache.js';
import { CatalogEditor } from './catalog-edit.js';
import { CatalogFill } from './catalog-fill.js';
import { CatalogIndex } from './catalog-index.js';
import { Catalog, CatalogStore } from './catalog-store.js';
import { FileSave } from '../../core/files.js';
import { Api } from '../../core/net.js';
import { CatalogBin } from './catalog-export.js';
import { Auth } from '../kp/auth.js';
import { $, Uid, esc, today } from '../../core/util.js';
import { Steps } from '../../ui/steps.js';
import { FormView } from '../../ui/form-view.js';
import { EquipTypes } from '../../core/equip-types.js';
import { Attrs } from '../../core/item-attrs.js';
import { KpState, S } from '../../core/state.js';

/** Действия окна каталога: добавить в КП, перенести в категорию (с отменой), правка, копия, корзина, файл каталога. */
export class CatalogActions {
  static OTHER = 'Прочее';
  static BUSY_FROM = 3;
  static TYPE_ID = /^[a-z][a-z0-9_]{1,30}$/;
  static JSON_TYPE = 'application/json; charset=utf-8';

  static _positions(count) {
    return KPGen.plural(count, 'позиция', 'позиции', 'позиций');
  }

  /**
   * Позиция КП +1 шт. (и опции с тем же количеством).
   * @param {object} item
   */
  static qtyUp(item) {
    const old = +item.qty || 0;
    item.qty = old + 1;
    (item.options || []).forEach(option => {
      if (option.unit !== 'усл.' && +option.qty === old) option.qty = item.qty;
    });
  }

  static async _addOptions(win, ids) {
    const item = S.items[win.optFor];
    if (!item) return;
    item.options = item.options || [];
    let added = 0;
    for (const id of ids) {
      if (item.options.some(option => option.catId === id)) continue;
      const card = await Catalog.fullDoc(win.doc(id));
      if (!card) continue;
      const attrs = Attrs.of(card);
      const short = card.short || (attrs.cat === 'ats' ? 'АВР' : attrs.model || '');
      item.options.push(
        EquipTypes.newOpt(item, {
          name: card.name,
          short,
          unit: card.unit || 'шт.',
          price: card.price || 0,
          catId: card.id,
        }),
      );
      added++;
    }
    FormView.render();
    KpState.persist();
    win.sel.clear();
    win.list();
    win.say(added ? `Добавлено опций: ${added}` : 'Эти позиции уже добавлены опциями');
    win.preview();
  }

  static async _addItems(win, ids) {
    const opened = S;
    let added = 0;
    let more = 0;
    let step = 0;
    for (const id of ids) {
      if (S !== opened) break;
      if (ids.length > this.BUSY_FROM) win.setBusy(`Добавляю в КП: ${++step} из ${ids.length}`);
      const known = S.items.find(item => item.catId === id);
      if (known) {
        this.qtyUp(known);
        more++;
        continue;
      }
      const card = await Catalog.fullDoc(win.doc(id));
      if (!card || S !== opened) continue;
      const item = KpState.newItem();
      CatalogFill.fill(item, card);
      const blank = S.items.length === 1 && !S.items[0].name && !S.items[0].price;
      if (blank) S.items = [item];
      else S.items.push(item);
      added++;
    }
    return { added, more };
  }

  /**
   * Добавить позиции в КП (или опциями позиции).
   * @param {object} win
   * @param {string[]} ids
   */
  static async add(win, ids) {
    if (win.optFor != null) {
      await this._addOptions(win, ids);
      return;
    }
    const { added, more } = await this._addItems(win, ids);
    win.setBusy('');
    if (Steps.current !== 'equip') {
      Steps.current = 'equip';
      try {
        localStorage.setItem('kp.step', 'equip');
      } catch {
        // браузер не хранит
      }
    }
    FormView.render();
    KpState.persist();
    if (ids.length > 1) win.sel.clear();
    win.list();
    const done = [
      added ? `Добавлено в КП: ${added} ${this._positions(added)}` : '',
      more ? `количество увеличено у ${more}` : '',
    ];
    win.say(`${done.filter(Boolean).join('; ')}. Можно добавить ещё или нажать «Готово — к КП».`);
    win.preview();
  }

  static async _moveOne(id, cat) {
    const full = await CatalogStore.get(id);
    if (!full || !full.id) throw new Error('нет позиции');
    const prev = (full.attrs || {}).cat;
    full.attrs = { ...(full.attrs || {}), cat };
    return (await CatalogStore.put(full))._pending ? null : { id, prev };
  }

  /**
   * Перенести позиции в категорию.
   * @param {object} win
   * @param {string[]} ids
   * @param {string} cat
   */
  static async move(win, ids, cat) {
    const type = EquipTypes.byId(cat);
    const todo = ids.filter(id => {
      const card = win.doc(id);
      return card && CatalogIndex.attrs(card).cat !== cat;
    });
    if (!todo.length) {
      win.say(`Позиции уже в категории «${type.name}»`);
      return;
    }
    const undo = [];
    let step = 0;
    let fail = 0;
    let pend = 0;
    for (const id of todo) {
      win.setBusy(`Переношу в «${type.name}»: ${++step} из ${todo.length}`);
      try {
        const done = await this._moveOne(id, cat);
        if (done) undo.push(done);
        else pend++;
      } catch {
        fail++;
      }
    }
    win.undo = undo.length ? { list: undo, name: type.name } : null;
    win.sel.clear();
    win.busy = '';
    await win.reload();
    win.note = `Перенесено в «${type.name}»: ${undo.length} ${this._positions(undo.length)}${pend ? `, отправлено на модерацию: ${pend}` : ''}${fail ? `, не удалось: ${fail}` : ''}`;
    win.redraw();
  }

  static async _restore(id, prev) {
    const full = await CatalogStore.get(id);
    const attrs = { ...(full.attrs || {}) };
    if (prev) attrs.cat = prev;
    else delete attrs.cat;
    full.attrs = attrs;
    await CatalogStore.put(full);
  }

  /**
   * Отменить последний перенос.
   * @param {object} win
   */
  static async undoMove(win) {
    const undo = win.undo;
    if (!undo) return;
    win.undo = null;
    let step = 0;
    for (const { id, prev } of undo.list) {
      win.setBusy(`Возвращаю: ${++step} из ${undo.list.length}`);
      try {
        await this._restore(id, prev);
      } catch {
        // не вернулась — остаётся в новой категории
      }
    }
    win.busy = '';
    await win.reload();
    win.note = 'Перенос отменён';
    win.redraw();
  }

  static _typeButtons(win, attr) {
    const groups = [...new Set(EquipTypes.list.map(type => type.group || this.OTHER))];
    return groups
      .map(group => {
        const buttons = EquipTypes.list
          .filter(type => (type.group || this.OTHER) === group)
          .map(
            type =>
              `<button type="button" class="btn${type.id === win.F.cat ? ' primary' : ''}" ${attr}="${esc(type.id)}">${esc(type.name)}</button>`,
          )
          .join('');
        return `<p class="sub" style="margin:12px 0 6px">${esc(group)}</p><div class="tpick">${buttons}</div>`;
      })
      .join('');
  }

  /**
   * Самая частая категория среди позиций — образец для новой категории при переносе.
   * @param {object} win
   * @param {string[]} ids
   * @returns {string|undefined}
   */
  static mainCat(win, ids) {
    const counts = new Map();
    ids.forEach(id => {
      const card = win.doc(id);
      if (!card) return;
      const cat = CatalogIndex.attrs(card).cat;
      counts.set(cat, (counts.get(cat) || 0) + 1);
    });
    return [...counts.entries()].sort((first, second) => second[1] - first[1])[0]?.[0];
  }

  /**
   * Окно «Перенести в категорию».
   * @param {object} win
   * @param {string[]} ids
   */
  static moveDlg(win, ids) {
    const dialog = $('#dlg');
    dialog.classList.remove('wide');
    dialog.innerHTML = `<div class="dlg-h"><h3>Перенести ${ids.length} ${KPGen.plural(ids.length, 'позицию', 'позиции', 'позиций')} в категорию</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
     <div class="dlg-b">${this._typeButtons(win, 'data-mv')}
     <div class="row" style="margin-top:16px"><button class="btn" type="button" data-mvnew>+ Новая категория…</button><span class="muted">Нужной категории нет — создайте её, и позиции сразу перенесутся.</span></div></div>`;
    dialog.showModal();
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.querySelector('.dlg-b').onclick = event => {
      const button = event.target.closest('[data-mv]');
      if (button) {
        dialog.close();
        this.move(win, ids, button.dataset.mv);
        return;
      }
      if (!event.target.closest('[data-mvnew]')) return;
      dialog.close();
      win.newType(id => this.move(win, ids, id), this.mainCat(win, ids));
    };
  }

  /**
   * Править позицию.
   * @param {object} win
   * @param {string} id
   */
  static async edit(win, id) {
    if (!Auth.can('catEdit')) {
      Auth.cannot('catEdit');
      return;
    }
    const card = await Catalog.fullDoc(win.doc(id));
    if (card) CatalogEditor.open(card, doc => win.afterSave(doc));
  }

  /**
   * Копия позиции — сразу на правку.
   * @param {object} win
   * @param {string} id
   */
  static async dup(win, id) {
    if (!Auth.can('catAdd')) {
      Auth.cannot('catAdd');
      return;
    }
    const card = await Catalog.fullDoc(win.doc(id));
    if (!card || card._light) {
      win.say('Не удалось загрузить позицию');
      return;
    }
    const copy = JSON.parse(JSON.stringify(card));
    copy.id = Uid.next() + Uid.next();
    copy.name = `${card.name} (копия)`;
    copy.prices = [];
    delete copy.pricesCount;
    CatalogEditor.openNew(copy, doc => win.afterSave(doc));
  }

  /**
   * В корзину (администратор или право «Удалять товары»).
   * @param {object} win
   * @param {string[]} ids
   */
  static async trash(win, ids) {
    const names = ids.map(id => (win.doc(id) || {}).name || '');
    if (!(await CatalogBin.put(ids, names))) return;
    ids.forEach(id => win.sel.delete(id));
    if (ids.includes(win.active)) {
      win.active = null;
      win.dlg().classList.remove('pvwide');
    }
    win.docs = Catalog.cache;
    win.note = `В корзине: ${ids.length} ${this._positions(ids.length)}`;
    win.redraw();
  }

  static _validType(type) {
    return (
      type &&
      this.TYPE_ID.test(type.id || '') &&
      type.name &&
      Array.isArray(type.fields) &&
      type.fields.every(field => field && field.key && field.label) &&
      !EquipTypes.list.some(known => known.id === type.id)
    );
  }

  // новые категории из файла: добавляются к своим; категории с уже существующим id не меняются
  static async _types(win, types) {
    if (!Array.isArray(types)) return 0;
    const add = types.filter(type => this._validType(type));
    if (!add.length) return 0;
    win.setBusy(`Добавляю категории: ${add.map(type => type.name).join(', ')}`);
    await Api.request('/api/types', {
      method: 'PUT',
      headers: { 'Content-Type': this.JSON_TYPE },
      body: JSON.stringify({ version: 1, add }),
    });
    await EquipTypes.load();
    Catalog.cache.forEach(card => CatalogIndex.forget(card));
    return add.length;
  }

  // цена, история цен и опции из каталога остаются, если в файле их нет
  static _keep(card, old) {
    if (!old) return;
    if (!card.price && old.price) card.price = old.price;
    if ((!card.prices || !card.prices.length) && old.prices && old.prices.length) card.prices = old.prices;
    if (!card.options && old.options) card.options = old.options;
  }

  static async _items(win, items) {
    const known = new Map((await CatalogStore.list()).map(card => [card.id, card]));
    let count = 0;
    let pend = 0;
    for (const card of items) {
      if (!(card && card.id && card.name)) continue;
      win.setBusy(`Загружаю каталог: ${++count} из ${items.length}`);
      this._keep(card, known.get(card.id));
      if ((await CatalogStore.putImport(card))._pending) pend++;
    }
    return { count, pend };
  }

  /**
   * Загрузить файл каталога (.json): позиции и новые категории; удаляет дубликаты только администратор.
   * @param {object} win
   * @param {File} file
   */
  static async importFile(win, file) {
    let data = null;
    let items = null;
    try {
      data = JSON.parse(await file.text());
      items = Array.isArray(data) ? data : data.items;
    } catch {
      items = null;
    }
    if (!Array.isArray(items)) {
      win.busy = '';
      win.say('Это не файл каталога КП');
      return;
    }
    try {
      const types = await this._types(win, data.types);
      const { count, pend } = await this._items(win, items);
      const remove = Array.isArray(data.remove) ? data.remove.length : 0;
      win.busy = '';
      await win.reload();
      win.note = `Загружено позиций: ${count}${types ? `, новых категорий: ${types}` : ''}${pend ? `, на модерации: ${pend}` : ''}${remove ? `; дубликаты к удалению (${remove}) удаляет администратор в «Настройках»` : ''}`;
      win.redraw();
    } catch (error) {
      win.busy = '';
      await win
        .reload()
        .catch(reloadError => console.warn('Каталог не обновился после остановки загрузки', reloadError));
      win.say(`Загрузка остановлена: ${error.message || error}`);
    }
  }

  /**
   * Файл каталога для загрузки (.json).
   * @param {object} win
   */
  static async exportFile(win) {
    let all = null;
    try {
      all = (await CatalogStore.full()).map(card => CatalogCache.clean(card));
    } catch (error) {
      win.say(`Файл не создан: ${error.message || error}`);
      return;
    }
    if (!all.length) {
      win.say('Каталог пуст');
      return;
    }
    FileSave.save(
      `Каталог_КП_Пневмотех_${today()}.json`,
      new Blob([JSON.stringify({ format: 'kp-catalog', version: 1, items: all })], { type: 'application/json' }),
    );
  }
}
