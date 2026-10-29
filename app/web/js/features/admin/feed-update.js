import { AdminApi } from './admin-core.js';
import { FeedFmt, FeedState } from './feed-state.js';
import { Catalog } from '../catalog/catalog-store.js';
import { Modal } from '../../core/modal.js';
import { Fmt } from '../../core/str.js';
import { Toast } from '../../core/toast.js';
import { esc } from '../../core/util.js';

/**
 * «Обновить цены…» / «Обновить остатки…» фида из файлов (сервер — feed_update.py): выбрать новые файлы → полный список
 * «было → стало» с галочками → «Применить отмеченное». До «Применить» каталог и файлы фида не меняются.
 */
export class FeedUpdateUi {
  static TEXT = {
    price: {
      title: 'Обновить цены',
      pick: 'Выбрать новые прайсы…',
      none: 'Цены не изменились — обновлять нечего.',
      done: 'Цены обновлены',
    },
    stock: {
      title: 'Обновить остатки',
      pick: 'Выбрать файл остатков…',
      none: 'Остатки не изменились — обновлять нечего.',
      done: 'Остатки обновлены',
    },
  };
  static FILTERS = {
    price: [
      ['', 'Все'],
      ['up', 'Выросли'],
      ['down', 'Снизились'],
      ['new', 'Новая цена'],
      ['sharp', 'Больше ±20 %'],
    ],
    stock: [
      ['', 'Все'],
      ['in', 'Появились'],
      ['out', 'Закончились'],
      ['qty', 'Изменилось количество'],
    ],
  };
  static CURS = ['EUR', 'USD', 'RUB', 'CNY'];

  /**
   * Открыть окно и сразу предложить выбрать файлы (нажатие кнопки — разрешение браузера открыть выбор файла).
   * @param {object} feed
   * @param {string} scope price | stock
   * @param {() => void} done после «Применить»
   */
  static open(feed, scope, done) {
    const state = { feed, scope, done, token: null, files: [], report: null, filter: '', query: '', off: new Set() };
    state.started = AdminApi.post(`feeds/${feed.id}/update/start`, { scope }).then(reply => {
      state.token = reply.token;
      return reply.token;
    });
    state.dialog = new Modal(this._frame(state), 'fu-dlg');
    state.dialog.d.addEventListener('click', event => this._click(state, event));
    state.dialog.d.addEventListener('change', event => this._change(state, event.target));
    state.dialog.d.addEventListener('input', event => this._input(state, event.target));
    state.dialog.d.addEventListener('close', () => this._cancel(state));
    this._draw(state);
    state.dialog.$('[data-fufile=""]')?.click();
  }

  static _frame(state) {
    return `<div class="dlg-h"><h3>${this.TEXT[state.scope].title} <small>${esc(state.feed.name)}</small></h3><button class="icon" type="button" data-fu="x" aria-label="Закрыть">✕</button></div>
      <div class="fu-b"><div class="fu-files"></div><div class="fu-list"></div></div>
      <div class="row fu-foot"><span class="muted fu-st"></span><span class="sp"></span><button class="btn ghost" type="button" data-fu="x">Отмена</button><button class="btn primary" type="button" data-fu="apply" disabled>Применить</button></div>`;
  }

  // ---------------------------------------------------------------- файлы
  static _current(state) {
    const files = state.feed.files || {};
    if (state.scope === 'stock') return files.stock ? [{ slot: '', name: files.stock.name, at: files.stock.at }] : [];
    return FeedFmt.prices(state.feed).map(price => ({ slot: price.slot, name: price.name, at: price.at }));
  }

  static _staged(state, slot) {
    return state.files.find(rec => rec.slot === slot || (state.scope === 'stock' && !slot));
  }

