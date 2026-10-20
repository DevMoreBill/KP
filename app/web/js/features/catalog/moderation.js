import { Catalog } from './catalog-store.js';
import { CatalogWindow } from './catalog-window.js';
import { ModerationDiff } from './moderation-diff.js';

/**
 * Правка на модерации «было → стало» с выделением изменённого, приём целиком или по отмеченным полям, код правки — под
 * «Расширенное». Решает администратор («Настройки») или менеджер с правом «Правки без модерации».
 */
export class ModerationView {
  static JSON_TYPE = 'application/json; charset=utf-8';
  static DONE = {
    reject: 'Правка отклонена',
    part: 'Приняты отмеченные поля',
    approve: 'Принято — изменения в каталоге',
  };

  /**
   * Адрес правки.
   * @param {number} id
   * @param {string} [act] approve | reject
   * @returns {string}
   */
  static url(id, act) {
    const tail = act ? `/${act}` : '';
    return ADMIN.on ? `pending/${id}${tail}` : `/api/catalog/moderation/${id}${tail}`;
  }

  /**
   * Правка с сервера.
   * @param {number} id
   * @returns {Promise<object>}
   */
  static get(id) {
    return ADMIN.on ? aapi(this.url(id)) : api(this.url(id));
  }

  /**
   * Решение по правке.
   * @param {number} id
   * @param {string} act
   * @param {object} body
   * @returns {Promise<object>}
   */
  static post(id, act, body) {
    if (ADMIN.on) return ajson(this.url(id, act), body);
    return api(this.url(id, act), {
      method: 'POST',
      headers: { 'Content-Type': this.JSON_TYPE },
      body: JSON.stringify(body),
    });
  }

  static _rows(changes, { pend, isNew, cat }) {
    return changes
      .map(change => {
        const label = esc(ModerationDiff.label(change, cat));
        const box =
          pend && !isNew
            ? `<input type="checkbox" data-mf="${esc(change.key)}" checked aria-label="Принять: ${label}">`
            : '';
        return `<label class="mv-r"><span class="mv-c">${box}<b>${label}</b></span>
        <div class="mv-b" data-l="Было">${ModerationDiff.val(change, { value: change.before, other: change.after, side: 'b', cat })}</div><div class="mv-a" data-l="Стало">${ModerationDiff.val(change, { value: change.after, other: change.before, side: 'a', cat })}</div></label>`;
      })
      .join('');
  }

  static _code(changes) {
    const rows =
      changes
        .map(
          change =>
            `<tr><td>${esc(change.key)}</td><td>${stVal(change.before)}</td><td>${stVal(change.after)}</td></tr>`,
        )
        .join('') || '<tr><td colspan="3">Отличий нет</td></tr>';
    return `<table class="st-diff"><tr><th>Поле</th><th>Было</th><th>Стало</th></tr>${rows}</table>`;
  }

  static _foot(edit, { pend, isNew }) {
    if (!pend) {
      const state =
        edit.status === 'approved' ? '<span class="ok-t">Принято</span>' : '<span class="bad-t">Отклонено</span>';
      return `<p class="muted">${state} ${esc(edit.reviewedBy || '')} ${esc(Fmt.dateTime(edit.reviewedAt))}${edit.reason ? ` — ${esc(edit.reason)}` : ''}</p>`;
    }
    return `<div class="mv-f"><input type="text" id="mvReason" maxlength="500" placeholder="Причина отклонения (видна сотруднику в журнале)" aria-label="Причина отклонения">
        <div class="row"><button class="btn danger" type="button" data-mv="reject">Отклонить</button>${isNew ? '' : `<button class="btn" type="button" data-mv="part" hidden>Принять отмеченное</button>`}<button class="btn primary" type="button" data-mv="approve">${isNew ? 'Принять товар' : 'Принять всё'}</button></div></div>`;
  }

  static _body(edit, ctx) {
    const { pend, isNew } = ctx;
    const rows = this._rows(edit.diff || [], ctx);
    if (isNew) return ModerationDiff.card(edit.afterDoc || {});
    return `<div class="mv-t"><div class="mv-hd"><span class="mv-c">${pend ? `<label class="mv-all"><input type="checkbox" data-mall checked aria-label="Отметить все поля"></label>` : ''}Поле</span><span>Было</span><span>Стало</span></div>${rows || '<p class="muted">Отличий нет.</p>'}</div>`;
  }

  static _html(edit, ctx) {
    const { isNew, cat } = ctx;
    const gone = edit.current || isNew ? '' : ' · <span class="bad-t">товара сейчас нет в каталоге</span>';
    return `<div class="mv-h"><h3>${isNew ? 'Новый товар на модерации' : 'Правка товара'}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <p class="muted mv-who"><b>${esc((edit.afterDoc || {}).name || edit.productId)}</b> · ${esc(typeById(cat).name)} · ${esc(edit.userName || '—')} · ${esc(Fmt.dateTime(edit.created))}${gone}</p>
      ${edit.stale ? '<p class="msg warn mv-stale">Товар изменили после отправки правки. Принятые поля лягут на текущую карточку, остальные её поля не изменятся.</p>' : ''}
      ${this._body(edit, ctx)}
      <details class="mv-adv"><summary>Расширенное: код правки (JSON)</summary>${this._code(edit.diff || [])}</details>
      ${this._foot(edit, ctx)}`;
  }

