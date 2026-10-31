import { KitPart } from './kit-part.js';
import { StationDefaults } from './station-defaults.js';
import { StationAuto, StationName } from './station-auto.js';
import { Api } from '../../core/net.js';
import { Toast } from '../../core/toast.js';
import { KitScope } from './kit-scope.js';
import { KpState, S } from '../../core/state.js';
import { $, esc } from '../../core/util.js';
import { Catalog } from '../catalog/catalog-store.js';
import { KpForm } from '../../core/kp-form.js';
import { Kit } from '../../core/kit.js';
import { StationPlan } from '../req/station-plan.js';
import { NeedPick } from './need-pick.js';
import { PickFilter, PickFind } from './pick-filter.js';

/**
 * Окно выбора позиции каталога для элемента состава: cats — только эти категории, role — роль элемента, preset — подбор по
 * нужному (KitNeed): фильтры {f, r, min, test}, строка need («что нужно» — над списком, с «Показать все»), рекомендуемый
 * best {id, n} — первым, количество, замена прежних элементов; для нового элемента — строки rows и attrs.
 */
export class KitPick {
  static ROWS = 60;
  static FOCUS_DELAY = 30;

  /**
   * Открыть окно подбора.
   * @param {number} index позиция КП
   * @param {{cats?: string[], role?: string, name?: string, preset?: object, by?: string}} [options]
   */
  static open(index, options = {}) {
    new KitPick(index, options)._show();
  }

  constructor(index, { cats = null, role = null, name = '', preset = null, by: scope = '' } = {}) {
    Object.assign(this, { index, cats, role, name, preset, by: scope });
    this.dialog = $('#dlg');
    this.dialog.classList.add('wide');
    this.filter = PickFilter.create(cats);
    if (name && !cats) this.filter.q = name;
    this.all = false;
    this._usePreset();
    this.best = preset && preset.best ? Catalog.cache.find(card => card.id === preset.best.id) : null;
  }

  _usePreset() {
    const { preset, filter } = this;
    if (!preset) return;
    Object.assign(filter.f, preset.f || {});
    for (const [key, range] of Object.entries(preset.r || {})) filter.r[key] = [...range];
    filter.min = { ...(preset.min || {}) };
    filter.test = preset.test || null;
  }

  _newButton() {
    return `<button class="btn" type="button" data-kitnew="1">+ Новый элемент${this.name ? ` «${esc(this.name)}»` : ''}</button>`;
  }

  _title() {
    if (this.role === 'main') return `${esc(Kit.station(S.items[this.index]).mainLabel)} — подбор в каталоге`;
    return this.name ? `${esc(this.name)} — подбор в каталоге` : 'Элемент из каталога';
  }

  _head() {
    const { preset, all } = this;
    if (!preset || !preset.need) return '';
    const text = all ? 'Показаны все. Отметка «мало» — не подходит по нужному.' : `✓ ${esc(preset.need)}`;
    return `<div class="pf-need${all ? ' all' : ''}"><span>${text}</span><button class="btn sm ghost" type="button" data-pfall>${all ? 'Только подходящие' : 'Показать все'}</button></div>`;
  }

  /** рекомендуемый — первым, даже если считан точнее фильтров; поиск, вид и производитель — соблюдаем */
  _top() {
    if (!this.best) return false;
    const filter = this.all ? this.filter : { ...this.filter, f: {}, r: {}, min: {}, test: null };
    return PickFilter.matches(this.best, filter, this.cats);
  }

  _tag(card) {
    const { preset } = this;
    if (card === this.best) return `<span class="pf-best">★ Рекомендуем${this._bestNote()}</span>`;
    return this.all && preset && !NeedPick.fits(card, preset) ? '<span class="pf-low">мало</span>' : '';
  }

  _bestNote() {
    const best = this.preset.best;
    if (best.label) return `: ${esc(best.label)}`;
    return best.n > 1 ? `: ${best.n} шт. параллельно` : '';
  }

  _list() {
    const found = PickFilter.list(this.filter, this.cats, KitPick.ROWS);
    const cards = this._top() ? [this.best, ...found.list.filter(card => card.id !== this.best.id)] : found.list;
    const more = found.n > KitPick.ROWS ? ' — показаны первые 60, уточните фильтры' : '';
    const rows = cards
      .map(card => PickFilter.row(card, 'data-cid', this._tag(card), card === this.best ? ' best' : ''))
      .join('');
    return `<p class="muted pf-n">Найдено: ${found.n}${more}</p>${rows || this._none()}`;
  }

  _none() {
    return `<div class="kit-none"><p>В каталоге нет подходящего${this.name ? ` для «${esc(this.name)}»` : ''}.</p>${this._newButton()}<small class="muted">Элемент появится в составе — описание и характеристики заполните вручную или кнопкой «✨ ИИ».</small></div>`;
  }

  _draw() {
    $('#kitPN').innerHTML = this._head();
    $('#kitPF').innerHTML = PickFilter.html(this.filter, this.cats);
    $('#kitPL').innerHTML = this._list();
  }

