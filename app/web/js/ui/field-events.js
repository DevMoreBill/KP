import { FormView } from './form-view.js';
import { SidePanel } from './side-panel.js';
import { Tender } from './tender.js';
import { Attrs } from '../core/item-attrs.js';
import { EquipTypes } from '../core/equip-types.js';
import { CatalogFill } from '../features/catalog/catalog-fill.js';
import { CatFind, Catalog } from '../features/catalog/catalog-store.js';
import { CatalogEditor } from '../features/catalog/catalog-edit.js';
import { Toast } from '../core/toast.js';
import { Logos } from '../features/catalog/image-slots.js';
import { Currency, Discount } from '../features/kp/currency.js';
import { PriceHints } from '../features/kp/price-hints.js';
import { KpFile } from '../features/doc/kp-file.js';
import { $ } from '../core/util.js';
import { KpState, S } from '../core/state.js';
import { ObjPath, Price, Str } from '../core/str.js';
import { OptionSale } from '../features/kp/option-sale.js';

/** Ввод в поля формы КП: поля по пути (data-p), цены, скидки, цены опций, курсы валют. */
export class FieldEvents {
  // поле ввода → обработчик (первое подходящее по атрибуту)
  static INPUTS = [
    ['p', target => FieldEvents._path(target)],
    ['oprice', target => FieldEvents._optionPrice(target)],
    ['price', target => FieldEvents._price(target)],
    ['disc', target => FieldEvents._discount(target)],
    ['rate', target => FieldEvents._rate(target)],
  ];

  /**
   * Ввод в поле.
   * @param {Event} event
   */
  static input(event) {
    const target = event.target;
    const found = this.INPUTS.find(([key]) => (key === 'p' ? !!target.dataset.p : target.dataset[key] != null));
    if (found) found[1](target);
  }

  static _path(target) {
    const path = target.dataset.p;
    let value = target.value;
    if (path.endsWith('.qty')) {
      value = value.replace(/\D/g, '');
      target.value = value;
      value = value === '' ? '' : +value;
      target.classList.toggle('bad', !(value >= 1));
    }
    ObjPath.set(S, path, value);
    if (path.startsWith('cover.')) S.cover.touched = true;
    if (path.startsWith('tender.')) this._tender(target, value);
    SidePanel.updateLive();
  }

  // № закупки не введён — берём из ссылки
  static _numberFromUrl(value) {
    if (String(S.tender.number || '').trim()) return;
    const number = Tender.numberFromUrl(value);
    if (!number) return;
    S.tender.number = number;
    const input = document.querySelector('[data-p="tender.number"]');
    if (input) input.value = number;
  }

  static _tender(target, value) {
    if (target.dataset.p === 'tender.url') {
      this._numberFromUrl(value);
      target.classList.toggle('bad', !!String(value).trim() && !Tender.url());
    }
    document.querySelector('[data-p="tender.number"]')?.classList.toggle('bad', !String(S.tender.number || '').trim());
    const note = $('#kkNote');
    if (note) note.innerHTML = Tender.note();
    const file = document.querySelector('#side .fname');
    if (file && S.kpId) file.textContent = KpFile.saved();
  }

  static _optionPrice(target) {
    const [i, j] = target.dataset.oprice.split('.').map(Number);
    const opt = S.items[i].options[j];
    const price = Price.parse(target.value);
    opt._priceText = target.value;
    OptionSale.set(opt, Number.isNaN(price) ? 0 : price);
    if (price > 0) delete opt.askPrice; // цену продажи поставили — опция идёт в КП
    target.classList.toggle('bad', Number.isNaN(price));
    document.querySelectorAll(`[data-osum="${i}.${j}"]`).forEach(cell => (cell.textContent = OptionSale.sum(opt)));
    SidePanel.updateLive();
  }

  static _price(target) {
    const i = +target.dataset.price;
    const price = Price.parse(target.value);
    const item = S.items[i];
    item._priceText = target.value;
    item.price = Number.isNaN(price) ? 0 : price;
    item.priceManual = true;
    target.classList.toggle('bad', Number.isNaN(price) || !price);
    SidePanel.updateLive();
    PriceHints.live(i);
  }

  static _discount(target) {
    const i = +target.dataset.disc;
    const item = S.items[i];
    item._discText = target.value;
    item._discBad = !Discount.set(item, target.value);
    target.classList.toggle('bad', item._discBad);
    SidePanel.updateLive();
    PriceHints.live(i);
  }

