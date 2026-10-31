import { Modal } from '../../core/modal.js';
import { Fmt } from '../../core/str.js';
import { Toast } from '../../core/toast.js';
import { $, esc } from '../../core/util.js';
import { Api } from '../../core/net.js';
import { KpState, LocalDraft, S } from '../../core/state.js';
import { FEAT } from '../../core/features.js';
import { DefRegistry } from '../../core/defaults.js';
import { KpTabs } from './kp-tabs.js';
import { KpGuard } from './kp-guard.js';
import { KpForm } from '../../core/kp-form.js';
import { Currency } from '../../core/currency.js';

/**
 * Черновики КП на сервере (DraftsController, таблица drafts): незаконченное КП или несохранённые правки сохранённого,
 * у каждого менеджера свои. Автосохранение раз в N минут и при уходе со страницы; «Новое КП» и открытие другого КП
 * откладывают текущее в черновики; после сохранения КП в журнал черновик удаляется.
 */
export class Drafts {
  static MINUTE = 60000;
  static FNV_OFFSET = 0x811c9dc5;
  static FNV_PRIME = 16777619;
  static SAVED_NOTE_MS = 500;
  /** КП, для которого запомнено состояние base (номер или '' — новое КП) */
  static kpId = null;
  /** отпечаток состояния КП на момент последнего сохранения (в журнал или в черновик) */
  static base = null;
  static busy = false;
  /** идущее сохранение (Promise) — stash ждёт его */
  static running = null;
  /** идёт сохранение КП в журнал */
  static paused = false;

  /**
   * Интервал автосохранения, мс — из «Значений программы» (читается при каждом запуске таймера).
   * @returns {number}
   */
  static autoMs() {
    return Math.round(DefRegistry.num('kp.autosaveMin', 1) * this.MINUTE);
  }

  /**
   * «раз в минуту» / «раз в 5 мин» — для пояснений.
   * @returns {string}
   */
  static autoText() {
    const minutes = DefRegistry.num('kp.autosaveMin', 1);
    return minutes === 1 ? 'раз в минуту' : `раз в ${String(minutes).replace('.', ',')} мин`;
  }

  /**
   * Черновики включены в «Функциях».
   * @returns {boolean}
   */
  static enabled() {
    return FEAT.on('drafts');
  }