  _show() {
    const dialog = this.dialog;
    dialog.innerHTML = `<div class="dlg-h"><h3>${this._title()}</h3>${this._newButton()}<button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
    <div class="dlg-b"><div id="kitPN"></div><div id="kitPF"></div><div class="kit-pl" id="kitPL"></div></div>`;
    dialog.showModal();
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    this._draw();
    if (!this.preset) setTimeout(() => dialog.querySelector('[data-pf="q"]')?.focus(), KitPick.FOCUS_DELAY);
    $('#kitPF').oninput = event => this._input(event);
    $('#kitPF').onchange = event => {
      if (event.target.tagName === 'SELECT') this._filterChanged(event);
    };
    dialog.querySelector('.dlg-h [data-kitnew]').onclick = () => this._addNew();
    $('#kitPN').onclick = event => this._toggleAll(event);
    $('#kitPL').onclick = event => this._click(event);
  }

  _input(event) {
    if (event.target.tagName !== 'INPUT') return;
    if (event.target.dataset.pf === 'q') PickFind.later(() => this.dialog.open && this._filterChanged(event));
    else this._filterChanged(event);
  }

  _filterChanged(event) {
    const field = event.target.closest('[data-pf]');
    if (!field) return;
    if (PickFilter.set(this.filter, field)) this._draw();
    else $('#kitPL').innerHTML = this._list();
  }

  /** «Показать все» — без фильтров по нужному (неподходящие — с отметкой «мало»), «Только подходящие» — вернуть */
  _toggleAll(event) {
    if (!event.target.closest('[data-pfall]')) return;
    this.all = !this.all;
    if (this.all) Object.assign(this.filter, { f: {}, r: {}, min: {}, test: null, maker: '' });
    else this._usePreset();
    this._draw();
  }

  _click(event) {
    if (event.target.closest('[data-kitnew]')) {
      this._addNew();
      return;
    }
    const button = event.target.closest('[data-cid]');
    if (button) this._pick(button.dataset.cid);
  }

  _item() {
    const item = S.items[this.index];
    item.kit = item.kit || { parts: [] };
    return item;
  }

  _role(part) {
    if (this.role) part.role = this.role;
    if (this.by && this.by !== KitScope.def(part)) part.by = this.by;
  }

  /** количество (рекомендуемый — сколько нужно параллельно), ступень фильтра, роль ресивера, замена прежних элементов */
  _put(item, part, cardId) {
    const { preset, best } = this;
    const qty = best && cardId === best.id ? preset.best.n : preset && preset.qty;
    if (qty > 1) part.qty = qty;
    if (!preset) return;
    if (preset.grade) part.airGrade = preset.grade;
    if (preset.role) part.recvRole = preset.role;
    if (!Array.isArray(preset.replace)) return;
    const place = item.kit.parts.findIndex(line => preset.replace.includes(line.id));
    if (preset.swapRow && place >= 0) part._at = place;
    item.kit.parts = item.kit.parts.filter(line => !preset.replace.includes(line.id));
  }

  _addNew() {
    const item = this._item();
    const part = StationDefaults.fill(Kit.newPart({ name: this.name || (this.filter.q || '').trim() }), item);
    if (this.role) part.role = this.role;
    this._presetRows(part);
    if (this.by && this.by !== KitScope.def(part)) part.by = this.by;
    this._put(item, part);
    item.kit.parts.push(part);
    item.page = true;
    this.dialog.close();
    KpForm.render();
    KpState.persist();
    Toast.show('Элемент добавлен — описание и характеристики: вручную или кнопкой «✨ ИИ»');
  }

  _presetRows(part) {
    const { preset } = this;
    if (!preset) return;
    if (preset.attrs)
      part.attrs = Object.fromEntries(
        Object.entries(preset.attrs).filter(([, value]) => value != null && value !== ''),
      );
    for (const row of preset.rows || []) if (!part.rows.some(line => line.k === row.k)) part.rows.push({ ...row });
  }

  async _pick(cardId) {
    const lite = Catalog.cache.find(card => card.id === cardId);
    let doc = lite;
    try {
      doc = await Api.request(`/api/catalog/${encodeURIComponent(lite.id)}`);
    } catch {
      // нет связи — элемент из краткой карточки
    }
    const item = this._item();
    const part = KitPart.fromCat(doc);
    this._role(part);
    this._put(item, part, lite.id);
    this._insert(item, part);
    Kit.sync(item);
    StationAuto.fill(item);
    StationName.apply(item);
    StationPlan.cache.delete(item.id);
    this.dialog.close();
    KpForm.render();
    KpState.persist();
    const qty = +part.qty > 1 ? `${part.qty} × ` : '';
    Toast.show(`${this.preset && this.preset.replace ? 'Заменено: ' : 'Добавлено в состав: '}${qty}${doc.name}`);
  }

  /** «⇄ Заменить» в строке — на её место; основное оборудование — перед контейнером */
  _insert(item, part) {
    const parts = item.kit.parts;
    if (part._at != null) {
      parts.splice(Math.min(part._at, parts.length), 0, part);
      delete part._at;
    } else if (this.role === 'main') {
      const place = parts.findIndex(line => line.role === 'container');
      parts.splice(place >= 0 ? place : 0, 0, part);
    } else parts.push(part);
  }
}