  static _rate(target) {
    S.pricing.rates[target.dataset.rate] = target.value;
    S.pricing.rateSrc = 'вручную';
    OptionSale.syncAll();
    const shown = document.querySelector(`[data-rshow="${target.dataset.rate}"]`);
    if (shown) shown.textContent = target.value || '—';
    SidePanel.updateLive();
  }

  /**
   * Изменение поля: производитель (логотип), галерея, вид позиции, параметры цены и валюты.
   * @param {Event} event
   */
  static change(event) {
    const target = event.target;
    const maker = /^items\.(\d+)\.attrs\.maker$/.exec(target.dataset.p || '');
    if (maker) this._maker(S.items[+maker[1]]);
    if (target.dataset.gon != null) {
      const pic = S.items[+target.dataset.gon].gallery[+target.dataset.j];
      pic.on = target.checked;
      target.closest('.gcard')?.classList.toggle('off', !target.checked);
      KpState.persist();
      return;
    }
    if (/^items\.\d+\.gallery\.\d+\.wide$/.test(target.dataset.p || '') || target.dataset.retype != null) {
      FormView.render();
      KpState.persist();
      return;
    }
    if (target.dataset.aikeep != null) {
      S.items[+target.dataset.aikeep]._aiKeep = target.checked;
      KpState.persist();
      return;
    }
    if (target.dataset.pr) this._pricing(target);
  }

  static _maker(item) {
    Logos.load().then(() => {
      if (!Logos.auto(item)) return;
      FormView.render();
      KpState.persist();
      Toast.show('Логотип производителя подставлен из каталога');
    });
  }

  static _pricing(target) {
    const key = target.dataset.pr;
    if (key === 'cur') {
      Currency.setKp(target.value);
      return;
    }
    S.pricing[key] = target.type === 'checkbox' ? target.checked : target.value;
    FormView.render();
    KpState.persist();
  }

  /**
   * Название позиции или опции из каталога: позиция без цены и фото заполняется по карточке, опция — по заготовке.
   * @param {Event} event
   */
  static async named(event) {
    const path = event.target.dataset.p || '';
    const option = /^items\.(\d+)\.options\.(\d+)\.name$/.exec(path);
    if (option) {
      this._option(S.items[+option[1]].options[+option[2]]);
      return;
    }
    const name = /^items\.(\d+)\.name$/.exec(path);
    if (!name || CatalogEditor.session) return;
    const item = S.items[+name[1]];
    const card = CatFind.name(item.name);
    if (!card || item.price || item.photo) return;
    CatalogFill.fill(item, await Catalog.fullDoc(card));
    FormView.render();
    KpState.persist();
    Toast.show('Позиция подставлена из каталога');
  }

  static _option(opt) {
    const card = CatFind.name(opt.name);
    const preset = EquipTypes.allPresets().find(one => Str.norm(one.name) === Str.norm(opt.name));
    if (preset) {
      opt.short = preset.short;
      opt.unit = preset.unit;
    }
    if (card && !opt.price) {
      opt.price = card.price || 0;
      opt.catId = card.id;
      opt.short = opt.short || Attrs.of(card).model || '';
    }
    FormView.render();
    KpState.persist();
  }

  /**
   * Уход из поля: цена и цена опции — в формате денег; скидка — без перерисовки формы (иначе следующий щелчок,
   * например по «% / руб.», попадёт в уже заменённую кнопку).
   * @param {FocusEvent} event
   */
  static leave(event) {
    const target = event.target;
    if (target.dataset.oprice != null) this._leaveOption(target);
    if (target.dataset.price != null) this._leavePrice(target);
    if (target.dataset.disc != null) {
      const item = S.items[+target.dataset.disc];
      if (!item._discBad) {
        delete item._discText;
        target.value = Discount.text(item);
      }
      KpState.persist();
    }
  }

  static _leaveOption(target) {
    const [i, j] = target.dataset.oprice.split('.').map(Number);
    const opt = S.items[i].options[j];
    const price = Price.parse(target.value);
    if (!Number.isNaN(price)) {
      delete opt._priceText;
      target.value = OptionSale.text(opt);
    }
    KpState.persist();
  }

  static _leavePrice(target) {
    const i = +target.dataset.price;
    const price = Price.parse(target.value);
    if (!Number.isNaN(price) && price) {
      delete S.items[i]._priceText;
      target.value = Price.text(price);
    }
    KpState.persist();
    FormView.render();
  }

  /** Обработчики полей формы (порядок — как раньше: ввод, изменение, название из каталога, уход из поля). */
  static listen() {
    document.addEventListener('input', event => this.input(event));
    document.addEventListener('change', event => this.change(event));
    document.addEventListener('change', event => this.named(event));
    document.addEventListener('focusout', event => this.leave(event));
  }
}
