import { DealState } from './deal-state.js';
import { DealUi } from './deal-ui.js';
import { DealWin } from './deal-win.js';
import { InputNum } from './input-num.js';
import { TnVed } from './tn-ved.js';
import { AdminDialog } from '../admin/admin-core.js';
import { Toast } from '../../core/toast.js';
import { KitDoc } from '../kit/kit-doc.js';
import { Api } from '../../core/net.js';
import { EquipTypes } from '../../core/equip-types.js';
import { $, Uid, esc } from '../../core/util.js';
import { Attrs } from '../../core/item-attrs.js';
import { S } from '../../core/state.js';

/**
 * Коды ТН ВЭД и пошлины: позиция сделки (вручную в этом КП → по модели → по категории → справочно по виду и
 * характеристикам) и справочник категорий отдела (/api/customs).
 */
export class DealHs {
  static REF = 'справочно';
  static JSON_HEAD = { 'Content-Type': 'application/json; charset=utf-8' };
  static REF_TEXT = { 1: 'справочно', 2: 'справочно · проверьте' };
  static OK_TEXT = { 1: '', 2: ' · проверьте у брокера' };

  /**
   * Код и ставка позиции и откуда они (источник — по ставке: она влияет на расчёт); ref — справочное значение.
   * @param {object} item позиция или элемент станции
   * @param {object} [deal]
   * @returns {{code: string, duty: string, src: string, ref: object|null}}
   */
  static of(item, deal = S.deal) {
    const attrs = Attrs.of(item);
    const cus = DealUi.cus || {};
    const cat = item.role === 'container' ? 'container' : attrs.cat;
    const ref = TnVed.pick(item, attrs, cat);
    const chain = [
      [deal && deal.hs && deal.hs[item.id], 'вручную'],
      [item.catId && cus[`item:${item.catId}`], 'по модели'],
      [cus[`cat:${cat}`], 'по категории'],
      [ref, DealHs.REF],
    ];
    const [code, codeSrc] = DealHs._first(chain, 'code');
    const [duty, dutySrc] = DealHs._first(chain, 'duty');
    return { code, duty, src: dutySrc || codeSrc, ref };
  }

  // код из справочника, а ставка другая — отметка (ставку выбирает менеджер)
  static _codeDuty(hsCode) {
    const known = TnVed.known(hsCode.code);
    if (!known || hsCode.duty === '' || InputNum.parse(hsCode.duty) === known.duty) return '';
    return ` <span class="dl-badge warn" title="${esc(`По справочнику ЕТТ ЕАЭС у кода ${known.code} пошлина ${known.duty} %`)}">код и ставка не совпадают со справочником</span>`;
  }

  static _first(chain, field) {
    for (const [row, src] of chain) {
      if (row && row[field] != null && String(row[field]).trim() !== '') return [String(row[field]).trim(), src];
    }
    return ['', ''];
  }

  /**
   * Отметка источника: справочное — с надёжностью кода; своё, расходящееся со справочным по ставке, — с кнопкой.
   * @param {object} item
   * @param {object} hs результат of()
   * @returns {string}
   */
  static badge(item, hsCode) {
    const ref = hsCode.ref;
    const tip = TnVed.title(ref);
    if (!hsCode.src) {
      return `<span class="dl-badge warn" title="${esc(tip || 'Код и ставка для этого вида оборудования не определены — укажите вручную или возьмите из справочника')}">укажите</span>`;
    }
    if (hsCode.src === DealHs.REF) {
      const ok = ref && ref.ok;
      return `<span class="dl-badge ${ok === 1 ? 'kp' : 'warn'}" title="${esc(tip)}">${DealHs.REF_TEXT[ok] || 'справочно · уточните'}</span>`;
    }
    const differs = ref && ref.duty !== '' && InputNum.parse(ref.duty) !== InputNum.parse(hsCode.duty);
    const own = `<span class="dl-badge kp" title="${esc(tip ? `Справочно: ${tip}` : '')}">${esc(hsCode.src)}</span>${DealHs._codeDuty(hsCode)}`;
    if (!differs) return own;
    return `${own}<button type="button" class="lnk dl-hsref" data-dlx="hsref" data-id="${esc(item.id)}" title="${esc(`Взять справочный код и ставку:\n${tip}`)}">справочно ${esc(ref.code)} · ${esc(ref.duty)} %</button>`;
  }

