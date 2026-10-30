import { CatalogIndex } from './catalog-index.js';
import { Catalog } from './catalog-store.js';
import { Api } from '../../core/net.js';
import { Str } from '../../core/str.js';
import { $, esc } from '../../core/util.js';
import { EquipTypes } from '../../core/equip-types.js';
import { KpForm } from '../../core/kp-form.js';

/** Новая категория из окна каталога: параметры, фильтры и раздел берутся у категории-образца. */
export class NewTypeDialog {
  static OTHER = 'Прочее';
  static NEW_GROUP = '__new';
  static FOCUS_DELAY = 30;
  static ID_BASE = 36;
  static JSON_TYPE = 'application/json; charset=utf-8';

  static _base(win, base) {
    if (base) return base;
    if (win.F.cat) return win.F.cat;
    const active = win.active && win.doc(win.active) && CatalogIndex.attrs(win.doc(win.active)).cat;
    return active || (EquipTypes.list.find(type => type.role !== 'accessory' && !type.station) || {}).id || 'other';
  }

  static _html(base) {
    const groups = [...new Set(EquipTypes.list.map(type => type.group || this.OTHER))];
    const own = EquipTypes.byId(base).group || this.OTHER;
    const opts = groups.map(group => `<option${group === own ? ' selected' : ''}>${esc(group)}</option>`).join('');
    return `<div class="dlg-h"><h3>Новая категория</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
     <div class="dlg-b"><div class="grid">
       <label class="f"><span class="req">Название категории</span><input type="text" id="ntName" placeholder="Например: Спиральные компрессоры" autocomplete="off"></label>
       <div class="grid g2"><label class="f"><span>Раздел</span><select id="ntGroup">${opts}<option value="__new">+ новый раздел…</option></select></label>
         <label class="f" id="ntGroupNewL" style="display:none"><span>Название раздела</span><input type="text" id="ntGroupNew" placeholder="Например: Подготовка воздуха" autocomplete="off"></label></div>
       <label class="f"><span>Параметры и фильтры — как у категории</span><select id="ntBase">${EquipTypes.optionsHtml(base)}</select></label></div>
     <p class="muted">Из выбранной категории копируются параметры (мощность, давление, производительность…), фильтры каталога и быстрые опции. Тонкая настройка — «Ещё» → «Категории оборудования».</p>
     <p class="msg err" id="ntErr" style="text-align:left"></p>
     <div class="row" style="justify-content:flex-end"><button class="btn" type="button" data-close>Отмена</button><button class="btn primary" type="button" id="ntSave">Создать категорию</button></div></div>`;
  }

  static _err(text) {
    $('#ntErr').textContent = text;
  }

  static _clean(text) {
    return text.replace(/\s+/g, ' ').trim();
  }

  static _group() {
    return $('#ntGroup').value === this.NEW_GROUP ? this._clean($('#ntGroupNew').value) : $('#ntGroup').value;
  }

  static _type(name, group) {
    const base = JSON.parse(JSON.stringify(EquipTypes.byId($('#ntBase').value)));
    const type = {
      ...base,
      id: `u${Date.now().toString(this.ID_BASE)}`,
      name,
      group,
      item: base.item || name,
      coverTitle: name,
      match: '',
    };
    delete type.hidden;
    return type;
  }

  static async _save(win, then) {
    const dialog = $('#dlg');
    const name = this._clean($('#ntName').value);
    if (!name) return this._err('Укажите название категории');
    if (EquipTypes.list.some(type => Str.norm(type.name) === Str.norm(name)))
      return this._err('Такая категория уже есть — выберите её в списке');
    const group = this._group();
    if (!group) return this._err('Укажите название раздела');
    const type = this._type(name, group);
    $('#ntSave').disabled = true;
    try {
      await Api.request('/api/types', {
        method: 'PUT',
        headers: { 'Content-Type': this.JSON_TYPE },
        body: JSON.stringify({ version: 1, add: [type] }),
      });
      await EquipTypes.load();
      Catalog.cache.forEach(card => CatalogIndex.forget(card));
    } catch (error) {
      $('#ntSave').disabled = false;
      return this._err(`Не удалось сохранить категорию: ${error.message || error}`);
    }
    dialog.close();
    KpForm.render();
    win.redraw();
    win.say(`Создана категория «${name}»`);
    if (then) then(type.id);
    return undefined;
  }

  /**
   * Открыть окно новой категории.
   * @param {object} win окно каталога
   * @param {function(string): *} [then] категория создана
   * @param {string} [base] категория-образец
   */
  static open(win, then, base) {
    const dialog = $('#dlg');
    dialog.classList.remove('wide');
    dialog.innerHTML = this._html(this._base(win, base));
    dialog.showModal();
    dialog.querySelectorAll('[data-close]').forEach(button => {
      button.onclick = () => dialog.close();
    });
    $('#ntGroup').onchange = event => {
      const fresh = event.target.value === this.NEW_GROUP;
      $('#ntGroupNewL').style.display = fresh ? '' : 'none';
      if (fresh) $('#ntGroupNew').focus();
    };
    $('#ntName').onkeydown = event => {
      if (event.key === 'Enter') $('#ntSave').click();
    };
    $('#ntSave').onclick = () => this._save(win, then);
    setTimeout(() => $('#ntName').focus(), this.FOCUS_DELAY);
  }
}
