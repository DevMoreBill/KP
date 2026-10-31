import { DealCal } from './deal-cal.js';
import { DealState } from './deal-state.js';
import { DealTerms } from './deal-terms.js';
import { DealUi } from './deal-ui.js';
import { Fmt, ObjPath } from '../../core/str.js';
import { esc } from '../../core/util.js';
import { Money } from '../../core/money.js';

/** Числа и поля ввода окна «Экономика сделки»: рубли, проценты, поле с отметкой источника, срок днями или датой. */
export class DealFmt {
  static CENTS = 100;
  static PCT_FMT = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

  /**
   * Рубли с копейками.
   * @param {number} value
   * @returns {string}
   */
  static rub(value) {
    return Money.rub2(value);
  }

  /**
   * Процент: «12,50 %»; нет значения — прочерк.
   * @param {number} value
   * @returns {string}
   */
  static pct(value) {
    if (value == null || !Number.isFinite(value)) return '—';
    return `${value.toLocaleString('ru-RU', DealFmt.PCT_FMT)} %`;
  }

  /**
   * Число для поля: до сотых, с запятой.
   * @param {number} value
   * @returns {string}
   */
  static inp(value) {
    if (value == null || !Number.isFinite(value)) return '';
    return String(Math.round(value * DealFmt.CENTS) / DealFmt.CENTS).replace('.', ',');
  }

  /**
   * Пояснение «?».
   * @param {string} html
   * @returns {string}
   */
  static help(html) {
    return `<details class="dl-q"><summary aria-label="Пояснение">?</summary><div>${html}</div></details>`;
  }

  /**
   * Атрибут раскрытого блока «Ещё…»: как открыл менеджер, иначе — по умолчанию.
   * @param {string} key
   * @param {{open: boolean}} fallback
   * @returns {string}
   */
  static more(key, fallback) {
    const open = DealUi.more && key in DealUi.more ? DealUi.more[key] : fallback.open;
    return open ? ' open' : '';
  }

  /**
   * Хоть одно значение заполнено (не пусто и не 0).
   * @param {...*} values
   * @returns {boolean}
   */
  static filled(...values) {
    return values.some(value => value != null && String(value).trim() !== '' && String(value).trim() !== '0');
  }

  /**
   * Итог шага.
   * @param {string} label
   * @param {number} value
   * @param {string} note
   * @returns {string}
   */
  static tot(label, value, note) {
    return `<div class="dl-stot"><span>${note ? `<small>${note}</small>` : ''}</span><div><small>${esc(label)}</small><b>${Fmt.rub(value)}</b></div></div>`;
  }

  /**
   * Поле расчёта: подпись, отметка источника (из КП, авто, вручную), ввод или выбор, валюта, срок датой, ошибка.
   * @param {string} label
   * @param {string} path путь в S.deal
   * @param {object} [opts] { calc, kp, kpLabel, auto, autoLabel, autoTitle, unknown, src, cur, select, text, int, ph, list,
   *   date: {base, val, kind}, cls, unit, q, hint }
   * @returns {string}
   */
  static field(label, path, opts = {}) {
    const deal = DealState.deal();
    const raw = ObjPath.get(deal, path);
    const err = opts.calc && opts.calc.err[path];
    const { value, badge } = DealFmt._source(path, raw, opts);
    const input = opts.select ? DealFmt._select(label, path, raw, opts.select) : DealFmt._input(path, value, opts, err);
    const date = opts.date ? DealFmt._date(label, path, opts.date, deal) : '';
    const unit = opts.unit ? ` <i>${esc(opts.unit)}</i>` : '';
    const head = `<span>${esc(label)}${unit}${badge}${opts.q ? DealFmt.help(opts.q) : ''}</span>`;
    const box = date
      ? DealFmt._dateBox(path, input, opts.date, date)
      : DealFmt._box(input, DealFmt._cur(opts.cur, deal));
    const cls = `f dl-f${err ? ' bad' : ''}${opts.cls ? ` ${opts.cls}` : ''}${date ? ' dd' : ''}`;
    return `<label class="${cls}">${head}
      ${box}
      ${DealFmt._note(err, opts.hint)}</label>`;
  }

  static _own(raw) {
    return raw != null && raw !== '';
  }

  static _reset(path, title, text) {
    return `<button type="button" class="dl-badge own" data-dlx="reset" data-path="${path}" title="${title}">${text}</button>`;
  }