  static _fileRow(state, cur) {
    const staged = this._staged(state, cur.slot);
    const fresh = staged
      ? `<span class="ok-t">→ ${esc(staged.name)} · ${Fmt.num(staged.meta.rows || 0)} ${KPGen.plural(staged.meta.rows || 0, 'строка', 'строки', 'строк')}</span>${this._curPick(staged)}${this._movePick(state, staged)}`
      : '<span class="muted">остаётся прежним</span>';
    return `<div class="fu-file"><div><b>${esc(cur.name)}</b> <span class="muted">· ${esc(FeedFmt.date(cur.at))}</span><br>${fresh}</div>
      <label class="btn ghost sm fu-up"><input type="file" accept="${FeedState.XLSX}" data-fufile="${esc(cur.slot)}" hidden>${staged ? 'Другой файл' : 'Заменить…'}</label></div>`;
  }

  static _curPick(staged) {
    const missing = (staged.meta.sheetCurs || []).some(sheet => sheet.rows && !sheet.cur);
    if (!missing || staged.kind !== 'price') return '';
    const opts = this.CURS.map(
      code => `<option${staged.meta.curSet === code ? ' selected' : ''}>${code}</option>`,
    ).join('');
    return ` <label class="fu-cur"><span class="bad-t">валюта в файле не указана:</span> <select data-fucur="${esc(staged.slot)}" aria-label="Валюта прайса"><option value="">—</option>${opts}</select></label>`;
  }

  // файл принят не за тот прайс — переставить: вместо другого прайса или отдельным новым
  static _movePick(state, rec) {
    const current = this._current(state);
    if (state.scope !== 'price' || !current.length) return '';
    const opts = current
      .map(
        cur =>
          `<option value="${esc(cur.slot)}"${cur.slot === rec.slot ? ' selected' : ''}>вместо «${esc(cur.name)}»</option>`,
      )
      .join('');
    const isNew = !current.some(cur => cur.slot === rec.slot);
    return ` <label class="fu-mv"><span class="muted">это:</span> <select data-fumove="${esc(rec.slot)}" aria-label="Какой прайс заменяет файл">${opts}<option value="new"${isNew ? ' selected' : ''}>новый прайс (ещё один)</option></select></label>`;
  }

  static _files(state) {
    const current = this._current(state);
    const known = new Set(current.map(cur => cur.slot));
    const extra = state.files
      .filter(rec => state.scope === 'price' && !known.has(rec.slot))
      .map(
        rec =>
          `<div class="fu-file"><div><b>Новый прайс</b><br><span class="ok-t">${esc(rec.name)} · ${Fmt.num(rec.meta.rows || 0)} строк</span>${this._curPick(rec)}${this._movePick(state, rec)}</div></div>`,
      )
      .join('');
    const multiple = state.scope === 'price' ? ' multiple' : '';
    const hint =
      state.scope === 'price' && current.length > 1
        ? '<p class="muted">Можно выбрать сразу несколько файлов — программа сама узнает по имени, какой прайс заменить. Незаменённые прайсы остаются прежними.</p>'
        : '';
    return `${current.map(cur => this._fileRow(state, cur)).join('')}${extra}${hint}
      <div class="row"><label class="btn${state.files.length ? ' ghost' : ' primary'} fu-up"><input type="file" accept="${FeedState.XLSX}" data-fufile=""${multiple} hidden>${this.TEXT[state.scope].pick}</label></div>`;
  }

  static async _upload(state, input) {
    const files = [...(input.files || [])];
    const slot = input.dataset.fufile;
    input.value = '';
    if (!files.length) return;
    try {
      const token = await state.started;
      for (const file of files) {
        this._status(state, `Читаю «${file.name}»…`);
        const rec = await AdminApi.get(
          `feeds/${encodeURIComponent(state.feed.id)}/update/file?token=${token}&name=${encodeURIComponent(file.name)}${slot ? `&slot=${encodeURIComponent(slot)}` : ''}`,
          { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file },
        );
        state.files = [...state.files.filter(old => old.slot !== rec.slot), rec];
      }
      this._draw(state);
      await this._preview(state);
    } catch (error) {
      this._status(state, '');
      Toast.show(`Файл не принят: ${error.message || error}`);
    }
  }

  // ---------------------------------------------------------------- список изменений
  static async _preview(state) {
    if (state.files.some(rec => this._curPick(rec) && !rec.meta.curSet)) {
      this._status(state, 'Выберите валюту прайса — без неё цены не посчитать');
      return;
    }
    this._status(state, 'Считаю изменения…');
    state.report = await AdminApi.post(`feeds/${state.feed.id}/update/preview`, { token: state.token });
    state.off = new Set();
    this._status(state, '');
    this._draw(state);
  }