  /**
   * Категории справочника: встроенные виды оборудования (значение из базы или справочное) и свои (cat:x_…).
   * @returns {object[]}
   */
  static cats() {
    const cus = DealUi.cus || {};
    const out = [...EquipTypes.list, { id: 'container', name: 'Блок-контейнер (станции)' }].map(type =>
      DealHs._cat(type, cus),
    );
    for (const [key, row] of Object.entries(cus)) {
      if (!key.startsWith('cat:x_')) continue;
      out.push({
        key,
        id: key.slice(4),
        name: row.name || 'Своя категория',
        code: row.code || '',
        duty: row.duty || '',
        note: row.note || '',
        own: true,
      });
    }
    return out;
  }

  static _cat(type, cus) {
    const own = cus[`cat:${type.id}`] || {};
    const def = TnVed.catDefault(type.id) || {};
    const value = field => (own[field] != null && String(own[field]) !== '' ? String(own[field]) : def[field] || '');
    return {
      key: `cat:${type.id}`,
      id: type.id,
      name: type.name,
      code: value('code'),
      duty: value('duty'),
      note: own.note || def.note || '',
      ok: def.ok,
      own: false,
      edited: !!(own.code || own.duty),
    };
  }

  /**
   * Сохранить запись справочника.
   * @param {string} key
   * @param {object} row
   */
  static async put(key, row) {
    const body = JSON.stringify({
      key,
      code: row.code || '',
      duty: row.duty ?? '',
      note: row.note || '',
      name: row.name || '',
    });
    await Api.request('/api/customs', { method: 'PUT', headers: DealHs.JSON_HEAD, body });
    DealUi.cus = DealUi.cus || {};
    if (key.startsWith('cat:x_') && !row.name) delete DealUi.cus[key];
    else DealUi.cus[key] = { ...(DealUi.cus[key] || {}), ...row };
  }

  /**
   * Код и ставка строки закупки: у модели каталога — в базу (для всех следующих сделок), иначе — в этом КП.
   * @param {string} lineId
   * @param {{code?: string, duty?: string}} patch
   */
  static set(lineId, patch) {
    const line = KitDoc.lines(S).find(row => row.id === lineId);
    if (!line) return;
    const item = line.item;
    const deal = DealState.ensure();
    const hsCode = DealHs.of(item);
    const value = { code: hsCode.code, duty: hsCode.duty };
    for (const field of ['code', 'duty']) if (patch[field] != null) value[field] = String(patch[field]).trim();
    if (patch.duty == null && value.code !== hsCode.code) value.duty = DealHs.dutyOf(value.code);
    if (!item.catId) {
      deal.hs = deal.hs || {};
      deal.hs[lineId] = value;
      return;
    }
    const key = `item:${item.catId}`;
    DealUi.cus = DealUi.cus || {};
    DealUi.cus[key] = { ...value };
    const body = JSON.stringify({ key, code: value.code, duty: value.duty, note: '' });
    Api.request('/api/customs', { method: 'PUT', headers: DealHs.JSON_HEAD, body }).catch(() =>
      Toast.show('Код не сохранён в справочнике — проверьте связь с сервером'),
    );
  }

  /**
   * Ставка пошлины по коду из справочника ТН ВЭД; нет кода в справочнике — пусто («укажите»).
   * @param {string} code
   * @returns {string}
   */
  static dutyOf(code) {
    const known = TnVed.known(code);
    return known ? String(known.duty) : '';
  }

  /**
   * Взять справочный код и ставку для строки.
   * @param {string} lineId
   * @returns {string} сообщение
   */
  static useRef(lineId) {
    const line = KitDoc.lines(S).find(row => row.id === lineId);
    const ref = line && DealHs.of(line.item).ref;
    if (!ref) return '';
    DealHs.set(lineId, { code: ref.code, duty: ref.duty });
    return `Код ${ref.code || '—'}, пошлина ${ref.duty === '' ? '— уточните' : `${ref.duty} %`} — по справочнику`;
  }

  /** Справочник кодов по категориям (окно). */
  static dir() {
    new DealHsDir($('#dlg')).open();
  }
}

/** Окно «Коды ТН ВЭД и пошлины по категориям»: правка сразу сохраняется в базе, для всего отдела. */
export class DealHsDir {
  /**
   * @param {HTMLDialogElement} dlg
   */
  constructor(dlg) {
    this.dlg = dlg;
  }

  /** Открыть окно. */
  open() {
    const dlg = this.dlg;
    dlg.classList.add('wide');
    this.draw();
    dlg.showModal();
    dlg.onclick = event => this._click(event.target);
    dlg.onchange = event => this._change(event.target);
  }

  static _okText(cat) {
    if (cat.own || cat.edited || cat.ok == null || /брокер/.test(cat.note)) return '';
    return DealHs.OK_TEXT[cat.ok] ?? ' · ставку уточните у брокера';
  }