  static _sync(modal, isNew) {
    const boxes = [...modal.d.querySelectorAll('[data-mf]')];
    const picked = boxes.filter(box => box.checked).length;
    const part = modal.$('[data-mv="part"]');
    const full = modal.$('[data-mv="approve"]');
    const all = modal.$('[data-mall]');
    if (all) {
      all.checked = picked === boxes.length;
      all.indeterminate = picked > 0 && picked < boxes.length;
    }
    modal.d.querySelectorAll('.mv-r').forEach(row => {
      const box = row.querySelector('[data-mf]');
      row.classList.toggle('off', !!box && !box.checked);
    });
    if (part) {
      part.hidden = picked === boxes.length;
      part.textContent = `Принять отмеченное (${picked} из ${boxes.length})`;
      part.disabled = !picked;
    }
    if (full) full.hidden = !isNew && picked < boxes.length;
  }

  static async _decide(modal, button, { id, done }) {
    const reason = (modal.$('#mvReason')?.value || '').trim();
    const act = button.dataset.mv;
    if (act === 'reject' && !reason) {
      modal.$('#mvReason').focus();
      toast('Укажите причину отклонения');
      return;
    }
    const body = { reason };
    if (act === 'part') body.fields = [...modal.d.querySelectorAll('[data-mf]:checked')].map(box => box.dataset.mf);
    button.disabled = true;
    try {
      this._done(await this.post(id, act === 'reject' ? 'reject' : 'approve', body), act);
      modal.close();
      Catalog.refresh();
      if (done) done();
    } catch (error) {
      button.disabled = false;
      toast(error.message || String(error));
    }
  }

  static _done(answer, act) {
    toast(answer && answer.ok === false ? answer.message || 'Правка уже рассмотрена' : this.DONE[act]);
  }

  static _cat(edit) {
    const after = edit.afterDoc && edit.afterDoc.attrs && edit.afterDoc.attrs.cat;
    const before = edit.beforeDoc && edit.beforeDoc.attrs && edit.beforeDoc.attrs.cat;
    return after || before || '';
  }

  /**
   * Открыть правку.
   * @param {number} id
   * @param {function(): void} [done] решение принято
   */
  static async open(id, done) {
    let edit;
    try {
      edit = await this.get(id);
    } catch (error) {
      toast(error.message || String(error));
      return;
    }
    const ctx = { cat: this._cat(edit), isNew: edit.kind === 'create', pend: edit.status === 'pending' };
    const modal = new Modal(this._html(edit, ctx), 'mv');
    modal.d.addEventListener('change', event => {
      if (event.target.closest('[data-mall]')) {
        modal.d.querySelectorAll('[data-mf]').forEach(box => {
          box.checked = event.target.checked;
        });
      }
      this._sync(modal, ctx.isNew);
    });
    modal.d.addEventListener('click', event => {
      if (event.target.closest('[data-x]')) {
        modal.close();
        return;
      }
      const button = event.target.closest('[data-mv]');
      if (button) this._decide(modal, button, { id, done });
    });
    this._sync(modal, ctx.isNew);
  }
}

/** Очередь правок: строка — товар, что изменено, кто и когда, «Посмотреть». */
export class ModerationList {
  static TAGS = 6;

  static _tags(edit) {
    if (edit.kind === 'create') return '<span class="mv-tag new">новый товар</span>';
    const fields = edit.fields || [];
    const more = fields.length > this.TAGS ? `<span class="mv-tag">ещё ${fields.length - this.TAGS}</span>` : '';
    return (
      fields
        .slice(0, this.TAGS)
        .map(field => `<span class="mv-tag">${esc(field)}</span>`)
        .join('') + more
    );
  }

  /**
   * Список правок.
   * @param {object[]} list
   * @param {string} empty текст, если правок нет
   * @returns {string}
   */
  static html(list, empty) {
    if (!list.length) return `<p class="muted">${esc(empty)}</p>`;
    return list
      .map(
        edit => `<div class="st-row mv-item"><div><b>${esc(edit.name)}</b>
        <span class="mv-tags">${this._tags(edit)}</span>
        <span class="muted">${edit.cat ? `${esc(typeById(edit.cat).name)} · ` : ''}${esc(edit.userName || '—')} · ${esc(Fmt.dateTime(edit.created))}${edit.stale ? ' · <span class="bad-t">товар изменили после отправки</span>' : ''}</span></div>
        <div class="acts"><button class="btn" type="button" data-pend="${edit.id}">Посмотреть</button></div></div>`,
      )
      .join('');
  }

  /** Очередь для менеджера с правом «Правки без модерации» (из окна каталога). */
  static async open() {
    let answer;
    try {
      answer = await api('/api/catalog/moderation');
    } catch (error) {
      toast(error.message || String(error));
      return;
    }
    const modal = new Modal(
      `<div class="mv-h"><h3>На модерации · ${answer.pending.length}</h3><button class="icon" type="button" data-x aria-label="Закрыть">✕</button></div>
      <div class="mv-q">${this.html(answer.pending, 'Правок, ожидающих решения, нет.')}</div>`,
      'mv mv-ql',
    );
    modal.d.addEventListener('click', event => {
      if (event.target.closest('[data-x]')) {
        modal.close();
        return;
      }
      const button = event.target.closest('[data-pend]');
      if (!button) return;
      modal.close();
      const win = CatalogWindow.win;
      ModerationView.open(+button.dataset.pend, () => {
        win.loadPending().then(() => win.redraw());
      });
    });
  }
}