  static _shown(state) {
    const query = state.query.trim().toLowerCase();
    return state.report.rows.filter(row => {
      if (state.filter === 'sharp' ? !row.sharp : state.filter && row.dir !== state.filter) return false;
      return !query || `${row.name} ${row.model}`.toLowerCase().includes(query);
    });
  }

  static _money(kop, cur) {
    return kop ? FeedFmt.money(kop, cur) : '—';
  }

  static _pct(pct) {
    if (pct == null) return '';
    return ` <span class="fu-pct ${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '+' : ''}${FeedFmt.dec(pct)} %</span>`;
  }

  static _priceCell(change) {
    return `<div class="fu-ch"><span class="muted">${esc(change.label)}</span> ${this._money(change.old, change.oldCur)} → <b>${this._money(change.new, change.cur)}</b>${this._pct(change.pct)}</div>`;
  }

  static _wh(stock) {
    return (stock.wh || []).length
      ? `<span class="muted"> (${stock.wh.map(([name, qty]) => `${esc(name)}: ${Fmt.num(qty)}`).join(', ')})</span>`
      : '';
  }

  static _stockCell(change) {
    return `<div class="fu-ch">${esc(change.old.text)}${this._wh(change.old)} → <b>${esc(change.new.text)}</b>${this._wh(change.new)}</div>`;
  }

  static _row(state, row) {
    const cells = row.changes
      .map(change => (change.f === 'stock' ? this._stockCell(change) : this._priceCell(change)))
      .join('');
    const sub = [row.model, row.maker, row.src === 'card' ? 'заведена вручную' : '']
      .filter(Boolean)
      .map(esc)
      .join(' · ');
    return `<label class="fu-r${row.sharp ? ' sharp' : ''}"><input type="checkbox" data-furow="${esc(row.id)}"${state.off.has(row.id) ? '' : ' checked'}>
      <span class="fu-n"><b>${esc(row.name)}</b>${sub ? `<small class="muted">${sub}</small>` : ''}</span><span class="fu-cs">${cells}</span></label>`;
  }

  static _chips(state) {
    const counts = state.report.counts;
    return this.FILTERS[state.scope]
      .map(([key, label]) => {
        const count = key ? counts[key] || 0 : counts.changed;
        return `<button type="button" class="chip${state.filter === key ? ' on' : ''}" data-fuf="${key}"${count || !key ? '' : ' disabled'}>${label} · ${Fmt.num(count)}</button>`;
      })
      .join('');
  }

  static _missing(state) {
    const report = state.report;
    if (!report.missingTotal) return '';
    const items = report.missing
      .map(item => `<li>${esc(item.name)} <span class="muted">— ${esc(item.why)}</span></li>`)
      .join('');
    return `<details class="fu-miss"><summary>Позиции, цена которых не обновится — ${Fmt.num(report.missingTotal)}</summary><ul>${items}</ul>${report.missingTotal > report.missing.length ? '<p class="muted">Показаны первые 1 000.</p>' : ''}</details>`;
  }

  static _list(state) {
    const report = state.report;
    if (!report) return '';
    if (!report.rows.length)
      return `<p class="ok-t">${this.TEXT[state.scope].none}</p><p class="muted">Проверено позиций: ${Fmt.num(report.checked)}.</p>${this._missing(state)}`;
    const shown = this._shown(state);
    return `<p class="fu-sum">Изменится: <b>${Fmt.num(report.counts.changed)}</b> из ${Fmt.num(report.checked)} проверенных${report.counts.sharp ? ` · <span class="bad-t">резко (больше ±20 %): ${Fmt.num(report.counts.sharp)}</span>` : ''}. Снимите галочку — позиция останется как была.</p>
      <div class="row fu-tools"><div class="chips">${this._chips(state)}</div><input type="search" data-fuq placeholder="Найти позицию" value="${esc(state.query)}" aria-label="Найти позицию"></div>
      <div class="row fu-all"><label><input type="checkbox" data-fuall${shown.every(row => !state.off.has(row.id)) ? ' checked' : ''}> все показанные (${Fmt.num(shown.length)})</label></div>
      <div class="fu-rows">${shown.map(row => this._row(state, row)).join('') || '<p class="muted">Ничего не найдено.</p>'}</div>
      ${this._missing(state)}`;
  }