  static _source(path, raw, opts) {
    const own = DealFmt._own(raw);
    let out = { value: raw ?? '', badge: '' };
    if (opts.kp !== undefined) out = DealFmt._fromKp(path, raw, opts, own);
    if (opts.auto !== undefined) out = DealFmt._fromAuto(path, opts, own, out.value);
    if (opts.unknown && !own) out.badge = '<span class="dl-badge warn">неизвестно</span>';
    if (opts.src === 'module') out.badge = '<span class="dl-badge kp">из расчёта логистики</span>';
    return out;
  }

  static _fromKp(path, raw, opts, own) {
    if (own) return { value: raw, badge: DealFmt._reset(path, 'Вернуть значение из КП', 'изменено · ↺') };
    return { value: DealFmt.inp(opts.kp), badge: `<span class="dl-badge kp">${esc(opts.kpLabel || 'из КП')}</span>` };
  }

  static _fromAuto(path, opts, own, value) {
    if (own) return { value, badge: DealFmt._reset(path, 'Вернуть расчёт', 'вручную · ↺') };
    const badge = `<span class="dl-badge kp" title="${esc(opts.autoTitle || '')}">${esc(opts.autoLabel || 'авто')}</span>`;
    return { value: DealFmt.inp(opts.auto), badge };
  }

  static _cur(curPath, deal) {
    if (!curPath) return '';
    const now = ObjPath.get(deal, curPath) || 'RUB';
    const options = Money.CURS.map(cur => `<option${now === cur ? ' selected' : ''}>${cur}</option>`).join('');
    return `<select data-dl="${curPath}" aria-label="Валюта">${options}</select>`;
  }

  static _select(label, path, raw, list) {
    const now = String(raw ?? list[0][0]);
    const options = list
      .map(
        ([value, text]) =>
          `<option value="${esc(value)}"${now === String(value) ? ' selected' : ''}>${esc(text)}</option>`,
      )
      .join('');
    return `<select data-dl="${path}" aria-label="${esc(label)}">${options}</select>`;
  }

  static _mode(opts) {
    if (opts.text) return 'text';
    return opts.int ? 'numeric' : 'decimal';
  }

  static _input(path, value, opts, err) {
    const list = opts.list ? ` list="${opts.list}"` : '';
    const tail = `${list}${err ? ' aria-invalid="true"' : ''}${opts.text ? ' class="tx"' : ''}`;
    return `<input type="text" inputmode="${DealFmt._mode(opts)}" data-dl="${path}" value="${esc(value)}" placeholder="${esc(opts.ph ?? '0')}" autocomplete="off"${tail}>`;
  }

  static _date(label, path, date, deal) {
    const kind = date.kind === false ? '' : ObjPath.get(deal, `${path}K`);
    return DealFmt.dateIn(path, { base: date.base, val: date.val, label, kind });
  }

  static _dateBox(path, input, date, picker) {
    const unit = date.kind === false ? '<i>дн.</i>' : DealFmt.dayKind(path);
    return `<span class="dl-ddr"><span class="dl-in">${input}${unit}</span>${picker}</span>`;
  }

  static _box(input, cur) {
    return `<span class="dl-in${cur ? ' cur' : ''}">${input}${cur}</span>`;
  }

  static _note(err, hint) {
    if (err) return `<small class="dl-err">${esc(err)}</small>`;
    return hint ? `<small class="muted">${hint}</small>` : '';
  }

  /**
   * Выбор даты вместо количества дней: хранится по-прежнему в днях от события base.
   * @param {string} path
   * @param {{base: number, val: number, label: string, kind: string}} spec
   * @returns {string}
   */
  static dateIn(path, spec) {
    const { base, val, label, kind } = spec;
    const iso =
      DealCal.contractDate() && Number.isFinite(+val)
        ? DealCal.dayIso(DealTerms.addDays(DealCal.fns(), +base || 0, +val || 0, kind))
        : '';
    return `<span class="dl-ddt"><em>или дата</em><input type="date" data-dldd="${esc(path)}" data-base="${+base || 0}" data-kind="${kind === 'work' ? 'work' : ''}" value="${iso}" aria-label="${esc(label)}: дата"></span>`;
  }

  /**
   * Меню «календарные / рабочие дни» у срока (путь вида — путь срока + «K»).
   * @param {string} path
   * @returns {string}
   */
  static dayKind(path) {
    const work = ObjPath.get(DealState.deal(), `${path}K`) === 'work';
    return `<select class="dl-dk" data-dl="${esc(path)}K" aria-label="Календарные или рабочие дни" title="Календарные или рабочие дни"><option value="">кал. дн.</option><option value="work"${work ? ' selected' : ''}>раб. дн.</option></select>`;
  }
}