  /**
   * Новый номер черновика или заготовки.
   * @param {string} [prefix]
   * @returns {string}
   */
  static newId(prefix = 'd') {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /**
   * Состояние КП без служебных полей (как в журнал); у позиций — опции и характеристики, как после перезагрузки
   * страницы (KpState.revive): отпечаток прежних КП не меняется от перезагрузки.
   * @returns {object}
   */
  static clean() {
    const state = JSON.parse(JSON.stringify(S, (key, value) => (key.startsWith('_') ? undefined : value)));
    (state.items || []).forEach(item => {
      item.options = item.options || [];
      item.attrs = item.attrs || {};
    });
    return state;
  }

  /**
   * Отпечаток состояния КП.
   * @param {object} state
   * @returns {string}
   */
  static sig(state) {
    const text = JSON.stringify(state);
    let hash = this.FNV_OFFSET;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, this.FNV_PRIME);
    }
    return `${text.length}:${hash >>> 0}`;
  }

  /**
   * Есть что сохранять: позиции или клиент.
   * @param {object} state
   * @returns {boolean}
   */
  static meaningful(state) {
    return (state.items || []).length > 0 || String(state.client || '').trim() !== '';
  }

  /**
   * Заголовок черновика.
   * @param {object} row
   * @returns {string}
   */
  static title(row) {
    return row.kp ? `Правки КП № ${row.kp}` : 'Новое КП';
  }

  /**
   * Изменения с последнего сохранения.
   * @returns {{state: object, sig: string}|null}
   */
  static pending() {
    if (KpState.paused() || KpGuard.locked()) return null;
    const state = this.clean();
    const sig = this.sig(state);
    const kpId = S.kpId || '';
    if (this.kpId !== kpId) {
      // открыли другое КП — отсчёт с него
      this.kpId = kpId;
      this.base = kpId && !S._draft ? sig : null;
      if (this.base) return null;
    }
    if (sig === this.base || !this.meaningful(state)) return null;
    return { state, sig };
  }

  /**
   * Записать изменения в черновик.
   * @param {Function} [onFail] (error) — не записалось; без него — молча
   * @returns {Promise<boolean>}
   */
  static async _save(onFail = () => {}) {
    if (!this.enabled() || this.busy) return false;
    const change = this.pending();
    if (!change) return false;
    this.busy = true;
    let done;
    this.running = new Promise(resolve => {
      done = resolve;
    });
    try {
      return await this._write(change);
    } catch (error) {
      onFail(error);
      return false;
    } finally {
      this.busy = false;
      done();
    }
  }

  static async _write(change) {
    const totals = KpState.totals();
    const mine = S; // КП, которое сохраняем
    const body = JSON.stringify({
      state: change.state,
      rev: S._rev,
      sum: totals.sum,
      cur: (S.pricing && S.pricing.cur) || 'RUB',
    });
    const put = id =>
      Api.request(`/api/drafts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body,
      });
    let id = S._draft || this.newId();
    try {
      await put(id);
    } catch (error) {
      // черновик записан под другим менеджером (сменили «кто работает» на устройстве) — дальше новый черновик под текущим
      if (error.status !== 403 || !S._draft) throw error;
      id = this.newId();
      await put(id);
    }
    mine._draft = id;
    if (S !== mine) return true; // пока шёл ответ, открыли другое КП — его черновиком этот id не становится
    this.base = change.sig;
    KpState.persist();
    this._savedNote();
    return true;
  }

  static _savedNote() {
    const box = $('#saved');
    if (!box) return;
    setTimeout(() => {
      box.textContent = `✓ Сохранено ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
      box.title = 'Черновик КП сохранён на сервере';
    }, this.SAVED_NOTE_MS);
  }

  /**
   * Отложить изменения открытого КП в черновик без сообщений (переключение и закрытие вкладок КП).
   * @returns {Promise<boolean>} true — записано
   */
  static async quiet() {
    if (this.busy) await this.running;
    return this._save();
  }

  /**
   * Перед заменой КП (новое, другое из журнала, черновик, заготовка): текущие изменения — в черновики.
   * @returns {Promise<boolean>} true — можно заменять; false — не отложилось и менеджер выбрал «Отмена»
   */
  static async stash() {
    if (this.busy) await this.running; // идёт автосохранение — дождаться, иначе изменения не отложатся
    if (!this.pending()) return true;
    if (!this.enabled()) return confirm('Несохранённые изменения текущего КП пропадут. Продолжить?');
    if (await this._save(error => Toast.show(`Черновик не сохранён: ${error.message || error}`))) {
      Toast.show('Прежнее КП отложено в черновики (журнал → «Черновики»)');
      return true;
    }
    return confirm(
      'Текущее КП не удалось отложить в черновики (нет связи с сервером?). Заменить его — несохранённые изменения пропадут?',
    );
  }

  /**
   * КП сохранено в журнал: его черновик больше не нужен. Правки, сделанные во время сохранения, остаются
   * «несохранёнными»; идущее автосохранение дожидается — иначе оно воскресило бы черновик.
   * @param {string} [sig] отпечаток сохранённого состояния
   */
  static async saved(sig) {
    if (this.busy) await this.running;
    const id = S._draft;
    delete S._draft;
    this.loaded();
    if (sig) this.base = sig;
    if (id) Api.request(`/api/drafts/${id}/delete`, { method: 'POST' }).catch(() => {});
  }

  /** КП заменено копией или заготовкой: пока его не правили, откладывать нечего. */
  static loaded() {
    this.kpId = S.kpId || '';
    this.base = this.sig(this.clean());
  }

  /** Автосохранение по таймеру. */
  static tick() {
    if (FEAT.on('autosave') && !this.paused) this._save();
  }

  /** Запуск автосохранения (отсчёт — с КП, открытого при запуске; после перезагрузки страницы — прежний). */
  static start() {
    this._resume();
    LocalDraft.edits = () => this._edits();
    if (this.pending() && S.kpId)
      Toast.show(
        `Несохранённые правки КП${S.number ? ` № ${S.number}` : ''} на месте — сохраните КП, чтобы они попали в журнал`,
      );
    const next = () =>
      setTimeout(() => {
        this.tick();
        next();
      }, this.autoMs());
    next();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.tick();
    });
  }

  // перезагрузка страницы: отсчёт правок — записанный в браузере вместе с КП, иначе правки до перезагрузки, ещё не
  // попавшие в черновик, считались бы сохранёнными (переход на другое КП терял их молча)
  static _resume() {
    const edits = LocalDraft.loadEdits();
    if (!edits || edits.kpId !== (S.kpId || '') || edits.draft !== (S._draft || '')) return;
    this.kpId = edits.kpId;
    this.base = edits.base;
  }

  // отсчёт правок открытого КП — в браузер вместе с ним (LocalDraft.edits); отсчёт ещё от прежнего КП (открыли другое,
  // а pending его не сверял) — не записывается
  static _edits() {
    const kpId = S.kpId || '';
    return this.kpId === kpId ? { kpId, draft: S._draft || '', base: this.base } : null;
  }

  /**
   * Мои черновики.
   * @returns {Promise<object[]>}
   */
  static async list() {
    try {
      return (await Api.request('/api/drafts')).items || [];
    } catch {
      return [];
    }
  }

  /**
   * Продолжить черновик.
   * @param {string} id
   */
  static async open(id) {
    let answer;
    try {
      answer = await Api.request(`/api/drafts/${encodeURIComponent(id)}`);
    } catch (error) {
      Toast.show(`Черновик не открылся: ${error.message || error}`);
      return;
    }
    if (!(await KpTabs.prepare({ draft: id, kpId: (answer.data.state && answer.data.state.kpId) || '' }))) return;
    KpState.replace(Object.assign(KpState.fresh(), answer.data.state || {}));
    if (answer.data.rev != null) S._rev = answer.data.rev;
    S._draft = id;
    KpTabs.show();
    KpForm.render();
    KpState.persist();
    window.scrollTo({ top: 0 });
    this.loaded();
    Toast.show(
      answer.row.kp
        ? `Открыты несохранённые правки КП № ${answer.row.kp} — сохраните КП, чтобы они попали в журнал`
        : 'Черновик открыт',
    );
  }

  /**
   * Удалить черновик.
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  static async remove(id) {
    try {
      await Api.request(`/api/drafts/${encodeURIComponent(id)}/delete`, { method: 'POST' });
      if (S._draft === id) delete S._draft;
      return true;
    } catch (error) {
      Toast.show(`Не удалено: ${error.message || error}`);
      return false;
    }
  }

  /**
   * Строка черновика в окнах.
   * @param {object} row
   * @returns {string}
   */
  static rowHtml(row) {
    const sum = row.sum ? ` · ${KPGen.money(row.sum)} ${esc(Currency.short(row.cur || 'RUB'))}` : '';
    return `<div class="st-row"><div><b>${esc(row.client || 'Клиент не указан')}</b><span class="muted">${esc(this.title(row))} · ${row.positions || 0} поз.${sum} · ${esc(Fmt.dateTime(row.updated))}${S._draft === row.id ? ' · <b>открыт сейчас</b>' : ''}</span></div>
      <div class="acts"><button class="btn" type="button" data-dro="${esc(row.id)}">Продолжить</button><button class="btn ghost" type="button" data-drd="${esc(row.id)}" title="Удалить черновик">Удалить</button></div></div>`;
  }

  /** Окно «Черновики». */
  static async dialog() {
    const modal = new Modal(
      `<div class="dlg-h"><h3>Черновики</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted" style="margin:0 0 10px">Незаконченные КП и несохранённые правки — ваши, доступны с любого компьютера.${FEAT.on('autosave') ? ` Изменения записываются сюда автоматически ${this.autoText()}.` : ''} После сохранения КП в журнал черновик удаляется.</p>
      <div class="dr-l"><p class="empty">Загружаю…</p></div>`,
      'drafts-dlg',
    );
    const draw = async () => {
      const list = await this.list();
      modal.$('.dr-l').innerHTML = list.length
        ? list.map(row => this.rowHtml(row)).join('')
        : '<p class="empty">Черновиков нет.</p>';
    };
    modal.d.onclick = async event => {
      if (event.target.closest('[data-x]')) {
        modal.close();
        return;
      }
      const open = event.target.closest('[data-dro]');
      if (open) {
        modal.close();
        this.open(open.dataset.dro);
        return;
      }
      const drop = event.target.closest('[data-drd]');
      if (drop && (await this.remove(drop.dataset.drd))) draw();
    };
    await draw();
  }
}