  static _draw(state) {
    state.dialog.$('.fu-files').innerHTML = this._files(state);
    state.dialog.$('.fu-list').innerHTML = this._list(state);
    this._count(state);
  }

  static _count(state) {
    const button = state.dialog.$('[data-fu=apply]');
    const total = state.report ? state.report.rows.length : 0;
    const picked = total - state.off.size;
    button.disabled = !picked;
    button.textContent = total ? `Применить (${Fmt.num(picked)} из ${Fmt.num(total)})` : 'Применить';
  }

  static _status(state, text) {
    const box = state.dialog.$('.fu-st');
    if (box) box.textContent = text;
  }

  // ---------------------------------------------------------------- действия
  static _click(state, event) {
    const filter = event.target.closest('[data-fuf]');
    if (filter) {
      state.filter = filter.dataset.fuf;
      state.dialog.$('.fu-list').innerHTML = this._list(state);
      return;
    }
    const action = event.target.closest('[data-fu]')?.dataset.fu;
    if (action === 'x') state.dialog.close();
    else if (action === 'apply') this._apply(state, event.target.closest('button'));
  }

  static _change(state, target) {
    if (target.dataset.fufile != null) this._upload(state, target);
    else if (target.dataset.fucur != null) this._cur(state, target);
    else if (target.dataset.fumove != null) this._move(state, target);
    else if (target.dataset.furow != null) {
      if (target.checked) state.off.delete(target.dataset.furow);
      else state.off.add(target.dataset.furow);
      this._count(state);
    } else if (target.dataset.fuall != null) {
      this._shown(state).forEach(row => (target.checked ? state.off.delete(row.id) : state.off.add(row.id)));
      state.dialog.$('.fu-rows').innerHTML = this._shown(state)
        .map(row => this._row(state, row))
        .join('');
      this._count(state);
    }
  }

  static _input(state, target) {
    if (target.dataset.fuq == null) return;
    state.query = target.value;
    const shown = this._shown(state);
    state.dialog.$('.fu-rows').innerHTML =
      shown.map(row => this._row(state, row)).join('') || '<p class="muted">Ничего не найдено.</p>';
  }

  static async _cur(state, select) {
    const slot = select.dataset.fucur;
    await AdminApi.post(`feeds/${state.feed.id}/update/cur`, { token: state.token, slot, cur: select.value });
    state.files.forEach(rec => {
      if (rec.slot === slot) rec.meta.curSet = select.value;
    });
    await this._preview(state);
  }

  static async _move(state, select) {
    try {
      const rec = await AdminApi.post(`feeds/${state.feed.id}/update/move`, {
        token: state.token,
        slot: select.dataset.fumove,
        into: select.value,
      });
      state.files = [...state.files.filter(old => old.slot !== select.dataset.fumove && old.slot !== rec.slot), rec];
      this._draw(state);
      await this._preview(state);
    } catch (error) {
      Toast.show(error.message || String(error));
    }
  }

  static async _apply(state, button) {
    button.disabled = true;
    this._status(state, 'Применяю…');
    try {
      const res = await AdminApi.post(`feeds/${state.feed.id}/update/apply`, {
        token: state.token,
        skip: [...state.off],
      });
      state.token = null; // черновик применён — отменять нечего
      state.dialog.close();
      Toast.show(
        `${this.TEXT[state.scope].done}: ${Fmt.num(res.rows.length)}${res.skipped ? `, не применено ${Fmt.num(res.skipped)}` : ''}`,
      );
      Catalog.refresh();
      state.done();
    } catch (error) {
      button.disabled = false;
      this._status(state, '');
      Toast.show(error.message || String(error));
    }
  }

  static _cancel(state) {
    const token = state.token;
    state.token = null;
    if (token) AdminApi.post(`feeds/${state.feed.id}/update/cancel`, { token }).catch(() => {});
  }
}