  /** Нарисовать таблицу категорий. */
  draw() {
    const rows = DealHs.cats()
      .map(cat => DealHsDir._row(cat))
      .join('');
    this.dlg.innerHTML = `<div class="dlg-h"><h3>Коды ТН ВЭД и пошлины по категориям</h3><button class="icon" type="button" data-close aria-label="Закрыть">✕</button></div>
      <div class="dlg-b"><p class="muted">Код позиции подбирается по виду оборудования и характеристикам (давление, производительность, мощность, объём, исполнение) — коды из 10 знаков и ставки ЕТТ ЕАЭС (${esc(TnVed.RATES_AT)}). Значение категории ниже — код по умолчанию; если его изменить, он заменит подбор для всех моделей категории. У конкретной модели код и ставку можно изменить в «Экономике сделки». Окончательно код подтверждает таможенный брокер.</p>
      <table class="dl-it dl-hsdir"><thead><tr><th>Категория</th><th>Код ТН ВЭД</th><th>Пошлина, %</th><th>Пояснение</th><th></th></tr></thead><tbody>
      ${rows}
      </tbody></table>
      <div class="row" style="gap:10px;margin-top:12px;align-items:center"><button type="button" class="btn" data-hadd>+ Добавить категорию</button><span class="muted">Изменения сохраняются сразу — в базе, для всего отдела.</span></div></div>`;
  }

  static _row(cat) {
    const name = cat.own
      ? `<input type="text" data-hf="name" value="${esc(cat.name)}" placeholder="Название категории">`
      : `<b>${esc(cat.name)}</b>${cat.edited ? '<small class="ok-t">изменено</small>' : ''}`;
    const note = cat.own
      ? `<input type="text" data-hf="note" value="${esc(cat.note)}" placeholder="Что входит">`
      : `<span class="muted">${esc(cat.note + DealHsDir._okText(cat))}</span>`;
    return `<tr data-key="${esc(cat.key)}">
        <td>${name}</td>
        <td><input type="text" data-hf="code" value="${esc(cat.code)}" placeholder="0000 00 000 0"></td>
        <td><input type="text" inputmode="decimal" data-hf="duty" value="${esc(cat.duty)}" placeholder="?"></td>
        <td>${note}</td>
        <td>${DealHsDir._action(cat)}</td></tr>`;
  }

  static _action(cat) {
    if (cat.own) return '<button type="button" class="icon" data-hdel aria-label="Удалить категорию">✕</button>';
    return cat.edited
      ? '<button type="button" class="lnk" data-hreset title="Вернуть справочное значение">↺</button>'
      : '';
  }

  async _click(target) {
    if (target.closest('[data-close]')) {
      this._close();
      return;
    }
    if (target.closest('[data-hadd]')) {
      await this._add();
      return;
    }
    const row = target.closest('tr[data-key]');
    if (!row) return;
    if (target.closest('[data-hdel]')) await this._delete(row.dataset.key);
    else if (target.closest('[data-hreset]')) await this._save(row.dataset.key, { code: '', duty: '' }, 'Не удалось');
  }

  _close() {
    const dlg = this.dlg;
    dlg.close();
    dlg.classList.remove('wide');
    dlg.onclick = null;
    dlg.onchange = null;
    DealWin.render();
  }

  async _add() {
    const key = `cat:x_${Uid.next()}`;
    try {
      await DealHs.put(key, { name: 'Новая категория', code: '', duty: '0' });
      this.draw();
      this.dlg.querySelector(`[data-key="${key}"] [data-hf="name"]`)?.select();
    } catch (err) {
      Toast.show(`Не удалось добавить: ${err.message || err}`);
    }
  }

  async _delete(key) {
    const ok = await AdminDialog.confirm(
      'Удалить категорию?',
      'Категория пропадёт из справочника; у моделей, где её выбрали, код и ставка останутся.',
      'Удалить',
    );
    if (ok) await this._save(key, { name: '', code: '', duty: '' }, 'Не удалось удалить');
  }

  async _save(key, row, fail) {
    try {
      await DealHs.put(key, row);
      this.draw();
    } catch (err) {
      Toast.show(`${fail}: ${err.message || err}`);
    }
  }

  async _change(target) {
    const row = target.closest('tr[data-key]');
    if (!target.dataset.hf || !row) return;
    const key = row.dataset.key;
    const value = { ...(DealUi.cus[key] || {}) };
    row.querySelectorAll('[data-hf]').forEach(input => {
      value[input.dataset.hf] = input.value.trim();
    });
    if (key.startsWith('cat:x_') && !value.name) {
      Toast.show('Укажите название категории');
      return;
    }
    try {
      await DealHs.put(key, value);
      Toast.show('Сохранено в справочнике');
    } catch (err) {
      Toast.show(`Не удалось сохранить: ${err.message || err}`);
    }
  }
}
