import { FormView } from './form-view.js';
import { Mobile } from './mobile.js';
import { Problems } from './side-panel.js';
import { ClientStep } from './step-client.js';
import { CondsStep } from './step-conds.js';
import { CoverStep } from './step-cover.js';
import { EquipStep } from './step-equipment.js';
import { ManagerStep } from './step-manager.js';
import { PriceStep } from './step-price.js';

/** Разделы (шаги) КП: список, какие показаны, переход, полоса шагов и кнопки «назад / далее». */
export class Steps {
  static LIST = [
    { id: 'client', t: 'Клиент', d: 'Кому и когда', f: () => ClientStep.html() },
    { id: 'equip', t: 'Оборудование', d: 'Подбор из каталога, опции, фото', f: () => EquipStep.html() },
    { id: 'price', t: 'Цены и валюта', d: 'Валюта, НДС, цены и скидки', f: () => PriceStep.html() },
    { id: 'cover', t: 'Оформление КП', d: 'Шаблон, титул, страница клиентов', f: () => CoverStep.html() },
    { id: 'conds', t: 'Условия', d: 'Сроки, оплата, гарантия', f: () => CondsStep.html() },
    { id: 'mgr', t: 'Менеджер', d: 'Контакты в КП', f: () => ManagerStep.html() },
  ];
  static STORE_KEY = 'kp.step';
  static FOCUS_DELAY = 60;
  // поле с ошибкой → шаг: по id блока и по тексту замечания
  static TARGETS = [
    [/^st-client/, 'client'],
    [/^st-price|^prow-/, 'price'],
    [/^st-items|^item-/, 'equip'],
    [/^st-cover/, 'cover'],
    [/^st-conds/, 'conds'],
    [/^st-manager/, 'mgr'],
  ];
  static PRICE_TEXT = /курс|закупк|: укажите цену/i;
  static DONE = {
    client: () => !!S.client.trim(),
    equip: () => S.items.length > 0,
    price: () => S.items.length > 0 && S.items.every(item => item.price > 0),
    cover: () => !!(S.cover.model || KpModels.list().length > 1),
    conds: () => S.conditions.some(cond => cond.value),
    mgr: () => !!S.manager.name,
  };

  /**
   * «Менеджер — строкой»: ФИО и телефон заполнены — шага нет в списке, менеджер строкой в боковой панели.
   * @returns {boolean}
   */
  static mgrLine() {
    return FEAT.on('mgrLine') && !!String(S.manager.name || '').trim() && !!String(S.manager.phone || '').trim();
  }

  /**
   * Шаги, которые сейчас показаны (открытый шаг — всегда).
   * @returns {object[]}
   */
  static visible() {
    return this.LIST.filter(step => step.id !== 'mgr' || STEP === 'mgr' || !this.mgrLine());
  }

  /** Открыть шаг, запомненный на этом устройстве. */
  static restore() {
    try {
      const saved = localStorage.getItem(this.STORE_KEY);
      if (this.LIST.some(step => step.id === saved)) STEP = saved;
    } catch {
      // хранилище недоступно — шаг по умолчанию
    }
  }

  /**
   * Шаг, на котором поле с замечанием.
   * @param {string} target id блока
   * @param {string} [message] текст замечания
   * @returns {string|null}
   */
  static ofTarget(target, message = '') {
    if (/^st-client/.test(target)) return 'client';
    if (/^st-price|^prow-/.test(target) || this.PRICE_TEXT.test(message)) return 'price';
    const found = this.TARGETS.find(([pattern]) => pattern.test(target));
    return found ? found[1] : null;
  }

  /**
   * Перейти на шаг (и к полю target).
   * @param {string} id
   * @param {string} [target]
   */
  static open(id, target) {
    STEP = id;
    try {
      localStorage.setItem(this.STORE_KEY, id);
    } catch {
      // хранилище недоступно — шаг не запоминается
    }
    FormView.render();
    window.scrollTo({ top: 0, behavior: Mobile.isPhone() ? 'auto' : 'smooth' });
    if (id === 'price') autoRates();
    if (target) setTimeout(() => this._focus(target), this.FOCUS_DELAY);
  }

  static _focus(target) {
    const box = document.getElementById(target);
    if (!box) return;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    box.querySelector('input.bad, input')?.focus({ preventScroll: true });
  }

  /**
   * Полоса шагов с отметками «заполнено» и «есть замечания».
   * @returns {string}
   */
  static stepperHtml() {
    const bad = new Set(
      Problems.list()
        .map(row => this.ofTarget(row[1], row[0]))
        .filter(Boolean),
    );
    const buttons = this.visible()
      .map((step, k) => this._button(step, k, bad))
      .join('');
    return `<nav class="stepper" aria-label="Разделы КП">${buttons}</nav>`;
  }

  static _state(id, bad) {
    if (id === STEP) return 'cur';
    if (bad.has(id)) return 'bad';
    return this.DONE[id]() ? 'ok' : '';
  }

  static _button(step, k, bad) {
    const state = this._state(step.id, bad);
    return `<button type="button" class="stp ${state}" data-step="${step.id}" title="${esc(step.d)}" aria-current="${step.id === STEP ? 'step' : 'false'}">
        <span class="num">${state === 'ok' ? '✓' : k + 1}</span><span class="tx"><b>${step.t}</b></span>${state === 'bad' ? '<i class="dot" title="Есть незаполненные поля"></i>' : ''}</button>`;
  }

  /**
   * Кнопки «назад» и «далее» (на последнем шаге — к сохранению).
   * @returns {string}
   */
  static navHtml() {
    const list = this.visible();
    const k = list.findIndex(step => step.id === STEP);
    const prev = list[k - 1];
    const next = list[k + 1];
    const back = prev
      ? `<button class="btn" type="button" data-step="${prev.id}">← ${prev.t}</button>`
      : '<span></span>';
    const forward = next
      ? `<button class="btn primary" type="button" data-step="${next.id}">Далее: ${next.t} →</button>`
      : `<button class="btn primary" type="button" data-a="toSave">Перейти к сохранению КП →</button>`;
    return `<div class="stepnav">${back}
    ${forward}</div>`;
  }
}
